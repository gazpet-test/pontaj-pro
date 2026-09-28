-- JAK-V2-03 rollback: definiția exactă rezultată din 20260928f + patch-urile m și n.
-- Restaurează triggerul BEFORE UPDATE; nu modifică date sau alte funcții.
CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_neconfirmate int; n_neacoperite int; n_rosii int; n_reverif int; msg text; v_r5 text;
BEGIN
  IF COALESCE(NEW.derogare_depunere, false) AND NOT COALESCE(OLD.derogare_depunere, false)
     AND NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'depusa' AND OLD.status IS DISTINCT FROM 'depusa' AND NOT COALESCE(NEW.derogare_depunere, false) THEN
    SELECT count(*) INTO n_neconfirmate FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.confirmata_de IS NULL;
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND (a.status = 'nu_se_aplica'
                 OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))));
    SELECT count(*) INTO n_rosii FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      JOIN documente_firma d ON d.id = a.doc_firma_id
      WHERE NOT d.utilizabil
         OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
             d.data_valabilitate < COALESCE(NEW.termen_depunere::date, CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END);
    SELECT count(*) INTO n_reverif FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      WHERE a.status IN ('acoperit','acoperit_partener') AND COALESCE(a.reverificare_ceruta, false);
    IF n_neconfirmate > 0 OR n_neacoperite > 0 OR n_rosii > 0 OR n_reverif > 0 THEN
      msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă), %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii), %s dovezi cu reverificare cerută. Rezolvă-le sau derogare_depunere=true (o poate pune doar ownerul).', n_neconfirmate, n_neacoperite, n_rosii, n_reverif);
      RAISE EXCEPTION '%', msg;
    END IF;
  END IF;
  IF NEW.status = 'depusa' AND OLD.status IS DISTINCT FROM 'depusa' THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE%. Oferta nu se depune cu sursa cantităților nerezolvată; derogare_depunere=true doar cu decizia lui Razvan (pentru partea asta contează doar dacă depunerea o face ownerul / responsabilul / un admin Ofertare).', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_gate_depunere ON public.ofertare_licitatii;
CREATE TRIGGER trg_gate_depunere BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere();
