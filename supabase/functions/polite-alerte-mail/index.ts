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

// ora din Romania (0–23): cronul ruleaza la 04:15 si 05:15 UTC, iar trimiterea pleaca doar la ora 7 locala (iarna si vara)
const oraRO = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const apelant = await cronSauOwner(req, sb)
  if (!apelant) return json({ ok: false, error: 'neautorizat' }, 401)
  // r3 (Jakarinos r2 P2-3): reconcilierea rezervarilor ramase (> 1 h -> „necunoscut”) la FIECARE apel, inaintea filtrului de ora / comutator
  const { data: reconciliate, error: erc } = await sb.rpc('fn_polite_alerte_reconciliaza', {})
  if (erc) console.error('reconciliere', erc.code)
  if (apelant === 'cron' && oraRO() !== 7) return json({ ok: true, skip: 'ora', reconciliate: erc ? null : reconciliate })
  const resend = Deno.env.get('RESEND_API_KEY')
  // fara cheie nu se rezerva nimic (altfel randurile ar ramane „rezervat” fara sa plece)
  if (!resend) return json({ ok: false, error: 'resend_neconfigurat' }, 500)

  // un singur jsonb {activ, zi, n, randuri}: nu e taiat de plafonul de randuri; n trebuie sa fie exact lungimea listei
  const { data: rez, error } = await sb.rpc('fn_polite_alerte_rezerva', {})
  if (error) { console.error('rezervare', error.code); return json({ ok: false, error: 'rezervare_indisponibila' }, 500) }
  const randuri = rez?.randuri
  if (!rez || !Array.isArray(randuri) || rez.n !== randuri.length) { console.error('rezervare incompleta'); return json({ ok: false, error: 'rezervare_incompleta' }, 500) }
  if (rez.activ !== true) return json({ ok: true, skip: 'oprit' })
  if (randuri.length === 0) return json({ ok: true, destinatari: 0, trimise: 0 })

  const zi = typeof rez.zi === 'string' ? rez.zi : ziRO()
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
    // r3 (Jakarinos r2 P2-4): marcarea in loturi de cel mult 500 de id-uri (limita RPC-ului), toate cu acelasi rezultat
    let marcate = 0, eroareMarcare = false
    for (let i = 0; i < ids.length; i += 500) {
      const lot = ids.slice(i, i + 500)
      const { data: n, error: em } = await sb.rpc('fn_polite_alerte_marcheaza', { p_ids: lot, p_stare: rezultat.stare, p_resend_id: resendId, p_eroare: rezultat.eroare })
      if (em) { eroareMarcare = true; console.error('marcare', em.code) } else marcate += Number(n) || 0
    }
    if (eroareMarcare || marcate !== ids.length) { contor.nemarcat++; console.error('marcare incompleta', marcate, ids.length) }
    contor[rezultat.stare as 'trimis' | 'eroare' | 'necunoscut']++
  }
  // „ok” doar daca toate rezultatele au fost marcate (altfel jurnalul nu reflecta trimiterea: se vede ca eroare in raspunsul cronului)
  return json({ ok: contor.nemarcat === 0, destinatari: grupe.length, ...contor, fara_adresa: randuri.filter((r: { stare: string }) => r.stare === 'fara_adresa').length }, contor.nemarcat ? 500 : 200)
})
