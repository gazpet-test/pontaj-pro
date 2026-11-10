-- Harness 20261203a_executie_contract_repere — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_contract_repere.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> teste ca non-owner (SET LOCAL ROLE + request.jwt.claims)
-- -> import (fixture-uri fictive) -> revenire refuzată (nearmată / cu date) -> revenire armată pe tabel gol -> re-aplicare.
-- Identități reale din catalog (owner + 4 profiluri non-owner, cu drepturile 'executie' rescrise DOAR în tranzacție), date FICTIVE (coduri X01…).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261203a_executie_contract_repere:' || txid_current(), true);
\ir ../supabase/migrations/20261203a_executie_contract_repere.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);   -- auth.uid() citește întâi această sursă
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- execută SQL și întoarce SQLSTATE-ul ('00000' = a trecut)
CREATE FUNCTION pg_temp.t_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tctr.' || p, true), ''); $h$;
-- apelul RPC-ului (parametrii pe nume)
CREATE FUNCTION pg_temp.t_s(p_proiect bigint, p_id bigint, p_ver integer, p_date jsonb, p_cheie uuid) RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_contract_salveaza(p_proiect, p_id, p_ver, p_date, p_cheie);
$h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0 (L25: testul pică dacă trece sau dacă motivul e altul)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_stare(text), pg_temp.t_g(text),
  pg_temp.t_s(bigint, bigint, integer, jsonb, uuid) TO authenticated, anon, service_role;

-- T0: identități, drepturi rescrise în tranzacție, două proiecte
DO $t$
DECLARE own uuid; ids uuid[]; p bigint; q bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 4) x;
  SELECT min(id), max(id) INTO p, q FROM (SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 2) y;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 4 OR p IS NULL OR q IS NULL OR p = q THEN RAISE EXCEPTION 'T0 FAIL: identități / 2 proiecte'; END IF;
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level)
  VALUES (ids[1], 'executie', 'admin'), (ids[2], 'executie', 'editor'), (ids[3], 'executie', 'viewer');
  PERFORM set_config('tctr.own', own::text, true); PERFORM set_config('tctr.adm', ids[1]::text, true);
  PERFORM set_config('tctr.ed', ids[2]::text, true); PERFORM set_config('tctr.vw', ids[3]::text, true);
  PERFORM set_config('tctr.fara', ids[4]::text, true);
  PERFORM set_config('tctr.p', p::text, true); PERFORM set_config('tctr.q', q::text, true);
  RAISE NOTICE 'T0 OK (owner + admin/editor/viewer/fara, proiecte % și %)', p, q;
END $t$;

