-- #80 (Oana, Ofertare, 15.09.2026): generator de ORGANIGRAMĂ per licitație.
-- Un rând per licitație: `spec` = forma cerută a organigramei, extrasă cu AI din documentația
-- de atribuire (edge fn ofertare-organigrama-spec); `noduri` = organigrama construită în UI
-- (persoane/roluri/linii); `verificari` = rezultatul confruntării noduri ↔ spec (lecția Greci).
CREATE TABLE IF NOT EXISTS public.ofertare_organigrama (
  id            bigserial PRIMARY KEY,
  licitatie_id  bigint NOT NULL UNIQUE REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  spec          jsonb,
  spec_la       timestamptz,
  spec_model    text,
  spec_citate   jsonb,
  noduri        jsonb NOT NULL DEFAULT '{}'::jsonb,
  verificari    jsonb,
  generat_la    timestamptz,
  updated_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ofertare_organigrama IS
  '#80 Organigrama echipei ofertantului per licitație: spec = forma cerută de documentația de atribuire (extrasă AI, ofertare-organigrama-spec), noduri = organigrama construită în UI, verificari = confruntarea noduri↔spec.';
COMMENT ON COLUMN public.ofertare_organigrama.spec IS 'JSON: obligatorie, faze, roluri_cerute[], linii_cerute{}, personal_pe_categorii[], per_operator, tabel_nominal{}, corelare_grafic, documente_suport[], format{}, domenii_isc_din_obiect[], avertismente[]';
COMMENT ON COLUMN public.ofertare_organigrama.spec_citate IS 'Ferestrele de text folosite la extragere: [{document, document_id, offset, text}]';

ALTER TABLE public.ofertare_organigrama ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_organigrama TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_organigrama_id_seq TO authenticated, service_role;

DROP POLICY IF EXISTS ofertare_organigrama_select ON public.ofertare_organigrama;
CREATE POLICY ofertare_organigrama_select ON public.ofertare_organigrama
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_organigrama_insert ON public.ofertare_organigrama;
CREATE POLICY ofertare_organigrama_insert ON public.ofertare_organigrama
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_organigrama_update ON public.ofertare_organigrama;
CREATE POLICY ofertare_organigrama_update ON public.ofertare_organigrama
  FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_organigrama_delete ON public.ofertare_organigrama;
CREATE POLICY ofertare_organigrama_delete ON public.ofertare_organigrama
  FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));

-- functia casei set_updated_at() (folosita si de trg_pt_capitole_upd / pt_afirmatii)
DROP TRIGGER IF EXISTS trg_ofertare_organigrama_upd ON public.ofertare_organigrama;
CREATE TRIGGER trg_ofertare_organigrama_upd
  BEFORE UPDATE ON public.ofertare_organigrama
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
