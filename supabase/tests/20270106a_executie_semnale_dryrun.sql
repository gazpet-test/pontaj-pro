-- Dry-run 20270106a_executie_semnale — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Cere migrarea 20270106a APLICATĂ pe clonă (prin runner, cu L15 v2). Rulare din rădăcina repo-ului:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/20270106a_executie_semnale_dryrun.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): identități reale din catalog (owner + 4 profiluri non-owner, cu drepturile 'executie',
-- legătura cu fișa de angajat și restricția pe proiect rescrise DOAR în tranzacție), 2 angajați și 2 proiecte EXISTENTE (managerul de proiect
-- rescris doar în tranzacție), semnale FICTIVE (tip „dry_*”). Nimic din datele reale nu se citește în afara catalogului și nimic nu rămâne.
-- Fiecare test se termină cu NOTICE „Dn OK”; orice abatere oprește rularea (RAISE EXCEPTION). Refuzurile se verifică după SQLSTATE și după
-- fragmentul exact al mesajului (L25). Același scenariu rulează local pe PGlite (scripts/pglite/test_executie_semnale_local.mjs, secțiunea 6).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;

-- rolul + JWT-ul unui cont (ambele surse: auth.uid() citește întâi request.jwt.claim.sub); 'postgres' = înapoi la operator, fără JWT
CREATE FUNCTION pg_temp.d_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- refuzul așteptat: SQLSTATE exact și (opțional) un fragment al mesajului; întoarce false dacă a trecut sau a picat altfel
CREATE FUNCTION pg_temp.d_refuza(p_sql text, p_stare text, p_fragment text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 'd_refuza: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare OR (p_fragment IS NOT NULL AND position(p_fragment IN SQLERRM) = 0) THEN
    RAISE NOTICE 'd_refuza: așteptat % „%”, primit % (%)', p_stare, p_fragment, SQLSTATE, left(SQLERRM, 240);
    RETURN false;
  END IF;
  RETURN true;
END $h$;
CREATE FUNCTION pg_temp.d_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('dsem.' || p, true), ''); $h$;
-- un semnal fictiv pe proiectul p (1 / 2), cu suprascrieri; scris ca service_role (agentul)
CREATE FUNCTION pg_temp.d_semnal(p_p integer, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT jsonb_build_object('proiect_id', pg_temp.d_g('p' || p_p)::bigint, 'flux', 'lipsuri', 'tip', 'dry_termen_apropiat', 'obiect', 'contract:termen',
    'gravitate', 'atentie', 'titlu', 'Termenul contractului se apropie', 'detalii', 'Mai sunt 20 de zile până la termen.', 'constatare', 'constatat',
    'surse_consultate', jsonb_build_array('ERP: executie_proiecte.data_termen'), 'dovada_sursa', 'camp_erp', 'dovada_data', '2026-11-21',
    'dovada_fragment', 'data_termen = 2026-12-11', 'dovada_ref', 'executie_proiecte.data_termen', 'termen', '2026-12-11', 'termen_baza', 'câmpul data_termen',
    'termen_confirmat', true, 'incertitudine', NULL, 'propunere', 'Verificați dacă e nevoie de act adițional.', 'responsabil_employee_id', NULL,
    'regula_versiune', 'dry-1') || p_extra
$h$;
CREATE FUNCTION pg_temp.d_scrie(p_semnal jsonb) RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.d_ca(NULL, 'service_role');
  r := public.fn_executie_semnal_scrie(p_semnal);
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  RETURN r;
END $h$;
CREATE FUNCTION pg_temp.d_nr(p_uid uuid, p_rol text, p_sql text) RETURNS integer LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.d_ca(p_uid, p_rol);
  EXECUTE p_sql INTO n;
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  RETURN n;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.d_ca(uuid, text), pg_temp.d_refuza(text, text, text), pg_temp.d_g(text), pg_temp.d_semnal(integer, jsonb) TO authenticated, anon, service_role;

-- D0: identități, drepturi și legături rescrise în tranzacție
DO $t$
DECLARE own uuid; ids uuid[]; e integer[]; p bigint; p2 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'D0 FAIL: rulează ca postgres'; END IF;
  IF to_regclass('public.executie_semnale') IS NULL THEN RAISE EXCEPTION 'D0 FAIL: migrarea 20270106a nu e aplicată'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 4) x;
  SELECT array_agg(id ORDER BY id) INTO e FROM (SELECT id FROM public.employees WHERE active IS NOT FALSE ORDER BY id LIMIT 2) x;
  SELECT id INTO p FROM public.executie_proiecte ORDER BY id LIMIT 1;
  SELECT id INTO p2 FROM public.executie_proiecte WHERE id <> p ORDER BY id LIMIT 1;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 4 OR coalesce(array_length(e, 1), 0) < 2 OR p IS NULL OR p2 IS NULL THEN
    RAISE EXCEPTION 'D0 FAIL: identități / angajați / proiecte insuficiente';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_semnale WHERE tip LIKE 'dry\_%') THEN RAISE EXCEPTION 'D0 FAIL: tipurile dry_* sunt deja folosite'; END IF;
  -- ids[1] = managerul proiectului p (fișa e[1]); ids[2] = responsabil (fișa e[2]); ids[3] = acces general 'admin' pe modul, fără fișă;
  -- ids[4] = managerul proiectului p, dar RESTRÂNS pe proiectul p2 (lista 20261209a) → nu vede p
  UPDATE public.profiles SET employee_id = NULL WHERE id = ANY (ids);
  UPDATE public.profiles SET employee_id = e[1] WHERE id IN (ids[1], ids[4]);
  UPDATE public.profiles SET employee_id = e[2] WHERE id = ids[2];
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level)
  VALUES (ids[1], 'executie', 'editor'), (ids[2], 'executie', 'viewer'), (ids[3], 'executie', 'admin'), (ids[4], 'executie', 'editor');
  DELETE FROM public.executie_acces_proiect WHERE profile_id = ANY (ids);
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES (ids[4], p2, 'editor');
  UPDATE public.executie_proiecte SET mp_employee_id = e[1] WHERE id = p;
  UPDATE public.executie_proiecte SET mp_employee_id = NULL WHERE id = p2;
  PERFORM set_config('dsem.own', own::text, true);
  PERFORM set_config('dsem.mp', ids[1]::text, true); PERFORM set_config('dsem.resp', ids[2]::text, true);
  PERFORM set_config('dsem.gen', ids[3]::text, true); PERFORM set_config('dsem.restr', ids[4]::text, true);
  PERFORM set_config('dsem.e1', e[1]::text, true); PERFORM set_config('dsem.e2', e[2]::text, true);
  PERFORM set_config('dsem.p1', p::text, true); PERFORM set_config('dsem.p2', p2::text, true);
  RAISE NOTICE 'D0 OK (p1=%, p2=%, e1=%, e2=%)', p, p2, e[1], e[2];
