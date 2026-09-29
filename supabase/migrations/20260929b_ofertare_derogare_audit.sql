-- JAK-V2-05: audit persistent, append-only; nu modifică datele existente.
CREATE TABLE IF NOT EXISTS public.ofertare_derogari_audit (
  id bigserial PRIMARY KEY,
  -- Triggerul porții este BEFORE INSERT: părintele apare după rândul de audit.
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  actiune text NOT NULL CHECK (actiune IN ('derogare_acordata','derogare_retrasa','depusa_pe_derogare')),
  actor uuid,
  session_user_name text,
  motiv text,
  status_vechi text,
  status_nou text,
  creat_la timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ofertare_derogari_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofertare_derogari_audit_select ON public.ofertare_derogari_audit;
CREATE POLICY ofertare_derogari_audit_select ON public.ofertare_derogari_audit
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));
-- Revocăm inclusiv privilegiile moștenite din default privileges Supabase.
REVOKE ALL ON TABLE public.ofertare_derogari_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ofertare_derogari_audit TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ofertare_derogari_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ofertare_derogari_audit_imuabil()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'Auditul derogărilor este append-only: % interzis.', TG_OP USING ERRCODE = '42501';
END $function$;
REVOKE ALL ON FUNCTION public.fn_ofertare_derogari_audit_imuabil() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_ofertare_derogari_audit_imuabil ON public.ofertare_derogari_audit;
-- STATEMENT protejează și tabelul gol; TRUNCATE este blocat inclusiv pentru postgres.
CREATE TRIGGER trg_ofertare_derogari_audit_imuabil
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ofertare_derogari_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ofertare_derogari_audit_imuabil();

ALTER TABLE public.ofertare_licitatii ADD COLUMN IF NOT EXISTS derogare_motiv text;

CREATE OR REPLACE FUNCTION public.ofertare_derogare_depunere(
  p_licitatie_id bigint, p_motiv text, p_acorda boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vechi public.ofertare_licitatii%ROWTYPE;
  v_nou public.ofertare_licitatii%ROWTYPE;
  v_motiv text := nullif(btrim(p_motiv), '');
BEGIN
  IF NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF p_acorda IS NULL THEN
    RAISE EXCEPTION 'p_acorda trebuie să fie true sau false.' USING ERRCODE = '22023';
  END IF;
  IF p_acorda AND (v_motiv IS NULL OR char_length(v_motiv) < 10) THEN
    RAISE EXCEPTION 'Motivul derogării trebuie să aibă minimum 10 caractere.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_vechi FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licitația % nu există.', p_licitatie_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.ofertare_licitatii
    SET derogare_depunere = p_acorda, derogare_motiv = v_motiv
    WHERE id = p_licitatie_id RETURNING * INTO v_nou;
  -- False/NULL -> true este auditat exclusiv de poartă, inclusiv pentru RPC.
  -- Fără GUC de dezactivare: un apelant nu poate suprima auditul prin set_config.
  -- Blocarea rândului serializează decizia și împiedică dublarea la apeluri concurente.
  IF NOT p_acorda OR COALESCE(v_vechi.derogare_depunere, false) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (p_licitatie_id, CASE WHEN p_acorda THEN 'derogare_acordata' ELSE 'derogare_retrasa' END,
      auth.uid(), session_user, v_motiv, v_vechi.status, v_nou.status);
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_derogare_depunere(bigint, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_derogare_depunere(bigint, text, boolean) TO authenticated;


-- Poarta 20260929a, cu adăugarea exclusivă a celor două evenimente de audit.
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
  -- Auditul acordării directe și prin RPC are un singur scriitor.
  IF COALESCE(NEW.derogare_depunere, false)
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.derogare_depunere, false)) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (NEW.id, 'derogare_acordata', auth.uid(), session_user, NEW.derogare_motiv,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa')
     AND COALESCE(NEW.derogare_depunere, false) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (NEW.id, 'depusa_pe_derogare', auth.uid(), session_user, NEW.derogare_motiv,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
    RAISE NOTICE 'DEROGARE LA DEPUNERE: licitatie_id=%, auth.uid=%, session_user=%, operatie=%, derogare_depunere=true',
      NEW.id, auth.uid(), session_user, TG_OP;
  END IF;
  RETURN NEW;
END $function$;
