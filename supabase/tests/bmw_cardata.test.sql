-- ============================================================================
-- 20261030c — BMW CarData (append-only, RLS citiri: owner + logistica; locatii: doar owner). Date FICTIVE, PG local *_test.
-- Rulat de scripts/test_bmw_cardata.sh DUPĂ aplicarea migrării pe bmw_cardata_schelet.sql.
-- Totul într-o tranzacție anulată la final (ROLLBACK); fiecare acțiune testată = subtranzacție anulată.
-- Aserțiune picată → 'ESEC TEST: …'; la final SUITA_OK.
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

-- rulează p_sql ca (rol, uid); întoarce 'ok:<rânduri>' sau 'err:<SQLSTATE>'; mereu anulat
CREATE FUNCTION pg_temp.efect(p_rol text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; s text; m bigint; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_rol)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    n := 0;
    FOREACH s IN ARRAY string_to_array(p_sql, ';;') LOOP
      EXECUTE s; GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
    END LOOP;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ok:' || n;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF; RAISE NOTICE 'OK %', p_nume; END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real, 'NULL') || ' vs ' || p_astept || ']'); END $$;

DO $t$
DECLARE
  own text := '00000000-0000-0000-0000-000000000001';
  log text := '00000000-0000-0000-0000-000000000002';
  alt text := '00000000-0000-0000-0000-000000000003';
  c1 bigint; c2 bigint; v record;
  ins_ok text := 'INSERT INTO public.bmw_cardata_citiri (id_citire, citit_la, vin, odometru_km, raspuns_brut, sursa) VALUES ';
