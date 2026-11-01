-- REVENIRE 20261125a_izo_ocr_local_bucket (armată; doar la cererea lui Răzvan). Șterge bucket-ul DOAR dacă e gol (DELETE pe storage.* cere storage.allow_delete_query).
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261125a', true) IS DISTINCT FROM 'BUCKET_OCR_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261125a revenire: neinarmata';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261125a revenire: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'ocr-local-cereri') THEN RAISE EXCEPTION '20261125a revenire: bucket-ul nu e gol'; END IF;
END $pre$;
SELECT set_config('storage.allow_delete_query', 'true', true);
DELETE FROM storage.buckets WHERE id = 'ocr-local-cereri';
