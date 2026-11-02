-- Run only in the runner's disposable transaction after applying 20261129c.
CREATE FUNCTION pg_temp.r29c_refuza(p_sql text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE refuz boolean := false;
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN refuz := true;
  END;
  IF NOT refuz THEN RAISE EXCEPTION 'Lipseste refuzul 23514: %',p_sql; END IF;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29c_refuza(text) TO authenticated;
DO $pre$
DECLARE editor uuid; proprietar uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129c_redari_pv_stari:'||txid_current() THEN RAISE EXCEPTION 'DRY: tranzactie de proba neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261129120200') THEN RAISE EXCEPTION 'DRY: migrare deja comisa'; END IF;
  SELECT a.profile_id INTO editor FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  IF editor IS NULL THEN RAISE EXCEPTION 'DRY: editor non-owner lipsa'; END IF;
  SELECT id INTO proprietar FROM public.profiles WHERE is_owner AND email='razvan.trusu@gazpet.ro';
  IF proprietar IS NULL THEN RAISE EXCEPTION 'DRY: owner lipsa'; END IF;
  PERFORM set_config('r29c.editor',editor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',proprietar,'role','authenticated')::text,true);
END $pre$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE pr uuid; u uuid; p uuid; d uuid; a public.red_procese_verbale; b public.red_procese_verbale;
BEGIN
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29C','Fictiv PV stari') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'Fictiv 29C','ZXC','Test') RETURNING id INTO u;
  INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'T3-ZXC-0001',3) RETURNING id INTO p;
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(p,'FICTIV UNU','FICTIV UNU','proprietar') RETURNING id INTO d;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('r29c.editor'),'role','authenticated')::text,true);
  a:=public.fn_red_pv_creeaza('A',p,d,NULL);
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''trimis_spre_semnare'' WHERE id=%L',a.id));
  UPDATE public.red_procese_verbale SET stare='trimis_spre_semnare',trimis_spre_semnare_data='2026-11-02' WHERE id=a.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trimitere fara rand'; END IF;
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''semnat'',semnat_primit_data=''2026-11-02'' WHERE id=%L',a.id));
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''semnat'',fisier_semnat_path=''TEST/scan.pdf'' WHERE id=%L',a.id));
  UPDATE public.red_procese_verbale SET stare='semnat',semnat_primit_data='2026-11-02',fisier_semnat_path='TEST/scan.pdf' WHERE id=a.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semnare fara rand'; END IF;
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''anulat'',motiv_anulare=''Test'' WHERE id=%L',a.id));
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET obiectii_text=''Schimbat'' WHERE id=%L',a.id));
  UPDATE public.red_procese_verbale SET remediat_la='2026-11-03' WHERE id=a.id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.red_procese_verbale WHERE id=a.id AND stare='semnat' AND remediat_la='2026-11-03') THEN RAISE EXCEPTION 'Remediere refuzata'; END IF;
  b:=public.fn_red_pv_creeaza('B',p,NULL,NULL);
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''semnat'',semnat_primit_data=''2026-11-02'',fisier_semnat_path=''TEST/b.pdf'' WHERE id=%L',b.id));
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''anulat'' WHERE id=%L',b.id));
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''anulat'',motiv_anulare=E'' \t\n'' WHERE id=%L',b.id));
  UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='Test' WHERE id=b.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anulare fara rand'; END IF;
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET stare=''generat'' WHERE id=%L',b.id));
  PERFORM pg_temp.r29c_refuza(format('UPDATE public.red_procese_verbale SET locul=''Alt loc'' WHERE id=%L',b.id));
  b:=public.fn_red_pv_creeaza('B',p,NULL,NULL);
  UPDATE public.red_procese_verbale SET stare='semnat',motiv_pv_b='refuz',semnat_primit_data='2026-11-02',fisier_semnat_path='TEST/b2.pdf' WHERE id=b.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semnare directa B refuzata'; END IF;
  RAISE NOTICE '20261129c: tranzitii si continut final OK ca editor non-owner';
END $test$;
RESET ROLE;
