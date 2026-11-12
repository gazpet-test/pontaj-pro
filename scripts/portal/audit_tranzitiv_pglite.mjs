// Portal E1 r23: proba pe PostgreSQL in proces (PGlite, PG17) a sectiunii N din scripts/portal/porti_citire.sql
// (auditul tranzitiv, modelul r23: stare = obiect + rol efectiv + operatie, fara limita de adancime). Nu se conecteaza
// la nimic.
//   npm install --no-save @electric-sql/pglite@0.3   apoi   node scripts/portal/audit_tranzitiv_pglite.mjs
// Cod 0 = toate verificarile trec; 1 = o verificare a picat; 2 = PGlite lipseste.
// Fiecare caz porneste de la o baza NOUA (schema falsa in forma Supabase: net cu drepturile PUBLIC de pe productie,
// http_post / http_get INVOKER care scriu in coada) + obiectele cazului. Expected-ul e scris aici, din constructia cazului
// (sursa independenta de interogare, L25): drumul exact (cu rolul fiecarei stari si operatia pe relatii), motivul exact
// al lui NEREZOLVAT, numele necunoscut. Cazurile „fara cale” sunt cele in care PostgreSQL ar refuza efectiv pasul
// (EXECUTE / drept lipsa, functie de trigger, FK fara CASCADE, politica pentru alt rol): fiecare are perechea lui cu
// pasul permis, care DA calea (mutantul invers), ca un audit care ar ignora regula sa pice.
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
const HP = 'net.http_post(text, integer)'
const HG = 'net.http_get(text)'

