-- ════════════════════════════════════════════════════════════════════════════
-- 20261005b_rls_garantii_scriere — DRAFT, NEAPLICAT. Închide scrierea liberă pe tabelele de garanții.
-- Gaura (citită read-only pe live 01.10.2026): politici PERMISSIVE „ALL … auth.uid() IS NOT NULL” ⇒ orice cont logat
--   scrie/șterge: garantii_rw (garantii), gbe_polite_write, gbe_restituiri_write, contracte_terti_write (care anulează
--   regulile contracte_terti_insert/update/delete cu is_owner/can_manage_contracts — politicile permisive se adună cu OR).
-- Regula nouă de SCRIERE (INSERT/UPDATE/DELETE), helper public.fn_poate_scrie_garantii() (SECDEF, STABLE, sql):
--   is_owner ∨ profiles.role ∈ {superadmin, contabilitate, admin_logistica} (admin_logistica: decizia Răzvan 01.10, fluxul GBE din Ofertare)
--   ∨ user_module_access.module ∈ {'financiar','financiar.garantii'} cu access_level ∈ {admin, editor}.
--   garantii, gbe_polite, gbe_restituiri: scriere doar cu helper-ul.
--   contracte_terti: se scoate doar contracte_terti_write; rămân contracte_terti_insert/update (owner ∨ can_manage_contracts)
--     și contracte_terti_delete (doar owner), NEATINSE. Se adaugă contracte_terti_update_garantii (UPDATE cu helper-ul),
--     ca fluxul GBE din Financiar/Ofertare (GbeEvidenta: procent/valoare GBE pe contract) să meargă pentru contabilitate.
-- CITIREA rămâne identică: garantii SELECT auth.uid() IS NOT NULL; gbe_* SELECT true; contracte_terti_select neatins.
-- Neatinse: ofertare_garantii (are deja fn_are_acces_ofertare), ACL-urile de tabel, triggerele; edge functions cu
--   service_role ocolesc RLS (niciuna nu scrie azi în cele 4 tabele; ofertare-garantie-mail scrie ofertare_garantii).
-- Precondiții (fail-closed): md5 politici pe cele 4 tabele = 62f69c5942960f9e30c0a3c3c04d5e26 (live, 01.10); RLS pornit;
--   helper-ul nu există (nici overload); coloanele folosite există.
-- Postcondiții: md5 politici = starea patch-ului; amprenta helper-ului (SECDEF, search_path, STABLE, EXECUTE doar
--   authenticated/service_role/postgres, md5 prosrc); citirea neschimbată.
-- Revenire (NU e migrare): supabase/revenire/20261005b_rls_garantii_scriere_ROLLBACK.sql
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261005b_rls_garantii_scriere:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261005b_rls_garantii_scriere se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare, start)' USING ERRCODE = '42501';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_stare text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
        AND c.relname = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri'])) <> 4 THEN
    RAISE EXCEPTION 'REFUZ: RLS nu e pornit pe toate cele 4 tabele (sau lipsește un tabel)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_poate_scrie_garantii') THEN
    RAISE EXCEPTION 'REFUZ: fn_poate_scrie_garantii există deja (în orice schemă) — reaplicare sau coliziune de nume';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN
        (('profiles','id'),('profiles','is_owner'),('profiles','role'),('profiles','can_manage_contracts'),
         ('user_module_access','profile_id'),('user_module_access','module'),('user_module_access','access_level'))) <> 7 THEN
    RAISE EXCEPTION 'REFUZ: lipsesc coloane folosite de helper (profiles.id/is_owner/role/can_manage_contracts, user_module_access.profile_id/module/access_level)';
  END IF;
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),''))
                FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri']));
  IF v_stare IS DISTINCT FROM '62f69c5942960f9e30c0a3c3c04d5e26' THEN
    RAISE EXCEPTION 'REFUZ: politicile live pe garantii/gbe_polite/gbe_restituiri/contracte_terti s-au schimbat față de citirea din 01.10 (md5 % ≠ 62f69c5942960f9e30c0a3c3c04d5e26). Se reface pre-check-ul.', v_stare;
  END IF;
