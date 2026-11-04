import { describe, it, expect } from 'vitest'
import { TERMEN_CONSTATARE_ZILE, ultimaZiSesiune, dataLimitaConstatare, termenConstatare, mesajTermenConstatare } from './setari.js'

const uat = { sesiune_zi1: '2026-12-08', sesiune_zi2: '2026-12-09', sesiune_zi3: '2026-12-10' }
const cerere = (extra = {}) => ({ id: 1, seq: 1, detinator_id: 7, optiune: 'constatare_teren', data: '2026-12-01', ...extra })
const pvTeren = (data_pv, extra = {}) => ({ id: 9, tip: 'A', detinator_id: 7, stare: 'generat', sters_la: null, constatare_mod: 'teren', data_pv, ...extra })

describe('termen constatare pe teren (plan 4.6)', () => {
  it('constanta 5 zile, ultima zi validă, + zile calendaristice', () => {
    expect(TERMEN_CONSTATARE_ZILE).toBe(5)
    expect(ultimaZiSesiune(uat)).toBe('2026-12-10')
    expect(ultimaZiSesiune({ sesiune_zi1: '2026-12-08', sesiune_zi2: '2026-02-30' })).toBe('2026-12-08')
    expect(ultimaZiSesiune({})).toBeNull()
    expect(dataLimitaConstatare('2026-12-10')).toBe('2026-12-15')
  })
  it('peste lună și peste an', () => {
    expect(dataLimitaConstatare('2026-11-28')).toBe('2026-12-03')
    expect(dataLimitaConstatare('2026-12-29')).toBe('2027-01-03')
    expect(dataLimitaConstatare('2028-02-26')).toBe('2028-03-02')   // an bisect
  })
  it('constatare pe limită = în termen, fără avertisment', () => {
    const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-15')] })
    expect(t).toMatchObject({ cerut: true, limita: '2026-12-15', dataConstatare: '2026-12-15', depasit: false, judecat: true })
    expect(mesajTermenConstatare(t)).toBeNull()
  })
  it('a doua zi = depășit', () => {
    const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-16')] })
    expect(t.depasit).toBe(true)
    expect(mesajTermenConstatare(t)).toMatch(/16\.12\.2026 e după termen/)
  })
  it('fără constatare consemnată: față de azi (limită = în termen, a doua zi = depășit)', () => {
    const r = [cerere()]
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: r, azi: '2026-12-15' })).toMatchObject({ depasit: false, judecat: true })
    const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: r, azi: '2026-12-16' })
    expect(t).toMatchObject({ depasit: true, judecat: true })
    expect(mesajTermenConstatare(t)).toMatch(/termen depășit/)
    expect(mesajTermenConstatare(termenConstatare({ uat, detinatorId: 7, raspunsuri: r }))).toMatch(/termen 15\.12\.2026/)
  })
  it('lipsă date = nu se judecă', () => {
    expect(termenConstatare({ uat: {}, detinatorId: 7, raspunsuri: [cerere()], azi: '2027-01-01' })).toMatchObject({ judecat: false, depasit: false, limita: null })
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: [], azi: '2027-01-01' })).toMatchObject({ cerut: false, judecat: false })
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()] })).toMatchObject({ judecat: false })
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], azi: '2026-13-01' }).judecat).toBe(false)
    expect(mesajTermenConstatare(termenConstatare({ uat: {}, detinatorId: 7, raspunsuri: [cerere()] }))).toBeNull()
  })
  it('doar ultimul răspuns al deținătorului contează; PV-uri anulate/șterse/sediu/alt deținător/B se ignoră', () => {
    const schimbat = [cerere(), cerere({ id: 2, seq: 2, data: '2026-12-02', optiune: 'particip' })]
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: schimbat, azi: '2027-01-01' }).cerut).toBe(false)
    expect(termenConstatare({ uat, detinatorId: 8, raspunsuri: [cerere()], azi: '2027-01-01' }).cerut).toBe(false)
    const pvs = [pvTeren('2026-12-11', { stare: 'anulat' }), pvTeren('2026-12-11', { sters_la: '2026-12-12' }),
      pvTeren('2026-12-11', { constatare_mod: 'sediu' }), pvTeren('2026-12-11', { detinator_id: 8 }), pvTeren('2026-12-11', { tip: 'B', detinator_id: null })]
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs, azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
  })
  it('PV A semnat fără constatare pe teren: nu se mai judecă față de azi', () => {
    const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-09', { constatare_mod: 'sediu', stare: 'semnat' })], azi: '2027-01-01' })
    expect(t).toMatchObject({ judecat: false, depasit: false })
  })
})
