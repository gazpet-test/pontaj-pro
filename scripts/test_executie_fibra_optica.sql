-- Harness 20261211a_executie_fibra_optica — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_fibra_optica.sql
-- Cere 20261201a aplicată pe clonă (fn_executie_nod_drept). O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de
-- livrare) -> teste ca non-owner (SET LOCAL ROLE + request.jwt.claims) -> revenire refuzată (nearmată / cu date) -> revenire armată pe
-- tabele goale -> re-aplicare. Identități reale din catalog (owner + 4 profiluri non-owner, cu drepturile 'executie' rescrise DOAR în
-- tranzacție), date FICTIVE: tronsoanele FO-TEST-1 (km 900+000–902+000), FO-TEST-2 (902+000–905+000) și FO-TEST-3 (fără km), create
-- aici, pe proiectul cu id-ul cel mai mic; camerete CT-901…; nimic din datele reale nu se citește sau scrie.
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION). Refuzurile se verifică după SQLSTATE
-- și după fragmentul exact al mesajului (L25).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261211a_executie_fibra_optica:' || txid_current(), true);
\ir ../supabase/migrations/20261211a_executie_fibra_optica.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  -- ambele surse JWT (auth.uid() citește întâi request.jwt.claim.sub)
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- refuzul așteptat: SQLSTATE exact și (opțional) un fragment al mesajului
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text, p_fragment text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare OR (p_fragment IS NOT NULL AND position(p_fragment IN SQLERRM) = 0) THEN
    RAISE NOTICE 't_refuza: așteptat % „%”, primit % (%)', p_stare, p_fragment, SQLSTATE, left(SQLERRM, 240);
    RETURN false;
  END IF;
  RETURN true;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tfo.' || p, true), ''); $h$;
-- id-ul unui tronson de test (după cod) — citit ca postgres în T0 și pus în setări, ca apelurile să nu depindă de RLS pe executie_tronsoane
CREATE FUNCTION pg_temp.t_tr(p_cod text) RETURNS bigint LANGUAGE sql STABLE AS $h$ SELECT pg_temp.t_g('tr_' || replace(p_cod, '-', '_'))::bigint; $h$;
-- raportarea unui interval pe tronsonul de test; întoarce jsonb
CREATE FUNCTION pg_temp.t_rap(p_tr text, p_etapa text, p_a integer, p_b integer, p_data date, p_cheie uuid DEFAULT gen_random_uuid(), p_obs text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_fibra_raporteaza(pg_temp.t_g('p')::bigint, pg_temp.t_tr(p_tr), p_etapa, p_a, p_b, p_data, p_obs, p_cheie);
$h$;
-- id-ul intervalului activ (etapă, început) pe un tronson de test — ca postgres, prin setarea pusă de t_retine
CREATE FUNCTION pg_temp.t_retine(p_nume text, p_r jsonb) RETURNS jsonb LANGUAGE plpgsql AS $h$
BEGIN
  PERFORM set_config('tfo.id_' || p_nume, coalesce(p_r->'interval'->>'id', p_r->'camereta'->>'id'), true);
  RETURN p_r;
END $h$;
CREATE FUNCTION pg_temp.t_id(p_nume text) RETURNS bigint LANGUAGE sql STABLE AS $h$ SELECT pg_temp.t_g('id_' || p_nume)::bigint; $h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0: psql :ERROR = true, :SQLSTATE și mesajul exact (L25: testul pică dacă trece)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text, text), pg_temp.t_g(text), pg_temp.t_tr(text),
  pg_temp.t_rap(text, text, integer, integer, date, uuid, text), pg_temp.t_retine(text, jsonb), pg_temp.t_id(text) TO authenticated, anon, service_role;

