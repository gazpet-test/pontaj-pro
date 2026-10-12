-- REVENIRE 20261025a — șterge jobul normative_scan_continua, funcțiile fn_norm_scan_* și tabelul normative_scan_rulari
-- (istoricul rulărilor se pierde). DOAR la cererea explicită a lui Răzvan, ÎMPREUNĂ cu redeploy-ul normative-scan-lunar v9
-- (altfel v10 dă eroare la pornire și jobul 39 nu mai produce mail).
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261025a', 'NORMATIVE_SCAN_RULARI_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261025a', true)
       IS DISTINCT FROM 'NORMATIVE_SCAN_RULARI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261025a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261025a=%') THEN
    RAISE EXCEPTION '20261025a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261025a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.normative_scan_rulari') IS NULL
     OR to_regprocedure('public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer)') IS NULL
     OR to_regprocedure('public.fn_norm_scan_ia_lot(bigint,integer)') IS NULL
     OR to_regprocedure('public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.fn_norm_scan_ia_final(bigint,text,integer)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_continua') THEN
    RAISE EXCEPTION '20261025a: preconditie, obiectele lipsesc';
  END IF;
  PERFORM cron.unschedule('normative_scan_continua');
  DROP FUNCTION public.fn_norm_scan_ia_final(bigint, text, integer);
  DROP FUNCTION public.fn_norm_scan_salveaza_lot(bigint, integer, jsonb, jsonb, integer, bigint, bigint);
  DROP FUNCTION public.fn_norm_scan_ia_lot(bigint, integer);
  DROP FUNCTION public.fn_norm_scan_porneste(boolean, date, date, bigint[], integer, integer);
  DROP TABLE public.normative_scan_rulari;
  IF to_regclass('public.normative_scan_rulari') IS NOT NULL
     OR to_regprocedure('public.fn_norm_scan_ia_lot(bigint,integer)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_continua')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_lunar') THEN
    RAISE EXCEPTION '20261025a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261025a', true)
       IS DISTINCT FROM 'NORMATIVE_SCAN_RULARI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261025a: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261025a', '', true);
END $revenire$;
