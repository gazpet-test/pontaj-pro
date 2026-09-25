-- E2 + E3 (25.09.2026, aprobat Razvan, v1 — structuri simple, extensibile; feedback Oana/Silviu în așteptare)
-- E2: ofertare_clauze_contract   — clauzele din modelul de contract, cu CITAT EXACT (faptul) separat de evaluarea Gazpet.
-- E3: ofertare_formulare_registru — registrul formularelor de depus (aplicabil / cine completează / semnează / stări).
-- Propunerile vin din edge fn ofertare-clauze-formulare (poartă owner/responsabil); omul verifică / editează.

CREATE TABLE IF NOT EXISTS public.ofertare_clauze_contract (
  id bigserial PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  document_id bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  categorie text NOT NULL DEFAULT 'altele' CHECK (categorie IN ('garantie_buna_executie','penalitati','plata','ajustare_pret',
    'durata_ordin_incepere','garantie_lucrari','receptii','subcontractare','risc','altele')),
  valoare_structurata jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ex. {procent, baza, termen_zile, plafon, ...}
  citat text NOT NULL,                                      -- citat EXACT din text_extras (validat în edge fn)
  locator text,                                             -- ex. „art. 12.3" / „Clauza 15"
  impact text CHECK (impact IS NULL OR impact IN ('pret','cashflow','go_nogo')),
  evaluare_gazpet text,                                     -- opinie / evaluare, SEPARAT de fapt
  sursa text NOT NULL DEFAULT 'ai' CHECK (sursa IN ('ai','manual')),
  verificat_de uuid REFERENCES auth.users(id),
  verificat_la timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ofertare_clauze_lic ON public.ofertare_clauze_contract(licitatie_id, categorie);
CREATE INDEX IF NOT EXISTS ix_ofertare_clauze_doc ON public.ofertare_clauze_contract(document_id);

CREATE TABLE IF NOT EXISTS public.ofertare_formulare_registru (
  id bigserial PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  document_sursa_id bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  cod text,                                                 -- ex. „Formularul nr. 3"
  denumire text NOT NULL,
  aplicabil boolean NOT NULL DEFAULT true,
  motiv_aplicabil text,
  cine_completeaza text,
  cine_semneaza text,
  stare_pregatire text NOT NULL DEFAULT 'de_pregatit' CHECK (stare_pregatire IN ('de_pregatit','ciorna','verificat','semnat')),
  stare_depunere text NOT NULL DEFAULT 'nu' CHECK (stare_depunere IN ('nu','in_pachet','incarcat_seap','confirmat')),
  fisier_path text,
  fisier_hash text,                                         -- semnătura e legată de versiunea fișierului
  documente_suport text,
  observatii text,
  citat text,                                               -- fragment din secțiunea formulare (sursa propunerii AI)
  sursa text NOT NULL DEFAULT 'ai' CHECK (sursa IN ('ai','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ofertare_formulare_lic ON public.ofertare_formulare_registru(licitatie_id);
CREATE INDEX IF NOT EXISTS ix_ofertare_formulare_doc ON public.ofertare_formulare_registru(document_sursa_id);

CREATE OR REPLACE FUNCTION public.fn_ofertare_formulare_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NOT NULL THEN NEW.updated_by := auth.uid(); END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_formulare_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ofertare_formulare_touch ON public.ofertare_formulare_registru;
CREATE TRIGGER trg_ofertare_formulare_touch BEFORE INSERT OR UPDATE ON public.ofertare_formulare_registru
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_formulare_touch();

ALTER TABLE public.ofertare_clauze_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_formulare_registru ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_clauze_contract, public.ofertare_formulare_registru TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_clauze_contract_id_seq, public.ofertare_formulare_registru_id_seq TO authenticated, service_role;

CREATE POLICY ofertare_clauze_sel ON public.ofertare_clauze_contract FOR SELECT TO authenticated USING (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_clauze_ins ON public.ofertare_clauze_contract FOR INSERT TO authenticated WITH CHECK (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_clauze_upd ON public.ofertare_clauze_contract FOR UPDATE TO authenticated USING (public.fn_are_acces_ofertare()) WITH CHECK (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_clauze_del ON public.ofertare_clauze_contract FOR DELETE TO authenticated USING (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_formulare_sel ON public.ofertare_formulare_registru FOR SELECT TO authenticated USING (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_formulare_ins ON public.ofertare_formulare_registru FOR INSERT TO authenticated WITH CHECK (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_formulare_upd ON public.ofertare_formulare_registru FOR UPDATE TO authenticated USING (public.fn_are_acces_ofertare()) WITH CHECK (public.fn_are_acces_ofertare());
CREATE POLICY ofertare_formulare_del ON public.ofertare_formulare_registru FOR DELETE TO authenticated USING (public.fn_are_acces_ofertare());
