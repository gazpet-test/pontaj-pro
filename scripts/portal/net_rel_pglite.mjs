// Portal E1 r21 (varianta c) + r22: proba pe PostgreSQL in proces (PGlite, PG17) a helperilor din 18a pentru obiectele
// pg_net, pe o schema FALSA in forma de pe productie (porti_citire.sql B / C / G: proprietar supabase_admin, toate
// drepturile pentru PUBLIC). Nu se conecteaza la nimic. PGlite nu e dependenta proiectului:
//   npm install --no-save @electric-sql/pglite@0.3   apoi   node scripts/portal/net_rel_pglite.mjs
// Cod 0 = toate verificarile trec; 1 = o verificare a picat; 2 = PGlite lipseste.
// Ce dovedeste:
//  1. r22: amprenta s-a schimbat fata de r21 (md5-urile r21 de pe productie nu mai ies pe nicio forma) si lista din 18a e
//     DE_COMPLETAT => cu helperii EXACT din 18a, toate cele 3 obiecte sunt RESPINSE (necompletat = refuz);
//  2. paritate L19: md5(fn_portal_net_rel_amprenta) din 18a = md5_amprenta din sectiunea G a lui porti_citire.sql;
//  3. cu lista completata din G (ce face net_rel_completeaza.py pe productie): fn_portal_net_rel_acceptat adevarat pe cele
//     3 obiecte; fals la: drept in plus (tabel / coloana / secventa), coloana noua, tip schimbat, alt proprietar, RLS,
//     obiect nou in net, si (r22, Jakarinos r21 P1) TRIGGER nou, POLITICA noua, DEFAULT schimbat / nou, REGULA noua, INDEX
//     nou, CHECK nou, secventa fara proprietar (OWNED BY NONE) sau cu alt pas; cu un trigger revizuit: corpul functiei
//     triggerului schimbat sau triggerul dezactivat = RESPINS. Valoarea curenta a secventei (setval) NU e in amprenta;
//  4. fn_portal_teren_rel_drept: adevarat azi (prin PUBLIC); fals dupa REVOKE de la proprietar (poarta ramane verde);
//  5. CE POATE teren la nivel SQL, azi: inserare in coada si citirea raspunsurilor (prin PUBLIC);
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

// Productie, 12.11.2026, amprenta r21 (fara triggere / politici / DEFAULT-uri): nu mai trebuie sa iasa.
const R21_VECHI = ['af629f9c5992f34ede3bc889d2db669c', 'e0e96a399d23c7eb05ca2216618e1b72', 'd7e907e6bf5f93c94b754f45839161d1']
const CHEI = ['net._http_response', 'net.http_request_queue', 'net.http_request_queue_id_seq']
const LISTA_GOALA = '{"net._http_response":"DE_COMPLETAT","net.http_request_queue":"DE_COMPLETAT","net.http_request_queue_id_seq":"DE_COMPLETAT"}'

// Bucata din 18a: helperii (cu REVOKE-urile lor), exact textul livrat.
const a = M18.indexOf('CREATE FUNCTION public.fn_portal_teren_rel_drept(')
const b = M18.indexOf('CREATE TABLE public.portal_public_baseline')
if (a < 0 || b < 0 || !(a < b)) { console.log('PICA: bucata cu helperii nu se gaseste in 18a'); process.exit(1) }
const HELPERI_18A = M18.slice(a, b)
// r24: 18a poate fi NECOMPLETAT (DE_COMPLETAT) sau COMPLETAT din productie (md5). Literalul se citeste in forma CURENTA
// (exact o aparitie, in fn_portal_net_rel_aprobat); pasul 1 (necompletat = refuz) ruleaza pe aceiasi helperi, cu literalul
// adus in memorie la DE_COMPLETAT (fisierul nu se schimba). Daca 18a e completat, valorile trebuie sa fie md5 si nu r21.
const LISTE = [...HELPERI_18A.matchAll(/SELECT '(\{[^']*\})'::jsonb;/g)].map(m => m[1])
if (LISTE.length !== 1 || HELPERI_18A.split(LISTE[0]).length !== 2) { console.log('PICA: literalul listei pg_net nu apare exact o data in helperi'); process.exit(1) }
const LISTA_18A = LISTE[0]
let VALORI_18A
try { VALORI_18A = JSON.parse(LISTA_18A) } catch { console.log('PICA: literalul listei pg_net nu e JSON'); process.exit(1) }
const STARE_18A = LISTA_18A === LISTA_GOALA ? 'necompletat'
  : (JSON.stringify(Object.keys(VALORI_18A)) === JSON.stringify(CHEI) && Object.values(VALORI_18A).every(v => /^[0-9a-f]{32}$/.test(v))
     && LISTA_18A === '{' + CHEI.map(k => `"${k}":"${VALORI_18A[k]}"`).join(',') + '}') ? 'completat' : null
