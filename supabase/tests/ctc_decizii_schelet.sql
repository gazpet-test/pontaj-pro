-- Schelet minimal pentru harness-ul 20261023a (CTC citește decizii pe proiect). Corpurile funcțiilor = verbatim live 09.10.2026.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false, department text,
  can_manage_contracts boolean DEFAULT false, employee_id bigint);
CREATE TABLE public.user_module_access (profile_id uuid, module text, access_level text DEFAULT 'viewer');
CREATE TABLE public.hr_decizii (id bigint PRIMARY KEY, nivel text, stare text, tip_cod text, proiect_id bigint, creat_de uuid);
ALTER TABLE public.hr_decizii ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_decizii TO authenticated;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public._hr_decizii_termeni(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH p AS (SELECT * FROM public.profiles WHERE id = p_profile_id),
  t AS (
    SELECT coalesce((SELECT p.is_owner FROM p), false) AS owner,
           coalesce((SELECT p.department = 'HR' FROM p), false)
             OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id
                          AND u.module = 'hr.decizii' AND u.access_level IN ('editor','admin')) AS hr,
           EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id AND u.module = 'hr.decizii') AS hr_dec,
           EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id AND u.module = 'executie')
             OR coalesce((SELECT p.can_manage_contracts FROM p), false) AS exec,
           coalesce((SELECT p.can_manage_contracts FROM p), false) AS cmc,
           coalesce((SELECT p.employee_id IS NOT NULL FROM p), false) AS are_fisa
  )
  SELECT jsonb_build_object(
    'owner', t.owner, 'hr', t.hr, 'hr_citire', t.hr OR t.hr_dec, 'exec', t.exec,
    'confirm', t.owner OR t.cmc, 'are_fisa', t.are_fisa)
  FROM t
$function$
;
CREATE OR REPLACE FUNCTION public.fn_hr_decizii_poate(p_actiune text, p_decizie_id bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t jsonb; v_owner boolean; v_hr boolean; v_hrc boolean; v_exec boolean; v_conf boolean; v_fisa boolean;
  v_pe_proiect boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  t := public._hr_decizii_termeni(auth.uid());
  v_owner := coalesce((t->>'owner')::boolean, false);
  v_hr := coalesce((t->>'hr')::boolean, false);
  v_hrc := coalesce((t->>'hr_citire')::boolean, false);
  v_exec := coalesce((t->>'exec')::boolean, false);
  v_conf := coalesce((t->>'confirm')::boolean, false);
  v_fisa := coalesce((t->>'are_fisa')::boolean, false);
  IF p_decizie_id IS NOT NULL THEN
    v_pe_proiect := coalesce((SELECT d.nivel = 'proiect' AND d.stare <> 'draft' AND d.tip_cod <> 'ALTA_DECIZIE'
                                FROM public.hr_decizii d WHERE d.id = p_decizie_id), false);
  END IF;
  RETURN coalesce(CASE p_actiune
    WHEN 'citire' THEN v_owner OR v_hrc
    WHEN 'citire_doc' THEN v_owner OR v_hrc OR (v_exec AND v_pe_proiect)
    WHEN 'citire_scan' THEN v_owner OR v_hr OR (v_conf AND v_pe_proiect AND v_fisa)
    WHEN 'redactare' THEN v_owner OR v_hr
    WHEN 'emitere' THEN v_owner OR v_hr
    WHEN 'rezervare' THEN v_owner OR v_hr
    WHEN 'scan' THEN v_owner OR v_hr
    WHEN 'anulare' THEN v_owner OR v_hr
    WHEN 'import' THEN v_owner OR v_hr
    WHEN 'contor' THEN v_owner OR v_hr
    WHEN 'owner' THEN v_owner
    ELSE false END, false);
END $function$
;
REVOKE ALL ON FUNCTION public._hr_decizii_termeni(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_hr_decizii_poate(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_poate(text,bigint) TO authenticated;

CREATE POLICY hr_decizii_select ON public.hr_decizii FOR SELECT USING (fn_hr_decizii_poate('citire'::text) OR ((nivel = 'proiect'::text) AND (stare <> 'draft'::text) AND (tip_cod <> 'ALTA_DECIZIE'::text) AND fn_hr_decizii_poate('citire_doc'::text, id)));
CREATE POLICY hr_decizii_update ON public.hr_decizii FOR UPDATE USING ((stare = 'draft'::text) AND fn_hr_decizii_poate('redactare'::text));
CREATE POLICY hr_decizii_delete ON public.hr_decizii FOR DELETE USING ((stare = 'draft'::text) AND fn_hr_decizii_poate('redactare'::text) AND ((creat_de = auth.uid()) OR fn_hr_decizii_poate('owner'::text)));

-- Date: 1 proiect A, 2 proiect B, 3 draft, 4 ALTA_DECIZIE, 5 firma, 6 anulata (proiect)
INSERT INTO public.hr_decizii VALUES (1,'proiect','emisa','NUMIRE_SEF',10,NULL),(2,'proiect','semnata','NUMIRE_SEF',20,NULL),
  (3,'proiect','draft','NUMIRE_SEF',10,NULL),(4,'proiect','emisa','ALTA_DECIZIE',10,NULL),(5,'firma','emisa','NUMIRE_SEF',NULL,NULL),
  (6,'proiect','anulata','NUMIRE_SEF',10,NULL);
-- Profile: c1 = doar 'ctc' fără fișă · c2 = 'ctc.carti' · cx = 'ctcX' · o = owner · h = HR · e = executie · z = nimic
INSERT INTO public.profiles(id,is_owner,department,employee_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1',false,NULL,NULL),('00000000-0000-0000-0000-0000000000c2',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000cf',false,NULL,NULL),('00000000-0000-0000-0000-0000000000aa',true,NULL,1),
  ('00000000-0000-0000-0000-0000000000bb',false,'HR',2),('00000000-0000-0000-0000-0000000000ee',false,NULL,3),
  ('00000000-0000-0000-0000-0000000000ff',false,NULL,NULL);
INSERT INTO public.user_module_access(profile_id,module) VALUES
  ('00000000-0000-0000-0000-0000000000c1','ctc'),('00000000-0000-0000-0000-0000000000c2','ctc.carti'),
  ('00000000-0000-0000-0000-0000000000cf','ctcX'),('00000000-0000-0000-0000-0000000000ee','executie');

-- Pentru runner (scripts/livrare_migrare.sh): cron.job (gate 0e) + istoricul migrărilor
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, nodename text DEFAULT 'localhost', nodeport integer DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT CURRENT_USER, active boolean DEFAULT true, jobname text);
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
