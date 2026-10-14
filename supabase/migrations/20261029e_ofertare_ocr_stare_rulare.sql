-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261029e — Ofertare: pilot OCR local, starea rulării DOAR CITIRE pentru reluarea clientului (review r1 PR #700, decizia B Răzvan
-- 14.10.2026). Clientul serverului AI (scripts/ocr_local/client.py) nu poate confirma singur, după o cădere între commit-ul din BD și
-- marcajul local, că un pas unic a trecut (planul, marcajul comparației, o tranziție, o preluare). Acum o întreabă BD:
--   * fn_ofertare_ocr_rulare_stare(id) — starea, amprenta CANONICĂ a planului (aceeași formulă ca client.plan_sha), marcajul
--     comparației, costurile, rezervările deschise și numărători; {"exista": false} pentru un id necunoscut;
--   * fn_ofertare_ocr_rulari_active() — rulările preluata / citita / arbitrata (id, licitație, documente înghețate, plafon, protocol,
--     dacă au plan) — recuperarea unei preluări întrerupte înainte de scrierea locală.
-- Ambele: STABLE, SECURITY DEFINER, EXECUTE DOAR service_role (apelate prin ofertare-ocr-scrie, poarta = OCR_LOCAL_SECRET); nu întorc
-- textul documentelor. Nu atinge nicio tabelă și nicio funcție existentă; re-ștampilează amprenta (revenirea lui c / b refuză cât e
-- aplicată, se revine întâi 20261029e).
-- Revenire: supabase/revenire/20261029e_ofertare_ocr_stare_rulare_ROLLBACK.sql.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_fp text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029e_ofertare_ocr_stare_rulare:' || txid_current() THEN
    RAISE EXCEPTION '20261029e: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029e: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)') IS NULL THEN
    RAISE EXCEPTION '20261029e: 20261029c nu e aplicata';
  END IF;
  IF to_regprocedure('public.fn_ofertare_ocr_rulare_stare(bigint)') IS NOT NULL OR to_regprocedure('public.fn_ofertare_ocr_rulari_active()') IS NOT NULL THEN
    RAISE EXCEPTION '20261029e: obiectele exista deja';
  END IF;
  -- pornește DOAR peste obiectele exacte b + c (amprenta re-ștampilată de c la aplicare)
  v_fp := public.fn_ofertare_ocr_amprenta();
  IF v_fp IS NULL OR coalesce(obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || v_fp THEN
    RAISE EXCEPTION '20261029e: obiectele 20261029b/c s-au schimbat dupa aplicare (amprenta difera)';
  END IF;
END $pre$;

-- Amprenta canonică a planului (identică cu scripts/ocr_local/client.py plan_sha): sha256 peste rândurile
-- „document_id|pagina|<sha256(exclus) sau ->|banda:image_sha256,...\n” (benzile în ordinea numerică), rândurile sortate COLLATE "C".
CREATE FUNCTION public.fn_ofertare_ocr_rulare_stare(p_rulare_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_plan text;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('exista', false); END IF;
  IF r.plan IS NOT NULL THEN
    SELECT encode(sha256(convert_to(coalesce(string_agg(l, '' ORDER BY l COLLATE "C"), ''), 'UTF8')), 'hex') INTO v_plan
      FROM (SELECT (e->>'document_id') || '|' || (e->>'pagina') || '|'
                   || CASE WHEN jsonb_typeof(e->'exclus') = 'string' THEN encode(sha256(convert_to(e->>'exclus', 'UTF8')), 'hex') ELSE '-' END || '|'
                   || coalesce((SELECT string_agg((b->>'banda') || ':' || (b->>'image_sha256'), ',' ORDER BY (b->>'banda')::int)
                                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e->'benzi') = 'array' THEN e->'benzi' ELSE '[]'::jsonb END) b), '')
                   || E'\n' AS l
              FROM jsonb_array_elements(r.plan) e) s;
  END IF;
  RETURN jsonb_build_object(
    'exista', true, 'id', r.id, 'licitatie_id', r.licitatie_id, 'stare', r.stare, 'oprit_motiv', r.oprit_motiv, 'protocol', r.protocol,
    'plan_sha256', v_plan, 'plan_pagini', CASE WHEN r.plan IS NULL THEN NULL ELSE jsonb_array_length(r.plan) END,
    'comparatie_nr', r.comparatie_nr, 'comparatie_sha256', r.comparatie_sha256,
    'plafon_usd', r.plafon_usd, 'cost_usd', r.cost_usd, 'cost_rezervat', r.cost_rezervat, 'cost_abandonat', r.cost_abandonat,
    'rezervari_deschise', coalesce((SELECT jsonb_agg(z.id ORDER BY z.id) FROM public.ofertare_ocr_rezervari z WHERE z.rulare_id = r.id AND z.stare = 'deschisa'), '[]'::jsonb),
    'citiri', (SELECT count(*) FROM public.ofertare_ocr_pagini p WHERE p.rulare_id = r.id AND p.cititor IN ('lighton', 'mineru')),
    'reconciliate', (SELECT count(*) FROM public.ofertare_ocr_pagini p WHERE p.rulare_id = r.id AND p.cititor = 'reconciliat'),
    'dezacorduri', (SELECT count(*) FROM public.ofertare_ocr_dezacorduri d WHERE d.rulare_id = r.id),
    'arbitraje', (SELECT count(*) FROM public.ofertare_ocr_arbitraje a JOIN public.ofertare_ocr_dezacorduri d ON d.id = a.dezacord_id WHERE d.rulare_id = r.id));
END $f$;

CREATE FUNCTION public.fn_ofertare_ocr_rulari_active()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'licitatie_id', r.licitatie_id, 'stare', r.stare, 'documente', r.documente,
                                               'plafon_usd', r.plafon_usd, 'protocol', r.protocol, 'preluata_la', r.preluata_la,
                                               'are_plan', r.plan IS NOT NULL) ORDER BY r.id), '[]'::jsonb)
    FROM public.ofertare_ocr_rulari r WHERE r.stare IN ('preluata', 'citita', 'arbitrata')
$f$;

-- ── execuție + postcondiții + amprenta re-ștampilată ──
DO $post$
DECLARE v_fp text; f text;
BEGIN
  REVOKE ALL ON FUNCTION public.fn_ofertare_ocr_rulare_stare(bigint) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_ocr_rulare_stare(bigint) TO service_role;
  REVOKE ALL ON FUNCTION public.fn_ofertare_ocr_rulari_active() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_ocr_rulari_active() TO service_role;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_rulare_stare(bigint)', 'public.fn_ofertare_ocr_rulari_active()'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE')
       OR (SELECT provolatile FROM pg_proc WHERE oid = f::regprocedure) <> 's' THEN
      RAISE EXCEPTION '20261029e: postconditie executie %', f;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 25 THEN
    RAISE EXCEPTION '20261029e: postconditie obiecte';
  END IF;
  v_fp := public.fn_ofertare_ocr_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_ocr_rulari IS %L', 'Pilot OCR local (20261029b + 20261029c + 20261029e). Stare doar prin RPC. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029e_ofertare_ocr_stare_rulare:' || txid_current() THEN
    RAISE EXCEPTION '20261029e: garda final invalida';
  END IF;
END $post$;
