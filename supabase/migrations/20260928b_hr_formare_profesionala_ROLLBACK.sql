-- ROLLBACK TKT-2026-0198: șterge registrul de formare. ATENȚIE: pierde cursurile introduse.
-- Rulează doar după export (HR → Formare → Export Excel) și cu acordul lui Răzvan.
DROP TABLE IF EXISTS public.hr_formare_profesionala;
