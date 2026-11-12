-- Revenire 20261217a_executie_raport_linii_proiect. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: trigger-ul trg_raport_lucrari_zz_proiect de pe raport_lucrari cu funcția lui fn_raport_lucrari_proiect_garda()
-- și (r4) trigger-ul trg_raport_distributie_zz_proiect de pe raport_distributie_linii cu funcția lui fn_raport_distributie_proiect_garda()
-- (amprenta corpului + proprietățile verificate înainte: altă stare = refuz, nimic schimbat). Liniile, distribuția, rapoartele și șantierele
-- NU se ating. Migrarea nu a scris date, deci revenirea nu are ce date să piardă; după ea, fereastra din antetul migrării e din nou deschisă
-- (pe ambele tabele).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261217120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261217a_executie_raport_linii_proiect_ROLLBACK:<txid>') și plafonul; fără ele
--   fișierul refuză.
-- Ordinea: 1. gărzile și starea EXACTĂ a migrării (doar catalog, niciun lock pe tabele); 2. raport_lucrari, apoi raport_distributie_linii
--   ACCESS EXCLUSIVE (cerut de DROP TRIGGER; ordinea salvării), reîncercat până la 1 s de la BEGIN, fiecare încercare cu lock_timeout 100 ms;
--   sub ele DOAR catalog (reverificarea stării, DROP, postcondiția). ACCESS EXCLUSIVE oprește scurt și citirile liniilor (sub plafon).
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261217a_executie_raport_linii_proiect_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261217a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261217a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261217a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261217a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261217a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- 1. starea exactă a migrării: pasul 1 fără lock (refuz devreme, nimic ținut), pasul 2 sub ACCESS EXCLUSIVE pe raport_lucrari și pe
  --    raport_distributie_linii (DROP TRIGGER), luate cu reîncercare până la 1 s de la BEGIN; sub lock DOAR catalog
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.raport_lucrari IN ACCESS EXCLUSIVE MODE;
          LOCK TABLE public.raport_distributie_linii IN ACCESS EXCLUSIVE MODE;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261217a revenire: BUGET_LOCK: raport_lucrari / raport_distributie_linii ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
        END;
      END LOOP;
      RAISE NOTICE '20261217a revenire: exclusiv la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
    END IF;
    FOR r IN SELECT * FROM (VALUES
        ('public.raport_lucrari'::regclass, 'trg_raport_lucrari_zz_proiect', 'public.fn_raport_lucrari_proiect_garda()', 'fn_raport_lucrari_proiect_garda',
         -- AMPRENTA-START garda liniilor
         '06cf9f54e1ae54324f78d5db74ce1928',
         -- AMPRENTA-END garda liniilor
         'CREATE TRIGGER trg_raport_lucrari_zz_proiect BEFORE INSERT OR UPDATE OF raport_id, proiect_id ON public.raport_lucrari FOR EACH ROW EXECUTE FUNCTION fn_raport_lucrari_proiect_garda()'),
        ('public.raport_distributie_linii'::regclass, 'trg_raport_distributie_zz_proiect', 'public.fn_raport_distributie_proiect_garda()', 'fn_raport_distributie_proiect_garda',
         -- AMPRENTA-START garda distributiei
         '26f76c3666e75161baedafb35ba34bdf',
         -- AMPRENTA-END garda distributiei
         'CREATE TRIGGER trg_raport_distributie_zz_proiect BEFORE INSERT OR UPDATE OF raport_id, unitate_id ON public.raport_distributie_linii FOR EACH ROW EXECUTE FUNCTION fn_raport_distributie_proiect_garda()')
      ) v(rel, trg, fn, nume, amp, def) LOOP
      -- funcția: corpul revizuit (amprenta), plpgsql, DEFINER, proprietar, configurație, fără EXECUTE; trigger-ul: forma exactă, activ, unul singur
      IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                      WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = 'plpgsql' AND p.prosecdef
                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp
                        AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0))
         OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = r.rel AND tg.tgname = r.trg
                         AND tg.tgfoid = to_regprocedure(r.fn) AND tg.tgtype = (1 | 2 | 4 | 16)
                         AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgenabled = 'O'
                         AND pg_get_triggerdef(tg.oid) = r.def)
         OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid = to_regprocedure(r.fn)) <> 1 THEN
        RAISE EXCEPTION '20261217a revenire: starea nu e cea din 20261217a (pasul %, %)', v_pas, r.nume;
      END IF;
      -- nimic altceva nu depinde de funcție: alte obiecte din catalog / apeluri textuale (plpgsql nu lasă dependențe)
      IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                   AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid = (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid = r.rel AND tg.tgname = r.trg)))
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                       AND p.oid <> to_regprocedure(r.fn)
                       AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
        RAISE EXCEPTION '20261217a revenire: alte obiecte depind de functia %', r.nume;
      END IF;
    END LOOP;
  END LOOP;
  DROP TRIGGER trg_raport_lucrari_zz_proiect ON public.raport_lucrari;
  DROP FUNCTION public.fn_raport_lucrari_proiect_garda();
  DROP TRIGGER trg_raport_distributie_zz_proiect ON public.raport_distributie_linii;
  DROP FUNCTION public.fn_raport_distributie_proiect_garda();
  -- postcondiție
  IF to_regprocedure('public.fn_raport_lucrari_proiect_garda()') IS NOT NULL OR to_regprocedure('public.fn_raport_distributie_proiect_garda()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_lucrari_zz_proiect', 'trg_raport_distributie_zz_proiect')) THEN
    RAISE EXCEPTION '20261217a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261217a_executie_raport_linii_proiect_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261217a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261217a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
