-- Harness 20261209a_executie_acces_proiect — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_acces_proiect.sql
-- Precondiție: 20261201a, 20261203a, 20261204a, 20261208a aplicate pe clonă (migrarea le cere).
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): vizibilitatea ÎNAINTE (ca utilizatori reali, prin RLS) -> migrare -> aceeași vizibilitate
-- pentru conturile nerestrânse -> restricție setată de owner prin RPC -> citire / scriere ca non-owner (REST, RPC DEFINER, funcțiile de drept,
-- Storage, vederi) -> RPC-ul de setare (refuzuri, CAS, idempotență) -> revenire refuzată (nearmată / cu conturi restrânse) -> revenire -> re-aplicare.
-- NU presupune date reale: ia primul owner, primele 3 profiluri non-owner și primele 3 proiecte din catalog (dacă clona are doar 2, al treilea
-- se creează în tranzacție, copiat din primul), le leagă DOAR în tranzacție și scrie date FICTIVE (unități T-ACC*, nodul NOD-TEST-ACCES).
-- Identități: A = Execuție editor, NErestrâns; B = Execuție editor, restrâns pe p1 (editor) + p2 (viewer); C = Execuție viewer, restrâns pe p1 (editor).
-- Oracolul independent (L25): ce vedea FIECARE cont înainte de migrare, numărat prin RLS-ul existent; după, nerestrânșii văd identic,
-- iar B vede identic pe p1 / p2 și ZERO pe p3.
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;

