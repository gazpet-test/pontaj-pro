-- DRY LOCAL 20261130j + 20261130k (Redări e-mail F1, schema) — PG17 de unică folosință, NU pe producție.
-- Ordinea: 20261130j_redari_mail_f1_schelet.sql → migrarea j (marcaj de livrare) → migrarea k → ACEST fișier (o tranzacție; se anulează sau
-- se comite pe baza de unică folosință). Fixture-uri fictive: mesaje primite în toate stările, obiecte, adrese, un răspuns e-mail cu sursă.
-- Fiecare test ridică 'TESTnn FAIL: …' la prima abatere; „TESTnn OK” în NOTICE. Rolurile: owner a1, admin a2, editor a3, viewer a4,
-- fără acces a5, anon, service_role — simulate prin request.jwt.claims + SET LOCAL ROLE (ca DRY-ul 20261130i).
-- Commit-ul real al constraint trigger-ului amânat se simulează cu SET CONSTRAINTS … IMMEDIATE într-o sub-tranzacție (aceeași verificare
-- pe care o face COMMIT); runnerul local mai rulează separat un INSERT autocommit ca editor (vezi descrierea PR-ului).
SELECT set_config('lock_timeout', '2s', true);
CREATE FUNCTION pg_temp.ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- refuza: instrucțiunea pică exact cu SQLSTATE-ul dat (efectul e anulat de sub-tranzacție)
CREATE FUNCTION pg_temp.refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 'refuza: % -> a REUSIT, asteptat %', left(p_sql, 160), p_stare; RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 'refuza: % -> % (%), asteptat %', left(p_sql, 120), SQLSTATE, SQLERRM, p_stare; END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
-- accepta: instrucțiunea reușește (efectul rămâne)
CREATE FUNCTION pg_temp.accepta(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN true;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'accepta: % -> % (%)', left(p_sql, 120), SQLSTATE, SQLERRM; RETURN false;
END $h$;
-- incearca: reușește, apoi anulează efectul (sub-tranzacție forțată la final)
CREATE FUNCTION pg_temp.incearca(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  BEGIN EXECUTE p_sql; RAISE EXCEPTION USING ERRCODE = 'ZZ999';
  EXCEPTION WHEN SQLSTATE 'ZZ999' THEN RETURN true; END;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'incearca: % -> % (%)', left(p_sql, 120), SQLSTATE, SQLERRM; RETURN false;
END $h$;
CREATE FUNCTION pg_temp.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $h$
DECLARE v bigint; BEGIN EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v; RETURN v; END $h$;
-- ok: un pas secvențial, etichetat (ordinea pașilor contează: unii au efecte, iar un OR din SQL nu garantează ordinea de evaluare)
CREATE FUNCTION pg_temp.ok(p_ok boolean, p_pas text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '% FAIL', p_pas; END IF; END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.ca(uuid, text), pg_temp.refuza(text, text), pg_temp.accepta(text), pg_temp.incearca(text), pg_temp.n(text), pg_temp.ok(boolean, text) TO authenticated, anon, service_role;

-- ============================================================================ fixture (ca postgres = mentenanța; triggerele k se aplică și aici)
DO $f$
DECLARE h1 text := repeat('1', 64); h2 text := repeat('2', 64); h3 text := repeat('3', 64); h4 text := repeat('4', 64); h5 text := repeat('5', 64); h6 text := repeat('6', 64);
BEGIN
  -- m1: redari, ok, cu conținut (subiect / corp „secrete” — nu trebuie să apară în jurnal sau la viewer)
  INSERT INTO public.red_mail_primite (id, casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la, subiect, corp_text, de_la_adresa)
    VALUES ('00000000-0000-0000-0000-00000000aa01', 'redari@gazpet.ro', false, '18c0a1', h1, 1, now() - interval '2 hours', 'SUBIECT_SECRET_1', 'CORP_SECRET_1', 'cineva@exemplu.local');
  UPDATE public.red_mail_primite SET stare_ingestie = 'ok', ingestie_finalizata_la = now() WHERE id = '00000000-0000-0000-0000-00000000aa01';
  -- m2: redari, ok (asociere / înregistrare răspuns)
  INSERT INTO public.red_mail_primite (id, casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la, subiect)
    VALUES ('00000000-0000-0000-0000-00000000aa02', 'redari@gazpet.ro', false, '18c0a2', h2, 1, now() - interval '3 hours', 'SUBIECT_SECRET_2');
  UPDATE public.red_mail_primite SET stare_ingestie = 'ok', ingestie_finalizata_la = now() WHERE id = '00000000-0000-0000-0000-00000000aa02';
  -- m3: redari, neprocesabil
  INSERT INTO public.red_mail_primite (id, casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la)
    VALUES ('00000000-0000-0000-0000-00000000aa03', 'redari@gazpet.ro', false, '18c0a3', h3, 1, now() - interval '4 hours');
  UPDATE public.red_mail_primite SET stare_ingestie = 'neprocesabil', motiv_cod = 'prea_mare', ingestie_finalizata_la = now() WHERE id = '00000000-0000-0000-0000-00000000aa03';
  -- m4: căsuța de test, ok
  INSERT INTO public.red_mail_primite (id, casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la)
    VALUES ('00000000-0000-0000-0000-00000000aa04', 'redari-test@gazpet.ro', true, '18c0a1', h1, 1, now() - interval '1 hour');
  UPDATE public.red_mail_primite SET stare_ingestie = 'ok', ingestie_finalizata_la = now() WHERE id = '00000000-0000-0000-0000-00000000aa04';
  -- m5: redari, ok, legat de o corespondență (legătură juridică)
  INSERT INTO public.red_mail_primite (id, casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la)
    VALUES ('00000000-0000-0000-0000-00000000aa05', 'redari@gazpet.ro', false, '18c0a5', h5, 1, now() - interval '5 hours');
  UPDATE public.red_mail_primite SET stare_ingestie = 'ok', ingestie_finalizata_la = now(), corespondenta_id = '00000000-0000-0000-0000-00000000f001' WHERE id = '00000000-0000-0000-0000-00000000aa05';
  -- m6: redari, in_curs (manifest)
  INSERT INTO public.red_mail_primite (id, casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la)
    VALUES ('00000000-0000-0000-0000-00000000aa06', 'redari@gazpet.ro', false, '18c0a6', h6, 1, now() - interval '10 minutes');
  INSERT INTO public.red_mail_obiecte (id, primit_id, tip, nr, cale) VALUES
    ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000aa06', 'eml', 0, 'mail/redari/carantina/' || h6 || '.eml'),
    ('00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-00000000aa06', 'atasament', 1, 'mail/redari/atasamente/' || h6 || '/1');
  INSERT INTO public.red_mail_evenimente (tip, primit_id, casuta, gmail_id_hmac, numaratori) VALUES ('ingestie_ok', '00000000-0000-0000-0000-00000000aa01', 'redari@gazpet.ro', h1, '{"obiecte": 0}');
  INSERT INTO public.red_mail_evenimente (tip, casuta, numar) VALUES ('spam_numarat', 'redari@gazpet.ro', 3);
  -- un obiect real sub mail/ în Storage (îl scrie doar service_role / mentenanța)
  INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'mail/redari/carantina/' || h1 || '.eml');
  RAISE NOTICE 'fixture OK';
END $f$;

-- TEST01: starea schemei (verificatorul j) + inventarul k (postcondițiile au trecut la apply; aici se reconfirmă)
DO $t$ BEGIN
  PERFORM public.fn_red_mail_verifica_baza('dupa_j');
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND NOT tgisinternal) <> 5 THEN RAISE EXCEPTION 'TEST01 FAIL: triggere red_raspunsuri'; END IF;
  RAISE NOTICE 'TEST01 OK';
END $t$;

-- TEST02: anon nu vede nimic (nici SELECT pe tabele, nici numărătorile, nici storage mail/)
SELECT pg_temp.ca(NULL, 'anon');
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('SELECT 1 FROM public.red_mail_primite', '42501') OR NOT pg_temp.refuza('SELECT 1 FROM public.red_mail_setari', '42501')
    ), 'TEST02.1 anon');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('SELECT 1 FROM public.red_mail_oauth_state', '42501')
    ), 'TEST02.2 anon');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('SELECT * FROM public.fn_red_mail_numaratori(''00000000-0000-0000-0000-00000000b001'')', '42501')
    ), 'TEST02.3 anon');
  PERFORM pg_temp.ok(NOT (pg_temp.n('SELECT 1 FROM storage.objects WHERE bucket_id = ''redari''') <> 0
    ), 'TEST02.4 anon');
  RAISE NOTICE 'TEST02 OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST03: viewer — 0 rânduri în TOATE tabelele red_mail_* (deși există), numărătorile da (doar contoare), jurnalul red_mail_* invizibil
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a4', 'authenticated');
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_mail_setari', 'red_mail_flux', 'red_mail_primite', 'red_mail_obiecte', 'red_mail_dedup', 'red_mail_evenimente', 'red_mail_raspuns_sursa', 'red_mail_adrese_propuse'] LOOP
    IF pg_temp.n('SELECT 1 FROM public.' || t) <> 0 THEN RAISE EXCEPTION 'TEST03 FAIL: viewer vede randuri in %', t; END IF;
  END LOOP;
  IF NOT pg_temp.refuza('SELECT 1 FROM public.red_mail_oauth_state', '42501') THEN RAISE EXCEPTION 'TEST03 FAIL: viewer pe oauth_state'; END IF;
  -- m1, m2, m3, m5, m6 (fără mesajul de test)
  IF (SELECT sum(nr) FROM public.fn_red_mail_numaratori('00000000-0000-0000-0000-00000000b001')) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'TEST03 FAIL: numaratori viewer = %', (SELECT sum(nr) FROM public.fn_red_mail_numaratori('00000000-0000-0000-0000-00000000b001'));
  END IF;
  IF pg_temp.n('SELECT 1 FROM public.red_jurnal WHERE left(tabela, 9) = ''red_mail_''') <> 0 THEN RAISE EXCEPTION 'TEST03 FAIL: viewer vede jurnalul red_mail_*'; END IF;
  IF pg_temp.n('SELECT 1 FROM public.red_jurnal WHERE tabela = ''red_raspunsuri''') = 0 THEN RAISE EXCEPTION 'TEST03 FAIL: viewer nu mai vede jurnalul red_raspunsuri (regresie)'; END IF;
  IF pg_temp.n('SELECT 1 FROM storage.objects WHERE bucket_id = ''redari''') <> 0 THEN RAISE EXCEPTION 'TEST03 FAIL: viewer vede storage redari'; END IF;
  RAISE NOTICE 'TEST03 OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST04: fără acces (a5) — 0 rânduri, numărători refuzate
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a5', 'authenticated');
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (pg_temp.n('SELECT 1 FROM public.red_mail_primite') <> 0 OR pg_temp.n('SELECT 1 FROM public.red_mail_evenimente') <> 0
    ), 'TEST04.1 fara acces');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('SELECT * FROM public.fn_red_mail_numaratori(''00000000-0000-0000-0000-00000000b001'')', '42501')
    ), 'TEST04.2 fara acces');
  RAISE NOTICE 'TEST04 OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST05: editor / admin / owner VĂD, dar NU POT SCRIE direct (INSERT / UPDATE / DELETE pe fiecare tabel → 42501); editor nu vede oauth_state
