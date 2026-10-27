-- Toate mutatiile sunt fixture-uri tranzactionale; markerul preceda ROLLBACK.
BEGIN;
CREATE SCHEMA portal_test;
GRANT USAGE ON SCHEMA portal_test TO supabase_auth_admin,teren;
CREATE FUNCTION portal_test.expect_hook(u uuid,expected text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $f$
DECLARE e jsonb; r jsonb;
BEGIN
 e:=jsonb_build_object('user_id',u,'claims',jsonb_build_object('sub',u,'role','authenticated',
   'app_metadata','{}'::jsonb),'authentication_method','token_refresh');
 r:=public.fn_auth_token_hook(e);
 IF expected='error' THEN
   IF r IS DISTINCT FROM '{"error":{"http_code":403,"message":"Cont neautorizat"}}'::jsonb THEN
     RAISE EXCEPTION 'hook expected generic 403, got %',r; END IF;
 ELSIF expected='erp' THEN
   IF r IS DISTINCT FROM e THEN RAISE EXCEPTION 'ERP changed'; END IF;
 ELSE
   IF r IS DISTINCT FROM jsonb_set(e,'{claims,role}','"teren"') THEN RAISE EXCEPTION 'teren bad claims: %',r; END IF;
 END IF;
END $f$;
REVOKE ALL ON FUNCTION portal_test.expect_hook(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_test.expect_hook(uuid,text) TO supabase_auth_admin;
DO $checks$
BEGIN
 IF (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'superuser masks grants'; END IF;
 IF public.fn_portal_porti_lipsa() <> '{}' THEN RAISE EXCEPTION 'initial gate'; END IF;
 IF (SELECT count(*) FROM public.conturi_tip) <> 5 OR (SELECT count(*) FROM public.conturi_teren) <> 3
  OR EXISTS (SELECT id FROM auth.users EXCEPT SELECT auth_user_id FROM public.conturi_tip)
  OR EXISTS (SELECT auth_user_id FROM public.conturi_tip EXCEPT SELECT id FROM auth.users) THEN RAISE EXCEPTION 'inventory'; END IF;
 IF (SELECT employee_id FROM public.conturi_teren WHERE auth_user_id='a2a3a7c3-b285-4306-8d5b-39749c2abb0c') IS NOT NULL
  THEN RAISE EXCEPTION 'invented employee'; END IF;
END $checks$;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('00000000-0000-0000-0000-000000000001','erp');
SELECT portal_test.expect_hook('00000000-0000-0000-0000-000000000002','erp');
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','teren');
SELECT portal_test.expect_hook('393709f9-bcb6-4ce5-ba22-2eca5c353f23','teren');
SELECT portal_test.expect_hook('a2a3a7c3-b285-4306-8d5b-39749c2abb0c','error');
SELECT portal_test.expect_hook('00000000-0000-0000-0000-000000000099','error');
DO $bad$
BEGIN
 IF public.fn_auth_token_hook('{"user_id":"bad","claims":{}}')->'error' IS NULL
  OR public.fn_auth_token_hook('{}')->'error' IS NULL
  OR public.fn_auth_token_hook('{"user_id":"44387376-e48c-44d5-a88b-752c653c5639","claims":null}')->'error' IS NULL THEN
  RAISE EXCEPTION 'malformed input accepted'; END IF;
END $bad$;
RESET ROLE;
SAVEPOINT missing;
DELETE FROM public.conturi_tip WHERE auth_user_id='44387376-e48c-44d5-a88b-752c653c5639';
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
DO $$ BEGIN IF NOT ('inventar identitati'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'missing set undetected'; END IF; END $$;
ROLLBACK TO missing;
SAVEPOINT same_count_wrong_set;
ALTER TABLE public.conturi_tip DROP CONSTRAINT conturi_tip_auth_user_id_fkey;
DELETE FROM public.conturi_tip WHERE auth_user_id='00000000-0000-0000-0000-000000000002';
INSERT INTO public.conturi_tip(auth_user_id,tip,sursa) VALUES('00000000-0000-0000-0000-000000000099','erp','fixture_orphan');
DO $$ BEGIN
 IF (SELECT count(*) FROM auth.users) <> (SELECT count(*) FROM public.conturi_tip)
   OR NOT ('inventar identitati'=ANY(public.fn_portal_porti_lipsa())) THEN
   RAISE EXCEPTION 'same count / different sets missed'; END IF;
END $$;
ROLLBACK TO same_count_wrong_set;
SAVEPOINT bad_type;
ALTER TABLE public.conturi_tip DROP CONSTRAINT conturi_tip_tip_check;
UPDATE public.conturi_tip SET tip='necunoscut' WHERE auth_user_id='44387376-e48c-44d5-a88b-752c653c5639';
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO bad_type;
SAVEPOINT no_teren;
DELETE FROM public.conturi_teren WHERE auth_user_id='44387376-e48c-44d5-a88b-752c653c5639';
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO no_teren;
SAVEPOINT revoked;
UPDATE public.conturi_teren SET stare='revocat' WHERE employee_id=55;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO revoked;
SAVEPOINT creating;
UPDATE public.conturi_teren SET stare='in_creare' WHERE employee_id=55;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO creating;
SAVEPOINT inactive;
UPDATE public.employees SET active=false WHERE id=55;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO inactive;
SAVEPOINT unknown_active;
UPDATE public.employees SET active=NULL WHERE id=55;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO unknown_active;
SAVEPOINT ended;
UPDATE public.employees SET termination_date=(now() AT TIME ZONE 'Europe/Bucharest')::date-1 WHERE id=55;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
UPDATE public.employees SET termination_date=(now() AT TIME ZONE 'Europe/Bucharest')::date WHERE id=55;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','teren');
RESET ROLE;
ROLLBACK TO ended;
-- Ban: numai rolul Auth poate modifica auth.users, ca in productie.
SAVEPOINT banned;
SET LOCAL ROLE supabase_auth_admin;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='44387376-e48c-44d5-a88b-752c653c5639';
SELECT portal_test.expect_hook('44387376-e48c-44d5-a88b-752c653c5639','error');
RESET ROLE;
ROLLBACK TO banned;
SAVEPOINT inaccessible;
REVOKE SELECT ON public.conturi_tip FROM supabase_auth_admin;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.expect_hook('00000000-0000-0000-0000-000000000001','error');
RESET ROLE;
ROLLBACK TO inaccessible;

-- (pe prod postgres nu poate da USAGE pe auth; identitatea teren vine din public.fn_portal_uid())
SELECT set_config('request.jwt.claims','{"sub":"44387376-e48c-44d5-a88b-752c653c5639","role":"teren"}',true);
SET LOCAL ROLE teren;
DO $client$
DECLARE t text; p record;
BEGIN
 IF public.fn_portal_uid() IS DISTINCT FROM '44387376-e48c-44d5-a88b-752c653c5639'::uuid THEN RAISE EXCEPTION 'bad client fixture'; END IF;
 BEGIN PERFORM auth.uid(); RAISE EXCEPTION 'teren reaches auth schema';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 FOREACH t IN ARRAY ARRAY['employees','profiles','user_module_access','facturi','contracte','conturi_tip','conturi_teren','conturi_tip_jurnal'] LOOP
   BEGIN
     EXECUTE format('SELECT * FROM public.%I',t);
     RAISE EXCEPTION 'table readable: %',t;
   EXCEPTION WHEN insufficient_privilege THEN
     IF SQLERRM NOT LIKE 'permission denied%' THEN RAISE; END IF;
   END;
 END LOOP;
 BEGIN UPDATE public.facturi SET suma=0 WHERE id=1; RAISE EXCEPTION 'client table update';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)
   VALUES('00000000-0000-0000-0000-000000000099','erp','forged');
   RAISE EXCEPTION 'client classification insert';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.fn_teren_eligibil('44387376-e48c-44d5-a88b-752c653c5639') IS NOT TRUE
   OR public.fn_teren_eligibil('393709f9-bcb6-4ce5-ba22-2eca5c353f23') IS NOT FALSE
   OR public.fn_teren_eligibil(NULL) IS NOT FALSE THEN RAISE EXCEPTION 'self check boundary'; END IF;
 FOR p IN SELECT pr.oid,pr.proname FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace
    WHERE n.nspname='public' AND has_function_privilege(current_user,pr.oid,'EXECUTE') LOOP
   IF p.proname NOT IN ('fn_teren_eligibil','fn_portal_uid') AND p.proname NOT IN
     ('portal_fixture_public_01','portal_fixture_public_02','portal_fixture_public_03','portal_fixture_public_04',
      'portal_fixture_public_05','portal_fixture_public_06','portal_fixture_public_07','portal_fixture_public_08',
      'portal_fixture_public_09','portal_fixture_public_10','portal_fixture_public_11','portal_fixture_public_12',
      'portal_fixture_public_13','portal_fixture_public_14','portal_fixture_public_15','portal_fixture_public_16',
      'portal_fixture_public_17','portal_fixture_public_18','portal_fixture_public_19','portal_fixture_public_20','portal_fixture_public_21') THEN
     RAISE EXCEPTION 'unexpected client function %',p.oid::regprocedure; END IF;
 END LOOP;
 BEGIN PERFORM public.fn_auth_token_hook('{}'); RAISE EXCEPTION 'client hook execute';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.fn_portal_porti_lipsa(); RAISE EXCEPTION 'client gate execute';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $client$;
RESET ROLE;
-- Demonstreaza ca fixture-urile sunt chiar deschise pentru authenticated.
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM public.employees) <> 2 THEN RAISE EXCEPTION 'fixture RLS not broad'; END IF; END $$;
RESET ROLE;
REVOKE USAGE ON SCHEMA auth FROM teren;
SAVEPOINT drift;
CREATE FUNCTION public.portal_bad_public() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
DO $$ BEGIN IF cardinality(public.fn_portal_porti_lipsa())=0 THEN RAISE EXCEPTION 'new public function missed'; END IF; END $$;
ROLLBACK TO drift;
SAVEPOINT grant_drift;
GRANT SELECT ON public.employees TO teren;
DO $$ BEGIN IF NOT ('relatie:employees'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'table grant missed'; END IF; END $$;
ROLLBACK TO grant_drift;
SAVEPOINT column_drift;
GRANT SELECT(cnp) ON public.employees TO teren;
DO $$ BEGIN IF NOT ('relatie:employees'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'column grant missed'; END IF; END $$;
ROLLBACK TO column_drift;
SAVEPOINT maintain_drift;
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'GRANT MAINTAIN ON public.employees TO teren';
    IF NOT ('relatie:employees'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'PG17 MAINTAIN missed'; END IF;
  ELSE RAISE NOTICE 'PG16: testul MAINTAIN sarit (privilegiul exista doar din PG17)';
  END IF;
END $$;
ROLLBACK TO maintain_drift;
SAVEPOINT membership_drift;
GRANT authenticated TO teren;
DO $$ BEGIN IF NOT ('teren membership'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'noninherited membership missed'; END IF; END $$;
ROLLBACK TO membership_drift;
SAVEPOINT public_sequence;
CREATE SEQUENCE public.portal_bad_sequence;
GRANT USAGE ON SEQUENCE public.portal_bad_sequence TO PUBLIC;
DO $$ BEGIN IF NOT ('secventa:portal_bad_sequence'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'public sequence missed'; END IF; END $$;
ROLLBACK TO public_sequence;
SAVEPOINT public_view;
CREATE VIEW public.portal_bad_view WITH (security_invoker=on) AS SELECT id FROM public.employees;
GRANT SELECT ON public.portal_bad_view TO PUBLIC;
DO $$ BEGIN IF NOT ('relatie:portal_bad_view'=ANY(public.fn_portal_porti_lipsa())) THEN RAISE EXCEPTION 'public view missed'; END IF; END $$;
ROLLBACK TO public_view;
DO $$ BEGIN
 BEGIN UPDATE public.conturi_tip_jurnal SET rol_sesiune='bad' WHERE id=1;
   RAISE EXCEPTION 'audit update allowed'; EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'PORTAL_AUDIT_APPEND_ONLY' THEN RAISE; END IF; END;
 BEGIN DELETE FROM public.conturi_tip_jurnal WHERE id=1;
   RAISE EXCEPTION 'audit delete allowed'; EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'PORTAL_AUDIT_APPEND_ONLY' THEN RAISE; END IF; END;
 BEGIN TRUNCATE public.conturi_tip_jurnal;
   RAISE EXCEPTION 'audit truncate allowed'; EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'PORTAL_AUDIT_APPEND_ONLY' THEN RAISE; END IF; END;
END $$;
SELECT 'PORTAL_E1_1A_TEST_END';
ROLLBACK;
