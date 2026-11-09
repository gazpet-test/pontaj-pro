CREATE FUNCTION pg_temp.r29b_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- intoarce true daca instructiunea pica exact cu SQLSTATE-ul asteptat (asertiunea e in afara blocului EXCEPTION)
CREATE FUNCTION pg_temp.r29b_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29b_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29b.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29b_ca(uuid, text), pg_temp.r29b_refuza(text, text), pg_temp.r29b_g(text) TO authenticated, anon;

-- -- TEST0: garda tranzactiei de proba + identitatile ----------------------------------------------------------------------
DO $t$
DECLARE v_owner uuid; v_editor uuid; v_viewer uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261129b_redari_pv_creare:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: marcajul migrarii nu e al tranzactiei curente - DRY-ul ruleaza doar in tranzactia de proba';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261129120100') THEN
      RAISE EXCEPTION 'TEST0 FAIL: migrarea 20261129b e deja comisa (schema_migrations) - DRY-ul nu se ruleaza pe ea';
    END IF;
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE is_owner AND email = 'razvan.trusu@gazpet.ro';
  SELECT u.profile_id INTO v_editor FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'editor' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  SELECT u.profile_id INTO v_viewer FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'viewer' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  IF v_owner IS NULL OR v_editor IS NULL OR v_viewer IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa (owner/editor/viewer)'; END IF;
  PERFORM set_config('r29b.owner', v_owner::text, true);
  PERFORM set_config('r29b.editor', v_editor::text, true);
  PERFORM set_config('r29b.viewer', v_viewer::text, true);
  RAISE NOTICE 'TEST0 OK identitati';
END $t$;



SELECT pg_temp.r29b_ca(pg_temp.r29b_g('owner')::uuid,'authenticated');
DO $t$
DECLARE pr uuid; u uuid; p uuid; p2 uuid; d uuid; d2 uuid; v public.red_procese_verbale;
BEGIN
  INSERT INTO public.red_proiecte(cod,denumire) VALUES ('TEST-29B','Fictiv PV') RETURNING id INTO pr;
  IF EXISTS(SELECT 1 FROM public.red_numere WHERE cheie IN ('PVA-ZXB','PVB-ZXB')) THEN RAISE EXCEPTION 'Fixture ZXB already used'; END IF;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'Fictiv 29B','ZXB','Test') RETURNING id INTO u;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'T3-ZXB-0001',3) RETURNING id INTO p;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'T3-ZXB-0002',3) RETURNING id INTO p2;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p,'FICTIV UNU','FICTIV UNU','proprietar') RETURNING id INTO d;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p2,'FICTIV DOI','FICTIV DOI','proprietar') RETURNING id INTO d2;
  v:=public.fn_red_pv_creeaza('A',p,d,NULL);
  IF v.nr_pv IS DISTINCT FROM 'PVA-ZXB-0001' OR v.stare IS DISTINCT FROM 'generat' OR v.parcela_id IS DISTINCT FROM p
    OR v.detinator_id IS DISTINCT FROM d OR v.uat_id IS DISTINCT FROM u OR v.tronson IS DISTINCT FROM 3
    OR v.data_pv IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'PV A incorrect'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.red_jurnal WHERE inregistrare_id=v.id AND lower(actiune)='insert') THEN RAISE EXCEPTION 'Jurnal insert lipsa'; END IF;
  IF pg_temp.r29b_refuza(format('SELECT public.fn_red_pv_creeaza(''A'',%L,%L,NULL)',p,d),'P0001') IS NOT TRUE THEN RAISE EXCEPTION 'Duplicat acceptat'; END IF;
  IF (SELECT ultimul FROM public.red_numere WHERE cheie='PVA-ZXB') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Refuzul a consumat numar'; END IF;
  v:=public.fn_red_pv_creeaza('B',p,NULL,NULL);
  IF v.nr_pv IS DISTINCT FROM 'PVB-ZXB-0001' OR v.detinator_id IS NOT NULL THEN RAISE EXCEPTION 'PV B incorrect'; END IF;
  IF pg_temp.r29b_refuza(format('SELECT public.fn_red_pv_creeaza(''B'',%L,NULL,NULL)',p),'P0001') IS NOT TRUE THEN RAISE EXCEPTION 'Duplicat B acceptat'; END IF;
  IF pg_temp.r29b_refuza(format('SELECT public.fn_red_pv_creeaza(''A'',%L,%L,NULL)',p,d2),'23503') IS NOT TRUE THEN RAISE EXCEPTION 'Alta parcela acceptata'; END IF;
  IF pg_temp.r29b_refuza(format('SELECT public.fn_red_pv_creeaza(''A'',%L,%L,NULL)',gen_random_uuid(),d),'P0002') IS NOT TRUE THEN RAISE EXCEPTION 'Parcela lipsa acceptata'; END IF;
  PERFORM set_config('r29b.p',p2::text,true); PERFORM set_config('r29b.d',d2::text,true);
  RAISE NOTICE 'TEST1 OK';
END $t$;
SELECT pg_temp.r29b_ca(pg_temp.r29b_g('editor')::uuid,'authenticated');
DO $t$
DECLARE v public.red_procese_verbale; refuz boolean:=false;
BEGIN
  v:=public.fn_red_pv_creeaza('A',pg_temp.r29b_g('p')::uuid,pg_temp.r29b_g('d')::uuid,NULL);
  IF v.nr_pv IS DISTINCT FROM 'PVA-ZXB-0002' THEN RAISE EXCEPTION 'Editor creare incorecta'; END IF;
  BEGIN
    PERFORM public.fn_red_pv_creeaza('C',NULL,NULL,3);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN refuz:=position('felia 4e' IN SQLERRM)>0;
  END;
  IF refuz IS NOT TRUE THEN RAISE EXCEPTION 'C mesaj incorect'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;
SELECT pg_temp.r29b_ca(pg_temp.r29b_g('viewer')::uuid,'authenticated');
DO $t$ BEGIN
  IF pg_temp.r29b_refuza(format('SELECT public.fn_red_pv_creeaza(''B'',%L,NULL,NULL)',pg_temp.r29b_g('p')),'42501') IS NOT TRUE THEN RAISE EXCEPTION 'Viewer acceptat'; END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;
SELECT pg_temp.r29b_ca(NULL,'anon');
DO $t$ BEGIN
  IF pg_temp.r29b_refuza('SELECT public.fn_red_pv_creeaza(''C'',NULL,NULL,3)','42501') IS NOT TRUE THEN RAISE EXCEPTION 'Anon acceptat'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;
SELECT pg_temp.r29b_ca(NULL,'postgres');