-- ── unelte ──
CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
  IF auth.uid() IS DISTINCT FROM p_uid OR current_user IS DISTINCT FROM p_rol
     OR (p_rol IN ('authenticated', 'anon') AND (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 't_ca: identitatea nu s-a schimbat (% / %)', auth.uid(), current_user;
  END IF;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tacc.' || p, true), ''); $h$;
-- rezultatul unei instrucțiuni: 'OK <rânduri>' sau '<SQLSTATE> <mesaj>'
CREATE FUNCTION pg_temp.t_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN 'OK ' || n;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
-- refuzul GĂRZII de proiect (42501 + mesajul ei), nu alt refuz
CREATE FUNCTION pg_temp.t_garda(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $h$
DECLARE s text := pg_temp.t_stare(p_sql);
BEGIN
  IF s NOT LIKE '42501 %nu ai drept de scriere pe acest proiect%' THEN RAISE NOTICE 't_garda: așteptat refuzul gărzii, primit: % (%)', s, left(p_sql, 160); RETURN false; END IF;
  RETURN true;
END $h$;
-- garda NU oprește un INSERT (orice alt rezultat: constrângerile / politicile vechi ale tabelului). Dacă trece de tot, 1/0 îl anulează
-- (subtranzacția lui t_stare), ca numărătorile de vizibilitate să rămână cele de dinainte.
CREATE FUNCTION pg_temp.t_trece_garda(p_insert text) RETURNS boolean LANGUAGE plpgsql AS $h$
DECLARE s text := pg_temp.t_stare(format('WITH x AS (%s RETURNING 1) SELECT 1 / 0 FROM x', p_insert));
BEGIN
  IF s LIKE '%nu ai drept de scriere pe acest proiect%' OR s LIKE 'OK %' THEN
    RAISE NOTICE 't_trece_garda: garda a refuzat sau scrierea nu s-a anulat: % (%)', s, left(p_insert, 160); RETURN false;
  END IF;
  RETURN true;
END $h$;
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
-- tabelele acoperite (aceeași listă ca migrarea): tip p = coloana e proiectul; sl / bon = coloana e părintele (situație de plată / bon)
CREATE FUNCTION pg_temp.t_tabele() RETURNS TABLE (tabel text, coloana text, tip text) LANGUAGE sql IMMUTABLE AS $h$
  VALUES ('executie_proiecte', 'id', 'p'), ('executie_tronsoane', 'proiect_id', 'p'), ('executie_documente_contract', 'proiect_id', 'p'),
    ('executie_acte_aditionale', 'proiect_id', 'p'), ('executie_ordine_sistare', 'proiect_id', 'p'), ('executie_ordine_detectate', 'proiect_id', 'p'),
    ('executie_completari_propuse', 'proiect_id', 'p'), ('executie_faze_determinante', 'proiect_id', 'p'), ('executie_probe_presiune', 'proiect_id', 'p'),
    ('executie_situatii_plata', 'proiect_id', 'p'), ('executie_bonuri_consum', 'proiect_id', 'p'), ('executie_alocari_personal', 'proiect_id', 'p'),
    ('executie_ture', 'proiect_id', 'p'), ('executie_tura_subcontractori', 'proiect_id', 'p'), ('executie_tura_activitati', 'proiect_id', 'p'),
    ('executie_tura_naveta', 'proiect_id', 'p'), ('proiect_unitati', 'proiect_id', 'p'), ('proiect_activitati', 'proiect_id', 'p'),
    ('proiect_articole', 'proiect_id', 'p'),
    ('executie_situatii_plata_linii', 'sl_id', 'sl'), ('executie_sl_ajustari', 'sl_id', 'sl'), ('executie_bonuri_consum_linii', 'bon_id', 'bon')
$h$;
-- id-urile care aparțin proiectului N (1..3): proiectul însuși sau părinții lui (calculați ca postgres în T0)
CREATE FUNCTION pg_temp.t_ids(p_tip text, p_n integer) RETURNS bigint[] LANGUAGE sql STABLE AS $h$
  SELECT CASE p_tip WHEN 'p' THEN ARRAY[pg_temp.t_g('p' || p_n)::bigint] ELSE coalesce(pg_temp.t_g(p_tip || p_n), '{}')::bigint[] END
$h$;
-- ce vede apelantul curent (prin RLS), pe fiecare tabel acoperit și pe fiecare din cele 3 proiecte
CREATE FUNCTION pg_temp.t_vede() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; v jsonb := '{}'::jsonb; n1 bigint; n2 bigint; n3 bigint;
BEGIN
  FOR r IN SELECT * FROM pg_temp.t_tabele() LOOP
    EXECUTE format('SELECT count(*) FILTER (WHERE %1$I = ANY ($1)), count(*) FILTER (WHERE %1$I = ANY ($2)), count(*) FILTER (WHERE %1$I = ANY ($3)) FROM public.%2$I',
                   r.coloana, r.tabel)
      INTO n1, n2, n3 USING pg_temp.t_ids(r.tip, 1), pg_temp.t_ids(r.tip, 2), pg_temp.t_ids(r.tip, 3);
    v := v || jsonb_build_object(r.tabel, jsonb_build_array(n1, n2, n3));
  END LOOP;
  IF to_regclass('public.v_executie_dashboard') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FILTER (WHERE id = $1), count(*) FILTER (WHERE id = $2), count(*) FILTER (WHERE id = $3) FROM public.v_executie_dashboard'
      INTO n1, n2, n3 USING pg_temp.t_g('p1')::bigint, pg_temp.t_g('p2')::bigint, pg_temp.t_g('p3')::bigint;
    v := v || jsonb_build_object('v_executie_dashboard', jsonb_build_array(n1, n2, n3));
  END IF;
  RETURN v;
END $h$;
-- o cale SECURITY DEFINER (ca RPC-urile vechi fn_bon_* / fn_completare_aplica): ocolește RLS, dar NU trigger-ul de gardă
CREATE FUNCTION pg_temp.t_definer_unitate(p_proiect bigint) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $h$
DECLARE v bigint;
BEGIN
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p_proiect, 'tronson', 'T-ACC-DEF', 'Unitate test acces (definer)', 990, true)
  RETURNING id INTO v;
  RETURN v;
END $h$;
-- plpgsql (nu sql): RPC-ul apare abia după migrare, corpul nu se validează la creare
CREATE FUNCTION pg_temp.t_seteaza(p_profil text, p_restrans boolean, p_lista jsonb, p_veche jsonb) RETURNS jsonb LANGUAGE plpgsql AS $h$
BEGIN
  RETURN public.fn_executie_acces_proiect_seteaza(pg_temp.t_g(p_profil)::uuid, p_restrans, p_lista, p_veche);
END $h$;
-- lista [{proiect_id, nivel}] cu proiectele tranzacției: t_lista('p1:editor,p2:viewer')
CREATE FUNCTION pg_temp.t_lista(p text) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', pg_temp.t_g(split_part(e, ':', 1))::bigint, 'nivel', split_part(e, ':', 2))), '[]'::jsonb)
    FROM unnest(string_to_array(nullif(p, ''), ',')) e
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_g(text), pg_temp.t_stare(text), pg_temp.t_garda(text), pg_temp.t_trece_garda(text),
  pg_temp.t_tabele(), pg_temp.t_ids(text, integer), pg_temp.t_vede(), pg_temp.t_definer_unitate(bigint), pg_temp.t_seteaza(text, boolean, jsonb, jsonb),
  pg_temp.t_lista(text)
  TO authenticated, anon, service_role;

-- ── T0: identități, drepturi rescrise în tranzacție, date fictive (ca postgres) ──
DO $t$
DECLARE own uuid; ids uuid[]; pr bigint[]; v_cols text; p3 bigint; n integer; u1 bigint; u3 bigint; s1 bigint; s3 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) x;
  SELECT array_agg(id ORDER BY id) INTO pr FROM (SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 3) x;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR coalesce(array_length(pr, 1), 0) < 2 THEN
    RAISE EXCEPTION 'T0 FAIL: identități / proiecte insuficiente';
  END IF;
  IF array_length(pr, 1) = 2 THEN
    -- al treilea proiect, copiat din primul (coloanele generate / identitate le pune serverul; codul și numele = fictive)
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name <> 'id'
       AND is_identity = 'NO' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO public.executie_proiecte (%s) SELECT %s FROM public.executie_proiecte WHERE id = $1 RETURNING id', v_cols, v_cols)
      INTO p3 USING pr[1];
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'cod_intern') THEN
      EXECUTE 'UPDATE public.executie_proiecte SET cod_intern = ''TEST-ACCES-3'' WHERE id = $1' USING p3;
    END IF;
    pr := pr || p3;
  END IF;
  PERFORM set_config('tacc.own', own::text, true);
  PERFORM set_config('tacc.a', ids[1]::text, true);
  PERFORM set_config('tacc.b', ids[2]::text, true);
  PERFORM set_config('tacc.c', ids[3]::text, true);
  FOR n IN 1..3 LOOP
    PERFORM set_config('tacc.p' || n, pr[n]::text, true);
    PERFORM set_config('tacc.sl' || n, coalesce((SELECT array_agg(id ORDER BY id) FROM public.executie_situatii_plata WHERE proiect_id = pr[n]), '{}')::text, true);
    PERFORM set_config('tacc.bon' || n, coalesce((SELECT array_agg(id ORDER BY id) FROM public.executie_bonuri_consum WHERE proiect_id = pr[n]), '{}')::text, true);
  END LOOP;
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ids[1], 'executie', 'editor'), (ids[2], 'executie', 'editor'), (ids[3], 'executie', 'viewer');
  -- date fictive pe p1 și p3: unități (tabel vechi) + o sudură pe nod (tabel nou, 20261201a)
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (pr[1], 'tronson', 'T-ACC1', 'Unitate test acces 1', 991, true) RETURNING id INTO u1;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (pr[3], 'tronson', 'T-ACC3', 'Unitate test acces 3', 991, true) RETURNING id INTO u3;
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (pr[1], 'NOD-TEST-ACCES', 'TA-1') RETURNING id INTO s1;
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (pr[3], 'NOD-TEST-ACCES', 'TA-3') RETURNING id INTO s3;
  PERFORM set_config('tacc.u1', u1::text, true); PERFORM set_config('tacc.u3', u3::text, true);
  PERFORM set_config('tacc.s1', s1::text, true); PERFORM set_config('tacc.s3', s3::text, true);
  RAISE NOTICE 'T0 OK (proiecte %, SL pe p3: %, bonuri pe p3: %)', pr, pg_temp.t_g('sl3'), pg_temp.t_g('bon3');
