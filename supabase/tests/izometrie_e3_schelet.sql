-- Extensia scheletului E2a pentru E3 (20261103b) — DOAR într-o bază locală *_test, după izometrie_e2a_schelet.sql.
-- Reproduce ce citește E3 de pe live (21.10.2026): auth.role(); storage.buckets / storage.objects; indexul unic
-- user_module_access (profile_id, module). r5f (#825 NO-GO, P1-3/P1-4): baseline-ul extern pre-E3 (owner / RLS / FORCE / ACL
-- pe storage.*, toate politicile Storage, trigger-ele profiles cu corpurile exacte) vine din izometrie_e3_schelet_baseline.sql,
-- GENERAT din captura revizuită de pe prod — preflight-ul 0l al migrării cere exact acel baseline.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE UNIQUE INDEX user_module_access_profile_id_module_key ON public.user_module_access (profile_id, module);

CREATE POLICY profiles_upd_own ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
GRANT UPDATE ON public.profiles TO authenticated;

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text,
  owner uuid, created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
-- un bucket existent, ca pe live (Logistica): nu trebuie atins de E3 (politicile lui vin din baseline)
INSERT INTO storage.buckets (id, name) VALUES ('avize', 'avize');
\ir izometrie_e3_schelet_baseline.sql
-- r5f (#825 NO-GO, P1-3): corpul REAL al prevent_role_escalation (DEFINER, „mutator” prin comentariul cu set_config) conține
-- „în”; închiderea citirilor E2a (regex, colaționare C) potrivește în el numele de o literă al helper-ului teste.n (SQL
-- dinamic ⇒ în închidere) ⇒ fals-pozitiv „DEFINER care citește registrul”, doar local (pe prod nu există teste.n).
-- teste.n își păstrează contractul (rulează SQL-ul ca rolul curent, întoarce ROW_COUNT), dar corpul lui nu mai numește
-- o funcție cu SQL dinamic din închidere.
-- r5g (#825, Jak P1): r5f o chema printr-un operator — tocmai calea pe care poarta o refuză acum explicit („invocare
-- implicită neanalizată”: operator peste o funcție din închidere). Executorul stă în information_schema, schemă exclusă
-- din închidere ca pg_catalog (acolo scrie doar superuserul de bootstrap), deci teste.n îl numește fără să intre în ea.
CREATE FUNCTION information_schema.izo_test_executa_si_numara(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS v = ROW_COUNT; RETURN v;
END $$;
CREATE OR REPLACE FUNCTION teste.n(p_sql text) RETURNS bigint LANGUAGE sql AS $$ SELECT information_schema.izo_test_executa_si_numara(p_sql) $$;
GRANT EXECUTE ON FUNCTION information_schema.izo_test_executa_si_numara(text) TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA teste TO authenticator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO authenticator;
