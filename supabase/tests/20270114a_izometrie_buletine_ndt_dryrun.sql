-- DRY 20270114a_izometrie_buletine_ndt: se ruleaza DUPA aplicarea migrarii, intr-o singura tranzactie cu ROLLBACK la final (nimic ramane),
-- pe clona PG17 (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_izometrie_buletine_ndt_local.mjs). Fiecare bloc scrie
-- NOTICE 'DRY 20270114a <bloc> ok …'; orice abatere = exceptie. Valorile asteptate vin din spec (docs/izometrie/BULETINE_NDT_SPEC.md §21–§22),
-- nu din codul testat (L25). Identitatea: ambele surse JWT + SET LOCAL ROLE authenticated, verificate la fiecare schimbare (auth.uid,
-- current_user, rol fara BYPASSRLS). Conturi SINTETICE (uuid-uri f1000000-…): a = owner, b = managerul proiectului P1 (fisa 9211), c = managerul
-- P2 (fisa 9212), d = 'executie' editor, e = 'ctc' editor, g = fara modul, h = 'executie' editor RESTRANS (20261209a) la P2 ca viewer.
-- Proiectele P1 / P2 cu cate un tronson 'TR12' si un pachet. Fisierele din bucket-ul izo-ndt le scrie contul, ca Storage API (owner = auth.uid()).
-- FIXTURI: pe clona, daca employees / profiles / executie_tronsoane / executie_pachete_lansare cer alte coloane NOT NULL, se completeaza DOAR blocul
-- FIXTURI (restul nu depinde de ele). Constrangerile productiei cunoscute (22.11.2026): employees.department NOT NULL, profiles.role explicit,
-- o fisa = un cont, user_module_access.module → app_modules(key).
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE nd_fix (k text PRIMARY KEY, id bigint) ON COMMIT DROP;
GRANT SELECT, INSERT ON nd_fix TO authenticated;
GRANT SELECT ON nd_fix TO anon;

-- ── t_migrare: precondiția (migrarea aplicată) ──
DO $t$
BEGIN
  IF to_regclass('public.sud_buletine') IS NULL OR to_regclass('public.sud_buletin_randuri') IS NULL OR to_regclass('public.sud_exporturi') IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_sud\_%') <> 11
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-ndt' AND public IS FALSE)
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname IN ('sud_ndt_citire', 'sud_ndt_incarcare')) <> 2 THEN
    RAISE EXCEPTION 't_migrare FAIL: migrarea 20270114a nu e aplicata';
  END IF;
  RAISE NOTICE 'DRY 20270114a t_migrare ok';
END $t$;

