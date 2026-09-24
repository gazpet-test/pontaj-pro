-- Schemă-STUB pentru testele locale ale migrării 20260924_z1_cerinte_subiect (Postgres local, NU producție).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid NOT NULL, module text NOT NULL, access_level text NOT NULL);
CREATE TABLE public.ofertare_licitatii (id bigint PRIMARY KEY, nr_anunt text);
CREATE TABLE public.ofertare_cerinte (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  nr_ordine int, sursa_sectiune text, text_cerinta text NOT NULL,
  inlocuita_de bigint REFERENCES public.ofertare_cerinte(id), duplicat_al bigint,
  confirmata_de uuid
);
CREATE TABLE public.ofertare_acoperire (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE,
  mod text, status text, autorizatie_id bigint, doc_firma_id bigint, partener_id bigint,
  recomandare_id bigint, document_personal_id bigint, ales boolean, ales_de uuid
);
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare'));
$$;
ALTER TABLE public.ofertare_cerinte ENABLE ROW LEVEL SECURITY;
CREATE POLICY cer_sel ON public.ofertare_cerinte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;
INSERT INTO public.profiles VALUES ('11111111-1111-1111-1111-111111111111','Owner Test',true), ('22222222-2222-2222-2222-222222222222','Editor Ofertare',false), ('33333333-3333-3333-3333-333333333333','Fara Acces',false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('22222222-2222-2222-2222-222222222222','ofertare','editor');
INSERT INTO public.ofertare_licitatii VALUES (900,'TEST-A'), (901,'TEST-B');
-- Exemple reale Ulmeni (lic. 100), texte scurtate
INSERT INTO public.ofertare_cerinte (licitatie_id, nr_ordine, sursa_sectiune, text_cerinta) VALUES
 (900, 16, 'III.1.1.b', 'Ofertantul trebuie să dețină autorizație ANRE tip EDSB valabilă'),
 (900, 37, 'III.1.2', 'Autorizație EDSB emisă de ANRE pentru execuția sistemelor de distribuție'),
 (900, 146, 'III.1.3', 'Managerul de proiect trebuie să aibă experiență specifică'),
 (900, 175, 'Caiet de sarcini', 'Încadrarea execuției în durata autorizată de 36 luni, calculată de la ordinul de începere'),
 (900, 369, 'Caiet de sarcini', 'Materialele vor avea agrement tehnic și aviz sanitar'),
 (900, 500, 'Diverse', 'Text fără nicio legătură cu dicționarul'),
 (900, 501, 'III.2', 'Managerul de proiect va prezenta graficul de execuție la ședința de demarare'),
 (901, 1, 'III', 'Autorizație EDSB');
