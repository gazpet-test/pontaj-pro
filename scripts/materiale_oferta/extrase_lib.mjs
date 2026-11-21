// ═══════════════════════════════════════════════════════════════════════════
// extrase_lib.mjs — citirea DETERMINISTĂ (fără AI) a extraselor de resurse din
// programul de devize: un .xls cu formularele C6 (materiale), C7 (manoperă),
// C8 (utilaj) și C9 (transport). Faza 2 „materialele din ofertă”: doar
// previzualizare, nu scrie nimic în ERP.
//
// Reguli:
//  - foaia se recunoaște după marcajul „FORMULAR C6..C9” din primele rânduri, nu după nume
//    (foile de lucru „materiale de comandat” au același antet și același TOTAL → ignorate, raportate);
//  - antetul se verifică pe coloane (cuvinte cheie), altfel eroare explicită (L11, L13);
//  - nimic nu dispare tacit: rândurile nerecunoscute, liniile valorice, UM-urile necunoscute
//    sunt păstrate și marcate `de_verificat`; după TOTAL se acceptă DOAR subsolurile din lista
//    SUBSOL_ADMIS (rândul EURO, „Ofertant”, numele firmei, „Lucrarea se incadreaza in grupa:”,
//    celule numai în afara coloanelor formularului), orice alt rând = nerecunoscut (L12);
//  - foaia e `completa` doar fără niciun motiv structural: rând / linie nerecunoscută (chiar cu
//    valoare 0), gol sau repetare în numerotare, UM necunoscut sau lipsă (C6), TOTAL lipsă /
//    nenumeric / în altă monedă / cu alte celule, TOTAL care nu concordă (L12, L18);
//  - forma pentru import vine din parseExtrasMateriale (aceeași funcție ca ecranul
//    „Materiale” din ERP), cu paritate verificată rând cu rând pe TOATE câmpurile importului,
//    inclusiv forma UM; o linie lipsă din import e diferență, cu excepția omisiunilor admise
//    enumerate în omisiuneAdmisa (L19);
//  - UM se normalizează cu umInfo din devizParser; numerele text cu parseNumar existent (L17).
// ═══════════════════════════════════════════════════════════════════════════

import { umInfo, parseExtrasMateriale } from '../../src/devizParser.js'
import { parseNumar, fmtNr } from '../../src/izoDocumenteLogica.js'

export const VERSIUNE = 'extrase-c6-c9-v2'

async function incarcaXlsx() {
  const _x = await import('xlsx-js-style')
  return _x.default?.read ? _x.default : _x
}

// ── utilitare de celulă ──
const txt = (c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const norm = (c) => txt(c).toLowerCase()
const gol = (r) => !r || !r.some((c) => String(c ?? '').trim() !== '')
// celulă → număr | null (goală) | NaN (text nenumeric: se vede, nu se pierde)
const nrCel = (c) => (c == null || String(c).trim() === '' ? null : parseNumar(c))
const fin = Number.isFinite
const rot2 = (x) => Math.round(x * 100) / 100
// rândul cu indicii de coloană (0 | 1 | 2 | ...) de sub antet
const esteIndex = (r) => [0, 1, 2, 3, 4].every((k) => r[k] === k || String(r[k]).trim() === String(k))

// UM-uri de resurse din C6 pe care umInfo (gândit pentru articolele de lucrări) nu le are.
// Sunt unități reale ale materialelor, deci „cunoscute”; restul (%, ORA la materiale etc.) = de verificat.
const UM_RESURSE = { L: 'l', KWH: 'kwh', SET: 'set', DMP: 'dmp', 'M.STER': 'm.ster' }

/** UM brut → { um canonic, factor spre unitatea de bază, cunoscut } (regula din devizParser + lista de resurse). */
export function umCanonic(token) {
  const sursa = txt(token)
  if (!sursa) return { um: '', factor: 1, cunoscut: false }
  const d = umInfo(sursa)
  if (!d.necunoscut) return { um: d.base, factor: d.f, cunoscut: true }
  const k = sursa.toUpperCase().replace(/\s+/g, '').replace(/\.$/, '')
  if (Object.prototype.hasOwnProperty.call(UM_RESURSE, k)) return { um: UM_RESURSE[k], factor: 1, cunoscut: true }
  return { um: d.base, factor: 1, cunoscut: false }
}

// ── antetele formularelor: cuvintele cheie pe fiecare coloană (null = nu se verifică) ──
const ANTET = {
  C6: ['nr', 'denumirea resursei', 'u.m', 'consumuri', 'pret unitar', 'valoare', 'furnizor'],
  C7: ['nr', 'denumirea meseriei', 'consumuri', 'tarif', 'valoare'],
  C8: ['nr', 'denumirea utilajului', 'consumuri', 'tarif', 'valoare'],
  C9: ['nr', 'tip', 'elemente rezultate', null, null, 'tarif unitar', 'valoare'],
}
// coloana valorii (și a monedei, imediat la stânga ei, pe rândul TOTAL)
const COL_VAL = { C6: 5, C7: 4, C8: 4, C9: 6 }
// lățimea formularului (coloanele A.. din formularul tipărit, inclusiv cea a semnăturii „Ofertant”);
// coloanele de dincolo (ex. „Greutate” / „Valoare justificată” în H la C6) sunt suplimentare
export const LATIME = { C6: 7, C7: 6, C8: 5, C9: 7 }
export const CATEGORIE = { C6: 'materiale', C7: 'manopera', C8: 'utilaj', C9: 'transport' }

// Subsolurile admise după TOTAL (lista ÎNCHISĂ; orice alt rând nevid de după TOTAL = nerecunoscut).
// Textele: o singură celulă nevidă în coloanele formularului, cu textul exact (ancorat).
export const SUBSOL_TEXT = [
  ['ofertant', /^Ofertant:?$/i],
  ['firma', /^S\.?C\.?[ ]+[A-Z0-9][A-Z0-9 .&-]*[ ]+S\.?R\.?L\.?$/i],
  ['grupa', /^Lucrarea se incadreaza in grupa:?$/i],
]
/**
 * Clasifică un rând nevid de după TOTAL: 'euro' (moneda EURO + număr pe coloanele totalului, o singură dată),
 * 'ofertant' / 'firma' / 'grupa' (text admis, singur), 'coloane_suplimentare' (nimic în coloanele formularului),
 * altfel null (= nerecunoscut, rămâne în raport și face foaia incompletă).
 */
export function clasificaSubsol(r, formular, { euroVazut = false } = {}) {
  const lat = LATIME[formular], cv = COL_VAL[formular]
  const cel = []
  for (let k = 0; k < lat; k++) if (String(r?.[k] ?? '').trim() !== '') cel.push([k, r[k]])
  if (!cel.length) return 'coloane_suplimentare'
  if (cel.length === 2 && cel[0][0] === cv - 1 && cel[1][0] === cv && txt(cel[0][1]).toUpperCase() === 'EURO' && fin(nrCel(cel[1][1]))) {
    return euroVazut ? null : 'euro'
  }
  if (cel.length === 1 && typeof cel[0][1] === 'string') {
    const t = txt(cel[0][1])
    for (const [tip, re] of SUBSOL_TEXT) if (re.test(t)) return tip
  }
  return null
}

function gasesteAntet(rows, formular) {
  const kw = ANTET[formular]
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || []
    if (!norm(r[0]).startsWith('nr')) continue
    if (kw.every((k, c) => k == null || norm(r[c]).includes(k))) return i
  }
  return -1
}

