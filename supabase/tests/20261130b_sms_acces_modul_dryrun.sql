-- DRY 20261130b_sms_acces_modul (r2). Runner: o singura tranzactie ANULATA (migrare 20261130b + teste + revenire + ROLLBACK), izolare
-- READ COMMITTED, peste 20261130a aplicata. Identitati reale prin helperii pg_temp (ca la 20261130a), cu JWT-ul fiecarui cont:
--   own  = owner-ul (profiles.is_owner);
--   ured = cont non-owner cu Redari editor / admin  -> primeste aici SMS editor (= utilizator, cu Redari);
--   util = cont non-owner fara Redari editor / admin -> primeste aici SMS editor (= utilizator, fara Redari);
--   tst  = alt cont non-owner cu Redari editor / admin -> primeste aici SMS viewer (= test: Redari refuzat chiar daca are Redari);
--   fara = cont non-owner fara drept SMS; plus anon si service_role.
-- Drepturile SMS de mai sus se dau DOAR in tranzactia de proba (INSERT in user_module_access, anulat la final): nu ramane nimic.
-- Date: fictive (telefoane 0700…, proiect TEST-SMS-DRY-B). Singura citire de date reale: id-urile a 3 / 6 angajati activi cu mobil
-- (lotul T1 al contului test, care se anuleaza fara rezervare) si numaratoarea lor, fara niciun telefon afisat. Niciun furnizor apelat:
-- fn_sms_rezerva doar rezerva, in tranzactia anulata, si numai pe loturile cu telefoane fictive.
-- r2: P1 citirea directa (sms_mesaje / sms_loturi / sms_v_loturi) doar owner, istoricul prin fn_sms_loturi_lista (TEST9);
-- P2-02 testul doar pe loturile lui (TEST6b / TEST7 / TEST8); P2-01 bugetul zilnic al contului de test (TEST7b); P2-03 Redari la vedere
-- doar cu comutatorul pornit (TEST6c).
-- r3: coada contului de test (TEST5d la creare, TEST12 la aprobare), revalidarea creatorului la rezervare (TEST7c), testul nu vede un
-- lot inconsistent de peste 5 (TEST12: scris de mentenanta cu triggerele oprite, doar in tranzactia de proba).
-- r4: previzualizarea merge cu coada plina (TEST5d); promovarea test -> utilizator nu opreste loturile de test deja facute, limitele
-- lor raman (TEST7d: pleaca si se numara in bugetul de test; TEST7c: bugetul atins; TEST12: coada la aprobare).
CREATE FUNCTION pg_temp.s3b_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- ramane postgres (fara rolul authenticated), dar cu JWT-ul unui cont: testeaza triggerele cand scrierea ocoleste RPC-urile
CREATE FUNCTION pg_temp.s3b_jwt(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $h$;
CREATE FUNCTION pg_temp.s3b_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.s3b_eroare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
CREATE FUNCTION pg_temp.s3b_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('s3b.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.s3b_s(p text, v text) RETURNS void LANGUAGE sql AS $h$ SELECT set_config('s3b.' || p, v, true); $h$;
-- lot fictiv scris direct (nr declarat + telefoanele date), cu identitatea curenta (postgres, eventual cu JWT-ul unui cont)
CREATE FUNCTION pg_temp.s3b_lot(p_cat text, p_nr integer, p_tels text[], p_proiect uuid) RETURNS uuid LANGUAGE plpgsql AS $h$
DECLARE v uuid;
BEGIN
  INSERT INTO public.sms_loturi (categorie, text, proiect_id, nr_destinatari, segmente, cost_estimat_eur)
  VALUES (p_cat, 'Test DRY SMS acces (fictiv)', p_proiect, p_nr, 1, round(p_nr * 0.049, 3)) RETURNING id INTO v;
  INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
  SELECT v, u.t, CASE WHEN p_cat = 'intern' THEN 'angajat' ELSE 'detinator' END, 'fictiv-' || u.o FROM unnest(p_tels) WITH ORDINALITY AS u(t, o);
  RETURN v;
END $h$;
CREATE FUNCTION pg_temp.s3b_ver(p_lot uuid) RETURNS integer LANGUAGE sql STABLE AS $h$ SELECT versiune FROM public.sms_loturi WHERE id = p_lot; $h$;
CREATE FUNCTION pg_temp.s3b_vs() RETURNS integer LANGUAGE sql STABLE AS $h$ SELECT versiune FROM public.sms_setari WHERE id; $h$;
CREATE FUNCTION pg_temp.s3b_tels(p_de integer, p_cate integer) RETURNS text[] LANGUAGE sql IMMUTABLE AS $h$
  SELECT array_agg('+40700000' || lpad((p_de + g)::text, 3, '0') ORDER BY g) FROM generate_series(0, p_cate - 1) g;
$h$;
-- ce vede contul curent din istoric (fn_sms_loturi_lista), restrans la loturile DRY: id-urile, in ordine
CREATE FUNCTION pg_temp.s3b_lista_dry() RETURNS text LANGUAGE sql AS $h$
  SELECT coalesce(string_agg(n.nume, ',' ORDER BY n.nume COLLATE "C"), '')
    FROM jsonb_array_elements(public.fn_sms_loturi_lista(200)) e
    JOIN (SELECT k AS nume, pg_temp.s3b_g(k)::uuid AS id FROM unnest(ARRAY['T1', 'TF', 'TG', 'TH', 'TI', 'TX', 'O6', 'O2', 'R1', 'R2']) k) n ON n.id = (e->>'id')::uuid
$h$;
-- citirea DIRECTA (PostgREST GET) a tabelelor / vederii, cu telefonul complet: pentru non-owner trebuie 0 / 0 / 0
CREATE FUNCTION pg_temp.s3b_direct() RETURNS text LANGUAGE sql AS $h$
  SELECT (SELECT count(*) FROM (SELECT m.lot_id, m.telefon, m.destinatar_id FROM public.sms_mesaje m) x) || '/'
      || (SELECT count(*) FROM public.sms_loturi) || '/' || (SELECT count(*) FROM public.sms_v_loturi)
$h$;
CREATE FUNCTION pg_temp.s3b_lot_din_lista(p_lot uuid) RETURNS jsonb LANGUAGE sql AS $h$
  SELECT e FROM jsonb_array_elements(public.fn_sms_loturi_lista(200)) e WHERE (e->>'id')::uuid = p_lot
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.s3b_ca(uuid, text), pg_temp.s3b_refuza(text, text), pg_temp.s3b_eroare(text), pg_temp.s3b_g(text),
  pg_temp.s3b_s(text, text), pg_temp.s3b_ver(uuid), pg_temp.s3b_vs(), pg_temp.s3b_tels(integer, integer), pg_temp.s3b_lista_dry(),
  pg_temp.s3b_direct(), pg_temp.s3b_lot_din_lista(uuid) TO authenticated, anon, service_role;

-- ── TEST0: garda, identitati, starea de instalare, drepturile de proba, maparea nivelurilor ─────────────────────────────────
DO $t$
DECLARE own uuid; ured uuid; tst uuid; util uuid; fara uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130b_sms_acces_modul:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ured FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO tst FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE AND a.profile_id <> ured ORDER BY a.id LIMIT 1;
  SELECT p.id INTO util FROM public.profiles p WHERE p.is_owner IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari' AND a.access_level IN ('editor', 'admin'))
   ORDER BY p.id LIMIT 1;
  SELECT p.id INTO fara FROM public.profiles p WHERE p.is_owner IS NOT TRUE AND p.id <> util
     AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari' AND a.access_level IN ('editor', 'admin'))
   ORDER BY p.id LIMIT 1;
  IF own IS NULL OR ured IS NULL OR tst IS NULL OR util IS NULL OR fara IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'sms' AND is_active) OR EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'sms') THEN
    RAISE EXCEPTION 'TEST0 FAIL: starea de instalare (cheia sms, fara niciun drept)';
  END IF;
  IF public.fn_sms_nivel_cont(ured) IS NOT NULL OR public.fn_sms_nivel_cont(tst) IS NOT NULL OR public.fn_sms_nivel_cont(own) <> 'owner' THEN
    RAISE EXCEPTION 'TEST0 FAIL: nivel inainte de drepturi';
  END IF;
  PERFORM pg_temp.s3b_s('own', own::text); PERFORM pg_temp.s3b_s('ured', ured::text); PERFORM pg_temp.s3b_s('tst', tst::text);
  PERFORM pg_temp.s3b_s('util', util::text); PERFORM pg_temp.s3b_s('fara', fara::text);
  PERFORM pg_temp.s3b_s('azi', (now() AT TIME ZONE 'Europe/Bucharest')::date::text);
  -- drepturile SMS de proba (doar in tranzactia anulata): editor = utilizator, viewer = test
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ured, 'sms', 'editor'), (util, 'sms', 'editor'), (tst, 'sms', 'viewer');
  UPDATE public.user_module_access SET access_level = 'admin' WHERE profile_id = util AND module = 'sms';
  IF public.fn_sms_nivel_cont(util) IS DISTINCT FROM 'utilizator' THEN RAISE EXCEPTION 'TEST0 FAIL: admin trebuie sa fie utilizator'; END IF;
  UPDATE public.user_module_access SET access_level = 'editor' WHERE profile_id = util AND module = 'sms';
  IF public.fn_sms_nivel_cont(util) IS DISTINCT FROM 'utilizator' OR public.fn_sms_nivel_cont(ured) IS DISTINCT FROM 'utilizator'
     OR public.fn_sms_nivel_cont(tst) IS DISTINCT FROM 'test' OR public.fn_sms_nivel_cont(fara) IS NOT NULL OR public.fn_sms_nivel_cont(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST0 FAIL: maparea nivelurilor';
  END IF;
  IF public.fn_sms_test_buget_zi() <> 10 OR public.fn_sms_test_consum_zi(tst) <> 0 THEN RAISE EXCEPTION 'TEST0 FAIL: bugetul contului de test'; END IF;
  RAISE NOTICE 'TEST0 OK identitati + drepturi de proba (editor = utilizator, viewer = test, admin = utilizator), buget test 10/zi';
END $t$;

-- ── TEST1: fn_sms_nivel pe fiecare identitate; anon, service_role, functiile interne ─────────────────────────────────────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'TEST1 FAIL: owner'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'utilizator' THEN RAISE EXCEPTION 'TEST1 FAIL: utilizator cu Redari'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'utilizator' THEN RAISE EXCEPTION 'TEST1 FAIL: utilizator fara Redari'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'TEST1 FAIL: test'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('fara')::uuid, 'authenticated');
DO $t$
DECLARE q text;
BEGIN
  IF public.fn_sms_nivel() IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL: fara drept'; END IF;
  -- functiile interne nu se apeleaza din aplicatie (nici sondarea altui cont prin uid)
  FOREACH q IN ARRAY ARRAY[format('SELECT public.fn_sms_nivel_cont(%L)', pg_temp.s3b_g('own')), format('SELECT public.fn_sms_redari_modul_cont(%L)', pg_temp.s3b_g('ured')),
      $q$SELECT public.fn_sms_lot_permis('owner', true, true, 'intern', 1, true)$q$, 'SELECT public.fn_sms_cere_nivel()', 'SELECT public.fn_sms_redari_permis()',
      'SELECT public.fn_sms_test_buget_zi()', format('SELECT public.fn_sms_test_consum_zi(%L)', pg_temp.s3b_g('tst')),
      $q$SELECT public.fn_sms_lot_acces(NULL, 'owner', NULL::public.sms_loturi, false)$q$,
      $q$SELECT public.fn_sms_cere_lot(NULL, 'owner', NULL::public.sms_loturi)$q$,
      $q$SELECT public.fn_sms_rezerva(NULL, 1, 'simulator', NULL)$q$] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: authenticated: %', q; END IF;
  END LOOP;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'anon');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_nivel()', 'SELECT public.fn_sms_loturi_lista(50)', 'SELECT public.fn_sms_panou()',
      'SELECT count(*) FROM public.sms_loturi', 'SELECT count(*) FROM public.sms_mesaje', 'SELECT count(*) FROM public.sms_v_loturi'] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: anon: %', q; END IF;
  END LOOP;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_nivel()', 'SELECT public.fn_sms_loturi_lista(50)', 'SELECT public.fn_sms_panou()',
      'SELECT count(*) FROM public.sms_loturi', format('SELECT public.fn_sms_nivel_cont(%L)', pg_temp.s3b_g('own'))] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: service_role: %', q; END IF;
  END LOOP;
  -- rezervarea cu 3 argumente (edge-ul vechi) nu mai exista: edge-ul vechi nu poate trimite nimic (fail-closed)
  IF NOT pg_temp.s3b_refuza($q$SELECT public.fn_sms_rezerva(NULL::uuid, 1, 'simulator')$q$, '42883') THEN RAISE EXCEPTION 'TEST1 FAIL: rezervarea cu 3 argumente'; END IF;
  RAISE NOTICE 'TEST1 OK nivelurile, anon, service_role, functiile interne';
