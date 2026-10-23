-- E4b-2c. Helpers private; topology is simulated before registry DML.
CREATE FUNCTION public.fn_izo_sudura_decl(p_decl bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_s bigint; v_ref jsonb; v_b public.magazie_bucati;
 v_c public.izo_bucati_declarate; v_part text; v_id bigint; v_uid uuid; v_letter text;
BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE id=p_decl;
 IF NOT v_d.payload ? 'sudura' THEN
  IF v_d.tip='cuplare' OR coalesce(v_d.payload#>>'{amonte,tip}','inceput_lant')<>'inceput_lant' THEN
   RAISE EXCEPTION 'r4' USING ERRCODE='IZ002'; END IF;
  RETURN;
 END IF;
 IF v_d.tip NOT IN ('montaj','cuplare') OR (v_d.payload#>>'{sudura,nr}')::integer IS NULL
  OR (v_d.payload#>>'{sudura,nr}')::integer<1 OR (coalesce(v_d.payload#>>'{sudura,sufix}','')<>'' AND NOT EXISTS(SELECT 1 FROM public.fn_izo_proiect_config_citeste(v_d.proiect_id) cfg WHERE cfg.proiect_id=v_d.proiect_id AND upper(v_d.payload#>>'{sudura,sufix}')=ANY(cfg.conventie_sufixe))) THEN
  RAISE EXCEPTION 'sudura_cod' USING ERRCODE='IZ001'; END IF;
 v_s:=public.fn_izo_sudura_ins(v_d.id,(v_d.payload#>>'{sudura,nr}')::integer,upper(coalesce(v_d.payload#>>'{sudura,sufix}','')),
  CASE WHEN v_d.tip='cuplare' THEN 'cuplare' ELSE 'linie' END,v_d.payload->>'executant',v_d.payload->>'poanson',v_d.data_montaj);
 FOREACH v_part IN ARRAY ARRAY['amonte','aval'] LOOP
  v_ref:=CASE WHEN v_d.tip='cuplare' THEN v_d.payload->CASE WHEN v_part='amonte' THEN 'capat1' ELSE 'capat2' END
   WHEN v_part='amonte' THEN v_d.payload->'amonte'
   ELSE jsonb_build_object('bucata_id',v_d.bucata_id,'decl_uid',v_d.bucata_decl_uid,'capat',v_d.payload->>'capat_amonte') END;
  v_id:=(v_ref->>'bucata_id')::bigint; v_uid:=(v_ref->>'decl_uid')::uuid; v_letter:=v_ref->>'capat';
  IF num_nonnulls(v_id,v_uid)<>1 OR v_letter IS NULL THEN RAISE EXCEPTION 'r4' USING ERRCODE='IZ002'; END IF;
  IF v_uid IS NOT NULL THEN
   SELECT * INTO v_c FROM public.izo_bucati_declarate WHERE uid=v_uid;
   IF NOT FOUND OR v_c.stare='anulata' OR NOT EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE d.id=v_c.declaratie_id
    AND d.declarat_de=v_d.declarat_de AND d.proiect_id=v_d.proiect_id AND d.tronson_id=v_d.tronson_id
    AND d.uid=v_d.depinde_de_uid AND d.versiune=v_d.depinde_de_versiune) THEN RAISE EXCEPTION 'dependenta' USING ERRCODE='IZ003'; END IF;
   IF v_letter NOT IN (v_c.capat_stanga,v_c.capat_dreapta) THEN RAISE EXCEPTION 'r4' USING ERRCODE='IZ002'; END IF;
   SELECT id INTO v_id FROM public.magazie_bucati WHERE uid=v_uid;
   IF v_id IS NOT NULL THEN v_uid:=NULL; END IF;
  END IF;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_b FROM public.magazie_bucati WHERE id=v_id;
   IF NOT FOUND OR v_b.proiect_id<>v_d.proiect_id OR v_b.tronson_id IS DISTINCT FROM v_d.tronson_id
    OR v_b.stare NOT IN ('pe_tronson','montata') OR v_letter NOT IN (v_b.capat_stanga,v_b.capat_dreapta) THEN
    RAISE EXCEPTION 'r4' USING ERRCODE='IZ002'; END IF;
  END IF;
  PERFORM public.fn_izo_capat_ins(v_s,v_part,v_id,v_uid,v_letter,NULL);
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.izo_suduri_capete a JOIN public.izo_suduri_capete b ON b.sudura_id=a.sudura_id AND b.parte<>a.parte
  WHERE a.sudura_id=v_s AND (a.bucata_id=b.bucata_id OR a.bucata_decl_uid=b.bucata_decl_uid)) THEN
  RAISE EXCEPTION 'r4' USING ERRCODE='IZ002'; END IF;
END $f$;

-- Declaration-time checks use committed outer endpoints. Approval repeats them
-- on the virtual graph, including earlier cuts in the selected lot.
CREATE FUNCTION public.fn_izo_taiere_ramura(p_decl bigint) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_b public.magazie_bucati; v_n integer;
BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE id=p_decl;
 IF v_d.tip<>'taiere' THEN RETURN; END IF;
 SELECT * INTO v_b FROM public.magazie_bucati WHERE id=v_d.sursa_bucata_id OR uid=v_d.sursa_decl_uid;
 IF v_b.id IS NULL THEN RETURN; END IF;
 IF v_b.executie_teava_id IS NOT NULL THEN RAISE EXCEPTION 'bucata_in_pachet' USING ERRCODE='IZ002'; END IF;
 IF v_b.stare<>'montata' THEN
  IF EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.declaratie_id=p_decl AND c.stare='declarata' AND c.destinatie='ramane_montat') THEN
   RAISE EXCEPTION 'ramura_gresita' USING ERRCODE='IZ002'; END IF;
  RETURN;
 END IF;
 SELECT count(*) INTO v_n FROM public.izo_suduri_capete c JOIN public.izo_suduri w ON w.id=c.sudura_id
 WHERE c.bucata_id=v_b.id AND c.activ AND w.stare='aprobata';
 IF v_n NOT IN (1,2) THEN RAISE EXCEPTION 'ramura_neacoperita' USING ERRCODE='IZ002'; END IF;
 IF (SELECT count(*) FROM public.izo_bucati_declarate c WHERE c.declaratie_id=p_decl AND c.stare='declarata')<>v_n+1
  OR (SELECT count(*) FROM public.izo_bucati_declarate c WHERE c.declaratie_id=p_decl AND c.stare='declarata' AND c.destinatie='ramane_montat')<>v_n
  OR (SELECT count(*) FROM public.izo_bucati_declarate c WHERE c.declaratie_id=p_decl AND c.stare='declarata' AND c.destinatie='depozit')<>1
  OR EXISTS(SELECT 1 FROM public.izo_suduri_capete e JOIN public.izo_suduri w ON w.id=e.sudura_id
   WHERE e.bucata_id=v_b.id AND e.activ AND w.stare='aprobata' AND NOT EXISTS(SELECT 1 FROM public.izo_bucati_declarate c
    WHERE c.declaratie_id=p_decl AND c.stare='declarata' AND c.destinatie='ramane_montat' AND e.capat_litera IN (c.capat_stanga,c.capat_dreapta)))
 THEN RAISE EXCEPTION 'ramura_gresita' USING ERRCODE='IZ002'; END IF;
END $f$;

CREATE FUNCTION public.fn_izo_sudura_aproba(p_decl bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_s public.izo_suduri; v_n bigint; v_c record;
BEGIN
 SELECT * INTO v_s FROM public.izo_suduri WHERE declaratie_id=p_decl AND stare='declarata';
 IF NOT FOUND THEN RETURN; END IF;
 FOR v_c IN SELECT c.id,b.id AS bid FROM public.izo_suduri_capete c JOIN public.magazie_bucati b ON b.uid=c.bucata_decl_uid
  WHERE c.sudura_id=v_s.id AND c.activ ORDER BY c.id LOOP
  PERFORM public.fn_izo_capat_modifica(v_c.id,v_c.bid,NULL,true);
 END LOOP;
 SELECT count(*) INTO v_n FROM public.izo_suduri_capete c JOIN public.magazie_bucati b ON b.id=c.bucata_id
 WHERE c.sudura_id=v_s.id AND c.activ AND b.stare='montata' AND b.tronson_id=v_s.tronson_id
 AND c.capat_litera IN (b.capat_stanga,b.capat_dreapta);
 IF v_n<>2 THEN RAISE EXCEPTION 'r4'; END IF;
 PERFORM public.fn_izo_sudura_stare(v_s.id,'aprobata',(SELECT count(DISTINCT b.perete_mm)>1
  FROM public.izo_suduri_capete c JOIN public.magazie_bucati b ON b.id=c.bucata_id WHERE c.sudura_id=v_s.id AND c.activ));
END $f$;

CREATE FUNCTION public.fn_izo_capete_muta(p_sursa bigint,p_copil bigint,p_ev bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_c public.magazie_bucati; v_e public.izo_suduri_capete;
BEGIN
 SELECT * INTO STRICT v_c FROM public.magazie_bucati WHERE id=p_copil;
 FOR v_e IN SELECT * FROM public.izo_suduri_capete WHERE bucata_id=p_sursa AND activ
  AND capat_litera IN (v_c.capat_stanga,v_c.capat_dreapta) ORDER BY id LOOP
  PERFORM public.fn_izo_capat_modifica(v_e.id,v_e.bucata_id,v_e.bucata_decl_uid,false);
  PERFORM public.fn_izo_capat_ins(v_e.sudura_id,v_e.parte,p_copil,NULL,v_e.capat_litera,p_ev);
 END LOOP;
END $f$;

CREATE FUNCTION public.fn_izo_corectie_mm(p_decl bigint) RETURNS integer
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_b public.magazie_bucati; v_mm integer; v_tol integer;
BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE id=p_decl;
 IF v_d.tip='cuplare' THEN RETURN NULL; END IF;
 SELECT * INTO v_b FROM public.magazie_bucati WHERE id=coalesce(v_d.sursa_bucata_id,v_d.bucata_id)
  OR uid=coalesce(v_d.sursa_decl_uid,v_d.bucata_decl_uid);
 v_mm:=CASE WHEN v_d.tip='taiere' THEN (v_d.payload->>'baza_mm')::integer
  ELSE coalesce((v_d.payload#>>'{confirmare,masurata_mm}')::integer,(v_d.payload->>'lungime_masurata_mm')::integer) END;
 SELECT c.toleranta_mm INTO v_tol FROM public.fn_izo_proiect_config_citeste(v_d.proiect_id) c;
 IF v_mm IS NULL OR v_mm=v_b.lungime_mm THEN RETURN NULL; END IF;
 IF v_d.payload#>>'{confirmare,mod}' NOT IN ('marcaj_diferit','masurat') THEN RETURN NULL; END IF;
 IF v_d.payload#>>'{confirmare,mod}'='masurat' AND abs(v_mm-v_b.lungime_mm)<=v_tol THEN RETURN NULL; END IF;
 IF v_mm NOT BETWEEN 1 AND 30000 OR v_b.id IS NULL OR v_b.parinte_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.parinte_id=v_b.id)
  OR EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.radacina_id=v_b.id AND c.declaratie_id<>v_d.id AND c.stare<>'anulata') THEN
  RAISE EXCEPTION 'corectie_in_arbore'; END IF;
 RETURN v_mm;
END $f$;

CREATE FUNCTION public.fn_izo_corectie_fapt(p_bucata bigint,p_ref text,p_tronson bigint,p_autor uuid,p_dispozitiv text,p_motiv text,p_mm integer) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_b public.magazie_bucati; v_dupa public.magazie_bucati; v_ev public.magazie_bucati_evenimente;
 v_m public.magazie_bucati_miscari; v_ctx text; v_n bigint; v_now timestamptz:=clock_timestamp();
BEGIN
 IF current_user<>'izo_montaj_writer' OR p_mm NOT BETWEEN 1 AND 30000 OR length(btrim(coalesce(p_motiv,'')))<3 THEN RAISE EXCEPTION 'scriitor_invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE id=p_bucata FOR UPDATE;
 v_dupa:=v_b; v_dupa.updated_at:=v_now; v_dupa.server_ver:=nextval('public.izo_server_ver_seq');
 IF v_b.parinte_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.parinte_id=v_b.id)
  OR EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.radacina_id=v_b.id AND c.declaratie_id<>p_ref::bigint AND c.stare<>'anulata') THEN RAISE EXCEPTION 'corectie_in_arbore'; END IF;
 v_dupa.lungime_mm:=p_mm; v_dupa.lungime_masurata_mm:=p_mm; v_dupa.lungime_m:=p_mm/1000.0;
 v_dupa.lungime_originala_m:=p_mm/1000.0; v_dupa.lungime_cm:=round(p_mm::numeric/10)::integer;
 v_ctx:=concat_ws('|',txid_current()::text,'corectie',p_ref,v_b.proiect_id,p_tronson,v_dupa.server_ver,v_b.id);
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa),NULL);
 UPDATE public.magazie_bucati SET lungime_mm=v_dupa.lungime_mm,lungime_masurata_mm=v_dupa.lungime_masurata_mm,
  lungime_m=v_dupa.lungime_m,lungime_originala_m=v_dupa.lungime_originala_m,server_ver=v_dupa.server_ver,updated_at=v_now WHERE id=v_b.id;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 IF v_n<>1 THEN RAISE EXCEPTION 'bucata_schimbata'; END IF;
 IF to_jsonb(v_dupa) IS DISTINCT FROM (SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE b.id=v_b.id) THEN RAISE EXCEPTION 'reconciliere_bucata'; END IF;
 v_ev:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,jsonb_build_object(
  'tip','corectie','proiect_id',v_b.proiect_id,
  'document_tip','izo_declaratie','document_id',p_ref,
  'motiv',p_motiv,'declarat_de',p_autor,'aplicat_de',public.fn_izo_uid(),'aplicat_rol','izo_montaj_writer',
  'ora_server',v_now,'ora_tableta',NULL,'dispozitiv_id',p_dispozitiv,'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati_evenimente','rand',to_jsonb(v_ev)-'id'));
 INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,import_id,storno_de_eveniment_id,motiv,
  declarat_de,aplicat_de,aplicat_rol,ora_server,ora_tableta,dispozitiv_id,server_ver)
 VALUES(v_ev.tip,v_ev.proiect_id,v_ev.document_tip,v_ev.document_id,v_ev.import_id,v_ev.storno_de_eveniment_id,v_ev.motiv,
  v_ev.declarat_de,v_ev.aplicat_de,v_ev.aplicat_rol,v_ev.ora_server,v_ev.ora_tableta,v_ev.dispozitiv_id,v_ev.server_ver) RETURNING id INTO v_ev.id;
 v_m:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,jsonb_build_object('eveniment_id',v_ev.id,'proiect_id',v_b.proiect_id,
  'bucata_id',v_b.id,'rol','corectat','stare_inainte',v_b.stare,'stare_dupa',v_dupa.stare,
  'din_loc',jsonb_build_object('depozit_id',v_b.depozit_id,'tronson_id',v_b.tronson_id),
  'in_loc',jsonb_build_object('depozit_id',v_dupa.depozit_id,'tronson_id',v_dupa.tronson_id),
  'lungime_mm',v_dupa.lungime_mm,'inainte',to_jsonb(v_b),'dupa',to_jsonb(v_dupa),'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati_miscari','rand',to_jsonb(v_m)-'id'));
 INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,din_loc,in_loc,lungime_mm,inainte,dupa,server_ver)
 VALUES(v_m.eveniment_id,v_m.proiect_id,v_m.bucata_id,v_m.rol,v_m.stare_inainte,v_m.stare_dupa,v_m.din_loc,v_m.in_loc,
  v_m.lungime_mm,v_m.inainte,v_m.dupa,v_m.server_ver);
 PERFORM public.fn_izo_montaj_marcheaza(NULL,NULL,NULL,NULL);
 RETURN v_ev.id;
END $f$;
