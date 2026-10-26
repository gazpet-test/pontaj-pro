\set ON_ERROR_STOP on
-- Numai fixture local. Nicio conexiune externa. Tot scenariul este anulat.
BEGIN;
CREATE FUNCTION public.pt_assert(p_ok boolean,p_mesaj text) RETURNS void LANGUAGE plpgsql AS $pt2_test_assert$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST: %',p_mesaj; END IF; END;
$pt2_test_assert$;
CREATE FUNCTION public.pt_refuza(p_sql text,p_mesaj text) RETURNS void LANGUAGE plpgsql AS $pt2_test_refuza$
DECLARE refuz boolean:=false;
BEGIN
 BEGIN EXECUTE p_sql;
 EXCEPTION WHEN OTHERS THEN
   IF position(p_mesaj IN SQLERRM)=0 THEN RAISE EXCEPTION 'TEST: asteptat %, primit %',p_mesaj,SQLERRM; END IF;
   refuz:=true;
 END;
 IF NOT refuz THEN RAISE EXCEPTION 'TEST: acceptat, asteptat %',p_mesaj; END IF;
END $pt2_test_refuza$;
GRANT EXECUTE ON FUNCTION pt_assert(boolean,text),pt_refuza(text,text) TO authenticated;
SELECT pt_assert((SELECT bool_and(faza_curenta IS NULL AND NOT creat_din_teren) FROM probe_calcule),'istoric nemodificat');
-- Compatibilitate E1 pe schema E2a, in aceeasi tranzactie anulata.
\ir test_probe_teren_e1_compat.sql
INSERT INTO probe_calcule(id,proiect_id) SELECT i,1 FROM generate_series(100,110) i;
INSERT INTO probe_calcule(id,proiect_id,tip_fluid) VALUES(120,1,'apa'),(121,1,'apa');
INSERT INTO storage.objects SELECT 'probe-citiri','teren/'||c||'/'||n
 FROM generate_series(100,130) c CROSS JOIN generate_series(1,80) n;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pt_refuza('UPDATE probe_calcule SET faza_curenta=''pistonare'' WHERE id=100','pt_rpc');
