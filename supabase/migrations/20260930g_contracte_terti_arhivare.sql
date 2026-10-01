-- TKT-2026-0307 (rând tichete #331, 30.09.2026, varianta C aprobată de Răzvan):
-- arhivare REVERSIBILĂ a contractelor comerciale în loc de ștergere. Nimic nu se șterge:
-- liniile, actele adiționale, polițele, GBE-urile și facturile alocate rămân legate de contract.
-- Arhivat = arhivat_la IS NOT NULL. UI-ul ascunde implicit arhivatele (comutator „arată arhivate").
-- Drepturi: NU se adaugă nimic — e un UPDATE pe contracte_terti, acoperit de politicile existente
-- (update: is_owner / can_manage_contracts; UI-ul arată butonul doar acestora, ca la ✏️).
-- Idempotent (IF NOT EXISTS).

ALTER TABLE public.contracte_terti
  ADD COLUMN IF NOT EXISTS arhivat_la     timestamptz,
  ADD COLUMN IF NOT EXISTS arhivat_de     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motiv_arhivare text;

COMMENT ON COLUMN public.contracte_terti.arhivat_la IS
  'TKT-2026-0307: contract arhivat (ascuns implicit în Administrativ → Contracte). NULL = activ în listă. Reversibil.';
COMMENT ON COLUMN public.contracte_terti.arhivat_de IS 'TKT-2026-0307: cine a arhivat (auth.users.id).';
COMMENT ON COLUMN public.contracte_terti.motiv_arhivare IS 'TKT-2026-0307: motivul arhivării (opțional).';

CREATE INDEX IF NOT EXISTS contracte_terti_arhivat_idx
  ON public.contracte_terti (arhivat_la) WHERE arhivat_la IS NOT NULL;
