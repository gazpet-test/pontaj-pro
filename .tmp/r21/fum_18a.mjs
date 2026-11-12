// TEST DE FUM LOCAL (nu se comite): 18a r21 pe PGlite (PG17, o sesiune), fixture-ul harness-ului, postgres NOSUPERUSER.
// node .tmp/r21/fum_18a.mjs   (din radacina worktree-ului, cu @electric-sql/pglite instalat --no-save)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const { PGlite } = await import('@electric-sql/pglite')
const ROOT = process.cwd()
const rd = f => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
let esec = 0
const ok = (c, m) => { console.log((c ? 'OK   ' : 'PICA ') + m); if (!c) esec++ }

const db = await PGlite.create()
const boot = rd('supabase/tests/portal_e1_prodlike_bootstrap.sql').replace(/\r\n/g, '\n')
  .replace('CREATE DATABASE portal_e1_test OWNER postgres;', '')
// superuserul de bootstrap al PGlite se numeste postgres: il redenumim, ca postgres sa fie rolul obisnuit din bootstrap
await db.exec('CREATE ROLE supabase_admin SUPERUSER LOGIN; SET SESSION AUTHORIZATION supabase_admin; ALTER ROLE postgres RENAME TO pglite_boot;')
await db.exec(boot)
await db.exec("ALTER SCHEMA public OWNER TO postgres; DO $d$ BEGIN EXECUTE format('ALTER DATABASE %I OWNER TO postgres', current_database()); END $d$;")
await db.exec(rd('supabase/tests/portal_e1_schelet.sql'))
await db.exec(rd('supabase/tests/portal_e1_1b_fixture.sql'))
await db.exec(`CREATE SCHEMA smoke_adm; GRANT USAGE ON SCHEMA smoke_adm TO postgres;
CREATE FUNCTION smoke_adm.x(t text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN EXECUTE t; END $f$;
REVOKE ALL ON FUNCTION smoke_adm.x(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION smoke_adm.x(text) TO postgres;`)
await db.exec('SET SESSION AUTHORIZATION postgres;')
const q = async s => (await db.query(s)).rows
ok((await q("SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname=current_user"))[0].rolsuper === false, 'postgres NOSUPERUSER')
const adm = async t => db.query('SELECT smoke_adm.x($1)', [t])

// amprentele fixture-ului + copia 18a (prepare_fixture.py, ca harness-ul)
const amp = (await q(`SELECT jsonb_build_object(
  'public',(SELECT jsonb_object_agg('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')',md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~ '^portal_fixture_public_[0-9]{2}$'),
  'net',(SELECT jsonb_object_agg('net.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')',md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='net')) AS j`))[0].j
// faza 1: amprentele (deterministe) -> .tmp/r21/fum/amprente.json; copia 18a o face prepare_fixture.py (rulat din bash)
const T = path.join(ROOT, '.tmp/r21/fum'); mkdirSync(T, { recursive: true })
const MIG = path.join(T, '18a.sql')
if (process.argv[2] === 'faza1') {
  writeFileSync(path.join(T, 'amprente.json'), JSON.stringify(amp))
  const anc = (await db.exec(rd('scripts/portal/ancore_1b.sql'))).at(-1).rows[0]
  writeFileSync(path.join(T, 'ancore.json'), String(Object.values(anc)[0] && JSON.stringify(Object.values(anc)[0])))
  console.log('FAZA1_OK'); process.exit(0)
}
const MIG19 = path.join(T, '19a.sql')

async function livreaza(fis, nume, inainte = '') {
  const note = []
  await db.exec('SET transaction_timeout = 2000;')
  await db.exec('BEGIN;')
  await db.exec(`SELECT set_config('gazpet.livrare_migrare','${nume}:'||txid_current(),true), set_config('gazpet.plafon_tranzactie','2000:'||txid_current(),true);` + inainte)
  try {
    await db.exec(readFileSync(fis, 'utf8'), { onNotice: n => note.push(String(n.message)) })
    await db.exec('COMMIT;'); await db.exec('RESET transaction_timeout;')
    return { ok: true, note }
  } catch (e) {
    await db.exec('ROLLBACK;'); await db.exec('RESET transaction_timeout;')
    return { ok: false, err: String(e.message), note }
  }
}
const neaplicat = async () => (await q("SELECT to_regclass('public.conturi_tip') IS NULL AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname='teren') AS x"))[0].x

