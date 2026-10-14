-- REVENIRE 20261029c — readuce EXACT obiectele 20261029b: scoate fn_ofertare_ocr_arbitraj_rezerva / _dezacord_arbitraj /
-- _arbitraj_om, indexul și coloana
-- ofertare_ocr_rezervari.dezacord_id, readuce definiția originală a fn_ofertare_ocr_scrie_arbitraj și EXECUTE pentru service_role pe
-- fn_ofertare_ocr_cost_rezerva, apoi re-ștampilează amprenta 20261029b (care trebuie să fie din nou cea de la aplicarea lui b).
-- Legătura rezervare ↔ dezacord a rezervărilor existente se PIERDE (rezervările și costurile rămân). DOAR la cererea lui Răzvan.
-- Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261029c', 'OCR_LOCAL_C_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE v_fp text; v_comentariu text;
BEGIN
  IF current_setting('gazpet.revenire_20261029c', true)
       IS DISTINCT FROM 'OCR_LOCAL_C_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261029c=%') THEN
    RAISE EXCEPTION '20261029c: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029c: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)') IS NULL THEN
    RAISE EXCEPTION '20261029c: preconditie, migrarea nu e aplicata';
  END IF;
  -- aceeași expresie ca fn_ofertare_ocr_amprenta(), INLINE (o funcție modificată nu se poate autovalida)
  SELECT (SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
    SELECT 'f:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || pg_get_userbyid(p.proowner)
           || ':' || coalesce(p.proacl::text, '') AS x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%'
    UNION ALL
    SELECT 't:' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text
           || c.relforcerowsecurity::text
           || ':' || (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.attidentity::text
                                        || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' ' || coalesce(a.attacl::text, ''), ',' ORDER BY a.attnum)
                        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
           || ':' || coalesce((SELECT string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid), '')
           || ':' || coalesce((SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY 1) FROM pg_index i WHERE i.indrelid = c.oid), '')
           || ':' || coalesce((SELECT string_agg(pg_get_triggerdef(g.oid) || ' ' || g.tgenabled::text, ',' ORDER BY g.tgname) FROM pg_trigger g WHERE g.tgrelid = c.oid AND NOT g.tgisinternal), '')
           || ':' || coalesce((SELECT string_agg(po.polname || ' ' || po.polcmd::text || ' ' || po.polpermissive::text || ' ' || po.polroles::regrole[]::text || ' '
                                                 || coalesce(pg_get_expr(po.polqual, po.polrelid), '') || ' ' || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), ''),
                                                 ',' ORDER BY po.polname) FROM pg_policy po WHERE po.polrelid = c.oid), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'ofertare\_ocr\_%'
    UNION ALL
    SELECT 's:' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, '') || ':' || q.seqstart || ' ' || q.seqincrement
           || ' ' || q.seqmin || ' ' || q.seqmax || ' ' || q.seqcache || ' ' || q.seqcycle::text || ' ' || format_type(q.seqtypid, NULL)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_sequence q ON q.seqrelid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'ofertare\_ocr\_%') s) INTO v_fp;
  v_comentariu := obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class');
  IF v_comentariu IS NULL OR v_comentariu NOT LIKE '%amprenta=' || v_fp THEN
    RAISE EXCEPTION '20261029c: preconditie, obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rezervari WHERE stare = 'deschisa' AND dezacord_id IS NOT NULL) THEN
    RAISE EXCEPTION '20261029c: preconditie, exista rezervari deschise legate de dezacorduri - decontati / abandonati intai';
  END IF;
  DROP FUNCTION public.fn_ofertare_ocr_arbitraj_rezerva(bigint, bigint, text, text, numeric);
  DROP FUNCTION public.fn_ofertare_ocr_dezacord_arbitraj(bigint, bigint, text, text);
  DROP FUNCTION public.fn_ofertare_ocr_arbitraj_om(bigint, bigint, text, text);
  DROP INDEX public.ofertare_ocr_rezervari_un_zbor;
  ALTER TABLE public.ofertare_ocr_rezervari DROP COLUMN dezacord_id;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_ocr_cost_rezerva(bigint,numeric) TO service_role;
END $revenire$;

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

DO $post$
DECLARE v_fp text;
BEGIN
  v_fp := public.fn_ofertare_ocr_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_ocr_rulari IS %L', 'Pilot OCR local (20261029b). Stare doar prin RPC. amprenta=' || v_fp);
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 19 THEN
    RAISE EXCEPTION '20261029c: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261029c', true)
       IS DISTINCT FROM 'OCR_LOCAL_C_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029c: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261029c', '', true);
END $post$;
