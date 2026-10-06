// reminder-rapoarte — seara, notifică managerii șantierelor ACTIVE care nu au
// trimis raportul zilnic. Chemat de pg_cron (luni-sâmbătă, ora 19 RO).
// Șantier activ = are cel puțin un raport în ultimele 7 zile.
// Dedup: reminder_rapoarte_log unique(site_id, data) — nu trimite de 2 ori.
// v2: mențiune clară no-reply în corpul mailului (căsuța nu există).
// v10 (06.10.2026, #17 faza 3, adus în repo de pe live v9): poarta = cronul cu x-intern-secret din Vault sau owner-ul
//   logat (_shared/poartaCron.ts), nu mai INGEST_SECRET; răspunsul (păstrat de pg_net în net._http_response) are doar
//   id-uri de șantier și stări — fără adrese de mail, nume sau text de eroare din BD.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await cronSauOwner(req, sb))) return json({ ok: false, error: 'neautorizat' }, 401)

  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date())
  const ziSapt = new Date(azi + 'T12:00:00Z').getUTCDay()
  if (ziSapt === 0) return json({ ok: true, skip: 'duminica' })

  const { data: recente, error: rErr } = await sb
    .from('rapoarte_zilnice')
    .select('site_id, data')
    .gte('data', new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
  if (rErr) { console.error('db_rapoarte', rErr.message); return json({ ok: false, error: 'db_rapoarte' }, 500) }

  const active = [...new Set((recente || []).map(r => r.site_id))]
  const cuRaportAzi = new Set((recente || []).filter(r => r.data === azi).map(r => r.site_id))
  const lipsa = active.filter(s => !cuRaportAzi.has(s))
  if (!lipsa.length) return json({ ok: true, mesaj: 'toate santierele au raport', azi })

  const { data: dejaTrimise } = await sb
    .from('reminder_rapoarte_log').select('site_id').eq('data', azi)
  const dejaSet = new Set((dejaTrimise || []).map(r => r.site_id))
  const deTrimis = lipsa.filter(s => !dejaSet.has(s))
  if (!deTrimis.length) return json({ ok: true, mesaj: 'remindere deja trimise', azi })

  const [{ data: sites }, { data: ps }] = await Promise.all([
    sb.from('sites').select('id, name').in('id', deTrimis),
    sb.from('profile_sites').select('site_id, profiles(id, name, email)').in('site_id', deTrimis),
  ])
  const siteName = Object.fromEntries((sites || []).map(s => [s.id, s.name]))

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ ok: false, error: 'lipsa_RESEND_API_KEY' }, 500)

  const rezultate: { site_id: number; status: string; nr_destinatari?: number }[] = []
  for (const sid of deTrimis) {
    // deno-lint-ignore no-explicit-any
    const manageri = (ps || []).filter((p: any) => p.site_id === sid && p.profiles?.email)
    // deno-lint-ignore no-explicit-any
    const emails = manageri.map((m: any) => m.profiles.email)
    if (!emails.length) {
      rezultate.push({ site_id: sid, status: 'fara_manageri' })
      continue
    }
    const nume = siteName[sid] || `Șantier #${sid}`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'PontajPRO <rapoarte@gazpet.ro>',
        to: emails,
        subject: `⏰ Lipsește raportul zilnic — ${nume}`,
        html: `<p>Salut,</p><p>Pentru <b>${nume}</b> nu a fost trimis încă raportul zilnic de azi (${azi}).</p>` +
              `<p>Durează 2 minute: <a href="https://pontaj-pro-sooty.vercel.app/mobil">deschide raportul</a> 📱</p>` +
              `<p>Dacă azi nu s-a lucrat pe acest șantier, poți ignora mesajul.</p>` +
              `<p style="color:#c0392b;font-size:13px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat de platformă, căsuța nu e citită de nimeni. Dacă ai o problemă, scrie-i lui Razvan sau la office@gazpet.ro.</p>`,
      }),
    })
    const ok = res.ok
    if (!ok) console.error('resend', sid, await res.text())
    await sb.from('reminder_rapoarte_log').insert({ site_id: sid, data: azi, destinatari: emails, trimis: ok })
    rezultate.push({ site_id: sid, status: ok ? 'trimis' : 'eroare_email', nr_destinatari: emails.length })
  }

  return json({ ok: true, azi, remindere: rezultate })
})
