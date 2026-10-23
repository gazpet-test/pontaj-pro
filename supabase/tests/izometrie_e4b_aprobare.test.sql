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
 FOR v_i IN 1..11 LOOP
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,diametru_mm,
   lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,locatie_tip,locatie_site_id,tronson_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E4B2-'||v_i,'SARJA',8,610,
   12000,12000,12,12,'AB','A','B','beneficiar',CASE WHEN v_i<=3 OR v_i>=6 THEN 'pe_tronson' WHEN v_i=4 THEN 'sosit' ELSE 'carantina' END,
   CASE WHEN v_i<=3 OR v_i>=6 THEN 'tronson' ELSE 'depozit' END,6,CASE WHEN v_i<=3 OR v_i>=6 THEN 19 END,CASE WHEN v_i IN (4,5) THEN 9 END,'manual');
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
-- Included inside the existing rolled-back fixture, after all E4b-2 assertions.
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_r jsonb; v_ops jsonb:='[]'; v_i integer; v_seq integer:=1; v_t uuid; v_m uuid; v_c uuid; v_rest uuid; v_p jsonb;
 v_device uuid:='00000000-0000-0000-0000-00000000b301'; v_session uuid:='00000000-0000-0000-0000-00000000b302';
BEGIN
 v_r:=public.fn_izo_teren_pregateste(3,19,v_device);
 IF NOT v_r ? 'checksum' THEN RAISE EXCEPTION 'cut prepare %',v_r; END IF;
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',1,'versiune_format',1,
  'tip_op','sesiune_deschide','payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_session,'zi',(now() AT TIME ZONE 'Europe/Bucharest')::date))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'cut session %',v_r; END IF;
 FOR v_i IN 7..11 LOOP
  v_t:=gen_random_uuid(); v_m:=gen_random_uuid(); v_c:=gen_random_uuid(); v_rest:=gen_random_uuid();
  PERFORM set_config('test.e4b3.t'||v_i,v_t::text,true);
  PERFORM set_config('test.e4b3.m'||v_i,v_m::text,true);
  PERFORM set_config('test.e4b3.c'||v_i,v_c::text,true);
  v_p:=jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_t,'preverificare_uid',v_session,'versiune_baza',0,'tip','taiere',
   'sursa',jsonb_build_object('bucata_id',current_setting('test.e4b2.b'||v_i)::bigint),'baza_mm',12000,'puncte_mm',jsonb_build_array(8000),
   'confirmare',jsonb_build_object('mod','marcaj','cm',0),'copii',jsonb_build_array(
    jsonb_build_object('uid',v_c,'lungime_mm',8000,'destinatie','montaj'),
    jsonb_build_object('uid',v_rest,'lungime_mm',4000,'destinatie','depozit','depozit_destinatie_id',9,'calculata',true)));
  v_seq:=v_seq+1;
  v_ops:=v_ops||jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',v_p));
  v_p:=jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_m,'preverificare_uid',v_session,'versiune_baza',0,
   'tip',CASE WHEN v_i IN (8,10) THEN 'taiere' ELSE 'montaj' END,'depinde_de_uid',v_t,'depinde_de_versiune',1,'confirmare',jsonb_build_object('mod','taiata'));
  IF v_i IN (8,10) THEN
   v_p:=v_p||jsonb_build_object('sursa',jsonb_build_object('decl_uid',v_c),'baza_mm',8000,'puncte_mm',jsonb_build_array(5500),
    'copii',jsonb_build_array(jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',5500,'destinatie','montaj'),
     jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',2500,'destinatie','depozit','depozit_destinatie_id',9)));
  ELSE v_p:=v_p||jsonb_build_object('bucata',jsonb_build_object('decl_uid',v_c),'lungime_montata_mm',8000); END IF;
  v_seq:=v_seq+1;
  v_ops:=v_ops||jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',v_p));
 END LOOP;
 v_r:=public.fn_izo_sync_push(v_device,v_ops);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'rezultate') x WHERE x->>'cod'<>'acceptat') THEN RAISE EXCEPTION 'cut sync %',v_r; END IF;
 v_seq:=v_seq+1;
 v_r:=public.fn_izo_sync_push(v_device,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','sesiune_trimite',
  'payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'preverificare_uid',v_session,'randuri',
   (SELECT jsonb_agg(jsonb_build_object('uid',d.uid,'versiune',d.versiune)) FROM public.izo_declaratii d
    JOIN public.izo_preverificari s ON s.id=d.preverificare_id WHERE s.uid=v_session)))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'cut submit %',v_r; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
