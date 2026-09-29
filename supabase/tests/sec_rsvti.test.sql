-- ============================================================================
-- Teste SEC RSVTI — 20261003c_sec_rsvti_poarta_jurnal.sql (poarta RPC + jurnal, tratate împreună).
-- Rulează doar prin scripts/test_sec_rsvti.sh, pe scheletul supabase/tests/sec_rsvti_schelet.sql
-- (PG16 local, bază *_test). Totul într-o tranzacție care se anulează la final (ROLLBACK).
--
--   -v gaura=true  → starea de AZI a producției (schelet brut sau după rollback tehnic):
--                    atacurile TREBUIE să reușească (dovada că gaura e reprodusă fidel);
--   -v gaura=false → după migrare: atacurile refuzate, traseele legitime trec (implicit).
--
-- Identități simulate ca PostgREST: claims JWT (sub + role) + SET ROLE; fără claims = login postgres.
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?gaura}
\else
  \set gaura false
\endif
\set u_owner 00000000-0000-4000-8000-000000000121
\set u_cme   00000000-0000-4000-8000-00000000a001
\set u_super 00000000-0000-4000-8000-00000000a002
\set u_hr    00000000-0000-4000-8000-00000000a003
\set u_adm   00000000-0000-4000-8000-00000000a004
\set u_ex    00000000-0000-4000-8000-00000000b001
\set u_rolhr 00000000-0000-4000-8000-00000000b002
\set u_fara  00000000-0000-4000-8000-00000000b003

BEGIN;
SELECT teste.assert(current_database() ~ '_test$', 'T0 baza este una locală *_test');
SELECT teste.assert(session_user = 'postgres', 'T0 harness-ul rulează ca login postgres');
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- pregătire (admin)
INSERT INTO auth.users (id, email) VALUES
  (:'u_owner', 'owner@test'), (:'u_cme', 'cme@test'), (:'u_super', 'super@test'), (:'u_hr', 'hr@test'),
  (:'u_adm', 'adm@test'), (:'u_ex', 'ex@test'), (:'u_rolhr', 'rolhr@test'), (:'u_fara', 'fara.profil@test');
-- Matricea de identități: 5 care trec politica hr_autorizatii_write_authorized, 3 care nu.
INSERT INTO public.profiles (id, email, name, role, department, is_owner, can_modify_employees) VALUES
  (:'u_owner', 'owner@test', 'OWNER',              'manager_santier', NULL,            true,  false),
  (:'u_cme',   'cme@test',   'CAN MODIFY',         'manager_santier', 'Execuție',      false, true),
  (:'u_super', 'super@test', 'SUPERADMIN',         'superadmin',      NULL,            false, false),
  (:'u_hr',    'hr@test',    'DEPT HR',            'manager_santier', 'HR',            false, false),
  (:'u_adm',   'adm@test',   'DEPT ADMINISTRATIV', 'manager_santier', 'Administrativ', false, false),
  (:'u_ex',    'ex@test',    'EXECUTIE (RSVTI)',   'manager_santier', 'Execuție',      false, false),
  (:'u_rolhr', 'rolhr@test', 'ROL hr FARA DEPT',   'hr',              NULL,            false, false);
-- u_fara: cont în auth.users, fără profil.

INSERT INTO public.employees (name) VALUES ('RSVTI-TEST SUDOR 1') RETURNING id AS emp1 \gset
INSERT INTO public.employees (name) VALUES ('RSVTI-TEST SUDOR 2') RETURNING id AS emp2 \gset
INSERT INTO public.hr_autorizatii_tipuri (cod, denumire, necesita_confirmare_rsvti, interval_confirmare_rsvti_luni)
  VALUES ('T_SUDOR_6', 'Sudor (viză 6 luni)', true, 6) RETURNING id AS t6 \gset
INSERT INTO public.hr_autorizatii_tipuri (cod, denumire, necesita_confirmare_rsvti, interval_confirmare_rsvti_luni)
  VALUES ('T_SUDOR_12', 'Sudor (viză 12 luni)', true, 12) RETURNING id AS t12 \gset
