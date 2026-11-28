-- DRY 20270115b_izometrie_ndt_citiri: se ruleaza DUPA aplicarea migrarii, intr-o singura tranzactie cu ROLLBACK la final (nimic ramane),
-- pe clona PG17 (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_izometrie_ndt_citiri_local.mjs). Fiecare bloc scrie
-- NOTICE 'DRY 20270115b <bloc> ok …'; orice abatere = exceptie. Valorile asteptate vin din regulile scrise in antetul migrarii si din spec
-- (§21 R9 dreptul, §24, R6), nu din codul testat (L25). Identitatea: ambele surse JWT + SET LOCAL ROLE authenticated, verificate la fiecare
-- schimbare (auth.uid, current_user, rol fara BYPASSRLS). Conturi SINTETICE (uuid-uri f2000000-…): a = owner, b = managerul proiectului P1
-- (fisa 9221), c = managerul P2 (fisa 9222), d = 'executie' editor, e = 'ctc' editor, g = fara modul.
-- FIXTURI: pe clona, daca employees / profiles / executie_tronsoane / executie_pachete_lansare / executie_tevi cer alte coloane NOT NULL sau
-- trigger-ele lor cer alte valori, se completeaza DOAR blocul FIXTURI (restul nu depinde de ele). Constrangerile productiei cunoscute
-- (22.11.2026): employees.department NOT NULL, profiles.role explicit, o fisa = un cont, user_module_access.module → app_modules(key).
-- Schimbarile pachetului / randurilor din t_amprenta le face fixtura (ca postgres), pe pachetul sintetic K1.
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE nc_fix (k text PRIMARY KEY, id bigint) ON COMMIT DROP;
CREATE TEMP TABLE nc_val (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT SELECT, INSERT ON nc_fix, nc_val TO authenticated;
GRANT SELECT ON nc_fix, nc_val TO anon;

-- ── t_migrare: precondiția (migrarea aplicată) ──
DO $t$
BEGIN
  IF to_regclass('public.sud_citiri') IS NULL OR to_regprocedure('public.fn_sud_amprenta_pachet(bigint)') IS NULL
     OR to_regprocedure('public.fn_sud_citire_rezerva(bigint, text, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text)') IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_sud\_%') <> 15 THEN
    RAISE EXCEPTION 't_migrare FAIL: migrarea 20270115b nu e aplicata';
  END IF;
  RAISE NOTICE 'DRY 20270115b t_migrare ok';
END $t$;

-- ── FIXTURI (identitati sintetice; id-urile vin din RETURNING) ──
DO $fix$
DECLARE v bigint; v_t bigint; v_k bigint;
BEGIN
  INSERT INTO public.employees (id, name, department) VALUES (9221, 'DRY CIT MP UNU', 'Executie'), (9222, 'DRY CIT MP DOI', 'Executie');
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x::uuid FROM unnest(ARRAY['f2000000-0000-4000-8000-0000000000a1', 'f2000000-0000-4000-8000-0000000000b1',
      'f2000000-0000-4000-8000-0000000000c1', 'f2000000-0000-4000-8000-0000000000d1', 'f2000000-0000-4000-8000-0000000000e1',
      'f2000000-0000-4000-8000-0000000000f1']) x
    ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles (id, is_owner, employee_id, role) VALUES
    ('f2000000-0000-4000-8000-0000000000a1', true, NULL, 'teren'), ('f2000000-0000-4000-8000-0000000000b1', false, 9221, 'teren'),
    ('f2000000-0000-4000-8000-0000000000c1', false, 9222, 'teren'), ('f2000000-0000-4000-8000-0000000000d1', false, NULL, 'teren'),
    ('f2000000-0000-4000-8000-0000000000e1', false, NULL, 'teren'), ('f2000000-0000-4000-8000-0000000000f1', false, NULL, 'teren')
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, employee_id = EXCLUDED.employee_id, role = EXCLUDED.role;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage) VALUES ('executie', NULL, 'Executie', true, true), ('ctc', NULL, 'CTC', true, true)
    ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('f2000000-0000-4000-8000-0000000000d1', 'executie', 'editor'), ('f2000000-0000-4000-8000-0000000000e1', 'ctc', 'editor');
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('DRY-CIT-P1', 'Dry citiri P1', 9221) RETURNING id INTO v;
  INSERT INTO nc_fix VALUES ('p1', v);
  INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (v, 'TR12') RETURNING id INTO v_t;
  INSERT INTO nc_fix VALUES ('t1', v_t);
  INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id, km_start_m) VALUES (v, v_t, 1000) RETURNING id INTO v_k;
  INSERT INTO nc_fix VALUES ('k1', v_k);
  INSERT INTO public.executie_tevi (pachet_id, serie_unica, poz_in_pachet, lungime_m, sarja) VALUES (v_k, 'DRY-CIT-S1', 1, 12.5, 'SJ-1') RETURNING id INTO v;
  INSERT INTO nc_fix VALUES ('tv1', v);
  INSERT INTO public.executie_tevi (pachet_id, serie_unica, poz_in_pachet, lungime_m, sarja) VALUES (v_k, 'DRY-CIT-S2', 2, 11.75, 'SJ-1');
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('DRY-CIT-P2', 'Dry citiri P2', 9222) RETURNING id INTO v;
  INSERT INTO nc_fix VALUES ('p2', v);
  RAISE NOTICE 'DRY 20270115b fixturi ok: P1 %, K1 %', (SELECT id FROM nc_fix WHERE k = 'p1'), (SELECT id FROM nc_fix WHERE k = 'k1');
