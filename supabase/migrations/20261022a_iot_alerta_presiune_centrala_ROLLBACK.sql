-- ROLLBACK 20261022a: scoate verificarea de presiune din iot_cron_tick și funcția
CREATE OR REPLACE FUNCTION public.iot_cron_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s text; k text;
BEGIN
  BEGIN PERFORM public.iot_verifica_terra(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_terra: %', SQLERRM; END;
  BEGIN PERFORM public.iot_verifica_retea(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_retea: %', SQLERRM; END;
  IF NOT EXISTS (SELECT 1 FROM public.iot_integrari WHERE stare = 'conectat') THEN RETURN; END IF;
  BEGIN PERFORM public.iot_verifica_incalzire(); EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'IOT_CRON_SECRET' LIMIT 1;
  FOR k IN SELECT cheie FROM public.iot_integrari WHERE stare = 'conectat' AND cheie IN ('vicare','salus','tuya') LOOP
    PERFORM net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/' || k,
      headers := jsonb_build_object('Content-Type','application/json','x-iot-secret', s), body := '{"actiune":"sync"}'::jsonb, timeout_milliseconds := 90000);
  END LOOP;
END $function$;
DROP FUNCTION IF EXISTS public.iot_verifica_presiune();
