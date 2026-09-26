// R9b: probele 2 și 3 pe PostgreSQL 16 real. Fără PGlite sau dependențe npm.
// Fixture sintetic adaptat din scripts/pglite/test_r9b_decisive.mjs.
// ATENȚIE: recreează baza LOCALĂ indicată de PGURI; vezi docs/R5_TESTE_PROBE23.md.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const OWNER = '00000000-0000-4000-8000-000000000121'
const RESPONSABIL = '00000000-0000-4000-8000-000000000007'
const FARA_ACCES = '00000000-0000-4000-8000-000000000099'
const sqlText = value => "'" + String(value).replaceAll("'", "''") + "'"
const env = { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' }
const options = ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1']
const sessions = new Set()
let uri, failed = 0, passed = 0, nextFixture = 2000

function runSql(connection, sql) {
  try {
    return execFileSync('psql', [...options, '--dbname', connection, '--file', '-'], {
      input: sql, encoding: 'utf8', env, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    }).trim()
  } catch (error) {
    // Nu afișăm comanda execFileSync: PGURI poate conține parola.
    throw new Error(`psql: ${error.code === 'ENOENT' ? 'executabil indisponibil în PATH' :
      String(error.stderr || error.code || 'execuție eșuată').trim()}`)
  }
}

// Fiecare obiect păstrează UN proces psql și O sesiune PostgreSQL, inclusiv între comenzi.
// Markerii confirmă terminarea comenzilor, nu doar trimiterea lor în stdin.
class Session {
  constructor(name) {
    this.name = name
    this.out = ''
    this.err = ''
    this.ended = false
    this.busy = false
    this.sequence = 0
    this.child = spawn('psql', [...options, '--dbname', uri, '--file', '-'], {
      env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    sessions.add(this)
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', chunk => { this.out += chunk })
    this.child.stderr.on('data', chunk => { this.err += chunk })
    this.child.on('error', error => { this.err += error.code || 'spawn eșuat'; this.ended = true })
    this.child.stdin.on('error', error => { this.err += error.code || 'stdin închis'; this.ended = true })
    this.closed = new Promise(resolve => this.child.once('close', code => {
      this.ended = true
      this.exitCode = code
      resolve()
    }))
  }

  async command(sql) {
    assert.equal(this.busy, false, `${this.name}: comandă suprapusă în aceeași sesiune`)
    assert.equal(this.ended, false, `${this.name}: sesiune închisă: ${this.err}`)
    this.busy = true
    const start = this.out.length
    const marker = `R9B_DONE_${++this.sequence}`
    this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    try {
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        const lines = this.out.slice(start).replaceAll('\r', '').split('\n')
        const end = lines.indexOf(marker)
        if (end !== -1) return lines.slice(0, end).join('\n').trim()
        if (this.ended) throw new Error(`${this.name}: psql exit ${this.exitCode}: ${this.err.trim()}`)
        await delay(20)
      }
      throw new Error(`${this.name}: timeout așteptând terminarea comenzii; ${this.err.trim()}`)
    } finally {
      this.busy = false
    }
  }

  async value(expression) {
    return JSON.parse(await this.command(`SELECT (${expression})::jsonb;`))
  }

  async init(uid = null) {
    await this.command(`SET application_name = ${sqlText(`r9b_probe23_${this.name}`)};
      SET TimeZone = 'UTC'; SET standard_conforming_strings = on;
      SET default_transaction_isolation = 'read committed';
      SET statement_timeout = '12s'; SET lock_timeout = '10s';
      SET idle_in_transaction_session_timeout = '25s';
      ${uid ? `SET ROLE authenticated;
        SET request.jwt.claims = ${sqlText(JSON.stringify({ sub: uid, role: 'authenticated' }))};` : ''}`)
    this.pid = await this.value('to_jsonb(pg_backend_pid())')
    if (uid) {
      assert.deepEqual(await this.value("jsonb_build_array(current_user, auth.uid())"), ['authenticated', uid])
    }
    return this
  }

  async close() {
    if (!this.ended) {
      // Dacă un test a eșuat cu un query blocat, anulăm backendul înainte de ROLLBACK.
      if (this.busy && this.pid) {
        runSql(uri, `SELECT pg_cancel_backend(${this.pid});`)
      }
      if (!this.child.stdin.destroyed) this.child.stdin.end('ROLLBACK;\n\\q\n')
      const timer = setTimeout(() => this.child.kill(), 3000)
      try { await this.closed } finally { clearTimeout(timer) }
    } else {
      await this.closed
    }
    sessions.delete(this)
  }
}

const fixtureSql = `
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid
$$;
CREATE TABLE profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
CREATE TABLE user_module_access (profile_id uuid, module text, access_level text);
INSERT INTO profiles VALUES ('${OWNER}',true),('${RESPONSABIL}',false),('${FARA_ACCES}',false);
INSERT INTO user_module_access VALUES ('${RESPONSABIL}','ofertare','editor'),('${FARA_ACCES}','logistica','admin');
CREATE FUNCTION fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_owner)
    OR EXISTS (SELECT 1 FROM user_module_access WHERE profile_id=auth.uid() AND module='ofertare'))
$$;
CREATE TABLE ofertare_licitatii (id bigint PRIMARY KEY, responsabil_id uuid,
  status text DEFAULT 'in_lucru', derogare_depunere boolean DEFAULT false, termen_depunere timestamptz);
CREATE FUNCTION fn_ofertare_source_pack_poate_decide(p_licitatie_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_owner)
    OR EXISTS (SELECT 1 FROM ofertare_licitatii WHERE id=p_licitatie_id AND responsabil_id=auth.uid())
    OR EXISTS (SELECT 1 FROM user_module_access WHERE profile_id=auth.uid() AND module='ofertare' AND access_level='admin'))
$$;
CREATE TABLE ofertare_documente_atribuire (id bigint PRIMARY KEY, licitatie_id bigint, nume_original text,
  tip text, status_procesare text, eroare text, analiza jsonb, analiza_la timestamptz);
ALTER TABLE ofertare_documente_atribuire ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_documente_select ON ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_documente_update ON ofertare_documente_atribuire FOR UPDATE TO authenticated
  USING ((SELECT fn_are_acces_ofertare())) WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_insert ON ofertare_documente_atribuire FOR INSERT TO authenticated WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_delete ON ofertare_documente_atribuire FOR DELETE TO authenticated USING ((SELECT fn_are_acces_ofertare()));
CREATE TABLE ofertare_cantitati (id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, obiect text, categorie text,
  denumire text NOT NULL, um text, cantitate numeric, specificatii text, sursa text, cantitate_plansa numeric,
  diferenta_nota text, status text NOT NULL DEFAULT 'extras', extras_de_ai boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), tip_sursa text, cod_articol text, ordine int,
  CONSTRAINT ofertare_cantitati_status_check CHECK (status IN ('extras','validat','diferenta','revizuit_clarificare')),
  CONSTRAINT ofertare_cantitati_tip_sursa_check CHECK (tip_sursa IN ('lista_f3','lista_c6','lista_alt','memoriu','plansa','caiet','alt')));
ALTER TABLE ofertare_cantitati ENABLE ROW LEVEL SECURITY;
CREATE POLICY cant_all ON ofertare_cantitati TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE FUNCTION fn_categorie_cantitate(d text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d ~* 'conduct|țeav|teav|tub' THEN 'Conducte și montaj' END
$$;
CREATE FUNCTION fn_trg_categorie_cantitate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF coalesce(NEW.extras_de_ai,false) THEN NEW.categorie := fn_categorie_cantitate(NEW.denumire); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_categorie_cantitate BEFORE INSERT OR UPDATE OF denumire ON ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION fn_trg_categorie_cantitate();
CREATE TABLE ofertare_clarificari (id bigserial PRIMARY KEY, licitatie_id bigint, nr int, intrebare text, sursa text,
  cantitate_id bigint, status text CHECK (status IN ('propunere','de_trimis','trimisa','raspunsa','retrasa')),
  raspuns text, raspuns_la timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  origine text, cheie text, fisier_path text, creat_de uuid, citita_la timestamptz, citita_rezumat text,
  raspuns_document_id bigint, UNIQUE (licitatie_id,cheie));
CREATE TABLE notifications (id bigserial PRIMARY KEY, profile_id uuid, type text, modul text, title text,
  message text, link_to text, created_at timestamptz DEFAULT now());
CREATE TABLE seap_compl (licitatie_id bigint PRIMARY KEY, blocaj text);
CREATE VIEW v_ofertare_seap_completitudine AS SELECT licitatie_id,blocaj FROM seap_compl;
CREATE TABLE ofertare_pt_pachet (id bigserial PRIMARY KEY, licitatie_id bigint, stare text DEFAULT 'propus');
-- Stub-uri de instalare; migrarea 2 le înlocuiește integral cu definițiile ei.
CREATE FUNCTION fn_ofertare_pt_pachet_poarta_documentatie() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_ofertare_pt_pachet_poarta_documentatie BEFORE INSERT OR UPDATE OF stare ON ofertare_pt_pachet
  FOR EACH ROW EXECUTE FUNCTION fn_ofertare_pt_pachet_poarta_documentatie();
CREATE FUNCTION fn_gate_depunere() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
  AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_gate_depunere BEFORE UPDATE ON ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION fn_gate_depunere();
CREATE TABLE ofertare_cerinte (id bigserial PRIMARY KEY, licitatie_id bigint, inlocuita_de bigint, confirmata_de uuid);
CREATE TABLE ofertare_acoperire (id bigserial PRIMARY KEY, cerinta_id bigint, status text, doc_firma_id bigint);
CREATE TABLE documente_firma (id bigserial PRIMARY KEY, utilizabil boolean, fara_expirare boolean,
  data_valabilitate date, se_reemite boolean);
`

function setup() {
  assert.ok(process.env.PGURI, 'Setează PGURI către o bază PostgreSQL 16 locală de test')
  const target = new URL(process.env.PGURI)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PGURI trebuie să fie URI PostgreSQL')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Sunt permise doar baze locale de test')
  assert.equal(target.search, '', 'Folosește PGURI fără query parameters (host/dbname nu pot fi suprascrise)')
  assert.equal(target.hash, '', 'PGURI nu poate conține fragment')
  const name = decodeURIComponent(target.pathname.slice(1))
  assert.match(name, /^r9b(?:_test_[a-z0-9_]+)?$/, 'Baza trebuie numită r9b sau r9b_test_<sufix>')
  uri = target.href
  const admin = new URL(uri)
  admin.pathname = '/postgres'
  const version = Number(runSql(admin.href, 'SHOW server_version_num;'))
  assert.equal(Math.floor(version / 10000), 16, `Este necesar PostgreSQL 16 real; server_version_num=${version}`)
  assert.equal(runSql(admin.href, "SELECT rolsuper FROM pg_roles WHERE rolname=current_user;"), 't',
    'Fixture-ul necesită un superuser SQL pe instanța locală de test')
  // Citim toate migrările înainte de DROP; textele sunt executate nemodificate.
  const migrations = [
    'R5_MIGRARE_PROPUSA_aprobare_istoric.sql', // prerequisite: istoric, helpers, triggerul înlocuit de 1b
    'R5_MIGRARE_1b_prag_exact.sql',
    'R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql',
  ].map(file => [file, readFileSync(new URL(`../../docs/${file}`, import.meta.url), 'utf8')])
  console.log(`SETUP PostgreSQL ${version}: recreare bază locală ${name}`)
  // Fără FORCE: nu închidem sesiunile altcuiva pentru a șterge baza.
  runSql(admin.href, `SET statement_timeout='10s';\nDROP DATABASE IF EXISTS "${name}";`)
  runSql(admin.href, `CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8';`)
  runSql(uri, fixtureSql)
  for (const [file, sql] of migrations) {
    runSql(uri, sql)
    console.log(`SETUP aplicat integral ${file}`)
  }
}

async function withSessions(test) {
  const observer = new Session('observer')
  const a = new Session('A_owner')
  const b = new Session('B_responsabil')
  try {
    await observer.init()
    await a.init(OWNER)
    await b.init(RESPONSABIL)
    assert.equal(new Set([a.pid, b.pid, observer.pid]).size, 3, 'Backenduri PostgreSQL distincte')
    assert.notEqual(a.child.pid, b.child.pid, 'Procese psql distincte')
    await test({ observer, a, b })
  } finally {
    // Întâi eliberăm A (deținătorul lock-ului), apoi B.
    for (const session of [a, b, observer]) await session.close()
  }
}

async function draft(observer) {
  const lic = ++nextFixture
  await observer.command(`INSERT INTO ofertare_licitatii(id,responsabil_id) VALUES (${lic},'${RESPONSABIL}');
    INSERT INTO seap_compl VALUES (${lic},NULL);
    INSERT INTO ofertare_cantitati(id,licitatie_id,denumire,categorie,um,cantitate,status,tip_sursa,sursa)
      VALUES (${lic},${lic},'Conductă PE100 Dn110','Conducte și montaj','m',100,'validat','lista_f3','F3 test');
    INSERT INTO ofertare_documente_atribuire(id,licitatie_id,nume_original,tip,status_procesare,analiza)
      VALUES (${lic},${lic},'Plansa test.pdf','plansa','finalizat','{"plansa":{"rezultat":"ilizibil","citibila":false}}');`)
  const generated = await observer.value(`ofertare_clarificare_planse_auto(${lic})`)
  assert.equal(generated.actiune, 'creat', JSON.stringify(generated))
  const d = { lic, id: generated.id, quantity: lic }
  const row = await state(observer, d)
  assert.equal(row.origine, 'automat')
  assert.match(row.cheie, /^auto_planse_/)
  assert.equal(row.stare, 'necesita_review')
  assert.match(row.amprenta_curenta, /^[0-9a-f]{32}$/)
  assert.equal((row.baza_generare.istoric_decizii || []).length, 0)
  return d
}

function state(session, d) {
  return session.value(`(SELECT to_jsonb(v) || jsonb_build_object('intrebare',c.intrebare,'origine',c.origine,
    'cheie',c.cheie,'baza_generare',c.baza_generare)
    FROM v_ofertare_clarificari_baza v JOIN ofertare_clarificari c USING(id) WHERE v.id=${d.id})`)
}

async function confirm(session, d, token, note) {
  const result = await session.value(`ofertare_clarificare_reconfirma(${d.id},${sqlText(token)},'revizuit',${sqlText(note)})`)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result
}

async function approved(observer, a, d) {
  const before = await state(a, d)
  await confirm(a, d, before.amprenta_curenta, 'Review inițial pentru probe')
  assert.equal((await state(observer, d)).stare, 'ok')
}

async function changeQuantity(session, d) {
  await session.command(`BEGIN;
    UPDATE ofertare_cantitati SET cantitate=cantitate+1 WHERE id=${d.quantity};
    COMMIT;`)
}

// Observăm lock-ul REAL în server. Polling-ul nu decide ordinea printr-o durată arbitrară.
async function waitBlocked(observer, b, a) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    const lock = await observer.value(`(SELECT jsonb_build_object('blocked',${a.pid}=ANY(pg_blocking_pids(pid)),
      'wait',wait_event_type,'state',state) FROM pg_stat_activity WHERE pid=${b.pid})`)
    if (lock?.blocked && lock.wait === 'Lock' && lock.state === 'active') return
    if (b.ended || !b.busy) throw new Error('B nu a așteptat lock-ul deținut de A')
    await delay(30)
  }
  throw new Error('Nu s-a demonstrat blocarea sesiunii B de către A')
}

