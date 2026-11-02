-- Runner supplies ONE disposable transaction: apply migration, run DRY, discard transaction.
-- No transaction control here. Signed fixtures are inserted as postgres, as in 20261129d.
DO $fixture$
DECLARE pr uuid; u uuid; p uuid; p2 uuid; d1 uuid; d2 uuid; d3 uuid; proprietar uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129f_redari_pvb_coproprietari:'||txid_current() THEN RAISE EXCEPTION 'DRY: tranzactie neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261129120500') THEN RAISE EXCEPTION 'DRY: versiune deja comisa'; END IF;
  SELECT id INTO proprietar FROM public.profiles WHERE is_owner AND email='razvan.trusu@gazpet.ro';
  PERFORM set_config('r29f.editor',(SELECT a.profile_id::text FROM public.user_module_access a JOIN public.profiles pp ON pp.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='editor' AND pp.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1),true);
  IF current_setting('r29f.editor',true) IS NULL OR current_setting('r29f.editor',true)='' THEN RAISE EXCEPTION 'DRY: editor non-owner lipsa'; END IF;
  IF proprietar IS NULL THEN RAISE EXCEPTION 'DRY: owner lipsa'; END IF;
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29F','Fictiv coproprietari') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'Fictiv','ZXF','Test') RETURNING id INTO u;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'T7-ZXF-0001',7) RETURNING id INTO p;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'T7-ZXF-0002',7) RETURNING id INTO p2;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p,'FICTIV UNU','FICTIV UNU','proprietar') RETURNING id INTO d1;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p,'FICTIV DOI','FICTIV DOI','proprietar') RETURNING id INTO d2;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p2,'FICTIV TREI','FICTIV TREI','proprietar') RETURNING id INTO d3;
  INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare,fisier_semnat_path,semnat_primit_data)
    VALUES('A',p,d1,u,7,'PVA-ZXF-0001','2026-11-02','semnat','test/scan.pdf','2026-11-02'),
          ('A',p2,d3,u,7,'PVA-ZXF-0003','2026-11-02','semnat','test/scan.pdf','2026-11-02');
  PERFORM set_config('r29f.pr',pr::text,true); PERFORM set_config('r29f.u',u::text,true);
  PERFORM set_config('r29f.p',p::text,true); PERFORM set_config('r29f.p2',p2::text,true); PERFORM set_config('r29f.d2',d2::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',proprietar,'role','authenticated')::text,true);
END $fixture$;
SET LOCAL ROLE authenticated;
DO $t$
DECLARE refuz boolean:=false;
BEGIN
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=current_setting('r29f.p')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL'; END IF;
  RAISE NOTICE 'TEST1 OK';
  IF public.fn_red_pv_c_neacoperite(current_setting('r29f.u')::uuid,7) IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'TEST5 FAIL neacoperite'; END IF;
  BEGIN
    PERFORM public.fn_red_pv_c_creeaza(current_setting('r29f.pr')::uuid,7);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN refuz:=SQLERRM='Tronsonul are parcele fara PV A semnat sau PV B: 1';
  END;
  IF NOT refuz THEN RAISE EXCEPTION 'TEST5 FAIL refuz/numar'; END IF;
  RAISE NOTICE 'TEST5 OK';
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=current_setting('r29f.p2')::uuid) IS DISTINCT FROM 'A' THEN RAISE EXCEPTION 'TEST4 FAIL'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;
RESET ROLE;
INSERT INTO public.red_procese_verbale(tip,parcela_id,uat_id,tronson,nr_pv,data_pv,stare,motiv_pv_b)
  VALUES('B',current_setting('r29f.p')::uuid,current_setting('r29f.u')::uuid,7,'PVB-ZXF-0001','2026-11-02','generat','neprezentat');
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=current_setting('r29f.p')::uuid) IS DISTINCT FROM 'B' THEN RAISE EXCEPTION 'TEST2 FAIL'; END IF;
  IF public.fn_red_pv_c_neacoperite(current_setting('r29f.u')::uuid,7) IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'TEST2 FAIL neacoperite'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;
RESET ROLE;
UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='Fixture' WHERE nr_pv='PVB-ZXF-0001';
INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare,fisier_semnat_path,semnat_primit_data)
  VALUES('A',current_setting('r29f.p')::uuid,current_setting('r29f.d2')::uuid,current_setting('r29f.u')::uuid,7,'PVA-ZXF-0002','2026-11-02','semnat','test/scan.pdf','2026-11-02');
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=current_setting('r29f.p')::uuid) IS DISTINCT FROM 'A' THEN RAISE EXCEPTION 'TEST3 FAIL'; END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $t$
DECLARE refuz boolean:=false;
BEGIN
  BEGIN PERFORM public.fn_red_pv_creeaza('B',current_setting('r29f.p')::uuid,NULL,NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN refuz:=SQLERRM LIKE '%PV B nu este necesar%'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'TEST7 FAIL creare B cu toti PV A'; END IF;
  RAISE NOTICE 'TEST7 OK creare PV B refuzata cand toti au PV A';
END $t$;
RESET ROLE;
INSERT INTO public.red_procese_verbale(tip,parcela_id,uat_id,tronson,nr_pv,data_pv,stare,motiv_pv_b)
  VALUES('B',current_setting('r29f.p')::uuid,current_setting('r29f.u')::uuid,7,'PVB-ZXF-0002','2026-11-02','generat','neprezentat');
-- Copilot f7 r2 P3: TEST8 ruleaza ca EDITOR non-owner (garda e SECURITY INVOKER, sub RLS-ul apelantului)
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('r29f.editor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE refuz boolean:=false;
BEGIN
  BEGIN UPDATE public.red_procese_verbale SET stare='semnat',semnat_primit_data='2026-11-03',fisier_semnat_path='TEST/b.pdf' WHERE nr_pv='PVB-ZXF-0002';
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM LIKE 'PV B nu se mai poate semna%'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'TEST8 FAIL semnare B cu toti PV A'; END IF;
  UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='toti au PV A' WHERE nr_pv='PVB-ZXF-0002';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST8 FAIL anulare'; END IF;
  RAISE NOTICE 'TEST8 OK semnare PV B refuzata, anulare permisa';
END $t$;
RESET ROLE;
-- A new active owner without PV A must count; deleting that owner logically must restore A.
DO $t$
DECLARE d uuid;
BEGIN
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate)
    VALUES(current_setting('r29f.p')::uuid,'FICTIV PATRU','FICTIV PATRU','proprietar') RETURNING id INTO d;
  PERFORM set_config('r29f.d4',d::text,true);
END $t$;
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=current_setting('r29f.p')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'TEST6 FAIL activ ignorat'; END IF;
END $t$;
RESET ROLE;
UPDATE public.red_detinatori SET sters_la=now(),sters_motiv='Fixture' WHERE id=current_setting('r29f.d4')::uuid;
SET LOCAL ROLE authenticated;
DO $t$
DECLARE pv public.red_procese_verbale;
BEGIN
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=current_setting('r29f.p')::uuid) IS DISTINCT FROM 'A' THEN RAISE EXCEPTION 'TEST6 FAIL sters numarat'; END IF;
  IF public.fn_red_pv_c_neacoperite(current_setting('r29f.u')::uuid,7) IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'TEST6 FAIL neacoperite'; END IF;
  pv:=public.fn_red_pv_c_creeaza(current_setting('r29f.pr')::uuid,7);
  IF pv.tip IS DISTINCT FROM 'C' OR pv.tronson IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'TEST6 FAIL creare legitima'; END IF;
  RAISE NOTICE 'TEST6 OK';
END $t$;
RESET ROLE;