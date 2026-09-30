-- Stub minimal Supabase pentru testul local al monitorului de egress (NU se aplică pe live).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, profile_id uuid NOT NULL, type text NOT NULL, title text NOT NULL, message text, link_to text,
  modul text CHECK (modul = ANY (ARRAY['general','Logistică','Pontaj','Execuție','Financiar','Comercial','Administrativ','HR','Tichete','Rapoarte','Ședințe','Ofertare','Clădire'])),
  read_at timestamptz, action_taken boolean, created_at timestamptz DEFAULT now());
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000121'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000121', 'TRUSU RAZVAN', true), ('00000000-0000-0000-0000-000000000002', 'ALT UTILIZATOR', false);