/** formularul declarat în primele 3 rânduri („FORMULAR C6”), altfel null */
export function formularFoaie(rows) {
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    for (const c of rows[i] || []) {
      const m = txt(c).toUpperCase().match(/^FORMULAR[ ]+(C[6-9])$/)
      if (m) return m[1]
    }
  }
  return null
}

const brut = (r) => JSON.stringify((r || []).slice(0, 8).map((c) => (typeof c === 'number' ? c : txt(c))))
export const MOTIV_DUPA_TOTAL = 'rând după TOTAL care nu e subsol admis'

/**
 * Forma UM pe care o scrie importul din ERP (parseExtrasMateriale): textul celulei, trim, litere mici, fără punctul final.
 * E AȘTEPTAREA independentă a paritații (contractul importului), verificată în teste pe cazuri scrise de mână.
 */
export const umFormaImport = (c) => String(c ?? '').trim().toLowerCase().replace(/\.$/, '')

// corpul foii: rândurile dintre antet și TOTAL, totalul tipărit (RON, eventual EURO), subsolul.
// După TOTAL: subsolurile admise (clasificaSubsol) se păstrează în `subsol` cu tipul lor; restul → `dupaTotal`.
function imparteCorp(rows, h, formular, origine) {
  const colVal = COL_VAL[formular]
  const corp = [], structura = [], dupaTotal = [], subsol = []
  const total = { rand: null, moneda: '', ron: null, euro: null, alte_celule: [] }
  let i = h + 1
  for (; i < rows.length; i++) {
    const r = rows[i] || []
    if (gol(r)) continue
    const rand = origine + i + 1
    if (esteIndex(r)) { structura.push(rand); continue }
    if (txt(r[1]).toUpperCase() === 'TOTAL') {
      total.rand = rand; total.moneda = txt(r[colVal - 1]); total.ron = nrCel(r[colVal])
      // rândul TOTAL nu are altceva în coloanele formularului (în afară de eticheta, moneda și valoarea lui)
      for (let k = 0; k < LATIME[formular]; k++) {
        if (k !== 1 && k !== colVal - 1 && k !== colVal && String(r[k] ?? '').trim() !== '') total.alte_celule.push(k)
      }
      i++
      break
    }
    corp.push({ r, rand })
  }
  for (; i < rows.length; i++) {
    const r = rows[i] || []
    if (gol(r)) continue
    const rand = origine + i + 1
    const tip = clasificaSubsol(r, formular, { euroVazut: total.euro != null })
    if (tip === 'euro') total.euro = nrCel(r[colVal])
    if (tip) subsol.push({ rand, tip, brut: brut(r) })
    else dupaTotal.push({ r, rand })
  }
  return { corp, structura, total, subsol, dupaTotal }
}

// verificările de valoare comune: lipsă / nenumeric / negativ
function verificaNumar(x, nume, motive, { zeroSuspect = false } = {}) {
  if (x === null) motive.push(`${nume} lipsă`)
  else if (Number.isNaN(x)) motive.push(`${nume} nenumeric`)
  else if (x < 0) motive.push(`${nume} negativ`)
  else if (zeroSuspect && x === 0) motive.push(`${nume} 0`)
}
// valoare = cantitate × preț; celulele au precizie întreagă (nu valori tipărite rotunjite), deci
// toleranța e doar cea a rotunjirii valorii: max(1 ban, 1 ppm din valoare). Pe cele 7 extrase reale abaterea maximă e 0,0075.
export function verificaProdus(cant, pret, val, motive) {
  if (!fin(cant) || !fin(pret) || !fin(val)) return
  const dif = cant * pret - val
  if (Math.abs(dif) > Math.max(0.01, 1e-6 * Math.abs(val))) motive.push(`valoare ≠ cantitate × preț (dif. ${rot2(dif)})`)
}

