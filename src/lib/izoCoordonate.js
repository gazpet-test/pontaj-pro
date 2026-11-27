// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — coordonatele sudurilor (BULETINE_NDT_SPEC §16, D16)
// ════════════════════════════════════════════════════════════════════════
// Logica pură pentru fișierul de coordonate încărcat de MP pe tronson (text, câte o sudură pe rând: `cod X Y Z`)
// și pentru lanțul de suduri din pachetele de lansare (amonte / aval, peste granița dintre pachete).
// Fără BD, fără React. Nimic nu se pierde tăcut (L12): orice rând ciudat primește o stare și un motiv;
// nimic nu se aplică singur: propunerile de cod sunt doar propuneri, cu distanța, pentru om.
//
// Stările unui rând din fișier:
//   ok          — cod recunoscut, 3 numere valide, cheie unică (sau prima dintre repetări identice)
//   repetata    — aceeași cheie, aceleași coordonate ca un rând anterior (a doua apariție și următoarele)
//   dublura     — aceeași cheie cu coordonate DIFERITE: toate rândurile cheii, omul alege
//   nesigur     — cod cu „?” sau în alt format (T12S88?1, T12S12??, T12S143.1, doar un număr): coordonatele sunt bune,
//                 codul nu → propuneCoduri() caută sudura potrivită după poziție
//   nepotrivit  — cod valid, dar de pe alt tronson decât cel încărcat
//   ilizibil    — număr greșit de câmpuri sau un număr nevalid
//
// Unitățile: coordonatele și lungimile în metri (Stereo 70 / lungime_m din pachet).

import { normalizeazaSudura, cheieSudura, formatSudura, tronsonNr } from './izoSudura.js'
import { parseNumar } from '../izoDocumenteLogica.js'

export const STARI_COORDONATE = ['ok', 'repetata', 'dublura', 'nesigur', 'nepotrivit', 'ilizibil']

// Pragul de abatere distanță din coordonate vs lungimea elementului (§16): max(0,5 m, 5%)
export const ABATERE_MINIMA_M = 0.5
export const ABATERE_PROCENT = 0.05

const esteNr = x => typeof x === 'number' && Number.isFinite(x)
const BOM = 0xFEFF
// câmpurile unui rând: doar spațiu și tab între ele (L13: nu \s, care ar înghiți și sfârșitul de rând)
const RE_SEPARATOR_CAMPURI = /[ \t]+/
// un număr de coordonată: semn opțional, cifre, zecimale cu punct sau virgulă (ancorat, L13)
const RE_NUMAR_COORD = /^-?\d+(?:[.,]\d+)?$/
// un cod scris doar din cifre e un număr de punct topografic, nu un cod de sudură
const RE_DOAR_CIFRE = /^\d+$/

function numarCoordonata(s) {
  if (!RE_NUMAR_COORD.test(s)) return NaN
  return parseNumar(s)
}

const aceleasiCoordonate = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z
const text = v => (v == null ? '' : String(v).trim())

/**
 * Citește fișierul de coordonate al unui tronson.
 * @param {string} text  conținutul fișierului
 * @param {string|number} tronsonCtx  tronsonul pe care se încarcă (12, 'T12', 'TR12')
 * @returns {Array<{linie:number, codRaw:string, x:number|null, y:number|null, z:number|null,
 *                  stare:string, cheie:string|null, motiv:string|null, canon:string|null, refacuta:boolean}>}
 *   Rândurile goale nu sunt date și nu apar; orice alt rând apare exact o dată.
 */
