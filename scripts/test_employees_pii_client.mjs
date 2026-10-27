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
      assert.ok(['fn_employees_personal', 'fn_employees_marimi'].includes(name))
      let after = null
      let columns
      const request = {
        select(value) { columns = value; return this },
        order(value) { assert.equal(value, 'id'); return this },
        limit(value) { assert.equal(value, 100); return this },
        gt(field, value) { assert.equal(field, 'id'); after = value; return this },
        then(resolve, reject) {
          calls.push({ name, ids: p_ids, after, columns })
          const data = p_ids.filter(id => (after === null || id > after) && !(missing && id === 1))
            .sort((a, b) => a - b).slice(0, cap).map(id => name === 'fn_employees_marimi'
              ? { id, marime_incaltaminte: '42', marime_imbracaminte: 'L' }
              : { id, iban: `FICTIV-${id}` })
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

const app = readFileSync(new URL('src/App.jsx', root), 'utf8')
const adminStart = app.indexOf('const empUpdates = {')
const adminPayload = app.slice(adminStart, app.indexOf('const {error}=', adminStart))
const reactivateStart = app.indexOf('updates={active:true,termination_date:null}')
const reactivateBranch = app.slice(reactivateStart, app.indexOf("    const {error}=await supabase.from('employees').update(updates)", reactivateStart))
const reactivatePayload = reactivateBranch.slice(0, reactivateBranch.lastIndexOf('}'))
const salaryStart = app.indexOf('const employeeUpdates=')
const salaryPayload = app.slice(salaryStart, app.indexOf('    const payload={', salaryStart))

test('Admin: payload-ul real omite IBAN necitit, chiar introdus in formular; null citit ramane editabil', async () => {
  const { employeePersonalWrite } = await setup()
  assert.ok(adminStart > 0 && adminPayload.length < 2000)
  const build = new Function('employees', 'editEmp', 'employeePersonalWrite', `${adminPayload}; return empUpdates`)
  for (const original of [{ id: 1 }, { id: 1, iban: undefined }, Object.assign(Object.create({ iban: 'ASCUNS' }), { id: 1 })]) {
    const payload = build([original], { id: 1, name: 'PUBLIC', iban: 'INTRODUS' }, employeePersonalWrite)
    assert.equal(Object.hasOwn(payload, 'iban'), false)
    assert.equal(payload.name, 'PUBLIC')
    assert.equal(JSON.stringify(payload).includes('iban'), false)
  }
  for (const value of [null, '', 'RO FICTIV']) {
    const payload = build([{ id: 1, iban: null }], { id: 1, iban: value }, employeePersonalWrite)
    assert.equal(payload.iban, value || null)
  }
})

test('Reactivare: executa constructia reala; istoricul necitit este omis, cel citit se concateneaza', async () => {
  const { employeePersonalWrite } = await setup()
  assert.ok(reactivateStart > 0 && reactivatePayload.length < 1500)
  const build = new Function('emp', 'employeePersonalWrite', 'formatDataRo', `let updates; ${reactivatePayload}; return updates`)
  const base = { id: 1, termination_date: '2026-10-01' }
  const hidden = build(base, employeePersonalWrite, value => value)
  assert.deepEqual(hidden, { active: true, termination_date: null })
  for (const history of [null, '', 'ISTORIC PASTRAT']) {
    const result = build({ ...base, observatii_hr: history }, employeePersonalWrite, value => value)
    assert.match(result.observatii_hr, /Reactivat la .*anterioar/)
    if (history) assert.ok(result.observatii_hr.startsWith(history + '\n'))
  }
})

test('Salarii: executa scrierea employees reala; email initial gol sau editat nu se trimite daca nu a fost citit', async () => {
  const { employeePersonalWrite } = await setup()
  assert.ok(salaryStart > 0 && salaryPayload.length < 1000)
  const save = new (async () => {}).constructor('employees', 'editSal', 'employeePersonalWrite', 'supabase', salaryPayload)
  for (const original of [{ id: 1 }, { id: 1, email: null }, { id: 1, email: 'VECHI' }]) {
    for (const value of ['', 'NOU']) {
      const calls = []
      const supabase = { from(table) { assert.equal(table, 'employees'); return { update(payload) {
        calls.push(payload); return { eq(field, id) { assert.equal(field, 'id'); assert.equal(id, 1); return Promise.resolve({}) } }
      } } } }
      await save([original], { employee_id: 1, empEmail: value }, employeePersonalWrite, supabase)
      assert.deepEqual(calls, Object.hasOwn(original, 'email') ? [{ email: value }] : [])
    }
  }
})

test('Magazie: non-HR citeste numai marimi prin RPC separat, loturi si cap server 1 pana la gol', async () => {
  const m = await setup({ cap: 1 })
  const data = Array.from({ length: 103 }, (_, i) => ({ id: i + 1, name: 'TEST' }))
  const result = await m.withEmployeeMarimi(Promise.resolve({ data }), m.notify)
  assert.equal(result.data.length, 103)
  assert.ok(result.data.every(row => row.marime_incaltaminte === '42' && row.marime_imbracaminte === 'L' && !Object.hasOwn(row, 'qr_pin')))
  assert.ok(m.calls.every(call => call.name === 'fn_employees_marimi' && call.columns === 'id,marime_incaltaminte,marime_imbracaminte' && call.ids.length <= 100))
  assert.equal(m.calls.length, 105)
})

for (const [label, options] of [['refuz', { rpcError: new Error('refuz') }], ['incomplet', { missing: true }], ['sesiune schimbata', { switched: true }]]) {
  test(`Magazie ${label}: continua fara marimi cu mesaj vizibil, fara rezultat partial`, async () => {
    const m = await setup(options)
    const original = { data: [{ id: 1, name: 'TEST' }], error: null }
    assert.deepEqual(await m.withEmployeeMarimi(Promise.resolve(original), m.notify), original)
    assert.equal(m.notices.length, 1)
    assert.match(m.notices[0][0], /continua fara marimi/)
  })
}

test('Magazie: lista goala nu cere RPC; eroarea listei publice ramane eroare', async () => {
  const m = await setup()
  assert.deepEqual(await m.withEmployeeMarimi(Promise.resolve({ data: [] }), m.notify), { data: [] })
  await assert.rejects(m.withEmployeeMarimi(Promise.resolve({ error: new Error('public failed') }), m.notify), /public failed/)
  assert.equal(m.calls.length, 0)
  const magazie = readFileSync(new URL('src/Magazie.jsx', root), 'utf8')
  assert.match(magazie, /withEmployeeMarimi\(supabase\.from\('employees'\)/)
  assert.match(magazie, /marimiError && <div role="status"/)
  assert.match(magazie, /generation !== loadGeneration.current/)
})
