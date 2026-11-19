-- Version 20261222120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261222a_sites_drept_creare — dreptul de a CREA un șantier devine un drept pe cont, nu doar al owner-ului
-- (decizia owner-ului pe tichetul TKT-2026-0359, 13.11.2026: contul care a cerut primește dreptul; se acordă EXACT dreptul cerut).
-- Runda 2 (Jakarinos NO-GO pe e4277115): în locul politicii RLS de INSERT, o funcție RPC cu parametri limitați, atomică și idempotentă.
--
-- Ce face:
--   * O cheie NOUĂ de modul, 'santiere_creare' (rând în app_modules, ținta cheii străine din user_module_access): fără ea dreptul nu se poate
--     acorda. NU se folosește 'administrativ.locatii': cheia există deja și înseamnă „Locații închiriate” (tab-ul din Administrativ, tabelele
--     locatii_inchiriate / locatii_cheltuieli). Cheia nouă e de nivel superior (fără punct), ca să nu deschidă nimic prin potrivirea pe prefix
--     din interfață (hasModuleAccess: 'administrativ.x' deschide modulul Administrativ; în BD 'executie.%' deschide documentele de repartizat).
--     show_on_homepage = false: nu apare ca modul pe pagina de start.
--   * RPC-ul public.fn_sites_creeaza(p_nume, p_proiect, p_beneficiar) → jsonb {site_id, creat}: SECURITY DEFINER, search_path fix, EXECUTE doar
--     pentru authenticated. O SINGURĂ definiție a regulii (L19):
--       - cine (L08, L09): apelantul logat (auth.uid()) e owner, SAU are în user_module_access cheile EXACTE (santiere_creare, editor / admin)
--         ȘI (executie, editor / admin); ȘI proiectul e permis la scriere conform restricțiilor de Execuție (fn_executie_proiect_permis(p, true):
--         cont nerestrâns sau proiectul în lista lui de scriere; proiect NULL = doar cont nerestrâns). Un singur mesaj pentru orice refuz de drept.
--       - ce scrie (verdict P1-2): DOAR numele, beneficiarul și legătura cu proiectul; restul coloanelor rămân pe valorile implicite ale
--         tabelului, aceleași ca la „Adaugă Șantier” al owner-ului (fără contract, tip „santier”, fără coordonate — deci nicio prelucrare meteo,
--         care cere lat / lng —, fără alias-uri, fără denumire QR). Nu există altă cale: INSERT-ul direct în sites rămâne doar al owner-ului.
--       - cu proiect (verdict P1-1, dublarea): totul într-o tranzacție (L02) — proiectul FOR UPDATE → id-ul nou din secvența lui sites →
--         proiect.site_id = id → INSERT în sites cu proiect_id. Triggerul existent tr_auto_create_executie_proiect (AFTER INSERT, neatins) găsește
--         astfel proiectul deja legat (site_id = NEW.id) și NU mai creează proiectul automat. Postcondiție în RPC: exact UN proiect pe șantierul
--         nou, altfel totul se anulează (o schimbare viitoare a triggerului nu poate dubla în tăcere).
--       - idempotent pe proiect (verdict P2, L04 / L05): proiectul are deja șantierul lui (legat în ambele sensuri, de exemplu de un apel al
--         cărui răspuns s-a pierdut) → întoarce același șantier, creat = false, nimic scris; proiect legat de ALT șantier → refuz (P0001).
--       - fără proiect (Admin → Șantiere, cont cu drept): ca INSERT-ul owner-ului de azi (triggerul creează proiectul automat).
-- Ce NU face: nu acordă dreptul nimănui (rândul din user_module_access îl adaugă coordonatorul, separat, cu acordul owner-ului); nu lărgește la
--   conturile cu can_manage_contracts; nu schimbă politicile lui sites (INSERT / UPDATE / DELETE rămân ale owner-ului: interfața veche cu
--   dreptul acordat primește refuz la INSERT, nu un fals succes), drepturile pe tabel, triggerele sau vreo funcție existentă (amprenta L15).
--
-- L15: amprenta COMPLETĂ (corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/sitesDreptCreareMigrare.test.js) a tabelului sites (drepturi pe tabel
--   și coloane, RLS / FORCE, secvențe, TOATE politicile, triggerele — inclusiv tr_auto_create_executie_proiect, pe care se sprijină ordinea din
--   RPC) și a funcțiilor din ÎNCHIDEREA TRANZITIVĂ calculată în migrare (blocul INCHIDERE_L15, identic cu cel din script; pornirea: auth.uid(),
--   fn_executie_proiect_permis, RPC-ul nou (doar „după”) + funcțiile politicilor și triggerelor lui sites — deci și
--   fn_auto_create_executie_proiect / fn_site_name_to_cod_intern), comparată cu BASELINE-ul din producție ÎNAINTE și DUPĂ. „După” = baseline-ul,
--   cu EXACT o diferență: funcția nouă (detaliu exact: proprietăți, drepturi, corpul revizuit). EXECUTE dinamic / limbaj neanalizabil în lanț =
--   refuz. Valorile le scoate coordonatorul cu scripts/sites_drept_creare_amprente.sql (tranzacție READ ONLY) în blocul marcat; necompletat = refuz.
--   Perimetru declarat: triggerele lui executie_proiecte (garda de acces din 20261209a, garda izometriei din 20261102a) rulează la UPDATE-ul
--   site_id din RPC, ca la UPDATE-ul direct de azi din wizard; nu sunt în amprentă (pot doar refuza), iar proba pe clonă le rulează pe cele reale.
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$).
--   Lock (L06): sites SHARE (oprește DDL-ul pe sites până la COMMIT, ca amprenta „după” să rămână adevărată; citirile merg), NOWAIT, reîncercat la
--   50 ms până la 1 s de la BEGIN (peste = 55P03, nimic schimbat), după verificările de catalog; apoi rândul nou din app_modules.
-- Revenire: supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql (prin runner, cu plafon; refuză dacă dreptul a fost acordat cuiva;
--   șantierele create între timp rămân — sunt date ale utilizatorilor, nu obiecte ale migrării).
-- Probe: scripts/pglite/test_sites_drept_creare_local.mjs (local, PGlite) și supabase/tests/20261222a_sites_drept_creare_clona.sh (clona PG17:
--   concurență, aplicare → revenire → reaplicare; o rulează coordonatorul).
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
  -- reaplicare = refuz (orice supraîncărcare a numelui, nu doar semnătura nouă)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') THEN
    RAISE EXCEPTION '20261222a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise, cu tipurile acceptate
  FOR r IN SELECT * FROM (VALUES
      ('sites', 'id', 'integer|bigint'), ('sites', 'name', 'text'), ('sites', 'active', 'boolean'),
      ('sites', 'beneficiar_principal', 'text'), ('sites', 'proiect_id', 'integer|bigint'),
      ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'site_id', 'integer|bigint'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
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
  -- dependențele RPC-ului (corpul și drepturile lor: baseline-ul L15 de mai jos)
  IF to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')) <> 'boolean'::regtype THEN
    RAISE EXCEPTION '20261222a: dependentele (fn_executie_proiect_permis, auth.uid) lipsesc sau difera';
  END IF;
  -- ordinea din RPC (proiect.site_id ÎNAINTEA rândului din sites) cere: id-ul lui sites dintr-o secvență proprie, nicio cheie străină pe
  -- executie_proiecte.site_id (ar refuza id-ul încă neinserat) și triggerul de proiect automat EXACT cel de azi (AFTER INSERT, pe rând, fără
  -- WHEN / argumente, activ, funcția fn_auto_create_executie_proiect(); corpul ei e în baseline-ul L15)
  IF pg_get_serial_sequence('public.sites', 'id') IS NULL THEN
    RAISE EXCEPTION '20261222a: sites.id nu are secventa proprie (serial / identity)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
              WHERE c.conrelid = 'public.executie_proiecte'::regclass AND c.contype = 'f' AND a.attname = 'site_id') THEN
    RAISE EXCEPTION '20261222a: executie_proiecte.site_id are cheie straina (ordinea din RPC nu mai e valabila)';
  END IF;
  IF (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid = 'public.sites'::regclass AND NOT tg.tgisinternal
         AND tg.tgfoid = to_regprocedure('public.fn_auto_create_executie_proiect()')) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.sites'::regclass AND tg.tgname = 'tr_auto_create_executie_proiect'
                      AND tg.tgfoid = to_regprocedure('public.fn_auto_create_executie_proiect()') AND tg.tgtype = 5 AND tg.tgenabled = 'O'
                      AND tg.tgnargs = 0 AND tg.tgqual IS NULL AND NOT tg.tgisinternal) THEN
    RAISE EXCEPTION '20261222a: triggerul tr_auto_create_executie_proiect nu e cel asteptat (AFTER INSERT FOR EACH ROW, activ, fara WHEN)';
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
SELECT c.eticheta, c.amprenta, c.detaliu FROM amp_calc c
$amp$;
-- „înainte”: exact baseline-ul. „după”: baseline-ul cu EXACT o diferență așteptată — funcția nouă, cu detaliul exact (proprietăți, drepturi,
-- corp revizuit). Orice altă diferență (drepturi, politici, triggere, funcții din lanț) = refuz. Amprenta se calculează O DATĂ pe apel.
CREATE FUNCTION pg_temp.amp_verifica_20261222a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text; v_exec text; v_fn text;
  c_fn constant text := 'functie fn_sites_creeaza(text,bigint,text)';
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
  -- pornirea, triggerul de proiect automat și tabelul trebuie să fie în baseline; funcția nouă NU (ea apare doar „după”)
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'functie fn_executie_proiect_permis(bigint,boolean)')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'functie auth.uid()')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'functie fn_auto_create_executie_proiect()')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'tabel sites | triggere')
     OR NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = 'tabel sites | politici')
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222a() b WHERE b.eticheta = c_fn) THEN
    RAISE EXCEPTION '20261222a: baseline L15 fara pornire / triggerul de proiect automat / politicile lui sites, sau cu functia noua';
  END IF;
  IF p_moment = 'dupa' THEN
    -- funcția nouă: detaliul exact (corpul revizuit — amprenta e și în revenire, testul o leagă de corp)
    SELECT c.detaliu INTO v_fn FROM amp_rez_20261222a c WHERE c.eticheta = c_fn;
    IF v_fn IS DISTINCT FROM 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, '
                             || 'config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, '
                             -- AMPRENTA-CORP rpc
                             || 'corp_md5=7adb03ef93e482804b01fca31a8bd383'
                             || ', sqlbody_md5=-' THEN
      RAISE EXCEPTION '20261222a: functia noua (dupa) are alt detaliu: %', coalesce(v_fn, 'LIPSESTE');
    END IF;
  END IF;
  -- restul: EXACT baseline-ul (FULL JOIN: o funcție din lanț lipsă din baseline sau una în plus = refuz)
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM (SELECT * FROM amp_rez_20261222a x WHERE p_moment = 'inainte' OR x.eticheta <> c_fn) c
    FULL JOIN pg_temp.amp_baseline_20261222a() b ON b.eticheta = c.eticheta
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

