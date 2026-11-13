-- Version 20261221120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261221a_meteo_xweather_zilnic — vremea ZILEI pe fiecare șantier, din Vaisala Xweather, păstrată NEMODIFICABIL, ca dovadă în rapoartele de
-- lucru (raportul zilnic + exportul Excel), la o dispută cu beneficiarul (cererea owner-ului, 13.11.2026).
--
-- Vaisala Xweather este un SERVICIU de date meteo, NU un senzor montat pe șantier: peste tot scriem „Sursa: Vaisala Xweather” + coordonatele
-- folosite + stația de observație cea mai apropiată și distanța (când API-ul le dă).
--
-- Ce face:
--   * UN tabel nou, meteo_zilnic_xweather: un rând pe (site_id, data, versiune) — Tmin / Tmax / Tmedie, precipitații (mm), zăpadă (cm), vânt
--     maxim și rafala maximă (km/h) cu direcția, umiditatea medie, descrierea vremii (textul furnizorului), coordonatele cerute, cererile
--     făcute (FĂRĂ credențiale), stația cea mai apropiată (id, nume, distanța dată de API, poziția) sau motivul lipsei ei (observatii_stare),
--     răspunsurile BRUTE (jsonb) și momentul preluării (pus de server). Ziua = Europe/Bucharest, doar zile ÎNCHEIATE.
--   * NEMODIFICABIL pentru toți: nimeni nu are UPDATE / DELETE / TRUNCATE (nici service_role), iar un trigger refuză UPDATE / DELETE / TRUNCATE
--     și proprietarului. O corecție a furnizorului intră ca rând NOU cu versiune + 1 (trigger-ul cere exact ultima versiune + 1 și refuză o
--     versiune nouă identică cu cea anterioară); preluat_la îl pune trigger-ul (L08).
--   * Scrie DOAR edge fn meteo-sync, cu service_role (SELECT + INSERT): cron-ul existent meteo_sync_2h, la rularea de la 04:05 UTC, și
--     completarea zilelor vechi pornită de owner. service_role e necesar: scrierea nu are utilizator (cron), iar tabelul nu are drept de scriere
--     pentru conturile logate; fișa a–e: raportul livrării.
--   * Citirea: vederea v_meteo_zilnic_xweather (security_invoker; ultima versiune a fiecărei zile + numărul de versiuni) și tabelul (răspunsul
--     brut), DOAR pentru conturile care văd șantierul — predicatul UNIC fn_meteo_vede_site(site_id) (L19):
--       (a) raportul zilnic: fn_raport_santier_drept(site) — owner, sau alocat pe șantier (profile_sites în vigoare), cu restricția pe proiect;
--       (b) Execuție: modulul 'executie' (viewer / editor / admin) și proiectul șantierului permis contului (fn_executie_proiect_permis);
--       (c) contabilitatea (profiles.role = 'contabilitate', care vede toate rapoartele) cu aceeași restricție pe proiect.
--     Nimic pentru anon (REVOKE explicit + postcondiție pe fiecare drept).
-- De ce tabel NOU și nu meteo_istoric_zilnic (20261206a): acela are o înregistrare pe (site, data) RESCRISĂ zilnic (upsert pe 7 zile, drept de
--   UPDATE pentru service_role), citire pentru orice cont logat și o vedere (v_meteo_zile) care calculează „zi nelucrabilă” pe o singură sursă.
--   Aici regula e opusă: nimic nu se rescrie (versiuni), citirea e pe șantier, iar câmpurile sunt altele (stație, răspuns brut). Extinderea lui
--   ar fi schimbat cheia, drepturile, politica și vederea unei livrări aflate în altă coadă; tabelul nou nu atinge nimic din ea.
-- Ce NU face: nicio dată (o aduce meteo-sync după deploy), nicio automatizare nouă (pasul stă în cron-ul existent), nimic schimbat pe tabelele
--   sau funcțiile existente (doar FK spre sites).
--
-- L15: amprenta COMPLETĂ (corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/meteoXweatherMigrare.test.js) a funcțiilor de care depinde predicatul,
--   pe ÎNCHIDEREA TRANZITIVĂ calculată în migrare din catalog (blocul INCHIDERE_L15, identic cu cel din script; pornirea: auth.uid(),
--   fn_raport_santier_drept, fn_executie_proiect_permis), comparată cu BASELINE-ul din producție ÎNAINTE și DUPĂ: o funcție din lanț lipsă
--   din baseline sau în plus = refuz; EXECUTE dinamic / limbaj neanalizabil în lanț = refuz; postcondiția: funcțiile noi cheamă doar pornirea.
--   Valorile le scoate coordonatorul cu scripts/meteo_xweather_amprente.sql (tranzacție READ ONLY) în blocul marcat; necompletat = refuz.
--   „După” = baseline-ul exact (migrarea nu schimbă nicio funcție existentă; o schimbare între cele două verificări = refuz la „după”).
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$).
--   Lock (L06): UN singur lock pe un tabel existent — sites SHARE ROW EXCLUSIVE (cerut de cheia străină), NOWAIT, reîncercat la 50 ms până la
--   1 s de la BEGIN (peste = 55P03, nimic schimbat), după verificările de catalog. Oprește scurt doar scrierile în sites (nu citirile, nu
--   FOR SHARE / FOR UPDATE ale salvării raportului). Sub lock DOAR DDL pe obiecte noi + postcondițiile + amprenta „după”.
-- Revenire: supabase/revenire/20261221a_meteo_xweather_zilnic_ROLLBACK.sql (prin runner, cu plafon; refuză dacă tabelul are rânduri).
-- Probe: scripts/pglite/test_meteo_xweather_local.mjs (local, PGlite: drepturi, nemodificabil, versiuni, RLS pe șantier, revenire, mutanți).
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261221a_meteo_xweather_zilnic:' || txid_current() THEN
    RAISE EXCEPTION '20261221a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261221a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261221a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- plafonul total = ceasul de tranzacție PostgreSQL 17, pus de runner înainte de BEGIN (sursa 'session'), citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261221a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261221a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.meteo_zilnic_xweather') IS NOT NULL OR to_regclass('public.v_meteo_zilnic_xweather') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_meteo_vede_site', 'fn_meteo_xw_inserare', 'fn_meteo_xw_nemodificabil')) THEN
    RAISE EXCEPTION '20261221a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite (predicatul, cheia străină, meteo-sync), cu tipurile acceptate
  FOR r IN SELECT * FROM (VALUES
      ('sites', 'id', 'integer|bigint'), ('sites', 'proiect_id', 'integer|bigint'), ('sites', 'lat', 'numeric|double precision|real'),
      ('sites', 'lng', 'numeric|double precision|real'), ('sites', 'active', 'boolean'), ('sites', 'meteo_activ', 'boolean'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'), ('profiles', 'role', 'text|character varying'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text|character varying'),
      ('user_module_access', 'access_level', 'text|character varying'), ('executie_proiecte', 'data_start', 'date')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261221a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sites'::regclass AND contype IN ('p', 'u')
                   AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.sites'::regclass AND attname = 'id')]::int2[]) THEN
    RAISE EXCEPTION '20261221a: sites.id fara cheie primara / unica';
  END IF;
  -- funcțiile predicatului există, cu semnătura și tipul întors (corpul și drepturile: baseline-ul L15 de mai jos)
  IF to_regprocedure('public.fn_raport_santier_drept(bigint)') IS NULL OR to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.fn_raport_santier_drept(bigint)')) <> 'boolean'::regtype
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')) <> 'boolean'::regtype THEN
    RAISE EXCEPTION '20261221a: dependentele (fn_raport_santier_drept, fn_executie_proiect_permis, auth.uid) lipsesc sau difera';
  END IF;
END $pre$;

-- ── L15: amprenta COMPLETĂ a funcțiilor de care depinde predicatul, verificată ÎNAINTE și DUPĂ (tiparul 20261217a) ──
-- >>> BASELINE 20261221a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/meteo_xweather_amprente.sql, copiată
--     ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat (DE_COMPLETAT) = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261221a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('functie auth.uid()', '547eb1864858f1efce909a735a04d521')
  , ('functie fn_executie_acces_lista(boolean)', '8dae19e2f5e53aeaec7d4a7d360f046b')
  , ('functie fn_executie_acces_lista_cont(uuid,boolean)', '4f382e2182a748dd9790e9f65f9cd9a5')
  , ('functie fn_executie_acces_nerestrans()', '53dbf0d75d3f7f5d17747fef20b674a7')
  , ('functie fn_executie_acces_nerestrans_cont(uuid)', 'bba2d110bb9df2b16d9239156f3b3607')
  , ('functie fn_executie_proiect_permis(bigint,boolean)', 'bb8d39285aee035d640af6f7371e5476')
  , ('functie fn_raport_santier_drept(bigint)', '0d759c83376de45804392f28353a370d')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261221a
CREATE FUNCTION pg_temp.amp_calc_20261221a() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH RECURSIVE
amp_tabele(oid) AS (SELECT c.oid FROM pg_class c WHERE false),
-- >>> INCHIDERE_L15 20261221a
-- Pornirea = tot ce cheamă DIRECT predicatul nou fn_meteo_vede_site: auth.uid() și cele două funcții de drept (postcondiția verifică
--   că funcțiile noi nu cheamă nimic altceva). Închiderea se CALCULEAZĂ aici, din catalog, nu se ia din BASELINE (r2, review P1): orice
--   funcție (în afara pg_catalog / information_schema) al cărei nume apare ca apel „nume(” în corpul unei funcții sql / plpgsql din lanț
--   (supra-aproximare: un nume potrivit în plus doar intră în amprentă), numele neobișnuite prin căutare de text, plus dependențele din
--   pg_depend (corpurile BEGIN ATOMIC). Fără limită de adâncime: UNION oprește ciclurile. BASELINE-ul trebuie să aibă EXACT această
--   mulțime (o funcție lipsă sau în plus = refuz). EXECUTE dinamic / limbaj neanalizabil în lanț = refuz (amp_verifica).
amp_pornire(oid) AS (VALUES (to_regprocedure('auth.uid()')::oid), (to_regprocedure('public.fn_raport_santier_drept(bigint)')::oid),
                            (to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')::oid)),
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
-- <<< INCHIDERE_L15 20261221a
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
SELECT c.eticheta, c.amprenta, c.detaliu FROM amp_calc c
$amp$;
-- „înainte” și „după”: exact baseline-ul (migrarea nu schimbă nicio funcție / tabel existent). Amprenta se calculează O DATĂ pe apel
-- (tabel temporar), apoi se compară cu baseline-ul și se verifică lanțul.
CREATE FUNCTION pg_temp.amp_verifica_20261221a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text; v_exec text;
BEGIN
  CREATE TEMP TABLE amp_rez_20261221a ON COMMIT DROP AS SELECT * FROM pg_temp.amp_calc_20261221a();
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261221a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261221a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261221a: baseline L15 necompletat sau invalid (scripts/meteo_xweather_amprente.sql)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261221a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261221a: baseline L15 cu etichete duble';
  END IF;
  -- pornirea trebuie să fie în baseline (altfel predicatul ar depinde de funcții neamprentate)
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261221a() b WHERE b.eticheta = 'functie fn_raport_santier_drept(bigint)')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261221a() b WHERE b.eticheta = 'functie fn_executie_proiect_permis(bigint,boolean)')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261221a() b WHERE b.eticheta = 'functie auth.uid()') THEN
    RAISE EXCEPTION '20261221a: baseline L15 fara functiile de pornire ale predicatului';
  END IF;
  -- mulțimea calculată (închiderea) = EXACT baseline-ul: o funcție din lanț lipsă din baseline sau una în plus = refuz (FULL JOIN)
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM amp_rez_20261221a c FULL JOIN pg_temp.amp_baseline_20261221a() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261221a: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM amp_rez_20261221a c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261221a: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
  -- independent de baseline: ce nu se poate amprenta static = REFUZ (nu doar semnalat): EXECUTE în corpul unei funcții sql / plpgsql din lanț
  -- (SQL dinamic: ce cheamă nu se vede în text; șirul 'EXECUTE' ca argument, ex. la has_function_privilege, nu contează) sau un limbaj al
  -- cărui corp nu se poate citi (în afara sql / plpgsql; internal / c sunt frunze: nu cheamă funcții SQL după nume)
  SELECT string_agg(p.oid::regprocedure::text || ' (' || l.lanname || ')', ', ' ORDER BY p.oid::regprocedure::text COLLATE "C")
    INTO v_exec
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(substr(c.eticheta, 9))::oid FROM amp_rez_20261221a c WHERE c.eticheta LIKE 'functie %')
     AND (l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')
          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M'));
  IF v_exec IS NOT NULL THEN
    RAISE EXCEPTION '20261221a: lantul de acces are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;
  END IF;
  DROP TABLE amp_rez_20261221a;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261221a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog: sites SHARE ROW EXCLUSIVE (cheia străină), NOWAIT, reîncercare ≤ 1 s ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.sites IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261221a: BUGET_LOCK: sites ocupat; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261221a: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── tabelul ──
CREATE TABLE public.meteo_zilnic_xweather (
  site_id bigint NOT NULL REFERENCES public.sites(id),
  data date NOT NULL CHECK (data >= DATE '2015-01-01'),
  versiune smallint NOT NULL CHECK (versiune BETWEEN 1 AND 50),
  -- valorile zilei (conditions/summary la coordonate); NULL = nedată de furnizor (niciodată 0 în locul lipsei)
  tmin_c numeric(5,2) CHECK (tmin_c BETWEEN -60 AND 60),
  tmax_c numeric(5,2) CHECK (tmax_c BETWEEN -60 AND 60),
  tmed_c numeric(5,2) CHECK (tmed_c BETWEEN -60 AND 60),
  precipitatii_mm numeric(7,2) CHECK (precipitatii_mm >= 0 AND precipitatii_mm < 1000),
  zapada_cm numeric(7,2) CHECK (zapada_cm >= 0 AND zapada_cm < 1000),
  vant_max_kmh numeric(6,2) CHECK (vant_max_kmh >= 0 AND vant_max_kmh < 400),
  rafala_max_kmh numeric(6,2) CHECK (rafala_max_kmh >= 0 AND rafala_max_kmh < 400),
  vant_dir text CHECK (vant_dir IN ('N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW')),
  vant_dir_grade smallint CHECK (vant_dir_grade BETWEEN 0 AND 359),
  umiditate_med numeric(5,2) CHECK (umiditate_med BETWEEN 0 AND 100),
  descriere text CHECK (char_length(descriere) BETWEEN 1 AND 200 AND descriere !~ '[[:cntrl:]]'),
  -- dovada cererii: coordonatele folosite și cererile (fără credențiale)
  lat numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  cerere_conditii text NOT NULL CHECK (cerere_conditii LIKE 'conditions/summary/%' AND char_length(cerere_conditii) <= 500 AND cerere_conditii !~* 'client_(id|secret)'),
  cerere_observatii text CHECK (cerere_observatii LIKE 'observations/summary/%' AND char_length(cerere_observatii) <= 500 AND cerere_observatii !~* 'client_(id|secret)'),
  -- stația de observație cea mai apropiată (observations/summary), sau motivul lipsei ei
  observatii_stare text NOT NULL CHECK (observatii_stare IN ('ok', 'fara_statie', 'neautorizat', 'eroare')),
  statie_id text CHECK (statie_id ~ '^[A-Za-z0-9_.:-]{1,40}$'),
  statie_nume text CHECK (char_length(statie_nume) BETWEEN 1 AND 120 AND statie_nume !~ '[[:cntrl:]]'),
  statie_distanta_km numeric(6,2) CHECK (statie_distanta_km >= 0 AND statie_distanta_km <= 500),
  statie_lat numeric(9,6) CHECK (statie_lat BETWEEN -90 AND 90),
  statie_lng numeric(9,6) CHECK (statie_lng BETWEEN -180 AND 180),
  -- răspunsurile brute (probă), plafonate
  raspuns_conditii jsonb NOT NULL CHECK (octet_length(raspuns_conditii::text) <= 200000),
  raspuns_observatii jsonb CHECK (octet_length(raspuns_observatii::text) <= 200000),
  preluat_la timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, data, versiune),
  CHECK (tmin_c IS NULL OR tmax_c IS NULL OR tmin_c <= tmax_c),
  CHECK (tmed_c IS NULL OR ((tmin_c IS NULL OR tmed_c >= tmin_c) AND (tmax_c IS NULL OR tmed_c <= tmax_c))),
  CHECK (tmin_c IS NOT NULL OR tmax_c IS NOT NULL OR tmed_c IS NOT NULL OR precipitatii_mm IS NOT NULL OR zapada_cm IS NOT NULL
         OR vant_max_kmh IS NOT NULL OR rafala_max_kmh IS NOT NULL OR umiditate_med IS NOT NULL),
  -- stația: 'ok' = identificată (id), altfel nimic despre ea; cererea de observații există dacă s-a făcut
  CHECK ((observatii_stare = 'ok') = (statie_id IS NOT NULL)),
  CHECK (observatii_stare = 'ok' OR (statie_nume IS NULL AND statie_distanta_km IS NULL AND statie_lat IS NULL AND statie_lng IS NULL)),
  CHECK ((statie_lat IS NULL) = (statie_lng IS NULL)),
  CHECK (cerere_observatii IS NOT NULL OR (observatii_stare <> 'ok' AND raspuns_observatii IS NULL))
);
COMMENT ON TABLE public.meteo_zilnic_xweather IS 'Vremea zilei pe șantier (site_id, data = ziua Europe/Bucharest, încheiată), din Vaisala Xweather (serviciu de date, nu senzor pe șantier): conditions/summary la coordonatele șantierului + stația de observație cea mai apropiată (observations/summary). NEMODIFICABIL: o corecție a furnizorului = versiune nouă. Scris doar de edge fn meteo-sync (service_role). Citire: fn_meteo_vede_site. 20261221a.';

