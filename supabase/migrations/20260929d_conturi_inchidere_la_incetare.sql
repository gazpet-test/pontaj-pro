-- ============================================================================
-- R2 — contract de muncă încheiat → contul platformei se închide automat, cu jurnal de revenire
-- Specificație: docs/CONTURI_CICLU_VIATA.md, secțiunea B. Depinde de 20260929c.
--   * conturi_inchideri_jurnal (append-only, RLS doar owner citire, scriere doar prin funcții)
--   * fn_cont_flaguri()      — lista flagurilor de acces din profiles (internă)
--   * fn_cont_inchide(...)   — închiderea idempotentă + convergentă (internă)
--   * fn_cont_inchide_owner  — închidere manuală, poartă owner în cod
--   * trg_employees_zz_ciclu_cont — AFTER UPDATE pe employees când se schimbă active
--       (prinde calea UI, calea toggleEmp și cron-ul hr_auto_deactivate_terminated, neschimbat)
--   * fn_cont_restaureaza    — revenire din jurnal, EXCLUSIV owner
--   * fn_cont_stare_angajati — starea contului pe fișa HR (owner / HR / date personale)
--   * fn_admin_conturi_alerte — extinsă (aceeași semnătură)
-- Ce NU atinge: role/department/is_owner/nume/email, employee_id, istoricul (pontaje, aprobări,
-- documente, notificări, chat), alocările de flux (doar alertă), jobul cron și
-- fn_employees_termination_notify. Owner-ul nu se închide niciodată automat.
-- Idempotentă. Nu atinge datele existente.
-- ============================================================================

