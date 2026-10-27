BEGIN;
CREATE FUNCTION public.pii_test_transform() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.iban := 'PERSONAL DERIVAT'; RETURN NEW; END $$;
CREATE TRIGGER trg_employees_z_transform BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.pii_test_transform();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $$ BEGIN
  BEGIN
    UPDATE public.employees SET functie='PUBLIC' WHERE id=1;
    RAISE EXCEPTION 'Trigger anterior a ocolit poarta';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
