-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20260930j_sec_f2_profiles_uid_null.sql (SEC F2, 30.09.2026).
--
-- ⚠ Readuce EXACT corpurile live din 30.09.2026 ale celor 3 funcții (md5 prosrc 16112659…, 0470660c…, ff277c90…), adică
--   REDESCHIDE ocolirea „auth.uid() IS NULL ⇒ RETURN NEW”. Fără GO de execuție: doar la decizia explicită a lui Răzvan, cu
--   motivul consemnat, după review. Revenirea operațională (păstrează politica): dacă un context de sistem legitim e refuzat
--   cu 42501, se identifică rolul/conexiunea din mesaj și se decide explicit dacă intră în lista de sistem — nu se revine tacit.
--   Precondiție: cele 3 funcții sunt exact variantele din patch (altfel refuz — nu se readuce varianta veche peste ceva neanalizat).
--   Postcondiție: md5 = variantele live 30.09, atribute și ACL neschimbate, 4 triggere pe profiles.
-- Tranzacția: același gestionar unic, scripts/livrare_migrare.sh (garda de livrare pe numele acestui fișier).
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930j_sec_f2_profiles_uid_null_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION 'Rollback 20260930j_sec_f2_profiles_uid_null: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții — fail-closed, NULL-safe (IS DISTINCT FROM): producția trebuie să fie exact starea analizată
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_n  integer;
  v_ok integer;
  r    record;
