import { describe, expect, it } from 'vitest'
import { defaultMonths, formatMoney, formatMonth, groupCosts, monthRange, USD_TO_RON } from './costAi.js'

const row = (extra = {}) => ({ luna: '2026-10-01', modul: 'Ofertare', tip_tinta: 'licitatie', tinta_id: 7, tinta_nume: 'SCN7 - Conductă', model: 'opus', apeluri: 1, cost_usd: '0.125', rezervat_in_curs_usd: 0, ...extra })

describe('Cost AI — interval și formatare', () => {
  it('include luna curentă și precedentele două, inclusiv peste an', () => {
    expect(defaultMonths(new Date('2026-01-15T10:00:00Z'))).toEqual({ de: '2025-11', pana: '2026-01' })
  })
  it('determină luna în București, inclusiv la limita UTC și schimbarea orei', () => {
    expect(defaultMonths(new Date('2026-09-30T21:30:00Z'))).toEqual({ de: '2026-08', pana: '2026-10' })
    expect(defaultMonths(new Date('2026-10-31T22:30:00Z'))).toEqual({ de: '2026-09', pana: '2026-11' })
  })
  it('trimite luni incluse, pe prima zi, și refuză intervale invalide', () => {
    expect(monthRange('2026-08', '2026-10')).toEqual({ p_de: '2026-08-01', p_pana: '2026-10-01' })
    expect(monthRange('2026-10', '2026-10').p_pana).toBe('2026-10-01')
    for (const values of [['', '2026-10'], ['2026-13', '2027-01'], ['2026-10', '2026-09'], ['0000-01', '2026-10'], ['2026-1', '2026-10']]) {
      expect(() => monthRange(...values)).toThrow()
    }
  })
  it('folosește cursul orientativ existent și păstrează vizibile costurile sub un cent', () => {
    expect(USD_TO_RON).toBe(5)
    expect(formatMoney(0.0001)).toBe('0,0001 USD')
    expect(formatMoney('2.5')).toBe('2,50 USD')
    expect(formatMoney(2.5 * USD_TO_RON, 'RON')).toBe('12,50 RON')
    expect(formatMonth('2026-10-01')).toBe('octombrie 2026')
    expect(formatMonth('2026-13-01')).toBe('Lună necunoscută')
    expect(() => formatMoney('invalid')).toThrow()
  })
})

describe('Cost AI — grupare fără pierderi sau dublare', () => {
  it('adună modelele în aceeași lună, păstrează lunile și modulele separate', () => {
    const report = groupCosts([
      row(), row({ model: 'haiku', cost_usd: '0.875', apeluri: '2' }),
      row({ luna: '2026-09-01', cost_usd: 2 }),
      row({ modul: 'Executie', cost_usd: 3 }),
    ])
    expect(report.monthly).toHaveLength(3)
    expect(report.monthly.find(r => r.luna === '2026-10-01' && r.modul === 'Ofertare')).toMatchObject({ apeluri: 3, cost_usd: 1 })
    expect(report.total).toEqual({ apeluri: 5, cost_usd: 6, rezervat_in_curs_usd: 0 })
    expect(report.modules.find(r => r.nume === 'Ofertare').cost_usd).toBe(3)
    expect(report.top).toHaveLength(1)
    expect(report.top[0].cost_usd).toBe(6)
  })
  it('nu unește ID-uri diferite, nici proiectul cu licitația cu același ID și nume', () => {
    const report = groupCosts([row({ tinta_nume: 'Identic' }), row({ tinta_id: 8, tinta_nume: 'Identic' }), row({ tip_tinta: 'proiect', tinta_nume: 'Identic' })])
    expect(report.monthly).toHaveLength(3)
    expect(report.top).toHaveLength(3)
  })
  it('grupează fără țintă pe modul și nu introduce acele sume în topul proiectelor', () => {
    const report = groupCosts([
      row({ tip_tinta: null, tinta_id: null, tinta_nume: null, modul: 'HR', cost_usd: 5 }),
      row({ tip_tinta: null, tinta_id: null, modul: 'HR', cost_usd: 2 }),
      row({ tip_tinta: null, tinta_id: null, modul: 'Altele', cost_usd: 3 }),
    ])
    expect(report.monthly).toHaveLength(2)
    expect(report.monthly.find(r => r.modul === 'HR')).toMatchObject({ nume: 'Fara proiect - HR', cost_usd: 7 })
    expect(report.top).toEqual([])
    expect(report.total.cost_usd).toBe(10)
  })
  it('păstrează ținta fără denumire și folosește ID-ul în etichetă', () => {
    expect(groupCosts([row({ tinta_nume: null })]).top[0].nume).toBe('Licitația #7')
  })
  it('exclude rezervările în curs din cost și apeluri; nu le pierde din totalul separat', () => {
    const report = groupCosts([
      row({ modul: 'Izometrie (citire avize)', tip_tinta: 'proiect', cost_usd: '0', apeluri: 0, rezervat_in_curs_usd: '1.25' }),
      row({ modul: 'Izometrie (citire avize)', tip_tinta: 'proiect', cost_usd: '0.5', apeluri: 2, rezervat_in_curs_usd: '0' }),
      row({ modul: 'Izometrie (citire avize)', tip_tinta: 'proiect', tinta_id: 99, cost_usd: 0, apeluri: 0, rezervat_in_curs_usd: '2' }),
    ])
    expect(report.total).toEqual({ cost_usd: 0.5, apeluri: 2, rezervat_in_curs_usd: 3.25 })
    expect(report.top).toHaveLength(1)
    expect(report.top[0]).toMatchObject({ cost_usd: 0.5, rezervat_in_curs_usd: 1.25 })
  })
  it('sortează topul pe întregul interval și îl limitează la zece ținte', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ tinta_id: i + 1, cost_usd: i + 1 }))
    rows.push(row({ tinta_id: 1, luna: '2026-09-01', cost_usd: 100 }))
    const report = groupCosts(rows)
    expect(report.top).toHaveLength(10)
    expect(report.top[0]).toMatchObject({ tinta_id: 1, cost_usd: 101 })
    expect(report.top[1].cost_usd).toBe(12)
  })
  it('nu rotunjește înainte de însumare și nu modifică intrarea', () => {
    const rows = [Object.freeze(row({ cost_usd: '0.004' })), Object.freeze(row({ cost_usd: '0.004' }))]
    expect(groupCosts(Object.freeze(rows)).total.cost_usd).toBeCloseTo(0.008, 10)
    expect(rows[0].cost_usd).toBe('0.004')
  })
  it('tratează lista goală și valorile NULL, dar refuză numere corupte', () => {
    expect(groupCosts()).toEqual({ total: { cost_usd: 0, apeluri: 0, rezervat_in_curs_usd: 0 }, monthly: [], modules: [], top: [] })
    expect(groupCosts([row({ cost_usd: null })]).total.cost_usd).toBe(0)
    expect(() => groupCosts([row({ cost_usd: 'NaN' })])).toThrow()
    expect(() => groupCosts([row({ apeluri: Infinity })])).toThrow()
  })
})
