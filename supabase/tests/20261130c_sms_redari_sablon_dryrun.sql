-- DRY 20261130c_sms_redari_sablon. Runner: o singura tranzactie ANULATA (migrare 20261130c + teste + revenire + re-aplicare + ROLLBACK),
-- izolare READ COMMITTED, peste 20261130b aplicata. Identitati reale prin helperii pg_temp (ca la 20261130b), cu JWT-ul fiecarui cont:
--   own  = owner-ul (profiles.is_owner);
--   ured = cont non-owner cu Redari editor / admin  -> primeste aici SMS editor (= utilizator, cu Redari);
--   tst  = alt cont non-owner cu Redari editor / admin -> primeste aici SMS viewer (= test: Redari refuzat chiar daca are Redari);
--   util = cont non-owner fara Redari editor / admin -> primeste aici SMS editor (= utilizator, fara Redari);
--   fara = cont non-owner fara Redari editor / admin si fara drept SMS; plus anon.
-- Drepturile SMS de mai sus se dau DOAR in tranzactia de proba (upsert in user_module_access, anulat la final): nu ramane nimic.
-- Date: DOAR fictive (proiect TEST-SMS-DRY-C, UAT-uri TSC / TSD / TSE / TSF, telefoane 0700000…). Nicio citire de date reale in afara
-- id-urilor de profil. Niciun furnizor apelat: rezervarile (fn_sms_rezerva, furnizor 'simulator') ating doar loturile DRY si se anuleaza.
-- r2 (NO-GO Jakarinos + Copilot pe r1): regula pe persoana (raspuns pe oricare parcela exclude; PV doar pe unele parcele = primeste),
-- sesiunea inceputa (creare / aprobare / intre transe / cron), ne_eligibil la rezervare, coada_golita + campania, set_hash (TEST2-TEST13).
-- Starile „in timp” (sesiune trecuta, transa deja plecata, coada_golita) se scriu cu triggerele oprite, doar in tranzactia de proba.
-- r3 (NO-GO Jakarinos pe r2): expirarea pe clock_timestamp() dupa lock-uri (TEST15), un mesaj pe persoana la rezervare dupa ce doua
-- persoane devin una (TEST16).
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
CREATE FUNCTION pg_temp.s3c_qh(p_uat text, p_text text, p_hash text, p_preview boolean) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format('SELECT public.fn_sms_lot_redari_sablon_creeaza(%L, %L, %L, %L, %L)', pg_temp.s3c_g('pr'), pg_temp.s3c_g(p_uat), p_text, p_hash, p_preview)
$h$;
CREATE FUNCTION pg_temp.s3c_q(p_uat text, p_text text, p_preview boolean) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT pg_temp.s3c_qh(p_uat, p_text, NULL, p_preview)
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.s3c_ca(uuid, text), pg_temp.s3c_eroare(text), pg_temp.s3c_g(text), pg_temp.s3c_s(text, text), pg_temp.s3c_vs(),
  pg_temp.s3c_q(text, text, boolean), pg_temp.s3c_qh(text, text, text, boolean) TO authenticated, anon;

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
  IF NOT has_function_privilege('authenticated', 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_sablon_calc(text,date[],text[],text,timestamp)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_persoane(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_lot_motiv(public.sms_loturi)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_lot_motiv_la(public.sms_loturi,timestamptz)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_sms_redari_lot_motiv_la(public.sms_loturi,timestamptz)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_sms_redari_persoane(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_sms_rezerva(uuid,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_rezerva(uuid,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_redari_sablon_model()', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)'::regprocedure)
     OR NOT (SELECT 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)'::regprocedure) THEN
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
  e := pg_temp.s3c_eroare($q$SELECT public.fn_sms_redari_sablon_calc('x', NULL, NULL, NULL, localtimestamp)$q$);
  IF e IS NULL OR e NOT LIKE '42501%' THEN RAISE EXCEPTION 'TEST1 FAIL: completarea e apelabila din aplicatie (%)', e; END IF;
  RAISE NOTICE 'TEST1b OK textul liber (fn_sms_lot_redari_creeaza) refuzat 42501 si pentru owner, din aplicatie';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'anon');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare($q$SELECT public.fn_sms_lot_redari_sablon_creeaza(gen_random_uuid(), gen_random_uuid(), NULL, NULL, true)$q$);
  IF e IS NULL OR e NOT LIKE '42501%' THEN RAISE EXCEPTION 'TEST1 FAIL: anon (%)', e; END IF;
  RAISE NOTICE 'TEST1c OK anon refuzat';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');

-- ── TEST2: paritatea completarii cu src/sms/sablonRedari.test.js (cazurile P1-P15, acum = 2026-11-10 08:00; texte scrise de mana) ──
DO $t$
DECLARE c record; j jsonb; T text := 'Gazpet pt Transgaz: sesiune redare teren la Primaria %s, %s ora %s. Raspuns si online, cu QR-ul din scrisoare. Tel %s';
  v_lung text := 'Comuna Foarte Lunga De Test Fictiv Cu Nume Compus Din Multe Cuvinte'; v_n integer := 0;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('P1', 'Prunișor', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00 – 16:00', NULL, NULL], '0700 000 111', format(T, 'Prunisor', '12.11', '09:00', '0700 000 111'), NULL::text[], '2026-11-10 08:00'::timestamp),
    ('P2', 'Jupa', ARRAY['2026-11-05', '2026-11-12', NULL]::date[], ARRAY['08:00-12:00', '9.30 - 15:00', NULL], '0700000112', format(T, 'Jupa', '12.11', '09:30', '0700000112'), NULL, '2026-11-10 08:00'),
    ('P3', 'Test', ARRAY['2026-11-10', NULL, NULL]::date[], ARRAY['10:00', NULL, NULL], '+40 700 000 113', format(T, 'Test', '10.11', '10:00', '+40 700 000 113'), NULL, '2026-11-10 08:00'),
    ('P4', 'Test', ARRAY['2026-11-01', '2026-11-02', NULL]::date[], ARRAY['09:00', '09:00', NULL], '0700000114', NULL, ARRAY['zi_sesiune'], '2026-11-10 08:00'),
    ('P5', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY[NULL, NULL, NULL]::text[], '0700000115', NULL, ARRAY['program_zi'], '2026-11-10 08:00'),
    ('P6', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['24:00 - 16:00', NULL, NULL], '0700000116', NULL, ARRAY['program_zi'], '2026-11-10 08:00'),
    ('P7', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00', NULL, NULL], '', NULL, ARRAY['telefon_contact'], '2026-11-10 08:00'),
    ('P8', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00', NULL, NULL], 'Ion Test', NULL, ARRAY['telefon_contact'], '2026-11-10 08:00'),
    ('P9', '  ', ARRAY[NULL, NULL, NULL]::date[], ARRAY[NULL, NULL, NULL]::text[], NULL, NULL, ARRAY['uat_nume', 'zi_sesiune', 'telefon_contact'], '2026-11-10 08:00'),
    ('P10', v_lung, ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['09:00', NULL, NULL], '0700 000 120', '>' || format(T, v_lung, '12.11', '09:00', '0700 000 120'), NULL, '2026-11-10 08:00'),
    ('P11', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['  9:05 – 12:00', NULL, NULL], '0700000121', format(T, 'Test', '12.11', '09:05', '0700000121'), NULL, '2026-11-10 08:00'),
    ('P12', 'Test', ARRAY['2026-11-12', NULL, NULL]::date[], ARRAY['9 - 16', NULL, NULL], '0700000122', NULL, ARRAY['program_zi'], '2026-11-10 08:00'),
    ('P13', 'Test', ARRAY['2026-11-10', '2026-11-11', NULL]::date[], ARRAY['10:00 - 16:00', '08:30', NULL], '0700000123', format(T, 'Test', '11.11', '08:30', '0700000123'), NULL, '2026-11-10 10:00'),
    ('P14', 'Test', ARRAY['2026-11-10', '2026-11-11', NULL]::date[], ARRAY['10:00 - 16:00', '08:30', NULL], '0700000124', format(T, 'Test', '10.11', '10:00', '0700000124'), NULL, '2026-11-10 09:59'),
    ('P15', 'Test', ARRAY['2026-11-10', '2026-11-11', NULL]::date[], ARRAY[NULL, '08:30', NULL], '0700000125', NULL, ARRAY['program_zi'], '2026-11-10 23:00')
  ) AS x(cod, comuna, zile, programe, tel, astept, lipsuri, acum) LOOP
    j := public.fn_sms_redari_sablon_calc(c.comuna, c.zile, c.programe, c.tel, c.acum);
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
  IF v_n <> 15 THEN RAISE EXCEPTION 'TEST2 FAIL: % cazuri', v_n; END IF;
  RAISE NOTICE 'TEST2 OK paritate sablon SQL = vitest pe 15 cazuri (zi trecuta -> urmatoarea, sesiunea de azi inceputa / neinceputa, lipsuri, ora invalida, >160)';
END $t$;

-- ── TEST3: fixture fictiv (postgres, fara JWT): proiect, 4 UAT-uri, detinatori pe toate cazurile de excludere ─────────────────
DO $t$
DECLARE v_pr uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_h uuid; p1 uuid; p2 uuid; p3 uuid; pd uuid; pe uuid; pf uuid; ph uuid;
  v_azi date := pg_temp.s3c_g('azi')::date;
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
  -- r2: sesiunea de azi a inceput deja (00:00) -> se ia ziua 2
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, program_zi1, sesiune_zi2, program_zi2)
  VALUES (v_pr, 'Inceput', 'TSG', 'Test', v_azi, '00:00 - 23:59', v_azi + 4, '11:00') RETURNING id INTO v_g;
  -- r2: set_hash / text schimbat / transe
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, program_zi1) VALUES (v_pr, 'Textul', 'TSH', 'Test', v_azi + 3, '10:00') RETURNING id INTO v_h;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_h, 'TSH-0001', 1) RETURNING id INTO ph;
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
      ('D16', pf, 'Test Sms C Fara Prog', '0700000216', 'Strada Test 16', false, true),
      -- r2, regula pe persoana: raspuns pe o parcela + alta deschisa = exclus (D17 / D18); PV doar pe o parcela + alta fara PV = primeste (D19 / D20)
      ('D17', p1, 'Test Sms C Mixt Raspuns', '0700000217', 'Strada Test 17', false, true),
      ('D18', p2, 'Test Sms C Mixt Raspuns', '0700000218', 'Strada Test 17', false, true),
      ('D19', p1, 'Test Sms C Mixt Pv', '0700000219', 'Strada Test 19', false, true),
      ('D20', p2, 'Test Sms C Mixt Pv', '0700000220', 'Strada Test 19', false, true),
      ('D21', ph, 'Test Sms C Th Unu', '0700000221', 'Strada Test 21', false, true),
      ('D22', ph, 'Test Sms C Th Doi', '0700000222', 'Strada Test 22', false, true)) AS x(k, parcela, nume, tel, strada, decedat, conv) LOOP
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
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES (pg_temp.s3c_g('D18')::uuid, 'telefon', 'nu_particip_fara_obiectii');
  INSERT INTO public.red_procese_verbale (tip, parcela_id, detinator_id, uat_id, tronson, nr_pv, data_pv, stare, semnat_primit_data, fisier_semnat_path)
  VALUES ('A', p1, pg_temp.s3c_g('D19')::uuid, v_c, 1, 'PVA-TSC-9905', v_azi, 'semnat', v_azi, 'dry/fictiv-d.pdf');
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
  PERFORM pg_temp.s3c_s('ue', v_e::text); PERFORM pg_temp.s3c_s('uf', v_f::text); PERFORM pg_temp.s3c_s('ug', v_g::text);
  PERFORM pg_temp.s3c_s('uh', v_h::text); PERFORM pg_temp.s3c_s('ph', ph::text);
  PERFORM pg_temp.s3c_s('text_c', format('Gazpet pt Transgaz: sesiune redare teren la Primaria Testeni, %s ora 09:30. Raspuns si online, cu QR-ul din scrisoare. Tel 0700 000 199',
    to_char(v_azi + 5, 'DD.MM')));
  RAISE NOTICE 'TEST3 OK fixture fictiv: 22 detinatori, 6 UAT-uri (TSC complet, TSD alt UAT, TSE nume lung, TSF fara program, TSG sesiunea de azi inceputa, TSH)';
END $t$;
-- opt-out pe telefonul lui D10 (owner, prin RPC)
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
SELECT public.fn_sms_optout_seteaza('0700000210', true, 'DRY fictiv') IS NOT NULL AS optout_ok;

-- ── TEST4: previzualizarea (owner): textul din BD, numaratorile pe persoane, motivele excluderii, nimic scris ───────────────────
DO $t$
DECLARE j jsonb; n0 integer := (SELECT count(*) FROM public.sms_loturi);
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, NULL, NULL, true);
  IF j->>'text_final' IS DISTINCT FROM pg_temp.s3c_g('text_c') OR (j->>'lungime')::integer <> length(pg_temp.s3c_g('text_c'))
     OR j->>'zi' <> (pg_temp.s3c_g('azi')::date + 5)::text OR (j->>'zi_nr')::integer <> 2 OR j->>'ora' <> '09:30' THEN
    RAISE EXCEPTION 'TEST4 FAIL: textul / ziua %', j;
  END IF;
  -- 11 persoane: D1+D2, D3, D4, D5, D6, D7, D10, D11, D13, D17+D18, D19+D20; D8 decedat, D9 sters, D12 fara convocare activa, D14 alt UAT = in afara
  -- primesc: D1 (201), D7 (207), D19+D20 (220: PV doar pe parcela lui D19); au raspuns: D3, D4, D17+D18 (raspuns doar pe D18); PV pe tot: D5, D6
  IF (j->>'candidati')::integer <> 11 OR (j->>'nr_destinatari')::integer <> 3 OR (j->>'excluse_pv_semnat')::integer <> 2
     OR (j->>'excluse_a_raspuns')::integer <> 3 OR (j->>'excluse_fara_mobil')::integer <> 1 OR (j->>'excluse_optout')::integer <> 1
     OR (j->>'excluse_duplicat')::integer <> 1 OR (j->>'cost_estimat_eur')::numeric <> 0.147 OR j->>'lot_id' IS NOT NULL
     OR (j->>'preview')::boolean IS NOT TRUE OR j->>'lot_activ_uat' IS NOT NULL OR j->>'campanie_existenta' IS NOT NULL
     OR coalesce(j->>'set_hash', '') !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'TEST4 FAIL: numaratori %', j - 'text_final';
  END IF;
  IF (SELECT count(*) FROM public.sms_loturi) <> n0 THEN RAISE EXCEPTION 'TEST4 FAIL: previzualizarea a scris un lot'; END IF;
  -- previzualizarea e determinista (acelasi set = acelasi hash)
  IF public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, NULL, NULL, true)->>'set_hash' <> j->>'set_hash' THEN
    RAISE EXCEPTION 'TEST4 FAIL: set_hash nedeterminist';
  END IF;
  PERFORM pg_temp.s3c_s('h_tsc', j->>'set_hash');
  -- sesiunea de azi deja inceputa (TSG, 00:00) -> ziua 2
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ug')::uuid, NULL, NULL, true);
  IF (j->>'zi_nr')::integer <> 2 OR j->>'ora' <> '11:00' OR j->>'zi' <> (pg_temp.s3c_g('azi')::date + 4)::text THEN RAISE EXCEPTION 'TEST4 FAIL: sesiunea inceputa azi %', j; END IF;
  RAISE NOTICE 'TEST4 OK previzualizare: ziua 1 trecuta -> ziua 2; 3 din 11 persoane (2 PV pe toate parcelele, 3 au raspuns pe oricare parcela, 1 fara mobil, 1 opt-out, 1 telefon dublat); set_hash determinist; 0 scrieri';
  RAISE NOTICE 'TEST4b OK sesiunea de azi deja inceputa la creare (TSG 00:00) -> se ia ziua 2 (11:00)';
