-- DRY 20261130c_sms_redari_sablon. Runner: o singura tranzactie ANULATA (migrare 20261130c + teste + revenire + re-aplicare + ROLLBACK),
-- izolare READ COMMITTED, peste 20261130b aplicata. Identitati reale prin helperii pg_temp (ca la 20261130b), cu JWT-ul fiecarui cont:
--   own  = owner-ul (profiles.is_owner);
--   ured = cont non-owner cu Redari editor / admin  -> primeste aici SMS editor (= utilizator, cu Redari);
--   tst  = alt cont non-owner cu Redari editor / admin -> primeste aici SMS viewer (= test: Redari refuzat chiar daca are Redari);
--   util = cont non-owner fara Redari editor / admin -> primeste aici SMS editor (= utilizator, fara Redari);
--   fara = cont non-owner fara Redari editor / admin si fara drept SMS; plus anon.
-- Drepturile SMS de mai sus se dau DOAR in tranzactia de proba (upsert in user_module_access, anulat la final): nu ramane nimic.
-- Date: DOAR fictive (proiect TEST-SMS-DRY-C, UAT-uri TSC / TSD / TSE / TSF, telefoane 0700000…). Nicio citire de date reale in afara
-- id-urilor de profil. Niciun furnizor apelat: nu se rezerva si nu se trimite nimic.
CREATE FUNCTION pg_temp.s3c_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.s3c_eroare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
CREATE FUNCTION pg_temp.s3c_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('s3c.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.s3c_s(p text, v text) RETURNS void LANGUAGE sql AS $h$ SELECT set_config('s3c.' || p, v, true); $h$;
CREATE FUNCTION pg_temp.s3c_vs() RETURNS integer LANGUAGE sql STABLE AS $h$ SELECT versiune FROM public.sms_setari WHERE id; $h$;
-- apelul RPC-ului cu argumente literale (proiect / UAT din fixture), pentru pg_temp.s3c_eroare
CREATE FUNCTION pg_temp.s3c_q(p_uat text, p_text text, p_preview boolean) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format('SELECT public.fn_sms_lot_redari_sablon_creeaza(%L, %L, %L, %L)', pg_temp.s3c_g('pr'), pg_temp.s3c_g(p_uat), p_text, p_preview)
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.s3c_ca(uuid, text), pg_temp.s3c_eroare(text), pg_temp.s3c_g(text), pg_temp.s3c_s(text, text), pg_temp.s3c_vs(),
  pg_temp.s3c_q(text, text, boolean) TO authenticated, anon;

-- ── TEST0: garda, identitati, drepturile de proba, comutatorul Redari pornit (doar in tranzactia anulata) ───────────────────────
DO $t$
DECLARE own uuid; ured uuid; tst uuid; util uuid; fara uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130c_sms_redari_sablon:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'TEST0 FAIL: izolarea'; END IF;
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
  PERFORM pg_temp.s3c_s('own', own::text); PERFORM pg_temp.s3c_s('ured', ured::text); PERFORM pg_temp.s3c_s('tst', tst::text);
  PERFORM pg_temp.s3c_s('util', util::text); PERFORM pg_temp.s3c_s('fara', fara::text);
  PERFORM pg_temp.s3c_s('azi', (now() AT TIME ZONE 'Europe/Bucharest')::date::text);
  -- drepturile SMS de proba: editor = utilizator, viewer = test; contul fara drept SMS pierde orice rand sms (doar in tranzactia anulata)
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ured, 'sms', 'editor'), (util, 'sms', 'editor'), (tst, 'sms', 'viewer')
  ON CONFLICT (profile_id, module) DO UPDATE SET access_level = excluded.access_level;
  DELETE FROM public.user_module_access WHERE profile_id = fara AND module = 'sms';
  IF public.fn_sms_nivel_cont(ured) IS DISTINCT FROM 'utilizator' OR public.fn_sms_nivel_cont(util) IS DISTINCT FROM 'utilizator'
     OR public.fn_sms_nivel_cont(tst) IS DISTINCT FROM 'test' OR public.fn_sms_nivel_cont(fara) IS NOT NULL OR public.fn_sms_nivel_cont(own) <> 'owner'
     OR public.fn_sms_redari_modul_cont(ured) IS NOT TRUE OR public.fn_sms_redari_modul_cont(util) THEN
    RAISE EXCEPTION 'TEST0 FAIL: maparea nivelurilor';
  END IF;
  RAISE NOTICE 'TEST0 OK garda, identitati, drepturi de proba (utilizator cu / fara Redari, test, fara drept)';
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_panou();
  PERFORM public.fn_sms_setari_salveaza(false, (j->>'consum_zi')::integer + 50, (j->>'consum_luna')::integer + 100, pg_temp.s3c_vs());
  PERFORM public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-C', pg_temp.s3c_g('azi')::date, pg_temp.s3c_vs());
  IF (SELECT kill_switch OR NOT redari_autorizat FROM public.sms_setari) THEN RAISE EXCEPTION 'TEST0 FAIL: pregatire setari'; END IF;
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');

