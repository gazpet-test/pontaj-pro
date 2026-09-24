-- Schemă-STUB pentru testele locale ale migrării ofertare_cerinte_dovezi (Postgres local, NU producție).
-- Reproduce doar ce atinge migrarea: roluri, auth.uid(), profiles, user_module_access, licitații, documente, cerințe, fn_are_acces_ofertare.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid NOT NULL, module text NOT NULL, access_level text NOT NULL);
CREATE TABLE public.ofertare_licitatii (id bigint PRIMARY KEY, nr_anunt text, responsabil_id uuid);
CREATE TABLE public.ofertare_documente_atribuire (id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id), nume_original text NOT NULL, fisier_path text NOT NULL DEFAULT '');
CREATE TABLE public.ofertare_cerinte (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  sursa_document_id bigint REFERENCES public.ofertare_documente_atribuire(id),
  text_cerinta text NOT NULL, tip text NOT NULL DEFAULT 'propunere',
  sursa_pasaj text, pasaj_verificat boolean, sursa_pagina int, locator_verificat text,
  confirmata_de uuid, confirmata_la timestamptz, text_editat_la timestamptz, text_editat_de uuid,
  sursa_pack_id bigint, sursa_ref text, stare text NOT NULL DEFAULT 'de_analizat'
);
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare'));
$$;
ALTER TABLE public.ofertare_cerinte ENABLE ROW LEVEL SECURITY;
CREATE POLICY cer_sel ON public.ofertare_cerinte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
ALTER TABLE public.ofertare_documente_atribuire ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sel ON public.ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;
-- Fixture izolat (id-uri fictive, NU rândurile reale 6352–6354)
INSERT INTO public.profiles VALUES ('11111111-1111-1111-1111-111111111111','Owner Test',true), ('22222222-2222-2222-2222-222222222222','Editor Ofertare',false), ('33333333-3333-3333-3333-333333333333','Fara Acces',false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('22222222-2222-2222-2222-222222222222','ofertare','editor');
INSERT INTO public.ofertare_licitatii VALUES (900,'DF-TEST-A',NULL), (901,'DF-TEST-B',NULL);
INSERT INTO public.ofertare_documente_atribuire VALUES (9001,900,'Fisa_de_date_TEST.pdf'), (9002,901,'Alt_document_alta_licitatie.pdf');
INSERT INTO public.ofertare_cerinte (licitatie_id, sursa_document_id, text_cerinta, sursa_pasaj, pasaj_verificat, sursa_pagina, locator_verificat)
VALUES (900, 9001, 'Finanțarea se asigură din bugetul de stat prin PNI Anghel Saligny și din bugetele locale. Nu se acordă avans.', 'Nu se acordă avans. Plățile se efectuează pentru lucrările executate', true, 13, 'pagina');
