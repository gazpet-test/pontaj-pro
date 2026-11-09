import { describe, it, expect } from 'vitest'
import { CALITATI_AR, COL_PLIC_AR, COL_PLIC_AR_TGZ, etichetaCalitateAr, atasezaMentiuniAr, mentiuneAr, scurteazaMentiuneAr, descriereArPlic } from './arMentiune.js'

// Exclusiv date fictive.
describe('mențiunea AR „primit de altă persoană” (juridic#021, juridic#026)', () => {
  const plicuri = [
    { id: 'p1', ar_primit_de: 'alta_persoana', ar_primit_calitate: 'membru_familie', ar_mentiune: ' FICTIV semnat de ruda ' },
    { id: 'p2', ar_primit_de: 'destinatar', ar_primit_calitate: null, ar_mentiune: null },
    { id: 'p3', ar_primit_de: 'alta_persoana', ar_mentiune: 'FICTIV vechi' },
  ]
  it('lista de calități: cele 3 coduri din BD, cu etichetele de afișare', () => {
    expect(CALITATI_AR.map(c => c.cod)).toEqual(['membru_familie', 'vecin', 'alta_persoana'])
    expect(CALITATI_AR.map(c => etichetaCalitateAr(c.cod))).toEqual(['membru de familie', 'vecin', 'altă persoană'])
    expect(etichetaCalitateAr('prieten')).toBe('')
    expect(etichetaCalitateAr(null)).toBe('')
  })
  it('selecturile: registrul intern citește calitatea și mențiunea; TGZ / PV B doar calitatea', () => {
    expect(COL_PLIC_AR.split(',')).toEqual(['id', 'ar_primit_de', 'ar_primit_calitate', 'ar_mentiune'])
    expect(COL_PLIC_AR_TGZ.split(',')).toEqual(['id', 'ar_primit_de', 'ar_primit_calitate'])
  })
  it('se atașează doar convocărilor din plicul semnat de altă persoană, cu calitatea', () => {
    const r = atasezaMentiuniAr([{ id: 'c1', plic_id: 'p1' }, { id: 'c2', plic_id: 'p2' }, { id: 'c3', plic_id: null }, { id: 'c4', plic_id: 'p3' }], plicuri)
    expect(r.map(c => c.ar_alta_persoana)).toEqual(['FICTIV semnat de ruda', undefined, undefined, 'FICTIV vechi'])
    expect(r.map(c => c.ar_alta_calitate)).toEqual(['membru_familie', undefined, undefined, null])
  })
  it('text detaliat (intern) și scurt (TGZ / PV B): scurt = doar calitatea, fără textul liber', () => {
    const c = { ar_alta_persoana: 'FICTIV semnat de ruda', ar_alta_calitate: 'membru_familie' }
    expect(mentiuneAr(c)).toBe(' (primit de altă persoană — membru de familie: FICTIV semnat de ruda)')
    expect(mentiuneAr(c, { detaliat: false })).toBe(' (primit de altă persoană: membru de familie)')
    expect(mentiuneAr({ ...c, ar_alta_calitate: 'vecin' }, { detaliat: false })).toBe(' (primit de altă persoană: vecin)')
    expect(mentiuneAr({ ...c, ar_alta_calitate: 'alta_persoana' }, { detaliat: false })).toBe(' (primit de altă persoană: altă persoană)')
    expect(mentiuneAr({})).toBe('')
  })
  it('date vechi fără calitate sau cod necunoscut: ca înainte, scurt fără nimic în plus', () => {
    expect(mentiuneAr({ ar_alta_persoana: 'FICTIV vechi' })).toBe(' (primit de altă persoană: FICTIV vechi)')
    expect(mentiuneAr({ ar_alta_persoana: 'FICTIV vechi' }, { detaliat: false })).toBe(' (primit de altă persoană)')
    expect(mentiuneAr({ ar_alta_persoana: 'x', ar_alta_calitate: 'FICTIV NUME PRENUME' }, { detaliat: false })).toBe(' (primit de altă persoană)')
  })
  it('scurtarea celulei din registru păstrează doar calitatea, e idempotentă și fail-closed', () => {
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană — membru de familie: FICTIV semnat de ruda)')).toBe('05.02.2026 (primit de altă persoană: membru de familie)')
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană: membru de familie)')).toBe('05.02.2026 (primit de altă persoană: membru de familie)')
    // textul liber poate conține orice, inclusiv separatorii; nu ajunge în varianta scurtă
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană — vecin: FICTIV — membru de familie: x)')).toBe('05.02.2026 (primit de altă persoană: vecin)')
    // date vechi (fără calitate): tot textul liber dispare
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană: FICTIV vechi)')).toBe('05.02.2026 (primit de altă persoană)')
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană: vecin) FICTIV)')).toBe('05.02.2026 (primit de altă persoană)')
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană — FICTIV NUME: x)')).toBe('05.02.2026 (primit de altă persoană)')
    expect(scurteazaMentiuneAr('05.02.2026 (primit de altă persoană)')).toBe('05.02.2026 (primit de altă persoană)')
    expect(scurteazaMentiuneAr('05.02.2026')).toBe('05.02.2026')
    expect(scurteazaMentiuneAr(null)).toBe(null)
    for (const v of ['05.02.2026 (primit de altă persoană — membru de familie: FICTIV)', '05.02.2026 (primit de altă persoană: FICTIV)']) {
      expect(scurteazaMentiuneAr(scurteazaMentiuneAr(v))).toBe(scurteazaMentiuneAr(v))
    }
  })
  it('afișarea în tabelul Plicuri (intern): calitatea și mențiunea', () => {
    expect(descriereArPlic(plicuri[0])).toBe(' · semnat de altă persoană (membru de familie): FICTIV semnat de ruda')
    expect(descriereArPlic(plicuri[1])).toBe('')
    expect(descriereArPlic(plicuri[2])).toBe(' · semnat de altă persoană: FICTIV vechi')
  })
})