-- versiunea și momentul preluării: serverul (L08). Ordinea lock-urilor (L06): doar rândurile zilei din ACEST tabel (citite), apoi rândul nou;
-- două preluări simultane ale aceleiași versiuni: cheia primară lasă una (23505), cealaltă e „deja”.
CREATE FUNCTION public.fn_meteo_xw_inserare() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_ant public.meteo_zilnic_xweather%ROWTYPE; v_are boolean;
BEGIN
  NEW.preluat_la := now();
  IF NEW.data >= (now() AT TIME ZONE 'Europe/Bucharest')::date THEN
    RAISE EXCEPTION 'xweather: doar zile încheiate (ora României); ziua % nu s-a terminat', NEW.data USING ERRCODE = '22023';
  END IF;
  SELECT x.* INTO v_ant FROM public.meteo_zilnic_xweather x
   WHERE x.site_id = NEW.site_id AND x.data = NEW.data ORDER BY x.versiune DESC LIMIT 1;
  v_are := FOUND;
  IF NEW.versiune IS DISTINCT FROM (CASE WHEN v_are THEN v_ant.versiune + 1 ELSE 1 END) THEN
    RAISE EXCEPTION 'xweather: versiunea % nu urmează ultimei versiuni a zilei (%)', NEW.versiune, CASE WHEN v_are THEN v_ant.versiune ELSE 0 END
      USING ERRCODE = '23505';
  END IF;
  IF v_are AND (NEW.tmin_c, NEW.tmax_c, NEW.tmed_c, NEW.precipitatii_mm, NEW.zapada_cm, NEW.vant_max_kmh, NEW.rafala_max_kmh, NEW.vant_dir,
                NEW.vant_dir_grade, NEW.umiditate_med, NEW.descriere, NEW.observatii_stare, NEW.statie_id, NEW.statie_nume, NEW.statie_distanta_km)
     IS NOT DISTINCT FROM (v_ant.tmin_c, v_ant.tmax_c, v_ant.tmed_c, v_ant.precipitatii_mm, v_ant.zapada_cm, v_ant.vant_max_kmh, v_ant.rafala_max_kmh,
                v_ant.vant_dir, v_ant.vant_dir_grade, v_ant.umiditate_med, v_ant.descriere, v_ant.observatii_stare, v_ant.statie_id, v_ant.statie_nume,
                v_ant.statie_distanta_km) THEN
    RAISE EXCEPTION 'xweather: nicio schimbare față de versiunea anterioară a zilei' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_meteo_xw_inserare() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_meteo_xw_inserare BEFORE INSERT ON public.meteo_zilnic_xweather
  FOR EACH ROW EXECUTE FUNCTION public.fn_meteo_xw_inserare();

