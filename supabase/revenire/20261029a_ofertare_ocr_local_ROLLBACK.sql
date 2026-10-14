-- REVENIRE 20261029a — pilot OCR local Ofertare: șterge cele 5 tabele noi și cele 12 funcții fn_ofertare_ocr_*.
-- DATELE OCR SE PIERD (pagini citite, arbitraje, verificări, rulări, jurnalul linkurilor). Nu atinge text_extras, cantități
-- sau alte tabele existente (migrarea nu le-a atins). Rândul 'ocr_local_ofertare' din procese_heartbeat (dacă a fost scris) rămâne;
-- se dezactivează aici (activ = false), nu se șterge.
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261029a', 'OCR_LOCAL_REVENIRE:' || txid_current(), true);
DO $revenire$
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

  DROP FUNCTION public.fn_ofertare_ocr_cerere(bigint, bigint[], numeric);
  DROP FUNCTION public.fn_ofertare_ocr_anuleaza(bigint);
  DROP FUNCTION public.fn_ofertare_ocr_verifica(bigint, text, text);
  DROP FUNCTION public.fn_ofertare_ocr_esantion(bigint);
  DROP FUNCTION public.fn_ofertare_ocr_preia(text);
  DROP FUNCTION public.fn_ofertare_ocr_stare(bigint, text, text);
  DROP FUNCTION public.fn_ofertare_ocr_pdf_rezerva(bigint, bigint);
  DROP FUNCTION public.fn_ofertare_ocr_pdf_final(bigint, text);
  DROP FUNCTION public.fn_ofertare_ocr_scrie_pagina(bigint, bigint, integer, text, text, text, text, text, text, jsonb);
  DROP FUNCTION public.fn_ofertare_ocr_cost_rezerva(bigint, numeric);
  DROP FUNCTION public.fn_ofertare_ocr_scrie_arbitraj(bigint, numeric, jsonb);
  DROP FUNCTION public.fn_ofertare_ocr_heartbeat(boolean, text);
  DROP TABLE public.ofertare_ocr_verificari;
  DROP TABLE public.ofertare_ocr_arbitraje;
  DROP TABLE public.ofertare_ocr_pagini;
  DROP TABLE public.ofertare_ocr_pdf_jurnal;
  DROP TABLE public.ofertare_ocr_rulari;
  UPDATE public.procese_heartbeat SET activ = false WHERE cheie = 'ocr_local_ofertare';

  IF to_regclass('public.ofertare_ocr_rulari') IS NOT NULL OR to_regclass('public.ofertare_ocr_pagini') IS NOT NULL
     OR to_regclass('public.ofertare_ocr_arbitraje') IS NOT NULL OR to_regclass('public.ofertare_ocr_verificari') IS NOT NULL
     OR to_regclass('public.ofertare_ocr_pdf_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') THEN
    RAISE EXCEPTION '20261029a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261029a', true)
       IS DISTINCT FROM 'OCR_LOCAL_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029a: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261029a', '', true);
END $revenire$;
