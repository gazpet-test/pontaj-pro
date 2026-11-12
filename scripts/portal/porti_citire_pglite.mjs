// Portal E1 r20: ruleaza scripts/portal/porti_citire.sql pe un PostgreSQL in proces (PGlite) cu o schema FALSA in forma
// Supabase (net cu drepturile vazute pe productie 12.11, cron.job, webhook, functie DEFINER care apeleaza pg_net) si
// verifica fiecare sectiune. Nu se conecteaza la nimic. PGlite nu e dependenta proiectului:
//   npm install --no-save @electric-sql/pglite@0.3   apoi   node scripts/portal/porti_citire_pglite.mjs
// Cod 0 = toate verificarile trec; 1 = o verificare a picat; 2 = PGlite lipseste.
// Controale (L25): forma veche a interogarii A (r19) trebuie sa pice cu eroarea vazuta pe productie; dupa un REVOKE
// dat de proprietar, B / C / G devin goale; un REVOKE dat de un rol care nu e proprietarul nu schimba nimic (WARNING);
// fara drepturi pe coada, un apel http_post INVOKER al unui rol obisnuit pica (asta strica varianta a fara GRANT-uri).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let PGlite
try { ({ PGlite } = await import('@electric-sql/pglite')) } catch {
  console.log('PGLITE_LIPSA: npm install --no-save @electric-sql/pglite@0.3'); process.exit(2)
}
const aici = path.dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(path.join(aici, 'porti_citire.sql'), 'utf8').replace(/\r\n/g, '\n')

// Schema falsa. Proprietarul net = supabase_admin; drepturile pe tabele = ce a aratat B pe productie (ALL pentru PUBLIC,
// acordat de supabase_admin). http_post e INVOKER si scrie in coada (ca pg_net >= 0.12, fara SECURITY DEFINER).
const FIXTURE = `
CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE rol_cron LOGIN NOSUPERUSER;  -- stand-in pentru postgres din Supabase (care nu e superuser)
GRANT anon, authenticated, service_role TO authenticator;
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public';
CREATE SCHEMA net AUTHORIZATION supabase_admin;
SET ROLE supabase_admin;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, method text NOT NULL, url text NOT NULL, headers jsonb,
  body bytea, timeout_milliseconds integer NOT NULL);
CREATE UNLOGGED TABLE net._http_response (id bigint, status_code integer, content_type text, headers jsonb, content text,
  timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint
  LANGUAGE sql AS $f$ INSERT INTO net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  VALUES ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds) RETURNING id $f$;
GRANT USAGE ON SCHEMA net TO PUBLIC;
GRANT ALL ON net.http_request_queue, net._http_response TO PUBLIC;
GRANT ALL ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC;
RESET ROLE;
-- public: indexul care a rupt interogarea C pe productie + o secventa cu drept pentru PUBLIC (trebuie listata)
CREATE TABLE public.executie_proiecte (id serial PRIMARY KEY, eticheta_gmail text);
CREATE UNIQUE INDEX executie_proiecte_eticheta_gmail_uq ON public.executie_proiecte (eticheta_gmail);
CREATE SEQUENCE public.diag_seq; GRANT USAGE ON SEQUENCE public.diag_seq TO PUBLIC;
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE FUNCTION public.iot_cron_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
  AS $f$ BEGIN PERFORM net.http_post(url := 'https://exemplu.invalid/f'); END $f$;
REVOKE ALL ON FUNCTION public.iot_cron_tick() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.iot_cron_tick() TO service_role;
CREATE FUNCTION public.fn_trg_trimite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net','pg_temp'
  AS $f$ BEGIN PERFORM net.http_post(url := 'https://exemplu.invalid/g'); RETURN NEW; END $f$;
CREATE TRIGGER trg_trimite AFTER INSERT ON public.executie_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_trg_trimite();
CREATE SCHEMA supabase_functions;
CREATE FUNCTION supabase_functions.http_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER webhook_test AFTER UPDATE ON public.executie_proiecte FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request();
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, username text NOT NULL
  DEFAULT current_user, active boolean NOT NULL DEFAULT true, jobname text);
INSERT INTO cron.job (schedule, command, jobname) VALUES
  ('*/5 * * * *', 'SELECT net.http_post(url := ''https://exemplu.invalid/h'', headers := jsonb_build_object(''x'', (SELECT 1)))', 'job_http'),
  ('* * * * *', 'SELECT public.iot_cron_tick()', 'job_tick'),
  ('0 3 * * *', 'SELECT count(*) FROM net._http_response', 'job_citire');
`

// Forma veche (r19) a interogarii A: trebuie sa pice exact ca pe productie.
const A_VECHE = `SELECT n.nspname, has_schema_privilege('public', n.oid, 'CREATE') AS create_public
  FROM pg_namespace n
 WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
 ORDER BY 1 COLLATE "C";`

