-- DRY 20270105a_executie_rest_decontat: se ruleaza DUPA aplicarea migrarii, intr-o singura tranzactie cu ROLLBACK la final (nimic ramane),
-- pe clona PG17 (psql -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_executie_rest_decontat_local.mjs). Fiecare bloc scrie
-- NOTICE '<bloc> ok …'; orice abatere = exceptie. Valorile asteptate vin din plan / spec (bazele 100 m, 120, 125, 200 MC; decontat 120, rest -20),
-- nu din codul testat (L25). Identitatea: ambele surse JWT + SET LOCAL ROLE authenticated, verificate la fiecare bloc (auth.uid, current_user,
-- rol fara BYPASSRLS). Conturi SINTETICE (uuid-uri f0000000-…): a = owner, b = managerul proiectului P1 si P3, c = director financiar
-- (executie_rest_decontat viewer), d = editor pe sub-modul, e = sef de santier (executie viewer + santierul P1, NU are sub-modulul),
-- f = responsabilul de contracte al P1 (executie viewer), g = fara drepturi, h = editor pe sub-modul RESTRANS (20261209a) la P2 ca viewer,
-- i = editor pe sub-modul RESTRANS la P2 ca editor. Proiecte: P1 (cu oferta, dupa primul bloc), P2 (alt MP), P3 (fara oferta), P4 (al owner-ului:
-- coduri repetate, lista completa pe identitate canonica, ultimul act, note neaprobate), P5 (un rand confirmat scris de SERVER in fixturi, pentru
-- garda in sesiune proaspata).
-- SURSELE (r3, review #1158): t_surse_autorizate = accesul general Executie (e) nu aduce in baza un rand NR / NCS / AA scris direct (INSERT sau
-- schimbarea sursei), apoi, ca SERVER (auth.uid() NULL), CHECK-ul refuza randul orfan / neconfirmat independent de garda; t_rand_orfan (ultimul
-- bloc) = apararea in adancime: cu CHECK-ul scos intr-un sub-bloc anulat, randurile orfane / neconfirmate nu intra in calcul si apar in lipsuri.
-- SESIUNE PROASPATA: primul bloc dupa fixturi verifica garda cu marcajul RPC LIPSA (NULL): fisierul se ruleaza intr-o sesiune noua, inainte ca
-- vreun RPC sa fi pus marcajul (precondiția e verificata explicit).
-- FIXTURI: pe clona, daca profiles / employees cer alte coloane NOT NULL, se completeaza DOAR blocul FIXTURI (restul nu depinde de ele).
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE rd_fix (k text PRIMARY KEY, id bigint) ON COMMIT DROP;
GRANT SELECT, INSERT ON rd_fix TO authenticated, service_role;

-- ── FIXTURI (identitati sintetice; id-urile proiectelor / actelor / situatiilor vin din RETURNING) ──────────────────────────────
DO $fix$
DECLARE v bigint; v_s bigint;
BEGIN
  INSERT INTO public.employees (id, name) VALUES (9101, 'RD MP UNU'), (9102, 'RD MP DOI'), (9103, 'RD CONTRACTE'), (9104, 'RD SEF SANTIER');
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x::uuid FROM unnest(ARRAY['f0000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000b', 'f0000000-0000-4000-8000-00000000000c',
      'f0000000-0000-4000-8000-00000000000d', 'f0000000-0000-4000-8000-00000000000e', 'f0000000-0000-4000-8000-00000000000f', 'f0000000-0000-4000-8000-000000000010',
      'f0000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-000000000012']) x
    ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles (id, is_owner, employee_id) VALUES
    ('f0000000-0000-4000-8000-00000000000a', true, NULL), ('f0000000-0000-4000-8000-00000000000b', false, 9101), ('f0000000-0000-4000-8000-00000000000c', false, NULL),
    ('f0000000-0000-4000-8000-00000000000d', false, NULL), ('f0000000-0000-4000-8000-00000000000e', false, 9104), ('f0000000-0000-4000-8000-00000000000f', false, 9103),
    ('f0000000-0000-4000-8000-000000000010', false, NULL), ('f0000000-0000-4000-8000-000000000011', false, NULL), ('f0000000-0000-4000-8000-000000000012', false, NULL)
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, employee_id = EXCLUDED.employee_id;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('f0000000-0000-4000-8000-00000000000c', 'executie_rest_decontat', 'viewer'), ('f0000000-0000-4000-8000-00000000000d', 'executie_rest_decontat', 'editor'),
    ('f0000000-0000-4000-8000-00000000000e', 'executie', 'viewer'), ('f0000000-0000-4000-8000-00000000000f', 'executie', 'viewer'),
    ('f0000000-0000-4000-8000-000000000011', 'executie_rest_decontat', 'editor'), ('f0000000-0000-4000-8000-000000000012', 'executie_rest_decontat', 'editor');
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id, responsabil_contracte_externe_id, sef_santier_employee_id) VALUES ('RD-P1', 'Dry P1', 9101, 9103, 9104) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p1', v);
  INSERT INTO public.sites (name, proiect_id) VALUES ('Dry santier P1', v) RETURNING id INTO v_s;
  INSERT INTO public.profile_sites (profile_id, site_id) VALUES ('f0000000-0000-4000-8000-00000000000e', v_s);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-1', DATE '2026-06-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa1', v_s);
  INSERT INTO public.executie_situatii_plata (proiect_id, nr_situatie, luna, an, valoare_baza_lei) VALUES (v, '1', 1, 2026, 8000) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('sl1', v_s);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P2', 'Dry P2', 9102) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p2', v);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P3', 'Dry P3 fara oferta', 9101) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p3', v);
  -- h / i: conturi RESTRANSE pe proiect (20261209a) la P2 (viewer / editor); scrierea directa aici e fixtura (pe productie: fn_executie_acces_proiect_seteaza)
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES
    ('f0000000-0000-4000-8000-000000000011', (SELECT id FROM rd_fix WHERE k = 'p2'), 'viewer'), ('f0000000-0000-4000-8000-000000000012', (SELECT id FROM rd_fix WHERE k = 'p2'), 'editor');
  -- P4 (owner): AA-4 lista completa datata 2026-05-01, AA-5 „doar diferente” datata 2026-02-01 (mai VECHE, dar incarcata DUPA AA-4)
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P4', 'Dry P4 coduri repetate / ultimul act', 9102) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p4', v);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-4', DATE '2026-05-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa4', v_s);
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (v, 'AA-5', DATE '2026-02-01', true) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('aa5', v_s);
  -- P5: un rand CONFIRMAT scris de server (calea serverului: auth.uid() NULL + postgres), pentru garda in sesiune proaspata
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P5', 'Dry P5 garda proaspata', 9102) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p5', v);
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa, mod_import, fisier_amprenta, confirmat_de, confirmat_la)
  VALUES (v, '0001', 'D1', '1', 'A100', 'Conducta', 'M', 10, 1000, 'contract_initial', 'lista_completa', repeat('55', 32), 'f0000000-0000-4000-8000-00000000000a', now()) RETURNING id INTO v_s;
  INSERT INTO rd_fix VALUES ('p5r', v_s);
  RAISE NOTICE 'fixturi ok: P1 %, P2 %, P3 %, P4 %, P5 %', (SELECT id FROM rd_fix WHERE k = 'p1'), (SELECT id FROM rd_fix WHERE k = 'p2'), (SELECT id FROM rd_fix WHERE k = 'p3'),
    (SELECT id FROM rd_fix WHERE k = 'p4'), (SELECT id FROM rd_fix WHERE k = 'p5');
