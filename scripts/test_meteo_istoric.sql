-- Harness 20261202a_meteo_istoric_zilnic — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_meteo_istoric.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> clasificarea „zi nelucrabilă” pe cazuri la limită ->
-- constrângeri -> drepturi ca anon / non-owner / owner / service_role (SET LOCAL ROLE + request.jwt.claims) -> pragurile prin RPC (CAS) ->
-- revenire refuzată (nearmată / cu rânduri / praguri schimbate) -> revenire armată pe stare goală -> re-aplicare.
-- Identități reale din catalog (owner + un profil non-owner), un site real, date FICTIVE (zile din ianuarie 2015, înaintea oricărui proiect).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261202a_meteo_istoric_zilnic:' || txid_current(), true);
\ir ../supabase/migrations/20261202a_meteo_istoric_zilnic.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 160); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 't_refuza: așteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM, 160); END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tmet.' || p, true), ''); $h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0: psql :ERROR = true, :SQLSTATE și mesajul exact (L25: testul pică dacă trece)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_g(text) TO authenticated, anon, service_role;

-- T0: identități + site; zilele fictive (ianuarie 2015), fiecare pe o limită de prag
DO $t$
DECLARE own uuid; nu uuid; s bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT id INTO nu FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 1;
  SELECT id INTO s FROM public.sites ORDER BY id LIMIT 1;
  IF own IS NULL OR nu IS NULL OR s IS NULL THEN RAISE EXCEPTION 'T0 FAIL: identități / site'; END IF;
  IF EXISTS (SELECT 1 FROM public.meteo_istoric_zilnic) THEN RAISE EXCEPTION 'T0 FAIL: tabelul nou nu e gol'; END IF;
  PERFORM set_config('tmet.own', own::text, true); PERFORM set_config('tmet.nu', nu::text, true); PERFORM set_config('tmet.site', s::text, true);
  INSERT INTO public.meteo_istoric_zilnic (site_id, data, precipitatii_mm, ploaie_mm, zapada_cm, tmin_c, tmax_c, vant_max_kmh, rafale_max_kmh, cod_vreme, lat, lng, sursa) VALUES
    (s, '2015-01-01', 10.00, 10.00, 0, 2, 8, 10, 20, 63, 44.6, 22.6, 'open-meteo-archive'),   -- precipitații = prag → nelucrabilă
    (s, '2015-01-02', 9.99, 9.99, 0, 2, 8, 10, 20, 61, 44.6, 22.6, 'open-meteo-archive'),     -- sub prag → lucrabilă
    (s, '2015-01-03', 0, 0, 1.00, -1, 2, 5, 9, 71, 44.6, 22.6, 'open-meteo-archive'),          -- zăpadă = prag
    (s, '2015-01-04', 0, 0, 0.99, -1, 2, 5, 9, 71, 44.6, 22.6, 'open-meteo-archive'),          -- zăpadă sub prag
    (s, '2015-01-05', 0, 0, 0, -3, -0.10, 5, 9, 3, 44.6, 22.6, 'open-meteo-archive'),         -- Tmax < 0
    (s, '2015-01-06', 0, 0, 0, -3, 0, 5, 9, 3, 44.6, 22.6, 'open-meteo-archive'),             -- Tmax = 0 → nu (strict)
    (s, '2015-01-07', 0, 0, 0, -5, 3, 5, 9, 0, 44.6, 22.6, 'open-meteo-archive'),             -- Tmin = −5 → da (≤)
    (s, '2015-01-08', 0, 0, 0, -4.99, 3, 5, 9, 0, 44.6, 22.6, 'open-meteo-archive'),          -- Tmin peste −5 → nu
    (s, '2015-01-09', NULL, NULL, 0, 1, 5, 5, 9, 2, 44.6, 22.6, 'open-meteo-archive'),        -- lipsă precipitații, nimic atins → NULL
    (s, '2015-01-10', NULL, NULL, 2, 1, 5, 5, 9, 73, 44.6, 22.6, 'open-meteo-archive'),       -- lipsă precipitații, zăpadă atinsă → true
    (s, '2015-01-11', 25, 20, 3, -8, -1, 30, 60, 75, 44.6, 22.6, 'open-meteo-archive');       -- toate patru
  RAISE NOTICE 'T0 OK';
END $t$;

