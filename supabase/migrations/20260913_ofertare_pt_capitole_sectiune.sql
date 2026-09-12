-- ofertare_pt_capitole: sectiune + eticheta
--
-- De ce: opisul propunerii depuse la Contesti (distributie gaze, 1144 pag.) are
--   Sectiunea A ......... Cap. I ... Cap. VI
--   Sectiunea B, Planul calitatii ... Cap. I ... Cap. III
--   + ~20 de Anexe, printre care Graficul Gantt
-- Numerotarea SE REPETA intre sectiuni. Tabelul avea doar `nr`, unic per licitatie si
-- folosit si la afisare — deci doua capitole "Cap. I" nu incapeau deloc. Nu e un caz
-- exotic: opisul spune explicit ca structura vine din fisa de date, cap. 9 pct. 9.1,
-- deci difera de la o licitatie la alta si nu poate fi turnata intr-o numerotare unica.
--
-- Dupa migrarea asta:
--   nr       = doar ordinea in document (ramane unic per licitatie, ca sa nu existe doua
--              capitole pe aceeasi pozitie)
--   eticheta = ce scrie efectiv in opis: 'Cap. I', '4', 'Anexa 7'. Daca e NULL, UI-ul
--              afiseaza nr-ul, deci randurile vechi arata exact ca inainte.
--   sectiune = gruparea de deasupra capitolului: 'Sectiunea A', 'Anexe'. NULL = fara grupare.

ALTER TABLE public.ofertare_pt_capitole
  ADD COLUMN IF NOT EXISTS sectiune text,
  ADD COLUMN IF NOT EXISTS eticheta text;

COMMENT ON COLUMN public.ofertare_pt_capitole.sectiune IS
  'Gruparea de deasupra capitolului, asa cum apare in opis: "Sectiunea A", "Sectiunea B. Planul calitatii", "Anexe". NULL = structura plata.';
COMMENT ON COLUMN public.ofertare_pt_capitole.eticheta IS
  'Eticheta reala din opis: "Cap. I", "4", "Anexa 7". NULL = se afiseaza nr. Necesara fiindca numerotarea se repeta intre sectiuni.';
COMMENT ON COLUMN public.ofertare_pt_capitole.nr IS
  'Ordinea in document, NU eticheta. Unic per licitatie ca sa nu existe doua capitole pe aceeasi pozitie.';

-- Ambele NULL peste tot la aplicare: niciun rand existent nu-si schimba infatisarea.
-- Fara politici noi de RLS: coloane pe un tabel care are deja politicile lui.
