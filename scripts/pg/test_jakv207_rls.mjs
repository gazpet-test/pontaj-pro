// JAK-V2-07: PostgreSQL 16 real, psql; fără dependențe npm.
// Rulare de către Claude: PGURI=postgresql://postgres@127.0.0.1:5432/jakv207_test_<sufix>
// Baza trebuie să existe și să fie goală. Tot fixture-ul, rolul temporar și migrările
// rulează într-o tranzacție încheiată cu ROLLBACK (inclusiv la eroare/conexiune închisă).
// Fixture minimal de RLS, nu replică întreaga schemă / toate triggerele producției.
// test_jakv201_tranzitie.mjs lipsește din checkout; tipar psql din test_r9b_probe23.mjs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const sqlText = value => "'" + String(value).replaceAll("'", "''") + "'"
const migration = readFileSync(new URL('../../supabase/migrations/20260928p_ofertare_rls_scriere_r_v2_07.sql', import.meta.url), 'utf8')
const rollback = readFileSync(new URL('../../supabase/migrations/20260928p_ofertare_rls_scriere_r_v2_07_ROLLBACK.sql', import.meta.url), 'utf8')
// Așteptări explicite din Anexa 1, independente de parsarea SQL-ului testat.
const policies = [
  ["ofertare_cantitati","cant_all","ALL","authenticated"],
  ["ofertare_clarificari","clar_all","ALL","authenticated"],
  ["ofertare_clarificari_coada","ofertare_clarificari_coada_all","ALL","authenticated"],
  ["ofertare_acoperire_coada","ofertare_acoperire_coada_all","ALL","authenticated"],
  ["ofertare_acoperire_istoric","istoric_scrie","ALL","authenticated"],
  ["ofertare_acoperire_revizii","revizii_scrie","ALL","authenticated"],
  ["ofertare_extragere_coada","ofertare_extragere_coada_all","ALL","authenticated"],
  ["ofertare_ingest_coada","ofertare_ingest_coada_all","ALL","authenticated"],
  ["ofertare_inventar_ai","ofertare_inventar_ai_upd","UPDATE","authenticated"],
  ["ofertare_triere","triere_mod","ALL","authenticated"],
  ["ofertare_verificari","ofertare_verificari_auth","ALL","authenticated"],
  ["ofertare_garantii","garantii_all","ALL","public"],
  ["ofertare_mailuri","mailuri_ins","INSERT","public"],
  ["ofertare_nas_inventar","nas_inv_ins","INSERT","authenticated"],
  ["ofertare_nas_inventar","nas_inv_upd","UPDATE","authenticated"],
  ["ofertare_nas_inventar","nas_inv_del","DELETE","authenticated"],
  ["ofertare_participari","ofertare_participari_auth","ALL","authenticated"],
  ["ofertare_pt_anexe_asteptate","pt_anexe_asteptate_rw","ALL","authenticated"],
  ["ofertare_pt_declaratii","pt_declaratii_rw","ALL","authenticated"],
  ["ofertare_pt_echipa","echipa_rw","ALL","authenticated"],
  ["ofertare_pt_echipa_roluri","roluri_rw","ALL","authenticated"],
  ["ofertare_pt_garantie","pt_garantie_auth","ALL","authenticated"],
  ["ofertare_pt_participanti","pt_participanti_auth","ALL","authenticated"],
  ["ofertare_solicitari_ac","solicitari_ac_rw","ALL","public"],
  ["ofertare_solicitari_ac_anexe","solicitari_ac_anexe_rw","ALL","public"],
  ["ofertare_solicitari_ac_puncte","solicitari_ac_puncte_rw","ALL","public"],
  ["grafic_activitati","grafic_act_ins","INSERT","authenticated"],
  ["grafic_activitati","grafic_act_upd","UPDATE","authenticated"],
  ["grafic_activitati","grafic_act_del","DELETE","authenticated"],
  ["grafic_parametri","grafic_param_ins","INSERT","public"],
  ["grafic_parametri","grafic_param_upd","UPDATE","public"],
  ["grafic_parametri","grafic_param_del","DELETE","public"],
  ["grafic_versiuni","grafic_ver_ins","INSERT","public"]
]
const tables = [...new Set(policies.map(([table]) => table))]
assert.equal(policies.length, 33)
assert.equal(tables.length, 27)