function marcheazaDuplicate(linii, cheie, eticheta) {
  const grup = new Map()
  for (const l of linii) {
    const k = cheie(l)
    if (!k) continue
    if (!grup.has(k)) grup.set(k, [])
    grup.get(k).push(l)
  }
  for (const g of grup.values()) {
    if (g.length < 2) continue
    for (const l of g) l.motive.push(`${eticheta} (rândurile ${g.map((x) => x.rand).join(', ')})`)
  }
}

// lista celor lipsă dintr-o mulțime de întregi 1..max
const lipsaDin = (set, max) => { const o = []; for (let k = 1; k <= max; k++) if (!set.has(k)) o.push(k); return o }
// valorile care apar de mai multe ori (ordinea primei apariții)
const repetate = (xs) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))]

// numerele de ordine: repetate / lipsă (numitor determinist pentru completitudine)
function verificaNrCrt(linii) {
  const nrs = linii.map((l) => Number(l.nr_crt)).filter(fin)
  marcheazaDuplicate(linii, (l) => l.nr_crt, 'nr. crt. repetat')
  const max = nrs.length ? Math.max(...nrs) : 0
  return { primul: nrs.length ? Math.min(...nrs) : null, ultimul: max || null, lipsa: lipsaDin(new Set(nrs), max), repetate: repetate(linii.map((l) => l.nr_crt)), orfane: [] }
}

// C9: categoriile (1, 2, ...) continue; detaliile fiecărei categorii (1.001, 1.002, ...) continue și sub o categorie existentă
function verificaNrC9(linii) {
  const cat = linii.filter((l) => l.tip === 'subtotal').map((l) => Number(l.nr_crt))
  const maxCat = cat.length ? Math.max(...cat) : 0
  const lipsa = lipsaDin(new Set(cat), maxCat).map(String), orfane = []
  const det = new Map()
  for (const l of linii) {
    const m = l.nr_crt.match(/^(\d+)\.(\d+)$/)
    if (!m) continue
    if (!cat.includes(Number(m[1]))) orfane.push(l.nr_crt)
    if (!det.has(m[1])) det.set(m[1], { lat: m[2].length, nrs: [] })
    det.get(m[1]).nrs.push(Number(m[2]))
  }
  for (const [c, { lat, nrs }] of det) for (const k of lipsaDin(new Set(nrs), Math.max(...nrs))) lipsa.push(`${c}.${String(k).padStart(lat, '0')}`)
  return { primul: cat.length ? Math.min(...cat) : null, ultimul: maxCat || null, lipsa, repetate: repetate(linii.map((l) => l.nr_crt)), orfane }
}

function totaluri(linii, total, tipuriInTotal) {
  const suma = rot2(linii.filter((l) => tipuriInTotal.includes(l.tip) && fin(l.valoare)).reduce((s, l) => s + l.valoare, 0))
  const motive = []
  if (total.rand == null) motive.push('fără rând TOTAL tipărit')
  else {
    if (!fin(total.ron)) motive.push('TOTAL tipărit nenumeric')
    // moneda se verifică pe lista albă (RON); lipsa ei nu e „RON” (L18)
    if (total.moneda.toUpperCase() !== 'RON') motive.push(`moneda TOTAL = ${total.moneda || 'lipsă'} (aștept RON)`)
    if (total.alte_celule.length) motive.push(`rândul TOTAL are și alte celule (coloanele ${total.alte_celule.join(', ')})`)
  }
  const diferenta = fin(total.ron) ? rot2(suma - total.ron) : null
  // lipsa totalului NU e concordanță: rămâne necunoscut (null)
  const concorda = diferenta == null ? null : Math.abs(diferenta) <= 0.01
  return { suma, total_tiparit: fin(total.ron) ? total.ron : null, total_euro: fin(total.euro) ? total.euro : null, rand_total: total.rand, diferenta, concorda, motive }
}

/**
 * Motivele STRUCTURALE pentru care o foaie nu e citită complet (lista goală = completă).
 * Liniile doar „ciudate” (cantitate 0, cod duplicat, linie valorică) rămân `de_verificat`, dar nu fac foaia incompletă:
 * ele sunt citite integral; aici intră doar ce înseamnă că nu știm sigur ce conține foaia.
 */
export function motiveIncomplet(s) {
  const m = []
  if (s.nerecunoscute.length) m.push(`${s.nerecunoscute.length} rânduri nerecunoscute (rândurile ${s.nerecunoscute.map((n) => n.rand).join(', ')})`)
  const ner = s.linii.filter((l) => l.tip === 'nerecunoscut')
  if (ner.length) m.push(`${ner.length} linii nerecunoscute (rândurile ${ner.map((l) => l.rand).join(', ')})`)
  if (s.nr_crt) {
    if (s.nr_crt.lipsa.length) m.push(`numerotare cu goluri: lipsesc ${s.nr_crt.lipsa.slice(0, 20).join(', ')}${s.nr_crt.lipsa.length > 20 ? ` (+${s.nr_crt.lipsa.length - 20})` : ''}`)
    if (s.nr_crt.repetate.length) m.push(`numere repetate: ${s.nr_crt.repetate.join(', ')}`)
    if (s.nr_crt.orfane.length) m.push(`detalii fără categorie: ${s.nr_crt.orfane.join(', ')}`)
  }
  const um = s.linii.filter((l) => l.um_problema)
  if (um.length) m.push(`UM necunoscut sau lipsă pe ${um.length} ${um.length === 1 ? 'linie' : 'linii'} (rândurile ${um.map((l) => l.rand).join(', ')})`)
  for (const x of s.motive) m.push(x)
  if (s.concorda === false) m.push(`suma liniilor diferă de TOTAL cu ${rot2(s.diferenta)}`)
  else if (s.concorda !== true) m.push('comparația cu TOTAL necunoscută (fără total numeric)')
  return m
}
function inchide(s) { s.motive_incomplet = motiveIncomplet(s); s.completa = s.motive_incomplet.length === 0; return s }

