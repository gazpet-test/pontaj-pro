// ofertare-rc-necitit — (a) escaladarea zilnică „răspuns de la autoritate necitit” (Răzvan 19.10.2026, „da d-a-b”, varianta A).
// Pornit DOAR de pg_cron (ofertare_rc_necitit_0530) cu x-radar-secret, verificat prin Vault (fn_verifica_radar_secret) — cheia anon
// NU ajunge (verify_jwt nu e o poartă de rol, vezi PR #318).
// 1) apelează public.ofertare_alerta_rc_necitit(): notificări 'critical' în platformă (responsabil ziua 1, + owner ziua 2+), o dată pe zi;
// 2) mail către OWNER(I) — destinatari ficși din profiles.is_owner, niciodată din conținutul documentelor — pentru licitațiile cu
//    ≤ 5 zile până la depunere, o dată pe zi (amprenta 'rc_necitit_mail' scrisă DUPĂ ce Resend a acceptat mailul).
// Citește doar metadate (tip, status, nume fișier, termen) — NU textul documentelor. Nu pornește procesări, nu atinge bani sau drepturi.
// Erori de business → return, nu throw.
import { createClient } from 'npm:@supabase/supabase-js@2'

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const PRAG_MAIL_ZILE = 5
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const zi = (d: string) => d.split('-').reverse().join('.')

type Lic = { licitatie_id: number; nr_anunt: string | null; obiect: string; zile_necitit: number; zile_depunere: number; de_la: string; nr: number; lista: string }

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const s = req.headers.get('x-radar-secret')
  if (!s) return json({ error: 'unauthorized' }, 401)
  const { data: okSecret, error: eSecret } = await sb.rpc('fn_verifica_radar_secret', { p_secret: s })
  if (eSecret || okSecret !== true) return json({ error: 'unauthorized' }, 401)

  const { data: rez, error: eRez } = await sb.rpc('ofertare_alerta_rc_necitit')
  if (eRez) return json({ ok: false, error: 'rpc: ' + eRez.message })
  const azi: string = rez?.azi
  const lic: Lic[] = (rez?.licitatii || []).filter((l: Lic) => l.zile_depunere <= PRAG_MAIL_ZILE)
  if (!lic.length) return json({ ok: true, notificari: rez?.notificari ?? 0, mail: 0, reason: 'nimic_sub_prag' })

  // o dată pe zi pe licitație
  const { data: amp } = await sb.from('ofertare_alerte_amprenta').select('licitatie_id, amprenta').eq('fel', 'rc_necitit_mail').in('licitatie_id', lic.map(l => l.licitatie_id))
  const deja = new Set((amp || []).filter(a => a.amprenta === `mail|${azi}`).map(a => a.licitatie_id))
  const deTrimis = lic.filter(l => !deja.has(l.licitatie_id))
  if (!deTrimis.length) return json({ ok: true, notificari: rez?.notificari ?? 0, mail: 0, reason: 'trimis_azi' })

  const RESEND = Deno.env.get('RESEND_API_KEY')
  if (!RESEND) return json({ ok: false, notificari: rez?.notificari ?? 0, error: 'RESEND_API_KEY lipsa' })
  const { data: owners } = await sb.from('profiles').select('email').eq('is_owner', true).not('email', 'is', null)
  const to = [...new Set((owners || []).map(o => String(o.email).trim()).filter(e => /@gazpet\.ro$/i.test(e)))]
  if (!to.length) return json({ ok: false, notificari: rez?.notificari ?? 0, error: 'niciun owner cu email @gazpet.ro' })

  const minZile = Math.min(...deTrimis.map(l => l.zile_depunere))
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
    <div style="background:#B91C1C;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">🚨 Răspuns de la autoritate NECITIT — ${deTrimis.length} ${deTrimis.length === 1 ? 'licitație' : 'licitații'}</div>
    <div style="padding:20px 24px;font-size:13.5px;line-height:1.55">
      ${deTrimis.map(l => `
        <div style="border:1px solid #7F1D1D;border-radius:10px;padding:12px 16px;margin-bottom:12px;background:#161B22">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(l.nr_anunt || 'licitația ' + l.licitatie_id)} — <span style="color:#F87171">${l.zile_depunere <= 0 ? 'depunerea e AZI' : l.zile_depunere + (l.zile_depunere === 1 ? ' zi' : ' zile') + ' până la depunere'}</span></div>
          <div style="color:#8B949E;font-size:12.5px;margin-bottom:6px">${esc(l.obiect)}</div>
          <div style="font-size:13px">📄 ${l.nr} ${l.nr === 1 ? 'document necitit' : 'documente necitite'} din <b>${zi(l.de_la)}</b> (${l.zile_necitit} ${l.zile_necitit === 1 ? 'zi' : 'zile'}): ${esc(l.lista)}</div>
        </div>`).join('')}
      <div style="margin-top:8px"><a href="https://pontaj-pro-sooty.vercel.app" style="background:#238636;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide Ofertare</a></div>
      <div style="margin-top:14px;font-size:12px;color:#8B949E">Mail automat din PontajPRO · se repetă zilnic cât timp răspunsul e neprocesat și sunt ≤ ${PRAG_MAIL_ZILE} zile până la depunere. Procesarea o pornești din fișa licitației → Documentație (poarta pe cheltuială).</div>
    </div>
  </div>`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject: `🚨 RC necitit: ${deTrimis.map(l => l.nr_anunt || l.licitatie_id).join(', ')} — ${minZile <= 0 ? 'depunere AZI' : minZile + ' zile până la depunere'}`, html }),
  })
  const txt = await resp.text()
  if (!resp.ok) return json({ ok: false, notificari: rez?.notificari ?? 0, error: 'Resend: ' + txt.slice(0, 200) })
  await sb.from('ofertare_alerte_amprenta').upsert(deTrimis.map(l => ({ licitatie_id: l.licitatie_id, fel: 'rc_necitit_mail', amprenta: `mail|${azi}`, trimisa_la: new Date().toISOString() })), { onConflict: 'licitatie_id,fel' })
  return json({ ok: true, notificari: rez?.notificari ?? 0, mail: deTrimis.length, catre: to.length })
})
