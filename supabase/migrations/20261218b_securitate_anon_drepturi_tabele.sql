-- Version 20261218130000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261218b_securitate_anon_drepturi_tabele — TREAPTA T2 (docs/SECURITATE_ANON_DREPTURI.md): rolul anon (cererile fără cont) pierde TOATE
--   drepturile (pe obiect și pe coloane) pe tabelele și vederile din public care NU au nicio politică pentru anon / PUBLIC și nu sunt folosite
--   de o pagină publică. Cere 20261218a aplicată (jurnalul comun). Schimbare de DREPTURI: nu se aplică fără „da”-ul owner-ului.
--
-- De ce: azi aceste drepturi nu dau nimic (RLS pornit peste tot și nicio politică pentru anon: 0 rânduri; vederile sunt security_invoker),
--   dar sunt drepturi neutilizate pe sute de obiecte, apar în fiecare amprentă de acces revizuită și ar deveni active la prima politică
--   greșită. Paginile publice nu le folosesc (pct. 1: doar RPC SECURITY DEFINER și funcții edge). Riscul dacă ne-am înșelat: o cerere fără
--   cont pe un astfel de obiect primește eroare de drept (42501 / 401) în loc de listă goală — se repară cu revenirea, exact.
--
-- CONDIȚIE în plus față de T1 / T3 (review #1081 P1): interfața ERP interoghează azi unele tabele ca anon, fără sesiune (contoare, notificări,
--   chat; statisticile de pe producție). T2 NU se aplică înainte ca PR-ul „client fără interogări fără sesiune” să fie pe producție și o citire
--   nouă (statistici resetate după deploy) să arate zero interogări directe ca anon pe tabele (docs/SECURITATE_ANON_DREPTURI.md §2 și §6).
-- Ce face: ca 20261218a, pe treapta T2 — gărzile; lista T2 calculată din catalog (REGULA_ANON v2) = EXACT BASELINE-ul revizuit (necompletat /
--   diferit = refuz, lista de acum în NOTICE); câte un rând de jurnal pe obiect cu drepturile EXACTE ale lui anon (pe obiect + pe coloane,
--   coloana identificată prin attnum + tip + nume); BLOCAREA rândurilor din pg_class (retragere fără efect FROM PUBLIC, dovedită pe xmin) +
--   RECITIREA regulii = jurnalul; UN SINGUR REVOKE ALL ON TABLE <lista> FROM anon (scoate și drepturile pe coloane); verificarea coloanelor
--   neblocate (mai jos); postcondiții: anon nu mai are niciun drept efectiv pe ele (obiect și coloane), regula recalculată ACUM nu mai găsește
--   nimic în T2 (obiect apărut între timp = refuz), restul listei neschimbat, drepturile tuturor celorlalte roluri neschimbate (ALTE_ROLURI v1),
--   timpul.
-- Ce se detectează EXACT: ca la 20261218a (înainte de calcul => BASELINE; între calcul și blocare => recitirea; după blocare, pe aceleași
--   obiecte, GRANT / REVOKE / ALTER care rescriu rândul din pg_class => așteaptă și pică după COMMIT-ul nostru), plus COLOANELE: retragerea
--   fără efect rescrie (deci blochează) doar rândurile din pg_attribute care au deja drepturi; un GRANT pe o coloană fără drepturi nu atinge
--   rândul tabelului din pg_class (probat în PGlite), deci poate fi comis între recitire și REVOKE, iar REVOKE l-ar scoate fără jurnal. De
--   aceea, după REVOKE: rândurile din pg_attribute ale obiectelor din jurnal rescrise de această tranzacție = EXACT cele care aveau drepturi la
--   recitire; o coloană în plus = drept apărut concurent => refuz, nimic schimbat (al celeilalte sesiuni rămâne).
--   Garanția: ce retrage REVOKE-ul = EXACT ce e în jurnal (obiect și coloane).
-- Partiții / moștenire: GRANT / REVOKE nu se propagă. Fiecare relație e judecată separat (părintele și fiecare partiție au rândul lor);
--   retragerea pe părinte nu atinge partițiile și invers. O cerere pe părinte verifică doar dreptul pe părinte (partițiile citite prin el nu
--   cer drept), una direct pe partiție doar dreptul pe partiție — probat în scripts/pglite/test_anon_drepturi_local.mjs.
-- Lock-uri (PostgreSQL 17.6): GRANT / REVOKE NU iau lock pe tabele / vederi (NoLock); deschid pg_class / pg_attribute cu RowExclusiveLock și
--   rescriu rândurile. NU opresc citiri / scrieri. Rândurile rescrise la blocare rămân ale noastre până la COMMIT: un DDL / GRANT concurent care
--   rescrie același rând așteaptă și pică după COMMIT-ul nostru; noi așteptăm doar după o tranzacție care rescrisese deja rândul (lock_timeout
--   100 ms => refuz). VACUUM / ANALYZE pe aceste obiecte pot aștepta cel mult cât tranzacția. Durata: proba pe clonă PG17 (§5 din document).
-- Ce NU face: nicio dată; nu atinge tabelele cu politici pentru anon / PUBLIC (rămân, cu motivul, în citire), nici alt rol, nici drepturile
--   implicite (T3 = 20261218c).
-- Revenire: supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218b_securitate_anon_drepturi_tabele:' || txid_current() THEN
    RAISE EXCEPTION '20261218b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261218b: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261218b: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261218b: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261218b: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('securitate_intern.anon_revocari') IS NULL THEN
    RAISE EXCEPTION '20261218b: jurnalul securitate_intern.anon_revocari lipseste (se aplica intai 20261218a)';
  END IF;
  IF EXISTS (SELECT 1 FROM securitate_intern.anon_revocari WHERE migrare = '20261218b') THEN
    RAISE EXCEPTION '20261218b: jurnalul are deja randuri 20261218b (reaplicare)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'anon'::regrole) THEN
    RAISE EXCEPTION '20261218b: anon e membru in alte roluri (reanaliza: dreptul efectiv nu e doar cel direct)';
  END IF;
