-- E4b-3: only lock/read helpers retain postgres ownership.
-- Privileged postgres DEFINER boundaries, deliberately not API write routes:
-- teren_autorizat / autor_valabil / birou_autorizat lock profiles/access/assignments;
-- teren_entra validates identity/schema/gates and writes only the private rate counter;
-- birou_intrare validates identity/schema/gates, with no business writes;
-- config_blocheaza / teren_radacini_blocheaza lock tables with no caller UPDATE;
-- pv_lipsa reads E3 evidence; gps_citeste is the sole authorized GPS reader;
-- teren_snapshot / birou_preview / proiect_config_citeste / teren_praguri read
-- config and related evidence without table grants to API/business writer roles;
-- emitere_blocaje / fisa_verifica read evidence; fisa_verifica checks project access.
-- INVOKER guards/pure helpers do not acquire their postgres owner's privileges.
CREATE FUNCTION public.fn_izo_config_blocheaza(p_tronson bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN PERFORM 1 FROM public.izo_tronson_config WHERE tronson_id=p_tronson FOR SHARE; END $f$;
CREATE FUNCTION public.fn_izo_teren_radacini_blocheaza(p_proiect bigint,p_toate boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
 PERFORM 1 FROM public.magazie_bucati WHERE proiect_id=p_proiect AND id=radacina_id ORDER BY id FOR UPDATE;
 IF p_toate THEN PERFORM 1 FROM public.magazie_bucati WHERE proiect_id=p_proiect ORDER BY id FOR UPDATE; END IF;
END $f$;
CREATE FUNCTION public.fn_izo_proiect_config_citeste(p_proiect bigint) RETURNS public.izo_proiect_config
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT c FROM public.izo_proiect_config c WHERE c.proiect_id=p_proiect
$f$;

-- Invoker: marker records the actual writer, and the trigger checks the exact image.
-- These helpers have no API EXECUTE privilege. Neither role is available to the API.
CREATE FUNCTION public.fn_izo_suduri_marcheaza(p_tabel text,p_inainte jsonb,p_dupa jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
BEGIN
 IF current_user NOT IN ('izo_teren_editor','izo_montaj_writer') THEN RAISE EXCEPTION 'scriitor_invalid' USING ERRCODE='42501'; END IF;
 PERFORM set_config('izo.suduri_proiectie',jsonb_build_object('tx',txid_current(),'rol',current_user,
  'tabel',p_tabel,'inainte',p_inainte,'dupa',p_dupa)::text,true);
END $f$;
CREATE FUNCTION public.fn_izo_suduri_garda() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_ctx jsonb:=nullif(current_setting('izo.suduri_proiectie',true),'')::jsonb; v_old jsonb; v_new jsonb;
BEGIN
 -- Administrative fixtures/repairs still pass table constraints and immutable journals.
 IF current_user='postgres' AND session_user='postgres' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); END IF;
 v_new:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN v_new:=v_new-'id'; END IF;
 IF current_user NOT IN ('izo_teren_editor','izo_montaj_writer') OR v_ctx IS NULL
  OR v_ctx->>'tx' IS DISTINCT FROM txid_current()::text OR v_ctx->>'rol' IS DISTINCT FROM current_user
  OR v_ctx->>'tabel' IS DISTINCT FROM TG_TABLE_NAME OR v_ctx->'inainte' IS DISTINCT FROM coalesce(v_old,'null'::jsonb)
  OR v_ctx->'dupa' IS DISTINCT FROM v_new THEN RAISE EXCEPTION 'suduri_proiectie' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $f$;

CREATE FUNCTION public.fn_izo_sudura_ins(p_decl bigint,p_nr integer,p_sufix text,p_tip text,p_executant text,p_poanson text,p_data date) RETURNS bigint
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_s public.izo_suduri;
BEGIN
 IF current_user<>'izo_teren_editor' THEN RAISE EXCEPTION 'scriitor_invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT v_d FROM public.izo_declaratii WHERE id=p_decl;
 v_s:=jsonb_populate_record(NULL::public.izo_suduri,jsonb_build_object('proiect_id',v_d.proiect_id,'tronson_id',v_d.tronson_id,
  'nr',p_nr,'sufix',p_sufix,'tip_sudura',p_tip,'stare','declarata','declaratie_id',p_decl,'executant',p_executant,
  'poanson',p_poanson,'data_sudura',p_data,'tranzitie_perete',false,'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_suduri_marcheaza('izo_suduri',NULL,to_jsonb(v_s)-'id');
 INSERT INTO public.izo_suduri(proiect_id,tronson_id,nr,sufix,tip_sudura,stare,declaratie_id,executant,poanson,data_sudura,server_ver)
 VALUES(v_s.proiect_id,v_s.tronson_id,v_s.nr,v_s.sufix,v_s.tip_sudura,v_s.stare,v_s.declaratie_id,v_s.executant,v_s.poanson,v_s.data_sudura,v_s.server_ver) RETURNING id INTO v_s.id;
 PERFORM public.fn_izo_suduri_marcheaza(NULL,NULL,NULL);
 RETURN v_s.id;
END $f$;
CREATE FUNCTION public.fn_izo_capat_ins(p_sudura bigint,p_parte text,p_bucata bigint,p_uid uuid,p_litera text,p_ev bigint) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_c public.izo_suduri_capete; v_s public.izo_suduri;
BEGIN
 SELECT * INTO STRICT v_s FROM public.izo_suduri WHERE id=p_sudura;
 IF current_user='izo_teren_editor' AND (v_s.stare<>'declarata' OR p_ev IS NOT NULL) THEN RAISE EXCEPTION 'sudura_finala' USING ERRCODE='42501'; END IF;
 v_c:=jsonb_populate_record(NULL::public.izo_suduri_capete,jsonb_build_object('sudura_id',p_sudura,'parte',p_parte,
  'bucata_id',p_bucata,'bucata_decl_uid',p_uid,'capat_litera',p_litera,'activ',true,'de_la_eveniment_id',p_ev,'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_suduri_marcheaza('izo_suduri_capete',NULL,to_jsonb(v_c)-'id');
 INSERT INTO public.izo_suduri_capete(sudura_id,parte,bucata_id,bucata_decl_uid,capat_litera,activ,de_la_eveniment_id,server_ver)
 VALUES(v_c.sudura_id,v_c.parte,v_c.bucata_id,v_c.bucata_decl_uid,v_c.capat_litera,v_c.activ,v_c.de_la_eveniment_id,v_c.server_ver);
 PERFORM public.fn_izo_suduri_marcheaza(NULL,NULL,NULL);
END $f$;
CREATE FUNCTION public.fn_izo_capat_modifica(p_id bigint,p_bucata bigint,p_uid uuid,p_activ boolean) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_c public.izo_suduri_capete; v_n public.izo_suduri_capete; v_stare text; v_count bigint;
BEGIN
 SELECT * INTO STRICT v_c FROM public.izo_suduri_capete WHERE id=p_id FOR UPDATE;
 SELECT stare INTO STRICT v_stare FROM public.izo_suduri WHERE id=v_c.sudura_id;
 v_n:=v_c; v_n.bucata_id:=p_bucata; v_n.bucata_decl_uid:=p_uid; v_n.activ:=p_activ; v_n.server_ver:=nextval('public.izo_server_ver_seq');
 IF NOT v_c.activ OR p_activ AND (current_user<>'izo_montaj_writer' OR v_c.bucata_decl_uid IS NULL
   OR p_uid IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.magazie_bucati WHERE id=p_bucata AND uid=v_c.bucata_decl_uid))
  OR current_user='izo_teren_editor' AND (v_stare<>'declarata' OR p_bucata IS DISTINCT FROM v_c.bucata_id OR p_uid IS DISTINCT FROM v_c.bucata_decl_uid)
 THEN RAISE EXCEPTION 'capat_tranzitie' USING ERRCODE='42501'; END IF;
 PERFORM public.fn_izo_suduri_marcheaza('izo_suduri_capete',to_jsonb(v_c),to_jsonb(v_n));
 IF current_user='izo_teren_editor' THEN
  UPDATE public.izo_suduri_capete SET activ=v_n.activ,server_ver=v_n.server_ver WHERE id=p_id;
 ELSE
  UPDATE public.izo_suduri_capete SET bucata_id=v_n.bucata_id,bucata_decl_uid=v_n.bucata_decl_uid,activ=v_n.activ,server_ver=v_n.server_ver WHERE id=p_id;
 END IF;
 GET DIAGNOSTICS v_count=ROW_COUNT; IF v_count<>1 THEN RAISE EXCEPTION 'capat_schimbat'; END IF;
 PERFORM public.fn_izo_suduri_marcheaza(NULL,NULL,NULL);
END $f$;
CREATE FUNCTION public.fn_izo_sudura_stare(p_id bigint,p_stare text,p_tranzitie boolean) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_s public.izo_suduri; v_n public.izo_suduri; v_count bigint;
BEGIN
 SELECT * INTO STRICT v_s FROM public.izo_suduri WHERE id=p_id FOR UPDATE;
 IF v_s.stare<>'declarata' OR p_stare NOT IN ('aprobata','anulata') OR p_stare IS NULL
  OR current_user='izo_teren_editor' AND p_stare<>'anulata' THEN RAISE EXCEPTION 'sudura_finala' USING ERRCODE='42501'; END IF;
 v_n:=v_s; v_n.stare:=p_stare; v_n.server_ver:=nextval('public.izo_server_ver_seq');
 IF p_stare='aprobata' THEN v_n.tranzitie_perete:=p_tranzitie; END IF;
 PERFORM public.fn_izo_suduri_marcheaza('izo_suduri',to_jsonb(v_s),to_jsonb(v_n));
 IF p_stare='anulata' THEN UPDATE public.izo_suduri SET stare=v_n.stare,server_ver=v_n.server_ver WHERE id=p_id;
 ELSE UPDATE public.izo_suduri SET stare=v_n.stare,tranzitie_perete=v_n.tranzitie_perete,server_ver=v_n.server_ver WHERE id=p_id; END IF;
 GET DIAGNOSTICS v_count=ROW_COUNT; IF v_count<>1 THEN RAISE EXCEPTION 'sudura_schimbata'; END IF;
 PERFORM public.fn_izo_suduri_marcheaza(NULL,NULL,NULL);
END $f$;
CREATE FUNCTION public.fn_izo_suduri_invalideaza(p_declaratii bigint[]) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_s public.izo_suduri; v_c public.izo_suduri_capete;
BEGIN
 FOR v_s IN SELECT * FROM public.izo_suduri WHERE declaratie_id=ANY(p_declaratii) AND stare='declarata' ORDER BY id LOOP
  FOR v_c IN SELECT * FROM public.izo_suduri_capete WHERE sudura_id=v_s.id AND activ ORDER BY id LOOP
   PERFORM public.fn_izo_capat_modifica(v_c.id,v_c.bucata_id,v_c.bucata_decl_uid,false);
  END LOOP;
  PERFORM public.fn_izo_sudura_stare(v_s.id,'anulata',NULL);
 END LOOP;
END $f$;

CREATE FUNCTION public.fn_izo_tranzitie_intern(p_sudura bigint,p_motiv text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_s public.izo_suduri; v_n public.izo_suduri; v_count bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT * INTO v_s FROM public.izo_suduri WHERE id=p_sudura;
 PERFORM public.fn_izo_birou_intrare(v_s.proiect_id,NULL,'fn_izo_tranzitie_intern');
 IF v_s.id IS NULL OR length(btrim(coalesce(p_motiv,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'parametri_invalizi'; END IF;
 PERFORM public.fn_izo_birou_autorizat(v_s.proiect_id,NULL,true);
 PERFORM public.fn_izo_blocheaza_locuri(v_s.proiect_id,ARRAY[]::integer[],ARRAY[v_s.tronson_id]);
 PERFORM public.fn_izo_blocheaza_tabele(); PERFORM public.fn_izo_lock_partajat(v_s.proiect_id);
 PERFORM 1 FROM public.magazie_bucati WHERE id IN (SELECT bucata_id FROM public.izo_suduri_capete WHERE sudura_id=p_sudura AND activ) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT v_s FROM public.izo_suduri WHERE id=p_sudura FOR UPDATE;
 IF v_s.stare<>'aprobata' OR NOT v_s.tranzitie_perete THEN RAISE EXCEPTION 'tranzitie_inexistenta'; END IF;
 IF v_s.tranzitie_confirmata_de IS NOT NULL THEN RETURN jsonb_build_object('cod','confirmata','sudura_id',v_s.id); END IF;
 v_n:=v_s; v_n.tranzitie_confirmata_de:=public.fn_izo_uid(); v_n.tranzitie_confirmata_la:=clock_timestamp();
 v_n.tranzitie_confirmata_motiv:=btrim(p_motiv); v_n.server_ver:=nextval('public.izo_server_ver_seq');
 PERFORM public.fn_izo_suduri_marcheaza('izo_suduri',to_jsonb(v_s),to_jsonb(v_n));
 UPDATE public.izo_suduri SET tranzitie_confirmata_de=v_n.tranzitie_confirmata_de,tranzitie_confirmata_la=v_n.tranzitie_confirmata_la,
  tranzitie_confirmata_motiv=v_n.tranzitie_confirmata_motiv,server_ver=v_n.server_ver WHERE id=p_sudura;
 GET DIAGNOSTICS v_count=ROW_COUNT; IF v_count<>1 THEN RAISE EXCEPTION 'sudura_schimbata'; END IF;
 PERFORM public.fn_izo_suduri_marcheaza(NULL,NULL,NULL);
 RETURN jsonb_build_object('cod','confirmata','sudura_id',v_s.id);
END $f$;
CREATE FUNCTION public.fn_izo_tranzitie_confirma(p_sudura bigint,p_motiv text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_tranzitie_intern(p_sudura,p_motiv)
$f$;
