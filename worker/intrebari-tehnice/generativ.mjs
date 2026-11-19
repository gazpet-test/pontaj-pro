// Matricea GENERATIVĂ a contractului de acoperire (r5, PR #1086 — L25): produsul COMPLET al dimensiunilor, pe un domeniu FINIT și
// publicat (docs/intrebari/MASCARE_SI_VERDICT.md, „Matricea generativă”). Rulată de două ori, pe ACELEAȘI cazuri:
//   - în vitest, pe motor (src/intrebariMascare.generativ.test.js);
//   - în procesul Node real, cu aceleași flaguri ca motor.py (worker/intrebari-tehnice/generativ_proces.mjs).
// Nu face parte din motor și nu e în manifest. FĂRĂ IMPORTURI și fără nicio funcție a motorului: transformările (majuscule,
// diacritice, separatoare, forme juridice, „SC”, flexiuni, caractere invizibile, poziții) și verificarea (oracolul) sunt scrise aici,
// separat. Fiecare caz știe intervalul EXACT al numelui în text; oracolul cere:
//   (a) intervalul așteptat e înlocuit INTEGRAL de o etichetă validă, iar restul textului e neatins;
//   (b) forma normalizată a ieșirii nu conține componenta distinctivă;
//   (c) demascarea dă textul inițial (restaurare exactă);
//   (d) cazurile NEGATIVE rămân neschimbate;
//   (e) r6: la persoanele DIFERITE alăturate, fiecare interval are eticheta altei entități;
//   (f) r7: identitățile așteptate, calculate AICI din contract (impartireAsteptata / identitateAsteptata, B1–B5): două intervale au
//       aceeași entitate DACĂ ȘI NUMAI DACĂ au aceeași identitate așteptată (nume incluse, forme ambigue, punți, titlu + persoane).
// Toate numele sunt INVENTATE. Mărimea unui lot: cel mult LOT_MAX cazuri; numărul loturilor nu e plafonat.

export const LOT_MAX = 100000
const C = (...x) => String.fromCodePoint(...x)
const NBSP = C(0xa0), THIN = C(0x2009), IDEO = C(0x3000), CGJ = C(0x34f), ZW = C(0x200b), H2010 = C(0x2010), H2011 = C(0x2011)

// ─── Dicționarul de test (forma răspunsului „nume” al edge-ului) ───
export const DICTIONAR = {
  persoane: ['VLĂDESCU ANA', 'ZAMFIRESCU MARIA', 'ȘERBĂNESCU OLGA', 'CRÂNGAȘU VIOREL', 'MARE ION', 'DUMBRĂVEANU ANDREEA-IOANA'],
  firme: ['Lumivo Servicii SRL', 'Varnitec SRL', 'Alfa SRL', 'Construct Pelorîn SRL', 'Barzeni Instal Grup SRL', 'Transgaz Construct SRL',
    'TRANSGAZ SA'],
  cui: ['12345678'],
  localitati: ['Berceni'],
}

// componentele: [forma cu diacritice, forma fără, distinctivă?, comună?] — „distinctivă” / „comună” după contract (listele închise)
const P = (c, f, dist, com = false) => ({ c, f, dist, com })
export const PERSOANE = [
  { id: 'P1', nume: P('Vlădescu', 'Vladescu', true), prenume: P('Ana', 'Ana', false) },           // „Ana”: sub 4 litere
  { id: 'P2', nume: P('Zamfirescu', 'Zamfirescu', true), prenume: P('Maria', 'Maria', true) },
  { id: 'P3', nume: P('Șerbănescu', 'Serbanescu', true), prenume: P('Olga', 'Olga', true) },
  { id: 'P4', nume: P('Crângașu', 'Crangasu', true), prenume: P('Viorel', 'Viorel', true) },
  { id: 'P5', nume: P('Mare', 'Mare', false, true), prenume: P('Ion', 'Ion', false, true) },     // ambele componente comune
  { id: 'P6', nume: P('Dumbrăveanu', 'Dumbraveanu', true), prenume: P('Andreea-Ioana', 'Andreea-Ioana', true) },
]
export const FIRME = [
  { id: 'F1', comp: [P('Lumivo', 'Lumivo', true), P('Servicii', 'Servicii', false, true)] },      // distinctivă pe prima poziție
  { id: 'F2', comp: [P('Varnitec', 'Varnitec', true)] },                                            // un cuvânt, distinctiv
  { id: 'F3', comp: [P('Alfa', 'Alfa', false, true)] },                                             // un cuvânt comun: cere context
  { id: 'F4', comp: [P('Construct', 'Construct', false, true), P('Pelorîn', 'Pelorin', true)] },   // distinctivă pe a doua poziție, diacritice
  { id: 'F5', comp: [P('Barzeni', 'Barzeni', true), P('Instal', 'Instal', false, true), P('Grup', 'Grup', false, true)] },  // trei cuvinte
]
// conflictul cu excepțiile: firma privată care începe cu numele unei entități publice (familia „conflict_entitate_publica”)
export const FIRMA_PUBLICA = { id: 'F6', comp: [P('Transgaz', 'Transgaz', false), P('Construct', 'Construct', false, true)] }

