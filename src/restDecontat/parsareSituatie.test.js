// Teste pentru parsarea situației de lucrări detaliate (modelul Transgaz) — fixture-uri SINTETICE (coduri / denumiri inventate,
// fără proiecte, prețuri sau nume reale). Paritatea UM / cheie cu migrarea 20270105a se verifică pe textul migrării (L19).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { parseSituatieExcel, parseDevizModificare, recunoasteAntet, clasificaColoana, antetDinTitluri, antetDinFoi, tipRand, CAMPURI_LINIE_RPC, COLOANE_OBLIGATORII } from './parsareSituatie.js'
import { UM_LISTA, normalizeUm, acelasiUm, umCanonic } from './um.js'
import { cheieClient } from './potrivire.js'
import { parseDeviz, articoleDinParagrafe } from '../devizParser.js'
const XLSX = XLSX_mod.default || XLSX_mod

const MIG = fs.readFileSync(new URL('../../supabase/migrations/20270105a_executie_rest_decontat.sql', import.meta.url), 'utf8').replace(/\r/g, '')

/** registru de lucru .xlsx în memorie: foi = [{ nume, rows, merges? }] → ArrayBuffer */
function xlsx(foi) {
  const wb = XLSX.utils.book_new()
  for (const f of foi) {
    const ws = XLSX.utils.aoa_to_sheet(f.rows)
    if (f.merges) ws['!merges'] = f.merges
    XLSX.utils.book_append_sheet(wb, ws, f.nume)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
const M = (r1, c1, r2, c2) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })

// ── fixture A: modelul Transgaz cu antet pe două rânduri + celule unite + rândul de indici, 3 obiecte, cod repetat, OS, diverse, negativ ──
const TITLU = [['SITUAȚIE DE LUCRĂRI NR. 7'], ['Luna: Octombrie 2026'], ['Beneficiar: (sintetic)'], []]
const ANTET_A = ['Nr. crt.', 'Simbol', 'Denumire lucrare', 'U.M.', 'Cantitate', '', '', 'Preț unitar', 'Valoare', '']
const ANTET_B = ['', '', '', '', 'contract', 'realizată în perioadă', 'cumulat', '', 'în perioadă', 'cumulat']
const INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const DATE_A = [
  ['Obiectul: 01 Tronson A'],
  ['Deviz oferta 0101 Conductă'],
  [1, 'TSA01A1', 'Săpătură manuală', 'MC', 100, 20, 60, 10, 200, 600],
  [2, 'TSD01B1', 'Umplutură compactată', 'MC', 100, 15, 15, 8, 120, 120],
  [3, 'RPCU01', 'Montaj țeavă', 'M', 500, -5, 95, 50, -250, 4750],
  [4, 'TSC02', 'Transport pământ', 'T', 10, '', 4, 20, '', 80],
  ['Obiectul: 02 Tronson B'],
  ['Deviz oferta 0201 Conductă B'],
  [1, 'TSA01A1', 'Săpătură manuală în teren tare', 'MC', 50, 5, 10, 11, 55, 110],
  [2, 'TSA01A1', 'Săpătură manuală în teren tare, partea 2', 'MC', 50, 2, 2, 11, 22, 22],
  ['Obiectul: 03 Stație'],
  ['Deviz oferta 0301 Izolații'],
  [1, 'IZF01', 'Izolație anticorozivă', '100 MP', 2, 0.5, 1, 1000, 500, 1000],
  [2, '', 'Proba de presiune a conductei', 'buc', 1, 1, 1, 300, 300, 300],
  ['', 'OS', 'Organizare de șantier', 'lei', '', '', '', '', 150, 300],
  ['', '', 'Diverse și neprevăzute', 'lei', '', 1, 2, 40, 40, 80],
  [],
  ['', '', 'TOTAL', '', '', '', '', '', 1137, 7362],
]
const MERGES_A = [M(4, 4, 4, 6), M(4, 8, 4, 9), M(4, 0, 5, 0), M(4, 1, 5, 1), M(4, 2, 5, 2), M(4, 3, 5, 3), M(4, 7, 5, 7)]
const fixtureA = () => xlsx([{ nume: 'Situatie', rows: [...TITLU, ANTET_A, ANTET_B, INDEX, ...DATE_A], merges: MERGES_A }])
const COLOANE_A = { nr: 0, cod: 1, denumire: 2, um: 3, pret_unitar: 7, cantitate_perioada: 5, cantitate_cumulat: 6, valoare: 8 }

