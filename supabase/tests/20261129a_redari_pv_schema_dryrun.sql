-- Runner-ul executa migrarea si DRY in aceeasi tranzactie de proba, apoi o anuleaza.
CREATE FUNCTION pg_temp.r29_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role',p_rol)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r29_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29.'||p,true),''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29_ca(uuid,text),pg_temp.r29_refuza(text,text),pg_temp.r29_g(text) TO authenticated;

-- TEST0: identitati reale, fara acordare de drepturi.
DO $t$
DECLARE o uuid; e uuid; v uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129a_redari_pv_schema:' || txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL garda'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261129120000') THEN RAISE EXCEPTION 'TEST0 FAIL migrare deja comisa'; END IF;
  END IF;
  SELECT id INTO o FROM public.profiles WHERE is_owner AND email='razvan.trusu@gazpet.ro';
  SELECT u.profile_id INTO e FROM public.user_module_access u JOIN public.profiles p ON p.id=u.profile_id WHERE u.module='redari' AND u.access_level='editor' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  SELECT u.profile_id INTO v FROM public.user_module_access u JOIN public.profiles p ON p.id=u.profile_id WHERE u.module='redari' AND u.access_level='viewer' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  IF o IS NULL OR e IS NULL OR v IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL identitati lipsa'; END IF;
  PERFORM set_config('r29.owner',o::text,true); PERFORM set_config('r29.editor',e::text,true); PERFORM set_config('r29.viewer',v::text,true);
  RAISE NOTICE 'TEST0 OK';
END $t$;
SELECT pg_temp.r29_ca(pg_temp.r29_g('owner')::uuid,'authenticated');
DO $t$
DECLARE pr uuid; u uuid; p uuid; d uuid; a uuid; b uuid; x text;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'TEST1 FAIL admin'; END IF;
  INSERT INTO public.red_proiecte(cod,denumire) VALUES ('TEST-29A','Proiect fictiv 29A') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES (pr,'UAT fictiv 29A','TST','Test') RETURNING id INTO u;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES (pr,u,'T3-TST-0001',3) RETURNING id INTO p;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate,act_doveditor_cunoscut) VALUES (p,'TEST DETINATOR','TEST DETINATOR','proprietar',false) RETURNING id INTO d;
  INSERT INTO public.red_procese_verbale(parcela_id,detinator_id,uat_id,tip,nr_pv,lucrari,stare_teren,constatare_mod,foto_nr)
    VALUES (p,d,u,'A','PVA-TST-9001','{"nivelare":true}','{"nivelat":true}','teren',2) RETURNING id INTO a;
  IF pg_temp.r29_refuza(format('UPDATE public.red_procese_verbale SET motiv_pv_b=''refuz'' WHERE id=%L',a),'23514') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST1 FAIL motiv pe A'; END IF;
  INSERT INTO public.red_procese_verbale(parcela_id,uat_id,tip,nr_pv,motiv_pv_b) VALUES (p,u,'B','PVB-TST-9001','refuz') RETURNING id INTO b;
  FOREACH x IN ARRAY ARRAY['foto_nr=-1','lucrari=''[]''::jsonb','stare_teren=''[]''::jsonb','constatare_mod=''x''','motiv_pv_b=''x'''] LOOP
    IF pg_temp.r29_refuza(format('UPDATE public.red_procese_verbale SET %s WHERE id=%L',x,b),'23514') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST1 FAIL CHECK %',x; END IF;
  END LOOP;
  UPDATE public.red_procese_verbale SET alte_observatii='Nota fictiva 29A' WHERE id=a;
  PERFORM set_config('r29.uat',u::text,true); PERFORM set_config('r29.parcela',p::text,true); PERFORM set_config('r29.detinator',d::text,true); PERFORM set_config('r29.pv',a::text,true);
  RAISE NOTICE 'TEST1 OK';
END $t$;

