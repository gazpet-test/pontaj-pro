-- Rollback TKT-2026-0307 (pierde doar marcajul de arhivare, nu contractele).
DROP INDEX IF EXISTS public.contracte_terti_arhivat_idx;
ALTER TABLE public.contracte_terti
  DROP COLUMN IF EXISTS motiv_arhivare,
  DROP COLUMN IF EXISTS arhivat_de,
  DROP COLUMN IF EXISTS arhivat_la;