END $t$;

-- ── TB: vizibilitatea ÎNAINTE de migrare, ca fiecare cont (RLS-ul de azi) ──
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT set_config('tacc.va0', pg_temp.t_vede()::text, true);
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT set_config('tacc.vb0', pg_temp.t_vede()::text, true);
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT set_config('tacc.vc0', pg_temp.t_vede()::text, true);
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('tacc.pol0', (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), ''))
                                  FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT tabel FROM pg_temp.t_tabele())), true);

SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql

-- ── T1: după migrare, fără niciun rând = comportamentul de azi (aceeași vizibilitate pentru toți); politicile vechi neatinse ──
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN RAISE EXCEPTION 'T1 FAIL: tabelul nou are date'; END IF;
  IF (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), ''))
        FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT tabel FROM pg_temp.t_tabele()) AND policyname NOT LIKE 'executie\_acces\_%') IS DISTINCT FROM pg_temp.t_g('pol0') THEN
    RAISE EXCEPTION 'T1 FAIL: politicile vechi ale tabelelor acoperite s-au schimbat';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('va0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: A vede altceva după migrare: % vs %', pg_temp.t_vede(), pg_temp.t_g('va0'); END IF;
  IF NOT public.fn_executie_acces_nerestrans() OR NOT public.fn_executie_proiect_permis(pg_temp.t_g('p3')::bigint, true) THEN RAISE EXCEPTION 'T1 FAIL: A nu e nerestrâns'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('vb0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: B vede altceva după migrare (fără rânduri)'; END IF;
  RAISE NOTICE 'T1 OK';
END $t$;

-- ── T2: owner-ul restrânge B (p1 editor + p2 viewer) și C (p1 editor) prin RPC ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:editor,p2:viewer'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'duplicat' IS DISTINCT FROM 'false' OR jsonb_array_length(r->'lista') <> 2 THEN RAISE EXCEPTION 'T2 FAIL: setarea B: %', r; END IF;
  r := pg_temp.t_seteaza('c', true, pg_temp.t_lista('p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T2 FAIL: setarea C: %', r; END IF;
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 3
     OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE acordat_de IS DISTINCT FROM pg_temp.t_g('own')::uuid) THEN
    RAISE EXCEPTION 'T2 FAIL: rândurile / proveniența';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- ── T3: B citește doar p1 + p2 (exact ce vedea înainte pe ele) și nimic pe p3; scrie doar pe p1, pe toate căile ──
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('vb0')::jsonb; k text;
  p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint; p3 bigint := pg_temp.t_g('p3')::bigint; r record; x bigint;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k->0 IS DISTINCT FROM v0->k->0 OR v->k->1 IS DISTINCT FROM v0->k->1 OR (v->k->>2)::bigint <> 0 THEN
      RAISE EXCEPTION 'T3 FAIL: citire pe %: după % / înainte %', k, v->k, v0->k;
    END IF;
  END LOOP;
  IF public.fn_executie_acces_nerestrans() OR public.fn_executie_acces_lista(false) <> ARRAY[p1, p2] OR public.fn_executie_acces_lista(true) <> ARRAY[p1]
     OR NOT public.fn_executie_proiect_permis(p1, true) OR public.fn_executie_proiect_permis(p2, true) OR NOT public.fn_executie_proiect_permis(p2)
     OR public.fn_executie_proiect_permis(p3) OR public.fn_executie_proiect_permis(NULL) THEN
    RAISE EXCEPTION 'T3 FAIL: regula (nerestrans / lista / permis)';
  END IF;
  -- funcțiile de drept ale tabelelor noi (RLS + RPC + Storage le folosesc)
  IF NOT public.fn_executie_nod_drept(p1, true) OR public.fn_executie_nod_drept(p2, true) OR NOT public.fn_executie_nod_drept(p2, false)
     OR public.fn_executie_nod_drept(p3, false)
     OR NOT public.fn_executie_contract_drept(p1, false) OR public.fn_executie_contract_drept(p3, false)
     OR NOT public.fn_executie_grafic_drept(p1) OR public.fn_executie_grafic_drept(p3)
     OR NOT public.fn_executie_tinte_drept(p1, 'configurare') OR public.fn_executie_tinte_drept(p2, 'configurare')
     OR NOT public.fn_executie_tinte_drept(p2, 'citire') OR public.fn_executie_tinte_drept(p3, 'citire') THEN
    RAISE EXCEPTION 'T3 FAIL: funcțiile de drept';
  END IF;
  IF public.fn_executie_nod_obiect_citire('noduri-scheme', p3 || '/NOD-TEST-ACCES/vederi.json')
     OR NOT public.fn_executie_nod_obiect_citire('noduri-scheme', p1 || '/NOD-TEST-ACCES/vederi.json') THEN
    RAISE EXCEPTION 'T3 FAIL: Storage noduri-scheme';
  END IF;
  IF (SELECT count(*) FROM public.executie_noduri_suduri WHERE nod_cod = 'NOD-TEST-ACCES') <> 1 THEN RAISE EXCEPTION 'T3 FAIL: sudurile vizibile'; END IF;
  -- scriere directă (REST): p3 și p2 (viewer) = refuzul gărzii; p1 = garda trece (restul decid constrângerile / politicile vechi)
  FOR r IN SELECT * FROM pg_temp.t_tabele() WHERE tabel <> 'executie_proiecte' LOOP
    IF r.tip = 'p' THEN
      IF NOT pg_temp.t_garda(format('INSERT INTO public.%I (%I) VALUES (%s)', r.tabel, r.coloana, p3))
         OR NOT pg_temp.t_garda(format('INSERT INTO public.%I (%I) VALUES (%s)', r.tabel, r.coloana, p2))
         OR NOT pg_temp.t_trece_garda(format('INSERT INTO public.%I (%I) VALUES (%s)', r.tabel, r.coloana, p1)) THEN
        RAISE EXCEPTION 'T3 FAIL: garda de scriere pe %', r.tabel;
      END IF;
    ELSE
      -- un părinte inexistent nu e „al nimănui”: pentru un cont restrâns e refuz
      IF NOT pg_temp.t_garda(format('INSERT INTO public.%I (%I) VALUES (-1)', r.tabel, r.coloana)) THEN RAISE EXCEPTION 'T3 FAIL: garda pe % (părinte inexistent)', r.tabel; END IF;
      FOREACH x IN ARRAY pg_temp.t_ids(r.tip, 3) LOOP
        IF NOT pg_temp.t_garda(format('INSERT INTO public.%I (%I) VALUES (%s)', r.tabel, r.coloana, x)) THEN RAISE EXCEPTION 'T3 FAIL: garda pe % (părinte pe p3)', r.tabel; END IF;
        EXIT;
      END LOOP;
      FOREACH x IN ARRAY pg_temp.t_ids(r.tip, 1) LOOP
        IF NOT pg_temp.t_trece_garda(format('INSERT INTO public.%I (%I) VALUES (%s)', r.tabel, r.coloana, x)) THEN RAISE EXCEPTION 'T3 FAIL: garda pe % (părinte pe p1)', r.tabel; END IF;
        EXIT;
      END LOOP;
    END IF;
  END LOOP;
  -- mutarea unui rând pe alt proiect, modificarea pe p1, ștergerea pe p3 (invizibil = 0 rânduri)
  IF NOT pg_temp.t_garda(format('UPDATE public.proiect_unitati SET proiect_id = %s WHERE id = %s', p3, pg_temp.t_g('u1')))
     OR pg_temp.t_stare(format('UPDATE public.proiect_unitati SET nume = nume || %L WHERE id = %s', ' ', pg_temp.t_g('u1'))) <> 'OK 1'
     OR pg_temp.t_stare(format('DELETE FROM public.proiect_unitati WHERE id = %s', pg_temp.t_g('u3'))) <> 'OK 0'
     OR pg_temp.t_stare(format('DELETE FROM public.executie_proiecte WHERE id = %s', p3)) <> 'OK 0' THEN
    RAISE EXCEPTION 'T3 FAIL: UPDATE / DELETE direct';
  END IF;
  -- calea SECURITY DEFINER (ocolește RLS): trigger-ul o oprește pe p3; pe p1 trece (1/0 anulează rândul)
  IF NOT pg_temp.t_garda(format('SELECT pg_temp.t_definer_unitate(%s)', p3))
     OR pg_temp.t_stare(format('SELECT pg_temp.t_definer_unitate(%s) / 0', p1)) NOT LIKE '22012 %' THEN
    RAISE EXCEPTION 'T3 FAIL: calea DEFINER';
  END IF;
  -- RPC-ul de stare al sudurii (20261201a): p3 refuz, p1 trece
  IF pg_temp.t_stare(format('SELECT public.fn_executie_nod_sudura_stare(%s, %L, 1, %L, (now() AT TIME ZONE %L)::date, %L, NULL, NULL, gen_random_uuid())',
                            pg_temp.t_g('s3'), 'de_executat', 'insailat', 'Europe/Bucharest', 'Sudor Test')) NOT LIKE '42501 %'
     OR pg_temp.t_stare(format('SELECT public.fn_executie_nod_sudura_stare(%s, %L, 1, %L, (now() AT TIME ZONE %L)::date, %L, NULL, NULL, gen_random_uuid())',
                               pg_temp.t_g('s1'), 'de_executat', 'insailat', 'Europe/Bucharest', 'Sudor Test')) <> 'OK 1' THEN
    RAISE EXCEPTION 'T3 FAIL: RPC-ul sudurii';
  END IF;
  -- tabelul de acces: B vede doar rândurile lui; nu poate seta nimic
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 2 OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id <> auth.uid())
     OR pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, true, pg_temp.t_lista(%L), pg_temp.t_lista(%L))', 'b', 'p1:editor,p2:editor,p3:editor', 'p1:editor,p2:viewer')) NOT LIKE '42501 %'
     OR pg_temp.t_stare(format('INSERT INTO public.executie_acces_proiect (profile_id, proiect_id) VALUES (auth.uid(), %s)', p3)) NOT LIKE '42501 %' THEN
    RAISE EXCEPTION 'T3 FAIL: tabelul de acces (citire / setare de către non-owner)';
  END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- ── T4: C (modul viewer, restrâns pe p1 editor): proiectul nu ridică dreptul de modul; A tot nerestrâns; A nu vede rândurile altora ──
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('vc0')::jsonb; k text; p1 bigint := pg_temp.t_g('p1')::bigint;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k->0 IS DISTINCT FROM v0->k->0 OR (v->k->>1)::bigint <> 0 OR (v->k->>2)::bigint <> 0 THEN RAISE EXCEPTION 'T4 FAIL: citire C pe %', k; END IF;
  END LOOP;
  IF NOT public.fn_executie_proiect_permis(p1, true) OR public.fn_executie_nod_drept(p1, true) OR NOT public.fn_executie_nod_drept(p1, false)
     OR public.fn_executie_tinte_drept(p1, 'configurare') THEN
    RAISE EXCEPTION 'T4 FAIL: C (modul viewer) a primit scriere prin proiect';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('va0')::jsonb OR EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION 'T4 FAIL: A (nerestrâns) afectat / vede rândurile altora';
  END IF;
  RAISE NOTICE 'T4 OK';
END $t$;

-- ── T5: RPC-ul de setare: refuzuri, CAS, idempotență, scoaterea restricției ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; acum jsonb := pg_temp.t_lista('p1:editor,p2:viewer'); s text;
BEGIN
  -- lista goală cu restricție = refuz (ar însemna „vede tot”)
  IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, true, %L::jsonb, %L::jsonb)', 'b', '[]', acum)) NOT LIKE '22023 %lista goală%' THEN RAISE EXCEPTION 'T5 FAIL: lista goală'; END IF;
  IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, false, %L::jsonb, %L::jsonb)', 'b', pg_temp.t_lista('p1:editor'), acum)) NOT LIKE '22023 %' THEN RAISE EXCEPTION 'T5 FAIL: scoate restricția cu proiecte'; END IF;
  -- elemente invalide (L13 / L21): id text, cheie în plus, nivel necunoscut, dublură, proiect inexistent, null
  FOR s IN SELECT unnest(ARRAY[
      format('[{"proiect_id":"%s","nivel":"editor"}]', pg_temp.t_g('p1')),
      format('[{"proiect_id":%s,"nivel":"editor","x":1}]', pg_temp.t_g('p1')),
      format('[{"proiect_id":%s,"nivel":"admin"}]', pg_temp.t_g('p1')),
      format('[{"proiect_id":%s,"nivel":"editor"},{"proiect_id":%s,"nivel":"viewer"}]', pg_temp.t_g('p1'), pg_temp.t_g('p1')),
      format('[{"proiect_id":%s,"nivel":"editor"}]', (SELECT max(id) + 1000 FROM public.executie_proiecte)),
      format('[{"proiect_id":%s.5,"nivel":"editor"}]', pg_temp.t_g('p1')),
      '[{"proiect_id":0,"nivel":"editor"}]', '{"proiect_id":1}', '[null]']) LOOP
    IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, true, %L::jsonb, %L::jsonb)', 'b', s, acum)) NOT LIKE '22023 %' THEN RAISE EXCEPTION 'T5 FAIL: element invalid acceptat: %', s; END IF;
  END LOOP;
  IF pg_temp.t_stare(format('SELECT public.fn_executie_acces_proiect_seteaza(%L::uuid, true, %L::jsonb, %L::jsonb)', pg_temp.t_g('own'), pg_temp.t_lista('p1:editor'), '[]')) NOT LIKE '22023 %owner%'
     OR pg_temp.t_stare(format('SELECT public.fn_executie_acces_proiect_seteaza(gen_random_uuid(), true, %L::jsonb, %L::jsonb)', pg_temp.t_lista('p1:editor'), '[]')) NOT LIKE '22023 %nu există%' THEN
    RAISE EXCEPTION 'T5 FAIL: ținta owner / cont inexistent';
  END IF;
  -- CAS: owner-ul pornește de la o listă veche = conflict, nimic scris
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'motiv' IS DISTINCT FROM 'conflict' OR (SELECT count(*) FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid) <> 2 THEN
    RAISE EXCEPTION 'T5 FAIL: CAS %', r;
  END IF;
  -- idempotență: starea cerută există deja = duplicat (chiar cu lista veche depășită: reluarea unei cereri reușite)
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p2:viewer,p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'duplicat' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T5 FAIL: idempotență %', r; END IF;
  -- schimbare: p2 iese, p1 devine viewer, p3 intră
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:viewer,p3:editor'), acum);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->'lista' IS DISTINCT FROM pg_temp.t_lista('p1:viewer,p3:editor')
     OR (SELECT array_agg(proiect_id || ':' || nivel ORDER BY proiect_id) FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid)
        IS DISTINCT FROM ARRAY[pg_temp.t_g('p1') || ':viewer', pg_temp.t_g('p3') || ':editor'] THEN
    RAISE EXCEPTION 'T5 FAIL: schimbarea %', r;
  END IF;
  -- scrierea directă e închisă și pentru owner (doar RPC-ul scrie)
  IF pg_temp.t_stare(format('INSERT INTO public.executie_acces_proiect (profile_id, proiect_id) VALUES (%L, %s)', pg_temp.t_g('a'), pg_temp.t_g('p1'))) NOT LIKE '42501 %'
     OR pg_temp.t_stare(format('DELETE FROM public.executie_acces_proiect WHERE profile_id = %L', pg_temp.t_g('b'))) NOT LIKE '42501 %' THEN
    RAISE EXCEPTION 'T5 FAIL: scriere directă în tabelul de acces';
  END IF;
  -- scoaterea restricției: explicit, cu lista văzută
  r := pg_temp.t_seteaza('b', false, '[]'::jsonb, pg_temp.t_lista('p1:viewer,p3:editor'));
  IF r->>'ok' IS DISTINCT FROM 'true' OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid) THEN RAISE EXCEPTION 'T5 FAIL: scoate restricția %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('vb0')::jsonb; k text;
