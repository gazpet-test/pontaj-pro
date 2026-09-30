-- supabase/tests/diurna_salveaza_plata.test.sql — test server-side pentru RPC-ul diurna_salveaza_plata (PR #547).
-- DOAR pe o bază LOCALĂ (supabase start / Postgres 16 cu schema proiectului) — NICIODATĂ pe proiectul live.
-- Rulare:  psql "$PGURI" -v ON_ERROR_STOP=1 -f supabase/tests/diurna_salveaza_plata.test.sql
-- Tot scriptul e într-o tranzacție încheiată cu ROLLBACK: fixture-ul (auth.users, profiles, employees, pontaj_records,
-- calendar_days) nu rămâne. Se presupune că migrarea 20260930h a fost aplicată local înainte (sau se include cu \i).
-- Tipar identitate: scripts/pg/test_jakv207_rls.mjs (SET ROLE authenticated + request.jwt.claims cu sub = uid).
-- Coloanele obligatorii ale tabelelor (employees, pontaj_records) pot diferi local — ajustează INSERT-urile de fixture.
\set ON_ERROR_STOP on
BEGIN;

-- ── fixture (ca superuser/postgres) ──────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE t_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
INSERT INTO t_ctx VALUES ('uid', '00000000-0000-4000-8000-00000000d1a1');

-- profil cu can_access_salarii (profiles.id → auth.users.id; dacă FK-ul nu există local, INSERT-ul în auth.users e inofensiv)
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_diurna_rpc@local.test', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, is_owner, can_access_salarii) VALUES ('00000000-0000-4000-8000-00000000d1a1', false, true)
ON CONFLICT (id) DO UPDATE SET can_access_salarii = true;

-- angajați + pontaj: e1 bife 28–30.09.2026, e2 bifă 29.09 + CO 30.09
INSERT INTO public.employees (name, active, iban) VALUES ('TEST DIURNA UNU', true, 'RO49BTRL0000000000000001') RETURNING id \gset e1_
INSERT INTO public.employees (name, active, iban) VALUES ('TEST DIURNA DOI', true, NULL) RETURNING id \gset e2_
INSERT INTO t_ctx VALUES ('e1', :'e1_id'), ('e2', :'e2_id');
INSERT INTO public.pontaj_records (employee_id, date, diurna, norma) VALUES
  (:e1_id, DATE '2026-09-28', true, NULL), (:e1_id, DATE '2026-09-29', true, NULL), (:e1_id, DATE '2026-09-30', true, NULL),
  (:e2_id, DATE '2026-09-29', true, NULL), (:e2_id, DATE '2026-09-30', false, 'CO');

-- amprenta canonică, calculată în SQL exact ca în funcția serverului (și ca amprentaHash din client)
SELECT public.diurna_amprenta_hash(ARRAY[:e1_id, :e2_id]::integer[], DATE '2026-09-01', DATE '2026-09-30', '50') AS h \gset amp_
INSERT INTO t_ctx VALUES ('amprenta', :'amp_h');
SELECT count(*) AS n FROM public.diurna_payments \gset n0_
INSERT INTO t_ctx VALUES ('n0', :'n0_n');

-- helper de asertare
CREATE OR REPLACE FUNCTION pg_temp.t_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'TEST EȘUAT: %', msg; END IF; RAISE NOTICE 'ok: %', msg; END $$;
-- apel RPC cu argumente din t_ctx; întoarce jsonb sau ridică eroarea
CREATE OR REPLACE FUNCTION pg_temp.t_call(p_key uuid, p_detalii jsonb, p_amprenta text DEFAULT NULL, p_from date DEFAULT DATE '2026-09-28', p_to date DEFAULT DATE '2026-09-30')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE e1 integer := (SELECT v::integer FROM t_ctx WHERE k = 'e1'); e2 integer := (SELECT v::integer FROM t_ctx WHERE k = 'e2');
BEGIN
  RETURN public.diurna_salveaza_plata(p_from, p_to, 'test', p_detalii, p_key,
    COALESCE(p_amprenta, (SELECT v FROM t_ctx WHERE k = 'amprenta')), ARRAY[e1, e2], DATE '2026-09-01', DATE '2026-09-30', '50',
    jsonb_build_object('versiune_formula', 'r5'), DATE '2026-10-01');
END $$;
-- așteaptă o eroare cu SQLSTATE dat
CREATE OR REPLACE FUNCTION pg_temp.t_expect_err(p_key uuid, p_detalii jsonb, p_state text, msg text, p_amprenta text DEFAULT NULL, p_from date DEFAULT DATE '2026-09-28', p_to date DEFAULT DATE '2026-09-30')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  BEGIN
    r := pg_temp.t_call(p_key, p_detalii, p_amprenta, p_from, p_to);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RAISE NOTICE 'ok: % (% %)', msg, SQLSTATE, SQLERRM; RETURN; END IF;
    RAISE EXCEPTION 'TEST EȘUAT: % — SQLSTATE % în loc de % (%)', msg, SQLSTATE, p_state, SQLERRM;
  END;
  RAISE EXCEPTION 'TEST EȘUAT: % — nu a ridicat nicio eroare (%)', msg, r;
END $$;

-- ── identitate PostgREST: rol authenticated + JWT cu sub = profilul cu salarii ────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = '';
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT v FROM t_ctx WHERE k = 'uid'), 'role', 'authenticated')::text, true);
SELECT pg_temp.t_assert(auth.uid() = (SELECT v::uuid FROM t_ctx WHERE k = 'uid'), 'identitatea simulată (auth.uid) e cea din JWT');

