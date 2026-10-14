-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261029c — Ofertare: pilot OCR local, rezervarea de cost LEGATĂ de dezacord (D3b, review Copilot r1 pe PR #698, P1)
-- Problema: ofertare-ocr-arbitreaza rezerva costul doar pe rulare (fn_ofertare_ocr_cost_rezerva), iar legătura dezacord ↔ amprentă
-- ↔ rulare se verifica abia la decontare, DUPĂ apelul plătit: un dezacord greșit sau deja arbitrat consuma bani.
-- Acum (review Copilot r1 + Jakarinos r1):
--   * fn_ofertare_ocr_dezacord_arbitraj (doar citire): datele dezacordului DIN BD (citirile, tipul, item_id) pentru apelul plătit,
--     după ce verifică rularea, apartenența, amprenta declarată și imaginea benzii (sha256 = image_sha256 al dezacordului);
--     edge-ul arată modelului citirile din BD, nu pe cele trimise de client;
--   * fn_ofertare_ocr_arbitraj_rezerva: ACELEAȘI verificări + nearbitrat + nicio altă rezervare deschisă pe dezacord + plafonul,
--     ATOMIC sub blocarea rulării (FOR UPDATE), abia apoi rezervă, legat de dezacord (coloana nouă ofertare_ocr_rezervari.dezacord_id,
--     un singur apel în zbor per dezacord — și index unic);
--   * fn_ofertare_ocr_arbitraj_om: decizia needs_human FĂRĂ apel plătit (structura_tabele sau orice dezacord trimis direct la om),
--     cu o rezervare decontată la 0 — altfel rularea n-ar mai putea trece în arbitrata.
-- fn_ofertare_ocr_scrie_arbitraj decontează rezervarea legată DOAR cu decizia acelui dezacord. fn_ofertare_ocr_cost_rezerva (fără
-- dezacord) nu mai e executabilă de service_role (o singură cale de cheltuială).
-- Amprenta din comentariul ofertare_ocr_rulari se re-ștampilează (revenirea 20261029b refuză până se revine întâi 20261029c).
-- Revenire: supabase/revenire/20261029c_ofertare_ocr_arbitraj_rezerva_ROLLBACK.sql (readuce exact obiectele 20261029b).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_fp text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029c_ofertare_ocr_arbitraj_rezerva:' || txid_current() THEN
    RAISE EXCEPTION '20261029c: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029c: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ofertare_ocr_rulari') IS NULL OR to_regprocedure('public.fn_ofertare_ocr_amprenta()') IS NULL THEN
    RAISE EXCEPTION '20261029c: 20261029b nu e aplicata';
  END IF;
  IF to_regprocedure('public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)') IS NOT NULL THEN
    RAISE EXCEPTION '20261029c: obiectele exista deja';
  END IF;
  -- pornește DOAR peste obiectele exacte ale lui 20261029b (amprenta înregistrată la aplicare)
  v_fp := public.fn_ofertare_ocr_amprenta();
  IF obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class') NOT LIKE '%amprenta=' || v_fp THEN
    RAISE EXCEPTION '20261029c: obiectele 20261029b s-au schimbat dupa aplicare (amprenta difera)';
  END IF;
END $pre$;

ALTER TABLE public.ofertare_ocr_rezervari ADD COLUMN dezacord_id bigint REFERENCES public.ofertare_ocr_dezacorduri(id);
-- un singur apel în zbor per dezacord (plasă sub verificarea din funcție, care rulează sub blocarea rulării)
CREATE UNIQUE INDEX ofertare_ocr_rezervari_un_zbor ON public.ofertare_ocr_rezervari (dezacord_id) WHERE stare = 'deschisa' AND dezacord_id IS NOT NULL;