-- T0: identități, drepturi rescrise în tranzacție, tronsoanele fictive
DO $t$
DECLARE own uuid; ids uuid[]; p bigint; p2 bigint; v_tr bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 4) x;
  SELECT id INTO p FROM public.executie_proiecte ORDER BY id LIMIT 1;
  SELECT id INTO p2 FROM public.executie_proiecte WHERE id <> p ORDER BY id LIMIT 1;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 4 OR p IS NULL THEN RAISE EXCEPTION 'T0 FAIL: identități / proiect'; END IF;
  IF EXISTS (SELECT 1 FROM public.executie_tronsoane WHERE cod LIKE 'FO-TEST-%') THEN RAISE EXCEPTION 'T0 FAIL: codurile FO-TEST-* sunt deja folosite'; END IF;
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level)
  VALUES (ids[1], 'executie', 'editor'), (ids[2], 'executie', 'viewer'), (ids[4], 'executie', 'editor');
  PERFORM set_config('tfo.owner', own::text, true); PERFORM set_config('tfo.ed', ids[1]::text, true);
  PERFORM set_config('tfo.vw', ids[2]::text, true); PERFORM set_config('tfo.fara', ids[3]::text, true); PERFORM set_config('tfo.ed2', ids[4]::text, true);
  PERFORM set_config('tfo.p', p::text, true); PERFORM set_config('tfo.p2', coalesce(p2::text, ''), true);
  PERFORM set_config('tfo.azi', ((now() AT TIME ZONE 'Europe/Bucharest')::date)::text, true);
  INSERT INTO public.executie_tronsoane (proiect_id, cod, km_start_m, km_end_m) VALUES (p, 'FO-TEST-1', 900000, 902000) RETURNING id INTO v_tr;
  PERFORM set_config('tfo.tr_FO_TEST_1', v_tr::text, true);
  INSERT INTO public.executie_tronsoane (proiect_id, cod, km_start_m, km_end_m) VALUES (p, 'FO-TEST-2', 902000, 905000) RETURNING id INTO v_tr;
  PERFORM set_config('tfo.tr_FO_TEST_2', v_tr::text, true);
  INSERT INTO public.executie_tronsoane (proiect_id, cod, km_start_m, km_end_m) VALUES (p, 'FO-TEST-3', NULL, NULL) RETURNING id INTO v_tr;
  PERFORM set_config('tfo.tr_FO_TEST_3', v_tr::text, true);
  IF p2 IS NOT NULL THEN
    INSERT INTO public.executie_tronsoane (proiect_id, cod, km_start_m, km_end_m) VALUES (p2, 'FO-TEST-P2', 0, 5000) RETURNING id INTO v_tr;
    PERFORM set_config('tfo.tr_FO_TEST_P2', v_tr::text, true);
  END IF;
  RAISE NOTICE 'T0 OK';
END $t$;

