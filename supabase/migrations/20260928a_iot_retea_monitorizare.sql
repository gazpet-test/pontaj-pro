-- Monitorizare rețea & servere (QNAP, MikroTik, D-Link, servere) în modulul Clădire.
-- Dispozitivele sursa='retea' există deja în iot_dispozitive; aici doar funcția de verificare + cron.
BEGIN;

CREATE OR REPLACE FUNCTION public.iot_verifica_retea()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d record;
  online boolean;
  asteptat boolean;
  tacut boolean;
  valoare numeric;
  prag record;
  nivel text;
  limita numeric;
  n int := 0;
BEGIN
  FOR d IN
    SELECT extern_id, nume, meta, ultima_citire, citit_la
    FROM public.iot_dispozitive
    WHERE sursa = 'retea' AND activ = true
  LOOP
    -- Placeholderele offline (asteptat_online=false) nu generează alerte cât sunt offline (așteptat).
    asteptat := COALESCE((d.meta->>'asteptat_online')::boolean, true);
    online := (d.ultima_citire->>'online') IS NOT DISTINCT FROM 'true';
    tacut := d.citit_la IS NULL OR d.citit_la < now() - interval '20 minutes';

    IF asteptat THEN
      IF (NOT online) OR tacut THEN
        -- Routerul principal (gateway) căzut = eroare (posibil rețea întreagă jos); restul = warning.
        IF d.extern_id = '192.168.1.1' THEN
          PERFORM public.iot_alerta(
            p_type => 'error',
            p_title => format('Rețea: %s nu răspunde (gateway)', d.nume),
            p_message => format('Routerul principal nu răspunde — posibil rețea căzută. Ultima citire: %s.',
              COALESCE(d.citit_la::text, 'niciodată')));
        ELSE
          PERFORM public.iot_alerta(
            p_type => 'warning',
            p_title => format('Rețea: %s nu răspunde', d.nume),
            p_message => format('Dispozitiv offline sau tăcut. Ultima citire: %s.',
              COALESCE(d.citit_la::text, 'niciodată')));
        END IF;
        n := n + 1;
        CONTINUE; -- Dacă e offline, nu mai are sens să verificăm temperaturi.
      END IF;
    ELSE
      CONTINUE; -- placeholder offline: nimic
    END IF;

    -- Temperaturi (QNAP): doar dacă citirea le conține.
    FOR prag IN SELECT * FROM (VALUES
      ('cpu_temp', 'CPU', 70, 85),
      ('hdd_max', 'discuri', 50, 60)
    ) AS p(cheie, eticheta, warning, critical)
    LOOP
      IF jsonb_typeof(d.ultima_citire -> prag.cheie) IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
      valoare := (d.ultima_citire ->> prag.cheie)::numeric;
      IF valoare > prag.critical THEN nivel := 'error'; limita := prag.critical;
      ELSIF valoare > prag.warning THEN nivel := 'warning'; limita := prag.warning;
      ELSE CONTINUE; END IF;
      PERFORM public.iot_alerta(
        p_type => nivel,
        p_title => format('%s: %s > %s °C', d.nume, prag.eticheta, limita),
        p_message => format('Valoare: %s °C. Ora citirii: %s.', valoare, d.citit_la));
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.iot_verifica_retea() FROM PUBLIC, anon, authenticated;

-- iot_cron_tick: adaug verificarea rețelei lângă Terra, ÎNAINTE de ieșirea „nicio integrare conectată"
-- (rețeaua nu e integrare cloud). Fail-isolated. Restul corpului NESCHIMBAT.
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
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'IOT_CRON_SECRET' LIMIT 1;
  FOR k IN SELECT cheie FROM public.iot_integrari WHERE stare = 'conectat' AND cheie IN ('vicare','salus','tuya') LOOP
    PERFORM net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/' || k,
      headers := jsonb_build_object('Content-Type','application/json','x-iot-secret', s), body := '{"actiune":"sync"}'::jsonb, timeout_milliseconds := 90000);
  END LOOP;
END $function$;

COMMIT;
