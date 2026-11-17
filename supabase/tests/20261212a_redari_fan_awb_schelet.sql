-- Schema FALSĂ, minimă, pentru proba PGlite a migrării 20261212a (FAN Courier). NU e schema reală: doar coloanele și constrângerile
-- pe care migrarea le citește / scrie (red_plicuri: stare, lot, awb + data_expediere legate prin CHECK, ca în 20261129i).
-- fn_red_nivel() se adaugă de harness EXACT din 20261126a. Rolurile și auth.uid() ca pe Supabase (sub din request.jwt.claim.sub / claims).
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- ca pe Supabase: privilegiile implicite dau tot rolurilor API pe obiectele noi (migrarea trebuie să le retragă singură)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid REFERENCES public.profiles(id), module text, access_level text);
CREATE TABLE public.red_proiecte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL UNIQUE);
CREATE TABLE public.red_loturi_plicuire (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nr_lot text NOT NULL);
CREATE TABLE public.red_plicuri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  lot_id uuid REFERENCES public.red_loturi_plicuire(id),
  nr_plic text NOT NULL UNIQUE,
  destinatar_nume text,
  stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  awb text CHECK (awb IS NULL OR awb ~ '^[A-Z0-9]{4,40}$'),
  data_expediere date,
  CONSTRAINT red_plicuri_expediere CHECK ((awb IS NULL) = (data_expediere IS NULL))
);
GRANT SELECT ON public.profiles, public.user_module_access, public.red_proiecte, public.red_loturi_plicuire, public.red_plicuri TO authenticated;
