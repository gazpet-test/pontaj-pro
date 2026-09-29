// JAK-V2-05: audit append-only al derogării, PostgreSQL 16 real; fără dependențe npm.
// PGURI=postgres://postgres@localhost:5432/jakv205_test_<sufix> node scripts/pg/test_jakv205_derogare_audit.mjs
// Baza dedicată trebuie să existe și să fie goală. Fixture-ul și rolurile temporare
// sunt tranzacționale; ROLLBACK la final / la închiderea conexiunii în caz de eroare.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const readMigration = name => readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const migration = readMigration('20260929b_ofertare_derogare_audit.sql')
const rollback = readMigration('20260929b_ofertare_derogare_audit_ROLLBACK.sql')
const r07 = readMigration('20260928f_gate_depunere_r07.sql')
const copilot = readMigration('20260928m_r07_r12_copilot.sql')
// Aplicăm SQL-ul istoric real, nu o copie a funcției din rollback-ul testat.
// Din m extragem numai helperul și patch-ul porții, fără politicile Storage.
const start = copilot.indexOf('CREATE OR REPLACE FUNCTION public.fn_gate_depunere_derogare_owner()')
const end = copilot.indexOf('END $mig$;', start)
assert.ok(start >= 0 && end > start, 'Patch-ul istoric R07 trebuie să existe')
const baseline = r07 + '\n' + copilot.slice(start, end + 'END $mig$;'.length)
  + '\n' + readMigration('20260928n_gate_depunere_r06.sql')

const gateV203 = readMigration('20260929a_gate_depunere_pachet_jakv203.sql')
const accessMigration = readMigration('20260912_ofertare_acces_fara_parametru.sql')
const accessHelper = accessMigration.slice(0, accessMigration.indexOf('ALTER POLICY'))
const DENIED = '00000000-0000-4000-8000-000000000099'
const EDITOR = '00000000-0000-4000-8000-000000000007'
const OWNER = '00000000-0000-4000-8000-000000000121'
const actor = 'jakv205_actor_' + process.pid
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const admin = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims = '{}';`
const asUser = (uid = EDITOR) => `${admin}
  SET SESSION AUTHORIZATION "${actor}";
  SET ROLE authenticated;
  SET request.jwt.claims = ${quote(JSON.stringify({ sub: uid, role: 'authenticated' }))};
  SELECT public.jakv205_assert(session_user = '${actor}' AND current_user = 'authenticated'
    AND auth.uid() IS NOT DISTINCT FROM ${uid ? quote(uid) + '::uuid' : 'NULL::uuid'}, 'Identitate API reală, fără excepția session_user=postgres');`
const check = (expr, label) => `SELECT public.jakv205_assert((${expr}), ${quote(label)});`
const rejected = (sql, state, fragment) => `DO $test$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    EXECUTE ${quote(sql)};
  EXCEPTION WHEN SQLSTATE '${state}' THEN
    IF position(${quote(fragment)} in SQLERRM) = 0 THEN RAISE; END IF;
    refused := true;
  END;
  PERFORM public.jakv205_assert(refused, ${quote('Trebuia refuzat: ' + sql)});
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
  IF current_database() !~ '^jakv205_test_[a-z0-9_]+$' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Doar baza dedicată jakv205_test_* și login postgres';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    RAISE EXCEPTION 'Baza trebuie să fie goală; niciun obiect existent nu va fi șters';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $guard$;
CREATE ROLE "${actor}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT authenticated, service_role TO "${actor}";
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated;
CREATE FUNCTION public.jakv205_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAIL: %', message; END IF; END $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
INSERT INTO public.profiles VALUES ('${EDITOR}',false),('${OWNER}',true),('${DENIED}',false);
CREATE TABLE public.user_module_access (profile_id uuid REFERENCES public.profiles(id), module text);
INSERT INTO public.user_module_access VALUES ('${EDITOR}','ofertare');
${accessHelper}
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
${gateV203}
CREATE TEMP TABLE before_gate AS SELECT pg_get_functiondef('public.fn_gate_depunere()'::regprocedure) AS definition,
  proacl, prosecdef, proconfig FROM pg_proc WHERE oid='public.fn_gate_depunere()'::regprocedure;
