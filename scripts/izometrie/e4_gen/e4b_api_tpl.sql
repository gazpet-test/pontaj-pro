-- Helpers are private. Only the three thin entry points are executable by API.
CREATE FUNCTION public.fn_izo_teren_autorizat(p_proiect bigint,p_lock boolean) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid:=public.fn_izo_uid(); v_emp bigint; v_owner boolean;
BEGIN
 IF p_lock THEN
  SELECT employee_id,is_owner INTO v_emp,v_owner FROM public.profiles WHERE id=v_uid FOR SHARE;
 ELSE SELECT employee_id,is_owner INTO v_emp,v_owner FROM public.profiles WHERE id=v_uid; END IF;
 IF v_emp IS NULL THEN RETURN NULL; END IF;
 IF v_owner THEN RETURN v_emp; END IF;
 IF p_lock THEN
  PERFORM 1 FROM public.user_module_access WHERE profile_id=v_uid AND module='executie.izometrie'
   AND access_level IN ('editor','admin') ORDER BY id FOR SHARE;
 ELSE
  PERFORM 1 FROM public.user_module_access WHERE profile_id=v_uid AND module='executie.izometrie' AND access_level IN ('editor','admin');
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p_lock THEN
  PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=v_uid AND proiect_id=p_proiect AND activ
   AND rol='inginer_izometrie' AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date) ORDER BY id FOR SHARE;
 ELSE
  PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=v_uid AND proiect_id=p_proiect AND activ
   AND rol='inginer_izometrie' AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date);
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN v_emp;
END $f$;

CREATE FUNCTION public.fn_izo_teren_entra(p_proiect bigint,p_functie text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer; v_lipsa text[];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 IF session_user<>'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' OR public.fn_izo_uid() IS NULL THEN RETURN 'fara_drept'; END IF;
 IF coalesce(current_setting('izo.montaj_ctx',true),'')<>'' OR coalesce(current_setting('izo.receptie_ctx',true),'')<>''
  OR coalesce(current_setting('izo.registru_tx',true),'')<>'' THEN RETURN 'fara_drept'; END IF;
 IF public.fn_izo_teren_autorizat(p_proiect,false) IS NULL THEN RETURN 'fara_drept'; END IF;
 INSERT INTO public.izo_rata_apeluri(profile_id,functie,fereastra_de_la,n) VALUES(public.fn_izo_uid(),p_functie,date_trunc('minute',clock_timestamp()),1)
 ON CONFLICT(profile_id,functie) DO UPDATE SET
 n=CASE WHEN izo_rata_apeluri.fereastra_de_la=excluded.fereastra_de_la THEN izo_rata_apeluri.n+1 ELSE 1 END,
 fereastra_de_la=excluded.fereastra_de_la RETURNING n INTO v_n;
 IF v_n>30 THEN RETURN 'limita'; END IF;
 v_lipsa:=public.fn_izo_porti_lipsa();
 IF cardinality(v_lipsa)>0 THEN RAISE EXCEPTION 'E4b porti: %',v_lipsa; END IF;
 RETURN NULL;
END $f$;

CREATE FUNCTION public.fn_izo_pv_lipsa(p_radacini bigint[]) RETURNS bigint[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT coalesce(array_agg(b.id ORDER BY b.id),'{}'::bigint[]) FROM public.magazie_bucati b
 WHERE b.id=ANY(p_radacini) AND b.aviz_intrare_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id=b.aviz_intrare_id AND d.eveniment_pv_id IS NOT NULL)
$f$;

CREATE FUNCTION public.fn_izo_teren_snapshot(p_proiect bigint,p_tronson bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_doc jsonb;
BEGIN
 IF NOT public.fn_izo_citire(p_proiect) OR NOT EXISTS(SELECT 1 FROM public.executie_tronsoane WHERE id=p_tronson AND proiect_id=p_proiect) THEN
  RETURN jsonb_build_object('cod','fara_drept'); END IF;
 -- One statement / one MVCC snapshot, including all mutable rows (never max(id)).
 WITH frunze AS (
  SELECT b.id,b.uid,b.serie,b.serie_canon,b.sarja,b.lungime_mm,b.lungime_cm,b.perete_mm,b.tip_cod,b.stare,b.tronson_id,b.depozit_id,b.server_ver,
   EXISTS(SELECT 1 FROM public.izo_rezervari r WHERE r.bucata_id=b.id AND r.activa AND (r.expira_dupa IS NULL OR r.expira_dupa>now())) rezervata,
   (SELECT r.tronson_id FROM public.izo_rezervari r WHERE r.bucata_id=b.id AND r.activa AND (r.expira_dupa IS NULL OR r.expira_dupa>now())) rezervata_tronson,
   cardinality(public.fn_izo_pv_lipsa(ARRAY[coalesce(b.radacina_id,b.id)]))>0 fara_pv
  FROM public.magazie_bucati b WHERE b.proiect_id=p_proiect AND b.tip_cod IS NOT NULL AND b.stare NOT IN ('taiata','anulata')
   AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati c WHERE c.parinte_id=b.id AND c.stare<>'anulata')
 ), proprii AS (
  SELECT d.*, (d.identificare IS DISTINCT FROM 'nerezolvata' AND d.tip<>'cuplare' AND NOT EXISTS
   (SELECT 1 FROM public.izo_rezervari r WHERE r.declaratie_id=d.id AND r.activa AND (r.expira_dupa IS NULL OR r.expira_dupa>now()))) rezervare_pierduta
  FROM public.izo_declaratii d WHERE d.proiect_id=p_proiect AND d.tronson_id=p_tronson AND d.declarat_de=public.fn_izo_uid()
   AND d.stare NOT IN ('aprobata','respinsa','stearsa')
 )
 SELECT jsonb_build_object('proiect_id',p_proiect,'tronson_id',p_tronson,
 'frunze',coalesce((SELECT jsonb_agg(to_jsonb(f)||jsonb_build_object('disponibila',NOT rezervata AND NOT fara_pv AND
  (stare='pe_tronson' AND tronson_id=p_tronson OR stare IN ('sosit','receptionat','retur') AND depozit_id IS NOT NULL)) ORDER BY f.id) FROM frunze f),'[]'::jsonb),
 'suduri',coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('capete',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.izo_suduri_capete c WHERE c.sudura_id=s.id AND c.activ)) ORDER BY s.id) FROM public.izo_suduri s WHERE s.proiect_id=p_proiect AND s.tronson_id=p_tronson),'[]'::jsonb),'numar_urmator',(SELECT CASE WHEN cfg.sens_numerotare='descrescator' THEN nullif(greatest(coalesce((SELECT min(w.nr)-1 FROM public.izo_suduri w WHERE w.tronson_id=p_tronson AND w.stare<>'anulata'),cfg.nr_sudura_start),0),0) ELSE coalesce((SELECT max(w.nr)+1 FROM public.izo_suduri w WHERE w.tronson_id=p_tronson AND w.stare<>'anulata'),1) END FROM public.izo_tronson_config cfg WHERE cfg.tronson_id=p_tronson),
 'config',(SELECT to_jsonb(c) FROM public.izo_tronson_config c WHERE tronson_id=p_tronson),
 'praguri',(SELECT to_jsonb(c)-ARRAY['modificat_de','modificat_la'] FROM public.izo_proiect_config c WHERE proiect_id=p_proiect),
 'declaratii',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM proprii d),'[]'::jsonb),
 'bucati_declarate',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.uid) FROM public.izo_bucati_declarate c JOIN proprii d ON d.id=c.declaratie_id),'[]'::jsonb),
 'lanturi',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM frunze f WHERE stare='montata' AND tronson_id=p_tronson),'[]'::jsonb),
 'tombstone',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'uid',b.uid,'stare',b.stare,'server_ver',b.server_ver) ORDER BY b.id)
  FROM public.magazie_bucati b WHERE b.proiect_id=p_proiect AND b.tip_cod IS NOT NULL AND b.stare IN ('taiata','anulata')),'[]'::jsonb),
 'server_ver_max',greatest(coalesce((SELECT max(server_ver) FROM public.magazie_bucati WHERE proiect_id=p_proiect),0),
 coalesce((SELECT max(server_ver) FROM public.izo_declaratii WHERE proiect_id=p_proiect),0),
 coalesce((SELECT max(server_ver) FROM public.izo_rezervari WHERE proiect_id=p_proiect),0),
 coalesce((SELECT max(server_ver) FROM public.izo_suduri WHERE proiect_id=p_proiect),0),
 coalesce((SELECT max(c.server_ver) FROM public.izo_suduri_capete c JOIN public.izo_suduri w ON w.id=c.sudura_id WHERE w.proiect_id=p_proiect),0),
 coalesce((SELECT server_ver FROM public.izo_tronson_config WHERE tronson_id=p_tronson),0))) INTO v_doc;
 RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'checksum',encode(sha256(convert_to(v_doc::text,'UTF8')),'hex')) || v_doc;