-- Datele dezacordului pentru arbitraj, din BD. Doar citire. {"refuz": motiv} sau {item_id, tip, citire_lighton, citire_mineru,
-- e_cantitate, anomalie_separator}; motiv ∈ stare | dezacord | imagine | tip | arbitrat.
CREATE FUNCTION public.fn_ofertare_ocr_dezacord_arbitraj(p_rulare_id bigint, p_dezacord_id bigint, p_item_sha256 text, p_image_sha256 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; d record;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id;
  IF NOT FOUND OR r.stare <> 'citita' THEN RETURN jsonb_build_object('refuz', 'stare'); END IF;
  SELECT * INTO d FROM public.ofertare_ocr_dezacorduri WHERE id = p_dezacord_id;
  IF NOT FOUND OR d.rulare_id <> r.id OR d.item_sha256 IS DISTINCT FROM p_item_sha256 THEN RETURN jsonb_build_object('refuz', 'dezacord'); END IF;
  IF d.image_sha256 IS DISTINCT FROM p_image_sha256 THEN RETURN jsonb_build_object('refuz', 'imagine'); END IF;
  IF d.tip = 'structura_tabele' THEN RETURN jsonb_build_object('refuz', 'tip'); END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_arbitraje a WHERE a.dezacord_id = d.id) THEN RETURN jsonb_build_object('refuz', 'arbitrat'); END IF;
  RETURN jsonb_build_object('item_id', d.item_id, 'tip', d.tip, 'citire_lighton', d.citire_lighton, 'citire_mineru', d.citire_mineru,
                            'e_cantitate', d.e_cantitate, 'anomalie_separator', d.anomalie_separator);
END $f$;

-- Decizia needs_human FĂRĂ apel plătit: o rezervare de 0,0001 decontată imediat la 0 (rezervare_id e obligatoriu la arbitraj), fără
-- cost în rulare. Pentru structura_tabele (nu se arbitrează automat) sau orice dezacord trimis direct la om. Aceleași verificări.
CREATE FUNCTION public.fn_ofertare_ocr_arbitraj_om(p_rulare_id bigint, p_dezacord_id bigint, p_item_sha256 text, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; d record; v_z bigint; v_id bigint;
BEGIN
  IF p_motiv IS NULL OR p_motiv !~ '[^[:space:]]' OR length(p_motiv) > 200 THEN RAISE EXCEPTION 'Motiv obligatoriu (max 200)' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR UPDATE;
  IF NOT FOUND OR r.stare <> 'citita' THEN RAISE EXCEPTION 'Rularea nu e în citita' USING ERRCODE = '55000'; END IF;
  SELECT * INTO d FROM public.ofertare_ocr_dezacorduri WHERE id = p_dezacord_id;
  IF NOT FOUND OR d.rulare_id <> r.id OR d.item_sha256 IS DISTINCT FROM p_item_sha256 THEN
    RAISE EXCEPTION 'Dezacordul nu aparține rulării sau amprenta diferă' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_arbitraje a WHERE a.dezacord_id = d.id) THEN RAISE EXCEPTION 'Dezacord deja arbitrat' USING ERRCODE = '55000'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rezervari z WHERE z.dezacord_id = d.id AND z.stare = 'deschisa') THEN
    RAISE EXCEPTION 'Un arbitraj e deja în zbor pe acest dezacord' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_ocr_rezervari (rulare_id, suma, dezacord_id, stare, cost_real, inchisa_la)
  VALUES (r.id, 0.0001, d.id, 'decontata', 0, now()) RETURNING id INTO v_z;
  INSERT INTO public.ofertare_ocr_arbitraje (dezacord_id, rezervare_id, decizie, text_ales, motiv, e_cantitate_arbitru, anomalie_arbitru,
                                             arbitru_model, prompt_versiune, cost_usd)
  VALUES (d.id, v_z, 'needs_human', NULL, p_motiv, d.e_cantitate, d.anomalie_separator, 'om', 'fara-ai', 0)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'arbitraj_id', v_id, 'item_id', d.item_id);
END $f$;

