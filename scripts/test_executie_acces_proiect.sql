-- Harness 20261209a_executie_acces_proiect (r2) — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_acces_proiect.sql
-- Precondiție: 20261201a, 20261203a, 20261204a, 20261208a aplicate pe clonă (migrarea le cere).
-- O singură tranzacție, ANULATĂ la final (ROLLBACK).
-- Oracolul independent (L25):
--   * LISTA testată vine din CATALOG (scripts/executie_acces_catalog.sql: FK tranzitiv din executie_proiecte + coloane proiect_id), nu din
--     migrare; din inventarul migrării se ia doar CLASA pretinsă (citită într-un savepoint anulat), iar orice tabel din catalog fără clasă = FAIL;
--   * PROIECTUL fiecărui rând = expresia derivată din FK-uri (t_cat_proiect_expr), nu coloana declarată de migrare;
--   * CE VEDEA și CE PUTEA SCRIE fiecare cont ÎNAINTE de migrare (prin RLS-ul existent): după migrare, nerestrânșii văd identic; contul
--     restrâns vede identic pe proiectele lui și ZERO pe al treilea, iar o scriere care reușea înainte pe un proiect permis TREBUIE să
--     reușească și după (rândul scris efectiv, apoi anulat), nu „orice altă eroare e ok”.
-- NU presupune date reale: ia primul owner, primele 3 profiluri non-owner și cele 3 proiecte cu cele mai multe tabele acoperite cu date
-- (dacă clona are doar 2, al treilea se creează în tranzacție), le leagă DOAR în tranzacție și scrie date FICTIVE (unități T-ACC*, nodul
-- NOD-TEST-ACCES, șantiere / rapoarte pe 2001-01-01, mesajul TEST-ACCES-1).
-- Identități: A = Execuție editor, NErestrâns; B = Execuție editor, restrâns pe p1 (editor) + p2 (viewer); C = Execuție viewer, restrâns pe p1 (editor).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION). Ce nu se poate proba pe datele clonei
-- (tabel fără rânduri pe p1 / p3, scriere oprită și înainte de o regulă veche) apare ca NOTICE „neprobat”, cu numele, la final.
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
\ir executie_acces_catalog.sql

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
-- rezultatul unei instrucțiuni, SCRISĂ EFECTIV apoi anulată (subtranzacție): 'OK <rânduri>' sau '<SQLSTATE> <mesaj>'
CREATE FUNCTION pg_temp.t_proba(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE n integer; r text;
BEGIN
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
    r := 'OK ' || n;
    RAISE EXCEPTION USING ERRCODE = 'TACC0', MESSAGE = r;
  EXCEPTION WHEN SQLSTATE 'TACC0' THEN RETURN r;
            WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
  END;
END $h$;
-- aceeași probă pe o cale SECURITY DEFINER (ca RPC-urile vechi: ocolește RLS, dar NU trigger-ul de gardă)
CREATE FUNCTION pg_temp.t_proba_definer(p_sql text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $h$
BEGIN RETURN pg_temp.t_proba(p_sql); END $h$;
-- o instrucțiune care RĂMÂNE scrisă (în tranzacția harness-ului): 'OK <rânduri>' sau eroarea
CREATE FUNCTION pg_temp.t_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN 'OK ' || n;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
CREATE FUNCTION pg_temp.t_e_garda(p_rez text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $h$
  SELECT p_rez LIKE '42501 %nu ai drept de scriere pe acest proiect%'
$h$;
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
CREATE FUNCTION pg_temp.t_neprobat(p text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  PERFORM set_config('tacc.neprobat', coalesce(pg_temp.t_g('neprobat') || '; ', '') || p, true);
END $h$;
-- plpgsql (nu sql): RPC-ul apare abia după migrare, corpul nu se validează la creare
CREATE FUNCTION pg_temp.t_seteaza(p_profil text, p_restrans boolean, p_lista jsonb, p_veche jsonb) RETURNS jsonb LANGUAGE plpgsql AS $h$
BEGIN
  RETURN public.fn_executie_acces_proiect_seteaza(pg_temp.t_g(p_profil)::uuid, p_restrans, p_lista, p_veche);
END $h$;
CREATE FUNCTION pg_temp.t_lista(p text) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', pg_temp.t_g(split_part(e, ':', 1))::bigint, 'nivel', split_part(e, ':', 2))), '[]'::jsonb)
    FROM unnest(string_to_array(nullif(p, ''), ',')) e
$h$;

-- ── T0a: inventarul pretins de migrare (clasa fiecărui obiect), citit într-un savepoint ANULAT ──
SAVEPOINT t_inv;
SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql
SELECT (SELECT json_agg(i)::text FROM public.fn_executie_acces_inventar() i) AS t_inv_json
\gset
ROLLBACK TO SAVEPOINT t_inv;
CREATE TEMP TABLE t_inv AS SELECT * FROM json_to_recordset(:'t_inv_json'::json) AS x(tip text, obiect text, clasa text, cheie text, parinte text, motiv text);
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL OR (SELECT count(*) FROM t_inv) < 50 THEN
    RAISE EXCEPTION 'T0a FAIL: savepoint-ul nu a anulat migrarea sau inventarul e gol';
  END IF;
END $t$;

-- ── T0b: lista testată, din CATALOG ──
-- t_tab: fiecare tabel din catalog (oprire la cele declarate excluse) + tabelele acoperite din inventar; clasa = cea pretinsă
CREATE TEMP TABLE t_tab AS
  SELECT DISTINCT ON (c.rel) c.rel, c.nume, c.e_public,
         coalesce((SELECT i.clasa FROM t_inv i WHERE i.tip = 'tabel' AND i.obiect = c.nume AND c.e_public),
                  (SELECT 'exclus' FROM t_inv i WHERE i.tip = 'prefix_tabel' AND starts_with(c.nume, i.obiect) AND c.e_public LIMIT 1)) AS clasa,
         pg_temp.t_cat_proiect_expr(c.rel) AS expr, NULL::text AS col_upd, NULL::text AS col_ins
    FROM (SELECT t.rel, t.nume, t.e_public FROM pg_temp.t_cat_tabele(
                   ARRAY(SELECT obiect FROM t_inv WHERE tip = 'tabel' AND clasa = 'exclus'),
                   ARRAY(SELECT obiect FROM t_inv WHERE tip = 'prefix_tabel')) t
          UNION SELECT to_regclass('public.' || i.obiect)::oid, i.obiect, true FROM t_inv i
                 WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'copil', 'drept') AND to_regclass('public.' || i.obiect) IS NOT NULL) c
   ORDER BY c.rel;
DO $t$
DECLARE v text;
BEGIN
  SELECT string_agg(nume, ', ' ORDER BY nume) INTO v FROM t_tab WHERE clasa IS NULL;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'T0b FAIL: tabele legate de proiecte, fără clasă în inventar: %', v; END IF;
  SELECT string_agg(nume, ', ' ORDER BY nume) INTO v FROM t_tab WHERE clasa IN ('proiect', 'copil', 'drept') AND expr IS NULL;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'T0b FAIL: nu pot deriva proiectul rândurilor din FK-uri pentru: %', v; END IF;
  -- coloana pentru scrierea „fără efect” (prima coloană obișnuită) și coloana-cheie a INSERT-ului (cea din expresie, nivelul de sus)
  UPDATE t_tab SET col_upd = (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = t_tab.rel AND a.attnum > 0 AND NOT a.attisdropped
                                AND a.attidentity = '' AND a.attgenerated = '' ORDER BY a.attnum LIMIT 1),
                   col_ins = coalesce(substring(expr FROM '^t\.([a-z_][a-z_0-9]*)$'), substring(expr FROM 'WHERE x1\.[a-z_0-9]+ = t\.([a-z_][a-z_0-9]*)\)$'))
   WHERE clasa IN ('proiect', 'copil', 'drept');
  RAISE NOTICE 'T0b OK (% tabele din catalog: % acoperite, % cu funcție de drept, % excluse)', (SELECT count(*) FROM t_tab),
    (SELECT count(*) FROM t_tab WHERE clasa IN ('proiect', 'copil')), (SELECT count(*) FROM t_tab WHERE clasa = 'drept'), (SELECT count(*) FROM t_tab WHERE clasa = 'exclus');
END $t$;
GRANT SELECT ON t_inv, t_tab TO authenticated, anon, service_role;

-- ── T0c: identități, proiecte, drepturi rescrise în tranzacție, date fictive (ca postgres) ──
CREATE TEMP TABLE t_most (tabel text, n integer, ctid_txt text, val_ins text, PRIMARY KEY (tabel, n));
GRANT SELECT ON t_most TO authenticated, anon, service_role;
DO $t$
DECLARE own uuid; ids uuid[]; pr bigint[]; v_cols text; p3 bigint; n integer; r record; v_ct text; v_val text;
  u1 bigint; u3 bigint; s1 bigint; s3 bigint; si1 bigint; si3 bigint; a1 bigint; d1 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) q;
  -- proiectele: cele mai multe tabele acoperite cu date (ca testul să aibă rânduri de comparat), apoi după id
  CREATE TEMP TABLE t_acop (proiect bigint, tabel text) ON COMMIT DROP;
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'copil', 'drept') LOOP
    EXECUTE format('INSERT INTO t_acop SELECT DISTINCT (%s)::bigint, %L FROM %s t WHERE (%s) IS NOT NULL', r.expr, r.nume, r.rel::regclass, r.expr);
  END LOOP;
  SELECT array_agg(id ORDER BY k DESC, id) INTO pr FROM (
    SELECT e.id, (SELECT count(DISTINCT a.tabel) FROM t_acop a WHERE a.proiect = e.id) AS k FROM public.executie_proiecte e
     ORDER BY 2 DESC, 1 LIMIT 3) q;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR coalesce(array_length(pr, 1), 0) < 2 THEN
    RAISE EXCEPTION 'T0 FAIL: identități / proiecte insuficiente';
  END IF;
  IF array_length(pr, 1) = 2 THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name <> 'id' AND is_identity = 'NO' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO public.executie_proiecte (%s) SELECT %s FROM public.executie_proiecte WHERE id = $1 RETURNING id', v_cols, v_cols)
      INTO p3 USING pr[1];
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'cod_intern') THEN
      EXECUTE 'UPDATE public.executie_proiecte SET cod_intern = ''TEST-ACCES-3'' WHERE id = $1' USING p3;
    END IF;
    pr := pr || p3;
  END IF;
  -- ordinea: p1 = cel mai acoperit, p3 = al doilea (ambele cu date), p2 = al treilea
  pr := ARRAY[pr[1], pr[3], pr[2]];
  PERFORM set_config('tacc.own', own::text, true);
  PERFORM set_config('tacc.a', ids[1]::text, true);
  PERFORM set_config('tacc.b', ids[2]::text, true);
  PERFORM set_config('tacc.c', ids[3]::text, true);
  FOR n IN 1..3 LOOP PERFORM set_config('tacc.p' || n, pr[n]::text, true); END LOOP;
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ids[1], 'executie', 'editor'), (ids[2], 'executie', 'editor'), (ids[3], 'executie', 'viewer');
  -- date fictive: unități (tabel vechi) + o sudură pe nod (tabel nou, 20261201a) pe p1 și p3
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (pr[1], 'tronson', 'T-ACC1', 'Unitate test acces 1', 991, true) RETURNING id INTO u1;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (pr[3], 'tronson', 'T-ACC3', 'Unitate test acces 3', 991, true) RETURNING id INTO u3;
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (pr[1], 'NOD-TEST-ACCES', 'TA-1') RETURNING id INTO s1;
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (pr[3], 'NOD-TEST-ACCES', 'TA-3') RETURNING id INTO s3;
  PERFORM set_config('tacc.u1', u1::text, true); PERFORM set_config('tacc.u3', u3::text, true);
  PERFORM set_config('tacc.s1', s1::text, true); PERFORM set_config('tacc.s3', s3::text, true);
  -- raportul zilnic: un șantier pe p1 și unul pe p3 (cele existente sau copii fictive), B șef pe amândouă; o activitate „raport” pe p1
  FOR n IN 1..2 LOOP
    SELECT id INTO si1 FROM public.sites WHERE proiect_id = pr[CASE n WHEN 1 THEN 1 ELSE 3 END] ORDER BY id LIMIT 1;
    IF si1 IS NULL THEN
      SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sites' AND column_name NOT IN ('id', 'proiect_id') AND is_identity = 'NO' AND is_generated = 'NEVER';
      EXECUTE format('INSERT INTO public.sites (%s, proiect_id) SELECT %s, $1 FROM public.sites ORDER BY id LIMIT 1 RETURNING id', v_cols, v_cols)
        INTO si1 USING pr[CASE n WHEN 1 THEN 1 ELSE 3 END];
    END IF;
    PERFORM set_config('tacc.site' || CASE n WHEN 1 THEN 1 ELSE 3 END, si1::text, true);
    INSERT INTO public.profile_sites (profile_id, site_id, valid_until) VALUES (ids[2], si1, NULL) ON CONFLICT DO NOTHING;
    UPDATE public.profile_sites SET valid_until = NULL WHERE profile_id = ids[2] AND site_id = si1;
    si1 := NULL;
  END LOOP;
  SELECT id INTO a1 FROM public.proiect_activitati WHERE proiect_id = pr[1] AND coalesce(tip_raportare, 'cantitate') <> 'bifa' AND sursa_executat = 'raport' ORDER BY id LIMIT 1;
  IF a1 IS NULL THEN
    INSERT INTO public.proiect_activitati (proiect_id, nume, um, activ) VALUES (pr[1], 'Activitate test acces', 'm', true) RETURNING id INTO a1;
  END IF;
  PERFORM set_config('tacc.a1', a1::text, true);
  -- coada de repartizat: un mesaj fictiv cu candidați p1 + p3 (etichetele fictive doar dacă lipsesc)
  UPDATE public.executie_proiecte SET eticheta_gmail = 'test-acces-' || id WHERE id IN (pr[1], pr[3]) AND eticheta_gmail IS NULL;
  INSERT INTO public.documente_de_repartizat (gmail_message_id, nume_fisier, storage_path, candidati)
  SELECT 'TEST-ACCES-1', 'test.pdf', '_de_repartizat/test/test.pdf', ARRAY[(SELECT eticheta_gmail FROM public.executie_proiecte WHERE id = pr[1]),
                                                                          (SELECT eticheta_gmail FROM public.executie_proiecte WHERE id = pr[3])]
  RETURNING id INTO d1;
  PERFORM set_config('tacc.d1', d1::text, true);
  -- proiectul FIECĂRUI rând al lui p1 / p2 / p3, calculat ca postgres (fără RLS: altfel un părinte ascuns ar ascunde și un copil vizibil,
  -- adică exact scurgerea căutată), legat de rând prin ctid (stabil în tranzacție: DDL-ul migrării nu rescrie tabelele)
  CREATE TEMP TABLE t_rand (tabel text, ct tid, n integer);
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'copil', 'drept') LOOP
    EXECUTE format('INSERT INTO t_rand SELECT %L, t.ctid, CASE (%s)::bigint WHEN $1 THEN 1 WHEN $2 THEN 2 WHEN $3 THEN 3 END FROM %s t WHERE (%s)::bigint IN ($1, $2, $3)',
                   r.nume, r.expr, r.rel::regclass, r.expr) USING pr[1], pr[2], pr[3];
  END LOOP;
  CREATE INDEX ON t_rand (tabel, ct);
  -- mostrele: un rând existent pe fiecare proiect, pe fiecare tabel acoperit (+ valoarea cheii, pentru INSERT-ul de probă)
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'copil', 'drept') AND col_upd IS NOT NULL LOOP
    FOR n IN 1..3 LOOP
      EXECUTE format('SELECT t.ctid::text AS ct, %s::text AS v FROM %s t JOIN t_rand q ON q.tabel = %L AND q.ct = t.ctid AND q.n = $1 ORDER BY t.ctid LIMIT 1',
                     CASE WHEN r.col_ins IS NULL THEN 'NULL' ELSE 't.' || quote_ident(r.col_ins) END, r.rel::regclass, r.nume)
        INTO v_ct, v_val USING n;
      IF v_ct IS NOT NULL THEN INSERT INTO t_most VALUES (r.nume, n, v_ct, v_val); END IF;
    END LOOP;
  END LOOP;
  -- obiectele de Storage de test: pe fiecare bucket acoperit, câte un obiect existent al lui p1 / p3, găsit din tabelul / calea lui (ca postgres)
  CREATE TEMP TABLE t_obj AS
  SELECT DISTINCT ON (b, k) b AS bucket, k AS n, o AS nume FROM (
    SELECT 'documente-proiect' AS b, k, d.storage_path AS o FROM unnest(ARRAY[1, 3]) k
      JOIN public.documente_proiect d ON d.proiect_id = pr[k]
     WHERE EXISTS (SELECT 1 FROM storage.objects s WHERE s.bucket_id = 'documente-proiect' AND s.name = d.storage_path)
    UNION ALL
    SELECT 'executie-pachete-pdf', k, d.fisier_path FROM unnest(ARRAY[1, 3]) k
      JOIN public.executie_pachete_lansare l ON l.proiect_id = pr[k]
      JOIN public.executie_pachete_documente d ON d.pachet_id = l.id
     WHERE EXISTS (SELECT 1 FROM storage.objects s WHERE s.bucket_id = 'executie-pachete-pdf' AND s.name = d.fisier_path)
    UNION ALL
    SELECT 'executie-contracte', k, s.name FROM unnest(ARRAY[1, 3]) k
      JOIN storage.objects s ON s.bucket_id = 'executie-contracte' AND split_part(s.name, '/', 1) = pr[k]::text
    UNION ALL
    SELECT 'executie-borderouri', k, s.name FROM unnest(ARRAY[1, 3]) k
      JOIN storage.objects s ON s.bucket_id = 'executie-borderouri' AND split_part(s.name, '/', 1) = 'sl_' || pr[k]
  ) q ORDER BY b, k, o;
  RAISE NOTICE 'T0 OK (proiecte %, rânduri mapate %, mostre %, obiecte %, șantiere % / %)', pr, (SELECT count(*) FROM t_rand),
    (SELECT count(*) FROM t_most), (SELECT count(*) FROM t_obj), pg_temp.t_g('site1'), pg_temp.t_g('site3');