// ─── r7 (review r6 P2-1 / P2-2): al doilea dicționar — nume INCLUSE unul în altul (familiile care îl folosesc au `dictionar: 'incluse'`) ───
export const DICTIONAR_INCLUSE = {
  persoane: ['VLĂDESCU ANA', 'VLĂDESCU ANA MARIA', 'ȘERBĂNESCU OLGA', 'ȘERBĂNESCU OLGA ELENA', 'MARE ION'],
  firme: [], cui: [], localitati: [],
}
/** Dicționarul unei familii (forma răspunsului „nume” al edge-ului). */
export const dictionarFamilie = nume => FAMILII.find(f => f.nume === nume)?.dictionar === 'incluse' ? DICTIONAR_INCLUSE : DICTIONAR
// numele lui DICTIONAR_INCLUSE, scrise aici de mână (componentele normalizate), pentru oracolul împărțirii
const NUME_INCLUSE = [
  { id: 'VA', comp: ['vladescu', 'ana'] }, { id: 'VAM', comp: ['vladescu', 'ana', 'maria'] },
  { id: 'SO', comp: ['serbanescu', 'olga'] }, { id: 'SOE', comp: ['serbanescu', 'olga', 'elena'] }, { id: 'MI', comp: ['mare', 'ion'] },
]
// numele lui DICTIONAR (familiile vechi), pentru oracolul împărțirii din familiile cu titlu
const NUME_DICTIONAR = [
  { id: 'P1', comp: ['vladescu', 'ana'] }, { id: 'P2', comp: ['zamfirescu', 'maria'] }, { id: 'P3', comp: ['serbanescu', 'olga'] },
  { id: 'P4', comp: ['crangasu', 'viorel'] }, { id: 'P5', comp: ['mare', 'ion'] }, { id: 'P6', comp: ['dumbraveanu', 'andreea', 'ioana'] },
]

// ─── Valorile dimensiunilor (domeniul publicat) ───
export const MAJUSCULE = ['T', 'U', 'L', 'M']          // ca în listă (Titlu) / MAJUSCULE / litere mici / mIXT (prima mică, restul mari)
export const DIACRITICE = ['cu', 'fara']
export const SEPARATOARE_FIRMA = [' ', NBSP, THIN, IDEO, '\t', '\r', '\n', ',', '.', '"', "'", '„', '”', '“', '«', '»', '‚', '‘', '’', '(',
  ')', '&', '+', '/', '\\', '-', H2010, H2011, ' ,\t& /', '"\r\n( )']   // fiecare caracter + două combinații de 6
export const SEPARATOARE_PERSOANA = [' ', NBSP, THIN, '\t', ',', ', ', '"', "'", '„', '”', '(', ')', '&', '+', '/', '\\', '-', H2010, H2011,
  ' ,& +/']
// r6 (review r5 P3): FIECARE formă juridică din contract, cu / fără puncte, despărțită / lipită („+” = lipită de nume); scrise mic doar
// cele care nu sunt și cuvinte („sa”, „ii”, „if” scrise mic sunt cuvinte / sufixe — contract)
export const FORME_CONTRACT = ['SRL', 'SA', 'PFA', 'II', 'IF', 'SNC', 'SCS']
export const FORME_JURIDICE = ['', ...FORME_CONTRACT.flatMap(f => { const p = f.split('').join('.') + '.'; return [' ' + f, ' ' + p, '+' + f, '+' + p] }),
  ...['srl', 'pfa', 'snc', 'scs'].flatMap(f => [' ' + f, '+' + f])]
// r6: reprezentarea — N = litere obișnuite; L = TOATĂ bucata (nume, separatoare, „SC”, forma juridică) cu litere late (U+FF01–FF5E; o
// literă cu diacritic = litera lată + semnul de combinare); F = doar „SC” și forma juridică cu litere late
export const REPREZENTARI = ['N', 'L', 'F']
export const SEPARATOARE_REPREZENTARE = [' ', IDEO, ',', '/']                                // la „L”: „，” „／” (U+FF0C, U+FF0F)
export const SEPARATOARE_INTRE_PERSOANE = [' ', NBSP, '  ', ', ', ' & ', ' și ', '/']      // între două persoane diferite (fără / cu separator)
export const PREFIXE_SC = ['', 'SC ', 'S.C. ', '+SC', '+S.C.']                                       // „+” = lipit de nume
export const FLEXIUNI = ['', 'ului', 'ilor', 'ule', 'lui', 'lor', 'ul', 'le', 'ei', 'ii', 'e', 'i']
export const GENITIV = 'gen'                                                                         // -a → -ei (Ana → Anei)
export const INVIZIBILE = ['', 'M0', 'Mm', 'Mf', 'C0', 'Cm', 'Cf']   // M = U+034F, C = U+200B (Cf); 0 / m / f = început / mijloc / sfârșit
export const POZITII = ['inceput', 'interior', 'sfarsit']
export const CRATIME = ['-', H2010, H2011]
export const ORDINI = ['NP', 'PN']                                    // Nume Prenume / Prenume Nume

// ─── Transformările (scrise separat de motor) ───
function majuscule(s, m) {
  if (m === 'U') return s.toUpperCase()
  if (m === 'L') return s.toLowerCase()
  if (m === 'M') return s.slice(0, 1).toLowerCase() + s.slice(1).toUpperCase()
  return s
}
/** Literele late (scrise aici, separat de motor): caracterele ASCII vizibile → U+FF01–FF5E; o literă cu diacritic → litera lată + semnul. */
export function lata(s) {
  return [...s.normalize('NFD')].map(c => { const x = c.codePointAt(0); return x > 0x20 && x < 0x7f ? String.fromCodePoint(x + 0xfee0) : c }).join('')
}
/** Bucata firmei în reprezentarea `rep`: [sc, corp, forma] → text. */
const inRep = (rep, sc, corp, fj) => rep === 'L' ? lata(sc + corp + fj) : rep === 'F' ? lata(sc) + corp + lata(fj) : sc + corp + fj
const INV = { M: CGJ, C: ZW }
/** Cuvântul: baza (cu / fără diacritice) + sufixul, cu majusculele cerute, cu un invizibil la începutul / mijlocul / sfârșitul bazei. */
function cuvant(p, { d = 'cu', m = 'T', flex = '', inv = '' }) {
  let baza = d === 'cu' ? p.c : p.f
  let suf = flex
  if (flex === GENITIV) { baza = baza.slice(0, -1); suf = 'ei' }
  let w = majuscule(baza + suf, m)
  if (inv) {
    const k = inv[1] === '0' ? 0 : inv[1] === 'm' ? Math.floor(baza.length / 2) : baza.length
    w = w.slice(0, k) + INV[inv[0]] + w.slice(k)
  }
  return w
}
const lungBaza = p => p.f.replace(/-.*$/, '').length                  // baza fără diacritice (la cratimă: ultima parte decide flexiunea)
/** Firma dintr-un cuvânt comun are context (contract): „SC”, o formă juridică, sau r6 — ambiguitatea declarată — sufixul „-ii” scris
 *  cu MAJUSCULE („ALFAII”, „aLFAII”): se citește ca forma juridică „II” lipită (scrisă mare = formă juridică), direcția prudentă. */