INSERT INTO public.hr_autorizatii_tipuri (cod, denumire, necesita_confirmare_rsvti, interval_confirmare_rsvti_luni)
  VALUES ('T_SUDOR_NULL', 'Sudor (interval necompletat)', true, NULL) RETURNING id AS tnull \gset
INSERT INTO public.hr_autorizatii_tipuri (cod, denumire, necesita_confirmare_rsvti)
  VALUES ('T_FARA_VIZA', 'Fără viză', false) RETURNING id AS tfara \gset

SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date AS azi,
       ((now() AT TIME ZONE 'Europe/Bucharest')::date + 1) AS maine,
       (now() AT TIME ZONE 'UTC')::date AS azi_utc \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp1, :t6, 'A1', '2025-01-15') RETURNING id AS a1 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp1, :t12, 'A2-fara-data-emitere', NULL) RETURNING id AS a2 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp2, :tnull, 'A3', :'azi'::date - 10) RETURNING id AS a3 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp2, :tfara, 'A4-fara-viza', '2025-01-01') RETURNING id AS a4 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere, deleted_at)
  VALUES (:emp2, :t6, 'A5-stearsa', '2025-01-01', now()) RETURNING id AS a5 \gset
\echo 'INFO azi (Europe/Bucharest) =' :azi ' azi UTC =' :azi_utc

-- Helper local (rămâne în tranzacția testului): RPC reușit ca p_uid + verificarea jurnalului și a fișei.
CREATE FUNCTION teste.rpc_ok(p_uid uuid, p_aut bigint, p_data date, p_obs text, p_next date, p_eticheta text,
                             p_data_asteptata date DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE r public.hr_autorizatii_rsvti_confirmari%rowtype; a public.hr_autorizatii%rowtype;
        v_state text; v_msg text; v_data date := coalesce(p_data_asteptata, p_data);
BEGIN
  PERFORM teste.ca_utilizator(p_uid);
  BEGIN
    SELECT * INTO r FROM public.confirm_hr_autorizatie_rsvti(p_aut, p_data, p_obs);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM teste.ca_admin();
    RAISE EXCEPTION 'ESEC TEST: % — RPC refuzat: % %', p_eticheta, v_state, v_msg USING ERRCODE = 'P0T01';
  END;
  PERFORM teste.ca_admin();
  SELECT * INTO a FROM public.hr_autorizatii WHERE id = p_aut;
  PERFORM teste.assert(
        r.id IS NOT NULL AND r.autorizatie_id = p_aut AND r.employee_id = a.employee_id
    AND r.confirmat_de = p_uid AND r.data_confirmare = v_data AND r.urmatoarea_confirmare = p_next
    AND r.observatii IS NOT DISTINCT FROM nullif(trim(coalesce(p_obs, '')), '')
    AND a.rsvti_confirmat_de = p_uid AND a.rsvti_ultima_confirmare = v_data
    AND a.rsvti_urmatoarea_confirmare = p_next AND a.rsvti_confirmat_la IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari WHERE id = r.id),
    format('%s (data %s → scadență %s)', p_eticheta, v_data, p_next));
  RETURN r.id;
END $fn$;

-- Echivalența helper ↔ politica live: aceeași identitate, același răspuns (sursa unică de adevăr).
CREATE FUNCTION teste.echivalenta(p_uid uuid, p_asteptat boolean, p_eticheta text, p_aut bigint, p_tip integer)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_helper boolean; n_aut integer; n_tip integer;
BEGIN
  IF p_uid IS NULL THEN PERFORM teste.ca_rol_fara_claims('authenticated'); ELSE PERFORM teste.ca_utilizator(p_uid); END IF;
  v_helper := public.fn_poate_scrie_hr_autorizatii();
  EXECUTE 'UPDATE public.hr_autorizatii SET observatii = observatii WHERE id = $1' USING p_aut;
  GET DIAGNOSTICS n_aut = ROW_COUNT;
  EXECUTE 'UPDATE public.hr_autorizatii_tipuri SET ordine = ordine WHERE id = $1' USING p_tip;
  GET DIAGNOSTICS n_tip = ROW_COUNT;
  PERFORM teste.ca_admin();
  PERFORM teste.assert(v_helper = p_asteptat AND (n_aut = 1) = p_asteptat AND (n_tip = 1) = p_asteptat,
    format('P2 %s: helper=%s = politica live hr_autorizatii (%s) = hr_autorizatii_tipuri (%s); așteptat %s',
           p_eticheta, v_helper, n_aut = 1, n_tip = 1, p_asteptat));
