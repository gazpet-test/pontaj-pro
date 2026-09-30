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
--   md5 c06d7ce0f212c7bba2093c50614a88fc; department, employee_id) verifică explicit claims + session_user, DAR (r4) ramura lui
--   „IF v_rol = 'service_role' THEN RETURN NEW” nu e legată de conexiune/rolul efectiv: un RPC apelat de authenticated care face
--   set_config('request.jwt.claims'/'request.jwt.claim.role', 'service_role') putea schimba department/employee_id. r4 îl include
--   în patch cu aceeași legare ca celelalte 3 (md5 patch 9acc36a4067eddbdf29956220023ea92) — nu mai e „modelul neatins”.
--   user_module_access nu are triggere (0 rânduri în pg_trigger) — nimic de reparat acolo pentru F2.
--
-- Ce face:
--   0. Precondiții fail-closed (md5 prosrc canonic): fiecare dintre cele 4 funcții e EXACT varianta live analizată sau
--      (reaplicare) exact varianta din acest patch; atributele (SECURITY DEFINER, proconfig, proprietar postgres, plpgsql,
--      trigger, fără argumente, o singură supraîncărcare); setul de triggere pe profiles e exact cel de 4 analizat (nume,
--      funcție, tgtype 19, activate, fără WHEN/coloane). Orice diferență ⇒ refuz, nimic modificat.
--   1. CREATE OR REPLACE pe cele 3 funcții: blocul „uid NULL ⇒ RETURN NEW” devine o politică explicită:
--        auth.uid() IS NULL ⇒ permis DOAR dacă (a) rolul JWT e 'service_role' ȘI session_user = 'authenticator' ȘI rolul SQL efectiv
--        current_setting('role') = 'service_role' (r3) (PostgREST cu
--        cheia service_role) sau (b) nu există niciun rol JWT (conexiune directă) ȘI session_user e postgres sau supabase_admin;
--        claim.role și claims.role contradictorii ⇒ refuz; JSON invalid în claims ⇒ auth.uid() cade primul cu 22P02
--        (fail-closed); altfel RAISE 42501. r3: legarea de rolul efectiv, după testul cu PostgREST 13.0.4 real
--        (scripts/test_sec_f2_postgrest.sh; valorile observate în docs/SEC_F1_F2_PATCH.md).
--        current_user NU e folosit: funcțiile sunt SECURITY DEFINER, deci current_user = postgres mereu.
--      Pentru utilizatorii reali (auth.uid() NOT NULL) comportamentul e IDENTIC cu cel de azi (aceleași verificări, aceleași
--      mesaje, aceeași resetare tăcută la enforce_owner_only_salary_flags). ACL-ul funcțiilor nu se schimbă (CREATE OR REPLACE păstrează).
--   1b. (r4) CREATE OR REPLACE pe fn_profiles_campuri_owner_only: singura schimbare = ramura service_role cere și
--        session_user = 'authenticator' ȘI current_setting('role') = 'service_role' + claim.role/claims.role contradictorii ⇒ 42501;
--        ramura directă (fără rol și fără sub, session_user postgres/supabase_admin), ramura owner și mesajele rămân identice.
--   0e. (r4, r5) Precondiție: 0 funcții SECURITY INVOKER în public/graphql_public, executabile de authenticated/anon, a căror
--        definiție reconstruită (pg_get_functiondef — include BEGIN ATOMIC) conține EXECUTE / set_config / SET [SESSION|LOCAL]
--        ROLE (gadgetul care ar ocoli legarea de rolul efectiv — rezidual acceptat, vezi doc §8).
--   2. Postcondiții (toate 4 funcțiile): md5 prosrc = variantele din patch, atributele neschimbate, ACL identic cu cel de dinainte, setul de 4 triggere intact.
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
  v_gadget text;
  r    record;
