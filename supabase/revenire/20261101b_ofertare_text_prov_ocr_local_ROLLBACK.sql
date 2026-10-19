-- REVENIRE 20261101b - scoate valoarea 'ocr_local_neverificat' din CHECK-ul ofertare_doc_texte_prov.origine. Refuza daca exista deja
-- randuri cu aceasta origine (randurile de provenienta sunt imuabile; revenirea lor se decide separat). DOAR la cererea lui Razvan, ca
-- postgres, prin psql. Armare per tranzactie:
--   SELECT set_config('gazpet.revenire_20261101b', 'PROV_OCR_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261101b', true) IS DISTINCT FROM 'PROV_OCR_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261101b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261101b=%') THEN
    RAISE EXCEPTION '20261101b: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261101b rollback: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_doc_texte_prov WHERE origine = 'ocr_local_neverificat') THEN
    RAISE EXCEPTION '20261101b rollback: exista proveniente ocr_local_neverificat - intai se decide soarta lor';
  END IF;
END $revenire$;
ALTER TABLE public.ofertare_doc_texte_prov DROP CONSTRAINT ofertare_doc_texte_prov_origine_check;
ALTER TABLE public.ofertare_doc_texte_prov ADD CONSTRAINT ofertare_doc_texte_prov_origine_check CHECK (origine IN ('transcriere', 'sinteza_ai'));
COMMENT ON COLUMN public.ofertare_doc_texte_prov.origine IS NULL;
