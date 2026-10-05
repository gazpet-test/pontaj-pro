-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261015a_clarificari_tipare_impact_owner_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Readuce clarificari_tipare la drepturile din 20261007a (SELECT pe tabel pentru authenticated) și scoate
-- fn_tipare_impact_intern().
-- ⚠️ Readuce și scurgerea: impact_intern (cost, risc_respingere, tehnic) redevine lizibil pentru ORICE utilizator logat.
-- ⚠️ Biblioteca juridică (după 20261015a) citește impactul doar prin funcție: după revenire owner-ul vede în fișa
--    tiparului „Impactul intern nu s-a putut încărca” până la un deploy de UI care citește din nou coloana.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261015a', 'IMPACT_INTERN_PENTRU_TOTI:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE
  v_rel oid := to_regclass('public.clarificari_tipare');
  v_fn  oid := to_regprocedure('public.fn_tipare_impact_intern()');
BEGIN
  IF current_setting('gazpet.revenire_20261015a', true) IS DISTINCT FROM 'IMPACT_INTERN_PENTRU_TOTI:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261015a: nearmată (gazpet.revenire_20261015a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261015a=%') THEN
    RAISE EXCEPTION 'Revenire 20261015a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261015a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- Starea EXACTĂ a patch-ului: altfel un drept adăugat între timp ar rămâne sau s-ar pierde tăcut
  IF v_rel IS NULL
     OR (SELECT relacl::text FROM pg_class WHERE oid = v_rel) IS DISTINCT FROM '{postgres=arwdDxtm/postgres,authenticated=awdxt/postgres,service_role=arwdDxtm/postgres}'
     OR (SELECT string_agg(attname || '=' || coalesce(attacl::text, '-'), ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND NOT attisdropped)
        IS DISTINCT FROM 'pattern_id={authenticated=r/postgres},cod_vechi={authenticated=r/postgres},tip_problema={authenticated=r/postgres},'
                      || 'titlu={authenticated=r/postgres},trigger={authenticated=r/postgres},documente_de_verificat={authenticated=r/postgres},'
                      || 'normative_refs={authenticated=r/postgres},precedente_cnsc={authenticated=r/postgres},intrebare_propusa={authenticated=r/postgres},'
                      || 'impact_intern=-,confidence={authenticated=r/postgres},requires_human_legal_review={authenticated=r/postgres},'
                      || 'note={authenticated=r/postgres},versiune_import={authenticated=r/postgres},created_at={authenticated=r/postgres},updated_at={authenticated=r/postgres}' THEN
    RAISE EXCEPTION 'Revenire 20261015a: precondiție — drepturile pe clarificari_tipare nu sunt exact cele ale patch-ului 20261015a';
  END IF;
  IF v_fn IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_tipare_impact_intern' AND pronamespace = 'public'::regnamespace) <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM 'abe51117016b6ca18e6bfb48589ef1c8'
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) IS NOT TRUE
     OR (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = v_fn)
        IS DISTINCT FROM 'authenticated=X/postgres postgres=X/postgres service_role=X/postgres'
     OR EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = v_fn AND deptype = 'n') THEN
    RAISE EXCEPTION 'Revenire 20261015a: precondiție — fn_tipare_impact_intern nu e exact cea a patch-ului (unică, md5 corp, SECDEF, ACL) sau are dependențe';
  END IF;
END $arm$;

DROP FUNCTION public.fn_tipare_impact_intern();
REVOKE SELECT (pattern_id, cod_vechi, tip_problema, titlu, trigger, documente_de_verificat, normative_refs, precedente_cnsc,
               intrebare_propusa, confidence, requires_human_legal_review, note, versiune_import, created_at, updated_at)
  ON public.clarificari_tipare FROM authenticated;
GRANT SELECT ON public.clarificari_tipare TO authenticated;

DO $post$
DECLARE
  v_rel oid := 'public.clarificari_tipare'::regclass;
BEGIN
  IF (SELECT relacl::text FROM pg_class WHERE oid = v_rel) IS DISTINCT FROM '{postgres=arwdDxtm/postgres,authenticated=arwdxt/postgres,service_role=arwdDxtm/postgres}'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_tipare_impact_intern' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Revenire 20261015a: postcondiție — ACL-ul nu e cel din 20261007a, au rămas drepturi pe coloane sau funcția există încă';
  END IF;
END $post$;

DO $final$
BEGIN
  IF current_setting('gazpet.revenire_20261015a', true) IS DISTINCT FROM 'IMPACT_INTERN_PENTRU_TOTI:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261015a: armarea s-a pierdut pe parcurs — refuz';
  END IF;
END $final$;
