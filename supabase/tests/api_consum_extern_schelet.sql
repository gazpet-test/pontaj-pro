-- Schelet minim (NU se aplică pe producție) pentru scripts/test_api_consum_extern.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261014a de pe live (05.10.2026): fn_is_app_owner (md5 8d335ed3…, SECDEF, STABLE, EXECUTE
-- authenticated), INTERN_EDGE_SECRET în Vault (64 hex), privilegiile implicite Supabase pe schema public (ALL pentru
-- anon/authenticated/service_role — ca REVOKE-urile migrării să fie testate de-adevăratelea) + machete vault/net/cron/auth.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- privilegiile implicite de pe Supabase: orice tabel/view/secvență nouă din public e deschisă tuturor rolurilor API
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;

-- auth (machetă: auth.uid() din GUC-ul request.jwt.claim.sub)
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- vault (machetă: decrypted_secret = secret în clar)
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text DEFAULT '', secret text NOT NULL, key_id uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret, key_id, created_at, updated_at FROM vault.secrets;
INSERT INTO vault.secrets (name, secret) VALUES ('INTERN_EDGE_SECRET', repeat('a1', 32));

-- net (machetă: înregistrează apelurile)
CREATE SCHEMA net;
CREATE TABLE net._apeluri (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_ms int);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net._apeluri (url, body, headers, timeout_ms) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;

-- cron (machetă: schedule / unschedule pe nume)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text DEFAULT 'localhost', nodeport int DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT current_user, active boolean DEFAULT true, jobname text UNIQUE);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql
  AS $$ INSERT INTO cron.job (schedule, command, jobname) VALUES (schedule, command, job_name) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql
  AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;

-- profiles + verificarea de owner (exact ca pe live)
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false);
CREATE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
$function$;
REVOKE ALL ON FUNCTION public.fn_is_app_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO authenticated, service_role;
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Coleg', false);
