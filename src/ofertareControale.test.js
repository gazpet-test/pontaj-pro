import { describe, it, expect } from 'vitest'
import { controlCantitati } from './ofertareControale.js'

// Regula: referinta = lista F3 (pe ea se pun banii). Memoriu/planse/C6 diferite = de clarificat, nu de ales.
describe('H2 controlCantitati — F3 e referinta, restul se clarifica', () => {
  it('F3 = grafic, restul egal => ok', () =>
    expect(controlCantitati({ lista_f3_m: 18007, lista_c6_m: 18007, memoriu_m: 18007, grafic_fronturi_m: 18007 }).stare).toBe('ok'))
  it('rotunjire sub 0,1 % => warn, nu ok (se spune, nu se ascunde)', () => {
    const r = controlCantitati({ lista_f3_m: 29980, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('warn'); expect(r.diferenta_m).toBe(5)
  })
  it('grafic ≠ F3 => block, cu ambele valori si diferenta', () => {
    const r = controlCantitati({ lista_f3_m: 37320, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('block'); expect(r.diferenta_m).toBe(-7335); expect(r.detalii).toMatch(/37.320/)
  })
  it('372 vs 371 la 0,27 % => block', () =>
    expect(controlCantitati({ lista_f3_m: 372, grafic_fronturi_m: 371 }).stare).toBe('block'))
  it('lipsa F3 => block, chiar daca memoriul e egal cu graficul (Mostistea)', () => {
    const r = controlCantitati({ lista_f3_m: null, memoriu_m: 29980, grafic_fronturi_m: 29985 })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/F3/); expect(r.detalii).toMatch(/memoriu 29.980/)
  })
  it('memoriu/planse/C6 diferite de F3 => warn "nerezolvata prin clarificare", nu block, si le listeaza', () => {
    const r = controlCantitati({ lista_f3_m: 6520, lista_c6_m: 7077, memoriu_m: 5455, plansa_m: 4355, grafic_fronturi_m: 6520 })
    expect(r.stare).toBe('warn'); expect(r.neclarificate).toHaveLength(3); expect(r.detalii).toMatch(/clarificare/)
  })
  it('diferenta reala + neclarificate => block, nota de clarificare ramane in detalii', () => {
    const r = controlCantitati({ lista_f3_m: 6520, memoriu_m: 5455, grafic_fronturi_m: 5455 })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/clarificare/)
  })
  it('grafic fara fronturi => warn "nu se poate face"', () =>
    expect(controlCantitati({ lista_f3_m: 100, grafic_fronturi_m: null }).stare).toBe('warn'))
})
