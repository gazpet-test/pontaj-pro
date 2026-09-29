-- ============================================================================
-- Schelet minim care imită Supabase — teste „ciclul de viață al conturilor” (R1/R2/R3)
-- ============================================================================
-- NU se aplică NICIODATĂ pe producție. Îl încarcă doar scripts/test_conturi_ciclu_viata.sh
-- într-o bază locală efemeră (<nume>_test) pe un PostgreSQL 16 dedicat testelor.
--
-- Sursa: coloane/constrângeri/politici/triggere citite prin SELECT din producție
-- (information_schema, pg_constraint, pg_policies, pg_get_functiondef) la 29.09.2026.
-- Producția: PostgreSQL 17.6, ICU en-US, TimeZone UTC, unaccent în schema `extensions`.
--
-- Fidelitate păstrată intenționat:
--   * auth.uid()/auth.role()/auth.jwt() = definițiile Supabase (claim.sub SAU claims->>'sub');
--   * rolurile anon/authenticated/service_role(BYPASSRLS)/supabase_auth_admin;
--   * GRANT-urile implicite Supabase: orice tabel/funcție NOU(Ă) din public primește
--     ALL/EXECUTE pentru anon+authenticated+service_role (ALTER DEFAULT PRIVILEGES) —
--     deci un tabel nou fără RLS e expus, iar REVOKE ... FROM PUBLIC NU ajunge;
--   * supabase_auth_admin NU are drepturi pe tabelele din public (ca în producție):
--     un trigger pe auth.users care nu e SECURITY DEFINER pică la crearea contului;
--   * triggerele existente pe profiles/employees/notifications/auth.users, copiate verbatim;
--   * politicile RLS din producție pe profiles/employees/user_module_access/
--     hr_personal_extern/notifications, copiate verbatim.
-- Simplificări (documentate):
--   * auth.sessions / auth.refresh_tokens / hr_autorizatii au doar coloanele relevante;
--   * FK-urile spre tabele absente sunt omise: hr_personal_extern.partener_id →
--     ofertare_parteneri (modul Ofertare înghețat), hr_autorizatii.tip_id/document_personal_id;
--   * trg_hr_employees_audit la DELETE numără în pontaj_records/employee_salaries/... care
--     lipsesc aici → își prinde singur eroarea (WARNING), exact ca în producție la eșec;
--   * trg_hr_autorizatie_noua nu e copiat (nerelevant pentru conturi);
--   * „postgres” local e SUPERUSER; în producție postgres e NOSUPERUSER + BYPASSRLS.
--   * tabelele de alocări (comenzi_aprobatori, necesar_responsabili, hr_aprobatori, marketing_aprobatori,
--     hr_concediu_rute, tichete_default_responsabili, hr_recrutare_pozitii) și profile_sites au
--     coloanele/constrângerile/indexurile de producție (subset la hr_recrutare_pozitii); politicile lor
--     necitite sunt înlocuite cu „SELECT pentru logați” (testele scriu în ele ca admin);
--   * auth.users are în producție owner supabase_auth_admin: acolo NU se pot adăuga triggere pe el
--     (local, testele R1-12 pun temporar unul, în tranzacția testului, doar ca să simuleze un profil preexistent).
-- ============================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $garda$
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' THEN
    RAISE EXCEPTION 'Scheletul se încarcă doar într-o bază locală *_test (acum: %)', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth','extensions','teste'))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') THEN
    RAISE EXCEPTION 'Baza de test trebuie să fie goală; scheletul nu șterge nimic';
  END IF;
END $garda$;

-- ---------------------------------------------------------------------------
-- Roluri (globale pe cluster → IF NOT EXISTS; clusterul e dedicat testelor)
-- ---------------------------------------------------------------------------
DO $roluri$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','supabase_auth_admin') AND (rolsuper OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND (rolsuper OR NOT rolbypassrls)) THEN
    RAISE EXCEPTION 'Rolurile API au atribute greșite (SUPERUSER/BYPASSRLS)';
  END IF;
END $roluri$;

