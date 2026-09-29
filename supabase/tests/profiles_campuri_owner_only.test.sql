-- ============================================================================
-- Teste S-A (29.09.2026) — trg_profiles_campuri_owner_only: un cont care nu e owner nu-și mai poate
-- acorda singur drepturi prin profiles_update_own (department, employee_id și flagurile scăpate la 02.06).
-- Rulare (cluster separat de testele conturi):
--   PGDATA_TEST=/tmp/pg_sa PGPORT_TEST=5436 PGDB_TEST=profiles_sa_test \
--   TEST_SQL=supabase/tests/profiles_campuri_owner_only.test.sql \
--   bash scripts/test_conturi_ciclu_viata.sh --rollback -- supabase/migrations/20260929g_profiles_campuri_owner_only.sql
-- doar_baza=true (după rollback) = starea de azi a producției: atacul TREBUIE să reușească (reproduce gaura).
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?doar_baza}
\else
  \set doar_baza false
\endif
\set owner 00000000-0000-4000-8000-000000000121
\set u_ion 00000000-0000-4000-8000-00000000b001
\set u_alt 00000000-0000-4000-8000-00000000b002

BEGIN;
SELECT teste.assert(current_database() ~ '_test$', 'S0 baza este una locală *_test');

-- ---------------------------------------------------------------- pregătire (admin)
SELECT teste.creeaza_cont('owner.sa@gazpet.ro', :'owner');
UPDATE public.profiles SET is_owner = true WHERE id = :'owner';
SELECT teste.creeaza_cont('ion.sa@gazpet.ro', :'u_ion');
SELECT teste.creeaza_cont('alt.sa@gazpet.ro', :'u_alt');
INSERT INTO public.employees (name, department) VALUES ('SA-TEST ANGAJAT', 'Execuție') RETURNING id AS emp \gset
UPDATE public.profiles SET department = 'Execuție' WHERE id IN (:'u_ion', :'u_alt');

\if :doar_baza
-- ---------------------------------------------------------------- BAZĂ = producția de azi: gaura există
SELECT teste.ca_utilizator(:'u_ion');
WITH u AS (UPDATE public.profiles SET department = 'HR' WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S-BAZA non-owner își pune singur department=HR (gaura reprodusă)') FROM u;
WITH u AS (UPDATE public.profiles SET can_manage_stoc = true, receive_tichete_hr = true, can_use_document_scanner = true
           WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S-BAZA non-owner își dă singur can_manage_stoc / receive_tichete_hr / scanner (regresia din 02.06)') FROM u;
SELECT teste.ca_admin();
\else
-- ---------------------------------------------------------------- S1 obiectul există și e închis
SELECT teste.assert((SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_profiles_campuri_owner_only'
                       AND tgrelid = 'public.profiles'::regclass), 'S1 triggerul există, BEFORE UPDATE, activ');
SELECT teste.assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
                     FROM pg_proc WHERE proname = 'fn_profiles_campuri_owner_only'),
  'S1 funcția e SECURITY DEFINER cu search_path fixat');
SELECT teste.assert(NOT has_function_privilege('authenticated', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE')
                AND NOT has_function_privilege('anon', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE'),
  'S1 funcția nu e apelabilă din API (anon/authenticated)');

-- ---------------------------------------------------------------- S2 atacul: fiecare coloană, refuz 42501
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET %s WHERE id = auth.uid()', x.set_sql),
         'S2 non-owner NU își poate schimba singur ' || x.col, '42501', x.col)
FROM (VALUES
  ('department',                    'department = ''HR'''),
  ('employee_id',                   'employee_id = ' || :'emp'),
  ('email',                         'email = ''cristiana.puscasu@gazpet.ro'''),
  ('can_use_document_scanner',      'can_use_document_scanner = true'),
  ('can_manage_stoc',               'can_manage_stoc = true'),
  ('can_create_comenzi',            'can_create_comenzi = true'),
  ('can_process_achizitii',         'can_process_achizitii = true'),
  ('can_access_ctc',                'can_access_ctc = true'),
  ('receive_tichete_logistica',     'receive_tichete_logistica = true'),
  ('receive_tichete_hr',            'receive_tichete_hr = true'),
  ('receive_tichete_administrativ', 'receive_tichete_administrativ = true'),
  ('receive_tichete_it',            'receive_tichete_it = true'),
  ('receive_tichete_comercial',     'receive_tichete_comercial = true'),
  ('receive_tichete_financiar',     'receive_tichete_financiar = true'),
  ('receive_bonuri_consum',         'receive_bonuri_consum = true'),
  ('whatsapp_tier',                 'whatsapp_tier = ''critic''')
) AS x(col, set_sql);
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = NULL WHERE id = auth.uid()',
  'S2 nici ștergerea department (NULL) nu trece', '42501', 'department');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET name = ''Ion'', department = ''HR'' WHERE id = auth.uid()',
  'S2 amestecat cu un câmp permis: tot refuz (nimic nu se scrie)', '42501', 'department');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department = 'Execuție' AND employee_id IS NULL AND NOT can_manage_stoc AND NOT receive_tichete_hr
                            AND whatsapp_tier = 'info' AND name <> 'Ion'
                     FROM public.profiles WHERE id = :'u_ion'),
  'S2 după refuzuri, rândul lui Ion e neschimbat');

