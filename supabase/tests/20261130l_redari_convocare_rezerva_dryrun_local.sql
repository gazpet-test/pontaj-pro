-- DRY LOCAL 20261130l_redari_convocare_rezerva (r3: RPC SECURITY INVOKER) — DOAR pe clusterul PG17 de unica folosinta creat de
-- scripts/redari_30l_dry_local.sh (schelet 20261130l_..._schelet.sql cu functiile LIVE reale, inclusiv lock-ul de plic pe UAT + migrarea, COMISE).
-- NU se ruleaza pe productie: scrie date fictive si comite (concurenta reala intre conexiuni prin dblink cere tranzactii comise).
-- Garda TEST0: GUC gazpet.dry_local = 'DA'. Proiectul fictiv are codul TEST-RAZVAN, ca DRY-ul de productie sa poata rula si aici, dupa revenire.
-- Identitati fictive: owner (admin), editor, viewer, un profil fara nivel; anon si authenticated fara sub. Fiecare apel ruleaza pe o conexiune
-- dblink proprie cu request.jwt.claims + SET ROLE (ca PostgREST). public.t_stare(sql) intoarce 'OK:<valoare>' sau '<SQLSTATE>:<mesaj>'.
-- psql: -v port=<portul clusterului local>.
SELECT set_config('t.port', :'port', false);
DO $g$ BEGIN
  IF current_setting('gazpet.dry_local', true) IS DISTINCT FROM 'DA' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'TEST0 FAIL: garda (doar cluster local)'; END IF;
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: migrarea lipseste'; END IF;
END $g$;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE FUNCTION public.t_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  EXECUTE p_sql INTO v; RETURN 'OK:' || coalesce(v, '');
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END $f$;
GRANT EXECUTE ON FUNCTION public.t_stare(text) TO anon, authenticated, service_role;
-- conexiune dblink cu identitate: p_uid NULL = fara sub; p_rol = anon / authenticated / service_role / postgres (fara SET ROLE)
CREATE FUNCTION public.t_conn(p_nume text, p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_nume = ANY (coalesce(dblink_get_connections(), '{}')) THEN PERFORM dblink_disconnect(p_nume); END IF;
  PERFORM dblink_connect(p_nume, format('host=127.0.0.1 port=%s dbname=postgres user=postgres', current_setting('t.port')));
  IF p_rol = 'postgres' THEN RETURN; END IF;
  PERFORM * FROM dblink(p_nume, format('SELECT set_config(%L, %L, false)', 'request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol) ELSE jsonb_build_object('sub', p_uid, 'role', p_rol) END::text)) AS t(x text);
  PERFORM dblink_exec(p_nume, format('SET ROLE %I', p_rol));
END $f$;
CREATE FUNCTION public.t_sql_rez(p_det uuid, p_confirmat boolean DEFAULT false, p_canal text DEFAULT 'posta') RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT format('SELECT public.t_stare(%L)', format('SELECT nr_document FROM public.fn_red_convocare_rezerva(%L::uuid, %L, %L)', p_det, p_confirmat, p_canal)) $f$;
CREATE FUNCTION public.t_rez(p_conn text, p_det text, p_confirmat boolean DEFAULT false) RETURNS text LANGUAGE sql AS $f$
  SELECT r FROM dblink(p_conn, public.t_sql_rez(p_det::uuid, p_confirmat)) AS t(r text) $f$;
CREATE FUNCTION public.t_det(p_cheie text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT id FROM public.red_detinatori WHERE nume = 'DRY30L ' || p_cheie $f$;
CREATE FUNCTION public.t_nr() RETURNS integer LANGUAGE sql STABLE AS $f$ SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) $f$;
CREATE FUNCTION public.t_active(p_cheie text) RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT count(*)::int FROM public.red_convocari WHERE detinator_id = public.t_det(p_cheie) AND canal = 'posta' AND stare = 'activ' AND data_expediere IS NULL AND sters_la IS NULL $f$;
-- scriere de fixture COMISĂ (conexiune postgres separată, autocommit) — vizibilă pentru conexiunile de test
CREATE FUNCTION public.t_pg(p_sql text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT ('pg' = ANY (coalesce(dblink_get_connections(), '{}'))) THEN
    PERFORM dblink_connect('pg', format('host=127.0.0.1 port=%s dbname=postgres user=postgres', current_setting('t.port')));
  END IF;
  PERFORM dblink_exec('pg', p_sql);
END $f$;
CREATE FUNCTION public.t_rezultat(p_conn text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  SELECT x INTO r FROM dblink_get_result(p_conn) AS t(x text);
  PERFORM * FROM dblink_get_result(p_conn) AS t(x text);   -- golirea rezultatului
  RETURN r;
END $f$;

-- date fictive (comise); proiect complet (gărzile RD002 trec)
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner.test@exemplu.local', 'OWNER TEST', true),
  ('00000000-0000-0000-0000-0000000000a2', 'editor.test@exemplu.local', 'EDITOR TEST', false),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer.test@exemplu.local', 'VIEWER TEST', false),
  ('00000000-0000-0000-0000-0000000000a5', 'fara.test@exemplu.local', 'FARA NIVEL', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'redari', 'editor'), ('00000000-0000-0000-0000-0000000000a3', 'redari', 'viewer');
INSERT INTO public.red_proiecte (id, cod, denumire, contract_nr, contract_data, imputernicire_nr, imputernicire_data, reprezentant_tgz_nume, reprezentant_tgz_telefon,
  contact_nume, contact_telefon, contact_email, text_gdpr)
  VALUES ('00000000-0000-0000-0000-00000000b001', 'TEST-RAZVAN', 'Proiect DRY (fictiv)', '12', '2026-10-01', '7', '2026-10-20', 'R. TGZ', '0700000001',
  'Ion Test', '0700000002', 'test@exemplu.local', 'Operator: test.');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, program_zi1)
  VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'Test', 'TST', '2026-12-01', '09-15');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela, tronson)
  SELECT ('00000000-0000-0000-0000-0000000d' || lpad(i::text, 4, '0'))::uuid, '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001',
         'TST-' || lpad(i::text, 4, '0'), 1 FROM generate_series(1, 18) i;
INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  SELECT ('00000000-0000-0000-0000-0000000d' || lpad(i::text, 4, '0'))::uuid, 'DRY30L D' || i, 'dry30l d' || i, 'proprietar' FROM generate_series(1, 18) i;
INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta)
  SELECT id, 'Str. Test 1', 'Testeni', 'Testeni', 'Mehedinti', '200000', true FROM public.red_detinatori;
UPDATE public.red_detinatori SET sters_la = now() WHERE nume = 'DRY30L D8';
UPDATE public.red_detinatori SET calitate = 'neidentificat' WHERE nume = 'DRY30L D11';
-- plic activ neexpediat pentru D5 (garda pe persoana din trigger trebuie sa refuze)
INSERT INTO public.red_plicuri (uat_id, nr_plic, cheie_persoana, stare)
  SELECT '00000000-0000-0000-0000-00000000c001', 'P-0001', public.fn_red_cheie_persoana(public.t_det('D5')), 'activ';
DO $t$ BEGIN IF (SELECT cheie_persoana FROM public.red_plicuri WHERE nr_plic = 'P-0001') IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: cheia persoanei D5 e NULL'; END IF; END $t$;

SELECT public.t_conn('ed', '00000000-0000-0000-0000-0000000000a2', 'authenticated');
SELECT public.t_conn('ow', '00000000-0000-0000-0000-0000000000a1', 'authenticated');

-- TEST1: refuzuri de acces si de parametri — niciun numar consumat
DO $t$
DECLARE r text;
BEGIN
  PERFORM public.t_conn('an', NULL, 'anon');
  r := public.t_rez('an', public.t_det('D1')::text);
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST1 FAIL anon: %', r; END IF;
  PERFORM public.t_conn('au', NULL, 'authenticated');
  r := public.t_rez('au', public.t_det('D1')::text);
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST1 FAIL authenticated fara sub: %', r; END IF;
  PERFORM public.t_conn('vw', '00000000-0000-0000-0000-0000000000a3', 'authenticated');
  r := public.t_rez('vw', public.t_det('D1')::text);
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST1 FAIL viewer: %', r; END IF;
  PERFORM public.t_conn('fa', '00000000-0000-0000-0000-0000000000a5', 'authenticated');
  r := public.t_rez('fa', public.t_det('D1')::text);
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST1 FAIL fara nivel: %', r; END IF;
  SELECT x INTO r FROM dblink('ed', $q$SELECT public.t_stare('SELECT nr_document FROM public.fn_red_convocare_rezerva(NULL)')$q$) AS t(x text);
  IF r NOT LIKE '22023:%' THEN RAISE EXCEPTION 'TEST1 FAIL null: %', r; END IF;
  r := public.t_rez('ed', public.t_det('D8')::text);
  IF r NOT LIKE 'P0002:%' THEN RAISE EXCEPTION 'TEST1 FAIL detinator sters: %', r; END IF;
  PERFORM public.t_conn('sr', NULL, 'service_role');
  r := public.t_rez('sr', public.t_det('D1')::text);
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST1 FAIL service_role: %', r; END IF;
  IF public.t_nr() <> 0 OR (SELECT count(*) FROM public.red_convocari) <> 0 THEN RAISE EXCEPTION 'TEST1 FAIL: refuzurile au consumat numere / au scris'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST1b: doar READ COMMITTED
DO $t$
DECLARE r text;
BEGIN
  PERFORM dblink_exec('ed', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  r := public.t_rez('ed', public.t_det('D1')::text);
  PERFORM dblink_exec('ed', 'ROLLBACK');
  IF r NOT LIKE '25001:%' THEN RAISE EXCEPTION 'TEST1b FAIL: %', r; END IF;
  IF public.t_nr() <> 0 THEN RAISE EXCEPTION 'TEST1b FAIL: numar consumat'; END IF;
  RAISE NOTICE 'TEST1b OK';
END $t$;

-- TEST1c: SECURITY INVOKER (RLS + triggerele utilizatorului)
DO $t$ BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure) THEN RAISE EXCEPTION 'TEST1c FAIL: e DEFINER'; END IF;
  RAISE NOTICE 'TEST1c OK';
END $t$;

-- TEST2: editorul rezerva: C-0001, rand posta activ, created_by = editorul, jurnal cu utilizatorul
DO $t$
DECLARE r text; c record;
BEGIN
  r := public.t_rez('ed', public.t_det('D1')::text);
  IF r <> 'OK:C-0001' THEN RAISE EXCEPTION 'TEST2 FAIL: %', r; END IF;
  SELECT * INTO c FROM public.red_convocari WHERE nr_document = 'C-0001';
  IF c.detinator_id <> public.t_det('D1') OR c.canal <> 'posta' OR c.stare <> 'activ' OR c.data_expediere IS NOT NULL OR c.fisier_convocator_path IS NOT NULL
     OR c.created_by IS DISTINCT FROM '00000000-0000-0000-0000-0000000000a2'::uuid THEN RAISE EXCEPTION 'TEST2 FAIL: randul %', row_to_json(c); END IF;
  IF public.t_nr() <> 1 THEN RAISE EXCEPTION 'TEST2 FAIL: contor %', public.t_nr(); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_convocari' AND inregistrare_id = c.id AND actiune = 'insert'
                   AND user_id = '00000000-0000-0000-0000-0000000000a2'::uuid) THEN RAISE EXCEPTION 'TEST2 FAIL: jurnal'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3: a doua rezervare pentru D1 → RD001 (cu numarul existent), fara numar consumat; owner-ul la fel
