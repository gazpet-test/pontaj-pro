-- Amprenta L15 pentru migrarea 20261222a_sites_drept_creare — DOAR CITIRE, pentru coordonator, pe PRODUCȚIE (și pe clonă).
-- Rulare (o tranzacție READ ONLY, nimic scris; parola din pgpass, niciodată în comandă):
--   psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -f scripts/sites_drept_creare_amprente.sql > amprente_20261222a.txt
-- Ce tipărește (același format ca scripts/meteo_xweather_amprente.sql):
--   eticheta | amprenta (md5 pe „detaliu”) | linie_baseline (de copiat în blocul BASELINE al migrării) | sursa | atentie | detaliu
--   * tabelul sites: drepturile pe tabel și pe coloane, proprietarul / RLS / FORCE, secvențele, TOATE politicile, triggerele;
--   * funcțiile: ÎNCHIDEREA tranzitivă (blocul INCHIDERE_L15, IDENTIC cu cel din migrare): pornirea = ce cheamă direct RPC-ul nou
--     fn_sites_creeaza (auth.uid(), fn_executie_proiect_permis; RPC-ul însuși lipsește înainte de aplicare) + funcțiile politicilor și
--     triggerelor lui sites (deci și fn_auto_create_executie_proiect / fn_site_name_to_cod_intern), apoi orice funcție apelată „nume(” din
--     corpurile sql / plpgsql ale lanțului și dependențele din pg_depend, fără limită de adâncime;
--   * „atentie” = ce trebuie privit cu ochii înainte de a accepta baseline-ul (drepturi pentru anon / PUBLIC, DEFINER fără search_path,
--     EXECUTE în corp — pe acesta migrarea îl REFUZĂ). Pe sites, „politica USING true” pe INSERT e normală (INSERT are doar CHECK).
-- De privit în mod special în „detaliu”: la 'tabel sites | triggere' triggerul tr_auto_create_executie_proiect (AFTER INSERT) și la
--   'functie fn_auto_create_executie_proiect()' corpul (corp_md5 citit pe 13.11.2026 și 20.11.2026: 22f95c1e3f15cde32a1d2c11e3259089; după
--   aplicare: d6b7881fdfec0d1419a173a45a764c6a, corpul cu condiția sites.proiect_id din runda 6); la 'tabel sites | politici' politica de
--   CITIRE (contul cu drept își recitește șantierul la reconciliere) și cele trei politici ale owner-ului (INSERT / UPDATE / DELETE rămân doar
--   ale lui).
-- Cum se folosește: coloana linie_baseline, în ordinea afișată, se copiază ÎNTREAGĂ între marcajele „>>> BASELINE 20261222a” /
--   „<<< BASELINE 20261222a” ale migrării (în locul rândului DE_COMPLETAT; singurul loc din migrare cu valori de producție), iar „detaliu”
--   intră în review. Migrarea refuză până atunci și refuză orice diferență față de el, înainte și după schimbare.
-- Corpul de calcul dintre marcajele AMPRENTA_L15 e IDENTIC (octet cu octet, fără CR) cu cel din scripts/tichete_lot2_amprente.sql și din
--   migrare (L19, testul src/sitesDreptCreareMigrare.test.js); search_path fixat la public, pg_temp, ca numele să iasă la fel peste tot.
\set ON_ERROR_STOP 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, pg_temp;
SELECT current_database() AS baza, (SELECT system_identifier FROM pg_control_system()) AS sistem, version() AS versiune, now() AS la;

\echo
\echo '=== 20261222a_sites_drept_creare — tabelul sites și funcțiile de drept ale RPC-ului fn_sites_creeaza ==='
WITH RECURSIVE
-- >>> INTRARE 20261222a
amp_tabele(oid) AS (SELECT 'public.sites'::regclass::oid),
-- <<< INTRARE 20261222a
-- >>> INCHIDERE_L15 20261222a
-- Pornirea = ce cheamă DIRECT RPC-ul nou fn_sites_creeaza (auth.uid(), fn_executie_proiect_permis; postcondiția verifică că nu cheamă altceva),
--   RPC-ul însuși (există doar „după”; înainte to_regprocedure = NULL și rândul cade) + funcțiile politicilor și triggerelor lui sites.
--   Închiderea se CALCULEAZĂ aici, din catalog, nu se ia din BASELINE: orice funcție (în afara pg_catalog / information_schema) al cărei nume
--   apare ca apel „nume(” în corpul unei funcții sql / plpgsql din lanț (supra-aproximare: un nume potrivit în plus doar intră în amprentă),
--   numele neobișnuite prin căutare de text, plus dependențele din pg_depend (corpurile BEGIN ATOMIC). Fără limită de adâncime: UNION oprește
--   ciclurile. BASELINE-ul trebuie să aibă EXACT această mulțime (o funcție lipsă sau în plus = refuz). EXECUTE dinamic / limbaj neanalizabil
--   în lanț = refuz (amp_verifica).
amp_pornire(oid) AS (VALUES (to_regprocedure('auth.uid()')::oid), (to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')::oid),
                            (to_regprocedure('public.fn_sites_creeaza(text, bigint, text)')::oid)),
amp_lant(oid) AS (
  SELECT s.oid FROM amp_pornire s WHERE s.oid IS NOT NULL
  UNION
  SELECT d.refobjid FROM pg_depend d JOIN pg_policy pol ON pol.oid = d.objid
   WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND pol.polrelid IN (SELECT t.oid FROM amp_tabele t)
  UNION
  SELECT tg.tgfoid FROM pg_trigger tg WHERE tg.tgrelid IN (SELECT t.oid FROM amp_tabele t) AND NOT tg.tgisinternal
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
  ) x
),
amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),
-- <<< INCHIDERE_L15 20261222a
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
              CASE WHEN to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT s.oid FROM amp_pornire s) THEN 'pornire' ELSE 'inchidere' END
            ELSE 'tabel' END AS sursa,
       concat_ws('; ',
         CASE WHEN c.eticheta LIKE '% | acl%' AND c.detaliu ~ '(^|[ ,;])(anon|PUBLIC):' THEN 'drepturi pentru anon / PUBLIC' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ 'USING true' THEN 'politica USING true' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ 'roluri=([^|]*,)?(PUBLIC|anon)[,| ]' THEN 'politica pentru PUBLIC / anon' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ '\| RESTRICTIVE \|' THEN 'politica RESTRICTIVE (pe INSERT: migrarea refuza)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'DEFINER fara search_path (migrarea refuza)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=false%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'INVOKER fara search_path (de privit)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND (SELECT regexp_replace(p.prosrc, '''execute''', '', 'gi') FROM pg_proc p
                                                     WHERE p.oid = to_regprocedure(substr(c.eticheta, 9))) ~* '\mexecute\M' THEN 'EXECUTE in corp (migrarea refuza)' END
       ) AS atentie,
       c.detaliu
  FROM amp_calc c ORDER BY c.eticheta COLLATE "C";

\echo
\echo '=== 20261222a — controale de stare (nimic nu trebuie să existe înainte de aplicare) ==='
SELECT (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare') AS cheie_santiere_creare_exista,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza') AS rpc_exista,
       (SELECT count(*) FROM public.user_module_access WHERE module = 'santiere_creare') AS drepturi_santiere_creare,
       (SELECT count(*) FROM public.user_module_access WHERE module = 'administrativ.locatii') AS drepturi_administrativ_locatii,
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sites' AND column_name = 'proiect_id') AS tip_proiect_id,
       (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'site_id') AS tip_proiect_site_id;

\echo
\echo '=== 20261222a — presupunerile ordinii din RPC (runda 6, trebuie: chei_straine_site_id = 1, cheia_site_id_exacta = t, trigger = 1, santiere_cu_mai_multe_proiecte = 0) ==='
SELECT pg_get_serial_sequence('public.sites', 'id') AS secventa_sites_id,
       (SELECT count(*) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.conrelid = 'public.executie_proiecte'::regclass AND c.contype = 'f' AND a.attname = 'site_id') AS chei_straine_site_id,
       EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = 'public.executie_proiecte'::regclass AND c.contype = 'f' AND c.conname = 'executie_proiecte_site_id_fkey'
                  AND c.confrelid = 'public.sites'::regclass AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (site_id) REFERENCES sites(id)'
                  AND NOT c.condeferrable AND NOT c.condeferred AND c.convalidated) AS cheia_site_id_exacta,
       (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid = 'public.sites'::regclass AND tg.tgname = 'tr_auto_create_executie_proiect'
         AND tg.tgfoid = to_regprocedure('public.fn_auto_create_executie_proiect()') AND tg.tgtype = 5 AND tg.tgenabled = 'O'
         AND tg.tgnargs = 0 AND tg.tgqual IS NULL) AS trigger_proiect_automat,
       (SELECT count(*) FROM (SELECT e.site_id FROM public.executie_proiecte e WHERE e.site_id IS NOT NULL GROUP BY e.site_id HAVING count(*) > 1) d)
         AS santiere_cu_mai_multe_proiecte,
       (SELECT string_agg(i.indexdef, ' ; ') FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = 'executie_proiecte'
         AND i.indexdef ~* '\(site_id') AS indecsi_site_id;

\echo
\echo '=== 20261222a — triggerele lui executie_proiecte (rulează la UPDATE site_id din RPC; NU sunt în amprentă — de citit în review) ==='
SELECT tg.tgname, tg.tgfoid::regprocedure AS functie, tg.tgenabled AS stare, pg_get_triggerdef(tg.oid) AS definitie
  FROM pg_trigger tg WHERE tg.tgrelid = 'public.executie_proiecte'::regclass AND NOT tg.tgisinternal ORDER BY tg.tgname COLLATE "C";

ROLLBACK;
