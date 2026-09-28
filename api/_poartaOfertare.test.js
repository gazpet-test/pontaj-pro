import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(),
  from: vi.fn(), insert: vi.fn(), update: vi.fn(), upload: vi.fn(), fetch: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
// Testăm poarta handlerelor fără a încărca bibliotecile native de randare.
vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('./_randare-pdf.js', () => ({ randeazaVectorial: vi.fn(), analizeazaSemnale: vi.fn() }))
vi.mock('pdf-lib', () => ({ PDFDocument: {} }))

import { poartaOfertare } from './_poartaOfertare.js'
import cad from './cad-parse.js'
import pdf from './pdf-sparge.js'
import plansa from './plansa-felii.js'
import seap from './seap-import.js'

const req = (headers = { authorization: 'Bearer user-token' }, body = {}) => ({ method: 'POST', headers, body })
const response = () => {
  const res = { statusCode: 200, body: undefined }
  res.status = vi.fn((code) => { res.statusCode = code; return res })
  res.json = vi.fn((body) => { res.body = body; return res })
  res.end = vi.fn(() => res)
  return res
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://local.invalid')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('SEAP_IMPORT_SECRET', 'internal-secret')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: true, error: null })
  mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc,
    from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } })
  mocks.from.mockReturnValue({ insert: mocks.insert, update: mocks.update })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('helper Node: identitate înainte de RPC; refuz implicit la erori', () => {
  it.each(['', 'Bearer', 'Basic token', 'token', ['Bearer token']])('header invalid %j => 401', async (authorization) => {
    expect((await poartaOfertare(req({ authorization }))).status).toBe(401)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it.each(['anon-key', 'service-key', 'invalid-token'])('%s fără user => 401, fără RPC', async (token) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await poartaOfertare(req({ authorization: `Bearer ${token}` }))).status).toBe(401)
    expect(mocks.getUser).toHaveBeenCalledWith(token)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('eroare getUser, chiar cu user în răspuns => 401', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: new Error('auth') })
    expect((await poartaOfertare(req())).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('excepție getUser => 401', async () => {
    mocks.getUser.mockRejectedValue(new Error('auth'))
    expect((await poartaOfertare(req())).status).toBe(401)
  })
  it.each([false, null, 'true', 1])('RPC data=%j => 403', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect((await poartaOfertare(req())).status).toBe(403)
  })
  it('RPC eroare cu data true sau excepție => 403', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: new Error('RPC') }).mockRejectedValueOnce(new Error('RPC'))
    expect((await poartaOfertare(req())).status).toBe(403)
    expect((await poartaOfertare(req())).status).toBe(403)
  })
  it('acces => null și userId; RPC folosește Authorization al aceluiași utilizator', async () => {
    const context = {}
    expect(await poartaOfertare(req(), { context })).toBeNull()
    expect(context.userId).toBe('user-1')
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
    expect(mocks.createClient).toHaveBeenCalledWith('https://local.invalid', 'anon-key', {
      global: { headers: { Authorization: 'Bearer user-token' } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('fn_are_acces_ofertare')
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect((await poartaOfertare(req({}), { context })).status).toBe(401)
    expect(context.userId).toBeUndefined()
  })
  it('dependențele pot fi injectate; fallback VITE este păstrat', async () => {
    expect(await poartaOfertare(req(), { createClient: mocks.createClient, env: {
      VITE_SUPABASE_URL: 'https://local.invalid', VITE_SUPABASE_ANON_KEY: 'anon-key',
    } })).toBeNull()
    expect((await poartaOfertare(req(), { env: {} })).status).toBe(401)
  })
})

describe.each([['cad-parse', cad], ['pdf-sparge', pdf], ['plansa-felii', plansa], ['seap-import', seap]])('%s: handler real', (name, handler) => {
  it.each(['fără token', 'anon', 'service_role', 'fără modul', 'RPC eroare'])('%s: refuz înainte de body, zero AI/scrieri/service_role', async (caz) => {
    const r = req()
    let status = 401
    if (caz === 'fără token') r.headers = {}
    if (caz === 'anon' || caz === 'service_role') {
      r.headers.authorization = `Bearer ${caz === 'anon' ? 'anon-key' : 'service-key'}`
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    }
    if (caz === 'fără modul' || caz === 'RPC eroare') {
      status = 403
      mocks.rpc.mockResolvedValue({ data: caz === 'RPC eroare', error: caz === 'RPC eroare' ? new Error('RPC') : null })
    }
    const bodyRead = vi.fn(() => { throw new Error('corpul nu trebuie citit') })
    Object.defineProperty(r, 'body', { get: bodyRead })
    const res = response()
    await handler(r, res)
    expect(res.statusCode).toBe(status)
    expect(bodyRead).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.createClient.mock.calls.some(([, key]) => key === 'service-key')).toBe(false)
  })
  it('body JSON invalid + fără modul => 403', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    const res = response()
    await handler(req(undefined, '{invalid'), res)
    expect(res.statusCode).toBe(403)
  })
  it('user cu modul trece la validarea parametrilor', async () => {
    const res = response()
    await handler(req(), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/lips[aă]/)
    expect(mocks.rpc).toHaveBeenCalledWith('fn_are_acces_ofertare')
  })
  if (name !== 'seap-import') it('secretul intern nu ocolește poarta JWT', async () => {
    const res = response()
    await handler(req({ 'x-import-secret': 'internal-secret' }), res)
    expect(res.statusCode).toBe(401)
  })
})

describe('seap-import: excepția internă este limitată la secretul corect și configurat', () => {
  it('secret corect fără JWT trece la validarea parametrilor', async () => {
    const res = response()
    await seap(req({ 'x-import-secret': 'internal-secret' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('licitatie_id lipsa')
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['internal-secret', 'greșit'], ['internal-secret', undefined], ['', ''], [undefined, undefined],
  ])('secret configurat %j și primit %j fără JWT => 401', async (secret, primit) => {
    vi.stubEnv('SEAP_IMPORT_SECRET', secret)
    const res = response()
    await seap(req({ 'x-import-secret': primit }), res)
    expect(res.statusCode).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('secret greșit permite fallback JWT numai cu modul', async () => {
    const r = req({ 'x-import-secret': 'greșit', authorization: 'Bearer user-token' })
    const res = response()
    await seap(r, res)
    expect(res.statusCode).toBe(400)
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await seap(r, res)
    expect(res.statusCode).toBe(403)
  })
})

it('workflow: helper-ele și rutele declanșează regresia; ambele suite sunt executate', () => {
  const src = readFileSync(new URL('../.github/workflows/ofertare-regresie.yml', import.meta.url), 'utf8')
  for (const path of ['api/_poartaOfertare*', 'supabase/functions/_shared/**', 'api/cad-parse.js', 'api/pdf-sparge.js', 'api/plansa-felii.js', 'api/seap-import.js']) {
    expect(src.split(`- '${path}'`).length - 1).toBe(2)
  }
  expect(src).toMatch(/run: npx vitest run .*api\/_poartaOfertare.test.js/)
  expect(src).toMatch(/deno test -A --node-modules-dir=none\s+supabase\/functions\/_shared/)
})