DO $t$
DECLARE u uuid; t text;
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000a3'::uuid, '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1'] LOOP
    PERFORM pg_temp.ca(u, 'authenticated');
    IF pg_temp.n('SELECT 1 FROM public.red_mail_primite') <> 6 OR pg_temp.n('SELECT 1 FROM public.red_mail_flux') <> 2 OR pg_temp.n('SELECT 1 FROM public.red_mail_evenimente') <> 2 THEN
      RAISE EXCEPTION 'TEST05 FAIL: % nu vede mesajele', u;
    END IF;
    FOREACH t IN ARRAY ARRAY['red_mail_setari', 'red_mail_flux', 'red_mail_primite', 'red_mail_obiecte', 'red_mail_dedup', 'red_mail_evenimente', 'red_mail_raspuns_sursa', 'red_mail_adrese_propuse', 'red_mail_oauth_state'] LOOP
      PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('DELETE FROM public.%I', t), '42501') OR NOT pg_temp.refuza(format('UPDATE public.%I SET %2$I = %2$I', t, CASE WHEN t IN ('red_mail_flux', 'red_mail_dedup') THEN 'casuta' WHEN t = 'red_mail_evenimente' THEN 'tip' ELSE 'id' END), '42501')
        ), 'TEST05.1 ');
      PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('INSERT INTO public.%I DEFAULT VALUES', t), '42501')
        ), 'TEST05.2 ');
    END LOOP;
    PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_setari SET citire_activa = true', '42501') OR NOT pg_temp.refuza('UPDATE public.red_mail_flux SET activ = true', '42501')
      ), 'TEST05.1 ');
    PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''ignorat''', '42501') OR NOT pg_temp.refuza('SELECT 1 FROM public.red_mail_oauth_state', '42501')
      ), 'TEST05.2 ');
  END LOOP;
  PERFORM pg_temp.ca(NULL, 'postgres');
  RAISE NOTICE 'TEST05 OK';
END $t$;

-- TEST06: service_role — ocolește RLS dar NU are drepturi de scriere (toate scrierile vor fi prin RPC-uri DEFINER); citește
SELECT pg_temp.ca(NULL, 'service_role');
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (pg_temp.n('SELECT 1 FROM public.red_mail_primite') <> 6
    ), 'TEST06.1 service_role');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_evenimente (tip) VALUES (''activare'')', '42501')
    ), 'TEST06.2 service_role');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET nota = ''x''', '42501') OR NOT pg_temp.refuza('DELETE FROM public.red_mail_dedup', '42501')
    ), 'TEST06.3 service_role');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('SELECT 1 FROM public.red_mail_oauth_state', '42501')
    ), 'TEST06.4 service_role');
  RAISE NOTICE 'TEST06 OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST07: Storage mail/ — editor / admin / owner NU văd și NU urcă sub mail/; restul bucketului rămâne ca azi
DO $t$
DECLARE u uuid;
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000a3'::uuid, '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1'] LOOP
    PERFORM pg_temp.ca(u, 'authenticated');
    IF pg_temp.n('SELECT 1 FROM storage.objects WHERE bucket_id = ''redari'' AND left(name, 5) = ''mail/''') <> 0 THEN RAISE EXCEPTION 'TEST07 FAIL: % vede mail/', u; END IF;
    IF pg_temp.n('SELECT 1 FROM storage.objects WHERE bucket_id = ''redari''') <> 1 THEN RAISE EXCEPTION 'TEST07 FAIL: % nu mai vede restul bucketului', u; END IF;
    PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO storage.objects (bucket_id, name) VALUES (''redari'', ''mail/redari/carantina/' || repeat('9', 64) || '.eml'')', '42501')
      ), 'TEST07.1 ');
    PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO storage.objects (bucket_id, name) VALUES (''redari'', ''mail/x'')', '42501')
      ), 'TEST07.2 ');
    IF NOT pg_temp.incearca('INSERT INTO storage.objects (bucket_id, name) VALUES (''redari'', ''00000000-0000-0000-0000-00000000b001/convocari/c2.pdf'')') THEN
      RAISE EXCEPTION 'TEST07 FAIL: % nu mai urca in afara mail/ (regresie)', u;
    END IF;
  END LOOP;
  PERFORM pg_temp.ca(NULL, 'postgres');
  RAISE NOTICE 'TEST07 OK';
END $t$;

