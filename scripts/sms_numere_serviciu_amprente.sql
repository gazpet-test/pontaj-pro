-- Amprenta L15 pentru migrarea 20261220a_sms_numere_serviciu — DOAR CITIRE, pentru coordonator, pe PRODUCȚIE (și pe clonă).
-- Rulare (o tranzacție READ ONLY, nimic scris; parola din pgpass, niciodată în comandă):
--   psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -f scripts/sms_numere_serviciu_amprente.sql > amprente_20261220a.txt
-- Ce tipărește (același format ca scripts/meteo_xweather_amprente.sql):
--   1. eticheta | amprenta (md5 pe „detaliu”) | linie_baseline (de copiat în blocul BASELINE al migrării) | sursa | atentie | detaliu
--      * tabelele: sms_loturi și sms_mesaje (pe sms_mesaje se reface CHECK-ul destinatar_tip; în ambele scrie crearea lotului, prin
--        triggerele lor) — drepturi pe tabel / coloane / secvențe, proprietar, RLS + FORCE, TOATE politicile, inventarul triggerelor;
--      * funcțiile: ÎNCHIDEREA tranzitivă (blocul INCHIDERE_L15, IDENTIC cu cel din migrare — r3; lanțul = blocul din 20261221a): pornirea =
--        crearea lotului (varianta cu 4 parametri), lista fixată, lista angajaților și lista FOLOSITE (porțile fn_sms_cere_owner /
--        fn_sms_cere_nivel, normalizarea, textul, coada de test, accesul pe lot, auth.uid), plus funcțiile din politicile / triggerele celor
--        două tabele, apoi orice funcție apelată „nume(” din corpurile sql / plpgsql ale lanțului și dependențele din pg_depend, fără limită
--        de adâncime. Migrarea calculează ACEEAȘI mulțime și cere ca baseline-ul s-o aibă EXACT (sursa: pornire / inchidere);
--      * „atentie” = ce trebuie privit cu ochii înainte de a accepta baseline-ul (drepturi pentru anon / PUBLIC, politici USING true,
--        DEFINER fără search_path și EXECUTE în corp — pe acestea două migrarea le REFUZĂ).
--   2. r4: UN rând de SEMNALE pentru review (afișare extinsă, o coloană pe linie):
--      * REFUZURI (aceleași reguli ca migrarea, amp_verifica; > 0 = migrarea VA REFUZA la aplicare, de rezolvat înainte):
--        refuz_definer_fara_search_path (DEFINER din lanț fără search_path propriu) și functii_cu_sql_dinamic_in_lant (EXECUTE /
--        limbaj neanalizabil, regula 20261221a);
--      * SEMNALE (NU refuză; se examinează și se ACCEPTĂ EXPLICIT în review, cu numele lor): semnal_nume_noi_in_afara_listei (funcțiile
--        din afara listei FOLOSITE ale căror nume apar în corpurile noi, cu schema și semnătura fiecăreia — ex. o funcție omonimă din
--        extensions, neapelată), semnal_vederi_citite_de_lant (ce cheamă o vedere NU intră în închidere), semnal_alt_limbaj_decat_sql_plpgsql;
--        folosite_lipsa trebuie să fie 0.
--      Limita (review r3): închiderea nu traversează vederile; garanția completă = amprenta GLOBALĂ a runnerului L15 v2 (antetul migrării).
--   3. verificările de start ale migrării pe ținta curentă (corpurile 20261130b, CHECK-ul, numele libere), ca un refuz să se vadă înainte.
-- Cum se folosește: coloana linie_baseline din (1), în ordinea afișată, se copiază ÎNTREAGĂ între marcajele „>>> BASELINE 20261220a” /
--   „<<< BASELINE 20261220a” ale migrării (în locul rândului DE_COMPLETAT; singurul loc din migrare cu valori de producție), iar „detaliu”
--   intră în review. Migrarea refuză până atunci și refuză orice diferență față de el, înainte și după schimbare (excepțiile „după”: antetul
--   migrării).
-- Corpul de calcul dintre marcajele AMPRENTA_L15 e IDENTIC (octet cu octet, fără CR) cu cel din scripts/tichete_lot2_amprente.sql și din
--   migrare (L19, testul src/smsNumereServiciuAmprente.test.js); search_path fixat la public, pg_temp, ca numele să iasă la fel peste tot.
\set ON_ERROR_STOP 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, pg_temp;
SELECT current_database() AS baza, (SELECT system_identifier FROM pg_control_system()) AS sistem, version() AS versiune, now() AS la;

\echo
\echo '=== 1. 20261220a_sms_numere_serviciu — sms_loturi, sms_mesaje + închiderea funcțiilor (crearea lotului, lista fixată, porțile) ==='
WITH RECURSIVE
-- >>> INTRARE 20261220a
amp_tabele(oid) AS (VALUES ('public.sms_loturi'::regclass::oid), ('public.sms_mesaje'::regclass::oid)),
-- <<< INTRARE 20261220a
-- >>> INCHIDERE_L15 20261220a
-- Pornirea (r3): crearea lotului (varianta cu 4 parametri ÎNAINTE, cea cu 5 DUPĂ: to_regprocedure lasă doar pe cea existentă), lista fixată,
--   lista angajaților și lista FOLOSITE (funcțiile chemate de corpurile noi: porțile owner / nivel, normalizarea, textul, coada de test,
--   accesul pe lot, auth.uid). Lanțul (amp_lant, amp_functii_explicite) = EXACT blocul din 20261221a (L19): orice funcție (în afara
--   pg_catalog / information_schema) al cărei nume apare ca apel „nume(” în corpul unei funcții sql / plpgsql din lanț (supra-aproximare:
--   un nume potrivit în plus doar intră în amprentă), numele neobișnuite prin căutare de text, plus dependențele din pg_depend (corpurile
--   BEGIN ATOMIC); fără limită de adâncime (UNION oprește ciclurile). BASELINE-ul trebuie să aibă EXACT această mulțime (o funcție lipsă
--   sau în plus = refuz). EXECUTE dinamic / limbaj neanalizabil în lanț = refuz (amp_verifica).
amp_pornire(oid) AS (VALUES (to_regprocedure('public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean)')::oid),
                            (to_regprocedure('public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[])')::oid),
                            (to_regprocedure('public.fn_sms_lot_destinatari(uuid)')::oid), (to_regprocedure('public.fn_sms_angajati_lista()')::oid),
                            (to_regprocedure('auth.uid()')::oid), (to_regprocedure('public.fn_sms_cere_nivel()')::oid),
                            (to_regprocedure('public.fn_sms_cere_owner()')::oid), (to_regprocedure('public.fn_sms_lot_acces(uuid, text, public.sms_loturi, boolean)')::oid),
                            (to_regprocedure('public.fn_sms_tel_normalizat(text)')::oid), (to_regprocedure('public.fn_sms_test_coada(uuid)')::oid),
                            (to_regprocedure('public.fn_sms_test_coada_cere(uuid, integer)')::oid), (to_regprocedure('public.fn_sms_test_coada_lock(uuid, boolean)')::oid),
                            (to_regprocedure('public.fn_sms_test_coada_max()')::oid), (to_regprocedure('public.fn_sms_text_valid(text)')::oid),
                            (to_regprocedure('public.fn_sms_text_verifica(text)')::oid)),
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
-- <<< INCHIDERE_L15 20261220a
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
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'DEFINER fara search_path (migrarea refuza)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=false%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'INVOKER fara search_path (de privit)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND (SELECT regexp_replace(p.prosrc, '''execute''', '', 'gi') FROM pg_proc p
                                                     WHERE p.oid = to_regprocedure(substr(c.eticheta, 9))) ~* '\mexecute\M' THEN 'EXECUTE in corp (migrarea refuza)' END
       ) AS atentie,
       c.detaliu
  FROM amp_calc c ORDER BY c.eticheta COLLATE "C";

\echo
\x on
\echo '=== 2. 20261220a — SEMNALE pentru review (r4): un rând; refuz_* > 0 = migrarea VA REFUZA, semnal_* = de examinat și acceptat explicit ==='
WITH RECURSIVE
amp_tabele(oid) AS (VALUES ('public.sms_loturi'::regclass::oid), ('public.sms_mesaje'::regclass::oid)),
-- >>> INCHIDERE_L15 20261220a
-- Pornirea (r3): crearea lotului (varianta cu 4 parametri ÎNAINTE, cea cu 5 DUPĂ: to_regprocedure lasă doar pe cea existentă), lista fixată,
--   lista angajaților și lista FOLOSITE (funcțiile chemate de corpurile noi: porțile owner / nivel, normalizarea, textul, coada de test,
--   accesul pe lot, auth.uid). Lanțul (amp_lant, amp_functii_explicite) = EXACT blocul din 20261221a (L19): orice funcție (în afara
--   pg_catalog / information_schema) al cărei nume apare ca apel „nume(” în corpul unei funcții sql / plpgsql din lanț (supra-aproximare:
--   un nume potrivit în plus doar intră în amprentă), numele neobișnuite prin căutare de text, plus dependențele din pg_depend (corpurile
--   BEGIN ATOMIC); fără limită de adâncime (UNION oprește ciclurile). BASELINE-ul trebuie să aibă EXACT această mulțime (o funcție lipsă
--   sau în plus = refuz). EXECUTE dinamic / limbaj neanalizabil în lanț = refuz (amp_verifica).
amp_pornire(oid) AS (VALUES (to_regprocedure('public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean)')::oid),
                            (to_regprocedure('public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[])')::oid),
                            (to_regprocedure('public.fn_sms_lot_destinatari(uuid)')::oid), (to_regprocedure('public.fn_sms_angajati_lista()')::oid),
                            (to_regprocedure('auth.uid()')::oid), (to_regprocedure('public.fn_sms_cere_nivel()')::oid),
                            (to_regprocedure('public.fn_sms_cere_owner()')::oid), (to_regprocedure('public.fn_sms_lot_acces(uuid, text, public.sms_loturi, boolean)')::oid),
                            (to_regprocedure('public.fn_sms_tel_normalizat(text)')::oid), (to_regprocedure('public.fn_sms_test_coada(uuid)')::oid),
                            (to_regprocedure('public.fn_sms_test_coada_cere(uuid, integer)')::oid), (to_regprocedure('public.fn_sms_test_coada_lock(uuid, boolean)')::oid),
                            (to_regprocedure('public.fn_sms_test_coada_max()')::oid), (to_regprocedure('public.fn_sms_text_valid(text)')::oid),
                            (to_regprocedure('public.fn_sms_text_verifica(text)')::oid)),
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
-- <<< INCHIDERE_L15 20261220a
amp_dinamic(functie, limbaj) AS (
  SELECT p.oid::regprocedure::text, l.lanname::text
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT f.oid FROM amp_functii_explicite f)
     AND (l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')
          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M'))
),
-- DEFINER din lanț fără search_path propriu: aceeași regulă ca migrarea (amp_verifica), REFUZ
amp_definer(functie) AS (
  SELECT p.oid::regprocedure::text FROM pg_proc p
   WHERE p.oid IN (SELECT f.oid FROM amp_functii_explicite f) AND p.prosecdef AND p.proconfig IS NULL
),
-- r4 SEMNALE (vizibilitate, NU refuz; review r3 + L15 v2): funcțiile lanțului în alt limbaj decât sql / plpgsql (internal / c = frunze,
-- celelalte nu se pot citi) și vederile citite de lanț (nume de vedere în corpul unei funcții din lanț, plus dependențele din pg_depend
-- ale corpurilor BEGIN ATOMIC). Ce cheamă o vedere NU intră în închidere: garanția vine din amprenta GLOBALĂ a runnerului (L15 v2)
sem_limbaj(functie) AS (
  SELECT p.oid::regprocedure::text || ' (' || l.lanname::text || ')'
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT f.oid FROM amp_functii_explicite f) AND l.lanname NOT IN ('sql', 'plpgsql')
),
sem_vederi(vedere) AS (
  SELECT c.relnamespace::regnamespace::text || '.' || c.relname::text
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)', 'g') w
    JOIN pg_class c ON c.relkind IN ('v', 'm') AND lower(c.relname) = lower(w[1])
   WHERE p.oid IN (SELECT f.oid FROM amp_functii_explicite f)
     AND c.relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
  UNION
  SELECT c.relnamespace::regnamespace::text || '.' || c.relname::text
    FROM pg_depend d JOIN pg_class c ON c.oid = d.refobjid AND c.relkind IN ('v', 'm')
   WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_class'::regclass AND d.objid IN (SELECT f.oid FROM amp_functii_explicite f)
),
-- numele „nume(” din corpurile NOI ale migrării (lista o ține la zi testul static) care există ca funcții în afara pg_catalog /
-- information_schema și a listei FOLOSITE, CU SCHEMA și semnătura fiecăreia: un nume comun (ex. jsonb_build_object, apelat din
-- pg_catalog) potrivit cu o funcție omonimă din altă schemă (ex. extensions) apare aici, pentru review, fără să refuze migrarea
nume_noi(n) AS (SELECT unnest(ARRAY[
  -- >>> NUME-NOI 20261220a
  'activ', 'active', 'adăugare', 'and', 'any', 'array', 'array_agg', 'as',
  'btrim', 'candidatii', 'cardinality', 'client', 'coadă', 'coalesce', 'commit', 'count',
  'destinatari', 'dezactivat', 'efectiva', 'exists', 'finala', 'fn_sms_cere_nivel', 'fn_sms_cere_owner', 'fn_sms_lot_acces',
  'fn_sms_tel_normalizat', 'fn_sms_test_coada', 'fn_sms_test_coada_cere', 'fn_sms_test_coada_lock', 'fn_sms_test_coada_max', 'fn_sms_text_valid', 'fn_sms_text_verifica', 'from',
  'greatest', 'hashtextextended', 'if', 'in', 'json', 'jsonb_agg', 'jsonb_build_object', 'jsonb_object_agg',
  'length', 'lotului', 'lui', 'manuala', 'manuală', 'modifica', 'normalizat', 'now',
  'nullif', 'numărul', 'on', 'pg_advisory_xact_lock', 'păstrează', 'r2', 'r3', 'regexp_replace',
  'right', 'round', 'schimbă', 'select', 'sms_loturi', 'sms_mesaje', 'sms_numere_serviciu', 'sterg',
  'to_jsonb', 'u', 'uid', 'unnest', 'valid', 'values'
  -- <<< NUME-NOI 20261220a
]::text[])),
folosite(oid) AS (VALUES (to_regprocedure('auth.uid()')::oid), (to_regprocedure('public.fn_sms_cere_nivel()')::oid),
                         (to_regprocedure('public.fn_sms_cere_owner()')::oid), (to_regprocedure('public.fn_sms_lot_acces(uuid, text, public.sms_loturi, boolean)')::oid),
                         (to_regprocedure('public.fn_sms_tel_normalizat(text)')::oid), (to_regprocedure('public.fn_sms_test_coada(uuid)')::oid),
                         (to_regprocedure('public.fn_sms_test_coada_cere(uuid, integer)')::oid), (to_regprocedure('public.fn_sms_test_coada_lock(uuid, boolean)')::oid),
                         (to_regprocedure('public.fn_sms_test_coada_max()')::oid), (to_regprocedure('public.fn_sms_text_valid(text)')::oid),
                         (to_regprocedure('public.fn_sms_text_verifica(text)')::oid)),
gasite(f) AS (
  SELECT p.pronamespace::regnamespace::text || '.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p JOIN nume_noi u ON lower(p.proname) = u.n
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p.oid NOT IN (SELECT f.oid FROM folosite f WHERE f.oid IS NOT NULL)
)
SELECT (SELECT count(*) FROM amp_functii_explicite) AS functii_in_lant,
       (SELECT count(*) FROM amp_definer) AS refuz_definer_fara_search_path,
       coalesce((SELECT string_agg(d.functie, ', ' ORDER BY d.functie COLLATE "C") FROM amp_definer d), '(niciuna)') AS definer_care,
       (SELECT count(*) FROM amp_dinamic) AS functii_cu_sql_dinamic_in_lant,
       coalesce((SELECT string_agg(d.functie || ' (' || d.limbaj || ')', ', ' ORDER BY d.functie COLLATE "C") FROM amp_dinamic d), '(niciuna)') AS dinamic_care,
       (SELECT count(*) FROM gasite) AS semnal_nume_noi_in_afara_listei,
       coalesce((SELECT string_agg(g.f, ', ' ORDER BY g.f COLLATE "C") FROM gasite g), '(niciunul)') AS nume_care,
       (SELECT count(*) FROM sem_vederi) AS semnal_vederi_citite_de_lant,
       coalesce((SELECT string_agg(v.vedere, ', ' ORDER BY v.vedere COLLATE "C") FROM sem_vederi v), '(niciuna)') AS vederi_care,
       (SELECT count(*) FROM sem_limbaj) AS semnal_alt_limbaj_decat_sql_plpgsql,
       coalesce((SELECT string_agg(s.functie, ', ' ORDER BY s.functie COLLATE "C") FROM sem_limbaj s), '(niciuna)') AS limbaj_care,
       (SELECT count(*) FROM folosite f WHERE f.oid IS NULL) AS folosite_lipsa;
\x off

\echo
\echo '=== 3. 20261220a — verificările de start pe ținta curentă (NU intră în baseline; toate „true” = migrarea trece de $pre$) ==='
SELECT
  (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)'))
    = 'ee0e39daf80d5abd45412e4782d5d07b' AS crearea_lotului_20261130b,
  (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_sms_lot_intern_creeaza') = 1 AS o_singura_varianta,
  (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_lot_destinatari(uuid)'))
    = '3fb67709c3a020cfbdb783d51e288111' AS lista_fixata_20261130b,
  (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_tel_normalizat(text)'))
    = '36549798f8f7dcb40aee8cce7a0516b4' AS normalizarea_telefonului,
  (SELECT string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
    WHERE c.conrelid = 'public.sms_mesaje'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%destinatar\_tip%')
    = 'sms_mesaje_destinatar_tip_check CHECK ((destinatar_tip = ANY (ARRAY[''angajat''::text, ''detinator''::text])))' AS check_destinatar_tip,
  to_regclass('public.sms_numere_serviciu') IS NULL AS tabel_liber,
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN ('fn_sms_numere_serviciu_lista', 'fn_sms_numere_serviciu_admin', 'fn_sms_numar_serviciu_salveaza',
                                 'fn_sms_numar_serviciu_dezactiveaza', 'fn_sms_numere_serviciu_reguli')) AS functii_libere,
  (SELECT count(*) FROM public.sms_mesaje) AS mesaje_de_scanat_la_check;

ROLLBACK;
