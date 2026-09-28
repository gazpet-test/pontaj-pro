// JAK-V2-03: poarta depusa, PostgreSQL 16 real; fără dependențe npm.
// PGURI=postgres://postgres@localhost:5432/jakv203_test_<sufix> node scripts/pg/test_jakv203_gate_depusa.mjs
// Baza dedicată trebuie să existe și să fie goală. Fixture-ul și rolurile temporare
// sunt tranzacționale; ROLLBACK la final / la închiderea conexiunii în caz de eroare.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const readMigration = name => readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const migration = readMigration('20260929a_gate_depunere_pachet_jakv203.sql')
const rollback = readMigration('20260929a_gate_depunere_pachet_jakv203_ROLLBACK.sql')
const r07 = readMigration('20260928f_gate_depunere_r07.sql')
const copilot = readMigration('20260928m_r07_r12_copilot.sql')
// Aplicăm SQL-ul istoric real, nu o copie a funcției din rollback-ul testat.
// Din m extragem numai helperul și patch-ul porții, fără politicile Storage.
const start = copilot.indexOf('CREATE OR REPLACE FUNCTION public.fn_gate_depunere_derogare_owner()')
const end = copilot.indexOf('END $mig$;', start)
assert.ok(start >= 0 && end > start, 'Patch-ul istoric R07 trebuie să existe')
const baseline = r07 + '\n' + copilot.slice(start, end + 'END $mig$;'.length)
  + '\n' + readMigration('20260928n_gate_depunere_r06.sql')

const EDITOR = '00000000-0000-4000-8000-000000000007'
const OWNER = '00000000-0000-4000-8000-000000000121'
const actor = 'jakv203_actor_' + process.pid
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const admin = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims = '{}';`
const asUser = (uid = EDITOR) => `${admin}
  SET SESSION AUTHORIZATION "${actor}";
  SET ROLE authenticated;
  SET request.jwt.claims = ${quote(JSON.stringify({ sub: uid, role: 'authenticated' }))};
  SELECT public.jakv203_assert(session_user = '${actor}' AND current_user = 'authenticated'
    AND auth.uid() IS NOT DISTINCT FROM ${uid ? quote(uid) + '::uuid' : 'NULL::uuid'}, 'Identitate API reală, fără excepția session_user=postgres');`
const check = (expr, label) => `SELECT public.jakv203_assert((${expr}), ${quote(label)});`
const rejected = (sql, state, fragment) => `DO $test$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    EXECUTE ${quote(sql)};
  EXCEPTION WHEN SQLSTATE '${state}' THEN
    IF position(${quote(fragment)} in SQLERRM) = 0 THEN RAISE; END IF;
    refused := true;
  END;
  PERFORM public.jakv203_assert(refused, ${quote('Trebuia refuzat: ' + sql)});
END $test$;`
const submit = id => `UPDATE public.ofertare_licitatii SET status='depusa' WHERE id=${id}`
const blocked = (id, fragment) => rejected(submit(id), 'P0001', fragment)
const status = (id, expected = 'depusa') => check(`(SELECT status FROM public.ofertare_licitatii WHERE id=${id})=${quote(expected)}`, `Status ${id}: ${expected}`)

const setup = `BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL client_min_messages = notice;
DO $guard$ BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 16 THEN
    RAISE EXCEPTION 'Este necesar PostgreSQL 16 real';
  END IF;
  IF current_database() !~ '^jakv203_test_[a-z0-9_]+$' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Doar baza dedicată jakv203_test_* și login postgres';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    RAISE EXCEPTION 'Baza trebuie să fie goală; niciun obiect existent nu va fi șters';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $guard$;
CREATE ROLE "${actor}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT authenticated TO "${actor}";
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated;
CREATE FUNCTION public.jakv203_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAIL: %', message; END IF; END $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
INSERT INTO public.profiles VALUES ('${EDITOR}',false),('${OWNER}',true);
CREATE TABLE public.ofertare_licitatii (
  id bigint PRIMARY KEY, status text NOT NULL DEFAULT 'in_lucru',
  derogare_depunere boolean DEFAULT false, termen_depunere timestamptz);
CREATE TABLE public.ofertare_cerinte (
  id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  inlocuita_de bigint REFERENCES public.ofertare_cerinte(id), duplicat_al bigint REFERENCES public.ofertare_cerinte(id),
  confirmata_de uuid REFERENCES public.profiles(id));