-- ── TEST1: drepturile — RPC-ul nou doar authenticated; textul liber inchis; functiile pure interne ───────────────────────────
DO $t$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_sablon_calc(text,date[],text[],text,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_sablon_model()', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)'::regprocedure)
     OR NOT (SELECT 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'TEST1 FAIL: drepturile functiilor';
  END IF;
  RAISE NOTICE 'TEST1 OK drepturi: sablonul doar authenticated (DEFINER, search_path fixat), textul liber inchis, functiile pure interne';
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare($q$SELECT public.fn_sms_lot_redari_creeaza('Text liber DRY.', gen_random_uuid(), NULL, true)$q$);
  IF e IS NULL OR e NOT LIKE '42501%' THEN RAISE EXCEPTION 'TEST1 FAIL: owner-ul apeleaza inca textul liber (%)', e; END IF;
  e := pg_temp.s3c_eroare($q$SELECT public.fn_sms_redari_sablon_calc('x', NULL, NULL, NULL, current_date)$q$);
  IF e IS NULL OR e NOT LIKE '42501%' THEN RAISE EXCEPTION 'TEST1 FAIL: completarea e apelabila din aplicatie (%)', e; END IF;
  RAISE NOTICE 'TEST1b OK textul liber (fn_sms_lot_redari_creeaza) refuzat 42501 si pentru owner, din aplicatie';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'anon');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare($q$SELECT public.fn_sms_lot_redari_sablon_creeaza(gen_random_uuid(), gen_random_uuid(), NULL, true)$q$);
  IF e IS NULL OR e NOT LIKE '42501%' THEN RAISE EXCEPTION 'TEST1 FAIL: anon (%)', e; END IF;
  RAISE NOTICE 'TEST1c OK anon refuzat';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');