END $t$;

-- D1: agentul scrie (creat), dedup (același semnal = actualizat / neschimbat, un singur rând), refuzurile de validare
DO $t$
DECLARE r jsonb; n integer; v_id bigint;
BEGIN
  r := pg_temp.d_scrie(pg_temp.d_semnal(1));
  IF r ->> 'actiune' <> 'creat' OR r ->> 'stare' <> 'nou' OR (r ->> 'versiune')::int <> 1 THEN RAISE EXCEPTION 'D1 FAIL: creare %', r; END IF;
  v_id := (r ->> 'id')::bigint;
  PERFORM set_config('dsem.s1', v_id::text, true);
  r := pg_temp.d_scrie(pg_temp.d_semnal(1));
  IF r ->> 'actiune' <> 'neschimbat' OR (r ->> 'id')::bigint <> v_id THEN RAISE EXCEPTION 'D1 FAIL: același semnal nu e „neschimbat”: %', r; END IF;
  r := pg_temp.d_scrie(pg_temp.d_semnal(1, '{"gravitate": "critic"}'));
  IF r ->> 'actiune' <> 'actualizat' OR (r ->> 'id')::bigint <> v_id THEN RAISE EXCEPTION 'D1 FAIL: schimbarea gravității nu e „actualizat”: %', r; END IF;
  SELECT count(*) INTO n FROM public.executie_semnale WHERE tip = 'dry_termen_apropiat';
  IF n <> 1 THEN RAISE EXCEPTION 'D1 FAIL: % rânduri pentru aceeași cheie', n; END IF;
  SELECT count(*) INTO n FROM public.executie_semnale_jurnal WHERE semnal_id = v_id;
  IF n <> 2 THEN RAISE EXCEPTION 'D1 FAIL: jurnalul are % rânduri (așteptat creat + actualizat)', n; END IF;
  -- al doilea semnal, pe p2, cu responsabilul e2 și „negăsit în surse”
  r := pg_temp.d_scrie(pg_temp.d_semnal(2, jsonb_build_object('tip', 'dry_document_negasit', 'obiect', 'polita:GBE', 'constatare', 'negasit_in_surse',
         'dovada_sursa', NULL, 'dovada_fragment', NULL, 'dovada_ref', NULL, 'surse_consultate', jsonb_build_array('NAS: Z:/.../garantii', 'mail: subiect „GBE”'),
         'termen', NULL, 'termen_baza', NULL, 'termen_confirmat', NULL, 'responsabil_employee_id', pg_temp.d_g('e2')::int, 'titlu', 'Polița GBE nu a fost găsită')));
  IF r ->> 'actiune' <> 'creat' THEN RAISE EXCEPTION 'D1 FAIL: al doilea semnal %', r; END IF;
  PERFORM set_config('dsem.s2', r ->> 'id', true);
  -- validarea: chei necunoscute, lipsă, tipuri, enumerări, constatarea fără surse, proiect / angajat inexistent, același tip pe alt flux
  IF NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"strain": 1}')), '22023', 'câmpuri necunoscute')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1) - 'titlu'), '22023', 'obligatoriu')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"gravitate": 3}')), '22023', 'trebuie să fie string')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"gravitate": "urgent"}')), '23514')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"tip": "dry_x", "obiect": "o", "constatare": "negasit_in_surse", "surse_consultate": []}')), '23514')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"proiect_id": 999999999}')), '22023', 'proiectul nu există')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"responsabil_employee_id": 999999999}')), '22023', 'angajat activ')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"dovada_data": "21.11.2026"}')), '22023', 'AAAA-LL-ZZ')
     OR NOT pg_temp.d_refuza(format('SELECT pg_temp.d_scrie(%L::jsonb)', pg_temp.d_semnal(1, '{"flux": "tichete"}')), '22023', 'înregistrat pe fluxul') THEN
    RAISE EXCEPTION 'D1 FAIL: validarea';
  END IF;
  RAISE NOTICE 'D1 OK';