-- TEST08: jurnalul pe red_mail_* — doar numele câmpurilor, fără valori; id-ul doar uuid
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_mail_primite' AND inregistrare_id = '00000000-0000-0000-0000-00000000aa01')
    ), 'TEST08.1 jurnalul red_mail_* contine valori sau lipseste');
  PERFORM pg_temp.ok(NOT (EXISTS (SELECT 1 FROM public.red_jurnal WHERE left(tabela, 9) = 'red_mail_' AND (coalesce(date_noi::text, '') ~ '(SECRET|exemplu|18c0a|1111)' OR coalesce(date_vechi::text, '') ~ '(SECRET|exemplu|18c0a|1111)'))
    ), 'TEST08.2 jurnalul red_mail_* contine valori sau lipseste');
  PERFORM pg_temp.ok(NOT (EXISTS (SELECT 1 FROM public.red_jurnal j, jsonb_each_text(coalesce(j.date_noi, '{}')) e WHERE left(j.tabela, 9) = 'red_mail_' AND e.value <> 'modificat')
    ), 'TEST08.3 jurnalul red_mail_* contine valori sau lipseste');
  PERFORM pg_temp.ok(NOT (EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_mail_evenimente')
    ), 'TEST08.4 jurnalul red_mail_* contine valori sau lipseste');
  RAISE NOTICE 'TEST08 OK';
END $t$;

-- TEST09: CHECK-urile (pozitive și negative) pe inventarul §1.12
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la) VALUES (''redari@gazpet.ro'', true, ''a'', repeat(''a'', 64), 1, now())', '23514')
    ), 'TEST09.1 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la) VALUES (''altcineva@gazpet.ro'', true, ''a'', repeat(''a'', 64), 1, now())', '23514')
    ), 'TEST09.2 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la) VALUES (''redari@gazpet.ro'', false, ''a'', ''ABC'', 1, now())', '23514')
    ), 'TEST09.3 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la) VALUES (''redari@gazpet.ro'', NULL, ''a'', repeat(''a'', 64), 1, now())', '23502')
    ), 'TEST09.4 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la, retentie_stare) VALUES (''redari@gazpet.ro'', false, ''a'', repeat(''a'', 64), 1, now(), NULL)', '23502')
    ), 'TEST09.5 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET retentie_stare = NULL WHERE id = ''00000000-0000-0000-0000-00000000aa01''', '23502')
    ), 'TEST09.6 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''sters'' WHERE id = ''00000000-0000-0000-0000-00000000aa01''', '42501')
    ), 'TEST09.7 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET motiv_cod = ''alt_motiv'' WHERE id = ''00000000-0000-0000-0000-00000000aa03''', '42501')
    ), 'TEST09.8 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET verificare = ''verificat_email'' WHERE id = ''00000000-0000-0000-0000-00000000aa01''', '23514')
     -- același gmail_id_hmac în aceeași căsuță → UNIQUE; în altă căsuță → permis (m4 are h1 ca m1)
    ), 'TEST09.9 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la) VALUES (''redari@gazpet.ro'', false, ''zz'', repeat(''1'', 64), 1, now())', '23505')
    ), 'TEST09.10 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_primite (casuta, test, gmail_id, gmail_id_hmac, hmac_versiune, primit_la) VALUES (''redari@gazpet.ro'', false, ''18c0a1'', repeat(''7'', 64), 1, now())', '23505')
     -- evenimente: tip în afara listei, numărători cu text
    ), 'TEST09.11 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_evenimente (tip) VALUES (''trimis_in_afara_erp'')', '23514')
    ), 'TEST09.12 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_evenimente (tip, numaratori) VALUES (''golire'', ''{"adresa": "x@y.ro"}'')', '23514')
    ), 'TEST09.13 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_evenimente (tip, numaratori) VALUES (''golire'', ''{"Adresa X": 1}'')', '23514')
    ), 'TEST09.14 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('INSERT INTO public.red_mail_evenimente (tip, numaratori) VALUES (''golire'', ''{"obiecte_sterse": 2}'')')
     -- OAuth: trimitere vine cu F2; expirare > 10 min corectată de trigger, scop necunoscut refuzat
    ), 'TEST09.15 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_oauth_state (state_sha256, scop, owner_id, expira_la) VALUES (repeat(''a'', 64), ''trimitere'', ''00000000-0000-0000-0000-0000000000a1'', now() + interval ''5 minutes'')', '23514')
    ), 'TEST09.16 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('INSERT INTO public.red_mail_oauth_state (state_sha256, scop, owner_id, expira_la) VALUES (repeat(''a'', 64), ''golire_test'', ''00000000-0000-0000-0000-0000000000a1'', now() + interval ''5 minutes'')')
     -- flux: căsuță străină, import fără data_import_de_la
    ), 'TEST09.17 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_flux (casuta, flux, mod_test) VALUES (''office@gazpet.ro'', ''inbox'', true)', '23514')
    ), 'TEST09.18 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_flux (casuta, flux, mod_test) VALUES (''redari@gazpet.ro'', ''import'', false)', '23514')
    ), 'TEST09.19 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_flux (casuta, flux, mod_test) VALUES (''redari@gazpet.ro'', ''sent'', true)', '23514')
     -- dedup: limita absolută ≠ golit_la + 3 ani
    ), 'TEST09.20 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_dedup (casuta, gmail_id_hmac, hmac_versiune, golit_la, gmail_stergere_stare, limita_absoluta_la) VALUES (''redari@gazpet.ro'', repeat(''d'', 64), 1, now(), ''de_mutat_in_cos'', now() + interval ''90 days'')', '23514')
    ), 'TEST09.21 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('INSERT INTO public.red_mail_dedup (casuta, gmail_id_hmac, hmac_versiune, golit_la, gmail_stergere_stare, limita_absoluta_la) VALUES (''redari@gazpet.ro'', repeat(''d'', 64), 1, now(), ''de_mutat_in_cos'', ((now() AT TIME ZONE ''UTC'') + interval ''3 years'') AT TIME ZONE ''UTC'')')
    ), 'TEST09.22 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_dedup (casuta, gmail_id_hmac, hmac_versiune, golit_la, gmail_stergere_stare, limita_absoluta_la) VALUES (''redari@gazpet.ro'', repeat(''d'', 64), 1, now(), ''necerut'', ((now() AT TIME ZONE ''UTC'') + interval ''3 years'') AT TIME ZONE ''UTC'')', '23514')
     -- adrese: email invalid / majuscule, respins_la fără stare respinsă
    ), 'TEST09.23 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_adrese_propuse (detinator_id, email, sursa) VALUES (''00000000-0000-0000-0000-00000000e001'', ''Ion@Exemplu.ro'', ''formular_public'')', '23514')
    ), 'TEST09.24 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_adrese_propuse (detinator_id, email, sursa) VALUES (''00000000-0000-0000-0000-00000000e001'', ''a@b.ro, c@d.ro'', ''formular_public'')', '23514')
    ), 'TEST09.25 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_adrese_propuse (detinator_id, email, sursa, primit_id) VALUES (''00000000-0000-0000-0000-00000000e001'', ''a@b.ro'', ''formular_public'', ''00000000-0000-0000-0000-00000000aa01'')', '23514')
    ), 'TEST09.26 CHECK-uri');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('INSERT INTO public.red_mail_adrese_propuse (detinator_id, email, sursa) VALUES (''00000000-0000-0000-0000-00000000e001'', ''ion.popescu@exemplu.ro'', ''formular_public'')')
    ), 'TEST09.27 CHECK-uri');
  RAISE NOTICE 'TEST09 OK';
END $t$;

