-- ============================================================================
-- Schelet minim care imită producția — teste „SEC RSVTI” (patch-ul P1 / constatarea (1)).
-- ============================================================================
-- NU se aplică NICIODATĂ pe producție. Îl încarcă doar scripts/test_sec_rsvti.sh într-o bază
-- locală efemeră (*_test) pe un PostgreSQL 16 dedicat (implicit /tmp/pg_sec_rsvti, 127.0.0.1:5442).
--
-- Sursa (citită read-only din producție pe 29.09.2026: information_schema, pg_constraint,
-- pg_policies, pg_get_functiondef, pg_trigger, relacl/proacl, pg_default_acl):
--   * profiles: coloanele folosite de politici/triggere, constrângerea de rol, cele 5 politici și
--     cele 4 triggere BEFORE UPDATE de azi (inclusiv S-A trg_profiles_campuri_owner_only, aplicat
--     live la 29.09 20:21 UTC) — corpurile funcțiilor sunt byte-identice (md5(prosrc) verificat mai jos);
--   * hr_autorizatii_tipuri, hr_autorizatii, hr_autorizatii_rsvti_confirmari: toate coloanele,
--     constrângerile, indexurile jurnalului, politicile și ACL-urile de azi;
--   * confirm_hr_autorizatie_rsvti(bigint,date,text): definiția LIVE („înainte”), ACL identic.
-- Simplificări (documentate):
--   * employees / hr_personal_extern / hr_documente_personale / auth.users: doar coloanele cheie;
--   * trg_hr_autorizatie_noua (AFTER INSERT pe hr_autorizatii → notificări) nu e copiat: RPC-ul nu
--     inserează în hr_autorizatii, iar testele nu depind de notificări;
--   * „postgres” local e SUPERUSER; în producție e NOSUPERUSER + BYPASSRLS — ambele ocolesc RLS,
--     deci funcțiile SECURITY DEFINER se comportă la fel;
--   * setările implicite de GRANT: ca în producție pentru postgres în public (tabele/secvențe → anon,
--     authenticated, service_role; funcții → service_role + EXECUTE-ul implicit al lui PUBLIC).
-- ============================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $garda$
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' THEN
    RAISE EXCEPTION 'Scheletul se încarcă doar într-o bază locală *_test (acum: %)', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth','teste'))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') THEN
    RAISE EXCEPTION 'Baza de test trebuie să fie goală; scheletul nu șterge nimic';
  END IF;
END $garda$;

DO $roluri$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND (rolsuper OR NOT rolbypassrls)) THEN
    RAISE EXCEPTION 'Rolurile API au atribute greșite (SUPERUSER/BYPASSRLS)';
  END IF;
END $roluri$;

DO $cfg$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'UTC'); END $cfg$;
SET timezone = 'UTC';
SET search_path = public, pg_catalog;

-- GRANT-uri implicite ca în producție (pg_default_acl pentru postgres în public, citit 29.09)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ---------------------------------------------------------------------------
-- auth (subset GoTrue) + definițiile Supabase ale auth.uid()/role()/jwt()
-- ---------------------------------------------------------------------------
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid NOT NULL PRIMARY KEY, email text);
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
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public: tabele de sprijin (subset)
-- ---------------------------------------------------------------------------
CREATE TABLE public.employees (id bigserial PRIMARY KEY, name text);
CREATE TABLE public.hr_personal_extern (id bigserial PRIMARY KEY, nume text);
CREATE TABLE public.hr_documente_personale (id bigserial PRIMARY KEY, fisier_path text, fisier_nume text, deleted_at timestamptz);

