-- Version 20261223120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261223a_tichete_clarificari — clarificări automate pe tichetele din butonul de raportare, maximum 2 runde (decizia owner-ului, 13.11.2026). r2.
--
-- Tichetele din butonul de raportare (departament 'it', subcategorie eroare_erp / cerere_functie, metadata.sursa bug_report / feature_request)
-- care NU sunt clare primesc, pe tichet, întrebări de clarificare scrise de rutina zilnică (sesiune de asistent, prin conectorul bazei).
-- Rutina dă DOAR întrebările; baza compune mesajul din șablonul fix, îl semnează „Echipa ERP”, îl scrie ca un comentariu FĂRĂ autor
-- (niciun cont nu apare că „a discutat”), notifică autorul tichetului în platformă și ține evidența în tabelul propriu
-- public.tichete_clarificari — toate în aceeași tranzacție, sub lock pe rândul tichetului. Tichetul NU se modifică de aici (nici statusul,
-- nici metadata: funcțiile doar citesc tichete).
--
-- Ce creează:
--   * TABELUL public.tichete_clarificari = evidența protocolului, un rând pe eveniment: runda 1, runda 2, încheierea (tăcere / neclar, cu
--     mesaj) sau marcajul „clarificat” (fără mesaj). Coloane: tichetul, felul, runda, motivul, id-ul comentariului automat și al notificării,
--     numărul de întrebări, autorul tichetului la acel moment, instantaneul id-urilor comentariilor autorului existente atunci, versiunea
--     contextului evaluat de rutină, versiunea protocolului (1), momentul serverului. NU conține textul întrebărilor (acela e doar în
--     comentariu) și nicio dată personală în afara id-ului autorului (deja vizibil pe tichet). Cheia (tichet, fel, rundă) + cel mult o
--     încheiere pe tichet (L16). RLS activ; o singură politică: SELECT pentru conturile logate (aceeași vizibilitate ca a comentariilor);
--     fără politici de scriere; drepturile de scriere retrase de la PUBLIC / anon / authenticated / service_role. Scriu în el DOAR
--     funcțiile DEFINER de mai jos. Fără cheie străină spre tichete (migrarea nu ia lock de scriere pe tichete, iar ștergerea unui tichet de
--     către owner rămâne cum e azi; rândurile lui rămân ca dovadă și blochează revenirea).
--   * 8 funcții, dintre care 3 SECURITY DEFINER (cele apelate de rutină):
--     fn_tichet_clarificare_trimite(tichet, runda, intrebari[], versiune_context)  — DEFINER; runda 1 / 2: comentariu + notificare + rândul
--       de evidență; idempotentă pe (tichet, runda): al doilea apel = „deja_trimis”, fără al doilea comentariu / a doua notificare;
--     fn_tichet_clarificare_incheie(tichet, motiv, versiune_context)              — DEFINER; încheierea, la fel de atomică și deduplicată:
--       'tacere' / 'neclar' = mesajul de încheiere + notificare; 'clarificat' = doar rândul de evidență (fără mesaj). Funcție SEPARATĂ:
--       alte intrări (fără întrebări), alte condiții, alt rezultat; un apel greșit nu poate trimite întrebări în locul încheierii;
--     fn_tichet_clarificare_stare()                                               — DEFINER, DOAR citire: starea fiecărui tichet eligibil,
--       acțiunea rezultată și versiune_context;
--     interne (INVOKER, fără drept pentru nimeni): fn_tichet_clarificare_stare_tichet (O SINGURĂ definiție a stării, L19, cu pragul de tăcere
--       = 3 zile lucrătoare într-un singur loc), fn_tichet_clarificare_context (amprenta contextului: titlu, descriere, TOATE comentariile),
--       fn_tichet_clarificare_zile_lucratoare (Europe/Bucharest, fără weekend), fn_tichet_clarificare_intrebari_motiv (validarea textului:
--       refuz cu motiv, nu trunchiere), fn_tichet_clarificare_apelant_ok (verificarea apelantului, în cod).
-- Starea vine DOAR din tabelul protejat + comentariile reale; metadata tichetului nu se citește și nu se scrie pentru protocol (nu e
--   dovadă). „Răspuns după runda N” = un comentariu al autorului tichetului (autor = deschis_de) al cărui id NU e în instantaneul rundei N
--   (luat sub lock, la trimitere): datele (created_at) și ordinea id-urilor, valori alese la INSERT, nu decid nimic; momentul răspunsului e
--   doar informativ. Zilele de tăcere se numără de la momentul SERVERULUI al rundei (creat_la din tabel).
-- versiune_context: fn_tichet_clarificare_stare() o dă pentru fiecare tichet (md5 calculat în bază peste titlu, descriere și toate
--   comentariile: id, autor, text, ordonate după id); trimite / incheie o cer ca parametru obligatoriu, o recalculează sub lock și refuză cu
--   „context_schimbat” la orice diferență (rutina recitește și reevaluează). Deduplicarea (deja_trimis / deja_incheiat) vine ÎNAINTEA
--   comparației, ca reluarea după un timeout să nu fie confundată cu o schimbare.
-- Cine le poate chema: NIMENI în afara proprietarului postgres (REVOKE de la PUBLIC / anon / authenticated / service_role, niciun GRANT) ȘI,
--   verificat în cod la fiecare apel, session_user = 'postgres' fără SET ROLE (current_setting('role') = 'none'). LIMITA EXACTĂ: verificarea
--   identifică SESIUNILE postgres de pe server (conectorul rutinei, psql-ul coordonatorului, joburile pg_cron, care rulează toate ca
--   postgres), NU rutina anume. Ea separă apelurile din aplicație (PostgREST: session_user = authenticator, rol setat => refuz, chiar cu un
--   GRANT greșit sau prin altă funcție DEFINER, care schimbă doar current_user). Puterea unei sesiuni postgres prin aceste funcții e
--   limitată de ele: șablon fix, validarea textului, 2 runde, deduplicare, doar tichetele eligibile. NU service_role (rutina nu are cheia
--   de serviciu). auth.uid() nu se folosește (L08: identitatea nu vine din parametri sau din GUC-uri custom).
--
-- L15: amprenta COMPLETĂ (corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/ticheteClarificariMigrare.test.js) pe tabelele existente atinse
--   (tichete — citit și blocat pe rând, tichete_comentarii și notifications — scrise: drepturi, RLS + FORCE, TOATE politicile, TOATE
--   triggerele) și pe funcțiile lor, plus ÎNCHIDEREA TRANZITIVĂ calculată în migrare (blocul INCHIDERE_L15, identic cu scriptul). Pornirea
--   închiderii păstrează, CONSERVATOR, și triggerele de UPDATE pe tichete (din r1; în r2 funcțiile nu mai scriu în tichete): doar mai mult
--   amprentat / verificat, aceeași mulțime de etichete ca citirea din producție. Comparată cu BASELINE-ul ÎNAINTE și DUPĂ: o diferență (ex. un
--   trigger nou apărut între citire și aplicare) = refuz. Pe LANȚ: EXECUTE dinamic / limbaj neanalizabil / DEFINER fără search_path = refuz.
--   Tabelul NOU nu intră în amprentă (nu există înainte): postcondițiile lui sunt mai jos (drepturi pe fiecare rol, RLS, politica unică,
--   fără triggere, gol).
--   Livrarea finală se va face prin runnerul cu amprenta globală (L15 v2, în lucru în alt PR); aici nu se adaugă verificări lexicale noi.
-- BASELINE: completat din citirea de producție din 13.11.2026 (scripts/tichete_clarificari_amprente.sql, 30 de etichete); coordonatorul o
--   repetă înainte de aplicare: orice diferență = refuz (nimic schimbat).
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$).
--   Lock (L06): notifications, tichete, tichete_comentarii (în ordinea asta) SHARE UPDATE EXCLUSIVE, NOWAIT, reîncercat la 50 ms până la
--   1 s de la BEGIN (peste = 55P03, nimic schimbat), după verificările de catalog: NU oprește citirile și scrierile de rânduri, oprește
--   doar CREATE TRIGGER / politici / ALTER TABLE concurente până la COMMIT. Sub lock: tabelul, funcțiile, postcondițiile, amprenta „după”.
-- Revenire: supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql (refuză dacă tabelul are rânduri = clarificări trimise; în loc:
--   oprirea pasului din promptul rutinei, docs/TICHETE_CLARIFICARI.md).
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
  -- reaplicare = refuz (orice funcție fn_tichet_clarificare_* sau un obiect cu numele tabelului de evidență)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_tichet\_clarificare\_%')
     OR to_regclass('public.tichete_clarificari') IS NOT NULL OR to_regtype('public.tichete_clarificari') IS NOT NULL THEN
    RAISE EXCEPTION '20261223a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise, cu tipurile acceptate
  FOR r IN SELECT * FROM (VALUES
      ('tichete', 'id', 'bigint'), ('tichete', 'numar_tichet', 'text|character varying'), ('tichete', 'departament', 'text|character varying'),
      ('tichete', 'subcategorie', 'text|character varying'), ('tichete', 'status', 'text|character varying'), ('tichete', 'deschis_de', 'uuid'),
      ('tichete', 'metadata', 'jsonb'), ('tichete', 'created_at', 'timestamp with time zone'), ('tichete', 'titlu', 'text|character varying'),
      ('tichete', 'descriere', 'text|character varying'),
      ('tichete_comentarii', 'id', 'bigint'), ('tichete_comentarii', 'tichet_id', 'bigint'), ('tichete_comentarii', 'autor', 'uuid'),
      ('tichete_comentarii', 'text', 'text'), ('tichete_comentarii', 'created_at', 'timestamp with time zone'),
      ('notifications', 'id', 'bigint'), ('notifications', 'profile_id', 'uuid'), ('notifications', 'type', 'text|character varying'),
      ('notifications', 'modul', 'text|character varying'), ('notifications', 'title', 'text|character varying'),
      ('notifications', 'message', 'text|character varying'), ('notifications', 'link_to', 'text|character varying'), ('profiles', 'id', 'uuid')
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
END $pre$;

-- ── L15: amprenta COMPLETĂ a tabelelor în care scriem și a funcțiilor care rulează la scrierile noastre, ÎNAINTE și DUPĂ ──
-- >>> BASELINE 20261223a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/tichete_clarificari_amprente.sql,
--     copiată ÎNTREAGĂ, în ordinea afișată; coloanele „sursa”, „atentie” și „detaliu” de acolo intră în review. Necompletat = refuz.
CREATE FUNCTION pg_temp.amp_baseline_20261223a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('functie auth.uid()', '547eb1864858f1efce909a735a04d521')
  , ('functie fn_generate_numar_tichet()', 'c870b8affb14e80890bba704e4d4946a')
  , ('functie fn_is_app_owner(uuid)', '25d3c3b05f1a5ab5b2941e8a6b8d4209')
  , ('functie fn_log_tichet_istoric()', 'f58fb155f3039e9c7b9485c213b50989')
  , ('functie fn_notificari_ruteaza_ofertare()', '6915de743effdbf9f3ff8b0637ad1edd')
  , ('functie fn_tichete_autoclose_on_confirm()', '0594f63ebdaafa4cc47dcdc4055b8292')
  , ('functie fn_tichete_cleanup_notifications()', '021f40a586b4e412841f6d04d62b95ba')
  , ('functie fn_tichete_normalize_entitate_tip()', 'd41132fb5388ef453cd56386fe02a32c')
  , ('functie fn_tichete_notif_on_assign()', '78ba6be0e86793b73f61a71d063ca93c')
  , ('functie fn_tichete_notif_on_insert()', '30a77d10e9267bbe04b04b25f09fdbd6')
  , ('functie fn_tichete_notif_on_status_change()', 'a33e8e9876938890a3ce5948be6f4ae5')
  , ('functie fn_tichete_snapshot_km_ore()', '28fb55f8be7b86ed01b0d779018239fa')
  , ('tabel notifications | acl', '565553b4fd23bff3761a45bfba76d27c')
  , ('tabel notifications | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
  , ('tabel notifications | politici', '96dc99022691119101002528b000b7f0')
  , ('tabel notifications | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
  , ('tabel notifications | secvente', 'bbbe06049ca0ce6fe6fd6affe08cdf33')
  , ('tabel notifications | triggere', 'd673bcc042fdfd1df3d2a16b1771de06')
  , ('tabel tichete | acl', '565553b4fd23bff3761a45bfba76d27c')
  , ('tabel tichete | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
  , ('tabel tichete | politici', 'e98bab179f04506e411c6bca23a1d05b')
  , ('tabel tichete | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
  , ('tabel tichete | secvente', '786ab138e832852d23d077d486912742')
  , ('tabel tichete | triggere', '2bb235ebdae0d253c5e614ebeb467d66')
  , ('tabel tichete_comentarii | acl', '565553b4fd23bff3761a45bfba76d27c')
  , ('tabel tichete_comentarii | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
  , ('tabel tichete_comentarii | politici', 'ab4ba9ae51be844de35b51fde5816168')
  , ('tabel tichete_comentarii | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
  , ('tabel tichete_comentarii | secvente', 'd25148383cd0658f54710e4bcd2a7ae6')
  , ('tabel tichete_comentarii | triggere', '7fd4342f774415f814a99973b428be52')
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

-- ── evidența protocolului: tabel propriu, scris DOAR de funcțiile DEFINER de mai jos (proprietar postgres) ──
-- Un rând pe eveniment. fel = 'runda' (runda 1 / 2: comentariu + notificare + numărul de întrebări), 'incheiere' (tăcere / neclar: mesaj +
-- notificare; runda = ultima rundă trimisă) sau 'clarificat' (fără mesaj; runda = 0 / 1 / 2). instantaneu_autor = id-urile comentariilor
-- autorului tichetului existente la acel moment (sub lock); un comentariu al autorului cu id-ul în afara lui = scris după eveniment.
CREATE TABLE public.tichete_clarificari (
  tichet_id bigint NOT NULL,
  fel text NOT NULL,
  runda smallint NOT NULL,
  motiv text,
  comentariu_id bigint,
  notificare_id bigint,
  nr_intrebari smallint,
  autor_tichet uuid NOT NULL,
  instantaneu_autor bigint[] NOT NULL,
  versiune_context text NOT NULL,
  versiune_protocol smallint NOT NULL DEFAULT 1,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tichete_clarificari_cheie PRIMARY KEY (tichet_id, fel, runda),
  CONSTRAINT tichete_clarificari_forma CHECK (
       (fel = 'runda' AND runda IN (1, 2) AND motiv IS NULL AND comentariu_id IS NOT NULL AND notificare_id IS NOT NULL
        AND nr_intrebari BETWEEN 1 AND 3)
    OR (fel = 'incheiere' AND runda IN (1, 2) AND motiv IN ('tacere', 'neclar') AND comentariu_id IS NOT NULL AND notificare_id IS NOT NULL
        AND nr_intrebari IS NULL)
    OR (fel = 'clarificat' AND runda IN (0, 1, 2) AND motiv IS NULL AND comentariu_id IS NULL AND notificare_id IS NULL AND nr_intrebari IS NULL)),
  CONSTRAINT tichete_clarificari_protocol_v1 CHECK (versiune_protocol = 1),
  CONSTRAINT tichete_clarificari_context_md5 CHECK (versiune_context ~ '^[0-9a-f]{32}$'),
  CONSTRAINT tichete_clarificari_instantaneu_plat CHECK (coalesce(array_ndims(instantaneu_autor), 1) = 1 AND array_position(instantaneu_autor, NULL) IS NULL)
);
-- cel mult o încheiere (cu mesaj sau „clarificat”) pe tichet
CREATE UNIQUE INDEX tichete_clarificari_o_incheiere ON public.tichete_clarificari (tichet_id) WHERE fel IN ('incheiere', 'clarificat');
ALTER TABLE public.tichete_clarificari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tichete_clarificari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.tichete_clarificari TO authenticated;
-- citire pentru conturile logate (eticheta „Echipa ERP” și semnul „așteaptă răspunsul tău” din interfață); fără politici de scriere
CREATE POLICY tichete_clarificari_select ON public.tichete_clarificari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE public.tichete_clarificari IS 'Clarificări automate pe tichetele din butonul de raportare: evidența rundelor / încheierii (fără textul întrebărilor). Scris DOAR de fn_tichet_clarificare_trimite / fn_tichet_clarificare_incheie. 20261223a.';

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
-- 1–3 întrebări, fiecare cu text, cel mult 300 de caractere, fără caractere de control (deci fără linii noi) sau invizibile (spațiu de
-- lățime zero, direcție de text); fără „@” (nici variantele late); fără adrese web: schemă (http: / ftp: / file:), „www.”, orice cuvânt
-- „nume.domeniu” cu o terminație uzuală (cu sau fără cale) și regula generală „litere.litere/”; fără 9 sau mai multe cifre apropiate
-- (între două cifre cel mult 2 semne care nu sunt litere, cifre, virgulă, punct și virgulă sau două puncte: spații, puncte, liniuțe,
-- paranteze, plus, bară), cu cifrele late echivalate cu cele obișnuite: telefon, CNP, cont, IP. Limite: numerele scrise în cuvinte, cifrele
-- despărțite de litere / virgule, alte forme Unicode de cifre și domeniile cu terminații rare fără cale nu sunt prinse (rămân în grija
-- regulilor din prompt).
CREATE FUNCTION public.fn_tichet_clarificare_intrebari_motiv(p_intrebari text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE
    WHEN p_intrebari IS NULL OR array_ndims(p_intrebari) IS DISTINCT FROM 1 OR cardinality(p_intrebari) NOT BETWEEN 1 AND 3 THEN 'numar_intrebari'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE q.t IS NULL OR q.t !~ '[^[:space:]]') THEN 'intrebare_goala'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE char_length(q.t) > 300) THEN 'intrebare_prea_lunga'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t)
                  WHERE q.t ~ '[[:cntrl:]]'
                     OR q.t ~ ('[' || chr(8203) || '-' || chr(8207) || chr(8232) || '-' || chr(8238) || chr(8288) || '-' || chr(8292) || chr(65279) || ']')) THEN 'caractere_control'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t)
                  WHERE strpos(q.t, '@') > 0 OR strpos(q.t, chr(65312)) > 0 OR strpos(q.t, chr(65131)) > 0) THEN 'adresa_email'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t)
                  WHERE q.t ~* '(https?|ftps?|file)[[:space:]]*:|www[[:space:]]*\.'
                     OR q.t ~* '[[:alnum:]_-]\.(ro|com|net|org|eu|info|io|biz|gov|edu|app|dev|me|co|uk|de|fr|it|es|nl|at|ch|hu|bg|md|ru|ua|us|tv|ly|to|gl|xyz|online|site|tech|ai|cloud|link|page|shop|store|live|top)\M'
                     OR q.t ~ '[[:alpha:]]\.[[:alpha:]]+/') THEN 'url'
    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t)
                  WHERE regexp_replace(q.t, '[' || chr(65296) || '-' || chr(65305) || ']', '0', 'g') ~ '[0-9]([^[:alnum:],;:]{0,2}[0-9]){8,}') THEN 'sir_cifre'
  END
