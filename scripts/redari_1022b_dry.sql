-- scripts/redari_1022b_dry.sql — PR #1022, DRY 2: rulat în ACEEAȘI tranzacție, DUPĂ migrarea 20261131g (și după
-- scripts/redari_1022b_dry_inainte.sql; secvența completă e în antetul aceluia). Se termină cu ROLLBACK (îl dă cine rulează).
-- Măsoară din nou cele trei ipostaze (postgres · owner · non-owner cu drept Redări), verifică paritatea copiei din vederi cu funcțiile
-- vechi pe datele reale (L19: fn_red_parcela_acoperita_a, fn_red_adresa_cunoscuta ca sursă independentă) și compară bilateral
-- (EXCEPT ALL), pe fiecare (ipostază, vedere, proiect), amprentele rândurilor înainte / după. REFUZĂ (RAISE) dacă:
--   rândurile diferă în oricare ipostază · o combinație nu are rânduri · paritatea pică ·
--   o citire pe LOT1 ca utilizator logat (owner / non-owner) durează peste 5 s după fix.
-- Migrarea ține lock-uri pe tabelele Redări până la ROLLBACK: partea asta trebuie să fie scurtă (estimat sub 1 min după fix).
SET LOCAL statement_timeout = '1200s';
DO $pre$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'dry 1022b: rulati ca postgres'; END IF;
  IF to_regclass('pg_temp.dry1022b_rez') IS NULL OR to_regprocedure('pg_temp.dry1022b_masoara(text,text)') IS NULL THEN
    RAISE EXCEPTION 'dry 1022b: rulati intai scripts/redari_1022b_dry_inainte.sql in aceeasi tranzactie'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.dry1022b_timp WHERE faza = 'dupa') THEN RAISE EXCEPTION 'dry 1022b: scriptul „dupa” a rulat deja'; END IF;
  -- 31g aplicată: funcția nouă există, iar vederile nu mai cheamă funcțiile pe rând (căutare pe nume, nu pe formatare)
  IF to_regprocedure('public.fn_red_detinatori_cu_adresa()') IS NULL
     OR position('fn_red_detinatori_cu_adresa' IN pg_get_viewdef('public.red_v_stare_parcela'::regclass, true)) = 0
     OR position('fn_red_parcela_acoperita_a' IN pg_get_viewdef('public.red_v_stare_parcela'::regclass, true)) > 0
     OR position('fn_red_parcela_acoperita_a' IN pg_get_viewdef('public.red_v_tronson'::regclass, true)) > 0 THEN
    RAISE EXCEPTION 'dry 1022b: migrarea 20261131g nu e aplicata in aceasta tranzactie'; END IF;
