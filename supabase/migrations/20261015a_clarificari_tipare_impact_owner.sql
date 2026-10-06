-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261015a — clarificari_tipare.impact_intern devine owner-only PE SERVER (P1 securitate, Copilot pe #618, 05.10.2026)
--
-- Problema (pre-existentă, din 20261007a): policy-ul clarificari_tipare_select = (auth.uid() IS NOT NULL) pe tot rândul
--   și GRANT SELECT pe tabel pentru authenticated ⇒ orice utilizator logat citește prin PostgREST impact_intern
--   (evaluarea internă: cost, risc_respingere, tehnic — completată la toate cele 119 tipare). Comentariul tabelului spune
--   „impact intern (nu se trimite)”; Biblioteca juridică (#618) îl ascundea doar în UI, ceea ce nu e o barieră.
-- Fix (fără mutare de date, fără tabel nou):
--   - authenticated pierde SELECT la nivel de tabel și primește SELECT pe celelalte 15 coloane, enumerate explicit.
--     RLS-ul rămâne cum e (rândurile tot pentru oricine e logat). INSERT/UPDATE/DELETE neschimbate (policy-uri owner).
--   - owner-ul citește impact_intern prin public.fn_tipare_impact_intern(): SECURITY DEFINER, search_path fix,
--     filtrată pe fn_is_app_owner(auth.uid()) ⇒ 0 rânduri pentru oricine altcineva. EXECUTE: authenticated + service_role.
--   - service_role (importerul, edge-urile) și postgres neatinse.
-- Cine citește tabelul (verificat 05.10): UI — OfertareTemeiuri, OfertareTipareDeclansate, OfertareBiblioteca, toate cu
--   coloane explicite, fără impact_intern; BD — fn_temei_citat_verifica (INVOKER, doar pattern_id +
--   requires_human_legal_review) și FK-urile din ofertare_clarificari_temeiuri. Niciun view dependent.
-- Atenție pe viitor: o coloană NOUĂ în clarificari_tipare nu e lizibilă pentru authenticated până nu primește GRANT
--   explicit (precondiția 0b refuză orice listă de coloane diferită de cea de azi).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261015a_clarificari_tipare_impact_owner_ROLLBACK.sql. Gate 0e = 0.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261015a_clarificari_tipare_impact_owner:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261015a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

DO $pre$
DECLARE
  v_rel oid := to_regclass('public.clarificari_tipare');
  f record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF v_rel IS NULL
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = v_rel) <> 'postgres'
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND NOT attisdropped)
        IS DISTINCT FROM 'pattern_id,cod_vechi,tip_problema,titlu,trigger,documente_de_verificat,normative_refs,precedente_cnsc,intrebare_propusa,impact_intern,confidence,requires_human_legal_review,note,versiune_import,created_at,updated_at' THEN
    RAISE EXCEPTION 'Precondiție 0b: clarificari_tipare lipsește sau diferă de cea live (owner postgres, RLS activ, exact cele 16 coloane în ordine)';
  END IF;
  IF (SELECT relacl::text FROM pg_class WHERE oid = v_rel) IS DISTINCT FROM '{postgres=arwdDxtm/postgres,authenticated=arwdxt/postgres,service_role=arwdDxtm/postgres}'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'Precondiție 0c: drepturile pe clarificari_tipare diferă de cele live (ACL exact pe tabel, niciun drept pe coloane)';
  END IF;
  IF (SELECT string_agg(polname::text || ':' || polcmd::text || ':' || polpermissive::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '-') || ':'
                        || coalesce(pg_get_expr(polwithcheck, polrelid), '-') || ':' || (SELECT string_agg(r::regrole::text, ',' ORDER BY r::regrole::text) FROM unnest(polroles) r),
                        ' | ' ORDER BY polname) FROM pg_policy WHERE polrelid = v_rel)
     IS DISTINCT FROM 'clarificari_tipare_delete_owner:d:true:fn_is_app_owner(auth.uid()):-:authenticated | '
                   || 'clarificari_tipare_insert_owner:a:true:-:fn_is_app_owner(auth.uid()):authenticated | '
                   || 'clarificari_tipare_select:r:true:(auth.uid() IS NOT NULL):-:authenticated | '
                   || 'clarificari_tipare_update_owner:w:true:fn_is_app_owner(auth.uid()):fn_is_app_owner(auth.uid()):authenticated' THEN
    RAISE EXCEPTION 'Precondiție 0d: policy-urile de pe clarificari_tipare diferă de cele live (4 policy-uri, expresii, roluri)';
  END IF;
  SELECT md5(p.prosrc) AS m, p.prosecdef, p.provolatile, l.lanname, pg_get_userbyid(p.proowner) AS own, p.proconfig,
         (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM unnest(p.proacl) a) AS acl
    INTO f
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.fn_is_app_owner(uuid)');
  IF NOT FOUND OR f.m IS DISTINCT FROM '8d335ed3fe345d3bf95ef0f1b2f8850a' OR f.prosecdef IS NOT TRUE OR f.provolatile <> 's'
     OR f.lanname <> 'sql' OR f.own <> 'postgres' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR f.acl IS DISTINCT FROM 'authenticated=X/postgres postgres=X/postgres service_role=X/postgres' THEN
    RAISE EXCEPTION 'Precondiție 0e: fn_is_app_owner(uuid) diferă de cea live (md5 corp, SECDEF, STABLE, sql, owner postgres, search_path, ACL)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_tipare_impact_intern' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Precondiție 0f: public.fn_tipare_impact_intern există deja';
  END IF;