-- search_path pe rol ca în producție (aplicat la LOGIN; SET ROLE nu îl preia — vezi teste.creeaza_cont)
DO $cfg$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'UTC');
  EXECUTE format('ALTER ROLE postgres IN DATABASE %I SET search_path = public, extensions, pg_catalog', current_database());
  EXECUTE format('ALTER ROLE anon IN DATABASE %I SET search_path = public, extensions', current_database());
  EXECUTE format('ALTER ROLE authenticated IN DATABASE %I SET search_path = public, extensions', current_database());
  EXECUTE format('ALTER ROLE service_role IN DATABASE %I SET search_path = public, extensions', current_database());
  EXECUTE format('ALTER ROLE supabase_auth_admin IN DATABASE %I SET search_path = auth', current_database());
END $cfg$;
SET search_path = public, extensions, pg_catalog;
SET timezone = 'UTC';

-- ---------------------------------------------------------------------------
-- Extensii (ca în producție: în schema extensions)
-- ---------------------------------------------------------------------------
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION unaccent WITH SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;

-- GRANT-uri implicite Supabase pe schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schema auth (subset GoTrue)
-- ---------------------------------------------------------------------------
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;

CREATE TABLE auth.users (
  instance_id uuid,
  id uuid NOT NULL PRIMARY KEY,
  aud character varying,
  role character varying,
  email character varying,
  encrypted_password character varying,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token character varying,
  confirmation_sent_at timestamptz,
  recovery_token character varying,
  recovery_sent_at timestamptz,
  email_change_token_new character varying,
  email_change character varying,
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text DEFAULT NULL::character varying UNIQUE,
  phone_confirmed_at timestamptz,
  phone_change text DEFAULT ''::character varying,
  phone_change_token character varying DEFAULT ''::character varying,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current character varying DEFAULT ''::character varying,
  email_change_confirm_status smallint DEFAULT 0 CHECK (email_change_confirm_status >= 0 AND email_change_confirm_status <= 2),
  banned_until timestamptz,
  reauthentication_token character varying DEFAULT ''::character varying,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX users_email_partial_key ON auth.users (email) WHERE is_sso_user = false;

CREATE TABLE auth.sessions (
  id uuid NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz,
  updated_at timestamptz,
  factor_id uuid,
  not_after timestamptz,
  refreshed_at timestamp without time zone,
  user_agent text,
  ip inet,
  tag text
);

CREATE TABLE auth.refresh_tokens (
  instance_id uuid,
  id bigserial PRIMARY KEY,
  token character varying UNIQUE,
  user_id character varying,           -- text în GoTrue, NU uuid (capcană la comparații)
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent character varying,
  session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE
);

-- Tabelele auth: doar supabase_auth_admin (ca GoTrue). authenticated/anon NU le văd.
GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;

-- Definițiile Supabase
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$fn$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$fn$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- public: tabele (coloane și constrângeri reale)
-- ---------------------------------------------------------------------------
CREATE TABLE public.sites (
  id serial PRIMARY KEY,
  name text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.app_modules (
  key text NOT NULL PRIMARY KEY,
  parent_key text,
  name text NOT NULL,
  icon text,
  color text,
  description text,
  is_active boolean NOT NULL DEFAULT false,
  display_order integer,
  created_at timestamptz DEFAULT now(),
  show_on_homepage boolean NOT NULL DEFAULT true
);
INSERT INTO public.app_modules (key, name, is_active)
SELECT k, k, true FROM unnest(ARRAY[
  'achizitii','admin_alerte','administrativ','administrativ.consumabile','administrativ.contracte_terti',
  'administrativ.documente','administrativ.furnizori','administrativ.locatii','administrativ.ticketing',
  'administrativ.upa','cladire','comanda_transport','comercial','consumabile','ctc','executie','financiar',
  'hr','hr.autorizatii','hr.personal','hr.recrutare','hr.training','logistica','logistica.active',
  'logistica.alimentari','logistica.documente','logistica.service','logistica.tichete','magazie','marketing',
  'ofertare','pontajpro','pontajpro.diurne','pontajpro.itm','pontajpro.pontaj','pontajpro.salarii',
  'rapoarte_santier','sedinte']) AS k;
UPDATE public.app_modules SET parent_key = split_part(key, '.', 1) WHERE key LIKE '%.%';

CREATE TABLE public.employees (
  id serial PRIMARY KEY,
  name text NOT NULL,
  department text NOT NULL,
  position text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  site_id integer REFERENCES public.sites(id),
  email text,
  iban text,
  hire_date date,
  termination_date date,
  functii_extra text[] DEFAULT '{}'::text[],
  functie text,
  departament_hr text,
  rol_in_firma text,
  telefon text,
  are_autorizatii boolean DEFAULT false,
  observatii_hr text,
  cetatenie text,
  tip_contract text,
  procent_ocupare numeric DEFAULT 100,
  co_maxim_zile integer DEFAULT 21,
  cetatenie_secundara text,
  qr_pin text,
  qr_pin_active boolean NOT NULL DEFAULT false,
  qr_pin_creat_la timestamptz,
  cnp text,
  adresa text,
  data_nasterii date,
  protejat_la_stergere boolean NOT NULL DEFAULT false,
  marime_incaltaminte text,
  marime_imbracaminte text,
  cod_cor text,
  functie_cim text,
  CONSTRAINT employees_cetatenie_chk CHECK (cetatenie IS NULL OR cetatenie = ANY (ARRAY['roman','ue','non_ue'])),
  CONSTRAINT employees_cetatenie_secundara_check CHECK (cetatenie_secundara IS NULL OR cetatenie_secundara = ANY (ARRAY['roman','ue','non_ue'])),
  CONSTRAINT employees_co_maxim_zile_chk CHECK (co_maxim_zile IS NULL OR (co_maxim_zile > 0 AND co_maxim_zile <= 50)),
  CONSTRAINT employees_procent_ocupare_chk CHECK (procent_ocupare IS NULL OR (procent_ocupare > 0 AND procent_ocupare <= 100)),
  CONSTRAINT employees_tip_contract_chk CHECK (tip_contract IS NULL OR tip_contract = ANY (ARRAY['cim_nedeterminat','cim_determinat','part_time']))
);

CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  name text,
  role text NOT NULL DEFAULT 'manager'::text,
  department text,
  created_at timestamptz DEFAULT now(),
  email_notifications_enabled boolean DEFAULT true,
  email_notifications_logistica boolean DEFAULT true,
  can_access_salarii boolean NOT NULL DEFAULT false,
  is_owner boolean NOT NULL DEFAULT false,
  can_access_personal_data boolean NOT NULL DEFAULT false,
  can_access_pontaj_brut boolean NOT NULL DEFAULT false,
  can_modify_employees boolean NOT NULL DEFAULT false,
  phone_whatsapp text,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  whatsapp_tier text NOT NULL DEFAULT 'info'::text,
  receive_tichete_logistica boolean NOT NULL DEFAULT false,
  can_use_document_scanner boolean NOT NULL DEFAULT false,
  receive_tichete_hr boolean NOT NULL DEFAULT false,
  receive_tichete_administrativ boolean NOT NULL DEFAULT false,
  receive_tichete_it boolean NOT NULL DEFAULT false,
  receive_tichete_comercial boolean NOT NULL DEFAULT false,
  receive_tichete_financiar boolean NOT NULL DEFAULT false,
  can_create_comenzi boolean NOT NULL DEFAULT false,
  can_process_achizitii boolean NOT NULL DEFAULT false,
  can_manage_stoc boolean NOT NULL DEFAULT false,
  can_access_ctc boolean NOT NULL DEFAULT false,
  can_manage_contracts boolean NOT NULL DEFAULT false,
  receive_bonuri_consum boolean NOT NULL DEFAULT false,
  can_access_diurne boolean NOT NULL DEFAULT false,
  can_access_financiar boolean NOT NULL DEFAULT false,
  employee_id bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT chk_phone_whatsapp_format CHECK (phone_whatsapp IS NULL OR phone_whatsapp ~ '^\+[0-9]{10,15}$'),
  CONSTRAINT profiles_role_chk CHECK (role = ANY (ARRAY['superadmin','admin_logistica','manager_santier','sef_echipa','contabilitate','hr','gestionar','magazioner'])),
  CONSTRAINT profiles_whatsapp_tier_check CHECK (whatsapp_tier = ANY (ARRAY['critic','manager','hr_contabil','info']))
);
-- Producție: o fișă de angajat are cel mult un cont (index parțial).
CREATE UNIQUE INDEX uniq_profiles_employee_id ON public.profiles USING btree (employee_id) WHERE (employee_id IS NOT NULL);

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

CREATE TABLE public.hr_personal_extern (
  id bigserial PRIMARY KEY,
  nume text NOT NULL,
  functie text,
  firma text,
  cui_firma text,
  telefon text,
  email text,
  observatii text,
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  partener_id bigint            -- FK spre ofertare_parteneri omis intenționat (Ofertare înghețat)
);
CREATE UNIQUE INDEX uq_hr_personal_extern_nume ON public.hr_personal_extern USING btree (lower(btrim(nume)));

CREATE TABLE public.hr_autorizatii (            -- subset de coloane
  id bigserial PRIMARY KEY,
  employee_id bigint REFERENCES public.employees(id) ON DELETE CASCADE,
  tip_id integer,
  numar_autorizatie text,
  data_emitere date,
  data_expirare date,
  observatii text,
  uploadat_de uuid REFERENCES public.profiles(id),
  uploadat_la timestamptz DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id),
  extern_id bigint REFERENCES public.hr_personal_extern(id) ON DELETE CASCADE,
  CONSTRAINT hr_autorizatii_titular_unic CHECK ((employee_id IS NOT NULL) <> (extern_id IS NOT NULL))
);

