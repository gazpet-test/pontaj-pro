-- ════════════════════════════════════════════════════════════════════════════
-- 20261004b_rls_ofertare_preturi_oferte — DRAFT, NEAPLICAT. RLS + privilegii pe tabelele Ofertare găsite deschise de matricea de acces
-- (docs/SECURITATE_MATRICE_ACCES_2026-09-30.md §1.5 și #6; recomandarea §4: fn_are_acces_ofertare() la
-- citire ȘI scriere pe prețuri și oferte furnizori). Completează #537 (care nu atinge tabele/politici).
-- Tabele (20): grupul A = citire ȘI scriere doar cu modulul Ofertare (fn_are_acces_ofertare()):
--   oferta_materiale, ofertare_calibrari, ofertare_calibrari_subcontractori, ofertare_oferte_deschidere, ofertare_oferte_furnizori, ofertare_preturi_materiale, ofertare_preturi_unitare, ofertare_rfq, ofertare_rfq_destinatari, ofertare_rfq_materiale, ofertare_rfq_oferte, ofertare_rfq_preturi, probe_oferte
-- grupul B = citire pentru orice cont logat (folosite și în afara Ofertare: Ședințe, Generator contract
--   montaj, Grafic poartă, view-urile v_ofertare_dotari / v_ofertare_pt_stare), scriere doar cu modulul:
--   ofertare_brokeri, ofertare_categorii_reguli, ofertare_experienta, ofertare_normative, ofertare_norme_productivitate, ofertare_parteneri, ofertare_radar
-- anon: REVOKE ALL (azi arwdDxtm pe toate 20). authenticated: GRANT-urile rămân; TRUNCATE pentru authenticated
--   rămâne în patch-ul separat P14 (TRUNCATE/default privileges), nu aici.
--
-- Precondiții (fail-closed): helper-ul fn_are_acces_ofertare() cu amprenta din 30.09; md5 al setului de
--   politici pe cele 20 de tabele = 9784b08e2edf7f9c37b5e7873e6f0e04 (citit read-only pe 30.09); anon are ALL pe toate 20.
--   Dacă live s-a schimbat, migrarea refuză și nu face nimic.
-- Postcondiții: md5 politici = 59290db392d6f8828faed9b4d94770db; anon fără niciun privilegiu pe cele 20.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (gardă gazpet.livrare_migrare legată de txid; fără
--   BEGIN/COMMIT în fișier; un singur bloc DO). Revenire: supabase/revenire/20261004b_rls_ofertare_preturi_oferte_ROLLBACK.sql.
-- Detalii, matrice, riscuri: docs/RLS_OFERTARE.md. Test: scripts/test_rls_ofertare.mjs.
-- ════════════════════════════════════════════════════════════════════════════
DO $migrare_20261003c$
DECLARE
  v_stare text;