END $t$;

-- ── TEST2: contul fara drept SMS: refuzat de fiecare RPC, nu vede nimic ───────────────────────────────────────────────────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('fara')::uuid, 'authenticated');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_panou()', 'SELECT count(*) FROM public.fn_sms_angajati_lista()', 'SELECT public.fn_sms_loturi_lista(50)',
      $q$SELECT public.fn_sms_lot_intern_creeaza('Test DRY', NULL, NULL, true)$q$, $q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY', gen_random_uuid(), NULL, true)$q$,
      'SELECT public.fn_sms_lot_destinatari(gen_random_uuid())', 'SELECT public.fn_sms_lot_aproba(gen_random_uuid(), 1)',
      $q$SELECT public.fn_sms_lot_anuleaza(gen_random_uuid(), 'x')$q$, 'SELECT public.fn_sms_setari_salveaza(false, 200, 1500, 1)',
      $q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'X', current_date, 1)$q$, $q$SELECT public.fn_sms_optout_seteaza('0700000001', true, 'x')$q$] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST2 FAIL: fara drept: %', q; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.sms_setari) + (SELECT count(*) FROM public.sms_loturi) + (SELECT count(*) FROM public.sms_mesaje)
     + (SELECT count(*) FROM public.sms_v_loturi) + (SELECT count(*) FROM public.sms_optout) + (SELECT count(*) FROM public.sms_dlr) <> 0 THEN
    RAISE EXCEPTION 'TEST2 FAIL: contul fara drept vede date SMS';
  END IF;
  RAISE NOTICE 'TEST2 OK fara drept SMS: refuzat, 0 randuri';
END $t$;

