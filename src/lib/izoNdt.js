// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — buletinele NDT pe suduri: logica pură (docs/izometrie/BULETINE_NDT_SPEC.md)
// ════════════════════════════════════════════════════════════════════════
// Fără Supabase, fără DOM. Folosită de ecranul „Buletine NDT” (PR2) și de
// „Export IZO înainte de lansare” (PR3). Normalizarea codului = izoSudura.js,
// mod 'legacy': R final = refacere; orice altă literă face parte din cod (D18).
//
// Formatul unei citiri AI (D4): { antet: { numar, data, ... }, randuri: [ { cod_raw, rezultat,
//   data_inspectie, start_mm, end_mm, lungime_mm, inaltime_mm, adancime_mm, observatii? } ], incerte: [],
//   partial?: boolean, pagini_necitite?: number[] }
// Nimic nu dispare tăcut (L12): codurile nenormalizabile rămân în listă ca „nepotrivit”,
// valorile ilizibile ca „incert”, iar ambiguitățile ca „conflict” / „dublat”.

import { normalizeazaSudura, cheieSudura, formatSudura, tronsonNr } from './izoSudura.js'
import { parseNumar } from '../izoDocumenteLogica.js'
import { dataExcel } from './izoImportStoc.js'

/** Metodele cu coloană în CENTRALIZATOR (K, L, M) și cheia lor în rezultat. */
export const METODE_CENTRALIZATOR = ['PM', 'PA-UT', 'UT']
const COLOANA_METODA = { PM: 'pm', 'PA-UT': 'pa_ut', UT: 'ut' }
const CAMPURI_INDICATII = ['start_mm', 'end_mm', 'lungime_mm', 'inaltime_mm', 'adancime_mm']

const txt = v => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()
const areText = v => /\S/.test(txt(v))

// ── valori ───────────────────────────────────────────────────────────────
/** Metoda: „PA UT”, „pa-ut”, „PAUT” → 'PA-UT'; „pm” → 'PM'; altele rămân cu majuscule (RT, VT…); gol → null. */
export function normalizeazaMetoda(m) {
  const s = txt(m).toUpperCase().replace(/[\s_-]+/g, '')
  if (!s) return null
  if (s === 'PAUT') return 'PA-UT'
  return s
}

/** Rezultatul unui rând: 'acceptat' / 'respins'; gol → null; alt text → 'necunoscut'. */
export function normalizeazaRezultat(r) {
  const s = txt(r).toUpperCase()
  if (!s) return null
  if (/^(?:ACCEPTED|ACCEPTAT|ADMIS|ACC)$/.test(s)) return 'acceptat'
  if (/^(?:REJECTED|RESPINS|NEADMIS|REJ)$/.test(s)) return 'respins'
  return 'necunoscut'
}

/**
 * Data ca text ISO „AAAA-LL-ZZ”, fără fus orar (L17). Acceptă ISO și „ZZ.LL.AAAA” / „ZZ/LL/AAAA”
 * (prin dataExcel, helperul existent). Gol → null; altceva → { invalid } (nu se ghicește).
 */
export function dataIso(v) {
  if (v === null || v === undefined || txt(v) === '') return null
  if (typeof v !== 'string') return { invalid: txt(v) }
  const s = v.trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const [a, l, z] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const ok = l >= 1 && l <= 12 && z >= 1 && z <= 31 && new Date(Date.UTC(a, l - 1, z)).toISOString().slice(0, 10) === s
    return ok ? s : { invalid: s }
  }
  return dataExcel(s)
}
const dataValida = d => typeof d === 'string'

/** „2026-10-28” → „28.10.2026”; altceva → null. */
export function dataRo(iso) {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null
}

// ── 1. normalizarea unui rând de buletin ────────────────────────────────
/**
 * Codul din buletin → identitatea sudurii în ERP (D1: T12S127; D18: R = refacere, altă literă = cod).
 * Nu aruncă: un cod gol / ilizibil / din alt tronson întoarce stare 'nepotrivit' cu motiv.
 * @returns {{stare:'ok'|'nepotrivit', cheie:string|null, cod:string|null, tronson:number|null, nr:number|null,
 *            sufix:string, refacuta:boolean, motiv:string|null, original:string}}
 */
