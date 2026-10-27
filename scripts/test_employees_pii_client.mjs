import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const source = readFileSync(new URL('src/employeesPersonal.js', root), 'utf8')
const personal = ['cnp', 'iban', 'adresa', 'data_nasterii', 'telefon', 'email', 'observatii_hr', 'qr_pin', 'qr_pin_active', 'qr_pin_creat_la', 'marime_incaltaminte', 'marime_imbracaminte']
const expectedPublic = ['id','name','department','position','active','created_at','site_id','hire_date','termination_date','functii_extra','functie','departament_hr','rol_in_firma','are_autorizatii','cetatenie','tip_contract','procent_ocupare','co_maxim_zile','cetatenie_secundara','protejat_la_stergere','cod_cor','functie_cim','colaborare_externa_status','colaborare_externa_confirmat_de','colaborare_externa_confirmat_la','colaborare_externa_nota','colaborare_externa_document']

// Module ES izolat per test, fara Supabase/retea/credentiale sau dependinte npm.
async function setup({ owner = false, hr = false, profileError = null, rpcError = null, missing = false, switched = false, cap = 100 } = {}) {
  const calls = []
  const notices = []
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'caller' } } }),
      getSession: async () => ({ data: { session: { user: { id: switched ? 'other' : 'caller' } } } }),
    },
    from(table) {
      assert.equal(table, 'profiles')
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { is_owner: owner, can_access_personal_data: hr }, error: profileError }) }) }) }
    },
    rpc(name, { p_ids }) {
      assert.equal(name, 'fn_employees_personal')
      let after = null
      let columns
      const request = {
        select(value) { columns = value; return this },
        order(value) { assert.equal(value, 'id'); return this },
        limit(value) { assert.equal(value, 100); return this },
        gt(field, value) { assert.equal(field, 'id'); after = value; return this },
        then(resolve, reject) {
          calls.push({ ids: p_ids, after, columns })
          const data = p_ids.filter(id => (after === null || id > after) && !(missing && id === 1))
            .sort((a, b) => a - b).slice(0, cap).map(id => ({ id, iban: `FICTIV-${id}` }))
          return Promise.resolve({ data, error: rpcError }).then(resolve, reject)
        },
      }
      return request
    },
  }
  const key = `__piiMock${Math.random().toString(36).slice(2)}`
  globalThis[key] = supabase
  const isolated = source.replace("import { supabase } from './lib/supabase.js'", `const supabase = globalThis[${JSON.stringify(key)}]`)
  const module = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`)
  delete globalThis[key]
  return { ...module, calls, notices, notify: (...args) => notices.push(args) }
}

test('allow-list JS = brief independent si GRANT SQL, fara coloane personale', async () => {
  const { EMPLOYEES_PUBLIC_COLUMNS } = await setup()
  const columns = EMPLOYEES_PUBLIC_COLUMNS.split(',')
  assert.deepEqual(columns, expectedPublic)
  for (const column of personal) assert.ok(!columns.includes(column))
  const sql = readFileSync(new URL('supabase/migrations/20261117a_employees_pii.sql', root), 'utf8')
  const match = sql.match(/GRANT SELECT \(([^)]+)\)\s+ON public\.employees TO authenticated;/)
  assert.ok(match)
  assert.deepEqual(match[1].split(','), expectedPublic)
})

test('non-HR pastreaza date publice si nu cheama RPC', async () => {
  const m = await setup()
  const result = { data: [{ id: 1, name: 'TEST' }], error: null }
  assert.deepEqual(await m.withEmployeePersonal(Promise.resolve(result), 'iban', m.notify), result)
  assert.equal(m.calls.length, 0)
  assert.equal(m.notices.length, 0)
})

test('export bancar non-HR este refuzat explicit, nu IBAN lipsa', async () => {
  const m = await setup()
  await assert.rejects(m.withEmployeePersonal(Promise.resolve({ data: [{ id: 1 }] }), 'iban', m.notify, true), /Acces personal necesar/)
  assert.equal(m.notices.length, 1)
})

for (const flag of ['owner', 'hr']) {
  test(`${flag} completeaza numai randurile cerute, paginare pana la gol cu cap server 1`, async () => {
    const m = await setup({ [flag]: true, cap: 1 })
    const result = await m.withEmployeePersonal(Promise.resolve({ data: [{ id: 2, name: 'B' }, { id: 1, name: 'A' }] }), 'iban', m.notify)
    assert.deepEqual(result.data, [{ id: 2, name: 'B', iban: 'FICTIV-2' }, { id: 1, name: 'A', iban: 'FICTIV-1' }])
    assert.equal(m.calls.length, 3)
    assert.ok(m.calls.every(call => call.columns === 'id,iban'))
  })
}

test('forme maybeSingle si lista goala sunt pastrate', async () => {
  const m = await setup({ hr: true })
  assert.equal((await m.withEmployeePersonal(Promise.resolve({ data: { id: 1 } }), 'iban', m.notify)).data.iban, 'FICTIV-1')
  assert.deepEqual((await m.withEmployeePersonal(Promise.resolve({ data: [] }), 'iban', m.notify)).data, [])
})

for (const [label, options] of [
  ['eroare RPC', { rpcError: new Error('RPC failed') }],
  ['eroare verificare drepturi', { profileError: new Error('profile failed') }],
  ['rand lipsa', { missing: true }],
  ['schimbare sesiune', { switched: true }],
]) {
  test(`${label}: eroare vizibila, fara date partiale`, async () => {
    const m = await setup({ hr: true, ...options })
    await assert.rejects(m.withEmployeePersonal(Promise.resolve({ data: [{ id: 1 }] }), 'iban', m.notify))
    assert.equal(m.notices.length, 1)
    assert.equal(m.notices[0][1], 'error')
  })
}

test('eroarea query-ului public opreste citirea personala', async () => {
  const m = await setup({ owner: true })
  await assert.rejects(m.withEmployeePersonal(Promise.resolve({ data: null, error: new Error('base failed') }), 'iban', m.notify), /base failed/)
  assert.equal(m.calls.length, 0)
})

test('loturi de maximum 100 ids, fara pierderea randurilor', async () => {
  const m = await setup({ hr: true, cap: 37 })
  const data = Array.from({ length: 205 }, (_, i) => ({ id: i + 1 }))
  const result = await m.withEmployeePersonal(Promise.resolve({ data }), 'iban', m.notify)
  assert.equal(result.data.length, 205)
  assert.ok(result.data.every(row => row.iban === `FICTIV-${row.id}`))
  assert.ok(m.calls.every(call => call.ids.length <= 100))
})

test('src: toate selectiile directe employees au lista explicita fara personal', () => {
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) scan(path)
      else if (/\.(jsx?|tsx?)$/.test(path)) {
        const text = readFileSync(path, 'utf8')
        for (const match of text.matchAll(/\.from\(\s*['"]employees['"]\s*\)\s*\.select\(([^\n]*)/g)) {
          assert.ok(!/^\s*(?:\)|['"]\*)/.test(match[1]), path)
          const literal = match[1].match(/^['"]([^'"]+)['"]/)?.[1]
          if (literal) for (const col of personal) assert.ok(!literal.split(',').map(c => c.trim()).includes(col), `${path}: ${col}`)
        }
      }
    }
  }
  scan(fileURLToPath(new URL('src', root)))
})
