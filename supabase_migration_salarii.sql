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
