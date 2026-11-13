-- Revenire 20261222b_ctc_autorizatii_citire. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate EXACT cele trei funcții create de migrare: fn_ctc_autorizatii_drept(), fn_ctc_autorizatii_sudori(), fn_ctc_autorizatie_fisier(bigint)
-- (amprenta corpului + proprietățile verificate înainte: altă stare = refuz, nimic schimbat). Nimic altceva nu se atinge (migrarea n-a
-- schimbat tabele, politici sau drepturi existente). După revenire, secțiunea din CTC arată „neactivată încă”, iar edge fn
-- ctc-autorizatie-fisier refuză (RPC-ul lipsește).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261222b_ctc_autorizatii_citire_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261222120101 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Fără lock pe tabele (doar DROP FUNCTION; DROP ia lock pe funcție). Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222b_ctc_autorizatii_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222b revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261222b revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261222b revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261222b revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261222b revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ctc_autorizatii_drept()', 'fn_ctc_autorizatii_drept', 'sql',
       -- AMPRENTA-START dreptul
       'fde56a1c781ebe02a9deb4b0f1ad57e6'
       -- AMPRENTA-END dreptul
      ),
      ('public.fn_ctc_autorizatii_sudori()', 'fn_ctc_autorizatii_sudori', 'plpgsql',
       -- AMPRENTA-START lista
       '12a84b2b7cd70e0262f2e7def60702a6'
       -- AMPRENTA-END lista
      ),
      ('public.fn_ctc_autorizatie_fisier(bigint)', 'fn_ctc_autorizatie_fisier', 'plpgsql',
       -- AMPRENTA-START fisierul
       'ab6504326b3939a16def215b690ea6d1'
       -- AMPRENTA-END fisierul
      )
    ) v(fn, nume, limbaj, amp) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef
                      AND md5(replace(p.prosrc, chr(13), '')) = r.amp
                      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'])
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.nume) <> 1 THEN
      RAISE EXCEPTION '20261222b revenire: starea nu e cea din 20261222b (%)', r.nume;
    END IF;
    -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale; cele trei între ele sunt permise)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                 AND NOT (d.classid = 'pg_proc'::regclass AND d.objid IN (to_regprocedure('public.fn_ctc_autorizatii_sudori()'),
                                                                          to_regprocedure('public.fn_ctc_autorizatie_fisier(bigint)'))))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT IN ('fn_ctc_autorizatii_drept', 'fn_ctc_autorizatii_sudori', 'fn_ctc_autorizatie_fisier')
                     AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
      RAISE EXCEPTION '20261222b revenire: alte obiecte depind de functia %', r.nume;
    END IF;
  END LOOP;
  DROP FUNCTION public.fn_ctc_autorizatie_fisier(bigint);
  DROP FUNCTION public.fn_ctc_autorizatii_sudori();
  DROP FUNCTION public.fn_ctc_autorizatii_drept();
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('fn_ctc_autorizatii_drept', 'fn_ctc_autorizatii_sudori', 'fn_ctc_autorizatie_fisier')) THEN
    RAISE EXCEPTION '20261222b revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222b_ctc_autorizatii_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222b revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261222b revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
