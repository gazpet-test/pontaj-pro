-- Version 20261215140000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215c_izometrie_muta_pozitie — TKT-2026-0388: în editorul de izometrie, o piesă adăugată la final („+”) se mută dintr-o dată la
--   începutul pachetului (sau la poziția N), nu cu ↑ apăsat de N ori (N apeluri separate = mutare pe jumătate la o întrerupere).
-- Ce face: RPC-ul fn_executie_tevi_muta_pozitie(p_id, p_poz_noua) → jsonb. ATOMIC (un singur apel = o tranzacție):
--   1. identitatea (auth.uid(), L08) și dreptul de SCRIERE pe proiectul pachetului: fn_executie_nod_drept(proiect, true) — după 20261209a
--      include restricția de acces pe proiect (cont restrâns = doar proiectele lui). Țeavă inexistentă, invizibilă (RLS) sau fără drept =
--      ACELAȘI refuz, cu mesajul porții 20261209a, fără id-uri (L09);
--   2. blochează TOATE rândurile pachetului (FOR UPDATE, ORDER BY id) — o altă mutare / un schimb ↑↓ pe același pachet așteaptă (L01);
--   3. citește ordinea (poz_in_pachet, id) și mută piesa pas cu pas prin SCHIMBUL EXISTENT public.fn_executie_swap_tevi_pozitie (poarta
--      20261209a + originalul): gărzile, drepturile, mesajele și recalcularea POZ KM (trigger-ul de după schimb) sunt EXACT cele ale
--      butoanelor ↑ / ↓ — nimic nu e rescris aici. Pachetele în fluxul de montaj refuză schimbul (garda E4a), deci și mutarea;
--   4. postcondiție: ordinea finală = ordinea promisă (piesa pe poziția cerută, celelalte în aceeași ordine), altfel refuz și nimic nu
--      rămâne scris (ex. poziții duplicate în pachet).
-- De ce SECURITY INVOKER (nu DEFINER): rulează cu drepturile și RLS-ul apelantului, ca editorul de azi (care scrie direct executie_tevi);
--   singura scriere e prin schimbul existent. Nu e o funcție nouă cu drepturi de proprietar peste tabelele Execuției, deci nu lărgește
--   suprafața privilegiată inventariată de 20261209a.
-- Sondă de compatibilitate: apelul cu ambii parametri NULL întoarce {"disponibil": true} fără nicio citire / scriere (UI-ul o folosește ca
--   să știe dacă migrarea e aplicată; înainte de migrare butonul ⤒ apare dezactivat).
-- DEPENDENȚĂ: se aplică DUPĂ 20261209a (poarta pe proiect a schimbului, verificată mai jos cu amprenta corpului). Ordinea e impusă și de
--   20261209a: preflight-ul ei refuză orice funcție care numește fn_executie_swap_tevi_pozitie înaintea porții.
-- Ordinea lock-urilor (L06): rândurile pachetului din executie_tevi FOR UPDATE ORDER BY id -> (pentru fiecare pas) schimbul, care ia
--   FOR UPDATE pe cele două rânduri (deja ale noastre) și le scrie; trigger-ele de după schimb (POZ KM, gărzile izo) rulează ca la ↑ / ↓.
--   Un schimb ↑ / ↓ concurent pe același pachet blochează rândurile în ordinea argumentelor: un ciclu rar e oprit de detectorul de
--   deadlock (40P01), tranzacția pierzătoare nu lasă nimic scris.
-- Ce NU face: nicio dată, nicio coloană, niciun drept pe tabele, nicio schimbare a schimbului existent sau a trigger-elor.
-- Revenire: supabase/revenire/20261215c_izometrie_muta_pozitie_ROLLBACK.sql (DROP FUNCTION). Scenariul de probă pe clonă:
--   supabase/tests/20261215c_izometrie_muta_pozitie.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215c_izometrie_muta_pozitie:' || txid_current() THEN
    RAISE EXCEPTION '20261215c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215c: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_executie_tevi_muta_pozitie') THEN
    RAISE EXCEPTION '20261215c: fn_executie_tevi_muta_pozitie exista deja (reaplicare)';
  END IF;
  -- 20261209a aplicată: originalul schimbului în schema internă, iar în public poarta, cu amprenta corpului din 20261209a (fără CR)
  IF to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                     AND md5(replace(p.prosrc, chr(13), '')) = 'ab1f7875a2784791f9584580b71be38f'
                     AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                     AND p.prorettype = 'void'::regtype::oid AND pg_get_userbyid(p.proowner) = current_user
                     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_executie_swap_tevi_pozitie') <> 2 THEN
    RAISE EXCEPTION '20261215c: poarta 20261209a pe fn_executie_swap_tevi_pozitie lipseste sau difera (aplica intai 20261209a)';
  END IF;
  -- funcția de drept pe Execuție (după 20261209a: cu condiția de proiect): semnătura, tipul, DEFINER, apelabilă de authenticated
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)')
                  AND p.prosecdef AND p.prorettype = 'boolean'::regtype::oid
                  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261215c: fn_executie_nod_drept(bigint, boolean) lipseste sau difera';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION '20261215c: auth.uid() lipseste sau difera';
  END IF;
  -- tabelele și coloanele folosite (tipurile din semnătura schimbului: id bigint)
  IF to_regclass('public.executie_tevi') IS NULL OR to_regclass('public.executie_pachete_lansare') IS NULL
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_tevi'::regclass AND attname = 'id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_tevi'::regclass AND attname = 'pachet_id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_tevi'::regclass AND attname = 'poz_in_pachet' AND NOT attisdropped), '') NOT IN ('integer', 'smallint', 'bigint', 'numeric')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_pachete_lansare'::regclass AND attname = 'proiect_id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer') THEN
    RAISE EXCEPTION '20261215c: executie_tevi (id, pachet_id, poz_in_pachet) / executie_pachete_lansare.proiect_id difera';
  END IF;
  -- INVOKER: apelantul trebuie să poată citi și bloca (FOR UPDATE cere UPDATE) rândurile, ca editorul de azi; drepturile se verifică pe rând
  IF NOT has_table_privilege('authenticated', 'public.executie_tevi', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.executie_tevi', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.executie_pachete_lansare', 'SELECT') THEN
    RAISE EXCEPTION '20261215c: authenticated nu are SELECT / UPDATE pe executie_tevi sau SELECT pe executie_pachete_lansare';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_executie_tevi_muta_pozitie(p_id bigint, p_poz_noua integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE
  v_pachet bigint;
  v_proiect bigint;
  v_ids bigint[];
  v_final bigint[];
  v_asteptat bigint[];
  v_blocate integer;
  v_n integer;
  v_i integer;
  k integer;
BEGIN
  -- sonda de compatibilitate (UI): nimic citit, nimic scris
  IF p_id IS NULL AND p_poz_noua IS NULL THEN
    RETURN jsonb_build_object('disponibil', true);
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Execuție: autentificare necesară' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_poz_noua IS NULL THEN
    RAISE EXCEPTION 'Execuție: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  -- pachetul și proiectul, sub RLS-ul apelantului: inexistent = invizibil = fără drept (același refuz, L09)
  SELECT t.pachet_id::bigint INTO v_pachet FROM public.executie_tevi t WHERE t.id = p_id;
  IF v_pachet IS NOT NULL THEN
    SELECT k2.proiect_id::bigint INTO v_proiect FROM public.executie_pachete_lansare k2 WHERE k2.id = v_pachet;
  END IF;
  IF v_pachet IS NULL OR public.fn_executie_nod_drept(v_proiect, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
  END IF;
  -- L01 / L06: toate rândurile pachetului, ORDER BY id, înaintea citirii ordinii
  SELECT count(*) INTO v_blocate FROM (SELECT t.id FROM public.executie_tevi t WHERE t.pachet_id = v_pachet ORDER BY t.id FOR UPDATE) b;
  SELECT array_agg(t.id::bigint ORDER BY t.poz_in_pachet, t.id) INTO v_ids FROM public.executie_tevi t WHERE t.pachet_id = v_pachet;
  v_n := coalesce(cardinality(v_ids), 0);
  v_i := array_position(v_ids, p_id);
  IF v_i IS NULL OR v_blocate <> v_n THEN
    -- țeava a plecat din pachet între citire și lock, sau rânduri pe care apelantul nu le poate bloca
    RAISE EXCEPTION 'Execuție: pachetul s-a schimbat între timp (reîncarcă)' USING ERRCODE = '40001';
  END IF;
  IF p_poz_noua < 1 OR p_poz_noua > v_n THEN
    RAISE EXCEPTION 'Execuție: poziția trebuie să fie între 1 și %', v_n USING ERRCODE = '22023';
  END IF;
  -- ordinea promisă: piesa pe p_poz_noua, celelalte în aceeași ordine (același algoritm ca planMutare din src/izoMutaPozitie.js)
  v_asteptat := array_remove(v_ids, p_id);
  v_asteptat := v_asteptat[1:p_poz_noua - 1] || p_id || v_asteptat[p_poz_noua:v_n - 1];
  -- pas cu pas, prin schimbul existent (gărzi, drepturi, POZ KM); vecinul de la fiecare pas e cel din ordinea citită sub lock
  IF p_poz_noua < v_i THEN
    FOR k IN REVERSE v_i - 1 .. p_poz_noua LOOP
      PERFORM public.fn_executie_swap_tevi_pozitie(p_id, v_ids[k]);
    END LOOP;
  ELSIF p_poz_noua > v_i THEN
    FOR k IN v_i + 1 .. p_poz_noua LOOP
      PERFORM public.fn_executie_swap_tevi_pozitie(p_id, v_ids[k]);
    END LOOP;
  END IF;
  -- postcondiție (L20): altfel nimic nu rămâne scris
  SELECT array_agg(t.id::bigint ORDER BY t.poz_in_pachet, t.id) INTO v_final FROM public.executie_tevi t WHERE t.pachet_id = v_pachet;
  IF v_final IS DISTINCT FROM v_asteptat THEN
    RAISE EXCEPTION 'Execuție: ordinea rezultată diferă de cea cerută (poziții duplicate în pachet?) — nu s-a schimbat nimic' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('ok', true, 'poz_veche', v_i, 'poz_noua', p_poz_noua, 'schimburi', abs(v_i - p_poz_noua));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) TO authenticated;
COMMENT ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) IS
  'Izometrie: mută o piesă la poziția N în pachet, atomic, prin schimbul existent (gărzi + POZ KM). INVOKER. TKT-2026-0388, 20261215c.';

DO $post$
DECLARE v_fn regprocedure := to_regprocedure('public.fn_executie_tevi_muta_pozitie(bigint, integer)');
BEGIN
  IF v_fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                                  AND p.prorettype = 'jsonb'::regtype::oid AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = current_user) THEN
    RAISE EXCEPTION '20261215c: functia nu are proprietatile asteptate (INVOKER, search_path, jsonb)';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261215c: drepturile pe functie difera (doar authenticated)';
  END IF;
  -- nimic nu se leagă de poartă după OID (plpgsql: fără pg_depend), ca în verificarea 20261209a
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass
              AND d.refobjid IN (to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)'),
                                 to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)'))
              AND d.objid = v_fn) THEN
    RAISE EXCEPTION '20261215c: functia noua e legata dupa OID de schimb';
  END IF;
END $post$;
