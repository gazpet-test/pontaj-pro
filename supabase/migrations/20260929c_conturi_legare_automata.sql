-- ============================================================================
-- R1 — legarea automată cont ↔ fișă de angajat (profiles.employee_id)
-- Specificație: docs/CONTURI_CICLU_VIATA.md, secțiunea A (+ 0.2: corecțiile din 30.09 după S-A live; 0.3: runda 3).
-- PRECONDIȚIE: S-A 20260929g (trg_profiles_campuri_owner_only) e LIVE; migrarea NU îl atinge.
--   * fn_identitate_*()                 — identitatea apelantului: O SINGURĂ sursă de adevăr pentru pachet,
--                                         regula S-A copiată 1:1 (fără „auth.uid() IS NULL ⇒ sistem”) (interne);
--                                         runda 3: „om” = JWT prin PostgREST al unui cont NErevocat (fără închidere
--                                         deschisă, fără ban activ) — fn_identitate_revocata
--   * fn_nume_cuvinte / fn_nume_familie — normalizarea numelor, comună pentru d (garda „aceeași persoană”) și e
--   * profiles.tip_cont (excepții marcate o dată: extern/test/sistem)
--   * fn_cont_candidati_angajat(email)  — potrivirea (internă)
--   * fn_cont_notifica_owneri(...)      — notificări owner, cu dedupe (internă)
--   * handle_new_user()                 — DOAR propune (nu mai scrie employee_id: sub login-ul GoTrue
--                                         supabase_auth_admin S-A refuză UPDATE-ul, iar eșecul era tăcut)
--   * fn_cont_leaga_la_creare(profil)   — calea de încredere: RPC chemat de funcția edge cont-nou (service_role)
--                                         sau de owner, după createUser cu app_metadata.gazpet_legare_automata
--   * trg_profiles_protectie_legatura   — employee_id / tip_cont / email / is_owner / role se schimbă doar de o
--                                         identitate privilegiată explicită; un cont închis (R2) nu se mai poate auto-edita
--   * fn_cont_leaga_automat(simulare, confirmate) — legare la cerere, poartă owner în cod; aplicarea leagă
--                                         DOAR perechile confirmate din previzualizare (fără TOCTOU)
--   * fn_admin_conturi_alerte() + v_admin_conturi_alerte — diagnostic, poartă owner în cod
-- Idempotentă (rulează de două ori fără erori). Nu atinge datele.
-- ============================================================================

