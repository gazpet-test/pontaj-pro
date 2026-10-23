-- Synthetic, transaction-local fixtures. Run only through test_izometrie_e4b.sh.
BEGIN;
DO $test$ BEGIN
 IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF;
 IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'gate'; END IF;
 IF has_function_privilege('authenticated','public.fn_izo_birou_fapt(bigint,text,text,bigint,integer,uuid,text,timestamptz,text)','EXECUTE')
  OR has_function_privilege('anon','public.fn_izo_aproba(uuid,bigint,jsonb,text,jsonb)','EXECUTE')
  OR has_column_privilege('authenticated','public.izo_aprobari','hash_cerere','SELECT') THEN RAISE EXCEPTION 'private ACL'; END IF;
 IF (SELECT p.proowner::regrole::text FROM pg_proc p WHERE p.oid='public.fn_izo_teren_op(uuid,jsonb,jsonb,bigint,text,public.izo_fronturi)'::regprocedure AND p.pronamespace='public'::regnamespace)<>'izo_teren_editor'
  OR (SELECT p.proowner::regrole::text FROM pg_proc p WHERE p.oid='public.fn_izo_aproba_intern(uuid,bigint,jsonb,text,jsonb)'::regprocedure AND p.pronamespace='public'::regnamespace)<>'izo_montaj_writer' THEN RAISE EXCEPTION '3 matrix owner'; END IF;
 IF has_function_privilege('izo_teren_editor','public.fn_izo_birou_fapt(bigint,text,text,bigint,integer,uuid,text,timestamptz,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_izo_suduri_marcheaza(text,jsonb,jsonb)','EXECUTE')
  OR has_column_privilege('izo_teren_editor','public.izo_suduri','tranzitie_confirmata_de','UPDATE')
  OR has_table_privilege('izo_montaj_writer','public.izo_declaratii_gps','SELECT')
  OR has_table_privilege('izo_montaj_writer','public.izo_declaratii_gps','INSERT') THEN RAISE EXCEPTION '3 matrix isolation'; END IF;
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

-- E4b-5a: sent rows are immutable to teren; no identity bypass or new row.
DO $test$
DECLARE v_d public.izo_declaratii; v_r jsonb; v_payload jsonb; v_before jsonb; v_n bigint; v_seen integer:=0;
BEGIN
 FOR v_d IN SELECT * FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b1')::bigint
  OR uid='00000000-0000-0000-0000-00000000b206' LOOP
  v_seen:=v_seen+1;
  v_before:=to_jsonb(v_d);
  v_payload:=v_d.payload||jsonb_build_object('versiune_baza',v_d.versiune,'bucata',
   jsonb_build_object('bucata_id',current_setting('test.e4b2.b6')::bigint));
  v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b201',jsonb_build_array(jsonb_build_object(
   'op_id',gen_random_uuid(),'seq',7,'versiune_format',1,'tip_op','decl_salveaza','payload',v_payload)));
  IF v_r#>>'{rezultate,0,cod}' IS DISTINCT FROM 'conflict' OR v_r#>>'{rezultate,0,motiv}' IS DISTINCT FROM 'sesiune_stare'
   THEN RAISE EXCEPTION '5a sent row edit %',v_r; END IF;
  IF (SELECT to_jsonb(d) FROM public.izo_declaratii d WHERE id=v_d.id) IS DISTINCT FROM v_before
   THEN RAISE EXCEPTION '5a refused row changed'; END IF;
 END LOOP;
 IF v_seen<>2 THEN RAISE EXCEPTION '5a missing sent rows'; END IF;
 SELECT count(*) INTO v_n FROM public.izo_declaratii;
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b201',jsonb_build_array(jsonb_build_object(
  'op_id',gen_random_uuid(),'seq',7,'versiune_format',1,'tip_op','decl_salveaza','payload',
  v_payload||jsonb_build_object('uid',gen_random_uuid(),'versiune_baza',0))));
 IF v_r#>>'{rezultate,0,motiv}' IS DISTINCT FROM 'sesiune_stare' OR (SELECT count(*) FROM public.izo_declaratii)<>v_n
  THEN RAISE EXCEPTION '5a new sent row accepted %',v_r; END IF;
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b201',jsonb_build_array(jsonb_build_object(
  'op_id',gen_random_uuid(),'seq',7,'versiune_format',1,'tip_op','sesiune_deschide','payload',jsonb_build_object(
  'proiect_id',3,'tronson_id',19,'uid','00000000-0000-0000-0000-00000000b202','zi',(now() AT TIME ZONE 'Europe/Bucharest')::date))));
 IF v_r#>>'{rezultate,0,motiv}' IS DISTINCT FROM 'sesiune_stare' THEN RAISE EXCEPTION '5a reopened sent session %',v_r; END IF;

