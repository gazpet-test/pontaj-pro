import { strict as assert } from 'node:assert'
import { decideAcces, pesteLimita } from './poartaRag.ts'

const baza = { intern: false, user: true, isOwner: false, areLogistica: false }

Deno.test('cronul (secret intern valid) trece pe orice acțiune', () => {
  for (const action of ['process_queue', 'process_pending', 'ask', 'x']) {
    assert.deepEqual(decideAcces({ ...baza, user: false, intern: true, action }), { ok: true })
  }
})

Deno.test('fără utilizator (cheia anon, JWT invalid): 401', () => {
  const d = decideAcces({ ...baza, user: false, action: 'ask' })
  assert.equal(d.ok, false); assert.equal((d as { status: number }).status, 401)
})

Deno.test('cont logat fără modul: 403 pe ask, 403 pe procesare', () => {
  for (const action of ['ask', 'process_queue', 'process_pending']) {
    const d = decideAcces({ ...baza, action })
    assert.equal(d.ok, false, action); assert.equal((d as { status: number }).status, 403, action)
  }
})

Deno.test('modul logistica: ask da, procesarea plătită NU', () => {
  assert.deepEqual(decideAcces({ ...baza, areLogistica: true, action: 'ask' }), { ok: true })
  for (const action of ['process_queue', 'process_pending']) {
    assert.equal(decideAcces({ ...baza, areLogistica: true, action }).ok, false, action)
  }
})

Deno.test('owner: tot', () => {
  for (const action of ['ask', 'process_queue', 'process_pending']) {
    assert.deepEqual(decideAcces({ ...baza, isOwner: true, action }), { ok: true })
  }
})

Deno.test('limita QR: numărul include cererea curentă (30 = ultima permisă, 31 = refuz)', () => {
  assert.equal(pesteLimita(30, 100, 30, 200), false)
  assert.equal(pesteLimita(31, 100, 30, 200), true)
  assert.equal(pesteLimita(1, 200, 30, 200), false)
  assert.equal(pesteLimita(1, 201, 30, 200), true)
})

Deno.test('limita QR: numărătoare eșuată (null) = refuz, fail closed', () => {
  assert.equal(pesteLimita(null, 1, 30, 200), true)
  assert.equal(pesteLimita(1, null, 30, 200), true)
})