-- A.0 Identitatea apelantului (corecția 30.09, audit A #4/#9) -------------------------
-- Modelul aprobat de Copilot (poarta GO/NO-GO), identic cu S-A (20260929g, liniile 45-65):
--   claims role='service_role' + session_user='authenticator' + current_setting('role')='service_role' → 'service_role'
--     (edge functions cu cheia service; legarea = SEC F2 r4, 20260930j — claims singure NU ajung);
--   claims role='authenticated' + sub = profil owner → 'owner';
--   FĂRĂ claims → 'db_login' DOAR pentru login-urile postgres / supabase_admin (migrări, SQL editor, pg_cron);
--   orice altceva (anon, authenticated non-owner, claims fără sub, supabase_auth_admin = GoTrue, authenticator
--   cu claims golite, storage…) → NULL. Lipsa identității NU deschide nimic.
-- session_user = login-ul conexiunii (nu se schimbă în SECURITY DEFINER / SET ROLE); current_user într-o funcție
-- SECURITY DEFINER e proprietarul funcției, NU apelantul → nu se folosește pentru decizii.
-- Triggerul S-A rămâne neatins (trecerea lui pe aceste funcții = GO separat).
-- ── Garda de livrare (start): DOAR prin scripts/livrare_migrare.sh (psql --single-transaction, marcaj legat de txid).
--    Fișierul NU conține BEGIN/COMMIT; psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260929c_conturi_legare_automata:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260929c: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── Precondiții fail-closed (adăugate 01.10.2026 pentru runner) ──────────────────────────
DO $pre_livrare$
DECLARE v_lipsa text[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY[]::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile migrării anterioare: %', v_lipsa; END IF;
  -- r3: nu doar numele — triggerul S-A e activ (O), cheamă exact funcția S-A și are tipul live (19 = BEFORE UPDATE FOR EACH ROW)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
                    AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
                    AND tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()')) THEN
    RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles: activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW) nu e live — se reanalizează';
  END IF;
  IF to_regprocedure('extensions.unaccent(text)') IS NULL THEN RAISE EXCEPTION 'Precondiție: extensions.unaccent(text) lipsește'; END IF;
  -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
  -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
     IS DISTINCT FROM '1114af39c13e295dd2ab666dab495567' THEN
    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta 30a (S-A extins peste F2 r4, md5 1114af39…) — se reanalizează';
  END IF;
  -- handle_new_user e RESCRISĂ de c: corpul live (01.10.2026, md5 94e5c5d3…) e cel din care pornește migrarea;
  -- la reaplicare (c deja livrată ⇒ fn_cont_leaga_la_creare există) se acceptă varianta proprie.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()'))
     IS DISTINCT FROM '94e5c5d33116df4466fb2e714887a9b2'
     AND to_regprocedure('public.fn_cont_leaga_la_creare(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Precondiție: handle_new_user() diferă de varianta live din 01.10.2026 (md5 94e5c5d3…) — se reanalizează';
  END IF;
  -- r3: la reaplicare (c deja livrată) handle_new_user trebuie să fie EXACT varianta c (md5 e2b0548a…), nu orice valoare
  IF to_regprocedure('public.fn_cont_leaga_la_creare(uuid)') IS NOT NULL
     AND (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()'))
         IS DISTINCT FROM 'e2b0548a51499b142a3e3f42cedd435c' THEN
    RAISE EXCEPTION 'Precondiție (reaplicare c): handle_new_user() nu e varianta livrată de 20260929c (md5 e2b0548a…) — se reanalizează';
  END IF;
  -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
  -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
                AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
    RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
  END IF;
END $pre_livrare$;

CREATE OR REPLACE FUNCTION public.fn_identitate_claims(OUT rol text, OUT sub text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_claims jsonb;
BEGIN
  -- aceleași surse și aceeași ordine ca S-A: claim.role / claim.sub (vechi), apoi claims, apoi claim (legacy)
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                       nullif(current_setting('request.jwt.claim', true), ''))::jsonb;
  rol := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_claims() FROM PUBLIC, anon, authenticated, service_role;

-- 'owner' | 'service_role' | 'db_login' | NULL — decizia de autorizare (aceeași ca S-A).
CREATE OR REPLACE FUNCTION public.fn_identitate_privilegiata()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE c record; v_rol text; v_rol_claim text; v_rol_claims text;
BEGIN
  SELECT * INTO c FROM public.fn_identitate_claims();
  IF c.rol IS NULL AND c.sub IS NULL THEN
    -- fără context de cerere: conexiune directă la BD
    RETURN CASE WHEN session_user IN ('postgres', 'supabase_admin') THEN 'db_login' END;
  END IF;
  -- Aliniat la SEC F2 r4 (20260930j, 01.10.2026): claim.role și claims.role contradictorii ⇒ fără identitate;
  -- service_role DOAR legat de conexiunea PostgREST (session_user = 'authenticator') ȘI de rolul SQL efectiv
  -- (current_setting('role') = 'service_role', pus de PostgREST prin SET LOCAL ROLE). Un RPC rulat ca authenticated
  -- care își pune singur claims service_role are role = 'authenticated' ⇒ NULL. Predicatul e copiat textual din F2.
  v_rol_claim := nullif(current_setting('request.jwt.claim.role', true), '');
  v_rol_claims := nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                                  nullif(current_setting('request.jwt.claim', true), ''))::jsonb ->> 'role', '');
  IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
    RETURN NULL;
  END IF;
  v_rol := c.rol;
  IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
    RETURN 'service_role';
  END IF;
  IF c.rol = 'authenticated' AND c.sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = c.sub AND is_owner IS TRUE) THEN
    RETURN 'owner';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_privilegiata() FROM PUBLIC, anon, authenticated, service_role;

-- uid-ul utilizatorului din JWT (claims role='authenticated' + sub uuid valid), altfel NULL.
-- Înlocuiește auth.uid() în pachet: fără 22P02 la un sub care nu e uuid, fără uid pentru anon/service_role.
CREATE OR REPLACE FUNCTION public.fn_identitate_uid()
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.fn_identitate_claims();
  IF c.rol = 'authenticated'
     AND c.sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN c.sub::uuid;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_uid() FROM PUBLIC, anon, authenticated, service_role;

