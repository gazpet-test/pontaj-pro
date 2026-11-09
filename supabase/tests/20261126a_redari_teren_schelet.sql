-- Schelet LOCAL (PG17 de unică folosință) pentru 20261126a_redari_teren — reproduce DOAR ce atinge migrarea din platforma Supabase:
-- rolurile anon / authenticated / service_role, auth.uid() / auth.jwt() / auth.role() (textul live, 01.11.2026), extensions.gen_random_bytes
-- (pgcrypto), public.profiles (id, email, name, is_owner), public.app_modules (key …), public.user_module_access (coloanele, CHECK-ul
-- admin/editor/viewer, FK-urile, UNIQUE (profile_id, module) — ca live), storage.buckets / storage.objects (coloanele, RLS, GRANT-urile live
-- pentru anon / authenticated / service_role), supabase_migrations.schema_migrations. Fixture: un owner și două conturi fără modulul redari.
-- NU se rulează pe producție. Comenzile: docs/redari/MIGRARE_20261126a.md.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA extensions;
CREATE SCHEMA supabase_migrations;
CREATE EXTENSION pgcrypto SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;

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

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.app_modules (
  key text PRIMARY KEY, parent_key text, name text NOT NULL, icon text, color text, description text,
  is_active boolean NOT NULL DEFAULT false, display_order int, created_at timestamptz DEFAULT now(), show_on_homepage boolean NOT NULL DEFAULT true);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module text NOT NULL REFERENCES public.app_modules(key) ON DELETE CASCADE,
  access_level text NOT NULL CONSTRAINT user_module_access_level_chk CHECK (access_level = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])),
  granted_at timestamptz DEFAULT now(),
  granted_by uuid REFERENCES public.profiles(id),
  CONSTRAINT user_module_access_profile_id_module_key UNIQUE (profile_id, module));
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles, public.app_modules, public.user_module_access TO authenticated, service_role;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false, avif_autodetection boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], owner_id text,
  versioning_status text, lifecycle_configuration jsonb, lifecycle_configuration_generation uuid);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb, path_tokens text[], version text, owner_id text, user_metadata jsonb, archived_at timestamptz,
  is_delete_marker boolean DEFAULT false, is_versioned boolean DEFAULT false);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
GRANT ALL ON storage.objects, storage.buckets TO service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated;

CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text);

INSERT INTO public.app_modules (key, name, is_active, display_order) VALUES ('ofertare', 'Ofertare', true, 1);
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner.test@exemplu.local', 'OWNER TEST', true),
  ('00000000-0000-0000-0000-0000000000a4', 'fara.test@exemplu.local', 'FARA TEST', false),
  ('00000000-0000-0000-0000-0000000000a5', 'ofertare.test@exemplu.local', 'OFERTARE TEST', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-0000-0000-0000000000a5', 'ofertare', 'editor');
