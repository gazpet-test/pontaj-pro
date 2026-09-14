-- TKT-2026-0122 (14.09.2026): modul de probe (presiune/rezistență/etanșeitate) în Execuție,
-- pentru transparență și acces la documentele probelor direct din fișa proiectului.
CREATE TABLE IF NOT EXISTS public.executie_probe_presiune (
  id            bigserial PRIMARY KEY,
  proiect_id    bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE CASCADE,
  denumire      text NOT NULL,
  data_efectuare date,
  fisier_path   text,
  fisier_nume   text,
  observatii    text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.executie_probe_presiune ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.executie_probe_presiune TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.executie_probe_presiune_id_seq TO authenticated, service_role;
DROP POLICY IF EXISTS probe_presiune_sel ON public.executie_probe_presiune;
DROP POLICY IF EXISTS probe_presiune_mod ON public.executie_probe_presiune;
CREATE POLICY probe_presiune_sel ON public.executie_probe_presiune FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY probe_presiune_mod ON public.executie_probe_presiune FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_executie_probe_presiune_proiect ON public.executie_probe_presiune(proiect_id);
