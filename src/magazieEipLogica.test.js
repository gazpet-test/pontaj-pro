import { describe, it, expect } from 'vitest'
import { dataAziBucuresti, eroareTotalEchipament, eroareCantitatePredare, eroareDataPredare } from './magazieEipLogica.js'

describe('TKT-0353: total în evidență', () => {
  it('refuză un total mai mic decât cantitatea asignată', () => {
    expect(eroareTotalEchipament('4', 5)).toContain('cantitatea asignată acum (5)')
  })
  it('acceptă totalul egal cu asignatul și totalul mai mare', () => {
    expect(eroareTotalEchipament('5', '5')).toBe('')
    expect(eroareTotalEchipament(6, 5)).toBe('')
  })
  it('acceptă zero numai dacă nu există cantități asignate', () => {
    expect(eroareTotalEchipament(0, 0)).toBe('')
    expect(eroareTotalEchipament(0, 1)).not.toBe('')
  })
  it.each(['', ' ', null, undefined, -1, '-1', 'abc', Infinity, NaN])('refuză totalul invalid %s', total => {
    expect(eroareTotalEchipament(total, 0)).not.toBe('')
  })
  it('nu acceptă o cantitate asignată invalidă', () => {
    expect(eroareTotalEchipament(5, 'abc')).not.toBe('')
  })
})

describe('TKT-0354: data predării', () => {
  it.each([
    ['2026-07-15T23:30:00Z', '2026-07-16'],
    ['2026-01-15T23:30:00Z', '2026-01-16'],
    ['2026-07-15T20:59:59Z', '2026-07-15'],
    ['2026-07-15T21:00:00Z', '2026-07-16'],
    ['2026-01-15T21:59:59Z', '2026-01-15'],
    ['2026-01-15T22:00:00Z', '2026-01-16'],
  ])('calculează azi în București la %s', (instant, asteptat) => {
    expect(dataAziBucuresti(new Date(instant))).toBe(asteptat)
  })
  it('refuză viitorul și acceptă trecutul și ziua curentă', () => {
    expect(eroareDataPredare('2026-10-24', '2026-10-23')).toContain('viitor')
    expect(eroareDataPredare('2025-12-31', '2026-10-23')).toBe('')
    expect(eroareDataPredare('2026-10-23', '2026-10-23')).toBe('')
  })
  it.each(['', ' ', null, undefined, '-1', '23.10.2026', '2026-2-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00', '0000-01-01'])('refuză data invalidă %s', data => {
    expect(eroareDataPredare(data, '2026-10-23')).not.toBe('')
  })
  it('acceptă 29 februarie numai într-un an bisect', () => {
    expect(eroareDataPredare('2024-02-29', '2026-10-23')).toBe('')
    expect(eroareDataPredare('1900-02-29', '2026-10-23')).not.toBe('')
  })
})

describe('cantitatea de predat', () => {
  it.each(['', ' ', null, undefined, 0, -1, 'abc', Infinity])('refuză cantitatea invalidă %s', cantitate => {
    expect(eroareCantitatePredare(cantitate, 5)).not.toBe('')
  })
  it('acceptă disponibilul exact și refuză depășirea lui', () => {
    expect(eroareCantitatePredare('5', 5)).toBe('')
    expect(eroareCantitatePredare(6, 5)).toContain('disponibilul')
  })
})