END $f$;

CREATE FUNCTION public.fn_izo_teren_intern(p_proiect bigint,p_tronson bigint,p_dispozitiv uuid,p_pregateste boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_cod text; v_f public.izo_fronturi; v_owner uuid;
BEGIN
 v_cod:=public.fn_izo_teren_entra(p_proiect,CASE WHEN p_pregateste THEN 'pregateste' ELSE 'instantaneu' END);
 IF v_cod IS NOT NULL THEN RETURN jsonb_build_object('cod',v_cod); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.executie_tronsoane WHERE id=p_tronson AND proiect_id=p_proiect) THEN RETURN jsonb_build_object('cod','fara_drept'); END IF;
 IF p_pregateste THEN
  BEGIN
  IF p_dispozitiv IS NULL THEN RETURN jsonb_build_object('cod','eroare'); END IF;
  -- Tronson-scoped front arbitration. No project advisory (activation order §10.5).
  INSERT INTO public.izo_dispozitive(dispozitiv_id,profile_id) VALUES(p_dispozitiv,public.fn_izo_uid()) ON CONFLICT DO NOTHING;
  SELECT profile_id INTO v_owner FROM public.izo_dispozitive WHERE dispozitiv_id=p_dispozitiv;
  IF v_owner IS DISTINCT FROM public.fn_izo_uid() THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='IZ004'; END IF;
  INSERT INTO public.izo_fronturi(proiect_id,tronson_id,profile_id,dispozitiv_id,expira_la)
   VALUES(p_proiect,p_tronson,public.fn_izo_uid(),p_dispozitiv,now()+interval '12 hours') ON CONFLICT DO NOTHING;
  SELECT * INTO v_f FROM public.izo_fronturi WHERE tronson_id=p_tronson AND activ FOR UPDATE;
  IF v_f.profile_id<>public.fn_izo_uid() OR v_f.dispozitiv_id<>p_dispozitiv THEN RAISE EXCEPTION 'alt_dispozitiv' USING ERRCODE='IZ004'; END IF;
  IF public.fn_izo_teren_autorizat(p_proiect,true) IS NULL THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='IZ004'; END IF;
  PERFORM public.fn_izo_config_blocheaza(p_tronson);
  IF NOT EXISTS(SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=p_tronson AND flux_montaj)
   OR coalesce(public.fn_izo_nivel(p_proiect),'off') NOT IN ('stoc','montaj') THEN RAISE EXCEPTION 'flux_inactiv'; END IF;
  PERFORM public.fn_izo_teren_radacini_blocheaza(p_proiect,false);
  UPDATE public.izo_fronturi SET expira_la=now()+interval '12 hours',server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_f.id;
   UPDATE public.izo_rezervari SET expira_dupa=now()+interval '36 hours',server_ver=nextval('public.izo_server_ver_seq')
   WHERE autor_profile_id=public.fn_izo_uid() AND tronson_id=p_tronson AND activa AND expira_dupa IS NOT NULL;
  EXCEPTION WHEN SQLSTATE 'IZ004' THEN RETURN jsonb_build_object('cod',SQLERRM); END;
 ELSE
  IF public.fn_izo_teren_autorizat(p_proiect,true) IS NULL THEN RETURN jsonb_build_object('cod','fara_drept'); END IF;
 END IF;
 RETURN public.fn_izo_teren_snapshot(p_proiect,p_tronson);
END $f$;

CREATE FUNCTION public.fn_izo_teren_instantaneu(p_proiect bigint,p_tronson bigint) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_teren_intern(p_proiect,p_tronson,NULL,false)
$f$;

CREATE FUNCTION public.fn_izo_teren_payload(p_payload jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_p jsonb:=p_payload-'gps'; v_key text; v_allowed text[];
BEGIN
 IF jsonb_typeof(v_p) IS DISTINCT FROM 'object' OR v_p-ARRAY['proiect_id','tronson_id','uid','preverificare_uid','versiune_baza','tip',
 'zi','bucata','sursa','baza_mm','puncte_mm','copii','confirmare','capat_amonte','amonte','sudura','capat1','capat2','lungime_montata_mm',
 'depinde_de_uid','depinde_de_versiune','serie_bruta','sarja_declarata','perete_declarat','lungime_masurata_mm',
 'ultimele3_reconfirmate','km_propus_m','executant','poanson','data_montaj','randuri']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'payload' USING ERRCODE='IZ001'; END IF;
 IF jsonb_path_exists(v_p,'$.**.gps') OR jsonb_path_exists(v_p,'$.**.lat') OR jsonb_path_exists(v_p,'$.**.lon') THEN
  RAISE EXCEPTION 'gps_nested' USING ERRCODE='IZ001'; END IF;
 FOREACH v_key IN ARRAY ARRAY['bucata','sursa','confirmare','amonte','sudura','capat1','capat2'] LOOP
  IF v_p ? v_key THEN
   v_allowed:=CASE v_key WHEN 'bucata' THEN ARRAY['bucata_id','decl_uid'] WHEN 'sursa' THEN ARRAY['bucata_id','decl_uid']
    WHEN 'capat1' THEN ARRAY['bucata_id','decl_uid','capat'] WHEN 'capat2' THEN ARRAY['bucata_id','decl_uid','capat']
     WHEN 'confirmare' THEN ARRAY['mod','cm','la','masurata_mm'] WHEN 'amonte' THEN ARRAY['tip','bucata_id','decl_uid','capat']
    ELSE ARRAY['nr','sufix'] END;
   IF jsonb_typeof(v_p->v_key)<>'object' OR (v_p->v_key)-v_allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'payload_nested' USING ERRCODE='IZ001'; END IF;
  END IF;
 END LOOP;
 IF v_p ? 'copii' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_p->'copii') c WHERE
  jsonb_typeof(c)<>'object' OR c-ARRAY['uid','lungime_mm','destinatie','depozit_destinatie_id','calculata']<>'{}'::jsonb) THEN
  RAISE EXCEPTION 'copii_payload' USING ERRCODE='IZ001'; END IF;
 IF v_p ? 'randuri' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_p->'randuri') c WHERE
  jsonb_typeof(c)<>'object' OR c-ARRAY['uid','versiune']<>'{}'::jsonb) THEN RAISE EXCEPTION 'randuri_payload' USING ERRCODE='IZ001'; END IF;
 RETURN v_p;
END $f$;

