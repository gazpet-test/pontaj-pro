-- ============================================================================
-- Teste SEC RSVTI — 20261003c_sec_rsvti_poarta_jurnal.sql (poarta RPC + jurnal, tratate împreună), runda 2.
-- Rulează doar prin scripts/test_sec_rsvti.sh, pe scheletul supabase/tests/sec_rsvti_schelet.sql
-- (PG16 local, bază *_test). Totul într-o tranzacție care se anulează la final (ROLLBACK).
--
--   -v gaura=true  → starea de AZI a producției (schelet brut sau după rollback tehnic):
--                    atacurile TREBUIE să reușească (dovada că gaura e reprodusă fidel);
--   -v gaura=false → după migrare: atacurile refuzate, traseele legitime trec (implicit).
--
-- Identități simulate ca PostgREST: claims JWT (sub + role) + SET ROLE; fără claims = login postgres.
-- Precondițiile/postcondițiile migrării și ale rollback-ului se testează în harness (scenarii negative,
-- fiecare într-o tranzacție anulată), nu aici.
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

-- Rezultatul unui apel RPC ca p_uid, FĂRĂ efecte: 'OK' sau SQLSTATE-ul refuzului. La succes scrierea se
-- anulează (subtranzacție), deci numărul de rânduri din jurnal nu depinde de ramura luată.
CREATE FUNCTION teste.rpc_stare(p_uid uuid, p_aut bigint, p_data date)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_state text;
BEGIN
  PERFORM teste.ca_utilizator(p_uid);
  BEGIN
    PERFORM public.confirm_hr_autorizatie_rsvti(p_aut, p_data, 'rpc_stare');
    RAISE EXCEPTION 'anulez scrierea' USING ERRCODE = 'P0T02';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  PERFORM teste.ca_admin();
  RETURN CASE v_state WHEN 'P0T02' THEN 'OK' ELSE v_state END;
END $fn$;

-- Echivalența helper ↔ politica live: aceeași identitate, același răspuns (aceeași regulă).
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
                          teste.rpc_stare(uuid, bigint, date),
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
-- G7: pe live nu există nicio limită pe dată — nici inferioară: -infinity trece, chiar pentru un non-HR
SELECT teste.ca_utilizator(:'u_ex');
SELECT count(*) AS n FROM public.confirm_hr_autorizatie_rsvti(:a2, '-infinity', 'G7') \gset
SELECT teste.ca_admin();
SELECT teste.assert(:n = 1 AND (SELECT rsvti_ultima_confirmare = '-infinity'::date AND rsvti_urmatoarea_confirmare = '-infinity'::date
                                  FROM public.hr_autorizatii WHERE id = :a2),
  'G7 GAURA: non-HR, p_data_confirmare = -infinity → acceptat pe live (ultima viză și scadența = -infinity)');

\else
-- ============================================================================
-- PATCH aplicat
-- ============================================================================
-- ---------------------------------------------------------------- P1 obiectele
SELECT teste.assert(to_regprocedure('public.fn_poate_scrie_hr_autorizatii()') IS NOT NULL,
  'P1 helperul fn_poate_scrie_hr_autorizatii() există (pe starea live suita PATCH trebuie să cadă aici)');
SELECT teste.assert((SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public, pg_temp']
                            AND pg_get_userbyid(proowner) = 'postgres' AND prorettype = 'boolean'::regtype
                     FROM pg_proc WHERE oid = 'public.fn_poate_scrie_hr_autorizatii()'::regprocedure),
  'P1 helper: SECURITY DEFINER, STABLE, search_path = public, pg_temp, proprietar postgres, boolean');
SELECT teste.assert((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_poate_scrie_hr_autorizatii()'::regprocedure)
                    = 'a59aeb46d5007222067276184a63aaa0', 'P1 helper: amprenta corpului = cea din migrare (de verificat live după apply)');
SELECT teste.assert(has_function_privilege('authenticated', 'public.fn_poate_scrie_hr_autorizatii()', 'EXECUTE')
                AND NOT has_function_privilege('anon', 'public.fn_poate_scrie_hr_autorizatii()', 'EXECUTE')
                AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                                WHERE p.oid = 'public.fn_poate_scrie_hr_autorizatii()'::regprocedure AND a.grantee = 0),
  'P1 helper: EXECUTE pentru authenticated (necesar politicii), NU pentru PUBLIC/anon');
