import { describe, it, expect } from 'vitest'
import { citireOficialaAfisata, PRAG_VECHIME_ORE } from './monitorEgressCitire.js'

const ACUM = Date.parse('2026-11-08T12:00:00Z')
const ore = h => new Date(ACUM - h * 3600000).toISOString()
const citire = (h, o = {}) => ({ citit_la: ore(h), ciclu_start: '2026-11-07', ciclu_sfarsit: '2026-12-07', egress_bytes: 1, cached_egress_bytes: 2, sursa: 'dashboard', ...o })

describe('citireOficialaAfisata — vechimea e a citirii AFIȘATE (review Jakarinos PR #706)', () => {
  it('citirea curentă are 30 h, una din ciclul anterior are 1 h → se afișează cea curentă, cu avertisment de vechime', () => {
    const d = { oficial: citire(30), oficial_ultima: citire(1, { ciclu_start: '2026-10-07', ciclu_sfarsit: '2026-11-07' }), oficial_vechime_ore: 1 }
    const r = citireOficialaAfisata(d, ACUM)
    expect(r.of).toBe(d.oficial)
    expect(r.dinCicluTrecut).toBe(false)
    expect(r.vechimeOre).toBeCloseTo(30, 5)
    expect(r.veche).toBe(true)
  })
  it('citire curentă proaspătă → fără avertisment, chiar dacă oficial_vechime_ore ar spune altceva', () => {
    const r = citireOficialaAfisata({ oficial: citire(2), oficial_ultima: citire(2), oficial_vechime_ore: 99 }, ACUM)
    expect(r.vechimeOre).toBeCloseTo(2, 5)
    expect(r.veche).toBe(false)
  })
  it('doar citire din ciclul anterior (colector oprit peste schimbarea ciclului) → o afișează, marcată, cu vechimea ei', () => {
    const vechi = citire(40, { ciclu_start: '2026-10-07', ciclu_sfarsit: '2026-11-07' })
    const r = citireOficialaAfisata({ oficial: null, oficial_ultima: vechi, oficial_vechime_ore: 40 }, ACUM)
    expect(r.of).toBe(vechi)
    expect(r.dinCicluTrecut).toBe(true)
    expect(r.veche).toBe(true)
  })
  it('pragul e 26 h, ca alerta din BD', () => {
    expect(PRAG_VECHIME_ORE).toBe(26)
    expect(citireOficialaAfisata({ oficial: citire(25.9) }, ACUM).veche).toBe(false)
    expect(citireOficialaAfisata({ oficial: citire(26.1) }, ACUM).veche).toBe(true)
  })
  it('RPC vechi (fără chei oficiale) sau fără citiri → nimic de afișat, fără vechime', () => {
    for (const d of [{}, { oficial: null, oficial_ultima: null, oficial_vechime_ore: null }, null]) {
      const r = citireOficialaAfisata(d, ACUM)
      expect(r.of).toBe(null)
      expect(r.vechimeOre).toBe(null)
      expect(r.veche).toBe(false)
      expect(r.dinCicluTrecut).toBe(false)
    }
  })
})