let esecuri = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'PICA ') + msg); if (!cond) esecuri++ }

async function ruleaza(db) {
  let rez
  try { rez = await db.exec(SQL) } catch (er) {
    console.log(`PICA scriptul porti_citire.sql: ${er.message} ${er.position ? '(pozitia ' + er.position + ')' : ''}`)
    process.exit(1)
  }
  const pe = {}
  for (const r of rez) {
    for (const row of r.rows || []) {
      if (row && typeof row.sectiune === 'string') (pe[row.sectiune] ||= []).push(row)
    }
  }
  return { rez, pe }
}

const db = await PGlite.create()
await db.exec(FIXTURE)

// Control: forma veche a lui A pica.
let eroareA = ''
try { await db.exec(A_VECHE) } catch (e) { eroareA = String(e.message || e) }
ok(/collations are not supported by type integer/.test(eroareA), `forma veche A (r19) pica la fel ca pe productie: ${eroareA || '(nu a picat)'}`)

// 1. Scriptul pe schema cu drepturile de pe productie.
const { rez, pe } = await ruleaza(db)
const nume = (s, k) => (pe[s] || []).map(r => r[k]).join(',')
ok(rez.length > 0 && (await db.query('SELECT 1 AS x')).rows[0].x === 1, 'scriptul ruleaza cap-coada (ROLLBACK, sesiunea ramane utilizabila)')
ok(nume('A_scheme', 'schema') === 'information_schema,net,public', `A: scheme = ${nume('A_scheme', 'schema')}`)
ok((pe.A_scheme || []).every(r => r.create_public === false), 'A: create_public = false peste tot')
ok(nume('B_relatii', 'relatie') === '_http_response,http_request_queue', `B: relatii = ${nume('B_relatii', 'relatie')}`)
ok((pe.B_relatii || []).every(r => r.schema === 'net' && r.proprietar === 'supabase_admin' && r.drept_scriere === true), 'B: net, proprietar supabase_admin, cu drept de scriere')
ok(nume('C_secvente', 'secventa') === 'http_request_queue_id_seq,diag_seq'
  || nume('C_secvente', 'secventa') === 'diag_seq,http_request_queue_id_seq', `C: secvente = ${nume('C_secvente', 'secventa')} (indexul nu mai rupe interogarea)`)
ok((pe.C_secvente || []).some(r => r.secventa === 'http_request_queue_id_seq' && r.a_tabelului === 'net.http_request_queue'), 'C: secventa cozii e legata de tabelul ei')
ok(!(pe.D_functii || []).length, `D: 0 functii in afara listelor (${(pe.D_functii || []).length})`)
const dn = (pe.D_numar || [])[0] || {}
ok(Number(dn.public_prin_public) === 2 && Number(dn.net_executabile_public) === 1 && Number(dn.net_security_definer) === 0,
  `D_numar: public=${dn.public_prin_public} net=${dn.net_executabile_public} definer=${dn.net_security_definer} (asteptat pe fixture 2 / 1 / 0)`)
const e = (pe.E_net_schema || [])[0] || {}
ok(e.proprietar_schema === 'supabase_admin' && /=U\/supabase_admin/.test(e.drepturi_schema || ''), `E: schema net, proprietar ${e.proprietar_schema}, drepturi ${e.drepturi_schema}`)
const fPublic = (pe.F_net_drepturi || []).filter(r => r.beneficiar === 'PUBLIC').map(r => `${r.relatie}:${r.acordat_de}`).sort().join(',')
ok(fPublic === '_http_response:supabase_admin,http_request_queue:supabase_admin,http_request_queue_id_seq:supabase_admin', `F: PUBLIC acordat de supabase_admin pe ${fPublic}`)
ok((pe.G_amprenta_net || []).length === 3 && (pe.G_amprenta_net || []).every(r => /^[0-9a-f]{32}$/.test(r.md5_amprenta)), 'G: 3 amprente md5 (2 tabele + secventa)')
const h = Object.fromEntries((pe.H_functii_net || []).map(r => [r.functie, r]))
ok(h['public.iot_cron_tick()']?.apel_http === true && h['public.iot_cron_tick()']?.security_definer === true
  && h['public.iot_cron_tick()']?.exec_service_role === true && h['public.iot_cron_tick()']?.exec_anon === false, 'H: functia DEFINER care apeleaza pg_net, executabila doar de service_role')
ok(h['public.fn_trg_trimite()']?.trigger_fn === true && Number(h['public.fn_trg_trimite()']?.nr_triggere) === 1 && h['public.fn_trg_trimite()']?.net_in_search_path === true, 'H: functia de trigger cu net in search_path')
ok(!h['public.set_updated_at()'], 'H: functiile fara pg_net nu apar')
const i = Object.fromEntries((pe.I_cron || []).map(r => [r.job, r]))
ok(i.job_http?.apel_http_direct === true && i.job_tick?.apel_http_direct === false && i.job_tick?.functii_public === 'iot_cron_tick'
  && i.job_citire?.citeste_net_direct === true, 'I: joburi clasificate fara sa afiseze comanda')
