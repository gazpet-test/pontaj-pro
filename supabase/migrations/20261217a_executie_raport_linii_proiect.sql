-- Version 20261217120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid).
-- 20261217a_executie_raport_linii_proiect — Raportul zilnic: liniile raportului (raport_lucrari) se scriu DOAR cu proiectul pe care îl are
-- șantierul raportului în momentul scrierii, citit sub lock-ul rândului șantierului (tichet de integritate din review-ul 20261216a r5).
--
-- Defectul (analiza: docs/RAPORT_LINII_PROIECT.md; reprodus: scripts/test_executie_raport_linii_proiect.sql T1, scripts/raport_linii_proiect_concurenta.sh L1–L2):
--   fn_raport_zilnic_salveaza (20261208a) citește proiectul șantierului FĂRĂ lock (pasul 1), validează activitățile / obiectele pe el (pasul 5)
--   și scrie liniile cu el (pasul 7). Garda rezumatului (20261216a) ia rândul șantierului FOR SHARE abia la scrierea antetului (pasul 6), deci
--   DUPĂ citire. O mutare a șantierului în alt proiect comisă între pasul 1 și pasul 6 lasă liniile pe proiectul VECHI, pe un raport al cărui
--   șantier e deja în proiectul NOU (rezumatul, compus sub lock, filtrează exact liniile acelea). După 20261216a fereastra rămâne deschisă pentru:
--     * raportul NOU (mutarea nu are ce rând de raport să încerce cu NOWAIT);
--     * raportul existent fără rezumat (NULL = salvat înainte de 20261216a) sau 'de_recompus' (mutarea nu-l atinge, deci nu-l încearcă);
--   și e ÎNCHISĂ pentru raportul existent cu rezumat 'automat' / 'editat' (mutarea încearcă rândul raportului ținut FOR UPDATE de salvare,
--   NOWAIT: refuz 55P03, salvarea trece pe proiectul vechi, care rămâne și al șantierului).
--   Căile directe (INSERT în raport_lucrari ca postgres / service_role, sau ca authenticated cât 20261208b nu e aplicată) nu iau niciun lock.
--
-- Ce face (schimbarea minimă, fără să atingă RPC-ul): UN trigger BEFORE INSERT OR UPDATE OF raport_id, proiect_id pe raport_lucrari
--   (trg_raport_lucrari_zz_proiect -> fn_raport_lucrari_proiect_garda, SECURITY DEFINER, fără EXECUTE pentru nimeni). Pe ORICE cale (L07):
--   rândul raportului FOR SHARE -> rândul șantierului lui FOR SHARE (ținute până la COMMIT; aceeași ordine ca garda rezumatului: raport ->
--   șantier) -> proiectul citit sub lock; linia trece doar dacă proiect_id-ul ei = acest proiect, iar activitatea și obiectul ei (dacă sunt) sunt
--   ale lui. Altfel refuz 22023 („reîncarcă raportul”), nimic scris (RPC-ul e o tranzacție: antet + linii + jurnal se anulează împreună).
--   În RPC proiectul liniilor e cel citit la pasul 1; trigger-ul îl compară cu cel citit sub lock: egale = salvarea normală, neschimbată;
--   diferite = exact fereastra de mai sus -> refuz (la reîncercare RPC-ul citește proiectul nou și refuză activitățile vechi cu mesajul lui).
--   UPDATE care nu schimbă raport_id / proiect_id (cantitatea, observațiile, SET NULL pe obiect din cheia străină): neverificat, fără lock —
--   liniile ISTORICE ale unui șantier mutat legitim (scrise cât era în proiectul vechi) rămân valide și editabile.
-- De ce NU se schimbă fn_raport_zilnic_salveaza: corpul lui e amprentat în inventarul 20261209a (aplicată) și în baseline-ul 20261216a; o altă
--   versiune ar face inventarul de acces să mintă. Trigger-ul acoperă în plus căile directe, pe care RPC-ul nu le vede.
-- Concurența (L06): ordinea pe toate căile = rândul raportului -> rândul șantierului.
--   * RPC: raportul e deja ținut FOR UPDATE (pasul 1) sau tocmai inserat, șantierul deja ținut FOR SHARE de garda rezumatului (pasul 6), deci
--     trigger-ul nu adaugă nicio așteptare; FOR SHARE-urile mai multor salvări sunt compatibile.
--   * Mutarea (UPDATE sites, 20261216a) ține rândul șantierului și încearcă rapoartele DOAR cu NOWAIT: o linie scrisă direct care ține raportul
--     FOR SHARE o face să refuze imediat (55P03), niciodată să aștepte; o linie scrisă în timpul mutării așteaptă rândul șantierului, apoi citește
--     proiectul NOU și refuză. Niciun ciclu.
--   * REPEATABLE READ / SERIALIZABLE: șantierul mutat după imaginea tranzacției = 40001 la FOR SHARE (nimic scris pe proiectul din imagine).
-- Ce NU face: nicio dată (liniile existente rămân; numărarea lor: scripts/raport_linii_proiect_verifica_date.sql, DOAR citire), niciun drept,
--   nicio politică, nimic pe rapoarte_zilnice / sites / raport_distributie_linii (distribuția: tronsonul e verificat de trigger-ul 20261027a
--   pe proiectul de acum al șantierului, după garda rezumatului în RPC, deci consecvent pe calea RPC; calea directă: docs/RAPORT_LINII_PROIECT.md).
-- Dependențe: 20261208a (fn_raport_zilnic_salveaza cu corpul revizuit c9c6…, coloanele raport_lucrari). 20261216a nu e cerută (trigger-ul își ia
--   singur lock-urile), dar e în baseline-ul L15 de pe producție.
--
-- L15 (tiparul 20261216a, corpul AMPRENTA_L15 v1 IDENTIC, L19; testul src/raportLiniiProiectAmprente.test.js): amprenta COMPLETĂ a stării de acces
--   a tabelelor raport_lucrari, rapoarte_zilnice și sites (drepturi pe tabel / coloane / secvențe, proprietar, RLS + FORCE, toate politicile,
--   inventarul triggerelor) și a funcțiilor din BASELINE (pornirea: fn_raport_zilnic_salveaza, singura cale a aplicației care scrie liniile, cu
--   callee-urile ei; plus funcțiile din politicile / triggerele celor trei tabele, găsite de catalog), comparată cu BASELINE-ul din producție
--   ÎNAINTE și DUPĂ. Valorile le scoate coordonatorul cu scripts/raport_linii_proiect_amprente.sql (tranzacție READ ONLY) în blocul marcat;
--   necompletat = refuz. „După” = baseline-ul exact, cu DOUĂ excepții declarate: inventarul triggerelor lui raport_lucrari are în plus EXACT
--   triggerul nou (restul liniilor, octet cu octet, ca înainte) și lista de funcții are în plus EXACT fn_raport_lucrari_proiect_garda()
--   (proprietățile ei: postcondițiile).
--
-- Livrare: DOAR cu plafon — scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000 (fără plafon = refuz în $pre$).
--   Lock-uri (L06, ordinea salvării: rapoarte_zilnice -> sites -> raport_lucrari), luate DUPĂ verificările de catalog, NOWAIT, reîncercate la
--   50 ms până la 1 s de la BEGIN (peste = 55P03, nimic schimbat): rapoarte_zilnice și sites SHARE UPDATE EXCLUSIVE (NU opresc nici citirile,
--   nici salvările — doar DDL-ul pe ele: trigger / politică / index, ca amprenta „după” să rămână adevărată până la COMMIT), apoi raport_lucrari
--   SHARE ROW EXCLUSIVE (cerut de CREATE TRIGGER: o salvare care ajunge la linii așteaptă cât catalogul de după, sub plafon). lock_timeout 100 ms.
--   Sub lock DOAR catalog: o funcție, un trigger, postcondițiile, amprenta „după”. Se MĂSOARĂ pe clonă cu runnerul (NOTICE-urile „20261217a:
--   lock-uri la X ms … sfarsit la Y ms”); țintă Y < 1000; Y ≥ 1500 = nu se aplică.
-- Revenire: supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql (tot prin runner, cu --plafon-tranzactie-ms 2000).
-- Probe: scripts/test_executie_raport_linii_proiect.sql (clonă, tranzacție anulată) + scripts/pglite/test_raport_linii_proiect_local.mjs (local)
--   + scripts/raport_linii_proiect_concurenta.sh (clonă, sesiuni reale, cu --mutant).
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261217a_executie_raport_linii_proiect:' || txid_current() THEN
    RAISE EXCEPTION '20261217a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261217a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261217a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- plafonul total = ceasul de tranzacție PostgreSQL 17, pus de runner înainte de BEGIN (sursa 'session'), citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261217a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261217a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regprocedure('public.fn_raport_lucrari_proiect_garda()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_raport_lucrari_zz_proiect') THEN
    RAISE EXCEPTION '20261217a: obiectele exista deja (reaplicare)';
  END IF;
  -- 20261208a aplicată, cu corpul revizuit al salvării (analiza de mai sus e pe EXACT acest corp; sursa amprentei: repo-ul)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)')
                   AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND md5(replace(p.prosrc, chr(13), '')) = 'c9c6b6b3d27f14fe29712196b7f23e2c') THEN
    RAISE EXCEPTION '20261217a: 20261208a nu e aplicata sau RPC-ul de salvare difera de corpul analizat';
  END IF;
  -- coloanele citite de trigger, cu tipurile acceptate (ce diferă oprește migrarea)
  FOR r IN SELECT * FROM (VALUES
      ('raport_lucrari', 'raport_id', 'bigint'), ('raport_lucrari', 'proiect_id', 'integer|bigint'),
      ('raport_lucrari', 'activitate_id', 'integer|bigint'), ('raport_lucrari', 'unitate_id', 'integer|bigint'),
      ('rapoarte_zilnice', 'id', 'bigint'), ('rapoarte_zilnice', 'site_id', 'integer|bigint'),
      ('sites', 'id', 'integer|bigint'), ('sites', 'proiect_id', 'integer|bigint'),
      ('proiect_activitati', 'id', 'integer|bigint'), ('proiect_activitati', 'proiect_id', 'integer|bigint'),
      ('proiect_unitati', 'id', 'integer|bigint'), ('proiect_unitati', 'proiect_id', 'integer|bigint')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261217a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- trigger-ul nostru compară rândul DUPĂ celelalte trigger-e BEFORE: niciun trigger BEFORE ROW nu rulează după el (ordinea = numele, colația C)
  SELECT string_agg(tg.tgname, ', ') INTO v_tip FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.raport_lucrari'::regclass AND NOT tg.tgisinternal AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 1) = 1
     AND tg.tgname::text COLLATE "C" > 'trg_raport_lucrari_zz_proiect' COLLATE "C";
  IF v_tip IS NOT NULL THEN
    RAISE EXCEPTION '20261217a: trigger-e BEFORE ROW necunoscute dupa garda pe raport_lucrari: %', v_tip;
  END IF;
END $pre$;

-- ── L15: amprenta COMPLETĂ a stării de acces, verificată ÎNAINTE și DUPĂ schimbare (tiparul 20261216a) ──
-- >>> BASELINE 20261217a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/raport_linii_proiect_amprente.sql, copiată
--     ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261217a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('functie auth.jwt()', '0a339ea1d249a021248f635d6afb9687')
    , ('functie auth.uid()', '547eb1864858f1efce909a735a04d521')
    , ('functie fn_auto_create_executie_proiect()', '65ba246342e6d1594eed6152298e5c3d')
    , ('functie fn_executie_acces_garda()', '5998bcdffae1465dd9340b09e5eb1703')
    , ('functie fn_executie_acces_garda_copil()', '4344ff23cd4110f4c7f02e10d9e65704')
    , ('functie fn_executie_acces_lista(boolean)', '8dae19e2f5e53aeaec7d4a7d360f046b')
    , ('functie fn_executie_acces_lista_cont(uuid,boolean)', '4f382e2182a748dd9790e9f65f9cd9a5')
    , ('functie fn_executie_acces_nerestrans()', '53dbf0d75d3f7f5d17747fef20b674a7')
    , ('functie fn_executie_acces_nerestrans_cont(uuid)', 'bba2d110bb9df2b16d9239156f3b3607')
    , ('functie fn_executie_acces_parinte_permis(text,bigint,boolean)', 'eb20270866ad8d939d1f1078bacd0997')
    , ('functie fn_executie_acces_proprii_citire()', '0b22d050c5991fcf163f5149b768760e')
    , ('functie fn_executie_acces_proprii_scriere()', '3936848939fd2aede49be5d992171f06')
    , ('functie fn_executie_proiect_permis(bigint,boolean)', 'bb8d39285aee035d640af6f7371e5476')
    , ('functie fn_raport_distributie_salveaza(bigint,jsonb)', 'a20c8c6c286b39cb234ece5348ed4346')
    , ('functie fn_raport_lucrari_amprenta_linii(jsonb)', '1e02fe0a2cc17f19618ad252df1d1508')
    , ('functie fn_raport_lucrari_json(bigint)', '43c3306824a4c7e6ac3fde5ca84f704e')
    , ('functie fn_raport_rezumat_curata(text)', 'dc38d2661be6fea5039d6ee5376c4079')
    , ('functie fn_raport_rezumat_curata_editat(text)', 'f22c7b6ed5919d84988b503ff77c8143')
    , ('functie fn_raport_rezumat_garda()', '1a7e1608ea8e1b249303274365f7dd68')
    , ('functie fn_raport_rezumat_intrare(rapoarte_zilnice)', '3578027491335267318adebb14f625df')
    , ('functie fn_raport_rezumat_nr(jsonb)', '7a9510230fe9bd0058fef2fd962de440')
    , ('functie fn_raport_rezumat_santier_mutat()', '82f2117eeaf0f3558ad8ee032ba0c115')
    , ('functie fn_raport_rezumat_sir(jsonb,text)', '2a1afff8324c3547b9cf4542294ec9e8')
    , ('functie fn_raport_rezumat_taie(text,integer)', '1ed749cfe65fe14353dc4b804d36e163')
    , ('functie fn_raport_rezumat_text(jsonb)', '372254c39d073a93684b46347484a64b')
    , ('functie fn_raport_santier_drept(bigint)', '0d759c83376de45804392f28353a370d')
    , ('functie fn_raport_zilnic_salveaza(bigint,date,jsonb,jsonb,jsonb,integer,uuid)', 'e3ab72f918a8c8a99bd655a4dd3c1386')
    , ('functie fn_raport_zilnic_versiune()', 'e86174ecabbbea46f897842626089602')
    , ('functie fn_site_name_to_cod_intern(text)', '90576f5e637d8bdf9bd5873d50bcbf9a')
    , ('tabel rapoarte_zilnice | acl', '565553b4fd23bff3761a45bfba76d27c')
    , ('tabel rapoarte_zilnice | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel rapoarte_zilnice | politici', '0b44f3ed9a1b5b3b92e65027716ac55e')
    , ('tabel rapoarte_zilnice | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel rapoarte_zilnice | secvente', 'a16ae5a66e83dcdefa56f139b4521258')
    , ('tabel rapoarte_zilnice | triggere', 'a6c092a13047bcc9bea08a4c24285911')
    , ('tabel raport_lucrari | acl', 'ab2fa556bebf1b95359b0de005bfed8d')
    , ('tabel raport_lucrari | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel raport_lucrari | politici', '3896f45fe3d0701c62ff2ac74fab9937')
    , ('tabel raport_lucrari | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel raport_lucrari | secvente', 'dc376549dbffaa81c0cb4d4989a229ba')
    , ('tabel raport_lucrari | triggere', '4e26ced98e644b31a08aa058f9999a9b')
    , ('tabel sites | acl', '565553b4fd23bff3761a45bfba76d27c')
    , ('tabel sites | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel sites | politici', '40efb11aeae2999fe40956b624c430e0')
    , ('tabel sites | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel sites | secvente', 'fdda94678348628259941ebf2c046662')
    , ('tabel sites | triggere', '2ef41238382060ca040278abe22629de')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261217a
CREATE FUNCTION pg_temp.amp_calc_20261217a() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH
amp_tabele(oid) AS (VALUES ('public.raport_lucrari'::regclass::oid), ('public.rapoarte_zilnice'::regclass::oid), ('public.sites'::regclass::oid)),
amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_20261217a() b WHERE b.eticheta LIKE 'functie %'),
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
-- „înainte”: exact baseline-ul. „după”: exact baseline-ul, cu cele două excepții declarate în antet (triggerul nou + funcția lui).
CREATE FUNCTION pg_temp.amp_verifica_20261217a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261217a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261217a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261217a: baseline L15 necompletat sau invalid (scripts/raport_linii_proiect_amprente.sql)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261217a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261217a: baseline L15 cu etichete duble';
  END IF;
  WITH calc AS (
    SELECT c.eticheta,
           CASE
             -- inventarul triggerelor lui raport_lucrari DUPĂ: fără linia triggerului nou (exact una, activă, cu funcția noastră), restul = înainte
             WHEN p_moment = 'dupa' AND c.eticheta = 'tabel raport_lucrari | triggere' THEN
               CASE WHEN (SELECT count(*) FROM unnest(string_to_array(c.detaliu, chr(10))) l WHERE l LIKE 'trg\_raport\_lucrari\_zz\_proiect | %') = 1
                         AND (SELECT count(*) FROM unnest(string_to_array(c.detaliu, chr(10))) l
                               WHERE l LIKE 'trg\_raport\_lucrari\_zz\_proiect | fn\_raport\_lucrari\_proiect\_garda() | stare=O | %') = 1
                    THEN md5(coalesce(nullif((SELECT string_agg(u.l, chr(10) ORDER BY u.o)
                                                FROM unnest(string_to_array(c.detaliu, chr(10))) WITH ORDINALITY u(l, o)
                                               WHERE u.l NOT LIKE 'trg\_raport\_lucrari\_zz\_proiect | %'), ''), '(fara triggere)'))
                    ELSE 'triggerul nou lipseste / e dublat / oprit' END
             ELSE c.amprenta END AS amprenta
      FROM pg_temp.amp_calc_20261217a() c
     -- funcția triggerului nou există doar DUPĂ (proprietățile ei: postcondițiile)
     WHERE NOT (p_moment = 'dupa' AND c.eticheta = 'functie fn_raport_lucrari_proiect_garda()')
  )
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM calc c FULL JOIN pg_temp.amp_baseline_20261217a() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261217a: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM pg_temp.amp_calc_20261217a() c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261217a: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261217a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06, ordinea salvării), după verificările de catalog; NOWAIT + reîncercare până la 1 s de la BEGIN ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.rapoarte_zilnice IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;   -- doar DDL-ul oprit (amprenta „după” rămâne adevărată)
      LOCK TABLE public.sites IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.raport_lucrari IN SHARE ROW EXCLUSIVE MODE NOWAIT;        -- cerut de CREATE TRIGGER
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261217a: BUGET_LOCK: rapoarte_zilnice / sites / raport_lucrari ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261217a: lock-uri la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── garda liniilor: proiectul liniei = proiectul șantierului raportului, citit sub lock, pe ORICE cale de scriere (L07) ──
-- DEFINER: citește și blochează rândul raportului / șantierului oricare ar fi RLS-ul și drepturile celui care scrie (FOR SHARE cere drept de
-- modificare pe tabel). Nu e apelabilă din API (trigger, fără EXECUTE). Ce trimite clientul nu se schimbă: linia trece întocmai sau e refuzată.
-- Ordinea lock-urilor (L06): rândul raportului (FOR SHARE) -> rândul șantierului (FOR SHARE), ținute până la COMMIT; aceeași ordine ca garda
--   rezumatului (20261216a) și ca RPC-ul de salvare (care le ține deja pe amândouă când ajunge la linii). Activitatea / obiectul: doar citite
--   (RPC-ul le ține FOR SHARE din pasul 5; cheia străină a liniei ia oricum FOR KEY SHARE pe ele).
CREATE FUNCTION public.fn_raport_lucrari_proiect_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_site bigint; v_proiect bigint; v_p bigint;
BEGIN
  -- UPDATE care nu mută linia (alt raport / alt proiect): neverificat, fără lock (liniile istorice ale unui șantier mutat rămân editabile)
  IF TG_OP = 'UPDATE' AND NEW.raport_id IS NOT DISTINCT FROM OLD.raport_id AND NEW.proiect_id IS NOT DISTINCT FROM OLD.proiect_id THEN
    RETURN NEW;
  END IF;
  -- 1. rândul raportului: șantierul lui nu se mai schimbă până la COMMIT (în RPC: rândul e deja al nostru)
  SELECT r.site_id INTO v_site FROM public.rapoarte_zilnice r WHERE r.id = NEW.raport_id FOR SHARE OF r;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- raport inexistent: refuzul îl dă cheia străină (23503)
  -- 2. proiectul șantierului, sub lock: o mutare în zbor e așteptată (READ COMMITTED: se citește proiectul nou), una ulterioară așteaptă COMMIT-ul
  SELECT s.proiect_id INTO v_proiect FROM public.sites s WHERE s.id = v_site FOR SHARE OF s;
  IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN
    RAISE EXCEPTION 'raport: linia e pentru proiectul %, dar șantierul raportului e acum în alt proiect (%); reîncarcă raportul și salvează din nou',
      coalesce(NEW.proiect_id::text, '-'), coalesce(v_proiect::text, 'fără proiect') USING ERRCODE = '22023';
  END IF;
  -- 3. activitatea și obiectul liniei: ale aceluiași proiect (inexistente: refuzul îl dă cheia străină)
  IF NEW.activitate_id IS NOT NULL THEN
    SELECT pa.proiect_id INTO v_p FROM public.proiect_activitati pa WHERE pa.id = NEW.activitate_id;
    IF FOUND AND v_p IS DISTINCT FROM v_proiect THEN
      RAISE EXCEPTION 'raport: activitatea % nu e a proiectului șantierului raportului', NEW.activitate_id USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.unitate_id IS NOT NULL THEN
    SELECT pu.proiect_id INTO v_p FROM public.proiect_unitati pu WHERE pu.id = NEW.unitate_id;
    IF FOUND AND v_p IS DISTINCT FROM v_proiect THEN
      RAISE EXCEPTION 'raport: obiectul % nu e al proiectului șantierului raportului', NEW.unitate_id USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_lucrari_proiect_garda() FROM PUBLIC, anon, authenticated, service_role;
