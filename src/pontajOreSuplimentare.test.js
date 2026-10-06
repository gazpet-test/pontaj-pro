import { describe, it, expect } from 'vitest'
import { oreNormaPeZi, zileLucratoareAngajat, oreLucratoareAngajat, oreSuplimentare } from './pontajOreSuplimentare.js'

// Septembrie 2026: 30 de zile, 1.09 = marți, fără sărbători legale → 22 de zile lucrătoare = 176 h (exemplul din tichet)
const SEPT = { y: 2026, m: 9, days: 30, legalSet: new Set() }

describe('oreNormaPeZi', () => {
  it('normă întreagă / redusă din procent_ocupare', () => {
    expect(oreNormaPeZi(100)).toBe(8)
    expect(oreNormaPeZi('50.00')).toBe(4)
    expect(oreNormaPeZi(25)).toBe(2)
  })
  it('procent lipsă sau invalid → 8h', () => {
    for (const p of [null, undefined, '', 0, -5, 150, 'abc']) expect(oreNormaPeZi(p)).toBe(8)
  })
})

describe('zileLucratoareAngajat', () => {
  it('luna întreagă: 22 de zile în septembrie 2026', () => {
    expect(zileLucratoareAngajat({ ...SEPT })).toBe(22)
  })
  it('sărbătorile legale se scad', () => {
    expect(zileLucratoareAngajat({ ...SEPT, legalSet: new Set(['2026-09-01', '2026-09-05']) })).toBe(21) // 5.09 e sâmbătă
  })
  it('angajat în cursul lunii: de la hire_date inclusiv', () => {
    expect(zileLucratoareAngajat({ ...SEPT, hireDate: '2026-09-15' })).toBe(12) // 15–30.09 marți→miercuri
  })
  it('încetare în cursul lunii: până la termination_date inclusiv', () => {
    expect(zileLucratoareAngajat({ ...SEPT, terminationDate: '2026-09-11' })).toBe(9)
  })
  it('angajat și încetat în aceeași lună / în afara lunii', () => {
    expect(zileLucratoareAngajat({ ...SEPT, hireDate: '2026-09-07', terminationDate: '2026-09-11' })).toBe(5)
    expect(zileLucratoareAngajat({ ...SEPT, hireDate: '2026-10-01' })).toBe(0)
    expect(zileLucratoareAngajat({ ...SEPT, terminationDate: '2026-08-31' })).toBe(0)
    expect(zileLucratoareAngajat({ ...SEPT, hireDate: '2020-01-01', terminationDate: '2030-01-01' })).toBe(22)
  })
})

describe('oreLucratoareAngajat + oreSuplimentare', () => {
  it('exemplul din tichet: 195 h în lună − 176 h lucrătoare = 19 h suplimentare', () => {
    const lucr = oreLucratoareAngajat({ ...SEPT, emp: { procent_ocupare: 100 } })
    expect(lucr).toBe(176)
    expect(oreSuplimentare(195, lucr)).toBe(19)
  })
  it('normă redusă 50%: 22 × 4 = 88 h', () => {
    expect(oreLucratoareAngajat({ ...SEPT, emp: { procent_ocupare: '50.00' } })).toBe(88)
  })
  it('lună incompletă + normă redusă', () => {
    expect(oreLucratoareAngajat({ ...SEPT, emp: { procent_ocupare: 25, hire_date: '2026-09-15' } })).toBe(24)
  })
  it('sub normă → 0, nu negativ; zecimale păstrate', () => {
    expect(oreSuplimentare(150, 176)).toBe(0)
    expect(oreSuplimentare(180.5, 176)).toBe(4.5)
  })
})
