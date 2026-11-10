-- Harness 20261208a_executie_devize_tinte + 20261208b_executie_raport_lucrari_doar_rpc — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_devize_tinte.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> teste ca non-owner (SET LOCAL ROLE + JWT în ambele
-- surse) -> revenire refuzată (nearmată / cu configurare) -> revenire armată pe configurare goală -> re-aplicare.
-- NU presupune date reale: ia primul owner, primele 3 profiluri non-owner, primele 2 proiecte și primele 2 șantiere din catalog (pe clonă:
-- profiluri sintetice, CLONA-A / CLONA-B), le leagă DOAR în tranzacție și scrie date FICTIVE (coduri H…, nodul NOD-TEST-DEVIZ).
-- Identități: ed = Execuție editor; sef = șef de șantier pe primul șantier (fără Execuție); fara = fără niciun drept.
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
-- baseline (review r1 P1-4): politicile și drepturile tabelelor-sursă ÎNAINTE de migrări; după ele trebuie să fie identice
-- (singura schimbare voită: 20261208b retrage INSERT / UPDATE / DELETE pe raport_lucrari)
SELECT set_config('tdev.pol0', (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('raport_lucrari', 'rapoarte_zilnice', 'proiect_unitati', 'proiect_activitati', 'proiect_articole', 'sites', 'profile_sites')), true), set_config('tdev.acl0', (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.rapoarte_zilnice'::regclass, 'public.proiect_unitati'::regclass, 'public.proiect_activitati'::regclass, 'public.proiect_articole'::regclass, 'public.sites'::regclass, 'public.profile_sites'::regclass)), true),
       set_config('tdev.sel0', (SELECT string_agg(r || ':' || has_table_privilege(r, 'public.raport_lucrari', 'SELECT') || has_table_privilege(r, 'public.raport_lucrari', 'TRUNCATE'), ',' ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r), true);
SELECT set_config('gazpet.livrare_migrare', '20261208a_executie_devize_tinte:' || txid_current(), true);
\ir ../supabase/migrations/20261208a_executie_devize_tinte.sql
SELECT set_config('gazpet.livrare_migrare', '20261208b_executie_raport_lucrari_doar_rpc:' || txid_current(), true);
\ir ../supabase/migrations/20261208b_executie_raport_lucrari_doar_rpc.sql

-- ── unelte ──
-- identitatea: ambele surse JWT (auth.uid() citește întâi request.jwt.claim.sub), apoi rolul fără BYPASSRLS
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
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 't_refuza: așteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM, 200); END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
-- scrierea nu are efect: refuz de drept (42501) SAU 0 rânduri atinse (RLS-ul existent al tabelului); altă eroare = abatere
CREATE FUNCTION pg_temp.t_nu_scrie(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE NOTICE 't_nu_scrie: % rânduri atinse: %', n, left(p_sql, 200); END IF;
  RETURN n = 0;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
  WHEN OTHERS THEN RAISE NOTICE 't_nu_scrie: altă eroare % (%)', SQLSTATE, left(SQLERRM, 200); RETURN false;
END $h$;
-- scrierea trece: întoarce numărul de rânduri; orice eroare = -1
CREATE FUNCTION pg_temp.t_trece(p_sql text) RETURNS integer LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 't_trece: eroare % (%): %', SQLSTATE, left(SQLERRM, 200), left(p_sql, 200); RETURN -1;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tdev.' || p, true), ''); $h$;
-- o linie de raport: {activitate_id, unitate_id, cantitate} cu id-urile din tranzacție (unitate NULL = fără obiect)
CREATE FUNCTION pg_temp.t_l(p_a text, p_u text, p_c numeric) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT jsonb_build_object('activitate_id', pg_temp.t_g(p_a)::bigint, 'unitate_id', pg_temp.t_g(p_u)::bigint, 'cantitate', p_c);
$h$;
CREATE FUNCTION pg_temp.t_salv(p_site text, p_zi date, p_antet jsonb, p_linii jsonb, p_ver integer, p_cheie uuid) RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_raport_zilnic_salveaza(pg_temp.t_g(p_site)::bigint, p_zi, p_antet, p_linii, NULL, p_ver, p_cheie);
$h$;
-- cu distribuția (rândurile conducte / branșamente, formatul din src/raportDistributie.js)
CREATE FUNCTION pg_temp.t_salv_d(p_site text, p_zi date, p_dist jsonb, p_ver integer, p_cheie uuid) RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_raport_zilnic_salveaza(pg_temp.t_g(p_site)::bigint, p_zi, '{}'::jsonb, NULL, p_dist, p_ver, p_cheie);
$h$;
-- rândul vederii pentru (unitate, activitate) pe proiectul 1; NULL = cheia lipsă (fără obiect / nealocat)
CREATE FUNCTION pg_temp.t_v(p_u text, p_a text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $h$
DECLARE r jsonb; n integer;
BEGIN
  SELECT count(*), max(to_jsonb(v)::text)::jsonb INTO n, r FROM public.v_executie_tinte v
   WHERE v.proiect_id = pg_temp.t_g('p1')::bigint AND v.unitate_id IS NOT DISTINCT FROM pg_temp.t_g(p_u)::bigint
     AND v.activitate_id IS NOT DISTINCT FROM pg_temp.t_g(p_a)::bigint;
  IF n > 1 THEN RAISE EXCEPTION 't_v: % rânduri pentru (%, %)', n, p_u, p_a; END IF;
  RETURN r;
END $h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0: psql :ERROR = true, :SQLSTATE și mesajul exact (L25: testul pică dacă trece)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_nu_scrie(text), pg_temp.t_trece(text),
  pg_temp.t_g(text), pg_temp.t_l(text, text, numeric), pg_temp.t_salv(text, date, jsonb, jsonb, integer, uuid), pg_temp.t_salv_d(text, date, jsonb, integer, uuid), pg_temp.t_v(text, text)
  TO authenticated, anon, service_role;

-- ── TB: migrările nu lărgesc citirea tabelelor-sursă: politicile, RLS-ul și drepturile lor sunt identice cu cele de dinainte ──
DO $t$
DECLARE v text;
BEGIN
  IF (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('raport_lucrari', 'rapoarte_zilnice', 'proiect_unitati', 'proiect_activitati', 'proiect_articole', 'sites', 'profile_sites')) IS DISTINCT FROM pg_temp.t_g('pol0') OR (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.rapoarte_zilnice'::regclass, 'public.proiect_unitati'::regclass, 'public.proiect_activitati'::regclass, 'public.proiect_articole'::regclass, 'public.sites'::regclass, 'public.profile_sites'::regclass)) IS DISTINCT FROM pg_temp.t_g('acl0')
     OR (SELECT string_agg(r || ':' || has_table_privilege(r, 'public.raport_lucrari', 'SELECT') || has_table_privilege(r, 'public.raport_lucrari', 'TRUNCATE'), ',' ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r) IS DISTINCT FROM pg_temp.t_g('sel0') THEN
    RAISE EXCEPTION 'TB FAIL: migrările au schimbat politicile / drepturile tabelelor-sursă';
  END IF;
  -- baseline-ul, de citit pe clonă (expunerea de azi a tabelelor-sursă, NESCHIMBATĂ de migrări)
  SELECT string_agg(tablename || '.' || policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '-'), ' ; ' ORDER BY tablename, policyname) INTO v
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('raport_lucrari', 'rapoarte_zilnice', 'proiect_unitati', 'proiect_activitati', 'proiect_articole', 'sites', 'profile_sites');
  RAISE NOTICE 'TB baseline politici: %', coalesce(v, '(niciuna)');
  RAISE NOTICE 'TB OK';
END $t$;

-- ── T0: identități, drepturi rescrise în tranzacție, date fictive ──
DO $t$
DECLARE own uuid; ids uuid[]; p1 bigint; p2 bigint; s1 bigint; s2 bigint; z date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  u1 bigint; u2 bigint; u3 bigint; u4 bigint; u9 bigint; a_lans bigint; a_sud bigint; a_sap bigint; a_prob bigint; a_fara bigint; a9 bigint;
  r1 bigint; r2 bigint; r9 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) x;
  SELECT min(id), max(id) INTO p1, p2 FROM (SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 2) x;
  SELECT min(id), max(id) INTO s1, s2 FROM (SELECT id FROM public.sites ORDER BY id LIMIT 2) x;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR p1 IS NULL OR p1 = p2 OR s1 IS NULL OR s1 = s2 THEN
    RAISE EXCEPTION 'T0 FAIL: identități / proiecte / șantiere insuficiente';
  END IF;
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  DELETE FROM public.profile_sites WHERE profile_id = ANY (ids);
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ids[1], 'executie', 'editor');
  INSERT INTO public.profile_sites (profile_id, site_id) VALUES (ids[2], s1);
  UPDATE public.sites SET proiect_id = p1 WHERE id = s1;
  UPDATE public.sites SET proiect_id = p2 WHERE id = s2;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p1, 'tronson', 'T-H1', 'Tronson test H1', 901, true) RETURNING id INTO u1;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p1, 'obiect', 'NOD-H', 'Nod test H', 902, true) RETURNING id INTO u2;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p1, 'tronson', 'T-H3', 'Tronson test H3', 903, true) RETURNING id INTO u3;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p2, 'tronson', 'T-H9', 'Tronson test H9', 901, true) RETURNING id INTO u9;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ, obiect_cod) VALUES (p1, 'tronson', 'T-H4', 'Tronson test H4', 904, true, 'H004') RETURNING id INTO u4;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ)
    VALUES (p1, 'Țeavă lansată H', 'm', 'GA04, GA05', 901, 'cantitate', true) RETURNING id INTO a_lans;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ)
    VALUES (p1, 'Suduri DN600 H', 'buc', 'M1L05I', 902, 'cantitate', true) RETURNING id INTO a_sud;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ)
    VALUES (p1, 'Săpătură H', 'mc', 'tsc', 903, 'cantitate', true) RETURNING id INTO a_sap;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ)
    VALUES (p1, 'Probă H', 'buc', 'GC03', 904, 'bifa', true) RETURNING id INTO a_prob;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ)
    VALUES (p1, 'Diverse H', 'ore', NULL, 905, 'cantitate', true) RETURNING id INTO a_fara;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ)
    VALUES (p2, 'Lansat H9', 'm', 'GA04', 901, 'cantitate', true) RETURNING id INTO a9;
  -- calea server (postgres, fără JWT): configurarea trece (așa rulează seed-ul / legarea obiectelor, după „da”)
  UPDATE public.proiect_unitati SET obiect_cod = 'H012', nod_cod = 'NOD-TEST-DEVIZ' WHERE id = u2;
  UPDATE public.proiect_unitati SET obiect_cod = 'H001' WHERE id = u9;
  UPDATE public.proiect_activitati SET sursa_executat = 'schema_nod', baza_deviz = 'oferta', dn_min = 600, dn_max = 600, principala = true WHERE id = a_sud;
  UPDATE public.proiect_activitati SET factor_um = 0.5 WHERE id = a_sap;   -- multiplicatorul suplimentar, după conversia UM
  INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, sursa, act_nr) VALUES
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '001', 'GA04A1', 'lansare test', '100 M', 10, 1, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '002', 'GA05B1', 'lansare test', '100 M', 5, 1, 'act_aditional', '1'),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '003', 'ga04c1', 'lansare test', '100 M', -2, -1, 'act_aditional', '2'),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '004', 'GA0X1', 'alt articol', '100 M', 100, 1, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '005', 'GA04Z1', 'material', 'M', 7, 1, 'extras_materiale', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '006', 'GA04Q1', 'sursă necunoscută', 'M', 3, 1, 'altceva', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '007', 'M1L05I1', 'radiografie', 'BUC', 30, 1, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '008', 'M1L05I1', 'radiografie', 'BUC', -30, -1, 'act_aditional', '1'),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '009', 'TSC19B1', 'săpătură', '100 MC', 90, 1, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '010', 'TSC19B2', 'săpătură', '100 MC', NULL, NULL, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '012', 'TSC04Y1', 'săpătură', 'M.C.', 10, 1, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '013', 'TSC17X1', 'sprijiniri', '100 M.', 4, 1, 'contract_initial', NULL),
    (p1, 'H001', 'TRONSON H1', 'DH01', 'deviz test', '011', 'GC0301', 'probă', 'BUC', 1, 1, 'contract_initial', NULL),
    (p1, 'H012', 'CUPLARE H', 'DH12', 'deviz test', '001', 'M1L05I2', 'radiografie', 'BUC', 20, 1, 'contract_initial', NULL),
    (p1, 'H012', 'CUPLARE H', 'DH12', 'deviz test', '002', 'GA04A2', 'lansare', '100 M', 5, 1, 'contract_initial', NULL),
    (p2, 'H001', 'TRONSON H9', 'DH91', 'deviz test', '001', 'GA04A9', 'lansare', '100 M', 50, 1, 'contract_initial', NULL),
    (p1, 'H004', 'TRONSON H4', 'DH04', 'deviz test', '001', 'GA04A4', 'lansare', '100 M', 2, 1, 'contract_initial', NULL);
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod, dn, stare, data_stare, data_sudare, sudor, buletin_ndt, motiv) VALUES
    (p1, 'NOD-TEST-DEVIZ', 'HD-1', 600, 'sudat', z, z, 'S-1', NULL, NULL),
    (p1, 'NOD-TEST-DEVIZ', 'HD-2', 600, 'acceptat', z - 3, z - 3, 'S-1', 'B-1', NULL),
    (p1, 'NOD-TEST-DEVIZ', 'HD-3', 600, 'reparat', z - 5, z - 5, 'S-1', NULL, 'respins test'),
    (p1, 'NOD-TEST-DEVIZ', 'HD-4', 600, 'de_executat', NULL, NULL, NULL, NULL, NULL),
    (p1, 'NOD-TEST-DEVIZ', 'HD-5', 600, 'anulat', z - 2, NULL, NULL, NULL, 'anulat test'),
    (p1, 'NOD-TEST-DEVIZ', 'HD-6', NULL, 'sudat', z - 1, z - 1, 'S-2', NULL, NULL),
    (p1, 'NOD-TEST-DEVIZ', 'HD-7', 300, 'sudat', z, z, 'S-2', NULL, NULL),
    (p1, 'NOD-TEST-DEVIZ', 'HD-8', 600, 'insailat', z, NULL, 'S-3', NULL, NULL);
  -- zilele de test pe cele două șantiere: rapoartele existente pe clonă se scot (în tranzacție, anulat la final), ca versiunile să pornească de la 1
  DELETE FROM public.rapoarte_zilnice WHERE (site_id, data) IN ((s1, z - 2), (s1, DATE '2001-01-01'), (s2, z - 2), (s1, z - 3), (s1, z - 4), (s1, z - 5));
  INSERT INTO public.rapoarte_zilnice (site_id, data) VALUES (s1, z - 2) ON CONFLICT (site_id, data) DO NOTHING;
  INSERT INTO public.rapoarte_zilnice (site_id, data) VALUES (s1, DATE '2001-01-01') ON CONFLICT (site_id, data) DO NOTHING;
  INSERT INTO public.rapoarte_zilnice (site_id, data) VALUES (s2, z - 2) ON CONFLICT (site_id, data) DO NOTHING;
  SELECT id INTO r1 FROM public.rapoarte_zilnice WHERE site_id = s1 AND data = z - 2;
  SELECT id INTO r2 FROM public.rapoarte_zilnice WHERE site_id = s1 AND data = DATE '2001-01-01';
  SELECT id INTO r9 FROM public.rapoarte_zilnice WHERE site_id = s2 AND data = z - 2;
  DELETE FROM public.raport_lucrari WHERE raport_id IN (r1, r2, r9);
  PERFORM set_config('tdev.' || k, v, true) FROM (VALUES ('own', own::text), ('ed', ids[1]::text), ('sef', ids[2]::text), ('fara', ids[3]::text),
    ('p1', p1::text), ('p2', p2::text), ('s1', s1::text), ('s2', s2::text), ('azi', z::text), ('u1', u1::text), ('u2', u2::text), ('u3', u3::text),
    ('u9', u9::text), ('u4', u4::text), ('a_lans', a_lans::text), ('a_sud', a_sud::text), ('a_sap', a_sap::text), ('a_prob', a_prob::text), ('a_fara', a_fara::text),
    ('a9', a9::text), ('r1', r1::text), ('r2', r2::text), ('r9', r9::text)) x(k, v);
  RAISE NOTICE 'T0 OK';