// Cazurile: [nume, SQL suplimentar, verificare(rezultat)]. rezultat = { rez: {cheie: valoare}, cai: [{drum, detaliu}],
// nerez: [{obiect, detaliu}], necun: [{obiect, detaliu}], nod: {eticheta: {...}}, rad: {eticheta: detaliu}, excl: [eticheta] }
const are = (lista, f) => lista.some(f)
const drumuri = r => JSON.stringify(r.cai.map(c => c.drum))
const faraCale = (r, prefix) => [!are(r.cai, c => c.drum.startsWith(prefix)), `fara cale din ${prefix}: ${drumuri(r)}`]
const CAZURI = [
  ['curat (control)', '', r => [
    [r.rez.cai_spre_net === '0', `cai_spre_net = ${r.rez.cai_spre_net}`],
    [r.rez.nerezolvate === '0', `nerezolvate = ${r.rez.nerezolvate} ${JSON.stringify(r.nerez)}`],
    [r.rez.nume_necunoscute === '0', `nume_necunoscute = ${r.rez.nume_necunoscute} ${JSON.stringify(r.necun)}`],
    [r.rez.rol_radacina === 'public', `rol_radacina = public (teren nu exista): ${r.rez.rol_radacina}`],
    [r.rez.radacini_functii_net === '2' && r.rez.radacini_functii_in_afara_net === '2',
      `radacini: ${r.rez.radacini_functii_in_afara_net} in afara net + ${r.rez.radacini_functii_net} net`],
    [r.rez.radacini_relatii_net === '3' && r.rez.radacini_relatii_in_afara_net === '0',
      `relatii radacina: net ${r.rez.radacini_relatii_net} (coada, raspunsuri, secventa), in afara net ${r.rez.radacini_relatii_in_afara_net}`],
    [/limita/.test(r.rez.model || '') && !('adancime_max_declarata' in r.rez), `fara limita de adancime declarata: ${r.rez.model}`],
    [r.rad['net.http_request_queue'] && /operatii=DELETE,INSERT,SELECT,TRUNCATE,UPDATE/.test(r.rad['net.http_request_queue']),
      `coada = radacina net cu toate operatiile: ${r.rad['net.http_request_queue']}`],
    [/ruleaza_ca=public/.test(r.nod['public.sigur_b(integer)']?.detaliu || '') && r.nod['public.stoc'] === undefined,
      'sigur_b atinsa ca public; stoc NU (PUBLIC nu are SELECT pe stoc)'],
  ]],
  ['EXECUTE lipsa pe veriga din mijloc: PostgreSQL refuza apelul => fara cale', `
    CREATE FUNCTION public.l3() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN net.http_post('https://exemplu.invalid/l3'); END $f$;
    REVOKE ALL ON FUNCTION public.l3() FROM PUBLIC;
    CREATE FUNCTION public.l2() RETURNS bigint LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN l3(); END $f$;
    REVOKE ALL ON FUNCTION public.l2() FROM PUBLIC;
    CREATE FUNCTION public.l1() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT public.l2() $f$;`,
  r => [faraCale(r, 'public.l1()'), [r.rez.cai_spre_net === '0', `cai = ${r.rez.cai_spre_net}`]]],
  ['lant pe 3 niveluri prin DEFINER (rolul se schimba in proprietar)', `
    CREATE FUNCTION public.l3() RETURNS bigint LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN net.http_post('https://exemplu.invalid/l3'); END $f$;
    REVOKE ALL ON FUNCTION public.l3() FROM PUBLIC;
    CREATE FUNCTION public.l2() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN l3(); END $f$;
    CREATE FUNCTION public.l1() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT public.l2() $f$;`,
  r => [
    [are(r.cai, c => c.drum === `public.l1() {public} -[apel]-> public.l2() {postgres} -[apel]-> public.l3() {postgres} -[apel]-> ${HP} {postgres}`),
      `cale exacta: ${drumuri(r)}`],
    [r.nod['public.l2()']?.definer === true && /ruleaza_ca=postgres/.test(r.nod['public.l3()']?.detaliu || ''), 'l2 DEFINER, l3 ruleaza ca postgres'],
    [r.rez.cai_spre_net === '2' && r.rez.pasi_maxim_spre_net === '3', `l1 + l2 (ambele executabile de PUBLIC): cai=${r.rez.cai_spre_net} pasi=${r.rez.pasi_maxim_spre_net}`],
  ]],
  ['apel necalificat rezolvat prin search_path cu net', `
    CREATE FUNCTION public.n1() RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'net', 'pg_temp'
      AS $f$ BEGIN PERFORM http_post('https://exemplu.invalid/n1'); END $f$;`,
  r => [[are(r.cai, c => c.drum === `public.n1() {public} -[apel]-> ${HP} {public}`), `n1 -> http_post: ${drumuri(r)}`]]],
  ['search_path mostenit: apel necalificat = rezolvat pe toate schemele', `
    CREATE FUNCTION public.m1() RETURNS bigint LANGUAGE sql AS $f$ SELECT http_get('https://exemplu.invalid/m1') $f$;`,
  r => [
    [are(r.cai, c => c.drum === `public.m1() {public} -[apel]-> ${HG} {public}`), `m1 -> http_get: ${drumuri(r)}`],
    [/search_path=MOSTENIT/.test(r.nod['public.m1()']?.detaliu || '') && r.rez.search_path_mostenit === '1', 'm1: search_path MOSTENIT numarat'],
  ]],
  ['citirea raspunsurilor pg_net (relatie calificata, drept PUBLIC)', `
    CREATE FUNCTION public.r1() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT count(*) FROM net._http_response $f$;`,
  r => [[are(r.cai, c => c.drum === 'public.r1() {public} -[citire]-> net._http_response [SELECT] {public}'), `r1 -> _http_response: ${drumuri(r)}`]]],
  ['scriere INVOKER intr-un tabel fara drept: refuzata => fara cale', `
    CREATE TABLE public.t_notif (id serial PRIMARY KEY, txt text);
    CREATE FUNCTION public.tg_notif() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/t'); RETURN NEW; END $f$;
    REVOKE ALL ON FUNCTION public.tg_notif() FROM PUBLIC;
    CREATE TRIGGER t_notif_ai AFTER INSERT ON public.t_notif FOR EACH ROW EXECUTE FUNCTION public.tg_notif();
    CREATE FUNCTION public.w1(p text) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN INSERT INTO t_notif (txt) VALUES (p); END $f$;`,
  r => [faraCale(r, 'public.w1(text)'), [r.nod['public.t_notif'] === undefined, 't_notif neatins']]],
  ['scriere INVOKER cu drept INSERT pentru PUBLIC -> trigger DEFINER -> pg_net', `
    CREATE TABLE public.t_notif (id serial PRIMARY KEY, txt text);
    GRANT INSERT ON public.t_notif TO PUBLIC;
    CREATE FUNCTION public.tg_notif() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/t'); RETURN NEW; END $f$;
    REVOKE ALL ON FUNCTION public.tg_notif() FROM PUBLIC;
    CREATE TRIGGER t_notif_ai AFTER INSERT ON public.t_notif FOR EACH ROW EXECUTE FUNCTION public.tg_notif();
    CREATE FUNCTION public.w1(p text) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN INSERT INTO t_notif (txt) VALUES (p); END $f$;`,
  r => [
    [are(r.cai, c => c.drum === `public.w1(text) {public} -[scriere INSERT]-> public.t_notif [INSERT] {public} -[trigger INSERT]-> public.tg_notif() {postgres} -[apel]-> ${HP} {postgres}`),
      `w1 -> t_notif -> trigger -> http_post: ${drumuri(r)}`],
    [r.rez.radacini_relatii_in_afara_net === '1' && are(r.cai, c => c.drum.startsWith('public.t_notif [INSERT] {public}')),
      `t_notif e si radacina (INSERT pentru PUBLIC), cu cale proprie: ${drumuri(r)}`],
  ]],
  ['trigger pe alta operatie decat scrierea: UPDATE nu declanseaza un trigger AFTER INSERT', `
    CREATE TABLE public.t_op (id serial PRIMARY KEY, txt text);
    GRANT UPDATE ON public.t_op TO PUBLIC;
    CREATE FUNCTION public.tg_op() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/op'); RETURN NEW; END $f$;
    CREATE TRIGGER t_op_ai AFTER INSERT ON public.t_op FOR EACH ROW EXECUTE FUNCTION public.tg_op();
    CREATE FUNCTION public.u2() RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN UPDATE t_op SET txt = 'x'; END $f$;`,
  r => [faraCale(r, 'public.u2()'), faraCale(r, 'public.t_op')]],
  ['functie de trigger executabila de PUBLIC, cu drum spre pg_net: NU e radacina', `
    CREATE FUNCTION public.tg_direct() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/td'); RETURN NEW; END $f$;`,
  r => [
    [r.rez.cai_spre_net === '0' && r.rez.functii_trigger_excluse === '1', `cai=${r.rez.cai_spre_net} triggere excluse=${r.rez.functii_trigger_excluse}`],
    [r.excl.includes('public.tg_direct()') && r.rad['public.tg_direct()'] === undefined, `tg_direct listata ca exclusa, nu radacina: ${JSON.stringify(r.excl)}`],
  ]],
  ['forma caii false din productie r22 (trigger -> politica -> profil -> FK -> trigger): fara cale', `
    CREATE TABLE public.profiles (id integer PRIMARY KEY, is_owner boolean);
    CREATE TABLE public.hr_doc (id serial PRIMARY KEY, profile_id integer REFERENCES public.profiles ON DELETE CASCADE);
    CREATE TABLE public.inbox (id serial PRIMARY KEY, sursa integer);
    CREATE FUNCTION public.tg_inbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/inbox'); RETURN NEW; END $f$;
    CREATE TRIGGER inbox_ai AFTER INSERT ON public.inbox FOR EACH ROW EXECUTE FUNCTION public.tg_inbox();
    CREATE FUNCTION public.tg_hr_doc() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN INSERT INTO inbox (sursa) VALUES (NEW.id); RETURN NEW; END $f$;
    CREATE TRIGGER hr_doc_ai AFTER INSERT OR UPDATE ON public.hr_doc FOR EACH ROW EXECUTE FUNCTION public.tg_hr_doc();
    CREATE FUNCTION public.fn_is_owner(p integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT coalesce((SELECT is_owner FROM profiles WHERE id = p), false) $f$;
    CREATE TABLE public.tichete (id serial PRIMARY KEY, autor integer);
    ALTER TABLE public.tichete ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tichete_owner ON public.tichete FOR ALL TO authenticated USING (public.fn_is_owner(autor));
    CREATE FUNCTION public.notify_opener() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM 1 FROM tichete WHERE id = NEW.id; RETURN NEW; END $f$;
    CREATE FUNCTION public.citeste_profil(p integer) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p) $f$;`,
  r => [
    [r.rez.cai_spre_net === '0', `cai = ${r.rez.cai_spre_net}: ${drumuri(r)}`],
    [r.excl.includes('public.notify_opener()'), 'notify_opener (trigger) exclusa din radacini'],
    [/operatii=SELECT;/.test(r.nod['public.profiles']?.detaliu || '') && r.nod['public.hr_doc'] === undefined,
      `profiles doar citit (de citeste_profil, ca postgres); hr_doc neatins (FK doar la stergere): ${r.nod['public.profiles']?.detaliu}`],
  ]],
  ['FK ON DELETE CASCADE: stergerea parintelui scrie in copil -> trigger DELETE -> pg_net', `
    CREATE TABLE public.profiles (id integer PRIMARY KEY);
    CREATE TABLE public.hr_doc (id serial PRIMARY KEY, profile_id integer REFERENCES public.profiles ON DELETE CASCADE);
    CREATE TABLE public.inbox (id serial PRIMARY KEY, sursa integer);
    CREATE FUNCTION public.tg_inbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/inbox'); RETURN NEW; END $f$;
    CREATE TRIGGER inbox_ai AFTER INSERT ON public.inbox FOR EACH ROW EXECUTE FUNCTION public.tg_inbox();
    CREATE FUNCTION public.tg_hr_doc() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN INSERT INTO inbox (sursa) VALUES (OLD.id); RETURN OLD; END $f$;
    CREATE TRIGGER hr_doc_ad AFTER DELETE ON public.hr_doc FOR EACH ROW EXECUTE FUNCTION public.tg_hr_doc();
    CREATE FUNCTION public.sterge_profil(p integer) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ DELETE FROM profiles WHERE id = p $f$;`,
  r => [[are(r.cai, c => c.drum === 'public.sterge_profil(integer) {postgres} -[scriere DELETE]-> public.profiles [DELETE] {postgres} -[fk la stergere c]-> public.hr_doc [DELETE] {postgres} -[trigger DELETE]-> public.tg_hr_doc() {postgres} -[scriere INSERT]-> public.inbox [INSERT] {postgres} -[trigger INSERT]-> public.tg_inbox() {postgres} -[apel]-> ' + HP + ' {postgres}'),
    `cale prin cascada: ${drumuri(r)}`]]],
  ['FK NO ACTION: stergerea parintelui doar verifica => fara cale', `
    CREATE TABLE public.profiles (id integer PRIMARY KEY);
    CREATE TABLE public.hr_doc (id serial PRIMARY KEY, profile_id integer REFERENCES public.profiles);
    CREATE FUNCTION public.tg_hr_doc() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/hr'); RETURN OLD; END $f$;
    CREATE TRIGGER hr_doc_ad AFTER DELETE ON public.hr_doc FOR EACH ROW EXECUTE FUNCTION public.tg_hr_doc();
    CREATE FUNCTION public.sterge_profil(p integer) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ DELETE FROM profiles WHERE id = p $f$;`,
  r => [faraCale(r, 'public.sterge_profil(integer)')]],
  ['politica evaluata la citirea de catre PUBLIC (politica TO PUBLIC cu functie DEFINER spre pg_net)', `
    CREATE FUNCTION public.pol_fn() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/pol'); RETURN true; END $f$;
    CREATE TABLE public.t_pol (id integer);
    ALTER TABLE public.t_pol ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.t_pol TO PUBLIC;
    CREATE POLICY t_pol_toti ON public.t_pol FOR SELECT TO PUBLIC USING (public.pol_fn());
    CREATE TABLE public.t_pol_auth (id integer);
    ALTER TABLE public.t_pol_auth ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.t_pol_auth TO PUBLIC;
    CREATE POLICY t_pol_auth_p ON public.t_pol_auth FOR SELECT TO authenticated USING (public.pol_fn());`,
  r => [
    [are(r.cai, c => c.drum === `public.t_pol [SELECT] {public} -[politica]-> public.pol_fn() {postgres} -[apel]-> ${HP} {postgres}`),
      `t_pol -> politica -> pol_fn -> http_post: ${drumuri(r)}`],
    faraCale(r, 'public.t_pol_auth'),
  ]],
  ['vedere fara drept SELECT pentru PUBLIC: fara cale; cu drept: ruleaza ca proprietarul vederii', `
    CREATE VIEW public.v_raspuns AS SELECT id, status_code FROM net._http_response;
    CREATE VIEW public.v_raspuns2 AS SELECT id FROM net._http_response;
    GRANT SELECT ON public.v_raspuns2 TO PUBLIC;
    CREATE FUNCTION public.vf() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT count(*) FROM v_raspuns $f$;
    CREATE FUNCTION public.vf2() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT count(*) FROM v_raspuns2 $f$;`,
  r => [
    faraCale(r, 'public.vf()'),
    [are(r.cai, c => c.drum === 'public.vf2() {public} -[citire]-> public.v_raspuns2 [SELECT] {public} -[vedere]-> net._http_response [SELECT] {postgres}'),
      `vf2 -> vedere -> _http_response (ca postgres): ${drumuri(r)}`],
  ]],
  ['corp BEGIN ATOMIC (dependentele din catalog)', `
    CREATE FUNCTION public.a1() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT net.http_get('https://exemplu.invalid/a'); END;`,
  r => [[are(r.cai, c => new RegExp(`^public\\.a1\\(\\) \\{public\\} -\\[(apel|dependenta)\\]-> net\\.http_get\\(text\\) \\{public\\}$`).test(c.drum)), `a1 -> http_get: ${drumuri(r)}`]]],
  ['partitie: scrierea in parinte ajunge la triggerul partitiei', `
    CREATE TABLE public.t_part (id integer, zi date) PARTITION BY RANGE (zi);
    CREATE TABLE public.t_part_2026 PARTITION OF public.t_part FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
    GRANT INSERT ON public.t_part TO PUBLIC;
    CREATE FUNCTION public.tg_part() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_get('https://exemplu.invalid/p'); RETURN NEW; END $f$;
    CREATE TRIGGER t_part_2026_ai AFTER INSERT ON public.t_part_2026 FOR EACH ROW EXECUTE FUNCTION public.tg_part();`,
  r => [[are(r.cai, c => c.drum === `public.t_part [INSERT] {public} -[mostenire]-> public.t_part_2026 [INSERT] {public} -[trigger INSERT]-> public.tg_part() {postgres} -[apel]-> ${HG} {postgres}`),
    `t_part -> partitie -> trigger -> http_get: ${drumuri(r)}`]]],
  ['SQL dinamic cu text de la apelant', `
    CREATE FUNCTION public.d1(q text) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN EXECUTE q; END $f$;`,
  r => [
    [are(r.nerez, x => x.obiect === 'public.d1(text)' && /SQL dinamic/.test(x.detaliu)), `d1 NEREZOLVAT (SQL dinamic): ${JSON.stringify(r.nerez)}`],
    [r.rez.exec_text_apelant === '1', `exec_text_apelant = ${r.rez.exec_text_apelant}`],
  ]],
  ['EXECUTE format(...) cu numele construit', `
    CREATE FUNCTION public.d2() RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN EXECUTE format('SELECT %I.%I(%L)', 'net', 'http_' || 'get', 'https://exemplu.invalid/d2'); END $f$;`,
  r => [
    [are(r.nerez, x => x.obiect === 'public.d2()' && /SQL dinamic/.test(x.detaliu)), `d2 NEREZOLVAT: ${JSON.stringify(r.nerez)}`],
    faraCale(r, 'public.d2()'),
  ]],
  ['executor de text din nucleu (query_to_xml)', `
    CREATE FUNCTION public.x1() RETURNS xml LANGUAGE sql SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT query_to_xml('SELECT 1', true, false, '') $f$;`,
  r => [[are(r.nerez, x => x.obiect === 'public.x1()' && /query_to_xml/.test(x.detaliu)), `x1 NEREZOLVAT (query_to_xml): ${JSON.stringify(r.nerez)}`]]],
  ['corp opac (limbaj internal)', `
    CREATE FUNCTION public.o1(integer, integer) RETURNS integer LANGUAGE internal IMMUTABLE STRICT AS 'int4pl';`,
  r => [[are(r.nerez, x => x.obiect === 'public.o1(integer, integer)' && /corp opac: limbaj internal/.test(x.detaliu)), `o1 NEREZOLVAT (opac): ${JSON.stringify(r.nerez)}`]]],
  ['fara limita de adancime: lant de 13 pasi gasit integral', (() => {
    let s = "CREATE FUNCTION public.c12() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT net.http_get('https://exemplu.invalid/c') $f$; REVOKE ALL ON FUNCTION public.c12() FROM PUBLIC;"
    for (let i = 11; i >= 1; i--) {
      s += `CREATE FUNCTION public.c${i}() RETURNS bigint LANGUAGE sql SET search_path TO 'public', 'pg_temp' AS $f$ SELECT public.c${i + 1}() $f$; REVOKE ALL ON FUNCTION public.c${i}() FROM PUBLIC;`
    }
    s += "CREATE FUNCTION public.c0() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$ SELECT public.c1() $f$;"
    return s
  })(),
  r => [
    [r.rez.cai_spre_net === '1' && r.rez.pasi_maxim_spre_net === '13', `cai=${r.rez.cai_spre_net} pasi=${r.rez.pasi_maxim_spre_net}`],
    [are(r.cai, c => c.drum.startsWith('public.c0() {postgres} -[apel]-> public.c1() {postgres}') && c.drum.endsWith(`public.c12() {postgres} -[apel]-> ${HG} {postgres}`)),
      `drumul complet c0 .. c12 -> http_get: ${drumuri(r)}`],
    [!are(r.nerez, x => /adancime/.test(x.detaliu)), 'niciun NEREZOLVAT de adancime'],
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
  r => [[are(r.cai, c => c.drum === `public.k1() {public} -[apel]-> ${HP} {public}`), `k1 (comentariu) raportat: ${drumuri(r)}`]]],
  ['forma 18a cu (d): rolul teren, in public doar cele doua functii ale portalului', `
    CREATE ROLE teren NOLOGIN NOINHERIT;
    REVOKE EXECUTE ON FUNCTION public.sigur_a(), public.sigur_b(integer) FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO teren;
    CREATE TABLE public.conturi_teren (auth_user_id integer PRIMARY KEY, stare text);
    CREATE FUNCTION public.fn_teren_eligibil(p integer) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN RETURN EXISTS (SELECT FROM public.conturi_teren c WHERE c.auth_user_id = p AND c.stare = 'activ'); END $f$;
    REVOKE ALL ON FUNCTION public.fn_teren_eligibil(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.fn_teren_eligibil(integer) TO teren;
    CREATE FUNCTION public.fn_portal_uid() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ SELECT 1 $f$;
    REVOKE ALL ON FUNCTION public.fn_portal_uid() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.fn_portal_uid() TO teren;
    CREATE FUNCTION public.tg_ramas() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
      AS $f$ BEGIN PERFORM net.http_post('https://exemplu.invalid/r'); RETURN NEW; END $f$;
    REVOKE EXECUTE ON FUNCTION public.tg_ramas() FROM PUBLIC;`,
  r => [
    [r.rez.rol_radacina === 'teren', `rol_radacina = teren: ${r.rez.rol_radacina}`],
    [r.rez.radacini_functii_in_afara_net === '2' && r.rad['public.fn_teren_eligibil(integer)'] && r.rad['public.fn_portal_uid()'],
      `radacini in afara net = exact cele doua functii ale portalului: ${JSON.stringify(Object.keys(r.rad))}`],
    [r.rez.cai_spre_net === '0' && r.rez.nerezolvate === '0' && r.rez.functii_trigger_excluse === '0',
      `0 cai / 0 nerezolvate / 0 triggere executabile: ${r.rez.cai_spre_net} ${r.rez.nerezolvate} ${r.rez.functii_trigger_excluse}`],
    [r.rez.radacini_functii_net === '2' && r.rez.radacini_relatii_net === '3', 'radacinile net: functiile + coada / raspunsurile / secventa'],
  ]],
]

let esecuri = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'PICA ') + msg); if (!cond) esecuri++ }

