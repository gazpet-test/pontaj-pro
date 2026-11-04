-- DRY 20261130g_redari_rls_initplan — PASUL 2 din 2 („după”). Runner (o singură tranzacție ANULATĂ; ordinea completă e în capul fișierului
-- 20261130g_redari_rls_initplan_dryrun_inainte.sql):  BEGIN; GUC; \i ..._dryrun_inainte.sql; \i migrare; \i acest fișier; [revenire]; ROLLBACK.
-- Folosește funcțiile / tabelele temp create de pasul 1 (pg_temp.r30g_*). Probele de scriere rulează într-o subtranzacție anulată explicit,
-- deci instantaneul „revenire” se poate compara cu „înainte”. La final rolul e resetat (RESET ROLE) și claims-urile golite.
-- TEST0  garda + pasul 1 rulat + politicile în forma nouă.
-- TEST1  rânduri văzute (număr + md5 pe proiecția coloanelor permise + refuz) IDENTICE înainte / după, pe fiecare identitate × tabel / view red_*.
-- TEST2  așteptări independente (din definiția nivelurilor, nu din instantaneu): owner / admin / editor văd tot; viewer vede tot în afară de
--        contact / token / meta și de jurnalul pe contact / meta; fără acces și anon nu văd nimic; coloanele fără GRANT (ex. valoare_lei)
--        rămân refuzate (42501) pentru TOATE identitățile aplicației.
-- TEST3  EXPLAIN ca viewer pe red_v_centralizator_uat și red_v_stare_parcela: InitPlan prezent, niciun Filter cu fn_red_nivel() per rând.
-- TEST4  deciziile de scriere identice înainte / după ȘI egale cu rezultatul EXACT așteptat (fără „orice eroare ≠ 42501”).
-- TEST5  interogările reale ale aplicației: același rezultat (md5) înainte / după + timpi (NOTICE) + curățenie rol / claims.

-- TEST0
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  IF to_regclass('pg_temp.r30g_snap') IS NULL THEN
    RAISE EXCEPTION 'TEST0 FAIL: lipseste instantaneul inainte (ruleaza intai 20261130g_redari_rls_initplan_dryrun_inainte.sql, inaintea migrarii)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.r30g_snap WHERE faza = 'inainte') OR NOT EXISTS (SELECT 1 FROM pg_temp.r30g_scr WHERE faza = 'inainte') THEN
    RAISE EXCEPTION 'TEST0 FAIL: instantaneul / probele inainte lipsesc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.red_uat'::regclass AND p.polname = 'red_uat_sel'
                  AND pg_get_expr(p.polqual, p.polrelid) = '(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)') THEN
    RAISE EXCEPTION 'TEST0 FAIL: migrarea nu a fost aplicata in tranzactie';
  END IF;
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1
SELECT pg_temp.r30g_numara('dupa');
SELECT pg_temp.r30g_compara('inainte', 'dupa');
DO $t$ BEGIN RAISE NOTICE 'TEST1 OK'; END $t$;

