-- Version 20261222120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261222a_sites_drept_creare — dreptul de a CREA un șantier (rând nou în public.sites) devine un drept pe cont, nu doar al owner-ului
-- (decizia owner-ului pe tichetul TKT-2026-0359, 13.11.2026: contul care a cerut primește dreptul; se acordă EXACT dreptul cerut).
--
-- Ce face:
--   * O cheie NOUĂ de modul, 'santiere_creare' (rând în app_modules, ținta cheii străine din user_module_access): fără ea dreptul nu se poate
--     acorda. NU se folosește 'administrativ.locatii': cheia există deja și înseamnă „Locații închiriate” (tab-ul din Administrativ, tabelele
--     locatii_inchiriate / locatii_cheltuieli) — un editor de chirii ar fi primit și dreptul de a crea șantiere, iar contul care cere șantiere
--     ar fi primit și chiriile. Cheia nouă e de nivel superior (fără punct), ca să nu deschidă nimic prin potrivirea pe prefix din interfață
--     (hasModuleAccess: 'administrativ.x' deschide modulul Administrativ; în BD 'executie.%' deschide documentele de repartizat).
--     show_on_homepage = false: nu apare ca modul pe pagina de start.
--   * Predicatul UNIC fn_sites_drept_creare(proiect) (L19, L08): apelantul logat (auth.uid()) are rândul (santiere_creare, editor / admin) în
--     user_module_access ȘI, dacă șantierul nou e legat de un proiect, are drept de SCRIERE în Execuție pe acel proiect
--     (fn_executie_proiect_permis(proiect, true), L09: ținta referită se verifică, FK dovedește doar existența).
--   * O politică NOUĂ, PERMISSIVE, DOAR pe INSERT: sites_insert_drept_creare WITH CHECK (fn_sites_drept_creare(proiect_id)). Politicile
--     PERMISSIVE de același fel se leagă cu SAU, deci INSERT = politica owner-ului de azi (neatinsă) SAU dreptul pe cont. UPDATE / DELETE /
--     SELECT neschimbate (contul cu drept NU redenumește, nu dezactivează, nu șterge șantiere și nu leagă după aceea un șantier de proiect).
-- Ce NU face: nu acordă dreptul nimănui (rândul din user_module_access îl adaugă coordonatorul, separat, cu acordul owner-ului); nu lărgește la
--   conturile cu can_manage_contracts; nu schimbă drepturile pe tabel, alte politici sau trigger-ele lui sites (amprenta L15 de mai jos).
--
-- L15: amprenta COMPLETĂ (corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/sitesDreptCreareMigrare.test.js) a tabelului sites (drepturi pe tabel
--   și coloane, RLS / FORCE, secvențe, TOATE politicile, triggerele) și a funcțiilor din ÎNCHIDEREA TRANZITIVĂ calculată în migrare (blocul
--   INCHIDERE_L15, identic cu cel din script; pornirea: auth.uid(), fn_executie_proiect_permis + funcțiile politicilor și triggerelor lui
--   sites), comparată cu BASELINE-ul din producție ÎNAINTE și DUPĂ. „După” = baseline-ul, cu EXACT două diferențe: linia politicii noi (restul
--   politicilor identic) și funcția nouă (detaliu exact). EXECUTE dinamic / limbaj neanalizabil în lanț = refuz. Valorile le scoate
--   coordonatorul cu scripts/sites_drept_creare_amprente.sql (tranzacție READ ONLY) în blocul marcat; necompletat = refuz.
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$).
--   Lock (L06): sites ACCESS EXCLUSIVE (cerut oricum de CREATE POLICY), NOWAIT, reîncercat la 50 ms până la 1 s de la BEGIN (peste = 55P03,
--   nimic schimbat), după verificările de catalog; apoi rândul nou din app_modules. Oprește câteva milisecunde citirile din sites.
-- Revenire: supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql (prin runner, cu plafon; refuză dacă dreptul a fost acordat cuiva).
-- Probe: scripts/pglite/test_sites_drept_creare_local.mjs (local, PGlite: matricea de drepturi, revenire, mutanți).
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare:' || txid_current() THEN
    RAISE EXCEPTION '20261222a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261222a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261222a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- plafonul total = ceasul de tranzacție PostgreSQL 17, pus de runner înainte de BEGIN (sursa 'session'), citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261222a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261222a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_drept_creare')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sites'::regclass AND polname = 'sites_insert_drept_creare')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise, cu tipurile acceptate
  FOR r IN SELECT * FROM (VALUES
      ('sites', 'id', 'integer|bigint'), ('sites', 'proiect_id', 'integer|bigint'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text|character varying'),
      ('user_module_access', 'access_level', 'text|character varying'),
      ('app_modules', 'key', 'text|character varying'), ('app_modules', 'parent_key', 'text|character varying'),
      ('app_modules', 'name', 'text|character varying'), ('app_modules', 'icon', 'text|character varying'),
      ('app_modules', 'description', 'text|character varying'), ('app_modules', 'is_active', 'boolean'),
      ('app_modules', 'show_on_homepage', 'boolean')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261222a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- dependențele predicatului (corpul și drepturile: baseline-ul L15 de mai jos)
  IF to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')) <> 'boolean'::regtype THEN
    RAISE EXCEPTION '20261222a: dependentele (fn_executie_proiect_permis, auth.uid) lipsesc sau difera';
  END IF;
  -- politica nouă are efect DOAR dacă: RLS e activ pe sites, authenticated are dreptul de INSERT pe tabel și nicio politică RESTRICTIVE pe
  -- INSERT nu o anulează (o RESTRICTIVE se leagă cu ȘI). Altfel livrarea ar fi fără efect: refuz explicit, cu motivul.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sites'::regclass) THEN
    RAISE EXCEPTION '20261222a: RLS nu e activ pe sites';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.sites', 'INSERT') THEN
    RAISE EXCEPTION '20261222a: authenticated nu are INSERT pe sites (politica noua ar fi fara efect)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sites'::regclass AND NOT polpermissive AND polcmd IN ('a', '*')) THEN
    RAISE EXCEPTION '20261222a: sites are o politica RESTRICTIVE pe INSERT (politica noua ar fi fara efect)';
  END IF;
END $pre$;

-- ── L15: amprenta COMPLETĂ a tabelului sites și a lanțului de funcții, verificată ÎNAINTE și DUPĂ (tiparul 20261221a) ──
-- >>> BASELINE 20261222a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/sites_drept_creare_amprente.sql, copiată
--     ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat (DE_COMPLETAT) = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261222a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('DE_COMPLETAT', 'DE_COMPLETAT')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261222a
CREATE FUNCTION pg_temp.amp_calc_20261222a() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH RECURSIVE
amp_tabele(oid) AS (SELECT 'public.sites'::regclass::oid),
-- >>> INCHIDERE_L15 20261222a
-- Pornirea = ce cheamă DIRECT predicatul nou fn_sites_drept_creare (auth.uid(), fn_executie_proiect_permis; postcondiția verifică că nu
--   cheamă altceva) + funcțiile politicilor și triggerelor lui sites. Închiderea se CALCULEAZĂ aici, din catalog, nu se ia din BASELINE:
--   orice funcție (în afara pg_catalog / information_schema) al cărei nume apare ca apel „nume(” în corpul unei funcții sql / plpgsql din
--   lanț (supra-aproximare: un nume potrivit în plus doar intră în amprentă), numele neobișnuite prin căutare de text, plus dependențele din
--   pg_depend (corpurile BEGIN ATOMIC). Fără limită de adâncime: UNION oprește ciclurile. BASELINE-ul trebuie să aibă EXACT această
--   mulțime (o funcție lipsă sau în plus = refuz). EXECUTE dinamic / limbaj neanalizabil în lanț = refuz (amp_verifica).
amp_pornire(oid) AS (VALUES (to_regprocedure('auth.uid()')::oid), (to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')::oid)),
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
SELECT c.eticheta, c.amprenta, c.detaliu FROM amp_calc c
$amp$;
-- „înainte”: exact baseline-ul. „după”: baseline-ul cu EXACT două diferențe așteptate — (1) eticheta politicilor lui sites = politicile de
-- dinainte + linia politicii noi (fără ea, md5 = baseline-ul); (2) funcția nouă, cu detaliul exact (proprietăți, drepturi, corp revizuit).
-- Orice altă diferență (drepturi, alte politici, triggere, funcții din lanț) = refuz. Amprenta se calculează O DATĂ pe apel.
CREATE FUNCTION pg_temp.amp_verifica_20261222a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text; v_exec text; v_pol text; v_noi text[]; v_rest text[]; v_fn text;
  c_pol constant text := 'tabel sites | politici';
  c_fn constant text := 'functie fn_sites_drept_creare(bigint)';
  c_pref constant text := 'sites_insert_drept_creare | ';
BEGIN
  IF p_moment NOT IN ('inainte', 'dupa') THEN RAISE EXCEPTION '20261222a: moment necunoscut %', p_moment; END IF;
  CREATE TEMP TABLE amp_rez_20261222a ON COMMIT DROP AS SELECT * FROM pg_temp.amp_calc_20261222a();
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261222a: baseline L15 necompletat sau invalid (scripts/sites_drept_creare_amprente.sql)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261222a: baseline L15 cu etichete duble';
  END IF;
  -- pornirea și tabelul trebuie să fie în baseline; funcția nouă NU (ea apare doar „după”)
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'functie fn_executie_proiect_permis(bigint,boolean)')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'functie auth.uid()')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = c_pol)
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = c_fn) THEN
    RAISE EXCEPTION '20261222a: baseline L15 fara pornire / politicile lui sites, sau cu functia noua';
  END IF;
  IF p_moment = 'dupa' THEN
    -- (1) politicile: exact o linie nouă, a politicii noi, în forma exactă; restul liniilor = politicile de dinainte (md5 = baseline).
    --     Expresiile altor politici pot avea mai multe rânduri (pg_get_expr); politica nouă are UN rând, deci scoaterea lui lasă exact textul
    --     de dinainte (ordinea COLLATE "C" a celorlalte nu se schimbă).
    SELECT c.detaliu INTO v_pol FROM amp_rez_20261222a c WHERE c.eticheta = c_pol;
    SELECT coalesce(array_agg(l ORDER BY o) FILTER (WHERE left(l, length(c_pref)) = c_pref), '{}'),
           coalesce(array_agg(l ORDER BY o) FILTER (WHERE left(l, length(c_pref)) IS DISTINCT FROM c_pref), '{}')
      INTO v_noi, v_rest
      FROM unnest(string_to_array(v_pol, chr(10))) WITH ORDINALITY AS u(l, o);
    IF cardinality(v_noi) <> 1
       OR v_noi[1] NOT IN (c_pref || 'a | PERMISSIVE | roluri=authenticated | USING true | CHECK fn_sites_drept_creare(proiect_id)',
                           c_pref || 'a | PERMISSIVE | roluri=authenticated | USING true | CHECK fn_sites_drept_creare((proiect_id)::bigint)')
       OR md5(coalesce(nullif(array_to_string(v_rest, chr(10)), ''), '(fara politici)'))
          IS DISTINCT FROM (SELECT b.amprenta FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = c_pol) THEN
      RAISE EXCEPTION '20261222a: politicile lui sites (dupa) nu sunt cele de dinainte + politica noua: %', v_pol;
    END IF;
    -- (2) funcția nouă: detaliul exact (corpul revizuit — amprenta e și în revenire, testul o leagă de corp)
    SELECT c.detaliu INTO v_fn FROM amp_rez_20261222a c WHERE c.eticheta = c_fn;
    IF v_fn IS DISTINCT FROM 'tip=f, limbaj=sql, definer=true, volatil=s, strict=false, leakproof=false, proprietar=postgres, '
                             || 'config=search_path=public, pg_temp, intoarce=boolean, acl=authenticated:EXECUTE, postgres:EXECUTE, '
                             -- AMPRENTA-CORP predicatul
                             || 'corp_md5=f47a55e03818d9998175213a961e83b0'
                             || ', sqlbody_md5=-' THEN
      RAISE EXCEPTION '20261222a: functia noua (dupa) are alt detaliu: %', coalesce(v_fn, 'LIPSESTE');
    END IF;
  END IF;
  -- restul: EXACT baseline-ul (FULL JOIN: o funcție din lanț lipsă din baseline sau una în plus = refuz)
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM (SELECT * FROM amp_rez_20261222a x WHERE p_moment = 'inainte' OR x.eticheta NOT IN (c_pol, c_fn)) c
    FULL JOIN (SELECT * FROM pg_temp.amp_baseline_20261222a() y WHERE p_moment = 'inainte' OR y.eticheta <> c_pol) b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261222a: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM amp_rez_20261222a c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261222a: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
  -- independent de baseline: EXECUTE dinamic în corpul unei funcții sql / plpgsql din lanț (șirul 'EXECUTE' ca argument nu contează) sau un
  -- limbaj al cărui corp nu se poate citi (în afara sql / plpgsql; internal / c sunt frunze) = REFUZ
  SELECT string_agg(p.oid::regprocedure::text || ' (' || l.lanname || ')', ', ' ORDER BY p.oid::regprocedure::text COLLATE "C")
    INTO v_exec
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(substr(c.eticheta, 9))::oid FROM amp_rez_20261222a c WHERE c.eticheta LIKE 'functie %')
     AND (l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')
          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M'));
  IF v_exec IS NOT NULL THEN
    RAISE EXCEPTION '20261222a: lantul de acces are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;
  END IF;
  DROP TABLE amp_rez_20261222a;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261222a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog: sites ACCESS EXCLUSIVE (CREATE POLICY), NOWAIT, reîncercare ≤ 1 s ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.sites IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261222a: BUGET_LOCK: sites ocupat; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261222a: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── cheia de modul (catalog; NU acordă nimic) ──
INSERT INTO public.app_modules (key, parent_key, name, icon, description, is_active, show_on_homepage)
VALUES ('santiere_creare', NULL, 'Creare șantiere', '🏗️',
        'Dreptul de a crea un șantier nou (Admin → Șantiere și Execuție → Proiect nou). Nivel editor sau admin. Nu dă drept de modificare sau ștergere. 20261222a.',
        true, false);

-- ── cine poate crea un șantier: O SINGURĂ definiție (L19), pentru politică și pentru oricine o va folosi ──
-- adevărat doar pentru apelantul logat (auth.uid(), L08) cu dreptul pe cont și, dacă șantierul e legat de un proiect, cu drept de scriere în
-- Execuție pe acel proiect (L09). Owner-ul are politica lui de azi (neatinsă). DEFINER: citește drepturile ca proprietar; întoarce doar
-- adevărat / fals despre apelant.
CREATE FUNCTION public.fn_sites_drept_creare(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_module_access u
                 WHERE u.profile_id = auth.uid() AND u.module = 'santiere_creare' AND u.access_level IN ('editor', 'admin'))
    AND (p_proiect IS NULL OR public.fn_executie_proiect_permis(p_proiect, true))
$f$;
REVOKE ALL ON FUNCTION public.fn_sites_drept_creare(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sites_drept_creare(bigint) TO authenticated;
COMMENT ON FUNCTION public.fn_sites_drept_creare(bigint) IS 'Apelantul (auth.uid()) poate crea un șantier: dreptul santiere_creare (editor / admin) + scriere în Execuție pe proiectul legat (dacă e). Folosit de politica sites_insert_drept_creare. 20261222a.';

CREATE POLICY sites_insert_drept_creare ON public.sites AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.fn_sites_drept_creare(proiect_id::bigint));

-- ── postcondiții ──
DO $post$
DECLARE v_alt text;
BEGIN
  -- politica nouă: exact INSERT, PERMISSIVE, doar authenticated, fără USING, cu predicatul
  IF NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.sites'::regclass AND pol.polname = 'sites_insert_drept_creare'
                   AND pol.polcmd = 'a' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polqual IS NULL
                   AND pg_get_expr(pol.polwithcheck, pol.polrelid) IN ('fn_sites_drept_creare(proiect_id)', 'fn_sites_drept_creare((proiect_id)::bigint)')) THEN
    RAISE EXCEPTION '20261222a post: politica sites_insert_drept_creare';
  END IF;
  -- funcția: limbaj, DEFINER, STABLE, search_path fix, proprietar, tip întors, EXECUTE doar pentru authenticated (nimic pentru PUBLIC / anon / service_role)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_sites_drept_creare(bigint)') AND l.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's'
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.prorettype = 'boolean'::regtype
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
    RAISE EXCEPTION '20261222a post: functia fn_sites_drept_creare (limbaj / definer / search_path / owner / EXECUTE)';
  END IF;
  -- cheia de modul: exact rândul scris; migrarea NU acordă dreptul nimănui
  IF (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare' AND parent_key IS NULL AND is_active AND NOT show_on_homepage) <> 1 THEN
    RAISE EXCEPTION '20261222a post: cheia de modul santiere_creare';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a post: dreptul santiere_creare apare deja acordat (migrarea nu acorda nimic)';
  END IF;
  -- L15: funcția nouă cheamă (aceeași regulă de nume ca închiderea) DOAR pornirea amprentată — auth.uid() și fn_executie_proiect_permis
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.oid = 'public.fn_sites_drept_creare(bigint)'::regprocedure
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p2.oid NOT IN ('auth.uid()'::regprocedure, 'public.fn_executie_proiect_permis(bigint, boolean)'::regprocedure);
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_sites_drept_creare(bigint)'::regprocedure
                  AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M') THEN
    RAISE EXCEPTION '20261222a post: functia noua cheama in afara pornirii amprentate: %', coalesce(v_alt, 'EXECUTE dinamic');
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare:' || txid_current() THEN
    RAISE EXCEPTION '20261222a: garda final invalida';
  END IF;
END $post$;

-- L15: amprenta DUPĂ schimbare (baseline + exact politica și funcția noi), timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261222a('dupa');
  RAISE NOTICE '20261222a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261222a(text), pg_temp.amp_calc_20261222a(), pg_temp.amp_baseline_20261222a();
