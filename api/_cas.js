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
export function rezervariActive(analiza, acumMs = Date.now()) {
  const taiat = analiza?.plansa?.taiat_la ?? null
  return Object.entries(analiza?.rezervari_zone?.zone || {})
    .filter(([, r]) => r && (r.taiat_la ?? null) === taiat && Date.parse(r.pana_la) > acumMs)
    .map(([cheie, r]) => ({ cheie, pana_la: r.pana_la }))
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