END $fix$;
CREATE FUNCTION pg_temp.nc_id(p text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT id FROM nc_fix WHERE k = p $f$;
CREATE FUNCTION pg_temp.nc_v(p text) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT v FROM nc_val WHERE k = p $f$;
CREATE FUNCTION pg_temp.nc_u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('f2000000-0000-4000-8000-0000000000' || CASE p WHEN 'a' THEN 'a1' WHEN 'b' THEN 'b1' WHEN 'c' THEN 'c1' WHEN 'd' THEN 'd1'
            WHEN 'e' THEN 'e1' WHEN 'g' THEN 'f1' END)::uuid
$f$;
-- cheile de cerere (UUID-uri fixe, sintetice): K1 … K12
CREATE FUNCTION pg_temp.nc_k(p int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT ('f2c00000-0000-4000-8000-' || lpad(p::text, 12, '0'))::uuid $f$;
CREATE FUNCTION pg_temp.nc_ca(p text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.nc_u(p);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM v OR current_user <> 'authenticated' OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'identitate gresita: uid % user %', auth.uid(), current_user;
  END IF;
END $f$;
-- rezultatul unei instructiuni intr-o sub-tranzactie: 'ok' sau SQLSTATE: mesaj (instructiunea e text scris in acest fisier, nu date externe)
CREATE FUNCTION pg_temp.nc_cod(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.nc_astept(p_bloc text, p_ce text, p_rez text, p_cod text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_rez IS NULL OR (p_cod = 'ok' AND p_rez <> 'ok') OR (p_cod <> 'ok' AND left(p_rez, length(p_cod) + 1) <> p_cod || ':') THEN
    RAISE EXCEPTION '% FAIL: % = % (astepta %)', p_bloc, p_ce, coalesce(p_rez, 'NULL'), p_cod;
  END IF;
END $f$;
-- citirea valida minima (forma valideazaCitireNdt; supabase/tests/20270115b_citiri_cazuri.json, cazul „minim”)
CREATE FUNCTION pg_temp.nc_citire(p_cod text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('antet', '{"firma": null, "metoda": null, "numar": null, "data": null, "tronson": null, "nr_randuri_tiparit": null, "partial": false, "pagini_necitite": []}'::jsonb,
    'randuri', jsonb_build_array(jsonb_build_object('cod_raw', p_cod, 'rezultat', 'acceptat', 'data_inspectie', NULL, 'start_mm', NULL, 'end_mm', NULL,
      'lungime_mm', NULL, 'inaltime_mm', NULL, 'adancime_mm', NULL, 'observatii', NULL)), 'incerte', '[]'::jsonb, 'partial', false, 'pagini_necitite', '[]'::jsonb)
$f$;
CREATE FUNCTION pg_temp.nc_rez(p_bul bigint, p_tip text, p_k int) RETURNS text LANGUAGE sql AS $f$
  SELECT public.fn_sud_citire_rezerva(p_bul, p_tip, 'claude-sonnet-5-5', pg_temp.nc_k(p_k))->>'rezultat'
$f$;

SET LOCAL ROLE authenticated;

-- ── t_buletine: doua ciorne pe P1 / T1 (fisierele le urca MP-ul, ca Storage API) ──
DO $t$
DECLARE v_p bigint := pg_temp.nc_id('p1'); v_t bigint := pg_temp.nc_id('t1'); v bigint;
BEGIN
  PERFORM pg_temp.nc_ca('b');
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('izo-ndt', v_p || '/' || v_t || '/dryc1.pdf', auth.uid(), auth.uid()::text),
                                                                       ('izo-ndt', v_p || '/' || v_t || '/dryc2.pdf', auth.uid(), auth.uid()::text);
  v := public.fn_sud_buletin_incarca(v_t, 'PA-UT', 'DRYC-1', DATE '2026-11-20', 'LAB DRY', v_p || '/' || v_t || '/dryc1.pdf', 'dryc1.pdf', repeat('c1', 32), NULL, NULL);
  INSERT INTO nc_fix VALUES ('bA', v);
  v := public.fn_sud_buletin_incarca(v_t, 'PM', 'DRYC-2', DATE '2026-11-20', 'LAB DRY', v_p || '/' || v_t || '/dryc2.pdf', 'dryc2.pdf', repeat('c2', 32), NULL, NULL);
  INSERT INTO nc_fix VALUES ('bB', v);
  RAISE NOTICE 'DRY 20270115b t_buletine ok';
END $t$;

-- ── t_rezerva: cheia de cerere (L04): noua → in_curs; aceeasi → starea ei; alta cheie cu o cerere in lucru = 55006; cheia refolosita pe alta
--    cerere = 22023; dreptul = scriere (owner / MP pe proiectul lui); scrierile directe = refuz ──
DO $t$
DECLARE v_a bigint := pg_temp.nc_id('bA'); c text; r jsonb;
  f text := 'SELECT public.fn_sud_citire_rezerva(%s, %L, %L, %L::uuid)';
BEGIN
  PERFORM pg_temp.nc_ca('b');
  IF pg_temp.nc_rez(v_a, 'principal', 1) IS DISTINCT FROM 'nou' THEN RAISE EXCEPTION 't_rezerva FAIL: prima rezervare nu e noua'; END IF;
  r := public.fn_sud_citire_rezerva(v_a, 'principal', 'claude-sonnet-5-5', pg_temp.nc_k(1));
  IF r->>'rezultat' IS DISTINCT FROM 'in_curs' OR r->'citire' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 't_rezerva FAIL: aceeasi cheie = % (astepta in_curs, fara citire)', r; END IF;
  PERFORM pg_temp.nc_astept('t_rezerva', 'alta cheie cat prima e in lucru', pg_temp.nc_cod(format(f, v_a, 'alternativ', 'claude-opus-5-5', pg_temp.nc_k(2))), '55006');
  PERFORM pg_temp.nc_astept('t_rezerva', 'cheia K1 cu alt tip', pg_temp.nc_cod(format(f, v_a, 'alternativ', 'claude-sonnet-5-5', pg_temp.nc_k(1))), '22023');
  PERFORM pg_temp.nc_astept('t_rezerva', 'cheia K1 cu alt model', pg_temp.nc_cod(format(f, v_a, 'principal', 'claude-opus-5-5', pg_temp.nc_k(1))), '22023');
  PERFORM pg_temp.nc_astept('t_rezerva', 'cheia K1 pe alt buletin', pg_temp.nc_cod(format(f, pg_temp.nc_id('bB'), 'principal', 'claude-sonnet-5-5', pg_temp.nc_k(1))), '22023');
  PERFORM pg_temp.nc_astept('t_rezerva', 'model in afara formei', pg_temp.nc_cod(format(f, v_a, 'principal', 'gpt-4', pg_temp.nc_k(3))), '22023');
  PERFORM pg_temp.nc_astept('t_rezerva', 'tip necunoscut', pg_temp.nc_cod(format(f, v_a, 'al_treilea', 'claude-sonnet-5-5', pg_temp.nc_k(3))), '22023');
  PERFORM pg_temp.nc_astept('t_rezerva', 'cheie lipsa', pg_temp.nc_cod(format('SELECT public.fn_sud_citire_rezerva(%s, ''principal'', ''claude-sonnet-5-5'', NULL)', v_a)), '22023');
  PERFORM pg_temp.nc_astept('t_rezerva', 'buletin inexistent', pg_temp.nc_cod(format(f, -1, 'principal', 'claude-sonnet-5-5', pg_temp.nc_k(3))), '22023');
  FOREACH c IN ARRAY ARRAY['c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.nc_ca(c);
    PERFORM pg_temp.nc_astept('t_rezerva', 'contul ' || c || ' rezerva pe P1', pg_temp.nc_cod(format(f, pg_temp.nc_id('bB'), 'principal', 'claude-sonnet-5-5', pg_temp.nc_k(3))), '42501');
    PERFORM pg_temp.nc_astept('t_rezerva', 'contul ' || c || ' reia cheia lui b', pg_temp.nc_cod(format(f, v_a, 'principal', 'claude-sonnet-5-5', pg_temp.nc_k(1))), '42501');
  END LOOP;
  PERFORM pg_temp.nc_ca('b');
  PERFORM pg_temp.nc_astept('t_rezerva', 'INSERT direct', pg_temp.nc_cod(format('INSERT INTO public.sud_citiri (buletin_id, proiect_id, cheie_idempotenta, tip, model, creat_de) VALUES (%s, %s, %L, ''principal'', ''claude-x'', auth.uid())',
    v_a, pg_temp.nc_id('p1'), pg_temp.nc_k(4))), '42501');
  PERFORM pg_temp.nc_astept('t_rezerva', 'UPDATE direct', pg_temp.nc_cod('UPDATE public.sud_citiri SET stare = ''gata'''), '42501');
  PERFORM pg_temp.nc_astept('t_rezerva', 'DELETE direct', pg_temp.nc_cod('DELETE FROM public.sud_citiri'), '42501');
  PERFORM pg_temp.nc_astept('t_rezerva', 'nextval pe secventa', pg_temp.nc_cod('SELECT nextval(''public.sud_citiri_id_seq'')'), '42501');
  RAISE NOTICE 'DRY 20270115b t_rezerva ok';
END $t$;

-- ── t_salveaza: doar autorul cererii o inchide; citirea invalida = 22023 (cererea ramane in_curs); repetarea identica = acelasi id;
--    cheia reluata dupa „gata” = citirea salvata, fara cerere noua ──
DO $t$
DECLARE v_a bigint := pg_temp.nc_id('bA'); v_id bigint; v_id2 bigint; r jsonb;
  f text := 'SELECT public.fn_sud_citire_salveaza(%L::uuid, %L::jsonb, %s, %s, %L)';
BEGIN
  PERFORM pg_temp.nc_ca('a');
  PERFORM pg_temp.nc_astept('t_salveaza', 'owner inchide cererea lui b', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), pg_temp.nc_citire('T12S1')::text, '0.37', 'true', NULL)), '42501');
  PERFORM pg_temp.nc_ca('b');
  PERFORM pg_temp.nc_astept('t_salveaza', 'citire invalida', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), '{"randuri": []}', '0.37', 'true', NULL)), '22023');
  PERFORM pg_temp.nc_astept('t_salveaza', 'citire si eroare deodata', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), pg_temp.nc_citire('T12S1')::text, '0.37', 'true', 'apel_ai_esuat')), '22023');
  PERFORM pg_temp.nc_astept('t_salveaza', 'cost negativ', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), pg_temp.nc_citire('T12S1')::text, '-1', 'true', NULL)), '22023');
  PERFORM pg_temp.nc_astept('t_salveaza', 'cost fara marcaj', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), pg_temp.nc_citire('T12S1')::text, '0.37', 'NULL', NULL)), '22023');
  PERFORM pg_temp.nc_astept('t_salveaza', 'cheie inexistenta', pg_temp.nc_cod(format(f, pg_temp.nc_k(9999), pg_temp.nc_citire('T12S1')::text, '0.37', 'true', NULL)), '22023');
  v_id := public.fn_sud_citire_salveaza(pg_temp.nc_k(1), pg_temp.nc_citire('T12S1'), 0.37, true, NULL);
  v_id2 := public.fn_sud_citire_salveaza(pg_temp.nc_k(1), pg_temp.nc_citire('T12S1'), 0.37, true, NULL);
  IF v_id IS NULL OR v_id2 IS DISTINCT FROM v_id THEN RAISE EXCEPTION 't_salveaza FAIL: repetarea identica nu da acelasi id'; END IF;
  PERFORM pg_temp.nc_astept('t_salveaza', 'a doua salvare cu alta citire', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), pg_temp.nc_citire('T12S2')::text, '0.37', 'true', NULL)), '55000');
  PERFORM pg_temp.nc_astept('t_salveaza', 'inchiderea cu eroare dupa gata', pg_temp.nc_cod(format(f, pg_temp.nc_k(1), NULL, '0.37', 'true', 'apel_ai_esuat')), '55000');
  r := public.fn_sud_citire_rezerva(v_a, 'principal', 'claude-sonnet-5-5', pg_temp.nc_k(1));
  IF r->>'rezultat' IS DISTINCT FROM 'gata' OR r->'citire' IS DISTINCT FROM pg_temp.nc_citire('T12S1') OR (r->>'id')::bigint IS DISTINCT FROM v_id
     OR (r->>'cost_usd')::numeric IS DISTINCT FROM 0.37 THEN
    RAISE EXCEPTION 't_salveaza FAIL: cheia reluata = % (astepta gata cu citirea salvata)', r;
  END IF;
  PERFORM pg_temp.nc_ca('a');
  IF (SELECT row(stare, nr_randuri, creat_de, tip, model, proiect_id, cost_cunoscut) FROM public.sud_citiri WHERE id = v_id)
     IS DISTINCT FROM row('gata'::text, 1, pg_temp.nc_u('b'), 'principal'::text, 'claude-sonnet-5-5'::text, pg_temp.nc_id('p1'), true) THEN
    RAISE EXCEPTION 't_salveaza FAIL: randul salvat nu are starea / autorul / proiectul pusi de server';
  END IF;
  INSERT INTO nc_fix VALUES ('c1', v_id);
  RAISE NOTICE 'DRY 20270115b t_salveaza ok';
