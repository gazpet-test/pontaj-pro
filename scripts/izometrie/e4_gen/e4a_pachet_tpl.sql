  -- E4a-2. API wrappers contain no context setter; internal entries are not executable by API roles.
  IF EXISTS(SELECT 1 FROM public.magazie_bucati WHERE tip_cod IS NOT NULL AND executie_teava_id IS NOT NULL) THEN
    RAISE EXCEPTION 'E4a preflight: bucati deja legate'; END IF;
  CREATE UNIQUE INDEX ux_magbuc_izo_teava ON public.magazie_bucati(executie_teava_id)
    WHERE executie_teava_id IS NOT NULL AND tip_cod IS NOT NULL AND stare <> 'anulata';

  CREATE FUNCTION public.fn_izo_flux_pachet_lock(p_teava bigint,p_pachet bigint,p_updated_at timestamptz)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_p public.executie_pachete_lansare; v_t public.executie_tevi; v_id bigint;
    v_pr bigint; v_tr bigint; v_owner boolean; v_uid uuid; v_lipsa text[];
  BEGIN
    IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'E4a READ COMMITTED' USING ERRCODE='25001'; END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF session_user<>'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
    v_uid:=public.fn_izo_uid();
    IF coalesce(current_setting('izo.montaj_ctx',true),'')<>''
      OR coalesce(current_setting('izo.receptie_ctx',true),'')<>''
      OR coalesce(current_setting('izo.registru_tx',true),'')<>'' THEN RAISE EXCEPTION 'context_ocupat'; END IF;
    v_id:=p_pachet;
    IF p_teava IS NOT NULL THEN SELECT pachet_id INTO v_id FROM public.executie_tevi WHERE id=p_teava; END IF;
    SELECT proiect_id,tronson_id INTO v_pr,v_tr FROM public.executie_pachete_lansare WHERE id=v_id;
    IF v_pr IS NULL THEN RAISE EXCEPTION 'pachet_lipsa'; END IF;
    -- Early refusal avoids the legacy row -> package lock order on non-flow tronsoane.
    IF NOT EXISTS(SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=v_tr AND flux_montaj) THEN RAISE EXCEPTION 'flux_inactiv'; END IF;
    SELECT is_owner INTO v_owner FROM public.profiles WHERE id=v_uid AND employee_id IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
    IF v_owner IS NOT TRUE THEN
      PERFORM 1 FROM public.user_module_access WHERE profile_id=v_uid AND module='executie.izometrie'
        AND access_level IN ('editor','admin') FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
      PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=v_uid AND proiect_id=v_pr AND activ
        AND rol IN ('manager_aprobator','inlocuitor_aprobator') AND depozit_id IS NULL
        AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date) ORDER BY id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
    END IF;
    v_lipsa:=public.fn_izo_porti_lipsa();
    IF cardinality(v_lipsa)<>0 THEN RAISE EXCEPTION 'E4a porti %',v_lipsa; END IF;
    PERFORM public.fn_izo_blocheaza_locuri(v_pr,ARRAY[]::integer[],ARRAY[v_tr]);
    SELECT * INTO v_p FROM public.executie_pachete_lansare WHERE id=v_id FOR NO KEY UPDATE;
    PERFORM 1 FROM public.executie_tronsoane WHERE id=v_tr FOR SHARE;
    -- All package rows, including rows touched by renumber/km cascades, in id order.
    PERFORM 1 FROM public.executie_tevi WHERE pachet_id=v_id ORDER BY id FOR NO KEY UPDATE;
    IF p_teava IS NOT NULL THEN SELECT * INTO v_t FROM public.executie_tevi WHERE id=p_teava; END IF;
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(v_pr);
    IF v_p.proiect_id IS DISTINCT FROM v_pr OR v_p.tronson_id IS DISTINCT FROM v_tr
      OR v_pr IS DISTINCT FROM (SELECT proiect_id FROM public.executie_tronsoane WHERE id=v_tr)
      OR (p_teava IS NOT NULL AND v_t.pachet_id IS DISTINCT FROM v_id) THEN RAISE EXCEPTION 'pachet_schimbat'; END IF;
    IF coalesce(public.fn_izo_nivel(v_pr),'off') NOT IN ('stoc','montaj') OR NOT EXISTS
      (SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=v_tr AND flux_montaj) THEN RAISE EXCEPTION 'flux_inactiv'; END IF;
    IF p_updated_at IS NOT NULL AND p_updated_at IS DISTINCT FROM
      ((CASE WHEN p_teava IS NULL THEN to_jsonb(v_p) ELSE to_jsonb(v_t) END)->>'updated_at')::timestamptz
      THEN RAISE EXCEPTION 'pachet_schimbat'; END IF;
    RETURN jsonb_build_object('pachet',to_jsonb(v_p),'teava',to_jsonb(v_t));
  END $f$;

  CREATE FUNCTION public.fn_izo_flux_pachet_editabil(p_pachet jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF p_pachet->>'status' IS DISTINCT FROM 'draft' OR EXISTS
      (SELECT 1 FROM jsonb_each(p_pachet) e WHERE (e.key LIKE 'aprobat_%' OR e.key LIKE 'pdf_aprobare_%') AND e.value<>'null'::jsonb)
      THEN RAISE EXCEPTION 'pachet_needitabil'; END IF;
  END $f$;

  CREATE FUNCTION public.fn_izo_flux_pachet_identitate(p_b public.magazie_bucati) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_rad public.magazie_bucati; v_dim text;
  BEGIN
    SELECT * INTO v_rad FROM public.magazie_bucati WHERE id=coalesce(p_b.radacina_id,p_b.id);
    v_dim:=CASE WHEN p_b.diametru_mm IS NOT NULL OR p_b.perete_mm IS NOT NULL THEN
      coalesce(p_b.diametru_mm::text,'') || 'X' || coalesce(p_b.perete_mm::text,'') ||
      CASE WHEN p_b.tip_cod='curba' AND p_b.unghi_curba IS NOT NULL THEN ' ' || p_b.unghi_curba::text || '°' ELSE '' END END;
    RETURN jsonb_build_object('serie_unica',p_b.serie,'sarja',p_b.sarja,'lot',p_b.lot,
      'lungime_m',p_b.lungime_mm/1000.0,'lungime_originala_m',coalesce(v_rad.lungime_mm/1000.0,v_rad.lungime_m),
      'tip',CASE WHEN p_b.tip_cod='curba' THEN 'CIC' ELSE p_b.grad_otel END,'dimensiune',v_dim,'unghi_curba',CASE WHEN p_b.tip_cod='curba' AND p_b.unghi_curba IS NOT NULL THEN p_b.unghi_curba::text || '°' END);
  END $f$;

  CREATE FUNCTION public.fn_izo_flux_pachet_legatura(p_teava bigint,p_bucata bigint,p_updated_at timestamptz,p_motiv text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_lock jsonb; v_p jsonb; v_t public.executie_tevi; v_b public.magazie_bucati;
    v_veche bigint; v_patch jsonb; v_ctx text; v_now timestamptz:=clock_timestamp();
    v_dupa public.magazie_bucati;
  BEGIN
    IF p_bucata IS NOT NULL AND p_updated_at IS NULL THEN RAISE EXCEPTION 'pachet_schimbat'; END IF;
    IF p_bucata IS NULL AND length(btrim(coalesce(p_motiv,'')))<3 THEN RAISE EXCEPTION 'motiv_obligatoriu'; END IF;
    v_lock:=public.fn_izo_flux_pachet_lock(p_teava,NULL,p_updated_at);
    v_p:=v_lock->'pachet'; v_t:=jsonb_populate_record(NULL::public.executie_tevi,v_lock->'teava');
    IF v_t.tip_rand NOT IN ('teava','curba') THEN RAISE EXCEPTION 'rand_fara_bucata'; END IF;
    -- Natural idempotence is allowed even on an approved package; no stamp/write.
    SELECT id INTO v_veche FROM public.magazie_bucati WHERE executie_teava_id=p_teava AND tip_cod IS NOT NULL AND stare<>'anulata';
    IF p_bucata IS NOT NULL AND v_veche=p_bucata THEN RETURN jsonb_build_object('cod','fara_efect'); END IF;
    PERFORM public.fn_izo_flux_pachet_editabil(v_p);
    IF p_bucata IS NOT NULL AND v_veche IS NOT NULL THEN RAISE EXCEPTION 'rand_deja_legat'; END IF;
    SELECT * INTO v_b FROM public.magazie_bucati WHERE id=coalesce(p_bucata,v_veche) FOR UPDATE;
    IF p_bucata IS NULL AND NOT FOUND THEN RETURN jsonb_build_object('cod','fara_efect'); END IF;
    IF NOT FOUND OR v_b.proiect_id IS DISTINCT FROM (v_p->>'proiect_id')::bigint
      OR v_b.tronson_id IS DISTINCT FROM (v_p->>'tronson_id')::bigint OR v_b.stare<>'montata'
      OR v_b.tip_cod IS DISTINCT FROM v_t.tip_rand THEN RAISE EXCEPTION 'bucata_incompatibila'; END IF;
    IF p_bucata IS NOT NULL AND v_b.executie_teava_id IS NOT NULL THEN RAISE EXCEPTION 'bucata_deja_legata'; END IF;
    -- Expected stored image uses the same typed values as UPDATE.
    -- fn_izo_garda_montaj restores the two generated columns absent from BEFORE NEW.
    v_dupa:=v_b;
    v_dupa.executie_teava_id:=CASE WHEN p_bucata IS NOT NULL THEN p_teava END;
    v_dupa.server_ver:=nextval('public.izo_server_ver_seq'); v_dupa.updated_at:=v_now;
    v_ctx:=concat_ws('|',txid_current()::text,CASE WHEN p_bucata IS NULL THEN 'dezleaga' ELSE 'leaga' END,
      v_p->>'id',v_p->>'proiect_id',v_p->>'tronson_id',v_dupa.server_ver::text,v_b.id::text);
    IF p_bucata IS NOT NULL THEN
      v_patch:=public.fn_izo_flux_pachet_identitate(v_b)||jsonb_build_object('updated_at',v_now);
    ELSE
      v_patch:=jsonb_build_object('updated_at',v_now);
    END IF;
    v_t:=jsonb_populate_record(v_t,v_patch);
    PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa),to_jsonb(v_t));
    UPDATE public.magazie_bucati SET executie_teava_id=v_dupa.executie_teava_id,
      server_ver=v_dupa.server_ver,updated_at=v_dupa.updated_at WHERE id=v_b.id;
    UPDATE public.executie_tevi SET serie_unica=v_t.serie_unica,sarja=v_t.sarja,lot=v_t.lot,
      lungime_m=v_t.lungime_m,lungime_originala_m=v_t.lungime_originala_m,
      tip=v_t.tip,dimensiune=v_t.dimensiune,unghi_curba=v_t.unghi_curba,updated_at=v_now WHERE id=p_teava;
    UPDATE public.executie_pachete_lansare SET updated_at=v_now WHERE id=(v_p->>'id')::bigint;
    PERFORM public.fn_izo_montaj_marcheaza(NULL,NULL,NULL,NULL);
    RETURN jsonb_build_object('cod',CASE WHEN p_bucata IS NULL THEN 'dezlegat' ELSE 'legat' END,'pachet_updated_at',v_now);
  END $f$;

  CREATE FUNCTION public.fn_izo_pachet_leaga(p_teava bigint,p_bucata bigint,p_updated_at timestamptz) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF p_bucata IS NULL THEN RAISE EXCEPTION 'bucata_lipsa'; END IF;
    RETURN public.fn_izo_flux_pachet_legatura(p_teava,p_bucata,p_updated_at,NULL);
  END $f$;
  CREATE FUNCTION public.fn_izo_pachet_dezleaga(p_teava bigint,p_motiv text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT public.fn_izo_flux_pachet_legatura(p_teava,NULL,NULL,p_motiv)
  $f$;

  -- E4b owns the approved weld graph and the operation journal. Until present, never infer a chain from weld numbers.
  CREATE FUNCTION public.fn_izo_flux_pachet_completeaza(p_cheie uuid,p_pachet bigint,p_updated_at timestamptz,p_sudura_de text,p_sudura_pana text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_lock jsonb;
  BEGIN
    IF p_cheie IS NULL OR p_updated_at IS NULL OR nullif(btrim(p_sudura_de),'') IS NULL OR nullif(btrim(p_sudura_pana),'') IS NULL THEN
      RAISE EXCEPTION 'parametri_invalizi'; END IF;
    v_lock:=public.fn_izo_flux_pachet_lock(NULL,p_pachet,p_updated_at);
    PERFORM public.fn_izo_flux_pachet_editabil(v_lock->'pachet');
    RAISE EXCEPTION 'completare_necesita_E4b_suduri_capete_jurnal';
  END $f$;
  CREATE FUNCTION public.fn_izo_pachet_completeaza(p_cheie uuid,p_pachet bigint,p_updated_at timestamptz,p_sudura_de text,p_sudura_pana text)
    RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT public.fn_izo_flux_pachet_completeaza(p_cheie,p_pachet,p_updated_at,p_sudura_de,p_sudura_pana)
  $f$;

  REVOKE ALL ON FUNCTION public.fn_izo_flux_pachet_lock(bigint,bigint,timestamptz),public.fn_izo_flux_pachet_editabil(jsonb),
    public.fn_izo_flux_pachet_identitate(public.magazie_bucati),public.fn_izo_flux_pachet_legatura(bigint,bigint,timestamptz,text),
    public.fn_izo_flux_pachet_completeaza(uuid,bigint,timestamptz,text,text),public.fn_izo_pachet_leaga(bigint,bigint,timestamptz),
    public.fn_izo_pachet_dezleaga(bigint,text),public.fn_izo_pachet_completeaza(uuid,bigint,timestamptz,text,text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_flux_pachet_lock(bigint,bigint,timestamptz),public.fn_izo_flux_pachet_editabil(jsonb),
    public.fn_izo_flux_pachet_identitate(public.magazie_bucati),public.fn_izo_flux_pachet_legatura(bigint,bigint,timestamptz,text),
    public.fn_izo_flux_pachet_completeaza(uuid,bigint,timestamptz,text,text) TO izo_montaj_writer;
  GRANT SELECT ON public.magazie_bucati,public.executie_tevi,public.executie_pachete_lansare TO izo_montaj_writer;
  GRANT UPDATE(executie_teava_id,server_ver,updated_at) ON public.magazie_bucati TO izo_montaj_writer;
  GRANT UPDATE(serie_unica,sarja,lot,lungime_m,lungime_originala_m,tip,dimensiune,unghi_curba,updated_at) ON public.executie_tevi TO izo_montaj_writer;
  GRANT UPDATE(updated_at) ON public.executie_pachete_lansare TO izo_montaj_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_garda_scriitor(),public.fn_izo_nivel(bigint),public.fn_izo_tip_cod(integer) TO izo_montaj_writer;
  CREATE POLICY magbuc_izo_montaj_sel ON public.magazie_bucati FOR SELECT TO izo_montaj_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY magbuc_izo_montaj_upd ON public.magazie_bucati FOR UPDATE TO izo_montaj_writer USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY executie_tevi_izo_montaj_sel ON public.executie_tevi FOR SELECT TO izo_montaj_writer USING (pachet_id IS NOT NULL);
  CREATE POLICY executie_tevi_izo_montaj_upd ON public.executie_tevi FOR UPDATE TO izo_montaj_writer USING (pachet_id IS NOT NULL) WITH CHECK (pachet_id IS NOT NULL);
  CREATE POLICY executie_pachete_izo_montaj_sel ON public.executie_pachete_lansare FOR SELECT TO izo_montaj_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY executie_pachete_izo_montaj_upd ON public.executie_pachete_lansare FOR UPDATE TO izo_montaj_writer USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  GRANT CREATE ON SCHEMA public TO izo_montaj_writer;
  ALTER FUNCTION public.fn_izo_pachet_leaga(bigint,bigint,timestamptz) OWNER TO izo_montaj_writer;
  ALTER FUNCTION public.fn_izo_pachet_dezleaga(bigint,text) OWNER TO izo_montaj_writer;
  ALTER FUNCTION public.fn_izo_pachet_completeaza(uuid,bigint,timestamptz,text,text) OWNER TO izo_montaj_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_montaj_writer;
  SET LOCAL ROLE izo_montaj_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_pachet_leaga(bigint,bigint,timestamptz),public.fn_izo_pachet_dezleaga(bigint,text),
    public.fn_izo_pachet_completeaza(uuid,bigint,timestamptz,text,text) TO authenticated;
  RESET ROLE;
