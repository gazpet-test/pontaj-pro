import { assertEquals } from 'jsr:@std/assert@1'
import { trimiteLicitatie, type Deps } from './trimitere.ts'

// Resend simulat cu idempotență: aceeași cheie + același payload → replay 2xx (fără mail nou); aceeași cheie + alt payload → 409
function resendFals() {
  const chei = new Map<string, string>()
  let mailuri = 0
  const trimite = async (cheie: string, payload: Record<string, unknown>) => {
    const p = JSON.stringify(payload)
    const vechi = chei.get(cheie)
    if (vechi === undefined) { chei.set(cheie, p); mailuri++; return { status: 200, text: '{"id":"e1"}' } }
    if (vechi === p) return { status: 200, text: '{"id":"e1"}' }
    return { status: 409, text: '{"name":"invalid_idempotent_request","message":"Same idempotency key used with a different request payload."}' }
  }
  return { trimite, mailuri: () => mailuri }
}
const sql = (confirmaOk = true) => {
  const apeluri: string[] = []
  return { apeluri,
    confirma: async () => { apeluri.push('confirma'); return { data: confirmaOk, error: null } },
    elibereaza: async () => { apeluri.push('elibereaza'); return { data: true, error: null } } }
}
const K = 'rc-necitit-101-2026-10-28'
const vechi = { to: ['razvan.trusu@gazpet.ro', 'marilena@gazpet.ro'], subject: 's' }
const nou = { to: ['mirela.rosu@gazpet.ro'], cc: ['razvan.trusu@gazpet.ro'], subject: 's' }

Deno.test('tranziție: aceeași cheie, payload-uri diferite → 409 = conflict, NU trimis; nici confirmare, nici eliberare, niciun mail nou', async () => {
  const r = resendFals(); const s = sql()
  await r.trimite(K, vechi) // versiunea veche a trimis, confirmarea s-a pierdut
  const rez = await trimiteLicitatie(101, K, nou, { trimite: r.trimite, ...s })
  assertEquals(rez.rezultat, 'conflict')
  assertEquals(s.apeluri, [])
  assertEquals(r.mailuri(), 1)
})
Deno.test('replay 2xx cu același payload → trimis (expedierea veche rămâne expedierea zilei), fără mail nou', async () => {
  const r = resendFals(); const s = sql()
  await r.trimite(K, nou)
  const rez = await trimiteLicitatie(101, K, nou, { trimite: r.trimite, ...s })
  assertEquals([rez.rezultat, s.apeluri, r.mailuri()], ['trimis', ['confirma'], 1])
})
Deno.test('2xx dar confirmarea eșuează → trimis_neconfirmat, fără eliberare; reîncercarea cu aceeași cheie confirmă fără dublură', async () => {
  const r = resendFals(); const s1 = sql(false)
  const a = await trimiteLicitatie(101, K, nou, { trimite: r.trimite, ...s1 })
  assertEquals([a.rezultat, s1.apeluri], ['trimis_neconfirmat', ['confirma']])
  const s2 = sql(true)
  const b = await trimiteLicitatie(101, K, nou, { trimite: r.trimite, ...s2 })
  assertEquals([b.rezultat, r.mailuri()], ['trimis', 1])
})
Deno.test('confirmare cu eroare SQL → trimis_neconfirmat', async () => {
  const d: Deps = { trimite: async () => ({ status: 200, text: '{}' }),
    confirma: async () => ({ data: null, error: { message: 'x' } }), elibereaza: async () => { throw new Error('nu') } }
  assertEquals((await trimiteLicitatie(1, K, nou, d)).rezultat, 'trimis_neconfirmat')
})
Deno.test('transport / 5xx / 408 / 429 → necunoscut, fără confirmare sau eliberare', async () => {
  for (const f of [async () => { throw new TypeError('Failed to fetch') }, async () => ({ status: 502, text: '' }),
                   async () => ({ status: 408, text: '' }), async () => ({ status: 429, text: '' })]) {
    const s = sql()
    assertEquals((await trimiteLicitatie(1, K, nou, { trimite: f as Deps['trimite'], ...s })).rezultat, 'necunoscut')
    assertEquals(s.apeluri, [])
  }
})
Deno.test('alt 4xx → refuzat + eliberare', async () => {
  const s = sql()
  const rez = await trimiteLicitatie(1, K, nou, { trimite: async () => ({ status: 422, text: '{"name":"validation_error"}' }), ...s })
  assertEquals([rez.rezultat, rez.eliberat, s.apeluri], ['refuzat', true, ['elibereaza']])
})
