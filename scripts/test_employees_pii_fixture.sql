-- Fixture exclusiv fictiv. Coloanele/check-urile employees din conturi_schelet_supabase.sql.
-- Nu reproduce toate triggerele ciclului de viata; integrarea completa se verifica separat.
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $epi_fixture_uid$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$epi_fixture_uid$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.sites(id serial PRIMARY KEY,name text);
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


ALTER TABLE public.employees
  ADD COLUMN colaborare_externa_status text NOT NULL DEFAULT 'necunoscut',
  ADD COLUMN colaborare_externa_confirmat_de uuid,
  ADD COLUMN colaborare_externa_confirmat_la timestamptz,
  ADD COLUMN colaborare_externa_nota text,
  ADD COLUMN colaborare_externa_document text,
  ADD CONSTRAINT colab_status CHECK(colaborare_externa_status IN ('necunoscut','accepta','refuza'));
CREATE TABLE public.profiles(
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  is_owner boolean NOT NULL DEFAULT false,
  can_modify_employees boolean NOT NULL DEFAULT false,
  can_access_personal_data boolean NOT NULL DEFAULT false,
  role text DEFAULT 'magazie'
);
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,9) n;
INSERT INTO profiles(id,is_owner,can_modify_employees,can_access_personal_data) VALUES
('00000000-0000-0000-0000-000000000001',false,false,false),
('00000000-0000-0000-0000-000000000002',true,false,false),
('00000000-0000-0000-0000-000000000003',false,true,true),
('00000000-0000-0000-0000-000000000004',false,true,false),
('00000000-0000-0000-0000-000000000005',false,false,true);
INSERT INTO profiles(id) SELECT id FROM auth.users WHERE id NOT IN (SELECT id FROM profiles);
-- Schema reala a accesului: FK, CHECK, unicitate; rolul singur nu acorda modulul.
CREATE TABLE public.app_modules(key text PRIMARY KEY);
INSERT INTO app_modules VALUES('magazie'),('logistica');
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module text NOT NULL REFERENCES public.app_modules(key) ON DELETE CASCADE,
  access_level text NOT NULL CHECK(access_level IN ('admin','editor','viewer')),
  granted_at timestamptz DEFAULT now(),
  granted_by uuid REFERENCES public.profiles(id),
  UNIQUE(profile_id,module)
);
INSERT INTO user_module_access(profile_id,module,access_level) VALUES
('00000000-0000-0000-0000-000000000006','magazie','viewer'),
('00000000-0000-0000-0000-000000000007','magazie','editor'),
('00000000-0000-0000-0000-000000000008','magazie','admin'),
('00000000-0000-0000-0000-000000000009','logistica','admin');
ALTER TABLE user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY access_self ON user_module_access FOR SELECT TO authenticated USING(profile_id=auth.uid());
GRANT SELECT ON user_module_access TO authenticated;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_self ON profiles FOR SELECT TO authenticated USING(id=auth.uid());
GRANT SELECT ON profiles TO authenticated;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employees_select_all_authenticated ON public.employees FOR SELECT TO authenticated USING(true);
CREATE POLICY employees_update_authorized ON public.employees FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id=auth.uid() AND (profiles.is_owner=true OR profiles.can_modify_employees=true)))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id=auth.uid() AND (profiles.is_owner=true OR profiles.can_modify_employees=true)));
CREATE POLICY employees_insert_authorized ON public.employees FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id=auth.uid() AND (profiles.is_owner=true OR profiles.can_modify_employees=true)));
CREATE POLICY employees_delete_owner ON public.employees FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id=auth.uid() AND profiles.is_owner=true));
GRANT SELECT,INSERT,UPDATE,DELETE ON employees TO authenticated;
GRANT SELECT ON employees TO service_role;
GRANT USAGE ON SEQUENCE employees_id_seq TO authenticated;
-- Suprapunere grant tabel/coloana si grant option pentru restaurare exacta.
GRANT SELECT(name) ON employees TO authenticated WITH GRANT OPTION;
GRANT SELECT(cnp) ON employees TO anon WITH GRANT OPTION;
CREATE VIEW public.pii_safe_names WITH (security_invoker=on) AS SELECT id,name FROM public.employees;
GRANT SELECT ON public.pii_safe_names TO authenticated;
INSERT INTO employees(name,department,functie,cnp,iban,qr_pin,qr_pin_active,marime_incaltaminte,marime_imbracaminte)
  VALUES('TEST ANGAJAT','TEST','TEST','FICTIV','IBAN FICTIV','9876',true,'42','L');