-- ── FIXTURI (identitati sintetice; id-urile proiectelor / tronsoanelor / pachetelor vin din RETURNING) ──
DO $fix$
DECLARE v bigint; v_t bigint;
BEGIN
  INSERT INTO public.employees (id, name, department) VALUES (9211, 'DRY NDT MP UNU', 'Executie'), (9212, 'DRY NDT MP DOI', 'Executie');
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x::uuid FROM unnest(ARRAY['f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000b1',
      'f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000e1',
      'f1000000-0000-4000-8000-0000000000f1', 'f1000000-0000-4000-8000-0000000000a2']) x
    ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles (id, is_owner, employee_id, role) VALUES
    ('f1000000-0000-4000-8000-0000000000a1', true, NULL, 'teren'), ('f1000000-0000-4000-8000-0000000000b1', false, 9211, 'teren'),
    ('f1000000-0000-4000-8000-0000000000c1', false, 9212, 'teren'), ('f1000000-0000-4000-8000-0000000000d1', false, NULL, 'teren'),
    ('f1000000-0000-4000-8000-0000000000e1', false, NULL, 'teren'), ('f1000000-0000-4000-8000-0000000000f1', false, NULL, 'teren'),
    ('f1000000-0000-4000-8000-0000000000a2', false, NULL, 'teren')
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, employee_id = EXCLUDED.employee_id, role = EXCLUDED.role;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage) VALUES ('executie', NULL, 'Executie', true, true), ('ctc', NULL, 'CTC', true, true)
    ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('f1000000-0000-4000-8000-0000000000d1', 'executie', 'editor'), ('f1000000-0000-4000-8000-0000000000e1', 'ctc', 'editor'),
    ('f1000000-0000-4000-8000-0000000000a2', 'executie', 'editor');
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('DRY-NDT-P1', 'Dry NDT P1', 9211) RETURNING id INTO v;
  INSERT INTO nd_fix VALUES ('p1', v);
  INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (v, 'TR12') RETURNING id INTO v_t;
  INSERT INTO nd_fix VALUES ('t1', v_t);
  INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id) VALUES (v, v_t) RETURNING id INTO v_t;
  INSERT INTO nd_fix VALUES ('k1', v_t);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('DRY-NDT-P2', 'Dry NDT P2', 9212) RETURNING id INTO v;
  INSERT INTO nd_fix VALUES ('p2', v);
  INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (v, 'TR12') RETURNING id INTO v_t;
  INSERT INTO nd_fix VALUES ('t2', v_t);
  INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id) VALUES (v, v_t) RETURNING id INTO v_t;
  INSERT INTO nd_fix VALUES ('k2', v_t);
  -- h (a2): RESTRANS la P2 ca viewer; scrierea directa aici e fixtura (pe productie: fn_executie_acces_proiect_seteaza)
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('f1000000-0000-4000-8000-0000000000a2', (SELECT id FROM nd_fix WHERE k = 'p2'), 'viewer');
  RAISE NOTICE 'DRY 20270114a fixturi ok: P1 %, P2 %', (SELECT id FROM nd_fix WHERE k = 'p1'), (SELECT id FROM nd_fix WHERE k = 'p2');