CREATE TABLE public.hr_employees_audit (
  id bigserial PRIMARY KEY,
  actiune text NOT NULL CHECK (actiune = ANY (ARRAY['INSERT','DELETE'])),
  employee_id integer,
  nume text,
  date_vechi jsonb,
  cascada jsonb,
  facut_de uuid,
  email_autor text,
  creat_la timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  modul text DEFAULT 'general'::text,
  title text NOT NULL,
  message text,
  link_to text,
  read_at timestamptz,
  action_taken boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_modul_check CHECK (modul = ANY (ARRAY['general','Logistică','Pontaj','Execuție','Financiar','Comercial','Administrativ','HR','Tichete','Rapoarte','Ședințe','Ofertare','Clădire']))
);

-- Drepturi pe șantiere (producție: coloane + constrângeri reale; FK granted_by → auth.users).
CREATE TABLE public.profile_sites (
  id serial PRIMARY KEY,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id integer REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  valid_until date,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  CONSTRAINT profile_sites_profile_id_site_id_key UNIQUE (profile_id, site_id)
);

-- Alocări de flux (R2 B.8: doar alertă „Reasignează”). Subset de coloane, constrângeri reale.
CREATE TABLE public.comenzi_aprobatori (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_id bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  rol_afisat text,
  ordine integer NOT NULL DEFAULT 0,
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.necesar_responsabili (
  id bigserial PRIMARY KEY,
  site_id integer NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rol text NOT NULL DEFAULT 'solicitant' CHECK (rol = ANY (ARRAY['solicitant','aprobator'])),
  activ boolean NOT NULL DEFAULT true,
  adaugat_la timestamptz NOT NULL DEFAULT now(),
  adaugat_de uuid REFERENCES public.profiles(id),
  CONSTRAINT necesar_responsabili_unic UNIQUE (site_id, profile_id, rol)
);
CREATE TABLE public.hr_aprobatori (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  tip text NOT NULL CHECK (tip = ANY (ARRAY['mp','sef_birou'])),
  eticheta text,
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_aprobatori_profile_id_tip_key UNIQUE (profile_id, tip)
);
CREATE TABLE public.marketing_aprobatori (
  profile_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  adaugat_la timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hr_concediu_rute (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL UNIQUE REFERENCES public.employees(id),
  aprobator_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  observatii text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tichete_default_responsabili (
  departament text NOT NULL PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hr_recrutare_pozitii (            -- subset de coloane
  id serial PRIMARY KEY,
  cod text UNIQUE,
  denumire text NOT NULL,
  site_id integer REFERENCES public.sites(id),
  status text NOT NULL DEFAULT 'deschisa' CHECK (status = ANY (ARRAY['deschisa','suspendata','inchisa'])),
  responsabil_id uuid REFERENCES public.profiles(id),
  activ boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id)
);

INSERT INTO public.sites (name) VALUES ('Șantier test Ploiești'), ('Șantier test Buzău'), ('Birou test');

-- ---------------------------------------------------------------------------
-- RLS + politici (verbatim din producție acolo unde sunt cunoscute)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sites               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_modules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_personal_extern  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_autorizatii      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employees_audit  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_sites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comenzi_aprobatori  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.necesar_responsabili ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_aprobatori       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_aprobatori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_concediu_rute    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tichete_default_responsabili ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_recrutare_pozitii ENABLE ROW LEVEL SECURITY;

-- profile_sites / comenzi_aprobatori: verbatim din producție
CREATE POLICY profile_sites_delete_owner ON public.profile_sites FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY profile_sites_insert_owner ON public.profile_sites FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY profile_sites_select_authenticated ON public.profile_sites FOR SELECT TO authenticated USING (true);
CREATE POLICY profile_sites_update_owner ON public.profile_sites FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY ca_select ON public.comenzi_aprobatori FOR SELECT TO authenticated USING (true);
CREATE POLICY ca_write ON public.comenzi_aprobatori FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner = true));
-- celelalte tabele de alocări: politici de producție necitite → doar citire pentru logați (testele scriu ca admin)
CREATE POLICY schelet_necesar_responsabili_select ON public.necesar_responsabili FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_hr_aprobatori_select ON public.hr_aprobatori FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_marketing_aprobatori_select ON public.marketing_aprobatori FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_hr_concediu_rute_select ON public.hr_concediu_rute FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_tichete_default_resp_select ON public.tichete_default_responsabili FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_hr_recrutare_pozitii_select ON public.hr_recrutare_pozitii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- sites / app_modules / hr_autorizatii: politici de producție necitite → doar citire pentru logați
CREATE POLICY schelet_sites_select ON public.sites FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_app_modules_select ON public.app_modules FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY schelet_hr_autorizatii_select ON public.hr_autorizatii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY employees_delete_owner ON public.employees FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY employees_insert_authorized ON public.employees FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner = true OR profiles.can_modify_employees = true)));
CREATE POLICY employees_select_all_authenticated ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY employees_update_authorized ON public.employees FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner = true OR profiles.can_modify_employees = true)))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner = true OR profiles.can_modify_employees = true)));

