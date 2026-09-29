-- ════════════════════════════════════════════════════════════════════════════
-- Schelet LOCAL (PostgreSQL 16) pentru testele patch-ului 20261003d (hr_concediu_tokens).
-- Reproduce STAREA LIVE din 29.09.2026 (citită read-only din cataloage): tabelul exact ca în
-- migrarea 20260710231046, RLS on, politica hr_tokens_sel, ACL anon/authenticated/service_role = ALL,
-- politicile de SELECT de pe profiles / user_module_access, auth.uid() identic cu Supabase.
-- TOATE tokenurile, UUID-urile și numele de aici sunt FICTIVE. Nu atinge Supabase.
-- Rulează ca superuser local, într-o bază goală. Rolurile sunt la nivel de cluster (cluster dedicat).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
    GRANT anon, authenticated, service_role TO authenticator WITH INHERIT FALSE;  -- ca pe live: noinherit
  END IF;
END $r$;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Identic cu live (pg_proc.prosrc pe auth.uid(), 29.09)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$f$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.employees (id integer PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true, termination_date date);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, name text, role text NOT NULL DEFAULT 'manager_santier', department text,
  is_owner boolean NOT NULL DEFAULT false, can_access_personal_data boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY, profile_id uuid NOT NULL, module text NOT NULL, access_level text NOT NULL DEFAULT 'editor');
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.profiles, public.user_module_access, public.employees TO anon, authenticated, service_role;
-- Politicile de citire live (29.09): oricine logat citește tot
CREATE POLICY profiles_select_all_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY user_module_access_select_authenticated ON public.user_module_access FOR SELECT TO authenticated USING (true);
CREATE POLICY employees_select_all_authenticated ON public.employees FOR SELECT TO authenticated USING (true);

