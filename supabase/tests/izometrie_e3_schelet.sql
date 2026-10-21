-- Extensia scheletului E2a pentru E3 (20261103b) — DOAR într-o bază locală *_test, după izometrie_e2a_schelet.sql.
-- Reproduce ce citește E3 de pe live (21.10.2026): auth.role(); storage.buckets / storage.objects (RLS, owner separat);
-- indexul unic user_module_access (profile_id, module); trigger-ele profiles prevent_role_escalation_trigger /
-- trg_profiles_campuri_owner_only (aici: stub-uri care refuză auto-promovarea is_owner).
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE UNIQUE INDEX user_module_access_profile_id_module_key ON public.user_module_access (profile_id, module);

CREATE FUNCTION public.prevent_role_escalation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_owner IS DISTINCT FROM OLD.is_owner AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'escaladare refuzată' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prevent_role_escalation_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();
CREATE FUNCTION public.fn_profiles_campuri_owner_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_campuri_owner_only();
CREATE POLICY profiles_upd_own ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
GRANT UPDATE ON public.profiles TO authenticated;

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text,
  owner uuid, created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
-- un bucket și o politică existente, ca pe live (Logistica): nu trebuie atinse de E3
INSERT INTO storage.buckets (id, name) VALUES ('avize', 'avize');
CREATE POLICY avize_authenticated_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'avize' AND auth.role() = 'authenticated');
GRANT USAGE ON SCHEMA teste TO authenticator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO authenticator;
