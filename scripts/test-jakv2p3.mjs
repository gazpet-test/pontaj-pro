import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evalueazaTexte, PARSER_VERSION } from '../supabase/functions/ofertare-poarta-text/evalueaza.mjs'
import { controlGarantie, controlAnexe, controlNumereCheie, controlPachetComplet } from '../src/ofertareControale.js'
import { evalueazaPoarta } from '../src/ofertarePoarta.js'
import { citestePoartaServer, randPoartaServer } from '../src/ofertarePoartaServer.js'
import { TEXT_OK, CAZURI_TEXT, SERVER_OK } from '../test-fixtures/jakv2p3/poarta.mjs'

test('Versiunea parserului Edge coincide cu cea acceptată de SQL', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql', import.meta.url), 'utf8')
  const version = sql.match(/ofertare_poarta_parser_version\(\) RETURNS text[\s\S]*?SELECT '([^']+)'::text/)
  assert.equal(version?.[1], PARSER_VERSION)
})

test('M01: aceleași funcții UI/Edge, fiecare control text ok și block', () => {
  const controale = [controlGarantie, controlAnexe, controlNumereCheie, controlPachetComplet]
  for (const patch of [{}, ...CAZURI_TEXT.map(([, p]) => p)]) {
    const date = { ...TEXT_OK, ...patch }
    const rezultate = evalueazaTexte(date)
    for (const fn of controale) {
      const ui = fn(date), edge = rezultate.find(r => r.control_code === ui.k)
      assert.deepEqual(edge.detalii, ui)
      assert.equal(edge.stare, ui.stare === 'block' ? 'block' : 'ok')
    }
  }
  assert.ok(evalueazaTexte(TEXT_OK).every(r => r.stare === 'ok'))
  for (const [k, patch] of CAZURI_TEXT) assert.equal(evalueazaTexte({ ...TEXT_OK, ...patch }).find(r => r.control_code === k).stare, 'block')
})
test('Lipsă sursă și excepție parser => undetermined, niciodată ok', () => {
  assert.ok(evalueazaTexte({}).every(r => r.stare === 'undetermined'))
  assert.equal(evalueazaTexte({ ...TEXT_OK, anexe_referite: 42 }).find(r => r.control_code === 'anexe').stare, 'undetermined')
})
test('WARN existent nu devine regulă BLOCK nouă', () => {
  const r = evalueazaTexte({ ...TEXT_OK, bransamente_in_cerinte: [371, 372] }).find(r => r.control_code === 'numere')
  assert.equal(r.stare, 'ok'); assert.equal(r.detalii.stare, 'warn')
})
test('RPC lipsă, răspuns parțial / contradictoriu / undetermined => UI block', () => {
  assert.equal(randPoartaServer({ poarta_server: SERVER_OK }).stare, 'ok')
  for (const server of [null, {}, { ...SERVER_OK, controale: [] }, { ...SERVER_OK, stare: 'block' },
    { ...SERVER_OK, controale: SERVER_OK.controale.map((r, i) => i ? r : { ...r, stare: 'undetermined' }) },
    { ...SERVER_OK, controale: Array(12).fill(SERVER_OK.controale[0]) }]) {
    assert.equal(randPoartaServer({ poarta_server: server }).stare, 'block')
  }
  assert.ok(evalueazaPoarta({}).blocaje.includes('server'))
})
test('H1 rămâne BUSINESS_DECISION_REQUIRED, nu contribuie la verde și nu blochează', () => {
  const r = evalueazaPoarta({ poarta_server: SERVER_OK }).randuri.find(r => r.k === 'identitate')
  assert.equal(r.stare, 'warn'); assert.equal(r.cod, 'BUSINESS_DECISION_REQUIRED')
})
test('UI recalculează pe server apoi citește RPC; o eroare nu produce verde', async () => {
  const calls = []
  const client = { functions: { invoke: async (n, b) => { calls.push([n, b]); return { data: {} } } },
    rpc: async (n, b) => { calls.push([n, b]); return { data: SERVER_OK } } }
  assert.deepEqual((await citestePoartaServer(client, 1, { recalculeazaText: true })).poarta_server, SERVER_OK)
  assert.deepEqual(calls.map(x => x[0]), ['ofertare-poarta-text', 'ofertare_poarta_server'])
  client.functions.invoke = async () => ({ error: { message: 'indisponibil' } })
  assert.equal((await citestePoartaServer(client, 1, { recalculeazaText: true })).poarta_server, null)
})
