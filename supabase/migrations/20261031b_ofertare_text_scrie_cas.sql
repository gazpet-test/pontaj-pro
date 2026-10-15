-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031b — Ofertare TKT-0329 B (PR3, review r1 Copilot): proveniența textului legată de textul CURENT al documentului.
-- fn_ofertare_cb_text_scrie (din 20261031a) primește în plus o condiție, sub lock-ul rândului documentului (FOR NO KEY UPDATE):
-- textul dat trebuie să fie EXACT text_extras-ul curent (sha egal). Un producător întârziat (a scris textul A, între timp altul a scris B)
-- nu mai poate insera o proveniență A „mai nouă” decât B → răspuns {refuz: 'text_depasit'}, nimic scris.
-- Aceeași semnătură, aceleași drepturi (CREATE OR REPLACE păstrează ACL-ul), aceleași tabele. În plus (review r3): o funcție NOUĂ,
-- fn_ofertare_cb_extragere_incepe_grup (doar service_role) — pornirea extragerii cu contextul de grup verificat atomic.
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
  IF pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) LIKE '%text_depasit%'
     OR to_regprocedure('public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])') IS NOT NULL THEN
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

-- 20261031b (PR3, review r3 Copilot): pornirea extragerii cu contextul de GRUP verificat atomic. Convenția numerică a unei părți dintr-un
-- PDF împărțit (p01 / p02 …) se calculează pe toate părțile valide ale grupului; extractorul o poartă în identitate. Aici, sub lock-uri
-- FOR SHARE pe TOATE documentele grupului (în ordinea id-urilor), mulțimea curentă a părților (aceeași rădăcină de nume, tip eligibil,
-- text nevid, ultima versiune, eligibile pe loturi, text valid) trebuie să fie EXACT manifestul dat (document:sha); altfel
-- {refuz: 'grup_schimbat'}. Apoi pornește extragerea în aceeași tranzacție (fn_ofertare_cb_extragere_incepe, neschimbată).
CREATE FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(p_cerere_id bigint, p_document_id bigint, p_sha256 text, p_familie_id text,
                                                          p_extractor_id text, p_felii_total integer, p_manifest text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_rad text; v_cur text[]; v_dat text[];
BEGIN
  SELECT licitatie_id, regexp_replace(nume_original, '\s+—\s+p\d{2}_pag\d+-\d+\.pdf$', '', 'i') INTO v_lic, v_rad
    FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'document'); END IF;
  -- lock-urile grupului, în ordine deterministă (producătorii țin FOR NO KEY UPDATE pe document cât scriu text + proveniență)
  PERFORM 1 FROM public.ofertare_documente_atribuire d
   WHERE d.licitatie_id = v_lic AND regexp_replace(d.nume_original, '\s+—\s+p\d{2}_pag\d+-\d+\.pdf$', '', 'i') = v_rad
   ORDER BY d.id FOR SHARE;
  SELECT coalesce(array_agg(x.id || ':' || x.sha ORDER BY x.id), '{}') INTO v_cur FROM (
    SELECT d.id, encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex') AS sha
      FROM public.ofertare_documente_atribuire d
     WHERE d.licitatie_id = v_lic AND regexp_replace(d.nume_original, '\s+—\s+p\d{2}_pag\d+-\d+\.pdf$', '', 'i') = v_rad
       AND d.tip IN ('lista_cantitati', 'cs_volum', 'fisa_date', 'alta', 'raspuns_clarificare')
       AND coalesce(d.text_extras, '') <> ''
       AND NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire n
                        WHERE n.licitatie_id = d.licitatie_id AND n.seap_meta->>'inlocuieste_id' = d.id::text)
       AND coalesce((public.fn_ofertare_document_eligibil(d.id)->>'eligibil')::boolean, false)) x
   WHERE public.fn_ofertare_cb_text_valid(v_lic, x.id, x.sha) <> '{}'::jsonb;
  SELECT coalesce(array_agg(m ORDER BY split_part(m, ':', 1)::bigint), '{}') INTO v_dat FROM unnest(coalesce(p_manifest, '{}')) m;
  IF v_cur IS DISTINCT FROM v_dat OR NOT ((p_document_id || ':' || p_sha256) = ANY (v_cur)) THEN
    RETURN jsonb_build_object('refuz', 'grup_schimbat', 'curent', to_jsonb(v_cur));
  END IF;
  RETURN public.fn_ofertare_cb_extragere_incepe(p_cerere_id, p_document_id, p_sha256, p_familie_id, p_extractor_id, p_felii_total);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[]) TO service_role;

DO $post$
DECLARE v_fp text;
BEGIN
  IF has_function_privilege('anon', 'public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '20261031b: postconditie drepturi extragere_incepe_grup';
  END IF;
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
