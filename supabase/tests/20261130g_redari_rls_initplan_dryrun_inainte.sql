-- DRY 20261130g_redari_rls_initplan — PASUL 1 din 2 („înainte”). Se rulează ÎNAINTEA migrării, în ACEEAȘI tranzacție anulată:
--   BEGIN;
--   SELECT set_config('gazpet.livrare_migrare', '20261130g_redari_rls_initplan:' || txid_current(), true);
--   \i supabase/tests/20261130g_redari_rls_initplan_dryrun_inainte.sql     -- instantaneul „inainte” (forma veche, per rând)
--   \i supabase/migrations/20261130g_redari_rls_initplan.sql
--   \i supabase/tests/20261130g_redari_rls_initplan_dryrun.sql             -- instantaneul „dupa” + comparație + EXPLAIN + timpi
--   -- opțional, revenirea în aceeași tranzacție:
--   -- SELECT set_config('gazpet.revenire_20261130g', 'REDARI_RLS_INITPLAN_SCOASA:' || txid_current(), true);
--   -- \i supabase/revenire/20261130g_redari_rls_initplan_ROLLBACK.sql
--   -- SELECT pg_temp.r30g_numara('revenire'); SELECT pg_temp.r30g_compara('inainte', 'revenire');
--   ROLLBACK;
-- De ce două fișiere: după migrare forma veche nu mai există, deci instantaneul „înainte” se ia înainte de \i migrare, într-o tabelă TEMP
-- (ON COMMIT DROP, dispare la ROLLBACK), scrisă doar ca postgres.
-- Ce reține, pe fiecare identitate × fiecare tabel / view red_*:
--   • număr de rânduri VĂZUTE + md5 pe conținut, pe PROIECȚIA coloanelor pe care authenticated are SELECT (privilegii reale pe coloană,
--     ex. red_parcele fără valoare_lei; aceeași proiecție și pentru referința postgres), sau SQLSTATE-ul refuzului;
--   • pentru fiecare coloană fără SELECT pentru authenticated, obiectul „tabel.coloana”: refuzul (42501) trebuie să rămână refuz;
--   • deciziile de scriere (TEST4): UPDATE pe o coloană cu privilegiu de UPDATE, INSERT duplicat, INSERT valid — rulate într-o subtranzacție
--     ANULATĂ EXPLICIT și la succes (RAISE + EXCEPTION), deci nicio scriere / trigger / jurnal nu rămâne între instantanee (doar valorile de
--     secvență consumate de jurnal nu se întorc — comportament normal PostgreSQL, fără efect asupra rândurilor);
--   • timpii (NOTICE) pe interogările REALE ale aplicației, ca viewer: DashboardEcran (red_v_centralizator_uat, red_v_tronson) și ultima pagină
--     din Registru (red_v_stare_parcela cu count exact + ORDER BY id_parcela, nume + LIMIT 100 OFFSET ultima pagină), pe proiectul cu cele mai
--     multe parcele; rezultatele (md5) trebuie să fie identice înainte / după.
-- Identități (reale, simulate prin request.jwt.claims + SET LOCAL ROLE): owner, admin non-owner, editor, viewer, fără acces, anon.
CREATE FUNCTION pg_temp.r30g_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                                ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30g_ca(uuid, text) TO authenticated, anon;

CREATE TEMP TABLE r30g_id (eticheta text PRIMARY KEY, uid uuid, rol text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE r30g_snap (faza text, eticheta text, obiect text, n bigint, h text, eroare text, PRIMARY KEY (faza, eticheta, obiect)) ON COMMIT DROP;
CREATE TEMP TABLE r30g_timp (faza text, obiect text, ms numeric, h text, PRIMARY KEY (faza, obiect)) ON COMMIT DROP;
CREATE TEMP TABLE r30g_scr (faza text, eticheta text, proba text, rez text, PRIMARY KEY (faza, eticheta, proba)) ON COMMIT DROP;

DO $t$
DECLARE own uuid; adm uuid; ed uuid; vw uuid; fara uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() THEN
    RAISE EXCEPTION 'DRY30g inainte FAIL: garda (ruleaza in tranzactia migrarii, inaintea ei)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.red_uat'::regclass AND pg_get_expr(p.polqual, p.polrelid) LIKE '%SELECT fn_red_nivel%') THEN
    RAISE EXCEPTION 'DRY30g inainte FAIL: politicile sunt deja in forma noua (ruleaza fisierul INAINTEA migrarii)';
  END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO adm FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'admin' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fara FROM public.profiles p
   WHERE p.is_owner IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  IF own IS NULL OR adm IS NULL OR ed IS NULL OR vw IS NULL OR fara IS NULL THEN RAISE EXCEPTION 'DRY30g inainte FAIL: identitati lipsa'; END IF;
  INSERT INTO pg_temp.r30g_id VALUES ('owner', own, 'authenticated'), ('admin', adm, 'authenticated'), ('editor', ed, 'authenticated'),
                                     ('viewer', vw, 'authenticated'), ('fara_acces', fara, 'authenticated'), ('anon', NULL, 'anon');
