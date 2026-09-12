// ofertare-alerte-mail — task #38: după scanul radar, trimite pe mail (Resend)
// anunțurile SEAP relevante noi (cuvinte-cheie/CPV deja filtrate de radar-scan,
// scor AI inclus). Rulează pe cron după radar; idempotent prin alerta_trimisa.
// Auth: x-radar-secret (același ca radar-scan). Erori business → return, nu throw.
// v2 07.09.2026: + office@gazpet.ro (redirecționează la toți colegii) — cerut de Răzvan.
// v3 07.09.2026 seara: PRAG DE SCOR — pe mail pleacă doar anunțurile cu scor AI >= PRAG (Răzvan: „astea nu sunt pe profilul nostru”
//   la un mail cu top scor 28 — apă/canalizare intră pe cuvinte-cheie). Cele sub prag rămân în Radar (vizibile în platformă) și se
//   marchează alerta_trimisa ca să nu se adune; cele încă nescorate așteaptă scorul.
//
// ADUSĂ ÎN REPO la 12.09.2026. Rula neversionată. SINGURA modificare față de sursa
// deployată: secretul nu mai e scris literal în cod.
//
// ⚠️ Aici expunerea era cea mai gravă din cele trei funcții găsite cu acelaşi tipar:
// secretul era SINGURA autentificare (fără alternativă pe JWT), `verify_jwt` e false,
// iar funcția trimite mail prin Resend către razvan.trusu@gazpet.ro ȘI office@gazpet.ro,
// care redirecționează la toți colegii. Cine citise valoarea din repo-ul public putea
// trimite mail în numele firmei, de la o adresă @gazpet.ro. Verificarea trece acum prin
// Vault. SECRETUL RĂMÂNE DE ROTIT — scoaterea literalului nu e revocare (task #51).
import { createClient } from 'npm:@supabase/supabase-js@2'

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const TO = ['razvan.trusu@gazpet.ro', 'office@gazpet.ro']
const PRAG = 50
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const fmt = (n: unknown) => n == null ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 0 })
const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Secretul NU stă în sursă: repo-ul e public. Verificare prin RPC contra Vault, care
  // acceptă și valoarea precedentă cât ține fereastra de rotire.
  const s = req.headers.get('x-radar-secret')
  if (!s) return json({ error: 'unauthorized' }, 401)
  const { data: okSecret, error: eSecret } = await sb.rpc('fn_verifica_radar_secret', { p_secret: s })
  if (eSecret || okSecret !== true) return json({ error: 'unauthorized' }, 401)

  const RESEND = Deno.env.get('RESEND_API_KEY')
  if (!RESEND) return json({ ok: false, error: 'RESEND_API_KEY lipsa' })

  const { data: toate } = await sb.from('ofertare_radar')
    .select('id, nr_seap, titlu, autoritate, cpv, valoare_lei, termen_depunere, tip_procedura, link, scor_potrivire, motiv_scor, lipsuri, segment')
    .eq('relevant', true).eq('alerta_trimisa', false)
    .order('scor_potrivire', { ascending: false, nullsFirst: false }).limit(60)
  const subPrag = (toate || []).filter(r => r.scor_potrivire != null && r.scor_potrivire < PRAG)
  if (subPrag.length) await sb.from('ofertare_radar').update({ alerta_trimisa: true }).in('id', subPrag.map(r => r.id))
  const rows = (toate || []).filter(r => r.scor_potrivire != null && r.scor_potrivire >= PRAG).slice(0, 30)
  if (!rows.length) return json({ ok: true, alerte: 0, sub_prag: subPrag.length, nescorate: (toate || []).filter(r => r.scor_potrivire == null).length, reason: 'nimic_peste_prag' })

  const scorBadge = (s: number | null) => s == null ? '<span style="color:#8B949E">nescorat încă</span>'
    : s >= 70 ? `<b style="color:#3FB950">scor ${s}</b>` : s >= 40 ? `<b style="color:#D29922">scor ${s}</b>` : `<span style="color:#8B949E">scor ${s}</span>`

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
    <div style="background:#1F6FEB;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">🔔 Licitații SEAP noi — ${rows.length} anunțuri relevante</div>
    <div style="padding:20px 24px;font-size:13.5px;line-height:1.55">
      ${rows.map(r => `
        <div style="border:1px solid #30363D;border-radius:10px;padding:12px 16px;margin-bottom:12px;background:#161B22">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px"><a href="${esc(r.link)}" style="color:#58A6FF;text-decoration:none">${esc(r.titlu)}</a></div>
          <div style="color:#8B949E;font-size:12.5px;margin-bottom:6px">${esc(r.autoritate)} · ${esc(r.nr_seap)} · ${esc(r.tip_procedura || '')}</div>
          <div style="font-size:13px">💰 <b>${fmt(r.valoare_lei)} lei</b> · ⏳ termen <b>${fmtD(r.termen_depunere)}</b> · ${scorBadge(r.scor_potrivire)}</div>
          ${r.motiv_scor ? `<div style="font-size:12.5px;color:#8B949E;margin-top:5px">${esc(r.motiv_scor)}</div>` : ''}
          ${Array.isArray(r.lipsuri) && r.lipsuri.length ? `<div style="font-size:12px;color:#F0883E;margin-top:4px">⚠ ${r.lipsuri.map(esc).join(' · ')}</div>` : ''}
        </div>`).join('')}
      <div style="margin-top:8px"><a href="https://pontaj-pro-sooty.vercel.app" style="background:#238636;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide Radarul în platformă</a></div>
      <div style="margin-top:14px;font-size:12px;color:#8B949E">Mail automat din PontajPRO · Radar licitații (filtru cuvinte-cheie + CPV + scor AI ≥ ${PRAG}; restul rămân în Radar, fără mail).</div>
    </div>
  </div>`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: TO, subject: `🔔 SEAP: ${rows.length} licitații noi relevante (top scor ${rows[0].scor_potrivire})`, html }),
  })
  const txt = await resp.text()
  if (!resp.ok) return json({ ok: false, error: 'Resend: ' + txt.slice(0, 200) })
  await sb.from('ofertare_radar').update({ alerta_trimisa: true }).in('id', rows.map(r => r.id))
  return json({ ok: true, alerte: rows.length, sub_prag: subPrag.length })
})
