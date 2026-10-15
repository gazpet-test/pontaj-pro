-- REVENIRE 20261031b — pune la loc corpurile fn_ofertare_cb_text_scrie și fn_ofertare_cb_decizie din 20261031a și scoate fn_ofertare_cb_extragere_incepe_grup.
-- Nu atinge date. Refuză dacă obiectele s-au schimbat după aplicare (amprenta din comentariu). DOAR la cererea lui Răzvan.
-- Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261031b', 'TEXT_SCRIE_CAS_REVENIRE:' || txid_current(), true);
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261031b', true) IS DISTINCT FROM 'TEXT_SCRIE_CAS_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_cb_amprenta()') IS NULL
     OR pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) NOT LIKE '%text_depasit%' THEN
    RAISE EXCEPTION '20261031b: preconditie, migrarea nu e aplicata';
  END IF;
  IF coalesce(obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta() THEN
    RAISE EXCEPTION '20261031b: preconditie, obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;
END $pre$;

DROP FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[]);

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_decizie(p_document_id bigint, p_doc_sha256 text, p_rol text, p_sectiune text, p_decizie text, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_prec bigint; v_id bigint; v_clasa text; v_rol text := p_rol; v_sect text := p_sectiune; v_clase text[];
BEGIN
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(v_lic) THEN RAISE EXCEPTION 'Document inexistent sau fără drept' USING ERRCODE = '42501'; END IF;
  v_clasa := CASE p_decizie WHEN 'text_confirmat' THEN 'provenienta' WHEN 'nu_e_sursa_cantitativa' THEN 'rol' WHEN 'rol_confirmat' THEN 'rol'
                            WHEN 'verificat_fara_lungimi' THEN 'acoperire' WHEN 'sursa_partiala_acceptata' THEN 'sursa' END;
  IF v_clasa IS NULL OR p_doc_sha256 IS NULL OR p_doc_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Decizie invalidă' USING ERRCODE = '22023'; END IF;
  IF v_clasa = 'provenienta' THEN v_rol := NULL; v_sect := NULL;
  ELSIF v_rol IS NULL OR v_sect IS NULL THEN RAISE EXCEPTION 'Rolul și secțiunea sunt obligatorii' USING ERRCODE = '22023'; END IF;
  v_clase := CASE v_clasa WHEN 'rol' THEN ARRAY['nu_e_sursa_cantitativa', 'rol_confirmat'] ELSE ARRAY[p_decizie] END;
  IF p_decizie = 'verificat_fara_lungimi' AND v_sect = '*' AND EXISTS (
       SELECT 1 FROM public.ofertare_cant_obs WHERE document_id = p_document_id AND doc_sha256 = p_doc_sha256 AND rol_sursa = v_rol AND um_norm = 'm') THEN
    RAISE EXCEPTION 'Documentul are observații cu lungimi pe acest rol: decizia se ia pe secțiune' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_decizie:' || p_document_id || ':' || p_doc_sha256 || ':' || coalesce(v_rol, '-') || ':'
                                         || coalesce(v_sect, '-') || ':' || v_clasa));
  SELECT d.id INTO v_prec FROM public.ofertare_cant_doc_decizii d
   WHERE d.document_id = p_document_id AND d.doc_sha256 = p_doc_sha256 AND d.rol IS NOT DISTINCT FROM v_rol
     AND d.sectiune IS NOT DISTINCT FROM v_sect AND d.decizie = ANY (v_clase)
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id = d.id) ORDER BY d.id DESC LIMIT 1;
  IF v_prec IS NOT NULL THEN
    INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, revoca_id, motiv, decis_de)
    VALUES (v_lic, p_document_id, p_doc_sha256, 'revocare', v_prec, 'înlocuită de o decizie nouă', auth.uid());
  END IF;
  INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, rol, sectiune, decizie, motiv, decis_de)
  VALUES (v_lic, p_document_id, p_doc_sha256, v_rol, v_sect, p_decizie, btrim(p_motiv), auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'decizie_id', v_id, 'inlocuieste', v_prec);
END $f$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_text_scrie(p_document_id bigint, p_text text, p_origine text, p_producator text,
                                                            p_completitudine text, p_pagini_necitite integer[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_sha text; v_prov bigint;
BEGIN
  -- documentul FOR NO KEY UPDATE (review r5): o proveniență nouă nu poate apărea cât timp extragere_incepe / redeschide verifică
  -- versiunea curentă sub FOR SHARE (și invers: consumatorul așteaptă și vede versiunea nouă)
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id FOR NO KEY UPDATE;
  IF NOT FOUND OR p_text IS NULL THEN RAISE EXCEPTION 'Document inexistent sau text gol' USING ERRCODE = '22023'; END IF;
  v_sha := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (v_lic, v_sha, p_text) ON CONFLICT DO NOTHING;
  INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine, pagini_necitite)
  VALUES (v_lic, p_document_id, v_sha, p_origine, p_producator, p_completitudine, coalesce(p_pagini_necitite, '{}')) RETURNING id INTO v_prov;
  RETURN jsonb_build_object('ok', true, 'sha256', v_sha, 'prov_id', v_prov);
END $f$;

DO $post$
BEGIN
  IF pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) LIKE '%text_depasit%'
     OR to_regprocedure('public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])') IS NOT NULL
     OR pg_get_functiondef('public.fn_ofertare_cb_decizie(bigint,text,text,text,text,text)'::regprocedure) LIKE '%mutexul de grup%' THEN
    RAISE EXCEPTION '20261031b: postconditie revenire';
  END IF;
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a). Imuabil. amprenta=' || public.fn_ofertare_cb_amprenta());
  IF current_setting('gazpet.revenire_20261031b', true) IS DISTINCT FROM 'TEXT_SCRIE_CAS_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031b: garda final invalida';
  END IF;
END $post$;
