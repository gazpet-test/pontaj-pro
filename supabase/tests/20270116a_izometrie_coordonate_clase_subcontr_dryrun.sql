-- DRY 20270116a_izometrie_coordonate_clase_subcontr: se ruleaza DUPA aplicarea migrarii, intr-o singura tranzactie cu ROLLBACK la final (nimic ramane),
-- pe clona PG17 (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_izometrie_coordonate_clase_local.mjs). Fiecare bloc scrie
-- NOTICE 'DRY 20270116a <bloc> ok …'; orice abatere = exceptie. Valorile asteptate vin din regulile scrise in antetul migrarii si din spec
-- (§15, §16, §17, §21 R2 / R6 / R9 / R11, §22, D16–D19), nu din codul testat (L25). Identitatea: ambele surse JWT + SET LOCAL ROLE authenticated,
-- verificate la fiecare schimbare (auth.uid, current_user, rol fara BYPASSRLS). Conturi SINTETICE (uuid-uri f3000000-…): a = owner, b = managerul
-- proiectului P1 (fisa 9231), c = managerul P2 (fisa 9232), d = 'executie' editor, e = 'ctc' editor, g = fara modul.
-- FIXTURI: pe clona, daca employees / profiles / executie_tronsoane / executie_pachete_lansare / executie_tevi cer alte coloane NOT NULL sau
-- trigger-ele lor cer alte valori, se completeaza DOAR blocul FIXTURI (restul nu depinde de ele). Constrangerile productiei cunoscute
-- (22.11.2026): employees.department NOT NULL, profiles.role explicit, o fisa = un cont, user_module_access.module → app_modules(key).
-- Toate valorile sunt inventate (coduri DRY-…, coordonate de proba).
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE np_fix (k text PRIMARY KEY, id bigint) ON COMMIT DROP;
GRANT SELECT, INSERT ON np_fix TO authenticated;
GRANT SELECT ON np_fix TO anon;

-- ── t_migrare: preconditia (migrarea aplicata) ──
DO $t$
BEGIN
  IF to_regclass('public.sud_coordonate') IS NULL OR to_regclass('public.sud_clase_interval') IS NULL OR to_regclass('public.sud_pachete_subcontractor') IS NULL
     OR to_regprocedure('public.fn_sud_coord_confirma(bigint, integer, text[])') IS NULL
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-sud-doc')
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_sud\_%') <> 26 THEN
    RAISE EXCEPTION 't_migrare FAIL: migrarea 20270116a nu e aplicata';
  END IF;
  RAISE NOTICE 'DRY 20270116a t_migrare ok';
END $t$;

-- ── FIXTURI (identitati sintetice; id-urile vin din RETURNING) ──
DO $fix$
DECLARE v bigint; v_t bigint; v_k bigint;
BEGIN
  INSERT INTO public.employees (id, name, department) VALUES (9231, 'DRY COORD MP UNU', 'Executie'), (9232, 'DRY COORD MP DOI', 'Executie');
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x::uuid FROM unnest(ARRAY['f3000000-0000-4000-8000-0000000000a1', 'f3000000-0000-4000-8000-0000000000b1',
      'f3000000-0000-4000-8000-0000000000c1', 'f3000000-0000-4000-8000-0000000000d1', 'f3000000-0000-4000-8000-0000000000e1',
      'f3000000-0000-4000-8000-0000000000f1']) x
    ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles (id, is_owner, employee_id, role) VALUES
    ('f3000000-0000-4000-8000-0000000000a1', true, NULL, 'teren'), ('f3000000-0000-4000-8000-0000000000b1', false, 9231, 'teren'),
    ('f3000000-0000-4000-8000-0000000000c1', false, 9232, 'teren'), ('f3000000-0000-4000-8000-0000000000d1', false, NULL, 'teren'),
    ('f3000000-0000-4000-8000-0000000000e1', false, NULL, 'teren'), ('f3000000-0000-4000-8000-0000000000f1', false, NULL, 'teren')
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, employee_id = EXCLUDED.employee_id, role = EXCLUDED.role;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage) VALUES ('executie', NULL, 'Executie', true, true), ('ctc', NULL, 'CTC', true, true)
    ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('f3000000-0000-4000-8000-0000000000d1', 'executie', 'editor'), ('f3000000-0000-4000-8000-0000000000e1', 'ctc', 'editor');
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('DRY-COORD-P1', 'Dry coordonate P1', 9231) RETURNING id INTO v;
  INSERT INTO np_fix VALUES ('p1', v);
  INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (v, 'TR12') RETURNING id INTO v_t;
  INSERT INTO np_fix VALUES ('t1', v_t);
  INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (v, 'TR13') RETURNING id INTO v_t;
  INSERT INTO np_fix VALUES ('t2', v_t);
  v_t := (SELECT id FROM np_fix WHERE k = 't1');
  INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id, km_start_m, revizie, cod_document_full)
    VALUES (v, v_t, 0, 1, 'DRY-SUB-DOC-01') RETURNING id INTO v_k;
  INSERT INTO np_fix VALUES ('k1', v_k);
  INSERT INTO public.executie_tevi (pachet_id, serie_unica, poz_in_pachet, tip_rand, sudura_cod, lungime_m, sarja) VALUES (v_k, 'DRY-COORD-S1', 1, 'teava', 'T12S1', 12, 'SJ-1');
  INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id, km_start_m, revizie, cod_document_full)
    VALUES (v, v_t, 500, 0, 'DRY-SUB-DOC-02') RETURNING id INTO v_k;
  INSERT INTO np_fix VALUES ('k2', v_k);
  INSERT INTO public.executie_tevi (pachet_id, serie_unica, poz_in_pachet, tip_rand, sudura_cod, lungime_m, sarja) VALUES (v_k, 'DRY-COORD-S2', 1, 'teava', 'T12S2', 12, 'SJ-1')
    RETURNING id INTO v;
  INSERT INTO np_fix VALUES ('tv2', v);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('DRY-COORD-P2', 'Dry coordonate P2', 9232) RETURNING id INTO v;
  INSERT INTO np_fix VALUES ('p2', v);
  INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (v, 'TR12') RETURNING id INTO v_t;
  INSERT INTO np_fix VALUES ('t3', v_t);
  RAISE NOTICE 'DRY 20270116a fixturi ok: P1 %, T1 %, K1 %', (SELECT id FROM np_fix WHERE k = 'p1'), (SELECT id FROM np_fix WHERE k = 't1'), (SELECT id FROM np_fix WHERE k = 'k1');
