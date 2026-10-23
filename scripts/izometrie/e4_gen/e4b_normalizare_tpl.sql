-- Same contract and vectors as src/lib/izoSudura.js, through izoNormalizare.js.
CREATE FUNCTION public.fn_izo_sudura_normalizeaza(p_raw text,p_opt jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_original text:=coalesce(p_raw,''); v_s text; v_m text[]; v_ctx integer; v_t integer; v_nr integer;
 v_suf text:=''; v_mod text:=coalesce(p_opt->>'mod','legacy'); v_conv text[]; v_r jsonb;
BEGIN
 v_r:=jsonb_build_object('original',v_original,'stare','cod_ilizibil','motiv',NULL,'tronson',NULL,'nr',NULL,
  'sufix','','refacuta',false,'refacutaPropusa',false,'altTronson',false,'canon',NULL);
 v_m:=regexp_match(upper(btrim(coalesce(p_opt->>'tronson',''))),'^(?:T(?:R)?\s*)?([0-9]{1,3})$');
 IF v_m IS NOT NULL THEN v_ctx:=v_m[1]::integer; END IF;
 SELECT coalesce(array_agg(regexp_replace(upper(x),'\s','','g')),'{}') INTO v_conv
  FROM jsonb_array_elements_text(coalesce(p_opt->'conventie','[]')) x;
 v_s:=btrim(regexp_replace(regexp_replace(upper(btrim(v_original)),'^(?:GAZPET\s+INSTAL|GAZPET)\s+',''),'\s+',' ','g'));
 IF v_s='' THEN RETURN v_r||'{"motiv":"gol"}'::jsonb; END IF;
 v_m:=regexp_match(v_s,'^T(?:R)?\s*-?\s*([0-9]{1,3})\s*-?\s*S\s*-?\s*([0-9]{1,5})\s*((?:/\s*)?[A-Z]{1,2}[0-9]?)?$');
 IF v_m IS NOT NULL THEN v_t:=v_m[1]::integer; v_nr:=v_m[2]::integer; v_suf:=coalesce(v_m[3],'');
 ELSE
  v_m:=regexp_match(v_s,'^(?:S\s*-?\s*)?([0-9]{1,5})\s*((?:/\s*)?[A-Z]{1,2}[0-9]?)?$');
  IF v_m IS NULL THEN RETURN v_r||'{"motiv":"format"}'::jsonb; END IF;
  IF v_ctx IS NULL THEN RETURN v_r||'{"motiv":"fara_tronson"}'::jsonb; END IF;
  v_t:=v_ctx; v_nr:=v_m[1]::integer; v_suf:=coalesce(v_m[2],'');
 END IF;
 IF v_t<=0 THEN RETURN v_r||'{"motiv":"tronson"}'::jsonb; END IF;
 IF v_nr<=0 THEN RETURN v_r||'{"motiv":"numar"}'::jsonb; END IF;
 v_suf:=regexp_replace(v_suf,'\s','','g');
 v_r:=v_r||jsonb_build_object('tronson',v_t,'nr',v_nr,'altTronson',v_ctx IS NOT NULL AND v_ctx<>v_t);
 IF v_mod<>'strict' THEN
  IF right(v_suf,1)='R' THEN v_r:=v_r||'{"refacuta":true}'::jsonb; v_suf:=regexp_replace(left(v_suf,length(v_suf)-1),'/$',''); END IF;
  v_r:=v_r||'{"stare":"ok"}'::jsonb;
 ELSIF v_suf='' OR v_suf=ANY(v_conv) THEN v_r:=v_r||jsonb_build_object('stare','ok','refacuta',v_suf='R');
 ELSIF right(v_suf,1)='R' THEN v_r:=v_r||'{"stare":"cod_de_confirmat","refacutaPropusa":true,"motiv":"sufix_r_neconfirmat"}'::jsonb;
 ELSE v_r:=v_r||jsonb_build_object('motiv',CASE WHEN cardinality(v_conv)>0 THEN 'sufix_necunoscut' ELSE 'conventie_goala' END);
 END IF;
 RETURN v_r||jsonb_build_object('sufix',v_suf,'canon','TR'||v_t||'S'||v_nr||v_suf);
END $f$;