$f$;

-- ── apelantul: o sesiune postgres a serverului (conectorul rutinei, psql-ul coordonatorului, joburile pg_cron), fără SET ROLE ──
-- Verificarea în COD (pe lângă lipsa oricărui GRANT): prin PostgREST session_user = authenticator și rolul e setat (anon / authenticated /
-- service_role) => fals, chiar dacă cineva ar acorda greșit EXECUTE sau ar chema funcțiile din altă funcție DEFINER expusă. session_user
-- și rolul nu pot fi schimbate de un rol fără drept asupra lor (nu sunt GUC-uri custom, L08). NU deosebește rutina de alte sesiuni postgres.
CREATE FUNCTION public.fn_tichet_clarificare_apelant_ok() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT session_user = 'postgres' AND current_setting('role') = 'none'
$f$;

-- ── versiunea contextului unui tichet: md5 peste titlu, descriere și TOATE comentariile (id, autor, text), ordonate după id ──
-- NULL = tichet inexistent. O dă lista rutinei; trimiterea / încheierea o recalculează sub lock și o compară cu cea evaluată.
CREATE FUNCTION public.fn_tichet_clarificare_context(p_tichet_id bigint) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(jsonb_build_object(
           'titlu', x.titlu, 'descriere', x.descriere,
           'comentarii', coalesce((SELECT jsonb_agg(jsonb_build_array(c.id, c.autor, c.text) ORDER BY c.id)
                                     FROM public.tichete_comentarii c WHERE c.tichet_id = x.id), '[]'::jsonb))::text)
    FROM public.tichete x WHERE x.id = p_tichet_id
