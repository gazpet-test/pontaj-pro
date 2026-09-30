-- ════════════════════════════════════════════════════════════════════════════
-- 20261004b_rls_ofertare_preturi_oferte_ROLLBACK — NU e migrare (nu o parcurge niciun runner). Reface EXACT politicile și ACL-ul anon
-- citite read-only pe 30.09 (pg_policies = pg_get_expr) pe cele 20 de tabele. REDESCHIDE expunerea:
-- se rulează doar cu acordul explicit al lui Răzvan.
-- Armare (în aceeași tranzacție, fără nimic altceva):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261004b', 'REVINE_RLS_OFERTARE:' || txid_current(), true);
--   \i supabase/revenire/20261004b_rls_ofertare_preturi_oferte_ROLLBACK.sql
--   COMMIT;
-- Precondiție: starea = patch (md5 59290db392d6f8828faed9b4d94770db, anon fără privilegii). Postcondiție: md5 9784b08e2edf7f9c37b5e7873e6f0e04 + anon ALL.
-- ════════════════════════════════════════════════════════════════════════════
DO $revenire_20261004b$
DECLARE
  v_stare text;
BEGIN
  -- Garda (start)
  IF current_setting('gazpet.revenire_20261004b', true) IS DISTINCT FROM 'REVINE_RLS_OFERTARE:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: revenirea nu e armată (gazpet.revenire_20261004b)' USING ERRCODE = '42501';
  END IF;
  -- Precondiții: helper-ul neschimbat, RLS pornit pe toate 20 tabele
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 1 THEN
    RAISE EXCEPTION 'REFUZ: fn_are_acces_ofertare() lipsește sau diferă de amprenta citită pe 30.09 (md5 429d28e2a61fb24c8009d67050c16c85, SECDEF, STABLE, fără anon)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])) <> 20 THEN
    RAISE EXCEPTION 'REFUZ: RLS nu e pornit pe toate cele 20 tabele (sau lipsește un tabel)';
  END IF;
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]));
  IF v_stare IS DISTINCT FROM '59290db392d6f8828faed9b4d94770db' OR (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) <> 0 THEN
    RAISE EXCEPTION 'REFUZ: revenirea pornește doar din starea patch-ului 20261004b_rls_ofertare_preturi_oferte (md5 politici % ≠ 59290db392d6f8828faed9b4d94770db sau anon are privilegii)', v_stare;
  END IF;
  EXECUTE 'DROP POLICY oferta_materiale_rls_sel ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_rls_ins ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_rls_upd ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_rls_del ON public.oferta_materiale';
  EXECUTE 'CREATE POLICY oferta_materiale_select ON public.oferta_materiale AS PERMISSIVE FOR SELECT TO authenticated USING (true)';
  EXECUTE 'CREATE POLICY oferta_materiale_write ON public.oferta_materiale AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.oferta_materiale TO anon';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_sel ON public.ofertare_brokeri';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_ins ON public.ofertare_brokeri';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_upd ON public.ofertare_brokeri';
  EXECUTE 'DROP POLICY ofertare_brokeri_rls_del ON public.ofertare_brokeri';
  EXECUTE 'CREATE POLICY brokeri_all ON public.ofertare_brokeri AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_brokeri TO anon';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_sel ON public.ofertare_calibrari';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_ins ON public.ofertare_calibrari';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_upd ON public.ofertare_calibrari';
  EXECUTE 'DROP POLICY ofertare_calibrari_rls_del ON public.ofertare_calibrari';
  EXECUTE 'CREATE POLICY cal_all ON public.ofertare_calibrari AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_calibrari TO anon';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_sel ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_ins ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_upd ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ofertare_calibrari_subcontractori_rls_del ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'CREATE POLICY ocs_del ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ocs_ins ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ocs_sel ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ocs_upd ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_calibrari_subcontractori TO anon';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_sel ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_ins ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_upd ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY ofertare_categorii_reguli_rls_del ON public.ofertare_categorii_reguli';
  EXECUTE 'CREATE POLICY p_categorii_reguli_citire ON public.ofertare_categorii_reguli AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY p_categorii_reguli_scriere ON public.ofertare_categorii_reguli AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_categorii_reguli TO anon';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_sel ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_ins ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_upd ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_rls_del ON public.ofertare_experienta';
  EXECUTE 'CREATE POLICY ofertare_experienta_del ON public.ofertare_experienta AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_ins ON public.ofertare_experienta AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_sel ON public.ofertare_experienta AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_upd ON public.ofertare_experienta AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_experienta TO anon';
  EXECUTE 'DROP POLICY ofertare_normative_rls_sel ON public.ofertare_normative';
  EXECUTE 'DROP POLICY ofertare_normative_rls_ins ON public.ofertare_normative';
  EXECUTE 'DROP POLICY ofertare_normative_rls_upd ON public.ofertare_normative';
  EXECUTE 'DROP POLICY ofertare_normative_rls_del ON public.ofertare_normative';
  EXECUTE 'CREATE POLICY norm_all ON public.ofertare_normative AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_normative TO anon';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_sel ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_ins ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_upd ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY ofertare_norme_productivitate_rls_del ON public.ofertare_norme_productivitate';
  EXECUTE 'CREATE POLICY onp_read ON public.ofertare_norme_productivitate AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY onp_write ON public.ofertare_norme_productivitate AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_norme_productivitate TO anon';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_sel ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_ins ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_upd ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofertare_oferte_deschidere_rls_del ON public.ofertare_oferte_deschidere';
  EXECUTE 'CREATE POLICY ofd_select ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofd_write ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_oferte_deschidere TO anon';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_sel ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_ins ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_upd ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY ofertare_oferte_furnizori_rls_del ON public.ofertare_oferte_furnizori';
  EXECUTE 'CREATE POLICY oof_del ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY oof_ins ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY oof_sel ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY oof_upd ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_oferte_furnizori TO anon';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_sel ON public.ofertare_parteneri';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_ins ON public.ofertare_parteneri';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_upd ON public.ofertare_parteneri';
  EXECUTE 'DROP POLICY ofertare_parteneri_rls_del ON public.ofertare_parteneri';
  EXECUTE 'CREATE POLICY ofertare_parteneri_all ON public.ofertare_parteneri AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_parteneri TO anon';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_sel ON public.ofertare_preturi_materiale';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_ins ON public.ofertare_preturi_materiale';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_upd ON public.ofertare_preturi_materiale';
  EXECUTE 'DROP POLICY ofertare_preturi_materiale_rls_del ON public.ofertare_preturi_materiale';
  EXECUTE 'CREATE POLICY pm_all ON public.ofertare_preturi_materiale AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_preturi_materiale TO anon';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_sel ON public.ofertare_preturi_unitare';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_ins ON public.ofertare_preturi_unitare';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_upd ON public.ofertare_preturi_unitare';
  EXECUTE 'DROP POLICY ofertare_preturi_unitare_rls_del ON public.ofertare_preturi_unitare';
  EXECUTE 'CREATE POLICY pu_all ON public.ofertare_preturi_unitare AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_preturi_unitare TO anon';
  EXECUTE 'DROP POLICY ofertare_radar_rls_sel ON public.ofertare_radar';
  EXECUTE 'DROP POLICY ofertare_radar_rls_ins ON public.ofertare_radar';
  EXECUTE 'DROP POLICY ofertare_radar_rls_upd ON public.ofertare_radar';
  EXECUTE 'DROP POLICY ofertare_radar_rls_del ON public.ofertare_radar';
  EXECUTE 'CREATE POLICY radar_del ON public.ofertare_radar AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY radar_ins ON public.ofertare_radar AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY radar_sel ON public.ofertare_radar AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY radar_upd ON public.ofertare_radar AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_radar TO anon';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_sel ON public.ofertare_rfq';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_ins ON public.ofertare_rfq';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_upd ON public.ofertare_rfq';
  EXECUTE 'DROP POLICY ofertare_rfq_rls_del ON public.ofertare_rfq';
  EXECUTE 'CREATE POLICY rfq_all ON public.ofertare_rfq AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_rfq TO anon';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_sel ON public.ofertare_rfq_destinatari';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_ins ON public.ofertare_rfq_destinatari';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_upd ON public.ofertare_rfq_destinatari';
  EXECUTE 'DROP POLICY ofertare_rfq_destinatari_rls_del ON public.ofertare_rfq_destinatari';
  EXECUTE 'CREATE POLICY rfqd_all ON public.ofertare_rfq_destinatari AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_rfq_destinatari TO anon';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_sel ON public.ofertare_rfq_materiale';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_ins ON public.ofertare_rfq_materiale';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_upd ON public.ofertare_rfq_materiale';
  EXECUTE 'DROP POLICY ofertare_rfq_materiale_rls_del ON public.ofertare_rfq_materiale';
  EXECUTE 'CREATE POLICY rfqm_all ON public.ofertare_rfq_materiale AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_rfq_materiale TO anon';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_sel ON public.ofertare_rfq_oferte';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_ins ON public.ofertare_rfq_oferte';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_upd ON public.ofertare_rfq_oferte';
  EXECUTE 'DROP POLICY ofertare_rfq_oferte_rls_del ON public.ofertare_rfq_oferte';
  EXECUTE 'CREATE POLICY rfqo_all ON public.ofertare_rfq_oferte AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_rfq_oferte TO anon';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_sel ON public.ofertare_rfq_preturi';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_ins ON public.ofertare_rfq_preturi';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_upd ON public.ofertare_rfq_preturi';
  EXECUTE 'DROP POLICY ofertare_rfq_preturi_rls_del ON public.ofertare_rfq_preturi';
  EXECUTE 'CREATE POLICY rfqp_all ON public.ofertare_rfq_preturi AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.ofertare_rfq_preturi TO anon';
  EXECUTE 'DROP POLICY probe_oferte_rls_sel ON public.probe_oferte';
  EXECUTE 'DROP POLICY probe_oferte_rls_ins ON public.probe_oferte';
  EXECUTE 'DROP POLICY probe_oferte_rls_upd ON public.probe_oferte';
  EXECUTE 'DROP POLICY probe_oferte_rls_del ON public.probe_oferte';
  EXECUTE 'CREATE POLICY pof_select ON public.probe_oferte AS PERMISSIVE FOR SELECT TO authenticated USING (true)';
  EXECUTE 'CREATE POLICY pof_write ON public.probe_oferte AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'GRANT ALL ON TABLE public.probe_oferte TO anon';
  -- Postcondiții (înainte de COMMIT; orice abatere anulează tot)
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]));
  IF v_stare IS DISTINCT FROM '9784b08e2edf7f9c37b5e7873e6f0e04' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: politicile refăcute (md5 %) ≠ starea live din 30.09 9784b08e2edf7f9c37b5e7873e6f0e04', v_stare;
  END IF;
  IF (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('anon', 'public.'||t, 'SELECT') AND has_table_privilege('anon', 'public.'||t, 'INSERT') AND has_table_privilege('anon', 'public.'||t, 'UPDATE') AND has_table_privilege('anon', 'public.'||t, 'DELETE') AND has_table_privilege('anon', 'public.'||t, 'TRUNCATE')) <> 20 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: anon nu are din nou ALL pe toate 20 tabele';
  END IF;
  -- Garda (final)
  IF current_setting('gazpet.revenire_20261004b', true) IS DISTINCT FROM 'REVINE_RLS_OFERTARE:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: revenirea nu e armată (gazpet.revenire_20261004b)' USING ERRCODE = '42501';
  END IF;
END
$revenire_20261004b$;