END $test$;
-- Explicit MP revision does not give teren the right to resolve the serial either.
SAVEPOINT e4b5a_identitate;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$ DECLARE v_d public.izo_declaratii; v_r jsonb; BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE uid='00000000-0000-0000-0000-00000000b206';
 v_r:=public.fn_izo_revizie_cere(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,'fixture identity revision');
 IF v_r->>'cod' IS DISTINCT FROM 'revizie_ceruta' THEN RAISE EXCEPTION '5a identity revision setup %',v_r; END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$ DECLARE v_d public.izo_declaratii; v_r jsonb; v_before jsonb; BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE uid='00000000-0000-0000-0000-00000000b206';
 v_before:=to_jsonb(v_d);
 v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b201',jsonb_build_array(jsonb_build_object(
  'op_id',gen_random_uuid(),'seq',7,'versiune_format',1,'tip_op','decl_salveaza','payload',v_d.payload||jsonb_build_object(
  'versiune_baza',v_d.versiune,'bucata',jsonb_build_object('bucata_id',current_setting('test.e4b2.b6')::bigint)))));
 IF v_r#>>'{rezultate,0,cod}' IS DISTINCT FROM 'eroare' OR v_r#>>'{rezultate,0,motiv}' IS DISTINCT FROM 'serie_context'
  THEN RAISE EXCEPTION '5a terrain resolved revision identity %',v_r; END IF;
 IF (SELECT to_jsonb(d) FROM public.izo_declaratii d WHERE id=v_d.id) IS DISTINCT FROM v_before
  THEN RAISE EXCEPTION '5a refused identity changed row'; END IF;
END $test$;
ROLLBACK TO SAVEPOINT e4b5a_identitate;
RELEASE SAVEPOINT e4b5a_identitate;
RESET ROLE;
RESET SESSION AUTHORIZATION;

-- Exercise the independent SQL trigger with the actual terrain column privileges.
SET LOCAL ROLE izo_teren_editor;
DO $test$ DECLARE v_n bigint; BEGIN
 BEGIN
  UPDATE public.izo_declaratii SET identificare='bucata',bucata_id=current_setting('test.e4b2.b6')::bigint,stare='trimisa',versiune=versiune+1
   WHERE uid='00000000-0000-0000-0000-00000000b206';
  GET DIAGNOSTICS v_n=ROW_COUNT;
  IF v_n<>1 THEN RAISE EXCEPTION '5a missing trigger fixture'; END IF;
  RAISE EXCEPTION '5a teren resolved identity';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'serie_context' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.izo_declaratii SET payload=payload||jsonb_build_object('serie_bruta','SCHIMBATA'),versiune=versiune+1
   WHERE uid='00000000-0000-0000-0000-00000000b206';
  GET DIAGNOSTICS v_n=ROW_COUNT;
  IF v_n<>1 THEN RAISE EXCEPTION '5a missing trigger fixture'; END IF;
  RAISE EXCEPTION '5a teren edited verification payload';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'teren_tranzitie' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;

