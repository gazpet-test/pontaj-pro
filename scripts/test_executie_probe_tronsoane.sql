-- Harness 20261202a_executie_probe_tronsoane — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_probe_tronsoane.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): [20261201a dacă lipsește] -> migrare (marcajul de livrare) -> teste ca non-owner
-- (SET LOCAL ROLE + ambele surse JWT: request.jwt.claim.sub și request.jwt.claims) -> revenire refuzată (nearmată / cu date) -> revenire
-- armată pe tabele goale -> re-aplicare. Identități reale din catalog (owner + 3 profiluri non-owner, cu drepturile 'executie' rescrise
-- DOAR în tranzacție), date FICTIVE (codurile P901…P905, km 890+000 … 999+999, zonă fără date reale).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
-- dependența: 20261201a (fn_executie_nod_drept). Pe o clonă fără ea, se aplică întâi, în aceeași tranzacție.
SELECT to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL AS lipseste_1201a \gset
\if :lipseste_1201a
\echo 'Clona nu are 20261201a: o aplic întâi (în aceeași tranzacție, anulată la final)'
SELECT set_config('gazpet.livrare_migrare', '20261201a_executie_noduri_suduri:' || txid_current(), true);
\ir ../supabase/migrations/20261201a_executie_noduri_suduri.sql
\endif
SELECT set_config('gazpet.livrare_migrare', '20261202a_executie_probe_tronsoane:' || txid_current(), true);
\ir ../supabase/migrations/20261202a_executie_probe_tronsoane.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 't_refuza: așteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM, 200); END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tpr.' || p, true), ''); $h$;
-- creare / modificare (denumire și observații NULL)
CREATE FUNCTION pg_temp.t_sal(p_proiect bigint, p_id bigint, p_ver integer, p_cod text, p_de integer, p_pana integer, p_cheie uuid)
RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_proba_salveaza(p_proiect, p_id, p_ver, p_cod, p_de, p_pana, NULL, NULL, p_cheie);
$h$;
-- id-ul unui tronson de probă activ, după cod, pe proiectul de lucru (tpr.pet dacă e setat, altfel tpr.p); citit ca rolul curent (RLS)
CREATE FUNCTION pg_temp.t_id(p_cod text) RETURNS bigint LANGUAGE sql STABLE AS $h$
  SELECT t.id FROM public.executie_probe_tronsoane t
   WHERE t.proiect_id = coalesce(pg_temp.t_g('pet'), pg_temp.t_g('p'))::bigint AND t.cod = p_cod AND t.stare = 'activ';
$h$;
CREATE FUNCTION pg_temp.t_eid(p_cod text, p_etapa text) RETURNS bigint LANGUAGE sql STABLE AS $h$
  SELECT e.id FROM public.executie_probe_etape e WHERE e.proba_id = pg_temp.t_id(p_cod) AND e.etapa = p_etapa;
$h$;
-- schimbarea unei etape; valorile într-un jsonb scurt: nr, roua, placa, fluid, pproba, pcur, durata, calc, rez, obs, motiv
CREATE FUNCTION pg_temp.t_et(p_cod text, p_etapa text, p_veche text, p_ver integer, p_noua text, p_data date, p_v jsonb, p_cheie uuid)
RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_proba_etapa(pg_temp.t_eid(p_cod, p_etapa), p_veche, p_ver, p_noua, p_data,
    (p_v->>'nr')::integer, (p_v->>'roua')::numeric, p_v->>'placa', p_v->>'fluid', (p_v->>'pproba')::numeric, (p_v->>'pcur')::numeric,
    (p_v->>'durata')::numeric, (p_v->>'calc')::bigint, p_v->>'rez', p_v->>'obs', p_v->>'motiv', p_cheie);
$h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0: psql :ERROR = true, :SQLSTATE și mesajul exact (L25: testul pică dacă trece)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_g(text),
  pg_temp.t_sal(bigint, bigint, integer, text, integer, integer, uuid), pg_temp.t_id(text), pg_temp.t_eid(text, text),
  pg_temp.t_et(text, text, text, integer, text, date, jsonb, uuid) TO authenticated, anon, service_role;

-- T0: identități, drepturi rescrise în tranzacție (executie + probe_teren), calcule Probe FICTIVE create în tranzacție pentru legătură
-- (cf1, cf2 pe proiectul de lucru, cf3 pe al doilea proiect, dacă există). Un test care nu se poate executa e marcat NEEXECUTAT (tpr.neexecutate),
-- iar mesajul final îl spune — nu trece drept „OK”.
DO $t$
DECLARE own uuid; ed uuid; vw uuid; fara uuid; p bigint; p2 bigint; ids uuid[]; cf1 bigint; cf2 bigint; cf3 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) x;
  SELECT id INTO p FROM public.executie_proiecte ORDER BY id LIMIT 1;
  SELECT id INTO p2 FROM public.executie_proiecte WHERE id <> p ORDER BY id LIMIT 1;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR p IS NULL THEN RAISE EXCEPTION 'T0 FAIL: identități / proiect'; END IF;
  ed := ids[1]; vw := ids[2]; fara := ids[3];
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module IN ('executie', 'probe_teren');
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ed, 'executie', 'editor'), (vw, 'executie', 'viewer');
  PERFORM set_config('tpr.neexecutate', '', true);
  -- calculele fictive: coloanele minime din fn_probe_creeaza_teren (20261115a); garda modulului Probe lasă proprietarul să scrie direct
  BEGIN
    INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES (p, 'aer', 'planificata') RETURNING id INTO cf1;
    INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES (p, 'aer', 'planificata') RETURNING id INTO cf2;
    IF p2 IS NOT NULL THEN INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES (p2, 'aer', 'planificata') RETURNING id INTO cf3; END IF;
  EXCEPTION WHEN OTHERS THEN
    cf1 := NULL; cf2 := NULL; cf3 := NULL;
    PERFORM set_config('tpr.neexecutate', 'T11 (calculele Probe fictive nu s-au putut crea: ' || SQLSTATE || ' ' || left(SQLERRM, 120) || ')', true);
  END;
  PERFORM set_config('tpr.owner', own::text, true); PERFORM set_config('tpr.ed', ed::text, true);
  PERFORM set_config('tpr.vw', vw::text, true); PERFORM set_config('tpr.fara', fara::text, true); PERFORM set_config('tpr.p', p::text, true);
  PERFORM set_config('tpr.p2', coalesce(p2::text, ''), true);
  PERFORM set_config('tpr.cf1', coalesce(cf1::text, ''), true); PERFORM set_config('tpr.cf2', coalesce(cf2::text, ''), true);
  PERFORM set_config('tpr.cf3', coalesce(cf3::text, ''), true); PERFORM set_config('tpr.pet', '', true);
  PERFORM set_config('tpr.azi', ((now() AT TIME ZONE 'Europe/Bucharest')::date)::text, true);
  RAISE NOTICE 'T0 OK (proiect %, al doilea proiect %, calcule fictive % / % / %)', p, coalesce(p2::text, '—'), cf1, cf2, coalesce(cf3::text, '—');
