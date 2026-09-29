-- ============================================================================
-- ROLLBACK 20261005a — PowPatroll Context Registry
-- ============================================================================
-- Șterge obiectele DOAR cât timp registry-ul nu are istoric real: refuză atomic dacă există versiuni
-- peste v1 (v1 = seed-ul, reproductibil din surse). Istoricul append-only nu se șterge niciodată pe ascuns.
-- Un singur DO → atomic și fără BEGIN extern. Idempotent (a doua rulare nu mai găsește nimic).
-- Rolul powpatroll_owner se șterge doar dacă nu mai deține nimic în alte baze din cluster.
-- ============================================================================
DO $rollback$
DECLARE v_head int := 0; f regprocedure; v_rol boolean; v_rest text;
BEGIN
  v_rol := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powpatroll_owner');
  -- Adminul (postgres) are doar ADMIN pe rol după migrare; pentru DROP îi trebuie temporar drepturile ownerului.
  IF v_rol THEN
    EXECUTE 'GRANT powpatroll_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE';
  END IF;
  IF to_regclass('public.powpatroll_versions') IS NOT NULL THEN
    LOCK TABLE public.powpatroll_versions IN ACCESS EXCLUSIVE MODE;
    IF to_regclass('public.powpatroll_log') IS NOT NULL THEN
      LOCK TABLE public.powpatroll_log IN ACCESS EXCLUSIVE MODE;
    END IF;
    EXECUTE 'SELECT coalesce(max(version), 0) FROM public.powpatroll_versions' INTO v_head;
    IF v_head > 1 THEN
      RAISE EXCEPTION 'Rollback refuzat: registry-ul are % versiuni (> v1). Istoricul append-only se păstrează; nimic șters.', v_head;
    END IF;
  END IF;

  DROP VIEW IF EXISTS public.v_powpatroll_curent;
  -- fn_powpatroll_sha_rand depinde de tipul-rând al tabelului → înaintea tabelelor
  DROP FUNCTION IF EXISTS public.fn_powpatroll_sha_rand(public.powpatroll_log);
  DROP TABLE IF EXISTS public.powpatroll_log;        -- triggerele, politicile și secvența pleacă odată cu tabelul
  DROP TABLE IF EXISTS public.powpatroll_versions;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'fn\_powpatroll\_%' OR p.proname LIKE 'powpatroll\_%')
  LOOP
    EXECUTE format('DROP FUNCTION %s', f);
  END LOOP;

  IF v_rol THEN
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM powpatroll_owner';
    IF EXISTS (SELECT 1 FROM pg_shdepend d
               WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = 'powpatroll_owner'::regrole
                 AND d.dbid <> (SELECT oid FROM pg_database WHERE datname = current_database())) THEN
      EXECUTE 'REVOKE powpatroll_owner FROM CURRENT_USER';
      RAISE NOTICE 'powpatroll_owner mai deține obiecte în alte baze din cluster: rolul rămâne.';
    ELSE
      EXECUTE 'DROP ROLE powpatroll_owner';
    END IF;
  END IF;

  SELECT string_agg(x, ', ') INTO v_rest FROM (
    SELECT c.relname::text AS x FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE '%powpatroll%'
    UNION ALL
    SELECT p.proname::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '%powpatroll%') t;
  IF v_rest IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback incomplet, au rămas: % — nimic șters', v_rest;
  END IF;
END $rollback$;
