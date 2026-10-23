// Fără npm: node stdlib + psql. NU creați fixture dintr-o bază de producție activă.
// Cere o clonă LOCALĂ, izolată, cu gate E3 real sănătos și două profiles existente.
// Nu recreează baza, nu alterează roluri, funcții sau date de domeniu.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const target = new URL(process.env.PGURI || 'invalid:')
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PGURI local obligatoriu')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar PG local')
assert.equal(target.search, '', 'Fără opțiuni care pot suprascrie destinația')
assert.equal(target.hash, '')
assert.match(decodeURIComponent(target.pathname.slice(1)), /^e9_b1_test_[a-z0-9_]+$/, 'Doar baza izolată e9_b1_test_<sufix>')
assert.ok(!process.env.PGOPTIONS && !process.env.PGSERVICE, 'Nu folosi PGOPTIONS/PGSERVICE în harness')
const migration = readFileSync(new URL('../../supabase/migrations/20261108a_ocr_local_cereri.sql', import.meta.url), 'utf8')
const rollback = readFileSync(new URL('../../supabase/revenire/20261108a_ocr_local_cereri_ROLLBACK.sql', import.meta.url), 'utf8')
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const sessions = new Set()
const env = { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }
// Nu afișăm URI-ul sau obiectul de eroare al procesului.
class Session {
  constructor(name) {
    this.name = name; this.out = ''; this.err = ''; this.busy = false; this.n = 0
    this.child = spawn('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', target.href, '--file', '-'],
      { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', s => { this.out += s })
    this.child.stderr.on('data', s => { this.err += s })
    this.child.on('error', e => { this.err += e.code || 'spawn'; this.ended = true })
    this.child.stdin.on('error', () => { this.ended = true })
    this.closed = new Promise(resolve => this.child.on('close', () => { this.ended = true; resolve() }))
    sessions.add(this)
  }
  async command(sql) {
    assert.ok(!this.busy, `${this.name}: comenzi suprapuse`)
    this.busy = true
    const start = this.out.length, marker = `E9_DONE_${++this.n}`
    this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    try {
      const until = Date.now() + 18000
      while (Date.now() < until) {
        const lines = this.out.slice(start).replaceAll('\r', '').split('\n'), end = lines.indexOf(marker)
        if (end >= 0) return lines.slice(0, end).join('\n').trim()
        if (this.ended) throw new Error(`${this.name}: ${this.err}`)
        await delay(15)
      }
      throw new Error(`${this.name}: timeout`) // statement_timeout este mai scurt
    } finally { this.busy = false }
  }
  async value(expr) { return JSON.parse(await this.command(`SELECT coalesce((${expr})::jsonb,'null'::jsonb);`)) }
  async init(role = 'postgres') {
    await this.command(`SET application_name=${quote('e9_b1_' + this.name)};
      SET statement_timeout='12s'; SET lock_timeout='10s'; SET idle_in_transaction_session_timeout='25s';
      SET default_transaction_isolation='read committed'; SET TimeZone='UTC'; SET ROLE ${role};`)
    this.pid = await this.value('to_jsonb(pg_backend_pid())')
    assert.equal(await this.value('to_jsonb(current_user)'), role)
    return this
  }
  async close() {
    if (!this.ended && !this.child.stdin.destroyed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    const timer = setTimeout(() => this.child.kill(), 1500)
    try { await this.closed } finally { clearTimeout(timer); sessions.delete(this) }
  }
}
const o = await new Session('observer').init()
const a = await new Session('worker_a').init('service_role')
const b = await new Session('worker_b').init('service_role')
let user, other, project, depot, baseline, installed = false, passed = 0
const tests = []
const test = (name, body) => tests.push([name, body])
const one = (s, call) => s.value(`(SELECT to_jsonb(x) FROM ${call} x)`)
const all = (s, call) => s.value(`(SELECT coalesce(jsonb_agg(x),'[]') FROM ${call} x)`)
const row = id => o.value(`(SELECT to_jsonb(q) FROM public.ocr_local_cereri q WHERE id=${quote(id)})`)
// SQL-ul inserat în DO nu are voie să se termine cu „;” + comentarii (ar rămâne o instrucțiune goală → eroare de sintaxă).
const faraFinal = sql => sql.replace(/(?:\s+|--[^\n]*(?:\n|$))*$/, '').replace(/;\s*$/, '')
async function denies(s, sql, message) {
  // Catch în subtranzacție: sesiunea rămâne utilizabilă, eroarea trebuie să fie cea așteptată.
  await s.command(`DO $test$ BEGIN BEGIN
    ${faraFinal(sql)}; RAISE EXCEPTION 'TEST_expected_refusal_missing';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE ${quote('%' + message + '%')} THEN RAISE; END IF;
    END; END $test$;`)
}
async function barrier(pid) {
  const until = Date.now() + 7000
  while (Date.now() < until) {
    if (await o.value(`to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'))`)) return
    await delay(15)
  }
  throw new Error(`Bariera: backendul ${pid} nu a ajuns la lock`)
}
// Amprentă a tuturor obiectelor existente, nu doar a numelor. Include RLS, ACL pe
// coloane/tabele/funcții, politici, trigger-e, CHECK, indexuri și body-urile RPC.
const fingerprint = `jsonb_build_object(
  'classes',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM (
    SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.reloptions,pg_get_userbyid(c.relowner) owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage','auth')) x),
  'columns',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM (
    SELECT n.nspname,c.relname,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,pg_get_expr(d.adbin,d.adrelid) def
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname IN ('public','storage','auth') AND a.attnum>0 AND NOT a.attisdropped) x),
  'functions',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM (
    SELECT p.oid::regprocedure::text signature,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','storage','auth') AND p.prokind IN ('f','p')) x),
  'policies',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM pg_policies x WHERE schemaname IN ('public','storage','auth')),
  'grants',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM information_schema.role_table_grants x WHERE table_schema IN ('public','storage','auth')),
  'constraints',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM (
    SELECT conrelid::regclass::text tab,conname,pg_get_constraintdef(k.oid) def FROM pg_constraint k
    JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN ('public','storage','auth')) x),
  'indexes',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM pg_indexes x WHERE schemaname IN ('public','storage','auth')),
  'triggers',(SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') FROM (
    SELECT tgrelid::regclass::text tab,tgname,tgenabled,pg_get_triggerdef(t.oid) def FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public','storage','auth')) x))`
async function reset() {
  await o.command(`DELETE FROM public.ocr_local_cereri WHERE id IS NOT NULL;
    DELETE FROM public.ocr_local_incercari WHERE id IS NOT NULL;
    DELETE FROM public.ocr_local_worker WHERE worker_id IS NOT NULL;
    DELETE FROM public.ai_plafon_rezervari WHERE cheie='izo_e3_ocr:${project}';
    DELETE FROM public.ai_plafon_lunar WHERE cheie='izo_e3_ocr:${project}';`)
  await a.command(`SELECT public.fn_ocr_local_heartbeat('w','disponibil',clock_timestamp(),'{}','test');`)
}
const admit = (s = a, u = user) => one(s, `public.fn_ocr_local_admite(${quote(u)},${project},${depot},'aviz_teava',100)`)
async function requested() {
  const r = await admit()
  assert.equal(r.status, 'admisa', `admitere: ${r.motiv}`)
  const d = await one(a, `public.fn_ocr_local_confirma_upload(${quote(r.id)},${quote(user)},repeat('a',64),100)`)
  assert.ok(d.termen_local)
  return r.id
}
async function claimed() {
  const id = await requested(), r = await one(a, "public.fn_ocr_local_preia('w')")
  assert.equal(r.id, id)
  return { id, token: r.token }
}
const right = (s, id, branch, token = null, uid = user) => one(s,
  `public.fn_ocr_local_drept_platit(${quote(id)},${quote(branch)},${token ? quote(token) : 'NULL'},${quote(uid)})`)
const reserve = (id, s = a) => one(s, `public.fn_ocr_local_rezerva_apel(${quote(id)})`)
const phase = (id, name, response = null, cost = 'NULL') => a.command(
  `SELECT public.fn_ocr_local_apel_faza(${quote(id)},${quote(name)},NULL,${response ? quote(JSON.stringify(response)) + '::jsonb' : 'NULL'},${cost});`)
async function fallback() {
  const id = await requested()
  await o.command(`UPDATE public.ocr_local_cereri SET termen_preluare=clock_timestamp()-interval '1 second' WHERE id=${quote(id)};`)
  assert.equal((await right(a, id, 'fallback')).acordat, true)
  return id
}
const state = id => one(a, `public.fn_ocr_local_stare(${quote(id)},${quote(user)})`)
async function agePaid(id, seconds) {
  await o.command(`UPDATE public.ocr_local_cereri SET drept_platit_la=clock_timestamp()-make_interval(secs=>${seconds}),
    termen_fallback=clock_timestamp()+make_interval(secs=>${120 - seconds}) WHERE id=${quote(id)};`)
}
async function ledger() {
  return o.value(`(SELECT jsonb_build_array(rezervat_usd,consumat_usd) FROM public.ai_plafon_lunar WHERE cheie='izo_e3_ocr:${project}')`)
}

test('gardă livrare, re-aplicare refuzată; gate E3 și ACL existente identice', async () => {
  await denies(o, migration, 'garda start invalida')
  await denies(a, `PERFORM set_config('gazpet.livrare_migrare','20261108a_ocr_local_cereri:'||txid_current(),true); ${migration}`, 'necesita postgres')
  await o.command(`BEGIN; SELECT set_config('gazpet.livrare_migrare','20261108a_ocr_local_cereri:'||txid_current(),true); ${migration} COMMIT;`)
  installed = true
  assert.deepEqual(await o.value('to_jsonb(public.fn_izo_porti_lipsa())'), [])
  const applied = await o.value(fingerprint)
  assert.deepEqual(applied.grants.filter(r => !/^(ocr_local_|v_ocr_local_)/.test(r.table_name)), baseline.grants,
    'information_schema.role_table_grants existente identice înainte/după')
  assert.deepEqual(applied.functions.filter(r => !/(^|\.)fn_ocr_local_/.test(r.signature)), baseline.functions,
    'pg_proc.proacl și definițiile tuturor funcțiilor existente sunt identice înainte/după')
  // Eliminăm din amprentă DOAR obiectele create de B1 printr-o revenire de probă.
  // Catalogul complet este comparat din nou la sfârșit, după scenariile de concurență.
  await denies(o, `PERFORM set_config('gazpet.livrare_migrare','20261108a_ocr_local_cereri:'||txid_current(),true); ${migration}`, 'obiectele exista deja')
  await o.command(`BEGIN; SELECT set_config('gazpet.revenire_20261108a','OCR_LOCAL_REVENIRE:'||txid_current(),true); ${rollback} COMMIT;`)
  assert.deepEqual(await o.value(fingerprint), baseline)
  await o.command(`BEGIN; SELECT set_config('gazpet.livrare_migrare','20261108a_ocr_local_cereri:'||txid_current(),true); ${migration} COMMIT;`)
})

test('roluri reale: niciun SELECT direct; niciun DML/RPC pentru authenticated/anon; worker doar RPC', async () => {
  await reset()
  const id = await requested(), u = await new Session('ui').init('authenticated'), n = await new Session('anon').init('anon')
  try {
    await u.command(`SET request.jwt.claims=${quote(JSON.stringify({ sub: user, role: 'authenticated' }))};`)
    for (const claims of [{ sub: user, role: 'authenticated' }, { sub: other, role: 'authenticated' }, {}]) {
      await u.command(`SET request.jwt.claims=${quote(JSON.stringify(claims))};`)
      await denies(u, 'SELECT * FROM public.ocr_local_cereri', 'permission denied')
      for (const column of ['token_executie','worker_id','rezervare_id','apel_faza','apel_raspuns']) {
        await denies(u, `SELECT ${column} FROM public.ocr_local_cereri`, 'permission denied')
      }
    }
    const safe = await state(id)
    assert.deepEqual(Object.keys(safe).sort(), ['stare','ramura','rezultat','eroare','termen_local','termen_fallback'].sort())
    assert.equal(safe.rezultat, null)
    for (const s of [u, n, a]) {
      for (const sql of [
        `UPDATE public.ocr_local_cereri SET stare='gata' WHERE id=${quote(id)}`,
        `DELETE FROM public.ocr_local_cereri WHERE id=${quote(id)}`,
        `INSERT INTO public.ocr_local_cereri(id) VALUES(gen_random_uuid())`,
        `SELECT * FROM public.ocr_local_worker`, `SELECT * FROM public.ocr_local_incercari`, `SELECT * FROM public.ocr_local_config`,
      ]) await denies(s, sql, 'permission denied')
    }
    await denies(n, 'SELECT * FROM public.ocr_local_cereri', 'permission denied')
    const signatures = await o.value(`(SELECT jsonb_agg(p.oid::regprocedure::text) FROM pg_proc p
      WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn_ocr_local_%')`)
    for (const sig of signatures) {
      for (const role of ['authenticated', 'anon']) assert.equal(await o.value(`to_jsonb(has_function_privilege(${quote(role)},${quote(sig)},'EXECUTE'))`), false)
      assert.equal(await o.value(`to_jsonb(EXISTS(SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE p.oid=${quote(sig)}::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'))`), false)
      const helper = /fn_ocr_local_(expira_una|disponibilitate)\(/.test(sig)
      assert.equal(await o.value(`to_jsonb(has_function_privilege('service_role',${quote(sig)},'EXECUTE'))`), !helper)
    }
    // EXECUTE effectiv, nu doar inspectarea ACL-ului, pe fiecare RPC JWT-side.
    for (const caller of [u, n]) {
      for (const call of [
        `public.fn_ocr_local_admite(${quote(user)},${project},${depot},'aviz_teava',100)`,
        `public.fn_ocr_local_confirma_upload(${quote(id)},${quote(user)},repeat('a',64),100)`,
        `public.fn_ocr_local_drept_platit(${quote(id)},'fallback',NULL,${quote(user)})`,
        `public.fn_ocr_local_stare(${quote(id)},${quote(user)})`,
        `public.fn_ocr_local_context(${quote(id)},${quote(user)},NULL)`,
        "public.fn_ocr_local_preia('ui')",
      ]) await denies(caller, `SELECT * FROM ${call}`, 'permission denied')
    }
    await denies(a, `SELECT public.fn_ocr_local_expira_una(${quote(id)})`, 'permission denied')
    await denies(a, `SELECT * FROM public.fn_ocr_local_stare(${quote(id)},${quote(other)})`, 'nu_exista')
    await denies(a, `SELECT * FROM public.fn_ocr_local_drept_platit(${quote(id)},'fallback',NULL,${quote(other)})`, 'nu_e_creatorul')
  } finally { await u.close(); await n.close() }
})

test('context minim: creator sau token curent, termene distincte, retenție și tombstone', async () => {
  await reset()
  const { id, token } = await claimed()
  const context = (uid, tok) => all(a, `public.fn_ocr_local_context(${quote(id)},${uid ? quote(uid) : 'NULL'},${tok ? quote(tok) : 'NULL'})`)
  const creator = await context(user, null)
  assert.equal(creator.length, 1)
  assert.deepEqual(Object.keys(creator[0]).sort(), ['id','creat_de','proiect_id','depozit_id','sablon',
    'drept_platit_de','apel_faza','apel_raspuns','rezervare_id','cost_usd'].sort())
  assert.deepEqual(await context(other, null), [])
  assert.deepEqual(await context(null, token), creator)
  assert.deepEqual(await context(null, '00000000-0000-4000-8000-000000000000'), [])
  assert.deepEqual(await context(null, null), [])
  assert.deepEqual(await context(other, token), [], 'selectori amestecați refuzați')
  assert.deepEqual(await context(user, token), [])
  await right(a, id, 'arbitraj', token); await reserve(id)
  await phase(id, 'trimis'); await phase(id, 'raspuns', { celule: [] }); await phase(id, 'decontat', null, '0.01')
  const before = await row(id)
  const recovered = (await context(null, token))[0]
  assert.deepEqual(recovered.apel_raspuns, { celule: [] })
  assert.equal(recovered.apel_faza, 'decontat'); assert.equal(recovered.cost_usd, 0.01)
  assert.equal(recovered.rezervare_id, before.rezervare_id)
  assert.deepEqual(await row(id), before, 'context nu are efecte asupra cozii')
  await o.command(`UPDATE public.ocr_local_cereri SET termen_local=clock_timestamp() WHERE id=${quote(id)};`)
  assert.deepEqual(await context(null, token), [], 'deadline strict, fără grace')
  assert.equal((await context(user, null)).length, 1, 'creatorul poate cere fallback după termenul local')
  await o.command(`UPDATE public.ocr_local_cereri SET stare='expirata',token_executie=NULL,preluata_la=NULL WHERE id=${quote(id)};`)
  assert.deepEqual(await context(null, token), [], 'token invalidat după închiderea ramurii')
  await o.command(`UPDATE public.ocr_local_cereri SET sterge_dupa=clock_timestamp() WHERE id=${quote(id)};`)
  assert.deepEqual(await context(user, null), [], 'retenție expirată înainte de curățare')
  await a.command(`SELECT public.fn_ocr_local_curatenie_confirma(${quote(id)},true,NULL);`)
  await o.command(`UPDATE public.ocr_local_cereri SET sterge_dupa=clock_timestamp()+interval '1 day' WHERE id=${quote(id)};`)
  assert.deepEqual(await context(user, null), [], 'tombstone refuzat și cu retenție în viitor')
  await reset()
  const pending = await admit()
  await o.command(`UPDATE public.ocr_local_cereri SET pdf_cale=NULL WHERE id=${quote(pending.id)};`)
  assert.deepEqual(await all(a, `public.fn_ocr_local_context(${quote(pending.id)},${quote(user)},NULL)`), [], 'fără PDF nu se expune context')
})

test('două preia, sesiuni distincte: SKIP LOCKED, o singură preluare și token vechi refuzat', async () => {
  await reset()
  const id = await requested()
  await a.command('BEGIN;')
  try {
    const first = await one(a, "public.fn_ocr_local_preia('w1')") // lock ținut până după al doilea apel
    assert.equal(first.id, id)
    assert.deepEqual(await all(b, "public.fn_ocr_local_preia('w2')"), [])
    await a.command('COMMIT;')
    await denies(b, `SELECT public.fn_ocr_local_rezultat(${quote(id)},gen_random_uuid(),'{}',NULL,0)`, 'token_invalid')
    await denies(b, `SELECT * FROM public.fn_ocr_local_verifica_token(${quote(id)},gen_random_uuid())`, 'token_invalid')
    assert.equal((await one(b, `public.fn_ocr_local_verifica_token(${quote(id)},${quote(first.token)})`)).cale, (await row(id)).pdf_cale)
  } finally { await a.command('ROLLBACK;') }
})

test('rezultat la T+89 acceptat, T+90/91 refuzat; arbitraj T+49 vs T+51', async () => {
  for (const second of [89, 90, 91]) {
    await reset(); const { id, token } = await claimed()
    // Deplasăm T0 în trecut: deadline = acum + (90-sec). Nicio așteptare de 90s.
    await o.command(`UPDATE public.ocr_local_cereri SET termen_local=clock_timestamp()+make_interval(secs=>${90 - second}) WHERE id=${quote(id)};`)
    const sql = `SELECT public.fn_ocr_local_rezultat(${quote(id)},${quote(token)},'{}',NULL,0)`
    if (second === 89) { await a.command(sql + ';'); assert.equal((await state(id)).stare, 'gata') }
    else { await denies(a, sql, 'termen_depasit'); assert.equal((await state(id)).stare, 'expirata') }
  }
  for (const second of [49, 51]) {
    await reset(); const { id, token } = await claimed()
    await o.command(`UPDATE public.ocr_local_cereri SET termen_local=clock_timestamp()+make_interval(secs=>${90 - second}) WHERE id=${quote(id)};`)
    if (second === 49) assert.equal((await right(a, id, 'arbitraj', token)).acordat, true)
    else await denies(a, `SELECT * FROM public.fn_ocr_local_drept_platit(${quote(id)},'arbitraj',${quote(token)},NULL)`, 'termen_depasit')
  }
})

test('expira vs rezultat: ambele ordini, bariere pe lock și ceas verificat după lock', async () => {
  await reset(); let { id, token } = await claimed()
  await a.command('BEGIN;')
  try {
    await a.command(`SELECT public.fn_ocr_local_rezultat(${quote(id)},${quote(token)},'{}',NULL,0);`)
    // Expirarea concurentă sare rândul blocat de rezultat.
    assert.equal(await b.value('to_jsonb(public.fn_ocr_local_expira())'), 0)
    await a.command('COMMIT;')
    assert.equal((await state(id)).stare, 'gata')
  } finally { await a.command('ROLLBACK;') }
  await reset(); ({ id, token } = await claimed())
  await o.command('BEGIN;')
  let pending
  try {
    await o.command(`SELECT id FROM public.ocr_local_cereri WHERE id=${quote(id)} FOR UPDATE;`)
    pending = denies(a, `SELECT public.fn_ocr_local_rezultat(${quote(id)},${quote(token)},'{}',NULL,0)`, 'ramura_inchisa')
    await barrier(a.pid)
    await o.command(`UPDATE public.ocr_local_cereri SET termen_local=clock_timestamp()-interval '1 second' WHERE id=${quote(id)};
      SELECT public.fn_ocr_local_expira(); COMMIT;`)
    await pending
    assert.equal((await state(id)).stare, 'expirata')
  } finally { await o.command('ROLLBACK;'); if (pending) await pending }
  // Un rezultat care a început în termen, dar a așteptat lock-ul, nu este acceptat.
  await reset(); ({ id, token } = await claimed())
  await o.command('BEGIN;')
  try {
    await o.command(`SELECT id FROM public.ocr_local_cereri WHERE id=${quote(id)} FOR UPDATE;`)
    pending = denies(a, `SELECT public.fn_ocr_local_rezultat(${quote(id)},${quote(token)},'{}',NULL,0)`, 'termen_depasit')
    await barrier(a.pid)
    await o.command(`UPDATE public.ocr_local_cereri SET termen_local=clock_timestamp()-interval '1 second' WHERE id=${quote(id)}; COMMIT;`)
    await pending
  } finally { await o.command('ROLLBACK;'); if (pending) await pending }
})

test('arbitraj vs fallback concurente, drept unic și reluare fără acordare', async () => {
  await reset(); const { id, token } = await claimed()
  await a.command('BEGIN;')
  let pending
  try {
    assert.equal((await right(a, id, 'arbitraj', token)).acordat, true)
    pending = right(b, id, 'fallback')
    await barrier(b.pid)
    await a.command('COMMIT;')
    assert.equal((await pending).acordat, false)
    assert.equal((await right(a, id, 'arbitraj', token)).acordat, false)
    assert.equal((await row(id)).drept_platit_de, 'arbitraj')
  } finally { await a.command('ROLLBACK;'); if (pending) await pending }
})

test('rezervare atomică, rollback la eroarea legării, concurență și nicio autorizare dublă de trimis', async () => {
  await reset(); const id = await fallback()
  // Eșec la UPDATE-ul cererii după INSERT-ul rezervării: tot RPC-ul trebuie anulat.
  await o.command(`CREATE FUNCTION public.e9_test_fail_link() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN IF NEW.rezervare_id IS NOT NULL THEN RAISE EXCEPTION 'test_link_failed'; END IF; RETURN NEW; END $t$;
    CREATE TRIGGER e9_test_fail_link BEFORE UPDATE ON public.ocr_local_cereri FOR EACH ROW EXECUTE FUNCTION public.e9_test_fail_link();`)
  try {
    await denies(a, `SELECT * FROM public.fn_ocr_local_rezerva_apel(${quote(id)})`, 'test_link_failed')
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM public.ai_plafon_rezervari WHERE cheie='izo_e3_ocr:${project}')`), 0)
    assert.equal((await row(id)).apel_faza, 'acordat')
  } finally { await o.command('DROP TRIGGER e9_test_fail_link ON public.ocr_local_cereri; DROP FUNCTION public.e9_test_fail_link();') }
  await a.command('BEGIN;')
  let pending
  try {
    const first = await reserve(id)
    assert.equal(first.acordat, true)
    pending = reserve(id, b); await barrier(b.pid); await a.command('COMMIT;')
    const second = await pending
    assert.equal(second.acordat, false); assert.equal(second.rezervare_id, first.rezervare_id)
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM public.ai_plafon_rezervari WHERE cheie='izo_e3_ocr:${project}')`), 1)
    assert.deepEqual(await ledger(), [0.05, 0])
    await denies(a, `SELECT public.fn_ocr_local_apel_faza(${quote(id)},'rezervat',${first.rezervare_id},NULL,NULL)`, 'faza_invalida')
    await denies(a, `SELECT public.fn_ocr_local_apel_faza(${quote(id)},'trimis',${Number(first.rezervare_id) + 1},NULL,NULL)`, 'deja_legata')
    await phase(id, 'trimis')
    await denies(a, `SELECT public.fn_ocr_local_apel_faza(${quote(id)},'trimis',NULL,NULL,NULL)`, 'faza_invalida')
  } finally { await a.command('ROLLBACK;'); if (pending) await pending }
})

