-- Bootstrap LOCAL pentru 20261130l (rulat ca SUPERUSER-ul clusterului de unica folosinta, supabase_admin — ca pe Supabase).
-- r8: pe Supabase `postgres` NU e superuser. Aici `postgres` e creat NOSUPERUSER NOBYPASSRLS (CREATEROLE, CREATEDB), membru al rolurilor
-- aplicatiei, owner al bazei si al schemei public; scheletul (20261130l_..._schelet.sql), migrarea, mutantii si revenirea ruleaza ca `postgres`,
-- deci orice operatie care pe Supabase cere superuser (ex. clauza SET pe un GUC placeholder la CREATE FUNCTION) pica si local.
-- Tot aici: rolurile Supabase si schema auth cu auth.uid / jwt / role exact ca pe live (owner supabase_auth_admin).
-- NU se ruleaza pe productie.
DO $b$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'bootstrap: trebuie superuser (supabase_admin)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE CREATEDB; END IF;
END $b$;
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$f$;
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$
;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
REVOKE ALL ON FUNCTION auth.uid(), auth.jwt(), auth.role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO PUBLIC, supabase_auth_admin, dashboard_user;
GRANT EXECUTE ON FUNCTION auth.jwt() TO postgres;
GRANT anon, authenticated, service_role TO postgres;
GRANT USAGE ON SCHEMA auth TO postgres;
ALTER DATABASE postgres OWNER TO postgres;
ALTER SCHEMA public OWNER TO postgres;
DO $b$ BEGIN
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'postgres') THEN RAISE EXCEPTION 'bootstrap: postgres trebuie NOSUPERUSER NOBYPASSRLS'; END IF;
END $b$;
