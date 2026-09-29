-- ============================================================================
-- Schelet local = producția de azi (29.09.2026, citită read-only din cataloage) pentru
-- 20261003e_sec_trezorerie. DATE FICTIVE (IBAN-uri RO00TEST…, niciun IBAN real).
-- Rulează ca superuser local (supabase_admin), pe PostgreSQL 16 local.
-- Fidelitate: postgres = NON-superuser cu BYPASSRLS (ca în producție), owner al obiectelor;
-- anon/authenticated NOLOGIN; service_role BYPASSRLS; ACL-uri = default privileges Supabase.
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS CREATEROLE CREATEDB; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END $r$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;
GRANT CREATE, USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

-- tabela „schema_migrations” creată DOAR pentru emularea runner-ului (emularea 3)
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
GRANT ALL ON SCHEMA supabase_migrations TO postgres;
GRANT ALL ON supabase_migrations.schema_migrations TO postgres;

SET ROLE postgres;
-- default privileges ca în Supabase (tabele/secvențe: tot pentru anon/authenticated/service_role;
-- funcții: varianta cea mai largă, ca REVOKE-urile patch-ului să fie dovedite)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, role text, is_owner boolean DEFAULT false, can_access_financiar boolean DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_all ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE TABLE public.user_module_access (profile_id uuid REFERENCES public.profiles(id), module text, access_level text);
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY uma_select ON public.user_module_access FOR SELECT TO authenticated USING (true);

-- DDL identic cu migrarea 20260915200036 trezorerie_conturi_si_extrase
CREATE TABLE IF NOT EXISTS public.trezorerie_conturi (
  id bigserial PRIMARY KEY, iban text NOT NULL UNIQUE, cont_intern text NOT NULL,
  tip text NOT NULL DEFAULT 'gbe', titular text NOT NULL DEFAULT 'GAZPET INSTAL SRL PLOIESTI',
  beneficiar text, contract_numar text, contract_data date, lucrare text, proiect_id bigint,
  sursa_imperechere text, imperecheat_la timestamptz, imperecheat_de uuid, observatii text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.trezorerie_extras_linii (
  id bigserial PRIMARY KEY,
  cont_id bigint NOT NULL REFERENCES public.trezorerie_conturi(id) ON DELETE CASCADE,
  data_extras date NOT NULL, sold_precedent numeric(14,2), total_debit numeric(14,2),
  total_credit numeric(14,2), sold_final numeric(14,2), sursa_fisier text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (cont_id, data_extras));
CREATE INDEX IF NOT EXISTS idx_trez_conturi_tip ON public.trezorerie_conturi(tip);
CREATE INDEX IF NOT EXISTS idx_trez_linii_data ON public.trezorerie_extras_linii(data_extras);
ALTER TABLE public.trezorerie_conturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trezorerie_extras_linii ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trezorerie_conturi TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trezorerie_extras_linii TO authenticated;
GRANT ALL ON public.trezorerie_conturi TO service_role;
GRANT ALL ON public.trezorerie_extras_linii TO service_role;
CREATE POLICY trez_conturi_rw ON public.trezorerie_conturi
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY trez_linii_rw ON public.trezorerie_extras_linii
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- copilul prin FK cu aceeași problemă, rămas ÎN AFARA patch-ului (vezi doc)
CREATE TABLE public.garantii (
  id bigserial PRIMARY KEY, beneficiar text NOT NULL, iban text,
  trezorerie_cont_id bigint REFERENCES public.trezorerie_conturi(id) ON DELETE SET NULL);
ALTER TABLE public.garantii ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantii_rw ON public.garantii
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
RESET ROLE;

-- identități fictive
INSERT INTO public.profiles (id, role, is_owner, can_access_financiar) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'superadmin',      true,  false),  -- owner
  ('00000000-0000-0000-0000-00000000000f', 'contabilitate',   false, true),   -- flag can_access_financiar
  ('00000000-0000-0000-0000-00000000000b', 'contabilitate',   false, false),  -- modul financiar, fără flag
  ('00000000-0000-0000-0000-00000000000c', 'superadmin',      false, false),  -- rol scriere UI Financiar, fără modul
  ('00000000-0000-0000-0000-00000000000d', 'manager_santier', false, false),  -- cont oarecare (execuție)
  ('00000000-0000-0000-0000-00000000000e', 'manager_santier', false, NULL);   -- flag NULL
INSERT INTO public.user_module_access VALUES
  ('00000000-0000-0000-0000-00000000000b', 'financiar', 'editor'),
  ('00000000-0000-0000-0000-00000000000d', 'executie',  'editor');

INSERT INTO public.trezorerie_conturi (iban, cont_intern, tip) VALUES
  ('RO00TEST0000000000000001', 'INT-TEST-1', 'gbe'),
  ('RO00TEST0000000000000002', 'INT-TEST-2', 'gbe'),
  ('RO00TEST0000000000000003', 'INT-TEST-3', 'curent');
INSERT INTO public.trezorerie_extras_linii (cont_id, data_extras, sold_precedent, total_debit, total_credit, sold_final)
  SELECT id, DATE '2026-09-15', 10, 0, 0, 10 FROM public.trezorerie_conturi;
INSERT INTO public.garantii (beneficiar, iban, trezorerie_cont_id)
  SELECT 'BENEFICIAR TEST', iban, id FROM public.trezorerie_conturi WHERE cont_intern = 'INT-TEST-1';

-- fidelitate: amprenta politicii = cea din producție
DO $f$ BEGIN
  IF (SELECT md5(pg_get_expr(polqual, polrelid)) FROM pg_policy WHERE polname = 'trez_conturi_rw')
     IS DISTINCT FROM 'dc71e447411e7aaf354179a11ad2e2ae' THEN
    RAISE EXCEPTION 'FIDELITATE: deparse diferit de producție';
  END IF;
END $f$;