-- Rezervarea pentru arbitrajul UNUI dezacord: toate verificările înaintea apelului plătit, atomic sub blocarea rulării.
-- Întoarce {"rezervare_id": n} sau {"refuz": motiv} cu motiv ∈ suma | stare | dezacord | imagine | tip | arbitrat | in_zbor | plafon.
CREATE FUNCTION public.fn_ofertare_ocr_arbitraj_rezerva(p_rulare_id bigint, p_dezacord_id bigint, p_item_sha256 text, p_image_sha256 text, p_suma numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; d record; v_id bigint;
BEGIN
  IF p_suma IS NULL OR p_suma < 0.0001 OR p_suma > 1 OR p_suma <> round(p_suma, 4) THEN RETURN jsonb_build_object('refuz', 'suma'); END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR UPDATE;
  IF NOT FOUND OR r.stare <> 'citita' THEN RETURN jsonb_build_object('refuz', 'stare'); END IF;
  SELECT * INTO d FROM public.ofertare_ocr_dezacorduri WHERE id = p_dezacord_id;
  IF NOT FOUND OR d.rulare_id <> r.id OR d.item_sha256 IS DISTINCT FROM p_item_sha256 THEN RETURN jsonb_build_object('refuz', 'dezacord'); END IF;
  IF d.image_sha256 IS DISTINCT FROM p_image_sha256 THEN RETURN jsonb_build_object('refuz', 'imagine'); END IF;
  IF d.tip = 'structura_tabele' THEN RETURN jsonb_build_object('refuz', 'tip'); END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_arbitraje a WHERE a.dezacord_id = d.id) THEN RETURN jsonb_build_object('refuz', 'arbitrat'); END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rezervari z WHERE z.dezacord_id = d.id AND z.stare = 'deschisa') THEN
    RETURN jsonb_build_object('refuz', 'in_zbor');
  END IF;
  IF r.cost_usd + r.cost_rezervat + r.cost_abandonat + p_suma > r.plafon_usd THEN RETURN jsonb_build_object('refuz', 'plafon'); END IF;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat + p_suma WHERE id = r.id;
  INSERT INTO public.ofertare_ocr_rezervari (rulare_id, suma, dezacord_id) VALUES (r.id, p_suma, d.id) RETURNING id INTO v_id;
  RETURN jsonb_build_object('rezervare_id', v_id);
END $f$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_ocr_scrie_arbitraj(p_rezervare_id bigint, p_arbitraj jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE z record; r record; d record; a jsonb := coalesce(p_arbitraj, '{}'::jsonb); v_cost numeric; v_text text; v_id bigint;
        v_tin int; v_tout int; v_model text; v_motiv text; v_jurnal boolean := true;
BEGIN
  SELECT * INTO z FROM public.ofertare_ocr_rezervari WHERE id = p_rezervare_id FOR UPDATE;
  IF NOT FOUND OR z.stare <> 'deschisa' THEN RAISE EXCEPTION 'Rezervare inexistentă sau deja închisă' USING ERRCODE = '55000'; END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = z.rulare_id FOR UPDATE;
  v_cost := CASE WHEN a->>'cost_usd' ~ '^[0-9]{1,2}(\.[0-9]{1,4})?$' THEN (a->>'cost_usd')::numeric END;
  IF v_cost IS NULL OR v_cost > z.suma THEN RAISE EXCEPTION 'Cost real invalid sau peste rezervare' USING ERRCODE = '22023'; END IF;
  v_tin := CASE WHEN a->>'tokens_in' ~ '^[0-9]{1,9}$' THEN (a->>'tokens_in')::int ELSE 0 END;
  v_tout := CASE WHEN a->>'tokens_out' ~ '^[0-9]{1,9}$' THEN (a->>'tokens_out')::int ELSE 0 END;
  v_model := left(coalesce(a->>'arbitru_model', ''), 100);
  -- 1) decontarea: întotdeauna
  UPDATE public.ofertare_ocr_rezervari SET stare = 'decontata', cost_real = v_cost, inchisa_la = now() WHERE id = p_rezervare_id;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat - z.suma, cost_usd = cost_usd + v_cost WHERE id = r.id;
  BEGIN  -- jurnalul de cost e auxiliar: o eroare aici nu anulează decontarea (costul e deja în rulare și în rezervare)
    INSERT INTO public.ai_usage_log (function_name, model, tokens_in, tokens_out, cost_usd, ref_table, ref_id)
    VALUES ('ofertare-ocr-arbitreaza', nullif(v_model, ''), v_tin, v_tout, v_cost, 'ofertare_ocr_rezervari', p_rezervare_id);
  EXCEPTION WHEN OTHERS THEN v_jurnal := false;
  END;
  IF r.stare <> 'citita' THEN
    RETURN jsonb_build_object('ok', true, 'decontat', true, 'jurnal_cost', v_jurnal, 'arbitraj_inregistrat', false, 'motiv', 'rularea nu mai e în citita');
  END IF;
  -- 2) decizia: separat; orice eroare o respinge fără să anuleze decontarea
  BEGIN
    SELECT * INTO d FROM public.ofertare_ocr_dezacorduri WHERE id = (a->>'dezacord_id')::bigint;
    IF NOT FOUND OR d.rulare_id <> r.id OR d.item_sha256 IS DISTINCT FROM a->>'item_sha256' THEN
      RAISE EXCEPTION 'Dezacordul nu aparține rulării rezervării sau amprenta diferă' USING ERRCODE = '22023';
    END IF;
    -- 20261029c: rezervarea luată pentru un dezacord se decontează DOAR cu decizia acelui dezacord
    IF z.dezacord_id IS NOT NULL AND z.dezacord_id IS DISTINCT FROM d.id THEN
      RAISE EXCEPTION 'Rezervarea a fost luată pentru alt dezacord' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(a->'e_cantitate') <> 'boolean' OR jsonb_typeof(a->'anomalie_separator') <> 'boolean' THEN
      RAISE EXCEPTION 'Marcaje arbitru invalide' USING ERRCODE = '22023';
    END IF;
    v_text := CASE a->>'decizie' WHEN 'ales_lighton' THEN d.citire_lighton WHEN 'ales_mineru' THEN d.citire_mineru
                                 WHEN 'text_propus' THEN a->>'text' ELSE NULL END;
    INSERT INTO public.ofertare_ocr_arbitraje (dezacord_id, rezervare_id, decizie, text_ales, motiv, e_cantitate_arbitru, anomalie_arbitru,
                                               arbitru_model, prompt_versiune, cost_usd)
    VALUES (d.id, p_rezervare_id, a->>'decizie', v_text, a->>'motiv', (a->>'e_cantitate')::boolean, (a->>'anomalie_separator')::boolean,
            a->>'arbitru_model', a->>'prompt_versiune', v_cost)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_motiv = MESSAGE_TEXT;
    RETURN jsonb_build_object('ok', true, 'decontat', true, 'jurnal_cost', v_jurnal, 'arbitraj_inregistrat', false, 'motiv', left(v_motiv, 200));
  END;
  RETURN jsonb_build_object('ok', true, 'decontat', true, 'jurnal_cost', v_jurnal, 'arbitraj_inregistrat', true, 'id', v_id);
