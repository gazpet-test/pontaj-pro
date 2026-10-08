-- 20261022a: alertă presiune scăzută la centrala Viessmann (cerere Răzvan 08.10.2026: „la 1 bar să dea mesaj, avem o mică pierdere")
-- Funcție nouă iot_verifica_presiune() + apel în iot_cron_tick (la fiecare 10 min). Dedup 12 h prin iot_alerta (titlu fix).
CREATE OR REPLACE FUNCTION public.iot_verifica_presiune()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d record; p numeric;
BEGIN
  SELECT ultima_citire, citit_la, nume INTO d FROM public.iot_dispozitive
  WHERE sursa = 'vicare' AND activ = true AND jsonb_typeof(ultima_citire -> 'presiune_bar') = 'number'
  ORDER BY citit_la DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF d.citit_la < now() - interval '2 hours' THEN RETURN 0; END IF;  -- citire veche: nu alertăm pe date expirate
  p := (d.ultima_citire ->> 'presiune_bar')::numeric;
  IF p < 0.8 THEN
    RETURN public.iot_alerta('error', '💧 Presiune CRITICĂ la centrală (sub 0,8 bar)',
      format('Presiunea în instalație este %s bar (citire %s). Completează apa la centrală înainte să se blocheze.', p, to_char(d.citit_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI')));
  ELSIF p <= 1.0 THEN
    RETURN public.iot_alerta('warning', '💧 Presiunea la centrală a scăzut la 1 bar',
      format('Presiunea în instalație este %s bar (citire %s). Instalația are o mică pierdere — completează apa până la 1,5 bar.', p, to_char(d.citit_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM HH24:MI')));
  END IF;
  RETURN 0;
END $function$;
REVOKE EXECUTE ON FUNCTION public.iot_verifica_presiune() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iot_verifica_presiune() TO service_role;

CREATE OR REPLACE FUNCTION public.iot_cron_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s text; k text;
BEGIN
  BEGIN PERFORM public.iot_verifica_terra(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_terra: %', SQLERRM; END;
  BEGIN PERFORM public.iot_verifica_retea(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_retea: %', SQLERRM; END;
  IF NOT EXISTS (SELECT 1 FROM public.iot_integrari WHERE stare = 'conectat') THEN RETURN; END IF;
  BEGIN PERFORM public.iot_verifica_incalzire(); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.iot_verifica_presiune(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_presiune: %', SQLERRM; END;
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'IOT_CRON_SECRET' LIMIT 1;
  FOR k IN SELECT cheie FROM public.iot_integrari WHERE stare = 'conectat' AND cheie IN ('vicare','salus','tuya') LOOP
    PERFORM net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/' || k,
      headers := jsonb_build_object('Content-Type','application/json','x-iot-secret', s), body := '{"actiune":"sync"}'::jsonb, timeout_milliseconds := 90000);
  END LOOP;
END $function$;