END $t$;

-- D2: citirea prin RLS (tabel + vedere + jurnal): owner tot; MP doar p1; responsabilul doar semnalul lui; acces general / restrâns / anonim = 0
DO $t$
DECLARE own uuid := pg_temp.d_g('own')::uuid; mp uuid := pg_temp.d_g('mp')::uuid; resp uuid := pg_temp.d_g('resp')::uuid;
  gen uuid := pg_temp.d_g('gen')::uuid; restr uuid := pg_temp.d_g('restr')::uuid; q text := 'SELECT count(*)::int FROM public.executie_semnale WHERE tip LIKE ''dry\_%''';
  qv text := 'SELECT count(*)::int FROM public.v_executie_semnale WHERE tip LIKE ''dry\_%''';
  qj text := 'SELECT count(*)::int FROM public.executie_semnale_jurnal j WHERE j.semnal_id IN (' || pg_temp.d_g('s1') || ', ' || pg_temp.d_g('s2') || ')';
BEGIN
  IF pg_temp.d_nr(own, 'authenticated', q) <> 2 OR pg_temp.d_nr(own, 'authenticated', qv) <> 2 OR pg_temp.d_nr(own, 'authenticated', qj) <> 3 THEN RAISE EXCEPTION 'D2 FAIL: owner-ul nu vede tot'; END IF;
  IF pg_temp.d_nr(mp, 'authenticated', q) <> 1 OR pg_temp.d_nr(mp, 'authenticated', qv) <> 1 OR pg_temp.d_nr(mp, 'authenticated', qj) <> 2 THEN RAISE EXCEPTION 'D2 FAIL: MP-ul nu vede exact p1'; END IF;
  IF pg_temp.d_nr(resp, 'authenticated', q) <> 1 OR pg_temp.d_nr(resp, 'authenticated', qj) <> 1 THEN RAISE EXCEPTION 'D2 FAIL: responsabilul nu vede exact semnalul lui'; END IF;
  IF pg_temp.d_nr(gen, 'authenticated', q) <> 0 OR pg_temp.d_nr(gen, 'authenticated', qv) <> 0 OR pg_temp.d_nr(gen, 'authenticated', qj) <> 0 THEN RAISE EXCEPTION 'D2 FAIL: accesul general pe modul vede semnale'; END IF;
  IF pg_temp.d_nr(restr, 'authenticated', q) <> 0 THEN RAISE EXCEPTION 'D2 FAIL: MP-ul restrâns pe alt proiect vede p1'; END IF;
  IF pg_temp.d_nr(NULL, 'authenticated', q) <> 0 THEN RAISE EXCEPTION 'D2 FAIL: fără JWT se văd semnale'; END IF;
  PERFORM pg_temp.d_ca(NULL, 'anon');
  IF NOT pg_temp.d_refuza(q, '42501') THEN RAISE EXCEPTION 'D2 FAIL: anon citește'; END IF;
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  RAISE NOTICE 'D2 OK';
END $t$;

