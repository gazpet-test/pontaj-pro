-- Version 20261222120100. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261222b_ctc_autorizatii_citire — autorizațiile SUDORILOR vizibile în CTC, doar citire, pentru cartea tehnică, FĂRĂ acces la modulul HR
-- (decizia owner-ului pe tichetul TKT-2026-0389, 13.11.2026).
--
-- Ce face (doar funcții noi; niciun tabel, nicio politică, niciun drept pe tabele / bucket-uri schimbat):
--   * fn_ctc_autorizatii_drept() — predicatul UNIC (L19, L08): apelantul logat (auth.uid()) e owner sau are modulul CTC
--     (user_module_access 'ctc' sau 'ctc.%', aceeași regulă ca intrarea în modulul CTC din interfață și ca 20261023a). Intern: fără EXECUTE
--     pentru clienți (îl cheamă doar cele două funcții de mai jos, ca proprietar).
--   * fn_ctc_autorizatii_sudori() — lista autorizațiilor de SUDOR (tipul cu categoria 'sudura'), neșterse, valabile ȘI expirate, cu DOAR
--     câmpurile profesionale: titularul (numele; la personal extern și firma), tipul, subcategoria, numărul, emitentul, datele, procedeul,
--     diametrul, materialul, starea (valabila / expirata / fara_data, după ziua din România), dacă a fost înlocuită, dacă are scan. NU întoarce
--     calea fișierului, observațiile, date de contact, CNP sau alte câmpuri din HR. Cont fără CTC = eroare 42501 (nu listă goală, L18).
--   * fn_ctc_autorizatie_fisier(id) — calea scanului, DOAR pentru o autorizație de sudor neștearsă, DOAR pentru apelantul cu CTC; altfel
--     același refuz generic (o autorizație de alt tip, inexistentă sau fără scan arată la fel: nimic de aflat despre alte fișiere). O
--     folosește edge fn ctc-autorizatie-fisier, cu JWT-ul utilizatorului (deci auth.uid() e utilizatorul), apoi semnează EXACT calea primită
--     (60 s) în bucket-ul autorizatii. Bucket-ul NU primește nicio politică nouă: CTC nu are acces general la el.
-- Ce NU face: nu acordă modulul hr; nu schimbă drepturile pe hr_autorizatii / bucket-ul autorizatii; nu atinge date.
-- Firmele de control nedistructiv (NDT): nu există în BD o structură dedicată pentru autorizațiile lor (vezi PR); nu sunt incluse.
--
-- L15: amprenta COMPLETĂ (corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/ctcAutorizatiiMigrare.test.js) a lanțului de identitate pe care se
--   sprijină predicatul (închiderea tranzitivă din auth.uid(); funcțiile noi citesc tabelele ca proprietar, deci politicile lor nu intră în
--   decizie), comparată cu BASELINE-ul din producție ÎNAINTE și DUPĂ (exact baseline-ul: migrarea nu schimbă nimic existent). Valorile le
--   scoate coordonatorul cu scripts/ctc_autorizatii_amprente.sql (READ ONLY); necompletat = refuz. Postcondiția: funcțiile noi cheamă doar
--   auth.uid() și predicatul nou.
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000. Fără lock pe tabele (doar CREATE FUNCTION).
-- Revenire: supabase/revenire/20261222b_ctc_autorizatii_citire_ROLLBACK.sql. Probe: scripts/pglite/test_ctc_autorizatii_local.mjs.
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222b_ctc_autorizatii_citire:' || txid_current() THEN
    RAISE EXCEPTION '20261222b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261222b: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261222b: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261222b: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261222b: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('fn_ctc_autorizatii_drept', 'fn_ctc_autorizatii_sudori', 'fn_ctc_autorizatie_fisier')) THEN
    RAISE EXCEPTION '20261222b: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite, cu tipurile acceptate (tabelele HR sunt create direct în producție: se verifică aici, nu se presupun)
  FOR r IN SELECT * FROM (VALUES
      ('hr_autorizatii', 'id', 'bigint|integer'), ('hr_autorizatii', 'tip_id', 'integer|bigint'), ('hr_autorizatii', 'employee_id', 'bigint|integer'),
      ('hr_autorizatii', 'extern_id', 'bigint|integer'), ('hr_autorizatii', 'numar_autorizatie', 'text|character varying'),
      ('hr_autorizatii', 'emitent', 'text|character varying'), ('hr_autorizatii', 'data_emitere', 'date'), ('hr_autorizatii', 'data_expirare', 'date'),
      ('hr_autorizatii', 'fara_expirare', 'boolean'), ('hr_autorizatii', 'procedeu_sudura', 'text|character varying'),
      ('hr_autorizatii', 'diametru_teava_mm', 'numeric|integer|double precision|real'), ('hr_autorizatii', 'calitate_material', 'text|character varying'),
      ('hr_autorizatii', 'subcategorie', 'text|character varying'), ('hr_autorizatii', 'fisier_path', 'text|character varying'),
      ('hr_autorizatii', 'deleted_at', 'timestamp with time zone|timestamp without time zone'), ('hr_autorizatii', 'inlocuita_de_id', 'bigint|integer'),
      ('hr_autorizatii_tipuri', 'id', 'integer|bigint'), ('hr_autorizatii_tipuri', 'denumire', 'text|character varying'),
      ('hr_autorizatii_tipuri', 'categorie', 'text|character varying'),
      ('employees', 'id', 'integer|bigint'), ('employees', 'name', 'text|character varying'),
      ('hr_personal_extern', 'id', 'bigint|integer'), ('hr_personal_extern', 'nume', 'text|character varying'),
      ('hr_personal_extern', 'firma', 'text|character varying'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text|character varying')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261222b: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION '20261222b: auth.uid() lipseste'; END IF;
END $pre$;

-- ── L15: amprenta COMPLETĂ a lanțului de identitate, verificată ÎNAINTE și DUPĂ (tiparul 20261221a) ──
-- >>> BASELINE 20261222b — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/ctc_autorizatii_amprente.sql, copiată
--     ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat (DE_COMPLETAT) = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261222b() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('DE_COMPLETAT', 'DE_COMPLETAT')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261222b
CREATE FUNCTION pg_temp.amp_calc_20261222b() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH RECURSIVE
amp_tabele(oid) AS (SELECT c.oid FROM pg_class c WHERE false),
-- >>> INCHIDERE_L15 20261222b
-- Pornirea = ce cheamă DIRECT predicatul nou fn_ctc_autorizatii_drept: auth.uid() (postcondiția verifică că funcțiile noi nu cheamă altceva
--   în afara lor). Închiderea se CALCULEAZĂ aici, din catalog, nu se ia din BASELINE: orice funcție (în afara pg_catalog / information_schema)
--   al cărei nume apare ca apel „nume(” în corpul unei funcții sql / plpgsql din lanț, numele neobișnuite prin căutare de text, plus
--   dependențele din pg_depend. Fără limită de adâncime: UNION oprește ciclurile. BASELINE-ul trebuie să aibă EXACT această mulțime.
amp_pornire(oid) AS (VALUES (to_regprocedure('auth.uid()')::oid)),
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
-- <<< INCHIDERE_L15 20261222b
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
-- „înainte” și „după”: exact baseline-ul (migrarea nu schimbă nicio funcție / tabel existent). Amprenta se calculează O DATĂ pe apel.
CREATE FUNCTION pg_temp.amp_verifica_20261222b(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text; v_exec text;
BEGIN
  CREATE TEMP TABLE amp_rez_20261222b ON COMMIT DROP AS SELECT * FROM pg_temp.amp_calc_20261222b();
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222b())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222b() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261222b: baseline L15 necompletat sau invalid (scripts/ctc_autorizatii_amprente.sql)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222b() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261222b: baseline L15 cu etichete duble';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261222b() b WHERE b.eticheta = 'functie auth.uid()') THEN
    RAISE EXCEPTION '20261222b: baseline L15 fara functiile de pornire ale predicatului';
  END IF;
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM amp_rez_20261222b c FULL JOIN pg_temp.amp_baseline_20261222b() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261222b: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  IF EXISTS (SELECT 1 FROM amp_rez_20261222b c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261222b: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text || ' (' || l.lanname || ')', ', ' ORDER BY p.oid::regprocedure::text COLLATE "C")
    INTO v_exec
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(substr(c.eticheta, 9))::oid FROM amp_rez_20261222b c WHERE c.eticheta LIKE 'functie %')
     AND (l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')
          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M'));
  IF v_exec IS NOT NULL THEN
    RAISE EXCEPTION '20261222b: lantul de acces are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;
  END IF;
  DROP TABLE amp_rez_20261222b;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261222b('inainte'); END $l15_inainte$;

-- ── cine vede autorizațiile pentru cartea tehnică: O SINGURĂ definiție (L19), internă ──
CREATE FUNCTION public.fn_ctc_autorizatii_drept() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND (u.module = 'ctc' OR u.module LIKE 'ctc.%')))
$f$;
REVOKE ALL ON FUNCTION public.fn_ctc_autorizatii_drept() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_ctc_autorizatii_drept() IS 'CTC (intern): apelantul (auth.uid()) e owner sau are modulul ctc / ctc.*. Folosit de fn_ctc_autorizatii_sudori și fn_ctc_autorizatie_fisier. 20261222b.';

-- ── lista autorizațiilor de sudor: DOAR câmpurile profesionale; starea după ziua din România (L17) ──
CREATE FUNCTION public.fn_ctc_autorizatii_sudori()
RETURNS TABLE (id bigint, titular text, extern boolean, firma text, tip text, subcategorie text, numar_autorizatie text, emitent text,
               data_emitere date, data_expirare date, fara_expirare boolean, procedeu_sudura text, diametru_teava_mm numeric,
               calitate_material text, stare text, inlocuita boolean, are_scan boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
BEGIN
  IF NOT public.fn_ctc_autorizatii_drept() THEN
    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id::bigint, coalesce(e.name, x.nume)::text, (a.extern_id IS NOT NULL),
         (CASE WHEN a.extern_id IS NOT NULL THEN x.firma END)::text, t.denumire::text, a.subcategorie::text,
         a.numar_autorizatie::text, a.emitent::text, a.data_emitere, a.data_expirare, coalesce(a.fara_expirare, false),
         a.procedeu_sudura::text, a.diametru_teava_mm::numeric, a.calitate_material::text,
         (CASE WHEN coalesce(a.fara_expirare, false) THEN 'valabila'
               WHEN a.data_expirare IS NULL THEN 'fara_data'
               WHEN a.data_expirare >= v_azi THEN 'valabila'
               ELSE 'expirata' END)::text,
         (a.inlocuita_de_id IS NOT NULL), (a.fisier_path IS NOT NULL AND a.fisier_path ~ '[^[:space:]]')
    FROM public.hr_autorizatii a
    JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
    LEFT JOIN public.employees e ON e.id = a.employee_id
    LEFT JOIN public.hr_personal_extern x ON x.id = a.extern_id
   WHERE a.deleted_at IS NULL AND t.categorie = 'sudura';
END $f$;
REVOKE ALL ON FUNCTION public.fn_ctc_autorizatii_sudori() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_sudori() TO authenticated;
COMMENT ON FUNCTION public.fn_ctc_autorizatii_sudori() IS 'CTC: autorizațiile de sudor (tip cu categoria sudura), neșterse, doar câmpurile profesionale, pentru cartea tehnică. Cont fără CTC = 42501. 20261222b.';

-- ── calea scanului: doar o autorizație de sudor neștearsă, doar pentru CTC; refuz generic altfel (fără oracol pe alte fișiere) ──
CREATE FUNCTION public.fn_ctc_autorizatie_fisier(p_id bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_cale text;
BEGIN
  IF NOT public.fn_ctc_autorizatii_drept() THEN
    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';
  END IF;
  SELECT a.fisier_path INTO v_cale
    FROM public.hr_autorizatii a JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
   WHERE a.id = p_id AND a.deleted_at IS NULL AND t.categorie = 'sudura';
  IF v_cale IS NULL OR v_cale !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'ctc: autorizație de sudor inexistentă sau fără scan' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_cale;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ctc_autorizatie_fisier(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatie_fisier(bigint) TO authenticated;
COMMENT ON FUNCTION public.fn_ctc_autorizatie_fisier(bigint) IS 'CTC: calea scanului unei autorizații de sudor, pentru apelantul cu CTC (o semnează edge fn ctc-autorizatie-fisier, 60 s). Altfel 42501 / P0002 generic. 20261222b.';

-- ── postcondiții ──
DO $post$
DECLARE r record; v_alt text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ctc_autorizatii_drept()', 'sql', false),
      ('public.fn_ctc_autorizatii_sudori()', 'plpgsql', true),
      ('public.fn_ctc_autorizatie_fisier(bigint)', 'plpgsql', true)
    ) v(fn, limbaj, exec_auth) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef AND p.provolatile = 's'
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = r.exec_auth
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '20261222b post: functia % (limbaj / definer / volatil / search_path / owner / EXECUTE)', r.fn;
    END IF;
  END LOOP;
  -- funcțiile noi cheamă (aceeași regulă de nume ca închiderea) DOAR auth.uid() și predicatul nou; nimic dinamic
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.oid IN ('public.fn_ctc_autorizatii_drept()'::regprocedure, 'public.fn_ctc_autorizatii_sudori()'::regprocedure,
                   'public.fn_ctc_autorizatie_fisier(bigint)'::regprocedure)
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p2.oid NOT IN ('auth.uid()'::regprocedure, 'public.fn_ctc_autorizatii_drept()'::regprocedure);
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_ctc_autorizatii_drept()'::regprocedure, 'public.fn_ctc_autorizatii_sudori()'::regprocedure,
                  'public.fn_ctc_autorizatie_fisier(bigint)'::regprocedure) AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M') THEN
    RAISE EXCEPTION '20261222b post: functiile noi cheama in afara pornirii amprentate: %', coalesce(v_alt, 'EXECUTE dinamic');
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222b_ctc_autorizatii_citire:' || txid_current() THEN
    RAISE EXCEPTION '20261222b: garda final invalida';
  END IF;
END $post$;

DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261222b('dupa');
  RAISE NOTICE '20261222b: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261222b(text), pg_temp.amp_calc_20261222b(), pg_temp.amp_baseline_20261222b();