END $t$;
GRANT SELECT ON t_rand, t_obj TO authenticated, anon, service_role;

-- ce vede apelantul curent (prin RLS), pe fiecare tabel testat și pe fiecare din cele 3 proiecte (proiectul rândului = t_rand)
CREATE FUNCTION pg_temp.t_vede() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; v jsonb := '{}'::jsonb; n1 bigint; n2 bigint; n3 bigint;
BEGIN
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'copil', 'drept') ORDER BY nume LOOP
    IF NOT has_table_privilege(r.rel, 'SELECT') THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FILTER (WHERE q.n = 1), count(*) FILTER (WHERE q.n = 2), count(*) FILTER (WHERE q.n = 3) FROM %s t JOIN t_rand q ON q.tabel = %L AND q.ct = t.ctid',
                   r.rel::regclass, r.nume)
      INTO n1, n2, n3;
    v := v || jsonb_build_object(r.nume, jsonb_build_array(n1, n2, n3));
  END LOOP;
  RETURN v;
END $h$;
-- scrierea „fără efect” (col = col) pe mostra proiectului n, pe calea dată ('rest' / 'definer'): rândul se scrie efectiv, apoi se anulează
CREATE FUNCTION pg_temp.t_scrie(p_tabel text, p_n integer, p_cale text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r record; m record; v_sql text;
BEGIN
  SELECT * INTO r FROM t_tab WHERE nume = p_tabel;
  SELECT * INTO m FROM t_most WHERE tabel = p_tabel AND n = p_n;
  IF m IS NULL OR r.col_upd IS NULL THEN RETURN NULL; END IF;
  v_sql := format('UPDATE %s SET %I = %I WHERE ctid = %L::tid', r.rel::regclass, r.col_upd, r.col_upd, m.ctid_txt);
  RETURN CASE p_cale WHEN 'definer' THEN pg_temp.t_proba_definer(v_sql) ELSE pg_temp.t_proba(v_sql) END;
END $h$;
-- INSERT doar cu cheia (proiectul / părintele din mostra proiectului n); garda (BEFORE) se vede înaintea constrângerilor NOT NULL
CREATE FUNCTION pg_temp.t_insereaza(p_tabel text, p_n integer, p_cale text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r record; v_val text; v_sql text;
BEGIN
  SELECT * INTO r FROM t_tab WHERE nume = p_tabel;
  IF r.col_ins IS NULL THEN RETURN NULL; END IF;
  v_val := CASE WHEN r.expr ~ '^t\.' THEN pg_temp.t_g('p' || p_n) ELSE (SELECT val_ins FROM t_most WHERE tabel = p_tabel AND n = p_n) END;
  IF v_val IS NULL THEN RETURN NULL; END IF;
  v_sql := format('INSERT INTO %s (%I) VALUES (%L)', r.rel::regclass, r.col_ins, v_val);
  RETURN CASE p_cale WHEN 'definer' THEN pg_temp.t_proba_definer(v_sql) ELSE pg_temp.t_proba(v_sql) END;
END $h$;
-- obiectele de test (t_obj, alese ca postgres) văzute de apelantul curent prin politicile Storage
CREATE FUNCTION pg_temp.t_vede_obiecte() RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT coalesce(jsonb_object_agg(o.bucket || ':' || o.n, (SELECT count(*) FROM storage.objects s WHERE s.bucket_id = o.bucket AND s.name = o.nume)), '{}'::jsonb)
    FROM t_obj o
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_g(text), pg_temp.t_proba(text), pg_temp.t_proba_definer(text), pg_temp.t_stare(text),
  pg_temp.t_e_garda(text), pg_temp.t_eroare(text, text, text, text, text, text), pg_temp.t_neprobat(text),
  pg_temp.t_seteaza(text, boolean, jsonb, jsonb), pg_temp.t_lista(text), pg_temp.t_vede(), pg_temp.t_scrie(text, integer, text),
  pg_temp.t_insereaza(text, integer, text), pg_temp.t_vede_obiecte()
  TO authenticated, anon, service_role;

-- ── TB: ÎNAINTE de migrare, ca fiecare cont (RLS-ul de azi): ce vede, ce poate scrie (B), ce obiecte vede, raportul zilnic ──
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT set_config('tacc.va0', pg_temp.t_vede()::text, true);
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT set_config('tacc.vc0', pg_temp.t_vede()::text, true);
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT set_config('tacc.vb0', pg_temp.t_vede()::text, true);
SELECT set_config('tacc.ob0', pg_temp.t_vede_obiecte()::text, true);
SELECT set_config('tacc.sb0', (SELECT jsonb_object_agg(t.nume || ':' || k, pg_temp.t_scrie(t.nume, k, 'rest'))
                                 FROM t_tab t CROSS JOIN generate_series(1, 3) k WHERE t.clasa IN ('proiect', 'copil'))::text, true);
SELECT set_config('tacc.ib0', pg_temp.t_proba(format('INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (%s, %L, %L, %L, 990, true)',
                                                     pg_temp.t_g('p1'), 'tronson', 'T-ACC-B', 'Unitate test acces (B)')), true);
SELECT set_config('tacc.rb0', pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site3'), '2001-01-01')), true);
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('tacc.pol0', (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polpermissive, polroles,
                                                                       coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                                                ORDER BY polrelid::regclass::text, polname), ''))
                                  FROM pg_policy WHERE polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass), true);
