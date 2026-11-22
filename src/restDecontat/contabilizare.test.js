// Invariantul de contabilizare (review #1165 r5): teste unitare pe eNumeric / numar / randCandidat / verificaContabilizare și un
// TEST-PROPRIETATE: foi sintetice generate determinist (articole în poziții aleatoare — înaintea antetului, în foi fără antet, după
// total, cu „+”, cu text numeric RO), prin parseSituatieExcel ȘI prin parseDevizModificare (Excel AA): fiecare articol generat apare în
// linii / fara_miscare_randuri SAU în probleme (cu foaia și rândul lui) — nimic nu dispare tăcut. Fixture-uri sintetice, fără date reale.
import { describe, it, expect } from 'vitest'
import * as XLSX_mod from 'xlsx-js-style'
import { eNumeric, numar, RE_NUMAR_AMBIGUU, randCandidat, tipRand, CLASE_RAND, CLASE_ACOPERA_CANDIDAT, verificaContabilizare, eRandIndex, eRandDate, eRandGol } from './contabilizare.js'
import { parseSituatieExcel, parseDevizModificare, eNumeric as eNumericReexport, randCandidat as randCandidatReexport } from './parsareSituatie.js'
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
  })
})

describe('randCandidat — regulile (a) cod + UM, (b) UM + număr + text, (c) ≥ 2 numere + text', () => {
  it('(a) cod + UM, cu sau fără numere; codul e altă celulă decât UM-ul', () => {
    expect(randCandidat(['B1', 'Lucrare', 'm'])).toBe('cod „B1”, UM „m”, 0 numere')
    expect(randCandidat(['', 'TSA01A1', 'Săpătură', 'MC', '', '', '', '', '', ''])).toBe('cod „TSA01A1”, UM „MC”, 0 numere')
    expect(randCandidat(['Suprafață', 'M2'])).toBeNull() // „M2” e UM (= MP), nu și cod în același timp
    expect(randCandidat(['Suprafață', 'M2', 5])).toBe('UM „M2”, 1 număr și text „Suprafață”')
  })
  it('(b) UM + ≥ 1 număr + text; (c) ≥ 2 numere + text, inclusiv numere ca text cu semn', () => {
    expect(randCandidat(['Lucrare fără cod', 'buc', 30])).toBe('UM „buc”, 1 număr și text „Lucrare fără cod”')
    expect(randCandidat(['Lucrare fără cod', 'buc', '+30'])).toBe('UM „buc”, 1 număr și text „Lucrare fără cod”')
    expect(randCandidat(['Organizare de șantier', 'lei', 150, 300])).toBe('2 numere și text „Organizare de șantier”')
    expect(randCandidat(['Lucrare', '12,5', '+3', '-2'])).toBe('3 numere și text „Lucrare”')
  })
  it('nu sunt candidate: etichetă cu o cifră, text singur, dată într-o celulă, număr fără text, indici, gol, procente', () => {
    for (const row of [['Valoare totală (lei)', 20], ['Luna: octombrie 2026'], ['Data:', '15.10.2026'], [5, 9], [0, 1, 2, 3], ['', ''], [], null, ['Cotă', '12%', '15%'], ['Lucrare', 'B1', 30]])
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
      [9, 'invariant: clasă „titlu” pe un rând inexistent'],
    ])
    // „Total | 2” (un număr + text) nu e candidat → ignoratul fără motiv e doar încălcare de invariant; cu două numere ar fi și candidat neacoperit
    const c = verificaContabilizare('S', [['Total', '', '', 2, 2]], [{ rand: 1, clasa: 'ignorat' }])
    expect(c.probleme.map(p => p.motiv)).toEqual(['invariant: rând ignorat fără motiv explicit', 'rând de articol necontabilizat: arată a articol (2 numere și text „Total”), dar a fost clasificat „ignorat” — LIPSEȘTE din rezultat'])
  })
  it('candidat acoperit de articol / os / diverse / fara_miscare / total / problema = fără problemă; de antet / index / titlu / sectiune / ignorat = problemă', () => {
    const art = [[1, 'A1', 'x', 'm', 2, 10, 20]]
    for (const clasa of CLASE_ACOPERA_CANDIDAT) expect(verificaContabilizare('S', art, [{ rand: 1, clasa }]).probleme, clasa).toEqual([])
    for (const clasa of CLASE_RAND.filter(c => !CLASE_ACOPERA_CANDIDAT.has(c))) {
      const p = verificaContabilizare('S', art, [{ rand: 1, clasa, motiv: 'de ce' }]).probleme
      expect(p.map(x => [x.rand, x.clasa, x.candidat]), clasa).toEqual([[1, clasa, 'cod „A1”, UM „m”, 4 numere']])
      expect(p[0].motiv).toBe(`rând de articol necontabilizat: arată a articol (cod „A1”, UM „m”, 4 numere), dar a fost clasificat „${clasa}” (de ce) — LIPSEȘTE din rezultat`)
    }
    expect(CLASE_RAND).toEqual(['antet', 'index', 'titlu', 'sectiune', 'articol', 'os', 'diverse', 'fara_miscare', 'total', 'ignorat', 'problema'])
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
/**
 * Generează un registru sintetic pentru parseSituatieExcel (modelul Transgaz) și lista articolelor generate: { foaie, rand, cod, unde }
 * unde ∈ 'inainte_antet' | 'fara_antet' | 'tabel' | 'dupa_total'. Prima foaie e mereu validă cu cel puțin un articol în tabel.
 */
function genereazaSituatie(seed) {
  const rnd = prng(seed), int = n => Math.floor(rnd() * n), pick = a => a[int(a.length)]
  const ANTET = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare']
  const foi = [], articole = []
  const nFoi = 1 + int(3)
  for (let i = 0; i < nFoi; i++) {
    const nume = `F${i + 1}`, rows = []
    const tip = i === 0 ? 'tabel' : pick(['tabel', 'tabel', 'fara_antet', 'coperta'])
    const articol = (unde) => {
      const cod = pick(CODURI), um = pick(UM_SINT), p = 1 + int(50)
      const forma = int(5), qv = 1 + int(20)
      // cantitatea: număr, text „+N”, text RO „1.234,5”, text EN „-2.5”, sau număr negativ
      const q = forma === 0 ? qv : forma === 1 ? `+${qv}` : forma === 2 ? '1.234,5' : forma === 3 ? '-2.5' : -qv
      const qn = forma === 1 ? qv : forma === 2 ? 1234.5 : forma === 3 ? -2.5 : q
      const v = Math.round(qn * p * 100) / 100
      rows.push([articole.length + 1, cod, `Lucrare ${cod}`, um, q, p, v])
      articole.push({ foaie: nume, rand: rows.length, cod, unde })
    }
    const gol = () => { if (rnd() < 0.3) rows.push([]) }
    const note = () => { for (let k = int(4); k > 0; k--) rows.push([`Notă ${k}`]) }
    if (tip === 'coperta') { rows.push(['Situație de lucrări'], ['Luna: octombrie 2026'], ['Valoare totală (lei)', 20]); foi.push({ nume, rows }); continue }
    note(); gol()
    if (tip === 'fara_antet') { for (let k = 1 + int(3); k > 0; k--) { articol('fara_antet'); gol() } foi.push({ nume, rows }); continue }
    for (let k = int(3); k > 0; k--) { articol('inainte_antet'); gol() }
    note()
    rows.push(ANTET)
    if (rnd() < 0.3) rows.push([0, 1, 2, 3, 4, 5, 6])
    if (rnd() < 0.5) rows.push([`Obiectul: 0${i + 1} Tronson`])
    for (let k = 1 + int(4); k > 0; k--) { articol('tabel'); gol() }
    if (rnd() < 0.7) rows.push(['TOTAL', '', '', '', '', '', 0])
    for (let k = int(3); k > 0; k--) { articol('dupa_total'); gol() }
    if (rnd() < 0.3) rows.push(['Întocmit,', '', 'Verificat,'])
    foi.push({ nume, rows })
  }
  return { foi, articole }
}

describe('PROPRIETATE: nimic nu dispare tăcut — articolele generate ⊆ linii ∪ fara_miscare_randuri ∪ probleme (foaie + rând)', () => {
  const SEMINTE = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919)
  it('parseSituatieExcel, pe 60 de registre sintetice', async () => {
    let tabel = 0, inainte = 0, faraAntet = 0, dupaTotal = 0, totalArticole = 0
    for (const seed of SEMINTE) {
      const { foi, articole } = genereazaSituatie(seed)
      const r = await parseSituatieExcel(xlsx(foi))
      const acoperit = new Set([...r.linii, ...r.fara_miscare_randuri].map(l => `${l.foaie}|${l.rand}`))
      const problematic = new Set(r.probleme.map(p => `${p.foaie}|${p.rand}`))
      for (const a of articole) {
        const cheie = `${a.foaie}|${a.rand}`
        const inLinii = acoperit.has(cheie), inProbleme = problematic.has(cheie)
        expect(inLinii || inProbleme, `seed ${seed}: articolul ${a.cod} din ${cheie} (${a.unde}) a dispărut tăcut`).toBe(true)
        // ce NU poate deveni linie trebuie să fie problemă; ce e în tabel / după total trebuie să fie linie (sau problemă cu motiv de număr)
        if (a.unde === 'inainte_antet' || a.unde === 'fara_antet') expect(inProbleme, `seed ${seed}: ${cheie} (${a.unde}) trebuie să fie problemă`).toBe(true)
        if (a.unde === 'inainte_antet' || a.unde === 'fara_antet') expect(inLinii, `seed ${seed}: ${cheie} (${a.unde}) nu poate fi linie`).toBe(false)
        totalArticole++
        if (a.unde === 'tabel') tabel++; else if (a.unde === 'inainte_antet') inainte++; else if (a.unde === 'fara_antet') faraAntet++; else dupaTotal++
      }
      // complet = probleme goale, o singură definiție; fiecare linie / problemă indică un rând real al foii
      expect(r.complet).toBe(r.probleme.length === 0)
      for (const l of [...r.linii, ...r.probleme]) expect(foi.find(f => f.nume === l.foaie).rows.length, `seed ${seed}: rândul ${l.rand} din ${l.foaie}`).toBeGreaterThanOrEqual(l.rand)
      // suma claselor = rândurile ne-gole ale fiecărei foi
      for (const f of foi) expect(Object.values(r.contabilizare[f.nume]).reduce((s, n) => s + n, 0), `seed ${seed}: ${f.nume}`).toBe(f.rows.filter(row => row.some(c => c !== '' && c != null)).length)
    }
    // generatorul a produs efectiv toate categoriile (altfel proprietatea ar fi goală pe o categorie)
    expect(tabel).toBeGreaterThan(50)
    expect(inainte).toBeGreaterThan(20)
    expect(faraAntet).toBeGreaterThan(10)
    expect(dupaTotal).toBeGreaterThan(20)
    expect(totalArticole).toBeGreaterThan(200)
  })
  it('parseDevizModificare (Excel AA), pe 60 de registre sintetice', async () => {
    const ANTET = ['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate']
    let inProblemeTotal = 0, inLiniiTotal = 0
    for (const seed of SEMINTE) {
      const rnd = prng(seed), int = n => Math.floor(rnd() * n), pick = a => a[int(a.length)]
      const foi = [], articole = []
      for (let i = 0; i < 1 + int(3); i++) {
        const nume = `D${i + 1}`, rows = [], cuAntet = i === 0 || rnd() < 0.6
        const articol = unde => { const cod = pick(CODURI), f = int(3); rows.push([rows.length + 1, cod, `Lucrare ${cod}`, pick(UM_SINT), f === 0 ? 1 + int(9) : f === 1 ? `+${1 + int(9)}` : -(1 + int(9))]); articole.push({ foaie: nume, rand: rows.length, cod, unde }) }
        for (let k = int(3); k > 0; k--) rows.push([`Notă ${k}`])
        if (rnd() < 0.3) rows.push([])
        for (let k = int(2); k > 0; k--) articol(cuAntet ? 'inainte_antet' : 'fara_antet')
        if (cuAntet) { rows.push(ANTET); for (let k = 1 + int(4); k > 0; k--) { articol('tabel'); if (rnd() < 0.3) rows.push([]) } if (rnd() < 0.5) rows.push(['', '', 'Total deviz', '', 99]); for (let k = int(2); k > 0; k--) articol('dupa_total') }
        else for (let k = int(3); k > 0; k--) articol('fara_antet')
        foi.push({ nume, rows })
      }
      const r = await parseDevizModificare({ name: 'aa.xlsx', arrayBuffer: async () => xlsx(foi) })
      const linii = new Set(r.linii.map(l => `${l.obiect_nume}|${Number(l.nr) + 1}`)), probleme = new Set(r.probleme.map(p => `${p.foaie}|${p.rand}`))
      for (const a of articole) {
        const cheie = `${a.foaie}|${a.rand}`
        expect(linii.has(cheie) || probleme.has(cheie), `seed ${seed}: ${a.cod} din ${cheie} (${a.unde}) a dispărut tăcut`).toBe(true)
        if (a.unde === 'tabel' || a.unde === 'dupa_total') { expect(linii.has(cheie), `seed ${seed}: ${cheie} (${a.unde}) trebuie să fie linie`).toBe(true); inLiniiTotal++ }
        else { expect(probleme.has(cheie), `seed ${seed}: ${cheie} (${a.unde}) trebuie să fie problemă`).toBe(true); inProblemeTotal++ }
      }
      expect(r.complet).toBe(r.probleme.length === 0)
    }
    expect(inLiniiTotal).toBeGreaterThan(100)
    expect(inProblemeTotal).toBeGreaterThan(30)
  })
})