BEGIN
  -- B nerestrâns din nou: vede ce vedea înainte (minus unitatea fictivă de pe p1 adăugată prin calea DEFINER în T3)
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF k <> 'proiect_unitati' AND v->k IS DISTINCT FROM v0->k THEN RAISE EXCEPTION 'T5 FAIL: B după scoaterea restricției, pe %', k; END IF;
  END LOOP;
  IF (v->'proiect_unitati'->>2)::bigint IS DISTINCT FROM (v0->'proiect_unitati'->>2)::bigint THEN RAISE EXCEPTION 'T5 FAIL: B nu mai vede p3'; END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- ── T6: FK RESTRICT — un proiect cu conturi restrânse pe el nu se șterge (lista nu se golește pe tăcute) ──
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT array_agg(confdeltype::text) FROM pg_constraint WHERE conrelid = 'public.executie_acces_proiect'::regclass AND contype = 'f'
        AND confrelid = 'public.executie_proiecte'::regclass) IS DISTINCT FROM ARRAY['r']
     OR pg_temp.t_stare(format('DELETE FROM public.executie_proiecte WHERE id = %s', pg_temp.t_g('p1'))) NOT LIKE '23503 %' THEN
    RAISE EXCEPTION 'T6 FAIL: ștergerea proiectului cu restricții';
  END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- ── T7: revenirea — nearmată = refuz; armată cu un cont restrâns (C) = refuz; nimic atins ──
