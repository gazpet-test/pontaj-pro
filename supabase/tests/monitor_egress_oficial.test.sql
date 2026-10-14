-- Suita pentru 20261030a_egress_contoare_oficiale (DOAR PG local: schelet + 20260930e + 20261002a + 20261030a).
-- Dry-run: totul într-o tranzacție care se termină cu ROLLBACK (baza rămâne cum a fost); orice abatere = RAISE EXCEPTION.
-- Rulare: psql -X -v ON_ERROR_STOP=1 -d <baza> -f supabase/tests/monitor_egress_oficial.test.sql  (vezi scripts/test_egress_contoare_oficiale.sh)
-- Fără meta-comenzi psql în corp (rulează și prin alte clienți care execută SQL simplu).
BEGIN;
SET LOCAL client_min_messages = warning;
TRUNCATE public.storage_descarcari_jurnal, public.storage_obiecte_blocate, public.storage_egress_alerte, public.notifications, public.supabase_usage_oficial;

-- O1. fără citire oficială: statistici → oficial/oficial_ultima/vechime null + cota_cached 250 GB; cheile vechi neschimbate; detectorul tace
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000121', true);
DO $$ DECLARE s jsonb; BEGIN
  s := public.egress_statistici(30);
  IF NOT (s ? 'oficial') OR jsonb_typeof(s->'oficial') <> 'null' THEN RAISE EXCEPTION 'O1: oficial trebuia null: %', s->'oficial'; END IF;
  IF NOT (s ? 'oficial_ultima') OR jsonb_typeof(s->'oficial_ultima') <> 'null' OR jsonb_typeof(s->'oficial_vechime_ore') <> 'null' THEN
    RAISE EXCEPTION 'O1: oficial_ultima / oficial_vechime_ore trebuiau null: % / %', s->'oficial_ultima', s->'oficial_vechime_ore';
  END IF;
  IF (s->>'cota_cached')::bigint <> 268435456000 THEN RAISE EXCEPTION 'O1: cota_cached %', s->'cota_cached'; END IF;
  IF NOT (s ?& ARRAY['pe_zi','top_obiecte','blocate','ciclu','config']) OR jsonb_array_length(s->'pe_zi') <> 30
     OR NOT (s->'ciclu' ?& ARRAY['start','bytes','cota','alerte_procent'])
     OR NOT (s->'config' ?& ARRAY['prag_obiect_ora','prag_zilnic_bytes','blocare_activa']) THEN
    RAISE EXCEPTION 'O1: cheile vechi ale statisticilor s-au schimbat: %', s;
  END IF;
  RAISE NOTICE 'O1 OK: fără citire → oficial / oficial_ultima null, cota_cached 250 GB, cheile vechi intacte';
END $$;
RESET ROLE;
DO $$ DECLARE v jsonb; BEGIN
  v := public.egress_detector();
  IF (v->>'alerte')::int <> 0 OR EXISTS (SELECT 1 FROM storage_egress_alerte) THEN RAISE EXCEPTION 'O1: alerte fără citire: %', v; END IF;
END $$;

-- O1b. filtrul pe ciclu, la ziua-limită: există DOAR o citire din ciclul trecut, cu ciclu_sfarsit = AZI (capăt exclusiv),
--      cea mai nouă citire (acum 30 min) și 96% pe ambele contoare ⇒ nu e „ciclul curent”: oficial null, zero alerte;
--      dar oficial_ultima o arată (widgetul afișează citirea veche cu avertisment).
SET LOCAL ROLE service_role;
INSERT INTO public.supabase_usage_oficial (citit_la, ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, storage_size_bytes, sursa)
SELECT now() - interval '30 minutes', (d - interval '1 month')::date, d, 240 * 1073741824::bigint, 240 * 1073741824::bigint, 1, 'dashboard'
  FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS d) x;
RESET ROLE;
DO $$ DECLARE v jsonb; BEGIN
  v := public.egress_detector();
  IF EXISTS (SELECT 1 FROM storage_egress_alerte) THEN RAISE EXCEPTION 'O1b: alerte dintr-o citire din ciclul trecut (ziua-limită)'; END IF;
  IF (v->>'oficial_citit_la') IS NOT NULL THEN RAISE EXCEPTION 'O1b: detectorul a luat citirea din ciclul trecut: %', v; END IF;