CREATE FUNCTION public.fn_izo_teren_op(p_dispozitiv uuid,p_op jsonb,p_payload jsonb,p_emp bigint,p_hash text,p_front public.izo_fronturi) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_s public.izo_preverificari; v_d public.izo_declaratii; v_b public.magazie_bucati;
 v_c public.izo_bucati_declarate; v_cfg public.izo_proiect_config;
 v_uid uuid:=public.fn_izo_uid(); v_type text:=p_op->>'tip_op'; v_id uuid:=(p_op->>'op_id')::uuid;
 v_p jsonb:=p_payload; v_ref jsonb; v_child jsonb; v_source bigint; v_decl uuid; v_root bigint;
 v_len integer; v_base integer; v_sum integer; v_n integer; v_i integer; v_letter integer; v_points integer[];
 v_code text; v_left text; v_right text; v_prev text; v_state text:='ciorna'; v_ident text;
 v_conflict text; v_date date; v_json jsonb; v_response jsonb; v_gps jsonb; v_affected bigint;
BEGIN
 IF (p_op->>'versiune_format')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'versiune_format' USING ERRCODE='IZ001'; END IF;
 IF v_type='sesiune_deschide' THEN
  SELECT * INTO v_s FROM public.izo_preverificari WHERE uid=(v_p->>'uid')::uuid;
  IF FOUND THEN
   IF v_s.autor_profile_id<>v_uid OR v_s.proiect_id<>p_front.proiect_id OR v_s.tronson_id<>p_front.tronson_id THEN
    RAISE EXCEPTION 'ref_alt_autor' USING ERRCODE='IZ001'; END IF;
   RETURN jsonb_build_object('cod','acceptat','sesiune_id',v_s.id,'versiune',v_s.versiune);
  END IF;
  IF (v_p->>'zi')::date IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'zi' USING ERRCODE='IZ001'; END IF;
  INSERT INTO public.izo_preverificari(uid,proiect_id,tronson_id,autor_profile_id,dispozitiv_id)
   VALUES((v_p->>'uid')::uuid,p_front.proiect_id,p_front.tronson_id,v_uid,p_dispozitiv) RETURNING * INTO v_s;
  RETURN jsonb_build_object('cod','acceptat','sesiune_id',v_s.id,'versiune',v_s.versiune);
 END IF;
 SELECT * INTO v_s FROM public.izo_preverificari WHERE uid=(v_p->>'preverificare_uid')::uuid;
 IF NOT FOUND OR v_s.autor_profile_id<>v_uid OR v_s.proiect_id<>p_front.proiect_id OR v_s.tronson_id<>p_front.tronson_id THEN
  RAISE EXCEPTION 'ref_alt_autor' USING ERRCODE='IZ001'; END IF;
 IF v_s.stare<>'deschisa' AND NOT (v_s.stare='trimisa' AND v_type='decl_salveaza') THEN RAISE EXCEPTION 'sesiune_stare' USING ERRCODE='IZ002'; END IF;
 IF v_type='sesiune_trimite' THEN
  IF EXISTS(SELECT 1 FROM public.izo_suduri w JOIN public.izo_declaratii d ON d.id=w.declaratie_id
   WHERE d.preverificare_id=v_s.id AND w.stare='declarata'
    AND (SELECT count(*) FROM public.izo_suduri_capete c WHERE c.sudura_id=w.id AND c.activ)<>2) THEN
   RAISE EXCEPTION 'r4' USING ERRCODE='IZ002'; END IF;
  IF EXISTS(SELECT 1 FROM public.izo_declaratii WHERE preverificare_id=v_s.id AND stare IN ('conflict','blocata','revizie_ceruta')) THEN
   RAISE EXCEPTION 'rand_blocant' USING ERRCODE='IZ002'; END IF;
  IF (SELECT coalesce(jsonb_agg(jsonb_build_object('uid',uid,'versiune',versiune) ORDER BY uid),'[]'::jsonb)
    FROM public.izo_declaratii WHERE preverificare_id=v_s.id AND stare='ciorna') IS DISTINCT FROM
   (SELECT coalesce(jsonb_agg(x ORDER BY x->>'uid'),'[]'::jsonb) FROM jsonb_array_elements(v_p->'randuri') x) THEN
   RAISE EXCEPTION 'cas' USING ERRCODE='IZ002'; END IF;
  IF EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE preverificare_id=v_s.id AND stare='ciorna' AND tip<>'cuplare' AND identificare IS DISTINCT FROM 'nerezolvata'
   AND NOT EXISTS(SELECT 1 FROM public.izo_rezervari r WHERE r.declaratie_id=d.id AND r.activa AND (r.expira_dupa IS NULL OR r.expira_dupa>now()))) THEN
   RAISE EXCEPTION 'rezervare_pierduta' USING ERRCODE='IZ002'; END IF;
  UPDATE public.izo_declaratii SET stare=CASE WHEN identificare='nerezolvata' THEN 'in_verificare' ELSE 'trimisa' END,
   server_ver=nextval('public.izo_server_ver_seq') WHERE preverificare_id=v_s.id AND stare='ciorna';
  UPDATE public.izo_rezervari SET expira_dupa=NULL,server_ver=nextval('public.izo_server_ver_seq') WHERE activa
   AND declaratie_id IN (SELECT id FROM public.izo_declaratii WHERE preverificare_id=v_s.id);
  UPDATE public.izo_preverificari SET stare='trimisa',trimisa_la=now(),trimisa_op_id=v_id,versiune=versiune+1,
   server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_s.id;
  RETURN jsonb_build_object('cod','acceptat','sesiune_id',v_s.id);
 END IF;
 IF v_type NOT IN ('decl_salveaza','decl_sterge') THEN RAISE EXCEPTION 'tip_op' USING ERRCODE='IZ001'; END IF;
 SELECT * INTO v_d FROM public.izo_declaratii WHERE uid=(v_p->>'uid')::uuid;
 IF v_s.stare='trimisa' AND (v_d.id IS NULL OR v_d.stare NOT IN ('revizie_ceruta','conflict','blocata','in_verificare')) THEN
  RAISE EXCEPTION 'sesiune_stare' USING ERRCODE='IZ002'; END IF;
 IF FOUND THEN
  IF v_d.declarat_de<>v_uid OR v_d.preverificare_id<>v_s.id THEN RAISE EXCEPTION 'ref_alt_autor' USING ERRCODE='IZ001'; END IF;
  IF v_d.versiune IS DISTINCT FROM (v_p->>'versiune_baza')::integer OR v_d.stare NOT IN ('ciorna','conflict','blocata','in_verificare','revizie_ceruta') THEN
   RAISE EXCEPTION 'cas' USING ERRCODE='IZ002'; END IF;
 ELSE
  IF (v_p->>'versiune_baza')::integer IS DISTINCT FROM 0 OR v_type='decl_sterge' THEN RAISE EXCEPTION 'cas' USING ERRCODE='IZ002'; END IF;
 END IF;
 IF v_d.id IS NOT NULL THEN
  -- Entire author/project declaration closure was locked before any root lock.
  WITH RECURSIVE deps AS (SELECT uid FROM public.izo_declaratii WHERE depinde_de_uid=v_d.uid
   UNION SELECT d.uid FROM public.izo_declaratii d JOIN deps x ON d.depinde_de_uid=x.uid)
  UPDATE public.izo_declaratii SET stare_inainte_blocare=stare,stare='blocata',blocata_motiv=CASE WHEN v_type='decl_sterge' THEN 'dependenta_anulata' ELSE 'dependenta_in_revizie' END,server_ver=nextval('public.izo_server_ver_seq')
   WHERE uid IN (SELECT uid FROM deps) AND stare IN ('ciorna','conflict','trimisa','in_verificare','revizie_ceruta');
  UPDATE public.izo_rezervari SET activa=false,eliberata_la=now(),motiv_eliberare=CASE WHEN v_type='decl_sterge' THEN 'stearsa' ELSE 'versiune_noua' END,
   server_ver=nextval('public.izo_server_ver_seq') WHERE declaratie_id=v_d.id AND activa;
  PERFORM public.fn_izo_suduri_invalideaza(ARRAY[v_d.id]);
  UPDATE public.izo_bucati_declarate SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq') WHERE declaratie_id=v_d.id AND stare='declarata';
 END IF;
 IF v_type='decl_sterge' THEN
  UPDATE public.izo_declaratii SET stare='stearsa',stare_inainte_blocare=NULL,blocata_motiv=NULL,versiune=versiune+1,ultimul_op_id=v_id,
   server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_d.id RETURNING * INTO v_d;
  INSERT INTO public.izo_declaratii_versiuni(declaratie_id,versiune,payload,hash_cerere,op_id) VALUES(v_d.id,v_d.versiune,v_p,p_hash,v_id);
  RETURN jsonb_build_object('cod','acceptat','uid',v_d.uid,'versiune',v_d.versiune,'stare',v_d.stare);
 END IF;
 IF v_p->>'tip' NOT IN ('montaj','taiere','cuplare') OR v_p->>'tip' IS NULL THEN
  RAISE EXCEPTION 'necesita_suduri_capete_E4b2' USING ERRCODE='IZ001'; END IF;
 IF v_p ? 'depinde_de_uid' THEN
  IF NOT EXISTS(SELECT 1 FROM public.izo_declaratii WHERE uid=(v_p->>'depinde_de_uid')::uuid AND declarat_de=v_uid
   AND proiect_id=p_front.proiect_id AND tronson_id=p_front.tronson_id AND versiune=(v_p->>'depinde_de_versiune')::integer
   AND stare IN ('ciorna','trimisa','aprobata')) THEN RAISE EXCEPTION 'dependenta' USING ERRCODE='IZ003'; END IF;
  IF (v_p->>'depinde_de_uid')::uuid=(v_p->>'uid')::uuid THEN RAISE EXCEPTION 'ciclu' USING ERRCODE='IZ001'; END IF;
  IF EXISTS(WITH RECURSIVE parinti AS (
   SELECT uid,depinde_de_uid FROM public.izo_declaratii WHERE uid=(v_p->>'depinde_de_uid')::uuid
   UNION SELECT d.uid,d.depinde_de_uid FROM public.izo_declaratii d JOIN parinti p ON d.uid=p.depinde_de_uid)
   SELECT 1 FROM parinti WHERE uid=(v_p->>'uid')::uuid) THEN RAISE EXCEPTION 'ciclu' USING ERRCODE='IZ001'; END IF;
 END IF;
 v_date:=coalesce((v_p->>'data_montaj')::date,(now() AT TIME ZONE 'Europe/Bucharest')::date);
 IF v_date>(now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'data_viitoare' USING ERRCODE='IZ001'; END IF;
 SELECT * INTO STRICT v_cfg FROM public.fn_izo_proiect_config_citeste(p_front.proiect_id);
 IF v_p->>'tip'<>'cuplare' THEN
 v_ref:=CASE WHEN v_p->>'tip'='taiere' THEN v_p->'sursa' ELSE v_p->'bucata' END;
 v_source:=(v_ref->>'bucata_id')::bigint; v_decl:=(v_ref->>'decl_uid')::uuid;
 IF num_nonnulls(v_source,v_decl)>1 THEN RAISE EXCEPTION 'resursa' USING ERRCODE='IZ001'; END IF;
 IF v_decl IS NOT NULL THEN
  SELECT * INTO v_c FROM public.izo_bucati_declarate WHERE uid=v_decl;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.izo_declaratii WHERE id=v_c.declaratie_id AND declarat_de=v_uid
   AND proiect_id=p_front.proiect_id AND tronson_id=p_front.tronson_id AND uid=(v_p->>'depinde_de_uid')::uuid
   AND versiune=(v_p->>'depinde_de_versiune')::integer AND stare IN ('ciorna','trimisa','aprobata')) THEN
   RAISE EXCEPTION 'ref_alt_autor' USING ERRCODE='IZ001'; END IF;
  SELECT id INTO v_source FROM public.magazie_bucati WHERE uid=v_decl;
  IF v_source IS NOT NULL THEN v_decl:=NULL;
  ELSIF v_c.stare<>'declarata' OR v_c.destinatie<>'montaj' THEN RAISE EXCEPTION 'copil_indisponibil' USING ERRCODE='IZ002'; END IF;
 END IF;
 IF v_source IS NOT NULL THEN
  SELECT * INTO v_b FROM public.magazie_bucati WHERE id=v_source;
  IF NOT FOUND OR v_b.proiect_id<>p_front.proiect_id OR v_b.tip_cod IS NULL THEN RAISE EXCEPTION 'bucata' USING ERRCODE='IZ001'; END IF;
  IF v_b.stare='carantina' THEN RAISE EXCEPTION 'carantina' USING ERRCODE='IZ001'; END IF;
  IF NOT (v_b.stare IN ('pe_tronson','montata') AND (v_b.stare<>'montata' OR v_p->>'tip'='taiere') AND v_b.tronson_id=p_front.tronson_id OR v_b.stare IN ('sosit','receptionat','retur') AND v_b.depozit_id IS NOT NULL) THEN
   RAISE EXCEPTION 'stare_bucata' USING ERRCODE='IZ002'; END IF;
  v_root:=coalesce(v_b.radacina_id,v_b.id); v_len:=v_b.lungime_mm;
  IF cardinality(public.fn_izo_pv_lipsa(ARRAY[v_root]))>0 THEN RAISE EXCEPTION 'fara_pv' USING ERRCODE='IZ001'; END IF;
  IF v_b.stare='pe_tronson' AND EXISTS(SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati_evenimente e ON e.id=m.eveniment_id
   WHERE m.bucata_id=v_source AND e.tip='livrare' AND (e.ora_server AT TIME ZONE 'Europe/Bucharest')::date>v_date) THEN
   RAISE EXCEPTION 'data_inainte_iesire' USING ERRCODE='IZ001'; END IF;
 ELSE
  v_root:=v_c.radacina_id; v_len:=v_c.lungime_mm;
  IF v_root IS NOT NULL THEN SELECT * INTO v_b FROM public.magazie_bucati WHERE id=v_root; END IF;
 END IF;
 IF v_source IS NULL AND v_decl IS NULL THEN
  IF v_p->>'tip'<>'montaj' OR length(coalesce(v_p->>'serie_bruta',''))=0 OR (v_p->>'lungime_masurata_mm')::integer IS NULL THEN
   RAISE EXCEPTION 'identificare' USING ERRCODE='IZ001'; END IF;
  v_ident:='nerezolvata'; v_len:=(v_p->>'lungime_masurata_mm')::integer;
 ELSE v_ident:=CASE WHEN v_decl IS NULL THEN 'bucata' ELSE 'bucata_decl' END; END IF;
 IF v_len IS NULL OR v_len<=0 OR v_len>v_cfg.lungime_max_mm THEN RAISE EXCEPTION 'lungime' USING ERRCODE='IZ001'; END IF;
 IF coalesce(v_p#>>'{confirmare,mod}','') NOT IN ('marcaj','marcaj_diferit','masurat','taiata') THEN RAISE EXCEPTION 'lungime_neconfirmata' USING ERRCODE='IZ001'; END IF;
 IF v_p#>>'{confirmare,mod}'='marcaj' AND (v_p#>>'{confirmare,cm}')::integer IS DISTINCT FROM (round(v_len::numeric/10)::integer % 100) THEN
  RAISE EXCEPTION 'confirmare_cm' USING ERRCODE='IZ001'; END IF;
 IF v_p->>'tip'='montaj' THEN
  IF v_p#>>'{confirmare,mod}' IN ('masurat','marcaj_diferit') AND abs(coalesce((v_p#>>'{confirmare,masurata_mm}')::integer,(v_p->>'lungime_masurata_mm')::integer,v_len)-v_len)>v_cfg.toleranta_mm
   AND (v_source IS DISTINCT FROM v_root OR EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.parinte_id=v_source)
    OR EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.radacina_id=v_root AND c.declaratie_id IS DISTINCT FROM v_d.id AND c.stare<>'anulata')) THEN
   v_state:='conflict'; v_conflict:='corectie_in_arbore'; END IF;
  -- Sudura si cele doua capete se valideaza dupa identitatea declaratiei.
  IF (v_p->>'lungime_montata_mm')::integer IS NULL OR (v_p->>'lungime_montata_mm')::integer<>(CASE WHEN v_p#>>'{confirmare,mod}' ='marcaj_diferit' OR v_p#>>'{confirmare,mod}'='masurat' AND abs(coalesce((v_p#>>'{confirmare,masurata_mm}')::integer,(v_p->>'lungime_masurata_mm')::integer,v_len)-v_len)>v_cfg.toleranta_mm THEN coalesce((v_p#>>'{confirmare,masurata_mm}')::integer,(v_p->>'lungime_masurata_mm')::integer) ELSE v_len END) THEN RAISE EXCEPTION 'montaj_lungime' USING ERRCODE='IZ001'; END IF;
 ELSE
  v_base:=(v_p->>'baza_mm')::integer;
  IF v_base IS NULL OR v_base<=0 OR v_base>v_cfg.lungime_max_mm THEN RAISE EXCEPTION 'baza' USING ERRCODE='IZ001'; END IF;
  IF abs(v_base-v_len)>v_cfg.toleranta_mm AND (v_source IS DISTINCT FROM v_root OR EXISTS
   (SELECT 1 FROM public.magazie_bucati WHERE radacina_id=v_root AND id<>v_root AND stare<>'anulata') OR EXISTS
   (SELECT 1 FROM public.izo_bucati_declarate WHERE radacina_id=v_root AND declaratie_id IS DISTINCT FROM v_d.id AND stare<>'anulata')) THEN
   v_state:='conflict'; v_conflict:='corectie_in_arbore'; END IF;
  SELECT array_agg(value::integer ORDER BY ordinality) INTO v_points FROM jsonb_array_elements_text(v_p->'puncte_mm') WITH ORDINALITY;
  v_n:=jsonb_array_length(v_p->'copii');
  IF cardinality(v_points) NOT BETWEEN 1 AND 2 OR v_n IS DISTINCT FROM cardinality(v_points)+1 OR v_points[1]<=0
   OR v_points[cardinality(v_points)]>=v_base OR (cardinality(v_points)=2 AND v_points[1]>=v_points[2]) THEN RAISE EXCEPTION 'puncte' USING ERRCODE='IZ001'; END IF;
  v_sum:=0; v_i:=0;
  FOR v_child IN SELECT value FROM jsonb_array_elements(v_p->'copii') LOOP
   v_i:=v_i+1;
   v_len:=(v_child->>'lungime_mm')::integer;
   IF v_len IS NULL OR v_len<=0 OR v_len IS DISTINCT FROM
    (CASE WHEN v_i=v_n THEN v_base ELSE v_points[v_i] END)-(CASE WHEN v_i=1 THEN 0 ELSE v_points[v_i-1] END) THEN RAISE EXCEPTION 'r3' USING ERRCODE='IZ001'; END IF;
   v_sum:=v_sum+v_len;
   IF v_child->>'destinatie' NOT IN ('montaj','ramane_montat','depozit') OR v_child->>'destinatie' IS NULL THEN RAISE EXCEPTION 'destinatie' USING ERRCODE='IZ001'; END IF;
   IF EXISTS(SELECT 1 FROM public.magazie_bucati WHERE uid=(v_child->>'uid')::uuid) OR EXISTS
    (SELECT 1 FROM public.izo_bucati_declarate WHERE uid=(v_child->>'uid')::uuid AND
     (declaratie_id IS DISTINCT FROM v_d.id OR radacina_id IS DISTINCT FROM v_root OR parinte_bucata_id IS DISTINCT FROM v_source OR parinte_decl_uid IS DISTINCT FROM v_decl)) THEN RAISE EXCEPTION 'uid_alt_arbore' USING ERRCODE='IZ002'; END IF;
   IF EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.proiect_id=p_front.proiect_id AND b.id IS DISTINCT FROM v_source AND b.stare NOT IN ('taiata','anulata')
    AND b.serie_canon=v_b.serie_canon AND b.sarja IS NOT DISTINCT FROM v_b.sarja AND b.lungime_cm=round(v_len::numeric/10)::integer) THEN
    v_state:='conflict'; v_conflict:='r1d'; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(v_p->'copii') c WHERE round((c->>'lungime_mm')::numeric/10)=round(v_len::numeric/10))>1 OR EXISTS
    (SELECT 1 FROM public.izo_bucati_declarate c JOIN public.magazie_bucati b ON b.id=c.radacina_id
     WHERE c.stare='declarata' AND c.declaratie_id IS DISTINCT FROM v_d.id AND c.uid IS DISTINCT FROM v_decl
      AND b.serie_canon=v_b.serie_canon AND b.sarja IS NOT DISTINCT FROM v_b.sarja AND round(c.lungime_mm::numeric/10)=round(v_len::numeric/10)) THEN
    v_state:='conflict'; v_conflict:='r1d'; END IF;
  END LOOP;
  IF v_sum<>v_base THEN RAISE EXCEPTION 'r3' USING ERRCODE='IZ001'; END IF;
 END IF;
 END IF; -- montaj / taiere; cuplarea rezerva capete, nu bucati
 IF v_s.stare='trimisa' AND v_state='ciorna' THEN
  v_state:=CASE WHEN v_ident='nerezolvata' THEN 'in_verificare' ELSE 'trimisa' END;
 END IF;
 -- Stable declaration identity; no facts are written to the registry.
 IF v_d.id IS NULL THEN
  INSERT INTO public.izo_declaratii(uid,preverificare_id,proiect_id,tronson_id,tip,versiune,declarat_de,declarat_de_angajat,dispozitiv_id,ultimul_op_id,
   stare,conflict_cod,identificare,bucata_id,bucata_decl_uid,sursa_bucata_id,sursa_decl_uid,depinde_de_uid,depinde_de_versiune,payload,gps_prezent,data_montaj)
  VALUES((v_p->>'uid')::uuid,v_s.id,p_front.proiect_id,p_front.tronson_id,v_p->>'tip',1,v_uid,p_emp,p_dispozitiv,v_id,v_state,v_conflict,
   CASE WHEN v_p->>'tip'='montaj' THEN v_ident END,CASE WHEN v_p->>'tip'='montaj' THEN v_source END,CASE WHEN v_p->>'tip'='montaj' THEN v_decl END,
   CASE WHEN v_p->>'tip'='taiere' THEN v_source END,CASE WHEN v_p->>'tip'='taiere' THEN v_decl END,
   (v_p->>'depinde_de_uid')::uuid,(v_p->>'depinde_de_versiune')::integer,v_p,(p_op->'payload') ? 'gps',v_date) RETURNING * INTO v_d;
 ELSE
  IF v_d.tip<>v_p->>'tip' THEN RAISE EXCEPTION 'tip_imuabil' USING ERRCODE='IZ001'; END IF;
  UPDATE public.izo_declaratii SET versiune=versiune+1,stare=v_state,conflict_cod=v_conflict,stare_inainte_blocare=NULL,blocata_motiv=NULL,
   identificare=CASE WHEN tip='montaj' THEN v_ident END,bucata_id=CASE WHEN tip='montaj' THEN v_source END,bucata_decl_uid=CASE WHEN tip='montaj' THEN v_decl END,
   sursa_bucata_id=CASE WHEN tip='taiere' THEN v_source END,sursa_decl_uid=CASE WHEN tip='taiere' THEN v_decl END,
   depinde_de_uid=(v_p->>'depinde_de_uid')::uuid,depinde_de_versiune=(v_p->>'depinde_de_versiune')::integer,
   payload=v_p,ultimul_op_id=v_id,gps_prezent=(p_op->'payload') ? 'gps',data_montaj=v_date,
   server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_d.id RETURNING * INTO v_d;
 END IF;
 IF v_source IS NOT NULL OR v_decl IS NOT NULL THEN
  UPDATE public.izo_rezervari SET activa=false,eliberata_la=now(),motiv_eliberare='expirata',server_ver=nextval('public.izo_server_ver_seq')
   WHERE activa AND expira_dupa<now() AND (bucata_id=v_source OR bucata_decl_uid=v_decl);
  INSERT INTO public.izo_rezervari(proiect_id,tronson_id,declaratie_id,declaratie_versiune,autor_profile_id,bucata_id,bucata_decl_uid,din_depozit,expira_dupa)
   VALUES(p_front.proiect_id,p_front.tronson_id,v_d.id,v_d.versiune,v_uid,v_source,v_decl,coalesce(v_b.depozit_id IS NOT NULL,false),
    CASE WHEN v_s.stare='deschisa' THEN p_front.expira_la+interval '24 hours' END);
 END IF;
 IF v_d.tip='taiere' THEN
  -- Never recycle letters, including letters of cancelled declarations.
  SELECT coalesce(max(x.n),0) INTO v_letter FROM (
   SELECT ascii(left(capat_stanga,1))-65 n FROM public.izo_bucati_declarate WHERE radacina_id=v_root
   UNION ALL SELECT ascii(left(capat_dreapta,1))-65 FROM public.izo_bucati_declarate WHERE radacina_id=v_root
   UNION ALL SELECT ascii(left(capat_stanga,1))-65 FROM public.magazie_bucati WHERE radacina_id=v_root
   UNION ALL SELECT ascii(left(capat_dreapta,1))-65 FROM public.magazie_bucati WHERE radacina_id=v_root) x;
  v_prev:=coalesce(v_c.capat_stanga,v_b.capat_stanga,'A'); v_i:=0;
  FOR v_child IN SELECT value FROM jsonb_array_elements(v_p->'copii') LOOP
   v_i:=v_i+1; v_left:=v_prev;
   IF v_i=v_n THEN v_right:=coalesce(v_c.capat_dreapta,v_b.capat_dreapta,'B');
   ELSE v_letter:=v_letter+1; IF v_letter>25 THEN RAISE EXCEPTION 'litere_epuizate' USING ERRCODE='IZ001'; END IF; v_right:=chr(65+v_letter); END IF;
   INSERT INTO public.izo_bucati_declarate(uid,declaratie_id,declaratie_versiune,parinte_bucata_id,parinte_decl_uid,radacina_id,lungime_mm,lungime_calculata,
    capat_stanga,capat_dreapta,cod_bucata,destinatie,depozit_destinatie_id)
   VALUES((v_child->>'uid')::uuid,v_d.id,v_d.versiune,v_source,v_decl,v_root,(v_child->>'lungime_mm')::integer,coalesce((v_child->>'calculata')::boolean,false),
    v_left,v_right,v_left||v_right,v_child->>'destinatie',(v_child->>'depozit_destinatie_id')::integer)
   ON CONFLICT(uid) DO UPDATE SET declaratie_versiune=excluded.declaratie_versiune,lungime_mm=excluded.lungime_mm,
    lungime_calculata=excluded.lungime_calculata,
    capat_stanga=CASE WHEN izo_bucati_declarate.lungime_mm=excluded.lungime_mm THEN izo_bucati_declarate.capat_stanga ELSE excluded.capat_stanga END,
    capat_dreapta=CASE WHEN izo_bucati_declarate.lungime_mm=excluded.lungime_mm THEN izo_bucati_declarate.capat_dreapta ELSE excluded.capat_dreapta END,
    cod_bucata=CASE WHEN izo_bucati_declarate.lungime_mm=excluded.lungime_mm THEN izo_bucati_declarate.cod_bucata ELSE excluded.cod_bucata END,
    destinatie=excluded.destinatie,depozit_destinatie_id=excluded.depozit_destinatie_id,stare='declarata',server_ver=nextval('public.izo_server_ver_seq');
   IF v_child->>'destinatie'='ramane_montat' THEN
    INSERT INTO public.izo_rezervari(proiect_id,tronson_id,declaratie_id,declaratie_versiune,autor_profile_id,bucata_decl_uid,din_depozit,expira_dupa)
    VALUES(p_front.proiect_id,p_front.tronson_id,v_d.id,v_d.versiune,v_uid,(v_child->>'uid')::uuid,false,
     CASE WHEN v_s.stare='deschisa' THEN p_front.expira_la+interval '24 hours' END);
   END IF;
   v_prev:=v_right;
  END LOOP;
 END IF;
 PERFORM public.fn_izo_sudura_decl(v_d.id);
 PERFORM public.fn_izo_taiere_ramura(v_d.id);
 -- A changed/disappeared child cannot keep its old consumer reservation.
 -- Rezervarea proprie a taierii tine copilul ramane_montat, nu consuma
 -- lungimea lui: baza_mm a taierii este lungimea parintelui. Comparam doar
 -- consumatorii distincti; anularea copilului elibereaza orice rezervare.
 UPDATE public.izo_rezervari r SET activa=false,eliberata_la=now(),motiv_eliberare='parinte_anulat',
  server_ver=nextval('public.izo_server_ver_seq') WHERE r.activa AND r.bucata_decl_uid IN
   (SELECT c.uid FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND
    (c.stare='anulata' OR EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE d.id=r.declaratie_id AND d.id<>c.declaratie_id
      AND coalesce((d.payload->>'lungime_montata_mm')::integer,(d.payload->>'baza_mm')::integer) IS DISTINCT FROM c.lungime_mm)));
 -- Keep the severe reason; only unchanged referenced children can restore a row.
 UPDATE public.izo_declaratii d SET blocata_motiv='dependenta_anulata',server_ver=nextval('public.izo_server_ver_seq')
 WHERE d.stare='blocata' AND d.depinde_de_uid=v_d.uid AND EXISTS
  (SELECT 1 FROM public.izo_bucati_declarate c WHERE c.declaratie_id=v_d.id AND c.uid IN (d.bucata_decl_uid,d.sursa_decl_uid)
    AND (c.stare='anulata' OR coalesce((d.payload->>'lungime_montata_mm')::integer,(d.payload->>'baza_mm')::integer) IS DISTINCT FROM c.lungime_mm));
 IF v_d.stare='trimisa' THEN
  -- Iterate in dependency order; a transitive descendant waits for its parent.
  LOOP
   UPDATE public.izo_declaratii d SET stare=d.stare_inainte_blocare,stare_inainte_blocare=NULL,blocata_motiv=NULL,
    depinde_de_versiune=p.versiune,server_ver=nextval('public.izo_server_ver_seq')
   FROM public.izo_declaratii p WHERE d.depinde_de_uid=p.uid AND d.proiect_id=p_front.proiect_id AND d.declarat_de=v_uid
    AND d.id=ANY(public.fn_izo_dependenti(v_d.id))
    AND d.stare='blocata' AND d.blocata_motiv='dependenta_in_revizie' AND p.stare IN ('trimisa','ciorna','conflict')
    AND (coalesce(d.bucata_decl_uid,d.sursa_decl_uid) IS NULL OR EXISTS(SELECT 1 FROM public.izo_bucati_declarate c
     WHERE c.uid=coalesce(d.bucata_decl_uid,d.sursa_decl_uid) AND c.declaratie_id=p.id AND c.stare='declarata'
      AND c.lungime_mm=coalesce((d.payload->>'lungime_montata_mm')::integer,(d.payload->>'baza_mm')::integer)));
   GET DIAGNOSTICS v_affected=ROW_COUNT; EXIT WHEN v_affected=0;
  END LOOP;
 END IF;
 INSERT INTO public.izo_declaratii_versiuni(declaratie_id,versiune,payload,hash_cerere,op_id) VALUES(v_d.id,v_d.versiune,v_p,p_hash,v_id);
 IF (p_op->'payload') ? 'gps' THEN
  v_gps:=p_op#>'{payload,gps}';
  IF jsonb_typeof(v_gps)<>'object' OR v_gps-ARRAY['lat','lon','precizie_m','la']<>'{}'::jsonb THEN RAISE EXCEPTION 'gps' USING ERRCODE='IZ001'; END IF;
  INSERT INTO public.izo_declaratii_gps(declaratie_id,versiune,lat,lon,precizie_m,la)
   VALUES(v_d.id,v_d.versiune,(v_gps->>'lat')::numeric,(v_gps->>'lon')::numeric,(v_gps->>'precizie_m')::numeric,(v_gps->>'la')::timestamptz);
 END IF;
 RETURN jsonb_build_object('cod','acceptat','uid',v_d.uid,'versiune',v_d.versiune,'stare',v_d.stare,'conflict_cod',v_d.conflict_cod);