END $t$;

-- ── TEST5: crearea (utilizator cu Redari): textul afisat obligatoriu, lista fixata in BD, un SMS de persoana, un lot activ pe UAT ──
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; e text; v_lot uuid; l record;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('uc', 'Gazpet: text vechi afisat', pg_temp.s3c_g('h_tsc'), false));
  IF e IS NULL OR e NOT LIKE '40001%textul s-a schimbat%' THEN RAISE EXCEPTION 'TEST5 FAIL: text afisat diferit (%)', e; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('uc', NULL, pg_temp.s3c_g('h_tsc'), false));
  IF e IS NULL OR e NOT LIKE '40001%' THEN RAISE EXCEPTION 'TEST5 FAIL: creare fara text afisat (%)', e; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('uc', pg_temp.s3c_g('text_c'), NULL, false));
  IF e IS NULL OR e NOT LIKE '40001%lista s-a schimbat%' THEN RAISE EXCEPTION 'TEST5 FAIL: creare fara set_hash (%)', e; END IF;
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, pg_temp.s3c_g('text_c'), pg_temp.s3c_g('h_tsc'), false);
  v_lot := (j->>'lot_id')::uuid;
  IF v_lot IS NULL OR (j->>'nr_destinatari')::integer <> 3 OR j->>'nivel' <> 'utilizator' THEN RAISE EXCEPTION 'TEST5 FAIL: crearea %', j - 'text_final'; END IF;
  PERFORM pg_temp.s3c_s('lot', v_lot::text);
  -- lista fixata, vazuta prin RPC (telefon mascat)
  j := public.fn_sms_lot_destinatari(v_lot);
  IF jsonb_array_length(j->'destinatari') <> 3 OR j->>'text' <> pg_temp.s3c_g('text_c') OR j->>'stare' <> 'draft'
     OR (SELECT string_agg(x->>'telefon_mascat', ',' ORDER BY x->>'telefon_mascat') FROM jsonb_array_elements(j->'destinatari') x) <> '07** *** 201,07** *** 207,07** *** 220' THEN
    RAISE EXCEPTION 'TEST5 FAIL: lista fixata %', j->'destinatari';
  END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('uc', pg_temp.s3c_g('text_c'), pg_temp.s3c_g('h_tsc'), false));
  IF e IS NULL OR e NOT LIKE '23505%lot activ%' THEN RAISE EXCEPTION 'TEST5 FAIL: al doilea lot activ pe UAT (%)', e; END IF;
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uc')::uuid, NULL, NULL, true);
  IF (j->>'lot_activ_uat')::uuid IS DISTINCT FROM v_lot THEN RAISE EXCEPTION 'TEST5 FAIL: previzualizarea nu arata lotul activ'; END IF;
  RAISE NOTICE 'TEST5 OK creare: text afisat diferit / lipsa = 40001, set_hash lipsa = 40001, 3 destinatari fixati, al doilea lot activ pe UAT = 23505';
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
DO $t$
DECLARE l public.sms_loturi; v_tel text;
BEGIN
  SELECT * INTO l FROM public.sms_loturi WHERE id = pg_temp.s3c_g('lot')::uuid;
  IF l.categorie <> 'redari' OR l.uat_id <> pg_temp.s3c_g('uc')::uuid OR l.creat_de <> pg_temp.s3c_g('ured')::uuid OR l.creat_nivel <> 'utilizator'
     OR l.filtru->>'sablon' <> 'redari_v1' OR (l.filtru->>'excluse_pv_semnat')::integer <> 2 OR (l.filtru->>'excluse_a_raspuns')::integer <> 3
     OR (l.filtru->>'excluse_duplicat')::integer <> 1 OR l.excluse_optout <> 1 OR l.excluse_fara_mobil <> 1 OR l.nr_destinatari <> 3
     OR l.filtru->>'set_hash' IS DISTINCT FROM pg_temp.s3c_g('h_tsc') OR l.filtru->>'ora' <> '09:30' THEN
    RAISE EXCEPTION 'TEST5 FAIL: randul lotului';
  END IF;
  SELECT string_agg(m.telefon, ',' ORDER BY m.telefon) INTO v_tel FROM public.sms_mesaje m WHERE m.lot_id = l.id;
  IF v_tel <> '+40700000201,+40700000207,+40700000220' THEN RAISE EXCEPTION 'TEST5 FAIL: telefoanele fixate'; END IF;
  -- persoana D1 + D2 (doua parcele, doua telefoane) = UN SMS, pe randul deschis cu telefonul ales; D13 (telefon comun cu D7) nu are mesaj separat
  IF (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.destinatar_id IN (pg_temp.s3c_g('D1'), pg_temp.s3c_g('D2'))) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.telefon = '+40700000201' AND m.destinatar_id = pg_temp.s3c_g('D1'))
     OR EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.destinatar_id IN
                 (SELECT pg_temp.s3c_g(k) FROM unnest(ARRAY['D3', 'D4', 'D5', 'D6', 'D8', 'D9', 'D10', 'D11', 'D12', 'D14', 'D17', 'D18', 'D19']) k)) THEN
    RAISE EXCEPTION 'TEST5 FAIL: deduplicarea pe persoana / excluderile';
  END IF;
  -- regula pe persoana (decizia Razvan 03.11): raspuns pe o parcela + alta deschisa = exclus; PV doar pe o parcela = primeste; PV pe toate = exclus
  IF NOT EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.telefon = '+40700000220' AND m.destinatar_id = pg_temp.s3c_g('D20'))
     OR EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.telefon IN ('+40700000217', '+40700000218', '+40700000219', '+40700000205')) THEN
    RAISE EXCEPTION 'TEST5 FAIL: regula pe persoana (raspuns / PV partial / PV total)';
  END IF;
  RAISE NOTICE 'TEST5b OK lotul in BD: un SMS pentru persoana cu 2 parcele; raspuns pe oricare parcela = exclus, PV doar pe o parcela = primeste, PV pe toate = exclus; decedat / sters / opt-out / fara mobil / alt UAT excluse';
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
  e := pg_temp.s3c_eroare(format('SELECT public.fn_sms_lot_redari_sablon_creeaza(%L, NULL, NULL, NULL, true)', pg_temp.s3c_g('pr')));
  IF e IS NULL OR e NOT LIKE '22023%alege UAT%' THEN RAISE EXCEPTION 'TEST6 FAIL: fara UAT (%)', e; END IF;
  e := pg_temp.s3c_eroare(format('SELECT public.fn_sms_lot_redari_sablon_creeaza(gen_random_uuid(), %L, NULL, NULL, true)', pg_temp.s3c_g('uc')));
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

