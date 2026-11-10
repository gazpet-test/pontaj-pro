-- Harness 20261207a_executie_noduri_constructii — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Cere 20261201a aplicat (ca pe producție: dreptul fn_executie_nod_drept).
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_noduri_constructii.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> teste ca non-owner (SET LOCAL ROLE + request.jwt.claims)
-- -> import sintetic -> revenirea 20261201a refuzată cât timp tabelul există -> revenire refuzată (nearmată / cu date) -> revenire armată pe
-- tabel gol -> re-aplicare. Identități reale din catalog (owner + 3 profiluri non-owner, cu drepturile 'executie' rescrise DOAR în tranzacție),
-- date FICTIVE (nodul NOD-TEST-HARNESS, codurile F6-901 / F6-902 / SPC-901 / FSI-901 / IPB-901; importul: NOD-TEST-IMPORT).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261207a_executie_noduri_constructii:' || txid_current(), true);
\ir ../supabase/migrations/20261207a_executie_noduri_constructii.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  -- ambele surse JWT: auth.uid() citește întâi request.jwt.claim.sub
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
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
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tconstr.' || p, true), ''); $h$;
-- apelul RPC-ului pe codul elementului (nodul de test); întoarce jsonb
CREATE FUNCTION pg_temp.t_e(p_cod text, p_ver integer, p_actiune text, p_etapa text, p_data date, p_motiv text, p_cheie uuid)
RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_constr_etapa((SELECT id FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = p_cod),
    p_ver, p_actiune, p_etapa, p_data, p_motiv, p_cheie);
$h$;
-- versiunea curentă (citită ca postgres, pentru pașii care nu testează CAS-ul)
CREATE FUNCTION pg_temp.t_v(p_cod text) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $h$
  SELECT versiune FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = p_cod;
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
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_g(text), pg_temp.t_v(text),
  pg_temp.t_e(text, integer, text, text, date, text, uuid) TO authenticated, anon, service_role;