-- T1: scrierea prin RPC — admin și owner da; editor, viewer, fără drept, anon nu; parametri lipsă / câmpuri necunoscute / tipuri greșite = 22023
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; r jsonb; s text;
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('adm')::uuid, 'authenticated');
  r := pg_temp.t_s(p, NULL, NULL, '{"sectiune":"eveniment","cod":"X01","titlu":"Eveniment test","stare":"de_notificat","termen_urmator":"2026-11-11","putere":"medie"}', gen_random_uuid());
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->'rand'->>'versiune')::int <> 1 OR (r->'rand'->>'modificat_de') IS DISTINCT FROM pg_temp.t_g('adm') THEN
    RAISE EXCEPTION 'T1 FAIL: admin insert %', r;
  END IF;
  PERFORM set_config('tctr.x01', r->'rand'->>'id', true);
  PERFORM pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
  r := pg_temp.t_s(p, NULL, NULL, '{"sectiune":"clauza","cod":"X02","titlu":"Clauză test","clauze":"35.1"}', gen_random_uuid());
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T1 FAIL: owner insert'; END IF;
  PERFORM set_config('tctr.x02', r->'rand'->>'id', true);
  FOREACH s IN ARRAY ARRAY['ed', 'vw', 'fara'] LOOP
    PERFORM pg_temp.t_ca(pg_temp.t_g(s)::uuid, 'authenticated');
    IF pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"nu"}')) <> '42501'
       OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 1, %L, gen_random_uuid())', p, pg_temp.t_g('x02'), '{"titlu":"nu"}')) <> '42501' THEN
      RAISE EXCEPTION 'T1 FAIL: % a putut scrie', s;
    END IF;
  END LOOP;
  PERFORM pg_temp.t_ca(NULL, 'anon');
  IF pg_temp.t_stare(format('SELECT public.fn_executie_contract_salveaza(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"nu"}')) <> '42501' THEN
    RAISE EXCEPTION 'T1 FAIL: anon a putut apela RPC-ul';
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('adm')::uuid, 'authenticated');
  IF pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"t","necunoscut":"x"}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":5}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"eveniment","cod":"X09","titlu":"t","stare":"viitor","termen_urmator":"11.11.2026"}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"t","ordine":-1}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"t","activ":"da"}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, NULL)', p, '{"sectiune":"clauza","cod":"X09","titlu":"t"}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, 1, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"t"}')) <> '22023' THEN
    RAISE EXCEPTION 'T1 FAIL: validarea parametrilor';
  END IF;
  -- regulile tabelului: eveniment fără stare, clauză cu stare, cod invalid, titlu gol, dată invalidă (calendar)
  IF pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"eveniment","cod":"X09","titlu":"t"}')) <> '23514'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"t","stare":"risc"}')) <> '23514'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"x9","titlu":"t"}')) <> '23514'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X09","titlu":"   "}')) <> '23502'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"eveniment","cod":"X09","titlu":"t","stare":"viitor","termen_urmator":"2026-02-30"}')) <> '22008'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"altceva","cod":"X09","titlu":"t"}')) <> '23514'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, NULL, NULL, %L, gen_random_uuid())', p, '{"sectiune":"clauza","cod":"X02","titlu":"dublură"}')) <> '23505' THEN
    RAISE EXCEPTION 'T1 FAIL: regulile tabelului';
  END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: citirea prin RLS — owner / admin / editor / viewer văd; fără drept nu vede nimic; anon n-are SELECT; scrierile directe = 42501
