-- Piesa A: contractul catalogului și mutațiile care trebuie să înroșească poarta.
-- Exclusiv scheletul local; fiecare mutație este anulată prin SAVEPOINT.
DO $test$
DECLARE r record; t text; p text;
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'poarta E3b nu este verde'; END IF;
  FOR r IN SELECT n FROM unnest(ARRAY['izo_cor_editor','izo_corectie_writer']) n LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.n AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.n::regrole AND (member<>'postgres'::regrole OR inherit_option))
      OR NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.n::regrole AND member='postgres'::regrole AND set_option)
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.n::regrole) THEN
      RAISE EXCEPTION 'atribute/membership %',r.n;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['izo_corectii','izo_corectii_bucati','izo_documente_istoric'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS %',t; END IF;
    IF NOT has_table_privilege('authenticated','public.'||t,'SELECT') THEN RAISE EXCEPTION 'citire API %',t; END IF;
    FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) rol(n)
        WHERE a.attrelid=('public.'||t)::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(rol.n,a.attrelid,a.attname,p)) THEN
        RAISE EXCEPTION 'API scrie % %',t,p;
      END IF;
    END LOOP;
  END LOOP;
  -- Matricea critică verificată independent de generatorul GRANT-urilor.
  FOR r IN SELECT a.attname::text AS n FROM pg_attribute a
      WHERE a.attrelid='public.magazie_bucati'::regclass AND a.attnum>0 AND NOT a.attisdropped LOOP
    IF has_column_privilege('izo_cor_editor','public.magazie_bucati',r.n,'UPDATE')
      OR has_column_privilege('izo_cor_editor','public.magazie_bucati',r.n,'INSERT') THEN RAISE EXCEPTION 'editor scrie registrul %',r.n; END IF;
    IF has_column_privilege('izo_corectie_writer','public.magazie_bucati',r.n,'UPDATE') IS DISTINCT FROM
      (r.n=ANY(ARRAY['serie','sarja','lot','lungime_aviz_mm','lungime_masurata_mm','unghi_curba','perete_mm',
       'diametru_mm','greutate_kg','dimensiune','grad_otel','standard','izolatie','lungime_mm','lungime_m',
       'lungime_originala_m','stare','depozit_id','server_ver','updated_at'])) THEN RAISE EXCEPTION 'UPDATE writer %',r.n; END IF;
    IF has_column_privilege('izo_corectie_writer','public.magazie_bucati',r.n,'INSERT') IS DISTINCT FROM
       (r.n=ANY(public.fn_izo_coloane_c()||ARRAY['id','uid','radacina_id','server_ver'])) THEN RAISE EXCEPTION 'INSERT writer %',r.n; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('izo_cor_editor','izo_corectii','inainte','INSERT',true),
    ('izo_cor_editor','izo_corectii','inainte','UPDATE',false),
    ('izo_cor_editor','izo_corectii','dupa','UPDATE',false),
    ('izo_cor_editor','izo_corectii','motiv_decizie','UPDATE',true),
    ('izo_cor_editor','izo_corectii','eveniment_id','UPDATE',false),
    ('izo_corectie_writer','izo_corectii','eveniment_id','UPDATE',true),
    ('izo_corectie_writer','izo_corectii','motiv_decizie','UPDATE',false),
    ('izo_corectie_writer','izo_corectii','dupa','UPDATE',false),
    ('izo_doc_editor','izo_documente_istoric','continut','INSERT',true),
    ('izo_doc_editor','izo_documente_istoric','id','INSERT',false),
    ('izo_doc_editor','izo_documente_istoric','continut','UPDATE',false),
    ('izo_corectie_writer','izo_documente_intrare','pv_nr','UPDATE',true),
    ('izo_corectie_writer','izo_documente_intrare','stare','UPDATE',false),
    ('izo_cor_editor','izo_documente_intrare','pv_nr','UPDATE',false)) x(rol,tabel,col,priv,asteptat) LOOP
    IF has_column_privilege(r.rol,'public.'||r.tabel,r.col,r.priv) IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION 'matrice % % % %',r.rol,r.tabel,r.col,r.priv;
    END IF;
  END LOOP;
  FOR r IN SELECT n FROM unnest(ARRAY['izo_cor_editor','izo_corectie_writer']) n LOOP
    FOREACH t IN ARRAY ARRAY['fn_izo_jwt_rol()','fn_izo_uid()','fn_izo_porti_lipsa()'] LOOP
      IF NOT has_function_privilege(r.n,'public.'||t,'EXECUTE') THEN RAISE EXCEPTION 'identitate tranzitivă % %',r.n,t; END IF;
    END LOOP;
    IF has_function_privilege(r.n,'public.fn_izo_doc_api_verifica()','EXECUTE') THEN RAISE EXCEPTION 'GRANT interzis pe helper E3 %',r.n; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('fn_izo_porti_e3b_definitii','fn_izo_porti_e3b_lipsa',
        'fn_izo_coloane_corectabile','fn_izo_coloane_identitate') AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC EXECUTE';
  END IF;
  IF public.fn_izo_coloane_corectabile('teava') @> ARRAY['unghi_curba']
     OR NOT public.fn_izo_coloane_corectabile('curba') @> ARRAY['unghi_curba']
     OR public.fn_izo_coloane_corectabile('curba') @> ARRAY['lungime_aviz_mm']
     OR public.fn_izo_coloane_corectabile('teava') && ARRAY['lungime_mm','stare','depozit_id','atribute'] THEN
    RAISE EXCEPTION 'lista L nu respectă tipul / include derivate';
  END IF;
  RAISE NOTICE 'OK E3b catalog';
END $test$;

BEGIN;
SAVEPOINT baza;
GRANT UPDATE (atribute) ON public.magazie_bucati TO izo_corectie_writer;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă UPDATE(atribute)'; END IF; END $t$;
ROLLBACK TO baza;
ALTER ROLE izo_cor_editor BYPASSRLS;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă BYPASSRLS'; END IF; END $t$;
ROLLBACK TO baza;
ALTER TABLE public.izo_corectii DISABLE ROW LEVEL SECURITY;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă DISABLE RLS'; END IF; END $t$;
ROLLBACK TO baza;
DROP INDEX public.ux_magbuc_ev_corectie;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă index lipsă'; END IF; END $t$;
ROLLBACK TO baza;
REVOKE EXECUTE ON FUNCTION public.fn_izo_jwt_rol() FROM izo_cor_editor;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă identitate tranzitivă lipsă'; END IF; END $t$;
ROLLBACK TO baza;
GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_identitate() TO PUBLIC;
DO $t$ BEGIN IF public.fn_izo_porti_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă PUBLIC EXECUTE'; END IF; END $t$;
ROLLBACK;
DO $t$ BEGIN
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'mutațiile au lăsat efecte'; END IF;
  RAISE NOTICE 'TESTE E3b-A: TOATE OK';
END $t$;

-- Piesa B: fixture locală anulată integral. Nu cere niciun RPC al piesei C.
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
INSERT INTO public.izo_proiect_config(proiect_id,nivel_izo,server_ver) VALUES (3,'stoc',nextval('public.izo_server_ver_seq'));
DO $fixture$
DECLARE v_id bigint := nextval('public.magazie_bucati_id_seq');
BEGIN
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,
    serie,sarja,perete_mm,lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,
    provenienta,stare,locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E3B-B-FIXTURE','SARJA-B',8,
    12000,12000,12,12,'AB','A','B','beneficiar','receptionat','depozit',6,11,'manual');
  PERFORM set_config('test.e3b_bucata',v_id::text,true);
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);