END $fix$;
CREATE FUNCTION pg_temp.np_id(p text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT id FROM np_fix WHERE k = p $f$;
CREATE FUNCTION pg_temp.np_u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('f3000000-0000-4000-8000-0000000000' || CASE p WHEN 'a' THEN 'a1' WHEN 'b' THEN 'b1' WHEN 'c' THEN 'c1' WHEN 'd' THEN 'd1'
            WHEN 'e' THEN 'e1' WHEN 'g' THEN 'f1' END)::uuid
$f$;
CREATE FUNCTION pg_temp.np_ca(p text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.np_u(p);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM v OR current_user <> 'authenticated' OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'identitate gresita: uid % user %', auth.uid(), current_user;
  END IF;
END $f$;
-- rezultatul unei instructiuni intr-o sub-tranzactie: 'ok' sau SQLSTATE: mesaj (instructiunea e text scris in acest fisier, nu date externe)
CREATE FUNCTION pg_temp.np_cod(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.np_astept(p_bloc text, p_ce text, p_rez text, p_cod text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_rez IS NULL OR (p_cod = 'ok' AND p_rez <> 'ok') OR (p_cod <> 'ok' AND left(p_rez, length(p_cod) + 1) <> p_cod || ':') THEN
    RAISE EXCEPTION '% FAIL: % = % (astepta %)', p_bloc, p_ce, coalesce(p_rez, 'NULL'), p_cod;
  END IF;
END $f$;
-- calea unui fisier de proba in izo-sud-doc pe proiectul / tronsonul fixturii
CREATE FUNCTION pg_temp.np_cale(p_p text, p_t text, p_nume text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT pg_temp.np_id(p_p) || '/' || pg_temp.np_id(p_t) || '/' || p_nume
$f$;
-- un rand de coordonate {linie, cod_raw, cod, x, y, z}
CREATE FUNCTION pg_temp.np_rand(p_linie int, p_raw text, p_cod text, p_x numeric, p_y numeric, p_z numeric) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('linie', p_linie, 'cod_raw', p_raw, 'cod', p_cod, 'x', p_x, 'y', p_y, 'z', p_z)
$f$;
CREATE FUNCTION pg_temp.np_u1() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(pg_temp.np_rand(1, 'T12S1', 'T12S1', 584100.000, 412300.000, 120.000),
                           pg_temp.np_rand(2, 'TR12 S2', 'T12S2', 584112.000, 412300.000, 120.100),
                           pg_temp.np_rand(3, 'T12S88?1', 'T12S3', 584124.000, 412300.000, 120.200))
$f$;
CREATE FUNCTION pg_temp.np_activ(p_t text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(string_agg(cheie || '@' || x::text, ',' ORDER BY cheie), '') FROM public.sud_coordonate WHERE tronson_id = pg_temp.np_id(p_t) AND stare = 'activ'
$f$;

SET LOCAL ROLE authenticated;

-- ── t_fisiere: incarcarea in izo-sud-doc = owner / MP pe proiectul lui (R9), pe <proiect>/<tronson al proiectului>/<nume> ──
DO $t$
DECLARE c text; f text := 'INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''izo-sud-doc'', %L, auth.uid(), auth.uid()::text)';
BEGIN
  PERFORM pg_temp.np_ca('b');
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
  SELECT 'izo-sud-doc', pg_temp.np_cale('p1', 't1', n), auth.uid(), auth.uid()::text
    FROM unnest(ARRAY['coord1.txt', 'coord2.txt', 'coord3.txt', 'schema1.pdf', 'schema2.pdf', 'sub1.pdf', 'sub1.xlsx', 'sub2.pdf']) n;
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('izo-sud-doc', pg_temp.np_cale('p1', 't2', 'coord_t13.txt'), auth.uid(), auth.uid()::text);
  PERFORM pg_temp.np_ca('a');
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('izo-sud-doc', pg_temp.np_cale('p1', 't1', 'al_ownerului.txt'), auth.uid(), auth.uid()::text);
  FOREACH c IN ARRAY ARRAY['c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.np_ca(c);
    PERFORM pg_temp.np_astept('t_fisiere', 'contul ' || c || ' urca pe P1', pg_temp.np_cod(format(f, pg_temp.np_cale('p1', 't1', 'x_' || c || '.txt'))), '42501');
  END LOOP;
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_fisiere', 'MP P1 pe tronsonul altui proiect', pg_temp.np_cod(format(f, pg_temp.np_id('p1') || '/' || pg_temp.np_id('t3') || '/x.txt')), '42501');
  PERFORM pg_temp.np_astept('t_fisiere', 'MP P1 in sub-folder', pg_temp.np_cod(format(f, pg_temp.np_cale('p1', 't1', 'd/x.txt'))), '42501');
  PERFORM pg_temp.np_astept('t_fisiere', 'MP P1 cu owner_id fals', pg_temp.np_cod(format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''izo-sud-doc'', %L, auth.uid(), %L)',
    pg_temp.np_cale('p1', 't1', 'fals.txt'), pg_temp.np_u('a'))), '42501');
  RAISE NOTICE 'DRY 20270116a t_fisiere ok';
END $t$;

-- ── t_coord_incarca: refuzurile (fisier, forma, cod, dubluri, drept), apoi ciorna U1 cu cheia calculata de server (§22) ──
DO $t$
DECLARE c text; v bigint; r record;
  f text := 'SELECT public.fn_sud_coord_incarca(%s, %L, ''c.txt'', %L, %L::jsonb, NULL)';
  t1 bigint := pg_temp.np_id('t1'); h1 text := repeat('a1', 32);
BEGIN
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'fisier inexistent', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'nu.txt'), h1, pg_temp.np_u1()::text)), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'fisierul altuia (owner)', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'al_ownerului.txt'), h1, pg_temp.np_u1()::text)), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'fisierul altui tronson', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't2', 'coord_t13.txt'), h1, pg_temp.np_u1()::text)), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'amprenta invalida', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), 'ABC', pg_temp.np_u1()::text)), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'randuri goale', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1, '[]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'x text', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T12S1", "cod": "T12S1", "x": "584100", "y": 412300, "z": 120}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'x cu 4 zecimale', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T12S1", "cod": "T12S1", "x": 584100.0001, "y": 412300, "z": 120}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'cheie in plus pe rand', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T12S1", "cod": "T12S1", "x": 1, "y": 2, "z": 3, "stare": "activ"}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'cod de pe alt tronson (T13 pe TR12)', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T13S5", "cod": "T13S5", "x": 1, "y": 2, "z": 3}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'cod nesigur netrecut prin om', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T12S88?1", "cod": "T12S88?1", "x": 1, "y": 2, "z": 3}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'cod doar numar (punct topografic, ca parseazaCoordonate)', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "143", "cod": "143", "x": 1, "y": 2, "z": 3}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'aceeasi sudura de doua ori (S5 si S5R = aceeasi cheie, §22)', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T12S5", "cod": "T12S5", "x": 1, "y": 2, "z": 3}, {"linie": 2, "cod_raw": "T12S5R", "cod": "T12S5R", "x": 1, "y": 2, "z": 3}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'aceeasi linie de doua ori', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1,
    '[{"linie": 1, "cod_raw": "T12S5", "cod": "T12S5", "x": 1, "y": 2, "z": 3}, {"linie": 1, "cod_raw": "T12S6", "cod": "T12S6", "x": 1, "y": 2, "z": 3}]')), '22023');
  PERFORM pg_temp.np_astept('t_coord_incarca', 'tronson inexistent', pg_temp.np_cod(format(f, -1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1, pg_temp.np_u1()::text)), '22023');
  FOREACH c IN ARRAY ARRAY['c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.np_ca(c);
    PERFORM pg_temp.np_astept('t_coord_incarca', 'contul ' || c, pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), h1, pg_temp.np_u1()::text)), '42501');
  END LOOP;
  PERFORM pg_temp.np_ca('b');
  v := public.fn_sud_coord_incarca(t1, pg_temp.np_cale('p1', 't1', 'coord1.txt'), 'coord1.txt', h1, pg_temp.np_u1(), '{"nesigure": 1}');
  INSERT INTO np_fix VALUES ('u1', v);
  PERFORM pg_temp.np_astept('t_coord_incarca', 'a doua ciorna pe acelasi tronson', pg_temp.np_cod(format(f, t1, pg_temp.np_cale('p1', 't1', 'coord2.txt'), repeat('a2', 32), pg_temp.np_u1()::text)), '23505');
  PERFORM pg_temp.np_ca('a');
  SELECT string_agg(concat_ws(':', c2.linie, c2.cheie, c2.cod_corectat::text, c2.stare), ',' ORDER BY c2.linie) AS s, min(incarcat_de::text) AS de, min(nr_randuri) AS n, min(i.stare) AS st
    INTO r FROM public.sud_coordonate c2 JOIN public.sud_coordonate_incarcari i ON i.id = c2.incarcare_id WHERE i.id = v;
  IF r.s IS DISTINCT FROM '1:T12S1:false:propus,2:T12S2:false:propus,3:T12S3:true:propus' OR r.de IS DISTINCT FROM pg_temp.np_u('b')::text OR r.n <> 3 OR r.st <> 'ciorna' THEN
    RAISE EXCEPTION 't_coord_incarca FAIL: ciorna U1 = % (astepta cheile T12S1..3, „TR12 S2” = T12S2, T12S3 corectat de om, propus, autorul b)', row_to_json(r);
  END IF;
  RAISE NOTICE 'DRY 20270116a t_coord_incarca ok';
