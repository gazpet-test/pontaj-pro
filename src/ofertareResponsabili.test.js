import { describe, it, expect } from 'vitest'
import { scurtNume, numeResponsabili, esteResponsabil, poateCheltuiUI } from './ofertareResponsabili.js'

describe('responsabili licitație (20261121a)', () => {
  it('un singur responsabil: numele întreg, ca până acum (R1 sau doar R2)', () => {
    expect(numeResponsabili({ responsabil_nume: 'Mirela Rosu' })).toBe('Mirela Rosu')
    expect(numeResponsabili({ responsabil2_nume: 'Oana Nica' })).toBe('Oana Nica')
  })
  it('doi responsabili: „Mirela R. + Ion P.”', () => {
    expect(numeResponsabili({ responsabil_nume: 'Mirela Rosu', responsabil2_nume: 'Ion Popescu' })).toBe('Mirela R. + Ion P.')
  })
  it('niciunul / gol / doar spații → șir gol', () => {
    expect(numeResponsabili({})).toBe('')
    expect(numeResponsabili({ responsabil_nume: '  ', responsabil2_nume: null })).toBe('')
    expect(numeResponsabili(null)).toBe('')
  })
  it('scurtNume: un cuvânt rămâne întreg, spațiile multiple nu strică', () => {
    expect(scurtNume('Claude')).toBe('Claude')
    expect(scurtNume('  Tudorache   Marilena Claudia ')).toBe('Tudorache M.')
  })
  it('esteResponsabil: oricare dintre cei doi; fără uid → nu', () => {
    expect(esteResponsabil({ responsabil_id: 'a', responsabil2_id: 'b' }, 'b')).toBe(true)
    expect(esteResponsabil({ responsabil_id: 'a' }, 'a')).toBe(true)
    expect(esteResponsabil({ responsabil_id: 'a', responsabil2_id: null }, 'c')).toBe(false)
    expect(esteResponsabil({ responsabil_id: null }, null)).toBe(false)
  })
  it('poateCheltuiUI (20261124a): owner; responsabil 1 / 2 nenumit de el însuși; autoatribuit sau străin -> nu', () => {
    const P = (id, owner = false) => ({ id, is_owner: owner })
    expect(poateCheltuiUI({ responsabil_id: 'a' }, P('o', true))).toBe(true)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil_setat_de: 'o' }, P('a'))).toBe(true)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil_setat_de: null }, P('a'))).toBe(true)   // numire veche (A)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil_setat_de: 'a' }, P('a'))).toBe(false)  // autoatribuit
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil2_id: 'b', responsabil2_setat_de: 'o' }, P('b'))).toBe(true)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil2_id: 'b', responsabil2_setat_de: 'b' }, P('b'))).toBe(false)
    expect(poateCheltuiUI({ responsabil_id: 'a' }, P('c'))).toBe(false)
    expect(poateCheltuiUI({ responsabil_id: 'a' }, null)).toBe(false)
  })
  it('poateCheltuiUI (2A): dovada de numire false (numit de un editor / fără utilizator) -> nu; true sau lipsă din select -> nu exclude', () => {
    const P = (id) => ({ id, is_owner: false })
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil_setat_de: 'e', responsabil_numitor_autorizat: false }, P('a'))).toBe(false)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil_setat_de: 'o', responsabil_numitor_autorizat: true }, P('a'))).toBe(true)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil2_id: 'b', responsabil2_setat_de: 'e', responsabil2_numitor_autorizat: false }, P('b'))).toBe(false)
    expect(poateCheltuiUI({ responsabil_id: 'a', responsabil2_id: 'b', responsabil2_setat_de: 'o', responsabil2_numitor_autorizat: true }, P('b'))).toBe(true)
  })
})