// Atașăm imediat handlerul de eroare: B poate eșua înainte de COMMIT-ul lui A.
const pending = promise => promise.then(value => ({ value }), error => ({ error }))
async function completed(promise) {
  const result = await promise
  if (result.error) throw result.error
  return result.value
}

async function notifications(observer) {
  return observer.value("(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]'::jsonb) FROM notifications n)")
}

async function notifyCheck(observer, caller, d, expected, denied = false) {
  const before = await notifications(observer)
  const oldDraft = await state(observer, d)
  const result = await caller.value(`ofertare_clarificari_notifica(${d.lic})`)
  if (denied) assert.deepEqual(result, { error: 'fără acces' })
  else assert.deepEqual(result, { ok: true, notificari: expected })
  const after = await notifications(observer)
  assert.deepEqual(after.slice(0, before.length), before, 'Notificările existente rămân intacte')
  const added = after.slice(before.length)
  assert.equal(added.length, expected, 'Numărul real de rânduri noi în notifications')
  const currentDraft = await state(observer, d)
  assert.equal(currentDraft.intrebare, oldDraft.intrebare, 'Textul clarificării nu este modificat')
  assert.equal(currentDraft.status, oldDraft.status, 'Nu există transmitere automată')
  assert.ok(!['trimisa', 'raspunsa'].includes(currentDraft.status))
  for (const row of added) {
    assert.equal(row.profile_id, RESPONSABIL)
    assert.equal(row.link_to, '/ofertare')
    assert.equal(row.type, 'info')
    assert.equal(row.modul, 'Ofertare')
    assert.equal(row.title, 'Clarificare de reverificat')
    assert.equal(row.message, `Licitația #${d.lic}: baza s-a schimbat — de reverificat. Textul rămâne păstrat. Nimic trimis automat.`)
    assert.ok(!row.message.includes(oldDraft.intrebare), 'Notificarea nu copiază textul extern al clarificării')
    assert.equal(currentDraft.baza_generare.notificat_neactual, currentDraft.amprenta_curenta)
  }
  if (expected === 0) assert.deepEqual(currentDraft.baza_generare, oldDraft.baza_generare)
  return added
}

