-- ============================================================================
-- Teste S-A — trg_profiles_campuri_owner_only: department / employee_id (20260929g) și, dacă e aplicată,
-- extensia la 16 coloane (20260930a). Identitatea privilegiată e EXPLICITĂ: owner (JWT), service_role (JWT),
-- login postgres/supabase_admin fără context de cerere. Lipsa identității NU deschide excepția.
-- Rulare (cluster separat de testele conturi):
--   PGDATA_TEST=/tmp/pg_sa PGPORT_TEST=5436 PGDB_TEST=profiles_sa_test LISTA_MIGRARI=/dev/null \
--   TEST_SQL=supabase/tests/profiles_campuri_owner_only.test.sql \
--   bash scripts/test_conturi_ciclu_viata.sh --reaplica --rollback -- supabase/migrations/20260929g_profiles_campuri_owner_only.sql
--   (+ supabase/migrations/20260930a_profiles_campuri_owner_only_extins.sql pentru varianta extinsă)
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
SELECT teste.assert(session_user = 'postgres', 'S0 harness-ul rulează ca login postgres (ca MCP / pg_cron în producție)');

-- ---------------------------------------------------------------- pregătire (admin)
SELECT teste.creeaza_cont('owner.sa@gazpet.ro', :'owner');
UPDATE public.profiles SET is_owner = true WHERE id = :'owner';
SELECT teste.creeaza_cont('ion.sa@gazpet.ro', :'u_ion');
SELECT teste.creeaza_cont('alt.sa@gazpet.ro', :'u_alt');
INSERT INTO public.employees (name, department) VALUES ('SA-TEST ANGAJAT', 'Execuție') RETURNING id AS emp \gset
UPDATE public.profiles SET department = 'Execuție' WHERE id IN (:'u_ion', :'u_alt');
-- RPC de probă (NU există în producție): SECURITY DEFINER, proprietar postgres → ajunge la orice rând, ocolind RLS.
CREATE FUNCTION public.sa_test_rpc(p_id uuid, p_dept text, p_nume text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  UPDATE public.profiles SET department = coalesce(p_dept, department), name = coalesce(p_nume, name) WHERE id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;
GRANT EXECUTE ON FUNCTION public.sa_test_rpc(uuid, text, text) TO PUBLIC;

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
SELECT teste.assert((SELECT tgenabled = 'O' AND tgrelid = 'public.profiles'::regclass
                            AND tgfoid = 'public.fn_profiles_campuri_owner_only()'::regprocedure
                     FROM pg_trigger WHERE tgname = 'trg_profiles_campuri_owner_only'),
  'S1 trigger → funcție → tabel: legătura corectă, activ');
SELECT teste.assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
                     FROM pg_proc WHERE oid = 'public.fn_profiles_campuri_owner_only()'::regprocedure),
  'S1 funcția: SECURITY DEFINER, search_path fixat, proprietar postgres');
SELECT teste.assert(NOT has_function_privilege('authenticated', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE')
                AND NOT has_function_privilege('anon', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE')
                AND NOT has_function_privilege('service_role', 'public.fn_profiles_campuri_owner_only()', 'EXECUTE'),
  'S1 funcția nu e apelabilă direct din API');
SELECT (pg_get_functiondef('public.fn_profiles_campuri_owner_only()'::regprocedure) LIKE '%can_manage_stoc%') AS extins \gset
SELECT md5(pg_get_functiondef('public.fn_profiles_campuri_owner_only()'::regprocedure)) AS md5_def \gset
\echo 'INFO md5(pg_get_functiondef) canonic =' :md5_def ' extins =' :extins

-- ---------------------------------------------------------------- S2 atacul direct (JWT non-owner), refuz 42501
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET %s WHERE id = auth.uid()', x.set_sql),
         'S2 non-owner NU își poate schimba singur ' || x.col, '42501', x.col)
FROM (VALUES ('department', 'department = ''HR'''), ('employee_id', 'employee_id = ' || :'emp')) AS x(col, set_sql);
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = NULL WHERE id = auth.uid()',
  'S2 valoare → NULL refuzat', '42501', 'department');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET department = ''HR'', employee_id = %s WHERE id = auth.uid()', :'emp'),
  'S2 ambele simultan refuzat', '42501', NULL);
SELECT teste.asteapta_eroare('UPDATE public.profiles SET name = ''Ion'', department = ''HR'' WHERE id = auth.uid()',
  'S2 amestecat cu un câmp permis: tot refuz (nimic nu se scrie)', '42501', 'department');
\if :extins
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET %s WHERE id = auth.uid()', x.set_sql),
         'S2-EXT non-owner NU își poate schimba singur ' || x.col, '42501', x.col)
FROM (VALUES
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
\else
-- Fără extensie, restul gaurii rămâne DESCHIS (documentat, așteaptă acordul lui Răzvan pe 20260930a).
WITH u AS (UPDATE public.profiles SET can_manage_stoc = true WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S2-REZIDUAL fără extensie: can_manage_stoc încă se poate autoseta (limitare consemnată)') FROM u;
UPDATE public.profiles SET can_manage_stoc = false WHERE id = auth.uid();
\endif
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department = 'Execuție' AND employee_id IS NULL AND name <> 'Ion' FROM public.profiles WHERE id = :'u_ion'),
  'S2 după refuzuri, rândul lui Ion e neschimbat');

