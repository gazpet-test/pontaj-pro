-- Audit Ofertare R05 (28.09.2026): clarificarea predepunere era prea grosieră — o întrebare, un răspuns,
-- iar asocierea documentului o trecea pe „raspunsa" (răspuns = rezoluție implicită). Acum: puncte per
-- clarificare, fiecare cu cerința atinsă (relație explicită), răspuns, și REZOLUȚIE separată
-- (deschis / rezolvat / partial / nerezolvat) cu documentul care a rezolvat efectiv problema.
-- Același model ca ofertare_solicitari_ac_puncte. „raspunsa" pe clarificare rămâne = am primit răspuns.
CREATE TABLE public.ofertare_clarificari_puncte (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clarificare_id     bigint NOT NULL REFERENCES public.ofertare_clarificari(id) ON DELETE CASCADE,
  nr                 integer NOT NULL DEFAULT 1,
  text               text NOT NULL CHECK (length(btrim(text)) > 0),
  cerinta_id         bigint REFERENCES public.ofertare_cerinte(id) ON DELETE SET NULL,
  raspuns            text,
  rezolutie          text NOT NULL DEFAULT 'deschis' CHECK (rezolutie IN ('deschis','rezolvat','partial','nerezolvat')),
  document_rezolutie_id bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  rezolutie_nota     text,
  rezolvat_de        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rezolvat_la        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (clarificare_id, nr)
);
CREATE INDEX ofertare_clarificari_puncte_cer_idx ON public.ofertare_clarificari_puncte (cerinta_id);
ALTER TABLE public.ofertare_clarificari_puncte ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_clarificari_puncte TO authenticated;
GRANT ALL ON public.ofertare_clarificari_puncte TO service_role;
REVOKE ALL ON public.ofertare_clarificari_puncte FROM anon;
CREATE POLICY clar_puncte_sel ON public.ofertare_clarificari_puncte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY clar_puncte_rw ON public.ofertare_clarificari_puncte FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
-- rezoluția e semnată: cine a marcat și când
CREATE OR REPLACE FUNCTION public.fn_clar_punct_semneaza()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ BEGIN
  IF NEW.rezolutie IS DISTINCT FROM COALESCE(OLD.rezolutie, 'deschis') THEN
    NEW.rezolvat_de := auth.uid(); NEW.rezolvat_la := CASE WHEN NEW.rezolutie = 'deschis' THEN NULL ELSE now() END;
  END IF; RETURN NEW; END $f$;
REVOKE EXECUTE ON FUNCTION public.fn_clar_punct_semneaza() FROM PUBLIC;
CREATE TRIGGER trg_clar_punct_semneaza BEFORE INSERT OR UPDATE ON public.ofertare_clarificari_puncte
  FOR EACH ROW EXECUTE FUNCTION public.fn_clar_punct_semneaza();
