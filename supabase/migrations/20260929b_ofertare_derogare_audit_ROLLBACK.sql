-- JAK-V2-05: rollback exact doar cât timp obiectele noi nu conțin date.
-- Cu istoric/motive existente se refuză atomic; auditul persistent nu se șterge.
-- Un singur DO asigură atomicitatea inclusiv în psql fără BEGIN extern.
DO $rollback$
DECLARE v_date boolean;
BEGIN
  LOCK TABLE public.ofertare_licitatii IN ACCESS EXCLUSIVE MODE;
  IF to_regclass('public.ofertare_derogari_audit') IS NOT NULL THEN
    LOCK TABLE public.ofertare_derogari_audit IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.ofertare_derogari_audit) THEN
      RAISE EXCEPTION 'Rollback refuzat: există audit persistent; păstrați istoricul.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.ofertare_licitatii'::regclass
    AND attname='derogare_motiv' AND NOT attisdropped) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE derogare_motiv IS NOT NULL)' INTO v_date;
    IF v_date THEN
      RAISE EXCEPTION 'Rollback refuzat: există motive de derogare; păstrați datele.';
    END IF;
  END IF;
CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_active int; n_neconfirmate int; n_neacoperite int; n_rosii int; n_reverif int; msg text; v_r5 text;
BEGIN
  IF COALESCE(NEW.derogare_depunere, false) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.derogare_depunere, false))
     AND NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa') AND NOT COALESCE(NEW.derogare_depunere, false) THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet p WHERE p.licitatie_id = NEW.id AND p.stare = 'depus') THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE: lipseste pachetul PT in stare depus pentru licitatia %.', NEW.id USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO n_active FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL;
    IF n_active = 0 THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE: 0 cerinte extrase active pentru licitatia %.', NEW.id USING ERRCODE = 'P0001';
    END IF;
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
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa') THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE%. Oferta nu se depune cu sursa cantităților nerezolvată; derogare_depunere=true doar cu decizia lui Razvan (pentru partea asta contează doar dacă depunerea o face ownerul / responsabilul / un admin Ofertare).', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Audit după verificarea R5: derogarea nu ocolește blocajul existent al sursei.
  -- Nu există tabel de audit/evenimente pe licitație în migrările din repository.
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa')
     AND COALESCE(NEW.derogare_depunere, false) THEN
    RAISE NOTICE 'DEROGARE LA DEPUNERE: licitatie_id=%, auth.uid=%, session_user=%, operatie=%, derogare_depunere=true',
      NEW.id, auth.uid(), session_user, TG_OP;
  END IF;
  RETURN NEW;
END $function$;

  DROP FUNCTION IF EXISTS public.ofertare_derogare_depunere(bigint, text, boolean);
  DROP TABLE IF EXISTS public.ofertare_derogari_audit;
  DROP FUNCTION IF EXISTS public.fn_ofertare_derogari_audit_imuabil();
  ALTER TABLE public.ofertare_licitatii DROP COLUMN IF EXISTS derogare_motiv;
END $rollback$;