END $t$;

-- T1: creare ca editor: tronsonul + cele 4 etape + rândul de jurnal, proveniența din JWT; reluarea aceleiași apăsări = duplicat fără scriere
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; k uuid := gen_random_uuid(); p bigint := pg_temp.t_g('p')::bigint; ed uuid := pg_temp.t_g('ed')::uuid; v_id bigint;
BEGIN
  r := pg_temp.t_sal(p, NULL, NULL, 'P901', 900000, 905000, k);
  v_id := (r->'proba'->>'id')::bigint;
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'false' OR r->'proba'->>'cod' <> 'P901' OR (r->'proba'->>'versiune')::int <> 1
     OR (r->'proba'->>'creat_de')::uuid IS DISTINCT FROM ed OR (r->'proba'->>'modificat_de')::uuid IS DISTINCT FROM ed
     OR r->'proba'->>'stare' <> 'activ' OR (r->'proba'->>'km_de_la_m')::int <> 900000 OR (r->'proba'->>'km_pana_la_m')::int <> 905000 THEN
    RAISE EXCEPTION 'T1 FAIL: creare %', r;
  END IF;
  IF (SELECT string_agg(etapa || ':' || stare || ':' || versiune || ':' || proiect_id, ',' ORDER BY id) FROM public.executie_probe_etape WHERE proba_id = v_id)
       IS DISTINCT FROM format('pistonare:urmeaza:1:%1$s,uscare:urmeaza:1:%1$s,calibrare:urmeaza:1:%1$s,presiune:urmeaza:1:%1$s', p) THEN
    RAISE EXCEPTION 'T1 FAIL: etapele';
  END IF;
  IF (SELECT count(*) FROM public.executie_probe_jurnal WHERE proba_id = v_id AND actiune = 'creare' AND cheie = k AND creat_de = ed
        AND valori->>'cod' = 'P901' AND (valori->>'km_pana_la_m')::int = 905000) <> 1 THEN
    RAISE EXCEPTION 'T1 FAIL: jurnalul creării';
  END IF;
  r := pg_temp.t_sal(p, NULL, NULL, 'P901', 900000, 905000, k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'true' OR (r->'proba'->>'id')::bigint <> v_id THEN RAISE EXCEPTION 'T1 FAIL: reluarea %', r; END IF;
  IF (SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = p AND cod = 'P901') <> 1
     OR (SELECT count(*) FROM public.executie_probe_jurnal WHERE cheie = k) <> 1
     OR (SELECT count(*) FROM public.executie_probe_etape WHERE proba_id = v_id) <> 4 THEN
    RAISE EXCEPTION 'T1 FAIL: reluarea a scris';
  END IF;
  -- aceeași cheie, alt conținut = eroare
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P901', 900000, 905500, %L)$q$, p, k), '22023') THEN RAISE EXCEPTION 'T1 FAIL: cheie refolosită'; END IF;
  PERFORM set_config('tpr.k901', k::text, true);
  PERFORM set_config('tpr.id901', v_id::text, true);
  PERFORM set_config('tpr.e901p', pg_temp.t_eid('P901', 'pistonare')::text, true);
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: nesuprapunerea, codul, intervalul (mesaje clare din RPC); capetele se pot atinge
DO $t$
DECLARE r jsonb; p bigint := pg_temp.t_g('p')::bigint;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P902', 904000, 906000, gen_random_uuid())$q$, p), '22023')   -- prinde sfârșitul lui P901
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P902', 899000, 900001, gen_random_uuid())$q$, p), '22023')  -- prinde începutul
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P902', 901000, 902000, gen_random_uuid())$q$, p), '22023')  -- în interior
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P902', 899000, 906000, gen_random_uuid())$q$, p), '22023')  -- îl acoperă
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P901', 910000, 911000, gen_random_uuid())$q$, p), '22023')  -- cod dublu
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'X1', 910000, 911000, gen_random_uuid())$q$, p), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P', 910000, 911000, gen_random_uuid())$q$, p), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P1234', 910000, 911000, gen_random_uuid())$q$, p), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P1-A', 910000, 911000, gen_random_uuid())$q$, p), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P906', 911000, 911000, gen_random_uuid())$q$, p), '22023')  -- interval gol
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P906', 912000, 911000, gen_random_uuid())$q$, p), '22023')  -- inversat
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P906', -1, 10, gen_random_uuid())$q$, p), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P906', 999999, 1000001, gen_random_uuid())$q$, p), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, 1, 'P906', 911000, 912000, gen_random_uuid())$q$, p), '22023')    -- versiune fără id
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P906', 911000, 912000, NULL)$q$, p), '22023') THEN       -- fără cheie
    RAISE EXCEPTION 'T2 FAIL: suprapunere / cod / interval / parametri';
  END IF;
  -- mesajul suprapunerii numește tronsonul de probă cu care se suprapune
  BEGIN
    PERFORM pg_temp.t_sal(p, NULL, NULL, 'P909', 903000, 909000, gen_random_uuid());
    RAISE EXCEPTION 'T2 FAIL: suprapunerea cu P901 a trecut';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF position('P901' IN SQLERRM) = 0 THEN RAISE EXCEPTION 'T2 FAIL: mesajul nu numește P901: %', SQLERRM; END IF;
  END;
  r := pg_temp.t_sal(p, NULL, NULL, 'P902', 905000, 908000, gen_random_uuid());     -- capăt la capăt după P901
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T2 FAIL: P902 %', r; END IF;
  r := pg_temp.t_sal(p, NULL, NULL, 'P903', 895000, 900000, gen_random_uuid());     -- capăt la capăt înainte de P901
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T2 FAIL: P903 %', r; END IF;
  r := pg_temp.t_sal(p, NULL, NULL, ' p904 ', 920000, 921000, gen_random_uuid());   -- codul se normalizează (spații, litere mici)
  IF r->>'ok' <> 'true' OR r->'proba'->>'cod' <> 'P904' THEN RAISE EXCEPTION 'T2 FAIL: P904 %', r; END IF;
  PERFORM set_config('tpr.id902', pg_temp.t_id('P902')::text, true);
  PERFORM set_config('tpr.id903', pg_temp.t_id('P903')::text, true);
  PERFORM set_config('tpr.id904', pg_temp.t_id('P904')::text, true);
  PERFORM set_config('tpr.e904p', pg_temp.t_eid('P904', 'pistonare')::text, true);
  PERFORM set_config('tpr.e903s', pg_temp.t_eid('P903', 'presiune')::text, true);
  PERFORM set_config('tpr.e903c', pg_temp.t_eid('P903', 'calibrare')::text, true);
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: citirea prin RLS: editor și viewer văd, cel fără drept nu vede nimic, anon nu are drept de citire
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = pg_temp.t_g('p')::bigint AND cod LIKE 'P90_') <> 4
     OR (SELECT count(*) FROM public.executie_probe_etape e JOIN public.executie_probe_tronsoane t ON t.id = e.proba_id WHERE t.cod LIKE 'P90_') <> 16
     OR (SELECT count(*) FROM public.executie_probe_jurnal j JOIN public.executie_probe_tronsoane t ON t.id = j.proba_id WHERE t.cod LIKE 'P90_') <> 4 THEN
    RAISE EXCEPTION 'T3 FAIL: editor';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_probe_tronsoane WHERE cod LIKE 'P90_') <> 4
     OR (SELECT count(*) FROM public.executie_probe_etape e JOIN public.executie_probe_tronsoane t ON t.id = e.proba_id WHERE t.cod LIKE 'P90_') <> 16
     OR (SELECT count(*) FROM public.executie_probe_jurnal j JOIN public.executie_probe_tronsoane t ON t.id = j.proba_id WHERE t.cod LIKE 'P90_') <> 4 THEN
    RAISE EXCEPTION 'T3 FAIL: viewer';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_probe_tronsoane) OR EXISTS (SELECT 1 FROM public.executie_probe_etape)
     OR EXISTS (SELECT 1 FROM public.executie_probe_jurnal) THEN
    RAISE EXCEPTION 'T3 FAIL: fără drept vede rânduri';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_probe_tronsoane', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_probe_etape', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_probe_jurnal', '42501') THEN
    RAISE EXCEPTION 'T3 FAIL: anon';
  END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- T4: scrierea directă e refuzată pentru editor și pentru service_role; service_role nu are RPC-urile
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_probe_tronsoane (proiect_id, cod, km_de_la_m, km_pana_la_m) VALUES (%s, 'P990', 990000, 991000)$q$, pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_probe_tronsoane SET km_pana_la_m = 999000 WHERE cod LIKE 'P90_'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_probe_tronsoane WHERE cod LIKE 'P90_'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_probe_etape SET stare = 'facut'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_probe_etape$q$, '42501')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_probe_jurnal (proba_id, proiect_id, actiune, cheie, amprenta) VALUES (%s, %s, 'creare', gen_random_uuid(), md5('x'))$q$, pg_temp.t_g('id901'), pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_probe_jurnal SET valori = '{}'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_probe_jurnal$q$, '42501') THEN
    RAISE EXCEPTION 'T4 FAIL: editor scrie direct';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$UPDATE public.executie_probe_tronsoane SET km_pana_la_m = 999000$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_probe_jurnal$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_salveaza(1, NULL, NULL, 'P990', 990000, 991000, NULL, NULL, gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_anuleaza(1, 1, 'x', gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_etapa(1, 'urmeaza', 1, 'in_curs', current_date, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, '42501') THEN
    RAISE EXCEPTION 'T4 FAIL: service_role scrie';
  END IF;
  RAISE NOTICE 'T4 OK';
END $t$;

-- T5: dreptul de scriere pe RPC-uri — viewer, fără drept, id inexistent, JWT fără sub, anon: refuz (mesaj generic, 42501)
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P990', 990000, 991000, gen_random_uuid())$q$, pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, %s, 1, 'P901', 900000, 905000, gen_random_uuid())$q$, pg_temp.t_g('p'), pg_temp.t_g('id901')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_etapa(%s, 'urmeaza', 1, 'in_curs', %L, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('e901p'), pg_temp.t_g('azi')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_anuleaza(%s, 1, 'x', gen_random_uuid())$q$, pg_temp.t_g('id901')), '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: viewer';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P990', 990000, 991000, gen_random_uuid())$q$, pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_etapa(%s, 'urmeaza', 1, 'in_curs', %L, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('e901p'), pg_temp.t_g('azi')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_anuleaza(%s, 1, 'x', gen_random_uuid())$q$, pg_temp.t_g('id901')), '42501')
     -- un id care nu există primește același mesaj generic (nu se poate deosebi „nu există” de „nu ai drept”)
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_etapa(-1, 'urmeaza', 1, 'in_curs', %L, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_anuleaza(-1, 1, 'x', gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT pg_temp.t_sal(-1, NULL, NULL, 'P990', 990000, 991000, gen_random_uuid())$q$, '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: fără drept / inexistent';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, NULL, NULL, 'P990', 990000, 991000, gen_random_uuid())$q$, pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_etapa(%s, 'urmeaza', 1, 'in_curs', %L, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('e901p'), pg_temp.t_g('azi')), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_anuleaza(%s, 1, 'x', gen_random_uuid())$q$, pg_temp.t_g('id901')), '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: fără sub';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_salveaza(1, NULL, NULL, 'P990', 990000, 991000, NULL, NULL, gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_anuleaza(1, 1, 'x', gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_proba_etapa(1, 'urmeaza', 1, 'in_curs', current_date, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: anon';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT versiune FROM public.executie_probe_tronsoane WHERE id = pg_temp.t_g('id901')::bigint) <> 1
     OR (SELECT stare || versiune FROM public.executie_probe_etape WHERE id = pg_temp.t_g('e901p')::bigint) <> 'urmeaza1'
     OR EXISTS (SELECT 1 FROM public.executie_probe_tronsoane WHERE cod = 'P990') THEN
    RAISE EXCEPTION 'T5 FAIL: un refuz a scris ceva';
  END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- T6: lanțul etapelor pe P901 ca editor (identitatea din JWT, regulile pe fiecare pas)
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; ed uuid := pg_temp.t_g('ed')::uuid;
BEGIN
  -- pistonare: în curs (2 treceri) -> actualizare (4) -> făcut doar cu nr. de treceri -> corectură doar cu motiv
  r := pg_temp.t_et('P901', 'pistonare', 'urmeaza', 1, 'in_curs', z, '{"nr":2,"obs":"prima trecere"}', gen_random_uuid());
  IF r->>'ok' <> 'true' OR r->'etapa'->>'stare' <> 'in_curs' OR (r->'etapa'->>'versiune')::int <> 2 OR (r->'etapa'->>'nr_treceri')::int <> 2
     OR (r->'etapa'->>'data_start')::date <> z OR (r->'etapa'->>'data_stare')::date <> z OR r->'etapa'->>'data_final' IS NOT NULL
     OR (r->'etapa'->>'modificat_de')::uuid IS DISTINCT FROM ed OR r->'etapa'->>'observatii' <> 'prima trecere' THEN
    RAISE EXCEPTION 'T6 FAIL: pistonare în curs %', r;
  END IF;
  r := pg_temp.t_et('P901', 'pistonare', 'in_curs', 2, 'in_curs', z, '{"nr":4}', gen_random_uuid());
  IF (r->'etapa'->>'nr_treceri')::int <> 4 OR r->'etapa'->>'observatii' IS NOT NULL OR (r->'etapa'->>'versiune')::int <> 3 THEN RAISE EXCEPTION 'T6 FAIL: actualizare %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'pistonare', 'in_curs', 3, 'facut', %L, '{}', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T6 FAIL: făcut fără treceri'; END IF;
  r := pg_temp.t_et('P901', 'pistonare', 'in_curs', 3, 'facut', z, '{"nr":4}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'facut' OR (r->'etapa'->>'data_final')::date <> z OR (r->'etapa'->>'data_start')::date <> z THEN RAISE EXCEPTION 'T6 FAIL: pistonare făcută %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'pistonare', 'facut', 4, 'facut', %L, '{"nr":5}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'pistonare', 'facut', 4, 'facut', %L, '{"nr":5,"placa":"ok","motiv":"x"}', gen_random_uuid())$q$, z), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: corectură fără motiv / câmp străin';
  END IF;
  r := pg_temp.t_et('P901', 'pistonare', 'facut', 4, 'facut', z, '{"nr":5,"motiv":"corectură număr treceri"}', gen_random_uuid());
  IF (r->'etapa'->>'nr_treceri')::int <> 5 OR (r->'etapa'->>'versiune')::int <> 5 OR r->'etapa'->>'motiv' <> 'corectură număr treceri' THEN RAISE EXCEPTION 'T6 FAIL: corectură %', r; END IF;

  -- uscare: nu se aplică (motiv, fără valori) -> înapoi la urmează (motiv) -> făcută direct, cu punct de rouă
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'uscare', 'urmeaza', 1, 'nu_se_aplica', %L, '{}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'uscare', 'urmeaza', 1, 'nu_se_aplica', %L, '{"motiv":"probă cu aer","roua":-20}', gen_random_uuid())$q$, z), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: nu se aplică fără motiv / cu valori';
  END IF;
  r := pg_temp.t_et('P901', 'uscare', 'urmeaza', 1, 'nu_se_aplica', z, '{"motiv":"probă cu aer"}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'nu_se_aplica' OR r->'etapa'->>'data_start' IS NOT NULL OR (r->'etapa'->>'data_stare')::date <> z THEN RAISE EXCEPTION 'T6 FAIL: nu se aplică %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'uscare', 'nu_se_aplica', 2, 'urmeaza', %L, '{}', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T6 FAIL: revenire fără motiv'; END IF;
  r := pg_temp.t_et('P901', 'uscare', 'nu_se_aplica', 2, 'urmeaza', z, '{"motiv":"se usucă totuși"}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'urmeaza' THEN RAISE EXCEPTION 'T6 FAIL: revenire %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'uscare', 'urmeaza', 3, 'facut', %L, '{"roua":-20.55}', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T6 FAIL: rouă cu 2 zecimale'; END IF;
  r := pg_temp.t_et('P901', 'uscare', 'urmeaza', 3, 'facut', z, '{"roua":-20.5}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'facut' OR (r->'etapa'->>'punct_roua_c')::numeric <> -20.5 OR (r->'etapa'->>'data_final')::date <> z THEN RAISE EXCEPTION 'T6 FAIL: uscare %', r; END IF;

  -- calibrare: placa deformată = de refăcut (cu motiv), nu „făcut”; apoi din nou în curs și făcută cu placa OK (normalizată)
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'calibrare', 'urmeaza', 1, 'facut', %L, '{"placa":"deformata"}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'calibrare', 'urmeaza', 1, 'refacere', %L, '{"placa":"deformata"}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'calibrare', 'urmeaza', 1, 'refacere', %L, '{"placa":"strâmbă","motiv":"x"}', gen_random_uuid())$q$, z), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: calibrare deformată / placă necunoscută';
  END IF;
  r := pg_temp.t_et('P901', 'calibrare', 'urmeaza', 1, 'refacere', z, '{"placa":"deformata","motiv":"placa îndoită la km 902+300"}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'refacere' OR r->'etapa'->>'placa' <> 'deformata' OR (r->'etapa'->>'data_start')::date <> z THEN RAISE EXCEPTION 'T6 FAIL: refacere %', r; END IF;
  r := pg_temp.t_et('P901', 'calibrare', 'refacere', 2, 'in_curs', z, '{}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'in_curs' OR r->'etapa'->>'placa' IS NOT NULL OR r->'etapa'->>'motiv' IS NOT NULL THEN RAISE EXCEPTION 'T6 FAIL: calibrare reluată %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'calibrare', 'in_curs', 3, 'facut', %L, '{}', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T6 FAIL: calibrare făcută fără placă'; END IF;
  r := pg_temp.t_et('P901', 'calibrare', 'in_curs', 3, 'facut', z, '{"placa":" OK ","rez":"placa fără deformări"}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'facut' OR r->'etapa'->>'placa' <> 'ok' OR r->'etapa'->>'rezultat' <> 'placa fără deformări' THEN RAISE EXCEPTION 'T6 FAIL: calibrare %', r; END IF;

  -- presiune: în curs doar cu presiunea de probă; câmpurile altor etape, zecimalele în plus și fluidul necunoscut = refuz
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{"pproba":48.5,"nr":1}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{"pproba":48.555}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{"pproba":48.5,"fluid":"ulei"}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{"pproba":0}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{"pproba":251}', gen_random_uuid())$q$, z), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: presiune — reguli';
  END IF;
  r := pg_temp.t_et('P901', 'presiune', 'urmeaza', 1, 'in_curs', z, '{"pproba":48.5,"fluid":"Aer"}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'in_curs' OR (r->'etapa'->>'presiune_proba_bar')::numeric <> 48.5 OR r->'etapa'->>'fluid' <> 'aer'
     OR r->'etapa'->>'presiune_curenta_bar' IS NOT NULL OR r->'etapa'->>'presiune_curenta_la' IS NOT NULL THEN RAISE EXCEPTION 'T6 FAIL: presiune pornită %', r; END IF;
  r := pg_temp.t_et('P901', 'presiune', 'in_curs', 2, 'in_curs', z, '{"pproba":48.5,"fluid":"aer","pcur":48.4}', gen_random_uuid());
  IF (r->'etapa'->>'presiune_curenta_bar')::numeric <> 48.4 OR r->'etapa'->>'presiune_curenta_la' IS NULL THEN RAISE EXCEPTION 'T6 FAIL: citire %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'in_curs', 3, 'facut', %L, '{"pproba":48.5,"fluid":"aer","pcur":48.3}', gen_random_uuid())$q$, z), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P901', 'presiune', 'in_curs', 3, 'facut', %L, '{"pproba":48.5,"fluid":"aer","pcur":48.3,"durata":1.25}', gen_random_uuid())$q$, z), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: făcută fără durată / durată cu 2 zecimale';
  END IF;
  r := pg_temp.t_et('P901', 'presiune', 'in_curs', 3, 'facut', z, '{"pproba":48.5,"fluid":"aer","pcur":48.3,"durata":24,"rez":"admis"}', gen_random_uuid());
  IF r->'etapa'->>'stare' <> 'facut' OR (r->'etapa'->>'durata_ore')::numeric <> 24 OR r->'etapa'->>'rezultat' <> 'admis' OR (r->'etapa'->>'presiune_curenta_bar')::numeric <> 48.3 THEN
    RAISE EXCEPTION 'T6 FAIL: presiune făcută %', r;
  END IF;
  -- jurnalul: câte un rând pe fiecare schimbare reușită, în ordine, cu starea veche / nouă și valorile trimise
  IF (SELECT string_agg(e.etapa || ':' || j.stare_veche || '>' || j.stare_noua, ',' ORDER BY j.id)
        FROM public.executie_probe_jurnal j JOIN public.executie_probe_etape e ON e.id = j.etapa_id WHERE j.proba_id = pg_temp.t_g('id901')::bigint)
     IS DISTINCT FROM 'pistonare:urmeaza>in_curs,pistonare:in_curs>in_curs,pistonare:in_curs>facut,pistonare:facut>facut,uscare:urmeaza>nu_se_aplica,uscare:nu_se_aplica>urmeaza,uscare:urmeaza>facut,calibrare:urmeaza>refacere,calibrare:refacere>in_curs,calibrare:in_curs>facut,presiune:urmeaza>in_curs,presiune:in_curs>in_curs,presiune:in_curs>facut'
     OR (SELECT valori->>'presiune_curenta_bar' FROM public.executie_probe_jurnal WHERE proba_id = pg_temp.t_g('id901')::bigint ORDER BY id DESC LIMIT 1) <> '48.3'
     OR EXISTS (SELECT 1 FROM public.executie_probe_jurnal WHERE proba_id = pg_temp.t_g('id901')::bigint AND creat_de IS DISTINCT FROM pg_temp.t_g('ed')::uuid) THEN
    RAISE EXCEPTION 'T6 FAIL: jurnalul etapelor';
  END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- T7: CAS — versiunea / starea veche nu mai corespund: conflict, rândul neschimbat
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  r := pg_temp.t_et('P901', 'pistonare', 'facut', 4, 'refacere', z, '{"motiv":"x"}', gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' OR (r->'etapa'->>'versiune')::int <> 5 THEN RAISE EXCEPTION 'T7 FAIL: versiune veche %', r; END IF;
  r := pg_temp.t_et('P901', 'pistonare', 'in_curs', 5, 'facut', z, '{"nr":5}', gen_random_uuid());
  IF r->>'motiv' <> 'conflict' THEN RAISE EXCEPTION 'T7 FAIL: stare veche %', r; END IF;
  r := pg_temp.t_sal(pg_temp.t_g('p')::bigint, pg_temp.t_g('id902')::bigint, 7, 'P902', 905000, 908000, gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' THEN RAISE EXCEPTION 'T7 FAIL: tronson versiune veche %', r; END IF;
  IF (SELECT versiune FROM public.executie_probe_etape WHERE id = pg_temp.t_g('e901p')::bigint) <> 5
     OR (SELECT versiune FROM public.executie_probe_tronsoane WHERE id = pg_temp.t_g('id902')::bigint) <> 1 THEN RAISE EXCEPTION 'T7 FAIL: s-a scris'; END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- T8: idempotența etapelor — aceeași cheie + același conținut = duplicat; altă schimbare / altă etapă / cheia unei creări = eroare
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; k uuid := gen_random_uuid();
BEGIN
  r := pg_temp.t_et('P902', 'calibrare', 'urmeaza', 1, 'in_curs', z, '{}', k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'false' THEN RAISE EXCEPTION 'T8 FAIL: prima %', r; END IF;
  r := pg_temp.t_et('P902', 'calibrare', 'urmeaza', 1, 'in_curs', z, '{}', k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'true' OR (r->'etapa'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T8 FAIL: reluarea %', r; END IF;
  IF (SELECT count(*) FROM public.executie_probe_jurnal WHERE cheie = k) <> 1 THEN RAISE EXCEPTION 'T8 FAIL: reluarea a scris în jurnal'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P902', 'calibrare', 'urmeaza', 1, 'in_curs', %L, '{"obs":"alt"}', %L)$q$, z, k), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P902', 'uscare', 'urmeaza', 1, 'in_curs', %L, '{}', %L)$q$, z, k), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P902', 'uscare', 'urmeaza', 1, 'in_curs', %L, '{}', %L)$q$, z, pg_temp.t_g('k901')), '22023') THEN
    RAISE EXCEPTION 'T8 FAIL: cheie refolosită';
  END IF;
  RAISE NOTICE 'T8 OK';
END $t$;

-- T9: tranzițiile — toate cele 25 de perechi față de lista decisă (scrisă aici independent de funcție)
DO $t$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM unnest(ARRAY['urmeaza','in_curs','facut','refacere','nu_se_aplica']) v,
                              unnest(ARRAY['urmeaza','in_curs','facut','refacere','nu_se_aplica']) w
   WHERE public.fn_executie_proba_tranzitie(v, w) IS DISTINCT FROM (v || '>' || w = ANY (ARRAY[
     'urmeaza>in_curs','urmeaza>facut','urmeaza>refacere','urmeaza>nu_se_aplica',
     'in_curs>in_curs','in_curs>facut','in_curs>refacere',
     'refacere>in_curs','refacere>facut',
     'facut>facut','facut>refacere',
     'nu_se_aplica>urmeaza']));
  IF n <> 0 OR public.fn_executie_proba_tranzitie('facut', NULL) OR public.fn_executie_proba_tranzitie(NULL, 'facut')
     OR public.fn_executie_proba_tranzitie('urmeaza', 'anulat') THEN RAISE EXCEPTION 'T9 FAIL: % perechi diferite', n; END IF;
  RAISE NOTICE 'T9 OK';
END $t$;

-- T10: data (Europe/Bucharest): nu în viitor, cel mult 730 de zile în urmă, „făcut” nu înaintea începutului etapei
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P902', 'pistonare', 'urmeaza', 1, 'in_curs', %L, '{"nr":1}', gen_random_uuid())$q$, z + 1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P902', 'pistonare', 'urmeaza', 1, 'in_curs', %L, '{"nr":1}', gen_random_uuid())$q$, z - 731), '22023') THEN
    RAISE EXCEPTION 'T10 FAIL: fereastra';
  END IF;
  r := pg_temp.t_et('P902', 'pistonare', 'urmeaza', 1, 'in_curs', z - 10, '{"nr":1}', gen_random_uuid());
  IF (r->'etapa'->>'data_start')::date <> z - 10 THEN RAISE EXCEPTION 'T10 FAIL: început în trecut %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P902', 'pistonare', 'in_curs', 2, 'facut', %L, '{"nr":1}', gen_random_uuid())$q$, z - 11), '22023') THEN
    RAISE EXCEPTION 'T10 FAIL: făcut înaintea începutului';
  END IF;
  r := pg_temp.t_et('P902', 'pistonare', 'in_curs', 2, 'facut', z - 10, '{"nr":1}', gen_random_uuid());
  IF (r->'etapa'->>'data_final')::date <> z - 10 THEN RAISE EXCEPTION 'T10 FAIL: făcut în aceeași zi %', r; END IF;
  r := pg_temp.t_et('P902', 'uscare', 'urmeaza', 1, 'in_curs', z - 730, '{}', gen_random_uuid());
  IF (r->'etapa'->>'data_start')::date <> z - 730 THEN RAISE EXCEPTION 'T10 FAIL: limita de 730 de zile %', r; END IF;
  RAISE NOTICE 'T10 OK';
END $t$;

-- T11: legătura cu modulul Probe, pe calculele FICTIVE din T0 (niciun calcul real nu e atins)
-- T11a: editorul Execuție FĂRĂ drept pe Probe nu poate lega (42501, mesaj generic)
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; cf1 bigint := pg_temp.t_g('cf1')::bigint;
BEGIN
  IF cf1 IS NULL THEN RAISE NOTICE 'T11 NEEXECUTAT: %', pg_temp.t_g('neexecutate'); RETURN; END IF;
  r := pg_temp.t_sal(pg_temp.t_g('p')::bigint, NULL, NULL, 'P905', 930000, 931000, gen_random_uuid());
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T11 FAIL: P905 %', r; END IF;
  PERFORM set_config('tpr.e905s', pg_temp.t_eid('P905', 'presiune')::text, true);
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P905', 'presiune', 'urmeaza', 1, 'in_curs', %L, %L, gen_random_uuid())$q$,
                                 z, jsonb_build_object('pproba', 10, 'calc', cf1)), '42501') THEN
    RAISE EXCEPTION 'T11a FAIL: legare fără drept pe Probe';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF pg_temp.t_g('cf1') IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (pg_temp.t_g('ed')::uuid, 'probe_teren', 'viewer');
END $t$;
-- T11b: cu drept de citire pe Probe: calcul inexistent / de pe alt proiect = refuz; calcul al aceluiași proiect = legat
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; cf1 bigint := pg_temp.t_g('cf1')::bigint; cf3 bigint := pg_temp.t_g('cf3')::bigint;
BEGIN
  IF cf1 IS NULL THEN RETURN; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P905', 'presiune', 'urmeaza', 1, 'in_curs', %L, '{"pproba":10,"calc":-1}', gen_random_uuid())$q$, z), '42501')
     OR (cf3 IS NOT NULL AND NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P905', 'presiune', 'urmeaza', 1, 'in_curs', %L, %L, gen_random_uuid())$q$,
                                                         z, jsonb_build_object('pproba', 10, 'calc', cf3)), '42501')) THEN
    RAISE EXCEPTION 'T11b FAIL: calcul inexistent / de pe alt proiect';
  END IF;
  r := pg_temp.t_et('P905', 'presiune', 'urmeaza', 1, 'in_curs', z, jsonb_build_object('pproba', 10, 'calc', cf1), gen_random_uuid());
  IF (r->'etapa'->>'probe_calc_id')::bigint IS DISTINCT FROM cf1 THEN RAISE EXCEPTION 'T11b FAIL: legătura %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF pg_temp.t_g('cf1') IS NULL THEN RETURN; END IF;
  DELETE FROM public.user_module_access WHERE profile_id = pg_temp.t_g('ed')::uuid AND module = 'probe_teren';