export function parseazaCoordonate(text, tronsonCtx) {
  const tCtx = tronsonNr(tronsonCtx)
  if (tCtx === null) throw new Error('Tronsonul pe care se încarcă coordonatele e obligatoriu')
  let s = text == null ? '' : String(text)
  if (s.charCodeAt(0) === BOM) s = s.slice(1)
  const linii = s.split(/\r\n|\r|\n/)
  const randuri = []
  linii.forEach((brut, i) => {
    const t = brut.trim()
    if (!t) return
    const campuri = t.split(RE_SEPARATOR_CAMPURI)
    const r = { linie: i + 1, codRaw: campuri[0], x: null, y: null, z: null, stare: 'ilizibil', cheie: null, motiv: null, canon: null, refacuta: false }
    randuri.push(r)
    if (campuri.length !== 4) { r.motiv = `campuri_${campuri.length}`; return }
    const [x, y, z] = campuri.slice(1).map(numarCoordonata)
    if (![x, y, z].every(esteNr)) { r.motiv = 'numar'; return }
    r.x = x; r.y = y; r.z = z
    // codul: coordonatele sunt bune, deci rândul nu e ilizibil; un cod pe care nu-l recunoaștem e „nesigur”
    if (r.codRaw.includes('?')) { r.stare = 'nesigur'; r.motiv = 'semn_intrebare'; return }
    if (RE_DOAR_CIFRE.test(r.codRaw)) { r.stare = 'nesigur'; r.motiv = 'doar_numar'; return }
    const n = normalizeazaSudura(r.codRaw, { tronson: tCtx, mod: 'legacy' })
    if (n.stare !== 'ok') { r.stare = 'nesigur'; r.motiv = `cod_${n.motiv || n.stare}`; return }
    r.cheie = cheieSudura(n)
    r.canon = n.canon
    r.refacuta = n.refacuta
    if (n.altTronson) { r.stare = 'nepotrivit'; r.motiv = `tronson_${n.tronson}`; return }
    r.stare = 'ok'
  })
  // dublurile: pe cheie, doar între rândurile cu cod și coordonate valide
  const peCheie = new Map()
  for (const r of randuri) {
    if (r.stare !== 'ok') continue
    if (!peCheie.has(r.cheie)) peCheie.set(r.cheie, [])
    peCheie.get(r.cheie).push(r)
  }
  for (const grup of peCheie.values()) {
    if (grup.length < 2) continue
    const diferite = grup.some(r => !aceleasiCoordonate(r, grup[0]))
    grup.forEach((r, k) => {
      if (diferite) { r.stare = 'dublura'; r.motiv = `coordonate_diferite_${grup.length}_randuri` }
      else if (k > 0) { r.stare = 'repetata'; r.motiv = `repeta_linia_${grup[0].linie}` }
    })
  }
  return randuri
}

const distanta3d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const areCoordonate = p => !!p && esteNr(p.x) && esteNr(p.y) && esteNr(p.z)

// Lungimea dintre două suduri vecine: un element sau o listă de elemente (lungimile se adună).
// null = necunoscută (element lipsă sau fără lungime); listă goală = nicio piesă între suduri.
function lungimeIntre(el) {
  const lista = Array.isArray(el) ? el : el == null ? null : [el]
  if (!lista) return { lungime: null, motiv: 'fara_element' }
  if (!lista.length) return { lungime: null, motiv: 'fara_element_intre' }
  let suma = 0
  for (const e of lista) {
    const l = parseNumar(e?.lungime_m ?? e?.lungime)
    if (!esteNr(l)) return { lungime: null, motiv: 'fara_lungime' }
    suma += l
  }
  return { lungime: suma, motiv: null }
}

const pragAbatere = lungime => Math.max(ABATERE_MINIMA_M, ABATERE_PROCENT * lungime)

/**
 * Distanța 3D între sudurile vecine vs lungimea elementului dintre ele.
 * @param {Array<{cheie:string, x?:number, y?:number, z?:number}>} punctePeOrdine  sudurile în ordinea pachetului (fără coordonate = x null)
 * @param {Array<object|object[]>} elemente  elemente[i] = elementul (sau elementele) dintre punctePeOrdine[i] și [i+1], cu lungime_m
 * @returns {{verificate:number, avertismente:object[], neverificate:object[]}}
 *   avertisment = abatere > max(0,5 m, 5%), cu ambele valori; neverificate = perechile fără coordonate / fără lungime.
 */
