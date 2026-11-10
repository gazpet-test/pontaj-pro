-- Schelet minim tip Supabase pentru testul concurent al migrării 20261207a (scripts/test_executie_noduri_constructii_concurent.sh).
-- DOAR pe un cluster PostgreSQL local de unică folosință. Roluri anon / authenticated / service_role (BYPASSRLS), drepturi implicite ALL pe
-- obiectele noi din public (ca în Supabase), auth.uid() din request.jwt.claim.sub / request.jwt.claims, tabelele minime de care depind
-- 20261201a și 20261207a, storage minim. Date FICTIVE (profiluri de test, proiectul 1).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false, name text);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL, access_level text NOT NULL);
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, nume text);
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000001', true, 'OWNER TEST'), ('00000000-0000-0000-0000-000000000002', false, 'EDITOR TEST');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-0000-0000-000000000002', 'executie', 'editor');
INSERT INTO public.executie_proiecte (nume) VALUES ('Proiect test 1');
CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON storage.objects TO authenticated;
