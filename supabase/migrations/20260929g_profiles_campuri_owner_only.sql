-- ============================================================================
-- S-A (29.09.2026) — profilul propriu nu mai poate acorda singur drepturi.
--
-- Gaura: politica profiles_update_own (auth.uid() = id) lasă orice cont să-și modifice propriul rând.
-- Triggerele existente păzesc doar role, is_owner și 7 flaguri (salarii, date personale, pontaj brut,
-- modificare angajați, contracte, diurne, financiar). Restul coloanelor care dau drepturi se pot
-- seta singur din consola browserului:
--   * department            → 4 politici de scriere pe department='HR' (hr_autorizatii, hr_autorizatii_tipuri,
--                              hr_formare_profesionala, hr_recrutare_pozitii);
--   * employee_id           → legarea contului de o fișă (semnătura/identitatea altui angajat);
--   * can_use_document_scanner → SELECT pe hr_autorizatii_propuneri + scanner_logs;
--   * can_manage_stoc       → ALL pe magazii, consumuri_proiect, consumuri_proiect_linii;
--   * can_create_comenzi / can_process_achizitii / can_access_ctc → drepturi Comercial;
--   * receive_tichete_* (6) → primește tichetele altor departamente;
--   * receive_bonuri_consum → poate prelua bonuri de consum;
--   * whatsapp_tier         → nivelul notificărilor WhatsApp.
-- Regresie: până la 02.06.2026 enforce_owner_only_salary_flags păzea și scannerul, receive_tichete_*,
-- cele 4 flaguri Comercial și whatsapp_tier; migrarea contracte_extensii_acte_aditionale_access
-- (20260602105459) a rescris funcția și le-a scăpat. Codul din App.jsx încă scrie că „triggerul BD protejează”.
--
-- Ce face: un trigger NOU, separat (nu atinge funcțiile existente), care REFUZĂ vizibil (42501) orice
-- schimbare a acestor coloane venită de la un cont care nu e owner. Owner-ul și sistemul (auth.uid() NULL:
-- service_role, migrări, triggere interne) trec, exact ca triggerele existente.
-- Nu atinge: date, politici, granturi, alte funcții. Nimic din Ofertare.
-- Rollback: 20260929g_profiles_campuri_owner_only_ROLLBACK.sql (DROP TRIGGER + DROP FUNCTION).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_profiles_campuri_owner_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_camp text;
BEGIN
  IF auth.uid() IS NULL
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE) THEN
    RETURN NEW;
  END IF;
  v_camp := CASE
    WHEN NEW.department               IS DISTINCT FROM OLD.department               THEN 'department'
    WHEN NEW.employee_id              IS DISTINCT FROM OLD.employee_id              THEN 'employee_id'
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
  IF v_camp IS NOT NULL THEN
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil', v_camp USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_profiles_campuri_owner_only() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_profiles_campuri_owner_only ON public.profiles;
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_campuri_owner_only();

COMMENT ON FUNCTION public.fn_profiles_campuri_owner_only() IS
  'S-A 29.09.2026: department, employee_id și flagurile de drepturi scăpate de enforce_owner_only_salary_flags la 02.06.2026 se schimbă doar de owner (sau sistem).';
