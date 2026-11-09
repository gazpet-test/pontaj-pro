// polite-alerte-mail — alertele de expirare a politelor CAR / GBE / GPL / avans, pe mail (Polite 20261205a, etapa 1).
// Pornit de cronul polite_alerte_zilnic (05:15 UTC) cu x-intern-secret din Vault, sau de owner-ul logat (cronSauOwner): verify_jwt NU
// ajunge (cheia anon e un JWT valid). NU citeste continut extern; destinatarii vin DOAR din BD (polite_alerte_destinatari + conturile ERP
// ale sefului de santier / MP-ului proiectului), doar @gazpet.ro (CHECK in BD), niciodata din documente.
// Pasii: fn_polite_alerte_rezerva (comutatorul OPRIT => nimic; rezerva unica pe polita + prag + expirare + destinatar, pune notificarile in
// aplicatie) -> un mail pe destinatar (Resend, Idempotency-Key) -> fn_polite_alerte_marcheaza: trimis / eroare (4xx) / necunoscut
// (timeout, 5xx, retea: fara retrimitere automata, L05 — se vede in Administrator -> Alerte polite).
// Raspunsul (pastrat de pg_net) are doar contoare: fara adrese, fara textul erorii furnizorului.
// Secrete folosite (doar nume): RESEND_API_KEY (Edge Secrets, existent), SUPABASE_SERVICE_ROLE_KEY, INTERN_EDGE_SECRET (Vault, prin poartaIntern).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'
import { cheieIdempotenta, grupeazaPeDestinatar, mailPolite, stareDupaTrimitere } from '../_shared/polite.mjs'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const APP = 'https://pontaj-pro-sooty.vercel.app'
const ziRO = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date())

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await cronSauOwner(req, sb))) return json({ ok: false, error: 'neautorizat' }, 401)
  const resend = Deno.env.get('RESEND_API_KEY')
  // fara cheie nu se rezerva nimic (altfel randurile ar ramane „rezervat” fara sa plece)
  if (!resend) return json({ ok: false, error: 'resend_neconfigurat' }, 500)

  const { data: randuri, error } = await sb.rpc('fn_polite_alerte_rezerva', {})
  if (error) { console.error('rezervare', error.code); return json({ ok: false, error: 'rezervare_indisponibila' }, 500) }
  if (!Array.isArray(randuri) || randuri.length === 0) return json({ ok: true, destinatari: 0, trimise: 0 })

  const zi = ziRO()
  const grupe = grupeazaPeDestinatar(randuri)
  const contor = { trimis: 0, eroare: 0, necunoscut: 0, nemarcat: 0 }
  for (const g of grupe) {
    const ids = g.randuri.map((r: { id: number }) => Number(r.id))
    const { subiect, html } = mailPolite({ randuri: g.randuri, faraAdresa: g.faraAdresa, app: APP })
    let rezultat: { stare: string; eroare: string | null }, resendId: string | null = null
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json', 'Idempotency-Key': await cheieIdempotenta(zi, ids) },
        body: JSON.stringify({ from: FROM, to: [g.email], subject: subiect, html }),
      })
      const j = await r.json().catch(() => ({}))
      rezultat = stareDupaTrimitere({ ok: r.ok, status: r.status })
      if (r.ok && typeof j?.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(j.id)) resendId = j.id
      if (!r.ok) console.error('resend', r.status)
    } catch (_) {
      rezultat = stareDupaTrimitere({ eroareRetea: true })
    }
    const { data: n, error: em } = await sb.rpc('fn_polite_alerte_marcheaza', { p_ids: ids, p_stare: rezultat.stare, p_resend_id: resendId, p_eroare: rezultat.eroare })
    if (em || n !== ids.length) { contor.nemarcat++; console.error('marcare', em?.code ?? n) }
    contor[rezultat.stare as 'trimis' | 'eroare' | 'necunoscut']++
  }
  return json({ ok: true, destinatari: grupe.length, ...contor, fara_adresa: randuri.filter((r: { stare: string }) => r.stare === 'fara_adresa').length })
})