-- ---------------------------------------------------------------- S3 ce rămâne permis non-owner-ului
SELECT teste.ca_utilizator(:'u_ion');
WITH u AS (UPDATE public.profiles SET name = 'Ion SA', phone_whatsapp = '+40712345678', whatsapp_enabled = true,
                  email_notifications_enabled = false, email_notifications_logistica = false
           WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S3 non-owner își editează câmpurile personale (nume, WhatsApp, preferințe mail)') FROM u;
WITH u AS (UPDATE public.profiles SET department = department, employee_id = employee_id, email = email, can_manage_stoc = can_manage_stoc,
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

-- ---------------------------------------------------------------- S5 identitățile privilegiate EXPLICITE trec
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert(auth.role() = 'authenticated' AND auth.uid() = :'owner'::uuid, 'S5 actor: owner prin JWT authenticated (ca din Admin → Manageri)');
WITH u AS (UPDATE public.profiles SET department = 'HR', employee_id = :'emp', email = 'ion.nou.sa@gazpet.ro', can_manage_stoc = true,
                  receive_tichete_hr = true, can_use_document_scanner = true, whatsapp_tier = 'manager', receive_bonuri_consum = true
           WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 owner-ul acordă department/employee_id/flaguri altcuiva') FROM u;
WITH u AS (UPDATE public.profiles SET department = 'Conducere' WHERE id = auth.uid() RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 owner-ul își schimbă propriul department') FROM u;
-- 01.10.2026 (SEC F2 r4, live): service_role trece DOAR pe conexiunea PostgREST (session_user = authenticator) cu rolul SQL
-- efectiv service_role; claims service_role puse pe o sesiune postgres NU mai ajung.
SELECT teste.ca_service_role();
SELECT teste.assert(auth.role() = 'service_role' AND auth.uid() IS NULL, 'S5 actor: claims service_role pe login postgres (NU PostgREST)');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET department = %L WHERE id = %L', 'Logistică', :'u_ion'),
  'S5 F2: claims service_role fără login authenticator → refuz', '42501', NULL);
SELECT teste.ca_admin();
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;                     -- login-ul PostgREST (local, anulat la ROLLBACK)
  END IF;
END $do$;
GRANT service_role TO authenticator;
GRANT USAGE ON SCHEMA teste TO authenticator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO authenticator;
SET SESSION AUTHORIZATION authenticator;
SELECT teste.ca_service_role();
SELECT teste.assert(session_user = 'authenticator' AND current_setting('role') = 'service_role' AND auth.role() = 'service_role',
  'S5 actor: service_role prin PostgREST (login authenticator + SET ROLE service_role, ca edge functions)');
WITH u AS (UPDATE public.profiles SET department = 'Logistică', can_manage_stoc = false WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 service_role (PostgREST) trece') FROM u;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT teste.ca_admin();
SELECT teste.assert(session_user = 'postgres' AND auth.role() IS NULL AND auth.uid() IS NULL,
  'S5 actor: login postgres, fără context de cerere (ca migrările MCP și pg_cron — cron.job.username = postgres)');
WITH u AS (UPDATE public.profiles SET employee_id = NULL, receive_tichete_hr = false WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'S5 login postgres fără claims trece') FROM u;

-- ---------------------------------------------------------------- S6 anon direct
SELECT teste.ca_anon();
WITH u AS (UPDATE public.profiles SET department = 'HR' RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'S6 anon direct: 0 rânduri (RLS; triggerul nici nu e atins)') FROM u;
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- S11 anon printr-un RPC SECURITY DEFINER (ajunge la rând)
SELECT teste.ca_anon();
SELECT teste.assert(auth.role() = 'anon' AND auth.uid() IS NULL, 'S11 actor: anon (JWT fără sub)');
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_alt', 'HR'),
  'S11 anon prin RPC SECURITY DEFINER NU schimbă department (lipsa UID nu deschide excepția)', '42501', NULL);  -- F2: prevent_role_escalation refuză primul (tot 42501)
-- 01.10.2026: sub SEC F2 (live) prevent_role_escalation refuză ORICE UPDATE pe profiles fără UID în afara contextului de
-- sistem — deci și câmpul nesensibil (înainte de F2, S-A singur îl lăsa să treacă).
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, NULL, %L)', :'u_alt', 'Alt SA anon'),
  'S13 același RPC anon, doar câmp nesensibil (name): refuzat de F2 (prevent_role_escalation)', '42501', 'prevent_role_escalation');
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- S12 contexte fără identitate autorizată
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;                     -- login-ul PostgREST (local, anulat la ROLLBACK)
  END IF;
END $do$;
GRANT USAGE ON SCHEMA teste TO authenticator, supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO authenticator, supabase_auth_admin;
SET SESSION AUTHORIZATION authenticator;
SELECT teste.assert(session_user = 'authenticator' AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                    AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL,
  'S12 actor: login authenticator cu claims golite (ex. o funcție care golește claims)');
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_alt', 'HR'),
  'S12 fără claims + login authenticator → refuz (nu e identitate autorizată)', '42501', 'authenticator');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION supabase_auth_admin;
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_alt', 'HR'),
  'S12 fără claims + login supabase_auth_admin (GoTrue) → refuz', '42501', 'supabase_auth_admin');
