// PG16 real, bază LOCALĂ goală jakv202_test_<sufix>, toate triggerele pachetului active.
// PGURI=postgres://postgres@localhost:5432/jakv202_test_local node scripts/pg/test_jakv202_hash_server.mjs
// Fixture tranzacțional + ROLLBACK, fără DROP DATABASE / modificarea vreunei baze existente.
import assert from 'node:assert/strict'
import { cuGarda } from './fixtures/livrare_garda.mjs'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const migration = name => read('supabase/migrations/' + name + '.sql')
const newName = '20260930a_ofertare_pachet_hash_server_jakv202'
const fix = cuGarda(newName, migration(newName)), rollback = migration(newName + '_ROLLBACK')
const r5 = read('docs/R5_MIGRARE_3_review_copilot.sql')
const r5Start = r5.indexOf('CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()')
const r5End = r5.indexOf('END $function$;', r5Start)
assert.ok(r5Start >= 0 && r5End > r5Start)
const r5Gate = r5.slice(r5Start, r5End + 'END $function$;'.length)
const access = migration('20260912_ofertare_acces_fara_parametru').split('ALTER POLICY')[0]
const storage = migration('20260928m_r07_r12_copilot')
const storageGate = storage.slice(storage.indexOf('CREATE OR REPLACE FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat'))
const uid = '00000000-0000-4000-8000-000000000007'
const denied = '00000000-0000-4000-8000-000000000099'
const actor = 'jakv202_actor_' + process.pid
const shaA = createHash('sha256').update('abc').digest('hex')
const shaB = createHash('sha256').update('xyz').digest('hex')
const q = s => "'" + String(s).replaceAll("'", "''") + "'"
const admin = 'RESET SESSION AUTHORIZATION; RESET ROLE; RESET request.jwt.claims;'
const asRole = (role, user = uid) => `${admin} SET SESSION AUTHORIZATION ${actor}; SET ROLE ${role};
  SET request.jwt.claims = ${q(JSON.stringify({ sub: user, role }))};`
const user = asRole('authenticated'), service = asRole('service_role')
const check = (expr, name) => `SELECT public.jakv202_assert((${expr}), ${q(name)});`
const refuse = (sql, code, fragment = '') => `DO $test$ DECLARE refused boolean := false; BEGIN
  BEGIN EXECUTE ${q(sql)};
  EXCEPTION WHEN SQLSTATE '${code}' THEN
    IF position(${q(fragment)} in SQLERRM) = 0 THEN RAISE; END IF;
    refused := true;
  END;
  PERFORM public.jakv202_assert(refused, ${q('Trebuia refuzat: ' + sql)});
END $test$;`
const submit = "UPDATE public.ofertare_pt_pachet SET stare='depus' WHERE id=1"
const audit = `INSERT INTO public.ofertare_pt_pachet_verificari
  (pachet_fisier_id,bucket,fisier_path,obj_id,obj_updated_at,obj_etag,obj_size,sha256_calculat,sha256_declarat,rezultat,verificat_de)
  SELECT f.id,o.bucket_id,o.name,o.id,o.updated_at,o.metadata->>'eTag',3,f.sha256,f.sha256,'PASS','${uid}'
  FROM public.ofertare_pt_pachet_fisiere f JOIN storage.objects o ON o.bucket_id='ofertare' AND o.name=f.fisier_path
  WHERE f.pachet_id=1`
const caseSql = (name, sql) => `${admin} SAVEPOINT scenario;
${sql}
${admin} ROLLBACK TO SAVEPOINT scenario; RELEASE SAVEPOINT scenario;
SELECT ${q('PASS ' + name)};`

