-- Schelet LOCAL (PGlite / PG de unică folosință) pentru 20261229a (Administrativ → UPA: plafonul pe lună, luna închisă, alerta). NU se rulează pe producție.
-- Reproduce DOAR ce citește / atinge migrarea: rolurile Supabase (service_role BYPASSRLS), privilegiile implicite periculoase (ALL / EXECUTE pe
-- obiecte noi: migrarea trebuie să le scoată), auth.uid() (textul live: claim-ul request.jwt.claim.sub), profiles + user_module_access,
-- logistica_setari (citire pentru orice cont logat, ca după 20261015b), logistica_furnizori, notifications (cu notifications_modul_check live) și
-- upa_achizitii cu politica veche upa_achizitii_all (ALL, auth.uid() IS NOT NULL) și drepturile implicite pe tabel.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$function$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_sel ON public.profiles FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'viewer')), UNIQUE (profile_id, module));
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY uma_sel ON public.user_module_access FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE TABLE public.logistica_setari (key text PRIMARY KEY, value text, updated_at timestamptz DEFAULT now());
ALTER TABLE public.logistica_setari ENABLE ROW LEVEL SECURITY;
CREATE POLICY logistica_setari_select ON public.logistica_setari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE public.logistica_furnizori (
  id bigserial PRIMARY KEY, nume text NOT NULL, cui text, activ boolean NOT NULL DEFAULT true, este_upa boolean NOT NULL DEFAULT false,
  upa_autorizatie text, upa_valabil_pana date);
ALTER TABLE public.logistica_furnizori ENABLE ROW LEVEL SECURITY;
CREATE POLICY logistica_furnizori_sel ON public.logistica_furnizori FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE public.notifications (
  id bigserial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, type text NOT NULL,
  modul text DEFAULT 'general', title text NOT NULL, message text, link_to text, read_at timestamptz, action_taken boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_modul_check CHECK ((modul = ANY (ARRAY['general'::text, 'Logistică'::text, 'Pontaj'::text, 'Execuție'::text, 'Financiar'::text, 'Comercial'::text, 'Administrativ'::text, 'HR'::text, 'Tichete'::text, 'Rapoarte'::text, 'Ședințe'::text, 'Ofertare'::text, 'Clădire'::text]))));
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON public.notifications FOR SELECT TO authenticated USING (profile_id = auth.uid());

-- upa_achizitii: coloanele folosite de ecran și de Citește Orice (confirmUPA), politica veche și drepturile implicite pe tabel
CREATE TABLE public.upa_achizitii (
  id bigserial PRIMARY KEY, furnizor_id bigint REFERENCES public.logistica_furnizori(id), furnizor_nume text, numar_factura text, data_factura date,
  luna date NOT NULL, valoare numeric(12,2) NOT NULL, descriere text, document_path text, created_by uuid, created_at timestamptz DEFAULT now());
ALTER TABLE public.upa_achizitii ENABLE ROW LEVEL SECURITY;
CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);

-- schema inițială: fără drepturi pentru anon pe tabelele de mai sus (ca pe live după 20261218b); authenticated are ce are pe live
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'user_module_access', 'logistica_setari', 'logistica_furnizori', 'notifications', 'upa_achizitii'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
  END LOOP;
END $t$;
REVOKE ALL ON SEQUENCE public.upa_achizitii_id_seq FROM anon;

-- Storage (runda 3, pentru 20261229c): coloanele ca în Supabase (owner_id, metadate, path_tokens generat), RLS ca în Supabase, drepturile
-- rolurilor API ca în Supabase (filtrate de politici); bucketul documente-upa cu politica veche EXACT ca în baseline
-- (supabase/tests/izometrie_e3_schelet_baseline.sql) și politica altui bucket (permisivă, nu trebuie să deschidă documente-upa)
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text,
  owner_id text,
  user_metadata jsonb,
  CONSTRAINT objects_bucket_name_uq UNIQUE (bucket_id, name)
);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
CREATE POLICY buckets_citire ON storage.buckets FOR SELECT TO authenticated USING (true);
INSERT INTO storage.buckets (id, name, public) VALUES ('documente-upa', 'documente-upa', false), ('altul', 'altul', false);
CREATE POLICY "upa docs authenticated all" ON storage.objects AS PERMISSIVE FOR ALL TO public USING (((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL))) WITH CHECK (((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY altul_tot ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'altul') WITH CHECK (bucket_id = 'altul');