$f$;

-- ── starea clarificărilor pentru UN tichet: O SINGURĂ definiție (L19), citită de lista rutinei și de cele două scrieri (sub lock) ──
CREATE FUNCTION public.fn_tichet_clarificare_stare_tichet(p_tichet_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
-- Nu scrie nimic. Pragul de tăcere și lista albă de eligibilitate stau DOAR aici. Evidența = DOAR tabelul tichete_clarificari, verificat
-- față de comentariile reale: un comentariu automat din evidență care lipsește (ex. șters de owner) sau un comentariu automat nelistat,
-- ori autorul tichetului schimbat de la prima rundă = „incoerent” (nimic nu se mai trimite până decide owner-ul).
DECLARE
  c_prag_tacere constant integer := 3;  -- zile lucrătoare de tăcere după un mesaj automat => escaladare (SINGURUL loc)
  t record;
  r1 public.tichete_clarificari%ROWTYPE;
  r2 public.tichete_clarificari%ROWTYPE;
  rf public.tichete_clarificari%ROWTYPE;
  ru public.tichete_clarificari%ROWTYPE;   -- ultima rundă trimisă
  v_are1 boolean; v_are2 boolean; v_aref boolean;
  v_motiv text;
  v_inc text;
  v_runda integer := 0;
  v_faza text;
  v_ult_id bigint;
  v_ult_la timestamptz;
  v_resp boolean := false;
  v_resp_la timestamptz;
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
  -- evidența: rândurile protejate
  SELECT e.* INTO r1 FROM public.tichete_clarificari e WHERE e.tichet_id = t.id AND e.fel = 'runda' AND e.runda = 1;
  v_are1 := FOUND;
  SELECT e.* INTO r2 FROM public.tichete_clarificari e WHERE e.tichet_id = t.id AND e.fel = 'runda' AND e.runda = 2;
  v_are2 := FOUND;
  SELECT e.* INTO rf FROM public.tichete_clarificari e WHERE e.tichet_id = t.id AND e.fel IN ('incheiere', 'clarificat');
  v_aref := FOUND;
  v_runda := CASE WHEN v_are2 THEN 2 WHEN v_are1 THEN 1 ELSE 0 END;
  IF v_are2 THEN ru := r2; ELSIF v_are1 THEN ru := r1; END IF;
  v_faza := CASE WHEN v_aref AND rf.fel = 'incheiere' THEN 'incheiat' WHEN v_aref THEN 'clarificat' WHEN v_runda > 0 THEN 'asteapta_autor' END;
  -- coerența evidenței (forma rândurilor o garantează CHECK-ul tabelului)
  IF (v_are2 AND NOT v_are1) OR (v_aref AND rf.runda IS DISTINCT FROM v_runda) THEN
    v_inc := 'evidenta_invalida';
  ELSIF EXISTS (SELECT 1 FROM public.tichete_clarificari e WHERE e.tichet_id = t.id AND e.autor_tichet IS DISTINCT FROM t.deschis_de) THEN
    v_inc := 'autor_schimbat';
  ELSIF EXISTS (SELECT 1 FROM public.tichete_clarificari e
                 WHERE e.tichet_id = t.id AND e.comentariu_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM public.tichete_comentarii c WHERE c.id = e.comentariu_id AND c.tichet_id = t.id AND c.autor IS NULL)) THEN
    v_inc := 'comentariu_automat_lipsa';
  ELSIF EXISTS (SELECT 1 FROM public.tichete_comentarii c
                 WHERE c.tichet_id = t.id AND c.autor IS NULL
                   AND (c.text LIKE 'Clarificare _/2' || chr(10) || '%' OR c.text LIKE 'Clarificările automate s-au încheiat.%')
                   AND NOT EXISTS (SELECT 1 FROM public.tichete_clarificari e WHERE e.tichet_id = t.id AND e.comentariu_id = c.id)) THEN
    v_inc := 'comentariu_automat_neinregistrat';
  END IF;
  IF v_inc IS NOT NULL THEN
    RETURN jsonb_build_object('tichet_id', t.id, 'numar_tichet', t.numar_tichet, 'status', t.status, 'subcategorie', t.subcategorie,
      'creat_la', t.created_at, 'eligibil', true, 'actiune', 'incoerent', 'detaliu', v_inc, 'runda', v_runda, 'faza', v_faza,
      'raspuns_autor', false, 'raspuns_dupa_incheiere', false, 'prag_tacere', c_prag_tacere,
      'versiune_context', public.fn_tichet_clarificare_context(t.id));
  END IF;
  -- răspunsul la ultima rundă = un comentariu al AUTORULUI tichetului (deschis_de) cu id-ul în afara instantaneului rundei (comentariile
  -- altor conturi sunt context, nu răspuns); data lui e doar informativă
  IF v_runda > 0 THEN
    SELECT count(*) > 0, max(c.created_at) INTO v_resp, v_resp_la FROM public.tichete_comentarii c
     WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND NOT (c.id = ANY (ru.instantaneu_autor));
  END IF;
  -- ultimul eveniment automat (încheierea, altfel ultima rundă): comentariul lui și momentul SERVERULUI
  IF v_aref THEN
    v_ult_id := rf.comentariu_id; v_ult_la := rf.creat_la;
    v_dupa := EXISTS (SELECT 1 FROM public.tichete_comentarii c
                       WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND NOT (c.id = ANY (rf.instantaneu_autor)));
  ELSIF v_runda > 0 THEN
    v_ult_id := ru.comentariu_id; v_ult_la := ru.creat_la;
    v_zile := public.fn_tichet_clarificare_zile_lucratoare(ru.creat_la, now());
  END IF;
  v_act := CASE
    WHEN v_faza IS NULL THEN 'de_evaluat_initial'
    WHEN v_faza IN ('incheiat', 'clarificat') THEN 'incheiat'
    WHEN v_resp THEN 'de_evaluat_raspuns'
    WHEN v_zile >= c_prag_tacere THEN 'de_escaladat_tacere'
    ELSE 'asteapta_autor'
  END;
  RETURN jsonb_build_object('tichet_id', t.id, 'numar_tichet', t.numar_tichet, 'status', t.status, 'subcategorie', t.subcategorie,
    'creat_la', t.created_at, 'eligibil', true, 'actiune', v_act, 'runda', v_runda, 'faza', v_faza,
    'ultim_automat_id', v_ult_id, 'ultim_automat_la', v_ult_la, 'raspuns_autor', v_resp, 'ultim_raspuns_autor_la', v_resp_la,
    'zile_lucratoare', v_zile, 'prag_tacere', c_prag_tacere, 'raspuns_dupa_incheiere', v_dupa,
    'versiune_context', public.fn_tichet_clarificare_context(t.id));
