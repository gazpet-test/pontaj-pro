-- DRY 20261130b_sms_acces_modul. Runner: o singura tranzactie ANULATA (migrare 20261130b + teste + revenire + ROLLBACK), izolare
-- READ COMMITTED, peste 20261130a aplicata. Identitati reale prin helperii pg_temp (ca la 20261130a):
--   own  = owner-ul (profiles.is_owner);
--   ured = cont non-owner cu Redari editor / admin  -> primeste aici SMS editor (= utilizator, cu Redari);
--   util = cont non-owner fara Redari editor / admin -> primeste aici SMS editor (= utilizator, fara Redari);
--   tst  = alt cont non-owner cu Redari editor / admin -> primeste aici SMS viewer (= test: Redari refuzat chiar daca are Redari);
--   fara = cont non-owner fara drept SMS; plus anon si service_role.
-- Drepturile SMS de mai sus se dau DOAR in tranzactia de proba (INSERT in user_module_access, anulat la final): nu ramane nimic.
-- Date: fictive (telefoane 0700…, proiect TEST-SMS-DRY-B). Singura citire de date reale: id-urile a 3 / 6 angajati activi cu mobil
-- (lotul contului test, care se anuleaza fara rezervare) si numaratoarea lor, fara niciun telefon afisat. Niciun furnizor apelat:
-- fn_sms_rezerva doar rezerva, in tranzactia anulata, si numai pe loturile cu telefoane fictive.
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
GRANT EXECUTE ON FUNCTION pg_temp.s3b_ca(uuid, text), pg_temp.s3b_refuza(text, text), pg_temp.s3b_eroare(text), pg_temp.s3b_g(text),
  pg_temp.s3b_s(text, text), pg_temp.s3b_ver(uuid), pg_temp.s3b_vs(), pg_temp.s3b_tels(integer, integer) TO authenticated, anon, service_role;

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
  RAISE NOTICE 'TEST0 OK identitati + drepturi de proba (editor = utilizator, viewer = test, admin = utilizator)';
END $t$;

-- ── TEST1: fn_sms_nivel / fn_sms_redari_permis pe fiecare identitate; anon, service_role, functiile interne ────────────────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'owner' OR NOT public.fn_sms_redari_permis() THEN RAISE EXCEPTION 'TEST1 FAIL: owner'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'utilizator' OR NOT public.fn_sms_redari_permis() THEN RAISE EXCEPTION 'TEST1 FAIL: utilizator cu Redari'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'utilizator' OR public.fn_sms_redari_permis() THEN RAISE EXCEPTION 'TEST1 FAIL: utilizator fara Redari'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_sms_nivel() IS DISTINCT FROM 'test' OR public.fn_sms_redari_permis() THEN RAISE EXCEPTION 'TEST1 FAIL: test (are Redari, dar nu are voie la Redari)'; END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('fara')::uuid, 'authenticated');
DO $t$
DECLARE q text;
BEGIN
  IF public.fn_sms_nivel() IS NOT NULL OR public.fn_sms_redari_permis() THEN RAISE EXCEPTION 'TEST1 FAIL: fara drept'; END IF;
  -- functiile interne nu se apeleaza din aplicatie (nici sondarea altui cont prin uid)
  FOREACH q IN ARRAY ARRAY[format('SELECT public.fn_sms_nivel_cont(%L)', pg_temp.s3b_g('own')), format('SELECT public.fn_sms_redari_modul_cont(%L)', pg_temp.s3b_g('ured')),
      $q$SELECT public.fn_sms_lot_permis('owner', true, 'intern', 1, true)$q$, 'SELECT public.fn_sms_cere_nivel()',
      format($q$SELECT public.fn_sms_cere_lot(%L, 'owner', 'intern', 1)$q$, pg_temp.s3b_g('own')),
      $q$SELECT public.fn_sms_rezerva(NULL, 1, 'simulator', NULL)$q$] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: authenticated: %', q; END IF;
  END LOOP;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'anon');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_nivel()', 'SELECT public.fn_sms_redari_permis()', 'SELECT public.fn_sms_panou()',
      'SELECT count(*) FROM public.sms_loturi', 'SELECT count(*) FROM public.sms_mesaje', 'SELECT count(*) FROM public.sms_v_loturi'] LOOP
    IF NOT pg_temp.s3b_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: anon: %', q; END IF;
  END LOOP;
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_nivel()', 'SELECT public.fn_sms_panou()', 'SELECT count(*) FROM public.sms_loturi',
      format('SELECT public.fn_sms_nivel_cont(%L)', pg_temp.s3b_g('own'))] LOOP
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
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_panou()', 'SELECT count(*) FROM public.fn_sms_angajati_lista()',
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
  IF j->>'nivel' <> 'utilizator' OR (j->>'max_destinatari')::integer <> 5000 OR (j->>'redari_modul')::boolean IS NOT TRUE
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
  RAISE NOTICE 'TEST3 OK setarile doar owner; panoul fara setari pentru utilizator / test';
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

