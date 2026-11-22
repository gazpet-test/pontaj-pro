// Teste pentru parsarea situației de lucrări detaliate (modelul Transgaz) — fixture-uri SINTETICE (coduri / denumiri inventate,
// fără proiecte, prețuri sau nume reale). Paritatea UM / cheie cu migrarea 20270105a se verifică pe textul migrării (L19).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { parseSituatieExcel, parseDevizModificare, recunoasteAntet, randCandidat, clasificaColoana, antetDinTitluri, antetDinFoi, tipRand, CAMPURI_LINIE_RPC, COLOANE_OBLIGATORII } from './parsareSituatie.js'
import { UM_LISTA, normalizeUm, acelasiUm, umCanonic, eUmCunoscut } from './um.js'
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
    // eUmCunoscut = apartenența la aceeași listă (după aceeași normalizare)
    for (const [u] of UM_LISTA) expect(eUmCunoscut(u.toLowerCase())).toBe(true)
    expect(eUmCunoscut(' m.c. ')).toBe(true)
    expect(eUmCunoscut('lei')).toBe(false)
    expect(eUmCunoscut('ORA')).toBe(false)
    expect(eUmCunoscut('')).toBe(false)
    expect(eUmCunoscut(null)).toBe(false)
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
      // r7: totalul tipărit (999) ≠ suma liniilor citite (400) — reconcilierea o spune cu diferența, nu doar `diferenta_total`
      'totalul de control 999 lei („TOTAL”, foaia „SL12”, rândul 10) ≠ suma foii 400 lei (diferență 599 lei) și suma documentului 400 lei (diferență 599 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.02 lei',
    ])
    expect(r.reconciliere.ok).toBe(false)
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
      ['TOTAL', '', '', '', '', '', '', '2.419,00'], // totalul de control ca text RO (numar)
    ]
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows }]))
    expect(r.linii.map(l => [l.cod, l.cantitate_perioada, l.cantitate_cumulat_doc, l.pret_unitar, l.valoare])).toEqual([['A1', 1234.5, 2000, 2, 2469], ['A2', -12.5, 100, 4, -50]])
    expect(r.total).toBe(2419)
    expect(r.total_doc).toBe(2419)
    expect(r.reconciliere.ok).toBe(true)
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
    expect(r.foi_nerecunoscute).toEqual([{ foaie: 'Detaliu', rand: 1, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'valoare'], lipsesc: ['cantitate_perioada'], ambigue: [], neconsumate: [] }])
    expect(r.foi_fara_tabel).toEqual([])
    // problema de FOAIE (de ce) + câte un rând pentru fiecare rând candidat al ei (invariantul: rândul 3, B1) + reconcilierea (r7): rândul 4,
    // „TOTAL | 30”, e totalul de control al foii sărite (clasa total, nu candidat) și NU se potrivește cu suma citită (20) → omul vede că lipsesc 30 lei
    expect(r.probleme).toHaveLength(3)
    expect(r.probleme[0]).toMatchObject({ foaie: 'Detaliu', rand: 1 })
    expect(r.probleme[0].motiv).toMatch(/^foaie de detaliu nerecunoscută — are tabel de articole, dar nu modelul Transgaz; liniile ei LIPSESC din rezultat \(foaia „Detaliu”, rândul 1: găsite \[nr, cod, denumire, um, pret_unitar, valoare\], lipsesc \[cantitate_perioada\]\)$/)
    expect(r.probleme[1]).toMatchObject({ foaie: 'Detaliu', rand: 3, clasa: 'ignorat', candidat: 'cod „B1”, UM „m”, 4 numere' })
    expect(r.probleme[2]).toMatchObject({ foaie: 'Detaliu', rand: 4, diferenta: 10 })
    expect(r.probleme[2].motiv).toBe('totalul de control 30 lei („TOTAL”, foaia „Detaliu”, rândul 4) ≠ suma articolelor citite 20 lei (diferență 10 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.01 lei')
    expect(r.contabilizare).toEqual({ Valid: { antet: 1, sectiune: 1, articol: 1, total: 1 }, Detaliu: { ignorat: 3, total: 1 } })
    expect(r.reconciliere.controale.map(c => [c.foaie, c.sursa, c.valoare, c.scop])).toEqual([['Valid', 'detaliu', 20, 'foaie'], ['Detaliu', 'recapitulatie', 30, null]])
    // ordinea foilor nu schimbă verdictul
    const r2 = await parseSituatieExcel(xlsx([detaliu, valida]))
    expect(r2.foi).toEqual(['Valid'])
    expect(r2.complet).toBe(false)
    expect(r2.probleme.map(p => [p.foaie, p.rand])).toEqual([['Detaliu', 1], ['Detaliu', 3], ['Detaliu', 4]])
  })
  it('tabel cu doar două familii de coloane (ex. centralizator Denumire / Valoare cu cifre) = tot foaie de detaliu nerecunoscută', async () => {
    const centralizator = { nume: 'Centralizator', rows: [['Situație nr. 7'], ['Denumire obiect', 'Valoare'], ['Tronson A', 20], ['Tronson B', 30], ['TOTAL', 50]] }
    const r = await parseSituatieExcel(xlsx([valida, centralizator]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.complet).toBe(false)
    expect(r.foi_nerecunoscute).toEqual([{ foaie: 'Centralizator', rand: 2, gasite: ['denumire', 'valoare'], lipsesc: ['um', 'cantitate_perioada', 'pret_unitar'], ambigue: [], neconsumate: [] }])
    // problema de foaie + fiecare rând cu număr și text al ei („Tronson A | 20” e candidat din r6: un număr + text ajunge) + „TOTAL | 50” =
    // totalul de control al centralizatorului (r7), nepotrivit cu suma citită (20) → problemă de reconciliere pe rândul 5
    expect(r.probleme.map(p => [p.foaie, p.rand])).toEqual([['Centralizator', 2], ['Centralizator', 3], ['Centralizator', 4], ['Centralizator', 5]])
    expect(r.probleme[3].motiv).toMatch(/^totalul de control 50 lei \(„TOTAL”, foaia „Centralizator”, rândul 5\) ≠ suma articolelor citite 20 lei \(diferență 30 lei\)/)
    expect(r.contabilizare.Centralizator).toEqual({ meta_document: 1, ignorat: 3, total: 1 }) // „Situație nr. 7” = antetul documentului
  })
  it('excepția distinctă: coperta fără tabel (antetul documentului — meta_document —, titluri, o foaie goală) nu e problemă', async () => {
    const coperta = { nume: 'Coperta', rows: [['Situație de lucrări nr. 7'], ['Luna: octombrie 2026'], ['Pagina', 1, 'din', 2], ['Data:', '15.10.2026'], ['Beneficiar: (sintetic)'], ['Întocmit,', '', 'Verificat,']] }
    const goala = { nume: 'Goala', rows: [[]] }
    const r = await parseSituatieExcel(xlsx([coperta, valida, goala]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.foi_fara_tabel).toEqual(['Coperta', 'Goala'])
    expect(r.foi_nerecunoscute).toEqual([])
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.contabilizare.Coperta).toEqual({ meta_document: 5, titlu: 1 })
    expect(r.antet).toEqual({ nr_situatie: null, luna: null, an: null }) // titlurile copertei nu sunt ale foii citite: nu se ghicesc
    // o RECAPITULAȚIE pe copertă („Valoare totală (lei) | 20”: un număr + text, fără tipar de antet de document) e candidat → foaia e raportată
    // (fals pozitiv acceptat: costă o privire a omului; regula „un număr + text” nu face excepții în afara listei albe)
    const recap = { nume: 'Recap', rows: [['Situație de lucrări nr. 7'], ['Valoare totală (lei)', 20]] }
    const rr = await parseSituatieExcel(xlsx([recap, valida]))
    expect(rr.foi_fara_tabel).toEqual([])
    expect(rr.foi_nerecunoscute.map(n => [n.foaie, n.rand, n.fara_antet])).toEqual([['Recap', 2, { motiv: '1 număr și text „Valoare totală (lei)”', randuri: 1 }]])
    expect(rr.probleme.map(p => [p.foaie, p.rand])).toEqual([['Recap', 2], ['Recap', 2]])
    expect(rr.complet).toBe(false)
  })
  it('recunoasteAntet.tabel: ≥ 2 familii de tabel + un rând cu cifre dedesubt; „nr” singur sau fără cifre = fără tabel', () => {
    expect(recunoasteAntet([['Denumire', 'Valoare'], ['x', 1]]).tabel).toEqual({ rand: 1, gasite: ['denumire', 'valoare'] })
    expect(recunoasteAntet([['Denumire', 'Valoare'], ['fără', 'cifre']]).tabel).toBeNull()
    expect(recunoasteAntet([['Nr. crt.', 'Valoare'], [1, 2]]).tabel).toBeNull() // nr + o singură familie de tabel
    expect(recunoasteAntet([['Valoare contract', 'Valoare cumulat'], [1, 2]]).tabel).toBeNull() // aceeași familie (valoare) de două ori
    expect(recunoasteAntet([['Situație nr. 7'], ['Valoare totală', 20]]).tabel).toBeNull()
  })
  // ── review #1165 r2 P1 (L12, L18): detecția parcurge ÎNTREAGA foaie, nu o fereastră de 80 de rânduri ──
  // Rândurile introductive au O singură celulă (note înguste): o lățime calculată doar pe primele rânduri ar trunchia antetul de jos.
  const NOTE = n => Array.from({ length: n }, (_, i) => [`Notă introductivă ${i + 1}`])
  it('reproducerea review-ului r2: foaie validă (20) + „Detaliu” cu 81 de rânduri introductive, apoi antet cu „Cantitate” fără calificativ + articol 30 → problemă, complet = false', async () => {
    const detaliuJos = { nume: 'Detaliu', rows: [...NOTE(81), ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Preț unitar', 'Valoare'], [1, 'B1', 'Lucrare B', 'm', 3, 10, 30]] }
    const r = await parseSituatieExcel(xlsx([valida, detaliuJos]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.total).toBe(20)
    expect(r.complet).toBe(false)
    expect(r.foi_fara_tabel).toEqual([]) // NU e copertă: tabelul există, doar că e după rândul 80
    expect(r.foi_nerecunoscute).toEqual([{ foaie: 'Detaliu', rand: 82, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'valoare'], lipsesc: ['cantitate_perioada'], ambigue: [], neconsumate: [] }])
    expect(r.probleme).toHaveLength(2)
    expect(r.probleme[0]).toMatchObject({ foaie: 'Detaliu', rand: 82 })
    expect(r.probleme[0].motiv).toMatch(/^foaie de detaliu nerecunoscută .* \(foaia „Detaliu”, rândul 82: găsite \[nr, cod, denumire, um, pret_unitar, valoare\], lipsesc \[cantitate_perioada\]\)$/)
    expect(r.probleme[1]).toMatchObject({ foaie: 'Detaliu', rand: 83, candidat: 'cod „B1”, UM „m”, 4 numere' }) // articolul 30, cu rândul lui
  })
  it('tabel RECUNOSCUT după rândul 80 (antet la rândul 82) se citește: total 50, complet = true, linia cu rândul ei', async () => {
    const detaliuOk = { nume: 'Detaliu2', rows: [...NOTE(81), ANTET_OK, ['Obiectul: 02 B'], [1, 'B1', 'Lucrare B', 'm', 3, 10, 30], ['TOTAL', '', '', '', '', '', 30]] }
    const r = await parseSituatieExcel(xlsx([valida, detaliuOk]))
    expect(r.foi).toEqual(['Valid', 'Detaliu2'])
    expect(r.linii.map(l => [l.foaie, l.rand, l.obiect_cod, l.cod, l.valoare])).toEqual([['Valid', 3, '01', 'A1', 20], ['Detaliu2', 84, '02', 'B1', 30]])
    expect(r.total).toBe(50)
    expect(r.total_doc).toBe(50)
    expect(r.probleme).toEqual([])
    expect(r.foi_nerecunoscute).toEqual([])
    expect(r.foi_fara_tabel).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.avertismente.map(a => a.motiv)).toEqual([expect.stringMatching(/^2 foi cu antet recunoscut \(Valid, Detaliu2\)/)])
  })
  it('singura foaie, cu antetul la rândul 301 → citită (nu „format nerecunoscut”); centralizatorul cu 2 familii după 100 de rânduri → tot nerecunoscut, nu copertă', async () => {
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [...NOTE(300), ANTET_OK, [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], ['TOTAL', '', '', '', '', '', 20]] }]))
    expect(r.linii.map(l => [l.rand, l.cod, l.valoare])).toEqual([[302, 'A1', 20]])
    expect(r.complet).toBe(true)
    const centralizatorJos = { nume: 'Centralizator', rows: [...NOTE(100), ['Denumire obiect', 'Valoare'], ['Tronson A', 20], ['TOTAL', 20]] }
    const r2 = await parseSituatieExcel(xlsx([valida, centralizatorJos]))
    expect(r2.foi_fara_tabel).toEqual([])
    expect(r2.foi_nerecunoscute).toEqual([{ foaie: 'Centralizator', rand: 101, gasite: ['denumire', 'valoare'], lipsesc: ['um', 'cantitate_perioada', 'pret_unitar'], ambigue: [], neconsumate: [] }])
    expect(r2.complet).toBe(false)
  })
  it('recunoasteAntet pe rânduri brute: antetul după 200 de rânduri înguste e găsit cu toate coloanele (lățimea din toată foaia); tabelul de 2 familii după 150 de rânduri e văzut', () => {
    const a = recunoasteAntet([...NOTE(200), ANTET_OK, [1, 'A1', 'x', 'm', 1, 3, 3]])
    expect(a.ok).toBe(true)
    expect([a.inceput, a.sfarsit, a.primulRandDate]).toEqual([200, 200, 201])
    expect(a.coloane).toEqual({ nr: 0, cod: 1, denumire: 2, um: 3, pret_unitar: 5, cantitate_perioada: 4, cantitate_cumulat: -1, valoare: 6 })
    const t = recunoasteAntet([...NOTE(150), ['Denumire', 'Valoare'], ['x', 1]])
    expect(t.ok).toBe(false)
    expect(t.tabel).toEqual({ rand: 151, gasite: ['denumire', 'valoare'] })
    expect(t.cel_mai_bun).toBeNull()
  })
  // ── review #1165 r3 P1 (L12, L18): o foaie cu RÂNDURI DE ARTICOL dar fără niciun antet nu e copertă ──
  it('randCandidat: cod + UM (cu sau fără numere); orice rând cu ≥ 1 număr și ≥ 1 text (r6); altfel null', () => {
    expect(randCandidat([1, 'B1', 'Lucrare B', 'm', 3, 10, 30])).toBe('cod „B1”, UM „m”, 4 numere')
    expect(randCandidat(['B1', 'Lucrare B', 'm', 30])).toBe('cod „B1”, UM „m”, 1 număr')
    expect(randCandidat(['', 'TSA01A1', 'Săpătură manuală', 'MC', '', 20, '', '', 200, ''])).toBe('cod „TSA01A1”, UM „MC”, 2 numere')
    expect(randCandidat(['Organizare de șantier', 'lei', 150, 300])).toBe('2 numere și text „Organizare de șantier”') // UM necunoscut, fără cod
    expect(randCandidat(['Lucrare fără cod', '12,5', 3, '-2'])).toBe('3 numere și text „Lucrare fără cod”') // numerele ca text contează
    expect(randCandidat(['Valoare totală (lei)', 20])).toBe('1 număr și text „Valoare totală (lei)”') // r6: un număr + text ajunge (recapitulația pe copertă = fals pozitiv acceptat)
    expect(randCandidat(['Lucrare', 'B1', 30])).toBe('cod „B1”, 1 număr și text „Lucrare”') // r5 consacra excluderea — infirmată de review
    // NU sunt candidate: text singur (și cu cifre în text), numere fără text, rândul de indici, rândul gol, antetul documentului
    expect(randCandidat(['Luna: octombrie 2026'])).toBeNull()
    expect(randCandidat(['Data: 15.10.2026'])).toBeNull()
    expect(randCandidat(['Data:', '15.10.2026'])).toBeNull()
    expect(randCandidat([5, 9])).toBeNull()
    expect(randCandidat([0, 1, 2, 3, 4])).toBeNull()
    expect(randCandidat(['', '', ''])).toBeNull()
    expect(randCandidat(null)).toBeNull()
  })
  it('recunoasteAntet.candidat: primul rând candidat (rând de la 1, motiv, câte pe foaie), independent de antet; coperta (antet de document) = null', () => {
    const c = recunoasteAntet([...NOTE(3), ['B1', 'Lucrare B', 'm', 3, 10, 30], ['B2', 'Lucrare C', 'm', 1, 2, 2]])
    expect(c.ok).toBe(false)
    expect(c.tabel).toBeNull()
    expect(c.cel_mai_bun).toBeNull()
    expect(c.candidat).toEqual({ rand: 4, motiv: 'cod „B1”, UM „m”, 3 numere', total: 2 })
    expect(recunoasteAntet([['Situație nr. 7'], ['Pagina', 1, 'din', 3], ['Întocmit,', '', 'Verificat,']]).candidat).toBeNull()
    // recapitulația „Valoare totală | 20” e candidat (r6) — foaia nu mai e copertă
    expect(recunoasteAntet([['Situație nr. 7'], ['Valoare totală', 20], ['Întocmit,', '', 'Verificat,']]).candidat).toEqual({ rand: 2, motiv: '1 număr și text „Valoare totală”', total: 1 })
  })
  it('reproducerea review-ului r3: foaie validă (20) + „Detaliu” cu 81 de note apoi [1, B1, Lucrare B, m, 3, 10, 30] FĂRĂ antet → problemă, complet = false, nu copertă', async () => {
    const detaliuFaraAntet = { nume: 'Detaliu', rows: [...NOTE(81), [1, 'B1', 'Lucrare B', 'm', 3, 10, 30]] }
    const r = await parseSituatieExcel(xlsx([valida, detaliuFaraAntet]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.total).toBe(20)
    expect(r.linii.map(l => l.cod)).toEqual(['A1'])
    expect(r.complet).toBe(false)
    expect(r.foi_fara_tabel).toEqual([])
    expect(r.foi_nerecunoscute).toEqual([{ foaie: 'Detaliu', rand: 82, gasite: [], lipsesc: ['denumire', 'um', 'cantitate_perioada', 'pret_unitar', 'valoare'], ambigue: [], neconsumate: [], fara_antet: { motiv: 'cod „B1”, UM „m”, 4 numere', randuri: 1 } }])
    expect(r.probleme).toHaveLength(2)
    expect(r.probleme[0]).toMatchObject({ foaie: 'Detaliu', rand: 82 })
    expect(r.probleme[0].motiv).toBe('foaie de detaliu nerecunoscută — are rânduri de articol, dar niciun antet de tabel; liniile ei LIPSESC din rezultat (foaia „Detaliu”, rândul 82: rând de articol (cod „B1”, UM „m”, 4 numere) fără niciun antet de tabel recunoscut — 1 rând candidat pe foaie)')
    expect(r.probleme[1]).toEqual({ foaie: 'Detaliu', rand: 82, clasa: 'ignorat', candidat: 'cod „B1”, UM „m”, 4 numere', motiv: 'rând de articol necontabilizat: arată a articol (cod „B1”, UM „m”, 4 numere), dar a fost clasificat „ignorat” (foaie nerecunoscută: rânduri de articol fără niciun antet de tabel) — LIPSEȘTE din rezultat' })
    // ordinea foilor nu schimbă verdictul
    const r2 = await parseSituatieExcel(xlsx([detaliuFaraAntet, valida]))
    expect(r2.complet).toBe(false)
    expect(r2.probleme.map(p => [p.foaie, p.rand])).toEqual([['Detaliu', 82], ['Detaliu', 82]])
  })
  it('fiecare regulă singură ajunge: doar (a) — un singur număr; doar (b) — UM necunoscut, fără cod; mai multe rânduri sunt numărate', async () => {
    const doarA = { nume: 'DoarA', rows: [...NOTE(81), ['B1', 'Lucrare B', 'm', 30]] }
    const ra = await parseSituatieExcel(xlsx([valida, doarA]))
    expect(ra.complet).toBe(false)
    expect(ra.foi_fara_tabel).toEqual([])
    expect(ra.foi_nerecunoscute.map(n => [n.foaie, n.rand, n.fara_antet])).toEqual([['DoarA', 82, { motiv: 'cod „B1”, UM „m”, 1 număr', randuri: 1 }]])
    const doarB = { nume: 'DoarB', rows: [...NOTE(10), ['Organizare de șantier', 'lei', 150, 300], ['Diverse și neprevăzute', 'lei', 40, 80]] }
    const rb = await parseSituatieExcel(xlsx([valida, doarB]))
    expect(rb.complet).toBe(false)
    expect(rb.foi_fara_tabel).toEqual([])
    expect(rb.foi_nerecunoscute.map(n => [n.foaie, n.rand, n.fara_antet])).toEqual([['DoarB', 11, { motiv: '2 numere și text „Organizare de șantier”', randuri: 2 }]])
    expect(rb.probleme[0].motiv).toMatch(/— 2 rânduri candidate pe foaie\)$/)
  })
  it('coperta REALĂ (antetul documentului pe celule separate, titluri, semnături, date) rămâne copertă: fără problemă, complet = true; recapitulația cu cifre e raportată', async () => {
    const antetDoc = [
      ['SITUAȚIE DE LUCRĂRI NR. 7'], ['Nr. situație:', 7, 'Luna:', 'octombrie', 'An:', 2026], ['Data: 15.10.2026'], ['Data:', '15.10.2026'], ['Contract nr.', '30/2025', 'din', 2025],
      ['Beneficiar:', '(sintetic)', 'CUI', 12345678], ['Executant:', '(sintetic)', 'Cod fiscal', 87654321], ['Obiectiv:', 'Conductă (sintetic)'], ['Perioada:', '01.10.2026 - 31.10.2026'], ['Pagina', 1, 'din', 3], [],
      ['Întocmit,', '', 'Verificat,', '', 'Aprobat,'], ['Semnătura', '', 'Semnătura', '', 'Semnătura'], ['Data: 20.10.2026', '', 'Data: 21.10.2026'],
    ]
    const r = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: antetDoc }, valida]))
    expect(r.foi).toEqual(['Valid'])
    expect(r.foi_fara_tabel).toEqual(['Coperta'])
    expect(r.foi_nerecunoscute).toEqual([])
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.contabilizare.Coperta).toEqual({ meta_document: 11, titlu: 2 }) // „Data: 20.10.2026 | | Data: 21.10.2026” e tot antet de document
    // aceeași copertă + recapitulația „Valoare totală (lei) | 20” / „Valoare cumulată (lei) | 60”: rânduri cu număr + text, fără tipar de antet
    // de document → candidate → foaia e raportată (fals pozitiv acceptat: o privire a omului; nu facem excepții în afara listei albe)
    const rr = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: [...antetDoc, ['Valoare totală (lei)', 20], ['Valoare cumulată (lei)', 60]] }, valida]))
    expect(rr.foi_fara_tabel).toEqual([])
    expect(rr.foi_nerecunoscute.map(n => [n.foaie, n.rand, n.fara_antet])).toEqual([['Coperta', 15, { motiv: '1 număr și text „Valoare totală (lei)”', randuri: 2 }]])
    expect(rr.probleme.map(p => [p.foaie, p.rand])).toEqual([['Coperta', 15], ['Coperta', 15], ['Coperta', 16]])
    expect(rr.complet).toBe(false)
  })
  it('singura foaie are rânduri de articol dar niciun antet → „format nerecunoscut” cu rândul candidat, nu „nicio foaie nu are antet”', async () => {
    const buf = xlsx([{ nume: 'S', rows: [...NOTE(81), [1, 'B1', 'Lucrare B', 'm', 3, 10, 30]] }])
    await expect(parseSituatieExcel(buf)).rejects.toThrow(/^format nerecunoscut:.* Cel mai apropiat: foaia „S”, rândul 82: rând de articol \(cod „B1”, UM „m”, 4 numere\) fără niciun antet de tabel recunoscut — 1 rând candidat pe foaie\.$/)
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

// ── review #1165 r4 → r5: INVARIANTUL DE CONTABILIZARE (contabilizare.js) închide CLASA „un rând cu conținut dispare tăcut” ──
// Fiecare reproducere a lui Jakarinos din r1–r4 e un test separat, cu valorile scrise de mână (L25). Tabelul cale → clasă → test e în PR.
describe('invariantul de contabilizare în parseSituatieExcel (review #1165 r4 P1 / P2, r5)', () => {
  const ANTET_OK = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare']
  const NOTE = n => Array.from({ length: n }, (_, i) => [`Notă introductivă ${i + 1}`])
  // (r7) fiecare fixture poartă rândul TOTAL al foii = suma liniilor așteptate, ca reconcilierea să nu adauge o problemă în plus față de cea testată
  const A1_20 = [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], TOTAL_20 = ['TOTAL', '', '', '', '', '', 20]
  it('r4 P1-1: articolul B1 (30) DEASUPRA antetului recunoscut, apoi 81 de note, antet și A1 (20) → B1 e problemă cu rândul 1, complet = false, total 20', async () => {
    const rows = [[1, 'B1', 'Lucrare B', 'm', 3, 10, 30], ...NOTE(81), ANTET_OK, A1_20, TOTAL_20]
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows }]))
    expect(r.linii.map(l => [l.cod, l.rand, l.valoare])).toEqual([['A1', 84, 20]])
    expect(r.total).toBe(20)
    expect(r.complet).toBe(false)
    expect(r.ignorate).toEqual([])
    expect(r.probleme).toEqual([{ foaie: 'S', rand: 1, clasa: 'ignorat', candidat: 'cod „B1”, UM „m”, 4 numere', motiv: 'rând de articol necontabilizat: arată a articol (cod „B1”, UM „m”, 4 numere), dar a fost clasificat „ignorat” (deasupra antetului, cu cifre) — LIPSEȘTE din rezultat' }])
    expect(r.contabilizare).toEqual({ S: { ignorat: 1, titlu: 81, antet: 1, articol: 1, total: 1 } })
    // același articol deasupra antetului, dar scris doar cu cod + UM + număr (regula a) sau cu UM + număr + text fără cod (regula b)
    const ra = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['B1', 'Lucrare B', 'm', 30], ANTET_OK, A1_20, TOTAL_20] }]))
    expect(ra.probleme.map(p => [p.rand, p.candidat])).toEqual([[1, 'cod „B1”, UM „m”, 1 număr']])
    const rb = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['Lucrare fără cod', 'buc', 30], ANTET_OK, A1_20, TOTAL_20] }]))
    expect(rb.probleme.map(p => [p.rand, p.candidat])).toEqual([[1, 'UM „buc”, 1 număr și text „Lucrare fără cod”']])
    // cod + UM FĂRĂ niciun număr deasupra antetului: e „titlu” după formă (text fără cifre), dar arată a articol → problemă pe clasa titlu
    const rc = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['B1', 'Lucrare B', 'm'], ANTET_OK, A1_20, TOTAL_20] }]))
    expect(rc.probleme.map(p => [p.rand, p.clasa, p.candidat])).toEqual([[1, 'titlu', 'cod „B1”, UM „m”, 0 numere']])
    expect(rc.complet).toBe(false)
    // antetul documentului deasupra antetului de coloane (meta_document, și cu numere pe celule separate) și titlurile fără numere: fără problemă
    const rt = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['Situație de lucrări nr. 7'], ['Luna: octombrie 2026'], ['Pagina', 1, 'din', 1], ['Nota bene'], [], ANTET_OK, A1_20, TOTAL_20] }]))
    expect(rt.probleme).toEqual([])
    expect(rt.complet).toBe(true)
    expect(rt.contabilizare).toEqual({ S: { meta_document: 3, titlu: 1, antet: 1, articol: 1, total: 1 } })
    // o recapitulație cu cifre deasupra antetului („Valoare totală (lei) | 20”) e candidat (r6) → problemă cu rândul ei (fals pozitiv acceptat)
    const rv = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['Situație de lucrări nr. 7'], ['Valoare totală (lei)', 20], [], ANTET_OK, A1_20, TOTAL_20] }]))
    expect(rv.probleme.map(p => [p.rand, p.clasa, p.candidat])).toEqual([[2, 'ignorat', '1 număr și text „Valoare totală (lei)”']])
    expect(rv.complet).toBe(false)
    expect(rv.linii.map(l => l.cod)).toEqual(['A1'])
    // titlul cu cifre („Luna: octombrie 2026”) LIPIT de antet rămâne antet de document (o celulă cu cifre nu e celulă de antet), nu intră în bloc
    const rl = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['Luna: octombrie 2026'], ANTET_OK, A1_20, TOTAL_20] }]))
    expect(rl.antet).toEqual({ nr_situatie: null, luna: 10, an: 2026 })
    expect(rl.contabilizare).toEqual({ S: { meta_document: 1, antet: 1, articol: 1, total: 1 } })
  })
  it('r4 P1-3: „contract” deasupra blocului, trei rânduri de antet repetate, apoi 100 / 20 / 10 / 1000 → blocul ÎNTREG e recunoscut, „Cantitate” = contract, foaia e nerecunoscută (lipsește perioada), NU cantitate_perioada 100', async () => {
    const A3 = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulată', 'Preț unitar', 'Valoare']
    const rows = [['', '', '', '', 'contract'], A3, A3, A3, [1, 'A1', 'Lucrare A', 'm', 100, 20, 10, 1000]]
    const a = recunoasteAntet(rows)
    expect(a.ok).toBe(false)
    // „contract” fără `!merges` se întinde spre dreapta peste coloanele cu text dedesubt (regula celulelor unite) → și „Valoare” devine
    // valoare_contract: foaia e NERECUNOSCUTĂ și raportată (lipsesc perioada și valoarea în perioadă), în niciun caz 100 drept perioadă
    expect(a.cel_mai_bun).toEqual({ rand: 2, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'cantitate_cumulat'], lipsesc: ['cantitate_perioada', 'valoare'], ambigue: [], neconsumate: [] })
    await expect(parseSituatieExcel(xlsx([{ nume: 'S', rows }]))).rejects.toThrow(/format nerecunoscut:.*rândul 2: găsite \[nr, cod, denumire, um, pret_unitar, cantitate_cumulat\], lipsesc \[cantitate_perioada, valoare\]/)
    // același „contract” DEDESUBTUL celor trei rânduri de antet: tot în bloc
    const b = recunoasteAntet([A3, A3, A3, ['', '', '', '', 'contract'], [1, 'A1', 'Lucrare A', 'm', 100, 20, 10, 1000]])
    expect(b.ok).toBe(false)
    expect(b.cel_mai_bun.lipsesc).toEqual(['cantitate_perioada'])
    // rândul „Nr | Cod | Denumire | UM” la 3 rânduri sub frunză (dincolo de vechea fereastră de 2): intră în bloc (denumire / um găsite),
    // iar „contract” din grup face „Cantitate” contract → lipsește perioada
    const c = recunoasteAntet([['', '', '', '', 'Cantitate', 'Cantitate', 'Preț', 'Valoare'], ['', '', '', '', 'contract', 'cumulat', 'unitar', 'în perioadă'], ['', '', '', '', 'contract', 'cumulat', 'unitar', 'în perioadă'], ['Nr', 'Cod', 'Denumire', 'UM', '', '', '', ''], [1, 'A1', 'x', 'm', 100, 20, 10, 1000]])
    expect(c.ok).toBe(false)
    expect(c.cel_mai_bun).toEqual({ rand: 1, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'cantitate_cumulat', 'valoare'], lipsesc: ['cantitate_perioada'], ambigue: [], neconsumate: [] })
    // trei rânduri de grup DEASUPRA frunzei (dincolo de vechea fereastră de 2): „Cantitate | contract / cumulat” intră în bloc → contract + cumulat, lipsește perioada
    const e = recunoasteAntet([['', '', '', '', 'Cantitate', 'Cantitate', 'Preț', ''], ['', '', '', '', 'contract', 'cumulat', 'unitar', 'în perioadă'], ['', '', '', '', 'contract', 'cumulat', 'unitar', 'în perioadă'], ['Nr', 'Cod', 'Denumire', 'UM', '', '', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 100, 20, 10, 1000]])
    expect(e.ok).toBe(false)
    expect(e.cel_mai_bun).toEqual({ rand: 4, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'cantitate_cumulat', 'valoare'], lipsesc: ['cantitate_perioada'], ambigue: [], neconsumate: [] })
    // calificativul neconsumat: „contract” peste o coloană pe care nimeni n-o folosește → antet neconsumat → nerecunoscut, nu fallback
    const d = recunoasteAntet([['', '', '', '', '', '', '', '', 'contract'], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulată', 'Preț unitar', 'Valoare', ''], [1, 'A1', 'x', 'm', 100, 20, 10, 1000, '']])
    expect(d.ok).toBe(false)
    expect(d.cel_mai_bun).toMatchObject({ lipsesc: [], ambigue: [], neconsumate: ['„contract” (coloana 9)'] })
    const rd = parseSituatieExcel(xlsx([{ nume: 'S', rows: [['', '', '', '', '', '', '', '', 'contract'], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulată', 'Preț unitar', 'Valoare', ''], [1, 'A1', 'x', 'm', 100, 20, 10, 1000, '']] }]))
    await expect(rd).rejects.toThrow(/lipsesc \[\], antet neconsumat \[„contract” \(coloana 9\)\]/)
    // calea legitimă rămâne: „Cantitate” simplă + cumulat, FĂRĂ niciun calificativ în jur → perioada (regula veche, L20)
    const ok = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulată', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 1, 2, 3, 3]])
    expect(ok.ok).toBe(true)
    expect(ok.coloane.cantitate_perioada).toBe(4)
    // și blocul corect cu „contract | în perioadă | cumulat” sub „Cantitate” unit, trei rânduri de grup deasupra → recunoscut cu perioada
    const g = recunoasteAntet([['Beneficiar: (sintetic)'], ['', '', '', '', 'Cantitate', '', '', 'Preț', 'Valoare'], ['Nr', 'Cod', 'Denumire', 'UM', 'contract', 'în perioadă', 'cumulat', 'unitar', 'în perioadă'], [1, 'A1', 'x', 'm', 100, 20, 60, 10, 200]])
    expect(g.ok).toBe(true)
    expect([g.inceput, g.sfarsit, g.coloane.cantitate_perioada, g.coloane.cantitate_cumulat, g.coloane.valoare]).toEqual([1, 2, 5, 6, 8])
  })
  it('r4 P2: numărul scris „+30” (text cu plus) e număr: rândul fără antet e candidat → problemă; în tabel „+30” devine 30', async () => {
    const valida = { nume: 'Valid', rows: [ANTET_OK, A1_20, TOTAL_20] }
    const r = await parseSituatieExcel(xlsx([valida, { nume: 'Detaliu', rows: [['B1', 'Lucrare B', 'm', '+30']] }]))
    expect(r.complet).toBe(false)
    expect(r.foi_fara_tabel).toEqual([])
    expect(r.foi_nerecunoscute.map(n => [n.foaie, n.fara_antet])).toEqual([['Detaliu', { motiv: 'cod „B1”, UM „m”, 1 număr', randuri: 1 }]])
    expect(r.probleme.map(p => [p.foaie, p.rand])).toEqual([['Detaliu', 1], ['Detaliu', 1]])
    const t = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, [1, 'A1', 'Suplimentare', 'm', '+30', '10', '+300'], [2, 'A2', 'Diminuare', 'm', '-5', 10, -50], ['TOTAL', '', '', '', '', '', '+250']] }]))
    expect(t.linii.map(l => [l.cod, l.cantitate_perioada, l.valoare])).toEqual([['A1', 30, 300], ['A2', -5, -50]])
    expect(t.total).toBe(250)
    expect(t.complet).toBe(true)
    // „+2.000” rămâne ambiguu ca și „2.000”
    const amb = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, [1, 'A1', 'x', 'm', '+2.000', 1, 2000], [2, 'A2', 'y', 'm', 1, 1, 1], ['TOTAL', '', '', '', '', '', 1]] }]))
    expect(amb.probleme.map(p => p.motiv)).toEqual(['număr ambiguu (mii sau zecimale?): cantitate_perioada „+2.000”'])
  })
  it('după TOTAL nimic nu dispare: articolele de după rândul TOTAL devin linii (cu rândul lor); al doilea TOTAL e tot clasa total; ultimul e totalul de control', async () => {
    const rows = [ANTET_OK, A1_20, ['TOTAL', '', '', '', '', '', 20], [2, 'A2', 'Lucrare B', 'm', 3, 10, 30], ['TOTAL GENERAL', '', '', '', '', '', 50]]
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows }]))
    expect(r.linii.map(l => [l.cod, l.rand, l.valoare])).toEqual([['A1', 2, 20], ['A2', 4, 30]])
    expect(r.total).toBe(50)
    expect(r.total_doc).toBe(50) // ultimul rând TOTAL
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.contabilizare).toEqual({ S: { antet: 1, articol: 2, total: 2 } })
    expect(r.reconciliere.controale).toEqual([expect.objectContaining({ foaie: 'S', rand: 5, eticheta: 'TOTAL GENERAL', valoare: 50, sursa: 'detaliu', scop: 'foaie' })])
  })
  it('rândul fără mișcare e contabilizat (clasa fara_miscare) ȘI listat, nu doar numărat; rândul de text după antet e „ignorat” cu motiv', async () => {
    const r = await parseSituatieExcel(fixtureA())
    expect(r.fara_miscare).toBe(1)
    expect(r.fara_miscare_randuri).toEqual([{ foaie: 'Situatie', rand: 13, nr: '4', cod: 'TSC02', denumire: 'Transport pământ', um: 'T' }])
    expect(r.contabilizare).toEqual({ Situatie: { meta_document: 3, antet: 2, index: 1, sectiune: 6, articol: 7, os: 1, diverse: 1, fara_miscare: 1, total: 1 } })
    expect(r.probleme).toEqual([])
    const t = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, A1_20, ['Text explicativ'], ['', '', 'Notă: valorile sunt fără TVA'], TOTAL_20] }]))
    expect(t.ignorate.map(i => [i.rand, i.motiv])).toEqual([[3, 'text fără cifre în coloanele cantitate / preț / valoare și fără UM'], [4, 'text fără cifre în coloanele cantitate / preț / valoare și fără UM']])
    expect(t.contabilizare.S).toEqual({ antet: 1, articol: 1, ignorat: 2, total: 1 })
    expect(t.complet).toBe(true)
  })
  it('un rând de articol înghițit ca SECȚIUNE („Obiect metalic 01 …” se potrivește pe RE_OBIECT) e problemă, nu dispariție tăcută; reconcilierea o prinde și ea', async () => {
    const rows = [ANTET_OK, ['Obiectul: 01 Tronson A'], A1_20, [2, 'XYZ1', 'Obiect metalic 01 montat', 'buc', 2, 10, 20], ['TOTAL', '', '', '', '', '', 40]]
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows }]))
    expect(r.linii.map(l => l.cod)).toEqual(['A1'])
    expect(r.sectiuni).toHaveLength(2)
    expect(r.complet).toBe(false)
    expect(r.probleme).toEqual([
      { foaie: 'S', rand: 4, clasa: 'sectiune', candidat: 'cod „XYZ1”, UM „buc”, 4 numere', motiv: 'rând de articol necontabilizat: arată a articol (cod „XYZ1”, UM „buc”, 4 numere), dar a fost clasificat „sectiune” — LIPSEȘTE din rezultat' },
      // (r7) a doua plasă, independentă de forma rândului: totalul tipărit 40 ≠ suma citită 20
      { foaie: 'S', rand: 5, diferenta: 20, motiv: 'totalul de control 40 lei („TOTAL”, foaia „S”, rândul 5) ≠ suma foii 20 lei (diferență 20 lei) și suma documentului 20 lei (diferență 20 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.01 lei' },
    ])
  })
  it('clasele raportate corespund rândurilor foii și fiecare rând ne-gol are exact una (suma claselor = rândurile ne-gole)', async () => {
    const r = await parseSituatieExcel(fixtureA())
    const rows = [...TITLU, ANTET_A, ANTET_B, INDEX, ...DATE_A]
    const neGole = rows.filter(row => row.some(c => c !== '' && c != null)).length
    expect(Object.values(r.contabilizare.Situatie).reduce((s, n) => s + n, 0)).toBe(neGole)
  })
})