-- ── TEST9 (r2 P2-02): eligibilitatea se schimba dupa creare -> la rezervare mesajul persoanei iese din coada (ne_eligibil) ────────
SELECT pg_temp.s3c_ca(NULL, 'postgres');
-- D1 (persoana D1 + D2) raspunde DUPA crearea lotului L1
INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES (pg_temp.s3c_g('D2')::uuid, 'telefon', 'nu_particip_fara_obiectii');
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_aproba(pg_temp.s3c_g('lot')::uuid, (public.fn_sms_lot_destinatari(pg_temp.s3c_g('lot')::uuid)->>'versiune')::integer);
  IF j->>'stare' <> 'aprobat' THEN RAISE EXCEPTION 'TEST9 FAIL: aprobarea L1 %', j; END IF;
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
DO $t$
DECLARE j jsonb; v_lot uuid := pg_temp.s3c_g('lot')::uuid;
BEGIN
  j := public.fn_sms_rezerva(v_lot, 50, 'simulator', pg_temp.s3c_g('ured')::uuid);
  IF j->>'motiv' NOT IN ('ok', 'gata', 'in_afara_orelor') THEN RAISE EXCEPTION 'TEST9 FAIL: rezervarea L1 %', j->>'motiv'; END IF;
  IF (SELECT m.stare || '/' || coalesce(m.cod_eroare, '') FROM public.sms_mesaje m WHERE m.lot_id = v_lot AND m.destinatar_id = pg_temp.s3c_g('D1'))
     IS DISTINCT FROM 'anulat/ne_eligibil'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'mesaje') x WHERE x->>'telefon' = '+40700000201')
     OR (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = v_lot AND m.stare IN ('in_coada', 'necunoscut')) <> 2
     OR (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = v_lot) <> 3 THEN
    RAISE EXCEPTION 'TEST9 FAIL: mesajul persoanei care a raspuns dupa creare';
  END IF;
  RAISE NOTICE 'TEST9 OK raspuns dupa creare: la rezervare (%) mesajul persoanei = anulat / ne_eligibil, 0 SMS catre ea; celelalte 2 raman; lista fixata (3) ramane pentru audit', j->>'motiv';
