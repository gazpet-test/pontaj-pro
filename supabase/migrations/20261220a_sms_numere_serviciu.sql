-- Version 20261220120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261220a_sms_numere_serviciu — SMS intern: NUMERE DE SERVICIU (telefoane ale firmei care nu sunt ale unui angajat, ex. „Gazpet Redări”),
--   afișate SEPARAT de angajați în „Selecție manuală” (cererea owner-ului, 13.11.2026). Fără angajați fictivi în employees (ar intra în
--   pontaj, HR, salarii, numărători) și fără al doilea telefon pe fișa angajatului.
--
-- Ce face:
--   * tabelul public.sms_numere_serviciu (denumire unică printre cele active, telefon mobil RO normalizat cu fn_sms_tel_normalizat,
--     responsabilul opțional = angajatul care ține telefonul, nota, activ, audit creat_* / modificat_*, versiune pentru CAS). RLS pornit,
--     NICIO politică, NICIUN drept pentru anon / authenticated / service_role / PUBLIC (nici pe secvența identității): se citește și se scrie
--     DOAR prin funcțiile SECURITY DEFINER de mai jos (tiparul modulului SMS). Nu se bazează pe retragerea drepturilor implicite din
--     20261218c: REVOKE explicit + postcondiție. Trigger BEFORE (pe orice cale, și postgres): nu se șterge (dezactivare), auditul și versiunea
--     le scrie serverul, un număr dezactivat nu se mai modifică (se adaugă din nou), responsabilul trebuie să existe;
--   * administrarea DOAR de owner (fn_sms_cere_owner, în BD): fn_sms_numere_serviciu_admin() (lista completă, telefon mascat),
--     fn_sms_numar_serviciu_salveaza(...) (adaugă / modifică pe versiunea văzută, 40001 altfel), fn_sms_numar_serviciu_dezactiveaza(id, versiune);
--   * lista pentru „Compune”: fn_sms_numere_serviciu_lista() — aceeași poartă ca fn_sms_angajati_lista (fn_sms_cere_nivel: owner /
--     utilizator / test), doar cele active, telefon mascat, opt-out. fn_sms_angajati_lista rămâne NESCHIMBATĂ;
--   * r2 (L23): lista vine ca UN obiect JSON {total, numere} (nu set de rânduri: plafonul de rânduri al PostgREST nu o taie), iar
--     clientul verifică numere.length = total (altfel eroare vizibilă). Limita: maximum 100 de numere ACTIVE (la adăugare, sub lock
--     consultativ: L01); cele dezactivate nu se numără;
--   * crearea lotului intern: fn_sms_lot_intern_creeaza primește p_numere_serviciu integer[] DEFAULT NULL (ultimul parametru):
--       - L09 / semnătura: varianta cu 4 parametri se ȘTERGE și se creează cea cu 5 în aceeași tranzacție (DROP + CREATE, nu supraîncărcare:
--         două variante ar face apelul cu nume din clientul publicat ambiguu, PGRST203). Clientul publicat trimite 4 nume -> găsește varianta
--         nouă (al cincilea are DEFAULT). Drepturile: REVOKE ALL de la PUBLIC / anon / authenticated / service_role, GRANT EXECUTE doar
--         authenticated; postcondiția: ACL-ul nou = EXACT ACL-ul variantei vechi (citit înainte de DROP);
--       - numerele de serviciu DOAR la selecție manuală: p_numere_serviciu nevid cere p_angajati nevid și fără departamente (altfel 22023;
--         UI-ul trimite [-1] când nu e bifat niciun angajat). Fiecare id cerut trebuie să fie ACTIV (altfel 22023 „reîncarcă lista”: nimic nu
--         dispare tacit); la crearea efectivă rândurile lor sunt ținute FOR SHARE până la COMMIT (o dezactivare concurentă așteaptă);
--       - regulile existente rămân, pe lista COMBINATĂ: un SMS per telefon (dacă un număr de serviciu coincide cu telefonul unui angajat
--         bifat pleacă unul singur, pe angajat), opt-out, maximum 5000, contul de test maximum 5 destinatari ÎN TOTAL (și în previzualizare),
--         coada contului de test, previzualizarea din BD, lista fixată în sms_mesaje (destinatar_tip = 'serviciu', destinatar_id = id-ul);
--       - corpul = corpul 20261130b + blocurile marcate „20261220a”;
--   * sms_mesaje.destinatar_tip acceptă și 'serviciu' (CHECK-ul refăcut cu ACELAȘI nume, scanat sub lock);
--   * fn_sms_lot_destinatari (lista de aprobat + „Mesajele lotului”): destinatarul 'serviciu' apare cu DENUMIREA numărului (nu cu numele
--     responsabilului); restul corpului 20261130b neschimbat, drepturile neschimbate (postcondiție). r2 (L03): denumirea e cea FIXATĂ la
--     crearea lotului (sms_loturi.filtru.numere_serviciu_denumiri, id -> denumire; filtrul e imuabil după creare, triggerul fn_sms_loturi_reguli),
--     nu cea din tabelul de azi: o redenumire ulterioară nu schimbă istoricul loturilor.
-- Ce NU face: nicio dată (nici un număr de serviciu: le adaugă owner-ul din ⚙ Setări), niciun drept de modul, nimic pe employees, nicio
--   schimbare în trimitere (fn_sms_rezerva / edge-ul nu se uită la destinatar_tip), în aprobare sau în Redări. Dezactivarea unui număr NU îl
--   scoate dintr-un lot deja creat (lista e fixată la creare): se anulează lotul (fn_sms_numar_serviciu_dezactiveaza întoarce câte loturi
--   active îl mai au).
-- Ordinea lock-urilor (L06), fără ciclu: crearea lotului = rândurile numerelor alese FOR SHARE (ORDER BY id) -> contul de test (consultativ)
--   -> lot -> mesaje (ordinea 20261130b după primul pas); salveaza / dezactiveaza = DOAR rândul numărului FOR UPDATE (nimic altceva ținut);
--   r2: adăugarea (salveaza cu p_id NULL) = DOAR lock-ul consultativ al adăugării, apoi insertul (niciun rând ținut înainte).
--
-- L15 (tiparul 20261217a, corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/smsNumereServiciuAmprente.test.js): amprenta COMPLETĂ a stării de
--   acces a tabelelor sms_loturi și sms_mesaje (drepturi, proprietar, RLS + FORCE, politici, triggere, secvențe) și a funcțiilor din BASELINE
--   (pornirea: fn_sms_lot_intern_creeaza cu 4 parametri, fn_sms_lot_destinatari, fn_sms_angajati_lista, cu callee-urile lor; plus funcțiile
--   din politicile / triggerele celor două tabele; r2 (P1): plus TOATE funcțiile chemate de corpurile NOI — porțile fn_sms_cere_owner /
--   fn_sms_cere_nivel, normalizarea, textul, coada de test, accesul pe lot, auth.uid — cu lanțul lor), comparată cu BASELINE-ul din producție
--   ÎNAINTE și DUPĂ. Completitudinea baseline-ului se impune aici, nu se presupune: (a) lista EXACTĂ a funcțiilor chemate de corpurile noi
--   trebuie să fie în baseline (testul static o compară cu apelurile din corpuri); (b) închiderea tranzitivă: orice funcție numită în corpul
--   unei funcții din amprentă e și ea în amprentă (doar REFUZĂ, nu adaugă și nu acceptă nimic). Valorile le scoate coordonatorul cu
--   scripts/sms_numere_serviciu_amprente.sql (tranzacție READ ONLY) în blocul marcat; necompletat = refuz. Excepțiile „după” (EXACT două):
--   'functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)' (ștearsă; varianta nouă: postcondițiile) și
--   'functie fn_sms_lot_destinatari(uuid)' (corp nou; proprietățile și ACL-ul: postcondițiile).
--
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$). Lock-uri (după
--   verificările de catalog, NOWAIT, reîncercate la 50 ms până la 1 s de la BEGIN; peste = 55P03, nimic schimbat): sms_loturi SHARE UPDATE
--   EXCLUSIVE (oprește doar DDL-ul: amprenta „după” rămâne adevărată), apoi sms_mesaje ACCESS EXCLUSIVE (cerut de CHECK; tabelul e mic,
--   o trimitere în curs așteaptă sub plafon). Sub lock DOAR catalog + scanarea CHECK-ului pe sms_mesaje.
-- Revenire: supabase/revenire/20261220a_sms_numere_serviciu_ROLLBACK.sql (refuză dacă există mesaje către numere de serviciu sau numere
--   salvate; ce se face în loc: în antetul ei). r2 (L14 / L15): amprenta COMPLETĂ a celor cinci funcții noi (corp md5, DEFINER, proprietar,
--   search_path, volatilitate, strict / leakproof, tipul întors, ACL exact) e scrisă în blocul „AMPRENTE-NOI 20261220a”, IDENTIC aici
--   (postcondiția: așa se aplică) și în revenire (așa trebuie să fie ca să se revină); o funcție modificată după aplicare = revenire refuzată.
-- Probe: scripts/pglite/test_sms_numere_serviciu_local.mjs (local, PGlite, cu mutanți) + src/smsNumereServiciuAmprente.test.js (static).
DO $pre$
DECLARE v_plafon text; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261220a_sms_numere_serviciu:' || txid_current() THEN
    RAISE EXCEPTION '20261220a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261220a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261220a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261220a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261220a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.sms_numere_serviciu') IS NOT NULL
     OR to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname IN ('fn_sms_numere_serviciu_lista', 'fn_sms_numere_serviciu_admin', 'fn_sms_numar_serviciu_salveaza',
                                    'fn_sms_numar_serviciu_dezactiveaza', 'fn_sms_numere_serviciu_reguli')) THEN
    RAISE EXCEPTION '20261220a: obiectele exista deja (reaplicare)';
  END IF;
  -- corpurile înlocuite sunt EXACT cele din 20261130b (analiza de mai sus e pe ele; md5 fără CR; aceleași constante în revenire)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)')
                   AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND md5(replace(p.prosrc, chr(13), '')) = 'ee0e39daf80d5abd45412e4782d5d07b')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_sms_lot_intern_creeaza') <> 1 THEN
    RAISE EXCEPTION '20261220a: fn_sms_lot_intern_creeaza nu e cea din 20261130b (corp / variante)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_lot_destinatari(uuid)')
                   AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND md5(replace(p.prosrc, chr(13), '')) = '3fb67709c3a020cfbdb783d51e288111') THEN
    RAISE EXCEPTION '20261220a: fn_sms_lot_destinatari nu e cea din 20261130b';
  END IF;
  -- funcțiile folosite de corpurile noi (normalizarea telefonului = aceeași ca pentru angajați; porțile de nivel / owner)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_tel_normalizat(text)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '36549798f8f7dcb40aee8cce7a0516b4')
     OR to_regprocedure('public.fn_sms_cere_nivel()') IS NULL OR to_regprocedure('public.fn_sms_cere_owner()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261220a: lipsesc functiile SMS folosite (fn_sms_tel_normalizat / fn_sms_cere_nivel / fn_sms_cere_owner / auth.uid)';
  END IF;
  -- CHECK-ul refăcut: exact cel din 20261130a (unul singur pe destinatar_tip)
  IF (SELECT string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
       WHERE c.conrelid = 'public.sms_mesaje'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%destinatar\_tip%')
     IS DISTINCT FROM 'sms_mesaje_destinatar_tip_check CHECK ((destinatar_tip = ANY (ARRAY[''angajat''::text, ''detinator''::text])))' THEN
    RAISE EXCEPTION '20261220a: CHECK-ul pe sms_mesaje.destinatar_tip nu e cel din 20261130a';
  END IF;
  -- coloanele citite (employees: angajatul responsabil)
  SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'id';
  IF v_tip IS DISTINCT FROM 'integer'
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name IN ('name', 'active')) <> 2 THEN
    RAISE EXCEPTION '20261220a: employees nu are coloanele asteptate (id integer, name, active)';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261220a: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- ── L15: amprenta COMPLETĂ a stării de acces, verificată ÎNAINTE și DUPĂ schimbare (tiparul 20261217a) ──
-- >>> BASELINE 20261220a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/sms_numere_serviciu_amprente.sql, copiată
--     ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat (rândul DE_COMPLETAT) = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261220a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('DE_COMPLETAT', 'DE_COMPLETAT')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261220a
CREATE FUNCTION pg_temp.amp_calc_20261220a() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH
amp_tabele(oid) AS (VALUES ('public.sms_loturi'::regclass::oid), ('public.sms_mesaje'::regclass::oid)),
amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_20261220a() b WHERE b.eticheta LIKE 'functie %'),
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
-- „înainte”: exact baseline-ul. „după”: exact baseline-ul fără cele două etichete declarate în antet (proprietățile lor: postcondițiile).
CREATE FUNCTION pg_temp.amp_verifica_20261220a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261220a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261220a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261220a: baseline L15 necompletat sau invalid (scripts/sms_numere_serviciu_amprente.sql)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261220a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261220a: baseline L15 cu etichete duble';
  END IF;
  -- cele două funcții schimbate trebuie să fie în baseline (pornirea scriptului); altfel baseline-ul nu e al acestei migrări
  IF (SELECT count(*) FROM pg_temp.amp_baseline_20261220a() b
       WHERE b.eticheta IN ('functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'functie fn_sms_lot_destinatari(uuid)')) <> 2 THEN
    RAISE EXCEPTION '20261220a: baseline L15 fara functiile schimbate (fn_sms_lot_intern_creeaza / fn_sms_lot_destinatari)';
  END IF;
  -- r2 (P1): funcțiile pe care se sprijină corpurile NOI (porți, normalizare, text, coada de test, acces pe lot, identitate) trebuie să fie
  -- în baseline — lista EXACTĂ (testul static o compară cu apelurile din corpurile noi; același set e în pornirea scriptului)
  SELECT string_agg(o.e, ', ' ORDER BY o.e COLLATE "C") INTO v_dif
    FROM unnest(ARRAY[
      -- >>> FOLOSITE 20261220a
      'functie auth.uid()', 'functie fn_sms_cere_nivel()', 'functie fn_sms_cere_owner()', 'functie fn_sms_lot_acces(uuid,text,sms_loturi,boolean)',
      'functie fn_sms_tel_normalizat(text)', 'functie fn_sms_test_coada(uuid)', 'functie fn_sms_test_coada_cere(uuid,integer)',
      'functie fn_sms_test_coada_lock(uuid,boolean)', 'functie fn_sms_test_coada_max()', 'functie fn_sms_text_valid(text)', 'functie fn_sms_text_verifica(text)'
      -- <<< FOLOSITE 20261220a
    ]) o(e)
   WHERE NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261220a() b WHERE b.eticheta = o.e);
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261220a: baseline L15 fara functiile folosite de corpurile noi: % (scripts/sms_numere_serviciu_amprente.sql, versiunea r2)', v_dif;
  END IF;
  -- r2 (P1): lanțul complet (închiderea tranzitivă): orice funcție din public / auth / executie_acces_intern numită (cuvânt întreg) în
  -- corpul unei funcții sql / plpgsql din amprentă e și ea în amprentă — aceeași regulă ca indiciile scriptului, dar aici DOAR refuză
  -- (nu adaugă nimic în comparație și nu acceptă nimic). Cuvintele se extrag o dată pe corp (un singur regex fix, ieftin sub plafon).
  IF p_moment = 'inainte' THEN
    WITH f AS (
      SELECT DISTINCT p.oid, p.prosrc FROM pg_temp.amp_calc_20261220a() c
        JOIN pg_proc p ON c.eticheta LIKE 'functie %' AND p.oid = to_regprocedure(substr(c.eticheta, 9))
       WHERE p.prolang IN (SELECT lg.oid FROM pg_language lg WHERE lg.lanname IN ('sql', 'plpgsql'))
    ), w AS (
      SELECT DISTINCT f.oid, m.c[1] AS cuvant FROM f CROSS JOIN LATERAL regexp_matches(lower(f.prosrc), '([[:alnum:]_]+)', 'g') AS m(c)
    )
    SELECT string_agg(DISTINCT p2.oid::regprocedure::text || ' (din ' || w.oid::regprocedure::text || ')', '; ') INTO v_dif
      FROM w JOIN pg_proc p2 ON lower(p2.proname) = w.cuvant AND p2.oid <> w.oid
       AND p2.pronamespace IN ('public'::regnamespace, to_regnamespace('auth'), to_regnamespace('executie_acces_intern'))
     WHERE NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261220a() b WHERE b.eticheta = 'functie ' || p2.oid::regprocedure::text);
    IF v_dif IS NOT NULL THEN
      RAISE EXCEPTION '20261220a: baseline L15 incomplet: functii chemate din lantul de acces, lipsa din baseline: %', v_dif;
    END IF;
  END IF;
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM (SELECT x.eticheta, x.amprenta FROM pg_temp.amp_calc_20261220a() x
           WHERE NOT (p_moment = 'dupa' AND x.eticheta IN ('functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'functie fn_sms_lot_destinatari(uuid)'))) c
    FULL JOIN (SELECT y.eticheta, y.amprenta FROM pg_temp.amp_baseline_20261220a() y
                WHERE NOT (p_moment = 'dupa' AND y.eticheta IN ('functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'functie fn_sms_lot_destinatari(uuid)'))) b
      ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261220a: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM pg_temp.amp_calc_20261220a() c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261220a: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261220a('inainte'); END $l15_inainte$;
-- ACL-ul celor două funcții schimbate, ÎNAINTE (postcondiția: varianta nouă / corpul nou au EXACT aceleași drepturi)
CREATE FUNCTION pg_temp.sms_acl_20261220a(p_oid oid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $acl$
  SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
    SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
           || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE p.oid = p_oid) a
$acl$;
CREATE TEMP TABLE sms_acl_inainte_20261220a ON COMMIT DROP AS
  SELECT f.nume, pg_temp.sms_acl_20261220a(f.oid) AS acl
    FROM (VALUES ('intern_creeaza', to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)')::oid),
                 ('lot_destinatari', to_regprocedure('public.fn_sms_lot_destinatari(uuid)')::oid)) f(nume, oid);

-- ── punctul UNIC de blocare (L06: lot -> mesaje), după verificările de catalog; NOWAIT + reîncercare până la 1 s de la BEGIN ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.sms_loturi IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;   -- doar DDL-ul oprit (amprenta „după” rămâne adevărată)
      LOCK TABLE public.sms_mesaje IN ACCESS EXCLUSIVE MODE NOWAIT;         -- cerut de CHECK-ul refăcut
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261220a: BUGET_LOCK: sms_loturi / sms_mesaje ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261220a: lock-uri la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ─── 1. Tabelul numerelor de serviciu ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.sms_numere_serviciu (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  denumire text NOT NULL CONSTRAINT sms_numere_serviciu_denumire_ck
    CHECK (denumire = btrim(denumire) AND length(denumire) BETWEEN 2 AND 60 AND denumire !~ '[[:cntrl:]]'),
  telefon text NOT NULL CONSTRAINT sms_numere_serviciu_telefon_ck CHECK (telefon ~ '^[+]407[0-9]{8}$'),
  responsabil_employee_id integer,
  nota text CONSTRAINT sms_numere_serviciu_nota_ck CHECK (nota IS NULL OR (nota = btrim(nota) AND length(nota) BETWEEN 1 AND 300)),
  activ boolean NOT NULL DEFAULT true,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid,
  modificat_la timestamptz,
  versiune integer NOT NULL DEFAULT 1
);
-- denumirea și telefonul: unice printre numerele ACTIVE (după dezactivare, aceeași denumire se poate adăuga din nou)
CREATE UNIQUE INDEX ux_sms_numere_serviciu_denumire ON public.sms_numere_serviciu (lower(denumire)) WHERE activ;
CREATE UNIQUE INDEX ux_sms_numere_serviciu_telefon ON public.sms_numere_serviciu (telefon) WHERE activ;
COMMENT ON TABLE public.sms_numere_serviciu IS 'SMS: numere de serviciu (telefoane ale firmei, nu ale unui angajat), destinatari doar la selectia manuala a unui lot intern. Fara drepturi directe: citit / scris doar prin RPC-urile SECURITY DEFINER (administrare = owner). Nu se sterg: se dezactiveaza (mesajele vechi pastreaza legatura).';
COMMENT ON COLUMN public.sms_numere_serviciu.responsabil_employee_id IS 'SMS: angajatul care tine telefonul (optional, informativ). Mesajele apar cu denumirea numarului, nu cu numele lui.';

-- reguli pe ORICE cale (și postgres / service_role): auditul și versiunea le scrie serverul
CREATE FUNCTION public.fn_sms_numere_serviciu_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sms: numerele de serviciu nu se sterg (se dezactiveaza; mesajele vechi le pastreaza denumirea)' USING ERRCODE = '42501';
  END IF;
  IF NEW.telefon IS DISTINCT FROM public.fn_sms_tel_normalizat(NEW.telefon) THEN
    RAISE EXCEPTION 'sms: telefonul numarului de serviciu nu e un mobil RO normalizat (+407xxxxxxxx)' USING ERRCODE = '23514';
  END IF;
  IF NEW.responsabil_employee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.responsabil_employee_id IS DISTINCT FROM OLD.responsabil_employee_id)
     AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = NEW.responsabil_employee_id) THEN
    RAISE EXCEPTION 'sms: responsabilul numarului de serviciu nu exista printre angajati' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.activ := true; NEW.creat_de := auth.uid(); NEW.creat_la := now(); NEW.modificat_de := NULL; NEW.modificat_la := NULL; NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.creat_de IS DISTINCT FROM OLD.creat_de OR NEW.creat_la IS DISTINCT FROM OLD.creat_la THEN
    RAISE EXCEPTION 'sms: id-ul si crearea unui numar de serviciu nu se schimba' USING ERRCODE = '23514';
  END IF;
  IF NOT OLD.activ THEN
    RAISE EXCEPTION 'sms: un numar de serviciu dezactivat nu se mai modifica (adauga-l din nou)' USING ERRCODE = '23514';
  END IF;
  NEW.modificat_de := auth.uid(); NEW.modificat_la := now(); NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_sms_numere_serviciu_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.sms_numere_serviciu
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_numere_serviciu_reguli();

ALTER TABLE public.sms_numere_serviciu ENABLE ROW LEVEL SECURITY;
-- NICIO politică: anon / authenticated nu văd niciun rând chiar dacă ar primi vreodată un drept; și fără drepturi (explicit, nu pe baza
-- drepturilor implicite ale platformei)
REVOKE ALL ON TABLE public.sms_numere_serviciu FROM PUBLIC, anon, authenticated, service_role;
-- secvența identității (numele implicit; postcondiția verifică pe catalog că e chiar ea)
REVOKE ALL ON SEQUENCE public.sms_numere_serviciu_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2. sms_mesaje: destinatarul poate fi și un număr de serviciu ────────────────────────────────────────────────────────────
ALTER TABLE public.sms_mesaje DROP CONSTRAINT sms_mesaje_destinatar_tip_check,
  ADD CONSTRAINT sms_mesaje_destinatar_tip_check CHECK (destinatar_tip IN ('angajat', 'detinator', 'serviciu'));

-- ─── 3. Lista pentru „Compune” (owner / utilizator / test) și administrarea (doar owner) ────────────────────────────────────
CREATE FUNCTION public.fn_sms_numere_serviciu_lista() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_sms_cere_nivel();
  -- r2 (L23): UN obiect JSON (nu set de rânduri: plafonul de rânduri al PostgREST nu-l taie); total = numărătoarea din același
  -- instantaneu, verificată de client (numere.length = total, altfel eroare vizibilă). Active: maximum 100 (fn_sms_numar_serviciu_salveaza).
  SELECT jsonb_build_object('total', count(*),
           'numere', coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'denumire', s.denumire, 'telefon_mascat', '07** *** ' || right(s.telefon, 3),
                       'optout', EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = s.telefon AND o.activ)) ORDER BY s.denumire, s.id), '[]'::jsonb))
    INTO v
    FROM public.sms_numere_serviciu s
   WHERE s.activ;
  RETURN v;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_numere_serviciu_lista() IS 'SMS: numerele de serviciu ACTIVE pentru selectia manuala a unui lot intern (aceeasi poarta ca fn_sms_angajati_lista: owner / utilizator / test), telefon mascat, opt-out. Un obiect {total, numere}: clientul verifica numere.length = total.';

