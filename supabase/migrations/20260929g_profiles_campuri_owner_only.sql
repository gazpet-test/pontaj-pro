-- ============================================================================
-- S-A (29.09.2026) — contul propriu nu-și mai poate schimba singur department și employee_id.
--
-- Gaura: politica profiles_update_own (auth.uid() = id) lasă orice cont să-și modifice propriul rând:
--   * department  → 4 politici de scriere pe department='HR' (hr_autorizatii, hr_autorizatii_tipuri,
--                   hr_formare_profesionala, hr_recrutare_pozitii);
--   * employee_id → legarea contului de fișa altui angajat (semnătura/identitatea lui).
-- Domeniul aprobat de Răzvan pentru la noapte (S-A) = exact aceste 2 coloane. Celelalte 14 coloane găsite
-- (email + flagurile scăpate de enforce_owner_only_salary_flags la 02.06.2026) sunt în migrarea separată
-- 20260930a_profiles_campuri_owner_only_extins.sql — se aplică doar cu acordul lui Răzvan.
--
-- Cine trece (identitate explicită, NU „lipsa identității” — cerința Copilot, 29.09):
--   1. cerere PostgREST (claims JWT prezente):
--        role = 'service_role'                       → backend (edge functions cu cheia service);
--        role = 'authenticated' + sub = profil owner → owner-ul (Admin → Manageri);
--        orice altceva (anon, authenticated non-owner, claims fără sub) → refuz;
--   2. fără claims = conexiune directă la BD: trec DOAR login-urile postgres / supabase_admin
--      (migrări MCP/CLI, SQL editor, pg_cron — toate joburile cron rulează ca postgres). Orice alt login
--      (authenticator cu claims golite, supabase_auth_admin, storage etc.) → refuz.
--   session_user = identitatea de LOGIN a conexiunii (nu se schimbă în SECURITY DEFINER sau SET ROLE),
--   deci nu e confundată cu proprietarul funcției.
-- Modificările care nu ating coloanele protejate trec neverificate (autorizarea strictă doar pe schimbare).
-- Nu atinge: date, politici, granturi, alte funcții. Nimic din Ofertare.
-- Revenire: vezi …_ROLLBACK.sql (rollback TEHNIC) și docs/SECURITATE_SA_PROFILES.md §5 (revenirea operațională).
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
  'S-A 29.09.2026: department și employee_id se schimbă doar de owner (JWT), service_role (JWT) sau login-urile postgres/supabase_admin fără context de cerere.';