test('recuperare acordat/rezervat/trimis/raspuns pe ambele ramuri: sume conservatoare, fără al doilea apel', async () => {
  for (const branch of ['fallback', 'arbitraj']) for (const step of ['acordat', 'rezervat', 'trimis', 'raspuns']) {
    await reset()
    let id
    if (branch === 'fallback') id = await fallback()
    else { const r = await claimed(); id = r.id; await right(a, id, branch, r.token) }
    if (step !== 'acordat') await reserve(id)
    if (['trimis', 'raspuns'].includes(step)) await phase(id, 'trimis')
    if (step === 'raspuns') await phase(id, 'raspuns', { ok: true })
    await agePaid(id, 121)
    await a.command('SELECT public.fn_ocr_local_expira();')
    const r = await row(id)
    assert.equal(r.stare, step === 'raspuns' && branch === 'fallback' ? 'gata' : 'esuata')
    assert.equal(r.apel_faza, ['acordat', 'rezervat'].includes(step) ? 'esuat_inainte' : step === 'trimis' ? 'esuat_dupa' : 'decontat')
    assert.equal(Number(r.cost_usd), ['acordat', 'rezervat'].includes(step) ? 0 : 0.05)
    if (step === 'acordat') assert.equal(await ledger(), null)
    else assert.deepEqual(await ledger(), [0, step === 'rezervat' ? 0 : 0.05])
    if (step === 'raspuns' && branch === 'arbitraj') assert.equal(r.eroare, 'local_cazut_dupa_arbitraj')
    const previous = await ledger()
    assert.equal((await reserve(id)).acordat, false)
    assert.equal((await right(a, id, 'fallback')).acordat, false)
    await a.command('SELECT public.fn_ocr_local_expira();')
    assert.deepEqual(await ledger(), previous)
  }
})

