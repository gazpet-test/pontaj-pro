-- Schelet LOCAL (PG17 de unica folosinta) pentru 20261205a_polite_alerte. Reproduce DOAR ce atinge migrarea din platforma Supabase si
-- din tabelele ERP (coloanele folosite, CHECK-urile citite de precondtii, RLS-ul de azi pe contracte_polite / garantii), cu date FICTIVE.
-- NU se ruleaza pe productie.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE SCHEMA supabase_migrations;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- storage (doar forma folosita)
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY);
CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text REFERENCES storage.buckets(id), name text);
INSERT INTO storage.buckets VALUES ('contracte-terti');
-- pg_cron / pg_net / vault (ca 20261130d_sms_sold_schelet.sql)
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT current_database(), username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true, jobname text UNIQUE
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid
$f$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name AND username = current_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name; END IF;
  RETURN true;
END $f$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
                              timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets_schelet (name text PRIMARY KEY, decrypted_secret text NOT NULL);
CREATE VIEW vault.decrypted_secrets AS SELECT name, decrypted_secret FROM vault.secrets_schelet;
INSERT INTO vault.secrets_schelet VALUES ('INTERN_EDGE_SECRET', repeat('0123456789abcdef', 4));
REVOKE ALL ON SCHEMA cron, net, vault, storage FROM PUBLIC;
DO $d$ BEGIN EXECUTE format('ALTER DATABASE %I SET cron.timezone = %L', current_database(), 'GMT'); END $d$;

-- ERP: coloanele folosite
CREATE TABLE public.employees (id serial PRIMARY KEY, name text NOT NULL, email text, active boolean);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false, employee_id integer REFERENCES public.employees(id),
                              can_manage_contracts boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_sel ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
-- poarta garantiilor (20261005b), simplificata pe fixture: owner sau „financiar” (profilul cu numele FIN…)
CREATE FUNCTION public.fn_poate_scrie_garantii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_owner OR p.name LIKE 'FIN%'))
$f$;
REVOKE ALL ON FUNCTION public.fn_poate_scrie_garantii() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_garantii() TO authenticated, service_role;

CREATE TABLE public.contracte_terti (id serial PRIMARY KEY, numar_contract text, denumire text, data_semnare date, status text);
CREATE TABLE public.contracte_polite (
  id serial PRIMARY KEY, contract_id integer NOT NULL REFERENCES public.contracte_terti(id),
  tip text NOT NULL CHECK (tip IN ('GBE', 'CAR', 'GPL', 'altul')), asigurator text, nr_polita text, valoare_lei numeric(14,2),
  data_emitere date, data_expirare date, pdf_path text, status text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'expirata', 'retrasa', 'anulata')),
  observatii text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.contracte_polite_acte (
  id serial PRIMARY KEY, polita_id integer NOT NULL REFERENCES public.contracte_polite(id) ON DELETE CASCADE, nr_act integer NOT NULL,
  descriere text, valoare_noua_lei numeric(14,2), data_emitere date, data_expirare_noua date, pdf_path text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.contracte_polite ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracte_polite_acte ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_rw ON public.contracte_polite FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY cpa_rw ON public.contracte_polite_acte FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
ALTER TABLE public.contracte_terti ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_sel ON public.contracte_terti FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TABLE public.garantii (id bigserial PRIMARY KEY, forma text, tip text, beneficiar text, contract_numar text, contract_data date, lucrare text, proiect_id bigint,
  licitatie_id bigint, valoare numeric(14,2), moneda text, procent numeric(5,2), trezorerie_cont_id bigint, iban text, banca text, emitent text, numar_document text,
  data_emitere date, data_expirare date, stare text, lucrare_receptionata boolean DEFAULT false, data_receptie date, document_receptie text, data_eliberare date,
  eliberare_solicitata_la date, sursa_document text, observatii text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(),
  contract_terti_id bigint, gbe_polita_id bigint, blocat_litigiu boolean DEFAULT false, litigiu_detalii text,
  CONSTRAINT garantii_tip_check CHECK (tip = ANY (ARRAY['buna_executie'::text, 'participare'::text, 'mentenanta'::text, 'avans'::text, 'car'::text])));
ALTER TABLE public.garantii ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantii_rls_sel ON public.garantii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY garantii_rls_ins ON public.garantii FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_rls_upd ON public.garantii FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));

