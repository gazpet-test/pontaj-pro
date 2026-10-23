-- Synthetic facts only; no grants, no imports; all fixture writes roll back.
BEGIN;
DO $test$ BEGIN
 IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF;
 IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'gate'; END IF;
 IF has_column_privilege('authenticated','public.izo_operatii','hash_cerere','SELECT')
  OR has_column_privilege('authenticated','public.izo_declaratii_versiuni','hash_cerere','SELECT')
  OR has_table_privilege('authenticated','public.izo_declaratii_gps','SELECT')
  OR has_function_privilege('authenticated','public.fn_izo_teren_push(uuid,jsonb)','EXECUTE')
  OR has_table_privilege('izo_teren_editor','public.magazie_bucati','UPDATE') THEN RAISE EXCEPTION 'private ACL exposed'; END IF;
END $test$;
UPDATE public.profiles SET employee_id=121 WHERE id='00000000-0000-0000-0000-000000000121';
SELECT public.fn_izo_seteaza_nivel(3,'stoc','fixture E4b');
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_tronson_config(tronson_id,proiect_id) VALUES(19,3);
SELECT public.fn_izo_seteaza_flux(19,true,'fixture E4b');
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $fixture$
DECLARE v_id bigint; v_i integer;
BEGIN
 FOR v_i IN 1..3 LOOP
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,diametru_mm,
   lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,locatie_tip,locatie_site_id,tronson_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E4B-'||v_i,'SARJA',8,610,
   12000,12000,12,12,'AB','A','B','beneficiar','pe_tronson','tronson',6,19,'manual');
  PERFORM set_config('test.e4b.b'||v_i,v_id::text,true);
 END LOOP;
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SELECT set_config('test.e4b.before',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM public.magazie_bucati b),true);
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_r jsonb; v_op jsonb; v_ops jsonb; v_snapshot jsonb; v_device uuid:='00000000-0000-0000-0000-00000000b001';
 v_session uuid:='00000000-0000-0000-0000-00000000b002'; v_decl uuid:='00000000-0000-0000-0000-00000000b003';
 v_b bigint:=current_setting('test.e4b.b1')::bigint; v_count bigint;