-- ── TEST2: paritatea completarii cu src/sms/sablonRedari.test.js (cazurile P1-P12, azi = 2026-11-10; texte scrise de mana) ─────
DO $t$
DECLARE c record; j jsonb; T text := 'Gazpet pt Transgaz: sesiune redare teren la Primaria %s, %s ora %s. Raspuns si online, cu QR-ul din scrisoare. Tel %s';
  v_lung text := 'Comuna Foarte Lunga De Test Fictiv Cu Nume Compus Din Multe Cuvinte'; v_n integer := 0;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('P1', 'Prunișor', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00 – 16:00', NULL, NULL], '0700 000 111', format(T, 'Prunisor', '12.11', '09:00', '0700 000 111'), NULL::text[]),
    ('P2', 'Jupa', ARRAY['2026-11-05', '2026-11-12', NULL]::date[], ARRAY['08:00-12:00', '9.30 - 15:00', NULL], '0700000112', format(T, 'Jupa', '12.11', '09:30', '0700000112'), NULL),
    ('P3', 'Test', ARRAY['2026-11-10', NULL, NULL]::date[], ARRAY['10:00', NULL, NULL], '+40 700 000 113', format(T, 'Test', '10.11', '10:00', '+40 700 000 113'), NULL),
    ('P4', 'Test', ARRAY['2026-11-01', '2026-11-02', NULL]::date[], ARRAY['09:00', '09:00', NULL], '0700000114', NULL, ARRAY['zi_sesiune']),
    ('P5', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY[NULL, NULL, NULL]::text[], '0700000115', NULL, ARRAY['program_zi']),
    ('P6', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['24:00 - 16:00', NULL, NULL], '0700000116', NULL, ARRAY['program_zi']),
    ('P7', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00', NULL, NULL], '', NULL, ARRAY['telefon_contact']),
    ('P8', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00', NULL, NULL], 'Ion Test', NULL, ARRAY['telefon_contact']),
    ('P9', '  ', ARRAY[NULL, NULL, NULL]::date[], ARRAY[NULL, NULL, NULL]::text[], NULL, NULL, ARRAY['uat_nume', 'zi_sesiune', 'telefon_contact']),
    ('P10', v_lung, ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00', NULL, NULL], '0700 000 120', '>' || format(T, v_lung, '12.11', '09:00', '0700 000 120'), NULL),
    ('P11', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['  9:05 – 12:00', NULL, NULL], '0700000121', format(T, 'Test', '12.11', '09:05', '0700000121'), NULL),
    ('P12', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['9 - 16', NULL, NULL], '0700000122', NULL, ARRAY['program_zi'])
  ) AS x(cod, comuna, zile, programe, tel, astept, lipsuri) LOOP
    j := public.fn_sms_redari_sablon_calc(c.comuna, c.zile, c.programe, c.tel, '2026-11-10');
    IF c.lipsuri IS NOT NULL THEN
      IF (j->>'ok')::boolean OR j->>'motiv' <> 'lipsuri' OR j->>'text' IS NOT NULL OR j->'lipsuri' IS DISTINCT FROM to_jsonb(c.lipsuri) THEN
        RAISE EXCEPTION 'TEST2 FAIL: % lipsuri %', c.cod, j;
      END IF;
    ELSIF left(c.astept, 1) = '>' THEN
      IF (j->>'ok')::boolean OR j->>'motiv' <> 'prea_lung' OR j->>'text' <> substr(c.astept, 2) OR (j->>'lungime')::integer <> length(c.astept) - 1
         OR length(c.astept) - 1 <= 160 THEN
        RAISE EXCEPTION 'TEST2 FAIL: % prea lung %', c.cod, j;
      END IF;
    ELSIF (j->>'ok')::boolean IS NOT TRUE OR j->>'text' <> c.astept OR (j->>'lungime')::integer <> length(c.astept) OR j->'lipsuri' <> '[]'::jsonb
          OR length(c.astept) > 160 THEN
      RAISE EXCEPTION 'TEST2 FAIL: % text %', c.cod, j;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 12 THEN RAISE EXCEPTION 'TEST2 FAIL: % cazuri', v_n; END IF;
  RAISE NOTICE 'TEST2 OK paritate sablon SQL = vitest pe 12 cazuri (zi trecuta -> urmatoarea, ziua de azi, lipsuri, ora invalida, >160)';
END $t$;

-- ── TEST3: fixture fictiv (postgres, fara JWT): proiect, 4 UAT-uri, detinatori pe toate cazurile de excludere ─────────────────
DO $t$
DECLARE v_pr uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; p1 uuid; p2 uuid; p3 uuid; pd uuid; pe uuid; pf uuid; v_azi date := pg_temp.s3c_g('azi')::date;
  d record; v_id uuid;
BEGIN
  INSERT INTO public.red_proiecte (cod, denumire, activ, contact_telefon) VALUES ('TEST-SMS-DRY-C', 'Proiect test SMS sablon (DRY, fictiv)', true, '0700 000 199')
  RETURNING id INTO v_pr;
  -- ziua 1 a trecut (azi - 2) -> sablonul ia ziua 2 (azi + 5), ora din programul zilei 2
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, program_zi1, sesiune_zi2, program_zi2)
  VALUES (v_pr, 'Testeni', 'TSC', 'Test', v_azi - 2, '08:00 - 12:00', v_azi + 5, '09:30 – 16:00') RETURNING id INTO v_c;
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, program_zi1)
  VALUES (v_pr, 'Altul', 'TSD', 'Test', v_azi + 3, '10:00 - 14:00') RETURNING id INTO v_d;
  -- nume foarte lung: textul trece de 160
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, program_zi1)
  VALUES (v_pr, 'Comuna Foarte Lunga De Test Fictiv Cu Nume Compus Din Multe Cuvinte', 'TSE', 'Test', v_azi + 3, '10:00') RETURNING id INTO v_e;
  -- ziua 1 viitoare, dar fara program
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1) VALUES (v_pr, 'Fara Program', 'TSF', 'Test', v_azi + 3) RETURNING id INTO v_f;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_c, 'TSC-0001', 1) RETURNING id INTO p1;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_c, 'TSC-0002', 1) RETURNING id INTO p2;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_c, 'TSC-0003', 1) RETURNING id INTO p3;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_d, 'TSD-0001', 1) RETURNING id INTO pd;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_e, 'TSE-0001', 1) RETURNING id INTO pe;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_f, 'TSF-0001', 1) RETURNING id INTO pf;
  -- (cheie, parcela, nume, telefon, adresa, decedat, convocare activa)
  FOR d IN SELECT * FROM (VALUES
      ('D1', p1, 'Test Sms C Deschis', '0700000201', 'Strada Test 1', false, true),
      ('D2', p2, 'Test Sms C Deschis', '0700000202', 'Strada Test 1', false, true),
      ('D3', p1, 'Test Sms C Raspuns', '0700000203', 'Strada Test 3', false, true),
      ('D4', p2, 'Test Sms C Online', '0700000204', 'Strada Test 4', false, true),
      ('D5', p2, 'Test Sms C Pva', '0700000205', 'Strada Test 5', false, true),
      ('D6', p3, 'Test Sms C Pvb', '0700000206', 'Strada Test 6', false, true),
      ('D7', p1, 'Test Sms C Generat', '0700000207', 'Strada Test 7', false, true),
      ('D8', p1, 'Test Sms C Decedat', '0700000208', 'Strada Test 8', true, true),
      ('D9', p1, 'Test Sms C Sters', '0700000209', 'Strada Test 9', false, true),
      ('D10', p1, 'Test Sms C Optout', '0700000210', 'Strada Test 10', false, true),
      ('D11', p1, 'Test Sms C Fix', '0244 000 000', 'Strada Test 11', false, true),
      ('D12', p1, 'Test Sms C Fara Conv', '0700000212', 'Strada Test 12', false, false),
      ('D13', p2, 'Test Sms C Tel Comun', '0700000207', 'Strada Test 13', false, true),
      ('D14', pd, 'Test Sms C Alt Uat', '0700000214', 'Strada Test 14', false, true),
      ('D15', pe, 'Test Sms C Lung', '0700000215', 'Strada Test 15', false, true),
      ('D16', pf, 'Test Sms C Fara Prog', '0700000216', 'Strada Test 16', false, true)) AS x(k, parcela, nume, tel, strada, decedat, conv) LOOP
    INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate, decedat)
    VALUES (d.parcela, d.nume, upper(d.nume), 'proprietar', d.decedat) RETURNING id INTO v_id;
    INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta, telefon)
    VALUES (v_id, d.strada, 'Sat Test', 'Testeni', 'Test', '000000', true, d.tel);
    IF d.conv THEN INSERT INTO public.red_convocari (detinator_id, canal) VALUES (v_id, 'telefon'); END IF;
    PERFORM pg_temp.s3c_s(d.k, v_id::text);
  END LOOP;
  -- D12: convocarea exista, dar e anulata
  INSERT INTO public.red_convocari (detinator_id, canal, stare, motiv_anulare) VALUES (pg_temp.s3c_g('D12')::uuid, 'telefon', 'anulat', 'DRY fictiv');
  UPDATE public.red_detinatori SET sters_la = now(), sters_motiv = 'DRY fictiv' WHERE id = pg_temp.s3c_g('D9')::uuid;
  -- raspunsuri: inregistrat de operator (scris) si online (prin QR, created_by NULL)
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES (pg_temp.s3c_g('D3')::uuid, 'scris', 'nu_particip_fara_obiectii');
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, zi_sesiune_aleasa, created_by) VALUES (pg_temp.s3c_g('D4')::uuid, 'online', 'particip', v_azi + 5, NULL);
  -- PV A semnat (D5), PV B semnat pe parcela lui D6, PV A doar generat (D7: nu exclude)
  INSERT INTO public.red_procese_verbale (tip, parcela_id, detinator_id, uat_id, tronson, nr_pv, data_pv, stare, semnat_primit_data, fisier_semnat_path)
  VALUES ('A', p2, pg_temp.s3c_g('D5')::uuid, v_c, 1, 'PVA-TSC-9901', v_azi, 'semnat', v_azi, 'dry/fictiv-a.pdf');
  INSERT INTO public.red_procese_verbale (tip, parcela_id, uat_id, tronson, nr_pv, data_pv, stare, semnat_primit_data, fisier_semnat_path, motiv_pv_b)
  VALUES ('B', p3, v_c, 1, 'PVB-TSC-9902', v_azi, 'semnat', v_azi, 'dry/fictiv-b.pdf', 'neprezentat');
  INSERT INTO public.red_procese_verbale (tip, parcela_id, detinator_id, uat_id, tronson, nr_pv, data_pv, stare)
  VALUES ('A', p1, pg_temp.s3c_g('D7')::uuid, v_c, 1, 'PVA-TSC-9903', v_azi, 'generat');
  -- un PV A semnat dar sters (logic) nu exclude: D1 ramane deschis
  INSERT INTO public.red_procese_verbale (tip, parcela_id, detinator_id, uat_id, tronson, nr_pv, data_pv, stare, semnat_primit_data, fisier_semnat_path, sters_la)
  VALUES ('A', p1, pg_temp.s3c_g('D1')::uuid, v_c, 1, 'PVA-TSC-9904', v_azi, 'semnat', v_azi, 'dry/fictiv-c.pdf', now());
  PERFORM pg_temp.s3c_s('pr', v_pr::text); PERFORM pg_temp.s3c_s('uc', v_c::text); PERFORM pg_temp.s3c_s('ud', v_d::text);
  PERFORM pg_temp.s3c_s('ue', v_e::text); PERFORM pg_temp.s3c_s('uf', v_f::text);
  PERFORM pg_temp.s3c_s('text_c', format('Gazpet pt Transgaz: sesiune redare teren la Primaria Testeni, %s ora 09:30. Raspuns si online, cu QR-ul din scrisoare. Tel 0700 000 199',
    to_char(v_azi + 5, 'DD.MM')));
  RAISE NOTICE 'TEST3 OK fixture fictiv: 16 detinatori, 4 UAT-uri (TSC complet, TSD alt UAT, TSE nume lung, TSF fara program)';
