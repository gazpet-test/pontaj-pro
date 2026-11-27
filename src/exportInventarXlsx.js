// ===========================================================================
// EXPORT INVENTAR DUPĂ LANSARE — Izometrie (BULETINE_NDT_SPEC §16, D14–D17)
// ---------------------------------------------------------------------------
// Un rând pe sudură: lot, nr. sudură, pachet de lansare (cu revizie), nr. situație de lucrări (goală până există
// sursa), tronson, clasa de locație, elementul amonte și aval (tip, diametru, grosime, lungime, serie, șarjă), X / Y / Z
// și la final rubrica de semnătură a antreprenorului. Structura, lățimile, stilurile și merge-urile = modelul rev.4
// al inventarului (o foaie „Sheet1”, antet pe 2 rânduri, date de la rândul 3).
//
//   construiesteRanduriInventar({ pachete, coordonate, clase, eliminate }) — pur: rândurile de pachet + coordonatele
//     confirmate → { randuri, lipsuri, conflicte }. Intră DOAR sudurile cu coordonate confirmate, neeliminate (D16, R8).
//     Ordinea fizică și dublurile: R7 (lantSuduri). Nimic nu se inventează: elementul aval lipsă, seria / lungimea lipsă,
//     clasa lipsă apar în `lipsuri`, cu tipul de blocaj (§16, R8) sau ca avertisment.
//   generateInventarXlsx({ lot, randuri, semnatura }) — Uint8Array (xlsx-js-style, ca exportCentralizatorXlsx.js).
// ===========================================================================

import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { lantSuduri } from './lib/izoCoordonate.js'
import { parseNumar } from './izoDocumenteLogica.js'
const XLSX = XLSX_mod.default || XLSX_mod

const esteNr = x => typeof x === 'number' && Number.isFinite(x)

// blocajele (§16): fără deblocare = documentul ar ieși greșit; cu deblocare = MP poate decide să exporte totuși
export const BLOCAJ_FARA_DEBLOCARE = 'fara_deblocare'
export const BLOCAJ_DEBLOCARE_MP = 'deblocare_mp'
// avertisment = exportul merge, dar se arată (R8: capăt de tronson; R7: dubluri rezolvate; R4: suduri eliminate)
export const BLOCAJ_AVERTISMENT = 'avertisment'

// ---------------------------------------------------------------------------
// ELEMENTUL (țeavă / curbă) din rândul de pachet
// ---------------------------------------------------------------------------
// „610X7.1”, „610 x 7,1”, „610X7.1mm”, la curbe și „610X7.1 20°” (ancorat, L13)
const RE_DIMENSIUNE = /^(\d+(?:[.,]\d+)?)[ \t]*[xX×*][ \t]*(\d+(?:[.,]\d+)?)[ \t]*(?:mm)?(?:[ \t]+\d+(?:[.,]\d+)?[ \t]*[°˚])?$/
// unghi_curba: „20°”, „22.5°”, „20” (registru → text cu °)
const RE_UNGHI = /^(\d+(?:[.,]\d+)?)[ \t]*[°˚]?$/

/** „610X7.1” → { diametru: 610, grosime: 7.1 }; nerecunoscut → null (nu se ghicește). */
export function parseazaDimensiune(dim) {
  if (dim == null) return null
  const m = String(dim).trim().match(RE_DIMENSIUNE)
  if (!m) return null
  const diametru = parseNumar(m[1]), grosime = parseNumar(m[2])
  return esteNr(diametru) && esteNr(grosime) ? { diametru, grosime } : null
}

/** Grosimea ca în model: „7.1mm”. */
export const textGrosime = g => (esteNr(g) ? `${g}mm` : '')

function unghiCurba(u) {
  if (u == null) return null
  if (typeof u === 'number') return Number.isFinite(u) ? u : null
  const m = String(u).trim().match(RE_UNGHI)
  if (!m) return null
  const n = parseNumar(m[1])
  return esteNr(n) ? n : null
}

const text = v => (v == null ? '' : String(v).trim())

