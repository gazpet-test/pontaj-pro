-- Revizii pe propunerea tehnica: unitatea de schimbare e CAPITOLUL, nu documentul.
-- Motivul: la o propunere de 1144 pagini (Contesti) nimeni nu regenereaza tot pentru ca
-- un responsabil a cerut doua randuri in cap. 3. Si exista deja tiparul in arhiva lor:
-- licitatia 148 (Petroconst) are folderele "completari_observatii propunere tehnica
-- 29.04.2025" si "...30.04.2025", iar documentul de la Motru se numeste literalmente
-- "rev 1". Fluxul exista, dar traieste in numele folderelor.

ALTER TABLE public.ofertare_pt_capitole
  ADD COLUMN IF NOT EXISTS sursa text NOT NULL DEFAULT 'om'
    CHECK (sursa IN ('om','ai','extern','sablon')),
  ADD COLUMN IF NOT EXISTS blocat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS versiune integer NOT NULL DEFAULT 1 CHECK (versiune >= 1);

COMMENT ON COLUMN public.ofertare_pt_capitole.sursa   IS 'Cine a scris ultima versiune: om / ai / extern / sablon. Regenerarea automata nu atinge capitolele cu sursa = om.';
COMMENT ON COLUMN public.ofertare_pt_capitole.blocat  IS 'Capitol inghetat: nici o regenerare nu-l rescrie, indiferent de sursa.';
COMMENT ON COLUMN public.ofertare_pt_capitole.versiune IS 'Versiunea curenta a textului. Creste doar la schimbare de continut (vezi fn_pt_capitol_versioneaza).';

-- Istoricul: se pastreaza textul INTEGRAL al versiunii vechi, nu un diff. Diff-ul se
-- calculeaza la afisare; un diff stocat imbatraneste prost si nu se mai poate reciti.
CREATE TABLE IF NOT EXISTS public.ofertare_pt_capitole_versiuni (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  capitol_id bigint NOT NULL REFERENCES public.ofertare_pt_capitole(id) ON DELETE CASCADE,
  versiune integer NOT NULL CHECK (versiune >= 1),
  titlu text,
  continut text,
  fisier_path text,
  sursa text,
  stare text,
  schimbat_de uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  motiv text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_capitole_versiuni_unic UNIQUE (capitol_id, versiune)
);
CREATE INDEX IF NOT EXISTS ofertare_pt_cap_versiuni_cap_idx
  ON public.ofertare_pt_capitole_versiuni (capitol_id, versiune DESC);

-- Cererea de modificare e obiect separat de modificarea in sine. Asta e ce face ca
-- "ce s-a schimbat la revizia asta" sa se raspunda singur: observatiile inchise arata
-- versiunea in care s-au rezolvat.
CREATE TABLE IF NOT EXISTS public.ofertare_pt_observatii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  capitol_id bigint REFERENCES public.ofertare_pt_capitole(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (btrim(text) <> ''),
  cerut_de uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  cerut_la timestamptz NOT NULL DEFAULT now(),
  stare text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa','rezolvata','respinsa')),
  rezolvat_in_versiunea integer,
  rezolvat_de uuid REFERENCES public.profiles(id),
  rezolvat_la timestamptz,
  raspuns text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- O observatie nu se inchide tacut: cine o inchide scrie ce a facut cu ea.
  CONSTRAINT ofertare_pt_observatii_inchidere_chk CHECK (
    stare = 'deschisa' OR (rezolvat_la IS NOT NULL AND btrim(coalesce(raspuns,'')) <> ''))
);
CREATE INDEX IF NOT EXISTS ofertare_pt_observatii_lic_idx ON public.ofertare_pt_observatii (licitatie_id, stare);
CREATE INDEX IF NOT EXISTS ofertare_pt_observatii_cap_idx ON public.ofertare_pt_observatii (capitol_id);