-- ── TEST5: contul test la CREARE: maximum 5 destinatari, fara Redari (RPC + triggere) ────────────────────────────────────────
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
  IF (SELECT creat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid OR creat_nivel IS DISTINCT FROM 'test' OR stare <> 'draft' OR nr_destinatari <> 3
        FROM public.sms_loturi WHERE id = (j->>'lot_id')::uuid) IS NOT FALSE
     OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = (j->>'lot_id')::uuid) <> 3 THEN
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
  PERFORM pg_temp.s3b_s('TF', pg_temp.s3b_lot('intern', 3, pg_temp.s3b_tels(231, 3), NULL)::text);
  IF (SELECT creat_nivel IS DISTINCT FROM 'test' OR creat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid FROM public.sms_loturi WHERE id = pg_temp.s3b_g('TF')::uuid) THEN
    RAISE EXCEPTION 'TEST5 FAIL: trigger — nivelul creatorului';
  END IF;
  RAISE NOTICE 'TEST5b OK triggerele tin limita de 5 si Redari pentru test si fara RPC';
END $t$;

-- ── TEST6: APROBARE — test doar pe loturi interne <= 5; utilizator fara Redari nu vede Redari; nivelul ramane pe lot ─────────
SELECT pg_temp.s3b_ca(NULL, 'postgres');
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
  IF (SELECT count(*) FROM public.sms_loturi WHERE id IN (pg_temp.s3b_g('R1')::uuid, pg_temp.s3b_g('R2')::uuid) AND categorie = 'redari'
        AND creat_nivel = 'utilizator' AND nr_destinatari = 2) <> 2 THEN
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
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('O6')::uuid, 1);
  IF (SELECT stare <> 'aprobat' OR aprobat_nivel IS DISTINCT FROM 'utilizator' OR aprobat_de IS DISTINCT FROM pg_temp.s3b_g('util')::uuid
        FROM public.sms_loturi WHERE id = pg_temp.s3b_g('O6')::uuid) THEN
    RAISE EXCEPTION 'TEST6 FAIL: aprobarea utilizatorului (6 destinatari)';
  END IF;
  RAISE NOTICE 'TEST6a OK utilizator: intern aprobat (6), Redari fara modulul Redari = invizibil / refuzat';
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; e text;
BEGIN
  -- lista fixata a unui lot intern de 6: vizibila, dar fara drept de actiune pentru test
  j := public.fn_sms_lot_destinatari(pg_temp.s3b_g('O6')::uuid);
  IF (j->>'actiune_permisa')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'TEST6 FAIL: test are actiune pe lotul de 6'; END IF;
  -- lotul intern de 2 (scris de mentenanta, fara nivel): test il poate aproba; nivelul aprobarii ramane „test”
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('O2')::uuid, 1);
  e := pg_temp.s3b_eroare(format('SELECT public.fn_sms_lot_aproba(%L, %s)', pg_temp.s3b_g('O6'), pg_temp.s3b_ver(pg_temp.s3b_g('O6')::uuid)));
  IF e IS NULL OR e NOT LIKE '42501%maximum 5%' THEN RAISE EXCEPTION 'TEST6 FAIL: test pe lotul de 6 (%)', e; END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('R2')), 'P0002')
     OR NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s3b_g('R1')), 'P0002') THEN
    RAISE EXCEPTION 'TEST6 FAIL: test vede / aproba Redari';
  END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 99)', pg_temp.s3b_g('T1')), '40001') THEN RAISE EXCEPTION 'TEST6 FAIL: aprobare pe alta versiune'; END IF;
  j := public.fn_sms_lot_aproba(pg_temp.s3b_g('T1')::uuid, 1);
  PERFORM public.fn_sms_lot_aproba(pg_temp.s3b_g('TF')::uuid, 1);
  IF (SELECT count(*) FROM public.sms_loturi WHERE id IN (pg_temp.s3b_g('T1')::uuid, pg_temp.s3b_g('TF')::uuid) AND stare = 'aprobat'
        AND aprobat_nivel = 'test' AND aprobat_de = pg_temp.s3b_g('tst')::uuid) <> 2 OR j->>'aprobat_nivel' <> 'test' THEN
    RAISE EXCEPTION 'TEST6 FAIL: aprobarea contului test';
  END IF;
  RAISE NOTICE 'TEST6b OK test: aproba doar interne <= 5; lotul de 6 refuzat; Redari invizibil';
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_destinatari(pg_temp.s3b_g('R1')::uuid);
  IF jsonb_array_length(j->'destinatari') <> 2 OR (j->>'actiune_permisa')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'TEST6 FAIL: lista Redari pentru utilizator'; END IF;
  j := public.fn_sms_lot_aproba(pg_temp.s3b_g('R1')::uuid, 1);
  IF j->>'aprobat_autorizare_nr' <> 'TGZ-DRY-B' OR j->>'aprobat_nivel' <> 'utilizator' THEN RAISE EXCEPTION 'TEST6 FAIL: aprobare Redari de utilizator %', j; END IF;
