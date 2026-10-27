-- Stub ramas dupa revenire: numai rolul Auth real, fara tabelele portalului.
BEGIN;
SET LOCAL ROLE supabase_auth_admin;
DO $test$
DECLARE e jsonb; r jsonb;
BEGIN
 e := '{"user_id":"00000000-0000-0000-0000-000000000001","claims":{"role":"authenticated","email":"erp@example.invalid"}}';
 IF public.fn_auth_token_hook(e) IS DISTINCT FROM e THEN RAISE EXCEPTION 'stub changed ERP'; END IF;
 FOREACH e IN ARRAY ARRAY[
  '{"claims":{"email":"test@teren.gazpet.ro"}}'::jsonb,
  '{"claims":{"email":"TEST@TEREN.GAZPET.RO"}}'::jsonb,
  '{"claims":{"app_metadata":{"tip_cont":"teren"}}}'::jsonb,
  '{"app_metadata":{"tip_cont":"teren"}}'::jsonb
 ] LOOP
  r:=public.fn_auth_token_hook(e);
  IF r IS DISTINCT FROM '{"error":{"http_code":403,"message":"Cont neautorizat"}}'::jsonb THEN
   RAISE EXCEPTION 'stub accepted terrain'; END IF;
 END LOOP;
END $test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.fn_auth_token_hook('{}'); RAISE EXCEPTION 'stub exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