-- „zz”: ultimul trigger BEFORE pe raport_lucrari (ordinea numelui) — compară rândul final
CREATE TRIGGER trg_raport_lucrari_zz_proiect BEFORE INSERT OR UPDATE OF raport_id, proiect_id ON public.raport_lucrari
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_lucrari_proiect_garda();

-- ── postcondiții ──
DO $post$
BEGIN
  -- funcția: plpgsql, DEFINER, search_path fix, proprietar postgres, NICIUN EXECUTE (nici PUBLIC)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_raport_lucrari_proiect_garda()') AND l.lanname = 'plpgsql' AND p.prosecdef
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.prorettype = 'trigger'::regtype
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
    RAISE EXCEPTION '20261217a post: functia (definer / search_path / owner / EXECUTE)';
  END IF;
  -- trigger-ul: forma exactă (BEFORE, pe rând, INSERT + UPDATE OF raport_id, proiect_id, fără WHEN), activ, singurul cu funcția noastră, ultimul BEFORE ROW
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_lucrari'::regclass AND tg.tgname = 'trg_raport_lucrari_zz_proiect'
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
                   AND tg.tgfoid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure AND tg.tgtype = (1 | 2 | 4 | 16)
                   AND pg_get_triggerdef(tg.oid) = 'CREATE TRIGGER trg_raport_lucrari_zz_proiect BEFORE INSERT OR UPDATE OF raport_id, proiect_id '
                       || 'ON public.raport_lucrari FOR EACH ROW EXECUTE FUNCTION fn_raport_lucrari_proiect_garda()')
     OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure) <> 1
     OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_lucrari'::regclass AND NOT tg.tgisinternal
                  AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 1) = 1 AND tg.tgname::text COLLATE "C" > 'trg_raport_lucrari_zz_proiect' COLLATE "C") THEN
    RAISE EXCEPTION '20261217a post: trigger-ul';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261217a_executie_raport_linii_proiect:' || txid_current() THEN
    RAISE EXCEPTION '20261217a: garda final invalida';
  END IF;
END $post$;

-- L15: aceeași amprentă DUPĂ schimbare (cu excepțiile declarate), timpul, apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.amp_verifica_20261217a('dupa');
  RAISE NOTICE '20261217a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261217a(text), pg_temp.amp_calc_20261217a(), pg_temp.amp_baseline_20261217a();