const ids = {
  fara: '00000000-0000-4000-8000-000000000099',
  ofertare: '00000000-0000-4000-8000-000000000007',
  financiar: '00000000-0000-4000-8000-000000000008',
  owner: '00000000-0000-4000-8000-000000000121',
}
const actor = 'jakv207_actor_' + process.pid
function asUser(user) {
  return `RESET ROLE; RESET SESSION AUTHORIZATION;
    SET SESSION AUTHORIZATION "${actor}";
    SET ROLE authenticated;
    SET request.jwt.claims = ${sqlText(JSON.stringify({ sub: ids[user], role: 'authenticated' }))};
    SELECT public.jakv207_assert(current_user = 'authenticated' AND session_user = '${actor}'
      AND auth.uid() = '${ids[user]}'::uuid, 'Identitatea simulată trebuie să fie cea PostgREST');`
}
const asAdmin = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims = '{}';`
function changed(sql, count, label) {
  return `WITH changed AS (${sql} RETURNING id)
    SELECT public.jakv207_assert(count(*) = ${count}, ${sqlText(label)}) FROM changed;`
}
function rejected(sql, state = '42501', message = null) {
  return `DO $test$
    DECLARE refused boolean := false;
    BEGIN
      BEGIN
        EXECUTE ${sqlText(sql)};
      EXCEPTION WHEN SQLSTATE '${state}' THEN
        ${message ? `IF SQLERRM <> ${sqlText(message)} THEN RAISE; END IF;` : ''}
        refused := true;
      END;
      PERFORM public.jakv207_assert(refused, ${sqlText('Trebuia refuzat: ' + sql)});
    END $test$;`
}
const financeMessage = 'Modulul financiar poate modifica doar contract_id pe o licitație'
const policySnapshot = `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies WHERE schemaname = 'public'`
const aclSnapshot = `SELECT c.oid, c.relacl, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'`
const equalSnapshots = (left, right, label) => `SELECT public.jakv207_assert(NOT EXISTS (
  (${left} EXCEPT ${right}) UNION ALL (${right} EXCEPT ${left})
), ${sqlText(label)});`

const baselinePolicies = policies.map(([table, name, cmd, role]) => `
  CREATE POLICY ${name} ON public.${table} FOR ${cmd} TO ${role}
  ${cmd !== 'INSERT' ? 'USING (auth.uid() IS NOT NULL)' : ''}
  ${cmd !== 'DELETE' ? 'WITH CHECK (auth.uid() IS NOT NULL)' : ''};`).join('\n')
const tableFixtures = tables.filter(t => t !== 'ofertare_cantitati').map(table => `
  CREATE TABLE public.${table} (id bigint PRIMARY KEY,
    licitatie_id bigint REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE);
`).join('\n')
// SELECT separat numai unde fixture-ul are nevoie de el; triere_sel există în migrarea originală.
const readPolicies = [
  ['ofertare_triere', 'triere_sel'],
  ...tables.filter(t => !policies.some(([table, , cmd]) => table === t && cmd === 'ALL'))
    .map(t => [t, 'jakv207_fixture_select']),
].map(([table, name]) => `CREATE POLICY ${name} ON public.${table}
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);`).join('\n')