export function verificaDistante(punctePeOrdine = [], elemente = []) {
  const avertismente = [], neverificate = []
  let verificate = 0
  if (elemente.length !== Math.max(0, punctePeOrdine.length - 1)) {
    neverificate.push({ de: null, pana: null, motiv: `elemente_${elemente.length}_pentru_${punctePeOrdine.length}_suduri` })
  }
  for (let i = 0; i + 1 < punctePeOrdine.length; i++) {
    const a = punctePeOrdine[i], b = punctePeOrdine[i + 1]
    const pereche = { de: a?.cheie ?? null, pana: b?.cheie ?? null }
    if (!areCoordonate(a) || !areCoordonate(b)) { neverificate.push({ ...pereche, motiv: 'fara_coordonate' }); continue }
    if (i >= elemente.length) { neverificate.push({ ...pereche, motiv: 'fara_element' }); continue }
    const { lungime, motiv } = lungimeIntre(elemente[i])
    if (lungime === null) { neverificate.push({ ...pereche, motiv }); continue }
    verificate++
    const distanta = distanta3d(a, b)
    const abatere = Math.abs(distanta - lungime)
    if (abatere > pragAbatere(lungime)) avertismente.push({ ...pereche, distanta, lungime, abatere, prag: pragAbatere(lungime) })
  }
  return { verificate, avertismente, neverificate }
}

// Poziția estimată a fiecărei suduri fără coordonate: din vecinii cu coordonate și lungimile dintre ei.
// Între doi vecini cu coordonate: interpolare pe lungimea cumulată. La capăt: prelungire pe direcția
// ultimilor doi vecini cu coordonate. Orice lungime lipsă pe drum = fără estimare (nu se ghicește).
function estimeazaPozitii(punctePeOrdine, elemente) {
  const n = punctePeOrdine.length
  // s[i] = lungimea cumulată până la sudura i; null de la prima lungime necunoscută (pe segmentul acela)
  const pas = []
  for (let i = 0; i + 1 < n; i++) pas.push(i < elemente.length ? lungimeIntre(elemente[i]).lungime : null)
  const distLant = (i, j) => { // i < j
    let d = 0
    for (let k = i; k < j; k++) { if (pas[k] === null) return null; d += pas[k] }
    return d
  }
  const cuCoord = []
  punctePeOrdine.forEach((p, i) => { if (areCoordonate(p)) cuCoord.push(i) })
  const est = new Map()
  punctePeOrdine.forEach((p, k) => {
    if (areCoordonate(p) || !p?.cheie) return
    const ant = cuCoord.filter(i => i < k), urm = cuCoord.filter(i => i > k)
    const a = ant[ant.length - 1], b = urm[0]
    if (a !== undefined && b !== undefined) {
      const dak = distLant(a, k), dab = distLant(a, b)
      if (dak === null || dab === null || dab <= 0) return
      const f = dak / dab, A = punctePeOrdine[a], B = punctePeOrdine[b]
      est.set(p.cheie, { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, z: A.z + (B.z - A.z) * f, metoda: 'interpolare' })
      return
    }
    // la capăt: direcția din ultimii doi vecini cu coordonate de pe aceeași parte
    const [i1, i0] = a !== undefined ? [a, ant[ant.length - 2]] : [b, urm[1]]
    if (i1 === undefined || i0 === undefined) return
    const P1 = punctePeOrdine[i1], P0 = punctePeOrdine[i0]
    const d10 = distanta3d(P0, P1)
    const dk = a !== undefined ? distLant(i1, k) : distLant(k, i1)
    if (!(d10 > 0) || dk === null) return
    const u = { x: (P1.x - P0.x) / d10, y: (P1.y - P0.y) / d10, z: (P1.z - P0.z) / d10 }
    est.set(p.cheie, { x: P1.x + u.x * dk, y: P1.y + u.y * dk, z: P1.z + u.z * dk, metoda: 'prelungire' })
  })
  return est
}