describe('paritate cu migrarea 20270105a (L19: o singură definiție)', () => {
  it('UM_LISTA = exact lista UM-START / UM-END din fn_rest_decontat_um', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_um'), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_rest_decontat_um('))
    const bloc = corp.match(/-- UM-START\n([\s\S]*?)-- UM-END/)
    expect(bloc).not.toBeNull()
    const sql = [...bloc[1].matchAll(/\('([0-9A-Z]+)', (\d+), '([A-Z]+)'\)/g)].map(m => [m[1], Number(m[2]), m[3]])
    expect(sql.length).toBeGreaterThan(10)
    expect(UM_LISTA).toEqual(sql)
    // normalizarea de dinaintea listei: majuscule, fără spații POSIX și fără puncte
    expect(corp).toContain("upper(regexp_replace(coalesce(p_um, ''), '[[:space:].]', '', 'g'))")
    expect(corp).toContain('coalesce(l.b, n.u), coalesce(l.m, 1)::numeric')
  })
  it('normalizeUm se comportă ca fn_rest_decontat_um pe exemplele din plan', () => {
    expect(normalizeUm('100 MC')).toEqual({ um: 'MC', factor: 100 })
    expect(normalizeUm('100 M.C.')).toEqual({ um: 'MC', factor: 100 })
    expect(normalizeUm('HM')).toEqual({ um: 'M', factor: 100 })
    expect(normalizeUm(' ml ')).toEqual({ um: 'M', factor: 1 })
    expect(normalizeUm('m')).toEqual({ um: 'M', factor: 1 })
    expect(normalizeUm('to')).toEqual({ um: 'KG', factor: 1000 })
    expect(normalizeUm('ORA')).toEqual({ um: 'ORA', factor: 1 }) // necunoscut = el însuși, factor 1
    expect(normalizeUm(null)).toEqual({ um: '', factor: 1 })
    const nbsp = String.fromCharCode(160)
    expect(umCanonic(`100${nbsp}MC`)).toBe(`100${nbsp}MC`) // NBSP nu e [[:space:]] în SQL → nici aici
    expect(acelasiUm('HM', 'ml')).toBe(true)
    expect(acelasiUm('MC', 'M')).toBe(false)
    expect(acelasiUm('', '')).toBe(false)
  })
  it('cheieClient = fn_rest_decontat_cheie (text SQL verificat + exemple)', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_cheie('), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_rest_decontat_cheie('))
    for (const p of ['p_obiect', 'p_deviz', 'p_cod']) expect(corp).toContain(`upper(btrim(regexp_replace(coalesce(${p}, ''), '[[:space:]]+', ' ', 'g')))`)
    expect(corp).toContain("CASE WHEN p_nr IS NULL THEN '' ELSE '|#' || upper(btrim(regexp_replace(p_nr, '[[:space:]]+', ' ', 'g'))) END")
    expect(cheieClient('01', '0101', ' tsa01a1 ', null)).toBe('01|0101|TSA01A1')
    expect(cheieClient('01', '0101', 'tsa01a1', '2')).toBe('01|0101|TSA01A1|#2')
    expect(cheieClient(' 01\t', 'deviz  oferta\n1', 'cod', undefined)).toBe('01|DEVIZ OFERTA 1|COD')
    expect(cheieClient(null, null, null, null)).toBe('||')
    expect(cheieClient('a', 'b', 'c', '')).toBe('A|B|C|#')
  })
  it('câmpurile liniei spre RPC = lista acceptată de fn_rest_decontat_confirma_situatie (fără cheie / potrivire, puse de ecran)', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_confirma_situatie('))
    // al doilea `k NOT IN (...)` din RPC = cheile unei LINII (primul e al obiectului {linii, accept_diferenta, luna, an})
    const m = [...corp.matchAll(/k NOT IN \(([^)]+)\)/g)].find(x => x[1].includes("'obiect_cod'"))
    expect(m).toBeTruthy()
    const sql = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
    expect(sql).toEqual([...CAMPURI_LINIE_RPC, 'cheie', 'potrivire'].sort())
  })
})