RESET SESSION AUTHORIZATION;
SELECT teste.ca_admin();
-- claims prezente, dar incomplete / străine
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false), set_config('request.jwt.claim.role', 'authenticated', false);
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_alt', 'HR'),
  'S12 claims authenticated FĂRĂ sub → refuz', '42501', NULL);  -- F2: prevent_role_escalation refuză primul (tot 42501)
SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub', gen_random_uuid())::text, false),
       set_config('request.jwt.claim.sub', '', false);
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_alt', 'HR'),
  'S12 claims authenticated cu sub fără profil → refuz', '42501', 'department');
SELECT set_config('request.jwt.claims', '{"role":"postgres"}', false), set_config('request.jwt.claim.role', 'postgres', false);
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_alt', 'HR'),
  'S12 claims cu rol străin („postgres”) → refuz (doar service_role / owner trec pe calea JWT)', '42501', NULL);  -- F2: prevent_role_escalation refuză primul (tot 42501)
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department = 'Execuție' FROM public.profiles WHERE id = :'u_alt'),
  'S11/S12 rândul țintă (u_alt) are department neschimbat după toate tentativele');

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
  'S8 contul abia creat: NULL → HR refuzat', '42501', 'department');
SELECT teste.asteapta_eroare(format('INSERT INTO public.profiles (id, email, department) VALUES (%L, %L, %L)',
                                    gen_random_uuid(), 'x.sa@gazpet.ro', 'HR'),
  'S8 INSERT direct din API de non-owner: refuzat de RLS', '42501', NULL);
SELECT teste.asteapta_eroare(format('INSERT INTO public.profiles (id, email, department) VALUES (%L, %L, %L)
                                     ON CONFLICT (id) DO UPDATE SET department = EXCLUDED.department', :'u_nou', 'nou.sa@gazpet.ro', 'HR'),
  'S8 upsert (INSERT … ON CONFLICT DO UPDATE) pe propriul id: refuzat', '42501', NULL);
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department IS NULL FROM public.profiles WHERE id = :'u_nou'),
  'S8 după tentative, contul nou tot fără department');

-- ---------------------------------------------------------------- S9 non-owner care ARE deja department='HR' și o fișă
\set u_hr 00000000-0000-4000-8000-00000000b004
SELECT teste.creeaza_cont('hr.sa@gazpet.ro', :'u_hr');
INSERT INTO public.employees (name, department) VALUES ('SA-TEST HR', 'HR') RETURNING id AS emp_hr \gset
INSERT INTO public.employees (name, department) VALUES ('SA-TEST ALT', 'Execuție') RETURNING id AS emp_alt \gset
UPDATE public.profiles SET department = 'HR', employee_id = :'emp_hr' WHERE id = :'u_hr';
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''Execuție'' WHERE id = auth.uid()',
  'S9 department=HR nu dă drept: HR → altă valoare refuzat', '42501', 'department');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = NULL WHERE id = auth.uid()',
  'S9 HR → NULL refuzat', '42501', 'department');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET employee_id = %s WHERE id = auth.uid()', :'emp_alt'),
  'S9 employee_id valoare → altă valoare refuzat', '42501', 'employee_id');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET employee_id = NULL WHERE id = auth.uid()',
  'S9 employee_id valoare → NULL refuzat', '42501', 'employee_id');
WITH u AS (UPDATE public.profiles SET department = 'HR' WHERE id = :'u_ion' RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'S9 „HR” nu poate da altcuiva department: 0 rânduri (RLS)') FROM u;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT department = 'HR' AND employee_id = :'emp_hr' FROM public.profiles WHERE id = :'u_hr'),
  'S9 rândul HR e neschimbat după refuzuri');

-- ---------------------------------------------------------------- S10 RPC SECURITY DEFINER: identitatea e apelantul (JWT)
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('SELECT public.sa_test_rpc(%L, %L)', :'u_ion', 'HR'),
  'S10 RPC SECURITY DEFINER apelat de non-owner NU ocolește triggerul', '42501', 'department');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert(public.sa_test_rpc(:'u_ion', 'Conducere') = 1, 'S10 același RPC apelat de owner trece');
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- S7 owner retrogradat
UPDATE public.profiles SET is_owner = false WHERE id = :'owner';
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''HR'' WHERE id = auth.uid()',
  'S7 owner retrogradat: refuz imediat (is_owner citit la fiecare UPDATE)', '42501', 'department');
SELECT teste.ca_admin();
\endif

DROP FUNCTION public.sa_test_rpc(uuid, text, text);
ROLLBACK;