ok((pe.I_cron || []).every(r => !('command' in r)), 'I: comanda nu e in iesire')
ok(nume('J_postgrest', 'setare') === 'pgrst.db_schemas=public, graphql_public', `J: ${nume('J_postgrest', 'setare')}`)
const k = Object.fromEntries((pe.K_roluri_login || []).map(r => [r.rol, r]))
ok(k.rol_cron?.citeste_coada === true && k.authenticator?.citeste_raspunsuri === true, 'K: rolurile cu login ajung azi la coada / raspunsuri prin PUBLIC')
ok(nume('L_triggere_net', 'trigger_nume').split(',').sort().join(',') === 'trg_trimite,webhook_test', `L: triggere = ${nume('L_triggere_net', 'trigger_nume')}`)

// 2. Control: apel http_post INVOKER al unui rol obisnuit merge azi (prin PUBLIC).
await db.exec('SET ROLE rol_cron; SELECT net.http_post(url := \'https://exemplu.invalid/x\'); RESET ROLE;')
ok(true, 'control: rol obisnuit apeleaza http_post cu drepturile PUBLIC de azi')

// 3. REVOKE dat de un rol care NU e proprietarul: doar WARNING, nimic schimbat.
const note = []
await db.exec('SET ROLE rol_cron; REVOKE ALL ON net.http_request_queue, net._http_response FROM PUBLIC; RESET ROLE;',
  { onNotice: n => note.push(String(n.message || n)) })
const aclDupa = (await db.query("SELECT relacl::text AS a FROM pg_class WHERE oid = 'net.http_request_queue'::regclass")).rows[0].a
ok(note.some(m => /no privileges could be revoked/.test(m)) && /=arwdDxt/.test(aclDupa), `REVOKE de la ne-proprietar: WARNING, ACL neschimbat (${aclDupa})`)

// 4. Varianta a fara GRANT-uri: proprietarul retrage PUBLIC -> B / C (net) / G goale, dar apelul INVOKER pica.
await db.exec('SET ROLE supabase_admin; REVOKE ALL ON net.http_request_queue, net._http_response FROM PUBLIC; REVOKE ALL ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC; RESET ROLE;')
const dupa = (await ruleaza(db)).pe
ok(!(dupa.B_relatii || []).length, 'dupa REVOKE de la proprietar: B gol')
ok((dupa.C_secvente || []).map(r => r.secventa).join(',') === 'diag_seq', 'dupa REVOKE: C are doar secventa din public')
ok(!(dupa.G_amprenta_net || []).length, 'dupa REVOKE: G gol')
let eroareApel = ''
try { await db.exec('SET ROLE rol_cron; SELECT net.http_post(url := \'https://exemplu.invalid/y\');') } catch (er) { eroareApel = String(er.message || er) }
await db.exec('RESET ROLE;')
ok(/permission denied for table http_request_queue/.test(eroareApel), `dupa REVOKE fara GRANT: apelul unui rol obisnuit pica (${eroareApel})`)

// 5. GRANT doar INSERT + USAGE pe secventa NU ajunge: http_post face INSERT ... RETURNING id, care cere si SELECT pe id.
await db.exec('SET ROLE supabase_admin; GRANT INSERT ON net.http_request_queue TO rol_cron; GRANT USAGE ON SEQUENCE net.http_request_queue_id_seq TO rol_cron; RESET ROLE;')
let eroare1 = ''
try { await db.exec('SET ROLE rol_cron; SELECT net.http_post(url := \'https://exemplu.invalid/w\');') } catch (er) { eroare1 = String(er.message || er) }
await db.exec('RESET ROLE;')
ok(/permission denied for table http_request_queue/.test(eroare1), `GRANT doar INSERT + USAGE secventa: apelul tot pica (RETURNING cere SELECT) (${eroare1})`)
// 6. Cu SELECT(id) in plus, apelul merge din nou.
await db.exec('SET ROLE supabase_admin; GRANT SELECT (id) ON net.http_request_queue TO rol_cron; RESET ROLE;')
let eroare2 = ''
try { await db.exec('SET ROLE rol_cron; SELECT net.http_post(url := \'https://exemplu.invalid/z\');') } catch (er) { eroare2 = String(er.message || er) }
await db.exec('RESET ROLE;')
ok(eroare2 === '', `cu GRANT explicit (INSERT + SELECT(id) pe coada + USAGE secventa) apelul merge din nou ${eroare2}`)

await db.close()
console.log(esecuri ? `PORTI_CITIRE_PGLITE: ${esecuri} verificari picate` : 'PORTI_CITIRE_PGLITE: OK')
process.exit(esecuri ? 1 : 0)