describe('clasificarea coloanelor din antet', () => {
  it('cuvinte-cheie normalizate (diacritice, puncte, majuscule, spații, ordine)', () => {
    expect(clasificaColoana('Nr. crt.')).toBe('nr')
    expect(clasificaColoana('Simbol')).toBe('cod')
    expect(clasificaColoana('COD ARTICOL')).toBe('cod')
    expect(clasificaColoana('Denumirea lucrării')).toBe('denumire')
    expect(clasificaColoana('Descriere')).toBe('denumire')
    expect(clasificaColoana('U.M.')).toBe('um')
    expect(clasificaColoana('UM')).toBe('um')
    expect(clasificaColoana('Unitate de măsură')).toBe('um')
    expect(clasificaColoana('Cantitate realizată în perioadă')).toBe('cantitate_perioada')
    expect(clasificaColoana('Cantitate\nluna curentă')).toBe('cantitate_perioada')
    expect(clasificaColoana('CANTITATE   EXECUTATĂ')).toBe('cantitate_perioada')
    expect(clasificaColoana('Cantitate cumulată')).toBe('cantitate_cumulat')
    expect(clasificaColoana('Cantitate realizată cumulat')).toBe('cantitate_cumulat') // cumulat bate „realizată”
    expect(clasificaColoana('Cantitate contractată')).toBe('cantitate_contract')
    expect(clasificaColoana('Cantitate')).toBe('cantitate')
    expect(clasificaColoana('Preț unitar (lei)')).toBe('pret_unitar')
    expect(clasificaColoana('P.U.')).toBe('pret_unitar')
    expect(clasificaColoana('Valoare în perioadă')).toBe('valoare')
    expect(clasificaColoana('Valoare (cantitate × preț)')).toBe('valoare') // valoare înaintea prețului / cantității
    expect(clasificaColoana('Valoare cumulată')).toBe('valoare_cumulat')
    expect(clasificaColoana('Valoare contract')).toBe('valoare_contract')
    expect(clasificaColoana('')).toBeNull()
    expect(clasificaColoana('Observații')).toBeNull()
  })
  it('recunoasteAntet: bloc pe două rânduri cu celule unite, rând de indici sub antet, titluri deasupra', () => {
    const a = recunoasteAntet([...TITLU, ANTET_A, ANTET_B, INDEX, ...DATE_A], MERGES_A)
    expect(a.ok).toBe(true)
    expect([a.inceput, a.sfarsit, a.primulRandDate]).toEqual([4, 5, 7])
    expect(a.coloane).toEqual(COLOANE_A)
  })
  it('recunoasteAntet: titlul „Situație de lucrări nr. 7 / …” LIPIT de antet (fără rând gol) rămâne titlu, nu grup de antet', () => {
    const a = recunoasteAntet([['Situație de lucrări nr. 7 / octombrie 2026'], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 1, 3, 3]])
    expect(a.ok).toBe(true)
    expect([a.inceput, a.sfarsit, a.primulRandDate]).toEqual([1, 1, 2])
    expect(a.coloane.denumire).toBe(2)
    // un grup de antet adevărat deasupra frunzei rămâne grup
    const g = recunoasteAntet([['', '', '', '', 'Cantitate', '', '', 'Valoare'], ['Nr', 'Cod', 'Denumire', 'UM', 'contract', 'în perioadă', 'Preț unitar', 'în perioadă'], [1, 'A1', 'x', 'm', 1, 1, 3, 3]])
    expect(g.ok).toBe(true)
    expect([g.inceput, g.sfarsit]).toEqual([0, 1])
    expect(g.coloane).toMatchObject({ cantitate_perioada: 5, pret_unitar: 6, valoare: 7 })
  })
  it('recunoasteAntet: aceleași două rânduri FĂRĂ `!merges` (celule goale la dreapta grupului) → aceleași coloane', () => {
    const a = recunoasteAntet([...TITLU, ANTET_A, ANTET_B, INDEX, ...DATE_A], [])
    expect(a.ok).toBe(true)
    expect(a.coloane).toEqual(COLOANE_A)
  })
  it('„Cantitate” simplă e perioada DOAR dacă există și o coloană de cumulat; singură nu ajunge', () => {
    const cu = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulată', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 1, 2, 3, 3]])
    expect(cu.ok).toBe(true)
    expect(cu.coloane.cantitate_perioada).toBe(4)
    const fara = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 1, 3, 3]])
    expect(fara.ok).toBe(false)
    expect(fara.cel_mai_bun.lipsesc).toEqual(['cantitate_perioada'])
  })
  it('două coloane „cantitate în perioadă” = ambiguu, nu alegem una', () => {
    const a = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate realizată', 'Cantitate în perioadă', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 1, 2, 3, 3]])
    expect(a.ok).toBe(false)
    expect(a.cel_mai_bun.ambigue).toEqual(['cantitate_perioada'])
  })
  it('antetul documentului din titluri: nr. situație, luna, anul; lipsă = null', () => {
    expect(antetDinTitluri(['SITUAȚIE DE LUCRĂRI NR. 7', 'Luna: Octombrie 2026'])).toEqual({ nr_situatie: '7', luna: 10, an: 2026 })
    expect(antetDinTitluri(['Situația de plată nr. 12 / noiembrie 2026'])).toEqual({ nr_situatie: '12', luna: 11, an: 2026 })
    expect(antetDinTitluri(['Situatie de lucrari 3', 'perioada 01.09-30.09.2026'])).toEqual({ nr_situatie: '3', luna: null, an: 2026 })
    expect(antetDinTitluri(['Beneficiar: X'])).toEqual({ nr_situatie: null, luna: null, an: null })
  })
  it('tipRand: OS / diverse / articol', () => {
    expect(tipRand('Organizare de șantier', '')).toBe('os')
    expect(tipRand('Organizare șantier', '')).toBe('os')
    expect(tipRand('', 'OS')).toBe('os')
    expect(tipRand('Diverse și neprevăzute', '')).toBe('diverse')
    expect(tipRand('Cheltuieli neprevăzute', '')).toBe('diverse')
    expect(tipRand('Săpătură manuală', 'TSA01A1')).toBe('articol')
    expect(tipRand('Montaj oși de rezervă', 'OSX1')).toBe('articol') // „os” doar ca token întreg
  })
})

