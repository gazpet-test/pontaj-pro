// probleme-parc-reminder — seara (19:00 RO, L-S), email către mecanici (Mitrache
// & Dani, configurabili în logistica_setari.probleme_reminder_emails) DOAR dacă
// există probleme de parc deschise neatinse azi. Plasa pentru „am uitat să trec
// prin listă” — cerut de Razvan 20.08.2026.
// Neatinsă azi = nici deschisă azi, nici updated_at azi, nici intrare în jurnal azi.
// ?dry=1 → doar raportează, nu trimite.
// v9 (06.10.2026, #17 faza 3, adus în repo de pe live v8): poarta = cronul cu x-intern-secret din Vault sau owner-ul
//   logat (_shared/poartaCron.ts), nu mai INGEST_SECRET; răspunsul fără dry (păstrat de pg_net) are doar numărători —
//   fără adrese de mail sau textul erorii Resend (acela merge în log).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const NO_REPLY = `<p style="color:#c0392b;font-size:13px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat de platformă, căsuța nu e citită de nimeni. Dacă ai o problemă, scrie-i lui Razvan sau la office@gazpet.ro.</p>`
const OPEN = ['deschisa', 'in_lucru', 'asteapta_piese', 'asteapta_service']
const STATUS_RO: Record<string, string> = {
  deschisa: 'Deschisă', in_lucru: 'În lucru', asteapta_piese: 'Așteaptă piese', asteapta_service: 'Așteaptă service',
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await cronSauOwner(req, sb))) return json({ ok: false, error: 'neautorizat' }, 401)
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date())
  if (new Date(azi + 'T12:00:00Z').getUTCDay() === 0) return json({ ok: true, skip: 'duminica' })

  const { data: setari } = await sb.from('logistica_setari').select('key, value')
    .in('key', ['probleme_reminder_activ', 'probleme_reminder_emails'])
  // deno-lint-ignore no-explicit-any
  const set = Object.fromEntries((setari || []).map((s: any) => [s.key, s.value]))
  if (set.probleme_reminder_activ !== 'true') return json({ ok: true, skip: 'reminder_oprit' })
  const emails = String(set.probleme_reminder_emails || '').split(',').map((e: string) => e.trim()).filter(Boolean)
  if (!emails.length) return json({ ok: false, error: 'fara_destinatari' }, 500)

  const [{ data: probleme, error: pErr }, { data: jurnalAzi }] = await Promise.all([
    sb.from('logistica_probleme')
      .select('id, titlu, status, severitate, asteapta, data_deschidere, updated_at, extern, activ:logistica_active(marca, model, nr_inmatriculare), scula:magazie_echipamente(denumire)')
      .in('status', OPEN),
    sb.from('logistica_probleme_jurnal').select('problema_id').eq('data', azi),
  ])
  if (pErr) { console.error('db', pErr.message); return json({ ok: false, error: 'db' }, 500) }

  // deno-lint-ignore no-explicit-any
  const atinseAzi = new Set((jurnalAzi || []).map((j: any) => j.problema_id))
  const dataRO = (ts: string | null) => ts ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ts)) : null
  // deno-lint-ignore no-explicit-any
  const neatinse = (probleme || []).filter((p: any) =>
    !atinseAzi.has(p.id) && p.data_deschidere !== azi && dataRO(p.updated_at) !== azi)
  if (!neatinse.length) return json({ ok: true, skip: 'toate_atinse_azi', deschise: (probleme || []).length })

  // deno-lint-ignore no-explicit-any
  const lbl = (p: any) => p.activ
    ? [[p.activ.marca, p.activ.model].filter(Boolean).join(' '), p.activ.nr_inmatriculare].filter(Boolean).join(' · ')
    : (p.scula?.denumire || p.extern || '—')
  const zile = (d: string) => Math.max(0, Math.round((new Date(azi).getTime() - new Date(d).getTime()) / 864e5))
  // deno-lint-ignore no-explicit-any
  const sortate = neatinse.sort((a: any, b: any) =>
    (a.severitate === 'blocant' ? 0 : 1) - (b.severitate === 'blocant' ? 0 : 1) || String(a.data_deschidere).localeCompare(String(b.data_deschidere)))
  const top = sortate.slice(0, 15)

  // deno-lint-ignore no-explicit-any
  const randuri = top.map((p: any) =>
    `<tr><td>${p.severitate === 'blocant' ? '🔴 ' : ''}${lbl(p)}</td><td>${p.titlu}</td>` +
    `<td>${STATUS_RO[p.status] || p.status}${p.asteapta ? ' — ' + p.asteapta : ''}</td>` +
    `<td align="right">${zile(p.data_deschidere)} zile</td></tr>`).join('')
  const html = `<p>Salut!</p>` +
    `<p>Sunt <b>${neatinse.length}</b> probleme de parc deschise <b>fără nicio mișcare azi</b> — nici status schimbat, nici notă în jurnal. Treceți prin listă și completați ce s-a reparat sau ce așteaptă:</p>` +
    `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;font-size:13px">` +
    `<tr style="background:#f0f0f0"><th>Utilaj</th><th>Problema</th><th>Status</th><th>Vechime</th></tr>${randuri}</table>` +
    (neatinse.length > top.length ? `<p style="font-size:12px;color:#666">…și încă ${neatinse.length - top.length}.</p>` : '') +
    `<p>Se lucrează în <a href="https://pontaj-pro-sooty.vercel.app/logistica">Logistică → Probleme Parc</a>. Ce rezolvați apare automat în raportul parcului.</p>`

  // deno-lint-ignore no-explicit-any
  if (dry) return json({ ok: true, dry: true, neatinse: neatinse.length, destinatari: emails, primele: top.map((p: any) => lbl(p) + ' — ' + p.titlu).slice(0, 5) })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to: emails,
      subject: `🔧 ${neatinse.length} probleme de parc neatinse azi — treceți prin listă`, html: html + NO_REPLY }),
  })
  if (!res.ok) { console.error('resend', await res.text()); return json({ ok: false, error: 'resend' }, 500) }
  return json({ ok: true, nr_destinatari: emails.length, neatinse: neatinse.length })
})