// elementul pentru inventar + lipsurile lui (serie, lungime, dimensiune, unghi)
function elementInventar(rand, parte, adauga) {
  if (!rand) return null
  const dim = parseazaDimensiune(rand.dimensiune)
  if (!dim) adauga('dimensiune_nerecunoscuta', BLOCAJ_FARA_DEBLOCARE, `${parte}: ${text(rand.dimensiune) || 'goală'}`)
  let tip = 'TEAVA'
  if (rand.tip_rand === 'curba') {
    const u = unghiCurba(rand.unghi_curba)
    if (u === null) { tip = 'CURBA'; adauga('curba_fara_unghi', BLOCAJ_FARA_DEBLOCARE, `${parte}: ${text(rand.unghi_curba) || 'gol'}`) }
    else tip = `CURBA ${u}°`
  }
  const lungime = parseNumar(rand.lungime_m)
  if (!esteNr(lungime) || lungime <= 0) adauga('element_fara_lungime', BLOCAJ_FARA_DEBLOCARE, parte)
  const serie = text(rand.serie_unica)
  if (!serie) adauga('element_fara_serie', BLOCAJ_FARA_DEBLOCARE, parte)
  const sarja = text(rand.sarja)
  if (!sarja) adauga('element_fara_sarja', BLOCAJ_DEBLOCARE_MP, parte)
  return {
    tip, diametru: dim ? dim.diametru : null, grosime: dim ? textGrosime(dim.grosime) : '',
    lungime: esteNr(lungime) && lungime > 0 ? lungime : null, serie, sarja,
  }
}

// clasa de locație din POZ KM (§15): intervale închise [km_de, km_pana], în metri ca poz_km_m.
// La granița dintre două clase diferite (ambele intervale o conțin) decide omul.
function clasaLaPoz(pozKm, intervale) {
  if (!esteNr(pozKm)) return { clasa: null, motiv: 'fara_poz_km' }
  const potrivite = [...new Set(intervale
    .filter(i => esteNr(parseNumar(i?.km_de)) && esteNr(parseNumar(i?.km_pana)) && parseNumar(i.km_de) <= pozKm && pozKm <= parseNumar(i.km_pana))
    .map(i => text(i.clasa)).filter(Boolean))]
  if (!potrivite.length) return { clasa: null, motiv: 'fara_clasa' }
  if (potrivite.length > 1) return { clasa: null, motiv: 'clasa_la_granita', detaliu: potrivite.join(' / ') }
  return { clasa: potrivite[0], motiv: null }
}

// coordonatele confirmate: listă { cheie, x, y, z } sau Map cheie → { x, y, z }
function indexCoordonate(coordonate, lipsuri) {
  const lista = coordonate instanceof Map ? [...coordonate].map(([cheie, c]) => ({ ...c, cheie })) : (coordonate || [])
  const idx = new Map(), dublate = new Set()
  for (const c of lista) {
    if (!c?.cheie) continue
    if (![c.x, c.y, c.z].every(esteNr)) {
      lipsuri.push({ cheie: c.cheie, motiv: 'coordonate_nevalide', blocheaza: BLOCAJ_FARA_DEBLOCARE, inInventar: false })
      dublate.add(c.cheie)
      continue
    }
    const v = idx.get(c.cheie)
    if (v && (v.x !== c.x || v.y !== c.y || v.z !== c.z)) dublate.add(c.cheie)
    else idx.set(c.cheie, { x: c.x, y: c.y, z: c.z })
  }
  for (const k of dublate) {
    if (idx.has(k)) lipsuri.push({ cheie: k, motiv: 'coordonate_dublate', blocheaza: BLOCAJ_FARA_DEBLOCARE, inInventar: false })
    idx.delete(k)
  }
  return { idx, excluse: dublate }
}

/**
 * Rândurile inventarului din pachete + coordonatele confirmate.
 * @param {object} p
 * @param {Array<{id?:number|string, cod_document_full:string, revizie?:number, km_start_m?:number, tronson:string|number, tevi:object[]}>} p.pachete
 *   toate pachetele tronsonului, în orice ordine (se iau ultimele revizii, ordonate după km start, R7);
 *   `tevi` = rândurile executie_tevi (poz_in_pachet, tip_rand, serie_unica, sarja,
 *   dimensiune, lungime_m, sudura_cod, unghi_curba, poz_km_m)
 * @param {Array<{cheie:string,x:number,y:number,z:number}>|Map} p.coordonate  DOAR cele confirmate (cheia = cheieSudura)
 * @param {Array<{km_de:number, km_pana:number, clasa:string}>|Object<string,Array>} [p.clase]
 *   intervalele de clasă în metri (aceeași unitate ca poz_km_m); listă comună sau obiect pe tronson { 12: [...] }
 * @param {string} [p.prefixSudura='T']  'T' = LOT 1 (ca în model), 'TR' = LOT 2
 * @param {Set<string>|string[]} [p.eliminate]  cheile sudurilor eliminate prin tăiere, active (R4): nu intră în inventar
 *   și nu cer coordonate; se listează ca avertisment
 * @returns {{randuri:object[], lipsuri:object[], conflicte:object[]}}
 *   conflicte = aceeași sudură în mai multe pachete (rămâne apariția din revizia cea mai nouă, R7) și pachete
 *   cu aceeași revizie; fiecare apare și în `lipsuri`, ca avertisment
 */