-- ---------------------------------------------------------------- S3 ce rămâne permis non-owner-ului
SELECT teste.ca_utilizator(:'u_ion');
WITH u AS (UPDATE public.profiles SET name = 'Ion SA', phone_whatsapp = '+40712345678', whatsapp_enabled = true,
                  email_notifications_enabled = false, email_notifications_logistica = false
           WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S3 non-owner își editează câmpurile personale (nume, WhatsApp, preferințe mail)') FROM u;
WITH u AS (UPDATE public.profiles SET department = department, employee_id = employee_id, can_manage_stoc = can_manage_stoc,
                  whatsapp_tier = whatsapp_tier, name = 'Ion SA2'
           WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S3 trimiterea valorilor NESCHIMBATE (ca formularul Manageri) trece') FROM u;
WITH u AS (UPDATE public.profiles SET department = 'HR' WHERE id = :'u_alt' RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'S3 non-owner pe rândul altcuiva: 0 rânduri (RLS, neschimbat)') FROM u;

-- ---------------------------------------------------------------- S4 triggerele vechi rămân în picioare
SELECT teste.asteapta_eroare('UPDATE public.profiles SET role = ''superadmin'' WHERE id = auth.uid()',
  'S4 prevent_role_escalation încă refuză role', NULL, 'rolul');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET is_owner = true WHERE id = auth.uid()',
  'S4 prevent_role_escalation încă refuză is_owner', NULL, 'is_owner');
UPDATE public.profiles SET can_access_salarii = true WHERE id = auth.uid();
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT can_access_salarii FROM public.profiles WHERE id = :'u_ion'),
  'S4 enforce_owner_only_salary_flags încă resetează can_access_salarii');

