-- Included inside caller transaction (or committed only in isolated concurrency DB).
DO $$ BEGIN IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
UPDATE public.profiles SET employee_id=30 WHERE id='00000000-0000-0000-0000-000000000030';
UPDATE public.profiles SET employee_id=121 WHERE id='00000000-0000-0000-0000-000000000121';
SELECT public.fn_izo_seteaza_nivel(3,'stoc','fixture AVIZ');
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_tronson_config(tronson_id,proiect_id) VALUES(19,3);
SELECT public.fn_izo_seteaza_flux(19,true,'fixture AVIZ');
-- Existing owner profile emits; no user_module_access/role data changes.
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $fixture$
DECLARE v_id bigint; v_i int;
BEGIN
 FOR v_i IN 1..12 LOOP
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,diametru_mm,
   lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,greutate_kg,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','AVIZ-'||v_i,'S-TEST',8,610,
   12000,12000,12,12,123.5,'AB','A','B','beneficiar',CASE WHEN v_i=4 THEN 'carantina' ELSE 'sosit' END,'depozit',6,
   CASE WHEN v_i=3 THEN 10 ELSE 9 END,'manual');
  PERFORM set_config('test.aviz.b'||v_i,v_id::text,true);
 END LOOP;
 -- 13 = curbă fără lungime (admisă pe aviz); 14 = curbă fără masă (refuzată: instantaneu_incomplet).
 FOR v_i IN 13..14 LOOP
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,diametru_mm,unghi_curba,
   greutate_kg,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,3,'curba','AVIZ-'||v_i,'S-TEST',8,610,
   20,CASE WHEN v_i=13 THEN 321.5 END,'AB','A','B','beneficiar','sosit','depozit',6,9,'manual');
  PERFORM set_config('test.aviz.b'||v_i,v_id::text,true);
 END LOOP;
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
