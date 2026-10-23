    -- E4b-2: private writer supplies the exact typed image immediately before DML.
    -- Generated STORED values are absent in BEFORE NEW, even on an unrelated UPDATE.
    IF current_user='izo_montaj_writer'
      AND split_part(v_ctx,'|',1)=txid_current()::text
      AND split_part(v_ctx,'|',2) IN ('aproba','iesire','taiere')
      AND p_op='UPDATE' AND p_tabel='magazie_bucati'
      AND p_inainte IS NOT NULL AND p_dupa IS NOT NULL
      AND p_dupa->'serie_canon'='null'::jsonb AND p_dupa->'lungime_cm'='null'::jsonb
      AND p_inainte=nullif(current_setting('izo.montaj_bucata_inainte',true),'')::jsonb
      AND (p_dupa || jsonb_build_object('serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm'))
        =nullif(current_setting('izo.montaj_bucata_dupa',true),'')::jsonb
      AND split_part(v_ctx,'|',4)=p_inainte->>'proiect_id'
      AND split_part(v_ctx,'|',6)=p_dupa->>'server_ver'
      AND split_part(v_ctx,'|',7)=p_inainte->>'id'
      AND (p_inainte-ARRAY['stare','locatie_tip','depozit_id','tronson_id','atribute','server_ver','updated_at'])
        =((p_dupa || jsonb_build_object('serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm'))
          -ARRAY['stare','locatie_tip','depozit_id','tronson_id','atribute','server_ver','updated_at'])
      AND ((split_part(v_ctx,'|',2)='aproba' AND p_inainte->>'stare'='pe_tronson' AND p_dupa->>'stare'='montata'
        AND (p_inainte-ARRAY['stare','server_ver','updated_at'])=
          ((p_dupa || jsonb_build_object('serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm'))-ARRAY['stare','server_ver','updated_at']))
        OR (split_part(v_ctx,'|',2)='taiere' AND p_inainte->>'stare'='pe_tronson' AND p_dupa->>'stare'='taiata'
          AND (p_inainte-ARRAY['stare','server_ver','updated_at'])=
           ((p_dupa || jsonb_build_object('serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm'))-ARRAY['stare','server_ver','updated_at']))
        OR (split_part(v_ctx,'|',2)='iesire' AND p_inainte->>'stare' IN ('sosit','receptionat','retur')
          AND p_dupa->>'stare'='pe_tronson' AND p_dupa->>'locatie_tip'='tronson'
          AND p_dupa->>'depozit_id' IS NULL AND p_dupa->>'tronson_id'=split_part(v_ctx,'|',5)))
      THEN RETURN true; END IF;
    IF current_user='izo_montaj_writer' AND split_part(v_ctx,'|',1)=txid_current()::text
      AND split_part(v_ctx,'|',2) IN ('aproba','iesire','taiere') AND p_op='INSERT'
      AND p_tabel IN ('magazie_bucati_evenimente','magazie_bucati_miscari')
      AND p_inainte IS NULL AND p_dupa IS NOT NULL
      AND split_part(v_ctx,'|',4)=p_dupa->>'proiect_id'
      AND (nullif(current_setting('izo.montaj_rand_asteptat',true),'')::jsonb)
        =jsonb_build_object('tabel',p_tabel,'rand',p_dupa-'id') THEN RETURN true; END IF;
    IF current_user='izo_montaj_writer' AND split_part(v_ctx,'|',1)=txid_current()::text
      AND split_part(v_ctx,'|',2)='taiere' AND p_op='INSERT' AND p_tabel='magazie_bucati'
      AND p_inainte IS NULL AND p_dupa->'serie_canon'='null'::jsonb AND p_dupa->'lungime_cm'='null'::jsonb
      AND split_part(v_ctx,'|',4)=p_dupa->>'proiect_id'
      AND split_part(v_ctx,'|',7)=p_dupa->>'parinte_id'
      AND nullif(current_setting('izo.montaj_rand_asteptat',true),'')::jsonb
        =jsonb_build_object('tabel',p_tabel,'rand',p_dupa) THEN RETURN true; END IF;