END $fix$;
CREATE FUNCTION pg_temp.rd_id(p text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT id FROM rd_fix WHERE k = p $f$;
-- identitatea din bloc: auth.uid() din ambele surse, rolul authenticated, fara BYPASSRLS
CREATE FUNCTION pg_temp.rd_identitate(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF auth.uid() IS DISTINCT FROM p OR current_user <> 'authenticated' OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'identitate gresita: uid % user %', auth.uid(), current_user;
  END IF;
END $f$;

-- ── t_garda_proaspata: SESIUNE NOUA, marcajul RPC LIPSESTE (NULL, nu ''): garzile refuza scrierile directe ale owner-ului (accesul general
--    Executie trece de politicile vechi ale proiect_articole) — rand confirmat modificat / sters, provenienta scrisa direct, situatie scrisa direct ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  IF current_setting('gazpet.rest_decontat_scriitor', true) IS NOT NULL THEN
    RAISE EXCEPTION 't_garda_proaspata PRECONDITIE: marcajul RPC e deja definit in sesiune (%); dry-run-ul se ruleaza intr-o sesiune noua', current_setting('gazpet.rest_decontat_scriitor', true);
  END IF;
  IF (SELECT count(*) FROM public.proiect_articole WHERE id = pg_temp.rd_id('p5r') AND confirmat_la IS NOT NULL) <> 1 THEN RAISE EXCEPTION 't_garda_proaspata FAIL: randul confirmat al fixturii lipseste'; END IF;
  BEGIN UPDATE public.proiect_articole SET cantitate = 999 WHERE id = pg_temp.rd_id('p5r'); RAISE EXCEPTION 't_garda_proaspata FAIL: rand confirmat modificat direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%nu se modifica direct%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.proiect_articole WHERE id = pg_temp.rd_id('p5r'); RAISE EXCEPTION 't_garda_proaspata FAIL: rand confirmat sters direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%nu se sterg%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, confirmat_de, confirmat_la)
    VALUES (pg_temp.rd_id('p5'), '0001', 'D1', 'B200', 'x', 'M', 1, 1, 'contract_initial', auth.uid(), now());
    RAISE EXCEPTION 't_garda_proaspata FAIL: provenienta scrisa direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, mod_import)
    VALUES (pg_temp.rd_id('p5'), '0001', 'D1', 'B200', 'x', 'M', 1, 1, 'contract_initial', 'diferente');
    RAISE EXCEPTION 't_garda_proaspata FAIL: mod_import scris direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  -- situatiile: clientii n-au deloc INSERT (GRANT), deci refuzul vine inaintea gardei (garda cu marcaj NULL ramane plasa a doua, neobservabila de client)
  BEGIN INSERT INTO public.executie_sl_detaliu (proiect_id, nr_situatie, amprenta, confirmat_de) VALUES (pg_temp.rd_id('p5'), '1', repeat('56', 32), auth.uid()); RAISE EXCEPTION 't_garda_proaspata FAIL: situatie scrisa direct (marcaj NULL)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p5');
  IF n <> 1 OR (SELECT cantitate FROM public.proiect_articole WHERE id = pg_temp.rd_id('p5r')) <> 10 OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) THEN
    RAISE EXCEPTION 't_garda_proaspata FAIL: refuzurile au scris ceva';
  END IF;
  -- calea legitima a serverului ramane: nimic de testat aici ca authenticated; calea veche (rand fara provenienta) merge
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa) VALUES (pg_temp.rd_id('p5'), '0001', 'D1', 'Z9', 'extras', 'M', 1, 0, 'extras_materiale');
  DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p5') AND sursa = 'extras_materiale';
  RAISE NOTICE 't_garda_proaspata ok: cu marcajul RPC LIPSA (NULL) randul confirmat nu se modifica / sterge, provenienta si situatiile nu se scriu direct; calea veche merge';
END $t$;
RESET ROLE;

-- ── t_fara_baza: fara oferta confirmata nu se confirma nicio situatie (MP-ul pe P3 si pe P1 inainte de oferta) ───────────────────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p3'), '1', NULL, 'x.xlsx', repeat('a0', 32),
           '[{"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact","um":"M","cantitate_perioada":1,"valoare":100}]'::jsonb, false);
    RAISE EXCEPTION 't_fara_baza FAIL: situatie confirmata pe un proiect fara oferta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%fara_baza%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', NULL, 'x.xlsx', repeat('a0', 32),
           '[{"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact","um":"M","cantitate_perioada":1,"valoare":100}]'::jsonb, false);
    RAISE EXCEPTION 't_fara_baza FAIL: situatie confirmata pe P1 inainte de oferta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%fara_baza%' THEN RAISE; END IF; END;
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'fara_oferta')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p3') AND tip = 'fara_oferta')
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p2')) THEN
    RAISE EXCEPTION 't_fara_baza FAIL: lipsurile fara_oferta (MP-ul vede P1 si P3, nu P2)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_sl_detaliu) THEN RAISE EXCEPTION 't_fara_baza FAIL: s-a scris ceva'; END IF;
  RAISE NOTICE 't_fara_baza ok: refuz fara_baza pe P3 si pe P1 neconfigurat; lipsuri fara_oferta doar pe proiectele MP-ului';
END $t$;

-- ── oferta P1 (MP-ul): 100 M pe A100, 2 × „100 MC” pe B200 (= 200 MC), C300 pe obiectul 0002, D400 repetat in deviz (nr intra in cheie) ──
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta.xlsx', repeat('b1', 32), $j$[
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":100,"pret_unitar":100,"valoare":10000},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"2","cod":"B200","denumire":"Sapatura","um":"100 MC","cantitate":2,"pret_unitar":1000,"valoare":2000},
    {"obiect_cod":"0002","obiect_nume":"TRONSON 2","deviz_cod":"D2","deviz_nume":"Montaj","nr":"1","cod":"C300","denumire":"Alt articol","um":"BUC","cantitate":10,"pret_unitar":50,"valoare":500},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"7","cod":"D400","denumire":"Dublu a","um":"M","cantitate":5,"pret_unitar":10,"valoare":50},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"D1","deviz_nume":"Montaj","nr":"8","cod":"D400","denumire":"Dublu b","um":"M","cantitate":6,"pret_unitar":10,"valoare":60},
    {"obiect_cod":"0001","obiect_nume":"TRONSON 1","deviz_cod":"OS","deviz_nume":"Organizare","nr":"1","cod":"OS","denumire":"Organizare de santier","um":"LEI","cantitate":1,"pret_unitar":3000,"valoare":3000,"tip_rand":"os"}]$j$::jsonb);
  IF (v->>'inserate')::int <> 6 OR jsonb_array_length(v->'ids') <> 6 OR v->>'mod_import' <> 'lista_completa' THEN RAISE EXCEPTION 'oferta FAIL: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' ' || b.um, '; ' ORDER BY b.cheie) AS s INTO r FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p1');
  IF r.s IS DISTINCT FROM '0001|D1|A100=100 M; 0001|D1|B200=200 MC; 0001|D1|D400|#7=5 M; 0001|D1|D400|#8=6 M; 0001|OS|OS=1 LEI; 0002|D2|C300=10 BUC' THEN
    RAISE EXCEPTION 'oferta FAIL baza: %', r.s;
  END IF;
  -- (MP-ul fara modulul 'executie' nu citeste proiect_articole direct — politicile vechi; provenienta se verifica in blocul owner-ului)
  IF (SELECT sum(randuri) FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p1')) <> 6 THEN RAISE EXCEPTION 'oferta FAIL: 6 randuri in baza'; END IF;
  -- acelasi fisier inca o data / alta oferta pe acelasi proiect = refuz
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta.xlsx', repeat('b1', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"Z","denumire":"z","um":"M","cantitate":1,"valoare":1}]'::jsonb);
    RAISE EXCEPTION 'oferta FAIL: aceeasi amprenta acceptata';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta2.xlsx', repeat('b2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"Z","denumire":"z","um":"M","cantitate":1,"valoare":1}]'::jsonb);
    RAISE EXCEPTION 'oferta FAIL: a doua oferta acceptata';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'fara_oferta')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'aa_fara_deviz' AND referinta = 'AA-1')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'sl_fara_detaliu' AND referinta = '1') THEN
    RAISE EXCEPTION 'oferta FAIL: lipsurile dupa oferta (AA-1 fara deviz, situatia 1 fara detaliu)';
  END IF;
  RAISE NOTICE 'oferta ok: 6 randuri, cheia cu nr doar pe codul repetat, 100 MC x 2 = 200 MC; aceeasi amprenta / a doua oferta refuzate; lipsuri AA-1 si SL 1';
