\set ON_ERROR_STOP on
-- Tot scenariul este anulat; rollback-ul de migrare se testeaza separat in shell.
BEGIN;
CREATE FUNCTION public.pt_assert(p_ok boolean,p_mesaj text) RETURNS void LANGUAGE plpgsql AS $pt_test_assert$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST: %',p_mesaj; END IF; END;
$pt_test_assert$;
CREATE FUNCTION public.pt_refuza(p_sql text,p_mesaj text) RETURNS void LANGUAGE plpgsql AS $pt_test_refuza$
DECLARE v_refuz boolean:=false;
BEGIN
 BEGIN EXECUTE p_sql;
 EXCEPTION WHEN OTHERS THEN
   IF position(p_mesaj IN SQLERRM)=0 THEN RAISE EXCEPTION 'TEST: asteptat %, primit %',p_mesaj,SQLERRM; END IF;
   v_refuz:=true;
 END;
 IF NOT v_refuz THEN RAISE EXCEPTION 'TEST: comanda acceptata, asteptat %',p_mesaj; END IF;
END;
$pt_test_refuza$;
GRANT EXECUTE ON FUNCTION public.pt_assert(boolean,text),public.pt_refuza(text,text) TO authenticated;
SELECT pt_assert((SELECT beneficiar_tip='gazpet' FROM probe_calcule WHERE id=900),'backfill proiect');
SELECT pt_assert((SELECT beneficiar_tip IS NULL FROM probe_calcule WHERE id=901),'istoric fara proiect');
INSERT INTO storage.objects SELECT 'probe-citiri','poze/'||i FROM generate_series(1,30) i;
INSERT INTO storage.objects VALUES('alt-bucket','gresit');
INSERT INTO probe_calcule(id,proiect_id,v_conducta_mc) SELECT i,1,10 FROM generate_series(1,12) i;
SELECT pt_refuza('INSERT INTO probe_calcule(id,beneficiar_tip) VALUES(20,''gazpet'')','probe_teren_beneficiar');
SELECT pt_refuza('INSERT INTO probe_calcule(id,beneficiar_tip,tert_client) VALUES(20,''tert'',''X'')','probe_teren_beneficiar');
SELECT pt_refuza('INSERT INTO probe_calcule(id) VALUES(20)','pt_beneficiar');
SELECT pt_refuza('INSERT INTO probe_calcule(id,tert_ref_tip,tert_ref_id,tert_client) VALUES(20,''oferta'',1,''X'')','pt_beneficiar');
SELECT pt_refuza('INSERT INTO probe_calcule(id,beneficiar_tip,tert_ref_tip,tert_ref_id,tert_client) VALUES(20,''tert'',''oferta'',999,''X'')','pt_beneficiar');
INSERT INTO probe_calcule(id,beneficiar_tip,tert_ref_tip,tert_ref_id,tert_client) VALUES(20,'tert','oferta',1,'X');
SELECT pt_assert(NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'owner NOSUPERUSER');
SELECT pt_assert(NOT has_function_privilege('authenticated','probe_teren_scrie(text,bigint,jsonb,text)','EXECUTE'),'dispatcher privat');
SELECT pt_assert(NOT has_function_privilege('anon','fn_probe_porneste(bigint,jsonb,numeric,text,text)','EXECUTE'),'anon fara RPC');
SELECT pt_assert(NOT has_function_privilege('service_role','fn_probe_porneste(bigint,jsonb,numeric,text,text)','EXECUTE'),'fara service_role');
SELECT pt_assert(NOT has_table_privilege('authenticated','logistica_active','SELECT'),'raport fara drept de Logistica');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pt_assert(NOT probe_teren_drept(true),'rol global nu acorda modul');
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule),'RLS calcule fara acces');
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'view fara acces');
SELECT pt_refuza($case_no_access$SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"poze/1"}]',1,'poze/2','start')$case_no_access$,'pt_acces');
SELECT pt_refuza('INSERT INTO probe_calcule(id,proiect_id) VALUES(50,1)','row-level security');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT pt_refuza($case_viewer$SELECT fn_probe_porneste(1,'[]',1,'poze/2','start')$case_viewer$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
SELECT pt_assert(probe_teren_drept(false) AND NOT probe_teren_drept(true),'admin probe doar citire');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pt_refuza('UPDATE probe_calcule SET status=''in_executie'' WHERE id=1','pt_rpc');
SELECT pt_refuza('INSERT INTO probe_log_executie(calc_id) VALUES(1)','pt_rpc');
SELECT pt_refuza($case_wrong_bucket$SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"gresit"}]',1,'poze/2','start')$case_wrong_bucket$,'pt_poza');
SELECT pt_refuza($case_missing_gauge$SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"poze/1"}]',1,NULL,'start')$case_missing_gauge$,'pt_poza');
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'pornire invalidata atomica');
SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"poze/1"}]',1,'poze/2','start') AS start_result \gset
SELECT pt_assert(fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"poze/1"}]',1,'poze/2','start')=:'start_result'::jsonb,'idempotenta pornire');
SELECT pt_assert((SELECT count(*)=1 FROM probe_exec_utilaje),'un singur interval');
SELECT pt_assert((SELECT ora_citire=now() AND creat_de=auth.uid() FROM probe_log_executie WHERE cheie='start'),'timestamp si autor server');
SELECT pt_refuza($case_key_conflict$SELECT fn_probe_porneste(1,'[]',2,'poze/2','start')$case_key_conflict$,'pt_cheie_conflict');
SELECT pt_refuza($case_start_twice$SELECT fn_probe_porneste(1,'[]',1,'poze/2','start2')$case_start_twice$,'pt_status');
SELECT pt_refuza($case_close_unstarted$SELECT fn_probe_inchide(2,'admis',1,'poze/2','[]',NULL,'early-close')$case_close_unstarted$,'pt_status');
SELECT pt_refuza($case_early$SELECT fn_probe_citire(1,1,'poze/2','[{"active_id":1,"ore_bord":100,"poza_path":"poze/1"}]',NULL,false,NULL,'read')$case_early$,'pt_citire_devreme');
SELECT pt_refuza($case_missing_active$SELECT fn_probe_inchide(1,'admis',2,'poze/2','[]',NULL,'close')$case_missing_active$,'pt_utilaje');
SELECT pt_refuza($case_decrease$SELECT fn_probe_opreste_utilaj(1,1,99,'poze/3','defect',NULL,NULL,'stop')$case_decrease$,'pt_bord_scade');
SELECT pt_refuza($case_jump$SELECT fn_probe_opreste_utilaj(1,1,6512,'poze/3','defect',NULL,NULL,'stop')$case_jump$,'pt_bord_salt');
SELECT pt_refuza($case_jump_real_time$SELECT fn_probe_opreste_utilaj(1,1,106,'poze/3','defect',NULL,NULL,'stop')$case_jump_real_time$,'pt_bord_salt');
SELECT pt_refuza($case_jump_reason$SELECT fn_probe_opreste_utilaj(1,1,130,'poze/3','defect',NULL,NULL,'stop',true,'')$case_jump_reason$,'pt_bord_salt');
SELECT pt_refuza($case_replace_atomic$SELECT fn_probe_opreste_utilaj(1,1,101,'poze/3','defect',NULL,'{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"lipsa"}','stop')$case_replace_atomic$,'pt_poza');
SELECT pt_assert((SELECT count(*)=1 FROM probe_exec_utilaje WHERE ora_stop IS NULL),'oprire anulata cu inlocuitor invalid');
SELECT fn_probe_opreste_utilaj(1,1,101,'poze/3','defect','Reparatie','{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"poze/4"}','stop') AS stop_result \gset
SELECT pt_assert(fn_probe_opreste_utilaj(1,1,101,'poze/3','defect','Reparatie','{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"poze/4"}','stop')=:'stop_result'::jsonb,'idempotenta oprire');
SELECT pt_refuza($case_stop_conflict$SELECT fn_probe_opreste_utilaj(1,1,102,'poze/3','defect',NULL,NULL,'stop')$case_stop_conflict$,'pt_cheie_conflict');
SELECT pt_assert((SELECT count(*)=1 FROM probe_exec_utilaje WHERE active_id=1 AND inlocuit_prin IS NOT NULL),'legatura inlocuire');
SELECT pt_refuza($case_cross_probe$SELECT fn_probe_porneste(2,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"poze/5"}]',1,'poze/2','other-start')$case_cross_probe$,'pt_bord_scade');
SELECT pt_refuza($case_busy$SELECT fn_probe_porneste(2,'[{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"poze/5"}]',1,'poze/2','other-start')$case_busy$,'pt_utilaj_ocupat');
SELECT pt_refuza('UPDATE probe_log_executie SET observatii=''corectie'' WHERE calc_id=1','pt_rpc');
SELECT pt_refuza('DELETE FROM probe_log_executie WHERE calc_id=1','pt_rpc');
SELECT pt_refuza('UPDATE probe_log_utilaje SET ore_bord=0 WHERE active_id=1','permission denied');
SELECT pt_refuza('DELETE FROM probe_exec_utilaje WHERE calc_id=1','permission denied');
SELECT pt_refuza('DELETE FROM probe_log_utilaje WHERE active_id=1','permission denied');
SELECT pt_refuza('DELETE FROM probe_teren_operatii WHERE cheie=''start''','permission denied');
-- Deplasare controlata DOAR in fixture, ca owner local, pentru ferestrele de 6/8 ore.
RESET ROLE;
UPDATE probe_log_executie SET ora_citire=now()-interval '9 hours' WHERE calc_id=1;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '9 hours',ora_stop=CASE WHEN ora_stop IS NOT NULL THEN now()-interval '9 hours' END WHERE calc_id=1;
SET LOCAL ROLE authenticated;
SELECT pt_refuza($case_no_item$SELECT fn_probe_citire(1,2,'poze/2','[]',NULL,false,NULL,'read')$case_no_item$,'pt_utilaje');
SELECT pt_refuza($case_read_jump$SELECT fn_probe_citire(1,2,'poze/2','[{"active_id":2,"ore_bord":131,"poza_path":"poze/6"}]',NULL,false,NULL,'read')$case_read_jump$,'pt_bord_salt');
SELECT fn_probe_citire(1,2,'poze/2','[{"active_id":2,"ore_bord":131,"poza_path":"poze/6"}]','Contor verificat',true,'Verificat mecanic','read') AS read_result \gset
SELECT pt_assert((:'read_result'::jsonb->>'intarziata')::boolean,'peste 8h acceptat si marcat');
SELECT pt_assert(fn_probe_citire(1,2,'poze/2','[{"active_id":2,"ore_bord":131,"poza_path":"poze/6"}]','Contor verificat',true,'Verificat mecanic','read')=:'read_result'::jsonb,'idempotenta citire inainte de regula 6h');
SELECT pt_refuza($case_read_conflict$SELECT fn_probe_citire(1,3,'poze/2','[]',NULL,false,NULL,'read')$case_read_conflict$,'pt_cheie_conflict');
-- Disparitia unei poze istorice blocheaza inchiderea, chiar daca finalul are poze.
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='probe-citiri' AND name='poze/1';
SET LOCAL ROLE authenticated;
SELECT pt_refuza($case_old_photo$SELECT fn_probe_inchide(1,'admis',3,'poze/7','[{"active_id":2,"ore_bord":132,"poza_path":"poze/8"}]','Confirm inchiderea','close')$case_old_photo$,'pt_poza');
SELECT pt_assert((SELECT status='in_executie' FROM probe_calcule WHERE id=1),'inchidere invalida fara efect');
RESET ROLE;
INSERT INTO storage.objects VALUES('probe-citiri','poze/1');
SET LOCAL ROLE authenticated;
SELECT fn_probe_inchide(1,'admis',3,'poze/7','[{"active_id":2,"ore_bord":132,"poza_path":"poze/8"}]','Confirm inchiderea','close') AS close_result \gset
SELECT pt_assert(fn_probe_inchide(1,'admis',3,'poze/7','[{"active_id":2,"ore_bord":132,"poza_path":"poze/8"}]','Confirm inchiderea','close')=:'close_result'::jsonb,'retry dupa finalizare');
SELECT pt_refuza($case_close_conflict$SELECT fn_probe_inchide(1,'respins',3,'poze/7','[]',NULL,'close')$case_close_conflict$,'pt_cheie_conflict');
SELECT pt_refuza($case_after_close$SELECT fn_probe_citire(1,3,'poze/2','[]',NULL,false,NULL,'after-close')$case_after_close$,'pt_status');
SELECT pt_assert((SELECT status='finalizata' AND durata_reala_h=9 FROM probe_calcule WHERE id=1),'durata din intervale');
SELECT pt_assert((SELECT numar_citiri=3 AND citiri_intarziate=1 AND utilaje_oprite_defect=1 FROM v_probe_raport WHERE calc_id=1),'agregare fara multiplicare join');
SELECT pt_assert((SELECT (utilaje->0->>'ore_lucrate')::numeric=1 AND (utilaje->1->>'litri_estimati')::numeric=320 FROM v_probe_raport WHERE calc_id=1),'ore si litri din contoare');
SELECT pt_assert((SELECT debit_real_estimat_mc_min>0 AND debit_mentiune LIKE 'indicativ%' FROM v_probe_raport WHERE calc_id=1),'debit indicativ');
-- Repetarea unui utilaj in aceeasi proba pastreaza intervale distincte.
SELECT fn_probe_porneste(3,'[{"active_id":3,"rol":"pompa","ore_bord":100,"poza_path":"poze/10"}]',1,'poze/2','repeat-start');
SELECT fn_probe_opreste_utilaj(3,3,101,'poze/11','inlocuit',NULL,'{"active_id":4,"rol":"pompa","ore_bord":100,"poza_path":"poze/12"}','repeat-stop1');
SELECT fn_probe_opreste_utilaj(3,4,101,'poze/13','inlocuit',NULL,'{"active_id":3,"rol":"pompa","ore_bord":101,"poza_path":"poze/14"}','repeat-stop2');
SELECT fn_probe_inchide(3,'respins',1,'poze/2','[{"active_id":3,"ore_bord":102,"poza_path":"poze/15"}]','Confirm','repeat-close');
SELECT pt_assert((SELECT count(*)=2 FROM probe_exec_utilaje WHERE calc_id=3 AND active_id=3),'doua intervale acelasi utilaj');
SELECT pt_assert((SELECT status='respinsa' FROM probe_calcule WHERE id=3),'rezultat respins');
-- Limitele ferestrei sunt inclusive: 6h si 8h nu sunt intarziate.
SELECT fn_probe_porneste(5,'[{"active_id":6,"rol":"compresor","ore_bord":100,"poza_path":"poze/20"}]',1,'poze/2','six-start');
SELECT fn_probe_porneste(6,'[{"active_id":7,"rol":"compresor","ore_bord":100,"poza_path":"poze/20"}]',1,'poze/2','eight-start');
RESET ROLE;
UPDATE probe_log_executie SET ora_citire=now()-interval '6 hours' WHERE calc_id=5;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '6 hours' WHERE calc_id=5;
UPDATE probe_log_executie SET ora_citire=now()-interval '8 hours' WHERE calc_id=6;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '8 hours' WHERE calc_id=6;
SET LOCAL ROLE authenticated;
SELECT pt_assert(NOT (fn_probe_citire(5,2,'poze/2','[{"active_id":6,"ore_bord":106,"poza_path":"poze/20"}]',NULL,false,NULL,'six-read')->>'intarziata')::boolean,'6h acceptat');
SELECT pt_assert(NOT (fn_probe_citire(6,2,'poze/2','[{"active_id":7,"ore_bord":108,"poza_path":"poze/20"}]',NULL,false,NULL,'eight-read')->>'intarziata')::boolean,'8h acceptat');
-- Confirmarea la pornire/inchidere este in utilajul JSON; la oprire este optionala in RPC.
SELECT pt_refuza($case_initial_jump$SELECT fn_probe_porneste(7,'[{"active_id":8,"rol":"compresor","ore_bord":130,"poza_path":"poze/20"}]',1,'poze/2','jump-start')$case_initial_jump$,'pt_bord_salt');
SELECT fn_probe_porneste(7,'[{"active_id":8,"rol":"compresor","ore_bord":130,"poza_path":"poze/20","confirma_salt":true,"motiv_salt":"Contor verificat"}]',1,'poze/2','jump-start');
SELECT pt_refuza($case_close_jump$SELECT fn_probe_inchide(7,'admis',2,'poze/2','[{"active_id":8,"ore_bord":160,"poza_path":"poze/20"}]',NULL,'jump-close')$case_close_jump$,'pt_bord_salt');
SELECT fn_probe_inchide(7,'admis',2,'poze/2','[{"active_id":8,"ore_bord":160,"poza_path":"poze/20","confirma_salt":true,"motiv_salt":"Contor verificat"}]','Confirm','jump-close');
SELECT fn_probe_porneste(8,'[{"active_id":9,"rol":"compresor","ore_bord":100,"poza_path":"poze/20"}]',1,'poze/2','jump-stop-start');
SELECT fn_probe_opreste_utilaj(8,9,130,'poze/20','terminat',NULL,NULL,'jump-stop',true,'Verificat mecanic');
SELECT fn_probe_inchide(8,'admis',2,'poze/2','[]','Confirm','all-stopped-close');
-- Owner fara intrare in modul poate scrie, anon/sub NULL nu poate.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pt_assert(probe_teren_drept(true),'owner bypass');
SELECT fn_probe_porneste(4,'[{"active_id":5,"rol":"booster","ore_bord":100,"poza_path":"poze/20"}]',1,'poze/2','owner-start');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'NULL uid fara citire');
SELECT pt_refuza($case_null_uid$SELECT fn_probe_porneste(5,'[]',1,'poze/2','null-uid')$case_null_uid$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'fara acces nu citeste intervale existente');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_utilaje),'fara acces nu citeste contoare existente');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_executie),'legacy log filtrat');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii),'audit filtrat');
SELECT pt_assert(probe_teren_norma(1) IS NULL,'fara modul nu citeste norma prin helper');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT pt_assert((SELECT count(*)>0 FROM probe_exec_utilaje),'viewer citeste');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
SELECT pt_assert((SELECT count(*)>0 FROM probe_exec_utilaje),'admin probe citeste');
RESET ROLE;
ROLLBACK;
\echo PASS probe_teren SQL: reguli business, RLS, RPC, atomicitate, idempotenta, raport
