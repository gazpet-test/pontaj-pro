-- ============================================================================
-- ROLLBACK TEHNIC pentru 20260929g_profiles_campuri_owner_only.sql (S-A, 29.09.2026).
--
-- ⚠ NU este procedura de revenire operațională: șterge protecția și REDESCHIDE gaura
--   (orice cont își poate pune singur department='HR', can_manage_stoc, receive_tichete_* ...).
--   Există pentru harness-ul de teste (dovada că migrarea se desface curat) și se rulează în
--   producție DOAR la cererea explicită a lui Răzvan, cu motivul consemnat.
--
-- Revenirea operațională (păstrează protecția) — vezi docs/SECURITATE_SA_PROFILES.md §5:
--   * un flux legitim refuzat (mesaj 42501 „Doar owner-ul poate modifica <coloana>”): modificarea
--     o face owner-ul (Admin → Manageri) sau backend-ul cu service_role; triggerul rămâne;
--   * o coloană care chiar trebuie să fie editabilă de utilizator: migrare nouă, revizuită, care scoate
--     DOAR acea coloană din listă (CREATE OR REPLACE FUNCTION), nu DROP;
--   * funcția defectă (refuză tot): efectul e fail-closed doar pentru non-owneri (owner, service_role,
--     migrările trec) → se repară cu CREATE OR REPLACE, fără a scoate triggerul.
-- Nicio dată nu a fost modificată de migrare, deci nu e nimic de restaurat în rânduri.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_profiles_campuri_owner_only ON public.profiles;
DROP FUNCTION IF EXISTS public.fn_profiles_campuri_owner_only();