END $t$;

-- ── t_negative_peste_oferta: SL1 +80, SL2 -10, SL3 +50 pe baza 100 → decontat 120, rest -20, peste_oferta ────────────────────
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), ' 1 ', pg_temp.rd_id('sl1'), 'sl1.xlsx', repeat('c1', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"M","cantitate_perioada":80,"pret_unitar":100,"valoare":8000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
  IF (v->>'versiune')::int <> 1 OR (v->>'total_citit')::numeric <> 8000 OR (v->>'total_referinta')::numeric <> 8000 OR v->>'inlocuit_id' IS NOT NULL THEN RAISE EXCEPTION 't_negative FAIL SL1: %', v; END IF;
  INSERT INTO rd_fix VALUES ('d1', (v->>'detaliu_id')::bigint);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '2', NULL, 'sl2.xlsx', repeat('c2', 32),
         '{"luna":2,"an":2026,"linii":[{"cod":"A100","um":"M","cantitate_perioada":-10,"valoare":-1000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, false);
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '3', NULL, 'sl3.xlsx', repeat('c3', 32),
         '{"luna":3,"an":2026,"linii":[{"cod":"A100","um":"M","cantitate_perioada":50,"valoare":5000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"cod"}]}'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.baza_cantitate <> 100 OR r.decontat_cantitate <> 120 OR r.rest_cantitate <> -20 OR r.decontat_valoare <> 12000 OR r.rest_valoare <> -2000
     OR r.peste_oferta IS NOT TRUE OR r.nedecontat IS NOT FALSE OR r.pct_decontat <> 120.0 OR r.situatii <> 3 OR r.ultima_situatie <> '3' THEN
    RAISE EXCEPTION 't_negative FAIL: %', row_to_json(r);
  END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300';
  IF r.rest_cantitate <> 10 OR r.nedecontat IS NOT TRUE OR r.peste_oferta IS NOT FALSE OR r.pct_decontat <> 0 THEN RAISE EXCEPTION 't_negative FAIL C300 nedecontat: %', row_to_json(r); END IF;
  SELECT * INTO r FROM public.v_executie_rest_decontat_obiect WHERE proiect_id = pg_temp.rd_id('p1') AND nivel = 'proiect';
  IF r.baza_valoare <> 15610 OR r.decontat_valoare <> 12000 OR r.rest_valoare <> 3610 OR r.articole <> 6 OR r.articole_peste <> 1 OR r.articole_nedecontate <> 5 THEN
    RAISE EXCEPTION 't_negative FAIL total proiect: %', row_to_json(r);
  END IF;
  IF (SELECT rest_valoare FROM public.v_executie_rest_decontat_obiect WHERE proiect_id = pg_temp.rd_id('p1') AND nivel = 'obiect' AND obiect_cod = '0002') <> 500 THEN
    RAISE EXCEPTION 't_negative FAIL obiect 0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'sl_fara_detaliu') THEN
    RAISE EXCEPTION 't_negative FAIL: situatia 1 inca „fara detaliu” dupa confirmare';
  END IF;
  RAISE NOTICE 't_negative_peste_oferta ok: decontat 120 (80 - 10 + 50), rest -20 semnalat peste_oferta; totaluri pe obiect / proiect';
END $t$;

-- ── t_um: baza „100 MC” x 2 = 200 MC; linie in MC 50 → rest 150; linie in ML → exceptie (nimic scris) ───────────────────────
DO $t$
DECLARE v jsonb; r record; n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '4', NULL, 'sl4.xlsx', repeat('c4', 32),
         '[{"cod":"B200","um":"MC","cantitate_perioada":50,"valoare":500,"cheie":"0001|D1|B200","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|B200';
  IF r.baza_cantitate <> 200 OR r.um <> 'MC' OR r.decontat_cantitate <> 50 OR r.rest_cantitate <> 150 OR r.pct_decontat <> 25.0 THEN RAISE EXCEPTION 't_um FAIL MC: %', row_to_json(r); END IF;
  SELECT count(*) INTO n FROM public.executie_sl_detaliu;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '5', NULL, 'sl5.xlsx', repeat('c5', 32),
           '[{"cod":"B200","um":"ML","cantitate_perioada":1,"valoare":10,"cheie":"0001|D1|B200","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_um FAIL: UM diferit (ML pe un articol in MC) acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%um_diferit%' THEN RAISE; END IF; END;
  -- „100 MC” in situatie pe articolul in MC = acelasi UM normalizat, cantitatea x 100
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '5', NULL, 'sl5.xlsx', repeat('c5', 32),
         '[{"cod":"B200","um":"100 MC","cantitate_perioada":0.5,"valoare":500,"cheie":"0001|D1|B200","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|B200';
  IF r.decontat_cantitate <> 100 OR r.rest_cantitate <> 100 THEN RAISE EXCEPTION 't_um FAIL 100 MC: %', row_to_json(r); END IF;
  IF (SELECT count(*) FROM public.executie_sl_detaliu) <> n + 1 THEN RAISE EXCEPTION 't_um FAIL: refuzul a scris ceva'; END IF;
  -- o cheie care nu e in baza = refuz; un articol in afara ofertei = permis, apare cu baza 0
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '6', NULL, 'sl6.xlsx', repeat('c6', 32),
           '[{"cod":"X999","um":"M","cantitate_perioada":1,"valoare":10,"cheie":"0001|D1|X999","tip_rand":"articol","potrivire":"manual"}]'::jsonb, false);
    RAISE EXCEPTION 't_um FAIL: cheie inexistenta in baza acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%nu e in baza%' THEN RAISE; END IF; END;
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '6', NULL, 'sl6.xlsx', repeat('c6', 32),
         '[{"obiect_cod":"0001","cod":"X999","denumire":"Lucrare noua","um":"M","cantitate_perioada":3,"valoare":300,"tip_rand":"articol_nou"}]'::jsonb, false);
  SELECT * INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND tip_rand = 'articol_nou';
  IF r.cheie IS NOT NULL OR r.baza_valoare <> 0 OR r.decontat_valoare <> 300 OR r.rest_valoare <> -300 OR r.peste_oferta IS NOT TRUE THEN RAISE EXCEPTION 't_um FAIL articol_nou: %', row_to_json(r); END IF;
  RAISE NOTICE 't_um ok: 100 MC x 2 = 200 MC, 50 MC → rest 150, 0.5 x 100 MC → rest 100; ML refuzat (um_diferit); cheie inexistenta refuzata; articol nou cu baza 0';
END $t$;