-- TEST09b: stratul CHECK singur (triggerele k oprite pe red_mail_primite, doar local, în sub-tranzacția testului): fiecare invariant din §1.12
-- e garantat și de CHECK, nu doar de trigger (apărare în adâncime)
ALTER TABLE public.red_mail_primite DISABLE TRIGGER trg_red_mail_primite_reguli;
DO $t$
DECLARE m1 text := '''00000000-0000-0000-0000-00000000aa01'''; m3 text := '''00000000-0000-0000-0000-00000000aa03''';
BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''sters'' WHERE id = ' || m1, '23514')
    ), 'TEST09b.1 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''de_mutat_in_cos'' WHERE id = ' || m1, '23514')           -- negolit
    ), 'TEST09b.2 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET motiv_cod = ''alt_motiv'' WHERE id = ' || m3, '23514')
    ), 'TEST09b.3 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET motiv_cod = NULL WHERE id = ' || m3, '23514')
    ), 'TEST09b.4 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET test = true WHERE id = ' || m1, '23514')
    ), 'TEST09b.5 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''asociat'' WHERE id = ' || m1, '23514')                                   -- fără deținător
    ), 'TEST09b.6 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET retentie_stare = ''in_golire'' WHERE id = ' || m1, '23514')                         -- fără claim
    ), 'TEST09b.7 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET retentie_stare = ''golit'', golit_la = now(), limita_absoluta_la = now() + interval ''90 days'' WHERE id = ' || m3, '23514')
    ), 'TEST09b.8 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET retentie_stare = ''golit'', golit_la = now(), limita_absoluta_la = ((now() AT TIME ZONE ''UTC'') + interval ''3 years'') AT TIME ZONE ''UTC'' WHERE id = ' || m1, '23514')  -- conținut prezent
    ), 'TEST09b.9 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET eliberat_golire_la = now() WHERE id = ' || m3, '23514')
    ), 'TEST09b.10 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET eliberat_golire_la = now(), eliberat_golire_de = ''00000000-0000-0000-0000-0000000000a1'', eliberat_golire_motiv = ''m'' WHERE id = ' || m1, '23514')  -- nu e neprocesabil
    ), 'TEST09b.11 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_id_hmac = NULL WHERE id = ' || m1, '23514')
    ), 'TEST09b.12 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET dedup_incheiat_la = now() WHERE id = ' || m1, '23514')                             -- gmail_id încă prezent
    ), 'TEST09b.13 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET blocaj_stare = ''activ'' WHERE id = ' || m1, '23514')                              -- fără motiv
    ), 'TEST09b.14 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET verificare = ''verificat_telefon'' WHERE id = ' || m1, '23514')                    -- fără autor / dată
    ), 'TEST09b.15 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET auth_dmarc = ''pass'' WHERE id = ' || m1, '23514')                                 -- auth_sursa necunoscut
    ), 'TEST09b.16 stratul CHECK');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET ingestie_finalizata_la = NULL WHERE id = ' || m1, '23514')
    ), 'TEST09b.17 stratul CHECK');
  RAISE NOTICE 'TEST09b OK';
END $t$;
ALTER TABLE public.red_mail_primite ENABLE TRIGGER trg_red_mail_primite_reguli;

-- TEST10: CHECK-ul complet al sursei (Jak r14 P3-01) — manual fără dată / motiv / cu primit_id; gmail cu dată; tip_sursa NULL (trigger oprit local)
ALTER TABLE public.red_mail_raspuns_sursa DISABLE TRIGGER trg_red_mail_sursa_reguli;
DO $t$
DECLARE v text := 'INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de, data_raspuns, motiv_data) VALUES (''00000000-0000-0000-0000-0000000001a1'', ';
BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || '''manual_verificat'', NULL, ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', NULL, ''motiv'')', '23514')
    ), 'TEST10.1 CHECK-ul sursei');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || '''manual_verificat'', NULL, ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', current_date, NULL)', '23514')
    ), 'TEST10.2 CHECK-ul sursei');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || '''manual_verificat'', ''00000000-0000-0000-0000-00000000aa02'', ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', current_date, ''m'')', '23514')
    ), 'TEST10.3 CHECK-ul sursei');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || '''gmail_redari'', ''00000000-0000-0000-0000-00000000aa02'', ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', current_date, NULL)', '23514')
    ), 'TEST10.4 CHECK-ul sursei');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || '''gmail_redari'', NULL, ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', NULL, NULL)', '23514')
    ), 'TEST10.5 CHECK-ul sursei');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || 'NULL, NULL, ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', NULL, NULL)', '23502')
    ), 'TEST10.6 CHECK-ul sursei');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(v || '''manual_verificat'', NULL, ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''neverificat'', ''00000000-0000-0000-0000-0000000000a3'', current_date, ''m'')', '23514')
    ), 'TEST10.7 CHECK-ul sursei');
  RAISE NOTICE 'TEST10 OK';
END $t$;
ALTER TABLE public.red_mail_raspuns_sursa ENABLE TRIGGER trg_red_mail_sursa_reguli;

-- TEST11: tranzițiile stare × stare_ingestie (§1.10), a_fost_asociat, „ignorat” doar fără legătură juridică (implicit (i)), mesajul de test
DO $t$
DECLARE m1 text := '''00000000-0000-0000-0000-00000000aa01'''; m2 text := '''00000000-0000-0000-0000-00000000aa02'''; m3 text := '''00000000-0000-0000-0000-00000000aa03''';
        m4 text := '''00000000-0000-0000-0000-00000000aa04'''; m5 text := '''00000000-0000-0000-0000-00000000aa05'''; m6 text := '''00000000-0000-0000-0000-00000000aa06''';
        asoc text := ', detinator_id = ''00000000-0000-0000-0000-00000000e001'', parcela_id = ''00000000-0000-0000-0000-00000000d001'', asociat_de = ''00000000-0000-0000-0000-0000000000a3'', asociat_la = now()';
        ign text := ', ignorat_la = now(), ignorat_de = ''00000000-0000-0000-0000-0000000000a2'', ignorat_motiv = ''spam''';
BEGIN
  -- neprocesabil / in_curs: nici asociat, nici ignorat (BD, r16), pe orice cale
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''ignorat''' || ign || ' WHERE id = ' || m3, '23514')
    ), 'TEST11.1 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''asociat''' || asoc || ' WHERE id = ' || m3, '23514')
    ), 'TEST11.2 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''ignorat''' || ign || ' WHERE id = ' || m6, '23514')
     -- legătura juridică (corespondență) → ignorat refuzat; mesajul de test nu se asociază cu un deținător real
    ), 'TEST11.3 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''ignorat''' || ign || ' WHERE id = ' || m5, '42501')
    ), 'TEST11.4 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''asociat''' || asoc || ' WHERE id = ' || m4, '23514')
     -- tranziții în afara listei
    ), 'TEST11.5 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''rezolvat'', rezolvat_la = now(), rezolvat_de = ''00000000-0000-0000-0000-0000000000a3''' || asoc || ' WHERE id = ' || m1, '42501')
    ), 'TEST11.6 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare_ingestie = ''in_curs'', ingestie_finalizata_la = NULL WHERE id = ' || m1, '42501')
    ), 'TEST11.7 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare_ingestie = ''ok'', motiv_cod = NULL WHERE id = ' || m3, '42501')
     -- conținutul extern nu se modifică după ingestie
    ), 'TEST11.8 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET subiect = ''alt subiect'' WHERE id = ' || m1, '42501')
    ), 'TEST11.9 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_id = ''altul'' WHERE id = ' || m1, '42501')
    ), 'TEST11.10 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET primit_la = now() WHERE id = ' || m1, '42501')
     -- m1: nou → ignorat (fără legătură) → nou (redeschide) → asociat → rezolvat → asociat; după asociere nu mai poate deveni nou / ignorat
    ), 'TEST11.11 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET stare = ''ignorat''' || ign || ' WHERE id = ' || m1)
    ), 'TEST11.12 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET stare = ''nou'', ignorat_la = NULL, ignorat_de = NULL, ignorat_motiv = NULL WHERE id = ' || m1)
    ), 'TEST11.13 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET stare = ''asociat''' || asoc || ' WHERE id = ' || m1)
    ), 'TEST11.14 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT (SELECT a_fost_asociat FROM public.red_mail_primite WHERE id = '00000000-0000-0000-0000-00000000aa01')
    ), 'TEST11.15 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET stare = ''rezolvat'', rezolvat_la = now(), rezolvat_de = ''00000000-0000-0000-0000-0000000000a3'' WHERE id = ' || m1)
    ), 'TEST11.16 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET stare = ''asociat'', rezolvat_la = NULL, rezolvat_de = NULL WHERE id = ' || m1)
    ), 'TEST11.17 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET stare = ''nou'', detinator_id = NULL, parcela_id = NULL, asociat_de = NULL, asociat_la = NULL WHERE id = ' || m1, '42501')
    ), 'TEST11.18 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET a_fost_asociat = false WHERE id = ' || m1, '42501')
    ), 'TEST11.19 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET detinator_id = ''00000000-0000-0000-0000-00000000e003'', parcela_id = ''00000000-0000-0000-0000-00000000d002'' WHERE id = ' || m1, '42501')
    ), 'TEST11.20 tranzitii de triere');
  PERFORM pg_temp.ok(NOT (public.fn_red_mail_are_legatura_juridica('00000000-0000-0000-0000-00000000aa01') IS NOT TRUE OR public.fn_red_mail_are_legatura_juridica('00000000-0000-0000-0000-00000000aa05') IS NOT TRUE
    ), 'TEST11.1 are_legatura_juridica (fail-closed)');
  PERFORM pg_temp.ok(NOT (public.fn_red_mail_are_legatura_juridica('00000000-0000-0000-0000-00000000aa02') IS NOT FALSE OR public.fn_red_mail_are_legatura_juridica(gen_random_uuid()) IS NOT TRUE
    ), 'TEST11.2 are_legatura_juridica (fail-closed)');
  PERFORM pg_temp.ok(NOT (public.fn_red_mail_are_legatura_juridica(NULL) IS NOT TRUE
    ), 'TEST11.3 are_legatura_juridica (fail-closed)');
  RAISE NOTICE 'TEST11 OK';