const setup = `
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';
DO $setup$ BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 16 THEN
    RAISE EXCEPTION 'Este necesar PostgreSQL 16 real';
  END IF;
  IF session_user <> 'postgres' OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Fixture-ul cere login postgres pe instanța locală de test';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    RAISE EXCEPTION 'Baza de test trebuie să fie goală; niciun obiect existent nu va fi șters';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('authenticated','anon') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Rolurile API nu trebuie să aibă SUPERUSER / BYPASSRLS';
  END IF;
END $setup$;
CREATE ROLE "${actor}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT authenticated, anon TO "${actor}";
DO $sr$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $sr$;
GRANT service_role TO "${actor}";
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
GRANT USAGE ON SCHEMA auth, public TO service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$fn$;
CREATE FUNCTION public.jakv207_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST: %', message; END IF;
END $fn$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid REFERENCES public.profiles(id),
  module text NOT NULL, PRIMARY KEY (profile_id, module));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_profiles_select ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid());
CREATE POLICY fixture_access_select ON public.user_module_access FOR SELECT TO authenticated USING (profile_id=auth.uid());
GRANT SELECT ON public.profiles, public.user_module_access TO authenticated;
INSERT INTO public.profiles VALUES
  ('${ids.fara}', false), ('${ids.ofertare}', false), ('${ids.financiar}', false), ('${ids.owner}', true);
INSERT INTO public.user_module_access VALUES
  ('${ids.fara}', 'logistica'), ('${ids.ofertare}', 'ofertare'), ('${ids.financiar}', 'financiar');
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id=auth.uid() AND u.module='ofertare'))
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated;
CREATE TABLE public.jakv207_contracte (id bigint PRIMARY KEY);
INSERT INTO public.jakv207_contracte VALUES (10);
CREATE TABLE public.ofertare_licitatii (
  id bigint PRIMARY KEY, status text NOT NULL DEFAULT 'in_lucru',
  contract_id bigint REFERENCES public.jakv207_contracte(id),
  updated_at timestamptz DEFAULT now(), responsabil_id uuid REFERENCES public.profiles(id),
  decizie_go text, termen_depunere timestamptz, c_notice_id text);
ALTER TABLE public.ofertare_licitatii ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_licitatii_all ON public.ofertare_licitatii
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.ofertare_cantitati (
  id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  denumire text NOT NULL, cantitate numeric,
  status text NOT NULL DEFAULT 'extras' CHECK (status IN ('extras','validat','diferenta','revizuit_clarificare')),
  tip_sursa text CHECK (tip_sursa IN ('lista_f3','lista_c6','lista_alt','memoriu','plansa','caiet','alt')));
${tableFixtures}
${tables.map(t => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`).join('\n')}
${baselinePolicies}
${readPolicies}
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_licitatii,
  ${tables.map(t => 'public.' + t).join(', ')} TO authenticated;
GRANT SELECT, UPDATE ON public.ofertare_licitatii TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO service_role;
-- Sentinela cross-modul: nicio schimbare permisă asupra ei.
CREATE TABLE public.ofertare_brokeri (id bigint PRIMARY KEY);
ALTER TABLE public.ofertare_brokeri ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_brokeri_all ON public.ofertare_brokeri FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);
INSERT INTO public.ofertare_licitatii(id) VALUES (1), (2);
INSERT INTO public.ofertare_cantitati(id,licitatie_id,denumire,cantitate,tip_sursa)
  VALUES (1,1,'Conductă PEHD',100,'lista_f3');
CREATE TEMP TABLE before_policies AS ${policySnapshot};
CREATE TEMP TABLE before_acl AS ${aclSnapshot};
-- Proba de regresie: politica veche permite ștergerea și cascada fără modul.
SAVEPOINT weak_policy;
${asUser('fara')}
${changed('DELETE FROM public.ofertare_licitatii WHERE id=1', 1, 'Politica weak permitea DELETE')}
${asAdmin}
SELECT public.jakv207_assert(NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati WHERE id=1), 'Cascada veche');
ROLLBACK TO SAVEPOINT weak_policy;
RELEASE SAVEPOINT weak_policy;
${asAdmin}
`

const checks = `
${asUser('fara')}
SELECT public.jakv207_assert(NOT public.fn_are_acces_ofertare(), 'Fără Ofertare');
SELECT public.jakv207_assert((SELECT count(*) FROM public.ofertare_licitatii)=2, 'SELECT cross-modul păstrat');
${changed("UPDATE public.ofertare_licitatii SET status='depusa' WHERE id=1", 0, 'Fără modul: UPDATE zero')}
${changed('DELETE FROM public.ofertare_licitatii WHERE id=1', 0, 'Fără modul: DELETE zero')}
${rejected('INSERT INTO public.ofertare_licitatii(id) VALUES (3)')}
${rejected("INSERT INTO public.ofertare_cantitati(id,licitatie_id,denumire) VALUES (2,1,'Refuzat')")}
${changed('UPDATE public.ofertare_cantitati SET cantitate=200 WHERE id=1', 0, 'Fără modul: cantități UPDATE zero')}
${changed('DELETE FROM public.ofertare_cantitati WHERE id=1', 0, 'Fără modul: cantități DELETE zero')}

