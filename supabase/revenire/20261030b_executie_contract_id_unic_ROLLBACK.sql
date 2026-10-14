-- Revenire 20261030b: scoate indexul unic parțial pe executie_proiecte(contract_id). Nu atinge date.
-- După revenire, regula 1:1 contract ↔ proiect rămâne doar în UI (Administrativ + butonul „Leagă” din Execuție);
-- tratarea 23505 din UI devine inertă, nu strică nimic. Fără GO de execuție (vezi README).
DROP INDEX IF EXISTS public.executie_proiecte_contract_id_unic;

DO $post$
BEGIN
  IF to_regclass('public.executie_proiecte_contract_id_unic') IS NOT NULL THEN
    RAISE EXCEPTION 'POSTCONDIȚIE revenire 20261030b: indexul executie_proiecte_contract_id_unic există încă';
  END IF;
END $post$;
