-- REVENIRE 20261125a_izo_ocr_local_bucket (armată; doar la cererea lui Răzvan). Șterge bucket-ul DOAR dacă e gol (DELETE pe storage.* cere storage.allow_delete_query).
-- ÎNAINTE: oprește fluxul E9 (worker-ul local `e3 opreste` și, dacă e nevoie, edge-ul izo-e3-ocr-local), ca să nu intre cereri noi.
-- Concurență (Copilot #909 P2-01): dacă totuși un upload intră între verificare și DELETE, cheia străină storage.objects.bucket_id → buckets
-- face DELETE-ul să pice (tranzacția se anulează, bucket-ul rămâne) — nu se poate șterge un bucket cu obiecte.
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
