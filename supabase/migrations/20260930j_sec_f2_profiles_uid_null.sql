-- ============================================================================
-- SEC F2 — triggerele de pe profiles: „auth.uid() IS NULL” nu mai e o cale de ocolire — 30.09.2026
--
-- ⚠ NEAPLICAT. Draft pentru review (Copilot GO/NO-GO) + acordul explicit al lui Răzvan. Nu modifică date.
--
-- Gaura (citită read-only pe producție, 30.09.2026, PG 17.6; docs/SEC_F1_F2_PATCH.md):
--   profiles are 4 triggere BEFORE UPDATE FOR EACH ROW (tgtype 19), toate SECURITY DEFINER, proprietar postgres. Trei dintre ele
--   încep cu „IF auth.uid() IS NULL THEN RETURN NEW; END IF;”, adică orice context FĂRĂ sub în JWT sare peste verificare:
--     * prevent_role_escalation         (md5 prosrc 16112659be92143e6539ae0e54e47a06) — is_owner, role
--     * enforce_owner_only_salary_flags (md5 prosrc 0470660c0a819981ff914355c7f6d00a) — can_* + is_owner (resetare tăcută)
--     * protect_can_access_pontaj_brut  (md5 prosrc ff277c90e02ef03d1efb34cd7e87b1d4) — can_access_pontaj_brut
--   auth.uid() e NULL nu doar pentru service_role/postgres, ci și pentru cheia anon (role = 'anon', fără sub), pentru un JWT
--   authenticated fără sub sau pentru claims golite. Al patrulea trigger, fn_profiles_campuri_owner_only (S-A,
--   md5 c06d7ce0f212c7bba2093c50614a88fc), verifică deja explicit claims + session_user și NU se atinge — e modelul urmat aici.
--   user_module_access nu are triggere (0 rânduri în pg_trigger) — nimic de reparat acolo pentru F2.
--
-- Ce face:
--   0. Precondiții fail-closed (md5 prosrc canonic): fiecare dintre cele 3 funcții e EXACT varianta live analizată sau
--      (reaplicare) exact varianta din acest patch; atributele (SECURITY DEFINER, proconfig, proprietar postgres, plpgsql,
--      trigger, fără argumente, o singură supraîncărcare); setul de triggere pe profiles e exact cel de 4 analizat (nume,
--      funcție, tgtype 19, activate, fără WHEN/coloane). Orice diferență ⇒ refuz, nimic modificat.
--   1. CREATE OR REPLACE pe cele 3 funcții: blocul „uid NULL ⇒ RETURN NEW” devine o politică explicită:
--        auth.uid() IS NULL ⇒ permis DOAR dacă (a) rolul JWT e 'service_role' ȘI session_user = 'authenticator' (PostgREST cu
--        cheia service_role) sau (b) nu există niciun rol JWT (conexiune directă) ȘI session_user e postgres sau supabase_admin;
--        claim.role și claims.role contradictorii ⇒ refuz; JSON invalid ⇒ NULL; altfel RAISE 42501 (r2, după review).
--        Pasul următor de întărire (doar după un test PostgREST real): current_setting('role') = 'service_role' pe ramura (a).
--        current_user NU e folosit: funcțiile sunt SECURITY DEFINER, deci current_user = postgres mereu.
--      Pentru utilizatorii reali (auth.uid() NOT NULL) comportamentul e IDENTIC cu cel de azi (aceleași verificări, aceleași
--      mesaje, aceeași resetare tăcută la enforce_owner_only_salary_flags). ACL-ul funcțiilor nu se schimbă (CREATE OR REPLACE păstrează).
--   2. Postcondiții: md5 prosrc = variantele din patch, atributele neschimbate, ACL identic cu cel de dinainte, setul de 4 triggere intact.
--
-- Tranzacția: UN SINGUR gestionar = scripts/livrare_migrare.sh (fără BEGIN/COMMIT în fișier; garda de livrare start + final).
-- Rollback: supabase/migrations/20260930j_sec_f2_profiles_uid_null_ROLLBACK.sql (corpurile live din 30.09, verificate prin md5).
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930j_sec_f2_profiles_uid_null:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930j_sec_f2_profiles_uid_null: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
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
  -- 0a. fiecare funcție: o singură supraîncărcare, corp = varianta live analizată SAU varianta din patch (reaplicare), atribute exacte
  FOR r IN SELECT * FROM (VALUES
                 ('prevent_role_escalation', '16112659be92143e6539ae0e54e47a06'),
                 ('enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                 ('protect_can_access_pontaj_brut', 'ff277c90e02ef03d1efb34cd7e87b1d4')) AS x(fn, m_live)
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
                 ('prevent_role_escalation', '16112659be92143e6539ae0e54e47a06'),
                 ('enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                 ('protect_can_access_pontaj_brut', 'ff277c90e02ef03d1efb34cd7e87b1d4')) AS x(fn, m_live) ON p.oid = to_regprocedure('public.' || x.fn || '()')
    JOIN (VALUES
                 ('prevent_role_escalation', 'a57629d9181332660443bed7b5eccd5b'),
                 ('enforce_owner_only_salary_flags', '0f66e3367e230fe2b4a271e3387ce10d'),
                 ('protect_can_access_pontaj_brut', 'cf47425d97bd9b4b1c03d78bff7b6e6e')) AS y(fn, m_patch) ON y.fn = x.fn
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM x.m_live OR md5(p.prosrc) IS NOT DISTINCT FROM y.m_patch;
  IF v_ok IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Precondiție 0b: doar % din 3 funcții au corpul analizat (md5 prosrc live 30.09) sau pe cel din acest patch — corpul live diferă de ce s-a patch-uit; se reanalizează', v_ok;
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

-- ---------------------------------------------------------------------------
-- 1. Cele 3 funcții: politica explicită pe auth.uid() IS NULL; restul corpului IDENTIC cu varianta live
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol_claim  text;
  v_rol_claims text;
  v_rol        text;
BEGIN
  IF auth.uid() IS NULL THEN
    -- SEC F2 r2 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => rolul din claims e NULL.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). Pasul următor (după un test PostgREST real): și
    --   current_setting('role') = 'service_role' pe ramura (a).
    v_rol_claim := nullif(current_setting('request.jwt.claim.role', true), '');
    BEGIN
      v_rol_claims := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    EXCEPTION WHEN invalid_text_representation THEN
      v_rol_claims := NULL;
    END;
    IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
      RAISE EXCEPTION '%: rol JWT contradictoriu (claim.role: %, claims.role: %) — refuzat', 'prevent_role_escalation', v_rol_claim, v_rol_claims
        USING ERRCODE = '42501';
    END IF;
    v_rol := coalesce(v_rol_claim, v_rol_claims);
    IF v_rol = 'service_role' AND session_user = 'authenticator' THEN
      RETURN NEW;
    END IF;
    IF v_rol IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '%: modificare pe profiles fără identitate de utilizator și în afara contextului de sistem (rol JWT: %, session_user: %)',
      'prevent_role_escalation', coalesce(v_rol, '<niciunul>'), session_user USING ERRCODE = '42501';
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
DECLARE
  v_rol_claim  text;
  v_rol_claims text;
  v_rol        text;
BEGIN
  IF auth.uid() IS NULL THEN
    -- SEC F2 r2 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => rolul din claims e NULL.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). Pasul următor (după un test PostgREST real): și
    --   current_setting('role') = 'service_role' pe ramura (a).
    v_rol_claim := nullif(current_setting('request.jwt.claim.role', true), '');
    BEGIN
      v_rol_claims := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    EXCEPTION WHEN invalid_text_representation THEN
      v_rol_claims := NULL;
    END;
    IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
      RAISE EXCEPTION '%: rol JWT contradictoriu (claim.role: %, claims.role: %) — refuzat', 'enforce_owner_only_salary_flags', v_rol_claim, v_rol_claims
        USING ERRCODE = '42501';
    END IF;
    v_rol := coalesce(v_rol_claim, v_rol_claims);
    IF v_rol = 'service_role' AND session_user = 'authenticator' THEN
      RETURN NEW;
    END IF;
    IF v_rol IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '%: modificare pe profiles fără identitate de utilizator și în afara contextului de sistem (rol JWT: %, session_user: %)',
      'enforce_owner_only_salary_flags', coalesce(v_rol, '<niciunul>'), session_user USING ERRCODE = '42501';
  END IF;
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
DECLARE
  v_rol_claim  text;
  v_rol_claims text;
  v_rol        text;
BEGIN
  IF auth.uid() IS NULL THEN
    -- SEC F2 r2 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => rolul din claims e NULL.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). Pasul următor (după un test PostgREST real): și
    --   current_setting('role') = 'service_role' pe ramura (a).
    v_rol_claim := nullif(current_setting('request.jwt.claim.role', true), '');
    BEGIN
      v_rol_claims := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    EXCEPTION WHEN invalid_text_representation THEN
      v_rol_claims := NULL;
    END;
    IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
      RAISE EXCEPTION '%: rol JWT contradictoriu (claim.role: %, claims.role: %) — refuzat', 'protect_can_access_pontaj_brut', v_rol_claim, v_rol_claims
        USING ERRCODE = '42501';
    END IF;
    v_rol := coalesce(v_rol_claim, v_rol_claims);
    IF v_rol = 'service_role' AND session_user = 'authenticator' THEN
      RETURN NEW;
    END IF;
    IF v_rol IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '%: modificare pe profiles fără identitate de utilizator și în afara contextului de sistem (rol JWT: %, session_user: %)',
      'protect_can_access_pontaj_brut', coalesce(v_rol, '<niciunul>'), session_user USING ERRCODE = '42501';
  END IF;

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
-- 2. Postcondiții — ÎNAINTE de înregistrare și de COMMIT-ul runnerului: starea rezultată e EXACT cea din acest patch (altfel se anulează tot)
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
                 ('prevent_role_escalation', 'a57629d9181332660443bed7b5eccd5b'),
                 ('enforce_owner_only_salary_flags', '0f66e3367e230fe2b4a271e3387ce10d'),
                 ('protect_can_access_pontaj_brut', 'cf47425d97bd9b4b1c03d78bff7b6e6e')) AS y(fn, m) ON p.oid = to_regprocedure('public.' || y.fn || '()')
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM y.m
     AND l.lanname::text IS NOT DISTINCT FROM 'plpgsql' AND p.prosecdef IS NOT DISTINCT FROM true
     AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
     AND p.prorettype IS NOT DISTINCT FROM 'trigger'::regtype::oid AND p.pronargs IS NOT DISTINCT FROM 0::int2;
  IF v_ok IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Postcondiție 2a: doar % din 3 funcții au corpul (md5 prosrc) și atributele cea din acest patch', v_ok;
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
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930j_sec_f2_profiles_uid_null:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930j_sec_f2_profiles_uid_null: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
