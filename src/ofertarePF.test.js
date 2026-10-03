import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ROLURI, DOMENII, bani, dinBani, valideazaValoare, comparaValori, calculeazaControl, hashFisierClient } from './ofertarePF.js'

const valoare = (x = {}) => ({ id:'1', rol_valoare:'total_oferta', domeniu_valoric:'gazpet', participant:null, valoare:'100.00',
  tva_inclus:false, sursa_externa_cheie:'f1', confirmat_de:'om', confirmat_la:'2026-10-03T10:00:00Z', localizare:'pag. 1', ...x })
describe('PF: roluri × domenii', () => {
  for (const rol_valoare of Object.keys(ROLURI)) for (const domeniu_valoric of Object.keys(DOMENII)) {
    it(`${rol_valoare}/${domeniu_valoric}`, () => {
      const a = valoare({ rol_valoare, domeniu_valoric, cota_pct:rol_valoare === 'cota' ? '12.3456' : null })
      expect(valideazaValoare(a)).toEqual([])
      expect(comparaValori(a, { ...a, id:'2', sursa_externa_cheie:'seap' }).verdict).toBe(['cota','grafic_valoric'].includes(rol_valoare) ? 'neverificat' : 'egal')
    })
  }
})
it('banul este exact, inclusiv peste Number.MAX_SAFE_INTEGER', () => {
  expect(comparaValori(valoare({ valoare:'99999999999999.99' }), valoare({ id:'2', sursa_externa_cheie:'seap', valoare:'99999999999999.98' }))).toEqual({ diferenta:'0.01', verdict:'diferenta' })
  expect(dinBani(bani('0.10') + bani('0.20'))).toBe('0.30')
  expect(() => bani(0.1)).toThrow()
  expect(() => bani('100000000000000.00')).toThrow()
  expect(() => bani('1.001')).toThrow()
})
it('acceptă reduceri și ajustări negative fără toleranță', () => {
  expect(valideazaValoare(valoare({ rol_valoare:'act_aditional', valoare:'-25.20' }))).toEqual([])
  expect(comparaValori(valoare({ valoare:'-25.20' }), valoare({ sursa_externa_cheie:'seap', valoare:'-25.19' }))).toEqual({ diferenta:'-0.01', verdict:'diferenta' })
})
it('termen absent, neconfirmat, alt TVA, participant, rol, domeniu ori aceeași sursă → neverificat', () => {
  const a = valoare(), b = valoare({ id:'2', sursa_externa_cheie:'seap' })
  for (const x of [null, { ...b, valoare:null }, { ...b, confirmat_de:null }, { ...b, tva_inclus:true }, { ...b, participant:'X' },
    { ...b, rol_valoare:'platibil' }, { ...b, domeniu_valoric:'asociere_total' }, { ...b, sursa_externa_cheie:'f1' }, { ...b, sursa_externa_cheie:null }]) {
    expect(comparaValori(a,x)).toEqual({ diferenta:null, verdict:'neverificat' })
  }
  expect(calculeazaControl([])[0].verdict).toBe('neverificat')
})
it('cota nu este total, procent obligatoriu și precizie 7,4', () => {
  expect(valideazaValoare(valoare({ rol_valoare:'cota' })).length).toBeGreaterThan(0)
  expect(valideazaValoare(valoare({ rol_valoare:'cota', cota_pct:'1000.0000' })).length).toBeGreaterThan(0)
})
it('perechi orientate ca view-ul SQL, fără încrucișarea surselor identice', () => {
  const rows = calculeazaControl([valoare({id:'3',sursa_externa_cheie:'seap',valoare:'99.99'}), valoare({id:'2'}), valoare()])
  expect(rows.map(x => [String(x.valoare_a_id), x.valoare_b_id == null ? null : String(x.valoare_b_id), x.diferenta])).toEqual([
    ['1','3','0.01'], ['2','3','0.01'],
  ])
})
it.skipIf(!process.env.PF_PARITY_FILE)('paritate pe rândurile exportate de harness-ul PostgreSQL', () => {
  const { valori,control } = JSON.parse(readFileSync(process.env.PF_PARITY_FILE,'utf8'))
  const simplifica = rows => rows.map(x => ({ a:String(x.valoare_a_id),b:String(x.valoare_b_id),d:x.diferenta,v:x.verdict }))
    .sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  expect(simplifica(calculeazaControl(valori))).toEqual(simplifica(control))
})
it('SHA-256 cunoscut, marcat client și neconfirmat', async () => {
  const result = await hashFisierClient(new Blob(['abc']))
  expect(result.hash_valoare).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(result.hash_sursa).toBe('client')
  expect(result.hash_confirmat_de).toBeNull()
  expect(result.marime).toBe(3)
})
