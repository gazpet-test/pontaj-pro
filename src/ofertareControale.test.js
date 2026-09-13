import { describe, it, expect } from 'vitest'
import { controlCantitati, controlGarantie, controlAnexe, normalizeazaRef } from './ofertareControale.js'

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

describe('H4 controlGarantie — luni + momentul de start, aceleasi peste tot', () => {
  const OK = { garantie_cerut_luni: 36, garantie_cerut_moment: 'pif', garantie_oferit_luni: 36, garantie_oferit_moment: 'pif',
               garantie_confirmata: true, garantie_luni_in_capitole: [36], garantie_cerinte_lucrari: 3 }
  const g = p => controlGarantie({ ...OK, ...p })
  it('totul aliniat => ok', () => expect(g({}).stare).toBe('ok'))
  it('oferit < cerut => block', () => expect(g({ garantie_oferit_luni: 24 }).stare).toBe('block'))
  it('moment diferit (Hoghilag: PIF vs receptie) => block, cu ambele momente in clar', () => {
    const r = g({ garantie_oferit_moment: 'receptie_terminare' })
    expect(r.stare).toBe('block'); expect(r.detalii).toMatch(/recepția la terminarea/); expect(r.detalii).toMatch(/punerea în funcțiune/)
  })
  it('un capitol pomeneste alt numar de luni => block', () => expect(g({ garantie_luni_in_capitole: [36, 24] }).stare).toBe('block'))
  it('neasumata dar ceruta => block; neasumata si neceruta => warn', () => {
    expect(g({ garantie_oferit_luni: null }).stare).toBe('block')
    expect(g({ garantie_oferit_luni: null, garantie_cerinte_lucrari: 0 }).stare).toBe('warn')
  })
  it('oferita dar cerinta nenotata sau neconfirmata => warn, nu ok', () => {
    expect(g({ garantie_cerut_luni: null, garantie_cerut_moment: null }).stare).toBe('warn')
    expect(g({ garantie_confirmata: false }).stare).toBe('warn')
  })
  it('oferit peste cerut e in regula', () => expect(g({ garantie_oferit_luni: 48, garantie_luni_in_capitole: [48] }).stare).toBe('ok'))
})

describe('H5 controlAnexe — trimiterile din text au piesa in cuprins', () => {
  it('normalizare: Anexa 7 / anexa nr. 7 / ANEXA 7 => anexa:7; Cap. III / capitolul 3 => cap:3; Formularul nr. 5 => formular:5', () => {
    expect(normalizeazaRef('Anexa 7')).toBe('anexa:7'); expect(normalizeazaRef('anexa nr. 7')).toBe('anexa:7')
    expect(normalizeazaRef('Cap. III')).toBe('cap:3'); expect(normalizeazaRef('capitolul 3')).toBe('cap:3')
    expect(normalizeazaRef('Formularul nr. 5')).toBe('formular:5'); expect(normalizeazaRef('Rezumat')).toBeNull()
  })
  it('toate referintele exista => ok', () =>
    expect(controlAnexe({ anexe_referite: ['anexa 7', 'cap. 3'], anexe_existente: ['Anexa 7', 'Cap. III', 'Metodologia'] }).stare).toBe('ok'))
  it('o referinta fara piesa => block si o numeste', () => {
    const r = controlAnexe({ anexe_referite: ['anexa 7', 'formularul nr. 5'], anexe_existente: ['Anexa 7'] })
    expect(r.stare).toBe('block'); expect(r.lipsa).toEqual(['formular:5']); expect(r.detalii).toMatch(/Formularul 5/)
  })
  it('fara referinte => ok (nu warn: nu e obligatoriu sa trimiti la anexe)', () =>
    expect(controlAnexe({ anexe_referite: null, anexe_existente: ['Anexa 1'] }).stare).toBe('ok'))
  it('etichetele existente vin si din nr-ul capitolului (cap. 4)', () =>
    expect(controlAnexe({ anexe_referite: ['capitolul 4'], anexe_existente: ['cap. 4'] }).stare).toBe('ok'))
})
