-- TKT-2026-0215: rulare manuală, doar după verificare și acord.
-- Protecție: nu ștergem coloane cu tarife deja completate.
BEGIN;
LOCK TABLE public.contracte_terti IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contracte_terti
    WHERE tarif_valoare IS NOT NULL OR tarif_unitate IS NOT NULL
      OR tarif_descriere IS NOT NULL OR tarif_moneda IS DISTINCT FROM 'RON') THEN
    RAISE EXCEPTION 'Rollback refuzat: există date de tarif. Exportați și rezolvați explicit datele înainte de eliminarea coloanelor.';
  END IF;
END $$;
ALTER TABLE public.contracte_terti
  DROP COLUMN tarif_valoare,
  DROP COLUMN tarif_unitate,
  DROP COLUMN tarif_moneda,
  DROP COLUMN tarif_descriere;
COMMIT;