test('HTTP pierdut: răspuns persistat, cost real; fallback 119/121; eșecuri înainte/după și răspuns invalid', async () => {
  await reset(); let id = await fallback()
  await reserve(id); await phase(id, 'trimis'); await phase(id, 'raspuns', { propunere: 'x' })
  assert.deepEqual((await row(id)).apel_raspuns, { propunere: 'x' })
  assert.equal((await right(a, id, 'fallback')).acordat, false)
  await phase(id, 'decontat', null, '0.012345')
  assert.deepEqual(await ledger(), [0, 0.012345])
  await agePaid(id, 119)
  assert.equal((await state(id)).stare, 'fallback')
  await a.command(`SELECT public.fn_ocr_local_inchide_fallback(${quote(id)},'{"propunere":"x"}',NULL,0.012345);`)
  assert.equal((await state(id)).stare, 'gata')
  assert.deepEqual((await state(id)).rezultat, { propunere: 'x' })
  for (const fail of ['esuat_inainte', 'esuat_dupa', 'invalid', 'decontat_cazut']) {
    await reset(); id = await fallback(); await reserve(id)
    if (fail !== 'esuat_inainte') await phase(id, 'trimis')
    if (fail === 'invalid' || fail === 'decontat_cazut') await phase(id, 'raspuns', fail === 'invalid' ? { invalid: true, motiv: 'schema' } : { ok: true })
    if (fail === 'decontat_cazut') await phase(id, 'decontat', null, '0.01')
    if (fail.startsWith('esuat')) await phase(id, fail)
    await agePaid(id, 121)
    assert.equal((await state(id)).stare, fail === 'decontat_cazut' ? 'gata' : 'esuata')
    assert.deepEqual(await ledger(), [0, fail === 'esuat_inainte' ? 0 : fail === 'decontat_cazut' ? 0.01 : 0.05])
  }
})

