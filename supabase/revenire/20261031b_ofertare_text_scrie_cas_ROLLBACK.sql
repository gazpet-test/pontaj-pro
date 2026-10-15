-- REVENIRE 20261031b — pune la loc corpul fn_ofertare_cb_text_scrie din 20261031a (fără verificarea textului curent).
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
  IF pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) LIKE '%text_depasit%' THEN
    RAISE EXCEPTION '20261031b: postconditie revenire';
  END IF;
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a). Imuabil. amprenta=' || public.fn_ofertare_cb_amprenta());
  IF current_setting('gazpet.revenire_20261031b', true) IS DISTINCT FROM 'TEXT_SCRIE_CAS_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031b: garda final invalida';
  END IF;
END $post$;
