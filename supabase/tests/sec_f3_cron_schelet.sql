-- Schelet minim (NU se aplică pe producție) pentru scripts/test_sec_f3_cron.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261016a de pe live (06.10.2026): cele 6 joburi de mail programat cu comanda live MASCATĂ (JWT și
-- INGEST_SECRET înlocuite cu valori de test — md5-ul normalizat e același ca pe live), Vault (INTERN_EDGE_SECRET 64 hex,
-- SUPABASE_ANON_JWT = JWT-ul din comenzi), net.http_post care doar notează apelul, cron.alter_job.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

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
-- un job străin, care nu trebuie atins
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (99, '0 1 * * *', 'SELECT 1', 'alt-job');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (21, '0 16 * * 1-6', replace(replace($cron_masca$
  SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/reminder-rapoarte',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <JWT>',
      'x-ingest-secret','<S>'
    ),
    body := '{}'::jsonb
  );
  $cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'ingest-vechi-de-test'), 'reminder-rapoarte-zilnice');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (25, '0 6 * * 1', replace(replace($cron_masca$SELECT net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/necesar-notificari?actiune=deschidere', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <JWT>','x-ingest-secret','<S>'), body := '{}'::jsonb);$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'ingest-vechi-de-test'), 'necesar-deschidere');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (26, '0 3 * * 4', replace(replace($cron_masca$SELECT net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/necesar-notificari?actiune=reminder', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <JWT>','x-ingest-secret','<S>'), body := '{}'::jsonb);$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'ingest-vechi-de-test'), 'necesar-reminder');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (27, '0 9 * * 4', replace(replace($cron_masca$SELECT net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/necesar-notificari?actiune=inchidere', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <JWT>','x-ingest-secret','<S>'), body := '{}'::jsonb);$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'ingest-vechi-de-test'), 'necesar-inchidere');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (28, '0 16 * * 1-6', replace(replace($cron_masca$SELECT net.http_post(
  url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/probleme-parc-reminder',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <JWT>','x-ingest-secret','<S>'),
  body := '{}'::jsonb);$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'ingest-vechi-de-test'), 'probleme-parc-reminder');
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES (29, '0 6 25 * *', replace(replace($cron_masca$SELECT net.http_post(
  url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/upa-plafon-alerta',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <JWT>','x-ingest-secret','<S>'),
  body := '{}'::jsonb);$cron_masca$, '<JWT>', (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')), '<S>', 'ingest-vechi-de-test'), 'upa-plafon-alerta');
