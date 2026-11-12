-- Revenire 20261214a_logistica_nr_inventar_grant. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Ia înapoi EXECUTE pe fn_nr_inventar_norm(text) de la authenticated, ca înainte de 20261214a. ATENȚIE: readuce refuzul
-- „permission denied for function fn_nr_inventar_norm” la activ nou și la schimbarea numărului de inventar pentru toți utilizatorii.
-- Gestionarul tranzacției e operatorul. Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261214a', 'IA_INAPOI_EXECUTE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261214a IA_INAPOI_EXECUTE
DO $revenire$
DECLARE v_fn regprocedure := to_regprocedure('public.fn_nr_inventar_norm(text)');
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261214a', true) IS DISTINCT FROM 'IA_INAPOI_EXECUTE:' || txid_current() THEN
    RAISE EXCEPTION '20261214a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261214a=%') THEN
    RAISE EXCEPTION '20261214a revenire: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF v_fn IS NULL THEN RAISE EXCEPTION '20261214a revenire: fn_nr_inventar_norm lipseste'; END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261214a revenire: starea nu e cea din 20261214a (authenticated nu are EXECUTE)';
  END IF;
  REVOKE EXECUTE ON FUNCTION public.fn_nr_inventar_norm(text) FROM authenticated;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261214a revenire: starea finala difera (authenticated fara, service_role cu)';
  END IF;
END $revenire$;
