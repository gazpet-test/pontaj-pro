-- Scenariu de probă pentru 20261215c_izometrie_muta_pozitie (TKT-2026-0388) — pentru coordonator, pe CLONĂ (nu pe producție).
-- Totul într-o tranzacție care se termină cu ROLLBACK: nimic nu rămâne scris.
-- Rulare (după 20261209a + 20261215c pe clonă):
--   psql -X -v ON_ERROR_STOP=1 -v pachet=<id pachet cu >= 3 țevi, în afara fluxului de montaj> \
--        -v editor=<uuid cont cu scriere pe proiectul pachetului> -v strain=<uuid cont FĂRĂ drept pe proiect> \
--        -f supabase/tests/20261215c_izometrie_muta_pozitie.sql
-- Ce dovedește:
--   T1 mutarea ultimei piese la început = EXACT același rezultat (poz_in_pachet ȘI poz_km_m pe fiecare rând) ca ↑ apăsat de N-1 ori
--      prin schimbul existent, pornind de la aceeași stare (între cele două căi, T3 o readuce) — recalcularea POZ KM e a schimbului;
--   T2 ordinea promisă (piesa pe poziția 1, celelalte în aceeași ordine) — aceleași cazuri ca planMutare (src/izoMutaPozitie.test.js);
--   T3 mutarea înapoi la final readuce ordinea și pozițiile inițiale;
--   T4 refuzuri, cu SQLSTATE: poziția 0 / n+1 = 22023; cont fără drept = 42501 cu ACELAȘI mesaj ca o țeavă inexistentă; fără JWT = 42501;
--      anon fără EXECUTE; ordinea neschimbată după refuzuri;
--   T5 sonda (NULL, NULL) = {"disponibil": true}.
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('t.pachet', :'pachet', true), set_config('t.editor', :'editor', true), set_config('t.strain', :'strain', true);
DO $garda$ BEGIN
  IF to_regprocedure('public.fn_executie_tevi_muta_pozitie(bigint, integer)') IS NULL THEN RAISE EXCEPTION 'FAIL: 20261215c nu e aplicata'; END IF;
  IF (SELECT count(*) FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint) < 3 THEN
    RAISE EXCEPTION 'FAIL: pachetul ales are mai putin de 3 tevi';
  END IF;
END $garda$;