END $t$;

-- ── T1: dreptul (o singură definiție): citire / configurare pe fiecare identitate; profile_sites expirat = fără drept ──
DO $t$
DECLARE p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint; r text := '';
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
  r := r || public.fn_executie_tinte_drept(p1, 'citire')::text || public.fn_executie_tinte_drept(p1, 'configurare')::text || ',';
  PERFORM pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
  r := r || public.fn_executie_tinte_drept(p1, 'citire')::text || public.fn_executie_tinte_drept(p1, 'configurare')::text || ',';
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  r := r || public.fn_executie_tinte_drept(p1, 'citire')::text || public.fn_executie_tinte_drept(p1, 'configurare')::text
         || public.fn_executie_tinte_drept(p2, 'citire')::text || ',';
  PERFORM pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
  r := r || public.fn_executie_tinte_drept(p1, 'citire')::text || public.fn_executie_tinte_drept(p1, 'configurare')::text
         || coalesce(public.fn_executie_tinte_drept(p1, 'altceva')::text, 'null') || coalesce(public.fn_executie_tinte_drept(NULL, 'citire')::text, 'null');
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  IF r IS DISTINCT FROM 'truetrue,truetrue,truefalsefalse,falsefalsefalsefalse' THEN RAISE EXCEPTION 'T1 FAIL: dreptul %', r; END IF;
  -- Execuție viewer: citește, nu configurează; șeful cu profile_sites expirat nu mai citește
  UPDATE public.user_module_access SET access_level = 'viewer' WHERE profile_id = pg_temp.t_g('ed')::uuid AND module = 'executie';
  UPDATE public.profile_sites SET valid_until = pg_temp.t_g('azi')::date - 1 WHERE profile_id = pg_temp.t_g('sef')::uuid;
  PERFORM pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
  r := public.fn_executie_tinte_drept(p1, 'citire')::text || public.fn_executie_tinte_drept(p1, 'configurare')::text;
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  r := r || public.fn_executie_tinte_drept(p1, 'citire')::text;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  IF r IS DISTINCT FROM 'truefalsefalse' THEN RAISE EXCEPTION 'T1 FAIL: viewer / expirat %', r; END IF;
  UPDATE public.user_module_access SET access_level = 'editor' WHERE profile_id = pg_temp.t_g('ed')::uuid AND module = 'executie';
  UPDATE public.profile_sites SET valid_until = pg_temp.t_g('azi')::date WHERE profile_id = pg_temp.t_g('sef')::uuid;   -- azi = încă valid
  RAISE NOTICE 'T1 OK';