const tests = [
  ['2a — amprenta citită înainte de COMMIT-ul B este refuzată', async ({ observer, a, b }) => {
    const d = await draft(observer)
    const old = await state(a, d)
    await changeQuantity(b, d)
    assert.notEqual((await state(observer, d)).amprenta_curenta, old.amprenta_curenta)
    const result = await a.value(`ofertare_clarificare_reconfirma(${d.id},${sqlText(old.amprenta_curenta)},'revizuit','Review cu amprentă veche')`)
    assert.match(result.error || '', /s-au schimbat/)
    assert.notEqual(result.ok, true)
    const after = await state(observer, d)
    assert.equal(after.stare, 'schimbata')
    assert.deepEqual(after.baza_generare, old.baza_generare, 'Refuzul nu scrie nicio decizie')
  }],
  ['2b — schimbarea F3 comisă înainte de COMMIT A invalidează aprobarea și blochează exportul', async ({ observer, a, b }) => {
    const d = await draft(observer)
    const token = (await state(a, d)).amprenta_curenta
    await a.command('BEGIN;')
    await confirm(a, d, token, 'Review A înainte de schimbarea F3')
    await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id};`)
    const exportBefore = await a.value(`ofertare_clarificari_export(${d.lic})`)
    assert.ok(exportBefore.some(row => row.id === d.id), 'Exportul trebuie să funcționeze înainte de schimbare')
    // B trebuie să termine COMMIT cât A încă ține lock-ul; timeout = FAIL, nu inversăm ordinea.
    await changeQuantity(b, d)
    assert.equal(await observer.value(`(SELECT to_jsonb(cantitate) FROM ofertare_cantitati WHERE id=${d.quantity})`), 101)
    assert.equal(await observer.value(`(SELECT to_jsonb(state) FROM pg_stat_activity WHERE pid=${a.pid})`), 'idle in transaction')
    await a.command('COMMIT;')
    const after = await state(observer, d)
    assert.equal(after.status, 'de_trimis')
    assert.equal(after.stare, 'schimbata')
    await assert.rejects(() => a.value(`ofertare_clarificari_export(${d.lic})`), /Export blocat:.*baza s-a schimbat/s)
  }],
  ['2c — două reconfirmări concurente păstrează ambele decizii, fără deadlock', async ({ observer, a, b }) => {
    const d = await draft(observer)
    const token = (await state(a, d)).amprenta_curenta
    assert.equal((await state(b, d)).amprenta_curenta, token)
    await a.command('BEGIN;')
    await confirm(a, d, token, 'Decizia concurentă A owner')
    await b.command('BEGIN;')
    const second = pending(confirm(b, d, token, 'Decizia concurentă B responsabil'))
    await waitBlocked(observer, b, a)
    await a.command('COMMIT;')
    await completed(second)
    await b.command('COMMIT;')
    const after = await state(observer, d)
    assert.equal(after.stare, 'ok')
    const history = after.baza_generare.istoric_decizii
    assert.equal(history.length, 2)
    assert.deepEqual(history.map(x => [x.de, x.nota, x.token, x.decizie]), [
      [OWNER, 'Decizia concurentă A owner', token, 'revizuit'],
      [RESPONSABIL, 'Decizia concurentă B responsabil', token, 'revizuit'],
    ])
    assert.deepEqual(after.baza_generare.reconfirmare, history[1])
  }],
  ['2d — editarea așteaptă reconfirmarea și apoi retrage aprobarea textului', async ({ observer, a, b }) => {
    const d = await draft(observer)
    const before = await state(a, d)
    await a.command('BEGIN;')
    await confirm(a, d, before.amprenta_curenta, 'Review A înainte de editarea B')
    await a.command(`UPDATE ofertare_clarificari SET status='de_trimis' WHERE id=${d.id};`)
    await b.command('BEGIN;')
    const editing = pending(b.command(`UPDATE ofertare_clarificari
      SET intrebare=intrebare || ' Editare concurentă B.' WHERE id=${d.id};`))
    await waitBlocked(observer, b, a)
    await a.command('COMMIT;')
    await completed(editing)
    await b.command('COMMIT;')
    const after = await state(observer, d)
    assert.equal(after.intrebare, before.intrebare + ' Editare concurentă B.')
    assert.equal(after.status, 'propunere')
    assert.equal(after.stare, 'necesita_review')
    assert.equal(Object.hasOwn(after.baza_generare, 'reconfirmare'), false)
    assert.equal(after.baza_generare.text_editat_de, RESPONSABIL)
    assert.equal(after.baza_generare.istoric_decizii.length, 1)
    assert.equal(after.baza_generare.istoric_decizii[0].de, OWNER)
  }],
  ['3a — ciornă reconfirmată ok: zero notificări', async ({ observer, a }) => {
    const d = await draft(observer)
    await approved(observer, a, d)
    await notifyCheck(observer, a, d, 0)
  }],
  ['3b — bază schimbată: exact o notificare internă către responsabil', async ({ observer, a, b }) => {
    const d = await draft(observer)
    await approved(observer, a, d)
    const before = await notifications(observer)
    await changeQuantity(b, d)
    assert.equal((await state(observer, d)).stare, 'schimbata')
    assert.deepEqual(await notifications(observer), before, 'Scrierea F3 nu notifică singură')
    await notifyCheck(observer, a, d, 1)
  }],
  ['3c — al doilea apel pe aceeași bază: zero duplicate', async ({ observer, a, b }) => {
    const d = await draft(observer)
    await approved(observer, a, d)
    await changeQuantity(b, d)
    await notifyCheck(observer, a, d, 1)
    await notifyCheck(observer, a, d, 0)
  }],
  ['3d — încă o schimbare: încă exact o notificare', async ({ observer, a, b }) => {
    const d = await draft(observer)
    await approved(observer, a, d)
    await changeQuantity(b, d)
    const firstToken = (await state(observer, d)).amprenta_curenta
    const first = await notifyCheck(observer, a, d, 1)
    await changeQuantity(b, d)
    assert.notEqual((await state(observer, d)).amprenta_curenta, firstToken)
    const second = await notifyCheck(observer, a, d, 1)
    assert.notEqual(first[0].id, second[0].id)
  }],
  ['3e — fără acces Ofertare: eroarea exactă și zero notificări', async ({ observer, a, b }) => {
    const d = await draft(observer)
    await approved(observer, a, d)
    await changeQuantity(b, d)
    const denied = new Session('fara_acces')
    try {
      await denied.init(FARA_ACCES)
      assert.equal(await denied.value('to_jsonb(fn_are_acces_ofertare())'), false)
      await notifyCheck(observer, denied, d, 0, true)
      // Demonstrează că exista efectiv o notificare de emis, nu un caz deja deduplicat.
      await notifyCheck(observer, a, d, 1)
    } finally { await denied.close() }
  }],
  ['3f — ciornă retrasă cu bază schimbată: zero notificări', async ({ observer, a, b }) => {
    const d = await draft(observer)
    await approved(observer, a, d)
    await changeQuantity(b, d)
    assert.equal((await state(observer, d)).stare, 'schimbata')
    await a.command(`UPDATE ofertare_clarificari SET status='retrasa' WHERE id=${d.id};`)
    assert.equal((await state(observer, d)).status, 'retrasa')
    await notifyCheck(observer, a, d, 0)
  }],
]

try {
  setup()
  for (const [name, test] of tests) {
    try {
      await withSessions(test)
      passed++
      console.log(`PASS ${name}`)
    } catch (error) {
      failed++
      console.error(`FAIL ${name}\n  ${error.message}`)
    }
  }
} catch (error) {
  failed++
  console.error(`FAIL setup: ${error.message}`)
} finally {
  for (const session of [...sessions]) {
    try { await session.close() } catch (error) {
      failed++
      console.error(`FAIL cleanup: ${error.message}`)
    }
  }
}
console.log(`Rezultat: ${passed} PASS, ${failed} FAIL; ${tests.length} probe definite.`)
process.exitCode = failed ? 1 : 0
