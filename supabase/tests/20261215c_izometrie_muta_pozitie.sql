-- Scenariu de probă pentru 20261215c_izometrie_muta_pozitie (TKT-2026-0388) — pentru coordonator, pe CLONĂ (nu pe producție).
-- Totul într-o tranzacție care se termină cu ROLLBACK: nimic nu rămâne scris.
-- Rulare (după 20261209a + 20261215c pe clonă), din rădăcina repo-ului:
--   A. AUTOSUFICIENT (r2; clona nu are date de izometrie): își creează în tranzacție un proiect, un pachet și 5 țevi fictive
--      (supabase/tests/20261215c_izometrie_date_sintetice.sql) și dă editorului, tot în tranzacție, modulul executie = 'editor':
--        psql -X -v ON_ERROR_STOP=1 -f supabase/tests/20261215c_izometrie_muta_pozitie.sql
--      Conturile implicite = identitățile sintetice ale clonei: editor 00000000-0000-4000-8000-000000000002 (NON-owner), străin
--      00000000-0000-4000-8000-000000000003 (fără drept pe proiect); se pot schimba cu -v editor=<uuid> -v strain=<uuid>.
--   B. Pe date existente (pachet real cu >= 3 țevi, în afara fluxului de montaj):
--        psql -X -v ON_ERROR_STOP=1 -v pachet=<id> -v editor=<uuid cu scriere pe proiect> -v strain=<uuid FĂRĂ drept> -f <acest fișier>
--   Concurența (două sesiuni, mutare vs. ↑ / ↓): scripts/izometrie_muta_pozitie_concurenta.sh.
-- Ce dovedește (ca editorul NON-owner, cu rolul authenticated și JWT-ul aplicației, L25):
--   T0 editorul vede tot pachetul și are drept de scriere, străinul nu (altfel proba nu dovedește nimic);
--   T1 mutarea ultimei piese la început = EXACT același rezultat (poz_in_pachet ȘI poz_km_m pe fiecare rând) ca ↑ apăsat de N-1 ori
--      prin schimbul existent, pornind de la aceeași stare (între cele două căi, T3 o readuce) — recalcularea POZ KM e a schimbului;
--   T2 ordinea promisă (piesa pe poziția 1, celelalte în aceeași ordine) — aceleași cazuri ca planMutare (src/izoMutaPozitie.test.js);
--   T3 mutarea înapoi la final readuce ordinea și pozițiile inițiale;
--   T4 refuzuri, cu SQLSTATE: poziția 0 / n+1 = 22023; cont fără drept = 42501 cu ACELAȘI mesaj ca o țeavă inexistentă (anti-oracol);
--      fără JWT = 42501; anon fără EXECUTE; ordinea neschimbată după refuzuri;
--   T5 sonda (NULL, NULL) = {"disponibil": true};
--   T6 mutarea la mijloc (prima → poziția 3) și pe loc (0 schimburi) = ordinea promisă.
\set ON_ERROR_STOP 1
BEGIN;
\if :{?pachet}
SELECT set_config('t.pachet', :'pachet', true), set_config('t.editor', :'editor', true), set_config('t.strain', :'strain', true),
       set_config('t.sintetic', 'nu', true);
\else
\if :{?editor}
\else
\set editor 00000000-0000-4000-8000-000000000002
\endif
\if :{?strain}
\else
\set strain 00000000-0000-4000-8000-000000000003
\endif
SELECT set_config('t.editor', :'editor', true), set_config('t.strain', :'strain', true), set_config('t.sintetic', 'da', true);
\ir 20261215c_izometrie_date_sintetice.sql
\endif
DO $garda$ BEGIN
  IF to_regprocedure('public.fn_executie_tevi_muta_pozitie(bigint, integer)') IS NULL THEN RAISE EXCEPTION 'FAIL: 20261215c nu e aplicata'; END IF;
  IF (SELECT count(*) FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint) < 3 THEN
    RAISE EXCEPTION 'FAIL: pachetul ales are mai putin de 3 tevi';
  END IF;
  IF current_setting('t.editor') = current_setting('t.strain') THEN RAISE EXCEPTION 'FAIL: editorul si strainul sunt acelasi cont'; END IF;
END $garda$;
CREATE TEMP TABLE t_toate ON COMMIT DROP AS
  SELECT id FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint;