-- ── t_dublare_situatie: aceeasi amprenta → refuz; alt fisier, acelasi nr, fara inlocuieste → refuz; cu inlocuieste → vechea inactiva, decontat = noua ──
DO $t$
DECLARE v jsonb; r record; n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000b');
  SELECT count(*) INTO n FROM public.executie_sl_detaliu;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '9', NULL, 'sl1.xlsx', repeat('c1', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":80,"valoare":8000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_dublare FAIL: aceeasi amprenta (alt nr) acceptata';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%amprenta_existenta%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', pg_temp.rd_id('sl1'), 'sl1b.xlsx', repeat('d1', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":70,"valoare":7000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_dublare FAIL: acelasi nr fara inlocuieste acceptat';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%situatie_existenta%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.executie_sl_detaliu) <> n OR (SELECT decontat_cantitate FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN
    RAISE EXCEPTION 't_dublare FAIL: refuzurile au scris ceva';
  END IF;
  -- inlocuirea: totalul 7000 difera de situatia de plata (8000) peste prag → cere accept_diferenta
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', pg_temp.rd_id('sl1'), 'sl1b.xlsx', repeat('d1', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":70,"valoare":7000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, true);
    RAISE EXCEPTION 't_dublare FAIL: diferenta fata de situatia de plata acceptata tacit';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%accept_diferenta%' THEN RAISE; END IF; END;
  v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '1', pg_temp.rd_id('sl1'), 'sl1b.xlsx', repeat('d1', 32),
         '{"accept_diferenta":true,"linii":[{"cod":"A100","um":"M","cantitate_perioada":70,"valoare":7000,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]}'::jsonb, true);
  IF (v->>'versiune')::int <> 2 OR (v->>'inlocuit_id')::bigint <> pg_temp.rd_id('d1') THEN RAISE EXCEPTION 't_dublare FAIL inlocuire: %', v; END IF;
  SELECT activ, versiune INTO r FROM public.executie_sl_detaliu WHERE id = pg_temp.rd_id('d1');
  IF r.activ IS NOT FALSE OR r.versiune <> 1 THEN RAISE EXCEPTION 't_dublare FAIL: versiunea veche nu e inactiva'; END IF;
  SELECT decontat_cantitate, decontat_valoare, situatii INTO r FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.decontat_cantitate <> 110 OR r.decontat_valoare <> 11000 OR r.situatii <> 3 THEN RAISE EXCEPTION 't_dublare FAIL decontat dupa inlocuire: %', row_to_json(r); END IF;
  -- fara versiune activa de inlocuit, „inlocuieste” e refuzat; liniile vechi raman (istoric)
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '77', NULL, 'x.xlsx', repeat('d7', 32),
           '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, true);
    RAISE EXCEPTION 't_dublare FAIL: inlocuieste fara versiune activa acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM public.executie_sl_detaliu_linii l WHERE l.detaliu_id = pg_temp.rd_id('d1')) <> 1 THEN RAISE EXCEPTION 't_dublare FAIL: liniile vechi au disparut'; END IF;
  RAISE NOTICE 't_dublare_situatie ok: amprenta / nr existent refuzate (nimic scris); inlocuirea cere confirmare + accept_diferenta; vechea versiune inactiva, decontat = noua (110)';
END $t$;
RESET ROLE;

-- ── t_aa_leaga_note: NCS +20 → 120; AA legat de NCS (+20 si +5 pe alt articol) → 120 + 5 (nu 140); AA dezactivat → 120 ────────────
-- responsabilul de contracte (f): poate scrie nota si devizele ei / ale AA-ului, dar NU vede restul de decontat
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000f', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000f","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; v_nota bigint; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000f');
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'documente_baza')
     OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'confirmare') THEN
    RAISE EXCEPTION 't_aa FAIL: dreptul responsabilului de contracte (documente_baza doar pe P1, fara citire / confirmare)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza) THEN RAISE EXCEPTION 't_aa FAIL: responsabilul vede restul'; END IF;
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, data_aprobare, descriere, creat_de) VALUES (pg_temp.rd_id('p1'), 'ncs', ' NCS-1 ', DATE '2026-03-01', 'suplimentare', 'f0000000-0000-4000-8000-00000000000a')
  RETURNING id INTO v_nota;
  INSERT INTO rd_fix VALUES ('ncs1', v_nota);
  SELECT tip, numar, creat_de INTO r FROM public.executie_note_modificare WHERE id = v_nota;
  IF r.tip <> 'NCS' OR r.numar <> 'NCS-1' OR r.creat_de <> auth.uid() THEN RAISE EXCEPTION 't_aa FAIL: normalizarea / autorul notei (%)', row_to_json(r); END IF;
  BEGIN
    INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p2'), 'NR', 'NR-9');
    RAISE EXCEPTION 't_aa FAIL: nota pe proiectul altuia acceptata';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p1'), 'NCS', 'NCS-1');
    RAISE EXCEPTION 't_aa FAIL: aceeasi nota de doua ori';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- devizul notei: +20 pe A100
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs1.xlsx', repeat('e1', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":20,"pret_unitar":100,"valoare":2000}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR v->>'mod_import' <> 'diferente' THEN RAISE EXCEPTION 't_aa FAIL deviz nota: %', v; END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs1b.xlsx', repeat('e2', 32),
           '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"M","cantitate":1,"valoare":100}]'::jsonb);
    RAISE EXCEPTION 't_aa FAIL: al doilea deviz pe aceeasi nota acceptat';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- UM diferit de cheia din baza (A100 e in M) = refuz
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'aa1.xlsx', repeat('e3', 32),
           '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"BUC","cantitate":20,"valoare":2000}]'::jsonb);
    RAISE EXCEPTION 't_aa FAIL: UM diferit in deviz acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%UM diferit%' THEN RAISE; END IF; END;
  RAISE NOTICE 't_aa_leaga_note (1/2) ok: nota scrisa de responsabilul de contracte (autor / normalizare din server; alt proiect refuzat), deviz NCS +20; al doilea deviz / UM diferit refuzate';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  IF (SELECT count(*) FROM public.proiect_articole a WHERE a.proiect_id = pg_temp.rd_id('p1') AND a.confirmat_de = 'f0000000-0000-4000-8000-00000000000b' AND a.fisier_amprenta = repeat('b1', 32)
        AND a.activ AND a.sursa = 'contract_initial' AND a.mod_import = 'lista_completa' AND a.confirmat_la IS NOT NULL) <> 6 THEN
    RAISE EXCEPTION 't_aa FAIL: provenienta ofertei (autor = MP-ul, amprenta, mod lista_completa)';
  END IF;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN RAISE EXCEPTION 't_aa FAIL: baza dupa NCS <> 120'; END IF;
  -- legarea notei de AA-1 (AA fara deviz inca): nota ramane numarata (nimic nu o preia)
  UPDATE public.executie_note_modificare SET act_aditional_id = pg_temp.rd_id('aa1') WHERE id = pg_temp.rd_id('ncs1');
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN RAISE EXCEPTION 't_aa FAIL: nota legata de un AA fara deviz a disparut din baza'; END IF;
  -- devizul AA-1, „doar diferente”: +20 A100 (preia NCS) si +5 C300
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'aa1.xlsx', repeat('e3', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"Conducta","um":"M","cantitate":20,"pret_unitar":110,"valoare":2200},
           {"obiect_cod":"0002","deviz_cod":"D2","cod":"C300","denumire":"Alt articol","um":"BUC","cantitate":5,"pret_unitar":50,"valoare":250}]'::jsonb);
  SELECT cantitate, valoare, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.cantitate <> 120 OR r.valoare <> 12200 OR r.pret_unitar <> 110 THEN RAISE EXCEPTION 't_aa FAIL: AA legat de NCS → baza % (astept 120, pret 110)', row_to_json(r); END IF;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300') <> 15 THEN RAISE EXCEPTION 't_aa FAIL: C300 <> 15'; END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip IN ('aa_fara_deviz', 'nota_fara_deviz')) THEN RAISE EXCEPTION 't_aa FAIL: lipsuri ramase dupa devize'; END IF;
  -- AA dezactivat: randurile lui ies, nota conteaza din nou
  UPDATE public.executie_acte_aditionale SET activ = false WHERE id = pg_temp.rd_id('aa1');
  SELECT cantitate, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100';
  IF r.cantitate <> 120 OR r.pret_unitar <> 100 THEN RAISE EXCEPTION 't_aa FAIL: AA inactiv → baza % (astept 120, pret 100)', row_to_json(r); END IF;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300') <> 10 THEN RAISE EXCEPTION 't_aa FAIL: C300 dupa AA inactiv <> 10'; END IF;
  -- nota dezactivata: iese si ea
  UPDATE public.executie_note_modificare SET activ = false WHERE id = pg_temp.rd_id('ncs1');
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 100 THEN RAISE EXCEPTION 't_aa FAIL: nota inactiva inca numarata'; END IF;
  UPDATE public.executie_note_modificare SET activ = true WHERE id = pg_temp.rd_id('ncs1');
  UPDATE public.executie_acte_aditionale SET activ = true WHERE id = pg_temp.rd_id('aa1');
  -- nota: proiectul / autorul nu se schimba; actul altui proiect refuzat
  BEGIN UPDATE public.executie_note_modificare SET proiect_id = pg_temp.rd_id('p2') WHERE id = pg_temp.rd_id('ncs1'); RAISE EXCEPTION 't_aa FAIL: proiectul notei schimbat';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.executie_note_modificare SET creat_de = auth.uid() WHERE id = pg_temp.rd_id('ncs1'); RAISE EXCEPTION 't_aa FAIL: autorul notei schimbat';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public.executie_note_modificare WHERE id = pg_temp.rd_id('ncs1'); RAISE EXCEPTION 't_aa FAIL: nota stearsa';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- AA „lista completa” pe obiectul 0002 (datat DUPA oferta si AA-1): inlocuieste randurile datate inainte pe 0002 (C300 = 12), 0001 neatins
  INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act, data_semnare, activ) VALUES (pg_temp.rd_id('p1'), 'AA-2', DATE '2026-07-01', true) RETURNING id INTO r;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', r.id, NULL, 'lista_completa', 'aa2.xlsx', repeat('e4', 32),
         '[{"obiect_cod":"0002","deviz_cod":"D2","cod":"C300","denumire":"Alt articol revizuit","um":"BUC","cantitate":12,"pret_unitar":55,"valoare":660}]'::jsonb);
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0002|D2|C300') <> 12
     OR (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100') <> 120 THEN
    RAISE EXCEPTION 't_aa FAIL: lista completa pe 0002';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', r.id, NULL, 'lista_completa', 'aa2b.xlsx', repeat('e5', 32),
           '[{"obiect_cod":"0002","deviz_cod":"D2","cod":"C300","denumire":"x","um":"BUC","cantitate":-1,"valoare":-55}]'::jsonb);
    RAISE EXCEPTION 't_aa FAIL: lista completa cu cantitate negativa / al doilea deviz pe AA acceptat';
  EXCEPTION WHEN unique_violation OR invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 't_aa_leaga_note ok: NCS +20 → 120; AA legat (+20, +5) → 120 si C300 15 (nu 140); AA inactiv → 120 / 10; nota inactiva → 100; lista completa pe 0002 → 12';
