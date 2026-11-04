-- DRY 20261130g_redari_rls_initplan — PASUL 2 din 2 („după”). Runner (o singură tranzacție ANULATĂ; ordinea completă e în capul fișierului
-- 20261130g_redari_rls_initplan_dryrun_inainte.sql):  BEGIN; GUC; \i ..._dryrun_inainte.sql; \i migrare; \i acest fișier; ROLLBACK.
-- Folosește funcțiile / tabelele temp create de pasul 1 (pg_temp.r30g_*). Nu lasă nimic în urmă: totul e anulat la ROLLBACK, iar la final
-- rolul e resetat (RESET ROLE) și claims-urile golite.
-- TEST0  garda + pasul 1 rulat + politicile în forma nouă.
-- TEST1  rânduri văzute (număr + md5 pe conținut + refuz) IDENTICE înainte / după, pe fiecare identitate × fiecare tabel / view red_*.
-- TEST2  așteptări independente (din definiția nivelurilor, nu din instantaneu): owner / admin văd tot; viewer vede tot în afară de
--        contact / token / meta (0 rânduri) și de jurnalul pe contact / meta; fără acces și anon nu văd nimic.
-- TEST3  EXPLAIN ca viewer pe red_v_centralizator_uat: InitPlan prezent, niciun Filter cu fn_red_nivel() per rând.
-- TEST4  căile de scriere (USING / WITH CHECK) dau aceleași decizii: UPDATE red_uat (admin), UPDATE red_parcele (admin/editor), INSERT red_proiecte.
-- TEST5  timpi înainte / după (NOTICE, informativ) + curățenie rol / claims.

-- TEST0
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  IF to_regclass('pg_temp.r30g_snap') IS NULL THEN
    RAISE EXCEPTION 'TEST0 FAIL: lipseste instantaneul inainte (ruleaza intai 20261130g_redari_rls_initplan_dryrun_inainte.sql, inaintea migrarii)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.r30g_snap WHERE faza = 'inainte') THEN RAISE EXCEPTION 'TEST0 FAIL: instantaneul inainte e gol'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.red_uat'::regclass AND p.polname = 'red_uat_sel'
                  AND pg_get_expr(p.polqual, p.polrelid) = '(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)') THEN
    RAISE EXCEPTION 'TEST0 FAIL: migrarea nu a fost aplicata in tranzactie';
  END IF;
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1
SELECT pg_temp.r30g_numara('dupa');
SELECT pg_temp.r30g_compara('inainte', 'dupa');
DO $t$ BEGIN RAISE NOTICE 'TEST1 OK'; END $t$;

-- TEST2: asteptari independente, pe instantaneul „dupa”
DO $t$
DECLARE v_dif text[];
BEGIN
  -- tabelele cu SELECT doar admin / editor (independent de cod: decizia de acces din 20261126a / 29a)
  WITH ae(obiect) AS (VALUES ('red_detinatori_contact'), ('red_detinatori_token'), ('red_raspunsuri_meta')),
  -- tabele fara nicio politica (RLS activ, acces doar prin RPC-uri): nimeni din aplicatie nu le vede
  fara_pol(obiect) AS (SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'red\_%'
                        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('r', '*'))),
  ref AS (SELECT obiect, n FROM pg_temp.r30g_snap WHERE faza = 'dupa' AND eticheta = 'postgres'),
  jur AS (SELECT count(*) AS n FROM public.red_jurnal WHERE tabela NOT IN ('red_detinatori_contact', 'red_raspunsuri_meta')),
  astept AS (
    SELECT s.eticheta, s.obiect, s.n, s.eroare,
           CASE WHEN c.relkind = 'v' THEN NULL                                                   -- view-urile: acoperite de TEST1
                WHEN s.obiect IN (SELECT obiect FROM fara_pol) THEN 0
                WHEN s.eticheta IN ('owner', 'admin', 'editor') THEN r.n
                WHEN s.eticheta = 'viewer' AND s.obiect IN (SELECT obiect FROM ae) THEN 0
                WHEN s.eticheta = 'viewer' AND s.obiect = 'red_jurnal' THEN (SELECT n FROM jur)
                WHEN s.eticheta = 'viewer' THEN r.n
                ELSE 0 END AS n_astept
      FROM pg_temp.r30g_snap s JOIN ref r ON r.obiect = s.obiect
      JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname = s.obiect
     WHERE s.faza = 'dupa' AND s.eticheta <> 'postgres')
  SELECT array_agg(eticheta || '/' || obiect || '=' || coalesce(n::text, 'err:' || eroare) || '<>' || n_astept ORDER BY eticheta, obiect) INTO v_dif
    FROM astept
   WHERE n_astept IS NOT NULL
     AND NOT (n IS NOT DISTINCT FROM n_astept OR (n_astept = 0 AND n IS NULL AND eroare = '42501'));   -- „nu vede” = 0 randuri sau permission denied
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'TEST2 FAIL: vizibilitate diferita de asteptari: %', v_dif; END IF;
  RAISE NOTICE 'TEST2 OK (viewer: contact / token / meta = 0, jurnal fara contact / meta; fara acces + anon = nimic)';
END $t$;

