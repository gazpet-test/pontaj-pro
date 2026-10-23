-- Fixture only. No grants; no imports; every fact rolls back.
BEGIN;
DO $test$ BEGIN
  IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF;
END $test$;
-- Identity fixture, as postgres (the production profile trigger permits this administrative path).
UPDATE public.profiles SET employee_id=121 WHERE id='00000000-0000-0000-0000-000000000121';
SELECT public.fn_izo_seteaza_nivel(3,'stoc','fixture E4a-2');
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_tronson_config(tronson_id,proiect_id) VALUES(19,3);
INSERT INTO public.executie_pachete_lansare(id,proiect_id,tronson_id) VALUES(9400,3,19),(9401,3,18),(9404,3,19);
UPDATE public.executie_pachete_lansare SET status='aprobat' WHERE id=9404;
-- Create unlinked rows before activating the empty tronson.
INSERT INTO public.executie_tevi(id,pachet_id,serie_unica,lungime_m,tip_rand)
  VALUES(9400,9400,'old',1,'teava'),(9401,9400,'old-2',1,'teava'),(9402,9401,'legacy',1,'teava'),(9403,9400,NULL,NULL,'legare'),(9404,9404,'approved',1,'teava');
-- Activation normally refuses existing unlinked rows. Isolated fixture builds that intermediate state.
SELECT set_config('izo.montaj_ctx',txid_current()::text || '|flux|19',true);
UPDATE public.izo_tronson_config SET flux_montaj=true,server_ver=nextval('public.izo_server_ver_seq') WHERE tronson_id=19;
SELECT set_config('izo.montaj_ctx','',true);
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $fixture$
DECLARE v_id bigint; v_i integer;
BEGIN
  FOR v_i IN 1..3 LOOP
    v_id:=nextval('public.magazie_bucati_id_seq');
    INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,
      serie,sarja,perete_mm,diametru_mm,lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,
      provenienta,stare,locatie_tip,locatie_site_id,tronson_id,sursa_receptie)
    VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E4A2-'||v_i,'SARJA',8,610,
      12000,12000,12,12,'AB','A','B','beneficiar','montata','tronson',6,CASE WHEN v_i=3 THEN 18 ELSE 19 END,'manual');
    PERFORM set_config('test.e4a2_b'||v_i,v_id::text,true);
  END LOOP;
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
-- E4a-2b: the writer role alone, a stale transaction, or a changed projection is insufficient.
SET LOCAL ROLE izo_montaj_writer;
DO $guard$
DECLARE v_b public.magazie_bucati; v_dupa public.magazie_bucati; v_ctx text;
  v_before_new jsonb; v_fals jsonb; v_cheie text; v_parti text[]; v_i integer;
