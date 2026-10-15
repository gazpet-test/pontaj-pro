-- REVENIRE 20261030d — scoate fn_ofertare_ocr_reia și jurnalul ofertare_ocr_reluari și re-ștampilează amprenta b + c + e (care trebuie
-- să fie din nou cea de la aplicarea lui e). Refuză dacă jurnalul are rânduri (reluări efectuate = istoric; nu se pierde tăcut —
-- se exportă întâi, apoi se golește manual, cu review). Se revine ÎNAINTEA lui 20261029e / c / b. DOAR la cererea lui Răzvan.
-- Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261030d', 'OCR_LOCAL_D_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE v_fp text; v_comentariu text;
BEGIN
  IF current_setting('gazpet.revenire_20261030d', true)
       IS DISTINCT FROM 'OCR_LOCAL_D_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261030d: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261030d=%') THEN
    RAISE EXCEPTION '20261030d: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261030d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_ocr_reia(bigint,text)') IS NULL OR to_regclass('public.ofertare_ocr_reluari') IS NULL THEN
    RAISE EXCEPTION '20261030d: preconditie, migrarea nu e aplicata';
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
    RAISE EXCEPTION '20261030d: preconditie, obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_reluari) THEN
    RAISE EXCEPTION '20261030d: jurnalul reluarilor are randuri (istoric) - exporta-l si goleste-l manual, cu review';
  END IF;
  -- urma reluării din oprit_motiv („reluata #k (reluare_id N): …”) nu există în semantica b + c + e (Copilot delta P1-1): cât mai e
  -- pe vreo rulare, revenirea refuză; se reconciliază manual (export + reformulare), cu review
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rulari WHERE oprit_motiv LIKE 'reluata #%') THEN
    RAISE EXCEPTION '20261030d: rulari cu urma reluarii in oprit_motiv - reconciliaza-le manual (export + reformulare), cu review';
  END IF;
  DROP FUNCTION public.fn_ofertare_ocr_reia(bigint, text);
  DROP TABLE public.ofertare_ocr_reluari;
END $revenire$;

DO $post$
DECLARE v_fp text;
BEGIN
  v_fp := public.fn_ofertare_ocr_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_ocr_rulari IS %L', 'Pilot OCR local (20261029b + 20261029c + 20261029e). Stare doar prin RPC. amprenta=' || v_fp);
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 25 THEN
    RAISE EXCEPTION '20261030d: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261030d', true)
       IS DISTINCT FROM 'OCR_LOCAL_D_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261030d: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261030d', '', true);
END $post$;