-- TEST3: EXPLAIN ca viewer
DO $t$
DECLARE v_vw uuid := (SELECT uid FROM pg_temp.r30g_id WHERE eticheta = 'viewer'); r record; v_init boolean := false; v_per_rand text[];
BEGIN
  PERFORM pg_temp.r30g_ca(v_vw, 'authenticated');
  FOR r IN EXECUTE 'EXPLAIN (COSTS OFF) SELECT * FROM public.red_v_centralizator_uat' LOOP
    IF r."QUERY PLAN" LIKE '%InitPlan%' THEN v_init := true; END IF;
    IF r."QUERY PLAN" LIKE '%Filter:%fn_red_nivel()%' THEN v_per_rand := v_per_rand || btrim(r."QUERY PLAN"); END IF;
  END LOOP;
  PERFORM pg_temp.r30g_ca(NULL, 'postgres');
  IF NOT v_init OR v_per_rand IS NOT NULL THEN RAISE EXCEPTION 'TEST3 FAIL: InitPlan=% , filtre per rand: %', v_init, v_per_rand; END IF;
  RAISE NOTICE 'TEST3 OK (red_v_centralizator_uat ca viewer: InitPlan, fara fn_red_nivel() per rand)';
END $t$;

-- TEST4: deciziile de scriere (dupa instantanee: UPDATE-urile scriu in red_jurnal; totul se anuleaza la ROLLBACK)
CREATE FUNCTION pg_temp.r30g_scrie(p_eticheta text, p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE v_n bigint; v_rez text;
BEGIN
  PERFORM pg_temp.r30g_ca((SELECT uid FROM pg_temp.r30g_id WHERE eticheta = p_eticheta), (SELECT rol FROM pg_temp.r30g_id WHERE eticheta = p_eticheta));
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS v_n = ROW_COUNT; v_rez := 'rows:' || v_n;
  EXCEPTION WHEN OTHERS THEN v_rez := 'err:' || SQLSTATE;
  END;
  PERFORM pg_temp.r30g_ca(NULL, 'postgres');
  RETURN v_rez;
END $h$;
DO $t$
DECLARE v_uat uuid := (SELECT id FROM public.red_uat ORDER BY id LIMIT 1); v_par uuid := (SELECT id FROM public.red_parcele ORDER BY id LIMIT 1);
        v_pr text := (SELECT to_jsonb(p)::text FROM public.red_proiecte p ORDER BY p.id LIMIT 1);
        v_u text; v_p text; v_i text; v_astept_u text; v_astept_p text; v_dif text[] := '{}'; e text;
BEGIN
  IF v_uat IS NULL OR v_par IS NULL THEN RAISE EXCEPTION 'TEST4 FAIL: fara red_uat / red_parcele de test'; END IF;
  FOREACH e IN ARRAY ARRAY['owner', 'admin', 'editor', 'viewer', 'fara_acces'] LOOP
    v_u := pg_temp.r30g_scrie(e, format('UPDATE public.red_uat SET id = id WHERE id = %L', v_uat));
    v_p := pg_temp.r30g_scrie(e, format('UPDATE public.red_parcele SET id = id WHERE id = %L', v_par));
    -- INSERT duplicat: RLS WITH CHECK (42501) se verifica inaintea unicitatii (23505)
    --    (randul e citit aici, ca postgres, si trimis ca literal: identitatile fara acces nu-l vad, dar tot trebuie sa fie refuzate de WITH CHECK)
    v_i := pg_temp.r30g_scrie(e, format('INSERT INTO public.red_proiecte SELECT (jsonb_populate_record(NULL::public.red_proiecte, %L::jsonb)).*', v_pr));
    v_astept_u := CASE WHEN e IN ('owner', 'admin') THEN 'rows:1' ELSE 'rows:0' END;
    v_astept_p := CASE WHEN e IN ('owner', 'admin', 'editor') THEN 'rows:1' ELSE 'rows:0' END;
    IF v_u IS DISTINCT FROM v_astept_u THEN v_dif := v_dif || (e || ' red_uat ' || v_u); END IF;
    IF v_p IS DISTINCT FROM v_astept_p THEN v_dif := v_dif || (e || ' red_parcele ' || v_p); END IF;
    IF (e IN ('owner', 'admin') AND v_i = 'err:42501') OR (e NOT IN ('owner', 'admin') AND v_i IS DISTINCT FROM 'err:42501') THEN
      v_dif := v_dif || (e || ' red_proiecte insert ' || v_i);
    END IF;
  END LOOP;
  IF cardinality(v_dif) > 0 THEN RAISE EXCEPTION 'TEST4 FAIL: %', v_dif; END IF;
  RAISE NOTICE 'TEST4 OK (UPDATE red_uat doar admin, red_parcele admin/editor, INSERT red_proiecte refuzat de RLS sub admin)';
END $t$;

-- TEST5: timpi + curatenie
SELECT pg_temp.r30g_cronometreaza('dupa');
DO $t$ BEGIN
  RAISE NOTICE 'DRY30g timpi viewer (ms): %', (SELECT jsonb_object_agg(a.obiect, jsonb_build_object('inainte', a.ms, 'dupa', b.ms))
                                                 FROM pg_temp.r30g_timp a JOIN pg_temp.r30g_timp b ON b.obiect = a.obiect AND b.faza = 'dupa' WHERE a.faza = 'inainte');
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN RAISE EXCEPTION 'TEST5 FAIL: rol / claims ramase'; END IF;
  RAISE NOTICE 'TEST5 OK — DRY 20261130g complet (tranzactia trebuie ANULATA de runner)';
END $t$;
