-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031b — Ofertare TKT-0329 B (PR3, review r1 Copilot): proveniența textului legată de textul CURENT al documentului.
-- fn_ofertare_cb_text_scrie (din 20261031a) primește în plus o condiție, sub lock-ul rândului documentului (FOR NO KEY UPDATE):
-- textul dat trebuie să fie EXACT text_extras-ul curent (sha egal). Un producător întârziat (a scris textul A, între timp altul a scris B)
-- nu mai poate insera o proveniență A „mai nouă” decât B → răspuns {refuz: 'text_depasit'}, nimic scris.
-- Aceeași semnătură, aceleași drepturi (CREATE OR REPLACE păstrează ACL-ul), aceleași tabele. În plus (review r3): o funcție NOUĂ,
-- fn_ofertare_cb_extragere_incepe_grup (doar service_role) — pornirea extragerii cu contextul de grup verificat atomic, sub mutexul de
-- grup = rândul licitației FOR UPDATE. Ca toate căile care schimbă mulțimea părților valide să participe (review r5):
-- fn_ofertare_cb_decizie ia licitația FOR SHARE la început, iar fn_ofertare_cb_text_scrie o ia FOR KEY SHARE ÎNAINTEA documentului
-- (ordinea comună licitație → document, fără ciclu de deadlock cu pornirea de grup).
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
     OR to_regprocedure('public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[],bigint[])') IS NOT NULL
     OR pg_get_functiondef('public.fn_ofertare_cb_decizie(bigint,text,text,text,text,text)'::regprocedure) LIKE '%mutexul de grup%' THEN
    RAISE EXCEPTION '20261031b: deja aplicata';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_text_scrie(p_document_id bigint, p_text text, p_origine text, p_producator text,
                                                            p_completitudine text, p_pagini_necitite integer[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_cur text; v_sha text; v_prov bigint;
BEGIN
  -- ordinea comună a lock-urilor: LICITAȚIE → document (PR3 review r5, Jakarinos: altfel ciclu cu pornirea de grup — ea ține licitația
  -- FOR UPDATE și așteaptă documentul, iar inserarea în ofertare_doc_texte ar cere FOR KEY SHARE pe licitație ținând documentul)
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF FOUND THEN PERFORM 1 FROM public.ofertare_licitatii WHERE id = v_lic FOR KEY SHARE; END IF;
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

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_decizie(p_document_id bigint, p_doc_sha256 text, p_rol text, p_sectiune text, p_decizie text, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_prec bigint; v_id bigint; v_clasa text; v_rol text := p_rol; v_sect text := p_sectiune; v_clase text[];
BEGIN
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(v_lic) THEN RAISE EXCEPTION 'Document inexistent sau fără drept' USING ERRCODE = '42501'; END IF;
  -- 20261031b (PR3 review r5): deciziile (text_confirmat schimbă validitatea; rol_* intră în identitatea extractorului) participă la
  -- mutexul de grup: licitația FOR SHARE, incompatibil cu FOR UPDATE-ul pornirii de grup (ordinea comună: licitație → document)
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = v_lic FOR SHARE;
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

-- 20261031b (PR3, review r3 Copilot): pornirea extragerii cu contextul de GRUP verificat atomic. Convenția numerică a unei părți dintr-un
-- PDF împărțit (p01 / p02 …) se calculează pe toate părțile valide ale grupului; extractorul o poartă în identitate. Aici, sub lock-uri
-- FOR SHARE pe TOATE documentele grupului (în ordinea id-urilor), mulțimea curentă a părților (aceeași rădăcină de nume, tip eligibil,
-- text nevid, ultima versiune, eligibile pe loturi, text valid) trebuie să fie EXACT manifestul dat (document:sha); altfel
-- {refuz: 'grup_schimbat'}; deciziile de rol active = exact cele date, altfel 'context_schimbat'; un document ocupat = 'grup_ocupat'.
-- Apoi pornește extragerea în aceeași tranzacție (fn_ofertare_cb_extragere_incepe, neschimbată).
CREATE FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(p_cerere_id bigint, p_document_id bigint, p_sha256 text, p_familie_id text,
                                                          p_extractor_id text, p_felii_total integer, p_manifest text[],
                                                          p_decizii bigint[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s'
AS $f$
DECLARE v_lic bigint; v_rad text; v_cur text[]; v_dat text[]; v_dec bigint[];
BEGIN
  SELECT licitatie_id, regexp_replace(nume_original, '\s+—\s+p\d{2}_pag\d+-\d+\.pdf$', '', 'i') INTO v_lic, v_rad
    FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'document'); END IF;
  -- review r4: mutexul de GRUP = rândul licitației FOR UPDATE, ținut până la pornirea extragerii. Serializează tot ce poate schimba
  -- MULȚIMEA părților sau eligibilitatea lor, fără protocol nou: o parte nouă / o versiune care înlocuiește (INSERT în
  -- ofertare_documente_atribuire → verificarea FK ia FOR KEY SHARE pe licitație, incompatibil cu FOR UPDATE), setterii de loturi
  -- (licitatie_loturi_seteaza = FOR UPDATE, documente_lot_seteaza = FOR SHARE pe licitație). Fantomele nu mai pot apărea între
  -- calculul mulțimii și pornire.
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = v_lic FOR UPDATE;
  -- lock-urile grupului, în ordine deterministă, FĂRĂ AȘTEPTARE (review r6): ținând licitația, pornirea nu așteaptă niciodată un document
  -- blocat de un producător (UPDATE text_extras / text_scrie în curs) — ar putea închide un ciclu document → licitație. Ocupat =
  -- {refuz: 'grup_ocupat'}, nimic pornit; rularea următoare reîncearcă.
  BEGIN
    PERFORM 1 FROM public.ofertare_documente_atribuire d
     WHERE d.licitatie_id = v_lic AND regexp_replace(d.nume_original, '\s+—\s+p\d{2}_pag\d+-\d+\.pdf$', '', 'i') = v_rad
     ORDER BY d.id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('refuz', 'grup_ocupat');
  END;
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
  -- review r6: și deciziile de ROL active pe acest document + sha (intră în identitatea extractorului și în secțiunile extrase) trebuie
  -- să fie exact cele folosite de apelant; o decizie comisă între citire și pornire → {refuz: 'context_schimbat'}, nimic pornit.
  -- (Deciziile se serializează cu pornirea prin licitația FOR SHARE din fn_ofertare_cb_decizie.)
  SELECT coalesce(array_agg(x.id ORDER BY x.id), '{}') INTO v_dec FROM public.ofertare_cant_doc_decizii x
   WHERE x.document_id = p_document_id AND x.doc_sha256 = p_sha256 AND x.decizie IN ('rol_confirmat', 'nu_e_sursa_cantitativa')
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id = x.id);
  IF v_dec IS DISTINCT FROM (SELECT coalesce(array_agg(y ORDER BY y), '{}') FROM unnest(coalesce(p_decizii, '{}')) y) THEN
    RETURN jsonb_build_object('refuz', 'context_schimbat', 'decizii', to_jsonb(v_dec));
  END IF;
  RETURN public.fn_ofertare_cb_extragere_incepe(p_cerere_id, p_document_id, p_sha256, p_familie_id, p_extractor_id, p_felii_total);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[],bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[],bigint[]) TO service_role;

DO $post$
DECLARE v_fp text;
BEGIN
  IF has_function_privilege('anon', 'public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[],bigint[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[],bigint[])', 'EXECUTE') THEN
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