END $t$;

-- ── t_limita: cel mult 5 cereri care costa pe buletin; cele inchise inaintea apelului cu cost 0 cunoscut nu se numara ──
DO $t$
DECLARE v_b bigint := pg_temp.nc_id('bB'); i int;
BEGIN
  PERFORM pg_temp.nc_ca('b');
  FOR i IN 20..22 LOOP   -- inchise cu cost 0 (inaintea apelului): nu se numara
    IF pg_temp.nc_rez(v_b, 'principal', i) IS DISTINCT FROM 'nou' THEN RAISE EXCEPTION 't_limita FAIL: cererea % nu e noua', i; END IF;
    PERFORM public.fn_sud_citire_salveaza(pg_temp.nc_k(i), NULL, 0, true, 'pdf_invalid');
  END LOOP;
  FOR i IN 30..34 LOOP   -- cu cost (cunoscut sau necunoscut): se numara
    IF pg_temp.nc_rez(v_b, 'alternativ', i) IS DISTINCT FROM 'nou' THEN RAISE EXCEPTION 't_limita FAIL: cererea % nu e noua', i; END IF;
    PERFORM public.fn_sud_citire_salveaza(pg_temp.nc_k(i), NULL, 0.91, i % 2 = 0, 'raspuns_ai_invalid');
  END LOOP;
  PERFORM pg_temp.nc_astept('t_limita', 'a sasea cerere care costa', pg_temp.nc_cod(format('SELECT public.fn_sud_citire_rezerva(%s, ''principal'', ''claude-sonnet-5-5'', %L::uuid)', v_b, pg_temp.nc_k(35))), '54000');
  IF (public.fn_sud_citire_rezerva(v_b, 'alternativ', 'claude-sonnet-5-5', pg_temp.nc_k(31))->>'rezultat') IS DISTINCT FROM 'esuat' THEN
    RAISE EXCEPTION 't_limita FAIL: cheia unei cereri esuate nu intoarce esuat';
  END IF;
  RAISE NOTICE 'DRY 20270115b t_limita ok';