${asUser('financiar')}
${changed("UPDATE public.ofertare_licitatii SET contract_id=10, updated_at='2026-09-28T12:00:00Z' WHERE id=1", 1, 'Financiar poate lega contractul')}
SELECT public.jakv207_assert((SELECT contract_id=10 FROM public.ofertare_licitatii WHERE id=1), 'Contract salvat');
${[
  "status='depusa'", `responsabil_id='${ids.financiar}'`, "decizie_go='go'",
  "termen_depunere='2026-12-01T12:00:00Z'", "c_notice_id='CN123'",
  "id=99", "contract_id=NULL, status='depusa'",
].map(set => rejected(`UPDATE public.ofertare_licitatii SET ${set} WHERE id=1`, 'P0001', financeMessage)).join('\n')}
SELECT public.jakv207_assert((SELECT status='in_lucru' AND contract_id=10
  FROM public.ofertare_licitatii WHERE id=1), 'Refuzurile nu au modificat rândul');
${changed('UPDATE public.ofertare_licitatii SET contract_id=NULL WHERE id=1', 1, 'Financiar poate dezlega contractul')}
${changed('UPDATE public.ofertare_licitatii SET updated_at=now() WHERE id=1', 1, 'Financiar poate actualiza updated_at')}
${changed('DELETE FROM public.ofertare_licitatii WHERE id=1', 0, 'Financiar nu poate șterge')}
${rejected('INSERT INTO public.ofertare_licitatii(id) VALUES (3)')}
${rejected("INSERT INTO public.ofertare_cantitati(id,licitatie_id,denumire) VALUES (2,1,'Refuzat')")}

${asUser('ofertare')}
${changed("UPDATE public.ofertare_licitatii SET status='go' WHERE id=1", 1, 'Ofertare poate UPDATE')}
${changed('INSERT INTO public.ofertare_licitatii(id) VALUES (3)', 1, 'Ofertare poate INSERT')}
${changed('DELETE FROM public.ofertare_licitatii WHERE id=1', 0, 'Ofertare fără owner nu poate DELETE')}
${changed("INSERT INTO public.ofertare_cantitati(id,licitatie_id,denumire) VALUES (2,1,'Permis')", 1, 'Ofertare: cantități INSERT')}
${changed('UPDATE public.ofertare_cantitati SET cantitate=250 WHERE id=2', 1, 'Ofertare: cantități UPDATE')}
${changed('DELETE FROM public.ofertare_cantitati WHERE id=2', 1, 'Ofertare: cantități DELETE')}

${asUser('owner')}
${changed("UPDATE public.ofertare_licitatii SET status='analiza' WHERE id=1", 1, 'Owner fără intrare modul poate UPDATE')}
${changed('DELETE FROM public.ofertare_licitatii WHERE id=1', 1, 'Owner poate DELETE')}
SELECT public.jakv207_assert(NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati WHERE id=1), 'DELETE owner cascadează');

${asAdmin}
SELECT public.jakv207_assert(NOT public.fn_are_acces_ofertare(), 'Admin fără JWT');
${changed("UPDATE public.ofertare_licitatii SET status='go' WHERE id=2", 1, 'Excepția session_user postgres')}
-- service_role (edge ofertare-seap-veghe / seap-import): session_user != postgres, fără uid, BYPASSRLS.
RESET ROLE; RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION "${actor}";
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';
SELECT public.jakv207_assert(session_user = '${actor}' AND current_user = 'service_role' AND auth.uid() IS NULL, 'Identitate service_role simulată');
${changed("UPDATE public.ofertare_licitatii SET termen_depunere='2026-12-24T12:00:00Z' WHERE id=2", 1, 'service_role poate scrie termen_depunere (seap-veghe)')}
${asAdmin}
SELECT public.jakv207_assert(NOT has_function_privilege('anon',
  'public.fn_ofertare_licitatii_scriere()', 'EXECUTE'), 'Triggerul nu este apelabil de anon');
SELECT public.jakv207_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
  FROM pg_proc WHERE oid='public.fn_ofertare_licitatii_scriere()'::regprocedure), 'SECURITY DEFINER și search_path');
