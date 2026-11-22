// Invariantul de contabilizare (review #1165 r5): teste unitare pe eNumeric / numar / randCandidat / verificaContabilizare și un
// TEST-PROPRIETATE: foi sintetice generate determinist (articole în poziții aleatoare — înaintea antetului, în foi fără antet, după
// total, cu „+”, cu text numeric RO), prin parseSituatieExcel ȘI prin parseDevizModificare (Excel AA): fiecare articol generat apare în
// linii / fara_miscare_randuri SAU în probleme (cu foaia și rândul lui) — nimic nu dispare tăcut. Fixture-uri sintetice, fără date reale.
import { describe, it, expect } from 'vitest'
import * as XLSX_mod from 'xlsx-js-style'
import { eNumeric, numar, RE_NUMAR_AMBIGUU, randCandidat, eMetaDocument, TIPARE_META_DOCUMENT, eTotalDovedit, tipRand, CLASE_RAND, CLASE_ACOPERA_CANDIDAT, verificaContabilizare, eRandIndex, eRandDate, eRandGol } from './contabilizare.js'
import { parseSituatieExcel, parseDevizModificare, eNumeric as eNumericReexport, randCandidat as randCandidatReexport, eMetaDocument as eMetaDocumentReexport, eTotalDovedit as eTotalDoveditReexport } from './parsareSituatie.js'
import { UM_LISTA } from './um.js'
const XLSX = XLSX_mod.default || XLSX_mod

function xlsx(foi) {
  const wb = XLSX.utils.book_new()
  for (const f of foi) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.rows), f.nume)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('eNumeric / numar — o singură definiție a celulei numerice (semn + / −, RO / EN, procente excluse)', () => {
  it('pozitive: numere, text numeric cu semn, separatori RO / EN', () => {
    for (const v of [0, 30, -2.5, 1e6, '30', ' 30 ', '+30', '-30', '1.234,5', '1,234.5', '2.000', '12,345', '-12.5', '+1.234,5', '0,5', '15.10.2026'])
      expect(eNumeric(v), String(v)).toBe(true)
  })
  it('negative: procente (explicit), text, gol, null, semn singur, semn dublu, exponent, spațiu interior, NaN / Infinity', () => {
    for (const v of ['12%', '12 %', '%', 'abc', '', '   ', null, undefined, '+', '-', '+-3', '3-', '1e5', '12 345', '1..2', 'm', NaN, Infinity, -Infinity, true, {}, []])
      expect(eNumeric(v), String(v)).toBe(false)
  })
  it('numar: parseNumar (helperul existent) + „+” explicit; gol = null, text = NaN', () => {
    expect(numar('+30')).toBe(30)
    expect(numar(' +1.234,5')).toBe(1234.5)
    expect(numar('-12.5')).toBe(-12.5)
    expect(numar(30)).toBe(30)
    expect(numar('')).toBeNull()
    expect(numar(null)).toBeNull()
    expect(numar('abc')).toBeNaN()
    expect(numar('++3')).toBeNaN() // un singur „+”
    expect(numar('12%')).toBeNaN()
    expect(RE_NUMAR_AMBIGUU.test('+2.000')).toBe(true)
    expect(RE_NUMAR_AMBIGUU.test('2.000,5')).toBe(false)
  })
  it('parsareSituatie re-exportă aceleași funcții (nu copii)', () => {
    expect(eNumericReexport).toBe(eNumeric)
    expect(randCandidatReexport).toBe(randCandidat)
    expect(eMetaDocumentReexport).toBe(eMetaDocument)
    expect(eTotalDoveditReexport).toBe(eTotalDovedit)
  })
})

