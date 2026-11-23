-- Constrângerile PRODUCȚIEI pe tabelele comune pe care schemele false (supabase/tests/2027010*_schelet.sql) nu le au, găsite de proba chat-ului pe
-- clona PG17 (22.11.2026). Probele PGlite le pun DOAR în tranzacția dry-run-ului (imediat după BEGIN-ul fișierului; ROLLBACK-ul de la final le
-- anulează), ca fixturile să fie verificate pe aceleași reguli ca pe clonă, fără să schimbe celelalte secțiuni ale probelor:
--   employees.department NOT NULL, fără valoare implicită;
--   profiles.role cu valoarea implicită 'manager', care NU trece profiles_role_chk (un profil nou trebuie să-și dea rolul explicit);
--   uniq_profiles_employee_id: o fișă de angajat = cel mult un cont;
--   user_module_access.module → app_modules(key) (FK); app_modules conține doar cheile deja folosite (pe producție: 'executie' există,
--   'executie_rest_decontat' NU), deci fixtura își creează cheile de care are nevoie.
-- Rândurile deja existente în baza falsă (seed-ul probei) primesc valori valide, ca pe producție (unde constrângerile sunt deja respectate).
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department text;
UPDATE public.employees SET department = 'MOSTENIT' WHERE department IS NULL;
ALTER TABLE public.employees ALTER COLUMN department SET NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'manager';
UPDATE public.profiles SET role = 'teren';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_chk CHECK (role = ANY (ARRAY['superadmin', 'admin_logistica', 'manager_santier', 'sef_echipa',
  'contabilitate', 'hr', 'gestionar', 'magazioner', 'teren', 'in_asteptare']::text[]));
CREATE UNIQUE INDEX uniq_profiles_employee_id ON public.profiles (employee_id);
CREATE TABLE public.app_modules (key text NOT NULL PRIMARY KEY, parent_key text REFERENCES public.app_modules(key) ON DELETE CASCADE, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false, show_on_homepage boolean NOT NULL DEFAULT true);
GRANT SELECT ON public.app_modules TO anon, authenticated, service_role;
INSERT INTO public.app_modules (key, name) SELECT DISTINCT module, module FROM public.user_module_access;
ALTER TABLE public.user_module_access ADD CONSTRAINT user_module_access_module_fkey FOREIGN KEY (module) REFERENCES public.app_modules(key);
