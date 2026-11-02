-- Version 20261129120500. Runner MUST supply one transaction (pre + apply + post).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129f_redari_pvb_coproprietari:'||txid_current() THEN RAISE EXCEPTION '20261129f: garda start invalida'; END IF;
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
       CASE WHEN EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = p.id AND d.sters_la IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = p.id AND d.sters_la IS NULL
                 AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale pa
                   WHERE pa.parcela_id = p.id AND pa.detinator_id = d.id
                     AND pa.tip = 'A' AND pa.stare = 'semnat' AND pa.sters_la IS NULL)) THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
COMMENT ON VIEW public.red_v_tronson IS 'Redari: A numai daca toti detinatorii activi (minimum unul) au PV A semnat activ; altfel B daca exista PV B activ; altfel NULL. Obiectiile deschise raman independente; baza PV C.';
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
END $post$;