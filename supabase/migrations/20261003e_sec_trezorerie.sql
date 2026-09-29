-- ============================================================================
-- 20261003e_sec_trezorerie.sql — SEC trezorerie: citire/scriere pe trezorerie_conturi +
-- trezorerie_extras_linii doar pentru actorii din matricea țintă (NEAPLICAT, DOAR LOCAL).
--
-- Gaura (structurală, NU abuz demonstrat): politicile trez_conturi_rw / trez_linii_rw sunt
-- FOR ALL TO authenticated USING/WITH CHECK (auth.uid() IS NOT NULL) → orice cont logat
-- citește, modifică și șterge conturile de trezorerie (IBAN) și soldurile din extrase.
--
-- Matricea țintă scrisă aici = VARIANTA A (recomandată, de aprobat de Răzvan):
--   citire  = owner SAU profiles.can_access_financiar   → public.fn_trezorerie_poate_citi()
--   scriere = owner SAU profiles.can_access_financiar   → public.fn_trezorerie_poate_scrie()
-- Cele două drepturi sunt decizii SEPARATE, în helperi separați: scrierea NU se deduce din
-- citire. Schimbarea variantei = corpul unui singur helper (+ amprentele lui de mai jos).
-- Invariant tehnic: scriere ⊆ citire (UPDATE/DELETE cu WHERE/RETURNING cer și SELECT).
--
-- Tot aici: anon și PUBLIC pierd orice privilegiu pe tabele/secvențe; authenticated păstrează
-- doar SELECT/INSERT/UPDATE/DELETE (fără TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) și USAGE/SELECT
-- pe secvențe. service_role (BYPASSRLS, edge) și postgres (owner) rămân neschimbate.
--
-- Un singur gestionar al tranzacției: FIȘIERUL (BEGIN … COMMIT). Precondiții fail-closed și
-- NULL-safe; postcondiția rulează ÎNAINTE de COMMIT și anulează tot la orice abatere.
-- Reaplicare: acceptată numai din starea exactă a patch-ului (pereche politici + helperi).
-- Revenirea tehnică stă în supabase/revenire/ (NU se descoperă ca migrare forward).
-- ============================================================================
BEGIN;
SET LOCAL search_path = public, pg_temp;   -- deparse determinist pentru amprente
SET LOCAL lock_timeout = '5s';

-- 0. PRECONDIȚII ---------------------------------------------------------------
DO $pre$
DECLARE
  -- amprenta politicilor: nume|cmd|permisivă|roluri|md5(USING)|md5(WITH CHECK), ';' între politici
  c_init_c CONSTANT text := 'trez_conturi_rw|*|true|authenticated|dc71e447411e7aaf354179a11ad2e2ae|dc71e447411e7aaf354179a11ad2e2ae';
  c_init_l CONSTANT text := 'trez_linii_rw|*|true|authenticated|dc71e447411e7aaf354179a11ad2e2ae|dc71e447411e7aaf354179a11ad2e2ae';
  c_patch_c CONSTANT text := 'trez_conturi_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_conturi_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_conturi_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_conturi_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_patch_l CONSTANT text := 'trez_linii_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_linii_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_linii_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_linii_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_md5_citi  CONSTANT text := '82ba039146f7daf609e5abafb9f243a0';
  c_md5_scrie CONSTANT text := '507e5309bb291ab712bb2df9a14fea42';
  v_fp_c text; v_fp_l text; v_nh int; v_hok int; t regclass;
BEGIN
  IF to_regclass('public.trezorerie_conturi') IS NULL OR to_regclass('public.trezorerie_extras_linii') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITIE: tabelele trezorerie lipsesc';
  END IF;
  FOREACH t IN ARRAY ARRAY['public.trezorerie_conturi'::regclass, 'public.trezorerie_extras_linii'::regclass] LOOP
    IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = t) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'PRECONDITIE: RLS nu e activ pe %', t;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'PRECONDITIE: auth.uid() lipsește'; END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('id','is_owner','can_access_financiar')) IS DISTINCT FROM 3::bigint THEN
    RAISE EXCEPTION 'PRECONDITIE: profiles(id,is_owner,can_access_financiar) lipsesc';
  END IF;

  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_c FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_conturi'::regclass;
  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_l FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_extras_linii'::regclass;

  -- helperii: câți există (orice semnătură) și câți sunt EXACT cei din patch
  SELECT count(*) INTO v_nh FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.proname IN ('fn_trezorerie_poate_citi','fn_trezorerie_poate_scrie');
  SELECT count(*) INTO v_hok FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.pronargs = 0
     AND f.prorettype = 'boolean'::regtype AND f.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
     AND f.prosecdef IS TRUE AND f.provolatile = 's'
     AND f.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND f.proowner = 'postgres'::regrole
     AND ((f.proname = 'fn_trezorerie_poate_citi'  AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_citi)
       OR (f.proname = 'fn_trezorerie_poate_scrie' AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_scrie));

  -- numai două perechi acceptate: (live de azi, fără helperi) sau (patch, helperii exacți)
  IF v_fp_c IS NOT DISTINCT FROM c_init_c AND v_fp_l IS NOT DISTINCT FROM c_init_l AND v_nh = 0 THEN
    RAISE NOTICE 'sec_trezorerie: stare inițială recunoscută, aplic';
  ELSIF v_fp_c IS NOT DISTINCT FROM c_patch_c AND v_fp_l IS NOT DISTINCT FROM c_patch_l AND v_nh = 2 AND v_hok = 2 THEN
    RAISE NOTICE 'sec_trezorerie: starea patch-ului deja prezentă, reaplic idempotent';
  ELSE
    RAISE EXCEPTION 'PRECONDITIE: stare necunoscută (politici conturi=%, linii=%, helperi=%/%), refuz', v_fp_c, v_fp_l, v_nh, v_hok;
  END IF;
