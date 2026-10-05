-- ════════════════════════════════════════════════════════════════════════════
-- 20261015a_sec_f2_setari_rag_maigov_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Readuce politicile din 05.10.2026 pe logistica_setari, necesar_setari și mai_gov_redirect_log.
-- ⚠️ Redeschide gaurile: orice cont logat scrie setările (destinatari de mail, aprobarea achizițiilor) și citește
--    jurnalul cu codurile hub.mai.gov.ro.
-- NU atinge joburile cron: secretul vechi nu e și nu va fi în repo. Dacă trebuie retrase și edge-urile noi, joburile
--   17 / 18 / 30 se opresc separat (cron.alter_job(job_id, active := false)) până la o nouă livrare.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261015a', 'REDESCHIDE_SETARI_SEC_F2:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261015a', true) IS DISTINCT FROM 'REDESCHIDE_SETARI_SEC_F2:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261015a: nearmată (gazpet.revenire_20261015a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261015a=%') THEN
    RAISE EXCEPTION 'Revenire 20261015a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  -- starea EXACTĂ a patch-ului (seturile de politici create de 20261015a)
  IF (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.logistica_setari'::regclass)
       IS DISTINCT FROM 'logistica_setari_delete_owner:d,logistica_setari_insert_pe_chei:a,logistica_setari_select_authenticated:r,logistica_setari_update_pe_chei:w'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.necesar_setari'::regclass)
       IS DISTINCT FROM 'necesar_setari_select:r,necesar_setari_write_owner:*'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.mai_gov_redirect_log'::regclass)
       IS DISTINCT FROM 'mai_gov_redirect_log_select_owner:r' THEN
    RAISE EXCEPTION 'Revenire 20261015a: precondiție — politicile nu sunt exact cele ale patch-ului 20261015a';
  END IF;
END $arm$;

DROP POLICY logistica_setari_insert_pe_chei ON public.logistica_setari;
DROP POLICY logistica_setari_update_pe_chei ON public.logistica_setari;
DROP POLICY logistica_setari_delete_owner ON public.logistica_setari;
CREATE POLICY logistica_setari_insert_authenticated ON public.logistica_setari FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY logistica_setari_update_authenticated ON public.logistica_setari FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY logistica_setari_delete_authenticated ON public.logistica_setari FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY necesar_setari_write_owner ON public.necesar_setari;
CREATE POLICY necesar_setari_write ON public.necesar_setari FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY mai_gov_redirect_log_select_owner ON public.mai_gov_redirect_log;
CREATE POLICY mai_gov_redirect_log_select ON public.mai_gov_redirect_log FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DO $post$
BEGIN
  IF (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.logistica_setari'::regclass)
       IS DISTINCT FROM 'logistica_setari_delete_authenticated:d,logistica_setari_insert_authenticated:a,logistica_setari_select_authenticated:r,logistica_setari_update_authenticated:w'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.necesar_setari'::regclass)
       IS DISTINCT FROM 'necesar_setari_select:r,necesar_setari_write:*'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.mai_gov_redirect_log'::regclass)
       IS DISTINCT FROM 'mai_gov_redirect_log_select:r' THEN
    RAISE EXCEPTION 'Revenire 20261015a: postcondiție — politicile nu au revenit la starea din 05.10.2026';
  END IF;
  PERFORM set_config('gazpet.revenire_20261015a', '', true);
END $post$;