CREATE POLICY hr_personal_extern_insert ON public.hr_personal_extern FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY hr_personal_extern_select ON public.hr_personal_extern FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY hr_personal_extern_update ON public.hr_personal_extern FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY notifications_delete_own_or_owner ON public.notifications FOR DELETE TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY notifications_insert_authenticated ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY notifications_select_own_or_owner ON public.notifications FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY notifications_update_own_or_owner ON public.notifications FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true))
  WITH CHECK (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));

CREATE POLICY profiles_delete_owner ON public.profiles FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_owner = true));
CREATE POLICY profiles_insert_owner ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_owner = true));
CREATE POLICY profiles_select_all_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update_owner ON public.profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_owner = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_owner = true));

CREATE POLICY user_module_access_delete_owner ON public.user_module_access FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY user_module_access_insert_owner ON public.user_module_access FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));
CREATE POLICY user_module_access_select_authenticated ON public.user_module_access FOR SELECT TO authenticated USING (true);
CREATE POLICY user_module_access_update_owner ON public.user_module_access FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner = true));

-- ---------------------------------------------------------------------------
-- Funcții + triggere existente (verbatim din producție, 29.09.2026)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Inserăm doar dacă nu există deja (idempotent)
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    -- Nume default: prima parte a emailului, „Title Case" (înlocuim . și _ cu spațiu)
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'manager_santier'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Skip pentru service_role / migrări (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Verifică modificare role
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar owners pot schimba rolul (incercat: % → %)', OLD.role, NEW.role;
    END IF;
  END IF;
  
  -- Verifică modificare is_owner
  IF OLD.is_owner IS DISTINCT FROM NEW.is_owner THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar owners pot schimba flag-ul is_owner';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;
CREATE TRIGGER prevent_role_escalation_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

CREATE OR REPLACE FUNCTION public.enforce_owner_only_salary_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner = true) THEN
    NEW.is_owner := OLD.is_owner;
    NEW.can_access_salarii := OLD.can_access_salarii;
    NEW.can_access_personal_data := OLD.can_access_personal_data;
    NEW.can_access_pontaj_brut := OLD.can_access_pontaj_brut;
    NEW.can_modify_employees := OLD.can_modify_employees;
    NEW.can_manage_contracts := OLD.can_manage_contracts;
    NEW.can_access_diurne := OLD.can_access_diurne;
    NEW.can_access_financiar := OLD.can_access_financiar;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_enforce_owner_only_salary_flags BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_only_salary_flags();

