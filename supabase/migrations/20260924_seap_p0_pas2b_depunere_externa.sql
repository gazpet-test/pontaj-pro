-- P0 pas 2 (corecție Copilot 24.09): înregistrarea factuală a unei depuneri făcute EXTERN (aprobat → depus) nu se blochează.
-- Poarta de completitudine rămâne pe APROBARE: → 'aprobat' și ocolirea ei (propus → 'depus' direct / INSERT direct ca 'depus').
CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_blocaj text; v_gasit boolean;
BEGIN
  IF (NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat'))
     OR (NEW.stare = 'depus' AND (TG_OP = 'INSERT' OR OLD.stare NOT IN ('aprobat', 'depus'))) THEN
    SELECT true, blocaj INTO v_gasit, v_blocaj FROM public.v_ofertare_seap_completitudine WHERE licitatie_id = NEW.licitatie_id;
    IF v_gasit IS NULL THEN
      RAISE EXCEPTION 'Aprobare blocată: nu putem verifica completitudinea documentației (licitația % nu apare în control)', NEW.licitatie_id USING ERRCODE = 'P0001';
    END IF;
    IF v_blocaj IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată — documentația nu e completă: %', v_blocaj USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie() FROM PUBLIC, anon, authenticated;
