-- Revenire 20261218c_securitate_anon_drepturi_implicite. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Reface EXACT drepturile implicite ale lui postgres pe public pentru anon (tabele / vederi și secvențe), din jurnalul securitate_intern.anon_revocari,
-- apoi șterge rândurile 20261218c din jurnal. Obiectele create între timp NU primesc drepturi retroactiv (drepturile implicite se aplică doar la
-- creare): le arată secțiunea RAMANE / OBIECT a scripts/anon_drepturi_citire.sql.
-- Refuză (nimic schimbat) dacă: postgres are deja alte drepturi implicite pentru anon pe public (date după livrare); după GRANT, drepturile
-- implicite ale lui anon nu sunt EXACT cele din jurnal; s-a atins alt rol.
-- LIVRAREA = prin runner, DOAR cu plafon:
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261218c_securitate_anon_drepturi_implicite_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261218140001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri: doar catalog (pg_default_acl). Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_dif text; v_alte text; v_n integer; g record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218c_securitate_anon_drepturi_implicite_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261218c revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261218c revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261218c revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261218c revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261218c revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('securitate_intern.anon_revocari') IS NULL THEN
    RAISE EXCEPTION '20261218c revenire: jurnalul securitate_intern.anon_revocari lipseste (migrarea nu e aplicata)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM securitate_intern.anon_revocari WHERE migrare = '20261218c') THEN
    RAISE EXCEPTION '20261218c revenire: niciun rand 20261218c in jurnal (migrarea nu e aplicata sau a fost deja revenita)';
  END IF;
  -- rândurile: exact tabelele / secvențele lui postgres pe public, acordant postgres, beneficiar anon
  IF EXISTS (SELECT 1 FROM securitate_intern.anon_revocari j WHERE j.migrare = '20261218c'
              AND j.eticheta NOT IN ('implicit postgres public r', 'implicit postgres public S'))
     OR EXISTS (SELECT 1 FROM securitate_intern.anon_revocari j, unnest(j.drepturi) d(it), aclexplode(ARRAY[d.it::aclitem]) e
                 WHERE j.migrare = '20261218c' AND (e.grantor <> 'postgres'::regrole OR e.grantee <> 'anon'::regrole)) THEN
    RAISE EXCEPTION '20261218c revenire: jurnalul are intrari neasteptate (nimic schimbat)';
  END IF;
  -- azi postgres nu dă implicit nimic lui anon pe public (altfel amestecul nu se poate reface exact)
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) e
              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND e.grantee = 'anon'::regrole) THEN
    RAISE EXCEPTION '20261218c revenire: postgres are deja drepturi implicite pentru anon pe public, date dupa livrare (nimic schimbat)';
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
  FOR g IN
    SELECT CASE j.eticheta WHEN 'implicit postgres public r' THEN 'TABLES' ELSE 'SEQUENCES' END AS tip,
           (SELECT string_agg(DISTINCT e.privilege_type, ', ' ORDER BY e.privilege_type) FROM unnest(j.drepturi) d(it), aclexplode(ARRAY[d.it::aclitem]) e WHERE NOT e.is_grantable) AS simple,
           (SELECT string_agg(DISTINCT e.privilege_type, ', ' ORDER BY e.privilege_type) FROM unnest(j.drepturi) d(it), aclexplode(ARRAY[d.it::aclitem]) e WHERE e.is_grantable) AS cu_optiune
      FROM securitate_intern.anon_revocari j WHERE j.migrare = '20261218c'
  LOOP
    IF g.simple IS NOT NULL THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT %s ON %s TO anon', g.simple, g.tip);
    END IF;
    IF g.cu_optiune IS NOT NULL THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT %s ON %s TO anon WITH GRANT OPTION', g.cu_optiune, g.tip);
    END IF;
  END LOOP;
  -- postcondiții: drepturile implicite ale lui anon = EXACT cele din jurnal, pe fiecare tip; nimic pe alte tipuri; celelalte roluri neatinse
  SELECT string_agg(coalesce(j.eticheta, a.eticheta), ', ') INTO v_dif
    FROM (SELECT x.eticheta, x.drepturi FROM securitate_intern.anon_revocari x WHERE x.migrare = '20261218c') j
    FULL JOIN (SELECT 'implicit postgres public ' || d.defaclobjtype::text AS eticheta,
                      (SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(d.defaclacl) x(it)
                        WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e WHERE e.grantee = 'anon'::regrole)) AS drepturi
                 FROM pg_default_acl d WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace) a
      ON a.eticheta = j.eticheta
   WHERE j.drepturi IS DISTINCT FROM a.drepturi AND NOT (j.eticheta IS NULL AND a.drepturi IS NULL);
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218c revenire post: drepturile implicite ale lui anon nu sunt exact cele din jurnal: %', v_dif; END IF;
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
    RAISE EXCEPTION '20261218c revenire post: drepturile altor roluri s-au schimbat';
  END IF;
  DELETE FROM securitate_intern.anon_revocari WHERE migrare = '20261218c';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218c_securitate_anon_drepturi_implicite_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261218c revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261218c revenire: % drepturi implicite refacute exact; sfarsit la % ms de la BEGIN', v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