CREATE OR REPLACE FUNCTION public.protect_can_access_pontaj_brut()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Skip check pentru service role (auth.uid() returnează NULL)
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  
  IF (OLD.can_access_pontaj_brut IS DISTINCT FROM NEW.can_access_pontaj_brut) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar OWNER poate modifica can_access_pontaj_brut';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_protect_can_access_pontaj_brut BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_can_access_pontaj_brut();

CREATE OR REPLACE FUNCTION public.trg_employees_protectie_stergere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.protejat_la_stergere THEN
    RAISE EXCEPTION
      'Angajatul % (id %) este PROTEJAT la stergere. Stergerea lui ar duce in cascada pontajul, salariile, autorizatiile, documentele si semnaturile, iar readaugarea creeaza alt id. Daca chiar vrei sa-l stergi: UPDATE public.employees SET protejat_la_stergere = false WHERE id = %;',
      OLD.name, OLD.id, OLD.id
      USING ERRCODE = 'raise_exception',
            HINT = 'Pentru teste foloseste un angajat de proba, nu unul cu istoric.';
  END IF;
  RETURN OLD;
END;
$function$;
CREATE TRIGGER trg_employees_0_protectie BEFORE DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.trg_employees_protectie_stergere();

CREATE OR REPLACE FUNCTION public.trg_hr_employees_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text;
  v_casc  jsonb;