END
$pre$;

-- 1. POLITICI: le scot pe cele deschise ------------------------------------------
DROP POLICY IF EXISTS trez_conturi_rw ON public.trezorerie_conturi;
-- @@INJECTIE_1@@
DROP POLICY IF EXISTS trez_linii_rw ON public.trezorerie_extras_linii;

-- 2. HELPERI — singurul loc unde stă decizia lui Răzvan ----------------------------
CREATE OR REPLACE FUNCTION public.fn_trezorerie_poate_citi()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  -- CITIRE trezorerie (varianta A): owner SAU can_access_financiar (flag protejat de trigger, owner-only).
  -- UID absent / profil absent → false (EXISTS nu întoarce niciodată NULL).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_owner IS TRUE OR p.can_access_financiar IS TRUE)
  )
$fn$;

CREATE OR REPLACE FUNCTION public.fn_trezorerie_poate_scrie()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  -- SCRIERE trezorerie (varianta A): owner SAU can_access_financiar. Decizie SEPARATĂ de citire;
  -- trebuie să rămână submulțime a citirii (UPDATE/DELETE cu WHERE cer și SELECT).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_owner IS TRUE OR p.can_access_financiar IS TRUE)
  )
$fn$;

REVOKE ALL ON FUNCTION public.fn_trezorerie_poate_citi()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_trezorerie_poate_scrie() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi()  TO authenticated;   -- evaluat în politici ca authenticated
GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_scrie() TO authenticated;

-- 3. POLITICI NOI (citire și scriere separate) -----------------------------------
DROP POLICY IF EXISTS trez_conturi_select ON public.trezorerie_conturi;
DROP POLICY IF EXISTS trez_conturi_insert ON public.trezorerie_conturi;
DROP POLICY IF EXISTS trez_conturi_update ON public.trezorerie_conturi;
DROP POLICY IF EXISTS trez_conturi_delete ON public.trezorerie_conturi;
CREATE POLICY trez_conturi_select ON public.trezorerie_conturi FOR SELECT TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_citi()));
CREATE POLICY trez_conturi_insert ON public.trezorerie_conturi FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_conturi_update ON public.trezorerie_conturi FOR UPDATE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie())) WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_conturi_delete ON public.trezorerie_conturi FOR DELETE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie()));

DROP POLICY IF EXISTS trez_linii_select ON public.trezorerie_extras_linii;
DROP POLICY IF EXISTS trez_linii_insert ON public.trezorerie_extras_linii;
DROP POLICY IF EXISTS trez_linii_update ON public.trezorerie_extras_linii;
DROP POLICY IF EXISTS trez_linii_delete ON public.trezorerie_extras_linii;
CREATE POLICY trez_linii_select ON public.trezorerie_extras_linii FOR SELECT TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_citi()));
CREATE POLICY trez_linii_insert ON public.trezorerie_extras_linii FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_linii_update ON public.trezorerie_extras_linii FOR UPDATE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie())) WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_linii_delete ON public.trezorerie_extras_linii FOR DELETE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie()));

-- 4. PRIVILEGII (REVOKE ALL acoperă și MAINTAIN pe PG17) ---------------------------
REVOKE ALL ON public.trezorerie_conturi, public.trezorerie_extras_linii FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trezorerie_conturi, public.trezorerie_extras_linii TO authenticated;
REVOKE ALL ON SEQUENCE public.trezorerie_conturi_id_seq, public.trezorerie_extras_linii_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.trezorerie_conturi_id_seq, public.trezorerie_extras_linii_id_seq TO authenticated;