-- Cont REVOCAT (runda 3, X10 / P1): închidere nerestaurată în jurnalul R2 sau ban activ în auth.users.
-- JWT-ul emis înainte de închidere rămâne valabil până la o oră (hook-ul pre-request = D9, neactivat), iar flagurile
-- lui rămân TRUE până rulează coada (≤ 5 min, calea HR) → fără verificarea asta un HR închis mai lucra ca HR.
-- Tabela jurnalului e creată de migrarea d → verificare cu to_regclass (c rămâne independentă de d).
CREATE OR REPLACE FUNCTION public.fn_identitate_revocata(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_uid AND u.banned_until > now()) THEN
    RETURN true;
  END IF;
  IF to_regclass('public.conturi_inchideri_jurnal') IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = p_uid AND j.restaurat_la IS NULL);
  END IF;
  RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_revocata(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- „Un om din platformă”: JWT authenticated venit prin PostgREST (login authenticator). O sesiune postgres
-- (MCP / SQL editor) care își pune singură claims de HR NU e om (audit B #9a). Folosit de R3 (acordul
-- de colaborare îl decide DOAR un om) și pentru atribuirea facut_de din jurnale.
-- Runda 3: un cont revocat (închis / banat) NU mai e „om” — porțile R3 îl refuză imediat, nu după coadă.
CREATE OR REPLACE FUNCTION public.fn_identitate_om()
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid;
BEGIN
  IF session_user IS DISTINCT FROM 'authenticator' THEN
    RETURN NULL;
  END IF;
  v_uid := public.fn_identitate_uid();
  IF v_uid IS NULL OR public.fn_identitate_revocata(v_uid) THEN
    RETURN NULL;
  END IF;
  RETURN v_uid;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_om() FROM PUBLIC, anon, authenticated, service_role;

-- Eticheta de audit (jurnale): 'db_login:postgres' · 'service_role' · 'owner:<uuid>' · 'authenticated:<uuid>' ·
-- 'anon' · 'fara_identitate:<login>'; sufixul '@<login>' apare când login-ul NU e authenticator (claims puse
-- dintr-o conexiune directă). Înlocuiește „facut_de NULL = sistem” (audit A #8).
CREATE OR REPLACE FUNCTION public.fn_identitate_eticheta()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE c record; v text;
BEGIN
  SELECT * INTO c FROM public.fn_identitate_claims();
  IF c.rol IS NULL AND c.sub IS NULL THEN
    RETURN CASE WHEN session_user IN ('postgres', 'supabase_admin') THEN 'db_login:' ELSE 'fara_identitate:' END || session_user;
  END IF;
  v := CASE
         WHEN c.rol = 'service_role' THEN
           CASE WHEN session_user = 'authenticator' AND current_setting('role', true) = 'service_role'
                THEN 'service_role' ELSE 'service_role_nelegat:' || coalesce(current_setting('role', true), '') END
         WHEN c.rol = 'authenticated' AND c.sub IS NOT NULL THEN
           CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id::text = c.sub AND is_owner IS TRUE)
                THEN 'owner:' ELSE 'authenticated:' END || c.sub
         ELSE coalesce(c.rol, 'fara_rol') || coalesce(':' || c.sub, '')
       END;
  IF session_user <> 'authenticator' THEN
    v := v || '@' || session_user;
  END IF;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_eticheta() FROM PUBLIC, anon, authenticated, service_role;

-- A.0b Normalizarea numelor (comună: garda „aceeași persoană” din d și omonimia din e) ------------------
-- Mutată din e în runda 3 (d o folosește acum, iar d nu depinde de e). Cuvintele unui nume: fără diacritice,
-- majuscule, distincte, sortate. Numele de familie = primul cuvânt din employees.name („NUME_FAMILIE PRENUME…”).
CREATE OR REPLACE FUNCTION public.fn_nume_cuvinte(p_nume text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT w ORDER BY w), '{}'::text[])
    FROM unnest(regexp_split_to_array(upper(extensions.unaccent(btrim(COALESCE(p_nume, '')))), '[^[:alnum:]]+')) w
   WHERE w <> '';