END $t$;

-- ── TEST10 (r2 P2): aprobare dupa expirarea sesiunii = refuzata (sesiune_expirata) ───────────────────────────────────────────────
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ud')::uuid, NULL, NULL, true);
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ud')::uuid, j->>'text_final', j->>'set_hash', false);
  IF (j->>'nr_destinatari')::integer <> 1 THEN RAISE EXCEPTION 'TEST10 FAIL: lotul L2 %', j; END IF;
  PERFORM pg_temp.s3c_s('L2', j->>'lot_id'); PERFORM pg_temp.s3c_s('L2zi', j->>'zi');
END $t$;
-- timpul trece: sesiunea din lot devine trecuta (mentenanta cu triggerele oprite, doar in tranzactia de proba)
SELECT pg_temp.s3c_ca(NULL, 'postgres');
ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
UPDATE public.sms_loturi SET filtru = jsonb_set(filtru, '{zi}', to_jsonb((pg_temp.s3c_g('azi')::date - 1)::text)) WHERE id = pg_temp.s3c_g('L2')::uuid;
ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(format('SELECT public.fn_sms_lot_aproba(%L, %s)', pg_temp.s3c_g('L2'),
         (public.fn_sms_lot_destinatari(pg_temp.s3c_g('L2')::uuid)->>'versiune')::integer));
  IF e IS NULL OR e NOT LIKE '22023%sesiune_expirata%' THEN RAISE EXCEPTION 'TEST10 FAIL: aprobarea dupa expirare (%)', e; END IF;
  IF public.fn_sms_lot_destinatari(pg_temp.s3c_g('L2')::uuid)->>'stare' <> 'draft' THEN RAISE EXCEPTION 'TEST10 FAIL: lotul nu mai e draft'; END IF;
  RAISE NOTICE 'TEST10 OK aprobarea dupa inceputul sesiunii refuzata (sesiune_expirata), lotul ramane draft';
