import { describe, it, expect } from 'vitest'
import { turtesteCandidati, PLAFON_CANDIDATI } from '../supabase/functions/ofertare-acoperire/candidati.ts'

// Regula: motorul PROPUNE 0-3 variante; ecranul le arata pe toate, omul alege.
// Pana pe 21.09.2026 se pierdeau doua din trei — intai in Edge, apoi in RPC.

describe('turtesteCandidati — forma noua', () => {
  it('trei candidati devin trei randuri, cu cerinta_id pastrat', () => {
    const r = turtesteCandidati([{ cerinta_id: 7, status: 'acoperit', candidati: [
      { autorizatie_id: 1, motiv: 'A' }, { autorizatie_id: 2, motiv: 'B' }, { autorizatie_id: 'F9', motiv: 'C' },
    ] }])
    expect(r).toHaveLength(3)
    expect(r.map(x => x.cerinta_id)).toEqual([7, 7, 7])
    expect(r.map(x => x.motiv)).toEqual(['A', 'B', 'C'])
  })

  it('peste plafon se taie — limita nu e doar o rugaminte in prompt', () => {
    const cinci = [1, 2, 3, 4, 5].map(i => ({ autorizatie_id: i }))
    expect(turtesteCandidati([{ cerinta_id: 7, status: 'acoperit', candidati: cinci }])).toHaveLength(PLAFON_CANDIDATI)
  })

  it('ordinea modelului devine scor descrescator cand nu da scor', () => {
    const r = turtesteCandidati([{ cerinta_id: 7, candidati: [{ autorizatie_id: 1 }, { autorizatie_id: 2 }] }])
    expect(r[0].scor).toBeGreaterThan(r[1].scor)
  })

  it('scorul dat de model bate ordinea', () => {
    const r = turtesteCandidati([{ cerinta_id: 7, candidati: [{ autorizatie_id: 1, scor: 40 }, { autorizatie_id: 2, scor: 95 }] }])
    expect(r.map(x => x.scor)).toEqual([40, 95])
  })

  it('clarificarea se propune O SINGURA DATA, nu o data per candidat', () => {
    const r = turtesteCandidati([{ cerinta_id: 7, clarificare: 'Ce domeniu ISC cereti?',
      candidati: [{ autorizatie_id: 1 }, { autorizatie_id: 2 }, { autorizatie_id: 3 }] }])
    expect(r.filter(x => x.clarificare).length).toBe(1)
  })

  it('statusul candidatului bate statusul cerintei (partener printre proprii)', () => {
    const r = turtesteCandidati([{ cerinta_id: 7, status: 'acoperit', candidati: [
      { autorizatie_id: 1 }, { partener_id: 4, status: 'acoperit_partener' },
    ] }])
    expect(r.map(x => x.status)).toEqual(['acoperit', 'acoperit_partener'])
  })

  it('`candidati` nu se scurge mai departe pe randul turtit', () =>
    expect(turtesteCandidati([{ cerinta_id: 7, candidati: [{ autorizatie_id: 1 }] }])[0].candidati).toBeUndefined())
})

describe('turtesteCandidati — ce NU are voie sa strice', () => {
  it('forma veche (fara `candidati`) trece neatinsa', () => {
    const vechi = { cerinta_id: 7, status: 'acoperit', autorizatie_id: 3, motiv: 'ca inainte' }
    expect(turtesteCandidati([vechi])).toEqual([vechi])
  })

  it('„gol" cu lista goala ramane gol — nu se inventeaza candidati', () => {
    const r = turtesteCandidati([{ cerinta_id: 7, status: 'gol', motiv: 'lipseste 9.1', candidati: [] }])
    expect(r).toHaveLength(1)
    expect(r[0].status).toBe('gol')
    expect(r[0].motiv).toBe('lipseste 9.1')
  })

  it('nu_se_aplica si regula_propunere trec ca pana acum', () => {
    const r = turtesteCandidati([{ cerinta_id: 1, status: 'nu_se_aplica' }, { cerinta_id: 2, status: 'regula_propunere' }])
    expect(r.map(x => x.status)).toEqual(['nu_se_aplica', 'regula_propunere'])
  })

  it('gunoi in lista nu darama felia', () =>
    expect(turtesteCandidati([null, 'text', 42, { cerinta_id: 7, candidati: [{ autorizatie_id: 1 }, null] }]))
      .toHaveLength(1))

  it('lista goala sau lipsa => lista goala', () => {
    expect(turtesteCandidati([])).toEqual([])
    expect(turtesteCandidati(undefined)).toEqual([])
  })
})