/**
 * Propune codul pentru rândurile „nesigur”: sudura fără coordonate a cărei poziție estimată e cea mai apropiată.
 * Doar propunere, cu distanța — niciodată aplicare.
 * @param {object[]} nesigure  rânduri din parseazaCoordonate cu stare 'nesigur' (au x, y, z)
 * @param {Array<string|{cheie:string}>} suduriFaraCoordonate  candidații (din pachete, fără coordonate)
 * @param {{punctePeOrdine:object[], elemente:object[]}} puncte  același lanț ca la verificaDistante
 * @returns {{propuneri:object[], neestimate:string[]}}
 *   propunere: { linie, codRaw, cheie, distanta, metoda, urmatoarea:{cheie,distanta}|null, conflict }
 *   cheie null = nicio sudură candidat cu poziție estimabilă. conflict = aceeași sudură propusă pentru mai multe rânduri.
 */
export function propuneCoduri(nesigure = [], suduriFaraCoordonate = [], puncte = {}) {
  const { punctePeOrdine = [], elemente = [] } = puncte
  const est = estimeazaPozitii(punctePeOrdine, elemente)
  const candidati = [...new Set(suduriFaraCoordonate.map(s => (typeof s === 'string' ? s : s?.cheie)).filter(Boolean))]
  const neestimate = candidati.filter(c => !est.has(c))
  const propuneri = nesigure.map(r => {
    const baza = { linie: r.linie, codRaw: r.codRaw, cheie: null, distanta: null, metoda: null, urmatoarea: null, conflict: false }
    if (!areCoordonate(r)) return baza
    const ordonate = candidati.filter(c => est.has(c))
      .map(c => ({ cheie: c, distanta: distanta3d(r, est.get(c)), metoda: est.get(c).metoda }))
      .sort((p, q) => p.distanta - q.distanta || (p.cheie < q.cheie ? -1 : 1))
    if (!ordonate.length) return baza
    const [prima, aDoua] = ordonate
    return { ...baza, cheie: prima.cheie, distanta: prima.distanta, metoda: prima.metoda,
      urmatoarea: aDoua ? { cheie: aDoua.cheie, distanta: aDoua.distanta } : null }
  })
  const numar = new Map()
  for (const p of propuneri) if (p.cheie) numar.set(p.cheie, (numar.get(p.cheie) || 0) + 1)
  for (const p of propuneri) if (p.cheie && numar.get(p.cheie) > 1) p.conflict = true
  return { propuneri, neestimate }
}

/**
 * Rezumatul unei încărcări: număr pe stări + ce are omul de rezolvat.
 * @param {object[]|{randuri:object[], distante?:object, propuneri?:object, suduriPachet?:string[]}} rezultat
 *   suduriPachet = cheile sudurilor din pachetele tronsonului, pentru „în fișier, nu în pachete” și invers;
 *   distante = rezultatul verificaDistante. Fără ele încărcarea nu e verificată, deci nu e „curată” (L18: necunoscut ≠ 0):
 *   ce n-a putut fi verificat apare în `neverificat`.
 * @returns {{total, peStari, deRezolvat, neverificat:string[], curat:boolean}}
 *   curat = există rânduri, nimic de rezolvat (inclusiv distanțe neverificate și suduri din pachete fără coordonate)
 *   și ambele comparații (cu pachetele, distanțele) au fost făcute.
 */
