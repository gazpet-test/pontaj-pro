import test from 'node:test'
import assert from 'node:assert/strict'
import { salveazaAlegereRegistru } from '../../../src/lib/izoRegistru.js'

const row = { id: 12, pachet_id: 7, updated_at: '2026-10-23T10:00:00Z' }
const piece = { id: 88, serie: 'AB', tip_cod: 'teava', lungime_mm: 12000 }

test('flow picker calls link RPC with row CAS, never client UPDATE', async () => {
  const calls = []
  const client = {
    rpc: async (...args) => { calls.push(args); return { data: { cod: 'legat' }, error: null } },
    from: () => assert.fail('client UPDATE on flow'),
  }
  assert.equal((await salveazaAlegereRegistru(client, row, 7, piece, true)).ok, true)
  assert.deepEqual(calls, [['fn_izo_pachet_leaga', { p_teava: 12, p_bucata: 88, p_updated_at: row.updated_at }]])
})

test('CAS/authorization refusal never falls back to legacy UPDATE', async () => {
  for (const message of ['pachet_schimbat', 'fara_drept', 'bucata_deja_legata']) {
    const error = { message }
    const result = await salveazaAlegereRegistru({
      rpc: async () => ({ error }), from: () => assert.fail('fallback UPDATE'),
    }, row, 7, piece, true)
    assert.equal(result.ok, false)
    assert.equal(result.error, error)
  }
})

test('unread flow configuration performs no write', async () => {
  const result = await salveazaAlegereRegistru({ rpc: () => assert.fail(), from: () => assert.fail() }, row, 7, piece, null)
  assert.equal(result.ok, false)
})

test('non-flow retains legacy patch and CAS on row + package', async () => {
  const calls = []
  const query = {
    update(patch) { calls.push(['update', patch]); return this },
    eq(...args) { calls.push(['eq', ...args]); return this },
    async select(...args) { calls.push(['select', ...args]); return { data: [{ id: 12 }], error: null } },
  }
  const result = await salveazaAlegereRegistru({
    from(table) { calls.push(['from', table]); return query }, rpc: () => assert.fail('RPC on non-flow'),
  }, row, 7, piece, false)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['from', 'executie_tevi'], ['update', { serie_unica: 'AB', lungime_m: 12 }],
    ['eq', 'id', 12], ['eq', 'pachet_id', 7], ['select', 'id']])
})