END $t$;

-- ── T2: garda pe configurare (5A, L07): fara / sef / viewer nu configurează; editorul da; editarea obișnuită rămâne ──
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_nu_scrie(format('UPDATE public.proiect_activitati SET principala = true WHERE id = %s', pg_temp.t_g('a_fara')))
     OR NOT pg_temp.t_nu_scrie(format('UPDATE public.proiect_activitati SET factor_um = 2 WHERE id = %s', pg_temp.t_g('a_lans')))
     OR NOT pg_temp.t_nu_scrie(format('UPDATE public.proiect_activitati SET coduri_deviz = %L WHERE id = %s', 'GA0', pg_temp.t_g('a_sud')))
     OR NOT pg_temp.t_nu_scrie(format('UPDATE public.proiect_activitati SET activ = false WHERE id = %s', pg_temp.t_g('a_sap')))
     OR NOT pg_temp.t_nu_scrie(format('DELETE FROM public.proiect_activitati WHERE id = %s', pg_temp.t_g('a_sud')))
     OR NOT pg_temp.t_nu_scrie(format($q$INSERT INTO public.proiect_activitati (proiect_id, nume, principala) VALUES (%s, 'X', true)$q$, pg_temp.t_g('p1')))
     OR NOT pg_temp.t_nu_scrie(format($q$UPDATE public.proiect_unitati SET obiect_cod = 'H001' WHERE id = %s$q$, pg_temp.t_g('u1')))
     OR NOT pg_temp.t_nu_scrie(format($q$UPDATE public.proiect_unitati SET nod_cod = NULL WHERE id = %s$q$, pg_temp.t_g('u2')))
     OR NOT pg_temp.t_nu_scrie(format($q$DELETE FROM public.proiect_unitati WHERE id = %s$q$, pg_temp.t_g('u2')))
     OR NOT pg_temp.t_nu_scrie(format($q$INSERT INTO public.proiect_unitati (proiect_id, tip, nume, plan_start, plan_final) VALUES (%s, 'tronson', 'X', current_date, current_date)$q$, pg_temp.t_g('p1'))) THEN
    RAISE EXCEPTION 'T2 FAIL: fara configurează';
  END IF;
  -- editarea obișnuită (nume, coduri pe o activitate fără configurare) nu e oprită de gardă
  IF pg_temp.t_trece(format($q$UPDATE public.proiect_activitati SET nume = 'Diverse H.' WHERE id = %s$q$, pg_temp.t_g('a_fara'))) < 0
     OR pg_temp.t_trece(format($q$UPDATE public.proiect_activitati SET coduri_deviz = 'ZZ' WHERE id = %s$q$, pg_temp.t_g('a_fara'))) < 0
     OR pg_temp.t_trece(format($q$UPDATE public.proiect_unitati SET nume = 'Tronson test H3.' WHERE id = %s$q$, pg_temp.t_g('u3'))) < 0 THEN
    RAISE EXCEPTION 'T2 FAIL: garda oprește editarea obișnuită';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_nu_scrie(format('UPDATE public.proiect_activitati SET principala = true WHERE id = %s', pg_temp.t_g('a_lans')))
     OR NOT pg_temp.t_nu_scrie(format($q$UPDATE public.proiect_unitati SET plan_start = current_date, plan_final = current_date WHERE id = %s$q$, pg_temp.t_g('u1'))) THEN
    RAISE EXCEPTION 'T2 FAIL: șeful de șantier configurează';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_nu_scrie(format('UPDATE public.proiect_activitati SET principala = true WHERE id = %s', pg_temp.t_g('a_lans'))) THEN
    RAISE EXCEPTION 'T2 FAIL: anon configurează';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT principala::text || factor_um::text || coalesce(coduri_deviz, '-') || activ::text FROM public.proiect_activitati WHERE id = pg_temp.t_g('a_fara')::bigint)
       NOT IN ('false1ZZtrue', 'false1-true')
     OR (SELECT factor_um FROM public.proiect_activitati WHERE id = pg_temp.t_g('a_lans')::bigint) <> 1
     OR (SELECT coduri_deviz || sursa_executat FROM public.proiect_activitati WHERE id = pg_temp.t_g('a_sud')::bigint) IS DISTINCT FROM 'M1L05Ischema_nod'
     OR (SELECT activ FROM public.proiect_activitati WHERE id = pg_temp.t_g('a_sap')::bigint) IS NOT TRUE
     OR (SELECT obiect_cod FROM public.proiect_unitati WHERE id = pg_temp.t_g('u1')::bigint) IS NOT NULL
     OR (SELECT nod_cod FROM public.proiect_unitati WHERE id = pg_temp.t_g('u2')::bigint) IS DISTINCT FROM 'NOD-TEST-DEVIZ'
     OR EXISTS (SELECT 1 FROM public.proiect_activitati WHERE proiect_id = pg_temp.t_g('p1')::bigint AND nume = 'X')
     OR EXISTS (SELECT 1 FROM public.proiect_unitati WHERE proiect_id = pg_temp.t_g('p1')::bigint AND nume = 'X') THEN
    RAISE EXCEPTION 'T2 FAIL: o configurare refuzată a ajuns în tabel';
  END IF;