$fn$;
REVOKE ALL ON FUNCTION public.fn_nume_cuvinte(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nume_familie(p_nume text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT (array_remove(regexp_split_to_array(upper(extensions.unaccent(btrim(COALESCE(p_nume, '')))), '[^[:alnum:]]+'), ''))[1];
$fn$;
REVOKE ALL ON FUNCTION public.fn_nume_familie(text) FROM PUBLIC, anon, authenticated, service_role;

-- A.1 Tipul contului -----------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tip_cont text;
DO $garda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_tip_cont_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_tip_cont_chk
      CHECK (tip_cont IN ('angajat','extern','test','sistem'));
  END IF;
END $garda$;
COMMENT ON COLUMN public.profiles.tip_cont IS
  'NULL = nemarcat (tratat ca angajat). extern/test/sistem = excepție marcată o singură dată de owner, scoate contul din alerta „fără angajat”.';

-- A.2 Potrivirea cont → angajat (internă) ---------------------------------------
-- Univers: angajați activi cu contract neîncheiat. Pasul email (orice domeniu) are prioritate;
-- dacă găsește ceva, pasul nume nu mai rulează. Pasul nume doar pe @gazpet.ro, ≥ 2 tokeni distincți,
-- fiecare token = cuvânt întreg din nume (fără diacritice), în orice ordine, IAR numele de familie
-- (primul cuvânt din employees.name = „NUME_FAMILIE PRENUME...”) e obligatoriu printre tokeni
-- (altfel „ana.maria@” s-ar lega de singura IONESCU ANA MARIA activă). Apelantul trimite emailul de
-- LOGARE (auth.users.email), niciodată profiles.email.
CREATE OR REPLACE FUNCTION public.fn_cont_candidati_angajat(p_email text)
RETURNS TABLE(employee_id integer, employee_name text, metoda text, profil_legat uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH intrare AS (
    SELECT lower(btrim(p_email)) AS em,
           split_part(lower(btrim(p_email)), '@', 2) AS domeniu,
           array_remove(regexp_split_to_array(
             upper(extensions.unaccent(split_part(lower(btrim(p_email)), '@', 1))), '[._-]+'), '') AS tokeni
  ),
  univers AS (
    SELECT e.id, e.name, e.email
      FROM public.employees e
     WHERE e.active IS TRUE
       AND (e.termination_date IS NULL OR e.termination_date > CURRENT_DATE)
  ),
  pe_email AS (
    SELECT u.id, u.name, 'email'::text AS metoda
      FROM univers u, intrare i
     WHERE NULLIF(btrim(u.email), '') IS NOT NULL
       AND lower(btrim(u.email)) = i.em
  ),
  pe_nume AS (
    SELECT u.id, u.name, 'nume'::text AS metoda
      FROM univers u, intrare i
     WHERE NOT EXISTS (SELECT 1 FROM pe_email)
       AND i.domeniu = 'gazpet.ro'
       AND (SELECT count(DISTINCT t) FROM unnest(i.tokeni) t) >= 2
       AND regexp_split_to_array(upper(extensions.unaccent(btrim(u.name))), '[[:space:]-]+') @> i.tokeni
       AND (regexp_split_to_array(upper(extensions.unaccent(btrim(u.name))), '[[:space:]-]+'))[1] = ANY (i.tokeni)
  ),
  toate AS (SELECT * FROM pe_email UNION ALL SELECT * FROM pe_nume)
  SELECT t.id, t.name, t.metoda,
         (SELECT p.id FROM public.profiles p WHERE p.employee_id = t.id LIMIT 1)
    FROM toate t
   ORDER BY t.id;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_candidati_angajat(text) FROM PUBLIC, anon, authenticated, service_role;

-- A.3 Notificări pentru owneri (internă; nu blochează niciodată apelantul) ------
CREATE OR REPLACE FUNCTION public.fn_cont_notifica_owneri(p_type text, p_title text, p_message text, p_link text DEFAULT '/admin')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer := 0;
BEGIN
  BEGIN
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    SELECT p.id, p_type, 'HR', p_title, p_message, p_link
      FROM public.profiles p
     WHERE p.is_owner IS TRUE
       AND NOT EXISTS (SELECT 1 FROM public.notifications n
                        WHERE n.profile_id = p.id AND n.type = p_type
                          AND n.message IS NOT DISTINCT FROM p_message AND n.read_at IS NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_cont_notifica_owneri (%): % [%]', p_type, SQLERRM, SQLSTATE;
    v_n := 0;
  END;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_notifica_owneri(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- A.3 handle_new_user extinsă. Triggerul on_auth_user_created NU se atinge.
-- SECURITATE (constatarea critică din review, 29.09): în producție înscrierea publică e pornită
-- (createManager → supabase.auth.signUp cu cheia anon, publică în bundle) și confirmarea emailului e
-- automată. Dacă legarea s-ar face la ORICE înscriere, oricine și-ar face cont „prenume.nume@gazpet.ro”
-- (sau cu emailul personal trecut pe fișă) și ar primi imediat fișa acelui om → semnătura lui electronică.
-- CORECȚIA 30.09 (audit A #1, S-A live): triggerul NU mai scrie deloc employee_id. Rulează pe login-ul GoTrue
-- (supabase_auth_admin, fără claims), pe care S-A îl refuză (42501) — varianta veche prindea eroarea în tăcere și
-- contul rămânea nelegat, fără notificare pe alte domenii. Acum:
--   * calea de încredere (raw_app_meta_data.gazpet_legare_automata = true, pus DOAR de API-ul admin cu service_role):
--     legarea o face RPC-ul fn_cont_leaga_la_creare, chemat de funcția edge „cont-nou” după createUser; RPC-ul
--     anunță rezultatul (legat / eroare). Nu se adaugă supabase_auth_admin în lista albă S-A;
--   * orice altă cale: owner-ul primește PROPUNEREA (cont_legare_propusa) și confirmă din Admin → Manageri →
--     „Leagă automat” (fn_cont_leaga_automat, doar perechile confirmate);
--   * o eroare la potrivire ajunge la owner pe ORICE domeniu (cont_nelegat), la fel orice nelegare pe calea de încredere.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_n         integer := 0;
  v_emp       integer;
  v_nume      text;
  v_metoda    text;
  v_ocupat    boolean := false;
  v_incredere boolean := false;
  v_are_fisa  boolean := false;
  v_eroare    text;
  v_motiv     text;
BEGIN
  -- Inserăm doar dacă nu există deja (idempotent) — neschimbat
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'manager_santier'
  )
  ON CONFLICT (id) DO NOTHING;

  -- R1 sub-bloc 1: DOAR potrivirea (fără nicio scriere în profiles). Nicio eroare de aici nu blochează crearea contului.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
  EXCEPTION WHEN OTHERS THEN
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat; best-effort)
  BEGIN
    IF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      IF NOT v_incredere THEN
        -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
        PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
          format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
                 NEW.email, v_nume, v_emp, v_metoda),
          '/admin?tab=managers&cont=' || NEW.id::text);
      END IF;
      -- calea de încredere: legarea și anunțul le face fn_cont_leaga_la_creare (cont-nou); dacă RPC-ul nu vine,
      -- contul apare în alerta fara_angajat cu candidatul unic.
    ELSIF v_eroare IS NOT NULL OR v_incredere
          OR lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la potrivire: ' || v_eroare
        WHEN v_n = 0 THEN '0 candidați'
        WHEN v_n > 1 THEN v_n || ' candidați'
        WHEN v_ocupat THEN 'candidatul unic are deja cont'
        ELSE 'legătură existentă păstrată' END;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: %s', NEW.email, v_motiv),
        '/admin?tab=managers&cont=' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 notificare (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;
-- Funcția de trigger nu e apelabilă din API (P4: și fără service_role, pentru uniformitate).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;

-- A.3b Calea de încredere: legarea la creare (RPC) ------------------------------------
-- Chemat de funcția edge „cont-nou” (poartă owner în edge) cu cheia service, după
-- auth.admin.createUser({…, app_metadata:{gazpet_legare_automata:true}}), sau de owner.
-- Identitatea: DOAR 'service_role' sau 'owner' (fn_identitate_privilegiata) — pe ele S-A le acceptă.
-- Reverifică ATOMIC (profil blocat FOR UPDATE + indexul unic uniq_profiles_employee_id): marcajul de încredere,
-- emailul de logare CONFIRMAT (runda 3, condiția Copilot: identitate verificată = email de logare confirmat + marcaj),
-- legătura încă liberă, tipul contului, emailul profilului = emailul de logare, candidatul UNIC și liber.
-- Întoarce: legat | legatura_existenta | fara_marcaj_incredere | email_neconfirmat | tip_cont_exceptat | email_diferit |
--           fara_candidat | ambiguu | candidat_ocupat | inexistent | eroare.
CREATE OR REPLACE FUNCTION public.fn_cont_leaga_la_creare(p_profile_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ident  text := public.fn_identitate_privilegiata();
  v_p      public.profiles%ROWTYPE;
  v_email  text;
  v_incr   boolean;
  v_conf   boolean;
  v_n      integer;
  v_emp    integer;
  v_nume   text;
  v_metoda text;
  v_ocupat boolean;
  v_rez    text;
BEGIN
  IF v_ident IS NULL OR v_ident NOT IN ('service_role', 'owner') THEN
    RAISE EXCEPTION 'Legarea la creare o face doar funcția cont-nou (service_role) sau owner-ul' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'inexistent'; END IF;
  SELECT u.email::text, COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true', u.email_confirmed_at IS NOT NULL
    INTO v_email, v_incr, v_conf
    FROM auth.users u WHERE u.id = p_profile_id;
  IF NOT FOUND THEN RETURN 'inexistent'; END IF;
  IF NOT v_incr THEN RETURN 'fara_marcaj_incredere'; END IF;     -- signUp public / Dashboard: doar propunere
  IF NOT v_conf THEN RETURN 'email_neconfirmat'; END IF;         -- ex. invitație neacceptată: fără dovada adresei
  IF v_p.employee_id IS NOT NULL THEN RETURN 'legatura_existenta'; END IF;
  IF COALESCE(v_p.tip_cont, 'angajat') <> 'angajat' THEN RETURN 'tip_cont_exceptat'; END IF;
  IF lower(btrim(COALESCE(v_p.email, ''))) <> lower(btrim(COALESCE(v_email, ''))) THEN RETURN 'email_diferit'; END IF;
  SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda), COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
    INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
    FROM public.fn_cont_candidati_angajat(v_email) c;
  IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
  IF v_n > 1 THEN RETURN 'ambiguu'; END IF;
  IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
  BEGIN
    UPDATE public.profiles SET employee_id = v_emp
     WHERE id = p_profile_id AND employee_id IS NULL;             -- nu suprascrie niciodată
    v_rez := CASE WHEN FOUND THEN 'legat' ELSE 'legatura_existenta' END;
  EXCEPTION
    WHEN unique_violation THEN v_rez := 'candidat_ocupat';
    WHEN OTHERS THEN
      v_rez := 'eroare';
      RAISE WARNING 'fn_cont_leaga_la_creare (%): % [%]', v_email, SQLERRM, SQLSTATE;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: eroare la legare: %s', v_email, SQLERRM),
        '/admin?tab=managers&cont=' || p_profile_id::text);
  END;
  IF v_rez = 'legat' THEN
    PERFORM public.fn_cont_notifica_owneri('cont_legat_automat', '🔗 Cont nou legat automat de fișă',
      format('Cont nou %s legat automat de %s (#%s, prin %s)', v_email, v_nume, v_emp, v_metoda),
      '/admin?tab=managers&cont=' || p_profile_id::text);
  END IF;
  RETURN v_rez;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_leaga_la_creare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_la_creare(uuid) TO authenticated, service_role;

-- A.4 Protejarea legăturii, a tipului de cont și a emailului ----------------------
-- Închide gaura din profiles_update_own (oricine își putea pune singur employee_id = orice
-- angajat nelegat → acces la semnătura lui). Trec DOAR identitățile privilegiate explicite
-- (fn_identitate_privilegiata: owner JWT / service_role JWT / login postgres-supabase_admin fără claims).
-- CORECȚIA 30.09 (audit A #4, M1): varianta veche lăsa să treacă `auth.uid() IS NULL` (tiparul interzis: GoTrue,
-- authenticator cu claims golite, orice RPC SECURITY DEFINER care golește claims).
--   * employee_id: dublat intenționat de S-A (care decide primul, aceeași regulă de identitate) — apărare în adâncime
--     dacă S-A ar fi scos vreodată; tip_cont / email / contul închis le păzește DOAR triggerul acesta;
--   * email: legarea la cerere și alerta citesc emailul de LOGARE, dar profiles.email apare în UI și
--     primește notificările pe mail → îl schimbă doar owner-ul (Admin → Manageri);
--   * cont închis (R2, închidere nerestaurată în conturi_inchideri_jurnal): JWT-ul emis înainte de închidere
--     rămâne valabil până la o oră → fără garda asta omul și-ar repune singur flagurile neprotejate.
--     Tabela e creată de migrarea d → verificare cu to_regclass (migrarea c rămâne independentă).
--   * is_owner / role (runda 3, P10): triggerele vechi prevent_role_escalation / enforce_owner_only_salary_flags au
--     bypass „auth.uid() IS NULL” → anon / authenticator cu claims golite / GoTrue printr-un RPC SECURITY DEFINER
--     puteau pune is_owner = true (ancora identității „owner” a întregului pachet) sau role = superadmin. Acum trec
--     DOAR identitățile privilegiate explicite (owner JWT — Admin → Manageri; service_role; postgres fără claims).
--     Un authenticated non-owner e refuzat înainte de acest trigger de prevent_role_escalation (P0001).
-- UI-ul și testele se bazează pe SQLSTATE 42501, nu pe text (S-A dă alt mesaj pentru employee_id).
CREATE OR REPLACE FUNCTION public.fn_profiles_protectie_legatura()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF public.fn_identitate_privilegiata() IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.tip_cont IS DISTINCT FROM OLD.tip_cont THEN
    RAISE EXCEPTION 'Doar owner poate lega un cont de o fișă sau marca tipul contului' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_owner IS DISTINCT FROM OLD.is_owner OR NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Doar owner poate schimba rolul sau marcajul de owner al unui cont (identitate fără drept: %)',
      public.fn_identitate_eticheta() USING ERRCODE = '42501';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Emailul contului îl schimbă doar owner-ul (Admin → Manageri), odată cu emailul de logare' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.conturi_inchideri_jurnal') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = OLD.id AND j.restaurat_la IS NULL) THEN
      RAISE EXCEPTION 'Contul e închis (contract încheiat): profilul nu se mai poate modifica decât de owner' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_profiles_protectie_legatura() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_profiles_protectie_legatura ON public.profiles;
