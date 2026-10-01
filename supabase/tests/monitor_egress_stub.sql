-- Stub minimal Supabase pentru testul local al monitorului de egress (NU se aplică pe live).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, profile_id uuid NOT NULL, type text NOT NULL, title text NOT NULL, message text, link_to text,
  modul text CHECK (modul = ANY (ARRAY['general','Logistică','Pontaj','Execuție','Financiar','Comercial','Administrativ','HR','Tichete','Rapoarte','Ședințe','Ofertare','Clădire'])),
  read_at timestamptz, action_taken boolean, created_at timestamptz DEFAULT now());
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000121'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000121', 'TRUSU RAZVAN', true), ('00000000-0000-0000-0000-000000000002', 'ALT UTILIZATOR', false);
-- pg_cron minim (precondiția 0c cere schema cron) + setările implicite Supabase (anon/authenticated primesc tot pe obiecte noi)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