-- 1. insert ok
SELECT pg_temp.t_call('aaaaaaaa-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e1'), 'days', 3, 'amount', 150, 'zile_diurna', 3, 'zile_salariu', 0, 'suma_salariu', 0,
                                       'defalcare_luni', jsonb_build_array(jsonb_build_object('luna','2026-09','zile_diurna',3,'suma_diurna',150,'zile_salariu',0,'suma_salariu',0))),
                    jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e2'), 'days', 1, 'amount', 50))) AS r \gset r1_
SELECT pg_temp.t_assert((:'r1_r')::jsonb->>'inserted' = 'true' AND ((:'r1_r')::jsonb->>'payment_id') IS NOT NULL, 'salvare ok: inserted=true, payment_id');
INSERT INTO t_ctx VALUES ('pid1', (:'r1_r')::jsonb->>'payment_id');

-- 2. aceeași cheie → inserted=false, același id, nicio plată în plus
SELECT pg_temp.t_call('aaaaaaaa-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e1'), 'days', 3, 'amount', 150))) AS r \gset r2_
SELECT pg_temp.t_assert((:'r2_r')::jsonb->>'inserted' = 'false' AND (:'r2_r')::jsonb->>'payment_id' = (SELECT v FROM t_ctx WHERE k='pid1'), 'retry aceeași cheie: inserted=false, același payment_id');

-- 3. suprapunere per angajat (altă cheie, perioadă care intersectează) → 23P01, și NU rămâne plată orfană
SELECT pg_temp.t_expect_err('aaaaaaaa-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e1'), 'days', 1, 'amount', 50)),
  '23P01', 'suprapunere per angajat refuzată', NULL, DATE '2026-09-29', DATE '2026-09-30');

-- 4. amprentă greșită → P0002
SELECT pg_temp.t_expect_err('aaaaaaaa-0000-4000-8000-000000000003',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e2'), 'days', 1, 'amount', 50)),
  'P0002', 'amprentă nepotrivită → P0002', repeat('0', 64), DATE '2026-09-01', DATE '2026-09-27');