END $t$;
RESET ROLE;

-- ── t_surse_autorizate (r3, review #1158): accesul GENERAL Executie (e: executie viewer, trece de politicile vechi ale proiect_articole) nu poate
--    aduce in baza un rand NR / NCS / AA scris direct (fara nota / act, neconfirmat) — nici prin INSERT, nici schimband sursa unui rand existent
--    neconfirmat; calea veche (extras_materiale) merge; apoi, ca SERVER (auth.uid() NULL, trece de garda), CHECK-ul rd_legaturi_ck refuza randul
--    orfan SI pe cel cu legatura dar neconfirmat (apararea a doua, structurala); baza A100 ramane 120 ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_id bigint; n int; s text;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF NOT EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) THEN RAISE EXCEPTION 't_surse_autorizate PRECONDITIE: accesul general nu citeste proiect_articole (politicile vechi)'; END IF;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1');
  FOREACH s IN ARRAY ARRAY['nota_comanda_suplimentara', 'nota_renuntare', 'act_aditional'] LOOP
    BEGIN
      INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, act_nr)
      VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'Conducta', 'M', 20, 2000, s, CASE WHEN s = 'act_aditional' THEN 'AA-X' END);
      RAISE EXCEPTION 't_surse_autorizate FAIL: rand % scris direct (fara nota / act, neconfirmat)', s;
    EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  END LOOP;
  -- schimbarea sursei unui rand existent neconfirmat (calea veche) catre NR / NCS / AA = refuz; randul ramane cum era
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'extras', 'M', 20, 0, 'extras_materiale') RETURNING id INTO v_id;
  FOREACH s IN ARRAY ARRAY['nota_comanda_suplimentara', 'nota_renuntare', 'act_aditional'] LOOP
    BEGIN
      UPDATE public.proiect_articole SET sursa = s, valoare = 2000 WHERE id = v_id;
      RAISE EXCEPTION 't_surse_autorizate FAIL: sursa unui rand neconfirmat schimbata direct in %', s;
    EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%confirma_baza%' THEN RAISE; END IF; END;
  END LOOP;
  IF (SELECT sursa || '/' || valoare::text FROM public.proiect_articole WHERE id = v_id) <> 'extras_materiale/0' THEN RAISE EXCEPTION 't_surse_autorizate FAIL: randul extras s-a schimbat'; END IF;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) <> n THEN RAISE EXCEPTION 't_surse_autorizate FAIL: refuzurile au scris ceva'; END IF;
  RAISE NOTICE 't_surse_autorizate (1/2) ok: accesul general nu scrie direct NR / NCS / AA (INSERT si schimbarea sursei → 42501); calea veche (extras) merge';
