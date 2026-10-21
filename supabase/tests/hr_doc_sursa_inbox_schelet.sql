-- Schelet minim (NU se aplică pe producție) pentru scripts/test_hr_doc_sursa_inbox.sh — doar într-o bază locală *_test.
-- Reproduce ce atinge 20261103a (structura din producție, 21.10.2026):
--   * rolurile Supabase + default privileges (EXECUTE pe funcțiile noi pentru anon/authenticated/service_role — ca REVOKE-ul
--     din migrare să fie verificat pe starea reală, nu pe una deja restrânsă);
--   * hr_documente_personale cu coloanele live (id int PK, employee_id, tip_id, numar_document, emitent, data_emitere,
--     data_expirare, fara_expirare, fisier_*, activ, observatii, uploadat_de/la, modificat_la, deleted_at/by, drive_file_id),
--     trigger-ul BEFORE UPDATE trg_hr_docp_modificat_la și RLS pe toate cele 4 operații pentru profilurile cu
--     can_access_personal_data sau is_owner (politicile sunt o reproducere a regulii, nu text verbatim);
--   * ai_documente_inbox (id bigint) — fără FK spre ea, ca în migrare; cu RLS pe SELECT reprodus după politica live
--     (uploadat_de = auth.uid() OR modul_tinta IS NULL OR fn_ai_inbox_poate_confirma(modul_tinta, entitate_id); funcția =
--     reproducere a regulii — ownerul vede tot, HR (can_access_personal_data) coada 'hr' —, nu text verbatim), ca garda INVOKER de la
--     INSERT (review extern #821, F2) să fie verificată pe ce vede apelantul;
--   * fără sursa_inbox_id (starea dinainte de 20261103a).
-- Date FICTIVE: angajații 7 / 8, doc 10 (adus din Drive, la 7) și doc 11 (încărcat manual, la 8), rândurile 501–513 din coadă
-- (501–506 HR deschise; 507 logistică, 508 confirmat, 509 nedecis, 510 eroare, 511 în așteptare, 512 respins, 513 HR urcat
-- de profilul fără drept).
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false,
  can_access_personal_data boolean NOT NULL DEFAULT false);
CREATE TABLE public.employees (id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.hr_documente_personale_tipuri (id integer PRIMARY KEY, cod text NOT NULL, denumire text NOT NULL,
  are_expirare boolean NOT NULL DEFAULT true, activ boolean NOT NULL DEFAULT true);
CREATE TABLE public.ai_documente_inbox (id bigserial PRIMARY KEY, fisier_nume text, fisier_size_bytes bigint,
  status text NOT NULL DEFAULT 'clasificat', modul_tinta text, entitate_id bigint, uploadat_de uuid, confirmat_ref_id bigint);
CREATE FUNCTION public.fn_ai_inbox_poate_confirma(p_modul text, p_entitate bigint) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_modul IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
           AND (p.is_owner OR (p_modul = 'hr' AND p.can_access_personal_data))) $$;
ALTER TABLE public.ai_documente_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_inbox_select ON public.ai_documente_inbox FOR SELECT TO authenticated
  USING (uploadat_de = auth.uid() OR modul_tinta IS NULL OR public.fn_ai_inbox_poate_confirma(modul_tinta, entitate_id));

CREATE TABLE public.hr_documente_personale (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES public.employees(id),
  tip_id integer REFERENCES public.hr_documente_personale_tipuri(id),
  numar_document text, emitent text, data_emitere date, data_expirare date,
  fara_expirare boolean NOT NULL DEFAULT false,
  fisier_path text, fisier_nume text, fisier_size_bytes bigint, fisier_mime text,
  activ boolean DEFAULT true, observatii text,
  uploadat_de uuid, uploadat_la timestamptz NOT NULL DEFAULT now(), modificat_la timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, deleted_by uuid, drive_file_id text
);
CREATE FUNCTION public.hr_docp_set_modificat_la() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN NEW.modificat_la := now(); RETURN NEW; END $f$;
CREATE TRIGGER trg_hr_docp_modificat_la BEFORE UPDATE ON public.hr_documente_personale
  FOR EACH ROW EXECUTE FUNCTION public.hr_docp_set_modificat_la();

ALTER TABLE public.hr_documente_personale ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_docp_select ON public.hr_documente_personale FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.can_access_personal_data OR p.is_owner)));
CREATE POLICY hr_docp_insert ON public.hr_documente_personale FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.can_access_personal_data OR p.is_owner)));
CREATE POLICY hr_docp_update ON public.hr_documente_personale FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.can_access_personal_data OR p.is_owner)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.can_access_personal_data OR p.is_owner)));
CREATE POLICY hr_docp_delete ON public.hr_documente_personale FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.can_access_personal_data OR p.is_owner)));

INSERT INTO public.profiles (id, name, is_owner, can_access_personal_data) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'HR (fictiv)', false, true),
  ('00000000-0000-0000-0000-0000000000e2', 'Owner (fictiv)', true, false),
  ('00000000-0000-0000-0000-0000000000e3', 'Fără drept (fictiv)', false, false);
INSERT INTO public.employees (id, name) VALUES (7, 'POPESCU ION (fictiv)'), (8, 'IONESCU ANA (fictiv)');
INSERT INTO public.hr_documente_personale_tipuri (id, cod, denumire) VALUES (1, 'buletin', 'Buletin / CI');
INSERT INTO public.ai_documente_inbox (id, fisier_nume, fisier_size_bytes, modul_tinta) VALUES
  (501, 'CI.pdf', 1234, 'hr'), (502, 'CI.pdf', 1234, 'hr'), (503, 'cazier.pdf', 99, 'hr'),
  (504, 'x.pdf', 1, 'hr'), (505, 'y.pdf', 2, 'hr'), (506, 'z.pdf', 3, 'hr');
INSERT INTO public.ai_documente_inbox (id, fisier_nume, fisier_size_bytes, modul_tinta, status, uploadat_de) VALUES
  (507, 'CI.pdf', 1234, 'logistica', 'clasificat', NULL), (508, 'CI.pdf', 1234, 'hr', 'confirmat', NULL),
  (509, 'CI.pdf', 1234, NULL, 'clasificat', NULL), (510, 'CI.pdf', 1234, 'hr', 'eroare', NULL),
  (511, 'CI.pdf', 1234, 'hr', 'in_asteptare', NULL), (512, 'CI.pdf', 1234, 'hr', 'respins', NULL),
  (513, 'CI.pdf', 1234, 'hr', 'clasificat', '00000000-0000-0000-0000-0000000000e3');
INSERT INTO public.hr_documente_personale (id, employee_id, tip_id, fisier_path, fisier_nume, fisier_size_bytes, activ, observatii,
  uploadat_de, modificat_la, drive_file_id) VALUES
  (10, 7, 1, '7/drive/abc.pdf', 'CI.pdf', 1234, true, 'Adus din Drive.', NULL, '2026-01-01 00:00+00', 'abc'),
  (11, 8, 1, '8/aidoc_1.pdf', 'CI.pdf', 1234, true, NULL, '00000000-0000-0000-0000-0000000000e1', '2026-01-01 00:00+00', NULL);
SELECT setval('public.hr_documente_personale_id_seq', 100), setval('public.ai_documente_inbox_id_seq', 1000);
