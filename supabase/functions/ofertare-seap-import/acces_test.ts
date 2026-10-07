// deno test supabase/functions/ofertare-seap-import/acces_test.ts — poarta de acces a importului SEAP (audit #19)
import { strict as assert } from 'node:assert'
import { autorizeaza } from './acces.ts'

const SERVICE = 'cheie-service-test'
const env = (n: string) => ({ SUPABASE_URL: 'https://x.invalid', SUPABASE_ANON_KEY: 'anon' } as Record<string, string>)[n]
const client = (o: { user?: string | null; acces?: boolean; eroareRpc?: boolean }) => () => ({
  auth: { getUser: async () => ({ data: { user: o.user ? { id: o.user } : null }, error: o.user ? null : { message: 'jwt' } }) },
  rpc: async (name: string) => { assert.equal(name, 'fn_are_acces_ofertare'); return o.eroareRpc ? { data: null, error: { message: 'rpc' } } : { data: o.acces === true, error: null } },
})
const cerere = (auth?: string) => new Request('https://x.invalid/functions/v1/ofertare-seap-import', { method: 'POST', headers: auth ? { Authorization: auth } : {} })
const da = async () => true, nu = async () => false

Deno.test('acces: secretul rutinelor și cheia service (veghea) trec ca înainte, fără poarta de utilizator', async () => {
  let creat = 0
  const deps = { env, createClient: (() => { creat++; return client({})() }) as any }
  assert.equal(await autorizeaza(cerere(), da, SERVICE, deps), null)
  assert.equal(await autorizeaza(cerere(`Bearer ${SERVICE}`), nu, SERVICE, deps), null)
  assert.equal(creat, 0, 'nu se interoghează utilizatorul pe drumurile interne')
})

Deno.test('acces #19: utilizator logat FĂRĂ acces la Ofertare → 403; cu acces → permis', async () => {
  const fara = await autorizeaza(cerere('Bearer jwt-utilizator'), nu, SERVICE, { env, createClient: client({ user: 'u1', acces: false }) as any })
  assert.equal(fara?.status, 403)
  const cu = await autorizeaza(cerere('Bearer jwt-utilizator'), nu, SERVICE, { env, createClient: client({ user: 'u1', acces: true }) as any })
  assert.equal(cu, null)
  const eroare = await autorizeaza(cerere('Bearer jwt-utilizator'), nu, SERVICE, { env, createClient: client({ user: 'u1', eroareRpc: true }) as any })
  assert.equal(eroare?.status, 403, 'eroarea verificării = refuz, nu permis')
})

Deno.test('acces: fără antet, JWT invalid sau cheie service nesetată → 401', async () => {
  assert.equal((await autorizeaza(cerere(), nu, SERVICE, { env, createClient: client({}) as any }))?.status, 401)
  assert.equal((await autorizeaza(cerere('Bearer gunoi'), nu, SERVICE, { env, createClient: client({ user: null }) as any }))?.status, 401)
  assert.equal((await autorizeaza(cerere('Bearer '), nu, undefined, { env, createClient: client({ user: null }) as any }))?.status, 401)
})