BEGIN
  -- Auditul nu are voie sa blocheze niciodata operatia de business.
  BEGIN
    SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

    IF TG_OP = 'DELETE' THEN
      SELECT jsonb_build_object(
               'pontaj_records',          (SELECT count(*) FROM public.pontaj_records          WHERE employee_id = OLD.id),
               'employee_salaries',       (SELECT count(*) FROM public.employee_salaries       WHERE employee_id = OLD.id),
               'hr_autorizatii',          (SELECT count(*) FROM public.hr_autorizatii          WHERE employee_id = OLD.id),
               'hr_documente_personale',  (SELECT count(*) FROM public.hr_documente_personale  WHERE employee_id = OLD.id),
               'hr_semnaturi_electronice',(SELECT count(*) FROM public.hr_semnaturi_electronice WHERE employee_id = OLD.id))
        INTO v_casc;
      INSERT INTO public.hr_employees_audit (actiune, employee_id, nume, date_vechi, cascada, facut_de, email_autor)
      VALUES ('DELETE', OLD.id, OLD.name, to_jsonb(OLD), v_casc, auth.uid(), v_email);
    ELSE
      INSERT INTO public.hr_employees_audit (actiune, employee_id, nume, facut_de, email_autor)
      VALUES ('INSERT', NEW.id, NEW.name, auth.uid(), v_email);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit angajati esuat: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE TRIGGER trg_employees_audit_del BEFORE DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.trg_hr_employees_audit();
CREATE TRIGGER trg_employees_audit_ins AFTER INSERT ON public.employees FOR EACH ROW EXECUTE FUNCTION public.trg_hr_employees_audit();

CREATE OR REPLACE FUNCTION public.fn_employees_termination_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count_aut INTEGER;
  v_data_str TEXT;
BEGIN
  -- Detect setare nouă termination_date (NULL → SET sau schimbare)
  IF (OLD.termination_date IS NULL AND NEW.termination_date IS NOT NULL)
     OR (OLD.termination_date IS NOT NULL 
         AND NEW.termination_date IS NOT NULL 
         AND OLD.termination_date <> NEW.termination_date) THEN
    
    -- Auto-deactivate dacă data trecuta sau azi
    IF NEW.termination_date <= CURRENT_DATE THEN
      NEW.active := false;
    END IF;
    
    -- Count autorizații active pentru notificare
    SELECT COUNT(*) INTO v_count_aut
    FROM hr_autorizatii
    WHERE employee_id = NEW.id AND deleted_at IS NULL;
    
    -- Notificare doar dacă există autorizații (altfel nu are sens)
    IF v_count_aut > 0 THEN
      v_data_str := TO_CHAR(NEW.termination_date, 'DD.MM.YYYY');
      
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      SELECT 
        p.id,
        'hr_contract_inchis_autorizatii',
        'HR',
        '📦 Mută autorizațiile în arhivă',
        v_count_aut || ' autorizații pentru ' || NEW.name 
          || ' (contract încheiat la ' || v_data_str || ')',
        '/hr?tab=arhiva'
      FROM profiles p
      WHERE p.is_owner = true OR p.can_access_personal_data = true;
    END IF;
  END IF;
  
  -- Detect ștergere termination_date (re-activare contract)
  IF OLD.termination_date IS NOT NULL AND NEW.termination_date IS NULL THEN
    -- Marchez notificările legate ca rezolvate
    UPDATE public.notifications
    SET action_taken = true, read_at = COALESCE(read_at, NOW())
    WHERE type = 'hr_contract_inchis_autorizatii'
      AND message LIKE '%' || NEW.name || '%'
      AND action_taken IS NOT TRUE;
  END IF;
  
  RETURN NEW;