END $fn$;
GRANT EXECUTE ON FUNCTION teste.rpc_ok(uuid, bigint, date, text, date, text, date),
                          teste.echivalenta(uuid, boolean, text, bigint, integer) TO authenticated, anon, service_role;

\if :gaura
-- ============================================================================
-- GAURA = starea de azi a producției (schelet brut / după rollback tehnic): atacurile REUȘESC
-- ============================================================================
SELECT teste.assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
                    = '527c0e4708dfe1f88cec03a77b6a26dd', 'G1 RPC-ul este exact cel LIVE din 29.09 (md5 prosrc)');
SELECT teste.assert((SELECT proacl::text FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
                    = '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', 'G1 ACL RPC = producția');
SELECT teste.assert(to_regprocedure('public.fn_poate_scrie_hr_autorizatii()') IS NULL, 'G1 helperul nu există');
SELECT teste.assert(EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii_rsvti_confirmari'
                              AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_authenticated'
                              AND md5(with_check) = 'dc71e447411e7aaf354179a11ad2e2ae')
                AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii_rsvti_confirmari'
                              AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_autorizat'),
  'G1 politica INSERT a jurnalului = cea de azi (auth.uid() IS NOT NULL)');
SELECT teste.assert((SELECT replace(relacl::text, 'm/', '/') FROM pg_class WHERE oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass)
                    = '{postgres=arwdDxt/postgres,anon=arwdDxt/postgres,authenticated=arwdDxt/postgres,service_role=arwdDxt/postgres}',
  'G1 ACL jurnal = producția (fără „m”/MAINTAIN, inexistent în PG16)');

-- G2: orice cont logat (Execuție, fără drept HR) prelungește viza până în 2099 printr-un apel direct
SELECT teste.ca_utilizator(:'u_ex');
SELECT count(*) AS n FROM public.confirm_hr_autorizatie_rsvti(:a1, '2099-01-01', 'atac') \gset
SELECT teste.ca_admin();
SELECT teste.assert(:n = 1 AND (SELECT rsvti_urmatoarea_confirmare = '2099-07-01' AND rsvti_confirmat_de = :'u_ex'
                                  FROM public.hr_autorizatii WHERE id = :a1),
  'G2 GAURA reprodusă: non-HR prin RPC → viză „valabilă” până la 2099-07-01, deși nu poate scrie hr_autorizatii direct');
SELECT teste.ca_utilizator(:'u_ex');
WITH u AS (UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = '2099-07-01' WHERE id = :a2 RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'G2 același cont NU poate scrie direct în hr_autorizatii (RLS) — RPC-ul e ocolirea') FROM u;
-- G3: cont fără profil — tot trece
SELECT teste.ca_utilizator(:'u_fara');
SELECT count(*) AS n FROM public.confirm_hr_autorizatie_rsvti(:a3, :'azi', NULL) \gset
SELECT teste.ca_admin();
SELECT teste.assert(:n = 1, 'G3 GAURA: cont fără profil confirmă o viză');
-- G4: jurnal falsificat direct prin REST: semnat în numele owner-ului, scadență 2199
SELECT teste.ca_utilizator(:'u_ex');
WITH i AS (INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de)
           VALUES (:a1, :emp2, '2098-01-01', '2199-01-01', :'u_owner') RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'G4 GAURA: non-HR scrie direct în jurnal în numele owner-ului, alt angajat, dată 2098') FROM i;
