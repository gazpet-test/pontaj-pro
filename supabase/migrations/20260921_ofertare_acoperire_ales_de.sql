-- Proveniența alegerii: cine a pus `ales`, om sau motor.
--
-- De ce: pe 21.09.2026, `ales` era true pe 2233 din 2236 de rânduri — migrarea
-- `acoperire_candidati_multipli` îl backfill-ase pe tot ce exista, corect pentru
-- momentul în care fiecare cerință avea exact un rând. Efectul secundar: `ales`
-- nu mai poate distinge „motorul a propus asta" de „un om a ales asta".
-- Singura urmă a celor 5 alegeri manuale reale era text liber în `referinta_text`
-- („ales manual de Oana Nica · ..."), pe care nu se poate construi o poartă.
--
-- NULL = pus de motor. Non-NULL = un om a ales, și știm care.
-- Perechea lui e `verificat_de` / `raspuns_de`, care există deja cu același tipar.

ALTER TABLE public.ofertare_acoperire
  ADD COLUMN IF NOT EXISTS ales_de uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.ofertare_acoperire.ales_de IS
  'Cine a ales candidatul. NULL = propus de motorul AI. Non-NULL = alegere umană, protejată la rerularea motorului.';

-- Rândurile alese de om se citesc des la rescriere (poarta din RPC).
CREATE INDEX IF NOT EXISTS idx_acoperire_ales_de
  ON public.ofertare_acoperire (cerinta_id) WHERE ales_de IS NOT NULL;
