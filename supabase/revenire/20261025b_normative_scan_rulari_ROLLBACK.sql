-- REVENIRE 20261025b — șterge jobul normative_scan_continua, cele 8 funcții fn_norm_scan_* și tabelul normative_scan_rulari
-- (istoricul rulărilor se pierde). DOAR la cererea explicită a lui Răzvan, ÎMPREUNĂ cu redeploy-ul normative-scan-lunar v9
-- (altfel v10 dă eroare la pornire și jobul 39 nu mai produce mail).
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261025b', 'NORMATIVE_SCAN_RULARI_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE f regprocedure; n integer := 0;
BEGIN
  IF current_setting('gazpet.revenire_20261025b', true)
       IS DISTINCT FROM 'NORMATIVE_SCAN_RULARI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261025b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261025b=%') THEN
    RAISE EXCEPTION '20261025b: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261025b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.normative_scan_rulari') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'public' AND p.proname LIKE 'fn\_norm\_scan\_%') <> 8
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_continua') THEN
    RAISE EXCEPTION '20261025b: preconditie, obiectele lipsesc sau difera';
  END IF;
  PERFORM cron.unschedule('normative_scan_continua');
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname LIKE 'fn\_norm\_scan\_%' LOOP
    EXECUTE format('DROP FUNCTION %s', f);
    n := n + 1;
  END LOOP;
  DROP TABLE public.normative_scan_rulari;
  IF n <> 8
     OR to_regclass('public.normative_scan_rulari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                 WHERE ns.nspname = 'public' AND p.proname LIKE 'fn\_norm\_scan\_%')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_continua')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_lunar') THEN
    RAISE EXCEPTION '20261025b: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261025b', true)
       IS DISTINCT FROM 'NORMATIVE_SCAN_RULARI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261025b: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261025b', '', true);
END $revenire$;
