-- 20261014a_ofertare_clarificari_temeiuri — pasul B din docs/juridic/MAPARE_CNSC_IN_ERP.md (sesiunea juridică, 05.10.2026)
-- Legătura dintre o întrebare de clarificare (sau un punct al ei) și temeiul ei: o decizie CNSC, o cerință normativă
-- sau un tipar de clarificări. Citatul din decizie se copiază ÎNGHEȚAT (citat_text) și e verificat la insert că e identic
-- cu cnsc_decizii.citate_cheie[citat_idx].text — platforma nu produce citate, le copiază (regula ghilimelelor, skill v2.1).
--
-- NEAPLICATĂ de sesiunea de chat: se aplică prin runner-ul de livrare, cu acordul explicit al lui Răzvan pe schemă
-- (CLAUDE.md pct. 3/6). Fără modificări pe ofertare_clarificari, ofertare_clarificari_puncte sau pe corpus.
-- Rollback: DROP TABLE public.ofertare_clarificari_temeiuri CASCADE; DROP FUNCTION public.fn_temei_citat_verifica();

CREATE TABLE public.ofertare_clarificari_temeiuri (
  id                bigserial PRIMARY KEY,
  -- ținta: exact una dintre întrebare / punct
  clarificare_id    bigint REFERENCES public.ofertare_clarificari(id) ON DELETE CASCADE,
  punct_id          bigint REFERENCES public.ofertare_clarificari_puncte(id) ON DELETE CASCADE,
  -- temeiul: exact unul dintre decizie / cerință normativă / tipar (FK-uri reale, nu ref polimorfic)
  cnsc_decizie_id   text REFERENCES public.cnsc_decizii(id),
  requirement_id    text REFERENCES public.norme_cerinte(requirement_id),
  pattern_id        text REFERENCES public.clarificari_tipare(pattern_id),
  -- citatul (doar pentru decizii): indexul în citate_cheie + copia înghețată + locul (pagina)
  citat_idx         int,
  citat_text        text,
  citat_loc         text,
  nota              text,                                   -- internă, NU iese din platformă
  sursa             text NOT NULL DEFAULT 'manual' CHECK (sursa IN ('manual', 'propus_tipar', 'propus_ai')),
  confirmat         boolean NOT NULL DEFAULT true,          -- propunerile (propus_*) intră cu false până bifează omul
  include_in_adresa boolean NOT NULL DEFAULT false,         -- implicit NU se exportă în adresa către AC
  creat_de          uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT temei_tinta_exact_una CHECK (num_nonnulls(clarificare_id, punct_id) = 1),
  CONSTRAINT temei_sursa_exact_una CHECK (num_nonnulls(cnsc_decizie_id, requirement_id, pattern_id) = 1),
  CONSTRAINT temei_citat_doar_decizie CHECK (citat_idx IS NULL OR cnsc_decizie_id IS NOT NULL),
  CONSTRAINT temei_citat_complet CHECK ((citat_idx IS NULL) = (citat_text IS NULL)),
  CONSTRAINT temei_export_doar_confirmat CHECK (NOT include_in_adresa OR confirmat)
);
COMMENT ON TABLE public.ofertare_clarificari_temeiuri IS 'Temeiurile unei întrebări/unui punct de clarificare: decizie CNSC (cu citat înghețat + pagină), cerință normativă sau tipar. Pasul B, MAPARE_CNSC_IN_ERP.md. Citatul e verificat la insert că e identic cu corpusul.';

-- un temei o singură dată per țintă (NULLS NOT DISTINCT — PG15+, live e PG17)
CREATE UNIQUE INDEX ofertare_clarificari_temeiuri_unic
  ON public.ofertare_clarificari_temeiuri (clarificare_id, punct_id, cnsc_decizie_id, requirement_id, pattern_id, citat_idx) NULLS NOT DISTINCT;
CREATE INDEX ofertare_clarificari_temeiuri_clarificare_idx ON public.ofertare_clarificari_temeiuri (clarificare_id);
CREATE INDEX ofertare_clarificari_temeiuri_punct_idx ON public.ofertare_clarificari_temeiuri (punct_id);

-- Garanția că citatul e EXACT cel din corpus: la insert/update se completează citat_text/citat_loc din citate_cheie[citat_idx]
-- și se respinge orice text diferit. Nu e SECURITY DEFINER: rulează cu drepturile celui care scrie (care are SELECT pe corpus).
CREATE OR REPLACE FUNCTION public.fn_temei_citat_verifica()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_citat jsonb;
BEGIN
  IF NEW.citat_idx IS NULL THEN
    NEW.citat_loc := NULL;
    RETURN NEW;
  END IF;
  SELECT d.citate_cheie -> NEW.citat_idx INTO v_citat FROM public.cnsc_decizii d WHERE d.id = NEW.cnsc_decizie_id;
  IF v_citat IS NULL OR v_citat->>'text' IS NULL THEN
    RAISE EXCEPTION 'Decizia % nu are citatul cu indexul %', NEW.cnsc_decizie_id, NEW.citat_idx USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.citat_text IS DISTINCT FROM (v_citat->>'text') THEN
    RAISE EXCEPTION 'Citatul nu e identic cu cel din corpus (decizia %, idx %) — platforma nu produce citate', NEW.cnsc_decizie_id, NEW.citat_idx USING ERRCODE = 'check_violation';
  END IF;
  NEW.citat_loc := v_citat->>'loc';
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_temei_citat_verifica() FROM PUBLIC;

CREATE TRIGGER trg_temei_citat_verifica
  BEFORE INSERT OR UPDATE OF citat_idx, citat_text, cnsc_decizie_id ON public.ofertare_clarificari_temeiuri
  FOR EACH ROW EXECUTE FUNCTION public.fn_temei_citat_verifica();

-- RLS: citire pentru orice logat; scriere = aceeași regulă ca pe ofertare_clarificari (fn_are_acces_ofertare)
ALTER TABLE public.ofertare_clarificari_temeiuri ENABLE ROW LEVEL SECURITY;
CREATE POLICY temeiuri_sel ON public.ofertare_clarificari_temeiuri FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY temeiuri_ins ON public.ofertare_clarificari_temeiuri FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY temeiuri_upd ON public.ofertare_clarificari_temeiuri FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY temeiuri_del ON public.ofertare_clarificari_temeiuri FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));

REVOKE ALL ON public.ofertare_clarificari_temeiuri FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_clarificari_temeiuri TO authenticated;
GRANT ALL ON public.ofertare_clarificari_temeiuri TO service_role;
REVOKE ALL ON SEQUENCE public.ofertare_clarificari_temeiuri_id_seq FROM PUBLIC, anon;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_clarificari_temeiuri_id_seq TO authenticated, service_role;