DO $t$ BEGIN
  IF pg_temp.t_g('rb0') NOT LIKE 'OK %' THEN RAISE EXCEPTION 'TB FAIL: B nu putea citi raportul șantierului p3 înainte (%): testul n-ar dovedi nimic', pg_temp.t_g('rb0'); END IF;
  IF pg_temp.t_g('ib0') <> 'OK 1' THEN PERFORM pg_temp.t_neprobat('INSERT proiect_unitati de către B oprit și înainte: ' || pg_temp.t_g('ib0')); END IF;
  RAISE NOTICE 'TB OK (B: % tabele văzute, % obiecte de test)', (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('vb0')::jsonb)),
    (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('ob0')::jsonb));
END $t$;

SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql

-- ── T1: după migrare, fără niciun rând = comportamentul de azi (aceeași vizibilitate pentru toți); politicile vechi neatinse ──
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN RAISE EXCEPTION 'T1 FAIL: tabelul nou are date'; END IF;
  IF (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polpermissive, polroles,
                                            coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                     ORDER BY polrelid::regclass::text, polname), ''))
        FROM pg_policy WHERE (polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass) AND polname NOT LIKE 'executie\_acces\_%')
     IS DISTINCT FROM pg_temp.t_g('pol0') THEN
    RAISE EXCEPTION 'T1 FAIL: politicile vechi ale tabelelor testate / Storage s-au schimbat';
  END IF;
  -- inventarul real al migrării = cel citit în T0a
  IF (SELECT count(*) FROM public.fn_executie_acces_inventar() i FULL JOIN t_inv t ON (t.tip, t.obiect, t.clasa) = (i.tip, i.obiect, i.clasa)
       WHERE i.tip IS NULL OR t.tip IS NULL) <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: inventarul diferă de cel citit în T0a';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('va0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: A vede altceva după migrare: % vs %', pg_temp.t_vede(), pg_temp.t_g('va0'); END IF;
  IF NOT public.fn_executie_acces_nerestrans() OR NOT public.fn_executie_proiect_permis(pg_temp.t_g('p3')::bigint, true) THEN RAISE EXCEPTION 'T1 FAIL: A nu e nerestrâns'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE k text; s0 jsonb := pg_temp.t_g('sb0')::jsonb;
BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('vb0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: B vede altceva după migrare (fără rânduri)'; END IF;
  IF pg_temp.t_vede_obiecte() IS DISTINCT FROM pg_temp.t_g('ob0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: B vede alte obiecte după migrare'; END IF;
  -- nerestrâns: aceleași rezultate ale scrierilor ca înainte (garda nu oprește nimic)
  FOR k IN SELECT jsonb_object_keys(s0) LOOP
    IF pg_temp.t_scrie(split_part(k, ':', 1), split_part(k, ':', 2)::integer, 'rest') IS DISTINCT FROM s0->>k THEN
      RAISE EXCEPTION 'T1 FAIL: scrierea lui B pe % s-a schimbat fără nicio restricție: % vs %', k,
        pg_temp.t_scrie(split_part(k, ':', 1), split_part(k, ':', 2)::integer, 'rest'), s0->>k;
    END IF;
  END LOOP;
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

-- ── T3: B citește doar p1 + p2 (exact ce vedea înainte pe ele) și nimic pe p3, pe TOATE tabelele din catalog; scrie doar pe p1, pe toate căile ──
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('vb0')::jsonb; s0 jsonb := pg_temp.t_g('sb0')::jsonb; k text; r record; x text; y text;
  p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint; p3 bigint := pg_temp.t_g('p3')::bigint;
  n_cit integer := 0; n_scr integer := 0; n_def integer := 0; n_ins integer := 0;
BEGIN
  -- citire
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k->0 IS DISTINCT FROM v0->k->0 OR v->k->1 IS DISTINCT FROM v0->k->1 OR (v->k->>2)::bigint <> 0 THEN
      RAISE EXCEPTION 'T3 FAIL: citire pe %: după % / înainte %', k, v->k, v0->k;
    END IF;
    IF (v0->k->>0)::bigint > 0 AND (v0->k->>2)::bigint > 0 THEN n_cit := n_cit + 1;
    ELSE PERFORM pg_temp.t_neprobat('citire ' || k || ' (înainte: ' || (v0->k)::text || ')'); END IF;
  END LOOP;
  -- regula
  IF public.fn_executie_acces_nerestrans() OR public.fn_executie_acces_lista(false) <> ARRAY[least(p1, p2), greatest(p1, p2)] OR public.fn_executie_acces_lista(true) <> ARRAY[p1]
     OR NOT public.fn_executie_proiect_permis(p1, true) OR public.fn_executie_proiect_permis(p2, true) OR NOT public.fn_executie_proiect_permis(p2)
     OR public.fn_executie_proiect_permis(p3) OR public.fn_executie_proiect_permis(NULL) THEN
    RAISE EXCEPTION 'T3 FAIL: regula (nerestrans / lista / permis)';
  END IF;
  -- scrierea legitimă REUȘEȘTE (rândul scris efectiv, apoi anulat) acolo unde reușea și înainte; p2 (viewer) și p3 = 0 rânduri (RLS)
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'copil') ORDER BY nume LOOP
    IF s0->>(r.nume || ':1') = 'OK 1' THEN
      x := pg_temp.t_scrie(r.nume, 1, 'rest');
      IF x IS DISTINCT FROM 'OK 1' THEN RAISE EXCEPTION 'T3 FAIL: scrierea legitimă pe % (p1, editor) nu mai reușește: %', r.nume, x; END IF;
      n_scr := n_scr + 1;
    ELSE PERFORM pg_temp.t_neprobat('scriere legitimă ' || r.nume || ' (înainte: ' || coalesce(s0->>(r.nume || ':1'), 'fără rând pe p1') || ')'); END IF;
    FOREACH k IN ARRAY ARRAY['2', '3'] LOOP
      IF s0->>(r.nume || ':' || k) = 'OK 1' AND pg_temp.t_scrie(r.nume, k::integer, 'rest') IS DISTINCT FROM 'OK 0' THEN
        RAISE EXCEPTION 'T3 FAIL: B scrie pe % (p%): %', r.nume, k, pg_temp.t_scrie(r.nume, k::integer, 'rest');
      END IF;
    END LOOP;
    -- calea SECURITY DEFINER (ocolește RLS): garda oprește p3; pe p1 trece. Constrângerile (SQLSTATE 23…) se verifică DUPĂ trigger-ele
    -- BEFORE: o asemenea eroare înseamnă că rândul a trecut de gardă = FAIL; alt refuz (alt trigger BEFORE, sortat înaintea gărzii) = neprobat
    x := pg_temp.t_scrie(r.nume, 3, 'definer');
    IF x IS NOT NULL THEN
      IF pg_temp.t_e_garda(x) THEN n_def := n_def + 1;
      ELSIF x LIKE 'OK %' OR x LIKE '23%' THEN RAISE EXCEPTION 'T3 FAIL: calea DEFINER scrie pe % (p3): %', r.nume, x;
      ELSE PERFORM pg_temp.t_neprobat('DEFINER ' || r.nume || ': alt refuz înaintea gărzii (' || left(x, 120) || ')'); END IF;
      y := pg_temp.t_scrie(r.nume, 1, 'definer');
      IF y IS NOT NULL AND pg_temp.t_e_garda(y) THEN RAISE EXCEPTION 'T3 FAIL: garda oprește calea DEFINER pe % (p1, editor)', r.nume; END IF;
    END IF;
    -- INSERT pe p3 / p2 (doar cheia): garda îl oprește înaintea oricărei constrângeri (aceeași regulă pentru SQLSTATE 23…)
    FOREACH k IN ARRAY ARRAY['3', '2'] LOOP
      x := pg_temp.t_insereaza(r.nume, k::integer, 'definer');
      IF x IS NOT NULL THEN
        IF pg_temp.t_e_garda(x) THEN n_ins := n_ins + 1;
        ELSIF x LIKE 'OK %' OR x LIKE '23%' THEN RAISE EXCEPTION 'T3 FAIL: INSERT pe % (p%) a trecut de gardă: %', r.nume, k, x;
        ELSE PERFORM pg_temp.t_neprobat('INSERT ' || r.nume || ' p' || k || ': alt refuz înaintea gărzii (' || left(x, 120) || ')'); END IF;
      END IF;
      y := pg_temp.t_insereaza(r.nume, k::integer, 'rest');
      IF y LIKE 'OK %' THEN RAISE EXCEPTION 'T3 FAIL: INSERT REST pe % (p%) a trecut', r.nume, k; END IF;
    END LOOP;
  END LOOP;
  -- un părinte inexistent nu e „al nimănui”: pentru un cont restrâns e refuz
  FOR r IN SELECT * FROM t_inv WHERE tip = 'tabel' AND clasa = 'copil' LOOP
    x := pg_temp.t_proba_definer(format('INSERT INTO public.%I (%I) VALUES (-1)', r.obiect, r.cheie));
    IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3 FAIL: garda pe % (părinte inexistent): %', r.obiect, x; END IF;
  END LOOP;
  -- mutarea unui rând pe alt proiect, modificarea pe p1, ștergerea pe p3 (invizibil = 0 rânduri)
  IF NOT pg_temp.t_e_garda(pg_temp.t_proba(format('UPDATE public.proiect_unitati SET proiect_id = %s WHERE id = %s', p3, pg_temp.t_g('u1'))))
     OR pg_temp.t_proba(format('UPDATE public.proiect_unitati SET nume = nume || %L WHERE id = %s', ' ', pg_temp.t_g('u1'))) <> 'OK 1'
     OR pg_temp.t_proba(format('DELETE FROM public.proiect_unitati WHERE id = %s', pg_temp.t_g('u3'))) <> 'OK 0'
     OR pg_temp.t_proba(format('DELETE FROM public.executie_proiecte WHERE id = %s', p3)) <> 'OK 0' THEN
    RAISE EXCEPTION 'T3 FAIL: UPDATE / DELETE direct';
  END IF;
  -- INSERT legitim (B pe p1): reușește dacă reușea și înainte
  IF pg_temp.t_g('ib0') = 'OK 1'
     AND pg_temp.t_proba(format('INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (%s, %L, %L, %L, 990, true)',
                                p1, 'tronson', 'T-ACC-B', 'Unitate test acces (B)')) <> 'OK 1' THEN
    RAISE EXCEPTION 'T3 FAIL: INSERT-ul legitim al lui B pe p1 nu mai reușește';
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
  -- RPC-ul de stare al sudurii (20261201a): p3 refuz, p1 trece (scris efectiv, apoi anulat)
  IF pg_temp.t_proba(format('SELECT public.fn_executie_nod_sudura_stare(%s, %L, 1, %L, (now() AT TIME ZONE %L)::date, %L, NULL, NULL, gen_random_uuid())',
                            pg_temp.t_g('s3'), 'de_executat', 'insailat', 'Europe/Bucharest', 'Sudor Test')) NOT LIKE '42501 %'
     OR pg_temp.t_proba(format('SELECT public.fn_executie_nod_sudura_stare(%s, %L, 1, %L, (now() AT TIME ZONE %L)::date, %L, NULL, NULL, gen_random_uuid())',
                               pg_temp.t_g('s1'), 'de_executat', 'insailat', 'Europe/Bucharest', 'Sudor Test')) <> 'OK 1' THEN
    RAISE EXCEPTION 'T3 FAIL: RPC-ul sudurii';
  END IF;
  -- tabelul de acces: B vede doar rândurile lui; nu poate seta nimic
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 2 OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id <> auth.uid())
     OR pg_temp.t_proba(format('SELECT pg_temp.t_seteaza(%L, true, pg_temp.t_lista(%L), pg_temp.t_lista(%L))', 'b', 'p1:editor,p2:editor,p3:editor', 'p1:editor,p2:viewer')) NOT LIKE '42501 %'
     OR pg_temp.t_proba(format('INSERT INTO public.executie_acces_proiect (profile_id, proiect_id) VALUES (auth.uid(), %s)', p3)) NOT LIKE '42501 %' THEN
    RAISE EXCEPTION 'T3 FAIL: tabelul de acces (citire / setare de către non-owner)';
  END IF;
  RAISE NOTICE 'T3 OK (citire probată cu date pe % tabele; scriere legitimă reușită pe %; garda pe calea DEFINER pe %; INSERT oprit de gardă pe %)', n_cit, n_scr, n_def, n_ins;