BEGIN
  -- 0a. fiecare funcție: o singură supraîncărcare, corp = varianta din patch SAU varianta live 30.09 (rollback deja aplicat), atribute exacte
  FOR r IN SELECT * FROM (VALUES
                 ('prevent_role_escalation', 'cf75b37d522e2a6b0b9c9eabd72c27b4'),
                 ('enforce_owner_only_salary_flags', 'daaa561298c10c259944600e6c39467e'),
                 ('protect_can_access_pontaj_brut', '2eec050b53f37ec995da79e93a2a4686')) AS x(fn, m_live)
  LOOP
    SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace::oid AND p.proname::text = r.fn;
    IF v_n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Precondiție 0a: public.% are % definiții (așteptat exact 1)', r.fn, v_n;
    END IF;
    SELECT count(*) INTO v_ok
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = to_regprocedure('public.' || r.fn || '()')
       AND l.lanname::text IS NOT DISTINCT FROM 'plpgsql' AND p.prosecdef IS NOT DISTINCT FROM true
       AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
       AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
       AND p.prorettype IS NOT DISTINCT FROM 'trigger'::regtype::oid AND p.pronargs IS NOT DISTINCT FROM 0::int2
       AND p.prokind IS NOT DISTINCT FROM 'f'::"char";
    IF v_ok IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Precondiție 0a: atributele lui public.%() nu sunt cele analizate (plpgsql, SECURITY DEFINER, search_path=public, pg_temp, proprietar postgres, RETURNS trigger)', r.fn;
    END IF;
  END LOOP;
  -- 0b. corpurile: md5(prosrc) canonic — live (analiza 30.09) sau patch (reaplicare); altceva ⇒ refuz (funcția s-a schimbat între timp)
  SELECT count(*) INTO v_ok
    FROM pg_proc p
    JOIN (VALUES
                 ('prevent_role_escalation', 'cf75b37d522e2a6b0b9c9eabd72c27b4'),
                 ('enforce_owner_only_salary_flags', 'daaa561298c10c259944600e6c39467e'),
                 ('protect_can_access_pontaj_brut', '2eec050b53f37ec995da79e93a2a4686')) AS x(fn, m_live) ON p.oid = to_regprocedure('public.' || x.fn || '()')
    JOIN (VALUES
                 ('prevent_role_escalation', '16112659be92143e6539ae0e54e47a06'),
                 ('enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                 ('protect_can_access_pontaj_brut', 'ff277c90e02ef03d1efb34cd7e87b1d4')) AS y(fn, m_patch) ON y.fn = x.fn
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM x.m_live OR md5(p.prosrc) IS NOT DISTINCT FROM y.m_patch;
  IF v_ok IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Precondiție 0b: doar % din 3 funcții au corpul analizat (md5 prosrc patch) sau pe cel din rollback (varianta live 30.09) — corpul live diferă de ce s-a patch-uit; se reanalizează', v_ok;
  END IF;
  -- 0c. setul EXACT de triggere pe profiles (4, BEFORE UPDATE FOR EACH ROW, activate, fără WHEN/coloane), cu al patrulea (S-A) neschimbat
  SELECT count(*) INTO v_n FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal;
  SELECT count(*) INTO v_ok
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN (VALUES ('prevent_role_escalation_trigger',     'prevent_role_escalation'),
                 ('trg_enforce_owner_only_salary_flags', 'enforce_owner_only_salary_flags'),
                 ('trg_profiles_campuri_owner_only',     'fn_profiles_campuri_owner_only'),
                 ('trg_protect_can_access_pontaj_brut',  'protect_can_access_pontaj_brut')) AS x(tg, fn)
      ON t.tgname::text IS NOT DISTINCT FROM x.tg AND p.proname::text IS NOT DISTINCT FROM x.fn
   WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
     AND t.tgenabled IS NOT DISTINCT FROM 'O'::"char" AND t.tgtype IS NOT DISTINCT FROM 19::int2
     AND t.tgqual IS NULL AND t.tgattr::text IS NOT DISTINCT FROM ''
     AND p.pronamespace IS NOT DISTINCT FROM 'public'::regnamespace::oid;
  IF v_n IS DISTINCT FROM 4 OR v_ok IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Precondiție 0c: triggerele de pe profiles nu sunt exact cele 4 analizate (% triggere, % conforme)', v_n, v_ok;
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
       IS DISTINCT FROM 'c06d7ce0f212c7bba2093c50614a88fc' THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_profiles_campuri_owner_only (S-A) nu mai e varianta canonică c06d7ce0… — modelul urmat de patch s-a schimbat; se reanalizează';
  END IF;
  -- 0d. ACL-ul de azi al celor 3 funcții, salvat pentru comparația de la final (CREATE OR REPLACE trebuie să-l păstreze)
  PERFORM set_config('gazpet.sec_f2_acl_inainte',
    (SELECT string_agg(p.proname::text || '=' || coalesce(p.proacl::text, '<null>'), ';' ORDER BY p.proname)
       FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.prevent_role_escalation()'),
                                      to_regprocedure('public.enforce_owner_only_salary_flags()'),
                                      to_regprocedure('public.protect_can_access_pontaj_brut()'))), true);
END $pre$;

-- 1. Corpurile live din 30.09.2026, neschimbate (md5 verificat în postcondiție)
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Skip pentru service_role / migrări (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Verifică modificare role
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar owners pot schimba rolul (incercat: % → %)', OLD.role, NEW.role;
    END IF;
  END IF;
  
  -- Verifică modificare is_owner
  IF OLD.is_owner IS DISTINCT FROM NEW.is_owner THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar owners pot schimba flag-ul is_owner';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_owner_only_salary_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner = true) THEN
    NEW.is_owner := OLD.is_owner;
    NEW.can_access_salarii := OLD.can_access_salarii;
    NEW.can_access_personal_data := OLD.can_access_personal_data;
    NEW.can_access_pontaj_brut := OLD.can_access_pontaj_brut;
    NEW.can_modify_employees := OLD.can_modify_employees;
    NEW.can_manage_contracts := OLD.can_manage_contracts;
    NEW.can_access_diurne := OLD.can_access_diurne;
    NEW.can_access_financiar := OLD.can_access_financiar;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_can_access_pontaj_brut()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Skip check pentru service role (auth.uid() returnează NULL)
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  
  IF (OLD.can_access_pontaj_brut IS DISTINCT FROM NEW.can_access_pontaj_brut) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar OWNER poate modifica can_access_pontaj_brut';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Postcondiții — ÎNAINTE de înregistrare și de COMMIT-ul runnerului: starea rezultată e EXACT starea live din 30.09 (altfel se anulează tot)
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_ok  integer;
  v_n   integer;
  v_acl text;
BEGIN
  SELECT count(*) INTO v_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    JOIN (VALUES
                 ('prevent_role_escalation', '16112659be92143e6539ae0e54e47a06'),
                 ('enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                 ('protect_can_access_pontaj_brut', 'ff277c90e02ef03d1efb34cd7e87b1d4')) AS y(fn, m) ON p.oid = to_regprocedure('public.' || y.fn || '()')
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM y.m
     AND l.lanname::text IS NOT DISTINCT FROM 'plpgsql' AND p.prosecdef IS NOT DISTINCT FROM true
     AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
     AND p.prorettype IS NOT DISTINCT FROM 'trigger'::regtype::oid AND p.pronargs IS NOT DISTINCT FROM 0::int2;
  IF v_ok IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Postcondiție 2a: doar % din 3 funcții au corpul (md5 prosrc) și atributele starea live din 30.09', v_ok;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace::oid
   AND p.proname IN ('prevent_role_escalation', 'enforce_owner_only_salary_flags', 'protect_can_access_pontaj_brut');
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Postcondiție 2a: % definiții pentru cele 3 nume (așteptat 3, fără supraîncărcări)', v_n;
  END IF;
  -- 2b. ACL identic cu cel de dinainte (CREATE OR REPLACE nu schimbă proacl; verificat explicit)
  SELECT string_agg(p.proname::text || '=' || coalesce(p.proacl::text, '<null>'), ';' ORDER BY p.proname) INTO v_acl
    FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.prevent_role_escalation()'),
                                   to_regprocedure('public.enforce_owner_only_salary_flags()'),
                                   to_regprocedure('public.protect_can_access_pontaj_brut()'));
  IF v_acl IS DISTINCT FROM current_setting('gazpet.sec_f2_acl_inainte', true) OR v_acl IS NULL THEN
    RAISE EXCEPTION 'Postcondiție 2b: ACL-ul funcțiilor s-a schimbat (înainte: %, după: %)', current_setting('gazpet.sec_f2_acl_inainte', true), v_acl;
  END IF;
  -- 2c. triggerele pe profiles: tot 4, legate de aceleași funcții, activate
  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled IS NOT DISTINCT FROM 'O'::"char"
     AND p.proname IN ('prevent_role_escalation', 'enforce_owner_only_salary_flags', 'protect_can_access_pontaj_brut', 'fn_profiles_campuri_owner_only');
  IF v_n IS DISTINCT FROM 4 OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Postcondiție 2c: setul de triggere pe profiles nu mai e cel de 4 (% conforme)', v_n;
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930j_sec_f2_profiles_uid_null_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION 'Rollback 20260930j_sec_f2_profiles_uid_null: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