-- B.2 Jurnalul append-only -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conturi_inchideri_jurnal (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id      uuid NOT NULL,          -- fără FK: jurnalul supraviețuiește ștergerii contului
  email           text NOT NULL,
  employee_id     integer,                -- fără FK (append-only; un SET NULL ar fi blocat)
  motiv           text NOT NULL CHECK (length(btrim(motiv)) >= 5),
  sursa           text NOT NULL CHECK (sursa IN ('trigger_contract_incheiat','manual_owner','import_manual')),
  snapshot        jsonb NOT NULL,         -- {versiune:1, flaguri, module, santiere, banned_until, profil, rezumat}
  facut_de        uuid,                   -- auth.uid() al declanșatorului; NULL = sistem (cron / migrare)
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
REVOKE ALL ON TABLE public.conturi_inchideri_jurnal FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.conturi_inchideri_jurnal TO authenticated;
GRANT ALL ON TABLE public.conturi_inchideri_jurnal TO service_role;
REVOKE ALL ON SEQUENCE public.conturi_inchideri_jurnal_id_seq FROM PUBLIC, anon, authenticated;

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
     OR (NEW.id, NEW.profile_id, NEW.email, NEW.employee_id, NEW.motiv, NEW.sursa, NEW.snapshot, NEW.facut_de, NEW.facut_la)
        IS DISTINCT FROM
        (OLD.id, OLD.profile_id, OLD.email, OLD.employee_id, OLD.motiv, OLD.sursa, OLD.snapshot, OLD.facut_de, OLD.facut_la) THEN
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

-- B.3 Închiderea (internă). Întoarce 'inchis' | 'deja_inchis' | 'sarit_owner' | 'inexistent'.
CREATE OR REPLACE FUNCTION public.fn_cont_inchide(p_profile_id uuid, p_motiv text, p_sursa text, p_employee_id integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor   uuid := auth.uid();                      -- reținut ÎNAINTE de golirea claims
  v_claims  text := current_setting('request.jwt.claims', true);
  v_sub     text := current_setting('request.jwt.claim.sub', true);
  v_p       public.profiles%ROWTYPE;
  v_flaguri text[] := public.fn_cont_flaguri();
  v_jurnal  bigint;
  v_rez     text;
  v_snap    jsonb;
  v_set     text;
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
    INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, employee_id, motiv, sursa, snapshot, facut_de)
    VALUES (p_profile_id, COALESCE(v_p.email, p_profile_id::text), COALESCE(p_employee_id, v_p.employee_id::integer),
            p_motiv, p_sursa, v_snap, v_actor)
    RETURNING id INTO v_jurnal;
    v_rez := 'inchis';
  ELSE
    v_rez := 'deja_inchis';                           -- NU suprascrie primul snapshot
  END IF;

  -- Aplicarea e convergentă: rulează și pe 'deja_inchis' (scoate un acces redat manual între timp).
  DELETE FROM public.user_module_access WHERE profile_id = p_profile_id;
  DELETE FROM public.profile_sites      WHERE profile_id = p_profile_id;

  -- Capcana triggerelor owner-only de pe profiles: cu auth.uid() = un HR non-owner,
  -- enforce_owner_only_salary_flags ar repune TĂCUT 8 flaguri. Golim claims (LOCAL tranzacției)
  -- doar pentru acest UPDATE, apoi le restaurăm. NU folosim SET în definiția funcției
  -- (în producție postgres nu e superuser → „permission denied to set parameter”).
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(v_flaguri) f;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING p_profile_id;
  END IF;
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);

  -- Logare blocată + sesiuni revocate (aceeași valoare ca la închiderea manuală, nu 'infinity').
  UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00'
   WHERE id = p_profile_id AND (banned_until IS NULL OR banned_until < '2999-12-31 00:00:00+00');
  UPDATE auth.refresh_tokens SET revoked = true, updated_at = now()
   WHERE user_id = p_profile_id::text AND revoked IS DISTINCT FROM true;
  DELETE FROM auth.sessions WHERE user_id = p_profile_id;

  IF v_rez = 'inchis' THEN
    BEGIN                                             -- best-effort: închiderea rămâne făcută și dacă notificarea pică
      PERFORM public.fn_cont_notifica_owneri('cont_inchis_automat', '🔒 Cont închis: ' || COALESCE(v_p.email, p_profile_id::text),
        format('%s · jurnal #%s', p_motiv, v_jurnal),
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
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'Doar owner poate închide manual un cont' USING ERRCODE = '42501';
  END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'Motivul închiderii e obligatoriu (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT employee_id::integer INTO v_emp FROM public.profiles WHERE id = p_profile_id;
  RETURN public.fn_cont_inchide(p_profile_id, btrim(p_motiv), 'manual_owner', v_emp);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_inchide_owner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cont_inchide_owner(uuid, text) TO authenticated, service_role;

-- B.5 Triggerul pe employees ------------------------------------------------------
-- AFTER UPDATE + WHEN pe active (nu UPDATE OF active): vede și active=false pus de
-- fn_employees_termination_notify (BEFORE) pe calea UI, și UPDATE-ul cron-ului (fără JWT).
CREATE OR REPLACE FUNCTION public.fn_employees_ciclu_cont()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_rez text;
  v_err text;
BEGIN
  IF OLD.active IS TRUE AND NEW.active IS FALSE THEN
    FOR r IN SELECT p.id, p.email FROM public.profiles p WHERE p.employee_id = NEW.id ORDER BY p.id LOOP
      IF NEW.termination_date IS NOT NULL AND NEW.termination_date <= CURRENT_DATE THEN
        BEGIN
          v_rez := public.fn_cont_inchide(r.id,
                     format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
                     'trigger_contract_incheiat', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          -- Nu blocăm NICIODATĂ UPDATE-ul din HR sau lotul cron-ului (nici dacă pică și notificarea).
          v_err := SQLERRM;
          BEGIN
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
              format('%s (fișa #%s %s): %s', r.email, NEW.id, NEW.name, v_err),
              '/admin?tab=managers&cont=' || r.id::text);
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'fn_employees_ciclu_cont (%): închiderea a eșuat (%) și notificarea la fel: % [%]', r.email, v_err, SQLERRM, SQLSTATE;
          END;
        END;
      ELSE
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_angajat_inactiv_fara_incetare', '⚠️ Angajat dezactivat fără contract încheiat',
            format('%s (fișa #%s %s) a fost dezactivat%s. Contul NU s-a închis automat — verifică fișa sau închide contul manual.',
                   r.email, NEW.id, NEW.name,
                   CASE WHEN NEW.termination_date IS NULL THEN ' fără dată de încetare'
                        ELSE ' înainte de data încetării (' || to_char(NEW.termination_date, 'DD.MM.YYYY') || ')' END),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
      END IF;
    END LOOP;
  ELSIF OLD.active IS NOT TRUE AND NEW.active IS TRUE THEN
    -- Reactivarea NU redă nimic automat; doar anunță owner-ul.
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
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION public.fn_employees_ciclu_cont();

-- B.6 Restaurarea din jurnal — EXCLUSIV owner ------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cont_restaureaza(p_jurnal_id bigint, p_nota text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_j       public.conturi_inchideri_jurnal%ROWTYPE;
  v_el      jsonb;
  v_refacut text[] := '{}';
  v_sarit   text[] := '{}';
  v_s_ok    integer[] := '{}';
  v_s_sarit integer[] := '{}';
  v_fl      jsonb;
  v_set     text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'Doar owner poate restaura un cont închis' USING ERRCODE = '42501';
  END IF;
  IF p_nota IS NULL OR length(btrim(p_nota)) < 5 THEN
    RAISE EXCEPTION 'Nota restaurării e obligatorie (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_j FROM public.conturi_inchideri_jurnal WHERE id = p_jurnal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Închiderea #% nu există în jurnal', p_jurnal_id USING ERRCODE = 'P0002';
  END IF;
  IF v_j.restaurat_la IS NOT NULL THEN
    RAISE EXCEPTION 'Închiderea #% a fost deja restaurată la %', p_jurnal_id, v_j.restaurat_la USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_j.profile_id) THEN
    RAISE EXCEPTION 'Profilul % nu mai există; nu am ce restaura', v_j.profile_id USING ERRCODE = 'P0002';
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
      INSERT INTO public.user_module_access (profile_id, module, access_level, granted_at, granted_by)
      VALUES (v_j.profile_id, v_el ->> 'module', v_el ->> 'access_level', now(), v_uid)
      ON CONFLICT (profile_id, module) DO NOTHING;
      v_refacut := v_refacut || (v_el ->> 'module');
    ELSE
      v_sarit := v_sarit || (v_el ->> 'module');
    END IF;
  END LOOP;

  -- Șantiere (doar cele care mai există)
  FOR v_el IN SELECT e FROM jsonb_array_elements(COALESCE(v_j.snapshot -> 'santiere', '[]'::jsonb)) e LOOP
    IF EXISTS (SELECT 1 FROM public.sites WHERE id = (v_el ->> 'site_id')::integer) THEN
      INSERT INTO public.profile_sites (profile_id, site_id, valid_until, granted_by, note)
      VALUES (v_j.profile_id, (v_el ->> 'site_id')::integer, (v_el ->> 'valid_until')::date, v_uid, v_el ->> 'note')
      ON CONFLICT (profile_id, site_id) DO NOTHING;
      v_s_ok := v_s_ok || (v_el ->> 'site_id')::integer;
    ELSE
      v_s_sarit := v_s_sarit || (v_el ->> 'site_id')::integer;
    END IF;
  END LOOP;

  -- Flaguri: doar cheile care sunt și azi în fn_cont_flaguri(). Apelantul e owner →
  -- triggerele owner-only permit fără golirea claims.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_fl
    FROM jsonb_each(COALESCE(v_j.snapshot -> 'flaguri', '{}'::jsonb)) f
   WHERE f.key = ANY (public.fn_cont_flaguri());
  SELECT string_agg(format('%I = ($1 ->> %L)::boolean', k, k), ', ') INTO v_set FROM jsonb_object_keys(v_fl) k;
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE public.profiles SET %s WHERE id = $2', v_set) USING v_fl, v_j.profile_id;
  END IF;

  -- Logarea: banned_until revine la valoarea din snapshot (de regulă NULL). Sesiunile nu se refac.
  UPDATE auth.users SET banned_until = (v_j.snapshot ->> 'banned_until')::timestamptz WHERE id = v_j.profile_id;

  UPDATE public.conturi_inchideri_jurnal
     SET restaurat_de = v_uid, restaurat_la = now(), restaurare_nota = btrim(p_nota)
   WHERE id = p_jurnal_id;

  RETURN jsonb_build_object('jurnal_id', p_jurnal_id, 'profile_id', v_j.profile_id,
    'module_refacute', to_jsonb(v_refacut), 'module_sarite', to_jsonb(v_sarit),
    'santiere', to_jsonb(v_s_ok), 'santiere_sarite', to_jsonb(v_s_sarit), 'flaguri', v_fl);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_restaureaza(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cont_restaureaza(bigint, text) TO authenticated, service_role;

-- B.7 Starea contului pentru fișa HR (și coloana „Stare” din Admin → Manageri) ------
-- Owner / can_modify_employees / can_access_personal_data; ceilalți primesc 0 rânduri (fără eroare).
-- Owner-ul primește TOATE conturile (inclusiv nelegate), ca „blocat” (ban fără jurnal) să apară și în Manageri.
CREATE OR REPLACE FUNCTION public.fn_cont_stare_angajati()
RETURNS TABLE(employee_id integer, profile_id uuid, email text, stare text, inchis_la timestamptz, jurnal_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_owner boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid()
          AND (pr.is_owner IS TRUE OR pr.can_modify_employees IS TRUE OR pr.can_access_personal_data IS TRUE)) THEN
    RETURN;
  END IF;
  v_owner := EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner IS TRUE);
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
REVOKE ALL ON FUNCTION public.fn_cont_stare_angajati() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cont_stare_angajati() TO authenticated, service_role;

-- B.8 Alerta extinsă (aceeași semnătură, aceeași poartă owner) --------------------
CREATE OR REPLACE FUNCTION public.fn_admin_conturi_alerte()
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_flaguri text[] := public.fn_cont_flaguri();
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'Alertele de conturi sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH pr AS (
    SELECT p.id AS pid, COALESCE(u.email, p.email) AS pemail, u.email AS uemail, p.tip_cont AS ptip, p.is_owner AS powner,
           p.employee_id::integer AS emp, e.id AS eid, e.name AS enume, e.active AS eactiv, e.termination_date AS etd,
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
    -- cont_activ_fost_angajat: legat de o fișă inactivă, fără închidere, nebanat
    SELECT 'cont_activ_fost_angajat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, NULL::bigint, NULL::timestamptz, NULL::jsonb, NULL::jsonb
      FROM pr WHERE pr.eid IS NOT NULL AND pr.eactiv IS NOT TRUE AND pr.jid IS NULL
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
                          WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb))
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
    SELECT 'inactiv_fara_data', p.id, COALESCE(u.email, p.email), p.tip_cont, p.is_owner, e.id, e.name, e.active, e.termination_date,
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
REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated, service_role;
