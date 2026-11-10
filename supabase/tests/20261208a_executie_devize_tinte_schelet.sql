-- Schelet minim „tip Supabase” pentru proba LOCALĂ (PGlite, în memorie) a migrării 20261208a și a harness-ului scripts/test_executie_devize_tinte.sql.
-- NU e migrare și nu se rulează pe nicio bază reală. Reproduce doar ce folosesc 20261201a + 20261208a: rolurile (service_role cu BYPASSRLS),
-- privilegiile implicite din schema public (ALL pentru anon / authenticated / service_role, ca la Supabase), auth.uid() din cele două surse JWT,
-- storage.buckets / storage.objects, tabelele existente cu coloanele citite din cod și RLS-ul lor „autentificat” (auth.uid() IS NOT NULL).
-- Date: profiluri sintetice (1 owner + 3), două proiecte (CLONA-A / CLONA-B), două șantiere — ca pe clona chat-ului, fără nimic real.
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL, access_level text NOT NULL, UNIQUE (profile_id, module));
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cod_intern text, nume text);
CREATE TABLE public.sites (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text, active boolean DEFAULT true, adresa text,
  proiect_id bigint REFERENCES public.executie_proiecte(id));
CREATE TABLE public.profile_sites (profile_id uuid NOT NULL REFERENCES public.profiles(id), site_id integer NOT NULL REFERENCES public.sites(id),
  valid_until date, granted_by uuid, note text, PRIMARY KEY (profile_id, site_id));
CREATE TABLE public.rapoarte_zilnice (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, site_id integer NOT NULL REFERENCES public.sites(id),
  data date NOT NULL, sef_santier text, lucrari_efectuate text, created_by uuid, updated_at timestamptz DEFAULT now(), UNIQUE (site_id, data));
CREATE TABLE public.proiect_unitati (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tip text NOT NULL DEFAULT 'tronson', cod text, nume text NOT NULL, ordine integer DEFAULT 0, activ boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.proiect_activitati (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  nume text NOT NULL, um text, coduri_deviz text, ordine integer DEFAULT 0, tip_raportare text DEFAULT 'cantitate', activ boolean DEFAULT true,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.proiect_articole (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text, denumire text, um text, cantitate numeric, valoare numeric,
  sursa text, act_nr text, deja_comandat boolean DEFAULT false);
CREATE TABLE public.raport_lucrari (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raport_id bigint NOT NULL REFERENCES public.rapoarte_zilnice(id) ON DELETE CASCADE, proiect_id bigint REFERENCES public.executie_proiecte(id),
  activitate_id integer REFERENCES public.proiect_activitati(id) ON DELETE CASCADE, unitate_id bigint REFERENCES public.proiect_unitati(id) ON DELETE SET NULL,
  cantitate numeric, observatii text, created_at timestamptz DEFAULT now());
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'user_module_access', 'executie_proiecte', 'sites', 'profile_sites', 'rapoarte_zilnice',
                           'proiect_unitati', 'proiect_activitati', 'proiect_articole', 'raport_lucrari'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t || '_autentificat', t);
  END LOOP;
END $rls$;

INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-4000-8000-000000000001', 'OWNER SINTETIC', true),
  ('00000000-0000-4000-8000-000000000002', 'EDITOR SINTETIC', false),
  ('00000000-0000-4000-8000-000000000003', 'SEF SINTETIC', false),
  ('00000000-0000-4000-8000-000000000004', 'FARA SINTETIC', false);
INSERT INTO public.executie_proiecte (cod_intern, nume) VALUES ('CLONA-A', 'Proiect sintetic A'), ('CLONA-B', 'Proiect sintetic B');
INSERT INTO public.sites (name, proiect_id) VALUES ('Șantier sintetic A', 1), ('Șantier sintetic B', 2);
