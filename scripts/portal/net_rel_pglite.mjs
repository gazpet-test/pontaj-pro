// Portal E1 r21 (varianta c): proba pe PostgreSQL in proces (PGlite, PG17) a helperilor din 18a pentru obiectele pg_net,
// pe o schema FALSA in forma de pe productie (12.11.2026, porti_citire.sql B / C / G: proprietar supabase_admin, toate
// drepturile pentru PUBLIC). Nu se conecteaza la nimic. PGlite nu e dependenta proiectului:
//   npm install --no-save @electric-sql/pglite@0.3   apoi   node scripts/portal/net_rel_pglite.mjs
// Cod 0 = toate verificarile trec; 1 = o verificare a picat; 2 = PGlite lipseste.
// Ce dovedeste:
//  1. schema falsa reproduce EXACT md5-urile citite pe productie (expected scris aici din jurnalul citirii) => harness-ul
//     poate folosi lista de productie neschimbata;
//  2. paritate L19: md5(fn_portal_net_rel_amprenta) din 18a = md5_amprenta din sectiunea G a lui porti_citire.sql;
//  3. fn_portal_net_rel_acceptat: adevarat pe cele 3 obiecte; fals la drept in plus (tabel / coloana / secventa), coloana
//     noua, alt proprietar, RLS pornit, obiect nou in net; dupa stergerea coloanei noi, din nou adevarat;
//  4. fn_portal_teren_rel_drept: adevarat azi (prin PUBLIC); fals dupa REVOKE de la proprietar (obiect neaccesibil => poarta
//     nu-l mai priveste, ramane verde);
//  5. CE POATE teren la nivel SQL, azi: inserare in coada si citirea raspunsurilor (prin PUBLIC). Asta e motivul pentru care
//     teren nu trebuie sa aiba niciodata o cale de a rula SQL in net (E1_RAPORT.md r21);
//  6. verificarea PostgREST din poarta (expresia copiata din 18a): net in pgrst.db_schemas / db_extra_search_path = rosu.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let PGlite
try { ({ PGlite } = await import('@electric-sql/pglite')) } catch {
  console.log('PGLITE_LIPSA: npm install --no-save @electric-sql/pglite@0.3'); process.exit(2)
}
const aici = path.dirname(fileURLToPath(import.meta.url))
const citeste = f => readFileSync(path.join(aici, f), 'utf8').replace(/\r\n/g, '\n')
const M18 = citeste('../../supabase/migrations/20261118a_portal_teren_identitate.sql')
const CITIRE = citeste('porti_citire.sql')

// Productie, 12.11.2026 (porti_citire.sql sectiunea G, jurnalul coordonatorului).
const PROD = {
  'net._http_response': 'af629f9c5992f34ede3bc889d2db669c',
  'net.http_request_queue': 'e0e96a399d23c7eb05ca2216618e1b72',
  'net.http_request_queue_id_seq': 'd7e907e6bf5f93c94b754f45839161d1',
}

// Bucata din 18a: cele 4 functii noi (cu REVOKE-urile lor), exact textul livrat.
const a = M18.indexOf('CREATE FUNCTION public.fn_portal_teren_rel_drept(')
const b = M18.indexOf('CREATE TABLE public.portal_public_baseline')
if (a < 0 || b < 0 || !(a < b)) { console.log('PICA: bucata cu helperii nu se gaseste in 18a'); process.exit(1) }
const HELPERI = M18.slice(a, b)
// Conditia PostgREST din poarta, exact textul din 18a.
const pa = M18.indexOf('EXISTS (SELECT FROM pg_catalog.pg_db_role_setting')
const pb = M18.indexOf(" THEN\n    v:=array_append(v,'teren PostgREST expune net')")
if (pa < 0 || pb < 0 || !(pa < pb)) { console.log('PICA: conditia PostgREST nu se gaseste in 18a'); process.exit(1) }
const COND_PGRST = M18.slice(pa, pb)

const FIXTURE = `
CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE teren NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT teren TO authenticator;
CREATE SCHEMA net AUTHORIZATION supabase_admin;
SET ROLE supabase_admin;
CREATE TYPE net.http_method AS ENUM ('GET', 'POST', 'DELETE');
CREATE TABLE net.http_request_queue (id bigserial NOT NULL, method net.http_method NOT NULL, url text NOT NULL,
  headers jsonb, body bytea, timeout_milliseconds integer NOT NULL);
CREATE UNLOGGED TABLE net._http_response (id bigint, status_code integer, content_type text, headers jsonb, content text,
  timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
GRANT USAGE ON SCHEMA net TO PUBLIC;
GRANT ALL ON net.http_request_queue, net._http_response TO PUBLIC;
GRANT ALL ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC;
RESET ROLE;
-- sectiunea I din porti_citire.sql citeste cron.job (fara pg_cron: tabel minimal, gol)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, command text NOT NULL, username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true, jobname text);
`

