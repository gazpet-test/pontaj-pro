import { describe, it, expect } from 'vitest'
import { dataCivilaBucuresti, TERMEN_CONSTATARE_ZILE, ultimaZiSesiune, dataLimitaConstatare, termenConstatare, mesajTermenConstatare } from './setari.js'

const uat = { sesiune_zi1: '2026-12-08', program_zi1: '09:00 – 16:00', sesiune_zi2: '2026-12-09', program_zi2: '09:00 – 16:00',
  sesiune_zi3: '2026-12-10', program_zi3: '09:00 – 16:00' }
const cerere = (extra = {}) => ({ id: 1, seq: 1, detinator_id: 7, optiune: 'constatare_teren', data: '2026-12-01', ...extra })
const pvTeren = (data_pv, extra = {}) => ({ id: 9, tip: 'A', detinator_id: 7, stare: 'semnat', sters_la: null, constatare_mod: 'teren', data_pv, ...extra })
const tc = (extra) => termenConstatare({ uat, detinatorId: 7, raspunsuri: [cerere()], pvs: [], ...extra })

describe('termen constatare pe teren (plan 4.6) — aritmetică', () => {
  it('constanta 5 zile, ultima zi validă cu program, + zile calendaristice', () => {
    expect(TERMEN_CONSTATARE_ZILE).toBe(5)
    expect(ultimaZiSesiune(uat)).toBe('2026-12-10')
    expect(ultimaZiSesiune({ sesiune_zi1: '2026-12-08', program_zi1: '09:00', sesiune_zi2: '2026-02-30', program_zi2: '09:00' })).toBe('2026-12-08')
    expect(ultimaZiSesiune({})).toBeNull()
    expect(dataLimitaConstatare('2026-12-10')).toBe('2026-12-15')
  })
  it('o zi fără program nu prelungește termenul', () => {
    const u = { sesiune_zi1: '2026-12-08', program_zi1: '09:00 – 16:00', sesiune_zi2: '2026-12-20', program_zi2: '  ' }
    expect(ultimaZiSesiune(u)).toBe('2026-12-08')
    expect(tc({ uat: u, azi: '2026-12-14' })).toMatchObject({ limita: '2026-12-13', depasit: true })
    expect(tc({ uat: { sesiune_zi1: '2026-12-08' }, azi: '2027-01-01' }).judecat).toBe(false)
  })
  it('peste lună și peste an', () => {
    expect(dataLimitaConstatare('2026-11-28')).toBe('2026-12-03')
    expect(dataLimitaConstatare('2026-12-29')).toBe('2027-01-03')
    expect(dataLimitaConstatare('2028-02-26')).toBe('2028-03-02')   // an bisect
  })
  it('data cererii (timestamptz) = data civilă București, iarna (UTC+2) și vara (UTC+3)', () => {
    expect(dataCivilaBucuresti('2026-12-12T22:30:00Z')).toBe('2026-12-13')
    expect(dataCivilaBucuresti('2026-12-12T21:59:00Z')).toBe('2026-12-12')
    expect(dataCivilaBucuresti('2026-07-14T21:15:00Z')).toBe('2026-07-15')
    expect(dataCivilaBucuresti('2026-07-14T20:59:00+00:00')).toBe('2026-07-14')
    expect(dataCivilaBucuresti('2026-12-12')).toBe('2026-12-12')
    expect(dataCivilaBucuresti('2026-02-30')).toBeNull()
    expect(dataCivilaBucuresti('nu e data')).toBeNull()
  })
})

