-- TKT-2026-0195 (aplicat ca cfl_cantitate_intrata_stoc): intrare incrementală în stoc la predări parțiale
ALTER TABLE public.comenzi_furnizor_linii ADD COLUMN cantitate_intrata_stoc numeric NOT NULL DEFAULT 0 CHECK (cantitate_intrata_stoc >= 0);
UPDATE public.comenzi_furnizor_linii l SET cantitate_intrata_stoc = COALESCE(l.cantitate_primita, l.cantitate, 0)
FROM public.comenzi_furnizor cf WHERE cf.id = l.comanda_furnizor_id AND cf.status = 'in_stoc';
-- ROLLBACK: ALTER TABLE public.comenzi_furnizor_linii DROP COLUMN cantitate_intrata_stoc;
