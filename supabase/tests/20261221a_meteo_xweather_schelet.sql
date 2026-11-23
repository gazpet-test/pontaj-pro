-- Schema FALSĂ, minimă, tip Supabase, pentru proba locală a migrării 20261221a (scripts/pglite/test_meteo_xweather_local.mjs). NU e pentru producție.
-- Roluri ca în Supabase (service_role BYPASSRLS), auth.uid() din request.jwt.claim.sub / request.jwt.claims, drepturile implicite ALL pentru
-- rolurile API pe obiectele noi din public (deci migrarea TREBUIE să le retragă), tabelele citite de predicat. Funcțiile de drept reale
-- (fn_raport_santier_drept, fn_executie_proiect_permis și callee-urile lor) le adaugă harness-ul, extrase EXACT din 20261209a.
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.executie_proiecte (id bigint PRIMARY KEY, nume text, cod_intern text, activ boolean NOT NULL DEFAULT true, data_start date);
CREATE TABLE public.sites (
  id bigint PRIMARY KEY, name text, lat numeric, lng numeric, active boolean NOT NULL DEFAULT true, meteo_activ boolean NOT NULL DEFAULT true,
  proiect_id bigint REFERENCES public.executie_proiecte(id)
);
CREATE TABLE public.profile_sites (profile_id uuid REFERENCES public.profiles(id), site_id bigint REFERENCES public.sites(id), valid_until date,
  PRIMARY KEY (profile_id, site_id));
CREATE TABLE public.user_module_access (profile_id uuid REFERENCES public.profiles(id), module text NOT NULL, access_level text NOT NULL,
  PRIMARY KEY (profile_id, module));
CREATE TABLE public.executie_acces_proiect (profile_id uuid REFERENCES public.profiles(id), proiect_id bigint REFERENCES public.executie_proiecte(id),
  nivel text NOT NULL DEFAULT 'editor', PRIMARY KEY (profile_id, proiect_id));
-- citirea șantierelor: ca în producție, rânduri existente pot fi invizibile (nu contează pentru predicat: el citește ca proprietar)
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY sites_citire ON public.sites FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.profile_sites ps WHERE ps.profile_id = auth.uid() AND ps.site_id = sites.id));