DO $b_catalog$
DECLARE v_fn record; v_g record;
BEGIN
  FOR v_fn IN SELECT pr.*,pg_get_userbyid(pr.proowner) AS owner_name FROM pg_proc pr
    WHERE pr.pronamespace='public'::regnamespace AND (pr.proname LIKE 'fn\_izo\_cor\_%' OR pr.proname='fn_izo_garda_corectie')
      AND pr.proname NOT IN ('fn_izo_cor_propune','fn_izo_cor_retrage','fn_izo_cor_respinge','fn_izo_cor_verifica','fn_izo_cor_aproba','fn_izo_cor_camp','fn_izo_cor_pv','fn_izo_cor_storno_import') LOOP
    IF v_fn.owner_name IS DISTINCT FROM (CASE WHEN v_fn.proname='fn_izo_cor_marcheaza' THEN 'izo_corectie_writer' ELSE 'postgres' END)
      OR v_fn.prosecdef IS DISTINCT FROM (v_fn.proname IN ('fn_izo_cor_autorizare_lock','fn_izo_cor_cerut_de_valid',
        'fn_izo_cor_bucata_lock','fn_izo_cor_doc_lock','fn_izo_cor_deschise'))
      OR v_fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION 'B owner / mod / search_path %',v_fn.proname; END IF;
    IF has_function_privilege('authenticated',v_fn.oid,'EXECUTE') OR has_function_privilege('anon',v_fn.oid,'EXECUTE')
      OR has_function_privilege('service_role',v_fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'B helper expus %',v_fn.proname; END IF;
  END LOOP;
  IF NOT has_function_privilege('izo_corectie_writer','public.fn_izo_garda_corectie(text,text,jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('izo_cor_editor','public.fn_izo_garda_corectie(text,text,jsonb,jsonb)','EXECUTE')
    OR NOT has_function_privilege('izo_cor_editor','public.fn_izo_cor_bucata_lock(bigint,bigint)','EXECUTE')
    OR has_function_privilege('izo_corectie_writer','public.fn_izo_cor_bucata_lock(bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'B ACL helper gărzi / lock'; END IF;
  IF (SELECT count(*) FROM pg_trigger g WHERE g.tgrelid IN ('public.izo_corectii'::regclass,'public.izo_corectii_bucati'::regclass)
    AND NOT g.tgisinternal AND g.tgenabled='A') <> 4 THEN RAISE EXCEPTION 'B patru trigger-e ALWAYS'; END IF;
  FOR v_g IN SELECT * FROM (VALUES ('izo_corectii'),('izo_corectii_bucati')) x(tabel) LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER trg_izo_cor_garda',v_g.tabel);
    IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'B gate acceptă trigger dezactivat'; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER trg_izo_cor_garda',v_g.tabel);
  END LOOP;
END $b_catalog$;

DO $b_helper$
DECLARE v_rol text; v_id bigint := current_setting('test.e3b_bucata')::bigint;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['izo_cor_editor','izo_corectie_writer'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',v_rol);
    IF NOT public.fn_izo_cor_autorizare_lock(3,'responsabil',NULL)
      OR public.fn_izo_cor_autorizare_lock(3,'rol_inventat',NULL) THEN RAISE EXCEPTION 'B autorizare owner / rol invalid'; END IF;
    BEGIN
      PERFORM public.fn_izo_cor_api_verifica();
      RAISE EXCEPTION 'B JWT fals din sesiunea postgres a trecut';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      IF position('doar API authenticated' IN SQLERRM)=0 THEN RAISE; END IF;
    END;
    RESET ROLE;
  END LOOP;
  SET LOCAL ROLE izo_cor_editor;
  IF (public.fn_izo_cor_bucata_lock(v_id,3)->>'id')::bigint IS DISTINCT FROM v_id
    OR public.fn_izo_cor_bucata_lock(v_id,2) IS NOT NULL OR public.fn_izo_cor_doc_lock(-1,3) THEN
    RAISE EXCEPTION 'B helper lock scapă proiectul / documentul absent'; END IF;
  RESET ROLE;
  SET LOCAL ROLE izo_corectie_writer;
  IF NOT public.fn_izo_cor_cerut_de_valid(3,'00000000-0000-0000-0000-000000000121')
    OR public.fn_izo_cor_cerut_de_valid(3,'00000000-0000-0000-0000-0000000000f0') THEN
    RAISE EXCEPTION 'B eligibilitate declarant'; END IF;
  RESET ROLE;
END $b_helper$;

DO $b_refuzuri$
DECLARE v_rol text; v_rows bigint; v_id bigint := current_setting('test.e3b_bucata')::bigint;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['postgres','izo_cor_editor','izo_corectie_writer','authenticated','anon','service_role'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I',v_rol);
      -- Forma deliberat falsă trebuie refuzată de trigger (writeri/postgres) ori ACL (API).
      INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,cale,propus_de)
        VALUES(3,'camp',v_id,'{}','{"perete_mm":9}','test refuz','direct','00000000-0000-0000-0000-000000000121');
      RAISE EXCEPTION 'B INSERT a trecut ca %',v_rol;
    EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' THEN NULL;
    END;
    RESET ROLE;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I',v_rol);
      UPDATE public.magazie_bucati SET perete_mm=9 WHERE id=v_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF NOT (v_rows=0 AND v_rol IN ('authenticated','anon','service_role')) THEN
        RAISE EXCEPTION 'B UPDATE registru fără context a trecut ca %',v_rol; END IF;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SET LOCAL ROLE izo_corectie_writer;
  PERFORM set_config('izo.corectie_ctx','camp|1|3|1|',true); -- fără txid
  BEGIN
    UPDATE public.magazie_bucati SET perete_mm=9 WHERE id=v_id;
    RAISE EXCEPTION 'B context fără txid acceptat';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF position('context absent / fals' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  PERFORM set_config('izo.corectie_ctx',(txid_current()-1)::text||'|camp|1|3|1|',true);
  BEGIN
    INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,server_ver) VALUES('corectie',3,1);
    RAISE EXCEPTION 'B context din altă tranzacție acceptat';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF position('context absent / fals' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  PERFORM set_config('izo.corectie_ctx','',true);
  RESET ROLE;
END $b_refuzuri$;

DO $b_whitelist$
DECLARE v_id bigint := current_setting('test.e3b_bucata')::bigint; v_d jsonb; v_rol text; v_cor bigint;
  v_before jsonb; v_after jsonb; v_cale text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['izo_corectie_writer','izo_cor_editor'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',v_rol);
    FOR v_d IN SELECT val FROM (VALUES ('{"atribute":{}}'::jsonb),('{"lungime_mm":1000}'::jsonb),
      ('{"serie":"NOUA","perete_mm":9}'::jsonb),('{"unghi_curba":45}'::jsonb)) dt(val) LOOP
      BEGIN
        INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
          VALUES(3,'camp',v_id,NULL,v_d,'lista albă','00000000-0000-0000-0000-000000000121');
        RAISE EXCEPTION 'B whitelist a acceptat % ca %',v_d,v_rol;
      EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    END LOOP;
    BEGIN
      INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
      VALUES(3,'camp',v_id,NULL,CASE v_rol WHEN 'izo_corectie_writer' THEN '{"serie":"NOUA"}'::jsonb
        ELSE '{"perete_mm":9}'::jsonb END,'cale incorectă','00000000-0000-0000-0000-000000000121');
      RAISE EXCEPTION 'B identitatea / restul au trecut pe calea greșită';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    RESET ROLE;
  END LOOP;
  SET LOCAL ROLE izo_corectie_writer;
  BEGIN
    INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
      VALUES(3,'camp',v_id,NULL,'{"perete_mm":"9.0"}','normalizare tipizată','00000000-0000-0000-0000-000000000121')
      RETURNING inainte,dupa,cale INTO v_before,v_after,v_cale;
    IF v_cale <> 'direct' OR v_before->'perete_mm' IS DISTINCT FROM '8'::jsonb OR v_before->>'server_ver' IS NULL
      OR v_after IS DISTINCT FROM '{"perete_mm":9}'::jsonb THEN RAISE EXCEPTION 'B normalizare camp direct'; END IF;
    RAISE EXCEPTION 'anulează doar fixture-ul direct' USING ERRCODE='ZB001';
  EXCEPTION WHEN SQLSTATE 'ZB001' THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE izo_cor_editor;
  INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
    VALUES(3,'camp',v_id,NULL,'{"serie":"E3B-NOUA"}','propunere identitate','00000000-0000-0000-0000-000000000121')
    RETURNING id,inainte,dupa,cale INTO v_cor,v_before,v_after,v_cale;
  IF v_cale <> 'propunere' OR v_before->>'serie' <> 'E3B-B-FIXTURE' OR v_before->>'server_ver' IS NULL
    OR v_after IS DISTINCT FROM '{"serie":"E3B-NOUA"}'::jsonb THEN RAISE EXCEPTION 'B recalcul INSERT'; END IF;
  PERFORM set_config('test.e3b_corectie',v_cor::text,true);
  BEGIN
    UPDATE public.izo_corectii SET stare='respinsa',versiune=versiune+1,decis_de='00000000-0000-0000-0000-000000000121',
      decis_rol=session_user,decis_la=now(),motiv_decizie='îmi resping singur' WHERE id=v_cor;
    RAISE EXCEPTION 'B patru ochi respingere owner a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF position('patru ochi' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  RESET ROLE;
  SET LOCAL ROLE izo_corectie_writer;
  -- Înainte de verificarea contextului: patru ochi trebuie refuzat chiar cu marcajul curent corect.
  PERFORM public.fn_izo_cor_marcheaza(v_cor);
  BEGIN
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de='00000000-0000-0000-0000-000000000121',
      decis_rol=session_user,decis_la=now(),eveniment_id=1 WHERE id=v_cor;
    RAISE EXCEPTION 'B patru ochi aprobare owner a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF position('patru ochi' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  PERFORM set_config('izo.corectie_ctx','',true);
  RESET ROLE;
  -- Alt om: respingerea este permisă; rândul închis nu mai poate fi modificat.
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
  SET LOCAL ROLE izo_cor_editor;
  UPDATE public.izo_corectii SET stare='respinsa',versiune=versiune+1,decis_de='00000000-0000-0000-0000-000000000030',
    decis_rol=session_user,decis_la=now(),motiv_decizie='refuz justificat' WHERE id=v_cor;
  BEGIN
    UPDATE public.izo_corectii SET versiune=versiune+1 WHERE id=v_cor;
    RAISE EXCEPTION 'B rând închis modificabil';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'TESTE E3b-B: TOATE OK';
END $b_whitelist$;
ROLLBACK;
DO $b_final$ BEGIN
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'B a lăsat poarta roșie'; END IF;
END $b_final$;

-- C1: API reală (session_user=authenticator), negative înaintea fluxurilor pozitive.
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
INSERT INTO public.izo_proiect_config(proiect_id,nivel_izo,server_ver) VALUES(3,'stoc',nextval('public.izo_server_ver_seq'));
DO $fixture$
DECLARE v_id bigint := nextval('public.magazie_bucati_id_seq');
BEGIN
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,
    lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,
    locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E3B-C1-FIXTURE','SARJA-C1',8,
    12000,12000,12,12,'AB','A','B','beneficiar','receptionat','depozit',6,11,'manual');
  PERFORM set_config('test.c1_bucata',v_id::text,true);
  v_id:=nextval('public.magazie_bucati_id_seq');
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,serie,sarja,perete_mm,
    lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,provenienta,stare,
    locatie_tip,locatie_site_id,tronson_id,sursa_receptie,atribute)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','C1-TRONSON','C1-S',8,
    12000,12000,12,12,'AB','A','B','beneficiar','pe_tronson','tronson',6,16,'manual','{"depozit_origine_id":11}');
  PERFORM set_config('test.c1_tronson',v_id::text,true);
END $fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
VALUES(3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture C1');

SET SESSION AUTHORIZATION authenticator;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SET LOCAL ROLE anon;
DO $neg$ BEGIN
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_propune('pierdut',3,current_setting('test.c1_bucata')::bigint,'{"cauza":"disparuta"}','test anon');
    RAISE EXCEPTION 'C1 anon a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $neg$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $neg$ BEGIN
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_propune('pierdut',3,current_setting('test.c1_bucata')::bigint,'{"cauza":"disparuta"}','test fără atribuire');
    RAISE EXCEPTION 'C1 fără atribuire a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'E3b: bucata nu există sau nu ai acces' THEN RAISE; END IF;
  END;
END $neg$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $neg$
DECLARE v_id bigint:=current_setting('test.c1_bucata')::bigint; v_r jsonb;
BEGIN
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_propune('carantina_intrare',3,v_id,'{"ncr_ref":"NCR1","stare":"carantina"}','test listă albă');
    RAISE EXCEPTION 'C1 cheie străină a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_propune('camp',3,v_id,'{"serie":"NOUA","perete_mm":9}','test mixt');
    RAISE EXCEPTION 'C1 camp mixt a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('carantina_intrare',3,v_id,'{"ncr_ref":"C1-NCR"}','test carantină C1');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
  IF v_r->>'stare'<>'propusa' OR v_r->>'versiune'<>'1' THEN RAISE EXCEPTION 'C1 propunere invalidă'; END IF;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_aproba((v_r->>'corectie_id')::bigint,1);
    RAISE EXCEPTION 'C1 aprobare proprie a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_respinge((v_r->>'corectie_id')::bigint,1,'respingere proprie');
    RAISE EXCEPTION 'C1 respingere proprie a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_retrage((v_r->>'corectie_id')::bigint,99,'versiune veche');
    RAISE EXCEPTION 'C1 retragere CAS a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
END $neg$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $neg$ BEGIN
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,99);
    RAISE EXCEPTION 'C1 aprobare CAS a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_respinge(current_setting('test.c1_cor')::bigint,99,'versiune veche');
    RAISE EXCEPTION 'C1 respingere CAS a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_verifica(current_setting('test.c1_cor')::bigint,'camp',3,NULL,'{}');
    RAISE EXCEPTION 'C1 verificare mixtă a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $neg$;

-- Patru ochi se aplică inclusiv owner-ului, independent de autorizarea gestionarului.
DO $owner_neg$
DECLARE v_r jsonb; v_id bigint;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('gasit_nou',3,NULL,'{"tip_cod":"curba","depozit_id":11,"serie":"C1-OWNER","sarja":"C1-S","perete_mm":8,"unghi_curba":45}','test patru ochi owner');
  v_id:=(v_r->>'corectie_id')::bigint;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_aproba(v_id,1);
    RAISE EXCEPTION 'C1 owner aprobare proprie a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
    PERFORM public.fn_izo_cor_respinge(v_id,1,'test patru ochi');
    RAISE EXCEPTION 'C1 owner respingere proprie a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  PERFORM public.fn_izo_cor_retrage(v_id,1,'închidere test owner');
END $owner_neg$;

DO $poz$
DECLARE v_id bigint:=current_setting('test.c1_bucata')::bigint; v_cor bigint:=current_setting('test.c1_cor')::bigint;
  v_r jsonb; v_retry jsonb; v_ev bigint;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_verifica(v_cor,NULL,NULL,NULL,NULL);
  IF v_r->>'ok'<>'true' OR v_r->>'versiune'<>'1' OR v_r->'dupa_efectiv'<> '{"stare":"carantina"}'::jsonb THEN
    RAISE EXCEPTION 'C1 verificare propunere: %',v_r; END IF;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(v_cor,1); v_ev:=(v_r->>'eveniment_id')::bigint;
  IF (SELECT b.stare FROM public.magazie_bucati b WHERE b.id=v_id)<>'carantina'
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente ev WHERE ev.id=v_ev AND ev.tip='carantina_intrare' AND ev.document_id=v_cor::text)
    OR (SELECT count(*) FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev AND mis.bucata_id=v_id AND mis.rol='stare'
      AND mis.stare_inainte='receptionat' AND mis.stare_dupa='carantina')<>1 THEN RAISE EXCEPTION 'C1 carantină incompletă'; END IF;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_retry:=public.fn_izo_cor_aproba(v_cor,1);
  IF v_retry->>'idempotent'<>'true' OR v_retry->>'eveniment_id' IS DISTINCT FROM v_r->>'eveniment_id'
    OR (SELECT count(*) FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev)<>1 THEN RAISE EXCEPTION 'C1 retry duplică'; END IF;
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $poz$
DECLARE v_r jsonb;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('carantina_iesire',3,current_setting('test.c1_bucata')::bigint,'{"ncr_ref":"C1-INCHIS"}','închidere NCR');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $poz$
DECLARE v_r jsonb;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  IF v_r->>'stare_dupa'<>'receptionat' OR (SELECT stare FROM public.magazie_bucati WHERE id=current_setting('test.c1_bucata')::bigint)<>'receptionat' THEN
    RAISE EXCEPTION 'C1 ieșire nu restaurează episodul'; END IF;
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('pierdut',3,current_setting('test.c1_bucata')::bigint,'{"cauza":"disparuta"}','lipsă fizică');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  IF v_r->>'stare_dupa'<>'pierduta' THEN RAISE EXCEPTION 'C1 pierdut'; END IF;
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('gasit_recuperare',3,current_setting('test.c1_bucata')::bigint,'{}','găsită în depozit');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  IF v_r->>'stare_dupa'<>'receptionat' OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE id=(v_r->>'eveniment_id')::bigint AND tip='gasit') THEN
    RAISE EXCEPTION 'C1 recuperare'; END IF;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_verifica(NULL,'camp',3,current_setting('test.c1_bucata')::bigint,'{"lungime_masurata_mm":11900}');
  IF v_r->>'ok'<>'true' OR (v_r->'dupa_efectiv'->>'lungime_mm')::integer<>11900 THEN RAISE EXCEPTION 'C1 verifica nesalvat: %',v_r; END IF;
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('gasit_nou',3,NULL,'{"tip_cod":"teava","depozit_id":11,"serie":"C1-GASIT","sarja":"C1-S","perete_mm":8,"lungime_aviz_mm":12000}','găsit la inventar');
  IF v_r->'inainte'<>'{}'::jsonb THEN RAISE EXCEPTION 'C1 gasit inainte'; END IF;
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $poz$
DECLARE v_r jsonb; v_b public.magazie_bucati;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  SELECT * INTO v_b FROM public.magazie_bucati WHERE id=(v_r->>'bucata_id')::bigint;
  IF v_b.stare<>'carantina' OR v_b.sursa_receptie<>'manual' OR v_b.atribute->>'sursa'<>'e3b'
    OR v_b.atribute->>'corectie_id'<>current_setting('test.c1_cor') OR v_b.aviz_intrare_id IS NOT NULL OR v_b.server_ver IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari WHERE eveniment_id=(v_r->>'eveniment_id')::bigint AND bucata_id=v_b.id AND rol='nascut') THEN
    RAISE EXCEPTION 'C1 naștere invalidă'; END IF;