END $t$;

-- ── t_expirat: cererea in_curs mai veche de 5 minute = necunoscut (nu se reia); o cheie noua e permisa (nu mai e „in lucru”) ──
DO $t$
BEGIN
  PERFORM pg_temp.nc_ca('b');
  IF pg_temp.nc_rez(pg_temp.nc_id('bA'), 'alternativ', 40) IS DISTINCT FROM 'nou' THEN RAISE EXCEPTION 't_expirat FAIL: cererea 40 nu e noua'; END IF;
END $t$;
RESET ROLE;
UPDATE public.sud_citiri SET creat_la = now() - interval '6 minutes' WHERE cheie_idempotenta = pg_temp.nc_k(40);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.nc_ca('b');
  IF pg_temp.nc_rez(pg_temp.nc_id('bA'), 'alternativ', 40) IS DISTINCT FROM 'necunoscut' THEN RAISE EXCEPTION 't_expirat FAIL: cererea veche nu e necunoscut'; END IF;
  IF pg_temp.nc_rez(pg_temp.nc_id('bA'), 'alternativ', 41) IS DISTINCT FROM 'nou' THEN RAISE EXCEPTION 't_expirat FAIL: cheia noua dupa cererea expirata nu e noua'; END IF;
  RAISE NOTICE 'DRY 20270115b t_expirat ok';