END $f$;

-- ── runda 1 / 2: comentariu automat + notificare + rândul de evidență, într-o tranzacție, idempotent pe (tichet, rundă) ──
CREATE FUNCTION public.fn_tichet_clarificare_trimite(p_tichet_id bigint, p_runda integer, p_intrebari text[], p_versiune_context text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
-- Ordinea lock-urilor (L06): rândul tichetului (FOR NO KEY UPDATE: serializează două apeluri pentru același tichet, nu blochează un
--   comentariu nou al unui om, care ia doar KEY SHARE) -> comentariul nou (cheia străină spre tichet: rândul e deja al nostru) -> notificarea
--   (cheia străină spre profiles: KEY SHARE pe profilul autorului) -> rândul de evidență (cheia unică: o rundă o singură dată, L16).
--   Triggerele acestor scrieri: amprenta L15. Tichetul nu se modifică.
-- Rezultat explicit, fără excepții pentru cazurile de business: trimis / deja_trimis / refuz + motiv (+ detaliu).
DECLARE
  t record;
  s jsonb;
  e public.tichete_clarificari%ROWTYPE;
  v_motiv text;
  v_txt text;
  v_q text;
  v_i integer := 0;
  v_com public.tichete_comentarii.id%TYPE;
  v_not public.notifications.id%TYPE;
  v_inst bigint[];
BEGIN
  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'apelant_nepermis', 'tichet_id', p_tichet_id);
  END IF;
  IF p_runda IS NULL OR p_runda NOT IN (1, 2) THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'runda_invalida', 'tichet_id', p_tichet_id, 'runda', p_runda);
  END IF;
  IF p_versiune_context IS NULL OR p_versiune_context !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'versiune_context_lipsa', 'tichet_id', p_tichet_id);
  END IF;
  SELECT x.id, x.numar_tichet, x.deschis_de INTO t FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'tichet_inexistent', 'tichet_id', p_tichet_id);
  END IF;
  -- revenirea concurentă: după lock, protocolul trebuie să fie încă instalat (altfel nimic nu se scrie)
  IF to_regprocedure('public.fn_tichet_clarificare_trimite(bigint,integer,text[],text)') IS NULL THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'protocol_retras', 'tichet_id', p_tichet_id);
  END IF;
  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);
  IF (s ->> 'eligibil')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neeligibil', 'detaliu', s ->> 'motiv', 'tichet_id', p_tichet_id);
  END IF;
  IF s ->> 'actiune' = 'incoerent' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'stare_incoerenta', 'detaliu', s ->> 'detaliu', 'tichet_id', p_tichet_id);
  END IF;
  -- deduplicarea: runda cerută e deja trimisă (oricare ar fi întrebările sau contextul de acum: reluarea după un timeout)
  IF p_runda <= (s ->> 'runda')::integer THEN
    SELECT x.* INTO e FROM public.tichete_clarificari x WHERE x.tichet_id = t.id AND x.fel = 'runda' AND x.runda = p_runda;
    RETURN jsonb_build_object('rezultat', 'deja_trimis', 'tichet_id', p_tichet_id, 'runda', p_runda,
      'comentariu_id', e.comentariu_id, 'notificare_id', e.notificare_id);
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
  -- firul evaluat de rutină trebuie să fie exact cel de acum (recalculat sub lock)
  IF (s ->> 'versiune_context') IS DISTINCT FROM p_versiune_context THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'context_schimbat', 'tichet_id', p_tichet_id);
  END IF;
  v_motiv := public.fn_tichet_clarificare_intrebari_motiv(p_intrebari);
  IF v_motiv IS NOT NULL THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'intrebari_invalide', 'detaliu', v_motiv, 'tichet_id', p_tichet_id);
  END IF;
  -- instantaneul comentariilor autorului de acum (sub lock): ce apare după el e răspuns la această rundă
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}') INTO v_inst FROM public.tichete_comentarii c WHERE c.tichet_id = t.id AND c.autor = t.deschis_de;
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
  -- evidența: un rând nou; cheia (tichet, fel, rundă) refuză a doua scriere a aceleiași runde (excepție = totul anulat)
  INSERT INTO public.tichete_clarificari (tichet_id, fel, runda, comentariu_id, notificare_id, nr_intrebari, autor_tichet, instantaneu_autor, versiune_context)
  VALUES (t.id, 'runda', p_runda, v_com, v_not, cardinality(p_intrebari), t.deschis_de, v_inst, p_versiune_context);
  RETURN jsonb_build_object('rezultat', 'trimis', 'tichet_id', t.id, 'runda', p_runda, 'comentariu_id', v_com, 'notificare_id', v_not);