-- G5: dovada că REVOKE UPDATE/DELETE nu schimbă comportamentul: azi RLS le refuză deja (0 rânduri)
SELECT teste.ca_utilizator(:'u_owner');
SELECT teste.assert(has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'UPDATE')
                AND has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'DELETE'),
  'G5 azi authenticated ARE GRANT UPDATE/DELETE pe jurnal');
WITH u AS (UPDATE public.hr_autorizatii_rsvti_confirmari SET observatii = 'x' RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'G5 …dar UPDATE din API = 0 rânduri (nicio politică UPDATE) — chiar și pentru owner') FROM u;
WITH d AS (DELETE FROM public.hr_autorizatii_rsvti_confirmari RETURNING 1)
  SELECT teste.assert(count(*) = 0, 'G5 …și DELETE din API = 0 rânduri (nicio politică DELETE)') FROM d;
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, urmatoarea_confirmare) VALUES (%s, %s, %L)', :a1, :emp1, :'azi'),
  'G5 anon: INSERT în jurnal deja refuzat de RLS (nicio politică pentru anon)', '42501', 'row-level security');
-- G6: anon nu are EXECUTE nici azi (neschimbat)
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'G6 anon: fără EXECUTE pe RPC (neschimbat)', '42501', 'permission denied');
SELECT teste.ca_admin();

\else
-- ============================================================================
-- PATCH aplicat
-- ============================================================================
-- ---------------------------------------------------------------- P1 obiectele
SELECT teste.assert((SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public, pg_temp']
                            AND pg_get_userbyid(proowner) = 'postgres' AND prorettype = 'boolean'::regtype
                     FROM pg_proc WHERE oid = 'public.fn_poate_scrie_hr_autorizatii()'::regprocedure),
  'P1 helper: SECURITY DEFINER, STABLE, search_path = public, pg_temp, proprietar postgres, boolean');
SELECT teste.assert(has_function_privilege('authenticated', 'public.fn_poate_scrie_hr_autorizatii()', 'EXECUTE')
                AND NOT has_function_privilege('anon', 'public.fn_poate_scrie_hr_autorizatii()', 'EXECUTE')
                AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                                WHERE p.oid = 'public.fn_poate_scrie_hr_autorizatii()'::regprocedure AND a.grantee = 0),
  'P1 helper: EXECUTE pentru authenticated (necesar politicii), NU pentru PUBLIC/anon');
SELECT teste.assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
                            AND prorettype = 'public.hr_autorizatii_rsvti_confirmari'::regtype
                     FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure),
  'P1 RPC: SECURITY DEFINER, search_path fixat, proprietar postgres, același tip returnat');
SELECT teste.assert(pg_get_function_arguments('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
                    = 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT CURRENT_DATE, p_observatii text DEFAULT NULL::text'
                AND (SELECT count(*) FROM pg_proc WHERE proname = 'confirm_hr_autorizatie_rsvti') = 1,
  'P1 RPC: semnătura neschimbată (UI compatibil); niciun parametru pentru scadență, nicio supraîncărcare');
SELECT teste.assert((SELECT proacl::text FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
                    = '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}',
  'P1 RPC: ACL identic cu producția (fără PUBLIC/anon)');
SELECT teste.assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
                    = '49a9d3a7fb8f30d9cb043db25f97f57f', 'P1 RPC: amprenta corpului = cea din migrare (de verificat live după apply)');
SELECT teste.assert((SELECT position('fn_poate_scrie_hr_autorizatii' IN prosrc) > 0
                        AND position('fn_poate_scrie_hr_autorizatii' IN prosrc) < position('from public.hr_autorizatii' IN prosrc)
                        AND position('fn_poate_scrie_hr_autorizatii' IN prosrc) < position('insert into' IN prosrc)
                     FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure),
  'P1 RPC: poarta e înaintea oricărei citiri/scrieri');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii_rsvti_confirmari'
                                  AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_authenticated')
                AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii_rsvti_confirmari'
                              AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_autorizat' AND cmd = 'INSERT'
                              AND roles::text = '{authenticated}' AND with_check LIKE '%fn_poate_scrie_hr_autorizatii()%'
                              AND with_check LIKE '%confirmat_de = ( SELECT auth.uid()%'),
  'P1 jurnal: politica INSERT veche a dispărut; cea nouă = helper + confirmat_de = auth.uid()');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('UPDATE', 'DELETE', 'ALL')),
  'P1 jurnal: nicio politică UPDATE/DELETE/ALL');
