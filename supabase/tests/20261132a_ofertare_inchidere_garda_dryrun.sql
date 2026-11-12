-- Dry-run 20261132a_ofertare_inchidere_garda (r2, review Jakarinos 11.11 P2). Rulat de COORDONATOR pe CLONĂ, NU de sesiunile de cod.
-- Comanda (din rădăcina repo-ului; PostgreSQL 17, login postgres SUPERUSER pe clonă; amprentele din migrare deja completate — pașii 1-5
-- din antetul migrării — cu valorile producției, iar scriptul de amprente dă aceeași ieșire pe clonă):
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/20261132a_ofertare_inchidere_garda_dryrun.sql
-- Cod de ieșire 0 = TOATE cazurile OK; orice alt cod = eșec (tabelul REZ din ieșire spune care). Totul rulează într-O tranzacție terminată
-- cu ROLLBACK: nimic nu rămâne pe clonă (nici licitațiile de test, nici migrarea). Pe Supabase (postgres fără SUPERUSER) refuză să pornească.
-- Fișierele migrării și revenirii se citesc EXACT de pe disc (\copy, linie cu linie) și se execută prin pg_temp.ig_aplica, cu marcajul
-- gazpet.livrare_migrare legat de txid, ca în runner.
--
-- Identități ca în PostgREST (L25): SET LOCAL SESSION AUTHORIZATION authenticator + SET LOCAL ROLE authenticated | service_role +
-- request.jwt.claims cu sub ⇒ session_user = authenticator (excepția a00 / a02 pentru postgres NU se aplică), RLS și drepturile tabelului
-- ca prin API. Cron / administrare = sesiunea postgres fără claims. Utilizatorii de test sunt profiluri EXISTENTE ale clonei, alese după
-- dreptul lor (owner; doi colegi cu Ofertare; unul fără Ofertare / Financiar; opțional unul doar cu Financiar și un admin Ofertare) —
-- dreptul nu se schimbă; licitațiile de test (nr_anunt TEST-20261132-*) se creează aici.
-- Coduri așteptate (fiecare caz spune DE CE): 'ok:N' = UPDATE reușit pe N rânduri; 42501 = refuzul gărzii a02 (sau al a00 doar unde
-- e scris explicit); P0001 = a00_ofertare_licitatii_scriere refuză ÎNAINTEA gărzii (rulează înaintea ei, ordinea alfabetică); 'ok:0' =
-- rândul nu trece de RLS (nu e dovada gărzii). Cazurile „izolat” opresc a00 într-o sub-tranzacție, ca să se vadă refuzul propriu al a02.
-- Pe lângă cazuri: refuzul migrării la schemă schimbată (N*: corpul funcției unui trigger, ACL, FORCE RLS, relacl NULL + RLS, politică,
-- trigger nou, corpul unei funcții din lanț) și refuzul revenirii la altă versiune sub același nume (RB*); apoi revenire + re-aplicare.
-- Același fișier rulează și LOCAL, fără nicio bază reală, pe PGlite peste schema falsă 20261132a_ofertare_inchidere_garda_schelet.sql,
-- cu mutanți care trebuie să pice fiecare la cazul lui (din rădăcina repo-ului):
--   npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ofertare_inchidere_garda_local.mjs
-- Proba locală NU înlocuiește rularea pe clonă: schema falsă n-are rolurile Supabase reale, a00_ofertare_derogare_garda_j05,
-- trg_gate_depunere, J02b real și profilurile clonei.
\set ON_ERROR_STOP on
\encoding UTF8
SET client_min_messages = notice;
BEGIN;

DO $garda$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: ruleaza cu login-ul postgres';
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) IS NOT TRUE THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: login-ul postgres trebuie sa fie SUPERUSER (doar pe clona: SET SESSION AUTHORIZATION authenticator)';
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: cere PostgreSQL >= 17 (ca productia)';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'authenticator']) AS r(nume)
              WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.nume))
     OR NOT pg_has_role('authenticator', 'authenticated', 'MEMBER') OR NOT pg_has_role('authenticator', 'service_role', 'MEMBER') THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: lipsesc rolurile Supabase (anon / authenticated / service_role / authenticator membru in ele)';
  END IF;
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NOT NULL THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: garda exista deja pe clona (migrarea aplicata?)';
  END IF;
END $garda$;

