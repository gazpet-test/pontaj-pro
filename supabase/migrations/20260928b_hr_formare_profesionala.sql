-- TKT-2026-0198 (28.09.2026, aprobat de Răzvan: varianta „Registru formare")
-- Codul muncii art. 194 + CCM: angajatorul cu ≥21 salariați asigură formare profesională
-- cel puțin o dată la 2 ani pentru fiecare angajat. Registrul ține cursurile per angajat;
-- scadența (+24 luni față de ultimul curs sau, fără curs, de la angajare) se calculează în UI.
-- Drepturi: identice cu hr_autorizatii (citire autentificați; scriere owner / can_modify_employees /
-- superadmin / departamentele HR și Administrativ). Nu se acordă nimic nou.

CREATE TABLE public.hr_formare_profesionala (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id        integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  data_curs          date    NOT NULL,
  tema               text    NOT NULL CHECK (length(btrim(tema)) > 0),
  tip_autorizatie_id integer REFERENCES public.hr_autorizatii_tipuri(id) ON DELETE SET NULL,
  furnizor           text,
  numar_certificat   text,
  durata_ore         numeric CHECK (durata_ore IS NULL OR durata_ore > 0),
  observatii         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.hr_formare_profesionala IS
  'TKT-2026-0198: registrul cursurilor de formare/calificare per angajat (obligația la 2 ani, art. 194 Codul muncii + CCM).';

CREATE INDEX hr_formare_profesionala_emp_data_idx
  ON public.hr_formare_profesionala (employee_id, data_curs DESC);

ALTER TABLE public.hr_formare_profesionala ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_formare_profesionala TO authenticated;
GRANT ALL ON public.hr_formare_profesionala TO service_role;

CREATE POLICY hr_formare_read ON public.hr_formare_profesionala
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY hr_formare_write ON public.hr_formare_profesionala
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (
    p.is_owner = true OR p.can_modify_employees = true OR p.role = 'superadmin'
    OR p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text]))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (
    p.is_owner = true OR p.can_modify_employees = true OR p.role = 'superadmin'
    OR p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text]))));

REVOKE ALL ON public.hr_formare_profesionala FROM anon;   -- politicile sunt doar TO authenticated; anon nu are ce căuta aici