DO $t$
DECLARE s text; n int;
BEGIN
  FOREACH s IN ARRAY ARRAY['own', 'adm', 'ed', 'vw'] LOOP
    PERFORM pg_temp.t_ca(pg_temp.t_g(s)::uuid, 'authenticated');
    SELECT count(*) INTO n FROM public.executie_contract_repere WHERE cod IN ('X01', 'X02');
    IF n <> 2 THEN RAISE EXCEPTION 'T2 FAIL: % vede % rânduri', s, n; END IF;
    IF pg_temp.t_stare(format('UPDATE public.executie_contract_repere SET titlu = %L WHERE id = %s', 'direct', pg_temp.t_g('x02'))) <> '42501'
       OR pg_temp.t_stare(format('DELETE FROM public.executie_contract_repere WHERE id = %s', pg_temp.t_g('x02'))) <> '42501'
       OR pg_temp.t_stare(format('INSERT INTO public.executie_contract_repere (proiect_id, sectiune, cod, titlu) VALUES (%s, %L, %L, %L)', pg_temp.t_g('p'), 'clauza', 'X08', 'direct')) <> '42501' THEN
      RAISE EXCEPTION 'T2 FAIL: % a putut scrie direct', s;
    END IF;
  END LOOP;
  PERFORM pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
  SELECT count(*) INTO n FROM public.executie_contract_repere;
  IF n <> 0 THEN RAISE EXCEPTION 'T2 FAIL: fără drept vede % rânduri', n; END IF;
  IF public.fn_executie_contract_drept(pg_temp.t_g('p')::bigint, false) IS NOT FALSE THEN RAISE EXCEPTION 'T2 FAIL: dreptul fără acces'; END IF;
  PERFORM pg_temp.t_ca(NULL, 'anon');
  IF pg_temp.t_stare('SELECT count(*) FROM public.executie_contract_repere') <> '42501' THEN RAISE EXCEPTION 'T2 FAIL: anon citește'; END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
  IF public.fn_executie_contract_drept(pg_temp.t_g('p')::bigint, true) IS NOT FALSE OR public.fn_executie_contract_drept(pg_temp.t_g('p')::bigint, false) IS NOT TRUE
     OR public.fn_executie_contract_drept(-1, false) IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: dreptul viewer-ului';
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
  IF public.fn_executie_contract_drept(pg_temp.t_g('p')::bigint, true) IS NOT FALSE THEN RAISE EXCEPTION 'T2 FAIL: editorul are drept de scriere'; END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: modificare cu CAS, idempotență pe cheie, identitate imuabilă, proiect greșit
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; q bigint := pg_temp.t_g('q')::bigint; x bigint := pg_temp.t_g('x01')::bigint; k uuid := gen_random_uuid(); r jsonb; r2 jsonb;
  d jsonb := '{"titlu":"Eveniment test (modificat)","stare":"notificat","termen_urmator":"2026-11-25","notificare":"Nr. test"}';
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('adm')::uuid, 'authenticated');
  r := pg_temp.t_s(p, x, 1, d, k);
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'duplicat')::boolean OR (r->'rand'->>'versiune')::int <> 2 OR r->'rand'->>'stare' <> 'notificat'
     OR r->'rand'->>'putere' IS NOT NULL THEN        -- cheia lipsă = NULL (formularul trimite tot)
    RAISE EXCEPTION 'T3 FAIL: modificare %', r;
  END IF;
  r2 := pg_temp.t_s(p, x, 1, d, k);                   -- aceeași apăsare reluată
  IF (r2->>'duplicat')::boolean IS NOT TRUE OR (r2->'rand'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T3 FAIL: reluarea nu e idempotentă %', r2; END IF;
  IF pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 1, %L, %L)', p, x, '{"titlu":"alt conținut","stare":"notificat"}', k)) <> '22023' THEN
    RAISE EXCEPTION 'T3 FAIL: aceeași cheie cu alt conținut';
  END IF;
  r := pg_temp.t_s(p, x, 1, '{"titlu":"versiune veche","stare":"risc"}', gen_random_uuid());   -- CAS: versiunea văzută e 1, acum e 2
  IF (r->>'ok')::boolean IS NOT FALSE OR r->>'motiv' <> 'conflict' OR (SELECT titlu FROM public.executie_contract_repere WHERE id = x) <> 'Eveniment test (modificat)' THEN
    RAISE EXCEPTION 'T3 FAIL: CAS %', r;
  END IF;
  IF pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 2, %L, gen_random_uuid())', p, x, '{"titlu":"t","stare":"risc","cod":"X77"}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 2, %L, gen_random_uuid())', p, x, '{"titlu":"t","stare":"risc","sectiune":"clauza"}')) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 2, %L, gen_random_uuid())', q, x, '{"titlu":"t","stare":"risc"}')) <> '42501' THEN
    RAISE EXCEPTION 'T3 FAIL: identitatea / proiectul';
  END IF;
  -- arhivarea
  r := pg_temp.t_s(p, x, 2, '{"titlu":"Eveniment test (modificat)","stare":"notificat","activ":false}', gen_random_uuid());
  IF (r->'rand'->>'activ')::boolean IS NOT FALSE OR (r->'rand'->>'versiune')::int <> 3 THEN RAISE EXCEPTION 'T3 FAIL: arhivarea'; END IF;
  -- identitatea și proveniența, pe orice cale (și ca postgres)
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  IF pg_temp.t_stare(format('UPDATE public.executie_contract_repere SET cod = %L WHERE id = %s', 'X99', x)) <> '23514'
     OR pg_temp.t_stare(format('UPDATE public.executie_contract_repere SET proiect_id = %s WHERE id = %s', q, x)) <> '23514' THEN
    RAISE EXCEPTION 'T3 FAIL: identitatea rândului s-a putut schimba';
  END IF;
  UPDATE public.executie_contract_repere SET titlu = 'mentenanță', versiune = 77, modificat_de = pg_temp.t_g('vw')::uuid WHERE id = x;
  IF (SELECT versiune FROM public.executie_contract_repere WHERE id = x) <> 4 OR (SELECT modificat_de FROM public.executie_contract_repere WHERE id = x) IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAIL: versiunea / proveniența nu le pune serverul';
  END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- T3b: idempotența durabilă (review r1 P1): reluarea unei chei VECHI după ce rândul a fost modificat între timp cu altă cheie
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();
  k4 uuid := gen_random_uuid(); r jsonb; x bigint; d1 jsonb := '{"sectiune":"clauza","cod":"X03","titlu":"Clauză K1"}';
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('adm')::uuid, 'authenticated');
  r := pg_temp.t_s(p, NULL, NULL, d1, k1);                                       -- insert K1 (răspunsul „se pierde”)
  x := (r->'rand'->>'id')::bigint;
  r := pg_temp.t_s(p, x, 1, '{"titlu":"modificat cu K2"}', k2);                 -- altcineva modifică rândul cu K2
  IF (r->'rand'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T3b FAIL: update K2 %', r; END IF;
  r := pg_temp.t_s(p, NULL, NULL, d1, k1);                                       -- reluarea insertului cu K1
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'duplicat')::boolean IS NOT TRUE OR (r->'rand'->>'id')::bigint <> x
     OR r->'rand'->>'titlu' <> 'modificat cu K2' THEN
    RAISE EXCEPTION 'T3b FAIL: reluarea insertului după altă modificare %', r;
  END IF;
  r := pg_temp.t_s(p, x, 2, '{"titlu":"modificat cu K3"}', k3);                 -- update K3 (v3)
  r := pg_temp.t_s(p, x, 3, '{"titlu":"modificat cu K4"}', k4);                 -- update K4 (v4)
  r := pg_temp.t_s(p, x, 2, '{"titlu":"modificat cu K3"}', k3);                 -- reluarea lui K3 după K4: succesul de atunci, nu conflict
  IF (r->>'duplicat')::boolean IS NOT TRUE OR (r->'rand'->>'versiune')::int <> 4 THEN RAISE EXCEPTION 'T3b FAIL: reluarea update-ului %', r; END IF;
  -- cheia istorică cu alt conținut / pe alt rând = refuz
  IF pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 2, %L, %L)', p, x, '{"titlu":"altceva"}', k3)) <> '22023'
     OR pg_temp.t_stare(format('SELECT pg_temp.t_s(%s, %s, 4, %L, %L)', p, pg_temp.t_g('x02'), '{"titlu":"modificat cu K3"}', k3)) <> '22023' THEN
    RAISE EXCEPTION 'T3b FAIL: cheia istorică refolosită';
  END IF;
  -- jurnalul cheilor nu se citește din aplicație
  IF pg_temp.t_stare('SELECT count(*) FROM public.executie_contract_repere_chei') <> '42501'
     OR pg_temp.t_stare(format('INSERT INTO public.executie_contract_repere_chei (cheie, proiect_id, rand_id, amprenta, versiune_dupa, creat_de) VALUES (gen_random_uuid(), %s, %s, %L, 1, %L)',
          p, x, repeat('a', 32), pg_temp.t_g('adm'))) <> '42501' THEN
    RAISE EXCEPTION 'T3b FAIL: jurnalul cheilor e accesibil din aplicație';
  END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  IF (SELECT count(*) FROM public.executie_contract_repere_chei WHERE rand_id = x) <> 4
     OR (SELECT creat_de FROM public.executie_contract_repere_chei WHERE cheie = k1) IS DISTINCT FROM pg_temp.t_g('adm')::uuid THEN
    RAISE EXCEPTION 'T3b FAIL: jurnalul cheilor';
  END IF;
  RAISE NOTICE 'T3b OK';
