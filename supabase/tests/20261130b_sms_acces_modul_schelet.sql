-- Schelet LOCAL suplimentar pentru 20261130b_sms_acces_modul (PG17 de unica folosinta). Se ruleaza DUPA 20261130a_sms_mvp_schelet.sql
-- si dupa aplicarea migrarii 20261130a. Reproduce ce atinge 20261130b in plus fata de scheletul 20261130a:
--   * coloanele reale ale app_modules (ca in productie, citite read-only 03.11.2026: parent_key, icon, color, description, is_active,
--     display_order, created_at, show_on_homepage);
--   * doua profiluri fictive in plus: a4 (Redari editor = contul de test SMS, refuzat la Redari chiar daca are modulul Redari) si
--     a5 (niciun modul = contul fara drept SMS); a2 (Redari editor) si a3 (Redari viewer) vin din scheletul 20261130a;
--   * trei angajati fictivi cu mobil 0700… (pentru testul „peste 5 destinatari” al contului de test).
-- NU se ruleaza pe productie.
ALTER TABLE public.app_modules
  ADD COLUMN parent_key text REFERENCES public.app_modules(key) ON DELETE CASCADE,
  ADD COLUMN icon text,
  ADD COLUMN color text,
  ADD COLUMN description text,
  ADD COLUMN is_active boolean NOT NULL DEFAULT false,
  ADD COLUMN display_order integer,
  ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN show_on_homepage boolean NOT NULL DEFAULT true;
UPDATE public.app_modules SET is_active = true, display_order = 33 WHERE key = 'redari';
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a4', 'test4.test@exemplu.local', 'PROFIL TEST PATRU', false),
  ('00000000-0000-0000-0000-0000000000a5', 'test5.test@exemplu.local', 'PROFIL TEST CINCI', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-0000-0000-0000000000a4', 'redari', 'editor');
INSERT INTO public.employees (name, department, active, telefon) VALUES
  ('TEST ANGAJAT OPT', 'Execuție', true, '0700000108'), ('TEST ANGAJAT NOUA', 'TESA', true, '0700000109'),
  ('TEST ANGAJAT ZECE', 'TESA', true, '0700000110');
