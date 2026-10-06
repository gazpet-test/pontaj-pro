// necesar-notificari — notificări Resend pentru modulul Consumabile (necesar_*).
// Cron: ?actiune=deschidere|reminder|inchidere — gardat de cron/owner (vezi v12) +
//   master switch necesar_setari.notificari_active.
// UI: actiune=sosire (body JSON, JWT de utilizator) — activă imediat.
// Dedup: necesar_notif_log unique(runda_id, profile_id, tip).
// v4 (20.08): închiderea acceptă și runda blocată manual mai devreme — altfel
//   lista cumulată nu mai pleca deloc (cazul Cristiana, blocat miercuri 16:54).
// v12 (06.10.2026, #17 faza 3, adus în repo de pe live v11): acțiunile de cron = x-intern-secret din Vault sau owner-ul
//   logat (_shared/poartaCron.ts), nu mai INGEST_SECRET; răspunsurile de cron (păstrate de pg_net) fără adrese de mail și
//   fără text de eroare din BD. Ramura „sosire” (din UI) neschimbată.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const APP = 'https://pontaj-pro-sooty.vercel.app/consumabile'
const NO_REPLY = `<p style="color:#c0392b;font-size:13px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat de platformă, căsuța nu e citită de nimeni. Dacă ai o problemă, scrie-i lui Razvan sau la office@gazpet.ro.</p>`
const linkFreshful = (den: string) => 'https://www.freshful.ro/search?q=' + encodeURIComponent(String(den || '').replace(/\s*\([^)]*\)/g, '').trim())

