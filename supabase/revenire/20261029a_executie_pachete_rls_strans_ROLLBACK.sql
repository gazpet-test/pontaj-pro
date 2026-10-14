-- Revenire 20261029a: policy-urile exact ca înainte (citite din pg_policies la 14.10.2026), apoi funcția se șterge.
DROP POLICY IF EXISTS executie_pachete_documente_select ON public.executie_pachete_documente;
DROP POLICY IF EXISTS executie_pachete_documente_insert ON public.executie_pachete_documente;
DROP POLICY IF EXISTS executie_pachete_documente_update ON public.executie_pachete_documente;
DROP POLICY IF EXISTS executie_pachete_documente_delete ON public.executie_pachete_documente;
CREATE POLICY executie_pachete_documente_select ON public.executie_pachete_documente FOR SELECT TO authenticated USING (true);
CREATE POLICY executie_pachete_documente_insert ON public.executie_pachete_documente FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY executie_pachete_documente_update ON public.executie_pachete_documente FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY executie_pachete_documente_delete ON public.executie_pachete_documente FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS executie_pachete_lansare_select ON public.executie_pachete_lansare;
DROP POLICY IF EXISTS executie_pachete_lansare_insert ON public.executie_pachete_lansare;
DROP POLICY IF EXISTS executie_pachete_lansare_update ON public.executie_pachete_lansare;
DROP POLICY IF EXISTS executie_pachete_lansare_delete ON public.executie_pachete_lansare;
CREATE POLICY executie_pachete_lansare_select ON public.executie_pachete_lansare FOR SELECT TO authenticated USING (true);
CREATE POLICY executie_pachete_lansare_modify ON public.executie_pachete_lansare FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS executie_pachete_pdf_select ON storage.objects;
DROP POLICY IF EXISTS executie_pachete_pdf_insert ON storage.objects;
DROP POLICY IF EXISTS executie_pachete_pdf_update ON storage.objects;
DROP POLICY IF EXISTS executie_pachete_pdf_delete ON storage.objects;
CREATE POLICY executie_pachete_pdf_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'executie-pachete-pdf');
CREATE POLICY executie_pachete_pdf_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'executie-pachete-pdf' AND auth.uid() IS NOT NULL);
CREATE POLICY executie_pachete_pdf_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'executie-pachete-pdf' AND auth.uid() IS NOT NULL) WITH CHECK (bucket_id = 'executie-pachete-pdf' AND auth.uid() IS NOT NULL);
CREATE POLICY executie_pachete_pdf_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'executie-pachete-pdf' AND auth.uid() IS NOT NULL);

DROP FUNCTION IF EXISTS public.fn_executie_pachete_acces(boolean);