if (!STARE_18A) { console.log(`PICA: lista pg_net din 18a nu e nici DE_COMPLETAT, nici completata (md5): ${LISTA_18A}`); process.exit(1) }
const HELPERI = HELPERI_18A.replace(LISTA_18A, LISTA_GOALA)
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
-- schema separata pentru functiile mutantilor (teren nu o vede)
CREATE SCHEMA portal_mut;
CREATE FUNCTION portal_mut.tg() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE FUNCTION portal_mut.verif(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT true $f$;
-- sectiunea I din porti_citire.sql citeste cron.job (fara pg_cron: tabel minimal, gol)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, command text NOT NULL, username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true, jobname text);
`

let esecuri = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'PICA ') + msg); if (!cond) esecuri++ }
const db = await PGlite.create()
await db.exec(FIXTURE)
const q = async (sql) => (await db.query(sql)).rows

// G din porti_citire.sql (sursa valorilor pe care le lipeste net_rel_completeaza.py).
const citesteG = async () => {
  const rez = await db.exec(CITIRE)
  const g = {}
  for (const r of rez) for (const row of r.rows || []) if (row && row.sectiune === 'G_amprenta_net') g[row.relatie] = row.md5_amprenta
  return g
}
let g
try { g = await citesteG() } catch (e) { console.log(`PICA porti_citire.sql: ${e.message}`); process.exit(1) }
ok(JSON.stringify(Object.keys(g).sort()) === JSON.stringify(CHEI) && Object.values(g).every(v => /^[0-9a-f]{32}$/.test(v)),
  `G pe schema falsa: cele 3 obiecte, md5 ${JSON.stringify(g)}`)
ok(Object.values(g).every(v => !R21_VECHI.includes(v)), 'r22: amprenta noua difera de cea din r21 (md5-urile r21 de pe productie nu mai ies)')
ok(STARE_18A === 'necompletat' || Object.values(VALORI_18A).every(v => !R21_VECHI.includes(v)),
  `r24: lista din 18a: ${STARE_18A}${STARE_18A === 'completat' ? ' (valori de productie, nicio valoare r21)' : ''}`)

// 1. Helperii EXACT din 18a (lista DE_COMPLETAT): toate cele 3 obiecte respinse.
await db.exec(HELPERI)
const stare = async () => Object.fromEntries((await q(`SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS k,
  public.fn_portal_net_rel_acceptat(c.oid) AS acc, public.fn_portal_teren_rel_drept(c.oid) AS drept
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='net' AND c.relkind IN ('r','p','v','m','f','S')`))
  .map(r => [r.k, `${r.acc ? 'acceptat' : 'RESPINS'}/${r.drept ? 'accesibil' : 'neaccesibil'}`]).sort())
const sGol = await stare()
ok(CHEI.every(k => sGol[k] === 'RESPINS/accesibil'), `lista DE_COMPLETAT (helperii din 18a${STARE_18A === 'completat' ? ', literalul adus in memorie la DE_COMPLETAT' : ''}): toate respinse (necompletat = refuz): ${JSON.stringify(sGol)}`)

// 2. paritatea L19 pe fiecare obiect.
const amp = async () => Object.fromEntries((await q(`SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS k,
  md5(public.fn_portal_net_rel_amprenta(c.oid)) AS v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='net' AND c.relkind IN ('r','S')`)).map(r => [r.k, r.v]).sort())
ok(JSON.stringify(await amp()) === JSON.stringify(g), 'paritate L19: md5(fn_portal_net_rel_amprenta) = G din porti_citire.sql, pe fiecare obiect')

// 3. Lista completata cu valorile G (ca net_rel_completeaza.py): aceeasi definitie, doar literalul schimbat.
const aprobat = async (lista) => {
  const json = '{' + CHEI.map(k => `"${k}":"${lista[k]}"`).join(',') + '}'
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_portal_net_rel_aprobat() RETURNS jsonb LANGUAGE sql IMMUTABLE
    SET search_path TO 'public','pg_temp' AS $netrel$ SELECT '${json}'::jsonb; $netrel$;`)
}
await aprobat(g)
const s0 = await stare()
ok(CHEI.every(k => s0[k] === 'acceptat/accesibil') && Object.keys(s0).length === 3, `lista completata: ${JSON.stringify(s0)}`)
ok((await q(`SELECT public.fn_portal_net_rel_acceptat(0) AS x`))[0].x === false, 'oid inexistent = fals (fail-closed)')
ok((await q(`SELECT public.fn_portal_net_rel_acceptat('pg_catalog.pg_class'::regclass) AS x`))[0].x === false, 'obiect din afara net = fals')

