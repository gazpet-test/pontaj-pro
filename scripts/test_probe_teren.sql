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
INSERT INTO storage.objects
 SELECT 'probe-citiri','teren/'||c||'/'||a||'-'||i
 FROM generate_series(1,30) c CROSS JOIN unnest(ARRAY['porneste','citire','opreste_utilaj','inchide']) a CROSS JOIN generate_series(1,30) i;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
INSERT INTO storage.objects VALUES('alt-bucket','gresit');
INSERT INTO probe_calcule(id,proiect_id,v_conducta_mc) SELECT i,1,10 FROM generate_series(1,12) i;
SELECT pt_refuza('INSERT INTO probe_calcule(id,beneficiar_tip) VALUES(20,''gazpet'')','probe_teren_beneficiar');
SELECT pt_refuza('INSERT INTO probe_calcule(id,beneficiar_tip,tert_client) VALUES(20,''tert'',''X'')','probe_teren_beneficiar');
INSERT INTO probe_calcule(id) VALUES(21);
SELECT pt_assert((SELECT beneficiar_tip IS NULL FROM probe_calcule WHERE id=21),'calcul preliminar permis');
SELECT pt_refuza('INSERT INTO probe_calcule(id,tert_ref_tip,tert_ref_id,tert_client) VALUES(20,''oferta'',1,''X'')','probe_teren_beneficiar');
SELECT pt_refuza('INSERT INTO probe_calcule(id,beneficiar_tip,tert_ref_tip,tert_ref_id,tert_client) VALUES(20,''tert'',''oferta'',999,''X'')','pt_beneficiar');
INSERT INTO probe_calcule(id,beneficiar_tip,tert_ref_tip,tert_ref_id,tert_client) VALUES(20,'tert','oferta',1,'X');
SELECT pt_assert(NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'owner NOSUPERUSER');
SELECT pt_assert(NOT has_function_privilege('authenticated','probe_teren_scrie(text,bigint,jsonb,text)','EXECUTE'),'dispatcher privat');
SELECT pt_assert(NOT has_function_privilege('anon','fn_probe_porneste(bigint,jsonb,numeric,text,text)','EXECUTE'),'anon fara RPC');
SELECT pt_assert(NOT has_function_privilege('service_role','fn_probe_porneste(bigint,jsonb,numeric,text,text)','EXECUTE'),'fara service_role');
SELECT pt_assert(has_function_privilege('authenticated','fn_probe_completeaza_executie(bigint,bigint,numeric,text,text,text,timestamptz,text,text)','EXECUTE'),'authenticated poate apela completarea cu control in corp');
SELECT pt_assert(NOT has_function_privilege('anon','fn_probe_completeaza_executie(bigint,bigint,numeric,text,text,text,timestamptz,text,text)','EXECUTE'),'anon fara completare');
SELECT pt_assert(NOT has_function_privilege('service_role','fn_probe_completeaza_executie(bigint,bigint,numeric,text,text,text,timestamptz,text,text)','EXECUTE'),'service_role fara completare');
SELECT pt_assert(NOT has_table_privilege('authenticated','logistica_active','SELECT'),'raport fara drept de Logistica');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pt_assert(NOT probe_teren_drept(true),'rol global nu acorda modul');
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule),'RLS calcule fara acces');
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'view fara acces');
SELECT pt_refuza($case_no_access$SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/1/porneste-1"}]',1,'teren/1/porneste-2','start')$case_no_access$,'pt_acces');
SELECT pt_refuza('INSERT INTO probe_calcule(id,proiect_id) VALUES(50,1)','row-level security');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT pt_refuza($case_viewer$SELECT fn_probe_porneste(1,'[]',1,'teren/1/porneste-2','start')$case_viewer$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
SELECT pt_assert(NOT probe_teren_drept(false) AND NOT probe_teren_drept(true),'admin probe fara acces teren');
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule),'admin probe nu citeste calcule');
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'admin probe nu citeste raport');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii),'admin probe nu citeste payload-uri');
SELECT pt_refuza($case_legacy_admin$SELECT fn_probe_porneste(1,'[]',1,'teren/1/porneste-2','legacy-admin')$case_legacy_admin$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pt_refuza('UPDATE probe_calcule SET status=''in_executie'' WHERE id=1','pt_rpc');
SELECT pt_refuza('INSERT INTO probe_log_executie(calc_id) VALUES(1)','pt_rpc');
SELECT pt_refuza($case_wrong_bucket$SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"gresit"}]',1,'teren/1/porneste-2','start')$case_wrong_bucket$,'pt_poza');
SELECT pt_refuza($case_missing_gauge$SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/1/porneste-1"}]',1,NULL,'start')$case_missing_gauge$,'pt_poza');
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'pornire invalidata atomica');
SELECT fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/1/porneste-1"}]',1,'teren/1/porneste-2','start') AS start_result \gset
SELECT pt_assert(fn_probe_porneste(1,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/1/porneste-1"}]',1,'teren/1/porneste-2','start')=:'start_result'::jsonb,'idempotenta pornire');
SELECT pt_assert((SELECT count(*)=1 FROM probe_exec_utilaje),'un singur interval');
SELECT pt_assert((SELECT ora_citire=now() AND creat_de=auth.uid() FROM probe_log_executie WHERE cheie='start'),'timestamp si autor server');
SELECT pt_refuza($case_key_conflict$SELECT fn_probe_porneste(1,'[]',2,'teren/1/porneste-2','start')$case_key_conflict$,'pt_cheie_conflict');
SELECT pt_refuza($case_start_twice$SELECT fn_probe_porneste(1,'[]',1,'teren/1/porneste-2','start2')$case_start_twice$,'pt_status');
SELECT pt_refuza($case_close_unstarted$SELECT fn_probe_inchide(2,'admis',1,'teren/2/inchide-2','[]',NULL,'early-close')$case_close_unstarted$,'pt_status');
SELECT pt_refuza($case_early$SELECT fn_probe_citire(1,1,'teren/1/citire-2','[{"active_id":1,"ore_bord":100,"poza_path":"teren/1/citire-1"}]',NULL,false,NULL,'read')$case_early$,'pt_citire_devreme');
SELECT pt_refuza($case_missing_active$SELECT fn_probe_inchide(1,'admis',2,'teren/1/inchide-2','[]',NULL,'close')$case_missing_active$,'pt_utilaje');
SELECT pt_refuza($case_decrease$SELECT fn_probe_opreste_utilaj(1,1,99,'teren/1/opreste_utilaj-3','defect',NULL,NULL,'stop')$case_decrease$,'pt_bord_scade');
SELECT pt_refuza($case_jump$SELECT fn_probe_opreste_utilaj(1,1,6512,'teren/1/opreste_utilaj-3','defect',NULL,NULL,'stop')$case_jump$,'pt_bord_salt');
SELECT pt_refuza($case_jump_real_time$SELECT fn_probe_opreste_utilaj(1,1,106,'teren/1/opreste_utilaj-3','defect',NULL,NULL,'stop')$case_jump_real_time$,'pt_bord_salt');
SELECT pt_refuza($case_jump_reason$SELECT fn_probe_opreste_utilaj(1,1,130,'teren/1/opreste_utilaj-3','defect',NULL,NULL,'stop',true,'')$case_jump_reason$,'pt_bord_salt');
SELECT pt_refuza($case_replace_atomic$SELECT fn_probe_opreste_utilaj(1,1,101,'teren/1/opreste_utilaj-3','defect',NULL,'{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"lipsa"}','stop')$case_replace_atomic$,'pt_poza');
SELECT pt_assert((SELECT count(*)=1 FROM probe_exec_utilaje WHERE ora_stop IS NULL),'oprire anulata cu inlocuitor invalid');
SELECT fn_probe_opreste_utilaj(1,1,101,'teren/1/opreste_utilaj-3','defect','Reparatie','{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"teren/1/opreste_utilaj-4"}','stop') AS stop_result \gset
SELECT pt_assert(fn_probe_opreste_utilaj(1,1,101,'teren/1/opreste_utilaj-3','defect','Reparatie','{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"teren/1/opreste_utilaj-4"}','stop')=:'stop_result'::jsonb,'idempotenta oprire');
SELECT pt_refuza($case_stop_conflict$SELECT fn_probe_opreste_utilaj(1,1,102,'teren/1/opreste_utilaj-3','defect',NULL,NULL,'stop')$case_stop_conflict$,'pt_cheie_conflict');
SELECT pt_assert((SELECT count(*)=1 FROM probe_exec_utilaje WHERE active_id=1 AND inlocuit_prin IS NOT NULL),'legatura inlocuire');
SELECT pt_refuza($case_cross_probe$SELECT fn_probe_porneste(2,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/2/porneste-5"}]',1,'teren/2/porneste-2','other-start')$case_cross_probe$,'pt_bord_scade');
SELECT pt_refuza($case_busy$SELECT fn_probe_porneste(2,'[{"active_id":2,"rol":"compresor","ore_bord":100,"poza_path":"teren/2/porneste-5"}]',1,'teren/2/porneste-2','other-start')$case_busy$,'pt_utilaj_ocupat');
SELECT pt_refuza('UPDATE probe_log_executie SET observatii=''corectie'' WHERE calc_id=1','pt_rpc');
SELECT pt_refuza('DELETE FROM probe_log_executie WHERE calc_id=1','pt_rpc');
SELECT pt_refuza('UPDATE probe_log_utilaje SET ore_bord=0 WHERE active_id=1','permission denied');
SELECT pt_refuza('DELETE FROM probe_exec_utilaje WHERE calc_id=1','permission denied');
SELECT pt_refuza('DELETE FROM probe_log_utilaje WHERE active_id=1','permission denied');
SELECT pt_refuza('DELETE FROM probe_teren_operatii WHERE cheie=''start''','permission denied');
-- Deplasare controlata DOAR in fixture, ca owner local, pentru ferestrele de 6/8 ore.
RESET ROLE;
UPDATE probe_calcule SET ora_start=now()-interval '9 hours' WHERE id=1;
UPDATE probe_log_executie SET ora_citire=now()-interval '9 hours' WHERE calc_id=1;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '9 hours',ora_stop=CASE WHEN ora_stop IS NOT NULL THEN now()-interval '9 hours' END WHERE calc_id=1;
SET LOCAL ROLE authenticated;
SELECT pt_refuza($case_no_item$SELECT fn_probe_citire(1,2,'teren/1/citire-2','[]',NULL,false,NULL,'read')$case_no_item$,'pt_utilaje');
SELECT pt_refuza($case_read_reused_gauge$SELECT fn_probe_citire(1,2,'teren/1/porneste-2','[{"active_id":2,"ore_bord":101,"poza_path":"teren/1/citire-6"}]',NULL,false,NULL,'read-reuse')$case_read_reused_gauge$,'pt_poza_reutilizata');
SELECT pt_refuza($case_read_reused_asset$SELECT fn_probe_citire(1,2,'teren/1/citire-2','[{"active_id":2,"ore_bord":101,"poza_path":"teren/1/opreste_utilaj-4"}]',NULL,false,NULL,'read-reuse')$case_read_reused_asset$,'pt_poza_reutilizata');
SELECT pt_refuza($case_read_jump$SELECT fn_probe_citire(1,2,'teren/1/citire-2','[{"active_id":2,"ore_bord":131,"poza_path":"teren/1/citire-6"}]',NULL,false,NULL,'read')$case_read_jump$,'pt_bord_salt');
SELECT fn_probe_citire(1,2,'teren/1/citire-2','[{"active_id":2,"ore_bord":131,"poza_path":"teren/1/citire-6"}]','Contor verificat',true,'Verificat mecanic','read') AS read_result \gset
SELECT pt_assert((:'read_result'::jsonb->>'intarziata')::boolean,'peste 8h acceptat si marcat');
SELECT pt_assert(fn_probe_citire(1,2,'teren/1/citire-2','[{"active_id":2,"ore_bord":131,"poza_path":"teren/1/citire-6"}]','Contor verificat',true,'Verificat mecanic','read')=:'read_result'::jsonb,'idempotenta citire inainte de regula 6h');
SELECT pt_refuza($case_read_conflict$SELECT fn_probe_citire(1,3,'teren/1/citire-2','[]',NULL,false,NULL,'read')$case_read_conflict$,'pt_cheie_conflict');
-- Disparitia unei poze istorice blocheaza inchiderea, chiar daca finalul are poze.
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='probe-citiri' AND name='teren/1/porneste-1';
SET LOCAL ROLE authenticated;
SELECT pt_refuza($case_old_photo$SELECT fn_probe_inchide(1,'admis',3,'teren/1/inchide-7','[{"active_id":2,"ore_bord":132,"poza_path":"teren/1/inchide-8"}]','Confirm inchiderea','close')$case_old_photo$,'pt_poza');
SELECT pt_assert((SELECT status='in_executie' FROM probe_calcule WHERE id=1),'inchidere invalida fara efect');
RESET ROLE;
INSERT INTO storage.objects VALUES('probe-citiri','teren/1/porneste-1');
SET LOCAL ROLE authenticated;
SELECT fn_probe_inchide(1,'admis',3,'teren/1/inchide-7','[{"active_id":2,"ore_bord":132,"poza_path":"teren/1/inchide-8"}]','Confirm inchiderea','close') AS close_result \gset
SELECT pt_assert(fn_probe_inchide(1,'admis',3,'teren/1/inchide-7','[{"active_id":2,"ore_bord":132,"poza_path":"teren/1/inchide-8"}]','Confirm inchiderea','close')=:'close_result'::jsonb,'retry dupa finalizare');
SELECT pt_refuza($case_close_conflict$SELECT fn_probe_inchide(1,'respins',3,'teren/1/inchide-7','[]',NULL,'close')$case_close_conflict$,'pt_cheie_conflict');
SELECT pt_refuza($case_after_close$SELECT fn_probe_citire(1,3,'teren/1/citire-2','[]',NULL,false,NULL,'after-close')$case_after_close$,'pt_status');
SELECT pt_assert((SELECT status='finalizata' AND durata_reala_h=9 FROM probe_calcule WHERE id=1),'durata pana la inchidere');
SELECT pt_assert((SELECT numar_citiri=3 AND citiri_intarziate=1 AND utilaje_oprite_defect=1 FROM v_probe_raport WHERE calc_id=1),'agregare fara multiplicare join');
SELECT pt_assert((SELECT (utilaje->0->>'ore_lucrate')::numeric=1 AND (utilaje->1->>'litri_estimati')::numeric=320 FROM v_probe_raport WHERE calc_id=1),'ore si litri din contoare');
SELECT pt_assert((SELECT debit_real_estimat_mc_min>0 AND debit_mentiune LIKE 'indicativ%' FROM v_probe_raport WHERE calc_id=1),'debit indicativ');
-- Repetarea unui utilaj in aceeasi proba pastreaza intervale distincte.
SELECT fn_probe_porneste(3,'[{"active_id":3,"rol":"pompa","ore_bord":100,"poza_path":"teren/3/porneste-10"}]',1,'teren/3/porneste-2','repeat-start');
SELECT fn_probe_opreste_utilaj(3,3,101,'teren/3/opreste_utilaj-11','inlocuit',NULL,'{"active_id":4,"rol":"pompa","ore_bord":100,"poza_path":"teren/3/opreste_utilaj-12"}','repeat-stop1');
SELECT fn_probe_opreste_utilaj(3,4,101,'teren/3/opreste_utilaj-13','inlocuit',NULL,'{"active_id":3,"rol":"pompa","ore_bord":101,"poza_path":"teren/3/opreste_utilaj-14"}','repeat-stop2');
SELECT fn_probe_inchide(3,'respins',1,'teren/3/inchide-2','[{"active_id":3,"ore_bord":102,"poza_path":"teren/3/inchide-15"}]','Confirm','repeat-close');
SELECT pt_assert((SELECT count(*)=2 FROM probe_exec_utilaje WHERE calc_id=3 AND active_id=3),'doua intervale acelasi utilaj');
SELECT pt_assert((SELECT status='respinsa' FROM probe_calcule WHERE id=3),'rezultat respins');
-- Limitele ferestrei sunt inclusive: 6h si 8h nu sunt intarziate.
SELECT fn_probe_porneste(5,'[{"active_id":6,"rol":"compresor","ore_bord":100,"poza_path":"teren/5/porneste-20"}]',1,'teren/5/porneste-2','six-start');
SELECT fn_probe_porneste(6,'[{"active_id":7,"rol":"compresor","ore_bord":100,"poza_path":"teren/6/porneste-20"}]',1,'teren/6/porneste-2','eight-start');
RESET ROLE;
UPDATE probe_log_executie SET ora_citire=now()-interval '6 hours' WHERE calc_id=5;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '6 hours' WHERE calc_id=5;
UPDATE probe_log_executie SET ora_citire=now()-interval '8 hours' WHERE calc_id=6;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '8 hours' WHERE calc_id=6;
SET LOCAL ROLE authenticated;
SELECT pt_assert(NOT (fn_probe_citire(5,2,'teren/5/citire-2','[{"active_id":6,"ore_bord":106,"poza_path":"teren/5/citire-20"}]',NULL,false,NULL,'six-read')->>'intarziata')::boolean,'6h acceptat');
SELECT pt_assert(NOT (fn_probe_citire(6,2,'teren/6/citire-2','[{"active_id":7,"ore_bord":108,"poza_path":"teren/6/citire-20"}]',NULL,false,NULL,'eight-read')->>'intarziata')::boolean,'8h acceptat');
-- Confirmarea la pornire/inchidere este in utilajul JSON; la oprire este optionala in RPC.
SELECT pt_refuza($case_initial_jump$SELECT fn_probe_porneste(7,'[{"active_id":8,"rol":"compresor","ore_bord":130,"poza_path":"teren/7/porneste-20"}]',1,'teren/7/porneste-2','jump-start')$case_initial_jump$,'pt_bord_salt');
SELECT fn_probe_porneste(7,'[{"active_id":8,"rol":"compresor","ore_bord":130,"poza_path":"teren/7/porneste-20","confirma_salt":true,"motiv_salt":"Contor verificat"}]',1,'teren/7/porneste-2','jump-start');
SELECT pt_refuza($case_close_jump$SELECT fn_probe_inchide(7,'admis',2,'teren/7/inchide-2','[{"active_id":8,"ore_bord":160,"poza_path":"teren/7/inchide-20"}]',NULL,'jump-close')$case_close_jump$,'pt_bord_salt');
SELECT fn_probe_inchide(7,'admis',2,'teren/7/inchide-2','[{"active_id":8,"ore_bord":160,"poza_path":"teren/7/inchide-20","confirma_salt":true,"motiv_salt":"Contor verificat"}]','Confirm','jump-close');
SELECT fn_probe_porneste(8,'[{"active_id":9,"rol":"compresor","ore_bord":100,"poza_path":"teren/8/porneste-20"}]',1,'teren/8/porneste-2','jump-stop-start');
SELECT fn_probe_opreste_utilaj(8,9,130,'teren/8/opreste_utilaj-20','terminat',NULL,NULL,'jump-stop',true,'Verificat mecanic');
SELECT fn_probe_inchide(8,'admis',2,'teren/8/inchide-2','[]','Confirm','all-stopped-close');
-- Owner fara intrare in modul poate scrie, anon/sub NULL nu poate.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pt_assert(probe_teren_drept(true),'owner bypass');
SELECT fn_probe_porneste(4,'[{"active_id":5,"rol":"booster","ore_bord":100,"poza_path":"teren/4/porneste-20"}]',1,'teren/4/porneste-2','owner-start');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'NULL uid fara citire');
SELECT pt_refuza($case_null_uid$SELECT fn_probe_porneste(5,'[]',1,'teren/5/porneste-2','null-uid')$case_null_uid$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'fara acces nu citeste intervale existente');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_utilaje),'fara acces nu citeste contoare existente');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_executie),'legacy log filtrat');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii),'audit filtrat');
SELECT pt_assert(probe_teren_norma(1) IS NULL,'fara modul nu citeste norma prin helper');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT pt_assert((SELECT count(*)>0 FROM probe_exec_utilaje),'viewer citeste');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'admin probe nu citeste');
RESET ROLE;
-- Runda 2: fluxul real Ofertare insereaza calculul si abia apoi oferta.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SET LOCAL ROLE authenticated;
INSERT INTO probe_calcule(id,proiect_id,status,v_conducta_mc) VALUES(30,NULL,'planificata',10) RETURNING id;
INSERT INTO probe_oferte(id,client,calc_id) VALUES(30,'Client preliminar',30);
-- Runda 4: comercialul nu isi poate acorda acces prin legatura noua.
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule WHERE id=900),'calcul tinta invizibil inainte de INSERT');
SELECT pt_refuza('INSERT INTO probe_oferte(id,client,calc_id) VALUES(902,''Test'',900)','pt_oferta_calc');
SELECT pt_assert((SELECT count(*)=0 FROM probe_oferte WHERE id=902),'INSERT refuzat fara oferta reziduala');
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule WHERE id=900),'calcul ramane invizibil dupa INSERT refuzat');
SELECT pt_refuza('UPDATE probe_oferte SET calc_id=900 WHERE id=30','pt_oferta_calc');
SELECT pt_assert((SELECT calc_id=30 FROM probe_oferte WHERE id=30),'UPDATE refuzat pastreaza legatura veche');
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule WHERE id=900),'calcul ramane invizibil dupa UPDATE refuzat');
INSERT INTO probe_oferte(id,client,calc_id) VALUES(902,'Fara calcul',NULL);
UPDATE probe_oferte SET calc_id=30 WHERE id=902;
SELECT pt_assert((SELECT calc_id=30 FROM probe_oferte WHERE id=902),'UPDATE la calcul vizibil acceptat');
UPDATE probe_oferte SET calc_id=NULL WHERE id=902;
SELECT pt_assert((SELECT calc_id IS NULL FROM probe_oferte WHERE id=902),'dezlegare acceptata');
SELECT pt_assert((SELECT beneficiar_tip IS NULL FROM probe_calcule WHERE id=30),'Ofertare vede calculul preliminar');
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'Ofertare nu primeste raport teren');
SELECT pt_refuza($case_ofertare_no_rpc$SELECT fn_probe_porneste(30,'[]',1,'teren/30/porneste-2','ofertare-start')$case_ofertare_no_rpc$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_oferte),'editor teren fara vizibilitate comerciala');
SELECT pt_refuza($case_prelim_start$SELECT fn_probe_porneste(30,'[]',1,'teren/30/porneste-2','prelim-start')$case_prelim_start$,'pt_beneficiar');
SELECT pt_refuza('UPDATE probe_calcule SET beneficiar_tip=''tert'',tert_ref_tip=''oferta'',tert_ref_id=999,tert_client=''Client'' WHERE id=30','pt_beneficiar');
UPDATE probe_calcule SET beneficiar_tip='tert',tert_ref_tip='oferta',tert_ref_id=30,tert_client='Client' WHERE id=30;
SELECT pt_assert((SELECT tert_ref_id=30 FROM probe_calcule WHERE id=30),'referinta valida fara acces Ofertare');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SELECT pt_assert((SELECT beneficiar_tip='tert' AND status='planificata' FROM probe_calcule WHERE id=30),'Ofertare vede calculul dupa completarea beneficiarului');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT fn_probe_porneste(30,'[{"active_id":1,"rol":"compresor","ore_bord":101,"poza_path":"teren/30/porneste-1"}]',1,'teren/30/porneste-2','prelim-start');
SELECT pt_assert((SELECT status='in_executie' FROM probe_calcule WHERE id=30),'pornire dupa completarea beneficiarului');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii),'payload-uri private pentru editor');
-- Runda 3: Ofertare pastreaza SELECT la fiecare etapa, fara alte drepturi.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SELECT pt_assert((SELECT status='in_executie' AND beneficiar_tip='tert' FROM probe_calcule WHERE id=30),'Ofertare vede executia legata de oferta');
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule WHERE id=900),'calcul cu beneficiar nelegat invizibil');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_executie),'Ofertare fara jurnal presiuni');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_utilaje),'Ofertare fara jurnal contoare');
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje),'Ofertare fara intervale');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii),'Ofertare fara registru');
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'Ofertare fara raport cu executie existenta');
SELECT pt_refuza('SELECT * FROM probe_teren_poze','permission denied');
WITH modificate AS (UPDATE probe_calcule SET operator_nume='Comercial' WHERE id=30 RETURNING id)
 SELECT pt_assert((SELECT count(*)=0 FROM modificate),'Ofertare nu poate modifica calculul legat');
