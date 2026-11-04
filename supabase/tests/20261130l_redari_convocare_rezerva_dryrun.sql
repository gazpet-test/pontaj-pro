-- DRY PRODUCTIE 20261130l_redari_convocare_rezerva. Runner: o singura tranzactie ANULATA, READ COMMITTED
-- (marcaj gazpet.livrare_migrare + migrare + acest fisier + RESET ROLE + revenire + verificare + ROLLBACK explicit, ca la 20261130i).
-- r3: functia e SECURITY INVOKER (RLS + triggerele utilizatorului); refuzurile testate aici pica toate INAINTE de numar si de INSERT.
-- DOAR CITIRI: nicio rezervare reusita (o rezervare ar lua randul 'C' din red_numere pana la ROLLBACK si ar bloca generarea individuala).
-- Se testeaza: setarile + ACL-ul functiei, refuzurile care pica INAINTE de orice scriere (anon, authenticated fara sub, viewer real,
-- profil fara nivel Redari, service_role, parametri NULL, detinator inexistent) si — daca TEST-RAZVAN are o convocare postala activa
-- neexpediata — refuzul RD001 (dupa advisory lock, inainte de numar). Contorul 'C' si numarul de convocari trebuie sa ramana neschimbate.
-- Concurenta reala, garda de plic, rezervarea reusita si revenirea cu date: DRY-ul LOCAL (..._dryrun_local.sql, scripts/redari_30l_dry_local.sh).
-- Identitati REALE din user_module_access simulate prin request.jwt.claims + SET LOCAL ROLE; la final RESET ROLE + claims goale.
SELECT set_config('lock_timeout', '2s', true);
CREATE FUNCTION pg_temp.r30l_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- SQLSTATE-ul unui apel (sau 'OK'); subtranzactia apelului se anuleaza mereu (EXCEPTION) — nicio urma, chiar daca ar reusi
CREATE FUNCTION pg_temp.r30l_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  BEGIN EXECUTE p_sql; RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'r30l: apelul a reusit';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM; END;
END $h$;
CREATE FUNCTION pg_temp.r30l_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30l.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30l_ca(uuid, text), pg_temp.r30l_stare(text), pg_temp.r30l_g(text) TO authenticated, anon, service_role;

-- TEST0: garda, izolare, identitati, amprenta initiala (ca postgres); nicio scriere
DO $t$
DECLARE ed uuid; vw uuid; fa uuid; pr uuid; det uuid; detc uuid; nrc text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130l_redari_convocare_rezerva:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'TEST0 FAIL: DRY-ul cere READ COMMITTED (ca PostgREST)'; END IF;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fa FROM public.profiles p WHERE p.is_owner IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  IF ed IS NULL OR vw IS NULL OR fa IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN lipsa'; END IF;
  SELECT d.id INTO det FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE p.proiect_id = pr AND d.sters_la IS NULL AND p.sters_la IS NULL ORDER BY d.id LIMIT 1;
  IF det IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: TEST-RAZVAN fara detinatori'; END IF;
  SELECT c.detinator_id, c.nr_document INTO detc, nrc FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE p.proiect_id = pr AND d.sters_la IS NULL AND p.sters_la IS NULL AND c.canal = 'posta' AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL
   ORDER BY c.created_at, c.id LIMIT 1;
  PERFORM set_config('r30l.editor', ed::text, true); PERFORM set_config('r30l.viewer', vw::text, true); PERFORM set_config('r30l.fara', fa::text, true);
  PERFORM set_config('r30l.det', det::text, true); PERFORM set_config('r30l.detc', coalesce(detc::text, ''), true); PERFORM set_config('r30l.nrc', coalesce(nrc, ''), true);
  PERFORM set_config('r30l.amprenta', (SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) || '|' || (SELECT count(*) FROM public.red_convocari)), true);
  RAISE NOTICE 'TEST0 OK (amprenta numere|convocari = %, convocare neexpediata pe TEST-RAZVAN: %)', current_setting('r30l.amprenta'), coalesce(nrc, 'niciuna');
