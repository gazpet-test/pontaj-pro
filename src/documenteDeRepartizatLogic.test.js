import { describe, it, expect } from 'vitest'
import { potrivesteCandidati, candidatiFaraProiect, etichetaPropusa, proiecteFaraEticheta } from './documenteDeRepartizatLogic.js'
import { alerteGmail, SURSE_ADMIN, areAccesSursa } from './adminAlerte.js'

const proiecte = [
  { id: 1, nume: 'Prunișor Lot 1', eticheta_gmail: 'Prunisor-Jupa-Lot1' },
  { id: 3, nume: 'Lot 2 Orșova', eticheta_gmail: 'Prunisor-Jupa-Lot2' },
  { id: 27, nume: 'Finta', eticheta_gmail: null },
]

describe('coada de repartizat', () => {
  it('candidații → proiecte active, ordinea candidaților, fără dubluri, fără majuscule', () => {
    expect(potrivesteCandidati(['prunisor-jupa-lot2', 'Prunisor-Jupa-Lot1', 'PRUNISOR-JUPA-LOT2'], proiecte).map(p => p.id)).toEqual([3, 1])
    expect(potrivesteCandidati(['Necunoscut'], proiecte)).toEqual([])
    expect(potrivesteCandidati(null, proiecte)).toEqual([])
  })
  it('un proiect fără etichetă nu se potrivește cu un candidat gol', () => {
    expect(potrivesteCandidati([''], proiecte)).toEqual([])
  })
  it('candidații fără proiect activ sunt semnalați', () => {
    expect(candidatiFaraProiect(['Prunisor-Jupa-Lot1', 'Vechi-Inchis'], proiecte)).toEqual(['Vechi-Inchis'])
  })
})

describe('etichetă propusă', () => {
  it('din cod_intern, în stilul etichetelor existente', () => {
    expect(etichetaPropusa('FINTA_GHEBOAIA')).toBe('Finta-Gheboaia')
    expect(etichetaPropusa('DISTRIBUTIE_GAZE_FINTA_GHEBOAIA')).toBe('Distributie-Gaze-Finta-Gheboaia')
    expect(etichetaPropusa('ADI_IALOMITA_VEST')).toBe('ADI-Ialomita-Vest')
    expect(etichetaPropusa('LOT2_ORSOVA')).toBe('Lot2-Orsova')
    expect(etichetaPropusa(null, 'Șantier Bușteni')).toBe('Santier-Busteni')
    expect(etichetaPropusa('', '')).toBe('')
  })
  it('proiecte active fără etichetă', () => {
    const r = proiecteFaraEticheta([...proiecte, { id: 9, activ: false, eticheta_gmail: null }, { id: 10, eticheta_gmail: '  ' }])
    expect(r.map(x => x.id)).toEqual([27, 10])
  })
})

describe('alerta Administrator', () => {
  it('sursa gmail e doar pentru owner', () => {
    const s = SURSE_ADMIN.find(x => x.id === 'gmail')
    expect(s.ownerOnly).toBe(true)
    expect(areAccesSursa({ id: 'u', is_owner: false, module_access: ['admin_alerte', 'executie'] }, s)).toBe(false)
    expect(areAccesSursa({ id: 'o', is_owner: true, module_access: ['admin_alerte'] }, s)).toBe(true)
  })
  it('un rând de alertă per proiect fără etichetă, cu propunerea în referință', () => {
    const a = alerteGmail([{ id: 27, nume: 'Distributie Gaze Finta - Gheboaia', cod_intern: 'FINTA_GHEBOAIA', eticheta_gmail: null, activ: true }])
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id: 'gmail:27', source: 'gmail', path: '/executie?proiect=27' })
    expect(a[0].reference).toContain('Finta-Gheboaia')
  })
})
