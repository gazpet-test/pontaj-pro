-- Harness 20261201a_executie_noduri_suduri — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_noduri_suduri.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> teste ca non-owner (SET LOCAL ROLE + request.jwt.claims)
-- -> revenire refuzată (nearmată / cu date) -> revenire armată pe tabel gol -> re-aplicare. Identități reale din catalog (owner + 3 profiluri
-- non-owner, cu drepturile 'executie' rescrise DOAR în tranzacție), date FICTIVE (nodul NOD-TEST-HARNESS, codurile CP-901…CP-905).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261201a_executie_noduri_suduri:' || txid_current(), true);
\ir ../supabase/migrations/20261201a_executie_noduri_suduri.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 160); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 't_refuza: așteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM, 160); END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tnod.' || p, true), ''); $h$;
-- apelul RPC-ului cu parametrii pe nume; întoarce jsonb
CREATE FUNCTION pg_temp.t_m(p_cod text, p_veche text, p_ver integer, p_noua text, p_data date, p_sudor text, p_buletin text, p_motiv text, p_cheie uuid)
RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_nod_sudura_stare((SELECT id FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = p_cod),
    p_veche, p_ver, p_noua, p_data, p_sudor, p_buletin, p_motiv, p_cheie);
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_g(text),
  pg_temp.t_m(text, text, integer, text, date, text, text, text, uuid) TO authenticated, anon, service_role;

