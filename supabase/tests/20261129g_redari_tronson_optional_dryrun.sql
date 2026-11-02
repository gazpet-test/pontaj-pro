-- Runner supplies ONE disposable transaction with migration + DRY; never commit fixtures.
CREATE FUNCTION pg_temp.r29g_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',CASE WHEN p_uid IS NULL THEN jsonb_build_object('role',p_rol)::text ELSE jsonb_build_object('sub',p_uid,'role',p_rol)::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r29g_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29g_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29g.'||p,true),''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29g_ca(uuid,text),pg_temp.r29g_refuza(text,text),pg_temp.r29g_g(text) TO authenticated,anon;
DO $t$
DECLARE own uuid; ed uuid; pr uuid; u uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129g_redari_tronson_optional:'||txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL: transaction guard'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261129120600') THEN RAISE EXCEPTION 'TEST0 FAIL: migration already committed'; END IF;
  END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  IF own IS NULL OR ed IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: owner/editor missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.red_numere WHERE cheie='P-ZXG') OR EXISTS(SELECT 1 FROM public.red_parcele WHERE id_parcela LIKE 'ZXG-%') THEN RAISE EXCEPTION 'TEST0 FAIL: ZXG already used'; END IF;
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29G','FICTIV tronson optional') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'FICTIV ZXG','ZXG','Test') RETURNING id INTO u;
  PERFORM set_config('r29g.owner',own::text,true); PERFORM set_config('r29g.editor',ed::text,true);
  PERFORM set_config('r29g.pr',pr::text,true); PERFORM set_config('r29g.u',u::text,true);
  RAISE NOTICE 'TEST0 OK';
END $t$;
SELECT pg_temp.r29g_ca(pg_temp.r29g_g('editor')::uuid,'authenticated');
DO $t$
DECLARE i integer;
BEGIN
  IF public.fn_red_rezerva_numere_parcele('ZXG',3) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST1 FAIL: first number'; END IF;
  FOR i IN 1..3 LOOP
    INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson,poz_hg)
      VALUES(pg_temp.r29g_g('pr')::uuid,pg_temp.r29g_g('u')::uuid,'ZXG-000'||i,NULL,CASE i WHEN 1 THEN '10' WHEN 2 THEN '11' ELSE '12A' END);
  END LOOP;
  IF NOT pg_temp.r29g_refuza(format('INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(%L,%L,''T3-ZXG-0004'',3)',pg_temp.r29g_g('pr'),pg_temp.r29g_g('u')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: old format'; END IF;
  IF NOT pg_temp.r29g_refuza(format('INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela) VALUES(%L,%L,''ZZZ-0004'')',pg_temp.r29g_g('pr'),pg_temp.r29g_g('u')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: wrong UAT'; END IF;
  RAISE NOTICE 'TEST1 OK';
  IF NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,10,12,3)',pg_temp.r29g_g('pr')),'42501') THEN RAISE EXCEPTION 'TEST2 FAIL'; END IF;
  RAISE NOTICE 'TEST2 OK';
  -- Copilot f8a r1 P1-01: editorul nu poate schimba tronsonul nici prin UPDATE direct
  IF NOT pg_temp.r29g_refuza(format('UPDATE public.red_parcele SET tronson=5 WHERE proiect_id=%L',pg_temp.r29g_g('pr')),'42501') THEN RAISE EXCEPTION 'TEST2b FAIL editor UPDATE tronson'; END IF;
  RAISE NOTICE 'TEST2b OK editor UPDATE tronson refuzat';
END $t$;
SELECT pg_temp.r29g_ca(pg_temp.r29g_g('owner')::uuid,'authenticated');
DO $t$
BEGIN
  IF public.fn_red_seteaza_tronson(pg_temp.r29g_g('pr')::uuid,NULL,10,12,3) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'TEST3 FAIL: prefix 12A'; END IF;

  IF NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,NULL,12,3)',pg_temp.r29g_g('pr')),'22023')
    OR NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,12,10,3)',pg_temp.r29g_g('pr')),'22023')
    OR NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,0,12,3)',pg_temp.r29g_g('pr')),'22023')
    OR NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,10,12,12)',pg_temp.r29g_g('pr')),'22023')
    OR NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,''00000000-0000-0000-0000-000000000000'',10,12,3)',pg_temp.r29g_g('pr')),'23503')
    THEN RAISE EXCEPTION 'TEST3 FAIL: invalid inputs'; END IF;
  IF public.fn_red_seteaza_tronson(pg_temp.r29g_g('pr')::uuid,pg_temp.r29g_g('u')::uuid,20,21,3) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST3 FAIL: empty interval'; END IF;
  RAISE NOTICE 'TEST3 OK';
  IF NOT pg_temp.r29g_refuza(format('UPDATE public.red_parcele SET id_parcela=''ZXG-0099'' WHERE proiect_id=%L',pg_temp.r29g_g('pr')),'23514') THEN RAISE EXCEPTION 'TEST4 FAIL: immutable ID'; END IF;
  UPDATE public.red_parcele SET tronson=4 WHERE proiect_id=pg_temp.r29g_g('pr')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST4 FAIL: no rows updated'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;
