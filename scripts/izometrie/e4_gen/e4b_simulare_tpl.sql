-- E4b-2b: read-only topological simulation. Virtual children are keyed by uid;
-- no sequence, table or reservation is changed until every row has passed.
CREATE FUNCTION public.fn_izo_lot_efecte(p_ids bigint[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_left bigint[]:=p_ids; v_done bigint[]:='{}'; v_order bigint[]:='{}';
 v_state jsonb:='{}'; v_d public.izo_declaratii; v_p public.izo_declaratii;
 v_b jsonb; v_c public.izo_bucati_declarate; v_uid uuid; v_root bigint;
 v_caps jsonb; v_cap record; v_cb jsonb; v_s public.izo_suduri; v_wait boolean; v_nc integer; v_target uuid;
 v_mm integer;
 v_progress boolean; v_sum bigint; v_count integer; v_dep bigint; v_res public.izo_rezervari; v_prev text;
BEGIN
 SELECT coalesce(jsonb_object_agg(c.id,to_jsonb(c)||jsonb_build_object('uid',coalesce(b.uid,c.bucata_decl_uid),'stare_sudura',s.stare)),'{}')
 INTO v_caps FROM public.izo_suduri_capete c JOIN public.izo_suduri s ON s.id=c.sudura_id
 LEFT JOIN public.magazie_bucati b ON b.id=c.bucata_id WHERE c.activ AND s.stare<>'anulata' AND s.proiect_id IN (SELECT d.proiect_id FROM public.izo_declaratii d WHERE d.id=ANY(p_ids));
 WHILE cardinality(v_left)>0 LOOP
  v_progress:=false;
  FOR v_d IN SELECT * FROM public.izo_declaratii WHERE id=ANY(v_left) ORDER BY id LOOP
   IF v_d.stare<>'trimisa' OR v_d.conflict_cod IS NOT NULL THEN RAISE EXCEPTION 'cas'; END IF;
   IF v_d.tip NOT IN ('taiere','montaj','cuplare') THEN RAISE EXCEPTION 'tip'; END IF;
   v_dep:=NULL;
   IF v_d.depinde_de_uid IS NOT NULL THEN
    SELECT * INTO v_p FROM public.izo_declaratii WHERE uid=v_d.depinde_de_uid;
    IF NOT FOUND OR v_p.versiune IS DISTINCT FROM v_d.depinde_de_versiune
     OR v_p.proiect_id<>v_d.proiect_id OR v_p.tronson_id<>v_d.tronson_id THEN RAISE EXCEPTION 'dependenta'; END IF;
    v_dep:=v_p.id;
    IF v_p.stare<>'aprobata' AND NOT v_p.id=ANY(v_done) THEN
     IF NOT v_p.id=ANY(p_ids) THEN RAISE EXCEPTION 'dependenta_lipsa'; END IF;
     CONTINUE;
    END IF;
   END IF;
   -- A weld waits for every endpoint's mount, including another session in this lot.
   SELECT * INTO v_s FROM public.izo_suduri WHERE declaratie_id=v_d.id AND stare='declarata';
   IF FOUND THEN
    v_wait:=false; v_nc:=0; v_target:=NULL;
    FOR v_cap IN SELECT key,value FROM jsonb_each(v_caps) WHERE (value->>'sudura_id')::bigint=v_s.id LOOP
     v_nc:=v_nc+1;
     IF v_target=(v_cap.value->>'uid')::uuid THEN RAISE EXCEPTION 'r4'; END IF;
     v_target:=(v_cap.value->>'uid')::uuid;
     v_cb:=v_state->(v_cap.value->>'uid');
     IF v_cb IS NULL THEN SELECT to_jsonb(b) INTO v_cb FROM public.magazie_bucati b WHERE b.uid=v_target; END IF;
     IF v_d.tip='montaj' AND (v_cb->>'id')::bigint=v_d.bucata_id OR v_d.tip='montaj' AND v_target=v_d.bucata_decl_uid THEN
      v_cb:=v_cb||'{"stare":"montata"}'::jsonb;
     END IF;
     IF v_cb IS NULL OR v_cb->>'stare'<>'montata' THEN
      IF EXISTS(SELECT 1 FROM public.izo_declaratii d LEFT JOIN public.magazie_bucati b ON b.id=d.bucata_id
       WHERE d.id=ANY(v_left) AND d.id<>v_d.id AND d.tip='montaj' AND coalesce(b.uid,d.bucata_decl_uid)=v_target) THEN
       v_wait:=true;
      ELSE RAISE EXCEPTION 'r4'; END IF;
     END IF;
     IF v_cb IS NOT NULL AND ((v_cb->>'proiect_id')::bigint IS DISTINCT FROM v_d.proiect_id
      OR (v_cb->>'tronson_id')::bigint IS DISTINCT FROM v_d.tronson_id
      OR v_cap.value->>'capat_litera' NOT IN (v_cb->>'capat_stanga',v_cb->>'capat_dreapta')) THEN RAISE EXCEPTION 'r4'; END IF;
    END LOOP;
    IF v_nc<>2 THEN RAISE EXCEPTION 'r4'; END IF;
    IF v_wait THEN CONTINUE; END IF;
   ELSIF v_d.payload ? 'sudura' OR v_d.tip='cuplare' THEN RAISE EXCEPTION 'r4'; END IF;
   IF v_d.tip<>'cuplare' THEN
   IF v_d.tip='montaj' AND v_d.identificare='nerezolvata' THEN RAISE EXCEPTION 'stare'; END IF;
   SELECT b.uid INTO v_uid FROM public.magazie_bucati b
    WHERE b.id=CASE WHEN v_d.tip='taiere' THEN v_d.sursa_bucata_id ELSE v_d.bucata_id END;
   v_uid:=coalesce(v_uid,CASE WHEN v_d.tip='taiere' THEN v_d.sursa_decl_uid ELSE v_d.bucata_decl_uid END);
   IF v_uid IS NULL THEN RAISE EXCEPTION 'stare'; END IF;
   v_b:=v_state->v_uid::text;
   IF v_b IS NULL THEN SELECT to_jsonb(b) INTO v_b FROM public.magazie_bucati b WHERE b.uid=v_uid; END IF;
   IF v_b IS NULL OR v_b->>'stare' NOT IN ('pe_tronson','montata') OR v_b->>'stare'='montata' AND v_d.tip<>'taiere' OR (v_b->>'tronson_id')::bigint IS DISTINCT FROM v_d.tronson_id
    OR (v_b->>'proiect_id')::bigint IS DISTINCT FROM v_d.proiect_id OR v_b->>'tip_cod' IS NULL
    THEN RAISE EXCEPTION 'stare'; END IF;
   IF v_b->>'executie_teava_id' IS NOT NULL THEN RAISE EXCEPTION 'bucata_in_pachet'; END IF;
   IF coalesce(v_d.sursa_decl_uid,v_d.bucata_decl_uid) IS NOT NULL THEN
    SELECT * INTO v_c FROM public.izo_bucati_declarate WHERE uid=v_uid;
    IF NOT FOUND OR v_c.declaratie_id IS DISTINCT FROM v_dep OR v_c.destinatie<>'montaj'
     OR v_c.stare NOT IN ('declarata','aprobata') THEN RAISE EXCEPTION 'dependenta'; END IF;
   END IF;
   v_root:=(v_b->>'radacina_id')::bigint;
   IF cardinality(public.fn_izo_pv_lipsa(ARRAY[v_root]))>0 THEN RAISE EXCEPTION 'fara_pv'; END IF;
   SELECT * INTO v_res FROM public.izo_rezervari r WHERE r.declaratie_id=v_d.id AND r.declaratie_versiune=v_d.versiune
    AND r.activa AND r.expira_dupa IS NULL AND (r.bucata_id=(v_b->>'id')::bigint OR r.bucata_decl_uid=v_uid);
   IF NOT FOUND THEN RAISE EXCEPTION 'rezervare_pierduta'; END IF;
   IF coalesce(v_d.payload#>>'{confirmare,mod}','') NOT IN ('marcaj','taiata','masurat','marcaj_diferit') THEN
    RAISE EXCEPTION 'lungime_neconfirmata'; END IF;
   IF v_d.payload#>>'{confirmare,mod}'='marcaj' AND (v_d.payload#>>'{confirmare,cm}')::integer
    IS DISTINCT FROM round((v_b->>'lungime_mm')::numeric/10)::integer%100 THEN RAISE EXCEPTION 'marcaj'; END IF;
   v_mm:=public.fn_izo_corectie_mm(v_d.id);
   IF v_mm IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.proiect_id=v_d.proiect_id AND b.uid<>v_uid
     AND b.stare NOT IN ('taiata','anulata') AND b.serie_canon=v_b->>'serie_canon' AND b.sarja IS NOT DISTINCT FROM v_b->>'sarja'
     AND b.lungime_cm=round(v_mm::numeric/10)::integer) THEN RAISE EXCEPTION 'r1d'; END IF;
    v_b:=v_b||jsonb_build_object('lungime_mm',v_mm);
   END IF;
   IF v_d.tip='montaj' THEN
    IF (v_d.payload->>'lungime_montata_mm')::integer IS DISTINCT FROM (v_b->>'lungime_mm')::integer THEN RAISE EXCEPTION 'stare'; END IF;
    v_state:=jsonb_set(v_state,ARRAY[v_uid::text],v_b||'{"stare":"montata"}');
   ELSE
    IF v_b->>'executie_teava_id' IS NOT NULL THEN RAISE EXCEPTION 'bucata_in_pachet'; END IF;
    IF v_b->>'stare'='montata' THEN
     SELECT count(*) INTO v_nc FROM jsonb_each(v_caps) x WHERE x.value->>'uid'=v_uid::text AND x.value->>'stare_sudura'='aprobata';
     IF v_nc NOT IN (1,2) THEN RAISE EXCEPTION 'ramura_neacoperita'; END IF;
     IF (SELECT count(*) FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.stare='declarata')<>v_nc+1
      OR (SELECT count(*) FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.stare='declarata' AND c.destinatie='ramane_montat')<>v_nc
      OR (SELECT count(*) FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.stare='declarata' AND c.destinatie='depozit')<>1 THEN RAISE EXCEPTION 'ramura_gresita'; END IF;
    END IF;
    IF v_b->>'tip_cod'<>'teava' THEN RAISE EXCEPTION 'tip_taiere'; END IF;
    IF (v_d.payload->>'baza_mm')::integer IS DISTINCT FROM (v_b->>'lungime_mm')::integer THEN
     RAISE EXCEPTION 'necesita_corectie'; END IF;
    SELECT sum(c.lungime_mm),count(*) INTO v_sum,v_count FROM public.izo_bucati_declarate c
     WHERE c.declaratie_id=v_d.id AND c.declaratie_versiune=v_d.versiune AND c.stare='declarata';
    IF v_count NOT BETWEEN 2 AND 3 OR v_sum IS DISTINCT FROM (v_b->>'lungime_mm')::bigint THEN RAISE EXCEPTION 'r3'; END IF;
    v_state:=jsonb_set(v_state,ARRAY[v_uid::text],v_b||'{"stare":"taiata"}');
    v_prev:=v_b->>'capat_stanga';
    FOR v_c IN SELECT * FROM public.izo_bucati_declarate WHERE declaratie_id=v_d.id AND stare='declarata' ORDER BY cod_bucata LOOP
     IF v_c.declaratie_versiune<>v_d.versiune OR v_c.radacina_id<>v_root OR v_c.capat_stanga IS DISTINCT FROM v_prev
      OR v_c.cod_bucata IS DISTINCT FROM v_c.capat_stanga||v_c.capat_dreapta THEN RAISE EXCEPTION 'geometrie'; END IF;
     v_prev:=v_c.capat_dreapta;
     IF v_c.destinatie NOT IN ('montaj','ramane_montat','depozit') OR v_c.destinatie='ramane_montat' AND v_b->>'stare'<>'montata' THEN RAISE EXCEPTION 'ramura_neacoperita'; END IF;
     IF v_c.destinatie='depozit' AND NOT EXISTS(SELECT 1 FROM public.logistica_depozite dep
      JOIN public.executie_proiecte pr ON pr.site_id=dep.site_id WHERE pr.id=v_d.proiect_id AND dep.activ
       AND dep.id=coalesce(v_c.depozit_destinatie_id,(v_b#>>'{atribute,depozit_origine_id}')::integer)) THEN RAISE EXCEPTION 'depozit_invalid'; END IF;
     IF EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.proiect_id=v_d.proiect_id AND b.uid<>v_uid
      AND coalesce(v_state->b.uid::text->>'stare',b.stare) NOT IN ('taiata','anulata')
      AND b.serie_canon=v_b->>'serie_canon' AND b.sarja IS NOT DISTINCT FROM v_b->>'sarja'
      AND b.lungime_cm=round(v_c.lungime_mm::numeric/10)::integer)
      OR EXISTS(SELECT 1 FROM jsonb_each(v_state) x WHERE x.key<>v_uid::text AND x.value->>'stare' NOT IN ('taiata','anulata')
       AND x.value->>'serie_canon'=v_b->>'serie_canon' AND x.value->>'sarja' IS NOT DISTINCT FROM v_b->>'sarja'
       AND round((x.value->>'lungime_mm')::numeric/10)=round(v_c.lungime_mm::numeric/10))
      OR EXISTS(SELECT 1 FROM public.izo_bucati_declarate c JOIN public.magazie_bucati root ON root.id=c.radacina_id
       WHERE c.stare='declarata' AND c.declaratie_id<>v_d.id AND c.uid<>v_uid
        AND root.serie_canon=v_b->>'serie_canon' AND root.sarja IS NOT DISTINCT FROM v_b->>'sarja'
        AND round(c.lungime_mm::numeric/10)=round(v_c.lungime_mm::numeric/10)) THEN RAISE EXCEPTION 'r1d'; END IF;
     v_state:=jsonb_set(v_state,ARRAY[v_c.uid::text],v_b||jsonb_build_object('id',NULL,'uid',v_c.uid,
      'capat_stanga',v_c.capat_stanga,'capat_dreapta',v_c.capat_dreapta,'cod_bucata',v_c.cod_bucata,
      'lungime_mm',v_c.lungime_mm,'stare',CASE WHEN v_c.destinatie='montaj' THEN 'pe_tronson' WHEN v_c.destinatie='ramane_montat' THEN 'montata' ELSE 'in_tranzit' END));
    END LOOP;
    IF v_b->>'stare'='montata' THEN
     FOR v_cap IN SELECT key,value FROM jsonb_each(v_caps) WHERE value->>'uid'=v_uid::text LOOP
      SELECT c.uid INTO v_target FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.stare='declarata'
       AND c.destinatie='ramane_montat' AND v_cap.value->>'capat_litera' IN (c.capat_stanga,c.capat_dreapta);
      IF NOT FOUND THEN RAISE EXCEPTION 'ramura_gresita'; END IF;
      v_caps:=jsonb_set(v_caps,ARRAY[v_cap.key],v_cap.value||jsonb_build_object('uid',v_target));
     END LOOP;
     IF EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.stare='declarata'
      AND c.destinatie='ramane_montat' AND NOT EXISTS(SELECT 1 FROM jsonb_each(v_caps) x WHERE x.value->>'uid'=c.uid::text)) THEN RAISE EXCEPTION 'ramura_gresita'; END IF;
     IF EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.stare='declarata'
      AND c.destinatie='ramane_montat' AND NOT EXISTS(SELECT 1 FROM public.izo_rezervari r WHERE r.bucata_decl_uid=c.uid
       AND r.declaratie_id=v_d.id AND r.declaratie_versiune=v_d.versiune AND r.activa AND r.expira_dupa IS NULL)) THEN RAISE EXCEPTION 'rezervare_pierduta'; END IF;
    END IF;
    IF v_prev IS DISTINCT FROM v_b->>'capat_dreapta' THEN RAISE EXCEPTION 'geometrie'; END IF;
   END IF;
   END IF; -- non-coupling
   IF v_s.id IS NOT NULL THEN
    FOR v_cap IN SELECT key,value FROM jsonb_each(v_caps) WHERE (value->>'sudura_id')::bigint=v_s.id LOOP
     v_caps:=jsonb_set(v_caps,ARRAY[v_cap.key],v_cap.value||'{"stare_sudura":"aprobata"}'::jsonb);
    END LOOP;
   END IF;
   v_done:=array_append(v_done,v_d.id); v_order:=array_append(v_order,v_d.id);
   v_left:=array_remove(v_left,v_d.id); v_progress:=true;
  END LOOP;
  IF NOT v_progress THEN RAISE EXCEPTION 'ciclu'; END IF;
 END LOOP;
 RETURN jsonb_build_object('ordine',to_jsonb(v_order),'bucati',v_state,'capete',v_caps);
END $f$;

-- Only exact snapshots enter the existing registry guards, as the real writer.
CREATE FUNCTION public.fn_izo_taiere_fapt(p_decl bigint) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_b public.magazie_bucati; v_after public.magazie_bucati;
 v_child public.magazie_bucati; v_c public.izo_bucati_declarate; v_r public.izo_rezervari;
 v_ev public.magazie_bucati_evenimente; v_m public.magazie_bucati_miscari; v_ctx text; v_n bigint; v_expected jsonb;
BEGIN
 IF current_user<>'izo_montaj_writer' THEN RAISE EXCEPTION 'scriitor_invalid'; END IF;
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE id=p_decl;
 SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE id=v_d.sursa_bucata_id OR uid=v_d.sursa_decl_uid;
 IF v_b.stare NOT IN ('pe_tronson','montata') OR v_b.executie_teava_id IS NOT NULL THEN RAISE EXCEPTION 'stare'; END IF;
 v_after:=v_b; v_after.stare:='taiata'; v_after.server_ver:=nextval('public.izo_server_ver_seq'); v_after.updated_at:=clock_timestamp();
 v_ctx:=concat_ws('|',txid_current()::text,'taiere',p_decl,v_b.proiect_id,v_d.tronson_id,v_after.server_ver,v_b.id);
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_after),NULL);
 UPDATE public.magazie_bucati SET stare=v_after.stare,server_ver=v_after.server_ver,updated_at=v_after.updated_at WHERE id=v_b.id;
 GET DIAGNOSTICS v_n=ROW_COUNT; IF v_n<>1 THEN RAISE EXCEPTION 'bucata_schimbata'; END IF;
 IF to_jsonb(v_after) IS DISTINCT FROM (SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE b.id=v_b.id) THEN RAISE EXCEPTION 'reconciliere_bucata'; END IF;
 v_ev:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,jsonb_build_object('tip','taiere','proiect_id',v_d.proiect_id,
  'document_tip','izo_declaratie','document_id',p_decl::text,'declarat_de',v_d.declarat_de,'aplicat_de',public.fn_izo_uid(),
  'aplicat_rol','izo_montaj_writer','ora_server',clock_timestamp(),'dispozitiv_id',v_d.dispozitiv_id::text,'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati_evenimente','rand',to_jsonb(v_ev)-'id'));
 INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,declarat_de,aplicat_de,aplicat_rol,ora_server,dispozitiv_id,server_ver)
 VALUES(v_ev.tip,v_ev.proiect_id,v_ev.document_tip,v_ev.document_id,v_ev.declarat_de,v_ev.aplicat_de,v_ev.aplicat_rol,v_ev.ora_server,v_ev.dispozitiv_id,v_ev.server_ver) RETURNING id INTO v_ev.id;
 PERFORM public.fn_izo_taiere_miscare(v_ctx,v_ev.id,'consumat',to_jsonb(v_b),to_jsonb(v_after));
 FOR v_c IN SELECT * FROM public.izo_bucati_declarate WHERE declaratie_id=v_d.id AND stare='declarata' ORDER BY cod_bucata LOOP
  v_child:=v_b; v_child.id:=nextval('public.magazie_bucati_id_seq'); v_child.uid:=v_c.uid; v_child.parinte_id:=v_b.id;
  v_child.cod_bucata:=v_c.cod_bucata; v_child.capat_stanga:=v_c.capat_stanga; v_child.capat_dreapta:=v_c.capat_dreapta;
  v_child.lungime_mm:=v_c.lungime_mm; v_child.lungime_m:=v_c.lungime_mm/1000.0; v_child.lungime_originala_m:=v_child.lungime_m;
  v_child.lungime_calculata:=v_c.lungime_calculata; v_child.lungime_aviz_mm:=NULL; v_child.lungime_masurata_mm:=NULL;
  v_child.aviz_intrare_id:=NULL; v_child.nr_crt_aviz:=NULL; v_child.executie_teava_id:=NULL;
  v_child.server_ver:=nextval('public.izo_server_ver_seq'); v_child.created_at:=now(); v_child.updated_at:=now();
  v_child.stare:=CASE WHEN v_c.destinatie='montaj' THEN 'pe_tronson' WHEN v_c.destinatie='ramane_montat' THEN 'montata' ELSE 'in_tranzit' END;
  -- In transit remains on the tronson; destination is metadata until depot receipt.
  v_child.atribute:=coalesce(v_b.atribute,'{}');
  IF v_c.destinatie='depozit' THEN
   v_child.atribute:=v_child.atribute||jsonb_build_object('destinatie_depozit_id',coalesce(v_c.depozit_destinatie_id,(v_b.atribute->>'depozit_origine_id')::integer));
  END IF;
  v_child.serie_canon:=NULL; v_child.lungime_cm:=NULL;
  v_expected:=to_jsonb(v_child)-ARRAY['serie_canon','lungime_cm'];
  PERFORM public.fn_izo_montaj_marcheaza(v_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati','rand',to_jsonb(v_child)));
  INSERT INTO public.magazie_bucati(@@CUT_COLS@@) VALUES(@@CUT_VALUES@@);
  SELECT * INTO STRICT v_child FROM public.magazie_bucati WHERE id=v_child.id;
  IF (to_jsonb(v_child)-ARRAY['serie_canon','lungime_cm']) IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'reconciliere_copil'; END IF;
  PERFORM public.fn_izo_taiere_miscare(v_ctx,v_ev.id,'nascut',NULL,to_jsonb(v_child));
  IF v_c.destinatie='ramane_montat' THEN
   PERFORM public.fn_izo_capete_muta(v_b.id,v_child.id,v_ev.id);
  END IF;
  UPDATE public.izo_bucati_declarate SET stare='aprobata',bucata_id=v_child.id,server_ver=nextval('public.izo_server_ver_seq') WHERE uid=v_c.uid;
  FOR v_r IN SELECT * FROM public.izo_rezervari WHERE bucata_decl_uid=v_c.uid AND activa ORDER BY id LOOP
   IF v_c.destinatie='ramane_montat' AND v_r.declaratie_id=v_d.id THEN
    UPDATE public.izo_rezervari SET activa=false,eliberata_la=clock_timestamp(),motiv_eliberare='consumata',eveniment_id=v_ev.id,
     server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_r.id;
    CONTINUE;
   END IF;
   UPDATE public.izo_rezervari SET activa=false,eliberata_la=clock_timestamp(),motiv_eliberare='transferata',eveniment_id=v_ev.id,
    server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_r.id;
   INSERT INTO public.izo_rezervari(proiect_id,tronson_id,declaratie_id,declaratie_versiune,autor_profile_id,bucata_id,din_depozit,expira_dupa,transfer_din_id)
   VALUES(v_r.proiect_id,v_r.tronson_id,v_r.declaratie_id,v_r.declaratie_versiune,v_r.autor_profile_id,v_child.id,false,v_r.expira_dupa,v_r.id);
  END LOOP;
 END LOOP;
 PERFORM public.fn_izo_montaj_marcheaza(NULL,NULL,NULL,NULL);
 RETURN v_ev.id;
END $f$;

CREATE FUNCTION public.fn_izo_taiere_miscare(p_ctx text,p_ev bigint,p_rol text,p_before jsonb,p_after jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_m public.magazie_bucati_miscari;
BEGIN
 v_m:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,jsonb_build_object('eveniment_id',p_ev,
  'proiect_id',p_after->'proiect_id','bucata_id',p_after->'id','rol',p_rol,'stare_inainte',p_before->'stare',
  'stare_dupa',p_after->'stare','din_loc',CASE WHEN p_before IS NOT NULL THEN jsonb_build_object('depozit_id',p_before->'depozit_id','tronson_id',p_before->'tronson_id') END,
  'in_loc',jsonb_build_object('depozit_id',p_after->'depozit_id','tronson_id',p_after->'tronson_id'),
  'lungime_mm',p_after->'lungime_mm','inainte',p_before,'dupa',p_after,'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_montaj_marcheaza(p_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati_miscari','rand',to_jsonb(v_m)-'id'));
 INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,din_loc,in_loc,lungime_mm,inainte,dupa,server_ver)
 VALUES(v_m.eveniment_id,v_m.proiect_id,v_m.bucata_id,v_m.rol,v_m.stare_inainte,v_m.stare_dupa,v_m.din_loc,v_m.in_loc,v_m.lungime_mm,v_m.inainte,v_m.dupa,v_m.server_ver);
END $f$;
