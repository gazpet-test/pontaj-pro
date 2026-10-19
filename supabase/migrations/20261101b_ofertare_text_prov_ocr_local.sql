-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261101b — Ofertare: proveniența „ocr_local_neverificat” pentru textul unui document + citirea proveniențelor CURENTE pentru UI
-- (decizia Răzvan 19.10.2026, „da C + A”).
-- Context: Răcari (licitația 15), doc 1654 — textul citit de OCR local (LightOn + MinerU, laborator) nu avea cum intra în text_extras
-- cu o proveniență ONESTĂ: ofertare_doc_texte_prov.origine accepta doar 'transcriere' / 'sinteza_ai', iar 'transcriere' ar fi
-- sugerat un text verificat. Se adaugă a treia valoare, 'ocr_local_neverificat'.
--   * CHECK-ul de pe ofertare_doc_texte_prov.origine primește 'ocr_local_neverificat' (aceleași tabele, aceleași drepturi).
--   * Siguranța în aval NU se schimbă: fn_ofertare_cb_text_valid_asof acceptă ca sursă de extragere DOAR origine = 'transcriere' (sau
--     o decizie umană 'text_confirmat'); un text 'ocr_local_neverificat' rămâne în afara extragerii cantităților până la confirmarea
--     omului. Singurii consumatori ai tabelei (repo + BD, verificat 19.10): fn_ofertare_cb_text_valid_asof (= 'transcriere'),
--     fn_ofertare_cb_ingheata / _extragere_incepe / _extragere_redeschide (doar sha256), fn_ofertare_cb_amprenta (schema).
--   * fn_ofertare_doc_prov_curent(licitatie) — NOU, pentru fișa documentului (review #795 r1 Copilot + Gemini P1): ultimul rând de
--     proveniență pe document, ales în SQL (constatat_la, apoi id), cu `curent` = sha-ul rândului e sha-ul text_extras-ului ACTUAL
--     (aceeași canonicalizare ca fn_ofertare_cb_text_scrie). SECURITY INVOKER: RLS-ul existent (acces Ofertare) se aplică pe ambele
--     tabele; textul nu pleacă spre client, doar comparația.
--   * Amprenta TKT-0329 B (fn_ofertare_cb_amprenta: include CHECK-urile ofertare_doc_texte_prov) se verifică înainte și se
--     recalculează după, ca la 20261031b / 20261031d — altfel revenirile 31a / 31b / 31d ar refuza pe amprentă.
-- Revenire: supabase/revenire/20261101b_ofertare_text_prov_ocr_local_ROLLBACK.sql (refuză dacă există rânduri cu noua origine).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (psql --single-transaction; garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261101b_ofertare_text_prov_ocr_local:' || txid_current() THEN
    RAISE EXCEPTION '20261101b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261101b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ofertare_doc_texte_prov') IS NULL OR to_regprocedure('public.fn_ofertare_cb_amprenta()') IS NULL
     OR to_regprocedure('public.fn_ofertare_cb_text_valid_asof(bigint,bigint,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '20261101b: preconditie (TKT-0329 B lipsa)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ofertare_doc_texte_prov'::regclass
                    AND conname = 'ofertare_doc_texte_prov_origine_check') THEN
    RAISE EXCEPTION '20261101b: preconditie (CHECK-ul origine lipsa sau redenumit)';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.ofertare_doc_texte_prov'::regclass
                             AND conname = 'ofertare_doc_texte_prov_origine_check')) LIKE '%ocr_local_neverificat%'
     OR to_regprocedure('public.fn_ofertare_doc_prov_curent(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261101b: deja aplicata';
  END IF;
  IF coalesce(obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta() THEN
    RAISE EXCEPTION '20261101b: preconditie, obiectele TKT-0329 B s-au schimbat dupa ultima aplicare (amprenta difera)';
  END IF;
END $pre$;

ALTER TABLE public.ofertare_doc_texte_prov DROP CONSTRAINT ofertare_doc_texte_prov_origine_check;
ALTER TABLE public.ofertare_doc_texte_prov ADD CONSTRAINT ofertare_doc_texte_prov_origine_check
  CHECK (origine IN ('transcriere', 'sinteza_ai', 'ocr_local_neverificat'));
COMMENT ON COLUMN public.ofertare_doc_texte_prov.origine IS
  'transcriere (ingest AI) | sinteza_ai (rezumat AI) | ocr_local_neverificat (OCR local de laborator, neverificat de om; NU e sursa de extragere - 20261101b)';

CREATE FUNCTION public.fn_ofertare_doc_prov_curent(p_licitatie_id bigint)
RETURNS TABLE (document_id bigint, prov_id bigint, origine text, producator text, completitudine text, constatat_la timestamptz, curent boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $f$
  SELECT DISTINCT ON (p.document_id) p.document_id, p.id, p.origine, p.producator, p.completitudine, p.constatat_la,
         (d.text_extras IS NOT NULL AND p.sha256 = encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex'))
    FROM public.ofertare_doc_texte_prov p
    JOIN public.ofertare_documente_atribuire d ON d.id = p.document_id
   WHERE p.licitatie_id = p_licitatie_id
   ORDER BY p.document_id, p.constatat_la DESC, p.id DESC
$f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_doc_prov_curent(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_doc_prov_curent(bigint) TO authenticated;
COMMENT ON FUNCTION public.fn_ofertare_doc_prov_curent(bigint) IS
  '20261101b: ultima provenienta pe document + curent (sha = textul actual). SECURITY INVOKER: RLS-ul tabelelor se aplica.';

DO $post$
DECLARE v_fp text;
BEGIN
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.ofertare_doc_texte_prov'::regclass
                             AND conname = 'ofertare_doc_texte_prov_origine_check')) NOT LIKE '%ocr_local_neverificat%' THEN
    RAISE EXCEPTION '20261101b: postconditie (CHECK-ul nou lipsa)';
  END IF;
  -- garda suplimentara (testul comportamental e in harness): sursa de extragere ramane DOAR 'transcriere' sau decizia umana
  IF pg_get_functiondef('public.fn_ofertare_cb_text_valid_asof(bigint,bigint,text,timestamptz)'::regprocedure)
       NOT LIKE '%origine FROM p) = ''transcriere''%' THEN
    RAISE EXCEPTION '20261101b: postconditie (fn_ofertare_cb_text_valid_asof nu mai filtreaza pe transcriere)';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ofertare_doc_prov_curent(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261101b: postconditie drepturi (anon)';
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L',
                 'TKT-0329 B (20261031a + 20261031b + 20261031d + 20261101b). Imuabil. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261101b_ofertare_text_prov_ocr_local:' || txid_current() THEN
    RAISE EXCEPTION '20261101b: garda final invalida';
  END IF;
END $post$;