CREATE TABLE public.documente_firma (
  id bigint PRIMARY KEY, utilizabil boolean NOT NULL DEFAULT true,
  fara_expirare boolean NOT NULL DEFAULT false, data_valabilitate date, se_reemite boolean NOT NULL DEFAULT false);
CREATE TABLE public.ofertare_acoperire (
  id bigint PRIMARY KEY, cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id),
  doc_firma_id bigint REFERENCES public.documente_firma(id),
  status text NOT NULL CHECK (status IN ('acoperit','acoperit_partener','nu_se_aplica','partial','lipsa')),
  verificat_pe_scan boolean DEFAULT false, reverificare_ceruta boolean DEFAULT false);
CREATE TABLE public.ofertare_pt_pachet (
  id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  versiune integer NOT NULL CHECK (versiune >= 1),
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus','aprobat','depus')),
  aprobat_de uuid REFERENCES public.profiles(id), aprobat_la timestamptz, depus_la timestamptz,
  UNIQUE (licitatie_id, versiune),
  CHECK ((stare='propus') OR (stare='aprobat' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)
    OR (stare='depus' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL AND depus_la IS NOT NULL)));
CREATE FUNCTION public.ofertare_r5_blocaj_sursa(bigint) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
GRANT SELECT, INSERT, UPDATE ON public.ofertare_licitatii TO authenticated;
${baseline}
-- ACL de producție: triggerul se execută fără EXECUTE direct pentru authenticated.
REVOKE EXECUTE ON FUNCTION public.fn_gate_depunere() FROM PUBLIC;
CREATE TRIGGER trg_gate_depunere BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere();
CREATE TEMP TABLE before_gate AS SELECT pg_get_functiondef('public.fn_gate_depunere()'::regprocedure) AS definition,
  proacl, prosecdef, proconfig FROM pg_proc WHERE oid='public.fn_gate_depunere()'::regprocedure;
CREATE TEMP TABLE before_trigger AS SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
  WHERE tgrelid='public.ofertare_licitatii'::regclass AND tgname='trg_gate_depunere';
CREATE TEMP TABLE before_helper AS SELECT pg_get_functiondef(oid) AS definition, proacl FROM pg_proc
  WHERE oid='public.fn_gate_depunere_derogare_owner()'::regprocedure;
`

// Faza A reproduce separat ambele ocoliri pe funcția istorică f → m → n.
const preFix = `SAVEPOINT phase_a;
${asUser()}
INSERT INTO public.ofertare_licitatii(id) VALUES (1);
${submit(1)};
${status(1)}
INSERT INTO public.ofertare_licitatii(id,status) VALUES (2,'depusa');
${status(2)}
${admin}
ROLLBACK TO SAVEPOINT phase_a;
SELECT 'FAZA_A_BYPASS_CONFIRMAT';`

// Pachetele sunt fixture-uri în stările existente; aici nu testăm triggerul lor de tranziții.
const matrix = `SAVEPOINT matrix;
${admin}
INSERT INTO public.ofertare_licitatii(id,termen_depunere) SELECT i, CURRENT_DATE FROM generate_series(10,29) i;
INSERT INTO public.ofertare_pt_pachet(id,licitatie_id,versiune,stare,aprobat_de,aprobat_la,depus_la)
  SELECT i,i,1,CASE WHEN i=11 THEN 'aprobat' ELSE 'depus' END,'${OWNER}',now(),
    CASE WHEN i=11 THEN NULL ELSE now() END
  FROM generate_series(11,26) i WHERE i NOT IN (14,15);
-- 12 și 26 au zero cerințe. 17 are doar cerințe înlocuite/duplicate.
INSERT INTO public.ofertare_cerinte(id,licitatie_id,confirmata_de)
  SELECT i,i,CASE WHEN i=16 THEN NULL::uuid ELSE '${EDITOR}'::uuid END
  FROM generate_series(10,25) i WHERE i NOT IN (12,14,15,17);
INSERT INTO public.ofertare_cerinte(id,licitatie_id,inlocuita_de,duplicat_al)
  VALUES (170,17,171,NULL),(171,17,NULL,170);
INSERT INTO public.documente_firma(id,utilizabil,fara_expirare,data_valabilitate,se_reemite) VALUES
  (20,false,true,NULL,false),(21,true,false,CURRENT_DATE+89,false),
  (22,true,false,CURRENT_DATE+90,false),(23,true,false,CURRENT_DATE,true),
  (24,true,false,CURRENT_DATE-1,true);