-- Force isolated fixture deviations to prove pre-apply refusals on the public API.
DO $test$ DECLARE v_s bigint; v_p jsonb; BEGIN
 SELECT id INTO STRICT v_s FROM public.izo_preverificari WHERE uid='00000000-0000-0000-0000-00000000b302';
 v_p:=public.fn_izo_aprobare_lot(v_s);
 PERFORM set_config('test.e4b3.stale',v_p->>'amprenta',true);
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE public.izo_bucati_declarate SET lungime_mm=lungime_mm+1 WHERE uid=current_setting('test.e4b3.c9')::uuid;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$ DECLARE v_t public.izo_declaratii; v_p jsonb; v_rows jsonb; v_n bigint; BEGIN
 SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t9')::uuid;
 v_rows:=jsonb_build_array(jsonb_build_object('declaratie_id',v_t.id,'versiune',v_t.versiune,'updated_at',v_t.updated_at));
 SELECT count(*) INTO v_n FROM public.magazie_bucati_evenimente;
 BEGIN PERFORM public.fn_izo_aproba(gen_random_uuid(),v_t.preverificare_id,v_rows,current_setting('test.e4b3.stale'),'{}');
  RAISE EXCEPTION 'changed cut preview accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'preview_vechi' THEN RAISE; END IF; END;
 v_p:=public.fn_izo_aprobare_lot(v_t.preverificare_id);
 BEGIN PERFORM public.fn_izo_aproba(gen_random_uuid(),v_t.preverificare_id,v_rows,v_p->>'amprenta','{}');
  RAISE EXCEPTION 'bad cut sum accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'r3' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.magazie_bucati_evenimente)<>v_n OR EXISTS(SELECT 1 FROM public.izo_aprobari a
  WHERE a.randuri @> v_rows) THEN RAISE EXCEPTION 'failed simulation left facts'; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE public.izo_bucati_declarate SET lungime_mm=8000 WHERE uid=current_setting('test.e4b3.c9')::uuid;
SAVEPOINT r1d_fixture;
UPDATE public.izo_bucati_declarate SET lungime_mm=6000 WHERE declaratie_id=(SELECT d.id FROM public.izo_declaratii d WHERE d.uid=current_setting('test.e4b3.t9')::uuid);
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$ DECLARE v_t public.izo_declaratii; v_p jsonb; BEGIN
 SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t9')::uuid;
 v_p:=public.fn_izo_aprobare_lot(v_t.preverificare_id);
 BEGIN PERFORM public.fn_izo_aproba(gen_random_uuid(),v_t.preverificare_id,
  jsonb_build_array(jsonb_build_object('declaratie_id',v_t.id,'versiune',v_t.versiune,'updated_at',v_t.updated_at)),v_p->>'amprenta','{}');
  RAISE EXCEPTION 'equal cut children accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'r1d' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT r1d_fixture;
