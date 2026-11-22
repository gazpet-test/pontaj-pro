// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/contabilizare.js — INVARIANTUL DE CONTABILIZARE al rândurilor (review #1165 r1–r4; L12, L18, L19).
//
// Rundele r1–r4 au găsit de fiecare dată o altă cale prin care un rând cu conținut dispărea tăcut (foaie nerecunoscută lângă una
// validă, tabel după rândul 80, articole fără antet, articole DEASUPRA antetului, foaie AA fără antet, calificativ de antet în afara
// ferestrei, număr scris „+30”). În loc de încă un caz, un invariant verificat la FINAL, într-o singură funcție
// (verificaContabilizare) folosită de parseSituatieExcel ȘI de parseDevizModificare (prin devizParser.parseDevizExcel, sub opțiunea
// explicită { contabilizare: true }; calea catalogului rămâne identică cu main):
//   1. fiecare rând NE-GOL al fiecărei foi primește EXACT o clasă din CLASE_RAND (antet, index, titlu, sectiune, articol, os, diverse,
//      fara_miscare, total, ignorat — cu motiv explicit —, problema); rând fără clasă / cu două clase / clasă necunoscută / ignorat
//      fără motiv = problemă („invariant …”), nu excepție tăcută;
//   2. un rând care ARATĂ a articol (randCandidat: cod + UM; UM + număr + text; sau ≥ 2 numere + text — numerele inclusiv „+30”,
//      „1.234,5”, text numeric cu semn) și NU e într-o clasă care îl acoperă (CLASE_ACOPERA_CANDIDAT: a ajuns în linii / total /
//      fără mișcare / probleme) = problemă cu foaia și rândul → complet: false. Fără excepții: nici înaintea antetului, nici în
//      foile sărite, nici după total.
// eNumeric / numar: O SINGURĂ definiție a „celulă numerică” (semn + / −, separatori RO / EN, procente excluse explicit) și a
// valorii ei (parseNumar, helperul EXISTENT — L17 —, cu „+”-ul explicit acceptat).
// Rulează în browser și în Node (teste, tura de noapte). Fără BD, fără AI.
// ═══════════════════════════════════════════════════════════════════════════
import { parseNumar } from '../izoDocumenteLogica.js'
import { norm } from '../lib/diacritice.js'
import { eUmCunoscut } from './um.js'

/** text de antet normalizat: fără diacritice, litere mici, punctele și spațiile multiple → un spațiu */
export const textAntet = s => norm(s).replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
/** textul brut al unei celule: spațiile multiple → unul, fără spații la capete; null / undefined → '' */
export const text = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

// ── numere: o singură definiție ──
/** text numeric: semn opțional (+ sau −), cifre, grupuri separate de „.” sau „,” (RO: 1.234,5 / EN: 1,234.5 / „2.000” / „-12.5” / „+30”) */
export const RE_TEXT_NUMERIC = /^[+-]?\d+([.,]\d+)*$/
/** celula e numerică? număr finit, sau text numeric (RE_TEXT_NUMERIC — ancorat ^…$, deci procentele „12%” / „12 %”, exponenții „1e5”
 *  și unitățile lipite „30 m” NU trec; testul le enumeră explicit). Un text numeric cu 3+ grupuri („15.10.2026”) trece — e mai bine un
 *  candidat în plus decât un articol pierdut. */
export function eNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && RE_TEXT_NUMERIC.test(v.trim())
}
/** valoarea unei celule prin parseNumar (helper EXISTENT, L17): null = gol, NaN = text nenumeric. Semnul „+” explicit („+30”,
 *  suplimentările scrise în NR / AA) e acceptat aici, parseNumar nu-l cunoaște; restul (RO / EN, semnul „−”) rămâne al lui. */
export const numar = v => parseNumar(typeof v === 'string' ? v.replace(/^\s*\+/, '') : v)
/** „2.000” / „12,345” / „+2.000”: un singur fel de separator, doar grupuri de exact 3 cifre după el → mii sau zecimale? (L17: nu ghicim) */
export const RE_NUMAR_AMBIGUU = /^[+-]?\d{1,3}(?:(?:\.\d{3})+|(?:,\d{3})+)$/