END $pre$;
-- paritatea ramurii FARA_ADRESA_AFISARE față de fn_red_adresa_cunoscuta, în ipostaza curentă (poarta depinde de utilizator):
-- pe perechile ajunse la ramurile 11 / 12, alegerea 11 vs 12 o decide doar adresa
CREATE FUNCTION pg_temp.dry1022b_paritate_adresa(p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE m bigint; n bigint;
BEGIN
  IF p_rol <> 'postgres' AND auth.uid() IS NULL THEN RAISE NOTICE 'dry 1022b: paritate adresa % sarita (fara utilizator)', p_rol; RETURN; END IF;
  SELECT count(*), count(*) FILTER (WHERE (s.stare_ordine = 11) IS DISTINCT FROM (coalesce(public.fn_red_adresa_cunoscuta(s.detinator_id), false) = false))
    INTO m, n
    FROM public.red_v_stare_parcela s JOIN public.red_proiecte p ON p.id = s.proiect_id
   WHERE s.stare_ordine IN (11, 12) AND (p_rol = 'postgres' OR p.cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA'));
  RAISE NOTICE 'dry 1022b: paritate adresa (%): % perechi in ramurile 11/12, % diferente', p_rol, m, n;
  IF n <> 0 THEN RAISE EXCEPTION 'dry 1022b: % — ramura FARA_ADRESA_AFISARE difera de fn_red_adresa_cunoscuta pe % perechi', p_rol, n; END IF;
END $f$;
REVOKE ALL ON FUNCTION pg_temp.dry1022b_paritate_adresa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.dry1022b_paritate_adresa(text) TO authenticated;

-- 1. postgres, fără utilizator
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.dry1022b_masoara('dupa', 'postgres');
-- L19: copia corpului fn_red_parcela_acoperita_a din vederi = funcția, pe TOATE parcelele / perechile active (ca postgres)
DO $paritate$
DECLARE m bigint; n bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE (t.tip_pv IS NOT DISTINCT FROM 'A') IS DISTINCT FROM public.fn_red_parcela_acoperita_a(t.parcela_id))
    INTO m, n FROM public.red_v_tronson t;
  RAISE NOTICE 'dry 1022b: paritate acoperire A in red_v_tronson: % parcele, % diferente', m, n;
  IF m = 0 OR n <> 0 THEN RAISE EXCEPTION 'dry 1022b: red_v_tronson — acoperirea A difera de fn_red_parcela_acoperita_a (% din %)', n, m; END IF;
  SELECT count(*), count(*) FILTER (WHERE (s.stare = 'PV_A_ACOPERIT_PARCELA') IS DISTINCT FROM (s.pv_stare IS DISTINCT FROM 'semnat' AND public.fn_red_parcela_acoperita_a(s.parcela_id))
                                      OR (s.stare_ordine = 1) IS DISTINCT FROM coalesce(s.pv_stare = 'semnat' OR public.fn_red_parcela_acoperita_a(s.parcela_id), false))
    INTO m, n FROM public.red_v_stare_parcela s;
  RAISE NOTICE 'dry 1022b: paritate acoperire A in red_v_stare_parcela: % perechi, % diferente', m, n;
  IF m = 0 OR n <> 0 THEN RAISE EXCEPTION 'dry 1022b: red_v_stare_parcela — acoperirea A difera de fn_red_parcela_acoperita_a (% din %)', n, m; END IF;
END $paritate$;
SELECT pg_temp.dry1022b_paritate_adresa('postgres');
-- 2. authenticated cu JWT de owner
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', uid, 'role', 'authenticated')::text FROM pg_temp.dry1022b_util WHERE rol = 'owner'), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('dupa', 'owner');
SELECT pg_temp.dry1022b_explain('ROL owner DUPA');
SELECT pg_temp.dry1022b_paritate_adresa('owner');
RESET ROLE;
-- 3. authenticated cu JWT de non-owner cu drept Redări (sărit dacă nu există)
SELECT set_config('request.jwt.claims', coalesce((SELECT json_build_object('sub', uid, 'role', 'authenticated')::text FROM pg_temp.dry1022b_util WHERE rol = 'neowner'), ''), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('dupa', 'neowner');
SELECT pg_temp.dry1022b_paritate_adresa('neowner');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 4. comparația și refuzul
DO $compara$
DECLARE r record; n_ia bigint; n_ai bigint; n_in bigint; erori text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT rol, vedere, cod, max(randuri) FILTER (WHERE faza = 'inainte') AS rand_i, max(ms) FILTER (WHERE faza = 'inainte') AS ms_i,
                  max(randuri) FILTER (WHERE faza = 'dupa') AS rand_d, max(ms) FILTER (WHERE faza = 'dupa') AS ms_d
             FROM pg_temp.dry1022b_timp GROUP BY rol, vedere, cod ORDER BY rol, vedere, cod LOOP
    RAISE NOTICE 'TIMP % % %: inainte % ms (% randuri) -> dupa % ms (% randuri)', r.rol, r.vedere, r.cod, r.ms_i, r.rand_i, r.ms_d, r.rand_d;
  END LOOP;
  FOR r IN SELECT rol, vedere, cod, functie, sum(apeluri) FILTER (WHERE faza = 'inainte') AS ap_i, sum(apeluri) FILTER (WHERE faza = 'dupa') AS ap_d
             FROM pg_temp.dry1022b_apeluri GROUP BY rol, vedere, cod, functie HAVING sum(apeluri) <> 0 ORDER BY rol, vedere, cod, functie LOOP
    RAISE NOTICE 'APELURI % % % %: inainte % -> dupa %', r.rol, r.vedere, r.cod, r.functie, coalesce(r.ap_i, 0), coalesce(r.ap_d, 0);
  END LOOP;
  -- fiecare combinație măsurată în ambele faze
  IF EXISTS (SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'inainte' EXCEPT SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'dupa')
     OR EXISTS (SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'dupa' EXCEPT SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'inainte')
     OR (SELECT count(DISTINCT rol) FROM pg_temp.dry1022b_timp WHERE rol IN ('postgres', 'owner')) <> 2 THEN
    erori := erori || 'combinatii masurate doar intr-o faza / ipostaza postgres sau owner lipsa'::text; END IF;
  -- EXCEPT ALL bilateral pe amprente, pe fiecare (ipostază, vedere, proiect)
  FOR r IN SELECT DISTINCT rol, vedere, cod FROM pg_temp.dry1022b_timp ORDER BY 1, 2, 3 LOOP
    SELECT count(*) INTO n_ia FROM (SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = r.rol AND vedere = r.vedere AND cod = r.cod
                                    EXCEPT ALL SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'dupa' AND rol = r.rol AND vedere = r.vedere AND cod = r.cod) x;
    SELECT count(*) INTO n_ai FROM (SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'dupa' AND rol = r.rol AND vedere = r.vedere AND cod = r.cod
                                    EXCEPT ALL SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = r.rol AND vedere = r.vedere AND cod = r.cod) x;
    SELECT count(*) INTO n_in FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = r.rol AND vedere = r.vedere AND cod = r.cod;
    RAISE NOTICE 'RANDURI % % %: inainte %, inainte-dupa %, dupa-inainte %', r.rol, r.vedere, r.cod, n_in, n_ia, n_ai;
    IF n_ia <> 0 OR n_ai <> 0 THEN erori := erori || format('%s %s %s: randuri diferite inainte / dupa', r.rol, r.vedere, r.cod); END IF;
    -- fără rânduri comparația nu dovedește nimic (Jakarinos r4 P2 pe #1022)
    IF n_in = 0 THEN erori := erori || format('%s %s %s: fara randuri', r.rol, r.vedere, r.cod); END IF;
  END LOOP;
  -- control încrucișat: owner = postgres (owner-ul vede tot; ramura de adresă trece pe drumul nou, postgres pe funcția veche)
  FOR r IN SELECT DISTINCT vedere, cod FROM pg_temp.dry1022b_timp WHERE rol = 'owner' ORDER BY 1, 2 LOOP
    SELECT count(*) INTO n_ia FROM (SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'dupa' AND rol = 'owner' AND vedere = r.vedere AND cod = r.cod
                                    EXCEPT ALL SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'dupa' AND rol = 'postgres' AND vedere = r.vedere AND cod = r.cod) x;
    SELECT count(*) INTO n_ai FROM (SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'dupa' AND rol = 'postgres' AND vedere = r.vedere AND cod = r.cod
                                    EXCEPT ALL SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'dupa' AND rol = 'owner' AND vedere = r.vedere AND cod = r.cod) x;
    RAISE NOTICE 'OWNER=POSTGRES dupa % %: diferente % / %', r.vedere, r.cod, n_ia, n_ai;
    IF n_ia <> 0 OR n_ai <> 0 THEN
      -- refuz doar dacă înainte erau egale (altfel diferența nu vine din 31g)
      SELECT count(*) INTO n_in FROM ((SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = 'owner' AND vedere = r.vedere AND cod = r.cod
                                       EXCEPT ALL SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = 'postgres' AND vedere = r.vedere AND cod = r.cod)
                                      UNION ALL
                                      (SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = 'postgres' AND vedere = r.vedere AND cod = r.cod
                                       EXCEPT ALL SELECT amprenta FROM pg_temp.dry1022b_rez WHERE faza = 'inainte' AND rol = 'owner' AND vedere = r.vedere AND cod = r.cod)) x;
      IF n_in = 0 THEN erori := erori || format('owner <> postgres dupa fix pe %s %s (inainte erau egale)', r.vedere, r.cod); END IF;
    END IF;
  END LOOP;
  -- pragul: ecranele pe LOT1 ca utilizator logat, după fix
  FOR r IN SELECT rol, vedere, ms FROM pg_temp.dry1022b_timp WHERE faza = 'dupa' AND rol IN ('owner', 'neowner') AND cod = 'LOT1-PRUNISOR-JUPA' ORDER BY 1, 2 LOOP
    IF r.ms > 5000 THEN erori := erori || format('%s %s LOT1 = %s ms dupa fix (peste 5 s)', r.rol, r.vedere, r.ms); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_timp WHERE faza = 'dupa' AND rol = 'owner' AND cod = 'LOT1-PRUNISOR-JUPA' AND vedere = 'centralizator') THEN
    erori := erori || 'lipseste masuratoarea owner / centralizator / LOT1'::text; END IF;
  IF cardinality(erori) > 0 THEN RAISE EXCEPTION 'dry 1022b: NU se aplica — %', array_to_string(erori, ' | '); END IF;
  RAISE NOTICE 'dry 1022b: OK — aceleasi randuri in fiecare ipostaza, paritate OK, LOT1 sub 5 s ca utilizator logat';
END $compara$;