test('recovery decontat: cost_real si totalurile lunare raman identice', async () => {
  for (const initial of ['preluata','expirata']) {
    await reset()
    const { id, token } = await claimed()
    await right(a, id, 'arbitraj', token); const reservation = await reserve(id)
    await phase(id, 'trimis'); await phase(id, 'raspuns', { ok: true })
    await phase(id, 'decontat', null, '0.012345')
    const readReservation = () => o.value(`(SELECT to_jsonb(r) FROM public.ai_plafon_rezervari r WHERE id=${reservation.rezervare_id})`)
    const before = await readReservation(), totals = await ledger()
    assert.equal(before.stare, 'decontat'); assert.equal(before.cost_real, 0.012345)
    await agePaid(id, 121)
    if (initial === 'expirata') await o.command(`UPDATE public.ocr_local_cereri SET stare='expirata',token_executie=NULL,preluata_la=NULL WHERE id=${quote(id)};`)
    assert.equal((await state(id)).stare, 'esuata')
    assert.deepEqual(await readReservation(), before)
    assert.deepEqual(await ledger(), totals)
    await a.command('SELECT public.fn_ocr_local_expira();')
    assert.deepEqual(await readReservation(), before)
    assert.deepEqual(await ledger(), totals)
  }
})

test('admitere: proiect/depozit inexistente refuzate si jurnalizate', async () => {
  await reset()
  const missingProject = await o.value('(SELECT to_jsonb((coalesce(max(id),0)::bigint+1)::text) FROM public.executie_proiecte)')
  const missingDepot = await o.value('(SELECT to_jsonb((coalesce(max(id),0)::bigint+1)::text) FROM public.logistica_depozite)')
  for (const [pr, dep] of [[missingProject, depot], [project, missingDepot]]) {
    const r = await one(a, `public.fn_ocr_local_admite(${quote(user)},${pr},${dep},'aviz_teava',100)`)
    assert.equal(r.status, 'refuzata'); assert.equal(r.motiv, 'parametri_invalizi'); assert.equal(r.id, null)
  }
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_cereri)'), 0)
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_incercari)'), 2)
})