END;
$function$;
-- Ordine triggere BEFORE UPDATE = alfabetică după nume: un trigger nou care trebuie să vadă
-- NEW.active pus de acesta trebuie să fie AFTER UPDATE sau să aibă nume > 'trg_employees_termination_notify'.
CREATE TRIGGER trg_employees_termination_notify BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.fn_employees_termination_notify();

-- Copie de fidelitate (trigger existent pe notifications); nu se modifică.
CREATE OR REPLACE FUNCTION public.fn_notificari_ruteaza_ofertare()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(NEW.link_to,'') LIKE '/ofertare%' AND NEW.modul <> 'Ofertare' THEN
    NEW.modul := 'Ofertare';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_notificari_ruteaza_ofertare BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.fn_notificari_ruteaza_ofertare();

-- ---------------------------------------------------------------------------
-- Schema teste: utilitare DOAR pentru harness (nu există în producție)
-- ---------------------------------------------------------------------------
CREATE SCHEMA teste;
GRANT USAGE ON SCHEMA teste TO anon, authenticated, service_role, supabase_auth_admin;

-- Aserțiune: eșecul oprește fișierul (ON_ERROR_STOP) → exit ≠ 0.
CREATE FUNCTION teste.assert(p_ok boolean, p_mesaj text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ESEC TEST: %', p_mesaj USING ERRCODE = 'P0T01';
  END IF;
  RAISE NOTICE 'OK   %', p_mesaj;
END $fn$;

-- Rulează p_sql și cere să EȘUEZE (opțional cu SQLSTATE / fragment din mesaj).
-- Rulează cu identitatea curentă (nu e SECURITY DEFINER) → RLS/triggere se aplică real.
CREATE FUNCTION teste.asteapta_eroare(p_sql text, p_mesaj text, p_sqlstate text DEFAULT NULL, p_fragment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF p_sqlstate IS NOT NULL AND v_state <> p_sqlstate THEN
      RAISE EXCEPTION 'ESEC TEST: % — SQLSTATE % în loc de % (%)', p_mesaj, v_state, p_sqlstate, v_msg USING ERRCODE = 'P0T01';
    END IF;
    IF p_fragment IS NOT NULL AND position(p_fragment IN v_msg) = 0 THEN
      RAISE EXCEPTION 'ESEC TEST: % — mesaj neașteptat: %', p_mesaj, v_msg USING ERRCODE = 'P0T01';
    END IF;
    RAISE NOTICE 'OK   % (refuzat: %)', p_mesaj, v_state;
    RETURN;
  END;
  RAISE EXCEPTION 'ESEC TEST: % — trebuia să eșueze, dar a reușit: %', p_mesaj, p_sql USING ERRCODE = 'P0T01';
END $fn$;

-- Rulează p_sql; întoarce NULL la succes sau {state, msg, hint, detail} la eroare (pentru HINT-uri).
CREATE FUNCTION teste.eroare(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text; v_hint text; v_detail text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('state', v_state, 'msg', v_msg, 'hint', v_hint, 'detail', v_detail);
  END;
  RETURN NULL;
END $fn$;

-- Identitate PostgREST: claims JWT + SET ROLE authenticated (session_user rămâne postgres).
CREATE FUNCTION teste.ca_utilizator(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  EXECUTE 'SET ROLE authenticated';
END $fn$;

-- Cheia anon (JWT valid, fără sub) — pentru a verifica porțile de rol (CLAUDE.md pct. 7d).
CREATE FUNCTION teste.ca_anon() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', 'anon', false);
  EXECUTE 'SET ROLE anon';
END $fn$;

-- service_role: BYPASSRLS, auth.uid() NULL (ca edge functions cu cheia service).
CREATE FUNCTION teste.ca_service_role() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  EXECUTE 'SET ROLE service_role';
END $fn$;

-- Înapoi la admin (postgres, auth.uid() NULL) — ca migrările / pg_cron.
CREATE FUNCTION teste.ca_admin() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', '', false);
END $fn$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role, supabase_auth_admin;

-- Simulează crearea unui cont de către GoTrue: INSERT în auth.users ca supabase_auth_admin
-- cu search_path=auth (ca pe conexiunea reală) → declanșează on_auth_user_created.
-- Adaugă și o sesiune + un refresh token nerevocat (pentru testele de revocare R2).
-- Se apelează ca admin. p_app_meta se adaugă la raw_app_meta_data (în GoTrue îl poate pune DOAR API-ul admin,
-- cu service_role — ex. {"gazpet_legare_automata": true} = calea de încredere R1; signUp public nu-l poate seta).
CREATE FUNCTION teste.creeaza_cont(p_email text, p_uid uuid DEFAULT gen_random_uuid(), p_meta jsonb DEFAULT '{}'::jsonb,
                                   p_app_meta jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_sp text := current_setting('search_path'); v_sesiune uuid := gen_random_uuid();
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'teste.creeaza_cont se apelează ca admin (acum current_user=%)', current_user;
  END IF;
  PERFORM set_config('search_path', 'auth', false);
  EXECUTE 'SET ROLE supabase_auth_admin';
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  VALUES (p_uid, 'authenticated', 'authenticated', p_email, p_meta, '{"provider":"email"}'::jsonb || p_app_meta, now(), now(), now());
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (v_sesiune, p_uid, now(), now());
  INSERT INTO auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
  VALUES (replace(gen_random_uuid()::text, '-', ''), p_uid::text, false, now(), now(), v_sesiune);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('search_path', v_sp, false);
  RETURN p_uid;
END $fn$;
REVOKE EXECUTE ON FUNCTION teste.creeaza_cont(text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
-- Calea de încredere R1 (contul creat de owner prin API-ul admin): legare automată la creare.
CREATE FUNCTION teste.creeaza_cont_owner(p_email text, p_uid uuid DEFAULT gen_random_uuid())
RETURNS uuid LANGUAGE sql AS $fn$
  SELECT teste.creeaza_cont(p_email, p_uid, '{}'::jsonb, '{"gazpet_legare_automata": true}'::jsonb)
$fn$;
REVOKE EXECUTE ON FUNCTION teste.creeaza_cont_owner(text, uuid) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Copie EXACTĂ a comenzii pg_cron „hr_auto_deactivate_terminated” (cron.job 13, zilnic 04:00 UTC).
-- Rulează ca admin (auth.uid() NULL), ca pg_cron în producție.
CREATE FUNCTION teste.cron_hr_auto_deactivate_terminated() RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_n integer;
BEGIN
  IF current_user <> session_user OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'cron-ul rulează ca admin fără JWT; apelează întâi teste.ca_admin()';
  END IF;
        UPDATE public.employees
        SET active = false
        WHERE active = true
          AND termination_date IS NOT NULL
          AND termination_date <= CURRENT_DATE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION teste.cron_hr_auto_deactivate_terminated() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- GRANT-uri pe obiectele create înainte de ALTER DEFAULT PRIVILEGES (ca în Supabase)
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
-- ACL-uri citite din producție (29.09): funcțiile de trigger existente au EXECUTE doar pentru
-- postgres + service_role ({postgres=X/postgres,service_role=X/postgres}).
REVOKE EXECUTE ON FUNCTION public.handle_new_user(), public.prevent_role_escalation(),
  public.enforce_owner_only_salary_flags(), public.protect_can_access_pontaj_brut(),
  public.fn_employees_termination_notify() FROM PUBLIC, anon, authenticated;

RESET client_min_messages;
\echo 'SCHELET OK: auth + public (profiles/employees/user_module_access/profile_sites/hr_personal_extern/notifications/alocări) + teste.*'
