-- 20261129b: runner supplies the single transaction. No data changes at apply.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129b_redari_pv_creare:' || txid_current() THEN
    RAISE EXCEPTION '20261129b: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_red_pv_creeaza(text,uuid,uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION '20261129b: functia exista'; END IF;
  PERFORM set_config('gazpet.r29b_policies',(SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_detinatori')),true);
END $pre$;

-- Hard uniqueness also covers direct PostgREST INSERT/UPDATE and reactivation.
-- CREATE UNIQUE INDEX validates the existing live keys under the preflight lock.
CREATE UNIQUE INDEX red_pv_a_activ_uq ON public.red_procese_verbale(detinator_id)
  WHERE tip='A' AND stare<>'anulat' AND sters_la IS NULL;
CREATE UNIQUE INDEX red_pv_b_activ_uq ON public.red_procese_verbale(parcela_id)
  WHERE tip='B' AND stare<>'anulat' AND sters_la IS NULL;
CREATE FUNCTION public.fn_red_pv_creeaza(p_tip text, p_parcela_id uuid, p_detinator_id uuid, p_tronson int)
RETURNS public.red_procese_verbale
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p public.red_parcele; d public.red_detinatori; r public.red_procese_verbale; cod text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(),'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'redari: creare PV doar admin/editor' USING ERRCODE='42501';
  END IF;
  IF p_tip = 'C' THEN RAISE EXCEPTION 'PV C - felia 4e'; END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('A','B') THEN RAISE EXCEPTION 'redari: tip PV invalid'; END IF;
  -- Lock order: parcela -> detinator (A) -> counter in fn_red_numar_document.
  SELECT * INTO p FROM public.red_parcele WHERE id=p_parcela_id FOR UPDATE;
  IF NOT FOUND OR p.sters_la IS NOT NULL THEN RAISE EXCEPTION 'redari: parcela inexistenta sau stearsa' USING ERRCODE='P0002'; END IF;
  IF p_tip='A' THEN
    SELECT * INTO d FROM public.red_detinatori WHERE id=p_detinator_id FOR UPDATE;
    IF NOT FOUND OR d.sters_la IS NOT NULL OR d.parcela_id IS DISTINCT FROM p.id THEN
      RAISE EXCEPTION 'redari: detinator inactiv sau de pe alta parcela' USING ERRCODE='23503';
    END IF;
  ELSIF p_detinator_id IS NOT NULL THEN
    RAISE EXCEPTION 'redari: PV B nu are detinator' USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_procese_verbale v WHERE v.tip=p_tip AND v.stare<>'anulat' AND v.sters_la IS NULL
    AND ((p_tip='A' AND v.detinator_id=p_detinator_id) OR (p_tip='B' AND v.parcela_id=p.id))) THEN
    RAISE EXCEPTION 'redari: exista deja un PV % activ; reincarca si deschide PV-ul existent',p_tip;
  END IF;
  SELECT u.uat3 INTO cod FROM public.red_uat u WHERE u.id=p.uat_id AND u.proiect_id=p.proiect_id;
  IF cod IS NULL THEN RAISE EXCEPTION 'redari: UAT incompatibil cu parcela' USING ERRCODE='23503'; END IF;
  INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare)
  VALUES(p_tip,p.id,CASE WHEN p_tip='A' THEN d.id END,p.uat_id,p.tronson,
    public.fn_red_numar_document('PV'||p_tip,cod,NULL),(now() AT TIME ZONE 'Europe/Bucharest')::date,'generat')
  RETURNING * INTO r;
  RETURN r;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_pv_creeaza(text,uuid,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_pv_creeaza(text,uuid,uuid,integer) TO authenticated;

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_index WHERE indexrelid IN ('public.red_pv_a_activ_uq'::regclass,'public.red_pv_b_activ_uq'::regclass) AND indisunique AND indisvalid) <> 2 THEN RAISE EXCEPTION '20261129b: index lipsa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure
    AND prosecdef AND prorettype='public.red_procese_verbale'::regtype AND 'search_path=public, pg_temp'=ANY(proconfig))
    OR has_function_privilege('anon','public.fn_red_pv_creeaza(text,uuid,uuid,integer)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.fn_red_pv_creeaza(text,uuid,uuid,integer)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')
  THEN RAISE EXCEPTION '20261129b: post functie/drepturi'; END IF;
  IF (SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_detinatori'))
    IS DISTINCT FROM current_setting('gazpet.r29b_policies',true) THEN RAISE EXCEPTION '20261129b: politici schimbate'; END IF;
END $post$;