END $t$;

-- ── TEST11 (r2 P3-01 + P2): set_hash schimbat intre previzualizare si creare; text_schimbat la aprobare; expirare intre transe ───
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uh')::uuid, NULL, NULL, true);
  IF (j->>'nr_destinatari')::integer <> 2 OR coalesce(j->>'set_hash', '') !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'TEST11 FAIL: previzualizarea TSH %', j; END IF;
  PERFORM pg_temp.s3c_s('h_tsh', j->>'set_hash'); PERFORM pg_temp.s3c_s('t_tsh', j->>'text_final');
END $t$;
-- intre previzualizare si creare apare un proprietar nou convocat (D23)
SELECT pg_temp.s3c_ca(NULL, 'postgres');
DO $t$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  VALUES (pg_temp.s3c_g('ph')::uuid, 'Test Sms C Nou', 'TEST SMS C NOU', 'proprietar') RETURNING id INTO v_id;
  INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta, telefon)
  VALUES (v_id, 'Strada Test 23', 'Sat Test', 'Testeni', 'Test', '000000', true, '0700000223');
  INSERT INTO public.red_convocari (detinator_id, canal) VALUES (v_id, 'telefon');
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text; j jsonb;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('uh', pg_temp.s3c_g('t_tsh'), pg_temp.s3c_g('h_tsh'), false));
  IF e IS NULL OR e NOT LIKE '40001%lista s-a schimbat, previzualizeaza din nou%' THEN RAISE EXCEPTION 'TEST11 FAIL: set_hash vechi (%)', e; END IF;
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uh')::uuid, NULL, NULL, true);
  IF j->>'set_hash' = pg_temp.s3c_g('h_tsh') OR (j->>'nr_destinatari')::integer <> 3 THEN RAISE EXCEPTION 'TEST11 FAIL: hash-ul nou %', j; END IF;
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uh')::uuid, j->>'text_final', j->>'set_hash', false);
  IF (j->>'nr_destinatari')::integer <> 3 THEN RAISE EXCEPTION 'TEST11 FAIL: lotul L3 %', j; END IF;
  PERFORM pg_temp.s3c_s('L3', j->>'lot_id');
  RAISE NOTICE 'TEST11a OK lista schimbata intre previzualizare si creare = 40001 „lista s-a schimbat”; cu hash-ul nou lotul se creeaza (3)';
END $t$;
-- setarile UAT se schimba dupa creare: aprobarea refuzata (text_schimbat); inapoi -> aprobata
SELECT pg_temp.s3c_ca(NULL, 'postgres');
UPDATE public.red_uat SET nume = 'Textul Nou' WHERE id = pg_temp.s3c_g('uh')::uuid;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(format('SELECT public.fn_sms_lot_aproba(%L, %s)', pg_temp.s3c_g('L3'),
         (public.fn_sms_lot_destinatari(pg_temp.s3c_g('L3')::uuid)->>'versiune')::integer));
  IF e IS NULL OR e NOT LIKE '22023%text_schimbat%' THEN RAISE EXCEPTION 'TEST11 FAIL: aprobare cu textul schimbat (%)', e; END IF;