let esecuri = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'PICA ') + msg); if (!cond) esecuri++ }
const db = await PGlite.create()
await db.exec(FIXTURE)

// 1. porti_citire.sql pe schema falsa: G = md5-urile de productie.
let rez
try { rez = await db.exec(CITIRE) } catch (e) { console.log(`PICA porti_citire.sql: ${e.message}`); process.exit(1) }
const g = {}
for (const r of rez) for (const row of r.rows || []) if (row && row.sectiune === 'G_amprenta_net') g[row.relatie] = row.md5_amprenta
ok(JSON.stringify(g) === JSON.stringify(PROD), `G pe schema falsa = productie: ${JSON.stringify(g)}`)
const mT = []
for (const r of rez) for (const row of r.rows || []) if (row && row.sectiune === 'M_teren_executa') mT.push(row)
ok(mT.length === 0, `M: pe schema falsa nicio functie executabila prin PUBLIC (${mT.length})`)

// 2. helperii din 18a + paritatea cu G.
await db.exec(HELPERI)
const q = async (sql) => (await db.query(sql)).rows
const amp = async () => Object.fromEntries((await q(`SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS k,
  md5(public.fn_portal_net_rel_amprenta(c.oid)) AS v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='net' AND c.relkind IN ('r','S')`)).map(r => [r.k, r.v]).sort())
ok(JSON.stringify(await amp()) === JSON.stringify(g), 'paritate L19: md5(fn_portal_net_rel_amprenta) = G din porti_citire.sql, pe fiecare obiect')
const stare = async () => Object.fromEntries((await q(`SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS k,
  public.fn_portal_net_rel_acceptat(c.oid) AS acc, public.fn_portal_teren_rel_drept(c.oid) AS drept
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='net' AND c.relkind IN ('r','p','v','m','f','S')`))
  .map(r => [r.k, `${r.acc ? 'acceptat' : 'RESPINS'}/${r.drept ? 'accesibil' : 'neaccesibil'}`]).sort())
const s0 = await stare()
ok(Object.keys(PROD).every(k => s0[k] === 'acceptat/accesibil') && Object.keys(s0).length === 3, `forma productiei: ${JSON.stringify(s0)}`)
ok((await q(`SELECT public.fn_portal_net_rel_acceptat(0) AS x`))[0].x === false, 'oid inexistent = fals (fail-closed)')
ok((await q(`SELECT public.fn_portal_net_rel_acceptat('pg_catalog.pg_class'::regclass) AS x`))[0].x === false, 'obiect din afara net = fals')

// 3. mutantii, fiecare intr-o tranzactie anulata; asteptat: obiectul tinta RESPINS (poarta rosie), restul neschimbate.
const mutanti = [
  ['drept in plus pe coada (anon SELECT)', 'SET ROLE supabase_admin; GRANT SELECT ON net.http_request_queue TO anon;', 'net.http_request_queue', 'RESPINS/accesibil'],
  ['drept pe o coloana a cozii', 'SET ROLE supabase_admin; GRANT SELECT (url) ON net.http_request_queue TO anon;', 'net.http_request_queue', 'RESPINS/accesibil'],
  ['coloana noua pe _http_response', 'SET ROLE supabase_admin; ALTER TABLE net._http_response ADD COLUMN portal_mutant text;', 'net._http_response', 'RESPINS/accesibil'],
  ['alt proprietar pe _http_response', 'ALTER TABLE net._http_response OWNER TO anon;', 'net._http_response', 'RESPINS/accesibil'],
  ['RLS pornit pe coada', 'SET ROLE supabase_admin; ALTER TABLE net.http_request_queue ENABLE ROW LEVEL SECURITY;', 'net.http_request_queue', 'RESPINS/accesibil'],
  ['drept in plus pe secventa', 'SET ROLE supabase_admin; GRANT USAGE ON SEQUENCE net.http_request_queue_id_seq TO anon;', 'net.http_request_queue_id_seq', 'RESPINS/accesibil'],
  ['al patrulea obiect in net (drept PUBLIC)', 'SET ROLE supabase_admin; CREATE TABLE net.portal_mutant (id int); GRANT SELECT ON net.portal_mutant TO PUBLIC;', 'net.portal_mutant', 'RESPINS/accesibil'],
  ['tip schimbat pe o coloana (text -> varchar)', 'SET ROLE supabase_admin; ALTER TABLE net._http_response ALTER COLUMN error_msg TYPE varchar;', 'net._http_response', 'RESPINS/accesibil'],
  ['PUBLIC retras de proprietar (legitim: mai putin acces)', 'SET ROLE supabase_admin; REVOKE ALL ON net.http_request_queue FROM PUBLIC;', 'net.http_request_queue', 'RESPINS/neaccesibil'],
]
for (const [nume, sql, tinta, asteptat] of mutanti) {
  await db.exec('BEGIN;' + sql + 'RESET ROLE;')
  const s = await stare()
  await db.exec('ROLLBACK;')
  const restul = Object.entries(s0).every(([k, v]) => k === tinta || s[k] === v)
  ok(s[tinta] === asteptat && restul, `mutant ${nume}: ${tinta} = ${s[tinta]} (asteptat ${asteptat}), restul neschimbat: ${restul}`)
}
ok(JSON.stringify(await stare()) === JSON.stringify(s0), 'dupa mutanti: starea initiala (ROLLBACK)')
await db.exec('BEGIN; SET ROLE supabase_admin; ALTER TABLE net._http_response ADD COLUMN portal_mutant text; ALTER TABLE net._http_response DROP COLUMN portal_mutant; RESET ROLE;')
const sDrop = await stare()
await db.exec('ROLLBACK;')
ok(sDrop['net._http_response'] === 'acceptat/accesibil', `coloana adaugata apoi stearsa: ${sDrop['net._http_response']} (coloanele sterse nu intra in amprenta)`)

