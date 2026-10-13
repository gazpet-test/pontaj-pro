-- REVENIRE 20261028c — NU reînvie secretul vechi (e public, compromis). Fail-safe: DEZACTIVEAZĂ cele 7 joburi
-- (scorilos_patrol_0200…0315, chuck_norris_hr_zilnic_0700), șterge fn_bot_secret_ok și secretul BOT_SECRET din Vault.
-- Efect: boții nu mai rulează deloc până la o decizie nouă (edge-urile noi refuză orice apel fără funcție).
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261028c', 'BOT_SECRET_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE r record;
BEGIN
  IF current_setting('gazpet.revenire_20261028c', true)
       IS DISTINCT FROM 'BOT_SECRET_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261028c=%') THEN
    RAISE EXCEPTION '20261028c: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028c: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_bot_secret_ok(text)') IS NULL THEN RAISE EXCEPTION '20261028c: preconditie, functia lipseste'; END IF;
  FOR r IN SELECT jobid FROM cron.job WHERE jobid IN (6,7,8,9,10,11,12) LOOP
    PERFORM cron.alter_job(job_id := r.jobid, active := false);
  END LOOP;
  DROP FUNCTION public.fn_bot_secret_ok(text);
  DELETE FROM vault.secrets WHERE name = 'BOT_SECRET';
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobid IN (6,7,8,9,10,11,12) AND active) OR EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'BOT_SECRET') THEN
    RAISE EXCEPTION '20261028c: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261028c', true)
       IS DISTINCT FROM 'BOT_SECRET_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028c: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261028c', '', true);
END $revenire$;