END $t$;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
UPDATE public.red_uat SET nume = 'Textul' WHERE id = pg_temp.s3c_g('uh')::uuid;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
SELECT public.fn_sms_lot_aproba(pg_temp.s3c_g('L3')::uuid, (public.fn_sms_lot_destinatari(pg_temp.s3c_g('L3')::uuid)->>'versiune')::integer)->>'stare' AS l3_aprobat;
-- prima transa a plecat (un mesaj rezervat), apoi sesiunea incepe; a doua transa (si cronul) nu mai rezerva nimic
SELECT pg_temp.s3c_ca(NULL, 'postgres');
ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
UPDATE public.sms_loturi SET stare = 'in_trimitere' WHERE id = pg_temp.s3c_g('L3')::uuid;
UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = 'simulator', rezervat_la = now()
 WHERE id = (SELECT min(m.id::text)::uuid FROM public.sms_mesaje m WHERE m.lot_id = pg_temp.s3c_g('L3')::uuid);
ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
DO $t$
DECLARE j jsonb; v_lot uuid := pg_temp.s3c_g('L3')::uuid;
BEGIN
  -- intai: textul schimbat intre transe
  UPDATE public.red_uat SET nume = 'Textul Nou' WHERE id = pg_temp.s3c_g('uh')::uuid;
  j := public.fn_sms_rezerva(v_lot, 50, 'simulator', pg_temp.s3c_g('ured')::uuid);
  IF j->>'motiv' <> 'text_schimbat' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST11 FAIL: transa cu textul schimbat %', j->>'motiv'; END IF;
  UPDATE public.red_uat SET nume = 'Textul' WHERE id = pg_temp.s3c_g('uh')::uuid;
  -- apoi: sesiunea a inceput intre transe
  ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
  UPDATE public.sms_loturi SET filtru = jsonb_set(filtru, '{zi}', to_jsonb((pg_temp.s3c_g('azi')::date - 1)::text)) WHERE id = v_lot;
  ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
  j := public.fn_sms_rezerva(v_lot, 50, 'simulator', pg_temp.s3c_g('ured')::uuid);
  IF j->>'motiv' <> 'sesiune_expirata' OR jsonb_array_length(j->'mesaje') <> 0
     OR (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = v_lot AND m.stare = 'in_coada') <> 2 THEN
    RAISE EXCEPTION 'TEST11 FAIL: a doua transa dupa expirare %', j->>'motiv';
  END IF;
  RAISE NOTICE 'TEST11b OK aprobare cu textul schimbat = text_schimbat; intre transe: text_schimbat si sesiune_expirata, 0 rezervate, coada (2) neatinsa';
END $t$;

-- ── TEST12 (r2 P2): cronul sare lotul din sablon expirat; ruleaza cronul real doar in fereastra 08-20 si fara alte loturi aprobate ──
DO $t$
DECLARE j jsonb; v_ora integer := extract(hour FROM now() AT TIME ZONE 'Europe/Bucharest')::integer;
BEGIN
  IF public.fn_sms_redari_lot_motiv((SELECT l FROM public.sms_loturi l WHERE l.id = pg_temp.s3c_g('L3')::uuid)) IS DISTINCT FROM 'sesiune_expirata'
     OR public.fn_sms_redari_lot_motiv((SELECT l FROM public.sms_loturi l WHERE l.id = pg_temp.s3c_g('lot')::uuid)) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST12 FAIL: fn_sms_redari_lot_motiv pe L3 / L1';
  END IF;
  -- cronul real doar daca nu exista loturi aprobate in afara celor DRY si suntem in fereastra 08-20 (altfel ar atinge alte loturi / nu ia Redari)
  IF v_ora BETWEEN 8 AND 19 AND NOT EXISTS (SELECT 1 FROM public.sms_loturi x WHERE x.stare IN ('aprobat', 'in_trimitere')
                                              AND x.id NOT IN (pg_temp.s3c_g('lot')::uuid, pg_temp.s3c_g('L3')::uuid)) THEN
    j := public.fn_sms_rezerva(NULL, 50, 'simulator', NULL);
    IF (j->>'lot_id')::uuid IS NOT DISTINCT FROM pg_temp.s3c_g('L3')::uuid THEN RAISE EXCEPTION 'TEST12 FAIL: cronul a ales lotul expirat'; END IF;
    RAISE NOTICE 'TEST12 OK cronul sare lotul expirat (a ales %)', CASE WHEN (j->>'lot_id')::uuid = pg_temp.s3c_g('lot')::uuid THEN 'L1' ELSE j->>'motiv' END;
  ELSE
    RAISE NOTICE 'TEST12 OK (partial) fn_sms_redari_lot_motiv: L3 = sesiune_expirata, L1 = valabil; cronul real SARIT (ora % sau alte loturi aprobate)', v_ora;
  END IF;
END $t$;

-- ── TEST13 (r2 P2-03): coada_golita cu mesaje necunoscut = lot activ; campania UAT + zi + sablon o singura data (pana la anulare) ──
SELECT pg_temp.s3c_ca(NULL, 'postgres');
ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
UPDATE public.sms_loturi SET stare = 'coada_golita', aprobat_de = pg_temp.s3c_g('ured')::uuid, aprobat_la = now(), aprobat_nivel = 'utilizator',
       aprobat_autorizare_nr = 'TGZ-DRY-C', aprobat_autorizare_data = pg_temp.s3c_g('azi')::date, coada_golita_la = now(),
       filtru = jsonb_set(filtru, '{zi}', to_jsonb(pg_temp.s3c_g('L2zi')))
 WHERE id = pg_temp.s3c_g('L2')::uuid;
UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = 'simulator', rezervat_la = now() WHERE lot_id = pg_temp.s3c_g('L2')::uuid;
ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; e text;
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ud')::uuid, NULL, NULL, true);
  IF (j->>'lot_activ_uat')::uuid IS DISTINCT FROM pg_temp.s3c_g('L2')::uuid THEN RAISE EXCEPTION 'TEST13 FAIL: coada_golita + necunoscut nu e activ %', j; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('ud', j->>'text_final', j->>'set_hash', false));
  IF e IS NULL OR e NOT LIKE '23505%lot activ%' THEN RAISE EXCEPTION 'TEST13 FAIL: al doilea lot cu primul coada_golita / necunoscut (%)', e; END IF;
  PERFORM pg_temp.s3c_s('t_tsd', j->>'text_final'); PERFORM pg_temp.s3c_s('h_tsd', j->>'set_hash');
