// ════════════════════════════════════════════════════════════════
// scenarii.js — transformări PURE ale snapshotului, doar pentru demonstrația prototipului.
// Nu citesc nimic, nu scriu nimic: iau snapshotul normalizat din fixture și îl „strică" controlat,
// ca să se vadă stările oneste (eroare, date vechi, date expirate, cursă între licitații).
// ════════════════════════════════════════════════════════════════
import { SURSE_OBLIGATORII, TABEL_SURSA } from './atentie.js'

export const LICITATIE_A = 103          // clona de audit (SANDBOX-V2-DOMNESTI)
export const LICITATIE_B = 9001         // licitație SINTETICĂ, fără date: prototipul nu citește alte licitații
export const OFFSET_CEAS = Object.freeze({ proaspat: 5 * 60e3, stale: 30 * 60e3, expirat: 3 * 3600e3 })
export const CEASURI = Object.freeze([
  { id: 'proaspat', eticheta: 'captura + 5 min (date proaspete)' },
  { id: 'stale', eticheta: 'captura + 30 min (date vechi)' },
  { id: 'expirat', eticheta: 'captura + 3 h (date expirate)' },
  { id: 'real', eticheta: 'ceasul real al browserului' },
])
export const SCENARII = Object.freeze([
  { id: 'normal', eticheta: 'Fixture 103 — normal', ceas: 'proaspat' },
  { id: 'eroare', eticheta: 'O sursă a dat eroare la citire', ceas: 'proaspat' },
  { id: 'stale', eticheta: 'Date vechi (30 min)', ceas: 'stale' },
  { id: 'expirat', eticheta: 'Date expirate (3 h)', ceas: 'expirat' },
  { id: 'cursa', eticheta: 'Licitație schimbată rapid A→B→A, răspunsul B întârziat', ceas: 'proaspat' },
])
export const SURSE_DE_STRICAT = SURSE_OBLIGATORII.filter(n => n !== 'documente_firma_valabilitate')
  .map(n => ({ id: n, eticheta: TABEL_SURSA[n] }))

// O sursă „a dat eroare": DATELE VECHI RĂMÂN ATAȘATE (ca în load() de azi) — construiesteAtentia trebuie să le ignore.
export function cuEroare(snapshot, sursa, mesaj = 'simulat: eroare la citire (timeout PostgREST)') {
  const s = snapshot.surse[sursa]
  return { ...snapshot, surse: { ...snapshot.surse, [sursa]: { ...(s || {}), stare: 'eroare', eroare: mesaj, date: s?.date ?? null } } }
}

// Răspunsul pentru licitația B: sintetic, fără date. Prototipul evaluează doar clona 103.
export function snapshotSintetic(licitatieId, capturat_la) {
  const surse = {}
  for (const n of SURSE_OBLIGATORII) surse[n] = { stare: 'lipsa', licitatie_id: licitatieId, citit_la: null,
    eroare: 'prototipul nu citește alte licitații decât clona 103', date: null }
  return { versiune_format: 1, licitatie_id: licitatieId, capturat_la, surse }
}

export function acumPentru(ceas, capturat_la, acumReal) {
  if (ceas === 'real') return acumReal
  return Date.parse(capturat_la) + (OFFSET_CEAS[ceas] ?? OFFSET_CEAS.proaspat)
}

export function snapshotScenariu(baza, scenariu, sursaEroare) {
  if (scenariu === 'eroare') return cuEroare(baza, sursaEroare || 'acoperire')
  return baza
}

// ── Încărcătorul simulat, cu GARDA DE CONCURENȚĂ (AS-IS F: load() fără request-id / abort) ──
// Fiecare cerere primește un număr. Cu garda activă: la cerere nouă ecranul se golește („Se încarcă…"), iar un răspuns
// care nu e al cererii CURENTE se aruncă (se scrie în jurnal). Fără gardă (comportamentul de azi): orice răspuns se aplică,
// chiar dacă a venit târziu pentru altă licitație — atunci a doua barieră e construiesteAtentia (SNAP:alta_licitatie).
export function creeazaIncarcator({ citeste, aplica, jurnal = () => {}, garda = () => true, programeaza = (f, ms) => setTimeout(f, ms), anuleaza = t => clearTimeout(t) }) {
  let curent = 0
  const timere = new Set()
  return {
    incarca(licitatieId, intarziereMs) {
      const id = ++curent
      jurnal({ tip: 'cerere', id, licitatieId, intarziereMs })
      if (garda()) aplica(null, licitatieId, id)
      const t = programeaza(() => {
        timere.delete(t)
        const snap = citeste(licitatieId)
        if (garda() && id !== curent) { jurnal({ tip: 'ignorat', id, licitatieId, curent }); return }
        jurnal({ tip: 'aplicat', id, licitatieId, curent })
        aplica(snap, licitatieId, id)
      }, intarziereMs)
      timere.add(t)
      return id
    },
    curent: () => curent,
    opreste() { for (const t of timere) anuleaza(t); timere.clear() },
  }
}
