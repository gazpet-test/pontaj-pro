import { describe, it, expect } from 'vitest'
import { esteAbsentaPlanificata, numaraPlanificate } from './pontajPlanificat.js'

// TKT-2026-0136 (Eugen Nica): pe 24.08.2026 erau 20 de CO-uri în pontaj, patru create încă din 10.06.
const ZI = '2026-08-24'
const rec = (o = {}) => ({ norma: 'CO', created_at: '2026-08-21T06:00:00Z', updated_at: '2026-08-21T06:00:00Z', ...o })

describe('esteAbsentaPlanificata — planificare vs constatare', () => {
  it('CO scris cu luni înainte (10.06 pentru 24.08) => planificat', () =>
    expect(esteAbsentaPlanificata(rec({ created_at: '2026-06-10T06:55:00Z', updated_at: '2026-06-10T06:55:00Z' }), ZI)).toBe(true))

  it('CAZUL FRAȚII DOBRIN, așa cum arăta pe 24.08: creat pe 21.08, neatins => planificat', () =>
    expect(esteAbsentaPlanificata(rec(), ZI)).toBe(true))

  it('același rând DUPĂ ce a fost corectat pe 28.08 => nu mai e planificat, l-a verificat cineva', () =>
    expect(esteAbsentaPlanificata(rec({ updated_at: '2026-08-28T09:00:00Z' }), ZI)).toBe(false))

  it('cineva l-a confirmat chiar în ziua respectivă => constatare', () =>
    expect(esteAbsentaPlanificata(rec({ updated_at: '2026-08-24T10:00:00Z' }), ZI)).toBe(false))

  it('pontat în ziua lui => constatare, nu planificare', () =>
    expect(esteAbsentaPlanificata(rec({ created_at: '2026-08-24T09:00:00Z', updated_at: '2026-08-24T09:00:00Z' }), ZI)).toBe(false))

  it('rând cu ore, fără normă => nu e absență', () =>
    expect(esteAbsentaPlanificata(rec({ norma: null }), ZI)).toBe(false))

  it('merge pe orice cod de absență, nu doar CO', () => {
    for (const n of ['CM', 'CFP', 'BO', 'LL'])
      expect(esteAbsentaPlanificata(rec({ norma: n }), ZI)).toBe(true)
  })

  it('fără dată sau fără rând nu aruncă', () => {
    expect(esteAbsentaPlanificata(null, ZI)).toBe(false)
    expect(esteAbsentaPlanificata(rec(), null)).toBe(false)
    expect(esteAbsentaPlanificata(rec({ created_at: null }), ZI)).toBe(false)
  })

  it('numaraPlanificate numără doar planificatele din ziua cerută', () => {
    const recs = {
      1: rec(),                                                    // planificat
      2: rec({ created_at: '2026-06-10T06:00:00Z', updated_at: '2026-06-10T06:00:00Z' }),  // planificat
      3: rec({ updated_at: '2026-08-24T08:00:00Z' }),               // confirmat în ziua aia
      4: rec({ norma: null }),                                      // are ore
    }
    expect(numaraPlanificate(recs, ZI)).toBe(2)
    expect(numaraPlanificate({}, ZI)).toBe(0)
    expect(numaraPlanificate(null, ZI)).toBe(0)
  })
})
