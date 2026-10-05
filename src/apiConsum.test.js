import { describe, it, expect } from 'vitest'
import { procentRamas, plusZile, epuizare, consumZilnic, carduri, fmtZi, stareEroare } from './apiConsum.js'

describe('procentRamas / plusZile / epuizare', () => {
  it('procentul rămas e între 0 și 100; plan lipsă sau 0 → null', () => {
    expect(procentRamas(3000, 2400)).toBe(80)
    expect(procentRamas(3000, 5000)).toBe(100)
    expect(procentRamas(100, 83)).toBe(83)
    expect(procentRamas(null, 10)).toBeNull()
    expect(procentRamas(0, 10)).toBeNull()
    expect(procentRamas(100, null)).toBeNull()
  })
  it('plusZile trece peste schimbarea orei (25.10.2026) și refuză valori absurde', () => {
    expect(plusZile('2026-10-24', 3)).toBe('2026-10-27')
    expect(plusZile('2026-10-05', 40)).toBe('2026-11-14')
    expect(plusZile('2026-10-05', 1e12)).toBeNull()
    expect(plusZile(null, 3)).toBeNull()
  })
  it('epuizare: data estimată + dacă vine înainte de sfârșitul perioadei', () => {
    expect(epuizare({ zi: '2026-10-05', zile_pana_la_epuizare: 40, perioada_sfarsit: '2026-10-31' })).toEqual({ data: '2026-11-14', inainteDeReset: false })
    expect(epuizare({ zi: '2026-10-05', zile_pana_la_epuizare: 10, perioada_sfarsit: '2026-10-31' })).toEqual({ data: '2026-10-15', inainteDeReset: true })
    expect(epuizare({ zi: '2026-10-05', zile_pana_la_epuizare: null })).toBeNull()
  })
})

describe('consumZilnic', () => {
  it('diferența zi-cu-zi în aceeași perioadă; eroarea nu intră; creșterea = reset, nu consum negativ', () => {
    const r = consumZilnic([
      { zi: '2026-10-03', credite_ramase: 2600, credite_plan: 3000, perioada_start: '2026-10-01' },
      { zi: '2026-10-05', credite_ramase: 2400, credite_plan: 3000, perioada_start: '2026-10-01' },
      { zi: '2026-10-04', credite_ramase: 2500, credite_plan: 3000, perioada_start: '2026-10-01' },
      { zi: '2026-10-06', eroare: 'HTTP 500: x' },
      { zi: '2026-11-01', credite_ramase: 3000, credite_plan: 3000, perioada_start: '2026-11-01' },
    ])
    expect(r.map(x => [x.zi, x.ramase, x.consum, x.reset])).toEqual([
      ['2026-10-03', 2600, null, false], ['2026-10-04', 2500, 100, false], ['2026-10-05', 2400, 100, false], ['2026-11-01', 3000, null, true]])
  })
  it('o eroare din aceeași zi nu anulează citirea bună a zilei (coloane separate, 20261014a r2)', () => {
    const r = consumZilnic([
      { zi: '2026-10-04', credite_ramase: 2500, perioada_start: '2026-10-01' },
      { zi: '2026-10-05', credite_ramase: 2400, perioada_start: '2026-10-01', eroare: 'HTTP 500: x', eroare_la: '2026-10-05T13:00:00Z' },
    ])
    expect(r.map(x => [x.zi, x.ramase, x.consum])).toEqual([['2026-10-04', 2500, null], ['2026-10-05', 2400, 100]])
  })
  it('rămase care cresc în aceeași perioadă (credite cumpărate) → reset, nu consum negativ', () => {
    expect(consumZilnic([{ zi: '2026-10-04', credite_ramase: 100, perioada_start: null }, { zi: '2026-10-05', credite_ramase: 600, perioada_start: null }])[1])
      .toEqual({ zi: '2026-10-05', ramase: 600, plan: null, consum: null, reset: true })
  })
})

describe('stareEroare', () => {
  it('curentă doar dacă e mai nouă decât citirea bună sau nu există citire bună', () => {
    expect(stareEroare({ ultima_eroare: 'HTTP 500: x', ultima_eroare_la: '2026-10-05T13:00:00Z', eroare_dupa_citire: true, citit_la: '2026-10-05T04:05:00Z' }))
      .toEqual({ text: 'HTTP 500: x', la: '2026-10-05T13:00:00Z', curenta: true })
    expect(stareEroare({ ultima_eroare: 'HTTP 500: x', ultima_eroare_la: '2026-10-05T03:00:00Z', eroare_dupa_citire: false, citit_la: '2026-10-05T04:05:00Z' }).curenta).toBe(false)
    expect(stareEroare({ ultima_eroare: 'FIRECRAWL_API_KEY lipsă din Edge Secrets', eroare_dupa_citire: true, citit_la: null }).curenta).toBe(true)
    expect(stareEroare({ ultima_eroare: null })).toBeNull()
    expect(stareEroare(null)).toBeNull()
  })
})

describe('carduri', () => {
  it('furnizorii așteptați apar și fără citiri; cei noi din view se adaugă după', () => {
    const c = carduri([{ furnizor: 'anthropic', credite_ramase: 1 }, { furnizor: 'firecrawl', credite_ramase: 2400 }])
    expect(c.map(x => [x.furnizor, !!x.v])).toEqual([['firecrawl', true], ['desktop_commander', false], ['anthropic', true]])
    expect(c[2].ui.nume).toBe('anthropic')
    expect(carduri([]).map(x => x.furnizor)).toEqual(['firecrawl', 'desktop_commander'])
  })
  it('fmtZi', () => { expect(fmtZi('2026-10-05')).toBe('05.10.2026'); expect(fmtZi(null)).toBe('—') })
})