describe('randCandidat — ORICE rând cu ≥ 1 număr și ≥ 1 text (review #1165 r5 P1-1), plus cod + UM fără numere; singura excepție: meta_document', () => {
  it('cod + UM, cu sau fără numere; codul e altă celulă decât UM-ul', () => {
    expect(randCandidat(['B1', 'Lucrare', 'm'])).toBe('cod „B1”, UM „m”, 0 numere')
    expect(randCandidat(['', 'TSA01A1', 'Săpătură', 'MC', '', '', '', '', '', ''])).toBe('cod „TSA01A1”, UM „MC”, 0 numere')
    expect(randCandidat(['Suprafață', 'M2'])).toBeNull() // „M2” e UM (= MP), nu și cod în același timp; fără numere → nu e candidat
    expect(randCandidat(['Suprafață', 'M2', 5])).toBe('UM „M2”, 1 număr și text „Suprafață”')
  })
  it('UM + număr (+ text); ≥ 2 numere + text, inclusiv numere ca text cu semn', () => {
    expect(randCandidat(['Lucrare fără cod', 'buc', 30])).toBe('UM „buc”, 1 număr și text „Lucrare fără cod”')
    expect(randCandidat(['Lucrare fără cod', 'buc', '+30'])).toBe('UM „buc”, 1 număr și text „Lucrare fără cod”')
    expect(randCandidat(['m', 30])).toBe('UM „m”, 1 număr')
    expect(randCandidat(['Organizare de șantier', 'lei', 150, 300])).toBe('2 numere și text „Organizare de șantier”')
    expect(randCandidat(['Lucrare', '12,5', '+3', '-2'])).toBe('3 numere și text „Lucrare”')
  })
  it('reproducerile review-ului r5: UN număr + text ajunge — „B1 | Lucrare B | SET | +30”, „Lucrare B | +30”, „Lucrare | B1 | 30”, „Valoare totală (lei) | 20”', () => {
    expect(randCandidat(['B1', 'Lucrare B', 'SET', '+30'])).toBe('cod „B1”, 1 număr și text „Lucrare B”') // „SET” nu e în lista comună → nu e UM; codul și numărul ajung
    expect(randCandidat(['Lucrare B', '+30'])).toBe('1 număr și text „Lucrare B”')
    expect(randCandidat(['Lucrare', 'B1', 30])).toBe('cod „B1”, 1 număr și text „Lucrare”') // r5 consacra excluderea acestei forme — greșit
    expect(randCandidat(['B1', 30])).toBe('cod „B1”, 1 număr')
    expect(randCandidat(['Valoare totală (lei)', 20])).toBe('1 număr și text „Valoare totală (lei)”') // recapitulație pe copertă: fals pozitiv acceptat (o privire a omului)
    expect(randCandidat(['Total', '', '', '', 2])).toBe('1 număr și text „Total”')
  })
  it('nu sunt candidate: text singur, dată într-o celulă de text, număr fără text, indici, gol, procente, antetul documentului (meta_document)', () => {
    for (const row of [['Luna: octombrie 2026'], ['Data: 15.10.2026'], [5, 9], [0, 1, 2, 3], ['', ''], [], null, ['Cotă', '12%', '15%'], ['Data:', '15.10.2026'], ['Pagina', 1, 'din', 3], ['Nr. situație:', 5], ['Contract nr.', '30/2025', 'din', 2025]])
      expect(randCandidat(row), JSON.stringify(row)).toBeNull()
  })
  it('toate UM-urile din lista comună sunt recunoscute în regula (a)', () => {
    for (const [u] of UM_LISTA) expect(randCandidat(['A1', 'x', u.toLowerCase()]), u).toBe(`cod „A1”, UM „${u.toLowerCase()}”, 0 numere`)
  })
  it('forma rândurilor: index, date, gol', () => {
    expect(eRandIndex([0, 1, 2, 3])).toBe(true)
    expect(eRandIndex(['1', '2', '3'])).toBe(true)
    expect(eRandIndex([1, 3])).toBe(false)
    expect(eRandIndex([1])).toBe(false)
    expect(eRandDate([1, 2, 3])).toBe(false) // indici
    expect(eRandDate(['x', '+3'])).toBe(true)
    expect(eRandDate(['x', '3%'])).toBe(false)
    expect(eRandGol(undefined)).toBe(true)
    expect(eRandGol(['', null])).toBe(true)
    expect(tipRand('Organizare de șantier', '')).toBe('os')
  })
})

