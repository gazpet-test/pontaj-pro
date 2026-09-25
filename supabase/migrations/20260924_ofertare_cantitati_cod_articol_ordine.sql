-- Aplicata prin MCP (apply_migration ofertare_cantitati_cod_articol_ordine, 24.09.2026).
-- F3 in BD: randurile din lista de cantitati (tip_sursa='lista_f3') poarta codul de articol si ordinea din document.
-- Identitatea ramane uq_ofertare_cantitati_sursa (licitatie_id, denumire, sursa): functia pune OBIECTUL si
-- CODUL in `sursa`, deci aceeasi denumire in obiecte diferite nu se contopeste. Nicio modificare pe randurile existente.
ALTER TABLE public.ofertare_cantitati ADD COLUMN IF NOT EXISTS cod_articol text, ADD COLUMN IF NOT EXISTS ordine int;
CREATE INDEX IF NOT EXISTS ofertare_cantitati_lic_obiect_ordine_idx ON public.ofertare_cantitati (licitatie_id, obiect, ordine);
