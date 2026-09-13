-- P0.6 (audit Copilot): INVALIDARE PE DEPENDENTE. Nu se invalideaza tot proiectul; se invalideaza
-- exact ce depinde de ce s-a schimbat. Nici nu se pastreaza verde un control bazat pe date vechi.
--
-- Trei dependente, trei mecanisme:
--   1. capitol modificat -> verificarea cerintei nu mai e a textului curent.
--      DEJA acoperit fara trigger: view-ul compara verificat_la_versiunea cu k.versiune.
--   2. cerinta INLOCUITA de o clarificare (inlocuita_de IS NOT NULL) -> legaturile ei nu mai
--      inseamna nimic: cerinta noua e alt rand, cu propriile legaturi. Trigger: verificarea de pe
--      cerinta veche cade la 'atribuita', cu constatare scrisa (nu se sterge tacut).
--   3. documentul-dovada isi schimba revizia -> dovezile care pointau la revizia veche nu mai
--      sunt ale documentului curent. Trigger: legaturile lor cad din 'verificata'/'dovedita' la
--      'atribuita', cu constatare.

CREATE OR REPLACE FUNCTION public.fn_pt_invalideaza_la_inlocuire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.inlocuita_de IS NOT NULL AND OLD.inlocuita_de IS NULL THEN
    UPDATE public.ofertare_pt_legaturi
       SET stare = 'atribuita',
           verificat_la_versiunea = NULL,
           constatare = concat_ws(' | ', nullif(constatare, ''),
             format('INVALIDATA %s: cerinta a fost inlocuita prin clarificare (noua: #%s)', to_char(now(), 'DD.MM.YYYY'), NEW.inlocuita_de))
     WHERE cerinta_id = NEW.id AND fel = 'capitol' AND stare IN ('verificata', 'dovedita', 'redactata');
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.fn_pt_invalideaza_la_inlocuire() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_pt_invalideaza_la_inlocuire ON public.ofertare_cerinte;
CREATE TRIGGER trg_pt_invalideaza_la_inlocuire
  AFTER UPDATE OF inlocuita_de ON public.ofertare_cerinte
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_invalideaza_la_inlocuire();

CREATE OR REPLACE FUNCTION public.fn_pt_invalideaza_la_revizie_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.revizie IS DISTINCT FROM OLD.revizie THEN
    UPDATE public.ofertare_pt_legaturi l
       SET stare = 'atribuita',
           verificat_la_versiunea = NULL,
           constatare = concat_ws(' | ', nullif(l.constatare, ''),
             format('INVALIDATA %s: documentul-dovada „%s" a trecut de la rev. %s la rev. %s',
                    to_char(now(), 'DD.MM.YYYY'), left(NEW.nume_original, 60), coalesce(OLD.revizie, '-'), coalesce(NEW.revizie, '-')))
     WHERE l.fel = 'capitol' AND l.stare IN ('verificata', 'dovedita')
       AND EXISTS (SELECT 1 FROM public.ofertare_pt_dovezi d
                    WHERE d.legatura_id = l.id AND d.document_id = NEW.id
                      AND d.document_revizie IS DISTINCT FROM NEW.revizie);
  END IF;
  RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.fn_pt_invalideaza_la_revizie_document() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_pt_invalideaza_la_revizie_document ON public.ofertare_documente_atribuire;
CREATE TRIGGER trg_pt_invalideaza_la_revizie_document
  AFTER UPDATE OF revizie ON public.ofertare_documente_atribuire
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_invalideaza_la_revizie_document();
