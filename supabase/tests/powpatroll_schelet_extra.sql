-- ============================================================================
-- Supliment de schelet pentru testele PowPatroll Context Registry (NU se aplică NICIODATĂ pe producție).
-- Se încarcă DUPĂ supabase/tests/conturi_schelet_supabase.sql (neschimbat), doar de
-- scripts/test_powpatroll_registry.sh, într-o bază locală efemeră *_test.
--
-- Conține obiectele de PRODUCȚIE de care depinde migrarea 20261008a și care lipsesc din scheletul comun:
--   * public.fn_is_app_owner(uuid) — definiția și ACL-ul citite READ-ONLY din producție la 29.09.2026
--     (pg_get_functiondef + proacl): SQL STABLE SECURITY DEFINER, search_path public, pg_temp;
--     proacl = {postgres=X, service_role=X, authenticated=X} (fără PUBLIC, fără anon).
-- ============================================================================
\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $garda$
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' THEN
    RAISE EXCEPTION 'Suplimentul de schelet se încarcă doar într-o bază locală *_test (acum: %)', current_database();
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Încarcă întâi supabase/tests/conturi_schelet_supabase.sql';
  END IF;
END $garda$;

CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
$function$;
REVOKE ALL ON FUNCTION public.fn_is_app_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO postgres, service_role, authenticated;

RESET client_min_messages;
\echo 'SCHELET EXTRA OK: fn_is_app_owner (ca în producție)'