END $t$;

-- ── T3r: raportul zilnic (review r1 P1): B nu primește și nu salvează raportul unui șantier al lui p3; pe p1 salvează efectiv ──
DO $t$
DECLARE x text;
BEGIN
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site3'), '2001-01-01'));
  IF x NOT LIKE '42501 %nu ai drept pe șantier%' THEN RAISE EXCEPTION 'T3r FAIL: B citește raportul șantierului p3: %', x; END IF;
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_salveaza(%s, DATE %L, %L::jsonb, %L::jsonb, NULL, 0, gen_random_uuid())',
                              pg_temp.t_g('site3'), '2001-01-01', '{"probleme": "test"}', '[]'));
  IF x NOT LIKE '42501 %nu ai drept pe șantier%' THEN RAISE EXCEPTION 'T3r FAIL: B salvează raportul șantierului p3: %', x; END IF;
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site1'), '2001-01-01'));
  IF x <> 'OK 1' THEN RAISE EXCEPTION 'T3r FAIL: B nu mai citește raportul șantierului p1: %', x; END IF;
  -- salvarea pe p1, cu o linie: reușește și scrie linia (verificat în aceeași subtranzacție)
  x := pg_temp.t_proba(format($q$DO $d$ DECLARE r jsonb; BEGIN
         r := public.fn_raport_zilnic_salveaza(%s, DATE '2001-01-01', '{"probleme": "test acces"}'::jsonb,
                jsonb_build_array(jsonb_build_object('activitate_id', %s, 'unitate_id', NULL, 'cantitate', 1)), NULL, 0, gen_random_uuid());
         IF r->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS (SELECT 1 FROM public.raport_lucrari l WHERE l.raport_id = (r->>'raport_id')::bigint AND l.activitate_id = %s) THEN
           RAISE EXCEPTION 'salvare: %%', r;
         END IF;
       END $d$;$q$, pg_temp.t_g('site1'), pg_temp.t_g('a1'), pg_temp.t_g('a1')));
  IF x NOT LIKE 'OK %' THEN RAISE EXCEPTION 'T3r FAIL: salvarea legitimă a raportului pe p1 nu reușește: %', x; END IF;
  RAISE NOTICE 'T3r OK';