CREATE TEMP TABLE before_trigger AS SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
  WHERE tgrelid='public.ofertare_licitatii'::regclass AND tgname='trg_gate_depunere';
CREATE TEMP TABLE before_helper AS SELECT pg_get_functiondef(oid) AS definition, proacl FROM pg_proc
  WHERE oid='public.fn_gate_depunere_derogare_owner()'::regprocedure;
-- Reproducem default privileges Supabase: migrarea trebuie să le revoce explicit.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`

// Pachetele sunt fixture-uri în stările existente; aici nu testăm triggerul lor de tranziții.
const gateMatrix = `SAVEPOINT matrix;
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
SELECT 'GATE_MATRIX_OK';`

const count = (id, expected) => check(`(SELECT count(*) FROM public.ofertare_derogari_audit WHERE licitatie_id=${id})=${expected}`, `Audit ${id}: ${expected} rânduri`)
const rpc = (id, reason = 'Motiv justificat de owner', grant = true) =>
  `SELECT public.ofertare_derogare_depunere(${id},${reason === null ? 'NULL' : quote(reason)},${grant === null ? 'NULL' : grant})`
const securityChecks = check(`(SELECT p.proacl IS NOT DISTINCT FROM b.proacl AND p.prosecdef=b.prosecdef
  AND p.proconfig=b.proconfig FROM pg_proc p CROSS JOIN before_gate b
  WHERE p.oid='public.fn_gate_depunere()'::regprocedure)`, 'ACL și securitatea porții păstrate')
  + check(`(SELECT pg_get_functiondef(p.oid)=b.definition AND p.proacl IS NOT DISTINCT FROM b.proacl
  FROM pg_proc p CROSS JOIN before_helper b WHERE p.oid='public.fn_gate_depunere_derogare_owner()'::regprocedure)`, 'Helper owner intact')
  + check(`(SELECT pg_get_triggerdef(t.oid)=b.definition FROM pg_trigger t CROSS JOIN before_trigger b
  WHERE t.tgrelid='public.ofertare_licitatii'::regclass AND t.tgname='trg_gate_depunere')`, 'Triggerul porții intact')
const auditSecurity = check(`(SELECT relrowsecurity FROM pg_class WHERE oid='public.ofertare_derogari_audit'::regclass)`, 'RLS activ')
  + check(`(SELECT count(*)=1 AND bool_and(polcmd='r') FROM pg_policy WHERE polrelid='public.ofertare_derogari_audit'::regclass)`, 'Doar policy SELECT')
  + ['authenticated', 'service_role'].map(role =>
    check(`has_table_privilege('${role}','public.ofertare_derogari_audit','SELECT')`, `${role}: SELECT acordat`)
    + ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'].map(privilege =>
      check(`NOT has_table_privilege('${role}','public.ofertare_derogari_audit','${privilege}')`, `${role}: ${privilege} revocat`)).join('')
    + check(`NOT has_sequence_privilege('${role}','public.ofertare_derogari_audit_id_seq','USAGE,SELECT,UPDATE')`, `${role}: fără secvență`)).join('')
  + check(`NOT has_table_privilege('anon','public.ofertare_derogari_audit','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`, 'Anon fără acces')
  + check(`has_function_privilege('authenticated','public.ofertare_derogare_depunere(bigint,text,boolean)','EXECUTE')
    AND NOT has_function_privilege('anon','public.ofertare_derogare_depunere(bigint,text,boolean)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.ofertare_derogare_depunere(bigint,text,boolean)','EXECUTE')`, 'RPC executabil doar de authenticated (verifică owner intern)')
  + check(`(SELECT prosecdef AND proconfig=ARRAY['search_path=public, pg_temp'] FROM pg_proc
    WHERE oid='public.ofertare_derogare_depunere(bigint,text,boolean)'::regprocedure)`, 'RPC SECURITY DEFINER cu search_path fix')

const auditMatrix = `SAVEPOINT audit_matrix;
${admin}
INSERT INTO public.ofertare_licitatii(id) SELECT generate_series(100,106);
UPDATE public.ofertare_licitatii SET derogare_depunere=NULL WHERE id=106;
${asUser()}
${rejected(rpc(100), '42501', 'doar ownerul')}
${rejected(rpc(100, null, false), '42501', 'doar ownerul')}
${count(100, 0)}
${asUser(null)}
${rejected(rpc(100), '42501', 'doar ownerul')}
${asUser(OWNER)}
${rejected(rpc(100, 'scurt'), '22023', 'minimum 10')}
${rejected(rpc(100, '          '), '22023', 'minimum 10')}
${rejected(rpc(100, null), '22023', 'minimum 10')}
${rejected(rpc(100, '         scurt        '), '22023', 'minimum 10')}
${rejected(rpc(100, 'Motiv valid suficient', null), '22023', 'p_acorda')}
${rejected(rpc(999), 'P0002', 'nu există')}
${count(100, 0)}
-- Testăm și valoarea implicită p_acorda=true.
SELECT public.ofertare_derogare_depunere(100,'Motiv justificat de owner');
${count(100, 1)}
${check(`(SELECT derogare_depunere AND derogare_motiv='Motiv justificat de owner' FROM public.ofertare_licitatii WHERE id=100)`, 'RPC salvează flag și motiv')}
${check(`(SELECT actiune='derogare_acordata' AND actor='${OWNER}'::uuid AND session_user_name='${actor}'
  AND motiv='Motiv justificat de owner' AND status_vechi='in_lucru' AND status_nou='in_lucru' AND creat_la IS NOT NULL
  FROM public.ofertare_derogari_audit WHERE licitatie_id=100)`, 'Actorul API și motivul sunt în audit')}
${rpc(100, 'Retragere justificata', false)};
${count(100, 2)}
${check(`(SELECT NOT derogare_depunere AND derogare_motiv='Retragere justificata' FROM public.ofertare_licitatii WHERE id=100)`, 'Retragere RPC')}
${check(`EXISTS (SELECT 1 FROM public.ofertare_derogari_audit WHERE licitatie_id=100 AND actiune='derogare_retrasa' AND actor='${OWNER}')`, 'Retragere auditată')}
${rpc(100)};
${rpc(100, 'Reconfirmare explicita')};
${count(100, 4)}
${rpc(106)};
${count(106, 1)}
-- Un GUC controlabil de apelant nu trebuie să poată dezactiva auditul.
SELECT set_config('gazpet.derogare_rpc','1',true);
UPDATE public.ofertare_licitatii SET derogare_depunere=true, derogare_motiv='Acordare directa' WHERE id=101;
${count(101, 1)}
SELECT set_config('gazpet.derogare_rpc','',true);
${submit(101)};
${count(101, 2)}
${check(`(SELECT actor='${OWNER}' AND motiv='Acordare directa' AND status_vechi='in_lucru' AND status_nou='depusa'
  FROM public.ofertare_derogari_audit WHERE licitatie_id=101 AND actiune='depusa_pe_derogare')`, 'Depunere auditată cu statusuri')}
UPDATE public.ofertare_licitatii SET termen_depunere=CURRENT_DATE WHERE id=101;
${count(101, 2)}
INSERT INTO public.ofertare_licitatii(id,status,derogare_depunere,derogare_motiv)
  VALUES (107,'depusa',true,'Derogare la insert');
${count(107, 2)}
${check(`(SELECT bool_and(status_vechi IS NULL AND status_nou='depusa') FROM public.ofertare_derogari_audit WHERE licitatie_id=107)`, 'INSERT: status vechi NULL')}
-- Forțăm verificarea FK după ce părintele a fost inserat.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
${asUser()}
${rejected("UPDATE public.ofertare_licitatii SET derogare_depunere=true WHERE id=102", '42501', 'doar ownerul')}
${count(102, 0)}
${rejected("INSERT INTO public.ofertare_derogari_audit(licitatie_id,actiune) VALUES (100,'derogare_acordata')", '42501', 'permission denied')}
${rejected("UPDATE public.ofertare_derogari_audit SET motiv='alterat' WHERE licitatie_id=100", '42501', 'permission denied')}
${rejected('DELETE FROM public.ofertare_derogari_audit WHERE licitatie_id=100', '42501', 'permission denied')}
${rejected('TRUNCATE public.ofertare_derogari_audit', '42501', 'permission denied')}
${count(100, 4)}
${asUser(DENIED)}
${check('(SELECT count(*) FROM public.ofertare_derogari_audit)=0', 'Fără modul: zero rânduri')}
${asUser(null)}
${check('(SELECT count(*) FROM public.ofertare_derogari_audit)=0', 'Fără JWT: zero rânduri')}
${asUser()}
SET ROLE service_role;
SET request.jwt.claims='{}';
${count(100, 4)}
${rejected("INSERT INTO public.ofertare_derogari_audit(licitatie_id,actiune) VALUES (100,'derogare_acordata')", '42501', 'permission denied')}
${rejected("UPDATE public.ofertare_derogari_audit SET motiv='alterat' WHERE licitatie_id=100", '42501', 'permission denied')}
${rejected('DELETE FROM public.ofertare_derogari_audit WHERE licitatie_id=100', '42501', 'permission denied')}
${rejected('TRUNCATE public.ofertare_derogari_audit', '42501', 'permission denied')}
${admin}
${rpc(105)};
${count(105, 1)}
${check(`(SELECT actor IS NULL AND session_user_name='postgres' FROM public.ofertare_derogari_audit WHERE licitatie_id=105)`, 'Sesiunea postgres auditată fără JWT')}
${rejected("UPDATE public.ofertare_derogari_audit SET motiv='alterat' WHERE licitatie_id=100", '42501', 'append-only')}
${rejected('DELETE FROM public.ofertare_derogari_audit WHERE licitatie_id=100', '42501', 'append-only')}
${rejected('TRUNCATE public.ofertare_derogari_audit', '42501', 'append-only')}
-- Chiar și cu privilegii acordate accidental, service_role nu poate rescrie auditul.
SAVEPOINT service_trigger;
GRANT UPDATE, DELETE, TRUNCATE ON public.ofertare_derogari_audit TO service_role;
${asUser()}
SET ROLE service_role;
${rejected("UPDATE public.ofertare_derogari_audit SET motiv='alterat' WHERE licitatie_id=100", '42501', 'append-only')}
${rejected('DELETE FROM public.ofertare_derogari_audit WHERE licitatie_id=100', '42501', 'append-only')}
${rejected('TRUNCATE public.ofertare_derogari_audit', '42501', 'append-only')}
${admin}
ROLLBACK TO SAVEPOINT service_trigger;
${rejected('DELETE FROM public.ofertare_licitatii WHERE id=100', '23503', 'foreign key')}
${rejected(rollback, 'P0001', 'există audit persistent')}
${count(100, 4)}
${auditSecurity}
-- Eșecul scrierii auditului anulează inclusiv UPDATE-ul licitației din RPC.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SAVEPOINT atomicity;
ALTER TABLE public.ofertare_derogari_audit ADD CONSTRAINT audit_test_failure CHECK (motiv <> 'ESEC AUDIT TRANZACTIE');
${asUser(OWNER)}
${rejected(rpc(103, 'ESEC AUDIT TRANZACTIE'), '23514', 'audit_test_failure')}
${check(`(SELECT NOT derogare_depunere AND derogare_motiv IS NULL FROM public.ofertare_licitatii WHERE id=103)`, 'Acordare și audit: atomicitate')}
${rejected(rpc(100, 'ESEC AUDIT TRANZACTIE', false), '23514', 'audit_test_failure')}
${check(`(SELECT derogare_depunere AND derogare_motiv='Reconfirmare explicita' FROM public.ofertare_licitatii WHERE id=100)`, 'Retragere și audit: atomicitate')}
${count(103, 0)}
${count(100, 4)}
${admin}
ROLLBACK TO SAVEPOINT atomicity;
-- R5 blochează și auditul: nicio urmă pentru depunerea nereușită.
SAVEPOINT r5_audit;
CREATE OR REPLACE FUNCTION public.ofertare_r5_blocaj_sursa(bigint) RETURNS text LANGUAGE sql AS $$ SELECT ': R5 TEST'::text $$;
${asUser(OWNER)}
${rejected("UPDATE public.ofertare_licitatii SET status='depusa',derogare_depunere=true WHERE id=104", 'P0001', 'R5 TEST')}
${count(104, 0)}
${status(104, 'in_lucru')}
${admin}
ROLLBACK TO SAVEPOINT r5_audit;
-- Rerularea migrării peste istoric păstrează rândurile și protecțiile.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
${migration}
${count(100, 4)}
${securityChecks}
${auditSecurity}
ROLLBACK TO SAVEPOINT audit_matrix;
-- Rollback-ul refuză și ștergerea motivelor când nu există audit.
SAVEPOINT reason_only;
INSERT INTO public.ofertare_licitatii(id,derogare_motiv) VALUES (108,'Motiv fara audit');
${rejected(rollback, 'P0001', 'există motive de derogare')}
ROLLBACK TO SAVEPOINT reason_only;
SELECT 'AUDIT_MATRIX_OK';`

const rollbackChecks = check(`(SELECT pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)=definition FROM before_gate)`, 'Rollback: poarta exactă V2-03')
  + securityChecks
  + check(`to_regclass('public.ofertare_derogari_audit') IS NULL
    AND to_regclass('public.ofertare_derogari_audit_id_seq') IS NULL
    AND to_regprocedure('public.ofertare_derogare_depunere(bigint,text,boolean)') IS NULL
    AND to_regprocedure('public.fn_ofertare_derogari_audit_imuabil()') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.ofertare_licitatii'::regclass
      AND attname='derogare_motiv' AND NOT attisdropped)`, 'Rollback: toate obiectele noi retrase')

try {
  assert.ok(process.env.PGURI, 'Setează PGURI către o bază PostgreSQL 16 locală, goală, jakv205_test_<sufix>')
  let target
  try { target = new URL(process.env.PGURI) } catch { throw new Error('PGURI invalid (valoarea nu este afișată)') }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'Protocol PostgreSQL obligatoriu')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Doar instanțe locale')
  assert.equal(target.search, '', 'PGURI fără query parameters')
  assert.equal(target.hash, '', 'PGURI fără fragment')
  assert.match(decodeURIComponent(target.pathname.slice(1)), /^jakv205_test_[a-z0-9_]+$/, 'Bază dedicată obligatorie')
  assert.equal(decodeURIComponent(target.username), 'postgres', 'Login postgres necesar fixture-ului')
  const sql = setup + '\n' + migration + '\n' + securityChecks + auditSecurity
    + '\n' + gateMatrix + '\n' + auditMatrix + '\n' + rollback + '\n' + rollbackChecks
    + '\n' + rollback + '\n' + rollbackChecks
    + '\n' + migration + '\n' + securityChecks + auditSecurity + '\n' + gateMatrix + '\n' + auditMatrix
    + "\nROLLBACK;\nSELECT 'PASS JAK-V2-05';\n"
  const result = spawnSync('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '--dbname', target.href, '--file', '-'], {
    input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' },
    windowsHide: true,
  })
  if (result.error) throw new Error(result.error.code === 'ENOENT' ? 'psql indisponibil în PATH' : 'Eșec lansare psql: ' + result.error.code)
  if (result.status !== 0) throw new Error(String(result.stderr || 'psql eșuat').trim())
  assert.equal((result.stdout.match(/GATE_MATRIX_OK/g) || []).length, 2)
  assert.equal((result.stdout.match(/AUDIT_MATRIX_OK/g) || []).length, 2)
  assert.match(result.stdout, /PASS JAK-V2-05/)
  console.log('PASS JAK-V2-05: audit atomic, RPC owner, INSERT/direct, RLS/ACL, append-only, regresii J03, rollback exact și rerulare.')
} catch (error) {
  console.error('FAIL JAK-V2-05: ' + String(error.message).replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  process.exitCode = 1
}