-- ── TEST3: setarile (kill-switch, plafoane, Redari, opt-out) DOAR owner; panoul fara setari pentru utilizator / test ─────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_panou();
  IF j->>'nivel' <> 'owner' OR NOT (j ? 'plafon_zi') OR NOT (j ? 'versiune') OR NOT (j ? 'kill_motiv') OR (j->>'max_destinatari')::integer <> 5000
     OR (j->>'redari_modul')::boolean IS NOT TRUE OR (j->>'ramas_zi') IS NULL THEN
    RAISE EXCEPTION 'TEST3 FAIL: panoul owner-ului %', j;
  END IF;
  PERFORM pg_temp.s3b_s('vs0', (j->>'versiune'));
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; q text;
BEGIN
  j := public.fn_sms_panou();
  IF j->>'nivel' <> 'test' OR (j->>'max_destinatari')::integer <> 5 OR (j->>'redari_modul')::boolean IS NOT FALSE
     OR (j->>'buget_test_zi')::integer IS DISTINCT FROM 10 OR (j->>'ramas_zi')::integer > 10
     OR (j->>'coada_test_max')::integer IS DISTINCT FROM 10 OR (j->>'coada_test')::integer IS DISTINCT FROM 0
     OR j ?| ARRAY['plafon_zi', 'plafon_luna', 'consum_zi', 'kill_motiv', 'versiune', 'redari_autorizare_nr', 'redari_autorizare_data'] THEN
    RAISE EXCEPTION 'TEST3 FAIL: panoul contului test %', j;
  END IF;
  FOREACH q IN ARRAY ARRAY[format('SELECT public.fn_sms_setari_salveaza(false, 200, 1500, %s)', pg_temp.s3b_g('vs0')),
      format($q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-X', current_date, %s)$q$, pg_temp.s3b_g('vs0')),
      $q$SELECT public.fn_sms_optout_seteaza('0700000001', true, 'x')$q$] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST3 FAIL: test schimba setari: %', q; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.sms_setari) + (SELECT count(*) FROM public.sms_optout) + (SELECT count(*) FROM public.sms_dlr) <> 0 THEN
    RAISE EXCEPTION 'TEST3 FAIL: test vede setari / opt-out / DLR';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; q text;
BEGIN
  j := public.fn_sms_panou();
  IF j->>'nivel' <> 'utilizator' OR (j->>'max_destinatari')::integer <> 5000 OR (j->>'redari_modul')::boolean IS NOT TRUE OR j->>'buget_test_zi' IS NOT NULL
     OR j ?| ARRAY['plafon_zi', 'plafon_luna', 'consum_zi', 'kill_motiv', 'versiune', 'redari_autorizare_nr'] THEN
    RAISE EXCEPTION 'TEST3 FAIL: panoul utilizatorului %', j;
  END IF;
  FOREACH q IN ARRAY ARRAY[format('SELECT public.fn_sms_setari_salveaza(false, 200, 1500, %s)', pg_temp.s3b_g('vs0')),
      format($q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-X', current_date, %s)$q$, pg_temp.s3b_g('vs0')),
      $q$SELECT public.fn_sms_optout_seteaza('0700000001', true, 'x')$q$] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST3 FAIL: utilizator schimba setari: %', q; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.sms_setari) + (SELECT count(*) FROM public.sms_optout) + (SELECT count(*) FROM public.sms_dlr) <> 0 THEN
    RAISE EXCEPTION 'TEST3 FAIL: utilizator vede setari / opt-out / DLR';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (public.fn_sms_panou()->>'redari_modul')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'TEST3 FAIL: utilizator fara Redari'; END IF;
  RAISE NOTICE 'TEST3 OK setarile doar owner; panoul fara setari pentru utilizator / test (test: buget 10/zi)';
END $t$;

-- ── TEST4: pregatire — owner porneste trimiterea (plafon relativ) si autorizeaza Redari; fixture Redari fictiv; angajati ──────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_panou();
  PERFORM public.fn_sms_setari_salveaza(false, (j->>'consum_zi')::integer + 50, (j->>'consum_luna')::integer + 100, pg_temp.s3b_vs());
  PERFORM public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-B', pg_temp.s3b_g('azi')::date, pg_temp.s3b_vs());
  IF (SELECT kill_switch OR NOT redari_autorizat FROM public.sms_setari) THEN RAISE EXCEPTION 'TEST4 FAIL: pregatire setari'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$
DECLARE v_pr uuid; v_uat uuid; v_p uuid; d1 uuid; d2 uuid; v_n integer;
BEGIN
  INSERT INTO public.red_proiecte (cod, denumire, activ) VALUES ('TEST-SMS-DRY-B', 'Proiect test SMS acces (DRY, fictiv)', true) RETURNING id INTO v_pr;
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet) VALUES (v_pr, 'UAT Test Sms B', 'TSB', 'Test') RETURNING id INTO v_uat;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_uat, 'TSB-0001', 1) RETURNING id INTO v_p;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms B Unu', 'TEST SMS B UNU', 'proprietar') RETURNING id INTO d1;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms B Doi', 'TEST SMS B DOI', 'coproprietar') RETURNING id INTO d2;
  INSERT INTO public.red_detinatori_contact (detinator_id, telefon) VALUES (d1, '0700000051'), (d2, '0700000052');
  INSERT INTO public.red_convocari (detinator_id, canal) VALUES (d1, 'telefon'), (d2, 'telefon');
  PERFORM pg_temp.s3b_s('pr', v_pr::text);
  -- angajati activi cu mobil RO valid, un telefon o singura data, fara opt-out (doar id-uri si numaratori, niciun telefon afisat)
  CREATE TEMP TABLE s3b_ang ON COMMIT DROP AS
    SELECT DISTINCT ON (t.tel) e.id, t.tel FROM public.employees e CROSS JOIN LATERAL (SELECT public.fn_sms_tel_normalizat(e.telefon) AS tel) t
     WHERE e.active IS TRUE AND t.tel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = t.tel AND o.activ)
     ORDER BY t.tel, e.id;
  SELECT count(*) INTO v_n FROM s3b_ang;
  IF v_n < 6 THEN RAISE EXCEPTION 'TEST4 FAIL: fixture — sub 6 angajati activi cu mobil (%), testul „peste 5” nu se poate face', v_n; END IF;
  PERFORM pg_temp.s3b_s('n_mobil', v_n::text);
  PERFORM pg_temp.s3b_s('ang3', (SELECT array_agg(id ORDER BY tel)::text FROM (SELECT id, tel FROM s3b_ang ORDER BY tel LIMIT 3) x));
  PERFORM pg_temp.s3b_s('ang6', (SELECT array_agg(id ORDER BY tel)::text FROM (SELECT id, tel FROM s3b_ang ORDER BY tel LIMIT 6) x));
  RAISE NOTICE 'TEST4 OK pregatire (% angajati cu mobil; fixture Redari fictiv)', v_n;
END $t$;

-- ── TEST5: contul test la CREARE: maximum 5 destinatari, fara Redari (RPC + triggere); loturile lui si ale altui cont de test ──
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; e text;
BEGIN
  j := public.fn_sms_lot_intern_creeaza('Test DRY: sedinta maine la 8.', NULL, pg_temp.s3b_g('ang3')::integer[], true);
  IF (j->>'nr_destinatari')::integer <> 3 OR j->>'nivel' <> 'test' OR j->>'plafon_zi' IS NOT NULL OR j->>'lot_id' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST5 FAIL: previzualizare test (3) %', j - 'text_final';
  END IF;
  e := pg_temp.s3b_eroare($q$SELECT public.fn_sms_lot_intern_creeaza('Test DRY: toti.', NULL, NULL, true)$q$);
  IF e IS NULL OR e NOT LIKE '42501%maximum 5%' THEN RAISE EXCEPTION 'TEST5 FAIL: test previzualizeaza toti angajatii (%)', e; END IF;
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_intern_creeaza('Test DRY: sase.', NULL, %L::integer[], true)$q$, pg_temp.s3b_g('ang6')), '42501')
     OR NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_intern_creeaza('Test DRY: sase.', NULL, %L::integer[], false)$q$, pg_temp.s3b_g('ang6')), '42501') THEN
    RAISE EXCEPTION 'TEST5 FAIL: test creeaza lot de 6';
  END IF;
  e := pg_temp.s3b_eroare(format($q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY redari.', %L, NULL, true)$q$, pg_temp.s3b_g('pr')));
  IF e IS NULL OR e NOT LIKE '42501%nu face loturi Redari%' THEN RAISE EXCEPTION 'TEST5 FAIL: test previzualizeaza Redari (%)', e; END IF;
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY redari.', %L, NULL, false)$q$, pg_temp.s3b_g('pr')), '42501') THEN
    RAISE EXCEPTION 'TEST5 FAIL: test creeaza lot Redari';
  END IF;
  j := public.fn_sms_lot_intern_creeaza('Test DRY: sedinta maine la 8.', NULL, pg_temp.s3b_g('ang3')::integer[], false);
  PERFORM pg_temp.s3b_s('T1', j->>'lot_id');
  -- (r2: contul de test nu citeste direct sms_loturi; lotul se vede prin istoricul RPC)
  IF (SELECT x.l->>'creat_de' IS DISTINCT FROM pg_temp.s3b_g('tst') OR x.l->>'creat_nivel' IS DISTINCT FROM 'test' OR x.l->>'stare' <> 'draft'
             OR (x.l->>'nr_destinatari')::integer <> 3 OR (x.l->>'al_meu')::boolean IS NOT TRUE OR (x.l->>'actiune_permisa')::boolean IS NOT TRUE
        FROM pg_temp.s3b_lot_din_lista((j->>'lot_id')::uuid) AS x(l)) IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST5 FAIL: lotul contului test';
  END IF;
  j := public.fn_sms_lot_destinatari((j->>'lot_id')::uuid);
  IF j->>'nivel' <> 'test' OR (j->>'actiune_permisa')::boolean IS NOT TRUE OR jsonb_array_length(j->'destinatari') <> 3 OR j->>'creat_nivel' <> 'test'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'destinatari') d WHERE d ? 'telefon' OR d->>'telefon_mascat' !~ '^07[*]{2} [*]{3} [0-9]{3}$') THEN
    RAISE EXCEPTION 'TEST5 FAIL: lista fixata pentru test';
  END IF;
  RAISE NOTICE 'TEST5a OK test la creare: 3 da, toti / 6 / Redari refuzat';