END $poz$;
-- Decizii fără registru: retragere proprie și respingere de alt responsabil.
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('camp',3,current_setting('test.c1_bucata')::bigint,'{"lot":"C1-LOT"}','corecție lot');
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_retrage((v_r->>'corectie_id')::bigint,1,'document clarificat');
  IF v_r->>'stare'<>'retrasa' OR v_r->>'versiune'<>'2' THEN RAISE EXCEPTION 'C1 retragere'; END IF;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('camp',3,current_setting('test.c1_bucata')::bigint,'{"lot":"C1-LOT"}','corecție lot');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $poz$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $poz$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_respinge(current_setting('test.c1_cor')::bigint,1,'dovadă insuficientă');
  IF v_r->>'stare'<>'respinsa' OR v_r->>'versiune'<>'2' OR EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id=current_setting('test.c1_cor')) THEN
    RAISE EXCEPTION 'C1 respingere a scris registrul'; END IF;
END $poz$;
-- Q9=A: gestionar de origine, recuperare pe același tronson.
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $tronson$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('pierdut',3,current_setting('test.c1_tronson')::bigint,'{"cauza":"disparuta"}','lipsă pe tronson');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $tronson$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
SELECT set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
SELECT public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $tronson$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('gasit_recuperare',3,current_setting('test.c1_tronson')::bigint,'{}','găsită pe tronson');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $tronson$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $tronson$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  IF v_r->>'stare_dupa'<>'pe_tronson' OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati WHERE id=current_setting('test.c1_tronson')::bigint AND tronson_id=16 AND depozit_id IS NULL) THEN
    RAISE EXCEPTION 'C1 recuperarea a mutat tronsonul'; END IF;
