import { describe, it, expect } from 'vitest'
import { grupeazaPeSubiect, esteDeVerificat } from './ofertareSubiecte.js'

const reguli = [
  { cheie: 'personal_manager_proiect', eticheta: '👤 Manager de proiect', ordine: 10 },
  { cheie: 'autorizare_anre', eticheta: '⚡ ANRE', ordine: 50 },
  { cheie: 'grafic_executie', eticheta: '📅 Grafic', ordine: 70 },
]
const cer = [
  { id: 1, nr_ordine: 131, confirmata_de: null },
  { id: 2, nr_ordine: 16, confirmata_de: 'u' },
  { id: 3, nr_ordine: 37, confirmata_de: null },
  { id: 4, nr_ordine: 146, confirmata_de: 'u' },
  { id: 5, nr_ordine: 500, confirmata_de: null },
  { id: 6, nr_ordine: 501, confirmata_de: null },
]
const sub = {
  1: { subiect: 'autorizare_anre', sursa: 'auto', alternative: [] },
  2: { subiect: 'autorizare_anre', sursa: 'auto', alternative: [] },
  3: { subiect: 'autorizare_anre', sursa: 'om', alternative: [] },
  4: { subiect: 'personal_manager_proiect', sursa: 'auto', alternative: ['grafic_executie'] },
  6: { subiect: 'subiect_din_versiune_veche', sursa: 'auto', alternative: [] },
}

describe('grupeazaPeSubiect', () => {
  const g = grupeazaPeSubiect(cer, sub, reguli)
  it('ordonează grupurile după regulă, neclasificatele la final', () => {
    expect(g.map(x => x.cheie)).toEqual(['personal_manager_proiect', 'autorizare_anre', 'neclasificat'])
  })
  it('rândurile aceluiași subiect stau împreună, în ordinea din registru', () => {
    expect(g[1].randuri.map(r => r.c.nr_ordine)).toEqual([16, 37, 131])
  })
  it('numerotare pe grup (2.1, 2.2, 2.3)', () => {
    expect(g[1].randuri.map(r => r.numar)).toEqual(['2.1', '2.2', '2.3'])
    expect(g[0].randuri[0].numar).toBe('1.1')
  })
  it('contoare: total / confirmate / de verificat', () => {
    expect(g[1]).toMatchObject({ total: 3, confirmate: 1, deVerificat: 0 })
    expect(g[0]).toMatchObject({ total: 1, confirmate: 1, deVerificat: 1 })
  })
  it('fără subiect sau cu cheie necunoscută → neclasificat, nu dispare', () => {
    expect(g[2].randuri.map(r => r.c.id).sort()).toEqual([5, 6])
    expect(g.reduce((n, x) => n + x.total, 0)).toBe(cer.length)
  })
  it('listă goală', () => {
    expect(grupeazaPeSubiect([], {}, reguli)).toEqual([])
    expect(grupeazaPeSubiect(null, null, null)).toEqual([])
  })
})

describe('esteDeVerificat', () => {
  it('doar auto cu alternative', () => {
    expect(esteDeVerificat({ sursa: 'auto', alternative: ['x'] })).toBe(true)
    expect(esteDeVerificat({ sursa: 'om', alternative: ['x'] })).toBe(false)
    expect(esteDeVerificat({ sursa: 'auto', alternative: [] })).toBe(false)
    expect(esteDeVerificat(null)).toBe(false)
  })
})
