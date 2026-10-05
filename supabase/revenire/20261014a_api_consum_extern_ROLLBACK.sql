-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261014a_api_consum_extern_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate jobul api_consum_extern_zilnic, view-ul v_api_consum_curent și tabelul api_consum_extern.
-- ⚠️ Șterge ISTORICUL citirilor de consum (DROP TABLE) — ireversibil. Dacă istoricul trebuie păstrat, se oprește doar
--    cronul: SELECT cron.unschedule('api_consum_extern_zilnic') (tot la cererea lui Răzvan).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261014a', 'SCOATE_API_CONSUM:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261014a', true) IS DISTINCT FROM 'SCOATE_API_CONSUM:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261014a: nearmată (gazpet.revenire_20261014a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261014a=%') THEN
    RAISE EXCEPTION 'Revenire 20261014a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  -- starea EXACTĂ a patch-ului: altfel s-ar șterge obiecte schimbate între timp
  IF to_regclass('public.api_consum_extern') IS NULL OR to_regclass('public.v_api_consum_curent') IS NULL
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_consum_extern') <> 1
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
                 WHERE d.refobjid = 'public.api_consum_extern'::regclass AND r.ev_class <> 'public.v_api_consum_curent'::regclass) THEN
    RAISE EXCEPTION 'Revenire 20261014a: precondiție — starea nu e cea a patch-ului (tabel, view, job, 1 politică, fără alte view-uri dependente)';
  END IF;
END $arm$;

SELECT cron.unschedule('api_consum_extern_zilnic');
DROP VIEW public.v_api_consum_curent;
DROP TABLE public.api_consum_extern;

DO $post$
BEGIN
  IF to_regclass('public.api_consum_extern') IS NOT NULL OR to_regclass('public.v_api_consum_curent') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') THEN
    RAISE EXCEPTION 'Revenire 20261014a: postcondiție — tabelul, view-ul sau jobul încă există';
  END IF;
END $post$;
