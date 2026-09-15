-- Trasabilitate pe cheltuiala (15.09.2026, cerut de Razvan): cine a pornit citirea AI
-- a unui document si cand. Pana acum documentul retinea doar status_procesare, deci la
-- intrebarea "cine a pornit procesarea pe asta?" nu exista raspuns nicaieri.
-- Se completeaza in ofertare-ingest-doc, din identitatea deja verificata acolo:
--   - apel din browser  -> uid-ul din JWT
--   - apel din coada de server -> ofertare_ingest_coada.cerut_de (cine a apasat "Pe server")
-- Nu se ia niciodata din corpul cererii: clientul ar putea trimite orice.
-- procesat_la exista deja (PR #112, fisa de date citita cu AI pe formular); se adauga doar autorul.
ALTER TABLE public.ofertare_documente_atribuire
  ADD COLUMN IF NOT EXISTS procesat_de uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS procesat_la timestamptz;

COMMENT ON COLUMN public.ofertare_documente_atribuire.procesat_de IS
  'Cine a pornit citirea AI (din JWT sau din coada de server). Documentele citite inainte de 15.09.2026 au NULL.';
COMMENT ON COLUMN public.ofertare_documente_atribuire.procesat_la IS
  'Cand a inceput ultima citire AI a documentului.';