SELECT pt_refuza('INSERT INTO probe_calcule(id,proiect_id) VALUES(31,1)','row-level security');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT fn_probe_inchide(30,'admis',2,'teren/30/inchide-2','[{"active_id":1,"ore_bord":102,"poza_path":"teren/30/inchide-1"}]','Confirm','prelim-close');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SELECT pt_assert((SELECT status='finalizata' FROM probe_calcule WHERE id=30),'Ofertare vede calculul finalizat');
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'Ofertare fara raport finalizat');
RESET ROLE;
INSERT INTO probe_oferte(id,client,calc_id) VALUES(900,'Calcul cu proiect',900);
SET LOCAL ROLE authenticated;
SELECT pt_assert((SELECT beneficiar_tip='gazpet' FROM probe_calcule WHERE id=900),'Ofertare vede calculul legat cu beneficiar backfill');
-- O legatura existenta se poate salva fara schimbarea calculului.
UPDATE probe_oferte SET calc_id=900,client='Calcul cu proiect actualizat' WHERE id=900;
SELECT pt_assert((SELECT client='Calcul cu proiect actualizat' FROM probe_oferte WHERE id=900),'salvare legatura existenta acceptata');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
INSERT INTO probe_oferte(id,client,calc_id) VALUES(903,'Owner',1);
SELECT pt_assert((SELECT calc_id=1 FROM probe_oferte WHERE id=903),'owner leaga calcul cu beneficiar');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
-- Aceeasi poza nu acopera alt utilaj, alta proba sau alt eveniment.
SELECT pt_refuza($case_photo_other_calc$SELECT fn_probe_porneste(9,'[{"active_id":10,"rol":"pompa","ore_bord":100,"poza_path":"teren/1/porneste-1"}]',1,'teren/9/porneste-2','photo-start')$case_photo_other_calc$,'pt_poza: calea');
SELECT pt_refuza($case_photo_two_assets$SELECT fn_probe_porneste(9,'[{"active_id":10,"rol":"pompa","ore_bord":100,"poza_path":"teren/9/porneste-1"},{"active_id":11,"rol":"pompa","ore_bord":100,"poza_path":"teren/9/porneste-1"}]',1,'teren/9/porneste-2','photo-start')$case_photo_two_assets$,'pt_poza_reutilizata');
SELECT fn_probe_porneste(9,'[{"active_id":10,"rol":"pompa","ore_bord":100,"poza_path":"teren/9/porneste-1"},{"active_id":11,"rol":"pompa","ore_bord":100,"poza_path":"teren/9/porneste-3"}]',1,'teren/9/porneste-2','photo-start') AS photo_result \gset
SELECT pt_assert(fn_probe_porneste(9,'[{"active_id":10,"rol":"pompa","ore_bord":100,"poza_path":"teren/9/porneste-1"},{"active_id":11,"rol":"pompa","ore_bord":100,"poza_path":"teren/9/porneste-3"}]',1,'teren/9/porneste-2','photo-start')=:'photo_result'::jsonb,'retry nu rezerva pozele din nou');
SELECT pt_refuza($case_photo_other_event$SELECT fn_probe_opreste_utilaj(9,10,101,'teren/9/porneste-1','terminat',NULL,NULL,'photo-stop')$case_photo_other_event$,'pt_poza_reutilizata');
SELECT pt_refuza($case_photo_close_reuse$SELECT fn_probe_inchide(9,'admis',2,'teren/9/porneste-2','[{"active_id":10,"ore_bord":101,"poza_path":"teren/9/inchide-1"},{"active_id":11,"ore_bord":101,"poza_path":"teren/9/inchide-3"}]',NULL,'photo-close')$case_photo_close_reuse$,'pt_poza_reutilizata');
-- Documentarea ramane editabila dupa pornire; executia este protejata integral.
UPDATE probe_calcule SET pv_path='pv/test.pdf',pv_generat_la=now(),aep_diagrama_path='aep/test.pdf',observatii='Documentat',updated_at=now() WHERE id=9;
SELECT pt_assert((SELECT pv_path='pv/test.pdf' AND aep_diagrama_path='aep/test.pdf' FROM probe_calcule WHERE id=9),'documente salvate direct');
SELECT pt_refuza('UPDATE probe_calcule SET status=''finalizata'' WHERE id=9','pt_rpc');
SELECT pt_refuza('UPDATE probe_calcule SET temperatura_c=20 WHERE id=9','pt_rpc');
SELECT pt_refuza('UPDATE probe_calcule SET config_real_id=1 WHERE id=9','pt_rpc');
SELECT pt_refuza('UPDATE probe_calcule SET operator_nume=''Alt operator'' WHERE id=9','pt_rpc');
SELECT pt_refuza('UPDATE probe_calcule SET responsabil_nume=''Alt responsabil'' WHERE id=9','pt_rpc');
SELECT pt_refuza('UPDATE probe_calcule SET proiect_id=NULL,beneficiar_tip=NULL WHERE id=9','pt_beneficiar');
-- Oferta dispare numai in fixture: un UPDATE documentar nu revalideaza referinta.
RESET ROLE;
DELETE FROM probe_oferte WHERE id=30;
SET LOCAL ROLE authenticated;
UPDATE probe_calcule SET pv_path='pv/tert.pdf' WHERE id=30;
SELECT pt_assert((SELECT pv_path='pv/tert.pdf' FROM probe_calcule WHERE id=30),'documentare tert fara revalidare comerciala');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SELECT pt_assert((SELECT count(*)=0 FROM probe_calcule WHERE id=30),'fara oferta calculul cu beneficiar nu mai este vizibil');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
-- Scenariul 08:00 - 10:00 - 16:00, deplasat fata de now() numai in fixture.
SELECT fn_probe_porneste(10,'[{"active_id":12,"rol":"compresor","ore_bord":100,"poza_path":"teren/10/porneste-1"}]',1,'teren/10/porneste-2','duration-start');
RESET ROLE;
UPDATE probe_calcule SET ora_start=now()-interval '8 hours' WHERE id=10;
UPDATE probe_log_executie SET ora_citire=now()-interval '8 hours' WHERE calc_id=10;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '8 hours' WHERE calc_id=10;
SET LOCAL ROLE authenticated;
SELECT fn_probe_opreste_utilaj(10,12,102,'teren/10/opreste_utilaj-1','terminat',NULL,NULL,'duration-stop');
RESET ROLE;
UPDATE probe_exec_utilaje SET ora_stop=now()-interval '6 hours' WHERE calc_id=10;
INSERT INTO logistica_alimentari VALUES
 (1,12,now()-interval '8 hours',40,1),(2,12,now(),60,1),
 (3,12,now()-interval '9 hours',500,1),(4,12,now()+interval '1 hour',500,1),(5,1,now(),500,1),
 (6,3,now(),17,1),(7,12,now(),700,NULL),(8,3,now(),900,NULL);