-- Dependintele RPC existent, date exclusiv fictive. Politicile externe nu sunt reparate aici.
CREATE TABLE public.hr_personal_extern (
  id bigserial PRIMARY KEY, nume text NOT NULL, functie text, telefon text, email text,
  observatii text, activ boolean NOT NULL DEFAULT true, created_by uuid REFERENCES auth.users(id),
  fost_angajat_employee_id integer UNIQUE REFERENCES public.employees(id), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX uq_hr_personal_extern_nume ON public.hr_personal_extern(lower(btrim(nume)));
ALTER TABLE public.hr_personal_extern ENABLE ROW LEVEL SECURITY;
CREATE POLICY extern_read ON public.hr_personal_extern FOR SELECT TO authenticated USING(auth.uid() IS NOT NULL);
CREATE POLICY extern_update ON public.hr_personal_extern FOR UPDATE TO authenticated
  USING(auth.uid() IS NOT NULL) WITH CHECK(auth.uid() IS NOT NULL);
GRANT SELECT,UPDATE ON public.hr_personal_extern TO authenticated;
CREATE FUNCTION public.fn_identitate_om() RETURNS uuid LANGUAGE plpgsql STABLE
  SET search_path TO 'public','pg_temp' AS $identity$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Identitate necesara' USING ERRCODE='42501'; END IF;
  RETURN auth.uid();
END $identity$;
CREATE OR REPLACE FUNCTION public.fn_fost_angajat_leaga_extern(p_employee_id integer, p_extern_id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS U&'
DECLARE
  v_uid  uuid := public.fn_identitate_om();
  v_e    public.employees%ROWTYPE;
  v_x    public.hr_personal_extern%ROWTYPE;
  v_id   bigint;
  v_constr text;
  v_exist  bigint;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles
                                   WHERE id = v_uid AND (is_owner IS TRUE OR can_modify_employees IS TRUE)) THEN
    RAISE EXCEPTION ''Doar owner sau HR (can_modify_employees) pot trece un fost angajat ca extern'' USING ERRCODE = ''42501'';
  END IF;
  SELECT * INTO v_e FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION ''Fi\0219a #% nu exist\0103'', p_employee_id USING ERRCODE = ''P0002'';
  END IF;
  IF NOT (v_e.termination_date IS NOT NULL AND v_e.termination_date <= CURRENT_DATE AND v_e.active IS NOT TRUE) THEN
    RAISE EXCEPTION ''Fi\0219a #% nu e a unui fost angajat (contract \00eencheiat \0219i fi\0219\0103 inactiv\0103)'', p_employee_id USING ERRCODE = ''22023'';
  END IF;
  SELECT x.id INTO v_id FROM public.hr_personal_extern x WHERE x.fost_angajat_employee_id = p_employee_id;
  IF FOUND THEN RETURN v_id; END IF;                          -- idempotent

  IF p_extern_id IS NOT NULL THEN
    SELECT * INTO v_x FROM public.hr_personal_extern WHERE id = p_extern_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION ''Externul #% nu exist\0103'', p_extern_id USING ERRCODE = ''P0002'';
    END IF;
    IF v_x.fost_angajat_employee_id IS NOT NULL THEN
      RAISE EXCEPTION ''Externul #% e deja legat de fi\0219a #%'', p_extern_id, v_x.fost_angajat_employee_id USING ERRCODE = ''23505'';
    END IF;
    UPDATE public.hr_personal_extern
       SET fost_angajat_employee_id = p_employee_id,
           activ = (activ AND v_e.colaborare_externa_status = ''accepta''),
           updated_at = now()
     WHERE id = p_extern_id;
    RETURN p_extern_id;
  END IF;

  BEGIN
    INSERT INTO public.hr_personal_extern (nume, functie, telefon, email, observatii, activ, created_by, fost_angajat_employee_id)
    VALUES (v_e.name, COALESCE(v_e.functie, v_e.position), v_e.telefon, NULLIF(btrim(v_e.email), ''''),
            format(''Fost angajat Gazpet (fi\0219a #%s), contract \00eencheiat la %s'', v_e.id, to_char(v_e.termination_date, ''DD.MM.YYYY'')),
            v_e.colaborare_externa_status = ''accepta'', v_uid, p_employee_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constr = CONSTRAINT_NAME;
    IF v_constr = ''uq_hr_personal_extern_nume'' THEN
      SELECT x.id INTO v_exist FROM public.hr_personal_extern x WHERE lower(btrim(x.nume)) = lower(btrim(v_e.name));
      RAISE EXCEPTION ''Exist\0103 deja un extern cu numele %'', v_e.name
        USING ERRCODE = ''23505'', HINT = format(''Exist\0103 deja externul %s (#%s): leag\0103-l explicit'', v_e.name, v_exist);
    END IF;
    RAISE;
  END;
  RETURN v_id;
END ';
REVOKE ALL ON FUNCTION public.fn_fost_angajat_leaga_extern(integer, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_fost_angajat_leaga_extern(integer, bigint) TO authenticated;
