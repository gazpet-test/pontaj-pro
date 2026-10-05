-- Schelet minim (NU se aplică pe producție) pentru scripts/test_sec_f2_setari.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261015a de pe live (05.10.2026): politicile exacte pe logistica_setari / necesar_setari /
-- mai_gov_redirect_log, joburile 17/18/30 cu comanda live MASCATĂ (JWT și secretul înlocuite cu valori de test — md5-ul
-- normalizat e același ca pe live), Vault (INTERN_EDGE_SECRET 64 hex, SUPABASE_ANON_JWT = JWT-ul din comenzi).
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
-- ca pe Supabase: orice funcție nouă din public primește EXECUTE pentru anon/authenticated/service_role (de aceea migrarea revocă explicit)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text NOT NULL);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
INSERT INTO vault.secrets (name, secret) VALUES ('INTERN_EDGE_SECRET', repeat('a1', 32)), ('SUPABASE_ANON_JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-semnatura');

CREATE SCHEMA net;
CREATE TABLE net._apeluri (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_ms int);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net._apeluri (url, body, headers, timeout_ms) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, username text DEFAULT current_user, active boolean DEFAULT true, jobname text UNIQUE);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET schedule = coalesce(alter_job.schedule, cron.job.schedule), command = coalesce(alter_job.command, cron.job.command),
    active = coalesce(alter_job.active, cron.job.active) WHERE jobid = job_id $$;
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (17, '*/5 * * * *', replace(replace($cron_masca$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/rag-utilaj',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <JWT>',
      'x-internal-secret','<S>'
    ),
    body := '{"action":"process_queue"}'::jsonb,
    timeout_milliseconds := 150000
  )$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'secret-vechi-de-test'), 'rag_utilaj_process_queue');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (18, '2-59/5 * * * *', replace(replace($cron_masca$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/rag-utilaj-embed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <JWT>',
      'x-internal-secret','<S>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'secret-vechi-de-test'), 'rag_utilaj_process_pending');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (30, '* * * * *', replace(replace($cron_masca$SELECT net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/redirect-mai-gov?polls=8',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer <JWT>',
        'x-ingest-secret','<S>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 80000
    );$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'secret-vechi-de-test'), 'redirect-mai-gov');

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid, module text, access_level text);
CREATE TABLE public.logistica_setari (key text PRIMARY KEY, value text, updated_at timestamptz, updated_by uuid);
CREATE TABLE public.necesar_setari (cheie text PRIMARY KEY, valoare text, descriere text, updated_at timestamptz, updated_by uuid);
CREATE TABLE public.rag_qr_log (id bigserial PRIMARY KEY, active_id integer NOT NULL, question text NOT NULL, answered boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now());
ALTER TABLE public.rag_qr_log ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.mai_gov_redirect_log (id bigserial PRIMARY KEY, gmail_msg_id text UNIQUE NOT NULL, tip text, cod text, status text DEFAULT 'in_lucru' NOT NULL);
ALTER TABLE public.logistica_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.necesar_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mai_gov_redirect_log ENABLE ROW LEVEL SECURITY;
-- politicile exact ca pe live (05.10.2026)
CREATE POLICY logistica_setari_select_authenticated ON public.logistica_setari FOR SELECT TO authenticated USING (true);
CREATE POLICY logistica_setari_insert_authenticated ON public.logistica_setari FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY logistica_setari_update_authenticated ON public.logistica_setari FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY logistica_setari_delete_authenticated ON public.logistica_setari FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY necesar_setari_select ON public.necesar_setari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY necesar_setari_write ON public.necesar_setari FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY mai_gov_redirect_log_select ON public.mai_gov_redirect_log FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
-- user_module_access și profiles: SELECT pentru orice cont logat, ca pe live
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_all_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY user_module_access_select_authenticated ON public.user_module_access FOR SELECT TO authenticated USING (true);

INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Coleg fără modul', false),
  ('00000000-0000-0000-0000-0000000000c3', 'Logistică editor', false),
  ('00000000-0000-0000-0000-0000000000d4', 'Logistică admin', false),
  ('00000000-0000-0000-0000-0000000000e5', 'Administrativ UPA editor', false),
  ('00000000-0000-0000-0000-0000000000f6', 'Logistică viewer', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-0000000000c3', 'logistica', 'editor'),
  ('00000000-0000-0000-0000-0000000000d4', 'logistica', 'admin'),
  ('00000000-0000-0000-0000-0000000000e5', 'administrativ.upa', 'editor'),
  ('00000000-0000-0000-0000-0000000000f6', 'logistica', 'viewer');
INSERT INTO public.logistica_setari (key, value) VALUES
  ('pret_motorina_ron', '7.50'), ('pret_motorina_actualizat', '2026-07-29'), ('aviz_email_destinatari', 'a@gazpet.ro'),
  ('upa_plafon_lunar', '1000'), ('upa_alerta_emails', 'b@gazpet.ro'), ('firma_nume', 'GAZPET'), ('probleme_reminder_emails', 'c@gazpet.ro');
INSERT INTO public.necesar_setari (cheie, valoare) VALUES ('aprobare_activa', 'false'), ('email_achizitor', 'x@gazpet.ro');
INSERT INTO public.mai_gov_redirect_log (gmail_msg_id, tip, cod, status) VALUES ('m1', 'cod', '123456', 'trimis');
