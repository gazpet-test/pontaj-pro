-- Version 20261218140000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261218c_securitate_anon_drepturi_implicite — TREAPTA T3 (docs/SECURITATE_ANON_DREPTURI.md): tabelele, vederile și secvențele NOI create
--   de postgres în public nu mai primesc automat drepturi pentru anon. Cere 20261218a aplicată (jurnalul comun); T2 nu e obligatorie.
--   Schimbare de DREPTURI: nu se aplică fără „da”-ul owner-ului.
--
-- De ce: drepturile implicite ale lui postgres pe public dau anon arwdxt la fiecare tabel / vedere nouă și rwU la fiecare secvență nouă — de aici
--   vin cele de azi. Fără T3, orice tabel nou le primește din nou. Riscul: o funcționalitate publică NOUĂ care chiar are nevoie de anon pe un
--   tabel trebuie să dea dreptul explicit în migrarea ei (GRANT ... TO anon), lucru care oricum se cere revizuit.
-- Ce rămâne (nu se poate schimba ca postgres): drepturile implicite ale lui supabase_admin pe public (obiectele create de platformă, rar) —
--   se văd în secțiunea RAMANE a citirii; controlul periodic e descris în document.
--
-- Ce face: gărzile; lista T3 calculată (REGULA_ANON v1) = EXACT BASELINE-ul revizuit; un drept implicit global al lui postgres pentru anon =
--   refuz (reanaliză); câte un rând de jurnal pe tip (tabele / secvențe) cu drepturile exacte; ALTER DEFAULT PRIVILEGES FOR ROLE postgres
--   IN SCHEMA public REVOKE ALL ON TABLES / ON SEQUENCES FROM anon; postcondiții: nimic implicit pentru anon de la postgres pe public, regula
--   recalculată nu mai găsește nimic în T3, sonda (un tabel cu serial și o vedere create ACUM de postgres în public, șterse în aceeași
--   tranzacție) nu dă nimic lui anon, celelalte roluri neschimbate (ALTE_ROLURI v1, după ștergerea sondei), timpul.
-- Lock-uri: doar catalog (pg_default_acl); sonda creează și șterge două obiecte proprii. Nu atinge niciun obiect existent.
-- Revenire: supabase/revenire/20261218c_securitate_anon_drepturi_implicite_ROLLBACK.sql.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218c_securitate_anon_drepturi_implicite:' || txid_current() THEN
    RAISE EXCEPTION '20261218c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261218c: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261218c: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261218c: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261218c: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('securitate_intern.anon_revocari') IS NULL THEN
    RAISE EXCEPTION '20261218c: jurnalul securitate_intern.anon_revocari lipseste (se aplica intai 20261218a)';
  END IF;
  IF EXISTS (SELECT 1 FROM securitate_intern.anon_revocari WHERE migrare = '20261218c') THEN
    RAISE EXCEPTION '20261218c: jurnalul are deja randuri 20261218c (reaplicare)';
  END IF;
  IF to_regclass('public._sec_anon_sonda_20261218c') IS NOT NULL OR to_regclass('public._sec_anon_sonda_v_20261218c') IS NOT NULL THEN
    RAISE EXCEPTION '20261218c: obiectele sondei exista deja';
  END IF;
  -- un drept implicit GLOBAL al lui postgres (toate schemele) pentru anon nu e analizat aici: refuz
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) e
              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND e.grantee = 'anon'::regrole) THEN
    RAISE EXCEPTION '20261218c: postgres are drepturi implicite GLOBALE pentru anon (reanaliza)';
  END IF;
END $pre$;

