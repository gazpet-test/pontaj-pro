-- ============================================================================
-- R1 — legarea automată cont ↔ fișă de angajat (profiles.employee_id)
-- Specificație: docs/CONTURI_CICLU_VIATA.md, secțiunea A.
--   * profiles.tip_cont (excepții marcate o dată: extern/test/sistem)
--   * fn_cont_candidati_angajat(email)  — potrivirea (internă)
--   * fn_cont_notifica_owneri(...)      — notificări owner, cu dedupe (internă)
--   * handle_new_user()                 — leagă singur DOAR pe calea de încredere (app_metadata pus de service_role,
--                                         ex. funcția edge cont-nou cu poartă owner) și doar la candidat unic și liber;
--                                         la înscrierea publică / Dashboard doar PROPUNE (notificare), owner-ul confirmă
--   * trg_profiles_protectie_legatura   — employee_id / tip_cont / email se schimbă doar de owner (sau sistem);
--                                         un cont închis (R2) nu se mai poate auto-edita
--   * fn_cont_leaga_automat(simulare)   — legare la cerere (un clic), poartă owner în cod, potrivire pe emailul de LOGARE
--   * fn_admin_conturi_alerte() + v_admin_conturi_alerte — diagnostic, poartă owner în cod
-- Idempotentă (rulează de două ori fără erori). Nu atinge datele.
-- ============================================================================

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
-- (sau cu emailul personal trecut pe fișă) și ar primi imediat fișa acelui om → semnătura lui electronică
-- (hr_sem_self_* prin my_employee_id()). De aceea:
--   * legarea SINGURĂ se face doar pe CALEA DE ÎNCREDERE: auth.users.raw_app_meta_data.gazpet_legare_automata = true.
--     app_metadata îl poate pune DOAR service_role (API-ul admin GoTrue), nu signUp și nici Dashboard → Add user;
--     e cârligul pentru funcția edge „cont-nou” cu poartă owner (D1 varianta C);
--   * pe orice altă cale contul se creează nelegat, iar owner-ul primește PROPUNEREA (cont_legare_propusa)
--     cu candidatul unic; legarea o confirmă dintr-un clic: Admin → Manageri → „Leagă automat” (fn_cont_leaga_automat).
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
  v_legat     boolean := false;
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

  -- R1 sub-bloc 1: potrivirea (+ legarea doar pe calea de încredere). Nicio eroare de aici nu are voie
  -- să blocheze crearea contului. NU punem employee_id în INSERT: indexul unic ar pica tot contul.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
    IF v_incredere AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      UPDATE public.profiles SET employee_id = v_emp
       WHERE id = NEW.id AND employee_id IS NULL;          -- nu suprascrie niciodată
      v_legat := FOUND;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_legat := false;
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat: o eroare aici nu anulează legarea)
  BEGIN
    IF v_legat THEN
      PERFORM public.fn_cont_notifica_owneri('cont_legat_automat', '🔗 Cont nou legat automat de fișă',
        format('Cont nou %s legat automat de %s (#%s, prin %s)', NEW.email, v_nume, v_emp, v_metoda),
        '/admin?tab=managers&cont=' || NEW.id::text);
    ELSIF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
      PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
        format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
               NEW.email, v_nume, v_emp, v_metoda),
        '/admin?tab=managers&cont=' || NEW.id::text);
    ELSIF lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la legare: ' || v_eroare
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
-- Ca în producție: funcția de trigger nu e apelabilă din API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- A.4 Protejarea legăturii și a tipului de cont --------------------------------
-- Închide gaura din profiles_update_own (oricine își putea pune singur employee_id = orice
-- angajat nelegat → acces la semnătura lui). Sistemul (auth.uid() NULL) și owner-ul trec.
CREATE OR REPLACE FUNCTION public.fn_profiles_protectie_legatura()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.tip_cont IS DISTINCT FROM OLD.tip_cont)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'Doar owner poate lega un cont de o fișă sau marca tipul contului' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_profiles_protectie_legatura() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_profiles_protectie_legatura ON public.profiles;
CREATE TRIGGER trg_profiles_protectie_legatura BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_protectie_legatura();

-- A.5 Legarea la cerere, cu previzualizare (poartă owner în cod) -----------------
CREATE OR REPLACE FUNCTION public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true)
RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_n integer; v_emp integer; v_nume text; v_ocupat boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'Doar owner poate lega automat conturile' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT pr.id AS pid, pr.email AS pemail
      FROM public.profiles pr
     WHERE pr.employee_id IS NULL AND COALESCE(pr.tip_cont, 'angajat') = 'angajat'
     ORDER BY pr.email, pr.id
  LOOP
    SELECT count(*), min(c.employee_id), min(c.employee_name), COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_ocupat
      FROM public.fn_cont_candidati_angajat(r.pemail) c;
    profile_id := r.pid; email := r.pemail; employee_id := NULL; employee_name := NULL;
    IF v_n = 0 THEN
      rezultat := 'fara_candidat';
    ELSIF v_n > 1 THEN
      rezultat := 'ambiguu';
    ELSE
      employee_id := v_emp; employee_name := v_nume;
      IF v_ocupat THEN
        rezultat := 'candidat_ocupat';
      ELSIF p_simulare THEN
        rezultat := 'de_legat';
      ELSE
        BEGIN
          UPDATE public.profiles pr SET employee_id = v_emp
           WHERE pr.id = r.pid AND pr.employee_id IS NULL;
          rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
        EXCEPTION
          WHEN unique_violation THEN rezultat := 'candidat_ocupat';
          WHEN OTHERS THEN
            RAISE WARNING 'fn_cont_leaga_automat (%): % [%]', r.pemail, SQLERRM, SQLSTATE;
            rezultat := 'eroare';
        END;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_leaga_automat(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean) TO authenticated, service_role;

-- A.6 Diagnosticul pentru alerta de administrare (semnătură FIXĂ; migrarea d o extinde) --
CREATE OR REPLACE FUNCTION public.fn_admin_conturi_alerte()
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'Alertele de conturi sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT 'fara_angajat:' || p.id::text, 'fara_angajat'::text, p.id, p.email, p.tip_cont, p.is_owner,
         NULL::integer, NULL::text, NULL::boolean, NULL::date, u.banned_until, NULL::bigint, NULL::timestamptz,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'employee_name', c.employee_name,
                                                       'metoda', c.metoda, 'profil_legat', c.profil_legat)
                                    ORDER BY c.employee_id)
                     FROM public.fn_cont_candidati_angajat(p.email) c), '[]'::jsonb),
         NULL::jsonb
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.employee_id IS NULL AND COALESCE(p.tip_cont, 'angajat') = 'angajat'
   ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_admin_conturi_alerte WITH (security_invoker = on) AS
  SELECT * FROM public.fn_admin_conturi_alerte();
REVOKE ALL ON public.v_admin_conturi_alerte FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_conturi_alerte TO authenticated, service_role;
COMMENT ON VIEW public.v_admin_conturi_alerte IS
  'Alerte de administrare „Conturi platformă” (doar owner; poarta e în fn_admin_conturi_alerte). Numai citire.';
