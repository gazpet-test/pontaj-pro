-- All fixture facts are rolled back. No GRANT/REVOKE; no import shares a transaction.
BEGIN;
DO $test$
DECLARE v_body text;
BEGIN
  IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF;
  IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'gate not green'; END IF;
  IF has_table_privilege('authenticated','public.izo_tronson_config','UPDATE')
    OR has_function_privilege('authenticated','public.fn_izo_seteaza_flux(bigint,boolean,text)','EXECUTE')
    OR has_function_privilege('anon','public.fn_izo_pachet_aprobare_transgaz(bigint,timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION 'ACL exposed'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.izo_tronson_config'::regclass) THEN RAISE EXCEPTION 'RLS'; END IF;
  -- Mutation proves the stamp checks trigger state. Exception subtransaction restores it.
  BEGIN
    ALTER TABLE public.executie_tevi DISABLE TRIGGER a0_izo_flux_tevi;
    IF cardinality(public.fn_izo_porti_lipsa())=0 THEN RAISE EXCEPTION 'mutation missed'; END IF;
    RAISE EXCEPTION 'undo mutation' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $test$;
SELECT public.fn_izo_seteaza_nivel(3,'stoc','fixture E4a');
SELECT set_config('izo.registru_tx','',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.fn_izo_seteaza_flux(19,true,'config lipsa');
    RAISE EXCEPTION 'missing config accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'config_lipsa' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.izo_tronson_config(tronson_id,proiect_id,sens_numerotare) VALUES(19,3,'descrescator');
    RAISE EXCEPTION 'descending without start accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.izo_tronson_config(tronson_id,proiect_id) VALUES(19,1);
    RAISE EXCEPTION 'wrong project accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'E4a proiect tronson diferit' THEN RAISE; END IF;
  END;
END $test$;
INSERT INTO public.izo_tronson_config(tronson_id,proiect_id) VALUES(19,3);
INSERT INTO public.executie_pachete_lansare(id,proiect_id,tronson_id) VALUES(9100,3,19),(9101,3,18),(9102,3,18);
SELECT public.fn_izo_seteaza_flux(19,true,'fixture flux E4a');
-- Administrative server insert, exact projection and transaction context.
SELECT set_config('izo.montaj_ctx',txid_current()::text || '|completeaza|9100',true);
SELECT set_config('izo.montaj_rand_asteptat',to_jsonb(jsonb_populate_record(NULL::public.executie_tevi,
  '{"id":9200,"pachet_id":9100,"serie_unica":"FLOW","lungime_m":12,"tip_rand":"teava"}'::jsonb))::text,true);
INSERT INTO public.executie_tevi(id,pachet_id,serie_unica,lungime_m,tip_rand) VALUES(9200,9100,'FLOW',12,'teava');
SELECT set_config('izo.montaj_ctx','',true);
SELECT set_config('izo.montaj_rand_asteptat','',true);
INSERT INTO public.executie_tevi(id,pachet_id,serie_unica,lungime_m) VALUES(9201,9101,'NONFLOW',12);
INSERT INTO public.executie_pachete_documente(id,pachet_id,tip_document,fisier_path)
  VALUES(9300,9100,'anexa','fixture-flow.pdf');
DO $test$ BEGIN
  BEGIN
    PERFORM public.fn_izo_pachet_aprobare_transgaz(9100,'2000-01-01'::timestamptz,'semnat.pdf');
    RAISE EXCEPTION 'stale approval accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'pachet_schimbat' THEN RAISE; END IF;
  END;
END $test$;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $test$
DECLARE v_sql text; v_msg text; v_count integer:=0;
BEGIN
  -- Paths 1/4/5/7/8/18/21: row create/edit/delete/move, header/km, approvals/docs.
  FOREACH v_sql IN ARRAY ARRAY[
    'INSERT INTO public.executie_tevi(pachet_id,serie_unica,lungime_m) VALUES(9100,''client'',12)',
    'UPDATE public.executie_tevi SET observatii=''nota'' WHERE id=9200',
    'UPDATE public.executie_tevi SET pm_cod=''PM'' WHERE id=9200',
    'UPDATE public.executie_tevi SET pa_ut_cod=''PA'' WHERE id=9200',
    'UPDATE public.executie_tevi SET ut_cod=''UT'' WHERE id=9200',
    'DELETE FROM public.executie_tevi WHERE id=9200',
    'UPDATE public.executie_tevi SET pachet_id=9101 WHERE id=9200',
    'UPDATE public.executie_tevi SET pachet_id=9100 WHERE id=9201',
    'UPDATE public.executie_pachete_lansare SET tronson_id=18 WHERE id=9100',
    'UPDATE public.executie_pachete_lansare SET tronson_id=19 WHERE id=9101',
    'UPDATE public.executie_pachete_lansare SET km_start_m=100 WHERE id=9100',
    'UPDATE public.executie_pachete_lansare SET status=''aprobat'' WHERE id=9100',
    'DELETE FROM public.executie_pachete_lansare WHERE id=9100',
    'UPDATE public.executie_pachete_documente SET fisier_path=''changed'' WHERE id=9300',
    'DELETE FROM public.executie_pachete_documente WHERE id=9300',
    'INSERT INTO public.executie_pachete_documente(pachet_id,tip_document,fisier_path) VALUES(9100,''pdf_aprobare_transgaz'',''forged'')',
    'UPDATE public.executie_tronsoane SET cod=''client'' WHERE id=19'
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'write unexpectedly allowed: %',v_sql;
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_msg=MESSAGE_TEXT;
      IF v_msg NOT LIKE 'E4a flux:%' THEN RAISE EXCEPTION 'wrong refusal: % / %',v_sql,v_msg; END IF;
      v_count:=v_count+1;
    END;
  END LOOP;
  -- Existing editor on non-flow: insert, notes, move, delete, header and document still work.
  INSERT INTO public.executie_tevi(pachet_id,serie_unica,lungime_m) VALUES(9101,'client-ok',12);
  UPDATE public.executie_tevi SET observatii='allowed',pm_cod='PM',pa_ut_cod='PA',ut_cod='UT' WHERE id=9201;
  UPDATE public.executie_tevi SET pachet_id=9102 WHERE id=9201;
  DELETE FROM public.executie_tevi WHERE id=9201;
  UPDATE public.executie_pachete_lansare SET km_start_m=200 WHERE id=9101;
  INSERT INTO public.executie_pachete_documente(pachet_id,tip_document,fisier_path) VALUES(9101,'anexa','nonflow');
  DELETE FROM public.executie_pachete_documente WHERE fisier_path='nonflow';
  RAISE NOTICE 'E4a: % client refusals; non-flow editor works',v_count;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$ BEGIN
  IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'gate changed after tests'; END IF;
END $test$;
ROLLBACK;
