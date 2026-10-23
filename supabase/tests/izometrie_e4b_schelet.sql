-- Local harness only, BEFORE any migration/stamp. Mirrors the real identity column.
DO $$ BEGIN IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_id bigint;
CREATE UNIQUE INDEX profiles_employee_id_unique ON public.profiles(employee_id);
