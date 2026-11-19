-- Revenire 20261222a_sites_drept_creare (runda 2). NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate EXACT ce a creat migrarea: funcția fn_sites_creeaza(text, bigint, text) (amprenta corpului + proprietățile + drepturile verificate
-- înainte: altă stare = refuz, nimic schimbat) și cheia de modul santiere_creare din app_modules. Politicile, triggerele și drepturile lui sites,
-- funcțiile existente și restul tabelelor NU se ating (migrarea nu le-a schimbat).
-- REFUZĂ dacă dreptul a fost acordat cuiva (rânduri santiere_creare în user_module_access): ștergerea cheii ar șterge în cascadă și dreptul,
-- fără urmă. Retragerea dreptului = pas separat al coordonatorului (preview → „da” Răzvan → apply), apoi revenirea.
-- Șantierele create prin RPC între aplicare și revenire RĂMÂN (rânduri obișnuite în sites, legate de proiectele lor): sunt date ale
-- utilizatorilor, nu obiecte ale migrării; revenirea nu anulează operațiunile utilizatorilor.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261222120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261222a_sites_drept_creare_ROLLBACK:<txid>') și plafonul; fără ele fișierul
--   refuză.
-- Ordinea lock-urilor (L06): 1. gărzile și starea EXACTĂ (doar catalog); 2. rândul cheii din app_modules FOR UPDATE NOWAIT, reîncercat până la 1 s
--   de la BEGIN (o acordare concurentă a dreptului ia FOR KEY SHARE pe el prin cheia străină, deci după acest lock nu mai poate apărea niciun rând
--   nou); sub lock: reverificarea stării, „niciun drept acordat”, DROP / DELETE, postcondiția. Un apel RPC în curs se termină normal (șantierul lui
--   rămâne, ca mai sus); apelurile de după COMMIT primesc „funcția nu există” (interfața: „nu e încă disponibilă”, fără fals succes).
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer;
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
          PERFORM 1 FROM public.app_modules WHERE key = 'santiere_creare' FOR UPDATE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261222a revenire: BUGET_LOCK: cheia santiere_creare ocupata; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    -- starea exactă: funcția (corpul revizuit + proprietățile + drepturile; o singură semnătură), cheia de modul
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') AND l.lanname = 'plpgsql' AND p.prosecdef
                      AND md5(replace(p.prosrc, chr(13), '')) =
                          -- AMPRENTA-START rpc
                          '7adb03ef93e482804b01fca31a8bd383'
                          -- AMPRENTA-END rpc
                      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                      AND p.prorettype = 'jsonb'::regtype
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza') <> 1 THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, functia)', v_pas;
    END IF;
    IF (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare') <> 1 THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, cheia de modul)', v_pas;
    END IF;
    -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass
                 AND d.refobjid = to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') AND d.deptype <> 'i')
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.oid <> to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') AND p.prosrc ~ '\mfn_sites_creeaza\M') THEN
      RAISE EXCEPTION '20261222a revenire: alte obiecte depind de functia fn_sites_creeaza';
    END IF;
  END LOOP;
  -- sub lock: dreptul nu e acordat nimănui (altfel DELETE-ul cheii l-ar șterge în cascadă, fără urmă)
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a revenire: dreptul santiere_creare e acordat (user_module_access); retragerea lui e un pas separat, cu acordul owner-ului';
  END IF;
  DROP FUNCTION public.fn_sites_creeaza(text, bigint, text);
  DELETE FROM public.app_modules WHERE key = 'santiere_creare';
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261222a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
