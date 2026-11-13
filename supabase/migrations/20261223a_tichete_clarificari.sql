-- Version 20261223120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261223a_tichete_clarificari — clarificări automate pe tichetele din butonul de raportare, maximum 2 runde (decizia owner-ului, 13.11.2026).
--
-- Tichetele din butonul de raportare (departament 'it', subcategorie eroare_erp / cerere_functie, metadata.sursa bug_report / feature_request)
-- care NU sunt clare primesc, pe tichet, întrebări de clarificare scrise de rutina zilnică (sesiune de asistent, prin conectorul bazei).
-- Rutina dă DOAR întrebările; baza compune mesajul din șablonul fix, îl semnează „Echipa ERP”, îl scrie ca un comentariu FĂRĂ autor
-- (niciun cont nu apare că „a discutat”), notifică autorul tichetului în platformă și ține evidența în metadata.clarificari_erp — toate
-- în aceeași tranzacție, sub lock pe rândul tichetului. Tichetul NU se închide niciodată de aici (statusul nu se atinge).
--
-- Ce creează (doar funcții; niciun tabel, nicio coloană, nicio politică, niciun trigger, nicio dată):
--   * fn_tichet_clarificare_trimite(tichet, runda, intrebari[])  — runda 1 / 2: comentariu + notificare + metadate; idempotentă pe
--     (tichet, versiunea protocolului = 1, runda): al doilea apel = „deja_trimis”, fără al doilea comentariu / a doua notificare;
--   * fn_tichet_clarificare_incheie(tichet, motiv)               — încheierea, la fel de atomică și deduplicată: 'tacere' / 'neclar' =
--     mesajul de încheiere + notificare; 'clarificat' = doar marcajul (fără mesaj), ca tichetul clar să nu mai fie reevaluat. Funcție
--     SEPARATĂ (nu un tip al primei): alte intrări (fără întrebări), alte condiții (pragul de tăcere, runda 2 cu răspuns), alt rezultat;
--     un apel greșit nu poate trimite întrebări în locul încheierii sau invers;
--   * fn_tichet_clarificare_stare()                              — DOAR citire: starea fiecărui tichet eligibil + acțiunea rezultată;
--   * interne: fn_tichet_clarificare_stare_tichet (O SINGURĂ definiție a stării, L19, cu pragul de tăcere = 3 zile lucrătoare într-un
--     singur loc), fn_tichet_clarificare_zile_lucratoare (Europe/Bucharest, fără weekend), fn_tichet_clarificare_intrebari_motiv
--     (validarea textului: refuz cu motiv, nu trunchiere), fn_tichet_clarificare_apelant_ok (verificarea apelantului, în cod).
-- Cine le poate chema: NIMENI în afara proprietarului postgres (REVOKE de la PUBLIC / anon / authenticated / service_role, niciun GRANT) ȘI,
--   verificat în cod la fiecare apel, conexiunea rutinei: session_user = 'postgres' fără SET ROLE (current_setting('role') = 'none') —
--   rolul cu care rulează conectorul bazei (MCP execute_sql) și psql-ul coordonatorului. NU service_role: rutina nu are cheia de serviciu,
--   iar cu ea orice funcție edge ar putea scrie mesaje „Echipa ERP”. Un apel prin PostgREST are session_user = authenticator și rolul
--   setat (anon / authenticated / service_role) => refuz, chiar dacă cineva ar acorda greșit EXECUTE. auth.uid() nu se folosește (e NULL
--   la rutină, L08: identitatea nu vine din parametri sau din GUC-uri custom).
--
-- L15: amprenta COMPLETĂ (corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/ticheteClarificariMigrare.test.js) pe tabelele în care scriu
--   funcțiile (tichete, tichete_comentarii, notifications: drepturi, RLS + FORCE, TOATE politicile, TOATE triggerele) și pe funcțiile lor,
--   plus ÎNCHIDEREA TRANZITIVĂ calculată în migrare (blocul INCHIDERE_L15, identic cu scriptul): pornirea = funcțiile triggerelor care se
--   declanșează la scrierile noastre (UPDATE pe tichete, INSERT pe tichete_comentarii și notifications), apoi orice funcție apelată
--   „nume(” din corpurile lanțului, dependențele din pg_depend și triggerele tabelelor în care lanțul scrie (INSERT INTO / UPDATE /
--   DELETE FROM, pe evenimentul respectiv), fără limită de adâncime. Comparată cu BASELINE-ul din producție ÎNAINTE și DUPĂ: o
--   diferență (ex. un trigger nou apărut între citire și aplicare) = refuz. Pe LANȚ (ce rulează la scrierile noastre): EXECUTE
--   dinamic / limbaj neanalizabil / DEFINER fără search_path = refuz. Funcțiile triggerelor care NU se declanșează la scrierile noastre
--   (ex. cel de la INSERT în tichete) sunt doar amprentate. Valorile le scoate coordonatorul cu scripts/tichete_clarificari_amprente.sql
--   (tranzacție READ ONLY) în blocul marcat; necompletat = refuz.
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$).
--   Lock (L06): notifications, tichete, tichete_comentarii (în ordinea asta) SHARE UPDATE EXCLUSIVE, NOWAIT, reîncercat la 50 ms până la
--   1 s de la BEGIN (peste = 55P03, nimic schimbat), după verificările de catalog: NU oprește citirile și scrierile de rânduri, oprește
--   doar CREATE TRIGGER / politici / ALTER TABLE concurente până la COMMIT. Sub lock: funcțiile noi + postcondițiile + amprenta „după”.
-- Revenire: supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql (refuză dacă există tichete cu clarificări; în loc: oprirea
--   pasului din promptul rutinei, docs/TICHETE_CLARIFICARI.md).
-- Probe: scripts/pglite/test_tichete_clarificari_local.mjs (local, PGlite); scripts/tichete_clarificari_concurenta.mjs (clonă, 2 sesiuni).
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari:' || txid_current() THEN
    RAISE EXCEPTION '20261223a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261223a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261223a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- plafonul total = ceasul de tranzacție PostgreSQL 17, pus de runner înainte de BEGIN (sursa 'session'), citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261223a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261223a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie', 'fn_tichet_clarificare_stare',
                    'fn_tichet_clarificare_stare_tichet', 'fn_tichet_clarificare_zile_lucratoare', 'fn_tichet_clarificare_intrebari_motiv',
                    'fn_tichet_clarificare_apelant_ok')) THEN
    RAISE EXCEPTION '20261223a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise, cu tipurile acceptate
  FOR r IN SELECT * FROM (VALUES
      ('tichete', 'id', 'bigint'), ('tichete', 'numar_tichet', 'text|character varying'), ('tichete', 'departament', 'text|character varying'),
      ('tichete', 'subcategorie', 'text|character varying'), ('tichete', 'status', 'text|character varying'), ('tichete', 'deschis_de', 'uuid'),
      ('tichete', 'metadata', 'jsonb'), ('tichete', 'created_at', 'timestamp with time zone'),
      ('tichete_comentarii', 'id', 'bigint'), ('tichete_comentarii', 'tichet_id', 'bigint'), ('tichete_comentarii', 'autor', 'uuid'),
      ('tichete_comentarii', 'text', 'text'), ('tichete_comentarii', 'created_at', 'timestamp with time zone'),
      ('notifications', 'profile_id', 'uuid'), ('notifications', 'type', 'text|character varying'), ('notifications', 'modul', 'text|character varying'),
      ('notifications', 'title', 'text|character varying'), ('notifications', 'message', 'text|character varying'),
      ('notifications', 'link_to', 'text|character varying'), ('profiles', 'id', 'uuid')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261223a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- comentariul automat are autor NULL (cheia străină spre auth.users e ON DELETE SET NULL, deci coloana acceptă NULL); data o pune baza
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tichete_comentarii'::regclass AND attname = 'autor' AND attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                     WHERE d.adrelid = 'public.tichete_comentarii'::regclass AND a.attname = 'created_at') THEN
    RAISE EXCEPTION '20261223a: tichete_comentarii.autor e NOT NULL sau created_at fara valoare implicita';
  END IF;
  -- funcțiile (proprietar postgres) scriu ca proprietar: RLS nu trebuie să li se aplice (fără FORCE pe tabele proprii, sau BYPASSRLS)
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ('public.tichete'::regclass, 'public.tichete_comentarii'::regclass, 'public.notifications'::regclass)
               AND NOT (pg_get_userbyid(c.relowner) = 'postgres' AND NOT c.relforcerowsecurity)
               AND NOT coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres'), false)) THEN
    RAISE EXCEPTION '20261223a: tichete / tichete_comentarii / notifications: RLS s-ar aplica proprietarului (FORCE sau alt proprietar)';
  END IF;
  -- protocolul pornește de la zero: nicio evidență clarificari_erp existentă
  IF EXISTS (SELECT 1 FROM public.tichete x WHERE x.metadata -> 'clarificari_erp' IS NOT NULL) THEN
    RAISE EXCEPTION '20261223a: exista deja metadata.clarificari_erp pe tichete (date neasteptate)';
  END IF;
END $pre$;

-- ── L15: amprenta COMPLETĂ a tabelelor în care scriem și a funcțiilor care rulează la scrierile noastre, ÎNAINTE și DUPĂ ──
-- >>> BASELINE 20261223a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/tichete_clarificari_amprente.sql,
--     copiată ÎNTREAGĂ, în ordinea afișată; coloanele „sursa”, „atentie” și „detaliu” de acolo intră în review. Necompletat = refuz.
CREATE FUNCTION pg_temp.amp_baseline_20261223a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('DE_COMPLETAT', 'DE_COMPLETAT')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261223a
CREATE FUNCTION pg_temp.amp_calc_20261223a() RETURNS TABLE (eticheta text, amprenta text, detaliu text, in_lant boolean)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH RECURSIVE
amp_tabele(oid) AS (VALUES ('public.notifications'::regclass::oid), ('public.tichete'::regclass::oid), ('public.tichete_comentarii'::regclass::oid)),
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
SELECT c.eticheta, c.amprenta, c.detaliu,
       c.eticheta LIKE 'functie %' AND to_regprocedure(substr(c.eticheta, 9))::oid IN (SELECT f.oid FROM amp_functii_explicite f) AS in_lant
  FROM amp_calc c
$amp$;
-- „înainte” și „după”: exact baseline-ul (migrarea nu schimbă nicio funcție / tabel existent). Amprenta se calculează O DATĂ pe apel
-- (tabel temporar), apoi se compară cu baseline-ul și se verifică lanțul.
CREATE FUNCTION pg_temp.amp_verifica_20261223a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text; v_exec text; v_lipsa text;
BEGIN
  CREATE TEMP TABLE amp_rez_20261223a ON COMMIT DROP AS SELECT * FROM pg_temp.amp_calc_20261223a();
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261223a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261223a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261223a: baseline L15 necompletat sau invalid (scripts/tichete_clarificari_amprente.sql)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261223a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261223a: baseline L15 cu etichete duble';
  END IF;
  -- cele trei tabele, cu toate cele șase etichete, trebuie să fie în baseline (altfel scrierile ar ajunge în tabele neamprentate)
  SELECT string_agg(e.et, ', ' ORDER BY e.et) INTO v_lipsa
    FROM (SELECT 'tabel ' || t.n || ' | ' || k.k AS et
            FROM unnest(ARRAY['notifications', 'tichete', 'tichete_comentarii']) t(n)
            CROSS JOIN unnest(ARRAY['acl', 'acl coloane', 'rls', 'secvente', 'politici', 'triggere']) k(k)) e
   WHERE NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261223a() b WHERE b.eticheta = e.et);
  IF v_lipsa IS NOT NULL THEN
    RAISE EXCEPTION '20261223a: baseline L15 fara etichetele tabelelor: %', v_lipsa;
  END IF;
  -- mulțimea calculată = EXACT baseline-ul: o funcție / un tabel lipsă din baseline sau în plus, ori o amprentă diferită = refuz (FULL JOIN)
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM amp_rez_20261223a c FULL JOIN pg_temp.amp_baseline_20261223a() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261223a: starea tabelelor / triggerelor (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline, pe LANȚ (ce rulează la scrierile noastre): DEFINER fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM amp_rez_20261223a c
              WHERE c.in_lant AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261223a: o functie SECURITY DEFINER din lantul scrierilor nu are search_path propriu';
  END IF;
  -- independent de baseline, pe LANȚ: ce nu se poate amprenta static = REFUZ: EXECUTE în corpul unei funcții sql / plpgsql (SQL dinamic:
  -- ce cheamă / ce tabele scrie nu se vede în text; șirul 'EXECUTE' ca argument nu contează) sau un limbaj al cărui corp nu se poate citi
  -- (în afara sql / plpgsql; internal / c sunt frunze)
  SELECT string_agg(p.oid::regprocedure::text || ' (' || l.lanname || ')', ', ' ORDER BY p.oid::regprocedure::text COLLATE "C")
    INTO v_exec
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(substr(c.eticheta, 9))::oid FROM amp_rez_20261223a c WHERE c.in_lant)
     AND (l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')
          OR (l.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M'));
  IF v_exec IS NOT NULL THEN
    RAISE EXCEPTION '20261223a: lantul scrierilor are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;
  END IF;
  DROP TABLE amp_rez_20261223a;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261223a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog: cele trei tabele, în ordine fixă, SHARE UPDATE EXCLUSIVE, NOWAIT, ≤ 1 s ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.notifications, public.tichete, public.tichete_comentarii IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261223a: BUGET_LOCK: notifications / tichete / tichete_comentarii ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261223a: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── zilele lucrătoare dintre două momente (Europe/Bucharest, fără weekend): zilele d cu ziua(p_de) < d <= ziua(p_la), luni–vineri ──
-- (vineri 09:00 -> luni = 1, marți = 2, miercuri = 3; sâmbătă -> luni = 1; aceeași zi = 0). Sărbătorile legale NU se scad.
CREATE FUNCTION public.fn_tichet_clarificare_zile_lucratoare(p_de timestamptz, p_la timestamptz) RETURNS integer
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_de IS NULL OR p_la IS NULL THEN NULL ELSE (
    SELECT count(*)::integer
      FROM generate_series(((p_de AT TIME ZONE 'Europe/Bucharest')::date + 1)::timestamp, ((p_la AT TIME ZONE 'Europe/Bucharest')::date)::timestamp,
                           interval '1 day') AS zile(zi)
     WHERE extract(isodow FROM zile.zi) < 6) END
$f$;

-- ── validarea întrebărilor: NULL = valide; altfel motivul refuzului (fără trunchiere, fără corectare) ──
-- 1–3 întrebări, fiecare cu text, cel mult 300 de caractere, fără caractere de control (deci fără linii noi / goale) sau invizibile
-- (spațiu de lățime zero, direcție de text), fără URL-uri, fără șiruri de 9+ cifre (și cu spații / puncte / cratime între ele: telefon,
-- CNP, cont), fără adrese de e-mail.
CREATE FUNCTION public.fn_tichet_clarificare_intrebari_motiv(p_intrebari text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE
    WHEN p_intrebari IS NULL OR array_ndims(p_intrebari) IS DISTINCT FROM 1 OR cardinality(p_intrebari) NOT BETWEEN 1 AND 3 THEN 'numar_intrebari'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE q.t IS NULL OR q.t !~ '[^[:space:]]') THEN 'intrebare_goala'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE char_length(q.t) > 300) THEN 'intrebare_prea_lunga'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t)
                  WHERE q.t ~ '[[:cntrl:]]'
                     OR q.t ~ ('[' || chr(8203) || '-' || chr(8207) || chr(8232) || '-' || chr(8238) || chr(8288) || '-' || chr(8292) || chr(65279) || ']')) THEN 'caractere_control'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE q.t ~* '(https?|ftps?|file)[[:space:]]*:|www[[:space:]]*\.') THEN 'url'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE regexp_replace(q.t, '[[:space:].-]', '', 'g') ~ '[0-9]{9,}') THEN 'sir_cifre'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE q.t ~ '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}') THEN 'adresa_email'
  END