-- fișierele, exact de pe disc (CSV cu delimitatori care nu apar în SQL: fiecare linie = un rând, fără interpretarea backslash-ului)
CREATE TEMP TABLE ig_src (fisier text, nr bigint GENERATED ALWAYS AS IDENTITY, linie text);
\copy ig_src (linie) FROM 'supabase/migrations/20261132a_ofertare_inchidere_garda.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
UPDATE ig_src SET fisier = 'mig' WHERE fisier IS NULL;
\copy ig_src (linie) FROM 'supabase/revenire/20261132a_ofertare_inchidere_garda_ROLLBACK.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
UPDATE ig_src SET fisier = 'rb' WHERE fisier IS NULL;
CREATE TEMP TABLE ig_rez (nr bigint GENERATED ALWAYS AS IDENTITY, caz text, asteptat text, observat text, ok boolean, descriere text);

CREATE FUNCTION pg_temp.ig_text(p_fisier text) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(coalesce(s.linie, ''), E'\n' ORDER BY s.nr) FROM pg_temp.ig_src s WHERE s.fisier = p_fisier
$f$;

-- interogarea amprentelor, exact cum e în migrare (între marcaje) — pentru proba relacl NULL (N4)
CREATE FUNCTION pg_temp.ig_interogare() RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(coalesce(s.linie, ''), E'\n' ORDER BY s.nr) FROM pg_temp.ig_src s
   WHERE s.fisier = 'mig'
     AND s.nr > (SELECT min(nr) FROM pg_temp.ig_src WHERE fisier = 'mig' AND linie LIKE '-- >>> AMPRENTE: interogarea%')
     AND s.nr < (SELECT min(nr) FROM pg_temp.ig_src WHERE fisier = 'mig' AND linie LIKE '-- <<< AMPRENTE: interogarea%')
$f$;

-- aplică migrarea ('mig') sau revenirea ('rb') cu marcajul runnerului; întoarce 'ok' sau 'SQLSTATE: mesaj' (nu aruncă)
CREATE FUNCTION pg_temp.ig_aplica(p_fisier text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_nume text := CASE p_fisier WHEN 'mig' THEN '20261132a_ofertare_inchidere_garda' ELSE '20261132a_ofertare_inchidere_garda_ROLLBACK' END;
  v_sql text := pg_temp.ig_text(p_fisier);
BEGIN
  IF v_sql IS NULL THEN RETURN 'EROARE_TEST: fisierul ' || p_fisier || ' nu s-a citit'; END IF;
  PERFORM set_config('gazpet.livrare_migrare', v_nume || ':' || txid_current(), true);
  BEGIN
    EXECUTE v_sql;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('gazpet.livrare_migrare', '', true);
    RETURN SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('gazpet.livrare_migrare', '', true);
  RETURN 'ok';
END $f$;

-- un UPDATE ca un apelant real; întoarce 'ok:<rânduri>' sau SQLSTATE. Rolul / sesiunea / claims revin după fiecare caz.
-- Revenirea la login se face EXPLICIT (SET LOCAL SESSION AUTHORIZATION <login>, nu RESET: în unele medii valoarea de reset nu e
-- login-ul) și se VERIFICĂ după fiecare caz — o identitate rămasă agățată oprește dry-run-ul (altfel cazurile următoare ar minți).
CREATE FUNCTION pg_temp.ig_caz(p_sesiune text, p_rol text, p_sub uuid, p_rol_jwt text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_n bigint; v_r text; v_login text := session_user;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_sub IS NULL AND p_rol_jwt IS NULL THEN ''
                          ELSE jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'role', p_rol_jwt))::text END, true);
  BEGIN
    IF p_sesiune IS NOT NULL THEN EXECUTE format('SET LOCAL SESSION AUTHORIZATION %I', p_sesiune); END IF;
    IF p_rol IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_rol); END IF;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    EXECUTE format('SET LOCAL SESSION AUTHORIZATION %I', v_login);
    v_r := 'ok:' || v_n;
  EXCEPTION WHEN OTHERS THEN
    v_r := SQLSTATE;  -- sub-tranzacția anulată readuce și identitatea de dinainte
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  IF session_user IS DISTINCT FROM v_login OR current_user IS DISTINCT FROM v_login THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: identitatea nu a revenit dupa caz (session_user %, current_user %)', session_user, current_user;
  END IF;
  RETURN v_r;
END $f$;

CREATE FUNCTION pg_temp.ig_rezultat(p_caz text, p_asteptat text, p_observat text, p_conditie boolean, p_descriere text) RETURNS void
LANGUAGE sql AS $f$
  INSERT INTO pg_temp.ig_rez (caz, asteptat, observat, ok, descriere)
  VALUES (p_caz, p_asteptat, coalesce(p_observat, '<NULL>'), coalesce(p_observat = p_asteptat AND p_conditie, false), p_descriere)
