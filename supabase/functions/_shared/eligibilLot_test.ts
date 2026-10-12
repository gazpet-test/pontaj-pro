import { strict as assert } from 'node:assert'
import { documentEligibil, eligibilitateLicitatie, esteEligibil, mesajLot } from './eligibilLot.ts'

const client = (raspuns: unknown, eroare: unknown = null, arunca = false) => ({
  apeluri: [] as Array<[string, Record<string, unknown>]>,
  rpc(name: string, args: Record<string, unknown>) {
    this.apeluri.push([name, args])
    if (arunca) return Promise.reject(new Error('retea'))
    return Promise.resolve({ data: raspuns, error: eroare })
  },
})

Deno.test('documentEligibil: eligibil din RPC', async () => {
  const c = client({ eligibil: true, motiv: 'comun', licitatie_id: 102 })
  assert.deepEqual(await documentEligibil(c, 1247), { eligibil: true, motiv: 'comun', licitatie_id: 102 })
  assert.deepEqual(c.apeluri, [['fn_ofertare_document_eligibil', { p_document_id: 1247 }]])
})

Deno.test('documentEligibil: fail-closed la eroare, excepție, răspuns ciudat', async () => {
  for (const c of [client(null, { message: 'x' }), client(null, null, true), client({ eligibil: 'true', motiv: 'comun' }),
    client({ motiv: 'comun' }), client(null)]) {
    const r = await documentEligibil(c, 1)
    assert.equal(r.eligibil, false)
    assert.equal(r.motiv, 'eroare_poarta')
  }
})

Deno.test('documentEligibil: neeligibil păstrează motivul', async () => {
  const r = await documentEligibil(client({ eligibil: false, motiv: 'de_triat', licitatie_id: 102 }), 9)
  assert.deepEqual(r, { eligibil: false, motiv: 'de_triat', licitatie_id: 102 })
  assert.match(mesajLot(r.motiv), /nu e triat/)
})

Deno.test('eligibilitateLicitatie: hartă + lipsă = neeligibil', async () => {
  const { ok, harta } = await eligibilitateLicitatie(client([
    { document_id: 1, eligibil: true, motiv: 'comun' },
    { document_id: 2, eligibil: false, motiv: 'in_afara_loturilor' },
  ]), 102)
  assert.equal(ok, true)
  assert.equal(esteEligibil(harta, 1), true)
  assert.equal(esteEligibil(harta, 2), false)
  assert.equal(esteEligibil(harta, 3), false)
})

Deno.test('eligibilitateLicitatie: eroare = ok false, hartă goală', async () => {
  for (const c of [client(null, { message: 'x' }), client(null, null, true), client({ nu: 'lista' })]) {
    const { ok, harta } = await eligibilitateLicitatie(c, 102)
    assert.equal(ok, false)
    assert.equal(harta.size, 0)
  }
})