END $t$;
-- T11c: din nou fără drept pe Probe: păstrarea legăturii existente merge (citire nouă de presiune), schimbarea ei e refuzată, dezlegarea merge
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; cf1 bigint := pg_temp.t_g('cf1')::bigint; cf2 bigint := pg_temp.t_g('cf2')::bigint;
BEGIN
  IF cf1 IS NULL THEN RETURN; END IF;
  r := pg_temp.t_et('P905', 'presiune', 'in_curs', 2, 'in_curs', z, jsonb_build_object('pproba', 10, 'pcur', 9.5, 'calc', cf1), gen_random_uuid());
  IF r->>'ok' <> 'true' OR (r->'etapa'->>'probe_calc_id')::bigint IS DISTINCT FROM cf1 OR (r->'etapa'->>'presiune_curenta_bar')::numeric <> 9.5 THEN
    RAISE EXCEPTION 'T11c FAIL: păstrarea legăturii %', r;
  END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_et('P905', 'presiune', 'in_curs', 3, 'in_curs', %L, %L, gen_random_uuid())$q$,
                                 z, jsonb_build_object('pproba', 10, 'calc', cf2)), '42501') THEN
    RAISE EXCEPTION 'T11c FAIL: schimbarea legăturii fără drept pe Probe';
  END IF;
  r := pg_temp.t_et('P905', 'presiune', 'in_curs', 3, 'in_curs', z, '{"pproba":10}', gen_random_uuid());
  IF r->'etapa'->>'probe_calc_id' IS NOT NULL THEN RAISE EXCEPTION 'T11c FAIL: dezlegarea %', r; END IF;
