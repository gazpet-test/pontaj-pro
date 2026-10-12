-- REVENIRE 20261024b — șterge funcțiile și tabelul de jurnal pentru contracte-pdf-link (jurnalul se pierde).
-- DOAR la cererea explicită a lui Răzvan, ÎMPREUNĂ cu retragerea edge-ului contracte-pdf-link (altfel edge-ul dă 500).
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261024b', 'CONTRACTE_PDF_JURNAL_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261024b', true)
       IS DISTINCT FROM 'CONTRACTE_PDF_JURNAL_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261024b=%') THEN
    RAISE EXCEPTION '20261024b: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261024b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.contracte_pdf_link_jurnal') IS NULL
     OR to_regprocedure('public.fn_contracte_pdf_link_rezerva(bigint)') IS NULL
     OR to_regprocedure('public.fn_contracte_pdf_link_final(bigint,text)') IS NULL THEN
    RAISE EXCEPTION '20261024b: preconditie, obiectele lipsesc';
  END IF;
  DROP FUNCTION public.fn_contracte_pdf_link_final(bigint, text);
  DROP FUNCTION public.fn_contracte_pdf_link_rezerva(bigint);
  DROP TABLE public.contracte_pdf_link_jurnal;
  IF to_regclass('public.contracte_pdf_link_jurnal') IS NOT NULL
     OR to_regprocedure('public.fn_contracte_pdf_link_rezerva(bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_contracte_pdf_link_final(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261024b: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261024b', true)
       IS DISTINCT FROM 'CONTRACTE_PDF_JURNAL_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261024b', '', true);
END $revenire$;
