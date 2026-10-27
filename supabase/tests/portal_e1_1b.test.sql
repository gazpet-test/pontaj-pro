-- E1-1b: fixture-uri tranzactionale, fara date reale. Apelantii folosesc rolurile SQL reale.
BEGIN;
DO $$ BEGIN IF public.fn_portal_porti_lipsa_1b() <> '{}'::text[] THEN RAISE EXCEPTION 'Initial E1-1b gate'; END IF; END $$;
SAVEPOINT callee_drift;
-- handle_new_user -> fn_cont_candidati_angajat: schimbarea unui callee, fara schimbarea ACL, trebuie detectata.
CREATE OR REPLACE FUNCTION public.fn_cont_candidati_angajat(text)
RETURNS TABLE(employee_id integer,employee_name text,metoda text,profil_legat uuid)
LANGUAGE sql SET search_path TO 'public','pg_temp' AS $$
 SELECT 999::integer,'forged'::text,'forged'::text,NULL::uuid;
$$;
DO $$ BEGIN IF NOT ('1b amprenta DDL'=ANY(public.fn_portal_porti_lipsa_1b())) THEN RAISE EXCEPTION 'Callee drift missed'; END IF; END $$;
ROLLBACK TO callee_drift;
CREATE TEMP TABLE portal_test_saved_sequence AS SELECT last_value,is_called FROM public.user_module_access_id_seq;
CREATE SCHEMA portal_test;
GRANT USAGE ON SCHEMA portal_test TO authenticated,service_role,supabase_auth_admin,teren;
CREATE FUNCTION portal_test.expect_error(p_sql text,p_message text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $f$
BEGIN
 BEGIN
  EXECUTE p_sql;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM=p_message OR (p_message='permission denied' AND SQLSTATE='42501') THEN RETURN; END IF;
  RAISE EXCEPTION 'Expected %, got % [%]',p_message,SQLERRM,SQLSTATE;
 END;
 RAISE EXCEPTION 'Expected refusal: %',p_message;
END $f$;
CREATE FUNCTION portal_test.hook(p_uid uuid,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $f$
DECLARE r jsonb;
BEGIN
 r:=public.fn_auth_token_hook(jsonb_build_object('user_id',p_uid,'claims',
  jsonb_build_object('sub',p_uid,'role','authenticated')));
 IF p_role='error' THEN
  IF r IS DISTINCT FROM '{"error":{"http_code":403,"message":"Cont neautorizat"}}'::jsonb THEN
   RAISE EXCEPTION 'Expected hook refusal: %',r; END IF;
 ELSIF r#>>'{claims,role}' IS DISTINCT FROM p_role THEN RAISE EXCEPTION 'Wrong hook role: %',r;
 END IF;
END $f$;
REVOKE ALL ON FUNCTION portal_test.expect_error(text,text),portal_test.hook(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_test.expect_error(text,text) TO authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION portal_test.hook(uuid,text) TO supabase_auth_admin;
-- Observa prima scriere: ar esua inclusiv daca implementarea ar corecta ulterior manager_santier -> teren.
CREATE FUNCTION portal_test.no_privileged_window() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
 IF EXISTS (SELECT FROM auth.users WHERE id=NEW.id AND raw_app_meta_data->>'tip_cont'='teren')
  AND NEW.role IS DISTINCT FROM 'teren' THEN RAISE EXCEPTION 'Privileged terrain window'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER portal_test_no_window AFTER INSERT OR UPDATE ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION portal_test.no_privileged_window();
DO $$ BEGIN
 IF (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'Superuser hides ACL'; END IF;
 -- Triggerul observator de test este singura diferenta de DDL introdusa mai sus.
 IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('fn_portal_cont_pregateste','fn_portal_cont_finalizeaza','fn_cont_aproba_erp')
    AND has_function_privilege('teren',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Terrain RPC exposed'; END IF;
END $$;
INSERT INTO public.employees(id,name,active) VALUES
 (1001,'ȘERBAN ION MIHĂI',true),(1002,'ȘERBAN ION MIHĂI',true),
 (1003,'IONESCU VASILE',true),(1004,'POPESCU ANA',false),(1005,'SINGUR',true),
 (1006,'POPESCU MARIA',true);
UPDATE public.profiles SET is_owner=true WHERE id='00000000-0000-0000-0000-000000000001';
-- Rolul hr fara modul explicit nu confera dreptul; NULL uid este respins.
UPDATE public.profiles SET role='hr' WHERE id='00000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1001,'10000000-0000-0000-0000-000000000001')$$,'PORTAL_ACCESS_DENIED');
SELECT portal_test.expect_error($$SELECT public.fn_cont_aproba_erp('00000000-0000-0000-0000-000000000002','hr')$$,'PORTAL_ACCESS_DENIED');
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_finalizeaza('10000000-0000-0000-0000-000000000001')$$,'permission denied');
SELECT portal_test.expect_error('SELECT * FROM public.portal_provisioning','permission denied');
SELECT portal_test.expect_error('SELECT * FROM public.portal_provisioning_jurnal','permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1001,'10000000-0000-0000-0000-000000000001')$$,'PORTAL_ACCESS_DENIED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_portal_cont_pregateste(1001,'10000000-0000-0000-0000-000000000001');
SELECT public.fn_portal_cont_pregateste(1001,'10000000-0000-0000-0000-000000000001');
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1002,'10000000-0000-0000-0000-000000000001')$$,'PORTAL_KEY_CONFLICT');
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1001,'10000000-0000-0000-0000-000000000099')$$,'PORTAL_EMPLOYEE_UNAVAILABLE');
SELECT public.fn_portal_cont_pregateste(1002,'10000000-0000-0000-0000-000000000002');
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1004,'10000000-0000-0000-0000-000000000004')$$,'PORTAL_EMPLOYEE_UNAVAILABLE');
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(55,'10000000-0000-0000-0000-000000000055')$$,'PORTAL_EMPLOYEE_UNAVAILABLE');
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1005,'10000000-0000-0000-0000-000000000005')$$,'PORTAL_EMPLOYEE_NAME_INVALID');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT email_calculat FROM public.portal_provisioning WHERE employee_id=1001) IS DISTINCT FROM 'ion.mihai.serban@teren.gazpet.ro'
  OR (SELECT email_calculat FROM public.portal_provisioning WHERE employee_id=1002) IS DISTINCT FROM 'ion.mihai.serban.2@teren.gazpet.ro'
  OR (SELECT count(*) FROM public.portal_provisioning) <> 2 THEN RAISE EXCEPTION 'B email or idempotency'; END IF;