-- profiles: coloanele citite de politici și de triggerele live (subset din 31 de coloane)
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY,
  email text,
  name text,
  role text NOT NULL DEFAULT 'manager'::text,
  department text,
  can_access_salarii boolean NOT NULL DEFAULT false,
  is_owner boolean NOT NULL DEFAULT false,
  can_access_personal_data boolean NOT NULL DEFAULT false,
  can_access_pontaj_brut boolean NOT NULL DEFAULT false,
  can_modify_employees boolean NOT NULL DEFAULT false,
  can_manage_contracts boolean NOT NULL DEFAULT false,
  can_access_diurne boolean NOT NULL DEFAULT false,
  can_access_financiar boolean NOT NULL DEFAULT false,
  can_manage_stoc boolean NOT NULL DEFAULT false,
  employee_id bigint,
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL,
  CONSTRAINT profiles_role_chk CHECK ((role = ANY (ARRAY['superadmin'::text, 'admin_logistica'::text, 'manager_santier'::text, 'sef_echipa'::text, 'contabilitate'::text, 'hr'::text, 'gestionar'::text, 'magazioner'::text])))
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_delete_owner ON public.profiles FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1 FROM profiles p2 WHERE ((p2.id = auth.uid()) AND (p2.is_owner = true)))));
CREATE POLICY profiles_insert_owner ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p2 WHERE ((p2.id = auth.uid()) AND (p2.is_owner = true)))));
CREATE POLICY profiles_select_all_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_update_owner ON public.profiles FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1 FROM profiles p2 WHERE ((p2.id = auth.uid()) AND (p2.is_owner = true)))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p2 WHERE ((p2.id = auth.uid()) AND (p2.is_owner = true)))));

-- Triggerele live de pe profiles = „sursa drepturilor” porții (corpuri byte-identice cu producția)
CREATE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
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
$fn$;

CREATE FUNCTION public.enforce_owner_only_salary_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
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
$fn$;

CREATE FUNCTION public.protect_can_access_pontaj_brut()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
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
$fn$;

CREATE FUNCTION public.fn_profiles_campuri_owner_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_camp   text;
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
BEGIN
  v_camp := CASE
    WHEN NEW.department  IS DISTINCT FROM OLD.department  THEN 'department'
    WHEN NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN 'employee_id'
  END;
  IF v_camp IS NULL THEN
    RETURN NEW;                                   -- nicio coloană protejată schimbată
  END IF;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                       nullif(current_setting('request.jwt.claim', true), ''))::jsonb;
  v_rol := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  v_sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub');

  IF v_rol IS NULL AND v_sub IS NULL THEN
    -- fără context de cerere: conexiune directă la BD
    IF session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (conexiune fără identitate autorizată: %)', v_camp, session_user
      USING ERRCODE = '42501';
  END IF;

  IF v_rol = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF v_rol = 'authenticated' AND v_sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = v_sub AND is_owner IS TRUE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil', v_camp USING ERRCODE = '42501';
END $fn$;

REVOKE ALL ON FUNCTION public.prevent_role_escalation(), public.enforce_owner_only_salary_flags(),
  public.protect_can_access_pontaj_brut() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_profiles_campuri_owner_only() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER prevent_role_escalation_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_enforce_owner_only_salary_flags BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION enforce_owner_only_salary_flags();
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION fn_profiles_campuri_owner_only();
CREATE TRIGGER trg_protect_can_access_pontaj_brut BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_can_access_pontaj_brut();

-- ---------------------------------------------------------------------------
-- hr_autorizatii_tipuri (toate coloanele live)
-- ---------------------------------------------------------------------------
CREATE TABLE public.hr_autorizatii_tipuri (
  id serial NOT NULL,
  cod text NOT NULL,
  denumire text NOT NULL,
  detaliere text,
  categorie text NOT NULL DEFAULT 'profesional'::text,
  perioada_default_luni integer,
  emitent_default text,
  necesita_procedura boolean DEFAULT false,
  necesita_subcategorie boolean DEFAULT false,
  ordine integer DEFAULT 100,
  activ boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  necesita_calitate_material boolean DEFAULT false,
  necesita_domenii boolean DEFAULT false,
  necesita_confirmare_rsvti boolean DEFAULT false,
  interval_confirmare_rsvti_luni integer DEFAULT 6,
  calificare_denumire text,
  cod_cor text,
  CONSTRAINT hr_autorizatii_tipuri_pkey PRIMARY KEY (id),
  CONSTRAINT hr_autorizatii_tipuri_cod_key UNIQUE (cod)
);
ALTER TABLE public.hr_autorizatii_tipuri ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_autorizatii_tipuri_write_authorized ON public.hr_autorizatii_tipuri TO authenticated
  USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.is_owner = true) OR (p.can_modify_employees = true) OR (p.role = 'superadmin'::text) OR (p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text])))))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.is_owner = true) OR (p.can_modify_employees = true) OR (p.role = 'superadmin'::text) OR (p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text])))))));