-- >>> BASELINE 20261218c — SINGURUL loc cu valori din producție: rândul T3 din secțiunea BASELINE a scripts/anon_drepturi_citire.sql (coloana
--     detaliu, copiată ÎNTREAGĂ). Necompletat = refuz.
CREATE FUNCTION pg_temp.anon_baseline_20261218c() RETURNS TABLE (treapta text, obiecte integer, amprenta text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $bl$
  SELECT v.treapta, v.obiecte, v.amprenta FROM (VALUES
    ('T3', NULL::integer, 'DE_COMPLETAT')
  ) v(treapta, obiecte, amprenta)
$bl$;
-- <<< BASELINE 20261218c
CREATE FUNCTION pg_temp.anon_regula_20261218c()
RETURNS TABLE (r_treapta text, r_oid oid, r_eticheta text, r_detaliu text, r_drepturi text[], r_coloane text[], r_motiv text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $regula$
WITH RECURSIVE
-- >>> REGULA_ANON v1
-- (L19: O SINGURĂ definiție, copiată octet cu octet în scripts/anon_drepturi_citire.sql și în migrările 20261218a / b / c; testul
--  src/anonDrepturi.test.js verifică identitatea.) Rezultatul: anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv),
--  treapta = T1 (secvență de retras) | T2 (tabel / vedere de retras) | T3 (drept implicit de retras) | RAMANE (cu motivul) | LIPSA.
-- pct. 1 (docs/SECURITATE_ANON_DREPTURI.md): obiectele din public folosite DIRECT de cererile fără cont, cu motivul (nume calificat,
--   ex. 'public.formular'). Azi NICIUNUL: paginile publice merg doar prin RPC SECURITY DEFINER și prin funcții edge. Rând nou = review nou.
anon_pastrate(obiect, motiv) AS (
  SELECT x.obiect, x.motiv FROM (VALUES (NULL::text, NULL::text)) x(obiect, motiv) WHERE x.obiect IS NOT NULL
),
anon_id(oid) AS (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon'),
-- „citește din”: o vedere -> relațiile din regula ei; un tabel -> relațiile din politicile lui (ambele evaluate cu drepturile celui care cere)
anon_muchii(de, la) AS (
  SELECT rw.ev_class, d.refobjid FROM pg_catalog.pg_rewrite rw
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = rw.oid
                               AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid <> rw.ev_class
  UNION
  SELECT pol.polrelid, d.refobjid FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = pol.oid
                               AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid <> pol.polrelid
),
-- obiectele păstrate + tot ce citesc ele, tranzitiv
anon_pastrate_inchise(oid) AS (
  SELECT pg_catalog.to_regclass(p.obiect)::oid FROM anon_pastrate p WHERE pg_catalog.to_regclass(p.obiect) IS NOT NULL
  UNION
  SELECT m.la FROM anon_pastrate_inchise i JOIN anon_muchii m ON m.de = i.oid
),
-- tabelele în care anon POATE insera după politici: o politică PERMISSIVE pentru INSERT / ALL care include anon sau PUBLIC (expresia nu se
-- evaluează aici: prudent, secvențele lor rămân; dacă toate cer cont, se retrag odată cu tabelele, într-o treaptă ulterioară)
anon_insert_politici(oid) AS (
  SELECT pol.polrelid FROM pg_catalog.pg_policy pol, anon_id a
   WHERE pol.polpermissive AND pol.polcmd IN ('a', '*') AND (0::oid = ANY (pol.polroles) OR a.oid = ANY (pol.polroles))
),
-- secvențele din DEFAULT nextval(...) ale relațiilor păstrate și ale tabelelor de mai sus (INSERT-ul cere USAGE pe ele; coloanele IDENTITY
-- nu cer drept pe secvență, deci nu intră aici)
anon_secvente_pastrate(oid) AS (
  SELECT d.refobjid FROM (SELECT i.oid FROM anon_pastrate_inchise i UNION SELECT p.oid FROM anon_insert_politici p) i
    JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = i.oid
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = ad.oid
                               AND d.refclassid = 'pg_catalog.pg_class'::regclass
    JOIN pg_catalog.pg_class s ON s.oid = d.refobjid AND s.relkind = 'S'
),
-- relațiile din public și drepturile EXACTE ale lui anon pe ele (pe obiect și pe coloane, aclitem cu acordantul)
anon_rel AS (
  SELECT c.oid, c.relkind::text AS tip, n.nspname::text AS nspname, c.relname::text AS relname,
         pg_catalog.pg_get_userbyid(c.relowner)::text AS proprietar,
         coalesce((SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(c.relacl) x(it)
                    WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)), '{}'::text[]) AS drepturi,
         coalesce((SELECT array_agg(quote_ident(att.attname) || ' ' || x.it::text ORDER BY att.attname COLLATE "C", x.it::text COLLATE "C")
                     FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL unnest(att.attacl) x(it)
                    WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
                      AND EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)), '{}'::text[]) AS coloane,
         -- un drept al lui anon acordat de altcineva decât proprietarul: REVOKE-ul proprietarului nu l-ar scoate, revenirea nu l-ar reface exact
         (EXISTS (SELECT 1 FROM aclexplode(c.relacl) e, anon_id a WHERE e.grantee = a.oid AND e.grantor <> c.relowner)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e, anon_id a
                      WHERE att.attrelid = c.oid AND att.attnum > 0 AND e.grantee = a.oid AND e.grantor <> c.relowner)) AS alt_acordant,
         -- un drept pentru PUBLIC: anon îl are oricum (retragerea de la anon n-ar schimba dreptul efectiv)
         (EXISTS (SELECT 1 FROM aclexplode(c.relacl) e WHERE e.grantee = 0)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e
                      WHERE att.attrelid = c.oid AND att.attnum > 0 AND e.grantee = 0)) AS are_public,
         (SELECT count(*) FROM pg_catalog.pg_policy pol, anon_id a
           WHERE pol.polrelid = c.oid AND (0::oid = ANY (pol.polroles) OR a.oid = ANY (pol.polroles)))::integer AS politici_anon,
         coalesce((SELECT o.option_value FROM pg_catalog.pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker'), '-') AS invoker
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv) AS (
  SELECT x.treapta, x.oid, x.eticheta,
         'tip=' || x.tip || '; proprietar=' || x.proprietar || '; anon=' || array_to_string(x.drepturi, ',')
           || '; coloane=' || array_to_string(x.coloane, ';') || '; politici_anon=' || x.politici_anon::text || '; invoker=' || x.invoker,
         x.drepturi, x.coloane, x.motiv
    FROM (
      SELECT r.oid, r.tip, r.proprietar, r.drepturi, r.coloane, r.politici_anon, r.invoker,
             CASE r.tip WHEN 'S' THEN 'secventa' WHEN 'v' THEN 'vedere' WHEN 'm' THEN 'vedere_materializata' WHEN 'f' THEN 'tabel_strain'
                        WHEN 'p' THEN 'tabel_partitionat' ELSE 'tabel' END || ' ' || quote_ident(r.nspname) || '.' || quote_ident(r.relname) AS eticheta,
             CASE WHEN r.proprietar <> 'postgres' OR r.alt_acordant OR r.are_public THEN 'RAMANE'
                  WHEN r.oid IN (SELECT i.oid FROM anon_pastrate_inchise i) THEN 'RAMANE'
                  WHEN r.tip = 'S' AND r.oid IN (SELECT s.oid FROM anon_secvente_pastrate s) THEN 'RAMANE'
                  WHEN r.tip = 'S' THEN 'T1'
                  WHEN r.politici_anon > 0 THEN 'RAMANE'
                  ELSE 'T2' END AS treapta,
             CASE WHEN r.proprietar <> 'postgres' THEN 'proprietar ' || r.proprietar || ': nu se poate retrage ca postgres'
                  WHEN r.alt_acordant THEN 'drept acordat de alt rol decat proprietarul'
                  WHEN r.are_public THEN 'drept pentru PUBLIC (reanaliza)'
                  WHEN r.oid IN (SELECT i.oid FROM anon_pastrate_inchise i) THEN 'folosit de o pagina publica (pct. 1) sau citit de un obiect folosit'
                  WHEN r.tip = 'S' AND r.oid IN (SELECT s.oid FROM anon_secvente_pastrate s) THEN 'secventa din DEFAULT-ul unui tabel in care anon poate insera (pagina publica / politica INSERT pentru anon sau PUBLIC)'
                  WHEN r.tip <> 'S' AND r.politici_anon > 0 THEN r.politici_anon::text || ' politici pentru anon / PUBLIC (in afara T2)'
             END AS motiv
        FROM anon_rel r
       WHERE cardinality(r.drepturi) > 0 OR cardinality(r.coloane) > 0
    ) x
  UNION ALL
  -- un obiect declarat la pct. 1 care nu există (nume greșit / șters): migrările refuză
  SELECT 'LIPSA', NULL::oid, 'pastrat ' || p.obiect, 'pastrat inexistent', '{}'::text[], '{}'::text[], p.motiv
    FROM anon_pastrate p WHERE pg_catalog.to_regclass(p.obiect) IS NULL
  UNION ALL
  -- drepturile implicite (obiectele NOI): T3 = cele ale lui postgres pe public, pentru tabele / vederi și secvențe
  SELECT CASE WHEN d.rol = 'postgres' AND d.schema = 'public' AND d.tip IN ('r', 'S') THEN 'T3' ELSE 'RAMANE' END,
         NULL::oid, 'implicit ' || d.rol || ' ' || d.schema || ' ' || d.tip, 'anon=' || array_to_string(d.drepturi, ','),
         d.drepturi, '{}'::text[],
         CASE WHEN d.rol = 'postgres' AND d.schema = 'public' AND d.tip IN ('r', 'S') THEN NULL
              WHEN d.rol <> 'postgres' THEN 'rolul ' || d.rol || ': nu se poate schimba ca postgres'
              WHEN d.schema <> 'public' THEN 'implicit global, pentru toate schemele (reanaliza)'
              ELSE 'tipul ' || d.tip || ' (in afara treptelor)' END
    FROM (
      SELECT pg_catalog.pg_get_userbyid(da.defaclrole)::text AS rol, coalesce(ns.nspname::text, '(global)') AS schema, da.defaclobjtype::text AS tip,
             (SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(da.defaclacl) x(it)
               WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)) AS drepturi
        FROM pg_catalog.pg_default_acl da LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid = da.defaclnamespace
       WHERE da.defaclnamespace = 0 OR ns.nspname = 'public'
    ) d
   WHERE d.drepturi IS NOT NULL
)
-- <<< REGULA_ANON v1
SELECT g.treapta, g.oid, g.eticheta, g.detaliu, g.drepturi, g.coloane, g.motiv FROM anon_regula g
$regula$;
CREATE FUNCTION pg_temp.anon_alte_20261218c() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $alte$
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
$alte$;
CREATE TEMP TABLE anon_calc_20261218c AS SELECT * FROM pg_temp.anon_regula_20261218c();
CREATE TEMP TABLE anon_alte_inainte_20261218c AS SELECT pg_temp.anon_alte_20261218c() AS amprenta;
CREATE FUNCTION pg_temp.anon_agregat_20261218c() RETURNS TABLE (a_treapta text, a_obiecte integer, a_amprenta text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $agregat$
WITH anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv) AS (SELECT * FROM pg_temp.anon_calc_20261218c)
,
-- >>> AGREGAT_ANON v1
-- amprenta unei trepte = md5 pe liniile „eticheta = md5(detaliu)” sortate (colația C); numărul de obiecte alături. Treapta goală: 0 și md5('').
anon_agregat(treapta, obiecte, amprenta) AS (
  SELECT t.treapta, count(g.eticheta)::integer,
         md5(coalesce(string_agg(g.eticheta || ' = ' || md5(g.detaliu), chr(10) ORDER BY g.eticheta COLLATE "C"), ''))
    FROM (VALUES ('T1'), ('T2'), ('T3')) t(treapta)
    LEFT JOIN anon_regula g ON g.treapta = t.treapta
   GROUP BY t.treapta
)
-- <<< AGREGAT_ANON v1
SELECT a.treapta, a.obiecte, a.amprenta FROM anon_agregat a
$agregat$;

