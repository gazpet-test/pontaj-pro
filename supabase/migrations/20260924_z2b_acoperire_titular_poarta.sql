-- Z2b (24.09.2026, review Copilot pe PR #424): interdicția „dovada unei persoane pentru o obligație
-- a operatorului economic" trebuie să țină și la salvare, nu doar în butonul „Alege".
-- BD cunoaște doar decizia OMULUI (ofertare_cerinte_titular); deducerea automată din text rămâne în
-- aplicație. Deci poarta de aici blochează exact cazul „omul a spus explicit: e a firmei".
-- Se verifică doar rândul ALES (decizia umană), nu propunerile motorului AI (ales = false/NULL),
-- ca rerularea motorului să nu cadă pe o alternativă pe care nimeni n-a ales-o.
CREATE OR REPLACE FUNCTION public.fn_ofertare_acoperire_titular_verifica()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.ales IS TRUE
     AND (NEW.autorizatie_id IS NOT NULL OR NEW.recomandare_id IS NOT NULL OR NEW.document_personal_id IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.ofertare_cerinte_titular t
                 WHERE t.cerinta_id = NEW.cerinta_id AND t.tip_titular = 'operator_economic') THEN
    RAISE EXCEPTION 'Cerința % e a operatorului economic (decizie salvată): dovada unei persoane nu poate fi aleasă. Dacă ținta e greșită, schimb-o în „Cine poate acoperi".', NEW.cerinta_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_acoperire_titular_verifica() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ofertare_acoperire_titular ON public.ofertare_acoperire;
CREATE TRIGGER trg_ofertare_acoperire_titular
  BEFORE INSERT OR UPDATE OF ales, autorizatie_id, recomandare_id, document_personal_id, cerinta_id
  ON public.ofertare_acoperire
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_acoperire_titular_verifica();

-- Invers: când omul salvează „operator economic" pe o cerință care are DEJA aleasă dovada unei
-- persoane, nu ștergem nimic (decizie umană anterioară), dar întoarcem avertisment vizibil.
CREATE OR REPLACE FUNCTION public.fn_ofertare_cerinta_titular_seteaza(p_cerinta_id bigint, p_tip text, p_calitate text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_conflict int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Fără acces la modulul Ofertare' USING ERRCODE = '42501';
  END IF;
  SELECT id, licitatie_id, inlocuita_de INTO c FROM public.ofertare_cerinte WHERE id = p_cerinta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cerința % nu există', p_cerinta_id; END IF;
  IF c.inlocuita_de IS NOT NULL THEN
    RAISE EXCEPTION 'Cerința % a fost înlocuită de #% — decide pe versiunea curentă', p_cerinta_id, c.inlocuita_de;
  END IF;

  IF p_tip IS NULL THEN
    DELETE FROM public.ofertare_cerinte_titular WHERE cerinta_id = c.id;
    RETURN jsonb_build_object('cerinta_id', c.id, 'tip_titular', NULL, 'sursa', 'auto');
  END IF;
  IF p_tip NOT IN ('operator_economic', 'persoana_fizica', 'nedeterminat') THEN
    RAISE EXCEPTION 'Tip de titular necunoscut: %', p_tip;
  END IF;
  INSERT INTO public.ofertare_cerinte_titular (cerinta_id, licitatie_id, tip_titular, calitate, setat_de, setat_la)
  VALUES (c.id, c.licitatie_id, p_tip, NULLIF(btrim(p_calitate), ''), auth.uid(), now())
  ON CONFLICT (cerinta_id) DO UPDATE SET tip_titular = EXCLUDED.tip_titular, calitate = EXCLUDED.calitate,
    setat_de = EXCLUDED.setat_de, setat_la = now();

  SELECT count(*) INTO v_conflict FROM public.ofertare_acoperire a
  WHERE a.cerinta_id = c.id AND a.ales IS TRUE
    AND (a.autorizatie_id IS NOT NULL OR a.recomandare_id IS NOT NULL OR a.document_personal_id IS NOT NULL);
  RETURN jsonb_build_object('cerinta_id', c.id, 'tip_titular', p_tip, 'sursa', 'om',
    'avertisment', CASE WHEN p_tip = 'operator_economic' AND v_conflict > 0
      THEN 'Pe cerință e deja aleasă dovada unei persoane — nu mai corespunde țintei. Alege documentul firmei sau lasă gol explicit.' END);
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinta_titular_seteaza(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinta_titular_seteaza(bigint, text, text) TO authenticated, service_role;
