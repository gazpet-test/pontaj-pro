-- Schelet minim (NU se aplică pe producție) pentru scripts/test_admin_automatizari.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261010a de pe live (03.10.2026): fn_is_app_owner(uuid) md5 8d335ed3…, fn_comercial_touch_updated_at()
-- md5 5bdc21b8…, default privileges postgres pe public (anon/authenticated = arwdxt). auth.uid() = claim-ul request.jwt.claim.sub.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false);
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000001', 'owner', true),
                                   ('00000000-0000-0000-0000-000000000002', 'coleg', false);

CREATE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
$function$;
REVOKE ALL ON FUNCTION public.fn_is_app_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO authenticated, service_role;

CREATE FUNCTION public.fn_comercial_touch_updated_at() RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_comercial_touch_updated_at() FROM PUBLIC;
