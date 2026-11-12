-- Schema FALSĂ tip Supabase pentru proba LOCALĂ (PGlite) a migrării 20261132a — NU e producția și nu conține date reale.
-- Folosită DOAR de scripts/pglite/test_ofertare_inchidere_garda_local.mjs. Funcțiile lanțului (fn_are_acces_ofertare,
-- fn_ofertare_licitatii_scriere, fn_ofertare_responsabil_setat_de, fn_ofertare_poate_cheltui) NU sunt scrise aici: runnerul le copiază
-- EXACT din migrările lor (20260912, 20260928p, 20261124a), cu REVOKE / GRANT-urile lor, în locul marcajului „@FUNCTII_DIN_MIGRARI”.
-- Trigger-ul trg_ofertare_j02b_sens_unic are aici o funcție-ÎNLOCUITOR (nu cea reală): proba lui N1 e „corpul unei funcții de trigger
-- se schimbă”, nu logica J02b. Rolurile: ca în producție (authenticator LOGIN NOINHERIT membru în anon / authenticated / service_role;
-- service_role BYPASSRLS; supabase_admin SUPERUSER); privilegiile implicite dau totul rolurilor API, ca în Supabase.
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')           THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')  THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')   THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator')  THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin LOGIN SUPERUSER; END IF;
END $roluri$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_citire ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE TABLE public.user_module_access (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL, access_level text NOT NULL DEFAULT 'edit');
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY uma_citire ON public.user_module_access FOR SELECT TO authenticated USING (profile_id = auth.uid());

-- coloanele citite de gardă, de lanțul ei și de fixture-ul dry-run-ului (tipurile ca în producție; CHECK-ul de status real)
CREATE TABLE public.ofertare_licitatii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nr_anunt text NOT NULL UNIQUE,
  autoritate text NOT NULL,
  obiect text NOT NULL,
  termen_depunere timestamptz,
  status text NOT NULL DEFAULT 'identificata'::text CONSTRAINT ofertare_licitatii_status_check
    CHECK (status = ANY (ARRAY['identificata'::text, 'analiza'::text, 'go'::text, 'in_lucru'::text, 'depusa'::text, 'castigata'::text, 'pierduta'::text, 'abandonata'::text])),
  decizie_go text CONSTRAINT ofertare_licitatii_decizie_go_check CHECK (decizie_go = ANY (ARRAY['go'::text, 'no_go'::text])),
  decizie_motivare text,
  observatii text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  documentatie_adusa_la timestamptz,
  contract_id bigint,
  responsabil_id uuid REFERENCES public.profiles(id),
  responsabil_setat_de uuid,
  responsabil2_id uuid REFERENCES public.profiles(id),
  responsabil2_setat_de uuid,
  responsabil_numitor_autorizat boolean,
  responsabil2_numitor_autorizat boolean);
ALTER TABLE public.ofertare_licitatii ENABLE ROW LEVEL SECURITY;

-- @FUNCTII_DIN_MIGRARI

-- politicile din 20260928p (text identic)
CREATE POLICY ofertare_licitatii_select ON public.ofertare_licitatii
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_licitatii_insert ON public.ofertare_licitatii
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_licitatii_update ON public.ofertare_licitatii
  FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()) OR EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()) OR EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ));
CREATE POLICY ofertare_licitatii_delete ON public.ofertare_licitatii
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner
  ));

-- trigger-ele (numele și momentele din producție; a00 și trg_ofertare_responsabil_setat_de cu funcțiile reale)
CREATE TRIGGER a00_ofertare_licitatii_scriere
  BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_licitatii_scriere();
CREATE TRIGGER trg_ofertare_responsabil_setat_de BEFORE INSERT OR UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_responsabil_setat_de();
CREATE FUNCTION public.fn_ofertare_j02b_sens_unic()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- ÎNLOCUITOR de test (schema falsă): nu schimbă nimic
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ofertare_j02b_sens_unic() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_ofertare_j02b_sens_unic BEFORE INSERT OR UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_j02b_sens_unic();

-- profiluri de test (UUID-uri sintetice): owner, doi colegi cu Ofertare (unul admin), unul fără Ofertare / Financiar, unul doar Financiar
INSERT INTO public.profiles (id, full_name, is_owner) VALUES
  ('00000000-0000-4000-8000-000000000121', 'TEST OWNER', true),
  ('00000000-0000-4000-8000-000000000001', 'TEST RESPONSABIL', false),
  ('00000000-0000-4000-8000-000000000002', 'TEST COLEG', false),
  ('00000000-0000-4000-8000-000000000003', 'TEST FARA MODUL', false),
  ('00000000-0000-4000-8000-000000000004', 'TEST FINANCIAR', false),
  ('00000000-0000-4000-8000-000000000005', 'TEST ADMIN OFERTARE', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-4000-8000-000000000001', 'ofertare', 'edit'),
  ('00000000-0000-4000-8000-000000000002', 'ofertare', 'edit'),
  ('00000000-0000-4000-8000-000000000004', 'financiar', 'edit'),
  ('00000000-0000-4000-8000-000000000005', 'ofertare', 'admin');
