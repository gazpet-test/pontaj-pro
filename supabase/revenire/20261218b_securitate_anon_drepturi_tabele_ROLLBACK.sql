-- Revenire 20261218b_securitate_anon_drepturi_tabele. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Reface EXACT drepturile lui anon retrase de 20261218b (T2, tabelele și vederile), din jurnalul securitate_intern.anon_revocari: aclitem-urile cu acordantul
-- (postgres, proprietarul) și opțiunea de acordare, pe obiect și pe coloane; apoi șterge rândurile 20261218b din jurnal.
-- Jurnalul (creat de 20261218a) rămâne, cu rândurile celorlalte trepte.
-- Refuză (nimic schimbat) dacă: un obiect din jurnal nu mai există sau are alt nume / alt tip; o coloană din jurnal nu mai e ACEEAȘI
-- (attnum + tip + typmod + nume: redenumită, scoasă, alt tip, alta nouă cu numele vechi); anon are deja ALT drept pe el
-- (dat după livrare: amestecul nu se poate reface exact); după GRANT, drepturile lui anon nu sunt EXACT cele din jurnal; s-a atins alt rol.
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261218130001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri (PostgreSQL 17.6): GRANT nu ia lock pe obiecte (NoLock); deschide pg_class / pg_attribute cu RowExclusiveLock și rescrie rândurile,
--   ținute până la COMMIT (un GRANT / DDL concurent pe același obiect așteaptă și pică după COMMIT; noi așteptăm doar după o tranzacție care
--   rescrisese deja rândul: lock_timeout 100 ms => refuz). Un drept dat concurent înainte de GRANT-ul nostru e prins de postcondiția „exact
--   jurnalul”. GRANT-urile sunt grupate pe seturi identice de drepturi (câteva instrucțiuni, nu una pe obiect). Un SINGUR bloc DO: un refuz e
--   singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_dif text; v_alte text; v_n integer; g record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218b_securitate_anon_drepturi_tabele_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261218b revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261218b revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261218b revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261218b revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261218b revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- 1. jurnalul: există și are rânduri 20261218b
  IF to_regclass('securitate_intern.anon_revocari') IS NULL THEN
    RAISE EXCEPTION '20261218b revenire: jurnalul securitate_intern.anon_revocari lipseste (migrarea nu e aplicata)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM securitate_intern.anon_revocari WHERE migrare = '20261218b') THEN
    RAISE EXCEPTION '20261218b revenire: niciun rand 20261218b in jurnal (migrarea nu e aplicata sau a fost deja revenita)';
  END IF;

  -- 2. fiecare rând: obiectul există (același oid, același tip și nume), iar anon nu are acum NICIUN drept pe el
  SELECT string_agg(j.eticheta, ', ') INTO v_dif
    FROM securitate_intern.anon_revocari j
    LEFT JOIN pg_class c ON c.oid = j.obiect_oid LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE j.migrare = '20261218b'
     AND (c.oid IS NULL
          OR j.eticheta IS DISTINCT FROM CASE c.relkind WHEN 'S' THEN 'secventa' WHEN 'v' THEN 'vedere' WHEN 'm' THEN 'vedere_materializata'
                                                     WHEN 'f' THEN 'tabel_strain' WHEN 'p' THEN 'tabel_partitionat' ELSE 'tabel' END
                                         || ' ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname)
          OR c.relkind::text NOT IN ('r', 'p', 'v', 'm', 'f')
          OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) e WHERE e.grantee = 'anon'::regrole)
          OR EXISTS (SELECT 1 FROM pg_attribute a, aclexplode(a.attacl) e WHERE a.attrelid = c.oid AND NOT a.attisdropped AND e.grantee = 'anon'::regrole));
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261218b revenire: obiecte disparute / redenumite sau cu drepturi noi pentru anon dupa livrare: % (nimic schimbat)', v_dif;
  END IF;
  -- 2b. fiecare coloană din jurnal („attnum:tip:typmod nume aclitem”, review #1081 P1): ACEEAȘI coloană (același attnum, nescoasă, același
  --     tip și typmod, același nume). O coloană redenumită / scoasă / cu alt tip, sau alta nouă cu numele vechi = refuz, nimic schimbat.
  SELECT string_agg(j.eticheta || ' ' || col, ', ') INTO v_dif
    FROM securitate_intern.anon_revocari j CROSS JOIN LATERAL unnest(j.coloane) col
    LEFT JOIN LATERAL (SELECT regexp_match(col, '^(-?[0-9]+):([0-9]+):(-?[0-9]+) (.+) ([^ ]+)$') AS m) p ON true
    LEFT JOIN pg_attribute a ON a.attrelid = j.obiect_oid AND p.m IS NOT NULL AND a.attnum = p.m[1]::smallint
   WHERE j.migrare = '20261218b'
     AND (p.m IS NULL OR a.attrelid IS NULL OR a.attisdropped OR a.atttypid::text IS DISTINCT FROM p.m[2]
          OR a.atttypmod::text IS DISTINCT FROM p.m[3] OR quote_ident(a.attname) IS DISTINCT FROM p.m[4]);
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261218b revenire: coloane schimbate dupa livrare (redenumite / scoase / alt tip / alta cu acelasi nume): % (nimic schimbat)', v_dif;
  END IF;
  -- acordantul înregistrat = postgres pe fiecare drept (GRANT-ul de aici, ca postgres, îl reface exact)
  IF EXISTS (SELECT 1 FROM securitate_intern.anon_revocari j, unnest(j.drepturi || ARRAY(SELECT substring(x FROM ' ([^ ]+)$') FROM unnest(j.coloane) x)) d(it),
                    aclexplode(ARRAY[d.it::aclitem]) e
              WHERE j.migrare = '20261218b' AND (e.grantor <> 'postgres'::regrole OR e.grantee <> 'anon'::regrole)) THEN
    RAISE EXCEPTION '20261218b revenire: jurnalul are drepturi cu alt acordant / alt beneficiar decat postgres -> anon (nimic schimbat)';
  END IF;
  v_alte := (
-- >>> ALTE_ROLURI v1
-- amprenta drepturilor TUTUROR celorlalți (orice acordat altui rol decât anon) pe relațiile și coloanele din public + toate drepturile
-- implicite: o treaptă / o revenire care ar atinge alt rol o schimbă => refuz.
SELECT md5(coalesce(string_agg(y.l, chr(10) ORDER BY y.l COLLATE "C"), '')) FROM (
  SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' ' || x.it::text AS l
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL unnest(c.relacl) x(it)
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e JOIN pg_catalog.pg_roles r ON r.oid = e.grantee WHERE r.rolname = 'anon')
  UNION ALL
  SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname) || ' ' || x.it::text
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 CROSS JOIN LATERAL unnest(a.attacl) x(it)
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e JOIN pg_catalog.pg_roles r ON r.oid = e.grantee WHERE r.rolname = 'anon')
  UNION ALL
  SELECT 'implicit ' || pg_catalog.pg_get_userbyid(d.defaclrole) || ' ' || d.defaclnamespace::text || ' ' || d.defaclobjtype::text || ' ' || x.it::text
    FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL unnest(d.defaclacl) x(it)
   WHERE NOT EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e JOIN pg_catalog.pg_roles r ON r.oid = e.grantee WHERE r.rolname = 'anon')
) y
-- <<< ALTE_ROLURI v1
  );
  -- 3. drepturile pe obiect, grupate pe același set (fără / cu opțiune de acordare)
  FOR g IN
    SELECT x.simple, x.cu_optiune, string_agg(x.nume, ', ' ORDER BY x.nume COLLATE "C") AS lista
      FROM (SELECT format('%I.%I', n.nspname, c.relname) AS nume,
                   (SELECT string_agg(DISTINCT e.privilege_type, ', ' ORDER BY e.privilege_type) FROM unnest(j.drepturi) d(it), aclexplode(ARRAY[d.it::aclitem]) e WHERE NOT e.is_grantable) AS simple,
                   (SELECT string_agg(DISTINCT e.privilege_type, ', ' ORDER BY e.privilege_type) FROM unnest(j.drepturi) d(it), aclexplode(ARRAY[d.it::aclitem]) e WHERE e.is_grantable) AS cu_optiune
              FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE j.migrare = '20261218b' AND cardinality(j.drepturi) > 0) x
     GROUP BY x.simple, x.cu_optiune
  LOOP
    IF g.simple IS NOT NULL THEN EXECUTE format('GRANT %s ON TABLE %s TO anon', g.simple, g.lista); END IF;
    IF g.cu_optiune IS NOT NULL THEN EXECUTE format('GRANT %s ON TABLE %s TO anon WITH GRANT OPTION', g.cu_optiune, g.lista); END IF;
  END LOOP;
  -- 4. drepturile pe coloane (rândul de jurnal: „attnum:tip:typmod coloana_citată aclitem”), pe coloana cu ACELAȘI attnum (verificată la 2b),
  --    cu numele citat din catalog, grupate pe tabel și set de drepturi
  FOR g IN
    SELECT y.tabel, y.drept, y.optiune, string_agg(y.coloana, ', ' ORDER BY y.coloana COLLATE "C") AS coloane
      FROM (SELECT format('%I.%I', n.nspname, c.relname) AS tabel, quote_ident(a.attname) AS coloana,
                   e.privilege_type AS drept, e.is_grantable AS optiune
              FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid JOIN pg_namespace n ON n.oid = c.relnamespace,
                   unnest(j.coloane) col,
                   LATERAL (SELECT regexp_match(col, '^(-?[0-9]+):([0-9]+):(-?[0-9]+) (.+) ([^ ]+)$') AS m) p,
                   pg_attribute a, aclexplode(ARRAY[p.m[5]::aclitem]) e
             WHERE j.migrare = '20261218b' AND a.attrelid = c.oid AND a.attnum = p.m[1]::smallint) y
     GROUP BY y.tabel, y.drept, y.optiune
  LOOP
    EXECUTE format('GRANT %s (%s) ON TABLE %s TO anon', g.drept, g.coloane, g.tabel) || CASE WHEN g.optiune THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
  -- 5. postcondiții: anon are EXACT drepturile din jurnal (pe obiect și pe coloane, același format ca regula); celelalte roluri neatinse
  SELECT string_agg(j.eticheta, ', ') INTO v_dif
    FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid
   WHERE j.migrare = '20261218b'
     AND (coalesce((SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(c.relacl) x(it)
                     WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e WHERE e.grantee = 'anon'::regrole)), '{}'::text[]) IS DISTINCT FROM j.drepturi
          OR coalesce((SELECT array_agg(att.attnum::text || ':' || att.atttypid::text || ':' || att.atttypmod::text || ' ' || quote_ident(att.attname)
                                        || ' ' || x.it::text ORDER BY att.attnum, x.it::text COLLATE "C")
                         FROM pg_attribute att CROSS JOIN LATERAL unnest(att.attacl) x(it)
                        WHERE att.attrelid = c.oid AND NOT att.attisdropped
                          AND EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e WHERE e.grantee = 'anon'::regrole)), '{}'::text[]) IS DISTINCT FROM j.coloane);
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b revenire post: drepturile lui anon nu sunt exact cele din jurnal pe: %', v_dif; END IF;
  IF (
-- >>> ALTE_ROLURI v1
-- amprenta drepturilor TUTUROR celorlalți (orice acordat altui rol decât anon) pe relațiile și coloanele din public + toate drepturile
-- implicite: o treaptă / o revenire care ar atinge alt rol o schimbă => refuz.
SELECT md5(coalesce(string_agg(y.l, chr(10) ORDER BY y.l COLLATE "C"), '')) FROM (
  SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' ' || x.it::text AS l
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL unnest(c.relacl) x(it)
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e JOIN pg_catalog.pg_roles r ON r.oid = e.grantee WHERE r.rolname = 'anon')
  UNION ALL
  SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname) || ' ' || x.it::text
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 CROSS JOIN LATERAL unnest(a.attacl) x(it)
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e JOIN pg_catalog.pg_roles r ON r.oid = e.grantee WHERE r.rolname = 'anon')
  UNION ALL
  SELECT 'implicit ' || pg_catalog.pg_get_userbyid(d.defaclrole) || ' ' || d.defaclnamespace::text || ' ' || d.defaclobjtype::text || ' ' || x.it::text
    FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL unnest(d.defaclacl) x(it)
   WHERE NOT EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e JOIN pg_catalog.pg_roles r ON r.oid = e.grantee WHERE r.rolname = 'anon')
) y
-- <<< ALTE_ROLURI v1
     ) IS DISTINCT FROM v_alte THEN
    RAISE EXCEPTION '20261218b revenire post: drepturile altor roluri s-au schimbat';
  END IF;
  -- 6. jurnalul
  DELETE FROM securitate_intern.anon_revocari WHERE migrare = '20261218b';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218b_securitate_anon_drepturi_tabele_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261218b revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261218b revenire: % obiecte refacute exact; sfarsit la % ms de la BEGIN', v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