export function normalizeazaRandBuletin(codRaw, tronsonCtx) {
  const original = codRaw === null || codRaw === undefined ? '' : String(codRaw)
  const rez = { stare: 'nepotrivit', cheie: null, cod: null, tronson: null, nr: null, sufix: '', refacuta: false, motiv: null, original }
  const tCtx = tronsonNr(tronsonCtx)
  if (tCtx === null) { rez.motiv = 'fara_tronson_context'; return rez }
  const n = normalizeazaSudura(codRaw, { tronson: tCtx, mod: 'legacy' })
  if (n.stare !== 'ok') { rez.motiv = n.motiv || n.stare; return rez }
  rez.tronson = n.tronson
  rez.nr = n.nr
  rez.sufix = n.sufix
  rez.refacuta = n.refacuta
  if (n.altTronson) { rez.motiv = 'alt_tronson'; return rez }
  rez.stare = 'ok'
  rez.cheie = cheieSudura(n)
  rez.cod = formatSudura(n, { prefix: 'T' })
  return rez
}

// ── 2. comparația a două citiri AI ──────────────────────────────────────
function valoareNumar(v) {
  const x = parseNumar(v)
  if (x === null) return { v: null, incert: false }
  return Number.isFinite(x) ? { v: x, incert: false } : { v: txt(v), incert: true }
}
function valoareData(v) {
  const d = dataIso(v)
  return d === null || dataValida(d) ? { v: d, incert: false } : { v: d.invalid, incert: true }
}
function valoareRezultat(v) {
  const r = normalizeazaRezultat(v)
  if (r === null) return { v: null, incert: true }            // rezultatul e obligatoriu
  return r === 'necunoscut' ? { v: txt(v).toUpperCase(), incert: true } : { v: r, incert: false }
}
const valoareText = v => ({ v: areText(v) ? txt(v) : null, incert: false })

/** Câmpurile comparate pe rând, cu forma canonică a fiecăruia. */
function campuriRand(r) {
  const o = {
    rezultat: valoareRezultat(r?.rezultat),
    data_inspectie: valoareData(r?.data_inspectie),
    observatii: valoareText(r?.observatii),
  }
  if (o.data_inspectie.v === null) o.data_inspectie.incert = true  // fără dată nu se poate ordona (§3 starePeSudura)
  for (const c of CAMPURI_INDICATII) o[c] = valoareNumar(r?.[c])
  return o
}

/** Cheia de potrivire: sudura normalizată + refacere; codurile nepotrivite pe textul lor (nu pe poziție). */
function cheiePotrivire(r, opt) {
  const n = normalizeazaRandBuletin(r?.cod_raw, opt.tronson ?? n0(r?.cod_raw))
  const R = n.refacuta ? 'R' : ''
  if (n.stare === 'ok') return { cheie: `${n.cheie}|${R}`, n }
  // alt tronson: codul e lizibil, deci se potrivește tot pe identitate (TR13 S5 = TR13S5)
  if (n.nr !== null) return { cheie: `alt:${cheieSudura(n)}|${R}`, n }
  return { cheie: `brut:${txt(r?.cod_raw).toUpperCase().replace(/\s+/g, '')}`, n }
}
// fără tronson din context, tronsonul se ia din codul însuși (codurile complete „GAZPET TR12 S127”)
function n0(cod) {
  const n = normalizeazaSudura(cod, { mod: 'legacy' })
  return n.stare === 'ok' ? n.tronson : null
}

function antetComparat(a, b) {
  const nA = areText(a?.numar) ? txt(a.numar).toUpperCase() : null
  const nB = areText(b?.numar) ? txt(b.numar).toUpperCase() : null
  const dA = valoareData(a?.data), dB = valoareData(b?.data)
  return {
    numar: { a: nA, b: nB, egal: nA !== null && nA === nB },
    data: { a: dA.v, b: dB.v, egal: dA.v !== null && !dA.incert && !dB.incert && dA.v === dB.v, incert: dA.incert || dB.incert },
  }
}

/**
 * Compară două citiri independente ale aceluiași buletin. Potrivirea e pe cheia normalizată + refacere.
 * @param {object} citireA
 * @param {object} citireB
 * @param {{tronson?: string|number}} [opt]  tronsonul încărcării (D6); fără el, tronsonul din fiecare cod
 * @returns {{ok:boolean, erori:string[], antet:object, randuri:Array, rezumat:object, incerte:{a:Array,b:Array},
 *            complet:boolean, incomplet:{a:string[],b:string[]}, potrivit_integral:boolean}}
 *   randuri[i].stare ∈ potrivit | diferit | incert | doar_in_A | doar_in_B | dublat
 *   complet=false dacă o citire e trunchiată (partial / pagini_necitite) sau are valori incerte (L12);
 *   potrivit_integral = ok && complet && antet egal && toate rândurile „potrivit” — singurul semnal
 *   că buletinul ÎNTREG se poate marca „potrivit” (rândurile potrivite dintr-o citire parțială nu ajung).
 */