END $t$;
-- utilizator: Redari doar cat comutatorul e pornit de owner (regula existenta)
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(false, NULL, NULL, pg_temp.s3b_vs());
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3b_eroare(format($q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY.', %L, NULL, true)$q$, pg_temp.s3b_g('pr')));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST6 FAIL: Redari cu comutatorul oprit (%)', e; END IF;
  IF NOT pg_temp.s3b_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s3b_g('R2')), '42501') THEN RAISE EXCEPTION 'TEST6 FAIL: aprobare Redari cu comutatorul oprit'; END IF;
  RAISE NOTICE 'TEST6c OK utilizator cu Redari: doar cu comutatorul pornit de owner';
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  -- nici mentenanta (postgres fara JWT) nu aproba
  IF NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET stare = 'aprobat' WHERE id = %L$q$, pg_temp.s3b_g('R2')), '42501') THEN
    RAISE EXCEPTION 'TEST6 FAIL: postgres fara JWT aproba';
  END IF;
  RAISE NOTICE 'TEST6d OK fara cont SMS nu se aproba';
END $t$;

-- ── TEST7: REZERVARE (edge, service_role) cu apelantul: test doar <= 5 intern; invizibil = fara_lot; fara drept = refuz ─────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-B', pg_temp.s3b_g('azi')::date, pg_temp.s3b_vs());
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb; e text;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s3b_g('TF')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 3 OR (j->>'ramase')::integer <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: test trimite lotul lui de 3 (%)', j->>'motiv'; END IF;
  e := pg_temp.s3b_eroare(format($q$SELECT public.fn_sms_rezerva(%L, 5, 'simulator', %L)$q$, pg_temp.s3b_g('O6'), pg_temp.s3b_g('tst')));
  IF e IS NULL OR e NOT LIKE '42501%maximum 5%' THEN RAISE EXCEPTION 'TEST7 FAIL: test trimite lotul de 6 (%)', e; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('R1')::uuid, 5, 'simulator', pg_temp.s3b_g('tst')::uuid);
  IF j->>'motiv' <> 'fara_lot' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: test trimite Redari (%)', j->>'motiv'; END IF;
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
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 2 THEN RAISE EXCEPTION 'TEST7 FAIL: cronul intern pe lotul aprobat de test (%)', j->>'motiv'; END IF;
  j := public.fn_sms_rezerva(pg_temp.s3b_g('O6')::uuid, 5, 'simulator', pg_temp.s3b_g('own')::uuid);
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 4 OR (j->>'ramase')::integer <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: owner (%)', j->>'motiv'; END IF;
  RAISE NOTICE 'TEST7 OK rezervarea verifica nivelul apelantului (test 3 da / 6 refuzat / Redari fara_lot; fara drept refuzat)';
END $t$;
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = pg_temp.s3b_g('TF')::uuid AND stare = 'necunoscut' AND rezervat_la IS NOT NULL) <> 3
     OR (SELECT stare FROM public.sms_loturi WHERE id = pg_temp.s3b_g('O6')::uuid) <> 'coada_golita'
     OR EXISTS (SELECT 1 FROM public.sms_mesaje WHERE lot_id = pg_temp.s3b_g('T1')::uuid AND stare <> 'in_coada') THEN
    RAISE EXCEPTION 'TEST7 FAIL: stari dupa rezervare (lotul T1, cu angajati reali, nu se rezerva)';
  END IF;
END $t$;

-- ── TEST8: ANULARE — test doar pe loturile lui de <= 5; utilizator fara Redari nu atinge Redari ─────────────────────────────
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, pg_temp.s3b_g('O6')), '42501') THEN RAISE EXCEPTION 'TEST8 FAIL: test anuleaza lotul de 6'; END IF;
  IF NOT pg_temp.s3b_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, pg_temp.s3b_g('R2')), 'P0002') THEN RAISE EXCEPTION 'TEST8 FAIL: test anuleaza Redari'; END IF;
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
  RAISE NOTICE 'TEST8 OK anulare pe niveluri';
END $t$;

