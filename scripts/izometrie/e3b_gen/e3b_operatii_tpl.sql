  -- C1: frontiera de propuneri (§1, §4, §5.6).
  CREATE FUNCTION public.fn_izo_cor_propune(p_tip text, p_proiect bigint, p_bucata_id bigint, p_detalii jsonb, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_b public.magazie_bucati; v_cor public.izo_corectii; v_dep integer; v_doc bigint; v_keys text[];
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    IF p_tip IS NULL OR p_tip NOT IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare','gasit_nou')
      OR p_proiect IS NULL OR (p_tip='gasit_nou') <> (p_bucata_id IS NULL)
      OR jsonb_typeof(p_detalii) IS DISTINCT FROM 'object' OR p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: cerere invalidă' USING ERRCODE='22023'; END IF;
    IF p_tip='gasit_nou' THEN
      v_dep := (p_detalii->>'depozit_id')::integer; v_doc := (p_detalii->>'document_intrare_id')::bigint;
    ELSE
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=p_bucata_id AND b.proiect_id=p_proiect AND b.provenienta='beneficiar';
      v_dep := CASE WHEN v_b.locatie_tip='tronson' THEN (v_b.atribute->>'depozit_origine_id')::integer ELSE v_b.depozit_id END;
    END IF;
    v_keys := public.fn_izo_cor_chei(p_tip,CASE WHEN p_tip='gasit_nou' THEN p_detalii->>'tip_cod' ELSE v_b.tip_cod END,'propunere');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_detalii) k WHERE NOT k=ANY(v_keys)) THEN
      RAISE EXCEPTION 'E3b: cheie în afara listei albe; trimite separat identitatea' USING ERRCODE='22023'; END IF;
    IF v_doc IS NOT NULL AND public.fn_izo_cor_doc_lock(v_doc,p_proiect) IS NOT TRUE THEN
      RAISE EXCEPTION 'E3b: document inexistent sau inaccesibil' USING ERRCODE='42501'; END IF;
    IF NOT public.fn_izo_cor_autorizare_lock(p_proiect,'responsabil',NULL)
      AND NOT public.fn_izo_cor_autorizare_lock(p_proiect,'gestionar',v_dep) THEN
      RAISE EXCEPTION 'E3b: bucata nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF p_tip <> 'gasit_nou' THEN
      v_b := jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_lock(p_bucata_id,p_proiect));
      IF v_b.id IS NULL THEN RAISE EXCEPTION 'E3b: bucata nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
      IF (CASE WHEN v_b.locatie_tip='tronson' THEN (v_b.atribute->>'depozit_origine_id')::integer ELSE v_b.depozit_id END) IS DISTINCT FROM v_dep THEN RAISE EXCEPTION 'E3b: bucata s-a mutat, reîncearcă' USING ERRCODE='40001'; END IF;
    END IF;
    INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,document_intrare_id,inainte,dupa,ncr_ref,motiv,stare,versiune,cale,propus_de,propus_rol,propus_la)
      VALUES(p_proiect,p_tip,p_bucata_id,v_doc,NULL,p_detalii,
        CASE WHEN p_tip IN ('carantina_intrare','carantina_iesire') THEN btrim(p_detalii->>'ncr_ref') END,
        btrim(p_motiv),'propusa',1,NULL,v_uid,session_user,now()) RETURNING * INTO v_cor;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'versiune',v_cor.versiune,'stare',v_cor.stare,'inainte',v_cor.inainte,'dupa',v_cor.dupa);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'E3b: există deja o corecție deschisă pe bucată' USING ERRCODE='23505';
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'E3b: identificator invalid' USING ERRCODE='22023';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_retrage(p_corectie_id bigint, p_versiune bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id FOR UPDATE;
    -- gestionar cu depozit NULL nu poate avea atribuire: helper-ul admite aici numai owner-ul.
    IF NOT FOUND OR NOT public.fn_izo_citire(v_cor.proiect_id) OR
      (v_uid IS DISTINCT FROM v_cor.propus_de AND NOT public.fn_izo_cor_autorizare_lock(v_cor.proiect_id,'gestionar',NULL)) THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF v_cor.cale <> 'propunere' OR v_cor.stare <> 'propusa' OR p_versiune IS DISTINCT FROM v_cor.versiune THEN
      RAISE EXCEPTION 'E3b: corecția s-a schimbat, reîncarcă' USING ERRCODE='40001'; END IF;
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: motiv invalid' USING ERRCODE='22023'; END IF;
    UPDATE public.izo_corectii SET stare='retrasa',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),motiv_decizie=btrim(p_motiv)
      WHERE id=v_cor.id RETURNING * INTO v_cor;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'versiune',v_cor.versiune,'stare',v_cor.stare);
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_respinge(p_corectie_id bigint, p_versiune bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id FOR UPDATE;
    IF NOT FOUND OR NOT public.fn_izo_cor_autorizare_lock(v_cor.proiect_id,'responsabil',NULL) OR v_uid=v_cor.propus_de THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces; patru ochi obligatoriu' USING ERRCODE='42501'; END IF;
    IF v_cor.cale <> 'propunere' OR v_cor.stare <> 'propusa' OR p_versiune IS DISTINCT FROM v_cor.versiune THEN
      RAISE EXCEPTION 'E3b: corecția s-a schimbat, reîncarcă' USING ERRCODE='40001'; END IF;
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: motiv invalid' USING ERRCODE='22023'; END IF;
    UPDATE public.izo_corectii SET stare='respinsa',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),motiv_decizie=btrim(p_motiv)
      WHERE id=v_cor.id RETURNING * INTO v_cor;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'versiune',v_cor.versiune,'stare',v_cor.stare);
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_verifica(p_corectie_id bigint, p_tip text, p_proiect bigint, p_bucata_id bigint, p_detalii jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii; v_b public.magazie_bucati; v_after public.magazie_bucati;
    v_raw jsonb; v_dupa jsonb; v_inainte jsonb; v_bloc jsonb := '[]'; v_avert jsonb := '[]'; v_col jsonb; v_saved boolean;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    v_saved := p_corectie_id IS NOT NULL;
    IF (v_saved AND num_nonnulls(p_tip,p_proiect,p_bucata_id,p_detalii)<>0)
      OR (NOT v_saved AND (p_tip IS NULL OR p_proiect IS NULL OR p_detalii IS NULL
        OR p_tip NOT IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare','gasit_nou')
        OR (p_tip='gasit_nou') <> (p_bucata_id IS NULL))) THEN
      RAISE EXCEPTION 'E3b: alege exact un mod de verificare' USING ERRCODE='22023'; END IF;
    IF v_saved THEN
      SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    ELSE
      v_cor.tip:=p_tip; v_cor.proiect_id:=p_proiect; v_cor.bucata_id:=p_bucata_id; v_cor.dupa:=p_detalii; v_cor.cale:='propunere';
      IF p_tip='camp' AND NOT p_detalii ?| public.fn_izo_coloane_identitate() THEN v_cor.cale:='direct'; END IF;
      v_cor.document_intrare_id:=CASE WHEN p_tip='gasit_nou' THEN (p_detalii->>'document_intrare_id')::bigint END;
      v_cor.ncr_ref:=CASE WHEN p_tip IN ('carantina_intrare','carantina_iesire') THEN btrim(p_detalii->>'ncr_ref') END;
    END IF;
    IF NOT public.fn_izo_citire(v_cor.proiect_id) THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF v_cor.bucata_id IS NOT NULL THEN
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id AND b.proiect_id=v_cor.proiect_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'E3b: bucata nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    END IF;
    -- Reconstituim cererea din forma normalizată stocată de gardă.
    v_raw:=v_cor.dupa;
    IF v_saved THEN
      IF v_cor.tip='camp' THEN v_raw:=v_raw-ARRAY['lungime_mm','lungime_m','lungime_originala_m'];
      ELSIF v_cor.tip='gasit_nou' THEN v_raw:=v_raw-ARRAY['lungime_mm','lungime_m','lungime_originala_m'];
      ELSIF v_cor.tip IN ('carantina_intrare','carantina_iesire') THEN
        v_raw:=jsonb_build_object('ncr_ref',v_cor.ncr_ref);
        IF v_cor.tip='carantina_iesire' AND NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.bucata_id=v_b.id AND mis.stare_dupa='carantina' AND mis.rol='stare' AND mis.stare_inainte IN ('sosit','receptionat')) AND v_b.aviz_intrare_id IS NULL THEN v_raw:=v_raw||v_cor.dupa; END IF;
      ELSIF v_cor.tip='pierdut' THEN v_raw:=jsonb_build_object('cauza',v_cor.inainte->>'cauza');
      ELSIF v_cor.tip='gasit_recuperare' THEN v_raw:=v_raw-'stare'; END IF;
      IF v_cor.stare <> 'propusa' THEN v_bloc:=v_bloc||jsonb_build_array('Corecția este închisă'); END IF;
    END IF;
    BEGIN
      IF coalesce(public.fn_izo_nivel(v_cor.proiect_id),'off') NOT IN ('stoc','montaj') THEN
        RAISE EXCEPTION 'Proiect inactiv' USING ERRCODE='22023'; END IF;
      v_inainte:=public.fn_izo_cor_inainte(v_cor);
      IF v_cor.tip='pierdut' AND v_saved THEN v_inainte:=v_inainte||jsonb_build_object('cauza',v_cor.inainte->>'cauza'); END IF;
      IF v_saved AND v_inainte IS DISTINCT FROM v_cor.inainte THEN v_bloc:=v_bloc||jsonb_build_array('Bucata s-a schimbat de la propunere'); END IF;
      v_cor.dupa:=v_raw; v_dupa:=public.fn_izo_cor_valideaza(v_cor);
      IF v_cor.tip='gasit_nou' THEN v_after:=jsonb_populate_record(NULL::public.magazie_bucati,v_dupa||jsonb_build_object('cod_bucata','AB'));
      ELSE v_after:=jsonb_populate_record(v_b,v_dupa); END IF;
      IF v_cor.tip IN ('camp','gasit_nou') THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('bucata_id',b.id,'proiect_id',b.proiect_id,'stare',b.stare)),'[]') INTO v_col
          FROM public.magazie_bucati b WHERE public.fn_izo_citire(b.proiect_id) AND b.id IS DISTINCT FROM v_b.id
          @@COLLISION_PRED@@;
        v_bloc:=v_bloc||v_col;
        v_avert:=v_avert||jsonb_build_array('Verificarea nu certifică disponibilitatea globală a seriei');
        IF EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.tip='gasit_nou' AND cor.stare='propusa'
          AND cor.id IS DISTINCT FROM v_cor.id AND public.fn_izo_citire(cor.proiect_id)
          AND public.fn_izo_canon_serie(cor.dupa->>'serie')=public.fn_izo_canon_serie(v_after.serie)) THEN
          v_avert:=v_avert||jsonb_build_array('Există propuneri vizibile pentru aceeași serie'); END IF;
      END IF;
      IF v_cor.tip='camp' AND v_b.aviz_intrare_id IS NOT NULL THEN
        v_avert:=v_avert||jsonb_build_array('Corecția nu rescrie rândul documentului de intrare'); END IF;
    EXCEPTION WHEN SQLSTATE '22023' THEN v_bloc:=v_bloc||jsonb_build_array(SQLERRM);
    END;
    RETURN jsonb_build_object('ok',v_bloc='[]'::jsonb,'blocante',v_bloc,'avertismente',v_avert,'inainte',v_inainte,
      'dupa_efectiv',v_dupa,'versiune',v_cor.versiune);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'E3b: valoare invalidă' USING ERRCODE='22023';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_aproba(p_corectie_id bigint, p_versiune bigint) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii; v_b public.magazie_bucati; v_after public.magazie_bucati;
    v_doc bigint; v_doc_ok boolean; v_new bigint; v_ev bigint; v_raw jsonb; v_norm jsonb; v_event public.magazie_bucati_evenimente;
    v_move public.magazie_bucati_miscari;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id;
    IF NOT FOUND OR NOT public.fn_izo_citire(v_cor.proiect_id) THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    SELECT b.aviz_intrare_id INTO v_doc FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id AND b.proiect_id=v_cor.proiect_id;
    v_doc:=coalesce(v_doc,v_cor.document_intrare_id);
    IF v_doc IS NOT NULL THEN
      SELECT (doc.stare='confirmat') INTO v_doc_ok FROM public.izo_documente_intrare doc
        WHERE doc.id=v_doc AND doc.proiect_id=v_cor.proiect_id FOR SHARE;
    END IF;
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id FOR UPDATE;
    IF NOT public.fn_izo_cor_autorizare_lock(v_cor.proiect_id,'responsabil',NULL) OR v_uid=v_cor.propus_de OR v_cor.cale<>'propunere' THEN
      RAISE EXCEPTION 'E3b: acces refuzat; patru ochi obligatoriu' USING ERRCODE='42501'; END IF;
    IF v_cor.stare='aplicata' AND v_cor.versiune=p_versiune+1 AND v_cor.decis_de=v_uid THEN
      RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_cor.eveniment_id,'bucata_id',v_cor.bucata_id,
        'stare_dupa',CASE WHEN v_cor.tip='gasit_nou' THEN 'carantina' WHEN v_cor.tip='camp' THEN (SELECT b.stare FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id) ELSE v_cor.dupa->>'stare' END,'versiune',v_cor.versiune,'idempotent',true); END IF;
    IF v_cor.stare<>'propusa' OR p_versiune IS DISTINCT FROM v_cor.versiune THEN
      RAISE EXCEPTION 'E3b: corecția s-a schimbat, reîncarcă' USING ERRCODE='40001'; END IF;
    IF v_cor.tip IN ('gasit_nou','gasit_recuperare') THEN
      PERFORM public.fn_izo_blocheaza_locuri(v_cor.proiect_id,ARRAY[(v_cor.dupa->>'depozit_id')::integer],ARRAY[]::bigint[]); END IF;
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(VARIADIC ARRAY[v_cor.proiect_id]);
    IF v_cor.bucata_id IS NOT NULL THEN
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id AND b.proiect_id=v_cor.proiect_id FOR UPDATE;
      IF NOT FOUND OR (CASE WHEN v_cor.tip='camp' THEN public.fn_izo_cor_inainte(v_cor) ELSE public.fn_izo_cor_inainte(v_cor)-'cauza' END) IS DISTINCT FROM (CASE WHEN v_cor.tip='camp' THEN v_cor.inainte ELSE v_cor.inainte-'cauza' END) THEN
        RAISE EXCEPTION 'E3b: bucata s-a schimbat de la propunere, propune din nou' USING ERRCODE='40001'; END IF;
    END IF;
    IF (v_doc IS NOT NULL AND v_doc_ok IS NOT TRUE) OR coalesce(public.fn_izo_nivel(v_cor.proiect_id),'off') NOT IN ('stoc','montaj') THEN
      RAISE EXCEPTION 'E3b: proiectul sau documentul s-a schimbat' USING ERRCODE='40001'; END IF;
    BEGIN
    v_raw:=v_cor.dupa;
    IF v_cor.tip IN ('camp','gasit_nou') THEN v_raw:=v_raw-ARRAY['lungime_mm','lungime_m','lungime_originala_m'];
    ELSIF v_cor.tip IN ('carantina_intrare','carantina_iesire') THEN
      v_raw:=jsonb_build_object('ncr_ref',v_cor.ncr_ref);
      IF v_cor.tip='carantina_iesire' AND public.fn_izo_cor_tinta_iesire(v_b) IS NULL THEN v_raw:=v_raw||v_cor.dupa; END IF;
    ELSIF v_cor.tip='pierdut' THEN v_raw:=jsonb_build_object('cauza',v_cor.inainte->>'cauza');
    ELSIF v_cor.tip='gasit_recuperare' THEN v_raw:=v_raw-'stare'; END IF;
    v_cor.dupa:=v_raw; v_norm:=public.fn_izo_cor_valideaza(v_cor);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      RAISE EXCEPTION 'E3b: datele propunerii nu mai sunt aplicabile, propune din nou' USING ERRCODE='40001';
    END;
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id;
    IF v_norm IS DISTINCT FROM v_cor.dupa THEN RAISE EXCEPTION 'E3b: ținta s-a schimbat, propune din nou' USING ERRCODE='40001'; END IF;
    IF v_cor.tip IN ('camp','gasit_nou') THEN
      IF v_cor.tip='gasit_nou' THEN v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_noua(v_cor));
      ELSE v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_dupa(v_cor,v_b)); END IF;
      IF EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.id IS DISTINCT FROM v_b.id @@COLLISION_PRED@@) THEN
        RAISE EXCEPTION 'E3b: conflict de unicitate în registru' USING ERRCODE='23505'; END IF;
    END IF;
    v_new:=public.fn_izo_cor_marcheaza(v_cor.id);
    v_event:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,public.fn_izo_cor_eveniment_asteptat(v_cor));
    INSERT INTO public.magazie_bucati_evenimente(@@EV_COLS@@) SELECT @@EV_VALUES@@ RETURNING id INTO v_ev;
    IF v_cor.tip='gasit_nou' THEN
      v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_noua(v_cor));
      v_after.id:=v_new; v_after.uid:=gen_random_uuid(); v_after.radacina_id:=v_new; v_after.server_ver:=nextval('public.izo_server_ver_seq');
      INSERT INTO public.magazie_bucati(/*C*/ @@INS_COLS@@) SELECT @@INS_VALUES@@ RETURNING * INTO v_b;
    END IF;
    v_move:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,public.fn_izo_cor_miscare_asteptata(v_cor,v_b));
    INSERT INTO public.magazie_bucati_miscari(@@MIS_COLS@@) SELECT @@MIS_VALUES@@;
    IF v_cor.tip<>'gasit_nou' THEN
      v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_dupa(v_cor,v_b));
      UPDATE public.magazie_bucati SET @@UPDATE_VALUES@@,server_ver=nextval('public.izo_server_ver_seq'),updated_at=now() WHERE id=v_b.id;
    END IF;
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),
      eveniment_id=v_ev,bucata_id=v_b.id WHERE id=v_cor.id RETURNING * INTO v_cor;
    -- contextul rămâne până la sfârșitul tranzacției (legat de txid, ca la E3); fără scriere de GUC în intrarea expusă (gate 0e)
    RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_ev,'bucata_id',v_b.id,'stare_dupa',v_after.stare,
      'versiune',v_cor.versiune,'idempotent',false);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'E3b: conflict de unicitate în registru' USING ERRCODE='23505';
  END $f$;
