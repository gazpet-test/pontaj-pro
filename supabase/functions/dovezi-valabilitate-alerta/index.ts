// dovezi-valabilitate-alerta — Poarta 2 anti-descalificare (#862, 02.09.2026):
// săptămânal, mail către Razvan cu dovezile de calificare ROȘII (expirate/<90 zile/
// neutilizabile — ex. etalonări pe numele altcuiva) și GALBENE (<180 zile) din v_dovezi_stare.
// Auth: x-radar-secret. Erori business → return, nu throw.
//
// ADUSĂ ÎN REPO 12.09.2026. SINGURA modificare față de sursa deployată: secretul nu mai e scris
// literal în cod, ci se verifică prin Vault (fn_verifica_radar_secret), care acceptă și valoarea
// precedentă cât ține fereastra de rotire.
import { createClient } from 'npm:@supabase/supabase-js@2'

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const TO = ['razvan.trusu@gazpet.ro']
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('ro-RO') : '—'

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Secretul NU stă în sursă: repo-ul e public. Verificare prin RPC contra Vault.
  const s = req.headers.get('x-radar-secret')
  if (!s) return json({ error: 'unauthorized' }, 401)
  const { data: okSecret, error: eSecret } = await sb.rpc('fn_verifica_radar_secret', { p_secret: s })
  if (eSecret || okSecret !== true) return json({ error: 'unauthorized' }, 401)

  const RESEND = Deno.env.get('RESEND_API_KEY')
  if (!RESEND) return json({ ok: false, error: 'RESEND_API_KEY lipsa' })

  const { data: rows, error } = await sb.from('v_dovezi_stare')
    .select('denumire, categorie, numar_document, data_valabilitate, zile_ramase, stare, utilizabil, observatii')
    .in('stare', ['rosie', 'galbena']).order('stare').order('data_valabilitate', { nullsFirst: true })
  if (error) return json({ ok: false, error: error.message })
  if (!rows?.length) return json({ ok: true, alerte: 0, reason: 'totul_verde' })

  const rosii = rows.filter(r => r.stare === 'rosie'), galbene = rows.filter(r => r.stare === 'galbena')
  const rand = (r: any) => `
    <div style="border:1px solid #30363D;border-left:3px solid ${r.stare === 'rosie' ? '#F85149' : '#D29922'};border-radius:8px;padding:10px 14px;margin-bottom:8px;background:#161B22">
      <div style="font-weight:700">${esc(r.denumire)} <span style="color:#8B949E;font-weight:400;font-size:12px">· ${esc(r.categorie)}${r.numar_document ? ' · ' + esc(r.numar_document) : ''}</span></div>
      <div style="font-size:12.5px;color:${r.stare === 'rosie' ? '#F85149' : '#D29922'}">${!r.utilizabil ? '⛔ neutilizabilă' : r.zile_ramase != null && r.zile_ramase < 0 ? `expirată de ${-r.zile_ramase} zile (${fmtD(r.data_valabilitate)})` : r.zile_ramase != null ? `expiră în ${r.zile_ramase} zile (${fmtD(r.data_valabilitate)})` : 'fără dată de valabilitate'}</div>
      ${r.observatii ? `<div style="font-size:12px;color:#8B949E;margin-top:3px">${esc(r.observatii)}</div>` : ''}
    </div>`

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
    <div style="background:#DA3633;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">🚦 Dovezi de calificare: ${rosii.length} roșii · ${galbene.length} galbene</div>
    <div style="padding:20px 24px;font-size:13.5px;line-height:1.5">
      <p style="margin:0 0 12px">Astea pot costa DESCALIFICAREA la licitații — de rezolvat înainte de următoarea depunere:</p>
      ${rosii.length ? '<div style="font-weight:800;color:#F85149;margin:10px 0 6px">🔴 ROȘII (expirate / neutilizabile / sub 90 zile)</div>' + rosii.map(rand).join('') : ''}
      ${galbene.length ? '<div style="font-weight:800;color:#D29922;margin:14px 0 6px">🟡 GALBENE (sub 180 zile)</div>' + galbene.map(rand).join('') : ''}
      <div style="margin-top:14px;font-size:12px;color:#8B949E">Mail automat săptămânal din PontajPRO · Poarta 2 anti-descalificare. Documentele roșii blochează și marcarea licitațiilor ca „depusă”.</div>
    </div>
  </div>`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: TO, subject: `🚦 Dovezi calificare: ${rosii.length} roșii, ${galbene.length} galbene`, html }),
  })
  const txt = await resp.text()
  if (!resp.ok) return json({ ok: false, error: 'Resend: ' + txt.slice(0, 200) })
  return json({ ok: true, rosii: rosii.length, galbene: galbene.length })
})