export function comparaCitiri(citireA, citireB, opt = {}) {
  const erori = []
  if (!Array.isArray(citireA?.randuri)) erori.push('citire_a_invalida')
  if (!Array.isArray(citireB?.randuri)) erori.push('citire_b_invalida')
  const sA = semnaleCitire(citireA, 'a', erori), sB = semnaleCitire(citireB, 'b', erori)
  const rez = {
    ok: erori.length === 0, erori,
    antet: antetComparat(citireA?.antet, citireB?.antet),
    randuri: [],
    rezumat: { potrivit: 0, diferit: 0, incert: 0, doar_in_A: 0, doar_in_B: 0, dublat: 0, nepotrivit: 0 },
    incerte: { a: sA.incerte, b: sB.incerte },
    incomplet: { a: sA.incomplet, b: sB.incomplet },
    complet: false,
    potrivit_integral: false,
  }
  if (!rez.ok) return rez

  const grupuri = new Map()   // cheie → { n, a: [], b: [] }, în ordinea primei apariții
  const adauga = (lista, parte) => lista.forEach((r, i) => {
    const { cheie, n } = cheiePotrivire(r, opt)
    if (!grupuri.has(cheie)) grupuri.set(cheie, { n, a: [], b: [] })
    grupuri.get(cheie)[parte].push({ ...(r && typeof r === 'object' ? r : { cod_raw: r }), _index: i })
  })
  adauga(citireA.randuri, 'a')
  adauga(citireB.randuri, 'b')

  for (const [cheie, g] of grupuri) {
    const baza = {
      cheie, cod: g.n.cod, refacuta: g.n.refacuta, nepotrivit: g.n.stare !== 'ok', motiv: g.n.motiv,
    }
    let rand
    if (g.a.length > 1 || g.b.length > 1) {
      // aceeași sudură de două ori într-o citire: nu se împerechează după poziție, decide omul
      rand = { ...baza, stare: 'dublat', a: g.a, b: g.b, campuri: [] }
    } else if (!g.b.length) {
      rand = { ...baza, stare: 'doar_in_A', a: g.a[0], b: null, campuri: [] }
    } else if (!g.a.length) {
      rand = { ...baza, stare: 'doar_in_B', a: null, b: g.b[0], campuri: [] }
    } else {
      const cA = campuriRand(g.a[0]), cB = campuriRand(g.b[0])
      const campuri = Object.keys(cA).filter(k => cA[k].v !== cB[k].v || cA[k].incert !== cB[k].incert)
      const incert = Object.keys(cA).filter(k => cA[k].incert || cB[k].incert)
      const stare = campuri.length ? 'diferit' : incert.length ? 'incert' : 'potrivit'
      rand = { ...baza, stare, a: g.a[0], b: g.b[0], campuri, incert }
    }
    rez.rezumat[rand.stare]++
    if (rand.nepotrivit) rez.rezumat.nepotrivit++
    rez.randuri.push(rand)
  }
  rez.complet = !sA.incomplet.length && !sB.incomplet.length
  rez.potrivit_integral = rez.complet && rez.antet.numar.egal && rez.antet.data.egal
    && rez.randuri.length > 0 && rez.randuri.every(x => x.stare === 'potrivit')
  return rez
}

/**
 * Semnalele de completitudine ale unei citiri (D4 + L12): `incerte` (listă), `partial` (boolean),
 * `pagini_necitite` (listă de numere de pagină). Lipsa câmpului = nimic semnalat; o formă invalidă
 * NU devine tacit „nimic”: se adaugă în erori (comparația iese ok:false).
 */
function semnaleCitire(c, parte, erori) {
  const out = { incerte: [], incomplet: [] }
  if (!c || typeof c !== 'object') return out          // citirea însăși e deja eroare
  const { incerte, partial, pagini_necitite: pn } = c
  if (incerte !== undefined && incerte !== null) {
    if (Array.isArray(incerte)) out.incerte = incerte
    else erori.push(`incerte_${parte}_invalide`)
  }
  if (out.incerte.length) out.incomplet.push(`incerte:${out.incerte.length}`)
  if (partial !== undefined && partial !== null) {
    if (partial === true) out.incomplet.push('partial')
    else if (partial !== false) erori.push(`partial_${parte}_invalid`)
  }
  if (pn !== undefined && pn !== null) {
    if (!Array.isArray(pn) || !pn.every(p => Number.isInteger(p) && p > 0)) erori.push(`pagini_necitite_${parte}_invalide`)
    else if (pn.length) out.incomplet.push(`pagini_necitite:${pn.join(',')}`)
  }
  return out
}

