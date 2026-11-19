-- Schema FALSĂ, minimă, tip Supabase, pentru proba locală a migrării 20261222b (scripts/pglite/test_ctc_autorizatii_local.mjs). NU e pentru producție.
-- Roluri ca în Supabase (service_role BYPASSRLS), auth.uid() din request.jwt.claim.sub / request.jwt.claims, drepturile implicite ALL pentru
-- rolurile API pe obiectele noi din public (deci migrarea TREBUIE să le retragă pe funcțiile noi).
-- hr_autorizatii / hr_autorizatii_tipuri: coloanele live din supabase/tests/sec_rsvti_schelet.sql (fără FK-urile spre tabele care nu contează
-- aici) și politica de citire de azi; employees / hr_personal_extern cu câmpuri personale (CNP, telefon, email) ca proba să arate că funcțiile
-- noi NU le întorc.
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

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false, can_access_ctc boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL, access_level text NOT NULL,
  PRIMARY KEY (profile_id, module));
CREATE TABLE public.employees (id serial PRIMARY KEY, name text NOT NULL, cnp text, telefon text, email text, iban text);
CREATE TABLE public.hr_personal_extern (id bigserial PRIMARY KEY, nume text NOT NULL, functie text, firma text, cui_firma text, telefon text, email text);
CREATE TABLE public.hr_autorizatii_tipuri (
  id serial PRIMARY KEY, cod text NOT NULL UNIQUE, denumire text NOT NULL, detaliere text, categorie text NOT NULL DEFAULT 'profesional'::text,
  perioada_default_luni integer, emitent_default text, necesita_procedura boolean DEFAULT false, activ boolean DEFAULT true
);
CREATE TABLE public.hr_autorizatii (
  id bigserial PRIMARY KEY, employee_id bigint REFERENCES public.employees(id), tip_id integer REFERENCES public.hr_autorizatii_tipuri(id),
  numar_autorizatie text, emitent text, data_emitere date, data_expirare date, fara_expirare boolean DEFAULT false,
  procedeu_sudura text, diametru_teava_mm numeric, subcategorie text, fisier_path text, fisier_nume text, fisier_size_bytes bigint,
  observatii text, uploadat_de uuid, uploadat_la timestamptz DEFAULT now(), modificat_la timestamptz DEFAULT now(), calitate_material text,
  domenii text[], fisier_mime text, deleted_at timestamptz, deleted_by uuid, rsvti_observatii text,
  extern_id bigint REFERENCES public.hr_personal_extern(id), verificat_pe_scan boolean NOT NULL DEFAULT false, document_personal_id bigint,
  inlocuita_de_id bigint REFERENCES public.hr_autorizatii(id), inlocuita_la timestamptz,
  CONSTRAINT hr_autorizatii_titular_unic CHECK (((employee_id IS NOT NULL) <> (extern_id IS NOT NULL)))
);
ALTER TABLE public.hr_autorizatii ENABLE ROW LEVEL SECURITY;
CREATE POLICY autorizatii_read_all ON public.hr_autorizatii FOR SELECT TO authenticated USING (true);
ALTER TABLE public.hr_autorizatii_tipuri ENABLE ROW LEVEL SECURITY;
CREATE POLICY tipuri_read_all ON public.hr_autorizatii_tipuri FOR SELECT TO authenticated USING (true);
