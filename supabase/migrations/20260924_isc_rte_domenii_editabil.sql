-- 24.09.2026 (audit UI Ofertare pct. 7, aprobat de Răzvan): nomenclatorul domeniilor RTE devine editabil din
-- Ofertare → Referințe → 📚 Nomenclatoare. Scriere doar pentru cine are acces Ofertare (nu orice cont autentificat).
GRANT INSERT, UPDATE ON public.isc_rte_domenii TO authenticated;
DROP POLICY IF EXISTS isc_rte_domenii_insert_ofertare ON public.isc_rte_domenii;
DROP POLICY IF EXISTS isc_rte_domenii_update_ofertare ON public.isc_rte_domenii;
CREATE POLICY isc_rte_domenii_insert_ofertare ON public.isc_rte_domenii FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
CREATE POLICY isc_rte_domenii_update_ofertare ON public.isc_rte_domenii FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare())
  WITH CHECK (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
