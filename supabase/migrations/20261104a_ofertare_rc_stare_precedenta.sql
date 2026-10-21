-- 20261104a_ofertare_rc_stare_precedenta — alerta „răspuns de la autoritate necitit”: O SINGURĂ regulă de stare per document, aceeași pentru alerta zilnică
-- (cron + mail, ofertare_rc_doc_necitit) și pentru bannerul de pe fișă (RPC ofertare_rc_stari). Răzvan 21.10.2026: „hai să reparăm
-- alerta” (analiza tichetelor 21.10, §3 A(2)). De ce: azi un răspuns cu text extras („procesat”) trece drept citit chiar dacă perechile
-- întrebare – răspuns n-au fost citite (doc 1624 Răcari); RPC-ul și UI-ul aveau reguli diferite (partial, OCR local neverificat).
-- Precedența (în ofertare_rc_doc_stare): ignorat → citit; text curent OCR local neverificat → text_neverificat (în alertă);
-- partial → partial (doar banner portocaliu, nu alertă / mail); procesat fără analiza.citire_noi → perechi_necitite (în alertă);
-- procesat cu citire_noi → citit; altceva → necitit (în alertă). EFECT LA APPLY: documente vechi pot intra în alertă (clopoțel +
-- mail la ≤ 5 zile) — preview read-only: supabase/tests/20261104a_ofertare_rc_stare_precedenta_preview.sql; apply doar cu „da” pe efect.
-- Revenire: supabase/revenire/20261104a_ofertare_rc_stare_precedenta_ROLLBACK.sql (armată; doar la cererea lui Răzvan). LIVRARE: doar prin scripts/livrare_migrare.sh.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261104a_ofertare_rc_stare_precedenta:' || txid_current() THEN
    RAISE EXCEPTION '20261104a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261104a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF md5(pg_get_functiondef('public.ofertare_rc_doc_necitit(bigint)'::regprocedure)) IS DISTINCT FROM '76d9d9e390034133fe6aa8bd1fd116b1' THEN
    RAISE EXCEPTION '20261104a: ofertare_rc_doc_necitit nu e versiunea asteptata';
  END IF;
  IF to_regprocedure('public.ofertare_rc_doc_stare(bigint)') IS NOT NULL OR to_regprocedure('public.ofertare_rc_stari(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261104a: functiile noi exista deja';
  END IF;
  IF to_regprocedure('public.ofertare_alerta_rc_necitit()') IS NULL OR to_regprocedure('public.ofertare_alerta_rc_necitite_acum(bigint[])') IS NULL
     OR to_regprocedure('public.fn_are_acces_ofertare()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_documente_atribuire'
                    AND column_name = 'analiza' AND data_type = 'jsonb') THEN
    RAISE EXCEPTION '20261104a: dependinte lipsa';
  END IF;
END $pre$;

CREATE FUNCTION public.ofertare_rc_doc_stare(p_document_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- precedența (decizia Răzvan 21.10.2026, „repară alerta”; analiza §3 A(2)):
  --   1 ignorat (decizie umană) → citit; 2 textul CURENT e OCR local neverificat → text_neverificat (vizibil + în alertă, nu tăcere);
  --   3 partial → partial (semnal separat, portocaliu; nu intră în alertă / mail); 4 procesat fără analiza.citire_noi → perechi_necitite;
  --   procesat cu citire_noi → citit; 5 orice altă stare (neprocesat, in_lucru, eroare, NULL, necunoscută) → necitit (fail-closed)
  SELECT CASE
    WHEN d.status_procesare = 'ignorat' THEN 'citit'
    WHEN EXISTS (SELECT 1 FROM ofertare_doc_texte_prov p
                 WHERE p.document_id = d.id AND p.origine = 'ocr_local_neverificat'
                   AND p.sha256 = encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')) THEN 'text_neverificat'
    WHEN d.status_procesare = 'partial' THEN 'partial'
    WHEN d.status_procesare = 'procesat' AND coalesce(jsonb_typeof(d.analiza -> 'citire_noi'), 'null') <> 'null' THEN 'citit'
    WHEN d.status_procesare = 'procesat' THEN 'perechi_necitite'
    ELSE 'necitit'
  END
  FROM ofertare_documente_atribuire d
  WHERE d.id = p_document_id AND d.tip = 'raspuns_clarificare'
$function$;
REVOKE ALL ON FUNCTION public.ofertare_rc_doc_stare(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_rc_doc_stare(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.ofertare_rc_doc_necitit(p_document_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- aceeași regulă ca bannerul (ofertare_rc_doc_stare): în alertă / mail intră necitit, perechi_necitite, text_neverificat
  SELECT coalesce(public.ofertare_rc_doc_stare(p_document_id) IN ('necitit', 'perechi_necitite', 'text_neverificat'), false)
$function$;

CREATE FUNCTION public.ofertare_rc_stari(p_licitatie_id bigint)
 RETURNS TABLE(id bigint, nume_original text, created_at timestamp with time zone, stare text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- citirea din banner (UI): ACEEAȘI funcție de stare ca alerta zilnică — o singură regulă
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(), false) THEN
    RAISE EXCEPTION 'Fără acces la Ofertare' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT d.id, d.nume_original, d.created_at, public.ofertare_rc_doc_stare(d.id)
    FROM ofertare_documente_atribuire d
    WHERE d.licitatie_id = p_licitatie_id AND d.tip = 'raspuns_clarificare'
    ORDER BY d.id;
END
$function$;
REVOKE ALL ON FUNCTION public.ofertare_rc_stari(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_rc_stari(bigint) TO authenticated, service_role;

DO $post$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.ofertare_rc_doc_stare(bigint)'::regprocedure)) IS DISTINCT FROM '55429f195ce43e3e79c895456ce04ab0'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.ofertare_rc_doc_necitit(bigint)'::regprocedure)) IS DISTINCT FROM '6f9ca62f961e856404523108d7bcae43'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.ofertare_rc_stari(bigint)'::regprocedure)) IS DISTINCT FROM 'ba81cb8e5d11123de4af34d8c5fb1f0f' THEN
    RAISE EXCEPTION '20261104a: postconditie corpuri';
  END IF;
  IF has_function_privilege('anon', 'public.ofertare_rc_doc_stare(bigint)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.ofertare_rc_doc_stare(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ofertare_rc_doc_necitit(bigint)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.ofertare_rc_doc_necitit(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ofertare_rc_stari(bigint)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.ofertare_rc_stari(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ofertare_rc_doc_necitit(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261104a: postconditie drepturi';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261104a_ofertare_rc_stare_precedenta:' || txid_current() THEN
    RAISE EXCEPTION '20261104a: garda final invalida';
  END IF;
END $post$;