// ── 3. starea pe sudură, din buletinele confirmate ──────────────────────
const STARE_LIPSA = Object.freeze({ stare: 'lipsa', valabil: null, istoric: Object.freeze([]), motiv: null })

/** Id-ul buletinului (bigint din BD: număr întreg sau text din cifre) → BigInt; altceva → null. */
function idBuletin(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v)
  if (typeof v === 'string' && /^\d{1,19}$/.test(v)) return BigInt(v)
  return null
}
function identitateBuletin(r) {
  if (r._idBuletin !== null && r._idBuletin !== undefined) return `id:${r._idBuletin}`
  return `nr:${txt(r.numar).toUpperCase()}|${r._dataBuletin}`
}
const desc = (a, b) => (a === b ? 0 : a > b ? -1 : 1)
const lipsaUltimul = (a, b) => (a === null) - (b === null)
/**
 * Ordinea §22 (R3), descrescătoare: data inspecției; la aceeași dată refacerea înaintea originalului;
 * apoi data buletinului; apoi id-ul buletinului. < 0 = a vine primul. Valorile lipsă merg la coadă
 * (doar ca ordinea să fie stabilă; lipsa lor la departajare dă conflict, vezi stareGrup).
 */
function ordineRezultate(a, b) {
  return lipsaUltimul(a._dataInspectie, b._dataInspectie) || desc(a._dataInspectie, b._dataInspectie)
    || (a._refacuta === b._refacuta ? 0 : a._refacuta ? -1 : 1)
    || lipsaUltimul(a._dataBuletin, b._dataBuletin) || desc(a._dataBuletin, b._dataBuletin)
    || lipsaUltimul(a._idBuletin, b._idBuletin) || desc(a._idBuletin, b._idBuletin)
}

function cheieDinRand(r) {
  if (typeof r.cheie === 'string' && /^\d{1,3}\|\d{1,5}\|[A-Z0-9/]*$/.test(r.cheie)) return r.cheie
  if (r.cheie !== undefined && r.cheie !== null) return null
  if (Number.isInteger(r.tronson) && Number.isInteger(r.nr)) return cheieSudura({ tronson: r.tronson, nr: r.nr, sufix: r.sufix || '' })
  if (r.cod !== undefined) {
    const n = normalizeazaRandBuletin(r.cod, r.tronson)
    return n.stare === 'ok' ? n.cheie : null
  }
  return null
}

function stareGrup(lista) {
  const istoric = lista.slice()
  if (istoric.length > 1 && istoric.some(r => !dataValida(r._dataInspectie))) {
    return { stare: 'conflict', valabil: null, istoric, motiv: 'data_inspectie_lipsa' }
  }
  istoric.sort(ordineRezultate)   // istoric[0] = cel mai recent (§22)
  const prim = istoric[0]
  // grupul de vârf: aceeași dată de inspecție și același atribut de refacere ca primul rând
  const varf = istoric.filter(r => r._dataInspectie === prim._dataInspectie && r._refacuta === prim._refacuta)
  // §22: rezultate diferite în grupul de vârf = conflict, indiferent de data buletinului.
  // (Strict, §22 compară doar primele două rânduri; aici se compară tot grupul de vârf, ca un al treilea
  //  buletin „acceptat” să nu ascundă un „respins” de la aceeași inspecție.)
  if (varf.some(r => r._rezultat !== prim._rezultat)) return { stare: 'conflict', valabil: null, istoric, motiv: 'egalitate' }
  // Același rezultat în buletine diferite (decizia r1, nr. 2): nu e conflict, câștigă cel ales de ordine
  // (data buletinului, apoi id-ul). Dacă ordinea nu se poate stabili, nu se alege tacit.
  if (new Set(varf.map(identitateBuletin)).size > 1) {
    if (varf.some(r => !dataValida(r._dataBuletin))) return { stare: 'conflict', valabil: null, istoric, motiv: 'data_buletin_lipsa' }
    const top = varf.filter(r => r._dataBuletin === prim._dataBuletin)
    if (new Set(top.map(identitateBuletin)).size > 1 && top.some(r => r._idBuletin === null)) {
      return { stare: 'conflict', valabil: null, istoric, motiv: 'id_buletin_lipsa' }
    }
  }
  if (prim._rezultat === 'acceptat') return { stare: 'acceptat', valabil: prim, istoric, motiv: null }
  if (prim._rezultat === 'respins') return { stare: 'respins_fara_refacere', valabil: prim, istoric, motiv: null }
  return { stare: 'conflict', valabil: null, istoric, motiv: 'rezultat_necunoscut' }
}