RELEASE SAVEPOINT r1d_fixture;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$
DECLARE v_s bigint; v_t public.izo_declaratii; v_m public.izo_declaratii; v_p jsonb; v_rows jsonb; v_r jsonb; v_i integer; v_n bigint;
BEGIN
 SELECT id INTO STRICT v_s FROM public.izo_preverificari WHERE uid='00000000-0000-0000-0000-00000000b302';
 FOR v_i IN SELECT x FROM unnest(ARRAY[7,8,10,11]) x LOOP
  SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t'||v_i)::uuid;
  SELECT * INTO STRICT v_m FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.m'||v_i)::uuid;
  v_p:=public.fn_izo_aprobare_lot(v_s);
  -- A child consumer alone must fail before any event is written.
  SELECT count(*) INTO v_n FROM public.magazie_bucati_evenimente;
  BEGIN
   PERFORM public.fn_izo_aproba(gen_random_uuid(),v_s,jsonb_build_array(jsonb_build_object('declaratie_id',v_m.id,'versiune',v_m.versiune,'updated_at',v_m.updated_at)),v_p->>'amprenta','{}');
   RAISE EXCEPTION 'missing cut accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'dependenta_lipsa' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.magazie_bucati_evenimente)<>v_n THEN RAISE EXCEPTION 'simulation wrote events'; END IF;
  IF v_i IN (7,10) THEN
   -- Reverse input order: the simulation must still create the child first.
   v_rows:=jsonb_build_array(jsonb_build_object('declaratie_id',v_m.id,'versiune',v_m.versiune,'updated_at',v_m.updated_at),
    jsonb_build_object('declaratie_id',v_t.id,'versiune',v_t.versiune,'updated_at',v_t.updated_at));
   v_r:=public.fn_izo_aproba(gen_random_uuid(),v_s,v_rows,v_p->>'amprenta','{}');
  ELSE
   -- Separate approvals must preserve an exclusive physical reservation for T2.
   v_r:=public.fn_izo_aproba(gen_random_uuid(),v_s,jsonb_build_array(jsonb_build_object('declaratie_id',v_t.id,'versiune',v_t.versiune,'updated_at',v_t.updated_at)),v_p->>'amprenta','{}');
   IF NOT EXISTS(SELECT 1 FROM public.izo_rezervari r JOIN public.izo_rezervari old ON old.id=r.transfer_din_id
    WHERE r.declaratie_id=v_m.id AND r.activa AND r.bucata_id IS NOT NULL AND old.motiv_eliberare='transferata' AND NOT old.activa) THEN RAISE EXCEPTION 'separate transfer lost'; END IF;
   v_p:=public.fn_izo_aprobare_lot(v_s);
   v_r:=public.fn_izo_aproba(gen_random_uuid(),v_s,jsonb_build_array(jsonb_build_object('declaratie_id',v_m.id,'versiune',v_m.versiune,'updated_at',v_m.updated_at)),v_p->>'amprenta','{}');
  END IF;
  IF v_r->>'cod'<>'aprobat' THEN RAISE EXCEPTION 'cut approval %',v_r; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.izo_rezervari r JOIN public.izo_rezervari old ON old.id=r.transfer_din_id
   JOIN public.izo_declaratii d ON d.id=r.declaratie_id WHERE d.id=v_m.id AND r.motiv_eliberare='consumata'
   AND r.eveniment_id=d.eveniment_ids[1] AND old.motiv_eliberare='transferata' AND NOT r.activa AND NOT old.activa) THEN RAISE EXCEPTION 'transfer chain'; END IF;
  IF (SELECT stare FROM public.magazie_bucati WHERE id=current_setting('test.e4b2.b'||v_i)::bigint)<>'taiata' THEN RAISE EXCEPTION 'cut parent'; END IF;
 END LOOP;
 SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t9')::uuid;
 SELECT * INTO STRICT v_m FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.m9')::uuid;
 v_r:=public.fn_izo_revizie_cere(gen_random_uuid(),v_t.id,v_t.versiune,v_t.updated_at,'revizie cu descendenti');
 IF NOT EXISTS(SELECT 1 FROM public.izo_declaratii WHERE id=v_m.id AND stare='blocata' AND stare_inainte_blocare='trimisa'
  AND blocata_motiv='dependenta_in_revizie') OR NOT EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_m.id AND activa) THEN RAISE EXCEPTION 'revision closure'; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_t public.izo_declaratii; v_r jsonb; v_codes jsonb;