SET LOCAL ROLE authenticated;
SELECT fn_probe_inchide(10,'admis',9,'teren/10/inchide-2','[]','Confirm','duration-close');
SELECT pt_assert((SELECT durata_reala_h=8 FROM probe_calcule WHERE id=10),'8h persistate la inchidere');
SELECT pt_assert((SELECT durata_reala_h=8 AND ultima_oprire=inchisa_la-interval '6 hours' AND (utilaje->0->>'ore_lucrate')::numeric=2 FROM v_probe_raport WHERE calc_id=10),'8h proba versus 2h utilaj');
SELECT pt_assert((SELECT interval_presiune_h=8 AND abs(debit_real_estimat_mc_min-10*8/1.01325/480)<0.000001 FROM v_probe_raport WHERE calc_id=10),'debit intre citirile 08-16');
SELECT pt_assert((SELECT litri_fise_bazin_comparatie=100 AND fise_bazin_mentiune LIKE '%TKT-2026-0358%' AND NOT (utilaje->0 ? 'litri_fise_bazin_comparatie') FROM v_probe_raport WHERE calc_id=10),'comparatie proba, limite inclusive, fara atribuire pe utilaj');
SELECT pt_assert((SELECT litri_fise_bazin_comparatie=17 FROM v_probe_raport WHERE calc_id=3),'alimentari fara multiplicare pe intervale repetate');
SELECT pt_assert((SELECT fise_bazin_mentiune LIKE '%rezervor_id NOT NULL%' AND litri_fise_bazin_comparatie=100 FROM v_probe_raport WHERE calc_id=10),'statii externe 700 litri excluse explicit din bazin');
SELECT pt_assert((SELECT litri_fise_bazin_comparatie=100 AND litri_statii_externe_orientativ=700 AND statii_externe_mentiune LIKE 'alimentari din statii externe (orientativ)%' FROM v_probe_raport WHERE calc_id=10),'bazin 100 si extern 700 in coloane distincte');
SELECT pt_assert((SELECT litri_statii_externe_orientativ=900 FROM v_probe_raport WHERE calc_id=3),'extern fara multiplicare pe intervale repetate');
SELECT pt_assert(NOT has_table_privilege('authenticated','logistica_alimentari','SELECT'),'comparatie fara acces Logistica');
RESET ROLE;
UPDATE probe_log_executie SET ora_citire=now()-interval '7 hours' WHERE calc_id=10 AND cheie='duration-start';
SET LOCAL ROLE authenticated;
SELECT pt_assert((SELECT durata_reala_h=8 AND interval_presiune_h=7 AND abs(debit_real_estimat_mc_min-10*8/1.01325/420)<0.000001 FROM v_probe_raport WHERE calc_id=10),'intervalul presiunilor este independent de durata probei');
-- Varianta legacy DATE: nu inventam o ora; includem ziua locala a probei.
RESET ROLE;
ALTER TABLE logistica_alimentari ALTER COLUMN data_alimentare TYPE date USING
  CASE WHEN id IN (1,2,5,6,7,8) THEN DATE '2026-10-26' ELSE DATE '2026-10-25' END;