BEGIN
  -- 0a. fiecare dintre cele 4 funcții: o singură supraîncărcare, corp = varianta live analizată SAU varianta din patch (reaplicare), atribute exacte
  FOR r IN SELECT * FROM (VALUES
                 ('prevent_role_escalation', '16112659be92143e6539ae0e54e47a06'),
                 ('enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                 ('protect_can_access_pontaj_brut', 'ff277c90e02ef03d1efb34cd7e87b1d4'),
                 ('fn_profiles_campuri_owner_only', 'c06d7ce0f212c7bba2093c50614a88fc')) AS x(fn, m_live)
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
                 ('protect_can_access_pontaj_brut', 'ff277c90e02ef03d1efb34cd7e87b1d4'),
                 ('fn_profiles_campuri_owner_only', 'c06d7ce0f212c7bba2093c50614a88fc')) AS x(fn, m_live) ON p.oid = to_regprocedure('public.' || x.fn || '()')
    JOIN (VALUES
                 ('prevent_role_escalation', 'cf75b37d522e2a6b0b9c9eabd72c27b4'),
                 ('enforce_owner_only_salary_flags', 'daaa561298c10c259944600e6c39467e'),
                 ('protect_can_access_pontaj_brut', '2eec050b53f37ec995da79e93a2a4686'),
                 ('fn_profiles_campuri_owner_only', '9acc36a4067eddbdf29956220023ea92')) AS y(fn, m_patch) ON y.fn = x.fn
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM x.m_live OR md5(p.prosrc) IS NOT DISTINCT FROM y.m_patch;
  IF v_ok IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Precondiție 0b: doar % din 4 funcții au corpul analizat (md5 prosrc live 30.09) sau pe cel din acest patch — corpul live diferă de ce s-a patch-uit; se reanalizează', v_ok;
  END IF;
  -- 0c. setul EXACT de triggere pe profiles (4, BEFORE UPDATE FOR EACH ROW, activate, fără WHEN/coloane), (corpul celui de-al 4-lea, S-A, e verificat în 0a/0b)
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
  -- 0e. (r4, r5) rezidualul acceptat al legării de rolul efectiv: PostgreSQL verifică SET ROLE față de session_user (authenticator
  --     e membru service_role), deci o funcție SECURITY INVOKER executabilă de authenticated/anon care face set_config('role', …) /
  --     SET [SESSION|LOCAL] ROLE / EXECUTE dinamic ar putea trece ramura (a). Azi (audit live 01.10): 0 astfel de funcții.
  --     r5: se scanează DEFINIȚIA RECONSTRUITĂ (pg_get_functiondef — acoperă și LANGUAGE sql BEGIN ATOMIC, al cărei corp stă în
  --     prosqlbody cu prosrc gol, plus clauzele SET din antet), în schemele expuse de PostgREST: public și graphql_public.
  --     prokind 'f'/'p' (agregatele nu au definiție reconstituibilă; CASE garantează că pg_get_functiondef nu e evaluat pe ele).
  --     Fail-closed intenționat: fals-pozitivele (comentariu cu „execute”, set_config inofensiv) refuză și ele — omul analizează
  --     lista din mesaj. Dacă apare vreuna la momentul aplicării ⇒ REFUZ. Aceeași interogare = SQL-ul de control post-deploy
  --     din docs/SEC_F1_F2_PATCH.md §8.
  SELECT count(*), string_agg(g.functie, ', ' ORDER BY g.functie) INTO v_n, v_gadget
    FROM (SELECT p.oid::regprocedure::text AS functie,
                 CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END AS def
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('public', 'graphql_public') AND p.prokind IN ('f', 'p') AND NOT p.prosecdef
             AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) g
   WHERE g.def ~* '\mexecute\M' OR g.def ~* 'set_config' OR g.def ~* 'set\s+(session\s+|local\s+)?role';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0e: % funcții SECURITY INVOKER din public/graphql_public, executabile de authenticated/anon, conțin EXECUTE/set_config/SET [SESSION|LOCAL] ROLE în definiție (posibil gadget pentru SET ROLE service_role — rezidualul acceptat al F2 nu mai e 0; fail-closed, poate fi și fals-pozitiv): % — un om analizează lista înainte de aplicare', v_n, v_gadget;
  END IF;
  -- 0d. ACL-ul de azi al celor 4 funcții, salvat pentru comparația de la final (CREATE OR REPLACE trebuie să-l păstreze)
  PERFORM set_config('gazpet.sec_f2_acl_inainte',
    (SELECT string_agg(p.proname::text || '=' || coalesce(p.proacl::text, '<null>'), ';' ORDER BY p.proname)
       FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.prevent_role_escalation()'),
                                      to_regprocedure('public.enforce_owner_only_salary_flags()'),
                                      to_regprocedure('public.protect_can_access_pontaj_brut()'),
                                   to_regprocedure('public.fn_profiles_campuri_owner_only()'))), true);
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Cele 4 funcții: politica explicită pe auth.uid() IS NULL; restul corpului IDENTIC cu varianta live
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
    -- SEC F2 r3 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => auth.uid() (evaluat primul) cade cu 22P02,
    --   fail-closed; handlerul de mai jos e doar apărare suplimentară.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). r3: ramura (a) cere și rolul SQL EFECTIV al cererii,
    --   current_setting('role') = 'service_role' — PostgREST îl setează din JWT (SET LOCAL ROLE) și SECURITY DEFINER nu-l
    --   schimbă (verificat cu PostgREST 13.0.4 real); un RPC rulat ca authenticated care își pune singur claim-urile
    --   service_role are role = 'authenticated' => refuz.
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
    IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
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
    -- SEC F2 r3 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => auth.uid() (evaluat primul) cade cu 22P02,
    --   fail-closed; handlerul de mai jos e doar apărare suplimentară.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). r3: ramura (a) cere și rolul SQL EFECTIV al cererii,
    --   current_setting('role') = 'service_role' — PostgREST îl setează din JWT (SET LOCAL ROLE) și SECURITY DEFINER nu-l
    --   schimbă (verificat cu PostgREST 13.0.4 real); un RPC rulat ca authenticated care își pune singur claim-urile
    --   service_role are role = 'authenticated' => refuz.
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
    IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
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
    -- SEC F2 r3 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => auth.uid() (evaluat primul) cade cu 22P02,
    --   fail-closed; handlerul de mai jos e doar apărare suplimentară.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). r3: ramura (a) cere și rolul SQL EFECTIV al cererii,
    --   current_setting('role') = 'service_role' — PostgREST îl setează din JWT (SET LOCAL ROLE) și SECURITY DEFINER nu-l
    --   schimbă (verificat cu PostgREST 13.0.4 real); un RPC rulat ca authenticated care își pune singur claim-urile
    --   service_role are role = 'authenticated' => refuz.
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
    IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
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

