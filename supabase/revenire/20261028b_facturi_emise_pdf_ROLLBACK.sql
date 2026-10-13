-- REVENIRE 20261028b — readuce cele 4 politici facturi_storage_* la expresia de dinainte (orice authenticated) și șterge
-- fn_factura_ataseaza_pdf + fn_facturi_pdf_acces. NU atinge rândurile facturi_emise deja legate (pentru ele există
-- lista de id-uri salvată la atașare). DOAR la cererea explicită a lui Răzvan, împreună cu revenirea frontend-ului.
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261028b', 'FACTURI_PDF_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE c_vechi CONSTANT text := '((bucket_id = ''facturi-emise''::text) AND (auth.uid() IS NOT NULL))'; r record;
BEGIN
  IF current_setting('gazpet.revenire_20261028b', true)
       IS DISTINCT FROM 'FACTURI_PDF_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261028b=%') THEN
    RAISE EXCEPTION '20261028b: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_facturi_pdf_acces()') IS NULL OR to_regprocedure('public.fn_factura_ataseaza_pdf(bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION '20261028b: preconditie, functiile lipsesc';
  END IF;
  ALTER POLICY facturi_storage_select ON storage.objects USING ((bucket_id = 'facturi-emise'::text) AND (auth.uid() IS NOT NULL));
  ALTER POLICY facturi_storage_insert ON storage.objects WITH CHECK ((bucket_id = 'facturi-emise'::text) AND (auth.uid() IS NOT NULL));
  ALTER POLICY facturi_storage_update ON storage.objects USING ((bucket_id = 'facturi-emise'::text) AND (auth.uid() IS NOT NULL))
    WITH CHECK ((bucket_id = 'facturi-emise'::text) AND (auth.uid() IS NOT NULL));
  ALTER POLICY facturi_storage_delete ON storage.objects USING ((bucket_id = 'facturi-emise'::text) AND (auth.uid() IS NOT NULL));
  DROP FUNCTION public.fn_factura_ataseaza_pdf(bigint, text, text);
  DROP FUNCTION public.fn_facturi_pdf_acces();
  FOR r IN SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) w
             FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname LIKE 'facturi_storage_%' LOOP
    IF (r.polname <> 'facturi_storage_insert' AND r.q IS DISTINCT FROM c_vechi)
       OR (r.polname IN ('facturi_storage_insert', 'facturi_storage_update') AND r.w IS DISTINCT FROM c_vechi) THEN
      RAISE EXCEPTION '20261028b: postconditie revenire %', r.polname;
    END IF;
  END LOOP;
  IF current_setting('gazpet.revenire_20261028b', true)
       IS DISTINCT FROM 'FACTURI_PDF_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028b: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261028b', '', true);
END $revenire$;