END $fix$;
CREATE FUNCTION pg_temp.nd_id(p text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT id FROM nd_fix WHERE k = p $f$;
-- contul curent: ambele surse JWT (ca PostgREST) + verificarea identitatii (auth.uid, rolul authenticated, fara BYPASSRLS)
CREATE FUNCTION pg_temp.nd_ca(p text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := ('f1000000-0000-4000-8000-0000000000' || CASE p WHEN 'a' THEN 'a1' WHEN 'b' THEN 'b1' WHEN 'c' THEN 'c1' WHEN 'd' THEN 'd1'
                     WHEN 'e' THEN 'e1' WHEN 'g' THEN 'f1' WHEN 'h' THEN 'a2' END)::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM v OR current_user <> 'authenticated' OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'identitate gresita: uid % user %', auth.uid(), current_user;
  END IF;
END $f$;
-- rezultatul unei instructiuni intr-o sub-tranzactie: 'ok' sau SQLSTATE: mesaj (instructiunea e text scris in acest fisier, nu date externe)
CREATE FUNCTION pg_temp.nd_cod(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.nd_astept(p_bloc text, p_ce text, p_rez text, p_cod text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_rez IS NULL OR (p_cod = 'ok' AND p_rez <> 'ok') OR (p_cod <> 'ok' AND left(p_rez, length(p_cod) + 1) <> p_cod || ':') THEN
    RAISE EXCEPTION '% FAIL: % = % (astepta %)', p_bloc, p_ce, coalesce(p_rez, 'NULL'), p_cod;
  END IF;
END $f$;

SET LOCAL ROLE authenticated;

-- ── t_drept: fn_sud_drept (O SINGURA definitie, R9): owner tot; MP doar proiectul lui; 'executie' / 'ctc' doar citire; restrans doar P2 ──
DO $t$
DECLARE c text; s text; v_ast text;
BEGIN
  FOREACH c IN ARRAY ARRAY['a', 'b', 'c', 'd', 'e', 'g', 'h'] LOOP
    PERFORM pg_temp.nd_ca(c);
    s := concat(public.fn_sud_drept(pg_temp.nd_id('p1'), false)::int, public.fn_sud_drept(pg_temp.nd_id('p1'), true)::int,
                public.fn_sud_drept(pg_temp.nd_id('p2'), false)::int, public.fn_sud_drept(pg_temp.nd_id('p2'), true)::int);
    v_ast := CASE c WHEN 'a' THEN '1111' WHEN 'b' THEN '1100' WHEN 'c' THEN '0011' WHEN 'd' THEN '1010' WHEN 'e' THEN '1010' WHEN 'g' THEN '0000' ELSE '0010' END;
    IF s IS DISTINCT FROM v_ast THEN RAISE EXCEPTION 't_drept FAIL: contul % are [P1 citire, P1 scriere, P2 citire, P2 scriere] = % (astepta %)', c, s, v_ast; END IF;
  END LOOP;
  RAISE NOTICE 'DRY 20270114a t_drept ok (7 conturi x 4 drepturi)';
END $t$;

-- ── t_metode: doar owner / MP pe proiectul lui; lista alba PM / PA-UT / UT ──
DO $t$
BEGIN
  PERFORM pg_temp.nd_ca('b');
  PERFORM pg_temp.nd_astept('t_metode', 'MP P1 seteaza', pg_temp.nd_cod(format('SELECT public.fn_sud_metode_seteaza(%s, ARRAY[''PM'', ''PA-UT'', ''PM''])', pg_temp.nd_id('p1'))), 'ok');
  PERFORM pg_temp.nd_astept('t_metode', 'MP P1 pe P2', pg_temp.nd_cod(format('SELECT public.fn_sud_metode_seteaza(%s, ARRAY[''PM''])', pg_temp.nd_id('p2'))), '42501');
  PERFORM pg_temp.nd_astept('t_metode', 'metoda RT', pg_temp.nd_cod(format('SELECT public.fn_sud_metode_seteaza(%s, ARRAY[''RT''])', pg_temp.nd_id('p1'))), '22023');
  IF (SELECT metode FROM public.sud_metode_proiect WHERE proiect_id = pg_temp.nd_id('p1')) IS DISTINCT FROM ARRAY['PA-UT', 'PM']
     OR (SELECT actualizat_de FROM public.sud_metode_proiect WHERE proiect_id = pg_temp.nd_id('p1')) IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 't_metode FAIL: metodele P1 nu sunt {PA-UT,PM} cu autorul pus de server';
  END IF;
  PERFORM pg_temp.nd_ca('d');
  PERFORM pg_temp.nd_astept('t_metode', 'editor executie', pg_temp.nd_cod(format('SELECT public.fn_sud_metode_seteaza(%s, ARRAY[''PM''])', pg_temp.nd_id('p1'))), '42501');
  RAISE NOTICE 'DRY 20270114a t_metode ok';
END $t$;

-- ── t_storage: încărcarea în izo-ndt doar pe <proiect>/<tronson al proiectului>/<nume>, de owner / MP; citirea dupa dreptul de citire ──
DO $t$
DECLARE n int;
BEGIN
  PERFORM pg_temp.nd_ca('b');
  PERFORM pg_temp.nd_astept('t_storage', 'MP P1 urca pe P1/T1', pg_temp.nd_cod(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''izo-ndt'', %L, auth.uid())',
    pg_temp.nd_id('p1') || '/' || pg_temp.nd_id('t1') || '/dry1.pdf')), 'ok');
  PERFORM pg_temp.nd_astept('t_storage', 'MP P1 urca al doilea', pg_temp.nd_cod(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''izo-ndt'', %L, auth.uid())',
    pg_temp.nd_id('p1') || '/' || pg_temp.nd_id('t1') || '/dry2.pdf')), 'ok');
  PERFORM pg_temp.nd_astept('t_storage', 'MP P1 urca pe P2/T2', pg_temp.nd_cod(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''izo-ndt'', %L, auth.uid())',
    pg_temp.nd_id('p2') || '/' || pg_temp.nd_id('t2') || '/x.pdf')), '42501');
  PERFORM pg_temp.nd_astept('t_storage', 'MP P1 urca tronsonul P2 sub P1', pg_temp.nd_cod(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''izo-ndt'', %L, auth.uid())',
    pg_temp.nd_id('p1') || '/' || pg_temp.nd_id('t2') || '/x.pdf')), '42501');
  PERFORM pg_temp.nd_ca('a');
  PERFORM pg_temp.nd_astept('t_storage', 'owner urca pe P1/T1', pg_temp.nd_cod(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''izo-ndt'', %L, auth.uid())',
    pg_temp.nd_id('p1') || '/' || pg_temp.nd_id('t1') || '/dryA.pdf')), 'ok');
  PERFORM pg_temp.nd_ca('d');
  PERFORM pg_temp.nd_astept('t_storage', 'editor executie urca', pg_temp.nd_cod(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (''izo-ndt'', %L, auth.uid())',
    pg_temp.nd_id('p1') || '/' || pg_temp.nd_id('t1') || '/d.pdf')), '42501');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'izo-ndt' AND name LIKE pg_temp.nd_id('p1') || '/%';
  IF n <> 3 THEN RAISE EXCEPTION 't_storage FAIL: editorul executie vede % fisiere P1 (astepta 3)', n; END IF;
  PERFORM pg_temp.nd_ca('g');
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'izo-ndt' AND name LIKE pg_temp.nd_id('p1') || '/%') THEN RAISE EXCEPTION 't_storage FAIL: contul fara modul vede fisiere'; END IF;
  PERFORM pg_temp.nd_ca('c');
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'izo-ndt' AND name LIKE pg_temp.nd_id('p1') || '/%') THEN RAISE EXCEPTION 't_storage FAIL: MP P2 vede fisierele P1'; END IF;
  PERFORM pg_temp.nd_ca('h');
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'izo-ndt' AND name LIKE pg_temp.nd_id('p1') || '/%') THEN RAISE EXCEPTION 't_storage FAIL: contul restrans la P2 vede fisierele P1'; END IF;
  RAISE NOTICE 'DRY 20270114a t_storage ok';
