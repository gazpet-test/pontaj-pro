// Afișarea cadastrului din importul Transgaz (audit D2). Valoarea brută TGZ e compusă cu „#”:
// „<nr. cadastral>#<parcelă/topo>#<rest>” (vezi importTgz.js, cadastruGol / cadastruSuspect) — „52#”, „#44#”, „50029#30#”, „##”.
// „#” = separator între subcâmpuri, iar un subcâmp gol = informație lipsă. Pe ecran: subcâmpurile nevide unite cu „ / ”,
// „—” dacă nu rămâne nimic. Valoarea brută NU se schimbă în BD / cheie / documente — rămâne în tooltip (titluCadastru).
export const FARA_CADASTRU = '—'

/** afiseazaCadastru('50029#30#') → '50029 / 30'; '##' → '—'; '123/4' → '123/4'; null → '—'. Funcție pură. */
export function afiseazaCadastru(v) {
  if (v === null || v === undefined) return FARA_CADASTRU
  const parti = String(v).split('#').map(x => x.trim()).filter(Boolean)
  return parti.length ? parti.join(' / ') : FARA_CADASTRU
}

/** Tooltip: valoarea brută, doar când diferă de ce se afișează (altfel undefined — fără title redundant). */
export function titluCadastru(v) {
  if (v === null || v === undefined || String(v) === '') return undefined
  const brut = String(v)
  return brut === afiseazaCadastru(v) ? undefined : `Valoare TGZ: ${brut}`
}
