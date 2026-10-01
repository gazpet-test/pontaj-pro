-- Schelet minimal (DOAR PG local de test) pentru monitorul de egress: roluri Supabase, auth.uid(), profiles,
-- notifications cu CHECK pe modul (include 'general', ca pe live), stub pg_cron. Folosit de scripts/test_monitor_egress_fix.sh.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (
  id bigserial PRIMARY KEY, profile_id uuid, type text, title text, message text, link_to text,
  modul text CONSTRAINT notifications_modul_check CHECK (modul IN ('general','ofertare','hr','logistica')),
  created_at timestamptz DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $fn$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd) RETURNING jobid
$fn$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $fn$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true
$fn$;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000121'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000121', true), ('00000000-0000-0000-0000-000000000002', false);
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