-- ── TEST9: RLS pe istoric / mesaje / vedere: owner + nivelurile SMS (test: doar interne; utilizator fara Redari: fara Redari) ──
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('dry', ARRAY[pg_temp.s3b_g('T1'), pg_temp.s3b_g('TF'), pg_temp.s3b_g('O6'), pg_temp.s3b_g('O2'), pg_temp.s3b_g('R1'), pg_temp.s3b_g('R2')]::text);
END $t$;
CREATE FUNCTION pg_temp.s3b_vede() RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT (SELECT count(*) FROM public.sms_loturi WHERE id = ANY (pg_temp.s3b_g('dry')::uuid[])) || '/'
      || (SELECT count(*) FROM public.sms_v_loturi WHERE id = ANY (pg_temp.s3b_g('dry')::uuid[])) || '/'
      || (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = ANY (pg_temp.s3b_g('dry')::uuid[])) || '/'
      || (SELECT count(*) FROM public.sms_loturi WHERE categorie = 'redari') || '/'
      || (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = pg_temp.s3b_g('R1')::uuid) || '/'
      || coalesce((SELECT n_necunoscut FROM public.sms_v_loturi WHERE id = pg_temp.s3b_g('O6')::uuid), -1)
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.s3b_vede() TO authenticated;
DO $t$ BEGIN
  PERFORM pg_temp.s3b_s('redari_toate', (SELECT count(*) FROM public.sms_loturi WHERE categorie = 'redari')::text);
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.s3b_vede() <> '6/6/18/' || pg_temp.s3b_g('redari_toate') || '/2/6' THEN RAISE EXCEPTION 'TEST9 FAIL: owner vede %', pg_temp.s3b_vede(); END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('ured')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.s3b_vede() <> '6/6/18/' || pg_temp.s3b_g('redari_toate') || '/2/6' THEN RAISE EXCEPTION 'TEST9 FAIL: utilizator cu Redari vede %', pg_temp.s3b_vede(); END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('util')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.s3b_vede() <> '4/4/14/0/0/6' THEN RAISE EXCEPTION 'TEST9 FAIL: utilizator fara Redari vede %', pg_temp.s3b_vede(); END IF;
END $t$;
SELECT pg_temp.s3b_ca(pg_temp.s3b_g('tst')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.s3b_vede() <> '4/4/14/0/0/6' THEN RAISE EXCEPTION 'TEST9 FAIL: test vede %', pg_temp.s3b_vede(); END IF;
  IF (SELECT creat_nivel || '/' || aprobat_nivel || '/' || anulat_nivel FROM public.sms_v_loturi WHERE id = pg_temp.s3b_g('T1')::uuid) <> 'test/test/test' THEN
    RAISE EXCEPTION 'TEST9 FAIL: nivelurile in vedere';
  END IF;
  RAISE NOTICE 'TEST9 OK RLS: owner / utilizator cu Redari 6 loturi; utilizator fara Redari si test 4 (fara Redari), numaratori identice';
END $t$;

-- ── TEST10: cine a creat / aprobat / anulat ramane pe lot; nivelul nu se rescrie ────────────────────────────────────────────
SELECT pg_temp.s3b_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT creat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid OR aprobat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid
         OR anulat_de IS DISTINCT FROM pg_temp.s3b_g('tst')::uuid OR (creat_nivel, aprobat_nivel, anulat_nivel) IS DISTINCT FROM ('test', 'test', 'test')
        FROM public.sms_loturi WHERE id = pg_temp.s3b_g('T1')::uuid)
     OR (SELECT creat_nivel IS NOT NULL OR aprobat_nivel IS DISTINCT FROM 'test' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('O2')::uuid)
     OR (SELECT creat_de IS DISTINCT FROM pg_temp.s3b_g('ured')::uuid OR (creat_nivel, aprobat_nivel) IS DISTINCT FROM ('utilizator', 'utilizator')
           OR aprobat_autorizare_nr IS DISTINCT FROM 'TGZ-DRY-B' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('R1')::uuid)
     OR (SELECT anulat_de IS DISTINCT FROM pg_temp.s3b_g('ured')::uuid OR anulat_nivel IS DISTINCT FROM 'utilizator' FROM public.sms_loturi WHERE id = pg_temp.s3b_g('R2')::uuid) THEN
    RAISE EXCEPTION 'TEST10 FAIL: urma pe lot';
  END IF;
  IF NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET creat_nivel = 'owner' WHERE id = %L$q$, pg_temp.s3b_g('T1')), '23514')
     OR NOT pg_temp.s3b_refuza(format($q$UPDATE public.sms_loturi SET aprobat_nivel = 'owner' WHERE id = %L$q$, pg_temp.s3b_g('O2')), '23514') THEN
    RAISE EXCEPTION 'TEST10 FAIL: nivelul de pe lot se poate rescrie';
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