-- T0: identități, drepturi rescrise în tranzacție, elementele fictive, CHECK-urile
DO $t$
DECLARE own uuid; ed uuid; vw uuid; fara uuid; p bigint; ids uuid[];
  f8 text[] := ARRAY['sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) x;
  SELECT id INTO p FROM public.executie_proiecte ORDER BY id LIMIT 1;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR p IS NULL THEN RAISE EXCEPTION 'T0 FAIL: identități / proiect'; END IF;
  ed := ids[1]; vw := ids[2]; fara := ids[3];
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ed, 'executie', 'editor'), (vw, 'executie', 'viewer');
  INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, echipament, cantitate, um, etape)
  VALUES (p, 'NOD-TEST-HARNESS', 'F6-901', 'TEST-C-REZ-01', 'TEST-C-00', 'F6 test 1', 'fundatie', 'rezervoare', 'Rezervor test', 1, 'buc', f8),
         (p, 'NOD-TEST-HARNESS', 'F6-902', 'TEST-C-REZ-01', 'TEST-C-00', 'F6 test 2', 'fundatie', 'rezervoare', NULL, 1, 'buc', f8),
         (p, 'NOD-TEST-HARNESS', 'SPC-901', 'TEST-C-SPC', 'TEST-C-00', 'SPC test', 'fundatie', 'spc', NULL, 1, 'buc', ARRAY['sapatura', 'turnare', 'montaj']),
         (p, 'NOD-TEST-HARNESS', 'FSI-901', 'TEST-C-FSI', 'TEST-C-00', 'FSI test', 'fundatie', 'iluminat', NULL, 1, 'buc', ARRAY['sapatura', 'turnare']),
         (p, 'NOD-TEST-HARNESS', 'IPB-901', 'TEST-C-IPB', 'TEST-C-00', 'IPB test', 'imprejmuire', 'imprejmuire', NULL, 110.5, 'm', ARRAY['trasare', 'montaj']);
  -- CHECK / UNIQUE: cod, tip, grup, UM, cantitate, etape (goală, repetată, necunoscută, 2-D, indice ≠ 1, NULL), bifări inconsistente, anulat fără motiv,
  -- coloana generată nu se scrie, UNIQUE pe (proiect, nod, cod)
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'f6-1', 'X', 'X', 'x', 'fundatie', 'g', '{sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'altceva', 'g', '{sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'Grup', '{sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, um, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', 'kg', '{sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, cantitate, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', 0, '{sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', ' ', 'fundatie', 'g', '{sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', '{}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', '{sapatura,sapatura}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', '{sapatura,betonare}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', '{{sapatura},{turnare}}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', '[0:1]={sapatura,turnare}')$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', ARRAY['sapatura', NULL])$q$, p), '23514')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'F6-901', 'X', 'X', 'x', 'fundatie', 'g', '{sapatura}')$q$, p), '23505')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape, etapa_curenta) VALUES (%s, 'NOD-TEST-HARNESS', 'X-1', 'X', 'X', 'x', 'fundatie', 'g', '{sapatura}', 'gata')$q$, p), '428C9') THEN
    RAISE EXCEPTION 'T0 FAIL: CHECK / UNIQUE / coloana generată';
  END IF;
  -- bifările: liste de lungimi diferite, mai multe decât etapele, dată NULL, date descrescătoare = refuz; etape_de NULL (stadiu din import) = acceptat
  IF NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etape_data = '{2026-01-01}' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etape_data = '{2026-01-01,2026-01-02,2026-01-03}', etape_de = ARRAY[NULL,NULL,NULL]::uuid[], etape_la = ARRAY[now(),now(),now()] WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etape_data = ARRAY[NULL::date], etape_de = ARRAY[NULL]::uuid[], etape_la = ARRAY[now()] WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etape_data = '{2026-01-02,2026-01-01}', etape_de = ARRAY[NULL,NULL]::uuid[], etape_la = ARRAY[now(),now()] WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etape_data = '{2026-01-01}', etape_de = ARRAY[NULL]::uuid[], etape_la = ARRAY[NULL]::timestamptz[] WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET stare = 'anulat' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901'$q$, '23514') THEN
    RAISE EXCEPTION 'T0 FAIL: bifări / anulare';
  END IF;
  UPDATE public.executie_noduri_constructii SET etape_data = '{2026-01-01}', etape_de = ARRAY[NULL]::uuid[], etape_la = ARRAY[now()] WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901';
  IF (SELECT etapa_curenta FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901') <> 'turnare'
     OR (SELECT etapa_curenta FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'F6-901') <> 'sapatura' THEN
    RAISE EXCEPTION 'T0 FAIL: etapa_curenta generată';
  END IF;
  UPDATE public.executie_noduri_constructii SET etape_data = '{}', etape_de = '{}', etape_la = '{}' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'FSI-901';
  PERFORM set_config('tconstr.owner', own::text, true); PERFORM set_config('tconstr.ed', ed::text, true);
  PERFORM set_config('tconstr.vw', vw::text, true); PERFORM set_config('tconstr.fara', fara::text, true); PERFORM set_config('tconstr.p', p::text, true);
  PERFORM set_config('tconstr.azi', ((now() AT TIME ZONE 'Europe/Bucharest')::date)::text, true);
  -- id-ul literal: cine nu vede rândul (RLS) trebuie să primească tot refuzul de drept, nu „parametri lipsă”
  PERFORM set_config('tconstr.idspc', (SELECT id FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'SPC-901')::text, true);
  RAISE NOTICE 'T0 OK';
END $t$;

-- T1: citirea prin RLS: editor și viewer văd nodul, cel fără drept nu vede nimic, anon nu are drept de citire
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5 THEN RAISE EXCEPTION 'T1 FAIL: editor'; END IF;
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM pg_temp.t_g('ed')::uuid THEN RAISE EXCEPTION 'T1 FAIL: identitatea de test'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5 THEN RAISE EXCEPTION 'T1 FAIL: viewer'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_noduri_constructii) THEN RAISE EXCEPTION 'T1 FAIL: fără drept vede rânduri'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_noduri_constructii', '42501') THEN RAISE EXCEPTION 'T1 FAIL: anon'; END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: scrierea directă e refuzată pentru editor și pentru service_role (doar RPC-ul scrie); service_role nu are RPC-ul
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_noduri_constructii (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, etape) VALUES (%s, 'NOD-TEST-HARNESS', 'X-9', 'X', 'X', 'x', 'fundatie', 'g', '{sapatura}')$q$, pg_temp.t_g('p')), '42501')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etape_data = '{2026-01-01}' WHERE nod_cod = 'NOD-TEST-HARNESS'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$DELETE FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS'$q$, '42501') THEN
    RAISE EXCEPTION 'T2 FAIL: editor scrie direct';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET stare = 'anulat', motiv = 'x' WHERE nod_cod = 'NOD-TEST-HARNESS'$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_constr_etapa(1, 1, 'bifeaza', 'sapatura', current_date, NULL, gen_random_uuid())$q$, '42501') THEN
    RAISE EXCEPTION 'T2 FAIL: service_role scrie';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: lanțul pe F6-901 ca editor: doar etapa următoare, data nu înaintea etapei anterioare, retragerea doar a ultimei, cu motiv, până la „gata”
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; ed uuid := pg_temp.t_g('ed')::uuid; e text; v integer;
BEGIN
  r := pg_temp.t_e('F6-901', 1, 'bifeaza', 'sapatura', z - 2, NULL, gen_random_uuid());
  IF r->>'ok' <> 'true' OR r->'element'->>'etapa_curenta' <> 'egalizare' OR (r->'element'->>'versiune')::int <> 2
     OR (r->'element'->'etape_de'->>0)::uuid IS DISTINCT FROM ed OR (r->'element'->>'modificat_de')::uuid IS DISTINCT FROM ed
     OR (r->'element'->'etape_data'->>0)::date <> z - 2 THEN RAISE EXCEPTION 'T3 FAIL: prima bifare %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-901', 2, 'bifeaza', 'armare_cofrare', %L, NULL, gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: sărit o etapă'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-901', 2, 'bifeaza', 'egalizare', %L, NULL, gen_random_uuid())$q$, z - 3), '22023') THEN RAISE EXCEPTION 'T3 FAIL: data înaintea etapei anterioare'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-901', 2, 'bifeaza', 'egalizare', %L, 'motiv', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: motiv la bifare'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-901', 2, 'bifeaza', 'egalizare', NULL, NULL, gen_random_uuid())$q$), '22023') THEN RAISE EXCEPTION 'T3 FAIL: bifare fără dată'; END IF;
  r := pg_temp.t_e('F6-901', 2, 'bifeaza', 'egalizare', z - 1, NULL, gen_random_uuid());
  IF r->'element'->>'etapa_curenta' <> 'armare_cofrare' THEN RAISE EXCEPTION 'T3 FAIL: a doua bifare %', r; END IF;
  -- retragerea: fără motiv / cu dată / altă etapă decât ultima = refuz; corectă = ultima etapă scoasă, motivul păstrat
  IF NOT pg_temp.t_refuza($q$SELECT pg_temp.t_e('F6-901', 3, 'retrage', 'egalizare', NULL, '  ', gen_random_uuid())$q$, '22023') THEN RAISE EXCEPTION 'T3 FAIL: retragere fără motiv'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-901', 3, 'retrage', 'egalizare', %L, 'greșit', gen_random_uuid())$q$, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: retragere cu dată'; END IF;
  IF NOT pg_temp.t_refuza($q$SELECT pg_temp.t_e('F6-901', 3, 'retrage', 'sapatura', NULL, 'greșit', gen_random_uuid())$q$, '22023') THEN RAISE EXCEPTION 'T3 FAIL: retragere nu a ultimei'; END IF;
  IF NOT pg_temp.t_refuza($q$SELECT pg_temp.t_e('F6-901', 3, 'sterge', 'egalizare', NULL, 'x', gen_random_uuid())$q$, '22023') THEN RAISE EXCEPTION 'T3 FAIL: acțiune necunoscută'; END IF;
  r := pg_temp.t_e('F6-901', 3, 'retrage', 'egalizare', NULL, ' bifat din greșeală ', gen_random_uuid());
  IF r->'element'->>'etapa_curenta' <> 'egalizare' OR jsonb_array_length(r->'element'->'etape_data') <> 1 OR jsonb_array_length(r->'element'->'etape_de') <> 1
     OR jsonb_array_length(r->'element'->'etape_la') <> 1 OR position('egalizare' IN r->'element'->>'ultima_retragere') <> 1
     OR position('bifat din greșeală' IN r->'element'->>'ultima_retragere') = 0 OR (r->'element'->>'versiune')::int <> 4 THEN RAISE EXCEPTION 'T3 FAIL: retragerea %', r; END IF;
  -- până la capăt: toate etapele, în ordine, apoi nimic de bifat
  v := 4;
  FOREACH e IN ARRAY ARRAY['egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj'] LOOP
    r := pg_temp.t_e('F6-901', v, 'bifeaza', e, z, NULL, gen_random_uuid());
    v := v + 1;
  END LOOP;
  IF r->'element'->>'etapa_curenta' <> 'gata' OR jsonb_array_length(r->'element'->'etape_data') <> 8 THEN RAISE EXCEPTION 'T3 FAIL: gata %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-901', %s, 'bifeaza', 'montaj', %L, NULL, gen_random_uuid())$q$, v, z), '22023') THEN RAISE EXCEPTION 'T3 FAIL: bifare după gata'; END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- T4: CAS — versiunea veche: conflict, rândul neschimbat
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  r := pg_temp.t_e('F6-901', 3, 'retrage', 'montaj', NULL, 'x', gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' OR (r->'element'->>'versiune')::int <> 11 THEN RAISE EXCEPTION 'T4 FAIL: versiune veche %', r; END IF;
  IF (SELECT versiune FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'F6-901') <> 11 THEN RAISE EXCEPTION 'T4 FAIL: s-a scris'; END IF;
  RAISE NOTICE 'T4 OK';
END $t$;

-- T5: idempotența — aceeași cheie + același conținut = duplicat fără scriere; altă schimbare / alt element cu aceeași cheie = eroare
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; k uuid := gen_random_uuid();
BEGIN
  r := pg_temp.t_e('F6-902', 1, 'bifeaza', 'sapatura', z, NULL, k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'false' THEN RAISE EXCEPTION 'T5 FAIL: prima %', r; END IF;
  r := pg_temp.t_e('F6-902', 1, 'bifeaza', 'sapatura', z, NULL, k);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'true' OR (r->'element'->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T5 FAIL: reluarea %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('F6-902', 1, 'bifeaza', 'sapatura', %L, NULL, %L)$q$, z - 1, k), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('SPC-901', 1, 'bifeaza', 'sapatura', %L, NULL, %L)$q$, z, k), '22023') THEN
    RAISE EXCEPTION 'T5 FAIL: cheie refolosită';
  END IF;
  IF (SELECT versiune FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'F6-902') <> 2 THEN RAISE EXCEPTION 'T5 FAIL: reluarea a scris'; END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- T6: data (Europe/Bucharest): nu în viitor, cel mult 7 zile în urmă (z-7 acceptat, z-8 refuzat)
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('SPC-901', 1, 'bifeaza', 'sapatura', %L, NULL, gen_random_uuid())$q$, z + 1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('SPC-901', 1, 'bifeaza', 'sapatura', %L, NULL, gen_random_uuid())$q$, z - 8), '22023') THEN
    RAISE EXCEPTION 'T6 FAIL: fereastra';
  END IF;
  r := pg_temp.t_e('SPC-901', 1, 'bifeaza', 'sapatura', z - 7, NULL, gen_random_uuid());
  IF (r->'element'->'etape_data'->>0)::date <> z - 7 THEN RAISE EXCEPTION 'T6 FAIL: z-7 %', r; END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- T7: dreptul de scriere — viewer, fără drept, id inexistent, JWT fără sub, anon: refuz (mesaj generic, 42501)
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('FSI-901', 1, 'bifeaza', 'sapatura', %L, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: viewer'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_constr_etapa(%s, 2, 'bifeaza', 'turnare', %L, NULL, gen_random_uuid())$q$, pg_temp.t_g('idspc'), pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: fără drept'; END IF;
  -- un id care nu există primește același mesaj generic (nu se poate deosebi „nu există” de „nu ai drept”)
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_constr_etapa(-1, 1, 'bifeaza', 'sapatura', %L, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: id inexistent'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'authenticated');
DO $t$ BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'T7 FAIL: identitatea de test (fără sub)'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_executie_constr_etapa(%s, 2, 'bifeaza', 'turnare', %L, NULL, gen_random_uuid())$q$, pg_temp.t_g('idspc'), pg_temp.t_g('azi')), '42501') THEN RAISE EXCEPTION 'T7 FAIL: fără sub'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza($q$SELECT public.fn_executie_constr_etapa(1, 1, 'bifeaza', 'sapatura', current_date, NULL, gen_random_uuid())$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_constr_etape_valide('{sapatura}')$q$, '42501') THEN RAISE EXCEPTION 'T7 FAIL: anon'; END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- T8: owner scrie; etape_de / modificat_de = owner
SELECT pg_temp.t_ca(pg_temp.t_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := pg_temp.t_e('FSI-901', 1, 'bifeaza', 'sapatura', pg_temp.t_g('azi')::date, NULL, gen_random_uuid());
  IF r->'element'->>'etapa_curenta' <> 'turnare' OR (r->'element'->>'modificat_de')::uuid IS DISTINCT FROM pg_temp.t_g('owner')::uuid
     OR (r->'element'->'etape_de'->>0)::uuid IS DISTINCT FROM pg_temp.t_g('owner')::uuid THEN RAISE EXCEPTION 'T8 FAIL %', r; END IF;
  RAISE NOTICE 'T8 OK';
END $t$;

-- T9: element anulat (de import / mentenanță): nicio bifare; parametri lipsă = refuz
SELECT pg_temp.t_ca(NULL, 'postgres');
UPDATE public.executie_noduri_constructii SET stare = 'anulat', motiv = 'test anulare' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'IPB-901';
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('IPB-901', pg_temp.t_v('IPB-901'), 'bifeaza', 'trasare', %L, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '22023') THEN RAISE EXCEPTION 'T9 FAIL: anulat'; END IF;
  IF (SELECT etapa_curenta FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'IPB-901') <> 'anulat' THEN RAISE EXCEPTION 'T9 FAIL: etapa_curenta anulat'; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('FSI-901', NULL, 'bifeaza', 'turnare', %L, NULL, gen_random_uuid())$q$, pg_temp.t_g('azi')), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_e('FSI-901', 2, 'bifeaza', 'turnare', %L, NULL, NULL)$q$, pg_temp.t_g('azi')), '22023') THEN
    RAISE EXCEPTION 'T9 FAIL: parametri lipsă';
  END IF;
  RAISE NOTICE 'T9 OK';