CREATE POLICY tipuri_read_all ON public.hr_autorizatii_tipuri FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- hr_autorizatii (toate coloanele live)
-- ---------------------------------------------------------------------------
CREATE TABLE public.hr_autorizatii (
  id bigserial NOT NULL,
  employee_id bigint,
  tip_id integer,
  numar_autorizatie text,
  emitent text,
  data_emitere date,
  data_expirare date,
  fara_expirare boolean DEFAULT false,
  procedeu_sudura text,
  diametru_teava_mm numeric,
  subcategorie text,
  fisier_path text,
  fisier_nume text,
  fisier_size_bytes bigint,
  observatii text,
  uploadat_de uuid,
  uploadat_la timestamptz DEFAULT now(),
  modificat_la timestamptz DEFAULT now(),
  calitate_material text,
  domenii text[],
  fisier_mime text,
  deleted_at timestamptz,
  deleted_by uuid,
  rsvti_ultima_confirmare date,
  rsvti_urmatoarea_confirmare date,
  rsvti_confirmat_de uuid,
  rsvti_confirmat_la timestamptz,
  rsvti_observatii text,
  extern_id bigint,
  verificat_pe_scan boolean NOT NULL DEFAULT false,
  verificat_pe_scan_la timestamptz,
  verificat_pe_scan_de text,
  document_personal_id bigint,
  inlocuita_de_id bigint,
  inlocuita_la timestamptz,
  CONSTRAINT hr_autorizatii_pkey PRIMARY KEY (id),
  CONSTRAINT hr_autorizatii_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id),
  CONSTRAINT hr_autorizatii_document_personal_id_fkey FOREIGN KEY (document_personal_id) REFERENCES public.hr_documente_personale(id) ON DELETE SET NULL,
  CONSTRAINT hr_autorizatii_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE,
  CONSTRAINT hr_autorizatii_extern_id_fkey FOREIGN KEY (extern_id) REFERENCES public.hr_personal_extern(id) ON DELETE CASCADE,
  CONSTRAINT hr_autorizatii_inlocuita_de_id_fkey FOREIGN KEY (inlocuita_de_id) REFERENCES public.hr_autorizatii(id) ON DELETE SET NULL,
  CONSTRAINT hr_autorizatii_tip_id_fkey FOREIGN KEY (tip_id) REFERENCES public.hr_autorizatii_tipuri(id) ON DELETE RESTRICT,
  CONSTRAINT hr_autorizatii_titular_unic CHECK (((employee_id IS NOT NULL) <> (extern_id IS NOT NULL))),
  CONSTRAINT hr_autorizatii_uploadat_de_fkey FOREIGN KEY (uploadat_de) REFERENCES public.profiles(id)
);
ALTER TABLE public.hr_autorizatii ENABLE ROW LEVEL SECURITY;
CREATE POLICY autorizatii_read_all ON public.hr_autorizatii FOR SELECT TO authenticated USING (true);
CREATE POLICY hr_autorizatii_write_authorized ON public.hr_autorizatii TO authenticated
  USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.is_owner = true) OR (p.can_modify_employees = true) OR (p.role = 'superadmin'::text) OR (p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text])))))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.is_owner = true) OR (p.can_modify_employees = true) OR (p.role = 'superadmin'::text) OR (p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text])))))));

