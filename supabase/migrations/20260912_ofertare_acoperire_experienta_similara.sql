-- Aplicate pe 12.09.2026 prin apply_migration. Pastrate aici pentru istoric.
-- Migrarile: ofertare_acoperire_experienta_similara + fn_ofertare_acoperire_rescrie_cu_experienta
--
-- De ce: la Racari, 5 din 11 goluri eliminatorii erau FALSE. Motivul AI-ului era „nu exista in
-- catalog contracte/PV de receptie" pentru lucrari cat. C conducte gaze — meseria firmei.
-- Catalogul avea doar 3 surse si nu includea `ofertare_experienta` (45 de lucrari).

ALTER TABLE public.ofertare_acoperire
  ADD COLUMN IF NOT EXISTS experienta_id bigint
    REFERENCES public.ofertare_experienta(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ofertare_acoperire.experienta_id IS
  'Lucrarea din ofertare_experienta pe care se sprijina acoperirea. La cerintele cu valoare CUMULATA se trece contractul principal, restul raman in referinta_text — cumulul propriu-zis se verifica de om.';

ALTER TABLE public.ofertare_acoperire DROP CONSTRAINT IF EXISTS ofertare_acoperire_mod_check;
ALTER TABLE public.ofertare_acoperire ADD CONSTRAINT ofertare_acoperire_mod_check
  CHECK (mod = ANY (ARRAY['firma','personal','partener','gol','nu_se_aplica','experienta']));

-- mod='experienta' fara experienta_id ar fi o afirmatie fara dovada.
ALTER TABLE public.ofertare_acoperire DROP CONSTRAINT IF EXISTS ofertare_acoperire_experienta_coerenta;
ALTER TABLE public.ofertare_acoperire ADD CONSTRAINT ofertare_acoperire_experienta_coerenta
  CHECK (mod <> 'experienta' OR experienta_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ofertare_acoperire_experienta ON public.ofertare_acoperire (experienta_id)
  WHERE experienta_id IS NOT NULL;

-- fn_ofertare_acoperire_rescrie: acelasi corp ca in migrarea din 12.09, plus `experienta_id`
-- in SELECT-ul din jsonb, in UPDATE si in INSERT. Fara asta, campul s-ar fi pierdut tacut —
-- exact tiparul de bug vanat toata ziua. Vezi migrarea aplicata pentru corpul complet.
