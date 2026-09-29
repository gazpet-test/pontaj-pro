-- ROLLBACK pentru 20260929d_conturi_inchidere_la_incetare.sql (rulat DUPĂ rollback-ul e, ÎNAINTE de c).
-- Idempotent. Conturile deja închise RĂMÂN închise (partea sigură): drepturile nu revin singure.
-- ⚠️ Se pierde jurnalul conturi_inchideri_jurnal (snapshot-urile de revenire):
--    exportă-l înainte în claude_context, cu confirmarea lui Răzvan.

DROP TRIGGER IF EXISTS trg_employees_zz_ciclu_cont ON public.employees;
DROP FUNCTION IF EXISTS public.fn_employees_ciclu_cont();
DROP FUNCTION IF EXISTS public.fn_cont_inchide_owner(uuid, text);
DROP FUNCTION IF EXISTS public.fn_cont_restaureaza(bigint, text);
DROP FUNCTION IF EXISTS public.fn_cont_stare_angajati();
DROP FUNCTION IF EXISTS public.fn_cont_inchide(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.fn_cont_flaguri();

-- fn_admin_conturi_alerte revine la corpul din migrarea c (doar cod='fara_angajat'); semnătura e aceeași,
-- deci view-ul v_admin_conturi_alerte rămâne valid.
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
END $fn$
$def$;
    EXECUTE $g$REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon$g$;
    EXECUTE $g$GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated, service_role$g$;
  END IF;
END $rollback$;

DROP TABLE IF EXISTS public.conturi_inchideri_jurnal;
DROP FUNCTION IF EXISTS public.fn_conturi_inchideri_append_only();
