-- Revenire 20261221a_meteo_xweather_zilnic. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: vederea v_meteo_zilnic_xweather, tabelul meteo_zilnic_xweather (cu politica și trigger-ele lui) și funcțiile
-- fn_meteo_vede_site(bigint), fn_meteo_xw_inserare(), fn_meteo_xw_nemodificabil() (amprenta corpului + proprietățile verificate înainte:
-- altă stare = refuz, nimic schimbat). Tabelele și funcțiile existente NU se ating.
-- REFUZĂ dacă tabelul are rânduri: vremea preluată e dovadă și nu se șterge de aici (golirea = decizie separată: preview → „da” Răzvan → apply,
-- cu export înainte; trigger-ul de nemodificare o refuză oricum pe DELETE / TRUNCATE).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261221a_meteo_xweather_zilnic_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261221120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261221a_meteo_xweather_zilnic_ROLLBACK:<txid>') și plafonul; fără ele fișierul
--   refuză.
-- Ordinea: 1. gărzile și starea EXACTĂ a migrării (doar catalog); 2. meteo_zilnic_xweather ACCESS EXCLUSIVE (NOWAIT, reîncercat până la 1 s de
--   la BEGIN) ÎNAINTEA verificării „gol” (o scriere concurentă din meteo-sync nu poate fi numărată 0 și apoi pierdută la DROP); sub lock:
--   reverificarea stării, „gol”, DROP, postcondiția. meteo-sync scrie doar acest tabel → fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261221a_meteo_xweather_zilnic_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261221a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261221a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261221a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261221a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261221a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.meteo_zilnic_xweather IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261221a revenire: BUGET_LOCK: meteo_zilnic_xweather ocupat; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    -- starea exactă: tabelul, vederea (security_invoker), politica unică, cele trei trigger-e, funcțiile cu corpul revizuit (amprenta)
    IF to_regclass('public.meteo_zilnic_xweather') IS NULL OR to_regclass('public.v_meteo_zilnic_xweather') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_meteo_zilnic_xweather'::regclass AND relkind = 'v' AND reloptions = ARRAY['security_invoker=on'])
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.meteo_zilnic_xweather'::regclass) <> 1
       OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.meteo_zilnic_xweather'::regclass AND NOT tgisinternal) <> 3 THEN
      RAISE EXCEPTION '20261221a revenire: starea nu e cea din 20261221a (pasul %, tabel / vedere / politica / trigger-e)', v_pas;
    END IF;
    FOR r IN SELECT * FROM (VALUES
        ('public.fn_meteo_vede_site(bigint)', 'fn_meteo_vede_site', 'sql', true,
         -- AMPRENTA-START predicatul
         'd2fc5e016b250f572d388f27d89a49e7'
         -- AMPRENTA-END predicatul
        ),
        ('public.fn_meteo_xw_inserare()', 'fn_meteo_xw_inserare', 'plpgsql', true,
         -- AMPRENTA-START inserarea
         '2e09de37704d13e8548c5fbfc40de71b'
         -- AMPRENTA-END inserarea
        ),
        ('public.fn_meteo_xw_nemodificabil()', 'fn_meteo_xw_nemodificabil', 'plpgsql', false,
         -- AMPRENTA-START nemodificabil
         '81ca28031f70f52ffef4c08dae4659e3'
         -- AMPRENTA-END nemodificabil
        )
      ) v(fn, nume, limbaj, definer, amp) LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                      WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp
                        AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'])
         OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.nume) <> 1 THEN
        RAISE EXCEPTION '20261221a revenire: starea nu e cea din 20261221a (pasul %, %)', v_pas, r.nume;
      END IF;
      -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe)
      IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                   AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid IN (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid = 'public.meteo_zilnic_xweather'::regclass))
                   AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT pol.oid FROM pg_policy pol WHERE pol.polrelid = 'public.meteo_zilnic_xweather'::regclass)))
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                       AND p.oid <> to_regprocedure(r.fn) AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
        RAISE EXCEPTION '20261221a revenire: alte obiecte depind de functia %', r.nume;
      END IF;
    END LOOP;
    -- alte vederi / obiecte peste tabel sau vedere = refuz (DROP fără CASCADE ar eșua oricum; refuzul spune de ce)
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                WHERE d.classid = 'pg_rewrite'::regclass
                  AND d.refobjid IN ('public.meteo_zilnic_xweather'::regclass, 'public.v_meteo_zilnic_xweather'::regclass)
                  AND w.ev_class <> 'public.v_meteo_zilnic_xweather'::regclass) THEN
      RAISE EXCEPTION '20261221a revenire: alte vederi depind de obiectele migrarii';
    END IF;
  END LOOP;
  -- sub ACCESS EXCLUSIVE: tabelul gol (vremea preluată nu se șterge de aici)
  IF EXISTS (SELECT 1 FROM public.meteo_zilnic_xweather) THEN
    RAISE EXCEPTION '20261221a revenire: tabelul are randuri (vremea preluata e dovada si nu se sterge de aici)';
  END IF;
  DROP VIEW public.v_meteo_zilnic_xweather;
  DROP TABLE public.meteo_zilnic_xweather;
  DROP FUNCTION public.fn_meteo_vede_site(bigint);
  DROP FUNCTION public.fn_meteo_xw_inserare();
  DROP FUNCTION public.fn_meteo_xw_nemodificabil();
  IF to_regclass('public.meteo_zilnic_xweather') IS NOT NULL OR to_regclass('public.v_meteo_zilnic_xweather') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_meteo_vede_site', 'fn_meteo_xw_inserare', 'fn_meteo_xw_nemodificabil')) THEN
    RAISE EXCEPTION '20261221a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261221a_meteo_xweather_zilnic_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261221a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261221a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