export function construiesteRanduriInventar({ pachete = [], coordonate = [], clase = [], prefixSudura = 'T', eliminate = [] } = {}) {
  const lipsuri = []
  const eliminateSet = new Set(eliminate || [])
  const lant = lantSuduri(pachete, { prefixSudura, eliminate: eliminateSet })
  const { suduri, probleme, conflicte } = lant
  for (const pr of probleme) lipsuri.push({ ...pr, blocheaza: BLOCAJ_FARA_DEBLOCARE, inInventar: false })
  for (const e of lant.eliminate) lipsuri.push({ ...e, motiv: 'sudura_eliminata', blocheaza: BLOCAJ_AVERTISMENT, inInventar: false })
  // coordonatele unei suduri eliminate nu contează (nici ca dublură, nici ca „fără sudură”), dar se arată
  const coordLista = coordonate instanceof Map ? [...coordonate].map(([cheie, c]) => ({ ...c, cheie })) : (coordonate || [])
  const coordEliminate = new Set()
  const coordRamase = coordLista.filter(c => {
    if (!c?.cheie || !eliminateSet.has(c.cheie)) return true
    coordEliminate.add(c.cheie)
    return false
  })
  for (const k of coordEliminate) lipsuri.push({ cheie: k, motiv: 'coordonate_sudura_eliminata', blocheaza: BLOCAJ_AVERTISMENT, inInventar: false })
  const { idx, excluse } = indexCoordonate(coordRamase, lipsuri)
  const intervale = t => (Array.isArray(clase) ? clase : (clase?.[t] || []))
  const randuri = []
  const folosite = new Set()
  for (const s of suduri) {
    const c = idx.get(s.cheie)
    if (!c) {
      // D16: fără coordonate confirmate nu intră; se arată (MP poate debloca exportul fără ea)
      if (!excluse.has(s.cheie)) lipsuri.push({ cheie: s.cheie, nrSudura: s.nrSudura, pachet: s.pachet, motiv: 'fara_coordonate', blocheaza: BLOCAJ_DEBLOCARE_MP, inInventar: false })
      continue
    }
    folosite.add(s.cheie)
    const adauga = (motiv, blocheaza, detaliu) => lipsuri.push({ cheie: s.cheie, nrSudura: s.nrSudura, pachet: s.pachet, motiv, blocheaza, detaliu: detaliu ?? null, inInventar: true })
    if (!s.amonte) adauga('fara_element_amonte', BLOCAJ_FARA_DEBLOCARE)
    // R8: ultima sudură a tronsonului fără aval = capăt de tronson (avertisment); altundeva lipsa avalului = document greșit
    if (!s.aval) {
      if (s.capatTronson) adauga('capat_de_tronson', BLOCAJ_AVERTISMENT)
      else adauga('fara_element_aval', BLOCAJ_FARA_DEBLOCARE)
    }
    const cl = clasaLaPoz(s.pozKm, intervale(s.tronson))
    if (cl.motiv) adauga(cl.motiv, BLOCAJ_DEBLOCARE_MP, cl.detaliu)
    randuri.push({
      cheie: s.cheie, nrSudura: s.nrSudura, pachet: s.pachet, situatie: null, tronson: s.tronson,
      clasaLocatie: cl.clasa, pozKm: s.pozKm,
      amonte: elementInventar(s.amonte, 'amonte', adauga),
      aval: elementInventar(s.aval, 'aval', adauga),
      x: c.x, y: c.y, z: c.z,
    })
  }
  for (const k of idx.keys()) {
    if (!folosite.has(k)) lipsuri.push({ cheie: k, motiv: 'coordonate_fara_sudura', blocheaza: BLOCAJ_DEBLOCARE_MP, inInventar: false })
  }
  // R7: conflictul se listează (exportul merge cu apariția păstrată)
  for (const cf of conflicte) {
    lipsuri.push({ ...cf, blocheaza: BLOCAJ_AVERTISMENT, inInventar: cf.cheie ? folosite.has(cf.cheie) : false })
  }
  return { randuri, lipsuri, conflicte }
}

