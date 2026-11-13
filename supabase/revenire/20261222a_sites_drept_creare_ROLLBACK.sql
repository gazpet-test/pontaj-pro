-- Revenire 20261222a_sites_drept_creare. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate EXACT ce a creat migrarea: politica sites_insert_drept_creare, funcția fn_sites_drept_creare(bigint) (amprenta corpului + proprietățile
-- verificate înainte: altă stare = refuz, nimic schimbat) și cheia de modul santiere_creare din app_modules. Politicile owner-ului, drepturile
-- pe sites și restul tabelelor NU se ating.
-- REFUZĂ dacă dreptul a fost acordat cuiva (rânduri santiere_creare în user_module_access): ștergerea cheii ar șterge în cascadă și dreptul,
-- fără urmă. Retragerea dreptului = pas separat al coordonatorului (preview → „da” Răzvan → apply), apoi revenirea.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261222120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261222a_sites_drept_creare_ROLLBACK:<txid>') și plafonul; fără ele fișierul
--   refuză.
-- Ordinea lock-urilor (L06): 1. gărzile și starea EXACTĂ (doar catalog); 2. sites ACCESS EXCLUSIVE (DROP POLICY o cere oricum), NOWAIT,
--   reîncercat până la 1 s de la BEGIN; 3. rândul cheii din app_modules FOR UPDATE NOWAIT (o acordare concurentă a dreptului ia FOR KEY SHARE
--   pe el prin cheia străină, deci după acest lock nu mai poate apărea niciun rând nou); sub lock-uri: reverificarea stării, „niciun drept
--   acordat”, DROP / DELETE, postcondiția.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_expr text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261222a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261222a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261222a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.sites IN ACCESS EXCLUSIVE MODE NOWAIT;
          PERFORM 1 FROM public.app_modules WHERE key = 'santiere_creare' FOR UPDATE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261222a revenire: BUGET_LOCK: sites / app_modules ocupat; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    -- starea exactă: politica (forma exactă), funcția (corpul revizuit + proprietățile), cheia de modul
    SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_expr FROM pg_policy pol
     WHERE pol.polrelid = 'public.sites'::regclass AND pol.polname = 'sites_insert_drept_creare'
       AND pol.polcmd = 'a' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polqual IS NULL;
    IF v_expr IS NULL OR v_expr NOT IN ('fn_sites_drept_creare(proiect_id)', 'fn_sites_drept_creare((proiect_id)::bigint)') THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, politica)', v_pas;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure('public.fn_sites_drept_creare(bigint)') AND l.lanname = 'sql' AND p.prosecdef
                      AND md5(replace(p.prosrc, chr(13), '')) =
                          -- AMPRENTA-START predicatul
                          'f47a55e03818d9998175213a961e83b0'
                          -- AMPRENTA-END predicatul
                      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'])
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'fn_sites_drept_creare') <> 1 THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, functia)', v_pas;
    END IF;
    IF (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare') <> 1 THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, cheia de modul)', v_pas;
    END IF;
    -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_sites_drept_creare(bigint)')
                 AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT pol.oid FROM pg_policy pol
                            WHERE pol.polrelid = 'public.sites'::regclass AND pol.polname = 'sites_insert_drept_creare')))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.oid <> to_regprocedure('public.fn_sites_drept_creare(bigint)') AND p.prosrc ~ '\mfn_sites_drept_creare\M') THEN
      RAISE EXCEPTION '20261222a revenire: alte obiecte depind de functia fn_sites_drept_creare';
    END IF;
  END LOOP;
  -- sub lock-uri: dreptul nu e acordat nimănui (altfel DELETE-ul cheii l-ar șterge în cascadă, fără urmă)
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a revenire: dreptul santiere_creare e acordat (user_module_access); retragerea lui e un pas separat, cu acordul owner-ului';
  END IF;
  DROP POLICY sites_insert_drept_creare ON public.sites;
  DROP FUNCTION public.fn_sites_drept_creare(bigint);
  DELETE FROM public.app_modules WHERE key = 'santiere_creare';
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sites'::regclass AND polname = 'sites_insert_drept_creare')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_drept_creare')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261222a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