-- ── punctul UNIC de blocare (L06), după verificările de catalog: sites SHARE (DDL-ul pe sites oprit până la COMMIT), NOWAIT, reîncercare ≤ 1 s ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.sites IN SHARE MODE NOWAIT;
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
        'Dreptul de a crea un șantier nou (Execuție → Proiect nou și Admin → Șantiere), cu Execuție editor / admin. Nivel editor sau admin. Nu dă drept de modificare sau ștergere. 20261222a.',
        true, false);

-- ── RPC-ul: O SINGURĂ definiție a regulii (L19) și O SINGURĂ cale de creare pentru contul cu drept ──
-- Ordinea lock-urilor (L06): 1. rândul proiectului FOR UPDATE; 2. UPDATE pe același rând (site_id; triggerele lui executie_proiecte);
--   3. INSERT în sites (cheia străină ia KEY SHARE pe proiect, deja ținut; triggerul AFTER INSERT citește executie_proiecte). Fără proiect: doar
--   INSERT-ul (ca owner-ul azi). Un al doilea apel pe același proiect așteaptă pasul 1, apoi găsește legătura și o întoarce (idempotent).
-- Corpul nu conține apeluri în afara pornirii amprentate (auth.uid, fn_executie_proiect_permis) și al funcțiilor din pg_catalog (postcondiție).
CREATE FUNCTION public.fn_sites_creeaza(p_nume text, p_proiect bigint, p_beneficiar text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_nume text := nullif(btrim(p_nume), '');
  v_benef text := nullif(btrim(p_beneficiar), '');
  v_leg bigint;
  v_site bigint;
  v_n integer;
BEGIN
  IF v_uid IS NULL
     OR NOT (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.is_owner IS TRUE)
             OR (EXISTS (SELECT 1 FROM public.user_module_access u
                          WHERE u.profile_id = v_uid AND u.module = 'santiere_creare' AND u.access_level IN ('editor', 'admin'))
                 AND EXISTS (SELECT 1 FROM public.user_module_access u
                              WHERE u.profile_id = v_uid AND u.module = 'executie' AND u.access_level IN ('editor', 'admin'))))
     OR public.fn_executie_proiect_permis(p_proiect, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Crearea șantierului: contul nu are dreptul „Creare șantiere” sau nu poate scrie în Execuție pe proiectul ales'
      USING ERRCODE = '42501';
  END IF;
  IF v_nume IS NULL THEN
    RAISE EXCEPTION 'Crearea șantierului: denumirea lipsește' USING ERRCODE = '22023';
  END IF;
  IF p_proiect IS NULL THEN
    INSERT INTO public.sites (name, active, beneficiar_principal) VALUES (v_nume, true, v_benef) RETURNING id INTO v_site;
    RETURN jsonb_build_object('site_id', v_site, 'creat', true);
  END IF;
  SELECT e.site_id INTO v_leg FROM public.executie_proiecte e WHERE e.id = p_proiect FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Crearea șantierului: proiectul nu există' USING ERRCODE = 'P0002';
  END IF;
  IF v_leg IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.sites s WHERE s.id = v_leg AND s.proiect_id = p_proiect) THEN
      RETURN jsonb_build_object('site_id', v_leg, 'creat', false);
    END IF;
    RAISE EXCEPTION 'Crearea șantierului: proiectul are deja alt șantier legat' USING ERRCODE = 'P0001';
  END IF;
  v_site := nextval(pg_get_serial_sequence('public.sites', 'id'));
  UPDATE public.executie_proiecte SET site_id = v_site WHERE id = p_proiect;
  INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id) VALUES (v_site, v_nume, true, v_benef, p_proiect);
  SELECT count(*) INTO v_n FROM public.executie_proiecte e WHERE e.site_id = v_site;
  IF v_n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect AND e.site_id = v_site) THEN
    RAISE EXCEPTION 'Crearea șantierului: legătura cu proiectul nu e unică, % proiecte pe șantier; nimic scris', v_n USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('site_id', v_site, 'creat', true);
