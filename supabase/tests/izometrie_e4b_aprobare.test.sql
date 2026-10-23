-- Synthetic, transaction-local fixtures. Run only through test_izometrie_e4b.sh.
BEGIN;
DO $test$ BEGIN
 IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF;
 IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'gate'; END IF;
 IF has_function_privilege('authenticated','public.fn_izo_birou_fapt(bigint,text,text,bigint,integer,uuid,text,timestamptz,text)','EXECUTE')
  OR has_function_privilege('anon','public.fn_izo_aproba(uuid,bigint,jsonb,text,jsonb)','EXECUTE')
  OR has_column_privilege('authenticated','public.izo_aprobari','hash_cerere','SELECT') THEN RAISE EXCEPTION 'private ACL'; END IF;
END $test$;
UPDATE public.profiles SET employee_id=121 WHERE id='00000000-0000-0000-0000-000000000121';
-- Existing employee/profile pair; owner bypass only inside this rolled-back fixture.
UPDATE public.profiles SET employee_id=117,is_owner=true WHERE id='00000000-0000-0000-0000-000000000117';
SELECT public.fn_izo_seteaza_nivel(3,'stoc','fixture E4b approval');
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_tronson_config(tronson_id,proiect_id) VALUES(19,3);
SELECT public.fn_izo_seteaza_flux(19,true,'fixture E4b approval');
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $fixture$
DECLARE v_id bigint; v_i integer;
BEGIN
 FOR v_i IN 1..6 LOOP
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,diametru_mm,
   lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,locatie_tip,locatie_site_id,tronson_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E4B2-'||v_i,'SARJA',8,610,
   12000,12000,12,12,'AB','A','B','beneficiar',CASE WHEN v_i<=3 OR v_i=6 THEN 'pe_tronson' WHEN v_i=4 THEN 'sosit' ELSE 'carantina' END,
   CASE WHEN v_i<=3 OR v_i=6 THEN 'tronson' ELSE 'depozit' END,6,CASE WHEN v_i<=3 OR v_i=6 THEN 19 END,CASE WHEN v_i IN (4,5) THEN 9 END,'manual');
  PERFORM set_config('test.e4b2.b'||v_i,v_id::text,true);
 END LOOP;
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_r jsonb; v_i integer; v_seq integer:=1; v_op jsonb;
 v_device uuid:='00000000-0000-0000-0000-00000000b201'; v_session uuid:='00000000-0000-0000-0000-00000000b202';
BEGIN
 v_r:=public.fn_izo_teren_pregateste(3,19,v_device);
 IF NOT v_r ? 'checksum' THEN RAISE EXCEPTION 'prepare %',v_r; END IF;
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,
  'tip_op','sesiune_deschide','payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_session,'zi',(now() AT TIME ZONE 'Europe/Bucharest')::date))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'session %',v_r; END IF;
 FOR v_i IN 1..4 LOOP
  v_seq:=v_seq+1;
  v_op:=jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',
   jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',gen_random_uuid(),'preverificare_uid',v_session,'versiune_baza',0,'tip','montaj',
    'bucata',jsonb_build_object('bucata_id',current_setting('test.e4b2.b'||v_i)::bigint),'lungime_montata_mm',12000,
    'confirmare',jsonb_build_object('mod','marcaj','cm',0)));
  v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
  IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'declaration %',v_r; END IF;
 END LOOP;
 v_seq:=v_seq+1;
 v_op:=jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',
  jsonb_build_object('proiect_id',3,'tronson_id',19,'uid','00000000-0000-0000-0000-00000000b206','preverificare_uid',v_session,
   'versiune_baza',0,'tip','montaj','serie_bruta','NECUNOSCUTA','lungime_masurata_mm',12000,'lungime_montata_mm',12000,
   'confirmare',jsonb_build_object('mod','marcaj','cm',0)));
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'unresolved declaration %',v_r; END IF;
 v_seq:=v_seq+1;
 v_op:=jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','sesiune_trimite','payload',
  jsonb_build_object('proiect_id',3,'tronson_id',19,'preverificare_uid',v_session,'randuri',
   (SELECT jsonb_agg(jsonb_build_object('uid',uid,'versiune',versiune) ORDER BY uid) FROM public.izo_declaratii WHERE tronson_id=19)));
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(v_op));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'submit %',v_r; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$
DECLARE v_s bigint; v_d public.izo_declaratii; v_other bigint; v_preview jsonb; v_rows jsonb; v_r jsonb; v_retry jsonb;
 v_key uuid:=gen_random_uuid(); v_rej uuid:=gen_random_uuid(); v_exit uuid:=gen_random_uuid(); v_n bigint;
