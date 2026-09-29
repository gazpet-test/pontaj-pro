-- ============================================================================
-- Teste SQL — ciclul de viață al conturilor (R1 legare automată, R2 închidere la contract
-- încheiat, R3 fost angajat ca extern). Rulare: scripts/test_conturi_ciclu_viata.sh
-- ============================================================================
-- Convenții:
--   * totul într-o tranzacție încheiată cu ROLLBACK → fișierul poate rula de mai multe ori
--     pe aceeași bază (ex. după migrare, apoi după rollback + reaplicare);
--   * teste.assert(cond, 'Tn descriere') / teste.asteapta_eroare(sql, 'Tn ...', sqlstate, fragment)
--     → la eșec RAISE EXCEPTION, psql oprește (ON_ERROR_STOP) și scriptul iese cu cod ≠ 0;
--   * identități: teste.ca_utilizator(uuid) = PostgREST cu JWT (SET ROLE authenticated),
--     teste.ca_anon(), teste.ca_service_role(), teste.ca_admin() = postgres fără JWT
--     (ca migrările și pg_cron); conturi noi: teste.creeaza_cont(email, uuid) = GoTrue;
--   * cron-ul de producție: teste.cron_hr_auto_deactivate_terminated() (copie exactă);
--   * variabile psql prin RETURNING ... \gset (nu merg în interiorul blocurilor DO $$).
-- Secțiunea „BAZĂ” fixează comportamentul actual al producției și trebuie să rămână verde
-- și după migrările R1/R2/R3; testele noi se adaugă în secțiunile R1/R2/R3 de la final.
-- ============================================================================
\set ON_ERROR_STOP on
-- doar_baza=true (dat de script după rollback) sare peste secțiunile R1–R3
\if :{?doar_baza}
\else
  \set doar_baza false
\endif
\set owner 00000000-0000-4000-8000-000000000121
\set u_ion 00000000-0000-4000-8000-00000000a001
\set u_hr 00000000-0000-4000-8000-00000000a002

BEGIN;

-- ---------------------------------------------------------------- BAZĂ: mediu
SELECT teste.assert(current_database() ~ '_test$', 'T0 baza este una locală *_test');
SELECT teste.assert(current_setting('server_version_num')::int >= 160000, 'T0 PostgreSQL >= 16');
SELECT teste.assert(auth.uid() IS NULL AND current_user = session_user, 'T0 admin: auth.uid() NULL (ca migrările / pg_cron)');
SELECT teste.assert(current_setting('TimeZone') = 'UTC', 'T0 TimeZone UTC, ca în producție');

-- ---------------------------------------------------------------- BAZĂ: potrivire nume (fundația R1)
SET LOCAL search_path = public, pg_temp;   -- ca în funcțiile SECURITY DEFINER
SELECT teste.assert(extensions.unaccent('ȘTEFĂNESCU Țuțu Şerban Ţ âîă') = 'STEFANESCU Tutu Serban T aia',
  'T1 extensions.unaccent acoperă ș/ț (virgulă și sedilă) și cu search_path restrâns');
SELECT teste.assert(lower('ȘTEFĂNESCU ÎȚ') = 'ștefănescu îț', 'T1 lower() pe diacritice (ICU en-US, ca în producție)');
SET LOCAL search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------- BAZĂ: crearea contului (GoTrue)
SELECT teste.creeaza_cont('owner.test@gazpet.ro', :'owner');
UPDATE public.profiles SET is_owner = true WHERE id = :'owner';           -- admin: triggerele sar peste
SELECT teste.creeaza_cont('ion.popescu@gazpet.ro', :'u_ion');
SELECT teste.creeaza_cont('hr.test@gazpet.ro', :'u_hr');
UPDATE public.profiles SET can_modify_employees = true WHERE id = :'u_hr';

SELECT teste.assert((SELECT count(*) = 1 FROM public.profiles
    WHERE id = :'u_ion' AND email = 'ion.popescu@gazpet.ro' AND role = 'manager_santier' AND name = 'Ion Popescu'),
  'T2 on_auth_user_created creează profilul (INSERT făcut ca supabase_auth_admin, search_path=auth)');
SELECT teste.assert((SELECT count(*) = 1 FROM auth.sessions WHERE user_id = :'u_ion')
    AND (SELECT count(*) = 1 FROM auth.refresh_tokens WHERE user_id = :'u_ion'::text AND revoked = false),
  'T2 contul are o sesiune și un refresh token nerevocat (ținte pentru revocarea R2)');
SELECT teste.assert(NOT has_table_privilege('supabase_auth_admin', 'public.employees', 'SELECT'),
  'T2 supabase_auth_admin nu are drepturi pe public.employees → logica din triggerul pe auth.users trebuie SECURITY DEFINER');
SELECT teste.assert(NOT has_table_privilege('authenticated', 'auth.users', 'UPDATE'),
  'T2 authenticated nu poate scrie auth.users (banned_until se setează doar prin funcție SECURITY DEFINER)');