INSERT INTO public.ofertare_acoperire(id,cerinta_id,doc_firma_id,status,verificat_pe_scan,reverificare_ceruta)
  SELECT id,id,CASE WHEN id BETWEEN 20 AND 24 THEN id ELSE NULL END,
    CASE WHEN id=25 THEN 'nu_se_aplica' ELSE 'acoperit' END, id NOT IN (18,25), id=19
  FROM public.ofertare_cerinte WHERE id BETWEEN 10 AND 25;
${asUser()}
${blocked(10, 'lipseste pachetul PT in stare depus')}
${blocked(11, 'lipseste pachetul PT in stare depus')}
${blocked(12, '0 cerinte extrase')}
${submit(13)};
${status(13)}
${rejected("UPDATE public.ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=14", '42501', 'doar ownerul')}
${rejected("INSERT INTO public.ofertare_licitatii(id,status,derogare_depunere) VALUES (30,'depusa',true)", '42501', 'doar ownerul')}
${rejected("INSERT INTO public.ofertare_licitatii(id,status) VALUES (31,'depusa')", 'P0001', 'lipseste pachetul PT in stare depus')}
${blocked(16, '1 cerințe neconfirmate de om')}
${blocked(17, '0 cerinte extrase')}
${blocked(18, '1 cerințe fără acoperire VERIFICATĂ')}
${blocked(19, '1 dovezi cu reverificare cerută')}
${blocked(20, '1 dovezi roșii')}
${blocked(21, '1 dovezi roșii')}
${blocked(24, '1 dovezi roșii')}
${submit(22)};
${status(22)}
${submit(23)};
${status(23)}
${submit(25)};
${status(25)}
-- Nu se blochează editările fără tranziție; nici INSERT obișnuit fără pachet.
INSERT INTO public.ofertare_licitatii(id) VALUES (32);
${status(32, 'in_lucru')}
UPDATE public.ofertare_licitatii SET termen_depunere=CURRENT_DATE+1 WHERE id=13;
${status(13)}
${asUser(null)}
${rejected("UPDATE public.ofertare_licitatii SET derogare_depunere=true WHERE id=14", '42501', 'doar ownerul')}
${asUser(OWNER)}
-- Ownerul fără flag nu ocolește poarta. Flag-ul autorizat acoperă ambele condiții noi.
${blocked(15, 'lipseste pachetul PT in stare depus')}
UPDATE public.ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=15;
${status(15)}
UPDATE public.ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=26;
${status(26)}
INSERT INTO public.ofertare_licitatii(id,status,derogare_depunere) VALUES (33,'depusa',true);
${status(33)}
UPDATE public.ofertare_licitatii SET termen_depunere=CURRENT_DATE+1 WHERE id=33;
${status(33)}
${admin}
-- Regresie R5: un blocaj rămâne activ inclusiv cu derogare. Stub schimbat doar în fixture.
SAVEPOINT r5;
CREATE OR REPLACE FUNCTION public.ofertare_r5_blocaj_sursa(bigint) RETURNS text LANGUAGE sql AS $$ SELECT ': R5 TEST'::text $$;
${asUser()}
UPDATE public.ofertare_licitatii SET status='in_lucru' WHERE id=13;
${blocked(13, 'R5 TEST')}
${asUser(OWNER)}
${rejected("UPDATE public.ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=27", 'P0001', 'R5 TEST')}
${rejected("INSERT INTO public.ofertare_licitatii(id,status,derogare_depunere) VALUES (34,'depusa',true)", 'P0001', 'R5 TEST')}
${admin}
ROLLBACK TO SAVEPOINT r5;
${asUser()}
${status(10, 'in_lucru')}
${status(11, 'in_lucru')}
${status(12, 'in_lucru')}
${status(14, 'in_lucru')}
${check('NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id IN (30,31,34))', 'INSERT refuzat nu lasă rânduri')}
${admin}
ROLLBACK TO SAVEPOINT matrix;
SELECT 'FAZA_B_OK';`

const securityChecks = check(`(SELECT p.proacl IS NOT DISTINCT FROM b.proacl AND p.prosecdef=b.prosecdef
  AND p.proconfig=b.proconfig FROM pg_proc p CROSS JOIN before_gate b
  WHERE p.oid='public.fn_gate_depunere()'::regprocedure)`, 'ACL, SECURITY DEFINER și search_path păstrate')
  + check(`(SELECT pg_get_functiondef(p.oid)=b.definition AND p.proacl IS NOT DISTINCT FROM b.proacl
  FROM pg_proc p CROSS JOIN before_helper b WHERE p.oid='public.fn_gate_depunere_derogare_owner()'::regprocedure)`, 'Helperul owner nemodificat')
const triggerCheck = check(`(SELECT count(*)=1 AND bool_and(tgtype=23 AND tgenabled='O'
  AND tgfoid='public.fn_gate_depunere()'::regprocedure) FROM pg_trigger
  WHERE tgrelid='public.ofertare_licitatii'::regclass AND tgname='trg_gate_depunere')`, 'Un trigger ROW BEFORE INSERT OR UPDATE activ')
const rollbackChecks = check(`(SELECT pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)=definition FROM before_gate)`, 'Rollback: definiția funcției exactă f+m+n')
  + check(`(SELECT pg_get_triggerdef(t.oid)=b.definition FROM pg_trigger t CROSS JOIN before_trigger b
  WHERE t.tgrelid='public.ofertare_licitatii'::regclass AND t.tgname='trg_gate_depunere')`, 'Rollback: triggerul exact BEFORE UPDATE')
  + securityChecks

try {
  assert.ok(process.env.PGURI, 'Setează PGURI către o bază PostgreSQL 16 locală, goală, jakv203_test_<sufix>')
  let target
  try { target = new URL(process.env.PGURI) } catch { throw new Error('PGURI invalid (valoarea nu este afișată)') }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'Protocol PostgreSQL obligatoriu')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar instanțe locale')
  assert.equal(target.search, '', 'PGURI fără query parameters')
  assert.equal(target.hash, '', 'PGURI fără fragment')
  assert.match(decodeURIComponent(target.pathname.slice(1)), /^jakv203_test_[a-z0-9_]+$/, 'Bază dedicată obligatorie')
  assert.equal(decodeURIComponent(target.username), 'postgres', 'Login postgres necesar fixture-ului')
  const sql = setup + '\n' + preFix + '\n' + migration + '\n' + securityChecks + triggerCheck + '\n'
    + `CREATE TEMP TABLE after_gate AS SELECT pg_get_functiondef('public.fn_gate_depunere()'::regprocedure) AS definition;\n`
    + migration + '\n' + check(`(SELECT pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)=definition FROM after_gate)`, 'Rerulare idempotentă')
    + securityChecks + triggerCheck + '\n' + matrix + '\n' + rollback + '\n' + rollbackChecks
    + '\n' + rollback + '\n' + rollbackChecks + '\n' + preFix
    + '\n' + migration + '\n' + securityChecks + triggerCheck + '\n' + matrix
    + "\nROLLBACK;\nSELECT 'PASS JAK-V2-03';\n"
  const result = spawnSync('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '--dbname', target.href, '--file', '-'], {
    input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' },
    windowsHide: true,
  })
  if (result.error) throw new Error(result.error.code === 'ENOENT' ? 'psql indisponibil în PATH' : 'Eșec lansare psql: ' + result.error.code)
  if (result.status !== 0) throw new Error(String(result.stderr || 'psql eșuat').trim())
  assert.equal((result.stdout.match(/FAZA_A_BYPASS_CONFIRMAT/g) || []).length, 2)
  assert.equal((result.stdout.match(/FAZA_B_OK/g) || []).length, 2)
  assert.match(result.stdout, /PASS JAK-V2-03/)
  // Trei depuneri cu derogare / matrice; nicio notificare la simpla editare sau refuz R5.
  const notices = (result.stderr || '').split('\n').filter(line => line.includes('NOTICE:') && line.includes('DEROGARE LA DEPUNERE:'))
  assert.equal(notices.length, 6, 'Audit NOTICE exact pentru depunerile cu derogare reușite')
  for (const id of [15,26,33]) {
    assert.equal(notices.filter(line => line.includes(`licitatie_id=${id}, auth.uid=${OWNER}, session_user=${actor},`)
      && line.includes(`operatie=${id === 33 ? 'INSERT' : 'UPDATE'}, derogare_depunere=true`)).length, 2)
  }
  console.log('PASS JAK-V2-03: bypass pre-fix, refuzuri/PASS post-fix, derogare/NOTICE, regresii R06/R07/R5, rollback exact și rerulare.')
} catch (error) {
  // Nu afișăm obiectul child_process / URI-ul conexiunii.
  console.error('FAIL JAK-V2-03: ' + String(error.message).replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  process.exitCode = 1
}
