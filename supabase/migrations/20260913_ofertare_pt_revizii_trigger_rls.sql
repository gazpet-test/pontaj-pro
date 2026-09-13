-- Versionarea se face in BD, nu in UI. Daca ar depinde de client, prima scriere din alt
-- loc (import, edge function, un fix la mana) ar sari peste istoric.
CREATE OR REPLACE FUNCTION public.fn_pt_capitol_versioneaza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Doar schimbarile de CONTINUT conteaza. Un rename de titlu sau o schimbare de responsabil
  -- nu-i o revizie a textului; altfel istoricul s-ar umple de zgomot si n-ar mai fi citit.
  IF NEW.continut IS DISTINCT FROM OLD.continut
     OR NEW.fisier_path IS DISTINCT FROM OLD.fisier_path THEN
    INSERT INTO public.ofertare_pt_capitole_versiuni
      (capitol_id, versiune, titlu, continut, fisier_path, sursa, stare, schimbat_de)
    VALUES (OLD.id, OLD.versiune, OLD.titlu, OLD.continut, OLD.fisier_path, OLD.sursa, OLD.stare, auth.uid())
    ON CONFLICT (capitol_id, versiune) DO NOTHING;
    NEW.versiune := OLD.versiune + 1;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_pt_capitol_versioneaza() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_pt_capitol_versioneaza ON public.ofertare_pt_capitole;
CREATE TRIGGER trg_pt_capitol_versioneaza
  BEFORE UPDATE ON public.ofertare_pt_capitole
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_capitol_versioneaza();

ALTER TABLE public.ofertare_pt_capitole_versiuni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_pt_observatii        ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_pt_observatii TO authenticated;
GRANT ALL ON public.ofertare_pt_observatii TO service_role;

-- Istoricul se CITESTE, nu se scrie din UI. Il scrie doar triggerul (SECURITY DEFINER).
-- Un istoric pe care il poate rescrie cine vrea nu e istoric.
GRANT SELECT ON public.ofertare_pt_capitole_versiuni TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ofertare_pt_capitole_versiuni FROM authenticated;
GRANT ALL ON public.ofertare_pt_capitole_versiuni TO service_role;

DROP POLICY IF EXISTS ofertare_pt_cap_versiuni_select ON public.ofertare_pt_capitole_versiuni;
CREATE POLICY ofertare_pt_cap_versiuni_select ON public.ofertare_pt_capitole_versiuni
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_pt_observatii_select ON public.ofertare_pt_observatii;
CREATE POLICY ofertare_pt_observatii_select ON public.ofertare_pt_observatii
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Scrierea observatiilor: aceeasi poarta ca restul modulului Ofertare.
DROP POLICY IF EXISTS ofertare_pt_observatii_write ON public.ofertare_pt_observatii;
CREATE POLICY ofertare_pt_observatii_write ON public.ofertare_pt_observatii
  FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
