import { describe, it, expect } from 'vitest'
import { stareTermen, tonTermen, notaNedepusa, NEDEPUSE, FINALE } from './ofertareStareTermen.js'

// Valorile așteptate vin din calendar (ora României = UTC+2 iarna, UTC+3 vara), nu din codul testat.
// 08.11.2026 e iarnă (UTC+2): 08.11 15:00 RO = 13:00 UTC.
const ACUM = new Date('2026-11-08T13:00:00Z')   // duminică 08.11.2026, 15:00 RO

describe('stareTermen — cazurile din audit (08.11.2026)', () => {
  it('termen ieri 10:00 RO, status in_lucru → trecut de 1 zi (înainte: „AZI”)', () => {
    const s = stareTermen({ status: 'in_lucru', termen_depunere: '2026-11-07T08:00:00Z' }, ACUM)
    expect(s.fel).toBe('trecut'); expect(s.zile).toBe(1); expect(s.scurt).toBe('TRECUT')
    expect(s.eticheta).toContain('ieri'); expect(s.eticheta).toContain('nemarcată depusă')
  })
  it('termen azi 10:00 RO, acum 15:00 → trecut azi (înainte: „AZI”)', () => {
    const s = stareTermen({ status: 'go', termen_depunere: '2026-11-08T08:00:00Z' }, ACUM)
    expect(s.fel).toBe('trecut'); expect(s.zile).toBe(0); expect(s.eticheta).toContain('azi la 10:00')
  })
  it('termen azi 18:00 RO, acum 15:00 → AZI până la 18:00 (înainte: „1 zi”)', () => {
    const s = stareTermen({ status: 'in_lucru', termen_depunere: '2026-11-08T16:00:00Z' }, ACUM)
    expect(s.fel).toBe('azi'); expect(s.zile).toBe(0); expect(s.eticheta).toBe('AZI până la 18:00')
  })
  it('termen mâine 16:00 RO, acum azi 15:00 → 1 zi (înainte: „2 zile”)', () => {
    const s = stareTermen({ status: 'in_lucru', termen_depunere: '2026-11-09T14:00:00Z' }, ACUM)
    expect(s.fel).toBe('viitor'); expect(s.zile).toBe(1); expect(s.scurt).toBe('1 zi')
  })
  it('lic. 103 (termen 28.10.2026 17:22 RO) văzută pe 08.11 → trecut de 11 zile', () => {
    const s = stareTermen({ status: 'in_lucru', termen_depunere: '2026-10-28T15:22:00Z' }, ACUM)
    expect(s.fel).toBe('trecut'); expect(s.zile).toBe(11); expect(s.eticheta).toContain('acum 11 zile')
  })
  it('termen exact acum = trecut (pe timestamp, nu „azi”)', () => {
    expect(stareTermen({ status: 'in_lucru', termen_depunere: ACUM.toISOString() }, ACUM).fel).toBe('trecut')
  })
})

describe('stareTermen — miezul nopții și ora de vară', () => {
  it('termen 00:30 RO mâine, acum 23:50 RO → 1 zi calendaristică, nu „AZI”', () => {
    const acum = new Date('2026-11-08T21:50:00Z')            // 23:50 RO
    const s = stareTermen({ status: 'go', termen_depunere: '2026-11-08T22:30:00Z' }, acum)   // 00:30 RO pe 09.11
    expect(s.fel).toBe('viitor'); expect(s.zile).toBe(1)
  })
  it('peste schimbarea orei (25.10.2026): 24.10 12:00 RO → 26.10 12:00 RO = 2 zile', () => {
    const acum = new Date('2026-10-24T09:00:00Z')            // 12:00 RO (UTC+3)
    const s = stareTermen({ status: 'in_lucru', termen_depunere: '2026-10-26T10:00:00Z' }, acum)   // 12:00 RO (UTC+2)
    expect(s.fel).toBe('viitor'); expect(s.zile).toBe(2); expect(s.ora).toBe('12:00')
  })
})

describe('stareTermen — fără termen, statusuri finale, necunoscute', () => {
  it('termen lipsă → fara_termen (înainte: GREATEST(0, NULL) = 0 → „AZI”)', () => {
    expect(stareTermen({ status: 'identificata', termen_depunere: null }, ACUM).fel).toBe('fara_termen')
    expect(stareTermen({ status: 'identificata', termen_depunere: 'nu e dată' }, ACUM).fel).toBe('fara_termen')
  })
  it('depusă și finale nu sunt „trecut”, oricât de vechi ar fi termenul', () => {
    expect(stareTermen({ status: 'depusa', termen_depunere: '2026-06-09T10:00:00Z' }, ACUM).fel).toBe('depusa')
    for (const st of FINALE) expect(stareTermen({ status: st, termen_depunere: '2026-06-09T10:00:00Z' }, ACUM).fel).toBe('finala')
  })
  it('status necunoscut → necunoscut (listă albă), nu activ', () => {
    expect(stareTermen({ status: 'ceva_nou', termen_depunere: '2026-10-01T10:00:00Z' }, ACUM).fel).toBe('necunoscut')
    expect(stareTermen(null, ACUM).fel).toBe('necunoscut')
  })
  it('toate statusurile nedepuse cu termen trecut ies „trecut”', () => {
    for (const st of NEDEPUSE) expect(stareTermen({ status: st, termen_depunere: '2026-10-01T10:00:00Z' }, ACUM).fel).toBe('trecut')
  })
})

describe('tonTermen + notaNedepusa', () => {
  it('praguri de culoare', () => {
    expect(tonTermen({ fel: 'trecut', zile: 3 })).toBe('rosu')
    expect(tonTermen({ fel: 'azi', zile: 0 })).toBe('rosu')
    expect(tonTermen({ fel: 'viitor', zile: 3 })).toBe('rosu')
    expect(tonTermen({ fel: 'viitor', zile: 5 })).toBe('portocaliu')
    expect(tonTermen({ fel: 'viitor', zile: 10 })).toBe('galben')
    expect(tonTermen({ fel: 'viitor', zile: 30 })).toBe('verde')
    expect(tonTermen({ fel: 'fara_termen' })).toBe('neutru')
  })
  it('nota cere motiv nevid; data pe ora României', () => {
    expect(notaNedepusa('   ', ACUM)).toBeNull()
    expect(notaNedepusa(null, ACUM)).toBeNull()
    expect(notaNedepusa('nu am avut RTE pe domeniu', new Date('2026-11-08T22:30:00Z'))).toBe('[2026-11-09] Nedepusă după termen: nu am avut RTE pe domeniu')
  })
})