END $tronson$;
-- Aprobare camp: derivatele se aplică împreună, cu o singură mișcare corectat.
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $camp$
DECLARE v_r jsonb;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_propune('camp',3,current_setting('test.c1_bucata')::bigint,'{"serie":"C1-SERIE-NOUA","lungime_masurata_mm":11900}','serie și măsurătoare corectate');
  PERFORM set_config('test.c1_cor',v_r->>'corectie_id',true);
END $camp$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
DO $camp$
DECLARE v_r jsonb; v_b public.magazie_bucati;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  SELECT * INTO v_b FROM public.magazie_bucati WHERE id=current_setting('test.c1_bucata')::bigint;
  IF v_b.serie<>'C1-SERIE-NOUA' OR v_b.lungime_mm<>11900 OR v_b.lungime_m<>11.9 OR v_b.lungime_originala_m<>11.9
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari WHERE eveniment_id=(v_r->>'eveniment_id')::bigint AND rol='corectat'
      AND dupa->>'lungime_mm'='11900') THEN RAISE EXCEPTION 'C1 camp nu a aplicat delta și derivatele'; END IF;
  PERFORM set_config('izo.corectie_ctx','',true);  -- tranzacție nouă simulată (PostgREST: un RPC = o tranzacție)
  v_r:=public.fn_izo_cor_aproba(current_setting('test.c1_cor')::bigint,1);
  IF v_r->>'idempotent'<>'true' THEN RAISE EXCEPTION 'C1 camp retry'; END IF;
END $camp$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK;

-- C2: fluxul real E3 pregateste documentele; toate fixture-urile dispar la ROLLBACK.
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
INSERT INTO public.izo_proiect_config(proiect_id,nivel_izo,server_ver)
  VALUES(3,'stoc',nextval('public.izo_server_ver_seq'));
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv) VALUES
  (3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture C2'),
  (3,'00000000-0000-0000-0000-000000000117','manager_aprobator',NULL,'test','fixture C2');
INSERT INTO public.user_module_access(profile_id,module,access_level)
  VALUES('00000000-0000-0000-0000-000000000117','magazie','editor');
SET SESSION AUTHORIZATION authenticator;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $c2_fixture$
DECLARE v_r jsonb; v_ver jsonb; v_doc bigint;
BEGIN
  v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
    '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"C2 Furnizor","nr_document":"C2 CONF","data_document":"2026-10-22","total_m":12}',
    '[{"nr_crt":1,"serie":"C2-TEAVA","sarja":"C2-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
  v_doc:=(v_r->>'document_id')::bigint;
  PERFORM set_config('test.c2_doc',v_doc::text,true);
  v_ver:=public.fn_izo_doc_verifica(v_doc);
  v_r:=public.fn_izo_doc_confirma(v_doc,(v_ver->>'versiune')::bigint,v_ver->>'hash');
  PERFORM set_config('test.c2_bucata',v_r->'bucati'->>0,true);
  PERFORM set_config('izo.receptie_ctx','',true); -- tranzactie E3 noua simulata
  v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
    '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"C2 Furnizor","nr_document":"C2 DRAFT","data_document":"2026-10-22"}',
    '[]',NULL);
  PERFORM set_config('test.c2_draft',v_r->>'document_id',true);
END $c2_fixture$;

-- Gestionarul are acces de citire, dar nu drept de corectie directa, nici la PV.
DO $c2_neg_gestionar$
DECLARE v_id bigint:=current_setting('test.c2_bucata')::bigint; v_sv bigint;
BEGIN
  SELECT b.server_ver INTO v_sv FROM public.magazie_bucati b WHERE b.id=v_id;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_camp(v_id,v_sv,'{"perete_mm":9}','test gestionar');
    RAISE EXCEPTION 'C2 gestionar camp a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_pv(current_setting('test.c2_doc')::bigint,2,'C2-PV','2026-10-22','test gestionar');
    RAISE EXCEPTION 'C2 gestionar PV a trecut';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $c2_neg_gestionar$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $c2_neg$
DECLARE v_id bigint:=current_setting('test.c2_bucata')::bigint; v_sv bigint; v_delta jsonb;
BEGIN
  SELECT b.server_ver INTO v_sv FROM public.magazie_bucati b WHERE b.id=v_id;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_camp(v_id,v_sv,'{"serie":"C2-IDENT"}','test identitate');
    RAISE EXCEPTION 'C2 identitate directa a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%trimite prin propunere%' THEN RAISE; END IF;
  END;
  FOREACH v_delta IN ARRAY ARRAY['{"observatii":"interzis"}'::jsonb,'{"lungime_mm":11000}'::jsonb,
      '{"stare":"carantina"}'::jsonb,'{}'::jsonb,'{"perete_mm":8}'::jsonb,'{"perete_mm":-1}'::jsonb] LOOP
    BEGIN
      PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
      PERFORM public.fn_izo_cor_camp(v_id,v_sv,v_delta,'test lista sau valoare');
      RAISE EXCEPTION 'C2 cerere camp invalida a trecut: %',v_delta;
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_camp(v_id,-1,'{"perete_mm":9}','test CAS');
    RAISE EXCEPTION 'C2 server_ver vechi a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_pv(current_setting('test.c2_draft')::bigint,1,'C2-PV','2026-10-22','test draft');
    RAISE EXCEPTION 'C2 PV draft a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_pv(current_setting('test.c2_doc')::bigint,2,'C2-PV','2026-10-22','test fara PV');
    RAISE EXCEPTION 'C2 confirmat fara PV a trecut';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.bucata_id=v_id OR cor.document_intrare_id=current_setting('test.c2_doc')::bigint) THEN
    RAISE EXCEPTION 'C2 refuzurile au lasat corectii'; END IF;
END $c2_neg$;

-- Punerea initiala a PV-ului apartine E3, gestionarului.
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SELECT set_config('izo.receptie_ctx','',true);
SELECT public.fn_izo_doc_pv(current_setting('test.c2_doc')::bigint,2,'C2 INITIAL','2026-10-21');
SELECT set_config('izo.receptie_ctx','',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $c2_neg_pv$
DECLARE v_doc bigint:=current_setting('test.c2_doc')::bigint; v_delta text;
BEGIN
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_pv(v_doc,2,'C2 NOU','2026-10-22','test versiune veche');
    RAISE EXCEPTION 'C2 versiune PV veche a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  FOREACH v_delta IN ARRAY ARRAY['','PV|INVALID','C2 INITIAL',' c2   initial '] LOOP
    BEGIN
      PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
      PERFORM public.fn_izo_cor_pv(v_doc,3,v_delta,'2026-10-21','test PV invalid sau egal');
      RAISE EXCEPTION 'C2 PV invalid a trecut';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
END $c2_neg_pv$;

-- O propunere deschisa blocheaza corectia directa pana la retragere.
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $c2_propunere$ DECLARE v_r jsonb; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
  v_r:=public.fn_izo_cor_propune('camp',3,current_setting('test.c2_bucata')::bigint,'{"lot":"C2 LOT"}','fixture propunere deschisa');
  PERFORM set_config('test.c2_prop',v_r->>'corectie_id',true);
END $c2_propunere$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $c2_neg_deschisa$
DECLARE v_id bigint:=current_setting('test.c2_bucata')::bigint; v_sv bigint;
BEGIN
  SELECT b.server_ver INTO v_sv FROM public.magazie_bucati b WHERE b.id=v_id;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_camp(v_id,v_sv,'{"perete_mm":9}','test propunere deschisa');
    RAISE EXCEPTION 'C2 propunere deschisa ignorata';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    IF SQLERRM NOT LIKE '%propunere deschisa%' THEN RAISE; END IF;
  END;
  IF (SELECT b.server_ver FROM public.magazie_bucati b WHERE b.id=v_id) IS DISTINCT FROM v_sv
    OR EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.bucata_id=v_id AND cor.cale='direct') THEN
    RAISE EXCEPTION 'C2 blocarea prin propunere a lasat efecte'; END IF;
END $c2_neg_deschisa$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $c2_retrage$ BEGIN
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
  PERFORM public.fn_izo_cor_retrage(current_setting('test.c2_prop')::bigint,1,'inchidere fixture C2');
END $c2_retrage$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);

-- Responsabil non-owner: camp produce exact un eveniment si o miscare, apoi CAS opreste retry-ul vechi.
DO $c2_camp$
DECLARE v_id bigint:=current_setting('test.c2_bucata')::bigint; v_b public.magazie_bucati; v_sv bigint;
  v_r jsonb; v_doc_inainte jsonb; v_ev bigint;
