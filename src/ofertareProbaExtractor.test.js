import { describe, it, expect } from 'vitest'
import { consumBuget, cerereActiva, ruleazaPanaLaCapat, totalPasi } from './ofertareProbaExtractor.js'

describe('consumBuget', () => {
  it('decontat la cost real; orice altă stare la suma rezervată (ca fn_ofertare_cb_consum)', () => {
    expect(consumBuget([{ stare: 'decontata', cost_real: 0.0123, suma_rezervata: 0.2 }, { stare: 'deschisa', suma_rezervata: 0.21 },
      { stare: 'necunoscuta', suma_rezervata: 0.05 }, { stare: 'abandonata', suma_rezervata: 0.01 }])).toBe(0.2823)
    expect(consumBuget([])).toBe(0)
  })
})

describe('cerereActiva', () => {
  it('doar activă, pe scop, nevalidă după expirare; cea mai lungă valabilitate', () => {
    const acum = Date.parse('2026-10-20T06:00:00Z')
    const c = [{ id: 1, scop: 'cant_extragere', stare: 'activa', valabil_pana: '2026-10-17T19:56:33Z' },
      { id: 2, scop: 'cant_extragere', stare: 'activa', valabil_pana: '2026-10-20T18:00:00Z' },
      { id: 3, scop: 'audit_raspunsuri', stare: 'activa', valabil_pana: '2026-10-21T00:00:00Z' },
      { id: 4, scop: 'cant_extragere', stare: 'anulata', valabil_pana: '2026-10-22T00:00:00Z' }]
    expect(cerereActiva(c, 'cant_extragere', acum)?.id).toBe(2)
    expect(cerereActiva(c.slice(0, 1), 'cant_extragere', acum)).toBeNull()
  })
})

describe('ruleazaPanaLaCapat', () => {
  it('repetă cât timp oprit = buget_timp, apoi se oprește; însumează', async () => {
    const rasp = [{ oprit: 'buget_timp', felii_apelate: 3, cost_usd: 0.01, felii_cu_deficit_b1: 1, felii_escaladate: 1 },
      { oprit: null, felii_apelate: 2, cost_usd: 0.02, felii_cu_deficit_b1: 0, felii_escaladate: 0, raport: [{ eroare: 'x' }] }]
    let i = 0
    const r = await ruleazaPanaLaCapat(async () => ({ data: rasp[i++], error: null }), {})
    expect([r.motiv, r.pasi.length]).toEqual(['gata', 2])
    expect(totalPasi(r.pasi)).toEqual({ felii: 5, cost: 0.03, deficit: 1, escaladate: 1, erori: 1 })
  })
  it('se oprește la plafon / eroare / oprire cerută; nu depășește maxPasi', async () => {
    expect((await ruleazaPanaLaCapat(async () => ({ data: { oprit: 'rezervare:plafon' } }), {})).motiv).toBe('rezervare:plafon')
    expect((await ruleazaPanaLaCapat(async () => ({ data: { error: '403' } }), {})).motiv).toBe('eroare')
    expect((await ruleazaPanaLaCapat(async () => ({ data: null, error: { message: 'retea' } }), {})).pasi[0].eroare).toBe('retea')
    expect((await ruleazaPanaLaCapat(async () => ({ data: { oprit: 'buget_timp' } }), {}, { trebuieOprit: () => true })).motiv).toBe('oprit_de_om')
    expect((await ruleazaPanaLaCapat(async () => ({ data: { oprit: 'buget_timp' } }), {}, { maxPasi: 3 })).pasi.length).toBe(3)
  })
})
