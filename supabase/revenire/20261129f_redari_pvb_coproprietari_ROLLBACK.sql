-- Runner MUST supply one transaction. Restores the exact pre-20261129f view definition.
-- harness-armare: gazpet.revenire_20261129f REDARI_PVB_COPROP_SCOASA
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129f',true) IS DISTINCT FROM 'REDARI_PVB_COPROP_SCOASA:'||txid_current() THEN RAISE EXCEPTION '20261129f: revenire neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129f%') THEN RAISE EXCEPTION '20261129f: armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  -- DDL serialized before taking the baseline; no business rows modified.
  LOCK TABLE public.red_v_tronson IN ACCESS EXCLUSIVE MODE;
  PERFORM set_config('gazpet.r29f_columns',(SELECT jsonb_agg(jsonb_build_array(attnum,attname,atttypid,atttypmod,attcollation,attacl) ORDER BY attnum)::text
    FROM pg_attribute WHERE attrelid='public.red_v_tronson'::regclass AND attnum>0 AND NOT attisdropped),true);
  PERFORM set_config('gazpet.r29f_acl',(SELECT jsonb_build_array(relowner,relacl)::text FROM pg_class WHERE oid='public.red_v_tronson'::regclass),true);
  PERFORM set_config('gazpet.r29f_rpc',(SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,'NULL'), E'\n' ORDER BY oid))
    FROM pg_proc WHERE oid IN ('public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure,'public.fn_red_pv_c_neacoperite(uuid,integer)'::regprocedure)),true);
END $pre$;
CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pa WHERE pa.parcela_id = p.id AND pa.tip = 'A' AND pa.stare = 'semnat' AND pa.sters_la IS NULL) THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
COMMENT ON VIEW public.red_v_tronson IS 'Redari: parcelele active per tronson cu tipul de PV (A daca exista PV A semnat, B daca exista PV B, altfel NULL) si obiectiile deschise - baza PV C.';
DROP TRIGGER red_pv_b_semnare ON public.red_procese_verbale;
DROP FUNCTION public.fn_red_pv_b_semnare();

CREATE OR REPLACE FUNCTION public.fn_red_pv_creeaza(p_tip text, p_parcela_id uuid, p_detinator_id uuid, p_tronson int)
RETURNS public.red_procese_verbale
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p public.red_parcele; d public.red_detinatori; r public.red_procese_verbale; cod text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(),'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'redari: creare PV doar admin/editor' USING ERRCODE='42501';
  END IF;
  IF p_tip = 'C' THEN RAISE EXCEPTION 'PV C: foloseste fn_red_pv_c_creeaza'; END IF;
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

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.red_v_tronson'::regclass AND 'security_invoker=on'=ANY(reloptions)) THEN RAISE EXCEPTION '20261129f: security_invoker lipsa'; END IF;
  IF (SELECT jsonb_agg(jsonb_build_array(attnum,attname,atttypid,atttypmod,attcollation,attacl) ORDER BY attnum)::text
      FROM pg_attribute WHERE attrelid='public.red_v_tronson'::regclass AND attnum>0 AND NOT attisdropped)
    IS DISTINCT FROM current_setting('gazpet.r29f_columns',true) THEN RAISE EXCEPTION '20261129f: coloane schimbate'; END IF;
  IF (SELECT jsonb_build_array(relowner,relacl)::text FROM pg_class WHERE oid='public.red_v_tronson'::regclass)
    IS DISTINCT FROM current_setting('gazpet.r29f_acl',true) THEN RAISE EXCEPTION '20261129f: ACL schimbat'; END IF;
  IF (SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,'NULL'), E'\n' ORDER BY oid))
      FROM pg_proc WHERE oid IN ('public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure,'public.fn_red_pv_c_neacoperite(uuid,integer)'::regprocedure))
    IS DISTINCT FROM current_setting('gazpet.r29f_rpc',true) THEN RAISE EXCEPTION '20261129f: RPC schimbat'; END IF;
  IF to_regprocedure('public.fn_red_pv_b_semnare()') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.red_procese_verbale'::regclass AND tgname='red_pv_b_semnare')
    OR position('PV B nu este necesar' in (SELECT prosrc FROM pg_proc WHERE oid='public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure)) > 0
    THEN RAISE EXCEPTION '20261129f: revenire incompleta (garda B / fn_red_pv_creeaza)'; END IF;
END $post$;
DO $version$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120500';
  END IF;
END $version$;