END $t$;

-- ── t_incarca: fisierul propriu din arhiva tronsonului; dubluri pe amprenta / cheie (23505 cu id); fortarea cu motiv; scrierile directe = refuz ──
DO $t$
DECLARE v_id bigint; v_p bigint := pg_temp.nd_id('p1'); v_t bigint := pg_temp.nd_id('t1'); r text; c text;
  f text := 'SELECT public.fn_sud_buletin_incarca(%s, %L, %L, DATE ''2026-11-20'', ''LAB DRY'', %L, ''b.pdf'', %L, NULL, %L)';
BEGIN
  PERFORM pg_temp.nd_ca('b');
  v_id := public.fn_sud_buletin_incarca(v_t, 'PA-UT', ' d-12/ab ', DATE '2026-11-20', 'LAB DRY', v_p || '/' || v_t || '/dry1.pdf', 'dry1.pdf', repeat('d1', 32), NULL, NULL);
  INSERT INTO nd_fix VALUES ('b1', v_id);
  IF (SELECT row(proiect_id, numar_cheie, stare, versiune, incarcat_de) FROM public.sud_buletine WHERE id = v_id)
     IS DISTINCT FROM row(v_p, 'D-12/AB'::text, 'ciorna'::text, 1, auth.uid()) THEN
    RAISE EXCEPTION 't_incarca FAIL: buletinul nu are proiectul / cheia / starea / autorul puse de server';
  END IF;
  PERFORM pg_temp.nd_astept('t_incarca', 'fisier inexistent', pg_temp.nd_cod(format(f, v_t, 'PM', 'X1', v_p || '/' || v_t || '/nu.pdf', repeat('d2', 32), NULL)), '22023');
  PERFORM pg_temp.nd_astept('t_incarca', 'fisierul altui utilizator', pg_temp.nd_cod(format(f, v_t, 'PM', 'X1', v_p || '/' || v_t || '/dryA.pdf', repeat('d2', 32), NULL)), '22023');
  r := pg_temp.nd_cod(format(f, v_t, 'PM', 'X1', v_p || '/' || v_t || '/dry2.pdf', repeat('d1', 32), NULL));
  IF r NOT LIKE '23505: sud: fisier_deja_incarcat:' || v_id THEN RAISE EXCEPTION 't_incarca FAIL: amprenta dubla = % (astepta 23505 cu id %)', r, v_id; END IF;
  r := pg_temp.nd_cod(format(f, v_t, 'PA-UT', 'D-12 / AB', v_p || '/' || v_t || '/dry2.pdf', repeat('d2', 32), NULL));
  IF r NOT LIKE '23505: sud: buletin_deja_incarcat:' || v_id THEN RAISE EXCEPTION 't_incarca FAIL: cheia dubla = % (astepta 23505 cu id %)', r, v_id; END IF;
  PERFORM pg_temp.nd_astept('t_incarca', 'cheia fortata cu motiv', pg_temp.nd_cod(format(f, v_t, 'PA-UT', 'D-12/AB', v_p || '/' || v_t || '/dry2.pdf', repeat('d2', 32), 'alt laborator')), 'ok');
  FOREACH c IN ARRAY ARRAY['d', 'c', 'e'] LOOP
    PERFORM pg_temp.nd_ca(c);
    PERFORM pg_temp.nd_astept('t_incarca', 'contul ' || c || ' incarca pe P1', pg_temp.nd_cod(format(f, v_t, 'PM', 'Y1', v_p || '/' || v_t || '/dry2.pdf', repeat('d3', 32), NULL)), '42501');
  END LOOP;
  PERFORM pg_temp.nd_ca('b');
  PERFORM pg_temp.nd_astept('t_incarca', 'INSERT direct', pg_temp.nd_cod(format('INSERT INTO public.sud_buletine (proiect_id, tronson_id, metoda, numar, numar_cheie, data_buletin, fisier_path, fisier_sha256, incarcat_de) VALUES (%s, %s, ''PM'', ''Z'', ''Z'', DATE ''2026-11-01'', ''x'', %L, auth.uid())', v_p, v_t, repeat('d4', 32))), '42501');
  PERFORM pg_temp.nd_astept('t_incarca', 'UPDATE direct', pg_temp.nd_cod(format('UPDATE public.sud_buletine SET stare = ''confirmat'' WHERE id = %s', v_id)), '42501');
  PERFORM pg_temp.nd_astept('t_incarca', 'DELETE direct', pg_temp.nd_cod(format('DELETE FROM public.sud_buletine WHERE id = %s', v_id)), '42501');
  PERFORM pg_temp.nd_astept('t_incarca', 'nextval pe secventa', pg_temp.nd_cod('SELECT nextval(''public.sud_buletine_id_seq'')'), '42501');
  RAISE NOTICE 'DRY 20270114a t_incarca ok';