describe('parseSituatieExcel — modelul Transgaz (fixture sintetic A)', () => {
  it('liniile, secțiunile, semnul negativ, cumulatul, OS / diverse, codul repetat NU se contopește, totalul = suma valorilor', async () => {
    const r = await parseSituatieExcel(fixtureA())
    expect(r.antet).toEqual({ nr_situatie: '7', luna: 10, an: 2026 })
    expect(r.foi).toEqual(['Situatie'])
    expect(r.coloane.Situatie).toEqual(COLOANE_A)
    expect(r.linii).toHaveLength(9)
    expect(r.linii.map(l => l.tip_rand)).toEqual(['articol', 'articol', 'articol', 'articol', 'articol', 'articol', 'articol', 'os', 'diverse'])
    expect(r.linii.map(l => l.obiect_cod)).toEqual(['01', '01', '01', '02', '02', '03', '03', '03', '03'])
    expect(r.linii.map(l => l.deviz_cod)).toEqual(['0101', '0101', '0101', '0201', '0201', '0301', '0301', '0301', '0301'])
    expect(r.linii[0]).toMatchObject({ nr: '1', cod: 'TSA01A1', denumire: 'Săpătură manuală', um: 'MC', cantitate_perioada: 20, cantitate_cumulat_doc: 60, pret_unitar: 10, valoare: 200, obiect_nume: 'Tronson A', deviz_nume: 'Conductă', foaie: 'Situatie', rand: 10 })
    // regularizare: cantitatea și valoarea negative rămân negative
    expect(r.linii[2]).toMatchObject({ cod: 'RPCU01', cantitate_perioada: -5, valoare: -250, cantitate_cumulat_doc: 95 })
    expect(r.linii.filter(l => l.cantitate_perioada < 0)).toHaveLength(1)
    // același cod de două ori în același deviz: două linii distincte, cu poziții diferite
    const rep = r.linii.filter(l => l.obiect_cod === '02' && l.cod === 'TSA01A1')
    expect(rep.map(l => [l.nr, l.cantitate_perioada, l.valoare])).toEqual([['1', 5, 55], ['2', 2, 22]])
    // UM-ul rămâne brut (conversia o face potrivirea / BD-ul)
    expect(r.linii[5]).toMatchObject({ cod: 'IZF01', um: '100 MP', cantitate_perioada: 0.5 })
    expect(r.linii[6]).toMatchObject({ cod: '', denumire: 'Proba de presiune a conductei', um: 'buc' })
    expect(r.linii[7]).toMatchObject({ tip_rand: 'os', cod: 'OS', cantitate_perioada: null, valoare: 150 })
    expect(r.linii[8]).toMatchObject({ tip_rand: 'diverse', cantitate_perioada: 1, valoare: 40 })
    // totalul = suma valorilor liniilor (200 + 120 − 250 + 55 + 22 + 500 + 300 + 150 + 40), nu totalul tipărit
    expect(r.total).toBe(1137)
    expect(r.total_doc).toBe(1137)
    expect(r.diferenta_total).toBe(0)
    // nimic nu dispare tăcit (L12): rândul fără mișcare e numărat, OS fără cantitate e avertisment, nimic ignorat / problemă
    expect(r.fara_miscare).toBe(1)
    expect(r.ignorate).toEqual([])
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.foi_nerecunoscute).toEqual([])
    expect(r.foi_fara_tabel).toEqual([])
    expect(r.avertismente.map(a => a.motiv)).toEqual(['rând os fără cantitate (valoare forfetară)'])
    expect(r.sectiuni.map(s => [s.tip, s.cod, s.nume])).toEqual([['obiect', '01', 'Tronson A'], ['deviz', '0101', 'Conductă'], ['obiect', '02', 'Tronson B'], ['deviz', '0201', 'Conductă B'], ['obiect', '03', 'Stație'], ['deviz', '0301', 'Izolații']])
    for (const l of r.linii) for (const k of CAMPURI_LINIE_RPC) expect(l).toHaveProperty(k)
  })
  it('coloane în altă ordine, antet pe un rând cu fraze lungi, fără merges, totalul tipărit greșit, rânduri cu probleme', async () => {
    const rows = [
      ['Situația de plată nr. 12 / noiembrie 2026'],
      ['Denumirea lucrării', 'Cod', 'Valoare realizată în luna curentă (lei)', 'Cantitate realizată în luna curentă', 'U.M.', 'Preț unitar (lei)', 'Cantitate cumulată', 'Nr.'],
      ['Săpătură mecanică', 'TSA02', 300, 30, 'mc', 10, 30, 1],
      ['Text explicativ fără cifre'],
      ['Sudură', 'SUD1', 'abc', 2, 'buc', 50, 2, 2], // valoare ne-număr → problemă, nu 0
      ['', '', 99, 1, 'buc', 99, 1, 3], // cifre fără denumire și cod → problemă
      ['Fără UM', 'FUM1', 10, 1, '', 10, 1, 4], // UM lipsă → problemă
      ['Valoare fără cantitate', 'VFC1', 10, '', 'buc', 10, 1, 5], // articol cu valoare dar fără cantitate → problemă
      ['Valoare nepotrivită', 'VNP1', 100, 2, 'buc', 10, 2, 6], // 2 × 10 ≠ 100 → avertisment, linia rămâne
      ['TOTAL', '', 999, '', '', '', '', ''],
    ]
    const r = await parseSituatieExcel(xlsx([{ nume: 'SL12', rows }]))
    expect(r.antet).toEqual({ nr_situatie: '12', luna: 11, an: 2026 })
    expect(r.coloane.SL12).toEqual({ nr: 7, cod: 1, denumire: 0, um: 4, pret_unitar: 5, cantitate_perioada: 3, cantitate_cumulat: 6, valoare: 2 })
    expect(r.linii.map(l => [l.nr, l.cod, l.cantitate_perioada, l.valoare])).toEqual([['1', 'TSA02', 30, 300], ['6', 'VNP1', 2, 100]])
    expect(r.linii.every(l => l.obiect_cod === '' && l.deviz_cod === '')).toBe(true) // fără secțiuni: obiectul rămâne gol, nu ghicit
    expect(r.total).toBe(400)
    expect(r.total_doc).toBe(999)
    expect(r.diferenta_total).toBe(-599)
    expect(r.ignorate.map(i => i.text)).toEqual(['Text explicativ fără cifre'])
    expect(r.probleme.map(p => p.motiv)).toEqual([
      'număr neinterpretabil: valoare', 'rând cu cifre, fără denumire și fără cod', 'UM lipsă', 'cantitate în perioadă lipsă (valoare fără cantitate)',
    ])
    expect(r.complet).toBe(false) // rânduri cu cifre care n-au devenit linii = rezultat incomplet (L12)
    expect(r.avertismente.map(a => a.motiv)).toEqual(['valoare ≠ cantitate × preț unitar'])
    expect(r.avertismente[0]).toMatchObject({ rand: 9, calculat: 20, valoare: 100 })
  })
  it('numere ca text RO / EN (helperul existent parseNumar), cu semn; „2.000” singur e ambiguu (2 sau 2000?) → problemă, nu ghicire', async () => {
    const rows = [
      ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Cantitate cumulată', 'Preț unitar', 'Valoare'],
      [1, 'A1', 'Unu', 'm', '1.234,5', '2.000,000', '2,00', '2.469,00'],
      [2, 'A2', 'Doi', 'm', '-12.5', '100', '4', '-50.00'],
      [3, 'A3', 'Trei', 'm', '2.000', '2.000', '1', '2000'],
      [4, 'A4', 'Patru', 'm', '1', '', '12,345', '12,345'],
    ]
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows }]))
    expect(r.linii.map(l => [l.cod, l.cantitate_perioada, l.cantitate_cumulat_doc, l.pret_unitar, l.valoare])).toEqual([['A1', 1234.5, 2000, 2, 2469], ['A2', -12.5, 100, 4, -50]])
    expect(r.total).toBe(2419)
    expect(r.probleme.map(p => [p.cod, p.motiv])).toEqual([
      ['A3', 'număr ambiguu (mii sau zecimale?): cantitate_perioada „2.000”, cantitate_cumulat_doc „2.000”'],
      ['A4', 'număr ambiguu (mii sau zecimale?): pret_unitar „12,345”, valoare „12,345”'],
    ])
  })
  it('mai multe foi cu antet (o foaie pe obiect) se citesc toate, cu avertisment; foile fără antet se sar', async () => {
    const foaie = (nume, ob, cod, v) => ({ nume, rows: [['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare'], [`Obiectul: ${ob} X`], [1, cod, 'Lucrare', 'm', 1, v, v], ['TOTAL', '', '', '', '', '', v]] })
    const r = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: [['Situație nr. 2'], ['fără tabel']] }, foaie('Ob1', '01', 'A1', 10), foaie('Ob2', '02', 'A2', 20)]))
    expect(r.foi).toEqual(['Ob1', 'Ob2'])
    expect(r.linii.map(l => [l.obiect_cod, l.cod, l.valoare])).toEqual([['01', 'A1', 10], ['02', 'A2', 20]])
    expect(r.total).toBe(30)
    expect(r.total_doc).toBe(30)
    expect(r.linii[0].cantitate_cumulat_doc).toBeNull() // coloana de cumulat lipsește → null, nu 0
    expect(r.avertismente.map(a => a.motiv)).toEqual([expect.stringMatching(/^2 foi cu antet recunoscut \(Ob1, Ob2\)/)])
    // coperta (titluri, fără tabel) = excepția legitimă: nu e problemă, rezultatul rămâne complet
    expect(r.foi_fara_tabel).toEqual(['Coperta'])
    expect(r.foi_nerecunoscute).toEqual([])
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
  })
})