END $t$;
-- mesajul primului lot ajunge livrat: lotul nu mai e activ, dar campania (UAT + zi + sablon) exista
SELECT pg_temp.s3c_ca(NULL, 'postgres');
ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
UPDATE public.sms_mesaje SET stare = 'livrat', furnizor_id = 'dry-1', trimis_la = now(), livrat_la = now() WHERE lot_id = pg_temp.s3c_g('L2')::uuid;
ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; e text;
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ud')::uuid, NULL, NULL, true);
  IF j->>'lot_activ_uat' IS NOT NULL OR (j->>'campanie_existenta')::uuid IS DISTINCT FROM pg_temp.s3c_g('L2')::uuid THEN RAISE EXCEPTION 'TEST13 FAIL: campania %', j; END IF;
  e := pg_temp.s3c_eroare(pg_temp.s3c_qh('ud', j->>'text_final', j->>'set_hash', false));
  IF e IS NULL OR e NOT LIKE '23505%campania%' THEN RAISE EXCEPTION 'TEST13 FAIL: a doua campanie (%)', e; END IF;
END $t$;
-- primul lot anulat (mentenanta): campania se poate reface
SELECT pg_temp.s3c_ca(NULL, 'postgres');
ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
UPDATE public.sms_loturi SET stare = 'anulat', anulat_de = pg_temp.s3c_g('ured')::uuid, anulat_la = now(), motiv_anulare = 'DRY fictiv' WHERE id = pg_temp.s3c_g('L2')::uuid;
ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ud')::uuid, NULL, NULL, true);
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('ud')::uuid, j->>'text_final', j->>'set_hash', false);
  IF j->>'lot_id' IS NULL THEN RAISE EXCEPTION 'TEST13 FAIL: campania dupa anulare %', j; END IF;
  RAISE NOTICE 'TEST13 OK coada_golita cu mesaj necunoscut = lot activ (23505); livrat = campania exista (23505); dupa anulare se reface';
END $t$;

-- ── TEST15 (r3 P2): expirarea pe momentul efectiv (clock_timestamp), decisa DUPA lock-uri; momentul ca parametru testabil ──────────
SELECT pg_temp.s3c_ca(NULL, 'postgres');
DO $t$
DECLARE l public.sms_loturi; v_start timestamptz; v_rez text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_rezerva(uuid,integer,text,uuid)'::regprocedure);
  v_apr text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_lot_aproba(uuid,integer)'::regprocedure);
BEGIN
  SELECT * INTO l FROM public.sms_loturi WHERE id = pg_temp.s3c_g('lot')::uuid;
  v_start := ((l.filtru->>'zi')::date + (l.filtru->>'ora')::time) AT TIME ZONE 'Europe/Bucharest';
  -- o tranzactie care a inceput inainte de sesiune si a obtinut lock-urile dupa: decide momentul de dupa lock, nu inceputul
  IF public.fn_sms_redari_lot_motiv_la(l, v_start - interval '1 second') IS NOT NULL
     OR public.fn_sms_redari_lot_motiv_la(l, v_start) IS DISTINCT FROM 'sesiune_expirata'
     OR public.fn_sms_redari_lot_motiv_la(l, v_start + interval '2 seconds') IS DISTINCT FROM 'sesiune_expirata'
     OR public.fn_sms_redari_lot_motiv_la(l, NULL) IS DISTINCT FROM 'sesiune_expirata' THEN
    RAISE EXCEPTION 'TEST15 FAIL: fn_sms_redari_lot_motiv_la in jurul inceputului sesiunii';
  END IF;
  -- prin constructie: fn_sms_redari_lot_motiv = _la(lot, clock_timestamp()), VOLATILE; nicio decizie pe now(); in fn_sms_rezerva
  -- verificarea vine dupa lock-ul pe setari si pe lot; aprobarea blocheaza lotul inainte de UPDATE-ul care porneste triggerul
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_redari_lot_motiv(public.sms_loturi)'::regprocedure) !~ 'fn_sms_redari_lot_motiv_la[(]p_lot, clock_timestamp[(][)][)]'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sms_redari_lot_motiv(public.sms_loturi)'::regprocedure) <> 'v'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_redari_lot_motiv_la(public.sms_loturi,timestamptz)'::regprocedure) ~ 'now[(][)]'
     OR strpos(v_rez, 'v_motiv := public.fn_sms_redari_lot_motiv(l);') <= strpos(v_rez, 'SELECT * INTO l FROM public.sms_loturi x WHERE x.id = p_lot_id FOR UPDATE;')
     OR strpos(v_rez, 'SELECT * INTO s FROM public.sms_setari WHERE id FOR UPDATE;') >= strpos(v_rez, 'v_motiv := public.fn_sms_redari_lot_motiv(l);')
     OR strpos(v_apr, 'SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;') >= strpos(v_apr, 'UPDATE public.sms_loturi SET stare = ''aprobat''') THEN
    RAISE EXCEPTION 'TEST15 FAIL: expirarea nu e decisa pe clock_timestamp dupa lock-uri';
  END IF;
  -- clock_timestamp avanseaza in tranzactie, now() nu: dupa o asteptare (pg_sleep) momentul folosit e cel de dupa
  PERFORM pg_sleep(0.05);
  IF NOT (clock_timestamp() > now() + interval '40 milliseconds') THEN RAISE EXCEPTION 'TEST15 FAIL: clock_timestamp nu avanseaza'; END IF;
  RAISE NOTICE 'TEST15 OK expirarea: _la(start - 1s) valabil, _la(start) / _la(start + 2s) / _la(NULL) = sesiune_expirata; fn_sms_redari_lot_motiv = _la(clock_timestamp()), apelata dupa lock-urile pe setari / lot';
END $t$;