SELECT teste.assert(NOT has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'UPDATE')
                AND NOT has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'DELETE')
                AND NOT has_table_privilege('anon', 'public.hr_autorizatii_rsvti_confirmari', 'INSERT')
                AND NOT has_table_privilege('anon', 'public.hr_autorizatii_rsvti_confirmari', 'UPDATE')
                AND NOT has_table_privilege('anon', 'public.hr_autorizatii_rsvti_confirmari', 'DELETE')
                AND has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'INSERT')
                AND has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'SELECT')
                AND has_table_privilege('service_role', 'public.hr_autorizatii_rsvti_confirmari', 'UPDATE'),
  'P1 jurnal: GRANT UPDATE/DELETE retras (anon+authenticated), INSERT retras de la anon; SELECT/INSERT authenticated și service_role neatinse');
SELECT teste.assert(EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii' AND policyname = 'hr_autorizatii_write_authorized'
                              AND md5(qual) = 'f2a295ca956d58971e6ec6779e9aa08a' AND md5(with_check) = 'f2a295ca956d58971e6ec6779e9aa08a')
                AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hr_autorizatii_tipuri' AND policyname = 'hr_autorizatii_tipuri_write_authorized'
                              AND md5(qual) = 'f2a295ca956d58971e6ec6779e9aa08a'),
  'P1 politicile hr_autorizatii / hr_autorizatii_tipuri NEATINSE (drepturile efective neschimbate)');

-- ---------------------------------------------------------------- P2 sursa unică = politica live (matrice)
SELECT teste.echivalenta(:'u_owner', true,  'owner',                         :a1, :t6);
SELECT teste.echivalenta(:'u_cme',   true,  'can_modify_employees',          :a1, :t6);
SELECT teste.echivalenta(:'u_super', true,  'role superadmin',               :a1, :t6);
SELECT teste.echivalenta(:'u_hr',    true,  'department HR',                 :a1, :t6);
SELECT teste.echivalenta(:'u_adm',   true,  'department Administrativ',      :a1, :t6);
SELECT teste.echivalenta(:'u_ex',    false, 'Execuție (ca operatorul RSVTI)', :a1, :t6);
SELECT teste.echivalenta(:'u_rolhr', false, 'role hr fără departament',      :a1, :t6);
SELECT teste.echivalenta(:'u_fara',  false, 'JWT fără profil',               :a1, :t6);
SELECT teste.echivalenta(NULL,       false, 'authenticated fără claims',     :a1, :t6);

-- ---------------------------------------------------------------- P3 sursa drepturilor nu se autoatribuie
SELECT teste.ca_utilizator(:'u_ex');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''HR'' WHERE id = auth.uid()',
  'P3 non-HR NU își poate pune singur department=HR (S-A live)', '42501', 'department');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET department = ''Administrativ'' WHERE id = auth.uid()',
  'P3 …nici department=Administrativ', '42501', 'department');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET role = ''superadmin'' WHERE id = auth.uid()',
  'P3 …nici role=superadmin (prevent_role_escalation)', 'P0001', 'rolul');
SELECT teste.asteapta_eroare('UPDATE public.profiles SET is_owner = true WHERE id = auth.uid()',
  'P3 …nici is_owner (prevent_role_escalation)', 'P0001', 'is_owner');
SELECT teste.reuseste('UPDATE public.profiles SET can_modify_employees = true WHERE id = auth.uid()',
  'P3 can_modify_employees=true: UPDATE acceptat, dar…');