END $f$;
REVOKE ALL ON FUNCTION public.fn_sites_creeaza(text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sites_creeaza(text, bigint, text) TO authenticated;
COMMENT ON FUNCTION public.fn_sites_creeaza(text, bigint, text) IS 'Creează un șantier (nume, beneficiar, proiect) pentru apelant (auth.uid()): owner, sau santiere_creare + executie (editor / admin) pe un proiect permis la scriere. Cu proiect: legătura în ambele sensuri, fără proiectul automat, idempotent. 20261222a.';

-- ── postcondiții ──
DO $post$
DECLARE v_alt text;
BEGIN
  -- funcția: limbaj, DEFINER, VOLATILE, search_path fix, proprietar, tip întors, EXECUTE doar pentru authenticated (nimic pentru PUBLIC / anon / service_role)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') AND l.lanname = 'plpgsql' AND p.prosecdef
                    AND p.provolatile = 'v' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prorettype = 'jsonb'::regtype
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza') <> 1 THEN
    RAISE EXCEPTION '20261222a post: functia fn_sites_creeaza (limbaj / definer / search_path / owner / EXECUTE / o singura semnatura)';
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
   WHERE p.oid = 'public.fn_sites_creeaza(text, bigint, text)'::regprocedure
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p2.oid NOT IN ('auth.uid()'::regprocedure, 'public.fn_executie_proiect_permis(bigint, boolean)'::regprocedure);
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_sites_creeaza(text, bigint, text)'::regprocedure
                  AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M') THEN
    RAISE EXCEPTION '20261222a post: functia noua cheama in afara pornirii amprentate: %', coalesce(v_alt, 'EXECUTE dinamic');
  END IF;
  -- politicile lui sites: neschimbate (nicio politică nouă; amprenta „după” le compară integral cu baseline-ul)
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sites'::regclass AND polname = 'sites_insert_drept_creare') THEN
    RAISE EXCEPTION '20261222a post: politica din runda 1 nu trebuie sa existe';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare:' || txid_current() THEN
    RAISE EXCEPTION '20261222a: garda final invalida';
  END IF;
END $post$;

-- L15: amprenta DUPĂ schimbare (baseline + exact funcția nouă), timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261222a('dupa');
  RAISE NOTICE '20261222a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261222a(text), pg_temp.amp_calc_20261222a(), pg_temp.amp_baseline_20261222a();
