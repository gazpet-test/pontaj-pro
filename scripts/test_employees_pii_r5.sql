-- Date fictive, toate scrierile sunt anulate.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $test$
DECLARE statement text; n integer;
BEGIN
  -- Expected independent de implementare: corect/gresit/no-op au acelasi refuz.
  FOREACH statement IN ARRAY ARRAY[
    'UPDATE employees SET qr_pin=''9876'' WHERE id=1',
    'UPDATE employees SET qr_pin=''1234'' WHERE id=1',
    'UPDATE employees SET cnp=''FICTIV'' WHERE id=1',
    'UPDATE employees SET iban=''IBAN FICTIV'' WHERE id=1',
    'INSERT INTO employees(id,name,department) VALUES(1,''UPSERT'',''TEST'') ON CONFLICT(id) DO UPDATE SET cnp=''FICTIV'''
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Oracol permis';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
    END;
  END LOOP;
  UPDATE employees SET functie='PUBLIC R5' WHERE id=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'UPDATE public refuzat'; END IF;
END $test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE who text; n integer;
BEGIN
  FOREACH who IN ARRAY ARRAY['1','6','9'] LOOP
    PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-'||lpad(who,12,'0'),true);
    UPDATE employees SET marime_incaltaminte='44' WHERE id=1;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>0 THEN RAISE EXCEPTION 'RLS marimi neautorizate'; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
  UPDATE employees SET marime_incaltaminte='43' WHERE id=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'P fara W nu poate scrie marimi'; END IF;
END $test$;
RESET ROLE;
-- Viewer/fara Magazie cu W: refuz real al triggerului, nu doar zero randuri prin RLS.
UPDATE profiles SET can_modify_employees=true WHERE id IN (
  '00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000009');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE who text; n integer; shoe text;
BEGIN
  FOREACH who IN ARRAY ARRAY['7','8'] LOOP
    PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-'||lpad(who,12,'0'),true);
    -- Editor/admin fara W/P: RLS + trigger trebuie sa permita exact marimile.
    UPDATE employees SET marime_incaltaminte='44',marime_imbracaminte='XL' WHERE id=1;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Magazie fara W nu poate scrie marimi'; END IF;
    SELECT marime_incaltaminte INTO shoe FROM fn_employees_marimi(ARRAY[1]::bigint[]);
    IF shoe IS DISTINCT FROM '44' THEN RAISE EXCEPTION 'Marime nesalvata'; END IF;
    BEGIN
      UPDATE employees SET cnp='FICTIV' WHERE id=1;
      RAISE EXCEPTION 'Magazie a scris CNP';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE employees SET functie='INTERZIS' WHERE id=1;
      RAISE EXCEPTION 'Magazie a primit scriere publica';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  FOREACH who IN ARRAY ARRAY['4','6','9'] LOOP
    PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-'||lpad(who,12,'0'),true);
    BEGIN
      UPDATE employees SET marime_incaltaminte='44' WHERE id=1;
      RAISE EXCEPTION 'Marimi fara drept permise';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'Acces refuzat la modificarea datelor personale ale angajatului' THEN RAISE; END IF;
    END;
    BEGIN
      INSERT INTO employees(name,department,marime_incaltaminte) VALUES('REFUZ MARIMI','TEST','44');
      RAISE EXCEPTION 'INSERT marimi fara drept permis';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $test$;
RESET ROLE;
-- INSERT necesita in continuare O/W; marimile adauga predicatul EIP.
UPDATE profiles SET can_modify_employees=true WHERE id='00000000-0000-0000-0000-000000000007';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
INSERT INTO employees(name,department,marime_incaltaminte) VALUES('EDITOR INSERT','TEST','43');
ROLLBACK;
\echo PASS employees_pii r5 SQL