SELECT pg_temp.r29g_ca(NULL,'postgres');
DO $t$
DECLARE p record; det uuid;
BEGIN
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson,poz_hg)
    VALUES(pg_temp.r29g_g('pr')::uuid,pg_temp.r29g_g('u')::uuid,'ZXG-0004',NULL,'13');
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson,poz_hg)
    VALUES(pg_temp.r29g_g('pr')::uuid,pg_temp.r29g_g('u')::uuid,'ZXG-0005',5,'fara numar');
  FOR p IN SELECT id FROM public.red_parcele WHERE proiect_id=pg_temp.r29g_g('pr')::uuid LOOP
    INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p.id,'FICTIV ZXG','FICTIV ZXG','proprietar') RETURNING id INTO det;
    INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,nr_pv,data_pv,stare,fisier_semnat_path,semnat_primit_data)
      VALUES('A',p.id,det,pg_temp.r29g_g('u')::uuid,'PVA-ZXG-TEST-'||p.id,'2026-11-02','semnat','test/scan.pdf','2026-11-02');
  END LOOP;
END $t$;
SELECT pg_temp.r29g_ca(pg_temp.r29g_g('owner')::uuid,'authenticated');
DO $t$
DECLARE ok boolean:=false; v public.red_procese_verbale;
BEGIN
  BEGIN PERFORM public.fn_red_pv_c_creeaza(pg_temp.r29g_g('pr')::uuid,4);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN ok:=SQLERRM='Proiectul are 1 parcele fara tronson atribuit; atribuie-l inainte de PV C'; END;
  IF NOT ok THEN RAISE EXCEPTION 'TEST5 FAIL: NULL project guard/message'; END IF;
  IF public.fn_red_seteaza_tronson(pg_temp.r29g_g('pr')::uuid,NULL,13,13,5) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST5 FAIL: assign'; END IF;
  IF EXISTS(SELECT 1 FROM public.red_parcele WHERE proiect_id=pg_temp.r29g_g('pr')::uuid AND id_parcela='ZXG-0005' AND tronson IS DISTINCT FROM 5) THEN RAISE EXCEPTION 'TEST5 FAIL: nonnumeric changed'; END IF;
  v:=public.fn_red_pv_c_creeaza(pg_temp.r29g_g('pr')::uuid,4);
  IF v.tip IS DISTINCT FROM 'C' OR v.tronson IS DISTINCT FROM 4 OR v.uat_id IS DISTINCT FROM pg_temp.r29g_g('u')::uuid THEN RAISE EXCEPTION 'TEST5 FAIL: create'; END IF;
  RAISE NOTICE 'TEST5 OK';
  IF NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,10,10,5)',pg_temp.r29g_g('pr')),'P0001') THEN RAISE EXCEPTION 'TEST6 FAIL: source RPC'; END IF;
  IF NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,13,13,4)',pg_temp.r29g_g('pr')),'P0001') THEN RAISE EXCEPTION 'TEST6 FAIL: destination RPC'; END IF;
  IF NOT pg_temp.r29g_refuza(format('UPDATE public.red_parcele SET tronson=5 WHERE proiect_id=%L AND id_parcela=''ZXG-0001''',pg_temp.r29g_g('pr')),'23514') THEN RAISE EXCEPTION 'TEST6 FAIL: source direct'; END IF;
  IF NOT pg_temp.r29g_refuza(format('UPDATE public.red_parcele SET tronson=4 WHERE proiect_id=%L AND id_parcela=''ZXG-0004''',pg_temp.r29g_g('pr')),'23514') THEN RAISE EXCEPTION 'TEST6 FAIL: destination direct'; END IF;

  RAISE NOTICE 'TEST6 OK';