export function rezumat(rezultat) {
  const r = Array.isArray(rezultat) ? { randuri: rezultat } : (rezultat || {})
  const randuri = r.randuri || []
  const peStari = Object.fromEntries(STARI_COORDONATE.map(s => [s, 0]))
  for (const x of randuri) peStari[x.stare] = (peStari[x.stare] || 0) + 1
  const lista = stare => randuri.filter(x => x.stare === stare).map(x => ({ linie: x.linie, codRaw: x.codRaw, motiv: x.motiv }))
  const deRezolvat = {
    nesigure: lista('nesigur'), dubluri: lista('dublura'), nepotrivite: lista('nepotrivit'), ilizibile: lista('ilizibil'),
    abateri: r.distante?.avertismente || [],
    // perechile de suduri vecine a căror distanță nu s-a putut verifica (fără coordonate / lungime / element)
    distanteNeverificate: r.distante?.neverificate || [],
    propuneri: r.propuneri?.propuneri || [],
  }
  const neverificat = []
  if (Array.isArray(r.suduriPachet)) {
    const dinPachete = new Set(r.suduriPachet)
    const dinFisier = new Set(randuri.filter(x => x.stare === 'ok' || x.stare === 'repetata' || x.stare === 'dublura').map(x => x.cheie))
    deRezolvat.inFisierNuInPachete = randuri.filter(x => x.stare === 'ok' && !dinPachete.has(x.cheie)).map(x => ({ linie: x.linie, codRaw: x.codRaw }))
    deRezolvat.inPacheteFaraCoordonate = [...dinPachete].filter(c => !dinFisier.has(c))
  } else neverificat.push('pachete')
  if (!r.distante || !Array.isArray(r.distante.avertismente) || !Array.isArray(r.distante.neverificate)) neverificat.push('distante')
  const total = randuri.length
  const deRezolvatNr = deRezolvat.nesigure.length + deRezolvat.dubluri.length + deRezolvat.nepotrivite.length +
    deRezolvat.ilizibile.length + deRezolvat.abateri.length + deRezolvat.distanteNeverificate.length +
    (deRezolvat.inFisierNuInPachete?.length || 0) + (deRezolvat.inPacheteFaraCoordonate?.length || 0)
  return { total, peStari, deRezolvat, neverificat, curat: total > 0 && deRezolvatNr === 0 && neverificat.length === 0 }
}

// ── lanțul de suduri din pachete ──────────────────────────────────────────────────────────────────────────
// Rândurile de pachet (executie_tevi): teava / curba = un element, cu sudura de la capătul lui din aval
// (sudura_cod, POZ KM = capătul elementului); legare = doar o sudură; separator = nimic fizic (sărit).
// Pe lanțul de jetoane E0 W0 E1 W1 L E2 W2…: amonte(W) = elementul dinaintea sudurii (elementul rândului ei;
// la legare, elementul de dinainte), aval(W) = următorul element, inclusiv în pachetul următor al aceluiași tronson.

const TIPURI_ELEMENT = new Set(['teava', 'curba'])

// ── ordinea fizică (BULETINE_NDT_SPEC §21 R7) ──
// revizia: lipsă = 0 (revizia 0 nu se scrie în cod); orice altceva decât un întreg ≥ 0 = nevalidă (nu se ghicește)
function revizieNr(p) {
  const r = p?.revizie
  if (r === null || r === undefined || r === '') return 0
  const n = typeof r === 'number' ? r : parseNumar(r)
  return Number.isInteger(n) && n >= 0 ? n : null
}
const kmStartNr = p => { const k = parseNumar(p?.km_start_m); return esteNr(k) ? k : null }
// comparații deterministe: numerele după valoare, restul ca text; lipsa (null) la final
function cmpId(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1
  if (esteNr(a) && esteNr(b)) return a - b
  const sa = String(a), sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}
const cmpText = (a, b) => cmpId(a == null || a === '' ? null : String(a), b == null || b === '' ? null : String(b))
function cmpKm(a, b) { // crescător, fără km la final
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1
  return a - b
}

/**
 * Pachetele active ale unui tronson, în ordinea fizică (R7):
 *   activ = ultima revizie a fiecărui număr de document (la aceeași revizie: id-ul mai mare; celălalt = conflict);
 *   ordine = km start crescător, la egalitate numărul documentului, apoi id-ul. Nu ordinea primită.
 * @returns {{active:object[], inactive:object[]}}  elemente { p, pachetIdx, rev, km }
 */
