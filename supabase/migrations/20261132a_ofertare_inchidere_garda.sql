-- 20261132a_ofertare_inchidere_garda — auditul Ofertare 08.11.2026, PR #1027 (review Jakarinos r2, P1 / L07).
-- Cine poate trece o licitație în status 'abandonata' (NO-GO sau „închisă ca nedepusă” după termen), impus în BD pe ORICE cale
-- (UI, PATCH direct prin API), nu doar în ecran:
--   * ownerul (profiles.is_owner al auth.uid()), oricând — ca decizia NO-GO de azi (owner-only doar în JS);
--   * responsabilul 1 / 2 numit de owner (fn_ofertare_poate_cheltui, aceeași regulă ca poarta pe cheltuiala AI), DOAR din go / in_lucru
--     și DOAR după termenul de depunere (OLD.termen_depunere <= now()) = închiderea „nedepusă”;
--   * sesiunea SQL de administrare fără utilizator (session_user postgres, fără auth.uid()) — neschimbat față de a00_ofertare_licitatii_scriere.
-- Orice alt apelant: refuz 42501. Celelalte tranziții nu sunt atinse; poarta de depunere (fn_gate_depunere) rămâne neschimbată.
-- Ordinea trigger-elor BEFORE (alfabetic): a00 scriere → a01 loturi → a02 (aceasta) → restul. Funcția doar citește profiles și rândul
-- licitației (prin fn_ofertare_poate_cheltui); nu ia lock-uri proprii (L06).
-- NEAPLICATĂ. Se aplică doar cu „da”-ul lui Răzvan, prin runner-ul echipei (garda gazpet.livrare_migrare), după dry-run pe clonă:
-- supabase/tests/20261132a_ofertare_inchidere_garda_dryrun.sql. Revenire: supabase/revenire/20261132a_ofertare_inchidere_garda_ROLLBACK.sql.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261132a_ofertare_inchidere_garda:' || txid_current() THEN
    RAISE EXCEPTION '20261132a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261132a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_poate_cheltui(bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION '20261132a: lipseste fn_ofertare_poate_cheltui (20261124a)';
  END IF;
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NOT NULL THEN
    RAISE EXCEPTION '20261132a: fn_ofertare_inchidere_garda exista deja';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda') THEN
    RAISE EXCEPTION '20261132a: trigger-ul exista deja';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_ofertare_inchidere_garda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.status IS DISTINCT FROM 'abandonata' OR OLD.status IS NOT DISTINCT FROM 'abandonata' THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    -- administrare SQL fără utilizator (psql / runner); orice altă sesiune fără identitate e refuzată (L08)
    IF session_user = 'postgres' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Închiderea licitației cere un utilizator autentificat.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE((SELECT p.is_owner FROM public.profiles p WHERE p.id = v_uid), false) THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('go', 'in_lucru')
     AND OLD.termen_depunere IS NOT NULL AND OLD.termen_depunere <= now()
     AND public.fn_ofertare_poate_cheltui(OLD.id, v_uid) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Închiderea licitației o face ownerul; după termenul de depunere, la licitațiile cu GO, și responsabilul numit de owner.'
    USING ERRCODE = '42501';
END
$fn$;
COMMENT ON FUNCTION public.fn_ofertare_inchidere_garda() IS
  'Garda trecerii în abandonata (20261132a, audit Ofertare 08.11.2026): owner oricând; responsabil numit (fn_ofertare_poate_cheltui) doar din go/in_lucru după termen; SQL admin fără utilizator.';
REVOKE ALL ON FUNCTION public.fn_ofertare_inchidere_garda() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a02_ofertare_licitatii_inchidere_garda
  BEFORE UPDATE OF status ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_inchidere_garda();

DO $post$
DECLARE f record; t record;
BEGIN
  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
    INTO f FROM pg_proc p WHERE p.oid = 'public.fn_ofertare_inchidere_garda()'::regprocedure;
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR f.owner <> 'postgres' OR f.auth_exec OR f.anon_exec THEN
    RAISE EXCEPTION '20261132a: postconditie functie (definer/search_path/owner/ACL)';
  END IF;
  SELECT tgenabled, tgfoid INTO t FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda';
  IF t.tgenabled IS DISTINCT FROM 'O' OR t.tgfoid IS DISTINCT FROM 'public.fn_ofertare_inchidere_garda()'::regprocedure THEN
    RAISE EXCEPTION '20261132a: postconditie trigger';
  END IF;
END $post$;
