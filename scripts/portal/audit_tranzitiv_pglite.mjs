// Portal E1 r22 (Jakarinos r21 P1): proba pe PostgreSQL in proces (PGlite, PG17) a sectiunii N din
// scripts/portal/porti_citire.sql (auditul tranzitiv al apelurilor, doar din catalog). Nu se conecteaza la nimic.
//   npm install --no-save @electric-sql/pglite@0.3   apoi   node scripts/portal/audit_tranzitiv_pglite.mjs
// Cod 0 = toate verificarile trec; 1 = o verificare a picat; 2 = PGlite lipseste.
// Fiecare caz porneste de la o baza NOUA (schema falsa in forma Supabase: net cu drepturile PUBLIC de pe productie,
// http_post / http_get INVOKER care scriu in coada) + obiectele cazului. Expected-ul e scris aici, din constructia cazului
// (sursa independenta de interogare, L25): drumul exact, motivul exact al lui NEREZOLVAT, numele necunoscut.
// Cazul curat (verde) e controlul: aceleasi constructii fara pg_net (cuvinte SQL urmate de "(", search_path fixat,
// apel intre doua functii public) nu dau nicio cale, niciun nerezolvat, niciun nume necunoscut.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let PGlite
try { ({ PGlite } = await import('@electric-sql/pglite')) } catch {
  console.log('PGLITE_LIPSA: npm install --no-save @electric-sql/pglite@0.3'); process.exit(2)
}
const aici = path.dirname(fileURLToPath(import.meta.url))
const SQL = readFileSync(path.join(aici, 'porti_citire.sql'), 'utf8').replace(/\r\n/g, '\n')

const BAZA = `
CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE SCHEMA net AUTHORIZATION supabase_admin;
SET ROLE supabase_admin;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, method text NOT NULL, url text NOT NULL, headers jsonb,
  body bytea, timeout_milliseconds integer NOT NULL);
CREATE UNLOGGED TABLE net._http_response (id bigint, status_code integer, content text, created timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION net.http_post(url text, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql
  AS $f$ INSERT INTO net.http_request_queue (method, url, timeout_milliseconds) VALUES ('POST', url, timeout_milliseconds) RETURNING id $f$;
CREATE FUNCTION net.http_get(url text) RETURNS bigint LANGUAGE sql
  AS $f$ INSERT INTO net.http_request_queue (method, url, timeout_milliseconds) VALUES ('GET', url, 1000) RETURNING id $f$;
GRANT USAGE ON SCHEMA net TO PUBLIC;
GRANT ALL ON net.http_request_queue, net._http_response TO PUBLIC;
GRANT ALL ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC;
RESET ROLE;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, command text NOT NULL, username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true, jobname text);
-- doua functii public, apel intre ele, cu cuvinte SQL urmate de "(" (nu trebuie sa apara ca nume necunoscute)
CREATE TABLE public.stoc (id serial PRIMARY KEY, cant numeric(10, 2), eticheta varchar(20));
CREATE FUNCTION public.sigur_b(p integer) RETURNS integer LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  IF (p > 0) AND p IN (1, 2) AND EXISTS (SELECT 1 FROM public.stoc WHERE cant > coalesce(nullif(p, 0), 1)::numeric(10, 2)) THEN
    RETURN greatest(p, least(p, 3));
  END IF;
  RETURN CAST(p AS integer) + length(trim(both ' ' from 'x')) + extract(year FROM now())::integer * 0;
END $f$;
CREATE FUNCTION public.sigur_a() RETURNS integer LANGUAGE sql SET search_path TO 'public', 'pg_temp'
  AS $f$ SELECT public.sigur_b(1) + (SELECT count(*)::integer FROM stoc) $f$;
`