-- T1: citirea prin RLS și dreptul (o singură definiție): editor / viewer da, fără drept nu, anon nu
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT public.fn_executie_fibra_drept(pg_temp.t_g('p')::bigint, true) OR NOT public.fn_executie_fibra_drept(pg_temp.t_g('p')::bigint, false) THEN RAISE EXCEPTION 'T1 FAIL: editor'; END IF;
  PERFORM count(*) FROM public.executie_fibra_intervale;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_executie_fibra_drept(pg_temp.t_g('p')::bigint, true) OR NOT public.fn_executie_fibra_drept(pg_temp.t_g('p')::bigint, false) THEN RAISE EXCEPTION 'T1 FAIL: viewer'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF public.fn_executie_fibra_drept(pg_temp.t_g('p')::bigint, false) THEN RAISE EXCEPTION 'T1 FAIL: fără intrare'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_fibra_intervale', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_fibra_camerete', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_fibra_jurnal', '42501')
     OR NOT pg_temp.t_refuza('SELECT public.fn_executie_fibra_drept(1, false)', '42501') THEN RAISE EXCEPTION 'T1 FAIL: anon'; END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: scrierea directă e refuzată (editor, service_role); RPC-urile nu sunt pentru service_role
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_fibra_intervale (proiect_id, tronson_id, etapa, km_de_la_m, km_pana_la_m, data_lucru) VALUES (%s, %s, 'monotub', 900000, 900100, current_date)$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '42501')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_fibra_camerete (proiect_id, tronson_id, cod, km_m, sursa) VALUES (%s, %s, 'CT-999', 900000, 'santier')$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '42501')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_fibra_intervale SET stare = 'anulat'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_fibra_jurnal$q$, '42501') THEN
    RAISE EXCEPTION 'T2 FAIL: editor scrie direct';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$DELETE FROM public.executie_fibra_intervale$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_fibra_raporteaza(1, 1, 'monotub', 0, 10, current_date, NULL, gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_fibra_camereta_stare(1, 1, 'montata', current_date, NULL, gen_random_uuid())$q$, '42501') THEN
    RAISE EXCEPTION 'T2 FAIL: service_role scrie';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: monotub — limite, capete care se ating, suprapunere cu mesaj clar, tronson fără km, etapă / interval / dată greșite
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; ed uuid := pg_temp.t_g('ed')::uuid;
BEGIN
  r := pg_temp.t_retine('m1', pg_temp.t_rap('FO-TEST-1', 'monotub', 900000, 900500, z));
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'false' OR (r->'interval'->>'raportat_de')::uuid IS DISTINCT FROM ed OR r->'interval'->>'stare' <> 'activ'
     OR (r->'interval'->>'data_lucru')::date <> z THEN RAISE EXCEPTION 'T3 FAIL: prima raportare %', r; END IF;
  r := pg_temp.t_retine('m2', pg_temp.t_rap('FO-TEST-1', 'monotub', 900500, 901000, z - 1));   -- capătul se atinge: [a, b)
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T3 FAIL: capăt comun %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 900400, 900600, %L)$q$, z), '23514',
                          'porțiunea km 900+400–900+500 e deja raportată pe ' || to_char(z, 'DD.MM'))
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 901900, 902100, %L)$q$, z), '23514', 'iese din tronsonul FO-TEST-1 (km 900+000–902+000)')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 899990, 900000, %L)$q$, z), '23514', 'iese din tronsonul')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-3', 'monotub', 0, 100, %L)$q$, z), '23514', 'nu are km de început și de sfârșit')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 901000, 901000, %L)$q$, z), '22023', 'intervalul de km e greșit')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 901500, 901000, %L)$q$, z), '22023', 'intervalul de km e greșit')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'tubaj', 901000, 901100, %L)$q$, z), '22023', 'etapă necunoscută')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 901000, 901100, %L)$q$, z + 1), '22023', 'data trebuie să fie între')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 901000, 901100, %L)$q$, z - 8), '22023', 'data trebuie să fie între')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'monotub', 901000, 901100, %L, gen_random_uuid(), %L)$q$, z, repeat('x', 1001)), '22023', 'observațiile') THEN
    RAISE EXCEPTION 'T3 FAIL: refuzurile monotub';
  END IF;
  -- alt tronson, aceleași km-uri ale altei etape: independente
  r := pg_temp.t_rap('FO-TEST-2', 'monotub', 902000, 903000, z);
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T3 FAIL: FO-TEST-2 %', r; END IF;
  IF (SELECT count(*) FROM public.executie_fibra_intervale WHERE tronson_id IN (pg_temp.t_tr('FO-TEST-1'), pg_temp.t_tr('FO-TEST-2'))) <> 3
     OR (SELECT count(*) FROM public.executie_fibra_jurnal WHERE actiune = 'raportare' AND tronson_id IN (pg_temp.t_tr('FO-TEST-1'), pg_temp.t_tr('FO-TEST-2'))) <> 3 THEN
    RAISE EXCEPTION 'T3 FAIL: un refuz a scris ceva';
  END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- T3b: proiectul tronsonului = proiectul din apel (refuz generic); owner-ul poate raporta până la 365 de zile în urmă
DO $t$
BEGIN
  IF pg_temp.t_tr('FO-TEST-P2') IS NOT NULL
     AND NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_raporteaza(%s, %s, 'monotub', 0, 100, %L, NULL, gen_random_uuid())$q$,
                                     pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-P2'), pg_temp.t_g('azi')), '42501', 'nu ai drept de scriere') THEN
    RAISE EXCEPTION 'T3b FAIL: tronson de pe alt proiect';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  r := pg_temp.t_retine('mo', pg_temp.t_rap('FO-TEST-2', 'monotub', 904000, 905000, z - 200));
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T3b FAIL: owner 200 de zile %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-2', 'monotub', 903000, 903100, %L)$q$, z - 366), '22023', 'data trebuie să fie între') THEN
    RAISE EXCEPTION 'T3b FAIL: owner peste 365';
  END IF;
  RAISE NOTICE 'T3b OK';
END $t$;

