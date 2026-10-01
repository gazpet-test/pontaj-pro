-- Rollback TKT-2026-0308: UI-ul vechi citește direct hr_formare_profesionala (revert și pe frontend).
DROP VIEW IF EXISTS public.v_hr_formare_cursuri;
DROP FUNCTION IF EXISTS public.hr_autorizatie_e_curs(text, text);