/**
 * Starea fiecărei suduri pe fiecare metodă, din rândurile buletinelor CONFIRMATE.
 * Rând: { cheie (sau tronson+nr+sufix, sau cod+tronson), metoda, numar, data_buletin, data_inspectie, rezultat,
 *         refacuta, buletin_id?, are_pdf? / cale_pdf?, buletin_stare? }
 * @param {Array} randuriConfirmate
 * @param {{metode?: string[]}} [opt]  metodele completate cu 'lipsa' pe fiecare sudură (implicit PM, PA-UT, UT)
 * @returns {{suduri: Object<string,{cheie, metode: Object<string,{stare, valabil, istoric, motiv}>}>, ignorate: Array<{rand, motiv}>}}
 *   stare ∈ acceptat | respins_fara_refacere | conflict | lipsa; istoric în ordinea §22 (cel mai recent primul)
 */
export function starePeSudura(randuriConfirmate, opt = {}) {
  const ignorate = []
  const grupuri = new Map()   // cheie → Map(metoda → rânduri)
  const metode = new Set((opt.metode || METODE_CENTRALIZATOR).map(normalizeazaMetoda).filter(Boolean))
  for (const r of Array.isArray(randuriConfirmate) ? randuriConfirmate : []) {
    if (!r || typeof r !== 'object') { ignorate.push({ rand: r, motiv: 'rand_invalid' }); continue }
    if (r.buletin_stare !== undefined && r.buletin_stare !== 'confirmat') { ignorate.push({ rand: r, motiv: 'buletin_neconfirmat' }); continue }
    const cheie = cheieDinRand(r)
    if (!cheie) { ignorate.push({ rand: r, motiv: 'cheie_sudura' }); continue }
    const metoda = normalizeazaMetoda(r.metoda)
    if (!metoda) { ignorate.push({ rand: r, motiv: 'metoda_lipsa' }); continue }
    const di = dataIso(r.data_inspectie), db = dataIso(r.data_buletin)
    const rr = {
      ...r, metoda, cheie,
      _dataInspectie: dataValida(di) ? di : null,
      _dataBuletin: dataValida(db) ? db : null,
      _refacuta: r.refacuta === true,
      _rezultat: normalizeazaRezultat(r.rezultat),
      _idBuletin: idBuletin(r.buletin_id),
    }
    metode.add(metoda)
    if (!grupuri.has(cheie)) grupuri.set(cheie, new Map())
    const g = grupuri.get(cheie)
    if (!g.has(metoda)) g.set(metoda, [])
    g.get(metoda).push(rr)
  }
  const suduri = {}
  for (const [cheie, g] of grupuri) {
    const s = { cheie, metode: {} }
    for (const m of metode) s.metode[m] = g.has(m) ? stareGrup(g.get(m)) : STARE_LIPSA
    suduri[cheie] = s
  }
  return { suduri, ignorate, metode: [...metode] }
}

/** Starea unei suduri pe o metodă; cheie necunoscută / metodă fără rânduri → 'lipsa'. */
export function stareMetoda(stare, cheie, metoda) {
  return stare?.suduri?.[cheie]?.metode?.[normalizeazaMetoda(metoda)] || STARE_LIPSA
}

// ── 4. comparația între metode ──────────────────────────────────────────
const areBuletin = s => s.stare !== 'lipsa'
function ordineCheie(a, b) {
  const [ta, na, sa] = a.split('|'), [tb, nb, sb] = b.split('|')
  return Number(ta) - Number(tb) || Number(na) - Number(nb) || (sa < sb ? -1 : sa > sb ? 1 : 0)
}

/**
 * Sudurile care au buletin pe o metodă și nu pe cealaltă (ex. PA-UT vs PM). „Are” = orice stare în afară de 'lipsa'.
 * @returns {{metodaA:string, metodaB:string, doar_in_A:string[], doar_in_B:string[]}}  chei ordonate pe tronson, nr, sufix
 */
export function comparaMetode(stare, metodaA, metodaB) {
  const mA = normalizeazaMetoda(metodaA), mB = normalizeazaMetoda(metodaB)
  const doarA = [], doarB = []
  for (const cheie of Object.keys(stare?.suduri || {})) {
    const a = areBuletin(stareMetoda(stare, cheie, mA)), b = areBuletin(stareMetoda(stare, cheie, mB))
    if (a && !b) doarA.push(cheie)
    else if (b && !a) doarB.push(cheie)
  }
  return { metodaA: mA, metodaB: mB, doar_in_A: doarA.sort(ordineCheie), doar_in_B: doarB.sort(ordineCheie) }
}