-- TEST2: asteptari independente, pe instantaneul „dupa”
DO $t$
DECLARE v_dif text[]; v_refuz integer;
BEGIN
  WITH ae(obiect) AS (VALUES ('red_detinatori_contact'), ('red_detinatori_token'), ('red_raspunsuri_meta')),   -- SELECT doar admin / editor (26a / 29a)
  -- tabele fara politica de SELECT (RLS activ, acces doar prin RPC): nimeni din aplicatie nu le vede
  fara_pol(obiect) AS (SELECT c.relname::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'red\_%'
                        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('r', '*'))),
  ref AS (SELECT obiect, n FROM pg_temp.r30g_snap WHERE faza = 'dupa' AND eticheta = 'postgres'),
  jur AS (SELECT count(*) AS n FROM public.red_jurnal WHERE tabela NOT IN ('red_detinatori_contact', 'red_raspunsuri_meta')),
  astept AS (
    SELECT s.eticheta, s.obiect, s.n, s.eroare,
           CASE WHEN s.obiect LIKE '%.%' THEN -1                                               -- coloana fara GRANT: refuz obligatoriu
                WHEN c.relkind = 'v' THEN NULL                                                 -- view-urile: acoperite de TEST1 / TEST5
                WHEN s.eticheta = 'anon' THEN 0
                WHEN s.obiect IN (SELECT obiect FROM fara_pol) THEN 0
                WHEN s.eticheta IN ('owner', 'admin', 'editor') THEN r.n
                WHEN s.eticheta = 'viewer' AND s.obiect IN (SELECT obiect FROM ae) THEN 0
                WHEN s.eticheta = 'viewer' AND s.obiect = 'red_jurnal' THEN (SELECT n FROM jur)
                WHEN s.eticheta = 'viewer' THEN r.n
                ELSE 0 END AS n_astept
      FROM pg_temp.r30g_snap s JOIN ref r ON r.obiect = s.obiect
      LEFT JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname = s.obiect
     WHERE s.faza = 'dupa' AND s.eticheta <> 'postgres')
  SELECT array_agg(eticheta || '/' || obiect || '=' || coalesce(n::text, 'err:' || eroare) || '<>' || n_astept ORDER BY eticheta, obiect) INTO v_dif
    FROM astept
   WHERE n_astept IS NOT NULL
     AND NOT CASE WHEN n_astept = -1 THEN n IS NULL AND eroare = '42501'
                  ELSE n IS NOT DISTINCT FROM n_astept OR (n_astept = 0 AND n IS NULL AND eroare = '42501') END;   -- „nu vede” = 0 randuri sau permission denied
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'TEST2 FAIL: vizibilitate diferita de asteptari: %', v_dif; END IF;
  -- cel putin un tabel citit cu succes de editor (altfel TEST2 ar trece pe un instantaneu plin de refuzuri)
  IF NOT EXISTS (SELECT 1 FROM pg_temp.r30g_snap WHERE faza = 'dupa' AND eticheta = 'editor' AND obiect = 'red_parcele' AND n IS NOT NULL AND n > 0) THEN
    RAISE EXCEPTION 'TEST2 FAIL: editorul nu citeste red_parcele (proiectia coloanelor permise)';
  END IF;
  SELECT count(*) INTO v_refuz FROM pg_temp.r30g_snap WHERE faza = 'dupa' AND obiect LIKE '%.%' AND eticheta <> 'postgres';
  RAISE NOTICE 'TEST2 OK (viewer: contact / token / meta = 0, jurnal fara contact / meta; fara acces + anon = nimic; % refuzuri de coloana verificate)', v_refuz;
END $t$;

-- TEST3: EXPLAIN ca viewer
DO $t$
DECLARE v_vw uuid := (SELECT uid FROM pg_temp.r30g_id WHERE eticheta = 'viewer'); r record; o text; v_init boolean; v_per_rand text[];
BEGIN
  FOREACH o IN ARRAY ARRAY['red_v_centralizator_uat', 'red_v_stare_parcela'] LOOP
    v_init := false; v_per_rand := NULL;
    PERFORM pg_temp.r30g_ca(v_vw, 'authenticated');
    FOR r IN EXECUTE format('EXPLAIN (COSTS OFF) SELECT * FROM public.%I', o) LOOP
      IF r."QUERY PLAN" LIKE '%InitPlan%' THEN v_init := true; END IF;
      IF r."QUERY PLAN" LIKE '%Filter:%fn_red_nivel()%' AND r."QUERY PLAN" NOT LIKE '%(InitPlan%' THEN v_per_rand := v_per_rand || btrim(r."QUERY PLAN"); END IF;
    END LOOP;
    PERFORM pg_temp.r30g_ca(NULL, 'postgres');
    IF NOT v_init OR v_per_rand IS NOT NULL THEN RAISE EXCEPTION 'TEST3 FAIL (%): InitPlan=% , filtre per rand: %', o, v_init, v_per_rand; END IF;
  END LOOP;
  RAISE NOTICE 'TEST3 OK (red_v_centralizator_uat, red_v_stare_parcela ca viewer: InitPlan, fara fn_red_nivel() per rand)';
END $t$;