function stareLinie(l) { l.stare = l.motive.length ? 'de_verificat' : 'ok'; return l }

// ── C6: materiale ──
export function citesteC6(rows, { foaie = 'materiale', origine = 0 } = {}) {
  const h = gasesteAntet(rows, 'C6')
  if (h < 0) throw new Error(`antetul C6 nu are coloanele așteptate (Nr / Denumirea resursei / U.M. / Consumuri / Pret unitar / Valoare / Furnizor) în foaia „${foaie}”`)
  const colH = txt(rows[h][7])
  const { corp, structura, total, subsol, dupaTotal } = imparteCorp(rows, h, 'C6', origine)
  const linii = [], nerecunoscute = []
  for (const { r, rand } of corp) {
    const nr = txt(r[0])
    if (!/^\d+$/.test(nr)) { nerecunoscute.push({ rand, motiv: 'rând fără nr. crt. întreg între antet și TOTAL', brut: brut(r) }); continue }
    // denumirea și codul exact ca în parseExtrasMateriale (paritatea le compară)
    const d = String(r[1] ?? '').trim()
    const mc = d.match(/^(\d{5,})\s+(.*)$/)
    const umSursa = txt(r[2])
    const u = umCanonic(umSursa)
    const cant = nrCel(r[3]), pret = nrCel(r[4]), val = nrCel(r[5])
    const l = {
      foaie, rand, nr_crt: nr, cod: mc ? mc[1] : '', denumire: (mc ? mc[2] : d).slice(0, 200).trim(), denumire_sursa: d,
      um_sursa: umSursa, um_forma_import: umFormaImport(r[2]), um: u.um, factor_um: u.factor,
      cantitate: cant, cantitate_um_baza: fin(cant) ? (u.factor === 1 ? cant : Math.round(cant * u.factor * 1e6) / 1e6) : null,
      pret_unitar: pret, valoare: val, furnizor: String(r[6] ?? '').trim(), coloana_h: txt(r[7]),
      tip: fin(cant) ? 'material' : (cant === null && fin(val) && /^LEI\.?$/i.test(umSursa) ? 'valoric' : 'nerecunoscut'),
      um_problema: false, import_erp: null, motive: [], brut: '',
    }
    if (l.tip === 'material') {
      if (!/[A-Za-z]/.test(l.denumire)) l.motive.push('denumire goală')
      if (!l.cod) l.motive.push('fără cod de resursă')
      if (!umSursa) { l.motive.push('UM lipsă'); l.um_problema = true }
      else if (!u.cunoscut) { l.motive.push(`UM necunoscut (${umSursa})`); l.um_problema = true }
      verificaNumar(cant, 'cantitate', l.motive, { zeroSuspect: true })
      verificaNumar(pret, 'preț unitar', l.motive)
      verificaNumar(val, 'valoare', l.motive)
      verificaProdus(cant, pret, val, l.motive)
      if (d.length > 200) l.motive.push('denumire peste 200 de caractere (importul o taie)')
    } else if (l.tip === 'valoric') {
      l.motive.push('linie valorică fără cantitate (material mărunt / diferență de preț)')
      verificaNumar(val, 'valoare', l.motive)
    } else {
      l.motive.push(Number.isNaN(cant) ? 'cantitate nenumerică' : 'rând fără cantitate, nu e linie valorică')
      l.brut = brut(r)
    }
    linii.push(l)
  }
  for (const { r, rand } of dupaTotal) nerecunoscute.push({ rand, motiv: MOTIV_DUPA_TOTAL, brut: brut(r) })
  marcheazaDuplicate(linii, (l) => l.cod, 'cod duplicat')
  marcheazaDuplicate(linii, (l) => (l.cod ? '' : l.denumire.toUpperCase() + '|' + l.um_sursa.toUpperCase()), 'denumire duplicată fără cod')
  const nrCrt = verificaNrCrt(linii)
  const tot = totaluri(linii, total, ['material', 'valoric'])
  linii.forEach(stareLinie)
  return inchide({ formular: 'C6', foaie, rand_antet: origine + h + 1, coloana_h: colH, linii, nerecunoscute, randuri_index: structura, subsol, nr_crt: nrCrt, ...tot })
}