// ── 5. coloanele PM / PA-UT / UT din CENTRALIZATOR ──────────────────────
const NIMIC = () => ({ pm: null, pa_ut: null, ut: null })

/** Sudura unui rând de pachet (executie_tevi); separator / fără cod → null. */
function sudaRandului(randPachet, tronsonCtx) {
  if (!randPachet || randPachet.tip_rand === 'separator' || !areText(randPachet.sudura_cod)) return null
  return normalizeazaRandBuletin(randPachet.sudura_cod, tronsonCtx)
}

/** „403/28.10.2026” din buletinul valabil; fără buletin sau cu stare ambiguă (conflict) → null. */
function textBuletin(s) {
  if (!s.valabil) return null
  const d = dataRo(s.valabil._dataBuletin)
  return areText(s.valabil.numar) && d ? `${txt(s.valabil.numar)}/${d}` : null
}

/**
 * Valorile coloanelor K–M pentru un rând de pachet, din arhivă. Se arată buletinul valabil
 * (refacerea acceptată, dacă există; altfel ultimul rezultat, inclusiv respins). Fără buletin → null.
 */
export function coloaneCentralizator(randPachet, stare, tronsonCtx) {
  const out = NIMIC()
  const n = sudaRandului(randPachet, tronsonCtx)
  if (!n || n.stare !== 'ok') return out
  for (const m of METODE_CENTRALIZATOR) out[COLOANA_METODA[m]] = textBuletin(stareMetoda(stare, n.cheie, m))
  return out
}

// ── 6. verificarea înainte de export (§8) ───────────────────────────────
const nrPozitiv = v => { const x = parseNumar(v); return Number.isFinite(x) && x > 0 }
const nrFinit = v => { const x = parseNumar(v); return Number.isFinite(x) ? x : null }
const canonSerie = v => txt(v).toUpperCase().replace(/\s+/g, '')
const areDocument = r => r.are_pdf === true || areText(r.cale_pdf)
const fmtM = x => (Math.round(x * 100) / 100).toLocaleString('ro-RO', { maximumFractionDigits: 2 })

/**
 * Lista lipsurilor înainte de „Export IZO înainte de lansare”.
 * @param {object} p
 * @param {{km_start_m, total_lungime_m?, tronson?, tronson_cod?}} p.pachet
 * @param {Array} p.randuri            rândurile pachetului (executie_tevi), cu poz_in_pachet
 * @param {object} p.stare             rezultatul starePeSudura
 * @param {string[]} p.metodeObligatorii  setarea proiectului (D10); [] = nicio metodă obligatorie
 * @param {object|null} [p.pachetAnterior] pachetul anterior de pe tronson; null = nu există
 * @param {string|number} [p.tronson]  tronsonul pachetului (altfel pachet.tronson / pachet.tronson_cod)
 * @param {Set<string>|string[]} p.eliminate  sudurile eliminate prin tăiere, active (R4): chei „12|126|” sau
 *   coduri „T12S126”, FĂRĂ refacere; [] = niciuna. Lipsă / formă necunoscută = blocaj (L18).
 * @returns {{blocaje: Array, blocajeDeblocabile: Array, avertismente: Array}}  elemente { cod, rand, mesaj }
 *
 * Sudura eliminată (R4): nu i se mai cer buletine (nici PDF-ul lor); rămâne doar verificarea de dublură.
 * Sudura „în șanț” (§8 + decizia proprietarului, r1 nr. 10): tot ce ține de buletinele ei e DOAR avertisment.
 */
