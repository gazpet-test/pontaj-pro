import { describe, it, expect } from 'vitest'
import { dataCivilaBucuresti, TERMEN_CONSTATARE_ZILE, ultimaZiSesiune, dataLimitaConstatare, termenConstatare, mesajTermenConstatare } from './setari.js'

const uat = { sesiune_zi1: '2026-12-08', program_zi1: '09:00 – 16:00', sesiune_zi2: '2026-12-09', program_zi2: '09:00 – 16:00',
  sesiune_zi3: '2026-12-10', program_zi3: '09:00 – 16:00' }
const cerere = (extra = {}) => ({ id: 1, seq: 1, detinator_id: 7, optiune: 'constatare_teren', data: '2026-12-01', ...extra })
const pvTeren = (data_pv, extra = {}) => ({ id: 9, tip: 'A', detinator_id: 7, stare: 'semnat', sters_la: null, constatare_mod: 'teren', data_pv, ...extra })

describe('termen constatare pe teren (plan 4.6)', () => {
  it('constanta 5 zile, ultima zi validă cu program, + zile calendaristice', () => {
    expect(TERMEN_CONSTATARE_ZILE).toBe(5)
    expect(ultimaZiSesiune(uat)).toBe('2026-12-10')
    expect(ultimaZiSesiune({ sesiune_zi1: '2026-12-08', program_zi1: '09:00', sesiune_zi2: '2026-02-30', program_zi2: '09:00' })).toBe('2026-12-08')
    expect(ultimaZiSesiune({})).toBeNull()
    expect(dataLimitaConstatare('2026-12-10')).toBe('2026-12-15')
  })
  it('P3-01: o zi fără program nu prelungește termenul', () => {
    const u = { sesiune_zi1: '2026-12-08', program_zi1: '09:00 – 16:00', sesiune_zi2: '2026-12-20', program_zi2: '  ' }
    expect(ultimaZiSesiune(u)).toBe('2026-12-08')
    expect(termenConstatare({ uat: u, detinatorId: 7, raspunsuri: [cerere()], azi: '2026-12-14' })).toMatchObject({ limita: '2026-12-13', depasit: true })
    expect(termenConstatare({ uat: { sesiune_zi1: '2026-12-08' }, detinatorId: 7, raspunsuri: [cerere()], azi: '2027-01-01' }).judecat).toBe(false)
  })
  it('peste lună și peste an', () => {
    expect(dataLimitaConstatare('2026-11-28')).toBe('2026-12-03')
    expect(dataLimitaConstatare('2026-12-29')).toBe('2027-01-03')
    expect(dataLimitaConstatare('2028-02-26')).toBe('2028-03-02')   // an bisect
  })
  it('constatare semnată pe limită = în termen, fără avertisment', () => {
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
  it('doar ultimul răspuns al deținătorului contează; PV-uri anulate/șterse/alt deținător/B se ignoră', () => {
    const schimbat = [cerere(), cerere({ id: 2, seq: 2, data: '2026-12-02', optiune: 'particip' })]
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: schimbat, azi: '2027-01-01' }).cerut).toBe(false)
    expect(termenConstatare({ uat, detinatorId: 8, raspunsuri: [cerere()], azi: '2027-01-01' }).cerut).toBe(false)
    const pvs = [pvTeren('2026-12-11', { stare: 'anulat' }), pvTeren('2026-12-11', { sters_la: '2026-12-12' }),
      pvTeren('2026-12-11', { detinator_id: 8 }), pvTeren('2026-12-11', { tip: 'B', detinator_id: null })]
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs, azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
  })
  it('P2-01: PV A semnat în alt mod (sediu) după cerere închide subiectul, fără avertisment', () => {
    const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-20', { constatare_mod: 'sediu' })], azi: '2027-01-01' })
    expect(t).toMatchObject({ judecat: false, depasit: false })
    expect(mesajTermenConstatare(t)).toBeNull()
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-09', { constatare_mod: null })], azi: '2027-01-01' }).judecat).toBe(false)
  })
  it('P2-02: PV A generat / trimis (nesemnat) nu închide avertismentul', () => {
    for (const stare of ['generat', 'trimis_spre_semnare']) {
      const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-11', { stare })], azi: '2026-12-20' })
      expect(t).toMatchObject({ dataConstatare: null, depasit: true, judecat: true })
    }
  })
  it('P2-02: PV A semnat dinaintea cererii sau dinaintea primei zile de sesiune nu închide', () => {
    const tarzie = cerere({ data: '2026-12-12' })
    const t1 = termenConstatare({ uat, detinatorId: 7, raspunsuri: [tarzie], pvs: [pvTeren('2026-12-11', { constatare_mod: 'sediu' })], azi: '2026-12-20' })
    expect(t1).toMatchObject({ dataConstatare: null, depasit: true, judecat: true })
    const t2 = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere({ data: null })], pvs: [pvTeren('2026-12-01')], azi: '2026-12-20' })
    expect(t2).toMatchObject({ dataConstatare: null, depasit: true })
    // cererea cu timestamp: se compară pe data civilă; PV-ul din aceeași zi închide
    const t3 = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere({ data: '2026-12-12T10:00:00+02:00' })], pvs: [pvTeren('2026-12-12')] })
    expect(t3).toMatchObject({ dataConstatare: '2026-12-12', depasit: false, judecat: true })
  })
  it('două PV A semnate valabile: contează cel mai vechi', () => {
    const t = termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [pvTeren('2026-12-18', { id: 2 }), pvTeren('2026-12-14', { id: 3 })] })
    expect(t).toMatchObject({ dataConstatare: '2026-12-14', depasit: false })
  })
  it('P2 r2: data cererii (timestamptz) = data civilă București, iarna (UTC+2) și vara (UTC+3)', () => {
    expect(dataCivilaBucuresti('2026-12-12T22:30:00Z')).toBe('2026-12-13')
    expect(dataCivilaBucuresti('2026-12-12T21:59:00Z')).toBe('2026-12-12')
    expect(dataCivilaBucuresti('2026-07-14T21:15:00Z')).toBe('2026-07-15')
    expect(dataCivilaBucuresti('2026-07-14T20:59:00+00:00')).toBe('2026-07-14')
    expect(dataCivilaBucuresti('2026-12-12')).toBe('2026-12-12')
    expect(dataCivilaBucuresti('2026-02-30')).toBeNull()
    expect(dataCivilaBucuresti('nu e data')).toBeNull()
    const r = [cerere({ data: '2026-12-12T22:30:00Z' })]
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: r, pvs: [pvTeren('2026-12-12')], azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
    expect(termenConstatare({ uat, detinatorId: 7, raspunsuri: r, pvs: [pvTeren('2026-12-13')], azi: '2026-12-20' })).toMatchObject({ dataConstatare: '2026-12-13', depasit: false })
    const vara = { sesiune_zi1: '2026-07-10', program_zi1: '09:00 – 16:00' }
    const rv = [cerere({ data: '2026-07-14T21:15:00Z' })]
    expect(termenConstatare({ uat: vara, detinatorId: 7, raspunsuri: rv, pvs: [pvTeren('2026-07-14')], azi: '2026-07-20' })).toMatchObject({ dataConstatare: null, depasit: true })
    expect(termenConstatare({ uat: vara, detinatorId: 7, raspunsuri: rv, pvs: [pvTeren('2026-07-15')] })).toMatchObject({ dataConstatare: '2026-07-15', depasit: false, limita: '2026-07-15' })
  })
})
