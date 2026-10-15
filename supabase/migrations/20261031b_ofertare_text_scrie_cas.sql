-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031b — Ofertare TKT-0329 B (PR3, review r1 Copilot): proveniența textului legată de textul CURENT al documentului.
-- fn_ofertare_cb_text_scrie (din 20261031a) primește în plus o condiție, sub lock-ul rândului documentului (FOR NO KEY UPDATE):
-- textul dat trebuie să fie EXACT text_extras-ul curent (sha egal). Un producător întârziat (a scris textul A, între timp altul a scris B)
-- nu mai poate insera o proveniență A „mai nouă” decât B → răspuns {refuz: 'text_depasit'}, nimic scris.
-- Altceva nu se schimbă: aceeași semnătură, aceleași drepturi (CREATE OR REPLACE păstrează ACL-ul), aceleași tabele.
-- Depinde de 20261031a aplicată și NEMODIFICATĂ (amprenta din comentariu). Reîmprospătează amprenta 20261031a (revenirea ei rămâne posibilă).
-- Revenire: supabase/revenire/20261031b_ofertare_text_scrie_cas_ROLLBACK.sql (pune la loc corpul din 20261031a).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031b_ofertare_text_scrie_cas:' || txid_current() THEN
    RAISE EXCEPTION '20261031b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])') IS NULL
     OR to_regprocedure('public.fn_ofertare_cb_amprenta()') IS NULL OR to_regclass('public.ofertare_analiza_versiuni') IS NULL THEN
    RAISE EXCEPTION '20261031b: preconditie, 20261031a nu e aplicata';
  END IF;
  IF coalesce(obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta() THEN
    RAISE EXCEPTION '20261031b: preconditie, obiectele 20261031a s-au schimbat dupa aplicare (amprenta difera)';
  END IF;
  IF pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) LIKE '%text_depasit%' THEN
    RAISE EXCEPTION '20261031b: deja aplicata';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_text_scrie(p_document_id bigint, p_text text, p_origine text, p_producator text,
                                                            p_completitudine text, p_pagini_necitite integer[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_cur text; v_sha text; v_prov bigint;
BEGIN
  -- documentul FOR NO KEY UPDATE (review r5): o proveniență nouă nu poate apărea cât timp extragere_incepe / redeschide verifică
  -- versiunea curentă sub FOR SHARE (și invers: consumatorul așteaptă și vede versiunea nouă)
  SELECT licitatie_id, text_extras INTO v_lic, v_cur FROM public.ofertare_documente_atribuire WHERE id = p_document_id FOR NO KEY UPDATE;
  IF NOT FOUND OR p_text IS NULL THEN RAISE EXCEPTION 'Document inexistent sau text gol' USING ERRCODE = '22023'; END IF;
  v_sha := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  -- 20261031b: proveniența doar pentru textul CURENT (sub același lock) — un producător întârziat nu suprascrie istoria
  IF v_cur IS NULL OR encode(sha256(convert_to(v_cur, 'UTF8')), 'hex') <> v_sha THEN
    RETURN jsonb_build_object('refuz', 'text_depasit');
  END IF;
  INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (v_lic, v_sha, p_text) ON CONFLICT DO NOTHING;
  INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine, pagini_necitite)
  VALUES (v_lic, p_document_id, v_sha, p_origine, p_producator, p_completitudine, coalesce(p_pagini_necitite, '{}')) RETURNING id INTO v_prov;
  RETURN jsonb_build_object('ok', true, 'sha256', v_sha, 'prov_id', v_prov);
END $f$;

DO $post$
DECLARE v_fp text;
BEGIN
  IF has_function_privilege('anon', 'public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])', 'EXECUTE') THEN
    RAISE EXCEPTION '20261031b: postconditie drepturi text_scrie';
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a + 20261031b). Imuabil. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031b_ofertare_text_scrie_cas:' || txid_current() THEN
    RAISE EXCEPTION '20261031b: garda final invalida';
  END IF;
END $post$;