// ---------------------------------------------------------------------------
// STILURI (modelul rev.4: Segoe UI 11 / 12, Arial Narrow 12, Calibri 14 la semnătură)
// ---------------------------------------------------------------------------
const NEGRU = { rgb: '000000' }
const F_SEGOE_11 = { name: 'Segoe UI', sz: 11, color: NEGRU }
const F_SEGOE_12 = { name: 'Segoe UI', sz: 12, color: NEGRU }
const F_SEGOE_12_B = { ...F_SEGOE_12, bold: true }
const F_ARIAL_N_12 = { name: 'Arial Narrow', sz: 12, color: NEGRU }
const F_ARIAL_N_12_B = { ...F_ARIAL_N_12, bold: true }
const F_CALIBRI_11 = { name: 'Calibri', sz: 11, color: NEGRU }
const F_CALIBRI_14 = { name: 'Calibri', sz: 14, color: NEGRU }
const ALB = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }
const L = { style: 'thin', color: NEGRU }
const B_TOT = { left: L, right: L, top: L, bottom: L }
const B_FARA_SUS = { left: L, right: L, bottom: L }
const B_SUS_JOS = { top: L, bottom: L }
const B_DREAPTA_SUS_JOS = { right: L, top: L, bottom: L }
const CC = { horizontal: 'center', vertical: 'center' }

const st = (font, extra = {}) => ({ font, border: B_TOT, alignment: CC, ...extra })
const ANTET = {
  normal: st(F_SEGOE_12_B),
  wrap: st(F_SEGOE_12_B, { alignment: { ...CC, wrapText: true } }),
  wrapSus: st(F_SEGOE_12_B, { alignment: { horizontal: 'center', wrapText: true } }),
  shrink: st(F_SEGOE_12_B, { alignment: { ...CC, shrinkToFit: true } }),
  nr0: st(F_SEGOE_12_B, { numFmt: '0' }),
  nr2: st(F_SEGOE_12_B, { numFmt: '0.00' }),
  nr2shrink: st(F_SEGOE_12_B, { numFmt: '0.00', alignment: { ...CC, shrinkToFit: true } }),
  coord: st(F_SEGOE_12_B, { alignment: { horizontal: 'center' } }),
  coordMijloc: { font: F_CALIBRI_11, border: B_SUS_JOS },
  coordCapat: { font: F_CALIBRI_11, border: B_DREAPTA_SUS_JOS },
  rand2: { font: F_CALIBRI_11, border: B_FARA_SUS },
}

// coloanele A..U: [antet R1, stilul antetului, stilul datelor, câmpul]
const COLOANE = [
  ['LOT', ANTET.normal, st(F_SEGOE_11), r => r._lot],
  ['Nr_Sudura', ANTET.normal, st(F_SEGOE_12, { fill: ALB }), r => r.nrSudura],
  ['Nr. pachet lansare', ANTET.wrap, st(F_SEGOE_12, { fill: ALB }), r => r.pachet],
  ['Nr. situatie de lucrari in care a fost inclusa', ANTET.wrapSus, { font: F_CALIBRI_11, border: B_TOT }, r => r.situatie],
  ['Tronson', ANTET.shrink, st(F_SEGOE_11), r => r.tronson],
  ['Clasa_Locatie', ANTET.normal, st(F_SEGOE_11), r => r.clasaLocatie],
  ['Tip_Element_Amonte', ANTET.normal, st(F_SEGOE_11), r => r.amonte?.tip],
  ['Diametru_Amonte', ANTET.nr0, st(F_SEGOE_11), r => r.amonte?.diametru],
  ['Grosime_Amonte', ANTET.nr2, st(F_SEGOE_12, { fill: ALB }), r => r.amonte?.grosime],
  ['Lungime_Amonte', ANTET.nr2, st(F_SEGOE_12, { fill: ALB, numFmt: '0.00' }), r => r.amonte?.lungime],
  ['Serie_tv_Amonte', ANTET.normal, st(F_SEGOE_12, { fill: ALB, numFmt: '0.0' }), r => r.amonte?.serie],
  ['Sarja_tv_Amonte', ANTET.normal, st(F_SEGOE_12, { fill: ALB, numFmt: '@' }), r => r.amonte?.sarja],
  ['Tip_Element_Aval', ANTET.normal, st(F_ARIAL_N_12), r => r.aval?.tip],
  ['Diametru_Aval', ANTET.nr0, st(F_ARIAL_N_12, { numFmt: '0' }), r => r.aval?.diametru],
  ['Grosime_Aval', ANTET.nr2, st(F_ARIAL_N_12), r => r.aval?.grosime],
  ['Lungime_Aval', ANTET.nr2shrink, st(F_SEGOE_11, { numFmt: '0.00' }), r => r.aval?.lungime],
  ['Serie_tv_Aval', ANTET.normal, st(F_SEGOE_11, { fill: ALB, numFmt: '0.00' }), r => r.aval?.serie],
  ['Sarja_tv_Aval', ANTET.normal, st(F_SEGOE_11, { fill: ALB }), r => r.aval?.sarja],
  ['COORDONATE', ANTET.coord, st(F_ARIAL_N_12_B, { numFmt: '0.000' }), r => r.x],
  [null, ANTET.coordMijloc, st(F_ARIAL_N_12_B, { numFmt: '0.000' }), r => r.y],
  [null, ANTET.coordCapat, st(F_ARIAL_N_12_B, { numFmt: '0.000' }), r => r.z],
]
export const INVENTAR_ANTET = COLOANE.map(c => c[0])
export const INVENTAR_NR_COLOANE = COLOANE.length // A..U