-- 5. sumă 'abc' → excepție (P0001), nimic salvat
SELECT pg_temp.t_expect_err('aaaaaaaa-0000-4000-8000-000000000004',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e2'), 'days', 1, 'amount', 'abc')),
  'P0001', 'amount text → refuzat', NULL, DATE '2026-09-01', DATE '2026-09-27');

-- 6. perioadă în afara lunilor snapshotului → refuzată
SELECT pg_temp.t_expect_err('aaaaaaaa-0000-4000-8000-000000000005',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e2'), 'days', 1, 'amount', 50)),
  'P0001', 'perioadă în afara [month_start, month_end] → refuzată', NULL, DATE '2026-09-01', DATE '2026-10-02');

-- 7. după modificarea pontajului (schimbare de date) aceeași amprentă → P0002 (verificat ca postgres, apoi din nou ca authenticated)
RESET ROLE;
UPDATE public.pontaj_records SET diurna = false WHERE employee_id = (SELECT v::integer FROM t_ctx WHERE k='e2') AND date = DATE '2026-09-29';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT v FROM t_ctx WHERE k = 'uid'), 'role', 'authenticated')::text, true);
SELECT pg_temp.t_expect_err('aaaaaaaa-0000-4000-8000-000000000006',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e2'), 'days', 0, 'amount', 0)),
  'P0002', 'pontaj modificat după previzualizare → P0002', NULL, DATE '2026-09-01', DATE '2026-09-27');

-- ── verificări de stare (ca postgres): exact O plată în plus, cu detalii; nimic orfan ──────────────────────────────
RESET ROLE;
SELECT pg_temp.t_assert((SELECT count(*) FROM public.diurna_payments) = (SELECT v::bigint FROM t_ctx WHERE k='n0') + 1, 'exact o plată nouă (fără orfane după 23P01/P0002/abc)');
SELECT pg_temp.t_assert((SELECT count(*) FROM public.diurna_payment_details WHERE payment_id = (SELECT v::integer FROM t_ctx WHERE k='pid1')) = 2, 'plata are 2 detalii');
SELECT pg_temp.t_assert((SELECT zile_diurna = 3 AND defalcare_luni->0->>'luna' = '2026-09' FROM public.diurna_payment_details WHERE payment_id = (SELECT v::integer FROM t_ctx WHERE k='pid1') AND employee_id = (SELECT v::integer FROM t_ctx WHERE k='e1')), 'detaliul poartă zile_diurna + defalcare_luni');
SELECT pg_temp.t_assert((SELECT baza_calcul->>'amprenta' = (SELECT v FROM t_ctx WHERE k='amprenta') AND baza_calcul->>'tarif' = '50' AND baza_calcul->>'versiune_formula' = 'r5' AND total_amount = 200 AND payment_date = DATE '2026-10-01'
                          FROM public.diurna_payments WHERE id = (SELECT v::integer FROM t_ctx WHERE k='pid1')), 'baza_calcul înregistrată (amprentă, tarif, formula), totaluri, data plății');
SELECT pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.diurna_payments p WHERE p.idempotency_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.diurna_payment_details d WHERE d.payment_id = p.id)), 'nicio plată cu cheie fără detalii (orfană)');

-- 8. fără drept (profil fără salarii) → 42501
RESET ROLE;
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-00000000d1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_diurna_fara@local.test', now(), now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, is_owner, can_access_salarii) VALUES ('00000000-0000-4000-8000-00000000d1a2', false, false) ON CONFLICT (id) DO UPDATE SET can_access_salarii = false, is_owner = false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d1a2","role":"authenticated"}', true);
SELECT pg_temp.t_expect_err('aaaaaaaa-0000-4000-8000-000000000007',
  jsonb_build_array(jsonb_build_object('employee_id', (SELECT v::integer FROM t_ctx WHERE k='e2'), 'days', 0, 'amount', 0)),
  '42501', 'fără can_access_salarii → 42501');
RESET ROLE;

SELECT 'TOATE TESTELE AU TRECUT — se face ROLLBACK' AS rezultat;
ROLLBACK;