END $t$;
-- aparare in adancime: scrierea directa (ocolind RPC-ul) cu JWT-ul contului test e oprita de triggere
SELECT pg_temp.s3b_jwt(pg_temp.s3b_g('tst')::uuid);
DO $t$ BEGIN
  IF NOT pg_temp.s3b_refuza(format('SELECT pg_temp.s3b_lot(%L, 6, %L::text[], NULL)', 'intern', pg_temp.s3b_tels(201, 6)), '42501') THEN
    RAISE EXCEPTION 'TEST5 FAIL: trigger — lot test declarat cu 6';
  END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT pg_temp.s3b_lot(%L, 5, %L::text[], NULL)', 'intern', pg_temp.s3b_tels(211, 6)), '42501') THEN
    RAISE EXCEPTION 'TEST5 FAIL: trigger — al 6-lea mesaj intr-un lot test';
  END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT pg_temp.s3b_lot(%L, 1, %L::text[], %L)', 'redari', pg_temp.s3b_tels(221, 1), pg_temp.s3b_g('pr')), '42501') THEN
    RAISE EXCEPTION 'TEST5 FAIL: trigger — lot Redari al contului test';
  END IF;
  -- loturile fictive ale contului test: TF (3), TG (4) — coada lui ajunge la 10 cu T1 (3); bugetul zilnic in TEST7b
  PERFORM pg_temp.s3b_s('TF', pg_temp.s3b_lot('intern', 3, pg_temp.s3b_tels(231, 3), NULL)::text);
  PERFORM pg_temp.s3b_s('TG', pg_temp.s3b_lot('intern', 4, pg_temp.s3b_tels(261, 4), NULL)::text);
  IF (SELECT count(*) FROM public.sms_loturi WHERE id IN (pg_temp.s3b_g('TF')::uuid, pg_temp.s3b_g('TG')::uuid)
        AND creat_nivel = 'test' AND creat_de = pg_temp.s3b_g('tst')::uuid) <> 2 THEN
    RAISE EXCEPTION 'TEST5 FAIL: trigger — nivelul creatorului';
  END IF;
  RAISE NOTICE 'TEST5b OK triggerele tin limita de 5 si Redari pentru test si fara RPC';
END $t$;
-- al doilea cont de test (contul util, trecut temporar pe viewer): lotul TX e „test”, dar NU al lui tst (P2-02)
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.user_module_access SET access_level = 'viewer' WHERE profile_id = pg_temp.s3b_g('util')::uuid AND module = 'sms';
END $t$;
SELECT pg_temp.s3b_jwt(pg_temp.s3b_g('util')::uuid);
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('TX', pg_temp.s3b_lot('intern', 2, pg_temp.s3b_tels(281, 2), NULL)::text);
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.user_module_access SET access_level = 'editor' WHERE profile_id = pg_temp.s3b_g('util')::uuid AND module = 'sms';
  IF (SELECT creat_nivel IS DISTINCT FROM 'test' OR creat_de IS DISTINCT FROM pg_temp.s3b_g('util')::uuid FROM public.sms_loturi WHERE id = pg_temp.s3b_g('TX')::uuid)
     OR public.fn_sms_nivel_cont(pg_temp.s3b_g('util')::uuid) IS DISTINCT FROM 'utilizator' THEN
    RAISE EXCEPTION 'TEST5 FAIL: lotul altui cont de test';
  END IF;
  RAISE NOTICE 'TEST5c OK lotul TX al altui cont de test (creat_nivel test, creat_de alt cont)';
END $t$;
-- r3 (P2-01 b): coada contului de test = 10 mesaje nerezervate (T1 3 + TF 3 + TG 4); al 11-lea e refuzat la creare (RPC si trigger)
DO $t$ BEGIN
  IF public.fn_sms_test_coada(pg_temp.s3b_g('tst')::uuid) <> 10 OR public.fn_sms_test_coada(pg_temp.s3b_g('util')::uuid) <> 2 THEN
    RAISE EXCEPTION 'TEST5d FAIL: coada contului de test dupa creare (% / %)', public.fn_sms_test_coada(pg_temp.s3b_g('tst')::uuid), public.fn_sms_test_coada(pg_temp.s3b_g('util')::uuid);
  END IF;
END $t$;
SELECT pg_temp.s3b_jwt(pg_temp.s3b_g('tst')::uuid);
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3b_eroare(format('SELECT pg_temp.s3b_lot(%L, 1, %L::text[], NULL)', 'intern', pg_temp.s3b_tels(301, 1)));
  IF e IS NULL OR e NOT LIKE '42501%cel mult 10 mesaje nerezervate%' THEN RAISE EXCEPTION 'TEST5d FAIL: trigger — al 11-lea mesaj in coada (%)', e; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE e text; j jsonb;
BEGIN
  e := pg_temp.s3b_eroare(format($q$SELECT public.fn_sms_lot_intern_creeaza('Test DRY: unul.', NULL, %L::integer[], false)$q$, (pg_temp.s3b_g('ang3')::integer[])[1:1]));
  IF e IS NULL OR e NOT LIKE '42501%cel mult 10 mesaje nerezervate%' THEN RAISE EXCEPTION 'TEST5d FAIL: RPC — al 11-lea mesaj in coada (%)', e; END IF;
  -- r4: previzualizarea nu e refuzata de coada (nu ia lock-ul contului); arata doar capacitatea libera
  j := public.fn_sms_lot_intern_creeaza('Test DRY: unul.', NULL, (pg_temp.s3b_g('ang3')::integer[])[1:1], true);
  IF (j->>'preview')::boolean IS NOT TRUE OR (j->>'nr_destinatari')::integer <> 1 OR (j->>'coada_libera')::integer IS DISTINCT FROM 0 OR j->>'lot_id' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST5d FAIL: previzualizarea cu coada plina %', j - 'text_final';
  END IF;
  RAISE NOTICE 'TEST5d OK coada contului de test: 10 nerezervate, al 11-lea refuzat la creare (RPC si trigger); previzualizarea merge (coada libera 0)';
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');

