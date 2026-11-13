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
//   (d) cazurile NEGATIVE rămân neschimbate.
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

// ─── Valorile dimensiunilor (domeniul publicat) ───
export const MAJUSCULE = ['T', 'U', 'L', 'M']          // ca în listă (Titlu) / MAJUSCULE / litere mici / mIXT (prima mică, restul mari)
export const DIACRITICE = ['cu', 'fara']
export const SEPARATOARE_FIRMA = [' ', NBSP, THIN, IDEO, '\t', '\r', '\n', ',', '.', '"', "'", '„', '”', '“', '«', '»', '‚', '‘', '’', '(',
  ')', '&', '+', '/', '\\', '-', H2010, H2011, ' ,\t& /', '"\r\n( )']   // fiecare caracter + două combinații de 6
export const SEPARATOARE_PERSOANA = [' ', NBSP, THIN, '\t', ',', ', ', '"', "'", '„', '”', '(', ')', '&', '+', '/', '\\', '-', H2010, H2011,
  ' ,& +/']
export const FORME_JURIDICE = ['', ' SRL', ' S.R.L.', ' srl', ' SA', '+SRL', '+S.R.L.', '+srl', '+SA']   // „+” = lipită de nume
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
      const pozitiv = !comuna || sc !== '' || forma !== ''
      const dist = f.comp.filter(p => p.dist).map(p => plat(p.f))
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? dist : [])
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
    descriere: '(componenta distinctivă, oricare poziție în nume × diacritice) × majuscule × formă juridică × „SC” × flexiune × invizibil × poziție',
    dims: () => [variante(FIRME.flatMap(f => f.comp.length > 1 ? f.comp.filter(p => p.dist) : []), p => areDiacritice([p]) ? DIACRITICE : ['cu']),
      MAJUSCULE, FORME_JURIDICE, PREFIXE_SC, FLEXIUNI, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[p, d], m, forma, sc, flex, inv, poz]) {
      const scT = sc.startsWith('+') ? sc.slice(1) : sc
      const fj = forma.startsWith('+') ? forma.slice(1) : forma
      const r = scT + cuvant(p, { d, m, flex, inv }) + fj
      // contract: cu o majusculă oriunde SAU cu context (formă juridică / „SC”); scrisă integral mic și fără context → doar prin propagare
      const pozitiv = m !== 'L' || sc !== '' || forma !== ''
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? [plat(p.f)] : [])
    },
  },
  {
    nume: 'persoane_nume_intreg',
    descriere: '(persoana × ordine × diacritice × flexiunea ultimei componente × cratimă) × majuscule × separator × invizibil × poziție',
    dims: () => [
      variante(PERSOANE, () => ORDINI, x => areDiacritice([x.nume, x.prenume]) ? DIACRITICE : ['cu'],
        (x, [, o]) => flexiuni(o === 'NP' ? x.prenume : x.nume, true), x => x.prenume.c.includes('-') ? CRATIME : ['-']),
      MAJUSCULE, SEPARATOARE_PERSOANA, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[x, o, d, flex, cr], m, sep, inv, poz]) {
      const [a, b] = o === 'NP' ? [x.nume, x.prenume] : [x.prenume, x.nume]
      const tinta = x.nume.dist ? x.nume : x.prenume
      const w = [a, b].map((p, i) => cuvant(p, { d, m, flex: i === 1 ? flex : '', inv: p === tinta ? inv : '' }).replace(/-/g, cr))
      const dist = [x.nume, x.prenume].filter(p => p.dist).map(p => plat(p.f.split('-')[0]))
      return caz(poz, [{ r: w.join(sep), nume: true }], dist)
    },
  },
  {
    nume: 'persoane_componenta_singura',
    descriere: 'o componentă de persoană singură × majuscule × diacritice × flexiune × invizibil × poziție',
    dims: () => [variante(PERSOANE.flatMap(x => [x.nume, x.prenume]), p => areDiacritice([p]) ? DIACRITICE : ['cu'], p => flexiuni(p, true)),
      MAJUSCULE, INVIZIBILE, POZITII],
    aplicabil: () => true,
    construieste([[p, d, flex], m, inv, poz]) {
      const r = cuvant(p, { d, m, flex, inv })
      // contract: necomună cu o majusculă → ascunsă; scrisă mic → doar componenta distinctivă (≥ 4 litere, în afara listelor); comună → rămâne
      const pozitiv = !p.com && (m !== 'L' || p.dist)
      return caz(poz, [{ r, nume: pozitiv }], pozitiv ? [plat(p.f.split('-')[0])] : [])
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
    ], POZITII],
    aplicabil: () => true,
    construieste([x, poz]) { return caz(poz, [{ r: x.r, nume: x.nume }], x.nume ? ['12345678'] : []) },
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
/** null = cazul trece; altfel motivul: 'restaurare', 'negativ_schimbat', 'in_afara_intervalului', 'interval_nemascat', 'scurgere:<x>'. */
export function verifica(c, iesire, restaurat) {
  if (restaurat !== c.t) return 'restaurare'
  if (!c.spatii.length) return iesire === c.t ? null : 'negativ_schimbat'
  let p = 0, q = 0
  for (const [a, b] of c.spatii) {
    const inainte = c.t.slice(q, a)
    if (iesire.slice(p, p + inainte.length) !== inainte) return 'in_afara_intervalului'
    p += inainte.length
    const m = ETICHETA.exec(iesire.slice(p))
    if (!m) return 'interval_nemascat'
    p += m[0].length
    q = b
  }
  if (iesire.slice(p) !== c.t.slice(q)) return 'in_afara_intervalului'
  // (b) pe cuvintele ieșirii, fără etichete (o etichetă „[PERSOANA_1]” conține și ea litere), după normalizare
  const cuvinte = iesire.replace(new RegExp(ETICHETA.source.slice(1), 'g'), ' ').normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase().split(/[^\p{L}\p{N}]+/u)
  for (const d of c.distinctive) if (cuvinte.some(w => w.includes(d))) return 'scurgere:' + d
  return null
}
