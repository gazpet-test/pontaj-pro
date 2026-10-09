-- Schelet minimal pentru harness-ul 20261023b (diurne: scriere pentru can_access_diurne). Politicile = verbatim live 09.10.2026.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false, can_access_salarii boolean DEFAULT false, can_access_diurne boolean DEFAULT false,
  can_access_personal_data boolean DEFAULT false, can_access_pontaj_brut boolean DEFAULT false, can_modify_employees boolean DEFAULT false,
  can_manage_contracts boolean DEFAULT false, can_access_financiar boolean DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
CREATE POLICY profiles_select_all_authenticated ON public.profiles FOR SELECT USING (true);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_insert_owner ON public.profiles FOR INSERT WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p2 WHERE ((p2.id = auth.uid()) AND (p2.is_owner = true)))));
-- bariera care face can_access_diurne owner-only (verbatim live 09.10.2026, md5 daaa5612…)
\ir diurne_scriere_bariera.sql
CREATE TRIGGER trg_enforce_owner_only_salary_flags BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION enforce_owner_only_salary_flags();
CREATE TABLE public.diurna_payments (id bigserial PRIMARY KEY, period_from date, period_to date, payment_date date, total_employees int, total_days int, total_amount numeric, notes text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.diurna_payment_details (id bigserial PRIMARY KEY, payment_id bigint REFERENCES public.diurna_payments(id) ON DELETE CASCADE, employee_id bigint, employee_name text, days int, amount numeric);
ALTER TABLE public.diurna_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diurna_payment_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diurna_payments, public.diurna_payment_details TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE POLICY diurna_payments_insert_salarii ON public.diurna_payments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true))))));
CREATE POLICY diurna_payments_delete_owner ON public.diurna_payments FOR DELETE USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true)))));
CREATE POLICY diurna_payments_select_salarii ON public.diurna_payments FOR SELECT USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true) OR (profiles.can_access_diurne = true))))));
CREATE POLICY diurna_payments_update_salarii ON public.diurna_payments FOR UPDATE USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true)))))) WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true))))));
CREATE POLICY diurna_payment_details_insert_salarii ON public.diurna_payment_details FOR INSERT WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true))))));
CREATE POLICY diurna_payment_details_delete_owner ON public.diurna_payment_details FOR DELETE USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true)))));
CREATE POLICY diurna_payment_details_select_salarii ON public.diurna_payment_details FOR SELECT USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true) OR (profiles.can_access_diurne = true))))));
CREATE POLICY diurna_payment_details_update_salarii ON public.diurna_payment_details FOR UPDATE USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true)))))) WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true))))));
-- o = owner · s = salarii · d = doar acces diurne (Natalia) · z = nimic
INSERT INTO public.profiles(id,is_owner,can_access_salarii,can_access_diurne) VALUES ('00000000-0000-0000-0000-00000000000a',true,false,false),('00000000-0000-0000-0000-00000000000b',false,true,false),
  ('00000000-0000-0000-0000-00000000000d',false,false,true),('00000000-0000-0000-0000-00000000000f',false,false,false);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, nodename text DEFAULT 'localhost', nodeport integer DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT CURRENT_USER, active boolean DEFAULT true, jobname text);
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
