-- scripts/redari_1022b_dry.sql — PR #1022, DRY 2: rulat în ACEEAȘI tranzacție, DUPĂ migrarea 20261131g (și după
-- scripts/redari_1022b_dry_inainte.sql; secvența completă și modul de rulare sunt în antetul aceluia). Se termină cu ROLLBACK.
-- Fereastra cu lock-uri (review Jakarinos r8 / r9 P2): migrarea ține lock-uri până la ROLLBACK; plafonul de 120 s e IMPUS:
--   ÎNAINTEA fiecărei instrucțiuni care citește date: SELECT pg_temp.dry1022b_buget(…) — refuz dacă bugetul s-a terminat, altfel
--   statement_timeout = min(30 s, timpul rămas) pentru instrucțiunea următoare; celelalte instrucțiuni (identitate, SET ROLE,
--   CREATE FUNCTION temporară) nu citesc date. În plus, bugetul se verifică după fiecare citire din interiorul funcțiilor;
--   pragul de 5 s pe LOT1 ca utilizator logat verificat IMEDIAT după fiecare citire (refuz pe loc, nu la final);
--   ordinea: întâi ipostazele cu utilizator (cele care pot depăși pragul), apoi postgres, parități, EXPLAIN.
-- REFUZĂ (RAISE) și dacă: rândurile diferă înainte / după în oricare ipostază · o combinație nu are rânduri · paritatea copiei
--   acoperirii pică · paritatea adresei are diferențe SAU nu are cazuri pe fiecare categorie (adresă da / adresă nu / fără contact)
--   SAU poarta închisă nu se comportă ca înainte · identitatea efectivă nu e cea anunțată.
SELECT pg_temp.dry1022b_buget('dupa migrare');
DO $pre$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'dry 1022b: rulati ca postgres'; END IF;
  IF to_regclass('pg_temp.dry1022b_rez') IS NULL OR to_regprocedure('pg_temp.dry1022b_masoara(text,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_ceas WHERE eticheta = 'start_migrare') THEN
    RAISE EXCEPTION 'dry 1022b: rulati intai scripts/redari_1022b_dry_inainte.sql in aceeasi tranzactie'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.dry1022b_timp WHERE faza = 'dupa') THEN RAISE EXCEPTION 'dry 1022b: scriptul „dupa” a rulat deja'; END IF;
  -- 31g aplicată: funcția nouă există, iar vederile nu mai cheamă funcțiile pe rând (căutare pe nume, nu pe formatare)
  IF to_regprocedure('public.fn_red_detinatori_cu_adresa()') IS NULL
     OR position('fn_red_detinatori_cu_adresa' IN pg_get_viewdef('public.red_v_stare_parcela'::regclass, true)) = 0
     OR position('fn_red_parcela_acoperita_a' IN pg_get_viewdef('public.red_v_stare_parcela'::regclass, true)) > 0
     OR position('fn_red_parcela_acoperita_a' IN pg_get_viewdef('public.red_v_tronson'::regclass, true)) > 0 THEN
    RAISE EXCEPTION 'dry 1022b: migrarea 20261131g nu e aplicata in aceasta tranzactie'; END IF;
