-- 20261125a_izo_ocr_local_bucket — E9: bucket-ul `ocr-local-cereri` lipsea (01.11.2026). Designul (docs/izometrie/E9_LOCAL_DESIGN.md §150) cere
-- bucket privat, file_size_limit 8 MB, allowed_mime_types doar application/pdf; 20261108a / b nu l-au creat, deci orice cerere E3 pica la upload
-- (503 storage_indisponibil), ascuns până la 01.11 de verificarea PDF căzută (PR #907). Fără politici pe storage.objects: îl folosește doar
-- edge-ul izo-e3-ocr-local cu service_role (upload, link semnat 5 min pentru worker, ștergere). Nimeni din aplicație nu-l citește direct.
-- Revenire: supabase/revenire/20261125a_izo_ocr_local_bucket_ROLLBACK.sql (doar dacă bucket-ul e gol).
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261125a_izo_ocr_local_bucket:' || txid_current() THEN
    RAISE EXCEPTION '20261125a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261125a: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ocr-local-cereri') THEN RAISE EXCEPTION '20261125a: bucket-ul exista deja'; END IF;
END $pre$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ocr-local-cereri', 'ocr-local-cereri', false, 8388608, ARRAY['application/pdf']);
