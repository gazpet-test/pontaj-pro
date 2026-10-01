-- ============================================================================
-- Test cu CEAS FIX — SEC RSVTI 20261003c, runda 3 (cerința Copilot: DEFAULT NULL::date în semnătură).
-- Rulează doar prin scripts/test_sec_rsvti.sh (pasul 7), pe serverul PG16 local repornit cu libfaketime la
-- 2026-09-29 23:30 UTC (= 30.09 02:30 în București), după migrare. Totul într-o tranzacție anulată (ROLLBACK).
-- Pe runda 2 (DEFAULT CURRENT_DATE) pică la „C1 … data OMISĂ”: parametrul omis lua current_date-ul sesiunii (29.09).
-- Fără amprente md5: testează doar comportamentul, deci rulează neschimbat și pe revizia veche (discriminare).
-- ============================================================================
\set ON_ERROR_STOP on
\set u_hr 00000000-0000-4000-8000-00000000c003
BEGIN;
SELECT teste.assert(current_database() ~ '_test$', 'C0 baza este una locală *_test');
SELECT teste.assert(now() >= timestamptz '2026-09-29 23:30:00+00' AND now() < timestamptz '2026-09-29 23:59:00+00',
  'C0 ceasul serverului e fixat (libfaketime): între 2026-09-29 23:30 și 23:59 UTC');
SELECT teste.assert((now() AT TIME ZONE 'Europe/Bucharest')::date = date '2026-09-30', 'C0 azi în Europe/Bucharest = 2026-09-30');
SELECT teste.ca_admin();

INSERT INTO auth.users (id, email) VALUES (:'u_hr', 'hr.ceas@test');
INSERT INTO public.profiles (id, email, name, role, department) VALUES (:'u_hr', 'hr.ceas@test', 'DEPT HR (ceas)', 'manager_santier', 'HR');
INSERT INTO public.employees (name) VALUES ('RSVTI-CEAS SUDOR') RETURNING id AS emp \gset
INSERT INTO public.hr_autorizatii_tipuri (cod, denumire, necesita_confirmare_rsvti, interval_confirmare_rsvti_luni)
  VALUES ('T_CEAS_6', 'Sudor (ceas fix)', true, 6) RETURNING id AS t6 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp, :t6, 'CEAS-1', '2025-01-15') RETURNING id AS a1 \gset

-- Confirmă ca HR, cu data OMISĂ (p_omis) sau NULL explicit; întoarce data înregistrată și verifică scadența + fișa.
CREATE FUNCTION teste.ceas_confirma(p_uid uuid, p_aut bigint, p_omis boolean) RETURNS date LANGUAGE plpgsql AS $fn$
DECLARE r public.hr_autorizatii_rsvti_confirmari%rowtype; a public.hr_autorizatii%rowtype; v_state text; v_msg text;
BEGIN
  PERFORM teste.ca_utilizator(p_uid);
  BEGIN
    IF p_omis THEN
      SELECT * INTO r FROM public.confirm_hr_autorizatie_rsvti(p_aut);
    ELSE
      SELECT * INTO r FROM public.confirm_hr_autorizatie_rsvti(p_aut, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM teste.ca_admin();
    RAISE EXCEPTION 'ESEC TEST: apel % refuzat: % %', CASE WHEN p_omis THEN 'cu data OMISĂ' ELSE 'cu NULL' END, v_state, v_msg USING ERRCODE = 'P0T01';
  END;
  PERFORM teste.ca_admin();
  SELECT * INTO a FROM public.hr_autorizatii WHERE id = p_aut;
  IF a.rsvti_ultima_confirmare IS DISTINCT FROM r.data_confirmare
     OR r.urmatoarea_confirmare IS DISTINCT FROM (r.data_confirmare + interval '6 months')::date THEN
    RAISE EXCEPTION 'ESEC TEST: fișa/scadența nu corespund rândului din jurnal' USING ERRCODE = 'P0T01';
  END IF;
  RETURN r.data_confirmare;
END $fn$;
GRANT EXECUTE ON FUNCTION teste.ceas_confirma(uuid, bigint, boolean) TO authenticated;

-- C1: sesiune UTC — data sesiunii (29.09) e ÎNAINTEA datei Bucureștiului (30.09)
SET LOCAL timezone = 'UTC';
SELECT teste.assert(current_date = date '2026-09-29', 'C1 sesiune UTC: current_date = 2026-09-29 (înaintea Bucureștiului)');
SELECT teste.ceas_confirma(:'u_hr', :a1, true) AS d \gset
SELECT teste.assert(:'d'::date = date '2026-09-30', format('C1 sesiune UTC: data OMISĂ → înregistrat %s (așteptat 2026-09-30, azi București)', :'d'));
SELECT teste.ceas_confirma(:'u_hr', :a1, false) AS d \gset
SELECT teste.assert(:'d'::date = date '2026-09-30', format('C1 sesiune UTC: NULL explicit → înregistrat %s (așteptat 2026-09-30)', :'d'));

-- C2: sesiune Etc/GMT+12 — data sesiunii tot 29.09
SET LOCAL timezone = 'Etc/GMT+12';
SELECT teste.assert(current_date = date '2026-09-29', 'C2 sesiune Etc/GMT+12: current_date = 2026-09-29 (înaintea Bucureștiului)');
SELECT teste.ceas_confirma(:'u_hr', :a1, true) AS d \gset
SELECT teste.assert(:'d'::date = date '2026-09-30', format('C2 sesiune Etc/GMT+12: data OMISĂ → înregistrat %s (așteptat 2026-09-30)', :'d'));
SELECT teste.ceas_confirma(:'u_hr', :a1, false) AS d \gset
SELECT teste.assert(:'d'::date = date '2026-09-30', format('C2 sesiune Etc/GMT+12: NULL explicit → înregistrat %s (așteptat 2026-09-30)', :'d'));

-- C3: controale — azi București explicit trece; mâine București refuzat
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.reuseste(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date)', :a1, '2026-09-30'),
  'C3 sesiune Etc/GMT+12: 2026-09-30 explicit (azi București) acceptat');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L::date)', :a1, '2026-10-01'),
  'C3 2026-10-01 (mâine în București) → 22023', '22023', 'viitor');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) FILTER (WHERE data_confirmare = date '2026-09-30') = 5 AND count(*) = 5
                       FROM public.hr_autorizatii_rsvti_confirmari WHERE autorizatie_id = :a1),
  'C4 jurnalul: exact 5 confirmări, toate cu data 2026-09-30 (niciuna cu data sesiunii)');
ROLLBACK;