const contextComuna = (sc, forma, flex, m) => sc !== '' || forma !== '' || (flex === 'ii' && (m === 'U' || m === 'M'))
const ultimaParte = p => p.f.split('-').pop()
/** Flexiunile aplicabile ultimei componente (contract: UN sufix pe o bază de ≥ 4 litere; genitivul -a → -ei pe prenumele în -a). */
function flexiuni(p, persoana) {
  const out = ['']
  if (ultimaParte(p).length >= 4) out.push(...FLEXIUNI.slice(1))
  if (persoana && /a$/.test(p.f)) out.push(GENITIV)
  return out
}
const SABLON = {
  inceput: n => ['', n, ' a livrat.'],
  interior: n => ['Ieri ', n, ' a livrat marfa.'],
  sfarsit: n => ['Contractul este cu ', n, '.'],
}
const INVIZ_RE = /[\p{M}\p{Cf}]/u
const MARCA_RE = /\p{M}/u
/** Intervalul numelui în regiunea `r`: de la primul caracter vizibil la ultimul vizibil, plus semnele de combinare (M) lipite după el
 *  (un semn de combinare aparține literei dinaintea lui; un caracter de format Cf de la margini rămâne în afară). */
function intervalRegiune(r) {
  const cp = [...r]
  let a = 0, i = 0
  const poz = []
  for (const ch of cp) { poz.push(i); i += ch.length }
  poz.push(i)
  let s = 0
  while (s < cp.length && INVIZ_RE.test(cp[s])) s++
  let e = cp.length
  while (e > s && INVIZ_RE.test(cp[e - 1])) e--
  let f = e
  while (f < cp.length && MARCA_RE.test(cp[f])) f++
  a = poz[s]
  return [a, poz[f]]
}
function caz(poz, regiuni, distinctive, extra = {}) {
  // regiuni: [{r, nume: bool}] — textul se compune din bucăți; cele cu nume au interval
  const [pre, , post] = SABLON[poz]('')
  let t = pre
  const spatii = []
  regiuni.forEach((x, k) => {
    if (k > 0) t += x.inainte ?? ''
    if (x.nume) { const [a, b] = intervalRegiune(x.r); spatii.push([t.length + a, t.length + b]) }
    t += x.r
  })
  t += post
  return { t, spatii, distinctive, ...extra }
}
const plat = s => s.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// ─── r7: oracolul împărțirii în persoane (contractul B1–B5, scris AICI, separat de motor) ───
const cheieMultime = a => [...new Set(a)].sort().join(' ')
/** Identitatea unei mulțimi de componente (B1–B3): numele cu mulțimea EXACTĂ (unul → el; mai multe → ambiguă), altfel singurul nume care
 *  o include, altfel ambiguă proprie („A:” + mulțimea). */
export function identitateAsteptata(comp, nume) {
  const k = cheieMultime(comp)
  const ex = nume.filter(n => cheieMultime(n.comp) === k)
  if (ex.length) return { id: ex.length === 1 ? ex[0].id : 'A:' + k, exact: true }
  const sup = nume.filter(n => comp.every(c => n.comp.includes(c)))
  return { id: sup.length === 1 ? sup[0].id : 'A:' + k, exact: false }
}
/** Împărțirea așteptată a unui șir de cuvinte ALĂTURATE (componentele lor, `ks`), toate ascunse: grup = cuvinte consecutive cu
 *  componente distincte, toate ale aceluiași nume. Se enumeră TOATE împărțirile; câștigă cele mai puține grupuri, apoi cele mai multe
 *  nume exacte (B5). La egalitate: porțiunile dintre granițele comune tuturor împărțirilor optime în care împărțirile diferă devin UN
 *  grup cu entitate ambiguă („A=” + mulțimea), dacă dau identități diferite aceluiași cuvânt; dacă dau aceleași identități cu granițe
 *  diferite, contractul nu decide intervalul → null (cazul se exclude). [{i, j, id}] */
export function impartireAsteptata(ks, nume) {
  const n = ks.length, toate = []                 // ks[k] = componentele cuvântului k (un cuvânt cu cratimă poate avea mai multe)
  const valid = (i, j) => { const s = ks.slice(i, j + 1).flat(); return new Set(s).size === s.length && nume.some(m => s.every(c => m.comp.includes(c))) }
  const rec = (i, acc) => { if (i === n) { toate.push(acc); return } for (let j = i; j < n; j++) if (valid(i, j)) rec(j + 1, [...acc, [i, j]]) }
  rec(0, [])
  const id = ([i, j]) => identitateAsteptata(ks.slice(i, j + 1).flat(), nume)
  const cost = p => [p.length, -p.filter(g => id(g).exact).length]
  const mai = (a, b) => a[0] - b[0] || a[1] - b[1]
  let best = null
  for (const p of toate) if (!best || mai(cost(p), best) < 0) best = cost(p)
  const opt = toate.filter(p => mai(cost(p), best) === 0)
  const peCuvant = p => { const r = []; for (const g of p) for (let k = g[0]; k <= g[1]; k++) r[k] = id(g).id; return r }
  const taieturi = [0]
  for (let q = 1; q < n; q++) if (opt.every(p => p.some(([i]) => i === q))) taieturi.push(q)
  taieturi.push(n)
  const out = []
  for (let t = 0; t + 1 < taieturi.length; t++) {
    const [a, b] = [taieturi[t], taieturi[t + 1]]
    const v = opt.map(p => JSON.stringify(p.filter(([i]) => i >= a && i < b)))
    if (v.every(x => x === v[0])) { for (const g of JSON.parse(v[0])) out.push({ i: g[0], j: g[1], id: id(g).id }); continue }
    const ids = opt.map(p => peCuvant(p).slice(a, b).join('|'))
    if (ids.every(x => x === ids[0])) return null
    out.push({ i: a, j: b - 1, id: 'A=' + cheieMultime(ks.slice(a, b).flat()) })
  }
  return out
}
// separatoarele dintre două nume: „alăturate” (cuvintele formează un singur șir — contract: spații, virgulă) sau nu (un cuvânt între ele)
const ALATURAT = new Set([' ', NBSP, ', ', ','])
/** Cazul dintr-un șir de bucăți: {cuv, k} (cuvânt de persoană din listă, componenta k), {nec, id} (persoană necunoscută: intervalul
 *  ei, entitate proprie), {vizibil} (text care trebuie să rămână: titlul, componenta comună fără context), {sep} (separator). Șirurile de
 *  cuvinte de persoană alăturate se împart cu impartireAsteptata; null = caz exclus (contractul nu decide). */
