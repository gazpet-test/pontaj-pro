-- Schelet minim (NU se aplică pe producție) pentru scripts/test_hr_decizii.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261018a de pe live (06.10.2026): rolurile Supabase + default privileges (ALL pe obiectele noi
-- pentru anon/authenticated/service_role), auth.uid() din request.jwt.claims, storage.buckets/objects (RLS),
-- tabelele atinse (doar coloanele folosite), politicile completari_ins/completari_sel verbatim, fn_completare_aplica
-- versiunea revizuită 47a75428 (încărcată de harness din docs/sec_f2_whitelist), date sintetice de test.
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

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL,
  owner_id text DEFAULT (auth.uid())::text, metadata jsonb, created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
INSERT INTO storage.buckets (id, name) VALUES ('executie-contracte', 'executie-contracte'), ('alt-bucket', 'alt-bucket');
CREATE POLICY alt_bucket_all ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'alt-bucket') WITH CHECK (bucket_id = 'alt-bucket');

CREATE TABLE public.app_modules (key text PRIMARY KEY, parent_key text, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
INSERT INTO public.app_modules (key, name) VALUES ('hr','HR'), ('executie','Execuție'), ('hr.personal','Personal');
CREATE TABLE public.employees (id integer PRIMARY KEY, name text NOT NULL, department text NOT NULL DEFAULT 'x', active boolean,
  termination_date date);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text NOT NULL DEFAULT 'user', department text,
  is_owner boolean NOT NULL DEFAULT false, can_manage_contracts boolean NOT NULL DEFAULT false, employee_id bigint);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL REFERENCES public.app_modules(key), access_level text NOT NULL);
CREATE TABLE public.executie_proiecte (id bigint PRIMARY KEY, nume text, beneficiar text, activ boolean, nr_contract text, data_contract date,
  data_termen date, updated_at timestamptz, rte_employee_id integer REFERENCES public.employees(id), rts_employee_id integer REFERENCES public.employees(id),
  mp_employee_id integer REFERENCES public.employees(id), coordonator_transgaz text, garantie_buna_exec_pct numeric, penalitati_zi_pct numeric,
  valoare_lei numeric, valoare_eur numeric, data_start date, durata_contract_luni integer, beneficiar_final text, lungime_proiect_m numeric,
  sef_santier_employee_id integer REFERENCES public.employees(id));
ALTER TABLE public.executie_proiecte ENABLE ROW LEVEL SECURITY;
CREATE POLICY executie_proiecte_select ON public.executie_proiecte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.executie_completari_propuse (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL, camp text NOT NULL, valoare text NOT NULL,
  valoare_afisata text, sursa text NOT NULL, sursa_detaliu text, dovada_path text, confidenta integer CHECK (confidenta BETWEEN 0 AND 100), motiv text,
  status text NOT NULL DEFAULT 'propus' CHECK (status IN ('propus','confirmat','respins','expirat')), decis_de uuid, decis_la timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.executie_completari_propuse ENABLE ROW LEVEL SECURITY;
CREATE POLICY completari_ins ON public.executie_completari_propuse FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.is_owner OR p.can_manage_contracts)));
CREATE POLICY completari_sel ON public.executie_completari_propuse FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.hr_autorizatii_tipuri (id integer PRIMARY KEY, cod text NOT NULL, denumire text NOT NULL DEFAULT 'x', categorie text NOT NULL DEFAULT 'x');
CREATE TABLE public.hr_autorizatii (id bigserial PRIMARY KEY, employee_id bigint, tip_id integer, numar_autorizatie text, emitent text, data_emitere date,
  data_expirare date, fara_expirare boolean, domenii text[], deleted_at timestamptz, inlocuita_de_id bigint, verificat_pe_scan boolean NOT NULL DEFAULT false,
  uploadat_de uuid);
CREATE TABLE public.isc_rte_domenii (cod text PRIMARY KEY, denumire text NOT NULL, activ boolean NOT NULL DEFAULT true);

-- ─── date sintetice ───
INSERT INTO public.employees (id, name, active, termination_date) VALUES
  (121,'TRUSU RAZVAN MIHAIL',true,NULL), (90,'PANTEA CONSTANTIN',true,NULL), (125,'TUDORACHE MARILENA CLAUDIA',true,NULL),
  (126,'UDREA NATALIA ELENA',true,NULL), (81,'NICA EUGEN',true,NULL), (200,'DADULESCU COSMIN GRIGORAS',true,NULL),
  (201,'POPESCU ION',true,NULL), (202,'INACTIV VASILE',false,'2026-01-01'), (203,'IONESCU MARIA',true,NULL);
