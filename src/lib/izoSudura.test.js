import { describe, it, expect } from 'vitest'
import cazuri from './izoSudura.cazuri.json'
import {
  normalizeazaSudura, formatSudura, cheieSudura, parseazaPerecheSuduri, mapeazaRandVechi, tronsonNr,
} from './izoSudura.js'

describe('normalizeazaSudura — setul comun (JS = SQL, E1)', () => {
  for (const c of cazuri.cazuri) {
    it(`${JSON.stringify(c.in)} ${JSON.stringify(c.opt)}`, () => {
      const r = normalizeazaSudura(c.in, c.opt)
      const { lot1, lot2, ...camp } = c.asteptat
      for (const [k, v] of Object.entries(camp)) expect(r[k], k).toEqual(v)
      if (lot2) expect(formatSudura(r, { prefix: 'TR' })).toBe(lot2)
      if (lot1) expect(formatSudura(r, { prefix: 'T' })).toBe(lot1)
    })
  }
})

describe('identitate', () => {
  it('T și TR dau aceeași cheie', () => {
    const a = normalizeazaSudura('T8S543'), b = normalizeazaSudura('TR8S543'), c = normalizeazaSudura('TR 8 S 0543')
    expect(cheieSudura(a)).toBe(cheieSudura(b))
    expect(cheieSudura(a)).toBe(cheieSudura(c))
  })
  it('„/A” și „A” rămân distincte cât timp convenția nu le unește', () => {
    const conv = { mod: 'strict', tronson: 11, conventie: ['/A', 'A'] }
    expect(cheieSudura(normalizeazaSudura('S318/A', conv))).not.toBe(cheieSudura(normalizeazaSudura('S318A', conv)))
  })
  it('formatul cu zerouri (prototipul tabletei: TR13S048)', () => {
    expect(formatSudura({ tronson: 13, nr: 48, sufix: '' }, { prefix: 'TR', pad: 3 })).toBe('TR13S048')
  })
})

describe('perechea din fișa de tăiere', () => {
  it('„T8S543 - T8S544” → două suduri', () => {
    const p = parseazaPerecheSuduri('T8S543 - T8S544')
    expect(p.map(x => x.canon)).toEqual(['TR8S543', 'TR8S544'])
  })
  it('„T8S314 - T8S547” păstrează ordinea scrisă (amonte/aval vin din km, nu din text)', () => {
    expect(parseazaPerecheSuduri('T8S314 - T8S547').map(x => x.nr)).toEqual([314, 547])
  })
  it('gol → listă goală', () => expect(parseazaPerecheSuduri('')).toEqual([]))
})

describe('maparea rândurilor vechi din executie_tevi (§1.5)', () => {
  it('legare → cuplare', () => expect(mapeazaRandVechi({ tip_rand: 'legare' }).tip_sudura).toBe('cuplare'))
  it('sudura_refacuta → operație de refacere', () => expect(mapeazaRandVechi({ sudura_refacuta: true }).operatii).toEqual(['refacere']))
  it('sudura_sant_pending → fără sudură aval, nimic stocat', () => expect(mapeazaRandVechi({ sudura_sant_pending: true }).fara_sudura_aval).toBe(true))
  it('separator → ignorat', () => expect(mapeazaRandVechi({ tip_rand: 'separator' }).ignora).toBe(true))
})

describe('tronsonNr', () => {
  it.each([[12, 12], ['12', 12], ['T12', 12], ['TR12', 12], ['TR 12', 12], ['X', null], ['', null], [null, null]])('%j → %j', (a, b) => {
    expect(tronsonNr(a)).toBe(b)
  })
})