END $t$;
RESET ROLE;
-- serverul (auth.uid() NULL, postgres): garda il lasa, CHECK-ul nu — randul orfan si randul cu legatura dar neconfirmat sunt refuzate structural
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
DECLARE n int; r record;
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN
    RAISE EXCEPTION 't_surse_autorizate PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres (acum % / %)', auth.uid(), current_user;
  END IF;
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1');
  FOR r IN SELECT * FROM (VALUES
      ('act_aditional', 'AA-X', NULL::bigint, NULL::bigint, 'AA fara act'),
      ('nota_renuntare', NULL, NULL, NULL, 'NR fara nota'),
      ('nota_comanda_suplimentara', NULL, NULL, NULL, 'NCS fara nota'),
      ('act_aditional', 'AA-1', pg_temp.rd_id('aa1'), NULL, 'AA cu act, neconfirmat'),
      ('nota_comanda_suplimentara', NULL, NULL, pg_temp.rd_id('ncs1'), 'NCS cu nota, neconfirmat')) v(sursa, act_nr, act_id, nota_id, ce) LOOP
    BEGIN
      INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, act_nr, act_aditional_id, nota_id)
      VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', r.ce, 'M', 1, 1, r.sursa, r.act_nr, r.act_id, r.nota_id);
      RAISE EXCEPTION 't_surse_autorizate FAIL: % scris de server (CHECK-ul nu a refuzat)', r.ce;
    EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%rd_legaturi_ck%' THEN RAISE; END IF; END;
  END LOOP;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) <> n
     OR (SELECT b.cantitate FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p1')) b WHERE b.cheie = '0001|D1|A100') <> 120 THEN
    RAISE EXCEPTION 't_surse_autorizate FAIL: refuzurile serverului au scris ceva / baza A100 <> 120';
  END IF;
  RAISE NOTICE 't_surse_autorizate (2/2) ok: CHECK-ul refuza si pe calea serverului randul AA / NR / NCS fara legatura sau neconfirmat; baza A100 = 120';
END $t$;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- ── t_coduri_repetate (owner, P4): TOATE grupurile de coduri repetate primesc pozitia (A#1, A#2, B#3, B#4 — nu B comasat 7); pozitii lipsa /
--    duplicate = refuz, nimic scris ──
DO $t$
DECLARE v jsonb; r record; n int;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  SELECT count(*) INTO n FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4');
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'contract_initial', NULL, NULL, NULL, 'o4.xlsx', repeat('a4', 32),
           '[{"obiect_cod":"OB1","deviz_cod":"D1","nr":"1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10},
             {"obiect_cod":"OB1","deviz_cod":"D1","nr":"1","cod":"A","denumire":"a bis","um":"M","cantitate":1,"valoare":10}]'::jsonb);
    RAISE EXCEPTION 't_coduri_repetate FAIL: acelasi cod cu aceeasi pozitie acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%pozitii duplicate%' THEN RAISE; END IF; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'contract_initial', NULL, NULL, NULL, 'o4.xlsx', repeat('a4', 32),
           '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10},
             {"obiect_cod":"OB1","deviz_cod":"D1","nr":"2","cod":"A","denumire":"a bis","um":"M","cantitate":1,"valoare":10}]'::jsonb);
    RAISE EXCEPTION 't_coduri_repetate FAIL: cod repetat cu o pozitie lipsa acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%pozitii lipsa%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4')) <> n THEN RAISE EXCEPTION 't_coduri_repetate FAIL: refuzurile au scris ceva'; END IF;
  -- doua grupuri repetate (A: #1 #2; B: #3 #4) + X singur, pret 10
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'contract_initial', NULL, NULL, NULL, 'o4.xlsx', repeat('a4', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","nr":"1","cod":"A","denumire":"a1","um":"M","cantitate":1,"valoare":10},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"2","cod":"A","denumire":"a2","um":"M","cantitate":2,"valoare":20},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"3","cod":"B","denumire":"b3","um":"M","cantitate":3,"valoare":30},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"4","cod":"B","denumire":"b4","um":"M","cantitate":4,"valoare":40},
           {"obiect_cod":"OB1","deviz_cod":"D1","nr":"5","cod":"X","denumire":"x","um":"M","cantitate":100,"pret_unitar":10,"valoare":1000}]'::jsonb);
  IF (v->>'inserate')::int <> 5 THEN RAISE EXCEPTION 't_coduri_repetate FAIL: %', v; END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) AS s, count(*) AS c INTO r FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p4');
  IF r.c <> 5 OR r.s IS DISTINCT FROM 'OB1|D1|A|#1=1; OB1|D1|A|#2=2; OB1|D1|B|#3=3; OB1|D1|B|#4=4; OB1|D1|X=100' THEN RAISE EXCEPTION 't_coduri_repetate FAIL baza: %', r.s; END IF;
  RAISE NOTICE 't_coduri_repetate ok: A#1, A#2, B#3, B#4 separate (5 chei), pozitii duplicate / lipsa refuzate';
END $t$;

-- ── t_ultimul_act (owner, P4): nota neaprobata nu intra (deviz refuzat, lipsa nota_neaprobata); dupa aprobare intra; AA „lista completa” pe
--    obiectul scris altfel (' ob1 ') INLOCUIESTE (150, nu 250); un act mai VECHI incarcat DUPA nu trece peste lista completa; pretul = ultimul act (dupa data) ──
DO $t$
DECLARE v jsonb; r record; v_nota bigint;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000a');
  INSERT INTO public.executie_note_modificare (proiect_id, tip, numar, descriere) VALUES (pg_temp.rd_id('p4'), 'NCS', 'NCS-9', 'fara aprobare inca') RETURNING id INTO v_nota;
  INSERT INTO rd_fix VALUES ('ncs9', v_nota);
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p4') AND tip = 'nota_neaprobata' AND referinta = 'NCS NCS-9') THEN
    RAISE EXCEPTION 't_ultimul_act FAIL: lipsa nota_neaprobata';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs9.xlsx', repeat('a9', 32),
           '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x","um":"M","cantitate":20,"pret_unitar":11,"valoare":220}]'::jsonb);
    RAISE EXCEPTION 't_ultimul_act FAIL: devizul unei note NEAPROBATE acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%nota_neaprobata%' THEN RAISE; END IF; END;
  IF (SELECT cantitate FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X') <> 100 THEN RAISE EXCEPTION 't_ultimul_act FAIL: refuzul a scris'; END IF;
  UPDATE public.executie_note_modificare SET data_aprobare = DATE '2026-04-01' WHERE id = v_nota;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'nota_comanda_suplimentara', NULL, v_nota, NULL, 'ncs9.xlsx', repeat('a9', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x","um":"M","cantitate":20,"pret_unitar":11,"valoare":220}]'::jsonb);
  SELECT cantitate, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 120 OR r.pret_unitar <> 11 THEN RAISE EXCEPTION 't_ultimul_act FAIL: nota aprobata → % (astept 120, pret 11)', row_to_json(r); END IF;
  -- aprobarea retrasa (data_aprobare NULL): randurile notei ies din baza, lipsa reapare
  UPDATE public.executie_note_modificare SET data_aprobare = NULL WHERE id = v_nota;
  SELECT cantitate, pret_unitar INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 100 OR r.pret_unitar <> 10 OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p4') AND tip = 'nota_neaprobata') THEN
    RAISE EXCEPTION 't_ultimul_act FAIL: nota cu aprobarea retrasa inca in baza: %', row_to_json(r);
  END IF;
  UPDATE public.executie_note_modificare SET data_aprobare = DATE '2026-04-01' WHERE id = v_nota;
  -- AA-4 (2026-05-01) lista completa, obiectul scris ' ob1 ': inlocuieste TOT ce e datat inainte pe OB1 (oferta, NCS-9) → doar X = 150, pret 12
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'act_aditional', pg_temp.rd_id('aa4'), NULL, 'lista_completa', 'aa4.xlsx', repeat('a5', 32),
         '[{"obiect_cod":" ob1 ","deviz_cod":"D1","cod":"X","denumire":"x revizuit","um":"M","cantitate":150,"pret_unitar":12,"valoare":1800}]'::jsonb);
  SELECT string_agg(b.cheie || '=' || b.cantitate::text || ' @' || coalesce(b.pret_unitar::text, '-') || ' r' || b.randuri, '; ' ORDER BY b.cheie) AS s INTO r
    FROM public.v_executie_rest_decontat_baza b WHERE b.proiect_id = pg_temp.rd_id('p4');
  IF r.s IS DISTINCT FROM 'OB1|D1|X=150 @12 r1' THEN RAISE EXCEPTION 't_ultimul_act FAIL lista completa pe identitate canonica: %', r.s; END IF;
  -- AA-5 (2026-02-01, mai vechi) incarcat DUPA AA-4, „doar diferente” +10 pret 9: e datat inaintea listei complete → ignorat; pretul ramane al AA-4
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p4'), 'act_aditional', pg_temp.rd_id('aa5'), NULL, 'diferente', 'aa5.xlsx', repeat('a6', 32),
         '[{"obiect_cod":"OB1","deviz_cod":"D1","cod":"X","denumire":"x","um":"M","cantitate":10,"pret_unitar":9,"valoare":90}]'::jsonb);
  SELECT cantitate, pret_unitar, randuri INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 150 OR r.pret_unitar <> 12 OR r.randuri <> 1 THEN RAISE EXCEPTION 't_ultimul_act FAIL: actul vechi incarcat tarziu a trecut peste lista completa: %', row_to_json(r); END IF;
  -- AA-4 dezactivat: lista completa dispare, raman oferta (100 @10), NCS-9 (+20 @11, 2026-04) si AA-5 (+10 @9, 2026-02) → 130, pretul = NCS-9 (data cea mai recenta)
  UPDATE public.executie_acte_aditionale SET activ = false WHERE id = pg_temp.rd_id('aa4');
  SELECT cantitate, pret_unitar, randuri INTO r FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X';
  IF r.cantitate <> 130 OR r.pret_unitar <> 11 OR r.randuri <> 3 THEN RAISE EXCEPTION 't_ultimul_act FAIL: fara AA-4 → % (astept 130 @11, 3 randuri)', row_to_json(r); END IF;
  UPDATE public.executie_acte_aditionale SET activ = true WHERE id = pg_temp.rd_id('aa4');
  RAISE NOTICE 't_ultimul_act ok: nota neaprobata refuzata / exclusa, aprobata → 120 @11; lista completa pe " ob1 " → 150 @12 (nu 250); actul vechi incarcat tarziu ignorat; fara AA-4 → 130 @11';