export function verificaExport({ pachet, randuri, stare, metodeObligatorii, pachetAnterior = null, tronson, eliminate } = {}) {
  const blocaje = [], blocajeDeblocabile = [], avertismente = []
  const el = (cod, rand, mesaj) => ({ cod, rand: rand ?? null, mesaj })
  const tCtx = tronson ?? pachet?.tronson ?? pachet?.tronson_cod

  // ── setările fără de care verificarea nu are sens (L18: necunoscut ≠ gol)
  if (!Array.isArray(randuri)) blocaje.push(el('randuri_lipsa', null, 'Rândurile pachetului nu s-au putut citi.'))
  if (!Array.isArray(metodeObligatorii)) blocaje.push(el('setare_metode_lipsa', null, 'Metodele obligatorii ale proiectului nu sunt cunoscute.'))
  if (!stare || typeof stare.suduri !== 'object' || stare.suduri === null) blocaje.push(el('stare_buletine_lipsa', null, 'Arhiva de buletine nu s-a putut citi.'))
  if (tronsonNr(tCtx) === null) blocaje.push(el('tronson_lipsa', null, 'Tronsonul pachetului nu e cunoscut.'))
  const elim = cheiEliminate(eliminate, tCtx)
  if (elim.lipsa) blocaje.push(el('eliminate_lipsa', null, 'Lista sudurilor eliminate prin tăiere nu s-a putut citi.'))
  for (const x of elim.invalide) blocaje.push(el('eliminata_invalida', null, `Sudura eliminată „${txt(x)}” nu are o cheie validă (fără „R”, pe tronsonul pachetului).`))

  // ── km start
  const kmStart = nrFinit(pachet?.km_start_m)
  if (kmStart === null) blocaje.push(el('km_start_lipsa', null, 'Lipsește km start al pachetului.'))

  // ── gol de km față de pachetul anterior (toleranță 1 m)
  if (pachetAnterior && kmStart !== null) {
    const kmAnt = nrFinit(pachetAnterior.km_start_m), lAnt = nrFinit(pachetAnterior.total_lungime_m)
    if (kmAnt === null || lAnt === null) {
      avertismente.push(el('km_anterior_necunoscut', null, 'Pachetul anterior nu are km start sau lungimea totală: golul de km nu se poate verifica.'))
    } else {
      const d = kmStart - (kmAnt + lAnt)
      if (Math.abs(d) > 1 + 1e-9) {
        avertismente.push(el('gol_km', null, d > 0
          ? `Gol de ${fmtM(d)} m față de pachetul anterior (acesta se termină la ${fmtM(kmAnt + lAnt)} m).`
          : `Suprapunere de ${fmtM(-d)} m cu pachetul anterior (acesta se termină la ${fmtM(kmAnt + lAnt)} m).`))
      }
    }
  }

  if (!Array.isArray(randuri)) return { blocaje, blocajeDeblocabile, avertismente }
  const obligatorii = Array.isArray(metodeObligatorii) ? [...new Set(metodeObligatorii.map(normalizeazaMetoda).filter(Boolean))] : []
  const areStare = !!(stare && typeof stare.suduri === 'object' && stare.suduri !== null)
  const vazutSerie = new Map(), vazutSudura = new Map()
  const buletineFolosite = new Map()   // identitate buletin → primul rând care îl folosește

  for (const r of randuri) {
    if (!r || r.tip_rand === 'separator') continue
    const poz = r.poz_in_pachet ?? null

    // ── elementul (țeavă / curbă): serie, șarjă, lungime, dimensiune
    if (r.tip_rand === 'teava' || r.tip_rand === 'curba') {
      const lipsa = []
      if (!areText(r.serie_unica)) lipsa.push('serie')
      if (!areText(r.sarja)) lipsa.push('șarjă')
      if (!nrPozitiv(r.lungime_m)) lipsa.push('lungime')
      if (!areText(r.dimensiune)) lipsa.push('dimensiune')
      const fel = r.tip_rand === 'teava' ? 'Țeavă' : 'Curbă'
      if (lipsa.length) blocaje.push(el('element_incomplet', poz, `${fel} fără ${lipsa.join(', ')}.`))
      if (areText(r.serie_unica)) {
        const s = canonSerie(r.serie_unica)
        if (vazutSerie.has(s)) blocaje.push(el('serie_dublata', poz, `Seria ${txt(r.serie_unica)} apare și la rândul ${vazutSerie.get(s) ?? '?'}.`))
        else vazutSerie.set(s, poz)
      }
    }

    // ── sudura rândului
    if (!areText(r.sudura_cod)) continue
    const n = normalizeazaRandBuletin(r.sudura_cod, tCtx)
    if (n.stare !== 'ok') {
      // codul nu se poate lega de arhivă: buletinele lui nu se pot verifica (§12 — curățenie separată)
      blocajeDeblocabile.push(el('sudura_cod_nerecunoscut', poz, `Codul de sudură „${txt(r.sudura_cod)}” nu se poate lega de buletine (${n.motiv}).`))
      continue
    }
    if (vazutSudura.has(n.cheie)) blocaje.push(el('sudura_dublata', poz, `Sudura ${n.cod} apare și la rândul ${vazutSudura.get(n.cheie) ?? '?'}.`))
    else vazutSudura.set(n.cheie, poz)
    if (elim.chei.has(n.cheie)) {
      // R4: eliminată prin tăiere → nu se mai cer buletine; se spune, ca să nu dispară tăcut (L12)
      avertismente.push(el('sudura_eliminata', poz, `Sudura ${n.cod} e eliminată prin tăiere: buletinele ei nu se mai cer.`))
      continue
    }
    const inSant = r.sudura_sant_pending === true
    if (inSant) avertismente.push(el('sudura_in_sant', poz, `Sudura ${n.cod} e marcată „în șanț”: lipsurile de buletin sunt doar avertismente.`))
    if (!areStare) continue
    // în șanț: aceleași coduri, dar în avertismente (nu cer deblocare)
    const deblocabil = inSant ? avertismente : blocajeDeblocabile

    const metodeSudura = new Set([...obligatorii, ...METODE_CENTRALIZATOR, ...Object.keys(stare.suduri[n.cheie]?.metode || {})])
    for (const m of metodeSudura) {
      const s = stareMetoda(stare, n.cheie, m)
      const oblig = obligatorii.includes(m)
      if (s.stare === 'respins_fara_refacere') {
        deblocabil.push(el('respins_fara_refacere', poz, `Sudura ${n.cod}: ultimul rezultat ${m} e „respins”, fără refacere acceptată.`))
      } else if (s.stare === 'conflict') {
        const t = `Sudura ${n.cod}: buletinele ${m} nu se pot ordona (${s.motiv}); alege omul.`
        if (oblig) deblocabil.push(el('buletin_conflict', poz, t))
        else avertismente.push(el('buletin_conflict', poz, t))
      } else if (s.stare === 'lipsa') {
        if (oblig) deblocabil.push(el('buletin_lipsa', poz, `Sudura ${n.cod} n-are buletin ${m} acceptat (metodă obligatorie).`))
        else if (METODE_CENTRALIZATOR.includes(m)) avertismente.push(el('metoda_neobligatorie_lipsa', poz, `Sudura ${n.cod} n-are buletin ${m}.`))
      }
      if (s.valabil) {
        const id = `${m}|${identitateBuletin(s.valabil)}`
        const f = buletineFolosite.get(id)
        if (!f) buletineFolosite.set(id, { poz, b: s.valabil, doarSant: inSant })
        else if (f.doarSant && !inSant) { f.doarSant = false; f.poz = poz }
      }
    }
  }

  // ── buletine folosite fără PDF (unul pe buletin, la primul rând care îl cere; doar în șanț → avertisment)
  for (const { poz, b, doarSant } of buletineFolosite.values()) {
    if (!areDocument(b)) {
      const d = dataRo(b._dataBuletin)
      ;(doarSant ? avertismente : blocajeDeblocabile)
        .push(el('buletin_fara_pdf', poz, `Buletinul ${b.metoda} ${txt(b.numar)}${d ? `/${d}` : ''} n-are PDF.`))
    }
  }
  return { blocaje, blocajeDeblocabile, avertismente }
}