END $t$;
-- opt-out pe telefonul lui D10 (owner, prin RPC)
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
SELECT public.fn_sms_optout_seteaza('0700000210', true, 'DRY fictiv') IS NOT NULL AS optout_ok;

-- ── TEST4: previzualizarea (owner): textul din BD, numaratorile pe persoane, motivele excluderii, nimic scris ───────────────────
DO $t$
DECLARE j jsonb; n0 integer := (SELECT count(*) FROM public.sms_loturi);
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, NULL, true);
  IF j->>'text_final' IS DISTINCT FROM pg_temp.s3c_g('text_c') OR (j->>'lungime')::integer <> length(pg_temp.s3c_g('text_c'))
     OR j->>'zi' <> (pg_temp.s3c_g('azi')::date + 5)::text OR (j->>'zi_nr')::integer <> 2 OR j->>'ora' <> '09:30' THEN
    RAISE EXCEPTION 'TEST4 FAIL: textul / ziua %', j;
  END IF;
  -- 9 persoane: D1+D2 (o persoana), D3, D4, D5, D6, D7, D10, D11, D13; D8 decedat, D9 sters, D12 fara convocare activa, D14 alt UAT = in afara
  IF (j->>'candidati')::integer <> 9 OR (j->>'nr_destinatari')::integer <> 2 OR (j->>'excluse_pv_semnat')::integer <> 2
     OR (j->>'excluse_a_raspuns')::integer <> 2 OR (j->>'excluse_fara_mobil')::integer <> 1 OR (j->>'excluse_optout')::integer <> 1
     OR (j->>'excluse_duplicat')::integer <> 1 OR (j->>'cost_estimat_eur')::numeric <> 0.098 OR j->>'lot_id' IS NOT NULL
     OR (j->>'preview')::boolean IS NOT TRUE OR j->>'lot_activ_uat' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST4 FAIL: numaratori %', j - 'text_final';
  END IF;
  IF (SELECT count(*) FROM public.sms_loturi) <> n0 THEN RAISE EXCEPTION 'TEST4 FAIL: previzualizarea a scris un lot'; END IF;
  RAISE NOTICE 'TEST4 OK previzualizare: ziua 1 trecuta -> ziua 2, 2 din 9 persoane (2 PV semnat, 2 au raspuns, 1 fara mobil, 1 opt-out, 1 telefon dublat), 0 scrieri';
