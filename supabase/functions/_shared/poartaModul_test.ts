import { strict as assert } from 'node:assert'
import { decideModul, poartaModul } from './poartaModul.ts'

const st = (d: { ok: boolean; status?: number }) => (d.ok ? 200 : d.status)

Deno.test('decideModul: fără utilizator 401, owner trece, modul explicit trece, altfel 403', () => {
  assert.equal(st(decideModul({ userId: null, isOwner: true, moduleAvute: ['financiar'] }, ['financiar'])), 401)
  assert.equal(st(decideModul({ userId: 'u', isOwner: true, moduleAvute: [] }, ['financiar'])), 200)
  assert.equal(st(decideModul({ userId: 'u', isOwner: false, moduleAvute: ['financiar'] }, ['financiar'])), 200)
  assert.equal(st(decideModul({ userId: 'u', isOwner: false, moduleAvute: ['financiar.garantii'] }, ['financiar'])), 403)
  assert.equal(st(decideModul({ userId: 'u', isOwner: false, moduleAvute: [] }, ['executie'])), 403)
})

// client fals: getUser + profiles + user_module_access
const fals = (o: { user?: string | null; owner?: boolean; module?: string[]; eroareAcc?: boolean; arunca?: boolean }) => ({
  auth: { getUser: async (jwt: string) => {
    if (o.arunca) throw new Error('retea')
    return jwt === 'bun' && o.user ? { data: { user: { id: o.user } }, error: null } : { data: { user: null }, error: { message: 'invalid' } }
  } },
  from: (t: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: t === 'profiles' ? { is_owner: !!o.owner } : null, error: null }),
    in: async (_c: string, cerute: string[]) => ({ data: o.eroareAcc ? null : (o.module || []).filter(m => cerute.includes(m)).map(module => ({ module })), error: o.eroareAcc ? { message: 'x' } : null }),
  }) }) }),
})
const cerere = (auth?: string) => new Request('https://x/f', { method: 'POST', headers: auth ? { Authorization: auth } : {} })

Deno.test('poartaModul: fără antet / token invalid (ex. cheia anon) → 401', async () => {
  assert.equal(st(await poartaModul(cerere(), fals({ user: 'u' }), ['financiar'])), 401)
  assert.equal(st(await poartaModul(cerere('Bearer anon'), fals({ user: 'u', owner: true }), ['financiar'])), 401)
})
Deno.test('poartaModul: cont fără modul → 403, cu modul → 200, owner → 200', async () => {
  assert.equal(st(await poartaModul(cerere('Bearer bun'), fals({ user: 'u', module: ['logistica'] }), ['financiar'])), 403)
  assert.equal(st(await poartaModul(cerere('Bearer bun'), fals({ user: 'u', module: ['financiar'] }), ['financiar'])), 200)
  assert.equal(st(await poartaModul(cerere('Bearer bun'), fals({ user: 'u', owner: true }), ['executie'])), 200)
})
Deno.test('poartaModul: eroare la citire sau excepție → refuz', async () => {
  assert.equal(st(await poartaModul(cerere('Bearer bun'), fals({ user: 'u', module: ['financiar'], eroareAcc: true }), ['financiar'])), 403)
  assert.equal(st(await poartaModul(cerere('Bearer bun'), fals({ arunca: true }), ['financiar'])), 403)
})