// ── rândurile unei foi ──
/**
 * Rândurile unei foi, cu rândurile goale, citite DE LA A1 (găsit de testul-proprietate, r5): `!ref` al foii începe la prima celulă
 * folosită (ex. A2 / B3 când primele rânduri sunt goale), iar sheet_to_json numără de acolo → `rand` (indice + 1) ar fi decalat față
 * de rândul Excel și `!merges` (coordonate absolute) ar cădea pe rândurile greșite. Cu `range` de la (0, 0) indicele + 1 = rândul Excel.
 * (XLSX e modulul xlsx-js-style, importat dinamic de apelant.)
 */
export function randuriDeLaA1(XLSX, sheet) {
  if (!sheet || !sheet['!ref']) return [] // foaie complet goală (fără `!ref`): niciun rând
  const ref = XLSX.utils.decode_range(sheet['!ref'])
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: '', range: { s: { r: 0, c: 0 }, e: ref.e } })
}

// ── forma rândurilor ──
export const eRandGol = row => !row || row.every(c => c === '' || c == null)
/** rând „index de coloane” (0 1 2 3 … sau 1 2 3 …): doar întregi, cel puțin două, crescători cu 1 */
export function eRandIndex(row) {
  if (!row) return false
  const v = row.filter(c => c !== '' && c != null)
  if (v.length < 2) return false
  const n = v.map(c => (typeof c === 'number' ? c : /^\d+$/.test(String(c).trim()) ? Number(c) : NaN))
  return n.every((x, i) => Number.isInteger(x) && (i === 0 || x === n[i - 1] + 1))
}
/** rând cu cel puțin o celulă numerică (și care nu e rândul de indici) */
export const eRandDate = row => !eRandGol(row) && !eRandIndex(row) && row.some(c => c !== '' && c != null && eNumeric(c))

// Rând CANDIDAT de articol (review #1165 r3 / r4 / r5): detectat INDEPENDENT de orice antet —
//   (a) un cod plauzibil de articol (litere + cifră, ex. TSA01A1, B1; altă celulă decât UM-ul) + o UM din lista comună (UM_LISTA,
//       aceeași cu migrarea) — cu sau fără numere (un articol fără cantități e tot un articol);
//   (b) o UM din lista comună + cel puțin un număr + un text (denumirea) — articol fără cod;
//   (c) generic: cel puțin 2 celule numerice și cel puțin un text pe același rând (OS „lei” fără cod).
// Nu sunt candidate: rândul gol, rândul de indici, o etichetă cu o singură cifră („Valoare totală (lei) | 20”), text singur, numere
// fără text. Un fals pozitiv costă o privire a omului; un fals negativ ar pierde articole tăcut — alegem primul.
const RE_COD_PLAUZIBIL = /^[A-Za-z]{1,5}\d[A-Za-z0-9./-]*$/
export function randCandidat(row) {
  if (!row || eRandGol(row) || eRandIndex(row)) return null
  const celule = row.filter(c => c !== '' && c != null)
  const numere = celule.filter(eNumeric), texte = celule.filter(c => !eNumeric(c))
  if (texte.length === 0) return null
  const um = texte.find(c => eUmCunoscut(c))
  const cod = texte.find(c => c !== um && RE_COD_PLAUZIBIL.test(text(c)))
  const n = `${numere.length} ${numere.length === 1 ? 'număr' : 'numere'}`
  if (cod != null && um != null) return `cod „${text(cod)}”, UM „${text(um)}”, ${n}`
  if (um != null && numere.length >= 1 && texte.length >= 2) return `UM „${text(um)}”, ${n} și text „${text(texte.find(c => c !== um)).slice(0, 40)}”`
  if (numere.length >= 2) return `${n} și text „${text(texte[0]).slice(0, 40)}”`
  return null
}