END $t$;

-- ── TEST5: crearea (utilizator cu Redari): textul afisat obligatoriu, lista fixata in BD, un SMS de persoana, un lot activ pe UAT ──
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; e text; v_lot uuid; l record;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('uc', 'Gazpet: text vechi afisat', false));
  IF e IS NULL OR e NOT LIKE '40001%textul s-a schimbat%' THEN RAISE EXCEPTION 'TEST5 FAIL: text afisat diferit (%)', e; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('uc', NULL, false));
  IF e IS NULL OR e NOT LIKE '40001%' THEN RAISE EXCEPTION 'TEST5 FAIL: creare fara text afisat (%)', e; END IF;
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, pg_temp.s3c_g('text_c'), false);
  v_lot := (j->>'lot_id')::uuid;
  IF v_lot IS NULL OR (j->>'nr_destinatari')::integer <> 2 OR j->>'nivel' <> 'utilizator' THEN RAISE EXCEPTION 'TEST5 FAIL: crearea %', j - 'text_final'; END IF;
  PERFORM pg_temp.s3c_s('lot', v_lot::text);
  -- lista fixata, vazuta prin RPC (telefon mascat)
  j := public.fn_sms_lot_destinatari(v_lot);
  IF jsonb_array_length(j->'destinatari') <> 2 OR j->>'text' <> pg_temp.s3c_g('text_c') OR j->>'stare' <> 'draft'
     OR (SELECT string_agg(x->>'telefon_mascat', ',' ORDER BY x->>'telefon_mascat') FROM jsonb_array_elements(j->'destinatari') x) <> '07** *** 201,07** *** 207' THEN
    RAISE EXCEPTION 'TEST5 FAIL: lista fixata %', j->'destinatari';
  END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('uc', pg_temp.s3c_g('text_c'), false));
  IF e IS NULL OR e NOT LIKE '23505%lot activ%' THEN RAISE EXCEPTION 'TEST5 FAIL: al doilea lot activ pe UAT (%)', e; END IF;
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, NULL, true);
  IF (j->>'lot_activ_uat')::uuid IS DISTINCT FROM v_lot THEN RAISE EXCEPTION 'TEST5 FAIL: previzualizarea nu arata lotul activ'; END IF;
  RAISE NOTICE 'TEST5 OK creare: text afisat diferit / lipsa = 40001, 2 destinatari fixati, al doilea lot activ pe UAT = 23505';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