function cazBucati(poz, bucati, nume, distinctive, extra = {}) {
  const [pre, , post] = SABLON[poz]('')
  let t = pre
  const elem = []                                  // {a, b, k | nec | vizibil}
  let alaturat = false
  for (const x of bucati) {
    if ('sep' in x) { alaturat = ALATURAT.has(x.sep); t += x.sep; continue }
    const a = t.length
    t += x.cuv ?? x.nec ?? x.vizibil
    elem.push({ ...x, a, b: t.length, alaturat })
    alaturat = false
  }
  t += post
  const spatii = [], entitati = []
  for (let i = 0; i < elem.length;) {
    const x = elem[i]
    if ('vizibil' in x) { i++; continue }
    if ('nec' in x) { spatii.push([x.a, x.b]); entitati.push(x.id); i++; continue }
    let j = i
    while (j + 1 < elem.length && 'cuv' in elem[j + 1] && elem[j + 1].alaturat) j++
    const imp = impartireAsteptata(elem.slice(i, j + 1).map(y => y.k), nume)
    if (!imp) return null
    for (const g of imp) { spatii.push([elem[i + g.i].a, elem[i + g.j].b]); entitati.push(g.id) }
    i = j + 1
  }
  return { t, spatii, distinctive, entitati, ...extra }
}
const cuvinteNume = (comps, m, d) => comps.map(p => ({ cuv: majuscule(d === 'fara' ? p.f : p.c, m), k: p.f.split('-').map(plat) }))
const intre = (lista, sep) => lista.flatMap((x, i) => i ? [{ sep }, x] : [x])
const permutari = a => a.length <= 1 ? [a] : a.flatMap((x, i) => permutari([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r]))
// componentele familiilor r7 (formele scrise; „distinctivă” = ascunsă și singură, în orice scriere — contract)
const V = P('Vlădescu', 'Vladescu', true), A_ = P('Ana', 'Ana', false), M_ = P('Maria', 'Maria', true), S_ = P('Șerbănescu', 'Serbanescu', true),
  O_ = P('Olga', 'Olga', true), E_ = P('Elena', 'Elena', true)
const PERECHI_INCLUSE = [{ scurt: [V, A_], lung: [V, A_, M_] }, { scurt: [S_, O_], lung: [S_, O_, E_] }]
const distinctiveDin = comps => [...new Set(comps.filter(p => p.dist).map(p => plat(p.f)))]
export const TITLURI_TEST = ['dl. ', 'Dl. ', 'ing. ', 'dna ', 'colegul ']
const NECUNOSCUTI = ['Popovici', 'Tudorache', 'Iordache']

