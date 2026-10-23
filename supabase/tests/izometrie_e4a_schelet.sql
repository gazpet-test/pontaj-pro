-- Only local fixture, after E3 skeleton and BEFORE applying any migration.
DO $$ BEGIN IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
ALTER TABLE public.executie_pachete_lansare
  ADD COLUMN status text NOT NULL DEFAULT 'draft', ADD COLUMN aprobat_la timestamptz,
  ADD COLUMN pdf_aprobare_path text, ADD COLUMN pdf_aprobare_nume text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.executie_tevi ADD COLUMN observatii text, ADD COLUMN pm_cod text,
  ADD COLUMN pa_ut_cod text, ADD COLUMN ut_cod text, ADD COLUMN tip_rand text NOT NULL DEFAULT 'teava',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN sarja text, ADD COLUMN lot text,
  ADD COLUMN lungime_originala_m numeric, ADD COLUMN tip text, ADD COLUMN dimensiune text, ADD COLUMN unghi_curba text;
CREATE TABLE public.executie_pachete_documente (
  id bigserial PRIMARY KEY,pachet_id bigint NOT NULL REFERENCES public.executie_pachete_lansare(id),
  tip_document text NOT NULL,fisier_path text NOT NULL,fisier_nume text,mime_type text
);
ALTER TABLE public.executie_pachete_documente ENABLE ROW LEVEL SECURITY;
CREATE POLICY epd_fixture ON public.executie_pachete_documente FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