CREATE TRIGGER trg_profiles_protectie_legatura BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_protectie_legatura();

-- A.5 Legarea la cerere, cu previzualizare (poartă owner în cod) -----------------
-- Potrivirea se face pe emailul de LOGARE (auth.users.email). Profilurile unde profiles.email diferă de
-- emailul de logare sunt marcate „email_diferit” și sărite. Dacă mai multe conturi nelegate au același
-- candidat unic → toate „ambiguu” (și în simulare, și la aplicare).
-- CORECȚIA 30.09 (audit A #6 / C A1-2, TOCTOU): aplicarea (p_simulare=false) leagă DOAR perechile
-- [{profile_id, employee_id}] confirmate de owner din previzualizare și doar dacă potrivirea e încă aceeași:
--   * un cont apărut după previzualizare (ex. signUp public cu emailul personal al altcuiva) → „neconfirmat”;
--   * o pereche confirmată care acum ar lega altă fișă → „schimbat” (nu se leagă);
--   * fără listă → 22023. Previzualizarea arată data creării, provider-ul și marcajul de încredere ale contului.
-- Runda 3 (condiția Copilot „identitate verificată”): un cont cu emailul de logare NECONFIRMAT (email_confirmed_at NULL)
-- nu se potrivește → „email_neconfirmat” (sărit; owner-ul îl poate lega manual după confirmare).
DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean);
DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean, jsonb);
CREATE FUNCTION public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true, p_confirmate jsonb DEFAULT NULL)
RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text,
              metoda text, cont_creat_la timestamptz, cont_provider text, cont_incredere boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate lega automat conturile' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(p_simulare, true) AND (p_confirmate IS NULL OR jsonb_typeof(p_confirmate) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Aplicarea cere lista perechilor confirmate din previzualizare: p_confirmate = [{profile_id, employee_id}]'
      USING ERRCODE = '22023';
  END IF;
  FOR r IN
    WITH baza AS (
      SELECT pr.id AS pid, u.email AS uemail, u.created_at AS creat,
             u.raw_app_meta_data ->> 'provider' AS prov,
             COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true' AS incr,
             lower(btrim(COALESCE(pr.email, ''))) = lower(btrim(COALESCE(u.email, ''))) AS email_ok,
             u.email_confirmed_at IS NOT NULL AS conf
        FROM public.profiles pr
        JOIN auth.users u ON u.id = pr.id
       WHERE pr.employee_id IS NULL AND COALESCE(pr.tip_cont, 'angajat') = 'angajat'
    ),
    cand AS (
      SELECT b.pid, count(c.employee_id) AS n, min(c.employee_id) AS emp, min(c.employee_name) AS nume,
             min(c.metoda) AS met, COALESCE(bool_or(c.profil_legat IS NOT NULL), false) AS ocupat
        FROM baza b
        LEFT JOIN LATERAL public.fn_cont_candidati_angajat(b.uemail) c ON true
       WHERE b.email_ok AND b.conf
       GROUP BY b.pid
    )
    SELECT b.pid, b.uemail, b.creat, b.prov, b.incr, b.email_ok, b.conf, c.n, c.emp, c.nume, c.met, c.ocupat,
           count(*) FILTER (WHERE c.n = 1) OVER (PARTITION BY c.emp) AS pe_aceeasi_fisa
      FROM baza b
      LEFT JOIN cand c ON c.pid = b.pid
     ORDER BY b.uemail, b.pid
  LOOP
    profile_id := r.pid; email := r.uemail; cont_creat_la := r.creat; cont_provider := r.prov; cont_incredere := r.incr;
    employee_id := NULL; employee_name := NULL; metoda := NULL;
    IF NOT r.email_ok THEN
      rezultat := 'email_diferit';                        -- profiles.email ≠ emailul de logare: verifică manual
    ELSIF NOT r.conf THEN
      rezultat := 'email_neconfirmat';                    -- adresa de logare nedovedită: fără potrivire automată
    ELSIF COALESCE(r.n, 0) = 0 THEN
      rezultat := 'fara_candidat';
    ELSIF r.n > 1 THEN
      rezultat := 'ambiguu';
    ELSE
      employee_id := r.emp; employee_name := r.nume; metoda := r.met;
      IF r.ocupat THEN
        rezultat := 'candidat_ocupat';
      ELSIF r.pe_aceeasi_fisa > 1 THEN
        rezultat := 'ambiguu';                            -- mai multe conturi nelegate vor aceeași fișă
      ELSIF COALESCE(p_simulare, true) THEN
        rezultat := 'de_legat';
      ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_confirmate) x
                         WHERE jsonb_typeof(x) = 'object' AND x ->> 'profile_id' = r.pid::text) THEN
        rezultat := 'neconfirmat';                        -- nu era în previzualizarea confirmată
      ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_confirmate) x
                         WHERE jsonb_typeof(x) = 'object' AND x ->> 'profile_id' = r.pid::text
                           AND x ->> 'employee_id' = r.emp::text) THEN
        rezultat := 'schimbat';                           -- potrivirea s-a schimbat de la previzualizare
      ELSE
        BEGIN
          UPDATE public.profiles pr SET employee_id = r.emp
           WHERE pr.id = r.pid AND pr.employee_id IS NULL;
          rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
        EXCEPTION
          WHEN unique_violation THEN rezultat := 'candidat_ocupat';
          WHEN OTHERS THEN
            RAISE WARNING 'fn_cont_leaga_automat (%): % [%]', r.uemail, SQLERRM, SQLSTATE;
            rezultat := 'eroare';
        END;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END $fn$;
