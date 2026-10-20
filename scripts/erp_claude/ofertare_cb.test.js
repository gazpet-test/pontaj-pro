import { describe, it, expect } from 'vitest'
import { citesteArgs, plafonDin, textPas, EroareUtilizare } from './ofertare_cb.mjs'

describe('scripts/erp_claude/ofertare_cb — argumente', () => {
  it('stare / plafon / aproba / ruleaza cu valorile implicite ale butonului', () => {
    expect(citesteArgs(['stare', '15'])).toMatchObject({ cmd: 'stare', lic: 15, da: false, ore: 12, maxPasi: 20 })
    expect(citesteArgs(['plafon', '15', '2,5', '--da'])).toMatchObject({ cmd: 'plafon', lic: 15, usd: 2.5, da: true })
    expect(citesteArgs(['aproba', '15', '--ore', '6'])).toMatchObject({ cmd: 'aproba', ore: 6, da: false })
    expect(citesteArgs(['ruleaza', '15', 'b', '--max-pasi', '3', '--da'])).toMatchObject({ cmd: 'ruleaza', extractor: 'B', maxPasi: 3, da: true })
  })
  it('fără --da nu e niciodată confirmat', () => {
    for (const a of [['plafon', '15', '1'], ['aproba', '15'], ['ruleaza', '15', 'A']]) expect(citesteArgs(a).da).toBe(false)
  })
  it('refuză intrările greșite cu EroareUtilizare', () => {
    for (const a of [[], ['sterge', '15'], ['stare', 'x'], ['stare', '0'], ['stare', '15', 'extra'], ['plafon', '15'], ['plafon', '15', '0'],
      ['plafon', '15', 'abc'], ['ruleaza', '15', 'C'], ['aproba', '15', '--ore', '25'], ['aproba', '15', '--ore', '0'],
      ['ruleaza', '15', 'A', '--max-pasi', '21'], ['stare', '15', '--force']])
      expect(() => citesteArgs(a), JSON.stringify(a)).toThrow(EroareUtilizare)
  })
  it('plafonul se rotunjește la cenți, ca în buton', () => {
    expect(plafonDin('1,234')).toBe(1.23)
    expect(plafonDin('4.999')).toBe(5)
    expect(Number.isNaN(plafonDin('x'))).toBe(true)
  })
  it('rândul de progres = cel din buton', () => {
    expect(textPas(0, { felii_apelate: 3, cost_usd: 0.0123, felii_cu_deficit_b1: 1, felii_escaladate: null, erori: 0, oprit: 'buget_timp' }))
      .toBe('pas 1: 3 felii · 0.0123 USD · deficit B1 1 · buget_timp')
    expect(textPas(1, { eroare: 'Plafon depășit' })).toBe('pas 2: eroare — Plafon depășit')
  })
})