BEGIN
  SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=v_id; v_sv:=v_b.server_ver;
  SELECT to_jsonb(doc) INTO v_doc_inainte FROM public.izo_documente_intrare doc WHERE doc.id=v_b.aviz_intrare_id;
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
  v_r:=public.fn_izo_cor_camp(v_id,v_sv,'{"perete_mm":"9.0"}','corectie perete C2');
  v_ev:=(v_r->>'eveniment_id')::bigint;
  IF (SELECT to_jsonb(b)-ARRAY['perete_mm','server_ver','updated_at'] FROM public.magazie_bucati b WHERE b.id=v_id)
       IS DISTINCT FROM to_jsonb(v_b)-ARRAY['perete_mm','server_ver','updated_at']
    OR (SELECT b.perete_mm FROM public.magazie_bucati b WHERE b.id=v_id)<>9
    OR (v_r->>'server_ver')::bigint<=v_sv
    OR (SELECT b.server_ver FROM public.magazie_bucati b WHERE b.id=v_id) IS DISTINCT FROM (v_r->>'server_ver')::bigint
    OR v_r->'inainte' IS DISTINCT FROM jsonb_build_object('perete_mm',8,'server_ver',v_sv)
    OR v_r->'dupa' IS DISTINCT FROM '{"perete_mm":9}'::jsonb
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente ev WHERE ev.id=v_ev AND ev.tip='corectie'
      AND ev.document_tip='izo_corectie' AND ev.document_id=v_r->>'corectie_id' AND ev.server_ver IS NOT NULL)
    OR (SELECT count(*) FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev AND mis.bucata_id=v_id
      AND mis.rol='corectat' AND mis.inainte=v_r->'inainte' AND mis.dupa=v_r->'dupa' AND mis.lungime_mm IS NULL
      AND mis.stare_inainte IS NULL AND mis.stare_dupa IS NULL AND mis.server_ver IS NOT NULL)<>1
    OR NOT EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.id=(v_r->>'corectie_id')::bigint
      AND cor.cale='direct' AND cor.stare='aplicata' AND cor.decis_de=cor.propus_de AND cor.eveniment_id=v_ev)
    OR (SELECT to_jsonb(doc) FROM public.izo_documente_intrare doc WHERE doc.id=v_b.aviz_intrare_id) IS DISTINCT FROM v_doc_inainte THEN
    RAISE EXCEPTION 'C2 camp incomplet: %',v_r; END IF;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_camp(v_id,v_sv,'{"perete_mm":9}','corectie perete C2');
    RAISE EXCEPTION 'C2 camp retry a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  IF (SELECT count(*) FROM public.izo_corectii cor WHERE cor.bucata_id=v_id AND cor.cale='direct')<>1 THEN RAISE EXCEPTION 'C2 retry camp a duplicat'; END IF;
END $c2_camp$;

DO $c2_pv$
DECLARE v_doc bigint:=current_setting('test.c2_doc')::bigint; v_inainte public.izo_documente_intrare;
  v_r jsonb; v_ev bigint; v_bucati jsonb; v_randuri jsonb; v_evenimente jsonb; v_miscari jsonb;
BEGIN
  SELECT doc.* INTO v_inainte FROM public.izo_documente_intrare doc WHERE doc.id=v_doc;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) INTO v_bucati FROM public.magazie_bucati b WHERE b.aviz_intrare_id=v_doc;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.nr_crt) INTO v_randuri FROM public.izo_documente_intrare_randuri r WHERE r.document_id=v_doc;
  SELECT to_jsonb(ev) INTO v_evenimente FROM public.magazie_bucati_evenimente ev WHERE ev.id=v_inainte.eveniment_pv_id;
  SELECT jsonb_agg(to_jsonb(mis) ORDER BY mis.id) INTO v_miscari FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_inainte.eveniment_pv_id;
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
  v_r:=public.fn_izo_cor_pv(v_doc,v_inainte.versiune,'  C2   corectat  ','2026-10-22','corectie PV C2');
  v_ev:=(v_r->>'eveniment_id')::bigint;
  IF v_r->>'document_id'<>v_doc::text OR (v_r->>'versiune')::bigint<>v_inainte.versiune+1
    OR NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare doc WHERE doc.id=v_doc AND doc.pv_nr='C2   corectat'
      AND doc.pv_nr_canon='C2 CORECTAT' AND doc.pv_data='2026-10-22' AND doc.versiune=v_inainte.versiune+1)
    OR (SELECT to_jsonb(doc)-ARRAY['pv_nr','pv_nr_canon','pv_data','versiune','updated_at'] FROM public.izo_documente_intrare doc WHERE doc.id=v_doc)
      IS DISTINCT FROM to_jsonb(v_inainte)-ARRAY['pv_nr','pv_nr_canon','pv_data','versiune','updated_at']
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente ev WHERE ev.id=v_ev AND ev.tip='corectie' AND ev.document_tip='izo_corectie'
      AND ev.document_id=v_r->>'corectie_id' AND ev.storno_de_eveniment_id IS NULL AND ev.server_ver IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev)
    OR (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.magazie_bucati b WHERE b.aviz_intrare_id=v_doc) IS DISTINCT FROM v_bucati
    OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.nr_crt) FROM public.izo_documente_intrare_randuri r WHERE r.document_id=v_doc) IS DISTINCT FROM v_randuri
    OR (SELECT to_jsonb(ev) FROM public.magazie_bucati_evenimente ev WHERE ev.id=v_inainte.eveniment_pv_id) IS DISTINCT FROM v_evenimente
    OR (SELECT jsonb_agg(to_jsonb(mis) ORDER BY mis.id) FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_inainte.eveniment_pv_id) IS DISTINCT FROM v_miscari
    OR NOT EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.id=(v_r->>'corectie_id')::bigint AND cor.tip='pv' AND cor.cale='direct'
      AND cor.stare='aplicata' AND cor.document_intrare_id=v_doc AND cor.eveniment_id=v_ev
      AND cor.inainte=jsonb_build_object('pv_nr',v_inainte.pv_nr,'pv_nr_canon',v_inainte.pv_nr_canon,'pv_data',v_inainte.pv_data,'versiune',v_inainte.versiune)) THEN
    RAISE EXCEPTION 'C2 PV incomplet: %',v_r; END IF;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata (PostgREST: un RPC = o tranzactie)
    PERFORM public.fn_izo_cor_pv(v_doc,v_inainte.versiune,'C2 corectat','2026-10-22','corectie PV C2');
    RAISE EXCEPTION 'C2 PV retry a trecut';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  IF (SELECT count(*) FROM public.izo_corectii cor WHERE cor.document_intrare_id=v_doc AND cor.tip='pv')<>1 THEN
    RAISE EXCEPTION 'C2 retry PV a duplicat'; END IF;
END $c2_pv$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK;
DO $c2_final$ BEGIN
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'C2 poarta dupa rollback'; END IF;
  RAISE NOTICE 'TESTE E3b-C2: TOATE OK';
END $c2_final$;

-- D1: negative intai; toate fixture-urile si ACL-ul temporar dispar la rollback.
BEGIN;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
DO $d1_acl$ BEGIN
  BEGIN
    PERFORM public.fn_izo_cor_storno_import(3,'D1-import',ARRAY[1::bigint],'test ACL','00000000-0000-0000-0000-000000000121');
    RAISE EXCEPTION 'D1 authenticated a trecut';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%permission denied for function%' THEN RAISE; END IF;
  END;
END $d1_acl$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
-- Exercitam si verificarea session_user, independent de ACL: grant strict temporar.
SAVEPOINT d1_sesiune;
SET LOCAL ROLE izo_corectie_writer;
GRANT EXECUTE ON FUNCTION public.fn_izo_cor_storno_import(bigint,text,bigint[],text,uuid) TO authenticator;
RESET ROLE;
SET SESSION AUTHORIZATION authenticator;
DO $d1_sesiune$ BEGIN
  BEGIN
    PERFORM public.fn_izo_cor_storno_import(3,'D1-import',ARRAY[1::bigint],'test sesiune','00000000-0000-0000-0000-000000000121');
    RAISE EXCEPTION 'D1 sesiune non-postgres a trecut';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b administrativ' THEN RAISE; END IF;
  END;
END $d1_sesiune$;
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT d1_sesiune;

-- activarea + importul întâi (o singură tranzacție nu poate importa după ce a luat deja lock-ul proiectului)
SELECT set_config('izo.registru_tx','',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT public.fn_izo_activeaza_si_importa(3,'D1-import',
  '{"motiv":"fixture D1","surse":[{"fisier":"D1.xlsx","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}],"bucati":[
    {"tip":"teava","serie":"D1-1","sarja":"D1-S","lungime_mm":12000,"perete_mm":8,"stare":"receptionat","depozit_id":11,"sursa":{"fisier":"D1.xlsx","foaie":"F","rand":1}},
    {"tip":"teava","serie":"D1-2","sarja":"D1-S","lungime_mm":12000,"perete_mm":8,"stare":"sosit","depozit_id":11,"sursa":{"fisier":"D1.xlsx","foaie":"F","rand":2}},
    {"tip":"teava","serie":"D1-3","sarja":"D1-S","lungime_mm":12000,"perete_mm":8,"stare":"receptionat","depozit_id":11,"sursa":{"fisier":"D1.xlsx","foaie":"F","rand":3}}]}','fixture D1: activare + import');
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $d1_straina$ DECLARE v_id bigint:=nextval('public.magazie_bucati_id_seq'); BEGIN
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,
    serie,sarja,perete_mm,lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,
    provenienta,stare,locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','D1-STRAINA','D1-S',8,
    12000,12000,12,12,'AB','A','B','beneficiar','receptionat','depozit',6,11,'manual');
  PERFORM set_config('test.d1_straina',v_id::text,true);