UPDATE probe_calcule SET ora_start='2026-10-26 08:00:00+02',ora_stop='2026-10-26 16:00:00+02' WHERE id=10;
SET LOCAL ROLE authenticated;
SELECT pt_assert((SELECT litri_fise_bazin_comparatie=100 FROM v_probe_raport WHERE calc_id=10),'sursa DATE: comparatie pe zile locale, fara ora inventata');
SELECT pt_assert((SELECT litri_statii_externe_orientativ=700 FROM v_probe_raport WHERE calc_id=10),'sursa DATE: extern separat pe zile locale');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
SELECT pt_assert((SELECT count(*)=0 FROM v_probe_raport),'admin probe fara raport cu date existente');
SELECT pt_assert(probe_teren_bazin(10) IS NULL,'fara modul nu citeste comparatia prin helper');
SELECT pt_assert(probe_teren_statii_externe(10) IS NULL,'fara modul nu citeste statiile externe prin helper');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii),'admin probe fara payload-uri existente');
SELECT pt_refuza('SELECT * FROM probe_teren_poze','permission denied');
-- Runda 3: completare server, inainte si dupa inchidere, idempotenta comuna.
SELECT pt_refuza($case_complete_admin_old$SELECT fn_probe_completeaza_executie(11,1,20,'Operator','Responsabil','pv/a.pdf',NULL,'aep/a.pdf','complete-plan')$case_complete_admin_old$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SELECT pt_refuza($case_complete_commercial$SELECT fn_probe_completeaza_executie(30,1,20,'Operator','Responsabil',NULL,NULL,NULL,'complete-plan')$case_complete_commercial$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT pt_refuza($case_complete_viewer$SELECT fn_probe_completeaza_executie(11,1,20,'Operator','Responsabil',NULL,NULL,NULL,'complete-plan')$case_complete_viewer$,'pt_acces');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pt_refuza($case_complete_missing$SELECT fn_probe_completeaza_executie(99999,1,20,'Operator','Responsabil',NULL,NULL,NULL,'complete-missing')$case_complete_missing$,'pt_proba');
SELECT pt_refuza($case_complete_key$SELECT fn_probe_completeaza_executie(11,1,20,'Operator','Responsabil',NULL,NULL,NULL,' ')$case_complete_key$,'pt_cheie');
SELECT pt_refuza($case_complete_fk$SELECT fn_probe_completeaza_executie(11,99999,20,'Operator','Responsabil',NULL,NULL,NULL,'complete-fk')$case_complete_fk$,'foreign key');
SELECT fn_probe_completeaza_executie(11,1,20,'Operator','Responsabil','pv/a.pdf',now(),'aep/a.pdf','complete-plan') AS complete_result \gset
SELECT pt_assert(fn_probe_completeaza_executie(11,1,20,'Operator','Responsabil','pv/a.pdf',now(),'aep/a.pdf','complete-plan')=:'complete_result'::jsonb,'retry completare identic');
SELECT pt_assert((SELECT status='planificata' AND config_real_id=1 AND temperatura_c=20 AND operator_nume='Operator' AND responsabil_nume='Responsabil' AND pv_path='pv/a.pdf' AND pv_generat_la=now() AND aep_diagrama_path='aep/a.pdf' FROM probe_calcule WHERE id=11),'completare toate campurile fara schimbare status');
SELECT pt_refuza($case_complete_conflict$SELECT fn_probe_completeaza_executie(11,1,21,'Operator','Responsabil','pv/a.pdf',now(),'aep/a.pdf','complete-plan')$case_complete_conflict$,'pt_cheie_conflict');
SELECT pt_refuza($case_complete_other_action$SELECT fn_probe_porneste(11,'[]',1,'teren/11/m.jpg','complete-plan')$case_complete_other_action$,'pt_cheie_conflict');
SELECT fn_probe_completeaza_executie(1,1,18,'Operator final','Responsabil final','pv/final.pdf',now(),'aep/final.pdf','complete-final');
SELECT pt_assert((SELECT status='finalizata' AND temperatura_c=18 AND pv_path='pv/final.pdf' AND durata_reala_h=9 FROM probe_calcule WHERE id=1),'completare dupa inchidere fara modificarea executiei');
SELECT pt_refuza('UPDATE probe_calcule SET temperatura_c=19,pv_path=''pv/legacy.pdf'' WHERE id=1','pt_rpc');
SELECT pt_refuza('INSERT INTO probe_calcule(id,temperatura_c) VALUES(31,20)','pt_rpc');
SELECT pt_refuza('INSERT INTO probe_calcule(id,config_real_id) VALUES(31,1)','pt_rpc');
SELECT pt_refuza('INSERT INTO probe_calcule(id,operator_nume) VALUES(31,''Operator'')','pt_rpc');
SELECT pt_refuza('INSERT INTO probe_calcule(id,responsabil_nume) VALUES(31,''Responsabil'')','pt_rpc');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pt_refuza($case_complete_author$SELECT fn_probe_completeaza_executie(11,1,20,'Operator','Responsabil','pv/a.pdf',now(),'aep/a.pdf','complete-plan')$case_complete_author$,'pt_cheie_conflict');
SELECT fn_probe_completeaza_executie(21,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'complete-owner');
SELECT pt_assert((SELECT status='planificata' AND beneficiar_tip IS NULL FROM probe_calcule WHERE id=21),'owner completeaza proba existenta preliminara');
RESET ROLE;
SELECT pt_assert((SELECT count(*)=1 FROM probe_teren_operatii WHERE cheie='complete-plan' AND actiune='completeaza_executie'),'o singura operatie pentru retry');
SELECT pt_assert((SELECT count(*)=0 FROM probe_teren_operatii WHERE cheie IN ('complete-fk','complete-missing')),'refuzurile nu lasa operatii');
-- Obiectele necanonice chiar exista: refuzul trebuie sa vina din validarea caii.
INSERT INTO storage.objects SELECT 'probe-citiri',p FROM unnest(ARRAY[
 'teren/110/x','teren/11/../2/x','teren//11/x','teren/11/.','teren/11/..',
 'teren/11/sub/x','teren/11/','teren/11/'||chr(92)||'x','teren/11/x'||chr(10)
]) p;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $pt_test_canonical$
DECLARE p text;
BEGIN
 FOREACH p IN ARRAY ARRAY['teren/110/x','teren/11/../2/x','teren//11/x','teren/11/.','teren/11/..',
   'teren/11/sub/x','teren/11/','teren/11/'||chr(92)||'x','teren/11/x'||chr(10)] LOOP
   PERFORM pt_refuza(format('SELECT fn_probe_porneste(11,%L::jsonb,1,%L,%L)',
     '[{"active_id":12,"rol":"compresor","ore_bord":102,"poza_path":"teren/11/porneste-1"}]',p,'invalid-path'),'pt_poza');
 END LOOP;
END $pt_test_canonical$;
SELECT pt_assert((SELECT status='planificata' FROM probe_calcule WHERE id=11),'caile invalide nu pornesc proba');
RESET ROLE;
ROLLBACK;
\echo PASS probe_teren SQL: reguli business, RLS, RPC, atomicitate, idempotenta, raport