END $t$;

-- T4: concurență pe aceeași versiune (2 apăsări cu chei diferite): a doua primește conflict, nu suprascrie
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; x bigint := pg_temp.t_g('x02')::bigint; v int; r1 jsonb; r2 jsonb;
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
  SELECT versiune INTO v FROM public.executie_contract_repere WHERE id = x;
  r1 := pg_temp.t_s(p, x, v, '{"titlu":"prima"}', gen_random_uuid());
  r2 := pg_temp.t_s(p, x, v, '{"titlu":"a doua"}', gen_random_uuid());
  IF (r1->>'ok')::boolean IS NOT TRUE OR r2->>'motiv' IS DISTINCT FROM 'conflict' OR (SELECT titlu FROM public.executie_contract_repere WHERE id = x) <> 'prima' THEN
    RAISE EXCEPTION 'T4 FAIL: %, %', r1, r2;
  END IF;
  RAISE NOTICE 'T4 OK (secvențial; concurența reală e serializată de advisory + FOR UPDATE + CAS)';
END $t$;

-- T5: importul (fixture-uri fictive): garda de proiect, idempotența, rândurile modificate din aplicație nu se suprascriu, nimic nu se șterge
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t5a;
\set ON_ERROR_STOP 0
\ir fixtures/contract_repere/import_exemplu_1.sql
\set t5a_eroare :ERROR
\set t5a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t5a;
SELECT pg_temp.t_eroare('T5a', :'t5a_eroare', :'t5a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'setează întâi gazpet.import_contract_proiect');
SELECT set_config('gazpet.import_contract_proiect', pg_temp.t_g('q'), true);
\ir fixtures/contract_repere/import_exemplu_1.sql
DO $t$
DECLARE q bigint := pg_temp.t_g('q')::bigint;
BEGIN
  IF (SELECT string_agg(sectiune || ':' || cod || ':' || versiune, ',' ORDER BY sectiune, cod) FROM public.executie_contract_repere WHERE proiect_id = q)
       IS DISTINCT FROM 'cale:B01:1,clauza:A01:1,eveniment:E01:1,eveniment:E02:1,sursa:S01:1,termen:T01:1'
     OR (SELECT continut FROM public.executie_contract_repere WHERE proiect_id = q AND cod = 'A01') <> 'Text fictiv cu apostrof: l''eau și „ghilimele”.'
     OR EXISTS (SELECT 1 FROM public.executie_contract_repere WHERE proiect_id = q AND modificat_de IS NOT NULL) THEN
    RAISE EXCEPTION 'T5 FAIL: primul import';
  END IF;
  CREATE TEMP TABLE t5_v1 ON COMMIT DROP AS SELECT cod, versiune FROM public.executie_contract_repere WHERE proiect_id = q;
END $t$;
\ir fixtures/contract_repere/import_exemplu_1.sql
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM t5_v1 v JOIN public.executie_contract_repere s ON s.proiect_id = pg_temp.t_g('q')::bigint AND s.cod = v.cod WHERE s.versiune <> v.versiune) THEN
    RAISE EXCEPTION 'T5 FAIL: reluarea a schimbat ceva (nu e idempotentă)';
  END IF;
