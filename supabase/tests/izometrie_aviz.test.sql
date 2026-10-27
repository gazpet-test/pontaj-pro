-- The harness prepends BEGIN and izometrie_aviz_fixture.sql. No grants here.
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE r jsonb; r2 jsonb; k uuid:=gen_random_uuid(); n int; a bigint; i int; expected text;
 dep int; b bigint[]; dt date; driver int; ext text; vehicle int; plate text; dest jsonb; confirmed boolean;
BEGIN
 SELECT s.ultim_nr INTO STRICT n FROM public.izo_avize_serii s WHERE s.depozit_id=9;
 r:=public.fn_izo_iesire_cu_aviz(k,9,19,ARRAY[current_setting('test.aviz.b1')::bigint],
 (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,true,901,NULL,'{"tip":"intern"}');
 a:=(r#>>'{aviz,id}')::bigint;
 IF r->>'cod' IS DISTINCT FROM 'iesit' OR (r#>>'{aviz,numar}')::int IS DISTINCT FROM n+1
 OR r#>>'{aviz,nr_complet}' IS DISTINCT FROM 'CJPJ 0047' THEN RAISE EXCEPTION 'first number %',r; END IF;
 r2:=public.fn_izo_iesire_cu_aviz(k,9,19,ARRAY[current_setting('test.aviz.b1')::bigint],
 (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,true,901,NULL,'{"tip":"intern"}');
 IF r2 IS DISTINCT FROM r OR (SELECT s.ultim_nr FROM public.izo_avize_serii s WHERE s.depozit_id=9)<>n+1
 OR (SELECT count(*) FROM public.izo_avize_iesire x WHERE x.op_cheie=k)<>1 THEN RAISE EXCEPTION 'retry consumed number'; END IF;
 BEGIN
  PERFORM public.fn_izo_iesire_cu_aviz(k,9,19,ARRAY[current_setting('test.aviz.b2')::bigint],
  (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,true,901,NULL,'{"tip":"intern"}');
  RAISE EXCEPTION 'reuse accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cheie_refolosita' THEN RAISE; END IF; END;
 IF r#>'{aviz,continut}' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('bucata_id',current_setting('test.aviz.b1')::bigint,
 'tip_cod','teava','serie','AVIZ-1','sarja','S-TEST','diametru_mm',610,'perete_mm',8,'unghi_curba',NULL,'lungime_mm',12000,'greutate_kg',123.5))
 OR (r#>>'{aviz,total_m}')::numeric IS DISTINCT FROM 12 OR (r#>>'{aviz,total_kg}')::numeric IS DISTINCT FROM 123.5
 OR (r#>>'{aviz,total_bucati}')::int IS DISTINCT FROM 1 OR r#>>'{aviz,antet,firma,firma_cui}' IS DISTINCT FROM 'RO123'
 OR r#>>'{aviz,antet,tronson,cod}' IS DISTINCT FROM 'T15' OR r#>>'{aviz,nr_auto}' IS DISTINCT FROM 'PH 01 ABC'
 OR (r#>>'{aviz,semnatura_pana_la}')::timestamptz IS DISTINCT FROM now()+interval '10 minutes'
 THEN RAISE EXCEPTION 'snapshot/totals %',r; END IF;
 PERFORM set_config('test.aviz.a',a::text,true);
 -- Consecutive numbers; external driver and complete external recipient.
 r2:=public.fn_izo_iesire_cu_aviz(gen_random_uuid(),9,19,ARRAY[current_setting('test.aviz.b2')::bigint],
 (now() AT TIME ZONE 'Europe/Bucharest')::date,NULL,'Extern TEST',false,NULL,'  ph  99 abc ',
 '{"tip":"extern","denumire":"Dest TEST","cui":"RO321","adresa":"Adresa TEST"}');
 IF (r2#>>'{aviz,numar}')::int IS DISTINCT FROM n+2 OR r2#>>'{aviz,nr_auto}' IS DISTINCT FROM 'PH 99 ABC'
 OR r2#>>'{aviz,motiv}' IS DISTINCT FROM 'Livrare către Dest TEST' OR r2#>'{aviz,semnatura_pana_la}'<>'null'::jsonb
 THEN RAISE EXCEPTION 'second number/external %',r2; END IF;
 r2:=public.fn_izo_iesire_cu_aviz(gen_random_uuid(),10,19,ARRAY[current_setting('test.aviz.b3')::bigint],
 (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,false,NULL,'PH01ABC','{"tip":"intern"}');
 IF r2#>>'{aviz,nr_complet}' IS DISTINCT FROM 'CJPT-O 0072' THEN RAISE EXCEPTION 'other series %',r2; END IF;
 -- Each negative case must return its own exact business error and no effects.
 FOR i IN 1..12 LOOP
  dep:=9; b:=ARRAY[current_setting('test.aviz.b5')::bigint]; dt:=(now() AT TIME ZONE 'Europe/Bucharest')::date;
  driver:=121; ext:=NULL; confirmed:=false; vehicle:=NULL; plate:='PH01ABC'; dest:='{"tip":"intern"}';
  CASE i
   WHEN 1 THEN b:=ARRAY[current_setting('test.aviz.b4')::bigint]; expected:='stare';
   WHEN 2 THEN driver:=NULL; expected:='sofer_invalid';
   WHEN 3 THEN ext:='Extern'; expected:='sofer_invalid';
   WHEN 4 THEN driver:=990; expected:='sofer_invalid';
   WHEN 5 THEN driver:=99999; expected:='sofer_invalid';
   WHEN 6 THEN vehicle:=99999; expected:='vehicul_invalid';
   WHEN 7 THEN plate:='AA'; expected:='nr_auto_invalid';
   WHEN 8 THEN dest:='{"tip":"extern","denumire":"X"}'; expected:='destinatar_invalid';
   WHEN 9 THEN dt:=dt+1; expected:='parametri_invalizi';
   WHEN 10 THEN dest:='{"tip":"intern","extra":1}'; expected:='destinatar_invalid';
   WHEN 11 THEN confirmed:=NULL; expected:='parametri_invalizi';
   WHEN 12 THEN dest:='{"tip":"extern","denumire":"X","cui":null,"adresa":"A"}'; expected:='destinatar_invalid';
  END CASE;
  SELECT s.ultim_nr INTO n FROM public.izo_avize_serii s WHERE s.depozit_id=9;
  BEGIN
   PERFORM public.fn_izo_iesire_cu_aviz(gen_random_uuid(),dep,19,b,dt,driver,ext,confirmed,vehicle,plate,dest);
   RAISE EXCEPTION 'invalid case accepted %',i;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM IS DISTINCT FROM expected THEN RAISE; END IF; END;
  IF (SELECT s.ultim_nr FROM public.izo_avize_serii s WHERE s.depozit_id=9) IS DISTINCT FROM n
  OR (SELECT count(*) FROM public.izo_avize_iesire)<>3 THEN RAISE EXCEPTION 'refusal left effects %',i; END IF;
 END LOOP;
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(a); RAISE EXCEPTION 'missing pdf accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pdf_lipsa' THEN RAISE; END IF; END;
 BEGIN PERFORM public.fn_izo_aviz_anuleaza(a,'ab'); RAISE EXCEPTION 'short reason accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'motiv_invalid' THEN RAISE; END IF; END;
END $test$;
-- Authenticated cannot mutate either table directly (ACL or zero affected rows).
DO $test$
DECLARE n bigint;
BEGIN
 BEGIN INSERT INTO public.izo_avize_serii VALUES(14,'FORBIDDEN',0,true,now()); GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'direct series insert'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.izo_avize_serii SET ultim_nr=0 WHERE depozit_id=9; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'direct series update'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.izo_avize_serii WHERE depozit_id=9; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'direct series delete'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.izo_avize_iesire(proiect_id) VALUES(3); GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'direct aviz insert'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.izo_avize_iesire SET motiv='FORBIDDEN' WHERE id=current_setting('test.aviz.a')::bigint; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'direct aviz update'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.izo_avize_iesire WHERE id=current_setting('test.aviz.a')::bigint; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'direct aviz delete'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
-- Insert synthetic Storage facts as postgres (same nonowner INSERT ACL as live).
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
SELECT 'izo-avize',a.proiect_id||'/'||a.serie||'-'||a.numar||'.pdf','00000000-0000-0000-0000-0000000000f0',
'{"mimetype":"application/pdf","size":2048,"eTag":"etag-test"}' FROM public.izo_avize_iesire a WHERE a.id=current_setting('test.aviz.a')::bigint;
DO $$ BEGIN IF (SELECT count(*) FROM storage.objects WHERE bucket_id='izo-avize')<>1 THEN RAISE EXCEPTION 'storage insert rowcount'; END IF; END $$;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(current_setting('test.aviz.a')::bigint); RAISE EXCEPTION 'wrong owner pdf accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pdf_invalid' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET owner_id='00000000-0000-0000-0000-000000000121',metadata='{"mimetype":"image/png","size":2048,"eTag":"etag-test"}' WHERE bucket_id='izo-avize';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(current_setting('test.aviz.a')::bigint); RAISE EXCEPTION 'wrong mimetype accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pdf_invalid' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET metadata='{"mimetype":"application/pdf","size":1023,"eTag":"etag-test"}' WHERE bucket_id='izo-avize';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(current_setting('test.aviz.a')::bigint); RAISE EXCEPTION 'small pdf accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pdf_invalid' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET metadata='{"mimetype":"application/pdf","size":10485761,"eTag":"etag-test"}' WHERE bucket_id='izo-avize';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(current_setting('test.aviz.a')::bigint); RAISE EXCEPTION 'large pdf accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pdf_invalid' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET metadata='{"mimetype":"application/pdf","size":2048,"eTag":"etag-test"}' WHERE bucket_id='izo-avize';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(current_setting('test.aviz.a')::bigint); RAISE EXCEPTION 'non issuer pdf accepted';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'fara_drept' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_anuleaza(current_setting('test.aviz.a')::bigint,'Motiv TEST'); RAISE EXCEPTION 'unauthorized cancellation';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'fara_drept' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.izo_avize_iesire) OR EXISTS(SELECT 1 FROM public.izo_avize_serii) THEN RAISE EXCEPTION 'RLS leak'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE r jsonb; r2 jsonb; n bigint; a bigint:=current_setting('test.aviz.a')::bigint;
BEGIN
 r:=public.fn_izo_aviz_pdf_ataseaza(a); r2:=public.fn_izo_aviz_pdf_ataseaza(a);
 IF r IS DISTINCT FROM r2 OR r->>'cod' IS DISTINCT FROM 'atasat' OR r#>>'{aviz,pdf_path}' IS DISTINCT FROM '3/CJPJ-47.pdf'
 OR (r#>>'{aviz,pdf_bytes}')::bigint IS DISTINCT FROM 2048 OR r#>>'{aviz,pdf_etag}' IS DISTINCT FROM 'etag-test'
 THEN RAISE EXCEPTION 'pdf attach/retry %',r; END IF;
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 VALUES('izo-avize','3/CJPJ-48.pdf',auth.uid()::text,'{"mimetype":"application/pdf","size":2048,"eTag":"second-test"}');
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'legitimate upload refused'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
  VALUES('izo-avize','3/UNREGISTERED-999.pdf',auth.uid()::text,'{"mimetype":"application/pdf","size":2048,"eTag":"bad"}');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'unregistered upload accepted'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Storage policies forbid changing or deleting the attached object.
 UPDATE storage.objects SET metadata='{}' WHERE bucket_id='izo-avize'; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'storage update allowed'; END IF;
 DELETE FROM storage.objects WHERE bucket_id='izo-avize'; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'storage delete allowed'; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
-- A privileged fixture simulates replacement outside the API. The RPC must
-- refuse a changed eTag even at the same path and byte count.
UPDATE storage.objects SET metadata='{"mimetype":"application/pdf","size":2048,"eTag":"changed-test"}'
WHERE bucket_id='izo-avize' AND name='3/CJPJ-47.pdf';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.fn_izo_aviz_pdf_ataseaza(current_setting('test.aviz.a')::bigint); RAISE EXCEPTION 'changed PDF accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'conflict' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET metadata='{"mimetype":"application/pdf","size":2048,"eTag":"etag-test"}'
WHERE bucket_id='izo-avize' AND name='3/CJPJ-47.pdf';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE r jsonb; r2 jsonb; a bigint:=current_setting('test.aviz.a')::bigint;
BEGIN
 r:=public.fn_izo_aviz_anuleaza(a,'Motiv TEST'); r2:=public.fn_izo_aviz_anuleaza(a,'Motiv TEST');
 IF r IS DISTINCT FROM r2 OR r#>>'{aviz,stare}' IS DISTINCT FROM 'anulat' THEN RAISE EXCEPTION 'cancel/retry %',r; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$ DECLARE n bigint; BEGIN
 SELECT count(*) INTO n FROM public.magazie_bucati_evenimente e JOIN public.izo_avize_iesire a ON e.id=ANY(a.eveniment_ids)
 WHERE a.id=current_setting('test.aviz.a')::bigint;
 IF n<>1 THEN RAISE EXCEPTION 'cancellation removed exit'; END IF;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='izo-avize')<>2 THEN RAISE EXCEPTION 'storage fixture missing'; END IF;
END $test$;
-- Curbe fără lungime (325 pe prod): avizul le admite cu masă, fără metri; curba fără masă e refuzată și nu consumă număr.
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$ DECLARE r jsonb; n int; BEGIN
 SELECT s.ultim_nr INTO STRICT n FROM public.izo_avize_serii s WHERE s.depozit_id=9;
 BEGIN
  PERFORM public.fn_izo_iesire_cu_aviz(gen_random_uuid(),9,19,ARRAY[current_setting('test.aviz.b14')::bigint],
   (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,false,NULL,'PH 01 ABC','{"tip":"intern"}');
  RAISE EXCEPTION 'bend without mass accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'instantaneu_incomplet' THEN RAISE; END IF; END;
 IF (SELECT s.ultim_nr FROM public.izo_avize_serii s WHERE s.depozit_id=9)<>n THEN RAISE EXCEPTION 'refusal consumed number'; END IF;
 -- Copilot P1-02: cheie deja folosită de o ieșire manuală (vechiul RPC, fără aviz) → refuz, fără număr, fără aviz, fără eveniment nou.
 DECLARE km uuid:=gen_random_uuid(); ev_inainte bigint; BEGIN
  PERFORM public.fn_izo_iesire_tronson(km,9,19,ARRAY[current_setting('test.aviz.b11')::bigint],'CJPJ MANUAL 1',(now() AT TIME ZONE 'Europe/Bucharest')::date);
  SELECT count(*) INTO ev_inainte FROM public.magazie_bucati_evenimente;
  BEGIN
   PERFORM public.fn_izo_iesire_cu_aviz(km,9,19,ARRAY[current_setting('test.aviz.b11')::bigint],
    (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,false,NULL,'PH 01 ABC','{"tip":"intern"}');
   RAISE EXCEPTION 'manual key accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'cheie_operatie_existenta' THEN RAISE; END IF; END;
  IF (SELECT s.ultim_nr FROM public.izo_avize_serii s WHERE s.depozit_id=9)<>n OR EXISTS(SELECT 1 FROM public.izo_avize_iesire a WHERE a.op_cheie=km)
   OR (SELECT count(*) FROM public.magazie_bucati_evenimente)<>ev_inainte THEN RAISE EXCEPTION 'manual key side effects'; END IF;
 END;
 r:=public.fn_izo_iesire_cu_aviz(gen_random_uuid(),9,19,ARRAY[current_setting('test.aviz.b13')::bigint],
  (now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,false,NULL,'PH 01 ABC','{"tip":"intern"}');
 IF r->>'cod' IS DISTINCT FROM 'iesit' OR (r#>>'{aviz,numar}')::int IS DISTINCT FROM n+1 OR (r#>>'{aviz,total_m}')::numeric IS DISTINCT FROM 0
  OR (r#>>'{aviz,total_kg}')::numeric IS DISTINCT FROM 321.5 OR r#>>'{aviz,continut,0,tip_cod}' IS DISTINCT FROM 'curba'
  OR (r#>>'{aviz,continut,0,unghi_curba}')::numeric IS DISTINCT FROM 20 OR r#>'{aviz,continut,0,lungime_mm}' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'bend aviz %',r; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SELECT 'IZO_AVIZ_TEST_END';
