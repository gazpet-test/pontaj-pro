  -- D1: operatia administrativa; lista se stabilizeaza inaintea oricarui FK.
  CREATE FUNCTION public.fn_izo_cor_storno_import(p_proiect bigint, p_import_id text, p_bucati bigint[], p_motiv text, p_cerut_de uuid) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_imp public.izo_importuri; v_cor public.izo_corectii; v_b public.magazie_bucati;
    v_event public.magazie_bucati_evenimente; v_move public.magazie_bucati_miscari;
    v_ev bigint; v_n bigint; v_refuz bigint[];
  BEGIN
    PERFORM public.fn_izo_cor_adm_verifica();
    IF session_user <> 'postgres' OR public.fn_izo_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'E3b administrativ' USING ERRCODE='42501'; END IF;
    IF NOT public.fn_izo_cor_cerut_de_valid(p_proiect,p_cerut_de) THEN
      RAISE EXCEPTION 'E3b: cerut_de neeligibil' USING ERRCODE='42501'; END IF;
    IF p_bucati IS NULL OR cardinality(p_bucati) NOT BETWEEN 1 AND 10000
      OR EXISTS (SELECT 1 FROM unnest(p_bucati) x WHERE x IS NULL)
      OR (SELECT count(DISTINCT x) FROM unnest(p_bucati) x) <> cardinality(p_bucati)
      OR p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: lista / motiv invalid' USING ERRCODE='22023'; END IF;
    PERFORM public.fn_izo_lock_proiect(p_proiect,true);
    SELECT imp.* INTO v_imp FROM public.izo_importuri imp WHERE imp.proiect_id=p_proiect AND imp.import_id=p_import_id;
    IF NOT FOUND OR v_imp.stare <> 'aplicat' THEN
      RAISE EXCEPTION 'E3b: import inexistent sau neaplicat' USING ERRCODE='22023'; END IF;
    PERFORM b.id FROM public.magazie_bucati b WHERE b.id=ANY(p_bucati) ORDER BY b.id FOR UPDATE;
    SELECT array_agg(x ORDER BY x) INTO v_refuz FROM unnest(p_bucati) x
      WHERE NOT EXISTS (SELECT 1 FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari mis ON mis.bucata_id=b.id
        WHERE b.id=x AND b.proiect_id=p_proiect AND b.provenienta='beneficiar' AND b.stare <> 'anulata'
          AND mis.eveniment_id=v_imp.eveniment_id AND mis.rol='nascut')
      OR EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.bucata_id=x AND cor.stare='propusa')
      OR EXISTS (SELECT 1 FROM public.fn_izo_lant_blocant(ARRAY[x],ARRAY[v_imp.eveniment_id]));
    IF v_refuz IS NOT NULL THEN
      RAISE EXCEPTION 'E3b: bucati neeligibile (origine, stare, propunere deschisa sau lant): %',v_refuz USING ERRCODE='22023'; END IF;
    INSERT INTO public.izo_corectii(proiect_id,tip,import_id,inainte,dupa,motiv,stare,versiune,cale,propus_de,propus_rol,propus_la)
      VALUES(p_proiect,'storno_import',p_import_id,NULL,NULL,btrim(p_motiv),'propusa',1,'direct',p_cerut_de,session_user,now()) RETURNING * INTO v_cor;
    INSERT INTO public.izo_corectii_bucati(corectie_id,bucata_id) SELECT v_cor.id,x FROM unnest(p_bucati) x ORDER BY x;
    PERFORM public.fn_izo_cor_marcheaza(v_cor.id);
    v_event:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,public.fn_izo_cor_eveniment_asteptat(v_cor));
    INSERT INTO public.magazie_bucati_evenimente(@@EV_COLS@@) SELECT @@EV_VALUES@@ RETURNING id INTO v_ev;
    FOR v_b IN SELECT b.* FROM public.magazie_bucati b WHERE b.id=ANY(p_bucati) ORDER BY b.id LOOP
      v_move:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,public.fn_izo_cor_miscare_asteptata(v_cor,v_b));
      INSERT INTO public.magazie_bucati_miscari(@@MIS_COLS@@) SELECT @@MIS_VALUES@@;
    END LOOP;
    WITH anulate AS (UPDATE public.magazie_bucati SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq'),updated_at=now()
      WHERE id=ANY(p_bucati) AND stare <> 'anulata' RETURNING id)
    SELECT count(*) INTO v_n FROM anulate;
    IF v_n <> cardinality(p_bucati) THEN RAISE EXCEPTION 'E3b: lista storno schimbata' USING ERRCODE='40001'; END IF;
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de=NULL,decis_rol=session_user,decis_la=now(),eveniment_id=v_ev WHERE id=v_cor.id;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_ev,'bucati_anulate',v_n);
  END $f$;

  CREATE FUNCTION public.fn_izo_lant_blocant(p_bucati bigint[], p_ev_proprii bigint[])
    RETURNS TABLE(bucata_id bigint, miscare_id bigint, eveniment_id bigint, tip text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF p_ev_proprii IS NULL OR EXISTS (SELECT 1 FROM unnest(p_ev_proprii) v_ev WHERE v_ev IS NULL) THEN
      RAISE EXCEPTION 'E3b: evenimente proprii invalide' USING ERRCODE='22023'; END IF;
    RETURN QUERY
    SELECT mis.bucata_id,mis.id,ev.id,ev.tip FROM public.magazie_bucati_miscari mis
      JOIN public.magazie_bucati_evenimente ev ON ev.id=mis.eveniment_id
      WHERE mis.bucata_id=ANY(p_bucati) AND NOT (mis.eveniment_id=ANY(p_ev_proprii))
        AND NOT EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.stare='aplicata'
          AND cor.tip IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare')
          AND cor.eveniment_id=ev.id AND ev.document_tip='izo_corectie' AND ev.document_id=cor.id::text);
  END;
  $f$;

  CREATE FUNCTION public.fn_izo_doc_diff(p_anterior jsonb, p_curent jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_result jsonb:='{}'; v_sec text; v_old jsonb; v_new jsonb; v_changes jsonb;
    v_add jsonb; v_del jsonb; v_mod jsonb; v_id text; v_idkey text;
  BEGIN
    IF p_anterior IS NULL THEN RETURN p_curent; END IF;
    FOREACH v_sec IN ARRAY ARRAY['antet','aviz','lista','totaluri'] LOOP
      SELECT coalesce(jsonb_object_agg(k,jsonb_build_array(p_anterior->v_sec->k,p_curent->v_sec->k)),'{}') INTO v_changes
        FROM (SELECT jsonb_object_keys(p_anterior->v_sec) k UNION SELECT jsonb_object_keys(p_curent->v_sec)) keys
        WHERE p_anterior->v_sec->k IS DISTINCT FROM p_curent->v_sec->k;
      v_result:=v_result||jsonb_build_object(v_sec,v_changes);
    END LOOP;
    FOREACH v_sec IN ARRAY ARRAY['randuri','scanuri'] LOOP
      v_idkey:=CASE v_sec WHEN 'randuri' THEN 'nr_crt' ELSE 'cale' END;
      v_add:='[]'; v_del:='[]'; v_mod:='{}';
      FOR v_id IN SELECT x->>v_idkey FROM jsonb_array_elements(p_anterior->v_sec) x
        UNION SELECT x->>v_idkey FROM jsonb_array_elements(p_curent->v_sec) x ORDER BY 1 LOOP
        SELECT x INTO v_old FROM jsonb_array_elements(p_anterior->v_sec) x WHERE x->>v_idkey=v_id;
        SELECT x INTO v_new FROM jsonb_array_elements(p_curent->v_sec) x WHERE x->>v_idkey=v_id;
        IF v_old IS NULL THEN v_add:=v_add||jsonb_build_array(v_new);
        ELSIF v_new IS NULL THEN v_del:=v_del||jsonb_build_array(v_old);
        ELSIF v_old IS DISTINCT FROM v_new THEN
          SELECT jsonb_object_agg(k,jsonb_build_array(v_old->k,v_new->k)) INTO v_changes
            FROM (SELECT jsonb_object_keys(v_old) k UNION SELECT jsonb_object_keys(v_new)) keys WHERE v_old->k IS DISTINCT FROM v_new->k;
          v_mod:=v_mod||jsonb_build_object(v_id,v_changes);
        END IF;
      END LOOP;
      v_result:=v_result||jsonb_build_object(v_sec,jsonb_build_object('adaugate',v_add,
        CASE v_sec WHEN 'randuri' THEN 'sterse' ELSE 'scoase' END,v_del,'modificate',v_mod));
    END LOOP;
    RETURN v_result;
  END $f$;

  CREATE FUNCTION public.fn_izo_doc_ist_garda() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_doc public.izo_documente_intrare; v_old jsonb; v_content jsonb; v_hash text;
  BEGIN
    IF TG_OP <> 'INSERT' OR current_user <> 'izo_doc_editor' THEN
      RAISE EXCEPTION 'E3b: istoric imutabil' USING ERRCODE='42501'; END IF;
    SELECT doc.* INTO v_doc FROM public.izo_documente_intrare doc WHERE doc.id=NEW.document_id FOR UPDATE;
    IF NOT FOUND OR v_doc.stare <> 'draft' OR NEW.versiune IS DISTINCT FROM v_doc.versiune
      OR NEW.salvat_de IS DISTINCT FROM public.fn_izo_uid() OR NEW.salvat_rol IS DISTINCT FROM session_user::text
      OR NEW.salvat_la IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'E3b: identitate / versiune istoric invalida' USING ERRCODE='42501'; END IF;
    SELECT ist.continut INTO v_old FROM public.izo_documente_istoric ist WHERE ist.document_id=NEW.document_id ORDER BY ist.versiune DESC LIMIT 1;
    v_content:=public.fn_izo_doc_instantaneu(NEW.document_id);
    v_hash:='e3-doc-v1:'||encode(sha256(convert_to(v_content::text,'UTF8')),'hex');
    IF NEW.continut IS DISTINCT FROM v_content OR NEW.hash IS DISTINCT FROM v_hash
      OR NEW.hash IS DISTINCT FROM public.fn_izo_doc_hash(NEW.document_id)
      OR NEW.diff IS DISTINCT FROM public.fn_izo_doc_diff(v_old,v_content) OR NEW.baza IS DISTINCT FROM (v_old IS NULL) THEN
      RAISE EXCEPTION 'E3b: continut istoric diferit' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER trg_izo_doc_ist_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_documente_istoric
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_doc_ist_garda();
  CREATE TRIGGER trg_izo_doc_ist_truncate BEFORE TRUNCATE ON public.izo_documente_istoric
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_doc_ist_garda();
  ALTER TABLE public.izo_documente_istoric ENABLE ALWAYS TRIGGER trg_izo_doc_ist_garda;
  ALTER TABLE public.izo_documente_istoric ENABLE ALWAYS TRIGGER trg_izo_doc_ist_truncate;
