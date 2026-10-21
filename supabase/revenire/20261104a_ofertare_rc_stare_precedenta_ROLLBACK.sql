-- REVENIRE 20261104a — readuce ofertare_rc_doc_necitit EXACT la versiunea dinainte (md5 76d9d9e3…: procesat / ignorat / partial =
-- citit; OCR local neverificat exclus din alertă) și scoate ofertare_rc_doc_stare + ofertare_rc_stari. ÎNTÂI se revine frontend-ul
-- (bannerul cheamă ofertare_rc_stari). DOAR la cererea lui Răzvan. Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261104a', 'RC_REGULA_VECHE:' || txid_current(), true);
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261104a', true) IS DISTINCT FROM 'RC_REGULA_VECHE:' || txid_current() THEN
    RAISE EXCEPTION '20261104a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261104a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF EXISTS (SELECT 1 FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') LIKE '%gazpet.revenire_20261104a%') THEN
    RAISE EXCEPTION '20261104a: armare persistenta refuzata';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.ofertare_rc_doc_necitit(bigint)'::regprocedure)) IS DISTINCT FROM '6f9ca62f961e856404523108d7bcae43'
     OR to_regprocedure('public.ofertare_rc_doc_stare(bigint)') IS NULL OR to_regprocedure('public.ofertare_rc_stari(bigint)') IS NULL THEN
    RAISE EXCEPTION '20261104a: preconditie, migrarea nu e aplicata (exact)';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.ofertare_rc_doc_necitit(p_document_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM ofertare_documente_atribuire d
    WHERE d.id = p_document_id
      AND d.tip = 'raspuns_clarificare'
      AND coalesce(d.status_procesare, 'neprocesat') NOT IN ('procesat', 'ignorat', 'partial')
      AND NOT EXISTS (SELECT 1 FROM ofertare_doc_texte_prov p
                      WHERE p.document_id = d.id AND p.origine = 'ocr_local_neverificat'
                        AND p.sha256 = encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')))
$function$
;

DROP FUNCTION public.ofertare_rc_stari(bigint);
DROP FUNCTION public.ofertare_rc_doc_stare(bigint);

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.ofertare_rc_doc_necitit(bigint)'::regprocedure)) IS DISTINCT FROM '76d9d9e390034133fe6aa8bd1fd116b1'
     OR to_regprocedure('public.ofertare_rc_doc_stare(bigint)') IS NOT NULL OR to_regprocedure('public.ofertare_rc_stari(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261104a: postconditie revenire';
  END IF;
  PERFORM set_config('gazpet.revenire_20261104a', '', true);
END $post$;
