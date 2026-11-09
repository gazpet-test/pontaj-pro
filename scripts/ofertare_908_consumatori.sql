-- Consumatorii cozilor AI Ofertare pe durata livrării / revenirii PR #908 (20261124a; r3 + r4: review r3 Jakarinos P1-03 / Copilot P1-01).
-- Workerul NAS se oprește separat (docker stop gazpet-ofertare-worker pe Terra); aici: rezerva din BD — joburile pg_cron
-- ofertare_extragere_worker (ofertare_extragere_tick) și ofertare_ingest_worker (ofertare_ingest_tick), care preiau cozile când
-- heartbeat-ul workerului e mai vechi de 10 minute. NU atinge datele din cozi.
-- Rulare (psql):  psql ... -v mod=suspenda|verifica|reia [-v deploy_la=<ISO, obligatoriu la verifica>] -f scripts/ofertare_908_consumatori.sql
--   „suspenda”: joburile active → inactive (tranzacție, ambele verificate pe NUME), apoi raportul.
--   „verifica”: DOAR citire. BARIERA DE DRENARE (r4): pică (ON_ERROR_STOP) dacă oricare condiție nu e îndeplinită; livrarea continuă
--               numai după un „verifica” trecut. Ce dovedește și ce NU:
--               - net.http_request_queue = cererile pg_net ÎN AȘTEPTARE (nepreluate). pg_net scoate cererea din coadă ÎNAINTE s-o execute,
--                 deci 0 aici NU înseamnă „nimic în zbor” (r3: Jakarinos P1-03, Copilot P1-01) — e doar una din condiții;
--               - apelurile DEJA lansate se dovedesc prin timp: o invocare Edge trăiește cel mult 400 s (limita de wall-clock a platformei),
--                 deci bariera cere ca ULTIMA lansare posibilă să fie mai veche de 7 minute: ultimul deploy al celor 11 edge-uri (r5, reper
--                 dat explicit cu -v deploy_la), ultimul start al joburilor pg_cron (și nicio rulare a lor încă în execuție), ultimul
--                 heartbeat al workerului NAS (oprit) și ultimul cost AI Ofertare înregistrat (ai_usage_log);
--               - extragerea lansată de tick păstrează req_id: fiecare req_id trebuie să aibă răspuns în net._http_response (sau să fie
--                 mai vechi de 7 minute);
--               - 0 cereri active în cele 4 cozi (condiția migrării 20261124a).
--               Apelurile din UI către cele 11 edge-uri: după deploy-ul edge-urilor NOI (pasul 2 din planul PR-ului) toate căile plătite din
--               ele cer o funcție SQL a migrării (fn_ofertare_poate_cheltui / fn_ofertare_poate_cheltui_fara_licitatie) → refuz până la
--               migrare; bariera verifică și că nu mai există cost AI Ofertare în ultimele 7 minute. Celelalte edge-uri Ofertare (faza 3,
--               în afara #908) își păstrează regula de azi.
--   „reia”:     joburile inactive → active (după migrare + workerul nou), apoi raportul.
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('gazpet.consumatori_908', :'mod', true) IS NOT NULL AS marcaj;
\if :{?deploy_la}
SELECT set_config('gazpet.deploy_la_908', :'deploy_la', true) IS NOT NULL AS reper_deploy;
\endif
DO $c$
DECLARE v_mod text := current_setting('gazpet.consumatori_908', true); v_j text; v_n int; v_t timestamptz;
BEGIN
  IF v_mod IS NULL OR v_mod NOT IN ('suspenda', 'verifica', 'reia') THEN RAISE EXCEPTION 'consumatori #908: mod invalid (%), doar suspenda / verifica / reia', v_mod; END IF;
  -- r4 (Copilot r3 P2): fiecare job verificat pe NUME, nu doar count = 2
  FOREACH v_j IN ARRAY ARRAY['ofertare_extragere_worker', 'ofertare_ingest_worker'] LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_j) THEN RAISE EXCEPTION 'consumatori #908: jobul pg_cron % nu exista', v_j; END IF;
  END LOOP;
  IF v_mod IN ('suspenda', 'reia') THEN
    PERFORM cron.alter_job(j.jobid, active := (v_mod = 'reia'))
       FROM cron.job j WHERE j.jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker');
    FOREACH v_j IN ARRAY ARRAY['ofertare_extragere_worker', 'ofertare_ingest_worker'] LOOP
      IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_j AND active = (v_mod = 'reia')) THEN
        RAISE EXCEPTION 'consumatori #908: % — jobul % nu e in starea ceruta', v_mod, v_j;
      END IF;
    END LOOP;
    RETURN;
  END IF;
  -- ===== verifica: bariera de drenare (doar citire) =====
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker') AND active) THEN
    RAISE EXCEPTION 'drenare #908: joburile pg_cron nu sunt suspendate (ruleaza intai mod=suspenda)';
  END IF;
  -- r5 (review r4 Jakarinos P2-02): reperul de timp e ULTIMUL deploy confirmat dintre cele 11 edge-uri (până la el, codul vechi putea
  -- accepta un apel din UI): -v deploy_la='<timestamp ISO al ultimului deploy terminat>' e obligatoriu, iar bariera cere >= 7 minute de atunci
  v_t := NULLIF(current_setting('gazpet.deploy_la_908', true), '')::timestamptz;
  IF v_t IS NULL THEN RAISE EXCEPTION 'drenare #908: lipseste -v deploy_la (momentul ultimului deploy confirmat dintre cele 11 edge-uri)'; END IF;
  IF v_t > now() - interval '7 minutes' THEN RAISE EXCEPTION 'drenare #908: ultimul deploy la % (< 7 min) — asteapta', v_t; END IF;
  SELECT max(d.start_time) INTO v_t FROM cron.job_run_details d JOIN cron.job j USING (jobid)
   WHERE j.jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker');
  IF v_t > now() - interval '7 minutes' THEN RAISE EXCEPTION 'drenare #908: ultimul tick pg_cron a pornit la % (< 7 min) — asteapta', v_t; END IF;
  -- r5 (review r4 Copilot P1-01): un start vechi nu dovedește că execuția s-a terminat — nicio rulare a celor 2 joburi fără sfârșit /
  -- „running”, și nicio sesiune Postgres care execută acum unul dintre tick-uri
  SELECT count(*) INTO v_n FROM cron.job_run_details d JOIN cron.job j USING (jobid)
   WHERE j.jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker') AND (d.end_time IS NULL OR d.status IN ('running', 'starting'));
  IF v_n > 0 THEN RAISE EXCEPTION 'drenare #908: % rulari pg_cron ale tick-urilor fara sfarsit (running / starting)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_stat_activity
   WHERE pid <> pg_backend_pid() AND state <> 'idle' AND query ~* 'ofertare_(extragere|ingest)_tick';
  IF v_n > 0 THEN RAISE EXCEPTION 'drenare #908: % sesiuni Postgres executa acum un tick al cozilor', v_n; END IF;
  SELECT max(ultimul) INTO v_t FROM public.worker_heartbeat WHERE nume = 'ofertare-worker';
  IF v_t > now() - interval '7 minutes' THEN RAISE EXCEPTION 'drenare #908: workerul NAS a dat semn de viata la % (< 7 min) — opreste-l si asteapta', v_t; END IF;
  SELECT count(*) INTO v_n FROM net.http_request_queue WHERE url ~ '/functions/v1/ofertare-(cerinte|ingest-doc)$';
  IF v_n > 0 THEN RAISE EXCEPTION 'drenare #908: % cereri pg_net IN ASTEPTARE spre edge-urile cozilor', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ofertare_extragere_coada c
   WHERE c.req_id IS NOT NULL AND c.lansat_la > now() - interval '7 minutes'
     AND NOT EXISTS (SELECT 1 FROM net._http_response r WHERE r.id = c.req_id);
  IF v_n > 0 THEN RAISE EXCEPTION 'drenare #908: % apeluri de extragere lansate de tick fara raspuns (< 7 min)', v_n; END IF;
  SELECT max(created_at) INTO v_t FROM public.ai_usage_log WHERE function_name LIKE 'ofertare-%';
  IF v_t > now() - interval '7 minutes' THEN RAISE EXCEPTION 'drenare #908: ultimul cost AI Ofertare inregistrat la % (< 7 min) — asteapta', v_t; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_acoperire_coada WHERE activ) OR EXISTS (SELECT 1 FROM public.ofertare_clarificari_coada WHERE activ)
     OR EXISTS (SELECT 1 FROM public.ofertare_extragere_coada WHERE activ) OR EXISTS (SELECT 1 FROM public.ofertare_ingest_coada WHERE activ) THEN
    RAISE EXCEPTION 'drenare #908: exista cereri ACTIVE in cozile AI — se inchid doar cu preview + da Razvan, apoi verifica din nou';
  END IF;
  RAISE NOTICE 'drenare #908: TRECUT la % — se poate aplica migrarea 20261124a', now();
