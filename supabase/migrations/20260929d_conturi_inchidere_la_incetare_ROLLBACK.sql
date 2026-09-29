-- ROLLBACK pentru 20260929d_conturi_inchidere_la_incetare.sql (rulat DUPĂ rollback-ul e, ÎNAINTE de c).
-- Idempotent. Conturile deja închise RĂMÂN închise (partea sigură): drepturile nu revin singure.
-- ⚠️ Se pierd jurnalul conturi_inchideri_jurnal (snapshot-urile de revenire) și coada conturi_inchideri_coada:
--    exportă-le înainte în claude_context, cu confirmarea lui Răzvan. Intrările deschise din coadă de tip 'flaguri'
--    = conturi închise ale căror flaguri NU au fost încă puse pe false → rezolvă-le întâi (SELECT fn_conturi_inchideri_sweep()).
-- NU atinge triggerul S-A (trg_profiles_campuri_owner_only, 20260929g).

-- Gardă: dacă hook-ul PostgREST e ACTIVAT pe authenticator, ștergerea funcției ar pica TOATE cererile API.
DO $garda$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
               JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
              WHERE r.rolname = 'authenticator'
                AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c ILIKE 'pgrst.db_pre_request=%fn_pgrst_pre_request%')) THEN
    RAISE EXCEPTION 'Hook-ul pgrst.db_pre_request = fn_pgrst_pre_request e ACTIV pe authenticator: dezactivează-l întâi (ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, ''reload config'')'
      USING ERRCODE = '55000';
  END IF;
END $garda$;

-- Jobul pg_cron al cozii (dacă există; local nu există pg_cron).
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'conturi_inchideri_coada';
  END IF;
END $cron$;

DROP TRIGGER IF EXISTS trg_employees_zz_ciclu_cont ON public.employees;
DROP FUNCTION IF EXISTS public.fn_employees_ciclu_cont();
DROP TRIGGER IF EXISTS trg_employees_persoana_lock ON public.employees;
DROP FUNCTION IF EXISTS public.fn_employees_persoana_lock();
DROP FUNCTION IF EXISTS public.fn_conturi_inchideri_sweep();
DROP FUNCTION IF EXISTS public.fn_pgrst_pre_request();
DROP FUNCTION IF EXISTS public.fn_cont_inchide_owner(uuid, text);
DROP FUNCTION IF EXISTS public.fn_cont_restaureaza(bigint, text, boolean);
DROP FUNCTION IF EXISTS public.fn_cont_restaureaza(bigint, text);
DROP FUNCTION IF EXISTS public.fn_cont_stare_angajati();
DROP FUNCTION IF EXISTS public.fn_cont_inchide(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.fn_cont_garda_persoana(integer);
DROP FUNCTION IF EXISTS public.fn_cont_lock_persoana(text);
DROP FUNCTION IF EXISTS public.fn_cont_coada_pune(uuid, integer, text, text, date, text);
DROP FUNCTION IF EXISTS public.fn_cont_flaguri();

-- fn_admin_conturi_alerte revine la corpul din migrarea c (doar cod='fara_angajat'); semnătura e aceeași,
-- deci view-ul v_admin_conturi_alerte rămâne valid. Depinde de fn_cont_cnp_normalizat → întâi funcția, apoi DROP.
-- Gardă: dacă rollback-ul c a rulat deja (funcția nu mai există), nu o recreăm.
DO $rollback$
BEGIN
  IF to_regprocedure('public.fn_admin_conturi_alerte()') IS NOT NULL THEN
    EXECUTE $def$
CREATE OR REPLACE FUNCTION public.fn_admin_conturi_alerte()
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Alertele de conturi sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT 'fara_angajat:' || p.id::text, 'fara_angajat'::text, p.id, COALESCE(u.email::text, p.email), p.tip_cont, p.is_owner,
         NULL::integer, NULL::text, NULL::boolean, NULL::date, u.banned_until, NULL::bigint, NULL::timestamptz,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'employee_name', c.employee_name,
                                                       'metoda', c.metoda, 'profil_legat', c.profil_legat)
                                    ORDER BY c.employee_id)
                     FROM public.fn_cont_candidati_angajat(u.email) c), '[]'::jsonb),
         NULL::jsonb
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.employee_id IS NULL AND COALESCE(p.tip_cont, 'angajat') = 'angajat'
   ORDER BY 1;
END $fn$
$def$;
    EXECUTE $g$REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon, service_role$g$;
    EXECUTE $g$GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated$g$;
  END IF;
END $rollback$;
DROP FUNCTION IF EXISTS public.fn_cont_cnp_normalizat(text);

DROP TABLE IF EXISTS public.conturi_inchideri_coada;
DROP TABLE IF EXISTS public.conturi_inchideri_jurnal;
DROP FUNCTION IF EXISTS public.fn_conturi_inchideri_append_only();