END $t$;
-- E01 modificat din aplicație (de admin); importul 2 îl lasă neatins, actualizează B01, adaugă E03, nu șterge S01
SELECT pg_temp.t_ca(pg_temp.t_g('adm')::uuid, 'authenticated');
SELECT pg_temp.t_s(pg_temp.t_g('q')::bigint, (SELECT id FROM public.executie_contract_repere WHERE proiect_id = pg_temp.t_g('q')::bigint AND cod = 'E01'), 1,
  '{"titlu":"Eveniment fictiv deschis","stare":"in_curs","termen_urmator":"2026-12-01"}', gen_random_uuid());
SELECT pg_temp.t_ca(NULL, 'postgres');
\ir fixtures/contract_repere/import_exemplu_2.sql
DO $t$
DECLARE q bigint := pg_temp.t_g('q')::bigint;
BEGIN
  IF (SELECT stare || '|' || titlu || '|' || versiune FROM public.executie_contract_repere WHERE proiect_id = q AND cod = 'E01') IS DISTINCT FROM 'in_curs|Eveniment fictiv deschis|2'
     OR (SELECT titlu || '|' || versiune FROM public.executie_contract_repere WHERE proiect_id = q AND cod = 'B01') IS DISTINCT FROM 'Cale fictivă (revizuită)|2'
     OR (SELECT versiune FROM public.executie_contract_repere WHERE proiect_id = q AND cod = 'A01') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.executie_contract_repere WHERE proiect_id = q AND cod = 'E03' AND stare = 'viitor')
     OR NOT EXISTS (SELECT 1 FROM public.executie_contract_repere WHERE proiect_id = q AND cod = 'S01') THEN
    RAISE EXCEPTION 'T5 FAIL: al doilea import (rând editat / actualizare / adăugare / fără ștergere)';
  END IF;
  -- garda de nume: un regex care nu se potrivește = refuz (verificat direct, pe aceeași condiție ca fișierul generat)
  IF EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = q AND nume ~* '^nu-exista-un-proiect-cu-numele-asta$') THEN
    RAISE EXCEPTION 'T5 FAIL: garda de nume';
  END IF;
  DELETE FROM public.executie_contract_repere_chei WHERE proiect_id = q;   -- întâi jurnalul cheilor (FK spre fișă)
  DELETE FROM public.executie_contract_repere WHERE proiect_id = q;
  RAISE NOTICE 'T5 OK';
