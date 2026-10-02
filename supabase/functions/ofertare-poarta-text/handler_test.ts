import { strict as assert } from 'node:assert'
import { handle } from './handler.ts'
import { PARSER_VERSION } from './evalueaza.mjs'
import { TEXT_OK } from '../../../test-fixtures/jakv2p3/poarta.mjs'

const req = (body: unknown = { licitatie_id: 1 }) => new Request('http://localhost/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
Deno.test('JWT absent: refuz înainte de service_role', async () => {
  const r = await handle(req(), { client: () => { throw Error('Nu trebuie creat') } })
  assert.equal(r.status, 401)
})
Deno.test('Fără rol: refuz înainte de service_role', async () => {
  const r = await handle(req(), { gate: async () => new Response('', { status: 403 }), client: () => { throw Error('Nu trebuie creat') } })
  assert.equal(r.status, 403)
})
Deno.test('Sursa e citită pe server, body falsificat ignorat; parser errors persistate', async () => {
  for (const date of [TEXT_OK, {}]) {
    let scrise: any[] = []
    const r = await handle(req({ licitatie_id: 1, date: TEXT_OK, sursa_hash: 'fals', stare: 'ok' }), {
      gate: async () => null,
      client: async () => ({ rpc: async (n: string, p: unknown) => {
        assert.equal(n, 'ofertare_poarta_text_sursa'); assert.deepEqual(p, { p_licitatie_id: 1 })
        return { data: { date, parser_version: PARSER_VERSION, sursa_hash: 'a'.repeat(64) } }
      }, from: (n: string) => {
        assert.equal(n, 'ofertare_poarta_rezultate_text')
        return { insert: async (r: any[]) => { scrise = r; return {} } }
      } }),
    })
    assert.equal(r.status, 200); assert.equal(scrise.length, 4)
    assert.ok(scrise.every(r => r.parser_version === PARSER_VERSION && r.sursa_hash === 'a'.repeat(64)))
    assert.ok(scrise.every(r => r.stare === (date === TEXT_OK ? 'ok' : 'undetermined')))
  }
})
Deno.test('Parser vechi / sursă lipsă nu scriu verde', async () => {
  for (const data of [null, { parser_version: 'vechi', sursa_hash: 'a'.repeat(64) }]) {
    const r = await handle(req(), { gate: async () => null, client: async () => ({ rpc: async () => ({ data }) }) })
    assert.equal(r.status, 409)
  }
})