-- D3: scrierile directe refuzate (L07): authenticated / service_role fără INSERT / UPDATE / DELETE; postgres fără DELETE / TRUNCATE; RPC-ul agentului
--     nu se cheamă de un cont de utilizator; agentul (postgres fără JWT) nu atinge starea / motivul omului nici pe calea directă
DO $t$
DECLARE own uuid := pg_temp.d_g('own')::uuid; s1 bigint := pg_temp.d_g('s1')::bigint; s2 bigint := pg_temp.d_g('s2')::bigint;
BEGIN
  PERFORM pg_temp.d_ca(own, 'authenticated');
  IF NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET titlu = ''x'' WHERE id = %s', s1), '42501')
     OR NOT pg_temp.d_refuza(format('DELETE FROM public.executie_semnale WHERE id = %s', s1), '42501')
     OR NOT pg_temp.d_refuza(format('INSERT INTO public.executie_semnale_jurnal (semnal_id, proiect_id, actiune, actor) VALUES (%s, %s, ''creat'', ''om'')', s1, pg_temp.d_g('p1')), '42501')
     OR NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_scrie(%L::jsonb)', pg_temp.d_semnal(1)), '42501') THEN
    RAISE EXCEPTION 'D3 FAIL: owner-ul autentificat scrie direct / cheamă RPC-ul agentului';
  END IF;
  PERFORM pg_temp.d_ca(NULL, 'service_role');
  IF NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET stare = ''in_lucru'' WHERE id = %s', s1), '42501')
     OR NOT pg_temp.d_refuza(format('DELETE FROM public.executie_semnale_jurnal WHERE semnal_id = %s', s1), '42501') THEN
    RAISE EXCEPTION 'D3 FAIL: service_role scrie direct în tabele';
  END IF;
  -- service_role cu un JWT de utilizator (sub) pe RPC-ul agentului = refuz explicit
  PERFORM pg_temp.d_ca(own, 'service_role');
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_scrie(%L::jsonb)', pg_temp.d_semnal(1)), '42501', 'calea agentului') THEN
    RAISE EXCEPTION 'D3 FAIL: RPC-ul agentului acceptă un cont de utilizator';
  END IF;
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  IF NOT pg_temp.d_refuza(format('DELETE FROM public.executie_semnale WHERE id = %s', s1), '42501', 'nu se șterg')
     OR NOT pg_temp.d_refuza('TRUNCATE public.executie_semnale_jurnal', '42501', 'nu se golește')
     OR NOT pg_temp.d_refuza('TRUNCATE public.executie_semnale, public.executie_semnale_jurnal', '42501', 'nu se golește')
     OR NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale_jurnal SET motiv = ''x'' WHERE semnal_id = %s', s1), '42501', 'doar adăugare')
     OR NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET stare = ''in_lucru'' WHERE id = %s', s1), '42501', 'agentul nu schimbă starea')
     OR NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET stare_motiv = ''x'' WHERE id = %s', s1), '42501', 'agentul nu atinge motivul')
     OR NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET tip = ''dry_alt'' WHERE id = %s', s1), '23514', 'identitatea') THEN
    RAISE EXCEPTION 'D3 FAIL: calea directă a lui postgres (agent fără JWT)';
  END IF;
  RAISE NOTICE 'D3 OK';
