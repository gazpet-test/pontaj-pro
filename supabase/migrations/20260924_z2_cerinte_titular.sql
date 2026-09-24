-- Z2 (24.09.2026, TKT-2026-0275, acord Copilot): „cui i se adresează obligația" aparține CERINȚEI,
-- nu acoperirii. Candidatul concret (care firmă / persoană, cu ce document) rămâne pe acoperire.
--
-- Deducerea automată e UNA singură, în aplicație (src/ofertareTitular.js — determinist, testat);
-- nu o dublăm în SQL, ca să nu existe două reguli care să diverge. Aici se păstrează DOAR decizia
-- omului, protejată: nicio clasificare automată nu o suprascrie.
-- Pe versiunea nouă a cerinței (inlocuita_de) decizia NU se moștenește: textul s-a schimbat, ținta
-- se re-deduce din textul nou până o confirmă cineva.
-- Nu atinge ofertare_cerinte (text, E2, proveniență) și nu schimbă nicio acoperire.
CREATE TABLE IF NOT EXISTS public.ofertare_cerinte_titular (
  cerinta_id   bigint PRIMARY KEY REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  tip_titular  text   NOT NULL CHECK (tip_titular IN ('operator_economic', 'persoana_fizica', 'nedeterminat')),
  calitate     text   CHECK (calitate IS NULL OR btrim(calitate) <> ''),   -- „ofertant", „RTE", „subcontractant"… doar când sursa o spune
  setat_de     uuid   NOT NULL,
  setat_la     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ofertare_cerinte_titular_lic_idx ON public.ofertare_cerinte_titular (licitatie_id);
ALTER TABLE public.ofertare_cerinte_titular ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofertare_cerinte_titular_select ON public.ofertare_cerinte_titular;
CREATE POLICY ofertare_cerinte_titular_select ON public.ofertare_cerinte_titular
  FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
-- Fără politici de scriere: se scrie DOAR prin fn_ofertare_cerinta_titular_seteaza.
REVOKE ALL ON public.ofertare_cerinte_titular FROM anon, authenticated;
GRANT SELECT ON public.ofertare_cerinte_titular TO authenticated;
GRANT ALL ON public.ofertare_cerinte_titular TO service_role;

-- p_tip NULL → șterge decizia omului (înapoi la deducerea automată din text).
CREATE OR REPLACE FUNCTION public.fn_ofertare_cerinta_titular_seteaza(p_cerinta_id bigint, p_tip text, p_calitate text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
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
  RETURN jsonb_build_object('cerinta_id', c.id, 'tip_titular', p_tip, 'sursa', 'om');
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinta_titular_seteaza(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinta_titular_seteaza(bigint, text, text) TO authenticated, service_role;