-- TEST4: deciziile de scriere (subtranzactie anulata: nimic nu ramane)
SELECT pg_temp.r30g_probe('dupa');
DO $t$
DECLARE v_dif text[];
BEGIN
  -- (a) identice inainte / dupa
  SELECT array_agg(coalesce(a.eticheta, b.eticheta) || '/' || coalesce(a.proba, b.proba) || ': ' || coalesce(a.rez, '-') || ' -> ' || coalesce(b.rez, '-') ORDER BY 1) INTO v_dif
    FROM (SELECT * FROM pg_temp.r30g_scr WHERE faza = 'inainte') a
    FULL JOIN (SELECT * FROM pg_temp.r30g_scr WHERE faza = 'dupa') b ON b.eticheta = a.eticheta AND b.proba = a.proba
   WHERE a.rez IS DISTINCT FROM b.rez;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'TEST4 FAIL: decizii de scriere diferite inainte / dupa: %', v_dif; END IF;
  -- (b) rezultatul EXACT asteptat, din definitia nivelurilor (A = owner/admin, AE = owner/admin/editor; anon nu are GRANT pe aceste tabele)
  WITH astept(eticheta, proba, rez) AS (
    SELECT e, p, CASE
      WHEN e = 'anon' THEN 'err:42501'
      WHEN p = 'uat_upd'  THEN CASE WHEN e IN ('owner', 'admin') THEN 'rows:1' ELSE 'rows:0' END
      WHEN p = 'parc_upd' THEN CASE WHEN e IN ('owner', 'admin', 'editor') THEN 'rows:1' ELSE 'rows:0' END
      WHEN p = 'pr_dup'   THEN CASE WHEN e IN ('owner', 'admin') THEN 'err:23505' ELSE 'err:42501' END   -- WITH CHECK trece -> unicitate
      WHEN p = 'pr_nou'   THEN CASE WHEN e IN ('owner', 'admin') THEN 'rows:1' ELSE 'err:42501' END END
      FROM unnest(ARRAY['owner', 'admin', 'editor', 'viewer', 'fara_acces', 'anon']) e, unnest(ARRAY['uat_upd', 'parc_upd', 'pr_dup', 'pr_nou']) p)
  SELECT array_agg(x.eticheta || '/' || x.proba || ': ' || coalesce(s.rez, '-') || ' <> ' || x.rez ORDER BY 1) INTO v_dif
    FROM astept x LEFT JOIN pg_temp.r30g_scr s ON s.faza = 'dupa' AND s.eticheta = x.eticheta AND s.proba = x.proba
   WHERE s.rez IS DISTINCT FROM x.rez;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'TEST4 FAIL: decizii diferite de asteptari: %', v_dif; END IF;
  RAISE NOTICE 'TEST4 OK (24 probe identice inainte / dupa si egale cu asteptarile; scrierile probelor anulate)';
END $t$;
SELECT pg_temp.r30g_numara('dupa_probe');
SELECT pg_temp.r30g_compara('dupa', 'dupa_probe');   -- probele nu au lasat nimic in urma

-- TEST5: interogarile reale ale aplicatiei (acelasi rezultat) + timpi + curatenie
SELECT pg_temp.r30g_cronometreaza('dupa');
DO $t$
DECLARE v_dif text[];
BEGIN
  SELECT array_agg(a.obiect ORDER BY a.obiect) INTO v_dif FROM pg_temp.r30g_timp a FULL JOIN pg_temp.r30g_timp b ON b.obiect = a.obiect AND b.faza = 'dupa'
   WHERE a.faza = 'inainte' AND (b.obiect IS NULL OR a.h IS DISTINCT FROM b.h);
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'TEST5 FAIL: interogarile aplicatiei dau alt rezultat dupa migrare: %', v_dif; END IF;
  RAISE NOTICE 'DRY30g timpi viewer (ms): %', (SELECT jsonb_object_agg(a.obiect, jsonb_build_object('inainte', a.ms, 'dupa', b.ms))
                                                 FROM pg_temp.r30g_timp a JOIN pg_temp.r30g_timp b ON b.obiect = a.obiect AND b.faza = 'dupa' WHERE a.faza = 'inainte');
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN RAISE EXCEPTION 'TEST5 FAIL: rol / claims ramase'; END IF;
  RAISE NOTICE 'TEST5 OK — DRY 20261130g complet (tranzactia trebuie ANULATA de runner)';
END $t$;
