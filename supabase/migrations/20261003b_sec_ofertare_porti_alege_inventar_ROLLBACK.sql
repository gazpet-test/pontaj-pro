-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK TEHNIC — redeschide bypass-ul; doar la cererea explicită a lui Răzvan
-- ════════════════════════════════════════════════════════════════════════════
-- Readuce EXACT starea live din 29.09.2026 (md5 verificat mai jos) pentru
-- fn_ofertare_alege_acoperire(bigint) și ofertare_inventar_pereche(bigint,text,integer,real).
-- Asta REDESCHIDE constatările (2) și (3) din incidentul de expunere OPEN:
--   • orice cont logat, fără modulul Ofertare, schimbă dovada aleasă pe orice cerință;
--   • orice cont logat rulează împerecherea cu p_prag=0 (golurile dispar), iar
--     „respins_de_om” se rescrie la fiecare „Compară cu registrul”.
--
-- NU e calea de revenire obișnuită. Dacă patch-ul strică un flux legitim, folosește
-- 20261003b_sec_ofertare_porti_alege_inventar_REVENIRE_OPERATIONALA.sql: aceea readuce
-- logica veche, dar PĂSTREAZĂ poarta de modul (gaura rămâne închisă).
--
-- Siguranță: fișierul nu face nimic dacă nu e armat explicit în aceeași sesiune, pe prima linie:
--   SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';
-- Fără ea, blocul de mai jos se oprește cu eroare și nu schimbă nimic (tot fișierul e un
-- singur bloc DO, deci nu se poate aplica „pe jumătate”, nici fără tranzacție).
-- Folosire: cerere explicită a lui Răzvan în chat → preview (md5 curent) → apply_migration
-- cu linia SET de mai sus + acest fișier → verificare md5 = starea din 29.09.
-- ════════════════════════════════════════════════════════════════════════════
DO $rollback_tehnic$
BEGIN
  IF coalesce(current_setting('gazpet.rollback_tehnic_20261003b', true), '') <> 'REDESCHIDE_BYPASS' THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003b blocat: redeschide bypass-ul pe Ofertare. Doar la cererea explicită a lui Răzvan, cu SET gazpet.rollback_tehnic_20261003b = ''REDESCHIDE_BYPASS''; în aceeași sesiune. Pentru revenire fără gaură: _REVENIRE_OPERATIONALA.sql.'
      USING ERRCODE = '42501';
  END IF;

  -- Starea live din 29.09.2026, copiată cu pg_get_functiondef (byte cu byte).
  EXECUTE $def_alege$CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
 RETURNS TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cerinta bigint;
  v_pozitie bigint;
  v_vechi   bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să alegi o variantă de acoperire.';
  END IF;
  SELECT a.cerinta_id, a.pozitie_id INTO v_cerinta, v_pozitie
  FROM ofertare_acoperire a WHERE a.id = p_acoperire_id;
  IF v_cerinta IS NULL THEN
    RAISE EXCEPTION 'Varianta % nu există.', p_acoperire_id;
  END IF;
  SELECT a.id INTO v_vechi
  FROM ofertare_acoperire a
  WHERE a.cerinta_id = v_cerinta AND a.ales
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.id <> p_acoperire_id;
  UPDATE ofertare_acoperire a
  SET ales = false, ales_de = NULL, updated_at = now()
  WHERE a.cerinta_id = v_cerinta
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.ales AND a.id <> p_acoperire_id;
  UPDATE ofertare_acoperire a
  SET ales = true, ales_de = auth.uid(), updated_at = now()
  WHERE a.id = p_acoperire_id;
  RETURN QUERY SELECT v_cerinta, v_pozitie, p_acoperire_id, v_vechi;
END;
$function$
$def_alege$;

  EXECUTE $def_pereche$CREATE OR REPLACE FUNCTION public.ofertare_inventar_pereche(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45)
 RETURNS TABLE(imperecheate integer, ramase_fara_pereche integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_furnizor text; v_versiune int;
BEGIN
  -- implicit: cea mai recenta rulare a furnizorului cerut (sau a oricaruia) pe licitatia asta
  SELECT i.furnizor, i.versiune INTO v_furnizor, v_versiune
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic
    AND (p_furnizor IS NULL OR i.furnizor = p_furnizor)
    AND (p_versiune IS NULL OR i.versiune = p_versiune)
  ORDER BY i.versiune DESC, i.id DESC LIMIT 1;
  IF v_furnizor IS NULL THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;

  WITH inv AS (
    SELECT i.id, left(coalesce(i.obligatie, i.pasaj, ''), 2000) AS t
    FROM ofertare_inventar_ai i
    WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune
  ), cer AS (
    SELECT c.id, left(c.text_cerinta, 2000) AS t
    FROM ofertare_cerinte c
    WHERE c.licitatie_id = p_lic AND c.inlocuita_de IS NULL
  ), best AS (
    SELECT inv.id AS inv_id,
           (SELECT cer.id FROM cer
             WHERE similarity(cer.t, inv.t) >= p_prag
             ORDER BY similarity(cer.t, inv.t) DESC, cer.id LIMIT 1) AS cer_id
    FROM inv WHERE length(inv.t) > 0
  )
  UPDATE ofertare_inventar_ai i
     SET pereche_cerinta_id = b.cer_id,
         verdict = CASE WHEN b.cer_id IS NOT NULL THEN 'acoperit' ELSE 'lipsa_din_registru' END
    FROM best b
   WHERE i.id = b.inv_id
     AND i.verdict IS DISTINCT FROM 'confirmat_de_om';  -- ce a decis omul nu se rescrie

  RETURN QUERY
  SELECT count(*) FILTER (WHERE i.pereche_cerinta_id IS NOT NULL)::int,
         count(*) FILTER (WHERE i.pereche_cerinta_id IS NULL)::int
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune;
END $function$
$def_pereche$;

  -- ACL-ul din 29.09 era deja fără PUBLIC/anon; nu-l lărgim nici la rollback.
  REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO authenticated, service_role;

  -- Dovada că s-a revenit exact la starea auditată (altfel se anulează tot).
  IF md5(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) <> '6c9995646a6dbe6da995e48a3a885fc9'
     OR md5(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure)) <> '500263dacba2b44e0caa1cb07db88d6e' THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003b: definițiile rezultate nu sunt byte-identice cu starea din 29.09.';
  END IF;

  -- Dezarmăm comutatorul, ca să nu rămână activ în sesiune.
  PERFORM set_config('gazpet.rollback_tehnic_20261003b', '', false);
  RAISE WARNING 'ROLLBACK TEHNIC 20261003b aplicat: bypass-ul (2)+(3) pe Ofertare e REDESCHIS.';
END $rollback_tehnic$;
