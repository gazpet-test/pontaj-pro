-- ============================================================
-- PontajPRO - Migrare: Manager cu mai multe santiere
-- Ruleaza in Supabase > SQL Editor
-- ============================================================

-- 1. Tabel nou: legaturi manager <-> santiere (many-to-many)
create table if not exists public.profile_sites (
  id         serial primary key,
  profile_id uuid references public.profiles(id) on delete cascade,
  site_id    integer references public.sites(id) on delete cascade,
  created_at timestamptz default now(),
  unique(profile_id, site_id)
);

alter table public.profile_sites disable row level security;

-- 2. Migreaza datele existente din profiles.site_id -> profile_sites
insert into public.profile_sites (profile_id, site_id)
select id, site_id from public.profiles
where site_id is not null
on conflict (profile_id, site_id) do nothing;

-- Gata! Coloana profiles.site_id ramane pentru compatibilitate
-- dar logica principala va folosi profile_sites
