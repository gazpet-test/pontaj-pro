  -- E4a-2b: private marker; never grant this entry to API roles.
  CREATE FUNCTION public.fn_izo_montaj_marcheaza(p_ctx text,p_inainte jsonb,p_dupa jsonb,p_rand jsonb)
    RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF current_user <> 'izo_montaj_writer' THEN
      RAISE EXCEPTION 'E4a marcaj: scriitor invalid' USING ERRCODE='42501'; END IF;
    PERFORM set_config('izo.montaj_ctx',coalesce(p_ctx,''),true);
    PERFORM set_config('izo.montaj_bucata_inainte',coalesce(p_inainte::text,''),true);
    PERFORM set_config('izo.montaj_bucata_dupa',coalesce(p_dupa::text,''),true);
    PERFORM set_config('izo.montaj_rand_asteptat',coalesce(p_rand::text,''),true);
  END $f$;

  CREATE FUNCTION public.fn_izo_garda_montaj(p_tabel text,p_op text,p_inainte jsonb,p_dupa jsonb)
    RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_ctx text:=current_setting('izo.montaj_ctx',true); v_pachet bigint; v_op text; v_dupa_comparabil jsonb;
  BEGIN
    -- E4a writes only the link. No events/movements/imports/config authorization yet.
    IF current_user='izo_montaj_writer' AND p_tabel='magazie_bucati' AND p_op='UPDATE'
      AND p_inainte IS NOT NULL AND p_dupa IS NOT NULL
      -- PG16 computes STORED generated columns AFTER BEFORE triggers: NEW has NULL.
      -- Require that exact trigger shape; restore only these two derived values for
      -- comparison with the stored snapshot. Their sources (serie/lungime_mm) stay immutable.
      AND p_dupa->'serie_canon' = 'null'::jsonb AND p_dupa->'lungime_cm' = 'null'::jsonb THEN
      v_dupa_comparabil:=p_dupa || jsonb_build_object(
        'serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm');
      v_op:=CASE WHEN p_dupa->>'executie_teava_id' IS NULL THEN 'dezleaga' ELSE 'leaga' END;
      SELECT pachet_id INTO v_pachet FROM public.executie_tevi
        WHERE id=coalesce((p_dupa->>'executie_teava_id')::bigint,(p_inainte->>'executie_teava_id')::bigint);
      IF v_ctx = concat_ws('|',txid_current()::text,v_op,v_pachet::text,
          p_inainte->>'proiect_id',p_inainte->>'tronson_id',p_dupa->>'server_ver',p_inainte->>'id')
        AND v_pachet IS NOT NULL AND p_inainte->>'tip_cod' IN ('teava','curba')
        AND p_inainte->>'stare'='montata'
        AND ((v_op='leaga' AND p_inainte->>'executie_teava_id' IS NULL)
          OR (v_op='dezleaga' AND p_inainte->>'executie_teava_id' IS NOT NULL))
        AND nullif(current_setting('izo.montaj_bucata_inainte',true),'')::jsonb=p_inainte
        AND nullif(current_setting('izo.montaj_bucata_dupa',true),'')::jsonb=v_dupa_comparabil
        AND (p_inainte-ARRAY['executie_teava_id','server_ver','updated_at'])=
            (v_dupa_comparabil-ARRAY['executie_teava_id','server_ver','updated_at']) THEN RETURN true; END IF;
    END IF;
    RAISE EXCEPTION 'E4a context montaj invalid pe %',p_tabel USING ERRCODE='42501';
  END $f$;
  REVOKE ALL ON FUNCTION public.fn_izo_montaj_marcheaza(text,jsonb,jsonb,jsonb),
    public.fn_izo_garda_montaj(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_garda_montaj(text,text,jsonb,jsonb) TO izo_montaj_writer;
  GRANT CREATE ON SCHEMA public TO izo_montaj_writer;
  ALTER FUNCTION public.fn_izo_montaj_marcheaza(text,jsonb,jsonb,jsonb) OWNER TO izo_montaj_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_montaj_writer;
