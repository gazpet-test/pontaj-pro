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
 (55,'FIXTURE TEREN A',true,NULL,'FIXTURE_CNP_55','FIXTURE_IBAN_55'),
 (70,'FIXTURE TEREN B',true,NULL,'FIXTURE_CNP_70','FIXTURE_IBAN_70'),
 (80,'FIXTURE LEGAT',true,NULL,'FIXTURE_CNP_80','FIXTURE_IBAN_80');
RESET ROLE;
-- r3: ...0003 = cont legat de fisa si cu drept pe modul, dar NEAPROBAT de owner (Copilot r2 P1-01): ramane neaprobat.
-- r9: conturile teren ale fixture-ului sunt sintetice (ID-uri si adrese inventate); migrarea le primeste ca hash-uri
-- prin scripts/portal/prepare_fixture.py --teren (artefactul de productie are hash-urile conturilor reale).
INSERT INTO auth.users(id,email) VALUES
 ('e1000000-0000-0000-0000-000000000055','teren.fixture.a@teren.gazpet.ro'),
 ('e1000000-0000-0000-0000-000000000070','teren.fixture.b@teren.gazpet.ro'),
 ('e1000000-0000-0000-0000-0000000000ff','teren.fixture.test@teren.gazpet.ro'),
 ('00000000-0000-0000-0000-000000000001','erp@example.invalid'),
 ('00000000-0000-0000-0000-000000000002','pending@example.invalid'),
 ('00000000-0000-0000-0000-000000000003','legat@example.invalid');
SET ROLE postgres;
INSERT INTO public.profiles(id,email,employee_id,role)
 SELECT id,email,CASE WHEN email='teren.fixture.a@teren.gazpet.ro' THEN 55
   WHEN email='teren.fixture.b@teren.gazpet.ro' THEN 70
   WHEN email='legat@example.invalid' THEN 80 END,'manager_santier' FROM auth.users;
INSERT INTO public.user_module_access(profile_id,module,access_level)
 SELECT id,'probe_teren','editor' FROM public.profiles WHERE employee_id IS NOT NULL;
INSERT INTO public.facturi VALUES(1,123);
INSERT INTO public.contracte VALUES(1,'fixture');
-- pg_net sintetic: schema cu USAGE PUBLIC si 12 functii INVOKER, fara acces la date.
CREATE SCHEMA net;
GRANT USAGE ON SCHEMA net TO PUBLIC;
DO $net_fixture$
BEGIN
 FOR i IN 1..12 LOOP
  EXECUTE format('CREATE FUNCTION net.portal_fixture_net_%s() RETURNS integer LANGUAGE sql AS %L',
   lpad(i::text,2,'0'),'SELECT 1');
 END LOOP;
END $net_fixture$;
-- Exact 21 de functii sintetice: NU reprezinta inventarul PUBLIC din productie.
DO $fixture$
BEGIN
 FOR i IN 1..21 LOOP
  EXECUTE format('CREATE FUNCTION public.portal_fixture_public_%s() RETURNS integer LANGUAGE sql IMMUTABLE AS %L',
   lpad(i::text,2,'0'),'SELECT 1');
 END LOOP;
END $fixture$;
RESET ROLE;
-- r21: tabelele pg_net in forma de PE PRODUCTIE (12.11.2026, porti_citire.sql B / C / G): proprietar supabase_admin,
-- aceleasi coloane si TOATE drepturile pentru PUBLIC (acordate de supabase_admin), ca harness-ul sa nu treaca pe o stare
-- mai curata decat cea reala. r22: amprenta completa (triggere, politici, DEFAULT-uri ...) se citeste de harness din G
-- INAINTE de apply si intra in copia 18a (artefactul ramane DE_COMPLETAT pana la recitirea pe productie). Fara randuri.
CREATE TYPE net.http_method AS ENUM ('GET','POST','DELETE');
CREATE TABLE net.http_request_queue (id bigserial NOT NULL, method net.http_method NOT NULL, url text NOT NULL,
 headers jsonb, body bytea, timeout_milliseconds integer NOT NULL);
CREATE UNLOGGED TABLE net._http_response (id bigint, status_code integer, content_type text, headers jsonb, content text,
 timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
GRANT ALL ON net.http_request_queue, net._http_response TO PUBLIC;
GRANT ALL ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC;