END $d1_straina$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv) VALUES
  (3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture D1'),
  (3,'00000000-0000-0000-0000-000000000117','manager_aprobator',NULL,'test','fixture D1');
INSERT INTO public.user_module_access(profile_id,module,access_level)
  VALUES('00000000-0000-0000-0000-000000000117','magazie','editor');
SET SESSION AUTHORIZATION authenticator;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $d1_propune$ BEGIN
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
  PERFORM public.fn_izo_cor_propune('camp',3,(SELECT id FROM public.magazie_bucati WHERE serie='D1-3'),'{"lot":"D1 NOU"}','propunere deschisa D1');
END $d1_propune$;
-- Corectia deja aplicata nu blocheaza storno-ul (Q1=A).
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $d1_camp$ DECLARE v_b public.magazie_bucati; BEGIN
  SELECT * INTO v_b FROM public.magazie_bucati WHERE serie='D1-1';
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
  PERFORM public.fn_izo_cor_camp(v_b.id,v_b.server_ver,'{"perete_mm":9}','corectie inainte de storno D1');
END $d1_camp$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT set_config('request.jwt.claims','{}',true);
DO $d1_negative$
DECLARE v_id bigint; v_uid uuid; v_ids bigint[]; v_lista bigint[];
BEGIN
  SELECT array_agg(id ORDER BY serie) INTO v_ids FROM public.magazie_bucati WHERE serie IN ('D1-1','D1-2');
  FOREACH v_uid IN ARRAY ARRAY[NULL::uuid,'00000000-0000-0000-0000-000000000030'::uuid,'00000000-0000-0000-0000-0000000000f0'::uuid] LOOP
    BEGIN
      PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
      PERFORM public.fn_izo_cor_storno_import(3,'D1-import',v_ids,'test neeligibil',v_uid);
      RAISE EXCEPTION 'D1 cerut_de neeligibil a trecut';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'E3b: cerut_de neeligibil' THEN RAISE; END IF;
    END;
  END LOOP;
  FOR v_lista IN SELECT x FROM (VALUES(NULL::bigint[]),('{}'::bigint[]),
    (ARRAY[v_ids[1],v_ids[1]]),(ARRAY[v_ids[1],NULL::bigint]),(array_fill(v_ids[1],ARRAY[10001]))) forme(x) LOOP
    BEGIN
      PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
      PERFORM public.fn_izo_cor_storno_import(3,'D1-import',v_lista,'test forma listei','00000000-0000-0000-0000-000000000117');
      RAISE EXCEPTION 'D1 lista invalida a trecut';
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM <> 'E3b: lista / motiv invalid' THEN RAISE; END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
    PERFORM public.fn_izo_cor_storno_import(3,'D1-import',
      ARRAY[current_setting('test.d1_straina')::bigint,(SELECT id FROM public.magazie_bucati WHERE serie='D1-3')],
      'test lista completa','00000000-0000-0000-0000-000000000117');
    RAISE EXCEPTION 'D1 lista completa ignorata';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF position(current_setting('test.d1_straina') IN SQLERRM)=0
      OR position((SELECT id::text FROM public.magazie_bucati WHERE serie='D1-3') IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  FOR v_id IN SELECT current_setting('test.d1_straina')::bigint UNION ALL SELECT id FROM public.magazie_bucati WHERE serie='D1-3' LOOP
    BEGIN
      PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
      PERFORM public.fn_izo_cor_storno_import(3,'D1-import',ARRAY[v_ids[1],v_id],'test origine / propunere','00000000-0000-0000-0000-000000000117');
      RAISE EXCEPTION 'D1 origine / propunere ignorata';
    EXCEPTION WHEN invalid_parameter_value THEN
      IF SQLERRM NOT LIKE '%bucati neeligibile%' OR position(v_id::text IN SQLERRM)=0 THEN RAISE; END IF;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.izo_corectii WHERE tip='storno_import')
    OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE id=ANY(v_ids) AND stare='anulata') THEN
    RAISE EXCEPTION 'D1 negative au lasat efecte'; END IF;
END $d1_negative$;

DO $d1_storno$
DECLARE v_ids bigint[]; v_r jsonb; v_cor bigint; v_ev bigint;
BEGIN
  SELECT array_agg(id ORDER BY serie) INTO v_ids FROM public.magazie_bucati WHERE serie IN ('D1-1','D1-2');
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
  v_r:=public.fn_izo_cor_storno_import(3,'D1-import',v_ids,'storno partial D1','00000000-0000-0000-0000-000000000117');
  v_cor:=(v_r->>'corectie_id')::bigint; v_ev:=(v_r->>'eveniment_id')::bigint;
  IF v_r->>'bucati_anulate'<>'2'
    OR (SELECT count(*) FROM public.magazie_bucati WHERE id=ANY(v_ids) AND stare='anulata')<>2
    OR (SELECT count(*) FROM public.izo_corectii_bucati WHERE corectie_id=v_cor AND bucata_id=ANY(v_ids))<>2
    OR NOT EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE id=v_ev AND tip='storno_partial'
      AND declarat_de='00000000-0000-0000-0000-000000000117' AND aplicat_de IS NULL AND aplicat_rol='postgres' AND import_id='D1-import')
    OR (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id=v_ev AND bucata_id=ANY(v_ids)
      AND rol='anulat' AND stare_inainte IN ('sosit','receptionat') AND stare_dupa='anulata' AND server_ver IS NOT NULL)<>2
    OR NOT EXISTS(SELECT 1 FROM public.izo_corectii WHERE id=v_cor AND stare='aplicata' AND eveniment_id=v_ev)
    OR (SELECT stare FROM public.izo_importuri WHERE proiect_id=3 AND import_id='D1-import')<>'aplicat'
    OR (SELECT stare FROM public.magazie_bucati WHERE serie='D1-3')<>'receptionat' THEN
    RAISE EXCEPTION 'D1 storno incomplet: %',v_r; END IF;
