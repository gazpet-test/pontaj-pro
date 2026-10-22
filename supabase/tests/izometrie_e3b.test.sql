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
    WHERE pr.pronamespace='public'::regnamespace AND (pr.proname LIKE 'fn\_izo\_cor\_%' OR pr.proname='fn_izo_garda_corectie') LOOP
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
