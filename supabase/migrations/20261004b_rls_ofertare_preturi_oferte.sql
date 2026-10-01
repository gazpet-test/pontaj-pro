-- ════════════════════════════════════════════════════════════════════════════
-- 20261004b_rls_ofertare_preturi_oferte — DRAFT, NEAPLICAT. RLS + privilegii pe tabelele Ofertare găsite deschise de matricea de acces
-- (docs/SECURITATE_MATRICE_ACCES_2026-09-30.md §1.5 și #6; recomandarea §4: fn_are_acces_ofertare() la
-- citire ȘI scriere pe prețuri și oferte furnizori). Completează #537 (care nu atinge tabele/politici). Runda 2.
-- Tabele (20): grupul A = citire ȘI scriere doar cu modulul Ofertare (fn_are_acces_ofertare()):
--   oferta_materiale, ofertare_brokeri, ofertare_calibrari, ofertare_calibrari_subcontractori, ofertare_categorii_reguli, ofertare_experienta, ofertare_normative, ofertare_oferte_deschidere, ofertare_oferte_furnizori, ofertare_preturi_materiale, ofertare_preturi_unitare, ofertare_radar, ofertare_rfq, ofertare_rfq_destinatari, ofertare_rfq_materiale, ofertare_rfq_oferte, ofertare_rfq_preturi, probe_oferte
-- grupul B = citire pentru orice cont logat (citite în afara Ofertare: Ședințe, Generator contract montaj,
--   Grafic poartă), scriere doar cu modulul: ofertare_norme_productivitate, ofertare_parteneri
--   Extinderea grupului B e decizie de business a lui Răzvan (docs/RLS_OFERTARE.md §3).
-- anon: REVOKE ALL. authenticated: neatins (amprentă salvată înainte, comparată după).
-- Compatibil cu SEC F1 (20260930i, TRUNCATE retras de la anon/authenticated) în orice ordine.
--
-- Precondiții (fail-closed): amprenta exactă a helper-ului + fără overload; md5 politici pe cele 20 = 9784b08e2edf7f9c37b5e7873e6f0e04
--   (citit read-only pe 30.09); anon = ALL (înainte de F1) sau ALL fără TRUNCATE (după F1); fără ACL pe coloane.
-- Postcondiții: md5 politici = 5a5ff33000684f9bd2bd62afbbe2ccbf; anon fără niciun privilegiu (8 de tabel + coloane);
--   authenticated identic cu înainte.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (gardă gazpet.livrare_migrare legată de txid; fără
--   BEGIN/COMMIT în fișier; un singur bloc DO). Revenire: supabase/revenire/20261004b_rls_ofertare_preturi_oferte_ROLLBACK.sql.
-- Detalii, matrice, riscuri: docs/RLS_OFERTARE.md. Test: scripts/test_rls_ofertare.mjs.
-- ════════════════════════════════════════════════════════════════════════════
DO $migrare_20261004b$
DECLARE
  v_stare text;
  v_n bigint;
