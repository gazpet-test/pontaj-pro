-- Funcția trigger enforce_owner_only_salary_flags — verbatim live 09.10.2026 (md5(prosrc) daaa561298c10c259944600e6c39467e)
CREATE OR REPLACE FUNCTION public.enforce_owner_only_salary_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol_claim  text;
  v_rol_claims text;
  v_rol        text;
BEGIN
  IF auth.uid() IS NULL THEN
    -- SEC F2 r3 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => auth.uid() (evaluat primul) cade cu 22P02,
    --   fail-closed; handlerul de mai jos e doar apărare suplimentară.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). r3: ramura (a) cere și rolul SQL EFECTIV al cererii,
    --   current_setting('role') = 'service_role' — PostgREST îl setează din JWT (SET LOCAL ROLE) și SECURITY DEFINER nu-l
    --   schimbă (verificat cu PostgREST 13.0.4 real); un RPC rulat ca authenticated care își pune singur claim-urile
    --   service_role are role = 'authenticated' => refuz.
    v_rol_claim := nullif(current_setting('request.jwt.claim.role', true), '');
    BEGIN
      v_rol_claims := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    EXCEPTION WHEN invalid_text_representation THEN
      v_rol_claims := NULL;
    END;
    IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
      RAISE EXCEPTION '%: rol JWT contradictoriu (claim.role: %, claims.role: %) — refuzat', 'enforce_owner_only_salary_flags', v_rol_claim, v_rol_claims
        USING ERRCODE = '42501';
    END IF;
    v_rol := coalesce(v_rol_claim, v_rol_claims);
    IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF v_rol IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '%: modificare pe profiles fără identitate de utilizator și în afara contextului de sistem (rol JWT: %, session_user: %)',
      'enforce_owner_only_salary_flags', coalesce(v_rol, '<niciunul>'), session_user USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner = true) THEN
    NEW.is_owner := OLD.is_owner;
    NEW.can_access_salarii := OLD.can_access_salarii;
    NEW.can_access_personal_data := OLD.can_access_personal_data;
    NEW.can_access_pontaj_brut := OLD.can_access_pontaj_brut;
    NEW.can_modify_employees := OLD.can_modify_employees;
    NEW.can_manage_contracts := OLD.can_manage_contracts;
    NEW.can_access_diurne := OLD.can_access_diurne;
    NEW.can_access_financiar := OLD.can_access_financiar;
  END IF;
  RETURN NEW;
END;
$function$
;
DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $r$;
REVOKE ALL ON FUNCTION public.enforce_owner_only_salary_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_owner_only_salary_flags() TO service_role;
