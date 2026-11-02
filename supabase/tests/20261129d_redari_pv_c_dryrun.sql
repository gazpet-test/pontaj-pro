CREATE FUNCTION pg_temp.r29d_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- intoarce true daca instructiunea pica exact cu SQLSTATE-ul asteptat (asertiunea e in afara blocului EXCEPTION)
CREATE FUNCTION pg_temp.r29d_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29d_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29d.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29d_ca(uuid, text), pg_temp.r29d_refuza(text, text), pg_temp.r29d_g(text) TO authenticated, anon;

-- -- TEST0: garda tranzactiei de proba + identitatile ----------------------------------------------------------------------
DO $t$
DECLARE v_owner uuid; v_editor uuid; v_viewer uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261129d_redari_pv_c:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: marcajul migrarii nu e al tranzactiei curente - DRY-ul ruleaza doar in tranzactia de proba';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261129120300') THEN
      RAISE EXCEPTION 'TEST0 FAIL: migrarea 20261129b e deja comisa (schema_migrations) - DRY-ul nu se ruleaza pe ea';
    END IF;
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE is_owner AND email = 'razvan.trusu@gazpet.ro';
  SELECT u.profile_id INTO v_editor FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'editor' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  SELECT u.profile_id INTO v_viewer FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'viewer' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  IF v_owner IS NULL OR v_editor IS NULL OR v_viewer IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa (owner/editor/viewer)'; END IF;
  PERFORM set_config('r29d.owner', v_owner::text, true);
  PERFORM set_config('r29d.editor', v_editor::text, true);
  PERFORM set_config('r29d.viewer', v_viewer::text, true);
  RAISE NOTICE 'TEST0 OK identitati';
END $t$;



SELECT pg_temp.r29d_ca(NULL,'postgres');
DO $t$
DECLARE pr uuid; u uuid; u2 uuid; p uuid; d uuid; i int;
BEGIN
  IF EXISTS(SELECT 1 FROM public.red_numere WHERE cheie='PVC-T5') THEN RAISE EXCEPTION 'Fixture PVC-T5 already used'; END IF;
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29D','Fictiv C') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'Majoritar','ZXD','Test') RETURNING id INTO u;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'Minoritar','ZXE','Test') RETURNING id INTO u2;
  FOR i IN 1..3 LOOP
    INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,CASE WHEN i<3 THEN u ELSE u2 END,'T5-'||CASE WHEN i<3 THEN 'ZXD' ELSE 'ZXE' END||'-000'||i,5) RETURNING id INTO p;
    IF i<3 THEN
      INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p,'FICTIV','FICTIV','proprietar') RETURNING id INTO d;
      INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare,fisier_semnat_path,semnat_primit_data,semnat_la_sesiune)
        VALUES('A',p,d,u,5,'PVA-ZXD-000'||i,'2026-11-02','semnat','test/scan.pdf','2026-11-02',i=1);
    ELSE
      INSERT INTO public.red_procese_verbale(tip,parcela_id,uat_id,tronson,nr_pv,data_pv,stare,motiv_pv_b)
        VALUES('B',p,u2,5,'PVB-ZXE-0001','2026-11-02','generat','neidentificat');
    END IF;
  END LOOP;
  PERFORM set_config('r29d.pr',pr::text,true);PERFORM set_config('r29d.u',u::text,true);
  RAISE NOTICE 'TEST1 OK fixtures with 4c active';
END $t$;
SELECT pg_temp.r29d_ca(pg_temp.r29d_g('owner')::uuid,'authenticated');
DO $t$
DECLARE v public.red_procese_verbale; mesaj boolean:=false;
BEGIN
  v:=public.fn_red_pv_c_creeaza(pg_temp.r29d_g('pr')::uuid,5);
  IF v.nr_pv IS DISTINCT FROM 'PVC-T5-0001' OR v.uat_id IS DISTINCT FROM pg_temp.r29d_g('u')::uuid OR v.parcela_id IS NOT NULL OR v.detinator_id IS NOT NULL THEN RAISE EXCEPTION 'PV C incorrect'; END IF;
  IF NOT pg_temp.r29d_refuza(format('SELECT public.fn_red_pv_c_creeaza(%L,5)',pg_temp.r29d_g('pr')),'P0001') THEN RAISE EXCEPTION 'Duplicate accepted'; END IF;
  IF NOT pg_temp.r29d_refuza(format('SELECT public.fn_red_pv_c_creeaza(%L,6)',pg_temp.r29d_g('pr')),'P0002') THEN RAISE EXCEPTION 'Empty accepted'; END IF;
  IF NOT pg_temp.r29d_refuza(format('SELECT public.fn_red_pv_c_creeaza(%L,12)',pg_temp.r29d_g('pr')),'22023') THEN RAISE EXCEPTION '12 accepted'; END IF;
  BEGIN PERFORM public.fn_red_pv_creeaza('C',NULL,NULL,5); EXCEPTION WHEN SQLSTATE 'P0001' THEN mesaj:=SQLERRM='PV C: foloseste fn_red_pv_c_creeaza'; END;
  IF NOT mesaj THEN RAISE EXCEPTION 'Wrong C message'; END IF;
  RAISE NOTICE 'TEST2 OK create, duplicate, empty, invalid, redirect';