-- P3 (audit C): fără service_role — poarta e owner, service_role ar fi refuzat oricum.
REVOKE ALL ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) TO authenticated;

-- A.6 Diagnosticul pentru alerta de administrare (semnătură FIXĂ; migrarea d o extinde) --
-- Candidații și emailul afișat vin din emailul de LOGARE (auth.users.email), nu din profiles.email.
-- Runda 3 (P12b): `alocari` poartă marcajele de identitate ale contului — email_diferit (+ email_profil) când emailul
-- de logare ≠ profiles.email (ex. adresa de logare schimbată prin GoTrue), email_neconfirmat când adresa de logare
-- nu e confirmată. „Leagă automat” sare peste amândouă; alerta le arată owner-ului.
CREATE OR REPLACE FUNCTION public.fn_admin_conturi_alerte()
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Alertele de conturi sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT 'fara_angajat:' || p.id::text, 'fara_angajat'::text, p.id, COALESCE(u.email::text, p.email), p.tip_cont, p.is_owner,
         NULL::integer, NULL::text, NULL::boolean, NULL::date, u.banned_until, NULL::bigint, NULL::timestamptz,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'employee_name', c.employee_name,
                                                       'metoda', c.metoda, 'profil_legat', c.profil_legat)
                                    ORDER BY c.employee_id)
                     FROM public.fn_cont_candidati_angajat(u.email) c), '[]'::jsonb),
         NULLIF(jsonb_strip_nulls(jsonb_build_object(
           'email_diferit', CASE WHEN lower(btrim(COALESCE(p.email, ''))) <> lower(btrim(COALESCE(u.email::text, ''))) THEN true END,
           'email_profil', CASE WHEN lower(btrim(COALESCE(p.email, ''))) <> lower(btrim(COALESCE(u.email::text, ''))) THEN p.email END,
           'email_neconfirmat', CASE WHEN u.id IS NOT NULL AND u.email_confirmed_at IS NULL THEN true END)), '{}'::jsonb)
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.employee_id IS NULL AND COALESCE(p.tip_cont, 'angajat') = 'angajat'
   ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated;

