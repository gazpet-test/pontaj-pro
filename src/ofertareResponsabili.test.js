import { describe, it, expect } from 'vitest'
import { scurtNume, numeResponsabili, esteResponsabil } from './ofertareResponsabili.js'

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
})