// lățimile exacte din model (xlsx-js-style adaugă padding la !cols → se rescriu în XML după scriere)
const COLS_MODEL_XML = '<cols><col min="1" max="1" width="5.21875" bestFit="1" customWidth="1"/><col min="2" max="3" width="12.21875" bestFit="1" customWidth="1"/><col min="4" max="4" width="12.109375" customWidth="1"/><col min="5" max="5" width="9.6640625" bestFit="1" customWidth="1"/><col min="6" max="6" width="15.33203125" bestFit="1" customWidth="1"/><col min="7" max="7" width="23.44140625" bestFit="1" customWidth="1"/><col min="8" max="8" width="20.5546875" bestFit="1" customWidth="1"/><col min="9" max="9" width="19.6640625" bestFit="1" customWidth="1"/><col min="10" max="10" width="19.77734375" bestFit="1" customWidth="1"/><col min="11" max="12" width="19.109375" bestFit="1" customWidth="1"/><col min="13" max="13" width="19.77734375" bestFit="1" customWidth="1"/><col min="14" max="14" width="16.77734375" bestFit="1" customWidth="1"/><col min="15" max="15" width="15.77734375" bestFit="1" customWidth="1"/><col min="16" max="16" width="26.33203125" customWidth="1"/><col min="17" max="17" width="15.33203125" bestFit="1" customWidth="1"/><col min="18" max="18" width="15.33203125" customWidth="1"/><col min="19" max="21" width="2.44140625" bestFit="1" customWidth="1"/></cols>'
const COL_WCH = [4.86, 11.86, 11.86, 11.79, 9.29, 15, 23.07, 20.21, 19.29, 19.43, 18.79, 18.79, 19.43, 16.43, 15.43, 26, 15, 15, 2.07, 2.07, 2.07]
// pagina ca în model: A4 vedere, scara 52, marginile modelului, zoom 70
const PAGE_SETUP_XML = '<pageSetup orientation="landscape" paperSize="9" scale="52"/>'
const MARGINI = { left: 0.41, right: 0.1968503937007874, top: 0.7874015748031497, bottom: 0.3937007874015748, header: 0.3149606299212598, footer: 0.3149606299212598 }

export const SEMNATURA_TITLU = 'Reprezentant Antreprenor'
export const SEMNATURA_ETICHETA = 'NUME IN CLAR SI SEMNATURA'

const adresa = (c, r) => XLSX.utils.encode_cell({ c, r })

// valoarea: numerele rămân numere, textul rămâne text (fără reparsare, L17); gol = celulă stilată goală
function scrie(ws, a, v, s) {
  if (esteNr(v)) ws[a] = { v, t: 'n', s }
  else ws[a] = { v: v == null ? '' : String(v), t: 's', s }
  if (s?.numFmt) ws[a].z = s.numFmt
}