// ── META_DOCUMENT: lista albă a antetului de document (review #1165 r5 P1-1 → r6) — fiecare tipar cu un exemplu pozitiv (rând cu număr + text
// care NU e candidat) și unul negativ (text asemănător care NU se potrivește → rândul rămâne candidat). Așteptările sunt scrise de mână (L25).
describe('eMetaDocument — lista albă TIPARE_META_DOCUMENT, pozitiv și negativ pentru fiecare tipar', () => {
  const CAZURI = [
    // [tipar, rând pozitiv (→ meta, nu candidat), rând negativ (→ null meta, candidat)]
    ['nr_situatie', ['Situația de lucrări nr. 5', 5], ['Situare conductă', 5]],
    ['nr_situatie', ['Nr. situație:', 5], ['Nr. bucăți', 5]],
    ['luna', ['Luna: octombrie 2026', 10], ['Lunar verificare', 10]],
    ['luna', ['Octombrie 2026', 2026], ['Octogon montat', 2026]],
    ['an', ['Anul', 2026], ['Ancoră metalică', 2026]],
    ['perioada', ['Perioada: 01.10 – 31.10.2026', 31], ['Periodic', 31]],
    ['data', ['Data:', '15.10.2026'], ['Date tehnice', '15.10.2026']],
    ['pagina', ['Pagina', 1, 'din', 3], ['Pagubă', 1, 'din', 3]],
    ['pagina', ['Pag.', 2], ['Pagoda', 2]],
    ['contract', ['Contract nr.', '30/2025', 2025], ['Contractare servicii', 2025]],
    ['contract', ['Nr. contract', 30], ['Nr. conducte', 30]],
    ['beneficiar', ['Beneficiar:', 'X', 2026], ['Beneficiu estimat', 2026]],
    ['executant', ['Executantul:', 'Y', 2026], ['Execuție conductă', 2026]],
    ['obiectiv', ['Obiectiv:', 'Conductă', 2026], ['Obiectul: 01 Tronson', 2026]],
    ['cui', ['CUI', 12345678], ['Cuie', 12345678]],
    ['cui', ['C.U.I.:', 12345678], ['Cuib', 12345678]],
    ['cui', ['Cod fiscal', 12345678], ['Cod articol', 12345678]],
  ]
  it('lista albă are exact tiparele cerute, în ordine', () => {
    expect(TIPARE_META_DOCUMENT.map(t => t[0])).toEqual(['nr_situatie', 'luna', 'an', 'perioada', 'data', 'pagina', 'contract', 'beneficiar', 'executant', 'obiectiv', 'cui'])
  })
  it('fiecare tipar: pozitiv = meta_document (randCandidat null); negativ = nu e meta, rândul rămâne candidat', () => {
    for (const [tipar, poz, neg] of CAZURI) {
      expect(eMetaDocument(poz), JSON.stringify(poz)).toBe(tipar)
      expect(randCandidat(poz), JSON.stringify(poz)).toBeNull()
      expect(eMetaDocument(neg), JSON.stringify(neg)).toBeNull()
      expect(randCandidat(neg), JSON.stringify(neg)).not.toBeNull()
    }
    // fiecare tipar din listă e acoperit de cel puțin un caz pozitiv
    expect([...new Set(CAZURI.map(c => c[0]))].sort()).toEqual(TIPARE_META_DOCUMENT.map(t => t[0]).sort())
  })
  it('un rând cu cod de articol sau cu UM din lista comună NU poate fi meta_document, oricât ar începe cu un tipar de antet', () => {
    expect(eMetaDocument(['Data montaj', 'B1', 5])).toBeNull()
    expect(randCandidat(['Data montaj', 'B1', 5])).toBe('cod „B1”, 1 număr și text „Data montaj”')
    expect(eMetaDocument(['Contract lucrări', 'm', 30])).toBeNull()
    expect(randCandidat(['Contract lucrări', 'm', 30])).toBe('UM „m”, 1 număr și text „Contract lucrări”')
    expect(eMetaDocument(['Pagina', 'TSA01A1', 'mc', 2])).toBeNull()
    // forma: gol / indici / fără text / meta fără niciun număr (tot meta, dar oricum nu e candidat)
    expect(eMetaDocument([])).toBeNull()
    expect(eMetaDocument(null)).toBeNull()
    expect(eMetaDocument([0, 1, 2])).toBeNull()
    expect(eMetaDocument([5, 9])).toBeNull()
    expect(eMetaDocument(['Beneficiar: (sintetic)'])).toBe('beneficiar')
    expect(randCandidat(['Beneficiar: (sintetic)'])).toBeNull()
    // diacritice, majuscule, puncte: aceeași normalizare ca la antet
    expect(eMetaDocument(['SITUAȚIE DE LUCRĂRI NR. 7', 7])).toBe('nr_situatie')
    expect(eMetaDocument(['LUNA: OCTOMBRIE', 2026])).toBe('luna')
  })
})

describe('eTotalDovedit — total doar cu dovadă (review #1165 r5 P1-2): etichetă „Total …” fără cod de articol, fără UM din lista comună, fără cantitate', () => {
  it('dovedit: eticheta în denumire / cod / nr, cod gol sau el însuși „TOTAL”, UM necunoscută listei („lei”), cantități goale', () => {
    expect(eTotalDovedit({ etichete: ['TOTAL', '', ''], cod: '', um: '', cantitati: [null, null] })).toBe(true)
    expect(eTotalDovedit({ etichete: ['Total general', '', ''], cod: '', um: '', cantitati: [null] })).toBe(true)
    expect(eTotalDovedit({ etichete: ['', 'TOTAL', ''], cod: 'TOTAL', um: '', cantitati: [null, null] })).toBe(true)
    expect(eTotalDovedit({ etichete: ['', '', 'TOTAL'], cod: '', um: '', cantitati: [null] })).toBe(true)
    expect(eTotalDovedit({ etichete: ['Total deviz', '', ''], cod: '', um: 'lei', cantitati: [null] })).toBe(true)
    expect(eTotalDovedit({ etichete: ['  total  ', '', ''], cod: null, um: null, cantitati: [] })).toBe(true)
  })
  it('nedovedit: fără etichetă; „Totalizator”; cod de articol; UM din lista comună; o cantitate (număr sau text nenumeric)', () => {
    expect(eTotalDovedit({ etichete: ['Lucrare', '', ''], cod: '', um: '', cantitati: [null] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Totalizator montat', '', ''], cod: '', um: '', cantitati: [null] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Total station montaj', 'B1', ''], cod: 'B1', um: '', cantitati: [null] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Total station montaj', '', ''], cod: '', um: 'm', cantitati: [null] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Total station montaj', '', ''], cod: '', um: '', cantitati: [3, null] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Total', '', ''], cod: '', um: '', cantitati: [null, 3] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Total', '', ''], cod: '', um: '', cantitati: [NaN] })).toBe(false)
    expect(eTotalDovedit({ etichete: ['Total', '', ''], cod: '-', um: '', cantitati: [null] })).toBe(false)
  })
})