// ── review #1165 r1 P1 (L12, L18): o foaie de DETALIU nerecunoscută lângă o foaie validă nu dispare tăcut ──
describe('parseSituatieExcel — foaie de detaliu nerecunoscută lângă una validă (review #1165 r1 P1)', () => {
  const ANTET_OK = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare']
  const valida = { nume: 'Valid', rows: [ANTET_OK, ['Obiectul: 01 A'], [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], ['TOTAL', '', '', '', '', '', 20]] }
  // reproducerea review-ului: aceeași structură, dar „Cantitate” fără calificativ (și fără cumulat) → antetul nu e recunoscut
  const detaliu = { nume: 'Detaliu', rows: [['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Preț unitar', 'Valoare'], ['Obiectul: 02 B'], [1, 'B1', 'Lucrare B', 'm', 3, 10, 30], ['TOTAL', '', '', '', '', '', 30]] }
  it('reproducere: foaie validă (20) + foaie de detaliu cu „Cantitate” fără calificativ (30) → problemă, complet = false, totalul 20 declarat parțial', async () => {
    const r = await parseSituatieExcel(xlsx([valida, detaliu]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.total).toBe(20)
    expect(r.linii.map(l => l.cod)).toEqual(['A1'])
    expect(r.complet).toBe(false)
    expect(r.foi_nerecunoscute).toEqual([{ foaie: 'Detaliu', rand: 1, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'valoare'], lipsesc: ['cantitate_perioada'], ambigue: [] }])
    expect(r.foi_fara_tabel).toEqual([])
    expect(r.probleme).toHaveLength(1)
    expect(r.probleme[0]).toMatchObject({ foaie: 'Detaliu', rand: 1 })
    expect(r.probleme[0].motiv).toMatch(/^foaie de detaliu nerecunoscută — are tabel de articole, dar nu modelul Transgaz; liniile ei LIPSESC din rezultat \(foaia „Detaliu”, rândul 1: găsite \[nr, cod, denumire, um, pret_unitar, valoare\], lipsesc \[cantitate_perioada\]\)$/)
    // ordinea foilor nu schimbă verdictul
    const r2 = await parseSituatieExcel(xlsx([detaliu, valida]))
    expect(r2.foi).toEqual(['Valid'])
    expect(r2.complet).toBe(false)
    expect(r2.probleme.map(p => p.foaie)).toEqual(['Detaliu'])
  })
  it('tabel cu doar două familii de coloane (ex. centralizator Denumire / Valoare cu cifre) = tot foaie de detaliu nerecunoscută', async () => {
    const centralizator = { nume: 'Centralizator', rows: [['Situație nr. 7'], ['Denumire obiect', 'Valoare'], ['Tronson A', 20], ['Tronson B', 30], ['TOTAL', 50]] }
    const r = await parseSituatieExcel(xlsx([valida, centralizator]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.complet).toBe(false)
    expect(r.foi_nerecunoscute).toEqual([{ foaie: 'Centralizator', rand: 2, gasite: ['denumire', 'valoare'], lipsesc: ['um', 'cantitate_perioada', 'pret_unitar'], ambigue: [] }])
    expect(r.probleme.map(p => [p.foaie, p.rand])).toEqual([['Centralizator', 2]])
  })
  it('excepția distinctă: coperta fără tabel (titluri; o etichetă cu o cifră; o foaie goală) nu e problemă', async () => {
    const coperta = { nume: 'Coperta', rows: [['Situație de lucrări nr. 7'], ['Luna: octombrie 2026'], ['Valoare totală (lei)', 20], ['Beneficiar: (sintetic)']] }
    const goala = { nume: 'Goala', rows: [[]] }
    const r = await parseSituatieExcel(xlsx([coperta, valida, goala]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.foi_fara_tabel).toEqual(['Coperta', 'Goala'])
    expect(r.foi_nerecunoscute).toEqual([])
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.antet).toEqual({ nr_situatie: null, luna: null, an: null }) // titlurile copertei nu sunt ale foii citite: nu se ghicesc
  })
  it('recunoasteAntet.tabel: ≥ 2 familii de tabel + un rând cu cifre dedesubt; „nr” singur sau fără cifre = fără tabel', () => {
    expect(recunoasteAntet([['Denumire', 'Valoare'], ['x', 1]]).tabel).toEqual({ rand: 1, gasite: ['denumire', 'valoare'] })
    expect(recunoasteAntet([['Denumire', 'Valoare'], ['fără', 'cifre']]).tabel).toBeNull()
    expect(recunoasteAntet([['Nr. crt.', 'Valoare'], [1, 2]]).tabel).toBeNull() // nr + o singură familie de tabel
    expect(recunoasteAntet([['Valoare contract', 'Valoare cumulat'], [1, 2]]).tabel).toBeNull() // aceeași familie (valoare) de două ori
    expect(recunoasteAntet([['Situație nr. 7'], ['Valoare totală', 20]]).tabel).toBeNull()
  })
  it('antetul documentului din mai multe foi: valorile diferite nu se aleg (null + avertisment); valorile egale sau unice se iau', async () => {
    const foaie = (nume, titlu, cod, v) => ({ nume, rows: [[titlu], ANTET_OK, [1, cod, 'Lucrare', 'm', 1, v, v]] })
    const r = await parseSituatieExcel(xlsx([foaie('F1', 'Situație de lucrări nr. 7 / octombrie 2026', 'A1', 10), foaie('F2', 'Situație de lucrări nr. 8 / 2026', 'A2', 20)]))
    expect(r.antet).toEqual({ nr_situatie: null, luna: 10, an: 2026 })
    expect(r.avertismente.map(a => a.motiv)).toContain('foile dau valori diferite pentru nr_situatie (F1: 7; F2: 8) — câmpul rămâne de completat de om')
    expect(antetDinFoi([{ foaie: 'a', antet: { nr_situatie: '7', luna: 10, an: 2026 } }, { foaie: 'b', antet: { nr_situatie: '7', luna: null, an: 2026 } }]))
      .toEqual({ antet: { nr_situatie: '7', luna: 10, an: 2026 }, conflicte: [] })
    expect(antetDinFoi([]).antet).toEqual({ nr_situatie: null, luna: null, an: null })
  })
})

describe('parseSituatieExcel — refuzuri clare (L12 / L18: eroare, nu linii goale)', () => {
  it('alt format (fără UM și fără cantitate în perioadă) → „format nerecunoscut” cu ce s-a găsit și ce lipsește', async () => {
    const buf = xlsx([{ nume: 'Primarie', rows: [['Nr', 'Denumire', 'Cantitate', 'Preț'], [1, 'Lucrare', 10, 5]] }])
    await expect(parseSituatieExcel(buf)).rejects.toThrow(/^format nerecunoscut:.*foaia „Primarie”, rândul 1: găsite \[nr, denumire, pret_unitar\], lipsesc \[um, cantitate_perioada, valoare\]/)
  })
  it('registru fără niciun rând de antet → format nerecunoscut (fără candidat)', async () => {
    await expect(parseSituatieExcel(xlsx([{ nume: 'Gol', rows: [['doar', 'text'], ['fără', 'antet']] }]))).rejects.toThrow(/format nerecunoscut:.*Nicio foaie nu are un rând de antet/)
  })
  it('antet recunoscut dar nicio linie de articol → eroare, nu rezultat gol', async () => {
    const buf = xlsx([{ nume: 'S', rows: [['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare'], [1, 'A1', 'Nimic în luna asta', 'm', '', 5, ''], ['TOTAL', '', '', '', '', '', 0]] }])
    await expect(parseSituatieExcel(buf)).rejects.toThrow(/nu are nicio linie de articol .*fără mișcare: 1, probleme: 0/)
  })
  it('obligatoriile declarate = cele cerute de plan', () => {
    expect(COLOANE_OBLIGATORII).toEqual(['denumire', 'um', 'cantitate_perioada', 'pret_unitar', 'valoare'])
  })
})

// ── devizul unui act adițional / NR / NCS: .docx sintetic în stilul F3 (paragrafe), prin parseDeviz ──
async function docx(paragrafe) {
  const zip = new JSZip()
  const body = paragrafe.map(p => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return { name: 'aa.docx', arrayBuffer: async () => buf }
}
const F3 = [
  'Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA',
  '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', 'Total= 100.00',
  '002 TSD01B1 MC -5.000', 'UMPLUTURA COMPACTATA', 'Total= -40.00',
  '003 RPCU01 HM 2.500', 'MONTAJ TEAVA', 'Total= 1250.00',
]

describe('parseDevizModificare (AA / NR / NCS) — refolosește parseDeviz și păstrează semnul', () => {
  it('cantitățile negative rămân negative; conversia UM a catalogului (HM → m × 100) rămâne cea existentă', async () => {
    const r = await parseDevizModificare(await docx(F3))
    expect(r.linii.map(l => [l.cod, l.um, l.cantitate, l.valoare])).toEqual([['TSA01A1', 'mc', 10, 100], ['TSD01B1', 'mc', -5, -40], ['RPCU01', 'm', 250, 1250]])
    expect(r.linii[0]).toMatchObject({ obiect_cod: '01', deviz_cod: '0101', nr: '001', denumire: 'SAPATURA MANUALA' })
    expect(r.negative).toBe(1)
    expect(r.probleme).toEqual([])
  })
  it('un deviz fără articole = eroare, nu listă goală', async () => {
    await expect(parseDevizModificare(await docx(['Obiectul: 01 1 X', 'niciun articol']))).rejects.toThrow(/format nerecunoscut: niciun articol de deviz în „aa.docx”/)
  })
  it('și din Excel (parseDevizExcel), cu semn', async () => {
    const buf = xlsx([{ nume: 'Deviz AA', rows: [['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate'], [1, 'TSA01A1', 'Săpătură', 'mc', -3], [2, 'TSD01B1', 'Umplutură', 'mc', 7]] }])
    const r = await parseDevizModificare({ name: 'aa.xlsx', arrayBuffer: async () => buf })
    expect(r.linii.map(l => [l.cod, l.cantitate])).toEqual([['TSA01A1', -3], ['TSD01B1', 7]])
    expect(r.negative).toBe(1)
  })
})

// ── review #1165 r1 P1: semnul DOAR sub opțiune explicită; parseDeviz implicit = comportamentul istoric al catalogului ──
// Devizul AA mixt (+10 / +100 și −5 / −50), ca în reproducerea review-ului. Așteptările pentru calea implicită sunt scrise de mână după
// regula veche (regexul fără „-”: linia „MC -5.000” nu e articol → se sare; „Total= -50.00” nu e total), nu citite din cod (L25).
const AA_MIXT = [
  'Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA',
  '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', 'Total= 100.00',
  '002 TSD01B1 MC -5.000', 'UMPLUTURA COMPACTATA', 'Total= -50.00',
]
describe('parseDeviz implicit (catalog) vs { cuSemn: true } (Rest de decontat) pe același .docx AA mixt', () => {
  it('(a) parseDeviz(file) FĂRĂ opțiune = ca pe main: linia negativă e sărită, rămâne doar +10 / +100', async () => {
    const arts = await parseDeviz(await docx(AA_MIXT))
    expect(arts.map(a => [a.cod, a.cantitate, a.valoare])).toEqual([['TSA01A1', 10, 100]])
    expect(arts[0]).toMatchObject({ obiect_cod: '01', deviz_cod: '0101', nr: '001', um: 'mc', denumire: 'SAPATURA MANUALA' })
    expect(arts.reduce((s, a) => s + a.valoare, 0)).toBe(100) // totalul importului ofertei: neschimbat față de main
  })
  it('(c) parseDevizModificare pe ACELAȘI fișier păstrează −5 / −50', async () => {
    const r = await parseDevizModificare(await docx(AA_MIXT))
    expect(r.linii.map(l => [l.cod, l.cantitate, l.valoare])).toEqual([['TSA01A1', 10, 100], ['TSD01B1', -5, -50]])
    expect(r.negative).toBe(1)
  })
  it('articoleDinParagrafe: implicit fără semn; cu { cuSemn: true } cu semn; { cuSemn: false } explicit = implicit', () => {
    const paras = AA_MIXT
    expect(articoleDinParagrafe(paras).map(a => a.cantitate)).toEqual([10])
    expect(articoleDinParagrafe(paras, {}).map(a => a.cantitate)).toEqual([10])
    expect(articoleDinParagrafe(paras, { cuSemn: false }).map(a => a.cantitate)).toEqual([10])
    expect(articoleDinParagrafe(paras, { cuSemn: true }).map(a => [a.cantitate, a.valoare])).toEqual([[10, 100], [-5, -50]])
    // un deviz F3 obișnuit (toate pozitive) dă același lucru pe ambele căi
    expect(articoleDinParagrafe(F3.slice(0, 5), { cuSemn: true })).toEqual(articoleDinParagrafe(F3.slice(0, 5)))
  })
  it('parseDeviz cu { cuSemn: true } (ce apelează parseDevizModificare) întoarce ambele articole', async () => {
    const arts = await parseDeviz(await docx(AA_MIXT), { cuSemn: true })
    expect(arts.map(a => [a.cod, a.cantitate, a.valoare])).toEqual([['TSA01A1', 10, 100], ['TSD01B1', -5, -50]])
  })
})