function luniCurenta(): string {
  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date())
  const d = new Date(azi + 'T12:00:00Z')
  const zi = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (zi - 1))
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* fara body e ok */ }
  const actiune = new URL(req.url).searchParams.get('actiune') || body.actiune || ''

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ ok: false, error: 'lipsa_RESEND_API_KEY' }, 500)

  const trimite = async (to: string[], subject: string, html: string) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to, subject, html: html + NO_REPLY }),
    })
    if (!res.ok) console.error('resend', subject, await res.text())
    return res.ok
  }

  // ================= SOSIRE (din UI, JWT utilizator) =================
  if (actiune === 'sosire') {
    const authHeader = req.headers.get('Authorization') || ''
    const sbUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: uErr } = await sbUser.auth.getUser()
    if (uErr || !userData?.user) return json({ ok: false, error: 'neautentificat' }, 401)

    const rundaId = Number(body.runda_id)
    if (!rundaId) return json({ ok: false, error: 'lipsa_runda_id' }, 400)
    const { data: runda } = await sb.from('necesar_runde').select('id, saptamana, status').eq('id', rundaId).maybeSingle()
    if (!runda) return json({ ok: false, error: 'runda_inexistenta' }, 404)

    const { data: linii } = await sb.from('necesar_linii')
      .select('cerut_de, site_id, cantitate, um, denumire_libera, sites(name), necesar_articole(denumire)')
      .eq('runda_id', rundaId).neq('status_linie', 'taiata')
    if (!linii?.length) return json({ ok: true, skip: 'fara_linii' })

    const peOm = new Map<string, { locatii: Set<string>, articole: string[] }>()
    // deno-lint-ignore no-explicit-any
    for (const l of linii as any[]) {
      if (!l.cerut_de) continue
      const den = l.necesar_articole?.denumire || l.denumire_libera || '?'
      const loc = l.sites?.name || '?'
      if (!peOm.has(l.cerut_de)) peOm.set(l.cerut_de, { locatii: new Set(), articole: [] })
      const e = peOm.get(l.cerut_de)!
      e.locatii.add(loc)
      e.articole.push(`${den} — ${l.cantitate} ${l.um || 'buc'} (${loc})`)
    }

    const ids = [...peOm.keys()]
    const { data: profs } = await sb.from('profiles')
      .select('id, name, email, email_notifications_enabled').in('id', ids)
    const { data: deja } = await sb.from('necesar_notif_log')
      .select('profile_id').eq('runda_id', rundaId).eq('tip', 'sosire')
    // deno-lint-ignore no-explicit-any
    const dejaSet = new Set((deja || []).map((r: any) => r.profile_id))

    let trimise = 0
    // deno-lint-ignore no-explicit-any
    for (const p of (profs || []) as any[]) {
      if (!p.email || p.email_notifications_enabled === false || dejaSet.has(p.id)) continue
      const e = peOm.get(p.id)!
      const ok = await trimite([p.email], `📦 Au sosit consumabilele — ${[...e.locatii].join(', ')}`,
        `<p>Salut!</p><p>A sosit marfa din runda de consumabile (săpt. ${runda.saptamana}). Ce ai cerut tu:</p>` +
        `<ul>${e.articole.map(a => `<li>${a}</li>`).join('')}</ul>` +
        `<p>Le găsești la locul obișnuit / întreabă la administrativ. Detalii: <a href="${APP}">Consumabile</a>.</p>`)
      await sb.from('necesar_notif_log').insert({ runda_id: rundaId, profile_id: p.id, tip: 'sosire', email: p.email, trimis: ok ? 'ok' : 'eroare' })
      if (ok) trimise++
    }
    return json({ ok: true, actiune, runda_id: rundaId, trimise, persoane: ids.length })
  }

  // ================= ACTIUNI CRON (cron/owner + master switch) =================
  if (!(await cronSauOwner(req, sb))) return json({ ok: false, error: 'neautorizat' }, 401)
  if (!['deschidere', 'reminder', 'inchidere'].includes(actiune)) {
    return json({ ok: false, error: 'actiune_invalida' }, 400)
  }

  const { data: setari } = await sb.from('necesar_setari').select('cheie, valoare')
  // deno-lint-ignore no-explicit-any
  const set = Object.fromEntries((setari || []).map((s: any) => [s.cheie, s.valoare]))
  if (set.notificari_active !== 'true') return json({ ok: true, skip: 'notificari_oprite' })

  const saptamana = luniCurenta()
  const oraDeadline = set.ora_deadline || '12:00'
  const ziDeadline = Number(set.zi_deadline || 4)

  if (actiune === 'deschidere') {
    let { data: runda } = await sb.from('necesar_runde').select('*').eq('saptamana', saptamana).maybeSingle()
    if (!runda) {
      const d = new Date(saptamana + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + (ziDeadline - 1))
      const { data: nou, error } = await sb.from('necesar_runde')
        .insert({ saptamana, status: 'deschisa', deadline_la: new Date(d.toISOString().slice(0, 10) + 'T' + oraDeadline + ':00+03:00').toISOString() })
        .select().single()
      if (error) { console.error('creare_runda', error.message); return json({ ok: false, error: 'creare_runda' }, 500) }
      runda = nou
    }
    if (runda.status !== 'deschisa') return json({ ok: true, skip: 'runda_nu_e_deschisa', status: runda.status })

    const { data: profs } = await sb.from('profiles')
      .select('id, name, email, email_notifications_enabled')
      .not('email', 'is', null)
    // deno-lint-ignore no-explicit-any
    const tinte = (profs || []).filter((p: any) => p.email && p.email_notifications_enabled !== false)

    const { data: deja } = await sb.from('necesar_notif_log')
      .select('profile_id').eq('runda_id', runda.id).eq('tip', 'deschidere')
    // deno-lint-ignore no-explicit-any
    const dejaSet = new Set((deja || []).map((r: any) => r.profile_id))

    const deadlineTxt = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(runda.deadline_la))
    let trimise = 0
    for (const p of tinte) {
      if (dejaSet.has(p.id)) continue
      const ok = await trimite([p.email], '🛒 Consumabile pentru servicii sediu/birou — spune ce ai nevoie',
        `<p>Salut${p.name ? ', ' + p.name.split(' ').pop() : ''}!</p>` +
        `<p>S-a deschis runda săptămânală de <b>consumabile pentru sediu/birou</b> (papetărie, protocol, curățenie, IT).</p>` +
        `<p>Adaugă ce ai nevoie până <b>${deadlineTxt}</b>: <a href="${APP}">deschide Consumabile</a> 🛒</p>` +
        `<p>Dacă nu ai nevoie de nimic săptămâna asta, ignoră mesajul.</p>`)
      await sb.from('necesar_notif_log').insert({ runda_id: runda.id, profile_id: p.id, tip: 'deschidere', email: p.email, trimis: ok ? 'ok' : 'eroare' })
      if (ok) trimise++
    }
    return json({ ok: true, actiune, runda_id: runda.id, trimise, total_tinte: tinte.length })
  }

  // Reminder: doar pe rundă deschisă. Închidere: și pe rundă blocată manual mai
  // devreme din UI — altfel lista cumulată către achizitor nu mai pleacă deloc.
  const statusuriOk = actiune === 'inchidere' ? ['deschisa', 'blocata'] : ['deschisa']
  const { data: runda } = await sb.from('necesar_runde')
    .select('*').eq('saptamana', saptamana).in('status', statusuriOk).maybeSingle()
  if (!runda) return json({ ok: true, skip: 'fara_runda_potrivita', saptamana })

  if (actiune === 'reminder') {
    const { data: linii } = await sb.from('necesar_linii')
      .select('cerut_de, cantitate, um, denumire_libera, articol_id, necesar_articole(denumire)')
      .eq('runda_id', runda.id).neq('status_linie', 'taiata')
    const peOm = new Map<string, string[]>()
    // deno-lint-ignore no-explicit-any
    for (const l of (linii || []) as any[]) {
      const den = l.necesar_articole?.denumire || l.denumire_libera || '?'
      if (!peOm.has(l.cerut_de)) peOm.set(l.cerut_de, [])
      peOm.get(l.cerut_de)!.push(`${den} — ${l.cantitate} ${l.um || 'buc'}`)
    }

    const { data: profs } = await sb.from('profiles')
      .select('id, name, email, email_notifications_enabled').not('email', 'is', null)
    // deno-lint-ignore no-explicit-any
    const tinte = (profs || []).filter((p: any) => p.email && p.email_notifications_enabled !== false)
    const { data: deja } = await sb.from('necesar_notif_log')
      .select('profile_id').eq('runda_id', runda.id).eq('tip', 'reminder')
    // deno-lint-ignore no-explicit-any
    const dejaSet = new Set((deja || []).map((r: any) => r.profile_id))

    const oraTxt = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }).format(new Date(runda.deadline_la))
    let trimise = 0
    for (const p of tinte) {
      if (dejaSet.has(p.id)) continue
      const ale = peOm.get(p.id)
      const corp = ale?.length
        ? `<p>Ai cerut până acum:</p><ul>${ale.map(a => `<li>${a}</li>`).join('')}</ul><p>Dacă mai vrei ceva, adaugă până la <b>${oraTxt}</b>: <a href="${APP}">Consumabile</a>.</p>`
        : `<p>Nu ai cerut nimic în runda asta. Lista se închide azi la <b>${oraTxt}</b> — dacă ai nevoie de ceva, <a href="${APP}">adaugă acum</a>. Dacă nu, ignoră mesajul.</p>`
      const ok = await trimite([p.email], `⏰ Consumabile sediu/birou — lista se închide azi la ${oraTxt}`, `<p>Salut!</p>` + corp)
      await sb.from('necesar_notif_log').insert({ runda_id: runda.id, profile_id: p.id, tip: 'reminder', email: p.email, trimis: ok ? 'ok' : 'eroare' })
      if (ok) trimise++
    }
    return json({ ok: true, actiune, runda_id: runda.id, trimise })
  }

  if (actiune === 'inchidere') {
    const { data: deja } = await sb.from('necesar_notif_log')
      .select('id').eq('runda_id', runda.id).eq('tip', 'inchidere').limit(1)
    if (deja?.length) return json({ ok: true, skip: 'deja_inchisa_notificata' })

    if (runda.status === 'deschisa') {
      await sb.from('necesar_runde').update({ status: 'blocata', blocata_la: new Date().toISOString() }).eq('id', runda.id)
    }

    const { data: cumulat } = await sb.from('v_necesar_cumulat')
      .select('*').eq('runda_id', runda.id)
      .order('locatie').order('categorie').order('articol')

    const emailTinta = set.email_achizitor
    if (!emailTinta) return json({ ok: false, error: 'lipsa_email_achizitor' }, 500)

    let html: string
    if (!cumulat?.length) {
      html = `<p>Salut!</p><p>Runda de consumabile din săptămâna ${saptamana} s-a închis <b>fără nicio cerere</b>. Nu e nimic de comandat. 🎉</p>`
    } else {
      // deno-lint-ignore no-explicit-any
      const peLoc = new Map<string, any[]>()
      for (const r of cumulat) { if (!peLoc.has(r.locatie)) peLoc.set(r.locatie, []); peLoc.get(r.locatie)!.push(r) }
      let corp = ''
      for (const [loc, randuri] of peLoc) {
        corp += `<h3 style="margin:14px 0 4px">📍 ${loc}</h3><table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;font-size:13px">` +
          `<tr style="background:#f0f0f0"><th>Articol</th><th>Cant.</th><th>UM</th><th>Cereri</th><th>Cerut de</th><th>Caută</th></tr>`
        for (const r of randuri) {
          corp += `<tr><td>${r.are_urgent ? '🔴 ' : ''}${r.articol}${r.din_text_liber ? ' <i>(text liber)</i>' : ''}</td>` +
            `<td align="right"><b>${r.cantitate_totala}</b></td><td>${r.um || 'buc'}</td><td align="center">${r.nr_cereri}</td>` +
            `<td>${(r.cerut_de || []).join(', ')}</td>` +
            `<td><a href="${linkFreshful(r.articol)}">🔍 Freshful</a></td></tr>`
        }
        corp += `</table>`
      }
      html = `<p>Salut!</p><p>S-a închis runda de <b>consumabile sediu/birou</b> din săptămâna ${saptamana}. Lista cumulată de comandat:</p>` + corp +
        `<p>Click pe 🔍 Freshful lângă fiecare articol → căutare directă în Freshful (livrează în Ploiești, factură pe firmă). O vezi și în aplicație: <a href="${APP}">Consumabile › Cumulat</a>.</p>`
    }
    const ok = await trimite([emailTinta], `📦 Consumabile sediu/birou — lista cumulată (săpt. ${saptamana})`, html)
    await sb.from('necesar_notif_log').insert({ runda_id: runda.id, profile_id: null, tip: 'inchidere', email: emailTinta, trimis: ok ? 'ok' : 'eroare', detalii: `${cumulat?.length || 0} pozitii` })
    return json({ ok: true, actiune, runda_id: runda.id, pozitii: cumulat?.length || 0, trimis: ok })
  }

  return json({ ok: false, error: 'necunoscut' }, 400)
})
