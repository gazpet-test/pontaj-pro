-- Rollback pentru 20260930e_monitor_egress.sql (jurnalul se pierde — exportă-l înainte dacă e nevoie).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('egress_detector_5min', 'egress_jurnal_purge');
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.egress_statistici(int);
DROP FUNCTION IF EXISTS public.egress_deblocheaza(text, text);
DROP FUNCTION IF EXISTS public.egress_detector();
DROP FUNCTION IF EXISTS public.egress_ciclu_start(timestamptz);
DROP FUNCTION IF EXISTS public.egress_log_descarcare(text, text, bigint, text, bigint);
DROP FUNCTION IF EXISTS public.egress_obiect_blocat(text, text);
DROP FUNCTION IF EXISTS public.egress_notifica_owner(text, text);
DROP TABLE IF EXISTS public.storage_egress_alerte, public.storage_obiecte_blocate, public.storage_descarcari_jurnal, public.storage_egress_config;
DROP FUNCTION IF EXISTS public.egress_este_owner();
COMMIT;
