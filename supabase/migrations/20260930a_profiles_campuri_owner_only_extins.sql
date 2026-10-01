-- ============================================================================
-- S-A EXTINS (30.09.2026, rebazat 01.10.2026 pe SEC F2 r4) — NEAPLICAT. Se livrează DOAR prin scripts/livrare_migrare.sh,
-- cu acordul explicit al lui Răzvan (drepturi de acces ⇒ și GO Copilot).
-- Bază: corpul LIVE al fn_profiles_campuri_owner_only după 20260930j (SEC F2 r4, md5(prosrc) 9acc36a4…): regula „rol JWT
-- contradictoriu ⇒ 42501” și ramura service_role legată de session_user = 'authenticator' + role = 'service_role' se PĂSTREAZĂ.
-- Varianta inițială a acestui PR (scrisă peste 20260929g) ar fi ȘTERS hardening-ul F2 — înlocuită.
-- Singura schimbare față de live: lista coloanelor protejate crește de la 2 la 16:
--   * email                 → identitate în căutări după email (HrAngajatNouWizard, Logistica) și destinatarul mailurilor
--                              din edge functions; legitim îl schimbă doar owner-ul (Admin → Manageri);
--   * REGRESIE 02.06.2026: enforce_owner_only_salary_flags păzea și can_use_document_scanner, receive_tichete_* (6),
--     can_create_comenzi, can_process_achizitii, can_manage_stoc, can_access_ctc, whatsapp_tier; migrarea
--     20260602105459 le-a scăpat (verificat read-only pe live 01.10.2026: niciun trigger de pe profiles nu le mai menționează);
--   * + receive_bonuri_consum (niciodată protejat, dar dă drept de preluare în ConsumuriBonuriTab).
-- Tranzacția: UN SINGUR gestionar = runnerul (psql --single-transaction). Fișierul NU conține BEGIN/COMMIT.
-- Rollback: …_ROLLBACK.sql readuce EXACT varianta live F2 (2 coloane, md5 9acc36a4…) — NU varianta 20260929g.
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930a_profiles_campuri_owner_only_extins:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── 0. Precondiții fail-closed ──────────────────────────────────────────────────────────
DO $pre$
DECLARE v_md5 text; v_lipsa text[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- 0b. funcția live e EXACT varianta SEC F2 r4 (altfel cineva a schimbat-o între timp ⇒ se reanalizează, nu se suprascrie)
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.fn_profiles_campuri_owner_only()');
  IF v_md5 IS DISTINCT FROM '9acc36a4067eddbdf29956220023ea92' THEN
    RAISE EXCEPTION 'Precondiție 0b: fn_profiles_campuri_owner_only nu e varianta F2 r4 (md5 %, așteptat 9acc36a4…)', coalesce(v_md5, '<lipsă>');
  END IF;
  -- 0c. triggerul S-A există și e activ
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
                  AND tgenabled = 'O' AND tgfoid = 'public.fn_profiles_campuri_owner_only()'::regprocedure) THEN
    RAISE EXCEPTION 'Precondiție 0c: trg_profiles_campuri_owner_only lipsește / e dezactivat / nu cheamă funcția S-A';
  END IF;
  -- 0d. toate cele 16 coloane există pe profiles (un nume greșit ar da eroare abia la primul UPDATE, în producție)
  SELECT array_agg(c) INTO v_lipsa FROM unnest(ARRAY['department','employee_id','email','can_use_document_scanner','can_manage_stoc','can_create_comenzi','can_process_achizitii','can_access_ctc','receive_tichete_logistica','receive_tichete_hr','receive_tichete_administrativ','receive_tichete_it','receive_tichete_comercial','receive_tichete_financiar','receive_bonuri_consum','whatsapp_tier']::text[]) c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = c);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție 0d: coloane lipsă pe profiles: %', v_lipsa; END IF;
END $pre$;