END $t$;
-- editorul Execuție configurează (activitatea principală, factorul, obiectul și perioada de plan)
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ DECLARE z date := pg_temp.t_g('azi')::date; BEGIN
  IF pg_temp.t_trece(format('UPDATE public.proiect_activitati SET principala = true, factor_um = 1.5 WHERE id = %s', pg_temp.t_g('a_lans'))) <> 1
     OR pg_temp.t_trece(format('UPDATE public.proiect_activitati SET factor_um = 1 WHERE id = %s', pg_temp.t_g('a_lans'))) <> 1
     OR pg_temp.t_trece(format($q$UPDATE public.proiect_unitati SET obiect_cod = 'H001', plan_start = %L, plan_final = %L WHERE id = %s$q$,
                               z - 99, z, pg_temp.t_g('u1'))) <> 1 THEN
    RAISE EXCEPTION 'T2 FAIL: editorul nu poate configura (RLS-ul existent al tabelelor îl oprește?)';
  END IF;
  -- constrângerile: factor, sursă, bază, DN, perioadă, coduri; obiectul / nodul o singură dată pe proiect
  IF NOT pg_temp.t_refuza(format('UPDATE public.proiect_activitati SET factor_um = 0 WHERE id = %s', pg_temp.t_g('a_lans')), '23514')
     OR NOT pg_temp.t_refuza(format('UPDATE public.proiect_activitati SET factor_um = 1.0000001 WHERE id = %s', pg_temp.t_g('a_lans')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.proiect_activitati SET sursa_executat = 'izometrie' WHERE id = %s$q$, pg_temp.t_g('a_lans')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.proiect_activitati SET baza_deviz = 'situatii' WHERE id = %s$q$, pg_temp.t_g('a_lans')), '23514')
     OR NOT pg_temp.t_refuza(format('UPDATE public.proiect_activitati SET dn_min = 700, dn_max = 600 WHERE id = %s', pg_temp.t_g('a_sud')), '23514')
     OR NOT pg_temp.t_refuza(format('UPDATE public.proiect_unitati SET plan_final = NULL WHERE id = %s', pg_temp.t_g('u1')), '23514')
     OR NOT pg_temp.t_refuza(format('UPDATE public.proiect_unitati SET plan_final = plan_start - 1 WHERE id = %s', pg_temp.t_g('u1')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.proiect_unitati SET obiect_cod = ' H001' WHERE id = %s$q$, pg_temp.t_g('u3')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.proiect_unitati SET nod_cod = 'nod-mic' WHERE id = %s$q$, pg_temp.t_g('u3')), '23514')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.proiect_unitati SET obiect_cod = 'H001' WHERE id = %s$q$, pg_temp.t_g('u3')), '23505')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.proiect_unitati SET nod_cod = 'NOD-TEST-DEVIZ' WHERE id = %s$q$, pg_temp.t_g('u3')), '23505') THEN
    RAISE EXCEPTION 'T2 FAIL: constrângeri';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- ── T3: setările alertelor: RLS pe același drept, proveniența pusă de server, valori validate ──
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format('INSERT INTO public.executie_tinte_setari (proiect_id) VALUES (%s)', pg_temp.t_g('p1')), '42501') THEN RAISE EXCEPTION 'T3 FAIL: fara'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format('INSERT INTO public.executie_tinte_setari (proiect_id) VALUES (%s)', pg_temp.t_g('p1')), '42501') THEN RAISE EXCEPTION 'T3 FAIL: sef'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format('INSERT INTO public.executie_tinte_setari (proiect_id, prag_in_urma_pp) VALUES (%s, 9.99)', pg_temp.t_g('p1')), '23514')
     OR NOT pg_temp.t_refuza(format('INSERT INTO public.executie_tinte_setari (proiect_id, zile_fara_raport) VALUES (%s, 0)', pg_temp.t_g('p1')), '23514')
     OR NOT pg_temp.t_refuza(format('INSERT INTO public.executie_tinte_setari (proiect_id, prag_in_urma_pp) VALUES (%s, 0.5)', pg_temp.t_g('p1')), '23514') THEN
    RAISE EXCEPTION 'T3 FAIL: valori';
  END IF;
  INSERT INTO public.executie_tinte_setari (proiect_id, prag_in_urma_pp, zile_fara_raport, modificat_de)
    VALUES (pg_temp.t_g('p1')::bigint, 12.5, 5, pg_temp.t_g('fara')::uuid);
  IF (SELECT modificat_de FROM public.executie_tinte_setari WHERE proiect_id = pg_temp.t_g('p1')::bigint) IS DISTINCT FROM pg_temp.t_g('ed')::uuid THEN
    RAISE EXCEPTION 'T3 FAIL: proveniența (modificat_de ales de client)';
  END IF;
  IF NOT pg_temp.t_refuza(format('UPDATE public.executie_tinte_setari SET proiect_id = %s WHERE proiect_id = %s', pg_temp.t_g('p2'), pg_temp.t_g('p1')), '23514') THEN
    RAISE EXCEPTION 'T3 FAIL: mutarea setărilor pe alt proiect';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_tinte_setari) <> 1
     OR NOT pg_temp.t_nu_scrie('UPDATE public.executie_tinte_setari SET prag_in_urma_pp = 50')
     OR NOT pg_temp.t_nu_scrie('DELETE FROM public.executie_tinte_setari') THEN
    RAISE EXCEPTION 'T3 FAIL: șeful (citește, nu scrie)';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_tinte_setari) THEN RAISE EXCEPTION 'T3 FAIL: fara vede setări'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.executie_tinte_setari', '42501') THEN RAISE EXCEPTION 'T3 FAIL: anon'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_trece('DELETE FROM public.executie_tinte_setari') <> 1 THEN RAISE EXCEPTION 'T3 FAIL: editorul șterge setările'; END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- ── T4: raportul zilnic: citire dintr-un instantaneu, salvare atomică antet + linii, CAS pe versiune, cheie per intenție (și ABA), validare ──
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z date := pg_temp.t_g('azi')::date; d1 date := pg_temp.t_g('azi')::date - 2; l1 jsonb; lb jsonb;
  k1 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid(); ant jsonb := '{"lucrari_efectuate": "test H", "probleme": "nimic"}';
  s1 bigint := pg_temp.t_g('s1')::bigint; sef uuid := pg_temp.t_g('sef')::uuid;