END $t$;
RESET ROLE;

-- ── t_drept_restrans: restrictia pe proiect (20261209a) se aplica inaintea dreptului de modul: h (editor pe sub-modul, viewer pe P2) citeste doar
--    P2 si nu confirma; i (editor pe sub-modul, editor pe P2) confirma doar pe P2; P1 e invizibil pentru amandoi ──
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000011', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-000000000011');
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p3'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p4'), 'citire')
     OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') THEN
    RAISE EXCEPTION 't_drept_restrans FAIL: dreptul contului restrans viewer pe P2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id <> pg_temp.rd_id('p2')) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id <> pg_temp.rd_id('p2'))
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_obiect WHERE proiect_id <> pg_temp.rd_id('p2')) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id <> pg_temp.rd_id('p2'))
     OR EXISTS (SELECT 1 FROM public.executie_note_modificare) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu_linii)
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p2') AND tip = 'fara_oferta') THEN
    RAISE EXCEPTION 't_drept_restrans FAIL: contul restrans vede alte proiecte decat P2 (functiile DEFINER)';
  END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p2'), 'contract_initial', NULL, NULL, NULL, 'o2.xlsx', repeat('a2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10}]'::jsonb);
    RAISE EXCEPTION 't_drept_restrans FAIL: viewer-ul pe proiect a confirmat oferta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'x.xlsx', repeat('a3', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"x","um":"M","cantitate":1,"valoare":100}]'::jsonb);
    RAISE EXCEPTION 't_drept_restrans FAIL: contul restrans a confirmat pe P1';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p1'), 'NR', 'NR-H'); RAISE EXCEPTION 't_drept_restrans FAIL: nota pe P1 scrisa de contul restrans';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_restrans (1/2) ok: viewer pe P2 → citeste doar P2 in cele 4 vederi, nu confirma, P1 invizibil';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000012', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-000000000012');
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'documente_baza')
     OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') THEN
    RAISE EXCEPTION 't_drept_restrans FAIL: dreptul contului restrans editor pe P2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id <> pg_temp.rd_id('p2')) THEN RAISE EXCEPTION 't_drept_restrans FAIL: editorul restrans vede P1'; END IF;
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p2'), 'contract_initial', NULL, NULL, NULL, 'o2.xlsx', repeat('a2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A","denumire":"a","um":"M","cantitate":1,"valoare":10}]'::jsonb);
  IF (v->>'inserate')::int <> 1 OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p2') AND cheie = '0001|D1|A') THEN RAISE EXCEPTION 't_drept_restrans FAIL: editorul pe P2 nu a confirmat oferta P2'; END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '8', NULL, 'x.xlsx', repeat('a7', 32), '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_drept_restrans FAIL: editorul restrans a confirmat o situatie pe P1';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_restrans (2/2) ok: editor pe P2 → confirma pe P2, nimic pe P1';
END $t$;
RESET ROLE;

-- ── t_drept_sef_santier: executie viewer + sef de santier pe P1, fara sub-modul, nu e MP → 0 randuri peste tot, RPC-uri refuzate ──────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000e', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; v_id bigint;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000e');
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza)
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_obiect) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri)
     OR EXISTS (SELECT 1 FROM public.executie_note_modificare) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu_linii) THEN
    RAISE EXCEPTION 't_drept FAIL: seful de santier vede randuri';
  END IF;
  IF public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'confirmare') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p1'), 'documente_baza')
     OR public.fn_rest_decontat_are_oferta(pg_temp.rd_id('p1')) THEN
    RAISE EXCEPTION 't_drept FAIL: dreptul sefului de santier';
  END IF;
  -- accesul general la Executie vede proiect_articole (politicile vechi), dar nu poate atinge randurile confirmate nici direct
  IF NOT EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1')) THEN RAISE EXCEPTION 't_drept FAIL: politicile vechi proiect_articole s-au schimbat'; END IF;
  BEGIN UPDATE public.proiect_articole SET cantitate = 999 WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100' AND sursa = 'contract_initial'; RAISE EXCEPTION 't_drept FAIL: rand confirmat modificat direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100'; RAISE EXCEPTION 't_drept FAIL: rand confirmat sters direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, confirmat_de, confirmat_la)
    VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'x', 'M', 1, 1, 'contract_initial', auth.uid(), now());
    RAISE EXCEPTION 't_drept FAIL: coloanele de confirmare scrise direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, cheie)
    VALUES (pg_temp.rd_id('p1'), '0001', 'D1', 'A100', 'x', 'M', 1, 1, 'extras_materiale', 'ALTA|CHEIE');
    RAISE EXCEPTION 't_drept FAIL: cheie arbitrara acceptata';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- calea veche (CatalogDevizPanel) merge ca inainte: rand fara cheie → cheia calculata in BD; nu intra in baza (nu e oferta) si nu se vede restul
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa)
  VALUES (pg_temp.rd_id('p1'), '0001', 'D1', ' a100 ', 'extras', 'M', 7, 0, 'extras_materiale') RETURNING id INTO v_id;
  IF (SELECT cheie FROM public.proiect_articole WHERE id = v_id) <> '0001|D1|A100' THEN RAISE EXCEPTION 't_drept FAIL: cheia nu s-a calculat pe calea veche'; END IF;
  UPDATE public.proiect_articole SET cod = 'A101' WHERE id = v_id;
  IF (SELECT cheie FROM public.proiect_articole WHERE id = v_id) <> '0001|D1|A101' THEN RAISE EXCEPTION 't_drept FAIL: cheia nu s-a recalculat la schimbarea codului'; END IF;
  DELETE FROM public.proiect_articole WHERE id = v_id;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '8', NULL, 'x.xlsx', repeat('f1', 32), '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_drept FAIL: seful de santier a confirmat o situatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'act_aditional', pg_temp.rd_id('aa1'), NULL, 'diferente', 'x.xlsx', repeat('f2', 32), '[{"obiect_cod":"0001","deviz_cod":"D1","cod":"A100","denumire":"x","um":"M","cantitate":1,"valoare":100}]'::jsonb);
    RAISE EXCEPTION 't_drept FAIL: seful de santier a confirmat un deviz';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_sl_detaliu (proiect_id, nr_situatie, amprenta, confirmat_de) VALUES (pg_temp.rd_id('p1'), '8', repeat('f3', 32), auth.uid()); RAISE EXCEPTION 't_drept FAIL: INSERT direct in executie_sl_detaliu';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_note_modificare (proiect_id, tip, numar) VALUES (pg_temp.rd_id('p1'), 'NR', 'NR-1'); RAISE EXCEPTION 't_drept FAIL: nota scrisa de seful de santier';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_sef_santier (1/3) ok: 0 randuri in 4 vederi + 3 tabele; RPC-uri / scrieri directe refuzate; calea veche a articolelor merge, cu cheia din BD';
