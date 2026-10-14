-- 20261029a — Strângere RLS + storage pe exporturile de izometrii (executie_pachete_*), decizia Răzvan 14.10.2026 (varianta A).
-- Înainte: orice utilizator autentificat putea citi, suprascrie și ȘTERGE pachetele, documentele (Centralizator Transgaz,
-- PDF aprobat) și fișierele din bucket-ul executie-pachete-pdf direct prin API; regula „doar managerul de proiect” era doar în UI.
-- După:
--   citire  = owner SAU intrare explicită 'executie' sau 'ctc' în user_module_access (CTC vede izometriile, PR #694);
--   scriere = owner SAU intrare explicită 'executie' (nu există coloană de manager de proiect pe executie_proiecte).
-- Triggerele SECURITY DEFINER și service_role nu sunt afectate. Revenire: supabase/revenire/20261029a_..._ROLLBACK.sql.

CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces(p_scriere boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u
               WHERE u.profile_id = auth.uid()
                 AND u.module = ANY (CASE WHEN p_scriere THEN ARRAY['executie'] ELSE ARRAY['executie', 'ctc'] END))
  )
$$;
REVOKE EXECUTE ON FUNCTION public.fn_executie_pachete_acces(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_pachete_acces(boolean) TO authenticated, service_role;

-- ── executie_pachete_documente ──
DROP POLICY IF EXISTS executie_pachete_documente_select ON public.executie_pachete_documente;
DROP POLICY IF EXISTS executie_pachete_documente_insert ON public.executie_pachete_documente;
DROP POLICY IF EXISTS executie_pachete_documente_update ON public.executie_pachete_documente;
DROP POLICY IF EXISTS executie_pachete_documente_delete ON public.executie_pachete_documente;
CREATE POLICY executie_pachete_documente_select ON public.executie_pachete_documente FOR SELECT TO authenticated
  USING ((SELECT public.fn_executie_pachete_acces(false)));
CREATE POLICY executie_pachete_documente_insert ON public.executie_pachete_documente FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_executie_pachete_acces(true)));
CREATE POLICY executie_pachete_documente_update ON public.executie_pachete_documente FOR UPDATE TO authenticated
  USING ((SELECT public.fn_executie_pachete_acces(true))) WITH CHECK ((SELECT public.fn_executie_pachete_acces(true)));
CREATE POLICY executie_pachete_documente_delete ON public.executie_pachete_documente FOR DELETE TO authenticated
  USING ((SELECT public.fn_executie_pachete_acces(true)));

-- ── executie_pachete_lansare ──
DROP POLICY IF EXISTS executie_pachete_lansare_select ON public.executie_pachete_lansare;
DROP POLICY IF EXISTS executie_pachete_lansare_modify ON public.executie_pachete_lansare;
CREATE POLICY executie_pachete_lansare_select ON public.executie_pachete_lansare FOR SELECT TO authenticated
  USING ((SELECT public.fn_executie_pachete_acces(false)));
CREATE POLICY executie_pachete_lansare_insert ON public.executie_pachete_lansare FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_executie_pachete_acces(true)));
CREATE POLICY executie_pachete_lansare_update ON public.executie_pachete_lansare FOR UPDATE TO authenticated
  USING ((SELECT public.fn_executie_pachete_acces(true))) WITH CHECK ((SELECT public.fn_executie_pachete_acces(true)));
CREATE POLICY executie_pachete_lansare_delete ON public.executie_pachete_lansare FOR DELETE TO authenticated
  USING ((SELECT public.fn_executie_pachete_acces(true)));

-- ── storage: bucket executie-pachete-pdf ──
DROP POLICY IF EXISTS executie_pachete_pdf_select ON storage.objects;
DROP POLICY IF EXISTS executie_pachete_pdf_insert ON storage.objects;
DROP POLICY IF EXISTS executie_pachete_pdf_update ON storage.objects;
DROP POLICY IF EXISTS executie_pachete_pdf_delete ON storage.objects;
CREATE POLICY executie_pachete_pdf_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'executie-pachete-pdf' AND (SELECT public.fn_executie_pachete_acces(false)));
CREATE POLICY executie_pachete_pdf_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'executie-pachete-pdf' AND (SELECT public.fn_executie_pachete_acces(true)));
CREATE POLICY executie_pachete_pdf_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'executie-pachete-pdf' AND (SELECT public.fn_executie_pachete_acces(true)))
  WITH CHECK (bucket_id = 'executie-pachete-pdf' AND (SELECT public.fn_executie_pachete_acces(true)));
CREATE POLICY executie_pachete_pdf_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'executie-pachete-pdf' AND (SELECT public.fn_executie_pachete_acces(true)));