const Q = 'net.http_request_queue', R = 'net._http_response', S = 'net.http_request_queue_id_seq'
const ADM = 'SET ROLE supabase_admin; '
const mutanti = [
  ['drept in plus pe coada (anon SELECT)', ADM + 'GRANT SELECT ON net.http_request_queue TO anon;', Q, 'RESPINS/accesibil'],
  ['drept pe o coloana a cozii', ADM + 'GRANT SELECT (url) ON net.http_request_queue TO anon;', Q, 'RESPINS/accesibil'],
  ['coloana noua pe _http_response', ADM + 'ALTER TABLE net._http_response ADD COLUMN portal_mutant text;', R, 'RESPINS/accesibil'],
  ['alt proprietar pe _http_response', 'ALTER TABLE net._http_response OWNER TO anon;', R, 'RESPINS/accesibil'],
  ['RLS pornit pe coada', ADM + 'ALTER TABLE net.http_request_queue ENABLE ROW LEVEL SECURITY;', Q, 'RESPINS/accesibil'],
  ['drept in plus pe secventa', ADM + 'GRANT USAGE ON SEQUENCE net.http_request_queue_id_seq TO anon;', S, 'RESPINS/accesibil'],
  ['al patrulea obiect in net (drept PUBLIC)', ADM + 'CREATE TABLE net.portal_mutant (id int); GRANT SELECT ON net.portal_mutant TO PUBLIC;', 'net.portal_mutant', 'RESPINS/accesibil'],
  ['tip schimbat pe o coloana (text -> varchar)', ADM + 'ALTER TABLE net._http_response ALTER COLUMN error_msg TYPE varchar;', R, 'RESPINS/accesibil'],
  // r22 (Jakarinos r21 P1): schimbari de comportament fara schimbare de drepturi / coloane
  ['r22 TRIGGER nou pe coada', 'CREATE TRIGGER portal_mut_t BEFORE INSERT ON net.http_request_queue FOR EACH ROW EXECUTE FUNCTION portal_mut.tg();', Q, 'RESPINS/accesibil'],
  ['r22 POLITICA noua pe coada (RLS neschimbat)', 'CREATE POLICY portal_mut_p ON net.http_request_queue FOR SELECT USING (true);', Q, 'RESPINS/accesibil'],
  ['r22 DEFAULT schimbat pe _http_response.created', ADM + "ALTER TABLE net._http_response ALTER COLUMN created SET DEFAULT '2000-01-01'::timestamptz;", R, 'RESPINS/accesibil'],
  ['r22 DEFAULT nou pe coada (headers)', ADM + "ALTER TABLE net.http_request_queue ALTER COLUMN headers SET DEFAULT '{}'::jsonb;", Q, 'RESPINS/accesibil'],
  ['r22 REGULA noua pe coada', "CREATE RULE portal_mut_r AS ON INSERT TO net.http_request_queue DO ALSO NOTIFY portal_mut;", Q, 'RESPINS/accesibil'],
  ['r22 INDEX nou pe raspunsuri', 'CREATE INDEX portal_mut_i ON net._http_response (status_code);', R, 'RESPINS/accesibil'],
  ['r22 CHECK nou pe coada (cu functie)', 'ALTER TABLE net.http_request_queue ADD CONSTRAINT portal_mut_c CHECK (portal_mut.verif(url));', Q, 'RESPINS/accesibil'],
  ['r22 secventa fara proprietar (OWNED BY NONE)', ADM + 'ALTER SEQUENCE net.http_request_queue_id_seq OWNED BY NONE;', S, 'RESPINS/accesibil'],
  ['r22 secventa cu alt pas', ADM + 'ALTER SEQUENCE net.http_request_queue_id_seq INCREMENT BY 2;', S, 'RESPINS/accesibil'],
  ['r22 valoarea secventei (setval) NU e in amprenta (legitim)', "SELECT setval('net.http_request_queue_id_seq', 500);", S, 'acceptat/accesibil'],
  ['PUBLIC retras de proprietar (legitim: mai putin acces)', ADM + 'REVOKE ALL ON net.http_request_queue FROM PUBLIC;', Q, 'RESPINS/neaccesibil'],
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
ok(sDrop[R] === 'acceptat/accesibil', `coloana adaugata apoi stearsa: ${sDrop[R]} (coloanele sterse nu intra in amprenta)`)

// 3b. r22: un trigger REVIZUIT (in lista): corpul functiei lui schimbat sau triggerul dezactivat = RESPINS.
// (fara tranzactie exterioara: porti_citire.sql are BEGIN / ROLLBACK proprii; triggerul se sterge explicit la final)
await db.exec('CREATE TRIGGER portal_mut_t BEFORE INSERT ON net.http_request_queue FOR EACH ROW EXECUTE FUNCTION portal_mut.tg();')
const gT = await citesteG()
await aprobat(gT)
const sT = await stare()
await db.exec("CREATE OR REPLACE FUNCTION portal_mut.tg() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN NEW.url := 'https://alt.invalid'; RETURN NEW; END $f$;")
const sCorp = await stare()
await db.exec("CREATE OR REPLACE FUNCTION portal_mut.tg() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;")
const sRefacut = await stare()
await db.exec('ALTER TABLE net.http_request_queue DISABLE TRIGGER portal_mut_t;')
const sOff = await stare()
await db.exec('DROP TRIGGER portal_mut_t ON net.http_request_queue;')
await aprobat(g)
ok(gT[Q] !== g[Q] && sT[Q] === 'acceptat/accesibil', `trigger revizuit (lista recitita cu el): ${sT[Q]}`)
ok(sCorp[Q] === 'RESPINS/accesibil', `corpul functiei triggerului schimbat: ${sCorp[Q]}`)
ok(sRefacut[Q] === 'acceptat/accesibil', `corpul refacut: ${sRefacut[Q]}`)
ok(sOff[Q] === 'RESPINS/accesibil', `triggerul dezactivat: ${sOff[Q]}`)
ok(JSON.stringify(await stare()) === JSON.stringify(s0), 'dupa trigger: starea initiala (ROLLBACK + lista G)')

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
