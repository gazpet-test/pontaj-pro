import { describe, it, expect } from 'vitest'
import { dataMinimaGenerareOrdin, poateGeneraOrdin, motivBlocareOrdin } from './diurneOrdin.js'
import { lunaInchisa, termenCorecturi, cereTichet, stareLuna, normalizeazaTichet, tichetValabil, fmtZi } from './pontajLunaInchisa.js'

const zi = (s) => new Date(s + 'T10:00:00')

describe('ordine de deplasare — de pe 16 a lunii următoare', () => {
  it('septembrie 2026 → de pe 16.10.2026, fără termen de final', () => {
    expect(fmtZi(dataMinimaGenerareOrdin('2026-09-01'))).toBe('16.10.2026')
    expect(poateGeneraOrdin('2026-09-01', zi('2026-10-15'))).toBe(false)
    expect(poateGeneraOrdin('2026-09-01', new Date(2026, 9, 15, 23, 59))).toBe(false)
    expect(poateGeneraOrdin('2026-09-01', new Date(2026, 9, 16, 0, 1))).toBe(true)
    expect(poateGeneraOrdin('2026-09-01', zi('2027-03-01'))).toBe(true)
  })
  it('fereastra veche nu mai e valabilă (ultima zi a lunii / 1–7 ale lunii următoare)', () => {
    expect(poateGeneraOrdin('2026-09-01', zi('2026-09-30'))).toBe(false)
    expect(poateGeneraOrdin('2026-09-01', zi('2026-10-03'))).toBe(false)
  })
  it('decembrie → 16 ianuarie anul următor; perioadă din mijlocul lunii', () => {
    expect(fmtZi(dataMinimaGenerareOrdin('2026-12-01'))).toBe('16.01.2027')
    expect(fmtZi(dataMinimaGenerareOrdin('2026-09-15'))).toBe('16.10.2026')
  })
  it('perioadă invalidă → blocat', () => {
    expect(dataMinimaGenerareOrdin('')).toBeNull()
    expect(poateGeneraOrdin(null, zi('2030-01-01'))).toBe(false)
  })
  it('mesajul de blocare', () => {
    expect(motivBlocareOrdin('2026-09-01')).toBe('Ordinele pentru septembrie 2026 se pot genera de pe 16.10.2026 — statul de plată definitiv se face pe 15.')
  })
})

describe('pontaj — lună închisă și termenul de 12', () => {
  it('lună închisă = orice lună calendaristică trecută', () => {
    expect(lunaInchisa('2026-09-30', zi('2026-10-01'))).toBe(true)
    expect(lunaInchisa('2026-10-01', zi('2026-10-31'))).toBe(false)
    expect(lunaInchisa('2025-12-31', zi('2026-01-01'))).toBe(true)
    expect(lunaInchisa('2026-11-01', zi('2026-10-13'))).toBe(false)
    expect(lunaInchisa('x', zi('2026-10-13'))).toBe(false)
  })
  it('termenul = 12 a lunii următoare; după el se cere tichet', () => {
    expect(fmtZi(termenCorecturi('2026-09-05'))).toBe('12.10.2026')
    expect(fmtZi(termenCorecturi('2026-12-31'))).toBe('12.01.2027')
    expect(cereTichet('2026-09-05', zi('2026-10-12'))).toBe(false)
    expect(cereTichet('2026-09-05', new Date(2026, 9, 12, 23, 59))).toBe(false)
    expect(cereTichet('2026-09-05', zi('2026-10-13'))).toBe(true)
    expect(cereTichet('2026-08-05', zi('2026-10-01'))).toBe(true)
    expect(cereTichet('2026-10-05', zi('2026-10-20'))).toBe(false)
  })
  it('starea zilei', () => {
    expect(stareLuna('2026-10-05', zi('2026-10-13'))).toEqual({ inchisa: false, cereTichet: false, termen: null })
    const s = stareLuna('2026-09-05', zi('2026-10-05'))
    expect(s.inchisa).toBe(true)
    expect(s.cereTichet).toBe(false)
    expect(fmtZi(s.termen)).toBe('12.10.2026')
  })
})

describe('tichetul HR', () => {
  it('normalizează numărul tastat', () => {
    expect(normalizeazaTichet('TKT-2026-0287')).toBe('TKT-2026-0287')
    expect(normalizeazaTichet('tkt 2026 287')).toBe('TKT-2026-0287')
    expect(normalizeazaTichet('2026-0287')).toBe('TKT-2026-0287')
    expect(normalizeazaTichet('287')).toBeNull()
    expect(normalizeazaTichet('')).toBeNull()
  })
  it('valabil = HR și nerespins', () => {
    expect(tichetValabil({ departament: 'hr', status: 'atribuit' })).toBe(true)
    expect(tichetValabil({ departament: 'hr', status: 'inchis' })).toBe(true)
    expect(tichetValabil({ departament: 'hr', status: 'respins' })).toBe(false)
    expect(tichetValabil({ departament: 'logistica', status: 'deschis' })).toBe(false)
    expect(tichetValabil(null)).toBe(false)
  })
})