SELECT teste.assert(obj_description('public.fn_poate_scrie_hr_autorizatii()'::regprocedure, 'pg_proc') LIKE '%poarta RSVTI%'
                AND obj_description('public.fn_poate_scrie_hr_autorizatii()'::regprocedure, 'pg_proc') LIKE '%fn_hr_autorizatie_propunere_accepta are poarta ei%'
                AND obj_description('public.fn_poate_scrie_hr_autorizatii()'::regprocedure, 'pg_proc') NOT LIKE '%sursa unică pentru „cine scrie autorizații HR”%',
  'P1 helper: COMMENT-ul descrie poarta RSVTI, nu „toate scrierile HR” (fn_hr_autorizatie_propunere_accepta are poarta ei)');
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
                    = '42e0528ed5af58c0cccc7b801aef4193', 'P1 RPC: amprenta corpului = cea din migrare (de verificat live după apply)');
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
SELECT teste.assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass)
                AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
                                                        AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')) = 1
                AND (SELECT md5(with_check) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
                                                             AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_autorizat')
                    = '780014ba883836d16ffb7a014c7430c6',
  'P1 jurnal: RLS activ și EXACT o politică de scriere = cea din patch (md5 with_check 780014ba…; ca precondiția 0e/postcondiția)');
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

-- ---------------------------------------------------------------- P2 poarta = politica live (matrice)
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
SELECT teste.assert((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal) = 4
                AND (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                      WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 19
                        AND (t.tgname, p.proname, md5(p.prosrc)) IN (
                              ('prevent_role_escalation_trigger',     'prevent_role_escalation',         '16112659be92143e6539ae0e54e47a06'),
                              ('trg_enforce_owner_only_salary_flags', 'enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                              ('trg_profiles_campuri_owner_only',     'fn_profiles_campuri_owner_only',  'c06d7ce0f212c7bba2093c50614a88fc'),
                              ('trg_protect_can_access_pontaj_brut',  'protect_can_access_pontaj_brut',  'ff277c90e02ef03d1efb34cd7e87b1d4'))) = 4,
  'P3 profiles are EXACT cele 4 triggere analizate (setul cerut de precondiția 0c; un al 5-lea e refuzat în harness)');
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

-- ---------------------------------------------------------------- P5 INSERT direct în jurnal (aceeași poartă)
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
  'P5 HR: INSERT direct în nume propriu trece (dreptul grupului HR păstrat; limitele: grupul R + doc §8)');
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
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = :jurnal1
                AND (SELECT row(rsvti_ultima_confirmare, rsvti_urmatoarea_confirmare, rsvti_confirmat_de)::text FROM public.hr_autorizatii WHERE id = :a1) = :'stare_a1',
  'P7 refuzurile de dată n-au scris nimic (jurnal + fișă neschimbate)');
SELECT teste.rpc_ok(:'u_hr', :a1, '2025-01-15', NULL, '2025-07-15', 'P7 exact data_emitere → trece (limita inclusă)');
SELECT teste.rpc_ok(:'u_hr', :a2, '2020-01-01', NULL, '2021-01-01', 'P7 fișă fără data_emitere → limita inferioară e doar minimul 2000-01-01 (2 fișe live fără data_emitere)');
SELECT teste.rpc_ok(:'u_hr', :a3, NULL, NULL, (:'azi'::date + interval '6 months')::date,
                    'P7 p_data_confirmare NULL explicit (sesiune UTC) → azi în Europe/Bucharest, aceeași referință ca limita', :'azi');

-- ---------------------------------------------------------------- P7-TZ fusul orar al sesiunii nu mută „azi” — DETERMINIST
-- Preluat din ADV-D4 (verificator): la orice oră, cel puțin una dintre Etc/GMT+12 (în urmă) și Pacific/Kiritimati
-- (înainte) are altă dată decât Bucureștiul. Ambele zone rulează mereu, cu același număr de aserțiuni și de rânduri
-- scrise; cel puțin una discriminează ⇒ „v_azi := current_date” și „coalesce(p_data_confirmare, current_date)” pică
-- indiferent de ora rulării. PostgREST acceptă „Prefer: timezone=…”, deci TimeZone-ul sesiunii e ales de client.
SELECT CASE WHEN (now() AT TIME ZONE 'Etc/GMT+12')::date < :'azi'::date THEN 'true' ELSE 'false' END AS zona_urma,
       CASE WHEN (now() AT TIME ZONE 'Pacific/Kiritimati')::date > :'azi'::date THEN 'true' ELSE 'false' END AS zona_fata,
       (now() AT TIME ZONE 'Etc/GMT+12')::date AS data_gmt12,
       (now() AT TIME ZONE 'Pacific/Kiritimati')::date AS data_kir \gset
