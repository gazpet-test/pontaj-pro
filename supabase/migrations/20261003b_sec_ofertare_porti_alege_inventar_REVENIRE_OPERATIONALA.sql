-- ════════════════════════════════════════════════════════════════════════════
-- 20261003b — REVENIRE OPERAȚIONALĂ (păstrează poarta de modul Ofertare)
-- ════════════════════════════════════════════════════════════════════════════
-- Când se folosește: patch-ul 20261003b a stricat un flux legitim din Ofertare și trebuie
-- revenit repede, FĂRĂ să redeschidem incidentul. Readuce logica de business din 29.09
-- (corpurile live), cu două lucruri păstrate:
--   • poarta: auth.uid() obligatoriu + public.fn_are_acces_ofertare() (refuz 42501);
--   • ACL-ul: fără PUBLIC/anon; EXECUTE doar authenticated + service_role.
-- Ce se pierde față de patch (asumat, doar pentru utilizatorii CU modulul Ofertare):
--   • p_prag revine la alegerea apelantului (0 ⇒ totul „acoperit”);
--   • „respins_de_om” (și rândurile cu verdict_de) se rescriu din nou la „Compară cu registrul”;
--   • dispare urma din jurnalul Postgres (RAISE LOG) și search_path revine la cel vechi.
-- Nu e „ROLLBACK TEHNIC”: cel tehnic (fișierul _ROLLBACK.sql) scoate și poarta.
-- Aplicare: acordul lui Răzvan → apply_migration cu acest fișier întreg → verificarea din
-- docs/SECURITATE_PATCH_OFERTARE.md §6. Reaplicarea patch-ului pornind de aici e permisă
-- (precondiția patch-ului recunoaște markerul SEC-20261003b).
-- ════════════════════════════════════════════════════════════════════════════

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_are_acces_ofertare()'::regprocedure)) <> '6991b618d5fabbefdbd14684d335db48' THEN
    RAISE EXCEPTION 'Revenire operațională 20261003b: fn_are_acces_ofertare() diferă de starea auditată; poarta n-ar mai însemna același lucru. Reauditează.';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
 RETURNS TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
-- SEC-20261003b-OPERATIONAL: logica din 29.09 + poarta de modul Ofertare (păstrată).
DECLARE
  v_cerinta bigint;
  v_pozitie bigint;
  v_vechi   bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să alegi o variantă de acoperire.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Nu ai acces la modulul Ofertare: nu poți schimba varianta de acoperire aleasă.'
      USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.ofertare_inventar_pereche(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45)
 RETURNS TABLE(imperecheate integer, ramase_fara_pereche integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $function$
-- SEC-20261003b-OPERATIONAL: logica din 29.09 + poarta de modul Ofertare (păstrată).
DECLARE v_furnizor text; v_versiune int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să compari inventarul cu registrul.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Nu ai acces la modulul Ofertare: nu poți compara inventarul cu registrul.'
      USING ERRCODE = '42501';
  END IF;
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
END $function$;

REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO authenticated, service_role;

DO $post$
DECLARE
  f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_alege_acoperire(bigint)'::regprocedure,
                           'public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure] LOOP
    IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'Revenire operațională 20261003b: ACL greșit pe %.', f;
    END IF;
    IF position('fn_are_acces_ofertare()' IN pg_get_functiondef(f)) = 0 THEN
      RAISE EXCEPTION 'Revenire operațională 20261003b: % a pierdut poarta de modul.', f;
    END IF;
  END LOOP;
END $post$;