BEGIN
  r := public.fn_raport_zilnic_citeste(s1, d1);
  IF (r->>'versiune')::int <> 1 OR r->'linii' <> '[]'::jsonb OR (r->'raport'->>'id')::bigint <> pg_temp.t_g('r1')::bigint THEN
    RAISE EXCEPTION 'T4 FAIL: citirea raportului %', r;
  END IF;
  l1 := jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 120.5), pg_temp.t_l('a_lans', 'u2', 10), pg_temp.t_l('a_sap', 'u1', 300),
                          pg_temp.t_l('a_prob', 'u1', 1), pg_temp.t_l('a_lans', NULL, 7), pg_temp.t_l('a_sud', 'u1', 4), pg_temp.t_l('a_fara', 'u1', 2));
  r := pg_temp.t_salv('s1', d1, ant, l1, 1, k1);
  IF r->>'ok' <> 'true' OR r->>'duplicat' <> 'false' OR (r->>'versiune')::int <> 2 OR (r->>'raport_id')::bigint <> pg_temp.t_g('r1')::bigint THEN
    RAISE EXCEPTION 'T4 FAIL: prima salvare %', r;
  END IF;
  -- reluarea aceleiași intenții (răspuns pierdut): duplicat, nimic rescris; aceeași cheie cu alt conținut = eroare
  r := pg_temp.t_salv('s1', d1, ant, l1, 1, k1);
  IF r->>'duplicat' <> 'true' OR (r->>'versiune')::int <> 2 OR (r->>'versiune_curenta')::int <> 2 THEN RAISE EXCEPTION 'T4 FAIL: reluarea %', r; END IF;
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{"lucrari_efectuate": "alt"}', NULL, 1, %L)$q$, d1, k1), '22023') THEN
    RAISE EXCEPTION 'T4 FAIL: aceeași cheie, alt conținut';
  END IF;
  -- versiunea veche cu altă cheie = conflict, nimic scris
  r := pg_temp.t_salv('s1', d1, ant, jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 1)), 1, gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' OR (r->>'versiune')::int <> 2 THEN RAISE EXCEPTION 'T4 FAIL: conflictul %', r; END IF;
  -- ABA (review r1 P1-2): telefonul 1 salvează B și pierde răspunsul; telefonul 2 revine la A; telefonul 1 reia B cu ACEEAȘI cheie => nu se reaplică
  lb := jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 50));
  r := pg_temp.t_salv('s1', d1, ant, lb, 2, k3);
  IF (r->>'versiune')::int <> 3 THEN RAISE EXCEPTION 'T4 FAIL: B %', r; END IF;
  r := pg_temp.t_salv('s1', d1, ant, l1, 3, gen_random_uuid());
  IF (r->>'versiune')::int <> 4 THEN RAISE EXCEPTION 'T4 FAIL: înapoi la A %', r; END IF;
  r := pg_temp.t_salv('s1', d1, ant, lb, 2, k3);
  -- duplicatul spune și versiunea curentă: diferită = altcineva a salvat după (clientul nu mai continuă scrierile intenției)
  IF r->>'duplicat' <> 'true' OR (r->>'versiune')::int <> 3 OR (r->>'versiune_curenta')::int <> 4 THEN RAISE EXCEPTION 'T4 FAIL: reluarea târzie a lui B %', r; END IF;
  r := public.fn_raport_zilnic_citeste(s1, d1);
  IF (r->>'versiune')::int <> 4 OR jsonb_array_length(r->'linii') <> 7 THEN RAISE EXCEPTION 'T4 FAIL: după ABA %', r; END IF;
  -- antetul: un câmp lipsă rămâne neschimbat; autorul îl pune serverul; p_linii NULL = liniile neatinse
  r := pg_temp.t_salv('s1', d1, '{"lucrari_efectuate": "test H 2"}', NULL, 4, gen_random_uuid());
  IF (r->>'versiune')::int <> 5
     OR (SELECT probleme || '|' || lucrari_efectuate || '|' || created_by::text FROM public.rapoarte_zilnice WHERE id = pg_temp.t_g('r1')::bigint)
        IS DISTINCT FROM 'nimic|test H 2|' || sef::text
     OR jsonb_array_length(public.fn_raport_zilnic_citeste(s1, d1)->'linii') <> 7 THEN
    RAISE EXCEPTION 'T4 FAIL: antetul / liniile neatinse %', r;
  END IF;
  -- validarea: fiecare refuz e 22023 și nu scrie nimic (versiunea rămâne 5)
  IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, NULL, 1)), 5, gen_random_uuid())', 's1', d1, '{}', 'a9'), '22023')   -- activitate din alt proiect
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 1)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_lans', 'u9'), '22023')   -- obiect din alt proiect
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 1)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_sud', 'u2'), '22023')   -- suduri la nod: din schemă
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 2)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_prob', 'u1'), '22023')   -- bifă = 1
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 0)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_lans', 'u1'), '22023')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, -1)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_lans', 'u1'), '22023')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 1.2345)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_lans', 'u1'), '22023')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 10000001)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_lans', 'u1'), '22023')
     OR NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv(%L, %L, %L, jsonb_build_array(pg_temp.t_l(%L, %L, 1), pg_temp.t_l(%L, %L, 2)), 5, gen_random_uuid())', 's1', d1, '{}', 'a_lans', 'u1', 'a_lans', 'u1'), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 1) || '{"x": 1}'), 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 1) - 'unitate_id'), 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', jsonb_build_array(jsonb_set(pg_temp.t_l('a_lans', 'u1', 1), '{cantitate}', '"5"')), 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', jsonb_build_array(jsonb_set(pg_temp.t_l('a_lans', 'u1', 1), '{activitate_id}', '1.5')), 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', (SELECT jsonb_agg(pg_temp.t_l('a_lans', NULL, g)) FROM generate_series(1, 501) g), 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{"id": 1}', NULL, 5, gen_random_uuid())$q$, d1), '22023')            -- câmp de antet nepermis
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{"created_by": null}', NULL, 5, gen_random_uuid())$q$, d1), '22023') -- autorul îl pune serverul
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '[]', NULL, 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', '{}', 5, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', NULL, -1, gen_random_uuid())$q$, d1), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', NULL, 5, NULL)$q$, d1), '22023') THEN
    RAISE EXCEPTION 'T4 FAIL: validarea';
  END IF;
  IF (public.fn_raport_zilnic_citeste(s1, d1)->>'versiune')::int <> 5 THEN RAISE EXCEPTION 'T4 FAIL: un refuz a scris'; END IF;
  -- raport nou, pe o zi fără raport: versiunea 0 -> 1, autorul = șeful
  r := pg_temp.t_salv('s1', z - 3, '{"lucrari_efectuate": "zi nouă"}', '[]', 0, gen_random_uuid());
  IF r->>'ok' <> 'true' OR (r->>'versiune')::int <> 1
     OR (SELECT created_by FROM public.rapoarte_zilnice WHERE site_id = s1 AND data = z - 3) IS DISTINCT FROM sef THEN
    RAISE EXCEPTION 'T4 FAIL: raport nou %', r;
  END IF;
  -- reluarea aceleiași chei după ce prima încercare a CREAT raportul: duplicat (raportul există acum, cheia e a lui)
  k1 := gen_random_uuid();
  r := pg_temp.t_salv('s1', z - 4, '{"lucrari_efectuate": "zi nouă 2"}', NULL, 0, k1);
  IF (r->>'versiune')::int <> 1 THEN RAISE EXCEPTION 'T4 FAIL: raport nou 2 %', r; END IF;
  r := pg_temp.t_salv('s1', z - 4, '{"lucrari_efectuate": "zi nouă 2"}', NULL, 0, k1);
  IF r->>'duplicat' <> 'true' OR (r->>'versiune')::int <> 1 OR (r->>'versiune_curenta')::int <> 1 THEN RAISE EXCEPTION 'T4 FAIL: reluarea după creare %', r; END IF;
  -- aceeași cheie pe ALT raport (altă zi) = eroare, nu duplicat
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{"lucrari_efectuate": "zi nouă 2"}', NULL, 0, %L)$q$, z - 5, k1), '22023') THEN
    RAISE EXCEPTION 'T4 FAIL: cheia altui raport';
  END IF;
  -- alt șantier (s2) = fără drept; scrierea directă în raport_lucrari e retrasă (20261208b); citirea rămâne; jurnalul nu se citește direct
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s2', %L, '{}', '[]', 0, gen_random_uuid())$q$, d1), '42501')
     OR NOT pg_temp.t_refuza(format('SELECT public.fn_raport_zilnic_citeste(%s, %L)', pg_temp.t_g('s2'), d1), '42501')
     OR NOT pg_temp.t_refuza(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate) VALUES (%s, %s, %s, %s, 1)',
                                    pg_temp.t_g('r1'), pg_temp.t_g('p1'), pg_temp.t_g('a_lans'), pg_temp.t_g('u1')), '42501')
     OR NOT pg_temp.t_refuza(format('DELETE FROM public.raport_lucrari WHERE raport_id = %s', pg_temp.t_g('r1')), '42501')
     OR NOT pg_temp.t_refuza(format('UPDATE public.raport_lucrari SET cantitate = 1 WHERE raport_id = %s', pg_temp.t_g('r1')), '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.raport_zilnic_salvari', '42501')
     OR pg_temp.t_trece(format('SELECT 1 FROM public.raport_lucrari WHERE raport_id = %s', pg_temp.t_g('r1'))) < 0 THEN
    RAISE EXCEPTION 'T4 FAIL: dreptul pe șantier / scrierea directă / jurnalul';
  END IF;
  -- al doilea raport (zi veche) al aceluiași șantier
  r := pg_temp.t_salv('s1', DATE '2001-01-01', '{}', jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 1000)), 1, gen_random_uuid());
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T4 FAIL: al doilea raport %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
UPDATE public.rapoarte_zilnice SET probleme = 'scris direct', versiune_salvare = 99 WHERE id = pg_temp.t_g('r1')::bigint;
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ DECLARE r jsonb; BEGIN
  IF (SELECT versiune_salvare FROM public.rapoarte_zilnice WHERE id = pg_temp.t_g('r1')::bigint) <> 6 THEN
    RAISE EXCEPTION 'T4 FAIL: versiunea forțată de o scriere directă';
  END IF;
  r := pg_temp.t_salv('s1', pg_temp.t_g('azi')::date - 2, '{"probleme": "telefon nou"}', NULL, 5, gen_random_uuid());
  IF r->>'ok' <> 'false' OR r->>'motiv' <> 'conflict' OR (r->>'versiune')::int <> 6
     OR (SELECT probleme FROM public.rapoarte_zilnice WHERE id = pg_temp.t_g('r1')::bigint) <> 'scris direct' THEN
    RAISE EXCEPTION 'T4 FAIL: scrierea directă a antetului ocolește versiunea %', r;
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', '[]', 6, gen_random_uuid())$q$, pg_temp.t_g('azi')::date - 2), '42501') THEN
    RAISE EXCEPTION 'T4 FAIL: editorul Execuție scrie raportul unui șantier care nu e al lui';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s1', %L, '{}', '[]', 6, gen_random_uuid())$q$, pg_temp.t_g('azi')::date - 2), '42501')
     OR NOT pg_temp.t_refuza(format('SELECT public.fn_raport_zilnic_citeste(%s, %L)', pg_temp.t_g('s1'), pg_temp.t_g('azi')::date - 2), '42501') THEN
    RAISE EXCEPTION 'T4 FAIL: fără drept';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_raport_zilnic_salveaza(%s, current_date, '{}', '[]', NULL, 0, gen_random_uuid())$q$, pg_temp.t_g('s1')), '42501')
     OR NOT pg_temp.t_refuza(format('SELECT public.fn_raport_zilnic_citeste(%s, current_date)', pg_temp.t_g('s1')), '42501')
     OR NOT pg_temp.t_refuza(format('DELETE FROM public.raport_lucrari WHERE raport_id = %s', pg_temp.t_g('r1')), '42501') THEN
    RAISE EXCEPTION 'T4 FAIL: anon';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT public.fn_raport_zilnic_salveaza(%s, current_date, '{}', '[]', NULL, 0, gen_random_uuid())$q$, pg_temp.t_g('s1')), '42501') THEN
    RAISE EXCEPTION 'T4 FAIL: service_role';
  END IF;