describe('termen constatare pe teren — regula de închidere', () => {
  it('constatare semnată pe limită = în termen, fără avertisment; a doua zi = depășit', () => {
    const t = tc({ pvs: [pvTeren('2026-12-15')] })
    expect(t).toMatchObject({ cerut: true, limita: '2026-12-15', dataConstatare: '2026-12-15', depasit: false, judecat: true })
    expect(mesajTermenConstatare(t)).toBeNull()
    const t2 = tc({ pvs: [pvTeren('2026-12-16')] })
    expect(t2.depasit).toBe(true)
    expect(mesajTermenConstatare(t2)).toMatch(/16\.12\.2026 e după termen/)
  })
  it('fără PV care închide: față de azi (limită = în termen, a doua zi = depășit)', () => {
    expect(tc({ azi: '2026-12-15' })).toMatchObject({ depasit: false, judecat: true })
    const t = tc({ azi: '2026-12-16' })
    expect(t).toMatchObject({ depasit: true, judecat: true })
    expect(mesajTermenConstatare(t)).toMatch(/termen depășit, constatarea nu e consemnată/)
    expect(mesajTermenConstatare(tc({}))).toMatch(/termen 15\.12\.2026/)
  })
  it('lipsă date = nu se judecă', () => {
    expect(tc({ uat: {}, azi: '2027-01-01' })).toMatchObject({ judecat: false, depasit: false, limita: null })
    expect(tc({ raspunsuri: [], azi: '2027-01-01' })).toMatchObject({ cerut: false, judecat: false })
    expect(tc({}).judecat).toBe(false)
    expect(tc({ azi: '2026-13-01' }).judecat).toBe(false)
    expect(mesajTermenConstatare(tc({ uat: {} }))).toBeNull()
  })
  it('doar ultimul răspuns al deținătorului contează; PV-uri anulate/șterse/alt deținător/B se ignoră', () => {
    expect(tc({ raspunsuri: [cerere(), cerere({ id: 2, seq: 2, data: '2026-12-02', optiune: 'particip' })], azi: '2027-01-01' }).cerut).toBe(false)
    expect(termenConstatare({ uat, detinatorId: 8, raspunsuri: [cerere()], azi: '2027-01-01' }).cerut).toBe(false)
    const pvs = [pvTeren('2026-12-11', { stare: 'anulat' }), pvTeren('2026-12-11', { sters_la: '2026-12-12' }),
      pvTeren('2026-12-11', { detinator_id: 8 }), pvTeren('2026-12-11', { tip: 'B', detinator_id: null })]
    expect(tc({ pvs, azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
  })
  it('PV A semnat la sediu, după cerere și în sesiune: închis, fără avertisment', () => {
    const t = tc({ pvs: [pvTeren('2026-12-20', { constatare_mod: 'sediu' })], azi: '2027-01-01' })
    expect(t).toMatchObject({ inchis: true, judecat: false, depasit: false })
    expect(mesajTermenConstatare(t)).toBeNull()
  })
  it('constatare_mod lipsă / necunoscut nu închide', () => {
    for (const constatare_mod of [null, undefined, '', 'altceva', 'TEREN']) {
      const t = tc({ pvs: [pvTeren('2026-12-11', { constatare_mod })], azi: '2026-12-20' })
      expect(t).toMatchObject({ dataConstatare: null, depasit: true, judecat: true })
    }
  })
  it('PV A generat / trimis (nesemnat) nu închide', () => {
    for (const stare of ['generat', 'trimis_spre_semnare']) {
      expect(tc({ pvs: [pvTeren('2026-12-11', { stare })], azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true, judecat: true })
    }
  })
  it('data_pv STRICT după data cererii: aceeași zi nu închide, created_at e ignorat', () => {
    const r = [cerere({ data: '2026-12-12T12:00:00Z' })]
    const aceeasiZi = pvTeren('2026-12-12', { created_at: '2026-12-12T13:00:00Z' })
    expect(tc({ raspunsuri: r, pvs: [aceeasiZi], azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
    expect(tc({ raspunsuri: [cerere({ data: '2026-12-12' })], pvs: [pvTeren('2026-12-12')], azi: '2026-12-20' }).dataConstatare).toBeNull()
    expect(tc({ raspunsuri: r, pvs: [pvTeren('2026-12-13', { created_at: '2026-12-01T00:00:00Z' })] }).dataConstatare).toBe('2026-12-13')
    expect(tc({ raspunsuri: [cerere({ data: '2026-12-12T23:00:00Z' })], pvs: [pvTeren('2026-12-11', { constatare_mod: 'sediu' })], azi: '2026-12-20' }))
      .toMatchObject({ dataConstatare: null, depasit: true })
  })
  it('data civilă București a cererii: 2026-12-12T22:30Z = 13.12 → PV 13.12 nu închide, 14.12 da; vara (UTC+3) la fel', () => {
    const r = [cerere({ data: '2026-12-12T22:30:00Z' })]
    expect(tc({ raspunsuri: r, pvs: [pvTeren('2026-12-13')], azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
    expect(tc({ raspunsuri: r, pvs: [pvTeren('2026-12-14')] })).toMatchObject({ dataConstatare: '2026-12-14', depasit: false })
    const vara = { sesiune_zi1: '2026-07-10', program_zi1: '09:00 – 16:00' }
    const rv = [cerere({ data: '2026-07-13T21:15:00Z' })]   // 14.07 la București
    expect(tc({ uat: vara, raspunsuri: rv, pvs: [pvTeren('2026-07-14')], azi: '2026-07-20' })).toMatchObject({ dataConstatare: null, depasit: true })
    expect(tc({ uat: vara, raspunsuri: rv, pvs: [pvTeren('2026-07-15')] })).toMatchObject({ dataConstatare: '2026-07-15', depasit: false, limita: '2026-07-15' })
  })
  it('PV dinaintea primei zile de sesiune nu închide', () => {
    expect(tc({ raspunsuri: [cerere({ data: '2026-11-20' })], pvs: [pvTeren('2026-12-01')], azi: '2026-12-20' })).toMatchObject({ dataConstatare: null, depasit: true })
  })
  it('cerere fără dată validă: nu se închide niciodată, mesajul spune exact asta', () => {
    for (const data of [null, '', 'nu e data', '2026-02-30']) {
      const t = tc({ raspunsuri: [cerere({ data })], pvs: [pvTeren('2026-12-11'), pvTeren('2026-12-11', { id: 3, constatare_mod: 'sediu' })], azi: '2026-12-20' })
      expect(t).toMatchObject({ faraDataCerere: true, dataConstatare: null, depasit: true, judecat: true })
      expect(t.inchis).toBeUndefined()
      expect(mesajTermenConstatare(t)).toMatch(/cererea de constatare nu are dată; avertismentul rămâne până la verificare$/)
      expect(mesajTermenConstatare(t)).not.toMatch(/constatarea nu e consemnată/)
    }
    expect(mesajTermenConstatare(tc({ raspunsuri: [cerere({ data: null })] }))).toMatch(/nu are dată/)
  })
  it('alegere deterministă: data_pv minimă, la egalitate id minim (nu ordinea din listă)', () => {
    const a = pvTeren('2026-12-14', { id: 5, constatare_mod: 'sediu' }), b = pvTeren('2026-12-14', { id: 4, constatare_mod: 'teren' })
    expect(tc({ pvs: [a, b] })).toMatchObject({ dataConstatare: '2026-12-14', depasit: false })
    expect(tc({ pvs: [b, a] })).toMatchObject({ dataConstatare: '2026-12-14', depasit: false })
    const c = pvTeren('2026-12-14', { id: 3, constatare_mod: 'sediu' })
    expect(tc({ pvs: [b, a, c] }).inchis).toBe(true)
    expect(tc({ pvs: [pvTeren('2026-12-18', { id: 1 }), pvTeren('2026-12-14', { id: 2 })] }).dataConstatare).toBe('2026-12-14')
  })
})
