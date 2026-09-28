-- TKT-2026-0077: rulare manuală, doar după verificare și acord.
BEGIN;
LOCK TABLE public.contracte_terti IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contracte_terti WHERE tip_contract = 'comodat' OR categorie = 'comodat') THEN
    RAISE EXCEPTION 'Rollback refuzat: există contracte de comodat. Rezolvați explicit aceste contracte înainte de rollback.';
  END IF;
END $$;
ALTER TABLE public.contracte_terti DROP CONSTRAINT contracte_terti_tip_contract_check;
ALTER TABLE public.contracte_terti ADD CONSTRAINT contracte_terti_tip_contract_check
  CHECK (tip_contract IN ('asociere', 'subcontractare', 'prestari_servicii', 'furnizare_materiale'));
COMMIT;