const RE_OS = /organizare\s+(?:de\s+)?santier|^o\s?s$/
const RE_DIVERSE = /\bdiverse\b|neprevazut/
/** tipul rândului din denumire + cod: 'os' / 'diverse' / 'articol' (o singură definiție, folosită de situație, de devizul AA și de teste) */
export function tipRand(denumire, cod) {
  const d = textAntet(denumire), c = textAntet(cod)
  if (RE_OS.test(d) || RE_OS.test(c)) return 'os'
  if (RE_DIVERSE.test(d) || RE_DIVERSE.test(c)) return 'diverse'
  return 'articol'
}

// ── clasele ──
/** toate clasele pe care le poate primi un rând ne-gol */
export const CLASE_RAND = ['antet', 'index', 'titlu', 'sectiune', 'articol', 'os', 'diverse', 'fara_miscare', 'total', 'ignorat', 'problema']
/** clasele care ACOPERĂ un rând candidat de articol: a devenit linie (articol / os / diverse), e rândul de total, e un articol fără
 *  mișcare în perioadă (numărat și listat în fara_miscare_randuri) sau e deja în probleme. Orice altă clasă pe un rând candidat
 *  (antet, index, titlu, sectiune, ignorat) = rândul LIPSEȘTE din rezultat → problemă. */
export const CLASE_ACOPERA_CANDIDAT = new Set(['articol', 'os', 'diverse', 'fara_miscare', 'total', 'problema'])

/**
 * Invariantul de contabilizare pe o foaie.
 * @param {string} foaie numele foii
 * @param {Array<Array>} rows rândurile foii (sheet_to_json header:1, blankrows:true — indicele + 1 = rândul Excel)
 * @param {Array<{rand:number, clasa:string, motiv?:string}>} clase clasa dată de parser fiecărui rând (rand = de la 1)
 * @returns {{ probleme: Array<{foaie, rand, motiv, clasa?, candidat?}>, sumar: Object<string, number> }}
 *   probleme = încălcări (rând ne-gol fără clasă, două clase, clasă necunoscută, ignorat fără motiv, clasă pe rând gol) + rândurile
 *   candidate de articol neacoperite; sumar = câte rânduri pe fiecare clasă (pentru rezultat / UI / teste).
 */
export function verificaContabilizare(foaie, rows, clase) {
  const probleme = [], sumar = {}
  const peRand = new Map()
  for (const c of clase || []) {
    if (peRand.has(c.rand)) { probleme.push({ foaie, rand: c.rand, motiv: `invariant: rândul are două clase („${peRand.get(c.rand).clasa}” și „${c.clasa}”)` }); continue }
    peRand.set(c.rand, c)
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], rand = r + 1
    if (eRandGol(row)) { if (peRand.has(rand)) probleme.push({ foaie, rand, motiv: `invariant: clasă „${peRand.get(rand).clasa}” pe un rând gol` }); continue }
    const c = peRand.get(rand)
    if (!c) { probleme.push({ foaie, rand, motiv: 'invariant: rând ne-gol fără clasă (necontabilizat)', candidat: randCandidat(row) || undefined }); continue }
    if (!CLASE_RAND.includes(c.clasa)) { probleme.push({ foaie, rand, clasa: c.clasa, motiv: `invariant: clasă necunoscută „${c.clasa}”` }); continue }
    if (c.clasa === 'ignorat' && !c.motiv) probleme.push({ foaie, rand, clasa: c.clasa, motiv: 'invariant: rând ignorat fără motiv explicit' })
    sumar[c.clasa] = (sumar[c.clasa] || 0) + 1
    const candidat = randCandidat(row)
    if (candidat && !CLASE_ACOPERA_CANDIDAT.has(c.clasa)) {
      probleme.push({ foaie, rand, clasa: c.clasa, candidat, motiv: `rând de articol necontabilizat: arată a articol (${candidat}), dar a fost clasificat „${c.clasa}”${c.motiv ? ` (${c.motiv})` : ''} — LIPSEȘTE din rezultat` })
    }
  }
  for (const [rand, c] of peRand) if (rand < 1 || rand > rows.length) probleme.push({ foaie, rand, motiv: `invariant: clasă „${c.clasa}” pe un rând inexistent` })
  return { probleme, sumar }
}
