-- Synthetic local data; all fixtures and cleanup effects roll back.
BEGIN;
DO $test$ BEGIN
 IF current_database() !~ '_test$' OR current_user<>'postgres' THEN RAISE EXCEPTION 'fixture only postgres'; END IF;
 IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') THEN RAISE EXCEPTION 'PRODLIKE mandatory'; END IF;
 IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'gate'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
  AND has_function_privilege(r.rolname,'public.fn_izo_gps_curata(integer)','EXECUTE')) THEN RAISE EXCEPTION 'cleanup exposed'; END IF;
 IF has_column_privilege('izo_montaj_writer','public.izo_declaratii_gps','lat','SELECT')
  OR has_column_privilege('izo_montaj_writer','public.izo_declaratii_gps','lon','SELECT') THEN RAISE EXCEPTION 'coordinates grant'; END IF;
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.fn_izo_gps_curata(integer)'::regprocedure)<>'izo_montaj_writer' THEN RAISE EXCEPTION 'owner'; END IF;
END $test$;
INSERT INTO public.izo_preverificari(id,uid,proiect_id,tronson_id,autor_profile_id,dispozitiv_id,stare)
 OVERRIDING SYSTEM VALUE VALUES(-4100,gen_random_uuid(),3,19,'00000000-0000-0000-0000-000000000121',gen_random_uuid(),'inchisa');
INSERT INTO public.izo_declaratii(id,uid,preverificare_id,proiect_id,tronson_id,tip,versiune,declarat_de,
 declarat_de_angajat,dispozitiv_id,ultimul_op_id,stare,payload,data_montaj,decis_la,updated_at)
 OVERRIDING SYSTEM VALUE
SELECT -4100-i,gen_random_uuid(),-4100,3,19,'cuplare',1,'00000000-0000-0000-0000-000000000121',
 121,gen_random_uuid(),gen_random_uuid(),
 CASE i WHEN 3 THEN 'respinsa' WHEN 4 THEN 'stearsa' WHEN 5 THEN 'ciorna' WHEN 8 THEN 'stearsa' ELSE 'aprobata' END,
 '{}'::jsonb,current_date,
 CASE WHEN i=2 THEN now()-interval '59 days' WHEN i IN (4,6) THEN NULL WHEN i=7 THEN now()-interval '60 days' ELSE now()-interval '61 days' END,
 CASE WHEN i=4 THEN now()-interval '61 days' ELSE now() END
FROM generate_series(1,8) i;
INSERT INTO public.izo_declaratii_gps(declaratie_id,versiune,lat,lon,precizie_m,la)
 SELECT id,1,44.1,26.2,5,now() FROM public.izo_declaratii WHERE id BETWEEN -4108 AND -4101;
-- Multiple versions of one declaration: the batch limit counts GPS rows.
INSERT INTO public.izo_declaratii_gps VALUES(-4101,2,44.2,26.3,6,now());
DO $test$ BEGIN
 BEGIN DELETE FROM public.izo_declaratii_gps WHERE declaratie_id=-4101; RAISE EXCEPTION 'postgres delete accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.izo_declaratii_gps SET lat=45 WHERE declaratie_id=-4101; RAISE EXCEPTION 'postgres update accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.izo_declaratii_gps; RAISE EXCEPTION 'postgres truncate accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('izo.gps_curata_ctx',concat_ws('|',txid_current(),-4101,1),true);
DO $test$ BEGIN
 BEGIN DELETE FROM public.izo_declaratii_gps WHERE declaratie_id=-4101; RAISE EXCEPTION 'client delete accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.izo_declaratii_gps SET lat=45 WHERE declaratie_id=-4101; RAISE EXCEPTION 'client update accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.izo_gps_stergeri; RAISE EXCEPTION 'client journal read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.fn_izo_gps_curata(); RAISE EXCEPTION 'client cleanup accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT set_config('izo.gps_curata_ctx','',true);
-- Inject a journal failure AFTER the DELETE: the cleanup must roll both back.
CREATE FUNCTION pg_temp.e4c_refuza_jurnal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'fixture journal failure' USING ERRCODE='23514'; END $$;
CREATE TRIGGER z9_e4c_jurnal_refuz BEFORE INSERT ON public.izo_gps_stergeri
 FOR EACH ROW EXECUTE FUNCTION pg_temp.e4c_refuza_jurnal();
DO $test$ BEGIN
 BEGIN PERFORM public.fn_izo_gps_curata(1); RAISE EXCEPTION 'failure injection ignored';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'fixture journal failure' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.izo_declaratii_gps)<>9 OR EXISTS(SELECT 1 FROM public.izo_gps_stergeri)
  OR coalesce(current_setting('izo.gps_curata_ctx',true),'')<>'' THEN RAISE EXCEPTION 'cleanup not atomic'; END IF;
