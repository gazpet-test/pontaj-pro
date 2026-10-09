-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261023b — Diurne: bifa „acces diurne” (profiles.can_access_diurne) primește și SCRIERE pe plățile de diurne
-- (cerere Răzvan 09.10.2026, varianta A: Natalia salvează și reface plăți; NU primește acces la Salarii).
-- Schimbă DOAR expresiile a 6 politici RLS existente (insert/update/delete pe diurna_payments și diurna_payment_details):
--   insert/update: is_owner OR can_access_salarii → + OR can_access_diurne · delete: is_owner → is_owner OR can_access_diurne
--   (acces Salarii NU primește ștergere — Copilot P22-1).
-- can_access_diurne se poate schimba doar de owner (trigger enforce_owner_only_salary_flags) ⇒ nu e auto-escaladabil;
-- migrarea verifică bariera (RLS profiles, INSERT owner-only, trigger activ cu corpul live) și refuză altfel (Copilot P23-1).
-- Fără obiecte noi, fără date, fără GRANT-uri. Pre/post: expresiile exacte ale politicilor; altfel refuz atomic.
-- Revenire: supabase/revenire/20261023b_diurne_scriere_acces_diurne_ROLLBACK.sql.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE
  c_sal  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true)))))';
  c_own  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))';
  c_nou  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true) OR (profiles.can_access_diurne = true)))))';
  c_del  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_diurne = true)))))';
  r record; v_q text; v_w text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261023b_diurne_scriere_acces_diurne:' || txid_current() THEN
    RAISE EXCEPTION '20261023b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261023b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.diurna_payments'::regclass, 'public.diurna_payment_details'::regclass)) <> 8 THEN
    RAISE EXCEPTION '20261023b: numar politici neasteptat';
  END IF;
  -- Copilot P23-1: noua autorizare se sprijină pe can_access_diurne = flag owner-only. Fail-closed dacă bariera nu e exact cea live:
  -- RLS pornit pe profiles, INSERT doar profiles_insert_owner, triggerul BEFORE UPDATE activ pe funcția cu corpul live (md5).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass) THEN
    RAISE EXCEPTION '20261023b: RLS oprit pe profiles';
  END IF;
  IF (SELECT array_agg(polname::text ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.profiles'::regclass AND polcmd IN ('a', '*'))
       IS DISTINCT FROM ARRAY['profiles_insert_owner']
     OR (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.profiles'::regclass AND polname = 'profiles_insert_owner')
       IS DISTINCT FROM '(EXISTS ( SELECT 1
   FROM profiles p2
  WHERE ((p2.id = auth.uid()) AND (p2.is_owner = true))))' THEN
    RAISE EXCEPTION '20261023b: politica INSERT pe profiles nu e owner-only';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'trg_enforce_owner_only_salary_flags'
          AND t.tgenabled IN ('O', 'A') AND t.tgtype = 19 AND NOT t.tgisinternal
          AND p.oid = to_regprocedure('public.enforce_owner_only_salary_flags()')
          AND md5(p.prosrc) = 'daaa561298c10c259944600e6c39467e' AND p.prosecdef
          AND pg_get_userbyid(p.proowner) = 'postgres'
          AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION '20261023b: bariera owner-only pe can_access_diurne (trigger enforce_owner_only_salary_flags) lipsa sau modificata';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('diurna_payments', 'diurna_payments_insert_salarii', 'a'),
      ('diurna_payments', 'diurna_payments_update_salarii', 'w'),
      ('diurna_payments', 'diurna_payments_delete_owner', 'd'),
      ('diurna_payment_details', 'diurna_payment_details_insert_salarii', 'a'),
      ('diurna_payment_details', 'diurna_payment_details_update_salarii', 'w'),
      ('diurna_payment_details', 'diurna_payment_details_delete_owner', 'd')) AS x(tab, pol, cmd) LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
      FROM pg_policy p WHERE p.polrelid = ('public.' || r.tab)::regclass AND p.polname = r.pol AND p.polcmd = r.cmd::"char"
        AND p.polpermissive AND p.polroles = ARRAY[0]::oid[];
    IF NOT FOUND
       OR (r.cmd = 'a' AND (v_q IS NOT NULL OR v_w IS DISTINCT FROM c_sal))
       OR (r.cmd = 'w' AND (v_q IS DISTINCT FROM c_sal OR v_w IS DISTINCT FROM c_sal))
       OR (r.cmd = 'd' AND (v_q IS DISTINCT FROM c_own OR v_w IS NOT NULL)) THEN
      RAISE EXCEPTION '20261023b: preconditie politica %.%', r.tab, r.pol;
    END IF;
    IF r.cmd = 'a' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK %s', r.pol, r.tab, c_nou);
    ELSIF r.cmd = 'w' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING %s WITH CHECK %s', r.pol, r.tab, c_nou, c_nou);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING %s', r.pol, r.tab, c_del);
    END IF;
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
      FROM pg_policy p WHERE p.polrelid = ('public.' || r.tab)::regclass AND p.polname = r.pol;
    IF (r.cmd = 'a' AND (v_q IS NOT NULL OR v_w IS DISTINCT FROM c_nou))
       OR (r.cmd = 'w' AND (v_q IS DISTINCT FROM c_nou OR v_w IS DISTINCT FROM c_nou))
       OR (r.cmd = 'd' AND (v_q IS DISTINCT FROM c_del OR v_w IS NOT NULL)) THEN
      RAISE EXCEPTION '20261023b: postconditie politica %.%', r.tab, r.pol;
    END IF;
  END LOOP;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261023b_diurne_scriere_acces_diurne:' || txid_current() THEN
    RAISE EXCEPTION '20261023b: garda final invalida';
  END IF;
END $migrare$;
