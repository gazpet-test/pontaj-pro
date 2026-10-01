-- ════════════════════════════════════════════════════════════════════════════
-- 20261005b_rls_garantii_scriere_ROLLBACK — NU e migrare (nu o parcurge niciun runner). Reface EXACT politicile citite
-- read-only pe 01.10.2026 pe garantii / gbe_polite / gbe_restituiri / contracte_terti și șterge helper-ul.
-- REDESCHIDE gaura (scriere pentru orice cont logat): se rulează doar cu acordul explicit al lui Răzvan + review.
-- Armare (în aceeași tranzacție, fără nimic altceva):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261005b', 'REDESCHIDE_GARANTII:' || txid_current(), true);
--   \i supabase/revenire/20261005b_rls_garantii_scriere_ROLLBACK.sql
--   COMMIT;
-- Precondiție: md5 politici = starea patch-ului (baf4acedb64d79573a83804196d6b156). Postcondiție: md5 62f69c5942960f9e30c0a3c3c04d5e26, helper absent.
-- ════════════════════════════════════════════════════════════════════════════
DO $revenire_20261005b$
DECLARE v_stare text;
BEGIN
  IF current_setting('gazpet.revenire_20261005b', true) IS DISTINCT FROM 'REDESCHIDE_GARANTII:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: revenirea nu e armată (gazpet.revenire_20261005b)' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261005b=%') THEN
    RAISE EXCEPTION 'REFUZ: armare persistentă (ALTER DATABASE/ROLE … SET) — refuzat';
  END IF;
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),''))
                FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri']));
  IF v_stare IS DISTINCT FROM 'baf4acedb64d79573a83804196d6b156' THEN
    RAISE EXCEPTION 'REFUZ: starea nu e cea a patch-ului 20261005b (md5 %)', v_stare;
  END IF;
  EXECUTE 'DROP POLICY contracte_terti_update_garantii ON public.contracte_terti';
  EXECUTE 'CREATE POLICY contracte_terti_write ON public.contracte_terti AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY garantii_rls_sel ON public.garantii';
  EXECUTE 'DROP POLICY garantii_rls_ins ON public.garantii';
  EXECUTE 'DROP POLICY garantii_rls_upd ON public.garantii';
  EXECUTE 'DROP POLICY garantii_rls_del ON public.garantii';
  EXECUTE 'CREATE POLICY garantii_rw ON public.garantii AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY gbe_polite_rls_ins ON public.gbe_polite';
  EXECUTE 'DROP POLICY gbe_polite_rls_upd ON public.gbe_polite';
  EXECUTE 'DROP POLICY gbe_polite_rls_del ON public.gbe_polite';
  EXECUTE 'CREATE POLICY gbe_polite_write ON public.gbe_polite AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP POLICY gbe_restituiri_rls_ins ON public.gbe_restituiri';
  EXECUTE 'DROP POLICY gbe_restituiri_rls_upd ON public.gbe_restituiri';
  EXECUTE 'DROP POLICY gbe_restituiri_rls_del ON public.gbe_restituiri';
  EXECUTE 'CREATE POLICY gbe_restituiri_write ON public.gbe_restituiri AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL))';
  EXECUTE 'DROP FUNCTION public.fn_poate_scrie_garantii()';
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),''))
                FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri']));
  IF v_stare IS DISTINCT FROM '62f69c5942960f9e30c0a3c3c04d5e26' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: politicile refăcute (md5 %) ≠ starea din 01.10 62f69c5942960f9e30c0a3c3c04d5e26', v_stare;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'fn_poate_scrie_garantii') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: helper-ul încă există';
  END IF;
  PERFORM set_config('gazpet.revenire_20261005b', '', true);
END
$revenire_20261005b$;
