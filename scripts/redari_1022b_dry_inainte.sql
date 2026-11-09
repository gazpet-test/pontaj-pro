-- scripts/redari_1022b_dry_inainte.sql — PR #1022, DRY 2 (costul pe rând sub rolul aplicației). Rulat în ACEEAȘI tranzacție, ÎNAINTEA
-- migrării 20261131g. Nu scrie nimic persistent: doar tabele / funcții TEMP (ON COMMIT DROP), apoi ROLLBACK (îl dă cine rulează).
-- Secvența (psql, o singură tranzacție, ON_ERROR_STOP):
--   BEGIN;
--   \i scripts/redari_1022b_dry_inainte.sql
--   -- opțional, 31f în aceeași probă: SELECT set_config('gazpet.livrare_migrare', '20261131f_redari_centralizator_pushdown:' || txid_current(), true);
--   --                                   \i supabase/migrations/20261131f_redari_centralizator_pushdown.sql
--   SELECT set_config('gazpet.livrare_migrare', '20261131g_redari_stare_cost_rls:' || txid_current(), true);
--   \i supabase/migrations/20261131g_redari_stare_cost_rls.sql
--   \i scripts/redari_1022b_dry.sql
--   ROLLBACK;
-- Ce măsoară, pe TEST-RAZVAN și LOT1-PRUNISOR-JUPA, cu aceleași citiri ca ecranele (Dashboard: red_v_centralizator_uat cu stare nenulă
-- și red_v_tronson; Registru: red_v_stare_parcela pe proiect), în trei ipostaze:
--   postgres (fără utilizator) · authenticated cu JWT de owner · authenticated cu JWT de non-owner cu drept pe cheia exactă 'redari'
--   (întâi un viewer, altfel editor / admin; dacă nu există niciunul, ipostaza e sărită cu NOTICE — tiparul e același ca la owner).
-- Pentru fiecare rând se păstrează doar amprenta md5 (fără date în clar), pentru comparația EXCEPT ALL din scriptul „după”.
-- Plus: EXPLAIN (ANALYZE, BUFFERS) ca owner pe centralizator; numărul de apeluri ale funcțiilor (dacă track_functions se poate porni).
-- Durată estimată ÎNAINTE de fix: câteva minute (o citire ca utilizator logat ~30–40 s pe LOT1). Scriptul nu ia lock-uri.
SET LOCAL statement_timeout = '1200s';   -- citirile vechi ca utilizator logat sunt lente (motivul probei); un timeout invalidează proba
DO $pre$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'dry 1022b: rulati ca postgres'; END IF;
  IF (SELECT count(*) FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA')) <> 2 THEN
    RAISE EXCEPTION 'dry 1022b: lipsesc proiectele de comparat'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') THEN
    RAISE EXCEPTION 'dry 1022b: 20261131g pare deja aplicata — scriptul „inainte” ruleaza INAINTEA ei'; END IF;
  IF to_regclass('pg_temp.dry1022b_rez') IS NOT NULL THEN RAISE EXCEPTION 'dry 1022b: scriptul „inainte” a rulat deja in aceasta sesiune'; END IF;
END $pre$;
-- numărarea apelurilor de funcții (diagnostic, opțional): cere drept de setare pe track_functions
DO $tf$ BEGIN
  BEGIN
    PERFORM set_config('track_functions', 'all', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dry 1022b: track_functions nu poate fi pornit (%) — apelurile de functii nu se numara', SQLSTATE;
  END;
  RAISE NOTICE 'dry 1022b: track_functions = %', current_setting('track_functions');
END $tf$;

CREATE TEMP TABLE dry1022b_rez (faza text, rol text, vedere text, cod text, amprenta text) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_timp (faza text, rol text, vedere text, cod text, randuri bigint, ms numeric) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_apeluri (faza text, rol text, vedere text, cod text, functie text, apeluri bigint) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_util (rol text PRIMARY KEY, uid uuid NOT NULL, nivel text) ON COMMIT DROP;
-- rolul authenticated scrie în tabelele probei (doar în această sesiune; dispar la ROLLBACK)
GRANT SELECT, INSERT ON pg_temp.dry1022b_rez, pg_temp.dry1022b_timp, pg_temp.dry1022b_apeluri TO authenticated;
INSERT INTO pg_temp.dry1022b_util SELECT 'owner', id, 'owner' FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
INSERT INTO pg_temp.dry1022b_util
  SELECT 'neowner', uma.profile_id, uma.access_level FROM public.user_module_access uma JOIN public.profiles pr ON pr.id = uma.profile_id
   WHERE uma.module = 'redari' AND uma.access_level IN ('viewer', 'editor', 'admin') AND pr.is_owner IS NOT TRUE
   ORDER BY CASE uma.access_level WHEN 'viewer' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, uma.profile_id LIMIT 1;
DO $util$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_util WHERE rol = 'owner') THEN RAISE EXCEPTION 'dry 1022b: niciun owner pentru proba cu JWT'; END IF;
  RAISE NOTICE 'dry 1022b: non-owner cu drept Redari = %', coalesce((SELECT nivel FROM pg_temp.dry1022b_util WHERE rol = 'neowner'), 'NU EXISTA — ipostaza sarita');
END $util$;

-- apelurile cumulate în tranzacție ale funcțiilor din lanț (gol dacă track_functions = none)
CREATE FUNCTION pg_temp.dry1022b_apeluri_acum() RETURNS jsonb LANGUAGE sql VOLATILE AS $f$
  SELECT coalesce(jsonb_object_agg(f.funcname, f.calls), '{}'::jsonb) FROM pg_catalog.pg_stat_xact_user_functions f
   WHERE f.schemaname = 'public' AND f.funcname IN ('fn_red_nivel', 'fn_red_parcela_acoperita_a', 'fn_red_adresa_cunoscuta', 'fn_red_detinatori_cu_adresa');
$f$;
-- o ipostază: aceleași citiri ca ecranele, cu timpul fiecăreia; amprenta md5 a fiecărui rând (fără date în clar)
CREATE FUNCTION pg_temp.dry1022b_masoara(p_faza text, p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE r record; v record; t0 timestamptz; ms numeric; n bigint; a0 jsonb; a1 jsonb; f text;
BEGIN
  IF p_rol <> 'postgres' AND auth.uid() IS NULL THEN
    IF p_rol = 'neowner' THEN RAISE NOTICE 'dry 1022b: % % sarit (nu exista non-owner cu drept Redari)', p_faza, p_rol; RETURN; END IF;
    RAISE EXCEPTION 'dry 1022b: % fara JWT', p_rol;
  END IF;
  IF (p_rol = 'postgres') IS DISTINCT FROM (current_user = 'postgres') THEN RAISE EXCEPTION 'dry 1022b: % rulat ca %', p_rol, current_user; END IF;
  FOR r IN SELECT id, cod FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') ORDER BY cod LOOP
    FOR v IN SELECT * FROM (VALUES
        ('centralizator', format('SELECT md5(v::text) FROM public.red_v_centralizator_uat v WHERE v.proiect_id = %L AND v.stare IS NOT NULL', r.id)),
        ('tronson', format('SELECT md5(v::text) FROM public.red_v_tronson v WHERE v.proiect_id = %L', r.id)),
        ('stare', format('SELECT md5(v::text) FROM public.red_v_stare_parcela v WHERE v.proiect_id = %L', r.id))) x(vedere, cerere) LOOP
      a0 := pg_temp.dry1022b_apeluri_acum();
      t0 := clock_timestamp();
      EXECUTE format('INSERT INTO pg_temp.dry1022b_rez SELECT %L, %L, %L, %L, q.h FROM (%s) q(h)', p_faza, p_rol, v.vedere, r.cod, v.cerere);
      GET DIAGNOSTICS n = ROW_COUNT;
      ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
      a1 := pg_temp.dry1022b_apeluri_acum();
      INSERT INTO pg_temp.dry1022b_timp VALUES (p_faza, p_rol, v.vedere, r.cod, n, ms);
      FOR f IN SELECT jsonb_object_keys(a1) LOOP
        INSERT INTO pg_temp.dry1022b_apeluri VALUES (p_faza, p_rol, v.vedere, r.cod, f, (a1 ->> f)::bigint - coalesce((a0 ->> f)::bigint, 0));
      END LOOP;
      RAISE NOTICE 'dry 1022b % % % %: % randuri in % ms', p_faza, p_rol, v.vedere, r.cod, n, ms;
    END LOOP;
  END LOOP;
END $f$;
-- planul centralizatorului (ce cere Dashboard-ul), pe ambele proiecte
CREATE FUNCTION pg_temp.dry1022b_explain(p_eticheta text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE r record; l text;
BEGIN
  FOR r IN SELECT id, cod FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') ORDER BY cod LOOP
    FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, uat3, uat_nume, stare, numar, total_uat, procent_inchise FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', r.id) LOOP
      RAISE NOTICE '% % | %', p_eticheta, r.cod, l;
    END LOOP;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION pg_temp.dry1022b_apeluri_acum(), pg_temp.dry1022b_masoara(text, text), pg_temp.dry1022b_explain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.dry1022b_apeluri_acum(), pg_temp.dry1022b_masoara(text, text), pg_temp.dry1022b_explain(text) TO authenticated;

-- 1. postgres, fără utilizator (auth.uid() NULL)
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.dry1022b_masoara('inainte', 'postgres');
-- 2. authenticated cu JWT de owner (ce vede ecranul lui Răzvan)
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', uid, 'role', 'authenticated')::text FROM pg_temp.dry1022b_util WHERE rol = 'owner'), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('inainte', 'owner');
SELECT pg_temp.dry1022b_explain('ROL owner INAINTE');
RESET ROLE;
-- 3. authenticated cu JWT de non-owner cu drept Redări (sărit dacă nu există)
SELECT set_config('request.jwt.claims', coalesce((SELECT json_build_object('sub', uid, 'role', 'authenticated')::text FROM pg_temp.dry1022b_util WHERE rol = 'neowner'), ''), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('inainte', 'neowner');
RESET ROLE;
-- migrarea care urmează rulează ca postgres, fără context de utilizator
SELECT set_config('request.jwt.claims', '', true);
DO $gata$ BEGIN
  RAISE NOTICE 'dry 1022b: inainte salvat — % amprente, % masuratori', (SELECT count(*) FROM pg_temp.dry1022b_rez), (SELECT count(*) FROM pg_temp.dry1022b_timp);
END $gata$;
