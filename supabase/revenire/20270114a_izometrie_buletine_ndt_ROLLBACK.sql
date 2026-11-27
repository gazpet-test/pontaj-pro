-- REVENIRE 20270114a_izometrie_buletine_ndt. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (fără amprenta globală).
-- Scoate EXACT ce a pus migrarea: cele 6 tabele sud_, cele 11 funcții fn_sud_, bucket-ul izo-ndt și cele 2 politici sud_ndt_ pe storage.objects.
-- Refuză (nimic schimbat) dacă: există rânduri în oricare tabel sud_ sau obiecte în bucket (datele reale nu se pierd pe tăcute — golirea lor
--   e o decizie separată a proprietarului), lipsește vreun obiect al migrării, există obiecte sud_ / fn_sud_ în plus, porțile Izometrie nu sunt verzi.
DO $pre$
DECLARE v_plafon text; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270114a_izometrie_buletine_ndt_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270114a revenire: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION '20270114a revenire: necesita READ COMMITTED'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session' OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270114a revenire: PLAFON_TRANZACTIE lipsa (cerut 2000/session: livrare_migrare.sh --plafon-tranzactie-ms 2000)';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN
        ('sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi') AND c.relkind = 'r') <> 6
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%') <> 6
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 11
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-ndt')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname IN ('sud_ndt_citire', 'sud_ndt_incarcare')) <> 2 THEN
    RAISE EXCEPTION '20270114a revenire: starea nu e cea pusa de migrare (obiecte lipsa sau in plus); nimic schimbat';
  END IF;
  -- L14: lock ÎNAINTEA verificării „fără date” (altfel un rând / fișier scris între numărare și DROP s-ar pierde): tabelele sud_ exclusiv,
  -- rândul bucket-ului FOR UPDATE (încărcarea unui obiect ia FOR KEY SHARE pe el prin FK-ul storage.objects → buckets). NOWAIT: ocupat = refuz.
  LOCK TABLE public.sud_metode_proiect, public.sud_buletine, public.sud_buletin_randuri, public.sud_suduri_eliminate,
             public.sud_export_deblocari, public.sud_exporturi IN ACCESS EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM storage.buckets WHERE id = 'izo-ndt' FOR UPDATE NOWAIT;
  SELECT (SELECT count(*) FROM public.sud_metode_proiect) + (SELECT count(*) FROM public.sud_buletine) + (SELECT count(*) FROM public.sud_buletin_randuri)
       + (SELECT count(*) FROM public.sud_suduri_eliminate) + (SELECT count(*) FROM public.sud_export_deblocari) + (SELECT count(*) FROM public.sud_exporturi)
       + (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-ndt') INTO v_n;
  IF v_n > 0 THEN RAISE EXCEPTION '20270114a revenire: exista % randuri / fisiere in arhiva NDT; revenirea nu sterge date (decizie separata)', v_n; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270114a revenire: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
END $pre$;

DROP POLICY sud_ndt_incarcare ON storage.objects;
DROP POLICY sud_ndt_citire ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'izo-ndt';
DROP FUNCTION public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text);
DROP FUNCTION public.fn_sud_export_deblocheaza(bigint, text, text, jsonb);
DROP FUNCTION public.fn_sud_sudura_eliminare_retrage(bigint, text);
DROP FUNCTION public.fn_sud_sudura_elimina(bigint, text, text, text[]);
DROP FUNCTION public.fn_sud_buletin_anuleaza(bigint, text);
DROP FUNCTION public.fn_sud_buletin_confirma(bigint, integer, jsonb);
DROP FUNCTION public.fn_sud_buletin_incarca(bigint, text, text, date, text, text, text, text, jsonb, text);
DROP FUNCTION public.fn_sud_metode_seteaza(bigint, text[]);
DROP TABLE public.sud_exporturi;
DROP TABLE public.sud_export_deblocari;
DROP TABLE public.sud_suduri_eliminate;
DROP TABLE public.sud_buletin_randuri;
DROP TABLE public.sud_buletine;
DROP TABLE public.sud_metode_proiect;
DROP FUNCTION public.fn_sud_tronson_nr(text);
DROP FUNCTION public.fn_sud_cod_normalizeaza(text, integer);
DROP FUNCTION public.fn_sud_drept(bigint, boolean);

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'sud\_%')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-ndt')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\_ndt\_%') THEN
    RAISE EXCEPTION '20270114a revenire post: au ramas obiecte';
  END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270114a revenire post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270114a_izometrie_buletine_ndt_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270114a revenire: garda final invalida';
  END IF;
END $post$;