-- ---------------------------------------------------------------- S5 owner, service_role, admin trec
SELECT teste.ca_utilizator(:'owner');
WITH u AS (UPDATE public.profiles SET department = 'HR', employee_id = :'emp', email = 'ion.nou.sa@gazpet.ro', can_manage_stoc = true, receive_tichete_hr = true,
                  can_use_document_scanner = true, whatsapp_tier = 'manager', receive_bonuri_consum = true
           WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 owner-ul acordă department/employee_id/flaguri altcuiva') FROM u;
WITH u AS (UPDATE public.profiles SET department = 'Conducere' WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 owner-ul își schimbă propriul department') FROM u;
SELECT teste.ca_service_role();
WITH u AS (UPDATE public.profiles SET department = 'Logistică', can_manage_stoc = false WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 service_role (edge functions) trece') FROM u;
SELECT teste.ca_admin();
WITH u AS (UPDATE public.profiles SET employee_id = NULL, receive_tichete_hr = false WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 admin fără JWT (migrări / pg_cron) trece') FROM u;

-- ---------------------------------------------------------------- S6 anon
SELECT teste.ca_anon();
WITH u AS (UPDATE public.profiles SET department = 'HR' RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'S6 anon: 0 rânduri (fără politică UPDATE), neschimbat') FROM u;
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- S8 calea de CREARE (signup + INSERT/upsert din API)
\set u_nou 00000000-0000-4000-8000-00000000b003
SELECT teste.creeaza_cont('nou.sa@gazpet.ro', :'u_nou',
  '{"department":"HR","role":"superadmin","is_owner":true,"can_manage_stoc":true,"receive_tichete_hr":true,"employee_id":1}'::jsonb);
SELECT teste.assert((SELECT department IS NULL AND employee_id IS NULL AND role = 'manager_santier' AND NOT is_owner
                            AND NOT can_manage_stoc AND NOT receive_tichete_hr AND NOT can_use_document_scanner
                            AND whatsapp_tier = 'info'
                     FROM public.profiles WHERE id = :'u_nou'),
  'S8 signup cu metadata „HR/superadmin/flaguri”: profilul nou pornește fără niciun drept (metadata ignorată)');
SELECT teste.ca_utilizator(:'u_nou');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''HR'' WHERE id = auth.uid()',
  'S8 contul abia creat nu-și poate pune department=HR după signup', '42501', 'department');
SELECT teste.asteapta_eroare(format('INSERT INTO public.profiles (id, email, department) VALUES (%L, %L, %L)',
                                    gen_random_uuid(), 'x.sa@gazpet.ro', 'HR'),
  'S8 INSERT direct din API de non-owner: refuzat de RLS', '42501', NULL);
SELECT teste.asteapta_eroare(format('INSERT INTO public.profiles (id, email, department) VALUES (%L, %L, %L)
                                     ON CONFLICT (id) DO UPDATE SET department = EXCLUDED.department', :'u_nou', 'nou.sa@gazpet.ro', 'HR'),
  'S8 upsert (INSERT … ON CONFLICT DO UPDATE) pe propriul id: refuzat', '42501', NULL);
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department IS NULL FROM public.profiles WHERE id = :'u_nou'),
  'S8 după tentative, contul nou tot fără department');

-- ---------------------------------------------------------------- S9 non-owner care ARE deja department='HR' și o fișă legată
\set u_hr 00000000-0000-4000-8000-00000000b004
SELECT teste.creeaza_cont('hr.sa@gazpet.ro', :'u_hr');
INSERT INTO public.employees (name, department) VALUES ('SA-TEST HR', 'HR') RETURNING id AS emp_hr \gset
INSERT INTO public.employees (name, department) VALUES ('SA-TEST ALT', 'Execuție') RETURNING id AS emp_alt \gset
UPDATE public.profiles SET department = 'HR', employee_id = :'emp_hr' WHERE id = :'u_hr';   -- admin, ca owner-ul
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''Execuție'' WHERE id = auth.uid()',
  'S9 department=HR nu dă drept de schimbare: HR → altă valoare refuzat', '42501', 'department');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = NULL WHERE id = auth.uid()',
  'S9 HR → NULL refuzat', '42501', 'department');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET employee_id = %s WHERE id = auth.uid()', :'emp_alt'),
  'S9 employee_id valoare → altă valoare refuzat', '42501', 'employee_id');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET employee_id = NULL WHERE id = auth.uid()',
  'S9 employee_id valoare → NULL refuzat', '42501', 'employee_id');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET department = ''Logistică'', employee_id = %s WHERE id = auth.uid()', :'emp_alt'),
  'S9 ambele simultan refuzat', '42501', NULL);
WITH u AS (UPDATE public.profiles SET department = 'HR', can_manage_stoc = true WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'S9 „HR” nu poate da altcuiva department/flaguri: 0 rânduri (RLS)') FROM u;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department = 'HR' AND employee_id = :'emp_hr' FROM public.profiles WHERE id = :'u_hr'),
  'S9 rândul HR e neschimbat după refuzuri');

-- ---------------------------------------------------------------- S10 RPC SECURITY DEFINER: identitatea e apelantul (JWT), nu proprietarul funcției
CREATE FUNCTION public.sa_test_rpc_definer(p_dept text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  UPDATE public.profiles SET department = p_dept WHERE id = auth.uid();   -- rulează ca postgres (BYPASSRLS)
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;
GRANT EXECUTE ON FUNCTION public.sa_test_rpc_definer(text) TO authenticated;
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.assert(current_user = 'authenticated', 'S10 apelantul e authenticated');
SELECT teste.asteapta_eroare('SELECT public.sa_test_rpc_definer(''HR'')',
  'S10 un RPC SECURITY DEFINER apelat de non-owner NU ocolește triggerul (auth.uid() = apelantul, nu postgres)', '42501', 'department');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert(public.sa_test_rpc_definer('Conducere') = 1, 'S10 același RPC apelat de owner trece');
SELECT teste.ca_admin();
DROP FUNCTION public.sa_test_rpc_definer(text);

-- ---------------------------------------------------------------- S7 contul fostului non-owner devenit owner / invers
UPDATE public.profiles SET is_owner = false WHERE id = :'owner';
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''HR'' WHERE id = auth.uid()',
  'S7 owner retrogradat: refuzul se aplică imediat (verificarea citește is_owner la fiecare UPDATE)', '42501', 'department');
SELECT teste.ca_admin();
\endif

ROLLBACK;