-- ---------------------------------------------------------------------------
-- hr_autorizatii_rsvti_confirmari — jurnalul (toate coloanele, FK-urile, indexurile, politicile live)
-- ---------------------------------------------------------------------------
CREATE TABLE public.hr_autorizatii_rsvti_confirmari (
  id bigserial NOT NULL,
  autorizatie_id bigint NOT NULL,
  employee_id bigint NOT NULL,
  data_confirmare date NOT NULL DEFAULT CURRENT_DATE,
  urmatoarea_confirmare date NOT NULL,
  confirmat_de uuid,
  observatii text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_autorizatii_rsvti_confirmari_pkey PRIMARY KEY (id),
  CONSTRAINT hr_autorizatii_rsvti_confirmari_autorizatie_id_fkey FOREIGN KEY (autorizatie_id) REFERENCES public.hr_autorizatii(id) ON DELETE CASCADE,
  CONSTRAINT hr_autorizatii_rsvti_confirmari_confirmat_de_fkey FOREIGN KEY (confirmat_de) REFERENCES auth.users(id),
  CONSTRAINT hr_autorizatii_rsvti_confirmari_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE INDEX idx_hr_aut_rsvti_confirmari_autorizatie ON public.hr_autorizatii_rsvti_confirmari USING btree (autorizatie_id, data_confirmare DESC);
CREATE INDEX idx_hr_aut_rsvti_confirmari_employee ON public.hr_autorizatii_rsvti_confirmari USING btree (employee_id, data_confirmare DESC);
ALTER TABLE public.hr_autorizatii_rsvti_confirmari ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari
  FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY hr_autorizatii_rsvti_confirmari_select_authenticated ON public.hr_autorizatii_rsvti_confirmari
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- RPC-ul LIVE („înainte”), verbatim din pg_get_functiondef + ACL-ul de azi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_hr_autorizatie_rsvti(p_autorizatie_id bigint, p_data_confirmare date DEFAULT CURRENT_DATE, p_observatii text DEFAULT NULL::text)
 RETURNS hr_autorizatii_rsvti_confirmari
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aut public.hr_autorizatii%rowtype;
  v_tip public.hr_autorizatii_tipuri%rowtype;
  v_user uuid := auth.uid();
  v_next date;
  v_row public.hr_autorizatii_rsvti_confirmari%rowtype;
begin
  select * into v_aut
  from public.hr_autorizatii
  where id = p_autorizatie_id
    and deleted_at is null;

  if not found then
    raise exception 'Autorizatia nu exista sau este stearsa';
  end if;

  select * into v_tip
  from public.hr_autorizatii_tipuri
  where id = v_aut.tip_id;

  if not coalesce(v_tip.necesita_confirmare_rsvti, false) then
    raise exception 'Tipul de autorizatie nu necesita confirmare RSVTI';
  end if;

  v_next := (coalesce(p_data_confirmare, current_date) + make_interval(months => coalesce(v_tip.interval_confirmare_rsvti_luni, 6)))::date;

  insert into public.hr_autorizatii_rsvti_confirmari (
    autorizatie_id,
    employee_id,
    data_confirmare,
    urmatoarea_confirmare,
    confirmat_de,
    observatii
  ) values (
    p_autorizatie_id,
    v_aut.employee_id,
    coalesce(p_data_confirmare, current_date),
    v_next,
    v_user,
    nullif(trim(coalesce(p_observatii, '')), '')
  )
  returning * into v_row;

  update public.hr_autorizatii
  set rsvti_ultima_confirmare = v_row.data_confirmare,
      rsvti_urmatoarea_confirmare = v_row.urmatoarea_confirmare,
      rsvti_confirmat_de = v_user,
      rsvti_confirmat_la = now(),
      rsvti_observatii = nullif(trim(coalesce(p_observatii, '')), ''),
      modificat_la = now()
  where id = p_autorizatie_id;

  return v_row;
end;
$function$;
REVOKE ALL ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fidelitate: amprentele producției (29.09.2026). Orice abatere oprește încărcarea.
-- ---------------------------------------------------------------------------
DO $fidelitate$
DECLARE r record; v_norm text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.prevent_role_escalation()',                          '16112659be92143e6539ae0e54e47a06'),
      ('public.enforce_owner_only_salary_flags()',                  '0470660c0a819981ff914355c7f6d00a'),
      ('public.protect_can_access_pontaj_brut()',                   'ff277c90e02ef03d1efb34cd7e87b1d4'),
      ('public.fn_profiles_campuri_owner_only()',                   'c06d7ce0f212c7bba2093c50614a88fc'),
      ('public.confirm_hr_autorizatie_rsvti(bigint,date,text)',     '527c0e4708dfe1f88cec03a77b6a26dd')) AS x(fn, m)
  LOOP
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = r.fn::regprocedure) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'Fidelitate: md5(prosrc) pentru % diferă de producție', r.fn;
    END IF;
  END LOOP;
  -- ACL-uri identice cu producția
  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
     IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'Fidelitate: ACL RPC diferit de producție';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.hr_autorizatii'::regclass, 'public.hr_autorizatii_tipuri'::regclass,
                                                  'public.hr_autorizatii_rsvti_confirmari'::regclass)
             -- producția (PG17) are și „m” (MAINTAIN), care nu există în PG16 → comparat fără el
             AND replace(relacl::text, 'm/', '/') IS DISTINCT FROM '{postgres=arwdDxt/postgres,anon=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}') THEN
    RAISE EXCEPTION 'Fidelitate: ACL tabele diferit de producție';
  END IF;
  -- politicile: md5 al textului din pg_policies = cel din producție
  FOR r IN SELECT * FROM (VALUES
      ('hr_autorizatii', 'hr_autorizatii_write_authorized', 'f2a295ca956d58971e6ec6779e9aa08a', 'f2a295ca956d58971e6ec6779e9aa08a'),
      ('hr_autorizatii_tipuri', 'hr_autorizatii_tipuri_write_authorized', 'f2a295ca956d58971e6ec6779e9aa08a', 'f2a295ca956d58971e6ec6779e9aa08a'),
      ('hr_autorizatii_rsvti_confirmari', 'hr_autorizatii_rsvti_confirmari_insert_authenticated', 'd41d8cd98f00b204e9800998ecf8427e', 'dc71e447411e7aaf354179a11ad2e2ae'),
      ('hr_autorizatii_rsvti_confirmari', 'hr_autorizatii_rsvti_confirmari_select_authenticated', 'b326b5062b2f0e69046810717534cb09', 'd41d8cd98f00b204e9800998ecf8427e'),
      ('hr_autorizatii', 'autorizatii_read_all', 'b326b5062b2f0e69046810717534cb09', 'd41d8cd98f00b204e9800998ecf8427e')) AS x(t, p, mq, mw)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=r.t AND policyname=r.p
                   AND md5(coalesce(qual,'')) = r.mq AND md5(coalesce(with_check,'')) = r.mw) THEN
      RAISE EXCEPTION 'Fidelitate: politica %.% diferă de producție (deparse PG16 vs PG17?)', r.t, r.p;
    END IF;
  END LOOP;