END $t$;

-- ── T3d: coada de repartizat + documentele proiectului (review r1 P1): B nu repartizează nimic; A (nerestrâns) repartizează efectiv ──
DO $t$
DECLARE x text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.documente_de_repartizat WHERE id = pg_temp.t_g('d1')::bigint) THEN
    RAISE EXCEPTION 'T3d FAIL: B (restrâns) vede coada comună';
  END IF;
  FOREACH x IN ARRAY ARRAY[pg_temp.t_g('p3'), pg_temp.t_g('p1')] LOOP
    x := pg_temp.t_proba(format('SELECT public.fn_doc_repartizeaza(%s, %s)', pg_temp.t_g('d1'), x));
    IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3d FAIL: B repartizează: %', x; END IF;
  END LOOP;
  x := pg_temp.t_proba(format('SELECT public.fn_doc_ignora(%s)', pg_temp.t_g('d1')));
  IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3d FAIL: B ignoră un mesaj din coadă: %', x; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.fn_doc_repartizeaza(pg_temp.t_g('d1')::bigint, pg_temp.t_g('p3')::bigint);
  IF r->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS (SELECT 1 FROM public.documente_proiect WHERE id = (r->>'document_proiect_id')::bigint AND proiect_id = pg_temp.t_g('p3')::bigint) THEN
    RAISE EXCEPTION 'T3d FAIL: repartizarea legitimă (A, nerestrâns) nu reușește: %', r;
  END IF;
  PERFORM set_config('tacc.doc3', r->>'document_proiect_id', true);
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.documente_proiect WHERE id = pg_temp.t_g('doc3')::bigint) THEN RAISE EXCEPTION 'T3d FAIL: B vede documentul repartizat pe p3'; END IF;
  RAISE NOTICE 'T3d OK';