-- T4: acoperirea — validat peste monotub (din două intervale), suflat peste validat; porțiunea lipsă și data etapei anterioare
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  -- monotub: 900+000–900+500 (azi), 900+500–901+000 (ieri)
  r := pg_temp.t_retine('v1', pg_temp.t_rap('FO-TEST-1', 'validat', 900200, 900800, z));
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T4 FAIL: validat peste două intervale %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'validat', 900800, 901200, %L)$q$, z), '23514',
                          'porțiunea km 901+000–901+200 nu are „monotub montat” raportat')
     -- 900+000–900+200 are monotub doar de azi: o validare cu data de ieri e refuzată (etapa anterioară raportată abia azi)
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'validat', 900000, 900200, %L)$q$, z - 1), '23514',
                          'pe km 900+000–900+200 „monotub montat” e raportat abia pe ' || to_char(z, 'DD.MM'))
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'suflat', 900100, 900300, %L)$q$, z), '23514',
                          'porțiunea km 900+100–900+200 nu are „validat” raportat')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-2', 'suflat', 902000, 902100, %L)$q$, z), '23514', 'nu are „validat” raportat')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-1', 'validat', 900700, 900900, %L)$q$, z), '23514', 'e deja raportată') THEN
    RAISE EXCEPTION 'T4 FAIL: refuzurile de acoperire';
  END IF;
  r := pg_temp.t_retine('s1', pg_temp.t_rap('FO-TEST-1', 'suflat', 900200, 900500, z));
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T4 FAIL: suflat peste validat %', r; END IF;
  -- validat cu data de ieri pe porțiunea cu monotub de ieri: merge
  r := pg_temp.t_retine('v2', pg_temp.t_rap('FO-TEST-1', 'validat', 900800, 901000, z - 1));
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T4 FAIL: validat ieri peste monotub ieri %', r; END IF;
  RAISE NOTICE 'T4 OK';
END $t$;

-- T5: idempotența — aceeași cheie + același conținut = duplicat fără scriere; aceeași cheie cu alt conținut / altă operație = eroare
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; k uuid := gen_random_uuid(); n integer;
BEGIN
  r := pg_temp.t_rap('FO-TEST-2', 'monotub', 903000, 903500, z, k, 'probă');
  IF r->>'duplicat' <> 'false' THEN RAISE EXCEPTION 'T5 FAIL: prima %', r; END IF;
  SELECT count(*) INTO n FROM public.executie_fibra_jurnal;
  r := pg_temp.t_rap('FO-TEST-2', 'monotub', 903000, 903500, z, k, '  probă ');
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'true' OR (SELECT count(*) FROM public.executie_fibra_jurnal) <> n THEN RAISE EXCEPTION 'T5 FAIL: reluarea %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_rap('FO-TEST-2', 'monotub', 903000, 903600, %L, %L, 'probă')$q$, z, k), '22023', 'cheia apăsării')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'x', %L)$q$, pg_temp.t_id('m1'), k), '22023', 'cheia apăsării') THEN
    RAISE EXCEPTION 'T5 FAIL: cheie refolosită';
  END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- T6: anularea — dependența etapei următoare, autorul / owner-ul, viewer, motiv, deja anulat; porțiunea anulată se poate raporta din nou
DO $t$
DECLARE r jsonb;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'greșit', gen_random_uuid())$q$, pg_temp.t_id('m1')), '23514',
                          'nu se poate anula: pe km 900+200–900+500 există „validat”')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'greșit', gen_random_uuid())$q$, pg_temp.t_id('v1')), '23514',
                          'există „suflat”')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, '   ', gen_random_uuid())$q$, pg_temp.t_id('s1')), '22023', 'motivul anulării') THEN
    RAISE EXCEPTION 'T6 FAIL: dependențe / motiv';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed2')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'nu e a mea', gen_random_uuid())$q$, pg_temp.t_id('s1')), '42501', 'doar cine a făcut-o sau owner-ul') THEN
    RAISE EXCEPTION 'T6 FAIL: alt editor anulează';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'viewer', gen_random_uuid())$q$, pg_temp.t_id('s1')), '42501', 'nu ai drept de scriere') THEN
    RAISE EXCEPTION 'T6 FAIL: viewer anulează';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'x', gen_random_uuid())$q$, pg_temp.t_id('s1')), '42501', 'nu ai drept de scriere')
     -- un id care nu există primește același mesaj generic
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_fibra_anuleaza(-1, 'x', gen_random_uuid())$q$, '42501', 'nu ai drept de scriere') THEN
    RAISE EXCEPTION 'T6 FAIL: fără drept';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; k uuid := gen_random_uuid(); z date := pg_temp.t_g('azi')::date;
