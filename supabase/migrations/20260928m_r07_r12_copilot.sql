-- Audit Ofertare, runda Copilot 28.09 (NO-GO pe R07 și R12):
-- R07: derogarea de la poarta de depunere NU mai are excepție pentru auth.uid() NULL (service_role
--      trecea fără owner). Excepție doar pentru sesiunea de administrare directă (postgres), nu pentru
--      niciun rol de API. Nicio funcție/endpoint din cod nu setează derogare_depunere (verificat).
-- R12: fișierele unui pachet APROBAT/DEPUS sunt imuabile și în Storage: UPDATE/DELETE pe un obiect
--      care apare în manifestul unui pachet aprobat/depus e refuzat, oricine ar fi utilizatorul —
--      hash-ul din manifest și bytes-ii din bucket nu mai pot diverge.
CREATE OR REPLACE FUNCTION public.fn_gate_depunere_derogare_owner()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT session_user = 'postgres' OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner) $f$;
REVOKE EXECUTE ON FUNCTION public.fn_gate_depunere_derogare_owner() FROM PUBLIC;

DO $mig$
DECLARE d text := pg_get_functiondef('public.fn_gate_depunere()'::regprocedure); o text;
BEGIN
  o := d;
  d := replace(d, $x$     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner) THEN$x$,
                  $x$     AND NOT public.fn_gate_depunere_derogare_owner() THEN$x$);
  IF d = o THEN RAISE EXCEPTION 'R07: forma funcției s-a schimbat — nimic aplicat'; END IF;
  EXECUTE d;
END $mig$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat(p_name text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f JOIN ofertare_pt_pachet p ON p.id = f.pachet_id
                       WHERE f.fisier_path = p_name AND p.stare IN ('aprobat','depus')) $f$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat(text) TO authenticated;

DROP POLICY IF EXISTS ofertare_storage_rw ON storage.objects;
CREATE POLICY ofertare_storage_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare());
CREATE POLICY ofertare_storage_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare());
CREATE POLICY ofertare_storage_upd ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare() AND NOT public.fn_ofertare_obiect_in_pachet_inghetat(name))
  WITH CHECK (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare() AND NOT public.fn_ofertare_obiect_in_pachet_inghetat(name));
CREATE POLICY ofertare_storage_del ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ofertare' AND public.fn_are_acces_ofertare() AND NOT public.fn_ofertare_obiect_in_pachet_inghetat(name));