// ─── Familiile (fiecare = produsul complet al dimensiunilor ei) ───
// Prima dimensiune a familiilor mari e lista EXPLICITĂ a variantelor aplicabile ale entității (ex. firma × diacritice × separator: o
// firmă dintr-un cuvânt nu are separator, un nume fără diacritice nu are a doua variantă), ca produsul să nu conțină combinații goale.
const fi = f => f.comp.findIndex(p => p.dist) >= 0 ? f.comp.findIndex(p => p.dist) : 0
const areDiacritice = ps => ps.some(p => p.c !== p.f)
const variante = (lista, ...dims) => lista.flatMap(x => dims.reduce((acc, d) => acc.flatMap(a => d(x, a).map(v => [...a, v])), [[x]]))
export const FAMILII = [
  {
    nume: 'firme_nume_intreg',
    descriere: '(firma × diacritice × separator) × majuscule × formă juridică × „SC” × flexiune × invizibil × poziție',
    dims: () => [
      variante(FIRME, f => areDiacritice(f.comp) ? DIACRITICE : ['cu'], f => f.comp.length > 1 ? SEPARATOARE_FIRMA : ['']),
      MAJUSCULE, FORME_JURIDICE, PREFIXE_SC, FLEXIUNI, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[f, d, sep], m, forma, sc, flex, inv, poz]) {
      const k = fi(f), ultim = f.comp.length - 1
      const cuv = f.comp.map((p, i) => cuvant(p, { d, m, flex: i === ultim ? flex : '', inv: i === k ? inv : '' }))
      const scT = sc.startsWith('+') ? sc.slice(1) : sc
      const fj = forma.startsWith('+') ? forma.slice(1) : forma
      const r = scT + cuv.join(sep) + fj
      const comuna = f.comp.length === 1 && f.comp[0].com
      const pozitiv = !comuna || contextComuna(sc, forma, flex, m)
      const dist = f.comp.filter(p => p.dist).map(p => plat(p.f))
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? dist : [])
    },
  },
  {
    // r6 (review r5 P1 / P3): literele late încrucișate cu formele lipite / despărțite, „SC”, flexiunile, invizibilele, majusculele
    nume: 'firme_reprezentare',
    descriere: '(firma × diacritice × separator: spațiu, U+3000, „,”, „/”) × reprezentare (L, F) × majuscule × formă juridică × „SC” × flexiune × invizibil × poziție',
    dims: () => [
      variante(FIRME, f => areDiacritice(f.comp) ? DIACRITICE : ['cu'], f => f.comp.length > 1 ? SEPARATOARE_REPREZENTARE : ['']),
      REPREZENTARI.filter(x => x !== 'N'), MAJUSCULE, FORME_JURIDICE, PREFIXE_SC, FLEXIUNI, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[f, d, sep], rep, m, forma, sc, flex, inv, poz]) {
      const k = fi(f), ultim = f.comp.length - 1
      const cuv = f.comp.map((p, i) => cuvant(p, { d, m, flex: i === ultim ? flex : '', inv: i === k ? inv : '' }))
      const r = inRep(rep, sc.startsWith('+') ? sc.slice(1) : sc, cuv.join(sep), forma.startsWith('+') ? forma.slice(1) : forma)
      const comuna = f.comp.length === 1 && f.comp[0].com
      const pozitiv = !comuna || contextComuna(sc, forma, flex, m)
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? f.comp.filter(p => p.dist).map(p => plat(p.f)) : [])
    },
  },
  {
    nume: 'conflict_entitate_publica',
    descriere: 'firma privată care începe cu o entitate publică (întreagă) × majuscule × separator × formă juridică × poziție',
    dims: () => [MAJUSCULE, SEPARATOARE_FIRMA, FORME_JURIDICE, POZITII],
    aplicabil: () => true,
    construieste([m, sep, forma, poz]) {
      const fj = forma.startsWith('+') ? forma.slice(1) : forma
      const r = FIRMA_PUBLICA.comp.map(p => cuvant(p, { m })).join(sep) + fj
      return caz(poz, [{ r, nume: true }], [])
    },
  },
  {
    nume: 'firme_componenta_singura',
    descriere: '(componenta distinctivă, oricare poziție în nume × diacritice) × reprezentare × majuscule × formă juridică × „SC” × flexiune × invizibil × poziție',
    dims: () => [variante(FIRME.flatMap(f => f.comp.length > 1 ? f.comp.filter(p => p.dist) : []), p => areDiacritice([p]) ? DIACRITICE : ['cu']),
      REPREZENTARI, MAJUSCULE, FORME_JURIDICE, PREFIXE_SC, FLEXIUNI, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[p, d], rep, m, forma, sc, flex, inv, poz]) {
      const r = inRep(rep, sc.startsWith('+') ? sc.slice(1) : sc, cuvant(p, { d, m, flex, inv }), forma.startsWith('+') ? forma.slice(1) : forma)
      // contract: cu o majusculă oriunde SAU cu context (formă juridică / „SC”); scrisă integral mic și fără context → doar prin propagare
      const pozitiv = m !== 'L' || sc !== '' || forma !== ''
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? [plat(p.f)] : [])
    },
  },
  {
    nume: 'persoane_nume_intreg',
    descriere: '(persoana × ordine × diacritice × flexiunea ultimei componente × cratimă) × reprezentare (N, L) × majuscule × separator × invizibil × poziție',
    dims: () => [
      variante(PERSOANE, () => ORDINI, x => areDiacritice([x.nume, x.prenume]) ? DIACRITICE : ['cu'],
        (x, [, o]) => flexiuni(o === 'NP' ? x.prenume : x.nume, true), x => x.prenume.c.includes('-') ? CRATIME : ['-']),
      ['N', 'L'], MAJUSCULE, SEPARATOARE_PERSOANA, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[x, o, d, flex, cr], rep, m, sep, inv, poz]) {
      const [a, b] = o === 'NP' ? [x.nume, x.prenume] : [x.prenume, x.nume]
      const tinta = x.nume.dist ? x.nume : x.prenume
      const w = [a, b].map((p, i) => cuvant(p, { d, m, flex: i === 1 ? flex : '', inv: p === tinta ? inv : '' }).replace(/-/g, cr))
      const dist = [x.nume, x.prenume].filter(p => p.dist).map(p => plat(p.f.split('-')[0]))
      return caz(poz, [{ r: inRep(rep, '', w.join(sep), ''), nume: true }], dist)
    },
  },
  {
    nume: 'persoane_componenta_singura',
    descriere: 'o componentă de persoană singură × reprezentare (N, L) × majuscule × diacritice × flexiune × invizibil × poziție',
    dims: () => [variante(PERSOANE.flatMap(x => [x.nume, x.prenume]), p => areDiacritice([p]) ? DIACRITICE : ['cu'], p => flexiuni(p, true)),
      ['N', 'L'], MAJUSCULE, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[p, d, flex], rep, m, inv, poz]) {
      const r = inRep(rep, '', cuvant(p, { d, m, flex, inv }), '')
      // contract: necomună cu o majusculă → ascunsă; scrisă mic → doar componenta distinctivă (≥ 4 litere, în afara listelor); comună → rămâne
      const pozitiv = !p.com && (m !== 'L' || p.dist)
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? [plat(p.f.split('-')[0])] : [])
    },
  },
  {
    // r6 (review r5 P2): două persoane DIFERITE alăturate — fiecare intervalul ei, etichete de entități DIFERITE
    nume: 'persoane_alaturate',
    descriere: '(perechea ordonată de persoane diferite × ordinea fiecăreia × diacritice) × reprezentare (N, L) × majuscule × separatorul dintre ele × poziție',
    dims: () => [
      variante(PERSOANE.flatMap(a => PERSOANE.filter(b => b !== a).map(b => [a, b])), () => ORDINI, () => ORDINI,
        ([a, b]) => areDiacritice([a.nume, a.prenume, b.nume, b.prenume]) ? DIACRITICE : ['cu']),
      ['N', 'L'], MAJUSCULE, SEPARATOARE_INTRE_PERSOANE, POZITII],
    aplicabil: () => true,
    construieste([[[a, b], oa, ob, d], rep, m, sep, poz]) {
      const scrie = (x, o) => inRep(rep, '', (o === 'NP' ? [x.nume, x.prenume] : [x.prenume, x.nume]).map(p => cuvant(p, { d, m })).join(' '), '')
      const dist = [a, b].flatMap(x => [x.nume, x.prenume]).filter(p => p.dist).map(p => plat(p.f.split('-')[0]))
      return caz(poz, [{ r: scrie(a, oa), nume: true }, { r: scrie(b, ob), nume: true, inainte: inRep(rep, '', sep, '') }], dist, { diferite: true })
    },
  },
  {
    nume: 'persoane_trei',
    descriere: '(trei persoane diferite, în ordine × ordinea fiecăreia) × majuscule × separator (spațiu, „, ”) × poziție',
    dims: () => [
      variante(PERSOANE.flatMap(a => PERSOANE.flatMap(b => PERSOANE.filter(c => a !== b && b !== c && a !== c).map(c => [a, b, c]))),
        () => ORDINI, () => ORDINI, () => ORDINI),
      MAJUSCULE, [' ', ', '], POZITII],
    aplicabil: () => true,
    construieste([[tri, ...ord], m, sep, poz]) {
      const reg = tri.map((x, i) => ({ r: (ord[i] === 'NP' ? [x.nume, x.prenume] : [x.prenume, x.nume]).map(p => cuvant(p, { m })).join(' '), nume: true,
        inainte: sep }))
      const dist = tri.flatMap(x => [x.nume, x.prenume]).filter(p => p.dist).map(p => plat(p.f.split('-')[0]))
      return caz(poz, reg, dist, { diferite: true })
    },
  },
  {
    // o persoană lângă componenta COMUNĂ a alteia („Mare”, „Ion” din MARE ION), singură: componenta rămâne (nu e numele întreg al nimănui)
    nume: 'persoana_si_componenta_comuna',
    descriere: '(persoana × ordine) × componenta comună a altei persoane (Mare, Ion) × înainte / după × majuscule × separator (spațiu, „, ”) × poziție',
    dims: () => [variante(PERSOANE.filter(x => x.id !== 'P5'), () => ORDINI), [PERSOANE[4].nume, PERSOANE[4].prenume], ['inainte', 'dupa'],
      MAJUSCULE, [' ', ', '], POZITII],
    aplicabil: () => true,
    construieste([[x, o], comp, unde, m, sep, poz]) {
      const pers = { r: (o === 'NP' ? [x.nume, x.prenume] : [x.prenume, x.nume]).map(p => cuvant(p, { m })).join(' '), nume: true }
      const com = { r: cuvant(comp, { m }), nume: false }
      const reg = unde === 'dupa' ? [pers, { ...com, inainte: sep }] : [com, { ...pers, inainte: sep }]
      return caz(poz, reg, [x.nume, x.prenume].filter(p => p.dist).map(p => plat(p.f.split('-')[0])))
    },
  },
  {
    nume: 'context_si_propagare',
    descriere: 'componenta singură (scrisă mic / comună) cu numele întreg în aceeași întrebare, înainte sau după × flexiune × poziție',
    dims: () => [[
      { nume: 'Lumivo Servicii SRL', singur: 'lumivo', d: 'lumivo', pozitiv: true },
      { nume: 'Construct Pelorîn SRL', singur: 'pelorîn', d: 'pelorin', pozitiv: true },
      { nume: 'Barzeni Instal Grup SRL', singur: 'barzeni', d: 'barzeni', pozitiv: true },
      { nume: 'Varnitec SRL', singur: 'varnitec', d: 'varnitec', pozitiv: true },  // firma dintr-un cuvânt: numele întreg, oricum scris
      { nume: 'Alfa SRL', singur: 'alfa', d: null, pozitiv: false },             // componentă comună scrisă mic: rămâne
      { nume: 'Ion Mare', singur: 'mare', d: null, pozitiv: true },              // persoană: și cea comună, după numele întreg
      { nume: 'Ion Mare', singur: 'Mare', d: null, pozitiv: true },
      { nume: 'Mare Ion', singur: 'ion', d: null, pozitiv: true },
      { nume: 'Vlădescu Ana', singur: 'ana', d: 'vladescu', pozitiv: true },
    ], ['inainte', 'dupa'], ['', 'ului', 'lor'], POZITII],
    aplicabil: () => true,
    construieste([x, ordine, flex, poz]) {
      const singur = x.singur + (x.singur.length >= 4 ? flex : '')
      if (flex && x.singur.length < 4) return null
      const reg = ordine === 'inainte'
        ? [{ r: x.nume, nume: true }, { r: singur, nume: x.pozitiv, inainte: ' a livrat; apoi ' }]
        : [{ r: singur, nume: x.pozitiv }, { r: x.nume, nume: true, inainte: ' a livrat; apoi ' }]
      return caz(poz, reg, x.d ? [x.d] : [], { invata: true })
    },
  },
  {
    nume: 'exceptii',
    descriere: 'entități publice, localități, componente generice singure, CUI fragmentat × poziție',
    dims: () => [[
      { r: 'Transgaz', nume: false }, { r: 'TRANSGAZ', nume: false }, { r: 'Construct', nume: false }, { r: 'Servicii', nume: false },
      { r: 'Instal Grup', nume: false }, { r: 'Berceni', nume: false }, { r: 'Alfa', nume: false }, { r: 'alfa', nume: false },
      { r: 'Mare', nume: false }, { r: 'ion', nume: false }, { r: 'ana', nume: false },
      { r: '12345678', nume: true }, { r: '1234 5678', nume: true }, { r: '1234.5678', nume: true }, { r: '12-345-678', nume: true },
      { r: '1234' + NBSP + '5678', nume: true }, { r: '1234 56789', nume: false }, { r: '123 4567', nume: false },
      // r6: literele late nu schimbă excepțiile (entitate publică, localitate, componentă comună / generică) și nici CUI-ul fragmentat
      { r: lata('TRANSGAZ'), nume: false }, { r: lata('Transgaz'), nume: false }, { r: lata('Berceni'), nume: false }, { r: lata('Alfa'), nume: false },
      { r: lata('Servicii'), nume: false }, { r: lata('Mare'), nume: false }, { r: lata('1234 5678'), nume: true }, { r: lata('1234.5678'), nume: true },
    ], POZITII],
    aplicabil: () => true,
    construieste([x, poz]) { return caz(poz, [{ r: x.r, nume: x.nume }], x.nume ? ['12345678'] : []) },
  },
  {
    // r7 (review r6 P2-1, A1–A2): după titlu, două persoane DIFERITE alăturate se delimitează ca fără titlu
    nume: 'titlu_persoane_alaturate',
    descriere: '(perechea ordonată de persoane diferite × ordinea fiecăreia × diacritice) × titlu × majuscule × separatorul dintre ele × poziție',
    dims: () => [
      variante(PERSOANE.flatMap(a => PERSOANE.filter(b => b !== a).map(b => [a, b])), () => ORDINI, () => ORDINI,
        ([a, b]) => areDiacritice([a.nume, a.prenume, b.nume, b.prenume]) ? DIACRITICE : ['cu']),
      TITLURI_TEST, MAJUSCULE, [' ', ', ', NBSP], POZITII],
    aplicabil: () => true,
    construieste([[[a, b], oa, ob, d], tit, m, sep, poz]) {
      const scrie = (x, o) => intre(cuvinteNume(o === 'NP' ? [x.nume, x.prenume] : [x.prenume, x.nume], m, d), ' ')
      const dist = [a, b].flatMap(x => [x.nume, x.prenume]).filter(p => p.dist).map(p => plat(p.f.split('-')[0]))
      return cazBucati(poz, [{ vizibil: tit.trim() }, { sep: ' ' }, ...scrie(a, oa), { sep }, ...scrie(b, ob)], NUME_DICTIONAR, dist, { diferite: true })
    },
  },
  {
    // r7 (review r6 P2-1, A3–A4): persoana NECUNOSCUTĂ de după titlu se oprește înaintea componentelor cunoscute; contextul titlului
    // DOAR pentru primul grup (componenta comună lipită de titlu se ascunde; după o persoană, rămâne)
    nume: 'titlu_necunoscut_si_lista',
    descriere: 'titlu × cuvinte necunoscute (0–3) × ce urmează (o persoană din listă în fiecare ordine, componenta comună, persoană + componentă comună, nimic) × majusculele necunoscuților × majusculele persoanei × poziție',
    dims: () => [TITLURI_TEST, [0, 1, 2, 3], [...PERSOANE.flatMap(x => ORDINI.map(o => ({ pers: x, o }))), { comun: PERSOANE[4].nume }, { comun: PERSOANE[4].prenume },
      { pers: PERSOANE[0], o: 'NP', comun: PERSOANE[4].nume }, { pers: PERSOANE[1], o: 'PN', comun: PERSOANE[4].prenume },
      { pers: PERSOANE[3], o: 'NP', comun: PERSOANE[4].nume }, {}], ['T', 'U'], ['T', 'U'], POZITII],
    aplicabil: ([, k, u, mn]) => (k > 0 || mn === 'T') && (k > 0 || u.pers || u.comun),
    construieste([tit, k, u, mn, mp, poz]) {
      const b = [{ vizibil: tit.trim() }]
      const nec = NECUNOSCUTI.slice(0, k).map(w => majuscule(w, mn))
      if (k) b.push({ sep: ' ' }, { nec: nec.join(' '), id: 'U:' + nec.join(' ').toLowerCase() })
      if (u.pers) b.push({ sep: ' ' }, ...intre(cuvinteNume(u.o === 'NP' ? [u.pers.nume, u.pers.prenume] : [u.pers.prenume, u.pers.nume], mp, 'cu'), ' '))
      if (u.comun) {
        const w = majuscule(u.comun.c, mp)
        // contextul titlului: DOAR dacă e primul grup de după titlu (nimic înainte); altfel componenta comună singură rămâne vizibilă
        b.push({ sep: ' ' }, k === 0 && !u.pers ? { cuv: w, k: [plat(u.comun.f)] } : { vizibil: w })
      }
      const dist = [...nec.map(plat), ...(u.pers ? [u.pers.nume, u.pers.prenume].filter(p => p.dist).map(p => plat(p.f.split('-')[0])) : [])]
      return cazBucati(poz, b, NUME_DICTIONAR, dist)
    },
  },
  {
    // r7 (review r6 P2-2, B1 + B5): două nume complete, unul INCLUS în celălalt, în orice ordine a componentelor, alăturate sau despărțite
    nume: 'nume_incluse_alaturate',
    dictionar: 'incluse',
    descriere: '(perechea de nume incluse × care e primul × ordinea componentelor numelui scurt × a celui lung) × diacritice × majuscule (T, U, L) × separatorul dintre ele (spațiu, „, ”, NBSP, „ și ”) × titlu (fără, „dl.”) × poziție',
    dims: () => [variante(PERECHI_INCLUSE, () => ['SL', 'LS'], x => permutari(x.scurt), x => permutari(x.lung)), DIACRITICE, ['T', 'U', 'L'],
      [' ', ', ', NBSP, ' și '], ['', 'dl. '], POZITII],
    aplicabil: () => true,
    construieste([[x, ord, ps, pl], d, m, sep, tit, poz]) {
      const [p1, p2] = ord === 'SL' ? [ps, pl] : [pl, ps]
      const b = [...(tit ? [{ vizibil: tit.trim() }, { sep: ' ' }] : []), ...intre(cuvinteNume(p1, m, d), ' '), { sep }, ...intre(cuvinteNume(p2, m, d), ' ')]
      return cazBucati(poz, b, NUME_INCLUSE, distinctiveDin(x.lung))
    },
  },
  {
    // r7 (review r6 P2-2, B3–B4): forma AMBIGUĂ (inclusă în ambele nume) lângă cele două nume complete, în toate ordinile (învățarea în
    // ambele ordini, puntea tranzitivă prin forma comună), cu / fără pre-trecere — trei entități, niciodată unite
    nume: 'forme_ambigue_si_punti',
    dictionar: 'incluse',
    descriere: '(perechea de nume incluse × forma ambiguă × ordinea componentelor numelui scurt × a celui lung) × ordinea celor trei bucăți × diacritice × majuscule (T, U, L) × separatorul dintre bucăți („; apoi ”, „ și ”, „, ”) × pre-trecere × poziție',
    dims: () => [variante(PERECHI_INCLUSE.map((p, ix) => ({ ...p, ix })), x => x.ix === 0 ? [[V, ''], [V, 'ului'], [A_, '']] : [[S_, ''], [O_, '']],
      x => permutari(x.scurt), x => permutari(x.lung)), permutari(['S', 'L', 'G']), DIACRITICE, ['T', 'U', 'L'], ['; apoi ', ' și ', ', '], [false, true], POZITII],
    // „ana” scrisă mic și singură nu e componentă distinctivă (contract): rămâne vizibilă — în afara familiei
    aplicabil: ([[, [g]], , , m]) => !(m === 'L' && !g.dist),
    construieste([[x, [g, flex], ps, pl], ord, d, m, sep, inv, poz]) {
      const reg = { S: intre(cuvinteNume(ps, m, d), ' '), L: intre(cuvinteNume(pl, m, d), ' '),
        G: [{ cuv: majuscule((d === 'fara' ? g.f : g.c) + flex, m), k: [plat(g.f)] }] }
      return cazBucati(poz, intre(ord.map(r => reg[r]), sep).flatMap(r => Array.isArray(r) ? r : [r]), NUME_INCLUSE, distinctiveDin(x.lung), inv ? { invata: true } : {})
    },
  },
]