END $t$;
-- owner-ul scrie pe orice șantier; un șantier fără proiect nu primește linii
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$ DECLARE r jsonb; BEGIN
  r := pg_temp.t_salv('s2', pg_temp.t_g('azi')::date - 2, '{}', jsonb_build_array(pg_temp.t_l('a9', 'u9', 25)), 1, gen_random_uuid());
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T4 FAIL: owner %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
UPDATE public.sites SET proiect_id = NULL WHERE id = pg_temp.t_g('s2')::bigint;
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv('s2', %L, '{}', jsonb_build_array(pg_temp.t_l('a9', 'u9', 26)), 1, gen_random_uuid())$q$,
                                 pg_temp.t_g('azi')::date - 2), '22023') THEN
    RAISE EXCEPTION 'T4 FAIL: șantier fără proiect';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
UPDATE public.sites SET proiect_id = pg_temp.t_g('p2')::bigint WHERE id = pg_temp.t_g('s2')::bigint;
DO $t$ BEGIN RAISE NOTICE 'T4 OK'; END $t$;

-- ── T4d: distribuția în aceeași salvare atomică (review r3 P1-2): sub CAS, în amprentă; reluarea ABA nu o reaplică; scrierea separată e retrasă ──
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z3 date := pg_temp.t_g('azi')::date - 3; s1 bigint := pg_temp.t_g('s1')::bigint; v integer; kd uuid := gen_random_uuid();
  db jsonb; da jsonb; rid bigint;