DO $t$
DECLARE l public.sms_loturi; v_tel text;
BEGIN
  SELECT * INTO l FROM public.sms_loturi WHERE id = pg_temp.s3c_g('lot')::uuid;
  IF l.categorie <> 'redari' OR l.uat_id <> pg_temp.s3c_g('uc')::uuid OR l.creat_de <> pg_temp.s3c_g('ured')::uuid OR l.creat_nivel <> 'utilizator'
     OR l.filtru->>'sablon' <> 'redari_v1' OR (l.filtru->>'excluse_pv_semnat')::integer <> 2 OR (l.filtru->>'excluse_a_raspuns')::integer <> 2
     OR (l.filtru->>'excluse_duplicat')::integer <> 1 OR l.excluse_optout <> 1 OR l.excluse_fara_mobil <> 1 OR l.nr_destinatari <> 2 THEN
    RAISE EXCEPTION 'TEST5 FAIL: randul lotului';
  END IF;
  SELECT string_agg(m.telefon, ',' ORDER BY m.telefon) INTO v_tel FROM public.sms_mesaje m WHERE m.lot_id = l.id;
  IF v_tel <> '+40700000201,+40700000207' THEN RAISE EXCEPTION 'TEST5 FAIL: telefoanele fixate'; END IF;
  -- persoana D1 + D2 (doua parcele, doua telefoane) = UN SMS, pe randul deschis cu telefonul ales; D13 (telefon comun cu D7) nu are mesaj separat
  IF (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.destinatar_id IN (pg_temp.s3c_g('D1'), pg_temp.s3c_g('D2'))) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.telefon = '+40700000201' AND m.destinatar_id = pg_temp.s3c_g('D1'))
     OR EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.destinatar_id IN
                 (SELECT pg_temp.s3c_g(k) FROM unnest(ARRAY['D3', 'D4', 'D5', 'D6', 'D8', 'D9', 'D10', 'D11', 'D12', 'D14']) k)) THEN
    RAISE EXCEPTION 'TEST5 FAIL: deduplicarea pe persoana / excluderile';
  END IF;
  RAISE NOTICE 'TEST5b OK lotul in BD: un SMS pentru persoana cu 2 parcele, raspuns / PV semnat / decedat / sters / opt-out / fara mobil / alt UAT excluse';
