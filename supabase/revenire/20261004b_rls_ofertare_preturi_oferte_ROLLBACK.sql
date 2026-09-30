-- ════════════════════════════════════════════════════════════════════════════
-- 20261004b_rls_ofertare_preturi_oferte_ROLLBACK — NU e migrare (nu o parcurge niciun runner). Reface EXACT politicile citite read-only pe 30.09
-- (pg_policies = pg_get_expr) pe cele 20 de tabele și ACL-ul anon: ALL dacă F1 (20260930i) NU e aplicat, ALL FĂRĂ
-- TRUNCATE dacă F1 e aplicat (nu reintroduce niciodată TRUNCATE peste F1). REDESCHIDE expunerea:
-- se rulează doar cu acordul explicit al lui Răzvan.
-- Armare (în aceeași tranzacție, fără nimic altceva):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261004b', 'REVINE_RLS_OFERTARE:' || txid_current(), true);
--   \i supabase/revenire/20261004b_rls_ofertare_preturi_oferte_ROLLBACK.sql
--   COMMIT;
-- Precondiție: starea = patch (md5 5a5ff33000684f9bd2bd62afbbe2ccbf, anon fără privilegii). Postcondiție: md5 9784b08e2edf7f9c37b5e7873e6f0e04 + anon ALL / ALL fără TRUNCATE.
-- ════════════════════════════════════════════════════════════════════════════
DO $revenire_20261004b$
DECLARE
  v_stare text;
  v_n bigint;
  v_grant text;
  v_asteptat text;