BEGIN
  r := public.fn_executie_fibra_anuleaza(pg_temp.t_id('s1'), ' km greșiți ', k);
  IF r->>'ok' <> 'true' OR r->'interval'->>'stare' <> 'anulat' OR r->'interval'->>'motiv_anulare' <> 'km greșiți'
     OR (r->'interval'->>'anulat_de')::uuid IS DISTINCT FROM pg_temp.t_g('ed')::uuid OR r->'interval'->>'anulat_la' IS NULL THEN RAISE EXCEPTION 'T6 FAIL: anularea autorului %', r; END IF;
  r := public.fn_executie_fibra_anuleaza(pg_temp.t_id('s1'), 'km greșiți', k);
  IF r->>'duplicat' <> 'true' THEN RAISE EXCEPTION 'T6 FAIL: reluarea anulării %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_anuleaza(%s, 'din nou', gen_random_uuid())$q$, pg_temp.t_id('s1')), '22023', 'deja anulată') THEN
    RAISE EXCEPTION 'T6 FAIL: anulare dublă';
  END IF;
  -- porțiunea eliberată se raportează din nou (rândul anulat rămâne)
  r := pg_temp.t_retine('s2', pg_temp.t_rap('FO-TEST-1', 'suflat', 900200, 900500, z));
  IF r->>'ok' <> 'true' OR (SELECT count(*) FROM public.executie_fibra_intervale WHERE etapa = 'suflat' AND tronson_id = pg_temp.t_tr('FO-TEST-1')) <> 2 THEN
    RAISE EXCEPTION 'T6 FAIL: raportarea din nou %', r;
  END IF;