END $t$;

-- ── t_confirmat: dupa confirmarea buletinului: cheie noua = 55000; cheia veche „gata” se poate relua; salvarea unei citiri = 55000; inchiderea
--    cu eroare (costul platit se inregistreaza) = ok ──
DO $t$
DECLARE v_a bigint := pg_temp.nc_id('bA');
BEGIN
  PERFORM pg_temp.nc_ca('b');
  PERFORM public.fn_sud_buletin_confirma(v_a, 1, '[{"cod_raw": "S1", "rezultat": "acceptat"}]');
  PERFORM pg_temp.nc_astept('t_confirmat', 'cheie noua pe buletin confirmat', pg_temp.nc_cod(format('SELECT public.fn_sud_citire_rezerva(%s, ''principal'', ''claude-sonnet-5-5'', %L::uuid)', v_a, pg_temp.nc_k(42))), '55000');
  IF pg_temp.nc_rez(v_a, 'principal', 1) IS DISTINCT FROM 'gata' THEN RAISE EXCEPTION 't_confirmat FAIL: cheia gata nu se mai reia'; END IF;
  PERFORM pg_temp.nc_astept('t_confirmat', 'salvarea citirii pe buletin confirmat', pg_temp.nc_cod(format('SELECT public.fn_sud_citire_salveaza(%L::uuid, %L::jsonb, 0.4, true, NULL)', pg_temp.nc_k(41), pg_temp.nc_citire('T12S1')::text)), '55000');
  PERFORM pg_temp.nc_astept('t_confirmat', 'inchiderea cu eroare pe buletin confirmat', pg_temp.nc_cod(format('SELECT public.fn_sud_citire_salveaza(%L::uuid, NULL, 0.4, true, ''buletin_nu_e_ciorna'')', pg_temp.nc_k(41))), 'ok');
  RAISE NOTICE 'DRY 20270115b t_confirmat ok';
