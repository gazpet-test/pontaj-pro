-- Răzvan 25.09.2026: alegerea manuală a unei persoane pe o poziție dădea
-- duplicate key "ofertare_acoperire_o_aleasa_pe_pozitie". Indexul unic se verifică rând cu rând,
-- deci UPDATE-ul unic (scoate vechea + pune noua) pica după ordinea rândurilor.
-- Acum în doi pași, în aceeași tranzacție: întâi se scoate vechea, apoi se pune noua.
CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
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
  WHERE a.cerinta_id = v_cerinta
    AND a.ales
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.id <> p_acoperire_id;

  -- pasul 1: scoate varianta aleasă până acum din poziția asta
  UPDATE ofertare_acoperire a
  SET ales = false, ales_de = NULL, updated_at = now()
  WHERE a.cerinta_id = v_cerinta
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.ales AND a.id <> p_acoperire_id;

  -- pasul 2: pune noua variantă (aceeași tranzacție — dacă pică, se anulează și pasul 1)
  UPDATE ofertare_acoperire a
  SET ales = true, ales_de = auth.uid(), updated_at = now()
  WHERE a.id = p_acoperire_id;

  RETURN QUERY SELECT v_cerinta, v_pozitie, p_acoperire_id, v_vechi;
END;
$function$;