// 4. Ce poate teren la nivel SQL azi (prin PUBLIC), daca ar avea o cale de a rula SQL: scrie in coada, citeste raspunsurile.
let er1 = '', er2 = '', idNou = null
await db.exec('BEGIN; SET LOCAL ROLE teren;')
try { idNou = (await q(`INSERT INTO net.http_request_queue (method, url, timeout_milliseconds)
  VALUES ('GET', 'https://exemplu.invalid/teren', 1000) RETURNING id`))[0]?.id } catch (e) { er1 = String(e.message || e) }
await db.exec('ROLLBACK;')
await db.exec('BEGIN; SET LOCAL ROLE teren;')
try { await q('SELECT count(*) AS n FROM net._http_response') } catch (e) { er2 = String(e.message || e) }
await db.exec('ROLLBACK;')
ok(er1 === '' && idNou != null && er2 === '', `teren la nivel SQL: insereaza in coada (${er1 || 'id ' + idNou}) si citeste raspunsurile (${er2 || 'da'}) => singura protectie e ca teren nu are cale de SQL in net`)
await db.exec('BEGIN; SET ROLE supabase_admin; REVOKE ALL ON net.http_request_queue, net._http_response FROM PUBLIC; REVOKE ALL ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC; RESET ROLE; SET LOCAL ROLE teren;')
let er3 = ''
try { await q(`INSERT INTO net.http_request_queue (method, url, timeout_milliseconds) VALUES ('GET', 'https://exemplu.invalid/x', 1) RETURNING id`) } catch (e) { er3 = String(e.message || e) }
await db.exec('ROLLBACK;')
ok(/permission denied/.test(er3), `dupa REVOKE de la proprietar (cererea catre suport): teren nu mai scrie in coada (${er3})`)

// 5. Conditia PostgREST din poarta (text din 18a).
const pgrst = async (setari) => {
  await db.exec('BEGIN;' + setari)
  const x = (await q(`SELECT ${COND_PGRST} AS x`))[0].x
  await db.exec('ROLLBACK;')
  return x
}
ok(await pgrst('') === false, 'PostgREST: fara setari in baza = verde')
ok(await pgrst("ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public';") === false, 'PostgREST: public, graphql_public = verde')
ok(await pgrst("ALTER ROLE authenticator SET pgrst.db_schemas = 'public, net';") === true, 'PostgREST: db_schemas cu net = rosu')
ok(await pgrst("ALTER ROLE authenticator SET pgrst.db_extra_search_path = 'public,extensions,\"net\"';") === true, 'PostgREST: db_extra_search_path cu "net" = rosu')
ok(await pgrst("ALTER ROLE authenticator SET pgrst.db_schemas = 'public, network';") === false, 'PostgREST: network (alt nume) = verde (fara potrivire pe subsir)')

await db.close()
console.log(esecuri ? `NET_REL_PGLITE: ${esecuri} verificari picate` : 'NET_REL_PGLITE: OK')
process.exit(esecuri ? 1 : 0)