END $t$;

-- obiectele si interogarile instantaneului, din catalog (include red_corespondenta_mailuri daca exista):
--   proiectia = coloanele cu SELECT pentru authenticated (fara ele: count(*) simplu); plus cate un obiect „tabel.coloana” per coloana refuzata
CREATE FUNCTION pg_temp.r30g_obiecte() RETURNS TABLE (obiect text, q text) LANGUAGE sql AS $h$
  WITH rel AS (SELECT c.oid, c.relname::text AS rel FROM pg_class c
                WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND c.relname LIKE 'red\_%'),
  col AS (SELECT r.rel, string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE has_column_privilege('authenticated', r.oid, a.attnum, 'SELECT')) AS permise
            FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped GROUP BY r.rel)
  SELECT c.rel, CASE WHEN c.permise IS NULL THEN format('SELECT count(*), NULL::text FROM public.%I', c.rel)
                     ELSE format('SELECT count(*), md5(coalesce(string_agg(md5(ROW(%s)::text), '','' ORDER BY md5(ROW(%s)::text)), '''')) FROM public.%I t',
                                 c.permise, c.permise, c.rel) END
    FROM col c
  UNION ALL
  SELECT r.rel || '.' || a.attname, format('SELECT count(%I), NULL::text FROM public.%I', a.attname, r.rel)
    FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE NOT has_column_privilege('authenticated', r.oid, a.attnum, 'SELECT') AND has_any_column_privilege('authenticated', r.oid, 'SELECT')
$h$;

-- instantaneu: ce VEDE fiecare identitate
CREATE FUNCTION pg_temp.r30g_numara(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE i record; o record; v_n bigint; v_h text; v_e text; v_rez jsonb; v_ob jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_numara se apeleaza ca postgres'; END IF;
  SELECT jsonb_agg(jsonb_build_object('o', obiect, 'q', q) ORDER BY obiect) INTO v_ob FROM pg_temp.r30g_obiecte();
  FOR i IN SELECT * FROM pg_temp.r30g_id ORDER BY eticheta LOOP
    v_rez := '{}'::jsonb;
    PERFORM pg_temp.r30g_ca(i.uid, i.rol);
    FOR o IN SELECT x ->> 'o' AS obiect, x ->> 'q' AS q FROM jsonb_array_elements(v_ob) x LOOP
      BEGIN
        EXECUTE o.q INTO v_n, v_h; v_e := NULL;
      EXCEPTION WHEN OTHERS THEN v_n := NULL; v_h := NULL; v_e := SQLSTATE;
      END;
      v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('n', v_n, 'h', v_h, 'e', v_e));
    END LOOP;
    PERFORM pg_temp.r30g_ca(NULL, 'postgres');
    INSERT INTO pg_temp.r30g_snap SELECT p_faza, i.eticheta, k, (v ->> 'n')::bigint, v ->> 'h', v ->> 'e' FROM jsonb_each(v_rez) e(k, v);
  END LOOP;
  -- referinta (fara RLS): aceleasi interogari, ca postgres
  FOR o IN SELECT x ->> 'o' AS obiect, x ->> 'q' AS q FROM jsonb_array_elements(v_ob) x LOOP
    EXECUTE o.q INTO v_n, v_h;
    INSERT INTO pg_temp.r30g_snap VALUES (p_faza, 'postgres', o.obiect, v_n, v_h, NULL);
  END LOOP;
END $h$;

-- o proba de scriere ca identitate: 'rows:N' sau 'err:SQLSTATE' (eroarea e prinsa local; rolul revine la postgres)
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

-- deciziile de scriere (USING / WITH CHECK), toate intr-o subtranzactie anulata explicit la final (R3G00), si la succes:
--   uat_upd   UPDATE red_uat SET nume = nume            (coloana cu UPDATE pentru authenticated; politica A)
--   parc_upd  UPDATE red_parcele SET observatii = observatii (coloana cu UPDATE; politica AE; triggerele de legatura / plic nu refuza valori egale)
--   pr_dup    INSERT duplicat (acelasi rand red_proiecte): WITH CHECK (42501) inaintea unicitatii (23505)
--   pr_nou    INSERT valid red_proiecte (id + cod noi): calea legitima
CREATE FUNCTION pg_temp.r30g_probe(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_uat uuid; v_par uuid; v_pr text; e text; v_rez jsonb := '{}'::jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_probe se apeleaza ca postgres'; END IF;
  SELECT id INTO v_uat FROM public.red_uat ORDER BY id LIMIT 1;
  SELECT id INTO v_par FROM public.red_parcele WHERE sters_la IS NULL ORDER BY id LIMIT 1;
  SELECT to_jsonb(p)::text INTO v_pr FROM public.red_proiecte p ORDER BY p.id LIMIT 1;
  IF v_uat IS NULL OR v_par IS NULL OR v_pr IS NULL THEN RAISE EXCEPTION 'DRY30g FAIL: fara red_uat / red_parcele / red_proiecte pentru probe'; END IF;
  BEGIN
    FOR e IN SELECT eticheta FROM pg_temp.r30g_id ORDER BY eticheta LOOP
      v_rez := v_rez
        || jsonb_build_object(e || '/uat_upd', pg_temp.r30g_scrie(e, format('UPDATE public.red_uat SET nume = nume WHERE id = %L', v_uat)))
        || jsonb_build_object(e || '/parc_upd', pg_temp.r30g_scrie(e, format('UPDATE public.red_parcele SET observatii = observatii WHERE id = %L', v_par)))
        || jsonb_build_object(e || '/pr_dup', pg_temp.r30g_scrie(e, format('INSERT INTO public.red_proiecte SELECT (jsonb_populate_record(NULL::public.red_proiecte, %L::jsonb)).*', v_pr)))
        || jsonb_build_object(e || '/pr_nou', pg_temp.r30g_scrie(e, format('INSERT INTO public.red_proiecte (id, cod, denumire) VALUES (%L, %L, %L)',
                                                                         gen_random_uuid(), 'R30G-DRY-' || e || '-' || p_faza, 'DRY 30g (anulat)')));
    END LOOP;
    RAISE EXCEPTION 'r30g: anulare probe' USING ERRCODE = 'R3G00';   -- anuleaza TOATE scrierile probelor (randuri, versiuni, jurnal, triggere)
  EXCEPTION WHEN SQLSTATE 'R3G00' THEN NULL;
  END;
  PERFORM pg_temp.r30g_ca(NULL, 'postgres');
  INSERT INTO pg_temp.r30g_scr SELECT p_faza, split_part(k, '/', 1), split_part(k, '/', 2), v #>> '{}' FROM jsonb_each(v_rez) x(k, v);
END $h$;

-- timpi ca viewer pe interogarile reale ale aplicatiei (min din 3; informativ, NOTICE) + md5 pe rezultat (trebuie identic intre faze)
CREATE FUNCTION pg_temp.r30g_cronometreaza(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_vw uuid := (SELECT uid FROM pg_temp.r30g_id WHERE eticheta = 'viewer'); v_pr uuid; o record; k integer; t0 timestamptz;
        v_min numeric; v_ms numeric; v_h text; v_n bigint; v_rez jsonb := '{}'::jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_cronometreaza se apeleaza ca postgres'; END IF;
  SELECT proiect_id INTO v_pr FROM public.red_parcele GROUP BY proiect_id ORDER BY count(*) DESC, proiect_id LIMIT 1;
  PERFORM pg_temp.r30g_ca(v_vw, 'authenticated');
  FOR o IN SELECT * FROM (VALUES
      ('dashboard_centralizator', format('SELECT md5(coalesce(string_agg(q::text, %L), %L)) FROM (SELECT uat_id, uat3, uat_nume, stare, numar, total_uat, procent_inchise'
         || ' FROM public.red_v_centralizator_uat WHERE stare IS NOT NULL AND proiect_id = %L ORDER BY uat_id, stare LIMIT 1000) q', '|', '', v_pr)),
      ('dashboard_tronson', format('SELECT md5(coalesce(string_agg(q::text, %L), %L)) FROM (SELECT parcela_id, tronson, tip_pv, obiectii_deschise'
         || ' FROM public.red_v_tronson WHERE proiect_id = %L ORDER BY parcela_id LIMIT 1000) q', '|', '', v_pr)),
      ('registru_ultima_pagina', NULL)) AS v(obiect, q) LOOP
    v_min := NULL;
    FOR k IN 1..3 LOOP
      t0 := clock_timestamp();
      IF o.q IS NOT NULL THEN
        EXECUTE o.q INTO v_h;
      ELSE   -- Registru: count exact + pagina 100 (ORDER BY id_parcela, nume), ultima pagina, ca PostgREST
        EXECUTE 'SELECT count(*) FROM public.red_v_stare_parcela WHERE proiect_id = $1' INTO v_n USING v_pr;
        EXECUTE 'SELECT md5(coalesce(string_agg(q::text, ''|''), '''')) FROM (SELECT * FROM public.red_v_stare_parcela WHERE proiect_id = $1'
             || ' ORDER BY id_parcela, nume LIMIT 100 OFFSET $2) q' INTO v_h USING v_pr, greatest(0, ((v_n - 1) / 100) * 100);
        v_h := v_n || ':' || v_h;
      END IF;
      v_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
      v_min := least(coalesce(v_min, v_ms), v_ms);
    END LOOP;
    v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('ms', v_min, 'h', v_h));
  END LOOP;
  PERFORM pg_temp.r30g_ca(NULL, 'postgres');
  INSERT INTO pg_temp.r30g_timp SELECT p_faza, k2, (v ->> 'ms')::numeric, v ->> 'h' FROM jsonb_each(v_rez) e(k2, v);
  RAISE NOTICE 'DRY30g timpi % (viewer, ms, min din 3, proiect %): %', p_faza, v_pr, (SELECT jsonb_object_agg(k2, v -> 'ms') FROM jsonb_each(v_rez) e(k2, v));