-- Non-owner MP with actual module/project rights. Both identity branches isolated.
-- fixture administrativ: fără JWT (prevent_role_escalation verifică apelantul)
SELECT set_config('request.jwt.claims','',true);
SELECT set_config('test.e4b5a.owner121',(SELECT is_owner::text FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000121'),true);
SELECT set_config('request.jwt.claims','',true);
UPDATE public.profiles SET is_owner=false WHERE id IN ('00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000117');
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES
 ('00000000-0000-0000-0000-000000000121','executie.izometrie','editor'),
 ('00000000-0000-0000-0000-000000000117','executie.izometrie','editor')
 ON CONFLICT(profile_id,module) DO UPDATE SET access_level='editor';
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,acordat_de,motiv)
 VALUES(3,'00000000-0000-0000-0000-000000000121','manager_aprobator','fixture','E4b-5a four eyes'),
       (3,'00000000-0000-0000-0000-000000000117','manager_aprobator','fixture','E4b-5a four eyes') ON CONFLICT DO NOTHING;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_uid uuid; v_d public.izo_declaratii; v_known public.izo_declaratii; v_p jsonb; v_before jsonb;
BEGIN
 FOREACH v_uid IN ARRAY ARRAY['00000000-0000-0000-0000-000000000121'::uuid] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  IF (SELECT is_owner FROM public.profiles WHERE id=v_uid) THEN RAISE EXCEPTION '5a MP must not be owner'; END IF;
  SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE uid='00000000-0000-0000-0000-00000000b206';
  SELECT * INTO STRICT v_known FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b1')::bigint;
  v_p:=public.fn_izo_aprobare_lot(v_known.preverificare_id); -- proves MP rights
  v_before:=to_jsonb(v_d);
  BEGIN
   PERFORM public.fn_izo_aproba(gen_random_uuid(),v_known.preverificare_id,
    jsonb_build_array(jsonb_build_object('declaratie_id',v_known.id,'versiune',v_known.versiune,'updated_at',v_known.updated_at)),v_p->>'amprenta','{}');
   RAISE EXCEPTION '5a four eyes approval accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  BEGIN
   PERFORM public.fn_izo_respinge(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,'fixture four eyes','{}');
   RAISE EXCEPTION '5a four eyes rejection accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  BEGIN
   PERFORM public.fn_izo_revizie_cere(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,'fixture four eyes');
   RAISE EXCEPTION '5a four eyes revision accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  BEGIN
   PERFORM public.fn_izo_serie_lamureste(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,current_setting('test.e4b2.b6')::bigint,'fixture four eyes');
   RAISE EXCEPTION '5a four eyes series accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  IF (SELECT to_jsonb(d) FROM public.izo_declaratii d WHERE id=v_d.id) IS DISTINCT FROM v_before THEN RAISE EXCEPTION '5a four eyes mutated row'; END IF;
 END LOOP;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
-- Transfer the employee binding sequentially; respect uniq_profiles_employee_id.
SELECT set_config('request.jwt.claims','',true);
UPDATE public.profiles SET employee_id=NULL WHERE id='00000000-0000-0000-0000-000000000121';
UPDATE public.profiles SET employee_id=121 WHERE id='00000000-0000-0000-0000-000000000117';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_uid uuid; v_d public.izo_declaratii; v_known public.izo_declaratii; v_p jsonb; v_before jsonb;
BEGIN
 FOREACH v_uid IN ARRAY ARRAY['00000000-0000-0000-0000-000000000117'::uuid] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  IF (SELECT is_owner FROM public.profiles WHERE id=v_uid) THEN RAISE EXCEPTION '5a MP must not be owner'; END IF;
  SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE uid='00000000-0000-0000-0000-00000000b206';
  SELECT * INTO STRICT v_known FROM public.izo_declaratii WHERE bucata_id=current_setting('test.e4b2.b1')::bigint;
  v_p:=public.fn_izo_aprobare_lot(v_known.preverificare_id); -- proves MP rights
  v_before:=to_jsonb(v_d);
  BEGIN
   PERFORM public.fn_izo_aproba(gen_random_uuid(),v_known.preverificare_id,
    jsonb_build_array(jsonb_build_object('declaratie_id',v_known.id,'versiune',v_known.versiune,'updated_at',v_known.updated_at)),v_p->>'amprenta','{}');
   RAISE EXCEPTION '5a four eyes approval accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  BEGIN
   PERFORM public.fn_izo_respinge(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,'fixture four eyes','{}');
   RAISE EXCEPTION '5a four eyes rejection accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  BEGIN
   PERFORM public.fn_izo_revizie_cere(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,'fixture four eyes');
   RAISE EXCEPTION '5a four eyes revision accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  BEGIN
   PERFORM public.fn_izo_serie_lamureste(gen_random_uuid(),v_d.id,v_d.versiune,v_d.updated_at,current_setting('test.e4b2.b6')::bigint,'fixture four eyes');
   RAISE EXCEPTION '5a four eyes series accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
  IF (SELECT to_jsonb(d) FROM public.izo_declaratii d WHERE id=v_d.id) IS DISTINCT FROM v_before THEN RAISE EXCEPTION '5a four eyes mutated row'; END IF;
 END LOOP;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT set_config('request.jwt.claims','',true);
UPDATE public.profiles SET employee_id=117 WHERE id='00000000-0000-0000-0000-000000000117';
UPDATE public.profiles SET employee_id=121 WHERE id='00000000-0000-0000-0000-000000000121';
SELECT set_config('request.jwt.claims','',true);
UPDATE public.profiles SET is_owner=current_setting('test.e4b5a.owner121')::boolean WHERE id='00000000-0000-0000-0000-000000000121';
UPDATE public.profiles SET employee_id=117,is_owner=true WHERE id='00000000-0000-0000-0000-000000000117';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
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
  RAISE EXCEPTION 'owner self approval accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'propriul_rand' THEN RAISE; END IF; END;
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
 SET LOCAL ROLE izo_montaj_writer; v_plan:=public.fn_izo_lot_efecte(v_ids); RESET ROLE;
 IF jsonb_array_length(v_plan->'ordine')<>4 OR (SELECT count(*) FROM public.magazie_bucati_evenimente)<>v_n THEN RAISE EXCEPTION '2c read-only topology'; END IF;
 BEGIN
  UPDATE public.izo_suduri_capete SET activ=false WHERE sudura_id=(SELECT id FROM public.izo_suduri WHERE nr=501 AND tronson_id=19) AND parte='aval';
  SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(v_ids); RESET ROLE; RAISE EXCEPTION '2c single cap accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'r4' THEN RAISE; END IF; END;
END $test$;
-- E4b-3: execute revision/resave on the real API, then roll back only this probe.
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$
DECLARE v_d public.izo_declaratii; v_old bigint; v_r jsonb; v_key uuid:=gen_random_uuid(); v_seq bigint;
BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE uid=current_setting('test.e4bc.d2')::uuid;
 SELECT id INTO STRICT v_old FROM public.izo_suduri WHERE declaratie_id=v_d.id AND stare='declarata';
 BEGIN
  v_r:=public.fn_izo_revizie_cere(v_key,v_d.id,v_d.versiune,v_d.updated_at,'Reverificare capete');
  IF v_r->>'cod'<>'revizie_ceruta' THEN RAISE EXCEPTION '3 revision refused %',v_r; END IF;
  IF public.fn_izo_revizie_cere(v_key,v_d.id,v_d.versiune,v_d.updated_at,'Reverificare capete') IS DISTINCT FROM v_r THEN RAISE EXCEPTION '3 revision idempotency'; END IF;
  BEGIN
   v_r:=public.fn_izo_respinge(gen_random_uuid(),v_d.id,v_d.versiune,
    (SELECT updated_at FROM public.izo_declaratii WHERE id=v_d.id),'Sudura respinsa dupa verificare','{}');
   IF v_r->>'cod'<>'respinsa' OR EXISTS(SELECT 1 FROM public.izo_suduri_capete WHERE sudura_id=v_old AND activ)
    OR (SELECT stare FROM public.izo_suduri WHERE id=v_old)<>'anulata' THEN RAISE EXCEPTION '3 rejection cap invalidation'; END IF;
   RAISE EXCEPTION 'reject probe rollback' USING ERRCODE='IZ098';
  EXCEPTION WHEN SQLSTATE 'IZ098' THEN NULL; END;
  IF (SELECT count(*) FROM public.izo_suduri_capete WHERE sudura_id=v_old AND activ)<>2 THEN RAISE EXCEPTION '3 rejection rollback lost caps'; END IF;

  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
  v_seq:=current_setting('test.e4bc.seq')::bigint+1;
  v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b301',jsonb_build_array(jsonb_build_object(
   'op_id',gen_random_uuid(),'seq',v_seq,'versiune_format',1,'tip_op','decl_salveaza','payload',v_d.payload||jsonb_build_object('versiune_baza',v_d.versiune))));
  IF v_r#>>'{rezultate,0,cod}'<>'acceptat' THEN RAISE EXCEPTION '3 revision resave %',v_r; END IF;
  IF (SELECT stare FROM public.izo_suduri WHERE id=v_old)<>'anulata'
   OR EXISTS(SELECT 1 FROM public.izo_suduri_capete WHERE sudura_id=v_old AND activ)
   OR (SELECT count(*) FROM public.izo_suduri_capete c JOIN public.izo_suduri s ON s.id=c.sudura_id
    WHERE s.declaratie_id=v_d.id AND s.stare='declarata' AND c.activ)<>2 THEN RAISE EXCEPTION '3 revision cap invalidation'; END IF;
  -- A stale edit must roll back its attempted invalidation, including caps.
  v_r:=public.fn_izo_sync_push('00000000-0000-0000-0000-00000000b301',jsonb_build_array(jsonb_build_object(
   'op_id',gen_random_uuid(),'seq',v_seq+1,'versiune_format',1,'tip_op','decl_salveaza','payload',v_d.payload||jsonb_build_object('versiune_baza',v_d.versiune))));
  IF v_r#>>'{rezultate,0,cod}'<>'conflict' OR (SELECT count(*) FROM public.izo_suduri_capete c JOIN public.izo_suduri s ON s.id=c.sudura_id
    WHERE s.declaratie_id=v_d.id AND s.stare='declarata' AND c.activ)<>2 THEN RAISE EXCEPTION '3 stale revision changed caps %',v_r; END IF;
  RAISE EXCEPTION 'probe rollback' USING ERRCODE='IZ099';
 EXCEPTION WHEN SQLSTATE 'IZ099' THEN NULL; END;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
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
 -- Confirmed transition is naturally idempotent: actor, reason, time and version stay fixed.
 PERFORM set_config('test.e4b3.w501',(SELECT id::text FROM public.izo_suduri WHERE nr=501 AND tronson_id=19 AND stare='aprobata'),true);
 IF NOT EXISTS(SELECT 1 FROM public.v_izo_alerte WHERE sudura_id=current_setting('test.e4b3.w501')::bigint AND cod='izo_tranzitie_perete_neconfirmata') THEN RAISE EXCEPTION '3 missing wall alert'; END IF;
 PERFORM public.fn_izo_tranzitie_confirma(current_setting('test.e4b3.w501')::bigint,'Conform proiect si WPS');
 PERFORM set_config('test.e4b3.wall',(SELECT to_jsonb(s)::text FROM public.izo_suduri s WHERE id=current_setting('test.e4b3.w501')::bigint),true);
 PERFORM public.fn_izo_tranzitie_confirma(current_setting('test.e4b3.w501')::bigint,'Alt motiv nu suprascrie');
 IF (SELECT to_jsonb(s) FROM public.izo_suduri s WHERE id=current_setting('test.e4b3.w501')::bigint) IS DISTINCT FROM current_setting('test.e4b3.wall')::jsonb
  OR EXISTS(SELECT 1 FROM public.v_izo_alerte WHERE sudura_id=current_setting('test.e4b3.w501')::bigint) THEN RAISE EXCEPTION '3 wall idempotency'; END IF;

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
  -- E4b-2d: sync must retain the cut's own child reservations before submit.
  IF v_i IN (1,3) AND (
   (SELECT count(*) FROM public.izo_rezervari r JOIN public.izo_declaratii d ON d.id=r.declaratie_id
    JOIN public.izo_bucati_declarate c ON c.uid=r.bucata_decl_uid AND c.declaratie_id=d.id
    WHERE d.uid=v_uid AND c.destinatie='ramane_montat' AND c.stare='declarata'
     AND r.declaratie_versiune=d.versiune AND c.declaratie_versiune=d.versiune
     AND r.activa AND r.expira_dupa>now())<>CASE WHEN v_i=1 THEN 2 ELSE 1 END
   OR EXISTS(SELECT 1 FROM public.izo_rezervari r JOIN public.izo_declaratii d ON d.id=r.declaratie_id
    WHERE d.uid=v_uid AND r.motiv_eliberare='parinte_anulat')) THEN
   RAISE EXCEPTION '2d sync lost own mounted child reservation';
  END IF;
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
DECLARE v_id bigint; v_rid bigint; v_n integer; v_affected bigint;
BEGIN
 SELECT id INTO v_id FROM public.izo_declaratii WHERE uid=current_setting('test.e4bc.t1')::uuid;
 IF (SELECT count(*) FROM public.izo_rezervari r JOIN public.izo_bucati_declarate c ON c.uid=r.bucata_decl_uid
  JOIN public.izo_declaratii d ON d.id=c.declaratie_id
  WHERE d.id=v_id AND r.declaratie_id=d.id AND c.destinatie='ramane_montat'
   AND r.declaratie_versiune=d.versiune AND r.activa AND r.expira_dupa IS NULL)<>2 THEN
  RAISE EXCEPTION '2d submit lost own mounted child reservation';
 END IF;
 SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RESET ROLE;
 SELECT r.id INTO STRICT v_rid FROM public.izo_rezervari r
  WHERE r.declaratie_id=v_id AND r.bucata_decl_uid IS NOT NULL AND r.activa ORDER BY r.id LIMIT 1;
 -- Each subtransaction rolls back the forced deviation; no grants or guard bypass.
 FOR v_n IN 1..3 LOOP
  BEGIN
   IF v_n=1 THEN
    UPDATE public.izo_rezervari SET activa=false,eliberata_la=now(),motiv_eliberare='parinte_anulat' WHERE id=v_rid;
   ELSIF v_n=2 THEN
    UPDATE public.izo_rezervari SET declaratie_versiune=declaratie_versiune+1 WHERE id=v_rid;
   ELSE
    UPDATE public.izo_rezervari SET expira_dupa=now()+interval '1 hour' WHERE id=v_rid;
   END IF;
   GET DIAGNOSTICS v_affected=ROW_COUNT;
   IF v_affected<>1 THEN RAISE EXCEPTION '2d reservation fixture missed row'; END IF;
   SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RESET ROLE; RAISE EXCEPTION '2d invalid child reservation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'rezervare_pierduta' THEN RAISE; END IF; END;
 END LOOP;
 SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RESET ROLE;
 BEGIN
  UPDATE public.izo_bucati_declarate SET destinatie='montaj' WHERE declaratie_id=v_id AND destinatie='ramane_montat';
  SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RESET ROLE; RAISE EXCEPTION '2c wrong mounted branch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ramura_gresita' THEN RAISE; END IF; END;
 SELECT id INTO v_id FROM public.izo_declaratii WHERE uid=current_setting('test.e4bc.t3')::uuid;
 SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RESET ROLE;
 BEGIN
  UPDATE public.izo_bucati_declarate SET destinatie=CASE WHEN destinatie='depozit' THEN 'ramane_montat' ELSE 'depozit' END,depozit_destinatie_id=9 WHERE declaratie_id=v_id;
  SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_lot_efecte(ARRAY[v_id]); RESET ROLE; RAISE EXCEPTION '2c free-end branch accepted wrong child';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ramura_gresita' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.izo_bucati_declarate(uid,declaratie_id,declaratie_versiune,parinte_bucata_id,radacina_id,lungime_mm,lungime_calculata,capat_stanga,capat_dreapta,cod_bucata,destinatie)
  VALUES(gen_random_uuid(),v_id,1,current_setting('test.e4bc.b4')::bigint,current_setting('test.e4bc.b4')::bigint,111,false,'X','Y','XY','montaj');
  SET LOCAL ROLE izo_montaj_writer; PERFORM public.fn_izo_corectie_mm((SELECT d.id FROM public.izo_declaratii d WHERE d.uid=current_setting('test.e4bc.t2')::uuid)); RESET ROLE;
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
 IF NOT EXISTS(SELECT 1 FROM public.v_izo_alerte WHERE declaratie_id=v_id AND cod='izo_lungime_diferita_aviz' AND blocanta) THEN RAISE EXCEPTION '3 missing length alert'; END IF;
 BEGIN
  PERFORM public.fn_izo_fisa_verifica(v_id); RAISE EXCEPTION '3 length sheet accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'emitere_blocata:%' THEN RAISE; END IF; END;

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
 IF (SELECT count(*) FROM public.izo_rezervari r JOIN public.izo_bucati_declarate c ON c.uid=r.bucata_decl_uid
  JOIN public.izo_declaratii d ON d.id=c.declaratie_id
  WHERE d.preverificare_id=v_s AND r.declaratie_id=d.id AND c.destinatie='ramane_montat'
   AND c.stare='aprobata' AND r.declaratie_versiune=d.versiune AND NOT r.activa
   AND r.motiv_eliberare='consumata' AND r.eveniment_id=d.eveniment_ids[1])<>3
  OR EXISTS(SELECT 1 FROM public.izo_rezervari r JOIN public.izo_declaratii d ON d.id=r.declaratie_id
   WHERE d.preverificare_id=v_s AND r.activa) THEN
  RAISE EXCEPTION '2d approval did not consume own child reservations';
 END IF;
 IF EXISTS(SELECT 1 FROM public.izo_suduri_capete WHERE bucata_id=current_setting('test.e4bc.b2')::bigint AND activ)
  OR (SELECT count(*) FROM public.izo_suduri_capete c JOIN public.izo_suduri w ON w.id=c.sudura_id WHERE c.activ AND w.nr IN (501,502) AND w.tronson_id=19)<>4 THEN RAISE EXCEPTION '2c R4 transfer'; END IF;
 IF EXISTS(SELECT 1 FROM public.v_izo_alerte WHERE declaratie_id=v_id AND cod='izo_lungime_diferita_aviz') OR NOT public.fn_izo_fisa_verifica(v_id) THEN RAISE EXCEPTION '3 decided length still blocks'; END IF;
 IF (SELECT lungime_mm FROM public.magazie_bucati WHERE id=current_setting('test.e4bc.b4')::bigint)<>12100
  OR (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE document_tip='izo_declaratie' AND document_id=v_id::text AND tip IN ('corectie','taiere'))<>2 THEN RAISE EXCEPTION '2c correction before cut'; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;

