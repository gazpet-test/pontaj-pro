-- Test local (PG 17 gol, fără Supabase) pentru 20260930e_monitor_egress.sql.
-- Rulare: createdb egress_test && psql -v ON_ERROR_STOP=1 -d egress_test -f supabase/tests/monitor_egress_stub.sql
--         psql -v ON_ERROR_STOP=1 -d egress_test --single-transaction -f supabase/tests/monitor_egress_marcaj_runner.sql \
--           -f supabase/migrations/20260930e_monitor_egress.sql
--         psql -v ON_ERROR_STOP=1 -d egress_test -f supabase/tests/monitor_egress_test.sql
-- (fără marcaj, migrarea trebuie refuzată de garda de livrare)
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

-- T1: sub prag (20 descărcări/oră) → nimic
INSERT INTO storage_descarcari_jurnal (bucket, obiect, bytes, sursa) SELECT 'ofertare', 'a/sub.pdf', 1000, 'nas:ingest' FROM generate_series(1, 20);
SELECT egress_detector();
DO $$ BEGIN
  IF (SELECT count(*) FROM notifications) <> 0 THEN RAISE EXCEPTION 'T1: notificare sub prag'; END IF;
  IF EXISTS (SELECT 1 FROM storage_obiecte_blocate) THEN RAISE EXCEPTION 'T1: blocare sub prag'; END IF;
  RAISE NOTICE 'T1 OK: sub prag → nimic';
END $$;

-- T2: 25 descărcări același obiect (prin RPC, ca service_role) → notificare owner + blocare
SET ROLE service_role;
SELECT count(egress_log_descarcare('ofertare', 'ofertare/101/atribuire/huedin.pdf', 99614720, 'edge:ofertare-ingest-doc', 770)) FROM generate_series(1, 25);
SELECT egress_detector();
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM notifications WHERE type = 'egress_alerta' AND profile_id = '00000000-0000-0000-0000-000000000121' AND title LIKE '%BLOCAT%') <> 1
    THEN RAISE EXCEPTION 'T2: lipsă notificare owner'; END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE profile_id = '00000000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'T2: notificare la non-owner'; END IF;
  IF NOT (SELECT blocat FROM storage_obiecte_blocate WHERE obiect = 'ofertare/101/atribuire/huedin.pdf') THEN RAISE EXCEPTION 'T2: obiect neblocat'; END IF;
  RAISE NOTICE 'T2 OK: 25 descărcări → notificare owner + blocare';
END $$;
SET ROLE service_role;
DO $$ BEGIN
  IF NOT egress_obiect_blocat('ofertare', 'ofertare/101/atribuire/huedin.pdf') THEN RAISE EXCEPTION 'T3: poarta nu vede blocarea'; END IF;
  IF egress_obiect_blocat('ofertare', 'a/sub.pdf') THEN RAISE EXCEPTION 'T3: obiect sub prag blocat'; END IF;
  RAISE NOTICE 'T3 OK: circuit breaker vede blocarea';
END $$;
-- rerulare detector: fără notificare dublă în aceeași oră
SELECT egress_detector();
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM notifications WHERE title LIKE '%repetate%') <> 1 THEN RAISE EXCEPTION 'T4: notificare duplicată'; END IF;
  RAISE NOTICE 'T4 OK: fără spam la rerulare';
END $$;

-- T5: deblocare — non-owner refuzat, anon refuzat, owner OK
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  BEGIN PERFORM egress_deblocheaza('ofertare', 'ofertare/101/atribuire/huedin.pdf'); RAISE EXCEPTION 'T5: non-owner a deblocat';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM egress_statistici(30); RAISE EXCEPTION 'T5: non-owner vede statistici';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM storage_descarcari_jurnal) <> 0 THEN RAISE EXCEPTION 'T5: RLS lasă non-owner să citească jurnalul'; END IF;
  BEGIN PERFORM egress_log_descarcare('ofertare', 'x', 1, 'hack'); RAISE EXCEPTION 'T5: authenticated poate scrie în jurnal';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO storage_descarcari_jurnal (bucket, obiect, sursa) VALUES ('x','y','z'); RAISE EXCEPTION 'T5: insert direct permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM egress_detector(); RAISE EXCEPTION 'T5: authenticated rulează detectorul';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'T5a OK: authenticated non-owner refuzat';