const setup = `BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() !~ '^jakv202_test_[a-z0-9_]+$' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::int / 10000 <> 16 THEN
    RAISE EXCEPTION 'Doar PG16 local, bază jakv202_test_* și login postgres';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','S')) THEN
    RAISE EXCEPTION 'Baza trebuie să fie goală';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'service_role necesită BYPASSRLS'; END IF;
END $$;
CREATE ROLE ${actor} NOLOGIN;
GRANT authenticated, anon, service_role TO ${actor};
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
CREATE FUNCTION public.jakv202_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAIL: %',message; END IF; END $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access(profile_id uuid REFERENCES public.profiles(id),module text);
INSERT INTO public.profiles VALUES ('${uid}',false),('${denied}',false);
INSERT INTO public.user_module_access VALUES ('${uid}','ofertare');
${access}
CREATE TABLE public.ofertare_licitatii(id bigint PRIMARY KEY);
INSERT INTO public.ofertare_licitatii VALUES(1),(2);
CREATE TABLE public.ofertare_pt_poarta(id bigint PRIMARY KEY);
ALTER TABLE public.ofertare_pt_poarta ENABLE ROW LEVEL SECURITY;
${migration('20260913_ofertare_pt_pachet_manifest')}
${migration('20260928h_ofertare_pachet_poarta_r12')}
${migration('20260928k_ofertare_pachet_depus_r11')}
${migration('20260928o_ofertare_pachet_tranzitie_jakv201')}
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text NOT NULL,name text NOT NULL,
  updated_at timestamptz NOT NULL,metadata jsonb,UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
${storageGate}
-- Sursele agregate ale porții sunt fixtures; corpul triggerului R5 este cel aplicat din repo.
CREATE TABLE public.jakv202_source(licitatie_id bigint PRIMARY KEY,blocaj text,r5 text);
INSERT INTO public.jakv202_source VALUES(1,NULL,NULL),(2,NULL,NULL);
CREATE VIEW public.v_ofertare_seap_completitudine WITH (security_invoker=on) AS
  SELECT licitatie_id,blocaj FROM public.jakv202_source;
CREATE FUNCTION public.ofertare_r5_blocaj_sursa(p_id bigint) RETURNS text LANGUAGE sql STABLE
  SET search_path TO 'public','pg_temp' AS $$ SELECT r5 FROM public.jakv202_source WHERE licitatie_id=p_id $$;
${r5Gate}
CREATE TRIGGER trg_ofertare_pt_pachet_poarta_documentatie BEFORE INSERT OR UPDATE OF stare
  ON public.ofertare_pt_pachet FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie();
${user}
INSERT INTO public.ofertare_pt_pachet(licitatie_id,versiune) VALUES(1,1),(2,1);
INSERT INTO public.ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,fisier_path,size_bytes) VALUES
  (1,'propunere_docx','oferta.pdf','${shaA}','pt/1/propunere',3),
  (1,'borderou_docx','oferta.pdf','${shaB}','pt/1/borderou',3),
  (1,'depus_final','oferta.pdf','${shaA}','pt/1/final',3),
  (1,'dovada_seap','oferta.pdf','${shaA}','pt/1/dovada',3),
  (2,'propunere_docx','istoric.docx','${shaA}',NULL,3);
UPDATE public.ofertare_pt_pachet SET stare='aprobat',aprobat_de='${uid}' WHERE id IN (1,2);
${admin}
INSERT INTO storage.objects SELECT ('00000000-0000-4000-8000-'||lpad(id::text,12,'0'))::uuid,
  'ofertare',fisier_path,'2026-09-29 10:00:00.000001Z','{"size":3,"eTag":"abc"}'::jsonb
  FROM public.ofertare_pt_pachet_fisiere WHERE pachet_id=1;
CREATE TEMP TABLE before_functions AS SELECT oid,pg_get_functiondef(oid) definition,proacl
  FROM pg_proc WHERE oid IN ('public.fn_pt_pachet_depus_verifica()'::regprocedure,
    'public.fn_ofertare_pt_pachet_matrice()'::regprocedure,'public.fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure);
${fix}
${fix}
${check("(SELECT count(*)=3 AND bool_and(tgenabled='O') FROM pg_trigger WHERE tgrelid='public.ofertare_pt_pachet'::regclass AND NOT tgisinternal)", 'Toate cele trei triggere pachet active')}
${check("(SELECT bool_and(pg_get_functiondef(p.oid)=b.definition AND p.proacl IS NOT DISTINCT FROM b.proacl) FROM pg_proc p JOIN before_functions b USING(oid) WHERE p.proname <> 'fn_pt_pachet_depus_verifica')", 'R5 și matricea neschimbate')}
${check("(SELECT fisier_path IS NULL FROM public.ofertare_pt_pachet_fisiere WHERE id=5)", 'Istoricul NULL păstrat')}
`