END $t$;

-- ── t_citire: cine vede cererile P1 (owner, executie, ctc da; MP-urile fara modul, fara modul nu — R9) ──
DO $t$
DECLARE c text; n int; v_ast int;
BEGIN
  FOREACH c IN ARRAY ARRAY['a', 'b', 'c', 'd', 'e', 'g'] LOOP
    PERFORM pg_temp.nc_ca(c);
    SELECT count(*) INTO n FROM public.sud_citiri WHERE proiect_id = pg_temp.nc_id('p1');
    -- cererile scrise mai sus: bA = K1 (gata), K40 (in_curs expirata), K41 (esuat); bB = K20–K22, K30–K34 (esuat) → 11
    v_ast := CASE WHEN c IN ('a', 'd', 'e') THEN 11 ELSE 0 END;
    IF n <> v_ast THEN RAISE EXCEPTION 't_citire FAIL: contul % vede % cereri pe P1 (astepta %)', c, n, v_ast; END IF;
  END LOOP;
  RAISE NOTICE 'DRY 20270115b t_citire ok';
END $t$;

-- ── t_amprenta: dreptul de export (owner, MP pe proiectul lui, editor executie; nu ctc / fara modul / alt MP); determinista; se schimba la
--    fiecare camp al pachetului / randului din lista si la un rand nou; revine la aceeasi valoare cand datele revin ──
DO $t$
DECLARE v_k bigint := pg_temp.nc_id('k1'); c text; a0 text;
BEGIN
  PERFORM pg_temp.nc_ca('a');
  a0 := public.fn_sud_amprenta_pachet(v_k);
  IF a0 !~ '^[0-9a-f]{32}$' OR public.fn_sud_amprenta_pachet(v_k) IS DISTINCT FROM a0 THEN RAISE EXCEPTION 't_amprenta FAIL: amprenta nu e md5 determinist (%)', a0; END IF;
  INSERT INTO nc_val VALUES ('a0', a0);
  FOREACH c IN ARRAY ARRAY['b', 'd'] LOOP
    PERFORM pg_temp.nc_ca(c);
    IF public.fn_sud_amprenta_pachet(v_k) IS DISTINCT FROM a0 THEN RAISE EXCEPTION 't_amprenta FAIL: contul % vede alta amprenta', c; END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['c', 'e', 'g'] LOOP
    PERFORM pg_temp.nc_ca(c);
    PERFORM pg_temp.nc_astept('t_amprenta', 'contul ' || c, pg_temp.nc_cod(format('SELECT public.fn_sud_amprenta_pachet(%s)', v_k)), '42501');
  END LOOP;
  PERFORM pg_temp.nc_ca('a');
  PERFORM pg_temp.nc_astept('t_amprenta', 'pachet inexistent', pg_temp.nc_cod('SELECT public.fn_sud_amprenta_pachet(-1)'), '22023');
  RAISE NOTICE 'DRY 20270115b t_amprenta drept ok';
