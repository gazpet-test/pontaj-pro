-- P0.5 (audit Copilot, aprobat 13.09.2026): SNAPSHOT REAL AL PACHETULUI APROBAT.
-- Semnatura portii (ofertare_pt_poarta) ingheata STAREA agregata, nu fisierele. Intrebarea la care
-- trebuie sa se poata raspunde fara ambiguitate: "ce BYTES a aprobat persoana X la momentul Y?"
-- Raspunsul e manifestul: lista fisierelor cu SHA-256, legata de semnatura portii si de versiunea
-- graficului. APPEND-ONLY: un manifest aprobat nu se modifica; o schimbare = versiune noua.

CREATE TABLE IF NOT EXISTS public.ofertare_pt_pachet (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  versiune integer NOT NULL CHECK (versiune >= 1),
  pt_poarta_id bigint REFERENCES public.ofertare_pt_poarta(id) ON DELETE SET NULL,
  grafic_versiune integer,
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus','aprobat','depus')),
  aprobat_de uuid REFERENCES public.profiles(id),
  aprobat_la timestamptz,
  depus_la timestamptz,
  nota text,
  creat_de uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_pachet_unic UNIQUE (licitatie_id, versiune),
  CONSTRAINT ofertare_pt_pachet_stare_chk CHECK (
    (stare = 'propus') OR
    (stare = 'aprobat' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL) OR
    (stare = 'depus'   AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL AND depus_la IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.ofertare_pt_pachet_fisiere (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pachet_id bigint NOT NULL REFERENCES public.ofertare_pt_pachet(id) ON DELETE CASCADE,
  rol text NOT NULL,
  nume text NOT NULL,
  mime text,
  size_bytes bigint CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  fisier_path text,
  sursa_versiune text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_pachet_fisiere_unic UNIQUE (pachet_id, rol, nume)
);
CREATE INDEX IF NOT EXISTS ofertare_pt_pachet_fisiere_pk_idx ON public.ofertare_pt_pachet_fisiere (pachet_id);

ALTER TABLE public.ofertare_pt_pachet         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_pt_pachet_fisiere ENABLE ROW LEVEL SECURITY;

-- Pachet: UPDATE doar cat e 'propus' (-> aprobat) sau 'aprobat' (-> depus). Aprobat = imuabil altfel. DELETE: nimeni.
GRANT SELECT, INSERT, UPDATE ON public.ofertare_pt_pachet TO authenticated;
REVOKE DELETE ON public.ofertare_pt_pachet FROM authenticated;
GRANT ALL ON public.ofertare_pt_pachet TO service_role;
DROP POLICY IF EXISTS ofertare_pt_pachet_select ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_select ON public.ofertare_pt_pachet FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_pt_pachet_insert ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_insert ON public.ofertare_pt_pachet FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_pt_pachet_update ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_update ON public.ofertare_pt_pachet FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()) AND stare = 'propus')
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_pt_pachet_depune ON public.ofertare_pt_pachet;
CREATE POLICY ofertare_pt_pachet_depune ON public.ofertare_pt_pachet FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()) AND stare = 'aprobat')
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()) AND stare = 'depus');

-- Fisiere: SELECT + INSERT (doar in pachet 'propus'). Fara UPDATE/DELETE: un manifest rescriibil nu raspunde la "ce bytes s-au aprobat".
GRANT SELECT, INSERT ON public.ofertare_pt_pachet_fisiere TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.ofertare_pt_pachet_fisiere FROM authenticated;
GRANT ALL ON public.ofertare_pt_pachet_fisiere TO service_role;
DROP POLICY IF EXISTS ofertare_pt_pachet_fisiere_select ON public.ofertare_pt_pachet_fisiere;
CREATE POLICY ofertare_pt_pachet_fisiere_select ON public.ofertare_pt_pachet_fisiere FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_pt_pachet_fisiere_insert ON public.ofertare_pt_pachet_fisiere;
CREATE POLICY ofertare_pt_pachet_fisiere_insert ON public.ofertare_pt_pachet_fisiere FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare())
    AND EXISTS (SELECT 1 FROM public.ofertare_pt_pachet p WHERE p.id = pachet_id AND p.stare = 'propus'));