END $f$;

-- ── încheierea: 'tacere' / 'neclar' = mesajul de încheiere + notificare; 'clarificat' = doar rândul de evidență. Atomică, deduplicată ──
CREATE FUNCTION public.fn_tichet_clarificare_incheie(p_tichet_id bigint, p_motiv text, p_versiune_context text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
-- Ordinea lock-urilor (L06): ca la trimitere — rândul tichetului (FOR NO KEY UPDATE) -> comentariul -> notificarea -> rândul de evidență.
-- Condițiile, din starea calculată sub lock (aceeași definiție ca lista rutinei):
--   tacere     = după runda 1 sau 2, fără răspunsul autorului, pragul de zile lucrătoare atins (acțiunea de_escaladat_tacere);
--   neclar     = după runda 2, cu răspunsul autorului (acțiunea de_evaluat_raspuns), evaluat insuficient de rutină;
--   clarificat = clar de la început (runda 0) sau după un răspuns al autorului: fără mesaj, fără notificare (tichetul merge mai departe).
-- Cel mult o încheiere pe tichet (indexul unic): al doilea apel = deja_incheiat, cu motivul primului. Tichetul nu se modifică.
DECLARE
  t record;
  s jsonb;
  e public.tichete_clarificari%ROWTYPE;
  v_txt text;
  v_com public.tichete_comentarii.id%TYPE;
  v_not public.notifications.id%TYPE;
  v_inst bigint[];
BEGIN
  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'apelant_nepermis', 'tichet_id', p_tichet_id);
  END IF;
  IF p_motiv IS NULL OR p_motiv NOT IN ('tacere', 'neclar', 'clarificat') THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'motiv_invalid', 'tichet_id', p_tichet_id);
  END IF;
  IF p_versiune_context IS NULL OR p_versiune_context !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'versiune_context_lipsa', 'tichet_id', p_tichet_id);
  END IF;
  SELECT x.id, x.numar_tichet, x.deschis_de INTO t FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'tichet_inexistent', 'tichet_id', p_tichet_id);
  END IF;
  IF to_regprocedure('public.fn_tichet_clarificare_incheie(bigint,text,text)') IS NULL THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'protocol_retras', 'tichet_id', p_tichet_id);
  END IF;
  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);
  IF (s ->> 'eligibil')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neeligibil', 'detaliu', s ->> 'motiv', 'tichet_id', p_tichet_id);
  END IF;
  IF s ->> 'actiune' = 'incoerent' THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'stare_incoerenta', 'detaliu', s ->> 'detaliu', 'tichet_id', p_tichet_id);
  END IF;
  -- deduplicarea, înaintea comparației contextului (reluarea după un timeout)
  IF s ->> 'faza' IN ('incheiat', 'clarificat') THEN
    SELECT x.* INTO e FROM public.tichete_clarificari x WHERE x.tichet_id = t.id AND x.fel IN ('incheiere', 'clarificat');
    RETURN jsonb_build_object('rezultat', 'deja_incheiat', 'tichet_id', p_tichet_id,
      'motiv_incheiere', CASE WHEN e.fel = 'clarificat' THEN 'clarificat' ELSE e.motiv END, 'comentariu_id', e.comentariu_id);
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
  IF (s ->> 'versiune_context') IS DISTINCT FROM p_versiune_context THEN
    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'context_schimbat', 'tichet_id', p_tichet_id);
  END IF;
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}') INTO v_inst FROM public.tichete_comentarii c WHERE c.tichet_id = t.id AND c.autor = t.deschis_de;
  IF p_motiv = 'clarificat' THEN
    INSERT INTO public.tichete_clarificari (tichet_id, fel, runda, autor_tichet, instantaneu_autor, versiune_context)
    VALUES (t.id, 'clarificat', (s ->> 'runda')::integer, t.deschis_de, v_inst, p_versiune_context);
  ELSE
    v_txt := 'Clarificările automate s-au încheiat. Tichetul rămâne deschis și ajunge la conducere împreună cu discuția. '
          || 'Acest mesaj nu confirmă implementarea sau un termen.' || chr(10) || 'Echipa ERP';
    INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt) RETURNING id INTO v_com;
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    VALUES (t.deschis_de, 'info', 'Tichete', 'ℹ️ Clarificări încheiate la tichetul ' || coalesce(t.numar_tichet, '#' || t.id),
            'Tichetul rămâne deschis și ajunge la conducere împreună cu discuția.', '/tichete?id=' || t.id)
    RETURNING id INTO v_not;
    INSERT INTO public.tichete_clarificari (tichet_id, fel, runda, motiv, comentariu_id, notificare_id, autor_tichet, instantaneu_autor, versiune_context)
    VALUES (t.id, 'incheiere', (s ->> 'runda')::integer, p_motiv, v_com, v_not, t.deschis_de, v_inst, p_versiune_context);
  END IF;
  RETURN jsonb_build_object('rezultat', 'incheiat', 'tichet_id', t.id, 'motiv_incheiere', p_motiv, 'comentariu_id', v_com, 'notificare_id', v_not);