$f$;

-- ── apelantul: conexiunea rutinei (conectorul bazei) / psql-ul coordonatorului = session_user postgres, fără SET ROLE ──
-- Verificarea în COD (pe lângă lipsa oricărui GRANT): prin PostgREST session_user = authenticator și rolul e setat (anon / authenticated /
-- service_role) => fals, chiar dacă cineva ar acorda greșit EXECUTE sau ar chema funcțiile din altă funcție DEFINER expusă. session_user
-- și rolul nu pot fi schimbate de un rol fără drept asupra lor (nu sunt GUC-uri custom, L08).
CREATE FUNCTION public.fn_tichet_clarificare_apelant_ok() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT session_user = 'postgres' AND current_setting('role') = 'none'
$f$;

-- ── starea clarificărilor pentru UN tichet: O SINGURĂ definiție (L19), citită de lista rutinei și de cele două scrieri (sub lock) ──
CREATE FUNCTION public.fn_tichet_clarificare_stare_tichet(p_tichet_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
-- Nu scrie nimic. Pragul de tăcere și lista albă de eligibilitate stau DOAR aici.
-- Evidența (metadata.clarificari_erp, versiunea 1): runda 0..2, faza (asteapta_autor / incheiat / clarificat), comentarii = id-urile
-- comentariilor automate (rundele trimise + mesajul de încheiere), runde.{1,2} = comentariul / notificarea / momentul, incheiere = motivul /
-- comentariul / notificarea / momentul. Se verifică față de comentariile reale: un id listat fără comentariul automat (autor NULL, pe
-- acest tichet) sau un comentariu automat nelistat (ex. metadatele șterse) = „incoerent” (nimic nu se mai trimite până decide owner-ul).
DECLARE
  c_prag_tacere constant integer := 3;  -- zile lucrătoare de tăcere după un mesaj automat => escaladare (SINGURUL loc)
  t record;
  m jsonb;
  v_motiv text;
  v_inc text;
  v_runda integer := 0;
  v_faza text;
  v_ids bigint[] := '{}';
  v_ult_id bigint;
  v_ult_la timestamptz;
  v_resp_la timestamptz;
  v_marcat_la timestamptz;
  v_dupa boolean := false;
  v_zile integer;
  v_act text;
BEGIN
  SELECT x.id, x.numar_tichet, x.status, x.departament, x.subcategorie, x.deschis_de, x.metadata, x.created_at
    INTO t FROM public.tichete x WHERE x.id = p_tichet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('tichet_id', p_tichet_id, 'eligibil', false, 'motiv', 'tichet_inexistent');
  END IF;
  -- eligibilitatea, pe listă albă (L18): tichetele din butonul de raportare, încă deschise, cu autorul existent
  v_motiv := CASE
    WHEN t.departament IS DISTINCT FROM 'it' THEN 'departament'
    WHEN (t.subcategorie IN ('eroare_erp', 'cerere_functie')) IS NOT TRUE THEN 'subcategorie'
    WHEN jsonb_typeof(t.metadata) IS DISTINCT FROM 'object' THEN 'sursa'
    WHEN ((t.metadata ->> 'sursa') IN ('bug_report', 'feature_request')) IS NOT TRUE THEN 'sursa'
    WHEN (t.status IN ('deschis', 'atribuit', 'in_analiza', 'in_lucru')) IS NOT TRUE THEN 'status'
    WHEN t.deschis_de IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.deschis_de) THEN 'autor'
  END;
  IF v_motiv IS NOT NULL THEN
    RETURN jsonb_build_object('tichet_id', t.id, 'numar_tichet', t.numar_tichet, 'eligibil', false, 'motiv', v_motiv);
  END IF;
  -- evidența: forma exactă, altfel „incoerent”
  m := t.metadata -> 'clarificari_erp';
  IF m IS NOT NULL THEN
    IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR jsonb_typeof(m -> 'comentarii') IS DISTINCT FROM 'array' THEN
      v_inc := 'metadate_invalide';
    ELSIF (m ->> 'v') IS DISTINCT FROM '1' OR coalesce(m ->> 'runda', '') !~ '^[0-2]$'
          OR ((m ->> 'faza') IN ('asteapta_autor', 'incheiat', 'clarificat')) IS NOT TRUE
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'comentarii') AS el(val)
                      WHERE jsonb_typeof(el.val) IS DISTINCT FROM 'number' OR el.val::text !~ '^[1-9][0-9]{0,17}$') THEN
      v_inc := 'metadate_invalide';
    ELSE
      v_runda := (m ->> 'runda')::integer;
      v_faza := m ->> 'faza';
      SELECT coalesce(array_agg(el.val::text::bigint ORDER BY el.ord), '{}') INTO v_ids
        FROM jsonb_array_elements(m -> 'comentarii') WITH ORDINALITY AS el(val, ord);
      -- runda 0 doar „clarificat” (clar de la început); comentariile automate = rundele trimise + mesajul de încheiere, fără dubluri
      IF (v_runda = 0 AND v_faza IS DISTINCT FROM 'clarificat')
         OR cardinality(v_ids) <> v_runda + (CASE WHEN v_faza = 'incheiat' THEN 1 ELSE 0 END)
         OR cardinality(v_ids) <> (SELECT count(DISTINCT u.id) FROM unnest(v_ids) AS u(id)) THEN
        v_inc := 'metadate_invalide';
      ELSIF v_faza IN ('incheiat', 'clarificat') THEN
        BEGIN
          v_marcat_la := (m -> 'incheiere' ->> 'la')::timestamptz;
        EXCEPTION WHEN others THEN
          v_marcat_la := NULL;
        END;
        IF v_marcat_la IS NULL THEN v_inc := 'metadate_invalide'; END IF;
      END IF;
    END IF;
  END IF;
  -- evidența față de comentariile reale
  IF v_inc IS NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(v_ids) AS u(id)
                WHERE NOT EXISTS (SELECT 1 FROM public.tichete_comentarii c WHERE c.id = u.id AND c.tichet_id = t.id AND c.autor IS NULL)) THEN
      v_inc := 'comentariu_automat_lipsa';
    ELSIF EXISTS (SELECT 1 FROM public.tichete_comentarii c
                   WHERE c.tichet_id = t.id AND c.autor IS NULL AND NOT (c.id = ANY (v_ids))
                     AND (c.text LIKE 'Clarificare _/2' || chr(10) || '%' OR c.text LIKE 'Clarificările automate s-au încheiat.%')) THEN
      v_inc := 'comentariu_automat_neinregistrat';
    END IF;
  END IF;
  IF v_inc IS NOT NULL THEN
    RETURN jsonb_build_object('tichet_id', t.id, 'numar_tichet', t.numar_tichet, 'status', t.status, 'subcategorie', t.subcategorie,
      'creat_la', t.created_at, 'eligibil', true, 'actiune', 'incoerent', 'detaliu', v_inc, 'runda', v_runda, 'faza', v_faza,
      'raspuns_autor', false, 'raspuns_dupa_incheiere', false, 'prag_tacere', c_prag_tacere);
  END IF;
  -- ultimul mesaj automat, în ordinea stabilă (created_at, id); răspunsul = un comentariu al AUTORULUI tichetului (deschis_de) după el
  -- (comentariile altor conturi sunt context, nu răspuns)
  IF cardinality(v_ids) > 0 THEN
    SELECT c.id, c.created_at INTO v_ult_id, v_ult_la FROM public.tichete_comentarii c
     WHERE c.id = ANY (v_ids) ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
    SELECT max(c.created_at) INTO v_resp_la FROM public.tichete_comentarii c
     WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND (c.created_at, c.id) > (v_ult_la, v_ult_id);
    v_zile := public.fn_tichet_clarificare_zile_lucratoare(v_ult_la, now());
  END IF;
  -- după încheiere: „incheiat” = un răspuns după mesajul de încheiere (ultimul automat); „clarificat” = un comentariu al autorului după marcaj
  IF v_faza = 'incheiat' THEN
    v_dupa := v_resp_la IS NOT NULL;
  ELSIF v_faza = 'clarificat' THEN
    v_dupa := EXISTS (SELECT 1 FROM public.tichete_comentarii c WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND c.created_at > v_marcat_la);
  END IF;
  v_act := CASE
    WHEN v_faza IS NULL THEN 'de_evaluat_initial'
    WHEN v_faza IN ('incheiat', 'clarificat') THEN 'incheiat'
    WHEN v_resp_la IS NOT NULL THEN 'de_evaluat_raspuns'
    WHEN v_zile >= c_prag_tacere THEN 'de_escaladat_tacere'
    ELSE 'asteapta_autor'
  END;
  RETURN jsonb_build_object('tichet_id', t.id, 'numar_tichet', t.numar_tichet, 'status', t.status, 'subcategorie', t.subcategorie,
    'creat_la', t.created_at, 'eligibil', true, 'actiune', v_act, 'runda', v_runda, 'faza', v_faza,
    'ultim_automat_id', v_ult_id, 'ultim_automat_la', v_ult_la, 'raspuns_autor', v_resp_la IS NOT NULL, 'ultim_raspuns_autor_la', v_resp_la,
    'zile_lucratoare', v_zile, 'prag_tacere', c_prag_tacere, 'raspuns_dupa_incheiere', v_dupa);