END $test$;
DROP TRIGGER z9_e4c_jurnal_refuz ON public.izo_gps_stergeri;
DROP FUNCTION pg_temp.e4c_refuza_jurnal();
DO $test$ DECLARE v_n int; v_count int; BEGIN
 BEGIN INSERT INTO public.izo_gps_stergeri(declaratie_id,versiune,decizie_stare,decizie_la,sters_la,rulare_id)
  VALUES(-4102,1,'aprobata',now()-interval '61 days',now(),gen_random_uuid());
  RAISE EXCEPTION 'postgres journal insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.fn_izo_gps_curata(0); RAISE EXCEPTION 'zero limit'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.fn_izo_gps_curata(NULL); RAISE EXCEPTION 'null limit'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.fn_izo_gps_curata(-1); RAISE EXCEPTION 'negative limit'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 v_n:=public.fn_izo_gps_curata(1);
 IF v_n<>1 OR (SELECT count(*) FROM public.izo_gps_stergeri)<>1 THEN RAISE EXCEPTION 'batch limit %',v_n; END IF;
 v_n:=public.fn_izo_gps_curata();
 IF v_n<>3 THEN RAISE EXCEPTION 'remaining expected 3, got %',v_n; END IF;
 IF public.fn_izo_gps_curata()<>0 THEN RAISE EXCEPTION 'idempotency'; END IF;
 SELECT count(*) INTO v_count FROM public.izo_declaratii_gps WHERE declaratie_id IN (-4102,-4105,-4106,-4107,-4108);
 IF v_count<>5 THEN RAISE EXCEPTION '59d/undecided/null/exact60/recent-deletion retention'; END IF;
 IF EXISTS(SELECT 1 FROM public.izo_declaratii_gps WHERE declaratie_id IN (-4101,-4103,-4104)) THEN RAISE EXCEPTION 'old final retained'; END IF;
 IF (SELECT count(*) FROM public.izo_gps_stergeri)<>4
  OR (SELECT count(*) FROM public.izo_gps_stergeri WHERE decizie_stare='aprobata')<>2
  OR (SELECT count(*) FROM public.izo_gps_stergeri WHERE decizie_stare='respinsa')<>1
  OR (SELECT count(*) FROM public.izo_gps_stergeri WHERE decizie_stare='stearsa')<>1 THEN RAISE EXCEPTION 'journal'; END IF;
 IF EXISTS(SELECT 1 FROM public.izo_gps_stergeri j JOIN public.izo_declaratii d ON d.id=j.declaratie_id
  WHERE j.decizie_la IS DISTINCT FROM CASE WHEN d.stare='stearsa' THEN d.updated_at ELSE d.decis_la END
   OR j.sters_la<now() OR j.rulare_id IS NULL) THEN RAISE EXCEPTION 'journal metadata'; END IF;
 IF current_setting('izo.gps_curata_ctx',true)<>'' THEN RAISE EXCEPTION 'context leaked'; END IF;
 BEGIN UPDATE public.izo_gps_stergeri SET decizie_stare='respinsa' WHERE declaratie_id=-4101; RAISE EXCEPTION 'journal update';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.izo_gps_stergeri WHERE declaratie_id=-4101; RAISE EXCEPTION 'journal delete';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.izo_gps_stergeri; RAISE EXCEPTION 'journal truncate';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.fn_izo_porti_lipsa()<>'{}'::text[] THEN RAISE EXCEPTION 'post test gate'; END IF;
END $test$;
-- A writer without a context (or with a context from another tx) is also refused.
SET LOCAL ROLE izo_montaj_writer;
SELECT set_config('izo.gps_curata_ctx',concat_ws('|',txid_current(),-4102,1),true);
DO $test$ BEGIN
 BEGIN DELETE FROM public.izo_declaratii_gps WHERE declaratie_id=-4102;
  RAISE EXCEPTION 'matching context bypassed retention'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
SELECT set_config('izo.gps_curata_ctx',concat_ws('|',txid_current()-1,-4102,1),true);
DO $test$ DECLARE v_n int; BEGIN
 DELETE FROM public.izo_declaratii_gps WHERE declaratie_id=-4102;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 IF v_n<>0 THEN RAISE EXCEPTION 'stale context delete'; END IF;
 BEGIN INSERT INTO public.izo_gps_stergeri(declaratie_id,versiune,decizie_stare,decizie_la,sters_la,rulare_id)
  VALUES(-4102,1,'aprobata',now()-interval '61 days',now(),gen_random_uuid());
  RAISE EXCEPTION 'writer journal insert without context'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
ROLLBACK;
SELECT 'E4C_GPS_TEST_END';
