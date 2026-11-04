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
-- De ce două fișiere: runner-ul face BEGIN; \i migrare; \i dry; ROLLBACK — după migrare forma veche nu mai există, deci numărătorile „înainte”
-- trebuie luate înainte de \i migrare. Ele stau într-o tabelă TEMP (ON COMMIT DROP, dispare la ROLLBACK), scrisă doar ca postgres.
-- Ce reține, pe fiecare identitate × fiecare tabel / view red_*: număr de rânduri VĂZUTE + md5 pe conținut (ordonat), sau SQLSTATE-ul refuzului.
-- Identități (reale, ca DRY-ul 30e, simulate prin request.jwt.claims + SET LOCAL ROLE): owner, admin non-owner, editor, viewer,
-- fără acces (profil fără rând redari), anon. Plus timpi ca viewer pe red_v_centralizator_uat / red_v_tronson (min din 3 rulări).
-- Nu scrie nimic în tabelele aplicației.
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
CREATE TEMP TABLE r30g_timp (faza text, obiect text, ms numeric, PRIMARY KEY (faza, obiect)) ON COMMIT DROP;

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

-- instantaneu: ce VEDE fiecare identitate pe fiecare tabel / view red_* (lista citita din catalog, deci include red_corespondenta_mailuri daca exista)
CREATE FUNCTION pg_temp.r30g_numara(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE i record; o record; v_n bigint; v_h text; v_e text; v_rez jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_numara se apeleaza ca postgres'; END IF;
  FOR i IN SELECT * FROM pg_temp.r30g_id ORDER BY eticheta LOOP
    v_rez := '{}'::jsonb;
    PERFORM pg_temp.r30g_ca(i.uid, i.rol);
    FOR o IN SELECT c.relname::text AS rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND c.relname LIKE 'red\_%' ORDER BY 1 LOOP
      BEGIN
        EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(t::text), '','' ORDER BY md5(t::text)), '''')) FROM public.%I t', o.rel) INTO v_n, v_h;
        v_e := NULL;
      EXCEPTION WHEN OTHERS THEN v_n := NULL; v_h := NULL; v_e := SQLSTATE;
      END;
      v_rez := v_rez || jsonb_build_object(o.rel, jsonb_build_object('n', v_n, 'h', v_h, 'e', v_e));
    END LOOP;
    PERFORM pg_temp.r30g_ca(NULL, 'postgres');
    INSERT INTO pg_temp.r30g_snap SELECT p_faza, i.eticheta, k, (v ->> 'n')::bigint, v ->> 'h', v ->> 'e' FROM jsonb_each(v_rez) e(k, v);
  END LOOP;
  -- referinta independenta (fara RLS): ce exista in tabele, citit ca postgres
  FOR o IN SELECT c.relname::text AS rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND c.relname LIKE 'red\_%' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(t::text), '','' ORDER BY md5(t::text)), '''')) FROM public.%I t', o.rel) INTO v_n, v_h;
    INSERT INTO pg_temp.r30g_snap VALUES (p_faza, 'postgres', o.rel, v_n, v_h, NULL);
  END LOOP;
END $h$;

-- timpi ca viewer (min din 3 rulari; doar informativ, NOTICE)
CREATE FUNCTION pg_temp.r30g_cronometreaza(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_vw uuid := (SELECT uid FROM pg_temp.r30g_id WHERE eticheta = 'viewer'); o text; k integer; t0 timestamptz; v_min numeric; v_ms numeric; v_n bigint;
        v_rez jsonb := '{}'::jsonb;
BEGIN
  PERFORM pg_temp.r30g_ca(v_vw, 'authenticated');
  FOREACH o IN ARRAY ARRAY['red_v_centralizator_uat', 'red_v_tronson'] LOOP
    v_min := NULL;
    FOR k IN 1..3 LOOP
      t0 := clock_timestamp();
      EXECUTE format('SELECT count(*) FROM (SELECT * FROM public.%I) s', o) INTO v_n;
      v_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
      v_min := least(coalesce(v_min, v_ms), v_ms);
    END LOOP;
    v_rez := v_rez || jsonb_build_object(o, v_min);
  END LOOP;
  PERFORM pg_temp.r30g_ca(NULL, 'postgres');
  INSERT INTO pg_temp.r30g_timp SELECT p_faza, k2, (v #>> '{}')::numeric FROM jsonb_each(v_rez) e(k2, v);
  RAISE NOTICE 'DRY30g timpi % (viewer, ms, min din 3): %', p_faza, v_rez;
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
SELECT pg_temp.r30g_cronometreaza('inainte');
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN RAISE EXCEPTION 'DRY30g inainte FAIL: rol / claims ramase'; END IF;
  RAISE NOTICE 'DRY30g inainte OK: % randuri in instantaneu', (SELECT count(*) FROM pg_temp.r30g_snap WHERE faza = 'inainte');
END $t$;