SAVEPOINT t7a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
\set t7a_eroare :ERROR
\set t7a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7a;
SELECT pg_temp.t_eroare('T7a', :'t7a_eroare', :'t7a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t7b;
SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
\set t7b_eroare :ERROR
\set t7b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7b;
SELECT pg_temp.t_eroare('T7b', :'t7b_eroare', :'t7b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'exista conturi restranse');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 1 OR to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') <> 22 THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- ── T8: owner-ul scoate restricția lui C; revenirea armată scoate tot și redă corpurile vechi; vizibilitatea = cea de dinainte; re-aplicarea merge ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
SELECT pg_temp.t_seteaza('c', false, '[]'::jsonb, pg_temp.t_lista('p1:editor'));
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda')
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_executie_nod_drept(bigint, boolean)'::regprocedure), chr(13), '')) <> '144649bae9a218b41b7e6df90cba5d9e'
     OR (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), ''))
           FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT tabel FROM pg_temp.t_tabele())) IS DISTINCT FROM pg_temp.t_g('pol0') THEN
    RAISE EXCEPTION 'T8 FAIL: după revenire';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('vc0')::jsonb THEN RAISE EXCEPTION 'T8 FAIL: C după revenire vede altceva decât înainte'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NULL OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') <> 22 THEN
    RAISE EXCEPTION 'T8 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T8 OK — toate testele 20261209a au trecut';
END $t$;
ROLLBACK;
