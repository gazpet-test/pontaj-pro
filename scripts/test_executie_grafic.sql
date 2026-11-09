-- Harness 20261202a_executie_grafic — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_grafic.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> importuri valide / refuzate ca postgres ->
-- teste ca non-owner (SET LOCAL ROLE + request.jwt.claims) -> revenire refuzată (nearmată / cu date) -> revenire armată pe tabele goale ->
-- re-aplicare. Identități reale din catalog (owner + 3 profiluri non-owner, cu drepturile 'executie' rescrise DOAR în tranzacție),
-- date FICTIVE (etichete „TEST-HARNESS …”, sha-uri aaaa… / bbbb… / cccc… / dddd…). Valorile așteptate sunt scrise aici, de mână (L25).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261202a_executie_grafic:' || txid_current(), true);
\ir ../supabase/migrations/20261202a_executie_grafic.sql

CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  -- auth.uid() citește întâi request.jwt.claim.sub, apoi request.jwt.claims: se setează ambele
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 't_refuza: așteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM, 200); END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0: psql :ERROR = true, :SQLSTATE și mesajul exact (testul pică dacă trece)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tgraf.' || p, true), ''); $h$;
-- documentul de import valid (3 activități), scris de mână; p_sha = un caracter hex repetat
CREATE FUNCTION pg_temp.t_doc(p_proiect bigint, p_eticheta text, p_sha text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $h$
  SELECT jsonb_build_object(
    'format', 'gazpet.grafic.v1',
    'revizie', jsonb_build_object('proiect_id', p_proiect, 'eticheta', p_eticheta, 'sursa_fisier', 'Z:/test/' || p_eticheta || '.mpp',
                                  'sursa_sha256', repeat(p_sha, 64), 'tip_fisier', 'MPP', 'data_stare', '2026-09-30',
                                  'camp_pct_plan', 'TEXT5 (% PLAN)', 'camp_pct_raportat', 'TEXT2 (% Complete)',
                                  'aplicatie', 'Microsoft', 'mpxj_versiune', '16.10.0', 'minute_pe_zi', 480, 'randuri_goale', 0),
    'statistici', jsonb_build_object('activitati', 3, 'inventar_cititor', 3), 'campuri_lipsa', '[]'::jsonb, 'avertismente', '[]'::jsonb, 'incerte', '[]'::jsonb,
    'complet', true,
    'activitati', jsonb_build_array(
      jsonb_build_object('ordine', 0, 'uid', 10, 'parinte_uid', NULL, 'wbs', '1', 'nivel', 1, 'nume', 'Lucrare test', 'start_plan', '2026-03-02', 'finish_plan', '2026-06-26',
                         'start_real', NULL, 'finish_real', NULL, 'start_baseline', NULL, 'finish_baseline', NULL, 'durata_zile', 85,
                         'pct_realizat', 35, 'pct_plan', 48, 'pct_raportat', 41.5, 'milestone', false, 'rezumat', true, 'activ', true,
                         'predecesori', '', 'resurse', ''),
      jsonb_build_object('ordine', 1, 'uid', 11, 'parinte_uid', 10, 'wbs', '1.1', 'nivel', 2, 'nume', 'Ordin de începere', 'start_plan', '2026-03-02', 'finish_plan', '2026-03-02',
                         'start_real', '2026-03-02', 'finish_real', '2026-03-02', 'start_baseline', '2026-03-02', 'finish_baseline', '2026-03-02',
                         'durata_zile', 0, 'pct_realizat', 100, 'pct_plan', 100, 'pct_raportat', 100, 'milestone', true, 'rezumat', false, 'activ', true,
                         'predecesori', '', 'resurse', 'Transgaz'),
      jsonb_build_object('ordine', 2, 'uid', 12, 'parinte_uid', 10, 'wbs', '1.2', 'nivel', 2, 'nume', 'Montaj conductă', 'start_plan', '2026-03-16', 'finish_plan', '2026-05-08',
                         'start_real', '2026-03-16', 'finish_real', NULL, 'start_baseline', '2026-03-09', 'finish_baseline', '2026-04-30',
                         'durata_zile', 40.25, 'pct_realizat', 60, 'pct_plan', 80, 'pct_raportat', 55.25, 'milestone', false, 'rezumat', false,
                         'activ', true, 'predecesori', '1.1 FS+5z', 'resurse', 'Echipa A, Echipa B')));
$h$;
-- apelul importului cu un document modificat (jsonb_set pe cale); întoarce jsonb
CREATE FUNCTION pg_temp.t_imp(p_doc jsonb, p_activeaza boolean) RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_executie_grafic_importa(p_doc, p_activeaza);
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_g(text), pg_temp.t_doc(bigint, text, text),
  pg_temp.t_imp(jsonb, boolean) TO authenticated, anon, service_role;

-- T0: identități, drepturi rescrise în tranzacție, proiectul de test
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
  PERFORM set_config('tgraf.own', own::text, true); PERFORM set_config('tgraf.ed', ed::text, true);
  PERFORM set_config('tgraf.vw', vw::text, true);   PERFORM set_config('tgraf.fara', fara::text, true);
  PERFORM set_config('tgraf.p', p::text, true);
  PERFORM set_config('tgraf.p_lipsa', ((SELECT max(id) FROM public.executie_proiecte) + 1000)::text, true);
  RAISE NOTICE 'T0 OK (proiectul de test %)', p;
END $t$;

-- T1: importul valid scrie exact revizia și cele 3 activități (valorile din document), activă, importat_de NULL (postgres, fără JWT)
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; res jsonb; rid bigint;
BEGIN
  res := pg_temp.t_imp(pg_temp.t_doc(p, 'TEST-HARNESS R1', 'a'), true);
  IF (res->>'ok')::boolean IS NOT TRUE OR (res->>'deja')::boolean IS NOT FALSE OR (res->>'activitati')::int <> 3 OR (res->>'activ')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 FAIL: rezultat %', res;
  END IF;
  rid := (res->>'revizie_id')::bigint;
  PERFORM set_config('tgraf.r1', rid::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.executie_grafic_revizii WHERE id = rid AND proiect_id = p AND eticheta = 'TEST-HARNESS R1' AND sursa_sha256 = repeat('a', 64)
                  AND tip_fisier = 'MPP' AND data_stare = DATE '2026-09-30' AND camp_pct_raportat = 'TEXT2 (% Complete)' AND camp_pct_plan = 'TEXT5 (% PLAN)'
                  AND nr_activitati = 3 AND activ AND importat_de IS NULL AND metadate->'statistici'->>'activitati' = '3'
                  AND metadate->>'mpxj_versiune' = '16.10.0' AND (metadate->>'minute_pe_zi')::int = 480 AND jsonb_array_length(metadate->'incerte') = 0) THEN
    RAISE EXCEPTION 'T1 FAIL: revizia scrisă diferă';
  END IF;
  IF (SELECT string_agg(ordine || ':' || uid_sursa || ':' || wbs || ':' || nivel || ':' || nume || ':' || coalesce(start_plan::text, '-') || ':'
                        || coalesce(finish_plan::text, '-') || ':' || coalesce(start_real::text, '-') || ':' || coalesce(finish_real::text, '-') || ':'
                        || coalesce(start_baseline::text, '-') || ':' || coalesce(finish_baseline::text, '-') || ':' || coalesce(durata_zile::text, '-') || ':'
                        || pct_realizat || ':' || coalesce(pct_plan::text, '-') || ':' || coalesce(pct_raportat::text, '-') || ':' || milestone || ':' || rezumat || ':'
                        || activ || ':' || predecesori || ':' || resurse || ':' || coalesce(deviz_cod, '-'), ' | ' ORDER BY ordine)
        FROM public.executie_grafic_activitati WHERE revizie_id = rid)
     IS DISTINCT FROM '0:10:1:1:Lucrare test:2026-03-02:2026-06-26:-:-:-:-:85.00:35.00:48.00:41.50:false:true:true:::-'
                   || ' | 1:11:1.1:2:Ordin de începere:2026-03-02:2026-03-02:2026-03-02:2026-03-02:2026-03-02:2026-03-02:0.00:100.00:100.00:100.00:true:false:true::Transgaz:-'
                   || ' | 2:12:1.2:2:Montaj conductă:2026-03-16:2026-05-08:2026-03-16:-:2026-03-09:2026-04-30:40.25:60.00:80.00:55.25:false:false:true:1.1 FS+5z:Echipa A, Echipa B:-' THEN
    RAISE EXCEPTION 'T1 FAIL: activitățile scrise diferă';
  END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- T2: reimportul aceluiași fișier (aceeași etichetă) nu dublează nimic; alt fișier sub aceeași etichetă / același fișier sub altă etichetă = refuz
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; res jsonb;
BEGIN
  res := pg_temp.t_imp(pg_temp.t_doc(p, 'TEST-HARNESS R1', 'a'), true);
  IF (res->>'deja')::boolean IS NOT TRUE OR (res->>'revizie_id')::bigint <> pg_temp.t_g('r1')::bigint
     OR (SELECT count(*) FROM public.executie_grafic_revizii WHERE proiect_id = p) <> 1
     OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 3 THEN
    RAISE EXCEPTION 'T2 FAIL: reimportul nu e idempotent (%)', res;
  END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_imp(pg_temp.t_doc(%s, 'TEST-HARNESS R1 bis', 'a'), true)$q$, p), '23505')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_imp(pg_temp.t_doc(%s, 'TEST-HARNESS R1', 'b'), true)$q$, p), '23505') THEN
    RAISE EXCEPTION 'T2 FAIL: dublura de fișier / etichetă';
  END IF;
  -- același fișier și aceeași etichetă, dar alt conținut (alt procent) sau alte opțiuni de import (alt câmp de raport) = refuz, nu „deja”
  IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, true)', jsonb_set(pg_temp.t_doc(p, 'TEST-HARNESS R1', 'a'), '{activitati,2,pct_raportat}', '60')::text), '23505')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, true)', jsonb_set(pg_temp.t_doc(p, 'TEST-HARNESS R1', 'a'), '{revizie,camp_pct_raportat}', 'null')::text), '23505')
     OR (SELECT count(*) FROM public.executie_grafic_revizii WHERE proiect_id = p) <> 1
     OR (SELECT pct_raportat FROM public.executie_grafic_activitati WHERE revizie_id = pg_temp.t_g('r1')::bigint AND ordine = 2) <> 55.25 THEN
    RAISE EXCEPTION 'T2 FAIL: același fișier cu alt conținut / alte opțiuni nu a fost refuzat';
  END IF;
  -- același fișier: întâi cu o valoare goală fără incerte, apoi aceeași valoare declarată necitibilă (acceptată) = alt import (refuz), nu „deja”
  res := pg_temp.t_imp(jsonb_set(pg_temp.t_doc(p, 'TEST-HARNESS R7', '7'), '{activitati,2,pct_raportat}', 'null'), false);
  IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, false)',
           jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.t_doc(p, 'TEST-HARNESS R7', '7'), '{activitati,2,pct_raportat}', 'null'),
                     '{incerte}', '[{"wbs":"1.2","camp":"TEXT2","valoare":"#DIV/0!"}]'), '{complet}', 'false'), '{revizie,incerte_acceptate}', 'true')::text), '23505')
     OR (SELECT jsonb_array_length(metadate->'incerte') FROM public.executie_grafic_revizii WHERE id = (res->>'revizie_id')::bigint) <> 0
     OR (pg_temp.t_imp(jsonb_set(pg_temp.t_doc(p, 'TEST-HARNESS R7', '7'), '{activitati,2,pct_raportat}', 'null'), false)->>'deja')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 FAIL: aceeași valoare declarată o dată goală și o dată necitibilă a fost tratată ca „deja”';
  END IF;
  DELETE FROM public.executie_grafic_revizii WHERE id = (res->>'revizie_id')::bigint;
  RAISE NOTICE 'T2 OK';