BEGIN
 SELECT id INTO v_s FROM public.izo_preverificari WHERE uid='00000000-0000-0000-0000-00000000b202';
 SELECT * INTO v_d FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b1')::bigint;
 v_preview:=public.fn_izo_aprobare_lot(v_s);
 v_rows:=jsonb_build_array(jsonb_build_object('declaratie_id',v_d.id,'versiune',v_d.versiune,'updated_at',v_d.updated_at));
 -- Stale CAS: current preview, wrong timestamp. No registry event may survive.
 BEGIN
  PERFORM public.fn_izo_aproba(gen_random_uuid(),v_s,jsonb_set(v_rows,'{0,updated_at}',to_jsonb(v_d.updated_at-interval '1 second')),v_preview->>'amprenta','{}');
  RAISE EXCEPTION 'stale CAS accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cas' THEN RAISE; END IF; END;
 v_r:=public.fn_izo_aproba(v_key,v_s,v_rows,v_preview->>'amprenta','{}');
 IF v_r->>'cod'<>'aprobat' THEN RAISE EXCEPTION 'approve %',v_r; END IF;
 v_retry:=public.fn_izo_aproba(v_key,v_s,v_rows,v_preview->>'amprenta','{}');
 IF v_retry IS DISTINCT FROM v_r THEN RAISE EXCEPTION 'approval retry'; END IF;
 IF (SELECT stare FROM public.izo_preverificari WHERE id=v_s)<>'trimisa'
  OR (SELECT stare FROM public.magazie_bucati WHERE id=v_d.bucata_id)<>'montata' THEN RAISE EXCEPTION 'partial approval'; END IF;
 IF EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_d.id AND activa) THEN RAISE EXCEPTION 'approval reservation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_rezervari r JOIN public.magazie_bucati_evenimente e ON e.id=r.eveniment_id
   JOIN public.magazie_bucati_miscari m ON m.eveniment_id=e.id AND m.bucata_id=r.bucata_id
   WHERE r.declaratie_id=v_d.id AND r.motiv_eliberare='consumata' AND e.tip='montaj' AND m.rol='montat'
    AND e.declarat_de=v_d.declarat_de AND e.aplicat_de='00000000-0000-0000-0000-000000000117') THEN RAISE EXCEPTION 'fact reconciliation'; END IF;
 -- New key must not apply an already approved declaration again.
 v_preview:=public.fn_izo_aprobare_lot(v_s);
 BEGIN PERFORM public.fn_izo_aproba(gen_random_uuid(),v_s,v_rows,v_preview->>'amprenta','{}'); RAISE EXCEPTION 'double approve accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cas' THEN RAISE; END IF; END;
 BEGIN PERFORM public.fn_izo_aproba(v_key,v_s,v_rows,v_preview->>'amprenta','{}'); RAISE EXCEPTION 'reused key accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cheie_refolosita' THEN RAISE; END IF; END;
 SELECT * INTO v_d FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b2')::bigint;
 v_r:=public.fn_izo_respinge(v_rej,v_d.id,v_d.versiune,v_d.updated_at,'fixture respingere','{}');
 IF v_r->>'cod'<>'respinsa' OR EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_d.id AND activa) THEN RAISE EXCEPTION 'reject reservation'; END IF;
 IF public.fn_izo_respinge(v_rej,v_d.id,v_d.versiune,v_d.updated_at,'fixture respingere','{}') IS DISTINCT FROM v_r THEN RAISE EXCEPTION 'reject retry'; END IF;
 -- The synced depot declaration cannot be approved before its depot exit.
 SELECT * INTO v_d FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b4')::bigint;
 v_preview:=public.fn_izo_aprobare_lot(v_s);
 BEGIN PERFORM public.fn_izo_aproba(gen_random_uuid(),v_s,
  jsonb_build_array(jsonb_build_object('declaratie_id',v_d.id,'versiune',v_d.versiune,'updated_at',v_d.updated_at)),v_preview->>'amprenta','{}');
  RAISE EXCEPTION 'depot mount without exit accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stare' THEN RAISE; END IF; END;
 -- Failed depot batch is atomic even when its first piece is valid.
 BEGIN PERFORM public.fn_izo_iesire_tronson(gen_random_uuid(),9,19,ARRAY[current_setting('test.e4b2.b4')::bigint,current_setting('test.e4b2.b5')::bigint],'CJPT-TEST',current_date);
  RAISE EXCEPTION 'quarantine accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stare' THEN RAISE; END IF; END;
 IF (SELECT stare FROM public.magazie_bucati WHERE id=current_setting('test.e4b2.b4')::bigint)<>'sosit' THEN RAISE EXCEPTION 'failed exit changed stock'; END IF;
 BEGIN PERFORM public.fn_izo_iesire_tronson(gen_random_uuid(),10,19,ARRAY[current_setting('test.e4b2.b4')::bigint],'CJPT-TEST',current_date);
  RAISE EXCEPTION 'wrong depot accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stare' THEN RAISE; END IF; END;
 v_r:=public.fn_izo_iesire_tronson(v_exit,9,19,ARRAY[current_setting('test.e4b2.b4')::bigint],'CJPT-TEST',current_date);
 IF v_r->>'cod'<>'iesit' THEN RAISE EXCEPTION 'depot exit %',v_r; END IF;
 IF public.fn_izo_iesire_tronson(v_exit,9,19,ARRAY[current_setting('test.e4b2.b4')::bigint],'CJPT-TEST',current_date) IS DISTINCT FROM v_r THEN RAISE EXCEPTION 'exit retry'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.magazie_bucati WHERE id=current_setting('test.e4b2.b4')::bigint AND stare='pe_tronson'
  AND tronson_id=19 AND depozit_id IS NULL AND atribute->>'depozit_origine_id'='9') THEN RAISE EXCEPTION 'exit projection'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_d.id AND activa) THEN RAISE EXCEPTION 'exit lost reservation'; END IF;
 SELECT count(*) INTO v_n FROM public.magazie_bucati_evenimente WHERE document_tip='izo_declaratie' AND tip='montaj';
 IF v_n<>1 THEN RAISE EXCEPTION 'approval event duplicate'; END IF;
 SELECT * INTO v_d FROM public.izo_declaratii WHERE uid='00000000-0000-0000-0000-00000000b206';
 IF v_d.stare<>'in_verificare' THEN RAISE EXCEPTION 'unresolved blocked submission'; END IF;
 BEGIN PERFORM public.fn_izo_serie_lamureste(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,current_setting('test.e4b2.b3')::bigint,'fixture serie');
  RAISE EXCEPTION 'reserved series accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'bucata_rezervata' THEN RAISE; END IF; END;
 v_r:=public.fn_izo_serie_lamureste(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,current_setting('test.e4b2.b6')::bigint,'fixture serie');
 IF v_r->>'cod'<>'lamurita' OR v_r->>'stare'<>'trimisa' OR NOT EXISTS(SELECT 1 FROM public.izo_rezervari
   WHERE declaratie_id=v_d.id AND declaratie_versiune=v_d.versiune+1 AND bucata_id=current_setting('test.e4b2.b6')::bigint AND activa) THEN RAISE EXCEPTION 'series reservation %',v_r; END IF;
 SELECT * INTO v_d FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b3')::bigint;
 v_r:=public.fn_izo_revizie_cere(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,'fixture revizie');
 IF v_r->>'cod'<>'revizie_ceruta' OR NOT EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_d.id AND activa) THEN RAISE EXCEPTION 'revision lost reservation'; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000115","role":"authenticated"}',true);
