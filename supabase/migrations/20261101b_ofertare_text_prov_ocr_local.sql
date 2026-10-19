-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261101b — Ofertare: proveniența „ocr_local_neverificat” pentru textul unui document (decizia Răzvan 19.10.2026, „da C + A”).
-- Context: Răcari (licitația 15), doc 1654 — textul citit de OCR local (LightOn + MinerU, laborator) nu avea cum intra în text_extras
-- cu o proveniență ONESTĂ: ofertare_doc_texte_prov.origine acceptă doar 'transcriere' / 'sinteza_ai', iar 'transcriere' ar fi
-- sugerat un text verificat. Se adaugă a treia valoare, 'ocr_local_neverificat'.
--   * Doar CHECK-ul de pe ofertare_doc_texte_prov.origine se schimbă (aceleași tabele, aceleași drepturi, aceleași funcții).
--   * Siguranța în aval NU se schimbă: fn_ofertare_cb_text_valid_asof acceptă ca sursă de extragere DOAR origine = 'transcriere' (sau
--     o decizie umană 'text_confirmat'); un text 'ocr_local_neverificat' rămâne automat în afara extragerii cantităților până la
--     confirmarea omului.
--   * Afișarea proveniențelor în fișa documentului = UI (același PR).
-- Revenire: supabase/revenire/20261101b_ofertare_text_prov_ocr_local_ROLLBACK.sql (refuză dacă există rânduri cu noua origine).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261101b_ofertare_text_prov_ocr_local:' || txid_current() THEN
    RAISE EXCEPTION '20261101b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261101b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ofertare_doc_texte_prov') IS NULL THEN RAISE EXCEPTION '20261101b: preconditie (ofertare_doc_texte_prov lipsa)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ofertare_doc_texte_prov'::regclass
                    AND conname = 'ofertare_doc_texte_prov_origine_check') THEN
    RAISE EXCEPTION '20261101b: preconditie (CHECK-ul origine lipsa sau redenumit)';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.ofertare_doc_texte_prov'::regclass
                             AND conname = 'ofertare_doc_texte_prov_origine_check')) LIKE '%ocr_local_neverificat%' THEN
    RAISE EXCEPTION '20261101b: deja aplicata';
  END IF;
END $pre$;

ALTER TABLE public.ofertare_doc_texte_prov DROP CONSTRAINT ofertare_doc_texte_prov_origine_check;
ALTER TABLE public.ofertare_doc_texte_prov ADD CONSTRAINT ofertare_doc_texte_prov_origine_check
  CHECK (origine IN ('transcriere', 'sinteza_ai', 'ocr_local_neverificat'));
COMMENT ON COLUMN public.ofertare_doc_texte_prov.origine IS
  'transcriere (ingest AI) | sinteza_ai (rezumat AI) | ocr_local_neverificat (OCR local de laborator, neverificat de om; NU e sursa de extragere - 20261101b)';

DO $post$
BEGIN
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.ofertare_doc_texte_prov'::regclass
                             AND conname = 'ofertare_doc_texte_prov_origine_check')) NOT LIKE '%ocr_local_neverificat%' THEN
    RAISE EXCEPTION '20261101b: postconditie (CHECK-ul nou lipsa)';
  END IF;
  -- sursa de extragere ramane DOAR 'transcriere' (sau decizia umana): garda impotriva unei modificari viitoare tacite
  IF pg_get_functiondef('public.fn_ofertare_cb_text_valid_asof(bigint,bigint,text,timestamptz)'::regprocedure)
       NOT LIKE '%origine FROM p) = ''transcriere''%' THEN
    RAISE EXCEPTION '20261101b: postconditie (fn_ofertare_cb_text_valid_asof nu mai filtreaza pe transcriere)';
  END IF;
END $post$;
