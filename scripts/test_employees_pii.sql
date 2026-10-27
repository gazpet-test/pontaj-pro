-- Ruleaza numai pe fixture-ul PG17 izolat, dupa aplicarea migrarii.
BEGIN;
SET LOCAL ROLE authenticated;
DO $epi_test_marimi$
DECLARE who text; n integer; shoe text; clothing text;
BEGIN
  IF (SELECT proargnames FROM pg_proc WHERE oid='public.fn_employees_marimi(bigint[])'::regprocedure)
    IS DISTINCT FROM ARRAY['p_ids','id','marime_incaltaminte','marime_imbracaminte']::text[] THEN
    RAISE EXCEPTION 'RPC marimi expune alte coloane';
  END IF;
  FOREACH who IN ARRAY ARRAY['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008'] LOOP
    PERFORM set_config('request.jwt.claim.sub',who,true);
    SELECT marime_incaltaminte,marime_imbracaminte INTO shoe,clothing FROM public.fn_employees_marimi(ARRAY[1]::bigint[]);
    IF shoe IS DISTINCT FROM '42' OR clothing IS DISTINCT FROM 'L' THEN RAISE EXCEPTION 'Marimi autorizate lipsa'; END IF;
    SELECT count(*) INTO n FROM public.fn_employees_marimi(ARRAY[]::bigint[]);
    IF n<>0 THEN RAISE EXCEPTION 'Marimi ids goale expun date'; END IF;
    SELECT count(*) INTO n FROM public.fn_employees_marimi(ARRAY[987654]::bigint[]);
    IF n<>0 THEN RAISE EXCEPTION 'Marimi id inexistent'; END IF;
    SELECT count(*) INTO n FROM public.fn_employees_marimi();
    IF n<>1 THEN RAISE EXCEPTION 'Marimi DEFAULT NULL invalid'; END IF;
    BEGIN
      PERFORM marime_incaltaminte FROM public.employees WHERE id=1;
      RAISE EXCEPTION 'Marimi direct SELECT permis';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    IF right(who,1) IN ('6','7','8') THEN
      BEGIN
        PERFORM qr_pin FROM public.fn_employees_personal(ARRAY[1]::bigint[]);
        RAISE EXCEPTION 'Acces Magazie expune PIN';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END IF;
  END LOOP;
  -- Rol Magazie fara intrare explicita, modifier-only, alt modul, identitate NULL.
  FOREACH who IN ARRAY ARRAY['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000009',''] LOOP
    PERFORM set_config('request.jwt.claim.sub',who,true);
    BEGIN
      PERFORM * FROM public.fn_employees_marimi(NULL);
      RAISE EXCEPTION 'Marimi neautorizate permise';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'Acces refuzat la marimi EIP' THEN RAISE; END IF;
    END;
  END LOOP;
END $epi_test_marimi$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $epi_test_public$
DECLARE n integer; c text;
BEGIN
  SELECT count(*) INTO n FROM public.employees WHERE name='TEST ANGAJAT' AND functie='TEST';
  IF n<>1 THEN RAISE EXCEPTION 'name/functie nu sunt citibile'; END IF;
  IF (SELECT name FROM public.pii_safe_names WHERE id=1) IS DISTINCT FROM 'TEST ANGAJAT' THEN
    RAISE EXCEPTION 'View INVOKER public refuzat';
  END IF;
  FOREACH c IN ARRAY ARRAY['cnp','iban','adresa','data_nasterii','telefon','email','observatii_hr','qr_pin','qr_pin_active','qr_pin_creat_la','marime_incaltaminte','marime_imbracaminte','*'] LOOP
    BEGIN
      EXECUTE format('SELECT %s FROM public.employees WHERE id=1',CASE WHEN c='*' THEN '*' ELSE quote_ident(c) END);
      RAISE EXCEPTION 'SELECT personal permis: %',c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM * FROM public.fn_employees_personal(ARRAY[1]::bigint[]);
    RAISE EXCEPTION 'RPC non-HR permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.employees SET cnp='NU SE SCRIE' WHERE id=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'UPDATE non-autorizat permis'; END IF;
  BEGIN
    INSERT INTO public.employees(name,department,cnp) VALUES('REFUZAT','TEST','NU');
    RAISE EXCEPTION 'INSERT non-autorizat permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.employees SET cnp='NU' WHERE id=1 RETURNING cnp INTO c;
    RAISE EXCEPTION 'RETURNING personal non-HR permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $epi_test_public$;