// ── C7 manoperă / C8 utilaj: nr | denumire | consum (ore) | tarif | valoare ──
export function citesteResurse(rows, formular, { foaie = CATEGORIE[formular], origine = 0 } = {}) {
  if (formular !== 'C7' && formular !== 'C8') throw new Error(`citesteResurse: formular ${formular} nesuportat`)
  const h = gasesteAntet(rows, formular)
  if (h < 0) throw new Error(`antetul ${formular} nu are coloanele așteptate în foaia „${foaie}”`)
  const um = formular === 'C7' ? 'om-ore' : 'ore'
  const { corp, structura, total, subsol, dupaTotal } = imparteCorp(rows, h, formular, origine)
  const linii = [], nerecunoscute = []
  for (const { r, rand } of corp) {
    const nr = txt(r[0])
    if (!/^\d+$/.test(nr)) { nerecunoscute.push({ rand, motiv: 'rând fără nr. crt. întreg între antet și TOTAL', brut: brut(r) }); continue }
    const cant = nrCel(r[2]), pret = nrCel(r[3]), val = nrCel(r[4])
    const l = {
      foaie, categorie: CATEGORIE[formular], rand, nr_crt: nr, denumire: txt(r[1]), um,
      cantitate: cant, km: null, ore: null, pret_unitar: pret, valoare: val,
      tip: fin(cant) ? 'resursa' : (cant === null && fin(val) ? 'valoric' : 'nerecunoscut'), motive: [], brut: '',
    }
    if (l.tip === 'resursa') {
      if (!/[A-Za-z]/.test(l.denumire)) l.motive.push('denumire goală')
      verificaNumar(cant, 'cantitate', l.motive, { zeroSuspect: true })
      verificaNumar(pret, 'tarif', l.motive)
      verificaNumar(val, 'valoare', l.motive)
      verificaProdus(cant, pret, val, l.motive)
    } else if (l.tip === 'valoric') {
      l.motive.push('linie valorică fără cantitate (diferență de preț / cheltuieli)')
      verificaNumar(val, 'valoare', l.motive)
    } else { l.motive.push('rând nerecunoscut'); l.brut = brut(r) }
    linii.push(l)
  }
  for (const { r, rand } of dupaTotal) nerecunoscute.push({ rand, motiv: MOTIV_DUPA_TOTAL, brut: brut(r) })
  const nrCrt = verificaNrCrt(linii)
  const tot = totaluri(linii, total, ['resursa', 'valoric'])
  linii.forEach(stareLinie)
  return inchide({ formular, foaie, rand_antet: origine + h + 1, linii, nerecunoscute, randuri_index: structura, subsol, nr_crt: nrCrt, ...tot })
}

// ── C9 transport: subtotaluri pe categorie (nr întreg) + detalii (nr „1.001”) ──
export function citesteC9(rows, { foaie = 'transport', origine = 0 } = {}) {
  const h = gasesteAntet(rows, 'C9')
  if (h < 0) throw new Error(`antetul C9 nu are coloanele așteptate în foaia „${foaie}”`)
  const sub = rows[h + 1] || []
  if (!(norm(sub[2]).includes('tone') && norm(sub[3]).includes('km') && norm(sub[4]).includes('ore'))) {
    throw new Error(`sub-antetul C9 (Tone / km / ore) lipsește în foaia „${foaie}”`)
  }
  const { corp, structura, total, subsol, dupaTotal } = imparteCorp(rows, h + 1, 'C9', origine)
  const linii = [], nerecunoscute = []
  for (const { r, rand } of corp) {
    const nr = txt(r[0])
    const detaliu = /^\d+\.\d+$/.test(nr), subtotal = /^\d+$/.test(nr)
    if (!detaliu && !subtotal) { nerecunoscute.push({ rand, motiv: 'rând fără nr. de transport între antet și TOTAL', brut: brut(r) }); continue }
    const tone = nrCel(r[2]), km = nrCel(r[3]), ore = nrCel(r[4]), pret = nrCel(r[5]), val = nrCel(r[6])
    const l = {
      foaie, categorie: 'transport', rand, nr_crt: nr, denumire: txt(r[1]), um: 'tone',
      cantitate: tone, km, ore, pret_unitar: pret, valoare: val,
      tip: subtotal ? 'subtotal' : (fin(tone) ? 'resursa' : (tone === null && fin(val) ? 'valoric' : 'nerecunoscut')), motive: [], brut: '',
    }
    if (l.tip === 'resursa') {
      verificaNumar(tone, 'tone', l.motive, { zeroSuspect: true })
      verificaNumar(pret, 'tarif', l.motive)
      verificaNumar(val, 'valoare', l.motive)
      if (km === null && ore === null) verificaProdus(tone, pret, val, l.motive)
    } else if (l.tip === 'valoric') {
      l.motive.push('linie valorică fără tone (diferență de preț)')
    } else if (l.tip === 'nerecunoscut') { l.motive.push('rând nerecunoscut'); l.brut = brut(r) }
    linii.push(l)
  }
  for (const { r, rand } of dupaTotal) nerecunoscute.push({ rand, motiv: MOTIV_DUPA_TOTAL, brut: brut(r) })
  // subtotalul fiecărei categorii = suma detaliilor ei („1” ← „1.001”, „1.002”, ...)
  for (const s of linii.filter((l) => l.tip === 'subtotal')) {
    const det = linii.filter((l) => l.tip !== 'subtotal' && l.nr_crt.startsWith(s.nr_crt + '.') && fin(l.valoare))
    const suma = rot2(det.reduce((t, l) => t + l.valoare, 0))
    if (!fin(s.valoare)) { if (det.length) s.motive.push('subtotal fără valoare') }
    else if (Math.abs(suma - s.valoare) > 0.01) s.motive.push(`subtotal ≠ suma detaliilor (${rot2(s.valoare)} vs ${suma})`)
  }
  marcheazaDuplicate(linii, (l) => l.nr_crt, 'nr. repetat')
  const nrCrt = verificaNrC9(linii)
  const tot = totaluri(linii, total, ['resursa', 'valoric'])
  linii.forEach(stareLinie)
  return inchide({ formular: 'C9', foaie, rand_antet: origine + h + 1, linii, nerecunoscute, randuri_index: structura, subsol, nr_crt: nrCrt, ...tot })
}