END $t$;
-- owner-ul anulează raportarea editorului
SELECT pg_temp.t_ca(pg_temp.t_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.fn_executie_fibra_anuleaza(pg_temp.t_id('s2'), 'verificare owner', gen_random_uuid());
  IF r->'interval'->>'stare' <> 'anulat' OR (r->'interval'->>'anulat_de')::uuid IS DISTINCT FROM pg_temp.t_g('owner')::uuid THEN RAISE EXCEPTION 'T6 FAIL: owner %', r; END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- T7: cameretele — adăugare (de montat / montată), cod dublu, în afara tronsonului, CAS, montare, anularea montării, scoaterea din listă
SELECT pg_temp.t_ca(NULL, 'postgres');
-- o cameretă „din proiect” (import, fără autor în aplicație)
INSERT INTO public.executie_fibra_camerete (proiect_id, tronson_id, cod, km_m) VALUES (pg_temp.t_g('p')::bigint, pg_temp.t_tr('FO-TEST-1'), 'CT-900', 900100);
SELECT set_config('tfo.id_c0', (SELECT id FROM public.executie_fibra_camerete WHERE cod = 'CT-900' AND tronson_id = pg_temp.t_tr('FO-TEST-1'))::text, true);
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; k uuid := gen_random_uuid();
BEGIN
  IF (SELECT sursa FROM public.executie_fibra_camerete WHERE id = pg_temp.t_id('c0')) <> 'proiect' THEN RAISE EXCEPTION 'T7 FAIL: sursa importului'; END IF;
  r := pg_temp.t_retine('c1', public.fn_executie_fibra_camereta_adauga(pg_temp.t_g('p')::bigint, pg_temp.t_tr('FO-TEST-1'), ' ct-901 ', 900300, false, NULL, NULL, k));
  IF r->'camereta'->>'cod' <> 'CT-901' OR r->'camereta'->>'stare' <> 'de_montat' OR r->'camereta'->>'sursa' <> 'santier'
     OR (r->'camereta'->>'creat_de')::uuid IS DISTINCT FROM pg_temp.t_g('ed')::uuid THEN RAISE EXCEPTION 'T7 FAIL: adăugarea %', r; END IF;
  r := public.fn_executie_fibra_camereta_adauga(pg_temp.t_g('p')::bigint, pg_temp.t_tr('FO-TEST-1'), 'CT-901', 900300, false, NULL, NULL, k);
  IF r->>'duplicat' <> 'true' THEN RAISE EXCEPTION 'T7 FAIL: reluarea adăugării %', r; END IF;
  r := pg_temp.t_retine('c2', public.fn_executie_fibra_camereta_adauga(pg_temp.t_g('p')::bigint, pg_temp.t_tr('FO-TEST-1'), 'CT-902', 902000, true, z, 'la capăt', gen_random_uuid()));
  IF r->'camereta'->>'stare' <> 'montata' OR (r->'camereta'->>'data_montare')::date <> z OR (r->'camereta'->>'montat_de')::uuid IS DISTINCT FROM pg_temp.t_g('ed')::uuid THEN
    RAISE EXCEPTION 'T7 FAIL: adăugarea montată (capătul tronsonului inclus) %', r;
  END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_adauga(%s, %s, 'CT-900', 902500, false, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-2')), '23505', 'camereta CT-900 există deja pe proiect (tronsonul FO-TEST-1, km 900+100)')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_adauga(%s, %s, 'CT-903', 902001, false, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '23514', 'iese din tronsonul FO-TEST-1')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_adauga(%s, %s, 'CT 903', 900400, false, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '22023', 'codul cameretei')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_adauga(%s, %s, 'CT-903', 900400, true, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '22023', 'parametri lipsă')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_adauga(%s, %s, 'CT-903', 900400, false, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-3')), '23514', 'nu are km') THEN
    RAISE EXCEPTION 'T7 FAIL: refuzurile adăugării';
  END IF;
  -- montarea cameretei din proiect, cu CAS pe versiune
  r := public.fn_executie_fibra_camereta_stare(pg_temp.t_id('c0'), 1, 'montata', z, NULL, gen_random_uuid());
  IF r->>'ok' <> 'true' OR r->'camereta'->>'stare' <> 'montata' OR (r->'camereta'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T7 FAIL: montarea %', r; END IF;
  r := public.fn_executie_fibra_camereta_stare(pg_temp.t_id('c0'), 1, 'de_montat', NULL, 'greșit', gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' OR (r->'camereta'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T7 FAIL: CAS %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_stare(%s, 2, 'anulata', NULL, 'x', gen_random_uuid())$q$, pg_temp.t_id('c0')), '22023', 'nepermisă')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_stare(%s, 1, 'montata', %L, NULL, gen_random_uuid())$q$, pg_temp.t_id('c1'), z + 1), '22023', 'data trebuie')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_stare(%s, 2, 'de_montat', NULL, ' ', gen_random_uuid())$q$, pg_temp.t_id('c0')), '22023', 'motivul') THEN
    RAISE EXCEPTION 'T7 FAIL: refuzurile stării';
  END IF;
END $t$;
-- alt editor: nu anulează montarea altuia, nu scoate camereta altuia sau pe cea din proiect
SELECT pg_temp.t_ca(pg_temp.t_g('ed2')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_stare(%s, 2, 'de_montat', NULL, 'nu e a mea', gen_random_uuid())$q$, pg_temp.t_id('c0')), '42501', 'doar cine a raportat-o')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_stare(%s, 1, 'anulata', NULL, 'nu e a mea', gen_random_uuid())$q$, pg_temp.t_id('c1')), '42501', 'din listă scoate doar') THEN
    RAISE EXCEPTION 'T7 FAIL: alt editor';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.fn_executie_fibra_camereta_stare(pg_temp.t_id('c0'), 2, 'de_montat', NULL, 'montată pe alt loc', gen_random_uuid());
  IF r->'camereta'->>'stare' <> 'de_montat' OR r->'camereta'->>'data_montare' IS NOT NULL OR r->'camereta'->>'montat_de' IS NOT NULL THEN RAISE EXCEPTION 'T7 FAIL: anularea montării %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_fibra_camereta_stare(%s, 3, 'anulata', NULL, 'nu există', gen_random_uuid())$q$, pg_temp.t_id('c0')), '42501', 'cele din proiect: owner-ul') THEN
    RAISE EXCEPTION 'T7 FAIL: editorul scoate camereta din proiect';
  END IF;
  r := public.fn_executie_fibra_camereta_stare(pg_temp.t_id('c1'), 1, 'anulata', NULL, 'adăugată din greșeală', gen_random_uuid());
  IF r->'camereta'->>'stare' <> 'anulata' THEN RAISE EXCEPTION 'T7 FAIL: scoaterea propriei camerete %', r; END IF;
  -- codul scos se eliberează
  r := public.fn_executie_fibra_camereta_adauga(pg_temp.t_g('p')::bigint, pg_temp.t_tr('FO-TEST-1'), 'CT-901', 900350, false, NULL, NULL, gen_random_uuid());
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T7 FAIL: codul eliberat %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; n integer;
BEGIN
  r := public.fn_executie_fibra_camereta_stare(pg_temp.t_id('c0'), 3, 'anulata', NULL, 'nu există pe teren', gen_random_uuid());
  IF r->'camereta'->>'stare' <> 'anulata' THEN RAISE EXCEPTION 'T7 FAIL: owner scoate camereta din proiect %', r; END IF;
  -- tranzițiile: toate cele 9 perechi față de lista decisă (scrisă aici independent de funcție)
  SELECT count(*) INTO n FROM unnest(ARRAY['de_montat', 'montata', 'anulata']) v, unnest(ARRAY['de_montat', 'montata', 'anulata']) w
   WHERE public.fn_executie_fibra_cam_tranzitie(v, w) IS DISTINCT FROM (v || '>' || w = ANY (ARRAY['de_montat>montata', 'montata>de_montat', 'de_montat>anulata']));
  IF n <> 0 OR public.fn_executie_fibra_etapa_anterioara('validat') <> 'monotub' OR public.fn_executie_fibra_etapa_anterioara('suflat') <> 'validat'
     OR public.fn_executie_fibra_etapa_anterioara('monotub') IS NOT NULL OR public.fn_executie_fibra_km(12350) <> '12+350' OR public.fn_executie_fibra_km(5) <> '0+005' THEN
    RAISE EXCEPTION 'T7 FAIL: tranzițiile / etapele / km (% perechi diferite)', n;
  END IF;
  IF (SELECT string_agg(actiune, ',' ORDER BY id) FROM public.executie_fibra_jurnal WHERE camereta_id IS NOT NULL)
     IS DISTINCT FROM 'camereta_adaugata,camereta_adaugata,camereta_montata,camereta_montare_anulata,camereta_scoasa,camereta_adaugata,camereta_scoasa' THEN
    RAISE EXCEPTION 'T7 FAIL: jurnalul cameretelor: %', (SELECT string_agg(actiune, ',' ORDER BY id) FROM public.executie_fibra_jurnal WHERE camereta_id IS NOT NULL);
  END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- T8: garda pe executie_tronsoane — km strânși peste raportări / camerete active = refuz; peste cele anulate = permis; proiect; ștergere
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$UPDATE public.executie_tronsoane SET km_end_m = 900900 WHERE id = %s$q$, pg_temp.t_tr('FO-TEST-1')), '23514', 'iese din noile limite ale tronsonului FO-TEST-1')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_tronsoane SET km_start_m = NULL WHERE id = %s$q$, pg_temp.t_tr('FO-TEST-1')), '23514', 'iese din noile limite')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_tronsoane SET km_end_m = 901990 WHERE id = %s$q$, pg_temp.t_tr('FO-TEST-1')), '23514', 'camereta CT-902')
     OR NOT pg_temp.t_refuza(format($q$DELETE FROM public.executie_tronsoane WHERE id = %s$q$, pg_temp.t_tr('FO-TEST-1')), '23503') THEN
    RAISE EXCEPTION 'T8 FAIL: garda km / ștergere';
  END IF;
  IF pg_temp.t_g('p2') IS NOT NULL
     AND NOT pg_temp.t_refuza(format($q$UPDATE public.executie_tronsoane SET proiect_id = %s WHERE id = %s$q$, pg_temp.t_g('p2'), pg_temp.t_tr('FO-TEST-1')), '23514', 'proiectul lui nu se mai schimbă') THEN
    RAISE EXCEPTION 'T8 FAIL: garda proiect';
  END IF;
  -- lărgirea e permisă; o strângere care nu atinge nimic activ e permisă
  UPDATE public.executie_tronsoane SET km_end_m = 902000, km_start_m = 899000 WHERE id = pg_temp.t_tr('FO-TEST-1');
  UPDATE public.executie_tronsoane SET km_start_m = 900000 WHERE id = pg_temp.t_tr('FO-TEST-1');
  RAISE NOTICE 'T8 OK';
