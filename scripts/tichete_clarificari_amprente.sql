-- Amprenta L15 pentru migrarea 20261223a_tichete_clarificari — DOAR CITIRE, pentru coordonator, pe PRODUCȚIE (și pe clonă).
-- Rulare (o tranzacție READ ONLY, nimic scris; parola din pgpass, niciodată în comandă):
--   psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -f scripts/tichete_clarificari_amprente.sql > amprente_20261223a.txt
-- Ce tipărește:
--   1. eticheta | amprenta (md5 pe „detaliu”) | linie_baseline (de copiat în blocul BASELINE al migrării) | sursa | atentie | detaliu
--      * tabelele în care scriu funcțiile noi: tichete, tichete_comentarii, notifications (drepturi, RLS + FORCE, TOATE politicile, TOATE
--        triggerele, secvențele);
--      * funcțiile: ÎNCHIDEREA tranzitivă (blocul INCHIDERE_L15, IDENTIC cu cel din migrare): pornirea = funcțiile triggerelor care se
--        declanșează la scrierile noastre (UPDATE pe tichete; INSERT pe tichete_comentarii și notifications), apoi apelurile „nume(”,
--        pg_depend și triggerele tabelelor în care lanțul scrie, fără limită de adâncime (sursa = „lant”); plus funcțiile politicilor și
--        ale celorlalte triggere ale celor trei tabele, care NU rulează la scrierile noastre (sursa = „amprentat”: doar amprenta);
--      * „atentie” = ce trebuie privit cu ochii înainte de a accepta baseline-ul: drepturi pentru anon / PUBLIC, politici USING true,
--        DEFINER fără search_path și EXECUTE pe lanț (migrarea le REFUZĂ), o funcție din lanț care pare să trimită ceva în afara
--        platformei (http / net. / mail / sms / push / pg_notify: scrierea noastră NU trebuie să pornească mailuri sau SMS-uri).
--      * definitie_lant = definiția întreagă (pg_get_functiondef) a fiecărei funcții din LANȚ: răspunsul la „ce face fiecare trigger la
--        un UPDATE doar pe metadata și la un comentariu / o notificare nouă” (istoric umflat? notificări false? trimiteri în afară?).
--   2. triggerele care se declanșează la scrierile noastre (tabel, nume, stare, definiția cu coloane / WHEN, funcția) — intră în review.
--   3. numărători fără conținut: tichetele eligibile pe status / subcategorie și câte au deja evidența clarificari_erp (cerut: 0).
-- Cum se folosește: coloana linie_baseline din secțiunea 1, în ordinea afișată, se copiază ÎNTREAGĂ între marcajele
--   „>>> BASELINE 20261223a” / „<<< BASELINE 20261223a” ale migrării (în locul rândului DE_COMPLETAT; singurul loc din migrare cu valori de
--   producție), iar „detaliu” + secțiunea 2 intră în review. Migrarea refuză până atunci și refuză orice diferență față de el, înainte și
--   după schimbare (ex. un trigger nou apărut între citire și aplicare).
-- Corpul de calcul dintre marcajele AMPRENTA_L15 e IDENTIC (octet cu octet, fără CR) cu cel din scripts/tichete_lot2_amprente.sql și din
--   migrare (L19, testul src/ticheteClarificariMigrare.test.js); search_path fixat la public, pg_temp, ca numele să iasă la fel peste tot.
\set ON_ERROR_STOP 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, pg_temp;
SELECT current_database() AS baza, (SELECT system_identifier FROM pg_control_system()) AS sistem, version() AS versiune, now() AS la;

\echo
\echo '=== 20261223a_tichete_clarificari — 1. amprenta (tabele + lanțul scrierilor) ==='
WITH RECURSIVE
-- >>> INTRARE 20261223a
amp_tabele(oid) AS (VALUES ('public.notifications'::regclass::oid), ('public.tichete'::regclass::oid), ('public.tichete_comentarii'::regclass::oid)),
-- <<< INTRARE 20261223a
-- >>> INCHIDERE_L15 20261223a
-- Pornirea = funcțiile triggerelor care se DECLANȘEAZĂ la scrierile funcțiilor noi: UPDATE pe tichete (doar metadata, dar conservator:
--   orice trigger de UPDATE, cu sau fără listă de coloane / WHEN), INSERT pe tichete_comentarii și pe notifications (tgtype: 4 = INSERT,
--   8 = DELETE, 16 = UPDATE). Politicile nu se aplică (funcțiile scriu ca proprietar; $pre$ verifică). Închiderea se CALCULEAZĂ aici,
--   din catalog: orice funcție (în afara pg_catalog / information_schema) al cărei nume apare ca apel „nume(” în corpul unei funcții
--   sql / plpgsql din lanț (supra-aproximare: un nume potrivit în plus doar intră în amprentă), numele neobișnuite prin căutare de
--   text, dependențele din pg_depend (corpurile BEGIN ATOMIC) și triggerele tabelelor în care un corp din lanț scrie (INSERT INTO /
--   UPDATE / DELETE FROM, pe evenimentul respectiv; ex. istoricul tichetului). Fără limită de adâncime: UNION oprește ciclurile.
--   BASELINE-ul trebuie să aibă EXACT amprenta calculată (o funcție lipsă sau în plus = refuz). Pe lanț: EXECUTE dinamic / limbaj
--   neanalizabil / DEFINER fără search_path = refuz (amp_verifica).
amp_pornire(oid) AS (
  SELECT tg.tgfoid FROM pg_trigger tg
   WHERE NOT tg.tgisinternal
     AND ((tg.tgrelid = 'public.tichete'::regclass AND (tg.tgtype & 16) <> 0)
          OR (tg.tgrelid IN ('public.tichete_comentarii'::regclass, 'public.notifications'::regclass) AND (tg.tgtype & 4) <> 0))
),
amp_lant(oid) AS (
  SELECT s.oid FROM amp_pornire s WHERE s.oid IS NOT NULL
  UNION
  SELECT x.oid FROM amp_lant l CROSS JOIN LATERAL (
    SELECT p2.oid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql')
      CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
      JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1])
     WHERE p.oid = l.oid AND p2.oid <> p.oid AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
    UNION
    SELECT p2.oid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql')
      JOIN pg_proc p2 ON p2.proname !~ '^[[:alpha:]_][[:alnum:]_$]*$'
       AND (strpos(lower(p.prosrc), lower(p2.proname)) > 0 OR strpos(lower(p.prosrc), lower(replace(p2.proname, '"', '""'))) > 0)
     WHERE p.oid = l.oid AND p2.oid <> p.oid AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
    UNION
    SELECT d.refobjid FROM pg_depend d JOIN pg_proc p2 ON p2.oid = d.refobjid
     WHERE d.classid = 'pg_proc'::regclass AND d.objid = l.oid AND d.refclassid = 'pg_proc'::regclass
       AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
    UNION
    SELECT tg.tgfoid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql')
      CROSS JOIN LATERAL regexp_matches(p.prosrc,
        '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(only[[:space:]]+)?("?[[:alpha:]_][[:alnum:]_$]*"?[[:space:]]*\.[[:space:]]*)?"?([[:alpha:]_][[:alnum:]_$]*)', 'gi') w
      JOIN pg_class c ON lower(c.relname) = lower(w[4]) AND c.relkind IN ('r', 'p')
       AND c.relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
      JOIN pg_trigger tg ON tg.tgrelid = c.oid AND NOT tg.tgisinternal
       AND (tg.tgtype & CASE WHEN lower(w[1]) LIKE 'insert%' THEN 4 WHEN lower(w[1]) LIKE 'update%' THEN 16 ELSE 8 END) <> 0
     WHERE p.oid = l.oid
  ) x
),
amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),
-- <<< INCHIDERE_L15 20261223a
-- >>> AMPRENTA_L15 v1
amp_functii(oid) AS (
  SELECT f.oid FROM amp_functii_explicite f WHERE f.oid IS NOT NULL
  UNION
  SELECT d.refobjid FROM pg_depend d JOIN pg_policy pol ON pol.oid = d.objid
   WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND pol.polrelid IN (SELECT t.oid FROM amp_tabele t)
  UNION
  SELECT tg.tgfoid FROM pg_trigger tg WHERE tg.tgrelid IN (SELECT t.oid FROM amp_tabele t) AND NOT tg.tgisinternal
),
amp_calc(eticheta, amprenta, detaliu) AS (
  SELECT x.eticheta, md5(x.detaliu), x.detaliu FROM (
    -- drepturile pe tabel (relacl NULL = implicitul proprietarului); rolul 0 = PUBLIC; * = cu GRANT OPTION
    SELECT 'tabel ' || c.oid::regclass::text || ' | acl' AS eticheta,
           coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e) a), '(niciun drept)') AS detaliu
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- drepturile pe coloane (doar coloanele cu drepturi proprii)
    SELECT 'tabel ' || c.oid::regclass::text || ' | acl coloane',
           coalesce((SELECT string_agg(a.d, '; ' ORDER BY a.d COLLATE "C") FROM (
             SELECT att.attname::text || ' ' || CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e
              WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL) a), '(fara drepturi pe coloane)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- proprietarul, tipul, RLS și FORCE RLS
    SELECT 'tabel ' || c.oid::regclass::text || ' | rls',
           'proprietar=' || pg_get_userbyid(c.relowner) || ', tip=' || c.relkind::text || ', rls=' || c.relrowsecurity::text
           || ', force=' || c.relforcerowsecurity::text
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- secvențele tabelului (serial / identity) și drepturile lor
    SELECT 'tabel ' || c.oid::regclass::text || ' | secvente',
           coalesce((SELECT string_agg(a.d, '; ' ORDER BY a.d COLLATE "C") FROM (
             SELECT s.oid::regclass::text || ' ' || CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM pg_depend dp JOIN pg_class s ON s.oid = dp.objid AND s.relkind = 'S'
               CROSS JOIN LATERAL aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) e
              WHERE dp.classid = 'pg_class'::regclass AND dp.refclassid = 'pg_class'::regclass AND dp.refobjid = c.oid
                AND dp.deptype IN ('a', 'i')) a), '(fara secvente)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- TOATE politicile: comanda, PERMISSIVE / RESTRICTIVE, rolurile, USING (NULL = true), WITH CHECK (NULL = același USING)
    SELECT 'tabel ' || c.oid::regclass::text || ' | politici',
           coalesce((SELECT string_agg(a.d, chr(10) ORDER BY a.d COLLATE "C") FROM (
             SELECT pol.polname::text || ' | ' || pol.polcmd::text || ' | ' || CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END
                    || ' | roluri=' || coalesce((SELECT string_agg(r.n, ',' ORDER BY r.n COLLATE "C") FROM (
                         SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS n FROM unnest(pol.polroles) ro) r), '-')
                    || ' | USING ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true')
                    || ' | CHECK ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(= USING)') AS d
               FROM pg_policy pol WHERE pol.polrelid = c.oid) a), '(fara politici)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- triggerele (fără cele interne de FK): funcția, starea (O / D / R / A), definiția întreagă (moment, evenimente, WHEN)
    SELECT 'tabel ' || c.oid::regclass::text || ' | triggere',
           coalesce((SELECT string_agg(a.d, chr(10) ORDER BY a.d COLLATE "C") FROM (
             SELECT tg.tgname::text || ' | ' || tg.tgfoid::regprocedure::text || ' | stare=' || tg.tgenabled::text || ' | ' || pg_get_triggerdef(tg.oid) AS d
               FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND NOT tg.tgisinternal) a), '(fara triggere)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- funcțiile (pornire + politici + triggere + callee-urile din BASELINE): proprietăți, drepturi, md5 pe corp (fără CR)
    SELECT 'functie ' || p.oid::regprocedure::text,
           'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
           || ', strict=' || p.proisstrict::text || ', leakproof=' || p.proleakproof::text || ', proprietar=' || pg_get_userbyid(p.proowner)
           || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
           || ', acl=' || coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                  FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)')
           || ', corp_md5=' || md5(replace(p.prosrc, chr(13), ''))
           || ', sqlbody_md5=' || coalesce(md5(replace(pg_get_function_sqlbody(p.oid), chr(13), '')), '-')
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid IN (SELECT f.oid FROM amp_functii f)
  ) x
)
-- <<< AMPRENTA_L15 v1
SELECT c.eticheta, c.amprenta,
       CASE WHEN row_number() OVER (ORDER BY c.eticheta COLLATE "C") = 1 THEN '    ' ELSE '  , ' END || format('(%L, %L)', c.eticheta, c.amprenta) AS linie_baseline,
       CASE WHEN c.eticheta LIKE 'functie %' THEN
              CASE WHEN to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT f.oid FROM amp_functii_explicite f) THEN 'lant' ELSE 'amprentat' END
            ELSE 'tabel' END AS sursa,
       concat_ws('; ',
         CASE WHEN c.eticheta LIKE '% | acl%' AND c.detaliu ~ '(^|[ ,;])(anon|PUBLIC):' THEN 'drepturi pentru anon / PUBLIC' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ 'USING true' THEN 'politica USING true' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ 'roluri=([^|]*,)?(PUBLIC|anon)[,| ]' THEN 'politica pentru PUBLIC / anon' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%' THEN
                CASE WHEN to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT f.oid FROM amp_functii_explicite f)
                     THEN 'DEFINER fara search_path pe lant (migrarea refuza)' ELSE 'DEFINER fara search_path (in afara lantului, de privit)' END END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=false%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'INVOKER fara search_path (de privit)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND (SELECT regexp_replace(p.prosrc, '''execute''', '', 'gi') FROM pg_proc p
                                                     WHERE p.oid = to_regprocedure(substr(c.eticheta, 9))) ~* '\mexecute\M' THEN
                CASE WHEN to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT f.oid FROM amp_functii_explicite f)
                     THEN 'EXECUTE pe lant (migrarea refuza)' ELSE 'EXECUTE in corp (in afara lantului: doar amprentat)' END END,
         CASE WHEN c.eticheta LIKE 'functie %' AND to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT f.oid FROM amp_functii_explicite f)
                   AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(substr(c.eticheta, 9))) ~* '(http|\mnet\.|mail|\msms|push|pg_notify)' THEN
                'pe lant: pare sa trimita in afara platformei (de privit)' END
       ) AS atentie,
       c.detaliu,
       -- definiția întreagă, DOAR pentru funcțiile din lanț (review: ce face fiecare la scrierile noastre)
       CASE WHEN c.eticheta LIKE 'functie %' AND to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT f.oid FROM amp_functii_explicite f)
            THEN pg_get_functiondef(to_regprocedure(substr(c.eticheta, 9))) END AS definitie_lant
  FROM amp_calc c ORDER BY c.eticheta COLLATE "C";

\echo
\echo '=== 2. triggerele care se declanșează la scrierile noastre (UPDATE pe tichete; INSERT pe tichete_comentarii / notifications) ==='
SELECT tg.tgrelid::regclass::text AS tabel, tg.tgname AS trigger_nume, tg.tgenabled AS stare, pg_get_triggerdef(tg.oid) AS definitie_trigger,
       tg.tgfoid::regprocedure::text AS functia
  FROM pg_trigger tg
 WHERE NOT tg.tgisinternal
   AND ((tg.tgrelid = 'public.tichete'::regclass AND (tg.tgtype & 16) <> 0)
        OR (tg.tgrelid IN ('public.tichete_comentarii'::regclass, 'public.notifications'::regclass) AND (tg.tgtype & 4) <> 0))
 ORDER BY 1, 2;

\echo
\echo '=== 3. numărători (fără conținut): tichete din butonul de raportare, pe status / subcategorie, și evidențe existente (cerut: 0) ==='
SELECT x.status, x.subcategorie, count(*) AS tichete, count(*) FILTER (WHERE x.metadata -> 'clarificari_erp' IS NOT NULL) AS cu_clarificari
  FROM public.tichete x
 WHERE x.departament = 'it' AND x.subcategorie IN ('eroare_erp', 'cerere_functie') AND x.metadata ->> 'sursa' IN ('bug_report', 'feature_request')
 GROUP BY 1, 2 ORDER BY 1, 2;

ROLLBACK;
