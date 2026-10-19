-- REVENIRE 20261101b - scoate valoarea 'ocr_local_neverificat' din CHECK-ul ofertare_doc_texte_prov.origine si functia
-- fn_ofertare_doc_prov_curent; reface amprenta TKT-0329 B. Refuza daca exista deja randuri cu aceasta origine (randurile de provenienta
-- sunt imuabile; revenirea lor se decide separat) sau daca obiectele s-au schimbat dupa aplicare (amprenta). DOAR la cererea lui Razvan,
-- ca postgres, prin psql. Armare per tranzactie:
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
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_doc_prov_curent(bigint)') IS NULL THEN RAISE EXCEPTION '20261101b rollback: migrarea nu e aplicata'; END IF;
  IF coalesce(obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta() THEN
    RAISE EXCEPTION '20261101b rollback: obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;
  -- o inserare concurenta cu noua origine fie s-a comis (o vedem -> refuz), fie asteapta si apoi pica pe CHECK-ul vechi
  LOCK TABLE public.ofertare_doc_texte_prov IN SHARE MODE;
  IF EXISTS (SELECT 1 FROM public.ofertare_doc_texte_prov WHERE origine = 'ocr_local_neverificat') THEN
    RAISE EXCEPTION '20261101b rollback: exista proveniente ocr_local_neverificat - intai se decide soarta lor';
  END IF;
END $revenire$;
DROP FUNCTION public.fn_ofertare_doc_prov_curent(bigint);
ALTER TABLE public.ofertare_doc_texte_prov DROP CONSTRAINT ofertare_doc_texte_prov_origine_check;
ALTER TABLE public.ofertare_doc_texte_prov ADD CONSTRAINT ofertare_doc_texte_prov_origine_check CHECK (origine IN ('transcriere', 'sinteza_ai'));
COMMENT ON COLUMN public.ofertare_doc_texte_prov.origine IS NULL;
DO $refa$
BEGIN
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L',
                 'TKT-0329 B (20261031a + 20261031b + 20261031d). Imuabil. amprenta=' || public.fn_ofertare_cb_amprenta());
END $refa$;
