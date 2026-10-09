-- Schelet harness 20261023c (iot_verifica_retea + praguri GPU/disc). Corpul funcției = verbatim live 09.10.2026 (md5 c756363a…).
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $r$;
CREATE TABLE public.iot_dispozitive (id bigserial PRIMARY KEY, sursa text, extern_id text, nume text, meta jsonb DEFAULT '{}', ultima_citire jsonb, citit_la timestamptz, activ boolean DEFAULT true);
CREATE TABLE public.alerte_test (tip text, titlu text, mesaj text);
CREATE FUNCTION public.iot_alerta(p_type text, p_title text, p_message text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.alerte_test VALUES (p_type, p_title, p_message) $$;
CREATE OR REPLACE FUNCTION public.iot_verifica_retea()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    asteptat := COALESCE((d.meta->>'asteptat_online')::boolean, true);
    online := (d.ultima_citire->>'online') IS NOT DISTINCT FROM 'true';
    tacut := d.citit_la IS NULL OR d.citit_la < now() - interval '20 minutes';

    IF asteptat THEN
      IF (NOT online) OR tacut THEN
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
        CONTINUE;
      END IF;
    ELSE
      CONTINUE;
    END IF;

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
REVOKE ALL ON FUNCTION public.iot_verifica_retea() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iot_verifica_retea() TO service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, nodename text DEFAULT 'localhost', nodeport integer DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT CURRENT_USER, active boolean DEFAULT true, jobname text);
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
INSERT INTO public.iot_dispozitive (sursa, extern_id, nume, ultima_citire, citit_la) VALUES
  ('retea', '192.168.1.94', 'Server AI', '{"online": true, "cpu_load": 8, "gpu_temp": 85, "gpu_w": 250, "gpu_util": 99, "vram_pct": 90, "disk_pct": 95}', now()),
  ('retea', '192.168.1.42', 'QNAP', '{"online": true, "cpu_temp": 90, "hdd_max": 55, "disk_pct": 72}', now()),
  ('retea', '192.168.1.95', 'Server rece', '{"online": true, "gpu_temp": 60, "disk_pct": 50}', now()),
  ('retea', '192.168.1.96', 'Server text', '{"online": true, "gpu_temp": "99"}', now());
