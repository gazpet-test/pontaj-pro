-- Audit Ofertare R11 (28.09.2026): pachetul aprobat ≠ oferta efectiv depusă.
-- După aprobare (manifestul PT/borderou e imuabil), la pachet se pot ADĂUGA doar artefactele depunerii:
--   rol 'depus_final'  — fișierele exact cum au fost urcate în SEAP (PDF final / semnat), cu SHA-256;
--   rol 'dovada_seap'  — dovada depunerii (confirmarea / captura SEAP).
-- Trecerea aprobat → depus cere cel puțin câte unul din ambele și semnează depus_la. Nimic din manifestul
-- aprobat nu se poate schimba (UPDATE/DELETE pe fișiere rămân interzise).
DROP POLICY IF EXISTS ofertare_pt_pachet_fisiere_insert ON public.ofertare_pt_pachet_fisiere;
CREATE POLICY ofertare_pt_pachet_fisiere_insert ON public.ofertare_pt_pachet_fisiere FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()) AND EXISTS (
    SELECT 1 FROM public.ofertare_pt_pachet p WHERE p.id = ofertare_pt_pachet_fisiere.pachet_id
      AND (p.stare = 'propus' OR (p.stare = 'aprobat' AND ofertare_pt_pachet_fisiere.rol IN ('depus_final','dovada_seap')))));

CREATE OR REPLACE FUNCTION public.fn_pt_pachet_depus_verifica()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.stare = 'depus' AND OLD.stare IS DISTINCT FROM 'depus' THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = NEW.id AND f.rol = 'depus_final') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără fișierele efectiv depuse în SEAP (rol depus_final, cu SHA-256).' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = NEW.id AND f.rol = 'dovada_seap') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără dovada depunerii din SEAP (rol dovada_seap).' USING ERRCODE = 'P0001';
    END IF;
    NEW.depus_la := now();
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_pt_pachet_depus_verifica() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_pt_pachet_depus_verifica ON public.ofertare_pt_pachet;
CREATE TRIGGER trg_pt_pachet_depus_verifica BEFORE UPDATE OF stare ON public.ofertare_pt_pachet
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_pachet_depus_verifica();
