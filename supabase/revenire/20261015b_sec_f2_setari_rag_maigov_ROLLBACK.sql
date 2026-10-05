-- ════════════════════════════════════════════════════════════════════════════
-- 20261015b_sec_f2_setari_rag_maigov_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Readuce politicile din 05.10.2026 pe logistica_setari, necesar_setari și mai_gov_redirect_log și scoate cota RAG
-- (fn_rag_qr_rezerva, fn_rag_ask_rezerva, rag_ask_log). ⚠️ Edge-urile rag-* din repo cheamă funcțiile de cotă: fără ele,
-- ask_qr și ask cu AI întorc 500 până la redeploy-ul unei versiuni fără cotă.
-- ⚠️ Redeschide gaurile: orice cont logat scrie setările (destinatari de mail, aprobarea achizițiilor) și citește
--    jurnalul cu codurile hub.mai.gov.ro.
-- NU atinge joburile cron: secretul vechi nu e și nu va fi în repo. Dacă trebuie retrase și edge-urile noi, joburile
--   17 / 18 / 30 se opresc separat (cron.alter_job(job_id, active := false)) până la o nouă livrare.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261015b', 'REDESCHIDE_SETARI_SEC_F2:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261015b', true) IS DISTINCT FROM 'REDESCHIDE_SETARI_SEC_F2:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261015b: nearmată (gazpet.revenire_20261015b legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261015b=%') THEN
    RAISE EXCEPTION 'Revenire 20261015b: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  -- starea EXACTĂ a patch-ului: definițiile complete ale politicilor (nume, comandă, expresii, roluri) — r2, Copilot P2.
  -- md5 calculat de scripts/test_sec_f2_setari.sh pe PG16 și reverificat pe live după aplicare.
  IF (SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s', c.relname, p.polname, p.polcmd, p.polpermissive,
                                   coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
                            || '|' || (SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
                                       FROM unnest(p.polroles) AS o(oid) LEFT JOIN pg_roles r ON r.oid = o.oid),
                            ' ; ' ORDER BY c.relname, p.polname))
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.oid IN ('public.logistica_setari'::regclass, 'public.necesar_setari'::regclass, 'public.mai_gov_redirect_log'::regclass))
     IS DISTINCT FROM 'cd10f751d0753a101a55e5fa79cd78ad' THEN
    RAISE EXCEPTION 'Revenire 20261015b: precondiție — politicile nu sunt exact cele create de patch-ul 20261015b';
  END IF;
  IF to_regprocedure('public.fn_rag_qr_rezerva(integer,text)') IS NULL OR to_regprocedure('public.fn_rag_ask_rezerva(uuid)') IS NULL
     OR to_regclass('public.rag_ask_log') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261015b: precondiție — obiectele cotei RAG lipsesc';
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

DROP FUNCTION public.fn_rag_qr_rezerva(integer, text);
DROP FUNCTION public.fn_rag_ask_rezerva(uuid);
DROP TABLE public.rag_ask_log;

DO $post$
BEGIN
  IF (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.logistica_setari'::regclass)
       IS DISTINCT FROM 'logistica_setari_delete_authenticated:d,logistica_setari_insert_authenticated:a,logistica_setari_select_authenticated:r,logistica_setari_update_authenticated:w'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.necesar_setari'::regclass)
       IS DISTINCT FROM 'necesar_setari_select:r,necesar_setari_write:*'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.mai_gov_redirect_log'::regclass)
       IS DISTINCT FROM 'mai_gov_redirect_log_select:r'
     OR to_regprocedure('public.fn_rag_qr_rezerva(integer,text)') IS NOT NULL OR to_regclass('public.rag_ask_log') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261015b: postcondiție — politicile nu au revenit la starea din 05.10.2026';
  END IF;
  PERFORM set_config('gazpet.revenire_20261015b', '', true);
END $post$;
