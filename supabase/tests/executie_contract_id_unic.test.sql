-- ============================================================================
-- 20261030b — un contract ↔ cel mult un proiect (TKT-2026-0333, review Jakarinos r1 P1). Date FICTIVE, PG local *_test.
-- Rulat de scripts/test_executie_contract_id_unic.sh DUPĂ aplicarea migrării pe executie_contract_id_unic_schelet.sql.
-- Fiecare acțiune: subtranzacție anulată (nu rămâne nimic). Aserțiune picată → 'ESEC TEST: …'; la final SUITA_OK.
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

-- rulează p_sql ca (rol, uid); întoarce 'ok:<rânduri>' sau 'err:<SQLSTATE>'; mereu anulat
CREATE FUNCTION pg_temp.efect(p_rol text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; s text; m bigint; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_rol)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    n := 0;
    FOREACH s IN ARRAY string_to_array(p_sql, ';;') LOOP
      EXECUTE s; GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
    END LOOP;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ok:' || n;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF; RAISE NOTICE 'OK %', p_nume; END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real, 'NULL') || ' vs ' || p_astept || ']'); END $$;

DO $t$
DECLARE
  u text := '00000000-0000-0000-0000-0000000000e1';
  amprenta0 text := (SELECT string_agg(id || ':' || coalesce(contract_id::text, '-'), ',' ORDER BY id) FROM public.executie_proiecte);
BEGIN
  -- T1 indexul: unic, valid, parțial pe contract_id IS NOT NULL
  PERFORM pg_temp.ok(EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'executie_proiecte_contract_id_unic' AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (contract_id) WHERE (contract_id IS NOT NULL)'),
    'T1 index unic parțial pe executie_proiecte(contract_id)');

  -- T2 butonul „Leagă” din Execuție pe un contract deja legat (108 → proiectul 27): 23505, nimic schimbat
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', u,
    'UPDATE public.executie_proiecte SET contract_id = 108, updated_at = now() WHERE id = 6 AND contract_id IS NULL'),
    'err:23505', 'T2 a doua legare a contractului 108 → 23505');

  -- T3 „Leagă” pe un contract liber: un rând
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', u,
    'UPDATE public.executie_proiecte SET contract_id = 200, updated_at = now() WHERE id = 7 AND contract_id IS NULL'),
    'ok:1', 'T3 legarea contractului liber 200 → 1 rând');

  -- T4 cursa: două sesiuni leagă același contract liber (201) de două proiecte — a doua cade
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', u,
    'UPDATE public.executie_proiecte SET contract_id = 201 WHERE id = 6 AND contract_id IS NULL;;'
    || 'UPDATE public.executie_proiecte SET contract_id = 201 WHERE id = 7 AND contract_id IS NULL'),
    'err:23505', 'T4 aceeași legare din două sesiuni → a doua 23505');

  -- T5 NULL rămâne liber: oricâte proiecte fără contract (dezlegare 27 și 32)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', u,
    'UPDATE public.executie_proiecte SET contract_id = NULL WHERE id IN (27, 32)'),
    'ok:2', 'T5 mai multe proiecte cu contract_id NULL');

  -- T6 fluxul din Administrativ (întâi dezleagă celelalte proiecte, apoi leagă): mutarea 108 de pe 27 pe 40 trece
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', u,
    'UPDATE public.executie_proiecte SET contract_id = NULL WHERE contract_id = 108 AND id <> 40;;'
    || 'UPDATE public.executie_proiecte SET contract_id = 108 WHERE id = 40'),
    'ok:2', 'T6 Administrativ: dezleagă + leagă (mutare) → 2 rânduri');

  -- T7 un proiect nou cu un contract deja legat (INSERT) cade la fel
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', u,
    'INSERT INTO public.executie_proiecte (nume, cod_intern, contract_id) VALUES (''Nou'', ''NOU_TEST'', 110)'),
    'err:23505', 'T7 INSERT cu contract deja legat → 23505');

  -- T8 nimic nu a rămas modificat
  PERFORM pg_temp.eq((SELECT string_agg(id || ':' || coalesce(contract_id::text, '-'), ',' ORDER BY id) FROM public.executie_proiecte),
    amprenta0, 'T8 datele fixture neatinse');
END $t$;

ROLLBACK;
\echo SUITA_OK