-- ── TEST16 (r3 P2): doua persoane cu telefoane diferite devin aceeasi persoana dupa creare -> la rezervare pleaca UN singur mesaj ──
DO $t$
DECLARE v_u uuid; p1 uuid; p2 uuid; v_id uuid; d record;
BEGIN
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, program_zi1)
  VALUES (pg_temp.s3c_g('pr')::uuid, 'Dublura', 'TSJ', 'Test', pg_temp.s3c_g('azi')::date + 3, '10:00') RETURNING id INTO v_u;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (pg_temp.s3c_g('pr')::uuid, v_u, 'TSJ-0001', 1) RETURNING id INTO p1;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (pg_temp.s3c_g('pr')::uuid, v_u, 'TSJ-0002', 1) RETURNING id INTO p2;
  FOR d IN SELECT * FROM (VALUES ('D24', p1, 'Test Sms C Dup Unu', '0700000224', 'Strada Test 24'),
                                 ('D25', p2, 'Test Sms C Dup Doi', '0700000225', 'Strada Test 25')) AS x(k, parcela, nume, tel, strada) LOOP
    INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (d.parcela, d.nume, upper(d.nume), 'proprietar') RETURNING id INTO v_id;
    INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta, telefon)
    VALUES (v_id, d.strada, 'Sat Test', 'Testeni', 'Test', '000000', true, d.tel);
    INSERT INTO public.red_convocari (detinator_id, canal) VALUES (v_id, 'telefon');
    PERFORM pg_temp.s3c_s(d.k, v_id::text);
  END LOOP;
  PERFORM pg_temp.s3c_s('uj', v_u::text);
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uj')::uuid, NULL, NULL, true);
  j := public.fn_sms_lot_redari_sablon_creeaza(pg_temp.s3c_g('pr')::uuid, pg_temp.s3c_g('uj')::uuid, j->>'text_final', j->>'set_hash', false);
  IF (j->>'nr_destinatari')::integer <> 2 THEN RAISE EXCEPTION 'TEST16 FAIL: lotul L5 (2 persoane) %', j; END IF;
  PERFORM pg_temp.s3c_s('L5', j->>'lot_id');
  j := public.fn_sms_lot_aproba((j->>'lot_id')::uuid, (public.fn_sms_lot_destinatari((j->>'lot_id')::uuid)->>'versiune')::integer);
  IF j->>'stare' <> 'aprobat' THEN RAISE EXCEPTION 'TEST16 FAIL: aprobarea L5'; END IF;
END $t$;
-- dupa aprobare se corecteaza numele si adresa lui D25: e aceeasi persoana ca D24 (aceeasi cheie fn_red_cheie_persoana), alt telefon
SELECT pg_temp.s3c_ca(NULL, 'postgres');
UPDATE public.red_detinatori SET nume = 'Test Sms C Dup Unu', nume_normalizat = 'TEST SMS C DUP UNU' WHERE id = pg_temp.s3c_g('D25')::uuid;
UPDATE public.red_detinatori_contact SET adresa_strada = 'Strada Test 24' WHERE detinator_id = pg_temp.s3c_g('D25')::uuid;
DO $t$
DECLARE j jsonb; v_lot uuid := pg_temp.s3c_g('L5')::uuid;
BEGIN
  IF public.fn_red_cheie_persoana(pg_temp.s3c_g('D24')::uuid) IS DISTINCT FROM public.fn_red_cheie_persoana(pg_temp.s3c_g('D25')::uuid) THEN
    RAISE EXCEPTION 'TEST16 FAIL: pregatire (cheile persoanei difera)';
  END IF;
  j := public.fn_sms_rezerva(v_lot, 50, 'simulator', pg_temp.s3c_g('ured')::uuid);
  IF j->>'motiv' NOT IN ('ok', 'gata', 'in_afara_orelor') THEN RAISE EXCEPTION 'TEST16 FAIL: rezervarea L5 %', j->>'motiv'; END IF;
  IF (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = v_lot AND m.stare = 'anulat' AND m.cod_eroare = 'duplicat_persoana') <> 1
     OR (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = v_lot AND m.stare <> 'anulat') <> 1
     OR jsonb_array_length(j->'mesaje') > 1 THEN
    RAISE EXCEPTION 'TEST16 FAIL: aceeasi persoana pe doua telefoane';
  END IF;
  -- o a doua transa nu reinvie mesajul anulat si nu trimite al doilea
  j := public.fn_sms_rezerva(v_lot, 50, 'simulator', pg_temp.s3c_g('ured')::uuid);
  IF (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = v_lot AND m.stare <> 'anulat') <> 1 OR jsonb_array_length(coalesce(j->'mesaje', '[]')) > 1 THEN
    RAISE EXCEPTION 'TEST16 FAIL: a doua transa';
  END IF;
  RAISE NOTICE 'TEST16 OK doua persoane unite dupa corectarea numelui / adresei: la rezervare pleaca 1 mesaj, celalalt anulat / duplicat_persoana (si la transa urmatoare)';
END $t$;

-- ── TEST14: comutatorul Redari oprit = creare (si previzualizare) refuzata, ca inainte, si pentru owner ─────────────────────────
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(false, NULL, NULL, pg_temp.s3c_vs());
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, true));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST14 FAIL: owner cu comutatorul oprit (%)', e; END IF;
END $t$;
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('ured')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s3c_eroare(pg_temp.s3c_q('ud', NULL, false));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST14 FAIL: utilizator cu comutatorul oprit (%)', e; END IF;
  RAISE NOTICE 'TEST14 OK comutatorul Redari oprit: previzualizarea si crearea refuzate (owner si utilizator)';
END $t$;
-- comutatorul inapoi (lotul activ ramane pentru proba revenirii, facuta de runner)
SELECT pg_temp.s3c_ca(pg_temp.s3c_g('own')::uuid, 'authenticated');
SELECT public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-C', pg_temp.s3c_g('azi')::date, pg_temp.s3c_vs()) IS NOT NULL AS comutator_pornit;
SELECT pg_temp.s3c_ca(NULL, 'postgres');