function pacheteActive(lista, probleme, conflicte) {
  const valide = []
  for (const it of lista) {
    const rev = revizieNr(it.p)
    if (rev === null) { probleme.push({ motiv: 'pachet_revizie_nevalida', pachetIdx: it.pachetIdx, pachet: codPachet(it.p), detaliu: String(it.p?.revizie) }); continue }
    valide.push({ ...it, rev, km: kmStartNr(it.p) })
  }
  const peDoc = new Map()
  for (const it of valide) {
    const doc = text(it.p?.cod_document_full)
    // fără număr de document: pachetul e propriul lui „document” (nu se compară cu alte pachete fără număr)
    const k = doc ? `d:${doc}` : `i:${it.pachetIdx}`
    if (!peDoc.has(k)) peDoc.set(k, [])
    peDoc.get(k).push(it)
  }
  const active = [], inactive = []
  for (const grup of peDoc.values()) {
    grup.sort((a, b) => b.rev - a.rev || cmpId(b.p?.id, a.p?.id) || b.pachetIdx - a.pachetIdx)
    active.push(grup[0])
    for (const alt of grup.slice(1)) {
      inactive.push(alt)
      if (alt.rev === grup[0].rev) {
        conflicte.push({ motiv: 'pachet_revizie_dublata', pachet: codPachet(grup[0].p), pachetIdx: grup[0].pachetIdx, ignorat: { pachetIdx: alt.pachetIdx, id: alt.p?.id ?? null } })
      }
    }
  }
  active.sort((a, b) => cmpKm(a.km, b.km) || cmpText(a.p?.cod_document_full, b.p?.cod_document_full) || cmpId(a.p?.id, b.p?.id) || a.pachetIdx - b.pachetIdx)
  // cu mai multe pachete pe tronson, fără km start nu se știe unde stă pachetul → legăturile peste graniță ar ieși greșite
  if (active.length > 1) {
    for (const a of active) if (a.km === null) probleme.push({ motiv: 'pachet_fara_km_start', pachetIdx: a.pachetIdx, pachet: codPachet(a.p) })
  }
  return { active, inactive }
}

// Dintre aparițiile aceleiași chei de sudură rămâne una (R7): revizia cea mai nouă, apoi km start mai mare,
// apoi id-ul pachetului mai mare, apoi poziția mai mare în pachet (complet determinist).
function cmpKmDesc(a, b) { // descrescător, fără km la final
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1
  return b - a
}
const pozNr = r => (esteNr(r?.poz_in_pachet) ? r.poz_in_pachet : -Infinity)
const cmpAparitie = (a, b) => b.rev - a.rev || cmpKmDesc(a.km, b.km) || cmpId(b.p?.id, a.p?.id) ||
  (pozNr(b.rand) - pozNr(a.rand) || 0) || b.ordine - a.ordine

/**
 * @param {Array<{id?:number|string, cod_document_full?:string, revizie?:number, km_start_m?:number, tronson:string|number, tevi:object[]}>} pachete
 *   TOATE pachetele tronsonului (orice ordine, orice revizii): se iau doar cele active (ultima revizie), ordonate după
 *   km start (R7). Alt tronson = alt lanț. Pentru inventarul unui singur pachet se dă tot tronsonul și se filtrează după.
 * @param {{prefixSudura?:string, eliminate?:Iterable<string>}} [opt]
 *   prefixSudura = prefixul codului afișat ('T' = LOT 1, ca în model; 'TR' = LOT 2);
 *   eliminate = cheile sudurilor eliminate prin tăiere (R4): ies din lanț (elementele rămân), se listează în `eliminate`
 * @returns {{suduri:object[], probleme:object[], conflicte:object[], eliminate:object[], pacheteInactive:object[]}}
 *   sudura: { cheie, nrSudura, tronson, pachet, pachetIdx, rand, pozKm, amonte, aval, intreUrmatoarea, urmatoareaCheie, capatTronson }
 *   probleme: ce nu poate intra în lanț (cod nevalid, pachet fără tronson / km start / revizie validă, poziții dublate)
 *   conflicte: aceeași cheie în mai multe locuri (rămâne una, celelalte listate) și pachete cu aceeași revizie
 */