test('plafon epuizat: drept consumat fără rezervare; count_tokens eșuat eliberează exact rezerva', async () => {
  await reset(); let id = await fallback()
  await o.command(`INSERT INTO public.ai_plafon_lunar(cheie,luna,plafon_usd)
    VALUES('izo_e3_ocr:${project}',date_trunc('month',now() AT TIME ZONE 'UTC')::date,0);`)
  assert.equal((await reserve(id)).status, 'plafon_depasit')
  assert.equal((await right(a, id, 'fallback')).acordat, false)
  await agePaid(id, 121); assert.equal((await state(id)).stare, 'esuata')
  await reset(); id = await fallback(); await reserve(id); await phase(id, 'esuat_inainte')
  await a.command(`SELECT public.fn_ocr_local_inchide_fallback(${quote(id)},NULL,'intern',0);`)
  assert.deepEqual(await ledger(), [0, 0])
})

test('3 admiteri concurente: barieră advisory, cel mult 2; refuzul rămâne jurnalizat', async () => {
  await reset(); const c = await new Session('worker_c').init('service_role')
  await o.command(`BEGIN; SELECT pg_advisory_xact_lock(hashtext('ocr_local_cota'));`)
  let pending = []
  try {
    pending = [admit(a), admit(b), admit(c)]
    await barrier(a.pid); await barrier(b.pid); await barrier(c.pid)
    await o.command('COMMIT;')
    const replies = await Promise.all(pending)
    assert.equal(replies.filter(r => r.status === 'admisa').length, 2)
    assert.equal(replies.filter(r => r.motiv === 'limita_active').length, 1)
    assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_incercari)'), 3)
  } finally { await o.command('ROLLBACK;'); await Promise.allSettled(pending); await c.close() }
})