END $f$;

-- ── runda 1 / 2: comentariu automat + notificare + evidență, într-o tranzacție, idempotent pe (tichet, versiune 1, rundă) ──
CREATE FUNCTION public.fn_tichet_clarificare_trimite(p_tichet_id bigint, p_runda integer, p_intrebari text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
-- Ordinea lock-urilor (L06): rândul tichetului (FOR NO KEY UPDATE: serializează două apeluri pentru același tichet, nu blochează un
--   comentariu nou al unui om, care ia doar KEY SHARE) -> comentariul nou (cheia străină spre tichet: rândul e deja al nostru) -> notificarea
--   (cheia străină spre profiles: KEY SHARE pe profilul autorului) -> metadatele aceluiași rând. Triggerele acestor scrieri: amprenta L15.
-- Rezultat explicit, fără excepții pentru cazurile de business: trimis / deja_trimis / refuz + motiv (+ detaliu).
DECLARE
  t record;
  s jsonb;
  m jsonb;
  v_motiv text;
  v_txt text;
  v_q text;
  v_i integer := 0;
  v_com public.tichete_comentarii.id%TYPE;
  v_not public.notifications.id%TYPE;
  v_acum timestamptz := now();
  v_n integer;
BEGIN
  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'apelant_nepermis', 'tichet_id', p_tichet_id);
  END IF;
  IF p_runda IS NULL OR p_runda NOT IN (1, 2) THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'runda_invalida', 'tichet_id', p_tichet_id, 'runda', p_runda);
  END IF;
  SELECT x.id, x.numar_tichet, x.deschis_de, x.metadata INTO t FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'tichet_inexistent', 'tichet_id', p_tichet_id);
  END IF;
  -- revenirea concurentă: după lock, protocolul trebuie să fie încă instalat (altfel nimic nu se scrie)
  IF to_regprocedure('public.fn_tichet_clarificare_trimite(bigint,integer,text[])') IS NULL THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'protocol_retras', 'tichet_id', p_tichet_id);
  END IF;
  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);
  IF (s ->> 'eligibil')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neeligibil', 'detaliu', s ->> 'motiv', 'tichet_id', p_tichet_id);
  END IF;
  IF s ->> 'actiune' = 'incoerent' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'stare_incoerenta', 'detaliu', s ->> 'detaliu', 'tichet_id', p_tichet_id);
  END IF;
  -- deduplicarea: runda cerută e deja trimisă (oricare ar fi întrebările de acum)
  IF p_runda <= (s ->> 'runda')::integer THEN
    m := t.metadata -> 'clarificari_erp';
    RETURN jsonb_build_object('rezultat', 'deja_trimis', 'tichet_id', p_tichet_id, 'runda', p_runda,
      'comentariu_id', m -> 'runde' -> (p_runda::text) -> 'comentariu_id', 'notificare_id', m -> 'runde' -> (p_runda::text) -> 'notificare_id');
  END IF;
  IF s ->> 'faza' IN ('incheiat', 'clarificat') THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'clarificari_incheiate', 'tichet_id', p_tichet_id);
  END IF;
  IF p_runda <> (s ->> 'runda')::integer + 1 THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'runda_nu_urmeaza', 'tichet_id', p_tichet_id, 'runda_curenta', (s ->> 'runda')::integer);
  END IF;
  -- runda 2 doar după un răspuns al autorului la runda 1 (tăcerea se escaladează, nu consumă runda 2)
  IF p_runda = 2 AND (s ->> 'raspuns_autor')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'fara_raspuns_autor', 'tichet_id', p_tichet_id);
  END IF;
  v_motiv := public.fn_tichet_clarificare_intrebari_motiv(p_intrebari);
  IF v_motiv IS NOT NULL THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'intrebari_invalide', 'detaliu', v_motiv, 'tichet_id', p_tichet_id);
  END IF;
  -- textul: DOAR șablonul fix + întrebările numerotate; semnătura „Echipa ERP”
  v_txt := 'Clarificare ' || p_runda || '/2' || chr(10)
        || 'Mesaj automat pentru clarificare. Nu reprezintă o aprobare de acces, modificare sau termen de realizare.' || chr(10) || chr(10);
  FOREACH v_q IN ARRAY p_intrebari LOOP
    v_i := v_i + 1;
    v_txt := v_txt || v_i || '. ' || btrim(v_q) || chr(10);
  END LOOP;
  v_txt := v_txt || chr(10) || 'Răspunde aici, pe tichet, fără parole sau date personale.' || chr(10) || 'Echipa ERP';
  INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt) RETURNING id INTO v_com;
  -- notificarea către autor: titlu și mesaj fixe, fără textul întrebărilor
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  VALUES (t.deschis_de, 'info', 'Tichete', '❓ Întrebări de clarificare la tichetul ' || coalesce(t.numar_tichet, '#' || t.id),
          'Echipa ERP are nevoie de câteva detalii ca să poată continua. Răspunde direct pe tichet.', '/tichete?id=' || t.id)
  RETURNING id INTO v_not;
  -- evidența: DOAR cheia clarificari_erp se înlocuiește; restul metadata rămâne neatins
  m := coalesce(t.metadata -> 'clarificari_erp', jsonb_build_object('comentarii', '[]'::jsonb, 'runde', '{}'::jsonb));
  m := m || jsonb_build_object('v', 1, 'runda', p_runda, 'faza', 'asteapta_autor',
              'comentarii', (m -> 'comentarii') || to_jsonb(v_com),
              'runde', coalesce(m -> 'runde', '{}'::jsonb) || jsonb_build_object(p_runda::text,
                         jsonb_build_object('comentariu_id', v_com, 'notificare_id', v_not, 'trimis_la', v_acum, 'intrebari', cardinality(p_intrebari))),
              'actualizat_la', v_acum);
  UPDATE public.tichete x SET metadata = coalesce(x.metadata, '{}'::jsonb) || jsonb_build_object('clarificari_erp', m) WHERE x.id = t.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'clarificari: evidenta tichetului % nu s-a scris (% randuri)', t.id, v_n;
  END IF;
  RETURN jsonb_build_object('rezultat', 'trimis', 'tichet_id', t.id, 'runda', p_runda, 'comentariu_id', v_com, 'notificare_id', v_not);