END $f$;

CREATE FUNCTION public.fn_izo_teren_push(p_dispozitiv uuid,p_ops jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_f public.izo_fronturi; v_old public.izo_operatii; v_uid uuid; v_emp bigint;
 v_op jsonb; v_p jsonb; v_results jsonb:='[]'; v_response jsonb; v_hash text;
 v_code text; v_result text; v_state text; v_pr bigint; v_tr bigint; v_seq bigint:=0; v_last bigint;
 v_opid uuid; v_ora timestamptz; v_deps uuid[]:='{}'; v_stop boolean:=false; v_format integer;
BEGIN
 -- No table read or write precedes the schema lock.
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 IF session_user<>'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' OR public.fn_izo_uid() IS NULL THEN
  RETURN jsonb_build_object('cod','fara_drept'); END IF;
 IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) NOT BETWEEN 1 AND 50 OR octet_length(p_ops::text)>262144 THEN
  RETURN jsonb_build_object('cod','limita'); END IF;
 v_uid:=public.fn_izo_uid();
 BEGIN
  v_pr:=(p_ops#>>'{0,payload,proiect_id}')::bigint; v_tr:=(p_ops#>>'{0,payload,tronson_id}')::bigint;
  IF v_pr IS NULL OR v_tr IS NULL OR p_dispozitiv IS NULL THEN RETURN jsonb_build_object('cod','eroare','motiv','lot_format'); END IF;
  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
   IF jsonb_typeof(v_op)<>'object' OR v_op-ARRAY['op_id','seq','tip_op','ora_tableta','payload','versiune_format']<>'{}'::jsonb
    OR (v_op#>>'{payload,proiect_id}')::bigint IS DISTINCT FROM v_pr OR (v_op#>>'{payload,tronson_id}')::bigint IS DISTINCT FROM v_tr
    OR (v_op->>'seq')::bigint IS NULL OR (v_op->>'seq')::bigint<=v_seq OR (v_op->>'op_id')::uuid IS NULL THEN
    RETURN jsonb_build_object('cod','eroare','motiv','lot_format'); END IF;
   v_seq:=(v_op->>'seq')::bigint;
  END LOOP;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('cod','eroare','motiv','lot_format'); END;
 v_code:=public.fn_izo_teren_entra(v_pr,'sync');
 IF v_code IS NOT NULL THEN RETURN jsonb_build_object('cod',v_code); END IF;
 SELECT * INTO v_f FROM public.izo_fronturi WHERE tronson_id=v_tr AND activ FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('cod','front_expirat'); END IF;
 IF v_f.proiect_id<>v_pr THEN RETURN jsonb_build_object('cod','fara_drept'); END IF;
 PERFORM 1 FROM public.izo_preverificari WHERE proiect_id=v_pr AND autor_profile_id=v_uid ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.izo_declaratii WHERE proiect_id=v_pr AND declarat_de=v_uid ORDER BY id FOR UPDATE;
 v_emp:=public.fn_izo_teren_autorizat(v_pr,true);
 IF v_emp IS NULL THEN RETURN jsonb_build_object('cod','fara_drept'); END IF;
 IF v_f.profile_id<>v_uid OR v_f.dispozitiv_id<>p_dispozitiv THEN
  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
   BEGIN
    v_p:=public.fn_izo_teren_payload(v_op->'payload');
    INSERT INTO public.izo_sync_incercari(proiect_id,tronson_id,autor_profile_id,op_id,dispozitiv_id,tip_op,payload)
     VALUES(v_pr,v_tr,v_uid,(v_op->>'op_id')::uuid,p_dispozitiv,v_op->>'tip_op',v_p) ON CONFLICT DO NOTHING;
   EXCEPTION WHEN SQLSTATE 'IZ001' THEN NULL; END;
   v_results:=v_results||jsonb_build_array(jsonb_build_object('op_id',v_op->>'op_id','cod','alt_dispozitiv'));
  END LOOP;
  RETURN jsonb_build_object('cod','alt_dispozitiv','rezultate',v_results);
 END IF;
 IF v_f.expira_la<=now() THEN RETURN jsonb_build_object('cod','front_expirat'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.izo_dispozitive WHERE dispozitiv_id=p_dispozitiv AND profile_id=v_uid) THEN RETURN jsonb_build_object('cod','fara_drept'); END IF;
 -- Conservative, fixed superset of the transitive closure: all this author's project rows.
 -- It also contains dependencies introduced by earlier operations in the same batch.
 PERFORM public.fn_izo_config_blocheaza(v_tr);
 PERFORM public.fn_izo_blocheaza_locuri(v_pr,ARRAY(SELECT DISTINCT depozit_id FROM public.magazie_bucati WHERE proiect_id=v_pr AND depozit_id IS NOT NULL ORDER BY depozit_id),ARRAY[v_tr]);
 IF NOT EXISTS(SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=v_tr AND proiect_id=v_pr AND flux_montaj)
  OR coalesce(public.fn_izo_nivel(v_pr),'off') NOT IN ('stoc','montaj') THEN RETURN jsonb_build_object('cod','fara_drept'); END IF;
 -- No project advisory: roots serialize reservation races across fronts (§10.5).
 PERFORM public.fn_izo_teren_radacini_blocheaza(v_pr,true);
 SELECT ultimul_seq INTO v_last FROM public.izo_dispozitive WHERE dispozitiv_id=p_dispozitiv FOR UPDATE;
 IF (SELECT count(*) FROM public.izo_operatii WHERE autor_profile_id=v_uid AND ora_server>now()-interval '1 hour')+jsonb_array_length(p_ops)>600 THEN
  RETURN jsonb_build_object('cod','limita'); END IF;
 FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
  v_opid:=(v_op->>'op_id')::uuid; v_seq:=(v_op->>'seq')::bigint;
  v_format:=CASE WHEN coalesce(v_op->>'versiune_format','') ~ '^[0-9]{1,8}$' THEN (v_op->>'versiune_format')::integer ELSE 0 END;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('dispozitiv_id',p_dispozitiv,'cerere',v_op)::text,'UTF8')),'hex');
  SELECT * INTO v_old FROM public.izo_operatii WHERE autor_profile_id=v_uid AND op_id=v_opid;
  IF FOUND THEN
   v_response:=CASE WHEN v_old.canal='teren' AND v_old.hash_cerere=v_hash
    THEN jsonb_build_object('cod','duplicat','raspuns',v_old.raspuns) ELSE jsonb_build_object('cod','conflict_op') END;
   v_results:=v_results||jsonb_build_array(jsonb_build_object('op_id',v_opid)||v_response); CONTINUE;
  END IF;
  v_response:=NULL; v_result:='acceptat'; v_code:=NULL; v_p:='{}'; v_ora:=NULL;
  BEGIN
   v_p:=public.fn_izo_teren_payload(v_op->'payload');
   v_ora:=(v_op->>'ora_tableta')::timestamptz;
   IF (v_p->>'depinde_de_uid')::uuid=ANY(v_deps) OR EXISTS(SELECT 1 FROM public.izo_declaratii
    WHERE uid=(v_p->>'depinde_de_uid')::uuid AND stare IN ('conflict','blocata')) THEN
    v_response:=jsonb_build_object('cod','blocat_de_conflict');
   ELSE
    IF v_op->>'tip_op'='decl_salveaza' AND (v_p->>'versiune_baza')::integer=0 AND
     ((SELECT count(*) FROM public.izo_rezervari WHERE autor_profile_id=v_uid AND activa AND (expira_dupa IS NULL OR expira_dupa>now()))>=60
     OR ((SELECT count(*) FROM public.izo_rezervari WHERE autor_profile_id=v_uid AND activa AND din_depozit AND (expira_dupa IS NULL OR expira_dupa>now()))>=10
      AND EXISTS(SELECT 1 FROM public.magazie_bucati WHERE id=coalesce((v_p#>>'{bucata,bucata_id}')::bigint,(v_p#>>'{sursa,bucata_id}')::bigint) AND depozit_id IS NOT NULL))) THEN
     v_response:=jsonb_build_object('cod','limita');
    ELSIF v_op->>'tip_op'='decl_salveaza' AND (v_p->>'versiune_baza')::integer=0 AND
     (SELECT count(*) FROM public.izo_declaratii d JOIN public.izo_preverificari s ON s.id=d.preverificare_id WHERE s.uid=(v_p->>'preverificare_uid')::uuid)>=200 THEN
     v_response:=jsonb_build_object('cod','limita');
    ELSE
     v_response:=public.fn_izo_teren_op(p_dispozitiv,v_op,v_p,v_emp,v_hash,v_f);
     v_response:=v_response||jsonb_build_object('alerte',to_jsonb(array_remove(ARRAY[
      CASE WHEN abs(extract(epoch FROM now()-v_ora))>300 THEN 'izo_ceas_tableta' END,
      CASE WHEN v_seq>v_last+1 THEN 'izo_gol_operatii' END],NULL)));
     -- Journal is the LAST write of this operation's savepoint.
     INSERT INTO public.izo_operatii(autor_profile_id,op_id,canal,proiect_id,tronson_id,dispozitiv_id,seq,versiune_format,tip_op,payload,hash_cerere,rezultat,raspuns,ora_tableta,offset_ceas_s)
      VALUES(v_uid,v_opid,'teren',v_pr,v_tr,p_dispozitiv,v_seq,v_format,v_op->>'tip_op',v_p,v_hash,'acceptat',v_response,v_ora,extract(epoch FROM now()-v_ora));
    END IF;
   END IF;
  EXCEPTION
   WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled THEN
    v_response:=jsonb_build_object('cod','reincearca'); v_stop:=true;
   WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE;
    IF v_state='IZ003' THEN v_response:=jsonb_build_object('cod','blocat_de_conflict');
    ELSE
     v_result:=CASE WHEN v_state IN ('IZ002','23505') THEN 'conflict' WHEN left(v_state,2) IN ('IZ','22','23') THEN 'eroare' ELSE 'eroare_interna' END;
     -- Do not copy SQLERRM from arbitrary SQL: it can include submitted GPS values.
     v_code:=CASE WHEN left(v_state,2)='IZ' THEN SQLERRM ELSE v_state END;
     v_response:=jsonb_build_object('cod',v_result,'motiv',v_code);
     INSERT INTO public.izo_operatii(autor_profile_id,op_id,canal,proiect_id,tronson_id,dispozitiv_id,seq,versiune_format,tip_op,payload,hash_cerere,rezultat,cod,raspuns,ora_tableta)
      VALUES(v_uid,v_opid,'teren',v_pr,v_tr,p_dispozitiv,v_seq,v_format,coalesce(v_op->>'tip_op',''),v_p,v_hash,v_result,v_code,v_response,v_ora);
    END IF;
  END;
  IF v_response->>'cod'<>'acceptat' OR v_response->>'stare' IN ('conflict','blocata') THEN
   BEGIN v_deps:=array_append(v_deps,(v_p->>'uid')::uuid); EXCEPTION WHEN invalid_text_representation THEN NULL; END;
  END IF;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('op_id',v_opid)||v_response);
  IF v_stop THEN EXIT; END IF;
  v_last:=greatest(v_last,v_seq);
 END LOOP;
 UPDATE public.izo_dispozitive SET ultimul_seq=v_last,server_ver=nextval('public.izo_server_ver_seq') WHERE dispozitiv_id=p_dispozitiv AND profile_id=v_uid;
 RETURN jsonb_build_object('cod','ok','rezultate',v_results,'server_ver_max',greatest(
  coalesce((SELECT max(server_ver) FROM public.izo_declaratii WHERE proiect_id=v_pr),0),
  coalesce((SELECT max(server_ver) FROM public.izo_rezervari WHERE proiect_id=v_pr),0)));
END $f$;
CREATE FUNCTION public.fn_izo_sync_push(p_dispozitiv uuid,p_ops jsonb) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_teren_push(p_dispozitiv,p_ops)
$f$;

CREATE FUNCTION public.fn_izo_gps_citeste(p_decl bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_pr bigint; v_uid uuid; v_result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 IF session_user<>'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 v_uid:=public.fn_izo_uid();
 SELECT proiect_id INTO v_pr FROM public.izo_declaratii WHERE id=p_decl;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_uid AND employee_id IS NOT NULL AND (is_owner OR
  EXISTS(SELECT 1 FROM public.izo_atribuiri WHERE profile_id=v_uid AND proiect_id=v_pr AND activ AND rol IN ('manager_aprobator','inlocuitor_aprobator')
   AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date)))) THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 IF cardinality(public.fn_izo_porti_lipsa())<>0 THEN RAISE EXCEPTION 'E4b porti'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY versiune),'[]'::jsonb) INTO v_result FROM public.izo_declaratii_gps g WHERE declaratie_id=p_decl;
 RETURN v_result;
END $f$;
CREATE FUNCTION public.fn_izo_teren_pregateste(p_proiect bigint,p_tronson bigint,p_dispozitiv uuid) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_teren_intern(p_proiect,p_tronson,p_dispozitiv,true)
$f$;