CREATE FUNCTION public.fn_sms_numere_serviciu_admin() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'denumire', s.denumire, 'telefon_mascat', '07** *** ' || right(s.telefon, 3),
           'responsabil_employee_id', s.responsabil_employee_id, 'responsabil_nume', e.name, 'nota', s.nota, 'activ', s.activ,
           'creat_la', s.creat_la, 'modificat_la', s.modificat_la, 'versiune', s.versiune,
           'optout', EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = s.telefon AND o.activ))
           ORDER BY s.activ DESC, s.denumire, s.id), '[]'::jsonb)
    INTO v
    FROM public.sms_numere_serviciu s LEFT JOIN public.employees e ON e.id = s.responsabil_employee_id;
  RETURN v;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_numere_serviciu_admin() IS 'SMS (doar owner): toate numerele de serviciu (si cele dezactivate), cu responsabilul, nota, versiunea; telefon mascat.';

-- adaugă (p_id NULL) sau modifică (p_id + versiunea văzută; telefonul gol = rămâne cel salvat) — DOAR owner-ul
CREATE FUNCTION public.fn_sms_numar_serviciu_salveaza(p_id integer, p_denumire text, p_telefon text, p_responsabil_employee_id integer,
                                                       p_nota text, p_versiune integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r public.sms_numere_serviciu; v_den text; v_tel text; v_nota text;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  v_den := btrim(regexp_replace(coalesce(p_denumire, ''), '[[:space:]]+', ' ', 'g'));
  IF length(v_den) NOT BETWEEN 2 AND 60 OR v_den ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'sms: denumirea numarului de serviciu are intre 2 si 60 de caractere' USING ERRCODE = '22023';
  END IF;
  v_nota := nullif(btrim(regexp_replace(coalesce(p_nota, ''), '[[:space:]]+', ' ', 'g')), '');
  IF length(v_nota) > 300 THEN RAISE EXCEPTION 'sms: nota are maximum 300 de caractere' USING ERRCODE = '22023'; END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO r FROM public.sms_numere_serviciu s WHERE s.id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sms: numarul de serviciu nu exista' USING ERRCODE = 'P0002'; END IF;
    IF NOT r.activ THEN RAISE EXCEPTION 'sms: numarul de serviciu e dezactivat (adauga-l din nou)' USING ERRCODE = '23514'; END IF;
    IF p_versiune IS DISTINCT FROM r.versiune THEN
      RAISE EXCEPTION 'sms: numarul de serviciu s-a schimbat intre timp; reincarca lista' USING ERRCODE = '40001';
    END IF;
  END IF;
  IF p_id IS NOT NULL AND btrim(coalesce(p_telefon, '')) = '' THEN
    v_tel := r.telefon;
  ELSE
    v_tel := public.fn_sms_tel_normalizat(p_telefon);
    IF v_tel IS NULL THEN RAISE EXCEPTION 'sms: telefonul nu e un mobil RO valid (07xx xxx xxx)' USING ERRCODE = '22023'; END IF;
  END IF;
  -- responsabilul: angajat ACTIV când se alege / se schimbă (unul deja salvat, devenit inactiv, nu blochează alte modificări)
  IF p_responsabil_employee_id IS NOT NULL AND (p_id IS NULL OR p_responsabil_employee_id IS DISTINCT FROM r.responsabil_employee_id)
     AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_responsabil_employee_id AND e.active IS TRUE) THEN
    RAISE EXCEPTION 'sms: responsabilul ales nu e un angajat activ' USING ERRCODE = '22023';
  END IF;
  -- r2 (L23 / L01): maximum 100 de numere ACTIVE. Adăugarea e singura cale care le crește numărul (modificarea nu schimbă „activ”, un
  -- dezactivat nu se reactivează): lock consultativ pe adăugare (nimic altceva ținut înainte), apoi numărarea, apoi insertul.
  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sms_numere_serviciu:adaugare', 0));
    IF (SELECT count(*) FROM public.sms_numere_serviciu s WHERE s.activ) >= 100 THEN
      RAISE EXCEPTION 'sms: maximum 100 de numere de serviciu active (dezactiveaza unul inainte)' USING ERRCODE = '22023';
    END IF;
  END IF;
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.sms_numere_serviciu (denumire, telefon, responsabil_employee_id, nota)
      VALUES (v_den, v_tel, p_responsabil_employee_id, v_nota) RETURNING * INTO r;
    ELSE
      UPDATE public.sms_numere_serviciu s SET denumire = v_den, telefon = v_tel, responsabil_employee_id = p_responsabil_employee_id, nota = v_nota
       WHERE s.id = p_id RETURNING * INTO r;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'sms: exista deja un numar de serviciu activ cu aceasta denumire sau cu acest telefon' USING ERRCODE = '23505';
  END;
  RETURN jsonb_build_object('id', r.id, 'denumire', r.denumire, 'telefon_mascat', '07** *** ' || right(r.telefon, 3), 'activ', r.activ,
    'responsabil_employee_id', r.responsabil_employee_id, 'nota', r.nota, 'versiune', r.versiune);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_numar_serviciu_salveaza(integer, text, text, integer, text, integer) IS 'SMS (doar owner): adauga (p_id NULL) sau modifica un numar de serviciu pe versiunea vazuta (40001 altfel). Telefonul normalizat cu fn_sms_tel_normalizat (mobil RO; altfel 22023); la modificare, telefonul gol = ramane cel salvat.';

