-- TKT-2026-0215: tarif opțional, separat de calculele pe valoare_lei.
BEGIN;
ALTER TABLE public.contracte_terti
  ADD COLUMN tarif_valoare numeric,
  ADD COLUMN tarif_unitate text CHECK (tarif_unitate IN ('luna','ora','zi','buc','km','mc','ml','mp','alt')),
  ADD COLUMN tarif_moneda text DEFAULT 'RON' CHECK (tarif_moneda IN ('RON','EUR')),
  ADD COLUMN tarif_descriere text;
COMMIT;
