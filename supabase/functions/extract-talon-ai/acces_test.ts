import { strict as assert } from 'node:assert'
import { decideTalon, poartaTalon } from './acces.ts'

const st = (d: { ok: boolean; status?: number }) => (d.ok ? 200 : d.status)

Deno.test('decideTalon: fără utilizator 401, owner trece, admin_logistica + modul trece, altfel 403', () => {
  assert.equal(st(decideTalon({ userId: null, isOwner: true, rol: 'admin_logistica', areModul: true })), 401)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: true, rol: 'superadmin', areModul: false })), 200)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: false, rol: 'admin_logistica', areModul: true })), 200)
  // rolul singur nu ajunge (acces dual)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: false, rol: 'admin_logistica', areModul: false })), 403)
  // modulul singur nu ajunge (ex. superadmin / manager_santier / contabilitate cu Logistică)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: false, rol: 'superadmin', areModul: true })), 403)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: false, rol: 'manager_santier', areModul: true })), 403)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: false, rol: 'contabilitate', areModul: true })), 403)
  assert.equal(st(decideTalon({ userId: 'u', isOwner: false, rol: null, areModul: false })), 403)
})

// client fals: auth.getUser + profiles(is_owner, role) + user_module_access(module)
type Opt = { user?: string | null; owner?: boolean; rol?: string | null; module?: string[]; eroareProf?: boolean; eroareAcc?: boolean; arunca?: boolean }
const fals = (o: Opt) => ({
  auth: { getUser: async (jwt: string) => {
    if (o.arunca) throw new Error('retea')
    return jwt === 'bun' && o.user ? { data: { user: { id: o.user } }, error: null } : { data: { user: null }, error: { message: 'invalid' } }
  } },
  from: (t: string) => ({ select: () => ({ eq: (_c: string, _v: string) => ({
    maybeSingle: async () => (o.eroareProf ? { data: null, error: { message: 'x' } }
      : { data: t === 'profiles' ? { is_owner: !!o.owner, role: o.rol ?? null } : null, error: null }),
    eq: (_c2: string, modul: string) => ({ limit: async () => (o.eroareAcc ? { data: null, error: { message: 'x' } }
      : { data: (o.module || []).filter(m => m === modul).map(module => ({ module })), error: null }) }),
  }) }) }),
})
const cerere = (h: Record<string, string> = {}) => new Request('https://x/extract-talon-ai', { method: 'POST', headers: h })

Deno.test('poartaTalon: fără antet / token invalid (ex. cheia anon) → 401', async () => {
  assert.equal(st(await poartaTalon(cerere(), fals({ user: 'u', owner: true }))), 401)
  assert.equal(st(await poartaTalon(cerere({ Authorization: 'Bearer anon' }), fals({ user: 'u', owner: true }))), 401)
  assert.equal(st(await poartaTalon(cerere({ Authorization: 'Bearer ' }), fals({ user: 'u', owner: true }))), 401)
})

Deno.test('poartaTalon: antetul intern vechi nu mai deschide nimic', async () => {
  const h = { 'x-internal-secret': 'x'.repeat(24) }
  assert.equal(st(await poartaTalon(cerere(h), fals({ user: 'u', owner: true }))), 401)
  assert.equal(st(await poartaTalon(cerere({ ...h, Authorization: 'Bearer bun' }), fals({ user: 'u', rol: 'manager_santier', module: ['logistica'] }))), 403)
})

Deno.test('poartaTalon: owner 200; admin_logistica cu modul 200; fără modul sau alt rol 403', async () => {
  const bun = { Authorization: 'Bearer bun' }
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', owner: true, rol: 'superadmin' }))), 200)
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', rol: 'admin_logistica', module: ['logistica'] }))), 200)
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', rol: 'admin_logistica', module: ['magazie'] }))), 403)
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', rol: 'superadmin', module: ['logistica'] }))), 403)
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', rol: 'manager_santier', module: ['logistica'] }))), 403)
})

Deno.test('poartaTalon: eroare la citire sau excepție → refuz (fail closed)', async () => {
  const bun = { Authorization: 'Bearer bun' }
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', owner: true, eroareProf: true }))), 403)
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', rol: 'admin_logistica', module: ['logistica'], eroareAcc: true }))), 403)
  // și owner-ul e refuzat dacă user_module_access nu se poate citi: nu ghicim
  assert.equal(st(await poartaTalon(cerere(bun), fals({ user: 'u', owner: true, eroareAcc: true }))), 403)
  assert.equal(st(await poartaTalon(cerere(bun), fals({ arunca: true }))), 403)
})