END $t$;
-- Copilot f8a r2 P2: PV A/B neanulat cu tronson != destinatie blocheaza mutarea (direct 23514, RPC P0001); anulat sau NULL -> permis
SELECT pg_temp.r29g_ca(NULL,'postgres');
DO $t$
DECLARE pid uuid; det uuid;
BEGIN
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson,poz_hg)
    VALUES(pg_temp.r29g_g('pr')::uuid,pg_temp.r29g_g('u')::uuid,'ZXG-0006',6,'30') RETURNING id INTO pid;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(pid,'FICTIV ZXG6','FICTIV ZXG6','proprietar') RETURNING id INTO det;
  -- generat (anulabil); ramura semnat = definitiv e aceeasi garda, iar inghetarea semnatului e acoperita de 20261129c
  INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare)
    VALUES('A',pid,det,pg_temp.r29g_g('u')::uuid,6,'PVA-ZXG-TEST-6','2026-11-02','generat');
  PERFORM set_config('r29g.p6',pid::text,true);
END $t$;
SELECT pg_temp.r29g_ca(pg_temp.r29g_g('owner')::uuid,'authenticated');
DO $t$
BEGIN
  IF NOT pg_temp.r29g_refuza(format('UPDATE public.red_parcele SET tronson=7 WHERE id=%L',pg_temp.r29g_g('p6')),'23514') THEN RAISE EXCEPTION 'TEST8 FAIL: direct PV A'; END IF;
  IF NOT pg_temp.r29g_refuza(format('UPDATE public.red_parcele SET tronson=NULL WHERE id=%L',pg_temp.r29g_g('p6')),'23514') THEN RAISE EXCEPTION 'TEST8 FAIL: direct PV A -> NULL'; END IF;
  IF NOT pg_temp.r29g_refuza(format('SELECT public.fn_red_seteaza_tronson(%L,NULL,30,30,7)',pg_temp.r29g_g('pr')),'P0001') THEN RAISE EXCEPTION 'TEST8 FAIL: RPC PV A'; END IF;
  IF public.fn_red_seteaza_tronson(pg_temp.r29g_g('pr')::uuid,NULL,30,30,6) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST8 FAIL: same tronson'; END IF;
  RAISE NOTICE 'TEST8a OK PV A generat pe alt tronson blocheaza';
END $t$;
SELECT pg_temp.r29g_ca(NULL,'postgres');
UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='TEST 29g' WHERE nr_pv='PVA-ZXG-TEST-6';
SELECT pg_temp.r29g_ca(pg_temp.r29g_g('owner')::uuid,'authenticated');
DO $t$
BEGIN
  IF public.fn_red_seteaza_tronson(pg_temp.r29g_g('pr')::uuid,NULL,30,30,7) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST8 FAIL: after annul'; END IF;
  RAISE NOTICE 'TEST8b OK dupa anulare se muta';
END $t$;
-- Copilot f8a r2 P3-01: cerere anon / authenticated fara sub nu e scutita ca mentenanta
SELECT pg_temp.r29g_ca(NULL,'authenticated');
DO $t$ BEGIN
  -- refuz 42501 (privilegii/trigger) SAU 0 randuri (RLS); starea finala se verifica mai jos ca postgres
  BEGIN UPDATE public.red_parcele SET tronson=8 WHERE id=pg_temp.r29g_g('p6')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'TEST9a OK';
END $t$;
SELECT pg_temp.r29g_ca(NULL,'anon');
DO $t$ BEGIN
  -- refuz 42501 (privilegii/trigger) SAU 0 randuri (RLS); starea finala se verifica mai jos ca postgres
  BEGIN UPDATE public.red_parcele SET tronson=8 WHERE id=pg_temp.r29g_g('p6')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'TEST9b OK';
END $t$;
SELECT pg_temp.r29g_ca(NULL,'postgres');
DO $t$ BEGIN
  IF (SELECT tronson FROM public.red_parcele WHERE id=pg_temp.r29g_g('p6')::uuid) IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'TEST9 FAIL: tronson schimbat'; END IF;
  RAISE NOTICE 'TEST9 OK';
END $t$;
SELECT pg_temp.r29g_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r29g_refuza('SELECT public.fn_red_rezerva_numere_parcele(''ZXG'',1)','42501')
    OR NOT pg_temp.r29g_refuza('SELECT public.fn_red_seteaza_tronson(NULL,NULL,1,2,3)','42501') THEN RAISE EXCEPTION 'TEST7 FAIL'; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;
SELECT pg_temp.r29g_ca(NULL,'postgres');