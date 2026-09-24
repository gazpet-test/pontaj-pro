-- Documentele partenerilor (autorizații ISC, ISO, certificate legale, atestate, etalonări) — 24.09.2026
-- Fișierele stau în bucket-ul 'ofertare', path parteneri/<partener_id>/<timestamp>_<nume>.
CREATE TABLE IF NOT EXISTS public.ofertare_parteneri_documente (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partener_id       bigint NOT NULL REFERENCES public.ofertare_parteneri(id) ON DELETE CASCADE,
  categorie         text NOT NULL CHECK (categorie IN ('autorizatie_isc','iso','certificat_legal','atestat','etalonare','alta')),
  denumire          text NOT NULL,
  numar_document    text,
  emitent           text,
  data_emitere      date,
  data_valabilitate date,
  fara_expirare     boolean NOT NULL DEFAULT false,
  domeniu           text,
  fisier_path       text,
  observatii        text,
  creat_de          uuid DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ofertare_parteneri_documente_partener ON public.ofertare_parteneri_documente(partener_id);

COMMENT ON TABLE public.ofertare_parteneri_documente IS
  'Documentele partenerilor din Ofertare (autorizații ISC, certificate ISO, certificate legale, atestate, etalonări) — cu valabilitate și fișier în bucket-ul ofertare (parteneri/<partener_id>/...). Sursă viitoare pentru acoperirea cerințelor de calificare.';

ALTER TABLE public.ofertare_parteneri_documente ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_parteneri_documente TO authenticated;
GRANT ALL ON public.ofertare_parteneri_documente TO service_role;

CREATE POLICY ofertare_parteneri_documente_select ON public.ofertare_parteneri_documente
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_parteneri_documente_insert ON public.ofertare_parteneri_documente
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_parteneri_documente_update ON public.ofertare_parteneri_documente
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()))
  WITH CHECK (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_parteneri_documente_delete ON public.ofertare_parteneri_documente
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));

-- updated_at automat
CREATE OR REPLACE FUNCTION public.fn_ofertare_parteneri_documente_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_parteneri_documente_touch() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_ofertare_parteneri_documente_touch ON public.ofertare_parteneri_documente;
CREATE TRIGGER trg_ofertare_parteneri_documente_touch BEFORE UPDATE ON public.ofertare_parteneri_documente
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_parteneri_documente_touch();