// ── paritatea cu importul din ERP (parseExtrasMateriale) ──
const acelasiNr = (a, b) => (a == null && b == null) || (fin(a) && fin(b) && a === b)
// câmpurile unui rând din parseExtrasMateriale; o cheie în plus / în minus = paritate eșuată (contractul s-a schimbat)
export const CHEI_IMPORT = ['cantitate', 'cod', 'denumire', 'deviz_cod', 'deviz_nume', 'furnizor', 'nr', 'obiect_cod', 'obiect_nume', 'pret_unitar', 'um', 'valoare']
const CONSTANTE_IMPORT = { obiect_cod: '', obiect_nume: 'MATERIALE (extras C6)', deviz_cod: '', deviz_nume: '' }

/**
 * Omisiunile ADMISE: liniile C6 pe care importul din ERP le sare prin regula lui documentată (rândul gol de cantitate,
 * denumirea fără litere, UM gol). Lista e închisă: orice altă linie C6 fără pereche în import = linie pierdută = paritate eșuată.
 * Întoarce motivul omisiunii sau null.
 */
export function omisiuneAdmisa(l) {
  if (l.cantitate === null) return 'fără cantitate'
  if (!/[A-Za-z]/.test(l.denumire_sursa)) return 'denumire fără litere'
  if (!String(l.um_forma_import)) return 'UM gol'
  return null
}

/**
 * Leagă fiecare linie C6 de rândul pe care l-ar insera importul actual din ERP (aceeași ordine a rândurilor).
 * Paritatea e eșuată la: orice câmp diferit (nr, cod, denumire, UM în forma importului, cantitate, valoare, preț, furnizor,
 * constantele, setul de chei), linie C6 lipsă din import în afara omisiunilor admise, rând importat fără pereche.
 */
export function aplicaParitate(c6, importate) {
  const dif = [], lipsa = [], omise = []
  let j = 0
  for (const l of c6.linii) {
    const imp = importate[j]
    if (imp && imp.nr === l.nr_crt.padStart(3, '0') && imp.denumire === l.denumire) {
      j++
      l.import_erp = imp
      const campuri = []
      if (JSON.stringify(Object.keys(imp).sort()) !== JSON.stringify(CHEI_IMPORT)) campuri.push('chei')
      for (const [k, v] of Object.entries(CONSTANTE_IMPORT)) if (imp[k] !== v) campuri.push(k)
      if (imp.cod !== l.cod) campuri.push('cod')
      if (imp.um !== l.um_forma_import) campuri.push('um')
      if (!acelasiNr(imp.cantitate, l.cantitate)) campuri.push('cantitate')
      if (!acelasiNr(imp.valoare, fin(l.valoare) ? l.valoare : null)) campuri.push('valoare')
      if (!acelasiNr(imp.pret_unitar, fin(l.pret_unitar) ? l.pret_unitar : null)) campuri.push('pret_unitar')
      if (imp.furnizor !== (l.furnizor || null)) campuri.push('furnizor')
      if (campuri.length) { l.motive.push(`importul din ERP citește altfel: ${campuri.join(', ')}`); dif.push({ rand: l.rand, campuri }) }
    } else {
      const motiv = omisiuneAdmisa(l)
      if (motiv) {
        l.motive.push(`importul din ERP sare rândul (${motiv}; valoarea lui nu ajunge în ERP)`)
        omise.push({ rand: l.rand, nr: l.nr_crt, motiv })
      } else {
        l.motive.push('importul din ERP nu are linia (pierdută)')
        lipsa.push({ rand: l.rand, nr: l.nr_crt })
      }
    }
    stareLinie(l)
  }
  const fara_pereche = importate.slice(j).map((x) => x.nr)
  const valoareImport = rot2(importate.reduce((s, a) => s + (fin(a.valoare) ? a.valoare : 0), 0))
  return {
    ok: dif.length === 0 && lipsa.length === 0 && fara_pereche.length === 0,
    linii_import: importate.length, valoare_import: valoareImport, diferente: dif, linii_lipsa: lipsa, omise_admise: omise, fara_pereche,
  }
}

// ── tot fișierul ──
/**
 * Citește un extras (.xls/.xlsx) din memorie. Întoarce foile C6..C9 citite, foile ignorate, erorile și paritatea.
 * `completa` = fără erori, C6 citit, fiecare foaie C6..C9 citită fără motive structurale (motiveIncomplet)
 * și paritate cu importul; `motive_incomplet` spune de ce nu (lista goală ⇔ completa).
 * Orice eroare de citire / parsare (inclusiv a importului din ERP) intră în `erori`.
 */