BEGIN
 SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t9')::uuid;
 SELECT jsonb_object_agg(uid,cod_bucata) INTO v_codes FROM public.izo_bucati_declarate WHERE declaratie_id=v_t.id;
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b301',jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),
  'seq',13,'versiune_format',1,'tip_op','decl_salveaza','payload',v_t.payload||jsonb_build_object('versiune_baza',v_t.versiune))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'revision with children resubmit %',v_r; END IF;
 IF (SELECT jsonb_object_agg(uid,cod_bucata) FROM public.izo_bucati_declarate WHERE declaratie_id=v_t.id) IS DISTINCT FROM v_codes THEN RAISE EXCEPTION 'unchanged child letters changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.m9')::uuid AND stare='trimisa'
  AND depinde_de_versiune=v_t.versiune+1) THEN RAISE EXCEPTION 'unchanged child not restored'; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$ DECLARE v_t public.izo_declaratii; BEGIN
 SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t9')::uuid;
 PERFORM public.fn_izo_revizie_cere(gen_random_uuid(),v_t.id,v_t.versiune,v_t.updated_at,'schimbare copil la revizie');
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$ DECLARE v_t public.izo_declaratii; v_p jsonb; v_r jsonb; BEGIN
 SELECT * INTO STRICT v_t FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.t9')::uuid;
 v_p:=jsonb_set(v_t.payload,'{puncte_mm}','[8100]');
 v_p:=jsonb_set(v_p,'{copii,0,lungime_mm}','8100');
 v_p:=jsonb_set(v_p,'{copii,1,lungime_mm}','3900');
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b301',jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),
  'seq',14,'versiune_format',1,'tip_op','decl_salveaza','payload',v_p||jsonb_build_object('versiune_baza',v_t.versiune))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION 'changed child revision %',v_r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_declaratii WHERE uid=current_setting('test.e4b3.m9')::uuid AND stare='blocata'
  AND blocata_motiv='dependenta_anulata') OR EXISTS(SELECT 1 FROM public.izo_rezervari r JOIN public.izo_declaratii d ON d.id=r.declaratie_id
   WHERE d.uid=current_setting('test.e4b3.m9')::uuid AND r.activa) THEN RAISE EXCEPTION 'changed child restored or reserved'; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;


-- E4b-2c: real tablet route, mixed sessions, R4, mounted cut-out and MP correction.
-- Separate synthetic rate-limit window from the preceding scenarios.
UPDATE public.izo_rata_apeluri SET n=0 WHERE profile_id='00000000-0000-0000-0000-000000000121' AND functie='sync';
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $fixture$
DECLARE v_id bigint; v_i integer;
BEGIN
 FOR v_i IN 1..4 LOOP
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,diametru_mm,
   lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,locatie_tip,locatie_site_id,tronson_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E4B2C-'||v_i,'SARJA',
   CASE WHEN v_i=2 THEN 7.1 ELSE 8.8 END,610,12000,12000,12,12,'AB','A','B','beneficiar','pe_tronson','tronson',6,19,'manual');
  PERFORM set_config('test.e4bc.b'||v_i,v_id::text,true);
 END LOOP;
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_dev uuid:='00000000-0000-0000-0000-00000000b301'; v_session uuid; v_payload jsonb; v_r jsonb;
 v_seq integer:=14; v_i integer; v_j integer; v_uid uuid;