async function ruleaza(extra, sql = SQL) {
  const db = await PGlite.create()
  await db.exec(BAZA)
  // corpurile se verifica la rulare, nu la creare (ca pe productie dupa un restore: functia exista, apelul e static)
  try { if (extra) await db.exec('SET check_function_bodies = off;' + extra + 'RESET check_function_bodies;') } catch (e) {
    await db.close(); return { eroare: `fixture: ${e.message}` }
  }
  let rez
  const t0 = Date.now()
  try { rez = await db.exec(sql) } catch (e) { await db.close(); return { eroare: e.message } }
  await db.close()
  const r = { rez: {}, cai: [], nerez: [], necun: [], nod: {}, rad: {}, excl: [], ms: Date.now() - t0 }
  for (const set of rez) {
    for (const row of set.rows || []) {
      if (!row || typeof row.sectiune !== 'string') continue
      if (row.sectiune === 'N_audit_rezumat') r.rez[row.obiect] = row.detaliu
      else if (row.sectiune === 'N_audit_cale') r.cai.push({ drum: row.obiect, detaliu: row.detaliu })
      else if (row.sectiune === 'N_audit_nerezolvat') r.nerez.push({ obiect: row.obiect, detaliu: row.detaliu })
      else if (row.sectiune === 'N_audit_necunoscut') r.necun.push({ obiect: row.obiect, detaliu: row.detaliu })
      else if (row.sectiune === 'N_audit_radacina') r.rad[row.obiect] = row.detaliu
      else if (row.sectiune === 'N_audit_trigger_exclus') r.excl.push(row.obiect)
      else if (row.sectiune === 'N_audit_nod') r.nod[row.obiect] = { adancime: row.adancime, definer: row.security_definer, detaliu: row.detaliu }
    }
  }
  return r
}