\echo 'INFO TZ: current_date Etc/GMT+12 =' :data_gmt12 '| Pacific/Kiritimati =' :data_kir '| București =' :azi
SELECT teste.assert(:'zona_urma'::boolean OR :'zona_fata'::boolean,
  'P7-TZ cel puțin una dintre Etc/GMT+12 și Pacific/Kiritimati are acum altă dată decât Bucureștiul (testul discriminează la orice oră)');
SET LOCAL timezone = 'Etc/GMT+12';
SELECT teste.rpc_ok(:'u_hr', :a1, :'azi', NULL, (:'azi'::date + interval '6 months')::date,
                    format('P7-TZ sesiune Etc/GMT+12 (current_date %s): azi București ACCEPTAT', :'data_gmt12'));
SELECT teste.rpc_ok(:'u_hr', :a1, NULL, NULL, (:'azi'::date + interval '6 months')::date,
                    format('P7-TZ sesiune Etc/GMT+12 (current_date %s): NULL ⇒ azi București, nu current_date-ul sesiunii', :'data_gmt12'), :'azi');
SET LOCAL timezone = 'Pacific/Kiritimati';
SELECT teste.assert(teste.rpc_stare(:'u_hr', :a1, :'data_kir') = CASE WHEN :'zona_fata'::boolean THEN '22023' ELSE 'OK' END,
       format('P7-TZ sesiune Pacific/Kiritimati: current_date-ul sesiunii (%s) → %s', :'data_kir',
              CASE WHEN :'zona_fata'::boolean THEN 'e mâine în București ⇒ REFUZAT 22023' ELSE 'e azi și în București ⇒ acceptat' END));
SELECT teste.rpc_ok(:'u_hr', :a1, NULL, NULL, (:'azi'::date + interval '6 months')::date,
                    format('P7-TZ sesiune Pacific/Kiritimati (current_date %s): NULL ⇒ azi București, nu current_date-ul sesiunii', :'data_kir'), :'azi');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a1, :'maine'),
  'P7-TZ sesiune Pacific/Kiritimati: mâine (București) tot refuzat', '22023', 'viitor');
SELECT teste.ca_admin();
SET LOCAL timezone = 'UTC';

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

-- ---------------------------------------------------------------- P9 date extreme (ADV-E, verificator): o zi reală
SELECT (SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) AS jurnal2,
       (SELECT row(rsvti_ultima_confirmare, rsvti_urmatoarea_confirmare, rsvti_confirmat_de)::text FROM public.hr_autorizatii WHERE id = :a2) AS stare_a2 \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a2, 'infinity'),
  'P9 +infinity → 22023 „viitor” (pe live: scadență infinity = viză care nu mai expiră)', '22023', 'viitor');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a2, '-infinity'),
  'P9 -infinity pe fișă fără data_emitere → 22023 (dată nefinită; pe live trece, G7)', '22023', '2000-01-01');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a2, '0044-03-15 BC'),
  'P9 dată î.Hr. pe fișă fără data_emitere → 22023', '22023', '2000-01-01');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a2, '1999-12-31'),
  'P9 1999-12-31 (sub minimul 2000-01-01) → 22023', '22023', '2000-01-01');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = :jurnal2
                AND (SELECT row(rsvti_ultima_confirmare, rsvti_urmatoarea_confirmare, rsvti_confirmat_de)::text FROM public.hr_autorizatii WHERE id = :a2) = :'stare_a2',
  'P9 refuzurile n-au scris nimic (jurnal + fișă neschimbate)');
SELECT teste.rpc_ok(:'u_hr', :a2, '2000-01-01', NULL, '2001-01-01', 'P9 exact 2000-01-01 (minimul) → trece (limita inclusă; tip 12 luni)');

