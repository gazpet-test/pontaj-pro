// ASCII. Node stdlib + psql; numai baza LOCALA dedicata, fara modificari de roluri.
// PGURI=postgresql://localhost/eip_b1_test_local node scripts/pg/test_magazie_eip.mjs
// Owner nesuperuser eip_owner cu SET ROLE authenticated/service_role/anon; schema teste trebuie sa lipseasca.
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
const migrationSource = readFileSync(new URL('../../supabase/migrations/20261110a_magazie_eip_intrari.sql', import.meta.url), 'utf8')
const rollbackSource = readFileSync(new URL('../../supabase/revenire/20261110a_magazie_eip_intrari_ROLLBACK.sql', import.meta.url), 'utf8')
// Numai copia izolata: namespace teste si exceptia de identitate pentru eip_owner.
// Marcajul legat de txid, izolarea si advisory lock raman verificate in SQL.
const isolate = sql => {
  assert.equal(sql.split("current_user <> 'postgres'").length - 1, 1)
  return sql.replaceAll('public.', 'teste.').replaceAll('search_path = public, pg_temp', 'search_path = teste, pg_temp')
    .replaceAll('auth.uid()', 'teste.uid()').replace("current_user <> 'postgres'", 'current_user <> current_user')
}
const migration = isolate(migrationSource), rollback = isolate(rollbackSource)
const migrationMapping = migration.match(/DO \$\$[\s\S]*?END \$\$;/)[0]
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const sqlText = s => s === null ? 'NULL' : quote(s)
// Scanner lexical pentru regresia de ambalare; nu este validatorul oficial.
// Comentariile, identificatorii/literalii citati si corpurile dollar nu sunt comenzi top-level.
// Verificam literalii obisnuiti si in interiorul corpurilor dollar.
function topLevel(sql) {
  let out = '', i = 0
  while (i < sql.length) {
    const rest = sql.slice(i)
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end + 1; out += ' '; continue
    }
    if (rest.startsWith('/*')) {
      let depth = 1; i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      assert.equal(depth, 0, 'comentariu neterminat'); out += ' '; continue
    }
    const dollar = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length)
      assert.ok(end >= 0, 'dollar quote neterminat')
      topLevel(sql.slice(i + dollar.length, end))
      i = end + dollar.length; out += ' '; continue
    }
    const escaped = /^[eE]'/.test(rest) && (i === 0 || !/[A-Za-z_0-9$]/.test(sql[i - 1]))
    if (sql[i] === "'" || escaped || sql[i] === '"') {
      const delimiter = escaped ? "'" : sql[i]
      i += escaped ? 2 : 1
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '\\' && delimiter === "'") {
          assert.ok(escaped, 'backslash in literal obisnuit')
          i += 2; continue
        }
        if (sql[i] === delimiter) {
          if (sql[i + 1] === delimiter) { i += 2; continue }
          i++; closed = true; break
        }
        i++
      }
      assert.ok(closed, 'literal neterminat'); out += ' '; continue
    }
    out += sql[i++]
  }
  return out
}
function checkPackaging(sql, tag) {
  assert.doesNotMatch(sql, /[^\x00-\x7f]/, 'SQL ASCII')
  assert.doesNotMatch(sql, /standard_conforming_strings|client_encoding|escape_string_warning|backslash_quote/i)
  const top = topLevel(sql)
  for (const statement of top.split(';')) assert.doesNotMatch(statement.trim(), /^(?:BEGIN|START|COMMIT|END|ROLLBACK|SAVEPOINT)\b/i)
  assert.ok(!top.includes('\\'), 'fara meta-comenzi psql')
  // Cast-urile sunt permise, interpolarile psql nu.
  assert.doesNotMatch(top.replaceAll('::', ''), /:(?:[A-Za-z_]|['"])/)
  assert.match(sql.replace(/^\s*--[^\n]*(?:\n|$)/, ''), new RegExp('^\\s*DO \\$' + tag + '\\$'))
  assert.doesNotMatch(top, /\bset_config\s*\(/i)
  if (tag === 'garda') assert.match(sql, /current_setting\('gazpet\.livrare_migrare', true\)/)
  else assert.match(sql, /current_setting\('gazpet\.revenire_20261110a', true\)/)
}
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
// Reproducem runnerul: o singura tranzactie, READ COMMITTED, marcaje locale legate de txid.
// Rollback-ul primeste si marcajul general al runnerului, si armarea specifica revenirii.
function deliverySql(sql, { returning = false, mark = 'valid', isolation = 'READ COMMITTED' } = {}) {
  const name = mark === 'wrong-name' ? 'alta_migrare:' : '20261110a_magazie_eip_intrari:'
  const txid = mark === 'wrong-txid' ? '(txid_current() + 1)' : 'txid_current()'
  return `BEGIN; SET TRANSACTION ISOLATION LEVEL ${isolation};
    ${mark === 'missing' ? '' : `SELECT set_config('gazpet.livrare_migrare', ${quote(name)} || ${txid}, true);`}
    ${returning && mark !== 'missing' ? "SELECT set_config('gazpet.revenire_20261110a', 'EIP_B1_SCOATE:' || txid_current(), true);" : ''}
    ${sql}
    COMMIT;`
}
const applyMigration = () => o.command(deliverySql(migration))
const applyRollback = () => o.command(deliverySql(rollback, { returning: true }))
async function refusesDelivery(sql, message, options = {}) {
  // ON_ERROR_STOP inchide sesiunea la refuz; asteptam inchiderea pentru rollback atomic.
  const s = new Session('delivery_refusal')
  try {
    await s.init()
    await assert.rejects(s.command(deliverySql(sql, options)), error => error.message.includes(message))
  } finally { await s.close() }
}
async function denies(s, sql, message) {
  await s.command(`DO $test$ BEGIN BEGIN ${sql.replace(/;\s*$/, '')};
    RAISE EXCEPTION 'TEST_expected_refusal_missing'; EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE ${quote('%' + message + '%')} THEN RAISE; END IF; END; END $test$;`)
}
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const login = (s, n) => s.command(`SET request.jwt.claims=${quote(JSON.stringify({ sub: uid(n), role: 'authenticated' }))};`)
const antet = { furnizor_cui: 'RO14912759', furnizor_nume: 'LITIND SRL', factura_nr: 'TEST', factura_data: '2026-10-23' }
const invoice = (header, lines, key) => `teste.fn_eip_intrare_factura(${quote(JSON.stringify(header))}::jsonb,${quote(JSON.stringify(lines))}::jsonb,${sqlText(key)})`
const call = (articol, marime, cantitate, key, pret = 10) => invoice(antet, [{ articol_id: articol, marime, cantitate, pret_unitar: pret }], key)
let moveSequence = 0
// Implicit o cheie noua pentru fiecare operatie distincta din testele r2.
// Testele de retry/concurenta r3 transmit explicit aceeasi cheie.
const move = (src, article, size, quantity, reason = 'reclasificare', key = `mutare-${++moveSequence}`) =>
  `teste.fn_eip_muta(${src},${article},${sqlText(size)},${sqlText(quantity)}::numeric,${sqlText(reason)},${sqlText(key)})`
let o, a, b, ownedSchema = false, passed = 0
const test = async (name, body) => { await body(); passed++; console.log(`PASS ${name}`) }
const invariant = async () => assert.equal(await o.value(`to_jsonb(NOT EXISTS (
  SELECT 1 FROM teste.magazie_echipamente e WHERE articol_id IS NOT NULL AND cantitate_total IS DISTINCT FROM
    (SELECT coalesce(sum(cantitate),0) FROM teste.eip_intrari i WHERE i.echipament_id=e.id)))`), true)
const state = () => o.value(`(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM teste.magazie_echipamente e)`)
const snapshot = () => o.value(`jsonb_build_object(
  'stoc',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM teste.magazie_echipamente e),
  'jurnal',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM teste.eip_intrari i),
  'receptii',(SELECT jsonb_agg(to_jsonb(r) ORDER BY cheie) FROM teste.eip_receptii r))`)
const acl = () => o.value(`(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='teste' AND tablename LIKE 'magazie_%')`)
async function noEipObjects() {
  assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='teste' AND (c.relname LIKE 'eip_%' OR c.relname='v_eip_stoc'))`), 0)
  assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM pg_proc WHERE pronamespace='teste'::regnamespace AND proname LIKE 'fn_eip_%')`), 0)
  assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM information_schema.columns WHERE table_schema='teste' AND table_name IN ('magazie_echipamente','magazie_inventar_angajat') AND column_name IN ('articol_id','marime'))`), 0)
}
async function barrier(pid) {
  const until = Date.now() + 6000
  while (Date.now() < until) {
    if (await o.value(`to_jsonb(EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND NOT granted))`)) return
    await delay(20)
  }
  throw new Error('concurenta fara asteptare pe advisory lock')
}
try {
  await test('r4 ambalare statica: tranzactie externa, literali si parametri protejati', async () => {
    checkPackaging(migrationSource, 'garda'); checkPackaging(rollbackSource, 'revenire')
    // Probe negative pentru scanner: nu poate ascunde tranzactii in comentarii/corpuri.
    assert.equal(topLevel('-- COMMIT;\nDO $$ BEGIN NULL; END $$; SELECT 1;').trim(), 'DO  ; SELECT 1;')
    for (const command of ['BEGIN', 'START TRANSACTION', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT x']) {
      assert.throws(() => checkPackaging(migrationSource + `\n${command};`, 'garda'))
    }
    assert.throws(() => checkPackaging(migrationSource + "\nSELECT 'bad\\literal';", 'garda'))
    assert.throws(() => checkPackaging(migrationSource + "\nDO $$ BEGIN PERFORM 'bad\\literal'; END $$;", 'garda'))
    assert.throws(() => checkPackaging(migrationSource + '\n-- client_encoding', 'garda'))
  })
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
    ALTER TABLE teste.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profile_self ON teste.profiles FOR SELECT TO authenticated USING(id=teste.uid());
    GRANT SELECT ON teste.profiles TO authenticated;
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
    -- Simulam default privileges Supabase, inclusiv EXECUTE pentru service_role.
    ALTER DEFAULT PRIVILEGES IN SCHEMA teste GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA teste GRANT ALL ON TABLES TO anon,authenticated,service_role;
    INSERT INTO teste.magazie_echipamente(denumire,categorie,este_eip,um,cantitate_total,stare)
      SELECT denumire,'eip',true,'buc',cantitate,'functional' FROM (VALUES
      ('BOCANCI SARDEGNA S3 SRC',47),('bocanci s3 - sudura',24),('salopeta cu pieptar clasica',50),('SALOPETA IGNIFUGA',24),('VESTA NEON',40),('casca protectie alba',5)) x(denumire,cantitate);
    INSERT INTO teste.magazie_echipamente(denumire,categorie,este_eip,um,cantitate_total,stare,activ) VALUES('bocanci','eip',true,'buc',1,'functional',false),('BOCANCI SARDEGNA S3 SRC','echipament',true,'buc',3,'functional',false);
    INSERT INTO teste.magazie_echipamente(denumire,categorie,um,cantitate_total,stare) VALUES('SCULA','echipament','buc',7,'functional');
  `)
  const baseline = await state(), policies = await acl()
  await test('r4 migrare fara marcaj refuzata fara efecte', async () => {
    await refusesDelivery(migration, 'numai postgres prin runner', { mark: 'missing' })
    await noEipObjects(); assert.deepEqual(await state(), baseline); assert.deepEqual(await acl(), policies)
  })
  await test('r4 migrare cu nume sau txid gresit refuzata; izolarea obligatorie', async () => {
    for (const mark of ['wrong-name', 'wrong-txid']) {
      await refusesDelivery(migration, 'numai postgres prin runner', { mark })
      await noEipObjects(); assert.deepEqual(await state(), baseline); assert.deepEqual(await acl(), policies)
    }
    await refusesDelivery(migration, 'READ COMMITTED', { isolation: 'REPEATABLE READ' })
    await noEipObjects(); assert.deepEqual(await state(), baseline)
  })
  await applyMigration()
  await test('r4 a doua aplicare refuzata fara efecte', async () => {
    const before = await snapshot()
    await refusesDelivery(migration, 'exista deja')
    assert.deepEqual(await snapshot(), before); await invariant()
  })
  await test('r4 rollback fara marcaj refuzat fara stergeri', async () => {
    const before = await snapshot()
    await refusesDelivery(rollback, 'Revenire EIP B1 nearmata', { returning: true, mark: 'missing' })
    assert.deepEqual(await snapshot(), before)
    assert.equal(await o.value(`to_jsonb(to_regclass('teste.eip_migrare_um') IS NOT NULL)`), true)
    await invariant()
  })
  await test('migrare 6 randuri, total 190, mapare explicita, cantitati nemodificate', async () => {
    await invariant()
    assert.equal(await o.value('(SELECT to_jsonb(sum(cantitate_total)) FROM teste.magazie_echipamente WHERE este_eip AND activ)'), 190)
    assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM teste.eip_intrari WHERE sursa=\'migrare\')'), 6)
    assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM teste.magazie_echipamente WHERE NOT activ AND articol_id IS NOT NULL)'), 0)
    assert.equal(await o.value('(SELECT to_jsonb(count(*)) FROM teste.eip_intrari i JOIN teste.magazie_echipamente e ON e.id=i.echipament_id WHERE NOT e.activ)'), 0)
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(a.denumire ORDER BY e.id) FROM teste.magazie_echipamente e JOIN teste.eip_articole a ON a.id=e.articol_id)`),
      ['BOCANCI SARDEGNA S3 SRC','BOCANCI NEW WELDSTAR S3','SALOPETA CU PIEPTAR BBC','SALOPETA CU PIEPTAR IGNIFUGATA','VESTA NEON 386B-30R','CASCA INAP MASTER 2680'])
    const expected = baseline.map(e => [1, 2].includes(e.id) ? { ...e, um: 'pereche' } : e)
    assert.deepEqual((await state()).map(({ articol_id, marime, ...rest }) => rest), expected)
    assert.deepEqual(await acl(), policies)
  })
  await test('r3 migrare: toate UM egale cu articolul, backup exact, total 190', async () => {
    assert.equal(await o.value(`to_jsonb(NOT EXISTS(SELECT 1 FROM teste.magazie_echipamente e JOIN teste.eip_articole a ON a.id=e.articol_id WHERE e.um IS DISTINCT FROM a.um))`), true)
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(jsonb_build_array(echipament_id,um_initial) ORDER BY echipament_id) FROM teste.eip_migrare_um)`),
      baseline.filter(e => e.este_eip && e.activ).map(e => [e.id, e.um]))
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(jsonb_build_array(um,cantitate_total) ORDER BY id) FROM teste.magazie_echipamente WHERE id IN (1,2))`), [['pereche', 47], ['pereche', 24]])
    assert.equal(await o.value(`(SELECT to_jsonb(sum(cantitate)) FROM teste.eip_intrari WHERE sursa='migrare')`), 190)
  })
  await test('r3 mapare: UM incompatibila refuzata atomic; etichete normalizate', async () => {
    const before = await snapshot()
    await o.command('BEGIN;')
    try {
      // Reconstituim numai intr-o tranzactie anulata fixture-ul dinaintea maparii.
      await o.command(`DELETE FROM teste.eip_intrari WHERE sursa='migrare';
        DELETE FROM teste.eip_migrare_um WHERE echipament_id BETWEEN 1 AND 6;
        UPDATE teste.magazie_echipamente SET articol_id=NULL,um=' BUC ' WHERE articol_id IS NOT NULL;
        UPDATE teste.magazie_echipamente SET um='pereche' WHERE id=3;`)
      const invalid = await snapshot()
      await denies(o, migrationMapping, 'eip_um_incompatibil')
      assert.deepEqual(await snapshot(), invalid)
      assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_migrare_um)`), 0)
      await o.command("UPDATE teste.magazie_echipamente SET um=' BUC ' WHERE id=3;")
      await o.command(migrationMapping)
      assert.equal(await o.value(`to_jsonb(NOT EXISTS(SELECT 1 FROM teste.magazie_echipamente e JOIN teste.eip_articole a ON a.id=e.articol_id WHERE e.um IS DISTINCT FROM a.um))`), true)
      assert.equal(await o.value(`(SELECT to_jsonb(sum(cantitate)) FROM teste.eip_intrari WHERE sursa='migrare')`), 190)
      assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_migrare_um WHERE um_initial=' BUC ')`), 6)
      await invariant()
    } finally { await o.command('ROLLBACK;') }
    assert.deepEqual(await snapshot(), before)
  })
  await test('rollback refuza deriva chiar fara istoric operational', async () => {
    await o.command('UPDATE teste.magazie_echipamente SET cantitate_total=48 WHERE id=1;')
    await refusesDelivery(rollback, 'eip_jurnal_divergent', { returning: true })
    assert.equal(await o.value(`to_jsonb(to_regclass('teste.eip_intrari') IS NOT NULL)`), true)
    await o.command('UPDATE teste.magazie_echipamente SET cantitate_total=47 WHERE id=1;'); await invariant()
  })
  await test('rollback complet pe baza curata pastreaza toate randurile legacy si UM initiale', async () => {
    await applyRollback()
    assert.deepEqual(await state(), baseline); assert.deepEqual(await acl(), policies)
    await noEipObjects()
    await applyMigration(); await invariant()
  })
  a = await new Session('ui_a').init('authenticated'); b = await new Session('ui_b').init('authenticated')
  await login(a, 1); await login(b, 1)
  const article = name => o.value(`(SELECT to_jsonb(id) FROM teste.eip_articole WHERE denumire=${quote(name)})`)
  const articol = await article('BOCANCI SARDEGNA S3 SRC')
  const weldstar = await article('BOCANCI NEW WELDSTAR S3'), steeler = await article('BOCANCI STEELER WELDER S3')
  const salopeta = await article('SALOPETA CU PIEPTAR BBC'), casca = await article('CASCA INAP MASTER 2680')
  const stockId = (aid, size) => o.value(`(SELECT to_jsonb(id) FROM teste.magazie_echipamente WHERE articol_id=${aid} AND activ AND marime IS NOT DISTINCT FROM ${sqlText(size)})`)
  await test('drepturi: owner/stoc/admin_logistica/achizitii; fara drept refuzat', async () => {
    for (const n of [1, 2, 3, 4]) { await login(a, n); await a.value(call(articol, String(40 + n), 2, `drept-${n}`)); await invariant() }
    await login(a, 5)
    await denies(a, `PERFORM ${call(articol, '48', 2, 'refuz')}`, 'eip_fara_drept')
    await denies(a, "PERFORM teste.fn_eip_corectie(1,40,'test')", 'eip_fara_drept')
    await denies(a, `PERFORM ${move(1, articol, '42', 1)}`, 'eip_fara_drept')
    await denies(a, "PERFORM teste.fn_eip_articol_gaseste('RO14912759','00000168',NULL)", 'eip_fara_drept')
    await login(a, 1)
  })
  await test('RLS jurnal si receptii vizibile numai celor cu drept de scriere', async () => {
    for (const n of [1, 2, 3, 4]) {
      await login(a, n)
      for (const table of ['eip_intrari', 'eip_receptii']) assert.equal(
        await a.value(`(SELECT to_jsonb(count(*)) FROM teste.${table})`),
        await o.value(`(SELECT to_jsonb(count(*)) FROM teste.${table})`))
    }
    for (const n of [5, 99]) {
      await login(a, n)
      for (const table of ['eip_intrari', 'eip_receptii']) assert.equal(await a.value(`(SELECT to_jsonb(count(*)) FROM teste.${table})`), 0)
    }
    await a.command("SET request.jwt.claims='{}';")
    assert.equal(await a.value('(SELECT to_jsonb(count(*)) FROM teste.eip_intrari)'), 0)
    assert.equal(await a.value('(SELECT to_jsonb(count(*)) FROM teste.eip_receptii)'), 0)
    await login(a, 1)
  })
  await test('ACL explicite si Gate 0e fara set_config', async () => {
    const signatures = ['fn_eip_verifica_drept()', 'fn_eip_intrare_factura(jsonb,jsonb,text)',
      'fn_eip_corectie(bigint,numeric,text)', 'fn_eip_muta(bigint,bigint,text,numeric,text,text)', 'fn_eip_articol_gaseste(text,text,text)']
    for (const sig of signatures) {
      for (const role of ['anon', 'service_role', 'authenticated']) assert.equal(
        await o.value(`to_jsonb(has_function_privilege(${quote(role)},${quote('teste.' + sig)},'EXECUTE'))`),
        role === 'authenticated' && !sig.startsWith('fn_eip_verifica_drept'))
      assert.equal(await o.value(`(SELECT to_jsonb(NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE')) FROM pg_proc p WHERE oid=${quote('teste.' + sig)}::regprocedure)`), true)
    }
    assert.equal(await o.value(`to_jsonb(to_regprocedure('teste.fn_eip_muta(bigint,bigint,text,numeric,text)') IS NULL)`), true)
    assert.equal(await o.value(`(SELECT to_jsonb(relrowsecurity) FROM pg_class WHERE oid='teste.eip_migrare_um'::regclass)`), true)
    for (const role of ['anon', 'service_role', 'authenticated']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await o.value(`to_jsonb(has_table_privilege(${quote(role)},'teste.eip_migrare_um',${quote(privilege)}))`), false)
    }
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM pg_proc WHERE pronamespace='teste'::regnamespace AND proname LIKE 'fn_eip_%' AND prosrc ~* 'set_config')`), 0)
    const service = await new Session('service_acl').init('service_role')
    const anon = await new Session('anon_acl').init('anon')
    try {
      for (const s of [service, anon]) for (const sql of [
        'PERFORM teste.fn_eip_verifica_drept()', `PERFORM ${call(articol, '48', 1, 'service-refuz')}`,
        "PERFORM teste.fn_eip_corectie(1,47,'test')", `PERFORM ${move(1, articol, '42', 1)}`,
        "PERFORM teste.fn_eip_articol_gaseste('RO14912759',NULL,NULL)",
      ]) await denies(s, sql, 'permission denied')
      await denies(a, 'PERFORM teste.fn_eip_verifica_drept()', 'permission denied')
    } finally { await service.close(); await anon.close() }
  })
  await test('idempotenta identica dupa alta receptie; cheia nu accepta alta factura', async () => {
    const first = await a.value(call(articol, '45', 3, 'idem', 12))
    await a.value(call(articol, '45', 4, 'alta', 20)); await invariant()
    assert.deepEqual(await a.value(call(articol, '45', 3, 'idem', 12)), first)
    const before = await snapshot()
    // Factura B are antet si stoc distinct: refuzul nu trebuie sa o inregistreze.
    await denies(a, `PERFORM ${invoice({ ...antet, factura_nr: 'FACTURA-B' }, [{ articol_id: articol, marime: '60', cantitate: 99, pret_unitar: 999 }], 'idem')}`, 'eip_cheie_reutilizata')
    for (const rpc of [call(articol, '45', 99, 'idem', 12), call(articol, '45', 3, 'idem', 999),
      invoice({ ...antet, factura_nr: 'B' }, [{ articol_id: articol, marime: '45', cantitate: 3, pret_unitar: 12 }], 'idem')]) {
      await denies(a, `PERFORM ${rpc}`, 'eip_cheie_reutilizata')
    }
    assert.deepEqual(await snapshot(), before)
    assert.equal(await stockId(articol, '60'), null)
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime='45')`), 7)
    assert.deepEqual(await a.value(`(SELECT to_jsonb(x) FROM teste.fn_eip_articol_gaseste('RO14912759','00000168','alta descriere') x)`), { articol_id: articol, potrivire: 'cod' })
    await invariant()
  })
  await test('multi-linie: duplicate cumulate; hash normalizat independent de ordine', async () => {
    const lines = [
      { articol_id: articol, marime: '51', cantitate: 2, pret_unitar: 10 },
      { articol_id: articol, marime: '52', cantitate: 4, pret_unitar: 11 },
      { articol_id: articol, marime: '51', cantitate: 3, pret_unitar: 12 },
    ]
    const first = await a.value(invoice(antet, lines, 'multi')); await invariant()
    assert.equal(first.linii.length, 3)
    const normalized = [...lines].reverse().map(l => ({ ...l, articol_id: String(l.articol_id), marime: ` ${l.marime} `, cantitate: `${l.cantitate}.00`, pret_unitar: `${l.pret_unitar}.00` }))
    assert.deepEqual(await a.value(invoice({ ...antet, furnizor_cui: ' ro14912759 ' }, normalized, 'multi')), first)
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(cantitate_total ORDER BY marime) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime IN ('51','52'))`), [5, 4])
    await invariant()
  })
  await test('marime obligatorie numar/litera; unica permite numai NULL', async () => {
    const before = await snapshot()
    for (const aid of [articol, salopeta]) for (const size of [null, '', '   ']) {
      await denies(a, `PERFORM ${call(aid, size, 1, `size-${aid}-${size}`)}`, 'eip_marime_obligatorie')
      await denies(a, `PERFORM ${move(1, aid, size, 1)}`, 'eip_marime_obligatorie')
    }
    await denies(a, `PERFORM ${call(casca, '42', 1, 'unica-invalida')}`, 'eip_linie_invalida')
    await denies(a, `PERFORM ${move(1, casca, '42', 1)}`, 'eip_linie_invalida')
    assert.deepEqual(await snapshot(), before)
    await a.value(call(casca, null, 1, 'unica'))
    await a.value(call(salopeta, ' xl ', 1, 'litera'))
    assert.ok(await stockId(salopeta, 'XL')); await invariant()
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
        pending = b.value(call(articol, m, sameKey ? 3 : 5, sameKey ? key : 'concurent-b'))
        await barrier(b.pid); await a.command('COMMIT;')
        const second = await pending
        if (sameKey) assert.deepEqual(second, first)
      } finally { await a.command('ROLLBACK;'); if (pending) await pending }
      assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime=${quote(m)})`), sameKey ? 3 : 8)
      await invariant()
    }
    await a.command('BEGIN;'); await a.value(call(articol, '46', 2, 'existent-a'))
    let pending
    try {
      pending = b.value(call(articol, '46', 3, 'existent-b'))
      await barrier(b.pid); await a.command('COMMIT;'); await pending
    } finally { await a.command('ROLLBACK;'); if (pending) await pending }
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime='46')`), 13)
    await invariant()
  })
  await test('cheie concurenta cu continut diferit refuzata dupa commit', async () => {
    await a.command('BEGIN;')
    const first = await a.value(call(articol, '66', 2, 'idem-conflict'))
    let pending
    try {
      pending = denies(b, `PERFORM ${call(articol, '67', 3, 'idem-conflict')}`, 'eip_cheie_reutilizata')
      await barrier(b.pid); await a.command('COMMIT;'); await pending
    } finally { await a.command('ROLLBACK;'); if (pending) await pending }
    assert.equal(await stockId(articol, '67'), null)
    assert.deepEqual(await a.value(call(articol, '66', 2, 'idem-conflict')), first)
    await invariant()
  })
  await test('marimi distincte; corectie sub asignat refuzata; delta corecta', async () => {
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.magazie_echipamente WHERE articol_id=${articol} AND marime IN ('45','46','47'))`), 3)
    const id = await stockId(articol, '46')
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
  await test('mutare NULL->42 pastreaza total articol si scrie perechea din jurnal', async () => {
    const total = await o.value(`(SELECT to_jsonb(sum(cantitate_total)) FROM teste.magazie_echipamente WHERE articol_id=${articol})`)
    const result = await a.value(move(1, articol, ' 42 ', 5, ' separare marime '))
    assert.equal(result.in_echipament_id, await stockId(articol, '42'))
    assert.equal(await o.value(`(SELECT to_jsonb(sum(cantitate_total)) FROM teste.magazie_echipamente WHERE articol_id=${articol})`), total)
    assert.deepEqual(await o.value(`(SELECT jsonb_agg(jsonb_build_array(echipament_id,cantitate,motiv,sursa) ORDER BY id) FROM teste.eip_intrari WHERE id IN (${result.intrare_din_id},${result.intrare_in_id}))`),
      [[1, -5, 'separare marime', 'mutare'], [result.in_echipament_id, 5, 'separare marime', 'mutare']])
    await invariant()
  })
  await test('mutare Weldstar->Steeler creeaza destinatia cu valori implicite', async () => {
    const total = await o.value('(SELECT to_jsonb(sum(cantitate_total)) FROM teste.magazie_echipamente WHERE articol_id IS NOT NULL)')
    const result = await a.value(move(2, steeler, '43', 6))
    assert.deepEqual(await o.value(`(SELECT jsonb_build_array(articol_id,marime,categorie,stare,um,este_eip,activ,cantitate_total) FROM teste.magazie_echipamente WHERE id=${result.in_echipament_id})`),
      [steeler, '43', 'eip', 'functional', 'pereche', true, true, 6])
    assert.equal(await o.value('(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=2)'), 18)
    assert.equal(await o.value('(SELECT to_jsonb(sum(cantitate_total)) FROM teste.magazie_echipamente WHERE articol_id IS NOT NULL)'), total)
    assert.equal(await o.value(`(SELECT to_jsonb(articol_id) FROM teste.magazie_echipamente WHERE id=2)`), weldstar)
    await invariant()
  })
  await test('mutari invalide si sub asignat atomice; asignari returnate excluse', async () => {
    await a.command('INSERT INTO teste.magazie_inventar_angajat(echipament_id,employee_id,cantitate) VALUES(1,2,40);')
    await a.command("INSERT INTO teste.magazie_inventar_angajat(echipament_id,employee_id,cantitate,data_retur) VALUES(1,3,100,CURRENT_DATE);")
    const before = await snapshot()
    await denies(a, `PERFORM ${move(1, articol, '61', 3)}`, 'eip_sub_asignat')
    for (const reason of ['', ' ', null]) await denies(a, `PERFORM ${move(1, articol, '61', 1, reason)}`, 'eip_mutare_invalida')
    for (const quantity of [0, -1, 'NaN', 'Infinity', '-Infinity']) await denies(a, `PERFORM ${move(1, articol, '61', quantity)}`, 'eip_mutare_invalida')
    await denies(a, `PERFORM ${move(1, articol, '61', null, 'test')}`, 'eip_mutare_invalida')
    await denies(a, `PERFORM ${move(await stockId(articol, '42'), articol, '42', 1)}`, 'eip_mutare_aceeasi_destinatie')
    assert.deepEqual(await snapshot(), before)
    assert.equal(await stockId(articol, '61'), null, 'destinatia creata se anuleaza la refuz')
    // 42 total, 40 nereturnate: se pot muta exact 2, indiferent de cele 100 returnate.
    await a.value(move(1, articol, '61', 2)); await invariant()
    const after = await snapshot()
    await denies(a, `PERFORM ${move(1, articol, '61', 1)}`, 'eip_sub_asignat')
    assert.deepEqual(await snapshot(), after)
    // Destinatie unica NULL, cu UM compatibila: salopeta buc -> casca buc.
    await a.value(move(await stockId(salopeta, 'XL'), casca, null, 1)); await invariant()
  })
  await test('doua mutari concurente serializate, inclusiv destinatie noua comuna', async () => {
    const src = await stockId(articol, '45')
    await a.command('BEGIN;'); await a.value(move(src, articol, '62', 2))
    let pending
    try {
      pending = b.value(move(src, articol, '62', 3))
      await barrier(b.pid); await a.command('COMMIT;'); await pending
    } finally { await a.command('ROLLBACK;'); if (pending) await pending }
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${src})`), 2)
    const dst = await stockId(articol, '62')
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${dst})`), 5)
    // A doua mutare ar depasi disponibilul dupa commit-ul primei.
    await a.command('BEGIN;'); await a.value(move(dst, articol, '63', 4))
    pending = undefined
    try {
      pending = denies(b, `PERFORM ${move(dst, articol, '64', 2)}`, 'eip_sub_asignat')
      await barrier(b.pid); await a.command('COMMIT;'); await pending
    } finally { await a.command('ROLLBACK;'); if (pending) await pending }
    assert.equal(await stockId(articol, '64'), null)
    // Destinatie cu id mai mic decat sursa: parcurge si ordinea inversa de mutare.
    await a.value(move(await stockId(articol, '63'), articol, '45', 1)); await invariant()
  })
  await test('factura atomica, cantitati speciale refuzate, jurnal fara DML direct', async () => {
    const before = await snapshot()
    for (const quantity of ['-1', 'NaN', 'Infinity']) await denies(a,
      `PERFORM ${call(articol, '50', quantity, `invalid-${quantity}`)}`, 'eip_linie_invalida')
    await denies(a, `PERFORM ${invoice(antet, [{ articol_id: articol, marime: '50', cantitate: 2 }, { articol_id: -1, cantitate: 1 }], 'atomic')}`, 'eip_articol_invalid')
    // Articol invalid ultim in ordinea normalizata: verifica rollback dupa prima linie.
    await denies(a, `PERFORM ${invoice(antet, [{ articol_id: articol, marime: '50', cantitate: 2 }, { articol_id: 999999, cantitate: 1 }], 'atomic-tarziu')}`, 'eip_articol_invalid')
    assert.deepEqual(await snapshot(), before); await invariant()
    const service = await new Session('service_dml').init('service_role')
    try {
      for (const s of [a, service]) for (const sql of [
        'UPDATE teste.eip_intrari SET cantitate=999 WHERE id=1', 'DELETE FROM teste.eip_intrari WHERE id=1',
        `INSERT INTO teste.eip_intrari(echipament_id,articol_id,cantitate,sursa) VALUES(1,${articol},2,'manual')`,
        `INSERT INTO teste.eip_receptii(cheie,tip,continut_hash,rezultat) VALUES('fals','receptie',md5('fals'),'{}')`,
        "UPDATE teste.eip_migrare_um SET um_initial='fals' WHERE echipament_id=1",
      ]) await denies(s, sql, 'permission denied')
    } finally { await service.close() }
    await invariant()
  })
  await test('deriva legacy detectata in toate RPC; rollback cu istoric refuzat', async () => {
    const id = await stockId(articol, '45')
    const total = await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${id})`)
    await a.command(`UPDATE teste.magazie_echipamente SET cantitate_total=cantitate_total+1 WHERE id=${id};`)
    await denies(a, `PERFORM teste.fn_eip_corectie(${id},${total},'inventar')`, 'eip_jurnal_divergent')
    await denies(a, `PERFORM ${call(articol, '45', 1, 'deriva')}`, 'eip_jurnal_divergent')
    await denies(a, `PERFORM ${move(id, articol, '65', 1)}`, 'eip_jurnal_divergent')
    await denies(a, `PERFORM ${move(await stockId(articol, '62'), articol, '45', 1)}`, 'eip_jurnal_divergent')
    await a.command(`UPDATE teste.magazie_echipamente SET cantitate_total=${total} WHERE id=${id};`); await invariant()
    await refusesDelivery(rollback, 'eip_rollback_refuzat_istoric', { returning: true })
  })
  await test('r3 mutare idempotenta: sursa 23, destinatie 1, doar doua randuri jurnal', async () => {
    await a.value(call(weldstar, '71', 24, 'r3-stoc-idem'))
    const src = await stockId(weldstar, '71')
    const count = await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_intrari)`)
    const first = await a.value(move(src, steeler, '72', 1, ' separare ', 'r3-muta-idem'))
    const after = await snapshot()
    assert.deepEqual(await a.value(move(src, steeler, ' 72 ', '1.00', 'separare', 'r3-muta-idem')), first)
    assert.deepEqual(await snapshot(), after)
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${src})`), 23)
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${first.in_echipament_id})`), 1)
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_intrari)`), count + 2)
    assert.equal(await o.value(`(SELECT to_jsonb(tip) FROM teste.eip_receptii WHERE cheie='r3-muta-idem')`), 'mutare')
    // Retry dupa alta mutare: rezultatul initial ramane memorat.
    await a.value(move(src, steeler, '73', 1, 'alta', 'r3-muta-alta'))
    const later = await snapshot()
    assert.deepEqual(await a.value(move(src, steeler, '72', 1, 'separare', 'r3-muta-idem')), first)
    assert.deepEqual(await snapshot(), later); await invariant()
  })
  await test('r3 aceeasi cheie de mutare cu alt continut refuzata atomic', async () => {
    const src = await stockId(weldstar, '71'), before = await snapshot()
    for (const rpc of [
      move(src, steeler, '72', 2, 'separare', 'r3-muta-idem'),
      move(src, steeler, '74', 1, 'separare', 'r3-muta-idem'),
      move(src, weldstar, '72', 1, 'separare', 'r3-muta-idem'),
      move(2, steeler, '72', 1, 'separare', 'r3-muta-idem'),
      move(src, steeler, '72', 1, 'alt motiv', 'r3-muta-idem'),
    ]) await denies(a, `PERFORM ${rpc}`, 'eip_cheie_reutilizata')
    assert.deepEqual(await snapshot(), before); await invariant()
  })
  await test('r3 cheia globala: receptie->mutare si mutare->receptie refuzate', async () => {
    const before = await snapshot(), src = await stockId(weldstar, '71')
    await denies(a, `PERFORM ${move(src, steeler, '74', 1, 'test', 'r3-stoc-idem')}`, 'eip_cheie_reutilizata')
    await denies(a, `PERFORM ${call(steeler, '75', 1, 'r3-muta-idem')}`, 'eip_cheie_reutilizata')
    assert.deepEqual(await snapshot(), before)
    assert.equal(await stockId(steeler, '74'), null)
    assert.equal(await stockId(steeler, '75'), null); await invariant()
  })
  await test('r3 doua mutari concurente cu aceeasi cheie au un singur efect', async () => {
    await a.value(call(weldstar, '76', 24, 'r3-stoc-concurent'))
    const src = await stockId(weldstar, '76')
    const count = await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_intrari)`)
    await a.command('BEGIN;')
    const first = await a.value(move(src, steeler, '77', 1, 'concurent', 'r3-muta-concurent'))
    let pending
    try {
      pending = b.value(move(src, steeler, ' 77 ', '1.00', ' concurent ', 'r3-muta-concurent'))
      await barrier(b.pid); await a.command('COMMIT;')
      assert.deepEqual(await pending, first)
    } finally { await a.command('ROLLBACK;'); if (pending) await pending }
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${src})`), 23)
    assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${first.in_echipament_id})`), 1)
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_intrari)`), count + 2)
    assert.equal(await o.value(`(SELECT to_jsonb(count(*)) FROM teste.eip_receptii WHERE cheie='r3-muta-concurent')`), 1)
    await invariant()
  })
  await test('r3 mutare cu cheie NULL, goala sau spatii refuzata', async () => {
    const before = await snapshot(), src = await stockId(weldstar, '71')
    for (const key of [null, '', '   ']) {
      await denies(a, `PERFORM ${move(src, steeler, '78', 1, 'test', key)}`, 'eip_cheie_obligatorie')
      await denies(a, `PERFORM ${call(steeler, '78', 1, key)}`, 'eip_cheie_obligatorie')
    }
    assert.deepEqual(await snapshot(), before); await invariant()
  })
  await test('r3 UM sursa buc -> articol pereche refuzata fara efect', async () => {
    const before = await snapshot()
    await denies(a, `PERFORM ${move(3, steeler, '79', 1, 'test', 'r3-um-src')}`, 'eip_um_incompatibil')
    assert.deepEqual(await snapshot(), before)
    assert.equal(await stockId(steeler, '79'), null)
    // Sensul invers este de asemenea incompatibil.
    await denies(a, `PERFORM ${move(2, casca, null, 1, 'test', 'r3-um-invers')}`, 'eip_um_incompatibil')
    assert.deepEqual(await snapshot(), before); await invariant()
  })
  await test('r3 UM destinatie incompatibila refuzata; upper/btrim acceptate intre articole', async () => {
    const src = await stockId(weldstar, '76'), dst = await stockId(steeler, '77')
    await o.command(`UPDATE teste.magazie_echipamente SET um='buc' WHERE id=${dst};`)
    try {
      const before = await snapshot()
      await denies(a, `PERFORM ${move(src, steeler, '77', 1, 'test', 'r3-um-dst')}`, 'eip_um_incompatibil')
      assert.deepEqual(await snapshot(), before)
    } finally { await o.command(`UPDATE teste.magazie_echipamente SET um='pereche' WHERE id=${dst};`) }
    await o.command(`UPDATE teste.magazie_echipamente SET um=' PERECHE ' WHERE id IN (${src},${dst});`)
    try {
      const result = await a.value(move(src, steeler, '77', 1, 'test', 'r3-um-normalizat'))
      assert.equal(result.in_echipament_id, dst)
      assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${src})`), 22)
      assert.equal(await o.value(`(SELECT to_jsonb(cantitate_total) FROM teste.magazie_echipamente WHERE id=${dst})`), 2)
    } finally { await o.command(`UPDATE teste.magazie_echipamente SET um='pereche' WHERE id IN (${src},${dst});`) }
    await invariant()
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
