-- Execuție / acces pe proiect (20261209a, 20261213a): MĂSURAREA citirilor pentru UN cont, DOAR CITIRE (SELECT count(*) + EXPLAIN ANALYZE pe
-- SELECT-uri; nicio scriere, niciun lock în afara celor ale citirilor). Corp FĂRĂ control de tranzacție, inclus de:
--   scripts/executie_acces_masurare.sql             — producție / clonă, BEGIN READ ONLY … ROLLBACK („înainte” sau „după” aplicare);
--   scripts/executie_acces_masurare_dry_20261213a.sql — înainte + după 20261213a în aceeași tranzacție ANULATĂ (DRY);
--   scripts/test_executie_acces_perf.sql            — harness-ul (proba de plan, cu praguri).
-- Intrări (GUC-uri locale ale tranzacției): tacc.masurare_cont = uuid-ul contului (obligatoriu); tacc.masurare_eticheta (opțional).
-- Ieșire: o linie NOTICE pe fiecare obiect și tacc.masurare_rez = jsonb {obiect: {clasa, randuri, ms1, ms2, ms_executie, ms_planificare,
--   fn_pe_rand, fn_drept_pe_rand, initplanuri, initplan_loops_max, subplanuri, subplan_corelate}}.
-- Obiectele: tabelele din inventarul 20261209a (proiect / proiect_optional / copil / inbox / drept) și bucket-urile Storage acoperite.
-- Rulează ca postgres; identitatea contului = rolul authenticated + revendicările JWT, doar în tranzacție (ca PostgREST), refăcute la final.
-- Metrici de plan (EXPLAIN ANALYZE VERBOSE, JSON):
--   fn_pe_rand       = predicatele de acces (fn_executie_proiect_permis / fn_executie_acces_*) găsite într-un filtru / o condiție a unui nod,
--                      adică evaluate pe fiecare rând (o funcție dintr-un InitPlan apare doar în Output-ul lui, nu în filtre);
--   fn_drept_pe_rand = la fel, pentru funcțiile de drept ale tabelelor 'drept' (fn_executie_*_drept; informativ, în afara 20261213a);
--   initplan_loops_max = de câte ori s-a executat cel mai des un InitPlan care cheamă o funcție de acces (prag: ≤ 1);
--   subplan_corelate = câte subplanuri au un scan executat de mai multe ori (subinterogare corelată, pe rând).
-- Timpul: statement_timeout se socotește pe tot blocul DO (îl pune scriptul care îl include).
DO $masurare$
DECLARE
  v_cont uuid; v_et text := coalesce(nullif(current_setting('tacc.masurare_eticheta', true), ''), '-');
  v_obi jsonb; o record; v_rez jsonb := '{}'::jsonb; v_m jsonb; t0 timestamptz; n bigint; ms1 numeric; ms2 numeric; pl json; pj jsonb;
  v_claims text := current_setting('request.jwt.claims', true); v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'masurare: ruleaza ca postgres (identitatea contului o pune scriptul)';
  END IF;
  BEGIN
    v_cont := nullif(current_setting('tacc.masurare_cont', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_cont := NULL;
  END;
  IF v_cont IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_cont) THEN
    RAISE EXCEPTION 'masurare: tacc.masurare_cont trebuie sa fie uuid-ul unui cont existent';
  END IF;
  IF to_regprocedure('public.fn_executie_acces_inventar()') IS NULL THEN RAISE EXCEPTION 'masurare: 20261209a nu e aplicata'; END IF;
  -- lista obiectelor, ca postgres (inventarul nu e citibil de clienți)
  SELECT jsonb_agg(jsonb_build_object('obiect', x.obiect, 'clasa', x.clasa, 'sql', x.sql) ORDER BY x.ord, x.obiect) INTO v_obi
    FROM (SELECT 1 AS ord, i.obiect, i.clasa, format('SELECT count(*) FROM public.%I', i.obiect) AS sql
            FROM public.fn_executie_acces_inventar() i
           WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox', 'drept')
             AND to_regclass('public.' || quote_ident(i.obiect)) IS NOT NULL
          UNION ALL
          SELECT 2, 'storage:' || i.obiect, 'bucket_' || i.clasa, format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L', i.obiect)
            FROM public.fn_executie_acces_inventar() i
           WHERE i.tip = 'bucket' AND i.clasa IN ('cale', 'tabel', 'inbox', 'drept')) x;
  -- identitatea contului
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_cont, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_cont::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid() IS DISTINCT FROM v_cont OR current_user IS DISTINCT FROM 'authenticated'
     OR (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'masurare: identitatea nu s-a schimbat';
  END IF;
  FOR o IN SELECT * FROM jsonb_to_recordset(v_obi) AS q(obiect text, clasa text, sql text) LOOP
    BEGIN
      t0 := clock_timestamp(); EXECUTE o.sql INTO n; ms1 := round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 2);
      t0 := clock_timestamp(); EXECUTE o.sql INTO n; ms2 := round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 2);
      EXECUTE 'EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) ' || o.sql INTO pl;
      pj := pl::jsonb -> 0;
      WITH RECURSIVE nod(x, sub_rad) AS (
        SELECT pj -> 'Plan', NULL::text
        UNION ALL
        SELECT c.v, CASE WHEN c.v ->> 'Parent Relationship' = 'SubPlan' THEN c.v ->> 'Subplan Name' ELSE nod.sub_rad END
          FROM nod CROSS JOIN LATERAL jsonb_array_elements(coalesce(nod.x -> 'Plans', '[]'::jsonb)) c(v)
      ), filtre AS (
        SELECT e.value #>> '{}' AS f FROM nod CROSS JOIN LATERAL jsonb_each(nod.x) e
         WHERE e.key ~ '(Filter|Cond)$' AND jsonb_typeof(e.value) = 'string'
      )
      SELECT jsonb_build_object(
        'fn_pe_rand', coalesce((SELECT jsonb_agg(DISTINCT m.f) FROM (SELECT (regexp_matches(filtre.f, 'fn_executie_(?:proiect_permis|acces_[a-z_]+)', 'g'))[1] AS f FROM filtre) m), '[]'::jsonb),
        'fn_drept_pe_rand', coalesce((SELECT jsonb_agg(DISTINCT m.f) FROM (SELECT (regexp_matches(filtre.f, 'fn_[a-z_]+_drept', 'g'))[1] AS f FROM filtre) m), '[]'::jsonb),
        'initplanuri', (SELECT count(*) FROM nod WHERE nod.x ->> 'Parent Relationship' = 'InitPlan' AND (nod.x -> 'Output')::text LIKE '%fn\_executie\_acces\_%'),
        'initplan_loops_max', coalesce((SELECT max((nod.x ->> 'Actual Loops')::numeric) FROM nod
                                         WHERE nod.x ->> 'Parent Relationship' = 'InitPlan' AND (nod.x -> 'Output')::text LIKE '%fn\_executie\_acces\_%'), 0),
        'subplanuri', (SELECT count(*) FROM nod WHERE nod.x ->> 'Parent Relationship' = 'SubPlan'),
        'subplan_corelate', (SELECT count(DISTINCT nod.sub_rad) FROM nod
                              WHERE nod.sub_rad IS NOT NULL AND nod.x ->> 'Node Type' LIKE '%Scan%' AND (nod.x ->> 'Actual Loops')::numeric > 1))
        INTO v_m;
      v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('clasa', o.clasa, 'randuri', n, 'ms1', ms1, 'ms2', ms2,
                                                                       'ms_executie', pj -> 'Execution Time', 'ms_planificare', pj -> 'Planning Time') || v_m);
    EXCEPTION
      WHEN insufficient_privilege THEN v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('clasa', o.clasa, 'fara_drept', true));
      WHEN OTHERS THEN v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('clasa', o.clasa, 'eroare', SQLSTATE || ' ' || left(SQLERRM, 200)));
    END;
    RAISE NOTICE 'masurare % | % (%) | randuri % | ms % / % (planificare %) | plan: pe rand % ; drept pe rand % ; initplan max % ; subplan corelate %',
      v_et, o.obiect, o.clasa, coalesce(v_rez -> o.obiect ->> 'randuri', v_rez -> o.obiect ->> 'eroare', 'fara drept'),
      v_rez -> o.obiect ->> 'ms1', v_rez -> o.obiect ->> 'ms2', v_rez -> o.obiect ->> 'ms_planificare', v_rez -> o.obiect -> 'fn_pe_rand', v_rez -> o.obiect -> 'fn_drept_pe_rand',
      v_rez -> o.obiect ->> 'initplan_loops_max', v_rez -> o.obiect ->> 'subplan_corelate';
  END LOOP;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  PERFORM set_config('tacc.masurare_rez', v_rez::text, true);
END $masurare$;