END $pre$;

-- >>> BASELINE 20261218b — SINGURUL loc cu valori din producție: rândul T2 din secțiunea BASELINE a scripts/anon_drepturi_citire.sql (coloana
--     detaliu, copiată ÎNTREAGĂ). Lista pe obiecte (secțiunea OBIECT, treapta T2) intră în review și rămâne pe server. Necompletat = refuz.
CREATE FUNCTION pg_temp.anon_baseline_20261218b() RETURNS TABLE (treapta text, obiecte integer, amprenta text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $bl$
  SELECT v.treapta, v.obiecte, v.amprenta FROM (VALUES
    ('T2', NULL::integer, 'DE_COMPLETAT')
  ) v(treapta, obiecte, amprenta)
$bl$;
-- <<< BASELINE 20261218b
CREATE FUNCTION pg_temp.anon_regula_20261218b()
RETURNS TABLE (r_treapta text, r_oid oid, r_eticheta text, r_detaliu text, r_drepturi text[], r_coloane text[], r_motiv text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $regula$
WITH RECURSIVE
-- >>> REGULA_ANON v2
-- (L19: O SINGURĂ definiție, copiată octet cu octet în scripts/anon_drepturi_citire.sql și în migrările 20261218a / b / c; testul
--  src/anonDrepturi.test.js verifică identitatea.) Rezultatul: anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv),
--  treapta = T1 (secvență de retras) | T2 (tabel / vedere de retras) | T3 (drept implicit de retras) | RAMANE (cu motivul) | LIPSA.
-- v2 (review #1081): detaliul (deci amprenta din BASELINE) cuprinde și IDENTITATEA obiectului (oid), RLS / FORCE, părinții (partiție /
--   moștenire), opțiunile, regulile (corpul vederii), TOATE politicile (nume, comandă, fel, roluri, expresiile USING / CHECK) și DEFAULT-urile
--   (la o secvență: DEFAULT-urile care o folosesc). Corpurile sunt arborii interni din catalog (pg_rewrite / pg_policy / pg_attrdef), care
--   conțin oid-urile obiectelor referite, citiți ca text FĂRĂ lock (pg_get_viewdef / pg_get_expr ar deparsa și ar lua lock-uri pe obiectele
--   referite). Deci un obiect șters și recreat cu același nume, o vedere / politică / DEFAULT rescrise schimbă amprenta. Coloanele (cu
--   sistemul inclus): „attnum:tip:typmod nume aclitem”: o coloană redenumită și alta nouă cu numele vechi nu se confundă la revenire.
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
-- relațiile din public și drepturile EXACTE ale lui anon pe ele (pe obiect și pe coloane, aclitem cu acordantul) + identitatea lor (v2)
anon_rel AS (
  SELECT c.oid, c.relkind::text AS tip, n.nspname::text AS nspname, c.relname::text AS relname,
         pg_catalog.pg_get_userbyid(c.relowner)::text AS proprietar,
         coalesce((SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(c.relacl) x(it)
                    WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)), '{}'::text[]) AS drepturi,
         coalesce((SELECT array_agg(att.attnum::text || ':' || att.atttypid::text || ':' || att.atttypmod::text || ' ' || quote_ident(att.attname)
                                    || ' ' || x.it::text ORDER BY att.attnum, x.it::text COLLATE "C")
                     FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL unnest(att.attacl) x(it)
                    WHERE att.attrelid = c.oid AND NOT att.attisdropped
                      AND EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)), '{}'::text[]) AS coloane,
         -- un drept al lui anon acordat de altcineva decât proprietarul: REVOKE-ul proprietarului nu l-ar scoate, revenirea nu l-ar reface exact
         (EXISTS (SELECT 1 FROM aclexplode(c.relacl) e, anon_id a WHERE e.grantee = a.oid AND e.grantor <> c.relowner)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e, anon_id a
                      WHERE att.attrelid = c.oid AND NOT att.attisdropped AND e.grantee = a.oid AND e.grantor <> c.relowner)) AS alt_acordant,
         -- un drept pentru PUBLIC: anon îl are oricum (retragerea de la anon n-ar schimba dreptul efectiv). Și: blocarea din migrări (o
         -- retragere FROM PUBLIC fără efect) cere ca PUBLIC să nu aibă nimic pe obiectele de retras.
         (EXISTS (SELECT 1 FROM aclexplode(c.relacl) e WHERE e.grantee = 0)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e
                      WHERE att.attrelid = c.oid AND NOT att.attisdropped AND e.grantee = 0)) AS are_public,
         (SELECT count(*) FROM pg_catalog.pg_policy pol, anon_id a
           WHERE pol.polrelid = c.oid AND (0::oid = ANY (pol.polroles) OR a.oid = ANY (pol.polroles)))::integer AS politici_anon,
         coalesce((SELECT o.option_value FROM pg_catalog.pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker'), '-') AS invoker,
         c.relrowsecurity::text || '/' || c.relforcerowsecurity::text AS rls,
         coalesce((SELECT string_agg(i.inhparent::text, ',' ORDER BY i.inhseqno) FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid), '-') AS parinti,
         coalesce(array_to_string(c.reloptions, ','), '-') AS optiuni,
         coalesce((SELECT md5(string_agg(rw.rulename::text || ':' || rw.ev_type::text || ':' || rw.ev_enabled::text || ':' || rw.is_instead::text
                                         || ':' || rw.ev_qual::text || ':' || rw.ev_action::text, chr(10) ORDER BY rw.rulename COLLATE "C"))
                     FROM pg_catalog.pg_rewrite rw WHERE rw.ev_class = c.oid), '-') AS reguli,
         coalesce((SELECT md5(string_agg(pol.polname::text || ':' || pol.polcmd::text || ':' || pol.polpermissive::text || ':' || pol.polroles::text
                                         || ':' || coalesce(pol.polqual::text, '-') || ':' || coalesce(pol.polwithcheck::text, '-'),
                                         chr(10) ORDER BY pol.polname COLLATE "C"))
                     FROM pg_catalog.pg_policy pol WHERE pol.polrelid = c.oid), '-') AS politici,
         coalesce((SELECT md5(string_agg(y.l, chr(10) ORDER BY y.l COLLATE "C")) FROM (
                     SELECT ad.adrelid::text || '.' || ad.adnum::text || '=' || ad.adbin::text AS l FROM pg_catalog.pg_attrdef ad WHERE ad.adrelid = c.oid
                     UNION
                     SELECT ad.adrelid::text || '.' || ad.adnum::text || '=' || ad.adbin::text
                       FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_attrdef ad ON ad.oid = d.objid
                      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = c.oid AND d.classid = 'pg_catalog.pg_attrdef'::regclass) y), '-') AS implicite
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv) AS (
  SELECT x.treapta, x.oid, x.eticheta,
         'tip=' || x.tip || '; oid=' || x.oid::text || '; proprietar=' || x.proprietar || '; anon=' || array_to_string(x.drepturi, ',')
           || '; coloane=' || array_to_string(x.coloane, ';') || '; politici_anon=' || x.politici_anon::text || '; invoker=' || x.invoker
           || '; rls=' || x.rls || '; parinti=' || x.parinti || '; optiuni=' || x.optiuni || '; reguli=' || x.reguli
           || '; politici=' || x.politici || '; implicite=' || x.implicite,
         x.drepturi, x.coloane, x.motiv
    FROM (
      SELECT r.oid, r.tip, r.proprietar, r.drepturi, r.coloane, r.politici_anon, r.invoker, r.rls, r.parinti, r.optiuni, r.reguli, r.politici, r.implicite,
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
-- <<< REGULA_ANON v2
SELECT g.treapta, g.oid, g.eticheta, g.detaliu, g.drepturi, g.coloane, g.motiv FROM anon_regula g
$regula$;
CREATE FUNCTION pg_temp.anon_alte_20261218b() RETURNS text
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
CREATE TEMP TABLE anon_calc_20261218b AS SELECT * FROM pg_temp.anon_regula_20261218b();
CREATE TEMP TABLE anon_alte_inainte_20261218b AS SELECT pg_temp.anon_alte_20261218b() AS amprenta;
CREATE FUNCTION pg_temp.anon_agregat_20261218b() RETURNS TABLE (a_treapta text, a_obiecte integer, a_amprenta text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $agregat$
WITH anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv) AS (SELECT * FROM pg_temp.anon_calc_20261218b)
,
-- >>> AGREGAT_ANON v2
-- amprenta unei trepte = md5 pe liniile „eticheta = md5(detaliu)” sortate (colația C); numărul de obiecte alături. Treapta goală: 0 și md5('').
-- v2: și RAMANE (ce nu se retrage, cu motivul), pentru controlul periodic (secțiunea CONTROL a citirii): un obiect nou al lui supabase_admin,
--   o politică / un drept nou pe un obiect rămas îi schimbă amprenta.
anon_agregat(treapta, obiecte, amprenta) AS (
  SELECT t.treapta, count(g.eticheta)::integer,
         md5(coalesce(string_agg(g.eticheta || ' = ' || md5(g.detaliu), chr(10) ORDER BY g.eticheta COLLATE "C"), ''))
    FROM (VALUES ('T1'), ('T2'), ('T3'), ('RAMANE')) t(treapta)
    LEFT JOIN anon_regula g ON g.treapta = t.treapta
   GROUP BY t.treapta
)
-- <<< AGREGAT_ANON v2
SELECT a.treapta, a.obiecte, a.amprenta FROM anon_agregat a
$agregat$;

-- ── lista calculată = BASELINE-ul revizuit (altfel refuz, nimic schimbat) ──
DO $baseline$
DECLARE v_b record; v_c record; r record;
BEGIN
  IF (SELECT count(*) FROM pg_temp.anon_baseline_20261218b()) IS DISTINCT FROM 1::bigint
     OR EXISTS (SELECT 1 FROM pg_temp.anon_baseline_20261218b() b
                 WHERE b.treapta IS DISTINCT FROM 'T2' OR b.obiecte IS NULL OR b.obiecte < 1
                    OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$') THEN
    RAISE EXCEPTION '20261218b: BASELINE necompletat sau invalid (randul T2 din sectiunea BASELINE a scripts/anon_drepturi_citire.sql); nimic schimbat';
  END IF;
  SELECT * INTO v_b FROM pg_temp.anon_baseline_20261218b();
  IF EXISTS (SELECT 1 FROM pg_temp.anon_calc_20261218b WHERE r_treapta = 'LIPSA') THEN
    RAISE EXCEPTION '20261218b: un obiect declarat folosit de o pagina publica nu exista: %',
      (SELECT string_agg(r_eticheta, ', ') FROM pg_temp.anon_calc_20261218b WHERE r_treapta = 'LIPSA');
  END IF;
  SELECT * INTO v_c FROM pg_temp.anon_agregat_20261218b() WHERE a_treapta = 'T2';
  IF v_c.a_obiecte IS DISTINCT FROM v_b.obiecte OR v_c.a_amprenta IS DISTINCT FROM v_b.amprenta THEN
    FOR r IN SELECT c.r_eticheta, md5(c.r_detaliu) AS m FROM pg_temp.anon_calc_20261218b c WHERE c.r_treapta = 'T2'
              ORDER BY c.r_eticheta COLLATE "C" LOOP
      RAISE NOTICE '20261218b calculat acum: % = %', r.r_eticheta, r.m;
    END LOOP;
    RAISE EXCEPTION '20261218b: lista T2 de acum (% obiecte, %) difera de BASELINE-ul revizuit (% obiecte, %): ceva s-a schimbat de la citire (obiect nou / sters / alte drepturi / politici); se compara NOTICE-urile cu sectiunea OBIECT a citirii; nimic schimbat',
      v_c.a_obiecte, v_c.a_amprenta, v_b.obiecte, v_b.amprenta;
  END IF;
END $baseline$;

-- ── jurnal, blocarea rândurilor + recitirea, apoi UN SINGUR REVOKE pe lista din jurnal + verificarea coloanelor ──
DO $aplica$
DECLARE v_lista text; v_n integer; v_xid text; v_dif text; v_col text[]; v_col_dupa text[];
BEGIN
  INSERT INTO securitate_intern.anon_revocari (migrare, treapta, eticheta, obiect_oid, drepturi, coloane, detaliu, amprenta, txid)
  SELECT '20261218b', 'T2', c.r_eticheta, c.r_oid, c.r_drepturi, c.r_coloane, c.r_detaliu, md5(c.r_detaliu), txid_current()
    FROM pg_temp.anon_calc_20261218b c WHERE c.r_treapta = 'T2';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM (SELECT b.obiecte FROM pg_temp.anon_baseline_20261218b() b) THEN
    RAISE EXCEPTION '20261218b: jurnalul are % randuri, BASELINE-ul %', v_n, (SELECT b.obiecte FROM pg_temp.anon_baseline_20261218b() b);
  END IF;
  -- numele citate din catalog, pe oid-ul din jurnal; fiecare rând = o relație cu eticheta din listă (tipul inclus)
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"), count(*)
    INTO v_lista, v_n
    FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE j.migrare = '20261218b' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND j.eticheta = CASE c.relkind WHEN 'v' THEN 'vedere' WHEN 'm' THEN 'vedere_materializata' WHEN 'f' THEN 'tabel_strain'
                                     WHEN 'p' THEN 'tabel_partitionat' ELSE 'tabel' END || ' ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname);
  IF v_n IS DISTINCT FROM (SELECT count(*)::integer FROM securitate_intern.anon_revocari WHERE migrare = '20261218b') THEN
    RAISE EXCEPTION '20261218b: jurnalul nu corespunde catalogului (% din %)', v_n, (SELECT count(*) FROM securitate_intern.anon_revocari WHERE migrare = '20261218b');
  END IF;
  -- blocarea: retragere fără efect de la PUBLIC => rândul fiecărei relații din pg_class (și al coloanelor cu drepturi din pg_attribute) e
  -- rescris de noi și rămâne al nostru până la COMMIT
  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM PUBLIC';
  v_xid := (txid_current() % 4294967296)::text;
  SELECT string_agg(j.eticheta, ', ') INTO v_dif
    FROM securitate_intern.anon_revocari j LEFT JOIN pg_class c ON c.oid = j.obiect_oid
   WHERE j.migrare = '20261218b' AND c.xmin::text IS DISTINCT FROM v_xid;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261218b: blocarea randurilor din catalog nu s-a facut pe: % (nimic schimbat)', v_dif;
  END IF;
  -- recitirea pe rândurile blocate: regula de ACUM pe T2 = EXACT jurnalul
  SELECT string_agg(coalesce(a.eticheta, b.r_eticheta), ', ') INTO v_dif
    FROM (SELECT eticheta, detaliu FROM securitate_intern.anon_revocari WHERE migrare = '20261218b') a
    FULL JOIN (SELECT r_eticheta, r_detaliu FROM pg_temp.anon_regula_20261218b() WHERE r_treapta = 'T2') b
      ON b.r_eticheta = a.eticheta AND b.r_detaliu = a.detaliu
   WHERE a.eticheta IS NULL OR b.r_eticheta IS NULL;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261218b: schimbare concurenta intre calculul listei si blocare pe: % (nimic schimbat; se reia citirea)', v_dif;
  END IF;
  -- coloanele (inclusiv cele de sistem) cu drepturi, la recitire: REVOKE le va rescrie pe toate și NUMAI pe ele
  v_col := ARRAY(SELECT a.attrelid::text || '.' || a.attnum::text
                   FROM securitate_intern.anon_revocari j JOIN pg_attribute a ON a.attrelid = j.obiect_oid
                  WHERE j.migrare = '20261218b' AND NOT a.attisdropped AND a.attacl IS NOT NULL ORDER BY a.attrelid, a.attnum);
  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';
  -- coloanele rescrise de această tranzacție = EXACT cele de la recitire; una în plus = drept dat concurent pe o coloană neblocată => refuz
  v_col_dupa := ARRAY(SELECT a.attrelid::text || '.' || a.attnum::text
                        FROM securitate_intern.anon_revocari j JOIN pg_attribute a ON a.attrelid = j.obiect_oid
                       WHERE j.migrare = '20261218b' AND NOT a.attisdropped AND a.xmin::text = v_xid ORDER BY a.attrelid, a.attnum);
  IF v_col_dupa IS DISTINCT FROM v_col THEN
    RAISE EXCEPTION '20261218b: drepturi pe coloane schimbate concurent intre recitire si retragere (% coloane rescrise, % la recitire; nimic schimbat)',
      cardinality(v_col_dupa), cardinality(v_col);
  END IF;
  RAISE NOTICE '20261218b: REVOKE pe % tabele / vederi la % ms de la BEGIN', v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $aplica$;

-- ── postcondiții ──
DO $post$
DECLARE v_n integer; v_dif text;
BEGIN
  -- a. anon nu mai are NICIUN drept efectiv (pe obiect sau pe vreo coloană) pe relațiile din jurnal
  SELECT string_agg(j.eticheta, ', ') INTO v_dif FROM securitate_intern.anon_revocari j
   WHERE j.migrare = '20261218b'
     AND (has_table_privilege('anon', j.obiect_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
          OR has_any_column_privilege('anon', j.obiect_oid, 'SELECT, INSERT, UPDATE, REFERENCES')
          OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = j.obiect_oid AND e.grantee = 'anon'::regrole)
          OR EXISTS (SELECT 1 FROM pg_attribute a, aclexplode(a.attacl) e WHERE a.attrelid = j.obiect_oid AND NOT a.attisdropped AND e.grantee = 'anon'::regrole));
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b post: anon mai are drepturi pe %', v_dif; END IF;
  -- b. regula recalculată ACUM: nimic în T2 (un obiect apărut între timp, nerevizuit = refuz)
  SELECT string_agg(r.r_eticheta, ', ') INTO v_dif FROM pg_temp.anon_regula_20261218b() r WHERE r.r_treapta = 'T2';
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b post: obiecte noi cu drept pentru anon, nerevizuite: %', v_dif; END IF;
  -- c. restul listei (alte trepte, ce rămâne) neschimbat
  SELECT string_agg(coalesce(a.r_eticheta, b.r_eticheta), ', ') INTO v_dif
    FROM (SELECT r_treapta, r_eticheta, md5(r_detaliu) m FROM pg_temp.anon_calc_20261218b WHERE r_treapta <> 'T2') a
    FULL JOIN (SELECT r_treapta, r_eticheta, md5(r_detaliu) m FROM pg_temp.anon_regula_20261218b() WHERE r_treapta <> 'T2') b
      ON b.r_eticheta = a.r_eticheta AND b.r_treapta = a.r_treapta AND b.m = a.m
   WHERE a.r_eticheta IS NULL OR b.r_eticheta IS NULL;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b post: s-au schimbat si obiecte din afara T2: %', v_dif; END IF;
  -- d. drepturile TUTUROR celorlalte roluri: exact ca înainte
  IF pg_temp.anon_alte_20261218b() IS DISTINCT FROM (SELECT a.amprenta FROM pg_temp.anon_alte_inainte_20261218b a) THEN
    RAISE EXCEPTION '20261218b post: drepturile altor roluri s-au schimbat';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261218b_securitate_anon_drepturi_tabele:' || txid_current() THEN
    RAISE EXCEPTION '20261218b: garda final invalida';
  END IF;
  SELECT count(*) INTO v_n FROM securitate_intern.anon_revocari WHERE migrare = '20261218b';
  RAISE NOTICE '20261218b: % tabele / vederi retrase de la anon; sfarsit la % ms de la BEGIN', v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
DROP FUNCTION pg_temp.anon_agregat_20261218b(), pg_temp.anon_regula_20261218b(), pg_temp.anon_alte_20261218b(), pg_temp.anon_baseline_20261218b();
DROP TABLE pg_temp.anon_calc_20261218b, pg_temp.anon_alte_inainte_20261218b;