END $t$;
-- T11d: plasa structurală (FK compus) și ștergerea din Probe, ca proprietar (mentenanță); orice eroare neașteptată oprește rularea
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE cf1 bigint := pg_temp.t_g('cf1')::bigint; cf3 bigint := pg_temp.t_g('cf3')::bigint; e bigint := pg_temp.t_g('e905s')::bigint; p bigint := pg_temp.t_g('p')::bigint; v integer;
BEGIN
  IF cf1 IS NULL THEN RETURN; END IF;
  UPDATE public.executie_probe_etape SET probe_calc_id = cf1 WHERE id = e;   -- legătură pe același proiect: trece
  IF cf3 IS NOT NULL THEN
    IF NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET probe_calc_id = %s WHERE id = %s$q$, cf3, e), '23503')
       OR NOT pg_temp.t_refuza(format($q$UPDATE public.probe_calcule SET proiect_id = %s WHERE id = %s$q$, pg_temp.t_g('p2'), cf1), '23503') THEN
      RAISE EXCEPTION 'T11d FAIL: legătura spre alt proiect / mutarea calculului legat pe alt proiect';
    END IF;
  ELSE
    PERFORM set_config('tpr.neexecutate', concat_ws('; ', pg_temp.t_g('neexecutate'), 'T11d alt proiect (clona are un singur proiect de Execuție)'), true);
    RAISE NOTICE 'T11d NEEXECUTAT: clona are un singur proiect de Execuție (refuzul „alt proiect” nu s-a putut proba)';
  END IF;
  v := (SELECT versiune FROM public.executie_probe_etape WHERE id = e);
  DELETE FROM public.probe_calcule WHERE id = cf1;
  -- golirea legăturii de către Probe: doar legătura, iar versiunea crește (trigger), ca CAS-ul clienților să vadă schimbarea
  IF (SELECT probe_calc_id IS NOT NULL OR proiect_id IS DISTINCT FROM p OR versiune <> v + 1 FROM public.executie_probe_etape WHERE id = e) THEN
    RAISE EXCEPTION 'T11d FAIL: ștergerea calculului nu a golit doar legătura / nu a crescut versiunea';
  END IF;
  -- o schimbare de legătură scrisă de RPC nu crește versiunea de două ori (o crește RPC-ul, trigger-ul o lasă)
  UPDATE public.executie_probe_etape SET probe_calc_id = pg_temp.t_g('cf2')::bigint, versiune = versiune + 1 WHERE id = e;
  IF (SELECT versiune FROM public.executie_probe_etape WHERE id = e) <> v + 2 THEN RAISE EXCEPTION 'T11d FAIL: versiunea crescută de două ori'; END IF;
  RAISE NOTICE 'T11 OK (fără drept Probe = refuz; alt proiect = refuz; păstrare / dezlegare fără drept Probe; FK compus; ON DELETE SET NULL)';