DO $t$
DECLARE r text;
BEGIN
  r := public.t_rez('ed', public.t_det('D1')::text);
  IF r NOT LIKE 'RD001:%C-0001%' THEN RAISE EXCEPTION 'TEST3 FAIL: %', r; END IF;
  r := public.t_rez('ow', public.t_det('D1')::text);
  IF r NOT LIKE 'RD001:%' THEN RAISE EXCEPTION 'TEST3 FAIL owner: %', r; END IF;
  IF public.t_nr() <> 1 OR public.t_active('D1') <> 1 THEN RAISE EXCEPTION 'TEST3 FAIL: consum'; END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST3b: o convocare activa neexpediata FARA nr_document blocheaza la fel (EXISTS, nu string_agg)
DO $t$
DECLARE r text; n0 int := public.t_nr();
BEGIN
  PERFORM public.t_pg(format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (%L, ''posta'', NULL)', public.t_det('D12')));   -- fixture COMISA
  r := public.t_rez('ed', public.t_det('D12')::text);
  IF r NOT LIKE 'RD001:%fara numar%' OR public.t_nr() <> n0 THEN RAISE EXCEPTION 'TEST3b FAIL: %', r; END IF;
  RAISE NOTICE 'TEST3b OK';
END $t$;

-- TEST4: p_numar_nou_confirmat = true → a doua convocare, C-0002 (acceptarea explicita)
DO $t$
DECLARE r text;
BEGIN
  r := public.t_rez('ow', public.t_det('D1')::text, true);
  IF r <> 'OK:C-0002' OR public.t_active('D1') <> 2 THEN RAISE EXCEPTION 'TEST4 FAIL: % / %', r, public.t_active('D1'); END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;

-- TEST4b: convocarile expediate / anulate / sterse logic / alt canal NU blocheaza (fixture ca postgres: trg posta_garda il lasa pe owner)
DO $t$
DECLARE r text;
BEGIN
  PERFORM public.t_pg(format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document, data_expediere) VALUES (%L, ''posta'', ''X-1'', current_date)', public.t_det('D2')));
  PERFORM public.t_pg(format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document, stare) VALUES (%L, ''posta'', ''X-2'', ''anulat'')', public.t_det('D2')));
  PERFORM public.t_pg(format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document, sters_la) VALUES (%L, ''posta'', ''X-3'', now())', public.t_det('D2')));
  PERFORM public.t_pg(format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (%L, ''sms'', ''X-4'')', public.t_det('D2')));
  IF (SELECT count(*) FROM public.red_convocari WHERE detinator_id = public.t_det('D2')) <> 4 THEN RAISE EXCEPTION 'TEST4b FAIL: fixture necomisa'; END IF;
  r := public.t_rez('ed', public.t_det('D2')::text);
  IF r <> 'OK:C-0003' THEN RAISE EXCEPTION 'TEST4b FAIL: %', r; END IF;
  RAISE NOTICE 'TEST4b OK';
END $t$;

-- TEST5: garda de plic pe persoana — acum din TRIGGER (INVOKER) → 23514; numarul se anuleaza odata cu tranzactia
DO $t$
DECLARE r text; n0 int := public.t_nr();
BEGIN
  r := public.t_rez('ed', public.t_det('D5')::text);
  IF r NOT LIKE '23514:%plic%' THEN RAISE EXCEPTION 'TEST5 FAIL: %', r; END IF;
  IF public.t_nr() <> n0 OR public.t_active('D5') <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: numar consumat / rand scris'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST5b: gărzile pe proiect / UAT recitite din BD (RD002): împuternicire retrasă, sesiune fără program, deținător neidentificat
DO $t$
DECLARE r text; n0 int := public.t_nr();
BEGIN
  PERFORM public.t_pg('UPDATE public.red_proiecte SET imputernicire_nr = NULL WHERE cod = ''TEST-RAZVAN''');
  r := public.t_rez('ed', public.t_det('D3')::text);
  IF r NOT LIKE 'RD002:%imputernicire%' THEN RAISE EXCEPTION 'TEST5b FAIL imputernicire: %', r; END IF;
  PERFORM public.t_pg('UPDATE public.red_proiecte SET imputernicire_nr = ''7'' WHERE cod = ''TEST-RAZVAN''');
  PERFORM public.t_pg('UPDATE public.red_uat SET program_zi1 = '' '' WHERE uat3 = ''TST''');
  r := public.t_rez('ed', public.t_det('D3')::text);
  IF r NOT LIKE 'RD002:%sesiune%' THEN RAISE EXCEPTION 'TEST5b FAIL sesiune: %', r; END IF;
  PERFORM public.t_pg('UPDATE public.red_uat SET program_zi1 = ''09-15'' WHERE uat3 = ''TST''');
  r := public.t_rez('ed', public.t_det('D11')::text);
  IF r NOT LIKE 'RD002:%neidentificat%' THEN RAISE EXCEPTION 'TEST5b FAIL neidentificat: %', r; END IF;
  IF public.t_nr() <> n0 THEN RAISE EXCEPTION 'TEST5b FAIL: numar consumat'; END IF;
  RAISE NOTICE 'TEST5b OK';
END $t$;

-- TEST6: CONCURENTA pe acelasi detinator (D3): c1 tine tranzactia deschisa dupa rezervare; c2 asteapta lock-ul de detinator; dupa COMMIT c1 → RD001
DO $t$
DECLARE r1 text; r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM public.t_conn('c1', '00000000-0000-0000-0000-0000000000a2', 'authenticated');
  PERFORM public.t_conn('c2', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
  PERFORM public.t_conn('c3', NULL, 'postgres');
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D3')::text);
  IF r1 NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST6 FAIL c1: %', r1; END IF;
  PERFORM dblink_send_query('c2', public.t_sql_rez(public.t_det('D3')));
  PERFORM pg_sleep(0.5);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST6 FAIL: c2 nu asteapta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) THEN RAISE EXCEPTION 'TEST6 FAIL: niciun advisory lock in asteptare'; END IF;
  PERFORM dblink_exec('c1', 'COMMIT');
  r2 := public.t_rezultat('c2');
  IF r2 NOT LIKE 'RD001:%' THEN RAISE EXCEPTION 'TEST6 FAIL c2: %', r2; END IF;
  IF public.t_active('D3') <> 1 OR public.t_nr() <> n0 + 1 THEN RAISE EXCEPTION 'TEST6 FAIL: % convocari, contor % (era %)', public.t_active('D3'), public.t_nr(), n0; END IF;
  RAISE NOTICE 'TEST6 OK (acelasi detinator: o singura convocare, un singur numar)';
END $t$;

-- TEST6b: c1 face ROLLBACK → c2 rezerva (nimic ramas de la c1, numarul lui c1 anulat)
DO $t$
DECLARE r1 text; r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D4')::text);
  IF r1 NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST6b FAIL c1: %', r1; END IF;
  PERFORM dblink_send_query('c2', public.t_sql_rez(public.t_det('D4')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST6b FAIL: c2 nu asteapta'; END IF;
  PERFORM dblink_exec('c1', 'ROLLBACK');
  r2 := public.t_rezultat('c2');
  IF r2 NOT LIKE 'OK:C-%' OR public.t_active('D4') <> 1 OR public.t_nr() <> n0 + 1 THEN RAISE EXCEPTION 'TEST6b FAIL c2: % / % / %', r2, public.t_active('D4'), public.t_nr(); END IF;
  RAISE NOTICE 'TEST6b OK';
END $t$;

-- TEST7: detinatori DIFERITI in acelasi UAT, c1 cu tranzactia deschisa: c2 NU asteapta lock-ul de detinator, ci randul 'C' din red_numere
-- (tinut de c1); dupa COMMIT c1 lock-ul de plic pe UAT e liber → c2 reuseste, numere distincte
DO $t$
DECLARE r1 text; r2 text;
BEGIN
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D6')::text);
  PERFORM dblink_send_query('c2', public.t_sql_rez(public.t_det('D7')));
  PERFORM pg_sleep(0.3);
  IF EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) THEN RAISE EXCEPTION 'TEST7 FAIL: advisory lock comun pe detinatori diferiti'; END IF;
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST7 FAIL: c2 nu asteapta randul C'; END IF;
  PERFORM dblink_exec('c1', 'COMMIT');
  r2 := public.t_rezultat('c2');
  IF r1 NOT LIKE 'OK:C-%' OR r2 NOT LIKE 'OK:C-%' OR r1 = r2 THEN RAISE EXCEPTION 'TEST7 FAIL: % / %', r1, r2; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;

-- TEST7b: lock-ul REAL de plic pe UAT tinut de altcineva (plicuire in curs, c3 = fn_red_plic_incearca_lock) → c2 primeste 55P03 imediat,
-- fara numar consumat si fara rand (tranzactia lui c2 se anuleaza intreaga)
DO $t$
DECLARE r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM dblink_exec('c3', 'BEGIN');
  PERFORM * FROM dblink('c3', $q$SELECT public.fn_red_plic_incearca_lock('00000000-0000-0000-0000-00000000c001')::text$q$) AS t(x text);
  r2 := public.t_rez('c2', public.t_det('D9')::text);
  PERFORM dblink_exec('c3', 'ROLLBACK');
  IF r2 NOT LIKE '55P03:%' THEN RAISE EXCEPTION 'TEST7b FAIL: %', r2; END IF;
  IF public.t_nr() <> n0 OR public.t_active('D9') <> 0 THEN RAISE EXCEPTION 'TEST7b FAIL: numar / rand ramas'; END IF;
  RAISE NOTICE 'TEST7b OK (UAT ocupat: 55P03, nimic consumat)';
END $t$;

-- TEST9: stergere logica CONCURENTA, comisa dupa citirea preliminara: c3 tine UPDATE-ul (sters_la) deschis; c2 asteapta la FOR SHARE;
-- dupa COMMIT c3, c2 recitește randul → P0002, nimic consumat
DO $t$
DECLARE r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM dblink_exec('c3', 'BEGIN');
  PERFORM dblink_exec('c3', format('UPDATE public.red_detinatori SET sters_la = now() WHERE id = %L', public.t_det('D13')));
  PERFORM dblink_send_query('c2', public.t_sql_rez(public.t_det('D13')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST9 FAIL: c2 nu asteapta randul deținătorului'; END IF;
  PERFORM dblink_exec('c3', 'COMMIT');
  r2 := public.t_rezultat('c2');
  IF r2 NOT LIKE 'P0002:%' OR public.t_nr() <> n0 OR public.t_active('D13') <> 0 THEN RAISE EXCEPTION 'TEST9 FAIL: % / %', r2, public.t_nr(); END IF;
  RAISE NOTICE 'TEST9 OK (stergere concurenta: P0002)';
END $t$;

-- TEST9b: invers — rezervarea lui c1 e deschisa; stergerea logica (c3) asteapta FOR SHARE pana la COMMIT c1
DO $t$
DECLARE r1 text;
BEGIN
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D14')::text);
  IF r1 NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST9b FAIL c1: %', r1; END IF;
  PERFORM dblink_send_query('c3', format('UPDATE public.red_detinatori SET sters_la = now() WHERE id = %L RETURNING id::text', public.t_det('D14')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('c3') <> 1 THEN RAISE EXCEPTION 'TEST9b FAIL: stergerea nu asteapta rezervarea'; END IF;
  PERFORM dblink_exec('c1', 'COMMIT');
  PERFORM public.t_rezultat('c3');
  IF public.t_active('D14') <> 1 THEN RAISE EXCEPTION 'TEST9b FAIL'; END IF;
  RAISE NOTICE 'TEST9b OK (stergerea a asteptat rezervarea comisa)';
END $t$;

-- TEST10: calea INDIVIDUALĂ (modal: canal ales, fără bifă) concurentă cu LOTUL (poștă) pe același deținător → o singură convocare
DO $t$
DECLARE r1 text; r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := (SELECT x FROM dblink('c1', public.t_sql_rez(public.t_det('D15'), false, 'posta')) AS t(x text));   -- individual
  IF r1 NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST10 FAIL individual: %', r1; END IF;
  PERFORM dblink_send_query('c2', public.t_sql_rez(public.t_det('D15')));                                    -- lotul
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST10 FAIL: lotul nu asteapta'; END IF;
  PERFORM dblink_exec('c1', 'COMMIT');
  r2 := public.t_rezultat('c2');
  IF r2 NOT LIKE 'RD001:%' OR public.t_active('D15') <> 1 OR public.t_nr() <> n0 + 1 THEN RAISE EXCEPTION 'TEST10 FAIL: % / %', r2, public.t_active('D15'); END IF;
  -- bifa explicită din modal (p_numar_nou_confirmat) = singura excepție
  r2 := (SELECT x FROM dblink('ed', public.t_sql_rez(public.t_det('D15'), true, 'posta')) AS t(x text));
  IF r2 NOT LIKE 'OK:C-%' OR public.t_active('D15') <> 2 THEN RAISE EXCEPTION 'TEST10 FAIL confirmat: %', r2; END IF;
  RAISE NOTICE 'TEST10 OK (individual vs lot: o convocare; bifa explicita = a doua)';
END $t$;

-- TEST11: canalul — RD001 pe ACELAȘI canal; canal invalid → 22023
DO $t$
DECLARE r text;
BEGIN
  r := (SELECT x FROM dblink('ed', public.t_sql_rez(public.t_det('D16'), false, 'email')) AS t(x text));
  IF r NOT LIKE 'OK:C-%' OR (SELECT canal FROM public.red_convocari WHERE nr_document = substr(r, 4)) <> 'email' THEN RAISE EXCEPTION 'TEST11 FAIL email: %', r; END IF;
  r := (SELECT x FROM dblink('ed', public.t_sql_rez(public.t_det('D16'), false, 'email')) AS t(x text));
  IF r NOT LIKE 'RD001:%email%' THEN RAISE EXCEPTION 'TEST11 FAIL email dublu: %', r; END IF;
  r := (SELECT x FROM dblink('ed', public.t_sql_rez(public.t_det('D16'), false, 'posta')) AS t(x text));
  IF r NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST11 FAIL posta dupa email: %', r; END IF;
  r := (SELECT x FROM dblink('ed', public.t_sql_rez(public.t_det('D16'), false, 'telefon')) AS t(x text));
  IF r NOT LIKE '22023:%' THEN RAISE EXCEPTION 'TEST11 FAIL telefon: %', r; END IF;
  RAISE NOTICE 'TEST11 OK';
END $t$;

-- TEST2b (r5 P1-01): RPC-ul întoarce identitatea folosită de server (parcela / UAT / proiect)
DO $t$
DECLARE r text;
BEGIN
  SELECT x INTO r FROM dblink('ed', format($q$SELECT public.t_stare(%L)$q$,
    format('SELECT nr_document || ''|'' || parcela_id || ''|'' || uat_id || ''|'' || proiect_id FROM public.fn_red_convocare_rezerva(%L::uuid)', public.t_det('D17')))) AS t(x text);
  IF r NOT LIKE 'OK:C-%|' || (SELECT parcela_id FROM public.red_detinatori WHERE id = public.t_det('D17')) || '|00000000-0000-0000-0000-00000000c001|00000000-0000-0000-0000-00000000b001' THEN
    RAISE EXCEPTION 'TEST2b FAIL: %', r; END IF;
  RAISE NOTICE 'TEST2b OK (identitatea serverului intoarsa)';
END $t$;

-- TEST12 (r5 P1-02): INSERT direct în red_convocari (client vechi / PostgREST direct) → RD004, pe orice canal; prin RPC → OK
DO $t$
DECLARE r text; c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['posta', 'sms', 'email', 'afisare', 'telefon'] LOOP
    SELECT x INTO r FROM dblink('ed', format($q$SELECT public.t_stare(%L)$q$,
      format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (%L, %L, %L) RETURNING id::text', public.t_det('D18'), c, 'VECHI-' || c))) AS t(x text);
    IF r NOT LIKE 'RD004:%Reincarca pagina%' THEN RAISE EXCEPTION 'TEST12 FAIL canal %: %', c, r; END IF;
  END LOOP;
  -- vechea secvență a clientului: număr C separat + INSERT direct → INSERT-ul e refuzat (numărul vechi rămâne gol în serie, ca înainte)
  SELECT x INTO r FROM dblink('ed', $q$SELECT public.t_stare('SELECT public.fn_red_numar_document(''C'', ''TST'', 1)')$q$) AS t(x text);
  SELECT x INTO r FROM dblink('ed', format($q$SELECT public.t_stare(%L)$q$,
    format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (%L, ''posta'', %L) RETURNING id::text', public.t_det('D18'), substr(r, 4)))) AS t(x text);
  IF r NOT LIKE 'RD004:%' THEN RAISE EXCEPTION 'TEST12 FAIL client vechi: %', r; END IF;
  IF (SELECT count(*) FROM public.red_convocari WHERE detinator_id = public.t_det('D18')) <> 0 THEN RAISE EXCEPTION 'TEST12 FAIL: rand scris'; END IF;
  r := public.t_rez('ed', public.t_det('D18')::text);
  IF r NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST12 FAIL RPC: %', r; END IF;
  IF current_setting('gazpet.convocare_rezerva', true) IS NOT NULL AND current_setting('gazpet.convocare_rezerva', true) <> '' THEN RAISE EXCEPTION 'TEST12 FAIL: marcaj scurs'; END IF;
  RAISE NOTICE 'TEST12 OK (INSERT direct refuzat pe toate canalele, client vechi refuzat, RPC ok)';
END $t$;

-- TEST12b (mutant): fără trigger, INSERT-ul direct ar trece → triggerul e cel care impune protocolul
DO $t$
DECLARE r text;
BEGIN
  PERFORM public.t_pg('ALTER TABLE public.red_convocari DISABLE TRIGGER trg_red_convocari_garda_rezerva');
  SELECT x INTO r FROM dblink('ed', format($q$SELECT public.t_stare(%L)$q$,
    format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (%L, ''email'', ''MUTANT-1'') RETURNING id::text', public.t_det('D18')))) AS t(x text);
  PERFORM public.t_pg('ALTER TABLE public.red_convocari ENABLE TRIGGER trg_red_convocari_garda_rezerva');
  IF r NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'TEST12b FAIL: mutantul (fara trigger) ar fi trebuit sa permita INSERT-ul: %', r; END IF;
  PERFORM public.t_pg('DELETE FROM public.red_convocari WHERE nr_document = ''MUTANT-1''');
  RAISE NOTICE 'TEST12b OK (mutant fara trigger -> INSERT direct permis; triggerul repornit)';
END $t$;

-- TEST13 (r5 P2-03): proiectul se schimbă între citirea cheii și lock (parcelă mutată, comisă în timp ce RPC-ul așteaptă la FOR SHARE) → RD003
DO $t$
DECLARE r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM public.t_pg($q$INSERT INTO public.red_proiecte (id, cod, denumire, contract_nr, contract_data, imputernicire_nr, imputernicire_data, reprezentant_tgz_nume,
    reprezentant_tgz_telefon, contact_nume, contact_telefon, contact_email, text_gdpr) VALUES ('00000000-0000-0000-0000-00000000b002', 'ALT-DRY', 'Alt', '1', '2026-10-01', '1',
    '2026-10-01', 'R', '07', 'N', '07', 'a@b.local', 'Operator: test.') ON CONFLICT DO NOTHING$q$);
  PERFORM dblink_exec('c3', 'BEGIN');
  PERFORM dblink_exec('c3', format('UPDATE public.red_parcele SET proiect_id = %L WHERE id = (SELECT parcela_id FROM public.red_detinatori WHERE id = %L)',
    '00000000-0000-0000-0000-00000000b002', public.t_det('D10')));
  PERFORM dblink_send_query('c2', public.t_sql_rez(public.t_det('D10')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST13 FAIL: c2 nu asteapta'; END IF;
  PERFORM dblink_exec('c3', 'COMMIT');
  r2 := public.t_rezultat('c2');
  IF r2 NOT LIKE 'RD003:%' OR public.t_nr() <> n0 OR public.t_active('D10') <> 0 THEN RAISE EXCEPTION 'TEST13 FAIL: % / %', r2, public.t_nr(); END IF;
  RAISE NOTICE 'TEST13 OK (proiect schimbat sub lock: RD003, nimic consumat)';
END $t$;

-- TEST8: ACL + setari
DO $t$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.fn_red_convocare_rezerva(uuid,boolean,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_convocare_rezerva(uuid,boolean,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_red_convocare_rezerva(uuid,boolean,text)', 'EXECUTE') THEN RAISE EXCEPTION 'TEST8 FAIL: ACL'; END IF;
  RAISE NOTICE 'TEST8 OK';
END $t$;
SELECT dblink_disconnect(c) FROM unnest(dblink_get_connections()) c;
SELECT 'TESTE_LOCAL_OK';
