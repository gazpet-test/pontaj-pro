-- Schelet minim (NU se aplică pe producție) pentru scripts/test_rls_garantii.sh — doar într-o bază locală *_test.
-- Reproduce politicile LIVE de pe cele 4 tabele (citite read-only 01.10.2026; md5 62f69c5942960f9e30c0a3c3c04d5e26)
-- și coloanele folosite. auth.uid() local = claim-ul request.jwt.claim.sub (ca în Supabase), schema auth.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text, is_owner boolean DEFAULT false, can_manage_contracts boolean DEFAULT false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid, module text, access_level text);
CREATE TABLE public.contracte_terti (id bigserial PRIMARY KEY, denumire text, gbe_procent numeric);
CREATE TABLE public.garantii (id bigserial PRIMARY KEY, tip text, beneficiar text, licitatie_id bigint);
CREATE TABLE public.gbe_polite (id bigserial PRIMARY KEY, contract_id bigint, valoare numeric);
CREATE TABLE public.gbe_restituiri (id bigserial PRIMARY KEY, contract_id bigint, valoare_lei numeric);
ALTER TABLE public.contracte_terti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garantii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbe_polite ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbe_restituiri ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracte_terti_delete ON public.contracte_terti FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner));
CREATE POLICY contracte_terti_insert ON public.contracte_terti FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner OR profiles.can_manage_contracts)));
CREATE POLICY contracte_terti_select ON public.contracte_terti FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY contracte_terti_update ON public.contracte_terti FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner OR profiles.can_manage_contracts)));
CREATE POLICY contracte_terti_write ON public.contracte_terti FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY garantii_rw ON public.garantii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY gbe_polite_select ON public.gbe_polite FOR SELECT TO authenticated USING (true);
CREATE POLICY gbe_polite_write ON public.gbe_polite FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY gbe_restituiri_select ON public.gbe_restituiri FOR SELECT TO authenticated USING (true);
CREATE POLICY gbe_restituiri_write ON public.gbe_restituiri FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Persoane de test (rol → așteptare)
INSERT INTO public.profiles (id, name, role, is_owner, can_manage_contracts) VALUES
 ('00000000-0000-0000-0000-000000000001','owner','superadmin',true,false),
 ('00000000-0000-0000-0000-000000000002','superadmin','superadmin',false,false),
 ('00000000-0000-0000-0000-000000000003','contabilitate','contabilitate',false,false),
 ('00000000-0000-0000-0000-000000000004','fin_editor','manager_santier',false,false),
 ('00000000-0000-0000-0000-000000000005','gar_editor','manager_santier',false,false),
 ('00000000-0000-0000-0000-000000000006','gar_viewer','manager_santier',false,false),
 ('00000000-0000-0000-0000-000000000007','contracte','manager_santier',false,true),
 ('00000000-0000-0000-0000-000000000008','oarecine','gestionar',false,false),
 ('00000000-0000-0000-0000-000000000009','admin_logistica','admin_logistica',false,false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
 ('00000000-0000-0000-0000-000000000004','financiar','editor'),
 ('00000000-0000-0000-0000-000000000005','financiar.garantii','editor'),
 ('00000000-0000-0000-0000-000000000006','financiar.garantii','viewer'),
 ('00000000-0000-0000-0000-000000000008','ofertare','editor');
INSERT INTO public.contracte_terti (denumire) VALUES ('C1');
INSERT INTO public.garantii (tip, beneficiar) VALUES ('participare','B1');
INSERT INTO public.gbe_polite (contract_id, valoare) VALUES (1, 10);
INSERT INTO public.gbe_restituiri (contract_id, valoare_lei) VALUES (1, 5);