-- Owner si HR cu drept explicit, nu prin numele rolului/department.
DO $epi_test_hr$
DECLARE who text; n integer; value text; returned integer;
BEGIN
  FOREACH who IN ARRAY ARRAY['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'] LOOP
    PERFORM set_config('request.jwt.claim.sub',who,true);
    SELECT cnp INTO value FROM public.fn_employees_personal(ARRAY[1]::bigint[]);
    IF value IS DISTINCT FROM 'FICTIV' THEN RAISE EXCEPTION 'RPC HR nu intoarce CNP'; END IF;
    SELECT count(*) INTO n FROM public.fn_employees_personal(ARRAY[]::bigint[]);
    IF n<>0 THEN RAISE EXCEPTION 'Lista ids goala expune date'; END IF;
    SELECT count(*) INTO n FROM public.fn_employees_personal(ARRAY[987654]::bigint[]);
    IF n<>0 THEN RAISE EXCEPTION 'ID inexistent'; END IF;
    UPDATE public.employees SET cnp='SCHIMBAT' WHERE id=1 RETURNING id INTO returned;
    IF returned<>1 THEN RAISE EXCEPTION 'UPDATE HR cu RETURNING id esuat'; END IF;
    SELECT cnp INTO value FROM public.fn_employees_personal(ARRAY[1]::bigint[]);
    IF value IS DISTINCT FROM 'SCHIMBAT' THEN RAISE EXCEPTION 'UPDATE HR neconfirmat prin RPC'; END IF;
    BEGIN
      UPDATE public.employees SET cnp='SCURGERE' WHERE id=1 RETURNING cnp INTO value;
      RAISE EXCEPTION 'RETURNING personal HR direct permis';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE 'UPDATE public.employees SET cnp=''SCURGERE'' WHERE id=1 RETURNING *';
      RAISE EXCEPTION 'RETURNING * permis';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.employees SET cnp='FICTIV' WHERE id=1;
    INSERT INTO public.employees(name,department,cnp) VALUES('HR INSERT','TEST','FICTIV') RETURNING id INTO returned;
    SELECT count(*) INTO n FROM public.fn_employees_personal(ARRAY[returned]::bigint[]);
    IF n<>1 THEN RAISE EXCEPTION 'INSERT HR cu RETURNING id esuat'; END IF;
  END LOOP;
  -- can_modify_employees singur pastreaza dreptul de scriere, nu primeste citire.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
  UPDATE public.employees SET cnp='DOAR SCRIERE' WHERE id=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Dreptul existent can_modify_employees a fost schimbat'; END IF;
  BEGIN
    PERFORM * FROM public.fn_employees_personal(ARRAY[1]::bigint[]);
    RAISE EXCEPTION 'can_modify_employees citeste personal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- HR doar citire nu obtine automat drept de modificare.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
  SELECT cnp INTO value FROM public.fn_employees_personal(ARRAY[1]::bigint[]);
  IF value IS DISTINCT FROM 'DOAR SCRIERE' THEN RAISE EXCEPTION 'HR doar citire refuzat'; END IF;
  UPDATE public.employees SET cnp='NU' WHERE id=1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'HR doar citire a scris'; END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM * FROM public.fn_employees_personal(NULL);
    RAISE EXCEPTION 'auth.uid NULL permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $epi_test_hr$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $epi_test_anon$
