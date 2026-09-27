-- Pregătită local; aplicare exclusiv de Claude după completarea TODO-CLAUDE.
BEGIN;

INSERT INTO public.iot_dispozitive (sursa, extern_id, nume, site_id, meta, activ, privat)
VALUES ('terra', 'terra', 'Server Terra', 1, '{"tip":"server","model":"TerraMaster"}'::jsonb, true, false)
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

-- TODO-CLAUDE: corpul actual iot_cron_tick / iot_verifica_incalzire nu există în repository.
-- Copiază aici CREATE OR REPLACE FUNCTION public.iot_cron_tick() cu corpul real exact,
-- adăugând DOAR următoarea instrucțiune lângă iot_verifica_incalzire,
-- ÎNAINTE de testul iot_integrari ... conectat:
-- BEGIN PERFORM public.iot_verifica_terra(); EXCEPTION WHEN OTHERS THEN NULL; END;
-- Confirmă și semnătura SQL iot_alerta (p_type, p_title, p_message), dedusă din vicare/index.ts,
-- și că sursa='terra' este permisă de schema existentă. Nu modificăm alte funcții IoT.

COMMIT;