END $t$;
RESET ROLE;
CREATE FUNCTION pg_temp.nc_amp() RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.nc_u('a')::text, true);
  RETURN public.fn_sud_amprenta_pachet(pg_temp.nc_id('k1'));
END $f$;
DO $t$
DECLARE a0 text := pg_temp.nc_v('a0'); v_k bigint := pg_temp.nc_id('k1'); v_r bigint := pg_temp.nc_id('tv1'); v_id bigint;
BEGIN
  UPDATE public.executie_tevi SET sarja = 'SJ-2' WHERE id = v_r;
  IF pg_temp.nc_amp() = a0 THEN RAISE EXCEPTION 't_amprenta FAIL: sarja schimbata, amprenta la fel'; END IF;
  UPDATE public.executie_tevi SET sarja = 'SJ-1' WHERE id = v_r;
  IF pg_temp.nc_amp() IS DISTINCT FROM a0 THEN RAISE EXCEPTION 't_amprenta FAIL: sarja refacuta, amprenta alta'; END IF;
  UPDATE public.executie_tevi SET lungime_m = 12.6 WHERE id = v_r;
  IF pg_temp.nc_amp() = a0 THEN RAISE EXCEPTION 't_amprenta FAIL: lungimea schimbata, amprenta la fel'; END IF;
  UPDATE public.executie_tevi SET lungime_m = 12.5 WHERE id = v_r;
  INSERT INTO public.executie_tevi (pachet_id, serie_unica, poz_in_pachet) VALUES (v_k, 'DRY-CIT-S3', 3) RETURNING id INTO v_id;
  IF pg_temp.nc_amp() = a0 THEN RAISE EXCEPTION 't_amprenta FAIL: rand nou, amprenta la fel'; END IF;
  DELETE FROM public.executie_tevi WHERE id = v_id;
  IF pg_temp.nc_amp() IS DISTINCT FROM a0 THEN RAISE EXCEPTION 't_amprenta FAIL: randul scos, amprenta alta'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'DRY 20270115b t_amprenta ok';
END $t$;

