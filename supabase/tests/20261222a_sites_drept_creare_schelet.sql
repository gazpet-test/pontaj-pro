-- Schema FALSĂ, minimă, tip Supabase, pentru proba locală a migrării 20261222a (scripts/pglite/test_sites_drept_creare_local.mjs). NU e pentru producție.
-- Roluri ca în Supabase (service_role BYPASSRLS), auth.uid() din request.jwt.claim.sub / request.jwt.claims, drepturile implicite ALL pentru
-- rolurile API pe obiectele noi din public (deci migrarea TREBUIE să le retragă pe funcția nouă).
-- sites: politicile de azi descrise în cerere (citire pentru conturile logate; INSERT / UPDATE / DELETE doar owner — sites_insert_owner) +
--   un trigger AFTER UPDATE (ca trg_raport_rezumat_santier_mutat), ca amprenta L15 să acopere și triggerele tabelului.
-- user_module_access / app_modules: coloanele și constrângerile reale (FK pe app_modules.key, CHECK pe nivel, UNIQUE pe cont + modul),
--   ca în supabase/tests/conturi_schelet_supabase.sql. Funcțiile de drept Execuție (fn_executie_proiect_permis și callee-urile) le adaugă
--   harness-ul, extrase EXACT din 20261209a.
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

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text, is_owner boolean NOT NULL DEFAULT false,
  can_manage_contracts boolean NOT NULL DEFAULT false, can_modify_employees boolean NOT NULL DEFAULT false);
CREATE TABLE public.app_modules (
  key text NOT NULL PRIMARY KEY, parent_key text, name text NOT NULL, icon text, color text, description text,
  is_active boolean NOT NULL DEFAULT false, display_order integer, created_at timestamptz DEFAULT now(),
  show_on_homepage boolean NOT NULL DEFAULT true
);
INSERT INTO public.app_modules (key, name, is_active)
SELECT k, k, true FROM unnest(ARRAY['administrativ', 'administrativ.locatii', 'ctc', 'executie', 'hr', 'logistica', 'pontajpro']) AS k;
UPDATE public.app_modules SET parent_key = split_part(key, '.', 1) WHERE key LIKE '%.%';
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module text NOT NULL REFERENCES public.app_modules(key) ON DELETE CASCADE,
  access_level text NOT NULL,
  granted_at timestamptz DEFAULT now(),
  granted_by uuid REFERENCES public.profiles(id),
  CONSTRAINT user_module_access_level_chk CHECK (access_level = ANY (ARRAY['admin','editor','viewer'])),
  CONSTRAINT user_module_access_profile_id_module_key UNIQUE (profile_id, module)
);
CREATE TABLE public.executie_proiecte (id bigint PRIMARY KEY, nume text, cod_intern text, activ boolean NOT NULL DEFAULT true, site_id integer);
CREATE TABLE public.executie_acces_proiect (profile_id uuid REFERENCES public.profiles(id), proiect_id bigint REFERENCES public.executie_proiecte(id),
  nivel text NOT NULL DEFAULT 'editor', PRIMARY KEY (profile_id, proiect_id));
CREATE TABLE public.sites (
  id serial PRIMARY KEY, name text, active boolean DEFAULT true, created_at timestamptz DEFAULT now(),
  beneficiar_principal text, proiect_id integer REFERENCES public.executie_proiecte(id)
);
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY sites_select_auth ON public.sites FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY sites_insert_owner ON public.sites FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));
CREATE POLICY sites_update_owner ON public.sites FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));
CREATE POLICY sites_delete_owner ON public.sites FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));
CREATE FUNCTION public.fn_schelet_sites_mutat() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN RETURN NULL; END $f$;
REVOKE ALL ON FUNCTION public.fn_schelet_sites_mutat() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_schelet_sites_mutat AFTER UPDATE ON public.sites FOR EACH ROW
  WHEN (old.proiect_id IS DISTINCT FROM new.proiect_id) EXECUTE FUNCTION public.fn_schelet_sites_mutat();