END $f$;

-- ── lista rutinei, DOAR citire: fiecare tichet eligibil, cu starea, acțiunea și versiune_context; completă, ordine stabilă (created_at, id) ──
-- Apelant nepermis = EROARE (42501), nu listă goală (L18).
CREATE FUNCTION public.fn_tichet_clarificare_stare()
RETURNS TABLE (tichet_id bigint, numar_tichet text, status text, subcategorie text, creat_la timestamptz, runda integer, faza text,
               ultim_automat_id bigint, ultim_automat_la timestamptz, raspuns_autor boolean, ultim_raspuns_autor_la timestamptz,
               zile_lucratoare integer, prag_tacere integer, actiune text, raspuns_dupa_incheiere boolean, detaliu text, versiune_context text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN
    RAISE EXCEPTION 'clarificari: apelant nepermis' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT (z.s ->> 'tichet_id')::bigint, z.s ->> 'numar_tichet', z.s ->> 'status', z.s ->> 'subcategorie', (z.s ->> 'creat_la')::timestamptz,
         (z.s ->> 'runda')::integer, z.s ->> 'faza', (z.s ->> 'ultim_automat_id')::bigint, (z.s ->> 'ultim_automat_la')::timestamptz,
         (z.s ->> 'raspuns_autor')::boolean, (z.s ->> 'ultim_raspuns_autor_la')::timestamptz, (z.s ->> 'zile_lucratoare')::integer,
         (z.s ->> 'prag_tacere')::integer, z.s ->> 'actiune', (z.s ->> 'raspuns_dupa_incheiere')::boolean, z.s ->> 'detaliu', z.s ->> 'versiune_context'
    FROM public.tichete x
    CROSS JOIN LATERAL (SELECT public.fn_tichet_clarificare_stare_tichet(x.id) AS s) z
   WHERE (z.s ->> 'eligibil')::boolean IS TRUE
   ORDER BY x.created_at, x.id;
END $f$;

-- drepturile, explicit: NIMENI în afara proprietarului (implicitele schemei dau EXECUTE tuturor)
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_intrebari_motiv(text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_apelant_ok() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_context(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_stare_tichet(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[], text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_incheie(bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tichet_clarificare_stare() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[], text) IS 'Clarificări automate pe tichetele din butonul de raportare: runda 1 / 2 (comentariu „Echipa ERP” fără autor + notificare + rând în tichete_clarificari), idempotentă pe (tichet, rundă), cu versiunea contextului. Doar sesiunile postgres ale serverului (fără SET ROLE). 20261223a.';
COMMENT ON FUNCTION public.fn_tichet_clarificare_incheie(bigint, text, text) IS 'Clarificări automate: încheierea (tacere / neclar = mesaj + notificare; clarificat = doar evidența), deduplicată, cu versiunea contextului. Tichetul nu se modifică. 20261223a.';
COMMENT ON FUNCTION public.fn_tichet_clarificare_stare() IS 'Clarificări automate: starea tichetelor eligibile pentru rutina zilnică (doar citire; prag tăcere 3 zile lucrătoare; versiune_context). 20261223a.';

-- ── postcondiții ──
DO $post$
DECLARE r record; v_alt text; v_rol text; v_drept text;
BEGIN
  -- funcțiile: limbaj, DEFINER, volatilitate, search_path fix, proprietar postgres, tipul întors; drepturi EXACT „postgres:EXECUTE”
  -- (fără PUBLIC); EXECUTE pentru niciun rol din API (fiecare rol verificat separat)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz)', 'sql', false, 's', 'integer'),
      ('public.fn_tichet_clarificare_intrebari_motiv(text[])', 'sql', false, 'i', 'text'),
      ('public.fn_tichet_clarificare_apelant_ok()', 'sql', false, 's', 'boolean'),
      ('public.fn_tichet_clarificare_context(bigint)', 'sql', false, 's', 'text'),
      ('public.fn_tichet_clarificare_stare_tichet(bigint)', 'plpgsql', false, 's', 'jsonb'),
      ('public.fn_tichet_clarificare_trimite(bigint, integer, text[], text)', 'plpgsql', true, 'v', 'jsonb'),
      ('public.fn_tichet_clarificare_incheie(bigint, text, text)', 'plpgsql', true, 'v', 'jsonb'),
      ('public.fn_tichet_clarificare_stare()', 'plpgsql', true, 's', 'record')
    ) v(fn, limbaj, definer, volatil, intoarce) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile::text = r.volatil
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.prorettype = r.intoarce::regtype
                      AND (SELECT string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ', ')
                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) = 'postgres:EXECUTE') THEN
      RAISE EXCEPTION '20261223a post: functia % (limbaj / definer / volatil / search_path / owner / tip / drepturi)', r.fn;
    END IF;
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_rol, to_regprocedure(r.fn), 'EXECUTE') THEN
        RAISE EXCEPTION '20261223a post: % poate rula %', v_rol, r.fn;
      END IF;
    END LOOP;
  END LOOP;
  -- L15: funcțiile NOI cheamă (aceeași regulă de nume ca închiderea) DOAR una pe alta, și nimic dinamic; exact 8
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%'
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND NOT (p2.pronamespace = 'public'::regnamespace AND p2.proname LIKE 'fn\_tichet\_clarificare\_%');
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%'
                  AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '\mexecute\M')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%') <> 8 THEN
    RAISE EXCEPTION '20261223a post: functiile noi cheama in afara lor: %', coalesce(v_alt, 'EXECUTE dinamic / numar de functii');
  END IF;
  -- tabelul de evidență: proprietar postgres, RLS activ fără FORCE, gol, fără triggere, o singură politică (SELECT, authenticated,
  -- auth.uid() IS NOT NULL, PERMISSIVE), fără drepturi pe coloane, fără PUBLIC
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.tichete_clarificari'::regclass AND c.relkind = 'r'
                   AND pg_get_userbyid(c.relowner) = 'postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
     OR EXISTS (SELECT 1 FROM public.tichete_clarificari)
     OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.tichete_clarificari'::regclass AND NOT tg.tgisinternal)
     OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = 'public.tichete_clarificari'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.tichete_clarificari'::regclass
                      AND pol.polname = 'tichete_clarificari_select' AND pol.polcmd = 'r' AND pol.polpermissive
                      AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                      AND pg_get_expr(pol.polqual, pol.polrelid) = '(auth.uid() IS NOT NULL)')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.tichete_clarificari'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) e WHERE c.oid = 'public.tichete_clarificari'::regclass AND e.grantee = 0) THEN
    RAISE EXCEPTION '20261223a post: tabelul tichete_clarificari (proprietar / RLS / gol / triggere / politica / drepturi)';
  END IF;
  -- drepturile pe tabel, pe FIECARE rol și FIECARE drept separat (has_table_privilege cu listă = oricare): doar SELECT pentru authenticated
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_drept IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege(v_rol, 'public.tichete_clarificari'::regclass, v_drept) IS DISTINCT FROM (v_rol = 'authenticated' AND v_drept = 'SELECT') THEN
        RAISE EXCEPTION '20261223a post: drept % pe tichete_clarificari pentru % (asteptat %)', v_drept, v_rol, (v_rol = 'authenticated' AND v_drept = 'SELECT');
      END IF;
    END LOOP;
  END LOOP;
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
