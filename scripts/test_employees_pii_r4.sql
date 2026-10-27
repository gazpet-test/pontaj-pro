-- Fixture exclusiv local; toate mutatiile sunt anulate.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $test$
DECLARE col text; val text; n integer; new_id integer;
BEGIN
  -- Expected independent: toate cele 12 coloane din decizia personala.
  FOR col,val IN SELECT * FROM (VALUES
    ('cnp',quote_literal('ALT CNP')),('iban',quote_literal('ALT IBAN')),
    ('adresa',quote_literal('ALTA ADRESA')),('data_nasterii',quote_literal('2000-01-01')),
    ('telefon',quote_literal('ALT TEL')),('email',quote_literal('alt@example.invalid')),
    ('observatii_hr',quote_literal('ALTE NOTE')),('qr_pin',quote_literal('4321')),
    ('qr_pin_active','false'),('qr_pin_creat_la','now()'),
    ('marime_incaltaminte',quote_literal('44')),('marime_imbracaminte',quote_literal('XL'))
  ) v(c,v) LOOP
    BEGIN
      EXECUTE format('UPDATE public.employees SET %I=%s WHERE id=1',col,val);
      RAISE EXCEPTION 'UPDATE personal permis: %',col;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
    END;
    BEGIN
      EXECUTE format('INSERT INTO public.employees(name,department,%I) VALUES(''INSERT REFUZAT'',''TEST'',%s)',col,
        CASE WHEN col='qr_pin_active' THEN 'true' ELSE val END);
      RAISE EXCEPTION 'INSERT personal permis: %',col;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
    END;
  END LOOP;
  UPDATE public.employees SET name='NUME PUBLIC',functie='FUNCTIE PUBLICA' WHERE id=1 RETURNING id INTO new_id;
  IF new_id<>1 THEN RAISE EXCEPTION 'Scriere publica refuzata'; END IF;
  -- No-op pe un rand fara personal nu necesita privilegiu personal.
  INSERT INTO public.employees(name,department) VALUES('FARA PERSONAL','TEST') RETURNING id INTO new_id;
  BEGIN
    UPDATE public.employees SET cnp=NULL,qr_pin_active=false WHERE id=new_id;
    RAISE EXCEPTION 'No-op personal permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.employees SET name='FARA PERSONAL' WHERE id=new_id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'No-op refuzat'; END IF;
END $test$;
RESET ROLE;
-- auth.uid NULL, service_role si postgres: comportament server pastrat.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
UPDATE public.employees SET cnp='SERVICE',iban='SERVICE',qr_pin='0000' WHERE id=1;
INSERT INTO public.employees(name,department,cnp) VALUES('SERVER INSERT','TEST','SERVER');
DO $test$ BEGIN
  IF (SELECT cnp FROM public.employees WHERE id=1)<>'SERVICE' THEN RAISE EXCEPTION 'Service refuzat'; END IF;
END $test$;
RESET ROLE;
UPDATE public.employees SET cnp='POSTGRES' WHERE id=1;
INSERT INTO public.hr_personal_extern(id,nume) VALUES(9500,'CONTACT PUBLIC');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE who text; n integer; x bigint;
BEGIN
  FOREACH who IN ARRAY ARRAY['1','2','3','4','5','6'] LOOP
    PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-'||lpad(who,12,'0'),true);
    SELECT count(*) INTO n FROM public.hr_personal_extern WHERE id=9500;
    IF n<>1 THEN RAISE EXCEPTION 'SELECT extern refuzat'; END IF;
    UPDATE public.hr_personal_extern SET telefon='CONTACT MANUAL' WHERE id=9500;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>(CASE WHEN who IN ('2','3','4') THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'UPDATE extern drept incorect'; END IF;
    IF who IN ('2','3','4') THEN
      INSERT INTO public.hr_personal_extern(nume,telefon,email) VALUES('CONTACT '||who,'MANUAL','manual@example.invalid') RETURNING id INTO x;
      IF x IS NULL THEN RAISE EXCEPTION 'INSERT autorizat refuzat'; END IF;
    ELSE
      BEGIN
        INSERT INTO public.hr_personal_extern(nume) VALUES('REFUZ '||who);
        RAISE EXCEPTION 'INSERT extern neautorizat permis';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END IF;
  END LOOP;
END $test$;
ROLLBACK;
\echo PASS employees_pii r4 SQL