-- ── TEST6: APROBARE — test doar pe loturile LUI (P2-02); utilizator fara Redari nu vede Redari; Redari doar cu comutatorul (P2-03) ──
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('O6', pg_temp.s3b_lot('intern', 6, pg_temp.s3b_tels(241, 6), NULL)::text);
  PERFORM pg_temp.s3b_s('O2', pg_temp.s3b_lot('intern', 2, pg_temp.s3b_tels(251, 2), NULL)::text);
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_redari_creeaza('Test DRY: reamintire sesiune.', pg_temp.s3b_g('pr')::uuid, NULL, false);
  PERFORM pg_temp.s3b_s('R1', j->>'lot_id');
  j := public.fn_sms_lot_redari_creeaza('Test DRY: al doilea lot.', pg_temp.s3b_g('pr')::uuid, NULL, false);
  PERFORM pg_temp.s3b_s('R2', j->>'lot_id');
  IF (SELECT count(*) FROM jsonb_array_elements(public.fn_sms_loturi_lista(200)) e
       WHERE (e->>'id')::uuid IN (pg_temp.s3b_g('R1')::uuid, pg_temp.s3b_g('R2')::uuid) AND e->>'categorie' = 'redari'
         AND e->>'creat_nivel' = 'utilizator' AND (e->>'nr_destinatari')::integer = 2 AND (e->>'al_meu')::boolean) <> 2 THEN
    RAISE EXCEPTION 'TEST6 FAIL: utilizatorul cu Redari creeaza loturi Redari';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3b_eroare(format($q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY redari.', %L, NULL, true)$q$, pg_temp.s3b_g('pr')));
  IF e IS NULL OR e NOT LIKE '42501%modulul Redari%' THEN RAISE EXCEPTION 'TEST6 FAIL: utilizator fara Redari creeaza Redari (%)', e; END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('R1')), 'P0002')
     OR NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('R1')), 'P0002') THEN
    RAISE EXCEPTION 'TEST6 FAIL: utilizator fara Redari vede / aproba lotul Redari';
  END IF;
  -- utilizatorul vede si loturile conturilor de test (owner-ul si utilizatorul raman ca in r1)
  IF jsonb_array_length(public.fn_sms_lot_destinatari(pg_temp.s3b_g('TX')::uuid)->'destinatari') <> 2 THEN RAISE EXCEPTION 'TEST6 FAIL: utilizator nu vede lotul de test'; END IF;
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('O6')::uuid, 1);
  IF (SELECT x.l->>'stare' <> 'aprobat' OR x.l->>'aprobat_nivel' IS DISTINCT FROM 'utilizator' OR x.l->>'aprobat_de' IS DISTINCT FROM pg_temp.s3b_g('util')
        FROM pg_temp.s3b_lot_din_lista(pg_temp.s3b_g('O6')::uuid) AS x(l)) IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST6 FAIL: aprobarea utilizatorului (6 destinatari)';
  END IF;
  RAISE NOTICE 'TEST6a OK utilizator: intern aprobat (6), lotul de test vizibil, Redari fara modulul Redari = invizibil / refuzat';
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; q text;
BEGIN
  -- P2-02: loturile altora (mentenanta, utilizator, alt cont de test, Redari) = inexistente pentru test, la vedere si la actiune
  FOREACH q IN ARRAY ARRAY[format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('O6')), format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('O2')),
      format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('O2')), format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('TX')),
      format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('TX')), format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('R1')),
      format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('R2'))] LOOP
    IF NOT pg_temp.s3b_refuza(q, 'P0002') THEN RAISE EXCEPTION 'TEST6 FAIL: test vede / aproba lotul altuia: %', q; END IF;
  END LOOP;
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 99)', pg_temp.s3b_g('T1')), '40001') THEN RAISE EXCEPTION 'TEST6 FAIL: aprobare pe alta versiune'; END IF;
  j := public.fn_sms_lot_aproba(pg_temp.s3b_g('T1')::uuid, 1);
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('TF')::uuid, 1);
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('TG')::uuid, 1);
  IF (SELECT count(*) FROM jsonb_array_elements(public.fn_sms_loturi_lista(200)) e
       WHERE (e->>'id')::uuid IN (pg_temp.s3b_g('T1')::uuid, pg_temp.s3b_g('TF')::uuid, pg_temp.s3b_g('TG')::uuid)
         AND e->>'stare' = 'aprobat' AND e->>'aprobat_nivel' = 'test' AND e->>'aprobat_de' = pg_temp.s3b_g('tst')) <> 3 OR j->>'aprobat_nivel' <> 'test' THEN
    RAISE EXCEPTION 'TEST6 FAIL: aprobarea contului test pe loturile lui';
  END IF;
  RAISE NOTICE 'TEST6b OK test: aproba doar loturile lui; ale mentenantei / utilizatorului / altui cont de test / Redari = P0002';
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_lot_aproba(pg_temp.s3b_g('O2')::uuid, 1)->>'aprobat_nivel' <> 'owner' THEN RAISE EXCEPTION 'TEST6 FAIL: aprobarea owner-ului'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_destinatari(pg_temp.s3b_g('R1')::uuid);
  IF jsonb_array_length(j->'destinatari') <> 2 OR (j->>'actiune_permisa')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'TEST6 FAIL: lista Redari pentru utilizator'; END IF;
  j := public.fn_sms_lot_aproba(pg_temp.s3b_g('R1')::uuid, 1);
  IF j->>'aprobat_autorizare_nr' <> 'TGZ-DRY-B' OR j->>'aprobat_nivel' <> 'utilizator' THEN RAISE EXCEPTION 'TEST6 FAIL: aprobare Redari de utilizator %', j; END IF;
  IF pg_temp.s3b_lista_dry() <> 'O2,O6,R1,R2,T1,TF,TG,TX' THEN RAISE EXCEPTION 'TEST6 FAIL: istoricul utilizatorului cu Redari (comutator pornit) %', pg_temp.s3b_lista_dry(); END IF;
END $t$;
-- P2-03: comutatorul Redari oprit de owner => loturile Redari dispar pentru utilizator (la vedere si la actiune); owner-ul le vede mereu
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(false, NULL, NULL, pg_temp.s3b_vs());
  IF pg_temp.s3b_lista_dry() <> 'O2,O6,R1,R2,T1,TF,TG,TX' THEN RAISE EXCEPTION 'TEST6 FAIL: owner cu comutatorul oprit %', pg_temp.s3b_lista_dry(); END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  IF pg_temp.s3b_lista_dry() <> 'O2,O6,T1,TF,TG,TX' THEN RAISE EXCEPTION 'TEST6 FAIL: utilizatorul vede Redari cu comutatorul oprit %', pg_temp.s3b_lista_dry(); END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('R1')), 'P0002')
     OR NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('R2')), 'P0002')
     OR NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, pg_temp.s3b_g('R2')), 'P0002') THEN
    RAISE EXCEPTION 'TEST6 FAIL: utilizator pe Redari cu comutatorul oprit';
  END IF;
  e := pg_temp.s3b_eroare(format($q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY.', %L, NULL, true)$q$, pg_temp.s3b_g('pr')));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST6 FAIL: Redari cu comutatorul oprit (%)', e; END IF;
  RAISE NOTICE 'TEST6c OK comutatorul Redari oprit: utilizatorul nu mai vede / atinge loturile Redari, owner-ul da';
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  -- nici mentenanta (postgres fara JWT) nu aproba
  IF NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET stare = 'aprobat' WHERE id = %L$q$, pg_temp.s3b_g('R2')), '42501') THEN
    RAISE EXCEPTION 'TEST6 FAIL: postgres fara JWT aproba';
  END IF;
  RAISE NOTICE 'TEST6d OK fara cont SMS nu se aproba';
END $t$;

