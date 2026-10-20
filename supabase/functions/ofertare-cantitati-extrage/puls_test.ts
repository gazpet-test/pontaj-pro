import { assert, assertEquals } from 'jsr:@std/assert@1'
import { raspunsCuPuls } from './puls.ts'

const H = { 'Content-Type': 'application/json' }
const dupa = <T>(ms: number, v: T) => new Promise<T>((ok) => setTimeout(() => ok(v), ms))

Deno.test('puls: lucru rapid → răspunsul obișnuit, cu statusul real', async () => {
  const r = await raspunsCuPuls(Promise.resolve({ status: 402, body: { ok: false, error: 'fără cerere' } }), H, { primaMs: 50 })
  assertEquals(r.status, 402)
  assertEquals(await r.json(), { ok: false, error: 'fără cerere' })
})

Deno.test('puls: lucru lent → 200 imediat, spații de puls, apoi JSON valid citit de response.json()', async () => {
  const r = await raspunsCuPuls(dupa(120, { status: 200, body: { ok: true, felii_apelate: 3 } }), H, { primaMs: 10, pulsMs: 20 })
  assertEquals(r.status, 200)
  const txt = await r.text()
  assert(/^ {2,}\{/.test(txt), 'începe cu spații de puls: ' + JSON.stringify(txt.slice(0, 20)))
  assertEquals(JSON.parse(txt), { ok: true, felii_apelate: 3 })
})

Deno.test('puls: status final ≠ 200 după începerea fluxului → în corp, cu error', async () => {
  const r = await raspunsCuPuls(dupa(60, { status: 409, body: { ok: false } }), H, { primaMs: 10, pulsMs: 20 })
  assertEquals(r.status, 200)
  assertEquals(await r.json(), { ok: false, status_http: 409, error: 'status 409' })
})

Deno.test('puls: excepție (rapidă sau lentă) → error, nu răspuns rupt', async () => {
  const a = await raspunsCuPuls(Promise.reject(new Error('boom')), H, { primaMs: 50 })
  assertEquals(a.status, 500); assertEquals((await a.json()).error, 'exceptie: boom')
  const b = await raspunsCuPuls(dupa(60, null).then(() => { throw new Error('tarziu') }), H, { primaMs: 10, pulsMs: 20 })
  assertEquals(await b.json(), { error: 'exceptie: tarziu', status_http: 500 })
})
