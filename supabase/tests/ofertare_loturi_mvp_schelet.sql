-- Schelet sintetic LOCAL pentru 20261024b_ofertare_loturi_mvp — NICIODATĂ pe producție (garda de mai jos).
-- Sursa: coloane/funcții/politici citite din producție la 12.10.2026 (information_schema, pg_get_functiondef, pg_policies),
-- reduse la ce atinge migrarea. Copiate verbatim: auth.uid(), fn_are_acces_ofertare(), fn_ofertare_source_pack_poate_decide(),
-- fn_ofertare_licitatii_scriere() + triggerul a00 (RPC-ul de loturi scrie pe ofertare_licitatii prin el).
-- Simplificări: postgres local e SUPERUSER (în producție NOSUPERUSER + BYPASSRLS); tabelele au doar coloanele relevante;
-- celelalte triggere de pe tabele (gate depunere, j02b, chei server, nr_ordine etc.) nu sunt copiate.
DO $garda$ BEGIN
  IF current_database() <> 'ofertare_loturi_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Schelet permis numai pe ofertare_loturi_test local';
  END IF;
END $garda$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
-- PostgREST intră ca authenticator (session_user) și face SET ROLE; garda de loturi decide pe session_user.
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
-- Supabase: orice obiect nou din public primește drepturi pentru rolurile API (de aceea migrarea revocă explicit).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
CREATE SCHEMA supabase_migrations;

CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access(id serial PRIMARY KEY, profile_id uuid REFERENCES public.profiles(id), module text NOT NULL,
  access_level text NOT NULL DEFAULT 'editor');
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_sel ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY access_sel ON public.user_module_access FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE FUNCTION public.fn_are_acces_ofertare()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$;

CREATE TABLE public.ofertare_licitatii(
  id bigint PRIMARY KEY, nr_anunt text, responsabil_id uuid, loturi jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'identificata', termen_depunere timestamptz, documentatie_adusa_la timestamptz,
  contract_id bigint, updated_at timestamptz DEFAULT now());
CREATE TABLE public.ofertare_documente_atribuire(
  id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  nume_original text, tip text NOT NULL DEFAULT 'alta', status_procesare text NOT NULL DEFAULT 'neprocesat');
CREATE TABLE public.ofertare_cerinte(id bigint PRIMARY KEY, licitatie_id bigint NOT NULL, sursa_document_id bigint, lot text);
CREATE TABLE public.ofertare_cantitati(id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, denumire text NOT NULL,
  status text NOT NULL DEFAULT 'extras');

CREATE FUNCTION public.fn_ofertare_source_pack_poate_decide(p_licitatie_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id AND l.responsabil_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare' AND uma.access_level = 'admin')
  );
$function$;

CREATE FUNCTION public.fn_ofertare_licitatii_scriere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- SECURITY DEFINER: current_user este proprietarul funcției, nu apelantul.
  v_admin boolean := (session_user = 'postgres');
  v_ofertare boolean := (SELECT public.fn_are_acces_ofertare());
  v_service boolean := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true)
  ) = 'service_role';
BEGIN
  IF v_admin OR v_ofertare THEN
    RETURN NEW;
  END IF;
  IF v_service THEN
    IF (to_jsonb(OLD) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(NEW) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at') THEN
      RAISE EXCEPTION 'Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adusa_la'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ) THEN
    RAISE EXCEPTION 'Contextul curent nu poate modifica o licitație'
      USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(OLD) - 'contract_id' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(NEW) - 'contract_id' - 'updated_at') THEN
    RAISE EXCEPTION 'Modulul financiar poate modifica doar contract_id pe o licitație'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER a00_ofertare_licitatii_scriere BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_licitatii_scriere();
-- ACL ca în producție (12.10.2026): authenticated/anon NU execută triggerul; fn_are_acces_ofertare și
-- fn_ofertare_source_pack_poate_decide: authenticated da, anon nu.
REVOKE ALL ON FUNCTION public.fn_ofertare_licitatii_scriere() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare(), public.fn_ofertare_source_pack_poate_decide(bigint) FROM PUBLIC, anon;

-- Politicile de producție (pg_policies 12.10.2026), reduse la cele relevante.
ALTER TABLE public.ofertare_licitatii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_documente_atribuire ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_licitatii_select ON public.ofertare_licitatii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_licitatii_update ON public.ofertare_licitatii FOR UPDATE TO authenticated
  USING ((SELECT fn_are_acces_ofertare())) WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_select ON public.ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_documente_insert ON public.ofertare_documente_atribuire FOR INSERT TO authenticated
  WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_update ON public.ofertare_documente_atribuire FOR UPDATE TO authenticated
  USING ((SELECT fn_are_acces_ofertare())) WITH CHECK ((SELECT fn_are_acces_ofertare()));

-- Date sintetice: owner, responsabil Botoșani (editor), editor Ofertare fără responsabilitate, admin Ofertare, fără modul.
INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000121', true),
  ('00000000-0000-4000-8000-000000000043', false),
  ('00000000-0000-4000-8000-000000000007', false),
  ('00000000-0000-4000-8000-000000000008', false),
  ('00000000-0000-4000-8000-000000000099', false);
INSERT INTO public.user_module_access(profile_id, module, access_level) VALUES
  ('00000000-0000-4000-8000-000000000043', 'ofertare', 'editor'),
  ('00000000-0000-4000-8000-000000000007', 'ofertare', 'editor'),
  ('00000000-0000-4000-8000-000000000008', 'ofertare', 'admin');
INSERT INTO public.ofertare_licitatii(id, nr_anunt, responsabil_id) VALUES
  (102, 'CN1096645', '00000000-0000-4000-8000-000000000043'),
  (3, 'X3', NULL),
  (4, 'X4 concurență', NULL);
INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip) VALUES
  (532, 102, 'Instructiuni_ofertanti_FisaDate.pdf', 'fisa_date'),
  (1247, 102, 'PT FV rev.8.pdf', 'alta'),
  (527, 102, 'Formular propunere tehnica - LOT 1.docx', 'formular'),
  (528, 102, 'Formular propunere tehnica - LOT 2.docx', 'formular'),
  (1302, 102, 'Vizita amplasament.pdf', 'alta'),
  (31, 3, 'cs.pdf', 'cs_volum');
INSERT INTO public.ofertare_cerinte VALUES (1, 102, 527, 'toate'), (2, 102, 528, '2'), (3, 4, NULL, 'Lot 2');
INSERT INTO public.ofertare_cantitati(licitatie_id, denumire) VALUES (102, 'teava PE 110');