const filtru = process.argv[2]
for (const [nume, extra, verif] of CAZURI) {
  if (filtru && !nume.includes(filtru)) continue
  const r = await ruleaza(extra)
  if (r.eroare) { ok(false, `${nume}: porti_citire.sql a picat: ${r.eroare}`); continue }
  ok(Object.keys(r.rez).length === 17, `${nume}: rezumatul are 17 randuri (${r.ms} ms)`)
  for (const [c, m] of verif(r)) ok(c, `${nume}: ${m}`)
}
// Mutantii auditului: fiecare scoate O regula a modelului; cazul care o dovedeste TREBUIE sa pice (altfel testul nu
// prinde regula). [descriere, text original din porti_citire.sql, inlocuire, numele cazului]
const MUTANTI = [
  ['apel fara verificarea EXECUTE', 'JOIN exec x ON x.oid = g.oid\n       WHERE NOT g.trigger_fn',
    'JOIN rol_cand x ON true\n       WHERE NOT g.trigger_fn', 'EXECUTE lipsa pe veriga din mijloc'],
  ['functiile de trigger ca radacini', "has_function_privilege((SELECT rol0 FROM par), f.oid, 'EXECUTE') AND NOT f.trigger_fn\n     AND NOT (f.schema",
    "has_function_privilege((SELECT rol0 FROM par), f.oid, 'EXECUTE')\n     AND NOT (f.schema", 'functie de trigger executabila de PUBLIC'],
  ['FK generic (orice stergere scrie in copil)', "CASE co.confdeltype WHEN 'c' THEN 'DELETE' WHEN 'n' THEN 'UPDATE' WHEN 'd' THEN 'UPDATE' END",
    "'DELETE'", 'FK NO ACTION'],
  ['scriere fara verificarea dreptului', 'JOIN rel c ON c.nume = w.nume JOIN drept dr ON dr.oid = c.oid',
    'JOIN rel c ON c.nume = w.nume JOIN (SELECT r9.rol, c9.oid, o9.op FROM rol_cand r9 CROSS JOIN rel c9 CROSS JOIN operatie o9) dr ON dr.oid = c.oid',
    'scriere INVOKER intr-un tabel fara drept'],
  ['politica fara rolurile ei', "AND (0 = ANY (po.polroles) OR", "AND (true OR", 'politica evaluata la citirea'],
  ['triggerul declansat de orice operatie', '(tg.tgtype::integer & o.bit) <> 0', 'true', 'trigger pe alta operatie'],
]
for (const [desc, din, in_, caz] of MUTANTI) {
  if (filtru) break
  const k = SQL.split(din).length - 1
  if (k !== 1) { ok(false, `mutant „${desc}”: textul original apare de ${k} ori in porti_citire.sql`); continue }
  const [nume, extra, verif] = CAZURI.find(c => c[0].startsWith(caz)) || []
  if (!nume) { ok(false, `mutant „${desc}”: cazul ${caz} lipseste`); continue }
  const r = await ruleaza(extra, SQL.replace(din, in_))
  const picate = r.eroare ? 1 : verif(r).filter(([c]) => !c).length
  ok(picate > 0, `mutant „${desc}” RESPINS de cazul „${nume}” (${picate} verificari picate)`)
}
console.log(esecuri ? `AUDIT_TRANZITIV_PGLITE: ${esecuri} verificari picate` : 'AUDIT_TRANZITIV_PGLITE: OK')
process.exit(esecuri ? 1 : 0)