CREATE OR REPLACE VIEW public.v_admin_conturi_alerte WITH (security_invoker = on) AS
  SELECT * FROM public.fn_admin_conturi_alerte();
REVOKE ALL ON public.v_admin_conturi_alerte FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_admin_conturi_alerte TO authenticated;
COMMENT ON VIEW public.v_admin_conturi_alerte IS
  'Alerte de administrare „Conturi platformă” (doar owner; poarta e în fn_admin_conturi_alerte). Numai citire.';

-- ── Postcondiții (adăugate 01.10.2026 pentru runner) — orice abatere anulează tot ──────────
DO $post_livrare$
DECLARE v_n integer; v_lipsa text[];
BEGIN
  -- funcțiile migrării există; cele SECURITY DEFINER au search_path fixat; niciuna executabilă de anon (excepții explicite)
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții lipsă după migrare: %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[]) AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: SECURITY DEFINER fără search_path: %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[])
     AND p.proname <> ALL(ARRAY[]::text[]) AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
  -- triggerele cerute există și sunt active
  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('profiles','trg_profiles_protectie_legatura'),('profiles','trg_profiles_campuri_owner_only')) AS t(r, n)
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || t.r) AND g.tgname = t.n AND g.tgenabled <> 'D');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: triggere lipsă/dezactivate: %', v_lipsa; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
                    AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
                    AND tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()')) THEN
    RAISE EXCEPTION 'Postcondiție: triggerul S-A nu mai e cel live (activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW)';
  END IF;
  v_n := 0;
END $post_livrare$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260929c_conturi_legare_automata:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260929c: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