-- T0: identități, drepturi rescrise în tranzacție, sudurile fictive
DO $t$
DECLARE own uuid; ed uuid; vw uuid; fara uuid; p bigint; ids uuid[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) x;
  SELECT id INTO p FROM public.executie_proiecte ORDER BY id LIMIT 1;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR p IS NULL THEN RAISE EXCEPTION 'T0 FAIL: identități / proiect'; END IF;
  ed := ids[1]; vw := ids[2]; fara := ids[3];
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ed, 'executie', 'editor'), (vw, 'executie', 'viewer');
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod, subansamblu, dn, diametru, poz1, poz2, certitudine, vedere, x_pct, y_pct)
  VALUES (p, 'NOD-TEST-HARNESS', 'CP-901', 'Z test', 300, '323,9×8', '1 test', '2 test', 'sigur', 'PLAN', 10, 20),
         (p, 'NOD-TEST-HARNESS', 'CP-902', 'Z test', 300, NULL, NULL, NULL, 'de_confirmat', NULL, NULL, NULL),
         (p, 'NOD-TEST-HARNESS', 'CP-903', 'Z test', 100, NULL, NULL, NULL, 'posibil', NULL, NULL, NULL),
         (p, 'NOD-TEST-HARNESS', 'CP-904', 'Z test', 100, NULL, NULL, NULL, 'sigur', NULL, NULL, NULL),
         (p, 'NOD-TEST-HARNESS', 'CP-905', 'Z test', NULL, NULL, NULL, NULL, 'sigur', NULL, NULL, NULL);
  -- o poziție parțială (vedere fără x/y) e refuzată de CHECK
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod, vedere) VALUES (%s, 'NOD-TEST-HARNESS', 'CP-906', 'PLAN')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod, vedere, x_pct, y_pct) VALUES (%s, 'NOD-TEST-HARNESS', 'CP-906', 'PLAN', 100.5, 1)$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (%s, 'NOD-TEST-HARNESS', 'CP-901')$q$, p), '23505')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod, stare) VALUES (%s, 'NOD-TEST-HARNESS', 'CP-907', 'ciudat')$q$, p), '23514') THEN
    RAISE EXCEPTION 'T0 FAIL: CHECK / UNIQUE';
  END IF;
  -- pozițiile secundare: doar listă de {vedere, x_pct, y_pct, certitudine?}, vederi distincte și diferite de principala, coordonate 0–100
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
       '{"vedere":"A","x_pct":1,"y_pct":1}', '[{"vedere":"PLAN","x_pct":1,"y_pct":1}]', '[{"vedere":"A","x_pct":101,"y_pct":1}]',
       '[{"vedere":"A","x_pct":"1","y_pct":1}]', '[{"vedere":"A","x_pct":1,"y_pct":1,"altceva":1}]', '[{"vedere":"a","x_pct":1,"y_pct":1}]',
       '[{"vedere":"A","x_pct":1,"y_pct":1},{"vedere":"A","x_pct":2,"y_pct":2}]', '[{"vedere":"A","x_pct":1}]', '[1]',
       '[{"vedere":"A","x_pct":1,"y_pct":1,"certitudine":""}]']::jsonb[]) j
              WHERE public.fn_executie_nod_pozitii_valide(j, 'PLAN'))
     OR public.fn_executie_nod_pozitii_valide('[{"vedere":"A","x_pct":1,"y_pct":1}]', NULL)
     OR NOT public.fn_executie_nod_pozitii_valide('[]', NULL)
     OR NOT public.fn_executie_nod_pozitii_valide('[{"vedere":"A","x_pct":0,"y_pct":100,"certitudine":"aproximativ"},{"vedere":"D","x_pct":5.5,"y_pct":7}]', 'PLAN')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_noduri_suduri SET pozitii_secundare = '[{"vedere":"PLAN","x_pct":1,"y_pct":1}]' WHERE proiect_id = %s AND nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-901'$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.executie_noduri_suduri SET pozitii_secundare = '[{"vedere":"A","x_pct":1,"y_pct":1}]' WHERE proiect_id = %s AND nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-902'$q$, p), '23514') THEN
    RAISE EXCEPTION 'T0 FAIL: pozitii_secundare';
  END IF;
  UPDATE public.executie_noduri_suduri SET pozitii_secundare = '[{"vedere":"A","x_pct":12.5,"y_pct":40}]' WHERE proiect_id = p AND nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-901';
  PERFORM set_config('tnod.owner', own::text, true); PERFORM set_config('tnod.ed', ed::text, true);
  PERFORM set_config('tnod.vw', vw::text, true); PERFORM set_config('tnod.fara', fara::text, true); PERFORM set_config('tnod.p', p::text, true);
  PERFORM set_config('tnod.azi', ((now() AT TIME ZONE 'Europe/Bucharest')::date)::text, true);
  -- id-ul literal: cine nu vede rândul (RLS) trebuie să primească tot refuzul de drept, nu „parametri lipsă”
  PERFORM set_config('tnod.id904', (SELECT id FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-904')::text, true);
  RAISE NOTICE 'T0 OK';
END $t$;

-- T1: citirea prin RLS: editor și viewer văd nodul, cel fără drept nu vede nimic, anon nu are drept de citire
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5 THEN RAISE EXCEPTION 'T1 FAIL: editor'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5 THEN RAISE EXCEPTION 'T1 FAIL: viewer'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_noduri_suduri) THEN RAISE EXCEPTION 'T1 FAIL: fără drept vede rânduri'; END IF;
  IF public.fn_executie_nod_drept(pg_temp.t_g('p')::bigint, false) THEN RAISE EXCEPTION 'T1 FAIL: dreptul fără intrare'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_noduri_suduri', '42501') THEN RAISE EXCEPTION 'T1 FAIL: anon'; END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: scrierea directă e refuzată pentru editor și pentru service_role (doar RPC-ul scrie)
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (%s, 'NOD-TEST-HARNESS', 'CP-990')$q$, pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_suduri SET stare = 'acceptat' WHERE nod_cod = 'NOD-TEST-HARNESS'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS'$q$, '42501') THEN
    RAISE EXCEPTION 'T2 FAIL: editor scrie direct';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_suduri SET stare = 'acceptat' WHERE nod_cod = 'NOD-TEST-HARNESS'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_nod_sudura_stare(1, 'de_executat', 1, 'sudat', current_date, 'x', NULL, NULL, gen_random_uuid())$q$, '42501') THEN
    RAISE EXCEPTION 'T2 FAIL: service_role scrie';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: lanțul complet pe CP-901 ca editor (identitatea din JWT, regulile pe fiecare pas)
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; ed uuid := pg_temp.t_g('ed')::uuid;
BEGIN
  r := pg_temp.t_m('CP-901', 'de_executat', 1, 'insailat', z, NULL, NULL, NULL, gen_random_uuid());
  IF r->>'ok' <> 'true' OR r->'sudura'->>'stare' <> 'insailat' OR (r->'sudura'->>'versiune')::int <> 2
     OR (r->'sudura'->>'modificat_de')::uuid IS DISTINCT FROM ed OR (r->'sudura'->>'data_stare')::date <> z THEN RAISE EXCEPTION 'T3 FAIL: însăilat %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-901', 'insailat', 2, 'sudat', %L, '  ', NULL, NULL, gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: sudat fără sudor'; END IF;
  r := pg_temp.t_m('CP-901', 'insailat', 2, 'sudat', z, ' P-01 ', NULL, NULL, gen_random_uuid());
  IF r->'sudura'->>'stare' <> 'sudat' OR (r->'sudura'->>'data_sudare')::date <> z OR r->'sudura'->>'sudor' <> 'P-01' THEN RAISE EXCEPTION 'T3 FAIL: sudat %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-901', 'sudat', 3, 'acceptat', %L, NULL, 'RT-1', NULL, gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: sudat->acceptat'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-901', 'sudat', 3, 'ndt', %L, NULL, ' ', NULL, gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: ndt fără buletin'; END IF;
  r := pg_temp.t_m('CP-901', 'sudat', 3, 'ndt', z, NULL, 'RT-1', NULL, gen_random_uuid());
  IF r->'sudura'->>'stare' <> 'ndt' OR r->'sudura'->>'buletin_ndt' <> 'RT-1' THEN RAISE EXCEPTION 'T3 FAIL: ndt %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-901', 'ndt', 4, 'reparat', %L, NULL, NULL, '', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: reparat fără motiv'; END IF;
  r := pg_temp.t_m('CP-901', 'ndt', 4, 'reparat', z, NULL, NULL, 'por', gen_random_uuid());
  r := pg_temp.t_m('CP-901', 'reparat', 5, 'sudat', z, 'P-02', NULL, NULL, gen_random_uuid());
  IF r->'sudura'->>'stare' <> 'sudat' OR r->'sudura'->>'sudor' <> 'P-02' OR (r->'sudura'->>'data_sudare')::date <> z OR r->'sudura'->>'motiv' <> 'por'
     OR (r->'sudura'->>'versiune')::int <> 6 THEN RAISE EXCEPTION 'T3 FAIL: reparația %', r; END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- T4: CAS — versiunea / starea veche nu mai corespund: conflict, rândul neschimbat
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  r := pg_temp.t_m('CP-901', 'sudat', 5, 'ndt', z, NULL, 'RT-2', NULL, gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' OR (r->'sudura'->>'versiune')::int <> 6 THEN RAISE EXCEPTION 'T4 FAIL: versiune veche %', r; END IF;
  r := pg_temp.t_m('CP-901', 'de_executat', 6, 'insailat', z, NULL, NULL, NULL, gen_random_uuid());
  IF r->>'motiv' <> 'conflict' THEN RAISE EXCEPTION 'T4 FAIL: stare veche %', r; END IF;
  IF (SELECT versiune FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-901') <> 6 THEN RAISE EXCEPTION 'T4 FAIL: s-a scris'; END IF;
  RAISE NOTICE 'T4 OK';
END $t$;

-- T5: idempotența — aceeași cheie + același conținut = duplicat fără scriere; altă schimbare / altă sudură cu aceeași cheie = eroare
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; k uuid := gen_random_uuid();
BEGIN
  r := pg_temp.t_m('CP-902', 'de_executat', 1, 'sudat', z, 'P-03', NULL, NULL, k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'false' THEN RAISE EXCEPTION 'T5 FAIL: prima %', r; END IF;
  r := pg_temp.t_m('CP-902', 'de_executat', 1, 'sudat', z, 'P-03', NULL, NULL, k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'true' OR (r->'sudura'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T5 FAIL: reluarea %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-902', 'de_executat', 1, 'sudat', %L, 'P-99', NULL, NULL, %L)$q$, z, k), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-903', 'de_executat', 1, 'sudat', %L, 'P-03', NULL, NULL, %L)$q$, z, k), '22023') THEN
    RAISE EXCEPTION 'T5 FAIL: cheie refolosită';
  END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- T6: data (Europe/Bucharest): nu în viitor, cel mult 7 zile în urmă, nu înaintea ultimei schimbări
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-903', 'de_executat', 1, 'sudat', %L, 'P-04', NULL, NULL, gen_random_uuid())$q$, z + 1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-903', 'de_executat', 1, 'sudat', %L, 'P-04', NULL, NULL, gen_random_uuid())$q$, z - 8), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: fereastra';
  END IF;
  r := pg_temp.t_m('CP-903', 'de_executat', 1, 'sudat', z - 2, 'P-04', NULL, NULL, gen_random_uuid());
  IF (r->'sudura'->>'data_sudare')::date <> z - 2 THEN RAISE EXCEPTION 'T6 FAIL: data trecută %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-903', 'sudat', 2, 'ndt', %L, NULL, 'RT-3', NULL, gen_random_uuid())$q$, z - 3), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: înaintea ultimei schimbări';
  END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- T7: dreptul de scriere — viewer, fără drept, JWT fără sub, anon: refuz (mesaj generic, 42501)
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_m('CP-904', 'de_executat', 1, 'sudat', %L, 'P-05', NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: viewer'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_nod_sudura_stare(%s, 'de_executat', 1, 'sudat', %L, 'P', NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('id904'), pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: fără drept'; END IF;
  -- un id care nu există primește același mesaj generic (nu se poate deosebi „nu există” de „nu ai drept”)
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_nod_sudura_stare(-1, 'de_executat', 1, 'sudat', %L, 'P', NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: id inexistent'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_nod_sudura_stare(%s, 'de_executat', 1, 'sudat', %L, 'P', NULL, NULL, gen_random_uuid())$q$, pg_temp.t_g('id904'), pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: fără sub'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$SELECT public.fn_executie_nod_sudura_stare(1, 'de_executat', 1, 'sudat', current_date, 'P', NULL, NULL, gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_nod_drept(1, false)$q$, '42501') THEN RAISE EXCEPTION 'T7 FAIL: anon'; END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- T8: owner scrie; modificat_de = owner; owner vede dreptul de scriere
SELECT pg_temp.t_ca(pg_temp.t_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := pg_temp.t_m('CP-904', 'de_executat', 1, 'anulat', pg_temp.t_g('azi')::date, NULL, NULL, 'nu există pe izometrie', gen_random_uuid());
  IF r->'sudura'->>'stare' <> 'anulat' OR (r->'sudura'->>'modificat_de')::uuid IS DISTINCT FROM pg_temp.t_g('owner')::uuid
     OR NOT public.fn_executie_nod_drept(pg_temp.t_g('p')::bigint, true) THEN RAISE EXCEPTION 'T8 FAIL %', r; END IF;
  RAISE NOTICE 'T8 OK';
END $t$;

-- T9: tranzițiile — toate cele 49 de perechi față de lista decisă (scrisă aici independent de funcție)
DO $t$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM unnest(ARRAY['de_executat','insailat','sudat','ndt','acceptat','reparat','anulat']) v,
                              unnest(ARRAY['de_executat','insailat','sudat','ndt','acceptat','reparat','anulat']) w
   WHERE public.fn_executie_nod_tranzitie(v, w) IS DISTINCT FROM (v || '>' || w = ANY (ARRAY['de_executat>insailat','de_executat>sudat','de_executat>anulat',
     'insailat>sudat','insailat>anulat','sudat>ndt','sudat>reparat','ndt>acceptat','ndt>reparat','reparat>sudat']));
  IF n <> 0 OR public.fn_executie_nod_tranzitie('acceptat', NULL) OR public.fn_executie_nod_tranzitie(NULL, 'sudat') THEN RAISE EXCEPTION 'T9 FAIL: % perechi diferite', n; END IF;
  RAISE NOTICE 'T9 OK';
END $t$;

-- T10: proveniența (postgres fără JWT): modificat_de = NULL, identitatea rândului imuabilă
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.executie_noduri_suduri SET subansamblu = 'Z test 2', modificat_de = pg_temp.t_g('ed')::uuid, modificat_la = '2020-01-01' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-905';
  IF (SELECT modificat_de IS NOT NULL OR modificat_la < now() - interval '1 minute' FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-905') THEN
    RAISE EXCEPTION 'T10 FAIL: proveniența scrisă de client';
  END IF;
  IF NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_suduri SET cod = 'CP-999' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-905'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_suduri SET nod_cod = 'NOD-ALT' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'CP-905'$q$, '23514') THEN
    RAISE EXCEPTION 'T10 FAIL: identitate schimbată';
  END IF;
  RAISE NOTICE 'T10 OK';
END $t$;

-- T11: Storage — bucket privat; citirea doar pe dreptul Execuție și doar pentru un nod existent pe proiectul din cale
INSERT INTO storage.objects (bucket_id, name, metadata)
SELECT 'noduri-scheme', x, '{"mimetype":"image/png"}'::jsonb
  FROM unnest(ARRAY[pg_temp.t_g('p') || '/NOD-TEST-HARNESS/vederi.json', pg_temp.t_g('p') || '/NOD-TEST-HARNESS/PLAN.png', pg_temp.t_g('p') || '/NOD-ALT/PLAN.png']) x;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'noduri-scheme') <> 2 THEN RAISE EXCEPTION 'T11 FAIL: viewer vede % obiecte', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'noduri-scheme'); END IF;
  IF public.fn_executie_nod_obiect_citire('noduri-scheme', '../x.png') OR public.fn_executie_nod_obiect_citire('alt-bucket', pg_temp.t_g('p') || '/NOD-TEST-HARNESS/PLAN.png')
     OR public.fn_executie_nod_obiect_citire('noduri-scheme', pg_temp.t_g('p') || '/NOD-TEST-HARNESS/a..png')
     OR public.fn_executie_nod_obiect_citire('noduri-scheme', '1x/NOD-TEST-HARNESS/a.png')
     OR public.fn_executie_nod_obiect_citire('noduri-scheme', '99999999999999999999/NOD-TEST-HARNESS/a.png')
     OR NOT public.fn_executie_nod_obiect_citire('noduri-scheme', pg_temp.t_g('p') || '/NOD-TEST-HARNESS/oricare.webp') THEN
    RAISE EXCEPTION 'T11 FAIL: forma căii';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'noduri-scheme') THEN RAISE EXCEPTION 'T11 FAIL: fără drept vede fișiere'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('noduri-scheme', '1/NOD-TEST-HARNESS/x.png')$q$, '42501') THEN RAISE EXCEPTION 'T11 FAIL: editor urcă'; END IF;
  RAISE NOTICE 'T11 OK';