-- Direct writer DML without the exact projection is rejected, even from a local admin session.
SET LOCAL ROLE izo_montaj_writer;
DO $test$
DECLARE v_id bigint; v_count bigint;
BEGIN
 SELECT id INTO STRICT v_id FROM public.izo_suduri_capete WHERE sudura_id=current_setting('test.e4b3.w501')::bigint AND activ ORDER BY id LIMIT 1;
 BEGIN
  UPDATE public.izo_suduri_capete SET activ=false WHERE id=v_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION '3 guard fixture missed row'; END IF;
  RAISE EXCEPTION '3 unprojected cap accepted';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'suduri_proiectie' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;
SET LOCAL ROLE izo_teren_editor;
DO $test$
DECLARE v_count bigint;
BEGIN
 BEGIN
  UPDATE public.izo_suduri SET stare='anulata' WHERE id=current_setting('test.e4b3.w501')::bigint;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION '3 terrain fixture missed row'; END IF;
  RAISE EXCEPTION '3 terrain changed approved weld';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'suduri_proiectie' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;

-- E4b-5a: the 31st office call is refused, including idempotent no-op calls.
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE public.izo_rata_apeluri SET n=0 WHERE profile_id='00000000-0000-0000-0000-000000000117' AND functie='fn_izo_front_intern';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $test$ DECLARE v_i integer; BEGIN
 FOR v_i IN 1..30 LOOP PERFORM public.fn_izo_front_elibereaza(19,'fixture rate'); END LOOP;
 BEGIN PERFORM public.fn_izo_front_elibereaza(19,'fixture rate'); RAISE EXCEPTION '5a office limit missing';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'limita' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;

ROLLBACK;
SELECT 'E4B_APROBARE_TEST_END';