END $t$;

-- T9: proveniența și imuabilitatea pe orice cale (postgres, fără JWT): raportarea nu se modifică, anularea nu se reactivează, jurnalul
-- nu se modifică, identitatea cameretei nu se schimbă; EXCLUDE rămâne plasa de siguranță chiar fără trigger
DO $t$
DECLARE n integer;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$UPDATE public.executie_fibra_intervale SET km_pana_la_m = 900600 WHERE id = %s$q$, pg_temp.t_id('m1')), '23514', 'nu se modifică')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_fibra_intervale SET raportat_de = NULL WHERE id = %s$q$, pg_temp.t_id('m1')), '23514', 'nu se modifică')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_fibra_intervale SET stare = 'activ', motiv_anulare = NULL, anulat_la = NULL, anulat_de = NULL, anulat_nume = NULL WHERE id = %s$q$, pg_temp.t_id('s1')), '23514', 'nu se reactivează')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_fibra_jurnal SET valori = '{}'$q$, '23514', 'jurnalul nu se modifică')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_fibra_camerete SET km_m = 900301 WHERE id = %s$q$, pg_temp.t_id('c2')), '23514', 'nu se schimbă')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_fibra_intervale (proiect_id, tronson_id, etapa, km_de_la_m, km_pana_la_m, data_lucru, stare, motiv_anulare, anulat_la) VALUES (%s, %s, 'monotub', 901500, 901600, current_date, 'anulat', 'x', now())$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '23514', 'o raportare nouă e activă') THEN
    RAISE EXCEPTION 'T9 FAIL: imuabilitate';
  END IF;
  -- proveniența pusă de server: un INSERT direct cu raportat_de fals primește NULL (fără JWT)
  INSERT INTO public.executie_fibra_intervale (proiect_id, tronson_id, etapa, km_de_la_m, km_pana_la_m, data_lucru, raportat_de, raportat_nume)
  VALUES (pg_temp.t_g('p')::bigint, pg_temp.t_tr('FO-TEST-1'), 'monotub', 901500, 901600, current_date, pg_temp.t_g('ed')::uuid, 'fals');
  IF EXISTS (SELECT 1 FROM public.executie_fibra_intervale WHERE km_de_la_m = 901500 AND (raportat_de IS NOT NULL OR raportat_nume IS NOT NULL)) THEN
    RAISE EXCEPTION 'T9 FAIL: proveniența scrisă de client';
  END IF;
  ALTER TABLE public.executie_fibra_intervale DISABLE TRIGGER trg_executie_fibra_reguli_interval;
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_fibra_intervale (proiect_id, tronson_id, etapa, km_de_la_m, km_pana_la_m, data_lucru) VALUES (%s, %s, 'monotub', 901550, 901700, current_date)$q$, pg_temp.t_g('p'), pg_temp.t_tr('FO-TEST-1')), '23P01') THEN
    RAISE EXCEPTION 'T9 FAIL: EXCLUDE';
  END IF;
  ALTER TABLE public.executie_fibra_intervale ENABLE TRIGGER trg_executie_fibra_reguli_interval;
  RAISE NOTICE 'T9 OK';