BEGIN
  -- T1 structura (pe baza fără migrare suita cade AICI — discriminare)
  PERFORM pg_temp.ok(to_regclass('public.bmw_cardata_citiri') IS NOT NULL AND to_regclass('public.bmw_cardata_locatii') IS NOT NULL
                     AND to_regclass('public.v_bmw_cardata_vs_evogps') IS NOT NULL, 'T1 tabelele + view-ul există');
  PERFORM pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.bmw_cardata_citiri'::regclass, 'public.bmw_cardata_locatii'::regclass)),
                     'T1 RLS activ pe ambele');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_bmw_cardata_vs_evogps'::regclass AND 'security_invoker=on' = ANY (reloptions)),
                     'T1 view security_invoker');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'v_bmw_cardata_vs_evogps'
                                  AND column_name IN ('lat', 'lon', 'heading', 'raspuns_brut')), 'T1 view fără locație / brut');

  -- fixture (ca scriptul: postgres). Odometrul BMW: 11.10 seara și 13.10 seara (Europe/Bucharest).
  INSERT INTO public.bmw_cardata_citiri (id_citire, citit_la, vin, odometru_km, odometru_la, combustibil_pct, soc_pct, raspuns_brut, sursa)
  VALUES ('11111111-1111-4111-8111-111111111111', '2026-10-12 04:00+00', 'WBATEST0000000001', 48100, '2026-10-11 18:00+03', 60, 80,
          '{"vehicle.vehicle.travelledDistance": {"value": "48100", "unit": "km", "timestamp": "2026-10-11T15:00:00Z"}}', 'bmw_cardata_rest')
  RETURNING id INTO c1;
  INSERT INTO public.bmw_cardata_citiri (id_citire, citit_la, vin, odometru_km, odometru_la, raspuns_brut, sursa, importat_la)
  VALUES ('22222222-2222-4222-8222-222222222222', '2026-10-14 04:00+00', 'WBATEST0000000001', 48145.5, '2026-10-13 19:00+03',
          '{}', 'bmw_cardata_rest', '2000-01-01')
  RETURNING id INTO c2;
  INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, pozitie_la, lat, lon, heading)
  VALUES (c2, '2026-10-14 04:00+00', '2026-10-13 19:00+03', 44.936667, 26.012345, 181);
  PERFORM pg_temp.ok((SELECT importat_la > '2026-01-01' FROM public.bmw_cardata_citiri WHERE id = c2), 'T2 importat_la pus de BD (nu cel trimis)');

  -- T3 anon: nimic
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, 'SELECT * FROM public.bmw_cardata_citiri'), 'err:42501', 'T3 anon SELECT citiri');
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, 'SELECT * FROM public.bmw_cardata_locatii'), 'err:42501', 'T3 anon SELECT locatii');
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, 'SELECT * FROM public.v_bmw_cardata_vs_evogps'), 'err:42501', 'T3 anon SELECT view');
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, 'SELECT public.bmw_cardata_este_owner()'), 'err:42501', 'T3 anon EXECUTE funcția de acces');

  -- T4 authenticated fără uid / fără modul logistica: 0 rânduri
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', NULL, 'SELECT * FROM public.bmw_cardata_citiri'), 'ok:0', 'T4 authenticated fără uid → 0');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', alt, 'SELECT * FROM public.bmw_cardata_citiri'), 'ok:0', 'T4 alt modul → 0 citiri');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', alt, 'SELECT * FROM public.bmw_cardata_locatii'), 'ok:0', 'T4 alt modul → 0 locații');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', alt, 'SELECT * FROM public.v_bmw_cardata_vs_evogps'), 'ok:0', 'T4 alt modul → 0 în view');

  -- T5 modulul logistica: citirile da, locațiile NU
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', log, 'SELECT * FROM public.bmw_cardata_citiri'), 'ok:2', 'T5 logistica → 2 citiri');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', log, 'SELECT * FROM public.bmw_cardata_locatii'), 'ok:0', 'T5 logistica → 0 locații');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', log, 'SELECT * FROM public.v_bmw_cardata_vs_evogps'), 'ok:2', 'T5 logistica → 2 zile în view');

  -- T6 owner: tot
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, 'SELECT * FROM public.bmw_cardata_citiri'), 'ok:2', 'T6 owner → 2 citiri');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, 'SELECT * FROM public.bmw_cardata_locatii'), 'ok:1', 'T6 owner → 1 locație');

  -- T7 nicio scriere din aplicație, nici pentru owner
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1, ''{}'', ''bmw_cardata_rest'')'),
                     'err:42501', 'T7 owner INSERT citiri → 42501');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, 'UPDATE public.bmw_cardata_citiri SET odometru_km = 1'), 'err:42501', 'T7 owner UPDATE → 42501');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, 'DELETE FROM public.bmw_cardata_citiri'), 'err:42501', 'T7 owner DELETE → 42501');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, 'TRUNCATE public.bmw_cardata_citiri CASCADE'), 'err:42501', 'T7 owner TRUNCATE → 42501');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own, 'DELETE FROM public.bmw_cardata_locatii'), 'err:42501', 'T7 owner DELETE locatii → 42501');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', log, 'UPDATE public.bmw_cardata_citiri SET vin = vin'), 'err:42501', 'T7 logistica UPDATE → 42501');

  -- T8 service_role: citește citirile, nu are nimic pe locații, nu scrie
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, 'SELECT * FROM public.bmw_cardata_citiri'), 'ok:2', 'T8 service_role SELECT citiri');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, 'SELECT * FROM public.bmw_cardata_locatii'), 'err:42501', 'T8 service_role SELECT locatii → 42501');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1, ''{}'', ''bmw_cardata_rest'')'),
                     'err:42501', 'T8 service_role INSERT → 42501');

  -- T9 append-only și pentru postgres (triggere)
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, 'UPDATE public.bmw_cardata_citiri SET odometru_km = 1'), 'err:42501', 'T9 postgres UPDATE citiri → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, 'DELETE FROM public.bmw_cardata_citiri WHERE id = ' || c1), 'err:42501', 'T9 postgres DELETE citiri → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, 'TRUNCATE public.bmw_cardata_locatii'), 'err:42501', 'T9 postgres TRUNCATE locatii → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, 'TRUNCATE public.bmw_cardata_citiri CASCADE'), 'err:42501', 'T9 postgres TRUNCATE citiri → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, 'UPDATE public.bmw_cardata_locatii SET lat = 1'), 'err:42501', 'T9 postgres UPDATE locatii → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, 'DELETE FROM public.bmw_cardata_locatii'), 'err:42501', 'T9 postgres DELETE locatii → refuz');

  -- T10 constrângeri (ca postgres = scriptul)
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBAIOQ00000000001'', 1, ''{}'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 VIN invalid');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', -1, ''{}'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 odometru negativ');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1000001, ''{}'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 odometru implauzibil');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1, ''{"vehicle.cabin.infotainment.navigation.currentLocation.latitude": {"value": "44.9"}}'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 locație în raspuns_brut (cheie)');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1, ''{"x": {"unit": "Longitude"}}'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 locație în raspuns_brut (valoare, majuscule)');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1, ''[]'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 raspuns_brut care nu e obiect');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now(), ''WBATEST0000000001'', 1, ''{}'', ''altceva'')'),
                     'err:23514', 'T10 sursa necunoscută');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(gen_random_uuid(), now() + interval ''1 hour'', ''WBATEST0000000001'', 1, ''{}'', ''bmw_cardata_rest'')'),
                     'err:23514', 'T10 citit_la în viitor');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(''11111111-1111-4111-8111-111111111111'', now(), ''WBATEST0000000001'', 1, ''{}'', ''bmw_cardata_rest'')'),
                     'err:23505', 'T10 id_citire dublat');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, ins_ok || '(''11111111-1111-4111-8111-111111111111'', now(), ''WBATEST0000000001'', 1, ''{}'', ''bmw_cardata_rest'') ON CONFLICT (id_citire) DO NOTHING'),
                     'ok:0', 'T10 id_citire dublat + ON CONFLICT DO NOTHING (reluarea scriptului) → 0');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, format('INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, lat, lon) VALUES (%s, %L, 0, 0)', c1, '2026-10-12 04:00+00')),
                     'err:23514', 'T10 locație (0, 0)');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, format('INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, lat, lon) VALUES (%s, %L, 91, 26)', c1, '2026-10-12 04:00+00')),
                     'err:23514', 'T10 lat 91');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, format('INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, lat, lon) VALUES (%s, %L, 44.9, 26)', c1, '2026-10-12 05:00+00')),
                     'err:23514', 'T10 citit_la locație ≠ citit_la citire');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, format('INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, lat, lon) VALUES (%s, %L, 44.9, 26)', c2, '2026-10-14 04:00+00')),
                     'err:23505', 'T10 a doua locație pentru aceeași citire');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL, format('INSERT INTO public.bmw_cardata_locatii (citire_id, citit_la, lat, lon) VALUES (%s, %L, 44.9, 26)', c1, '2026-10-12 04:00+00')),
                     'ok:1', 'T10 locație validă pentru c1 → 1 (anulat)');

  -- T11 view-ul: interval 11.10 → 13.10: BMW 45,5 km; Evo GPS (12.10 + 13.10, doar sursa evogps) = 0 + 40 = 40
  SELECT * INTO v FROM public.v_bmw_cardata_vs_evogps WHERE zi = '2026-10-13';
  PERFORM pg_temp.eq(v.active_id::text, '237', 'T11 legat de activ prin VIN (upper/btrim pe serie_sasiu)');
  PERFORM pg_temp.eq(v.zi_precedenta::text, '2026-10-11', 'T11 zi precedentă');
  PERFORM pg_temp.eq(v.km_bmw_interval::text, '45.5', 'T11 km BMW pe interval');
  PERFORM pg_temp.eq(v.km_evogps_interval::text, '40', 'T11 km Evo GPS pe interval (fără alta_sursa)');
  PERFORM pg_temp.eq(v.zile_evogps_interval::text, '2', 'T11 zile Evo în interval');
  PERFORM pg_temp.eq(v.diferenta_km_interval::text, '5.5', 'T11 diferența BMW − Evo');
  PERFORM pg_temp.eq(v.odometru_evogps_km::text, '120150', 'T11 odometrul Evo din aceeași zi');
  SELECT * INTO v FROM public.v_bmw_cardata_vs_evogps WHERE zi = '2026-10-11';
  PERFORM pg_temp.ok(v.km_bmw_interval IS NULL AND v.km_evogps_interval IS NULL, 'T11 prima zi: fără interval');
END $t$;

ROLLBACK;
\echo SUITA_OK