BEGIN
  db := jsonb_build_array(jsonb_build_object('tabel', 'conducta', 'nr_crt', 1, 'unitate_id', pg_temp.t_g('u1')::bigint, 'diametru_mm', 110,
                                             'lungime_m', 12.5, 'suduri_nr', 2, 'sudura_tip', 'electrofuziune'));
  da := jsonb_build_array(jsonb_build_object('tabel', 'conducta', 'nr_crt', 1, 'unitate_id', pg_temp.t_g('u1')::bigint, 'diametru_mm', 110,
                                             'lungime_m', 20, 'suduri_nr', 3, 'sudura_tip', 'electrofuziune'));
  r := public.fn_raport_zilnic_citeste(s1, z3); v := (r->>'versiune')::int; rid := (r->'raport'->>'id')::bigint;
  IF r->'distributie' <> '[]'::jsonb THEN RAISE EXCEPTION 'T4d FAIL: distribuția inițială %', r; END IF;
  r := pg_temp.t_salv_d('s1', z3, db, v, kd);
  IF r->>'ok' <> 'true' OR (r->>'versiune')::int <> v + 1
     OR (SELECT string_agg(lungime_m::text, ',') FROM public.raport_distributie_linii WHERE raport_id = rid) IS DISTINCT FROM '12.50' THEN
    RAISE EXCEPTION 'T4d FAIL: salvarea cu distribuție %', r;
  END IF;
  IF jsonb_array_length(public.fn_raport_zilnic_citeste(s1, z3)->'distributie') <> 1 THEN RAISE EXCEPTION 'T4d FAIL: citirea distribuției'; END IF;
  -- aceeași cheie cu altă distribuție = eroare (distribuția e în amprentă)
  IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_salv_d(%L, %L, %L, %s, %L)', 's1', z3, da, v, kd), '22023') THEN RAISE EXCEPTION 'T4d FAIL: amprenta'; END IF;
  -- ABA: altcineva salvează distribuția A; reluarea intenției B = duplicat cu versiunea curentă mai mare, distribuția rămâne A
  r := pg_temp.t_salv_d('s1', z3, da, v + 1, gen_random_uuid());
  IF (r->>'versiune')::int <> v + 2 THEN RAISE EXCEPTION 'T4d FAIL: A %', r; END IF;
  r := pg_temp.t_salv_d('s1', z3, db, v, kd);
  IF r->>'duplicat' <> 'true' OR (r->>'versiune')::int <> v + 1 OR (r->>'versiune_curenta')::int <> v + 2
     OR (SELECT string_agg(lungime_m::text, ',') FROM public.raport_distributie_linii WHERE raport_id = rid) IS DISTINCT FROM '20.00' THEN
    RAISE EXCEPTION 'T4d FAIL: reluarea ABA a reaplicat distribuția %', r;
  END IF;
  -- distribuție invalidă: nu e listă / element ne-obiect = 22023; rând refuzat de CHECK-ul tabelului = toată salvarea anulată
  IF NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv_d('s1', %L, '{"tabel": "conducta"}', %s, gen_random_uuid())$q$, z3, v + 2), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv_d('s1', %L, '[1]', %s, gen_random_uuid())$q$, z3, v + 2), '22023')
     OR NOT pg_temp.t_refuza(format($q$SELECT pg_temp.t_salv_d('s1', %L, '[{"tabel": "altceva", "nr_crt": 1}]', %s, gen_random_uuid())$q$, z3, v + 2), '23514') THEN
    RAISE EXCEPTION 'T4d FAIL: validarea distribuției';
  END IF;
  IF (public.fn_raport_zilnic_citeste(s1, z3)->>'versiune')::int <> v + 2 THEN RAISE EXCEPTION 'T4d FAIL: un refuz a scris'; END IF;
  -- după 20261208b: distribuția nu se mai scrie separat (nici direct, nici prin funcția veche)
  IF NOT pg_temp.t_refuza(format($q$INSERT INTO public.raport_distributie_linii (raport_id, tabel, nr_crt) VALUES (%s, 'conducta', 9)$q$, rid), '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_raport_distributie_salveaza(%s, '[]')$q$, rid), '42501') THEN
    RAISE EXCEPTION 'T4d FAIL: scrierea separată a distribuției';
  END IF;
  RAISE NOTICE 'T4d OK';
END $t$;

-- ── T5: vederea — valorile, sursele, cheile, cine vede ce, apoi alertele cu pragurile din setări ──
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb; z date := pg_temp.t_g('azi')::date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_executie_tinte WHERE proiect_id = pg_temp.t_g('p2')::bigint)
     OR (SELECT count(*) FROM public.v_executie_tinte WHERE proiect_id = pg_temp.t_g('p1')::bigint)
        <> (SELECT count(DISTINCT id) FROM public.v_executie_tinte WHERE proiect_id = pg_temp.t_g('p1')::bigint) THEN
    RAISE EXCEPTION 'T5 FAIL: proiectul altui șantier / chei duble';
  END IF;
  v := pg_temp.t_v('u1', 'a_lans');   -- revizuită, „100 M” -> m: (10 + 5 - 2) × 100; executat 120,5 + 1000; plan 100% -> 13,8 pp sub, prag 15: fără alertă
  IF (v->>'din_deviz')::numeric <> 1300 OR (v->>'executat')::numeric <> 1120.5 OR (v->>'rest')::numeric <> 179.5 OR (v->>'peste_deviz')::numeric <> 0
     OR (v->>'pct_executat')::numeric <> 86.2 OR (v->>'pct_plan')::numeric <> 100 OR (v->>'articole')::int <> 3 OR v->>'executat_sursa' <> 'raport'
     OR v->>'principala' <> 'true' OR v->'alerte' <> '[]'::jsonb OR (v->>'ultima_raportare')::date <> z - 2
     OR (v->>'prag_in_urma_pp')::numeric <> 15 OR (v->>'zile_fara_raport')::int <> 7 OR (v->>'calculat_la')::date <> z
     OR (v->>'id')::bigint <> pg_temp.t_g('u1')::bigint * 100000000 + pg_temp.t_g('a_lans')::bigint THEN
    RAISE EXCEPTION 'T5 FAIL: (T-H1, lansare) %', v;
  END IF;
  v := pg_temp.t_v('u1', 'a_sud');    -- ofertă (fără actul de renunțare): 30; pe tronson sudurile vin din raport
  IF (v->>'din_deviz')::numeric <> 30 OR (v->>'executat')::numeric <> 4 OR v->>'executat_sursa' <> 'raport' OR (v->>'articole')::int <> 1
     OR NOT (v->'alerte' ? 'in_urma') THEN RAISE EXCEPTION 'T5 FAIL: (T-H1, suduri) %', v; END IF;
  v := pg_temp.t_v('u1', 'a_sap');    -- (90 × 100 mc + 10 mc) × 0,5; fără cantitate și „100 M” (nu e volum) = incomplete; prefixul cu litere mici
  IF (v->>'din_deviz')::numeric <> 4505 OR (v->>'articole')::int <> 4 OR (v->>'articole_incomplete')::int <> 2 OR (v->>'pct_executat')::numeric <> 6.7
     OR NOT (v->'alerte' ? 'incomplet') OR NOT (v->'alerte' ? 'in_urma') THEN RAISE EXCEPTION 'T5 FAIL: (T-H1, săpătură) %', v; END IF;
  v := pg_temp.t_v('u1', 'a_prob');
  IF (v->>'pct_executat')::numeric <> 100 OR v->>'rest' IS NOT NULL OR v->>'tip_raportare' <> 'bifa' OR v->'alerte' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'T5 FAIL: (T-H1, probă) %', v; END IF;
  v := pg_temp.t_v('u1', 'a_fara');
  IF v->>'din_deviz' IS NOT NULL OR (v->>'executat')::numeric <> 2 OR NOT (v->'alerte' ? 'fara_tinta') THEN RAISE EXCEPTION 'T5 FAIL: (T-H1, fără coduri) %', v; END IF;
  v := pg_temp.t_v('u2', 'a_sud');    -- la nod: din schemă (sudat + acceptat + de reparat, DN600), nu din raport
  IF (v->>'din_deviz')::numeric <> 20 OR (v->>'executat')::numeric <> 3 OR v->>'executat_sursa' <> 'schema_nod' OR (v->>'pct_executat')::numeric <> 15
     OR (v->>'raport_ignorat')::numeric <> 0 OR (v->>'ultima_raportare')::date <> z THEN RAISE EXCEPTION 'T5 FAIL: (nod, suduri) %', v; END IF;
  v := pg_temp.t_v('u2', 'a_lans');
  IF (v->>'din_deviz')::numeric <> 500 OR (v->>'executat')::numeric <> 10 THEN RAISE EXCEPTION 'T5 FAIL: (nod, lansare) %', v; END IF;
  v := pg_temp.t_v('u2', NULL);       -- sudate fără activitate (DN lipsă, DN300)
  IF (v->>'executat')::numeric <> 2 OR NOT (v->'alerte' ? 'nealocat') OR v->>'activitate_nume' IS NOT NULL THEN RAISE EXCEPTION 'T5 FAIL: nealocat %', v; END IF;
  v := pg_temp.t_v(NULL, 'a_lans');   -- linia fără obiect
  IF (v->>'executat')::numeric <> 7 OR NOT (v->'alerte' ? 'fara_obiect') OR v->>'din_deviz' IS NOT NULL THEN RAISE EXCEPTION 'T5 FAIL: fără obiect %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_tinte WHERE unitate_id = pg_temp.t_g('u3')::bigint) THEN RAISE EXCEPTION 'T5 FAIL: unitate fără deviz și fără linii'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.v_executie_tinte) THEN RAISE EXCEPTION 'T5 FAIL: fara vede ținte'; END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza('SELECT count(*) FROM public.v_executie_tinte', '42501')
     OR NOT pg_temp.t_refuza('SELECT count(*) FROM public.fn_executie_tinte_calcul()', '42501') THEN RAISE EXCEPTION 'T5 FAIL: anon'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('ed')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_tinte WHERE proiect_id = pg_temp.t_g('p2')::bigint AND unitate_id = pg_temp.t_g('u9')::bigint
                   AND activitate_id = pg_temp.t_g('a9')::bigint AND din_deviz = 5000 AND executat = 25) THEN
    RAISE EXCEPTION 'T5 FAIL: editorul vede toate proiectele';
  END IF;
  -- pragul din setări: 10 pp -> lansarea (13,8 pp sub plan) intră în alertă
  INSERT INTO public.executie_tinte_setari (proiect_id, prag_in_urma_pp) VALUES (pg_temp.t_g('p1')::bigint, 10);
  IF NOT (pg_temp.t_v('u1', 'a_lans')->'alerte' ? 'in_urma') OR (pg_temp.t_v('u1', 'a_lans')->>'prag_in_urma_pp')::numeric <> 10 THEN
    RAISE EXCEPTION 'T5 FAIL: pragul configurabil';
  END IF;
  -- fără raport: ultimul raport pe T-H1 e de acum 2 zile; la 1 zi -> alertă (nu pe proba făcută); gol = oprit
  UPDATE public.executie_tinte_setari SET zile_fara_raport = 1 WHERE proiect_id = pg_temp.t_g('p1')::bigint;
  IF NOT (pg_temp.t_v('u1', 'a_lans')->'alerte' ? 'fara_raport') OR (pg_temp.t_v('u1', 'a_prob')->'alerte' ? 'fara_raport')
     OR (pg_temp.t_v('u2', 'a_sud')->'alerte' ? 'fara_raport') THEN
    RAISE EXCEPTION 'T5 FAIL: fără raport (1 zi)';
  END IF;
  -- granițele: ultimul raport acum 2 zile -> la 2 zile alertă (2 zile pline fără raport), la 3 zile nu (review r1 P2-7)
  UPDATE public.executie_tinte_setari SET zile_fara_raport = 2 WHERE proiect_id = pg_temp.t_g('p1')::bigint;
  IF NOT (pg_temp.t_v('u1', 'a_lans')->'alerte' ? 'fara_raport') THEN RAISE EXCEPTION 'T5 FAIL: fără raport, granița de 2 zile'; END IF;
  UPDATE public.executie_tinte_setari SET zile_fara_raport = 3 WHERE proiect_id = pg_temp.t_g('p1')::bigint;
  IF pg_temp.t_v('u1', 'a_lans')->'alerte' ? 'fara_raport' THEN RAISE EXCEPTION 'T5 FAIL: fără raport, 3 zile'; END IF;
  -- obiect fără niciun raport: se numără de la începutul planului (prima zi de plan nu alertează; după 7 zile pline, da)
  UPDATE public.executie_tinte_setari SET zile_fara_raport = 7 WHERE proiect_id = pg_temp.t_g('p1')::bigint;
  UPDATE public.proiect_unitati SET plan_start = pg_temp.t_g('azi')::date, plan_final = pg_temp.t_g('azi')::date + 30 WHERE id = pg_temp.t_g('u4')::bigint;
  IF pg_temp.t_v('u4', 'a_lans')->'alerte' ? 'fara_raport' OR (pg_temp.t_v('u4', 'a_lans')->>'din_deviz')::numeric <> 200 THEN
    RAISE EXCEPTION 'T5 FAIL: prima zi de plan %', pg_temp.t_v('u4', 'a_lans');
  END IF;
  UPDATE public.proiect_unitati SET plan_start = pg_temp.t_g('azi')::date - 5 WHERE id = pg_temp.t_g('u4')::bigint;
  IF pg_temp.t_v('u4', 'a_lans')->'alerte' ? 'fara_raport' THEN RAISE EXCEPTION 'T5 FAIL: 6 zile de plan'; END IF;
  UPDATE public.proiect_unitati SET plan_start = pg_temp.t_g('azi')::date - 6 WHERE id = pg_temp.t_g('u4')::bigint;
  IF NOT (pg_temp.t_v('u4', 'a_lans')->'alerte' ? 'fara_raport') THEN RAISE EXCEPTION 'T5 FAIL: 7 zile de plan fără raport'; END IF;
  UPDATE public.executie_tinte_setari SET zile_fara_raport = NULL WHERE proiect_id = pg_temp.t_g('p1')::bigint;
  IF EXISTS (SELECT 1 FROM public.v_executie_tinte WHERE proiect_id = pg_temp.t_g('p1')::bigint AND alerta_fara_raport) THEN
    RAISE EXCEPTION 'T5 FAIL: fără raport oprit';
  END IF;
