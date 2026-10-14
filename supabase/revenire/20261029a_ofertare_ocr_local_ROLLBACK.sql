-- REVENIRE 20261029a — pilot OCR local Ofertare: șterge cele 7 tabele noi și cele 19 funcții fn_ofertare_ocr_*.
-- DATELE OCR SE PIERD (rulări, pagini citite, dezacorduri, rezervări, arbitraje, verificări, jurnalul linkurilor). Nu atinge
-- text_extras, cantități sau alte tabele existente. Rândul 'ocr_local_ofertare' din procese_heartbeat se DEZACTIVEAZĂ (activ = false),
-- nu se șterge (fn_ofertare_ocr_heartbeat îl reactivează la o reaplicare).
-- Refuză dacă obiectele NU mai sunt exact cele aplicate de 20261029a: amprenta recalculată acum (definiții + ACL funcții, coloane +
-- ACL + constrângeri + politici tabele) trebuie să fie identică cu cea înregistrată la aplicare în comentariul ofertare_ocr_rulari.
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261029a', 'OCR_LOCAL_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE v_fp text; v_comentariu text;
BEGIN
  IF current_setting('gazpet.revenire_20261029a', true)
       IS DISTINCT FROM 'OCR_LOCAL_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261029a=%') THEN
    RAISE EXCEPTION '20261029a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ofertare_ocr_rulari') IS NULL THEN RAISE EXCEPTION '20261029a: preconditie, migrarea nu e aplicata'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 19
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'ofertare\_ocr\_%') <> 7 THEN
    RAISE EXCEPTION '20261029a: preconditie, alt numar de obiecte decat la aplicare';
  END IF;
  -- aceeași expresie ca fn_ofertare_ocr_amprenta() din migrare, copiată INLINE (o funcție modificată nu se poate autovalida)
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
    RAISE EXCEPTION '20261029a: preconditie, obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;

  DROP FUNCTION public.fn_ofertare_ocr_cerere(bigint, bigint[], numeric);
  DROP FUNCTION public.fn_ofertare_ocr_anuleaza(bigint);
  DROP FUNCTION public.fn_ofertare_ocr_verifica(bigint, text, text);
  DROP FUNCTION public.fn_ofertare_ocr_esantion(bigint);
  DROP FUNCTION public.fn_ofertare_ocr_preia(text);
  DROP FUNCTION public.fn_ofertare_ocr_stare(bigint, text, text);
  DROP FUNCTION public.fn_ofertare_ocr_pdf_rezerva(bigint, bigint);
  DROP FUNCTION public.fn_ofertare_ocr_pdf_final(bigint, text);
  DROP FUNCTION public.fn_ofertare_ocr_scrie_pagina(bigint, bigint, integer, smallint, text, text, text, text, text, text, jsonb, jsonb);
  DROP FUNCTION public.fn_ofertare_ocr_plan(bigint, jsonb);
  DROP FUNCTION public.fn_ofertare_ocr_scrie_dezacord(bigint, jsonb);
  DROP FUNCTION public.fn_ofertare_ocr_cost_rezerva(bigint, numeric);
  DROP FUNCTION public.fn_ofertare_ocr_scrie_arbitraj(bigint, jsonb);
  DROP FUNCTION public.fn_ofertare_ocr_rezervare_abandon(bigint);
  DROP FUNCTION public.fn_ofertare_ocr_heartbeat(boolean, text);
  DROP FUNCTION public.fn_ofertare_ocr_comparatie_gata(bigint, integer, text);
  DROP FUNCTION public.fn_ofertare_ocr_amprenta();
  DROP FUNCTION public.fn_ofertare_ocr_granita(text, integer);
  DROP FUNCTION public.fn_ofertare_ocr_literal(jsonb, jsonb);
  DROP TABLE public.ofertare_ocr_verificari;
  DROP TABLE public.ofertare_ocr_arbitraje;
  DROP TABLE public.ofertare_ocr_rezervari;
  DROP TABLE public.ofertare_ocr_dezacorduri;
  DROP TABLE public.ofertare_ocr_pagini;
  DROP TABLE public.ofertare_ocr_pdf_jurnal;
  DROP TABLE public.ofertare_ocr_rulari;
  UPDATE public.procese_heartbeat SET activ = false WHERE cheie = 'ocr_local_ofertare';

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'ofertare\_ocr\_%')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') THEN
    RAISE EXCEPTION '20261029a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261029a', true)
       IS DISTINCT FROM 'OCR_LOCAL_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029a: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261029a', '', true);
END $revenire$;
