-- ============================================================================
-- R2 — contract de muncă încheiat → contul platformei se închide automat, cu jurnal de revenire
-- Specificație: docs/CONTURI_CICLU_VIATA.md, secțiunea B (+ 0.2: corecțiile din 30.09 după S-A live).
-- Depinde de 20260929c (fn_identitate_*, fn_cont_notifica_owneri). PRECONDIȚIE: S-A 20260929g live (neatins).
--   * conturi_inchideri_jurnal (append-only, RLS doar owner citire, scriere doar prin funcții)
--   * conturi_inchideri_coada  — ce nu se poate face pe loc: flagurile pe calea HR, reîncercări după eșec,
--                                închideri programate (dezactivat înainte de data încetării)
--   * fn_cont_flaguri()        — lista flagurilor de acces din profiles (internă)
--   * fn_cont_garda_persoana() — gardă ATOMICĂ „alt contract activ” (același CNP), cu lock pe persoană (internă)
--   * fn_cont_inchide(...)     — închiderea idempotentă + convergentă (internă); FĂRĂ golirea claims
--   * fn_cont_inchide_owner    — închidere manuală, poartă owner în cod
--   * trg_employees_zz_ciclu_cont — AFTER UPDATE pe employees când se schimbă active SAU termination_date
--       (prinde calea UI, calea toggleEmp și cron-ul hr_auto_deactivate_terminated, neschimbat)
--   * trg_employees_persoana_lock — același lock pe persoană la INSERT / schimbarea cnp/active/termination_date
--   * fn_conturi_inchideri_sweep — procesarea cozii, rulată de pg_cron ca postgres (identitate explicită db_login)
--   * fn_pgrst_pre_request     — hook PostgREST pentru revocarea EFECTIVĂ a JWT-urilor deja emise;
--                                CREAT, dar NEACTIVAT (activarea = ALTER ROLE authenticator, cu acordul lui Răzvan)
--   * fn_cont_restaureaza      — revenire din jurnal, EXCLUSIV owner, cu previzualizare (p_simulare)
--   * fn_cont_stare_angajati   — starea contului pe fișa HR (owner / HR / date personale)
--   * fn_admin_conturi_alerte  — extinsă (aceeași semnătură)
-- Ce NU atinge: role/department/is_owner/nume/email, employee_id, istoricul (pontaje, aprobări,
-- documente, notificări, chat), alocările de flux (doar alertă), jobul cron 13 și
-- fn_employees_termination_notify, triggerul S-A. Owner-ul nu se închide niciodată automat.
-- Idempotentă. Nu atinge datele existente (coada pornește goală; sweep-ul lucrează doar pe coadă).
-- ============================================================================