END $t$;

-- T3: documente invalide = refuz explicit, fără nicio scriere (tipuri, intervale, zecimale, ordine, numărul declarat, completitudine)
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; d jsonb := pg_temp.t_doc(pg_temp.t_g('p')::bigint, 'TEST-HARNESS R9', 'c'); c text; rau jsonb[];
BEGIN
  rau := ARRAY[
    jsonb_set(d, '{format}', '"alt.format"'),
    jsonb_set(d, '{activitati,1,ordine}', '2'),
    jsonb_set(d, '{activitati,2,pct_realizat}', '100.5'),
    jsonb_set(d, '{activitati,2,pct_realizat}', '10.555'),
    jsonb_set(d, '{activitati,2,pct_raportat}', '"55%"'),
    jsonb_set(d, '{activitati,2,durata_zile}', '-1'),
    jsonb_set(d, '{activitati,2,finish_plan}', '"2026-02-30"'),
    jsonb_set(d, '{activitati,2,finish_plan}', '"2026/05/08"'),
    jsonb_set(d, '{activitati,0,nivel}', '"1"'),
    jsonb_set(d, '{activitati,0,uid}', '1.5'),
    d #- '{activitati,1,milestone}',
    d #- '{activitati,1,wbs}',
    jsonb_set(d, '{statistici,activitati}', '4'),
    jsonb_set(d, '{avertismente}', '["nivel sărit la 1.2"]'),
    jsonb_set(jsonb_set(d, '{incerte}', '[{"wbs":"1","camp":"TEXT2","valoare":"#DIV/0!"}]'), '{complet}', 'false'),
    jsonb_set(d, '{incerte}', '[{"wbs":"1","camp":"TEXT2","valoare":"#DIV/0!"}]') #- '{revizie,incerte_acceptate}',
    jsonb_set(jsonb_set(d, '{incerte}', '[{"wbs":"1","camp":"TEXT2","valoare":"#DIV/0!"}]'), '{revizie,incerte_acceptate}', 'true'),
    jsonb_set(d, '{revizie,proiect_id}', to_jsonb(pg_temp.t_g('p_lipsa')::bigint)),
    jsonb_set(d, '{revizie,proiect_id}', '"1"'),
    jsonb_set(d, '{revizie,sursa_sha256}', to_jsonb(repeat('C', 64))),
    jsonb_set(d, '{revizie,data_stare}', '"30.09.2026"'),
    jsonb_set(d, '{activitati}', '[]'),
    jsonb_set(d, '{activitati,2}', '"text"'),
    d #- '{incerte}'];
  FOR i IN 1 .. array_length(rau, 1) LOOP
    IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, true)', rau[i]::text), '22023') THEN
      RAISE EXCEPTION 'T3 FAIL: documentul invalid nr. % a trecut sau a dat altă eroare', i;
    END IF;
  END LOOP;
  -- eticheta cu spații la capăt = CHECK-ul tabelului; finish înaintea start-ului și UniqueID dublat = regulile RPC-ului (înaintea scrierii)
  IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, true)', jsonb_set(d, '{revizie,eticheta}', '"TEST-HARNESS R9 "')::text), '23514')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, true)', jsonb_set(d, '{activitati,2,start_plan}', '"2026-06-01"')::text), '22023')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, true)', jsonb_set(d, '{activitati,2,uid}', '11')::text), '22023')
     OR NOT pg_temp.t_refuza(format('SELECT public.fn_executie_grafic_importa(%L::jsonb, NULL)', d::text), '22023') THEN
    RAISE EXCEPTION 'T3 FAIL: CHECK / UNIQUE pe tabele';
  END IF;
  IF (SELECT count(*) FROM public.executie_grafic_revizii) <> 1 OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 3 THEN
    RAISE EXCEPTION 'T3 FAIL: un import refuzat a scris ceva';
  END IF;
  RAISE NOTICE 'T3 OK (% documente invalide refuzate, nimic scris)', array_length(rau, 1) + 4;
