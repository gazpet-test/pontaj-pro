-- Pregătită local; aplicare exclusiv de Claude după completarea TODO-CLAUDE.
BEGIN;

-- citit_la = now() la inserare: grație de 30 min pentru instalarea scriptului pe Terra,
-- ca să nu declanșeze alerta „Terra tăcut" înainte de prima citire reală.
INSERT INTO public.iot_dispozitive (sursa, extern_id, nume, site_id, meta, activ, privat, citit_la)
VALUES ('terra', 'terra', 'Server Terra', 1, '{"tip":"server","model":"TerraMaster"}'::jsonb, true, false, now())
ON CONFLICT (sursa, extern_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.iot_verifica_terra()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  d record;
  prag record;
  valoare numeric;
  nivel text;
  limita numeric;
  n int := 0;
  prezente int := 0;
BEGIN
  SELECT ultima_citire, citit_la INTO d
  FROM public.iot_dispozitive
  WHERE sursa = 'terra' AND extern_id = 'terra' AND activ = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF d.citit_la IS NULL OR d.citit_la < now() - interval '30 minutes' THEN
    PERFORM public.iot_alerta(
      p_type => 'error',
      p_title => 'Terra nu mai trimite date (server căzut / rețea)',
      p_message => 'Prag: peste 30 min fără date. Ultima citire: ' || COALESCE(d.citit_la::text, 'niciodată')
        || '. Verificat la: ' || now()::text);
    RETURN 1; -- Nu repetăm alertele de temperatură pe o citire veche.
  END IF;

  FOR prag IN SELECT * FROM (VALUES
    ('disc_max', 'discuri', 45, 50),
    ('nvme_max', 'NVMe', 65, 70),
    ('cpu', 'CPU', 80, 90),
    ('ambient', 'ambient', 35, 40)
  ) AS p(cheie, eticheta, warning, critical)
  LOOP
    IF jsonb_typeof(d.ultima_citire -> prag.cheie) IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
    valoare := (d.ultima_citire ->> prag.cheie)::numeric;
    prezente := prezente + 1;
    IF valoare > prag.critical THEN
      nivel := 'error'; limita := prag.critical;
    ELSIF valoare > prag.warning THEN
      nivel := 'warning'; limita := prag.warning;
    ELSE CONTINUE;
    END IF;
    -- Titlu stabil per prag: deduplicare 12 h, dar criticul trece după warning.
    PERFORM public.iot_alerta(
      p_type => nivel,
      p_title => format('Terra: %s > %s °C', prag.eticheta, limita),
      p_message => format('Valoare: %s °C. Ora citirii: %s.', valoare, d.citit_la));
    n := n + 1;
  END LOOP;
  IF prezente = 0 THEN
    PERFORM public.iot_alerta(p_type => 'warning', p_title => 'Terra: citire goală',
      p_message => format('Valori temperatură: toate lipsesc. Ora citirii: %s.', d.citit_la));
    n := n + 1;
  END IF;
  RETURN n; -- Număr de condiții raportate; iot_alerta decide deduplicarea.
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.iot_verifica_terra() FROM PUBLIC, anon, authenticated;

-- iot_cron_tick: corpul real (preluat din producție), cu verificarea Terra adăugată ÎNAINTE
-- de ieșirea devreme „nicio integrare conectată" — altfel alerta „Terra tăcut" nu ar rula când
-- centrala/termostatele nu sunt conectate. Terra nu e o integrare cloud, deci nu depinde de iot_integrari.
-- Restul corpului e NESCHIMBAT. iot_alerta are semnătura (p_type, p_title, p_message, p_link DEFAULT '/cladire').
CREATE OR REPLACE FUNCTION public.iot_cron_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s text; k text;
BEGIN
  -- Terra (server local, nu integrare cloud): rulează mereu, independent de iot_integrari.
  -- Fail-isolated: o eroare în verificarea Terra NU oprește restul cronului (SALUS/Tuya/încălzire).
  BEGIN PERFORM public.iot_verifica_terra(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_terra: %', SQLERRM; END;
  IF NOT EXISTS (SELECT 1 FROM public.iot_integrari WHERE stare = 'conectat') THEN RETURN; END IF;
  BEGIN PERFORM public.iot_verifica_incalzire(); EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'IOT_CRON_SECRET' LIMIT 1;
  FOR k IN SELECT cheie FROM public.iot_integrari WHERE stare = 'conectat' AND cheie IN ('vicare','salus','tuya') LOOP
    PERFORM net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/' || k,
      headers := jsonb_build_object('Content-Type','application/json','x-iot-secret', s), body := '{"actiune":"sync"}'::jsonb, timeout_milliseconds := 90000);
  END LOOP;
END $function$;

COMMIT;