// Fixture de cotă: doar rânduri NOI, valide, în tabelele B1. Nu folosim date de domeniu.
async function fill(count, uid = user) {
  await o.command(`INSERT INTO public.ocr_local_cereri(proiect_id,depozit_id,sablon,creat_de,pdf_bytes,stare,termen_upload,sterge_dupa)
    SELECT ${project},${depot},'aviz_teava',${quote(uid)},100,'expirata',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '7 days'
    FROM generate_series(1,${count});`)
}
test('limita orară exactă și zi globală, inclusiv admise fără upload; refuzuri persistente până peste 60', async () => {
  await reset(); await fill(29)
  assert.equal((await admit()).status, 'admisa')
  assert.equal((await admit()).motiv, 'limita_ora')
  assert.equal((await admit()).motiv, 'limita_ora')
  await reset(); await fill(399, other)
  assert.equal((await admit()).status, 'admisa')
  assert.equal((await admit()).motiv, 'limita_zi')
  // Concurență și la ultimul loc orar/global, sub aceeași barieră ca admiterea.
  for (const [count, uid, reason] of [[29, user, 'limita_ora'], [399, other, 'limita_zi']]) {
    await reset(); await fill(count, uid)
    await o.command(`BEGIN; SELECT pg_advisory_xact_lock(hashtext('ocr_local_cota'));`)
    let pending = []
    try {
      pending = [admit(a), admit(b)]
      await barrier(a.pid); await barrier(b.pid); await o.command('COMMIT;')
      const replies = await Promise.all(pending)
      assert.equal(replies.filter(r => r.status === 'admisa').length, 1)
      assert.equal(replies.filter(r => r.motiv === reason).length, 1)
    } finally { await o.command('ROLLBACK;'); await Promise.allSettled(pending) }
  }
  await reset()
  await a.command(`SELECT public.fn_ocr_local_heartbeat('w','oprit',clock_timestamp(),'{}','test');`)
  // Fiecare apel e o tranzacție RPC separată; un RAISE ar pierde aceste înregistrări.
  for (let i = 1; i <= 63; i++) assert.equal((await admit()).motiv, i <= 60 ? 'local_indisponibil' : 'limita_incercari')
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_incercari)'), 63)
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_cereri)'), 0)
  await a.command(`SELECT public.fn_ocr_local_heartbeat('w','disponibil',clock_timestamp(),'{}','test');`)
  assert.equal((await admit()).motiv, 'limita_incercari', 'repornirea workerului nu resetează încercările')
  await o.command(`UPDATE public.ocr_local_incercari SET la=clock_timestamp()-interval '61 minutes' WHERE id IS NOT NULL;`)
  assert.equal((await admit()).status, 'admisa')
  await o.command(`UPDATE public.ocr_local_incercari SET la=clock_timestamp()-interval '31 days' WHERE rezultat<>'admisa';`)
  await a.command('SELECT public.fn_ocr_local_expira();')
  assert.equal(await o.value(`to_jsonb(EXISTS(SELECT 1 FROM public.ocr_local_incercari WHERE la<clock_timestamp()-interval '30 days'))`), false)
})