END $f$;

-- ── încheierea: 'tacere' / 'neclar' = mesajul de încheiere + notificare; 'clarificat' = doar marcajul. Atomică, deduplicată ──
CREATE FUNCTION public.fn_tichet_clarificare_incheie(p_tichet_id bigint, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
-- Ordinea lock-urilor (L06): ca la trimitere — rândul tichetului (FOR NO KEY UPDATE) -> comentariul -> notificarea -> metadatele.
-- Condițiile, din starea calculată sub lock (aceeași definiție ca lista rutinei):
--   tacere     = după runda 1 sau 2, fără răspunsul autorului, pragul de zile lucrătoare atins (acțiunea de_escaladat_tacere);
--   neclar     = după runda 2, cu răspunsul autorului (acțiunea de_evaluat_raspuns), evaluat insuficient de rutină;
--   clarificat = clar de la început (runda 0) sau după un răspuns al autorului: fără mesaj, fără notificare (tichetul merge mai departe).
-- Cheia de deduplicare: (tichet, versiunea 1, încheiere) — al doilea apel = deja_incheiat, cu motivul primului. Statusul nu se atinge.
DECLARE
  t record;
  s jsonb;
  m jsonb;
  v_txt text;
  v_com public.tichete_comentarii.id%TYPE;
  v_not public.notifications.id%TYPE;
  v_acum timestamptz := now();
  v_n integer;
BEGIN
  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'apelant_nepermis', 'tichet_id', p_tichet_id);
  END IF;
  IF p_motiv IS NULL OR p_motiv NOT IN ('tacere', 'neclar', 'clarificat') THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'motiv_invalid', 'tichet_id', p_tichet_id);
  END IF;
  SELECT x.id, x.numar_tichet, x.deschis_de, x.metadata INTO t FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'tichet_inexistent', 'tichet_id', p_tichet_id);
  END IF;
  IF to_regprocedure('public.fn_tichet_clarificare_incheie(bigint,text)') IS NULL THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'protocol_retras', 'tichet_id', p_tichet_id);
  END IF;
  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);
  IF (s ->> 'eligibil')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neeligibil', 'detaliu', s ->> 'motiv', 'tichet_id', p_tichet_id);
  END IF;
  IF s ->> 'actiune' = 'incoerent' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'stare_incoerenta', 'detaliu', s ->> 'detaliu', 'tichet_id', p_tichet_id);
  END IF;
  m := t.metadata -> 'clarificari_erp';
  IF s ->> 'faza' IN ('incheiat', 'clarificat') THEN
    RETURN jsonb_build_object('rezultat', 'deja_incheiat', 'tichet_id', p_tichet_id, 'motiv_incheiere', m -> 'incheiere' ->> 'motiv',
      'comentariu_id', m -> 'incheiere' -> 'comentariu_id');
  END IF;
  IF p_motiv = 'clarificat' AND NOT ((s ->> 'runda')::integer = 0 OR (s ->> 'raspuns_autor')::boolean IS TRUE) THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'fara_raspuns_autor', 'tichet_id', p_tichet_id);
  END IF;
  IF p_motiv = 'tacere' AND s ->> 'actiune' IS DISTINCT FROM 'de_escaladat_tacere' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'tacere_neindeplinita', 'detaliu', s ->> 'actiune', 'tichet_id', p_tichet_id);
  END IF;
  IF p_motiv = 'neclar' AND ((s ->> 'runda')::integer IS DISTINCT FROM 2 OR s ->> 'actiune' IS DISTINCT FROM 'de_evaluat_raspuns') THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neclar_nepermis', 'detaliu', s ->> 'actiune', 'tichet_id', p_tichet_id);
  END IF;
  m := coalesce(m, jsonb_build_object('runda', 0, 'comentarii', '[]'::jsonb, 'runde', '{}'::jsonb));
  IF p_motiv = 'clarificat' THEN
    m := m || jsonb_build_object('v', 1, 'faza', 'clarificat', 'incheiere', jsonb_build_object('motiv', p_motiv, 'la', v_acum), 'actualizat_la', v_acum);
  ELSE
    v_txt := 'Clarificările automate s-au încheiat. Tichetul rămâne deschis și ajunge la conducere împreună cu discuția. '
          || 'Acest mesaj nu confirmă implementarea sau un termen.' || chr(10) || 'Echipa ERP';
    INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt) RETURNING id INTO v_com;
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    VALUES (t.deschis_de, 'info', 'Tichete', 'ℹ️ Clarificări încheiate la tichetul ' || coalesce(t.numar_tichet, '#' || t.id),
            'Tichetul rămâne deschis și ajunge la conducere împreună cu discuția.', '/tichete?id=' || t.id)
    RETURNING id INTO v_not;
    m := m || jsonb_build_object('v', 1, 'faza', 'incheiat', 'comentarii', (m -> 'comentarii') || to_jsonb(v_com),
                'incheiere', jsonb_build_object('motiv', p_motiv, 'comentariu_id', v_com, 'notificare_id', v_not, 'la', v_acum), 'actualizat_la', v_acum);
  END IF;
  UPDATE public.tichete x SET metadata = coalesce(x.metadata, '{}'::jsonb) || jsonb_build_object('clarificari_erp', m) WHERE x.id = t.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'clarificari: evidenta tichetului % nu s-a scris (% randuri)', t.id, v_n;
  END IF;
  RETURN jsonb_build_object('rezultat', 'incheiat', 'tichet_id', t.id, 'motiv_incheiere', p_motiv, 'comentariu_id', v_com, 'notificare_id', v_not);