BEGIN
 FOR v_j IN 1..2 LOOP
  v_session:=gen_random_uuid(); PERFORM set_config('test.e4bc.s'||v_j,v_session::text,true);
  v_seq:=v_seq+1;
  v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,
   'tip_op','sesiune_deschide','payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_session,'zi',(now() AT TIME ZONE 'Europe/Bucharest')::date))));
  IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '2c session %',v_r; END IF;
  FOR v_i IN (CASE WHEN v_j=1 THEN 1 ELSE 3 END)..(CASE WHEN v_j=1 THEN 2 ELSE 4 END) LOOP
   v_uid:=gen_random_uuid(); PERFORM set_config('test.e4bc.d'||v_i,v_uid::text,true);
   v_payload:=jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_uid,'preverificare_uid',v_session,'versiune_baza',0,
    'tip','montaj','bucata',jsonb_build_object('bucata_id',current_setting('test.e4bc.b'||least(v_i,3))::bigint),
    'lungime_montata_mm',12000,'confirmare',jsonb_build_object('mod','marcaj','cm',0));
   IF v_i=2 THEN
    v_payload:=v_payload||jsonb_build_object('capat_amonte','A','sudura',jsonb_build_object('nr',501),
     'amonte',jsonb_build_object('tip','bucata','bucata_id',current_setting('test.e4bc.b1')::bigint,'capat','B'));
   ELSIF v_i=4 THEN
    v_payload:=jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_uid,'preverificare_uid',v_session,'versiune_baza',0,
     'tip','cuplare','sudura',jsonb_build_object('nr',502),
     'capat1',jsonb_build_object('bucata_id',current_setting('test.e4bc.b2')::bigint,'capat','B'),
     'capat2',jsonb_build_object('bucata_id',current_setting('test.e4bc.b3')::bigint,'capat','A'));
   END IF;
   v_seq:=v_seq+1;
   v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',v_payload)));
   IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '2c weld declaration %: %',v_i,v_r; END IF;
  END LOOP;
  IF v_j=1 THEN
   FOR v_i IN 1..4 LOOP
    v_payload:=jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',gen_random_uuid(),'preverificare_uid',v_session,'versiune_baza',0,
     'tip','cuplare','sudura',jsonb_build_object('nr',CASE WHEN v_i=1 THEN 501 ELSE 503 END),
     'capat1',jsonb_build_object('bucata_id',current_setting('test.e4bc.b1')::bigint,'capat','B'),
     'capat2',jsonb_build_object('bucata_id',current_setting('test.e4bc.b2')::bigint,'capat','B'));
    IF v_i=3 THEN v_payload:=v_payload-'capat2'; END IF;
    IF v_i=4 THEN v_payload:=jsonb_set(v_payload,'{sudura,sufix}','"UNKNOWN"'); END IF;
    v_seq:=v_seq+1;
    v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',v_payload)));
    IF v_r#>>'{rezultate,0,cod}' NOT IN ('conflict','eroare') THEN RAISE EXCEPTION '2c occupied/code/incomplete cap refusal % %',v_i,v_r; END IF;
   END LOOP;
  END IF;
  v_seq:=v_seq+1;
  v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,
   'tip_op','sesiune_trimite','payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'preverificare_uid',v_session,'randuri',
    (SELECT jsonb_agg(jsonb_build_object('uid',d.uid,'versiune',d.versiune)) FROM public.izo_declaratii d JOIN public.izo_preverificari p ON p.id=d.preverificare_id WHERE p.uid=v_session)))));
  IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '2c submit %',v_r; END IF;
 END LOOP;
 PERFORM set_config('test.e4bc.seq',v_seq::text,true);
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$
DECLARE v_ids bigint[]; v_plan jsonb; v_n bigint;
BEGIN
 SELECT array_agg(d.id ORDER BY d.id DESC) INTO v_ids FROM public.izo_declaratii d WHERE d.uid IN
  (current_setting('test.e4bc.d1')::uuid,current_setting('test.e4bc.d2')::uuid,current_setting('test.e4bc.d3')::uuid,current_setting('test.e4bc.d4')::uuid);
 SELECT count(*) INTO v_n FROM public.magazie_bucati_evenimente;
 v_plan:=public.fn_izo_lot_efecte(v_ids);
 IF jsonb_array_length(v_plan->'ordine')<>4 OR (SELECT count(*) FROM public.magazie_bucati_evenimente)<>v_n THEN RAISE EXCEPTION '2c read-only topology'; END IF;
 BEGIN
  UPDATE public.izo_suduri_capete SET activ=false WHERE sudura_id=(SELECT id FROM public.izo_suduri WHERE nr=501 AND tronson_id=19) AND parte='aval';
  PERFORM public.fn_izo_lot_efecte(v_ids); RAISE EXCEPTION '2c single cap accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'r4' THEN RAISE; END IF; END;