BEGIN
  SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE id=current_setting('test.e4a2_b1')::bigint;
  BEGIN
    UPDATE public.magazie_bucati SET executie_teava_id=9400 WHERE id=v_b.id;
    RAISE EXCEPTION 'writer without context accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  v_dupa:=v_b; v_dupa.executie_teava_id:=9400;
  v_dupa.server_ver:=nextval('public.izo_server_ver_seq'); v_dupa.updated_at:=clock_timestamp();
  v_ctx:=concat_ws('|',txid_current()::text,'leaga','9400','3','19',v_dupa.server_ver::text,v_b.id::text);
  PERFORM public.fn_izo_montaj_marcheaza('0' || substring(v_ctx FROM position('|' IN v_ctx)),to_jsonb(v_b),to_jsonb(v_dupa),NULL);
  BEGIN
    UPDATE public.magazie_bucati SET executie_teava_id=v_dupa.executie_teava_id,
      server_ver=v_dupa.server_ver,updated_at=v_dupa.updated_at WHERE id=v_b.id;
    RAISE EXCEPTION 'writer wrong transaction accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  -- E4a-2d: SELECT sees generated values; BEFORE UPDATE sees NULL for both.
  IF v_b.serie_canon IS DISTINCT FROM 'E4A21' OR v_b.lungime_cm IS DISTINCT FROM 1200 THEN
    RAISE EXCEPTION 'generated regression fixture invalid'; END IF;
  v_before_new:=to_jsonb(v_dupa)||jsonb_build_object('serie_canon',NULL,'lungime_cm',NULL);
  PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa),NULL);
  IF public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b),v_before_new) IS NOT TRUE THEN
    RAISE EXCEPTION 'BEFORE generated projection refused'; END IF;
  -- Each context coordinate is mandatory, even with otherwise exact row images.
  FOR v_i IN 1..7 LOOP
    v_parti:=string_to_array(v_ctx,'|'); v_parti[v_i]:=CASE WHEN v_i=2 THEN 'nota' ELSE '0' END;
    PERFORM public.fn_izo_montaj_marcheaza(array_to_string(v_parti,'|'),to_jsonb(v_b),to_jsonb(v_dupa),NULL);
    BEGIN
      PERFORM public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b),v_before_new);
      RAISE EXCEPTION 'writer forged coordinate accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  END LOOP;
  PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa),NULL);
  -- Exact expected OLD/NEW still protect stamps and stale snapshots.
  FOREACH v_cheie IN ARRAY ARRAY['updated_at','server_ver'] LOOP
    BEGIN
      PERFORM public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b),
        v_before_new||jsonb_build_object(v_cheie,NULL));
      RAISE EXCEPTION 'writer wrong stamp accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  END LOOP;
  BEGIN
    PERFORM public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b)||jsonb_build_object('updated_at',NULL),v_before_new);
    RAISE EXCEPTION 'writer stale before accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  -- Non-NULL generated values are not the BEFORE trigger image either.
  FOREACH v_cheie IN ARRAY ARRAY['serie_canon','lungime_cm'] LOOP
    BEGIN
      PERFORM public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b),
        v_before_new||jsonb_build_object(v_cheie,to_jsonb(v_b)->v_cheie));
      RAISE EXCEPTION 'writer forged generated image accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  END LOOP;
  -- Even matching forged expected images cannot change any immutable source column.
  FOR v_cheie IN SELECT jsonb_object_keys(to_jsonb(v_b)-ARRAY[
    'executie_teava_id','server_ver','updated_at','serie_canon','lungime_cm']) LOOP
    v_fals:=jsonb_build_object(v_cheie,CASE WHEN to_jsonb(v_b)->v_cheie='null'::jsonb
      THEN '"FORGED"'::jsonb ELSE 'null'::jsonb END);
    PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa)||v_fals,NULL);
    BEGIN
      PERFORM public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b),v_before_new||v_fals);
      RAISE EXCEPTION 'writer immutable source accepted: %',v_cheie;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  END LOOP;
  -- Even matching forged before/after images cannot authorize an identity change.
  PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa)||jsonb_build_object('serie','FORGED'),NULL);
  BEGIN
    PERFORM public.fn_izo_garda_montaj('magazie_bucati','UPDATE',to_jsonb(v_b),
      v_before_new||jsonb_build_object('serie','FORGED'));
    RAISE EXCEPTION 'writer changed projection accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.fn_izo_garda_montaj('magazie_bucati_evenimente','INSERT',NULL,to_jsonb(v_dupa));
    RAISE EXCEPTION 'writer fact accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'E4a context montaj invalid%' THEN RAISE; END IF; END;
  PERFORM public.fn_izo_montaj_marcheaza(NULL,NULL,NULL,NULL);
END $guard$;
RESET ROLE;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_at timestamptz; v_b bigint:=current_setting('test.e4a2_b1')::bigint; v_result jsonb;
  v_inainte jsonb; v_dupa jsonb; v_legate jsonb; v_randuri bigint;