END $t$;

-- D4: omul schimbă starea: MP-ul pe p1 (in_lucru → respins cu motiv), CAS, responsabilul pe semnalul lui, refuzurile (fără drept, fără motiv,
--     tranziție nepermisă, stare „nou”, nimic de schimbat, fără JWT, anon); omul nu rescrie constatarea (calea directă ca postgres cu JWT)
DO $t$
DECLARE own uuid := pg_temp.d_g('own')::uuid; mp uuid := pg_temp.d_g('mp')::uuid; resp uuid := pg_temp.d_g('resp')::uuid; gen uuid := pg_temp.d_g('gen')::uuid;
  s1 bigint := pg_temp.d_g('s1')::bigint; s2 bigint := pg_temp.d_g('s2')::bigint; r jsonb; v integer;
BEGIN
  SELECT versiune INTO v FROM public.executie_semnale WHERE id = s1;
  PERFORM pg_temp.d_ca(mp, 'authenticated');
  r := public.fn_executie_semnal_stare(s1, v, 'in_lucru', NULL, NULL, NULL, NULL, false);
  IF (r ->> 'ok')::boolean IS NOT TRUE OR r -> 'semnal' ->> 'stare' <> 'in_lucru' OR (r -> 'semnal' ->> 'stare_de')::uuid <> mp OR (r -> 'semnal' ->> 'versiune')::int <> v + 1 THEN
    RAISE EXCEPTION 'D4 FAIL: in_lucru %', r;
  END IF;
  -- CAS: versiunea veche = conflict, nimic scris
  r := public.fn_executie_semnal_stare(s1, v, 'respins', 'nu e cazul', NULL, NULL, NULL, false);
  IF (r ->> 'ok')::boolean IS NOT FALSE OR r ->> 'motiv' <> 'conflict' OR r -> 'semnal' ->> 'stare' <> 'in_lucru' THEN RAISE EXCEPTION 'D4 FAIL: CAS %', r; END IF;
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, ''respins'', NULL, NULL, NULL, NULL, false)', s1, v + 1), '22023', 'cere un motiv')
     OR NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, ''nou'', NULL, NULL, NULL, NULL, false)', s1, v + 1), '22023', 'nepermisă omului')
     OR NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, NULL, NULL, NULL, NULL, NULL, false)', s1, v + 1), '22023', 'nimic de schimbat')
     OR NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, ''in_lucru'', NULL, NULL, NULL, NULL, false)', s2, 1), '42501', 'nu ai drept') THEN
    RAISE EXCEPTION 'D4 FAIL: refuzurile MP-ului';
  END IF;
  r := public.fn_executie_semnal_stare(s1, v + 1, 'respins', 'Termenul e deja prelungit prin AA 2.', 'AA nr. 2 / 2026', 'TKT-DRY-1', NULL, false);
  IF (r ->> 'ok')::boolean IS NOT TRUE OR r -> 'semnal' ->> 'stare' <> 'respins' OR r -> 'semnal' ->> 'actiune_ref' <> 'TKT-DRY-1' THEN RAISE EXCEPTION 'D4 FAIL: respins %', r; END IF;
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, ''asteapta_informatii'', ''x'', NULL, NULL, NULL, false)', s1, v + 2), '22023', 'tranziție nepermisă') THEN
    RAISE EXCEPTION 'D4 FAIL: respins -> asteapta trebuia refuzat';
  END IF;
  -- responsabilul își vede semnalul (s2) și îl ia în lucru; accesul general / fără JWT / anon = refuz
  PERFORM pg_temp.d_ca(resp, 'authenticated');
  r := public.fn_executie_semnal_stare(s2, 1, 'in_lucru', NULL, NULL, NULL, NULL, false);
  IF (r ->> 'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'D4 FAIL: responsabilul nu poate lua în lucru %', r; END IF;
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, ''in_lucru'', NULL, NULL, NULL, NULL, false)', s1, v + 2), '42501', 'nu ai drept') THEN
    RAISE EXCEPTION 'D4 FAIL: responsabilul lui s2 a atins s1';
  END IF;
  PERFORM pg_temp.d_ca(gen, 'authenticated');
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, 2, ''rezolvat'', ''gata'', NULL, NULL, NULL, false)', s2), '42501', 'nu ai drept') THEN
    RAISE EXCEPTION 'D4 FAIL: accesul general schimbă starea';
  END IF;
  PERFORM pg_temp.d_ca(NULL, 'authenticated');
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, 2, ''rezolvat'', ''gata'', NULL, NULL, NULL, false)', s2), '42501', 'autentificare') THEN
    RAISE EXCEPTION 'D4 FAIL: fără JWT';
  END IF;
  PERFORM pg_temp.d_ca(NULL, 'anon');
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, 2, ''rezolvat'', ''gata'', NULL, NULL, NULL, false)', s2), '42501') THEN
    RAISE EXCEPTION 'D4 FAIL: anon';
  END IF;
  -- owner-ul schimbă responsabilul lui s2 (sursa devine „om”) și redeschide s1 (respins -> in_lucru cere motiv)
  PERFORM pg_temp.d_ca(own, 'authenticated');
  r := public.fn_executie_semnal_stare(s2, 2, NULL, NULL, NULL, NULL, pg_temp.d_g('e1')::int, true);
  IF (r ->> 'ok')::boolean IS NOT TRUE OR (r -> 'semnal' ->> 'responsabil_employee_id')::int <> pg_temp.d_g('e1')::int OR r -> 'semnal' ->> 'responsabil_sursa' <> 'om' THEN
    RAISE EXCEPTION 'D4 FAIL: schimbarea responsabilului %', r;
  END IF;
  IF NOT pg_temp.d_refuza(format('SELECT public.fn_executie_semnal_stare(%s, %s, ''in_lucru'', NULL, NULL, NULL, NULL, false)', s1, v + 2), '22023', 'redeschiderea cere un motiv') THEN
    RAISE EXCEPTION 'D4 FAIL: redeschiderea fără motiv a trecut';
  END IF;
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  -- omul (postgres cu JWT, calea directă) nu rescrie constatarea agentului
  PERFORM set_config('request.jwt.claim.sub', own::text, true);
  IF NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET titlu = ''alt titlu'' WHERE id = %s', s1), '42501', 'constatarea agentului') THEN
    RAISE EXCEPTION 'D4 FAIL: omul rescrie constatarea';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT count(*) FROM public.executie_semnale_jurnal WHERE semnal_id = s1 AND actor = 'om' AND actiune = 'stare') <> 2
     OR (SELECT count(*) FROM public.executie_semnale_jurnal WHERE semnal_id = s2 AND actor = 'om' AND actiune = 'responsabil') <> 1 THEN
    RAISE EXCEPTION 'D4 FAIL: jurnalul omului';
  END IF;
  RAISE NOTICE 'D4 OK';
