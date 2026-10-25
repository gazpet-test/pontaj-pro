-- NEEXECUTAT. Exportati jurnalul si configuratia inainte de revenire.
DO $lumini_revenire_20261113a$
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.revenire_20261113a',true) IS DISTINCT FROM 'IOT_LUMINI_SCOATE:' || txid_current() THEN RAISE EXCEPTION '20261113a: garda start invalida'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Necesita READ COMMITTED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  -- Nu stergem date operative. Revenire distructiva refuzata daca au existat comenzi/programe.
  IF EXISTS(SELECT 1 FROM public.iot_lumini_jurnal) OR EXISTS(SELECT 1 FROM public.iot_program_lumini) THEN RAISE EXCEPTION 'Export si plan separat pentru date operative necesare'; END IF;
  -- Intentiile pre-POST sunt urme operative chiar daca jurnalul nu a fost scris.
  IF EXISTS(SELECT 1 FROM public.iot_lumini_setari WHERE id=true AND runtime->'programe' IS NOT NULL AND runtime->'programe'<>'{}'::jsonb) THEN RAISE EXCEPTION 'Export runtime/intentie necesar'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='iot_lumini_tick_5min';
END $lumini_revenire_20261113a$;
DROP FUNCTION public.iot_lumini_cron_tick();
DROP FUNCTION public.iot_lumini_runtime(text,text,jsonb);
DROP FUNCTION public.iot_lumini_salveaza(text,jsonb);
DROP FUNCTION public.iot_lumini_drept(boolean);
DROP TABLE public.iot_lumini_jurnal;
DROP TABLE public.iot_program_lumini;
DROP TABLE public.iot_lumini_setari;
DROP TABLE public.iot_lumini;
