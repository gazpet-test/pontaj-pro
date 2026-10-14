import { describe, it, expect } from 'vitest'
import { potrivesteCandidati, candidatiFaraProiect, etichetaPropusa, proiecteFaraEticheta, clasificaNonExecutie } from './documenteDeRepartizatLogic.js'
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

describe('filtru non-execuție (doar afișare)', () => {
  const c = (subiect, nume_fisier, n = 2) => clasificaNonExecutie({ subiect, nume_fisier, candidati: Array.from({ length: n }, (_, i) => 'P' + i) })
  it('cazurile reale din coadă (14.10.2026) sunt ascunse pe categoria corectă', () => {
    expect(c('CV - inginer 28.07.2026', 'cv_ion.pdf').cat).toBe('HR')
    expect(c('export  WinMentor (Analiza Descriptivă) — August', 'WINMENTOR EXPERT AUGUST 2026.xlsx').cat).toBe('Financiar')
    expect(c('liste obiecte de inventar', 'stocuri cuprinse in liste inventariere.xlsx').cat).toBe('Financiar')
    expect(c('Centralizator contracte in derulare la 17.07.2026', 'contracte in derulare Transgaz.pdf').cat).toBe('Financiar')
    expect(c('BUNA ZIUA! OSCAR 08-08-2026', 'Dispenses_08-08-2026.pdf').cat).toBe('Logistică')
    expect(c('RE: Documentatie licitatie distributie gaze', 'Manager Proiect.rar', 3).cat).toBe('Ofertare')
  })
  it('mail cu 4+ proiecte candidate = transversal', () => {
    expect(c('Situatie lunara', 'x.xlsx', 4)).toEqual({ cat: 'Transversal', motiv: '4 proiecte candidate' })
    expect(c('Situatie lunara', 'x.xlsx', 3)).toBeNull()
  })
  it('documentele de șantier rămân vizibile', () => {
    expect(c('PV receptie partiala tronson 3', 'PV_receptie.pdf')).toBeNull()
    expect(c('Expertiza tehnica pod', 'expertiza.pdf')).toBeNull()
    expect(clasificaNonExecutie(null)).toBeNull()
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