-- r4: al 4-lea trigger (S-A) — singura schimbare: ramura service_role legată identic (session_user='authenticator' ȘI
-- current_setting('role')='service_role') + regula „claims contradictorii ⇒ 42501”; restul corpului IDENTIC cu varianta live c06d7ce0….
CREATE OR REPLACE FUNCTION public.fn_profiles_campuri_owner_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_camp   text;
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
  v_rol_claim  text;
  v_rol_claims text;
BEGIN
  v_camp := CASE
    WHEN NEW.department  IS DISTINCT FROM OLD.department  THEN 'department'
    WHEN NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN 'employee_id'
  END;
  IF v_camp IS NULL THEN
    RETURN NEW;                                   -- nicio coloană protejată schimbată
  END IF;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                       nullif(current_setting('request.jwt.claim', true), ''))::jsonb;
  v_rol := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  v_sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub');

  -- SEC F2 r4 (30.09.2026): cele două surse ale rolului JWT (request.jwt.claim.role și rolul din claims) nu au voie să se
  -- contrazică: ambele nevide și diferite => refuz (fail-closed), aliniat cu celelalte 3 triggere de pe profiles.
  v_rol_claim  := nullif(current_setting('request.jwt.claim.role', true), '');
  v_rol_claims := nullif(v_claims ->> 'role', '');
  IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (rol JWT contradictoriu: claim.role %, claims.role %)', v_camp, v_rol_claim, v_rol_claims
      USING ERRCODE = '42501';
  END IF;

  IF v_rol IS NULL AND v_sub IS NULL THEN
    -- fără context de cerere: conexiune directă la BD
    IF session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (conexiune fără identitate autorizată: %)', v_camp, session_user
      USING ERRCODE = '42501';
  END IF;

  -- SEC F2 r4: ramura service_role legată de rolul SQL efectiv, identic cu celelalte 3: conexiunea PostgREST (session_user =
  -- 'authenticator') ȘI rolul efectiv al cererii current_setting('role') = 'service_role' (SET LOCAL ROLE din JWT, nealterat de
  -- SECURITY DEFINER). Un RPC rulat ca authenticated care își pune singur claim-urile service_role (set_config) are
  -- role = 'authenticated' => cade mai jos pe 42501.
  IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF v_rol = 'authenticated' AND v_sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = v_sub AND is_owner IS TRUE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil', v_camp USING ERRCODE = '42501';
END $function$;

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
                 ('prevent_role_escalation', 'cf75b37d522e2a6b0b9c9eabd72c27b4'),
                 ('enforce_owner_only_salary_flags', 'daaa561298c10c259944600e6c39467e'),
                 ('protect_can_access_pontaj_brut', '2eec050b53f37ec995da79e93a2a4686'),
                 ('fn_profiles_campuri_owner_only', '9acc36a4067eddbdf29956220023ea92')) AS y(fn, m) ON p.oid = to_regprocedure('public.' || y.fn || '()')
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM y.m
     AND l.lanname::text IS NOT DISTINCT FROM 'plpgsql' AND p.prosecdef IS NOT DISTINCT FROM true
     AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
     AND p.prorettype IS NOT DISTINCT FROM 'trigger'::regtype::oid AND p.pronargs IS NOT DISTINCT FROM 0::int2;
  IF v_ok IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Postcondiție 2a: doar % din 4 funcții au corpul (md5 prosrc) și atributele cea din acest patch', v_ok;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace::oid
   AND p.proname IN ('prevent_role_escalation', 'enforce_owner_only_salary_flags', 'protect_can_access_pontaj_brut', 'fn_profiles_campuri_owner_only');
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Postcondiție 2a: % definiții pentru cele 4 nume (așteptat 4, fără supraîncărcări)', v_n;
  END IF;
  -- 2b. ACL identic cu cel de dinainte (CREATE OR REPLACE nu schimbă proacl; verificat explicit)
  SELECT string_agg(p.proname::text || '=' || coalesce(p.proacl::text, '<null>'), ';' ORDER BY p.proname) INTO v_acl
    FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.prevent_role_escalation()'),
                                   to_regprocedure('public.enforce_owner_only_salary_flags()'),
                                   to_regprocedure('public.protect_can_access_pontaj_brut()'),
                                   to_regprocedure('public.fn_profiles_campuri_owner_only()'));
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