export async function citesteExtras(buf) {
  const XLSX = await incarcaXlsx()
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const wb = XLSX.read(u8, { type: 'array' })
  const foi = {}, ignorate = [], erori = []
  for (const nume of wb.SheetNames) {
    const ws = wb.Sheets[nume]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: true })
    const origine = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0
    const f = formularFoaie(rows)
    if (!f) {
      ignorate.push({ foaie: nume, randuri: rows.filter((r) => !gol(r)).length, motiv: 'fără marcaj „FORMULAR C6–C9” (foaie de lucru, nu face parte din formularele ofertei)' })
      continue
    }
    if (foi[f]) { erori.push({ foaie: nume, mesaj: `al doilea ${f} (primul e „${foi[f].foaie}”): nu aleg singur` }); continue }
    try {
      foi[f] = f === 'C6' ? citesteC6(rows, { foaie: nume, origine })
        : f === 'C9' ? citesteC9(rows, { foaie: nume, origine })
          : citesteResurse(rows, f, { foaie: nume, origine })
      if (nume.toLowerCase() !== CATEGORIE[f]) foi[f].nume_neasteptat = true
    } catch (e) { erori.push({ foaie: nume, mesaj: e.message }) }
  }
  let paritate = null
  if (!foi.C6) erori.push({ foaie: '', mesaj: 'lipsește formularul C6 (materiale)' })
  else {
    try {
      const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
      const importate = await parseExtrasMateriale({ arrayBuffer: async () => ab })
      paritate = aplicaParitate(foi.C6, importate)
    } catch (e) {
      paritate = { ok: false, eroare: e.message, linii_import: 0, valoare_import: null, diferente: [], linii_lipsa: [], omise_admise: [], fara_pereche: [] }
      erori.push({ foaie: foi.C6.foaie, mesaj: `importul din ERP (parseExtrasMateriale) nu citește fișierul: ${e.message}` })
    }
  }
  const motive_incomplet = erori.map((e) => `eroare${e.foaie ? ` (foaia „${e.foaie}”)` : ''}: ${e.mesaj}`)
  for (const f of ['C6', 'C7', 'C8', 'C9']) if (foi[f]) for (const m of foi[f].motive_incomplet) motive_incomplet.push(`${f}: ${m}`)
  if (paritate && !paritate.eroare && !paritate.ok) {
    motive_incomplet.push(`paritate cu importul din ERP eșuată (${paritate.diferente.length} rânduri cu câmpuri diferite, ${paritate.linii_lipsa.length} linii lipsă din import, ${paritate.fara_pereche.length} importate fără pereche)`)
  }
  const completa = !!foi.C6 && !!paritate?.ok && motive_incomplet.length === 0
  return { versiune: VERSIUNE, foi, ignorate, erori, paritate, completa, motive_incomplet }
}

// ── ieșiri: TSV (zecimale cu punct, pentru import) și rezumat Markdown (format RO) ──
const celTsv = (v) => (v == null ? '' : typeof v === 'number' ? (fin(v) ? String(v) : '#NENUMERIC') : String(v).replace(/[\t\r\n]+/g, ' ').trim())
const linieTsv = (arr) => arr.map(celTsv).join('\t')

export const COLOANE_MATERIALE = ['proiect', 'fisier', 'foaie', 'rand', 'nr_crt', 'cod_resursa', 'denumire', 'um_sursa', 'um_import', 'um', 'factor_um',
  'cantitate', 'cantitate_um_baza', 'pret_unitar', 'valoare', 'furnizor', 'coloana_h', 'tip', 'import_erp', 'stare', 'motive', 'text_brut']
export function tsvMateriale(proiect, fisier, c6) {
  const out = [COLOANE_MATERIALE.join('\t')]
  for (const l of c6.linii) {
    out.push(linieTsv([proiect, fisier, l.foaie, l.rand, l.nr_crt, l.cod, l.denumire, l.um_sursa, l.import_erp?.um ?? '', l.um, l.factor_um,
      l.cantitate, l.cantitate_um_baza, l.pret_unitar, l.valoare, l.furnizor, l.coloana_h, l.tip, l.import_erp ? 'da' : 'nu', l.stare, l.motive.join('; '), l.brut]))
  }
  for (const n of c6.nerecunoscute) out.push(linieTsv([proiect, fisier, c6.foaie, n.rand, '', '', '', '', '', '', '', null, null, null, null, '', '', 'nerecunoscut', 'nu', 'de_verificat', n.motiv, n.brut]))
  return out.join('\n') + '\n'
}

export const COLOANE_RESURSE = ['proiect', 'fisier', 'foaie', 'categorie', 'rand', 'nr_crt', 'denumire', 'um', 'cantitate', 'km', 'ore', 'pret_unitar', 'valoare', 'tip', 'stare', 'motive', 'text_brut']
export function tsvResurse(proiect, fisier, foi) {
  const out = [COLOANE_RESURSE.join('\t')]
  for (const f of ['C7', 'C8', 'C9']) {
    const s = foi[f]
    if (!s) continue
    for (const l of s.linii) out.push(linieTsv([proiect, fisier, l.foaie, l.categorie, l.rand, l.nr_crt, l.denumire, l.um, l.cantitate, l.km, l.ore, l.pret_unitar, l.valoare, l.tip, l.stare, l.motive.join('; '), l.brut]))
    for (const n of s.nerecunoscute) out.push(linieTsv([proiect, fisier, s.foaie, CATEGORIE[f], n.rand, '', '', '', null, null, null, null, null, 'nerecunoscut', 'de_verificat', n.motiv, n.brut]))
  }
  return out.join('\n') + '\n'
}

const lei = (x) => (x == null ? '—' : fmtNr(x, 2))
const concText = (s) => (s.concorda === true ? 'concordă' : s.concorda === false ? `**diferă cu ${lei(s.diferenta)}**` : '**necunoscut** (' + (s.motive.join(', ') || 'fără total') + ')')

