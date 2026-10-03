-- Exclusiv fixture sintetic local, niciodată pe producție.
DO $garda$ BEGIN
  IF current_database() <> 'ofertare_pf_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Fixture permis numai pe ofertare_pf_test local';
  END IF;
END $garda$;
-- @@PLATFORMA — în etapa prod-like a harness-ului o creează supabase_admin (nu se rulează de aici).
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
-- Corp IDENTIC cu auth.uid() de pe live (md5 cdef18c69c4f4cbbced2eaf81e628b49, ca în supabase/tests/j05_garda.test.sql).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- @@APLICATIE — în etapa prod-like rulează ca postgres NOSUPERUSER (de aici până la final).
DO $garda_app$ BEGIN
  IF current_database() <> 'ofertare_pf_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Fixture permis numai pe ofertare_pf_test local';
  END IF;
END $garda_app$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access(profile_id uuid REFERENCES public.profiles(id), module text NOT NULL,
  access_level text NOT NULL CONSTRAINT user_module_access_level_chk CHECK (access_level = ANY (ARRAY['admin','editor','viewer'])));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_sel ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY access_sel ON public.user_module_access FOR SELECT TO authenticated USING (profile_id = auth.uid());
GRANT SELECT ON public.profiles, public.user_module_access TO authenticated;
CREATE TABLE public.ofertare_licitatii(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
CREATE TABLE public.executie_proiecte(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, valoare_lei numeric(15,2));
CREATE TABLE public.ofertare_documente_atribuire(id bigint PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.ofertare_formulare_registru (
  id bigserial PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  document_sursa_id bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  cod text,                                                 -- ex. „Formularul nr. 3"
  denumire text NOT NULL,
  aplicabil boolean NOT NULL DEFAULT true,
  motiv_aplicabil text,
  cine_completeaza text,
  cine_semneaza text,
  stare_pregatire text NOT NULL DEFAULT 'de_pregatit' CHECK (stare_pregatire IN ('de_pregatit','ciorna','verificat','semnat')),
  stare_depunere text NOT NULL DEFAULT 'nu' CHECK (stare_depunere IN ('nu','in_pachet','incarcat_seap','confirmat')),
  fisier_path text,
  fisier_hash text,                                         -- semnătura e legată de versiunea fișierului
  documente_suport text,
  observatii text,
  citat text,                                               -- fragment din secțiunea formulare (sursa propunerii AI)
  sursa text NOT NULL DEFAULT 'ai' CHECK (sursa IN ('ai','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$fn$;
COMMENT ON FUNCTION public.fn_are_acces_ofertare() IS
  'Acces la modulul Ofertare pentru utilizatorul curent: is_owner sau intrare explicita in user_module_access. Fara parametru, ca sa nu poata fi folosita ca sonda pe alte conturi. SECURITY DEFINER pentru ca profiles si user_module_access au RLS.';
REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;


ALTER TABLE public.ofertare_formulare_registru ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ofertare_formulare_registru TO authenticated, service_role;
CREATE POLICY ofertare_formulare_sel ON public.ofertare_formulare_registru FOR SELECT TO authenticated USING (public.fn_are_acces_ofertare());
-- grafic_activitati: coloanele și politica SELECT ca pe live (preflight 03.10); scrierea prin fn_are_acces_ofertare().
CREATE TABLE public.grafic_activitati (
  id bigserial PRIMARY KEY,
  proiect_id bigint REFERENCES public.executie_proiecte(id) ON DELETE CASCADE,
  licitatie_id bigint REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  denumire text NOT NULL DEFAULT 'Activitate', durata_zile integer NOT NULL DEFAULT 1, nivel integer NOT NULL DEFAULT 0,
  ordine integer NOT NULL DEFAULT 0, valoare_lei numeric
);
ALTER TABLE public.grafic_activitati ENABLE ROW LEVEL SECURITY;
CREATE POLICY grafic_act_sel ON public.grafic_activitati FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY grafic_act_ins ON public.grafic_activitati FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY grafic_act_upd ON public.grafic_activitati FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY grafic_act_del ON public.grafic_activitati FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grafic_activitati TO authenticated;
GRANT USAGE ON SEQUENCE public.grafic_activitati_id_seq TO authenticated;
INSERT INTO public.profiles(id,is_owner) VALUES
 ('00000000-0000-0000-0000-000000000001',true), ('00000000-0000-0000-0000-000000000002',false),
 ('00000000-0000-0000-0000-000000000003',false), ('00000000-0000-0000-0000-000000000004',false),
 ('00000000-0000-0000-0000-000000000005',false);
-- 2 = PF editor, 3 = doar Ofertare general, 4 = nimic, 5 = PF viewer (citește, nu scrie).
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES ('00000000-0000-0000-0000-000000000002','ofertare_pf','editor'),
 ('00000000-0000-0000-0000-000000000003','ofertare','editor'),('00000000-0000-0000-0000-000000000005','ofertare_pf','viewer');
INSERT INTO public.ofertare_licitatii DEFAULT VALUES;
INSERT INTO public.ofertare_licitatii DEFAULT VALUES;
INSERT INTO public.executie_proiecte(valoare_lei) VALUES (123.45),(678.90);
INSERT INTO public.ofertare_formulare_registru(licitatie_id,cod,denumire,fisier_path,stare_depunere) VALUES
 (1,'F1','Formular sintetic','fixture/f1.pdf','confirmat'),(2,'F2','Altă licitație','fixture/f2.pdf','nu');
