-- REVENIRE 20261028a — șterge coada documente_de_repartizat și funcțiile fn_doc_*.
-- Rândurile încă „de_repartizat” se pierd din ERP (fișierele rămân în Storage sub _de_repartizat/ și în Drive).
-- Cele deja repartizate sunt în documente_proiect și rămân. DOAR la cererea explicită a lui Răzvan,
-- ÎMPREUNĂ cu revenirea edge-ului ingest-document la v16 și a frontend-ului.
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261028a', 'DOC_DE_REPARTIZAT_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261028a', true)
       IS DISTINCT FROM 'DOC_DE_REPARTIZAT_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261028a=%') THEN
    RAISE EXCEPTION '20261028a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.documente_de_repartizat') IS NULL THEN RAISE EXCEPTION '20261028a: preconditie, tabelul lipseste'; END IF;
  DROP FUNCTION public.fn_doc_muta_in_coada(bigint[], boolean);
  DROP FUNCTION public.fn_doc_ignora(bigint);
  DROP FUNCTION public.fn_doc_repartizeaza(bigint, bigint);
  DROP FUNCTION public.fn_doc_acces_executie();
  DROP TABLE public.documente_de_repartizat;
  IF to_regclass('public.documente_de_repartizat') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_doc_repartizeaza', 'fn_doc_ignora', 'fn_doc_muta_in_coada', 'fn_doc_acces_executie')) THEN
    RAISE EXCEPTION '20261028a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261028a', true)
       IS DISTINCT FROM 'DOC_DE_REPARTIZAT_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028a: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261028a', '', true);
END $revenire$;