END $t$;

-- TEST1: setari, ACL, iesire
DO $t$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean)'::regprocedure AND NOT prosecdef AND provolatile = 'v'
                  AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres') THEN RAISE EXCEPTION 'TEST1 FAIL: setari'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_red_convocare_rezerva(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_convocare_rezerva(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_red_convocare_rezerva(uuid,boolean)', 'EXECUTE') THEN RAISE EXCEPTION 'TEST1 FAIL: ACL'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: refuzuri inainte de orice scriere
SELECT pg_temp.r30l_ca(NULL, 'anon');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL anon: %', r; END IF; RAISE NOTICE 'TEST2a OK'; END $t$;
SELECT pg_temp.r30l_ca(NULL, 'authenticated');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL authenticated fara sub: %', r; END IF; RAISE NOTICE 'TEST2b OK'; END $t$;
SELECT pg_temp.r30l_ca(pg_temp.r30l_g('viewer')::uuid, 'authenticated');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL viewer: %', r; END IF; RAISE NOTICE 'TEST2c OK'; END $t$;
SELECT pg_temp.r30l_ca(pg_temp.r30l_g('fara')::uuid, 'authenticated');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL fara nivel: %', r; END IF; RAISE NOTICE 'TEST2d OK'; END $t$;
SELECT pg_temp.r30l_ca(NULL, 'service_role');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL service_role: %', r; END IF; RAISE NOTICE 'TEST2e OK'; END $t$;
SELECT pg_temp.r30l_ca(pg_temp.r30l_g('editor')::uuid, 'authenticated');
DO $t$ DECLARE r text; BEGIN
  r := pg_temp.r30l_stare('SELECT * FROM public.fn_red_convocare_rezerva(NULL)');
  IF r NOT LIKE '22023:%' THEN RAISE EXCEPTION 'TEST2 FAIL null: %', r; END IF;
  r := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid, NULL)', pg_temp.r30l_g('det')));
  IF r NOT LIKE '22023:%' THEN RAISE EXCEPTION 'TEST2 FAIL confirmat null: %', r; END IF;
  r := pg_temp.r30l_stare('SELECT * FROM public.fn_red_convocare_rezerva(''00000000-0000-0000-0000-000000000000''::uuid)');
  IF r NOT LIKE 'P0002:%' THEN RAISE EXCEPTION 'TEST2 FAIL inexistent: %', r; END IF;
  RAISE NOTICE 'TEST2f OK (editor: 22023 / P0002)';
END $t$;
-- TEST3: RD001 pe o convocare reala neexpediata a TEST-RAZVAN (daca exista) — refuz dupa lock, inainte de numar
DO $t$ DECLARE r text; BEGIN
  IF pg_temp.r30l_g('detc') IS NULL THEN RAISE NOTICE 'TEST3 SARIT (TEST-RAZVAN nu are convocare postala activa neexpediata)'; RETURN; END IF;
  r := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('detc')));
  IF r NOT LIKE 'RD001:%' || pg_temp.r30l_g('nrc') || '%' THEN RAISE EXCEPTION 'TEST3 FAIL: %', r; END IF;
  RAISE NOTICE 'TEST3 OK (RD001 pe %)', pg_temp.r30l_g('nrc');
END $t$;
SELECT pg_temp.r30l_ca(NULL, 'postgres');
-- TEST4: nimic scris (contorul C si numarul de convocari neschimbate)
DO $t$ BEGIN
  IF (SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) || '|' || (SELECT count(*) FROM public.red_convocari)) IS DISTINCT FROM current_setting('r30l.amprenta') THEN
    RAISE EXCEPTION 'TEST4 FAIL: s-a scris ceva (amprenta % -> %)', current_setting('r30l.amprenta'),
      (SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) || '|' || (SELECT count(*) FROM public.red_convocari));
  END IF;
  RAISE NOTICE 'TEST4 OK (nimic scris)';
END $t$;
SELECT 'DRY productie 20261130l: teste OK';