$f$;

-- schimbă schema într-o sub-tranzacție, aplică migrarea / revenirea și anulează totul (santinela); întoarce rezultatul aplicării
CREATE FUNCTION pg_temp.ig_mutant(p_ddl text, p_fisier text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_r text;
BEGIN
  BEGIN
    EXECUTE p_ddl;
    v_r := pg_temp.ig_aplica(p_fisier);
    RAISE EXCEPTION 'ig_santinela';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ig_santinela' THEN v_r := 'EROARE_TEST: ' || SQLERRM; END IF;
  END;
  RETURN v_r;
END $f$;

-- versiunea „cu un comentariu în plus” a unei funcții existente (CREATE OR REPLACE: aceeași semnătură, alt corp)
CREATE FUNCTION pg_temp.ig_corp_schimbat(p_oid oid) RETURNS text LANGUAGE sql AS $f$
  SELECT regexp_replace(pg_get_functiondef(p_oid), 'AS (\$[A-Za-z0-9_]*\$)', 'AS \1' || chr(10) || '-- mutant dry-run 20261132a')
$f$;

DO $do$
DECLARE
  v_owner uuid; v_a uuid; v_c uuid; v_d uuid; v_f uuid; v_adm uuid;
  l_t1 bigint; l_t2 bigint; l_ex bigint; l_m1 bigint; l_p1 bigint; l_v bigint; l_v2 bigint; l_i bigint; l_s bigint;
  l_c bigint; l_o bigint; l_g bigint; l_ab bigint; l_leg bigint; l_adm bigint; l_c2 bigint;
  v_r text; v_eticheta text; v_oid oid; v_pol text; a1 text; a2 text; m1 text;
  upd CONSTANT text := 'UPDATE public.ofertare_licitatii SET ';
  st text;
BEGIN
  -- ── utilizatorii de test (profiluri existente, după drept) ──
  SELECT id INTO v_owner FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT p.id INTO v_a FROM public.profiles p WHERE p.is_owner IS NOT TRUE
     AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = 'ofertare') ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_c FROM public.profiles p WHERE p.is_owner IS NOT TRUE AND p.id IS DISTINCT FROM v_a
     AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = 'ofertare') ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_d FROM public.profiles p WHERE p.is_owner IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module IN ('ofertare', 'financiar'))
   ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_f FROM public.profiles p WHERE p.is_owner IS NOT TRUE
     AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = 'financiar')
     AND NOT EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = 'ofertare') ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_adm FROM public.profiles p WHERE p.is_owner IS NOT TRUE AND p.id IS DISTINCT FROM v_a
     AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = 'ofertare' AND u.access_level = 'admin')
   ORDER BY p.id LIMIT 1;
  IF v_owner IS NULL OR v_a IS NULL OR v_c IS NULL OR v_d IS NULL THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: lipsesc profilurile de test (owner / doi colegi cu Ofertare / unul fara Ofertare si Financiar)';
  END IF;

  -- ── N*: migrarea REFUZĂ când schema nu e baseline-ul (înainte de aplicare; fiecare mutant se anulează) ──
  -- N1: corpul funcției unui trigger (nu din lanțul fn:) — CREATE OR REPLACE, aceeași semnătură
  SELECT t.tgname, t.tgfoid INTO v_eticheta, v_oid FROM pg_trigger t
   WHERE t.tgrelid = 'public.ofertare_licitatii'::regclass AND NOT t.tgisinternal
     AND t.tgfoid NOT IN ('public.fn_ofertare_licitatii_scriere()'::regprocedure, 'public.fn_ofertare_responsabil_setat_de()'::regprocedure)
   ORDER BY t.tgname DESC LIMIT 1;
  v_r := pg_temp.ig_mutant(pg_temp.ig_corp_schimbat(v_oid), 'mig');
  PERFORM pg_temp.ig_rezultat('N1', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%trg:' || v_eticheta || ' (difera)%' THEN 'refuz' ELSE v_r END,
    true, 'corpul functiei trigger-ului ' || coalesce(v_eticheta, '?') || ' inlocuit (CREATE OR REPLACE) -> migrarea refuza pe eticheta trigger-ului');
  -- N2: ACL-ul unei funcții din lanț
  v_r := pg_temp.ig_mutant('GRANT EXECUTE ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) TO authenticated', 'mig');
  PERFORM pg_temp.ig_rezultat('N2', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%fn:public.fn_ofertare_poate_cheltui(bigint,uuid) (difera)%' THEN 'refuz' ELSE v_r END,
    true, 'GRANT EXECUTE pe fn_ofertare_poate_cheltui catre authenticated -> refuz');
  -- N3: FORCE RLS comutat
  v_r := pg_temp.ig_mutant(CASE WHEN (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.ofertare_licitatii'::regclass)
                                THEN 'ALTER TABLE public.ofertare_licitatii NO FORCE ROW LEVEL SECURITY'
                                ELSE 'ALTER TABLE public.ofertare_licitatii FORCE ROW LEVEL SECURITY' END, 'mig');
  PERFORM pg_temp.ig_rezultat('N3', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%tabel:public.ofertare_licitatii (difera)%' THEN 'refuz' ELSE v_r END,
    true, 'FORCE ROW LEVEL SECURITY comutat -> refuz');
  -- N4: relacl NULL — amprenta tabelului se schimbă când se schimbă RLS (r1 pierdea RLS / FORCE la relacl NULL), iar migrarea refuză
  BEGIN
    UPDATE pg_catalog.pg_class SET relacl = NULL WHERE oid = 'public.ofertare_licitatii'::regclass;
    EXECUTE 'SELECT amprenta, material FROM (' || pg_temp.ig_interogare() || E'\n) AS x WHERE eticheta = ''tabel:public.ofertare_licitatii''' INTO a1, m1;
    EXECUTE CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_licitatii'::regclass)
                 THEN 'ALTER TABLE public.ofertare_licitatii DISABLE ROW LEVEL SECURITY'
                 ELSE 'ALTER TABLE public.ofertare_licitatii ENABLE ROW LEVEL SECURITY' END;
    EXECUTE 'SELECT amprenta FROM (' || pg_temp.ig_interogare() || E'\n) AS x WHERE eticheta = ''tabel:public.ofertare_licitatii''' INTO a2;
    v_r := pg_temp.ig_aplica('mig');
    RAISE EXCEPTION 'ig_santinela';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ig_santinela' THEN v_r := 'EROARE_TEST: ' || SQLERRM; END IF;
  END;
  PERFORM pg_temp.ig_rezultat('N4', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%tabel:public.ofertare_licitatii (difera)%' THEN 'refuz' ELSE v_r END,
    a1 IS NOT NULL AND a2 IS NOT NULL AND a1 <> a2 AND m1 LIKE '%acl: <NULL%',
    'relacl NULL: amprenta tabelului difera intre RLS pornit / oprit (' || coalesce(a1, '?') || ' / ' || coalesce(a2, '?') || ') si migrarea refuza');
  -- N5: expresia unei politici SELECT
  SELECT polname INTO v_pol FROM pg_policy WHERE polrelid = 'public.ofertare_licitatii'::regclass AND polcmd = 'r' ORDER BY polname LIMIT 1;
  v_r := pg_temp.ig_mutant(format('ALTER POLICY %I ON public.ofertare_licitatii USING (true)', v_pol), 'mig');
  PERFORM pg_temp.ig_rezultat('N5', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%pol:' || v_pol || ' (difera)%' THEN 'refuz' ELSE v_r END,
    v_pol IS NOT NULL, 'politica ' || coalesce(v_pol, '?') || ' cu USING (true) -> refuz');
  -- N6: un trigger nou pe tabel
  v_r := pg_temp.ig_mutant('CREATE TRIGGER zz_dryrun_20261132a BEFORE UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_licitatii_scriere()', 'mig');
  PERFORM pg_temp.ig_rezultat('N6', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%trg:zz_dryrun_20261132a (nou pe tinta)%' THEN 'refuz' ELSE v_r END,
    true, 'trigger nou zz_dryrun_20261132a -> refuz');
  -- N7: corpul unei funcții din lanț (fn_ofertare_poate_cheltui)
  v_r := pg_temp.ig_mutant(pg_temp.ig_corp_schimbat('public.fn_ofertare_poate_cheltui(bigint,uuid)'::regprocedure), 'mig');
  PERFORM pg_temp.ig_rezultat('N7', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a: amprentele schemei difera%fn:public.fn_ofertare_poate_cheltui(bigint,uuid) (difera)%' THEN 'refuz' ELSE v_r END,
    true, 'corpul fn_ofertare_poate_cheltui inlocuit -> refuz');

  -- ── A0: aplicarea pe schema baseline ──
  v_r := pg_temp.ig_aplica('mig');
  PERFORM pg_temp.ig_rezultat('A0', 'ok', v_r, true, 'migrarea se aplica pe baseline (amprente egale, postconditii)');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'DRYRUN 20261132a: migrarea nu s-a aplicat: %', v_r; END IF;

  -- ── fixture (sesiune postgres, claims de owner = numire făcută de owner → dovada true prin trigger-ul existent) ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-T1', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_t1;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil2_id)
  VALUES ('TEST-20261132-T2', 'test', 'test 20261132a', 'go', now() - interval '1 day', v_a) RETURNING id INTO l_t2;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-EX', 'test', 'test 20261132a', 'go', now(), v_a) RETURNING id INTO l_ex;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-M1', 'test', 'test 20261132a', 'in_lucru', now() - interval '1 second', v_a) RETURNING id INTO l_m1;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-P1', 'test', 'test 20261132a', 'in_lucru', now() + interval '1 second', v_a) RETURNING id INTO l_p1;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-V', 'test', 'test 20261132a', 'in_lucru', now() + interval '3 days', v_a) RETURNING id INTO l_v;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-V2', 'test', 'test 20261132a', 'in_lucru', now() + interval '3 days', v_a) RETURNING id INTO l_v2;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-I', 'test', 'test 20261132a', 'identificata', now() - interval '3 days', v_a) RETURNING id INTO l_i;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-C', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_c;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-C2', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_c2;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere)
  VALUES ('TEST-20261132-O', 'test', 'test 20261132a', 'go', now() + interval '10 days') RETURNING id INTO l_o;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-G', 'test', 'test 20261132a', 'go', now() + interval '5 days', v_a) RETURNING id INTO l_g;
  -- deja abandonată (INSERT: garda e doar pe UPDATE)
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-AB', 'test', 'test 20261132a', 'abandonata', now() - interval '3 days', v_a) RETURNING id INTO l_ab;
  -- autonumit: A se numește singur (dovada = false prin trigger-ul existent) → fără drept
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-S', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_s;
  -- numit de un ADMIN Ofertare (nu owner) — admis de fn_ofertare_poate_cheltui (observația recenzentului)
  IF v_adm IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
    VALUES ('TEST-20261132-ADM', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_adm;
  END IF;
  -- numire veche (decizia A): fără „numit de” și fără dovadă — trigger-ul de numire oprit DOAR pentru acest INSERT
  PERFORM set_config('request.jwt.claims', '', true);
  ALTER TABLE public.ofertare_licitatii DISABLE TRIGGER trg_ofertare_responsabil_setat_de;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-LEG', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_leg;
  ALTER TABLE public.ofertare_licitatii ENABLE TRIGGER trg_ofertare_responsabil_setat_de;
  IF (SELECT responsabil_numitor_autorizat FROM public.ofertare_licitatii WHERE id = l_s) IS NOT FALSE
     OR (SELECT responsabil_numitor_autorizat FROM public.ofertare_licitatii WHERE id = l_t1) IS NOT TRUE
     OR (SELECT responsabil2_numitor_autorizat FROM public.ofertare_licitatii WHERE id = l_t2) IS NOT TRUE
     OR (SELECT responsabil_numitor_autorizat IS NULL AND responsabil_setat_de IS NULL FROM public.ofertare_licitatii WHERE id = l_leg) IS NOT TRUE
     OR (v_adm IS NOT NULL AND (SELECT responsabil_numitor_autorizat FROM public.ofertare_licitatii WHERE id = l_adm) IS NOT TRUE) THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: fixture-ul dovezii de numire nu e cel asteptat';
  END IF;

  -- ── căile legitime (authenticator → authenticated, ca PostgREST) ──
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated',
           upd || format('status = ''abandonata'', observatii = coalesce(observatii || E''\n'', '''') || ''[test] Nedepusa dupa termen'', updated_at = now() WHERE id = %s', l_t1));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_t1;
  PERFORM pg_temp.ig_rezultat('R1', 'ok:1', v_r, st = 'abandonata', 'responsabilul 1 numit de owner inchide dupa termen, UPDATE-ul combinat din UI (status + observatii + updated_at)');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'', updated_at = now() WHERE id = %s', l_t2));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_t2;
  PERFORM pg_temp.ig_rezultat('R1b', 'ok:1', v_r, st = 'abandonata', 'responsabilul 2 numit, licitatie cu GO, dupa termen');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_ex));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_ex;
  PERFORM pg_temp.ig_rezultat('R1c', 'ok:1', v_r, st = 'abandonata', 'limita: termen = now() exact (OLD.termen_depunere <= now(); now() fix in tranzactie)');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_m1));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_m1;
  PERFORM pg_temp.ig_rezultat('R1d', 'ok:1', v_r, st = 'abandonata', 'limita: termen cu o secunda inainte de now() -> permis');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_owner, 'authenticated',
           upd || format('status = ''abandonata'', decizie_go = ''no_go'', decizie_motivare = ''test'', updated_at = now() WHERE id = %s', l_o));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_o;
  PERFORM pg_temp.ig_rezultat('R2', 'ok:1', v_r, st = 'abandonata', 'ownerul: NO-GO inainte de termen');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''in_lucru'', updated_at = now() WHERE id = %s', l_g));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_g;
  PERFORM pg_temp.ig_rezultat('R3', 'ok:1', v_r, st = 'in_lucru', 'alte tranzitii neatinse: responsabilul trece go -> in_lucru');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('observatii = ''nota test'' WHERE id = %s', l_v));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_v;
  PERFORM pg_temp.ig_rezultat('R3b', 'ok:1', v_r, st = 'in_lucru', 'editare fara status (trigger-ul e UPDATE OF status, nu ruleaza)');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_c, 'authenticated', upd || format('status = status, updated_at = now() WHERE id = %s', l_c));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('R4', 'ok:1', v_r, st = 'in_lucru', 'SET status = status de un coleg fara drept: fara schimbare reala, garda nu refuza');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_c, 'authenticated',
           upd || format('status = ''abandonata'', observatii = ''[test] editare dupa abandon'' WHERE id = %s', l_ab));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_ab;
  PERFORM pg_temp.ig_rezultat('R5', 'ok:1', v_r, st = 'abandonata', 'licitatie deja abandonata editata de un coleg (OLD = abandonata): permis');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_leg));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_leg;
  PERFORM pg_temp.ig_rezultat('R7', 'ok:1', v_r, st = 'abandonata', 'numire veche (fara numit_de si fara dovada, decizia A): responsabilul inchide dupa termen');
  IF v_adm IS NOT NULL THEN
    v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_adm));
    SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_adm;
    PERFORM pg_temp.ig_rezultat('R8', 'ok:1', v_r, st = 'abandonata', 'responsabil numit de un ADMIN Ofertare (nu owner): admis, ca la poarta pe cheltuiala');
  ELSE
    PERFORM pg_temp.ig_rezultat('R8', 'ok:1', 'SARIT', true, 'SARIT: nu exista un admin Ofertare non-owner pe clona (cazul nu e acoperit)');
  END IF;

  -- ── refuzuri ──
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_v));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_v;
  PERFORM pg_temp.ig_rezultat('P1', '42501', v_r, st = 'in_lucru', 'responsabilul numit, INAINTE de termen (+3 zile) -> a02');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_p1));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_p1;
  PERFORM pg_temp.ig_rezultat('P1b', '42501', v_r, st = 'in_lucru', 'limita: termen cu o secunda DUPA now() -> a02');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated',
           upd || format('status = ''abandonata'', termen_depunere = now() - interval ''1 day'' WHERE id = %s', l_v2));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_v2;
  PERFORM pg_temp.ig_rezultat('P1c', '42501', v_r, st = 'in_lucru', 'antedateaza termenul IN ACELASI UPDATE: garda foloseste OLD.termen_depunere -> a02');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_i));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_i;
  PERFORM pg_temp.ig_rezultat('P2', '42501', v_r, st = 'identificata', 'licitatie fara GO (identificata), dupa termen: doar ownerul -> a02');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_c, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_c));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('P3', '42501', v_r, st = 'in_lucru', 'coleg CU acces Ofertare (trece RLS si a00) care nu e responsabil -> a02 (zero randuri nu e acceptat)');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_c, 'authenticated',
           upd || format('status = ''abandonata'', responsabil_id = %L WHERE id = %s', v_c, l_c));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('P3b', '42501', v_r, st = 'in_lucru' AND (SELECT responsabil_id FROM public.ofertare_licitatii WHERE id = l_c) = v_a,
    'coleg care se numeste responsabil IN ACELASI UPDATE: garda foloseste OLD (responsabilul vechi) -> a02');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_s));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_s;
  PERFORM pg_temp.ig_rezultat('P4', '42501', v_r, st = 'in_lucru', 'responsabil autonumit (dovada de numire = false) -> a02');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_d, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_c));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('P5', 'ok:0', v_r, st = 'in_lucru', 'coleg FARA Ofertare / Financiar: politica UPDATE nu-i arata randul (RLS, nu garda; dovada gărzii e P3)');
  IF v_f IS NOT NULL THEN
    v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_f, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_c));
    SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
    PERFORM pg_temp.ig_rezultat('P6', 'P0001', v_r, st = 'in_lucru', 'coleg doar cu Financiar: a00 refuza INAINTEA a02 (Financiar poate schimba doar contract_id)');
  ELSE
    PERFORM pg_temp.ig_rezultat('P6', 'P0001', 'SARIT', true, 'SARIT: nu exista un cont doar cu Financiar pe clona');
  END IF;
  v_r := pg_temp.ig_caz('authenticator', 'service_role', NULL, 'service_role', upd || format('status = ''abandonata'' WHERE id = %s', l_c));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('P7', 'P0001', v_r, st = 'in_lucru', 'service_role prin PostgREST (UID NULL): a00 refuza INAINTEA a02 (service_role poate schimba doar termenul / documentatia)');
  -- izolat: a00 oprit într-o sub-tranzacție → refuzul propriu al gărzii pentru UID NULL în afara sesiunii postgres
  BEGIN
    ALTER TABLE public.ofertare_licitatii DISABLE TRIGGER a00_ofertare_licitatii_scriere;
    v_r := pg_temp.ig_caz('authenticator', 'service_role', NULL, 'service_role', upd || format('status = ''abandonata'' WHERE id = %s', l_c));
    RAISE EXCEPTION 'ig_santinela';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ig_santinela' THEN v_r := 'EROARE_TEST: ' || SQLERRM; END IF;
  END;
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('P8', '42501', v_r, st = 'in_lucru', 'izolat (a00 oprit): service_role, UID NULL, session_user authenticator -> refuzul propriu al a02');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    v_r := pg_temp.ig_caz('supabase_admin', NULL, NULL, NULL, upd || format('status = ''abandonata'' WHERE id = %s', l_c));
    SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
    PERFORM pg_temp.ig_rezultat('P9', 'P0001', v_r, st = 'in_lucru', 'supabase_admin fara claims: a00 refuza INAINTEA a02 (doar session_user postgres e administrare)');
    BEGIN
      ALTER TABLE public.ofertare_licitatii DISABLE TRIGGER a00_ofertare_licitatii_scriere;
      v_r := pg_temp.ig_caz('supabase_admin', NULL, NULL, NULL, upd || format('status = ''abandonata'' WHERE id = %s', l_c));
      RAISE EXCEPTION 'ig_santinela';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'ig_santinela' THEN v_r := 'EROARE_TEST: ' || SQLERRM; END IF;
    END;
    SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
    PERFORM pg_temp.ig_rezultat('P9b', '42501', v_r, st = 'in_lucru', 'izolat (a00 oprit): supabase_admin fara claims -> refuzul propriu al a02 (exceptia e doar postgres)');
  ELSE
    PERFORM pg_temp.ig_rezultat('P9', 'P0001', 'SARIT', true, 'SARIT: rolul supabase_admin nu exista pe clona');
  END IF;
  -- cron / administrare: sesiunea postgres fără claims (pg_cron rulează ca postgres) — la final pe l_c
  v_r := pg_temp.ig_caz(NULL, NULL, NULL, NULL, upd || format('status = ''abandonata'' WHERE id = %s', l_c));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c;
  PERFORM pg_temp.ig_rezultat('R6', 'ok:1', v_r, st = 'abandonata', 'cron / administrare: sesiunea postgres fara utilizator (a00 si a02 o lasa)');
  -- ownerul pe o licitație fără GO (după refuzul P2)
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_owner, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_i));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_i;
  PERFORM pg_temp.ig_rezultat('R2b', 'ok:1', v_r, st = 'abandonata', 'ownerul inchide si o licitatie fara GO (identificata)');

  -- ── RB*: revenirea REFUZĂ altă versiune sub același nume (fiecare mutant se anulează) ──
  v_r := pg_temp.ig_mutant(pg_temp.ig_corp_schimbat('public.fn_ofertare_inchidere_garda()'::regprocedure), 'rb');
  PERFORM pg_temp.ig_rezultat('RB1', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a ROLLBACK: fn_ofertare_inchidere_garda are alt corp%' THEN 'refuz' ELSE v_r END,
    true, 'corpul gardei inlocuit (CREATE OR REPLACE) -> revenirea refuza, nu sterge');
  v_r := pg_temp.ig_mutant('DROP TRIGGER a02_ofertare_licitatii_inchidere_garda ON public.ofertare_licitatii; '
                        || 'CREATE TRIGGER a02_ofertare_licitatii_inchidere_garda BEFORE UPDATE ON public.ofertare_licitatii '
                        || 'FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_inchidere_garda()', 'rb');
  PERFORM pg_temp.ig_rezultat('RB2', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a ROLLBACK: trigger-ul a02_ofertare_licitatii_inchidere_garda difera%' THEN 'refuz' ELSE v_r END,
    true, 'trigger-ul redefinit (BEFORE UPDATE fara OF status) -> revenirea refuza');
  v_r := pg_temp.ig_mutant('DROP TRIGGER a02_ofertare_licitatii_inchidere_garda ON public.ofertare_licitatii; '
                        || 'CREATE TRIGGER a02_ofertare_licitatii_inchidere_garda AFTER UPDATE OF status ON public.ofertare_licitatii '
                        || 'FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_inchidere_garda()', 'rb');
  PERFORM pg_temp.ig_rezultat('RB2b', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a ROLLBACK: trigger-ul a02_ofertare_licitatii_inchidere_garda difera%' THEN 'refuz' ELSE v_r END,
    true, 'trigger-ul redefinit pe alt moment (AFTER UPDATE OF status: aceleasi coloane, alt tgtype) -> revenirea refuza');
  v_r := pg_temp.ig_mutant('ALTER FUNCTION public.fn_ofertare_inchidere_garda() SECURITY INVOKER', 'rb');
  PERFORM pg_temp.ig_rezultat('RB3', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a ROLLBACK: atributele fn_ofertare_inchidere_garda difera%' THEN 'refuz' ELSE v_r END,
    true, 'garda trecuta pe SECURITY INVOKER -> revenirea refuza');
  v_r := pg_temp.ig_mutant('ALTER TABLE public.ofertare_licitatii DISABLE TRIGGER a02_ofertare_licitatii_inchidere_garda', 'rb');
  PERFORM pg_temp.ig_rezultat('RB4', 'refuz', CASE WHEN v_r LIKE 'P0001: 20261132a ROLLBACK: trigger-ul a02_ofertare_licitatii_inchidere_garda difera%' THEN 'refuz' ELSE v_r END,
    true, 'trigger-ul dezactivat -> revenirea refuza');

  -- ── revenire + re-aplicare + o probă după re-aplicare ──
  v_r := pg_temp.ig_aplica('rb');
  PERFORM pg_temp.ig_rezultat('RB0', 'ok', v_r,
    to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda'),
    'revenirea pe versiunea exacta: functia si trigger-ul dispar');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_a, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_v));
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.ig_rezultat('RB0b', 'ok:1', v_r, true, 'dupa revenire regula e iar doar in UI: responsabilul inainte de termen trece (starea de dinainte de migrare)');
  -- reface rândul pentru proba de după re-aplicare (sesiune postgres)
  UPDATE public.ofertare_licitatii SET status = 'in_lucru' WHERE id = l_v;
  v_r := pg_temp.ig_aplica('mig');
  PERFORM pg_temp.ig_rezultat('A1', 'ok', v_r, true, 're-aplicarea dupa revenire');
  v_r := pg_temp.ig_caz('authenticator', 'authenticated', v_c, 'authenticated', upd || format('status = ''abandonata'' WHERE id = %s', l_c2));
  SELECT status INTO st FROM public.ofertare_licitatii WHERE id = l_c2;
  PERFORM pg_temp.ig_rezultat('A1b', '42501', v_r, st = 'in_lucru', 'dupa re-aplicare garda refuza iar colegul fara drept');
END
$do$;

-- ── raportul: o linie pe caz; apoi verdictul (excepție = cod de ieșire ≠ 0) ──
SELECT 'REZ|' || r.caz || '|' || CASE WHEN r.observat = 'SARIT' THEN 'SARIT' WHEN r.ok THEN 'OK' ELSE 'FAIL' END
       || '|asteptat=' || r.asteptat || '|observat=' || r.observat || '|' || r.descriere AS rez
  FROM pg_temp.ig_rez r ORDER BY r.nr;

DO $verdict$
DECLARE v_fail text; v_sarit text;
BEGIN
  SELECT string_agg(caz, ', ' ORDER BY nr) INTO v_fail FROM pg_temp.ig_rez WHERE NOT ok AND observat <> 'SARIT';
  SELECT string_agg(caz, ', ' ORDER BY nr) INTO v_sarit FROM pg_temp.ig_rez WHERE observat = 'SARIT';
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION 'DRYRUN 20261132a: ESEC la %', v_fail;
  END IF;
  RAISE NOTICE 'DRYRUN 20261132a: TOATE OK (% cazuri; sarite, de acoperit altfel: %)', (SELECT count(*) FROM pg_temp.ig_rez), coalesce(v_sarit, 'niciunul');
END $verdict$;

ROLLBACK;
