-- Fixture LOCAL (partea 2, după corpurile live F2): funcția S-A (md5 c06d7ce0…, neschimbată de F2) + ACL + cele 4 triggere de pe profiles.
CREATE FUNCTION public.fn_profiles_campuri_owner_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
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
END $function$;
REVOKE EXECUTE ON FUNCTION prevent_role_escalation(), enforce_owner_only_salary_flags(), protect_can_access_pontaj_brut(), fn_profiles_campuri_owner_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prevent_role_escalation(), enforce_owner_only_salary_flags(), protect_can_access_pontaj_brut() TO service_role;
CREATE TRIGGER prevent_role_escalation_trigger BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_enforce_owner_only_salary_flags BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION enforce_owner_only_salary_flags();
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION fn_profiles_campuri_owner_only();
CREATE TRIGGER trg_protect_can_access_pontaj_brut BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_can_access_pontaj_brut();