END $t$;

-- T12: anularea — motiv obligatoriu, CAS, idempotentă; tronsonul anulat nu mai primește schimbări; intervalul și codul se eliberează
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; k uuid := gen_random_uuid(); id904 bigint := pg_temp.t_g('id904')::bigint; p bigint := pg_temp.t_g('p')::bigint;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_anuleaza(%s, 1, '  ', gen_random_uuid())$q$, id904), '22023') THEN RAISE EXCEPTION 'T12 FAIL: fără motiv'; END IF;
  r := public.fn_executie_proba_anuleaza(id904, 9, 'x', gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' THEN RAISE EXCEPTION 'T12 FAIL: CAS %', r; END IF;
  r := public.fn_executie_proba_anuleaza(id904, 1, 'definit greșit', k);
  IF r->>'ok' <> 'true' OR r->'proba'->>'stare' <> 'anulat' OR r->'proba'->>'motiv_anulare' <> 'definit greșit' OR (r->'proba'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T12 FAIL: anulare %', r; END IF;
  r := public.fn_executie_proba_anuleaza(id904, 1, 'definit greșit', k);
  IF r->>'duplicat' <> 'true' THEN RAISE EXCEPTION 'T12 FAIL: reluarea anulării %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_anuleaza(%s, 2, 'iar', gen_random_uuid())$q$, id904), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_proba_etapa(%s, 'urmeaza', 1, 'in_curs', %L, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('e904p'), pg_temp.t_g('azi')), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, %s, 2, 'P904', 920000, 921000, gen_random_uuid())$q$, p, id904), '22023') THEN
    RAISE EXCEPTION 'T12 FAIL: tronson anulat modificat';
  END IF;
  r := pg_temp.t_sal(p, NULL, NULL, 'P904', 920000, 921000, gen_random_uuid());
  IF r->>'ok' <> 'true' OR (r->'proba'->>'id')::bigint = id904 THEN RAISE EXCEPTION 'T12 FAIL: intervalul / codul nu s-au eliberat %', r; END IF;
  IF (SELECT string_agg(actiune, ',' ORDER BY id) FROM public.executie_probe_jurnal WHERE proba_id = id904) IS DISTINCT FROM 'creare,anulare' THEN
    RAISE EXCEPTION 'T12 FAIL: jurnalul anulării';
  END IF;
  RAISE NOTICE 'T12 OK';
END $t$;

-- T13: modificarea intervalului — CAS, aceleași reguli (suprapunere, cod), proiectul trimis = proiectul rândului; jurnal cu înainte / după
DO $t$
DECLARE r jsonb; k uuid := gen_random_uuid(); id903 bigint := pg_temp.t_g('id903')::bigint; p bigint := pg_temp.t_g('p')::bigint;
BEGIN
  r := pg_temp.t_sal(p, id903, 1, 'P903', 894000, 900000, k);
  IF r->>'ok' <> 'true' OR (r->'proba'->>'versiune')::int <> 2 OR (r->'proba'->>'km_de_la_m')::int <> 894000 THEN RAISE EXCEPTION 'T13 FAIL: modificare %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_probe_jurnal WHERE cheie = k AND actiune = 'modificare'
                  AND (valori->'inainte'->>'km_de_la_m')::int = 895000 AND (valori->'dupa'->>'km_de_la_m')::int = 894000) THEN
    RAISE EXCEPTION 'T13 FAIL: jurnalul modificării';
  END IF;
  r := pg_temp.t_sal(p, id903, 1, 'P903', 893000, 900000, gen_random_uuid());
  IF r->>'motiv' <> 'conflict' THEN RAISE EXCEPTION 'T13 FAIL: CAS %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, %s, 2, 'P903', 894000, 900500, gen_random_uuid())$q$, p, id903), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(%s, %s, 2, 'P901', 894000, 900000, gen_random_uuid())$q$, p, id903), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_sal(-1, %s, 2, 'P903', 894000, 900000, gen_random_uuid())$q$, id903), '42501') THEN
    RAISE EXCEPTION 'T13 FAIL: reguli la modificare';
  END IF;
  -- modificarea pe sine însuși (același interval, alt nume) nu e suprapunere
  r := public.fn_executie_proba_salveaza(p, id903, 2, 'P903', 894000, 900000, 'P903 — capăt Prunișor', NULL, gen_random_uuid());
  IF r->>'ok' <> 'true' OR r->'proba'->>'denumire' <> 'P903 — capăt Prunișor' THEN RAISE EXCEPTION 'T13 FAIL: denumire %', r; END IF;
  RAISE NOTICE 'T13 OK';
END $t$;

-- T14: proveniența și identitatea (postgres fără JWT), plasa CHECK pentru o scriere de mentenanță
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE id901 bigint := pg_temp.t_g('id901')::bigint;
BEGIN
  UPDATE public.executie_probe_tronsoane SET denumire = 'mentenanță', creat_de = pg_temp.t_g('owner')::uuid, creat_la = '2020-01-01',
         modificat_de = pg_temp.t_g('owner')::uuid, modificat_la = '2020-01-01' WHERE id = id901;
  IF (SELECT creat_de IS DISTINCT FROM pg_temp.t_g('ed')::uuid OR creat_la < '2021-01-01' OR modificat_de IS NOT NULL OR modificat_la < now() - interval '1 minute'
        FROM public.executie_probe_tronsoane WHERE id = id901) THEN
    RAISE EXCEPTION 'T14 FAIL: proveniența scrisă de client';
  END IF;
  IF NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_tronsoane SET proiect_id = -1 WHERE id = %s$q$, id901), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET etapa = 'uscare' WHERE id = %s$q$, pg_temp.t_g('e901p')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET proba_id = %s WHERE id = %s$q$, pg_temp.t_g('id902'), pg_temp.t_g('e901p')), '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_probe_jurnal SET valori = '{}'$q$, '23514') THEN
    RAISE EXCEPTION 'T14 FAIL: identitate / jurnal modificabil';
  END IF;
  -- CHECK-urile prind o scriere directă greșită (mentenanță): câmp de altă etapă, „făcut” fără valori, citire fără oră, anulare fără motiv
  IF NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET placa = 'ok' WHERE id = %s$q$, pg_temp.t_g('e901p')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET stare = 'facut', data_stare = current_date, data_start = current_date, data_final = current_date WHERE id = %s$q$, pg_temp.t_g('e903s')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET stare = 'in_curs', data_stare = current_date, data_start = current_date, presiune_proba_bar = 10, presiune_curenta_bar = 9 WHERE id = %s$q$, pg_temp.t_g('e903s')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET stare = 'refacere', data_stare = current_date, data_start = current_date WHERE id = %s$q$, pg_temp.t_g('e903s')), '23514')
     -- calibrare „făcută” fără placă (NULL): CHECK-ul nu trebuie să treacă pe NULL
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_etape SET stare = 'facut', data_stare = current_date, data_start = current_date, data_final = current_date WHERE id = %s$q$, pg_temp.t_g('e903c')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_probe_tronsoane SET stare = 'anulat' WHERE id = %s$q$, id901), '23514') THEN
    RAISE EXCEPTION 'T14 FAIL: CHECK-urile etapelor';
  END IF;
  RAISE NOTICE 'T14 OK';