END $t$;

-- ── t_confirma: CAS pe versiune (40001), randuri validate, cheia sudurii de la server (§22: refacerea nu intra in cheie) ──
DO $t$
DECLARE v_id bigint := pg_temp.nd_id('b1'); n int; s text;
  ok_r text := '[{"cod_raw": "GAZPET TR12 S126R", "rezultat": "acceptat", "data_inspectie": "2026-11-18"}, {"cod_raw": "T12S88?1", "rezultat": "admis"},
                 {"cod_raw": "GAZPET TR13 S5", "rezultat": "respins"}, {"cod_raw": "S127", "rezultat": "rejected"}]';
BEGIN
  PERFORM pg_temp.nd_ca('b');
  PERFORM pg_temp.nd_astept('t_confirma', 'versiunea veche', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_confirma(%s, 2, %L::jsonb)', v_id, ok_r)), '40001');
  PERFORM pg_temp.nd_astept('t_confirma', 'randuri goale', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_confirma(%s, 1, ''[]''::jsonb)', v_id)), '22023');
  PERFORM pg_temp.nd_astept('t_confirma', 'peste 2000 de randuri', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_confirma(%s, 1, (SELECT jsonb_agg(jsonb_build_object(''cod_raw'', ''S'' || i, ''rezultat'', ''acceptat'')) FROM generate_series(1, 2001) i))', v_id)), '22023');
  PERFORM pg_temp.nd_astept('t_confirma', 'rezultat necunoscut', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_confirma(%s, 1, ''[{"cod_raw": "S1", "rezultat": "poate"}]''::jsonb)', v_id)), '22023');
  PERFORM pg_temp.nd_ca('d');
  PERFORM pg_temp.nd_astept('t_confirma', 'editor executie', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_confirma(%s, 1, %L::jsonb)', v_id, ok_r)), '42501');
  PERFORM pg_temp.nd_ca('b');
  n := public.fn_sud_buletin_confirma(v_id, 1, ok_r::jsonb);
  SELECT string_agg(concat_ws(':', stare_cod, coalesce(motiv_cod, '-'), coalesce(cheie, '-'), CASE WHEN refacuta THEN 'R' ELSE '-' END, rezultat), ',' ORDER BY ordine) INTO s
    FROM public.sud_buletin_randuri WHERE buletin_id = v_id;
  IF n <> 4 OR s IS DISTINCT FROM 'ok:-:T12S126:R:acceptat,nepotrivit:format:-:-:acceptat,nepotrivit:alt_tronson:-:-:respins,ok:-:T12S127:-:respins' THEN
    RAISE EXCEPTION 't_confirma FAIL: randurile = % (%)', s, n;
  END IF;
  IF (SELECT row(stare, versiune, confirmat_de) FROM public.sud_buletine WHERE id = v_id) IS DISTINCT FROM row('confirmat'::text, 2, auth.uid()) THEN
    RAISE EXCEPTION 't_confirma FAIL: buletinul nu e confirmat v2 de MP';
  END IF;
  PERFORM pg_temp.nd_astept('t_confirma', 'a doua confirmare', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_confirma(%s, 2, %L::jsonb)', v_id, ok_r)), '55000');
  RAISE NOTICE 'DRY 20270114a t_confirma ok (4 randuri: T12S126 refacuta, 2 nepotrivite, T12S127)';
END $t$;

-- ── t_citire: cine vede buletinele / randurile P1 (owner, MP P1, executie, ctc da; MP P2, fara modul, restrans la P2 nu) ──
DO $t$
DECLARE c text; nb int; nr int;
BEGIN
  FOREACH c IN ARRAY ARRAY['a', 'b', 'd', 'e', 'c', 'g', 'h'] LOOP
    PERFORM pg_temp.nd_ca(c);
    SELECT count(*) INTO nb FROM public.sud_buletine WHERE proiect_id = pg_temp.nd_id('p1');
    SELECT count(*) INTO nr FROM public.sud_buletin_randuri r WHERE r.buletin_id = pg_temp.nd_id('b1');
    IF (c IN ('a', 'b', 'd', 'e') AND (nb, nr) <> (2, 4)) OR (c IN ('c', 'g', 'h') AND (nb, nr) <> (0, 0)) THEN
      RAISE EXCEPTION 't_citire FAIL: contul % vede % buletine / % randuri pe P1', c, nb, nr;
    END IF;
  END LOOP;
  RAISE NOTICE 'DRY 20270114a t_citire ok';
END $t$;

-- ── t_anulare: confirmat → anulat; anulat → nimic; acelasi fisier si aceeasi cheie se reincarca (R1, §22) ──
DO $t$
DECLARE v_id bigint := pg_temp.nd_id('b1'); v_nou bigint; v_p bigint := pg_temp.nd_id('p1'); v_t bigint := pg_temp.nd_id('t1');
BEGIN
  PERFORM pg_temp.nd_ca('d');
  PERFORM pg_temp.nd_astept('t_anulare', 'editor executie', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_anuleaza(%s, ''gresit'')', v_id)), '42501');
  PERFORM pg_temp.nd_ca('b');
  PERFORM public.fn_sud_buletin_anuleaza(v_id, 'tronson gresit');
  IF (SELECT row(stare, versiune, anulat_de) FROM public.sud_buletine WHERE id = v_id) IS DISTINCT FROM row('anulat'::text, 3, auth.uid()) THEN
    RAISE EXCEPTION 't_anulare FAIL: buletinul nu e anulat v3 de MP';
  END IF;
  PERFORM pg_temp.nd_astept('t_anulare', 'a doua anulare', pg_temp.nd_cod(format('SELECT public.fn_sud_buletin_anuleaza(%s, ''din nou'')', v_id)), '55000');
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('izo-ndt', v_p || '/' || v_t || '/dry1-bis.pdf', auth.uid());
  v_nou := public.fn_sud_buletin_incarca(v_t, 'PA-UT', 'D-12/AB', DATE '2026-11-20', NULL, v_p || '/' || v_t || '/dry1-bis.pdf', NULL, repeat('d1', 32), NULL, NULL);
  IF v_nou IS NULL OR v_nou = v_id THEN RAISE EXCEPTION 't_anulare FAIL: reincarcarea dupa anulare'; END IF;
  RAISE NOTICE 'DRY 20270114a t_anulare ok (reincarcat ca %)', v_nou;
END $t$;

-- ── t_eliminare: sudura taiata (R4) pe cheia fara refacere; dublura; retragere ──
DO $t$
DECLARE v_e bigint; v_t bigint := pg_temp.nd_id('t1');
BEGIN
  PERFORM pg_temp.nd_ca('b');
  v_e := public.fn_sud_sudura_elimina(v_t, 'GAZPET TR12 S126', 'cupon dupa reparatii', ARRAY['S200']);
  IF (SELECT row(cheie, inlocuita_de, activ, creat_de) FROM public.sud_suduri_eliminate WHERE id = v_e) IS DISTINCT FROM row('T12S126'::text, ARRAY['T12S200']::text[], true, auth.uid()) THEN
    RAISE EXCEPTION 't_eliminare FAIL: marcajul nu are cheia / inlocuitorii / autorul de la server';
  END IF;
  PERFORM pg_temp.nd_astept('t_eliminare', 'dublura', pg_temp.nd_cod(format('SELECT public.fn_sud_sudura_elimina(%s, ''T12S126'', ''a doua oara'', NULL)', v_t)), '23505');
  PERFORM pg_temp.nd_astept('t_eliminare', 'cod refacut', pg_temp.nd_cod(format('SELECT public.fn_sud_sudura_elimina(%s, ''T12S126R'', ''refacerea'', NULL)', v_t)), '22023');
  PERFORM pg_temp.nd_ca('c');
  PERFORM pg_temp.nd_astept('t_eliminare', 'MP P2', pg_temp.nd_cod(format('SELECT public.fn_sud_sudura_elimina(%s, ''T12S7'', ''alt MP'', NULL)', v_t)), '42501');
  PERFORM pg_temp.nd_ca('b');
  PERFORM public.fn_sud_sudura_eliminare_retrage(v_e, 'marcaj gresit');
  PERFORM pg_temp.nd_astept('t_eliminare', 'a doua retragere', pg_temp.nd_cod(format('SELECT public.fn_sud_sudura_eliminare_retrage(%s, ''iar'')', v_e)), '22023');
  RAISE NOTICE 'DRY 20270114a t_eliminare ok';
END $t$;

-- ── t_export: deblocarea MP-ului (D11) folosita o data, doar de el, pe acelasi pachet / tip; exportul complet ca azi ──
DO $t$
DECLARE v_d bigint; v_d2 bigint; v_k bigint := pg_temp.nd_id('k1'); v_x bigint;
BEGIN
  PERFORM pg_temp.nd_ca('c');
  PERFORM pg_temp.nd_astept('t_export', 'MP P2 deblocheaza P1', pg_temp.nd_cod(format('SELECT public.fn_sud_export_deblocheaza(%s, ''izo'', ''export cu lipsuri'', ''[1]''::jsonb)', v_k)), '42501');
  PERFORM pg_temp.nd_ca('b');
  v_d := public.fn_sud_export_deblocheaza(v_k, 'izo', 'export cu documente lipsa', '[{"sudura": "T12S127", "lipsa": "PM"}]');
  v_d2 := public.fn_sud_export_deblocheaza(v_k, 'izo', 'a doua deblocare', '[{"sudura": "T12S127", "lipsa": "PM"}]');
  INSERT INTO nd_fix VALUES ('d2', v_d2);
  PERFORM pg_temp.nd_astept('t_export', 'motiv scurt', pg_temp.nd_cod(format('SELECT public.fn_sud_export_deblocheaza(%s, ''izo'', ''abc'', ''[1]''::jsonb)', v_k)), '22023');
  v_x := public.fn_sud_export_inregistreaza(v_k, 'izo', '{"buletine": []}', v_d, NULL);
  IF (SELECT row(incomplet, deblocare_id, creat_de) FROM public.sud_exporturi WHERE id = v_x) IS DISTINCT FROM row(true, v_d, auth.uid()) THEN
    RAISE EXCEPTION 't_export FAIL: exportul incomplet nu e legat de deblocare';
  END IF;
  PERFORM pg_temp.nd_astept('t_export', 'deblocarea folosita a doua oara', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', ''{}''::jsonb, %s, NULL)', v_k, v_d)), '42501');
  PERFORM pg_temp.nd_astept('t_export', 'deblocarea pe alt tip', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''inventar'', ''{}''::jsonb, %s, NULL)', v_k, v_d2)), '42501');
  PERFORM pg_temp.nd_ca('a');
  PERFORM pg_temp.nd_astept('t_export', 'deblocarea altuia (owner)', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', ''{}''::jsonb, %s, NULL)', v_k, v_d2)), '42501');
  PERFORM pg_temp.nd_ca('d');
  PERFORM pg_temp.nd_astept('t_export', 'export complet: editor executie', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', ''{}''::jsonb, NULL, NULL)', v_k)), 'ok');
  PERFORM pg_temp.nd_ca('e');
  PERFORM pg_temp.nd_astept('t_export', 'export complet: ctc', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', ''{}''::jsonb, NULL, NULL)', v_k)), '42501');
  PERFORM pg_temp.nd_ca('h');
  PERFORM pg_temp.nd_astept('t_export', 'export complet: restrans viewer pe P2', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', ''{}''::jsonb, NULL, NULL)', pg_temp.nd_id('k2'))), '42501');
  RAISE NOTICE 'DRY 20270114a t_export ok';
