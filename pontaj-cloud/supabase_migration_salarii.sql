-- ============================================================
-- PontajPRO - Migrare: Modul Salarii
-- Ruleaza in Supabase > SQL Editor
-- ============================================================

-- 1. Email la angajati (daca nu exista deja)
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email text;

-- 2. Tabel contracte si salarii
CREATE TABLE IF NOT EXISTS public.employee_salaries (
  id                    serial primary key,
  employee_id           integer references public.employees(id) on delete cascade unique,
  
  -- Contract
  contract_number       text,
  contract_date         date,
  contract_expiry       date,
  
  -- Salariu
  salary_gross          numeric(10,2) default 0,
  salary_net            numeric(10,2) default 0,
  work_hours_per_day    numeric(4,1) default 8,
  
  -- Retineri (constructii - OUG 114/2018)
  cas_employee          numeric(5,2) default 25.0,    -- % CAS angajat
  cass_employee         numeric(5,2) default 10.0,   -- % CASS angajat
  cas_employer          numeric(5,2) default 4.0,    -- % CAM angajator
  tax_exempt            boolean default true,         -- Scutit impozit venit (constructii)
  income_tax            numeric(5,2) default 10.0,   -- % Impozit venit (daca nu e scutit)
  construction_fund     numeric(5,2) default 1.5,    -- % Fond constructii
  other_deductions      numeric(10,2) default 0,     -- Alte retineri (suma fixa)
  other_deductions_desc text,                        -- Descriere alte retineri
  
  -- Note
  notes                 text,
  updated_at            timestamptz default now(),
  created_at            timestamptz default now()
);

ALTER TABLE public.employee_salaries DISABLE ROW LEVEL SECURITY;

-- 3. Actualizeaza setarile pentru alerta contracte
INSERT INTO public.settings (key, value)
VALUES ('contract_alert_days', '30')
ON CONFLICT (key) DO NOTHING;

-- Procente salariale implicite 2025-2026
INSERT INTO public.settings (key, value) VALUES
  ('contract_alert_days', '30'),
  ('default_cas_employee', '25'),
  ('default_cass_employee', '10'),
  ('default_cam_employer', '2.25'),
  ('default_income_tax', '10'),
  ('default_construction_fund', '0')
ON CONFLICT (key) DO NOTHING;

-- Adauga deducere personala
ALTER TABLE public.employee_salaries ADD COLUMN IF NOT EXISTS personal_deduction numeric(10,2) DEFAULT 587;

-- Adauga default in settings
INSERT INTO public.settings (key, value) VALUES ('default_personal_deduction', '587') ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- Jurnal Plati Diurne
-- ============================================================

CREATE TABLE IF NOT EXISTS public.diurna_payments (
  id            serial primary key,
  period_from   date not null,
  period_to     date not null,
  payment_date  date not null default current_date,
  total_employees integer default 0,
  total_days    integer default 0,
  total_amount  numeric(10,2) default 0,
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.diurna_payment_details (
  id            serial primary key,
  payment_id    integer references public.diurna_payments(id) on delete cascade,
  employee_id   integer references public.employees(id),
  employee_name text not null,
  days          integer default 0,
  amount        numeric(10,2) default 0
);

ALTER TABLE public.diurna_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.diurna_payment_details DISABLE ROW LEVEL SECURITY;