END $t$;

-- TEST12: eliberarea neprocesabilului (r16–r18), golirea (conținut NULL, golit final, blocaj), ciclul Gmail (lista închisă, UUID nou)
DO $t$
DECLARE m3 text := '''00000000-0000-0000-0000-00000000aa03'''; m2 text := '''00000000-0000-0000-0000-00000000aa02''';
        elib text := 'eliberat_golire_la = now(), eliberat_golire_de = ''00000000-0000-0000-0000-0000000000a1'', eliberat_golire_motiv = ''verificat in Gmail''';
        golit text := 'retentie_stare = ''golit'', golit_la = now(), limita_absoluta_la = ((now() AT TIME ZONE ''UTC'') + interval ''3 years'') AT TIME ZONE ''UTC''';
BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET ' || elib || ' WHERE id = ' || m2, '42501')                                   -- doar pe neprocesabil
    ), 'TEST12.1 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET eliberat_golire_la = now(), eliberat_golire_de = NULL, eliberat_golire_motiv = ''x'' WHERE id = ' || m3, '23514')
    ), 'TEST12.2 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET eliberat_golire_la = now(), eliberat_golire_de = ''00000000-0000-0000-0000-0000000000a1'' WHERE id = ' || m3, '23514')
    ), 'TEST12.3 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET ' || elib || ' WHERE id = ' || m3)
    ), 'TEST12.4 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET eliberat_golire_motiv = ''alt motiv'' WHERE id = ' || m3, '42501')
    ), 'TEST12.5 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET eliberat_golire_motiv = NULL WHERE id = ' || m3, '42501')
     -- anularea (toate trei → NULL) cât e activ, apoi din nou eliberat
    ), 'TEST12.6 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET eliberat_golire_la = NULL, eliberat_golire_de = NULL, eliberat_golire_motiv = NULL WHERE id = ' || m3)
    ), 'TEST12.7 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET ' || elib || ' WHERE id = ' || m3)
     -- blocajul oprește golirea; ridicat → golirea: conținutul NULL obligatoriu (CHECK), motivul eliberării → NULL doar odată cu golirea
    ), 'TEST12.8 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET blocaj_stare = ''activ'', retentie_blocata_motiv = ''cerere juridic'', blocaj_cerut_la = now(), blocaj_cerut_de = ''00000000-0000-0000-0000-0000000000a2'' WHERE id = ' || m3)
    ), 'TEST12.9 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET retentie_stare = ''in_golire'', golire_claim_token = gen_random_uuid(), golire_claim_pana = now() + interval ''5 minutes'' WHERE id = ' || m3, '42501')
    ), 'TEST12.10 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET blocaj_stare = ''fara'', retentie_blocata_motiv = NULL, blocaj_cerut_la = NULL, blocaj_cerut_de = NULL WHERE id = ' || m3)
    ), 'TEST12.11 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET ' || golit || ' WHERE id = ' || m3, '23514')   -- motivul eliberării încă prezent
    ), 'TEST12.12 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET ' || golit || ', eliberat_golire_motiv = NULL WHERE id = ' || m3)
    ), 'TEST12.13 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET retentie_stare = ''activ'', golit_la = NULL, limita_absoluta_la = NULL WHERE id = ' || m3, '42501')
    ), 'TEST12.14 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT ((SELECT (eliberat_golire_la IS NOT NULL AND eliberat_golire_de IS NOT NULL AND eliberat_golire_motiv IS NULL) FROM public.red_mail_primite WHERE id = '00000000-0000-0000-0000-00000000aa03') IS NOT TRUE
     -- un mesaj cu conținut nu se golește fără a-l pune pe NULL
    ), 'TEST12.15 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET ' || golit || ' WHERE id = ' || m2, '23514')
     -- ciclul Gmail pe m3 (golit): necerut → trash_in_apel refuzat; necerut → de_mutat_in_cos → trash_in_apel (UUID nou) → in_cos; in_cos → trash_in_apel refuzat
    ), 'TEST12.16 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''trash_in_apel'', gmail_trash_incercare_id = gen_random_uuid(), gmail_trash_inceput_la = now(), gmail_trash_valabil_pana = now() + interval ''60 seconds'' WHERE id = ' || m3, '42501')
    ), 'TEST12.17 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''de_mutat_in_cos'' WHERE id = ' || m2, '23514')   -- negolit
    ), 'TEST12.18 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''de_mutat_in_cos'' WHERE id = ' || m3)
    ), 'TEST12.19 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''trash_in_apel'' WHERE id = ' || m3, '23514')       -- fără evidența încercării
    ), 'TEST12.20 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''trash_in_apel'', gmail_trash_incercare_id = gen_random_uuid(), gmail_trash_inceput_la = now(), gmail_trash_valabil_pana = now() + interval ''60 seconds'' WHERE id = ' || m3)
    ), 'TEST12.21 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_trash_incercare_id = gen_random_uuid() WHERE id = ' || m3, '42501')   -- încercarea nu se rescrie
    ), 'TEST12.22 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_primite WHERE id = ' || m3, '42501')                                            -- trash_in_apel viu
    ), 'TEST12.23 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''in_cos'', gmail_in_cos_la = now() WHERE id = ' || m3)
    ), 'TEST12.24 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''trash_in_apel'', gmail_trash_incercare_id = gen_random_uuid(), gmail_trash_inceput_la = now(), gmail_trash_valabil_pana = now() WHERE id = ' || m3, '42501')
    ), 'TEST12.25 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''verificat_absent'', gmail_absent_verificat_la = now() WHERE id = ' || m3, '23514')   -- gmail_id încă prezent
    ), 'TEST12.26 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET gmail_stergere_stare = ''verificat_absent'', gmail_absent_verificat_la = now(), gmail_id = NULL WHERE id = ' || m3)
    ), 'TEST12.27 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_id_hmac = NULL WHERE id = ' || m3, '23514')                         -- HMAC NULL cere dedup_incheiat_la
    ), 'TEST12.28 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_primite SET gmail_id_hmac = NULL, dedup_incheiat_la = now() WHERE id = ' || m3)
    ), 'TEST12.29 eliberare / golire / ciclul Gmail');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET gmail_id_hmac = repeat(''3'', 64) WHERE id = ' || m3, '42501')
    ), 'TEST12.30 eliberare / golire / ciclul Gmail');
  RAISE NOTICE 'TEST12 OK';