END $test$;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$
DECLARE v_s bigint; v_rows jsonb; v_preview jsonb; v_r jsonb;
BEGIN
 SELECT id INTO v_s FROM public.izo_preverificari WHERE uid=current_setting('test.e4bc.s1')::uuid;
 SELECT jsonb_agg(jsonb_build_object('declaratie_id',d.id,'versiune',d.versiune,'updated_at',d.updated_at) ORDER BY d.id DESC) INTO v_rows
 FROM public.izo_declaratii d WHERE d.uid IN (current_setting('test.e4bc.d1')::uuid,current_setting('test.e4bc.d2')::uuid,current_setting('test.e4bc.d3')::uuid,current_setting('test.e4bc.d4')::uuid);
 v_preview:=public.fn_izo_aprobare_lot(v_s);
 v_r:=public.fn_izo_aproba(gen_random_uuid(),v_s,v_rows,v_preview->>'amprenta','{}');
 IF (SELECT count(*) FROM public.izo_suduri WHERE tronson_id=19 AND nr IN (501,502) AND stare='aprobata' AND tranzitie_perete)<>2 THEN RAISE EXCEPTION '2c mixed-session weld approval %',v_r; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_dev uuid:='00000000-0000-0000-0000-00000000b301'; v_seq integer:=current_setting('test.e4bc.seq')::integer;
 v_session uuid:=gen_random_uuid(); v_uid uuid; v_p jsonb; v_r jsonb; v_i integer;
BEGIN
 PERFORM set_config('test.e4bc.s3',v_session::text,true);
 v_seq:=v_seq+1;
 v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','sesiune_deschide',
  'payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_session,'zi',(now() AT TIME ZONE 'Europe/Bucharest')::date))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '2c cut session %',v_r; END IF;
 FOR v_i IN 1..3 LOOP
  v_uid:=gen_random_uuid(); PERFORM set_config('test.e4bc.t'||v_i,v_uid::text,true);
  v_p:=jsonb_build_object('proiect_id',3,'tronson_id',19,'uid',v_uid,'preverificare_uid',v_session,'versiune_baza',0,'tip','taiere',
   'sursa',jsonb_build_object('bucata_id',current_setting('test.e4bc.b'||CASE WHEN v_i=1 THEN 2 WHEN v_i=2 THEN 4 ELSE 1 END)::bigint),
   'baza_mm',CASE WHEN v_i=2 THEN 12100 ELSE 12000 END,'punt','ignored');
  v_p:=v_p-'punt';
  IF v_i=1 THEN
   v_p:=v_p||jsonb_build_object('puncte_mm','[5000,6100]'::jsonb,'confirmare',jsonb_build_object('mod','taiata'),
    'copii',jsonb_build_array(jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',5000,'destinatie','ramane_montat'),
     jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',1100,'destinatie','depozit','depozit_destinatie_id',9),
     jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',5900,'destinatie','ramane_montat')));
  ELSIF v_i=3 THEN
   v_p:=v_p||jsonb_build_object('puncte_mm','[5000]'::jsonb,'confirmare',jsonb_build_object('mod','taiata'),
    'copii',jsonb_build_array(jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',5000,'destinatie','depozit','depozit_destinatie_id',9),
     jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',7000,'destinatie','ramane_montat')));
  ELSE
   v_p:=v_p||jsonb_build_object('puncte_mm','[8100]'::jsonb,'confirmare',jsonb_build_object('mod','marcaj_diferit','masurata_mm',12100),
    'copii',jsonb_build_array(jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',8100,'destinatie','montaj'),
     jsonb_build_object('uid',gen_random_uuid(),'lungime_mm',4000,'destinatie','depozit','depozit_destinatie_id',9)));
  END IF;
  v_seq:=v_seq+1;
  v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',v_p)));
  IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '2c cut % %',v_i,v_r; END IF;
 END LOOP;
 v_seq:=v_seq+1;
 v_r:=public.fn_izo_sync_push(v_dev,jsonb_build_array(jsonb_build_object('op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','sesiune_trimite',
  'payload',jsonb_build_object('proiect_id',3,'tronson_id',19,'preverificare_uid',v_session,'randuri',
   (SELECT jsonb_agg(jsonb_build_object('uid',d.uid,'versiune',d.versiune)) FROM public.izo_declaratii d JOIN public.izo_preverificari p ON p.id=d.preverificare_id WHERE p.uid=v_session)))));
 IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '2c cuts submit %',v_r; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$
DECLARE v_id bigint;
BEGIN
 SELECT id INTO v_id FROM public.izo_declaratii WHERE uid=current_setting('test.e4bc.t1')::uuid;
 PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]);
 BEGIN
  UPDATE public.izo_bucati_declarate SET destinatie='montaj' WHERE declaratie_id=v_id AND destinatie='ramane_montat';
  PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RAISE EXCEPTION '2c wrong mounted branch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ramura_gresita' THEN RAISE; END IF; END;
 SELECT id INTO v_id FROM public.izo_declaratii WHERE uid=current_setting('test.e4bc.t3')::uuid;
 PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]);
 BEGIN
  UPDATE public.izo_bucati_declarate SET destinatie=CASE WHEN destinatie='depozit' THEN 'ramane_montat' ELSE 'depozit' END,depozit_destinatie_id=9 WHERE declaratie_id=v_id;
  PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RAISE EXCEPTION '2c free-end branch accepted wrong child';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ramura_gresita' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.izo_bucati_declarate(uid,declaratie_id,declaratie_versiune,parinte_bucata_id,radacina_id,lungime_mm,lungime_calculata,capat_stanga,capat_dreapta,cod_bucata,destinatie)
  VALUES(gen_random_uuid(),v_id,1,current_setting('test.e4bc.b4')::bigint,current_setting('test.e4bc.b4')::bigint,111,false,'X','Y','XY','montaj');
  PERFORM public.fn_izo_corectie_mm((SELECT d.id FROM public.izo_declaratii d WHERE d.uid=current_setting('test.e4bc.t2')::uuid));
  RAISE EXCEPTION '2c tree correction accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'corectie_in_arbore' THEN RAISE; END IF; END;
