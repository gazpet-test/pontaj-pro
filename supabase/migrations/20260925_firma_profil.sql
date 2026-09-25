-- Profil firmă (un singur rând, id=1) — folosit la auto-completarea formularelor de licitație.
-- Citire: orice utilizator autentificat; scriere: doar owner (profiles.is_owner).
CREATE TABLE IF NOT EXISTS public.firma_profil (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  denumire text, forma_juridica text, cui text, nr_reg_com text, euid text,
  caen_principal text, caen_secundare text[],
  sediu_social text, adresa_corespondenta text,
  telefon text, fax text, email text, website text,
  reprezentant_legal text, functie_reprezentant text, persoana_contact text,
  conturi jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [{banca, iban, tip: trezorerie|bancar}]
  capital_social numeric, data_infiintare date,
  cifra_afaceri jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{an, valoare, moneda}]
  nr_angajati_mediu jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{an, numar}]
  certificari text, observatii text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.firma_profil ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.firma_profil TO authenticated;
GRANT ALL ON public.firma_profil TO service_role;

CREATE POLICY firma_profil_select ON public.firma_profil FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY firma_profil_insert_owner ON public.firma_profil FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (select auth.uid()) AND p.is_owner));
CREATE POLICY firma_profil_update_owner ON public.firma_profil FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (select auth.uid()) AND p.is_owner))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (select auth.uid()) AND p.is_owner));

CREATE OR REPLACE FUNCTION public.firma_profil_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.firma_profil_touch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_firma_profil_touch BEFORE INSERT OR UPDATE ON public.firma_profil
  FOR EACH ROW EXECUTE FUNCTION public.firma_profil_touch();

INSERT INTO public.firma_profil (id, denumire, forma_juridica, cui, nr_reg_com, sediu_social, telefon, fax, email, reprezentant_legal, functie_reprezentant)
VALUES (1, 'GAZPET INSTAL S.R.L.', 'SRL', 'RO 22029920', 'J29/1650/2007',
  'Str. Fluturilor nr. 34, Ploiești, jud. Prahova, cod poștal 100292', '0244/435005', '0244/435005',
  'office@gazpet.ro', 'Trușu Răzvan', 'Administrator')
ON CONFLICT (id) DO NOTHING;
