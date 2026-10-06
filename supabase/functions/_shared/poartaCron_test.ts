import { strict as assert } from 'node:assert'
import { ANTET_INTERN } from './poartaIntern.ts'
import { cronSauOwner } from './poartaCron.ts'

const BUN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'

// Client fals: rpc (fn_verifica_secret), auth.getUser, from('profiles')…maybeSingle
function client(o: { secretOk?: boolean; user?: string | null; owner?: boolean; aruncaAuth?: boolean } = {}) {
  const apeluri: string[] = []
  return {
    apeluri,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      apeluri.push(fn)
      return { data: fn === 'fn_verifica_secret' && o.secretOk === true && args.p_secret === BUN, error: null }
    },
    auth: {
      getUser: async (_jwt: string) => {
        apeluri.push('getUser')
        if (o.aruncaAuth) throw new Error('auth indisponibil')
        return { data: { user: o.user ? { id: o.user } : null }, error: null }
      },
    },
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.user ? { is_owner: o.owner === true } : null, error: null }) }) }),
    }),
  }
}
const cerere = (h: Record<string, string> = {}) => new Request('https://local.invalid/functions/v1/x', { method: 'POST', headers: h })

Deno.test('cronul cu secretul intern valid → cron, fără să mai citească JWT-ul', async () => {
  const c = client({ secretOk: true })
  assert.equal(await cronSauOwner(cerere({ [ANTET_INTERN]: BUN, Authorization: 'Bearer eyJ.a.b' }), c), 'cron')
  assert.ok(!c.apeluri.includes('getUser'))
})

Deno.test('secret intern greșit + cheia anon (fără utilizator) → refuz', async () => {
  assert.equal(await cronSauOwner(cerere({ [ANTET_INTERN]: 'f'.repeat(64), Authorization: 'Bearer eyJ.anon.x' }), client({ secretOk: true })), null)
})

Deno.test('vechiul x-ingest-secret nu mai deschide poarta', async () => {
  assert.equal(await cronSauOwner(cerere({ 'x-ingest-secret': 'orice', Authorization: 'Bearer eyJ.anon.x' }), client()), null)
})

Deno.test('fără nimic → refuz, fără apel la auth', async () => {
  const c = client()
  assert.equal(await cronSauOwner(cerere(), c), null)
  assert.ok(!c.apeluri.includes('getUser'))
})

Deno.test('cont logat care nu e owner → refuz', async () => {
  assert.equal(await cronSauOwner(cerere({ Authorization: 'Bearer eyJ.u.x' }), client({ user: 'u1', owner: false })), null)
})

Deno.test('owner logat → owner', async () => {
  assert.equal(await cronSauOwner(cerere({ Authorization: 'Bearer eyJ.o.x' }), client({ user: 'o1', owner: true })), 'owner')
})

Deno.test('auth aruncă → refuz (fail closed)', async () => {
  assert.equal(await cronSauOwner(cerere({ Authorization: 'Bearer eyJ.o.x' }), client({ aruncaAuth: true })), null)
})