END $t$;

-- T10: proveniența (postgres fără JWT): modificat_de = NULL, identitatea rândului imuabilă, coloana generată nu se scrie
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.executie_noduri_constructii SET denumire = 'SPC test 2', modificat_de = pg_temp.t_g('ed')::uuid, modificat_la = '2020-01-01' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'SPC-901';
  IF (SELECT modificat_de IS NOT NULL OR modificat_la < now() - interval '1 minute' FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'SPC-901') THEN
    RAISE EXCEPTION 'T10 FAIL: proveniența scrisă de client';
  END IF;
  IF NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET cod = 'SPC-999' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'SPC-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET nod_cod = 'NOD-ALT' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'SPC-901'$q$, '23514')
     OR NOT pg_temp.t_refuza($q$UPDATE public.executie_noduri_constructii SET etapa_curenta = 'gata' WHERE nod_cod = 'NOD-TEST-HARNESS' AND cod = 'SPC-901'$q$, '428C9') THEN
    RAISE EXCEPTION 'T10 FAIL: identitate / coloană generată schimbate';
  END IF;
  RAISE NOTICE 'T10 OK';
END $t$;

-- T11: vocabularul etapelor — exact cele 12 coduri decise (scrise aici independent de funcție), fiecare acceptat singur; altele refuzate
DO $t$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM unnest(ARRAY['trasare', 'sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura',
                                           'strat_suport', 'finisaj', 'confectionare', 'montaj']) e
   WHERE NOT public.fn_executie_constr_etape_valide(ARRAY[e]);
  IF n <> 0 OR public.fn_executie_constr_etape_valide(ARRAY['Sapatura']) OR public.fn_executie_constr_etape_valide(ARRAY['receptie'])
     OR public.fn_executie_constr_etape_valide(NULL)
     OR NOT public.fn_executie_constr_etape_valide(ARRAY['trasare', 'sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura',
                                                         'strat_suport', 'finisaj', 'confectionare', 'montaj']) THEN
    RAISE EXCEPTION 'T11 FAIL: vocabularul (% coduri refuzate)', n;
  END IF;
  RAISE NOTICE 'T11 OK';