-- ca editorul (rolul și JWT-ul aplicației)
SELECT set_config('request.jwt.claim.sub', current_setting('t.editor'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('t.editor'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE t_initial ON COMMIT DROP AS
  SELECT id, poz_in_pachet, poz_km_m, row_number() OVER (ORDER BY poz_in_pachet, id) AS rn
    FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint;

-- T1: calea A (RPC-ul nou) vs calea B (↑ de N-1 ori), pe aceeași stare inițială (între ele, T3 readuce ordinea inițială)
DO $t1a$
DECLARE v_ultim bigint := (SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1); r jsonb;
BEGIN
  r := public.fn_executie_tevi_muta_pozitie(v_ultim, 1);
  IF (r ->> 'ok')::boolean IS NOT TRUE OR (r ->> 'poz_noua')::int <> 1 THEN RAISE EXCEPTION 'FAIL T1a: rezultat %', r; END IF;
END $t1a$;
CREATE TEMP TABLE t_cale_a ON COMMIT DROP AS
  SELECT id, poz_in_pachet, poz_km_m FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint;
-- T2: ordinea promisă
DO $t2$
DECLARE v_ultim bigint := (SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1);
  v_asteptat bigint[] := ARRAY[(SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1)] || ARRAY(SELECT id FROM t_initial WHERE id <> (SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1) ORDER BY rn);
  v_final bigint[] := ARRAY(SELECT id FROM t_cale_a ORDER BY poz_in_pachet, id);
BEGIN
  IF v_final IS DISTINCT FROM v_asteptat THEN RAISE EXCEPTION 'FAIL T2: ordinea % <> %', v_final, v_asteptat; END IF;
  RAISE NOTICE 'OK T2 ordinea promisa (%)', v_final;
END $t2$;
-- T3: înapoi la final = ordinea și pozițiile inițiale
DO $t3$
DECLARE v_ultim bigint := (SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1); v_n int := (SELECT count(*) FROM t_initial);
BEGIN
  PERFORM public.fn_executie_tevi_muta_pozitie(v_ultim, v_n);
  IF EXISTS (SELECT id, poz_in_pachet FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint
             EXCEPT SELECT id, poz_in_pachet FROM t_initial) THEN RAISE EXCEPTION 'FAIL T3: ordinea nu a revenit'; END IF;
  RAISE NOTICE 'OK T3 dus-intors = ordinea initiala';
END $t3$;
DO $t1b$
DECLARE v_ultim bigint := (SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1); v_vecin bigint; k int;
BEGIN
  FOR k IN 1 .. (SELECT count(*) FROM t_initial) - 1 LOOP
    SELECT t.id INTO v_vecin FROM public.executie_tevi t WHERE t.pachet_id = current_setting('t.pachet')::bigint
      AND (t.poz_in_pachet, t.id) < (SELECT poz_in_pachet, id FROM public.executie_tevi WHERE id = v_ultim) ORDER BY t.poz_in_pachet DESC, t.id DESC LIMIT 1;
    PERFORM public.fn_executie_swap_tevi_pozitie(v_ultim, v_vecin);   -- exact ce face butonul ↑
  END LOOP;
END $t1b$;
DO $t1c$
DECLARE v_dif integer;
BEGIN
  SELECT count(*) INTO v_dif FROM (
    (SELECT id, poz_in_pachet, poz_km_m FROM t_cale_a EXCEPT SELECT id, poz_in_pachet, poz_km_m FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint)
    UNION ALL
    (SELECT id, poz_in_pachet, poz_km_m FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint EXCEPT SELECT id, poz_in_pachet, poz_km_m FROM t_cale_a)) d;
  IF v_dif <> 0 THEN RAISE EXCEPTION 'FAIL T1: mutarea difera de ↑ x N pe % randuri (poz_in_pachet / poz_km_m)', v_dif; END IF;
  RAISE NOTICE 'OK T1 mutarea = ↑ de N-1 ori (poz_in_pachet si poz_km_m identice)';
  -- ordinea inițială înapoi, pentru T4
  PERFORM public.fn_executie_tevi_muta_pozitie((SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1), (SELECT count(*)::int FROM t_initial));
END $t1c$;

-- T4: refuzuri
DO $t4$
DECLARE v_id bigint := (SELECT id FROM t_initial ORDER BY rn LIMIT 1); v_n int := (SELECT count(*) FROM t_initial); v_st text; v_msg text; v_msg_inex text;
BEGIN
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(v_id, 0); RAISE EXCEPTION 'FAIL T4: poz 0 acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'OK T4 poz 0 = 22023'; END;
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(v_id, v_n + 1); RAISE EXCEPTION 'FAIL T4: poz n+1 acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'OK T4 poz n+1 = 22023'; END;
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(-1, 1); RAISE EXCEPTION 'FAIL T4: id inexistent acceptat';
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS v_msg_inex = MESSAGE_TEXT; END;
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.strain'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('t.strain'), 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(v_id, 2); RAISE EXCEPTION 'FAIL T4: cont fara drept acceptat';
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT; END;
  IF v_msg IS DISTINCT FROM v_msg_inex THEN RAISE EXCEPTION 'FAIL T4: mesaje diferite (fara drept: % / inexistent: %)', v_msg, v_msg_inex; END IF;
  RAISE NOTICE 'OK T4 cont fara drept = acelasi 42501 ca inexistent';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(v_id, 2); RAISE EXCEPTION 'FAIL T4: fara JWT acceptat';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK T4 fara JWT = 42501'; END;
  -- înapoi editorul (altfel RLS-ul ascunde rândurile la verificarea de mai jos)
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.editor'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('t.editor'), 'role', 'authenticated')::text, true);
  IF has_function_privilege('anon', 'public.fn_executie_tevi_muta_pozitie(bigint, integer)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL T4: anon are EXECUTE'; END IF;
  IF ARRAY(SELECT id FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint ORDER BY poz_in_pachet, id)
     IS DISTINCT FROM ARRAY(SELECT id FROM t_initial ORDER BY rn) THEN RAISE EXCEPTION 'FAIL T4: ordinea s-a schimbat dupa refuzuri'; END IF;
  RAISE NOTICE 'OK T4 ordinea neschimbata dupa refuzuri';
  IF (public.fn_executie_tevi_muta_pozitie(NULL, NULL) ->> 'disponibil')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL T5: sonda'; END IF;
  RAISE NOTICE 'OK T5 sonda';
END $t4$;
ROLLBACK;
