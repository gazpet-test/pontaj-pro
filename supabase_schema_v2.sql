-- ============================================================
-- PontajPRO v2 - Schema Supabase ACTUALIZAT
-- Ruleaza in Supabase > SQL Editor
-- ============================================================

-- 0. Dezactiveaza RLS temporar pentru setup
-- (deja dezactivat din sesiunea anterioara)

-- 1. Profiluri manageri
create table if not exists public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  email       text,
  name        text,
  role        text not null default 'manager' check (role in ('admin', 'manager')),
  department  text,
  site_id     integer,
  created_at  timestamptz default now()
);

-- 2. Santiere
create table if not exists public.sites (
  id          serial primary key,
  name        text not null,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- 3. Angajati
create table if not exists public.employees (
  id          serial primary key,
  name        text not null,
  department  text not null,
  position    text,
  site_id     integer references public.sites(id),
  active      boolean default true,
  created_at  timestamptz default now()
);

-- 4. Inregistrari pontaj
create table if not exists public.pontaj_records (
  id            serial primary key,
  employee_id   integer references public.employees(id) on delete cascade,
  date          date not null,
  check_in      timestamptz,
  check_out     timestamptz,
  lunch_break   boolean default true,
  diurna        boolean default false,
  norma         text,  -- NULL=ore normale, sau: BO,BP,AM,CO,CFP,CM,M,O,N,PRM,PRB,LL
  site_id       integer references public.sites(id),
  notes         text,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(employee_id, date)
);

-- 5. Calendar zile
create table if not exists public.calendar_days (
  id          serial primary key,
  date        date not null unique,
  type        text not null check (type in ('work', 'holiday', 'weekend', 'legal')),
  description text,
  created_at  timestamptz default now()
);

-- 6. Setari aplicatie
create table if not exists public.settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz default now()
);

-- Insereaza setari default
insert into public.settings (key, value) values
  ('diurna_amount', '50'),
  ('work_hours_per_day', '8')
on conflict (key) do nothing;

-- Trigger: profil automat la signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Adauga coloana site_id la profiles daca nu exista
alter table public.profiles add column if not exists site_id integer references public.sites(id);

-- Adauga coloana site_id la employees daca nu exista  
alter table public.employees add column if not exists site_id integer references public.sites(id);

-- Adauga coloane noi la pontaj_records daca nu exista
alter table public.pontaj_records add column if not exists diurna boolean default false;
alter table public.pontaj_records add column if not exists norma text;
alter table public.pontaj_records add column if not exists site_id integer references public.sites(id);
alter table public.pontaj_records add column if not exists updated_by uuid references auth.users(id);
alter table public.pontaj_records add column if not exists updated_at timestamptz default now();
alter table public.pontaj_records add column if not exists lunch_break boolean default true;

-- Dezactiveaza RLS pe toate tabelele (simplu, sigur)
alter table public.profiles disable row level security;
alter table public.employees disable row level security;
alter table public.pontaj_records disable row level security;
alter table public.sites disable row level security;
alter table public.calendar_days disable row level security;
alter table public.settings disable row level security;

-- ============================================================
-- Date demo - 2 santiere default
-- ============================================================
insert into public.sites (name, active) values
  ('Sediu', true),
  ('Santier 1', true)
on conflict do nothing;

-- Zile libere legale Romania 2026
insert into public.calendar_days (date, type, description) values
  ('2026-01-01', 'legal', 'Anul Nou'),
  ('2026-01-02', 'legal', 'Anul Nou'),
  ('2026-01-06', 'legal', 'Boboteaza'),
  ('2026-01-07', 'legal', 'Sfantul Ioan'),
  ('2026-01-24', 'legal', 'Ziua Unirii'),
  ('2026-04-10', 'legal', 'Vinerea Mare'),
  ('2026-04-12', 'legal', 'Pastele Ortodox'),
  ('2026-04-13', 'legal', 'Pastele Ortodox'),
  ('2026-05-01', 'legal', 'Ziua Muncii'),
  ('2026-05-31', 'legal', 'Rusalii'),
  ('2026-06-01', 'legal', 'Ziua Copilului / Rusalii'),
  ('2026-08-15', 'legal', 'Adormirea Maicii Domnului'),
  ('2026-11-30', 'legal', 'Sfantul Andrei'),
  ('2026-12-01', 'legal', 'Ziua Nationala'),
  ('2026-12-25', 'legal', 'Craciunul'),
  ('2026-12-26', 'legal', 'Craciunul')
on conflict (date) do nothing;

-- ============================================================
-- Dupa rulare, seteaza adminul:
-- UPDATE public.profiles SET name='Numele Tau', role='admin' WHERE email='emailul@tau.ro';
-- ============================================================
