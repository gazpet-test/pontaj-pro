-- Ruleaza ca bootstrap supabase_admin NUMAI pe clusterul efemer.
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY, email text UNIQUE, raw_app_meta_data jsonb NOT NULL DEFAULT '{}',
 banned_until timestamptz
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO postgres,anon,authenticated,service_role;
-- UPDATE permite LOCK SHARE; BYPASSRLS singur nu confera privilegii SQL.
GRANT SELECT,REFERENCES,UPDATE ON auth.users TO postgres;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin,anon,authenticated,service_role;
SET ROLE postgres;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY,name text,statements text[]);
CREATE TABLE public.employees (
 id integer PRIMARY KEY,name text NOT NULL,active boolean,termination_date date,cnp text,iban text
);
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email text,name text,employee_id integer REFERENCES public.employees(id) ON DELETE SET NULL,
 role text NOT NULL CHECK(role IN ('superadmin','admin_logistica','manager_santier','sef_echipa',
   'contabilitate','hr','gestionar','magazioner')),
 tip_cont text DEFAULT 'angajat' CHECK(tip_cont IN ('angajat','extern','test','sistem'))
);
CREATE TABLE public.user_module_access (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 profile_id uuid REFERENCES public.profiles(id),module text,access_level text,
 granted_at timestamptz,granted_by uuid
);
CREATE TABLE public.facturi (id integer PRIMARY KEY,suma numeric);
CREATE TABLE public.contracte (id integer PRIMARY KEY,descriere text);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracte ENABLE ROW LEVEL SECURITY;
CREATE POLICY employees_select ON public.employees FOR SELECT TO authenticated USING(true);
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING(auth.uid() IS NOT NULL);
CREATE POLICY access_select ON public.user_module_access FOR SELECT TO authenticated USING(true);
CREATE POLICY facturi_larg ON public.facturi FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY contracte_larg ON public.contracte FOR ALL TO authenticated USING(auth.uid() IS NOT NULL) WITH CHECK(true);
GRANT SELECT ON public.employees,public.profiles,public.user_module_access TO authenticated;
GRANT ALL ON public.facturi,public.contracte TO authenticated;
INSERT INTO public.employees VALUES
 (55,'ILIE CORADO FLORINEL',true,NULL,'FIXTURE_CNP_55','FIXTURE_IBAN_55'),
 (70,'MITITELU PETRONEL',true,NULL,'FIXTURE_CNP_70','FIXTURE_IBAN_70');
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES
 ('44387376-e48c-44d5-a88b-752c653c5639','florinel.ilie@teren.gazpet.ro'),
 ('393709f9-bcb6-4ce5-ba22-2eca5c353f23','petronel.mititelu@teren.gazpet.ro'),
 ('a2a3a7c3-b285-4306-8d5b-39749c2abb0c','test.razvan@teren.gazpet.ro'),
 ('00000000-0000-0000-0000-000000000001','erp@example.invalid'),
 ('00000000-0000-0000-0000-000000000002','pending@example.invalid');
SET ROLE postgres;
INSERT INTO public.profiles(id,email,employee_id,role)
 SELECT id,email,CASE WHEN email='florinel.ilie@teren.gazpet.ro' THEN 55
   WHEN email='petronel.mititelu@teren.gazpet.ro' THEN 70 END,'manager_santier' FROM auth.users;
INSERT INTO public.user_module_access(profile_id,module,access_level)
 SELECT id,'probe_teren','editor' FROM public.profiles WHERE employee_id IS NOT NULL;
INSERT INTO public.facturi VALUES(1,123);
INSERT INTO public.contracte VALUES(1,'fixture');
-- Exact 21 de functii sintetice: NU reprezinta inventarul PUBLIC din productie.
DO $fixture$
BEGIN
 FOR i IN 1..21 LOOP
  EXECUTE format('CREATE FUNCTION public.portal_fixture_public_%s() RETURNS integer LANGUAGE sql IMMUTABLE AS %L',
   lpad(i::text,2,'0'),'SELECT 1');
 END LOOP;
END $fixture$;
RESET ROLE;