// Cazurile: [nume, SQL suplimentar, verificare(rezultat)]. rezultat = { rez: {cheie: valoare}, cai: [{drum, detaliu}],
// nerez: [{obiect, detaliu}], necun: [{obiect, detaliu}], nod: {eticheta: {adancime, definer, detaliu}} }
const are = (lista, f) => lista.some(f)
const CAZURI = [
  ['curat (control)', '', r => [
    [r.rez.cai_spre_net === '0', `cai_spre_net = ${r.rez.cai_spre_net}`],
    [r.rez.nerezolvate === '0', `nerezolvate = ${r.rez.nerezolvate} ${JSON.stringify(r.nerez)}`],
    [r.rez.nume_necunoscute === '0', `nume_necunoscute = ${r.rez.nume_necunoscute} ${JSON.stringify(r.necun)}`],
    [r.rez.radacini_functii_net === '2' && r.rez.radacini_functii_in_afara_net === '2', `radacini: ${r.rez.radacini_functii_in_afara_net} in afara net + ${r.rez.radacini_functii_net} net`],
    [r.rez.adancime_max_declarata === '8', 'adancime declarata 8'],
    [/apeleaza_net=false/.test(r.nod['public.sigur_a()']?.detaliu || '') && r.nod['public.sigur_b(integer)']?.adancime === 0,
      'sigur_a: nu apeleaza net; sigur_b e radacina (adancime 0)'],
    [/search_path=fixat/.test(r.nod['public.sigur_b(integer)']?.detaliu || ''), 'sigur_b: search_path fixat'],
  ]],
  ['lant pe 3 niveluri pana la un DEFINER care apeleaza net.http_post', `
    CREATE FUNCTION public.l3() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN net.http_post('https://exemplu.invalid/l3'); END $f$;
    REVOKE ALL ON FUNCTION public.l3() FROM PUBLIC;
    CREATE FUNCTION public.l2() RETURNS bigint LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN l3(); END $f$;
    REVOKE ALL ON FUNCTION public.l2() FROM PUBLIC;
    CREATE FUNCTION public.l1() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT public.l2() $f$;`,
  r => [
    [are(r.cai, c => c.drum === 'public.l1() -[apel]-> public.l2() -[apel]-> public.l3() -[apel]-> net.http_post(text, integer)'),
      `cale exacta pe 3 niveluri: ${JSON.stringify(r.cai.map(c => c.drum))}`],
    [r.nod['public.l3()']?.definer === true && /apeleaza_net=true/.test(r.nod['public.l3()']?.detaliu || '') && r.nod['public.l3()']?.adancime === 2,
      'l3: DEFINER, apeleaza net, la adancimea 2'],
    [r.rez.cai_spre_net === '1', `o singura radacina cu cale (l1; l2 / l3 nu sunt executabile de PUBLIC): ${r.rez.cai_spre_net}`],
  ]],
  ['apel necalificat rezolvat prin search_path cu net', `
    CREATE FUNCTION public.n1() RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'net', 'pg_temp'
      AS $f$ BEGIN PERFORM http_post('https://exemplu.invalid/n1'); END $f$;`,
  r => [[are(r.cai, c => c.drum === 'public.n1() -[apel]-> net.http_post(text, integer)'), `n1 -> http_post: ${JSON.stringify(r.cai.map(c => c.drum))}`]]],
  ['search_path mostenit: apel necalificat = rezolvat pe toate schemele', `
    CREATE FUNCTION public.m1() RETURNS bigint LANGUAGE sql AS $f$ SELECT http_get('https://exemplu.invalid/m1') $f$;`,
  r => [
    [are(r.cai, c => c.drum === 'public.m1() -[apel]-> net.http_get(text)'), `m1 -> http_get: ${JSON.stringify(r.cai.map(c => c.drum))}`],
    [/search_path=MOSTENIT/.test(r.nod['public.m1()']?.detaliu || '') && r.rez.search_path_mostenit === '1', 'm1: search_path MOSTENIT numarat'],
  ]],
  ['citirea raspunsurilor pg_net (relatie calificata)', `
    CREATE FUNCTION public.r1() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT count(*) FROM net._http_response $f$;`,
  r => [
    [are(r.cai, c => c.drum === 'public.r1() -[relatie]-> net._http_response'), `r1 -> _http_response: ${JSON.stringify(r.cai.map(c => c.drum))}`],
    [/atinge_obiect_net=net\._http_response/.test(r.nod['public.r1()']?.detaliu || ''), 'r1: atinge_obiect_net = net._http_response'],
  ]],
  ['scriere intr-un tabel cu trigger DEFINER care apeleaza pg_net', `
    CREATE TABLE public.t_notif (id serial PRIMARY KEY, txt text);
    CREATE FUNCTION public.tg_notif() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/t'); RETURN NEW; END $f$;
    REVOKE ALL ON FUNCTION public.tg_notif() FROM PUBLIC;
    CREATE TRIGGER t_notif_ai AFTER INSERT ON public.t_notif FOR EACH ROW EXECUTE FUNCTION public.tg_notif();
    CREATE FUNCTION public.w1(p text) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN INSERT INTO t_notif (txt) VALUES (p); END $f$;`,
  r => [[are(r.cai, c => c.drum === 'public.w1(text) -[relatie]-> public.t_notif -[trigger]-> public.tg_notif() -[apel]-> net.http_post(text, integer)'),
    `w1 -> t_notif -> trigger -> http_post: ${JSON.stringify(r.cai.map(c => c.drum))}`]]],
  ['tabel scriibil de PUBLIC (radacina de tip scrie) cu trigger spre pg_net', `
    CREATE TABLE public.t_scris (id serial PRIMARY KEY);
    GRANT INSERT ON public.t_scris TO PUBLIC;
    CREATE FUNCTION public.tg_scris() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_get('https://exemplu.invalid/s'); RETURN NEW; END $f$;
    REVOKE ALL ON FUNCTION public.tg_scris() FROM PUBLIC;
    CREATE TRIGGER t_scris_ai AFTER INSERT ON public.t_scris FOR EACH ROW EXECUTE FUNCTION public.tg_scris();`,
  r => [
    [are(r.cai, c => c.drum === 'public.t_scris -[trigger]-> public.tg_scris() -[apel]-> net.http_get(text)' && /tip_radacina=scrie/.test(c.detaliu)),
      `t_scris (scrie) -> trigger -> http_get: ${JSON.stringify(r.cai)}`],
    [r.rez.radacini_relatii_scriere === '3', `radacini de scriere: coada + raspunsurile + t_scris = ${r.rez.radacini_relatii_scriere}`],
  ]],
  ['vedere peste raspunsurile pg_net', `
    CREATE VIEW public.v_raspuns AS SELECT id, status_code FROM net._http_response;
    CREATE FUNCTION public.vf() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT count(*) FROM v_raspuns $f$;`,
  r => [[are(r.cai, c => c.drum === 'public.vf() -[relatie]-> public.v_raspuns -[vedere]-> net._http_response'),
    `vf -> vedere -> _http_response: ${JSON.stringify(r.cai.map(c => c.drum))}`]]],
  ['corp BEGIN ATOMIC (dependentele din catalog)', `
    CREATE FUNCTION public.a1() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT net.http_get('https://exemplu.invalid/a'); END;`,
  r => [[are(r.cai, c => /^public\.a1\(\) -\[(apel|dependenta)\]-> net\.http_get\(text\)$/.test(c.drum)), `a1 -> http_get: ${JSON.stringify(r.cai.map(c => c.drum))}`]]],
  ['SQL dinamic cu text de la apelant', `
    CREATE FUNCTION public.d1(q text) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN EXECUTE q; END $f$;`,
  r => [
    [are(r.nerez, x => x.obiect === 'public.d1(text)' && /SQL dinamic/.test(x.detaliu)), `d1 NEREZOLVAT (SQL dinamic): ${JSON.stringify(r.nerez)}`],
    [/exec_text_apelant=true/.test(r.nod['public.d1(text)']?.detaliu || '') && r.rez.exec_text_apelant === '1', 'd1: exec_text_apelant = true'],
  ]],
  ['EXECUTE format(...) cu numele construit', `
    CREATE FUNCTION public.d2() RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN EXECUTE format('SELECT %I.%I(%L)', 'net', 'http_' || 'get', 'https://exemplu.invalid/d2'); END $f$;`,
  r => [
    [are(r.nerez, x => x.obiect === 'public.d2()' && /SQL dinamic/.test(x.detaliu)), `d2 NEREZOLVAT: ${JSON.stringify(r.nerez)}`],
    [!are(r.cai, c => c.drum.startsWith('public.d2()')), 'd2: fara cale statica (numele e construit) => doar NEREZOLVAT'],
  ]],
  ['executor de text din nucleu (query_to_xml)', `
    CREATE FUNCTION public.x1() RETURNS xml LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT query_to_xml('SELECT 1', true, false, '') $f$;`,
  r => [[are(r.nerez, x => x.obiect === 'public.x1()' && /query_to_xml/.test(x.detaliu)), `x1 NEREZOLVAT (query_to_xml): ${JSON.stringify(r.nerez)}`]]],
  ['corp opac (limbaj internal)', `
    CREATE FUNCTION public.o1(integer, integer) RETURNS integer LANGUAGE internal IMMUTABLE STRICT AS 'int4pl';`,
  r => [[are(r.nerez, x => x.obiect === 'public.o1(integer, integer)' && /corp opac: limbaj internal/.test(x.detaliu)), `o1 NEREZOLVAT (opac): ${JSON.stringify(r.nerez)}`]]],
  ['adancime depasita (lant de 10, net la capat)', (() => {
    let s = "CREATE FUNCTION public.c9() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT net.http_get('https://exemplu.invalid/c') $f$; REVOKE ALL ON FUNCTION public.c9() FROM PUBLIC;"
    for (let i = 8; i >= 0; i--) {
      s += `CREATE FUNCTION public.c${i}() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT public.c${i + 1}() $f$;`
      if (i > 0) s += `REVOKE ALL ON FUNCTION public.c${i}() FROM PUBLIC;`
    }
    return s
  })(),
  r => [
    [are(r.nerez, x => x.obiect === 'public.c8()' && /adancime depasita/.test(x.detaliu)), `c8 NEREZOLVAT (adancime): ${JSON.stringify(r.nerez)}`],
    [r.rez.cai_spre_net === '0' && r.rez.adancime_atinsa === '8', `fara cale in limita (c9 la adancimea 9): cai=${r.rez.cai_spre_net} adancime=${r.rez.adancime_atinsa}`],
  ]],
  ['nume necunoscut (functie inexistenta)', `
    CREATE FUNCTION public.u1() RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM fantoma_portal_xyz(1); END $f$;`,
  r => [[are(r.necun, x => x.obiect === 'public.u1()' && /fantoma_portal_xyz$/.test(x.detaliu)) && r.rez.nume_necunoscute === '1',
    `u1: nume necunoscut fantoma_portal_xyz: ${JSON.stringify(r.necun)}`]]],
  ['nume pg_net doar intr-un comentariu (supra-aproximare: raportat, nu ascuns)', `
    CREATE FUNCTION public.k1() RETURNS integer LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT 1 -- odinioara: net.http_post(...)
      $f$;`,
  r => [[are(r.cai, c => c.drum === 'public.k1() -[apel]-> net.http_post(text, integer)'), `k1 (comentariu) raportat: ${JSON.stringify(r.cai.map(c => c.drum))}`]]],
]

