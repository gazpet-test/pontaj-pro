-- Audit Ofertare R12 (restul, 28.09.2026): imuabilitatea pachetului și a porții PT.
--  * pachetul se INSEREAZĂ doar ca „propus", neaprobat (nu mai poate intra direct cu stare favorabilă);
--  * aprobarea (propus → aprobat) trebuie semnată de cel care o face: aprobat_de = auth.uid();
--  * ofertare_pt_poarta devine append-only (evaluările porții nu se mai pot modifica sau șterge;
--    UI-ul doar inserează — verificat în OfertarePropunere.jsx).
DROP POLICY IF EXISTS ofertare_pt_pachet_insert ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_insert ON public.ofertare_pt_pachet FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()) AND stare = 'propus' AND aprobat_de IS NULL AND aprobat_la IS NULL);
DROP POLICY IF EXISTS ofertare_pt_pachet_update ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_update ON public.ofertare_pt_pachet FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()) AND stare = 'propus')
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()) AND (stare = 'propus' OR (stare = 'aprobat' AND aprobat_de = auth.uid())));
DROP POLICY IF EXISTS ofertare_pt_poarta_upd ON public.ofertare_pt_poarta;
DROP POLICY IF EXISTS ofertare_pt_poarta_del ON public.ofertare_pt_poarta;