SELECT teste.assert(NOT (SELECT can_modify_employees FROM public.profiles WHERE id = auth.uid())
                AND NOT public.fn_poate_scrie_hr_autorizatii(),
  'P3 …flagul e resetat tăcut (enforce_owner_only_salary_flags) și poarta rămâne închisă');
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- P4 RPC: refuz pentru cine n-are drept
SELECT count(*) AS jurnal0 FROM public.hr_autorizatii_rsvti_confirmari \gset
SELECT teste.ca_utilizator(:'u_ex');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 non-HR (Execuție), dată validă → 42501', '42501', 'Nu ai dreptul');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, %L)', :a1, '2099-01-01', 'atac'),
  'P4 non-HR, atacul din raport (2099-01-01) → 42501', '42501', 'Nu ai dreptul');
SELECT teste.asteapta_eroare('SELECT public.confirm_hr_autorizatie_rsvti(999999999, NULL, NULL)',
  'P4 non-HR pe un id inexistent → tot 42501 (poarta înaintea existenței: fără oracol)', '42501', 'Nu ai dreptul');
SELECT teste.ca_utilizator(:'u_rolhr');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 role=hr fără departament HR → 42501 (ca politica live)', '42501', 'Nu ai dreptul');
SELECT teste.ca_utilizator(:'u_fara');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 JWT valid fără profil → 42501', '42501', 'Nu ai dreptul');
SELECT teste.ca_rol_fara_claims('authenticated');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 authenticated fără claims (uid NULL) → 42501, nu „sistem”', '42501', 'Nu ai dreptul');
SELECT teste.ca_service_role();
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 service_role (JWT fără sub) → 42501: nicio cale „sistem” (niciun apelant backend cunoscut)', '42501', 'Nu ai dreptul');
SELECT teste.ca_admin();
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 login postgres fără claims (MCP/SQL editor) → 42501, nu „sistem”', '42501', 'Nu ai dreptul');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P4 anon → fără EXECUTE pe RPC', '42501', 'permission denied');
SELECT teste.asteapta_eroare('SELECT public.fn_poate_scrie_hr_autorizatii()',
  'P4 anon → fără EXECUTE pe helper', '42501', 'permission denied');
SELECT teste.ca_admin();
SELECT teste.assert(NOT has_function_privilege('anon', 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)', 'EXECUTE'),
  'P4 has_function_privilege(anon, RPC) = false');
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = :jurnal0
                AND (SELECT rsvti_ultima_confirmare IS NULL AND rsvti_urmatoarea_confirmare IS NULL AND rsvti_confirmat_de IS NULL
                     FROM public.hr_autorizatii WHERE id = :a1),
  'P4 după toate refuzurile: jurnalul și fișa neschimbate');

-- ---------------------------------------------------------------- P5 INSERT direct în jurnal (aceeași sursă de adevăr)
SELECT teste.ca_utilizator(:'u_ex');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de) VALUES (%s, %s, %L, %L, %L)',
                                    :a1, :emp1, :'azi', '2199-01-01', :'u_ex'),
  'P5 non-HR: INSERT direct în jurnal, chiar semnat cu propriul uid → refuz RLS', '42501', 'row-level security');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de) VALUES (%s, %s, %L, %L, %L)',
                                    :a1, :emp1, :'azi', '2199-01-01', :'u_owner'),
  'P5 non-HR: INSERT semnat în numele owner-ului (falsul din raport) → refuz RLS', '42501', 'row-level security');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de) VALUES (%s, %s, %L, %L, %L)',
                                    :a1, :emp1, :'azi', '2027-01-01', :'u_owner'),
  'P5 HR: INSERT direct în numele ALTCUIVA → refuz (atribuire)', '42501', 'row-level security');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare) VALUES (%s, %s, %L, %L)',
                                    :a1, :emp1, :'azi', '2027-01-01'),
  'P5 HR: INSERT direct fără confirmat_de (anonim) → refuz', '42501', 'row-level security');