END $d1_storno$;
SELECT set_config('izo.corectie_ctx','',true);
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $d1_salveaza$
DECLARE v_r jsonb; v_doc bigint;
BEGIN
  v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
    '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"D1 Furnizor","nr_document":"D1 DRAFT","data_document":"2026-10-22","total_m":12.3456}',
    '[{"nr_crt":1,"serie":"D1-DOC","sarja":"D1-S","perete_mm":7.25,"lungime_doc_mm":12000}]',NULL);
  v_doc:=(v_r->>'document_id')::bigint;
  IF v_r->>'istoric_versiune'<>'1' THEN RAISE EXCEPTION 'D1 versiune istoric creare'; END IF;
  PERFORM set_config('test.d1_doc',v_doc::text,true);
  PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
  v_r:=public.fn_izo_doc_salveaza(v_doc,1,
    '{"furnizor":"D1 Furnizor","nr_document":"D1 DRAFT","data_document":"2026-10-22","total_m":12.3456,"observatii":"revizie"}',
    '[{"nr_crt":1,"serie":"D1-DOC","sarja":"D1-S","perete_mm":7.35,"lungime_doc_mm":12000},{"nr_crt":2,"serie":"D1-DOC-2","sarja":"D1-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
  IF v_r->>'istoric_versiune'<>'2' THEN RAISE EXCEPTION 'D1 versiune istoric salvare'; END IF;
  BEGIN
    PERFORM set_config('izo.corectie_ctx','',true); -- tranzactie noua simulata
    PERFORM public.fn_izo_doc_salveaza(v_doc,1,'{}','[]',NULL);
    RAISE EXCEPTION 'D1 CAS vechi a trecut';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $d1_salveaza$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $d1_istoric$
DECLARE v_doc bigint:=current_setting('test.d1_doc')::bigint; v_a public.izo_documente_istoric; v_b public.izo_documente_istoric;
BEGIN
  SELECT * INTO STRICT v_a FROM public.izo_documente_istoric WHERE document_id=v_doc AND versiune=1;
  SELECT * INTO STRICT v_b FROM public.izo_documente_istoric WHERE document_id=v_doc AND versiune=2;
  IF (SELECT count(*) FROM public.izo_documente_istoric WHERE document_id=v_doc)<>2
    OR NOT v_a.baza OR v_b.baza OR v_a.diff IS DISTINCT FROM v_a.continut
    OR v_b.salvat_de<>'00000000-0000-0000-0000-000000000030' OR v_b.salvat_rol<>'authenticator'
    OR v_b.diff#>'{antet,observatii}' IS DISTINCT FROM '[null,"revizie"]'::jsonb
    OR v_b.diff#>'{randuri,modificate,1,perete_mm}' IS DISTINCT FROM '["7.3","7.4"]'::jsonb
    OR jsonb_array_length(v_b.diff#>'{randuri,adaugate}')<>1
    OR v_b.continut#>>'{totaluri,total_m}'<>'12.346'
    OR v_b.hash IS DISTINCT FROM public.fn_izo_doc_hash(v_doc)
    OR v_b.hash IS DISTINCT FROM 'e3-doc-v1:'||encode(sha256(convert_to(v_b.continut::text,'UTF8')),'hex')
    OR v_a.hash IS DISTINCT FROM 'e3-doc-v1:'||encode(sha256(convert_to(v_a.continut::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'D1 istoric / diff / hash incorect'; END IF;
  BEGIN
    UPDATE public.izo_documente_istoric SET diff='{}' WHERE document_id=v_doc;
    RAISE EXCEPTION 'D1 istoric modificabil';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: istoric imutabil' THEN RAISE; END IF;
  END;
END $d1_istoric$;
-- Metadate schimbate pe aceeasi cale: nu sunt un scan nou / scos.
DO $d1_diff_scan$ DECLARE v_d jsonb; BEGIN
  v_d:=public.fn_izo_doc_diff(
    '{"antet":{},"aviz":{},"lista":{},"totaluri":{},"randuri":[{"nr_crt":1,"serie":"A"}],"scanuri":[{"cale":"a.pdf","sha256_pdf":"vechi","marime":10,"mime":"application/pdf"}]}',
    '{"antet":{},"aviz":{},"lista":{},"totaluri":{},"randuri":[],"scanuri":[{"cale":"a.pdf","sha256_pdf":"nou","marime":20,"mime":"application/pdf"}]}');
  IF v_d#>'{scanuri,modificate,a.pdf}' IS DISTINCT FROM '{"sha256_pdf":["vechi","nou"],"marime":[10,20]}'::jsonb
    OR v_d#>'{scanuri,adaugate}' IS DISTINCT FROM '[]'::jsonb
    OR v_d#>'{scanuri,scoase}' IS DISTINCT FROM '[]'::jsonb
    OR v_d#>'{randuri,sterse}' IS DISTINCT FROM '[{"nr_crt":1,"serie":"A"}]'::jsonb THEN
    RAISE EXCEPTION 'D1 diff scan / rand sters incorect: %',v_d; END IF;
END $d1_diff_scan$;
SET LOCAL ROLE izo_doc_editor;
DO $d1_istoric_fals$ BEGIN
  BEGIN
    INSERT INTO public.izo_documente_istoric(document_id,versiune,salvat_de,salvat_rol,continut,hash,diff,baza)
    SELECT document_id,versiune,salvat_de,session_user,continut,hash,'{}',baza
      FROM public.izo_documente_istoric WHERE document_id=current_setting('test.d1_doc')::bigint AND versiune=2;
    RAISE EXCEPTION 'D1 diff fals acceptat';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: continut istoric diferit' THEN RAISE; END IF;
  END;
END $d1_istoric_fals$;
RESET ROLE;
-- Referinta pre-E3b: corpul hash LIVE E3, copiat exact pe acelasi continut.
DO $d1_hash_e3$ DECLARE v_hash_e3 text; BEGIN

    SELECT 'e3-doc-v1:' || encode(sha256(convert_to(jsonb_build_object(
      'v', 'e3-doc-v1',
      'antet', jsonb_build_object('proiect_id', d.proiect_id, 'depozit_id', d.depozit_id, 'sablon', d.sablon,
        'furnizor', d.furnizor, 'furnizor_canon', d.furnizor_canon, 'furnizor_cif', d.furnizor_cif, 'nr_document', d.nr_document,
        'nr_document_canon', d.nr_document_canon, 'data_document', d.data_document, 'inlocuieste_document_id', d.inlocuieste_document_id,
        'motiv_inlocuire', d.motiv_inlocuire, 'observatii', d.observatii),
      'aviz', jsonb_build_object('cumparator', d.cumparator, 'transport_nr', d.transport_nr, 'nume_proiect', d.nume_proiect, 'lot', d.lot,
        'loc_livrare', d.loc_livrare, 'data_incarcare', d.data_incarcare, 'data_descarcare', d.data_descarcare, 'nr_camion', d.nr_camion),
      'lista', jsonb_build_object('factura', d.factura, 'importator', d.importator, 'destinatar', d.destinatar,
        'referinta_client', d.referinta_client, 'referinta_furnizor', d.referinta_furnizor, 'placa_camion_container', d.placa_camion_container),
      'totaluri', jsonb_build_object('total_m', round(d.total_m, 3)::text, 'total_kg', round(d.total_kg, 1)::text, 'total_bucati', d.total_bucati,
        'total_pachete', d.total_pachete, 'total_net_kg', round(d.total_net_kg, 1)::text, 'total_brut_kg', round(d.total_brut_kg, 1)::text),
      'randuri', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'nr_crt', r.nr_crt, 'serie', r.serie, 'sarja', r.sarja, 'lot', r.lot, 'specificatie', r.specificatie, 'dimensiune', r.dimensiune,
          'grad_otel', r.grad_otel, 'standard', r.standard, 'izolatie', r.izolatie, 'diametru_mm', r.diametru_mm,
          'perete_mm', round(r.perete_mm, 1)::text, 'greutate_kg', round(r.greutate_kg, 1)::text,
          'lungime_doc_mm', r.lungime_doc_mm, 'lungime_masurata_mm', r.lungime_masurata_mm, 'cod', r.cod, 'item', r.item,
          'unghi_doc', round(r.unghi_doc, 1)::text, 'unghi_masurat', round(r.unghi_masurat, 1)::text, 'cantitate', r.cantitate,
          'pachet_nr', r.pachet_nr, 'dimensiuni_cm', r.dimensiuni_cm, 'net_kg', round(r.net_kg, 1)::text, 'brut_kg', round(r.brut_kg, 1)::text,
          'decizie', r.decizie, 'motiv', r.motiv, 'observatie', r.observatie) ORDER BY r.nr_crt), '[]'::jsonb)
        FROM public.izo_documente_intrare_randuri r WHERE r.document_id = d.id),
      'scanuri', (SELECT coalesce(jsonb_agg(jsonb_build_object('cale', s.cale, 'sha256_original', s.sha256_original,
          'sha256_pdf', s.sha256_pdf, 'marime', s.marime, 'mime', s.mime) ORDER BY s.cale), '[]'::jsonb)
        FROM public.izo_documente_scanuri s WHERE s.document_id = d.id)
    )::text, 'UTF8')), 'hex')
    INTO v_hash_e3 FROM public.izo_documente_intrare d WHERE d.id = current_setting('test.d1_doc')::bigint
  ;
  IF v_hash_e3 IS DISTINCT FROM public.fn_izo_doc_hash(current_setting('test.d1_doc')::bigint)
    OR v_hash_e3 IS DISTINCT FROM (SELECT hash FROM public.izo_documente_istoric WHERE document_id=current_setting('test.d1_doc')::bigint AND versiune=2) THEN
    RAISE EXCEPTION 'D1 hash diferit de implementarea pre-E3b'; END IF;
END $d1_hash_e3$;
ROLLBACK;

-- D2 / Q1=A, Q17=A, Q14=A. Negative inaintea fluxurilor pozitive.
BEGIN;
SAVEPOINT d2_poarta;
GRANT UPDATE (atribute) ON public.magazie_bucati TO izo_corectie_writer;
DO $d2_rosu$ BEGIN
  BEGIN
    PERFORM public.fn_izo_import_sold_initial(3,'D2-rosu','{}');
    RAISE EXCEPTION 'D2 importul a ignorat poarta rosie';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: porti incomplete' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_izo_import_storno(3,'D2-rosu','test poarta');
    RAISE EXCEPTION 'D2 storno a ignorat poarta rosie';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: porti incomplete' THEN RAISE; END IF;
  END;
END $d2_rosu$;
ROLLBACK TO d2_poarta;
-- Importul precede orice alta scriere de registru; activare prin intrarea combinata.
SELECT set_config('request.jwt.claims','{}',true);
SELECT public.fn_izo_activeaza_si_importa(3,'D2-import',
  '{"motiv":"fixture D2","surse":[{"fisier":"D2.xlsx","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}],"bucati":[
    {"tip":"teava","serie":"D2-1","sarja":"D2-S","lungime_mm":12000,"perete_mm":8,"stare":"receptionat","depozit_id":11,"sursa":{"fisier":"D2.xlsx","foaie":"F","rand":1}},
    {"tip":"teava","serie":"D2-2","sarja":"D2-S","lungime_mm":12000,"perete_mm":8,"stare":"sosit","depozit_id":11,"sursa":{"fisier":"D2.xlsx","foaie":"F","rand":2}},
    {"tip":"teava","serie":"D2-3","sarja":"D2-S","lungime_mm":12000,"perete_mm":8,"stare":"receptionat","depozit_id":11,"sursa":{"fisier":"D2.xlsx","foaie":"F","rand":3}}]}','fixture D2: activare + import');
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv) VALUES
  (3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture D2'),
  (3,'00000000-0000-0000-0000-000000000117','manager_aprobator',NULL,'test','fixture D2');
INSERT INTO public.user_module_access(profile_id,module,access_level)
  VALUES('00000000-0000-0000-0000-000000000117','magazie','editor');
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $d2_doc$ DECLARE v_r jsonb; v_doc bigint; v_ver jsonb; BEGIN
  v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
    '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"D2 Furnizor","nr_document":"D2 CONF","data_document":"2026-10-22","total_m":24}',
    '[{"nr_crt":1,"serie":"D2-DOC-1","sarja":"D2-S","perete_mm":8,"lungime_doc_mm":12000},{"nr_crt":2,"serie":"D2-DOC-2","sarja":"D2-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
  v_doc:=(v_r->>'document_id')::bigint;
  PERFORM set_config('test.d2_doc',v_doc::text,true);
  v_ver:=public.fn_izo_doc_verifica(v_doc);
  PERFORM public.fn_izo_doc_confirma(v_doc,(v_ver->>'versiune')::bigint,v_ver->>'hash');
  PERFORM set_config('izo.receptie_ctx','',true);
  PERFORM public.fn_izo_doc_pv(v_doc,2,'D2-PV','2026-10-22');
  PERFORM set_config('izo.receptie_ctx','',true);
  PERFORM set_config('izo.corectie_ctx','',true);
  v_r:=public.fn_izo_cor_propune('carantina_intrare',3,(SELECT id FROM public.magazie_bucati WHERE serie='D2-1'),'{"ncr_ref":"D2-IMPORT"}','carantina D2 import');
  PERFORM set_config('test.d2_cor_import',v_r->>'corectie_id',true);
  PERFORM set_config('izo.corectie_ctx','',true);
  v_r:=public.fn_izo_cor_propune('carantina_intrare',3,(SELECT id FROM public.magazie_bucati WHERE serie='D2-DOC-1'),'{"ncr_ref":"D2-DOC"}','carantina D2 document');
  PERFORM set_config('test.d2_cor_doc',v_r->>'corectie_id',true);
END $d2_doc$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('izo.corectie_ctx','',true);
DO $d2_negative$ DECLARE v_doc bigint:=current_setting('test.d2_doc')::bigint; BEGIN
  BEGIN
    PERFORM public.fn_izo_import_storno(3,'D2-import','test propunere deschisa');
    RAISE EXCEPTION 'D2 full storno a ignorat propunerea';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'E3b: decide / retrage intai propunerile:%'
      OR position((SELECT id::text FROM public.magazie_bucati WHERE serie='D2-1') IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_izo_doc_anuleaza(v_doc,'test fara cerut_de');
    RAISE EXCEPTION 'D2 anulare fara cerut_de a trecut';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: cerut_de neeligibil' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_izo_doc_anuleaza(v_doc,'test propunere deschisa','00000000-0000-0000-0000-000000000117');
    RAISE EXCEPTION 'D2 anulare a ignorat propunerea';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'E3b: decide / retrage intai propunerile:%'
      OR position((SELECT id::text FROM public.magazie_bucati WHERE serie='D2-DOC-1') IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE serie LIKE 'D2-%' AND stare='anulata') THEN
    RAISE EXCEPTION 'D2 negative au lasat efecte'; END IF;
END $d2_negative$;
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
DO $d2_corectii$ DECLARE v_b public.magazie_bucati; BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);
  PERFORM public.fn_izo_cor_aproba(current_setting('test.d2_cor_import')::bigint,1);
  PERFORM set_config('izo.corectie_ctx','',true);
  PERFORM public.fn_izo_cor_aproba(current_setting('test.d2_cor_doc')::bigint,1);
  PERFORM set_config('izo.corectie_ctx','',true);
  SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE serie='D2-2';
  PERFORM public.fn_izo_cor_camp(v_b.id,v_b.server_ver,'{"perete_mm":9}','camp D2 inainte de storno');
END $d2_corectii$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('izo.corectie_ctx','',true);
-- O bucată inchisa partial nu mai primeste o a doua miscare anulat la full storno.
SAVEPOINT d2_lant;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $d2_lant_fixture$ DECLARE v_ev bigint; BEGIN
  INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,motiv,server_ver)
    VALUES('corectie',3,'test_lant_d2','D2','simulare miscare non-E3b',nextval('public.izo_server_ver_seq')) RETURNING id INTO v_ev;
  INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
    SELECT v_ev,3,b.id,'corectat',b.stare,b.stare,nextval('public.izo_server_ver_seq') FROM public.magazie_bucati b
      WHERE b.serie IN ('D2-2','D2-DOC-2');
