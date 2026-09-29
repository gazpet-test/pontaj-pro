-- ROLLBACK pentru 20260929g_profiles_campuri_owner_only.sql (S-A, 29.09.2026).
-- Readuce exact starea dinainte: nicio dată nu a fost modificată de migrare, deci nu e nimic de restaurat în rânduri.
DROP TRIGGER IF EXISTS trg_profiles_campuri_owner_only ON public.profiles;
DROP FUNCTION IF EXISTS public.fn_profiles_campuri_owner_only();