// ── review #1165 r5 (NO-GO pe 4cb03e3f): trei scăpări ale invariantului — rândul candidat prea restrictiv, „total” fără dovadă, blocul de
// antet tăiat de o celulă nerecunoscută. Reproducerile lui Jakarinos, fiecare test separat, valorile scrise de mână (L25).
// (r7) devizul AA Excel are doar cantități → parseDevizModificare adaugă MEREU problema „fără control pe valoare” (ultima); testele o scot cu `faraFCV`
const FCV = expect.objectContaining({ motiv: expect.stringMatching(/^fără control pe valoare: devizul are doar cantități/) })
const faraFCV = r => { expect(r.probleme.at(-1)).toEqual(FCV); expect(r.complet).toBe(false); return r.probleme.slice(0, -1) }

describe('review #1165 r5 → r6: rândul candidat = orice număr + text (meta_document singura excepție), total doar cu dovadă, blocul de antet întreg', () => {
  const ANTET_OK = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare']
  const ANTET_CUM = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulat', 'Pret unitar', 'Valoare']
  const valida = { nume: 'Valid', rows: [ANTET_OK, [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], ['TOTAL', '', '', '', '', '', 20]] }
  const fisierAA = foi => ({ name: 'aa.xlsx', arrayBuffer: async () => xlsx(foi) })
  const ANTET_AA = ['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate']
  it('P1-1 (situație): „B1 | Lucrare B | SET | +30” și „Lucrare B | +30” pe o foaie „Detaliu” fără antet → problemă cu foaia și rândul, complet = false (înainte: numai A1, complet = true)', async () => {
    for (const [rand, candidat] of [[['B1', 'Lucrare B', 'SET', '+30'], 'cod „B1”, 1 număr și text „Lucrare B”'], [['Lucrare B', '+30'], '1 număr și text „Lucrare B”']]) {
      const r = await parseSituatieExcel(xlsx([valida, { nume: 'Detaliu', rows: [rand] }]))
      expect(r.linii.map(l => l.cod), JSON.stringify(rand)).toEqual(['A1'])
      expect(r.complet, JSON.stringify(rand)).toBe(false)
      expect(r.foi_fara_tabel).toEqual([])
      expect(r.foi_nerecunoscute.map(n => [n.foaie, n.rand, n.fara_antet])).toEqual([['Detaliu', 1, { motiv: candidat, randuri: 1 }]])
      expect(r.probleme.map(p => [p.foaie, p.rand, p.clasa ?? 'foaie'])).toEqual([['Detaliu', 1, 'foaie'], ['Detaliu', 1, 'ignorat']])
      expect(r.probleme[1].candidat).toBe(candidat)
      expect(r.contabilizare.Detaliu).toEqual({ ignorat: 1 })
    }
    // aceleași rânduri ÎN tabel (sub antetul recunoscut): „SET” e UM brut nevid → linie cu UM „SET” (conversia o decide potrivirea); „Lucrare B | +30”
    // cade pe coloanele nr / cod → nu are cifre în cantitate / preț / valoare → ar fi „ignorat” → candidat neacoperit → problemă
    const t = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], [2, 'B1', 'Lucrare B', 'SET', '+30', 1, 30], ['Lucrare B', '+30'], ['TOTAL', '', '', '', '', '', 50]] }]))
    expect(t.linii.map(l => [l.cod, l.um, l.cantitate_perioada, l.valoare])).toEqual([['A1', 'm', 2, 20], ['B1', 'SET', 30, 30]])
    expect(t.probleme.map(p => [p.rand, p.clasa, p.candidat])).toEqual([[4, 'ignorat', '1 număr și text „Lucrare B”']])
    expect(t.complet).toBe(false)
  })
  it('P1-1 (AA Excel): aceleași rânduri pe o foaie fără antet → problemă; în tabel „SET” e linie, „Lucrare B | +30” e problemă (rând cu conținut sărit)', async () => {
    for (const [rand, candidat] of [[['B1', 'Lucrare B', 'SET', '+30'], 'cod „B1”, 1 număr și text „Lucrare B”'], [['Lucrare B', '+30'], '1 număr și text „Lucrare B”']]) {
      const r = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'Detaliu', rows: [rand] }]))
      expect(r.linii.map(l => l.cod), JSON.stringify(rand)).toEqual(['TSA01A1'])
      expect(faraFCV(r).map(p => [p.foaie, p.rand, p.clasa, p.candidat])).toEqual([['Detaliu', 1, 'ignorat', candidat]])
      expect(r.contabilizare).toEqual({ Deviz: { antet: 1, articol: 1 }, Detaliu: { ignorat: 1 } })
    }
    const t = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2], [2, 'B1', 'Lucrare B', 'SET', '+30'], ['Lucrare B', '+30']] }]))
    expect(t.linii.map(l => [l.cod, l.um, l.cantitate])).toEqual([['TSA01A1', 'mc', 2], ['B1', 'SET', 30]])
    expect(faraFCV(t).map(p => [p.rand, p.motiv])).toEqual([[4, 'rând cu conținut sărit: lipsesc cantitate, UM, denumire']])
  })
  it('P1-1 (excepția): un antet de document realist, pe celule separate, deasupra tabelului și pe copertă → meta_document, complet = true', async () => {
    const antetDoc = [['Situația de lucrări nr.', 5], ['Luna', 'octombrie', 2026], ['Pagina', 1, 'din', 3], ['Contract nr.', '30/2025'], ['Beneficiar:', '(sintetic)', 'CUI', 1234567], []]
    const r = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: antetDoc }, { nume: 'S', rows: [...antetDoc, ANTET_OK, [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], ['TOTAL', '', '', '', '', '', 20]] }]))
    expect(r.antet).toEqual({ nr_situatie: '5', luna: 10, an: 2026 })
    expect(r.linii.map(l => [l.cod, l.rand, l.valoare])).toEqual([['A1', 8, 20]])
    expect(r.total_doc).toBe(20)
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.foi_fara_tabel).toEqual(['Coperta'])
    expect(r.contabilizare).toEqual({ Coperta: { meta_document: 5 }, S: { meta_document: 5, antet: 1, articol: 1, total: 1 } })
    // și pe AA Excel: antetul documentului deasupra tabelului / pe o foaie separată nu e problemă (rămâne doar „fără control pe valoare”, r7)
    const aa = await parseDevizModificare(fisierAA([{ nume: 'Coperta', rows: antetDoc }, { nume: 'Deviz', rows: [...antetDoc, ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }]))
    expect(aa.linii.map(l => [l.cod, Number(l.nr) + 1])).toEqual([['TSA01A1', 8]])
    expect(faraFCV(aa)).toEqual([])
    expect(aa.contabilizare).toEqual({ Coperta: { meta_document: 5 }, Deviz: { meta_document: 5, antet: 1, articol: 1 } })
  })
  it('P1-2 (situație): „[2, B1, Total station montaj, m, 3, 3, 10, 30]” după A1 → e ARTICOL (30), cu avertisment; totalul de control e rândul TOTAL (50), nu 30 (înainte: total 20, total_doc 30, B1 lipsea, complet = true)', async () => {
    const rows = [ANTET_CUM, [1, 'A1', 'Lucrare A', 'm', 2, 2, 10, 20], [2, 'B1', 'Total station montaj', 'm', 3, 3, 10, 30], ['TOTAL', '', '', '', '', '', '', 50]]
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows }]))
    expect(r.linii.map(l => [l.cod, l.denumire, l.cantitate_perioada, l.valoare, l.tip_rand])).toEqual([['A1', 'Lucrare A', 2, 20, 'articol'], ['B1', 'Total station montaj', 3, 30, 'articol']])
    expect(r.total).toBe(50)
    expect(r.total_doc).toBe(50)
    expect(r.reconciliere.controale.map(c => [c.rand, c.valoare])).toEqual([[4, 50]]) // nu rândul 3
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.avertismente).toEqual([{ foaie: 'S', rand: 3, motiv: 'denumirea începe cu „Total”, dar rândul are cod / UM / cantitate — citit ca articol, nu ca total', cod: 'B1', denumire: 'Total station montaj' }])
    expect(r.contabilizare).toEqual({ S: { antet: 1, articol: 2, total: 1 } })
    // fără rândul TOTAL: B1 tot articol, dar documentul n-are total de control → complet: false cu motivul explicit (r7)
    const f = await parseSituatieExcel(xlsx([{ nume: 'S', rows: rows.slice(0, 3) }]))
    expect(f.total_doc).toBeNull()
    expect(f.probleme.map(p => p.motiv)).toEqual(['fără total de control: documentul nu are niciun rând TOTAL recunoscut (pe foile de detaliu sau pe o recapitulație) — suma articolelor citite (50 lei) nu poate fi verificată'])
    expect(f.complet).toBe(false)
  })
  it('P1-2 (situație): „Total …” cu dovadă parțială (doar cod / doar UM / doar cantitate) → problemă cu motivul coloanelor, nu total tăcut; totalul dovedit rămâne total (și cu cod „TOTAL”, nr „TOTAL”, UM „lei”)', async () => {
    const baza = [ANTET_CUM, [1, 'A1', 'Lucrare A', 'm', 2, 2, 10, 20]], TOTAL = ['TOTAL', '', '', '', '', '', '', 20]
    const cazuri = [
      [['', 'B1', 'Total obiect', '', '', '', '', 100], 'UM lipsă'], // cod de articol, fără UM → nu e total → pipeline: UM lipsă
      [['', '', 'Total obiect', 'm', '', '', '', 100], 'cantitate în perioadă lipsă (valoare fără cantitate)'], // UM din listă → articol fără cantitate
      [['', '', 'Total obiect', '', 5, '', '', 100], 'UM lipsă'], // cantitate → nu e total
      [['', '', 'Total obiect', '', '', 7, '', 100], 'UM lipsă'], // cantitate cumulat → nu e total
    ]
    for (const [rand, motiv] of cazuri) {
      const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [...baza, rand, TOTAL] }]))
      expect(r.total_doc, JSON.stringify(rand)).toBe(20) // rândul TOTAL de după, nu „Total obiect | 100”
      expect(r.linii.map(l => l.cod), JSON.stringify(rand)).toEqual(['A1'])
      expect(r.probleme.map(p => [p.rand, p.motiv]), JSON.stringify(rand)).toEqual([[3, motiv]])
      expect(r.complet, JSON.stringify(rand)).toBe(false)
      expect(r.contabilizare.S).toEqual({ antet: 1, articol: 1, problema: 1, total: 1 })
    }
    for (const rand of [['', '', 'TOTAL', '', '', '', '', 20], ['', 'TOTAL', '', '', '', '', '', 20], ['TOTAL', '', '', '', '', '', '', 20], ['', '', 'Total general', 'lei', '', '', '', 20], ['', '', 'TOTAL', '', '', '', 50, 20]]) {
      const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [...baza, rand] }]))
      expect(r.total_doc, JSON.stringify(rand)).toBe(20)
      expect(r.probleme, JSON.stringify(rand)).toEqual([])
      expect(r.complet, JSON.stringify(rand)).toBe(true)
      expect(r.contabilizare.S, JSON.stringify(rand)).toEqual({ antet: 1, articol: 1, total: 1 })
    }
  })
  it('P1-2 (AA Excel): „Total station montaj | m | 3” cu cod e linie (nu total); „Total deviz” cu cantitate → problemă; totalul dovedit (fără cod / UM / cantitate) rămâne total', async () => {
    const r = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2], [2, 'B1', 'Total station montaj', 'm', 3], ['', '', 'Total deviz', '', 5], ['', '', 'Total deviz', '', '', 99], ['', 'TOTAL', '', 'lei', '']] }]))
    expect(r.linii.map(l => [l.cod, l.denumire, l.cantitate])).toEqual([['TSA01A1', 'Săpătură', 2], ['B1', 'Total station montaj', 3]])
    expect(faraFCV(r).map(p => [p.rand, p.motiv])).toEqual([[4, 'rând cu conținut sărit: lipsesc UM']])
    expect(r.contabilizare).toEqual({ Deviz: { antet: 1, articol: 2, problema: 1, total: 2 } })
    // calea catalogului pe același fișier: identică cu main (așteptare scrisă de mână după regula veche: coloana UM = „Denumire” (includes('um')),
    // deci cant + den nevide → articol, inclusiv „Total deviz | 5” cu UM = denumirea; totalurile fără cantitate sunt sărite) — defect preexistent, neatins
    const vechi = await parseDeviz(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2], [2, 'B1', 'Total station montaj', 'm', 3], ['', '', 'Total deviz', '', 5], ['', '', 'Total deviz', '', '', 99], ['', 'TOTAL', '', 'lei', '']] }]))
    expect(vechi.map(a => [a.cod, a.um, a.cantitate])).toEqual([['TSA01A1', 'Săpătură', 2], ['B1', 'Total station montaj', 3], ['', 'Total deviz', 5]])
  })
  it('P1-3: „contract | … | Observatii” deasupra antetului cu „Cantitate” + „Cantitate cumulat” → blocul îl cuprinde, „Cantitate” e contract → foaia e nerecunoscută și raportată; NU cantitate_perioada = 100', async () => {
    const rows = [['', '', '', '', 'contract', '', '', '', 'Observatii'], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000]]
    const a = recunoasteAntet(rows)
    expect(a.ok).toBe(false)
    // „contract” fără `!merges` se întinde spre dreapta peste coloanele cu text dedesubt (cumulat / preț / valoare): lipsesc perioada și valoarea
    expect(a.cel_mai_bun).toEqual({ rand: 2, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'cantitate_cumulat'], lipsesc: ['cantitate_perioada', 'valoare'], ambigue: [], neconsumate: [] })
    // singura foaie → eroare clară; lângă o foaie validă → problemă de foaie + rândul B1, complet = false, linii doar A1 (înainte: B1 cu cantitate_perioada 100, complet = true)
    await expect(parseSituatieExcel(xlsx([{ nume: 'S', rows }]))).rejects.toThrow(/format nerecunoscut:.*rândul 2: găsite \[nr, cod, denumire, um, pret_unitar, cantitate_cumulat\], lipsesc \[cantitate_perioada, valoare\]/)
    const r = await parseSituatieExcel(xlsx([valida, { nume: 'Detaliu', rows }]))
    expect(r.linii.map(l => [l.cod, l.cantitate_perioada])).toEqual([['A1', 2]])
    expect(r.complet).toBe(false)
    expect(r.foi_nerecunoscute.map(n => [n.foaie, n.rand, n.lipsesc])).toEqual([['Detaliu', 2, ['cantitate_perioada', 'valoare']]])
    expect(r.probleme.map(p => [p.foaie, p.rand, p.clasa ?? 'foaie'])).toEqual([['Detaliu', 2, 'foaie'], ['Detaliu', 3, 'ignorat']])
    // DOAR celula „Observatii” scoasă (reproducerea lui Jak: înainte, parserul refuza formatul doar atunci) → acelaşi verdict ca mai sus: nerecunoscut
    const c = recunoasteAntet([['', '', '', '', 'contract'], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000]])
    expect(c.ok).toBe(false)
    expect(c.cel_mai_bun.lipsesc).toEqual(['cantitate_perioada', 'valoare'])
    // rândul de calificative („contract” singur) NU e antet de document (r7: „contract” singur e calificativ, eticheta e „Contract nr.”) → ignorat cu motivul foii; B1 rămâne problema
    expect(r.contabilizare.Detaliu).toEqual({ ignorat: 3 })
  })
  it('P1-3 (căile legitime): o celulă nerecunoscută în rândul de calificative („Obs.”) nu rupe blocul; „Observații” ca coloană proprie e în regulă; calificativul „anterior” / „precedent” e consumat ca clasă proprie', async () => {
    // rândul de calificative de SUB frunză, cu „Obs.” la capăt: tot în bloc → perioada / cumulat recunoscute
    const g = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate', 'Preț unitar', 'Valoare', 'Observații'], ['', '', '', '', 'în perioadă', 'cumulat', '', '', 'Obs.'], [1, 'A1', 'x', 'm', 1, 2, 3, 3, 'nota']])
    expect(g.ok).toBe(true)
    expect([g.inceput, g.sfarsit, g.coloane.cantitate_perioada, g.coloane.cantitate_cumulat]).toEqual([0, 1, 4, 5])
    // un rând deasupra fără NICIO celulă de antet („Beneficiar: (sintetic) | Nota 1”) nu intră în bloc
    const h = recunoasteAntet([['Beneficiar: (sintetic)', '', 'Notă'], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 1, 3, 3]])
    expect(h.ok).toBe(true)
    expect([h.inceput, h.sfarsit]).toEqual([1, 1])
    // „anterior” / „precedent” = clasă proprie (nu perioadă, nu cumulat): consumat, niciodată folosit drept perioadă
    expect(clasificaColoana('Cantitate realizată anterior')).toBe('cantitate_anterior')
    expect(clasificaColoana('Cantitate cumulată precedentă')).toBe('cantitate_anterior')
    expect(clasificaColoana('Valoare anterioară')).toBe('valoare_anterior')
    expect(clasificaColoana('Valoare precedent')).toBe('valoare_anterior')
    const k = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', '', '', 'Preț unitar', 'Valoare'], ['', '', '', '', 'anterior', 'în perioadă', 'cumulat', '', ''], [1, 'A1', 'x', 'm', 5, 1, 6, 3, 3]])
    expect(k.ok).toBe(true)
    expect([k.coloane.cantitate_perioada, k.coloane.cantitate_cumulat]).toEqual([5, 6])
    // „anterior” + „Cantitate” simplă, fără perioadă explicită și fără cumulat → nu există fallback → nerecunoscut (perioada lipsește), raportat
    const n = recunoasteAntet([['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate anterior', 'Cantitate', 'Preț unitar', 'Valoare'], [1, 'A1', 'x', 'm', 5, 1, 3, 3]])
    expect(n.ok).toBe(false)
    expect(n.cel_mai_bun).toMatchObject({ lipsesc: ['cantitate_perioada'], neconsumate: [] })
    // un calificativ orfan rămâne „neconsumat” → nerecunoscut (nu fallback), și cu o celulă străină pe același rând
    const o = recunoasteAntet([['', '', '', '', '', '', '', '', 'anterior', 'Observatii'], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulată', 'Preț unitar', 'Valoare', '', ''], [1, 'A1', 'x', 'm', 100, 20, 10, 1000, '', '']])
    expect(o.ok).toBe(false)
    expect(o.cel_mai_bun).toMatchObject({ lipsesc: [], neconsumate: ['„anterior” (coloana 9)'] })
  })
  it('P1-4 (.docx): linia care arată a articol cu poziția din 4 cifre („1000 TSD01B1 M 3”) e problemă sub contabilizare, nu paragraf sărit tăcut; implicit (catalog) se sare ca pe main', async () => {
    const paras = ['001 TSA01A1 M 2', 'SAPATURA', 'Total=20', '1000 TSD01B1 M 3', 'UMPLUTURA', 'Total=30', '1 RPCU01 HM 2.500', 'MONTAJ', 'Total=10']
    const r = await parseDevizModificare(await docx([...paras, 'TOTAL DEVIZ 60.00']))
    expect(r.linii.map(l => [l.cod, l.cantitate, l.valoare])).toEqual([['TSA01A1', 2, 20]])
    expect(r.complet).toBe(false)
    expect(r.probleme).toEqual([
      { paragraf: 4, motiv: 'linie care arată a articol, dar poziția nu are 3 cifre (format neacceptat, sărită): „1000 TSD01B1 M 3”' },
      { paragraf: 7, motiv: 'linie care arată a articol, dar poziția nu are 3 cifre (format neacceptat, sărită): „1 RPCU01 HM 2.500”' },
      // (r7) a doua plasă: totalul devizului (60) ≠ suma articolelor citite (20) — cele două linii sărite valorează 40; „Total=30” / „Total=10” orfane NU sunt totaluri de deviz
      { paragraf: 10, diferenta: 40, motiv: 'totalul de control 60 lei („TOTAL DEVIZ”, paragraful 10) ≠ suma articolelor citite 20 lei (diferență 40 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.01 lei' },
    ])
    expect(articoleDinParagrafe(paras).map(a => a.cod)).toEqual(['TSA01A1']) // regula veche: sărite tăcut, rezultat array
    expect(articoleDinParagrafe(paras, { cuSemn: true }).map(a => a.cod)).toEqual(['TSA01A1'])
    // „Total=20” și liniile de denumire / resurse („SAPATURA”, „MATERIAL 1.00 2.00”) nu arată a articol
    expect(articoleDinParagrafe(['Total=20', 'SAPATURA', 'MATERIAL 1.00 2.00', '1 6718394 CIMENT KG 100.000'], { contabilizare: true }).probleme).toEqual([])
  })
})