-- T1: clasificarea din v_meteo_zile (o singură definiție, L19), cu motivele
DO $t$
DECLARE r text; s bigint := pg_temp.t_g('site')::bigint;
BEGIN
  SELECT string_agg(to_char(data, 'DD') || '=' || coalesce(zi_nelucrabila::text, 'null') || ':' || array_to_string(motive, '+'), ',' ORDER BY data) INTO r
    FROM public.v_meteo_zile WHERE site_id = s AND data BETWEEN '2015-01-01' AND '2015-01-31';
  IF r IS DISTINCT FROM '01=true:precipitatii,02=false:,03=true:zapada,04=false:,05=true:tmax,06=false:,07=true:tmin,08=false:,09=null:,10=true:zapada,11=true:precipitatii+zapada+tmax+tmin' THEN
    RAISE EXCEPTION 'T1 FAIL: clasificarea %', r;
  END IF;
  IF (SELECT count(*) FROM public.v_meteo_zile WHERE site_id = s AND praguri_versiune = 1 AND precipitatii_mm_min = 10 AND zapada_cm_min = 1 AND tmax_sub_c = 0 AND tmin_max_c = -5) <> 11 THEN
    RAISE EXCEPTION 'T1 FAIL: pragurile din vedere';
  END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: constrângerile pe valori (ca postgres)
DO $t$
DECLARE s bigint := pg_temp.t_g('site')::bigint;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, precipitatii_mm, lat, lng, sursa) VALUES (%s, '2015-01-20', -0.1, 44.6, 22.6, 'open-meteo-archive')$q$, s), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, tmax_c, lat, lng, sursa) VALUES (%s, '2015-01-20', 5, 4, 44.6, 22.6, 'open-meteo-archive')$q$, s), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, sursa) VALUES (%s, '2015-01-20', 1, 44.6, 22.6, 'alta-sursa')$q$, s), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, vant_max_kmh, lat, lng, sursa) VALUES (%s, '2015-01-20', 5, 44.6, 22.6, 'open-meteo-archive')$q$, s), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, sursa) VALUES (%s, '2014-12-31', 1, 44.6, 22.6, 'open-meteo-archive')$q$, s), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, sursa) VALUES (%s, '2015-01-20', 1, 91, 22.6, 'open-meteo-archive')$q$, s), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, sursa) VALUES (%s, '2015-01-20', 1, 44.6, 22.6, 'open-meteo-archive'), (%s, '2015-01-20', 2, 44.6, 22.6, 'open-meteo-archive')$q$, s, s), '23505')
     OR NOT pg_temp.t_refuza($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, sursa) VALUES (-987654, '2015-01-20', 1, 44.6, 22.6, 'open-meteo-archive')$q$, '23503')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, grila_lat, sursa) VALUES (%s, '2015-01-20', 1, 44.6, 22.6, 95, 'open-meteo-archive')$q$, s), '23514')
     OR NOT pg_temp.t_refuza($q$INSERT INTO public.meteo_praguri_nelucrabil (id) VALUES (2)$q$, '23514')
     OR NOT pg_temp.t_refuza($q$INSERT INTO public.meteo_praguri_jurnal (versiune, precipitatii_mm_min, zapada_cm_min, tmax_sub_c, tmin_max_c, actualizat_la) VALUES (1, 1, 1, 0, -5, now())$q$, '23505') THEN
    RAISE EXCEPTION 'T2 FAIL: constrângerile';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: anon nu citește nimic; non-owner citește, nu scrie, nu schimbă pragurile
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.meteo_istoric_zilnic', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.v_meteo_zile', '42501')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(1, 10, 1, 0, -5)', '42501') THEN
    RAISE EXCEPTION 'T3 FAIL: anon';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_ca(pg_temp.t_g('nu')::uuid, 'authenticated');