-- ── TEST7: REZERVARE (edge, service_role) cu apelantul: test doar loturile lui; invizibil = fara_lot; fara drept = refuz ──────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-B', pg_temp.s3b_g('azi')::date, pg_temp.s3b_vs());
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb; v text;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TF')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 3 OR (j->>'ramase')::integer <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: test trimite lotul lui de 3 (%)', j->>'motiv'; END IF;
  FOREACH v IN ARRAY ARRAY['O6', 'TX', 'R1'] LOOP
    j := public.fn_sms_rezerva(pg_temp.s3b_g(v)::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
    IF j->>'motiv' <> 'fara_lot' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: test trimite lotul % al altuia (%)', v, j->>'motiv'; END IF;
  END LOOP;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('R1')::uuid, 5, 'simulator', pg_temp.s3b_g('util')::uuid);
  IF j->>'motiv' <> 'fara_lot' THEN RAISE EXCEPTION 'TEST7 FAIL: utilizator fara Redari trimite Redari (%)', j->>'motiv'; END IF;
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_rezerva(NULL, 5, 'simulator', %L)$q$, pg_temp.s3b_g('tst')), '22023') THEN
    RAISE EXCEPTION 'TEST7 FAIL: un cont trimite fara lot (cron)';
  END IF;
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_rezerva(%L, 5, 'simulator', %L)$q$, pg_temp.s3b_g('O6'), pg_temp.s3b_g('fara')), '42501') THEN
    RAISE EXCEPTION 'TEST7 FAIL: cont fara drept SMS trimite';
  END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('O6')::uuid, 2, 'simulator', pg_temp.s3b_g('util')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 2 THEN RAISE EXCEPTION 'TEST7 FAIL: utilizator trimite lotul de 6 (%)', j->>'motiv'; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('O2')::uuid, 5, 'simulator', NULL);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 2 THEN RAISE EXCEPTION 'TEST7 FAIL: cronul intern pe lotul aprobat de owner (%)', j->>'motiv'; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('O6')::uuid, 5, 'simulator', pg_temp.s3b_g('own')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 4 OR (j->>'ramase')::integer <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: owner (%)', j->>'motiv'; END IF;
  RAISE NOTICE 'TEST7a OK rezervarea verifica nivelul apelantului (test: lotul lui da, O6 / TX / R1 fara_lot; fara drept refuzat)';
END $t$;
-- P2-01: bugetul zilnic al contului de test (10 / zi, peste toate loturile lui): al 11-lea mesaj e refuzat, oricine porneste trimiterea
-- ── TEST7d (r4): promovarea viewer -> editor (test -> utilizator) NU opreste lotul de test deja aprobat; limitele lui raman ─────
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.user_module_access SET access_level = 'editor' WHERE profile_id = pg_temp.s3b_g('tst')::uuid AND module = 'sms';
  IF public.fn_sms_nivel_cont(pg_temp.s3b_g('tst')::uuid) IS DISTINCT FROM 'utilizator' THEN RAISE EXCEPTION 'TEST7d FAIL: promovarea'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TG')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 4 THEN RAISE EXCEPTION 'TEST7d FAIL: lotul de test al contului promovat nu pleaca (%)', j->>'motiv'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  -- mesajele 4-7 ale zilei se numara tot in bugetul de test al creatorului (limitele lotului dupa creat_nivel, nu dupa nivelul actual)
  IF public.fn_sms_test_consum_zi(pg_temp.s3b_g('tst')::uuid) <> 7 THEN RAISE EXCEPTION 'TEST7d FAIL: bugetul de test nu mai numara lotul'; END IF;
  UPDATE public.user_module_access SET access_level = 'viewer' WHERE profile_id = pg_temp.s3b_g('tst')::uuid AND module = 'sms';
  RAISE NOTICE 'TEST7d OK promovarea test -> utilizator: lotul de test aprobat pleaca, si se numara in bugetul de test (7 / 10)';
END $t$;
-- coada eliberata de rezervari (T1 3 ramase): TH (5) incape acum (3 + 5 = 8)
SELECT pg_temp.s3b_jwt(pg_temp.s3b_g('tst')::uuid);
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('TH', pg_temp.s3b_lot('intern', 5, pg_temp.s3b_tels(271, 5), NULL)::text);
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('TH')::uuid, 1);
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TH')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 3 OR (j->>'ramase')::integer <> 2 THEN
    RAISE EXCEPTION 'TEST7b FAIL: mesajele 8-10 (doar 3 din 5) (%, %)', j->>'motiv', jsonb_array_length(j->'mesaje');
  END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TH')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'buget_test_zi' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST7b FAIL: al 11-lea mesaj al zilei (%)', j->>'motiv'; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TH')::uuid, 5, 'simulator', pg_temp.s3b_g('own')::uuid);
  IF j->>'motiv' <> 'buget_test_zi' THEN RAISE EXCEPTION 'TEST7b FAIL: owner-ul ocoleste bugetul contului de test (%)', j->>'motiv'; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TH')::uuid, 5, 'simulator', NULL);
  IF j->>'motiv' <> 'buget_test_zi' THEN RAISE EXCEPTION 'TEST7b FAIL: cronul ocoleste bugetul contului de test (%)', j->>'motiv'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF public.fn_sms_test_consum_zi(pg_temp.s3b_g('tst')::uuid) <> 10
     OR (SELECT count(*) FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
          WHERE l.creat_de = pg_temp.s3b_g('tst')::uuid AND l.creat_nivel = 'test' AND m.rezervat_la IS NOT NULL AND m.stare = 'necunoscut') <> 10
     OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = pg_temp.s3b_g('O6')::uuid AND stare = 'necunoscut') <> 6
     OR (SELECT stare FROM public.sms_loturi WHERE id = pg_temp.s3b_g('O6')::uuid) <> 'coada_golita'
     OR EXISTS (SELECT 1 FROM public.sms_mesaje WHERE lot_id = pg_temp.s3b_g('T1')::uuid AND stare <> 'in_coada')
     OR public.fn_sms_test_coada(pg_temp.s3b_g('tst')::uuid) <> 5 THEN
    RAISE EXCEPTION 'TEST7b FAIL: consumul contului de test (10 necunoscut) / coada 5 / starile (lotul T1, cu angajati reali, nu se rezerva)';
  END IF;
END $t$;
-- anularea si recrearea NU elibereaza bugetul
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_anuleaza(pg_temp.s3b_g('TH')::uuid, 'DRY buget');
  IF (j->>'mesaje_anulate')::integer <> 2 OR (j->>'deja_predate')::integer <> 3 THEN RAISE EXCEPTION 'TEST7b FAIL: anularea TH %', j; END IF;
END $t$;
SELECT pg_temp.s3b_jwt(pg_temp.s3b_g('tst')::uuid);
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('TI', pg_temp.s3b_lot('intern', 1, pg_temp.s3b_tels(291, 1), NULL)::text);
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('TI')::uuid, 1);
  IF (public.fn_sms_panou()->>'ramas_zi')::integer <> 0 THEN RAISE EXCEPTION 'TEST7b FAIL: panoul contului test arata buget ramas'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TI')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'buget_test_zi' THEN RAISE EXCEPTION 'TEST7b FAIL: lotul recreat elibereaza bugetul (%)', j->>'motiv'; END IF;
END $t$;
-- aparare in adancime: si rezervarea directa (ocolind fn_sms_rezerva) e oprita de triggerul mesajelor
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.sms_loturi SET stare = 'in_trimitere' WHERE id = pg_temp.s3b_g('TI')::uuid;
  IF NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = 'simulator' WHERE lot_id = %L$q$, pg_temp.s3b_g('TI')), '42501') THEN
    RAISE EXCEPTION 'TEST7b FAIL: trigger — rezervare directa peste buget';
  END IF;
  RAISE NOTICE 'TEST7b OK bugetul contului de test: 10 / zi, al 11-lea refuzat (si prin owner / cron / trigger), anularea + recrearea nu il elibereaza';
END $t$;