CREATE FUNCTION public.fn_sms_numar_serviciu_dezactiveaza(p_id integer, p_versiune integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r public.sms_numere_serviciu; v_loturi integer;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO r FROM public.sms_numere_serviciu s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: numarul de serviciu nu exista' USING ERRCODE = 'P0002'; END IF;
  IF NOT r.activ THEN RAISE EXCEPTION 'sms: numarul de serviciu e deja dezactivat' USING ERRCODE = '23514'; END IF;
  IF p_versiune IS DISTINCT FROM r.versiune THEN
    RAISE EXCEPTION 'sms: numarul de serviciu s-a schimbat intre timp; reincarca lista' USING ERRCODE = '40001';
  END IF;
  UPDATE public.sms_numere_serviciu s SET activ = false WHERE s.id = p_id RETURNING * INTO r;
  -- loturile deja create îl păstrează (lista e fixată): câte mai au mesaje către el în coadă (de anulat, dacă nu mai trebuie să plece)
  SELECT count(DISTINCT m.lot_id)::integer INTO v_loturi
    FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
   WHERE m.destinatar_tip = 'serviciu' AND m.destinatar_id = r.id::text AND m.stare = 'in_coada'
     AND l.stare IN ('draft', 'aprobat', 'in_trimitere');
  RETURN jsonb_build_object('id', r.id, 'denumire', r.denumire, 'activ', r.activ, 'versiune', r.versiune, 'loturi_active', v_loturi);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_numar_serviciu_dezactiveaza(integer, integer) IS 'SMS (doar owner): dezactiveaza un numar de serviciu pe versiunea vazuta. Nu-l scoate din loturile deja create (loturi_active = cate mai au mesaje in coada catre el).';

-- ─── 4. Crearea lotului intern: + numerele de serviciu (DROP + CREATE, fără supraîncărcare; L09) ─────────────────────────────
DROP FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean);
CREATE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text, p_departamente text[] DEFAULT NULL, p_angajati integer[] DEFAULT NULL,
                                                 p_doar_preview boolean DEFAULT true, p_numere_serviciu integer[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_niv text;
        v_ns integer[]; v_tip text[]; v_cand_s integer; v_den jsonb;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- 20261220a: numerele de serviciu, DOAR la selecție manuală (angajați bifați, fără departamente); fiecare id cerut = activ (altfel refuz,
  -- nimic nu dispare tacit); la crearea efectivă rândurile lor ținute FOR SHARE până la COMMIT (ordinea: numere -> cont de test -> lot -> mesaje)
  v_ns := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_numere_serviciu, '{}'::integer[])) x ORDER BY x);
  IF cardinality(v_ns) > 0 THEN
    IF coalesce(cardinality(p_angajati), 0) = 0 OR coalesce(cardinality(p_departamente), 0) > 0 THEN
      RAISE EXCEPTION 'sms: numerele de serviciu se aleg doar la selectia manuala (nu la toti angajatii sau pe departament)' USING ERRCODE = '22023';
    END IF;
    IF NOT coalesce(p_doar_preview, true) THEN
      PERFORM 1 FROM public.sms_numere_serviciu s WHERE s.id = ANY (v_ns) ORDER BY s.id FOR SHARE;
    END IF;
    IF (SELECT count(*) FROM public.sms_numere_serviciu s WHERE s.id = ANY (v_ns) AND s.activ) IS DISTINCT FROM cardinality(v_ns)::bigint THEN
      RAISE EXCEPTION 'sms: un numar de serviciu ales nu mai exista sau a fost dezactivat; reincarca lista' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- un singur instantaneu: candidatii (angajati activi din filtre + numerele de serviciu alese), excluderile si lista finala (un SMS per
  -- telefon; la acelasi telefon, angajatul are prioritate fata de numarul de serviciu)
  -- r2 (L03): denumirea numerelor de serviciu din listă se fixează în filtrul lotului (imuabil după creare), din același instantaneu
  WITH c AS (
    SELECT 'angajat'::text AS tip, e.id, public.fn_sms_tel_normalizat(e.telefon) AS tel, NULL::text AS den
      FROM public.employees e
     WHERE e.active IS TRUE
       AND (coalesce(cardinality(p_angajati), 0) = 0 OR e.id = ANY (p_angajati))
       AND (coalesce(cardinality(p_departamente), 0) = 0 OR e.department = ANY (p_departamente))
    UNION ALL
    SELECT 'serviciu'::text, s.id, s.telefon, s.denumire FROM public.sms_numere_serviciu s WHERE s.activ AND s.id = ANY (v_ns)
  ), b AS (
    SELECT c.tip, c.id, c.tel, c.den, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.tip, b.id, b.den FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, (b.tip = 'serviciu'), b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d),
         (SELECT array_agg(d.tip ORDER BY d.tel) FROM d), (SELECT count(*) FROM b WHERE b.tip = 'serviciu'),
         (SELECT jsonb_object_agg(d.id::text, d.den ORDER BY d.id) FROM d WHERE d.tip = 'serviciu')
    INTO v_cand, v_fara, v_opt, v_tel, v_ids, v_tip, v_cand_s, v_den;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms: niciun angajat activ in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms: niciun destinatar cu mobil RO valid (dupa filtre si opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  -- 20261130b: contul de test, maximum 5 destinatari (si in previzualizare); 20261220a: in total, angajati + numere de serviciu
  IF v_niv = 'test' AND v_nr > 5 THEN
    RAISE EXCEPTION 'sms test: contul de test trimite unui lot de maximum 5 destinatari (selectia are %)', v_nr USING ERRCODE = '42501';
  END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    -- r3 (P2-01 b) / r4: coada contului de test DOAR la crearea efectiva (previzualizarea nu ia lock si nu e refuzata de coada):
    -- lock consultativ pe cont cu asteptare, inaintea oricarui alt lock, tinut pana la final
    IF v_niv = 'test' THEN
      PERFORM public.fn_sms_test_coada_lock(auth.uid(), true);
      PERFORM public.fn_sms_test_coada_cere(auth.uid(), v_nr);
    END IF;
    INSERT INTO public.sms_loturi (categorie, text, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('intern', v_text, jsonb_build_object('departamente', to_jsonb(p_departamente), 'angajati_selectati', coalesce(cardinality(p_angajati), 0),
                                                 'numere_serviciu_selectate', cardinality(v_ns),
                                                 'numere_serviciu_denumiri', coalesce(v_den, '{}'::jsonb)),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, u.k, u.i FROM unnest(v_tel, v_ids, v_tip) AS u(t, i, k);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  -- plafonul zilnic e o setare: numarul il vede doar owner-ul; ceilalti afla doar daca lotul il depaseste
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'intern', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost,
    'plafon_zi', CASE WHEN v_niv = 'owner' THEN v_plafon END, 'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0),
    'preview', coalesce(p_doar_preview, true), 'nivel', v_niv,
    'coada_libera', CASE WHEN v_niv = 'test' THEN greatest(0, public.fn_sms_test_coada_max() - public.fn_sms_test_coada(auth.uid())) END,
    'candidati_serviciu', v_cand_s,
    'numere_serviciu', (SELECT count(*) FROM unnest(coalesce(v_tip, '{}'::text[])) k WHERE k = 'serviciu'));
END $fn$;
COMMENT ON FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[]) IS 'SMS: previzualizeaza / creeaza un lot intern catre angajatii activi (toti, pe departament sau bifati) si, DOAR la selectia manuala, catre numerele de serviciu alese (p_numere_serviciu, active). Un SMS per telefon (angajatul are prioritate), opt-out, contul de test maximum 5 destinatari in total.';

-- ─── 5. Lista FIXATĂ în lot: destinatarul 'serviciu' cu denumirea numărului ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(p_lot_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_lista jsonb; v_lungime integer; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id;
  IF NOT FOUND OR NOT public.fn_sms_lot_acces(auth.uid(), v_niv, l, false) THEN
    RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002';
  END IF;
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(l.text) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mesaj_id', x.id, 'destinatar_tip', x.destinatar_tip, 'nume', x.nume,
           'telefon_mascat', '07** *** ' || right(x.telefon, 3), 'stare', x.stare, 'cod_eroare', x.cod_eroare,
           'rezervat_la', x.rezervat_la, 'trimis_la', x.trimis_la, 'livrat_la', x.livrat_la) ORDER BY x.nume, x.id), '[]'::jsonb)
    INTO v_lista
    FROM (SELECT m.id, m.destinatar_tip, m.telefon, m.stare, m.cod_eroare, m.rezervat_la, m.trimis_la, m.livrat_la,
                 -- 20261220a: numărul de serviciu apare cu denumirea lui (nu cu numele responsabilului); r2 (L03): denumirea FIXATĂ la
                 -- crearea lotului (filtrul lotului, imuabil), nu cea de azi din tabel — o redenumire nu schimbă istoricul
                 coalesce(CASE m.destinatar_tip WHEN 'angajat' THEN e.name WHEN 'serviciu' THEN l.filtru -> 'numere_serviciu_denumiri' ->> m.destinatar_id
                               ELSE d.nume END,
                          '(destinatar indisponibil)') AS nume
            FROM public.sms_mesaje m
            LEFT JOIN public.employees e
              ON e.id = CASE WHEN m.destinatar_tip = 'angajat' AND m.destinatar_id ~ '^[0-9]{1,9}$' THEN m.destinatar_id::integer END
            LEFT JOIN public.red_detinatori d
              ON d.id = CASE WHEN m.destinatar_tip = 'detinator' AND m.destinatar_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             THEN m.destinatar_id::uuid END
           WHERE m.lot_id = l.id) x;
  RETURN jsonb_build_object('lot_id', l.id, 'categorie', l.categorie, 'stare', l.stare, 'versiune', l.versiune, 'text', l.text,
    'lungime', v_lungime, 'segmente', l.segmente, 'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur,
    'excluse_optout', l.excluse_optout, 'excluse_fara_mobil', l.excluse_fara_mobil, 'proiect_id', l.proiect_id, 'uat_id', l.uat_id,
    'creat_la', l.creat_la, 'creat_nivel', l.creat_nivel, 'aprobat_nivel', l.aprobat_nivel, 'nivel', v_niv,
    'actiune_permisa', public.fn_sms_lot_acces(auth.uid(), v_niv, l, true), 'destinatari', v_lista);