END $t$;

-- ── T3s: Storage (review r1 P1): B vede obiectele p1 ca înainte, niciunul al lui p3; rezolvarea căilor ──
DO $t$
DECLARE v jsonb := pg_temp.t_vede_obiecte(); v0 jsonb := pg_temp.t_g('ob0')::jsonb; k text; n integer := 0;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF (k LIKE '%:1' AND v->k IS DISTINCT FROM v0->k) OR (k LIKE '%:3' AND (v->>k)::integer <> 0) THEN
      RAISE EXCEPTION 'T3s FAIL: obiectul % — după % / înainte %', k, v->k, v0->k;
    END IF;
    IF k LIKE '%:3' AND (v0->>k)::integer > 0 THEN n := n + 1; END IF;
  END LOOP;
  IF n = 0 THEN PERFORM pg_temp.t_neprobat('Storage: niciun obiect al lui p3 vizibil înainte'); END IF;
  -- încărcarea unui obiect pe p3 / pe o cale necunoscută = refuz; pe p1 trece de politica nouă
  IF pg_temp.t_proba(format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-contracte', pg_temp.t_g('p3') || '/test-acces.pdf')) LIKE 'OK %'
     OR pg_temp.t_proba(format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-contracte', '_nou/test-acces/x.pdf')) LIKE 'OK %'
     OR pg_temp.t_proba(format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-borderouri', 'sl_' || pg_temp.t_g('p3') || '/x.xls')) LIKE 'OK %' THEN
    RAISE EXCEPTION 'T3s FAIL: B încarcă un obiect pe p3 / pe o cale necunoscută';
  END IF;
  RAISE NOTICE 'T3s OK (obiecte p3 probate: %)', n;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE p1 text := pg_temp.t_g('p1'); p3 text := pg_temp.t_g('p3'); k record; v_pk bigint;
BEGIN
  IF public.fn_executie_acces_obiect_proiecte('executie-contracte', p1 || '/docs_tehnice/x.pdf') <> ARRAY[p1::bigint]
     OR public.fn_executie_acces_obiect_proiecte('executie-contracte', 'pccvi/' || p1 || '/x.pdf') <> ARRAY[p1::bigint]
     OR public.fn_executie_acces_obiect_proiecte('executie-contracte', 'ordin-incepere/' || p3 || '/x.pdf') <> ARRAY[p3::bigint]
     OR public.fn_executie_acces_obiect_proiecte('executie-contracte', '_nou/' || p1 || '/x.pdf') <> '{}'
     OR public.fn_executie_acces_obiect_proiecte('executie-contracte', p1 || '/../' || p3 || '/x.pdf') <> '{}'
     OR public.fn_executie_acces_obiect_proiecte('executie-contracte', 'x' || p1 || '/y.pdf') <> '{}'
     OR public.fn_executie_acces_obiect_proiecte('executie-borderouri', 'sl_' || p3 || '/1_borderou.xls') <> ARRAY[p3::bigint]
     OR public.fn_executie_acces_obiect_proiecte('executie-borderouri', 'x/sl_' || p3 || '/1.xls') <> '{}'
     OR public.fn_executie_acces_obiect_proiecte('alt-bucket', p1 || '/x.pdf') <> '{}'
     OR public.fn_executie_acces_obiect_proiecte(NULL, 'x') <> '{}' THEN
    RAISE EXCEPTION 'T3s FAIL: rezolvarea căilor (contracte / borderouri)';
  END IF;
  SELECT id INTO v_pk FROM public.executie_pachete_lansare WHERE proiect_id = p1::bigint ORDER BY id LIMIT 1;
  IF v_pk IS NOT NULL AND (public.fn_executie_acces_obiect_proiecte('executie-pachete-pdf', v_pk || '/2026-11-01_ab_x.xlsx') <> ARRAY[p1::bigint]
     OR public.fn_executie_acces_obiect_proiecte('executie-pachete-pdf', p1 || '/' || v_pk || '/aprobare/x.pdf') <> ARRAY[p1::bigint]
     OR public.fn_executie_acces_obiect_proiecte('executie-pachete-pdf', p3 || '/' || v_pk || '/aprobare/x.pdf') <> '{}') THEN
    RAISE EXCEPTION 'T3s FAIL: rezolvarea căilor (pachete)';
  END IF;
  IF v_pk IS NULL THEN PERFORM pg_temp.t_neprobat('Storage executie-pachete-pdf: niciun pachet pe p1'); END IF;
  IF public.fn_executie_acces_obiect_proiecte('documente-proiect', (SELECT storage_path FROM public.documente_proiect WHERE id = pg_temp.t_g('doc3')::bigint))
       IS DISTINCT FROM ARRAY[p3::bigint] THEN
    RAISE EXCEPTION 'T3s FAIL: rezolvarea documentelor';
  END IF;
END $t$;

-- ── T3x: ce rămâne EXCLUS (decizie scrisă): câte rânduri ale lui p3 vede B pe fiecare tabel exclus din catalog (informativ) ──
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE r record; n bigint; v text := '';
BEGIN
  FOR r IN SELECT t.*, (SELECT i.motiv FROM t_inv i WHERE (i.tip = 'tabel' AND i.obiect = t.nume) OR (i.tip = 'prefix_tabel' AND starts_with(t.nume, i.obiect)) LIMIT 1) AS motiv
             FROM t_tab t WHERE t.clasa = 'exclus' AND t.expr IS NOT NULL ORDER BY t.nume LOOP
    IF NOT has_table_privilege(r.rel, 'SELECT') THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s t WHERE (%s) = $1', r.rel::regclass, r.expr) INTO n USING pg_temp.t_g('p3')::bigint;
    EXCEPTION WHEN OTHERS THEN n := NULL;
    END;
    IF coalesce(n, 0) > 0 THEN v := v || format('%s: %s rânduri (%s); ', r.nume, n, left(r.motiv, 60)); END IF;
  END LOOP;
  RAISE NOTICE 'T3x (informativ) excluse vizibile lui B pe p3: %', CASE WHEN v = '' THEN 'niciunul' ELSE v END;
END $t$;

-- ── T4: C (modul viewer, restrâns pe p1 editor): proiectul nu ridică dreptul de modul; A tot nerestrâns ──
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
  -- (rândurile scrise în T3d nu sunt în t_rand, deci nu schimbă numărătoarea)
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
  IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, true, %L::jsonb, %L::jsonb)', 'b', '[]', acum)) NOT LIKE '22023 %lista goală%' THEN RAISE EXCEPTION 'T5 FAIL: lista goală'; END IF;
  IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, false, %L::jsonb, %L::jsonb)', 'b', pg_temp.t_lista('p1:editor'), acum)) NOT LIKE '22023 %' THEN RAISE EXCEPTION 'T5 FAIL: scoate restricția cu proiecte'; END IF;
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
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'motiv' IS DISTINCT FROM 'conflict' OR (SELECT count(*) FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid) <> 2 THEN
    RAISE EXCEPTION 'T5 FAIL: CAS %', r;
  END IF;
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p2:viewer,p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'duplicat' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T5 FAIL: idempotență %', r; END IF;
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:viewer,p3:editor'), acum);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->'lista' IS DISTINCT FROM (SELECT jsonb_agg(e ORDER BY (e->>'proiect_id')::bigint) FROM jsonb_array_elements(pg_temp.t_lista('p1:viewer,p3:editor')) e)
     OR (SELECT array_agg(proiect_id || ':' || nivel ORDER BY proiect_id) FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY split_part(x, ':', 1)::bigint) FROM unnest(ARRAY[pg_temp.t_g('p1') || ':viewer', pg_temp.t_g('p3') || ':editor']) x) THEN
    RAISE EXCEPTION 'T5 FAIL: schimbarea %', r;
  END IF;
  IF pg_temp.t_stare(format('INSERT INTO public.executie_acces_proiect (profile_id, proiect_id) VALUES (%L, %s)', pg_temp.t_g('a'), pg_temp.t_g('p1'))) NOT LIKE '42501 %'
     OR pg_temp.t_stare(format('DELETE FROM public.executie_acces_proiect WHERE profile_id = %L', pg_temp.t_g('b'))) NOT LIKE '42501 %' THEN
    RAISE EXCEPTION 'T5 FAIL: scriere directă în tabelul de acces';
  END IF;
  r := pg_temp.t_seteaza('b', false, '[]'::jsonb, pg_temp.t_lista('p1:viewer,p3:editor'));
  IF r->>'ok' IS DISTINCT FROM 'true' OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid) THEN RAISE EXCEPTION 'T5 FAIL: scoate restricția %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('vb0')::jsonb; k text;