`

const expectedValues = policies.map(([table,name,cmd]) => `(${sqlText(table)},${sqlText(name)},${sqlText(cmd)})`).join(',\n')
const catalogChecks = `
SELECT public.jakv207_assert((SELECT count(*) FROM pg_policies
  WHERE schemaname='public' AND tablename='ofertare_licitatii')=4, 'Exact 4 politici pe licitații');
WITH expected(tablename, policyname, cmd) AS (VALUES ${expectedValues})
SELECT public.jakv207_assert(count(*)=33 AND bool_and(coalesce(
  p.cmd=e.cmd AND p.roles=ARRAY['authenticated']::name[] AND p.permissive='PERMISSIVE'
  AND CASE WHEN e.cmd='INSERT' THEN p.qual IS NULL
    ELSE p.qual LIKE '%fn_are_acces_ofertare()%' AND p.qual NOT LIKE '%auth.uid()%' END
  AND CASE WHEN e.cmd='DELETE' THEN p.with_check IS NULL
    ELSE p.with_check LIKE '%fn_are_acces_ofertare()%' AND p.with_check NOT LIKE '%auth.uid()%' END
, false)), 'Toate cele 33 politici au cmd/rol/poartă corecte')
FROM expected e JOIN pg_policies p USING (tablename, policyname) WHERE p.schemaname='public';
${equalSnapshots("SELECT * FROM before_policies WHERE cmd='SELECT'",
  policySnapshot + " AND cmd='SELECT' AND tablename <> 'ofertare_licitatii'", 'SELECT existente intacte')}
${equalSnapshots("SELECT * FROM before_policies WHERE tablename='ofertare_brokeri'",
  policySnapshot + " AND tablename='ofertare_brokeri'", 'Tabel exclus intact')}
${equalSnapshots('SELECT * FROM before_acl', aclSnapshot, 'Granturi și activare RLS intacte')}
`

try {
  assert.ok(process.env.PGURI, 'Setează PGURI către o bază PostgreSQL 16 locală, goală, jakv207_test_<sufix>')
  let target
  try { target = new URL(process.env.PGURI) } catch { throw new Error('PGURI invalid (valoarea nu este afișată)') }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'Protocol PostgreSQL obligatoriu')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar instanțe locale')
  assert.equal(target.search, '', 'PGURI fără query parameters')
  assert.equal(target.hash, '', 'PGURI fără fragment')
  assert.match(decodeURIComponent(target.pathname.slice(1)), /^jakv207_test_[a-z0-9_]+$/, 'Bază dedicată obligatorie')
  assert.equal(decodeURIComponent(target.username), 'postgres', 'Login postgres necesar fixture-ului')
  const sql = setup + '\n' + migration + '\n' + migration + '\n' + catalogChecks + '\n' + checks
    + '\n' + asAdmin + '\n' + rollback + '\n' + rollback + '\n'
    + equalSnapshots('SELECT * FROM before_policies', policySnapshot, 'Rollback restaurează politicile și rolurile inițiale')
    + equalSnapshots('SELECT * FROM before_acl', aclSnapshot, 'Rollback păstrează granturile')
    + `SELECT public.jakv207_assert(to_regprocedure('public.fn_ofertare_licitatii_scriere()') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a00_ofertare_licitatii_scriere'), 'Trigger și funcție eliminate');\n`
    + migration + '\n' + catalogChecks + '\nROLLBACK;\n'
    + "SELECT 'PASS JAK-V2-07: RLS, trigger Financiar, owner DELETE, cascade, catalog, rerulare și rollback';\n"
  const output = execFileSync('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '--dbname', target.href, '--file', '-'], {
    input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  assert.match(output, /PASS JAK-V2-07:/)
  console.log(output.trim())
} catch (error) {
  // Nu afișăm obiectul erorii child_process: conține argumentele, inclusiv PGURI.
  const detail = error.code === 'ENOENT' ? 'psql indisponibil în PATH'
    : error.stderr ? String(error.stderr).trim()
      : error.code === 'ERR_ASSERTION' ? error.message
        : error.code ? String(error.code) : error.message
  console.error('FAIL JAK-V2-07: ' + detail.replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  process.exitCode = 1
}