END $fn$;

-- ─── 6. Drepturi (privilegiile implicite ale platformei dau EXECUTE pe funcții noi: se scot explicit) ────────────────────────
REVOKE ALL ON FUNCTION public.fn_sms_numere_serviciu_reguli(), public.fn_sms_numere_serviciu_lista(), public.fn_sms_numere_serviciu_admin(),
  public.fn_sms_numar_serviciu_salveaza(integer, text, text, integer, text, integer), public.fn_sms_numar_serviciu_dezactiveaza(integer, integer),
  public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sms_numere_serviciu_lista(), public.fn_sms_numere_serviciu_admin(),
  public.fn_sms_numar_serviciu_salveaza(integer, text, text, integer, text, integer), public.fn_sms_numar_serviciu_dezactiveaza(integer, integer),
  public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[])
  TO authenticated;

-- ── postcondiții ──
DO $post$
DECLARE v_o oid; v_acl text; v_dif text; v_t regclass := 'public.sms_numere_serviciu'::regclass; v_s regclass;
  v_expuse regprocedure[] := ARRAY['public.fn_sms_numere_serviciu_lista()', 'public.fn_sms_numere_serviciu_admin()',
    'public.fn_sms_numar_serviciu_salveaza(integer,text,text,integer,text,integer)', 'public.fn_sms_numar_serviciu_dezactiveaza(integer,integer)',
    'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])', 'public.fn_sms_lot_destinatari(uuid)']::regprocedure[];