// ─── Enumerarea: produsul complet, indexat în bază mixtă; loturi de cel mult LOT_MAX ───
function marime(dims) { return dims.reduce((p, d) => p * d.length, 1) }
function valori(dims, idx) {
  const out = []
  for (let k = dims.length - 1; k >= 0; k--) { out.unshift(dims[k][idx % dims[k].length]); idx = Math.floor(idx / dims[k].length) }
  return out
}
/** Loturile: [{familie, lot, de_la, pana_la}] — intervale de indici din produsul complet al fiecărei familii. */
export function loturi(max = LOT_MAX) {
  const out = []
  for (const f of FAMILII) {
    const n = marime(f.dims())
    for (let a = 0, k = 0; a < n; a += max, k++) out.push({ familie: f.nume, lot: k, de_la: a, pana_la: Math.min(n, a + max) })
  }
  return out
}
/** Cazurile unui lot: produsul, fără combinațiile neaplicabile (ex. flexiune pe o bază sub 4 litere, varianta fără diacritice a unui
 *  nume fără diacritice) — `excluse` le numără. */
export function cazuriLot(l) {
  const f = FAMILII.find(x => x.nume === l.familie)
  const dims = f.dims()
  const out = []
  let excluse = 0
  for (let i = l.de_la; i < l.pana_la; i++) {
    const v = valori(dims, i)
    const c = f.aplicabil(v) ? f.construieste(v) : null
    if (c) out.push(c); else excluse++
  }
  return { cazuri: out, excluse }
}
/** Rezumatul domeniului (pentru document și raport): familia → [dimensiunea → numărul de valori], produsul, loturile. */
export function rezumat() {
  return FAMILII.map(f => { const d = f.dims(); return { familie: f.nume, descriere: f.descriere, valori: d.map(x => x.length), produs: marime(d),
    loturi: Math.ceil(marime(d) / LOT_MAX) } })
}