BEGIN
 v_r:=public.fn_izo_teren_pregateste(3,19,v_device);
 IF NOT v_r ? 'checksum' OR NOT v_r ? 'snapshot_id' THEN RAISE EXCEPTION 'prepare snapshot %',v_r; END IF;
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',1,'versiune_format',1,'tip_op','sesiune_deschide',
  'payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_session,'zi',(now() AT TIME ZONE 'Europe/Bucharest')::date))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'session %',v_r; END IF;
 v_op:=jsonb_build_object('op_id',gen_random_uuid(),'seq',2,'versiune_format',1,'tip_op','decl_salveaza','ora_tableta',now(),
  'payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_decl,'preverificare_uid',v_session,'versiune_baza',0,'tip','montaj',
   'bucata',jsonb_build_object('bucata_id',v_b),'lungime_montata_mm',12000,'confirmare',jsonb_build_object('mod','marcaj','cm',0),
   'gps',jsonb_build_object('lat',44.1,'lon',26.2,'precizie_m',5,'la',now())));
 v_ops:=jsonb_build_array(v_op);
 v_r:=public.fn_izo_sync_push(v_device,v_ops);
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'push %',v_r; END IF;
 v_r:=public.fn_izo_sync_push(v_device,v_ops);
 IF v_r#>>'{rezultate,0,cod}'<>'duplicat' OR v_r#>>'{rezultate,0,raspuns,cod}'<>'acceptat' THEN RAISE EXCEPTION 'retry %',v_r; END IF;
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(jsonb_set(v_op,'{payload,gps,lat}','45.1')));
 IF v_r#>>'{rezultate,0,cod}'<>'conflict_op' THEN RAISE EXCEPTION 'GPS hash %',v_r; END IF;
 v_snapshot:=public.fn_izo_teren_instantaneu(3,19);
 IF jsonb_path_exists(v_snapshot,'$.**.gps') OR jsonb_path_exists(v_snapshot,'$.**.lat') OR jsonb_path_exists(v_snapshot,'$.**.hash_cerere') THEN RAISE EXCEPTION 'snapshot GPS/hash leak'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_snapshot->'frunze') f WHERE (f->>'id')::bigint=v_b AND (f->>'rezervata')::boolean AND NOT (f->>'disponibila')::boolean) THEN
  RAISE EXCEPTION 'reservation did not lower availability'; END IF;
 SELECT count(*) INTO v_count FROM public.izo_declaratii WHERE uid=v_decl;
 IF v_count<>1 THEN RAISE EXCEPTION 'duplicate declaration'; END IF;
 -- A new operation with the same declaration and base=0 is a final CAS conflict.
 v_op:=jsonb_set(jsonb_set(v_op,'{op_id}',to_jsonb(gen_random_uuid())),'{seq}','3');
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
 IF v_r#>>'{rezultate,0,cod}'<>'conflict' THEN RAISE EXCEPTION 'CAS %',v_r; END IF;
 -- A different declaration on the reserved piece rolls back all its effects.
 v_op:=jsonb_set(jsonb_set(jsonb_set(v_op,'{op_id}',to_jsonb(gen_random_uuid())),'{seq}','4'),'{payload,uid}',to_jsonb(gen_random_uuid()));
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
 IF v_r#>>'{rezultate,0,cod}'<>'conflict' THEN RAISE EXCEPTION 'reservation race %',v_r; END IF;
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000ffff',jsonb_build_array(v_op));
 IF v_r->>'cod'<>'alt_dispozitiv' THEN RAISE EXCEPTION 'device %',v_r; END IF;
 -- Cutting reserves the source and the letters, without changing registry stock.
 v_op:=jsonb_build_object('op_id',gen_random_uuid(),'seq',5,'versiune_format',1,'tip_op','decl_salveaza','payload',
  jsonb_build_object('proiect_id',3,'tronson_id',19,'uid','00000000-0000-0000-0000-00000000b010','preverificare_uid',v_session,
   'versiune_baza',0,'tip','taiere','sursa',jsonb_build_object('bucata_id',current_setting('test.e4b.b2')::bigint),
   'baza_mm',12000,'puncte_mm',jsonb_build_array(8000),'confirmare',jsonb_build_object('mod','marcaj','cm',0),
   'copii',jsonb_build_array(jsonb_build_object('uid','00000000-0000-0000-0000-00000000b011','lungime_mm',8000,'destinatie','montaj'),
    jsonb_build_object('uid','00000000-0000-0000-0000-00000000b012','lungime_mm',4000,'destinatie','depozit'))));
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' OR v_r#>>'{rezultate,0,stare}'<>'ciorna' THEN RAISE EXCEPTION 'cut %',v_r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_bucati_declarate WHERE uid='00000000-0000-0000-0000-00000000b011' AND cod_bucata='AC')
  OR NOT EXISTS(SELECT 1 FROM public.izo_bucati_declarate WHERE uid='00000000-0000-0000-0000-00000000b012' AND cod_bucata='CB') THEN RAISE EXCEPTION 'cut letters'; END IF;
 -- An equal-length sibling pair is accepted as a conflict declaration (R1d).
 v_op:=jsonb_set(jsonb_set(jsonb_set(v_op,'{op_id}',to_jsonb(gen_random_uuid())),'{seq}','6'),'{payload,uid}','"00000000-0000-0000-0000-00000000b020"');
 v_op:=jsonb_set(v_op,'{payload,sursa,bucata_id}',to_jsonb(current_setting('test.e4b.b3')::bigint));
 v_op:=jsonb_set(v_op,'{payload,puncte_mm}','[6000]');
 v_op:=jsonb_set(v_op,'{payload,copii}','[{"uid":"00000000-0000-0000-0000-00000000b021","lungime_mm":6000,"destinatie":"montaj"},{"uid":"00000000-0000-0000-0000-00000000b022","lungime_mm":6000,"destinatie":"depozit"}]');
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' OR v_r#>>'{rezultate,0,stare}'<>'conflict' OR v_r#>>'{rezultate,0,conflict_cod}'<>'r1d' THEN RAISE EXCEPTION 'R1d %',v_r; END IF;
 -- A real client UPDATE may refuse through ACL or through RLS (zero rows).
 BEGIN
  UPDATE public.izo_declaratii SET stare='aprobata' WHERE uid=v_decl;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>0 THEN RAISE EXCEPTION 'client write accepted'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}',true);
DO $test$ DECLARE v_r jsonb; BEGIN
 v_r:=public.fn_izo_teren_instantaneu(3,19);
 IF v_r->>'cod'<>'fara_drept' THEN RAISE EXCEPTION 'unauthorized user %',v_r; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$
BEGIN
 IF current_setting('test.e4b.before')::jsonb IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.magazie_bucati b) THEN RAISE EXCEPTION 'push wrote official registry'; END IF;
 IF EXISTS(SELECT 1 FROM public.izo_operatii WHERE payload ? 'gps') OR EXISTS(SELECT 1 FROM public.izo_declaratii_versiuni WHERE payload ? 'gps') THEN RAISE EXCEPTION 'GPS persisted in JSON'; END IF;
 BEGIN UPDATE public.izo_operatii SET cod='changed' WHERE canal='teren'; RAISE EXCEPTION 'journal update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.izo_operatii; RAISE EXCEPTION 'journal truncate accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
ROLLBACK;
SELECT 'E4B_TEST_END';
