-- fn_are_acces_ofertare(uuid) primea un uuid, deci oricine logat putea interoga daca ALTCINEVA are
-- acces la modul. Varianta fara parametru citeste auth.uid() pe dinauntru: nu se mai poate sonda.
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$fn$;
COMMENT ON FUNCTION public.fn_are_acces_ofertare() IS
  'Acces la modulul Ofertare pentru utilizatorul curent: is_owner sau intrare explicita in user_module_access. Fara parametru, ca sa nu poata fi folosita ca sonda pe alte conturi. SECURITY DEFINER pentru ca profiles si user_module_access au RLS.';
REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;

ALTER POLICY ofertare_raspuns_set_citire ON public.ofertare_raspuns_set
  USING (public.fn_are_acces_ofertare());
ALTER POLICY ofertare_raspuns_set_doc_citire ON public.ofertare_raspuns_set_doc
  USING (public.fn_are_acces_ofertare());

DROP FUNCTION public.fn_are_acces_ofertare(uuid);