END $t$;

-- TEST13: manifestul (calea deterministă, un singur obiect în ștergere), fluxul (data_start imuabil, cursorul), evenimentele (append-only), oauth, dedup
DO $t$
DECLARE m6 text := '''00000000-0000-0000-0000-00000000aa06''';
BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_obiecte (primit_id, tip, nr, cale) VALUES (' || m6 || ', ''atasament'', 2, ''mail/redari-test/atasamente/' || repeat('6', 64) || '/2'')', '23514')
    ), 'TEST13.1 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_obiecte (primit_id, tip, nr, cale) VALUES (' || m6 || ', ''atasament'', 2, ''mail/redari/atasamente/' || repeat('1', 64) || '/2'')', '23514')
    ), 'TEST13.2 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_obiecte (primit_id, tip, nr, cale) VALUES (' || m6 || ', ''atasament'', 3, ''mail/redari/atasamente/' || repeat('6', 64) || '/2'')', '23514')
    ), 'TEST13.3 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_obiecte (primit_id, tip, nr, cale) VALUES (''00000000-0000-0000-0000-00000000aa02'', ''eml'', 0, ''mail/redari/carantina/' || repeat('2', 64) || '.eml'')', '23514')
    ), 'TEST13.4 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('INSERT INTO public.red_mail_obiecte (primit_id, tip, nr, cale, stare) VALUES (' || m6 || ', ''atasament'', 2, NULL, ''respins_tip'')')
    ), 'TEST13.5 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_obiecte SET stare = ''stocat'', sha256 = repeat(''e'', 64), marime = 10 WHERE primit_id = ' || m6)
    ), 'TEST13.6 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_obiecte SET sha256 = repeat(''f'', 64) WHERE id = ''00000000-0000-0000-0000-00000000ab01''', '42501')
    ), 'TEST13.7 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_obiecte SET cale = ''mail/redari/carantina/' || repeat('9', 64) || '.eml'' WHERE id = ''00000000-0000-0000-0000-00000000ab01''', '42501')
    ), 'TEST13.8 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_obiecte SET stare = ''in_stergere'', stergere_autorizata_la = now() WHERE id = ''00000000-0000-0000-0000-00000000ab01''', '42501')  -- mesajul nu e in_golire
    ), 'TEST13.9 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_obiecte WHERE id = ''00000000-0000-0000-0000-00000000ab01''', '42501')
     -- flux: data_start se scrie o dată; cursorul pe tranzițiile permise; nu se șterge
    ), 'TEST13.10 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_flux SET mod_cursor = ''normal'', history_id = 1, data_start = now() WHERE casuta = ''redari-test@gazpet.ro''', '42501')
    ), 'TEST13.11 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_flux SET data_start = now() - interval ''1 minute'' WHERE casuta = ''redari-test@gazpet.ro''')
    ), 'TEST13.12 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_flux SET data_start = now() WHERE casuta = ''redari-test@gazpet.ro''', '42501')
    ), 'TEST13.13 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_flux SET mod_cursor = ''recuperare'', history_id = 18446744073709551615, recuperare_tip = ''activare'', recuperare_history_id = 18446744073709551615 WHERE casuta = ''redari-test@gazpet.ro''')
    ), 'TEST13.14 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT ((SELECT versiune FROM public.red_mail_flux WHERE casuta = 'redari-test@gazpet.ro') <> 3
    ), 'TEST13.15 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_flux SET mod_test = false WHERE casuta = ''redari-test@gazpet.ro''', '42501')
    ), 'TEST13.16 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_flux', '42501')
     -- evenimente: UPDATE / DELETE (mesaj existent, sau fără mesaj mai nou de 1 an) refuzate; TRUNCATE refuzat
    ), 'TEST13.17 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_evenimente SET cod = ''x''', '42501')
    ), 'TEST13.18 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_evenimente', '42501')
    ), 'TEST13.19 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('TRUNCATE public.red_mail_evenimente', '42501')
    ), 'TEST13.20 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_setari', '42501')
     -- oauth: consumat o singură dată; scop imuabil
    ), 'TEST13.21 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('INSERT INTO public.red_mail_oauth_state (state_sha256, scop, owner_id, expira_la) VALUES (repeat(''c'', 64), ''citire'', ''00000000-0000-0000-0000-0000000000a1'', now() + interval ''1 hour'')')
    ), 'TEST13.22 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT ((SELECT expira_la <= creat_la + interval '10 minutes' FROM public.red_mail_oauth_state WHERE state_sha256 = repeat('c', 64)) IS NOT TRUE
    ), 'TEST13.23 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_oauth_state SET consumat_la = now() WHERE state_sha256 = repeat(''c'', 64)')
    ), 'TEST13.24 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_oauth_state SET consumat_la = now() + interval ''1 second'' WHERE state_sha256 = repeat(''c'', 64)', '42501')
     -- dedup: tombstone; ștergere înainte de verificare refuzată; termenul nu se mută
    ), 'TEST13.25 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('INSERT INTO public.red_mail_dedup (casuta, gmail_id_hmac, hmac_versiune, golit_la, gmail_id, gmail_stergere_stare, limita_absoluta_la) VALUES (''redari@gazpet.ro'', repeat(''b'', 64), 1, now(), ''18c0b0'', ''de_mutat_in_cos'', ((now() AT TIME ZONE ''UTC'') + interval ''3 years'') AT TIME ZONE ''UTC'')')
    ), 'TEST13.26 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_dedup WHERE gmail_id_hmac = repeat(''b'', 64)', '42501')
    ), 'TEST13.27 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_dedup SET golit_la = golit_la + interval ''1 day'', limita_absoluta_la = limita_absoluta_la + interval ''1 day'' WHERE gmail_id_hmac = repeat(''b'', 64)', '42501')
    ), 'TEST13.28 manifest / flux / evenimente / oauth / dedup');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_dedup SET gmail_stergere_stare = ''in_cos'', gmail_in_cos_la = now() WHERE gmail_id_hmac = repeat(''b'', 64)', '42501')
    ), 'TEST13.29 manifest / flux / evenimente / oauth / dedup');
  RAISE NOTICE 'TEST13 OK';
END $t$;

-- TEST14: proveniența pe red_raspunsuri — INSERT canal = email fără sursă (ca editor, PostgREST) refuzat la commit; cu sursă în aceeași tranzacție OK
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a3', 'authenticated');
DO $t$ BEGIN
  -- INSERT direct ca editor: trece de RLS + privilegii, pică la verificarea amânată (commit)
  IF NOT pg_temp.refuza('INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES (''00000000-0000-0000-0000-00000000e001'', ''email'', ''nu_particip_fara_obiectii''); '
                        || 'SET CONSTRAINTS trg_red_raspunsuri_mail_sursa IMMEDIATE', '42501') THEN
    RAISE EXCEPTION 'TEST14 FAIL: INSERT canal email fara sursa (editor) nu e refuzat la commit';
  END IF;
  -- canal telefon → email pe un răspuns existent: refuz imediat
  IF NOT pg_temp.refuza('UPDATE public.red_raspunsuri SET canal = ''email'' WHERE id = ''00000000-0000-0000-0000-0000000001a1''', '42501') THEN
    RAISE EXCEPTION 'TEST14 FAIL: telefon -> email';
  END IF;
  -- răspunsurile fără sursă e-mail rămân editabile de editor (regresie)
  IF NOT pg_temp.incearca('UPDATE public.red_raspunsuri SET optiune = ''nu_particip_cu_obiectii'', obiectii_text = ''obiectie la telefon'' WHERE id = ''00000000-0000-0000-0000-0000000001a1''') THEN
    RAISE EXCEPTION 'TEST14 FAIL: editorul nu mai poate corecta un raspuns telefonic (regresie)';
  END IF;
  RAISE NOTICE 'TEST14 OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST15: răspuns e-mail legitim (ce va face RPC-ul pasului 4): m2 asociat cu e001 + răspuns + sursă, în aceeași tranzacție → commit OK;