BEGIN
  -- B nerestrâns din nou: vede exact ce vedea înainte
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k IS DISTINCT FROM v0->k THEN RAISE EXCEPTION 'T5 FAIL: B după scoaterea restricției, pe %: % vs %', k, v->k, v0->k; END IF;
  END LOOP;
  RAISE NOTICE 'T5 OK';
END $t$;

-- ── T6: FK RESTRICT — un proiect cu conturi restrânse pe el nu se șterge (lista nu se golește pe tăcute) ──
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT array_agg(confdeltype::text) FROM pg_constraint WHERE conrelid = 'public.executie_acces_proiect'::regclass AND contype = 'f'
        AND confrelid = 'public.executie_proiecte'::regclass) IS DISTINCT FROM ARRAY['r']
     OR pg_temp.t_proba(format('DELETE FROM public.executie_proiecte WHERE id = %s', pg_temp.t_g('p1'))) NOT LIKE '23503 %' THEN
    RAISE EXCEPTION 'T6 FAIL: ștergerea proiectului cu restricții';
  END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- ── T7: revenirea — nearmată = refuz; armată cu un cont restrâns (C) = refuz; nimic atins ──
SELECT set_config('tacc.ngarzi', (SELECT count(*) FROM t_inv WHERE tip = 'tabel' AND clasa IN ('proiect', 'copil'))::text, true);
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
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') <> pg_temp.t_g('ngarzi')::integer
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_acces\_%') <> 4 THEN
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
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda')
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_executie_nod_drept(bigint, boolean)'::regprocedure), chr(13), '')) <> '144649bae9a218b41b7e6df90cba5d9e'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_raport_santier_drept(bigint)'::regprocedure), chr(13), '')) <> '2c8833d76db7145ab0bd2fc5103e55e9'
     OR (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polpermissive, polroles,
                                               coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                        ORDER BY polrelid::regclass::text, polname), ''))
           FROM pg_policy WHERE polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass) IS DISTINCT FROM pg_temp.t_g('pol0') THEN
    RAISE EXCEPTION 'T8 FAIL: după revenire';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('vc0')::jsonb THEN
    RAISE EXCEPTION 'T8 FAIL: C după revenire vede altceva decât înainte';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NULL
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') <> pg_temp.t_g('ngarzi')::integer THEN
    RAISE EXCEPTION 'T8 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'NEPROBAT pe datele acestei baze: %', coalesce(pg_temp.t_g('neprobat'), 'nimic');
  RAISE NOTICE 'T8 OK — toate testele 20261209a au trecut';
END $t$;
ROLLBACK;
