// TKT-2026-0348: echivalentul în țoli din diametrul exterior (valorile așteptate = tabelul EN 10220 / ASME B36.10, nu codul)
import { describe, it, expect } from 'vitest'
import { toliDinDiametruExterior, etichetaDiametru } from './probeCalc.js'

describe('toliDinDiametruExterior', () => {
  it('țevile de oțel din tichet: 273,1 mm = 10″, 323,9 mm = 12″ (și variantele 273,0 / 323,8)', () => {
    expect(toliDinDiametruExterior(273.1)).toBe('10″')
    expect(toliDinDiametruExterior(273)).toBe('10″')
    expect(toliDinDiametruExterior('323,9')).toBe('12″')
    expect(toliDinDiametruExterior('323.8')).toBe('12″')
    expect(toliDinDiametruExterior(168.3)).toBe('6″')
    expect(toliDinDiametruExterior(76.1)).toBe('2 1/2″')
  })
  it('PE sau diametre nestandard: fără țoli (Ø250 de polietilenă nu e 10″)', () => {
    expect(toliDinDiametruExterior(250)).toBeNull()
    expect(toliDinDiametruExterior(315)).toBeNull()
    expect(toliDinDiametruExterior(274)).toBeNull()
  })
  it('valori lipsă / invalide: null, fără excepție', () => {
    for (const v of [null, undefined, '', 'abc', 0, -273.1, NaN]) expect(toliDinDiametruExterior(v)).toBeNull()
  })
})

describe('etichetaDiametru', () => {
  const fmt = v => String(v)
  it('pune țolii între DN și milimetri', () => {
    expect(etichetaDiametru({ dn_label: 'DN250', diametru_extern_mm: 273.1 }, fmt)).toBe('DN250 · 10″ (273.1 mm)')
  })
  it('fără țoli când exteriorul nu e standard (eticheta rămâne ca înainte)', () => {
    expect(etichetaDiametru({ dn_label: 'DN250', diametru_extern_mm: 250 }, fmt)).toBe('DN250 (250 mm)')
  })
})
