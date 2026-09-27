// R4 (Copilot): scrierea `analiza` din /api/plansa-felii ca compare-and-set pe analiza->citire_ai->>rev.
// Extras din plansa-felii.js ca să fie testabil cu un client simulat (scripts/test-cas-felii.mjs).
// La conflict (o rundă de citire a scris între timp) se recitește documentul și se RECONSTRUIEȘTE peste ce e
// salvat acum (construieste primește analiza proaspătă), de maximum INCERCARI_CAS ori; apoi 409 explicit.
// Nimic din ce e deja salvat nu se pierde: la epuizare nu se scrie nimic.
export const INCERCARI_CAS = 3
export const CALE_REV = 'analiza->citire_ai->>rev'

// R4 (runda 3): rezervările ACTIVE de zone (citire AI în curs în alt tab) pe tăierea CURENTĂ — scrise de
// ofertare-plansa-citeste în analiza.rezervari_zone = {rev, zone: {cheie: {rulare, taiat_la, de_la, pana_la}}}.
// O retăiere acum ar schimba zonele => citirea în curs ar pica cu 409 DUPĂ ce a plătit; /api/plansa-felii refuză.
// Rezervările de pe altă tăiere sau expirate (tab închis) nu contează.
// Plafon (verificator R4, runda 1): activă DOAR dacă now < pana_la <= now + REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS —
// o rezervare coruptă/forjată (pana_la = 2099) nu blochează retăierea la nesfârșit. Constante IDENTICE cu
// supabase/functions/ofertare-plansa-citeste/concurenta.ts (verificat în scripts/test-cas-felii.mjs).
export const REZERVARE_EXPIRA_MS = 7 * 60 * 1000
export const TOLERANTA_CEAS_MS = 60 * 1000
export function rezervariActive(analiza, acumMs = Date.now()) {
  const taiat = analiza?.plansa?.taiat_la ?? null
  return Object.entries(analiza?.rezervari_zone?.zone || {})
    .filter(([, r]) => {
      if (!r || (r.taiat_la ?? null) !== taiat) return false
      const t = Date.parse(r.pana_la)
      return Number.isFinite(t) && t > acumMs && t <= acumMs + REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS
    })
    .map(([cheie, r]) => ({ cheie, pana_la: r.pana_la }))
}

// Răspunsul 409 „planșa e în citire în alt tab” (null = se poate retăia).
export function refuzInLucru(analiza, acumMs = Date.now()) {
  const ocupate = rezervariActive(analiza, acumMs)
  if (!ocupate.length) return null
  const pana = ocupate.map((o) => o.pana_la).sort().pop()
  const ora = new Date(pana).toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' })
  return { status: 409, body: { error: `Planșa e în citire în alt tab (${ocupate.length} zone rezervate, până la ${ora}) — retăierea ar arunca ` +
    'citirea în curs. Lasă celălalt tab să termine; dacă a fost închis, rezervarea expiră singură.', in_lucru: ocupate.map((o) => o.cheie), rezervat_pana_la: pana } }
}

// Verificare pe starea PROASPĂTĂ, chiar înaintea unei scrieri/ștergeri care invalidează citirea (ștergerea feliilor,
// scrierile „necitibilă”). Fail-closed (verificator R4, runda 1): dacă re-citirea dă eroare, NU se retaie pe nesigure.
export async function verificaRetaiere(supa, docId, acumMs = Date.now()) {
  let data = null, error = null
  try { ({ data, error } = await supa.from('ofertare_documente_atribuire').select('analiza').eq('id', docId).maybeSingle()) }
  catch (e) { error = e }
  if (error) return { status: 503, body: { error: `Nu am putut verifica dacă planșa e în citire în alt tab (${String(error?.message || error).slice(0, 120)}) — ` +
    'nu retai pe nesigure; nimic nu s-a șters. Reîncearcă.' } }
  if (!data) return { status: 404, body: { error: 'document inexistent' } }
  return refuzInLucru(data.analiza, acumMs)
}

export async function scrieAnalizaCAS(supa, docId, docInitial, construieste, extra = {}) {
  let d = docInitial
  for (let i = 0; i < INCERCARI_CAS; i++) {
    const rev = d?.analiza?.citire_ai?.rev ?? null
    let q = supa.from('ofertare_documente_atribuire')
      .update({ analiza: construieste(d?.analiza || {}), analiza_la: new Date().toISOString(), ...extra }).eq('id', docId)
    q = rev == null ? q.is(CALE_REV, null) : q.eq(CALE_REV, String(rev))
    const { data, error } = await q.select('id')
    if (error) return { ok: false, status: 500, error: error.message, incercari: i + 1 }
    if ((data || []).length === 1) return { ok: true, incercari: i + 1 }
    const { data: proaspat } = await supa.from('ofertare_documente_atribuire').select('id, analiza').eq('id', docId).maybeSingle()
    if (!proaspat) return { ok: false, status: 404, error: 'document inexistent', incercari: i + 1 }
    d = proaspat
  }
  return { ok: false, status: 409, conflict: true, incercari: INCERCARI_CAS,
    error: `Planșa e scrisă simultan de o citire în curs — ${INCERCARI_CAS} încercări fără succes; nimic nu s-a suprascris. Reîncearcă după ce se termină.` }
}