const cases = [
  caseSql('fiecare rol cere fisier_path la INSERT; istoric neschimbat', `
    ${user}
    INSERT INTO public.ofertare_pt_pachet(licitatie_id,versiune) VALUES(1,2);
    ${['propunere_docx','borderou_docx','depus_final','dovada_seap'].map(rol => [null, '', '   '].map(path => refuse(
      `INSERT INTO public.ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,fisier_path)
       SELECT id,${q(rol)},'x','${shaA}',${path === null ? 'NULL' : q(path)} FROM public.ofertare_pt_pachet WHERE licitatie_id=1 AND versiune=2`, 'P0001', 'fisier_path obligatoriu')).join('\n')).join('\n')}
  `),
  caseSql('obiect inexistent => REFUZ', `
    DELETE FROM storage.objects WHERE name='pt/1/propunere';
    ${user} ${refuse(submit, 'P0001', 'oferta.pdf: obiect inexistent')}`),
  caseSql('istoric fără path nu poate deveni depus', `
    ${user}
    INSERT INTO public.ofertare_pt_pachet_fisiere(pachet_id,rol,nume,sha256,fisier_path) VALUES
      (2,'depus_final','final.pdf','${shaA}','pt/2/final'),(2,'dovada_seap','dovada.pdf','${shaA}','pt/2/dovada');
    ${refuse("UPDATE public.ofertare_pt_pachet SET stare='depus' WHERE id=2", 'P0001', 'istoric.docx: fisier_path lipsă')}`),
  caseSql('obiect gol => REFUZ chiar cu PASS vechi', `
    ${service} ${audit}; ${admin}
    UPDATE storage.objects SET metadata='{"size":0,"eTag":"abc"}' WHERE name='pt/1/propunere';
    ${user} ${refuse(submit, 'P0001', 'obiect gol')}`),
  caseSql('verificare absentă pe manifestul aprobat => REFUZ', `
    ${service} ${audit} AND f.rol IN ('depus_final','dovada_seap');
    ${user} ${refuse(submit, 'P0001', 'verificare PASS lipsă')}`),
  caseSql('SHA calculat diferit de manifest => REFUZ', `
    ${service} ${audit} AND f.id<>1;
    ${audit.replace('3,f.sha256,f.sha256,\'PASS\'', `3,'${shaB}','${shaA}','REFUZ'`)} AND f.id=1;
    ${user} ${refuse(submit, 'P0001', 'SHA diferit')}`),
  caseSql('PASS pentru alt hash declarat nu acoperă manifestul curent', `
    ${service} ${audit} AND f.id<>1;
    ${audit.replace('3,f.sha256,f.sha256,\'PASS\'', `3,'${shaB}','${shaB}','PASS'`)} AND f.id=1;
    ${user} ${refuse(submit, 'P0001', 'SHA diferit')}`),
  caseSql('PASS pentru altă cale nu acoperă obiectul cu același id', `
    ${service} ${audit} AND f.id<>1;
    ${audit.replace('f.id,o.bucket_id,o.name', "f.id,o.bucket_id,'pt/alt'")} AND f.id=1;
    ${user} ${refuse(submit, 'P0001', 'verificare PASS lipsă')}`),
  ...['depus_final','dovada_seap'].map(rol => caseSql(`R11: rolul ${rol} rămâne obligatoriu`, `
    DELETE FROM public.ofertare_pt_pachet_fisiere WHERE pachet_id=1 AND rol=${q(rol)};
    ${user} ${refuse(submit, 'P0001', rol)}`)),
  ...[
    ["id='00000000-0000-4000-8000-000000009999'", 'obj_id schimbat'],
    ["updated_at=updated_at+interval '1 microsecond'", 'updated_at schimbat'],
    ["metadata=jsonb_set(metadata,'{eTag}','\"nou\"')", 'eTag schimbat'],
    ["metadata=metadata-'eTag'", 'eTag dispărut'],
    ["metadata=jsonb_set(metadata,'{size}','4')", 'dimensiune schimbată'],
  ].map(([update, label]) => caseSql(`${label}: verificare veche => REFUZ`, `
    ${service} ${audit}; ${admin}
    UPDATE storage.objects SET ${update} WHERE name='pt/1/propunere';
    ${user} ${refuse(submit, 'P0001', 'verificare veche')}`)),
  caseSql('același nume, alt obiect/hash: dovada nu se poate transfera', `
    ${service} ${audit} AND f.id<>2;
    ${audit.replace('o.id,o.updated_at', "'00000000-0000-4000-8000-000000000001'::uuid,o.updated_at")} AND f.id=2;
    ${user} ${refuse(submit, 'P0001', 'oferta.pdf: verificare PASS')}`),
  caseSql('toate obiectele curente + SHA identic => DEPUS; nume identice, hash diferit', `
    ${service} ${audit};
    ${user} ${submit};
    ${check("(SELECT stare='depus' AND depus_la IS NOT NULL FROM public.ofertare_pt_pachet WHERE id=1)", 'Depus cu timp server')}
    ${admin} ${refuse("UPDATE public.ofertare_pt_pachet SET nota='x' WHERE id=1", 'P0001', 'depus este imuabil')}`),
  caseSql('obiecte fără eTag: PASS dacă snapshot-ul curent coincide', `
    UPDATE storage.objects SET metadata=metadata-'eTag' WHERE bucket_id='ofertare';
    ${service} ${audit}; ${user} ${submit};`),
  caseSql('ACL audit: INSERT numai service; append-only inclusiv postgres', `
    ${service} ${audit};
    ${check("(SELECT count(*)=4 FROM public.ofertare_pt_pachet_verificari)", 'service INSERT reușește')}
    ${['authenticated','anon','service_role'].map(role => `
      ${asRole(role)}
      ${role !== 'service_role' ? refuse(audit, '42501') : ''}
      ${refuse("UPDATE public.ofertare_pt_pachet_verificari SET motiv='x' WHERE id>0", '42501')}
      ${refuse('DELETE FROM public.ofertare_pt_pachet_verificari WHERE id>0', '42501')}
      ${refuse('TRUNCATE public.ofertare_pt_pachet_verificari', '42501')}`).join('\n')}
    ${admin}
    ${refuse("UPDATE public.ofertare_pt_pachet_verificari SET motiv='x' WHERE id>0", '42501', 'append-only')}
    ${refuse('DELETE FROM public.ofertare_pt_pachet_verificari WHERE id>0', '42501', 'append-only')}
    ${refuse('TRUNCATE public.ofertare_pt_pachet_verificari', '42501', 'append-only')}
    ${refuse('DELETE FROM public.ofertare_pt_pachet_fisiere WHERE id=1', '23503')}
    ${user} ${check('(SELECT count(*)=4 FROM public.ofertare_pt_pachet_verificari)', 'Acces Ofertare vede audit')}
    ${asRole('authenticated', denied)} ${check('(SELECT count(*)=0 FROM public.ofertare_pt_pachet_verificari)', 'Fără modul nu vede audit')}`),
  caseSql('snapshot RPC doar service, bucket ofertare fix', `
    ${user} ${refuse('SELECT public.ofertare_pt_fisier_snapshot(1)', '42501')}
    ${asRole('anon')} ${refuse('SELECT public.ofertare_pt_fisier_snapshot(1)', '42501')}
    ${service} ${check("public.ofertare_pt_fisier_snapshot(1)->>'bucket_id'='ofertare'", 'snapshot real')}
    ${admin} DELETE FROM storage.objects WHERE name='pt/1/propunere';
    INSERT INTO storage.objects VALUES ('00000000-0000-4000-8000-000000009999','alt','pt/1/propunere',now(),'{"size":3}');
    ${service} ${check('public.ofertare_pt_fisier_snapshot(1) IS NULL', 'alt bucket ignorat')}`),
  caseSql('R12: nici retrogradare, nici rescriere Storage de către authenticated', `
    ${user} ${refuse("UPDATE public.ofertare_pt_pachet SET stare='propus' WHERE id=1", 'P0001', 'Tranziție de pachet interzisă')}
    UPDATE storage.objects SET metadata='{"size":99}' WHERE name='pt/1/propunere';
    DELETE FROM storage.objects WHERE name='pt/1/propunere';
    ${check("(SELECT metadata->>'size'='3' FROM storage.objects WHERE name='pt/1/propunere')", 'R12 Storage rămas imuabil')}`),
  caseSql('R5/completitudine încă blochează chiar cu toate PASS', `
    ${service} ${audit}; ${admin}
    UPDATE public.jakv202_source SET r5=': sursa nerezolvată' WHERE licitatie_id=1;
    ${user} ${refuse(submit, 'P0001', 'sursa nerezolvată')}
    ${admin} UPDATE public.jakv202_source SET r5=NULL,blocaj='documentație incompletă' WHERE licitatie_id=1;
    ${user} ${refuse(submit, 'P0001', 'documentație incompletă')}`),
  caseSql('rollback păstrează dovezile și restaurează exact triggerul 20260928k', `
    ${service} ${audit}; ${admin} ${rollback}
    ${check('(SELECT count(*)=4 FROM public.ofertare_pt_pachet_verificari)', 'Dovezi păstrate')}
    ${check("(SELECT bool_and(pg_get_functiondef(p.oid)=b.definition AND p.proacl IS NOT DISTINCT FROM b.proacl) FROM pg_proc p JOIN before_functions b USING(oid))", 'Funcții inițiale restaurate exact')}
    ${refuse('TRUNCATE public.ofertare_pt_pachet_verificari', '42501', 'append-only')}
    ${service} ${refuse(audit, '42501')}
    ${admin} ${fix} ${service} ${audit}; ${user} ${submit};`),
]