END $t$;
-- deblocarea expirata: varsta o pune fixtura (ca postgres), apoi MP-ul incearca
RESET ROLE;
UPDATE public.sud_export_deblocari SET creat_la = now() - interval '61 minutes' WHERE id = pg_temp.nd_id('d2');
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.nd_ca('b');
  PERFORM pg_temp.nd_astept('t_export_expirat', 'deblocarea expirata', pg_temp.nd_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', ''{}''::jsonb, %s, NULL)', pg_temp.nd_id('k1'), pg_temp.nd_id('d2'))), '42501');
  RAISE NOTICE 'DRY 20270114a t_export_expirat ok';
END $t$;
RESET ROLE;

-- ── t_anon: fara EXECUTE / SELECT ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR current_user <> 'anon' THEN RAISE EXCEPTION 't_anon: identitate gresita'; END IF;
  PERFORM pg_temp.nd_astept('t_anon', 'SELECT', pg_temp.nd_cod('SELECT count(*) FROM public.sud_buletine'), '42501');
  PERFORM pg_temp.nd_astept('t_anon', 'EXECUTE', pg_temp.nd_cod(format('SELECT public.fn_sud_metode_seteaza(%s, ARRAY[''PM''])', pg_temp.nd_id('p1'))), '42501');
  RAISE NOTICE 'DRY 20270114a t_anon ok';
END $t$;
RESET ROLE;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270114a TOTUL OK'; END $t$;
ROLLBACK;