BEGIN
  -- Garda (start)
  IF current_setting('gazpet.revenire_20261004b', true) IS DISTINCT FROM 'REVINE_RLS_OFERTARE:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: revenirea nu e armată (gazpet.revenire_20261004b)' USING ERRCODE = '42501';
  END IF;
  -- Precondiții: helper-ul cu amprenta EXACTĂ (proprietar, limbaj, search_path, tip, semnătură, SECDEF, STABLE, md5, EXECUTE),
  -- fără alt overload cu același nume în nicio schemă; RLS pornit pe toate 20 tabele; fără ACL pe coloane; PUBLIC fără nimic
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.pronamespace = 'public'::regnamespace AND p.oid::regprocedure::text = 'fn_are_acces_ofertare()' AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'sql' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.prokind = 'f' AND p.pronargs = 0 AND p.pronargdefaults = 0 AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1 THEN
    RAISE EXCEPTION 'REFUZ: fn_are_acces_ofertare() lipsește sau diferă de amprenta citită pe 30.09 (postgres, sql, search_path=public, pg_temp, boolean, SECDEF, STABLE, md5 429d28e2a61fb24c8009d67050c16c85, EXECUTE doar authenticated/service_role)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION 'REFUZ: există alt overload fn_are_acces_ofertare (în orice schemă) — apelul fără argumente ar putea fi ambiguu/deturnat';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])) <> 20 THEN
    RAISE EXCEPTION 'REFUZ: RLS nu e pornit pe toate cele 20 tabele (sau lipsește un tabel)';
  END IF;
  v_n := (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL);
  RAISE NOTICE 'Inventar: % coloane cu ACL propriu pe cele 20 tabele (așteptat 0)', v_n;
  IF v_n <> 0 OR (SELECT count(*) FROM pg_catalog.pg_class c, aclexplode(c.relacl) x WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND x.grantee = 0) <> 0 THEN
    RAISE EXCEPTION 'REFUZ: există privilegii pe coloane (% coloane) sau pentru PUBLIC pe cele 20 tabele — se reanalizează', v_n;
  END IF;
  PERFORM set_config('gazpet.rls_ofertare_20261004b_auth', (SELECT md5(coalesce((SELECT string_agg(t || ':' || pr || '=' || has_table_privilege('authenticated', 'public.'||t, pr)::text, ';' ORDER BY t, pr) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr), '') || '#' || coalesce((SELECT string_agg(c.relname || ':' || x.privilege_type || ':' || x.is_grantable::text || ':' || x.grantor::regrole::text, ';' ORDER BY c.relname, x.privilege_type, x.grantor::regrole::text) FROM pg_catalog.pg_class c, aclexplode(c.relacl) x WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND x.grantee = 'authenticated'::regrole), '') || '#' || coalesce((SELECT string_agg(cp.table_name || '.' || cp.column_name || ':' || cp.privilege_type || ':' || cp.is_grantable, ';' ORDER BY cp.table_name, cp.column_name, cp.privilege_type) FROM information_schema.column_privileges cp WHERE cp.grantee = 'authenticated' AND cp.table_schema = 'public' AND cp.table_name = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])), ''))), true);
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]));
  IF v_stare IS DISTINCT FROM '5a5ff33000684f9bd2bd62afbbe2ccbf' OR (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr WHERE has_table_privilege('anon', 'public.'||t, pr)) <> 0 THEN
    RAISE EXCEPTION 'REFUZ: revenirea pornește doar din starea patch-ului 20261004b_rls_ofertare_preturi_oferte (md5 politici % ≠ 5a5ff33000684f9bd2bd62afbbe2ccbf sau anon are privilegii)', v_stare;
  END IF;
  -- Starea F1 (20260930i nu lasă marcaj persistent): discriminator = TRUNCATE al lui authenticated pe cele 20 (patch-ul nu-l atinge).
  --   20 → F1 neaplicat: anon primește înapoi ALL (exact ca pe 30.09); 0 → F1 aplicat: anon primește tot FĂRĂ TRUNCATE; altfel refuz.
  v_n := (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('authenticated', 'public.'||t, 'TRUNCATE'));
  IF v_n = 20 THEN
    v_grant := 'ALL'; v_asteptat := 'DELETE:false,INSERT:false,MAINTAIN:false,REFERENCES:false,SELECT:false,TRIGGER:false,TRUNCATE:false,UPDATE:false';
  ELSIF v_n = 0 THEN
    v_grant := 'SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN'; v_asteptat := 'DELETE:false,INSERT:false,MAINTAIN:false,REFERENCES:false,SELECT:false,TRIGGER:false,UPDATE:false';
  ELSE
    RAISE EXCEPTION 'REFUZ: stare F1 ambiguă (authenticated are TRUNCATE pe % din 20) — se reanalizează', v_n;
  END IF;
  RAISE NOTICE 'Revenire: F1 %, anon primește %', CASE WHEN v_n = 0 THEN 'aplicat' ELSE 'neaplicat' END, v_grant;
  EXECUTE 'DROP POLICY oferta_materiale_rls_sel ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_rls_ins ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_rls_upd ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_rls_del ON public.oferta_materiale';
  EXECUTE 'CREATE POLICY oferta_materiale_select ON public.oferta_materiale AS PERMISSIVE FOR SELECT TO authenticated USING (true)';
  EXECUTE 'CREATE POLICY oferta_materiale_write ON public.oferta_materiale AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_sel ON public.ofertare_brokeri';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_ins ON public.ofertare_brokeri';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_upd ON public.ofertare_brokeri';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_del ON public.ofertare_brokeri';
  EXECUTE 'CREATE POLICY brokeri_all ON public.ofertare_brokeri AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_sel ON public.ofertare_calibrari';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_ins ON public.ofertare_calibrari';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_upd ON public.ofertare_calibrari';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_del ON public.ofertare_calibrari';
  EXECUTE 'CREATE POLICY cal_all ON public.ofertare_calibrari AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_sel ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_ins ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_upd ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_del ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'CREATE POLICY ocs_del ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ocs_ins ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ocs_sel ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ocs_upd ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_sel ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_ins ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_upd ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_del ON public.ofertare_categorii_reguli';
  EXECUTE 'CREATE POLICY p_categorii_reguli_citire ON public.ofertare_categorii_reguli AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY p_categorii_reguli_scriere ON public.ofertare_categorii_reguli AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_sel ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_ins ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_upd ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_del ON public.ofertare_experienta';
  EXECUTE 'CREATE POLICY ofertare_experienta_del ON public.ofertare_experienta AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_ins ON public.ofertare_experienta AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_sel ON public.ofertare_experienta AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_upd ON public.ofertare_experienta AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_normative_rls_sel ON public.ofertare_normative';
  EXECUTE 'DROP POLICY ofertare_normative_rls_ins ON public.ofertare_normative';
  EXECUTE 'DROP POLICY ofertare_normative_rls_upd ON public.ofertare_normative';
  EXECUTE 'DROP POLICY ofertare_normative_rls_del ON public.ofertare_normative';
  EXECUTE 'CREATE POLICY norm_all ON public.ofertare_normative AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_sel ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_ins ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_upd ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_del ON public.ofertare_norme_productivitate';
  EXECUTE 'CREATE POLICY onp_read ON public.ofertare_norme_productivitate AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY onp_write ON public.ofertare_norme_productivitate AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_sel ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_ins ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_upd ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_del ON public.ofertare_oferte_deschidere';
  EXECUTE 'CREATE POLICY ofd_select ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofd_write ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_sel ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_ins ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_upd ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_del ON public.ofertare_oferte_furnizori';
  EXECUTE 'CREATE POLICY oof_del ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY oof_ins ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY oof_sel ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY oof_upd ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_sel ON public.ofertare_parteneri';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_ins ON public.ofertare_parteneri';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_upd ON public.ofertare_parteneri';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_del ON public.ofertare_parteneri';
  EXECUTE 'CREATE POLICY ofertare_parteneri_all ON public.ofertare_parteneri AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_sel ON public.ofertare_preturi_materiale';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_ins ON public.ofertare_preturi_materiale';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_upd ON public.ofertare_preturi_materiale';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_del ON public.ofertare_preturi_materiale';
  EXECUTE 'CREATE POLICY pm_all ON public.ofertare_preturi_materiale AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_sel ON public.ofertare_preturi_unitare';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_ins ON public.ofertare_preturi_unitare';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_upd ON public.ofertare_preturi_unitare';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_del ON public.ofertare_preturi_unitare';
  EXECUTE 'CREATE POLICY pu_all ON public.ofertare_preturi_unitare AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_radar_rls_sel ON public.ofertare_radar';
  EXECUTE 'DROP POLICY ofertare_radar_rls_ins ON public.ofertare_radar';
  EXECUTE 'DROP POLICY ofertare_radar_rls_upd ON public.ofertare_radar';
  EXECUTE 'DROP POLICY ofertare_radar_rls_del ON public.ofertare_radar';
  EXECUTE 'CREATE POLICY radar_del ON public.ofertare_radar AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY radar_ins ON public.ofertare_radar AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY radar_sel ON public.ofertare_radar AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY radar_upd ON public.ofertare_radar AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_sel ON public.ofertare_rfq';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_ins ON public.ofertare_rfq';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_upd ON public.ofertare_rfq';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_del ON public.ofertare_rfq';
  EXECUTE 'CREATE POLICY rfq_all ON public.ofertare_rfq AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_sel ON public.ofertare_rfq_destinatari';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_ins ON public.ofertare_rfq_destinatari';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_upd ON public.ofertare_rfq_destinatari';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_del ON public.ofertare_rfq_destinatari';
  EXECUTE 'CREATE POLICY rfqd_all ON public.ofertare_rfq_destinatari AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_sel ON public.ofertare_rfq_materiale';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_ins ON public.ofertare_rfq_materiale';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_upd ON public.ofertare_rfq_materiale';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_del ON public.ofertare_rfq_materiale';
  EXECUTE 'CREATE POLICY rfqm_all ON public.ofertare_rfq_materiale AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_sel ON public.ofertare_rfq_oferte';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_ins ON public.ofertare_rfq_oferte';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_upd ON public.ofertare_rfq_oferte';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_del ON public.ofertare_rfq_oferte';
  EXECUTE 'CREATE POLICY rfqo_all ON public.ofertare_rfq_oferte AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_sel ON public.ofertare_rfq_preturi';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_ins ON public.ofertare_rfq_preturi';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_upd ON public.ofertare_rfq_preturi';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_del ON public.ofertare_rfq_preturi';
  EXECUTE 'CREATE POLICY rfqp_all ON public.ofertare_rfq_preturi AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY probe_oferte_rls_sel ON public.probe_oferte';
  EXECUTE 'DROP POLICY probe_oferte_rls_ins ON public.probe_oferte';
  EXECUTE 'DROP POLICY probe_oferte_rls_upd ON public.probe_oferte';
  EXECUTE 'DROP POLICY probe_oferte_rls_del ON public.probe_oferte';
  EXECUTE 'CREATE POLICY pof_select ON public.probe_oferte AS PERMISSIVE FOR SELECT TO authenticated USING (true)';
  EXECUTE 'CREATE POLICY pof_write ON public.probe_oferte AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE format('GRANT %s ON TABLE public.oferta_materiale TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_brokeri TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_calibrari TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_calibrari_subcontractori TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_categorii_reguli TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_experienta TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_normative TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_norme_productivitate TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_oferte_deschidere TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_oferte_furnizori TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_parteneri TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_preturi_materiale TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_preturi_unitare TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_radar TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_rfq TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_rfq_destinatari TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_rfq_materiale TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_rfq_oferte TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.ofertare_rfq_preturi TO anon', v_grant);
  EXECUTE format('GRANT %s ON TABLE public.probe_oferte TO anon', v_grant);
  -- Postcondiții (înainte de COMMIT; orice abatere anulează tot)
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]));
  IF v_stare IS DISTINCT FROM '9784b08e2edf7f9c37b5e7873e6f0e04' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: politicile refăcute (md5 %) ≠ starea live din 30.09 9784b08e2edf7f9c37b5e7873e6f0e04', v_stare;
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND (SELECT string_agg(x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.privilege_type) FROM aclexplode(c.relacl) x WHERE x.grantee = 'anon'::regrole) = v_asteptat) <> 20 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: anon nu are exact setul așteptat (%) pe toate 20 tabele', v_grant;
  END IF;
  IF v_n = 0 AND (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('anon', 'public.'||t, 'TRUNCATE')) <> 0 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: F1 aplicat, dar anon a primit TRUNCATE';
  END IF;
  IF (SELECT md5(coalesce((SELECT string_agg(t || ':' || pr || '=' || has_table_privilege('authenticated', 'public.'||t, pr)::text, ';' ORDER BY t, pr) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr), '') || '#' || coalesce((SELECT string_agg(c.relname || ':' || x.privilege_type || ':' || x.is_grantable::text || ':' || x.grantor::regrole::text, ';' ORDER BY c.relname, x.privilege_type, x.grantor::regrole::text) FROM pg_catalog.pg_class c, aclexplode(c.relacl) x WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND x.grantee = 'authenticated'::regrole), '') || '#' || coalesce((SELECT string_agg(cp.table_name || '.' || cp.column_name || ':' || cp.privilege_type || ':' || cp.is_grantable, ';' ORDER BY cp.table_name, cp.column_name, cp.privilege_type) FROM information_schema.column_privileges cp WHERE cp.grantee = 'authenticated' AND cp.table_schema = 'public' AND cp.table_name = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])), ''))) IS DISTINCT FROM nullif(current_setting('gazpet.rls_ofertare_20261004b_auth', true), '') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: privilegiile authenticated (tabel/ACL/coloane) s-au schimbat';
  END IF;
  -- Garda (final)
  IF current_setting('gazpet.revenire_20261004b', true) IS DISTINCT FROM 'REVINE_RLS_OFERTARE:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: revenirea nu e armată (gazpet.revenire_20261004b)' USING ERRCODE = '42501';
  END IF;
END
$revenire_20261004b$;