// ─── Oracolul (scris separat de motor) ───
const ETICHETA = /^\[(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_[1-9][0-9]{0,3}(?:_F[1-9][0-9]{0,2})?\]/
/** null = cazul trece; altfel motivul: 'restaurare', 'negativ_schimbat', 'in_afara_intervalului', 'interval_nemascat',
 *  'aceeasi_entitate' (r6), 'entitati_separate' (r7), 'scurgere:<x>'. */
export function verifica(c, iesire, restaurat) {
  if (restaurat !== c.t) return 'restaurare'
  if (!c.spatii.length) return iesire === c.t ? null : 'negativ_schimbat'
  let p = 0, q = 0
  const entitati = []
  for (const [a, b] of c.spatii) {
    const inainte = c.t.slice(q, a)
    if (iesire.slice(p, p + inainte.length) !== inainte) return 'in_afara_intervalului'
    p += inainte.length
    const m = ETICHETA.exec(iesire.slice(p))
    if (!m) return 'interval_nemascat'
    entitati.push(m[0].replace(/_F[0-9]+\]$/, ']'))
    p += m[0].length
    q = b
  }
  if (iesire.slice(p) !== c.t.slice(q)) return 'in_afara_intervalului'
  // r6: intervalele unor persoane DIFERITE au etichete de entități diferite (nu „o persoană” făcută din două)
  if (c.diferite && new Set(entitati).size !== entitati.length) return 'aceeasi_entitate'
  // (f) r7: identitățile așteptate (oracolul împărțirii, B1–B5): aceeași identitate ⇔ aceeași entitate — nume diferite / forme ambigue
  // nu se unesc, iar formele aceluiași nume rămân o entitate
  if (c.entitati) for (let i = 0; i < entitati.length; i++) for (let j = i + 1; j < entitati.length; j++)
    if ((entitati[i] === entitati[j]) !== (c.entitati[i] === c.entitati[j])) return entitati[i] === entitati[j] ? 'aceeasi_entitate' : 'entitati_separate'
  // (b) pe cuvintele ieșirii, fără etichete (o etichetă „[PERSOANA_1]” conține și ea litere), după normalizare
  const cuvinte = iesire.replace(new RegExp(ETICHETA.source.slice(1), 'g'), ' ').normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase().split(/[^\p{L}\p{N}]+/u)
  for (const d of c.distinctive) if (cuvinte.some(w => w.includes(d))) return 'scurgere:' + d
  return null
}