/**
 * Poziția rubricii de semnătură pentru n rânduri de date (0-indexat): titlul la ultimul rând + 2, eticheta la + 3,
 * locul pentru nume (merge P..S) la + 4 — ca în model (date R3..R325 → R327 / R328 / P329:S329).
 */
export function pozitieSemnatura(n) {
  const ultim = 1 + n // 0-indexat: antetul ocupă rândurile 0-1
  return { col: 15, titlu: ultim + 2, eticheta: ultim + 3, nume: ultim + 4, mergeColFinal: 18 }
}

/**
 * @param {object} p
 * @param {string|number} p.lot  valoarea din coloana LOT (număr rămâne număr)
 * @param {object[]} p.randuri  din construiesteRanduriInventar (sau calculate de apelant, aceeași formă)
 * @param {{nume?:string, titlu?:string, eticheta?:string}} [p.semnatura]  numele în clar scris în rubrică (opțional)
 * @returns {Promise<Uint8Array>}
 */
export async function generateInventarXlsx({ lot, randuri, semnatura } = {}) {
  if (!Array.isArray(randuri)) throw new Error('Lista de rânduri obligatorie')
  const ws = {}
  // antetul: rândul 1 cu denumirile (merge vertical A1:A2..R1:R2), S1:U1 „COORDONATE” peste X / Y / Z
  COLOANE.forEach(([eticheta, stilAntet], c) => {
    scrie(ws, adresa(c, 0), eticheta, stilAntet)
    if (c < 18) scrie(ws, adresa(c, 1), null, ANTET.rand2)
  })
  ;['X', 'Y', 'Z'].forEach((e, k) => scrie(ws, adresa(18 + k, 1), e, ANTET.normal))
  // datele de la rândul 3
  randuri.forEach((r, i) => {
    const rr = { ...r, _lot: lot }
    COLOANE.forEach(([, , stilDate, camp], c) => scrie(ws, adresa(c, 2 + i), camp(rr), stilDate))
  })
  // rubrica de semnătură
  const sem = pozitieSemnatura(randuri.length)
  const stilSem = { font: F_CALIBRI_14, alignment: { vertical: 'center' } }
  scrie(ws, adresa(sem.col, sem.titlu), semnatura?.titlu || SEMNATURA_TITLU, stilSem)
  scrie(ws, adresa(sem.col, sem.eticheta), semnatura?.eticheta || SEMNATURA_ETICHETA, stilSem)
  scrie(ws, adresa(sem.col, sem.nume), text(semnatura?.nume), stilSem)

  ws['!merges'] = [
    ...Array.from({ length: 18 }, (_, c) => ({ s: { r: 0, c }, e: { r: 1, c } })), // A1:A2 .. R1:R2
    { s: { r: 0, c: 18 }, e: { r: 0, c: 20 } }, // S1:U1
    { s: { r: sem.nume, c: sem.col }, e: { r: sem.nume, c: sem.mergeColFinal } }, // P..S la nume
  ]
  ws['!cols'] = COL_WCH.map(wch => ({ wch }))
  ws['!rows'] = [{ hpt: 14.4 }, { hpt: 83.4 }, ...randuri.map(() => ({ hpt: 19.2 }))]
  ws['!margins'] = MARGINI
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sem.nume, c: INVENTAR_NR_COLOANE - 1 } })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })

  // după scriere: lățimile exacte, pagina (A4 vedere, scara 52) și zoom-ul modelului
  const zip = await JSZip.loadAsync(out)
  const cale = 'xl/worksheets/sheet1.xml'
  let xml = await zip.file(cale).async('string')
  xml = xml.includes('<cols>') ? xml.replace(/<cols>.*?<\/cols>/, COLS_MODEL_XML) : xml.replace(/(<sheetData)/, `${COLS_MODEL_XML}$1`)
  if (!xml.includes('<pageSetup')) xml = xml.replace(/(<pageMargins[^>]*\/>)/, `$1${PAGE_SETUP_XML}`)
  xml = xml.replace(/<sheetView /, '<sheetView zoomScale="70" zoomScaleNormal="70" ')
  zip.file(cale, xml)
  return zip.generateAsync({ type: 'uint8array' })
}

/** Numele fișierului: Inventar_<tronson sau pachet>.xlsx (fără caractere interzise în nume de fișier). */
export function buildInventarFilename(eticheta) {
  const e = text(eticheta).replace(/[\\/:*?"<>|]+/g, '_') || 'inventar'
  return `Inventar_${e}.xlsx`
}