END $t$;

-- T15: plasa de siguranță din BD: EXCLUDE (suprapunere) și UNIQUE parțial (cod activ), și pentru o scriere directă de mentenanță
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_probe_tronsoane (proiect_id, cod, km_de_la_m, km_pana_la_m) VALUES (%s, 'P990', 901000, 903000)$q$, p), '23P01')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_probe_tronsoane (proiect_id, cod, km_de_la_m, km_pana_la_m) VALUES (%s, 'P901', 960000, 961000)$q$, p), '23505')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_probe_tronsoane (proiect_id, cod, km_de_la_m, km_pana_la_m) VALUES (%s, 'P990', 961000, 960000)$q$, p), '23514') THEN
    RAISE EXCEPTION 'T15 FAIL: EXCLUDE / UNIQUE / CHECK';
  END IF;
  -- un rând anulat nu ocupă intervalul
  INSERT INTO public.executie_probe_tronsoane (proiect_id, cod, km_de_la_m, km_pana_la_m, stare, motiv_anulare) VALUES (p, 'P990', 901000, 903000, 'anulat', 'test');
  DELETE FROM public.executie_probe_tronsoane WHERE proiect_id = p AND cod = 'P990';
  RAISE NOTICE 'T15 OK';
END $t$;

-- T16: revenirea — nearmată = refuz; armată cu date = refuz (tranzacția abandonată până la savepoint, nimic nu se execută după eroare)
SAVEPOINT t16a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_executie_probe_tronsoane_ROLLBACK.sql
\set t16a_eroare :ERROR
\set t16a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t16a;
SELECT pg_temp.t_eroare('T16a', :'t16a_eroare', :'t16a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t16b;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_PROBE_TRONSOANE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_executie_probe_tronsoane_ROLLBACK.sql
\set t16b_eroare :ERROR
\set t16b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t16b;
SELECT pg_temp.t_eroare('T16b', :'t16b_eroare', :'t16b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'tabelele au randuri');
DO $t$ BEGIN
  IF to_regclass('public.executie_probe_tronsoane') IS NULL OR (SELECT count(*) FROM public.executie_probe_tronsoane WHERE cod LIKE 'P90_') < 4
     OR to_regprocedure('public.fn_executie_proba_tranzitie(text, text)') IS NULL THEN
    RAISE EXCEPTION 'T16 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T16 OK (refuzurile „garda invalida” și „tabelele au randuri” au fost verificate explicit)';
END $t$;

-- T17: revenirea armată pe tabele goale scoate tot (și FK-ul spre probe_calcule); re-aplicarea merge
DELETE FROM public.executie_probe_jurnal;
DELETE FROM public.executie_probe_etape;
DELETE FROM public.executie_probe_tronsoane;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_PROBE_TRONSOANE:' || txid_current(), true);
\ir ../supabase/revenire/20261202a_executie_probe_tronsoane_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_probe_tronsoane') IS NOT NULL OR to_regclass('public.executie_probe_etape') IS NOT NULL
     OR to_regclass('public.executie_probe_jurnal') IS NOT NULL OR to_regprocedure('public.fn_executie_proba_tranzitie(text, text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid = 'public.probe_calcule'::regclass AND conname LIKE 'executie\_probe\_%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_calcule'::regclass AND conname = 'probe_calcule_id_proiect_uq')
     OR current_setting('gazpet.revenire_20261202a', true) <> '' THEN
    RAISE EXCEPTION 'T17 FAIL: revenirea';
  END IF;
  -- 20261201a rămâne neatinsă
  IF to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL THEN RAISE EXCEPTION 'T17 FAIL: revenirea a atins 20261201a'; END IF;
END $t$;
SELECT set_config('gazpet.livrare_migrare', '20261202a_executie_probe_tronsoane:' || txid_current(), true);
\ir ../supabase/migrations/20261202a_executie_probe_tronsoane.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_probe_tronsoane') IS NULL OR to_regclass('public.executie_probe_jurnal') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_calcule'::regclass AND conname = 'probe_calcule_id_proiect_uq') THEN
    RAISE EXCEPTION 'T17 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T17 OK';
END $t$;

-- Sumar. Garda de dependențe (o funcție de drept modificată = preflight refuzat) se testează SEPARAT, cu oprire la prima eroare:
-- scripts/test_executie_probe_garda.sh (aici, cu ON_ERROR_STOP 0, erorile instrucțiunilor de după preflight ar acoperi refuzul).
DO $t$ BEGIN
  IF pg_temp.t_g('neexecutate') IS NOT NULL THEN
    RAISE NOTICE 'SUMAR — testele EXECUTATE au trecut, dar unele NU s-au putut executa: %. Urmează ROLLBACK.', pg_temp.t_g('neexecutate');
  ELSE
    RAISE NOTICE 'SUMAR — toate testele au trecut (T0–T17); urmează ROLLBACK (nimic nu rămâne pe clonă)';
  END IF;
END $t$;

ROLLBACK;
