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

/**
 * H4 — garanția e un OBIECT (luni + momentul de start), nu o propoziție. La Hoghilag momentul
 * (PIF vs recepție) diferea între formular și capitol. Fapte (block): oferit < cerut; moment diferit
 * de cel cerut; capitole care pomenesc alt număr de luni decât cel oferit. Lipsa obiectului e warn
 * doar când nicio cerință nu vorbește de garanția lucrărilor; altfel e block: s-a cerut, nu s-a asumat.
 */
export const MOMENTE_GARANTIE = {
  pif: 'punerea în funcțiune', receptie_terminare: 'recepția la terminarea lucrărilor',
  receptie_finala: 'recepția finală', livrare: 'livrare', semnare_contract: 'semnarea contractului',
}
export function controlGarantie({ garantie_cerut_luni, garantie_cerut_moment, garantie_oferit_luni, garantie_oferit_moment,
                                  garantie_confirmata, garantie_luni_in_capitole, garantie_cerinte_lucrari }) {
  const cl = num(garantie_cerut_luni), ol = num(garantie_oferit_luni)
  const cm = garantie_cerut_moment || null, om = garantie_oferit_moment || null
  const inCap = (garantie_luni_in_capitole || []).map(Number).filter(n => !Number.isNaN(n))
  const nCer = Number(garantie_cerinte_lucrari) || 0
  const base = { k: 'garantie', cerut_luni: cl, oferit_luni: ol, cerut_moment: cm, oferit_moment: om, luni_in_capitole: inCap }
  const mom = m => MOMENTE_GARANTIE[m] || m
  if (ol == null || !om) {
    return { ...base, stare: nCer > 0 ? 'block' : 'warn',
      detalii: nCer > 0
        ? `${nCer} cerințe vorbesc de garanția lucrărilor, dar garanția oferită (luni + momentul de start) nu e asumată în ERP`
        : 'garanția oferită nu e asumată (luni + momentul de start) — nicio cerință găsită automat, verifică fișa de date' }
  }
  const probleme = []
  if (cl != null && ol < cl) probleme.push(`oferim ${ol} luni, se cer minim ${cl}`)
  if (cm && om !== cm) probleme.push(`momentul de start diferă: oferit „${mom(om)}", cerut „${mom(cm)}"`)
  const straine = [...new Set(inCap.filter(n => n !== ol))]
  if (straine.length) probleme.push(`capitolele pomenesc ${straine.join(', ')} luni, nu ${ol}`)
  if (probleme.length) return { ...base, stare: 'block', detalii: probleme.join(' · ') }
  const rez = []
  if (cl == null || !cm) rez.push('cerința (luni + moment) nu e notată — nu se poate confrunta cu ce oferim')
  if (!garantie_confirmata) rez.push('neconfirmată de un om')
  const text = `${ol} luni de la ${mom(om)}` + (cl != null ? ` (cerut minim ${cl} de la ${mom(cm)})` : '')
  return { ...base, stare: rez.length ? 'warn' : 'ok', detalii: text + (rez.length ? ' — ' + rez.join('; ') : '') }
}

/**
 * H5 — referințele din text trimit la piese care există în dosar. „Vezi Anexa 7" cu Anexa 7 lipsă
 * din opis e o greșeală de fapt, nu de stil: block. Potrivirea e pe (tip, număr) normalizat, cu
 * cifre romane acceptate, ca „Cap. III" să fie același lucru cu „capitolul 3".
 */
const ROMAN = { i:1, v:5, x:10, l:50, c:100 }
function romanToInt(r) {
  let n = 0
  for (let i = 0; i < r.length; i++) { const a = ROMAN[r[i]], b = ROMAN[r[i + 1]]; n += b && b > a ? -a : a }
  return n
}
export function normalizeazaRef(t = '') {
  const m = String(t).toLowerCase().match(/^\s*(anex|formular|cap|plan)[a-zăș.]*\s*(?:nr\.?\s*)?([0-9]+[a-z]?|[ivxlc]+)\b/)
  if (!m) return null
  const tip = { anex: 'anexa', formular: 'formular', cap: 'cap', plan: 'plansa' }[m[1]]
  const nr = /^[0-9]/.test(m[2]) ? m[2] : String(romanToInt(m[2]))
  return `${tip}:${nr}`
}
export function controlAnexe({ anexe_referite, anexe_existente }) {
  const referite = [...new Set((anexe_referite || []).map(normalizeazaRef).filter(Boolean))]
  const existente = new Set((anexe_existente || []).map(normalizeazaRef).filter(Boolean))
  const lipsa = referite.filter(r => !existente.has(r))
  const arata = r => { const [t, n] = r.split(':'); return ({ anexa: 'Anexa', formular: 'Formularul', cap: 'cap.', plansa: 'planșa' })[t] + ' ' + n }
  if (!referite.length) return { k: 'anexe', stare: 'ok', detalii: 'capitolele nu trimit la nicio anexă / formular / capitol', lipsa: [] }
  if (lipsa.length) return { k: 'anexe', stare: 'block', lipsa,
    detalii: `${lipsa.length} din ${referite.length} referințe trimit la piese care nu-s în cuprins: ${lipsa.map(arata).join(', ')} — adaugă-le sau scoate trimiterea` }
  return { k: 'anexe', stare: 'ok', lipsa: [], detalii: `${referite.length} referințe, toate cu piesa în cuprins` }
}

/**
 * H1 — identitatea lucrării. Greșeala reală: un capitol copiat de la altă ofertă, cu numele altei
 * localități rămas în text. View-ul dă deja jetoanele STRĂINE găsite în capitolele licitației
 * (nume proprii din obiectul/autoritatea altor licitații, care nu-s și ale ei). Un singur asemenea
 * nume e block: nu e chestiune de stil, e altă lucrare scrisă în propunerea noastră.
 */
export function controlIdentitate({ identitate_straine }) {
  const straine = [...new Set((identitate_straine || []).filter(Boolean))]
  if (!straine.length) return { k: 'identitate', stare: 'ok', straine: [], detalii: 'capitolele nu pomenesc nicio localitate sau entitate din altă licitație' }
  return { k: 'identitate', stare: 'block', straine,
    detalii: `capitolele pomenesc ${straine.join(', ')} — nume din alte licitații ale noastre, semn de text copiat; verifică și înlocuiește` }
}