END $t$;

-- ── TEST6: sablonul incomplet sau prea lung = refuzat (si la previzualizare), cu motivul ───────────────────────────────────────
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ue', NULL, true));
  IF e IS NULL OR e NOT LIKE '22023%caractere GSM-7 (prea_lung)%maximum 160%' THEN RAISE EXCEPTION 'TEST6 FAIL: >160 la previzualizare (%)', e; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ue', 'orice', false));
  IF e IS NULL OR e NOT LIKE '22023%maximum 160%' THEN RAISE EXCEPTION 'TEST6 FAIL: >160 la creare (%)', e; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('uf', NULL, true));
  IF e IS NULL OR e NOT LIKE '22023%lipseste: program_zi%' THEN RAISE EXCEPTION 'TEST6 FAIL: program lipsa (%)', e; END IF;
  e := pg_temp.s3c_eroare(format('SELECT public.fn_sms_lot_redari_sablon_creeaza(%L, NULL, NULL, true)', pg_temp.s3c_g('pr')));
  IF e IS NULL OR e NOT LIKE '22023%alege UAT%' THEN RAISE EXCEPTION 'TEST6 FAIL: fara UAT (%)', e; END IF;
  e := pg_temp.s3c_eroare(format('SELECT public.fn_sms_lot_redari_sablon_creeaza(gen_random_uuid(), %L, NULL, true)', pg_temp.s3c_g('uc')));
  IF e IS NULL OR e NOT LIKE '22023%proiect inexistent%' THEN RAISE EXCEPTION 'TEST6 FAIL: proiect inexistent (%)', e; END IF;
  IF (SELECT count(*) FROM public.sms_loturi WHERE uat_id IN (pg_temp.s3c_g('ue')::uuid, pg_temp.s3c_g('uf')::uuid)) <> 0 THEN
    RAISE EXCEPTION 'TEST6 FAIL: lot scris pentru un sablon refuzat';
  END IF;
  RAISE NOTICE 'TEST6 OK text >160 refuzat (cu lungimea), program lipsa refuzat (cu campul), fara UAT / proiect inexistent refuzate';
