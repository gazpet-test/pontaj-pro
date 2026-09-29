-- ============================================================================
-- S-A EXTINS (pregătit 29.09 noaptea, NEAPLICAT) — se aplică DOAR cu acordul explicit al lui Răzvan.
-- Peste 20260929g: aceeași funcție (aceeași regulă de identitate explicită), lista crește de la 2 la 16 coloane:
--   * email                 → identitate în căutări după email (HrAngajatNouWizard → contul Cristianei,
--                              Logistica → m.alexandru) și destinatarul mailurilor din edge functions;
--                              legitim îl schimbă doar owner-ul (Admin → Manageri, cu emailul de logare);
--   * REGRESIE 02.06.2026: până atunci enforce_owner_only_salary_flags păzea și can_use_document_scanner,
--     receive_tichete_* (6), can_create_comenzi, can_process_achizitii, can_manage_stoc, can_access_ctc,
--     whatsapp_tier; migrarea 20260602105459 contracte_extensii_acte_aditionale_access a rescris funcția și
--     le-a scăpat (App.jsx încă scrie „trigger BD protejează”). Ce deschid: can_manage_stoc → ALL pe magazii,
--     consumuri_proiect(_linii); can_use_document_scanner → SELECT hr_autorizatii_propuneri; receive_tichete_*
--     → tichetele altor departamente; receive_bonuri_consum → preluarea bonurilor; whatsapp_tier.
--   * + receive_bonuri_consum (niciodată protejat, dar dă drept de preluare în ConsumuriBonuriTab).
-- Rollback: …_ROLLBACK.sql readuce varianta cu 2 coloane (NU scoate protecția).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_profiles_campuri_owner_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_camp   text;
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
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

  IF v_rol IS NULL AND v_sub IS NULL THEN
    -- fără context de cerere: conexiune directă la BD
    IF session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (conexiune fără identitate autorizată: %)', v_camp, session_user
      USING ERRCODE = '42501';
  END IF;

  IF v_rol = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF v_rol = 'authenticated' AND v_sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = v_sub AND is_owner IS TRUE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil', v_camp USING ERRCODE = '42501';
END $fn$;

REVOKE ALL ON FUNCTION public.fn_profiles_campuri_owner_only() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_profiles_campuri_owner_only ON public.profiles;
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_campuri_owner_only();

COMMENT ON FUNCTION public.fn_profiles_campuri_owner_only() IS
  'S-A extins 30.09.2026: department, employee_id, email și 13 flaguri de drepturi (scăpate de enforce_owner_only_salary_flags la 02.06.2026) se schimbă doar de owner (JWT), service_role (JWT) sau login-urile postgres/supabase_admin fără context de cerere.';
