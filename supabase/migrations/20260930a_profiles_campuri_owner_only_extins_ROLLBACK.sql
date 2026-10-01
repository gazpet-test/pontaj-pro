-- ROLLBACK pentru 20260930a_profiles_campuri_owner_only_extins.sql: readuce EXACT varianta LIVE SEC F2 r4 (2 coloane: department + employee_id,
-- md5(prosrc) 9acc36a4067eddbdf29956220023ea92) — NU varianta 20260929g (aceea ar șterge hardening-ul F2).
-- Triggerul nu se atinge. Corpul de mai jos e copiat 1:1 din 20260930j_sec_f2_profiles_uid_null.sql.
CREATE OR REPLACE FUNCTION public.fn_profiles_campuri_owner_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_camp   text;
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
  v_rol_claim  text;
  v_rol_claims text;
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

  -- SEC F2 r4 (30.09.2026): cele două surse ale rolului JWT (request.jwt.claim.role și rolul din claims) nu au voie să se
  -- contrazică: ambele nevide și diferite => refuz (fail-closed), aliniat cu celelalte 3 triggere de pe profiles.
  v_rol_claim  := nullif(current_setting('request.jwt.claim.role', true), '');
  v_rol_claims := nullif(v_claims ->> 'role', '');
  IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (rol JWT contradictoriu: claim.role %, claims.role %)', v_camp, v_rol_claim, v_rol_claims
      USING ERRCODE = '42501';
  END IF;

  IF v_rol IS NULL AND v_sub IS NULL THEN
    -- fără context de cerere: conexiune directă la BD
    IF session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (conexiune fără identitate autorizată: %)', v_camp, session_user
      USING ERRCODE = '42501';
  END IF;

  -- SEC F2 r4: ramura service_role legată de rolul SQL efectiv, identic cu celelalte 3: conexiunea PostgREST (session_user =
  -- 'authenticator') ȘI rolul efectiv al cererii current_setting('role') = 'service_role' (SET LOCAL ROLE din JWT, nealterat de
  -- SECURITY DEFINER). Un RPC rulat ca authenticated care își pune singur claim-urile service_role (set_config) are
  -- role = 'authenticated' => cade mai jos pe 42501.
  IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF v_rol = 'authenticated' AND v_sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = v_sub AND is_owner IS TRUE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil', v_camp USING ERRCODE = '42501';
END $function$;

DO $verif$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_profiles_campuri_owner_only()'::regprocedure) IS DISTINCT FROM '9acc36a4067eddbdf29956220023ea92' THEN
    RAISE EXCEPTION 'Rollback 20260930a: funcția nu a revenit exact la varianta F2 r4';
  END IF;
END $verif$;
