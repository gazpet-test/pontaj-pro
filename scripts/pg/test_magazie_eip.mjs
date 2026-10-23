// ASCII. Node stdlib + psql; numai baza LOCALA dedicata, fara modificari de roluri.
// Exemplu: PGURI=postgresql://localhost/eip_b1_test_local node scripts/pg/test_magazie_eip.mjs
// Rolul de conectare trebuie sa poata SET ROLE authenticated/service_role/anon,
// sa creeze schema teste si sa acorde privilegii pe propriile obiecte (fara superuser).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const target = new URL(process.env.PGURI || 'invalid:')
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PGURI local obligatoriu')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar PG local')
assert.match(decodeURIComponent(target.pathname.slice(1)), /^eip_b1_test_[a-z0-9_]+$/)
assert.equal(target.search, ''); assert.equal(target.hash, '')
assert.ok(!process.env.PGOPTIONS && !process.env.PGSERVICE && !process.env.PGSERVICEFILE)
// Aceleasi corpuri SQL; doar namespace-ul se muta. Nu atingem public/auth reale.
const isolate = sql => sql.replaceAll('public.', 'teste.').replaceAll('search_path = public, pg_temp', 'search_path = teste, pg_temp').replaceAll('auth.uid()', 'teste.uid()')
const migration = isolate(readFileSync(new URL('../../supabase/migrations/20261110a_magazie_eip_intrari.sql', import.meta.url), 'utf8'))
const rollback = isolate(readFileSync(new URL('../../supabase/revenire/20261110a_magazie_eip_intrari_ROLLBACK.sql', import.meta.url), 'utf8'))
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const sessions = new Set()
class Session {
  constructor(name) {
    this.name = name; this.out = ''; this.err = ''; this.n = 0
    this.child = spawn('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', target.href, '--file', '-'],
      { env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', s => { this.out += s })
    this.child.stderr.on('data', s => { this.err += s })
    this.child.on('error', e => { this.err += e.code || 'spawn'; this.ended = true })
    this.child.stdin.on('error', () => { this.ended = true })
    this.closed = new Promise(resolve => this.child.on('close', () => { this.ended = true; resolve() }))
    sessions.add(this)
  }
  async command(sql) {
    assert.ok(!this.busy, 'comenzi suprapuse'); this.busy = true
    const start = this.out.length, marker = `EIP_DONE_${++this.n}`
    this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    try {
      const until = Date.now() + 20000
      while (Date.now() < until) {
        const lines = this.out.slice(start).replaceAll('\r', '').split('\n'), end = lines.indexOf(marker)
        if (end >= 0) return lines.slice(0, end).join('\n').trim()
        if (this.ended) throw new Error(`${this.name}: ${this.err}`)
        await delay(15)
      }
      throw new Error(`${this.name}: timeout`)
    } finally { this.busy = false }
  }
  async value(expr) { return JSON.parse(await this.command(`SELECT coalesce((${expr})::jsonb,'null'::jsonb);`)) }
  async init(role) {
    await this.command(`SET statement_timeout='12s'; SET lock_timeout='10s'; SET idle_in_transaction_session_timeout='25s'; SET default_transaction_isolation='read committed'; ${role ? `SET ROLE ${role};` : ''}`)
    this.pid = await this.value('to_jsonb(pg_backend_pid())'); return this
  }
  async close() {
    if (!this.ended && !this.child.stdin.destroyed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    const timer = setTimeout(() => this.child.kill(), 1500)
    try { await this.closed } finally { clearTimeout(timer); sessions.delete(this) }
  }
}
async function denies(s, sql, message) {
  await s.command(`DO $test$ BEGIN BEGIN ${sql.replace(/;\s*$/, '')};
    RAISE EXCEPTION 'TEST_expected_refusal_missing'; EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE ${quote('%' + message + '%')} THEN RAISE; END IF; END; END $test$;`)
}
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const login = (s, n) => s.command(`SET request.jwt.claims=${quote(JSON.stringify({ sub: uid(n), role: 'authenticated' }))};`)
const antet = { furnizor_cui: 'RO14912759', furnizor_nume: 'LITIND SRL', factura_nr: 'TEST', factura_data: '2026-10-23' }
const call = (articol, marime, cantitate, key, pret = 10) => `teste.fn_eip_intrare_factura(${quote(JSON.stringify(antet))}::jsonb,${quote(JSON.stringify([{ articol_id: articol, marime, cantitate, pret_unitar: pret }]))}::jsonb,${quote(key)})`
let o, a, b, ownedSchema = false, passed = 0
const test = async (name, body) => { await body(); passed++; console.log(`PASS ${name}`) }
const invariant = async () => assert.equal(await o.value(`to_jsonb(NOT EXISTS (
  SELECT 1 FROM teste.magazie_echipamente e WHERE articol_id IS NOT NULL AND cantitate_total IS DISTINCT FROM
    (SELECT coalesce(sum(cantitate),0) FROM teste.eip_intrari i WHERE i.echipament_id=e.id)))`), true)
const state = () => o.value(`(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM teste.magazie_echipamente e)`)
const acl = () => o.value(`(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='teste' AND tablename LIKE 'magazie_%')`)
async function barrier(pid) {
  const until = Date.now() + 6000
  while (Date.now() < until) {
    if (await o.value(`to_jsonb(EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND NOT granted))`)) return
    await delay(20)
  }
  throw new Error('concurenta fara asteptare pe lock')
}
try {
  o = await new Session('observer').init()
  const version = Number(await o.command('SHOW server_version_num;'))
  assert.ok(version >= 170000 && version < 180000, 'PG17 obligatoriu')
  assert.equal(await o.value('(SELECT to_jsonb(rolsuper) FROM pg_roles WHERE rolname=current_user)'), false, 'Rulati ca proprietar nesuperuser, ca pe Supabase')
  assert.equal(await o.value(`to_jsonb(to_regnamespace('teste') IS NULL)`), true, 'schema teste trebuie sa lipseasca')
  await o.command('CREATE SCHEMA teste;'); ownedSchema = true
  await o.command(`
    GRANT USAGE ON SCHEMA teste TO authenticated,service_role,anon;
    CREATE FUNCTION teste.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE TABLE teste.profiles(id uuid PRIMARY KEY,is_owner boolean DEFAULT false,can_process_achizitii boolean DEFAULT false,can_manage_stoc boolean DEFAULT false,role text);
    INSERT INTO teste.profiles VALUES
      ('${uid(1)}',true,false,false,'user'),('${uid(2)}',false,false,true,'user'),
      ('${uid(3)}',false,false,false,'admin_logistica'),('${uid(4)}',false,true,false,'user'),
      ('${uid(5)}',false,false,false,'user');
    CREATE TABLE teste.magazie_echipamente (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,denumire text NOT NULL,categorie text NOT NULL CHECK(categorie IN ('eip','echipament')),
      este_eip boolean DEFAULT false,um text NOT NULL,serie text,cantitate_total numeric DEFAULT 0,
      stare text NOT NULL CHECK(stare IN ('functional','defect','casat')),comanda_sursa_id bigint,observatii text,
      activ boolean DEFAULT true,created_at timestamptz DEFAULT now(),created_by uuid);
    CREATE TABLE teste.magazie_inventar_angajat (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,echipament_id bigint REFERENCES teste.magazie_echipamente(id),
      employee_id bigint NOT NULL,cantitate numeric DEFAULT 1,data_predare date DEFAULT CURRENT_DATE,data_retur date,predat_de uuid,observatii text);
    ALTER TABLE teste.magazie_echipamente ENABLE ROW LEVEL SECURITY;
    ALTER TABLE teste.magazie_inventar_angajat ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_select ON teste.magazie_echipamente FOR SELECT USING(true);
    CREATE POLICY legacy_write ON teste.magazie_echipamente FOR ALL TO authenticated USING(teste.uid() IS NOT NULL) WITH CHECK(teste.uid() IS NOT NULL);
    CREATE POLICY legacy_select ON teste.magazie_inventar_angajat FOR SELECT USING(true);
    CREATE POLICY legacy_write ON teste.magazie_inventar_angajat FOR ALL TO authenticated USING(teste.uid() IS NOT NULL) WITH CHECK(teste.uid() IS NOT NULL);
    GRANT SELECT,INSERT,UPDATE,DELETE ON teste.magazie_echipamente,teste.magazie_inventar_angajat TO authenticated;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA teste TO authenticated;
    INSERT INTO teste.magazie_echipamente(denumire,categorie,este_eip,um,cantitate_total,stare)
      SELECT denumire,'eip',true,'buc',cantitate,'functional' FROM (VALUES
      ('SARDEGNA',40),('bocanci s3 sudura',30),('salopeta clasica',40),('IGNIFUGA',30),('VESTA NEON',30),('casca protectie alba',20)) x(denumire,cantitate);
    INSERT INTO teste.magazie_echipamente(denumire,categorie,um,cantitate_total,stare) VALUES('SCULA','echipament','buc',7,'functional');
  `)
  const baseline = await state(), policies = await acl()
  await o.command(migration)
  await test('migrare 6 randuri, 190 buc, mapare explicita, totaluri nemodificate', async () => {
    await invariant()
    assert.equal(await o.value('(SELECT to_jsonb(sum(cantitate_total)) FROM teste.magazie_echipamente WHERE este_eip)'), 190)
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(a.denumire ORDER BY e.id) FROM teste.magazie_echipamente e JOIN teste.eip_articole a ON a.id=e.articol_id)`),
      ['BOCANCI SARDEGNA S3 SRC','BOCANCI NEW WELDSTAR S3','SALOPETA CU PIEPTAR BBC','SALOPETA CU PIEPTAR IGNIFUGATA','VESTA NEON 386B-30R','CASCA INAP MASTER 2680'])
    assert.deepEqual((await state()).map(({ articol_id, marime, ...rest }) => rest), baseline)
    assert.deepEqual(await acl(), policies)
  })
  await test('rollback complet pe baza curata pastreaza toate randurile legacy', async () => {
    await o.command(rollback)
    assert.deepEqual(await state(), baseline); assert.deepEqual(await acl(), policies)
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='teste' AND (c.relname LIKE 'eip_%' OR c.relname='v_eip_stoc'))`), 0)
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM pg_proc WHERE pronamespace='teste'::regnamespace AND proname LIKE 'fn_eip_%')`), 0)
    await o.command(migration); await invariant()
  })
  a = await new Session('ui_a').init('authenticated'); b = await new Session('ui_b').init('authenticated')
  await login(a, 1); await login(b, 1)
  const articol = await o.value(`(SELECT to_jsonb(id) FROM teste.eip_articole WHERE denumire='BOCANCI SARDEGNA S3 SRC')`)
  await test('drepturi: owner/stoc/admin_logistica/achizitii; fara drept refuzat', async () => {
    for (const n of [1, 2, 3, 4]) { await login(a, n); await a.value(call(articol, String(40 + n), 2, `drept-${n}`)); await invariant() }
    await login(a, 5)
    await denies(a, `PERFORM ${call(articol, '48', 2, 'refuz')}`, 'eip_fara_drept')
    await denies(a, "PERFORM teste.fn_eip_corectie(1,40,'test')", 'eip_fara_drept')
    await denies(a, "PERFORM teste.fn_eip_articol_gaseste('RO14912759','00000168',NULL)", 'eip_fara_drept')
    await login(a, 1)
  })
  await test('idempotenta identica inclusiv dupa alta receptie; pretul nu schimba aliasul', async () => {
    const first = await a.value(call(articol, '45', 3, 'idem', 12))
    await invariant(); await a.value(call(articol, '45', 4, 'alta', 20)); await invariant()
    assert.deepEqual(await a.value(call(articol, '45', 99, 'idem', 999)), first); await invariant()
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime='45')`), 7)
    assert.deepEqual(await a.value(`(SELECT to_jsonb(x) FROM teste.fn_eip_articol_gaseste('RO14912759','00000168','alta descriere') x)`), { articol_id: articol, potrivire: 'cod' })
  })
  await test('factura multi-linie memoreaza toate rezultatele, duplicatele se cumuleaza', async () => {
    const lines = JSON.stringify([
      { articol_id: articol, marime: '51', cantitate: 2, pret_unitar: 10 },
      { articol_id: articol, marime: '52', cantitate: 4, pret_unitar: 11 },
      { articol_id: articol, marime: '51', cantitate: 3, pret_unitar: 12 },
    ])
    const rpc = `teste.fn_eip_intrare_factura(${quote(JSON.stringify(antet))},${quote(lines)},'multi')`
    const first = await a.value(rpc); await invariant()
    assert.equal(first.linii.length, 3)
    assert.deepEqual(await a.value(rpc), first); await invariant()
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(cantitate_total ORDER BY marime) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime IN ('51','52'))`), [5, 4])
  })
  await test('alias fara cod: numai denumire exacta in catalogul fara cod', async () => {
    const lookup = name => a.value(`(SELECT to_jsonb(x) FROM teste.fn_eip_articol_gaseste('RO14912759',NULL,${quote(name)}) x)`)
    assert.equal((await lookup('BOCANC STEELER WELDER S3')).potrivire, 'denumire')
    for (const name of ['BOCANC STEELER WELDER', 'BOCANC SARDEGNA S3 SRC', 'INSCRIPTIONARE SIGLA']) assert.deepEqual(await lookup(name), { articol_id: null, potrivire: 'nimic' })
  })
  await test('concurenta pe articol+marime nou si idempotenta concurenta', async () => {
    for (const sameKey of [false, true]) {
      const m = sameKey ? '47' : '46', key = sameKey ? 'concurent-idem' : 'concurent-a'
      await a.command('BEGIN;'); const first = await a.value(call(articol, m, 3, key))
      let pending
      try {
        pending = b.value(call(articol, m, 5, sameKey ? key : 'concurent-b'))
        await barrier(b.pid); await a.command('COMMIT;')
        const second = await pending
        if (sameKey) assert.deepEqual(second, first)
      } finally { await a.command('ROLLBACK;'); if (pending) await pending }
      assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime=${quote(m)})`), sameKey ? 3 : 8)
      await invariant()
    }
    // Repetam pe un rand deja existent: al doilea UPDATE vede totalul comis de primul.
    await a.command('BEGIN;'); await a.value(call(articol, '46', 2, 'existent-a'))
    let pending
    try {
      pending = b.value(call(articol, '46', 3, 'existent-b'))
      await barrier(b.pid); await a.command('COMMIT;'); await pending
    } finally { await a.command('ROLLBACK;'); if (pending) await pending }
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime='46')`), 13)
    await invariant()
  })
  await test('marimi distincte; corectie sub asignat refuzata; delta corecta', async () => {
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime IN ('45','46','47'))`), 3)
    const id = await o.value(`(SELECT to_jsonb(id) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime='46')`)
    await a.command(`INSERT INTO teste.magazie_inventar_angajat(echipament_id,employee_id,cantitate) VALUES(${id},1,4);`)
    assert.equal(await o.value(`(SELECT to_jsonb(marime) FROM teste.magazie_inventar_angajat WHERE echipament_id=${id})`), '46')
    await a.command(`UPDATE teste.magazie_inventar_angajat SET marime='inventata' WHERE echipament_id=${id};`)
    assert.equal(await o.value(`(SELECT to_jsonb(marime) FROM teste.magazie_inventar_angajat WHERE echipament_id=${id})`), '46')
    await denies(a, `PERFORM teste.fn_eip_corectie(${id},3,'inventar')`, 'eip_sub_asignat'); await invariant()
    await denies(a, `PERFORM teste.fn_eip_corectie(${id},4,' ')`, 'eip_corectie_invalida')
    assert.equal((await a.value(`teste.fn_eip_corectie(${id},4,'inventar')`)).delta, -9); await invariant()
    assert.equal(await a.value(`(SELECT to_jsonb(disponibil) FROM teste.v_eip_stoc WHERE echipament_id=${id})`), 0)
    await denies(a, "PERFORM teste.fn_eip_corectie(7,8,'scula')", 'eip_stoc_invalid')
  })
  await test('factura atomica, cantitati speciale refuzate, jurnal fara DML direct', async () => {
    const before = await state()
    for (const quantity of ['-1', 'NaN', 'Infinity']) await denies(a,
      `PERFORM teste.fn_eip_intrare_factura(${quote(JSON.stringify(antet))},'[{"articol_id":${articol},"cantitate":"${quantity}"}]','invalid-${quantity}')`, 'eip_linie_invalida')
    await denies(a, `PERFORM teste.fn_eip_intrare_factura(${quote(JSON.stringify(antet))},'[{"articol_id":${articol},"marime":"50","cantitate":2},{"articol_id":-1,"cantitate":1}]','atomic')`, 'eip_articol_invalid')
    assert.deepEqual(await state(), before); await invariant()
    const service = await new Session('service').init('service_role')
    try {
      for (const s of [a, service]) for (const sql of [
        'UPDATE teste.eip_intrari SET cantitate=999 WHERE id=1', 'DELETE FROM teste.eip_intrari WHERE id=1',
        `INSERT INTO teste.eip_intrari(echipament_id,articol_id,cantitate,sursa) VALUES(1,${articol},2,'manual')`,
        `INSERT INTO teste.eip_receptii(cheie,rezultat) VALUES('fals','{}')`,
      ]) await denies(s, sql, 'permission denied')
    } finally { await service.close() }
    await invariant()
  })
  await test('deriva legacy detectata; rollback cu istoric refuzat', async () => {
    await a.command('UPDATE teste.magazie_echipamente SET cantitate_total=41 WHERE id=1;')
    await denies(a, "PERFORM teste.fn_eip_corectie(1,40,'inventar')", 'eip_jurnal_divergent')
    await denies(a, `PERFORM ${call(articol, null, 1, 'deriva')}`, 'eip_jurnal_divergent')
    await a.command('UPDATE teste.magazie_echipamente SET cantitate_total=40 WHERE id=1;'); await invariant()
    // Rollback contine BEGIN/COMMIT: verificam garda ca subtranzactie separat.
    const guard = rollback.match(/DO \$\$[\s\S]*?END \$\$;/)[0]
    await denies(o, guard, 'eip_rollback_refuzat_istoric')
  })
  console.log(`${passed} PASS (PG17 real; fixture izolata, fara API PostgREST).`)
} catch (error) {
  console.error(`FAIL dupa ${passed} probe: ${error.message}`); process.exitCode = 1
} finally {
  for (const s of [...sessions].filter(s => s !== o)) await s.close()
  if (ownedSchema && o && !o.ended) {
    try { await o.command('ROLLBACK; DROP SCHEMA teste CASCADE;') }
    catch { console.error('FAIL cleanup schema teste'); process.exitCode = 1 }
  }
  if (o) await o.close()
}
