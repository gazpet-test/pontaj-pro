-- TKT-2026-0077: permite contractele de comodat; fără modificări de date.
BEGIN;
ALTER TABLE public.contracte_terti DROP CONSTRAINT contracte_terti_tip_contract_check;
ALTER TABLE public.contracte_terti ADD CONSTRAINT contracte_terti_tip_contract_check
  CHECK (tip_contract IN ('asociere', 'subcontractare', 'prestari_servicii', 'furnizare_materiale', 'comodat'));
COMMIT;