END $test$;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$
DECLARE v_s bigint; v_rows jsonb; v_preview jsonb; v_dec jsonb; v_id bigint; v_r jsonb; v_n bigint;
BEGIN
 SELECT id INTO v_s FROM public.izo_preverificari WHERE uid=current_setting('test.e4bc.s3')::uuid;
 SELECT id INTO v_id FROM public.izo_declaratii WHERE uid=current_setting('test.e4bc.t2')::uuid;
 SELECT jsonb_agg(jsonb_build_object('declaratie_id',d.id,'versiune',d.versiune,'updated_at',d.updated_at)) INTO v_rows FROM public.izo_declaratii d WHERE d.preverificare_id=v_s;
 v_preview:=public.fn_izo_aprobare_lot(v_s); v_dec:=jsonb_build_object('corectie:'||v_id,'Marcaj verificat de MP');
 SELECT count(*) INTO v_n FROM public.magazie_bucati_evenimente;
 BEGIN
  PERFORM public.fn_izo_aproba(gen_random_uuid(),v_s,v_rows,v_preview->>'amprenta','{}'); RAISE EXCEPTION '2c missing MP decision accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'decizii_invalide' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.fn_izo_aproba(gen_random_uuid(),v_s,v_rows,v_preview->>'amprenta',v_dec||'{"unexpected":"Motiv suplimentar"}'::jsonb);
  RAISE EXCEPTION '2c extra MP decision accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'decizii_invalide' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.magazie_bucati_evenimente)<>v_n THEN RAISE EXCEPTION '2c decision wrote facts'; END IF;
 v_r:=public.fn_izo_aproba(gen_random_uuid(),v_s,v_rows,v_preview->>'amprenta',v_dec);
 IF EXISTS(SELECT 1 FROM public.izo_suduri_capete WHERE bucata_id=current_setting('test.e4bc.b2')::bigint AND activ)
  OR (SELECT count(*) FROM public.izo_suduri_capete c JOIN public.izo_suduri w ON w.id=c.sudura_id WHERE c.activ AND w.nr IN (501,502) AND w.tronson_id=19)<>4 THEN RAISE EXCEPTION '2c R4 transfer'; END IF;
 IF (SELECT lungime_mm FROM public.magazie_bucati WHERE id=current_setting('test.e4bc.b4')::bigint)<>12100
  OR (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE document_tip='izo_declaratie' AND document_id=v_id::text AND tip IN ('corectie','taiere'))<>2 THEN RAISE EXCEPTION '2c correction before cut'; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;

ROLLBACK;
SELECT 'E4B_APROBARE_TEST_END';