export function lantSuduri(pachete = [], opt = {}) {
  const prefix = opt.prefixSudura ?? 'T'
  const eliminateSet = new Set(opt.eliminate || [])
  const probleme = [], conflicte = [], eliminate = [], pacheteInactive = []
  const peTronson = new Map()
  pachete.forEach((p, pachetIdx) => {
    const t = tronsonNr(p?.tronson)
    if (t === null) { probleme.push({ motiv: 'pachet_fara_tronson', pachetIdx, pachet: codPachet(p) }); return }
    if (!peTronson.has(t)) peTronson.set(t, [])
    peTronson.get(t).push({ p, pachetIdx })
  })
  const suduri = []
  for (const [tronson, toate] of [...peTronson].sort((a, b) => a[0] - b[0])) {
    const { active: lista, inactive } = pacheteActive(toate, probleme, conflicte)
    for (const it of inactive) pacheteInactive.push({ tronson, pachetIdx: it.pachetIdx, pachet: codPachet(it.p), id: it.p?.id ?? null })
    const jetoane = []
    for (const { p, pachetIdx, rev, km } of lista) {
      const tevi = [...(p.tevi || [])].sort((a, b) => (a.poz_in_pachet ?? 0) - (b.poz_in_pachet ?? 0))
      const vazute = new Set()
      for (const rand of tevi) {
        if (rand.poz_in_pachet != null) {
          if (vazute.has(rand.poz_in_pachet)) probleme.push({ motiv: 'pozitie_dublata', pachetIdx, pachet: codPachet(p), poz: rand.poz_in_pachet })
          vazute.add(rand.poz_in_pachet)
        }
        if (rand.tip_rand === 'separator') continue
        if (TIPURI_ELEMENT.has(rand.tip_rand)) jetoane.push({ tip: 'E', rand, pachetIdx, p })
        else if (rand.tip_rand !== 'legare') { probleme.push({ motiv: `tip_rand_necunoscut_${rand.tip_rand}`, pachetIdx, pachet: codPachet(p), poz: rand.poz_in_pachet }); continue }
        const cod = rand.sudura_cod == null ? '' : String(rand.sudura_cod).trim()
        if (!cod) {
          if (rand.tip_rand === 'legare') probleme.push({ motiv: 'legare_fara_cod', pachetIdx, pachet: codPachet(p), poz: rand.poz_in_pachet })
          continue
        }
        const n = normalizeazaSudura(cod, { tronson, mod: 'legacy' })
        if (n.stare !== 'ok' || n.altTronson) {
          probleme.push({ motiv: n.altTronson ? 'cod_alt_tronson' : 'cod_sudura_nevalid', cod, pachetIdx, pachet: codPachet(p), poz: rand.poz_in_pachet })
          continue
        }
        jetoane.push({ tip: 'W', rand, pachetIdx, p, n, cheie: cheieSudura(n), rev, km, ordine: jetoane.length })
      }
    }
    // sudurile eliminate prin tăiere (R4): ies din lanț, elementele lor rămân (sudurile vecine își păstrează amonte / aval)
    const scoase = new Set()
    for (const j of jetoane) {
      if (j.tip !== 'W' || !eliminateSet.has(j.cheie)) continue
      scoase.add(j)
      eliminate.push({ cheie: j.cheie, nrSudura: formatSudura(j.n, { prefix }), tronson, pachet: codPachet(j.p), pachetIdx: j.pachetIdx, poz: j.rand.poz_in_pachet })
    }
    // aceeași cheie (originalul și refacerea „R” sunt aceeași cheie, §22) în mai multe locuri: rămâne o apariție (R7),
    // celelalte ies din lanț și se listează; niciodată nu dispar toate
    const peCheie = new Map()
    for (const j of jetoane) {
      if (j.tip !== 'W' || scoase.has(j)) continue
      if (!peCheie.has(j.cheie)) peCheie.set(j.cheie, [])
      peCheie.get(j.cheie).push(j)
    }
    for (const grup of peCheie.values()) {
      if (grup.length < 2) continue
      const ordonat = [...grup].sort(cmpAparitie)
      const [castig, ...restul] = ordonat
      for (const j of restul) scoase.add(j)
      const loc = j => ({ pachet: codPachet(j.p), pachetIdx: j.pachetIdx, poz: j.rand.poz_in_pachet, cod: String(j.rand.sudura_cod).trim() })
      conflicte.push({ motiv: 'sudura_dublata_in_pachete', cheie: castig.cheie, nrSudura: formatSudura(castig.n, { prefix }), tronson,
        pastrata: loc(castig), ignorate: restul.map(loc) })
    }
    const lant = jetoane.filter(j => !scoase.has(j))
    const suduriTronson = []
    lant.forEach((j, i) => {
      if (j.tip !== 'W') return
      let amonte = null, aval = null
      for (let k = i - 1; k >= 0; k--) if (lant[k].tip === 'E') { amonte = lant[k].rand; break }
      for (let k = i + 1; k < lant.length; k++) if (lant[k].tip === 'E') { aval = lant[k].rand; break }
      const intre = []
      let urmatoarea = null
      for (let k = i + 1; k < lant.length; k++) {
        if (lant[k].tip === 'W') { urmatoarea = lant[k]; break }
        intre.push(lant[k].rand)
      }
      const poz = parseNumar(j.rand.poz_km_m)
      suduriTronson.push({
        cheie: j.cheie, nrSudura: formatSudura(j.n, { prefix }), tronson, refacuta: !!j.rand.sudura_refacuta || !!j.n.refacuta,
        pachet: codPachet(j.p), pachetIdx: j.pachetIdx, rand: j.rand, pozKm: esteNr(poz) ? poz : null,
        amonte, aval, intreUrmatoarea: urmatoarea ? intre : null,
        urmatoareaCheie: urmatoarea ? urmatoarea.cheie : null,
        // ultima sudură a tronsonului (în ordinea fizică): fără element aval = capăt de tronson (R8), nu greșeală
        capatTronson: !urmatoarea,
      })
    })
    for (const s of suduriTronson) suduri.push(s) // fără push(...): tronsoanele mari dau RangeError
  }
  return { suduri, probleme, conflicte, eliminate, pacheteInactive }
}