-- ── TEST7c (r3, P2-01 a): dreptul de test retras => loturile lui aprobate nu mai pleaca (nici prin cron, nici prin owner) ────────
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$
DECLARE e text;
BEGIN
  -- anularea a eliberat coada (TH: 2 scoase), dar nu bugetul
  IF public.fn_sms_test_coada(pg_temp.s3b_g('tst')::uuid) <> 4 OR public.fn_sms_test_consum_zi(pg_temp.s3b_g('tst')::uuid) <> 10 THEN
    RAISE EXCEPTION 'TEST7c FAIL: anularea elibereaza coada (4 = T1 3 + TI 1), nu bugetul (10)';
  END IF;
  DELETE FROM public.user_module_access WHERE profile_id = pg_temp.s3b_g('tst')::uuid AND module = 'sms';
  IF public.fn_sms_nivel_cont(pg_temp.s3b_g('tst')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'TEST7c FAIL: dreptul nu s-a retras'; END IF;
  e := pg_temp.s3b_eroare(format($q$UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = 'simulator' WHERE lot_id = %L$q$, pg_temp.s3b_g('TI')));
  IF e IS NULL OR e NOT LIKE '42501%nu mai are niciun drept SMS%' THEN RAISE EXCEPTION 'TEST7c FAIL: trigger — rezervare directa dupa retragere (%)', e; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TI')::uuid, 5, 'simulator', pg_temp.s3b_g('own')::uuid);
  IF j->>'motiv' <> 'creator_fara_drept' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST7c FAIL: owner trimite lotul unui test revocat (%)', j->>'motiv'; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TI')::uuid, 5, 'simulator', NULL);
  IF j->>'motiv' <> 'creator_fara_drept' THEN RAISE EXCEPTION 'TEST7c FAIL: cronul trimite lotul unui test revocat (%)', j->>'motiv'; END IF;
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_rezerva(%L, 5, 'simulator', %L)$q$, pg_temp.s3b_g('TI'), pg_temp.s3b_g('tst')), '42501') THEN
    RAISE EXCEPTION 'TEST7c FAIL: contul revocat porneste trimiterea';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  -- r4: dreptul redat ca editor (utilizator): lotul nu mai e blocat de creator, dar bugetul de test (10 / zi) ramane atins
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (pg_temp.s3b_g('tst')::uuid, 'sms', 'editor');
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TI')::uuid, 5, 'simulator', pg_temp.s3b_g('own')::uuid);
  IF j->>'motiv' <> 'buget_test_zi' THEN RAISE EXCEPTION 'TEST7c FAIL: dupa promovare, bugetul de test nu mai e aplicat (%)', j->>'motiv'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.user_module_access SET access_level = 'viewer' WHERE profile_id = pg_temp.s3b_g('tst')::uuid AND module = 'sms';
  RAISE NOTICE 'TEST7c OK dreptul test retras: lotul lui aprobat nu mai pleaca (owner / cron: creator_fara_drept, trigger: 42501), refacut pentru restul';
END $t$;

-- ── TEST8: ANULARE — test doar pe loturile lui; utilizator fara Redari nu atinge Redari ──────────────────────────────────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['O6', 'TX', 'R2'] LOOP
    IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, pg_temp.s3b_g(v)), 'P0002') THEN RAISE EXCEPTION 'TEST8 FAIL: test anuleaza lotul % al altuia', v; END IF;
  END LOOP;
  j := public.fn_sms_lot_anuleaza(pg_temp.s3b_g('T1')::uuid, 'DRY test');
  IF (j->>'mesaje_anulate')::integer <> 3 OR j->>'anulat_nivel' <> 'test' THEN RAISE EXCEPTION 'TEST8 FAIL: anularea contului test %', j; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, pg_temp.s3b_g('R2')), 'P0002') THEN RAISE EXCEPTION 'TEST8 FAIL: utilizator fara Redari anuleaza Redari'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_anuleaza(pg_temp.s3b_g('R2')::uuid, 'DRY utilizator');
  IF (j->>'mesaje_anulate')::integer <> 2 OR j->>'anulat_nivel' <> 'utilizator' THEN RAISE EXCEPTION 'TEST8 FAIL: anularea utilizatorului %', j; END IF;
  RAISE NOTICE 'TEST8 OK anulare pe niveluri (test doar pe loturile lui)';
END $t$;

-- ── TEST9 (P1): citirea DIRECTA = doar owner (telefonul complet nu ajunge la utilizator / test); istoricul prin fn_sms_loturi_lista ──
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.s3b_lista_dry() <> 'O2,O6,R1,R2,T1,TF,TG,TH,TI,TX' THEN RAISE EXCEPTION 'TEST9 FAIL: istoricul owner-ului %', pg_temp.s3b_lista_dry(); END IF;
  IF (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = pg_temp.s3b_g('TF')::uuid AND telefon ~ '^[+]407[0-9]{8}$') <> 3 THEN
    RAISE EXCEPTION 'TEST9 FAIL: owner-ul citeste direct sms_mesaje (ca in 20261130a)';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.s3b_direct() <> '0/0/0' THEN RAISE EXCEPTION 'TEST9 FAIL: utilizatorul cu Redari citeste direct %', pg_temp.s3b_direct(); END IF;
  IF pg_temp.s3b_lista_dry() <> 'O2,O6,R1,R2,T1,TF,TG,TH,TI,TX' THEN RAISE EXCEPTION 'TEST9 FAIL: istoricul utilizatorului cu Redari %', pg_temp.s3b_lista_dry(); END IF;
  IF (pg_temp.s3b_lot_din_lista(pg_temp.s3b_g('R2')::uuid)->>'n_anulat')::integer <> 2 THEN RAISE EXCEPTION 'TEST9 FAIL: numaratorile Redari pentru utilizator'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  IF pg_temp.s3b_direct() <> '0/0/0' THEN RAISE EXCEPTION 'TEST9 FAIL: utilizatorul citeste direct %', pg_temp.s3b_direct(); END IF;
  IF pg_temp.s3b_lista_dry() <> 'O2,O6,T1,TF,TG,TH,TI,TX' THEN RAISE EXCEPTION 'TEST9 FAIL: istoricul utilizatorului fara Redari %', pg_temp.s3b_lista_dry(); END IF;
  j := pg_temp.s3b_lot_din_lista(pg_temp.s3b_g('O6')::uuid);
  IF (j->>'n_necunoscut')::integer <> 6 OR (j->>'actiune_permisa')::boolean IS NOT TRUE OR j->>'aprobat_nivel' <> 'utilizator' THEN
    RAISE EXCEPTION 'TEST9 FAIL: numaratorile din sursa autorizata %', j;
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  -- „GET /rest/v1/sms_mesaje?select=lot_id,telefon,destinatar_id” cu JWT-ul contului de test: 0 randuri (si pe loturile LUI)
  IF pg_temp.s3b_direct() <> '0/0/0' OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = pg_temp.s3b_g('TF')::uuid) <> 0 THEN
    RAISE EXCEPTION 'TEST9 FAIL: contul de test citeste direct %', pg_temp.s3b_direct();
  END IF;
  IF pg_temp.s3b_lista_dry() <> 'T1,TF,TG,TH,TI' THEN RAISE EXCEPTION 'TEST9 FAIL: istoricul contului de test (doar loturile lui) %', pg_temp.s3b_lista_dry(); END IF;
  j := public.fn_sms_loturi_lista(200);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(j) e WHERE e ? 'telefon' OR e ? 'telefoane' OR e::text ~ '[+]407[0-9]{8}') THEN
    RAISE EXCEPTION 'TEST9 FAIL: istoricul contine telefoane';
  END IF;
  j := pg_temp.s3b_lot_din_lista(pg_temp.s3b_g('TF')::uuid);
  IF (j->>'n_necunoscut')::integer <> 3 OR (j->>'al_meu')::boolean IS NOT TRUE OR j->>'creat_nivel' <> 'test' THEN RAISE EXCEPTION 'TEST9 FAIL: numaratorile lotului TF %', j; END IF;
  -- mesajele lotului (lista fixata) prin RPC: telefon MASCAT, starea si momentul rezervarii
  j := public.fn_sms_lot_destinatari(pg_temp.s3b_g('TF')::uuid);
  IF jsonb_array_length(j->'destinatari') <> 3 OR j::text ~ '[+]407[0-9]{8}'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'destinatari') d
                 WHERE d ? 'telefon' OR d->>'telefon_mascat' !~ '^07[*]{2} [*]{3} [0-9]{3}$' OR d->>'stare' <> 'necunoscut' OR d->>'rezervat_la' IS NULL) THEN
    RAISE EXCEPTION 'TEST9 FAIL: mesajele lotului TF prin RPC';
  END IF;
  RAISE NOTICE 'TEST9 OK P1: citirea directa 0/0/0 pentru utilizator / test; istoricul si mesajele prin RPC, cu numaratori si telefon mascat';
