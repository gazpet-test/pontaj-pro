-- Schelet minim „tip Supabase” pentru proba LOCALĂ (PGlite, în memorie) a migrării 20261224a (dosarul de revendicare). NU e migrare și nu se
-- rulează pe nicio bază reală. Peste el, runner-ul (scripts/pglite/test_executie_revendicari_local.mjs) creează funcțiile restricției pe
-- proiect EXACT din 20261209a (amprentele se verifică), aplică 20261203a întreagă (fișa contractului) și înlocuiește
-- fn_executie_contract_drept cu forma din 20261209a, ca în producție.
-- Reproduce: rolurile (service_role cu BYPASSRLS), privilegiile implicite din schema public (ALL pentru anon / authenticated / service_role,
-- ca la Supabase — migrarea trebuie să le revoce singură), auth.uid() din cele două surse JWT, tabelele vechi referite cu coloanele citite
-- (tipurile ca în producție: proiect bigint, angajat integer, șantier integer). Fără date: runner-ul le pune (sintetice).
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.employees (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false, employee_id integer REFERENCES public.employees(id));
CREATE UNIQUE INDEX uniq_profiles_employee_id ON public.profiles (employee_id) WHERE employee_id IS NOT NULL;
CREATE TABLE public.user_module_access (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL, access_level text NOT NULL, UNIQUE (profile_id, module));
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, nume text NOT NULL, cod_intern text, activ boolean DEFAULT true,
  mp_employee_id integer REFERENCES public.employees(id));
CREATE TABLE public.sites (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text, proiect_id bigint REFERENCES public.executie_proiecte(id));
CREATE TABLE public.rapoarte_zilnice (id bigserial PRIMARY KEY, site_id integer NOT NULL REFERENCES public.sites(id), data date NOT NULL,
  probleme text, UNIQUE (site_id, data));
CREATE TABLE public.documente_proiect (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  nume_fisier text NOT NULL, storage_path text NOT NULL, hash_sha256 text);
CREATE TABLE public.executie_ordine_sistare (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_sistare date NOT NULL);
-- tabelul restricției pe proiect, ca în 20261209a (fără trigger-ul de proveniență: aici îl scrie doar runner-ul, ca postgres)
CREATE TABLE public.executie_acces_proiect (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
  nivel text NOT NULL DEFAULT 'editor',
  acordat_de uuid,
  acordat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_acces_proiect_pk PRIMARY KEY (profile_id, proiect_id),
  CONSTRAINT executie_acces_proiect_nivel_ck CHECK (nivel IN ('viewer', 'editor'))
);
-- RLS „autentificat” pe tabelele vechi (ca matricea de azi); funcțiile DEFINER ale migrării le citesc ca proprietar
ALTER TABLE public.documente_proiect ENABLE ROW LEVEL SECURITY;
CREATE POLICY documente_autentificat ON public.documente_proiect FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
ALTER TABLE public.executie_ordine_sistare ENABLE ROW LEVEL SECURITY;
CREATE POLICY ordine_autentificat ON public.executie_ordine_sistare FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