END $f$;

-- ── lista rutinei, DOAR citire: fiecare tichet eligibil, cu starea și acțiunea; completă (fără limită), ordine stabilă (created_at, id) ──
-- Apelant nepermis = EROARE (42501), nu listă goală (L18).
CREATE FUNCTION public.fn_tichet_clarificare_stare()
RETURNS TABLE (tichet_id bigint, numar_tichet text, status text, subcategorie text, creat_la timestamptz, runda integer, faza text,
               ultim_automat_id bigint, ultim_automat_la timestamptz, raspuns_autor boolean, ultim_raspuns_autor_la timestamptz,
               zile_lucratoare integer, prag_tacere integer, actiune text, raspuns_dupa_incheiere boolean, detaliu text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN
    RAISE EXCEPTION 'clarificari: apelant nepermis' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT (z.s ->> 'tichet_id')::bigint, z.s ->> 'numar_tichet', z.s ->> 'status', z.s ->> 'subcategorie', (z.s ->> 'creat_la')::timestamptz,
         (z.s ->> 'runda')::integer, z.s ->> 'faza', (z.s ->> 'ultim_automat_id')::bigint, (z.s ->> 'ultim_automat_la')::timestamptz,
         (z.s ->> 'raspuns_autor')::boolean, (z.s ->> 'ultim_raspuns_autor_la')::timestamptz, (z.s ->> 'zile_lucratoare')::integer,
         (z.s ->> 'prag_tacere')::integer, z.s ->> 'actiune', (z.s ->> 'raspuns_dupa_incheiere')::boolean, z.s ->> 'detaliu'
    FROM public.tichete x
    CROSS JOIN LATERAL (SELECT public.fn_tichet_clarificare_stare_tichet(x.id) AS s) z
   WHERE (z.s ->> 'eligibil')::boolean IS TRUE
   ORDER BY x.created_at, x.id;
END $f$;

-- drepturile, explicit: NIMENI în afara proprietarului (implicitele schemei dau EXECUTE tuturor)
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_intrebari_motiv(text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_apelant_ok() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_stare_tichet(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_incheie(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_stare() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[]) IS 'Clarificări automate pe tichetele din butonul de raportare: runda 1 / 2 (comentariu „Echipa ERP” fără autor + notificare + metadata.clarificari_erp), idempotentă pe (tichet, versiune 1, rundă). Doar conexiunea rutinei (session_user postgres, fără SET ROLE). 20261223a.';
COMMENT ON FUNCTION public.fn_tichet_clarificare_incheie(bigint, text) IS 'Clarificări automate: încheierea (tacere / neclar = mesaj + notificare; clarificat = doar marcaj), deduplicată. Statusul tichetului nu se schimbă. 20261223a.';
COMMENT ON FUNCTION public.fn_tichet_clarificare_stare() IS 'Clarificări automate: starea tichetelor eligibile pentru rutina zilnică (doar citire; prag tăcere 3 zile lucrătoare). 20261223a.';

-- ── postcondiții ──
DO $post$
DECLARE r record; v_alt text; v_rol text;
BEGIN
  -- funcțiile: limbaj, DEFINER, search_path fix, proprietar postgres, tipul întors; EXECUTE pentru NIMENI (fiecare rol verificat separat)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz)', 'sql', false, 'integer'),
      ('public.fn_tichet_clarificare_intrebari_motiv(text[])', 'sql', false, 'text'),
      ('public.fn_tichet_clarificare_apelant_ok()', 'sql', false, 'boolean'),
      ('public.fn_tichet_clarificare_stare_tichet(bigint)', 'plpgsql', false, 'jsonb'),
      ('public.fn_tichet_clarificare_trimite(bigint, integer, text[])', 'plpgsql', true, 'jsonb'),
      ('public.fn_tichet_clarificare_incheie(bigint, text)', 'plpgsql', true, 'jsonb'),
      ('public.fn_tichet_clarificare_stare()', 'plpgsql', true, 'record')
    ) v(fn, limbaj, definer, intoarce) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.prorettype = r.intoarce::regtype
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '20261223a post: functia % (limbaj / definer / search_path / owner / tip / PUBLIC)', r.fn;
    END IF;
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_rol, to_regprocedure(r.fn), 'EXECUTE') THEN
        RAISE EXCEPTION '20261223a post: % poate rula %', v_rol, r.fn;
      END IF;
    END LOOP;
  END LOOP;
  -- L15: funcțiile NOI cheamă (aceeași regulă de nume ca închiderea) DOAR una pe alta, și nimic dinamic
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%'
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND NOT (p2.pronamespace = 'public'::regnamespace AND p2.proname LIKE 'fn\_tichet\_clarificare\_%');
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%'
                  AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%') <> 7 THEN
    RAISE EXCEPTION '20261223a post: functiile noi cheama in afara lor: %', coalesce(v_alt, 'EXECUTE dinamic / numar de functii');
  END IF;
  -- nicio dată: nicio evidență clarificari_erp
  IF EXISTS (SELECT 1 FROM public.tichete x WHERE x.metadata -> 'clarificari_erp' IS NOT NULL) THEN
    RAISE EXCEPTION '20261223a post: date scrise';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari:' || txid_current() THEN
    RAISE EXCEPTION '20261223a: garda final invalida';
  END IF;
END $post$;

-- L15: aceeași amprentă DUPĂ schimbare, timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261223a('dupa');
  RAISE NOTICE '20261223a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261223a(text), pg_temp.amp_calc_20261223a(), pg_temp.amp_baseline_20261223a();