-- apoi PATCH ca editor pe FIECARE câmp protejat → refuz, fără urmă în red_jurnal; viewer-ul vede exact lista pozitivă (c)
DO $t$
DECLARE r uuid := '00000000-0000-0000-0000-0000000002a1'; v_ref text; v_j bigint;
BEGIN
  UPDATE public.red_mail_primite SET stare = 'asociat', detinator_id = '00000000-0000-0000-0000-00000000e001', parcela_id = '00000000-0000-0000-0000-00000000d001',
         asociat_de = '00000000-0000-0000-0000-0000000000a3', asociat_la = now() WHERE id = '00000000-0000-0000-0000-00000000aa02';
  v_ref := public.fn_red_mail_referinta_obiectii('gmail_redari', '00000000-0000-0000-0000-00000000aa02');
  -- sursa ÎNAINTEA răspunsului → refuz (răspunsul trebuie să existe, canal email, același deținător)
  IF NOT pg_temp.refuza('INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de) VALUES '
                        || '(''00000000-0000-0000-0000-0000000001a1'', ''gmail_redari'', ''00000000-0000-0000-0000-00000000aa02'', ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'')', '23514') THEN
    RAISE EXCEPTION 'TEST15 FAIL: sursa pe un raspuns telefon';
  END IF;
  INSERT INTO public.red_raspunsuri (id, detinator_id, canal, data, optiune, obiectii_text)
    VALUES (r, '00000000-0000-0000-0000-00000000e001', 'email', now() - interval '3 hours', 'nu_particip_cu_obiectii', v_ref);
  -- deținător diferit / mesaj de test / mesaj neasociat → refuz
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de) VALUES (%L, ''gmail_redari'', ''00000000-0000-0000-0000-00000000aa02'', ''00000000-0000-0000-0000-00000000e003'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'')', r), '23514')
    ), 'TEST15.1 sursa invalida acceptata');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de) VALUES (%L, ''gmail_redari'', ''00000000-0000-0000-0000-00000000aa04'', ''00000000-0000-0000-0000-00000000e001'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'')', r), '23514')
    ), 'TEST15.2 sursa invalida acceptata');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de) VALUES (%L, ''gmail_redari'', ''00000000-0000-0000-0000-00000000aa05'', ''00000000-0000-0000-0000-00000000e001'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'')', r), '23514')
     -- manual care citează un mesaj ok (nu neprocesabil) → mesaj_sursa_invalid; manual cu data în viitor → refuz
    ), 'TEST15.3 sursa invalida acceptata');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de, data_raspuns, motiv_data, mesaj_sursa_id) VALUES (%L, ''manual_verificat'', ''00000000-0000-0000-0000-00000000e001'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', current_date, ''m'', ''00000000-0000-0000-0000-00000000aa05'')', r), '23514')
    ), 'TEST15.4 sursa invalida acceptata');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza(format('INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de, data_raspuns, motiv_data) VALUES (%L, ''manual_verificat'', ''00000000-0000-0000-0000-00000000e001'', gen_random_uuid(), repeat(''a'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3'', current_date + 2, ''m'')', r), '23514')
    ), 'TEST15.5 sursa invalida acceptata');
  INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de)
    VALUES (r, 'gmail_redari', '00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000003a1', repeat('a', 64), 'verificat_telefon', '00000000-0000-0000-0000-0000000000a3');
  UPDATE public.red_mail_primite SET inregistrat_in_registru = true WHERE id = '00000000-0000-0000-0000-00000000aa02';
  -- simularea commit-ului: verificarea amânată trece (sursă prezentă, referința fixă)
  SET CONSTRAINTS trg_red_raspunsuri_mail_sursa IMMEDIATE;
  SET CONSTRAINTS trg_red_raspunsuri_mail_sursa DEFERRED;
  -- un doilea răspuns e-mail cu TEXTUL mailului în obiectii_text → refuz la commit, chiar cu sursă
  IF NOT pg_temp.refuza('INSERT INTO public.red_raspunsuri (id, detinator_id, canal, optiune, obiectii_text) VALUES (''00000000-0000-0000-0000-0000000002a2'', ''00000000-0000-0000-0000-00000000e002'', ''email'', ''nu_particip_cu_obiectii'', ''CORP_SECRET_2''); '
                        || 'INSERT INTO public.red_mail_raspuns_sursa (raspuns_id, tip_sursa, primit_id, detinator_id, operatie_id, cerere_sha256, metoda_verificare, verificat_de) VALUES (''00000000-0000-0000-0000-0000000002a2'', ''gmail_redari'', ''00000000-0000-0000-0000-00000000aa02'', ''00000000-0000-0000-0000-00000000e002'', gen_random_uuid(), repeat(''b'', 64), ''verificat_telefon'', ''00000000-0000-0000-0000-0000000000a3''); '
                        || 'SET CONSTRAINTS trg_red_raspunsuri_mail_sursa IMMEDIATE', '42501') THEN
    RAISE EXCEPTION 'TEST15 FAIL: textul mailului in obiectii_text acceptat';
  END IF;
  -- asocierea / verificarea mesajului sunt înghețate după înregistrare
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET verificare = ''verificat_alt'', verificat_la = now(), verificat_de = ''00000000-0000-0000-0000-0000000000a3'' WHERE id = ''00000000-0000-0000-0000-00000000aa02''', '42501')
    ), 'TEST15.1 inghetare / sursa imuabila');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_primite SET inregistrat_in_registru = false WHERE id = ''00000000-0000-0000-0000-00000000aa02''', '42501')
     -- sursa: imuabilă, nu se șterge cât există răspunsul
    ), 'TEST15.2 inghetare / sursa imuabila');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_raspuns_sursa SET operatie_id = gen_random_uuid()', '42501')
    ), 'TEST15.3 inghetare / sursa imuabila');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_raspuns_sursa SET tip_sursa = ''manual_verificat''', '42501')
    ), 'TEST15.4 inghetare / sursa imuabila');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_raspuns_sursa', '42501')
    ), 'TEST15.5 inghetare / sursa imuabila');
  v_j := (SELECT count(*) FROM public.red_jurnal);
  PERFORM set_config('t15.jurnal', v_j::text, true);
  RAISE NOTICE 'TEST15a OK';
END $t$;
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a3', 'authenticated');
DO $t$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['optiune = ''nu_particip_fara_obiectii'', obiectii_text = NULL', 'data = now()', 'zi_sesiune_aleasa = DATE ''2026-12-01'', optiune = ''particip'', obiectii_text = NULL',
                           'obiectii_text = ''alt text''', 'declaratie_confirmata = true', 'semnatura_electronica_ref = ''x''', 'canal = ''telefon'''] LOOP
    IF NOT pg_temp.refuza('UPDATE public.red_raspunsuri SET ' || c || ' WHERE id = ''00000000-0000-0000-0000-0000000002a1''', '42501') THEN
      RAISE EXCEPTION 'TEST15 FAIL: editorul a modificat % pe raspunsul din mail', c;
    END IF;
  END LOOP;
  -- detinator_id / created_by / created_at: editorul nu are nici privilegiul de coloană (42501 permission denied) — refuz oricum
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_raspunsuri SET detinator_id = ''00000000-0000-0000-0000-00000000e002'' WHERE id = ''00000000-0000-0000-0000-0000000002a1''', '42501')
    ), 'TEST15.1 detinator / created_by');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_raspunsuri SET created_by = NULL WHERE id = ''00000000-0000-0000-0000-0000000002a1''', '42501')
    ), 'TEST15.2 detinator / created_by');
  RAISE NOTICE 'TEST15b OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');