try {
  assert.ok(process.env.PGURI, 'Setează PGURI către PG16 local, bază goală jakv202_test_<sufix>')
  let target
  try { target = new URL(process.env.PGURI) } catch { throw new Error('PGURI invalid (valoarea nu se afișează)') }
  assert.ok(['postgres:','postgresql:'].includes(target.protocol))
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname), 'Doar instanțe locale')
  assert.equal(target.search, ''); assert.equal(target.hash, '')
  assert.equal(decodeURIComponent(target.username), 'postgres')
  assert.match(decodeURIComponent(target.pathname.slice(1)), /^jakv202_test_[a-z0-9_]+$/)
  const result = spawnSync('psql', ['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','--dbname',target.href,'--file','-'], {
    input: setup + cases.join('\n') + '\n' + admin + '\nROLLBACK;\n', encoding: 'utf8', timeout: 60000,
    maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5' },
  })
  if (result.error) throw new Error(result.error.code === 'ENOENT' ? 'psql indisponibil în PATH' : 'psql: ' + result.error.code)
  if (result.status !== 0) throw new Error(result.stderr || 'psql eșuat')
  const passed = result.stdout.split(/\r?\n/).filter(line => line.startsWith('PASS '))
  assert.equal(passed.length, cases.length)
  console.log(passed.join('\n'))
  console.log(`PASS JAK-V2-02: ${passed.length} scenarii PG16, toate triggerele active; rollback tranzacțional.`)
} catch (error) {
  console.error('FAIL/INDISPONIBIL JAK-V2-02: ' + String(error.message).replaceAll(process.env.PGURI || '\0', '[PGURI]'))
  process.exitCode = 1
}