END $t$;

-- T4: valorile incerte acceptate de om trec și rămân listate; activarea: cel mult o revizie activă pe proiect
DO $t$
DECLARE p bigint := pg_temp.t_g('p')::bigint; res jsonb; r2 bigint; r3 bigint; d jsonb;
BEGIN
  d := jsonb_set(jsonb_set(jsonb_set(pg_temp.t_doc(p, 'TEST-HARNESS R2', 'b'), '{incerte}', '[{"wbs":"1.2","camp":"TEXT2","valoare":"#DIV/0!"}]'),
                           '{complet}', 'false'), '{revizie,incerte_acceptate}', 'true');
  d := jsonb_set(d, '{activitati,2,pct_raportat}', 'null');
  res := pg_temp.t_imp(d, true);
  r2 := (res->>'revizie_id')::bigint;
  IF (SELECT activ FROM public.executie_grafic_revizii WHERE id = pg_temp.t_g('r1')::bigint) IS NOT FALSE
     OR (SELECT activ FROM public.executie_grafic_revizii WHERE id = r2) IS NOT TRUE
     OR (SELECT metadate->'incerte'->0->>'valoare' FROM public.executie_grafic_revizii WHERE id = r2) IS DISTINCT FROM '#DIV/0!'
     OR (SELECT pct_raportat FROM public.executie_grafic_activitati WHERE revizie_id = r2 AND ordine = 2) IS NOT NULL THEN
    RAISE EXCEPTION 'T4 FAIL: activarea R2 / incertele';
  END IF;
  res := pg_temp.t_imp(pg_temp.t_doc(p, 'TEST-HARNESS R3', 'd'), false);
  r3 := (res->>'revizie_id')::bigint;
  IF (SELECT activ FROM public.executie_grafic_revizii WHERE id = r3) IS NOT FALSE
     OR (SELECT count(*) FROM public.executie_grafic_revizii WHERE proiect_id = p AND activ) <> 1
     OR (SELECT activ FROM public.executie_grafic_revizii WHERE id = r2) IS NOT TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: importul fără activare a schimbat revizia activă';
  END IF;
  IF NOT pg_temp.t_refuza(format('UPDATE public.executie_grafic_revizii SET activ = true WHERE id = %s', r3), '23505') THEN
    RAISE EXCEPTION 'T4 FAIL: două revizii active pe același proiect';
  END IF;
  PERFORM set_config('tgraf.r3', r3::text, true);
  RAISE NOTICE 'T4 OK';
