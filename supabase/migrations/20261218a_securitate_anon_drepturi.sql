-- Version 20261218120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261218a_securitate_anon_drepturi — TREAPTA T1 (docs/SECURITATE_ANON_DREPTURI.md): rolul anon (cererile fără cont) pierde drepturile pe
--   SECVENȚELE din schema public. Creează și jurnalul comun al celor trei trepte (securitate_intern.anon_revocari), din care revenirile refac
--   EXACT ce s-a retras. Schimbare de DREPTURI: nu se aplică fără „da”-ul owner-ului.
--
-- De ce: anon are SELECT / UPDATE / USAGE pe secvențele din public din drepturile implicite ale bazei, nu dintr-o nevoie. Nicio cerere fără cont
--   nu scrie direct într-un tabel (paginile publice merg doar prin RPC SECURITY DEFINER și prin funcții edge; analiza pct. 1 din document),
--   deci nimeni nu folosește o secvență ca anon. Secvențele nu sunt sub RLS. INSERT-ul pe o coloană IDENTITY nu cere drept pe secvență;
--   DEFAULT nextval(...) cere USAGE: regula păstrează secvențele din DEFAULT-urile obiectelor folosite de o pagină publică (azi niciunul).
--
-- Ce face (o tranzacție, prin runner):
--   1. gărzile: marcajul runnerului legat de txid, plafonul de 2000 ms, READ COMMITTED, PostgreSQL 17, postgres, reaplicare = refuz, anon fără
--      apartenențe la alte roluri;
--   2. lista T1 calculată din catalog după REGULA_ANON v1 (aceeași, octet cu octet, cu scripts/anon_drepturi_citire.sql) = EXACT BASELINE-ul
--      revizuit (număr de obiecte + amprenta listei, AGREGAT_ANON v1). Necompletat / diferit = refuz, nimic schimbat (lista de acum în NOTICE);
--   3. jurnalul: schemă nouă securitate_intern (neexpusă în API, fără niciun drept pentru alt rol decât postgres) cu tabelul anon_revocari,
--      câte un rând pe secvență, cu drepturile EXACTE ale lui anon (aclitem, cu acordantul și opțiunea de acordare);
--   4. UN SINGUR REVOKE ALL ON SEQUENCE <lista din jurnal> FROM anon (nume citate din catalog);
--   5. postcondiții: anon nu mai are niciun drept pe secvențele din jurnal (dreptul efectiv); regula recalculată ACUM nu mai găsește nimic în
--      T1 (o secvență apărută între timp = refuz); restul listei (T2 / T3 / RAMANE) neschimbat; drepturile TUTUROR celorlalte roluri neschimbate
--      (ALTE_ROLURI v1, înainte = după); jurnalul și schema fără drepturi pentru nimeni altcineva; timpul.
--
-- Lock-uri: niciun LOCK explicit. REVOKE ia ACCESS SHARE pe fiecare secvență din listă (probat: scripts/pglite/test_anon_drepturi_local.mjs) și
--   rândul ei din pg_class, ținute până la COMMIT. ACCESS SHARE se ciocnește DOAR cu ACCESS EXCLUSIVE (DROP / ALTER ținut de altă tranzacție):
--   lock_timeout 100 ms => refuz, nimic schimbat, se reia. Nu oprește nicio citire, scriere sau nextval. Câteva sute de lock-uri ACCESS SHARE
--   într-o tranzacție încap în tabela de lock-uri; „out of shared memory” = refuz, nimic schimbat (se împarte, vezi documentul).
-- Ce NU face: nicio dată, niciun drept al altui rol, nimic pe tabele / vederi (T2 = 20261218b) sau pe drepturile implicite (T3 = 20261218c).
-- Revenire: supabase/revenire/20261218a_securitate_anon_drepturi_ROLLBACK.sql (după revenirile 20261218c / 20261218b, dacă au fost aplicate).
-- Probe: scripts/pglite/test_anon_drepturi_local.mjs (local, cu mutanți) + src/anonDrepturi.test.js (static).
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218a_securitate_anon_drepturi:' || txid_current() THEN
    RAISE EXCEPTION '20261218a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261218a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261218a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261218a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261218a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regnamespace('securitate_intern') IS NOT NULL THEN
    RAISE EXCEPTION '20261218a: schema securitate_intern exista deja (reaplicare sau nume ocupat)';
  END IF;
  IF to_regrole('anon') IS NULL THEN RAISE EXCEPTION '20261218a: rolul anon lipseste'; END IF;
  -- dreptul efectiv al lui anon = direct + PUBLIC: anon nu moștenește nimic de la alte roluri (altfel retragerea directă n-ar ajunge)
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'anon'::regrole) THEN
    RAISE EXCEPTION '20261218a: anon e membru in alte roluri (reanaliza: dreptul efectiv nu e doar cel direct)';
  END IF;