-- ---------------------------------------------------------------- BAZĂ: RLS + triggere owner-only
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.assert(auth.uid() = :'u_ion'::uuid AND current_user = 'authenticated', 'T3 identitate PostgREST simulată');
SELECT teste.asteapta_eroare(
  $$INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-4000-8000-00000000a001', 'hr', 'admin')$$,
  'T3 non-owner nu își poate acorda module (RLS)', '42501');
UPDATE public.profiles SET can_access_salarii = true, whatsapp_enabled = true WHERE id = :'u_ion';
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT can_access_salarii AND whatsapp_enabled FROM public.profiles WHERE id = :'u_ion'),
  'T3 enforce_owner_only_salary_flags anulează SILENȚIOS flagurile protejate setate de non-owner');

SELECT teste.ca_utilizator(:'owner');
INSERT INTO public.user_module_access (profile_id, module, access_level, granted_by) VALUES (:'u_ion', 'hr', 'viewer', :'owner');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) = 1 FROM public.user_module_access WHERE profile_id = :'u_ion' AND module = 'hr'),
  'T3 owner poate acorda un modul');

-- CAPCANĂ R2: o funcție SECURITY DEFINER apelată (sau declanșată) de un NON-owner păstrează
-- auth.uid() = apelantul → triggerele owner-only anulează resetarea flagurilor protejate.
UPDATE public.profiles SET can_access_salarii = true WHERE id = :'u_ion';  -- admin
CREATE FUNCTION public.tmp_test_inchide_flaguri(p uuid) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE public.profiles SET can_access_salarii = false, whatsapp_enabled = false WHERE id = p;
END $fn$;
SELECT teste.ca_utilizator(:'u_hr');                                       -- HR cu can_modify_employees
SELECT public.tmp_test_inchide_flaguri(:'u_ion');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT can_access_salarii AND NOT whatsapp_enabled FROM public.profiles WHERE id = :'u_ion'),
  'T3 capcană confirmată: SECURITY DEFINER rulat de non-owner NU poate reseta can_access_salarii (triggerul îl repune)');

-- ---------------------------------------------------------------- BAZĂ: încheierea contractului azi
INSERT INTO public.employees (name, department, email, active) VALUES ('POPESCU ION', 'Execuție', 'ion.popescu@gazpet.ro', true)
  RETURNING id AS emp_ion \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('TEST CRON', 'Test', true, CURRENT_DATE - 1)
  RETURNING id AS emp_cron \gset

-- Calea UI: termination_date setată în trecut/azi → fn_employees_termination_notify pune active=false în același UPDATE
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :emp_ion;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT active = false FROM public.employees WHERE id = :emp_ion),
  'T4 UPDATE termination_date <= azi (UI, HR) → active=false prin triggerul existent');
UPDATE public.employees SET termination_date = CURRENT_DATE + 30, active = true WHERE id = :emp_ion;
SELECT teste.assert((SELECT active FROM public.employees WHERE id = :emp_ion),
  'T4 termination_date în viitor → angajatul rămâne activ până rulează cron-ul');

-- Calea pg_cron (04:00 UTC, ca postgres fără JWT)
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() = 1, 'T5 cron-ul dezactivează exact angajatul cu termination_date ajunsă');
SELECT teste.assert((SELECT NOT active FROM public.employees WHERE id = :emp_cron)
    AND (SELECT active FROM public.employees WHERE id = :emp_ion),
  'T5 cron: TEST CRON inactiv, POPESCU ION (dată viitoare) încă activ');

-- ---------------------------------------------------------------- BAZĂ: reguli Supabase pentru obiecte noi (CLAUDE.md pct. 4)
CREATE TABLE public.tmp_canar_privilegii (id int);
SELECT teste.assert(has_table_privilege('anon', 'public.tmp_canar_privilegii', 'SELECT'),
  'T6 un tabel nou din public e implicit accesibil lui anon/authenticated → ENABLE RLS obligatoriu');
CREATE FUNCTION public.tmp_canar_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
REVOKE EXECUTE ON FUNCTION public.tmp_canar_fn() FROM PUBLIC;
SELECT teste.assert(has_function_privilege('anon', 'public.tmp_canar_fn()', 'EXECUTE'),
  'T6 REVOKE ... FROM PUBLIC NU ajunge: anon păstrează EXECUTE (grant implicit Supabase)');
REVOKE EXECUTE ON FUNCTION public.tmp_canar_fn() FROM anon, authenticated;
SELECT teste.assert(NOT has_function_privilege('anon', 'public.tmp_canar_fn()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.tmp_canar_fn()', 'EXECUTE'),
  'T6 după REVOKE FROM PUBLIC, anon, authenticated funcția nu mai e apelabilă din API');

\if :doar_baza
\echo '   (R1–R3 sărite: rulare doar BAZĂ)'
\else
-- @@SECTIUNI_R@@
\endif

ROLLBACK;
\echo 'PASS conturi_ciclu_viata.test.sql: toate aserțiunile au trecut'
