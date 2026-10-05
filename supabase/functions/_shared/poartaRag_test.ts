import { strict as assert } from 'node:assert'
import { decideAcces, nivelMaxim } from './poartaRag.ts'

const baza = { intern: false, user: true, isOwner: false, nivelLogistica: null as 'admin' | 'editor' | 'viewer' | null }
const status = (d: ReturnType<typeof decideAcces>) => (d.ok ? 200 : d.status)

Deno.test('cronul (secret intern valid) trece pe orice acțiune', () => {
  for (const action of ['process_queue', 'process_pending', 'ask', 'x']) {
    assert.equal(status(decideAcces({ ...baza, user: false, intern: true, action, ai: true })), 200)
  }
})

Deno.test('fără utilizator (cheia anon, JWT invalid): 401', () => {
  assert.equal(status(decideAcces({ ...baza, user: false, action: 'ask' })), 401)
})

Deno.test('cont logat fără modul: 403 pe ask (cu și fără AI) și pe procesare', () => {
  for (const [action, ai] of [['ask', false], ['ask', true], ['process_queue', false], ['process_pending', false]] as const) {
    assert.equal(status(decideAcces({ ...baza, action, ai })), 403, `${action} ai=${ai}`)
  }
})

Deno.test('logistica viewer: căutare da, AI NU, procesare NU', () => {
  const v = { ...baza, nivelLogistica: 'viewer' as const }
  assert.equal(status(decideAcces({ ...v, action: 'ask', ai: false })), 200)
  assert.equal(status(decideAcces({ ...v, action: 'ask', ai: true })), 403)
  assert.equal(status(decideAcces({ ...v, action: 'process_queue' })), 403)
})

Deno.test('logistica editor/admin: AI da (cota e în BD), procesarea plătită NU', () => {
  for (const n of ['editor', 'admin'] as const) {
    assert.equal(status(decideAcces({ ...baza, nivelLogistica: n, action: 'ask', ai: true })), 200, n)
    assert.equal(status(decideAcces({ ...baza, nivelLogistica: n, action: 'process_pending' })), 403, n)
  }
})

Deno.test('owner: tot', () => {
  for (const action of ['ask', 'process_queue', 'process_pending']) {
    assert.equal(status(decideAcces({ ...baza, isOwner: true, action, ai: true })), 200, action)
  }
})

Deno.test('nivelMaxim alege cel mai înalt nivel, null fără rânduri', () => {
  assert.equal(nivelMaxim(['viewer', 'admin']), 'admin')
  assert.equal(nivelMaxim(['viewer', 'editor']), 'editor')
  assert.equal(nivelMaxim(['viewer']), 'viewer')
  assert.equal(nivelMaxim([]), null)
  assert.equal(nivelMaxim(['ceva']), null)
})