SELECT pt_refuza('UPDATE probe_calcule SET creat_din_teren=true WHERE id=100','pt_rpc');
SELECT fn_probe_porneste(100,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/100/2"},{"active_id":2,"rol":"booster","ore_bord":100,"poza_path":"teren/100/3"}]',1,'teren/100/1','e2-start') AS start_result \gset
SELECT pt_assert((SELECT faza_curenta='pistonare' FROM probe_calcule WHERE id=100),'prima faza pneumatic');
SELECT pt_assert(fn_probe_porneste(100,'[{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"teren/100/2"},{"active_id":2,"rol":"booster","ore_bord":100,"poza_path":"teren/100/3"}]',1,'teren/100/1','e2-start')=:'start_result'::jsonb,'retry pornire');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'calibrare',1,'teren/100/4','[]',NULL,false,NULL,'salt-faza')$q$,'pt_faza_tranzitie');
SELECT pt_refuza($q$SELECT fn_probe_inchide(100,'admis',1,'teren/100/4','[]',NULL,'admis-devreme')$q$,'pt_faza_admis');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,NULL,'[]',NULL,false,NULL,'limita')$q$,'pt_utilaje');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,'teren/100/4','[{"active_id":1,"ore_bord":101,"poza_path":"teren/100/5"}]',NULL,false,NULL,'limita')$q$,'pt_utilaje');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,NULL,'[{"active_id":1,"ore_bord":101,"poza_path":"teren/100/5"},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita')$q$,'pt_poza');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,'teren/100/4','[{"active_id":1,"ore_bord":101},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita')$q$,'pt_poza');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,'teren/100/4','[{"active_id":1,"ore_bord":99,"poza_path":"teren/100/5"},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita')$q$,'pt_bord_scade');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,'teren/100/4','[{"active_id":1,"ore_bord":130,"poza_path":"teren/100/5"},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita')$q$,'pt_bord_salt');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,'teren/100/1','[{"active_id":1,"ore_bord":101,"poza_path":"teren/100/5"},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita')$q$,'pt_poza_reutilizata');
SELECT fn_probe_schimba_faza(100,'uscare',2,'teren/100/4','[{"active_id":1,"ore_bord":101,"poza_path":"teren/100/5"},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita') AS limita_result \gset
SELECT pt_assert(fn_probe_schimba_faza(100,'uscare',2,'teren/100/4','[{"active_id":1,"ore_bord":101,"poza_path":"teren/100/5"},{"active_id":2,"ore_bord":101,"poza_path":"teren/100/6"}]',NULL,false,NULL,'limita')=:'limita_result'::jsonb,'retry limita');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',3,'teren/100/4','[]',NULL,false,NULL,'limita')$q$,'pt_cheie_conflict');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(100,'pistonare',1,'teren/100/7','[]',NULL,false,NULL,'inapoi')$q$,'pt_faza_tranzitie');
SELECT fn_probe_schimba_faza(100,'calibrare',3,'teren/100/7','[{"active_id":1,"ore_bord":102,"poza_path":"teren/100/8"},{"active_id":2,"ore_bord":102,"poza_path":"teren/100/9"}]',NULL,false,NULL,'limita2');
SELECT fn_probe_schimba_faza(100,'proba',4,'teren/100/10','[{"active_id":1,"ore_bord":103,"poza_path":"teren/100/11"},{"active_id":2,"ore_bord":103,"poza_path":"teren/100/12"}]',NULL,false,NULL,'limita3');
SELECT pt_refuza($q$SELECT fn_probe_citire(100,4,'teren/100/16','[]',NULL,false,NULL,'periodica')$q$,'pt_citire_devreme');
SELECT fn_probe_inchide(100,'admis',5,'teren/100/13','[{"active_id":1,"ore_bord":104,"poza_path":"teren/100/14"},{"active_id":2,"ore_bord":104,"poza_path":"teren/100/15"}]','Confirm inchiderea','e2-final');
SELECT pt_assert((SELECT count(*)=5 AND bool_and(limita_faza AND poza_manometru_path IS NOT NULL) FROM probe_log_executie WHERE calc_id=100),'5 limite complete, fara duplicarea sfarsitului');
SELECT pt_assert((SELECT count(*)=10 FROM probe_log_utilaje u JOIN probe_log_executie l ON l.id=u.log_id WHERE l.calc_id=100),'doua contoare la fiecare limita');
SELECT pt_assert((SELECT jsonb_array_length(faze)=4 AND (faze->0->'utilaje'->0->>'ore_lucrate')::numeric=1 AND (faze->3->'utilaje'->1->>'litri_estimati')::numeric=10 FROM v_probe_raport WHERE calc_id=100),'ore si litri pe faza');
SELECT pt_assert((SELECT sum((u->>'ore_lucrate')::numeric)=8 FROM v_probe_raport r CROSS JOIN LATERAL jsonb_array_elements(r.faze) f CROSS JOIN LATERAL jsonb_array_elements(f->'utilaje') u WHERE calc_id=100),'suma fazelor egala cu intervalele');
RESET ROLE;
UPDATE probe_calcule SET ora_start=now()-interval '4 hours' WHERE id=100;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '4 hours' WHERE calc_id=100;
UPDATE probe_log_executie SET ora_citire=now()-CASE cheie WHEN 'e2-start' THEN interval '4 hours' WHEN 'limita' THEN interval '3 hours' WHEN 'limita2' THEN interval '2 hours' WHEN 'limita3' THEN interval '1 hour' ELSE interval '0 hours' END WHERE calc_id=100;
SET LOCAL ROLE authenticated;
SELECT pt_assert((SELECT bool_and((f->>'durata_h')::numeric=1) FROM v_probe_raport r CROSS JOIN LATERAL jsonb_array_elements(r.faze) f WHERE calc_id=100),'4 faze de o ora fiecare din limitele comune');
-- Respins este permis din fiecare faza; fiecare caz are propriile dovezi.
DO $pt2_test_respins$
DECLARE i integer; j integer; faze text[]:=ARRAY['pistonare','uscare','calibrare','proba']; payload jsonb;
BEGIN
 FOR i IN 1..4 LOOP
   payload:=jsonb_build_array(jsonb_build_object('active_id',3,'rol','compresor','ore_bord',100,'poza_path','teren/'||(100+i)||'/2'));
   PERFORM fn_probe_porneste(100+i,payload,1,'teren/'||(100+i)||'/1','r-start-'||i);
   FOR j IN 2..i LOOP
     payload:=jsonb_build_array(jsonb_build_object('active_id',3,'ore_bord',100,'poza_path','teren/'||(100+i)||'/'||(j*2)));
     PERFORM fn_probe_schimba_faza(100+i,faze[j],1,'teren/'||(100+i)||'/'||(j*2-1),payload,NULL,false,NULL,'r-faza-'||i||'-'||j);
   END LOOP;
   PERFORM fn_probe_inchide(100+i,'respins',1,'teren/'||(100+i)||'/20',jsonb_build_array(jsonb_build_object('active_id',3,'ore_bord',100,'poza_path','teren/'||(100+i)||'/21')),'Confirm','r-stop-'||i);
 END LOOP;
