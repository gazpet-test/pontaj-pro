-- Run only in the runner's disposable transaction after applying 20261129e.
DO $pre$
DECLARE editor uuid; proprietar uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129e_redari_prezenta_unica:'||txid_current() THEN RAISE EXCEPTION 'DRY: tranzactie de proba neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261129120400') THEN RAISE EXCEPTION 'DRY: migrare deja comisa'; END IF;
  SELECT a.profile_id INTO editor FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  IF editor IS NULL THEN RAISE EXCEPTION 'DRY: editor non-owner lipsa'; END IF;
  SELECT id INTO proprietar FROM public.profiles WHERE is_owner AND email='razvan.trusu@gazpet.ro';
  IF proprietar IS NULL THEN RAISE EXCEPTION 'DRY: owner lipsa'; END IF;
  PERFORM set_config('r29e.editor',editor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',proprietar,'role','authenticated')::text,true);
END $pre$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE pr uuid; u uuid; p uuid; d uuid; azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; refuz boolean := false;
BEGIN
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29E','Fictiv prezenta') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet,sesiune_zi1,sesiune_zi2) VALUES(pr,'Fictiv 29E','ZXF','Test',azi,azi+1) RETURNING id INTO u;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'T3-ZXF-0001',3) RETURNING id INTO p;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p,'FICTIV UNU','FICTIV UNU','proprietar') RETURNING id INTO d;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('r29e.editor'),'role','authenticated')::text,true);
  INSERT INTO public.red_raspunsuri(detinator_id,canal,optiune,zi_sesiune_aleasa,data) VALUES(d,'sesiune','particip',azi,now());
  RAISE NOTICE 'TEST1 OK prima prezenta ca editor';
  BEGIN
    INSERT INTO public.red_raspunsuri(detinator_id,canal,optiune,zi_sesiune_aleasa,data) VALUES(d,'sesiune','particip',azi+1,now());
  EXCEPTION WHEN unique_violation THEN refuz := true;
  END;
  IF NOT refuz THEN RAISE EXCEPTION 'A doua prezenta in aceeasi zi acceptata'; END IF;
  RAISE NOTICE 'TEST2 OK a doua prezenta aceeasi zi = 23505';
  INSERT INTO public.red_raspunsuri(detinator_id,canal,optiune,zi_sesiune_aleasa,data) VALUES(d,'sesiune','particip',azi+1,now() + interval '1 day');
  INSERT INTO public.red_raspunsuri(detinator_id,canal,optiune,zi_sesiune_aleasa,data) VALUES(d,'telefon','particip',azi,now());
  RAISE NOTICE 'TEST3 OK alta zi / alt canal permise';
END $test$;
RESET ROLE;