END $t$;

-- ── t_coord_confirma: CAS pe versiune (40001), inlocuirile confirmate = exact multimea serverului, drept; U1 → 3 pozitii active ──
DO $t$
DECLARE c text; r jsonb; v_u1 bigint := pg_temp.np_id('u1');
BEGIN
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_coord_confirma', 'versiune veche', pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, 2, ''{}'')', v_u1)), '40001');
  PERFORM pg_temp.np_astept('t_coord_confirma', 'versiune lipsa', pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, NULL, ''{}'')', v_u1)), '40001');
  PERFORM pg_temp.np_astept('t_coord_confirma', 'inlocuire declarata fara pozitie activa', pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, 1, ''{T12S1}'')', v_u1)), '40001');
  PERFORM pg_temp.np_astept('t_coord_confirma', 'incarcare inexistenta', pg_temp.np_cod('SELECT public.fn_sud_coord_confirma(-1, 1, ''{}'')'), '22023');
  FOREACH c IN ARRAY ARRAY['c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.np_ca(c);
    PERFORM pg_temp.np_astept('t_coord_confirma', 'contul ' || c, pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, 1, ''{}'')', v_u1)), '42501');
  END LOOP;
  PERFORM pg_temp.np_ca('b');
  r := public.fn_sud_coord_confirma(v_u1, 1, NULL);
  IF r IS DISTINCT FROM '{"active": 3, "inlocuite_diferite": 0, "inlocuite_identice": 0}'::jsonb THEN RAISE EXCEPTION 't_coord_confirma FAIL: rezultat %', r; END IF;
  PERFORM pg_temp.np_astept('t_coord_confirma', 'a doua confirmare', pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, 2, ''{}'')', v_u1)), '55000');
  PERFORM pg_temp.np_ca('a');
  IF pg_temp.np_activ('t1') IS DISTINCT FROM 'T12S1@584100.000,T12S2@584112.000,T12S3@584124.000'
     OR (SELECT row(stare, versiune, confirmat_de) FROM public.sud_coordonate_incarcari WHERE id = v_u1) IS DISTINCT FROM row('confirmat'::text, 2, pg_temp.np_u('b')) THEN
    RAISE EXCEPTION 't_coord_confirma FAIL: pozitiile active % / incarcarea', pg_temp.np_activ('t1');
  END IF;
  RAISE NOTICE 'DRY 20270116a t_coord_confirma ok';
END $t$;

-- ── t_coord_reincarca: U2 cu T12S1 identic, T12S2 altfel, T12S4 nou; inlocuirea valorii diferite cere confirmarea EXACTA; istoricul ramane ──
DO $t$
DECLARE v bigint; r jsonb; v_u1 bigint := pg_temp.np_id('u1');
  u2 jsonb := jsonb_build_array(pg_temp.np_rand(1, 'T12S1', 'T12S1', 584100.000, 412300.000, 120.000), pg_temp.np_rand(2, 'T12S2', 'T12S2', 584112.500, 412300.000, 120.100),
                                pg_temp.np_rand(3, 'T12S4', 'T12S4', 584136.000, 412300.000, 120.300));
BEGIN
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_coord_reincarca', 'acelasi fisier (amprenta) ca U1', pg_temp.np_cod(format('SELECT public.fn_sud_coord_incarca(%s, %L, ''c.txt'', %L, %L::jsonb, NULL)',
    pg_temp.np_id('t1'), pg_temp.np_cale('p1', 't1', 'coord2.txt'), repeat('a1', 32), u2::text)), '23505');
  v := public.fn_sud_coord_incarca(pg_temp.np_id('t1'), pg_temp.np_cale('p1', 't1', 'coord2.txt'), 'coord2.txt', repeat('a2', 32), u2, NULL);
  INSERT INTO np_fix VALUES ('u2', v);
  PERFORM pg_temp.np_astept('t_coord_reincarca', 'fara confirmarea inlocuirii', pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, 1, ''{}'')', v)), '40001');
  PERFORM pg_temp.np_astept('t_coord_reincarca', 'inlocuiri in plus (si identicul)', pg_temp.np_cod(format('SELECT public.fn_sud_coord_confirma(%s, 1, ''{T12S1,T12S2}'')', v)), '40001');
  r := public.fn_sud_coord_confirma(v, 1, ARRAY['T12S2', 'T12S2']);
  IF r IS DISTINCT FROM '{"active": 3, "inlocuite_diferite": 1, "inlocuite_identice": 1}'::jsonb THEN RAISE EXCEPTION 't_coord_reincarca FAIL: rezultat %', r; END IF;
  PERFORM pg_temp.np_ca('a');
  IF pg_temp.np_activ('t1') IS DISTINCT FROM 'T12S1@584100.000,T12S2@584112.500,T12S3@584124.000,T12S4@584136.000' THEN
    RAISE EXCEPTION 't_coord_reincarca FAIL: pozitiile active %', pg_temp.np_activ('t1');
  END IF;
  -- istoricul: pozitiile U1 ale lui S1 / S2 = inlocuit, cu legatura la randul U2 care le-a inlocuit
  IF (SELECT string_agg(o.cheie || ':' || o.stare || ':' || coalesce((n.incarcare_id = v)::text, '-') || ':' || (o.inlocuit_la IS NOT NULL)::text, ',' ORDER BY o.cheie)
        FROM public.sud_coordonate o LEFT JOIN public.sud_coordonate n ON n.id = o.inlocuit_de WHERE o.incarcare_id = v_u1)
     IS DISTINCT FROM 'T12S1:inlocuit:true:true,T12S2:inlocuit:true:true,T12S3:activ:-:false' THEN
    RAISE EXCEPTION 't_coord_reincarca FAIL: istoricul U1';
  END IF;
  RAISE NOTICE 'DRY 20270116a t_coord_reincarca ok';