// ── review #1165 r6 (NO-GO pe c155cb76) → r7: PLASA DE CONTROL PE TOTAL (decizia chat-ului) + cele trei constatări ale lui Jak.
// Reproducerile lui, fiecare test separat, pe situație ȘI pe AA Excel, valorile scrise de mână (L25).
describe('review #1165 r6 → r7: reconcilierea cu totalul documentului; meta_document pe forma rândului; contextul de antet pe AA Excel; antetul contractual realist', () => {
  const ANTET_OK = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate în perioadă', 'Preț unitar', 'Valoare']
  const ANTET_CUM = ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Cantitate cumulat', 'Pret unitar', 'Valoare']
  const ANTET_AA = ['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate']
  const A1_20 = [1, 'A1', 'Lucrare A', 'm', 2, 10, 20], TOTAL_20 = ['TOTAL', '', '', '', '', '', 20]
  const valida = { nume: 'Valid', rows: [ANTET_OK, A1_20, TOTAL_20] }
  const fisierAA = foi => ({ name: 'aa.xlsx', arrayBuffer: async () => xlsx(foi) })
  const JAK = [2, 2000092, 'Executant lucrari speciale', 'SET', 3, 3, 10, 30], JAK_ABC = [2, 'ABCDEF01', 'Executant lucrari speciale', 'SET', 3, 3, 10, 30]

  // 0. plasa principală: complet DOAR cu total de control potrivit
  it('0 (situație): fără niciun rând TOTAL → complet: false cu „fără total de control”; cu TOTAL egal cu suma → complet: true; diferență peste toleranță → problemă cu diferența în lei și foaia', async () => {
    const fara = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, A1_20, [2, 'A2', 'Lucrare B', 'm', 3, 10, 30]] }]))
    expect(fara.total).toBe(50)
    expect(fara.complet).toBe(false)
    expect(fara.probleme).toEqual([{ motiv: 'fără total de control: documentul nu are niciun rând TOTAL recunoscut (pe foile de detaliu sau pe o recapitulație) — suma articolelor citite (50 lei) nu poate fi verificată' }])
    expect(fara.reconciliere).toMatchObject({ ok: false, suma: 50, toleranta: 0.02, controale: [] })
    const egal = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, A1_20, [2, 'A2', 'Lucrare B', 'm', 3, 10, 30], ['TOTAL', '', '', '', '', '', 50]] }]))
    expect(egal.complet).toBe(true)
    expect(egal.reconciliere).toMatchObject({ ok: true, controale: [expect.objectContaining({ foaie: 'S', rand: 4, valoare: 50, sursa: 'detaliu', scop: 'foaie', suma_foaie: 50, linii_foaie: 2 })] })
    // toleranța de rotunjire: 0,01 lei × 2 linii = 0,02 → 50,02 trece, 50,03 nu
    expect((await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, A1_20, [2, 'A2', 'Lucrare B', 'm', 3, 10, 30], ['TOTAL', '', '', '', '', '', 50.02]] }]))).complet).toBe(true)
    const dif = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, A1_20, [2, 'A2', 'Lucrare B', 'm', 3, 10, 30], ['TOTAL', '', '', '', '', '', 50.03]] }]))
    expect(dif.complet).toBe(false)
    expect(dif.probleme).toEqual([{ foaie: 'S', rand: 4, diferenta: 0.03, motiv: 'totalul de control 50.03 lei („TOTAL”, foaia „S”, rândul 4) ≠ suma foii 50 lei (diferență 0.03 lei) și suma documentului 50 lei (diferență 0.03 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.02 lei' }])
    // toleranța nu trece de 1 leu: 150 de linii de 1 leu, TOTAL 151,5 → problemă; TOTAL 150,9 → trece
    const multe = tot => [ANTET_OK, ...Array.from({ length: 150 }, (_, i) => [i + 1, `A${i + 1}`, 'Lucrare', 'm', 1, 1, 1]), ['TOTAL', '', '', '', '', '', tot]]
    expect((await parseSituatieExcel(xlsx([{ nume: 'S', rows: multe(150.9) }]))).complet).toBe(true)
    const peste = await parseSituatieExcel(xlsx([{ nume: 'S', rows: multe(151.5) }]))
    expect(peste.complet).toBe(false)
    expect(peste.reconciliere.toleranta).toBe(1)
    expect(peste.probleme.map(p => p.diferenta)).toEqual([1.5])
    // OS și diverse (fără cod / cantitate) intră în sumă cu semn; o diminuare negativă la fel
    const os = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [ANTET_OK, A1_20, [2, 'A2', 'Diminuare', 'm', -1, 10, -10], ['', 'OS', 'Organizare de șantier', 'lei', '', '', 5], ['', '', 'Diverse și neprevăzute', 'lei', 1, 3, 3], ['TOTAL', '', '', '', '', '', 18]] }]))
    expect(os.linii.map(l => [l.tip_rand, l.valoare])).toEqual([['articol', 20], ['articol', -10], ['os', 5], ['diverse', 3]])
    expect(os.total).toBe(18)
    expect(os.probleme).toEqual([])
    expect(os.complet).toBe(true)
  })
  it('0 (situație, mai multe foi): fiecare foaie cu TOTAL-ul ei → complet; TOTAL general doar pe ultima foaie (= suma documentului) → complet; o foaie fără TOTAL și fără total al documentului → „fără total de control pe foile …”', async () => {
    const foaie = (nume, cod, v, total) => ({ nume, rows: [ANTET_OK, [1, cod, 'Lucrare', 'm', 1, v, v], ...(total == null ? [] : [['TOTAL', '', '', '', '', '', total]])] })
    const fiecare = await parseSituatieExcel(xlsx([foaie('Ob1', 'A1', 10, 10), foaie('Ob2', 'A2', 20, 20)]))
    expect(fiecare.complet).toBe(true)
    expect(fiecare.reconciliere.controale.map(c => [c.foaie, c.scop])).toEqual([['Ob1', 'foaie'], ['Ob2', 'foaie']])
    const general = await parseSituatieExcel(xlsx([foaie('Ob1', 'A1', 10, null), foaie('Ob2', 'A2', 20, 30)]))
    expect(general.complet).toBe(true)
    expect(general.reconciliere.controale.map(c => [c.foaie, c.scop, c.diferenta_foaie, c.diferenta_document])).toEqual([['Ob2', 'document', 10, 0]])
    expect(general.avertismente.map(a => a.motiv)).toContain('rând TOTAL găsit doar în 1 din 2 foi — totalul tipărit e parțial')
    const lipsa = await parseSituatieExcel(xlsx([foaie('Ob1', 'A1', 10, null), foaie('Ob2', 'A2', 20, 20)]))
    expect(lipsa.complet).toBe(false)
    expect(lipsa.probleme.map(p => p.motiv)).toEqual(['fără total de control pe foile: „Ob1” — liniile lor nu sunt verificate de niciun total (nici al foii, nici al documentului)'])
    // un TOTAL de foaie greșit NU e mascat de celălalt corect
    const gresit = await parseSituatieExcel(xlsx([foaie('Ob1', 'A1', 10, 10), foaie('Ob2', 'A2', 20, 25)]))
    expect(gresit.complet).toBe(false)
    expect(gresit.probleme.map(p => [p.foaie, p.rand, p.diferenta])).toEqual([['Ob2', 3, 5]])
  })
  it('0 (situație, recapitulație): „Total general | 30” pe copertă e totalul de control al documentului (clasa total, nu candidat); nepotrivit → diferență; două numere pe rândul de total = ambiguu → candidat raportat', async () => {
    const detaliu = { nume: 'Detaliu', rows: [ANTET_OK, A1_20, [2, 'A2', 'Lucrare B', 'buc', 1, 10, 10]] } // fără TOTAL pe foaia de detaliu
    const ok = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: [['Situație de lucrări nr. 7'], ['Total general (lei)', 30], ['Întocmit,', '', 'Verificat,']] }, detaliu]))
    expect(ok.foi_fara_tabel).toEqual(['Coperta'])
    expect(ok.contabilizare.Coperta).toEqual({ meta_document: 1, total: 1, titlu: 1 })
    expect(ok.probleme).toEqual([])
    expect(ok.complet).toBe(true)
    expect(ok.reconciliere.controale).toEqual([expect.objectContaining({ foaie: 'Coperta', rand: 2, eticheta: 'Total general (lei)', valoare: 30, sursa: 'recapitulatie', scop: 'document' })])
    const nu = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: [['Situație de lucrări nr. 7'], ['Total general (lei)', 35]] }, detaliu]))
    expect(nu.complet).toBe(false)
    expect(nu.probleme).toEqual([{ foaie: 'Coperta', rand: 2, diferenta: 5, motiv: 'totalul de control 35 lei („Total general (lei)”, foaia „Coperta”, rândul 2) ≠ suma articolelor citite 30 lei (diferență 5 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.02 lei' }])
    // „TOTAL | 30 | 90” (perioadă și cumulat) — care e controlul? ambiguu → rămâne candidat → foaia e raportată, fără total de control → complet: false
    const amb = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: [['Situație de lucrări nr. 7'], ['TOTAL', 30, 90]] }, detaliu]))
    expect(amb.complet).toBe(false)
    expect(amb.foi_nerecunoscute.map(n => [n.foaie, n.fara_antet?.motiv])).toEqual([['Coperta', '2 numere și text „TOTAL”']])
    expect(amb.probleme.some(p => p.motiv.startsWith('fără total de control'))).toBe(true)
    // ultimul total al recapitulației e controlul („Total tronson A | 20”, „Total tronson B | 10”, „TOTAL | 30”)
    const ultim = await parseSituatieExcel(xlsx([{ nume: 'Recap', rows: [['Total tronson A', 20], ['Total tronson B', 10], ['TOTAL', 30]] }, detaliu]))
    expect(ultim.complet).toBe(true)
    expect(ultim.contabilizare.Recap).toEqual({ total: 3 })
    expect(ultim.reconciliere.controale.map(c => [c.rand, c.valoare])).toEqual([[3, 30]])
  })
  it('0 (AA Excel): devizul are doar cantități → mereu „fără control pe valoare” (ultima problemă), complet: false, explicit', async () => {
    const r = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2], ['', '', 'Total deviz', '', '', 99]] }]))
    expect(r.linii.map(l => [l.cod, l.cantitate])).toEqual([['TSA01A1', 2]])
    expect(r.probleme).toEqual([{ motiv: 'fără control pe valoare: devizul are doar cantități (fără „Total=” pe articole / fără coloană de valoare), suma articolelor nu poate fi verificată cu un total de control' }])
    expect(r.complet).toBe(false)
    expect(r.reconciliere).toBeNull()
  })

  // 1. meta_document DOAR pe forma de antet de document (reproducerea lui Jak)
  it('1 (situație): rândul lui Jak („2 | 2000092 | Executant lucrari speciale | SET | 3 | 3 | 10 | 30”, și cu „ABCDEF01”) pe o foaie fără antet, lângă una validă → NU e meta_document: problemă cu foaia și rândul, complet: false (înainte: numai A1, complet: true, foaia {meta_document: 1})', async () => {
    for (const rand of [JAK, JAK_ABC]) {
      const r = await parseSituatieExcel(xlsx([valida, { nume: 'Detaliu', rows: [rand] }]))
      expect(r.linii.map(l => l.cod), JSON.stringify(rand)).toEqual(['A1'])
      expect(r.complet, JSON.stringify(rand)).toBe(false)
      expect(r.foi_fara_tabel).toEqual([])
      expect(r.contabilizare.Detaliu).toEqual({ ignorat: 1 })
      expect(r.probleme.map(p => [p.foaie, p.rand, p.clasa ?? 'foaie'])).toEqual([['Detaliu', 1, 'foaie'], ['Detaliu', 1, 'ignorat']])
      expect(r.probleme[1].candidat).toBe(rand === JAK ? '6 numere și text „Executant lucrari speciale”' : '5 numere și text „ABCDEF01”')
      // același rând DEASUPRA antetului foii valide → ignorat cu cifre → candidat neacoperit → problemă; și reconcilierea îl vede (TOTAL 50 ≠ 20)
      const sus = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [rand, ANTET_OK, A1_20, ['TOTAL', '', '', '', '', '', 50]] }]))
      expect(sus.complet).toBe(false)
      expect(sus.probleme.map(p => [p.rand, p.clasa ?? 'reconciliere'])).toEqual([[1, 'ignorat'], [4, 'reconciliere']])
      expect(sus.probleme[1].diferenta).toBe(30)
    }
  })
  it('1 (AA Excel): rândul lui Jak pe o foaie fără antet, lângă un deviz valid → problemă cu foaia și rândul (nu meta_document); deasupra antetului → problemă', async () => {
    for (const rand of [JAK, JAK_ABC]) {
      const r = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'Detaliu', rows: [rand] }]))
      expect(r.linii.map(l => l.cod), JSON.stringify(rand)).toEqual(['TSA01A1'])
      expect(faraFCV(r).map(p => [p.foaie, p.rand, p.clasa])).toEqual([['Detaliu', 1, 'ignorat']])
      expect(r.contabilizare).toEqual({ Deviz: { antet: 1, articol: 1 }, Detaliu: { ignorat: 1 } })
      const sus = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [rand, ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }]))
      expect(faraFCV(sus).map(p => [p.rand, p.clasa])).toEqual([[1, 'ignorat']])
    }
  })

  // 2. contextul de antet: aceeași funcție de bloc pe AA Excel; calificativ + cifră nu devine meta_document
  it('2 (AA Excel): „contract | … | Observatii” deasupra lui „Cantitate | Cantitate cumulat” → blocul îl cuprinde, „Cantitate” e a contractului → foaia e refuzată cu diagnostic, B1 e problemă, complet: false (înainte: B1 cu cantitate 100, complet: true)', async () => {
    const rows = [['', '', '', '', 'contract', '', '', '', 'Observatii'], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000]]
    const r = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'AA', rows }]))
    expect(r.linii.map(l => [l.cod, l.cantitate])).toEqual([['TSA01A1', 2]]) // B1 NU e linie cu 100
    const p = faraFCV(r)
    expect(p.map(x => [x.foaie, x.rand, x.clasa ?? 'foaie'])).toEqual([['AA', 2, 'foaie'], ['AA', 3, 'ignorat']])
    expect(p[0].motiv).toBe('foaie nerecunoscută: antet de deviz nesigur (rândul 2: nicio coloană „Cantitate” fără calificativ (contract / cumulat / perioadă …); coloane de situație de lucrări, nu de deviz: cantitate_cumulat) — liniile foii LIPSESC din rezultat')
    expect(p[1].candidat).toBe('cod „B1”, UM „m”, 5 numere')
    expect(r.contabilizare.AA).toEqual({ ignorat: 3 })
    // singura foaie → eroare clară, cu diagnosticul
    await expect(parseDevizModificare(fisierAA([{ nume: 'AA', rows }]))).rejects.toThrow(/niciun articol de deviz .*antet de deviz nesigur \(rândul 2: nicio coloană „Cantitate” fără calificativ/)
    // și fără „Observatii”, doar „contract” deasupra → la fel (blocul îl cuprinde); „contract | … | Revizia | 1” (cu cifră) → context exclus, diagnosticat
    const c = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'AA', rows: [['', '', '', '', 'contract'], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000]] }]))
    expect(c.linii.map(l => l.cod)).toEqual(['TSA01A1'])
    const rev = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'AA', rows: [['', '', '', '', 'contract', '', '', '', 'Revizia', 1], ['Nr', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Pret unitar', 'Valoare'], [1, 'B1', 'Lucrare B', 'm', 100, 10, 1000]] }]))
    expect(rev.linii.map(l => l.cod)).toEqual(['TSA01A1'])
    expect(faraFCV(rev)[0].motiv).toBe('foaie nerecunoscută: antet de deviz nesigur (rândul 2: context de antet exclus [„contract” (rândul 1, cu cifre)]) — liniile foii LIPSESC din rezultat')
    expect(rev.contabilizare.AA).toEqual({ ignorat: 3 })
  })
  it('2 (AA Excel, căile legitime): antetul simplu, antetul pe două rânduri cu grup „Cantitate” + „contract | AA” (plain unic), coloana UM „U.M.”, rândul de indici = index (nu articol cu cod „1”), „Cantitate contract | Cantitate” → cantitatea AA = coloana fără calificativ', async () => {
    const simplu = await parseDevizModificare(fisierAA([{ nume: 'D', rows: [['Deviz act adițional nr. 3'], ['Nr. crt.', 'Simbol', 'Denumire lucrare', 'U.M.', 'Cantitate'], [0, 1, 2, 3, 4], [1, 'TSA01A1', 'Săpătură', 'mc', -3], [2, 'TSD01B1', 'Umplutură', 'mc', 7]] }]))
    expect(simplu.linii.map(l => [l.cod, l.um, l.cantitate, Number(l.nr) + 1])).toEqual([['TSA01A1', 'mc', -3, 4], ['TSD01B1', 'mc', 7, 5]])
    expect(faraFCV(simplu)).toEqual([])
    expect(simplu.contabilizare.D).toEqual({ titlu: 1, antet: 1, index: 1, articol: 2 })
    const grup = await parseDevizModificare(fisierAA([{ nume: 'D', rows: [['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate', ''], ['', '', '', '', 'contract', 'AA'], [1, 'TSA01A1', 'Săpătură', 'mc', 10, -3]] }]))
    expect(grup.linii.map(l => [l.cod, l.cantitate])).toEqual([['TSA01A1', -3]]) // coloana „Cantitate AA”, nu „Cantitate contract”
    expect(faraFCV(grup)).toEqual([])
    expect(grup.contabilizare.D).toEqual({ antet: 2, articol: 1 })
    const doua = await parseDevizModificare(fisierAA([{ nume: 'D', rows: [['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate contract', 'Cantitate'], [1, 'TSA01A1', 'Săpătură', 'mc', 10, -3]] }]))
    expect(doua.linii.map(l => [l.cod, l.cantitate])).toEqual([['TSA01A1', -3]])
    // două coloane „Cantitate” fără calificativ → ambiguu → refuzat cu diagnostic
    const amb = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'D', rows: [['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate', 'Cantitate'], [1, 'TSD01B1', 'x', 'mc', 1, 2]] }]))
    expect(amb.linii.map(l => l.cod)).toEqual(['TSA01A1'])
    expect(faraFCV(amb)[0].motiv).toMatch(/^foaie nerecunoscută: antet de deviz nesigur \(rândul 1: două coloane „Cantitate” fără calificativ\)/)
    // două coloane „UM” → ambiguu → refuzat cu diagnostic (nu se ia prima)
    const um2 = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'D', rows: [['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate', 'UM'], [1, 'TSD01B1', 'x', 'mc', 1, 'buc']] }]))
    expect(um2.linii.map(l => l.cod)).toEqual(['TSA01A1'])
    expect(faraFCV(um2)[0].motiv).toBe('foaie nerecunoscută: antet de deviz nesigur (rândul 1: coloana UM lipsește sau e dublă) — liniile foii LIPSESC din rezultat')
    // „Cantitate | Cantitate cumulat” FĂRĂ calificativ deasupra: e antet de situație de lucrări, nu de deviz → refuzat (care din ele e cantitatea AA-ului?)
    const sit = await parseDevizModificare(fisierAA([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'D', rows: [ANTET_CUM, [1, 'TSD01B1', 'x', 'mc', 1, 2, 3, 3]] }]))
    expect(sit.linii.map(l => l.cod)).toEqual(['TSA01A1'])
    expect(faraFCV(sit)[0].motiv).toBe('foaie nerecunoscută: antet de deviz nesigur (rândul 1: coloane de situație de lucrări, nu de deviz: cantitate_cumulat) — liniile foii LIPSESC din rezultat')
    // calea catalogului (implicit) pe fișierul lui Jak rămâne ca pe main (prima coloană „cantitat”, UM prin includes('um') → „denumire”): așteptare scrisă de mână după regula veche
    const vechi = await parseDeviz(fisierAA([{ nume: 'AA', rows: [['', '', '', '', 'contract', '', '', '', 'Observatii'], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000]] }]))
    expect(vechi.map(a => [a.cod, a.um, a.cantitate])).toEqual([['B1', 'Lucrare B', 100]])
  })
  it('2 (situație): „contract | … | Revizia | 1” deasupra lui „Cantitate | Cantitate cumulat” → context de antet exclus → foaia e nerecunoscută și raportată; NU cantitate_perioada: 100, nu meta_document (înainte: 100, complet: true)', async () => {
    const rows = [['', '', '', '', 'contract', '', '', '', 'Revizia', 1], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000], ['TOTAL', '', '', '', '', '', '', 1000]]
    const a = recunoasteAntet(rows)
    expect(a.ok).toBe(false)
    expect(a.cel_mai_bun).toEqual({ rand: 2, gasite: ['nr', 'cod', 'denumire', 'um', 'pret_unitar', 'cantitate_perioada', 'cantitate_cumulat', 'valoare'], lipsesc: [], ambigue: [], neconsumate: [], context_exclus: { rand: 1, celule: ['contract'] } })
    await expect(parseSituatieExcel(xlsx([{ nume: 'S', rows }]))).rejects.toThrow(/format nerecunoscut:.*rândul 2: găsite \[.*\], lipsesc \[\], context de antet exclus \[„contract” \(rândul 1, cu cifre\)\]/)
    const r = await parseSituatieExcel(xlsx([valida, { nume: 'Detaliu', rows }]))
    expect(r.linii.map(l => [l.cod, l.cantitate_perioada])).toEqual([['A1', 2]])
    expect(r.complet).toBe(false)
    // problema de foaie, rândul „contract | Revizia | 1” (candidat: un număr + text, ignorat pe foaia sărită — nu meta_document), B1, TOTAL-ul foii sărite (1000 ≠ 20)
    expect(r.probleme.map(p => [p.foaie, p.rand, p.clasa ?? (p.diferenta != null ? 'reconciliere' : 'foaie')])).toEqual([['Detaliu', 2, 'foaie'], ['Detaliu', 1, 'ignorat'], ['Detaliu', 3, 'ignorat'], ['Detaliu', 4, 'reconciliere']])
    expect(r.probleme[0].motiv).toMatch(/context de antet exclus \[„contract” \(rândul 1, cu cifre\)\]/)
    expect(r.contabilizare.Detaliu).toEqual({ ignorat: 3, total: 1 }) // rândul de calificativ, antetul, B1 = ignorat; TOTAL = total
    // fără calificativ, „Revizia | 1” singur deasupra → nu e context (nicio celulă de antet) → antetul e recunoscut, rândul e candidat → problemă
    const fara = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['', '', '', '', '', '', '', '', 'Revizia', 1], ANTET_CUM, [1, 'B1', 'Lucrare B', 'm', 100, 20, 10, 1000], ['TOTAL', '', '', '', '', '', '', 1000]] }]))
    expect(fara.linii.map(l => [l.cod, l.cantitate_perioada])).toEqual([['B1', 100]])
    expect(fara.probleme.map(p => [p.rand, p.clasa])).toEqual([[1, 'ignorat']])
  })

  // 3. refuzul fals: antetul contractual realist deasupra tabelului
  it('3 (situație): „Contract nr. | C123/2025 | Data | 15.10.2026” deasupra unui tabel valid → meta_document, complet: true (înainte: „C123/2025” era luat drept cod de articol → problemă)', async () => {
    const JAK3 = ['Contract nr.', 'C123/2025', 'Data', '15.10.2026']
    const r = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [JAK3, ANTET_OK, A1_20, TOTAL_20] }]))
    expect(r.linii.map(l => [l.cod, l.rand])).toEqual([['A1', 3]])
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.contabilizare.S).toEqual({ meta_document: 1, antet: 1, articol: 1, total: 1 })
    // antete realiste, fiecare direct deasupra antetului de coloane (fără rând gol) și pe copertă → toate meta_document, complet: true
    // (antetul documentului — nr / lună / an — rămâne euristica veche a lui antetDinTitluri: primul an 20xx din titluri; rândul situației stă primul)
    const antete = [['Situația nr.', 7, 'Luna', 'octombrie', 'An', 2026], ['Contract nr.', 'C123/2025', 'Data', '15.10.2026'], ['Contractul:', 'TSA01/2025'], ['Beneficiar:', 'X SRL', 'CUI', 'RO12345678'], ['Obiectiv:', 'Conductă DN500'], ['Luna', 'octombrie', 2026], ['Pagina', 1, 'din', 3], ['Data:', '15.10.2026']]
    const t = await parseSituatieExcel(xlsx([{ nume: 'Coperta', rows: antete }, { nume: 'S', rows: [...antete, ANTET_OK, A1_20, TOTAL_20] }]))
    expect(t.probleme).toEqual([])
    expect(t.complet).toBe(true)
    expect(t.contabilizare).toEqual({ Coperta: { meta_document: 8 }, S: { meta_document: 8, antet: 1, articol: 1, total: 1 } })
    expect(t.antet).toEqual({ nr_situatie: '7', luna: 10, an: 2026 })
    // negativ: aceleași etichete pe un rând cu UM + cantitate + preț / valoare → articol candidat → problemă (și reconcilierea: TOTAL 50 ≠ 20)
    const n = await parseSituatieExcel(xlsx([{ nume: 'S', rows: [['Contract nr.', 'C123/2025', 'm', 3, 10, 30], ANTET_OK, A1_20, ['TOTAL', '', '', '', '', '', 50]] }]))
    expect(n.complet).toBe(false)
    expect(n.probleme.map(p => [p.rand, p.clasa ?? 'reconciliere'])).toEqual([[1, 'ignorat'], [4, 'reconciliere']])
    expect(n.contabilizare.S).toEqual({ ignorat: 1, antet: 1, articol: 1, total: 1 })
  })
  it('3 (AA Excel): același antet contractual deasupra devizului → meta_document, nicio problemă în afară de „fără control pe valoare”; negativ: pe un rând cu UM + cantitate → problemă', async () => {
    const antete = [['Contract nr.', 'C123/2025', 'Data', '15.10.2026'], ['Beneficiar:', 'X SRL', 'CUI', 'RO12345678'], ['Situația nr.', 7, 'Luna', 'octombrie', 'An', 2026]]
    const r = await parseDevizModificare(fisierAA([{ nume: 'D', rows: [...antete, ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }]))
    expect(r.linii.map(l => [l.cod, Number(l.nr) + 1])).toEqual([['TSA01A1', 5]])
    expect(faraFCV(r)).toEqual([])
    expect(r.contabilizare.D).toEqual({ meta_document: 3, antet: 1, articol: 1 })
    const n = await parseDevizModificare(fisierAA([{ nume: 'D', rows: [['Contract nr.', 'C123/2025', 'm', 3, 10, 30], ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }]))
    expect(faraFCV(n).map(p => [p.rand, p.clasa])).toEqual([[1, 'ignorat']])
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
  'Total deviz 0101 = 1310.00 lei', // (r7) totalul devizului = 100 − 40 + 1250: controlul reconcilierii
]

describe('parseDevizModificare (AA / NR / NCS) — refolosește parseDeviz și păstrează semnul', () => {
  it('cantitățile negative rămân negative; conversia UM a catalogului (HM → m × 100) rămâne cea existentă; totalul devizului se reconciliază', async () => {
    const r = await parseDevizModificare(await docx(F3))
    expect(r.linii.map(l => [l.cod, l.um, l.cantitate, l.valoare])).toEqual([['TSA01A1', 'mc', 10, 100], ['TSD01B1', 'mc', -5, -40], ['RPCU01', 'm', 250, 1250]])
    expect(r.linii[0]).toMatchObject({ obiect_cod: '01', deviz_cod: '0101', nr: '001', denumire: 'SAPATURA MANUALA' })
    expect(r.negative).toBe(1)
    expect(r.probleme).toEqual([])
    expect(r.complet).toBe(true)
    expect(r.reconciliere).toMatchObject({ ok: true, suma: 1310, toleranta: 0.03, controale: [expect.objectContaining({ paragraf: 12, eticheta: 'Total deviz 0101', valoare: 1310, sursa: 'deviz', scop: 'document' })] })
    // totalul devizului greșit (1300) → problemă cu diferența; fără el → „fără total de control”; ambiguu („2.000”) → neinterpretabil
    const gresit = await parseDevizModificare(await docx([...F3.slice(0, -1), 'TOTAL DEVIZ 1300.00']))
    expect(gresit.complet).toBe(false)
    expect(gresit.probleme).toEqual([{ paragraf: 12, diferenta: -10, motiv: 'totalul de control 1300 lei („TOTAL DEVIZ”, paragraful 12) ≠ suma articolelor citite 1310 lei (diferență -10 lei) — un articol lipsește sau e în plus, ori totalul tipărit e greșit; toleranță 0.03 lei' }])
    const fara = await parseDevizModificare(await docx(F3.slice(0, -1)))
    expect(fara.complet).toBe(false)
    expect(fara.probleme.map(p => p.motiv)).toEqual(['fără total de control: documentul nu are niciun rând TOTAL recunoscut (pe foile de detaliu sau pe o recapitulație) — suma articolelor citite (1310 lei) nu poate fi verificată'])
    const ambiguu = await parseDevizModificare(await docx([...F3.slice(0, -1), 'Total deviz 2.000']))
    expect(ambiguu.probleme.map(p => p.motiv)).toEqual(['total de control neinterpretabil („Total deviz”, paragraful 12)'])
    // mai multe totaluri (pe devize + general): ULTIMUL e controlul; „Total=” orfan nu e total de deviz
    const multe = await parseDevizModificare(await docx([...F3.slice(0, -1), 'Total deviz 0101 1310.00', 'Deviz oferta 0102 ALT DEVIZ', '004 IZF01 MP 4.000', 'IZOLATIE', 'Total= 40.00', 'Total deviz 0102 40.00', 'TOTAL GENERAL 1350.00']))
    expect(multe.complet).toBe(true)
    expect(multe.reconciliere.controale.map(c => [c.paragraf, c.valoare, c.scop])).toEqual([[18, 1350, 'document']])
    // implicit (catalog) linia „Total deviz …” nu schimbă nimic: rezultat array, linia negativă sărită ca pe main (regula veche), fără `incomplet`
    const implicit = await parseDeviz(await docx(F3))
    expect(implicit.map(a => [a.cod, a.valoare])).toEqual([['TSA01A1', 100], ['RPCU01', 1250]])
    expect(implicit.every(a => !('incomplet' in a) && !('totaluri' in a))).toBe(true)
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
  // review #1165 r2 P1, aceeași clasă pe calea Excel: antetul catalogului se caută doar în primele 30 de rânduri (regula veche, pe main);
  // parseDevizModificare cere explicit { antetOriunde: true } și citește devizul cu 35 de note deasupra. Așteptarea pentru calea implicită
  // e scrisă de mână după regula veche (30 de rânduri → niciun articol), nu citită din cod (L25).
  it('Excel cu antetul după rândul 30: parseDevizModificare îl citește (antetOriunde); parseDeviz implicit (catalog) rămâne ca pe main', async () => {
    const note = Array.from({ length: 35 }, (_, i) => [`Notă ${i + 1}`])
    const buf = xlsx([{ nume: 'Deviz AA', rows: [...note, ['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate'], [1, 'TSA01A1', 'Săpătură', 'mc', -3], [2, 'TSD01B1', 'Umplutură', 'mc', 7]] }])
    const r = await parseDevizModificare({ name: 'aa.xlsx', arrayBuffer: async () => buf })
    expect(r.linii.map(l => [l.cod, l.cantitate])).toEqual([['TSA01A1', -3], ['TSD01B1', 7]])
    expect(r.negative).toBe(1)
    expect(await parseDeviz({ name: 'aa.xlsx', arrayBuffer: async () => buf })).toEqual([])
    expect(await parseDeviz({ name: 'aa.xlsx', arrayBuffer: async () => buf }, { cuSemn: true })).toEqual([]) // cuSemn singur nu schimbă calea Excel
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
    expect(arts.every(a => !('incomplet' in a))).toBe(true)
  })
})

// ── review #1165 r3 (L12): fereastra DOCX de 5 paragrafe pentru „Total=” — DOAR calea cuSemn o depășește; lipsa = diagnostic, nu null tăcut.
// Așteptările pentru calea implicită sunt scrise de mână după regula veche a catalogului (5 paragrafe după linia articolului; un
// „Total=” mai jos nu e văzut → valoare null; un „Total=” al articolului următor, aflat în fereastră, e luat drept al curentului), nu
// citite din cod (L25). Catalogul nu se schimbă; calea nouă nu moștenește niciuna din cele două tăceri.
describe('articoleDinParagrafe — „Total=” dincolo de fereastra de 5 paragrafe (review #1165 r3)', () => {
  // articolul la indexul 0; paragrafele 1–5 sunt fereastra istorică; „Total=” e al 6-lea paragraf de după articol
  const TOTAL_AL_6 = ['001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', 'MATERIAL UNU', 'MATERIAL DOI', 'MATERIAL TREI', 'MATERIAL PATRU', 'Total= 100.00']
  const DEN = 'SAPATURA MANUALA MATERIAL UNU MATERIAL DOI MATERIAL TREI MATERIAL PATRU'
  it('calea implicită (catalog): regula veche — valoare null, fără niciun marcaj (identic cu main)', () => {
    const arts = articoleDinParagrafe(TOTAL_AL_6)
    expect(arts).toEqual([{ obiect_cod: '', obiect_nume: '', deviz_cod: '', deviz_nume: '', nr: '001', cod: 'TSA01A1', denumire: DEN, um: 'mc', cantitate: 10, valoare: null }])
    expect(articoleDinParagrafe(TOTAL_AL_6, { cuSemn: false })).toEqual(arts)
  })
  it('calea cuSemn: „Total=” din al 6-lea paragraf e găsit (100), articolul nu e incomplet; denumirea rămâne cea din fereastră', () => {
    const arts = articoleDinParagrafe(TOTAL_AL_6, { cuSemn: true })
    expect(arts).toEqual([{ obiect_cod: '', obiect_nume: '', deviz_cod: '', deviz_nume: '', nr: '001', cod: 'TSA01A1', denumire: DEN, um: 'mc', cantitate: 10, valoare: 100 }])
    // și mult mai jos (20 de paragrafe de resurse), cu semn
    const departe = ['001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', ...Array.from({ length: 20 }, (_, i) => `RESURSA ${i + 1} 1.00 2.00`), 'Total= -75.50']
    expect(articoleDinParagrafe(departe, { cuSemn: true }).map(a => [a.valoare, a.incomplet])).toEqual([[-75.5, undefined]])
    expect(articoleDinParagrafe(departe).map(a => a.valoare)).toEqual([null]) // implicit: regula veche
  })
  it('calea cuSemn: fără „Total=” până la articolul următor → valoare null + `incomplet` cu motiv; „Total=” al articolului următor NU e luat', () => {
    const FARA_TOTAL = ['Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA', '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', '002 TSD01B1 MC 5.000', 'UMPLUTURA COMPACTATA', 'Total= 40.00']
    const cu = articoleDinParagrafe(FARA_TOTAL, { cuSemn: true })
    expect(cu.map(a => [a.cod, a.valoare, a.incomplet])).toEqual([
      ['TSA01A1', null, 'fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)'],
      ['TSD01B1', 40, undefined],
    ])
    expect(cu[0].denumire).toBe('SAPATURA MANUALA') // linia articolului următor nu intră în denumire pe calea nouă
    // regula veche (implicit): fereastra trece peste linia articolului următor și ia „Total= 40.00” drept al primului — tăcut (comportament main, neschimbat)
    const implicit = articoleDinParagrafe(FARA_TOTAL)
    expect(implicit.map(a => [a.cod, a.valoare])).toEqual([['TSA01A1', 40], ['TSD01B1', 40]])
    expect(implicit[0].denumire).toBe('SAPATURA MANUALA 002 TSD01B1 MC UMPLUTURA COMPACTATA')
    expect(implicit.every(a => !('incomplet' in a))).toBe(true)
  })
  it('calea cuSemn: oprire și la „Deviz oferta” / „Obiectul:” / sfârșit de document; „Total=” cu valoare ne-număr = incomplet cu alt motiv', () => {
    const paras = ['001 TSA01A1 MC 1.000', 'SAPATURA', 'Deviz oferta 0102 ALT DEVIZ', '002 TSD01B1 MC 2.000', 'UMPLUTURA', 'Obiectul: 02 1 TRONSON B', '003 RPCU01 HM 3.000', 'MONTAJ', 'Total= ,', '004 IZF01 MP 4.000', 'IZOLATIE']
    const cu = articoleDinParagrafe(paras, { cuSemn: true })
    expect(cu.map(a => [a.cod, a.deviz_cod, a.obiect_cod, a.valoare, a.incomplet])).toEqual([
      ['TSA01A1', '', '', null, 'fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)'],
      ['TSD01B1', '0102', '', null, 'fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)'],
      ['RPCU01', '0102', '02', null, 'valoarea de după „Total=” nu e număr'],
      ['IZF01', '0102', '02', null, 'fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)'],
    ])
  })
  it('parseDevizModificare: articolul fără „Total=” rămâne în linii (valoare null, incomplet) ȘI intră în probleme; cu „Total=” la al 6-lea paragraf nu e problemă', async () => {
    const r = await parseDevizModificare(await docx(['Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA', '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', '002 TSD01B1 MC -5.000', 'UMPLUTURA COMPACTATA', 'Total= -40.00']))
    expect(r.linii.map(l => [l.cod, l.cantitate, l.valoare, l.incomplet])).toEqual([['TSA01A1', 10, null, 'fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)'], ['TSD01B1', -5, -40, undefined]])
    expect(r.negative).toBe(1)
    expect(r.probleme).toEqual([
      { poz: 1, cod: 'TSA01A1', denumire: 'SAPATURA MANUALA', motiv: 'valoare lipsă: fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)' },
      { motiv: expect.stringMatching(/^fără total de control: documentul nu are niciun rând TOTAL recunoscut/) }, // (r7) niciun „Total deviz”
    ])
    const ok = await parseDevizModificare(await docx([...TOTAL_AL_6, 'Total general 100.00']))
    expect(ok.linii.map(l => [l.cod, l.valoare, l.incomplet])).toEqual([['TSA01A1', 100, undefined]])
    expect(ok.probleme).toEqual([])
    expect(ok.complet).toBe(true)
  })
})

// ── review #1165 r4 P1-2 → r5: ACELAȘI invariant de contabilizare pe calea Excel a lui parseDevizModificare (devizParser.parseDevizExcel,
// sub opțiunea explicită { contabilizare: true }); calea catalogului (fără opțiune) rămâne identică cu main — vezi și paritatea din lanț.
describe('parseDevizModificare — invariantul de contabilizare pe Excel AA (review #1165 r4 P1-2, r5)', () => {
  const ANTET_AA = ['Nr', 'Simbol', 'Denumire', 'UM', 'Cantitate']
  const fisier = foi => ({ name: 'aa.xlsx', arrayBuffer: async () => xlsx(foi) })
  it('reproducerea r4: foaie validă (TSA01A1, 2) + foaie „Detaliu” cu [1, TSD01B1, Umplutura, mc, 3] FĂRĂ antet → problemă cu foaia și rândul, complet = false', async () => {
    const r = await parseDevizModificare(fisier([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'Detaliu', rows: [[1, 'TSD01B1', 'Umplutura', 'mc', 3]] }]))
    expect(r.linii.map(l => [l.obiect_nume, l.cod, l.cantitate])).toEqual([['Deviz', 'TSA01A1', 2]])
    expect(r.negative).toBe(0)
    expect(faraFCV(r)).toEqual([{ foaie: 'Detaliu', rand: 1, clasa: 'ignorat', candidat: 'cod „TSD01B1”, UM „mc”, 2 numere', motiv: 'rând de articol necontabilizat: arată a articol (cod „TSD01B1”, UM „mc”, 2 numere), dar a fost clasificat „ignorat” (foaie fără antet de deviz (Cantitate + UM)) — LIPSEȘTE din rezultat' }])
    expect(r.contabilizare).toEqual({ Deviz: { antet: 1, articol: 1 }, Detaliu: { ignorat: 1 } })
    // calea catalogului pe ACELAȘI fișier: foaia fără antet e sărită tăcut, ca pe main (așteptare scrisă de mână după regula veche, L25)
    const vechi = await parseDeviz(fisier([{ nume: 'Deviz', rows: [ANTET_AA, [1, 'TSA01A1', 'Săpătură', 'mc', 2]] }, { nume: 'Detaliu', rows: [[1, 'TSD01B1', 'Umplutura', 'mc', 3]] }]))
    expect(Array.isArray(vechi)).toBe(true)
    expect(vechi.map(a => [a.obiect_nume, a.cod, a.cantitate])).toEqual([['Deviz', 'TSA01A1', 2]])
  })
  it('rândurile cu conținut sărite de regula veche (cantitate / UM / denumire lipsă) sunt probleme cu rândul; textul fără cifre e ignorat cu motiv; „Total” e total; articolele de deasupra antetului sunt probleme', async () => {
    const rows = [
      ['Deviz act adițional nr. 3'], // titlu
      ['', 'TSZ99', 'Articol rătăcit deasupra antetului', 'mc', 7], // deasupra antetului → problemă
      [], ANTET_AA,
      [1, 'TSA01A1', 'Săpătură', 'mc', 2],
      [2, 'TSD01B1', 'Umplutură fără cantitate', 'mc', ''], // cantitate lipsă → problemă
      [3, 'TSC02', 'Transport fără UM', '', 4], // UM lipsă → problemă
      [4, '', '', 'buc', 5], // denumire lipsă → problemă
      [5, 'TSA02', 'Text numeric cu plus și RO', 'm', '+1.234,5'], // numar (parseNumar) → 1234.5
      [6, 'TSA03', 'Ambiguu', 'm', '2.000'], // mii sau zecimale? → problemă
      [7, 'TSA04', 'Neinterpretabil', 'm', 'abc'], // → problemă
      ['', '', 'Notă fără cifre'], // ignorat
      ['', '', 'Total deviz', '', '', 1234], // total dovedit: fără cod, fără UM, fără cantitate (valoarea e în altă coloană)
      ['', 'OS', 'Organizare de șantier', 'lei', 1], // os (UM necunoscută listei, dar rândul e articol pentru deviz)
      ['', '', 'Total cap. 1', '', 5], // „Total” cu CANTITATE (r6): nu e total dovedit → pipeline → problemă (UM lipsă), nu total tăcut
    ]
    const r = await parseDevizModificare(fisier([{ nume: 'AA3', rows }]))
    expect(r.linii.map(l => [l.cod, l.cantitate, Number(l.nr) + 1])).toEqual([['TSA01A1', 2, 5], ['TSA02', 1234.5, 9], ['OS', 1, 14]])
    expect(faraFCV(r).map(p => [p.rand, p.motiv])).toEqual([
      [6, 'rând cu conținut sărit: lipsesc cantitate'],
      [7, 'rând cu conținut sărit: lipsesc UM'],
      [8, 'rând cu conținut sărit: lipsesc denumire'],
      [10, 'cantitate ambiguă (mii sau zecimale?) „2.000”'],
      [11, 'cantitate neinterpretabilă „abc”'],
      [15, 'rând cu conținut sărit: lipsesc UM'],
      [2, 'rând de articol necontabilizat: arată a articol (cod „TSZ99”, UM „mc”, 1 număr), dar a fost clasificat „ignorat” (deasupra antetului, cu cifre) — LIPSEȘTE din rezultat'],
    ])
    expect(r.contabilizare).toEqual({ AA3: { titlu: 1, ignorat: 2, antet: 1, articol: 2, os: 1, problema: 6, total: 1 } })
  })
  it('un fișier cu probleme dar fără niciun articol = eroare care spune problemele, nu listă goală', async () => {
    await expect(parseDevizModificare(fisier([{ nume: 'Detaliu', rows: [[1, 'TSD01B1', 'Umplutura', 'mc', 3]] }])))
      .rejects.toThrow(/^format nerecunoscut: niciun articol de deviz în „aa\.xlsx” \(1 rând problematic; primul: rând de articol necontabilizat: arată a articol \(cod „TSD01B1”, UM „mc”, 2 numere\)/)
  })
  it('.docx sub contabilizare: linia de articol (ART_RE) fără UM cunoscută + cantitate e problemă, nu „resursă” tăcută; implicit (catalog) se sare ca pe main', async () => {
    const paras = ['Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA', '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', 'Total= 100.00', '002 TSE05A1 SET 2.000', 'ARMATURA', 'Total= 50.00', '003 TSA09 ORA 1.500', 'EPUIZARE APA', 'Total= 30.00']
    const r = await parseDevizModificare(await docx(paras))
    expect(r.linii.map(l => [l.cod, l.cantitate, l.valoare])).toEqual([['TSA01A1', 10, 100]])
    expect(r.complet).toBe(false)
    expect(r.probleme).toEqual([
      { paragraf: 6, nr: '002', cod: 'TSE05A1', motiv: 'linie de articol fără UM cunoscută + cantitate (sărită): „SET 2.000”' },
      { paragraf: 9, nr: '003', cod: 'TSA09', motiv: 'linie de articol fără UM cunoscută + cantitate (sărită): „ORA 1.500”' },
      { motiv: expect.stringMatching(/^fără total de control/) }, // (r7) „Total= 50.00” / „Total= 30.00” orfane nu sunt totaluri de deviz
    ])
    expect(articoleDinParagrafe(paras).map(a => a.cod)).toEqual(['TSA01A1']) // regula veche: sărite tăcut
    expect(articoleDinParagrafe(paras, { cuSemn: true }).map(a => a.cod)).toEqual(['TSA01A1']) // cuSemn singur nu schimbă forma rezultatului
    const c = articoleDinParagrafe(paras, { contabilizare: true })
    expect(c.articole.map(a => a.cod)).toEqual(['TSA01A1'])
    expect(c.probleme).toHaveLength(2)
  })
})