END $f$;

-- ── execuție + amprenta re-ștampilată ──
DO $post$
DECLARE v_fp text;
BEGIN
  REVOKE ALL ON FUNCTION public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric) TO service_role;
  REVOKE ALL ON FUNCTION public.fn_ofertare_ocr_dezacord_arbitraj(bigint,bigint,text,text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_ocr_dezacord_arbitraj(bigint,bigint,text,text) TO service_role;
  REVOKE ALL ON FUNCTION public.fn_ofertare_ocr_arbitraj_om(bigint,bigint,text,text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_ocr_arbitraj_om(bigint,bigint,text,text) TO service_role;
  REVOKE EXECUTE ON FUNCTION public.fn_ofertare_ocr_cost_rezerva(bigint,numeric) FROM service_role;
  IF has_function_privilege('anon', 'public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.fn_ofertare_ocr_dezacord_arbitraj(bigint,bigint,text,text)', 'public.fn_ofertare_ocr_arbitraj_om(bigint,bigint,text,text)']) f
                 WHERE has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
                    OR NOT has_function_privilege('service_role', f, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261029c: postconditie executie';
  END IF;
  IF has_any_column_privilege('service_role', 'public.ofertare_ocr_rezervari', 'SELECT') OR has_any_column_privilege('authenticated', 'public.ofertare_ocr_rezervari', 'INSERT')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 22 THEN
    RAISE EXCEPTION '20261029c: postconditie obiecte';
  END IF;
  v_fp := public.fn_ofertare_ocr_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_ocr_rulari IS %L', 'Pilot OCR local (20261029b + 20261029c). Stare doar prin RPC. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029c_ofertare_ocr_arbitraj_rezerva:' || txid_current() THEN
    RAISE EXCEPTION '20261029c: garda final invalida';
  END IF;
END $post$;