INSERT INTO public.profiles (id, name, role, department, is_owner, can_manage_contracts, employee_id) VALUES
  ('00000000-0000-0000-0000-000000000121','Trusu','superadmin','Administrativ',true,false,121),
  ('00000000-0000-0000-0000-000000000125','Tudorache','superadmin',NULL,true,false,125),
  ('00000000-0000-0000-0000-000000000126','Udrea','superadmin','HR',false,false,126),
  ('00000000-0000-0000-0000-000000000090','Pantea','superadmin','Administrativ',false,false,90),
  ('00000000-0000-0000-0000-0000000000e1','Exec','manager_santier','Ofertare',false,false,201),
  ('00000000-0000-0000-0000-0000000000c1','CMC','manager_santier','Ofertare',false,true,203),
  ('00000000-0000-0000-0000-0000000000c2','Claude','admin','IT',false,true,NULL),
  ('00000000-0000-0000-0000-0000000000a1','HrEditor','manager_santier','Ofertare',false,false,NULL),
  ('00000000-0000-0000-0000-0000000000a2','HrSiExec','contabilitate','Contabilitate',false,false,NULL),
  ('00000000-0000-0000-0000-0000000000f0','TestFaraModul','user',NULL,false,false,NULL);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-0000000000e1','executie','editor'),
  ('00000000-0000-0000-0000-0000000000a1','hr','editor'),
  ('00000000-0000-0000-0000-0000000000a2','hr','editor'), ('00000000-0000-0000-0000-0000000000a2','executie','viewer');
INSERT INTO public.executie_proiecte (id, nume, beneficiar, activ, nr_contract, data_contract, data_termen) VALUES
  (32,'Instalatie tehnologica de suprafata la Sonda 16 MIRONU','Romgaz',true,'52675','2026-09-21','2027-06-30'),
  (33,'Proiect inactiv','X',false,'1','2025-01-01',NULL),
  (34,'Proiect fara contract','Y',true,NULL,NULL,NULL);
INSERT INTO public.hr_autorizatii_tipuri (id, cod) VALUES (30,'RTE'), (7,'RSVTI'), (31,'RTS'), (55,'RTE_MONTAJ_IT'), (35,'COORDONATOR_SSM_90'),
  (38,'MANAGER_PROIECT_240'), (32,'CADRU_TEHNIC_PSI');
INSERT INTO public.hr_autorizatii (id, employee_id, tip_id, numar_autorizatie, emitent, data_emitere, data_expirare, fara_expirare, domenii, verificat_pe_scan) VALUES
  (1, 200, 30, '00004386', 'ISC', '2024-08-12', '2029-08-12', false, ARRAY['1.1 – Construcții civile'], true),
  (2, 201, 30, '123', 'ISC', '2020-01-01', '2025-01-01', false, ARRAY['8.4 (D)'], false),
  (3, 81, 7, 'R-77', 'ISCIR', '2024-01-01', NULL, true, NULL, true);
SELECT setval('public.hr_autorizatii_id_seq', 10);
INSERT INTO public.isc_rte_domenii (cod, denumire) VALUES ('1.1','Construcții civile, industriale și agricole'),
  ('8.4','Rețele de gaze naturale combustibile'), ('9.1','Construcții edilitare și de gospodărie comunală');

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);

-- helpers de test (schema teste; invoker — rulează cu rolul curent)
CREATE SCHEMA teste;
GRANT USAGE ON SCHEMA teste TO anon, authenticated, service_role;
CREATE FUNCTION teste.ca(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  SET ROLE authenticated;
END $$;
-- rulează p_sql și cere o eroare care conține p_fragment (sau orice eroare dacă p_fragment e NULL)
CREATE FUNCTION teste.eroare(p_eticheta text, p_sql text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_fragment IS NOT NULL AND position(lower(p_fragment) IN lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION 'TEST % : eroare diferita: % (asteptat: %)', p_eticheta, SQLERRM, p_fragment;
    END IF;
    RAISE NOTICE 'OK   %', p_eticheta;
    RETURN;
  END;
  RAISE EXCEPTION 'TEST % : a trecut, asteptam eroare (%)', p_eticheta, p_fragment;
END $$;
CREATE FUNCTION teste.e(p_eticheta text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'TEST % : esuat', p_eticheta; END IF;
  RAISE NOTICE 'OK   %', p_eticheta;
END $$;
-- „urcă” un obiect în storage ca utilizatorul curent (trece prin politicile de pe storage.objects)
CREATE FUNCTION teste.urca(p_name text, p_mime text DEFAULT 'application/pdf', p_size bigint DEFAULT 1000) RETURNS void LANGUAGE sql AS $$
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('hr-decizii', p_name, jsonb_build_object('mimetype', p_mime, 'size', p_size)) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role;