END $t$;
RESET ROLE;
-- contul fara niciun drept (g) si directorul financiar (c, viewer pe sub-modul: citeste tot, nu confirma)
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000010', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-000000000010');
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat) OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri) OR EXISTS (SELECT 1 FROM public.executie_sl_detaliu) THEN
    RAISE EXCEPTION 't_drept FAIL: contul fara drepturi vede randuri';
  END IF;
  RAISE NOTICE 't_drept_sef_santier (2/3) ok: contul fara drepturi nu vede nimic';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000c', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000c');
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p3') AND tip = 'fara_oferta')
     OR EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p2') AND tip = 'fara_oferta')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p1') AND cheie = '0001|D1|A100')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat WHERE proiect_id = pg_temp.rd_id('p2') AND cheie = '0001|D1|A')
     OR NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_baza WHERE proiect_id = pg_temp.rd_id('p4') AND cheie = 'OB1|D1|X')
     OR (SELECT count(*) FROM public.executie_sl_detaliu WHERE proiect_id = pg_temp.rd_id('p1')) <> 7 THEN
    RAISE EXCEPTION 't_drept FAIL: directorul financiar nu vede toate proiectele (P1, P2 cu oferta, P3 fara oferta, P4)';
  END IF;
  IF NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'citire') OR public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') THEN RAISE EXCEPTION 't_drept FAIL: viewer pe sub-modul'; END IF;
  BEGIN
    v := public.fn_rest_decontat_confirma_situatie(pg_temp.rd_id('p1'), '8', NULL, 'x.xlsx', repeat('f4', 32), '[{"cod":"A100","um":"M","cantitate_perioada":1,"valoare":100,"cheie":"0001|D1|A100","tip_rand":"articol","potrivire":"exact"}]'::jsonb, false);
    RAISE EXCEPTION 't_drept FAIL: viewer-ul a confirmat o situatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 't_drept_sef_santier (3/3) ok: directorul financiar (viewer) citeste toate proiectele, nu confirma; MP-ul vede doar proiectele lui (blocul t_fara_baza)';
END $t$;
RESET ROLE;
-- editorul pe sub-modul (d) confirma; nimeni nu trece de garda situatiilor cu rolul service_role (fara drepturi pe tabele)
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000d', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000000d');
  IF NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'confirmare') OR NOT public.fn_rest_decontat_drept(pg_temp.rd_id('p2'), 'documente_baza') THEN RAISE EXCEPTION 't_drept FAIL: editorul pe sub-modul'; END IF;
END $t$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $t$
BEGIN
  BEGIN PERFORM 1 FROM public.executie_sl_detaliu; RAISE EXCEPTION 't_drept FAIL: service_role citeste situatiile detaliate direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.v_executie_rest_decontat; RAISE EXCEPTION 't_drept FAIL: service_role citeste vederea';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $t$;
RESET ROLE;

-- ── t_rand_orfan (apararea in adancime, r3): daca un rand AA / NR / NCS fara legatura sau neconfirmat ar ajunge TOTUSI in tabel (CHECK-ul scos
--    temporar intr-un sub-bloc, scriere de server, P4 pe obiectul OB2), calculul NU il numara (baza P4 ramane OB1|D1|X=150), iar lipsurile il
--    declara pe sursa ('rand_neautorizat'); sub-blocul se ANULEAZA (constrangerea revine, randurile dispar). Ultimul bloc: nimic nu depinde de el ──
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
DO $t$
DECLARE s text;
BEGIN
  IF auth.uid() IS NOT NULL OR public.fn_rest_decontat_server() IS NOT TRUE THEN
    RAISE EXCEPTION 't_rand_orfan PRECONDITIE: blocul serverului cere auth.uid() NULL si rolul postgres (acum % / %)', auth.uid(), current_user;
  END IF;
  SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) INTO s FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p4')) b;
  IF s IS DISTINCT FROM 'OB1|D1|X=150' THEN RAISE EXCEPTION 't_rand_orfan PRECONDITIE: baza P4 = % (astept OB1|D1|X=150)', s; END IF;
  BEGIN
    ALTER TABLE public.proiect_articole DROP CONSTRAINT proiect_articole_rd_legaturi_ck;
    INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, cod, denumire, um, cantitate, valoare, sursa, act_nr, act_aditional_id, nota_id) VALUES
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'orfan: AA fara act', 'M', 7, 70, 'act_aditional', 'AA-X', NULL, NULL),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'AA cu act activ, neconfirmat', 'M', 7, 70, 'act_aditional', 'AA-4', pg_temp.rd_id('aa4'), NULL),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'orfan: NCS fara nota', 'M', 7, 70, 'nota_comanda_suplimentara', NULL, NULL, NULL),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'NCS cu nota aprobata, neconfirmat', 'M', 7, 70, 'nota_comanda_suplimentara', NULL, NULL, pg_temp.rd_id('ncs9')),
      (pg_temp.rd_id('p4'), 'OB2', 'D1', 'Y', 'orfan: NR fara nota', 'M', -7, -70, 'nota_renuntare', NULL, NULL, NULL);
    IF (SELECT count(*) FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND obiect_cod = 'OB2' AND activ) <> 5 THEN
      RAISE EXCEPTION 't_rand_orfan PRECONDITIE: cele 5 randuri orfane / neconfirmate nu s-au scris';
    END IF;
    SELECT string_agg(b.cheie || '=' || b.cantitate::text, '; ' ORDER BY b.cheie) INTO s FROM public.fn_rest_decontat_baza_proiect(pg_temp.rd_id('p4')) b;
    IF s IS DISTINCT FROM 'OB1|D1|X=150' THEN RAISE EXCEPTION 't_rand_orfan FAIL: randurile orfane / neconfirmate au intrat in baza: %', s; END IF;
    -- lipsurile (ca owner-ul a, care citeste P4; apoi inapoi la server)
    PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
    SELECT string_agg(l.referinta, '; ' ORDER BY l.referinta) INTO s FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.proiect_id = pg_temp.rd_id('p4') AND l.tip = 'rand_neautorizat';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    IF s IS DISTINCT FROM 'act_aditional: 2; nota_comanda_suplimentara: 2; nota_renuntare: 1' THEN
      RAISE EXCEPTION 't_rand_orfan FAIL: lipsurile nu declara randurile neautorizate pe sursa: %', coalesce(s, 'nimic');
    END IF;
    RAISE EXCEPTION 'ORFAN_GATA' USING ERRCODE = 'P0999';   -- anuleaza sub-blocul: constrangerea revine, randurile dispar
  EXCEPTION WHEN SQLSTATE 'P0999' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000000a', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.proiect_articole'::regclass AND k.conname = 'proiect_articole_rd_legaturi_ck')
     OR EXISTS (SELECT 1 FROM public.proiect_articole WHERE proiect_id = pg_temp.rd_id('p4') AND obiect_cod = 'OB2')
     OR EXISTS (SELECT 1 FROM public.fn_rest_decontat_lipsuri_calcul() l WHERE l.tip = 'rand_neautorizat') THEN
    RAISE EXCEPTION 't_rand_orfan FAIL: sub-blocul nu s-a anulat (constrangerea / randurile / lipsurile)';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 't_rand_orfan ok: 5 randuri AA / NR / NCS orfane sau neconfirmate (CHECK scos temporar) nu intra in calcul (P4 = OB1|D1|X=150) si apar in lipsuri pe sursa; sub-blocul anulat';
END $t$;

SELECT 'DRY_COMPLET' AS rezultat;
ROLLBACK;