END $t$;

-- ── t_coord_anuleaza: CAS, motiv; anularea U2 scoate pozitiile ei, cele inlocuite de ea NU revin singure ──
DO $t$
DECLARE v_u2 bigint := pg_temp.np_id('u2'); n int;
BEGIN
  PERFORM pg_temp.np_ca('c');
  PERFORM pg_temp.np_astept('t_coord_anuleaza', 'MP-ul altui proiect', pg_temp.np_cod(format('SELECT public.fn_sud_coord_anuleaza(%s, 2, ''gresit'')', v_u2)), '42501');
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_coord_anuleaza', 'versiune veche', pg_temp.np_cod(format('SELECT public.fn_sud_coord_anuleaza(%s, 1, ''gresit'')', v_u2)), '40001');
  PERFORM pg_temp.np_astept('t_coord_anuleaza', 'motiv gol', pg_temp.np_cod(format('SELECT public.fn_sud_coord_anuleaza(%s, 2, ''  '')', v_u2)), '22023');
  n := public.fn_sud_coord_anuleaza(v_u2, 2, 'fisier gresit');
  IF n <> 3 THEN RAISE EXCEPTION 't_coord_anuleaza FAIL: % pozitii scoase (astepta 3)', n; END IF;
  PERFORM pg_temp.np_astept('t_coord_anuleaza', 'a doua anulare', pg_temp.np_cod(format('SELECT public.fn_sud_coord_anuleaza(%s, 3, ''din nou'')', v_u2)), '55000');
  PERFORM pg_temp.np_ca('a');
  IF pg_temp.np_activ('t1') IS DISTINCT FROM 'T12S3@584124.000'
     OR (SELECT row(stare, anulat_de, anulat_motiv, versiune) FROM public.sud_coordonate_incarcari WHERE id = v_u2)
        IS DISTINCT FROM row('anulat'::text, pg_temp.np_u('b'), 'fisier gresit'::text, 3) THEN
    RAISE EXCEPTION 't_coord_anuleaza FAIL: pozitiile active % (astepta doar T12S3)', pg_temp.np_activ('t1');
  END IF;
  -- o incarcare noua (U3) cu S1 / S2 reface pozitiile, fara inlocuiri de confirmat (nicio pozitie activa pe ele)
  PERFORM pg_temp.np_ca('b');
  PERFORM public.fn_sud_coord_confirma(public.fn_sud_coord_incarca(pg_temp.np_id('t1'), pg_temp.np_cale('p1', 't1', 'coord3.txt'), 'coord3.txt', repeat('a3', 32),
    jsonb_build_array(pg_temp.np_rand(1, 'T12S1', 'T12S1', 584100.000, 412300.000, 120.000), pg_temp.np_rand(2, 'T12S2', 'T12S2', 584112.000, 412300.000, 120.100)), NULL), 1, '{}');
  PERFORM pg_temp.np_ca('a');   -- MP-ul fără modul nu citește pozițiile (R9): verificarea o face owner-ul
  IF pg_temp.np_activ('t1') IS DISTINCT FROM 'T12S1@584100.000,T12S2@584112.000,T12S3@584124.000' THEN
    RAISE EXCEPTION 't_coord_anuleaza FAIL: dupa U3 pozitiile active %', pg_temp.np_activ('t1');
  END IF;
  RAISE NOTICE 'DRY 20270116a t_coord_anuleaza ok';
END $t$;

