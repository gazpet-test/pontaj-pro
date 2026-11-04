-- DRY LOCAL 20261130l_redari_convocare_rezerva — DOAR pe clusterul PG17 de unica folosinta creat de scripts/redari_30l_dry_local.sh
-- (schelet 20261130l_..._schelet.sql + migrarea, COMISE). NU se ruleaza pe productie: scrie date fictive si comite (concurenta reala intre
-- conexiuni prin dblink cere tranzactii comise). Garda TEST0: GUC gazpet.dry_local = 'DA' + proiectul fictiv (cod TEST-RAZVAN, ca DRY-ul de productie sa poata rula si aici, dupa revenire).
-- Identitati fictive: owner (admin), editor, viewer, un profil fara nivel; anon si authenticated fara sub. Fiecare apel ruleaza pe o conexiune
-- dblink proprie cu request.jwt.claims + SET ROLE (ca PostgREST). public.t_stare(sql) intoarce 'OK:<valoare>' sau '<SQLSTATE>:<mesaj>'.
-- psql: -v port=<portul clusterului local>.
SELECT set_config('t.port', :'port', false);
DO $g$ BEGIN
  IF current_setting('gazpet.dry_local', true) IS DISTINCT FROM 'DA' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'TEST0 FAIL: garda (doar cluster local)'; END IF;
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean)') IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: migrarea lipseste'; END IF;
END $g$;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE FUNCTION public.t_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  EXECUTE p_sql INTO v; RETURN 'OK:' || coalesce(v, '');
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END $f$;
GRANT EXECUTE ON FUNCTION public.t_stare(text) TO anon, authenticated, service_role;
-- conexiune dblink cu identitate: p_uid NULL = fara sub; p_rol = anon / authenticated / service_role
CREATE FUNCTION public.t_conn(p_nume text, p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_nume = ANY (coalesce(dblink_get_connections(), '{}')) THEN PERFORM dblink_disconnect(p_nume); END IF;
  PERFORM dblink_connect(p_nume, format('host=127.0.0.1 port=%s dbname=postgres user=postgres', current_setting('t.port')));
  PERFORM * FROM dblink(p_nume, format('SELECT set_config(%L, %L, false)', 'request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol) ELSE jsonb_build_object('sub', p_uid, 'role', p_rol) END::text)) AS t(x text);
  PERFORM dblink_exec(p_nume, format('SET ROLE %I', p_rol));
END $f$;
CREATE FUNCTION public.t_rez(p_conn text, p_det text, p_confirmat boolean DEFAULT false) RETURNS text LANGUAGE sql AS $f$
  SELECT r FROM dblink(p_conn, format('SELECT public.t_stare(%L)', format('SELECT nr_document FROM public.fn_red_convocare_rezerva(%L::uuid, %L)', p_det, p_confirmat))) AS t(r text)
$f$;
CREATE FUNCTION public.t_det(p_cheie text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT id FROM public.red_detinatori WHERE nume = 'DRY30L ' || p_cheie $f$;
CREATE FUNCTION public.t_nr() RETURNS integer LANGUAGE sql STABLE AS $f$ SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) $f$;
CREATE FUNCTION public.t_active(p_cheie text) RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT count(*)::int FROM public.red_convocari WHERE detinator_id = public.t_det(p_cheie) AND canal = 'posta' AND stare = 'activ' AND data_expediere IS NULL AND sters_la IS NULL $f$;

-- date fictive (comise)
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner.test@exemplu.local', 'OWNER TEST', true),
  ('00000000-0000-0000-0000-0000000000a2', 'editor.test@exemplu.local', 'EDITOR TEST', false),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer.test@exemplu.local', 'VIEWER TEST', false),
  ('00000000-0000-0000-0000-0000000000a5', 'fara.test@exemplu.local', 'FARA NIVEL', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'redari', 'editor'), ('00000000-0000-0000-0000-0000000000a3', 'redari', 'viewer');
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('00000000-0000-0000-0000-00000000b001', 'TEST-RAZVAN', 'Proiect DRY (fictiv)');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'Test', 'TST');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela, tronson)
  SELECT ('00000000-0000-0000-0000-0000000d000' || i)::uuid, '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'TST-000' || i, 1 FROM generate_series(1, 8) i;
INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  SELECT ('00000000-0000-0000-0000-0000000d000' || i)::uuid, 'DRY30L D' || i, 'dry30l d' || i, 'proprietar' FROM generate_series(1, 8) i;
INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta)
  SELECT id, 'Str. Test 1', 'Testeni', 'Testeni', 'Mehedinti', '200000', true FROM public.red_detinatori;
UPDATE public.red_detinatori SET sters_la = now() WHERE nume = 'DRY30L D8';
-- plic activ neexpediat pentru D5 (garda pe persoana trebuie sa refuze)
INSERT INTO public.red_plicuri (uat_id, nr_plic, cheie_persoana, stare)
  SELECT '00000000-0000-0000-0000-00000000c001', 'P-0001', public.fn_red_cheie_persoana(public.t_det('D5')), 'activ';

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
  -- service_role nu are EXECUTE
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

-- TEST2: editorul rezerva: C-0001, rand posta activ, created_by = editorul, jurnal
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
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document, data_expediere) VALUES (public.t_det('D2'), 'posta', 'X-1', current_date);
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document, stare) VALUES (public.t_det('D2'), 'posta', 'X-2', 'anulat');
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document, sters_la) VALUES (public.t_det('D2'), 'posta', 'X-3', now());
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (public.t_det('D2'), 'sms', 'X-4');
  r := public.t_rez('ed', public.t_det('D2')::text);
  IF r <> 'OK:C-0003' THEN RAISE EXCEPTION 'TEST4b FAIL: %', r; END IF;
  RAISE NOTICE 'TEST4b OK';