END $pre$;

-- >>> BASELINE 20261218a — SINGURUL loc cu valori din producție: rândul T1 din secțiunea BASELINE a scripts/anon_drepturi_citire.sql (coloana
--     detaliu, copiată ÎNTREAGĂ). Lista pe obiecte (secțiunea OBIECT, treapta T1) intră în review și rămâne pe server. Necompletat = refuz.
CREATE FUNCTION pg_temp.anon_baseline_20261218a() RETURNS TABLE (treapta text, obiecte integer, amprenta text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $bl$
  SELECT v.treapta, v.obiecte, v.amprenta FROM (VALUES
    ('T1', NULL::integer, 'DE_COMPLETAT')
  ) v(treapta, obiecte, amprenta)
$bl$;
-- <<< BASELINE 20261218a
CREATE FUNCTION pg_temp.anon_regula_20261218a()
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
CREATE FUNCTION pg_temp.anon_alte_20261218a() RETURNS text
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
-- lista calculată O DATĂ: aceeași pentru comparația cu BASELINE-ul, jurnal și REVOKE; drepturile celorlalte roluri, înainte
CREATE TEMP TABLE anon_calc_20261218a AS SELECT * FROM pg_temp.anon_regula_20261218a();
CREATE TEMP TABLE anon_alte_inainte_20261218a AS SELECT pg_temp.anon_alte_20261218a() AS amprenta;
CREATE FUNCTION pg_temp.anon_agregat_20261218a() RETURNS TABLE (a_treapta text, a_obiecte integer, a_amprenta text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $agregat$
WITH anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv) AS (SELECT * FROM pg_temp.anon_calc_20261218a)
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
  IF (SELECT count(*) FROM pg_temp.anon_baseline_20261218a()) IS DISTINCT FROM 1::bigint
     OR EXISTS (SELECT 1 FROM pg_temp.anon_baseline_20261218a() b
                 WHERE b.treapta IS DISTINCT FROM 'T1' OR b.obiecte IS NULL OR b.obiecte < 1
                    OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$') THEN
    RAISE EXCEPTION '20261218a: BASELINE necompletat sau invalid (randul T1 din sectiunea BASELINE a scripts/anon_drepturi_citire.sql); nimic schimbat';
  END IF;
  SELECT * INTO v_b FROM pg_temp.anon_baseline_20261218a();
  IF EXISTS (SELECT 1 FROM pg_temp.anon_calc_20261218a WHERE r_treapta = 'LIPSA') THEN
    RAISE EXCEPTION '20261218a: un obiect declarat folosit de o pagina publica nu exista: %',
      (SELECT string_agg(r_eticheta, ', ') FROM pg_temp.anon_calc_20261218a WHERE r_treapta = 'LIPSA');
  END IF;
  SELECT * INTO v_c FROM pg_temp.anon_agregat_20261218a() WHERE a_treapta = 'T1';
  IF v_c.a_obiecte IS DISTINCT FROM v_b.obiecte OR v_c.a_amprenta IS DISTINCT FROM v_b.amprenta THEN
    FOR r IN SELECT c.r_eticheta, md5(c.r_detaliu) AS m FROM pg_temp.anon_calc_20261218a c WHERE c.r_treapta = 'T1'
              ORDER BY c.r_eticheta COLLATE "C" LOOP
      RAISE NOTICE '20261218a calculat acum: % = %', r.r_eticheta, r.m;
    END LOOP;
    RAISE EXCEPTION '20261218a: lista T1 de acum (% obiecte, %) difera de BASELINE-ul revizuit (% obiecte, %): ceva s-a schimbat de la citire (obiect nou / sters / alte drepturi); se compara NOTICE-urile cu sectiunea OBIECT a citirii; nimic schimbat',
      v_c.a_obiecte, v_c.a_amprenta, v_b.obiecte, v_b.amprenta;
  END IF;
END $baseline$;

-- ── jurnalul comun al treptelor (neexpus în API, doar postgres) ──
CREATE SCHEMA securitate_intern;
REVOKE ALL ON SCHEMA securitate_intern FROM PUBLIC;
CREATE TABLE securitate_intern.anon_revocari (
  migrare text NOT NULL CHECK (migrare IN ('20261218a', '20261218b', '20261218c')),
  treapta text NOT NULL CHECK (treapta IN ('T1', 'T2', 'T3')),
  eticheta text NOT NULL,
  obiect_oid oid,
  drepturi text[] NOT NULL,
  coloane text[] NOT NULL,
  detaliu text NOT NULL,
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  txid bigint NOT NULL,
  inregistrat_la timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migrare, eticheta),
  CHECK ((treapta = 'T3') = (obiect_oid IS NULL)),
  CHECK (cardinality(drepturi) + cardinality(coloane) > 0)
);
REVOKE ALL ON TABLE securitate_intern.anon_revocari FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE securitate_intern.anon_revocari ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE securitate_intern.anon_revocari IS 'Drepturile exacte ale rolului anon retrase de 20261218a / b / c (docs/SECURITATE_ANON_DREPTURI.md); revenirile le refac din acest jurnal.';

-- ── jurnal, apoi UN SINGUR REVOKE pe lista din jurnal ──
DO $aplica$
DECLARE v_lista text; v_n integer;
BEGIN
  INSERT INTO securitate_intern.anon_revocari (migrare, treapta, eticheta, obiect_oid, drepturi, coloane, detaliu, amprenta, txid)
  SELECT '20261218a', 'T1', c.r_eticheta, c.r_oid, c.r_drepturi, c.r_coloane, c.r_detaliu, md5(c.r_detaliu), txid_current()
    FROM pg_temp.anon_calc_20261218a c WHERE c.r_treapta = 'T1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM (SELECT b.obiecte FROM pg_temp.anon_baseline_20261218a() b) THEN
    RAISE EXCEPTION '20261218a: jurnalul are % randuri, BASELINE-ul %', v_n, (SELECT b.obiecte FROM pg_temp.anon_baseline_20261218a() b);
  END IF;
  -- numele citate din catalog, pe oid-ul din jurnal; fiecare rând = o secvență (relkind S) cu eticheta din listă
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"), count(*)
    INTO v_lista, v_n
    FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE j.migrare = '20261218a' AND c.relkind = 'S' AND j.eticheta = 'secventa ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname);
  IF v_n IS DISTINCT FROM (SELECT count(*)::integer FROM securitate_intern.anon_revocari WHERE migrare = '20261218a') THEN
    RAISE EXCEPTION '20261218a: jurnalul nu corespunde catalogului (% din %)', v_n, (SELECT count(*) FROM securitate_intern.anon_revocari WHERE migrare = '20261218a');
  END IF;
  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM anon';
  RAISE NOTICE '20261218a: REVOKE pe % secvente la % ms de la BEGIN', v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $aplica$;

-- ── postcondiții ──
DO $post$
DECLARE v_n integer; v_dif text;
BEGIN
  -- a. anon nu mai are NICIUN drept pe secvențele din jurnal (dreptul efectiv include PUBLIC)
  SELECT string_agg(j.eticheta, ', ') INTO v_dif FROM securitate_intern.anon_revocari j
   WHERE j.migrare = '20261218a'
     AND (has_sequence_privilege('anon', j.obiect_oid, 'SELECT') OR has_sequence_privilege('anon', j.obiect_oid, 'UPDATE')
          OR has_sequence_privilege('anon', j.obiect_oid, 'USAGE')
          OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = j.obiect_oid AND e.grantee = 'anon'::regrole));
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218a post: anon mai are drepturi pe %', v_dif; END IF;
  -- b. regula recalculată ACUM: nimic în T1 (o secvență apărută între timp, pe care n-am revizuit-o = refuz)
  SELECT string_agg(r.r_eticheta, ', ') INTO v_dif FROM pg_temp.anon_regula_20261218a() r WHERE r.r_treapta = 'T1';
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218a post: secvente noi cu drept pentru anon, nerevizuite: %', v_dif; END IF;
  -- c. restul listei (alte trepte, ce rămâne) neschimbat
  SELECT string_agg(coalesce(a.r_eticheta, b.r_eticheta), ', ') INTO v_dif
    FROM (SELECT r_treapta, r_eticheta, md5(r_detaliu) m FROM pg_temp.anon_calc_20261218a WHERE r_treapta <> 'T1') a
    FULL JOIN (SELECT r_treapta, r_eticheta, md5(r_detaliu) m FROM pg_temp.anon_regula_20261218a() WHERE r_treapta <> 'T1') b
      ON b.r_eticheta = a.r_eticheta AND b.r_treapta = a.r_treapta AND b.m = a.m
   WHERE a.r_eticheta IS NULL OR b.r_eticheta IS NULL;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218a post: s-au schimbat si obiecte din afara T1: %', v_dif; END IF;
  -- d. drepturile TUTUROR celorlalte roluri: exact ca înainte
  IF pg_temp.anon_alte_20261218a() IS DISTINCT FROM (SELECT a.amprenta FROM pg_temp.anon_alte_inainte_20261218a a) THEN
    RAISE EXCEPTION '20261218a post: drepturile altor roluri s-au schimbat';
  END IF;
  -- e. jurnalul: al lui postgres, nimeni altcineva nu are vreun drept pe el sau pe schema lui
  IF pg_get_userbyid((SELECT c.relowner FROM pg_class c WHERE c.oid = 'securitate_intern.anon_revocari'::regclass)) IS DISTINCT FROM 'postgres'
     OR pg_get_userbyid((SELECT n.nspowner FROM pg_namespace n WHERE n.nspname = 'securitate_intern')) IS DISTINCT FROM 'postgres'
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
                 WHERE c.oid = 'securitate_intern.anon_revocari'::regclass AND e.grantee <> c.relowner)
     OR EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) e
                 WHERE n.nspname = 'securitate_intern' AND e.grantee <> n.nspowner)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'securitate_intern.anon_revocari'::regclass AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261218a post: jurnalul sau schema lui au drepturi pentru alte roluri';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218a_securitate_anon_drepturi:' || txid_current() THEN
    RAISE EXCEPTION '20261218a: garda final invalida';
  END IF;
  SELECT count(*) INTO v_n FROM securitate_intern.anon_revocari WHERE migrare = '20261218a';
  RAISE NOTICE '20261218a: % secvente retrase de la anon; sfarsit la % ms de la BEGIN', v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
DROP FUNCTION pg_temp.anon_agregat_20261218a(), pg_temp.anon_regula_20261218a(), pg_temp.anon_alte_20261218a(), pg_temp.anon_baseline_20261218a();
DROP TABLE pg_temp.anon_calc_20261218a, pg_temp.anon_alte_inainte_20261218a;
