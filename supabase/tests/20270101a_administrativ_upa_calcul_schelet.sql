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
-- calendarul zilelor libere (supabase_schema_v2.sql: calendar_days, UNIQUE pe date; 'legal' = sărbătoare legală), cu sărbătorile 2026 din
--   seed-ul aplicației și cele din 2027 (Paștele ortodox 2.05.2027, Rusaliile 20–21.06.2027)
CREATE TABLE public.calendar_days (
  id serial PRIMARY KEY,
  date date NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('work', 'holiday', 'weekend', 'legal')),
  description text,
  created_at timestamptz DEFAULT now()
);
INSERT INTO public.calendar_days (date, type, description) VALUES
  ('2026-01-01', 'legal', 'Anul Nou'), ('2026-01-02', 'legal', 'Anul Nou'), ('2026-01-06', 'legal', 'Boboteaza'), ('2026-01-07', 'legal', 'Sfantul Ioan'),
  ('2026-01-24', 'legal', 'Ziua Unirii'), ('2026-04-10', 'legal', 'Vinerea Mare'), ('2026-04-12', 'legal', 'Pastele Ortodox'), ('2026-04-13', 'legal', 'Pastele Ortodox'),
  ('2026-05-01', 'legal', 'Ziua Muncii'), ('2026-05-31', 'legal', 'Rusalii'), ('2026-06-01', 'legal', 'Ziua Copilului / Rusalii'),
  ('2026-08-15', 'legal', 'Adormirea Maicii Domnului'), ('2026-11-30', 'legal', 'Sfantul Andrei'), ('2026-12-01', 'legal', 'Ziua Nationala'),
  ('2026-12-25', 'legal', 'Craciunul'), ('2026-12-26', 'legal', 'Craciunul'),
  ('2027-01-01', 'legal', 'Anul Nou'), ('2027-01-02', 'legal', 'Anul Nou'), ('2027-01-06', 'legal', 'Boboteaza'), ('2027-01-07', 'legal', 'Sfantul Ioan'),
  ('2027-01-24', 'legal', 'Ziua Unirii'), ('2027-04-30', 'legal', 'Vinerea Mare'), ('2027-05-01', 'legal', 'Ziua Muncii'), ('2027-05-02', 'legal', 'Pastele Ortodox'),
  ('2027-05-03', 'legal', 'Pastele Ortodox'), ('2027-06-01', 'legal', 'Ziua Copilului'), ('2027-06-20', 'legal', 'Rusalii'), ('2027-06-21', 'legal', 'Rusalii'),
  ('2027-08-15', 'legal', 'Adormirea Maicii Domnului'), ('2027-11-30', 'legal', 'Sfantul Andrei'), ('2027-12-01', 'legal', 'Ziua Nationala'),
  ('2027-12-25', 'legal', 'Craciunul'), ('2027-12-26', 'legal', 'Craciunul');
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pontaj_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_decizii_semnatari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employees, public.pontaj_records, public.hr_decizii_semnatari, public.calendar_days FROM PUBLIC, anon, authenticated;