test('noapte, DST, heartbeat vechi: ceas BD, nu ora declarată de worker', async () => {
  await reset()
  for (const day of ['2026-01-15', '2026-07-15', '2026-10-25']) {
    for (const hour of ['05:59:59', '22:00:00', '23:59:59']) assert.equal(await o.value(`to_jsonb(public.fn_ocr_local_disponibilitate('${day} ${hour} Europe/Bucharest'))`), 'noapte')
    for (const hour of ['06:00:00', '21:59:59']) {
      await o.command(`UPDATE public.ocr_local_worker SET ultimul_semn='${day} ${hour} Europe/Bucharest' WHERE worker_id='w';`)
      assert.equal(await o.value(`to_jsonb(public.fn_ocr_local_disponibilitate('${day} ${hour} Europe/Bucharest'))`), null)
    }
  }
  await o.command(`UPDATE public.ocr_local_worker SET ultimul_semn=clock_timestamp()-interval '45 seconds',ora_server=clock_timestamp()+interval '1 day' WHERE worker_id='w';`)
  assert.equal((await admit()).motiv, 'local_indisponibil')
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_cereri)'), 0)
  // B1 nu face Storage I/O. Testul real "0 obiecte / orfan >1h" aparține B2.
})

test('upload: creator/hash/bytes, T0 unic, 60s abandon, listă de curățare și retry', async () => {
  await reset(); const r = await admit()
  await denies(a, `SELECT * FROM public.fn_ocr_local_confirma_upload(${quote(r.id)},${quote(other)},repeat('a',64),100)`, 'stare_invalida')
  await denies(a, `SELECT * FROM public.fn_ocr_local_confirma_upload(${quote(r.id)},${quote(user)},repeat('A',64),100)`, 'parametri_invalizi')
  await denies(a, `SELECT * FROM public.fn_ocr_local_confirma_upload(${quote(r.id)},${quote(user)},repeat('a',64),101)`, 'parametri_invalizi')
  await o.command(`UPDATE public.ocr_local_cereri SET termen_upload=clock_timestamp()-interval '1 second' WHERE id=${quote(r.id)};`)
  await denies(a, `SELECT * FROM public.fn_ocr_local_confirma_upload(${quote(r.id)},${quote(user)},repeat('a',64),100)`, 'termen_depasit')
  await a.command('SELECT public.fn_ocr_local_expira();')
  assert.equal((await state(r.id)).stare, 'expirata')
  assert.equal((await all(a, 'public.fn_ocr_local_curatenie_lista(50)'))[0].id, r.id)
  for (let i = 0; i < 11; i++) await a.command(`SELECT public.fn_ocr_local_curatenie_confirma(${quote(r.id)},false,'storage_esuat');`)
  assert.equal((await row(r.id)).stergere_incercari, 11)
  assert.equal((await all(a, 'public.fn_ocr_local_curatenie_lista(50)')).length, 1)
  assert.equal((await all(a, 'public.fn_ocr_local_probleme()')).length, 1)
  await a.command(`SELECT public.fn_ocr_local_curatenie_confirma(${quote(r.id)},true,NULL);`)
  assert.equal((await all(a, 'public.fn_ocr_local_curatenie_lista(50)')).length, 0)
  assert.equal((await row(r.id)).pdf_cale, null)
  const id = await requested(), before = await row(id)
  assert.equal(Math.round((Date.parse(before.termen_local) - Date.parse(before.termen_preluare)) / 1000), 70)
  assert.equal(Date.parse(before.sterge_dupa)-Date.parse(before.termen_local), (7*86400-90)*1000)
  await denies(a, `SELECT * FROM public.fn_ocr_local_confirma_upload(${quote(id)},${quote(user)},repeat('a',64),100)`, 'stare_invalida')
  assert.equal((await row(id)).termen_local, before.termen_local)
})

test('retenție 7 zile: pdf/hash/rezultat/apel_raspuns șterse, nicio rescriere tardivă; limită lot 50', async () => {
  await reset(); const id = await fallback()
  await reserve(id); await phase(id, 'trimis'); await phase(id, 'raspuns', { text_ocr: 'continut' }); await phase(id, 'decontat', null, '0.01')
  await a.command(`SELECT public.fn_ocr_local_inchide_fallback(${quote(id)},'{"text_ocr":"continut"}',NULL,0.01);`)
  await denies(a, `SELECT public.fn_ocr_local_curatenie_confirma(${quote(id)},true,NULL)`, 'termen_neatins')
  await o.command(`UPDATE public.ocr_local_cereri SET sterge_dupa=clock_timestamp()-interval '1 second' WHERE id=${quote(id)};`)
  await a.command(`SELECT public.fn_ocr_local_curatenie_confirma(${quote(id)},true,NULL);`)
  const r = await row(id)
  for (const key of ['pdf_cale', 'pdf_sha256', 'rezultat', 'apel_raspuns', 'stergere_eroare']) assert.equal(r[key], null, key)
  assert.ok(r.sters_la)
  await denies(a, `SELECT public.fn_ocr_local_apel_faza(${quote(id)},'raspuns',NULL,'{}',NULL)`, 'faza_invalida')
  await denies(a, `SELECT public.fn_ocr_local_inchide_fallback(${quote(id)},'{}',NULL,0)`, 'stare_invalida')
  assert.deepEqual(await ledger(), [0, 0.01], 'retenția nu șterge costul')
  await fill(51)
  assert.equal((await all(a, 'public.fn_ocr_local_curatenie_lista(500)')).length, 50)
  assert.equal((await all(a, 'public.fn_ocr_local_curatenie_lista(-1)')).length, 0)
})

