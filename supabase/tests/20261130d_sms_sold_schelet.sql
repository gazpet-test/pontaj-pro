-- Schelet LOCAL suplimentar pentru 20261130d_sms_sold (PG17 de unica folosinta). Se ruleaza DUPA scheletele 20261130a / 20261130b si
-- dupa aplicarea migrarilor 20261130a + 20261130b. Reproduce ce atinge 20261130d in plus: extensiile platformei (doar forma folosita):
--   * cron.job + cron.schedule(text, text, text) / cron.unschedule(text) (ca pg_cron: jobul e al utilizatorului curent);
--   * net.http_post(url, body, params, headers, timeout_milliseconds) — NU face nicio cerere (intoarce 0);
--   * vault.decrypted_secrets cu INTERN_EDGE_SECRET fictiv (64 hex);
--   * cron.timezone = GMT pe baza de date (ca in productie, verificat 05.10 la 20261014a).
-- Limita: local postgres e superuser (pe productie nu e): migrarea si revenirea nu scriu / blocheaza cron.job direct, doar prin functii.
-- NU se ruleaza pe productie.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT current_database(), username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true, jobname text UNIQUE
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid
$f$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name AND username = current_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name; END IF;
  RETURN true;
END $f$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
                              timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets_schelet (name text PRIMARY KEY, decrypted_secret text NOT NULL);
CREATE VIEW vault.decrypted_secrets AS SELECT name, decrypted_secret FROM vault.secrets_schelet;
INSERT INTO vault.secrets_schelet VALUES ('INTERN_EDGE_SECRET', repeat('0123456789abcdef', 4));
REVOKE ALL ON SCHEMA cron, net, vault FROM PUBLIC;
DO $d$ BEGIN EXECUTE format('ALTER DATABASE %I SET cron.timezone = %L', current_database(), 'GMT'); END $d$;