END $t$;

-- ── TEST10: cine a creat / aprobat / anulat ramane pe lot; nivelul nu se rescrie ────────────────────────────────────────────
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT creat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid OR aprobat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid
         OR anulat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid OR (creat_nivel, aprobat_nivel, anulat_nivel) IS DISTINCT FROM ('test', 'test', 'test')
        FROM public.sms_loturi WHERE id = pg_temp.s3b_g('T1')::uuid)
     OR (SELECT creat_nivel IS NOT NULL OR aprobat_nivel IS DISTINCT FROM 'owner' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('O2')::uuid)
     OR (SELECT creat_de IS DISTINCT FROM pg_temp.s3b_g('ured')::uuid OR (creat_nivel, aprobat_nivel) IS DISTINCT FROM ('utilizator', 'utilizator')
           OR aprobat_autorizare_nr IS DISTINCT FROM 'TGZ-DRY-B' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('R1')::uuid)
     OR (SELECT anulat_de IS DISTINCT FROM pg_temp.s3b_g('ured')::uuid OR anulat_nivel IS DISTINCT FROM 'utilizator' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('R2')::uuid)
     OR (SELECT creat_de IS DISTINCT FROM pg_temp.s3b_g('util')::uuid OR creat_nivel IS DISTINCT FROM 'test' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('TX')::uuid) THEN
    RAISE EXCEPTION 'TEST10 FAIL: urma pe lot';
  END IF;
  IF NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET creat_nivel = 'owner' WHERE id = %L$q$, pg_temp.s3b_g('T1')), '23514')
     OR NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET creat_de = %L WHERE id = %L$q$, pg_temp.s3b_g('tst'), pg_temp.s3b_g('TX')), '23514')
     OR NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET aprobat_nivel = 'test' WHERE id = %L$q$, pg_temp.s3b_g('O2')), '23514') THEN
    RAISE EXCEPTION 'TEST10 FAIL: nivelul / creatorul de pe lot se poate rescrie';
  END IF;
  RAISE NOTICE 'TEST10 OK creat / aprobat / anulat (cine + nivel) raman pe lot';
END $t$;

-- ── TEST11: owner si utilizator nu au limita de 5 (comportamentul 20261130a ramane pentru ei) ─────────────────────────────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_intern_creeaza('Test DRY: toti.', NULL, NULL, true);
  IF (j->>'nr_destinatari')::integer <> pg_temp.s3b_g('n_mobil')::integer OR j->>'nivel' <> 'owner' OR j->>'plafon_zi' IS NULL THEN
    RAISE EXCEPTION 'TEST11 FAIL: owner previzualizeaza toti %', j - 'text_final';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_intern_creeaza('Test DRY: toti.', NULL, NULL, true);
  IF (j->>'nr_destinatari')::integer <> pg_temp.s3b_g('n_mobil')::integer OR j->>'nivel' <> 'utilizator' OR j->>'plafon_zi' IS NOT NULL
     OR (SELECT count(*) FROM public.fn_sms_angajati_lista()) < 6 THEN
    RAISE EXCEPTION 'TEST11 FAIL: utilizator previzualizeaza toti %', j - 'text_final';
  END IF;
  RAISE NOTICE 'TEST11 OK owner / utilizator: fara limita de 5';
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');

-- ── TEST12 (r3): lot de test INCONSISTENT (6 mesaje, scris de mentenanta cu triggerele oprite, doar in tranzactia de proba) =
-- invizibil contului de test (P3-01); coada peste plafon => aprobarea refuzata (P2-01 b); anularea elibereaza coada ─────────────
SELECT pg_temp.s3b_jwt(pg_temp.s3b_g('tst')::uuid);
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('TK', pg_temp.s3b_lot('intern', 1, pg_temp.s3b_tels(311, 1), NULL)::text);
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$
DECLARE v_z uuid; v_z2 uuid;
BEGIN
  ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
  ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
  INSERT INTO public.sms_loturi (categorie, text, nr_destinatari, segmente, cost_estimat_eur, creat_de, creat_nivel)
  VALUES ('intern', 'Test DRY SMS acces (fictiv)', 6, 1, 0.294, pg_temp.s3b_g('tst')::uuid, 'test') RETURNING id INTO v_z;
  INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
  SELECT v_z, t, 'angajat', 'fictiv-' || o FROM unnest(pg_temp.s3b_tels(321, 6)) WITH ORDINALITY AS u(t, o);
  INSERT INTO public.sms_loturi (categorie, text, nr_destinatari, segmente, cost_estimat_eur, creat_de, creat_nivel)
  VALUES ('intern', 'Test DRY SMS acces (fictiv)', 3, 1, 0.147, pg_temp.s3b_g('tst')::uuid, 'test') RETURNING id INTO v_z2;
  INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
  SELECT v_z2, t, 'angajat', 'fictiv-' || o FROM unnest(pg_temp.s3b_tels(331, 3)) WITH ORDINALITY AS u(t, o);
  ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
  ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
  PERFORM pg_temp.s3b_s('TZ', v_z::text); PERFORM pg_temp.s3b_s('TZ2', v_z2::text);
  IF public.fn_sms_test_coada(pg_temp.s3b_g('tst')::uuid) <> 11 THEN
    RAISE EXCEPTION 'TEST12 FAIL: pregatire coada (%)', public.fn_sms_test_coada(pg_temp.s3b_g('tst')::uuid);
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  IF pg_temp.s3b_lot_din_lista(pg_temp.s3b_g('TZ')::uuid) IS NOT NULL
     OR NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('TZ')), 'P0002')
     OR NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('TZ')), 'P0002') THEN
    RAISE EXCEPTION 'TEST12 FAIL: contul de test vede lotul lui inconsistent de 6';
  END IF;
  e := pg_temp.s3b_eroare(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('TK')));
  IF e IS NULL OR e NOT LIKE '42501%cel mult 10 mesaje nerezervate%' THEN RAISE EXCEPTION 'TEST12 FAIL: aprobarea cu coada de 11 (%)', e; END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF public.fn_sms_rezerva(pg_temp.s3b_g('TZ')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid)->>'motiv' <> 'fara_lot' THEN
    RAISE EXCEPTION 'TEST12 FAIL: contul de test trimite lotul inconsistent';
  END IF;
END $t$;
-- r4: si dupa promovarea test -> utilizator, aprobarea lotului lui de test respecta coada (limitele dupa creat_nivel)
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.user_module_access SET access_level = 'editor' WHERE profile_id = pg_temp.s3b_g('tst')::uuid AND module = 'sms';
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('TK')), '42501') THEN
    RAISE EXCEPTION 'TEST12 FAIL: contul promovat aproba peste coada de test';
  END IF;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.user_module_access SET access_level = 'viewer' WHERE profile_id = pg_temp.s3b_g('tst')::uuid AND module = 'sms';
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('TK')), '42501') THEN
    RAISE EXCEPTION 'TEST12 FAIL: owner-ul aproba peste coada contului de test';
  END IF;
  PERFORM public.fn_sms_lot_anuleaza(pg_temp.s3b_g('TZ2')::uuid, 'DRY coada');
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_lot_aproba(pg_temp.s3b_g('TK')::uuid, 1)->>'stare' <> 'aprobat' THEN RAISE EXCEPTION 'TEST12 FAIL: aprobarea dupa eliberarea cozii'; END IF;
  RAISE NOTICE 'TEST12 OK lotul de test inconsistent (6) e invizibil testului; coada 11 refuza aprobarea (si owner-ului); anularea elibereaza coada';
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