DO $test$ DECLARE v_s bigint; BEGIN
 SELECT id INTO v_s FROM public.izo_preverificari WHERE uid='00000000-0000-0000-0000-00000000b202';
 BEGIN PERFORM public.fn_izo_aprobare_lot(v_s); RAISE EXCEPTION 'non-MP accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.fn_izo_iesire_tronson(gen_random_uuid(),9,19,ARRAY[current_setting('test.e4b2.b4')::bigint],'CJPT-TEST',current_date);
  RAISE EXCEPTION 'non-depot accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$ DECLARE v_d public.izo_declaratii; v_preview jsonb; BEGIN
 SELECT * INTO v_d FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b6')::bigint;
 v_preview:=public.fn_izo_aprobare_lot(v_d.preverificare_id);
 BEGIN PERFORM public.fn_izo_aproba(gen_random_uuid(),v_d.preverificare_id,
  jsonb_build_array(jsonb_build_object('declaratie_id',v_d.id,'versiune',v_d.versiune,'updated_at',v_d.updated_at)),v_preview->>'amprenta','{}');
  RAISE EXCEPTION 'owner self approval accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
DO $test$ DECLARE v_d public.izo_declaratii; v_r jsonb; BEGIN
 SELECT * INTO v_d FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b3')::bigint;
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b201',jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),
  'seq',8,'versiune_format',1,'tip_op','decl_salveaza','payload',v_d.payload||jsonb_build_object('versiune_baza',v_d.versiune))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' OR v_r#>>'{rezultate,0,stare}'<>'trimisa' THEN RAISE EXCEPTION 'revision resubmit %',v_r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_d.id AND declaratie_versiune=v_d.versiune+1 AND activa AND expira_dupa IS NULL) THEN RAISE EXCEPTION 'submitted revision expires'; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$ DECLARE v_r jsonb; BEGIN
 v_r:=public.fn_izo_front_elibereaza(19,'fixture front');
 IF v_r->>'cod'<>'eliberat' THEN RAISE EXCEPTION 'front release %',v_r; END IF;
 v_r:=public.fn_izo_front_elibereaza(19,'fixture front');
 IF v_r->>'cod'<>'fara_efect' THEN RAISE EXCEPTION 'front release retry %',v_r; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip IN ('izo_declaratie','izo_iesire') AND aplicat_rol<>'izo_montaj_writer') THEN RAISE EXCEPTION 'wrong registry writer'; END IF;
 IF (SELECT count(*) FROM public.izo_aprobari)<>1 THEN RAISE EXCEPTION 'approval journal duplicate'; END IF;
 BEGIN UPDATE public.izo_declaratii SET stare='revizie_ceruta' WHERE stare='aprobata'; RAISE EXCEPTION 'final declaration changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.izo_aprobari SET amprenta_preview='changed' WHERE proiect_id=3; RAISE EXCEPTION 'approval journal changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
ROLLBACK;
SELECT 'E4B_APROBARE_TEST_END';