CREATE TABLE public.executie_proiecte (id serial PRIMARY KEY, nume text, contract_id integer, sef_santier_employee_id integer, mp_employee_id integer, activ boolean DEFAULT true);
ALTER TABLE public.executie_proiecte ENABLE ROW LEVEL SECURITY;
CREATE POLICY ep_sel ON public.executie_proiecte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, profile_id uuid, type text, modul text, title text, message text, link_to text, created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_modul_check CHECK (modul = ANY (ARRAY['general', 'Logistică', 'Pontaj', 'Execuție', 'Financiar', 'Comercial', 'Administrativ', 'HR', 'Tichete', 'Rapoarte', 'Ședințe', 'Ofertare', 'Clădire'])));
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- privilegiile ca pe live: SELECT pe garantii pe coloane (fara iban, 20261006b), scrierea pe tabel
REVOKE ALL ON public.garantii FROM anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.garantii TO authenticated;
GRANT SELECT (id, forma, tip, beneficiar, contract_numar, contract_data, lucrare, proiect_id, licitatie_id, valoare, moneda, procent, trezorerie_cont_id, banca, emitent,
  numar_document, data_emitere, data_expirare, stare, lucrare_receptionata, data_receptie, document_receptie, data_eliberare, eliberare_solicitata_la, sursa_document,
  observatii, created_at, updated_at, contract_terti_id, gbe_polita_id, blocat_litigiu, litigiu_detalii) ON public.garantii TO authenticated;

-- date FICTIVE
INSERT INTO public.employees (id, name, email, active) VALUES
  (1, 'TUDORACHE MARILENA', 'Marilena.Tudorache@gazpet.ro', true),   -- adresa gasita in employees (normalizata)
  (2, 'POPESCU MIRELA', 'mirela.personal@exemplu.test', true),       -- adresa personala: nu se ia; se cauta in conturi
  (3, 'SEF SANTIER TEST', NULL, true),
  (4, 'MANAGER PROIECT TEST', NULL, true);
INSERT INTO public.profiles (id, email, name, is_owner, employee_id, can_manage_contracts) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'owner@gazpet.ro', 'OWNER', true, NULL, false),
  ('00000000-0000-0000-0000-00000000000b', 'fin@gazpet.ro', 'FIN TEST', false, NULL, false),
  ('00000000-0000-0000-0000-00000000000c', 'contracte@gazpet.ro', 'CONTRACTE TEST', false, NULL, true),
  ('00000000-0000-0000-0000-00000000000d', 'viewer@gazpet.ro', 'VIEWER', false, NULL, false),
  ('00000000-0000-0000-0000-00000000000e', 'mirela.popescu@gazpet.ro', 'POPESCU MIRELA', false, 2, false),
  ('00000000-0000-0000-0000-00000000000f', 'sef.santier@gazpet.ro', 'SEF', false, 3, false),
  ('00000000-0000-0000-0000-000000000010', 'mp.extern@exemplu.test', 'MP', false, 4, false);   -- adresa din afara domeniului: nu primeste
INSERT INTO public.contracte_terti (id, numar_contract, denumire, data_semnare, status) VALUES
  (17, '30/2025', 'Lot 1 test', '2025-03-28', 'activ'), (18, '99/2024', 'Fara proiect', '2024-01-10', 'activ');
INSERT INTO public.executie_proiecte (id, nume, contract_id, sef_santier_employee_id, mp_employee_id) VALUES (5, 'PROIECT TEST', 17, 3, 4);