END $d2_lant_fixture$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
DO $d2_lant$ BEGIN
  BEGIN
    PERFORM public.fn_izo_import_storno(3,'D2-import','test lant ulterior');
    RAISE EXCEPTION 'D2 full storno a ignorat lantul non-E3b';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'izo: storno refuzat:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_izo_doc_anuleaza(current_setting('test.d2_doc')::bigint,'test lant ulterior','00000000-0000-0000-0000-000000000117');
    RAISE EXCEPTION 'D2 anulare a ignorat lantul non-E3b';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'izo E3: anulare refuzata:%' THEN RAISE; END IF;
  END;
END $d2_lant$;
ROLLBACK TO d2_lant;
SELECT public.fn_izo_cor_storno_import(3,'D2-import',ARRAY[(SELECT id FROM public.magazie_bucati WHERE serie='D2-3')],
  'partial inainte de complet D2','00000000-0000-0000-0000-000000000117');
SELECT set_config('izo.corectie_ctx','',true);
SAVEPOINT d2_garda;
SET LOCAL ROLE izo_receptie_writer;
DO $d2_garda$
DECLARE v_doc public.izo_documente_intrare; v_pv bigint; v_i bigint; v_b bigint; v_q bigint;
BEGIN
  SELECT * INTO STRICT v_doc FROM public.izo_documente_intrare WHERE id=current_setting('test.d2_doc')::bigint;
  SELECT id INTO STRICT v_b FROM public.magazie_bucati WHERE serie='D2-DOC-2';
  SELECT id INTO STRICT v_q FROM public.magazie_bucati WHERE serie='D2-DOC-1';
  PERFORM public.fn_izo_receptie_marcheaza('anulare',v_doc.id,3,11,v_doc.versiune,'test direct garda D2');
  PERFORM set_config('izo.anulare_cerut_de',txid_current()::text||'|'||v_doc.id::text||'|00000000-0000-0000-0000-000000000117',true);
  INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,storno_de_eveniment_id,motiv,declarat_de,aplicat_de,server_ver)
    VALUES('storno',3,'doc_intrare',v_doc.id::text,v_doc.eveniment_pv_id,'test direct garda D2','00000000-0000-0000-0000-000000000117',NULL,nextval('public.izo_server_ver_seq')) RETURNING id INTO v_pv;
  BEGIN
    INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
      VALUES(v_pv,3,v_q,'stare','receptionat','sosit',nextval('public.izo_server_ver_seq'));
    RAISE EXCEPTION 'D2 garda a acceptat PV fals pe carantina';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: miscare storno invalida / repetata' THEN RAISE; END IF;
  END;
  INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
    VALUES(v_pv,3,v_b,'stare','receptionat','sosit',nextval('public.izo_server_ver_seq'));
  BEGIN
    INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
      VALUES(v_pv,3,v_b,'stare','receptionat','sosit',nextval('public.izo_server_ver_seq'));
    RAISE EXCEPTION 'D2 garda a acceptat duplicat PV';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: miscare storno invalida / repetata' THEN RAISE; END IF;
  END;
  INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,storno_de_eveniment_id,motiv,declarat_de,aplicat_de,server_ver)
    VALUES('storno',3,'doc_intrare',v_doc.id::text,v_doc.eveniment_intrare_id,'test direct garda D2','00000000-0000-0000-0000-000000000117',NULL,nextval('public.izo_server_ver_seq')) RETURNING id INTO v_i;
  INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
    VALUES(v_i,3,v_q,'anulat','carantina','anulata',nextval('public.izo_server_ver_seq'));
  BEGIN
    INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
      VALUES(v_i,3,v_q,'anulat','carantina','anulata',nextval('public.izo_server_ver_seq'));
    RAISE EXCEPTION 'D2 garda a acceptat duplicat intrare';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'E3b: miscare storno invalida / repetata' THEN RAISE; END IF;
  END;
END $d2_garda$;
RESET ROLE;
ROLLBACK TO d2_garda;
DO $d2_pozitive$ DECLARE v_r jsonb; v_doc bigint:=current_setting('test.d2_doc')::bigint; v_i bigint; v_pv bigint; BEGIN
  v_r:=public.fn_izo_import_storno(3,'D2-import','storno complet dupa corectii D2');
  v_i:=(v_r->>'storno_eveniment_id')::bigint;
  IF v_r->>'bucati_anulate'<>'2'
    OR (SELECT stare FROM public.izo_importuri WHERE proiect_id=3 AND import_id='D2-import')<>'stornat'
    OR (SELECT count(*) FROM public.magazie_bucati WHERE serie IN ('D2-1','D2-2','D2-3') AND stare='anulata')<>3
    OR (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id=v_i AND rol='anulat' AND stare_dupa='anulata')<>2
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati b ON b.id=m.bucata_id
      WHERE m.eveniment_id=v_i AND b.serie='D2-1' AND m.stare_inainte='carantina')
    OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati b ON b.id=m.bucata_id
      WHERE m.eveniment_id=v_i AND b.serie='D2-3') THEN RAISE EXCEPTION 'D2 import nereconciliat: %',v_r; END IF;
  PERFORM set_config('izo.registru_tx','',true);
  v_r:=public.fn_izo_doc_anuleaza(v_doc,'anulare dupa carantina D2','00000000-0000-0000-0000-000000000117');
  v_i:=(v_r->>'storno_intrare_id')::bigint; v_pv:=(v_r->>'storno_pv_id')::bigint;
  IF v_r->>'bucati_anulate'<>'2' OR v_r->>'stare'<>'anulat'
    OR (SELECT count(*) FROM public.magazie_bucati WHERE aviz_intrare_id=v_doc AND stare='anulata')<>2
    OR (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE id IN (v_i,v_pv)
      AND declarat_de='00000000-0000-0000-0000-000000000117' AND aplicat_de IS NULL AND aplicat_rol='postgres')<>2
    OR (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id=v_pv AND stare_inainte='receptionat' AND stare_dupa='sosit')<>1
    OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati b ON b.id=m.bucata_id
      WHERE m.eveniment_id=v_i AND b.serie='D2-DOC-1' AND m.stare_inainte='carantina' AND m.stare_dupa='anulata')
    OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati b ON b.id=m.bucata_id
      WHERE m.eveniment_id=v_pv AND b.serie='D2-DOC-1') THEN RAISE EXCEPTION 'D2 document nereconciliat: %',v_r; END IF;
END $d2_pozitive$;
ROLLBACK;