-- 5. POSTCONDIȚIE (înainte de COMMIT) ----------------------------------------------
DO $post$
DECLARE
  c_patch_c CONSTANT text := 'trez_conturi_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_conturi_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_conturi_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_conturi_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_patch_l CONSTANT text := 'trez_linii_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_linii_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_linii_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_linii_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_md5_citi  CONSTANT text := '82ba039146f7daf609e5abafb9f243a0';
  c_md5_scrie CONSTANT text := '507e5309bb291ab712bb2df9a14fea42';
  v_fp_c text; v_fp_l text; v_n int; t regclass; s regclass; r text; pr text; f regprocedure;
BEGIN
  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_c FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_conturi'::regclass;
  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_l FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_extras_linii'::regclass;
  IF v_fp_c IS DISTINCT FROM c_patch_c OR v_fp_l IS DISTINCT FROM c_patch_l THEN
    RAISE EXCEPTION 'POSTCONDITIE: politici neașteptate (conturi=%, linii=%)', v_fp_c, v_fp_l;
  END IF;

  FOREACH t IN ARRAY ARRAY['public.trezorerie_conturi'::regclass, 'public.trezorerie_extras_linii'::regclass] LOOP
    IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = t) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'POSTCONDITIE: RLS oprit pe %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'POSTCONDITIE: granturi pe coloane pe %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = t
                AND (x.grantee = 0 OR pg_get_userbyid(x.grantee) NOT IN ('postgres','service_role','authenticated'))) THEN
      RAISE EXCEPTION 'POSTCONDITIE: grantee neașteptat pe %', t;
    END IF;
    -- privilegii EFECTIVE (includ PUBLIC și moștenirea)
    FOREACH r IN ARRAY ARRAY['anon','public'] LOOP
      FOREACH pr IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(r, t, pr) IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are % pe %', r, pr, t;
        END IF;
      END LOOP;
      FOREACH pr IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_any_column_privilege(r, t, pr) IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are % pe coloane din %', r, pr, t;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH pr IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('authenticated', t, pr) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'POSTCONDITIE: authenticated fără % pe %', pr, t;
      END IF;
      IF has_table_privilege('service_role', t, pr) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'POSTCONDITIE: service_role fără % pe % (edge afectat)', pr, t;
      END IF;
    END LOOP;
    FOREACH pr IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('authenticated', t, pr) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'POSTCONDITIE: authenticated are % pe %', pr, t;
      END IF;
    END LOOP;
    IF current_setting('server_version_num')::int >= 170000 THEN
      FOREACH r IN ARRAY ARRAY['anon','public','authenticated'] LOOP
        IF has_table_privilege(r, t, 'MAINTAIN') IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are MAINTAIN pe %', r, t;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  FOREACH s IN ARRAY ARRAY['public.trezorerie_conturi_id_seq'::regclass, 'public.trezorerie_extras_linii_id_seq'::regclass] LOOP
    FOREACH r IN ARRAY ARRAY['anon','public'] LOOP
      FOREACH pr IN ARRAY ARRAY['USAGE','SELECT','UPDATE'] LOOP
        IF has_sequence_privilege(r, s, pr) IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are % pe %', r, pr, s;
        END IF;
      END LOOP;
    END LOOP;
    IF has_sequence_privilege('authenticated', s, 'USAGE') IS DISTINCT FROM true
       OR has_sequence_privilege('authenticated', s, 'UPDATE') IS DISTINCT FROM false
       OR has_sequence_privilege('service_role', s, 'USAGE') IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'POSTCONDITIE: privilegii neașteptate pe %', s;
    END IF;
  END LOOP;

  -- helperii: atribute exacte
  SELECT count(*) INTO v_n FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.proname IN ('fn_trezorerie_poate_citi','fn_trezorerie_poate_scrie');
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'POSTCONDITIE: % variante de helperi (se cer 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.pronargs = 0
     AND f.prorettype = 'boolean'::regtype AND f.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
     AND f.prosecdef IS TRUE AND f.provolatile = 's'
     AND f.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND f.proowner = 'postgres'::regrole
     AND ((f.proname = 'fn_trezorerie_poate_citi'  AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_citi)
       OR (f.proname = 'fn_trezorerie_poate_scrie' AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_scrie));
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'POSTCONDITIE: atributele helperilor diferă (prosrc/secdef/config/owner)'; END IF;

  FOREACH f IN ARRAY ARRAY['public.fn_trezorerie_poate_citi()'::regprocedure, 'public.fn_trezorerie_poate_scrie()'::regprocedure] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') IS DISTINCT FROM true
       OR has_function_privilege('anon', f, 'EXECUTE') IS DISTINCT FROM false
       OR has_function_privilege('public', f, 'EXECUTE') IS DISTINCT FROM false
       OR has_function_privilege('service_role', f, 'EXECUTE') IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'POSTCONDITIE: EXECUTE neașteptat pe %', f;
    END IF;
  END LOOP;
  -- @@INJECTIE_2@@
  RAISE NOTICE 'sec_trezorerie: postcondiție OK';
END
$post$;

COMMIT;