DO $t$
DECLARE s bigint := pg_temp.t_g('site')::bigint;
BEGIN
  IF (SELECT count(*) FROM public.meteo_istoric_zilnic WHERE site_id = s) <> 11 OR (SELECT count(*) FROM public.v_meteo_zile WHERE site_id = s AND zi_nelucrabila) <> 6
     OR (SELECT count(*) FROM public.meteo_praguri_nelucrabil) <> 1 OR (SELECT count(*) FROM public.meteo_praguri_jurnal) <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: citirea ca non-owner';
  END IF;
  IF NOT pg_temp.t_refuza($q$INSERT INTO public.meteo_praguri_jurnal (versiune, precipitatii_mm_min, zapada_cm_min, tmax_sub_c, tmin_max_c, actualizat_la) VALUES (9, 1, 1, 0, -5, now())$q$, '42501')
     OR NOT pg_temp.t_refuza('DELETE FROM public.meteo_praguri_jurnal', '42501') THEN
    RAISE EXCEPTION 'T3 FAIL: jurnalul scris ca non-owner';
  END IF;
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.meteo_istoric_zilnic (site_id, data, tmin_c, lat, lng, sursa) VALUES (%s, '2015-01-21', 1, 44.6, 22.6, 'open-meteo-archive')$q$, s), '42501')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.meteo_istoric_zilnic SET precipitatii_mm = 0 WHERE site_id = %s$q$, s), '42501')
     OR NOT pg_temp.t_refuza(format($q$DELETE FROM public.meteo_istoric_zilnic WHERE site_id = %s$q$, s), '42501')
     OR NOT pg_temp.t_refuza('UPDATE public.meteo_praguri_nelucrabil SET precipitatii_mm_min = 99', '42501')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(1, 20, 1, 0, -5)', '42501') THEN
    RAISE EXCEPTION 'T3 FAIL: scrierea ca non-owner';
  END IF;
  RAISE NOTICE 'T3 OK';
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');

-- T4: owner-ul schimbă pragurile prin RPC (CAS pe versiune); vederea reclasifică; refuzuri: versiune veche, praguri incomplete / în afara limitelor
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$
DECLARE s bigint := pg_temp.t_g('site')::bigint; v integer;
BEGIN
  IF NOT pg_temp.t_refuza('UPDATE public.meteo_praguri_nelucrabil SET precipitatii_mm_min = 99', '42501') THEN RAISE EXCEPTION 'T4 FAIL: UPDATE direct ca owner'; END IF;
  -- 9,99 nu se poate stoca într-o coloană cu o zecimală: refuz explicit, nu rotunjire în tăcere (review r1 P1)
  IF NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(1, 9.99, 1, 0, -5)', '22023') THEN RAISE EXCEPTION 'T4 FAIL: 9,99 acceptat'; END IF;
  v := public.fn_meteo_praguri_seteaza(1, 9.9, 1, 0, -5);
  IF v <> 2 THEN RAISE EXCEPTION 'T4 FAIL: versiunea nouă %', v; END IF;
  IF (SELECT precipitatii_mm_min FROM public.meteo_praguri_nelucrabil) <> 9.9 THEN RAISE EXCEPTION 'T4 FAIL: valoarea stocată'; END IF;
  IF NOT (SELECT zi_nelucrabila FROM public.v_meteo_zile WHERE site_id = s AND data = '2015-01-02')    -- 9,99 mm ≥ 9,9
     OR (SELECT praguri_versiune FROM public.v_meteo_zile WHERE site_id = s AND data = '2015-01-02') <> 2 THEN
    RAISE EXCEPTION 'T4 FAIL: reclasificarea după pragul nou';
  END IF;
  IF NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(1, 10, 1, 0, -5)', '40001')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(2, NULL, 1, 0, -5)', '22023')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(2, 0, 1, 0, -5)', '23514')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(2, 10, 1, 0, -60)', '23514')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(2, 10, 1, -0.05, -5)', '22023') THEN
    RAISE EXCEPTION 'T4 FAIL: refuzurile RPC';
  END IF;
  IF (SELECT versiune FROM public.meteo_praguri_nelucrabil) <> 2
     OR (SELECT actualizat_de FROM public.meteo_praguri_nelucrabil) IS DISTINCT FROM pg_temp.t_g('own')::uuid THEN
    RAISE EXCEPTION 'T4 FAIL: refuzurile au schimbat ceva / autorul';
  END IF;
  -- jurnalul: versiunea 1 (pornirea) + versiunea 2 (owner-ul), nimic din refuzuri
  IF (SELECT string_agg(versiune || ':' || precipitatii_mm_min || ':' || coalesce(actualizat_de::text, '-'), ',' ORDER BY versiune) FROM public.meteo_praguri_jurnal)
       IS DISTINCT FROM '1:10.0:-,2:9.9:' || pg_temp.t_g('own') THEN
    RAISE EXCEPTION 'T4 FAIL: jurnalul versiunilor';
  END IF;
  RAISE NOTICE 'T4 OK';
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');

