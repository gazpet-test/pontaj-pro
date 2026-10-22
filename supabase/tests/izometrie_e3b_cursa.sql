-- Fixture numai pentru baza separata a cursei E1.
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
INSERT INTO public.izo_proiect_config(proiect_id,nivel_izo,server_ver) VALUES(3,'stoc',nextval('public.izo_server_ver_seq'));
DO $fixture$
DECLARE v_id bigint := nextval('public.magazie_bucati_id_seq');
BEGIN
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,
    lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,
    locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E3B-C1-FIXTURE','SARJA-C1',8,
    12000,12000,12,12,'AB','A','B','beneficiar','receptionat','depozit',6,11,'manual');
  PERFORM set_config('test.c1_bucata',v_id::text,true);
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,
    lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,
    locatie_tip,locatie_site_id,tronson_id,sursa_receptie,atribute)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','C1-TRONSON','C1-S',8,
    12000,12000,12,12,'AB','A','B','beneficiar','pe_tronson','tronson',6,16,'manual','{"depozit_origine_id":11}');
  PERFORM set_config('test.c1_tronson',v_id::text,true);
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
VALUES(3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture C1');

SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SELECT public.fn_izo_cor_propune('pierdut',3,current_setting('test.c1_bucata')::bigint,'{"cauza":"disparuta"}','fixture cursa E1');
RESET ROLE;
RESET SESSION AUTHORIZATION;
COMMIT;
