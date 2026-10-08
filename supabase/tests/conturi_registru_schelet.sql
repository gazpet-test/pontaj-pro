-- Schelet minim (NU se aplică pe producție) pentru scripts/test_conturi_registru.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261021a de pe live (08.10.2026): rolurile Supabase + default privileges ale lui postgres
-- (tabele: anon/authenticated arwdxt, service_role tot; secvențe: rwU pentru toți — exact ca pe live), auth.uid() din
-- request.jwt.claims, profiles.is_owner boolean NOT NULL, locatii_inchiriate.id bigint, public.set_updated_at() verbatim
-- (md5 prosrc 1c4318be…), supabase_migrations.schema_migrations pentru runner, helpers de test în schema teste.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- default privileges ca pe live (rolul postgres, citite 08.10): tabelele noi primesc arwdxt pentru anon/authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_sel ON public.profiles FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-0000-0000-000000000121', 'TRUSU RAZVAN', true),
  ('00000000-0000-0000-0000-000000000125', 'TUDORACHE MARILENA', true),
  ('00000000-0000-0000-0000-000000000126', 'NATALIA', false);

CREATE TABLE public.locatii_inchiriate (id bigserial PRIMARY KEY, nume text NOT NULL, activ boolean NOT NULL DEFAULT true);
ALTER TABLE public.locatii_inchiriate ENABLE ROW LEVEL SECURITY;
CREATE POLICY locatii_inchiriate_all ON public.locatii_inchiriate FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
INSERT INTO public.locatii_inchiriate (nume) VALUES ('APARTAMENT BRUMARELELOR'), ('Punct de lucru Piatra Neamț');

\ir conturi_registru_set_updated_at.sql

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);

-- helpers de test (schema teste; invoker — rulează cu rolul curent)
CREATE SCHEMA teste;
GRANT USAGE ON SCHEMA teste TO anon, authenticated, service_role;
CREATE FUNCTION teste.ca(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  SET ROLE authenticated;
END $$;
CREATE FUNCTION teste.eroare(p_eticheta text, p_sql text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_fragment IS NOT NULL AND position(lower(p_fragment) IN lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION 'TEST % : eroare diferita: % (asteptat: %)', p_eticheta, SQLERRM, p_fragment;
    END IF;
    RAISE NOTICE 'OK   %', p_eticheta;
    RETURN;
  END;
  RAISE EXCEPTION 'TEST % : a trecut, asteptam eroare (%)', p_eticheta, p_fragment;
END $$;
CREATE FUNCTION teste.e(p_eticheta text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'TEST % : esuat', p_eticheta; END IF;
  RAISE NOTICE 'OK   %', p_eticheta;
END $$;
-- numărul de rânduri atinse de un UPDATE/DELETE (ca utilizatorul curent)
CREATE FUNCTION teste.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS v = ROW_COUNT; RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role;