-- Tabelul: text EXACT din migrarea live 20260710231046 (hr_concediu_faza4_5_tokens_reconciliere)
CREATE TABLE public.hr_concediu_tokens (
  employee_id integer PRIMARY KEY REFERENCES public.employees(id),
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_concediu_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.hr_concediu_tokens TO authenticated;
GRANT ALL ON public.hr_concediu_tokens TO service_role;
CREATE POLICY hr_tokens_sel ON public.hr_concediu_tokens FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
-- ACL-ul live (relacl 29.09) = anon/authenticated/service_role = arwdDxtm (default privileges Supabase).
-- Pe PG16 nu există MAINTAIN (m); GRANT ALL dă arwdDxt — amprenta compară pe lista de privilegii a versiunii.
GRANT ALL ON public.hr_concediu_tokens TO anon, authenticated;

-- ── Date FICTIVE ──
INSERT INTO public.employees VALUES
  (1, 'FICTIV Unu', true, NULL), (2, 'FICTIV Doi', true, NULL), (3, 'FICTIV Trei', true, NULL),
  (4, 'FICTIV Patru', true, NULL), (5, 'FICTIV Fost', false, DATE '2026-08-31'), (6, 'FICTIV FaraToken', true, NULL);
INSERT INTO public.hr_concediu_tokens (employee_id, token) VALUES
  (1, 'f1c7f1c7000000000000000000000001'), (2, 'f1c7f1c7000000000000000000000002'),
  (3, 'f1c7f1c7000000000000000000000003'), (4, 'f1c7f1c7000000000000000000000004'),
  (5, 'f1c7f1c7000000000000000000000005');

-- Conturi fictive (UUID-uri de test). Coloana „ui” = vede azi butonul „🔗 Link mobil” (poarta /hr).
INSERT INTO public.profiles (id, name, role, department, is_owner, can_access_personal_data) VALUES
  ('00000000-0000-4000-8000-000000000121', 'OWNER fictiv',            'superadmin',      'Administrativ', true,  true),  -- ui: DA (is_owner)
  ('00000000-0000-4000-8000-000000000126', 'HR fictiv',               'superadmin',      'HR',            false, true),  -- ui: DA (modul hr)
  ('00000000-0000-4000-8000-000000000201', 'Ofertare cu modul hr',    'manager_santier', 'Ofertare',      false, false), -- ui: DA (modul hr)
  ('00000000-0000-4000-8000-000000000202', 'Submodul hr.concedii',    'manager_santier', 'Contabilitate', false, false), -- ui: DA (hr.*)
  ('00000000-0000-4000-8000-000000000301', 'Fara modul',              'manager_santier', NULL,            false, false), -- ui: NU
  ('00000000-0000-4000-8000-000000000302', 'Alte module',             'admin_logistica', 'Logistică',     false, false), -- ui: NU
  ('00000000-0000-4000-8000-000000000303', 'Capcane de prefix',       'manager_santier', NULL,            false, false), -- ui: NU
  ('00000000-0000-4000-8000-000000000304', 'Dept HR fara modul',      'manager_santier', 'HR',            false, false), -- ui: NU (ProtectedRoute)
  ('00000000-0000-4000-8000-000000000305', 'Superadmin fara modul',   'superadmin',      'Administrativ', false, false), -- ui: NU
  ('00000000-0000-4000-8000-000000000306', 'Date personale fara modul','manager_santier', NULL,           false, true);  -- ui: NU
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-4000-8000-000000000126', 'hr', 'admin'),
  ('00000000-0000-4000-8000-000000000201', 'hr', 'editor'),
  ('00000000-0000-4000-8000-000000000201', 'ofertare', 'editor'),
  ('00000000-0000-4000-8000-000000000202', 'hr.concedii', 'viewer'),
  ('00000000-0000-4000-8000-000000000302', 'logistica', 'admin'),
  ('00000000-0000-4000-8000-000000000302', 'ofertare', 'viewer'),
  ('00000000-0000-4000-8000-000000000303', 'HR', 'editor'),        -- majuscule: UI-ul (case-sensitive) NU dă acces
  ('00000000-0000-4000-8000-000000000303', 'hrana', 'editor'),     -- prefix fără punct
  ('00000000-0000-4000-8000-000000000303', 'hr_extern', 'editor'),
  ('00000000-0000-4000-8000-000000000303', 'xhr.concedii', 'editor'),
  ('00000000-0000-4000-8000-000000000303', ' hr', 'editor');

-- ── Unelte de test (schema t; nu intră în amprenta tabelului) ──
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
-- Rulează p_sql ca rolul dat, cu claims JWT (sub = p_uid), într-o sub-tranzacție ANULATĂ mereu
-- (nicio scriere nu rămâne). Întoarce 'OK:<rezultat>' sau 'ERR:<sqlstate>'.
CREATE FUNCTION t.ca(p_rol text, p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text; n bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_uid IS NULL THEN json_build_object('role', p_rol)::text
           ELSE json_build_object('sub', p_uid, 'role', p_rol)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    IF p_sql ~* '^\s*select' THEN EXECUTE p_sql INTO v;
    ELSE EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; v := n::text; END IF;
    RAISE EXCEPTION 'sentinela_t_ca' USING DETAIL = coalesce(v, '<NULL>');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sentinela_t_ca' THEN GET STACKED DIAGNOSTICS v = PG_EXCEPTION_DETAIL; RETURN 'OK:' || v; END IF;
    RETURN 'ERR:' || SQLSTATE;
  END;
END $f$;
-- Amprenta rândurilor vizibile: număr + md5(employee_id=token, ordonat). Tokenurile sunt fictive.
CREATE FUNCTION t.vede(p_rol text, p_uid uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT t.ca(p_rol, p_uid, $q$SELECT count(*) || ':' || coalesce(md5(string_agg(employee_id || '=' || token, ',' ORDER BY employee_id)), '-') FROM public.hr_concediu_tokens$q$)
$f$;
CREATE TABLE t.rezultat (suita text, nr int);
CREATE FUNCTION t.verifica(p_id text, p_obtinut text, p_asteptat text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_obtinut IS DISTINCT FROM p_asteptat THEN
    RAISE EXCEPTION 'TEST EȘUAT: % — obținut [%], așteptat [%]', p_id, p_obtinut, p_asteptat;
  END IF;
  RAISE NOTICE 'ok %', p_id;
END $f$;
