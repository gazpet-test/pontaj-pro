-- Alegerea umană se semnează. `ales_de` = cine a apăsat; NULL = propunere a motorului.
--
-- De ce aici și nu în client: prin RPC-ul ăsta trec TOATE alegerile manuale (ecranul de
-- perechi, căutarea în registru, alegerea pe poziție). Pus în client, s-ar fi uitat la
-- prima cale nouă de scriere — exact cum `alegeCandidat` din OfertareLicitatii.jsx uitase
-- să scrie `ales` și lăsase urma omului doar ca text liber în `referinta_text`.
--
-- Rândul deselectat își pierde semnătura: `ales_de` spune cine a ales ACUM, nu istoricul.
-- Pentru istoric există `updated_at` și tichetele; aici ne trebuie doar poarta.

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

  -- O singură instrucțiune: scoate vechea și pune noua, DOAR în poziția asta. Constrângerea
  -- unică nu vede starea intermediară, iar poziția nu rămâne nicio clipă fără variantă.
  UPDATE ofertare_acoperire a
  SET ales    = (a.id = p_acoperire_id),
      ales_de = CASE WHEN a.id = p_acoperire_id THEN auth.uid() ELSE NULL END,
      updated_at = now()
  WHERE a.cerinta_id = v_cerinta
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND (a.ales OR a.id = p_acoperire_id);

  RETURN QUERY SELECT v_cerinta, v_pozitie, p_acoperire_id, v_vechi;
END;
$function$;
