import { describe, it, expect } from 'vitest'
import { zileSesiune, ziImplicita, filtreazaSesiune, rezumatSesiune, randPrezenta, agregaCentralizator, agregaTronsoane, intervalZiBucuresti, poateMarcaPrezenta } from './sesiune.js'

it.each([
  ['2026-11-02', '2026-11-01T22:00:00.000Z', '2026-11-02T22:00:00.000Z'],
  ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T21:00:00.000Z'],
  ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z'],
])('zi locala inclusiv DST: %s', (zi, de, pana) => expect(intervalZiBucuresti(zi)).toEqual({ de, pana }))

describe('zile sesiune', () => {
  it.each([
    [null, []],
    [{}, []],
    [{ sesiune_zi1: '2026-11-05', sesiune_zi2: null, sesiune_zi3: '2026-11-03', program_zi3: '09-12' },
      [{ nr: 3, data: '2026-11-03', program: '09-12' }, { nr: 1, data: '2026-11-05', program: '' }]],
  ])('zile cu goluri: %j', (uat, rezultat) => expect(zileSesiune(uat)).toEqual(rezultat))
  it.each([
    ['2026-11-01', '2026-11-03'], ['2026-11-03', '2026-11-03'],
    ['2026-11-04', '2026-11-05'], ['2026-11-05', '2026-11-05'], ['2026-11-09', '2026-11-05'],
  ])('zi implicita pentru %s', (azi, rezultat) => {
    expect(ziImplicita([{ data: '2026-11-05' }, { data: '2026-11-03' }], azi)).toBe(rezultat)
  })
  it('fara sesiune nu inventeaza zi', () => expect(ziImplicita([], '2026-11-03')).toBe(''))
})

const randuri = [
  { detinator_id: 'd3', id_parcela: 'P2', nume: 'ZAMFIR', pv_stare: 'generat' },
  { detinator_id: 'd2', id_parcela: 'P1', nume: '\u0218TEF\u0102NESCU', pv_stare: 'semnat' },
  { detinator_id: 'd1', id_parcela: 'P1', nume: 'ANA', pv_stare: null },
  { detinator_id: 'd4', id_parcela: 'P3', nume: 'ION', pv_stare: 'trimis_spre_semnare' },
]
describe('lista si prezenta', () => {
  it.each([
    [{ cauta: 'Stefanescu' }, ['d2']],
    [{ cauta: '\u0219tef\u0103nescu' }, ['d2']],
    [{ cauta: 'p1' }, ['d1', 'd2']],
    [{ cauta: 'ZAMFIR' }, ['d3']],
    [{ cauta: 'absent' }, []],
    [{ doarNesemnate: true }, ['d1', 'd3', 'd4']],
    [{ cauta: 'Stefanescu', doarNesemnate: true }, []],
    [{}, ['d1', 'd2', 'd3', 'd4']],
  ])('filtrare %j', (filtre, ids) => {
    const copie = JSON.stringify(randuri)
    expect(filtreazaSesiune(randuri, filtre).map(r => r.detinator_id)).toEqual(ids)
    expect(JSON.stringify(randuri)).toBe(copie)
  })
  it('rezumatul distinge ciorna de lipsa PV si ignora prezentele din afara listei', () => {
    expect(rezumatSesiune(randuri, new Set(['d1', 'd4', 'altul']))).toEqual({ total: 4, semnate: 1, trimise: 1, fara_pv: 1, prezenti_azi: 2 })
    expect(rezumatSesiune([])).toEqual({ total: 0, semnate: 0, trimise: 0, fara_pv: 0, prezenti_azi: 0 })
  })
  it('rand prezenta: ziua aleasa si data inregistrarii pot fi diferite', () => {
    expect(randPrezenta({ detinatorId: 'd1', zi: '2026-11-05', acum: '2026-11-03T08:15:00.000Z' })).toEqual({
      detinator_id: 'd1', canal: 'sesiune', optiune: 'particip', zi_sesiune_aleasa: '2026-11-05', data: '2026-11-03T08:15:00.000Z',
    })
  })
})

