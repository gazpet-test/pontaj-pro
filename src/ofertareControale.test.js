import { describe, it, expect } from 'vitest'
import { controlCantitati } from './ofertareControale.js'

describe('H2 controlCantitati — conservarea cantitatilor (Hoghilag: 372 vs 371)', () => {
  it('egal => ok', () => expect(controlCantitati({ cantitati_baza: 'memoriu', cantitati_retea_m: 18007, grafic_fronturi_m: 18007 }).stare).toBe('ok'))
  it('rotunjire sub 0,1 % => warn, nu ok (se spune, nu se ascunde)', () => {
    const r = controlCantitati({ cantitati_baza: 'memoriu', cantitati_retea_m: 29980, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('warn'); expect(r.diferenta_m).toBe(5)
  })
  it('diferenta reala => block, cu ambele valori si diferenta (testul 15 din audit)', () => {
    const r = controlCantitati({ cantitati_baza: 'plansa', cantitati_retea_m: 37320, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('block'); expect(r.diferenta_m).toBe(-7335); expect(r.detalii).toMatch(/37.320/)
  })
  it('372 vs 371 bucati NU e rotunjire tolerabila? la 0,27 % => block', () =>
    expect(controlCantitati({ cantitati_baza: 'memoriu', cantitati_retea_m: 372, grafic_fronturi_m: 371 }).stare).toBe('block'))
  it('baza neasumata => block (graficul nu se poate reconcilia cu nimic)', () =>
    expect(controlCantitati({ cantitati_baza: null, cantitati_retea_m: 100, grafic_fronturi_m: 100 }).stare).toBe('block'))
  it('lipsa unei surse => warn "nu se poate face", nu ok', () => {
    expect(controlCantitati({ cantitati_baza: 'memoriu', cantitati_retea_m: null, grafic_fronturi_m: 100 }).stare).toBe('warn')
    expect(controlCantitati({ cantitati_baza: 'memoriu', cantitati_retea_m: 100, grafic_fronturi_m: null }).stare).toBe('warn')
  })
})