SELECT teste.reuseste(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de) VALUES (%s, %s, %L, %L, %L)',
                             :a1, :emp1, :'azi', (:'azi'::date + interval '6 months')::date, :'u_hr'),
  'P5 HR: INSERT direct în nume propriu trece (dreptul grupului HR păstrat; limita e documentată)');
SELECT teste.asteapta_eroare('UPDATE public.hr_autorizatii_rsvti_confirmari SET urmatoarea_confirmare = ''2199-01-01''',
  'P5 HR: UPDATE pe jurnal → fără GRANT', '42501', 'permission denied');
SELECT teste.asteapta_eroare('DELETE FROM public.hr_autorizatii_rsvti_confirmari',
  'P5 HR: DELETE pe jurnal → fără GRANT', '42501', 'permission denied');
SELECT teste.ca_utilizator(:'u_owner');
SELECT teste.asteapta_eroare('UPDATE public.hr_autorizatii_rsvti_confirmari SET observatii = ''x''',
  'P5 owner prin API: UPDATE pe jurnal → fără GRANT (jurnalul nu se editează din aplicație)', '42501', 'permission denied');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, urmatoarea_confirmare) VALUES (%s, %s, %L)', :a1, :emp1, :'azi'),
  'P5 anon: INSERT în jurnal → fără GRANT', '42501', 'permission denied');
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- P6 traseele legitime (toată matricea „cu drept”)
SELECT teste.rpc_ok(:'u_owner', :a1, '2025-03-01', NULL,        '2025-09-01', 'P6 owner confirmă');
SELECT teste.rpc_ok(:'u_cme',   :a1, '2025-09-01', NULL,        '2026-03-01', 'P6 can_modify_employees confirmă');
SELECT teste.rpc_ok(:'u_super', :a1, '2026-03-01', NULL,        '2026-09-01', 'P6 superadmin confirmă');
SELECT teste.rpc_ok(:'u_hr',    :a1, '2026-04-10', ' viza ok ', '2026-10-10', 'P6 HR confirmă (observații tăiate de spații)');
SELECT teste.rpc_ok(:'u_adm',   :a1, :'azi',       NULL,        (:'azi'::date + interval '6 months')::date,
                    'P6 Administrativ confirmă azi (butonul „Confirmă viza”, HR.jsx ~L2110, data implicită)');
SELECT teste.rpc_ok(:'u_hr',    :a1, :'azi_utc',   NULL,        (:'azi_utc'::date + interval '6 months')::date,
                    'P6 data implicită din UI (toISOString = ziua UTC) e acceptată');
-- Fluxul „Adaugă autorizație” (HR.jsx ~L1860-1908): INSERT în hr_autorizatii ca HR, apoi viza inițială prin RPC
SELECT teste.ca_utilizator(:'u_hr');
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere, uploadat_de)
  VALUES (:emp2, :t6, 'A-NOUA', :'azi'::date - 30, :'u_hr') RETURNING id AS a_noua \gset
SELECT teste.ca_admin();
SELECT teste.rpc_ok(:'u_hr', :a_noua, (:'azi'::date - 5), NULL, ((:'azi'::date - 5) + interval '6 months')::date,
                    'P6 fluxul „Adaugă autorizație” + „Data ultimei vize” (viza inițială)');
-- Dreptul retras de owner → refuz imediat (poarta citește starea curentă a profilului)
SELECT teste.ca_utilizator(:'u_owner');
SELECT teste.reuseste(format('UPDATE public.profiles SET department = %L WHERE id = %L', 'Execuție', :'u_adm'),
  'P6 owner mută contul Administrativ în Execuție (S-A permite owner-ului)');
SELECT teste.ca_utilizator(:'u_adm');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'azi'),
  'P6 după retragerea dreptului → 42501 imediat', '42501', 'Nu ai dreptul');
SELECT teste.ca_admin();