// 1. preconditia pg_net: drept in plus / obiect nou = refuz care le numeste
await adm('GRANT SELECT ON net.http_request_queue TO anon')
let r = await livreaza(MIG, '20261118a_portal_teren_identitate')
ok(!r.ok && /PORTAL_NET_REL_UNREVIEWED_OR_CHANGED: net\.http_request_queue$/.test(r.err) && await neaplicat(), `drept in plus pe coada inainte de apply: ${r.err}`)
await adm('REVOKE SELECT ON net.http_request_queue FROM anon')
await adm('CREATE TABLE net.portal_mutant (id integer); GRANT SELECT ON net.portal_mutant TO PUBLIC')
r = await livreaza(MIG, '20261118a_portal_teren_identitate')
ok(!r.ok && /PORTAL_NET_REL_UNREVIEWED_OR_CHANGED: net\.portal_mutant$/.test(r.err) && await neaplicat(), `obiect nou in net: ${r.err}`)
await adm('DROP TABLE net.portal_mutant')

// 2. postconditia cu lista (o poarta stricata intentionat, ca in harness)
await q('CREATE TABLE public.diag_poarta_fixture(id integer)'); await q('GRANT SELECT ON public.diag_poarta_fixture TO PUBLIC')
await q('CREATE SEQUENCE public.diag_poarta_fixture_seq'); await q('GRANT USAGE ON SEQUENCE public.diag_poarta_fixture_seq TO PUBLIC')
r = await livreaza(MIG, '20261118a_portal_teren_identitate')
ok(!r.ok && r.err === 'PORTAL_POSTCONDITION_FAILED: 2 porti: relatie:diag_poarta_fixture; secventa:diag_poarta_fixture_seq' && await neaplicat(), `postconditia cu lista: ${r.err}`)
await q('DROP TABLE public.diag_poarta_fixture'); await q('DROP SEQUENCE public.diag_poarta_fixture_seq')

// 3. aplicarea
r = await livreaza(MIG, '20261118a_portal_teren_identitate')
ok(r.ok, `apply 18a: ${r.ok ? 'OK' : r.err}`)
ok(r.note.some(n => /^PORTAL_NET_REL: 3 obiecte pg_net accesibile prin PUBLIC, toate cu amprenta revizuita \(3 in lista\)$/.test(n)), `NOTICE: ${r.note.find(n => n.startsWith('PORTAL_NET_REL')) || '(lipsa)'}`)
const poarta = async () => (await q('SELECT public.fn_portal_porti_lipsa() AS v'))[0].v
ok(JSON.stringify(await poarta()) === '[]', `poarta dupa apply: ${JSON.stringify(await poarta())}`)
ok((await q("SELECT string_agg(tip||':'||n,',' ORDER BY tip) AS s FROM (SELECT tip,count(*) n FROM public.conturi_tip GROUP BY tip) x"))[0].s === 'erp:1,neaprobat:2,teren:3', 'inventar erp:1,neaprobat:2,teren:3')

// 4. mutantii dupa apply
const cazuri = [
  ['GRANT SELECT ON net.http_request_queue TO anon', 'REVOKE SELECT ON net.http_request_queue FROM anon', 'relatie:http_request_queue'],
  ['GRANT USAGE ON SEQUENCE net.http_request_queue_id_seq TO anon', 'REVOKE USAGE ON SEQUENCE net.http_request_queue_id_seq FROM anon', 'secventa:http_request_queue_id_seq'],
  ['ALTER TABLE net._http_response ADD COLUMN portal_mutant text', 'ALTER TABLE net._http_response DROP COLUMN portal_mutant', 'relatie:_http_response'],
  ['ALTER TABLE net._http_response OWNER TO postgres', 'ALTER TABLE net._http_response OWNER TO supabase_admin', 'relatie:_http_response'],
  ['CREATE TABLE net.portal_mutant (id integer); GRANT SELECT ON net.portal_mutant TO PUBLIC', 'DROP TABLE net.portal_mutant', 'relatie:portal_mutant'],
  ["ALTER ROLE authenticator SET pgrst.db_schemas = 'public, net'", 'ALTER ROLE authenticator RESET pgrst.db_schemas', 'teren PostgREST expune net'],
]
for (const [strica, repara, asteptat] of cazuri) {
  await adm(strica); const v = await poarta(); await adm(repara); const dupa = await poarta()
  ok(JSON.stringify(v) === JSON.stringify([asteptat]) && dupa.length === 0, `${strica} => ${JSON.stringify(v)}; reparat => ${JSON.stringify(dupa)}`)
}
await adm('REVOKE ALL ON net.http_request_queue, net._http_response FROM PUBLIC; REVOKE ALL ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC')
const v1 = await poarta()
await adm('GRANT ALL ON net.http_request_queue, net._http_response TO PUBLIC; GRANT ALL ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC')
ok(v1.length === 0 && (await poarta()).length === 0, `PUBLIC retras => ${JSON.stringify(v1)}; refacut => ${JSON.stringify(await poarta())}`)

