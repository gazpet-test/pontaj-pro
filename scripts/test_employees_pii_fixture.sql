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
  can_access_personal_data boolean NOT NULL DEFAULT false
);
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
INSERT INTO profiles VALUES
('00000000-0000-0000-0000-000000000001',false,false,false),
('00000000-0000-0000-0000-000000000002',true,false,false),
('00000000-0000-0000-0000-000000000003',false,true,true),
('00000000-0000-0000-0000-000000000004',false,true,false),
('00000000-0000-0000-0000-000000000005',false,false,true);
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
INSERT INTO employees(name,department,functie,cnp,iban,qr_pin,qr_pin_active)
  VALUES('TEST ANGAJAT','TEST','TEST','FICTIV','IBAN FICTIV','9876',true);