END $fidelitate$;

-- ---------------------------------------------------------------------------
-- Schema de teste (helperi; nu există în producție)
-- ---------------------------------------------------------------------------
CREATE SCHEMA teste;
GRANT USAGE ON SCHEMA teste TO anon, authenticated, service_role;

CREATE FUNCTION teste.assert(p_ok boolean, p_mesaj text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ESEC TEST: %', p_mesaj USING ERRCODE = 'P0T01';
  END IF;
  RAISE NOTICE 'OK   %', p_mesaj;
END $fn$;

-- Rulează p_sql cu identitatea curentă și cere să EȘUEZE (opțional SQLSTATE + fragment din mesaj).
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
    RAISE NOTICE 'OK   % (refuzat: % — %)', p_mesaj, v_state, left(v_msg, 90);
    RETURN;
  END;
  RAISE EXCEPTION 'ESEC TEST: % — trebuia să eșueze, dar a reușit: %', p_mesaj, p_sql USING ERRCODE = 'P0T01';
END $fn$;

-- Rulează p_sql cu identitatea curentă și cere să REUȘEASCĂ; întoarce numărul de rânduri afectate.
CREATE FUNCTION teste.reuseste(p_sql text, p_mesaj text) RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE n integer; v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'ESEC TEST: % — trebuia să reușească, dar: % %', p_mesaj, v_state, v_msg USING ERRCODE = 'P0T01';
  END;
  RAISE NOTICE 'OK   % (reușit, % rând/uri)', p_mesaj, n;
  RETURN n;
END $fn$;

-- Identitate PostgREST: claims JWT (sub + role) + SET ROLE; session_user rămâne postgres.
CREATE FUNCTION teste.ca_utilizator(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  EXECUTE 'SET ROLE authenticated';
END $fn$;
-- Rolul DB fără claims (conexiune care n-a trecut prin PostgREST / claims golite).
CREATE FUNCTION teste.ca_rol_fara_claims(p_rol text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', '', false);
  EXECUTE format('SET ROLE %I', p_rol);
END $fn$;
-- Cheia anon (JWT valid, fără sub).
CREATE FUNCTION teste.ca_anon() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', 'anon', false);
  EXECUTE 'SET ROLE anon';
END $fn$;
-- Cheia service_role (JWT fără sub): BYPASSRLS, auth.uid() NULL.
CREATE FUNCTION teste.ca_service_role() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  EXECUTE 'SET ROLE service_role';
END $fn$;
-- Înapoi la login-ul postgres fără claims (ca MCP / pg_cron).
CREATE FUNCTION teste.ca_admin() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', '', false);
END $fn$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role;