test('rollback: orice cerere/incercare refuzata; catalog și gate E3 revin exact', async () => {
  await reset(); const id = await fallback()
  await denies(o, rollback, 'necesita postgres si armare')
  const armed = `PERFORM set_config('gazpet.revenire_20261108a','OCR_LOCAL_REVENIRE:'||txid_current(),true); ${rollback}`
  await denies(o, armed, 'exista istoric B1')
  await agePaid(id, 121); await a.command('SELECT public.fn_ocr_local_expira();')
  // Testează și apel rămas activ pe cerere deja expirată.
  await reset(); const r = await claimed(); await right(a, r.id, 'arbitraj', r.token)
  await o.command(`UPDATE public.ocr_local_cereri SET termen_local=clock_timestamp()-interval '1 second' WHERE id=${quote(r.id)};`)
  await a.command('SELECT public.fn_ocr_local_expira();')
  await denies(o, armed, 'exista istoric B1')
  // Contraexemplul din review: gata + decontat pastreaza legatura financiara.
  await reset(); const done = await fallback()
  await reserve(done); await phase(done, 'trimis'); await phase(done, 'raspuns', { ok: true })
  await phase(done, 'decontat', null, '0.01')
  await a.command(`SELECT public.fn_ocr_local_inchide_fallback(${quote(done)},'{"ok":true}',NULL,0.01);`)
  assert.equal((await row(done)).stare, 'gata')
  await denies(o, armed, 'exista istoric B1')
  // Cereri terminale, inclusiv payload deja curatat, blocheaza rollback-ul.
  for (const terminal of ['gata','esuata','expirata']) {
    await reset(); await fill(1)
    await o.command(`UPDATE public.ocr_local_cereri SET stare=${quote(terminal)}, sters_la=clock_timestamp() WHERE id IS NOT NULL;`)
    await denies(o, armed, 'exista istoric B1')
  }
  // Refuz fara nicio cerere admisa: incercarea singura trebuie pastrata.
  await reset()
  await a.command(`SELECT * FROM public.fn_ocr_local_admite(${quote(user)},NULL,${depot},'aviz_teava',100);`)
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_cereri)'), 0)
  assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM public.ocr_local_incercari)'), 1)
  await denies(o, armed, 'exista istoric B1')
  await reset()
  await o.command(`BEGIN; SELECT set_config('gazpet.revenire_20261108a','OCR_LOCAL_REVENIRE:'||txid_current(),true); ${rollback} COMMIT;`)
  installed = false
  assert.deepEqual(await o.value(fingerprint), baseline)
  assert.deepEqual(await o.value('to_jsonb(public.fn_izo_porti_lipsa())'), [])
})

try {
  assert.equal(await o.value('to_jsonb(session_user)'), 'postgres')
  const version = Number(await o.command('SHOW server_version_num;'))
  assert.ok(version >= 160000 && version < 180000, 'PG16/17 obligatoriu')
  assert.deepEqual(await o.value('to_jsonb(public.fn_izo_porti_lipsa())'), [], 'Clona trebuie să aibă E3 real sănătos înainte de B1')
  assert.equal(await o.value("to_jsonb(to_regclass('public.ocr_local_cereri') IS NULL)"), true, 'B1 nu trebuie aplicat încă')
  const users = await o.value('(SELECT jsonb_agg(id) FROM (SELECT id FROM public.profiles ORDER BY id LIMIT 2) p)')
  assert.equal(users?.length, 2, 'Clona trebuie să conțină doi profiles existenți')
  ;[user, other] = users
  // ID-uri existente, fara scrieri in domeniu. Cheia financiara trebuie sa fie complet nefolosita.
  project = await o.value(`(SELECT to_jsonb(p.id::text) FROM public.executie_proiecte p
    WHERE NOT EXISTS (SELECT 1 FROM public.ai_plafon_lunar l WHERE l.cheie='izo_e3_ocr:'||p.id)
      AND NOT EXISTS (SELECT 1 FROM public.ai_plafon_rezervari r WHERE r.cheie='izo_e3_ocr:'||p.id)
    ORDER BY p.id LIMIT 1)`)
  assert.ok(project, 'Clona necesita un proiect existent fara istoric AI pe cheia E3')
  depot = await o.value('(SELECT to_jsonb(id::text) FROM public.logistica_depozite ORDER BY id LIMIT 1)')
  assert.ok(depot, 'Clona necesita un depozit existent')
  assert.equal(await o.value(`to_jsonb(EXISTS(SELECT 1 FROM public.ai_plafon_lunar WHERE cheie='izo_e3_ocr:${project}'))`), false)
  // Admission folosește ceasul real. Nu alterăm funcțiile pentru a falsifica ora.
  assert.equal(await o.value(`to_jsonb((clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::time >= time '06:00'
    AND (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::time < time '21:55')`), true,
  'Rulați suita între 06:00–21:55 București; cazurile nocturne sunt testate separat cu helperul real')
  baseline = await o.value(fingerprint)
  for (const [name, body] of tests) {
    await body(); passed++; console.log(`PASS ${name}`)
  }
  console.log(`${passed}/${tests.length} PASS (PG real). Storage API / cron HTTP: de verificat în B2.`)
} catch (error) {
  console.error(`FAIL după ${passed} probe: ${error.message}`)
  if (installed) console.error('B1 rămâne instalat în clona de test pentru inspecție; nu executăm rollback automat după eșec.')
  process.exitCode = 1
} finally {
  // Eliberăm întâi deținătorii lock-urilor, apoi ceilalți clienți.
  for (const s of [...sessions]) await s.close()
}