END $pre$;
-- paritatea ramurii FARA_ADRESA_AFISARE: predicatul nou din vedere (NOT IN pe fn_red_detinatori_cu_adresa) față de rezultatul
-- funcției vechi salvat ÎNAINTE în aceeași ipostază, pe TOȚI deținătorii activi (nu doar pe cei ajunși la ramurile 11 / 12)
CREATE FUNCTION pg_temp.dry1022b_paritate_adresa(p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE m bigint; n bigint; c_da bigint; c_nu bigint; c_fara bigint; n_veche bigint; n_lista bigint; n_vedere bigint;
BEGIN
  IF NOT pg_temp.dry1022b_verifica(p_rol) THEN RAISE NOTICE 'dry 1022b: paritate adresa % sarita (niciun cont cu acest nivel)', p_rol; RETURN; END IF;
  SELECT count(*),
         count(*) FILTER (WHERE (a.detinator_id NOT IN (SELECT x.d FROM public.fn_red_detinatori_cu_adresa() x(d)))
                                  IS DISTINCT FROM (coalesce(a.veche, false) = false)),
         count(*) FILTER (WHERE a.categ = 'adresa_da'), count(*) FILTER (WHERE a.categ = 'adresa_nu'), count(*) FILTER (WHERE a.categ = 'fara_contact'),
         -- poarta închisă: veche NULL peste tot; deschisă: veche = true / false / NULL exact după categoria calculată ca postgres
         CASE WHEN p_rol = 'fara_drept' THEN count(*) FILTER (WHERE a.veche IS NOT NULL)
              ELSE count(*) FILTER (WHERE a.veche IS DISTINCT FROM CASE a.categ WHEN 'adresa_da' THEN true WHEN 'adresa_nu' THEN false END) END
    INTO m, n, c_da, c_nu, c_fara, n_veche
    FROM pg_temp.dry1022b_adresa a WHERE a.rol = p_rol;
  PERFORM pg_temp.dry1022b_buget(format('paritate adresa %s', p_rol));
  RAISE NOTICE 'dry 1022b: paritate adresa %: % detinatori (adresa da %, adresa nu %, fara contact %), % diferente', p_rol, m, c_da, c_nu, c_fara, n;
  IF n <> 0 THEN RAISE EXCEPTION 'dry 1022b: % — ramura FARA_ADRESA_AFISARE difera de fn_red_adresa_cunoscuta pe % detinatori', p_rol, n; END IF;
  IF c_da = 0 OR c_nu = 0 OR c_fara = 0 THEN
    RAISE EXCEPTION 'dry 1022b: % — paritate adresa NEACOPERITA (adresa da %, adresa nu %, fara contact %): proba nu dovedeste echivalenta', p_rol, c_da, c_nu, c_fara; END IF;
  IF p_rol = 'fara_drept' THEN
    -- poarta închisă: funcția veche dă NULL peste tot, lista nouă e goală, vederea nu arată nimic
    SELECT count(*) INTO n_lista FROM public.fn_red_detinatori_cu_adresa();
    SELECT count(*) INTO n_vedere FROM public.red_v_stare_parcela;
    PERFORM pg_temp.dry1022b_buget('poarta inchisa');
    RAISE NOTICE 'dry 1022b: poarta inchisa: % valori vechi nenule, % id-uri in lista noua, % randuri in vedere', n_veche, n_lista, n_vedere;
    IF n_veche <> 0 OR n_lista <> 0 OR n_vedere <> 0 THEN RAISE EXCEPTION 'dry 1022b: poarta inchisa nu se comporta ca inainte'; END IF;
  ELSIF n_veche <> 0 THEN
    RAISE EXCEPTION 'dry 1022b: % — functia veche nu corespunde categoriei pe % detinatori (poarta deschisa)', p_rol, n_veche;
  END IF;
END $f$;
REVOKE ALL ON FUNCTION pg_temp.dry1022b_paritate_adresa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.dry1022b_paritate_adresa(text) TO authenticated;

-- 1. ipostazele cu utilizator: întâi măsurarea (pragul și bugetul se verifică după fiecare citire), apoi paritatea adresei;
--    fiecare instrucțiune care citește date e precedată de bugetul care îi fixează statement_timeout = min(30 s, rămas)
SELECT pg_temp.dry1022b_identitate('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_buget('owner masurare');
SELECT pg_temp.dry1022b_masoara('dupa', 'owner');
SELECT pg_temp.dry1022b_buget('owner paritate adresa');
SELECT pg_temp.dry1022b_paritate_adresa('owner');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_buget('admin masurare');
SELECT pg_temp.dry1022b_masoara('dupa', 'admin');
SELECT pg_temp.dry1022b_buget('admin paritate adresa');
SELECT pg_temp.dry1022b_paritate_adresa('admin');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('editor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_buget('editor masurare');
SELECT pg_temp.dry1022b_masoara('dupa', 'editor');
SELECT pg_temp.dry1022b_buget('editor paritate adresa');
SELECT pg_temp.dry1022b_paritate_adresa('editor');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('viewer');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_buget('viewer masurare');
SELECT pg_temp.dry1022b_masoara('dupa', 'viewer');
SELECT pg_temp.dry1022b_buget('viewer paritate adresa');
SELECT pg_temp.dry1022b_paritate_adresa('viewer');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('fara_drept');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_buget('poarta inchisa');
SELECT pg_temp.dry1022b_paritate_adresa('fara_drept');
RESET ROLE;
-- 2. postgres, fără utilizator
SELECT pg_temp.dry1022b_identitate('postgres');
SELECT pg_temp.dry1022b_buget('postgres masurare');
SELECT pg_temp.dry1022b_masoara('dupa', 'postgres');
-- L19: copia corpului fn_red_parcela_acoperita_a din vederi = funcția, pe TOATE parcelele / perechile active (ca postgres);
-- o citire pe instrucțiune, fiecare cu bugetul înainte și după
SELECT pg_temp.dry1022b_buget('paritate acoperire tronson');
DO $paritate_tronson$
DECLARE m bigint; n bigint;
BEGIN
  PERFORM pg_temp.dry1022b_verifica('postgres');
  SELECT count(*), count(*) FILTER (WHERE (t.tip_pv IS NOT DISTINCT FROM 'A') IS DISTINCT FROM public.fn_red_parcela_acoperita_a(t.parcela_id))
    INTO m, n FROM public.red_v_tronson t;
  PERFORM pg_temp.dry1022b_buget('paritate acoperire tronson (dupa citire)');
  RAISE NOTICE 'dry 1022b: paritate acoperire A in red_v_tronson: % parcele, % diferente', m, n;
  IF m = 0 OR n <> 0 THEN RAISE EXCEPTION 'dry 1022b: red_v_tronson — acoperirea A difera de fn_red_parcela_acoperita_a (% din %)', n, m; END IF;
END $paritate_tronson$;
SELECT pg_temp.dry1022b_buget('paritate acoperire stare');
DO $paritate_stare$
DECLARE m bigint; n bigint;
BEGIN
  PERFORM pg_temp.dry1022b_verifica('postgres');
  SELECT count(*), count(*) FILTER (WHERE (s.stare = 'PV_A_ACOPERIT_PARCELA') IS DISTINCT FROM (s.pv_stare IS DISTINCT FROM 'semnat' AND public.fn_red_parcela_acoperita_a(s.parcela_id))
                                      OR (s.stare_ordine = 1) IS DISTINCT FROM coalesce(s.pv_stare = 'semnat' OR public.fn_red_parcela_acoperita_a(s.parcela_id), false))
    INTO m, n FROM public.red_v_stare_parcela s;
  PERFORM pg_temp.dry1022b_buget('paritate acoperire stare (dupa citire)');
  RAISE NOTICE 'dry 1022b: paritate acoperire A in red_v_stare_parcela: % perechi, % diferente', m, n;
  IF m = 0 OR n <> 0 THEN RAISE EXCEPTION 'dry 1022b: red_v_stare_parcela — acoperirea A difera de fn_red_parcela_acoperita_a (% din %)', n, m; END IF;
END $paritate_stare$;
-- 3. planul ca owner după fix (după ce pragul a trecut, deci rapid); bugetul și după fiecare proiect, în funcție
SELECT pg_temp.dry1022b_identitate('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_buget('explain');
SELECT pg_temp.dry1022b_explain('ROL owner DUPA', 'owner');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('postgres');

-- 4. comparația și refuzul (doar tabelele temporare ale probei)
SELECT pg_temp.dry1022b_buget('comparatie');
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
  RAISE NOTICE 'IPOSTAZE masurate: %; niveluri fara cont (nedovedite separat): %',
    (SELECT string_agg(DISTINCT rol, ', ') FROM pg_temp.dry1022b_timp),
    coalesce((SELECT string_agg(n, ', ') FROM unnest(ARRAY['admin', 'editor', 'viewer']) n WHERE NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_timp t WHERE t.rol = n)), 'niciunul');
  -- fiecare combinație măsurată în ambele faze
  IF EXISTS (SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'inainte' EXCEPT SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'dupa')
     OR EXISTS (SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'dupa' EXCEPT SELECT rol, vedere, cod FROM pg_temp.dry1022b_timp WHERE faza = 'inainte')
     OR (SELECT count(DISTINCT rol) FROM pg_temp.dry1022b_timp WHERE rol IN ('postgres', 'owner')) <> 2 THEN
    erori := erori || 'combinatii masurate doar intr-o faza / ipostaza postgres sau owner lipsa'::text; END IF;
  -- paritatea adresei a rulat în fiecare ipostază cu cont (inclusiv poarta închisă)
  IF EXISTS (SELECT 1 FROM pg_temp.dry1022b_util u WHERE NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_adresa a WHERE a.rol = u.rol)) THEN
    erori := erori || 'paritatea adresei lipseste pentru o ipostaza cu cont'::text; END IF;
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
  -- pragul (a doua oară, pe tot ce s-a măsurat): ecranele pe LOT1 ca utilizator logat, după fix
  FOR r IN SELECT rol, vedere, ms FROM pg_temp.dry1022b_timp WHERE faza = 'dupa' AND rol <> 'postgres' AND cod = 'LOT1-PRUNISOR-JUPA' ORDER BY 1, 2 LOOP
    IF r.ms > 5000 THEN erori := erori || format('%s %s LOT1 = %s ms dupa fix (peste 5 s)', r.rol, r.vedere, r.ms); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_timp WHERE faza = 'dupa' AND rol = 'owner' AND cod = 'LOT1-PRUNISOR-JUPA' AND vedere = 'centralizator') THEN
    erori := erori || 'lipseste masuratoarea owner / centralizator / LOT1'::text; END IF;
  IF cardinality(erori) > 0 THEN RAISE EXCEPTION 'dry 1022b: NU se aplica — %', array_to_string(erori, ' | '); END IF;
  PERFORM pg_temp.dry1022b_buget('comparatie');
  RAISE NOTICE 'dry 1022b: OK — aceleasi randuri in fiecare ipostaza, paritati OK (adresa pe toate categoriile, poarta inchisa), LOT1 sub 5 s ca utilizator logat, fereastra sub 120 s';
END $compara$;
