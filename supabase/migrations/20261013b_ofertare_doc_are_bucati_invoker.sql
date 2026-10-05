-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261013b — „v_ofertare_seap_completitudine: permission denied for function ofertare_doc_are_bucati”
-- (05.10.2026, Jilava SCN1179907, Propunere tehnică, cu termen pe 06.10)
--
-- Cauza: view-ul v_ofertare_seap_completitudine (security_invoker = on, din 20260924) apelează
--   public.ofertare_doc_are_bucati(bigint,bigint,text), care din 20260915 are EXECUTE doar pentru postgres și
--   service_role. Orice utilizator logat care citește view-ul pică. Până la #530 (02.10) eroarea era înghițită
--   de UI (listă goală). Acum e afișată și blochează poarta PT, aprobarea și semnarea.
-- Fix: funcția trece pe SECURITY INVOKER și primește EXECUTE pentru authenticated.
--   - Ca invoker citește ofertare_documente_atribuire cu RLS-ul apelantului, adică exact rândurile pe care
--     view-ul (tot invoker) le citește deja. Nu lărgește nimic: niciun SECURITY DEFINER nou expus.
--   - service_role (ofertare-ingest-doc) ocolește RLS ca înainte, deci comportamentul edge-ului e neschimbat.
--   - anon și PUBLIC rămân fără EXECUTE. Corpul funcției (md5) și search_path rămân neschimbate.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261013b_ofertare_doc_are_bucati_invoker_ROLLBACK.sql. Gate 0e = 0.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261013b_ofertare_doc_are_bucati_invoker:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261013b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

DO $pre$
DECLARE
  f record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  SELECT p.prosecdef, p.provolatile, l.lanname, md5(p.prosrc) AS m, p.proconfig, p.proacl::text AS acl,
         pg_get_userbyid(p.proowner) AS own
    INTO f
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.ofertare_doc_are_bucati(bigint,bigint,text)');
  IF NOT FOUND
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'ofertare_doc_are_bucati' AND pronamespace = 'public'::regnamespace) <> 1
     OR f.prosecdef IS NOT TRUE OR f.provolatile <> 's' OR f.lanname <> 'sql' OR f.own <> 'postgres'
     OR f.m IS DISTINCT FROM '9d50c502093fdffb2485ce973a20abb9'
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR f.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Precondiție 0b: ofertare_doc_are_bucati diferă de cea live (unică, sql, STABLE, SECDEF, owner postgres, md5 corp, search_path, ACL exact)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_documente_atribuire'::regclass) THEN
    RAISE EXCEPTION 'Precondiție 0c: ofertare_documente_atribuire nu are RLS activ — ca invoker funcția ar citi nefiltrat';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.v_ofertare_seap_completitudine'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION 'Precondiție 0d: v_ofertare_seap_completitudine nu mai e security_invoker = on';
  END IF;
END
$pre$;

ALTER FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) SECURITY INVOKER;
GRANT EXECUTE ON FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) TO authenticated;

DO $post$
DECLARE
  v_oid oid := to_regprocedure('public.ofertare_doc_are_bucati(bigint,bigint,text)');
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) IS NOT FALSE
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '9d50c502093fdffb2485ce973a20abb9'
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 1: funcția nu e SECURITY INVOKER sau corpul/search_path s-au schimbat';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'Postcondiție 2: ACL greșit (authenticated + service_role da, anon și PUBLIC nu)';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'Postcondiție 3: ACL-ul nu e exact {postgres,service_role,authenticated}';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261013b_ofertare_doc_are_bucati_invoker:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261013b: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