-- ── t_clase: o sursa vie pe tronson; intervalele scrise o data, la confirmare; fara suprapuneri (capetele comune permise); anularea elibereaza tronsonul ──
DO $t$
DECLARE c text; v bigint; n int; t1 bigint := pg_temp.np_id('t1');
  fi text := 'SELECT public.fn_sud_clase_confirma(%s, %s, %L::jsonb)';
  bune jsonb := '[{"km_de": 0, "km_pana": 1000, "clasa": "1"}, {"km_de": 1000, "km_pana": 2500.5, "clasa": "2"}, {"km_de": 2500.5, "km_pana": 4000, "clasa": "3"}]';
BEGIN
  FOREACH c IN ARRAY ARRAY['c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.np_ca(c);
    PERFORM pg_temp.np_astept('t_clase', 'contul ' || c || ' incarca', pg_temp.np_cod(format('SELECT public.fn_sud_clase_incarca(%s, %L, ''s.pdf'', %L, NULL)',
      t1, pg_temp.np_cale('p1', 't1', 'schema1.pdf'), repeat('b1', 32))), '42501');
  END LOOP;
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_clase', 'citirea AI nu e obiect', pg_temp.np_cod(format('SELECT public.fn_sud_clase_incarca(%s, %L, ''s.pdf'', %L, ''[1]'')',
    t1, pg_temp.np_cale('p1', 't1', 'schema1.pdf'), repeat('b1', 32))), '22023');
  v := public.fn_sud_clase_incarca(t1, pg_temp.np_cale('p1', 't1', 'schema1.pdf'), 'schema1.pdf', repeat('b1', 32), '{"intervale": [], "model": "dry"}');
  INSERT INTO np_fix VALUES ('s1', v);
  PERFORM pg_temp.np_astept('t_clase', 'a doua sursa pe tronson', pg_temp.np_cod(format('SELECT public.fn_sud_clase_incarca(%s, %L, ''s.pdf'', %L, NULL)',
    t1, pg_temp.np_cale('p1', 't1', 'schema2.pdf'), repeat('b2', 32))), '23505');
  PERFORM pg_temp.np_astept('t_clase', 'intervale suprapuse', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": 0, "km_pana": 1000, "clasa": "1"}, {"km_de": 999.999, "km_pana": 2000, "clasa": "2"}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'interval cuprins in altul', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": 0, "km_pana": 1000, "clasa": "1"}, {"km_de": 100, "km_pana": 200, "clasa": "1"}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'clasa 5', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": 0, "km_pana": 1000, "clasa": "5"}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'clasa numar', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": 0, "km_pana": 1000, "clasa": 2}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'km cu 4 zecimale', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": 0, "km_pana": 1000.0001, "clasa": "1"}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'km_pana = km_de', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": 10, "km_pana": 10, "clasa": "1"}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'km negativ', pg_temp.np_cod(format(fi, v, 1, '[{"km_de": -1, "km_pana": 10, "clasa": "1"}]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'fara intervale', pg_temp.np_cod(format(fi, v, 1, '[]')), '22023');
  PERFORM pg_temp.np_astept('t_clase', 'versiune veche', pg_temp.np_cod(format(fi, v, 2, bune::text)), '40001');
  PERFORM pg_temp.np_ca('c');
  PERFORM pg_temp.np_astept('t_clase', 'MP-ul altui proiect confirma', pg_temp.np_cod(format(fi, v, 1, bune::text)), '42501');
  PERFORM pg_temp.np_ca('b');
  n := public.fn_sud_clase_confirma(v, 1, bune);
  IF n <> 3 THEN RAISE EXCEPTION 't_clase FAIL: % intervale (astepta 3)', n; END IF;
  PERFORM pg_temp.np_astept('t_clase', 'a doua confirmare', pg_temp.np_cod(format(fi, v, 2, bune::text)), '55000');
  PERFORM pg_temp.np_astept('t_clase', 'anulare cu versiune veche', pg_temp.np_cod(format('SELECT public.fn_sud_clase_anuleaza(%s, 1, ''gresit'')', v)), '40001');
  PERFORM public.fn_sud_clase_anuleaza(v, 2, 'schema gresita');
  PERFORM pg_temp.np_ca('a');
  IF (SELECT string_agg(km_de::text || '-' || km_pana::text || ':' || clasa || ':' || anulat::text, ',' ORDER BY ordine) FROM public.sud_clase_interval WHERE sursa_id = v)
       IS DISTINCT FROM '0-1000:1:true,1000-2500.5:2:true,2500.5-4000:3:true' THEN
    RAISE EXCEPTION 't_clase FAIL: intervalele sursei anulate';
  END IF;
  PERFORM pg_temp.np_ca('b');
  v := public.fn_sud_clase_incarca(t1, pg_temp.np_cale('p1', 't1', 'schema2.pdf'), 'schema2.pdf', repeat('b2', 32), NULL);
  INSERT INTO np_fix VALUES ('s2', v);
  IF public.fn_sud_clase_confirma(v, 1, '[{"km_de": 0, "km_pana": 3000, "clasa": "2"}, {"km_de": 3000, "km_pana": 4000, "clasa": "4"}]') <> 2 THEN
    RAISE EXCEPTION 't_clase FAIL: sursa noua dupa anulare';
  END IF;
  RAISE NOTICE 'DRY 20270116a t_clase ok';
END $t$;
-- constrangerea de excludere (R11), direct pe tabel (ca postgres): o suprapunere pe acelasi tronson = 23P01; pe alt tronson sau anulata = permisa
RESET ROLE;
DO $t$
DECLARE v_s bigint := pg_temp.np_id('s2'); v_p bigint := pg_temp.np_id('p1'); v_t bigint := pg_temp.np_id('t1'); v_t2 bigint := pg_temp.np_id('t2');
  f text := 'INSERT INTO public.sud_clase_interval (sursa_id, proiect_id, tronson_id, ordine, km_de, km_pana, clasa, anulat) VALUES (%s, %s, %s, %s, %s, %s, ''1'', %L::boolean)';
  p text := 'DO $x$ BEGIN %s; RAISE EXCEPTION ''inserat'' USING ERRCODE = ''P0099''; END $x$';
BEGIN
  PERFORM pg_temp.np_astept('t_excludere', 'suprapunere pe acelasi tronson', pg_temp.np_cod(format(f, v_s, v_p, v_t, 90, 2999.999, 3500, false)), '23P01');
  PERFORM pg_temp.np_astept('t_excludere', 'capat comun pe acelasi tronson', pg_temp.np_cod(format(p, format(f, v_s, v_p, v_t, 91, 4000, 4500, false))), 'P0099');
  PERFORM pg_temp.np_astept('t_excludere', 'acelasi interval pe alt tronson', pg_temp.np_cod(format(p, format(f, v_s, v_p, v_t2, 92, 0, 3000, false))), 'P0099');
  PERFORM pg_temp.np_astept('t_excludere', 'suprapunere anulata', pg_temp.np_cod(format(p, format(f, v_s, v_p, v_t, 93, 0, 3000, true))), 'P0099');
  RAISE NOTICE 'DRY 20270116a t_excludere ok';
END $t$;
SET LOCAL ROLE authenticated;

-- ── t_subcontr: marcajul pe un pachet existent, cu codul si revizia LUI, PDF-ul + Excel-ul (sau motivul lipsei Excel-ului, D19); cheia = tronson + cod + revizie ──
DO $t$
DECLARE c text; v bigint; k1 bigint := pg_temp.np_id('k1'); k2 bigint := pg_temp.np_id('k2');
  f text := 'SELECT public.fn_sud_subcontr_marcheaza(%s, %L, %s, ''DRY SUBCONTR SRL'', %L, ''sub1.pdf'', %L, %L, ''sub1.xlsx'', %L, %L)';
  pdf text := pg_temp.np_cale('p1', 't1', 'sub1.pdf'); xls text := pg_temp.np_cale('p1', 't1', 'sub1.xlsx');
  hp text := repeat('c1', 32); hx text := repeat('c2', 32);
BEGIN
  FOREACH c IN ARRAY ARRAY['c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.np_ca(c);
    PERFORM pg_temp.np_astept('t_subcontr', 'contul ' || c, pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 1, pdf, hp, xls, hx, NULL)), '42501');
  END LOOP;
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_subcontr', 'alt cod decat al pachetului', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-09', 1, pdf, hp, xls, hx, NULL)), '22023');
  PERFORM pg_temp.np_astept('t_subcontr', 'alta revizie decat a pachetului', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 2, pdf, hp, xls, hx, NULL)), '22023');
  PERFORM pg_temp.np_astept('t_subcontr', 'fara PDF', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 1, NULL, hp, xls, hx, NULL)), '22023');
  -- fără Excel: cale, nume și amprentă toate lipsă (formatul f pune numele Excel-ului, deci cazul are apelul lui)
  PERFORM pg_temp.np_astept('t_subcontr', 'fara Excel si fara motiv', pg_temp.np_cod(format(
    'SELECT public.fn_sud_subcontr_marcheaza(%s, ''DRY-SUB-DOC-01'', 1, NULL, %L, ''sub1.pdf'', %L, NULL, NULL, NULL, NULL)', k1, pdf, hp)), '22023');
  PERFORM pg_temp.np_astept('t_subcontr', 'fara Excel cu motiv prea scurt', pg_temp.np_cod(format(
    'SELECT public.fn_sud_subcontr_marcheaza(%s, ''DRY-SUB-DOC-01'', 1, NULL, %L, ''sub1.pdf'', %L, NULL, NULL, NULL, ''nu'')', k1, pdf, hp)), '22023');
  PERFORM pg_temp.np_astept('t_subcontr', 'Excel si motiv deodata', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 1, pdf, hp, xls, hx, 'nu l-am primit')), '22023');
  PERFORM pg_temp.np_astept('t_subcontr', 'Excel = acelasi fisier cu PDF-ul', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 1, pdf, hp, pdf, hp, NULL)), '22023');
  PERFORM pg_temp.np_astept('t_subcontr', 'pachet inexistent', pg_temp.np_cod(format(f, -1, 'DRY-SUB-DOC-01', 1, pdf, hp, xls, hx, NULL)), '22023');
  -- codul scris altfel (litere mici, spatii) = acelasi document
  v := public.fn_sud_subcontr_marcheaza(k1, ' dry-sub-doc-01 ', 1, 'DRY SUBCONTR SRL', pdf, 'sub1.pdf', hp, xls, 'sub1.xlsx', hx, NULL);
  INSERT INTO np_fix VALUES ('m1', v);
  PERFORM pg_temp.np_astept('t_subcontr', 'al doilea marcaj pe acelasi document + revizie', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 1, pdf, hp, xls, hx, NULL)), '23505');
  -- rezerva D19: fara Excel, cu motiv → sursa randurilor = citirea AI a PDF-ului
  v := public.fn_sud_subcontr_marcheaza(k2, 'DRY-SUB-DOC-02', 0, NULL, pg_temp.np_cale('p1', 't1', 'sub2.pdf'), 'sub2.pdf', repeat('c3', 32), NULL, NULL, NULL, 'subcontractorul nu are Excel');
  INSERT INTO np_fix VALUES ('m2', v);
  PERFORM pg_temp.np_ca('a');
  IF (SELECT string_agg(concat_ws(':', cod_document, cod_document_cheie, revizie, sursa_randuri, activ::text, creat_de), ',' ORDER BY id) FROM public.sud_pachete_subcontractor)
       IS DISTINCT FROM 'dry-sub-doc-01:DRY-SUB-DOC-01:1:excel:true:' || pg_temp.np_u('b') || ',DRY-SUB-DOC-02:DRY-SUB-DOC-02:0:ai_pdf:true:' || pg_temp.np_u('b') THEN
    RAISE EXCEPTION 't_subcontr FAIL: marcajele scrise de server';
  END IF;
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_subcontr', 'retragere cu versiune veche', pg_temp.np_cod(format('SELECT public.fn_sud_subcontr_retrage(%s, 2, ''gresit'')', pg_temp.np_id('m1'))), '40001');
  PERFORM pg_temp.np_astept('t_subcontr', 'retragere fara motiv', pg_temp.np_cod(format('SELECT public.fn_sud_subcontr_retrage(%s, 1, NULL)', pg_temp.np_id('m1'))), '22023');
  PERFORM public.fn_sud_subcontr_retrage(pg_temp.np_id('m1'), 1, 'pachet gresit');
  PERFORM pg_temp.np_astept('t_subcontr', 'a doua retragere', pg_temp.np_cod(format('SELECT public.fn_sud_subcontr_retrage(%s, 2, ''din nou'')', pg_temp.np_id('m1'))), '55000');
  -- dupa retragere, documentul se poate marca din nou
  PERFORM pg_temp.np_astept('t_subcontr', 'marcaj nou dupa retragere', pg_temp.np_cod(format(f, k1, 'DRY-SUB-DOC-01', 1, pdf, hp, xls, hx, NULL)), 'ok');
  RAISE NOTICE 'DRY 20270116a t_subcontr ok';