const RE_CHEIE = /^(\d{1,3})\|(\d{1,5})\|([A-Z0-9/]*)$/
/**
 * Sudurile eliminate → mulțimea cheilor (fără refacere). Acceptă cheia „12|126|” sau codul „T12S126”.
 * Nimic nu se pierde tăcut: o intrare care nu dă o cheie validă pe tronsonul pachetului (sau poartă „R”) e întoarsă în `invalide`.
 */
function cheiEliminate(eliminate, tCtx) {
  const out = { chei: new Set(), invalide: [], lipsa: false }
  const lista = eliminate instanceof Set ? [...eliminate] : Array.isArray(eliminate) ? eliminate : null
  if (!lista) { out.lipsa = true; return out }
  const tNr = tronsonNr(tCtx)
  for (const x of lista) {
    const m = typeof x === 'string' ? x.match(RE_CHEIE) : null
    if (m) {
      // sufixul cheii nu poartă refacerea (D18: R final = refacere, nu parte din cod)
      // și forma canonică (fără zerouri în față), altfel n-ar potrivi nicio sudură
      const canon = cheieSudura({ tronson: Number(m[1]), nr: Number(m[2]), sufix: m[3] }) === x
      if (!canon || /R$/.test(m[3]) || (tNr !== null && Number(m[1]) !== tNr)) out.invalide.push(x)
      else out.chei.add(x)
      continue
    }
    const n = typeof x === 'string' ? normalizeazaRandBuletin(x, tCtx) : null
    if (n && n.stare === 'ok' && !n.refacuta) out.chei.add(n.cheie)
    else out.invalide.push(x)
  }
  return out
}
