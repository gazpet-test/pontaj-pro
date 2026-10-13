import { describe, it, expect } from 'vitest'
import { parseCandidati, esteDeRepartizat, egalConstant, storageKeySafe, caleStorage } from './candidati.js'

describe('candidați', () => {
  it('array sau text, fără prefix Automatizari/, deduplicat fără majuscule', () => {
    expect(parseCandidati(['Automatizari/Prunisor-Jupa-Lot1', 'prunisor-jupa-lot1', ' Prunisor-Jupa-Lot2 ', ''])).toEqual(['Prunisor-Jupa-Lot1', 'Prunisor-Jupa-Lot2'])
    expect(parseCandidati('A, B;C')).toEqual(['A', 'B', 'C'])
    expect(parseCandidati(null)).toEqual([])
    expect(parseCandidati({ x: 1 })).toEqual([])
  })
  it('limite: max 20 candidați × 80 caractere', () => {
    expect(parseCandidati(Array.from({ length: 30 }, (_, i) => 'P' + i))).toHaveLength(20)
    expect(parseCandidati(['x'.repeat(200)])[0]).toHaveLength(80)
  })
  it('slug de coadă', () => {
    expect(esteDeRepartizat('_de_repartizat')).toBe(true)
    expect(esteDeRepartizat(' _DE_REPARTIZAT ')).toBe(true)
    expect(esteDeRepartizat('Bentu')).toBe(false)
  })
})

describe('secret și cale', () => {
  it('egalConstant', () => {
    expect(egalConstant('abc', 'abc')).toBe(true)
    expect(egalConstant('abd', 'abc')).toBe(false)
    expect(egalConstant('', '')).toBe(false)
    expect(egalConstant('x', undefined)).toBe(false)
  })
  it('cale Storage identică cu v16 pentru proiecte și sub _de_repartizat pentru coadă', () => {
    const d = new Date('2026-10-13T08:00:00Z')
    expect(caleStorage({ prefix: '27', dataMail: d, messageId: '18f0abcd12345678', numeFisier: 'Proces verbal ș.a.pdf' })).toBe('27/2026/10/12345678_Proces_verbal_s.a.pdf')
    expect(caleStorage({ prefix: '_de_repartizat', dataMail: d, messageId: 'm1', numeFisier: '' })).toBe('_de_repartizat/2026/10/m1_fisier')
    expect(storageKeySafe('ăîșțâ__x')).toBe('aista_x')
  })
})
