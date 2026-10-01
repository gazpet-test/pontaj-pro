-- ============================================================================
-- REVENIRE TEHNICĂ pentru 20261003e_sec_trezorerie — artefact de revenire excepțională,
-- NU migrare forward, fără GO de execuție implicit. Stă în supabase/revenire/, în afara
-- directorului descoperit automat (supabase/migrations/).
--
-- Fișierul NU conține BEGIN/COMMIT. Operatorul trimite UN SINGUR string (un singur gestionar
-- al tranzacției = operatorul, în aceeași tranzacție cu armarea):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261003e', 'REDESCHIDE_TREZORERIE:' || txid_current(), true);
--   <conținutul acestui fișier>
--   COMMIT;
--
-- Ce face: redeschide citirea+scrierea pentru orice cont logat (politicile de azi, identice),
-- șterge helperii. NU readuce privilegiile anon / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN /
-- UPDATE pe secvențe: niciun flux nu le folosește (revenirea păstrează protecțiile care nu
-- afectează funcționalitatea — cerința Copilot pe revenirile #537/#538).
-- Refuză: nearmat, armat în altă tranzacție (txid diferit), armare persistentă
-- (pg_db_role_setting), orice stare de pornire alta decât starea EXACTĂ a patch-ului.
-- Postcondiție înainte de COMMIT; comutatorul se dezarmează la final.
-- ============================================================================
SET LOCAL search_path = public, pg_temp;

DO $rb$
DECLARE
  c_patch_c CONSTANT text := 'trez_conturi_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_conturi_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_conturi_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_conturi_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_patch_l CONSTANT text := 'trez_linii_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_linii_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_linii_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_linii_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_md5_citi  CONSTANT text := '82ba039146f7daf609e5abafb9f243a0';
  c_md5_scrie CONSTANT text := '507e5309bb291ab712bb2df9a14fea42';
  v_fp_c text; v_fp_l text; v_n int; v_hok int;
BEGIN
  -- armare: persistentă → refuz (orice rol/bază, fără diferență de majuscule)
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c
              WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261003e=%') THEN
    RAISE EXCEPTION 'REVENIRE REFUZATĂ: armare persistentă în pg_db_role_setting (ștergeți-o întâi)';
  END IF;
  -- armare legată de tranzacția curentă
  IF current_setting('gazpet.rollback_tehnic_20261003e', true)
       IS DISTINCT FROM ('REDESCHIDE_TREZORERIE:' || txid_current()::text) THEN
    RAISE EXCEPTION 'REVENIRE REFUZATĂ: neînarmată în această tranzacție';
  END IF;

  -- pornire: doar din starea EXACTĂ a patch-ului
  IF to_regclass('public.trezorerie_conturi') IS NULL OR to_regclass('public.trezorerie_extras_linii') IS NULL THEN
    RAISE EXCEPTION 'REVENIRE REFUZATĂ: tabele lipsă';
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
  SELECT count(*) INTO v_n FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.proname IN ('fn_trezorerie_poate_citi','fn_trezorerie_poate_scrie');
  SELECT count(*) INTO v_hok FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.pronargs = 0 AND f.prosecdef IS TRUE
     AND f.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND f.proowner = 'postgres'::regrole
     AND ((f.proname = 'fn_trezorerie_poate_citi'  AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_citi)
       OR (f.proname = 'fn_trezorerie_poate_scrie' AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_scrie));
  IF v_fp_c IS DISTINCT FROM c_patch_c OR v_fp_l IS DISTINCT FROM c_patch_l OR v_n IS DISTINCT FROM 2 OR v_hok IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'REVENIRE REFUZATĂ: starea nu e exact cea a patch-ului (conturi=%, linii=%, helperi=%/%)', v_fp_c, v_fp_l, v_n, v_hok;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid IN ('public.fn_trezorerie_poate_citi()'::regprocedure, 'public.fn_trezorerie_poate_scrie()'::regprocedure)
               AND d.classid <> 'pg_policy'::regclass AND d.deptype = 'n') THEN
    RAISE EXCEPTION 'REVENIRE REFUZATĂ: helperii au alte dependențe decât politicile patch-ului';
  END IF;
END
$rb$;

DROP POLICY trez_conturi_select ON public.trezorerie_conturi;
DROP POLICY trez_conturi_insert ON public.trezorerie_conturi;
DROP POLICY trez_conturi_update ON public.trezorerie_conturi;
DROP POLICY trez_conturi_delete ON public.trezorerie_conturi;
DROP POLICY trez_linii_select ON public.trezorerie_extras_linii;
DROP POLICY trez_linii_insert ON public.trezorerie_extras_linii;
DROP POLICY trez_linii_update ON public.trezorerie_extras_linii;
DROP POLICY trez_linii_delete ON public.trezorerie_extras_linii;
CREATE POLICY trez_conturi_rw ON public.trezorerie_conturi
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY trez_linii_rw ON public.trezorerie_extras_linii
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP FUNCTION public.fn_trezorerie_poate_citi();
DROP FUNCTION public.fn_trezorerie_poate_scrie();

DO $rbpost$
DECLARE
  c_init_c CONSTANT text := 'trez_conturi_rw|*|true|authenticated|dc71e447411e7aaf354179a11ad2e2ae|dc71e447411e7aaf354179a11ad2e2ae';
  c_init_l CONSTANT text := 'trez_linii_rw|*|true|authenticated|dc71e447411e7aaf354179a11ad2e2ae|dc71e447411e7aaf354179a11ad2e2ae';
  v_fp_c text; v_fp_l text;
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
  IF v_fp_c IS DISTINCT FROM c_init_c OR v_fp_l IS DISTINCT FROM c_init_l
     OR EXISTS (SELECT 1 FROM pg_proc f WHERE f.pronamespace = 'public'::regnamespace
                 AND f.proname IN ('fn_trezorerie_poate_citi','fn_trezorerie_poate_scrie'))
     OR (SELECT bool_and(c.relrowsecurity) FROM pg_class c
          WHERE c.oid IN ('public.trezorerie_conturi'::regclass, 'public.trezorerie_extras_linii'::regclass)) IS DISTINCT FROM true
     OR has_table_privilege('anon', 'public.trezorerie_conturi', 'SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated', 'public.trezorerie_conturi', 'UPDATE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'REVENIRE: postcondiție eșuată (conturi=%, linii=%)', v_fp_c, v_fp_l;
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261003e', '', true);   -- dezarmare
  RAISE NOTICE 'revenire 20261003e: postcondiție OK, comutator dezarmat';
END
$rbpost$;
