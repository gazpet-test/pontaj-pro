import { describe, it, expect } from 'vitest'
import { accesFinanciar, poateCreaGarantie, stareGarantieOfertare } from './financiarAcces.js'

describe('accesFinanciar', () => {
  it('doar sub-modulul garanții: doar tab-urile de garanții, editare pe ele, nu pe facturi', () => {
    expect(accesFinanciar({ role: 'manager_santier' }, ['ofertare', 'financiar.garantii']))
      .toEqual({ canWrite: false, canWriteGarantii: true, doarGarantii: true, taburi: ['gbe', 'garantii'] })
  })
  it('contabilitate: totul, ca înainte', () => {
    const a = accesFinanciar({ role: 'contabilitate' }, ['financiar'])
    expect([a.canWrite, a.canWriteGarantii, a.doarGarantii, a.taburi.length]).toEqual([true, true, false, 6])
  })
  it('modulul financiar întreg fără rol: vede tot, nu editează', () => {
    const a = accesFinanciar({ role: 'manager_santier' }, ['financiar'])
    expect([a.canWrite, a.canWriteGarantii, a.doarGarantii, a.taburi.length]).toEqual([false, false, false, 6])
  })
  it('financiar + garanții: vede tot, editează doar garanțiile', () => {
    const a = accesFinanciar({ role: 'x' }, ['financiar', 'financiar.garantii'])
    expect([a.canWrite, a.canWriteGarantii, a.doarGarantii]).toEqual([false, true, false])
  })
  it('owner: tot', () => {
    const a = accesFinanciar({ is_owner: true }, [])
    expect([a.canWrite, a.canWriteGarantii, a.doarGarantii]).toEqual([true, true, false])
  })
})

describe('garanția de participare din Ofertare', () => {
  it('creare: doar owner sau sub-modulul', () => {
    expect(poateCreaGarantie({ is_owner: true }, [])).toBe(true)
    expect(poateCreaGarantie({ role: 'manager_santier' }, ['financiar.garantii'])).toBe(true)
    expect(poateCreaGarantie({ role: 'contabilitate' }, ['financiar', 'ofertare'])).toBe(false)
  })
  it('stări cerută / emisă / depusă / eliberată', () => {
    expect(stareGarantieOfertare({ stare: 'activa' })).toBe('cerută')
    expect(stareGarantieOfertare({ stare: 'activa', numar_document: 'P1' })).toBe('emisă')
    expect(stareGarantieOfertare({ stare: 'activa', numar_document: 'P1', data_emitere: '2026-10-01' })).toBe('depusă')
    expect(stareGarantieOfertare({ stare: 'eliberata' })).toBe('eliberată')
  })
})