END $t$;
SELECT pg_temp.r29d_ca(NULL,'postgres');
DO $t$ BEGIN
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pg_temp.r29d_g('pr')::uuid,pg_temp.r29d_g('u')::uuid,'T6-ZXD-0001',6);
END $t$;
SELECT pg_temp.r29d_ca(pg_temp.r29d_g('owner')::uuid,'authenticated');
DO $t$
DECLARE mesaj boolean:=false;
BEGIN
  BEGIN PERFORM public.fn_red_pv_c_creeaza(pg_temp.r29d_g('pr')::uuid,6); EXCEPTION WHEN SQLSTATE 'P0001' THEN mesaj:=SQLERRM='Tronsonul are parcele fara PV A semnat sau PV B: 1'; END;
  IF NOT mesaj THEN RAISE EXCEPTION 'Uncovered accepted/wrong message'; END IF;
  RAISE NOTICE 'TEST3 OK uncovered';
END $t$;
DO $t$ BEGIN
  -- Gemini f4d r1 P3: ramurile garzii si ca admin
  IF NOT pg_temp.r29d_refuza(format('INSERT INTO public.red_procese_verbale(tip,uat_id,tronson,nr_pv,data_pv) VALUES(''C'',%L,5,''PVC-T5-9998'',''2026-11-02'')',pg_temp.r29d_g('u')),'42501') THEN RAISE EXCEPTION 'Admin direct INSERT accepted'; END IF;
  IF NOT pg_temp.r29d_refuza(format('UPDATE public.red_procese_verbale SET sters_la=now() WHERE tip=''C'' AND uat_id=%L',pg_temp.r29d_g('u')),'23514') THEN RAISE EXCEPTION 'Admin soft delete accepted'; END IF;
  RAISE NOTICE 'TEST3b OK admin direct insert / soft delete refuzate';
END $t$;
SELECT pg_temp.r29d_ca(NULL,'postgres');
DO $t$ BEGIN
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pg_temp.r29d_g('pr')::uuid,pg_temp.r29d_g('u')::uuid,'T5-ZXD-0009',5);
END $t$;
SELECT pg_temp.r29d_ca(pg_temp.r29d_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  -- Gemini f4d r1 P2: parcela noua fara PV dupa crearea PV C -> semnarea PV C refuzata
  IF NOT pg_temp.r29d_refuza(format('UPDATE public.red_procese_verbale SET stare=''semnat'',semnat_primit_data=''2026-11-02'',fisier_semnat_path=''TEST/c.pdf'' WHERE tip=''C'' AND tronson=5 AND uat_id=%L',pg_temp.r29d_g('u')),'23514') THEN RAISE EXCEPTION 'Semnare PV C pe tronson neacoperit acceptata'; END IF;
  RAISE NOTICE 'TEST3c OK semnare PV C reverifica tronsonul';
END $t$;
SELECT pg_temp.r29d_ca(pg_temp.r29d_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29d_refuza(format('SELECT public.fn_red_pv_c_creeaza(%L,5)',pg_temp.r29d_g('pr')),'42501') THEN RAISE EXCEPTION 'Editor accepted'; END IF;
  IF NOT pg_temp.r29d_refuza(format('SELECT public.fn_red_pv_c_neacoperite(%L,5)',pg_temp.r29d_g('u')),'42501') THEN RAISE EXCEPTION 'Editor lock helper accepted'; END IF;
  IF NOT pg_temp.r29d_refuza(format('UPDATE public.red_procese_verbale SET locul=''editor'' WHERE tip=''C'' AND uat_id=%L',pg_temp.r29d_g('u')),'42501') THEN RAISE EXCEPTION 'Editor direct UPDATE accepted'; END IF;
  IF NOT pg_temp.r29d_refuza(format('INSERT INTO public.red_procese_verbale(tip,uat_id,tronson,nr_pv,data_pv) VALUES(''C'',%L,5,''PVC-T5-9999'',''2026-11-02'')',pg_temp.r29d_g('u')),'42501') THEN RAISE EXCEPTION 'Editor direct INSERT accepted'; END IF;
  RAISE NOTICE 'TEST4 OK editor RPC and direct writes';
END $t$;
SELECT pg_temp.r29d_ca(pg_temp.r29d_g('viewer')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29d_refuza(format('SELECT public.fn_red_pv_c_creeaza(%L,5)',pg_temp.r29d_g('pr')),'42501') THEN RAISE EXCEPTION 'Viewer accepted'; END IF;
  RAISE NOTICE 'TEST5 OK viewer';
END $t$;
SELECT pg_temp.r29d_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r29d_refuza('SELECT public.fn_red_pv_c_creeaza(NULL,5)','42501') THEN RAISE EXCEPTION 'Anon accepted'; END IF;
  RAISE NOTICE 'TEST6 OK anon';
END $t$;
SELECT pg_temp.r29d_ca(NULL,'postgres');