BEGIN
  IF has_function_privilege(current_user,'public.fn_izo_montaj_marcheaza(text,jsonb,jsonb,jsonb)','EXECUTE')
    OR has_function_privilege(current_user,'public.fn_izo_garda_montaj(text,text,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'private marker exposed'; END IF;
  SELECT to_jsonb(b) INTO STRICT v_inainte FROM public.magazie_bucati b WHERE id=v_b;
  IF current_user <> 'authenticated' OR session_user <> 'authenticator'
    OR v_inainte->>'tip_cod' IS DISTINCT FROM 'teava'
    OR v_inainte->>'provenienta' IS DISTINCT FROM 'beneficiar'
    OR v_inainte->>'executie_teava_id' IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public.izo_tronson_config
      WHERE tronson_id=(v_inainte->>'tronson_id')::bigint AND flux_montaj) THEN
    RAISE EXCEPTION 'client refusal fixture invalid'; END IF;
  -- E4a-2c: RLS USING filters the protected row before any row trigger runs.
  -- UPDATE 0 is a refusal too; command success alone never proves a client write.
  BEGIN
    UPDATE public.magazie_bucati SET executie_teava_id=9400 WHERE id=v_b;
    GET DIAGNOSTICS v_randuri = ROW_COUNT;
    IF v_randuri <> 0 THEN RAISE EXCEPTION 'client link accepted'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Client GUCs are untrusted, including exact images and the correct transaction.
  v_dupa:=v_inainte||jsonb_build_object('executie_teava_id',9400);
  PERFORM set_config('izo.montaj_ctx',concat_ws('|',txid_current()::text,'leaga','9400','3','19',v_inainte->>'server_ver',v_b::text),true);
  PERFORM set_config('izo.montaj_bucata_inainte',v_inainte::text,true);
  PERFORM set_config('izo.montaj_bucata_dupa',v_dupa::text,true);
  BEGIN
    UPDATE public.magazie_bucati SET executie_teava_id=9400 WHERE id=v_b;
    GET DIAGNOSTICS v_randuri = ROW_COUNT;
    IF v_randuri <> 0 THEN RAISE EXCEPTION 'client forged context accepted'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('izo.montaj_ctx','',true);
  PERFORM set_config('izo.montaj_bucata_inainte','',true);
  PERFORM set_config('izo.montaj_bucata_dupa','',true);
  IF (SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE id=v_b) IS DISTINCT FROM v_inainte THEN
    RAISE EXCEPTION 'client refusal changed piece'; END IF;
  -- #824: the non-flow picker writes text on executie_tevi, not the registry link.
  UPDATE public.executie_tevi SET serie_unica='LEGACY-PICKER',lungime_m=12
    WHERE id=9402 AND pachet_id=9401 RETURNING to_jsonb(executie_tevi) INTO STRICT v_dupa;
  IF v_dupa->>'serie_unica' IS DISTINCT FROM 'LEGACY-PICKER'
    OR (v_dupa->>'lungime_m')::numeric IS DISTINCT FROM 12::numeric THEN
    RAISE EXCEPTION 'nonflow picker changed'; END IF;
  SELECT updated_at INTO v_at FROM public.executie_tevi WHERE id=9400;
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9400,v_b,'2000-01-01'::timestamptz);
    RAISE EXCEPTION 'stale accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pachet_schimbat' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9400,current_setting('test.e4a2_b3')::bigint,v_at);
    RAISE EXCEPTION 'wrong tronson accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'bucata_incompatibila' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9402,v_b,(SELECT updated_at FROM public.executie_tevi WHERE id=9402));
    RAISE EXCEPTION 'nonflow accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'flux_inactiv' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9404,v_b,(SELECT updated_at FROM public.executie_tevi WHERE id=9404));
    RAISE EXCEPTION 'approved package accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pachet_needitabil' THEN RAISE; END IF; END;
  v_result:=public.fn_izo_pachet_leaga(9400,v_b,v_at);
  IF (SELECT to_jsonb(b)-ARRAY['executie_teava_id','server_ver','updated_at'] FROM public.magazie_bucati b WHERE id=v_b)
    IS DISTINCT FROM (v_inainte-ARRAY['executie_teava_id','server_ver','updated_at']) THEN RAISE EXCEPTION 'link changed registry data'; END IF;
  IF v_result->>'cod'<>'legat' OR (SELECT executie_teava_id FROM public.magazie_bucati WHERE id=v_b)<>9400
    OR (SELECT serie_unica FROM public.executie_tevi WHERE id=9400)<>'E4A2-1'
    OR (SELECT lungime_m FROM public.executie_tevi WHERE id=9400)<>12 THEN RAISE EXCEPTION 'link projection'; END IF;
  SELECT to_jsonb(b) INTO STRICT v_legate FROM public.magazie_bucati b WHERE id=v_b;
  BEGIN
    UPDATE public.magazie_bucati SET executie_teava_id=NULL WHERE id=v_b;
    GET DIAGNOSTICS v_randuri = ROW_COUNT;
    IF v_randuri <> 0 THEN RAISE EXCEPTION 'client unlink accepted'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.magazie_bucati SET executie_teava_id=9401 WHERE id=v_b;
    GET DIAGNOSTICS v_randuri = ROW_COUNT;
    IF v_randuri <> 0 THEN RAISE EXCEPTION 'client relink accepted'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE id=v_b) IS DISTINCT FROM v_legate THEN
    RAISE EXCEPTION 'client unlink or relink changed piece'; END IF;
  IF public.fn_izo_pachet_leaga(9400,v_b,(SELECT updated_at FROM public.executie_tevi WHERE id=9400))->>'cod'<>'fara_efect' THEN RAISE EXCEPTION 'idempotence'; END IF;
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9401,v_b,(SELECT updated_at FROM public.executie_tevi WHERE id=9401));
    RAISE EXCEPTION 'double piece accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'bucata_deja_legata' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.fn_izo_pachet_dezleaga(9403,'test motiv');
    RAISE EXCEPTION 'coupling unlink accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'rand_fara_bucata' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.fn_izo_pachet_dezleaga(9400,'');
    RAISE EXCEPTION 'empty reason accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'motiv_obligatoriu' THEN RAISE; END IF; END;
  PERFORM public.fn_izo_pachet_dezleaga(9400,'corectie identificare');
  IF (SELECT to_jsonb(b)-ARRAY['executie_teava_id','server_ver','updated_at'] FROM public.magazie_bucati b WHERE id=v_b)
    IS DISTINCT FROM (v_inainte-ARRAY['executie_teava_id','server_ver','updated_at']) THEN RAISE EXCEPTION 'unlink changed registry data'; END IF;
  IF coalesce(current_setting('izo.montaj_ctx',true),'')<>''
    OR coalesce(current_setting('izo.montaj_bucata_inainte',true),'')<>''
    OR coalesce(current_setting('izo.montaj_bucata_dupa',true),'')<>''
    OR coalesce(current_setting('izo.montaj_rand_asteptat',true),'')<>'' THEN RAISE EXCEPTION 'context not cleared'; END IF;
  IF (SELECT executie_teava_id FROM public.magazie_bucati WHERE id=v_b) IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public.executie_tevi WHERE id=9400) THEN RAISE EXCEPTION 'unlink'; END IF;
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9400,v_b,v_at);
    RAISE EXCEPTION 'stale after unlink accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pachet_schimbat' THEN RAISE; END IF; END;
  -- A second piece/link in this SAME transaction must use its own fresh context.
  SELECT to_jsonb(b) INTO STRICT v_legate FROM public.magazie_bucati b
    WHERE id=current_setting('test.e4a2_b2')::bigint;
  v_result:=public.fn_izo_pachet_leaga(9401,current_setting('test.e4a2_b2')::bigint,
    (SELECT updated_at FROM public.executie_tevi WHERE id=9401));
  IF v_result->>'cod' IS DISTINCT FROM 'legat' OR NOT EXISTS(SELECT 1 FROM public.magazie_bucati
    WHERE id=current_setting('test.e4a2_b2')::bigint AND executie_teava_id=9401
      AND serie_canon='E4A22' AND lungime_cm=1200) THEN
    RAISE EXCEPTION 'second server link failed'; END IF;
  PERFORM public.fn_izo_pachet_dezleaga(9401,'regresie a doua legare');
  IF (SELECT to_jsonb(b)-ARRAY['server_ver','updated_at'] FROM public.magazie_bucati b
      WHERE id=current_setting('test.e4a2_b2')::bigint)
    IS DISTINCT FROM (v_legate-ARRAY['server_ver','updated_at']) THEN
    RAISE EXCEPTION 'second unlink changed registry data'; END IF;
  BEGIN
    PERFORM public.fn_izo_pachet_completeaza(gen_random_uuid(),9400,'2000-01-01'::timestamptz,'TR15S1','TR15S2');
    RAISE EXCEPTION 'stale complete accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'pachet_schimbat' THEN RAISE; END IF; END;
  -- The supplied E4a-1 baseline has no weld/cap/journal schema: refuse with zero writes.
  BEGIN
    PERFORM public.fn_izo_pachet_completeaza(gen_random_uuid(),9400,(SELECT updated_at FROM public.executie_pachete_lansare WHERE id=9400),'TR15S1','TR15S2');
    RAISE EXCEPTION 'missing E4b accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'completare_necesita_E4b_suduri_capete_jurnal' THEN RAISE; END IF; END;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000103","role":"authenticated"}',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.fn_izo_pachet_leaga(9400,current_setting('test.e4a2_b1')::bigint,(SELECT updated_at FROM public.executie_tevi WHERE id=9400));
    RAISE EXCEPTION 'unauthorized accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'fara_drept' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SELECT 'E4A2_PACHET_END' AS marker;