BEGIN
  -- Garda (start)
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004b_rls_ofertare_preturi_oferte:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261004b_rls_ofertare_preturi_oferte se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare)' USING ERRCODE = '42501';
  END IF;
  -- Precondiții: helper-ul neschimbat, RLS pornit pe toate 20 tabele
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 1 THEN
    RAISE EXCEPTION 'REFUZ: fn_are_acces_ofertare() lipsește sau diferă de amprenta citită pe 30.09 (md5 429d28e2a61fb24c8009d67050c16c85, SECDEF, STABLE, fără anon)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])) <> 20 THEN
    RAISE EXCEPTION 'REFUZ: RLS nu e pornit pe toate cele 20 tabele (sau lipsește un tabel)';
  END IF;
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]));
  IF v_stare = '59290db392d6f8828faed9b4d94770db' AND (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) = 0 THEN
    RAISE EXCEPTION 'REFUZ: starea e deja cea a patch-ului 20261004b_rls_ofertare_preturi_oferte (nimic de făcut; nu se reaplică)';
  END IF;
  IF v_stare IS DISTINCT FROM '9784b08e2edf7f9c37b5e7873e6f0e04' THEN
    RAISE EXCEPTION 'REFUZ: politicile live s-au schimbat față de citirea din 30.09 (md5 % ≠ 9784b08e2edf7f9c37b5e7873e6f0e04). Se reface pre-check-ul.', v_stare;
  END IF;
  IF (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('anon', 'public.'||t, 'SELECT') AND has_table_privilege('anon', 'public.'||t, 'INSERT') AND has_table_privilege('anon', 'public.'||t, 'UPDATE') AND has_table_privilege('anon', 'public.'||t, 'DELETE') AND has_table_privilege('anon', 'public.'||t, 'TRUNCATE')) <> 20 THEN
    RAISE EXCEPTION 'REFUZ: privilegiile anon diferă de citirea din 30.09 (se aștepta ALL pe toate 20)';
  END IF;
  EXECUTE 'DROP POLICY oferta_materiale_select ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_write ON public.oferta_materiale';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_sel ON public.oferta_materiale AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_ins ON public.oferta_materiale AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_upd ON public.oferta_materiale AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_del ON public.oferta_materiale AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.oferta_materiale FROM anon';
  EXECUTE 'DROP POLICY brokeri_all ON public.ofertare_brokeri';
  EXECUTE 'CREATE POLICY ofertare_brokeri_rls_sel ON public.ofertare_brokeri AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_brokeri_rls_ins ON public.ofertare_brokeri AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_brokeri_rls_upd ON public.ofertare_brokeri AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_brokeri_rls_del ON public.ofertare_brokeri AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_brokeri FROM anon';
  EXECUTE 'DROP POLICY cal_all ON public.ofertare_calibrari';
  EXECUTE 'CREATE POLICY ofertare_calibrari_rls_sel ON public.ofertare_calibrari AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_calibrari_rls_ins ON public.ofertare_calibrari AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_calibrari_rls_upd ON public.ofertare_calibrari AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_calibrari_rls_del ON public.ofertare_calibrari AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_calibrari FROM anon';
  EXECUTE 'DROP POLICY ocs_del ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ocs_ins ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ocs_sel ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'DROP POLICY ocs_upd ON public.ofertare_calibrari_subcontractori';
  EXECUTE 'CREATE POLICY ofertare_calibrari_subcontractori_rls_sel ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_calibrari_subcontractori_rls_ins ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_calibrari_subcontractori_rls_upd ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_calibrari_subcontractori_rls_del ON public.ofertare_calibrari_subcontractori AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_calibrari_subcontractori FROM anon';
  EXECUTE 'DROP POLICY p_categorii_reguli_citire ON public.ofertare_categorii_reguli';
  EXECUTE 'DROP POLICY p_categorii_reguli_scriere ON public.ofertare_categorii_reguli';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_sel ON public.ofertare_categorii_reguli AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_ins ON public.ofertare_categorii_reguli AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_upd ON public.ofertare_categorii_reguli AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_del ON public.ofertare_categorii_reguli AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_categorii_reguli FROM anon';
  EXECUTE 'DROP POLICY ofertare_experienta_del ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_ins ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_sel ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_upd ON public.ofertare_experienta';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_sel ON public.ofertare_experienta AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_ins ON public.ofertare_experienta AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_upd ON public.ofertare_experienta AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_del ON public.ofertare_experienta AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_experienta FROM anon';
  EXECUTE 'DROP POLICY norm_all ON public.ofertare_normative';
  EXECUTE 'CREATE POLICY ofertare_normative_rls_sel ON public.ofertare_normative AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_normative_rls_ins ON public.ofertare_normative AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_normative_rls_upd ON public.ofertare_normative AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_normative_rls_del ON public.ofertare_normative AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_normative FROM anon';
  EXECUTE 'DROP POLICY onp_read ON public.ofertare_norme_productivitate';
  EXECUTE 'DROP POLICY onp_write ON public.ofertare_norme_productivitate';
  EXECUTE 'CREATE POLICY ofertare_norme_productivitate_rls_sel ON public.ofertare_norme_productivitate AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_norme_productivitate_rls_ins ON public.ofertare_norme_productivitate AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_norme_productivitate_rls_upd ON public.ofertare_norme_productivitate AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_norme_productivitate_rls_del ON public.ofertare_norme_productivitate AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_norme_productivitate FROM anon';
  EXECUTE 'DROP POLICY ofd_select ON public.ofertare_oferte_deschidere';
  EXECUTE 'DROP POLICY ofd_write ON public.ofertare_oferte_deschidere';
  EXECUTE 'CREATE POLICY ofertare_oferte_deschidere_rls_sel ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_oferte_deschidere_rls_ins ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_oferte_deschidere_rls_upd ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_oferte_deschidere_rls_del ON public.ofertare_oferte_deschidere AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_oferte_deschidere FROM anon';
  EXECUTE 'DROP POLICY oof_del ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY oof_ins ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY oof_sel ON public.ofertare_oferte_furnizori';
  EXECUTE 'DROP POLICY oof_upd ON public.ofertare_oferte_furnizori';
  EXECUTE 'CREATE POLICY ofertare_oferte_furnizori_rls_sel ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_oferte_furnizori_rls_ins ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_oferte_furnizori_rls_upd ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_oferte_furnizori_rls_del ON public.ofertare_oferte_furnizori AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_oferte_furnizori FROM anon';
  EXECUTE 'DROP POLICY ofertare_parteneri_all ON public.ofertare_parteneri';
  EXECUTE 'CREATE POLICY ofertare_parteneri_rls_sel ON public.ofertare_parteneri AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_parteneri_rls_ins ON public.ofertare_parteneri AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_parteneri_rls_upd ON public.ofertare_parteneri AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_parteneri_rls_del ON public.ofertare_parteneri AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_parteneri FROM anon';
  EXECUTE 'DROP POLICY pm_all ON public.ofertare_preturi_materiale';
  EXECUTE 'CREATE POLICY ofertare_preturi_materiale_rls_sel ON public.ofertare_preturi_materiale AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_preturi_materiale_rls_ins ON public.ofertare_preturi_materiale AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_preturi_materiale_rls_upd ON public.ofertare_preturi_materiale AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_preturi_materiale_rls_del ON public.ofertare_preturi_materiale AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_preturi_materiale FROM anon';
  EXECUTE 'DROP POLICY pu_all ON public.ofertare_preturi_unitare';
  EXECUTE 'CREATE POLICY ofertare_preturi_unitare_rls_sel ON public.ofertare_preturi_unitare AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_preturi_unitare_rls_ins ON public.ofertare_preturi_unitare AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_preturi_unitare_rls_upd ON public.ofertare_preturi_unitare AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_preturi_unitare_rls_del ON public.ofertare_preturi_unitare AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_preturi_unitare FROM anon';
  EXECUTE 'DROP POLICY radar_del ON public.ofertare_radar';
  EXECUTE 'DROP POLICY radar_ins ON public.ofertare_radar';
  EXECUTE 'DROP POLICY radar_sel ON public.ofertare_radar';
  EXECUTE 'DROP POLICY radar_upd ON public.ofertare_radar';
  EXECUTE 'CREATE POLICY ofertare_radar_rls_sel ON public.ofertare_radar AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL))';
  EXECUTE 'CREATE POLICY ofertare_radar_rls_ins ON public.ofertare_radar AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_radar_rls_upd ON public.ofertare_radar AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_radar_rls_del ON public.ofertare_radar AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_radar FROM anon';
  EXECUTE 'DROP POLICY rfq_all ON public.ofertare_rfq';
  EXECUTE 'CREATE POLICY ofertare_rfq_rls_sel ON public.ofertare_rfq AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_rls_ins ON public.ofertare_rfq AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_rls_upd ON public.ofertare_rfq AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_rls_del ON public.ofertare_rfq AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_rfq FROM anon';
  EXECUTE 'DROP POLICY rfqd_all ON public.ofertare_rfq_destinatari';
  EXECUTE 'CREATE POLICY ofertare_rfq_destinatari_rls_sel ON public.ofertare_rfq_destinatari AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_destinatari_rls_ins ON public.ofertare_rfq_destinatari AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_destinatari_rls_upd ON public.ofertare_rfq_destinatari AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_destinatari_rls_del ON public.ofertare_rfq_destinatari AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_rfq_destinatari FROM anon';
  EXECUTE 'DROP POLICY rfqm_all ON public.ofertare_rfq_materiale';
  EXECUTE 'CREATE POLICY ofertare_rfq_materiale_rls_sel ON public.ofertare_rfq_materiale AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_materiale_rls_ins ON public.ofertare_rfq_materiale AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_materiale_rls_upd ON public.ofertare_rfq_materiale AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_materiale_rls_del ON public.ofertare_rfq_materiale AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_rfq_materiale FROM anon';
  EXECUTE 'DROP POLICY rfqo_all ON public.ofertare_rfq_oferte';
  EXECUTE 'CREATE POLICY ofertare_rfq_oferte_rls_sel ON public.ofertare_rfq_oferte AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_oferte_rls_ins ON public.ofertare_rfq_oferte AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_oferte_rls_upd ON public.ofertare_rfq_oferte AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_oferte_rls_del ON public.ofertare_rfq_oferte AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_rfq_oferte FROM anon';
  EXECUTE 'DROP POLICY rfqp_all ON public.ofertare_rfq_preturi';
  EXECUTE 'CREATE POLICY ofertare_rfq_preturi_rls_sel ON public.ofertare_rfq_preturi AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_preturi_rls_ins ON public.ofertare_rfq_preturi AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_preturi_rls_upd ON public.ofertare_rfq_preturi AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_rfq_preturi_rls_del ON public.ofertare_rfq_preturi AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_rfq_preturi FROM anon';
  EXECUTE 'DROP POLICY pof_select ON public.probe_oferte';
  EXECUTE 'DROP POLICY pof_write ON public.probe_oferte';
  EXECUTE 'CREATE POLICY probe_oferte_rls_sel ON public.probe_oferte AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY probe_oferte_rls_ins ON public.probe_oferte AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY probe_oferte_rls_upd ON public.probe_oferte AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY probe_oferte_rls_del ON public.probe_oferte AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.probe_oferte FROM anon';
  -- Postcondiții (înainte de COMMIT; orice abatere anulează tot)
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]));
  IF v_stare IS DISTINCT FROM '59290db392d6f8828faed9b4d94770db' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: politicile rezultate (md5 %) ≠ starea patch-ului 59290db392d6f8828faed9b4d94770db', v_stare;
  END IF;
  IF (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) <> 0 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: anon mai are privilegii pe cel puțin un tabel din listă';
  END IF;
  -- Garda (final)
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004b_rls_ofertare_preturi_oferte:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261004b_rls_ofertare_preturi_oferte se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare)' USING ERRCODE = '42501';
  END IF;
END
$migrare_20261003c$;
