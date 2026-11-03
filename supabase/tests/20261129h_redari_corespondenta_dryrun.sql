-- DRY 20261129h_redari_corespondenta. Runner: o singura tranzactie ANULATA (migrare + teste + revenire + ROLLBACK).
CREATE FUNCTION pg_temp.r29h_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',CASE WHEN p_uid IS NULL THEN jsonb_build_object('role',p_rol)::text ELSE jsonb_build_object('sub',p_uid,'role',p_rol)::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r29h_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29h_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29h.'||p,true),''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29h_ca(uuid,text),pg_temp.r29h_refuza(text,text),pg_temp.r29h_g(text) TO authenticated,anon,service_role;
DO $t$
DECLARE own uuid; ed uuid; vw uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129h_redari_corespondenta:'||txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL: garda'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level IN ('editor','admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level='editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  IF own IS NULL OR ed IS NULL OR vw IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa'; END IF;
  PERFORM set_config('r29h.owner',own::text,true); PERFORM set_config('r29h.editor',ed::text,true); PERFORM set_config('r29h.viewer',vw::text,true);
  IF (SELECT count(*) FROM public.red_corespondenta WHERE stare='draft' AND aprobat_la IS NULL) <> 10 THEN RAISE EXCEPTION 'TEST0 FAIL: lista initiala'; END IF;
  RAISE NOTICE 'TEST0 OK';
END $t$;
-- TEST1: editorul nu aproba, nu marcheaza trimis fara aprobare, nu schimba codul, nu scrie aprobat_de, nu sterge
SELECT pg_temp.r29h_ca(pg_temp.r29h_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET stare='aprobat' WHERE cod='A4'$q$,'42501') THEN RAISE EXCEPTION 'TEST1 FAIL: editor aproba'; END IF;
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET stare='trimis', trimis_la='2026-11-03' WHERE cod='A4'$q$,'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: trimis fara aprobare'; END IF;
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET cod='Z9' WHERE cod='A4'$q$,'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: cod schimbat'; END IF;
  IF NOT pg_temp.r29h_refuza($q$DELETE FROM public.red_corespondenta WHERE cod='A4'$q$,'42501') THEN RAISE EXCEPTION 'TEST1 FAIL: delete'; END IF;
  IF NOT pg_temp.r29h_refuza(format($q$INSERT INTO public.red_corespondenta(proiect_id,cod,ordine,destinatar,subiect,stare) SELECT proiect_id,'Z1',99,'x','y','aprobat' FROM public.red_corespondenta LIMIT 1$q$),'42501') THEN RAISE EXCEPTION 'TEST1 FAIL: insert aprobat'; END IF;
  UPDATE public.red_corespondenta SET stare='la_avocat', aprobat_de=pg_temp.r29h_g('editor')::uuid, aprobat_la=now(), observatii='test' WHERE cod='A1';
  IF (SELECT aprobat_de IS NOT NULL OR aprobat_la IS NOT NULL OR versiune<>2 FROM public.red_corespondenta WHERE cod='A1') THEN RAISE EXCEPTION 'TEST1 FAIL: aprobat_de scris din UI / versiune'; END IF;
  INSERT INTO public.red_corespondenta(proiect_id,cod,ordine,destinatar,subiect,created_by) SELECT proiect_id,'Z2',98,'x','y',pg_temp.r29h_g('owner')::uuid FROM public.red_corespondenta LIMIT 1;
  IF (SELECT created_by IS DISTINCT FROM pg_temp.r29h_g('editor')::uuid FROM public.red_corespondenta WHERE cod='Z2') THEN RAISE EXCEPTION 'TEST1 FAIL: autor falsificat'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;
-- TEST2: owner-ul aproba; apoi editorul poate marca trimis (cu data); fara data -> refuz; revenirea la draft sterge aprobarea
SELECT pg_temp.r29h_ca(pg_temp.r29h_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET stare='aprobat' WHERE cod='A4';
  IF (SELECT aprobat_de IS DISTINCT FROM pg_temp.r29h_g('owner')::uuid OR aprobat_la IS NULL FROM public.red_corespondenta WHERE cod='A4') THEN RAISE EXCEPTION 'TEST2 FAIL: aprobare owner'; END IF;
  RAISE NOTICE 'TEST2a OK';
END $t$;
SELECT pg_temp.r29h_ca(pg_temp.r29h_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET stare='trimis' WHERE cod='A4'$q$,'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: trimis fara data'; END IF;
  UPDATE public.red_corespondenta SET stare='trimis', trimis_la='2026-11-03', nr_inregistrare='TEST-1' WHERE cod='A4';
  IF (SELECT stare<>'trimis' OR aprobat_la IS NULL FROM public.red_corespondenta WHERE cod='A4') THEN RAISE EXCEPTION 'TEST2 FAIL: trimis dupa aprobare'; END IF;
  UPDATE public.red_corespondenta SET stare='raspuns_primit' WHERE cod='A4';
  -- Jakarinos r1 P1-01: continut schimbat dupa aprobare -> nu ramane trimis / aprobat
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET destinatar='alt destinatar' WHERE cod='A4'$q$,'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: continut schimbat pe trimis'; END IF;
  UPDATE public.red_corespondenta SET stare='draft' WHERE cod='A4';
  IF (SELECT aprobat_la IS NOT NULL FROM public.red_corespondenta WHERE cod='A4') THEN RAISE EXCEPTION 'TEST2 FAIL: draft pastreaza aprobarea'; END IF;
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET stare='trimis', trimis_la='2026-11-03' WHERE cod='A4'$q$,'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: trimis dupa revenire la draft'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;
SELECT pg_temp.r29h_ca(pg_temp.r29h_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET stare='aprobat' WHERE cod='B1';
  RAISE NOTICE 'TEST2c aprobat B1';
END $t$;
SELECT pg_temp.r29h_ca(pg_temp.r29h_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET documente='alt document', stare='trimis', trimis_la='2026-11-03' WHERE cod='B1'$q$,'23514') THEN RAISE EXCEPTION 'TEST2c FAIL: continut + trimis'; END IF;
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET subiect='alt subiect' WHERE cod='B1'$q$,'23514') THEN RAISE EXCEPTION 'TEST2c FAIL: continut pe aprobat'; END IF;
  UPDATE public.red_corespondenta SET subiect='alt subiect', stare='la_avocat' WHERE cod='B1';
  IF (SELECT aprobat_la IS NOT NULL OR stare<>'la_avocat' FROM public.red_corespondenta WHERE cod='B1') THEN RAISE EXCEPTION 'TEST2c FAIL: aprobarea nu a cazut'; END IF;
  UPDATE public.red_corespondenta SET observatii='doar observatii' WHERE cod='B1';
  RAISE NOTICE 'TEST2c OK';
END $t$;
-- TEST3: viewer citeste dar nu scrie (RLS: 0 randuri sau refuz); anon nu vede nimic
SELECT pg_temp.r29h_ca(pg_temp.r29h_g('viewer')::uuid,'authenticated');
DO $t$ DECLARE n integer; BEGIN
  IF (SELECT count(*) FROM public.red_corespondenta) <> 11 THEN RAISE EXCEPTION 'TEST3 FAIL: viewer nu vede lista'; END IF;
  BEGIN UPDATE public.red_corespondenta SET observatii='viewer' WHERE cod='B1'; GET DIAGNOSTICS n=ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n:=0; END;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST3 FAIL: viewer a scris'; END IF;
  RAISE NOTICE 'TEST3a OK';
END $t$;
SELECT pg_temp.r29h_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r29h_refuza('SELECT count(*) FROM public.red_corespondenta','42501') THEN RAISE EXCEPTION 'TEST3 FAIL: anon citeste'; END IF;
  RAISE NOTICE 'TEST3b OK';
END $t$;
-- TEST6 (Jakarinos r1 P1-02): service_role fara sub NU e mentenanta -> nu aproba
SELECT pg_temp.r29h_ca(NULL,'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.r29h_refuza($q$UPDATE public.red_corespondenta SET stare='aprobat' WHERE cod='B2'$q$,'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: service_role aproba'; END IF;
  RAISE NOTICE 'TEST6 OK';
END $t$;
-- TEST4: jurnalul a primit randurile (insert initial + update-uri)
SELECT pg_temp.r29h_ca(NULL,'postgres');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela='red_corespondenta' AND actiune='insert') < 10 THEN RAISE EXCEPTION 'TEST4 FAIL: jurnal insert'; END IF;
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela='red_corespondenta' AND actiune='update') < 5 THEN RAISE EXCEPTION 'TEST4 FAIL: jurnal update'; END IF;
  RAISE NOTICE 'TEST4 OK';
  -- TEST5 (Jakarinos r1 P2-04/05): dupa folosire, conditia de refuz a revenirii e adevarata (revenirea curata e dovedita de runner pe starea initiala)
  IF NOT (EXISTS (SELECT 1 FROM public.red_corespondenta WHERE versiune > 1 OR stare <> 'draft') OR (SELECT count(*) FROM public.red_corespondenta) <> 10
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_corespondenta' AND (actiune <> 'insert' OR user_id IS NOT NULL))
     OR (SELECT count(*) FROM public.red_jurnal WHERE tabela = 'red_corespondenta') <> 10) THEN RAISE EXCEPTION 'TEST5 FAIL: revenirea ar trece dupa folosire'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;
