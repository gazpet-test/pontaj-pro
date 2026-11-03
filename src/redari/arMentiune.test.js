import { describe, it, expect } from 'vitest'
import { atasezaMentiuniAr, mentiuneAr, scurteazaMentiuneAr } from './arMentiune.js'

// Exclusiv date fictive.
describe('mențiunea AR „primit de altă persoană” (juridic#021)', () => {
  const plicuri = [{ id: 'p1', ar_primit_de: 'alta_persoana', ar_mentiune: ' membru de familie ' }, { id: 'p2', ar_primit_de: 'destinatar', ar_mentiune: null }]
  it('se atașează doar convocărilor din plicul semnat de altă persoană', () => {
    const r = atasezaMentiuniAr([{ id: 'c1', plic_id: 'p1' }, { id: 'c2', plic_id: 'p2' }, { id: 'c3', plic_id: null }], plicuri)
    expect(r.map(c => c.ar_alta_persoana)).toEqual(['membru de familie', undefined, undefined])
  })
  it('text detaliat, scurt și scurtarea textului din registru', () => {
    expect(mentiuneAr({ ar_alta_persoana: 'membru de familie' })).toBe(' (primit de altă persoană: membru de familie)')
    expect(mentiuneAr({ ar_alta_persoana: 'x' }, { detaliat: false })).toBe(' (primit de altă persoană)')
    expect(mentiuneAr({})).toBe('')
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană: membru de familie)')).toBe('05.02.2026 (primit de altă persoană)')
    expect(scurteazaMentiuneAr('05.02.2026')).toBe('05.02.2026')
  })
})