BEGIN
  BEGIN
    PERFORM * FROM public.fn_employees_marimi(NULL);
    RAISE EXCEPTION 'anon marimi EXECUTE permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.fn_employees_personal(NULL);
    RAISE EXCEPTION 'anon EXECUTE permis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $epi_test_anon$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $epi_test_service$
BEGIN
  IF (SELECT qr_pin FROM public.employees WHERE id=1) IS DISTINCT FROM '9876' THEN RAISE EXCEPTION 'service_role afectat'; END IF;
END $epi_test_service$;
-- Calea reala authenticated: rolul de scriere nu acorda copiere personala.
RESET ROLE;
INSERT INTO public.employees(id,name,department,active,termination_date,telefon,email,colaborare_externa_status)
VALUES (101,'TEST EXTERN MODIFIER','TEST',false,CURRENT_DATE-1,'TEL MODIFIER','modifier@example.invalid','accepta'),
       (102,'TEST EXTERN OWNER','TEST',false,CURRENT_DATE-1,'TEL OWNER',' owner@example.invalid ','accepta'),
       (103,'TEST EXTERN HR','TEST',false,CURRENT_DATE-1,'TEL HR','hr@example.invalid','refuza'),
       (104,'TEST EXTERN REFUZ','TEST',false,CURRENT_DATE-1,'TEL REFUZ','refuz@example.invalid','accepta'),
       (105,'TEST EXTERN LEGARE','TEST',false,CURRENT_DATE-1,'TEL SURSA','sursa@example.invalid','accepta');
INSERT INTO public.hr_personal_extern(id,nume,telefon,email) VALUES(9001,'EXTERN EXISTENT','TEL EXISTENT','existent@example.invalid');
SET LOCAL ROLE authenticated;
DO $epi_test_fost_extern$
DECLARE x bigint; y bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
  x := public.fn_fost_angajat_leaga_extern(101);
  IF NOT EXISTS(SELECT 1 FROM public.hr_personal_extern WHERE id=x AND telefon IS NULL AND email IS NULL
    AND fost_angajat_employee_id=101 AND activ IS TRUE) THEN RAISE EXCEPTION 'modifier copiaza personal sau pierde legatura'; END IF;
  y := public.fn_fost_angajat_leaga_extern(101);
  IF y IS DISTINCT FROM x THEN RAISE EXCEPTION 'idempotenta externa pierduta'; END IF;
  y := public.fn_fost_angajat_leaga_extern(105,9001);
  IF y<>9001 OR NOT EXISTS(SELECT 1 FROM public.hr_personal_extern WHERE id=9001
    AND fost_angajat_employee_id=105 AND telefon='TEL EXISTENT' AND email='existent@example.invalid') THEN
    RAISE EXCEPTION 'legarea explicita modifica contactele existente'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  x := public.fn_fost_angajat_leaga_extern(102);
  IF NOT EXISTS(SELECT 1 FROM public.hr_personal_extern WHERE id=x AND telefon='TEL OWNER' AND email='owner@example.invalid') THEN
    RAISE EXCEPTION 'owner nu copiaza'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
  x := public.fn_fost_angajat_leaga_extern(103);
  IF NOT EXISTS(SELECT 1 FROM public.hr_personal_extern WHERE id=x AND telefon='TEL HR' AND email='hr@example.invalid' AND activ IS FALSE) THEN
    RAISE EXCEPTION 'HR nu copiaza sau pierde activ'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
  BEGIN
    PERFORM public.fn_fost_angajat_leaga_extern(104);
    RAISE EXCEPTION 'HR doar citire a trecut poarta de scriere';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.fn_fost_angajat_leaga_extern(104);
    RAISE EXCEPTION 'identitate NULL acceptata';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $epi_test_fost_extern$;
RESET ROLE;
ROLLBACK;
\echo 'PASS employees_pii SQL'