END $t$;

-- T6: revenirea — nearmată = refuz; armată cu date = refuz
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t6a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261203a_executie_contract_repere_ROLLBACK.sql
\set t6a_eroare :ERROR
\set t6a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6a;
SELECT pg_temp.t_eroare('T6a', :'t6a_eroare', :'t6a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t6b;
SELECT set_config('gazpet.revenire_20261203a', 'SCOATE_CONTRACT_REPERE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261203a_executie_contract_repere_ROLLBACK.sql
\set t6b_eroare :ERROR
\set t6b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6b;
SELECT pg_temp.t_eroare('T6b', :'t6b_eroare', :'t6b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'tabelul are randuri');
DO $t$ BEGIN
  IF to_regclass('public.executie_contract_repere') IS NULL OR (SELECT count(*) FROM public.executie_contract_repere WHERE cod IN ('X01', 'X02')) <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T6 OK (refuzurile „garda invalida” și „tabelul are randuri” au fost verificate explicit)';
END $t$;

-- T7: revenirea armată pe tabel gol scoate tot; re-aplicarea merge
DELETE FROM public.executie_contract_repere_chei;
DELETE FROM public.executie_contract_repere;
SELECT set_config('gazpet.revenire_20261203a', 'SCOATE_CONTRACT_REPERE:' || txid_current(), true);
\ir ../supabase/revenire/20261203a_executie_contract_repere_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_contract_repere') IS NOT NULL OR to_regclass('public.executie_contract_repere_chei') IS NOT NULL
     OR to_regprocedure('public.fn_executie_contract_drept(bigint, boolean)') IS NOT NULL
     OR current_setting('gazpet.revenire_20261203a', true) <> '' THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea';
  END IF;
END $t$;
\ir ../supabase/migrations/20261203a_executie_contract_repere.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_contract_repere') IS NULL OR to_regprocedure('public.fn_executie_contract_salveaza(bigint, bigint, integer, jsonb, uuid)') IS NULL THEN
    RAISE EXCEPTION 'T7 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T7 OK — toate testele au trecut; urmează ROLLBACK (nimic nu rămâne pe clonă)';
END $t$;

ROLLBACK;