END $$;
RESET ROLE; RESET request.jwt.claim.sub;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM storage_descarcari_jurnal; RAISE EXCEPTION 'T5: anon citește jurnalul';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM egress_deblocheaza('ofertare', 'ofertare/101/atribuire/huedin.pdf'); RAISE EXCEPTION 'T5: anon deblochează';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM egress_obiect_blocat('ofertare', 'x'); RAISE EXCEPTION 'T5: anon apelează poarta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'T5b OK: anon refuzat';
END $$;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000121';
DO $$ DECLARE s jsonb; BEGIN
  IF (SELECT count(*) FROM storage_descarcari_jurnal) = 0 THEN RAISE EXCEPTION 'T6: owner nu vede jurnalul'; END IF;
  s := egress_statistici(30);
  IF jsonb_array_length(s->'pe_zi') <> 30 OR (s->'top_obiecte'->0->>'obiect') <> 'ofertare/101/atribuire/huedin.pdf' OR NOT (s->'top_obiecte'->0->>'blocat')::boolean
    THEN RAISE EXCEPTION 'T6: statistici greșite %', s; END IF;
  IF NOT egress_deblocheaza('ofertare', 'ofertare/101/atribuire/huedin.pdf') THEN RAISE EXCEPTION 'T6: owner nu poate debloca'; END IF;
  RAISE NOTICE 'T6 OK: owner vede statistici + deblochează';
END $$;
RESET ROLE; RESET request.jwt.claim.sub;
-- după deblocare, detectorul nu reblochează imediat pe aceleași descărcări vechi
SELECT egress_detector();
DO $$ BEGIN
  IF (SELECT blocat FROM storage_obiecte_blocate WHERE obiect = 'ofertare/101/atribuire/huedin.pdf') THEN RAISE EXCEPTION 'T7: reblocat imediat după deblocare'; END IF;
  IF (SELECT deblocat_de FROM storage_obiecte_blocate WHERE obiect = 'ofertare/101/atribuire/huedin.pdf') <> '00000000-0000-0000-0000-000000000121' THEN RAISE EXCEPTION 'T7: deblocat_de lipsă'; END IF;
  RAISE NOTICE 'T7 OK: deblocarea owner-ului e respectată';
END $$;

-- T8: prag zilnic + cotă ciclu 50% / 80% (o singură notificare fiecare)
UPDATE storage_egress_config SET prag_zilnic_bytes = 1000000000, cota_ciclu_bytes = 4000000000;
SELECT egress_detector(); SELECT egress_detector();
DO $$ BEGIN
  IF (SELECT count(*) FROM notifications WHERE title LIKE '%prag zilnic%') <> 1 THEN RAISE EXCEPTION 'T8: prag zilnic'; END IF;
  IF (SELECT count(*) FROM notifications WHERE title LIKE '%50%%cota%') <> 1 OR (SELECT count(*) FROM notifications WHERE title LIKE '%80%%cota%') <> 0
    THEN RAISE EXCEPTION 'T8: cota ciclu (2,49 GB din 4 GB = 62%% → doar 50%%)'; END IF;
  RAISE NOTICE 'T8 OK: prag zilnic + cotă 50%%';
END $$;
DO $$ BEGIN
  IF egress_ciclu_start('2026-09-25 10:00+00') <> '2026-09-07 00:00+00' OR egress_ciclu_start('2026-10-03 10:00+00') <> '2026-09-07 00:00+00'
    THEN RAISE EXCEPTION 'T9: ciclu_start'; END IF;
  RAISE NOTICE 'T9 OK: ciclul 07→07';
END $$;
SELECT 'TOATE TESTELE OK' AS rezultat;
