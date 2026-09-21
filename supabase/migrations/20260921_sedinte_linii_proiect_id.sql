-- Linia de ședință își ține minte proiectul. Pasul 7 din tura de noapte („închide liniile
-- `lipsa:<camp>` ale proiectului") era inexecutabil: liniile n-aveau `proiect_id`, iar
-- `sedinte.proiect_id` e NULL pe ședințele GENERALE — care acoperă legitim mai multe proiecte.
--
-- Cauza reală, găsită pe 21.09.2026 în src/lib/verificariProiect.js: `consemneazaLipsuri`
-- PRIMEȘTE `proiectId`, îl folosește ca să calculeze lipsurile, și nu-l scrie în rând.
-- Referința exista în funcție și se pierdea la INSERT.
--
-- Al doilea efect, mai subtil: deduplicarea se face pe `cheie_verificare` per ȘEDINȚĂ. Într-o
-- ședință generală pe trei proiecte, al doilea „lipsa:rte_employee_id" era tăiat ca duplicat
-- deși era alt proiect — deci lipsurile a două proiecte din trei nu apăreau deloc.
--
-- Coloana stă pe LINIE, nu pe ședință: o ședință generală chiar acoperă mai multe proiecte.
-- Backfill 21.09.2026: 104 linii, din ședințele care au un singur proiect. Cele 61 rămase
-- (ședințe generale, de dinainte de fix) nu se pot atribui — textul nu numește proiectul.

ALTER TABLE public.sedinte_linii
  ADD COLUMN IF NOT EXISTS proiect_id bigint REFERENCES public.executie_proiecte(id);

COMMENT ON COLUMN public.sedinte_linii.proiect_id IS
  'Proiectul la care se referă linia. Se completează la generarea liniilor de lipsuri; pe ședințele dedicate unui proiect coincide cu sedinte.proiect_id, pe cele generale diferă de la linie la linie.';

CREATE INDEX IF NOT EXISTS idx_sedinte_linii_proiect
  ON public.sedinte_linii (proiect_id, cheie_verificare) WHERE proiect_id IS NOT NULL;
