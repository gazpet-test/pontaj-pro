-- P0.3 (audit Copilot, aprobat de Razvan 13.09.2026): ATRIBUIREA NU E CONFORMITATE.
-- Pana acum legatura cerinta -> capitol era binara: are capitol / n-are. Un text generic intr-un
-- capitol facea cerinta "verde". De acum o cerinta atribuita trece prin STARI, iar verde e doar
-- 'verificata' — cu om, data si versiunea capitolului la care s-a verificat.
--
-- Ce se REFOLOSESTE: confirmat_de / confirmat_la existau deja pe tabel (nefolosite) — devin
-- stampila de verificare. NU se adauga verificat_de/verificat_la in paralel.
-- fel='exceptat' ramane cum era (motiv obligatoriu prin CHECK): e "nu se aplica" al modulului.

ALTER TABLE public.ofertare_pt_legaturi
  ADD COLUMN IF NOT EXISTS stare text NOT NULL DEFAULT 'atribuita'
    CHECK (stare IN ('atribuita','redactata','dovedita','verificata','blocata')),
  ADD COLUMN IF NOT EXISTS locator_raspuns text,
  ADD COLUMN IF NOT EXISTS constatare text,
  ADD COLUMN IF NOT EXISTS severitate text CHECK (severitate IN ('info','minor','major','blocant')),
  -- versiunea capitolului la care s-a facut verificarea. Daca textul se schimba dupa, versiunea
  -- creste (trigger) si verificarea nu mai e a textului curent — baza pentru invalidare (P0.6).
  ADD COLUMN IF NOT EXISTS verificat_la_versiunea integer;

COMMENT ON COLUMN public.ofertare_pt_legaturi.confirmat_de IS 'Cine a VERIFICAT ca raspunsul satisface cerinta (stare=verificata). Refolosit din schema initiala, unde era nefolosit.';
COMMENT ON COLUMN public.ofertare_pt_legaturi.confirmat_la IS 'Cand s-a verificat. Obligatoriu la stare=verificata (CHECK).';

-- O verificare fara om si fara data nu e verificare. O blocare fara constatare nu spune nimic.
ALTER TABLE public.ofertare_pt_legaturi DROP CONSTRAINT IF EXISTS ofertare_pt_legaturi_stare_chk;
ALTER TABLE public.ofertare_pt_legaturi ADD CONSTRAINT ofertare_pt_legaturi_stare_chk CHECK (
  (stare <> 'verificata' OR (confirmat_de IS NOT NULL AND confirmat_la IS NOT NULL AND verificat_la_versiunea IS NOT NULL))
  AND (stare <> 'blocata' OR btrim(coalesce(constatare,'')) <> '')
);

-- DOVEZILE: ce document sustine raspunsul, si UNDE in el. Pagina locala (in anexa) si pagina
-- globala (in dosarul asamblat) sunt lucruri diferite — la Hoghilag opisul Delgaz trimite la
-- p. 293 locala = p. 940 globala. Offsetul e ajutor, nu adevar.
CREATE TABLE IF NOT EXISTS public.ofertare_pt_dovezi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legatura_id bigint NOT NULL REFERENCES public.ofertare_pt_legaturi(id) ON DELETE CASCADE,
  document_id bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  autorizatie_id bigint REFERENCES public.hr_autorizatii(id) ON DELETE SET NULL,
  doc_firma_id bigint REFERENCES public.documente_firma(id) ON DELETE SET NULL,
  fisier_path text,
  tip_dovada text NOT NULL CHECK (tip_dovada IN ('document_atribuire','autorizatie','document_firma','fisier','capitol')),
  document_revizie text,
  locator_local text,
  pagina_locala integer,
  pagina_globala integer,
  nota text,
  creat_de uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_dovezi_tinta_chk CHECK (
    (CASE WHEN document_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN autorizatie_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN doc_firma_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN fisier_path IS NOT NULL THEN 1 ELSE 0 END) = (CASE WHEN tip_dovada = 'capitol' THEN 0 ELSE 1 END))
);
CREATE INDEX IF NOT EXISTS ofertare_pt_dovezi_leg_idx ON public.ofertare_pt_dovezi (legatura_id);

ALTER TABLE public.ofertare_pt_dovezi ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_pt_dovezi TO authenticated;
GRANT ALL ON public.ofertare_pt_dovezi TO service_role;
DROP POLICY IF EXISTS ofertare_pt_dovezi_select ON public.ofertare_pt_dovezi;
CREATE POLICY ofertare_pt_dovezi_select ON public.ofertare_pt_dovezi FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_pt_dovezi_write ON public.ofertare_pt_dovezi;
CREATE POLICY ofertare_pt_dovezi_write ON public.ofertare_pt_dovezi FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
