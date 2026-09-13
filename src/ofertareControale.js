// ════════════════════════════════════════════════════════════════
// ofertareControale.js — controalele deterministe din dosarul Hoghilag (Sprint 3).
//
// Fiecare control e o funcție PURĂ peste date deja în ERP. Nu LLM, nu fuzzy: un verdict aici e
// reproductibil și explicabil, cu ambele surse și diferența. Regulile vin din greșeli REALE
// găsite de Jakarinos într-o ofertă CÂȘTIGĂTOARE (Hoghilag, 90 pct): că au trecut o dată nu
// înseamnă că trec și data viitoare.
// ════════════════════════════════════════════════════════════════

/**
 * H2 — conservarea cantităților: totalul rețelei din cantități (baza asumată) vs suma fronturilor
 * din grafic. Aceeași cantitate trebuie să fie aceeași în toate reprezentările.
 *
 * Toleranța e pentru ROTUNJIRI (5 m la 30 km = 0,02%), nu pentru compensări: la Hoghilag
 * -19 Prod / +18 Valchid dădeau -1 la total și tot era greșit. De aceea totalul e doar primul
 * control; defalcarea pe obiect se arată alături și se mapează manual (H9: fuzzy ≠ verdict).
 */
export const H2_TOLERANTA_RELATIVA = 0.001   // 0,1 %

export function controlCantitati({ cantitati_baza, cantitati_retea_m, grafic_fronturi_m }) {
  const src = cantitati_retea_m == null ? null : Number(cantitati_retea_m)
  const gr  = grafic_fronturi_m == null ? null : Number(grafic_fronturi_m)
  if (src == null || gr == null) {
    return { stare: 'warn', k: 'cantitati',
      detalii: src == null ? 'nicio cantitate de rețea (um = m, conducte) în Cantități — controlul nu se poate face'
                           : 'graficul n-are fronturi definite — controlul nu se poate face',
      sursa_m: src, grafic_m: gr, diferenta_m: null }
  }
  if (!cantitati_baza) {
    return { stare: 'block', k: 'cantitati',
      detalii: `baza cantităților nu e asumată (memoriu / planșă) — graficul nu poate fi reconciliat cu nimic`,
      sursa_m: src, grafic_m: gr, diferenta_m: gr - src }
  }
  const dif = gr - src
  const rel = src ? Math.abs(dif) / src : (dif ? Infinity : 0)
  const fmt = n => Math.round(n).toLocaleString('ro-RO')
  if (dif === 0) return { stare: 'ok', k: 'cantitati', detalii: `${fmt(src)} m în ambele (${cantitati_baza})`, sursa_m: src, grafic_m: gr, diferenta_m: 0 }
  if (rel <= H2_TOLERANTA_RELATIVA) return { stare: 'warn', k: 'cantitati',
    detalii: `${fmt(src)} m (${cantitati_baza}) vs ${fmt(gr)} m în fronturi: ${dif > 0 ? '+' : ''}${fmt(dif)} m, sub 0,1 % — rotunjire, dar spune-o în ofertă`,
    sursa_m: src, grafic_m: gr, diferenta_m: dif }
  return { stare: 'block', k: 'cantitati',
    detalii: `${fmt(src)} m (${cantitati_baza}) vs ${fmt(gr)} m în fronturile graficului: ${dif > 0 ? '+' : ''}${fmt(dif)} m (${(rel * 100).toFixed(1)} %) — aceeași lucrare nu poate avea două lungimi`,
    sursa_m: src, grafic_m: gr, diferenta_m: dif }
}