-- nemodificabil pe ORICE cale (L07): și proprietarul e refuzat (doar revenirea, cu tabelul gol, îl scoate prin DROP)
CREATE FUNCTION public.fn_meteo_xw_nemodificabil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'xweather: vremea preluată nu se modifică și nu se șterge (o corecție a furnizorului intră ca versiune nouă)' USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_meteo_xw_nemodificabil() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_meteo_xw_nemodificabil BEFORE UPDATE OR DELETE ON public.meteo_zilnic_xweather
  FOR EACH ROW EXECUTE FUNCTION public.fn_meteo_xw_nemodificabil();
CREATE TRIGGER trg_meteo_xw_nemodificabil_golire BEFORE TRUNCATE ON public.meteo_zilnic_xweather
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_meteo_xw_nemodificabil();

-- ── cine vede vremea unui șantier: O SINGURĂ definiție (L19), pentru politică și pentru oricine o va folosi ──
-- adevărat doar pentru apelantul logat (auth.uid(), L08) care vede șantierul: (a) raportul zilnic (owner / alocat, cu restricția pe proiect),
-- (b) modulul Execuție pe proiectul șantierului, (c) contabilitatea, cu restricția pe proiect. Șantier inexistent = fals (în afara owner-ului,
-- care vede oricum tot). DEFINER: citește drepturile ca proprietar; întoarce doar adevărat / fals despre apelant.
CREATE FUNCTION public.fn_meteo_vede_site(p_site bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_site IS NOT NULL
    AND (public.fn_raport_santier_drept(p_site)
         OR (EXISTS (SELECT 1 FROM public.user_module_access u
                      WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin'))
             OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'contabilitate'))
            AND EXISTS (SELECT 1 FROM public.sites s
                         WHERE s.id = p_site AND (s.proiect_id IS NULL OR public.fn_executie_proiect_permis(s.proiect_id::bigint, false))))
$f$;
REVOKE ALL ON FUNCTION public.fn_meteo_vede_site(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_meteo_vede_site(bigint) TO authenticated;

ALTER TABLE public.meteo_zilnic_xweather ENABLE ROW LEVEL SECURITY;
CREATE POLICY meteo_xw_citire ON public.meteo_zilnic_xweather FOR SELECT TO authenticated USING (public.fn_meteo_vede_site(site_id));
-- drepturile, explicit (implicitele schemei dau ALL tuturor): authenticated doar SELECT (filtrat de politică), service_role SELECT + INSERT,
-- anon nimic; nimeni UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER
REVOKE ALL ON public.meteo_zilnic_xweather FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.meteo_zilnic_xweather TO authenticated;
GRANT SELECT, INSERT ON public.meteo_zilnic_xweather TO service_role;

-- ultima versiune a fiecărei zile (+ câte versiuni are ziua și prima preluare); RLS-ul tabelului se aplică cititorului (security_invoker)
CREATE VIEW public.v_meteo_zilnic_xweather WITH (security_invoker = on) AS
SELECT DISTINCT ON (x.site_id, x.data)
       x.site_id, x.data, x.versiune, count(*) OVER (PARTITION BY x.site_id, x.data) AS versiuni,
       x.tmin_c, x.tmax_c, x.tmed_c, x.precipitatii_mm, x.zapada_cm, x.vant_max_kmh, x.rafala_max_kmh, x.vant_dir, x.vant_dir_grade,
       x.umiditate_med, x.descriere, x.lat, x.lng, x.cerere_conditii, x.cerere_observatii, x.observatii_stare, x.statie_id, x.statie_nume,
       x.statie_distanta_km, x.statie_lat, x.statie_lng, x.preluat_la,
       min(x.preluat_la) OVER (PARTITION BY x.site_id, x.data) AS prima_preluare_la,
       'Vaisala Xweather'::text AS sursa
  FROM public.meteo_zilnic_xweather x
 ORDER BY x.site_id, x.data, x.versiune DESC;
COMMENT ON VIEW public.v_meteo_zilnic_xweather IS 'Ultima versiune a vremii zilei pe șantier (Vaisala Xweather), cu numărul de versiuni. security_invoker: RLS-ul tabelului (fn_meteo_vede_site). 20261221a.';
REVOKE ALL ON public.v_meteo_zilnic_xweather FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_meteo_zilnic_xweather TO authenticated, service_role;

-- ── postcondiții ──
DO $post$
DECLARE r record; v_alt text;
BEGIN
  -- RLS activ (fără FORCE: proprietarul e oprit de trigger-e, nu de politici), proprietar postgres, o singură politică, exact cea de citire
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.meteo_zilnic_xweather'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity
                   AND pg_get_userbyid(c.relowner) = 'postgres')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.meteo_zilnic_xweather'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.meteo_zilnic_xweather'::regclass AND pol.polname = 'meteo_xw_citire'
                      AND pol.polcmd = 'r' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid]
                      AND pol.polwithcheck IS NULL AND pg_get_expr(pol.polqual, pol.polrelid) = 'fn_meteo_vede_site(site_id)') THEN
    RAISE EXCEPTION '20261221a post: RLS / politica';
  END IF;
  -- drepturile pe tabel și pe vedere, fiecare pe rând (cu o listă, has_table_privilege e adevărat dacă ORICARE există)
  FOR r IN SELECT * FROM (VALUES
      ('anon', 'public.meteo_zilnic_xweather', 'SELECT', false), ('anon', 'public.meteo_zilnic_xweather', 'INSERT', false),
      ('anon', 'public.meteo_zilnic_xweather', 'UPDATE', false), ('anon', 'public.meteo_zilnic_xweather', 'DELETE', false),
      ('anon', 'public.meteo_zilnic_xweather', 'TRUNCATE', false), ('anon', 'public.meteo_zilnic_xweather', 'REFERENCES', false),
      ('anon', 'public.meteo_zilnic_xweather', 'TRIGGER', false),
      ('authenticated', 'public.meteo_zilnic_xweather', 'SELECT', true), ('authenticated', 'public.meteo_zilnic_xweather', 'INSERT', false),
      ('authenticated', 'public.meteo_zilnic_xweather', 'UPDATE', false), ('authenticated', 'public.meteo_zilnic_xweather', 'DELETE', false),
      ('authenticated', 'public.meteo_zilnic_xweather', 'TRUNCATE', false), ('authenticated', 'public.meteo_zilnic_xweather', 'REFERENCES', false),
      ('authenticated', 'public.meteo_zilnic_xweather', 'TRIGGER', false),
      ('service_role', 'public.meteo_zilnic_xweather', 'SELECT', true), ('service_role', 'public.meteo_zilnic_xweather', 'INSERT', true),
      ('service_role', 'public.meteo_zilnic_xweather', 'UPDATE', false), ('service_role', 'public.meteo_zilnic_xweather', 'DELETE', false),
      ('service_role', 'public.meteo_zilnic_xweather', 'TRUNCATE', false), ('service_role', 'public.meteo_zilnic_xweather', 'REFERENCES', false),
      ('service_role', 'public.meteo_zilnic_xweather', 'TRIGGER', false),
      ('anon', 'public.v_meteo_zilnic_xweather', 'SELECT', false), ('anon', 'public.v_meteo_zilnic_xweather', 'INSERT', false),
      ('anon', 'public.v_meteo_zilnic_xweather', 'UPDATE', false), ('anon', 'public.v_meteo_zilnic_xweather', 'DELETE', false),
      ('authenticated', 'public.v_meteo_zilnic_xweather', 'SELECT', true), ('authenticated', 'public.v_meteo_zilnic_xweather', 'INSERT', false),
      ('authenticated', 'public.v_meteo_zilnic_xweather', 'UPDATE', false), ('authenticated', 'public.v_meteo_zilnic_xweather', 'DELETE', false),
      ('service_role', 'public.v_meteo_zilnic_xweather', 'SELECT', true), ('service_role', 'public.v_meteo_zilnic_xweather', 'INSERT', false),
      ('service_role', 'public.v_meteo_zilnic_xweather', 'UPDATE', false), ('service_role', 'public.v_meteo_zilnic_xweather', 'DELETE', false)
    ) v(rol, obiect, drept, asteptat) LOOP
    IF has_table_privilege(r.rol, r.obiect, r.drept) IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION '20261221a post: drept % pe % pentru % = % (asteptat %)', r.drept, r.obiect, r.rol, NOT r.asteptat, r.asteptat;
    END IF;
  END LOOP;
  -- nimic pentru PUBLIC pe tabel / vedere (aclexplode, nu doar has_table_privilege), niciun drept pe coloane
  IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
              WHERE c.oid IN ('public.meteo_zilnic_xweather'::regclass, 'public.v_meteo_zilnic_xweather'::regclass) AND e.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.meteo_zilnic_xweather'::regclass, 'public.v_meteo_zilnic_xweather'::regclass)
                  AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261221a post: drepturi pentru PUBLIC / pe coloane';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_meteo_zilnic_xweather'::regclass AND reloptions = ARRAY['security_invoker=on']) THEN
    RAISE EXCEPTION '20261221a post: vederea nu e security_invoker';
  END IF;
  -- funcțiile: limbaj, DEFINER, search_path fix, proprietar, drepturi exacte
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_meteo_vede_site(bigint)', 'sql', true, 'boolean', true),
      ('public.fn_meteo_xw_inserare()', 'plpgsql', true, 'trigger', false),
      ('public.fn_meteo_xw_nemodificabil()', 'plpgsql', false, 'trigger', false)
    ) v(fn, limbaj, definer, intoarce, exec_auth) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.prorettype = r.intoarce::regtype
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = r.exec_auth
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '20261221a post: functia % (limbaj / definer / search_path / owner / EXECUTE)', r.fn;
    END IF;
  END LOOP;
  -- trigger-ele: forma exactă, active, fără WHEN, singurele de pe tabel (în afara celor interne de FK)
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.meteo_zilnic_xweather'::regclass AND NOT tgisinternal) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.meteo_zilnic_xweather'::regclass AND tg.tgname = 'trg_meteo_xw_inserare'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_meteo_xw_inserare()'::regprocedure
                      AND tg.tgtype = (1 | 2 | 4))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.meteo_zilnic_xweather'::regclass AND tg.tgname = 'trg_meteo_xw_nemodificabil'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_meteo_xw_nemodificabil()'::regprocedure
                      AND tg.tgtype = (1 | 2 | 8 | 16))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.meteo_zilnic_xweather'::regclass AND tg.tgname = 'trg_meteo_xw_nemodificabil_golire'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_meteo_xw_nemodificabil()'::regprocedure
                      AND tg.tgtype = (2 | 32)) THEN
    RAISE EXCEPTION '20261221a post: trigger-ele';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meteo_zilnic_xweather) THEN
    RAISE EXCEPTION '20261221a post: tabelul nou are randuri';
  END IF;
  -- L15: funcțiile NOI cheamă (aceeași regulă de nume ca închiderea) DOAR pornirea amprentată — auth.uid() și cele două funcții de drept —
  -- și nimic dinamic; altfel predicatul ar depinde de o funcție din afara amprentei
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.oid IN ('public.fn_meteo_vede_site(bigint)'::regprocedure, 'public.fn_meteo_xw_inserare()'::regprocedure, 'public.fn_meteo_xw_nemodificabil()'::regprocedure)
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p2.oid NOT IN ('auth.uid()'::regprocedure, 'public.fn_raport_santier_drept(bigint)'::regprocedure, 'public.fn_executie_proiect_permis(bigint, boolean)'::regprocedure);
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_meteo_vede_site(bigint)'::regprocedure, 'public.fn_meteo_xw_inserare()'::regprocedure,
                  'public.fn_meteo_xw_nemodificabil()'::regprocedure) AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M') THEN
    RAISE EXCEPTION '20261221a post: functiile noi cheama in afara pornirii amprentate: %', coalesce(v_alt, 'EXECUTE dinamic');
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261221a_meteo_xweather_zilnic:' || txid_current() THEN
    RAISE EXCEPTION '20261221a: garda final invalida';
  END IF;
END $post$;

-- L15: aceeași amprentă DUPĂ schimbare, timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261221a('dupa');
  RAISE NOTICE '20261221a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261221a(text), pg_temp.amp_calc_20261221a(), pg_temp.amp_baseline_20261221a();