/** Codul pachetului cu revizia, ca în centralizator: „…-00040 rev.1” (revizia 0 nu se scrie). */
export function codPachet(p) {
  if (!p?.cod_document_full) return ''
  return p.cod_document_full + (p.revizie > 0 ? ` rev.${p.revizie}` : '')
}

/**
 * Lanțul unui tronson pregătit pentru verificaDistante / propuneCoduri.
 * @param {object[]} suduri  din lantSuduri (aceluiași tronson, în ordine)
 * @param {Map<string,{x,y,z}>|object} coordonate  cheie → coordonate (doar cele confirmate / ok)
 */
export function punctePentruVerificare(suduri, coordonate) {
  const ia = c => (coordonate instanceof Map ? coordonate.get(c) : coordonate?.[c])
  const punctePeOrdine = suduri.map(s => ({ cheie: s.cheie, ...(ia(s.cheie) || { x: null, y: null, z: null }) }))
  // elementele dintre două suduri vecine doar dacă sunt chiar vecine în lanț (o sudură scoasă ca dublată sau
  // granița dintre tronsoane rupe perechea → fără element, deci „neverificat”, nu o lungime greșită)
  const elemente = suduri.slice(0, -1).map((s, i) => (s.urmatoareaCheie && s.urmatoareaCheie === suduri[i + 1].cheie && s.tronson === suduri[i + 1].tronson
    ? s.intreUrmatoarea : null))
  return { punctePeOrdine, elemente }
}
