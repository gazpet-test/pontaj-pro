-- Schelet LOCAL (PG17 de unica folosinta) pentru 20261130a_sms_mvp — reproduce DOAR ce atinge migrarea din platforma Supabase:
-- rolurile anon / authenticated / service_role, auth.uid() / auth.jwt() / auth.role() (textul live), privilegiile implicite periculoase
-- (ALL pe tabele / secvente noi, EXECUTE implicit pe functii), profiles, user_module_access, employees (coloanele folosite) si
-- tabelele Redari folosite (fara triggerele lor), supabase_migrations.schema_migrations.
-- Fixture fictiv: un owner, un editor redari, un viewer redari; angajati cu telefoane 0700… (fictive). NU se ruleaza pe productie.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE SCHEMA supabase_migrations;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$f$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.app_modules (key text PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL REFERENCES public.app_modules(key),
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'viewer')), UNIQUE (profile_id, module));
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.employees (id serial PRIMARY KEY, name text NOT NULL, department text NOT NULL, active boolean, telefon text);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.red_proiecte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL UNIQUE, denumire text, activ boolean NOT NULL DEFAULT true);
CREATE TABLE public.red_uat (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL,
  uat3 text NOT NULL, judet text, UNIQUE (proiect_id, uat3));
CREATE TABLE public.red_parcele (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id), id_parcela text NOT NULL CHECK (id_parcela ~ '^[A-Z]{3}-[0-9]{4}$'), tronson integer, sters_la timestamptz);
CREATE TABLE public.red_detinatori (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcela_id uuid NOT NULL REFERENCES public.red_parcele(id),
  nume text NOT NULL, nume_normalizat text NOT NULL, calitate text NOT NULL, decedat boolean NOT NULL DEFAULT false, sters_la timestamptz);
CREATE TABLE public.red_detinatori_contact (detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), telefon text, email text,
  adresa_cunoscuta boolean NOT NULL DEFAULT true);
CREATE TABLE public.red_convocari (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  canal text NOT NULL CHECK (canal IN ('posta', 'sms', 'email', 'afisare', 'telefon')), stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  sters_la timestamptz);
DO $g$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_proiecte', 'red_uat', 'red_parcele', 'red_detinatori', 'red_detinatori_contact', 'red_convocari'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $g$;

CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);

INSERT INTO public.app_modules (key, name) VALUES ('redari', 'Redari teren');
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner.test@exemplu.local', 'OWNER TEST', true),
  ('00000000-0000-0000-0000-0000000000a2', 'editor.test@exemplu.local', 'EDITOR TEST', false),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer.test@exemplu.local', 'VIEWER TEST', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'redari', 'editor'), ('00000000-0000-0000-0000-0000000000a3', 'redari', 'viewer');
-- angajati fictivi: 4 cu mobil (unul scris cu spatii, unul cu +40), unul fara telefon, unul cu fix, unul inactiv
INSERT INTO public.employees (name, department, active, telefon) VALUES
  ('TEST ANGAJAT UNU', 'Execuție', true, '0700000101'), ('TEST ANGAJAT DOI', 'Execuție', true, '0700 000 102'),
  ('TEST ANGAJAT TREI', 'TESA', true, '+40700000103'), ('TEST ANGAJAT PATRU', 'TESA', true, '0700000104'),
  ('TEST ANGAJAT CINCI', 'Logistică', true, NULL), ('TEST ANGAJAT SASE', 'TESA', true, '0210000000'),
  ('TEST ANGAJAT SAPTE', 'Execuție', false, '0700000107');