let esecuri = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'PICA ') + msg); if (!cond) esecuri++ }

async function ruleaza(extra) {
  const db = await PGlite.create()
  await db.exec(BAZA)
  // corpurile se verifica la rulare, nu la creare (ca pe productie dupa un restore: functia exista, apelul e static)
  try { if (extra) await db.exec('SET check_function_bodies = off;' + extra + 'RESET check_function_bodies;') } catch (e) {
    await db.close(); return { eroare: `fixture: ${e.message}` }
  }
  let rez
  try { rez = await db.exec(SQL) } catch (e) { await db.close(); return { eroare: e.message } }
  await db.close()
  const r = { rez: {}, cai: [], nerez: [], necun: [], nod: {} }
  for (const set of rez) {
    for (const row of set.rows || []) {
      if (!row || typeof row.sectiune !== 'string') continue
      if (row.sectiune === 'N_audit_rezumat') r.rez[row.obiect] = row.detaliu
      else if (row.sectiune === 'N_audit_cale') r.cai.push({ drum: row.obiect, detaliu: row.detaliu })
      else if (row.sectiune === 'N_audit_nerezolvat') r.nerez.push({ obiect: row.obiect, detaliu: row.detaliu })
      else if (row.sectiune === 'N_audit_necunoscut') r.necun.push({ obiect: row.obiect, detaliu: row.detaliu })
      else if (row.sectiune === 'N_audit_nod') r.nod[row.obiect] = { adancime: row.adancime, definer: row.security_definer, detaliu: row.detaliu }
    }
  }
  return r
}

for (const [nume, extra, verif] of CAZURI) {
  const r = await ruleaza(extra)
  if (r.eroare) { ok(false, `${nume}: porti_citire.sql a picat: ${r.eroare}`); continue }
  ok(Object.keys(r.rez).length === 13, `${nume}: rezumatul are 13 randuri`)
  for (const [c, m] of verif(r)) ok(c, `${nume}: ${m}`)
}
console.log(esecuri ? `AUDIT_TRANZITIV_PGLITE: ${esecuri} verificari picate` : 'AUDIT_TRANZITIV_PGLITE: OK')
process.exit(esecuri ? 1 : 0)