END $h$;

-- comparatie intre doua faze: aceleasi obiecte, acelasi numar + acelasi continut + acelasi refuz, pe fiecare identitate
CREATE FUNCTION pg_temp.r30g_compara(p_a text, p_b text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_dif text[]; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_temp.r30g_snap WHERE faza = p_a;
  IF v_n = 0 THEN RAISE EXCEPTION 'DRY30g FAIL: faza % lipseste (ai rulat fisierul _inainte?)', p_a; END IF;
  SELECT array_agg(coalesce(a.eticheta, b.eticheta) || '/' || coalesce(a.obiect, b.obiect) ORDER BY 1) INTO v_dif
    FROM (SELECT * FROM pg_temp.r30g_snap WHERE faza = p_a) a
    FULL JOIN (SELECT * FROM pg_temp.r30g_snap WHERE faza = p_b) b ON b.eticheta = a.eticheta AND b.obiect = a.obiect
   WHERE a.obiect IS NULL OR b.obiect IS NULL OR a.n IS DISTINCT FROM b.n OR a.h IS DISTINCT FROM b.h OR a.eroare IS DISTINCT FROM b.eroare;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'DRY30g FAIL: randuri vazute diferite % vs %: %', p_a, p_b, v_dif; END IF;
  RAISE NOTICE 'DRY30g OK: % = % pe % (identitate, obiect)', p_a, p_b, v_n;
END $h$;

SELECT pg_temp.r30g_numara('inainte');
SELECT pg_temp.r30g_probe('inainte');
SELECT pg_temp.r30g_numara('inainte_dupa_probe');
SELECT pg_temp.r30g_compara('inainte', 'inainte_dupa_probe');   -- probele nu au lasat nimic in urma
SELECT pg_temp.r30g_cronometreaza('inainte');
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN RAISE EXCEPTION 'DRY30g inainte FAIL: rol / claims ramase'; END IF;
  RAISE NOTICE 'DRY30g inainte OK: % randuri in instantaneu, % probe de scriere', (SELECT count(*) FROM pg_temp.r30g_snap WHERE faza = 'inainte'),
               (SELECT count(*) FROM pg_temp.r30g_scr WHERE faza = 'inainte');
END $t$;