END $$;
-- Modulul exact hr permite pregatirea; un modul asemanator nu permite.
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES('00000000-0000-0000-0000-000000000002','hr_extra','editor');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_pregateste(1003,'10000000-0000-0000-0000-000000000003')$$,'PORTAL_ACCESS_DENIED');
RESET ROLE;
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES('00000000-0000-0000-0000-000000000002','hr','editor');
SET LOCAL ROLE authenticated;
SELECT public.fn_portal_cont_pregateste(1003,'10000000-0000-0000-0000-000000000003');
RESET ROLE;
-- INSERT Auth pe calea reala a triggerului, ca Auth Admin, nu apel direct handle_new_user.
SET LOCAL ROLE supabase_auth_admin;
DO $$ BEGIN
 BEGIN
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('20000000-0000-0000-0000-000000000098','ion.mihai.serban@teren.gazpet.ro',
   '{"tip_cont":"teren","employee_id":1002,"provisioning_id":"10000000-0000-0000-0000-000000000001"}');
  RAISE EXCEPTION 'Wrong employee accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'PORTAL_RESERVATION_INVALID' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('20000000-0000-0000-0000-000000000099','wrong@teren.gazpet.ro',
   '{"tip_cont":"teren","employee_id":1001,"provisioning_id":"10000000-0000-0000-0000-000000000001"}');
  RAISE EXCEPTION 'Metadata mismatch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'PORTAL_RESERVATION_INVALID' THEN RAISE; END IF; END;
END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('20000000-0000-0000-0000-000000000001','ion.mihai.serban@teren.gazpet.ro',
 '{"tip_cont":"teren","employee_id":1001,"provisioning_id":"10000000-0000-0000-0000-000000000001"}');
SELECT portal_test.hook('20000000-0000-0000-0000-000000000001','error');
INSERT INTO auth.users(id,email) VALUES('20000000-0000-0000-0000-000000000010','new.erp@example.invalid');
SELECT portal_test.hook('20000000-0000-0000-0000-000000000010','error');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT FROM auth.users WHERE id IN ('20000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000098'))
  OR NOT EXISTS (SELECT FROM public.profiles WHERE id='20000000-0000-0000-0000-000000000001' AND role='teren' AND employee_id=1001)
  OR NOT EXISTS (SELECT FROM public.profiles WHERE id='20000000-0000-0000-0000-000000000010' AND role='in_asteptare')
  OR EXISTS (SELECT FROM public.conturi_tip WHERE auth_user_id='20000000-0000-0000-0000-000000000010')
 THEN RAISE EXCEPTION 'Auth trigger not atomic or wrong profile'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT portal_test.expect_error($$SELECT public.fn_cont_aproba_erp('20000000-0000-0000-0000-000000000010','hr')$$,'PORTAL_ACCESS_DENIED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT portal_test.expect_error($$SELECT public.fn_cont_aproba_erp('20000000-0000-0000-0000-000000000001','hr')$$,'PORTAL_TARGET_CLASSIFIED');
SELECT portal_test.expect_error($$SELECT public.fn_cont_aproba_erp('20000000-0000-0000-0000-000000000010','teren')$$,'PORTAL_ROLE_INVALID');
SELECT portal_test.expect_error($$SELECT public.fn_cont_aproba_erp('29999999-0000-0000-0000-000000000099','hr')$$,'PORTAL_TARGET_INVALID');
SELECT public.fn_cont_aproba_erp('20000000-0000-0000-0000-000000000010','hr');
SELECT portal_test.expect_error($$SELECT public.fn_cont_aproba_erp('20000000-0000-0000-0000-000000000010','hr')$$,'PORTAL_TARGET_CLASSIFIED');
RESET ROLE;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.hook('20000000-0000-0000-0000-000000000010','authenticated');
RESET ROLE;
-- Postconditiile sunt testate si negativ: drept de modul prezent -> nicio jumatate finalizata.
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES('20000000-0000-0000-0000-000000000001','probe_teren','editor');
SET LOCAL ROLE service_role;
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_finalizeaza('10000000-0000-0000-0000-000000000001')$$,'PORTAL_FINALIZE_INVALID');
RESET ROLE;
DO $$ BEGIN IF (SELECT stare FROM public.portal_provisioning WHERE employee_id=1001) <> 'creat'
 OR (SELECT stare FROM public.conturi_teren WHERE employee_id=1001) <> 'in_creare' THEN RAISE EXCEPTION 'Partial finalize'; END IF; END $$;