BEGIN
  -- tabelul: al lui postgres, RLS pornit (fără FORCE: funcțiile DEFINER ale proprietarului îl citesc), ZERO politici, ZERO drepturi pentru
  -- altcineva decât proprietarul (tabel, coloane, secvența identității); anon / authenticated / service_role nu pot nimic
  IF pg_get_userbyid((SELECT c.relowner FROM pg_class c WHERE c.oid = v_t)) IS DISTINCT FROM 'postgres'
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_t) OR (SELECT c.relforcerowsecurity FROM pg_class c WHERE c.oid = v_t)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_t)
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = v_t AND e.grantee <> c.relowner)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261220a post: tabelul sms_numere_serviciu (proprietar / RLS / politici / drepturi)';
  END IF;
  FOREACH v_acl IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_acl, v_t, 'SELECT') OR has_table_privilege(v_acl, v_t, 'INSERT') OR has_table_privilege(v_acl, v_t, 'UPDATE')
       OR has_table_privilege(v_acl, v_t, 'DELETE') OR has_table_privilege(v_acl, v_t, 'TRUNCATE') OR has_table_privilege(v_acl, v_t, 'REFERENCES')
       OR has_table_privilege(v_acl, v_t, 'TRIGGER') OR has_any_column_privilege(v_acl, v_t, 'SELECT') THEN
      RAISE EXCEPTION '20261220a post: % are drepturi pe sms_numere_serviciu', v_acl;
    END IF;
  END LOOP;
  v_s := pg_get_serial_sequence('public.sms_numere_serviciu', 'id')::regclass;
  IF v_s IS DISTINCT FROM 'public.sms_numere_serviciu_id_seq'::regclass
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) e WHERE c.oid = v_s AND e.grantee <> c.relowner) THEN
    RAISE EXCEPTION '20261220a post: secventa identitatii are drepturi pentru altcineva';
  END IF;
  -- triggerul: forma exactă, activ, singurul pe tabel; funcția lui fără EXECUTE pentru nimeni
  IF (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid = v_t AND NOT tg.tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = v_t AND tg.tgname = 'trg_sms_numere_serviciu_reguli' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_sms_numere_serviciu_reguli()'::regprocedure
                      AND pg_get_triggerdef(tg.oid) = 'CREATE TRIGGER trg_sms_numere_serviciu_reguli BEFORE INSERT OR DELETE OR UPDATE ON public.sms_numere_serviciu FOR EACH ROW EXECUTE FUNCTION fn_sms_numere_serviciu_reguli()') THEN
    RAISE EXCEPTION '20261220a post: triggerul de pe sms_numere_serviciu';
  END IF;
  -- CHECK-ul refăcut (același nume, cele trei valori), unul singur pe destinatar_tip
  IF (SELECT string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
       WHERE c.conrelid = 'public.sms_mesaje'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%destinatar\_tip%')
     IS DISTINCT FROM 'sms_mesaje_destinatar_tip_check CHECK ((destinatar_tip = ANY (ARRAY[''angajat''::text, ''detinator''::text, ''serviciu''::text])))' THEN
    RAISE EXCEPTION '20261220a post: CHECK-ul pe sms_mesaje.destinatar_tip';
  END IF;
  -- crearea lotului: O SINGURĂ variantă (cea cu 5 parametri), fără supraîncărcare
  IF to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)') IS NOT NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_sms_lot_intern_creeaza') <> 1 THEN
    RAISE EXCEPTION '20261220a post: fn_sms_lot_intern_creeaza are alte variante decat cea noua';
  END IF;
  -- toate funcțiile noi / schimbate: plpgsql, DEFINER, proprietar postgres, search_path fix, fără EXECUTE pentru PUBLIC / anon / service_role
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.oid = ANY (v_expuse::oid[] || ARRAY['public.fn_sms_numere_serviciu_reguli()'::regprocedure::oid]) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_o AND l.lanname = 'plpgsql' AND p.prosecdef
                     AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'])
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('anon', v_o, 'EXECUTE') OR has_function_privilege('service_role', v_o, 'EXECUTE')
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_expuse)) THEN
      RAISE EXCEPTION '20261220a post: functia % (definer / owner / search_path / EXECUTE)', v_o::regprocedure;
    END IF;
    -- echivalentul local al porții permanente 0e (scripts/control_0e.sql) pe funcțiile expuse
    IF v_o::regprocedure = ANY (v_expuse) AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o
         AND lower(p.prosrc || ' ' || pg_get_function_arguments(p.oid)) ~ '(set_config|request[[:space:]]*[.][[:space:]]*jwt|[[:<:]]execute[[:>:]]|session[_[:space:]]+authorization|[[:<:]]u&)') THEN
      RAISE EXCEPTION '20261220a post: functia expusa % contine o constructie interzisa de poarta 0e', v_o::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.oid = ANY (v_expuse::oid[])) <> 6 OR to_regprocedure('public.fn_sms_numere_serviciu_reguli()') IS NULL THEN
    RAISE EXCEPTION '20261220a post: lipsesc functii';
  END IF;
  -- ACL-ul variantei noi = EXACT ACL-ul variantei vechi; fn_sms_lot_destinatari: ACL-ul neschimbat (CREATE OR REPLACE îl păstrează)
  IF (SELECT a.acl FROM sms_acl_inainte_20261220a a WHERE a.nume = 'intern_creeaza') IS NULL
     OR (SELECT a.acl FROM sms_acl_inainte_20261220a a WHERE a.nume = 'intern_creeaza')
          IS DISTINCT FROM pg_temp.sms_acl_20261220a('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])'::regprocedure)
     OR (SELECT a.acl FROM sms_acl_inainte_20261220a a WHERE a.nume = 'lot_destinatari')
          IS DISTINCT FROM pg_temp.sms_acl_20261220a('public.fn_sms_lot_destinatari(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '20261220a post: drepturile functiilor schimbate difera de cele dinainte';
  END IF;
  -- corpurile noi: amprentele revizuite (aceleași în revenire)
  IF md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])'::regprocedure), chr(13), ''))
       IS DISTINCT FROM
       -- AMPRENTA-START crearea lotului
       '4f2c94e800d629f783290971550298f6'
       -- AMPRENTA-END crearea lotului
     OR md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_sms_lot_destinatari(uuid)'::regprocedure), chr(13), ''))
       IS DISTINCT FROM
       -- AMPRENTA-START lista fixata
       '16b73cb340232b8eef78449102d565aa'
       -- AMPRENTA-END lista fixata
       THEN
    RAISE EXCEPTION '20261220a post: corpurile noi difera de cele revizuite';
  END IF;
  -- r2 (L14 / L15): amprenta COMPLETĂ a celor cinci funcții noi = EXACT cea cu care revenirea acceptă să le scoată (blocul e identic acolo)
  -- >>> AMPRENTE-NOI 20261220a
  SELECT string_agg(e.fn || ' = ' || coalesce(a.d, 'LIPSESTE'), '; ' ORDER BY e.fn COLLATE "C") INTO v_dif
    FROM (VALUES
      ('public.fn_sms_numar_serviciu_dezactiveaza(integer,integer)', 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=e45e7fc9f8d8c1bb9181acc508a6f098'),
      ('public.fn_sms_numar_serviciu_salveaza(integer,text,text,integer,text,integer)', 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=bb417d0955884f0d1d5b760e555dec31'),
      ('public.fn_sms_numere_serviciu_admin()', 'tip=f, limbaj=plpgsql, definer=true, volatil=s, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=fe18333d6e850487d1266088faf290f6'),
      ('public.fn_sms_numere_serviciu_lista()', 'tip=f, limbaj=plpgsql, definer=true, volatil=s, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=720c72b8d1c097677055eb179e7ec2a3'),
      ('public.fn_sms_numere_serviciu_reguli()', 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=trigger, acl=postgres:EXECUTE, variante=1, corp_md5=7fa25a176a6c1a54f8b809c44c7e7011')
    ) e(fn, asteptat)
    LEFT JOIN LATERAL (
      SELECT 'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
             || ', strict=' || p.proisstrict::text || ', leakproof=' || p.proleakproof::text || ', proprietar=' || pg_get_userbyid(p.proowner)
             || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
             || ', acl=' || coalesce((SELECT string_agg(x.d, ', ' ORDER BY x.d COLLATE "C") FROM (
                  SELECT CASE g.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END || ':' || g.privilege_type
                         || CASE WHEN g.is_grantable THEN '*' ELSE '' END AS d
                    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g) x), '(niciun drept)')
             || ', variante=' || (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname)::text
             || ', corp_md5=' || md5(replace(p.prosrc, chr(13), '')) AS d
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(e.fn)) a ON true
   WHERE a.d IS DISTINCT FROM e.asteptat;
  -- <<< AMPRENTE-NOI 20261220a
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261220a post: functiile noi difera de amprenta revizuita: %', v_dif;
  END IF;
  -- nimic scris: tabelul nou e gol, niciun mesaj către un număr de serviciu
  IF EXISTS (SELECT 1 FROM public.sms_numere_serviciu) OR EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.destinatar_tip = 'serviciu') THEN
    RAISE EXCEPTION '20261220a post: date neasteptate';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261220a_sms_numere_serviciu:' || txid_current() THEN
    RAISE EXCEPTION '20261220a: garda final invalida';
  END IF;
END $post$;

-- L15: aceeași amprentă DUPĂ schimbare (cu excepțiile declarate), timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261220a('dupa');
  RAISE NOTICE '20261220a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261220a(text), pg_temp.amp_calc_20261220a(), pg_temp.amp_baseline_20261220a(), pg_temp.sms_acl_20261220a(oid);
