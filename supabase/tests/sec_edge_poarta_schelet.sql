-- Schelet minim (NU se aplică pe producție) pentru scripts/test_sec_edge_poarta.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261011a de pe live (03.10.2026): fn_verifica_secret (md5 dbd1439c…), cele 2 funcții trigger
-- (detect md5 f726b68f…, inbox md5 normalizat 4e1dd9f7… cu un JWT FALS în loc de cheia anon reală), jobul cron
-- (md5 0bd8aadf…) + machete minime pentru vault, net și cron (pe live sunt extensiile Supabase).
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;

-- vault (machetă: decrypted_secret = secret în clar)
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text DEFAULT '', secret text NOT NULL, key_id uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret, key_id, created_at, updated_at FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
  RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets (name, description, secret, key_id) VALUES (new_name, new_description, new_secret, new_key_id) RETURNING id $$;
INSERT INTO vault.secrets (name, secret) VALUES ('SUPABASE_ANON_JWT', 'eyJfals.cheie.anon');

-- net (machetă: înregistrează apelurile)
CREATE SCHEMA net;
CREATE TABLE net._apeluri (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net._apeluri (url, body, headers) VALUES (url, body, headers) RETURNING id $$;

-- cron (machetă)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text DEFAULT 'localhost', nodeport int DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT current_user, active boolean DEFAULT true, jobname text);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command),
    database = coalesce(alter_job.database, job.database), username = coalesce(alter_job.username, job.username), active = coalesce(alter_job.active, job.active)
    WHERE jobid = job_id $$;
INSERT INTO cron.job (jobid, schedule, command, username, jobname) VALUES (3, '0 7 * * *', '
  SELECT net.http_post(
    url := ''https://dxczwkbciseqniprspcu.supabase.co/functions/v1/cleanup-recycle-bin'',
    body := ''{}''::jsonb,
    headers := jsonb_build_object(''Content-Type'',''application/json'')
  );
  ', 'postgres', 'recycle_bin_cleanup_zilnic');

-- verificatorul de secret (exact ca pe live)
CREATE FUNCTION public.fn_verifica_secret(p_nume text, p_secret text) RETURNS boolean LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public', 'vault', 'pg_temp' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name IN (p_nume, p_nume || '_VECHI')
      AND length(coalesce(p_secret,'')) = length(s.decrypted_secret)
      AND p_secret = s.decrypted_secret
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_verifica_secret(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_verifica_secret(text,text) TO service_role;

-- tabelele + funcțiile trigger (exact ca pe live; inbox cu JWT fals)
CREATE TABLE public.documente_proiect (id bigserial PRIMARY KEY, nume_fisier text, subiect text);
CREATE TABLE public.ai_documente_inbox (id bigserial PRIMARY KEY, status text);
CREATE FUNCTION public.fn_detect_ordine_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF (COALESCE(NEW.nume_fisier,'') || ' ' || COALESCE(NEW.subiect,'')) ~* 'ordin[^a-z]*(de)?[^a-z]*(incep|re[- ]?incep|sistar|reluar)' THEN
    PERFORM net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/detect-ordine',
      body := jsonb_build_object('doc_id', NEW.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 55000
    );
  END IF;
  RETURN NEW;
END $function$;
CREATE FUNCTION public.fn_ai_inbox_trigger_clasificare() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'net', 'pg_temp' AS $function$
BEGIN
  IF NEW.status = 'in_asteptare' THEN
    PERFORM net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/citeste-orice',
      body := jsonb_build_object('inbox_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJfals.cheie.anon',
        'apikey', 'eyJfals.cheie.anon'
      ),
      timeout_milliseconds := 55000
    );
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_detect_ordine_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_ai_inbox_trigger_clasificare() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_ordine_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ai_inbox_trigger_clasificare() TO service_role;
CREATE TRIGGER trg_detect_ordine AFTER INSERT ON public.documente_proiect FOR EACH ROW EXECUTE FUNCTION public.fn_detect_ordine_trigger();
CREATE TRIGGER trg_ai_inbox_clasificare AFTER INSERT ON public.ai_documente_inbox FOR EACH ROW EXECUTE FUNCTION public.fn_ai_inbox_trigger_clasificare();