END $t$;

-- T14: SQL-ul generat de scripts/noduri_cuplare_import_sql.mjs, pe fixture-ul SINTETIC (proiectul 1, nodul fictiv NOD-TEST-IMPORT):
-- import, reluare idempotentă, listă nouă (upsert + anulare), revenire la lista veche (reactivare), sudură sudată lipsă = importul se oprește.
-- Rulează doar dacă proiectul 1 există pe clonă (altfel e sărit, cu mesaj).
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = 1) AS are_proiect_1 \gset
\if :are_proiect_1
\ir fixtures/nod_cuplare/import_exemplu_1.sql
CREATE TEMP TABLE t14_v1 ON COMMIT DROP AS SELECT cod, versiune FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT';
DO $t$ BEGIN
  IF (SELECT count(*) FROM t14_v1) <> 5
     OR (SELECT vedere || ' ' || x_pct || ' ' || y_pct || ' ' || pozitii_secundare::text FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-003')
        IS DISTINCT FROM 'A 55.000 60.000 [{"x_pct": 70, "y_pct": 20, "vedere": "PLAN", "certitudine": "sigur"}]'
     OR (SELECT vedere FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-005') IS NOT NULL
     OR (SELECT certitudine FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-005') <> 'de_confirmat' THEN
    RAISE EXCEPTION 'T14 FAIL: primul import';
  END IF;
END $t$;
\ir fixtures/nod_cuplare/import_exemplu_1.sql
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM t14_v1 v JOIN public.executie_noduri_suduri s ON s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = v.cod WHERE s.versiune <> v.versiune) THEN
    RAISE EXCEPTION 'T14 FAIL: reluarea a schimbat ceva (nu e idempotentă)';
  END IF;
END $t$;
\ir fixtures/nod_cuplare/import_exemplu_2.sql
DO $t$ BEGIN
  IF (SELECT string_agg(cod || ':' || stare, ',' ORDER BY cod) FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT')
       IS DISTINCT FROM 'CP-001:de_executat,CP-002:de_executat,CP-003:de_executat,CP-004:anulat,CP-005:anulat,CR-001:de_executat'
     OR EXISTS (SELECT 1 FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND stare = 'anulat' AND motiv NOT LIKE 'import: %')
     OR (SELECT subansamblu || '|' || certitudine || '|' || versiune FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-002')
        IS DISTINCT FROM 'Z1. Linie fictivă DN300 (revizuită)|sigur|2'
     OR (SELECT versiune FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-001') <> 1
     OR (SELECT vedere FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-004') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'T14 FAIL: lista nouă (upsert / anulare; punctele rămân)';
  END IF;
END $t$;
\ir fixtures/nod_cuplare/import_exemplu_1.sql
DO $t$ BEGIN
  IF (SELECT string_agg(cod || ':' || stare, ',' ORDER BY cod) FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT')
       IS DISTINCT FROM 'CP-001:de_executat,CP-002:de_executat,CP-003:de_executat,CP-004:de_executat,CP-005:de_executat,CR-001:anulat'
     OR EXISTS (SELECT 1 FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND stare = 'de_executat' AND (motiv IS NOT NULL OR data_stare IS NOT NULL)) THEN
    RAISE EXCEPTION 'T14 FAIL: reactivarea / anularea codului nou';
  END IF;
  -- CP-004 sudat (direct, ca mentenanță postgres); lista 2 nu-l mai are -> importul trebuie să se oprească fără nicio scriere
  UPDATE public.executie_noduri_suduri SET stare = 'sudat', data_stare = current_date, data_sudare = current_date, sudor = 'P-T14'
   WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'CP-004';
END $t$;
SAVEPOINT t14;
\set ON_ERROR_STOP 0
\ir fixtures/nod_cuplare/import_exemplu_2.sql
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t14;
DO $t$ BEGIN
  IF (SELECT string_agg(cod || ':' || stare, ',' ORDER BY cod) FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT')
       IS DISTINCT FROM 'CP-001:de_executat,CP-002:de_executat,CP-003:de_executat,CP-004:sudat,CP-005:de_executat,CR-001:anulat' THEN
    RAISE EXCEPTION 'T14 FAIL: importul cu o sudură sudată lipsă a scris ceva';
  END IF;
  DELETE FROM public.executie_noduri_suduri WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT';
  RAISE NOTICE 'T14 OK (eroarea „lipsesc din listă suduri deja sudate: CP-004 (sudat)” de mai sus e așteptată)';
END $t$;
\else
\echo 'T14 SĂRIT: proiectul 1 nu există pe clonă (importul nu s-a putut proba)'
\endif

-- T12: revenirea — nearmată = refuz; armată cu date = refuz (tranzacția abandonată până la savepoint, nimic nu se execută după eroare)
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t12a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261201a_executie_noduri_suduri_ROLLBACK.sql
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t12a;
SAVEPOINT t12b;
SELECT set_config('gazpet.revenire_20261201a', 'SCOATE_NODURI_SUDURI:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261201a_executie_noduri_suduri_ROLLBACK.sql
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t12b;
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_suduri') IS NULL OR (SELECT count(*) FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'noduri_scheme_citire') THEN
    RAISE EXCEPTION 'T12 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T12 OK (refuzurile de mai sus sunt așteptate: „garda invalida” și „tabelul are randuri”)';
END $t$;

-- T13: revenirea armată pe tabel și bucket goale scoate tot; re-aplicarea merge
SELECT set_config('storage.allow_delete_query', 'true', true);   -- doar dacă versiunea Storage are garda protect_delete
DELETE FROM storage.objects WHERE bucket_id = 'noduri-scheme';
DELETE FROM public.executie_noduri_suduri;
SELECT set_config('gazpet.revenire_20261201a', 'SCOATE_NODURI_SUDURI:' || txid_current(), true);
\ir ../supabase/revenire/20261201a_executie_noduri_suduri_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_suduri') IS NOT NULL OR to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme') OR current_setting('gazpet.revenire_20261201a', true) <> '' THEN
    RAISE EXCEPTION 'T13 FAIL: revenirea';
  END IF;
END $t$;
\ir ../supabase/migrations/20261201a_executie_noduri_suduri.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_suduri') IS NULL OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme' AND public IS FALSE) THEN
    RAISE EXCEPTION 'T13 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T13 OK — toate testele au trecut; urmează ROLLBACK (nimic nu rămâne pe clonă)';
END $t$;

ROLLBACK;