-- ---------------------------------------------------------------- P7 regula datei (data confirmării EFECTUATE)
SELECT (SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) AS jurnal1,
       (SELECT row(rsvti_ultima_confirmare, rsvti_urmatoarea_confirmare, rsvti_confirmat_de)::text FROM public.hr_autorizatii WHERE id = :a1) AS stare_a1 \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'maine'),
  'P7 HR: mâine (Europe/Bucharest) → refuz', '22023', 'viitor');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, '2099-01-01'),
  'P7 HR: 2099-01-01 → refuz (nici cel cu drept nu mai poate ascunde o viză)', '22023', 'viitor');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, '2025-01-14'),
  'P7 HR: cu o zi înainte de data_emitere (2025-01-15) → refuz', '22023', 'emiterea');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a4, :'azi'),
  'P7 tip fără viză → aceeași eroare ca înainte', 'P0001', 'nu necesita');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a5, :'azi'),
  'P7 autorizație ștearsă → aceeași eroare ca înainte', 'P0001', 'nu exista');
-- TimeZone-ul sesiunii (PostgREST acceptă „Prefer: timezone=…”) nu mută limita „azi”
SET LOCAL timezone = 'Pacific/Kiritimati';
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'maine'),
  'P7 sesiune în UTC+14: mâine (București) tot refuzat', '22023', 'viitor');
SET LOCAL timezone = 'UTC';
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = :jurnal1
                AND (SELECT row(rsvti_ultima_confirmare, rsvti_urmatoarea_confirmare, rsvti_confirmat_de)::text FROM public.hr_autorizatii WHERE id = :a1) = :'stare_a1',
  'P7 refuzurile de dată n-au scris nimic (jurnal + fișă neschimbate)');
SELECT teste.rpc_ok(:'u_hr', :a1, '2025-01-15', NULL, '2025-07-15', 'P7 exact data_emitere → trece (limita inclusă)');
SELECT teste.rpc_ok(:'u_hr', :a2, '2020-01-01', NULL, '2021-01-01', 'P7 fișă fără data_emitere → fără limită inferioară (2 rânduri live în situația asta)');
SET LOCAL timezone = 'Pacific/Kiritimati';
SELECT teste.rpc_ok(:'u_hr', :a1, :'azi', NULL, (:'azi'::date + interval '6 months')::date, 'P7 sesiune în UTC+14: azi (București) trece');
SET LOCAL timezone = 'UTC';
SELECT teste.rpc_ok(:'u_hr', :a3, NULL, NULL, (current_date + interval '6 months')::date,
                    'P7 p_data_confirmare NULL explicit → current_date (ca înainte)', current_date);

-- ---------------------------------------------------------------- P8 scadența se calculează în funcție
SELECT teste.rpc_ok(:'u_hr', :a1, '2026-08-31', NULL, '2027-02-28', 'P8 6 luni de la 31.08 → 28.02 (make_interval, sfârșit de lună)');
SELECT teste.rpc_ok(:'u_hr', :a2, '2026-02-28', NULL, '2027-02-28', 'P8 tipul cu 12 luni → +12 luni');
SELECT teste.rpc_ok(:'u_hr', :a3, :'azi', NULL, (:'azi'::date + interval '6 months')::date, 'P8 interval necompletat pe tip → implicit 6 luni');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL, %L::date)', :a1, :'azi', '2099-01-01'),
  'P8 apelantul nu poate trimite scadența (al 4-lea argument) → funcție inexistentă', '42883', NULL);
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(p_autorizatie_id => %s, p_urmatoarea_confirmare => %L::date)', :a1, '2099-01-01'),
  'P8 …nici ca argument numit', '42883', NULL);
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari c
                                  JOIN public.hr_autorizatii a ON a.id = c.autorizatie_id
                                  JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
                                 WHERE c.urmatoarea_confirmare <> (c.data_confirmare + make_interval(months => coalesce(t.interval_confirmare_rsvti_luni, 6)))::date)
                AND (SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = 15,
  'P8 toate rândurile din jurnal (15: 14 prin RPC + 1 INSERT direct HR) au scadența = data + intervalul tipului');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari c
                                 WHERE c.data_confirmare > :'azi'::date),
  'P8 niciun rând din jurnal cu dată în viitor (indicatorul din incident rămâne 0)');
\endif

ROLLBACK;