END $t$;

-- D5: respins nu reapare cu aceeași dovadă (neschimbat_inchis, starea rămâne); cu dovadă nouă se redeschide (nou, decizia veche în jurnal);
--     responsabilul stabilit de om nu e schimbat de agent
DO $t$
DECLARE s1 bigint := pg_temp.d_g('s1')::bigint; s2 bigint := pg_temp.d_g('s2')::bigint; r jsonb; st text; m text;
BEGIN
  r := pg_temp.d_scrie(pg_temp.d_semnal(1, '{"gravitate": "critic"}'));
  SELECT stare, stare_motiv INTO st, m FROM public.executie_semnale WHERE id = s1;
  IF r ->> 'actiune' <> 'neschimbat_inchis' OR st <> 'respins' OR m IS NULL THEN RAISE EXCEPTION 'D5 FAIL: respinsul a reapărut: % / %', r, st; END IF;
  r := pg_temp.d_scrie(pg_temp.d_semnal(1, '{"gravitate": "critic", "dovada_fragment": "data_termen = 2026-12-05 (AA 3)", "dovada_data": "2026-11-22"}'));
  SELECT stare, stare_motiv INTO st, m FROM public.executie_semnale WHERE id = s1;
  IF r ->> 'actiune' <> 'redeschis' OR st <> 'nou' OR m IS NOT NULL THEN RAISE EXCEPTION 'D5 FAIL: dovada nouă nu redeschide: % / %', r, st; END IF;
  IF (SELECT count(*) FROM public.executie_semnale_jurnal WHERE semnal_id = s1 AND actiune = 'redeschis' AND stare_veche = 'respins' AND actor = 'agent') <> 1 THEN
    RAISE EXCEPTION 'D5 FAIL: jurnalul redeschiderii';
  END IF;
  -- fără dovadă nouă, pe calea directă, redeschiderea e refuzată chiar și pentru postgres
  PERFORM pg_temp.d_ca(pg_temp.d_g('own')::uuid, 'authenticated');
  r := public.fn_executie_semnal_stare(s1, (SELECT versiune FROM public.executie_semnale WHERE id = s1), 'rezolvat', 'prelungit prin AA 3', NULL, NULL, NULL, false);
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  IF (r ->> 'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'D5 FAIL: rezolvarea %', r; END IF;
  IF NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET stare = ''nou'' WHERE id = %s', s1), '42501', 'dovadă nouă') THEN
    RAISE EXCEPTION 'D5 FAIL: redeschiderea fără dovadă nouă a trecut pe calea directă';
  END IF;
  -- agentul propune alt responsabil pe s2: rămâne cel stabilit de om (e1)
  r := pg_temp.d_scrie(pg_temp.d_semnal(2, jsonb_build_object('tip', 'dry_document_negasit', 'obiect', 'polita:GBE', 'constatare', 'negasit_in_surse',
         'dovada_sursa', NULL, 'dovada_fragment', NULL, 'dovada_ref', NULL, 'surse_consultate', jsonb_build_array('NAS: Z:/.../garantii', 'mail: subiect „GBE”'),
         'termen', NULL, 'termen_baza', NULL, 'termen_confirmat', NULL, 'responsabil_employee_id', pg_temp.d_g('e2')::int, 'titlu', 'Polița GBE nu a fost găsită')));
  IF (SELECT responsabil_employee_id FROM public.executie_semnale WHERE id = s2) <> pg_temp.d_g('e1')::int
     OR (SELECT responsabil_sursa FROM public.executie_semnale WHERE id = s2) <> 'om' THEN
    RAISE EXCEPTION 'D5 FAIL: agentul a schimbat responsabilul omului (%)', r;
  END IF;
  IF NOT pg_temp.d_refuza(format('UPDATE public.executie_semnale SET responsabil_employee_id = %s WHERE id = %s', pg_temp.d_g('e2'), s2), '42501', 'stabilit de om') THEN
    RAISE EXCEPTION 'D5 FAIL: calea directă schimbă responsabilul omului';
  END IF;
  RAISE NOTICE 'D5 OK';
END $t$;

-- Revenirea cu date (refuz „exista semnale”) și ciclul aplicare -> revenire -> re-aplicare NU sunt aici: le probează scripts/pglite/test_executie_semnale_local.mjs
-- (secțiunea 3) și, pe clonă, runnerul (livrare_migrare.sh pe fișierul de revenire, cu plafonul 2000).
ROLLBACK;