END $t$;

-- T5: citirea ca non-owner (RLS): owner / editor / viewer văd tot proiectul; fără drept 'executie' sau fără JWT = nimic
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_grafic_revizii) <> 3 OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 9
     OR public.fn_executie_grafic_drept(pg_temp.t_g('p')::bigint) IS NOT TRUE THEN RAISE EXCEPTION 'T5 FAIL: owner'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_grafic_revizii) <> 3 OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 9 THEN RAISE EXCEPTION 'T5 FAIL: editor'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('vw')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_grafic_revizii) <> 3 OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 9
     OR public.fn_executie_grafic_drept(pg_temp.t_g('p_lipsa')::bigint) IS NOT FALSE OR public.fn_executie_grafic_drept(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'T5 FAIL: viewer';
  END IF;
  -- viewer-ul nu scrie nimic, pe nicio cale (privilegiu lipsă = 42501), și nu poate porni importul
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.executie_grafic_revizii (proiect_id, eticheta, sursa_fisier, sursa_sha256, nr_activitati) VALUES (%s, 'X', 'x', %L, 1)$q$,
                                 pg_temp.t_g('p'), repeat('e', 64)), '42501')
     OR NOT pg_temp.t_refuza('UPDATE public.executie_grafic_revizii SET activ = NOT activ', '42501')
     OR NOT pg_temp.t_refuza('UPDATE public.executie_grafic_activitati SET deviz_cod = ''X''', '42501')
     OR NOT pg_temp.t_refuza('DELETE FROM public.executie_grafic_activitati', '42501')
     OR NOT pg_temp.t_refuza('DELETE FROM public.executie_grafic_revizii', '42501')
     OR NOT pg_temp.t_refuza(format('SELECT public.fn_executie_grafic_importa(%L::jsonb, true)', pg_temp.t_doc(pg_temp.t_g('p')::bigint, 'TEST-HARNESS RX', 'e')::text), '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_grafic_j_text('"x"', 'x', 5, false)$q$, '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_executie_grafic_j_numar('1', 'x', 0, 5, 0, false)$q$, '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: scrierea ca viewer';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_grafic_revizii) <> 0 OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 0
     OR public.fn_executie_grafic_drept(pg_temp.t_g('p')::bigint) IS NOT FALSE THEN RAISE EXCEPTION 'T5 FAIL: fără drept executie'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_grafic_revizii) <> 0 OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 0 THEN
    RAISE EXCEPTION 'T5 FAIL: fără JWT';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_grafic_revizii', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_grafic_activitati', '42501')
     OR NOT pg_temp.t_refuza('SELECT public.fn_executie_grafic_drept(1)', '42501') THEN RAISE EXCEPTION 'T5 FAIL: anon'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format('SELECT public.fn_executie_grafic_importa(%L::jsonb, true)', pg_temp.t_doc(pg_temp.t_g('p')::bigint, 'TEST-HARNESS RX', 'e')::text), '42501')
     OR NOT pg_temp.t_refuza('DELETE FROM public.executie_grafic_revizii', '42501')
     OR NOT pg_temp.t_refuza('UPDATE public.executie_grafic_activitati SET nume = ''x''', '42501') THEN
    RAISE EXCEPTION 'T5 FAIL: service_role scrie / importă';
  END IF;
  RAISE NOTICE 'T5 OK (owner / editor / viewer văd 3 revizii + 9 activități; fără drept / fără JWT nimic; anon și service_role nu scriu)';
