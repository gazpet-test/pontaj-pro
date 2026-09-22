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

import { marcheazaSudoriNepotriviti, AVERTISMENT_PEHD } from '../supabase/functions/ofertare-acoperire/candidati.ts'

// R20 în cod. Pe 21.09.2026 motorul a propus la Răcari (rețea de DISTRIBUȚIE, deci PEHD)
// un sudor de oțel pe cerința NTPEE art. 236/239. Regula scrisă în prompt a ținut la două
// rerulări — dar „a ținut de două ori" e un test trecut, nu o constrângere.
const TIPURI = { 1: 'Sudor PEHD', 2: 'Sudor electric autorizat', 3: 'Responsabil Tehnic cu Execuția (RTE)' }
const tip = id => TIPURI[id] || ''
const CERINTE = {
  10: 'Îmbinările sudate se execută numai de sudori autorizați, cu aparate de sudură agrementate tehnic.',
  20: 'Ofertantul trebuie să dispună de Responsabil Tehnic cu Execuția atestat ISC.',
}
const text = id => CERINTE[id] || ''
const rand = (cerinta_id, autorizatie_id, scor = 90) => ({ cerinta_id, autorizatie_id, scor, motiv: 'motiv', referinta_text: 'ref' })

describe('marcheazaSudoriNepotriviti — R20 ca verificare, nu ca rugăminte', () => {
  it('toți sudorii de oțel pe distribuție => marcați, scor tăiat', () => {
    const rows = [rand(10, 2, 92), rand(10, 2, 88)]
    expect(marcheazaSudoriNepotriviti(rows, 'Extindere retea DISTRIBUTIE gaze', text, tip)).toBe(2)
    expect(rows[0].motiv).toContain(AVERTISMENT_PEHD)
    expect(rows[0].referinta_text.startsWith('⚠️')).toBe(true)
    expect(rows.every(r => r.scor <= 40)).toBe(true)
  })

  it('dacă există măcar un PEHD, nimeni nu se marchează — oțelul e legitim pe racorduri', () => {
    const rows = [rand(10, 1, 93), rand(10, 2, 72)]
    expect(marcheazaSudoriNepotriviti(rows, 'Extindere retea distributie gaze', text, tip)).toBe(0)
    expect(rows[1].scor).toBe(72)
  })

  it('licitație de TRANSPORT => nu se atinge nimic (acolo oțelul e materialul)', () =>
    expect(marcheazaSudoriNepotriviti([rand(10, 2)], 'Conducta de TRANSPORT gaze Dn800', text, tip)).toBe(0))

  it('cerință care nu e de sudură => nu se atinge nimic', () =>
    expect(marcheazaSudoriNepotriviti([rand(20, 2)], 'retea distributie', text, tip)).toBe(0))

  it('candidat care nu e sudor (RTE) pe cerință de sudură => nu se atinge', () =>
    expect(marcheazaSudoriNepotriviti([rand(10, 3)], 'retea distributie', text, tip)).toBe(0))

  it('marchează per cerință, nu global', () => {
    const rows = [rand(10, 2), rand(20, 2)]
    expect(marcheazaSudoriNepotriviti(rows, 'retea distributie', text, tip)).toBe(1)
    expect(rows[1].motiv).toBe('motiv')
  })

  it('rânduri fără autorizație (doc de firmă, gol) nu darâmă funcția', () =>
    expect(marcheazaSudoriNepotriviti([{ cerinta_id: 10, autorizatie_id: null, motiv: null }], 'retea distributie', text, tip)).toBe(0))

  it('lista goală => zero', () =>
    expect(marcheazaSudoriNepotriviti([], 'retea distributie', text, tip)).toBe(0))
})