describe('centralizatoare', () => {
  it('total ponderat, nu suma total_uat repetat sau media procentelor', () => {
    const r = agregaCentralizator([
      { uat_id: 'a', uat3: 'AAA', uat_nume: 'Alfa', stare: 'PV_A_SEMNAT', numar: 1, total_uat: 3, procent_inchise: 33.3 },
      { uat_id: 'a', uat3: 'AAA', uat_nume: 'Alfa', stare: 'DE_CONVOCAT', numar: 2, total_uat: 3, procent_inchise: 33.3 },
      { uat_id: 'b', uat3: 'BBB', uat_nume: 'Beta', stare: 'PV_B_CONSTATARE', numar: 1, total_uat: 1, procent_inchise: 100 },
      { uat_id: 'c', uat3: 'CCC', uat_nume: 'Gol', stare: null, numar: 0, total_uat: 0 },
    ])
    expect(r).toEqual([
      { uat3: 'AAA', uat_nume: 'Alfa', total: 3, inchise: 1, procent: 33.3, pe_stare: { PV_A_SEMNAT: 1, DE_CONVOCAT: 2 } },
      { uat3: 'BBB', uat_nume: 'Beta', total: 1, inchise: 1, procent: 100, pe_stare: { PV_B_CONSTATARE: 1 } },
      { uat3: 'CCC', uat_nume: 'Gol', total: 0, inchise: 0, procent: 0, pe_stare: {} },
      { uat3: 'TOTAL', uat_nume: 'TOTAL', total: 4, inchise: 2, procent: 50, pe_stare: { PV_A_SEMNAT: 1, DE_CONVOCAT: 2, PV_B_CONSTATARE: 1 } },
    ])
  })
  it('sursa fara randuri produce doar TOTAL zero', () => {
    expect(agregaCentralizator([])).toEqual([{ uat3: 'TOTAL', uat_nume: 'TOTAL', total: 0, inchise: 0, procent: 0, pe_stare: {} }])
  })
  it.each([null, undefined, 'invalid', -1, Infinity])('numarul necunoscut nu devine zero: %s', numar => {
    expect(() => agregaCentralizator([{ uat3: 'AAA', numar }])).toThrow('numar invalid')
  })
  it('tronsoane: A este deja semnat in vedere; obiectiile sunt independente de PV', () => {
    expect(agregaTronsoane([
      { tronson: 2, tip_pv: null, obiectii_deschise: true },
      { tronson: 1, tip_pv: 'A', obiectii_deschise: false },
      { tronson: 1, tip_pv: 'B', obiectii_deschise: true },
      { tronson: 1, tip_pv: null, obiectii_deschise: false },
    ])).toEqual([
      { tronson: 1, parcele: 3, pv_a_semnat: 1, pv_b: 1, fara_pv: 1, obiectii_deschise: 1 },
      { tronson: 2, parcele: 1, pv_a_semnat: 0, pv_b: 0, fara_pv: 1, obiectii_deschise: 1 },
    ])
    expect(agregaTronsoane([])).toEqual([])
  })
})

// Test weekend 06.11.2026: prezența doar în ziua sesiunii
describe('poateMarcaPrezenta', () => {
  const zile = [{ nr: 1, data: '2026-11-17', program: '09-16' }, { nr: 2, data: '2026-11-18', program: '09-16' }]
  it.each([
    ['2026-11-17', '2026-11-06', false],   // cazul din test: ziua 1 aleasă, azi 06.11
    ['2026-11-17', '2026-11-17', true],
    ['2026-11-18', '2026-11-17', false],   // altă zi de sesiune decât azi
    ['2026-11-19', '2026-11-19', false],   // azi, dar nu e zi de sesiune
    ['', '2026-11-17', false],
  ])('zi %s, azi %s → %s', (zi, azi, ok) => expect(poateMarcaPrezenta(zile, zi, azi)).toBe(ok))
  it('fără zile de sesiune → nu', () => expect(poateMarcaPrezenta([], '2026-11-17', '2026-11-17')).toBe(false))
})