END $pt2_test_respins$;
SELECT pt_assert((SELECT count(*)=4 FROM probe_calcule WHERE id BETWEEN 101 AND 104 AND status='respinsa'),'respins din toate fazele');
-- Citirile din pregatire sunt acceptate imediat; pragul 6h se aplica doar in proba.
SELECT fn_probe_porneste(106,'[{"active_id":8,"rol":"compresor","ore_bord":100,"poza_path":"teren/106/2"}]',1,'teren/106/1','p-start');
SELECT fn_probe_citire(106,1,'teren/106/3','[{"active_id":8,"ore_bord":101,"poza_path":"teren/106/4"}]',NULL,false,NULL,'p-extra');
SELECT pt_assert((SELECT faza='pistonare' AND NOT limita_faza FROM probe_log_executie WHERE cheie='p-extra'),'citire intermediara marcata cu faza');
SELECT fn_probe_schimba_faza(106,'uscare',1,'teren/106/5','[{"active_id":8,"ore_bord":102,"poza_path":"teren/106/6"}]',NULL,false,NULL,'p-uscare');
SELECT fn_probe_schimba_faza(106,'calibrare',1,'teren/106/7','[{"active_id":8,"ore_bord":103,"poza_path":"teren/106/8"}]',NULL,false,NULL,'p-calibrare');
SELECT fn_probe_schimba_faza(106,'proba',1,'teren/106/9','[{"active_id":8,"ore_bord":104,"poza_path":"teren/106/10"}]',NULL,false,NULL,'p-proba');
SELECT pt_refuza($q$SELECT fn_probe_citire(106,1,'teren/106/11','[]',NULL,false,NULL,'p-periodic')$q$,'pt_citire_devreme');
RESET ROLE;
UPDATE probe_log_executie SET ora_citire=now()-interval '6 hours' WHERE calc_id=106;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '6 hours' WHERE calc_id=106;
UPDATE probe_calcule SET ora_start=now()-interval '6 hours' WHERE id=106;
SET LOCAL ROLE authenticated;
SELECT fn_probe_citire(106,1,'teren/106/11','[{"active_id":8,"ore_bord":105,"poza_path":"teren/106/12"}]',NULL,false,NULL,'p-periodic');
SELECT pt_assert((SELECT faza='proba' AND NOT limita_faza AND NOT intarziata FROM probe_log_executie WHERE cheie='p-periodic'),'periodica la 6h');
-- Inlocuirea in mijlocul fazei imparte corect orele intre intervale si faze.
SELECT fn_probe_porneste(107,'[{"active_id":6,"rol":"compresor","ore_bord":100,"poza_path":"teren/107/2"}]',1,'teren/107/1','replace-start');
SELECT fn_probe_schimba_faza(107,'uscare',1,'teren/107/3','[{"active_id":6,"ore_bord":101,"poza_path":"teren/107/4"}]',NULL,false,NULL,'replace-uscare');
SELECT fn_probe_opreste_utilaj(107,6,102,'teren/107/5','inlocuit',NULL,'{"active_id":7,"rol":"compresor","ore_bord":100,"poza_path":"teren/107/6"}','replace-stop');
SELECT fn_probe_schimba_faza(107,'calibrare',1,'teren/107/7','[{"active_id":7,"ore_bord":101,"poza_path":"teren/107/8"}]',NULL,false,NULL,'replace-calibrare');
SELECT fn_probe_schimba_faza(107,'proba',1,'teren/107/9','[{"active_id":7,"ore_bord":102,"poza_path":"teren/107/10"}]',NULL,false,NULL,'replace-proba');
SELECT fn_probe_inchide(107,'admis',1,'teren/107/11','[{"active_id":7,"ore_bord":103,"poza_path":"teren/107/12"}]','Confirm','replace-final');
SELECT pt_assert((SELECT (faze->1->'utilaje'->0->>'ore_lucrate')::numeric=1 AND (faze->1->'utilaje'->1->>'ore_lucrate')::numeric=1 FROM v_probe_raport WHERE calc_id=107),'uscare: 1h utilaj vechi plus 1h inlocuitor');
SELECT pt_assert((SELECT sum((u->>'ore_lucrate')::numeric)=5 FROM v_probe_raport r CROSS JOIN LATERAL jsonb_array_elements(r.faze) f CROSS JOIN LATERAL jsonb_array_elements(f->'utilaje') u WHERE calc_id=107),'inlocuirea nu dubleaza consumul pe faze');
SELECT fn_probe_porneste(108,'[{"active_id":9,"rol":"compresor","ore_bord":100,"poza_path":"teren/108/2"}]',1,'teren/108/1','confirm-start');
SELECT fn_probe_schimba_faza(108,'uscare',1,'teren/108/3','[{"active_id":9,"ore_bord":130,"poza_path":"teren/108/4"}]',NULL,true,'Contor verificat','confirm-uscare');
SELECT pt_assert((SELECT ore_bord=130 FROM probe_log_utilaje u JOIN probe_log_executie l ON l.id=u.log_id WHERE l.cheie='confirm-uscare'),'salt confirmat la limita');
-- Runda 2: inchiderea pneumatica la 24h este o citire intarziata.
SELECT fn_probe_porneste(109,'[{"active_id":11,"rol":"compresor","ore_bord":101,"poza_path":"teren/109/2"}]',1,'teren/109/1','late-start');
SELECT fn_probe_schimba_faza(109,'uscare',1,'teren/109/3','[{"active_id":11,"ore_bord":101,"poza_path":"teren/109/4"}]',NULL,false,NULL,'late-uscare');
SELECT fn_probe_schimba_faza(109,'calibrare',1,'teren/109/5','[{"active_id":11,"ore_bord":101,"poza_path":"teren/109/6"}]',NULL,false,NULL,'late-calibrare');
SELECT fn_probe_schimba_faza(109,'proba',1,'teren/109/7','[{"active_id":11,"ore_bord":101,"poza_path":"teren/109/8"}]',NULL,false,NULL,'late-proba');
RESET ROLE;
UPDATE probe_calcule SET ora_start=now()-interval '24 hours' WHERE id=109;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '24 hours' WHERE calc_id=109;
UPDATE probe_log_executie SET ora_citire=now()-interval '24 hours' WHERE calc_id=109;
SET LOCAL ROLE authenticated;
SELECT fn_probe_inchide(109,'admis',1,'teren/109/9','[{"active_id":11,"ore_bord":102,"poza_path":"teren/109/10"}]','Confirm','late-close') AS late_close \gset
SELECT pt_assert((:'late_close'::jsonb->>'intarziata')::boolean,'raspuns inchidere intarziata');
SELECT pt_assert((SELECT intarziata AND limita_faza AND faza='proba' FROM probe_log_executie WHERE cheie='late-close'),'jurnal inchidere intarziata');
SELECT pt_assert((SELECT citiri_intarziate=1 AND numar_citiri=5 FROM v_probe_raport WHERE calc_id=109),'raport exact o citire intarziata, fara intermediare');
-- Hidraulic: fara poze/ore/temperatura la umplere; inlocuire atomica pompa.
SELECT fn_probe_porneste(120,'[{"active_id":4,"rol":"pompa"}]',NULL,NULL,'h-start');
SELECT pt_assert((SELECT faza_curenta='umplere' AND presiune_initiala_bar IS NULL FROM probe_calcule WHERE id=120),'hidraulic incepe fara manometru');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_executie WHERE calc_id=120),'umplere fara citire');
SELECT fn_probe_opreste_utilaj(120,4,NULL,NULL,'inlocuit',NULL,'{"active_id":5,"rol":"pompa"}','h-pompa');
SELECT pt_assert((SELECT faza_start='umplere' AND faza_stop='umplere' AND ore_bord_start IS NULL AND ore_bord_stop IS NULL AND inlocuit_prin IS NOT NULL FROM probe_exec_utilaje WHERE calc_id=120 AND active_id=4),'pompe fara contoare, inlocuire pastrata');
SELECT pt_refuza($q$SELECT fn_probe_citire(120,1,'teren/120/1','[]',NULL,false,NULL,'h-read')$q$,'pt_hidraulic_faza');
SELECT pt_refuza($q$SELECT fn_probe_inchide(120,'admis',1,'teren/120/1','[]',NULL,'h-close')$q$,'pt_hidraulic_faza');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(120,'presurizare',1,NULL,'[]',NULL,false,NULL,'h-faza')$q$,'pt_hidraulic_poza');
SELECT fn_probe_schimba_faza(120,'presurizare',1,'teren/120/1','[{"active_id":5}]',NULL,false,NULL,'h-faza');
SELECT pt_refuza($q$SELECT fn_probe_inchide(120,'admis',2,'teren/120/3','[]',NULL,'h-close')$q$,'pt_hidraulic_citiri');
SELECT pt_refuza($q$SELECT fn_probe_citire(120,2,NULL,'[]',NULL,false,NULL,'h-read')$q$,'pt_hidraulic_poza');
SELECT fn_probe_citire(120,2,'teren/120/2',NULL,NULL,false,NULL,'h-read') AS hread \gset
SELECT pt_assert(fn_probe_citire(120,2,'teren/120/2',NULL,NULL,false,NULL,'h-read')=:'hread'::jsonb,'retry citire hidraulica');
SELECT pt_refuza($q$SELECT fn_probe_citire(120,2,'teren/120/4','[]',NULL,false,NULL,'h-extra')$q$,'pt_hidraulic_numar');
SELECT pt_refuza($q$SELECT fn_probe_inchide(120,'admis',3,NULL,'[]',NULL,'h-close')$q$,'pt_hidraulic_poza');
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='probe-citiri' AND name='teren/120/1';
SET LOCAL ROLE authenticated;
SELECT pt_refuza($q$SELECT fn_probe_inchide(120,'admis',3,'teren/120/3','[]',NULL,'h-close')$q$,'pt_poza');
SELECT pt_assert((SELECT count(*)=2 FROM probe_log_executie WHERE calc_id=120),'poza istorica lipsa anuleaza atomic citirea finala');
RESET ROLE;
INSERT INTO storage.objects VALUES('probe-citiri','teren/120/1');
SET LOCAL ROLE authenticated;
SELECT fn_probe_inchide(120,'admis',3,'teren/120/3','[{"active_id":5}]','Confirm','h-close') AS hclose \gset
SELECT pt_assert(fn_probe_inchide(120,'admis',3,'teren/120/3','[{"active_id":5}]','Confirm','h-close')=:'hclose'::jsonb,'retry inchidere hidraulica');
SELECT pt_assert((SELECT status='finalizata' AND presiune_finala_bar=3 AND temperatura_c IS NULL FROM probe_calcule WHERE id=120),'final hidraulic fara temperatura');
SELECT pt_assert((SELECT count(*)=3 AND bool_and(faza='presurizare' AND poza_manometru_path IS NOT NULL) FROM probe_log_executie WHERE calc_id=120),'exact 3 citiri hidraulice');
SELECT pt_assert((SELECT jsonb_array_length(faze)=2 AND jsonb_array_length(citiri_hidraulice)=3 AND faze->0->'utilaje'='[]'::jsonb AND faze->1->'utilaje'='[]'::jsonb FROM v_probe_raport WHERE calc_id=120),'raport hidraulic timpi si citiri, fara ore');
SELECT pt_assert((SELECT bool_and(ora_stop IS NOT NULL AND ore_bord_start IS NULL AND ore_bord_stop IS NULL) FROM probe_exec_utilaje WHERE calc_id=120),'inchiderea opreste toate pompele fara contoare');
SELECT fn_probe_porneste(121,NULL,NULL,NULL,'h-empty');
SELECT pt_assert((SELECT count(*)=0 FROM probe_exec_utilaje WHERE calc_id=121),'utilaje optionale');
SELECT fn_probe_schimba_faza(121,'presurizare',1,'teren/121/1',NULL,NULL,false,NULL,'h-empty-phase');
SELECT fn_probe_citire(121,2,'teren/121/2',NULL,NULL,false,NULL,'h-empty-read');
SELECT fn_probe_inchide(121,'respins',1,'teren/121/3',NULL,'Confirm','h-empty-close');
SELECT pt_assert((SELECT status='respinsa' AND presiune_finala_bar=1 FROM probe_calcule WHERE id=121),'hidraulic respins cu 3 citiri, fara utilaje');
-- Runda 2: respins anticipat, fara citiri inventate.
RESET ROLE;
INSERT INTO probe_calcule(id,proiect_id,tip_fluid) VALUES(123,1,'apa'),(124,1,'apa'),(125,1,'apa');
SET LOCAL ROLE authenticated;
SELECT fn_probe_porneste(123,'[{"active_id":4,"rol":"pompa"}]',NULL,NULL,'h-reject-fill-start');
SELECT pt_refuza($q$SELECT fn_probe_inchide(123,'respins',NULL,NULL,NULL,NULL,'h-reject-fill')$q$,'pt_hidraulic_motiv');
SELECT pt_refuza($q$SELECT fn_probe_inchide(123,'respins',-1,NULL,NULL,'Racord cedat','h-reject-fill')$q$,'pt_presiune');
SELECT pt_refuza($q$SELECT fn_probe_inchide(123,'respins',NULL,'teren/123/lipsa',NULL,'Racord cedat','h-reject-fill')$q$,'pt_poza');
SELECT fn_probe_inchide(123,'respins',NULL,NULL,NULL,'Racord cedat','h-reject-fill') AS reject_fill \gset
SELECT pt_assert(fn_probe_inchide(123,'respins',NULL,NULL,NULL,'Racord cedat','h-reject-fill')=:'reject_fill'::jsonb,'retry respins umplere');
SELECT pt_assert((SELECT status='respinsa' AND faza_curenta='umplere' AND presiune_finala_bar IS NULL FROM probe_calcule WHERE id=123),'respins umplere fara manometru');
SELECT pt_assert((SELECT count(*)=0 FROM probe_log_executie WHERE calc_id=123),'fara citire inventata in umplere');
SELECT pt_assert((SELECT ora_stop=now() AND faza_stop='umplere' FROM probe_exec_utilaje WHERE calc_id=123),'pompa oprita la respingere');
RESET ROLE;
SELECT pt_assert((SELECT continut->>'observatii'='Racord cedat' FROM probe_teren_operatii WHERE cheie='h-reject-fill'),'motiv respingere auditat');
SET LOCAL ROLE authenticated;
SELECT fn_probe_porneste(124,NULL,NULL,NULL,'h-reject-press-start');
SELECT fn_probe_schimba_faza(124,'presurizare',3,'teren/124/1',NULL,NULL,false,NULL,'h-reject-press-phase');
SELECT pt_refuza($q$SELECT fn_probe_inchide(124,'admis',1,'teren/124/2',NULL,NULL,'h-reject-press-close')$q$,'pt_hidraulic_citiri');
SELECT pt_refuza($q$SELECT fn_probe_inchide(124,'respins',1,NULL,NULL,'Presiune cazuta','h-reject-press-close')$q$,'pt_hidraulic_poza');
SELECT pt_refuza($q$SELECT fn_probe_inchide(124,'respins',NULL,'teren/124/2',NULL,'Presiune cazuta','h-reject-press-close')$q$,'pt_presiune');
SELECT fn_probe_inchide(124,'respins',1,'teren/124/2',NULL,'Presiune cazuta','h-reject-press-close');
SELECT pt_assert((SELECT status='respinsa' AND presiune_finala_bar=1 FROM probe_calcule WHERE id=124),'respins imediat in presurizare');
SELECT pt_assert((SELECT count(*)=2 AND bool_and(limita_faza) FROM probe_log_executie WHERE calc_id=124),'respins fara citire intermediara');
SELECT fn_probe_porneste(125,NULL,NULL,NULL,'h-optional-start');
SELECT fn_probe_inchide(125,'respins',0,'teren/125/1',NULL,'Racord cedat','h-optional-close');
SELECT pt_assert((SELECT presiune_citita_bar=0 AND poza_manometru_path='teren/125/1' AND faza='umplere' FROM probe_log_executie WHERE calc_id=125),'dovezi optionale pastrate la respins umplere');
-- Istoricul hidraulic fara contor nu ascunde ultima valoare pneumatica.
RESET ROLE;
INSERT INTO probe_calcule(id,proiect_id,tip_fluid) VALUES(122,1,'apa');
SET LOCAL ROLE authenticated;
SELECT fn_probe_porneste(122,'[{"active_id":1,"rol":"pompa"}]',NULL,NULL,'h-same-asset');
SELECT fn_probe_opreste_utilaj(122,1,NULL,NULL,'terminat',NULL,NULL,'h-stop-asset');
SELECT pt_refuza($q$SELECT fn_probe_porneste(110,'[{"active_id":1,"rol":"compresor","ore_bord":103,"poza_path":"teren/110/2"}]',1,'teren/110/1','cross-fluid-decrease')$q$,'pt_bord_scade');
-- Runda 2: proiect obligatoriu inclusiv pentru tert, selectie neambigua.
RESET ROLE;
INSERT INTO executie_proiecte(id) VALUES(3);
INSERT INTO executie_tronsoane(id,proiect_id) VALUES(3,2);
SET LOCAL ROLE authenticated;
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(NULL,NULL,'apa','tert','comanda',NULL,'CMD','Client','tert-no-project')$q$,'pt_proiect');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(2,NULL,'apa','gazpet',NULL,NULL,NULL,NULL,'ambiguu')$q$,'pt_tronson');
SELECT fn_probe_creeaza_teren(2,3,'apa','gazpet',NULL,NULL,NULL,NULL,'ales-explicit') AS explicit_id \gset
SELECT pt_assert((SELECT tronson_id=3 FROM probe_calcule WHERE id=:'explicit_id'),'tronson ales din proiect cu doua tronsoane');
-- Creare rapida: proiect, tronson, tert si idempotenta globala.
SELECT fn_probe_creeaza_teren(1,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'create-no-tronson') AS created \gset
SELECT pt_assert(fn_probe_creeaza_teren(1,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'create-no-tronson')=:'created'::bigint,'retry creare cu tronson completat automat');
SELECT pt_assert((SELECT creat_din_teren AND status='planificata' AND faza_curenta IS NULL AND tronson_id=1 AND dn_id IS NULL AND lungime_m IS NULL AND presiune_bar IS NULL AND config_id IS NULL FROM probe_calcule WHERE id=:'created'),'proba minima cu NULL explicit');
SELECT fn_probe_creeaza_teren(1,1,'apa','gazpet',NULL,NULL,NULL,NULL,'create-tronson');
SELECT fn_probe_creeaza_teren(3,NULL,'apa','gazpet',NULL,NULL,NULL,NULL,'create-proiect-fara-tronson') AS fara_tronson \gset
SELECT pt_assert((SELECT tronson_id IS NULL FROM probe_calcule WHERE id=:'fara_tronson'),'proiect fara tronsoane acceptat');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(1,2,'aer','gazpet',NULL,NULL,NULL,NULL,'bad-tronson')$q$,'pt_tronson');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(999,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'bad-proiect')$q$,'pt_proiect');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(NULL,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'bad-proiect')$q$,'pt_proiect');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(1,NULL,'apa','tert',NULL,NULL,NULL,'Client','bad-tert')$q$,'pt_beneficiar');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(1,NULL,'apa','tert','contract',999,NULL,'Client','bad-tert')$q$,'pt_beneficiar');
SELECT fn_probe_creeaza_teren(1,NULL,'apa','tert','contract',1,NULL,'Client','create-contract');
SELECT fn_probe_creeaza_teren(1,NULL,'apa','tert','oferta',1,NULL,'Client','create-oferta');
SELECT fn_probe_creeaza_teren(1,NULL,'apa','tert','comanda',NULL,'CMD-123','Client','create-comanda');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(1,1,'apa','gazpet',NULL,NULL,NULL,NULL,'create-no-tronson')$q$,'pt_cheie_conflict');
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(1,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'e2-start')$q$,'pt_cheie_conflict');
SELECT pt_refuza('INSERT INTO probe_calcule(proiect_id,dn_id) VALUES(1,NULL)','probe_planificare_nn');
SELECT pt_refuza('UPDATE probe_calcule SET tip_fluid=''apa'' WHERE id=100','pt_faza_tip');
SELECT pt_refuza('UPDATE probe_log_executie SET faza=''presurizare'' WHERE calc_id=120','pt_rpc');
-- Verificari de ACL pentru toate punctele noi; rolul global nu acorda nimic.
SELECT pt_assert(NOT has_function_privilege('authenticated','probe_teren_scrie_e1(text,bigint,jsonb,text)','EXECUTE'),'writer legacy privat');
SELECT pt_assert(NOT has_function_privilege('anon','fn_probe_creeaza_teren(bigint,bigint,text,text,text,bigint,text,text,text)','EXECUTE'),'anon fara creare');
SELECT pt_assert(NOT has_function_privilege('service_role','fn_probe_schimba_faza(bigint,text,numeric,text,jsonb,text,boolean,text,text)','EXECUTE'),'service role fara faze');
SELECT pt_refuza('SELECT * FROM probe_teren_e2a_schema','permission denied');
DO $pt2_test_drepturi$
DECLARE uid text;
BEGIN
 FOREACH uid IN ARRAY ARRAY['00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006',''] LOOP
   PERFORM set_config('request.jwt.claim.sub',uid,true);
   PERFORM pt_refuza($q$SELECT fn_probe_creeaza_teren(1,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'no-right')$q$,'pt_acces');
   PERFORM pt_refuza($q$SELECT fn_probe_schimba_faza(100,'uscare',1,NULL,'[]',NULL,false,NULL,'no-right')$q$,'pt_acces');
   PERFORM pt_refuza($q$SELECT fn_probe_porneste(110,'[]',NULL,NULL,'no-right')$q$,'pt_acces');
   PERFORM pt_refuza($q$SELECT fn_probe_citire(100,1,NULL,'[]',NULL,false,NULL,'no-right')$q$,'pt_acces');
   PERFORM pt_refuza($q$SELECT fn_probe_inchide(100,'admis',1,NULL,'[]',NULL,'no-right')$q$,'pt_acces');
   PERFORM pt_refuza($q$SELECT fn_probe_opreste_utilaj(100,1,NULL,NULL,'terminat',NULL,NULL,'no-right')$q$,'pt_acces');
 END LOOP;
END $pt2_test_drepturi$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pt_refuza($q$SELECT fn_probe_creeaza_teren(1,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'create-no-tronson')$q$,'pt_cheie_conflict');
SELECT fn_probe_creeaza_teren(1,NULL,'aer','gazpet',NULL,NULL,NULL,NULL,'owner-create');
RESET ROLE;
ROLLBACK;
\echo PASS probe_teren E2a SQL
