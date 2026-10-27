-- Ruleaza numai pe fixture-ul PG17 izolat, dupa aplicarea migrarii.
BEGIN;
SET LOCAL ROLE authenticated;
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
ROLLBACK;
\echo 'PASS employees_pii SQL'
