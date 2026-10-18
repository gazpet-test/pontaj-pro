import { strict as assert } from 'node:assert'
import { ofertaValida, pretNormalizat } from './validare.ts'

const rand = { material_id: 1, denumire_furnizor: null, pret: null, um: null, note: 'neofertat' }
const oferta = { furnizor: null, data_oferta: null, valabilitate: null, conditii: null,
  preturi: [rand, { ...rand, material_id: 2 }] }
const ids = new Set([1, 2])

Deno.test('RFQ: toate neofertate sunt valide; prețurile numerice sau text se normalizează fără a confunda null cu zero', () => {
  assert.ok(ofertaValida(oferta, ids))
  for (const [pret, n] of [[null, null], [0, 0], [145.5, 145.5], ['145.50', 145.5], [' 0 ', 0]] as const) {
    assert.ok(ofertaValida({ ...oferta, preturi: [{ ...rand, pret }, oferta.preturi[1]] }, ids))
    assert.equal(pretNormalizat(pret), n)
  }
})

Deno.test('RFQ: material lipsă, necunoscut, duplicat sau câmpuri absente/de tip greșit respinse', () => {
  for (const pret of [undefined, '', ' ', 'NaN', 'Infinity', '-1', -1, NaN, Infinity, true, false, {}, []])
    assert.equal(ofertaValida({ ...oferta, preturi: [{ ...rand, pret }, oferta.preturi[1]] }, ids), false, String(pret))
  for (const preturi of [[], null, {}, [rand], [rand, rand], [rand, { ...rand, material_id: 3 }],
    [rand, null], [rand, { ...rand, material_id: '2' }]])
    assert.equal(ofertaValida({ ...oferta, preturi }, ids), false)
  for (const k of Object.keys(oferta)) {
    const j: any = structuredClone(oferta); delete j[k]; assert.equal(ofertaValida(j, ids), false, k)
    assert.equal(ofertaValida({ ...oferta, [k]: {} }, ids), false, k)
  }
  for (const k of Object.keys(rand)) {
    const j: any = structuredClone(oferta); delete j.preturi[0][k]
    assert.equal(ofertaValida(j, ids), false, k)
    j.preturi[0][k] = {}; assert.equal(ofertaValida(j, ids), false, k)
  }
})

Deno.test('RFQ: validatorul real oprește răspunsul invalid înainte de înlocuire; stringul numeric ajunge număr în rând', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  const bloc = src.slice(src.indexOf('    const idsValide'), src.indexOf('    // Ștergerea și inserarea'))
    .replace('new Set<number>', 'new Set').replace(/: any/g, '')
  const ruleaza = new Function('parsed', 'mats', 'of', 'fail', 'ofertaValida', 'pretNormalizat', bloc + '\nreturn { preturi }')
  for (const j of [oferta, { ...oferta, preturi: [rand, { ...rand, material_id: 2, pret: '145.50' }] }]) {
    const r = ruleaza(j, [{ id: 1 }, { id: 2 }], { id: 9 }, (error: string) => ({ error }), ofertaValida, pretNormalizat)
    assert.equal(r.preturi[0].pret, null)
    assert.equal(r.preturi[1].pret, j.preturi[1].pret === null ? null : 145.5)
  }
  const r = ruleaza({ ...oferta, preturi: [rand] }, [{ id: 1 }, { id: 2 }], { id: 9 },
    (error: string) => ({ error }), ofertaValida, pretNormalizat)
  assert.ok(r.error); assert.equal(r.preturi, undefined)
})