DELETE FROM public.user_module_access WHERE profile_id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fn_portal_cont_finalizeaza('10000000-0000-0000-0000-000000000001');
SELECT public.fn_portal_cont_finalizeaza('10000000-0000-0000-0000-000000000001');
RESET ROLE;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.hook('20000000-0000-0000-0000-000000000001','teren');
RESET ROLE;
-- Reconcilierea dupa timeout intoarce UUID-ul Auth existent, fara alta rezervare/creare.
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.fn_portal_cont_pregateste(1001,'10000000-0000-0000-0000-000000000001');
 IF r->>'auth_user_id' IS DISTINCT FROM '20000000-0000-0000-0000-000000000001'
  OR r->>'stare' IS DISTINCT FROM 'finalizat' THEN RAISE EXCEPTION 'Bad reconciliation'; END IF;
END $$;
RESET ROLE;
SAVEPOINT active_account;
UPDATE public.employees SET termination_date=(now() AT TIME ZONE 'Europe/Bucharest')::date WHERE id=1001;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM public.conturi_teren WHERE employee_id=1001 AND stare='revocat'
 AND revocat_la IS NOT NULL AND revocat_motiv='incetare_contract') THEN RAISE EXCEPTION 'Today not revoked'; END IF; END $$;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.hook('20000000-0000-0000-0000-000000000001','error');
RESET ROLE;
UPDATE public.employees SET active=true,termination_date=NULL WHERE id=1001;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.hook('20000000-0000-0000-0000-000000000001','error');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT portal_test.expect_error($$SELECT public.fn_portal_cont_finalizeaza('10000000-0000-0000-0000-000000000001')$$,'PORTAL_FINALIZE_INVALID');
RESET ROLE;
ROLLBACK TO active_account;
UPDATE public.employees SET termination_date=(now() AT TIME ZONE 'Europe/Bucharest')::date-1 WHERE id=1001;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.hook('20000000-0000-0000-0000-000000000001','error');
RESET ROLE;
ROLLBACK TO active_account;
UPDATE public.employees SET active=NULL WHERE id=1001;
SET LOCAL ROLE supabase_auth_admin;
SELECT portal_test.hook('20000000-0000-0000-0000-000000000001','error');
RESET ROLE;
ROLLBACK TO active_account;
-- Angajatul pleaca intre rezervare si INSERT Auth: contul nu este creat, rezervarea ramane reconciliabila.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_portal_cont_pregateste(1006,'10000000-0000-0000-0000-000000000006');
RESET ROLE;
UPDATE public.employees SET active=false WHERE id=1006;
SET LOCAL ROLE supabase_auth_admin;
DO $$ BEGIN
 BEGIN
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('20000000-0000-0000-0000-000000000006','maria.popescu@teren.gazpet.ro',
   '{"tip_cont":"teren","employee_id":1006,"provisioning_id":"10000000-0000-0000-0000-000000000006"}');
  RAISE EXCEPTION 'Departed employee provisioned';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'PORTAL_RESERVATION_INVALID' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM public.conturi_tip_jurnal WHERE auth_user_id='20000000-0000-0000-0000-000000000010'
  AND nou->>'tip'='erp' AND autor='00000000-0000-0000-0000-000000000001')
  OR NOT EXISTS (SELECT FROM public.portal_provisioning_jurnal WHERE tabela='portal_provisioning' AND nou->>'stare'='finalizat')
 THEN RAISE EXCEPTION 'Missing audit'; END IF;
 BEGIN UPDATE public.portal_provisioning_jurnal SET tabela='forged' WHERE id>0;
  RAISE EXCEPTION 'Mutable audit'; EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'PORTAL_AUDIT_APPEND_ONLY' THEN RAISE; END IF; END;
END $$;
SELECT 'PORTAL_E1_1B_TEST_END';
-- Secventele nu sunt tranzactionale; restauram numai secventa fixture-ului efemer folosita de acest test.
SELECT setval('public.user_module_access_id_seq',last_value,is_called) FROM portal_test_saved_sequence;
ROLLBACK;
