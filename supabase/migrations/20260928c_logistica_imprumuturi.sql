-- TKT-2026-0127 (28.09.2026, aprobat de Răzvan „acum"): echipamente împrumutate / închiriate
-- către angajați sau firme externe, cu poze la plecare și la retur (bucket documente-flota).
CREATE TABLE public.logistica_imprumuturi (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  active_id          integer NOT NULL REFERENCES public.logistica_active(id) ON DELETE CASCADE,
  tip                text NOT NULL DEFAULT 'imprumut' CHECK (tip IN ('imprumut','inchiriere')),
  catre_tip          text NOT NULL CHECK (catre_tip IN ('angajat','extern')),
  employee_id        integer REFERENCES public.employees(id) ON DELETE SET NULL,
  partener_text      text,
  data_plecare       date NOT NULL DEFAULT current_date,
  data_retur_estimata date,
  data_retur         date,
  stare_plecare      text,
  stare_retur        text,
  poze_plecare       text[] NOT NULL DEFAULT '{}',
  poze_retur         text[] NOT NULL DEFAULT '{}',
  pret               numeric CHECK (pret IS NULL OR pret >= 0),
  observatii         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (catre_tip <> 'angajat' OR employee_id IS NOT NULL),
  CHECK (catre_tip <> 'extern' OR length(btrim(coalesce(partener_text,''))) > 0),
  CHECK (data_retur IS NULL OR data_retur >= data_plecare)
);
CREATE INDEX logistica_imprumuturi_activ_idx ON public.logistica_imprumuturi (active_id, data_plecare DESC);
CREATE UNIQUE INDEX logistica_imprumuturi_un_deschis ON public.logistica_imprumuturi (active_id) WHERE data_retur IS NULL;
ALTER TABLE public.logistica_imprumuturi ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistica_imprumuturi TO authenticated;
GRANT ALL ON public.logistica_imprumuturi TO service_role;
REVOKE ALL ON public.logistica_imprumuturi FROM anon;
-- Aceleași drepturi ca pe logistica_active (autentificați); accesul la modul îl filtrează UI-ul.
CREATE POLICY imprumuturi_rw ON public.logistica_imprumuturi FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