END $c$;
COMMIT;
\echo '--- joburi'
SELECT jobid, jobname, active FROM cron.job WHERE jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker') ORDER BY jobname;
\echo '--- ultimele starturi pg_cron ale joburilor'
SELECT j.jobname, max(d.start_time) AS ultimul_start FROM cron.job j LEFT JOIN cron.job_run_details d USING (jobid)
 WHERE j.jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker') GROUP BY j.jobname ORDER BY j.jobname;
\echo '--- cereri active in cozi (pentru aplicarea 20261124a: 0)'
SELECT 'ingest' AS coada, count(*) FILTER (WHERE activ) AS active FROM public.ofertare_ingest_coada
UNION ALL SELECT 'acoperire', count(*) FILTER (WHERE activ) FROM public.ofertare_acoperire_coada
UNION ALL SELECT 'clarificari', count(*) FILTER (WHERE activ) FROM public.ofertare_clarificari_coada
UNION ALL SELECT 'extragere', count(*) FILTER (WHERE activ) FROM public.ofertare_extragere_coada;
\echo '--- cereri pg_net IN ASTEPTARE spre edge-urile cozilor (nu sunt „in zbor”: cele preluate nu mai apar aici)'
SELECT count(*) AS in_asteptare FROM net.http_request_queue WHERE url ~ '/functions/v1/ofertare-(cerinte|ingest-doc)$';
\echo '--- ultimul cost AI Ofertare (ai_usage_log) si heartbeat worker NAS'
SELECT (SELECT max(created_at) FROM public.ai_usage_log WHERE function_name LIKE 'ofertare-%') AS ultimul_cost_ai,
       (SELECT max(ultimul) FROM public.worker_heartbeat WHERE nume = 'ofertare-worker') AS ultimul_heartbeat, now() AS acum;
