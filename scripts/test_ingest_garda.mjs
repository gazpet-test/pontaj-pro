#!/usr/bin/env node
// Test 20260930k_ofertare_ingest_garda (garda citirii automate Ofertare, #553 runda 2) pe PostgreSQL 17 LOCAL.
// Nu atinge live: initdb într-un director temporar, doar socket unix, fără TCP; nu citește .env, nu folosește chei.
// Rulare: node scripts/test_ingest_garda.mjs   (PGBIN=/usr/lib/postgresql/17/bin, PGPORT=5496)
// Dovedește, pe blocantele NO-GO r1:
//  (1) ACL: anon 0/8, authenticated EXACT SELECT (fără grant option), PUBLIC absent din ACL brut, 0 ACL pe coloane,
//      service_role 8/8 — cu setările implicite Supabase (arwdDxtm) ȘI după SEC F1 (#551), în AMBELE ordini; RLS pe calea REST;
//  (2) lease + token: o singură încercare pe document (N sesiuni concurente ⇒ exact 1 „continua”), „in_curs” fără numărare,
//      _rezultat acceptă doar tokenul memorat (vechi/străin/NULL ⇒ ignorat + rezultate_respinse), lease expirat ⇒ abandonat = eșec;
//  (3) plafoane (5 eșecuri, 80 descărcări) ⇒ blocat + notificare owner; reactivare doar owner;
//  (5) livrare: validatorul runnerului, garda gazpet.livrare_migrare (start/final), precondiții de absență / „deja aplicat” /
//      stare parțială / dependențe, postcondiții (injecții care strică ACL/funcții ⇒ refuz, nimic rămas), revenirea armată
//      pornește doar din amprenta exactă; textul amprentei și valoarea așteptată identice în migrare (pre/post) și revenire.
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = process.env.PGBIN || '/usr/lib/postgresql/17/bin'
const PORT = process.env.PGPORT || '5496'
const NUME = '20260930k_ofertare_ingest_garda'
const MIG_CALE = join(ROOT, 'supabase/migrations', NUME + '.sql')
const MIG = readFileSync(MIG_CALE, 'utf8')
const RB = readFileSync(join(ROOT, 'supabase/revenire', NUME + '_ROLLBACK.sql'), 'utf8')
const git = (args) => { try { return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
// SEC F1 (#551, 20260930i): din migrations/ dacă e deja pe branch, altfel din branch-ul F1 — doar pentru testul de compunere
const F1_NUME = '20260930i_sec_f1_truncate_revoke'
const F1 = existsSync(join(ROOT, 'supabase/migrations', F1_NUME + '.sql')) ? readFileSync(join(ROOT, 'supabase/migrations', F1_NUME + '.sql'), 'utf8')
  : git(['show', `${process.env.F1_REF || 'origin/claude/erp-continuare-x4p5a7-sec-f1f2'}:supabase/migrations/${F1_NUME}.sql`])
// validatorul runnerului comun (scripts/livrare_validator.py; GO Copilot R9 = ed7ecb0): local dacă există, altfel din git
const VALIDATOR = existsSync(join(ROOT, 'scripts/livrare_validator.py')) ? readFileSync(join(ROOT, 'scripts/livrare_validator.py'), 'utf8')
  : git(['show', `${process.env.VALIDATOR_REF || 'ed7ecb0'}:scripts/livrare_validator.py`])

const U = { owner: '00000000-0000-0000-0000-00000000000a', modul: '00000000-0000-0000-0000-00000000000b', fara: '00000000-0000-0000-0000-00000000000c' }
const T = 'public.ofertare_ingest_garda'
const PRIV = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']

const dir = mkdtempSync(join(tmpdir(), 'pg_garda_'))
const data = join(dir, 'data')
let ok = 0, fail = 0
const check = (name, cond, info = '') => { if (cond) { ok++; console.log('  ✔', name) } else { fail++; console.log('  ✘', name, String(info).slice(0, Number(process.env.DETALIU) || 600)) } }
const psqlArgs = (user) => ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', PORT, '-U', user, '-d', 'postgres']
const psql = (sql, { user = 'postgres' } = {}) => {
  try { return { ok: true, out: execFileSync(join(BIN, 'psql'), psqlArgs(user), { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() } }
  catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const val = (sql) => psql(sql).out
// runner simulat (scripts/livrare_migrare.sh): marcajul legat de txid + fișierul, într-o singură tranzacție
const livrare = (sql, nume = NUME) => psql(`BEGIN;\nSELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true) \\g /dev/null\n${sql}\nCOMMIT;`)
const revenire = (sql, arm = `SELECT set_config('gazpet.revenire_20260930k', 'SCOATE_GARDA_INGEST:' || txid_current(), true) \\g /dev/null`) =>
  psql(`BEGIN;\n${arm}\n${sql}\nCOMMIT;`)
// o „cerere REST”: rol + claims în tranzacție, ca PostgREST
const rest = (rol, uid, sql) => psql(`BEGIN;\nSET LOCAL ROLE ${rol};\nSELECT set_config('request.jwt.claims', '${JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })}', true) \\g /dev/null\n${sql}\nROLLBACK;`)
// apel service_role (edge/worker), COMIS
const sr = (sql) => psql(`BEGIN;\nSET LOCAL ROLE service_role;\n${sql}\nCOMMIT;`)
const incearca = (doc, size = 'NULL', etag = 'NULL', sursa = 'test') => { const r = sr(`SELECT public.ofertare_ingest_garda_incearca(${doc}, ${size}, ${etag}, '${sursa}');`); return r.ok ? JSON.parse(r.out) : { eroare: r.out } }
const rezultat = (doc, token, rez, extra = {}) => {
  const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  const r = sr(`SELECT public.ofertare_ingest_garda_rezultat(${doc}, ${token == null ? 'NULL' : `'${token}'`}, ${q(rez)}, ${q(extra.hash)}, ${extra.size ?? 'NULL'}, ${q(extra.etag)}, ${q(extra.eroare)}, ${extra.doc ? q(JSON.stringify(extra.doc)) + '::jsonb' : 'NULL'});`)
  return r.ok ? JSON.parse(r.out) : { eroare: r.out }
}
const rand = (doc) => JSON.parse(val(`SELECT coalesce((SELECT row_to_json(g) FROM ${T} g WHERE doc_id = ${doc}), 'null');`))
const obiecteGarda = () => Number(val(`SELECT (SELECT count(*) FROM pg_class WHERE relname IN ('ofertare_ingest_garda','ofertare_ingest_garda_pkey','ofertare_ingest_garda_blocat_idx')) + (SELECT count(*) FROM pg_proc WHERE proname LIKE 'ofertare_ingest_garda%') + (SELECT count(*) FROM pg_policy WHERE polname = 'ofertare_ingest_garda_select')`))
const aclTabel = () => val(`SELECT string_agg(e, ',' ORDER BY e COLLATE "C") FROM (SELECT format('%s:%s:%s', CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type, x.is_grantable) e FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = '${T}'::regclass) s`)
const privEfectiv = (rol) => val(`SELECT string_agg(pr, ',' ORDER BY pr) FROM unnest(ARRAY[${PRIV.map(p => `'${p}'`).join(',')}]) pr WHERE has_table_privilege('${rol}', '${T}', pr)`)

// initdb/pg_ctl refuză root: ca root rulăm serverul ca utilizatorul „postgres” (runuser)
const ROOTU = process.getuid && process.getuid() === 0
const srv = (cmd, args) => ROOTU ? execFileSync('runuser', ['-u', 'postgres', '--', join(BIN, cmd), ...args], { stdio: 'ignore' }) : execFileSync(join(BIN, cmd), args, { stdio: 'ignore' })
function porneste() {
  if (ROOTU) chmodSync(dir, 0o777)
  srv('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-sync'])
  srv('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ${dir} -c listen_addresses=''`, '-w', 'start', '-l', join(dir, 'log')])
}
// schelet Supabase: rolurile, setările implicite ale lui postgres în public (ALL către anon/authenticated/service_role, ca pe live),
// auth.users + auth.uid(), profiles, user_module_access, notifications, ofertare_documente_atribuire, helper-ul cu corpul LIVE
const FIXTURE = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid, module text);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, profile_id uuid, type text, modul text, title text, message text, link_to text, created_at timestamptz DEFAULT now());
CREATE TABLE public.ofertare_documente_atribuire (id bigserial PRIMARY KEY, status_procesare text NOT NULL DEFAULT 'neprocesat', text_extras text, pagini int, size_bytes bigint, pagini_procesate int, pagini_felie int, pagini_necitite int[], eroare text, antet jsonb, revizie text, ocr boolean, procesat_la timestamptz, procesat_de uuid);
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;
INSERT INTO auth.users VALUES ('${U.owner}'), ('${U.modul}'), ('${U.fara}');
INSERT INTO public.profiles VALUES ('${U.owner}', true), ('${U.modul}', false), ('${U.fara}', false);
INSERT INTO public.user_module_access VALUES ('${U.modul}', 'ofertare'), ('${U.fara}', 'executie');
INSERT INTO public.ofertare_documente_atribuire (status_procesare) SELECT 'neprocesat' FROM generate_series(1, 40);
`
const blocuri = (txt, tag) => [...txt.matchAll(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g'))].map(m => m[1])
const asteptate = (txt) => [...txt.matchAll(/v_asteptat CONSTANT jsonb := '([^']*)'::jsonb/g)].map(m => m[1])

try {
  porneste()
  const f = psql(FIXTURE)
  if (!f.ok) throw new Error('fixture: ' + f.out)

  console.log('0. Artefactele')
  check('helper-ul din fixture are md5-ul citit pe 30.09 (429d28e2…)', val(`SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fn_are_acces_ofertare'`) === '429d28e2a61fb24c8009d67050c16c85')
  const amp = [...blocuri(MIG, 'amprenta'), ...blocuri(RB, 'amprenta')]
  check('textul amprentei e IDENTIC în migrare (pre + post) și în revenire (3 copii)', amp.length === 3 && amp.every(a => a === amp[0]), amp.length)
  const exp = [...asteptate(MIG), ...asteptate(RB)]
  check('valoarea așteptată a amprentei e IDENTICĂ în cele 3 locuri și nu e placeholder', exp.length === 3 && exp.every(e => e === exp[0]) && !exp[0].includes('PLACEHOLDER'), exp.map(e => e.slice(0, 40)))
  check('fișierul migrării NU conține BEGIN/COMMIT la nivel superior, CREATE OR REPLACE, IF NOT EXISTS sau DROP … IF EXISTS', !/^\s*(BEGIN|COMMIT)\s*;/mi.test(MIG) && !/CREATE\s+OR\s+REPLACE|IF\s+NOT\s+EXISTS|DROP\s+\w+\s+IF\s+EXISTS/i.test(MIG))
  check('garda de livrare apare la start (primul bloc) și la final (ultimul bloc)', /^DO \$livrare_start\$/m.test(MIG) && MIG.indexOf('$livrare_start$') < MIG.indexOf('$pre$') && MIG.trimEnd().endsWith('END $livrare_final$;'))
  if (VALIDATOR) {
    const vf = join(dir, 'livrare_validator.py'); writeFileSync(vf, VALIDATOR)
    const copie = join(dir, NUME + '.sql'); writeFileSync(copie, MIG)
    let r; try { r = { ok: true, out: execFileSync('python3', [vf, copie, 'reg_0123456789abcdef'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } } catch (e) { r = { ok: false, out: String(e.stderr || e.message) } }
    check(`validatorul runnerului (livrare_validator.py) acceptă migrarea: ${r.out.trim()}`, r.ok && /^OK \d+/.test(r.out), r.out)
    writeFileSync(copie, 'BEGIN;\n' + MIG + '\nCOMMIT;\n')
    try { execFileSync('python3', [vf, copie], { stdio: 'ignore' }); check('control: validatorul refuză o variantă cu BEGIN/COMMIT', false) } catch { check('control: validatorul refuză o variantă cu BEGIN/COMMIT', true) }
  } else check('validatorul runnerului disponibil (scripts/livrare_validator.py sau ed7ecb0)', false, 'lipsă')

  console.log('1. Gărzi de livrare + precondiții (nimic creat la refuz)')
  let r = psql(MIG)
  check('fără runner (psql -f simplu) → refuz', !r.ok && /garda gazpet.livrare_migrare, start/.test(r.out) && obiecteGarda() === 0, r.out)
  r = livrare(MIG, 'alt_nume')
  check('marcaj cu alt nume → refuz', !r.ok && obiecteGarda() === 0, r.out)
  r = psql(`SELECT set_config('gazpet.livrare_migrare', '${NUME}:' || txid_current(), false) \\g /dev/null\n${MIG}`)
  check('marcaj de sesiune dintr-o tranzacție anterioară (txid diferit) → refuz', !r.ok && obiecteGarda() === 0, r.out)
  // refuz ⇒ nimic creat: numărul obiectelor cu numele gărzii rămâne cel de după pregătire (0, sau obiectul străin pus de test)
  const refuzPre = (nume, prep, undo, re) => { psql(prep); const n0 = obiecteGarda(); const x = livrare(MIG); check(nume, !x.ok && re.test(x.out) && obiecteGarda() === n0, x.out); psql(undo) }
  psql('CREATE ROLE altul SUPERUSER LOGIN;')
  r = psql(`BEGIN;\nSELECT set_config('gazpet.livrare_migrare', '${NUME}:' || txid_current(), true) \\g /dev/null\n${MIG}\nCOMMIT;`, { user: 'altul' })
  check('rulat de alt rol decât postgres (superuser „altul”) → refuz', !r.ok && /rulează ca postgres/.test(r.out) && obiecteGarda() === 0, r.out)
  psql('DROP ROLE altul;')
  refuzPre('o funcție cu numele patch-ului în ALTĂ schemă → refuz „stare parțială”', `CREATE SCHEMA x; CREATE FUNCTION x.ofertare_ingest_garda_incearca() RETURNS int LANGUAGE sql AS 'SELECT 1';`, 'DROP SCHEMA x CASCADE;', /stare parțială/)
  refuzPre('un tabel public.ofertare_ingest_garda străin (IF NOT EXISTS l-ar fi acceptat) → refuz „stare parțială”', `CREATE TABLE public.ofertare_ingest_garda (doc_id bigint);`, 'DROP TABLE public.ofertare_ingest_garda;', /stare parțială/)
  refuzPre('helper-ul fn_are_acces_ofertare cu alt corp → refuz', `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS 'SELECT true';`,
    FIXTURE.match(/CREATE FUNCTION public\.fn_are_acces_ofertare[\s\S]*?\$function\$;/)[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'), /amprenta citită pe 30\.09/)
  check('helper-ul revenit la corpul live', val(`SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fn_are_acces_ofertare'`) === '429d28e2a61fb24c8009d67050c16c85')
  refuzPre('overload fn_are_acces_ofertare(int) → refuz', `CREATE FUNCTION public.fn_are_acces_ofertare(x int DEFAULT 0) RETURNS boolean LANGUAGE sql AS 'SELECT true';`, 'DROP FUNCTION public.fn_are_acces_ofertare(int);', /overload/)
  refuzPre('ofertare_documente_atribuire.status_procesare varchar → refuz', `ALTER TABLE public.ofertare_documente_atribuire ALTER status_procesare TYPE varchar(40);`, `ALTER TABLE public.ofertare_documente_atribuire ALTER status_procesare TYPE text;`, /ofertare_documente_atribuire lipsește sau diferă/)
  refuzPre('ofertare_documente_atribuire fără o coloană scrisă prin _rezultat (antet) → refuz', `ALTER TABLE public.ofertare_documente_atribuire RENAME antet TO antet_x;`, `ALTER TABLE public.ofertare_documente_atribuire RENAME antet_x TO antet;`, /13 coloane/)
  refuzPre('notifications fără coloana link_to → refuz', `ALTER TABLE public.notifications RENAME link_to TO link;`, `ALTER TABLE public.notifications RENAME link TO link_to;`, /dependențe lipsă/)

  console.log('2. Postcondiții — injecții care strică patch-ul ⇒ refuz, nimic rămas')
  const injectie = (nume, dupa, extra, re) => {
    const m = MIG.replace(dupa, dupa + '\n' + extra)
    check(nume + ' (injecția s-a aplicat textului)', m !== MIG)
    const x = livrare(m); check(nume, !x.ok && re.test(x.out) && obiecteGarda() === 0, x.out)
  }
  const GR = 'GRANT ALL ON TABLE public.ofertare_ingest_garda TO service_role;'
  injectie('INSERT dat lui authenticated', GR, 'GRANT INSERT ON TABLE public.ofertare_ingest_garda TO authenticated;', /POSTCONDIȚIE 20260930k: amprenta diferă de a patch-ului la: acl/)
  injectie('TRUNCATE lăsat lui anon', GR, 'GRANT TRUNCATE ON TABLE public.ofertare_ingest_garda TO anon;', /POSTCONDIȚIE 20260930k: amprenta diferă/)
  injectie('SELECT pentru PUBLIC', GR, 'GRANT SELECT ON TABLE public.ofertare_ingest_garda TO PUBLIC;', /POSTCONDIȚIE 20260930k: amprenta diferă/)
  injectie('SELECT WITH GRANT OPTION pentru authenticated', GR, 'GRANT SELECT ON TABLE public.ofertare_ingest_garda TO authenticated WITH GRANT OPTION;', /POSTCONDIȚIE 20260930k: amprenta diferă/)
  injectie('ACL pe o coloană pentru anon', GR, 'GRANT SELECT (doc_id) ON TABLE public.ofertare_ingest_garda TO anon;', /POSTCONDIȚIE 20260930k: amprenta diferă de a patch-ului la: acl_coloane/)
  injectie('RLS oprit', GR, 'ALTER TABLE public.ofertare_ingest_garda DISABLE ROW LEVEL SECURITY;', /amprenta diferă de a patch-ului la: tabel/)
  injectie('a doua politică (scriere)', GR, 'CREATE POLICY p_x ON public.ofertare_ingest_garda FOR UPDATE TO authenticated USING (true);', /amprenta diferă de a patch-ului la: politici/)
  const RI = 'GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) TO service_role;'
  injectie('EXECUTE pe _incearca dat lui authenticated', RI, 'GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) TO authenticated;', /amprenta diferă de a patch-ului la: functii/)
  injectie('EXECUTE pe _incearca dat lui PUBLIC', RI, 'GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) TO PUBLIC;', /amprenta diferă de a patch-ului la: functii/)
  injectie('_incearca fără SECURITY DEFINER', RI, 'ALTER FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) SECURITY INVOKER;', /amprenta diferă de a patch-ului la: functii/)
  injectie('_notifica cu search_path schimbat', RI, 'ALTER FUNCTION public.ofertare_ingest_garda_notifica(bigint, text) SET search_path = public;', /amprenta diferă de a patch-ului la: functii/)
  const cuReplace = MIG.replace("ultima_sursa = left(p_sursa, 100), updated_at = now()\n  WHERE doc_id = p_doc_id RETURNING * INTO g;\n  RETURN jsonb_build_object('actiune', 'continua'",
    "ultima_sursa = left(p_sursa, 100), updated_at = now()\n  WHERE doc_id = p_doc_id RETURNING * INTO g;\n  PERFORM 1;\n  RETURN jsonb_build_object('actiune', 'continua'")
  r = livrare(cuReplace)
  check('corpul lui _incearca modificat (md5 prosrc) → postcondiția refuză', cuReplace !== MIG && !r.ok && /amprenta diferă de a patch-ului la: functii/.test(r.out) && obiecteGarda() === 0, r.out)
  r = livrare(MIG.replace(/DO \$livrare_final\$[\s\S]*$/, `SELECT set_config('gazpet.livrare_migrare', 'altceva', true);\n$&`))
  check('marcajul pierdut în timpul migrării → garda finală refuză, nimic rămas', !r.ok && /garda de livrare \(final\)/.test(r.out) && obiecteGarda() === 0, r.out)

  console.log('3. ACL — compunere cu SEC F1 (#551) în AMBELE ordini')
  const stareAcl = () => [aclTabel(), privEfectiv('anon') || '-', privEfectiv('authenticated'), privEfectiv('service_role'),
    val(`SELECT count(*) FROM pg_attribute WHERE attrelid = '${T}'::regclass AND attacl IS NOT NULL`)].join(' | ')
  const ACL_ASTEPTAT = ['authenticated:SELECT', ...['postgres', 'service_role'].flatMap(r => PRIV.slice().sort().map(p => `${r}:${p}`))].map(e => e + ':f').join(',')
  const STARE_ACL = `${ACL_ASTEPTAT} | - | SELECT | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | 0`
  // ordinea A: garda ÎNAINTE de F1 (setările implicite dau arwdDxtm lui anon/authenticated)
  r = livrare(MIG)
  check('aplicare cu setările implicite Supabase (arwdDxtm pentru anon/authenticated)', r.ok, r.out)
  const aclA = stareAcl()
  check('ACL exact: anon 0/8, authenticated EXACT SELECT, service_role 8/8, PUBLIC absent, 0 ACL pe coloane', aclA === STARE_ACL, aclA)
  check('authenticated fără grant option; anon fără privilegii pe coloane', val(`SELECT has_table_privilege('authenticated', '${T}', 'SELECT WITH GRANT OPTION')::text || has_any_column_privilege('anon', '${T}', 'SELECT,INSERT,UPDATE,REFERENCES')::text`) === 'falsefalse')
  if (F1) {
    r = livrare(F1, F1_NUME)
    check('SEC F1 aplicat DUPĂ garda → trece (postcondițiile lui F1 verzi)', r.ok, r.out)
    check('ACL-ul gărzii neschimbat de F1', stareAcl() === STARE_ACL, stareAcl())
  } else check('SEC F1 disponibil pentru testul de compunere', false, 'lipsă F1')
  r = livrare(MIG)
  check('a doua aplicare → refuz „deja aplicat”', !r.ok && /deja aplicat/.test(r.out), r.out)

  console.log('4. Calea REST (PostgREST simulat) + EXECUTE pe funcții')
  psql(`INSERT INTO ${T} (doc_id) VALUES (40);`)
  const a = rest('anon', null, `SELECT count(*) FROM ${T};`)
  check('anon: SELECT → permission denied', !a.ok && /permission denied/.test(a.out), a.out)
  for (const op of [`INSERT INTO ${T}(doc_id) VALUES (39)`, `UPDATE ${T} SET blocat = false`, `DELETE FROM ${T}`, `TRUNCATE ${T}`]) {
    const x = rest('authenticated', U.modul, op + ';')
    check(`authenticated cu modul: ${op.split(' ')[0]} → permission denied`, !x.ok && /permission denied/.test(x.out), x.out)
  }
  check('authenticated cu modul Ofertare: vede rândurile (RLS)', rest('authenticated', U.modul, `SELECT count(*) FROM ${T};`).out === '1')
  check('authenticated FĂRĂ modul: 0 rânduri (RLS)', rest('authenticated', U.fara, `SELECT count(*) FROM ${T};`).out === '0')
  check('owner: vede rândurile', rest('authenticated', U.owner, `SELECT count(*) FROM ${T};`).out === '1')
  for (const [rol, fn] of [['anon', 'ofertare_ingest_garda_incearca(1, NULL, NULL, NULL)'], ['authenticated', 'ofertare_ingest_garda_incearca(1, NULL, NULL, NULL)'],
    ['authenticated', `ofertare_ingest_garda_rezultat(1, NULL, 'esec', NULL, NULL, NULL, NULL, NULL)`], ['authenticated', `ofertare_ingest_garda_notifica(1, 'x')`],
    ['service_role', `ofertare_ingest_garda_notifica(1, 'x')`], ['anon', 'ofertare_ingest_garda_reactiveaza(1)'], ['service_role', 'ofertare_ingest_garda_reactiveaza(1)'],
    ['authenticated', `ofertare_ingest_garda_rezultat(1, NULL, 'esec', NULL, NULL, NULL, NULL, '{"status_procesare":"procesat"}'::jsonb)`]]) {
    const x = rest(rol, rol === 'authenticated' ? U.owner : null, `SELECT public.${fn};`)
    check(`${rol}: EXECUTE ${fn.split('(')[0]} → permission denied`, !x.ok && /permission denied for function/.test(x.out), x.out)
  }
  const nr = rest('authenticated', U.modul, 'SELECT public.ofertare_ingest_garda_reactiveaza(40);')
  check('authenticated non-owner: _reactiveaza → refuz din corp', !nr.ok && /doar ownerul/.test(nr.out), nr.out)
  psql(`DELETE FROM ${T} WHERE doc_id = 40;`)

  console.log('5. Lease + token (blocantul 2)')
  let c1 = incearca(1)
  check('primul _incearca → continua cu token + lease ~10 min, descarcari 1', c1.actiune === 'continua' && /^[0-9a-f-]{36}$/.test(c1.token) && c1.descarcari === 1
    && Math.abs(new Date(c1.pana_la) - Date.now() - 600_000) < 60_000, JSON.stringify(c1))
  let c2 = incearca(1)
  check('al doilea _incearca cât lease-ul e activ → in_curs, FĂRĂ numărare', c2.actiune === 'in_curs' && rand(1).descarcari === 1 && rand(1).incercare_token === c1.token, JSON.stringify(c2))
  let rz = rezultat(1, '11111111-1111-1111-1111-111111111111', 'succes')
  check('_rezultat cu token STRĂIN → ignorat (acceptat:false), lease intact, rezultate_respinse=1', rz.acceptat === false && /străin/.test(rz.motiv) && rand(1).incercare_token === c1.token && rand(1).rezultate_respinse === 1, JSON.stringify(rz))
  rz = rezultat(1, null, 'esec')
  check('_rezultat cu token NULL → ignorat, eșecurile neatinse', rz.acceptat === false && rand(1).incercari_esuate === 0 && rand(1).rezultate_respinse === 2, JSON.stringify(rz))
  rz = rezultat(1, c1.token, 'nimic')
  check('_rezultat cu rezultat necunoscut → eroare, lease intact', rz.eroare && /rezultat necunoscut/.test(rz.eroare) && rand(1).incercare_token === c1.token, JSON.stringify(rz))
  rz = rezultat(1, c1.token, 'progres')
  check('_rezultat cu tokenul ACTIV → acceptat, lease eliberat', rz.acceptat === true && rand(1).incercare_token === null && rand(1).in_curs_pana === null, JSON.stringify(rz))
  rz = rezultat(1, c1.token, 'esec', { eroare: 'dublură' })
  check('același token a doua oară → ignorat (token vechi), eșecurile neatinse', rz.acceptat === false && /vechi/.test(rz.motiv) && rand(1).incercari_esuate === 0, JSON.stringify(rz))
  // concurență reală: N sesiuni simultane pe un document NOU și pe unul existent ⇒ exact un „continua”
  const concurent = (doc, n) => Promise.all(Array.from({ length: n }, (_, i) => new Promise((res) => {
    const p = spawn(join(BIN, 'psql'), psqlArgs('postgres'), { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''; p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { out += d })
    p.on('close', () => res(out.trim()))
    p.stdin.end(`BEGIN;\nSET LOCAL ROLE service_role;\nSELECT public.ofertare_ingest_garda_incearca(${doc}, NULL, NULL, 'c${i}')->>'actiune';\nSELECT pg_sleep(0.3) \\g /dev/null\nCOMMIT;\n`)
  })))
  for (const [doc, eticheta] of [[2, 'document nou (rândul gărzii nu există)'], [1, 'document cu rând existent']]) {
    const rez = await concurent(doc, 10)
    const nC = rez.filter(x => x === 'continua').length, nI = rez.filter(x => x === 'in_curs').length
    check(`10 sesiuni concurente, ${eticheta} → exact 1 continua + 9 in_curs, o singură descărcare numărată`, nC === 1 && nI === 9 && rand(doc).descarcari === (doc === 1 ? 2 : 1), rez.join(','))
  }
  // lease expirat fără rezultat = abandonat ⇒ eșec + backoff de la expirare; tokenul vechi respins după preluare
  const vechi = rand(2).incercare_token
  psql(`UPDATE ${T} SET in_curs_pana = now() - interval '10 seconds' WHERE doc_id = 2;`)
  c2 = incearca(2)
  let g2 = rand(2)
  check('lease expirat → încercarea veche închisă ca ABANDONATĂ (eșec 1, backoff 60 s de la expirare) → asteapta', c2.actiune === 'asteapta' && g2.incercari_esuate === 1 && g2.incercare_token === null && /abandonată/.test(g2.ultima_eroare), JSON.stringify(c2) + JSON.stringify(g2))
  rz = rezultat(2, vechi, 'succes', { hash: 'h' })
  check('rezultatul târziu al încercării abandonate → ignorat (token vechi), amprenta neatinsă', rz.acceptat === false && rand(2).ingerat_hash === null, JSON.stringify(rz))
  psql(`UPDATE ${T} SET urmatoarea_dupa = now() - interval '1 second' WHERE doc_id = 2;`)
  c2 = incearca(2)
  check('după backoff → continua cu token NOU', c2.actiune === 'continua' && c2.token !== vechi && rand(2).descarcari === 2, JSON.stringify(c2))
  psql(`UPDATE ${T} SET in_curs_pana = now() - interval '5 minutes' WHERE doc_id = 2;`)
  const vechi2 = c2.token
  c2 = incearca(2)
  check('lease expirat de mult (backoff deja trecut de la expirare) → abandonat (eșec 2) și continua imediat cu token nou', c2.actiune === 'continua' && c2.token !== vechi2 && rand(2).incercari_esuate === 2, JSON.stringify(c2))
  rz = rezultat(2, vechi2, 'esec')
  check('rezultatul încercării preluate (token vechi) NU atinge lease-ul noului token', rz.acceptat === false && rand(2).incercare_token === c2.token, JSON.stringify(rz))
  psql(`UPDATE ${T} SET in_curs_pana = now() - interval '1 minute' WHERE doc_id = 2;`)
  rz = rezultat(2, c2.token, 'progres')
  check('rezultat întârziat dar cu tokenul încă memorat (nepreluat) → acceptat; eșecurile se resetează', rz.acceptat === true && rand(2).incercari_esuate === 0 && rand(2).incercare_token === null, JSON.stringify(rz))
  // predat: contoarele neatinse
  psql(`UPDATE ${T} SET incercari_esuate = 2 WHERE doc_id = 2;`)
  c2 = incearca(2); rz = rezultat(2, c2.token, 'predat', { eroare: 'scan → AI' })
  g2 = rand(2)
  check('predat → lease eliberat, eșecurile NEATINSE (2), amprenta neatinsă', rz.acceptat === true && g2.incercari_esuate === 2 && g2.incercare_token === null && g2.ingerat_hash === null, JSON.stringify(g2))

  console.log('5b. J2 — scrierea documentului e ATOMICĂ cu tokenul (runda 3)')
  const docS = (id) => JSON.parse(val(`SELECT row_to_json(d) FROM (SELECT status_procesare, text_extras, pagini_procesate FROM ofertare_documente_atribuire WHERE id = ${id}) d`))
  const A = incearca(30)
  psql(`UPDATE ${T} SET in_curs_pana = now() - interval '20 minutes' WHERE doc_id = 30;`)   // A a depășit lease-ul
  const B = incearca(30)   // B preia (A = abandonat)
  rz = rezultat(30, B.token, 'succes', { hash: 'hb', doc: { status_procesare: 'procesat', text_extras: 'TEXT NOU (B)', pagini_procesate: 4 } })
  check('B (token activ) salvează documentul prin _rezultat: procesat, 4 pagini', rz.acceptat === true && docS(30).text_extras === 'TEXT NOU (B)' && docS(30).pagini_procesate === 4, JSON.stringify(rz))
  rz = rezultat(30, A.token, 'progres', { doc: { status_procesare: 'in_lucru', text_extras: 'TEXT VECHI (A)', pagini_procesate: 2 } })
  check('Jakarinos J2: A (token preluat) încearcă să salveze DUPĂ B → respins, documentul lui B NEATINS', rz.acceptat === false && docS(30).text_extras === 'TEXT NOU (B)' && docS(30).pagini_procesate === 4 && docS(30).status_procesare === 'procesat', JSON.stringify(docS(30)))
  rz = rezultat(30, A.token, 'esec', { eroare: 'x', doc: { status_procesare: 'eroare', eroare: 'x' } })
  check('eroarea încercării preluate nu marchează documentul „eroare”', rz.acceptat === false && docS(30).status_procesare === 'procesat')
  const C = incearca(31)
  rz = rezultat(31, C.token, 'marcaj', { doc: { status_procesare: 'in_lucru' } })
  check('marcaj (in_lucru) cu token activ → scris, lease prelungit, încercarea rămâne deschisă', rz.acceptat === true && docS(31).status_procesare === 'in_lucru' && rand(31).incercare_token === C.token, JSON.stringify(rz))
  rz = rezultat(31, C.token, 'progres', { doc: { id: 99 } })
  check('p_doc cu o coloană nepermisă (id) → eroare, nimic scris, lease intact', !!rz.eroare && /nepermise/.test(rz.eroare) && rand(31).incercare_token === C.token, JSON.stringify(rz))
  rz = rezultat(31, '11111111-1111-1111-1111-111111111111', 'marcaj', { doc: { status_procesare: 'eroare' } })
  check('marcaj cu token străin → respins, documentul neatins', rz.acceptat === false && docS(31).status_procesare === 'in_lucru')
  rezultat(31, C.token, 'predat')

  console.log('6. Plafoane, blocare, notificare, reactivare, scurtcircuit')
  let blocat = null
  for (let i = 1; i <= 5; i++) {
    psql(`UPDATE ${T} SET urmatoarea_dupa = NULL WHERE doc_id = 3;`)
    const c = incearca(3); if (c.actiune !== 'continua') { blocat = 'nu a continuat la ' + i + JSON.stringify(c); break }
    const x = rezultat(3, c.token, 'esec', { eroare: 'e' + i }); if (i === 5) blocat = x
  }
  const notif = Number(val(`SELECT count(*) FROM notifications WHERE type = 'ingest_blocat' AND message LIKE 'Documentul #3:%'`))
  check('5 eșecuri consecutive → blocat + notificare (1 owner)', blocat?.blocat === true && rand(3).blocat === true && notif === 1, JSON.stringify(blocat))
  check('document blocat → _incearca = blocat, fără lease, fără numărare', incearca(3).actiune === 'blocat' && rand(3).incercare_token === null && rand(3).descarcari === 5)
  const re = rest('authenticated', U.owner, 'SELECT public.ofertare_ingest_garda_reactiveaza(3);')
  check('owner: _reactiveaza → true (comis de test mai jos)', re.ok && re.out === 't', re.out)
  psql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${U.owner}","role":"authenticated"}', true); SELECT public.ofertare_ingest_garda_reactiveaza(3); COMMIT;`)
  check('după reactivare: deblocat, contoare 0, continua', rand(3).blocat === false && incearca(3).actiune === 'continua')
  psql(`UPDATE ${T} SET descarcari = 7 WHERE doc_id = 3;`)
  const rn = psql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${U.owner}","role":"authenticated"}', true) \\g /dev/null\nSELECT public.ofertare_ingest_garda_reactiveaza(3); COMMIT;`)
  check('owner: _reactiveaza pe un document NEblocat → false, contoarele neatinse', rn.ok && rn.out === 'f' && rand(3).descarcari === 7, rn.out)
  r = psql(`DO $t$ DECLARE c jsonb; x jsonb; BEGIN
    FOR i IN 1..80 LOOP c := public.ofertare_ingest_garda_incearca(4, NULL, NULL, 'plafon');
      IF c->>'actiune' <> 'continua' THEN RAISE EXCEPTION 'iteratia %: %', i, c; END IF;
      x := public.ofertare_ingest_garda_rezultat(4, (c->>'token')::uuid, 'progres', NULL, NULL, NULL, NULL, NULL); END LOOP; END $t$;
    SELECT public.ofertare_ingest_garda_incearca(4, NULL, NULL, 'plafon')->>'actiune';`)
  check('80 de descărcări (felii) permise, a 81-a → blocat (egress mărginit: plafon 80/document)', r.ok && r.out.split('\n').pop() === 'blocat' && rand(4).descarcari === 80 && rand(4).blocat === true, r.out)
  // scurtcircuit: document încheiat + aceeași mărime + etag → deja_ingerat, fără lease și fără numărare
  let c5 = incearca(5, 100, `'"e1"'`)
  rezultat(5, c5.token, 'succes', { hash: 'abc', size: 100, etag: '"e1"' })
  psql(`UPDATE ofertare_documente_atribuire SET status_procesare = 'procesat' WHERE id = 5;`)
  const d5 = incearca(5, 100, `'W/"e1"'`)
  check('document încheiat, aceeași mărime + etag (W/ normalizat) → deja_ingerat, fără descărcare numărată', d5.actiune === 'deja_ingerat' && rand(5).descarcari === 1 && rand(5).incercare_token === null, JSON.stringify(d5))
  check('același document, etag diferit → continua (fișier schimbat)', incearca(5, 100, `'"e2"'`).actiune === 'continua')
  check('amprenta memorată doar la succes (sha256/mărime/etag)', rand(5).ingerat_hash === 'abc' && Number(rand(5).ingerat_size) === 100)
  const bk = incearca(6); rezultat(6, bk.token, 'esec', { eroare: 'x' })
  const bk2 = incearca(6)
  check('după un eșec → asteapta (backoff 60 s)', bk2.actiune === 'asteapta' && Math.abs(new Date(bk2.pana_la) - Date.now() - 60_000) < 30_000, JSON.stringify(bk2))

  console.log('7. Revenirea (supabase/revenire/…_ROLLBACK.sql)')
  r = psql(RB)
  check('nearmată → refuz, nimic schimbat', !r.ok && /nearmată/.test(r.out) && obiecteGarda() > 0, r.out)
  r = revenire(RB, `SELECT set_config('gazpet.revenire_20260930k', 'SCOATE_GARDA_INGEST:1', true) \\g /dev/null`)
  check('armare cu txid greșit → refuz', !r.ok && /nearmată/.test(r.out) && obiecteGarda() > 0, r.out)
  psql(`ALTER ROLE postgres SET gazpet.revenire_20260930k = 'x';`)
  r = revenire(RB)
  check('armare PERSISTENTĂ prezentă (ALTER ROLE … SET) → refuz chiar dacă tranzacția e armată', !r.ok && /PERSISTENT/.test(r.out) && obiecteGarda() > 0, r.out)
  psql(`ALTER ROLE postgres RESET gazpet.revenire_20260930k;`)
  for (const [nume, prep, undo, cheie] of [
    ['o REGULĂ pe tabel (ar dispărea tăcut la DROP TABLE)', `CREATE RULE r_x AS ON UPDATE TO ${T} DO ALSO NOTIFY garda;`, `DROP RULE r_x ON ${T};`, 'reguli'],
    ['un comentariu pe tabel', `COMMENT ON TABLE ${T} IS 'x';`, `COMMENT ON TABLE ${T} IS NULL;`, 'comentarii'],
    ['un comentariu pe o funcție', `COMMENT ON FUNCTION public.ofertare_ingest_garda_notifica(bigint, text) IS 'x';`, `COMMENT ON FUNCTION public.ofertare_ingest_garda_notifica(bigint, text) IS NULL;`, 'comentarii'],
    ['statistici extinse', `CREATE STATISTICS st_x ON blocat, descarcari FROM ${T};`, `DROP STATISTICS st_x;`, 'statistici'],
    ['tabelul într-o publicație', `CREATE PUBLICATION pub_x FOR TABLE ${T};`, `DROP PUBLICATION pub_x;`, 'publicatii'],
    ['o politică în plus', `CREATE POLICY p_x ON ${T} FOR SELECT TO authenticated USING (false);`, `DROP POLICY p_x ON ${T};`, 'politici'],
    ['o vedere care depinde de tabel', `CREATE VIEW public.v_garda_x AS SELECT doc_id FROM ${T};`, `DROP VIEW public.v_garda_x;`, 'dependenti'],
  ]) {
    psql(prep); r = revenire(RB)
    check(`Jakarinos J5: ${nume} → revenirea REFUZĂ (amprenta: ${cheie}), nimic șters`, !r.ok && new RegExp(`nu e amprenta exactă a patch-ului \\(diferă: [^)]*${cheie}`).test(r.out) && obiecteGarda() > 0, r.out)
    psql(undo)
  }
  psql(`GRANT INSERT ON ${T} TO authenticated;`)
  r = revenire(RB)
  check('stare ≠ amprenta patch-ului (INSERT dat lui authenticated) → refuz, nimic șters', !r.ok && /nu e amprenta exactă.*acl/.test(r.out) && obiecteGarda() > 0, r.out)
  psql(`REVOKE INSERT ON ${T} FROM authenticated;`)
  psql(`CREATE OR REPLACE FUNCTION public.ofertare_ingest_garda_reactiveaza(p_doc_id bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN true; END $f$;`)
  r = revenire(RB)
  check('corpul unei funcții schimbat → refuz (md5 prosrc), nimic șters', !r.ok && /functii/.test(r.out) && obiecteGarda() > 0, r.out)
  // readucem corpul exact din migrare
  const corpReact = MIG.match(/CREATE FUNCTION public\.ofertare_ingest_garda_reactiveaza[\s\S]*?END \$f\$;/)[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
  psql(corpReact)
  r = revenire(RB + "\nSELECT 'comutator=' || coalesce(current_setting('gazpet.revenire_20260930k', true), '<null>');")
  check('armată + amprenta exactă → revenire reușită, 0 obiecte rămase, comutator dezarmat în tranzacție', r.ok && obiecteGarda() === 0 && r.out.split('\n').pop() === 'comutator=', r.out)
  r = revenire(RB)
  check('a doua revenire → refuz (starea nu mai e a patch-ului)', !r.ok && /nu e amprenta exactă/.test(r.out), r.out)
  r = livrare(MIG)
  check('reaplicare după revenire (F1 deja aplicat = ordinea B: F1 ÎNAINTE de gardă) → trece', r.ok, r.out)
  check('ACL identic în ordinea B (F1 înainte) cu ordinea A (F1 după)', stareAcl() === STARE_ACL, stareAcl())
  r = revenire(RB)
  check('revenire după F1 → trece; F1 rămâne intact (0 TRUNCATE pentru anon/authenticated în public)', r.ok && val(`SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND (has_table_privilege('anon', oid, 'TRUNCATE') OR has_table_privilege('authenticated', oid, 'TRUNCATE'))`) === '0', r.out)
} catch (e) {
  fail++; console.log('  ✘ excepție în harness:', e?.message ?? e)
} finally {
  try { srv('pg_ctl', ['-D', data, 'stop', '-m', 'fast']) } catch {}
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${ok}/${ok + fail} verificări trecute`)
process.exit(fail ? 1 : 0)