-- ── 1. Funcția: corpul F2 r4 neschimbat, doar lista coloanelor extinsă ────────────────────
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
    WHEN NEW.department               IS DISTINCT FROM OLD.department               THEN 'department'
    WHEN NEW.employee_id              IS DISTINCT FROM OLD.employee_id              THEN 'employee_id'
    WHEN NEW.email                    IS DISTINCT FROM OLD.email                    THEN 'email'
    WHEN NEW.can_use_document_scanner IS DISTINCT FROM OLD.can_use_document_scanner THEN 'can_use_document_scanner'
    WHEN NEW.can_manage_stoc          IS DISTINCT FROM OLD.can_manage_stoc          THEN 'can_manage_stoc'
    WHEN NEW.can_create_comenzi       IS DISTINCT FROM OLD.can_create_comenzi       THEN 'can_create_comenzi'
    WHEN NEW.can_process_achizitii    IS DISTINCT FROM OLD.can_process_achizitii    THEN 'can_process_achizitii'
    WHEN NEW.can_access_ctc           IS DISTINCT FROM OLD.can_access_ctc           THEN 'can_access_ctc'
    WHEN NEW.receive_tichete_logistica     IS DISTINCT FROM OLD.receive_tichete_logistica     THEN 'receive_tichete_logistica'
    WHEN NEW.receive_tichete_hr            IS DISTINCT FROM OLD.receive_tichete_hr            THEN 'receive_tichete_hr'
    WHEN NEW.receive_tichete_administrativ IS DISTINCT FROM OLD.receive_tichete_administrativ THEN 'receive_tichete_administrativ'
    WHEN NEW.receive_tichete_it            IS DISTINCT FROM OLD.receive_tichete_it            THEN 'receive_tichete_it'
    WHEN NEW.receive_tichete_comercial     IS DISTINCT FROM OLD.receive_tichete_comercial     THEN 'receive_tichete_comercial'
    WHEN NEW.receive_tichete_financiar     IS DISTINCT FROM OLD.receive_tichete_financiar     THEN 'receive_tichete_financiar'
    WHEN NEW.receive_bonuri_consum    IS DISTINCT FROM OLD.receive_bonuri_consum    THEN 'receive_bonuri_consum'
    WHEN NEW.whatsapp_tier            IS DISTINCT FROM OLD.whatsapp_tier            THEN 'whatsapp_tier'
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

-- Triggerul NU se recreează (rămâne același, BEFORE UPDATE FOR EACH ROW, legat de aceeași funcție).

COMMENT ON FUNCTION public.fn_profiles_campuri_owner_only() IS
  'S-A extins (30.09.2026, peste SEC F2 r4): department, employee_id, email și 13 flaguri de drepturi se schimbă doar de owner (JWT), service_role (PostgREST, rol SQL efectiv) sau login-urile postgres/supabase_admin fără context de cerere; rol JWT contradictoriu ⇒ 42501.';

-- ── 2. Postcondiții — înainte de înregistrare și de COMMIT-ul runnerului ─────────────────────
DO $post$
DECLARE v_src text; v_lipsa text[]; v_n integer;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.fn_profiles_campuri_owner_only()'::regprocedure;
  -- p1. toate cele 16 coloane sunt în listă
  SELECT array_agg(c) INTO v_lipsa FROM unnest(ARRAY['department','employee_id','email','can_use_document_scanner','can_manage_stoc','can_create_comenzi','can_process_achizitii','can_access_ctc','receive_tichete_logistica','receive_tichete_hr','receive_tichete_administrativ','receive_tichete_it','receive_tichete_comercial','receive_tichete_financiar','receive_bonuri_consum','whatsapp_tier']::text[]) c WHERE position('NEW.' || c || ' ' IN v_src) = 0;
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție p1: coloane neprotejate: %', v_lipsa; END IF;
  -- p2. hardening-ul F2 r4 e încă acolo (anti-regresie)
  IF position('session_user = ''authenticator'' AND current_setting(''role'', true) = ''service_role''' IN v_src) = 0
     OR position('v_rol_claim IS DISTINCT FROM v_rol_claims' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Postcondiție p2: ramura service_role / regula claims contradictorii din SEC F2 r4 lipsește';
  END IF;
  -- p3. SECURITY DEFINER + search_path fix, nimeni nu o poate chema direct
  SELECT count(*) INTO v_n FROM pg_proc WHERE oid = 'public.fn_profiles_campuri_owner_only()'::regprocedure AND prosecdef
     AND proconfig @> ARRAY['search_path=public, pg_temp'];
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Postcondiție p3: funcția nu mai e SECURITY DEFINER cu search_path fix'; END IF;
  IF has_function_privilege('anon', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție p3: funcția de trigger e executabilă de anon/authenticated';
  END IF;
  -- p4. triggerul neatins și activ
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
                  AND tgenabled = 'O' AND tgfoid = 'public.fn_profiles_campuri_owner_only()'::regprocedure) THEN
    RAISE EXCEPTION 'Postcondiție p4: trg_profiles_campuri_owner_only nu mai e activ pe funcția S-A';
  END IF;
  RAISE NOTICE 'Livrare 20260930a: S-A extins la 16 coloane, peste F2 r4 (md5 nou %)', md5(v_src);
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930a_profiles_campuri_owner_only_extins:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930a: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
