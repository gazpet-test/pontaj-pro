-- Fixture LOCAL pentru scripts/test_sec_f1_f2.sh — schelet minimal al stării din producție (30.09.2026) relevant pentru SEC F1/F2.
-- NU se aplică pe Supabase. Rolurile, auth.uid() (stub care citește request.jwt.claim.sub / request.jwt.claims), profiles cu
-- cele 4 triggere; corpurile live ale celor 3 funcții F2 se încarcă separat din fișierul ROLLBACK (verificate prin md5 în precondiții).
-- Politicile UPDATE sunt deschise (USING true) pentru anon+authenticated INTENȚIONAT: testele verifică triggerele, nu RLS.
-- Atacatorul SQL generic: rol LOGIN cu UPDATE pe profiles (cazul 1b).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE supabase_admin LOGIN SUPERUSER; CREATE ROLE authenticator LOGIN; GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE profiles(id uuid PRIMARY KEY, role text, is_owner bool DEFAULT false, can_access_salarii bool DEFAULT false, can_access_personal_data bool DEFAULT false, can_access_pontaj_brut bool DEFAULT false, can_modify_employees bool DEFAULT false, can_manage_contracts bool DEFAULT false, can_access_diurne bool DEFAULT false, can_access_financiar bool DEFAULT false, department text, employee_id int);
CREATE TABLE user_module_access(id serial PRIMARY KEY); CREATE TABLE t_a(id int); CREATE TABLE t_b(id int); CREATE TABLE app_secrets(id int);
REVOKE TRUNCATE ON app_secrets FROM anon, authenticated, service_role;  -- service_role NU are TRUNCATE aici (ca tabelele blindate din producție)
CREATE VIEW v_x AS SELECT 1 AS a;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_upd ON profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY p_sel ON profiles FOR SELECT TO anon, authenticated USING (true);
INSERT INTO profiles(id, role, is_owner) VALUES ('11111111-1111-1111-1111-111111111111','owner',true), ('22222222-2222-2222-2222-222222222222','user',false);
CREATE ROLE atacator LOGIN; GRANT USAGE ON SCHEMA auth TO atacator; GRANT SELECT, UPDATE ON profiles TO atacator;
CREATE POLICY p_atacator ON profiles FOR ALL TO atacator USING (true) WITH CHECK (true);
