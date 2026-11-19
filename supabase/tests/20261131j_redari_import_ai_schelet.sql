-- Schelet LOCAL (PGlite / PG de unică folosință) pentru 20261131j (Redări: verificarea AI a importului — dreptul pe proiect, jurnalul apelurilor,
-- rezervarea / închiderea). NU se rulează pe producție.
-- Reproduce DOAR ce atinge / citește migrarea: rolurile Supabase (service_role BYPASSRLS, dashboard_user, supabase_auth_admin), privilegiile
-- implicite periculoase (ALL / EXECUTE pe obiecte noi: migrarea trebuie să le scoată), auth.uid() (corpul live, owner supabase_auth_admin, EXECUTE
-- PUBLIC + dashboard_user — ca în 20261130i_redari_sms_stare_schelet.sql), auth.jwt() / auth.role(), profiles + user_module_access, red_proiecte
-- (coloanele citite) și red_jurnal (append-only, triggerul de imuabilitate). Corpurile funcțiilor Redări NU sunt aici: testul
-- (scripts/pglite/test_redari_import_ai_local.mjs) le extrage EXACT din migrările lor și le pune în locul marcajului „@@FUNCTII@@”
-- (amprentele = constantele din 20261131j, verificat de test).
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$function$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$function$;
-- auth.uid() ca pe live (citit read-only 04.11.2026; corpul din 20261130i_redari_sms_stare_schelet.sql): întâi request.jwt.claim.sub, apoi
-- request.jwt.claims ->> 'sub'. Scris ca literal E'' ca spațiul de după „select” (parte din corpul live, deci din amprentă) să nu se piardă la editare.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS E'\n  select \n  coalesce(\n    nullif(current_setting(''request.jwt.claim.sub'', true), ''''),\n    (nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub'')\n  )::uuid\n';
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, supabase_auth_admin, dashboard_user;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'viewer')), UNIQUE (profile_id, module));
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
-- @@FUNCTII@@
-- ---------------------------------------------------------------- tabelele (coloanele citite de migrare, ca pe live)
CREATE TABLE public.red_proiecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cod text NOT NULL UNIQUE CHECK (btrim(cod) <> ''),
  denumire text,
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  versiune int NOT NULL DEFAULT 1
);
CREATE TABLE public.red_jurnal (
  id bigserial PRIMARY KEY, tabela text NOT NULL, inregistrare_id uuid, actiune text NOT NULL CHECK (actiune IN ('insert', 'update', 'delete')),
  date_vechi jsonb, date_noi jsonb, user_id uuid, user_email text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_red_jurnal_inregistrare ON public.red_jurnal (tabela, inregistrare_id);
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'user_module_access', 'red_proiecte', 'red_jurnal'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  EXECUTE 'ALTER TABLE public.red_proiecte ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.red_jurnal ENABLE ROW LEVEL SECURITY';
END $t$;
REVOKE ALL ON SEQUENCE public.red_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.red_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
-- politicile și drepturile de pe live (20261126a + 20261130g), doar cele care contează aici
CREATE POLICY red_proiecte_sel ON public.red_proiecte FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IS NOT NULL);
CREATE POLICY red_jurnal_sel ON public.red_jurnal FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IS NOT NULL);
GRANT SELECT, INSERT, UPDATE ON public.red_proiecte TO authenticated, service_role;
GRANT SELECT ON public.red_jurnal TO authenticated, service_role;
GRANT SELECT ON public.profiles, public.user_module_access TO authenticated, service_role;