END $t$;

-- ── t_citire: cine vede randurile noi pe P1 (owner, executie, ctc da; MP fara modul, MP-ul altui proiect, fara modul nu — R9) ──
DO $t$
DECLARE c text; s text; v_ast text;
BEGIN
  FOREACH c IN ARRAY ARRAY['a', 'b', 'c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.np_ca(c);
    SELECT concat_ws('|', (SELECT count(*) FROM public.sud_coordonate_incarcari), (SELECT count(*) FROM public.sud_coordonate), (SELECT count(*) FROM public.sud_clase_surse),
                     (SELECT count(*) FROM public.sud_clase_interval), (SELECT count(*) FROM public.sud_pachete_subcontractor),
                     (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-sud-doc')) INTO s;
    -- U1 (3) + U2 (3) + U3 (2) = 8 pozitii in 3 incarcari; 2 surse (3 + 2 intervale); 3 marcaje; 10 fisiere (8 + 1 pe T13 + 1 al ownerului)
    v_ast := CASE WHEN c IN ('a', 'd', 'e') THEN '3|8|2|5|3|10' ELSE '0|0|0|0|0|0' END;
    IF s IS DISTINCT FROM v_ast THEN RAISE EXCEPTION 't_citire FAIL: contul % vede % (astepta %)', c, s, v_ast; END IF;
  END LOOP;
  RAISE NOTICE 'DRY 20270116a t_citire ok';
END $t$;

-- ── t_export_inventar: fotografia inventarului cere pozitiile active, sursa claselor si amprentele pachetelor tronsonului (R6); diferenta = 40001
--    cu numele sursei; exportul IZO ramane ca in 20270115b ──
CREATE FUNCTION pg_temp.np_foto(p_coord jsonb, p_clase jsonb, p_pachete jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('buletine', '[]'::jsonb, 'eliminate', '[]'::jsonb, 'metode', '[]'::jsonb, 'lipsuri_blocante', '[]'::jsonb,
    'amprenta_pachet', public.fn_sud_amprenta_pachet(pg_temp.np_id('k1')), 'coordonate', p_coord, 'clase', p_clase, 'pachete', p_pachete)
$f$;
CREATE FUNCTION pg_temp.np_coord() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT coalesce(jsonb_agg(id ORDER BY id), '[]') FROM public.sud_coordonate WHERE tronson_id = pg_temp.np_id('t1') AND stare = 'activ'
$f$;
CREATE FUNCTION pg_temp.np_clase() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('id', pg_temp.np_id('s2'), 'versiune', 2)
$f$;
CREATE FUNCTION pg_temp.np_pachete() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_array(jsonb_build_object('id', pg_temp.np_id('k1'), 'amprenta', public.fn_sud_amprenta_pachet(pg_temp.np_id('k1'))),
                           jsonb_build_object('id', pg_temp.np_id('k2'), 'amprenta', public.fn_sud_amprenta_pachet(pg_temp.np_id('k2'))))
$f$;
DO $t$
DECLARE k1 bigint := pg_temp.np_id('k1'); r text; v bigint; fo jsonb;
  f text := 'SELECT public.fn_sud_export_inregistreaza(%s, %L, %L::jsonb, NULL, NULL)';
BEGIN
  PERFORM pg_temp.np_ca('d');
  fo := pg_temp.np_foto(pg_temp.np_coord(), pg_temp.np_clase(), pg_temp.np_pachete());
  PERFORM pg_temp.np_astept('t_export', 'inventar fara coordonate', pg_temp.np_cod(format(f, k1, 'inventar', (fo - 'coordonate')::text)), '22023');
  PERFORM pg_temp.np_astept('t_export', 'inventar fara cheia clase', pg_temp.np_cod(format(f, k1, 'inventar', (fo - 'clase')::text)), '22023');
  PERFORM pg_temp.np_astept('t_export', 'inventar cu pachete in alta forma', pg_temp.np_cod(format(f, k1, 'inventar',
    jsonb_set(fo, '{pachete}', jsonb_build_array(jsonb_build_object('id', k1)))::text)), '22023');
  PERFORM pg_temp.np_astept('t_export', 'inventar cu clase {id} fara versiune', pg_temp.np_cod(format(f, k1, 'inventar',
    jsonb_set(fo, '{clase}', jsonb_build_object('id', pg_temp.np_id('s2')))::text)), '22023');
  r := pg_temp.np_cod(format(f, k1, 'inventar', jsonb_set(fo, '{coordonate}', '[]')::text));
  IF r NOT LIKE '40001: %(coordonate)%' THEN RAISE EXCEPTION 't_export FAIL: coordonatele lipsa = % (astepta 40001 cu coordonate)', r; END IF;
  r := pg_temp.np_cod(format(f, k1, 'inventar', jsonb_set(fo, '{clase}', 'null')::text));
  IF r NOT LIKE '40001: %(clase)%' THEN RAISE EXCEPTION 't_export FAIL: clasele lipsa = % (astepta 40001 cu clase)', r; END IF;
  r := pg_temp.np_cod(format(f, k1, 'inventar', jsonb_set(fo, '{clase}', jsonb_build_object('id', pg_temp.np_id('s1'), 'versiune', 3))::text));
  IF r NOT LIKE '40001: %(clase)%' THEN RAISE EXCEPTION 't_export FAIL: sursa anulata = % (astepta 40001 cu clase)', r; END IF;
  r := pg_temp.np_cod(format(f, k1, 'inventar', jsonb_set(fo, '{pachete}', pg_temp.np_pachete() - 1)::text));
  IF r NOT LIKE '40001: %(pachete)%' THEN RAISE EXCEPTION 't_export FAIL: pachetul vecin lipsa = % (astepta 40001 cu pachete)', r; END IF;
  PERFORM pg_temp.np_ca('c');
  PERFORM pg_temp.np_astept('t_export', 'MP-ul altui proiect', pg_temp.np_cod(format(f, k1, 'inventar', fo::text)), '42501');
  PERFORM pg_temp.np_ca('d');
  v := public.fn_sud_export_inregistreaza(k1, 'inventar', fo, NULL, NULL);
  -- IZO: fotografia 20270115b (fara cheile inventarului) trece neschimbat
  PERFORM pg_temp.np_astept('t_export', 'export IZO fara cheile inventarului', pg_temp.np_cod(format(f, k1, 'izo', (fo - 'coordonate' - 'clase' - 'pachete')::text)), 'ok');
  PERFORM pg_temp.np_ca('a');
  IF (SELECT fotografie->'pachete' FROM public.sud_exporturi WHERE id = v) IS DISTINCT FROM fo->'pachete' THEN RAISE EXCEPTION 't_export FAIL: fotografia nu e pastrata'; END IF;
  RAISE NOTICE 'DRY 20270116a t_export ok';
END $t$;
-- o schimbare in pachetul VECIN dupa deschiderea ferestrei (elementul aval, R7) = 40001 „pachete”; o pozitie noua = 40001 „coordonate”
-- (tabelul temporar il creeaza postgres; fotografia se calculeaza cu JWT-ul contului d, ramas setat)
RESET ROLE;
CREATE TEMP TABLE np_foto_veche ON COMMIT DROP AS SELECT pg_temp.np_foto(pg_temp.np_coord(), pg_temp.np_clase(), pg_temp.np_pachete()) AS f;
GRANT SELECT ON np_foto_veche TO authenticated;
UPDATE public.executie_tevi SET sarja = 'SJ-DRY-2' WHERE id = pg_temp.np_id('tv2');
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r text;
BEGIN
  PERFORM pg_temp.np_ca('d');
  r := pg_temp.np_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''inventar'', %L::jsonb, NULL, NULL)', pg_temp.np_id('k1'), (SELECT f FROM np_foto_veche)::text));
  IF r NOT LIKE '40001: %(pachete)%' THEN RAISE EXCEPTION 't_export_dupa FAIL: pachetul vecin schimbat = % (astepta 40001 cu pachete)', r; END IF;
  RAISE NOTICE 'DRY 20270116a t_export_dupa ok';
END $t$;

-- ── t_scrieri_directe: nicio scriere directa pe tabelele noi (nici owner-ul); secventele si ajutatoarele fara drept ──
DO $t$
DECLARE c text; t text;
BEGIN
  FOREACH c IN ARRAY ARRAY['a', 'b'] LOOP
    PERFORM pg_temp.np_ca(c);
    FOREACH t IN ARRAY ARRAY['sud_coordonate_incarcari', 'sud_coordonate', 'sud_clase_surse', 'sud_clase_interval', 'sud_pachete_subcontractor'] LOOP
      PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' UPDATE ' || t, pg_temp.np_cod(format('UPDATE public.%I SET proiect_id = proiect_id', t)), '42501');
      PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' DELETE ' || t, pg_temp.np_cod(format('DELETE FROM public.%I', t)), '42501');
      PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' nextval ' || t, pg_temp.np_cod(format('SELECT nextval(%L)', 'public.' || t || '_id_seq')), '42501');
    END LOOP;
    PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' INSERT sud_coordonate', pg_temp.np_cod(format('INSERT INTO public.sud_coordonate (incarcare_id, proiect_id, tronson_id, linie, cod_raw, cod, cheie, cod_corectat, x, y, z, stare)
      VALUES (%s, %s, %s, 99, ''T12S9'', ''T12S9'', ''T12S9'', false, 1, 2, 3, ''activ'')', pg_temp.np_id('u1'), pg_temp.np_id('p1'), pg_temp.np_id('t1'))), '42501');
    PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' ajutatorul fisierului', pg_temp.np_cod(format('SELECT public.fn_sud_doc_fisier_ok(%s, %s, ''x'')', pg_temp.np_id('p1'), pg_temp.np_id('t1'))), '42501');
    PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' validarea randului', pg_temp.np_cod('SELECT public.fn_sud_coord_rand_valid(''{}'')'), '42501');
    PERFORM pg_temp.np_astept('t_scrieri_directe', c || ' validarea intervalului', pg_temp.np_cod('SELECT public.fn_sud_clasa_interval_valid(''{}'')'), '42501');
  END LOOP;
  PERFORM pg_temp.np_ca('b');
  PERFORM pg_temp.np_astept('t_scrieri_directe', 'UPDATE pe fisierul din izo-sud-doc', pg_temp.np_cod(format('DO $x$ BEGIN UPDATE storage.objects SET name = name WHERE bucket_id = ''izo-sud-doc'';
    IF FOUND THEN RAISE EXCEPTION ''actualizat'' USING ERRCODE = ''P0098''; END IF; END $x$')), 'ok');
  RAISE NOTICE 'DRY 20270116a t_scrieri_directe ok';
END $t$;
RESET ROLE;

-- ── t_anon: fara EXECUTE / SELECT ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR current_user <> 'anon' THEN RAISE EXCEPTION 't_anon: identitate gresita'; END IF;
  PERFORM pg_temp.np_astept('t_anon', 'SELECT coordonate', pg_temp.np_cod('SELECT count(*) FROM public.sud_coordonate'), '42501');
  PERFORM pg_temp.np_astept('t_anon', 'SELECT clase', pg_temp.np_cod('SELECT count(*) FROM public.sud_clase_interval'), '42501');
  PERFORM pg_temp.np_astept('t_anon', 'incarca coordonate', pg_temp.np_cod(format('SELECT public.fn_sud_coord_incarca(%s, ''x'', ''x'', %L, ''[]'', NULL)', pg_temp.np_id('t1'), repeat('a', 64))), '42501');
  PERFORM pg_temp.np_astept('t_anon', 'marcheaza', pg_temp.np_cod(format('SELECT public.fn_sud_subcontr_marcheaza(%s, ''x'', 0, NULL, ''x'', NULL, NULL, NULL, NULL, NULL, ''motiv lung'')', pg_temp.np_id('k1'))), '42501');
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-sud-doc') <> 0 THEN RAISE EXCEPTION 't_anon FAIL: anon vede fisiere din izo-sud-doc'; END IF;
  RAISE NOTICE 'DRY 20270116a t_anon ok';
END $t$;
RESET ROLE;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270116a TOTUL OK'; END $t$;
ROLLBACK;