END $pre$;

-- Helper: fără set_config / request.jwt / SET ROLE / EXECUTE dinamic (gate 0e).
CREATE FUNCTION public.fn_poate_scrie_garantii()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid() AND (pr.is_owner IS TRUE OR pr.role IN ('superadmin', 'contabilitate', 'admin_logistica')))
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
                WHERE uma.profile_id = auth.uid() AND uma.module IN ('financiar', 'financiar.garantii')
                  AND uma.access_level IN ('admin', 'editor'))
  );
$fn$;
COMMENT ON FUNCTION public.fn_poate_scrie_garantii() IS
  'Scriere pe garantii / gbe_polite / gbe_restituiri (+ UPDATE contracte_terti pentru GBE): owner, superadmin, contabilitate, admin_logistica, financiar sau financiar.garantii (admin/editor). 20261005b.';
REVOKE ALL ON FUNCTION public.fn_poate_scrie_garantii() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_poate_scrie_garantii() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_garantii() TO authenticated, service_role;

-- garantii
DROP POLICY garantii_rw ON public.garantii;
CREATE POLICY garantii_rls_sel ON public.garantii AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL));
CREATE POLICY garantii_rls_ins ON public.garantii AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_rls_upd ON public.garantii AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_rls_del ON public.garantii AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii()));
-- gbe_polite (gbe_polite_select = true rămâne)
DROP POLICY gbe_polite_write ON public.gbe_polite;
CREATE POLICY gbe_polite_rls_ins ON public.gbe_polite AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY gbe_polite_rls_upd ON public.gbe_polite AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY gbe_polite_rls_del ON public.gbe_polite AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii()));
-- gbe_restituiri (gbe_restituiri_select = true rămâne)
DROP POLICY gbe_restituiri_write ON public.gbe_restituiri;
CREATE POLICY gbe_restituiri_rls_ins ON public.gbe_restituiri AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY gbe_restituiri_rls_upd ON public.gbe_restituiri AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY gbe_restituiri_rls_del ON public.gbe_restituiri AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii()));
-- contracte_terti: regula can_manage_contracts redevine efectivă; GBE pe contract pentru cine scrie garanții
DROP POLICY contracte_terti_write ON public.contracte_terti;
CREATE POLICY contracte_terti_update_garantii ON public.contracte_terti AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));

DO $post$
DECLARE v_stare text;
BEGIN
  v_stare := (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),''))
                FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri']));
  IF v_stare IS DISTINCT FROM 'baf4acedb64d79573a83804196d6b156' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: politicile rezultate (md5 %) ≠ starea patch-ului baf4acedb64d79573a83804196d6b156', v_stare;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri'])
               AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND (coalesce(qual,'') ~ '^\(?auth\.uid\(\) IS NOT NULL\)?$' OR coalesce(with_check,'') ~ '^\(?auth\.uid\(\) IS NOT NULL\)?$' OR qual = 'true' OR with_check = 'true')) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: a rămas o politică de scriere deschisă oricărui cont logat';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
       WHERE p.oid = 'public.fn_poate_scrie_garantii()'::regprocedure AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'sql'
         AND p.prosecdef AND p.provolatile = 's' AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.pronargs = 0
         AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
         AND md5(p.prosrc) = 'e8ee20a08440f3c93c763e4bff0670cf'
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false'
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_poate_scrie_garantii') <> 1 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE: fn_poate_scrie_garantii() nu are amprenta așteptată (postgres, sql, SECDEF, STABLE, search_path, md5, EXECUTE doar authenticated/service_role)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261005b_rls_garantii_scriere:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261005b_rls_garantii_scriere se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare, final)' USING ERRCODE = '42501';
  END IF;
END $post$;