END $t$;
-- peste deviz (prin RPC, ca șeful) și liniile vechi scrise direct (date de dinainte): unitate din alt proiect, suduri raportate la nod
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ DECLARE r jsonb; BEGIN
  r := pg_temp.t_salv('s1', DATE '2001-01-01', '{}', jsonb_build_array(pg_temp.t_l('a_lans', 'u1', 1300)),
                      (public.fn_raport_zilnic_citeste(pg_temp.t_g('s1')::bigint, DATE '2001-01-01')->>'versiune')::int, gen_random_uuid());
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'T5 FAIL: salvare r2 %', r; END IF;
  IF (pg_temp.t_v('u1', 'a_lans')->>'peste_deviz')::numeric <> 120.5 OR NOT (pg_temp.t_v('u1', 'a_lans')->'alerte' ? 'peste_deviz')
     OR (pg_temp.t_v('u1', 'a_lans')->>'rest')::numeric <> 0 THEN
    RAISE EXCEPTION 'T5 FAIL: peste deviz %', pg_temp.t_v('u1', 'a_lans');
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate)
VALUES (pg_temp.t_g('r2')::bigint, pg_temp.t_g('p1')::bigint, pg_temp.t_g('a_lans')::bigint, pg_temp.t_g('u9')::bigint, 5),
       (pg_temp.t_g('r2')::bigint, pg_temp.t_g('p1')::bigint, pg_temp.t_g('a_sud')::bigint, pg_temp.t_g('u2')::bigint, 2);
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ DECLARE v jsonb; BEGIN
  v := pg_temp.t_v(NULL, 'a_lans');
  IF (v->>'executat')::numeric <> 12 THEN RAISE EXCEPTION 'T5 FAIL: unitatea din alt proiect cade la „fără obiect” %', v; END IF;
  v := pg_temp.t_v('u2', 'a_sud');
  IF (v->>'executat')::numeric <> 3 OR (v->>'raport_ignorat')::numeric <> 2 OR NOT (v->'alerte' ? 'incomplet') THEN
    RAISE EXCEPTION 'T5 FAIL: suduri raportate la nod (ignorate, semnalate) %', v;
  END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- ── T6: contorul nodului pe zi (telefonul): azi / total pe activitate + nealocate; dreptul de citire ──
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$ DECLARE z date := pg_temp.t_g('azi')::date; BEGIN
  IF (SELECT string_agg(coalesce(activitate_id::text, '-') || ':' || sudate_total || ':' || coalesce(sudate_zi::text, '?') || ':' || ultima_sudare, ',' ORDER BY activitate_id NULLS LAST)
        FROM public.fn_executie_tinte_nod(pg_temp.t_g('p1')::bigint, z) WHERE unitate_id = pg_temp.t_g('u2')::bigint)
       IS DISTINCT FROM pg_temp.t_g('a_sud') || ':3:1:' || z || ',-:2:1:' || z
     OR EXISTS (SELECT 1 FROM public.fn_executie_tinte_nod(pg_temp.t_g('p1')::bigint, NULL) WHERE sudate_zi IS NOT NULL) THEN
    RAISE EXCEPTION 'T6 FAIL: contorul nodului';
  END IF;
  IF NOT pg_temp.t_refuza(format('SELECT * FROM public.fn_executie_tinte_nod(%s, current_date)', pg_temp.t_g('p2')), '42501') THEN
    RAISE EXCEPTION 'T6 FAIL: alt proiect';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.t_refuza(format('SELECT * FROM public.fn_executie_tinte_nod(%s, current_date)', pg_temp.t_g('p1')), '42501') THEN RAISE EXCEPTION 'T6 FAIL: fara'; END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- ── T7: revenirea — nearmată = refuz; armată cu configurare scrisă = refuz, pe rând (setări, obiecte, activități); nimic atins ──
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t7a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
\set t7a_eroare :ERROR
\set t7a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7a;
SELECT pg_temp.t_eroare('T7a', :'t7a_eroare', :'t7a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t7a2;
SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
\set t7a2_eroare :ERROR
\set t7a2_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7a2;
SELECT pg_temp.t_eroare('T7a2', :'t7a2_eroare', :'t7a2_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'intai revenirea 20261208b');
-- revenirea 20261208b (nearmată = refuz; armată = redă scrierea directă lui authenticated)
SAVEPOINT t7r;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208b_executie_raport_lucrari_doar_rpc_ROLLBACK.sql
\set t7r_eroare :ERROR
\set t7r_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7r;
SELECT pg_temp.t_eroare('T7r', :'t7r_eroare', :'t7r_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SELECT set_config('gazpet.revenire_20261208b', 'REDA_SCRIEREA_LINIILOR:' || txid_current(), true);
\ir ../supabase/revenire/20261208b_executie_raport_lucrari_doar_rpc_ROLLBACK.sql
DO $t$ BEGIN
  IF NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT') OR has_table_privilege('anon', 'public.raport_lucrari', 'INSERT') THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea 20261208b';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_raport_distributie_salveaza(bigint, jsonb)', 'EXECUTE')
     OR NOT has_table_privilege('authenticated', 'public.raport_distributie_linii', 'INSERT') THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea 20261208b (distribuția)';
  END IF;
END $t$;
SAVEPOINT t7j;
SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
\set t7j_eroare :ERROR
\set t7j_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7j;
SELECT pg_temp.t_eroare('T7j', :'t7j_eroare', :'t7j_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'jurnalul raportului zilnic are salvari');
DELETE FROM public.raport_zilnic_salvari;
SAVEPOINT t7b;
SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
\set t7b_eroare :ERROR
\set t7b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7b;
SELECT pg_temp.t_eroare('T7b', :'t7b_eroare', :'t7b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'exista setari de alerte');
DELETE FROM public.executie_tinte_setari;
SAVEPOINT t7c;
SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
\set t7c_eroare :ERROR
\set t7c_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7c;
SELECT pg_temp.t_eroare('T7c', :'t7c_eroare', :'t7c_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'exista obiecte legate de deviz');
UPDATE public.proiect_unitati SET obiect_cod = NULL, nod_cod = NULL, plan_start = NULL, plan_final = NULL
 WHERE obiect_cod IS NOT NULL OR nod_cod IS NOT NULL OR plan_start IS NOT NULL;
SAVEPOINT t7d;
SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
\set t7d_eroare :ERROR
\set t7d_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7d;
SELECT pg_temp.t_eroare('T7d', :'t7d_eroare', :'t7d_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'exista activitati configurate');
DO $t$ BEGIN
  IF to_regclass('public.v_executie_tinte') IS NULL OR to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.proiect_activitati WHERE principala) THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T7 OK (refuzurile „garda invalida” ×2, „intai revenirea 20261208b”, „jurnalul are salvari”, „exista setari”, „exista obiecte legate”, „exista activitati configurate” verificate explicit)';
END $t$;

-- ── T8: revenirea armată pe configurare goală scoate tot și redă scrierea directă; re-aplicarea merge; liniile rămân ──
UPDATE public.proiect_activitati SET principala = false, factor_um = 1, sursa_executat = 'raport', baza_deviz = 'revizuita', dn_min = NULL, dn_max = NULL
 WHERE principala OR factor_um <> 1 OR sursa_executat <> 'raport' OR baza_deviz <> 'revizuita' OR dn_min IS NOT NULL OR dn_max IS NOT NULL;
SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
\ir ../supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.v_executie_tinte') IS NOT NULL OR to_regclass('public.executie_tinte_setari') IS NOT NULL
     OR to_regclass('public.raport_zilnic_salvari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice' AND column_name = 'versiune_salvare')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_raport_zilnic_versiune')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = ANY (ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati', 'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie', 'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_zilnic_citeste', 'fn_raport_zilnic_salveaza', 'fn_raport_zilnic_versiune']::name[]))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('proiect_unitati', 'proiect_activitati')
                 AND column_name IN ('obiect_cod', 'nod_cod', 'plan_start', 'plan_final', 'principala', 'factor_um', 'sursa_executat', 'baza_deviz', 'dn_min', 'dn_max'))
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT') OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'DELETE')
     OR current_setting('gazpet.revenire_20261208a', true) <> ''
     OR (SELECT count(*) FROM public.raport_lucrari WHERE raport_id IN (pg_temp.t_g('r1')::bigint, pg_temp.t_g('r2')::bigint)) <> 10 THEN
    RAISE EXCEPTION 'T8 FAIL: după revenire';
  END IF;
END $t$;
SELECT set_config('gazpet.livrare_migrare', '20261208a_executie_devize_tinte:' || txid_current(), true);
\ir ../supabase/migrations/20261208a_executie_devize_tinte.sql
SELECT set_config('gazpet.livrare_migrare', '20261208b_executie_raport_lucrari_doar_rpc:' || txid_current(), true);
\ir ../supabase/migrations/20261208b_executie_raport_lucrari_doar_rpc.sql
DO $t$ BEGIN
  IF to_regclass('public.v_executie_tinte') IS NULL OR has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT')
     OR (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('raport_lucrari', 'rapoarte_zilnice', 'proiect_unitati', 'proiect_activitati', 'proiect_articole', 'sites', 'profile_sites')) IS DISTINCT FROM pg_temp.t_g('pol0') OR (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.rapoarte_zilnice'::regclass, 'public.proiect_unitati'::regclass, 'public.proiect_activitati'::regclass, 'public.proiect_articole'::regclass, 'public.sites'::regclass, 'public.profile_sites'::regclass)) IS DISTINCT FROM pg_temp.t_g('acl0') THEN
    RAISE EXCEPTION 'T8 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'T8 OK — toate testele 20261208a au trecut';
END $t$;
ROLLBACK;
