import { strict as assert } from 'node:assert'
import { poartaOfertare, type DepsPoartaOfertare } from './poartaOfertare.ts'

function fixture({ user = 'user-1' as string | null, acces = true as unknown, token = 'token',
  authError = false, rpcError = false, authThrow = false, rpcThrow = false } = {}) {
  const apeluri: string[] = []
  const context: { userId?: string } = {}
  const deps: DepsPoartaOfertare = {
    context,
    env: (name) => ({ SUPABASE_URL: 'https://local.invalid', SUPABASE_ANON_KEY: 'anon-key' })[name],
    createClient: (url, key, options) => {
      apeluri.push('client')
      assert.equal(url, 'https://local.invalid')
      assert.equal(key, 'anon-key')
      assert.equal(options.global.headers.Authorization, `Bearer ${token}`)
      assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false })
      return {
        auth: { getUser: async () => {
          apeluri.push('getUser')
          if (authThrow) throw new Error('auth indisponibil')
          return { data: { user: user ? { id: user } : null }, error: authError || null }
        } },
        rpc: async (name) => {
          apeluri.push(name)
          if (rpcThrow) throw new Error('rpc indisponibil')
          return { data: acces, error: rpcError || null }
        },
      }
    },
  }
  return { deps, apeluri, context }
}
const request = (authorization = 'Bearer token', body = '{}') => new Request('https://local.invalid', {
  method: 'POST', headers: { authorization }, body,
})

for (const header of ['', 'Bearer', 'Bearer   ', 'Basic token', 'token']) {
  Deno.test(`header lipsă/invalid ${JSON.stringify(header)}: 401 înainte de client`, async () => {
    const f = fixture()
    const r = await poartaOfertare(request(header), f.deps)
    assert.equal(r?.status, 401)
    assert.equal(r?.headers.get('Access-Control-Allow-Origin'), '*')
    assert.deepEqual(f.apeluri, [])
  })
}

for (const caz of [
  { nume: 'cheie anon', token: 'anon-key', user: null, status: 401 },
  { nume: 'cheie service_role nu este identitate', token: 'service-key', user: null, status: 401 },
  { nume: 'token invalid', authError: true, status: 401 },
  { nume: 'getUser aruncă', authThrow: true, status: 401 },
  { nume: 'fără modul', acces: false, status: 403 },
  { nume: 'RPC null', acces: null, status: 403 },
  { nume: 'RPC string true', acces: 'true', status: 403 },
  { nume: 'RPC eroare chiar cu data true', rpcError: true, status: 403 },
  { nume: 'RPC aruncă', rpcThrow: true, status: 403 },
]) {
  Deno.test(`${caz.nume}: ${caz.status}, corp invalid necitit, zero AI și scrieri`, async () => {
    const f = fixture(caz)
    let apeluriAI = 0, scrieri = 0
    const fetchAI = async () => { apeluriAI++; return new Response('{}') }
    const db = { insert: async () => { scrieri++ } }
    const req = request(`Bearer ${caz.token || 'token'}`, '{invalid')
    // Același contract de oprire ca în handlers; ordinea lor e verificată mai jos.
    const handler = async () => {
      const refuzAcces = await poartaOfertare(req, f.deps)
      if (refuzAcces) return refuzAcces
      await req.json()
      await fetchAI()
      await db.insert()
      return new Response('{}')
    }
    assert.equal((await handler()).status, caz.status)
    assert.equal(req.bodyUsed, false)
    assert.equal(apeluriAI, 0)
    assert.equal(scrieri, 0)
    assert.equal(f.context.userId, undefined)
    assert.deepEqual(f.apeluri, caz.status === 401
      ? ['client', 'getUser'] : ['client', 'getUser', 'fn_are_acces_ofertare'])
  })
}

Deno.test('utilizator cu modul: null + userId verificat; corpul rămâne pentru handler', async () => {
  const f = fixture()
  const req = request()
  assert.equal(await poartaOfertare(req, f.deps), null)
  assert.equal(f.context.userId, 'user-1')
  assert.deepEqual(f.apeluri, ['client', 'getUser', 'fn_are_acces_ofertare'])
  assert.equal(req.bodyUsed, false)
  // Context reutilizat accidental nu păstrează identitatea după un refuz.
  assert.equal((await poartaOfertare(request(''), f.deps))?.status, 401)
  assert.equal(f.context.userId, undefined)
})

for (const name of ['ofertare-e0-autofill', 'ofertare-inventar-ai', 'ofertare-citire-test', 'ofertare-triere']) {
  Deno.test(`${name}: poarta oprește handlerul înainte de body, service_role, AI și scrieri`, async () => {
    const src = await Deno.readTextFile(new URL(`../${name}/index.ts`, import.meta.url))
    assert.match(src, /import \{ poartaOfertare \} from '\.\.\/_shared\/poartaOfertare.ts'/)
    const handler = src.slice(src.indexOf('Deno.serve('))
    assert.match(handler, /headers: CORS \}\)\s+(?:const identitate: \{ userId\?: string \} = \{\}\s+)?const refuzAcces = await poartaOfertare\(req(?:, \{ context: identitate \})?\)\s+if \(refuzAcces\) return refuzAcces/)
    const gateEnd = handler.indexOf('if (refuzAcces) return refuzAcces')
    for (const operation of ['await req.json()', 'createClient(', 'SUPABASE_SERVICE_ROLE_KEY', 'await fetch(', '.from(']) {
      assert.ok(handler.indexOf(operation) > gateEnd, `${operation} trebuie după poartă`)
    }
    assert.ok(!handler.includes('auth.getUser'), 'identitatea nu se recitește separat')
    if (name === 'ofertare-triere') {
      assert.match(handler, /const userId = identitate.userId!/)
      assert.match(handler, /created_by: userId/)
    }
  })
}
