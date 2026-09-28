DROP POLICY IF EXISTS ofertare_pt_pachet_insert ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_insert ON public.ofertare_pt_pachet FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_pt_pachet_update ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_update ON public.ofertare_pt_pachet FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()) AND stare = 'propus') WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_pt_poarta_upd ON public.ofertare_pt_poarta FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_pt_poarta_del ON public.ofertare_pt_poarta FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
