// ════════════════════════════════════════════════════════════════
// ofertareControale.js — controalele deterministe din dosarul Hoghilag (Sprint 3).
//
// Fiecare control e o funcție PURĂ peste date deja în ERP. Nu LLM, nu fuzzy: un verdict aici e
// reproductibil și explicabil, cu ambele surse și diferența. Regulile vin din greșeli REALE
// găsite de Jakarinos într-o ofertă CÂȘTIGĂTOARE (Hoghilag, 90 pct): că au trecut o dată nu
// înseamnă că trec și data viitoare.
// ════════════════════════════════════════════════════════════════

/**
 * H2 — conservarea cantităților. Regula (Răzvan, 13.09): la grafic NU există „baza memoriu / planșă".
 * Referința unică e LISTA DE CANTITĂȚI F3 (pe obiecte): pe ea punem banii, ea se decontează. Memoriu,
 * planșe sau C6 care diferă de F3 sunt diferențe care TREBUIAU rezolvate prin clarificare înainte de
 * grafic — se afișează ca rezervă, nu se aleg. Varianta B: suma pe F3; C6 e doar control (ΣF3 = C6).
 *
 * Toleranța e pentru ROTUNJIRI (5 m la 30 km = 0,02%), nu pentru compensări: la Hoghilag
 * -19 Prod / +18 Valchid dădeau -1 la total și tot era greșit.
 */
export const H2_TOLERANTA_RELATIVA = 0.001   // 0,1 %

const num = v => (v == null || v === '') ? null : Number(v)
const fmt = n => Math.round(n).toLocaleString('ro-RO')
const rel = (a, b) => a ? Math.abs(b - a) / a : (b ? Infinity : 0)

export function controlCantitati({ lista_f3_m, lista_c6_m, memoriu_m, plansa_m, grafic_fronturi_m }) {
  const f3 = num(lista_f3_m), gr = num(grafic_fronturi_m)
  const base = { k: 'cantitati', lista_f3_m: f3, grafic_m: gr, diferenta_m: null, neclarificate: [] }
  if (f3 == null) {
    const alt = [['memoriu', num(memoriu_m)], ['planșe', num(plansa_m)], ['C6', num(lista_c6_m)]].filter(([, v]) => v != null)
    return { ...base, stare: 'block',
      detalii: 'lipsește lista de cantități F3 în ERP — graficul nu are punct de decontat'
        + (alt.length ? ` (există doar ${alt.map(([n, v]) => `${n} ${fmt(v)} m`).join(', ')})` : '') }
  }
  // Surse informative care diferă de F3 peste toleranță: de rezolvat prin clarificare, nu de ales.
  const neclarificate = [['memoriu', num(memoriu_m)], ['planșe', num(plansa_m)], ['C6', num(lista_c6_m)]]
    .filter(([, v]) => v != null && rel(f3, v) > H2_TOLERANTA_RELATIVA)
    .map(([n, v]) => `${n} ${fmt(v)} m`)
  const notaClar = neclarificate.length ? ` — diferență nerezolvată prin clarificare: ${neclarificate.join(', ')} vs F3 ${fmt(f3)} m` : ''
  if (gr == null) return { ...base, neclarificate, stare: 'warn', detalii: 'graficul n-are fronturi definite — controlul nu se poate face' + notaClar }
  const dif = gr - f3, r = rel(f3, gr)
  if (r > H2_TOLERANTA_RELATIVA) return { ...base, neclarificate, diferenta_m: dif, stare: 'block',
    detalii: `F3 ${fmt(f3)} m vs ${fmt(gr)} m în fronturile graficului: ${dif > 0 ? '+' : ''}${fmt(dif)} m (${(r * 100).toFixed(1)} %) — graficul se face pe cantitățile de decontat` + notaClar }
  if (dif !== 0) return { ...base, neclarificate, diferenta_m: dif, stare: 'warn',
    detalii: `F3 ${fmt(f3)} m vs ${fmt(gr)} m în fronturi: ${dif > 0 ? '+' : ''}${fmt(dif)} m, sub 0,1 % — rotunjire, dar spune-o în ofertă` + notaClar }
  if (neclarificate.length) return { ...base, neclarificate, diferenta_m: 0, stare: 'warn', detalii: `${fmt(f3)} m în F3 și în grafic` + notaClar }
  return { ...base, neclarificate, diferenta_m: 0, stare: 'ok', detalii: `${fmt(f3)} m în F3 și în grafic` }
}
