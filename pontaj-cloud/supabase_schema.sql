-- ============================================================
-- PontajPRO - Schema Supabase
-- Ruleaza acest script in Supabase > SQL Editor
-- ============================================================

-- 1. Profiluri manageri (legat de auth.users)
create table if not exists public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  email       text,
  name        text,
  role        text not null default 'manager' check (role in ('admin', 'manager')),
  department  text,
  created_at  timestamptz default now()
);

-- Trigger: creeaza profil automat la signup
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

-- 2. Angajati
create table if not exists public.employees (
  id          serial primary key,
  name        text not null,
  department  text not null,
  position    text,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- 3. Inregistrari pontaj
create table if not exists public.pontaj_records (
  id            serial primary key,
  employee_id   integer references public.employees(id) on delete cascade,
  date          date not null,
  check_in      timestamptz,
  check_out     timestamptz,
  lunch_break   boolean default true,  -- true = se scade pauza 12-13 daca se aplica
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  unique(employee_id, date)
);

-- ============================================================
-- Row Level Security (RLS) - Securitate
-- ============================================================

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.pontaj_records enable row level security;

-- PROFILES: fiecare vede propriul profil; admin vede toate
create policy "Utilizatorii isi vad propriul profil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Adminii vad toate profilurile"
  on public.profiles for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Adminii pot modifica profiluri"
  on public.profiles for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- EMPLOYEES: managerii vad doar departamentul lor; adminii vad tot
create policy "Managerii vad angajatii din departamentul lor"
  on public.employees for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (p.role = 'admin' or p.department = public.employees.department)
    )
  );

create policy "Adminii pot modifica angajati"
  on public.employees for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- PONTAJ: managerii vad/editeaza doar departamentul lor
create policy "Managerii vad pontajul departamentului"
  on public.pontaj_records for select
  using (
    exists (
      select 1 from public.profiles p
      join public.employees e on e.id = public.pontaj_records.employee_id
      where p.id = auth.uid()
      and (p.role = 'admin' or p.department = e.department)
    )
  );

create policy "Managerii pot insera pontaj pentru departamentul lor"
  on public.pontaj_records for insert
  with check (
    exists (
      select 1 from public.profiles p
      join public.employees e on e.id = public.pontaj_records.employee_id
      where p.id = auth.uid()
      and (p.role = 'admin' or p.department = e.department)
    )
  );

create policy "Managerii pot actualiza pontaj pentru departamentul lor"
  on public.pontaj_records for update
  using (
    exists (
      select 1 from public.profiles p
      join public.employees e on e.id = public.pontaj_records.employee_id
      where p.id = auth.uid()
      and (p.role = 'admin' or p.department = e.department)
    )
  );

-- ============================================================
-- Date de test (optional - sterge daca nu vrei)
-- ============================================================

insert into public.employees (name, department, position) values
  ('Alexandru Ionescu', 'IT', 'Senior Developer'),
  ('Maria Popescu', 'IT', 'Junior Developer'),
  ('Andrei Constantin', 'Vânzări', 'Account Manager'),
  ('Elena Gheorghe', 'Vânzări', 'Sales Rep'),
  ('Mihai Dumitrescu', 'HR', 'HR Manager'),
  ('Ana Popa', 'Financiar', 'Contabil'),
  ('Cristian Marin', 'Producție', 'Operator'),
  ('Ioana Stancu', 'Marketing', 'Marketing Specialist')
on conflict do nothing;

-- ============================================================
-- Dupa rulare, creaza primul admin din Authentication > Users
-- apoi ruleaza:
-- update public.profiles set name = 'Nume Admin', role = 'admin' where email = 'admin@firma.ta.ro';
-- ============================================================
