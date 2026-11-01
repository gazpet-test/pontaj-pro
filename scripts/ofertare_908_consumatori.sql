-- Consumatorii cozilor AI Ofertare pe durata livrării / revenirii PR #908 (20261124a, r3; review r2 Jakarinos P1-04 / Copilot P1-02).
-- Workerul NAS se oprește separat (docker stop gazpet-ofertare-worker pe Terra); aici: rezerva din BD — joburile pg_cron
-- ofertare_extragere_worker (ofertare_extragere_tick) și ofertare_ingest_worker (ofertare_ingest_tick), care preiau cozile când
-- heartbeat-ul workerului e mai vechi de 10 minute. NU atinge datele din cozi.
-- Rulare (psql, armat pe tranzacție):  psql ... -v mod=suspenda -f scripts/ofertare_908_consumatori.sql   (sau mod=reia)
--   „suspenda”: joburile active → inactive, apoi raportul: joburi, cereri active în cozi, apeluri pg_net în zbor spre ofertare-cerinte /
--               ofertare-ingest-doc. Se continuă livrarea DOAR când raportul arată 0 cereri active și 0 apeluri în zbor (așteaptă ~3 min:
--               timeout-ul apelurilor e 150 s).
--   „reia”:     joburile inactive → active (după deploy + migrare + workerul nou), apoi același raport.
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('gazpet.consumatori_908', :'mod', true) IS NOT NULL AS marcaj;
DO $c$
DECLARE v_mod text := current_setting('gazpet.consumatori_908', true); v_n int;
BEGIN
  IF v_mod IS NULL OR v_mod NOT IN ('suspenda', 'reia') THEN RAISE EXCEPTION 'consumatori #908: mod invalid (%), doar suspenda / reia', v_mod; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker')) <> 2 THEN
    RAISE EXCEPTION 'consumatori #908: joburile pg_cron asteptate nu exista (ofertare_extragere_worker, ofertare_ingest_worker)';
  END IF;
  PERFORM cron.alter_job(j.jobid, active := (v_mod = 'reia'))
     FROM cron.job j WHERE j.jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker');
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker') AND active = (v_mod = 'reia');
  IF v_n <> 2 THEN RAISE EXCEPTION 'consumatori #908: % — doar % din 2 joburi in starea ceruta', v_mod, v_n; END IF;
END $c$;
COMMIT;
\echo '--- joburi'
SELECT jobid, jobname, active FROM cron.job WHERE jobname IN ('ofertare_extragere_worker', 'ofertare_ingest_worker') ORDER BY jobname;
\echo '--- cereri active in cozi (pentru aplicarea 20261124a: 0)'
SELECT 'ingest' AS coada, count(*) FILTER (WHERE activ) AS active FROM public.ofertare_ingest_coada
UNION ALL SELECT 'acoperire', count(*) FILTER (WHERE activ) FROM public.ofertare_acoperire_coada
UNION ALL SELECT 'clarificari', count(*) FILTER (WHERE activ) FROM public.ofertare_clarificari_coada
UNION ALL SELECT 'extragere', count(*) FILTER (WHERE activ) FROM public.ofertare_extragere_coada;
\echo '--- apeluri pg_net in zbor spre edge-urile cozilor (0 inainte de livrare)'
SELECT count(*) AS in_zbor FROM net.http_request_queue WHERE url ~ '/functions/v1/ofertare-(cerinte|ingest-doc)$';
\echo '--- heartbeat worker NAS (oprit = mai vechi de cateva minute)'
SELECT nume, ultimul, now() - ultimul AS vechime FROM public.worker_heartbeat WHERE nume = 'ofertare-worker';
