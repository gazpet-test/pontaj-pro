-- Rollback [CTC] F1. ATENȚIE: șterge cărțile, pozițiile și template-urile CTC (toate noi, fără alte dependențe).
-- Fișierele din bucket nu se șterg prin SQL: întâi se golește bucketul ctc-documente din Storage (UI/API),
-- altfel DELETE-ul din storage.buckets eșuează. Tabela veche ctc_documente nu e afectată.
DROP POLICY IF EXISTS ctc_storage_select ON storage.objects;
DROP POLICY IF EXISTS ctc_storage_insert ON storage.objects;
DROP POLICY IF EXISTS ctc_storage_update ON storage.objects;
DROP POLICY IF EXISTS ctc_storage_delete ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'ctc-documente';

DROP VIEW  IF EXISTS public.v_ctc_carti_progres;
DROP TABLE IF EXISTS public.ctc_documente_carte;
DROP TABLE IF EXISTS public.ctc_carti;
DROP TABLE IF EXISTS public.ctc_template_pozitii;
DROP TABLE IF EXISTS public.ctc_templates;