// 5. testele 1a (ca harness-ul: postgres primeste SET pe teren)
await q('GRANT teren TO postgres WITH INHERIT FALSE, SET TRUE')
let t1 = ''
try { await db.exec(rd('supabase/tests/portal_e1_1a.test.sql'), { onNotice: n => { if (/PORTAL_E1_1A_TEST_END/.test(n.message)) t1 = 'END' } }) } catch (e) { t1 = 'EROARE ' + e.message }
try { await db.exec('ROLLBACK;') } catch {}
ok(t1 === 'END' || t1 === '', `portal_e1_1a.test.sql: ${t1 || '(fara marcaj in NOTICE)'}`)

// 5b. 19a (copia cu ancorele clusterului), poarta 1b, testele 1b, revenirea 19a refuzata cu mesaj, apoi reala
r = await livreaza(MIG19, '20261119a_portal_teren_provisioning')
ok(r.ok, `apply 19a: ${r.ok ? 'OK' : r.err}`)
if (r.ok) {
  ok(JSON.stringify((await q('SELECT public.fn_portal_porti_lipsa_1b() AS v'))[0].v) === '[]', 'poarta 1b dupa apply: verde')
  const ddl = (await q("SELECT public.fn_portal_1b_snapshot()->'ddl' AS d"))[0].d
  const fn = ddl.filter(x => x[0] === 'function')
  ok(['public.fn_portal_net_rel_aprobat()', 'public.fn_portal_net_rel_amprenta(oid)', 'public.fn_portal_net_rel_acceptat(oid)', 'public.fn_portal_teren_rel_drept(oid)']
    .every(s => fn.some(x => x[1] === s && typeof x[2] === 'string' && x[2].includes('CREATE OR REPLACE FUNCTION'))), `amprenta 1b include cei 4 helperi noi, cu definitie (${fn.length} functii)`)
  let t2 = ''
  try { await db.exec(rd('supabase/tests/portal_e1_1b.test.sql')) } catch (e) { t2 = 'EROARE ' + e.message }
  try { await db.exec('ROLLBACK;') } catch {}
  ok(t2 === '', `portal_e1_1b.test.sql: ${t2 || 'rulat complet'}`)
  const REV19 = path.join(ROOT, 'supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql')
  await adm('GRANT SELECT ON net.http_request_queue TO anon')
  r = await livreaza(REV19, '20261119a_portal_teren_provisioning_ROLLBACK')
  ok(!r.ok && r.err === 'PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG: amprenta identica; porti: relatie:http_request_queue', `revenire 19a cu poarta rosie: ${r.err}`)
  await adm('REVOKE SELECT ON net.http_request_queue FROM anon')
  r = await livreaza(REV19, '20261119a_portal_teren_provisioning_ROLLBACK')
  ok(r.ok, `revenire 19a: ${r.ok ? 'OK' : r.err}`)
}

// 6. revenirea 18a refuzata cu poarta rosie (mesajul spune ce), apoi revenirea reala
const REV = path.join(ROOT, 'supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql')
await adm('GRANT SELECT ON net.http_request_queue TO anon')
r = await livreaza(REV, '20261118a_portal_teren_identitate_ROLLBACK', `SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true);`)
ok(!r.ok && r.err === 'PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG: amprenta identica; porti: relatie:http_request_queue', `revenire cu poarta rosie: ${r.err}`)
await adm('REVOKE SELECT ON net.http_request_queue FROM anon')
r = await livreaza(REV, '20261118a_portal_teren_identitate_ROLLBACK', `SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true);`)
ok(r.ok, `revenire 18a: ${r.ok ? 'OK' : r.err}`)
ok(Number((await q(`SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
  ('fn_portal_net_rel_aprobat','fn_portal_net_rel_amprenta','fn_portal_net_rel_acceptat','fn_portal_teren_rel_drept','fn_portal_porti_lipsa')`))[0].n) === 0
  && await neaplicat(), 'dupa revenire: helperii si rolul teren sterse')
await db.close()
console.log(esec ? `FUM_18A: ${esec} picate` : 'FUM_18A: OK')
process.exit(esec ? 1 : 0)
