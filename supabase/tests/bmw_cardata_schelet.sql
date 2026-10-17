-- Schelet minim (NU se aplică pe producție) pentru scripts/test_bmw_cardata.sh — doar într-o bază locală *_test.
-- Reproduce ce folosește 20261030c de pe live (14.10.2026, citit read-only din information_schema): roluri Supabase,
-- default privileges postgres pe public (tot pentru anon/authenticated/service_role), auth.uid() din request.jwt.claims,
-- profiles(id uuid, is_owner boolean), user_module_access(profile_id uuid, module text, access_level text),
-- logistica_active(id integer, serie_sasiu text, nr_inmatriculare text, …), logistica_telemetrie_zilnica(asset_id integer,
-- data date, total_km_zi numeric, km_sfarsit_zi numeric, sursa text, …). Date FICTIVE.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text, is_owner boolean DEFAULT false);
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner', true),
  ('00000000-0000-0000-0000-000000000002', 'logistica viewer', false),
  ('00000000-0000-0000-0000-000000000003', 'alt modul', false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid, module text, access_level text,
  granted_at timestamptz DEFAULT now(), granted_by uuid);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-000000000002', 'logistica', 'viewer'),
  ('00000000-0000-0000-0000-000000000003', 'ofertare', 'admin');

CREATE TABLE public.logistica_active (id integer PRIMARY KEY, marca text, model text, serie_sasiu text, nr_inmatriculare text, km_actuali integer);
INSERT INTO public.logistica_active VALUES (237, 'BMW', 'X5', ' wbatest0000000001 ', 'PH-00-TST', 48000),
                                           (238, 'Dacia', 'Duster', 'UU1TEST0000000099', 'PH-01-TST', 90000);
CREATE TABLE public.logistica_telemetrie_zilnica (id bigserial PRIMARY KEY, asset_id integer, data date, total_km_zi numeric,
  km_sfarsit_zi numeric, sursa text, raw_data jsonb, UNIQUE (asset_id, data, sursa));
INSERT INTO public.logistica_telemetrie_zilnica (asset_id, data, total_km_zi, km_sfarsit_zi, sursa) VALUES
  (237, '2026-10-10', 50, 120050, 'evogps'), (237, '2026-10-11', 60, 120110, 'evogps'),
  (237, '2026-10-12', 0, 120110, 'evogps'), (237, '2026-10-13', 40, 120150, 'evogps'),
  (237, '2026-10-13', 999, 999999, 'alta_sursa'), (238, '2026-10-13', 77, 5000, 'evogps');