END $t$;

-- TEST5: garda de plic pe persoana (plic activ neexpediat) → 23514, INAINTE de numar
DO $t$
DECLARE r text; n0 int := public.t_nr();
BEGIN
  r := public.t_rez('ed', public.t_det('D5')::text);
  IF r NOT LIKE '23514:%plic%' THEN RAISE EXCEPTION 'TEST5 FAIL: %', r; END IF;
  IF public.t_nr() <> n0 OR public.t_active('D5') <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: numar consumat'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6: CONCURENTA pe acelasi detinator (D3): c1 tine tranzactia deschisa dupa rezervare; c2 asteapta lock-ul; dupa COMMIT c1, c2 primeste RD001
DO $t$
DECLARE r1 text; r2 text; n0 int := public.t_nr();
BEGIN
  PERFORM public.t_conn('c1', '00000000-0000-0000-0000-0000000000a2', 'authenticated');
  PERFORM public.t_conn('c2', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D3')::text);
  IF r1 NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST6 FAIL c1: %', r1; END IF;
  PERFORM dblink_send_query('c2', format('SELECT public.t_stare(%L)', format('SELECT nr_document FROM public.fn_red_convocare_rezerva(%L::uuid)', public.t_det('D3'))));
  PERFORM pg_sleep(0.5);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST6 FAIL: c2 nu asteapta lock-ul'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) THEN RAISE EXCEPTION 'TEST6 FAIL: niciun advisory lock in asteptare'; END IF;
  PERFORM dblink_exec('c1', 'COMMIT');
  SELECT x INTO r2 FROM dblink_get_result('c2') AS t(x text);
  PERFORM * FROM dblink_get_result('c2') AS t(x text);   -- golirea rezultatului
  IF r2 NOT LIKE 'RD001:%' THEN RAISE EXCEPTION 'TEST6 FAIL c2: %', r2; END IF;
  IF public.t_active('D3') <> 1 OR public.t_nr() <> n0 + 1 THEN RAISE EXCEPTION 'TEST6 FAIL: % convocari, contor % (era %)', public.t_active('D3'), public.t_nr(), n0; END IF;
  RAISE NOTICE 'TEST6 OK (concurenta acelasi detinator: o singura convocare, un singur numar)';
END $t$;

-- TEST6b: c1 face ROLLBACK (de ex. eroare dupa rezervare) → c2 rezerva (nimic ramas de la c1)
DO $t$
DECLARE r1 text; r2 text;
BEGIN
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D4')::text);
  IF r1 NOT LIKE 'OK:C-%' THEN RAISE EXCEPTION 'TEST6b FAIL c1: %', r1; END IF;
  PERFORM dblink_send_query('c2', format('SELECT public.t_stare(%L)', format('SELECT nr_document FROM public.fn_red_convocare_rezerva(%L::uuid)', public.t_det('D4'))));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('c2') <> 1 THEN RAISE EXCEPTION 'TEST6b FAIL: c2 nu asteapta'; END IF;
  PERFORM dblink_exec('c1', 'ROLLBACK');
  SELECT x INTO r2 FROM dblink_get_result('c2') AS t(x text);
  PERFORM * FROM dblink_get_result('c2') AS t(x text);
  IF r2 NOT LIKE 'OK:C-%' OR public.t_active('D4') <> 1 THEN RAISE EXCEPTION 'TEST6b FAIL c2: % / %', r2, public.t_active('D4'); END IF;
  RAISE NOTICE 'TEST6b OK';
END $t$;

-- TEST7: concurenta pe detinatori DIFERITI (D6 / D7) nu se blocheaza reciproc; numere distincte
DO $t$
DECLARE r1 text; r2 text;
BEGIN
  PERFORM dblink_exec('c1', 'BEGIN');
  r1 := public.t_rez('c1', public.t_det('D6')::text);
  PERFORM dblink_send_query('c2', format('SELECT public.t_stare(%L)', format('SELECT nr_document FROM public.fn_red_convocare_rezerva(%L::uuid)', public.t_det('D7'))));
  PERFORM pg_sleep(0.3);
  -- c2 asteapta doar randul 'C' din red_numere (tinut de c1), nu lock-ul de detinator
  IF EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) THEN RAISE EXCEPTION 'TEST7 FAIL: advisory lock comun pe detinatori diferiti'; END IF;
  PERFORM dblink_exec('c1', 'COMMIT');
  SELECT x INTO r2 FROM dblink_get_result('c2') AS t(x text);
  PERFORM * FROM dblink_get_result('c2') AS t(x text);
  IF r1 NOT LIKE 'OK:C-%' OR r2 NOT LIKE 'OK:C-%' OR r1 = r2 THEN RAISE EXCEPTION 'TEST7 FAIL: % / %', r1, r2; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;

-- TEST8: ACL + setari
DO $t$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.fn_red_convocare_rezerva(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_convocare_rezerva(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_red_convocare_rezerva(uuid,boolean)', 'EXECUTE') THEN RAISE EXCEPTION 'TEST8 FAIL: ACL'; END IF;
  RAISE NOTICE 'TEST8 OK';
END $t$;
SELECT dblink_disconnect(c) FROM unnest(dblink_get_connections()) c;
SELECT 'TESTE_LOCAL_OK';