-- ---------------------------------------------------------------- P10 data confirmării EFECTUATE ≠ scadența (cerința Copilot, 30.09)
SELECT teste.assert((SELECT count(*) FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'hr_autorizatii_rsvti_confirmari'
                        AND column_name IN ('data_confirmare', 'urmatoarea_confirmare') AND data_type = 'date' AND is_nullable = 'NO') = 2
                AND (SELECT count(*) FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'hr_autorizatii'
                        AND column_name IN ('rsvti_ultima_confirmare', 'rsvti_urmatoarea_confirmare') AND data_type = 'date') = 2,
  'P10 schema: data efectuată și scadența sunt coloane DISTINCTE (jurnal: data_confirmare / urmatoarea_confirmare; fișă: rsvti_ultima_confirmare / rsvti_urmatoarea_confirmare)');
SELECT teste.assert((SELECT array_to_string(proargnames, ',') FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
                    = 'p_autorizatie_id,p_data_confirmare,p_observatii',
  'P10 RPC: singura dată primită e p_data_confirmare (data EFECTUATĂ); scadența nu e parametru (P8: 42883)');
SELECT teste.rpc_ok(:'u_hr', :a3, :'azi', 'P10', (:'azi'::date + interval '6 months')::date,
                    'P10 confirmare azi → scadența = azi + 6 luni, în viitor și ACCEPTATĂ: regula „nu în viitor” e doar pe data efectuată') AS id_p10 \gset
SELECT teste.assert((SELECT c.data_confirmare = :'azi'::date AND c.urmatoarea_confirmare > :'azi'::date
                            AND c.urmatoarea_confirmare = (c.data_confirmare + make_interval(months => 6))::date
                            AND a.rsvti_ultima_confirmare = c.data_confirmare AND a.rsvti_urmatoarea_confirmare = c.urmatoarea_confirmare
                     FROM public.hr_autorizatii_rsvti_confirmari c JOIN public.hr_autorizatii a ON a.id = c.autorizatie_id
                     WHERE c.id = :id_p10),
  'P10 jurnal + fișă: data efectuată (= azi) și scadența calculată (> azi) sunt stocate separat, fiecare în coloana ei');

-- ---------------------------------------------------------------- PF agregate pe tot ce a scris suita
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari c
                                  JOIN public.hr_autorizatii a ON a.id = c.autorizatie_id
                                  JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
                                 WHERE c.urmatoarea_confirmare <> (c.data_confirmare + make_interval(months => coalesce(t.interval_confirmare_rsvti_luni, 6)))::date)
                AND (SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = 19,
  'PF toate rândurile din jurnal (19: 18 prin RPC + 1 INSERT direct HR) au scadența = data + intervalul tipului');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari c
                                 WHERE c.data_confirmare > :'azi'::date OR NOT isfinite(c.data_confirmare) OR c.data_confirmare < '2000-01-01'),
  'PF niciun rând din jurnal cu dată în viitor, nefinită sau înainte de 2000 (indicatorul din incident rămâne 0)');

-- ---------------------------------------------------------------- R reziduale DOCUMENTATE (neschimbate de patch → decizii, doc §8)
-- Aserțiunile confirmă că comportamentul EXISTĂ (ca să nu fie descris greșit în doc), nu că e dorit.
-- R1 (ADV-C4): INSERT direct HR, în nume propriu: HR alege id, created_at (și în VIITOR), angajatul și ambele date
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.reuseste(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (id, autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de, created_at) VALUES (%s, %s, %s, %L, %L, %L, %L)',
                             987654, :a1, :emp2, '2099-01-01', '2199-01-01', :'u_hr', '2099-01-02 10:00+00'),
  'R1 REZIDUAL HR INSERT direct (nume propriu): id ales, created_at în VIITOR (2099), angajat ≠ fișa, dată 2099, scadență 2199');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT (c.data_confirmare > c.created_at::date) AND c.employee_id <> a.employee_id
                     FROM public.hr_autorizatii_rsvti_confirmari c JOIN public.hr_autorizatii a ON a.id = c.autorizatie_id
                     WHERE c.id = 987654),
  'R1 REZIDUAL …indicatorul „dată în viitor la creare” (data_confirmare > created_at) NU-l vede: și created_at e ales de HR');