END $$;
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000121', true);
DO $$ DECLARE s jsonb; BEGIN
  s := public.egress_statistici(30);
  IF jsonb_typeof(s->'oficial') <> 'null' THEN RAISE EXCEPTION 'O1b: oficial trebuia null la ziua-limită: %', s->'oficial'; END IF;
  IF (s->'oficial_ultima'->>'egress_bytes')::bigint <> 240 * 1073741824::bigint OR (s->'oficial_ultima') ? 'raspuns_brut'
     OR (s->'oficial_ultima'->>'ciclu_sfarsit')::date <> (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'O1b: oficial_ultima greșit: %', s->'oficial_ultima';
  END IF;
  IF (s->>'oficial_vechime_ore')::numeric NOT BETWEEN 0.4 AND 0.6 THEN RAISE EXCEPTION 'O1b: oficial_vechime_ore %', s->'oficial_vechime_ore'; END IF;
  RAISE NOTICE 'O1b OK: citirea din ciclul trecut (ziua-limită) nu e „curentă”, dar apare în oficial_ultima + vechime';
END $$;
RESET ROLE;

-- O2. citiri în ciclul curent: egress 130 GB (52%), cached 210 GB (84%), plus una mai veche; citirea din ciclul trecut
--     (96%) rămâne CEA MAI NOUĂ după citit_la ⇒ fără filtrul pe ciclu ar ieși 80% pe egress (testul ar pica)
SET LOCAL ROLE service_role;
INSERT INTO public.supabase_usage_oficial (citit_la, ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, storage_size_bytes, sursa, raspuns_brut)
SELECT now() - interval '2 hours', d, (d + interval '1 month')::date, 4724464025, 85899346, 5368709120, 'dashboard', '{"nota":"citire veche, ciclul curent"}'
  FROM (SELECT (egress_ciclu_start(now()) AT TIME ZONE 'UTC')::date AS d) x;
INSERT INTO public.supabase_usage_oficial (citit_la, ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, storage_size_bytes, sursa)
SELECT now() - interval '1 hour', d, (d + interval '1 month')::date, 130 * 1073741824::bigint, 210 * 1073741824::bigint, 5368709120, 'mgmt_api'
  FROM (SELECT (egress_ciclu_start(now()) AT TIME ZONE 'UTC')::date AS d) x;
RESET ROLE;
DO $$ DECLARE v jsonb; BEGIN
  v := public.egress_detector();
  IF (SELECT count(*) FROM storage_egress_alerte WHERE tip = 'oficial_egress') <> 1
     OR NOT EXISTS (SELECT 1 FROM storage_egress_alerte WHERE tip = 'oficial_egress' AND cheie LIKE '%:50') THEN RAISE EXCEPTION 'O2: oficial_egress (doar 50%%)'; END IF;
  IF (SELECT count(*) FROM storage_egress_alerte WHERE tip = 'oficial_cached') <> 2 THEN RAISE EXCEPTION 'O2: oficial_cached (50%% + 80%%)'; END IF;
  IF EXISTS (SELECT 1 FROM storage_egress_alerte WHERE tip LIKE 'oficial%' AND cheie NOT LIKE to_char((egress_ciclu_start(now()) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') || ':%') THEN
    RAISE EXCEPTION 'O2: alertă oficială pe alt ciclu decât cel curent'; END IF;
  IF (SELECT count(*) FROM notifications WHERE type = 'egress_alerta' AND title LIKE '%(oficial)%' AND profile_id = '00000000-0000-0000-0000-000000000121') <> 3
    THEN RAISE EXCEPTION 'O2: 3 notificări owner așteptate'; END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE profile_id = '00000000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'O2: notificare la non-owner'; END IF;
  IF EXISTS (SELECT 1 FROM storage_obiecte_blocate) THEN RAISE EXCEPTION 'O2: contoarele oficiale nu au voie să blocheze'; END IF;
  IF EXISTS (SELECT 1 FROM storage_egress_alerte WHERE tip = 'colector_oprit') THEN RAISE EXCEPTION 'O2: colector_oprit cu citire de acum 30 min'; END IF;
  IF (v->>'oficial_citit_la') IS NULL THEN RAISE EXCEPTION 'O2: detectorul nu raportează citirea'; END IF;
  -- rerulare: fără dubluri (o dată per prag per ciclu)
  PERFORM public.egress_detector(); PERFORM public.egress_detector();
  IF (SELECT count(*) FROM notifications WHERE title LIKE '%(oficial)%') <> 3 OR (SELECT count(*) FROM storage_egress_alerte) <> 3 THEN RAISE EXCEPTION 'O2: dubluri la rerulare'; END IF;
  RAISE NOTICE 'O2 OK: 50%% egress + 50/80%% cached → 3 alerte owner, o singură dată, doar din ciclul curent, fără blocări';
END $$;

-- O3. statistici: oficial = ultima citire din ciclul curent (nu cea din ciclul trecut, deși e mai nouă), fără raspuns_brut;
--     oficial_ultima = cea mai nouă din orice ciclu
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000121', true);
DO $$ DECLARE s jsonb; BEGIN
  s := public.egress_statistici(30);
  IF (s->'oficial'->>'cached_egress_bytes')::bigint <> 210 * 1073741824::bigint OR (s->'oficial'->>'sursa') <> 'mgmt_api'
     OR (s->'oficial') ? 'raspuns_brut' OR (s->'oficial'->>'citit_la') IS NULL THEN
    RAISE EXCEPTION 'O3: oficial greșit: %', s->'oficial';
  END IF;
  IF (s->'oficial_ultima'->>'cached_egress_bytes')::bigint <> 240 * 1073741824::bigint THEN RAISE EXCEPTION 'O3: oficial_ultima greșit: %', s->'oficial_ultima'; END IF;
  IF (SELECT count(*) FROM public.supabase_usage_oficial) <> 3 THEN RAISE EXCEPTION 'O3: owner nu vede toate citirile'; END IF;
  -- owner-ul NU scrie direct (scrierea e a colectorului)
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', 1, 1, 'x');
    RAISE EXCEPTION 'O3: owner a inserat direct'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.supabase_usage_oficial SET egress_bytes = 0; RAISE EXCEPTION 'O3: owner a modificat'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.supabase_usage_oficial; RAISE EXCEPTION 'O3: owner a șters'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'O3 OK: statistici.oficial = ultima citire din ciclul curent, oficial_ultima = cea mai nouă; owner doar citește';
END $$;
RESET ROLE;

-- O4. non-owner: 0 rânduri (RLS), nu scrie, nu vede statistici; anon refuzat
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.supabase_usage_oficial) <> 0 THEN RAISE EXCEPTION 'O4: non-owner vede citirile'; END IF;
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', 1, 1, 'x');
    RAISE EXCEPTION 'O4: non-owner a inserat'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.egress_statistici(30); RAISE EXCEPTION 'O4: non-owner vede statistici'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.egress_detector(); RAISE EXCEPTION 'O4: authenticated rulează detectorul'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'O4a OK: non-owner refuzat';
END $$;
RESET ROLE;
SET LOCAL ROLE anon; SELECT set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM public.supabase_usage_oficial; RAISE EXCEPTION 'O4: anon citește'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', 1, 1, 'x');
    RAISE EXCEPTION 'O4: anon a inserat'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'O4b OK: anon refuzat';
END $$;
RESET ROLE;

-- O5. contractul tabelei: AMBELE contoare obligatorii (citire parțială refuzată), bytes negativi, ciclu inversat, sursă goală → refuz
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', 1, 'x');
    RAISE EXCEPTION 'O5: citire fără cached_egress_bytes acceptată'; EXCEPTION WHEN not_null_violation THEN NULL; END;
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, cached_egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', 1, 'x');
    RAISE EXCEPTION 'O5: citire fără egress_bytes acceptată'; EXCEPTION WHEN not_null_violation THEN NULL; END;
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', -1, 1, 'x');
    RAISE EXCEPTION 'O5: bytes negativi acceptați'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa) VALUES ('2026-11-07', '2026-10-07', 1, 1, 'x');
    RAISE EXCEPTION 'O5: ciclu inversat acceptat'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.supabase_usage_oficial (ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa) VALUES ('2026-10-07', '2026-11-07', 1, 1, ' ');
    RAISE EXCEPTION 'O5: sursă goală acceptată'; EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'O5 OK: contractul tabelei (ambele contoare NOT NULL + CHECK-uri)';
END $$;
RESET ROLE;

-- O6. colector oprit: ultima citire > 26 h → alertă; o notificare care pică nu anulează alerta; rerularea nu dublează
UPDATE public.supabase_usage_oficial SET citit_la = citit_la - interval '27 hours';
CREATE FUNCTION pg_temp.t_notif_pica() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'notificare forțată să eșueze'; END $f$;
CREATE TRIGGER t_notif_pica BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.t_notif_pica();
DO $$ DECLARE v jsonb; BEGIN
  v := public.egress_detector();
  IF (SELECT count(*) FROM storage_egress_alerte WHERE tip = 'colector_oprit' AND cheie = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')) <> 1 THEN
    RAISE EXCEPTION 'O6: alerta colector_oprit lipsă'; END IF;
  IF (v->>'notificari_esuate')::int < 1 THEN RAISE EXCEPTION 'O6: notificarea eșuată nu e raportată: %', v; END IF;
  -- verificarea + inserarea s-au făcut sub lock-ul consultativ de tranzacție (concurența reală: harness-ul PG17, pasul 2b)
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
                   AND classid = ((hashtext('egress_colector_oprit')::bigint >> 32) & 4294967295)::oid
                   AND objid = (hashtext('egress_colector_oprit')::bigint & 4294967295)::oid) THEN
    RAISE EXCEPTION 'O6: detectorul nu ține lock-ul consultativ egress_colector_oprit';
  END IF;
  PERFORM public.egress_detector();
  IF (SELECT count(*) FROM storage_egress_alerte WHERE tip = 'colector_oprit') <> 1 THEN RAISE EXCEPTION 'O6: colector_oprit dublat'; END IF;
  RAISE NOTICE 'O6 OK: colector oprit > 26 h → alertă; notificarea eșuată nu o anulează';
END $$;
DROP TRIGGER t_notif_pica ON public.notifications;

-- O6b. dedupe pe 24 h, nu pe ziua calendaristică: alerta precedentă emisă IERI, acum 23 h (ex. 23:55 UTC, iar acum e
--      a doua zi) ⇒ nicio alertă nouă; abia după 24 h vine următoarea
UPDATE public.storage_egress_alerte SET created_at = now() - interval '23 hours',
       cheie = to_char((now() AT TIME ZONE 'UTC')::date - 1, 'YYYY-MM-DD') WHERE tip = 'colector_oprit';
DO $$ BEGIN
  PERFORM public.egress_detector();
  IF (SELECT count(*) FROM storage_egress_alerte WHERE tip = 'colector_oprit') <> 1 THEN
    RAISE EXCEPTION 'O6b: a doua alertă colector_oprit la mai puțin de 24 h (peste miezul nopții UTC)'; END IF;
END $$;
UPDATE public.storage_egress_alerte SET created_at = now() - interval '25 hours' WHERE tip = 'colector_oprit';
DO $$ BEGIN
  PERFORM public.egress_detector();
  IF (SELECT count(*) FROM storage_egress_alerte WHERE tip = 'colector_oprit') <> 2 THEN RAISE EXCEPTION 'O6b: lipsă alerta după 24 h'; END IF;
  IF (SELECT count(*) FROM notifications WHERE title LIKE '%colectorul%' AND profile_id = '00000000-0000-0000-0000-000000000121') <> 1 THEN
    RAISE EXCEPTION 'O6b: notificarea owner după 24 h lipsă'; END IF;
  RAISE NOTICE 'O6b OK: „colector oprit” cel mult o dată la 24 h';
END $$;

-- O7. cota egress necache (cota_ciclu_bytes) rămâne cea veche — coloana nouă e doar pentru cached
DO $$ BEGIN
  IF (SELECT cota_ciclu_bytes FROM storage_egress_config WHERE id = 1) <> 268435456000 THEN RAISE EXCEPTION 'O7: cota necache schimbată'; END IF;
  RAISE NOTICE 'O7 OK: cota egress necache neatinsă (250 GB)';
END $$;

DO $$ BEGIN RAISE NOTICE 'SUITA_OK monitor_egress_oficial'; END $$;
ROLLBACK;