END
$pre$;

REVOKE SELECT ON public.clarificari_tipare FROM authenticated;
GRANT SELECT (pattern_id, cod_vechi, tip_problema, titlu, trigger, documente_de_verificat, normative_refs, precedente_cnsc,
              intrebare_propusa, confidence, requires_human_legal_review, note, versiune_import, created_at, updated_at)
  ON public.clarificari_tipare TO authenticated;

CREATE FUNCTION public.fn_tipare_impact_intern()
RETURNS TABLE (pattern_id text, impact_intern jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT t.pattern_id, t.impact_intern
    FROM public.clarificari_tipare t
   WHERE public.fn_is_app_owner(auth.uid())
     AND t.impact_intern IS NOT NULL
   ORDER BY t.pattern_id
$fn$;
REVOKE ALL ON FUNCTION public.fn_tipare_impact_intern() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tipare_impact_intern() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_tipare_impact_intern() IS
  'impact_intern din clarificari_tipare DOAR pentru owner (fn_is_app_owner), 0 rânduri altfel. Coloana nu mai e lizibilă pentru authenticated (20261015a).';
-- PostgREST: lista de coloane permise și funcția nouă intră în cache la commit (nu doar prin event trigger-ul de DDL)
NOTIFY pgrst, 'reload schema';

DO $post$
DECLARE
  v_rel oid := 'public.clarificari_tipare'::regclass;
  v_fn  oid := to_regprocedure('public.fn_tipare_impact_intern()');
BEGIN
  IF has_column_privilege('authenticated', v_rel, 'impact_intern', 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_any_column_privilege('anon', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 1: impact_intern încă lizibil pentru authenticated, SELECT pe tabel rămas, sau anon vede coloane';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND NOT attisdropped
         AND attname <> 'impact_intern' AND has_column_privilege('authenticated', v_rel, attname, 'SELECT')) <> 15
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL) <> 15
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL
                   AND attacl::text <> '{authenticated=r/postgres}')
     OR (SELECT attacl FROM pg_attribute WHERE attrelid = v_rel AND attname = 'impact_intern') IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție 2: SELECT pe coloane greșit (trebuie exact cele 15 coloane fără impact_intern, doar authenticated=r)';
  END IF;
  IF (SELECT relacl::text FROM pg_class WHERE oid = v_rel) IS DISTINCT FROM '{postgres=arwdDxtm/postgres,authenticated=awdxt/postgres,service_role=arwdDxtm/postgres}'
     OR NOT has_column_privilege('service_role', v_rel, 'impact_intern', 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 3: ACL-ul tabelului nu e exact cel așteptat (authenticated fără r, restul neschimbat) sau service_role a pierdut impact_intern';
  END IF;
  IF v_fn IS NULL
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) IS NOT TRUE
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM 'abe51117016b6ca18e6bfb48589ef1c8'
     OR (SELECT provolatile FROM pg_proc WHERE oid = v_fn) <> 's'
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_fn) <> 'postgres'
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = v_fn)
        IS DISTINCT FROM 'authenticated=X/postgres postgres=X/postgres service_role=X/postgres' THEN
    RAISE EXCEPTION 'Postcondiție 4: fn_tipare_impact_intern nu e SECDEF/md5 corp/STABLE/owner postgres/search_path fix/ACL {postgres, authenticated, service_role}';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261015a_clarificari_tipare_impact_owner:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261015a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
