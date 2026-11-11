-- Version 20261214120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261214a_logistica_nr_inventar_grant — TKT-2026-0384 / TKT-2026-0386: „permission denied for function fn_nr_inventar_norm” la activ nou
-- și la schimbarea numărului de inventar.
-- Cauza: 20261122a a creat fn_nr_inventar_norm(text) cu REVOKE EXECUTE FROM PUBLIC și drept doar pentru service_role, dar triggerul
--   trg_active_nr_inventar (fn_active_nr_inventar_obligatoriu, SECURITY INVOKER) o cheamă cu drepturile utilizatorului care scrie în
--   logistica_active. Orice utilizator care nu e owner-ul bazei primește refuz la INSERT / UPDATE cu nr_inventar.
-- Ce face: GRANT EXECUTE pe fn_nr_inventar_norm(text) lui authenticated. Funcția e pură (LANGUAGE sql, IMMUTABLE, STRICT, fără acces la
--   tabele: taie spațiile de la capetele unui text), deci dreptul nu expune nimic.
-- Ce NU face: nicio dată, nicio politică, niciun drept pe tabele, nimic pentru anon / PUBLIC, nicio schimbare a triggerului.
-- Revenire: supabase/revenire/20261214a_logistica_nr_inventar_grant_ROLLBACK.sql (REVOKE-ul — readuce refuzul).
DO $pre$
DECLARE v_fn regprocedure := to_regprocedure('public.fn_nr_inventar_norm(text)'); v_trg regprocedure := to_regprocedure('public.fn_active_nr_inventar_obligatoriu()');
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261214a_logistica_nr_inventar_grant:' || txid_current() THEN
    RAISE EXCEPTION '20261214a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261214a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF v_fn IS NULL OR v_trg IS NULL THEN RAISE EXCEPTION '20261214a: 20261122a nu e aplicata (functiile lipsesc)'; END IF;
  -- funcția e exact cea revizuită: pură, fără DEFINER, a lui postgres (altfel dreptul ar putea expune altceva)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_fn AND l.lanname = 'sql' AND p.provolatile = 'i' AND p.proisstrict AND NOT p.prosecdef
                    AND p.proowner = 'postgres'::regrole AND p.prorettype = 'text'::regtype
                    AND md5(p.prosrc) = 'd237d170e2bc774def6d69775da8c34d') THEN
    RAISE EXCEPTION '20261214a: fn_nr_inventar_norm nu e cea revizuita (limbaj / volatilitate / owner / corp)';
  END IF;
  -- starea de azi: authenticated și anon NU au EXECUTE, service_role are
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN RAISE EXCEPTION '20261214a: authenticated are deja EXECUTE — deja aplicata?'; END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261214a: drepturile pe fn_nr_inventar_norm difera de cele asteptate (anon fara, service_role cu)';
  END IF;
END $pre$;

GRANT EXECUTE ON FUNCTION public.fn_nr_inventar_norm(text) TO authenticated;

DO $post$
DECLARE v_fn regprocedure := 'public.fn_nr_inventar_norm(text)'::regprocedure;
BEGIN
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261214a: starea finala difera (authenticated cu, anon fara, service_role cu)';
  END IF;
END $post$;