-- T5: service_role (edge fn meteo-sync): upsert pe (site_id, data), fără DELETE și fără scriere pe praguri
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$
DECLARE s bigint := pg_temp.t_g('site')::bigint;
BEGIN
  INSERT INTO public.meteo_istoric_zilnic (site_id, data, precipitatii_mm, ploaie_mm, zapada_cm, tmin_c, tmax_c, lat, lng, sursa)
  VALUES (s, '2015-01-02', 12, 12, 0, 2, 8, 44.6, 22.6, 'open-meteo-archive')
  ON CONFLICT (site_id, data) DO UPDATE SET precipitatii_mm = EXCLUDED.precipitatii_mm, ploaie_mm = EXCLUDED.ploaie_mm, preluat_la = now();
  IF (SELECT precipitatii_mm FROM public.meteo_istoric_zilnic WHERE site_id = s AND data = '2015-01-02') <> 12 THEN RAISE EXCEPTION 'T5 FAIL: upsert'; END IF;
  IF NOT pg_temp.t_refuza(format($q$DELETE FROM public.meteo_istoric_zilnic WHERE site_id = %s$q$, s), '42501')
     OR NOT pg_temp.t_refuza('UPDATE public.meteo_praguri_nelucrabil SET precipitatii_mm_min = 99', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.meteo_praguri_jurnal', '42501')
     OR NOT pg_temp.t_refuza('SELECT public.fn_meteo_praguri_seteaza(2, 10, 1, 0, -5)', '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: service_role a putut șterge / schimba pragurile / citi jurnalul';
  END IF;
  RAISE NOTICE 'T5 OK';
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');

-- T6: revenirea — nearmată = refuz; armată cu rânduri = refuz; armată cu praguri schimbate = refuz (nimic nu se execută după eroare)
SAVEPOINT t6a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_meteo_istoric_zilnic_ROLLBACK.sql
\set t6a_eroare :ERROR
\set t6a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6a;
SELECT pg_temp.t_eroare('T6a', :'t6a_eroare', :'t6a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t6b;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_METEO_ISTORIC:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_meteo_istoric_zilnic_ROLLBACK.sql
\set t6b_eroare :ERROR
\set t6b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6b;
SELECT pg_temp.t_eroare('T6b', :'t6b_eroare', :'t6b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'tabelul are randuri');
DELETE FROM public.meteo_istoric_zilnic;
SAVEPOINT t6c;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_METEO_ISTORIC:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_meteo_istoric_zilnic_ROLLBACK.sql
\set t6c_eroare :ERROR
\set t6c_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6c;
SELECT pg_temp.t_eroare('T6c', :'t6c_eroare', :'t6c_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'pragurile au fost schimbate');
DO $t$ BEGIN
  IF to_regclass('public.meteo_istoric_zilnic') IS NULL OR to_regclass('public.v_meteo_zile') IS NULL
     OR (SELECT versiune FROM public.meteo_praguri_nelucrabil) <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T6 OK (refuzurile „garda invalida”, „tabelul are randuri”, „pragurile au fost schimbate” au fost verificate explicit)';
END $t$;

-- T7: revenirea armată pe stare goală scoate tot; re-aplicarea merge
UPDATE public.meteo_praguri_nelucrabil SET precipitatii_mm_min = 10, zapada_cm_min = 1, tmax_sub_c = 0, tmin_max_c = -5, versiune = 1, actualizat_de = NULL;
-- jurnalul încă are versiunea 2: revenirea trebuie să refuze și pentru el
SAVEPOINT t7a;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_METEO_ISTORIC:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_meteo_istoric_zilnic_ROLLBACK.sql
\set t7a_eroare :ERROR
\set t7a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7a;
SELECT pg_temp.t_eroare('T7a', :'t7a_eroare', :'t7a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'pragurile au fost schimbate');
DELETE FROM public.meteo_praguri_jurnal WHERE versiune > 1;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_METEO_ISTORIC:' || txid_current(), true);
\ir ../supabase/revenire/20261202a_meteo_istoric_zilnic_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.meteo_istoric_zilnic') IS NOT NULL OR to_regclass('public.meteo_praguri_nelucrabil') IS NOT NULL OR to_regclass('public.v_meteo_zile') IS NOT NULL
     OR to_regclass('public.meteo_praguri_jurnal') IS NOT NULL
     OR to_regprocedure('public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric)') IS NOT NULL
     OR current_setting('gazpet.revenire_20261202a', true) <> '' THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea';
  END IF;
END $t$;
\ir ../supabase/migrations/20261202a_meteo_istoric_zilnic.sql
DO $t$ BEGIN
  IF to_regclass('public.meteo_istoric_zilnic') IS NULL OR (SELECT versiune FROM public.meteo_praguri_nelucrabil) <> 1 THEN
    RAISE EXCEPTION 'T7 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T7 OK — toate testele au trecut; urmează ROLLBACK (nimic nu rămâne pe clonă)';
END $t$;

ROLLBACK;