-- ── t_export: fotografia cere amprenta serverului (lipsa = 22023); amprenta veche = 40001 cu „pachet”; cea curenta = inregistrat; o schimbare
--    a randurilor dupa deschiderea ferestrei = 40001. Fotografia P1 / T1: bA confirmat (v2), nicio eliminare, nicio metoda obligatorie. ──
CREATE FUNCTION pg_temp.nc_foto(p_amp text) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('buletine', jsonb_build_array(jsonb_build_object('id', pg_temp.nc_id('bA'), 'versiune', 2)), 'eliminate', '[]'::jsonb,
                            'metode', '[]'::jsonb, 'lipsuri_blocante', '[]'::jsonb) || CASE WHEN p_amp IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('amprenta_pachet', p_amp) END
$f$;
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_k bigint := pg_temp.nc_id('k1'); a0 text := pg_temp.nc_v('a0'); r text; v_x bigint;
  f text := 'SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', %L::jsonb, NULL, NULL)';
BEGIN
  PERFORM pg_temp.nc_ca('d');
  PERFORM pg_temp.nc_astept('t_export', 'fotografia fara amprenta', pg_temp.nc_cod(format(f, v_k, pg_temp.nc_foto(NULL)::text)), '22023');
  PERFORM pg_temp.nc_astept('t_export', 'amprenta in alta forma', pg_temp.nc_cod(format(f, v_k, pg_temp.nc_foto(upper(a0))::text)), '22023');
  r := pg_temp.nc_cod(format(f, v_k, pg_temp.nc_foto(repeat('0', 32))::text));
  IF r NOT LIKE '40001: %(pachet)%' THEN RAISE EXCEPTION 't_export FAIL: amprenta veche = % (astepta 40001 cu „pachet”)', r; END IF;
  v_x := public.fn_sud_export_inregistreaza(v_k, 'izo', pg_temp.nc_foto(a0), NULL, NULL);
  PERFORM pg_temp.nc_ca('a');
  IF (SELECT fotografie->>'amprenta_pachet' FROM public.sud_exporturi WHERE id = v_x) IS DISTINCT FROM a0 THEN
    RAISE EXCEPTION 't_export FAIL: exportul nu pastreaza amprenta din fotografie';
  END IF;
  RAISE NOTICE 'DRY 20270115b t_export ok';
END $t$;
RESET ROLE;
UPDATE public.executie_tevi SET pa_ut_cod = 'PAUT-DRY' WHERE id = pg_temp.nc_id('tv1');
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r text;
BEGIN
  PERFORM pg_temp.nc_ca('d');
  r := pg_temp.nc_cod(format('SELECT public.fn_sud_export_inregistreaza(%s, ''izo'', %L::jsonb, NULL, NULL)', pg_temp.nc_id('k1'), pg_temp.nc_foto(pg_temp.nc_v('a0'))::text));
  IF r NOT LIKE '40001: %(pachet)%' THEN RAISE EXCEPTION 't_export_dupa FAIL: randul schimbat dupa fereastra = % (astepta 40001 cu „pachet”)', r; END IF;
  RAISE NOTICE 'DRY 20270115b t_export_dupa ok';
END $t$;
RESET ROLE;

-- ── t_anon: fara EXECUTE / SELECT ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $t$
BEGIN
  IF auth.uid() IS NOT NULL OR current_user <> 'anon' THEN RAISE EXCEPTION 't_anon: identitate gresita'; END IF;
  PERFORM pg_temp.nc_astept('t_anon', 'SELECT', pg_temp.nc_cod('SELECT count(*) FROM public.sud_citiri'), '42501');
  PERFORM pg_temp.nc_astept('t_anon', 'rezerva', pg_temp.nc_cod(format('SELECT public.fn_sud_citire_rezerva(%s, ''principal'', ''claude-sonnet-5-5'', %L::uuid)', pg_temp.nc_id('bB'), pg_temp.nc_k(50))), '42501');
  PERFORM pg_temp.nc_astept('t_anon', 'amprenta', pg_temp.nc_cod(format('SELECT public.fn_sud_amprenta_pachet(%s)', pg_temp.nc_id('k1'))), '42501');
  RAISE NOTICE 'DRY 20270115b t_anon ok';
END $t$;
RESET ROLE;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270115b TOTUL OK'; END $t$;
ROLLBACK;
