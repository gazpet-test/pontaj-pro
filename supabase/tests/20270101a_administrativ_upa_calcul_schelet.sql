-- Schelet LOCAL (PGlite / PG de unică folosință) pentru 20270101a (UPA: calculul contribuției). NU se rulează pe producție.
-- Se adaugă DUPĂ supabase/tests/20261229a_administrativ_upa_alerta_schelet.sql: tabelele HR / pontaj pe care le citește calculul, cu coloanele
-- și regulile din producție (supabase/tests/conturi_schelet_supabase.sql pentru employees, supabase_schema_v2.sql pentru pontaj_records,
-- 20261018a pentru hr_decizii_semnatari), RLS pornit și FĂRĂ drepturi pentru authenticated pe ele (calculul le citește doar prin funcțiile
-- SECURITY DEFINER: un cont logat nu le vede direct în probă).
CREATE TABLE public.employees (
  id serial PRIMARY KEY,
  name text NOT NULL,
  department text NOT NULL DEFAULT 'TESA',
  active boolean DEFAULT true,
  hire_date date,
  termination_date date,
  tip_contract text,
  procent_ocupare numeric DEFAULT 100,
  CONSTRAINT employees_procent_ocupare_chk CHECK (procent_ocupare IS NULL OR (procent_ocupare > 0 AND procent_ocupare <= 100)),
  CONSTRAINT employees_tip_contract_chk CHECK (tip_contract IS NULL OR tip_contract = ANY (ARRAY['cim_nedeterminat','cim_determinat','part_time']))
);
CREATE TABLE public.pontaj_records (
  id bigserial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES public.employees(id),
  date date NOT NULL,
  check_in timestamptz,
  check_out timestamptz,
  norma text,
  UNIQUE (employee_id, date)
);
CREATE TABLE public.hr_decizii_semnatari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id int NOT NULL REFERENCES public.employees(id),
  calitate text NOT NULL,
  este_reprezentant_legal boolean NOT NULL DEFAULT false,
  activ boolean NOT NULL DEFAULT true,
  UNIQUE (employee_id)
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pontaj_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_decizii_semnatari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employees, public.pontaj_records, public.hr_decizii_semnatari FROM PUBLIC, anon, authenticated;