END $t$;

-- T14: SQL-ul generat de scripts/noduri_constructii_import_sql.mjs, pe fixture-ul SINTETIC (proiectul 1, nodul fictiv NOD-TEST-IMPORT):
-- import (cu stadiu inițial), reluare idempotentă, listă nouă (upsert + anulare + etape schimbate cu prefixul bifat păstrat), revenire la lista veche
-- (reactivare), reluare după o bifare nouă, apoi patru opriri: element bifat lipsă, etape care nu păstrează bifarea, stadiu mai lung decât bifările,
-- același număr de etape cu altă dată. Rulează doar dacă proiectul 1
-- există pe clonă (altfel e sărit, cu mesaj).
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = 1) AS are_proiect_1 \gset
\if :are_proiect_1
\ir fixtures/nod_constructii/import_exemplu_1.sql
CREATE TEMP TABLE t14_v1 ON COMMIT DROP AS SELECT cod, versiune FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT';
DO $t$ BEGIN
  IF (SELECT count(*) FROM t14_v1) <> 4
     OR (SELECT etapa_curenta || '|' || cardinality(etape_data) || '|' || etape_data[2] || '|' || (etape_de[1] IS NULL) FROM public.executie_noduri_constructii
          WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-1') IS DISTINCT FROM 'armare_cofrare|2|2026-10-20|true'
     OR (SELECT certitudine FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-2') <> 'de_confirmat'
     OR (SELECT cantitate || ' ' || um FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'IPB-1') <> '110.00 m' THEN
    RAISE EXCEPTION 'T14 FAIL: primul import';
  END IF;
END $t$;
\ir fixtures/nod_constructii/import_exemplu_1.sql
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM t14_v1 v JOIN public.executie_noduri_constructii s ON s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = v.cod WHERE s.versiune <> v.versiune) THEN
    RAISE EXCEPTION 'T14 FAIL: reluarea a schimbat ceva (nu e idempotentă)';
  END IF;
  -- F6-2 primește o bifare din aplicație (ca editor nu se poate aici fără JWT: scriere de mentenanță, cu etape_de NULL)
  UPDATE public.executie_noduri_constructii SET etape_data = ARRAY[(now() AT TIME ZONE 'Europe/Bucharest')::date], etape_de = ARRAY[NULL]::uuid[], etape_la = ARRAY[now()]
   WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-2';
END $t$;
\ir fixtures/nod_constructii/import_exemplu_2.sql
DO $t$ BEGIN
  IF (SELECT string_agg(cod || ':' || stare, ',' ORDER BY cod) FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT')
       IS DISTINCT FROM 'F6-1:activ,F6-2:activ,FSI-1:activ,IPB-1:activ,SPC-1:anulat'
     OR (SELECT motiv FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'SPC-1') NOT LIKE 'import: %'
     OR (SELECT denumire || '|' || certitudine || '|' || cardinality(etape) || '|' || cardinality(etape_data) || '|' || etapa_curenta FROM public.executie_noduri_constructii
          WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-2') IS DISTINCT FROM 'Fundație fictivă rezervor 1, reazem 2 (revizuită)|sigur|7|1|egalizare'
     OR (SELECT cantitate FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'IPB-1') <> 112.5
     OR (SELECT versiune FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-1')
        <> (SELECT versiune FROM t14_v1 WHERE cod = 'F6-1') THEN
    RAISE EXCEPTION 'T14 FAIL: lista nouă (upsert / anulare / etape cu prefixul păstrat)';
  END IF;
END $t$;
\ir fixtures/nod_constructii/import_exemplu_1.sql
DO $t$ BEGIN
  IF (SELECT string_agg(cod || ':' || stare, ',' ORDER BY cod) FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT')
       IS DISTINCT FROM 'F6-1:activ,F6-2:activ,FSI-1:anulat,IPB-1:activ,SPC-1:activ'
     OR EXISTS (SELECT 1 FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND stare = 'activ' AND motiv IS NOT NULL)
     OR (SELECT cardinality(etape) FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-2') <> 8 THEN
    RAISE EXCEPTION 'T14 FAIL: reactivarea / anularea codului nou';
  END IF;
  -- F6-1 (stadiu 2 etape din import) primește a treia etapă (mentenanță): reluarea aceluiași fișier trebuie să treacă (prefixul = stadiul)
  UPDATE public.executie_noduri_constructii SET etape_data = etape_data || '2026-10-25'::date, etape_de = etape_de || NULL::uuid, etape_la = etape_la || now()
   WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-1';
END $t$;
\ir fixtures/nod_constructii/import_exemplu_1.sql
DO $t$ BEGIN
  IF (SELECT cardinality(etape_data) || '|' || etapa_curenta FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-1')
       IS DISTINCT FROM '3|turnare' THEN
    RAISE EXCEPTION 'T14 FAIL: reluarea după o bifare nouă';
  END IF;
END $t$;
CREATE TEMP TABLE t14_v2 ON COMMIT DROP AS SELECT cod, versiune, stare FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT';
SAVEPOINT t14a;
\set ON_ERROR_STOP 0
\ir fixtures/nod_constructii/import_exemplu_3.sql
\set t14a_eroare :ERROR
\set t14a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t14a;
SELECT pg_temp.t_eroare('T14a', :'t14a_eroare', :'t14a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'lipsesc din listă elemente cu etape bifate: F6-2 (1 etape bifate)');
SAVEPOINT t14b;
\set ON_ERROR_STOP 0
\ir fixtures/nod_constructii/import_exemplu_4.sql
\set t14b_eroare :ERROR
\set t14b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t14b;
SELECT pg_temp.t_eroare('T14b', :'t14b_eroare', :'t14b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'lista nouă de etape nu păstrează etapele deja bifate la: F6-2');
SAVEPOINT t14c;
\set ON_ERROR_STOP 0
\ir fixtures/nod_constructii/import_exemplu_5.sql
\set t14c_eroare :ERROR
\set t14c_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t14c;
SELECT pg_temp.t_eroare('T14c', :'t14c_eroare', :'t14c_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'stadiul inițial diferă de etapele deja bifate la: F6-1');
SAVEPOINT t14d;
\set ON_ERROR_STOP 0
\ir fixtures/nod_constructii/import_exemplu_6.sql
\set t14d_eroare :ERROR
\set t14d_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t14d;
SELECT pg_temp.t_eroare('T14d', :'t14d_eroare', :'t14d_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'stadiul inițial diferă de etapele deja bifate la: F6-1');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM t14_v2 v FULL JOIN (SELECT * FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT') s ON s.cod = v.cod
              WHERE (s.versiune, s.stare) IS DISTINCT FROM (v.versiune, v.stare)) THEN
    RAISE EXCEPTION 'T14 FAIL: un import oprit a scris ceva';
  END IF;
  DELETE FROM public.executie_noduri_constructii WHERE proiect_id = 1 AND nod_cod = 'NOD-TEST-IMPORT';
  RAISE NOTICE 'T14 OK (cele patru opriri au fost verificate explicit, fără nicio scriere)';
END $t$;
\else
\echo 'T14 SĂRIT: proiectul 1 nu există pe clonă (importul nu s-a putut proba)'
\endif

-- T15: revenirea 20261201a REFUZĂ cât timp tabelul de aici există (politica lui folosește fn_executie_nod_drept): ordinea revenirilor e impusă
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t15;
SELECT set_config('gazpet.revenire_20261201a', 'SCOATE_NODURI_SUDURI:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261201a_executie_noduri_suduri_ROLLBACK.sql
\set t15_eroare :ERROR
\set t15_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t15;
SELECT pg_temp.t_eroare('T15', :'t15_eroare', :'t15_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'alte obiecte depind de tabel / functii');
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_suduri') IS NULL OR to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL THEN
    RAISE EXCEPTION 'T15 FAIL: revenirea 20261201a refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T15 OK';
END $t$;

-- T12: revenirea — nearmată = refuz; armată cu date = refuz (tranzacția abandonată până la savepoint, nimic nu se execută după eroare)
SAVEPOINT t12a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261207a_executie_noduri_constructii_ROLLBACK.sql
\set t12a_eroare :ERROR
\set t12a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t12a;
SELECT pg_temp.t_eroare('T12a', :'t12a_eroare', :'t12a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t12b;
SELECT set_config('gazpet.revenire_20261207a', 'SCOATE_NODURI_CONSTRUCTII:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261207a_executie_noduri_constructii_ROLLBACK.sql
\set t12b_eroare :ERROR
\set t12b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t12b;
SELECT pg_temp.t_eroare('T12b', :'t12b_eroare', :'t12b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'tabelul are randuri');
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_constructii') IS NULL OR (SELECT count(*) FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_noduri_constructii' AND policyname = 'executie_noduri_constructii_citire') THEN
    RAISE EXCEPTION 'T12 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T12 OK (refuzurile „garda invalida” și „tabelul are randuri” au fost verificate explicit)';
END $t$;

-- T16: revenirea armată pe tabel GOL refuză o stare care nu e exact cea din migrare (L15): corpul unei funcții schimbat; politica schimbată
SAVEPOINT t16a;
CREATE OR REPLACE FUNCTION public.fn_executie_constr_etape_valide(p text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$ BEGIN RETURN true; END $f$;
DELETE FROM public.executie_noduri_constructii;
SELECT set_config('gazpet.revenire_20261207a', 'SCOATE_NODURI_CONSTRUCTII:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261207a_executie_noduri_constructii_ROLLBACK.sql
\set t16a_eroare :ERROR
\set t16a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t16a;
SELECT pg_temp.t_eroare('T16a', :'t16a_eroare', :'t16a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'starea nu e cea din 20261207a');
SAVEPOINT t16b;
ALTER POLICY executie_noduri_constructii_citire ON public.executie_noduri_constructii USING (true);
DELETE FROM public.executie_noduri_constructii;
SELECT set_config('gazpet.revenire_20261207a', 'SCOATE_NODURI_CONSTRUCTII:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261207a_executie_noduri_constructii_ROLLBACK.sql
\set t16b_eroare :ERROR
\set t16b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t16b;
SELECT pg_temp.t_eroare('T16b', :'t16b_eroare', :'t16b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'starea nu e cea din 20261207a');
DO $t$ BEGIN
  IF public.fn_executie_constr_etape_valide(ARRAY['xyz']) OR (SELECT count(*) FROM public.executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-HARNESS') <> 5
     OR to_regclass('public.executie_noduri_constructii') IS NULL THEN
    RAISE EXCEPTION 'T16 FAIL: starea nu a revenit după refuz';
  END IF;
  RAISE NOTICE 'T16 OK (revenirea refuză corpul de funcție schimbat și politica schimbată)';
END $t$;

-- T13: revenirea armată pe tabel gol scoate tot (și NU atinge 20261201a); re-aplicarea merge
DELETE FROM public.executie_noduri_constructii;
SELECT set_config('gazpet.revenire_20261207a', 'SCOATE_NODURI_CONSTRUCTII:' || txid_current(), true);
\ir ../supabase/revenire/20261207a_executie_noduri_constructii_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_constructii') IS NOT NULL OR to_regprocedure('public.fn_executie_constr_etapa(bigint, integer, text, text, date, text, uuid)') IS NOT NULL
     OR current_setting('gazpet.revenire_20261207a', true) <> ''
     OR to_regclass('public.executie_noduri_suduri') IS NULL OR to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL THEN
    RAISE EXCEPTION 'T13 FAIL: revenirea';
  END IF;
END $t$;
\ir ../supabase/migrations/20261207a_executie_noduri_constructii.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_noduri_constructii') IS NULL THEN RAISE EXCEPTION 'T13 FAIL: re-aplicarea'; END IF;
  RAISE NOTICE 'T13 OK — toate testele au trecut; urmează ROLLBACK (nimic nu rămâne pe clonă)';
END $t$;

ROLLBACK;