END $t$;

-- T10: revenirea — nearmată = refuz; armată cu date = refuz (tranzacția abandonată până la savepoint, nimic nu se execută după eroare)
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t10a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261211a_executie_fibra_optica_ROLLBACK.sql
\set t10a_eroare :ERROR
\set t10a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t10a;
SELECT pg_temp.t_eroare('T10a', :'t10a_eroare', :'t10a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t10b;
SELECT set_config('gazpet.revenire_20261211a', 'SCOATE_FIBRA_OPTICA:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261211a_executie_fibra_optica_ROLLBACK.sql
\set t10b_eroare :ERROR
\set t10b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t10b;
SELECT pg_temp.t_eroare('T10b', :'t10b_eroare', :'t10b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'tabelele au randuri');
DO $t$ BEGIN
  IF to_regclass('public.executie_fibra_intervale') IS NULL OR NOT EXISTS (SELECT 1 FROM public.executie_fibra_intervale)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_fibra_garda_tronson') THEN
    RAISE EXCEPTION 'T10 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T10 OK (refuzurile „garda invalida” și „tabelele au randuri” au fost verificate explicit)';
END $t$;

-- T11: revenirea armată pe tabele goale scoate tot (și garda de pe tronsoane); re-aplicarea merge
DELETE FROM public.executie_fibra_jurnal;
DELETE FROM public.executie_fibra_intervale;
DELETE FROM public.executie_fibra_camerete;
SELECT set_config('gazpet.revenire_20261211a', 'SCOATE_FIBRA_OPTICA:' || txid_current(), true);
\ir ../supabase/revenire/20261211a_executie_fibra_optica_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_fibra_intervale') IS NOT NULL OR to_regprocedure('public.fn_executie_fibra_drept(bigint, boolean)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_fibra_garda_tronson') OR current_setting('gazpet.revenire_20261211a', true) <> '' THEN
    RAISE EXCEPTION 'T11 FAIL: revenirea';
  END IF;
  -- fără gardă, tronsonul se poate modifica din nou liber
  UPDATE public.executie_tronsoane SET km_end_m = 900100 WHERE id = pg_temp.t_tr('FO-TEST-1');
END $t$;
\ir ../supabase/migrations/20261211a_executie_fibra_optica.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_fibra_intervale') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_fibra_garda_tronson') THEN
    RAISE EXCEPTION 'T11 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T11 OK — toate testele au trecut; urmează ROLLBACK (nimic nu rămâne pe clonă)';
END $t$;

ROLLBACK;
