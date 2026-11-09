-- Inclus in tranzactia E2a; helpers pt_assert/pt_refuza exista deja.
-- 880 a fost creata si pornita prin fn_probe_porneste INAINTE de E2a in harness.
SELECT pt_assert((SELECT faza_curenta IS NULL AND tip_fluid='aer' AND status='in_executie' FROM probe_calcule WHERE id=880),'legacy pornita pe E1, fara faza');
SELECT pt_assert((SELECT proowner FROM pg_proc WHERE oid='public.fn_probe_creeaza_teren(bigint,bigint,text,text,text,bigint,text,text,text)'::regprocedure)=
  (SELECT proowner FROM pg_proc WHERE oid='public.probe_teren_scrie(text,bigint,jsonb,text)'::regprocedure),'owner creare identic cu writer');
INSERT INTO storage.objects SELECT 'probe-citiri','teren/880/'||p FROM unnest(ARRAY['citire','contor','oprire','inlocuitor','final-inlocuitor']) p;
-- Numai fixture: deplasam pornirea E1 pentru a permite citirea la 6 ore.
UPDATE probe_calcule SET ora_start=now()-interval '6 hours' WHERE id=880;
UPDATE probe_log_executie SET ora_citire=now()-interval '6 hours' WHERE calc_id=880;
UPDATE probe_exec_utilaje SET ora_start=now()-interval '6 hours' WHERE calc_id=880;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT fn_probe_completeaza_executie(880,1,20,'Operator','Responsabil',NULL,NULL,NULL,'legacy-complete-before');
SELECT pt_refuza($q$SELECT fn_probe_schimba_faza(880,'uscare',1,NULL,'[]',NULL,false,NULL,'legacy-phase')$q$,'pt_faza_legacy');
SELECT fn_probe_citire(880,2,'teren/880/citire','[{"active_id":12,"ore_bord":101,"poza_path":"teren/880/contor"}]',NULL,false,NULL,'legacy-read');
SELECT fn_probe_opreste_utilaj(880,12,102,'teren/880/oprire','inlocuit','Defect','{"active_id":11,"rol":"compresor","ore_bord":100,"poza_path":"teren/880/inlocuitor"}','legacy-replace');
SELECT pt_assert((SELECT inlocuit_prin IS NOT NULL AND ora_stop=now() FROM probe_exec_utilaje WHERE calc_id=880 AND active_id=12),'legacy inlocuire atomica');
SELECT fn_probe_inchide(880,'admis',2,'teren/880/final','[{"active_id":11,"ore_bord":101,"poza_path":"teren/880/final-inlocuitor"}]','Confirm','legacy-close');
SELECT fn_probe_completeaza_executie(880,1,18,'Operator final','Responsabil','pv/legacy.pdf',now(),'aep/legacy.pdf','legacy-complete-after');
SELECT pt_assert((SELECT faza_curenta IS NULL AND status='finalizata' AND temperatura_c=18 AND pv_path='pv/legacy.pdf' AND durata_reala_h=6 FROM probe_calcule WHERE id=880),'legacy inchidere si completare dupa inchidere');
SELECT pt_assert((SELECT count(*)=3 AND bool_and(faza IS NULL) FROM probe_log_executie WHERE calc_id=880),'legacy pastreaza trei citiri fara faza');
SELECT pt_assert((SELECT count(*)=2 AND bool_and(ora_stop IS NOT NULL AND faza_start IS NULL AND faza_stop IS NULL) FROM probe_exec_utilaje WHERE calc_id=880),'legacy utilaje oprite fara faze');
-- Ofertare: INSERT RETURNING inainte de oferta, fara drept probe_teren.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
SELECT pt_assert(NOT probe_teren_drept(false) AND NOT probe_teren_drept(true),'comercial fara drept teren');
INSERT INTO probe_calcule(id,proiect_id,status,v_conducta_mc) VALUES(881,NULL,'planificata',10) RETURNING id AS compat_calc_id \gset
SELECT pt_assert(:'compat_calc_id'::bigint=881,'INSERT RETURNING Ofertare pe E2a');
INSERT INTO probe_oferte(id,client,calc_id) VALUES(881,'Compatibilitate Ofertare',881);
SELECT pt_assert((SELECT calc_id=881 FROM probe_oferte WHERE id=881),'oferta legata dupa calcul');
SELECT pt_assert((SELECT beneficiar_tip IS NULL AND NOT creat_din_teren FROM probe_calcule WHERE id=881),'calcul comercial preliminar vizibil');
SELECT pt_refuza($q$SELECT fn_probe_porneste(881,'[]',1,NULL,'compat-no-start')$q$,'pt_acces');
SELECT pt_refuza($q$SELECT fn_probe_completeaza_executie(881,NULL,20,NULL,NULL,NULL,NULL,NULL,'compat-no-complete')$q$,'pt_acces');
RESET ROLE;
\echo PASS probe_teren E1 compat pe E2a SQL