SELECT pg_temp.r29_ca(pg_temp.r29_g('editor')::uuid,'authenticated');
DO $t$
DECLARE n int;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'editor' THEN RAISE EXCEPTION 'TEST2 FAIL editor'; END IF;
  UPDATE public.red_parcele SET verificare_data=DATE '2026-11-02',verificare_de_gazpet='TEST GP',verificare_de_tgz='TEST TGZ',jurnal_santier_ref='TEST JS' WHERE id=pg_temp.r29_g('parcela')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'TEST2 FAIL editor update %',n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_v_parcele WHERE id=pg_temp.r29_g('parcela')::uuid AND verificare_data=DATE '2026-11-02' AND verificare_de_gazpet='TEST GP' AND verificare_de_tgz='TEST TGZ' AND jurnal_santier_ref='TEST JS') THEN RAISE EXCEPTION 'TEST2 FAIL vedere editor'; END IF;
  IF pg_temp.r29_refuza('SELECT valoare_lei FROM public.red_parcele','42501') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST2 FAIL valoare expusa'; END IF;
END $t$;
SELECT pg_temp.r29_ca(pg_temp.r29_g('viewer')::uuid,'authenticated');
DO $t$
DECLARE n int;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'viewer' THEN RAISE EXCEPTION 'TEST2 FAIL viewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_v_parcele WHERE id=pg_temp.r29_g('parcela')::uuid AND verificare_data=DATE '2026-11-02') THEN RAISE EXCEPTION 'TEST2 FAIL vedere viewer'; END IF;
  UPDATE public.red_parcele SET verificare_data=NULL WHERE id=pg_temp.r29_g('parcela')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'TEST2 FAIL viewer scrie'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;
SELECT pg_temp.r29_ca(pg_temp.r29_g('owner')::uuid,'authenticated');
DO $t$
DECLARE c uuid; d uuid := pg_temp.r29_g('detinator')::uuid;
BEGIN
  INSERT INTO public.red_convocari(detinator_id,canal,reluare,adresa_tgz_nr) VALUES (d,'posta',true,'TEST-TGZ-29A') RETURNING id INTO c;
  IF pg_temp.r29_refuza(format('INSERT INTO public.red_convocari(detinator_id,canal,reluare) VALUES (%L,''email'',true)',d),'23505') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3 FAIL doua reluari'; END IF;
  UPDATE public.red_convocari SET stare='anulat',motiv_anulare='Test fictiv' WHERE id=c;
  INSERT INTO public.red_convocari(detinator_id,canal,reluare) VALUES (d,'posta',true);
  INSERT INTO public.red_convocari(detinator_id,canal) VALUES (d,'posta'),(d,'email');
  RAISE NOTICE 'TEST3 OK';
END $t$;
DO $t$
DECLARE absent uuid;
BEGIN
  -- Alegere determinista a unui UUID absent, nu presupunere despre un UUID fix.
  SELECT md5('redari-test29a-'||i)::uuid INTO absent FROM generate_series(1,1000) i WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=md5('redari-test29a-'||i)::uuid) LIMIT 1;
  IF absent IS NULL THEN RAISE EXCEPTION 'TEST4 FAIL fixture FK'; END IF;
  UPDATE public.red_uat SET responsabil_id=pg_temp.r29_g('owner')::uuid WHERE id=pg_temp.r29_g('uat')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.red_uat WHERE id=pg_temp.r29_g('uat')::uuid AND responsabil_id=pg_temp.r29_g('owner')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL profil existent'; END IF;
  IF pg_temp.r29_refuza(format('UPDATE public.red_uat SET responsabil_id=%L WHERE id=%L',absent,pg_temp.r29_g('uat')),'23503') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST4 FAIL FK'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela='red_procese_verbale' AND inregistrare_id=pg_temp.r29_g('pv')::uuid AND actiune='update' AND date_noi->>'alte_observatii'='Nota fictiva 29A') THEN RAISE EXCEPTION 'TEST5 FAIL jurnal'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;
SELECT pg_temp.r29_ca(NULL,'postgres');
