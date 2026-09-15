-- Task #69 (Oana Nica, Ofertare) — varianta A, aprobata de Razvan 15.09.2026.
-- Ofertarea afla din clopotel cand apare o CALIFICARE NOUA in HR (autorizatie / atestat
-- incarcat), ca s-o poata folosi la licitatii. Trigger AFTER INSERT pe hr_autorizatii.
--
-- Cine primeste: toti is_owner + toate profilele cu modulul 'ofertare' in user_module_access
-- (cheia din user_module_access e lowercase 'ofertare' — vezi fn_are_acces_ofertare;
-- in notifications.modul valoarea corecta e 'Comercial' — CHECK pe lista fixa, vezi
-- OfertareLicitatii.jsx / ofertare-seap-veghe).
--
-- Anti-zgomot:
--   * randuri cu deleted_at IS NOT NULL nu notifica (nu apar la insert in practica, dar
--     importurile pot aduce si istoric marcat sters);
--   * doar tipurile relevante ofertarii: categorie profesionala / sudura / ANRE / ISCIR /
--     ISU / mediu-SSM, sau cod din lista (RTE, EGD, RTS, SUDOR*, INSEMEX, ISCIR*, RSVTI, SMC*).
--     Medicalul si transportul (permise) NU intereseaza ofertarea. Tip fara cod → notifica
--     oricum (mai bine un mesaj in plus decat o calificare ratata);
--   * de-duplicare: acelasi titlu la acelasi profil in ultimele 10 minute → nu se mai
--     insereaza (importurile in masa aduc zeci de randuri identice).
-- Trigger-ul NU blocheaza niciodata insertul: orice eroare e inghitita si se intoarce NEW.

CREATE OR REPLACE FUNCTION public.fn_trg_hr_autorizatie_noua()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tip_denumire text;
  v_tip_cod      text;
  v_tip_cat      text;
  v_persoana     text;
  v_extern       boolean := false;
  v_title        text;
  v_message      text;
  v_relevant     boolean;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;

    SELECT t.denumire, t.cod, t.categorie
      INTO v_tip_denumire, v_tip_cod, v_tip_cat
      FROM public.hr_autorizatii_tipuri t
     WHERE t.id = NEW.tip_id;

    -- Filtru de relevanta pentru ofertare (categorie SAU cod; fara cod → trece)
    v_relevant :=
         v_tip_cod IS NULL
      OR lower(coalesce(v_tip_cat, '')) IN ('profesional', 'sudura', 'anre', 'iscir', 'isu', 'mediu')
      OR upper(v_tip_cod) IN ('RTE', 'EGD', 'RTS', 'RSVTI', 'INSEMEX', 'ISC', 'ANRE', 'ISCIR', 'SMC', 'MANAGER_SMC')
      OR upper(v_tip_cod) LIKE 'SUDOR%'
      OR upper(v_tip_cod) LIKE 'ISCIR%'
      OR upper(v_tip_cod) LIKE 'ANRE%'
      OR upper(v_tip_cod) LIKE 'INSEMEX%'
      OR upper(v_tip_cod) LIKE 'SMC%'
      OR upper(v_tip_cod) LIKE 'RTE%';
    IF NOT v_relevant THEN
      RETURN NEW;
    END IF;

    -- Persoana: angajat sau personal extern (CHECK: exact unul dintre cele doua e completat)
    IF NEW.employee_id IS NOT NULL THEN
      SELECT e.name INTO v_persoana FROM public.employees e WHERE e.id = NEW.employee_id;
    ELSIF NEW.extern_id IS NOT NULL THEN
      SELECT p.nume INTO v_persoana FROM public.hr_personal_extern p WHERE p.id = NEW.extern_id;
      v_extern := true;
    END IF;

    v_title := '🎓 Calificare nouă în HR: ' || coalesce(v_tip_denumire, 'autorizație')
               || ' — ' || coalesce(v_persoana, '(persoană necunoscută)')
               || CASE WHEN v_extern THEN ' (extern)' ELSE '' END;
    v_message := 'S-a încărcat în HR o calificare nouă'
               || CASE WHEN NEW.numar_autorizatie IS NOT NULL THEN ' nr. ' || NEW.numar_autorizatie ELSE '' END
               || CASE WHEN NEW.emitent IS NOT NULL THEN ', emisă de ' || NEW.emitent ELSE '' END
               || CASE WHEN NEW.data_expirare IS NOT NULL THEN ', valabilă până la ' || to_char(NEW.data_expirare, 'DD.MM.YYYY')
                       WHEN NEW.fara_expirare IS TRUE THEN ', fără expirare'
                       ELSE '' END
               || '. O poți folosi la licitații.';

    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    SELECT d.profile_id, 'info', 'Comercial', v_title, v_message, '/hr?tab=autorizatii'
      FROM (
        SELECT pr.id AS profile_id FROM public.profiles pr WHERE pr.is_owner = true
        UNION
        SELECT uma.profile_id FROM public.user_module_access uma WHERE uma.module = 'ofertare'
      ) d
     WHERE d.profile_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.profile_id = d.profile_id
            AND n.title = v_title
            AND n.created_at > now() - interval '10 minutes'
       );
  EXCEPTION WHEN OTHERS THEN
    -- Notificarea e "nice to have"; insertul autorizatiei nu cade niciodata din cauza ei.
    RETURN NEW;
  END;
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_trg_hr_autorizatie_noua() FROM PUBLIC;
COMMENT ON FUNCTION public.fn_trg_hr_autorizatie_noua() IS
  'Task #69: la INSERT in hr_autorizatii, notificare in clopotel (modul Comercial) catre owneri + cei cu modulul ofertare, doar pentru tipuri relevante ofertarii; de-dup 10 min; nu blocheaza insertul.';

DROP TRIGGER IF EXISTS trg_hr_autorizatie_noua ON public.hr_autorizatii;
CREATE TRIGGER trg_hr_autorizatie_noua
  AFTER INSERT ON public.hr_autorizatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_hr_autorizatie_noua();