-- ── lista calculată = BASELINE-ul revizuit (altfel refuz, nimic schimbat) ──
DO $baseline$
DECLARE v_b record; v_c record; r record;
BEGIN
  IF (SELECT count(*) FROM pg_temp.anon_baseline_20261218c()) IS DISTINCT FROM 1::bigint
     OR EXISTS (SELECT 1 FROM pg_temp.anon_baseline_20261218c() b
                 WHERE b.treapta IS DISTINCT FROM 'T3' OR b.obiecte IS NULL OR b.obiecte < 1
                    OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$') THEN
    RAISE EXCEPTION '20261218c: BASELINE necompletat sau invalid (randul T3 din sectiunea BASELINE a scripts/anon_drepturi_citire.sql); nimic schimbat';
  END IF;
  SELECT * INTO v_b FROM pg_temp.anon_baseline_20261218c();
  IF EXISTS (SELECT 1 FROM pg_temp.anon_calc_20261218c WHERE r_treapta = 'LIPSA') THEN
    RAISE EXCEPTION '20261218c: un obiect declarat folosit de o pagina publica nu exista: %',
      (SELECT string_agg(r_eticheta, ', ') FROM pg_temp.anon_calc_20261218c WHERE r_treapta = 'LIPSA');
  END IF;
  SELECT * INTO v_c FROM pg_temp.anon_agregat_20261218c() WHERE a_treapta = 'T3';
  IF v_c.a_obiecte IS DISTINCT FROM v_b.obiecte OR v_c.a_amprenta IS DISTINCT FROM v_b.amprenta THEN
    FOR r IN SELECT c.r_eticheta, md5(c.r_detaliu) AS m FROM pg_temp.anon_calc_20261218c c WHERE c.r_treapta = 'T3'
              ORDER BY c.r_eticheta COLLATE "C" LOOP
      RAISE NOTICE '20261218c calculat acum: % = %', r.r_eticheta, r.m;
    END LOOP;
    RAISE EXCEPTION '20261218c: lista T3 de acum (% obiecte, %) difera de BASELINE-ul revizuit (% obiecte, %); nimic schimbat',
      v_c.a_obiecte, v_c.a_amprenta, v_b.obiecte, v_b.amprenta;
  END IF;
  -- T3 = exact tipurile r (tabele / vederi) și S (secvențe) ale lui postgres pe public; altceva în listă = regula s-a schimbat
  IF EXISTS (SELECT 1 FROM pg_temp.anon_calc_20261218c c
              WHERE c.r_treapta = 'T3' AND c.r_eticheta NOT IN ('implicit postgres public r', 'implicit postgres public S')) THEN
    RAISE EXCEPTION '20261218c: lista T3 are alte intrari decat tabelele / secventele lui postgres pe public';
  END IF;
END $baseline$;

-- ── jurnal, apoi retragerea drepturilor implicite (statică: pe ambele tipuri) ──
DO $jurnal$
DECLARE v_n integer;
BEGIN
  INSERT INTO securitate_intern.anon_revocari (migrare, treapta, eticheta, obiect_oid, drepturi, coloane, detaliu, amprenta, txid)
  SELECT '20261218c', 'T3', c.r_eticheta, NULL, c.r_drepturi, c.r_coloane, c.r_detaliu, md5(c.r_detaliu), txid_current()
    FROM pg_temp.anon_calc_20261218c c WHERE c.r_treapta = 'T3';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM (SELECT b.obiecte FROM pg_temp.anon_baseline_20261218c() b) THEN
    RAISE EXCEPTION '20261218c: jurnalul are % randuri, BASELINE-ul %', v_n, (SELECT b.obiecte FROM pg_temp.anon_baseline_20261218c() b);
  END IF;
END $jurnal$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- ── sonda: un tabel cu serial și o vedere create ACUM de postgres în public nu dau nimic lui anon (șterse imediat) ──
CREATE TABLE public._sec_anon_sonda_20261218c (id serial PRIMARY KEY, x text);
CREATE VIEW public._sec_anon_sonda_v_20261218c WITH (security_invoker = on) AS SELECT id, x FROM public._sec_anon_sonda_20261218c;
DO $sonda$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM (VALUES ('public._sec_anon_sonda_20261218c'::regclass), ('public._sec_anon_sonda_v_20261218c'::regclass),
                                        (pg_get_serial_sequence('public._sec_anon_sonda_20261218c', 'id')::regclass)) s(t)
   WHERE pg_get_userbyid((SELECT c.relowner FROM pg_class c WHERE c.oid = s.t)) IS DISTINCT FROM 'postgres'
      OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = s.t AND e.grantee = 'anon'::regrole)
      OR (SELECT c.relkind FROM pg_class c WHERE c.oid = s.t) <> 'S'
         AND has_table_privilege('anon', s.t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
      OR (SELECT c.relkind FROM pg_class c WHERE c.oid = s.t) = 'S'
         AND (has_sequence_privilege('anon', s.t, 'USAGE') OR has_sequence_privilege('anon', s.t, 'SELECT') OR has_sequence_privilege('anon', s.t, 'UPDATE'));
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '20261218c post: % din 3 obiecte-sonda noi primesc drepturi pentru anon (sau nu sunt ale lui postgres)', v_n;
  END IF;
END $sonda$;
DROP VIEW public._sec_anon_sonda_v_20261218c;
DROP TABLE public._sec_anon_sonda_20261218c;

-- ── postcondiții ──
DO $post$
DECLARE v_dif text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) e
              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND e.grantee = 'anon'::regrole) THEN
    RAISE EXCEPTION '20261218c post: postgres mai da implicit drepturi lui anon pe public';
  END IF;
  SELECT string_agg(r.r_eticheta, ', ') INTO v_dif FROM pg_temp.anon_regula_20261218c() r WHERE r.r_treapta = 'T3';
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218c post: drepturi implicite ramase in T3: %', v_dif; END IF;
  SELECT string_agg(coalesce(a.r_eticheta, b.r_eticheta), ', ') INTO v_dif
    FROM (SELECT r_treapta, r_eticheta, md5(r_detaliu) m FROM pg_temp.anon_calc_20261218c WHERE r_treapta <> 'T3') a
    FULL JOIN (SELECT r_treapta, r_eticheta, md5(r_detaliu) m FROM pg_temp.anon_regula_20261218c() WHERE r_treapta <> 'T3') b
      ON b.r_eticheta = a.r_eticheta AND b.r_treapta = a.r_treapta AND b.m = a.m
   WHERE a.r_eticheta IS NULL OR b.r_eticheta IS NULL;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218c post: s-au schimbat si obiecte din afara T3: %', v_dif; END IF;
  IF pg_temp.anon_alte_20261218c() IS DISTINCT FROM (SELECT a.amprenta FROM pg_temp.anon_alte_inainte_20261218c a) THEN
    RAISE EXCEPTION '20261218c post: drepturile altor roluri s-au schimbat';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218c_securitate_anon_drepturi_implicite:' || txid_current() THEN
    RAISE EXCEPTION '20261218c: garda final invalida';
  END IF;
  RAISE NOTICE '20261218c: drepturile implicite pentru anon retrase; sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
DROP FUNCTION pg_temp.anon_agregat_20261218c(), pg_temp.anon_regula_20261218c(), pg_temp.anon_alte_20261218c(), pg_temp.anon_baseline_20261218c();
DROP TABLE pg_temp.anon_calc_20261218c, pg_temp.anon_alte_inainte_20261218c;