describe('verificaContabilizare — fiecare rând ne-gol are exact o clasă; candidații neacoperiți sunt probleme', () => {
  const rows = [['Titlu'], [], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate'], [1, 'A1', 'x', 'm', 2], ['Total', '', '', '', 2]]
  it('clasificare completă și corectă → fără probleme, sumar pe clase', () => {
    const r = verificaContabilizare('S', rows, [{ rand: 1, clasa: 'titlu' }, { rand: 3, clasa: 'antet' }, { rand: 4, clasa: 'articol' }, { rand: 5, clasa: 'total' }])
    expect(r).toEqual({ probleme: [], sumar: { titlu: 1, antet: 1, articol: 1, total: 1 } })
  })
  it('rând ne-gol fără clasă = problemă „invariant” (cu candidatul, dacă e)', () => {
    const r = verificaContabilizare('S', rows, [{ rand: 1, clasa: 'titlu' }, { rand: 3, clasa: 'antet' }, { rand: 5, clasa: 'total' }])
    expect(r.probleme).toEqual([{ foaie: 'S', rand: 4, motiv: 'invariant: rând ne-gol fără clasă (necontabilizat)', candidat: 'cod „A1”, UM „m”, 2 numere' }])
    const t = verificaContabilizare('S', rows, [{ rand: 3, clasa: 'antet' }, { rand: 4, clasa: 'articol' }, { rand: 5, clasa: 'total' }])
    expect(t.probleme).toEqual([{ foaie: 'S', rand: 1, motiv: 'invariant: rând ne-gol fără clasă (necontabilizat)', candidat: undefined }])
  })
  it('două clase pe același rând, clasă necunoscută, ignorat fără motiv, clasă pe rând gol / inexistent', () => {
    const r = verificaContabilizare('S', rows, [{ rand: 1, clasa: 'titlu' }, { rand: 1, clasa: 'ignorat', motiv: 'x' }, { rand: 2, clasa: 'titlu' }, { rand: 3, clasa: 'header' }, { rand: 4, clasa: 'articol' }, { rand: 5, clasa: 'ignorat' }, { rand: 9, clasa: 'titlu' }])
    expect(r.probleme.map(p => [p.rand, p.motiv])).toEqual([
      [1, 'invariant: rândul are două clase („titlu” și „ignorat”)'],
      [2, 'invariant: clasă „titlu” pe un rând gol'],
      [3, 'invariant: clasă necunoscută „header”'],
      [5, 'invariant: rând ignorat fără motiv explicit'],
      [5, 'rând de articol necontabilizat: arată a articol (1 număr și text „Total”), dar a fost clasificat „ignorat” — LIPSEȘTE din rezultat'],
      [9, 'invariant: clasă „titlu” pe un rând inexistent'],
    ])
    // „Total | 2 | 2” (numere + text) e candidat (r6: un număr ajunge) → ignoratul fără motiv e și încălcare de invariant, și candidat neacoperit
    const c = verificaContabilizare('S', [['Total', '', '', 2, 2]], [{ rand: 1, clasa: 'ignorat' }])
    expect(c.probleme.map(p => p.motiv)).toEqual(['invariant: rând ignorat fără motiv explicit', 'rând de articol necontabilizat: arată a articol (2 numere și text „Total”), dar a fost clasificat „ignorat” — LIPSEȘTE din rezultat'])
    // antetul documentului clasificat meta_document: nu e candidat → fără problemă; același rând clasificat „titlu” sau „ignorat” cu motiv → tot fără problemă (nu e candidat)
    for (const clasa of ['meta_document', 'titlu']) expect(verificaContabilizare('S', [['Pagina', 1, 'din', 3]], [{ rand: 1, clasa }]).probleme).toEqual([])
    // dar un rând CANDIDAT clasificat „meta_document” (parserul s-a înșelat) e problemă: meta_document nu acoperă candidați
    expect(verificaContabilizare('S', [['Lucrare B', '+30']], [{ rand: 1, clasa: 'meta_document' }]).probleme.map(p => [p.rand, p.clasa, p.candidat])).toEqual([[1, 'meta_document', '1 număr și text „Lucrare B”']])
  })
  it('candidat acoperit de articol / os / diverse / fara_miscare / total / problema = fără problemă; de antet / index / titlu / meta_document / sectiune / ignorat = problemă', () => {
    const art = [[1, 'A1', 'x', 'm', 2, 10, 20]]
    for (const clasa of CLASE_ACOPERA_CANDIDAT) expect(verificaContabilizare('S', art, [{ rand: 1, clasa }]).probleme, clasa).toEqual([])
    for (const clasa of CLASE_RAND.filter(c => !CLASE_ACOPERA_CANDIDAT.has(c))) {
      const p = verificaContabilizare('S', art, [{ rand: 1, clasa, motiv: 'de ce' }]).probleme
      expect(p.map(x => [x.rand, x.clasa, x.candidat]), clasa).toEqual([[1, clasa, 'cod „A1”, UM „m”, 4 numere']])
      expect(p[0].motiv).toBe(`rând de articol necontabilizat: arată a articol (cod „A1”, UM „m”, 4 numere), dar a fost clasificat „${clasa}” (de ce) — LIPSEȘTE din rezultat`)
    }
    expect(CLASE_RAND).toEqual(['antet', 'index', 'titlu', 'meta_document', 'sectiune', 'articol', 'os', 'diverse', 'fara_miscare', 'total', 'ignorat', 'problema'])
    expect([...CLASE_ACOPERA_CANDIDAT].sort()).toEqual(['articol', 'diverse', 'fara_miscare', 'os', 'problema', 'total'])
  })
})

// ── TEST-PROPRIETATE: foi sintetice generate determinist (mulberry32) ──
function prng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const UM_SINT = ['m', 'mc', 'mp', 'buc', 'kg', 'HM', '100 MC', 'ml', 't']
const CODURI = ['TSA01A1', 'TSD01B1', 'RPCU01', 'IZF01', 'B1', 'TSC02', 'XYZ9']
// antetul documentului pe celule separate (r6): rânduri cu număr + text care NU sunt candidate (lista albă TIPARE_META_DOCUMENT) — nicio problemă
const META_RANDURI = [['Situația de lucrări nr.', 5], ['Nr. situație:', 5, 'Luna:', 'octombrie'], ['Luna: octombrie 2026', 10], ['Anul', 2026], ['Perioada:', '01.10.2026 - 31.10.2026', 31], ['Data:', '15.10.2026'], ['Pagina', 1, 'din', 3], ['Contract nr.', '30/2025', 'din', 2025], ['Beneficiar:', '(sintetic)', 'CUI', 1234567], ['Executant:', '(sintetic)', 'Cod fiscal', 7654321], ['Obiectiv:', 'Conductă (sintetic)', 2026]]
// formele articolelor (r6): normal; „SET” (UM în afara listei comune → în tabel e linie cu UM brut); „Total <cod> …” cu cod (în tabel e ARTICOL, nu
// total); „text + număr” fără cod și fără UM („Lucrare B | +30” → niciodată linie: problemă oriunde ar sta)
const FORME = ['normal', 'normal', 'set', 'total_cu_cod', 'text_numar']
/**
 * Generează un registru sintetic pentru parseSituatieExcel (modelul Transgaz) și lista articolelor generate: { foaie, rand, cod, unde, forma, asteptat }
 * unde ∈ 'inainte_antet' | 'fara_antet' | 'tabel' | 'dupa_total'; asteptat ∈ 'linie' | 'problema'. Prima foaie e mereu cu antet și cel puțin un
 * articol în tabel. O foaie cu antet poate avea un rând de calificativ MIXT deasupra („contract | … | Observații”, r5 P1-3): atunci „Cantitate”
 * devine contract, foaia e nerecunoscută și TOATE articolele ei trebuie să fie probleme (niciodată cantitate_perioada = contract tăcut).
 * Rândurile `meta` (antetul documentului) și `recap` („Valoare totală (lei) | N”, candidat → raportat, fals pozitiv acceptat) sunt returnate separat.
 */
function genereazaSituatie(seed) {
  const rnd = prng(seed), int = n => Math.floor(rnd() * n), pick = a => a[int(a.length)]
  const ANTET = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare']
  const ANTET_CUM = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulat', 'Preț unitar', 'Valoare']
  const foi = [], articole = [], meta = [], recap = []
  const nFoi = 1 + int(3)
  for (let i = 0; i < nFoi; i++) {
    const nume = `F${i + 1}`, rows = []
    const tip = i === 0 ? 'tabel' : pick(['tabel', 'tabel', 'fara_antet', 'coperta'])
    const cuCumulat = rnd() < 0.4, stricat = tip === 'tabel' && i > 0 && rnd() < 0.45
    const articol = (unde) => {
      const cod = pick(CODURI), forma = pick(FORME), p = 1 + int(50)
      const fq = int(5), qv = 1 + int(20)
      // cantitatea: număr, text „+N”, text RO „1.234,5”, text EN „-2.5”, sau număr negativ
      const q = fq === 0 ? qv : fq === 1 ? `+${qv}` : fq === 2 ? '1.234,5' : fq === 3 ? '-2.5' : -qv
      const qn = fq === 1 ? qv : fq === 2 ? 1234.5 : fq === 3 ? -2.5 : q
      const v = Math.round(qn * p * 100) / 100
      const um = forma === 'set' ? 'SET' : pick(UM_SINT)
      const den = forma === 'total_cu_cod' ? `Total ${cod} montaj` : `Lucrare ${cod}`
      if (forma === 'text_numar') rows.push([den, q])
      else rows.push(cuCumulat ? [articole.length + 1, cod, den, um, q, qv + 1, p, v] : [articole.length + 1, cod, den, um, q, p, v])
      const inTabel = (unde === 'tabel' || unde === 'dupa_total') && !stricat
      articole.push({ foaie: nume, rand: rows.length, cod, unde, forma, asteptat: inTabel && forma !== 'text_numar' ? 'linie' : 'problema' })
    }
    const gol = () => { if (rnd() < 0.3) rows.push([]) }
    const note = () => { for (let k = int(4); k > 0; k--) rows.push([`Notă ${k}`]) }
    const antetDoc = () => { for (let k = int(3); k > 0; k--) { rows.push([...pick(META_RANDURI)]); meta.push({ foaie: nume, rand: rows.length }) } }
    if (tip === 'coperta') {
      rows.push(['Situație de lucrări']); antetDoc(); rows.push(['Întocmit,', '', 'Verificat,'])
      if (rnd() < 0.3) { rows.push(['Valoare totală (lei)', 20]); recap.push({ foaie: nume, rand: rows.length }) }
      foi.push({ nume, rows }); continue
    }
    antetDoc(); note(); gol()
    if (tip === 'fara_antet') { for (let k = 1 + int(3); k > 0; k--) { articol('fara_antet'); gol() } foi.push({ nume, rows }); continue }
    for (let k = int(3); k > 0; k--) { articol('inainte_antet'); gol() }
    note()
    if (stricat) rows.push(['', '', '', '', 'contract', '', '', '', 'Observații'])
    rows.push(cuCumulat ? ANTET_CUM : ANTET)
    if (rnd() < 0.3) rows.push(cuCumulat ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6])
    if (rnd() < 0.5) rows.push([`Obiectul: 0${i + 1} Tronson`])
    for (let k = 1 + int(4); k > 0; k--) { articol('tabel'); gol() }
    if (rnd() < 0.7) rows.push(cuCumulat ? ['TOTAL', '', '', '', '', '', '', 0] : ['TOTAL', '', '', '', '', '', 0])
    for (let k = int(3); k > 0; k--) { articol('dupa_total'); gol() }
    if (rnd() < 0.3) rows.push(['Întocmit,', '', 'Verificat,'])
    foi.push({ nume, rows, stricat, cuCumulat })
  }
  // prima foaie are mereu cel puțin un articol de tabel care nu e „text_numar” (altfel parseSituatieExcel aruncă „nicio linie”, legitim)
  if (!articole.some(a => a.asteptat === 'linie')) { const f = foi[0]; f.rows.push(f.cuCumulat ? [99, 'TSA01A1', 'Lucrare TSA01A1', 'm', 1, 2, 1, 1] : [99, 'TSA01A1', 'Lucrare TSA01A1', 'm', 1, 1, 1]); articole.push({ foaie: f.nume, rand: f.rows.length, cod: 'TSA01A1', unde: 'dupa_total', forma: 'normal', asteptat: 'linie' }) }
  return { foi, articole, meta, recap }
}