GRANT SELECT ON t_toate TO authenticated;

-- ca editorul (rolul și JWT-ul aplicației)
SELECT set_config('request.jwt.claim.sub', current_setting('t.editor'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('t.editor'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- T0: editorul vede tot pachetul și are drept de scriere pe proiect; străinul nu are drept (fără asta T4 nu dovedește nimic)
DO $t0$
DECLARE v_proiect bigint;
BEGIN
  IF (SELECT count(*) FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint) <> (SELECT count(*) FROM t_toate) THEN
    RAISE EXCEPTION 'FAIL T0: editorul nu vede toate tevile pachetului (RLS) - alege alt cont';
  END IF;
  SELECT proiect_id INTO v_proiect FROM public.executie_pachete_lansare WHERE id = current_setting('t.pachet')::bigint;
  IF public.fn_executie_nod_drept(v_proiect, true) IS NOT TRUE THEN RAISE EXCEPTION 'FAIL T0: editorul nu are drept de scriere pe proiect'; END IF;
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.strain'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('t.strain'), 'role', 'authenticated')::text, true);
  IF public.fn_executie_nod_drept(v_proiect, true) IS TRUE THEN RAISE EXCEPTION 'FAIL T0: strainul are drept de scriere pe proiect - alege alt cont'; END IF;
  PERFORM set_config('request.jwt.claim.sub', current_setting('t.editor'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('t.editor'), 'role', 'authenticated')::text, true);
  RAISE NOTICE 'OK T0 editorul vede pachetul si poate scrie, strainul nu (date sintetice: %)', current_setting('t.sintetic');
END $t0$;

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
DECLARE v_asteptat bigint[] := ARRAY[(SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1)] || ARRAY(SELECT id FROM t_initial WHERE id <> (SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1) ORDER BY rn);
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
  IF NOT EXISTS (SELECT 1 FROM t_cale_a WHERE poz_km_m IS NOT NULL) THEN
    RAISE NOTICE 'ATENTIE T1: poz_km_m e NULL pe toate randurile (POZ KM nu s-a calculat pe aceste date): paritatea POZ KM e triviala aici';
  END IF;
  RAISE NOTICE 'OK T1 mutarea = ↑ de N-1 ori (poz_in_pachet si poz_km_m identice)';
  -- ordinea inițială înapoi, pentru T4
  PERFORM public.fn_executie_tevi_muta_pozitie((SELECT id FROM t_initial ORDER BY rn DESC LIMIT 1), (SELECT count(*)::int FROM t_initial));
END $t1c$;

-- T4: refuzuri
DO $t4$
DECLARE v_id bigint := (SELECT id FROM t_initial ORDER BY rn LIMIT 1); v_n int := (SELECT count(*) FROM t_initial); v_msg text; v_msg_inex text;
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

-- T6: mutarea la mijloc (prima → 3) și pe loc (0 schimburi)
DO $t6$
DECLARE v_prima bigint := (SELECT id FROM t_initial ORDER BY rn LIMIT 1); v_asteptat bigint[]; r jsonb;
BEGIN
  v_asteptat := ARRAY(SELECT id FROM t_initial WHERE rn IN (2, 3) ORDER BY rn) || v_prima || ARRAY(SELECT id FROM t_initial WHERE rn > 3 ORDER BY rn);
  r := public.fn_executie_tevi_muta_pozitie(v_prima, 3);
  IF (r ->> 'schimburi')::int <> 2 OR ARRAY(SELECT id FROM public.executie_tevi WHERE pachet_id = current_setting('t.pachet')::bigint ORDER BY poz_in_pachet, id)
     IS DISTINCT FROM v_asteptat THEN RAISE EXCEPTION 'FAIL T6: mutarea la mijloc (% / %)', r, v_asteptat; END IF;
  r := public.fn_executie_tevi_muta_pozitie(v_prima, 3);
  IF (r ->> 'schimburi')::int <> 0 THEN RAISE EXCEPTION 'FAIL T6: mutarea pe loc a facut schimburi (%)', r; END IF;
  RAISE NOTICE 'OK T6 mutarea la mijloc si pe loc';
  RAISE NOTICE 'OK - toate testele 20261215c au trecut';
END $t6$;
ROLLBACK;