END $t$;
-- telefonul de contact al proiectului sters => lipsa telefon_contact (postgres scrie, owner-ul previzualizeaza)
SELECT pg_temp.s3c_ca(NULL, 'postgres');
UPDATE public.red_proiecte SET contact_telefon = NULL WHERE id = pg_temp.s3c_g('pr')::uuid;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, true));
  IF e IS NULL OR e NOT LIKE '22023%lipseste: telefon_contact%' THEN RAISE EXCEPTION 'TEST6 FAIL: telefon lipsa (%)', e; END IF;
  RAISE NOTICE 'TEST6b OK telefonul Gazpet al proiectului lipsa = refuzat';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
UPDATE public.red_proiecte SET contact_telefon = '0700 000 199' WHERE id = pg_temp.s3c_g('pr')::uuid;

-- ── TEST7: nivelurile 20261130b neschimbate: test refuzat, utilizator fara Redari refuzat, fara drept refuzat ───────────────────
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('tst')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, true));
  IF e IS NULL OR e NOT LIKE '42501%contul de test nu face loturi Redari%' THEN RAISE EXCEPTION 'TEST7 FAIL: test previzualizeaza (%)', e; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', 'x', false));
  IF e IS NULL OR e NOT LIKE '42501%contul de test%' THEN RAISE EXCEPTION 'TEST7 FAIL: test creeaza (%)', e; END IF;
  RAISE NOTICE 'TEST7a OK nivelul test refuzat (previzualizare si creare), chiar cu modulul Redari';
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('util')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, true));
  IF e IS NULL OR e NOT LIKE '42501%modulul Redari%' THEN RAISE EXCEPTION 'TEST7 FAIL: utilizator fara Redari (%)', e; END IF;
  RAISE NOTICE 'TEST7b OK utilizatorul SMS fara modulul Redari refuzat';
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('fara')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, true));
  IF e IS NULL OR e NOT LIKE '42501%nu ai acces la modulul SMS%' THEN RAISE EXCEPTION 'TEST7 FAIL: fara drept SMS (%)', e; END IF;
  RAISE NOTICE 'TEST7c OK contul fara drept SMS refuzat';
END $t$;

-- ── TEST8: comutatorul Redari oprit = creare (si previzualizare) refuzata, ca inainte, si pentru owner ─────────────────────────
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(false, NULL, NULL, pg_temp.s3c_vs());
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, true));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST8 FAIL: owner cu comutatorul oprit (%)', e; END IF;
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, false));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST8 FAIL: utilizator cu comutatorul oprit (%)', e; END IF;
  RAISE NOTICE 'TEST8 OK comutatorul Redari oprit: previzualizarea si crearea refuzate (owner si utilizator)';
END $t$;
-- comutatorul inapoi (lotul activ ramane pentru proba revenirii, facuta de runner)
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
SELECT public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-C', pg_temp.s3c_g('azi')::date, pg_temp.s3c_vs()) IS NOT NULL AS comutator_pornit;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