END $t$;

-- TV: cazurile COMUNE de validare Python / SQL (test-fixtures/grafic/cazuri_validare.json; fragmentul e generat, L19), ca postgres
SELECT pg_temp.t_ca(NULL, 'postgres');
\ir fixtures/grafic/cazuri_validare.sql

-- T6: revenirea — nearmată = refuz; armată cu date = refuz (tranzacția abandonată până la savepoint, nimic nu se execută după eroare)
SAVEPOINT t6a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_executie_grafic_ROLLBACK.sql
\set t6a_eroare :ERROR
\set t6a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6a;
SELECT pg_temp.t_eroare('T6a', :'t6a_eroare', :'t6a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t6b;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_GRAFIC:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261202a_executie_grafic_ROLLBACK.sql
\set t6b_eroare :ERROR
\set t6b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6b;
SELECT pg_temp.t_eroare('T6b', :'t6b_eroare', :'t6b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'tabelele au randuri');
DO $t$ BEGIN
  IF to_regclass('public.executie_grafic_revizii') IS NULL OR (SELECT count(*) FROM public.executie_grafic_revizii) <> 3
     OR (SELECT count(*) FROM public.executie_grafic_activitati) <> 9 THEN
    RAISE EXCEPTION 'T6 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T6 OK (refuzurile „garda invalida” și „tabelele au randuri” au fost verificate explicit)';
END $t$;

-- T7: revenirea armată pe tabele goale scoate tot; re-aplicarea merge
DELETE FROM public.executie_grafic_revizii;   -- activitățile pleacă prin CASCADE
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_GRAFIC:' || txid_current(), true);
\ir ../supabase/revenire/20261202a_executie_grafic_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_grafic_revizii') IS NOT NULL OR to_regclass('public.executie_grafic_activitati') IS NOT NULL
     OR to_regprocedure('public.fn_executie_grafic_drept(bigint)') IS NOT NULL OR to_regprocedure('public.fn_executie_grafic_importa(jsonb, boolean)') IS NOT NULL
     OR current_setting('gazpet.revenire_20261202a', true) <> '' THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea';
  END IF;
END $t$;
\ir ../supabase/migrations/20261202a_executie_grafic.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_grafic_revizii') IS NULL OR to_regclass('public.executie_grafic_activitati') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_importa(jsonb, boolean)') IS NULL THEN
    RAISE EXCEPTION 'T7 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T7 OK — toate testele au trecut; urmează ROLLBACK (nimic nu rămâne pe clonă)';
END $t$;

ROLLBACK;
