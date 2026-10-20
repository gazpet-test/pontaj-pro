import { describe, it, expect } from 'vitest'
import { consumBuget, cerereActiva, cereriPeLot, ruleazaPanaLaCapat, totalPasi, problemeRaport } from './ofertareProbaExtractor.js'

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
    expect((await ruleazaPanaLaCapat(async () => ({ data: { oprit: 'buget_timp', felii_apelate: 1 } }), {}, { maxPasi: 3 })).pasi.length).toBe(3)
  })
})

describe('review r1 (#797)', () => {
  it('cerereActiva ignoră cererile pe un lot anume (doar afișate)', () => {
    const acum = Date.parse('2026-10-20T06:00:00Z')
    const c = [{ id: 7, scop: 'cant_extragere', stare: 'activa', valabil_pana: '2026-10-20T18:00:00Z', lot_domeniu: 'lista', lot_nr: [2] }]
    expect(cerereActiva(c, 'cant_extragere', acum)).toBeNull()
    expect(cereriPeLot(c, 'cant_extragere', acum).map(x => x.id)).toEqual([7])
  })
  it('pas oprit pe timp fără nicio felie = fără progres (nu se repetă în gol); excepția invoke = eroare', async () => {
    let n = 0
    const r = await ruleazaPanaLaCapat(async () => { n++; return { data: { oprit: 'buget_timp', felii_apelate: 0 } } }, {})
    expect([r.motiv, n]).toEqual(['fara_progres', 1])
    const e = await ruleazaPanaLaCapat(async () => { throw new TypeError('Failed to fetch') }, {})
    expect([e.motiv, e.pasi[0].eroare]).toEqual(['eroare', 'Failed to fetch'])
  })
})

describe('problemeRaport (motivul feliilor eșuate, varianta b)', () => {
  it('scoate doar feliile cu eroare / refuz / așteaptă omul, cu prima mostră trunchiată', () => {
    const r = problemeRaport([
      { document_id: 212, felie: 0, eroare: '3 rânduri nenormalizabile — felia nu e completă', mostre: ['{"um":"buc"}', 'x'] },
      { document_id: 212, felie: 1, observatii: 12 },
      { document_id: 213, felie: 4, asteapta_om: 'esuat' },
      { document_id: 213, felie: 5, refuz_rezervare: 'felie' },
    ])
    expect(r).toEqual([
      'doc 212 felia 1: 3 rânduri nenormalizabile — felia nu e completă — ex.: {"um":"buc"}',
      'doc 213 felia 5: așteaptă omul (esuat)',
      'doc 213 felia 6: refuz rezervare: felie',
    ])
  })
  it('obiectele devin text', () => {
    expect(problemeRaport([{ document_id: 5, felie: 0, refuz_rezervare: { refuz: 'plafon' } }])).toEqual(['doc 5 felia 1: refuz rezervare: {"refuz":"plafon"}'])
  })
  it('plafonează numărul de rânduri și tolerează raport lipsă', () => {
    expect(problemeRaport(undefined)).toEqual([])
    const multe = Array.from({ length: 40 }, (_, i) => ({ document_id: 1, felie: i, eroare: 'e' }))
    const r = problemeRaport(multe, 5)
    expect(r.length).toBe(6); expect(r[5]).toBe('…')
  })
  it('ruleazaPanaLaCapat pune problemele pe pas', async () => {
    const r = await ruleazaPanaLaCapat(async () => ({ data: { oprit: null, felii_apelate: 1, cost_usd: 0.01, raport: [{ document_id: 9, felie: 2, eroare: 'raspuns neinterpretabil' }] } }), {})
    expect(r.pasi[0].probleme).toEqual(['doc 9 felia 3: raspuns neinterpretabil'])
    expect(r.pasi[0].erori).toBe(1)
  })
})