/** secțiunea de rezumat a unui proiect */
export function rezumatProiect({ proiect, fisier, sha256, rez }) {
  const r = []
  r.push(`## ${proiect} — \`${fisier}\``, '')
  r.push(`- SHA-256: \`${sha256}\``)
  r.push(`- Stare: ${rez.completa ? '**completă** (C6–C9 citite integral, totalurile concordă, importul ERP are aceleași linii)' : '**incompletă**, din motivele:'}`)
  for (const m of rez.motive_incomplet) r.push(`  - ${m}`)
  for (const g of rez.ignorate) r.push(`- Foaie ignorată „${g.foaie}” (${g.randuri} rânduri nevide): ${g.motiv}`)
  const c6 = rez.foi.C6
  if (c6) {
    const pe = (t) => c6.linii.filter((l) => l.tip === t).length
    const sus = c6.linii.filter((l) => l.stare === 'de_verificat')
    r.push('', `### Materiale (C6, foaia „${c6.foaie}”, antet pe rândul ${c6.rand_antet})`, '')
    r.push(`| | |`, `|---|---|`)
    r.push(`| Linii | ${c6.linii.length} (materiale ${pe('material')}, valorice ${pe('valoric')}, nerecunoscute ${pe('nerecunoscut') + c6.nerecunoscute.length}) |`)
    r.push(`| Nr. crt. | ${c6.nr_crt.primul ?? '—'} … ${c6.nr_crt.ultimul ?? '—'}${c6.nr_crt.lipsa.length ? `, **lipsesc ${c6.nr_crt.lipsa.length}**: ${c6.nr_crt.lipsa.slice(0, 20).join(', ')}` : ', fără goluri'}${c6.nr_crt.repetate.length ? `, **repetate**: ${c6.nr_crt.repetate.join(', ')}` : ''} |`)
    r.push(`| Valoare totală (suma liniilor) | ${lei(c6.suma)} lei |`)
    r.push(`| TOTAL tipărit în fișier | ${lei(c6.total_tiparit)} lei${c6.total_euro != null ? ` (${lei(c6.total_euro)} EURO)` : ''}${c6.rand_total ? `, rândul ${c6.rand_total}` : ''} |`)
    r.push(`| Comparație | ${concText(c6)} |`)
    if (rez.paritate) {
      const p = rez.paritate
      r.push(`| Importul din ERP (ecranul Materiale) | ${p.eroare ? `eroare: ${p.eroare}` : `${p.linii_import} linii, ${lei(p.valoare_import)} lei${fin(c6.total_tiparit) ? ` (lipsesc ${lei(rot2(c6.total_tiparit - p.valoare_import))} lei față de TOTAL)` : ''}`} |`)
      r.push(`| Paritate cu importul | ${p.ok ? 'aceleași linii și câmpuri (inclusiv UM)' : `**diferă** (${p.diferente.length} rânduri cu câmpuri diferite, ${p.linii_lipsa.length} linii lipsă din import, ${p.fara_pereche.length} importate fără pereche)`}${p.omise_admise.length ? `; sărite prin regula importului: ${p.omise_admise.length} (rândurile ${p.omise_admise.map((o) => `${o.rand} – ${o.motiv}`).join(', ')})` : ''} |`)
    }
    if (c6.coloana_h) r.push(`| Coloana H | „${c6.coloana_h}” |`)
    r.push(`| Subsol după TOTAL (admis) | ${c6.subsol.length ? c6.subsol.map((s) => `rândul ${s.rand} ${s.tip}`).join(', ') : '—'} |`)
    r.push(`| De verificat | ${sus.length} ${sus.length === 1 ? 'linie' : 'linii'}${c6.nerecunoscute.length ? ` + ${c6.nerecunoscute.length} rânduri nerecunoscute` : ''} |`)
    if (sus.length || c6.nerecunoscute.length) {
      r.push('', '| Rând | Nr. | Cod | Denumire | UM | Cantitate | Valoare | Motiv |', '|---|---|---|---|---|---|---|---|')
      for (const l of sus) r.push(`| ${l.rand} | ${l.nr_crt} | ${l.cod || '—'} | ${l.denumire.replace(/\|/g, '/').slice(0, 70)} | ${l.um_sursa || '—'} | ${l.cantitate == null ? '—' : fmtNr(l.cantitate, 3)} | ${lei(fin(l.valoare) ? l.valoare : null)} | ${l.motive.join('; ')} |`)
      for (const n of c6.nerecunoscute) r.push(`| ${n.rand} | — | — | ${n.brut.replace(/\|/g, '/').slice(0, 70)} | — | — | — | ${n.motiv} |`)
    }
  }
  const alte = ['C7', 'C8', 'C9'].filter((f) => rez.foi[f])
  if (alte.length) {
    r.push('', '### Celelalte resurse (în `_resurse.tsv`, nu intră în importul de materiale)', '', '| Formular | Linii | Suma liniilor | TOTAL tipărit | Comparație | De verificat | Citire |', '|---|---|---|---|---|---|---|')
    for (const f of alte) {
      const s = rez.foi[f]
      const det = s.linii.filter((l) => l.tip !== 'subtotal')
      r.push(`| ${f} ${CATEGORIE[f]} | ${det.length} | ${lei(s.suma)} | ${lei(s.total_tiparit)} | ${concText(s)} | ${s.linii.filter((l) => l.stare === 'de_verificat').length + s.nerecunoscute.length} | ${s.completa ? 'completă' : '**incompletă**'} |`)
    }
  }
  r.push('')
  return r.join('\n')
}