-- B.2 Jurnalul append-only -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conturi_inchideri_jurnal (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id      uuid NOT NULL,          -- fără FK: jurnalul supraviețuiește ștergerii contului
  email           text NOT NULL,
  employee_id     integer,                -- fără FK (append-only; un SET NULL ar fi blocat)
  motiv           text NOT NULL CHECK (length(btrim(motiv)) >= 5),
  sursa           text NOT NULL CHECK (sursa IN ('trigger_contract_incheiat','coada_contract_incheiat','manual_owner','import_manual')),
  snapshot        jsonb NOT NULL,         -- {versiune:1, flaguri, module, santiere, banned_until, profil, rezumat}
  facut_de        uuid,                   -- omul din platformă (JWT authenticated prin PostgREST); NULL = nu e un om
  facut_de_identitate text,               -- identitatea EXPLICITĂ a declanșatorului (fn_identitate_eticheta):
                                          -- db_login:postgres (cron/migrare) · service_role · owner:<uuid> · authenticated:<uuid> …
  facut_la        timestamptz NOT NULL DEFAULT now(),
  restaurat_de    uuid,
  restaurat_la    timestamptz,
  restaurare_nota text,
  CONSTRAINT conturi_inchideri_restaurare_chk CHECK ((restaurat_de IS NULL) = (restaurat_la IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conturi_inchidere_deschisa
  ON public.conturi_inchideri_jurnal(profile_id) WHERE restaurat_la IS NULL;
CREATE INDEX IF NOT EXISTS idx_conturi_inchideri_employee ON public.conturi_inchideri_jurnal(employee_id);
COMMENT ON TABLE public.conturi_inchideri_jurnal IS
  'Jurnal append-only al închiderilor de conturi (R2): ce avea contul înainte (snapshot), cine/când/de ce. Se scrie doar prin fn_cont_inchide / fn_cont_restaureaza.';

ALTER TABLE public.conturi_inchideri_jurnal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conturi_inchideri_jurnal_select_owner ON public.conturi_inchideri_jurnal;
CREATE POLICY conturi_inchideri_jurnal_select_owner ON public.conturi_inchideri_jurnal
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE));
-- P1 (audit C): service_role doar citește. Un INSERT cu snapshot fabricat ar deveni drepturi la „Restaurează”,
-- iar un UPDATE pe restaurat_* ar marca o închidere „restaurată” fără restaurare.
REVOKE ALL ON TABLE public.conturi_inchideri_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.conturi_inchideri_jurnal TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.conturi_inchideri_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- P2 (audit C): garda append-only rămâne SECURITY INVOKER intenționat — doar RAISE, nu citește/scrie date.
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_append_only()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Jurnalul închiderilor de conturi e append-only: % interzis', TG_OP USING ERRCODE = '42501';
  END IF;
  -- UPDATE: permis o singură dată, doar restaurat_de/la/nota din NULL în valori.
  IF OLD.restaurat_de IS NOT NULL OR OLD.restaurat_la IS NOT NULL OR OLD.restaurare_nota IS NOT NULL THEN
    RAISE EXCEPTION 'Închiderea #% a fost deja restaurată; jurnalul nu se mai modifică', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.restaurat_de IS NULL OR NEW.restaurat_la IS NULL
     OR (NEW.id, NEW.profile_id, NEW.email, NEW.employee_id, NEW.motiv, NEW.sursa, NEW.snapshot, NEW.facut_de,
         NEW.facut_de_identitate, NEW.facut_la)
        IS DISTINCT FROM
        (OLD.id, OLD.profile_id, OLD.email, OLD.employee_id, OLD.motiv, OLD.sursa, OLD.snapshot, OLD.facut_de,
         OLD.facut_de_identitate, OLD.facut_la) THEN
    RAISE EXCEPTION 'Jurnalul închiderilor e append-only: se completează doar restaurarea (o singură dată)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_append_only() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_conturi_inchideri_append_only ON public.conturi_inchideri_jurnal;
CREATE TRIGGER trg_conturi_inchideri_append_only BEFORE UPDATE OR DELETE ON public.conturi_inchideri_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_conturi_inchideri_append_only();
DROP TRIGGER IF EXISTS trg_conturi_inchideri_fara_truncate ON public.conturi_inchideri_jurnal;
CREATE TRIGGER trg_conturi_inchideri_fara_truncate BEFORE TRUNCATE ON public.conturi_inchideri_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_inchideri_append_only();

-- B.2b Coada închiderilor (corecția 30.09, audit A #2/#3) ---------------------------
-- Ce NU se face pe loc intră aici și e procesat de fn_conturi_inchideri_sweep (pg_cron, login postgres):
--   flaguri     — calea HR (identitate neprivilegiată): modulele, șantierele, banul, sesiunile și refresh
--                 tokenurile se revocă PE LOC; flagurile din profiles le pune pe false sweep-ul (≤ 5 min), fără
--                 falsificarea identității (varianta veche golea claims = impersonarea „lipsei identității”);
--   reincercare — închiderea automată a picat (eroare) → se reîncearcă, cu numărul de încercări și ultima eroare;
--   programata  — fișa dezactivată ÎNAINTE de data încetării → închiderea se face când data ajunge.
-- Sweep-ul lucrează DOAR pe coadă → aplicarea migrării nu închide nimic din datele existente.
CREATE TABLE IF NOT EXISTS public.conturi_inchideri_coada (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id          uuid NOT NULL,
  employee_id         integer,
  tip                 text NOT NULL CHECK (tip IN ('flaguri','reincercare','programata')),
  motiv               text NOT NULL,
  scadent_la          date NOT NULL DEFAULT CURRENT_DATE,
  incercari           integer NOT NULL DEFAULT 0,
  ultima_eroare       text,
  creat_la            timestamptz NOT NULL DEFAULT now(),
  creat_de_identitate text,
  rezolvat_la         timestamptz,
  rezultat            text,
  CONSTRAINT conturi_inchideri_coada_rezolvare_chk CHECK ((rezolvat_la IS NULL) = (rezultat IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conturi_inchideri_coada_deschisa
  ON public.conturi_inchideri_coada(profile_id, tip) WHERE rezolvat_la IS NULL;
COMMENT ON TABLE public.conturi_inchideri_coada IS
  'Coada R2: flaguri de resetat (calea HR), reîncercări după eșec, închideri programate. Scrisă doar de funcțiile R2, procesată de fn_conturi_inchideri_sweep (pg_cron).';
ALTER TABLE public.conturi_inchideri_coada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conturi_inchideri_coada_select_owner ON public.conturi_inchideri_coada;
CREATE POLICY conturi_inchideri_coada_select_owner ON public.conturi_inchideri_coada
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE));
REVOKE ALL ON TABLE public.conturi_inchideri_coada FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.conturi_inchideri_coada TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.conturi_inchideri_coada_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Pune (sau actualizează scadența) unei intrări deschise. Internă.
CREATE OR REPLACE FUNCTION public.fn_cont_coada_pune(p_profile_id uuid, p_employee_id integer, p_tip text, p_motiv text,
                                                     p_scadent date DEFAULT CURRENT_DATE, p_eroare text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la, ultima_eroare, creat_de_identitate)
  VALUES (p_profile_id, p_employee_id, p_tip, p_motiv, COALESCE(p_scadent, CURRENT_DATE), p_eroare, public.fn_identitate_eticheta())
  ON CONFLICT (profile_id, tip) WHERE rezolvat_la IS NULL
  DO UPDATE SET scadent_la = EXCLUDED.scadent_la, employee_id = EXCLUDED.employee_id, motiv = EXCLUDED.motiv,
                ultima_eroare = COALESCE(EXCLUDED.ultima_eroare, public.conturi_inchideri_coada.ultima_eroare);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_coada_pune(uuid, integer, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;

-- B.1 Lista flagurilor de acces (calculată la rulare; testul R2-00 o fixează) ----
CREATE OR REPLACE FUNCTION public.fn_cont_flaguri()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(a.attname::text ORDER BY a.attname), '{}'::text[])
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid = 'boolean'::regtype
     AND a.attname ~ '^(can_|receive_|email_notifications_)|^whatsapp_enabled$'
     AND a.attname <> 'is_owner';
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_flaguri() FROM PUBLIC, anon, authenticated, service_role;

-- B.3a Garda „alt contract activ” (condiția Copilot, audit B #4) --------------------
-- Nu există tabel de contracte: contractul = rândul din employees; aceeași persoană = același CNP (normalizat:
-- doar litere și cifre, majuscule — acoperă și un număr de pașaport). Întoarce NULL = se poate închide,
-- 'cnp_lipsa' = situație incompletă (NU se închide automat, doar alertă), 'alt_contract_activ:<id>'.
-- ATOMICĂ: pg_advisory_xact_lock pe persoană (ținut până la finalul tranzacției), luat și de
-- trg_employees_persoana_lock la INSERT / schimbarea cnp / active / termination_date → o fișă nouă activă a
-- aceleiași persoane nu se poate strecura între verificare și închidere. Verificarea citește DUPĂ lock
-- (funcție VOLATILE → instantaneu nou în READ COMMITTED).
CREATE OR REPLACE FUNCTION public.fn_cont_cnp_normalizat(p_cnp text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_cnp, ''), '[^0-9A-Za-z]', '', 'g')), '');
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_cnp_normalizat(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cont_lock_persoana(p_cnp_normalizat text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT pg_advisory_xact_lock(hashtextextended('gazpet.persoana:' || p_cnp_normalizat, 0))
   WHERE p_cnp_normalizat IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_lock_persoana(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cont_garda_persoana(p_employee_id integer)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cnp text;
  v_alt integer;
BEGIN
  SELECT public.fn_cont_cnp_normalizat(e.cnp) INTO v_cnp FROM public.employees e WHERE e.id = p_employee_id;
  IF v_cnp IS NULL THEN
    RETURN 'cnp_lipsa';
  END IF;
  PERFORM public.fn_cont_lock_persoana(v_cnp);
  SELECT e.id INTO v_alt
    FROM public.employees e
   WHERE e.id <> p_employee_id
     AND public.fn_cont_cnp_normalizat(e.cnp) = v_cnp
     AND e.active IS TRUE
     AND (e.termination_date IS NULL OR e.termination_date > CURRENT_DATE)
   ORDER BY e.id LIMIT 1;
  IF v_alt IS NOT NULL THEN
    RETURN 'alt_contract_activ:' || v_alt;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_garda_persoana(integer) FROM PUBLIC, anon, authenticated, service_role;

-- Același lock pe persoană la orice schimbare care poate crea / încheia un contract (ordonat, fără deadlock).
CREATE OR REPLACE FUNCTION public.fn_employees_persoana_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nou   text := public.fn_cont_cnp_normalizat(NEW.cnp);
  v_vechi text := CASE WHEN TG_OP = 'UPDATE' THEN public.fn_cont_cnp_normalizat(OLD.cnp) END;
BEGIN
  IF v_vechi IS NOT NULL AND v_vechi IS DISTINCT FROM v_nou THEN
    PERFORM public.fn_cont_lock_persoana(least(v_vechi, v_nou));
    PERFORM public.fn_cont_lock_persoana(greatest(v_vechi, v_nou));
  ELSE
    PERFORM public.fn_cont_lock_persoana(v_nou);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_persoana_lock ON public.employees;
CREATE TRIGGER trg_employees_persoana_lock BEFORE INSERT OR UPDATE OF cnp, active, termination_date ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.fn_employees_persoana_lock();

-- B.3 Închiderea (internă). Întoarce 'inchis' | 'deja_inchis' | 'sarit_owner' | 'inexistent'.
-- CORECȚIA 30.09 (audit A #2, M2): NU se mai golesc claims (era impersonarea „lipsei identității”; cu S-A extins
-- 20260930a închiderea din UI s-ar fi anulat toată). Decizia pe identitatea EXPLICITĂ a declanșatorului:
--   * owner / service_role / db_login (pg_cron, migrare): UPDATE-ul de flaguri se face pe loc — S-A (și S-A
--     extins), trg_profiles_protectie_legatura și cele 3 triggere owner-only vechi îl acceptă;
--   * altfel (HR prin UI, orice altă identitate): tot restul se revocă pe loc, flagurile intră în coadă (tip
--     'flaguri') și le pune pe false fn_conturi_inchideri_sweep (pg_cron, ≤ 5 min).
-- Revocarea accesului: banned_until, refresh tokens ȘTERȘI, sesiuni ȘTERSE (JWT-urile deja emise rămân valabile
-- până la expirare — vezi fn_pgrst_pre_request, B.5c).
CREATE OR REPLACE FUNCTION public.fn_cont_inchide(p_profile_id uuid, p_motiv text, p_sursa text, p_employee_id integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ident    text := public.fn_identitate_privilegiata();
  v_actor    uuid := public.fn_identitate_om();
  v_eticheta text := public.fn_identitate_eticheta();
  v_p        public.profiles%ROWTYPE;
  v_flaguri  text[] := public.fn_cont_flaguri();
  v_jurnal   bigint;
  v_rez      text;
  v_snap     jsonb;
  v_set      text;
  v_amanat   boolean := false;
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;   -- serializează pe profil
  IF NOT FOUND THEN RETURN 'inexistent'; END IF;

  IF v_p.is_owner IS TRUE THEN                        -- SIGURANȚĂ: owner-ul nu se închide niciodată automat
    BEGIN                                             -- notificarea e best-effort (nu blochează nimic)
      PERFORM public.fn_cont_notifica_owneri('cont_owner_neinchis', '⚠️ Contract încheiat pentru un OWNER',
        format('Contul OWNER %s (fișa #%s) NU a fost închis automat. Decide manual. Motiv: %s',
               v_p.email, COALESCE(p_employee_id::text, v_p.employee_id::text, '—'), p_motiv),
        '/admin?tab=managers&cont=' || p_profile_id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_cont_inchide notificare owner (%): % [%]', p_profile_id, SQLERRM, SQLSTATE;
    END;
    RETURN 'sarit_owner';
  END IF;

  SELECT j.id INTO v_jurnal FROM public.conturi_inchideri_jurnal j
   WHERE j.profile_id = p_profile_id AND j.restaurat_la IS NULL;
  IF v_jurnal IS NULL THEN
    v_snap := jsonb_build_object(
      'versiune', 1,
      'flaguri', COALESCE((SELECT jsonb_object_agg(f.key, f.value ORDER BY f.key)
                             FROM jsonb_each(to_jsonb(v_p)) f WHERE f.key = ANY (v_flaguri)), '{}'::jsonb),
      'module', COALESCE((SELECT jsonb_agg(jsonb_build_object('module', m.module, 'access_level', m.access_level,
                                                             'granted_at', m.granted_at, 'granted_by', m.granted_by)
                                           ORDER BY m.module)
                            FROM public.user_module_access m WHERE m.profile_id = p_profile_id), '[]'::jsonb),
      'santiere', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'id' - 'profile_id' ORDER BY s.site_id)
                              FROM public.profile_sites s WHERE s.profile_id = p_profile_id), '[]'::jsonb),
      'banned_until', (SELECT to_jsonb(u.banned_until) FROM auth.users u WHERE u.id = p_profile_id),
      'profil', jsonb_build_object('role', v_p.role, 'department', v_p.department, 'name', v_p.name, 'email', v_p.email),
      'rezumat', jsonb_build_object(
        'module', (SELECT count(*) FROM public.user_module_access m WHERE m.profile_id = p_profile_id),
        'santiere', (SELECT count(*) FROM public.profile_sites s WHERE s.profile_id = p_profile_id),
        'flaguri_true', (SELECT count(*) FROM jsonb_each(to_jsonb(v_p)) f WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb),
        'sesiuni', (SELECT count(*) FROM auth.sessions se WHERE se.user_id = p_profile_id),
        'refresh_tokens_active', (SELECT count(*) FROM auth.refresh_tokens rt
                                   WHERE rt.user_id = p_profile_id::text AND rt.revoked IS NOT TRUE)));
    INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, employee_id, motiv, sursa, snapshot, facut_de, facut_de_identitate)
    VALUES (p_profile_id, COALESCE(v_p.email, p_profile_id::text), COALESCE(p_employee_id, v_p.employee_id::integer),
            p_motiv, p_sursa, v_snap, v_actor, v_eticheta)
    RETURNING id INTO v_jurnal;
    v_rez := 'inchis';
  ELSE
    v_rez := 'deja_inchis';                           -- NU suprascrie primul snapshot
  END IF;

  -- Aplicarea e convergentă: rulează și pe 'deja_inchis' (scoate un acces redat manual între timp).
  DELETE FROM public.user_module_access WHERE profile_id = p_profile_id;
  DELETE FROM public.profile_sites      WHERE profile_id = p_profile_id;

  -- Flagurile: doar cu identitate privilegiată explicită; altfel coada (fără falsificarea identității).
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(v_flaguri) f;
  IF v_ident IS NOT NULL THEN
    IF v_set IS NOT NULL THEN
      EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING p_profile_id;
    END IF;
    UPDATE public.conturi_inchideri_coada SET rezolvat_la = now(), rezultat = 'flaguri_resetate'
     WHERE profile_id = p_profile_id AND tip = 'flaguri' AND rezolvat_la IS NULL;
  ELSE
    v_amanat := true;
    PERFORM public.fn_cont_coada_pune(p_profile_id, COALESCE(p_employee_id, v_p.employee_id::integer), 'flaguri',
      format('Flagurile contului închis (jurnal #%s) — declanșat de %s', v_jurnal, v_eticheta));
  END IF;

  -- Logare blocată + sesiuni și refresh tokens ȘTERSE (aceeași valoare ca la închiderea manuală, nu 'infinity').
  UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00'
   WHERE id = p_profile_id AND (banned_until IS NULL OR banned_until < '2999-12-31 00:00:00+00');
  DELETE FROM auth.refresh_tokens WHERE user_id = p_profile_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_profile_id;

  -- Intrările deschise de reîncercare / programare pentru acest cont sunt rezolvate de închiderea de acum.
  UPDATE public.conturi_inchideri_coada SET rezolvat_la = now(), rezultat = v_rez
   WHERE profile_id = p_profile_id AND tip IN ('reincercare', 'programata') AND rezolvat_la IS NULL;

  IF v_rez = 'inchis' THEN
    BEGIN                                             -- best-effort: închiderea rămâne făcută și dacă notificarea pică
      PERFORM public.fn_cont_notifica_owneri('cont_inchis_automat', '🔒 Cont închis: ' || COALESCE(v_p.email, p_profile_id::text),
        format('%s · jurnal #%s%s', p_motiv, v_jurnal,
               CASE WHEN v_amanat THEN ' · flagurile de acces se resetează la următoarea rulare a cozii (≤ 5 min)' ELSE '' END),
        '/admin?tab=managers&cont=' || p_profile_id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_cont_inchide notificare (%): % [%]', p_profile_id, SQLERRM, SQLSTATE;
    END;
  END IF;
  RETURN v_rez;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_inchide(uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- B.4 Închiderea manuală de către owner (poartă în cod) --------------------------
CREATE OR REPLACE FUNCTION public.fn_cont_inchide_owner(p_profile_id uuid, p_motiv text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_emp integer;
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate închide manual un cont' USING ERRCODE = '42501';
  END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'Motivul închiderii e obligatoriu (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT employee_id::integer INTO v_emp FROM public.profiles WHERE id = p_profile_id;
  RETURN public.fn_cont_inchide(p_profile_id, btrim(p_motiv), 'manual_owner', v_emp);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_inchide_owner(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_inchide_owner(uuid, text) TO authenticated;

-- B.5 Triggerul pe employees ------------------------------------------------------
-- AFTER UPDATE + WHEN pe active SAU termination_date (nu UPDATE OF): vede și active=false pus de
-- fn_employees_termination_notify (BEFORE) pe calea UI, UPDATE-ul cron-ului (fără JWT) și data pusă
-- ULTERIOR pe o fișă deja inactivă (audit B #5-ii).
-- Pentru fiecare cont legat de fișă (și de celelalte fișe încheiate ale ACELEIAȘI persoane, după CNP):
--   * owner → niciodată închis (notificare);
--   * tip_cont extern/test/sistem → nu se închide automat (doar alertă) (audit B #5-iv);
--   * garda „alt contract activ” (ATOMICĂ, lock pe persoană) sau CNP lipsă → nu se închide (doar alertă);
--   * altfel fn_cont_inchide; o eroare → notificare + coadă 'reincercare' (nu blochează NICIODATĂ UPDATE-ul).
-- Dezactivare cu dată în VIITOR → coadă 'programata' (închiderea se face când data ajunge).
CREATE OR REPLACE FUNCTION public.fn_employees_ciclu_cont()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r        record;
  v_rez    text;
  v_err    text;
  v_cnp    text := public.fn_cont_cnp_normalizat(NEW.cnp);
  v_garda  text;
  v_motiv  text;
  v_inchide boolean := NEW.active IS FALSE AND NEW.termination_date IS NOT NULL AND NEW.termination_date <= CURRENT_DATE
                       AND (OLD.active IS TRUE OR OLD.termination_date IS DISTINCT FROM NEW.termination_date);
BEGIN
  IF v_inchide THEN
    -- Garda o singură dată, ÎNAINTEA subtranzacțiilor de închidere: lock-ul pe persoană rămâne până la COMMIT
    -- (blocul reușit face RELEASE, nu abort). O eroare în gardă = situație incompletă → nu se închide.
    BEGIN
      v_garda := public.fn_cont_garda_persoana(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      v_garda := 'eroare_garda: ' || SQLERRM;
    END;
    FOR r IN SELECT p.id, p.email, p.is_owner, p.tip_cont, p.employee_id::integer AS emp
               FROM public.profiles p
              WHERE p.employee_id = NEW.id
                 OR (v_cnp IS NOT NULL AND p.employee_id IN (
                      SELECT e.id FROM public.employees e
                       WHERE e.id <> NEW.id AND public.fn_cont_cnp_normalizat(e.cnp) = v_cnp
                         AND e.active IS NOT TRUE AND e.termination_date IS NOT NULL AND e.termination_date <= CURRENT_DATE))
              ORDER BY p.id LOOP
      v_motiv := CASE
        WHEN r.is_owner IS TRUE THEN NULL             -- fn_cont_inchide întoarce sarit_owner și anunță
        WHEN EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j
                      WHERE j.profile_id = r.id AND j.restaurat_la IS NULL) THEN NULL   -- deja închis: reaplicare convergentă
        WHEN COALESCE(r.tip_cont, 'angajat') <> 'angajat' THEN format('contul e marcat „%s”, nu se închide automat', r.tip_cont)
        WHEN v_garda = 'cnp_lipsa' THEN 'CNP lipsă pe fișă: nu pot verifica dacă omul are alt contract activ'
        WHEN v_garda LIKE 'alt_contract_activ:%' THEN format('are alt contract ACTIV (fișa #%s), același CNP', split_part(v_garda, ':', 2))
        WHEN v_garda IS NOT NULL THEN v_garda
      END;
      IF v_motiv IS NOT NULL THEN
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
            format('%s (fișa #%s %s): %s. Contul rămâne deschis; închide-l manual din Admin → Manageri sau corectează fișa.',
                   r.email, NEW.id, NEW.name, v_motiv),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
        CONTINUE;
      END IF;
      BEGIN
        v_rez := public.fn_cont_inchide(r.id,
                   format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
                   'trigger_contract_incheiat', r.emp);
      EXCEPTION WHEN OTHERS THEN
        -- Nu blocăm NICIODATĂ UPDATE-ul din HR sau lotul cron-ului; închiderea se reîncearcă din coadă.
        v_err := SQLERRM;
        BEGIN
          PERFORM public.fn_cont_coada_pune(r.id, r.emp, 'reincercare',
            format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
            CURRENT_DATE, v_err);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont coadă (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
            format('%s (fișa #%s %s): %s · se reîncearcă automat din coadă', r.email, NEW.id, NEW.name, v_err),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont (%): închiderea a eșuat (%) și notificarea la fel: % [%]', r.email, v_err, SQLERRM, SQLSTATE;
        END;
      END;
    END LOOP;
    -- Alt cont, NELEGAT, al aceleiași persoane (emailul de logare = emailul de pe fișă): doar alertă (audit B #5-iii).
    IF NULLIF(btrim(COALESCE(NEW.email, '')), '') IS NOT NULL THEN
      FOR r IN SELECT p.id, u.email::text AS email
                 FROM public.profiles p JOIN auth.users u ON u.id = p.id
                WHERE p.employee_id IS NULL AND lower(btrim(u.email)) = lower(btrim(NEW.email)) LOOP
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_posibil_aceeasi_persoana', '⚠️ Cont nelegat al unui fost angajat?',
            format('Contractul fișei #%s %s s-a încheiat, iar contul NELEGAT %s are emailul de pe fișă. NU s-a închis automat — verifică și închide-l manual dacă e al lui.',
                   NEW.id, NEW.name, r.email),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
      END LOOP;
    END IF;
  ELSIF NEW.active IS FALSE AND (OLD.active IS TRUE OR OLD.termination_date IS DISTINCT FROM NEW.termination_date) THEN
    FOR r IN SELECT p.id, p.email, p.is_owner, p.employee_id::integer AS emp
               FROM public.profiles p WHERE p.employee_id = NEW.id ORDER BY p.id LOOP
      IF NEW.termination_date IS NOT NULL AND NEW.termination_date > CURRENT_DATE AND r.is_owner IS NOT TRUE THEN
        BEGIN                                         -- dezactivat înainte de dată: închiderea se programează
          PERFORM public.fn_cont_coada_pune(r.id, r.emp, 'programata',
            format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
            NEW.termination_date);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont coadă (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
      END IF;
      IF OLD.active IS TRUE THEN
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_angajat_inactiv_fara_incetare', '⚠️ Angajat dezactivat fără contract încheiat',
            format('%s (fișa #%s %s) a fost dezactivat%s. Contul NU s-a închis automat%s — verifică fișa sau închide contul manual.',
                   r.email, NEW.id, NEW.name,
                   CASE WHEN NEW.termination_date IS NULL THEN ' fără dată de încetare'
                        ELSE ' înainte de data încetării (' || to_char(NEW.termination_date, 'DD.MM.YYYY') || ')' END,
                   CASE WHEN NEW.termination_date IS NOT NULL AND r.is_owner IS NOT TRUE
                        THEN ' (închiderea e programată pentru data încetării)' ELSE '' END),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
      END IF;
    END LOOP;
  ELSIF OLD.active IS NOT TRUE AND NEW.active IS TRUE THEN
    -- Reactivarea NU redă nimic automat; doar anunță owner-ul. Programările / reîncercările se anulează.
    BEGIN
      UPDATE public.conturi_inchideri_coada c SET rezolvat_la = now(), rezultat = 'anulat_reactivat'
       WHERE c.rezolvat_la IS NULL AND c.tip IN ('reincercare', 'programata') AND c.employee_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_employees_ciclu_cont coadă (fișa #%): % [%]', NEW.id, SQLERRM, SQLSTATE;
    END;
    FOR r IN SELECT p.id, p.email, j.id AS jid
               FROM public.profiles p
               JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
              WHERE p.employee_id = NEW.id ORDER BY p.id LOOP
      BEGIN
        PERFORM public.fn_cont_notifica_owneri('cont_angajat_reactivat', '↩ Angajat reactivat — contul rămâne închis',
          format('%s (fișa #%s %s) a fost reactivat. Accesul NU a fost redat automat; restaurarea din jurnalul #%s o face doar owner-ul.',
                 r.email, NEW.id, NEW.name, r.jid),
          '/admin?tab=managers&cont=' || r.id::text);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
      END;
    END LOOP;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_ciclu_cont() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_zz_ciclu_cont ON public.employees;
CREATE TRIGGER trg_employees_zz_ciclu_cont AFTER UPDATE ON public.employees
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.termination_date IS DISTINCT FROM NEW.termination_date)
  EXECUTE FUNCTION public.fn_employees_ciclu_cont();

-- B.5b Procesarea cozii (pg_cron, login postgres fără claims = identitate explicită db_login) ----------
-- Gardă în cod: doar o identitate privilegiată explicită (fn_identitate_privilegiata); EXECUTE revocat de la
-- toate rolurile API. Nu citește conținut extern; doar ia drepturi (flaguri → false, închideri), nu dă niciodată.
-- Un cont restaurat de owner NU se re-închide: restaurarea anulează intrările din coadă și sweep-ul verifică
-- din nou toate condițiile (fișă încă inactivă, dată ajunsă, legătura neschimbată, gardă, tip cont, owner).
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  q        record;
  e        record;
  v_rez    text;
  v_garda  text;
  v_set    text;
  v_n      jsonb := '{}'::jsonb;
  v_rezult text;
BEGIN
  IF public.fn_identitate_privilegiata() IS NULL THEN
    RAISE EXCEPTION 'Coada închiderilor o procesează doar pg_cron (login postgres) sau o identitate privilegiată explicită'
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(public.fn_cont_flaguri()) f;
  FOR q IN SELECT * FROM public.conturi_inchideri_coada
            WHERE rezolvat_la IS NULL AND scadent_la <= CURRENT_DATE
            ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    v_rezult := NULL;
    BEGIN
      IF q.tip = 'flaguri' THEN
        IF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = q.profile_id AND j.restaurat_la IS NULL)
           AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = q.profile_id AND p.is_owner IS NOT TRUE) THEN
          IF v_set IS NOT NULL THEN
            EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING q.profile_id;
          END IF;
          v_rezult := 'flaguri_resetate';
        ELSE
          v_rezult := 'anulat_restaurat';
        END IF;
      ELSE
        SELECT x.* INTO e FROM public.employees x WHERE x.id = q.employee_id;
        IF NOT FOUND
           OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = q.profile_id AND p.employee_id = q.employee_id)
           OR e.active IS TRUE OR e.termination_date IS NULL THEN
          v_rezult := 'anulat_conditii';
        ELSIF e.termination_date > CURRENT_DATE THEN
          UPDATE public.conturi_inchideri_coada SET scadent_la = e.termination_date WHERE id = q.id;   -- data s-a mutat
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = q.profile_id AND j.restaurat_la IS NULL) THEN
          v_rezult := 'deja_inchis';
        ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = q.profile_id
                        AND (p.is_owner IS TRUE OR COALESCE(p.tip_cont, 'angajat') <> 'angajat')) THEN
          v_rezult := 'suspendat_owner_sau_tip_cont';
        ELSE
          v_garda := public.fn_cont_garda_persoana(e.id);      -- lock pe persoană până la COMMIT
          IF v_garda IS NOT NULL THEN
            v_rezult := 'suspendat_' || split_part(v_garda, ':', 1);
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
              format('%s (fișa #%s %s): %s. Contul rămâne deschis; închide-l manual din Admin → Manageri sau corectează fișa.',
                     (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id), e.id, e.name,
                     CASE WHEN v_garda = 'cnp_lipsa' THEN 'CNP lipsă pe fișă: nu pot verifica dacă omul are alt contract activ'
                          ELSE format('are alt contract ACTIV (fișa #%s), același CNP', split_part(v_garda, ':', 2)) END),
              '/admin?tab=managers&cont=' || q.profile_id::text);
          ELSE
            v_rez := public.fn_cont_inchide(q.profile_id,
                       format('Contract încheiat la %s (fișa #%s %s) · %s', to_char(e.termination_date, 'DD.MM.YYYY'), e.id, e.name,
                              CASE q.tip WHEN 'programata' THEN 'închidere programată' ELSE 'reîncercare după eșec' END),
                       'coada_contract_incheiat', e.id);
            v_rezult := v_rez;                                -- fn_cont_inchide a rezolvat deja intrarea
          END IF;
        END IF;
      END IF;
      IF v_rezult IS NOT NULL THEN
        UPDATE public.conturi_inchideri_coada
           SET rezolvat_la = COALESCE(rezolvat_la, now()), rezultat = COALESCE(rezultat, v_rezult), incercari = incercari + 1
         WHERE id = q.id;
        v_n := jsonb_set(v_n, ARRAY[v_rezult], to_jsonb(COALESCE((v_n ->> v_rezult)::int, 0) + 1));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.conturi_inchideri_coada SET incercari = incercari + 1, ultima_eroare = SQLERRM WHERE id = q.id;
      v_n := jsonb_set(v_n, ARRAY['eroare'], to_jsonb(COALESCE((v_n ->> 'eroare')::int, 0) + 1));
      PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
        format('%s (coada #%s, %s): %s · se reîncearcă la următoarea rulare',
               (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id), q.id, q.tip, SQLERRM),
        '/admin?tab=managers&cont=' || q.profile_id::text);
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_sweep() FROM PUBLIC, anon, authenticated, service_role;

-- Programarea (pg_cron, la 5 minute, ca postgres). Nume fix → cron.schedule e idempotent (actualizează jobul).
-- Local (harness PG16 fără pg_cron) se sare; testele cheamă funcția direct, ca login postgres.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('conturi_inchideri_coada', '*/5 * * * *', 'SELECT public.fn_conturi_inchideri_sweep()');
  END IF;
END $cron$;

-- B.5c Revocarea EFECTIVĂ a JWT-urilor deja emise (audit A #5 / B #6) ----------------
-- PostgREST verifică doar semnătura și expirarea (jwt_exp = 3600 s în producție): după închidere, tokenul de acces
-- rămâne valabil până la o oră, iar politicile `auth.uid() IS NOT NULL` / `USING (true)` (ex. employees: CNP,
-- IBAN) răspund în continuare. Hook-ul pre-request refuză (42501) o cerere authenticated dacă: contul are o
-- închidere nerestaurată, e banat, sau sesiunea din token (session_id) nu mai există în auth.sessions.
-- ⚠ Funcția e CREATĂ, dar NU e activată. Activarea e schimbare de configurație globală (cere acordul lui Răzvan):
--     ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.fn_pgrst_pre_request';
--     NOTIFY pgrst, 'reload config';
--   Storage și Realtime NU trec prin hook → de scurtat și JWT expiry (Dashboard → Auth), ex. 900 s.
CREATE OR REPLACE FUNCTION public.fn_pgrst_pre_request()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  c      record;
  v_uid  uuid;
  v_sess text;
BEGIN
  SELECT * INTO c FROM public.fn_identitate_claims();
  IF c.rol IS DISTINCT FROM 'authenticated' THEN
    RETURN;                                           -- anon / service_role: neatinse
  END IF;
  v_uid := public.fn_identitate_uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = v_uid AND j.restaurat_la IS NULL)
     OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND u.banned_until > now()) THEN
    RAISE EXCEPTION 'Contul a fost închis: accesul e revocat' USING ERRCODE = '42501';
  END IF;
  v_sess := coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                     nullif(current_setting('request.jwt.claim', true), ''))::jsonb ->> 'session_id';
  IF v_sess ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = v_sess::uuid) THEN
    RAISE EXCEPTION 'Sesiunea a fost revocată' USING ERRCODE = '42501';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_pgrst_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pgrst_pre_request() TO anon, authenticated, service_role;

-- B.6 Restaurarea din jurnal — EXCLUSIV owner, cu previzualizare -----------------
-- Nimic nu se redă automat (reactivarea doar anunță). Ordinea lock-urilor = cea din fn_cont_inchide
-- (profil, apoi jurnal), ca o închidere concurentă să nu lase jurnalul „restaurat” pe un cont banat (audit B #7b).
-- p_simulare = true: întoarce ce s-ar reface (module, șantiere, flaguri, ban), fără nicio scriere.
DROP FUNCTION IF EXISTS public.fn_cont_restaureaza(bigint, text);
CREATE OR REPLACE FUNCTION public.fn_cont_restaureaza(p_jurnal_id bigint, p_nota text, p_simulare boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid;
  v_pid     uuid;
  v_j       public.conturi_inchideri_jurnal%ROWTYPE;
  v_el      jsonb;
  v_refacut text[] := '{}';
  v_sarit   text[] := '{}';
  v_s_ok    integer[] := '{}';
  v_s_sarit integer[] := '{}';
  v_fl      jsonb;
  v_set     text;
  v_sim     boolean := COALESCE(p_simulare, false);
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate restaura un cont închis' USING ERRCODE = '42501';
  END IF;
  v_uid := public.fn_identitate_uid();
  IF NOT v_sim AND (p_nota IS NULL OR length(btrim(p_nota)) < 5) THEN
    RAISE EXCEPTION 'Nota restaurării e obligatorie (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT j.profile_id INTO v_pid FROM public.conturi_inchideri_jurnal j WHERE j.id = p_jurnal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Închiderea #% nu există în jurnal', p_jurnal_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_pid FOR UPDATE;                  -- 1) profilul
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profilul % nu mai există; nu am ce restaura', v_pid USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_j FROM public.conturi_inchideri_jurnal WHERE id = p_jurnal_id FOR UPDATE;   -- 2) jurnalul
  IF v_j.restaurat_la IS NOT NULL THEN
    RAISE EXCEPTION 'Închiderea #% a fost deja restaurată la %', p_jurnal_id, v_j.restaurat_la USING ERRCODE = '22023';
  END IF;
  -- Forma snapshot-ului (B.2): altfel o restaurare „reușită” ar pierde flagurile/șantierele și ar marca
  -- definitiv jurnalul ca restaurat (ex. un import manual cu forma {profile:{…}, module:[…]}).
  IF (v_j.snapshot ->> 'versiune') IS DISTINCT FROM '1'
     OR jsonb_typeof(v_j.snapshot -> 'flaguri') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_j.snapshot -> 'module') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_j.snapshot -> 'santiere') IS DISTINCT FROM 'array'
     OR NOT (v_j.snapshot ? 'banned_until') THEN
    RAISE EXCEPTION 'Snapshot-ul închiderii #% nu are forma așteptată (versiune 1: flaguri{}, module[], santiere[], banned_until); nu restaurez', p_jurnal_id
      USING ERRCODE = '22023', HINT = 'Corectează importul (G.7) — jurnalul NU a fost marcat restaurat.';
  END IF;

  -- Module (doar cele care mai există în app_modules)
  FOR v_el IN SELECT e FROM jsonb_array_elements(COALESCE(v_j.snapshot -> 'module', '[]'::jsonb)) e LOOP
    IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = v_el ->> 'module') THEN
      IF NOT v_sim THEN
        INSERT INTO public.user_module_access (profile_id, module, access_level, granted_at, granted_by)
        VALUES (v_j.profile_id, v_el ->> 'module', v_el ->> 'access_level', now(), v_uid)
        ON CONFLICT (profile_id, module) DO NOTHING;
      END IF;
      v_refacut := v_refacut || (v_el ->> 'module');
    ELSE
      v_sarit := v_sarit || (v_el ->> 'module');
    END IF;
  END LOOP;

  -- Șantiere (doar cele care mai există)
  FOR v_el IN SELECT e FROM jsonb_array_elements(COALESCE(v_j.snapshot -> 'santiere', '[]'::jsonb)) e LOOP
    IF EXISTS (SELECT 1 FROM public.sites WHERE id = (v_el ->> 'site_id')::integer) THEN
      IF NOT v_sim THEN
        INSERT INTO public.profile_sites (profile_id, site_id, valid_until, granted_by, note)
        VALUES (v_j.profile_id, (v_el ->> 'site_id')::integer, (v_el ->> 'valid_until')::date, v_uid, v_el ->> 'note')
        ON CONFLICT (profile_id, site_id) DO NOTHING;
      END IF;
      v_s_ok := v_s_ok || (v_el ->> 'site_id')::integer;
    ELSE
      v_s_sarit := v_s_sarit || (v_el ->> 'site_id')::integer;
    END IF;
  END LOOP;

  -- Flaguri: doar cheile care sunt și azi în fn_cont_flaguri(). Apelantul e owner (identitate explicită) →
  -- S-A, protecția și triggerele owner-only permit.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_fl
    FROM jsonb_each(COALESCE(v_j.snapshot -> 'flaguri', '{}'::jsonb)) f
   WHERE f.key = ANY (public.fn_cont_flaguri());

  IF v_sim THEN
    RETURN jsonb_build_object('simulare', true, 'jurnal_id', p_jurnal_id, 'profile_id', v_j.profile_id,
      'module_refacute', to_jsonb(v_refacut), 'module_sarite', to_jsonb(v_sarit),
      'santiere', to_jsonb(v_s_ok), 'santiere_sarite', to_jsonb(v_s_sarit), 'flaguri', v_fl,
      'banned_until', v_j.snapshot -> 'banned_until');
  END IF;

  SELECT string_agg(format('%I = ($1 ->> %L)::boolean', k, k), ', ') INTO v_set FROM jsonb_object_keys(v_fl) k;
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE public.profiles SET %s WHERE id = $2', v_set) USING v_fl, v_j.profile_id;
  END IF;

  -- Logarea: banned_until revine la valoarea din snapshot (de regulă NULL). Sesiunile nu se refac.
  UPDATE auth.users SET banned_until = (v_j.snapshot ->> 'banned_until')::timestamptz WHERE id = v_j.profile_id;

  UPDATE public.conturi_inchideri_jurnal
     SET restaurat_de = v_uid, restaurat_la = now(), restaurare_nota = btrim(p_nota)
   WHERE id = p_jurnal_id;
  -- Decizia owner-ului e respectată: nimic din coadă nu mai re-închide / re-resetează contul.
  UPDATE public.conturi_inchideri_coada SET rezolvat_la = now(), rezultat = 'anulat_restaurat'
   WHERE profile_id = v_j.profile_id AND rezolvat_la IS NULL;

  RETURN jsonb_build_object('simulare', false, 'jurnal_id', p_jurnal_id, 'profile_id', v_j.profile_id,
    'module_refacute', to_jsonb(v_refacut), 'module_sarite', to_jsonb(v_sarit),
    'santiere', to_jsonb(v_s_ok), 'santiere_sarite', to_jsonb(v_s_sarit), 'flaguri', v_fl);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_restaureaza(bigint, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_restaureaza(bigint, text, boolean) TO authenticated;

-- B.7 Starea contului pentru fișa HR (și coloana „Stare” din Admin → Manageri) ------
-- Owner / can_modify_employees / can_access_personal_data; ceilalți primesc 0 rânduri (fără eroare).
-- Owner-ul primește TOATE conturile (inclusiv nelegate), ca „blocat” (ban fără jurnal) să apară și în Manageri.
CREATE OR REPLACE FUNCTION public.fn_cont_stare_angajati()
RETURNS TABLE(employee_id integer, profile_id uuid, email text, stare text, inchis_la timestamptz, jurnal_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := public.fn_identitate_uid();
  v_owner boolean := public.fn_identitate_privilegiata() IS NOT DISTINCT FROM 'owner';
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.profiles pr WHERE pr.id = v_uid
          AND (pr.is_owner IS TRUE OR pr.can_modify_employees IS TRUE OR pr.can_access_personal_data IS TRUE)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.employee_id::integer, p.id, p.email,
         CASE WHEN j.id IS NOT NULL THEN 'inchis'
              WHEN u.banned_until IS NOT NULL AND u.banned_until > now() THEN 'blocat'
              ELSE 'activ' END,
         j.facut_la, j.id
    FROM public.profiles p
    LEFT JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.employee_id IS NOT NULL OR v_owner
   ORDER BY p.employee_id NULLS LAST, p.id;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_stare_angajati() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_stare_angajati() TO authenticated;

-- B.8 Alerta extinsă (aceeași semnătură, aceeași poartă owner) --------------------
-- cont_activ_fost_angajat primește în `alocari` motivul pentru care contul NU s-a închis automat:
-- {"motiv_neinchis": owner | tip_cont | fara_data | data_viitoare | cnp_lipsa | alt_contract_activ |
--   in_coada | esuat_sau_neprins, "alt_contract": <id>, "coada": {tip, incercari, ultima_eroare, scadent_la}}.
-- inchis_cu_acces_rest arată și dacă flagurile sunt încă în coadă (calea HR, ≤ 5 min).
CREATE OR REPLACE FUNCTION public.fn_admin_conturi_alerte()
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_flaguri text[] := public.fn_cont_flaguri();
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Alertele de conturi sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH pr AS (
    SELECT p.id AS pid, COALESCE(u.email::text, p.email) AS pemail, u.email::text AS uemail, p.tip_cont AS ptip, p.is_owner AS powner,
           p.employee_id::integer AS emp, e.id AS eid, e.name AS enume, e.active AS eactiv, e.termination_date AS etd,
           public.fn_cont_cnp_normalizat(e.cnp) AS ecnp,
           u.banned_until AS ban, j.id AS jid, j.facut_la AS jla, to_jsonb(p) AS pj
      FROM public.profiles p
      LEFT JOIN public.employees e ON e.id = p.employee_id
      LEFT JOIN auth.users u ON u.id = p.id
      LEFT JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
  ),
  aloc AS (
    SELECT pr.pid, jsonb_strip_nulls(jsonb_build_object(
      'comenzi_aprobatori',   NULLIF((SELECT count(*) FROM public.comenzi_aprobatori x WHERE x.profile_id = pr.pid AND x.activ), 0),
      'necesar_responsabili', NULLIF((SELECT count(*) FROM public.necesar_responsabili x WHERE x.profile_id = pr.pid AND x.activ), 0),
      'hr_aprobatori',        NULLIF((SELECT count(*) FROM public.hr_aprobatori x WHERE x.profile_id = pr.pid AND x.activ), 0),
      'marketing_aprobatori', NULLIF((SELECT count(*) FROM public.marketing_aprobatori x WHERE x.profile_id = pr.pid), 0),
      'hr_concediu_rute',     NULLIF((SELECT count(*) FROM public.hr_concediu_rute x WHERE x.aprobator_profile_id = pr.pid), 0),
      'tichete_default_responsabili', NULLIF((SELECT count(*) FROM public.tichete_default_responsabili x WHERE x.profile_id = pr.pid), 0),
      'hr_recrutare_pozitii', NULLIF((SELECT count(*) FROM public.hr_recrutare_pozitii x
                                       WHERE x.responsabil_id = pr.pid AND x.activ IS TRUE AND x.deleted_at IS NULL), 0)
    )) AS alocari
      FROM pr WHERE pr.jid IS NOT NULL
  ),
  toate AS (
    -- fara_angajat
    SELECT 'fara_angajat'::text AS cod, pr.pid, pr.pemail, pr.ptip, pr.powner, NULL::integer AS emp, NULL::text AS enume,
           NULL::boolean AS eactiv, NULL::date AS etd, pr.ban, NULL::bigint AS jid, NULL::timestamptz AS jla,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'employee_name', c.employee_name,
                                                         'metoda', c.metoda, 'profil_legat', c.profil_legat)
                                      ORDER BY c.employee_id)
                       FROM public.fn_cont_candidati_angajat(pr.uemail) c), '[]'::jsonb) AS candidati,
           NULL::jsonb AS alocari
      FROM pr WHERE pr.emp IS NULL AND COALESCE(pr.ptip, 'angajat') = 'angajat'
    UNION ALL
    -- cont_activ_fost_angajat: legat de o fișă inactivă, fără închidere, nebanat (+ motivul)
    SELECT 'cont_activ_fost_angajat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, NULL::bigint, NULL::timestamptz, NULL::jsonb,
           jsonb_strip_nulls(jsonb_build_object(
             'motiv_neinchis', CASE
                WHEN pr.powner THEN 'owner'
                WHEN COALESCE(pr.ptip, 'angajat') <> 'angajat' THEN 'tip_cont'
                WHEN pr.etd IS NULL THEN 'fara_data'
                WHEN pr.etd > CURRENT_DATE THEN 'data_viitoare'
                WHEN pr.ecnp IS NULL THEN 'cnp_lipsa'
                WHEN alt.id IS NOT NULL THEN 'alt_contract_activ'
                WHEN cq.id IS NOT NULL THEN 'in_coada'
                ELSE 'esuat_sau_neprins' END,
             'alt_contract', alt.id,
             'coada', CASE WHEN cq.id IS NOT NULL THEN jsonb_build_object('tip', cq.tip, 'incercari', cq.incercari,
                                                                          'ultima_eroare', cq.ultima_eroare, 'scadent_la', cq.scadent_la) END))
      FROM pr
      LEFT JOIN LATERAL (SELECT x.id FROM public.employees x
                          WHERE pr.ecnp IS NOT NULL AND x.id <> pr.eid AND public.fn_cont_cnp_normalizat(x.cnp) = pr.ecnp
                            AND x.active IS TRUE AND (x.termination_date IS NULL OR x.termination_date > CURRENT_DATE)
                          ORDER BY x.id LIMIT 1) alt ON true
      LEFT JOIN LATERAL (SELECT q.* FROM public.conturi_inchideri_coada q
                          WHERE q.profile_id = pr.pid AND q.rezolvat_la IS NULL AND q.tip IN ('reincercare', 'programata')
                          ORDER BY q.id LIMIT 1) cq ON true
     WHERE pr.eid IS NOT NULL AND pr.eactiv IS NOT TRUE AND pr.jid IS NULL
       AND (pr.ban IS NULL OR pr.ban < now())
    UNION ALL
    -- inchis_dar_deblocat
    SELECT 'inchis_dar_deblocat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb, NULL::jsonb
      FROM pr WHERE pr.jid IS NOT NULL AND (pr.ban IS NULL OR pr.ban < now())
    UNION ALL
    -- inchis_cu_acces_rest
    SELECT 'inchis_cu_acces_rest', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb,
           jsonb_build_object(
             'module', (SELECT count(*) FROM public.user_module_access m WHERE m.profile_id = pr.pid),
             'santiere', (SELECT count(*) FROM public.profile_sites s WHERE s.profile_id = pr.pid),
             'flaguri', (SELECT COALESCE(jsonb_agg(f.key ORDER BY f.key), '[]'::jsonb) FROM jsonb_each(pr.pj) f
                          WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb),
             'flaguri_in_coada', EXISTS (SELECT 1 FROM public.conturi_inchideri_coada q
                                          WHERE q.profile_id = pr.pid AND q.tip = 'flaguri' AND q.rezolvat_la IS NULL))
      FROM pr WHERE pr.jid IS NOT NULL
                AND (EXISTS (SELECT 1 FROM public.user_module_access m WHERE m.profile_id = pr.pid)
                  OR EXISTS (SELECT 1 FROM public.profile_sites s WHERE s.profile_id = pr.pid)
                  OR EXISTS (SELECT 1 FROM jsonb_each(pr.pj) f WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb))
    UNION ALL
    -- reactivat_acces_neredat
    SELECT 'reactivat_acces_neredat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb, NULL::jsonb
      FROM pr WHERE pr.jid IS NOT NULL AND pr.eactiv IS TRUE
    UNION ALL
    -- alocari_ramase (doar alertă — D3 varianta A)
    SELECT 'alocari_ramase', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb, a.alocari
      FROM pr JOIN aloc a ON a.pid = pr.pid WHERE a.alocari <> '{}'::jsonb
    UNION ALL
    -- inactiv_fara_data: fișe inactive fără dată de încetare (cu sau fără cont)
    SELECT 'inactiv_fara_data', p.id, COALESCE(u.email::text, p.email), p.tip_cont, p.is_owner, e.id, e.name, e.active, e.termination_date,
           u.banned_until, j.id, j.facut_la, NULL::jsonb, NULL::jsonb
      FROM public.employees e
      LEFT JOIN public.profiles p ON p.employee_id = e.id
      LEFT JOIN auth.users u ON u.id = p.id
      LEFT JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
     WHERE e.active IS FALSE AND e.termination_date IS NULL
  )
  SELECT t.cod || ':' || COALESCE(t.pid::text, 'e' || t.emp::text), t.cod, t.pid, t.pemail, t.ptip, t.powner,
         t.emp, t.enume, t.eactiv, t.etd, t.ban, t.jid, t.jla, t.candidati, t.alocari
    FROM toate t
   ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated;