describe('PROPRIETATE: nimic nu dispare tăcut — articolele generate ⊆ linii ∪ fara_miscare_randuri ∪ probleme (foaie + rând)', () => {
  const SEMINTE = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919)
  it('parseSituatieExcel, pe 60 de registre sintetice (forme r6: SET, „Total <cod>”, „text | +N”, calificativ mixt, antet de document, recapitulație)', async () => {
    const nr = { tabel: 0, inainte_antet: 0, fara_antet: 0, dupa_total: 0, set: 0, total_cu_cod: 0, text_numar: 0, stricat: 0, meta: 0, recap: 0, cuCumulat: 0 }
    for (const seed of SEMINTE) {
      const { foi, articole, meta, recap } = genereazaSituatie(seed)
      const r = await parseSituatieExcel(xlsx(foi))
      const acoperit = new Set([...r.linii, ...r.fara_miscare_randuri].map(l => `${l.foaie}|${l.rand}`))
      const problematic = new Set(r.probleme.map(p => `${p.foaie}|${p.rand}`))
      for (const a of articole) {
        const cheie = `${a.foaie}|${a.rand}`, et = `seed ${seed}: articolul ${a.cod} din ${cheie} (${a.unde}, ${a.forma})`
        const inLinii = acoperit.has(cheie), inProbleme = problematic.has(cheie)
        expect(inLinii || inProbleme, `${et} a dispărut tăcut`).toBe(true)
        // ce NU poate deveni linie (înaintea antetului, fără antet, foaie cu calificativ mixt, „text | +N”) e problemă și NU e linie;
        // ce e în tabel / după total, cu cod + UM (inclusiv „SET” și denumirea „Total <cod>”), e LINIE
        if (a.asteptat === 'problema') { expect(inProbleme, `${et} trebuie să fie problemă`).toBe(true); expect(inLinii, `${et} nu poate fi linie`).toBe(false) }
        else expect(inLinii, `${et} trebuie să fie linie`).toBe(true)
        nr[a.unde]++; if (a.forma !== 'normal') nr[a.forma]++
      }
      // „Total <cod> …” în tabel e articol: niciodată total_doc; avertismentul îl arată omului
      for (const a of articole.filter(a => a.forma === 'total_cu_cod' && a.asteptat === 'linie')) expect(r.avertismente.some(w => w.foaie === a.foaie && w.rand === a.rand && /citit ca articol, nu ca total/.test(w.motiv)), `seed ${seed}: ${a.cod}`).toBe(true)
      // antetul documentului (meta_document) nu e niciodată problemă; recapitulația de pe copertă e raportată (fals pozitiv acceptat)
      for (const m of meta) { expect(problematic.has(`${m.foaie}|${m.rand}`), `seed ${seed}: antetul documentului ${m.foaie}|${m.rand} raportat ca problemă`).toBe(false); nr.meta++ }
      for (const m of recap) { expect(problematic.has(`${m.foaie}|${m.rand}`), `seed ${seed}: recapitulația ${m.foaie}|${m.rand} nu e raportată`).toBe(true); nr.recap++ }
      for (const f of foi) { if (f.stricat) { expect(r.foi, `seed ${seed}: ${f.nume} cu calificativ mixt nu poate fi citită`).not.toContain(f.nume); nr.stricat++ } }
      nr.cuCumulat += foi.filter(f => f.cuCumulat && f.rows.some(row => row[5] === 'Cantitate cumulat')).length
      // complet = probleme goale, o singură definiție; fiecare linie / problemă indică un rând real al foii
      expect(r.complet).toBe(r.probleme.length === 0)
      for (const l of [...r.linii, ...r.probleme]) expect(foi.find(f => f.nume === l.foaie).rows.length, `seed ${seed}: rândul ${l.rand} din ${l.foaie}`).toBeGreaterThanOrEqual(l.rand)
      // suma claselor = rândurile ne-gole ale fiecărei foi; meta_document apare doar pe rândurile de antet de document
      for (const f of foi) expect(Object.values(r.contabilizare[f.nume]).reduce((s, n) => s + n, 0), `seed ${seed}: ${f.nume}`).toBe(f.rows.filter(row => row.some(c => c !== '' && c != null)).length)
    }
    // generatorul a produs efectiv toate categoriile (altfel proprietatea ar fi goală pe o categorie)
    expect(nr.tabel).toBeGreaterThan(50)
    expect(nr.inainte_antet).toBeGreaterThan(20)
    expect(nr.fara_antet).toBeGreaterThan(10)
    expect(nr.dupa_total).toBeGreaterThan(20)
    for (const k of ['set', 'total_cu_cod', 'text_numar']) expect(nr[k], k).toBeGreaterThan(20)
    expect(nr.stricat).toBeGreaterThan(5)
    expect(nr.meta).toBeGreaterThan(30)
    expect(nr.recap).toBeGreaterThan(3)
    expect(nr.cuCumulat).toBeGreaterThan(10)
  })
  it('parseDevizModificare (Excel AA), pe 60 de registre sintetice (forme r6: SET, „Total <cod>”, „text | +N”, antet de document, total cu / fără cantitate)', async () => {
    const ANTET = ['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate']
    const nr = { linie: 0, problema: 0, set: 0, total_cu_cod: 0, text_numar: 0, meta: 0, totalCant: 0, totalOk: 0 }
    for (const seed of SEMINTE) {
      const rnd = prng(seed), int = n => Math.floor(rnd() * n), pick = a => a[int(a.length)]
      const foi = [], articole = [], meta = [], totalCant = [], totalOk = []
      for (let i = 0; i < 1 + int(3); i++) {
        const nume = `D${i + 1}`, rows = [], cuAntet = i === 0 || rnd() < 0.6
        const articol = unde => {
          const cod = pick(CODURI), forma = pick(FORME), f = int(3), q = f === 0 ? 1 + int(9) : f === 1 ? `+${1 + int(9)}` : -(1 + int(9))
          const den = forma === 'total_cu_cod' ? `Total ${cod} montaj` : `Lucrare ${cod}`
          if (forma === 'text_numar') rows.push([den, q]); else rows.push([rows.length + 1, cod, den, forma === 'set' ? 'SET' : pick(UM_SINT), q])
          const inTabel = unde === 'tabel' || unde === 'dupa_total'
          articole.push({ foaie: nume, rand: rows.length, cod, unde, forma, asteptat: inTabel && forma !== 'text_numar' ? 'linie' : 'problema' })
        }
        for (let k = int(3); k > 0; k--) { rows.push([...pick(META_RANDURI)]); meta.push({ foaie: nume, rand: rows.length }) }
        for (let k = int(3); k > 0; k--) rows.push([`Notă ${k}`])
        if (rnd() < 0.3) rows.push([])
        for (let k = int(2); k > 0; k--) articol(cuAntet ? 'inainte_antet' : 'fara_antet')
        if (cuAntet) {
          rows.push(ANTET)
          for (let k = 1 + int(4); k > 0; k--) { articol('tabel'); if (rnd() < 0.3) rows.push([]) }
          // totalul dovedit (valoarea în altă coloană) e total; „Total deviz” cu un număr în coloana Cantitate NU e total dovedit → problemă
          if (rnd() < 0.5) { if (rnd() < 0.5) { rows.push(['', '', 'Total deviz', '', '', 99]); totalOk.push({ foaie: nume, rand: rows.length }) } else { rows.push(['', '', 'Total deviz', '', 99]); totalCant.push({ foaie: nume, rand: rows.length }) } }
          for (let k = int(2); k > 0; k--) articol('dupa_total')
        } else for (let k = int(3); k > 0; k--) articol('fara_antet')
        foi.push({ nume, rows })
      }
      if (!articole.some(a => a.asteptat === 'linie')) { foi[0].rows.push([99, 'TSA01A1', 'Lucrare TSA01A1', 'm', 1]); articole.push({ foaie: 'D1', rand: foi[0].rows.length, cod: 'TSA01A1', unde: 'dupa_total', forma: 'normal', asteptat: 'linie' }) }
      const r = await parseDevizModificare({ name: 'aa.xlsx', arrayBuffer: async () => xlsx(foi) })
      const linii = new Set(r.linii.map(l => `${l.obiect_nume}|${Number(l.nr) + 1}`)), probleme = new Set(r.probleme.map(p => `${p.foaie}|${p.rand}`))
      for (const a of articole) {
        const cheie = `${a.foaie}|${a.rand}`, et = `seed ${seed}: ${a.cod} din ${cheie} (${a.unde}, ${a.forma})`
        expect(linii.has(cheie) || probleme.has(cheie), `${et} a dispărut tăcut`).toBe(true)
        if (a.asteptat === 'linie') { expect(linii.has(cheie), `${et} trebuie să fie linie`).toBe(true); nr.linie++ }
        else { expect(probleme.has(cheie), `${et} trebuie să fie problemă`).toBe(true); expect(linii.has(cheie), `${et} nu poate fi linie`).toBe(false); nr.problema++ }
        if (a.forma !== 'normal') nr[a.forma]++
      }
      for (const m of meta) { expect(probleme.has(`${m.foaie}|${m.rand}`), `seed ${seed}: antetul documentului ${m.foaie}|${m.rand} raportat`).toBe(false); expect(linii.has(`${m.foaie}|${m.rand}`)).toBe(false); nr.meta++ }
      for (const t of totalOk) { expect(probleme.has(`${t.foaie}|${t.rand}`) || linii.has(`${t.foaie}|${t.rand}`), `seed ${seed}: totalul dovedit ${t.foaie}|${t.rand}`).toBe(false); nr.totalOk++ }
      for (const t of totalCant) { expect(probleme.has(`${t.foaie}|${t.rand}`), `seed ${seed}: „Total deviz” cu cantitate ${t.foaie}|${t.rand} nu e raportat`).toBe(true); nr.totalCant++ }
      expect(r.complet).toBe(r.probleme.length === 0)
    }
    expect(nr.linie).toBeGreaterThan(100)
    expect(nr.problema).toBeGreaterThan(30)
    for (const k of ['set', 'total_cu_cod', 'text_numar']) expect(nr[k], k).toBeGreaterThan(20)
    expect(nr.meta).toBeGreaterThan(30)
    expect(nr.totalOk).toBeGreaterThan(5)
    expect(nr.totalCant).toBeGreaterThan(5)
  })
})
