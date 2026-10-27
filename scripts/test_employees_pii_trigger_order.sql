BEGIN;
CREATE FUNCTION public.pii_test_transform() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.functie='DERIVA' THEN NEW.iban := 'PERSONAL DERIVAT'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_employees_z_transform BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.pii_test_transform();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $$ DECLARE n integer; BEGIN
  UPDATE public.employees SET functie='PUBLIC LEGITIM' WHERE id=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'UPDATE public legitim refuzat'; END IF;
  BEGIN
    UPDATE public.employees SET functie='DERIVA' WHERE id=1;
    RAISE EXCEPTION 'Trigger anterior a ocolit poarta';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