DO $t$ BEGIN
  -- nici postgres / service_role (mentenanța) nu rescriu câmpurile protejate; jurnalul nu are nicio urmă a încercărilor
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_raspunsuri SET optiune = ''particip'', zi_sesiune_aleasa = DATE ''2026-12-01'', obiectii_text = NULL WHERE id = ''00000000-0000-0000-0000-0000000002a1''', '42501')
    ), 'TEST15.1 postgres / jurnal / randul neschimbat');
  PERFORM pg_temp.ok(NOT ((SELECT count(*) FROM public.red_jurnal) <> current_setting('t15.jurnal')::bigint
    ), 'TEST15.2 postgres / jurnal / randul neschimbat');
  PERFORM pg_temp.ok(NOT ((SELECT (optiune, obiectii_text) FROM public.red_raspunsuri WHERE id = '00000000-0000-0000-0000-0000000002a1')
          IS DISTINCT FROM ROW('nu_particip_cu_obiectii'::text, public.fn_red_mail_referinta_obiectii('gmail_redari', '00000000-0000-0000-0000-00000000aa02'))
    ), 'TEST15.3 postgres / jurnal / randul neschimbat');
  -- ștergerea răspunsului (mentenanță) ia sursa în cascadă
  IF NOT pg_temp.incearca('DELETE FROM public.red_raspunsuri WHERE id = ''00000000-0000-0000-0000-0000000002a1''') THEN RAISE EXCEPTION 'TEST15 FAIL: cascada sursei'; END IF;
  RAISE NOTICE 'TEST15c OK';
END $t$;
-- viewer: excepția (c) — vede răspunsul din mail în Registru doar cu canal / opțiune / dată / zi / referința fixă; nimic din red_mail_*
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a4', 'authenticated');
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT ((SELECT obiectii_text FROM public.red_raspunsuri WHERE id = '00000000-0000-0000-0000-0000000002a1') IS DISTINCT FROM
       'Obiecții transmise pe e-mail — mesajul RED-' || upper(left(replace('00000000-0000-0000-0000-00000000aa02', '-', ''), 8)) || '; textul în 📥 Mesaje'
    ), 'TEST15.1 viewer (lista pozitiva / nimic din mail)');
  PERFORM pg_temp.ok(NOT ((SELECT canal FROM public.red_raspunsuri WHERE id = '00000000-0000-0000-0000-0000000002a1') IS DISTINCT FROM 'email'
    ), 'TEST15.2 viewer (lista pozitiva / nimic din mail)');
  PERFORM pg_temp.ok(NOT (pg_temp.n('SELECT 1 FROM public.red_mail_raspuns_sursa') <> 0 OR pg_temp.n('SELECT 1 FROM public.red_mail_primite') <> 0
    ), 'TEST15.3 viewer (lista pozitiva / nimic din mail)');
  PERFORM pg_temp.ok(NOT (pg_temp.n('SELECT 1 FROM public.red_jurnal WHERE left(tabela, 9) = ''red_mail_''') <> 0
    ), 'TEST15.4 viewer (lista pozitiva / nimic din mail)');
  PERFORM pg_temp.ok(NOT (pg_temp.n('SELECT 1 FROM public.red_jurnal WHERE date_noi::text ~ ''SECRET'' OR date_vechi::text ~ ''SECRET''') <> 0
    ), 'TEST15.5 viewer (lista pozitiva / nimic din mail)');
  RAISE NOTICE 'TEST15d OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST16: red_proiecte.retentie_mail_pana — doar owner (admin refuzat, restul coloanelor tot editabile de admin)
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a2', 'authenticated');
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_proiecte SET retentie_mail_pana = DATE ''2031-12-31'' WHERE id = ''00000000-0000-0000-0000-00000000b001''', '42501')
    ), 'TEST16.1 admin');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_proiecte (cod, retentie_mail_pana) VALUES (''ALT'', DATE ''2031-12-31'')', '42501')
    ), 'TEST16.2 admin');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('UPDATE public.red_proiecte SET denumire = ''redenumit'' WHERE id = ''00000000-0000-0000-0000-00000000b001''')
    ), 'TEST16.3 admin');
  RAISE NOTICE 'TEST16a OK';
END $t$;
SELECT pg_temp.ca('00000000-0000-0000-0000-0000000000a1', 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.incearca('UPDATE public.red_proiecte SET retentie_mail_pana = DATE ''2031-12-31'' WHERE id = ''00000000-0000-0000-0000-00000000b001''') THEN
    RAISE EXCEPTION 'TEST16 FAIL: owner';
  END IF;
  RAISE NOTICE 'TEST16b OK';
END $t$;
SELECT pg_temp.ca(NULL, 'postgres');

-- TEST17: adresele propuse — din mesaj de test refuzat (sursa_test); propusa → confirmata → înghețată; golirea doar pe propusă / respinsă
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('INSERT INTO public.red_mail_adrese_propuse (detinator_id, email, sursa, primit_id) VALUES (''00000000-0000-0000-0000-00000000e001'', ''a@b.ro'', ''mail_primit'', ''00000000-0000-0000-0000-00000000aa04'')', '23514')
    ), 'TEST17.1 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('INSERT INTO public.red_mail_adrese_propuse (id, detinator_id, email, sursa, primit_id) VALUES (''00000000-0000-0000-0000-0000000004a1'', ''00000000-0000-0000-0000-00000000e001'', ''ion@exemplu.ro'', ''mail_primit'', ''00000000-0000-0000-0000-00000000aa05'')')
    ), 'TEST17.2 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_adrese_propuse SET stare = ''confirmata'', confirmat_la = now(), confirmat_de = ''00000000-0000-0000-0000-0000000000a3'' WHERE id = ''00000000-0000-0000-0000-0000000004a1''', '23514')
    ), 'TEST17.3 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('UPDATE public.red_mail_adrese_propuse SET stare = ''confirmata'', confirmat_la = now(), confirmat_de = ''00000000-0000-0000-0000-0000000000a3'', metoda_verificare = ''verificat_telefon'', confirmare_operatie_id = gen_random_uuid(), confirmare_cerere_sha256 = repeat(''a'', 64) WHERE id = ''00000000-0000-0000-0000-0000000004a1''')
    ), 'TEST17.4 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_adrese_propuse SET stare = ''respinsa'', respins_la = now(), respins_de = ''00000000-0000-0000-0000-0000000000a3'' WHERE id = ''00000000-0000-0000-0000-0000000004a1''', '42501')
    ), 'TEST17.5 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_adrese_propuse SET email = NULL, golit_la = now() WHERE id = ''00000000-0000-0000-0000-0000000004a1''', '42501')
    ), 'TEST17.6 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('UPDATE public.red_mail_adrese_propuse SET email = ''alt@exemplu.ro'' WHERE id = ''00000000-0000-0000-0000-0000000004a1''', '42501')
    ), 'TEST17.7 adrese propuse');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_adrese_propuse', '42501')
    ), 'TEST17.8 adrese propuse');
  PERFORM pg_temp.ok(NOT (public.fn_red_mail_are_legatura_juridica('00000000-0000-0000-0000-00000000aa05') IS NOT TRUE
    ), 'TEST17.9 adrese propuse');
  RAISE NOTICE 'TEST17 OK';
END $t$;

-- TEST18: ștergerea finală a auditului — refuzată înainte de golire / cu dedup deschis netransferat; permisă cu dedup închis; evenimentele pleacă în cascadă
DO $t$ BEGIN
  PERFORM pg_temp.ok(NOT (NOT pg_temp.refuza('DELETE FROM public.red_mail_primite WHERE id = ''00000000-0000-0000-0000-00000000aa05''', '42501')
     -- m3: golit, verificat_absent, HMAC NULL + dedup_incheiat_la (TEST12) → auditul se poate șterge; evenimentele lui în cascadă
    ), 'TEST18.1 stergerea finala');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.accepta('INSERT INTO public.red_mail_evenimente (tip, primit_id) VALUES (''golire'', ''00000000-0000-0000-0000-00000000aa03'')')
    ), 'TEST18.2 stergerea finala');
  PERFORM pg_temp.ok(NOT (NOT pg_temp.incearca('DELETE FROM public.red_mail_primite WHERE id = ''00000000-0000-0000-0000-00000000aa03''')
    ), 'TEST18.3 stergerea finala');
  RAISE NOTICE 'TEST18 OK';
END $t$;

SELECT 'DRY local 20261130j + 20261130k: TOATE TESTELE OK' AS rezultat;