-- R2 (ADV-C5): HR scrie direct rsvti_* pe fișă, cu rsvti_confirmat_de = OWNER, fără rând în jurnal
SELECT (SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari WHERE autorizatie_id = :a2) AS j_a2 \gset
SELECT teste.ca_utilizator(:'u_hr');
WITH u AS (UPDATE public.hr_autorizatii SET rsvti_ultima_confirmare = '2099-01-01', rsvti_urmatoarea_confirmare = '2099-07-01',
                                            rsvti_confirmat_de = :'u_owner', rsvti_confirmat_la = '2020-01-01'
            WHERE id = :a2 RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'R2 REZIDUAL HR UPDATE direct rsvti_* (politica ALL): viză 2099, rsvti_confirmat_de = OWNER (atribuire falsă)') FROM u;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari WHERE autorizatie_id = :a2) = :j_a2,
  'R2 REZIDUAL …fără niciun rând în jurnal și fără regula datei (propunerea P1b din doc)');
-- R3 (ADV-C7): jurnalul NU e doar-adăugare — HR șterge fizic fișa, FK ON DELETE CASCADE șterge istoricul
SELECT teste.ca_utilizator(:'u_hr');
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere, uploadat_de)
  VALUES (:emp2, :t6, 'R3-DE-STERS', '2025-01-01', :'u_hr') RETURNING id AS a_del \gset
SELECT teste.ca_admin();
SELECT teste.rpc_ok(:'u_hr', :a_del, :'azi', NULL, (:'azi'::date + interval '6 months')::date, 'R3 HR confirmă viza unei fișe (rând în jurnal)');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('DELETE FROM public.hr_autorizatii_rsvti_confirmari WHERE autorizatie_id = %s', :a_del),
  'R3 …DELETE direct pe jurnal refuzat (fără GRANT)', '42501', 'permission denied');
WITH d AS (DELETE FROM public.hr_autorizatii WHERE id = :a_del RETURNING 1)
  SELECT teste.assert(count(*) = 1, 'R3 REZIDUAL …dar HR poate șterge FIZIC fișa (politica ALL pe hr_autorizatii)') FROM d;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari WHERE autorizatie_id = :a_del),
  'R3 REZIDUAL …și FK ON DELETE CASCADE șterge istoricul confirmărilor: jurnalul NU e doar-adăugare');
-- R4 (ADV-F1, preexistent): o confirmare retroactivă suprascrie fișa cu o scadență mai veche
SELECT teste.rpc_ok(:'u_hr', :a1, (:'azi'::date - 1), 'R4-ieri', ((:'azi'::date - 1) + interval '6 months')::date, 'R4 HR confirmă ieri');
SELECT teste.rpc_ok(:'u_hr', :a1, '2025-02-01', 'R4-vechi', '2025-08-01', 'R4 …apoi o confirmare retroactivă (2025-02-01)');
SELECT teste.assert((SELECT a.rsvti_urmatoarea_confirmare = '2025-08-01' AND a.rsvti_observatii = 'R4-vechi'
                            AND EXISTS (SELECT 1 FROM public.hr_autorizatii_rsvti_confirmari c WHERE c.autorizatie_id = a.id AND c.data_confirmare = :'azi'::date - 1)
                     FROM public.hr_autorizatii a WHERE a.id = :a1),
  'R4 REZIDUAL (preexistent) fișa ia ULTIMA confirmare introdusă, nu cea mai recentă: scadența regresează la 2025-08-01 deși jurnalul are viza de ieri');
-- R5 (ADV-D1): „Reînnoiește” cu „Data ultimei vize” a autorizației vechi, anterioară noii data_emitere → 22023
SELECT teste.ca_utilizator(:'u_hr');
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere, uploadat_de)
  VALUES (:emp1, :t6, 'R5-REINNOITA', :'azi'::date - 3, :'u_hr') RETURNING id AS a_reinnoita \gset
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date, NULL)', :a_reinnoita, (:'azi'::date - 60)),
  'R5 reînnoire cu „Data ultimei vize” < noua data_emitere → 22023 (nou prin patch; înainte trecea)', '22023', 'emiterea');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT rsvti_ultima_confirmare IS NULL FROM public.hr_autorizatii WHERE id = :a_reinnoita),
  'R5 …fișa nouă rămâne salvată fără viză (UI: toast „viza RTS a eșuat”); remediu: „Confirmă viza” cu o dată ≥ emiterea');
\endif

ROLLBACK;