BEGIN
  -- Garda (start)
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004b_rls_ofertare_preturi_oferte:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261004b_rls_ofertare_preturi_oferte se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare)' USING ERRCODE = '42501';
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
  IF v_stare = '5a5ff33000684f9bd2bd62afbbe2ccbf' AND (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr WHERE has_table_privilege('anon', 'public.'||t, pr)) = 0 THEN
    RAISE EXCEPTION 'REFUZ: starea e deja cea a patch-ului 20261004b_rls_ofertare_preturi_oferte (nimic de făcut; nu se reaplică)';
  END IF;
  IF v_stare IS DISTINCT FROM '9784b08e2edf7f9c37b5e7873e6f0e04' THEN
    RAISE EXCEPTION 'REFUZ: politicile live s-au schimbat față de citirea din 30.09 (md5 % ≠ 9784b08e2edf7f9c37b5e7873e6f0e04). Se reface pre-check-ul.', v_stare;
  END IF;
  -- anon: exact una din cele două stări predecesoare valide, uniform pe toate 20:
  --   înainte de F1 = arwdDxtm (8 privilegii, cu TRUNCATE) și authenticated cu TRUNCATE pe toate;
  --   după F1      = cele 7 fără TRUNCATE și authenticated fără TRUNCATE pe niciunul.
  IF NOT (((SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND (SELECT string_agg(x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.privilege_type) FROM aclexplode(c.relacl) x WHERE x.grantee = 'anon'::regrole) = 'DELETE:false,INSERT:false,MAINTAIN:false,REFERENCES:false,SELECT:false,TRIGGER:false,TRUNCATE:false,UPDATE:false') = 20 AND (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('authenticated', 'public.'||t, 'TRUNCATE')) = 20) OR ((SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND (SELECT string_agg(x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.privilege_type) FROM aclexplode(c.relacl) x WHERE x.grantee = 'anon'::regrole) = 'DELETE:false,INSERT:false,MAINTAIN:false,REFERENCES:false,SELECT:false,TRIGGER:false,UPDATE:false') = 20 AND (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_table_privilege('authenticated', 'public.'||t, 'TRUNCATE')) = 0)) THEN
    RAISE EXCEPTION 'REFUZ: privilegiile anon diferă de ambele stări valide (ALL înainte de F1 / ALL fără TRUNCATE după F1)';
  END IF;
  EXECUTE 'DROP POLICY oferta_materiale_select ON public.oferta_materiale';
  EXECUTE 'DROP POLICY oferta_materiale_write ON public.oferta_materiale';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_sel ON public.oferta_materiale AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_ins ON public.oferta_materiale AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_upd ON public.oferta_materiale AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY oferta_materiale_rls_del ON public.oferta_materiale AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.oferta_materiale FROM anon';
  EXECUTE 'DROP POLICY brokeri_all ON public.ofertare_brokeri';
  EXECUTE 'CREATE POLICY ofertare_brokeri_rls_sel ON public.ofertare_brokeri AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
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
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_sel ON public.ofertare_categorii_reguli AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_ins ON public.ofertare_categorii_reguli AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_upd ON public.ofertare_categorii_reguli AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_categorii_reguli_rls_del ON public.ofertare_categorii_reguli AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_categorii_reguli FROM anon';
  EXECUTE 'DROP POLICY ofertare_experienta_del ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_ins ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_sel ON public.ofertare_experienta';
  EXECUTE 'DROP POLICY ofertare_experienta_upd ON public.ofertare_experienta';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_sel ON public.ofertare_experienta AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_ins ON public.ofertare_experienta AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_upd ON public.ofertare_experienta AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'CREATE POLICY ofertare_experienta_rls_del ON public.ofertare_experienta AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
  EXECUTE 'REVOKE ALL ON TABLE public.ofertare_experienta FROM anon';
  EXECUTE 'DROP POLICY norm_all ON public.ofertare_normative';
  EXECUTE 'CREATE POLICY ofertare_normative_rls_sel ON public.ofertare_normative AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
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
  EXECUTE 'CREATE POLICY ofertare_radar_rls_sel ON public.ofertare_radar AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))';
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
  IF v_stare IS DISTINCT FROM '5a5ff33000684f9bd2bd62afbbe2ccbf' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: politicile rezultate (md5 %) ≠ starea patch-ului 5a5ff33000684f9bd2bd62afbbe2ccbf', v_stare;
  END IF;
  IF (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr WHERE has_table_privilege('anon', 'public.'||t, pr)) <> 0 OR (SELECT count(*) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t WHERE has_any_column_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,REFERENCES')) <> 0 OR (SELECT count(*) FROM information_schema.column_privileges cp WHERE cp.grantee IN ('anon', 'PUBLIC') AND cp.table_schema = 'public' AND cp.table_name = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])) <> 0 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: anon mai are privilegii (tabel: SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, sau pe coloane)';
  END IF;
  IF (SELECT md5(coalesce((SELECT string_agg(t || ':' || pr || '=' || has_table_privilege('authenticated', 'public.'||t, pr)::text, ';' ORDER BY t, pr) FROM unnest(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr), '') || '#' || coalesce((SELECT string_agg(c.relname || ':' || x.privilege_type || ':' || x.is_grantable::text || ':' || x.grantor::regrole::text, ';' ORDER BY c.relname, x.privilege_type, x.grantor::regrole::text) FROM pg_catalog.pg_class c, aclexplode(c.relacl) x WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[]) AND x.grantee = 'authenticated'::regrole), '') || '#' || coalesce((SELECT string_agg(cp.table_name || '.' || cp.column_name || ':' || cp.privilege_type || ':' || cp.is_grantable, ';' ORDER BY cp.table_name, cp.column_name, cp.privilege_type) FROM information_schema.column_privileges cp WHERE cp.grantee = 'authenticated' AND cp.table_schema = 'public' AND cp.table_name = ANY(ARRAY['oferta_materiale','ofertare_brokeri','ofertare_calibrari','ofertare_calibrari_subcontractori','ofertare_categorii_reguli','ofertare_experienta','ofertare_normative','ofertare_norme_productivitate','ofertare_oferte_deschidere','ofertare_oferte_furnizori','ofertare_parteneri','ofertare_preturi_materiale','ofertare_preturi_unitare','ofertare_radar','ofertare_rfq','ofertare_rfq_destinatari','ofertare_rfq_materiale','ofertare_rfq_oferte','ofertare_rfq_preturi','probe_oferte']::text[])), ''))) IS DISTINCT FROM nullif(current_setting('gazpet.rls_ofertare_20261004b_auth', true), '') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: privilegiile authenticated (tabel/ACL/coloane) s-au schimbat';
  END IF;
  -- Amprenta helper-ului reverificată la final (drift concurent → fail-closed)
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.pronamespace = 'public'::regnamespace AND p.oid::regprocedure::text = 'fn_are_acces_ofertare()' AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'sql' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.prokind = 'f' AND p.pronargs = 0 AND p.pronargdefaults = 0 AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: fn_are_acces_ofertare() nu mai are amprenta exactă';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: a apărut un overload fn_are_acces_ofertare';
  END IF;
  -- Garda (final)
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004b_rls_ofertare_preturi_oferte:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261004b_rls_ofertare_preturi_oferte se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare)' USING ERRCODE = '42501';
  END IF;
END
$migrare_20261004b$;
