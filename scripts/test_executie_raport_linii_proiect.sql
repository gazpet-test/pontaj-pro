-- Harness 20261217a_executie_raport_linii_proiect — DOAR pe clona schemei de producție (sau local, PGlite), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului (20261208a + 20261216a deja aplicate pe clonă):  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_raport_linii_proiect.sql
-- Local: node scripts/pglite/test_raport_linii_proiect_local.mjs (schema falsă + 20261027a + 20261201a + 20261208a + 20261216a, apoi acest fișier).
-- O singură tranzacție, ANULATĂ la final (ROLLBACK). NU presupune date reale: ia primul owner, două proiecte și primul șantier fără rezumate
-- corectate de om, le leagă DOAR în tranzacție și scrie date FICTIVE (zilele 2001-01-20 … 25, activitățile „… test linii”, obiectele TLP1 / TLP9).
-- Fereastra (antetul migrării) se deschide DETERMINIST, într-o singură sesiune: funcția pe care RPC-ul o cheamă ÎNTRE citirea proiectului
-- (pasul 1) și scrierea antetului (pasul 6) — fn_raport_lucrari_amprenta_linii, pasul 2 — e înlocuită, într-un bloc anulat imediat după, cu una
-- care face întâi mutarea șantierului (= „altă sesiune a comis mutarea exact în fereastră”, în READ COMMITTED efectul e același: garda și
-- trigger-ul citesc proiectul nou). Concurența reală (lock-uri, așteptări, mutanți): scripts/raport_linii_proiect_concurenta.sh.
-- Ordinea: T0 date -> T1 defectul se REPRODUCE înainte de migrare (raport nou + raport existent fără rezumat) -> migrarea (\ir, cu plafonul
-- runnerului) -> TB politici / drepturi neschimbate -> T2 aceeași fereastră = refuz, nimic scris -> T3 căile legitime ale aplicației ->
-- T4 căile directe -> T5 funcția nu e apelabilă -> T6 revenirea (nearmată = refuz; armată = scoate tot, defectul revine) -> re-aplicare.
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
-- Migrarea cere BASELINE-ul L15 completat (scripts/raport_linii_proiect_amprente.sql pe clonă, copiat în blocul marcat; necompletat = refuz la \ir).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('tlp.pol0', (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('raport_lucrari', 'rapoarte_zilnice', 'sites')), true),
       set_config('tlp.acl0', (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.raport_lucrari'::regclass, 'public.rapoarte_zilnice'::regclass, 'public.sites'::regclass)), true);

-- ── unelte ──
-- identitatea: ambele surse JWT (auth.uid() citește întâi request.jwt.claim.sub), apoi rolul fără BYPASSRLS
CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_rol)::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
  IF auth.uid() IS DISTINCT FROM p_uid OR current_user IS DISTINCT FROM p_rol
     OR (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 't_ca: identitatea nu s-a schimbat (% / %)', auth.uid(), current_user;
  END IF;
END $h$;
-- refuzul cu motivul EXACT (SQLSTATE + fragmentul mesajului), nu doar codul (L25)
CREATE FUNCTION pg_temp.t_refuza_msg(p_sql text, p_stare text, p_fragment text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza_msg: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare OR position(p_fragment IN SQLERRM) = 0 THEN
    RAISE NOTICE 't_refuza_msg: așteptat % / %, primit % (%)', p_stare, p_fragment, SQLSTATE, left(SQLERRM, 200); RETURN false;
  END IF;
  RETURN true;
END $h$;
-- scrierea trece: întoarce numărul de rânduri; orice eroare = -1
CREATE FUNCTION pg_temp.t_trece(p_sql text) RETURNS integer LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 't_trece: eroare % (%): %', SQLSTATE, left(SQLERRM, 200), left(p_sql, 200); RETURN -1;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tlp.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
-- salvarea prin RPC ca owner-ul (cont real al aplicației: rolul authenticated, JWT în ambele surse), cu fereastra deschisă: funcția din pasul 2
-- al RPC-ului mută întâi șantierul în p_proiect_nou (o singură dată), apoi calculează exact ce calcula. TOTUL se anulează la final (blocul
-- cu excepție), inclusiv înlocuirea funcției. Întoarce: 'ok|<proiectele liniilor>|<proiectul șantierului>' sau 'eroare|SQLSTATE|mesaj'.
CREATE FUNCTION pg_temp.t_cu_mutare(p_zi date, p_versiune integer, p_linii jsonb, p_proiect_nou bigint) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r jsonb; v text;
BEGIN
  BEGIN
    EXECUTE $carlig$
      CREATE OR REPLACE FUNCTION public.fn_raport_lucrari_amprenta_linii(p jsonb) RETURNS text
      LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $c$
      DECLARE m text := nullif(current_setting('tlp.muta', true), '');
      BEGIN
        IF m IS NOT NULL THEN
          UPDATE public.sites SET proiect_id = split_part(m, ':', 2)::bigint
           WHERE id = split_part(m, ':', 1)::bigint AND proiect_id IS DISTINCT FROM split_part(m, ':', 2)::bigint;
        END IF;
        RETURN md5(coalesce((SELECT string_agg(x.activitate_id::text || ':' || coalesce(x.unitate_id::text, '-') || ':' || trim_scale(x.cantitate)::text, ';'
                                               ORDER BY x.activitate_id, x.unitate_id NULLS FIRST, x.cantitate)
                              FROM jsonb_to_recordset(coalesce(p, '[]'::jsonb)) AS x(activitate_id bigint, unitate_id bigint, cantitate numeric)), ''));
      END $c$
    $carlig$;
    PERFORM set_config('tlp.muta', pg_temp.t_g('s1') || ':' || p_proiect_nou, true);
    PERFORM pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
    BEGIN
      r := public.fn_raport_zilnic_salveaza(pg_temp.t_g('s1')::bigint, p_zi, '{"probleme": "test linii proiect"}'::jsonb, p_linii, NULL, p_versiune, gen_random_uuid());
      PERFORM pg_temp.t_ca(NULL, 'postgres');
      v := 'ok|' || coalesce((SELECT string_agg(DISTINCT l.proiect_id::text, ',') FROM public.raport_lucrari l WHERE l.raport_id = (r ->> 'raport_id')::bigint), '-')
           || '|' || coalesce((SELECT s.proiect_id::text FROM public.sites s WHERE s.id = pg_temp.t_g('s1')::bigint), '-');
      IF r ->> 'ok' IS DISTINCT FROM 'true' THEN v := 'rezultat|' || r::text; END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_temp.t_ca(NULL, 'postgres');
      v := 'eroare|' || SQLSTATE || '|' || SQLERRM;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0T99', MESSAGE = v;   -- anulează tot ce s-a făcut în bloc
  EXCEPTION WHEN SQLSTATE 'P0T99' THEN
    v := SQLERRM;
  END;
  RETURN v;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza_msg(text, text, text), pg_temp.t_trece(text), pg_temp.t_g(text)
  TO authenticated, anon, service_role;

-- ── T0: identități, proiecte, șantier, date fictive (doar în tranzacție) ──
DO $t$
DECLARE own uuid; p1 bigint; p2 bigint; s1 bigint; a1 bigint; a2 bigint; a9 bigint; u1 bigint; u9 bigint; z bigint; r jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  IF to_regprocedure('public.fn_raport_rezumat_garda()') IS NULL THEN RAISE EXCEPTION 'T0 FAIL: 20261216a nu e aplicată (starea producției)'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT id INTO p1 FROM public.executie_proiecte ORDER BY id LIMIT 1;
  SELECT id INTO p2 FROM public.executie_proiecte WHERE id <> p1 ORDER BY id LIMIT 1;
  -- șantierul: primul fără rezumate corectate de om (mutarea lui ar fi refuzată de 20261216a, pe drept)
  SELECT s.id INTO s1 FROM public.sites s
   WHERE NOT EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.site_id = s.id AND r.rezumat_sursa = 'editat') ORDER BY s.id LIMIT 1;
  IF own IS NULL OR p1 IS NULL OR p2 IS NULL OR s1 IS NULL THEN RAISE EXCEPTION 'T0 FAIL: lipsesc owner / proiecte / șantier'; END IF;
  UPDATE public.sites SET proiect_id = p1 WHERE id = s1 AND proiect_id IS DISTINCT FROM p1;
  DELETE FROM public.rapoarte_zilnice WHERE site_id = s1 AND data BETWEEN DATE '2001-01-20' AND DATE '2001-01-25';
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ) VALUES (p1, 'Sudură test linii', 'buc', 'cantitate', 1, true) RETURNING id INTO a1;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ) VALUES (p1, 'Săpătură test linii', 'mc', 'cantitate', 2, true) RETURNING id INTO a2;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ) VALUES (p2, 'Activitate străină test linii', 'm', 'cantitate', 1, true) RETURNING id INTO a9;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p1, 'tronson', 'TLP1', 'Tronson test linii', 1, true) RETURNING id INTO u1;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p2, 'tronson', 'TLP9', 'Obiect străin test linii', 1, true) RETURNING id INTO u9;
  PERFORM set_config('tlp.own', own::text, true), set_config('tlp.p1', p1::text, true), set_config('tlp.p2', p2::text, true),
          set_config('tlp.s1', s1::text, true), set_config('tlp.a1', a1::text, true), set_config('tlp.a2', a2::text, true),
          set_config('tlp.a9', a9::text, true), set_config('tlp.u1', u1::text, true), set_config('tlp.u9', u9::text, true);
  -- raportul EXISTENT fără rezumat valabil (ziua 21): salvat cu rezumat pe p1, apoi șantierul mutat în p2 și înapoi => 'de_recompus' (mutarea
  -- din 20261216a nu-l mai atinge: exact cazul „raport existent fără rezumat”, ca rapoartele de dinainte de 20261216a, cu rezumat NULL)
  PERFORM pg_temp.t_ca(own, 'authenticated');
  r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-01-21', '{"probleme": "T0 existent"}'::jsonb, NULL, NULL, 0, gen_random_uuid());
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  UPDATE public.sites SET proiect_id = p2 WHERE id = s1;
  UPDATE public.sites SET proiect_id = p1 WHERE id = s1;
  SELECT id INTO z FROM public.rapoarte_zilnice WHERE site_id = s1 AND data = DATE '2001-01-21' AND rezumat_sursa = 'de_recompus';
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR z IS NULL THEN RAISE EXCEPTION 'T0 FAIL: raportul existent de plecare % / %', r, z; END IF;
  PERFORM set_config('tlp.z21', z::text, true), set_config('tlp.v21', (SELECT versiune_salvare::text FROM public.rapoarte_zilnice WHERE id = z), true);
  RAISE NOTICE 'T0 OK';
END $t$;

-- ── T1: ÎNAINTE de migrare, defectul se reproduce: liniile rămân pe proiectul vechi, șantierul e în cel nou ──
DO $t$
DECLARE v text; l jsonb := jsonb_build_array(jsonb_build_object('activitate_id', pg_temp.t_g('a1')::bigint, 'unitate_id', pg_temp.t_g('u1')::bigint, 'cantitate', 2));
  ast text := 'ok|' || pg_temp.t_g('p1') || '|' || pg_temp.t_g('p2');
BEGIN
  v := pg_temp.t_cu_mutare(DATE '2001-01-20', 0, l, pg_temp.t_g('p2')::bigint);
  IF v IS DISTINCT FROM ast THEN RAISE EXCEPTION 'T1 FAIL: raport nou: defectul nu se reproduce (% , așteptat %)', v, ast; END IF;
  v := pg_temp.t_cu_mutare(DATE '2001-01-21', pg_temp.t_g('v21')::int, l, pg_temp.t_g('p2')::bigint);
  IF v IS DISTINCT FROM ast THEN RAISE EXCEPTION 'T1 FAIL: raport existent fără rezumat: defectul nu se reproduce (% , așteptat %)', v, ast; END IF;
  -- blocul s-a anulat: șantierul e tot în p1, ziua 20 nu există, funcția din pasul 2 e cea originală
  IF (SELECT proiect_id FROM public.sites WHERE id = pg_temp.t_g('s1')::bigint)::text IS DISTINCT FROM pg_temp.t_g('p1')
     OR EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = pg_temp.t_g('s1')::bigint AND data = DATE '2001-01-20')
     OR (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_raport_lucrari_amprenta_linii(jsonb)'::regprocedure) <> 'sql' THEN
    RAISE EXCEPTION 'T1 FAIL: blocul de probă nu s-a anulat';
  END IF;
  RAISE NOTICE 'T1 OK: defect reprodus înainte de migrare (raport nou + raport existent fără rezumat: liniile pe p%, șantierul în p%)', pg_temp.t_g('p1'), pg_temp.t_g('p2');
END $t$;

-- ── migrarea, cu ce pune runnerul (marcajul de livrare + plafonul 2000 ms, sursa 'session') ──
SELECT set_config('gazpet.livrare_migrare', '20261217a_executie_raport_linii_proiect:' || txid_current(), true);
SELECT set_config('transaction_timeout', '2000', true), set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
\ir ../supabase/migrations/20261217a_executie_raport_linii_proiect.sql
SELECT set_config('transaction_timeout', '0', true), set_config('gazpet.plafon_tranzactie', '', true), set_config('gazpet.livrare_migrare', '', true);

-- ── TB: migrarea nu schimbă politicile / drepturile tabelelor atinse ──
DO $t$
BEGIN
  IF (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('raport_lucrari', 'rapoarte_zilnice', 'sites')) IS DISTINCT FROM pg_temp.t_g('pol0')
     OR (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.raport_lucrari'::regclass, 'public.rapoarte_zilnice'::regclass, 'public.sites'::regclass)) IS DISTINCT FROM pg_temp.t_g('acl0') THEN
    RAISE EXCEPTION 'TB FAIL: migrarea a schimbat politicile / drepturile';
  END IF;
  RAISE NOTICE 'TB OK';
END $t$;

-- ── T2: DUPĂ migrare, aceeași fereastră = refuz 22023 cu motivul lui, nimic scris (antetul, liniile, jurnalul se anulează împreună) ──
DO $t$
DECLARE v text; l jsonb := jsonb_build_array(jsonb_build_object('activitate_id', pg_temp.t_g('a1')::bigint, 'unitate_id', pg_temp.t_g('u1')::bigint, 'cantitate', 2));
  frag text := 'șantierul raportului e acum în alt proiect';
BEGIN
  v := pg_temp.t_cu_mutare(DATE '2001-01-20', 0, l, pg_temp.t_g('p2')::bigint);
  IF v NOT LIKE 'eroare|22023|%' OR position(frag IN v) = 0 THEN RAISE EXCEPTION 'T2 FAIL: raport nou: %', v; END IF;
  v := pg_temp.t_cu_mutare(DATE '2001-01-21', pg_temp.t_g('v21')::int, l, pg_temp.t_g('p2')::bigint);
  IF v NOT LIKE 'eroare|22023|%' OR position(frag IN v) = 0 THEN RAISE EXCEPTION 'T2 FAIL: raport existent fără rezumat: %', v; END IF;
  -- fără mutare (proiectul nou = cel de acum), aceeași salvare trece: refuzul vine din mutare, nu din linie
  v := pg_temp.t_cu_mutare(DATE '2001-01-20', 0, l, pg_temp.t_g('p1')::bigint);
  IF v IS DISTINCT FROM 'ok|' || pg_temp.t_g('p1') || '|' || pg_temp.t_g('p1') THEN RAISE EXCEPTION 'T2 FAIL: fără mutare: %', v; END IF;
  -- raportul existent a rămas cum era (versiunea, fără linii)
  IF (SELECT versiune_salvare::text FROM public.rapoarte_zilnice WHERE id = pg_temp.t_g('z21')::bigint) IS DISTINCT FROM pg_temp.t_g('v21')
     OR EXISTS (SELECT 1 FROM public.raport_lucrari WHERE raport_id = pg_temp.t_g('z21')::bigint) THEN
    RAISE EXCEPTION 'T2 FAIL: raportul existent s-a schimbat';
  END IF;
  RAISE NOTICE 'T2 OK: fereastra închisă (raport nou + raport existent fără rezumat: refuz 22023, nimic scris)';
END $t$;

-- ── T3: căile legitime ale aplicației (L20): salvare nouă, re-salvare, fără linii, liste goale, salvare DUPĂ o mutare comisă, liniile istorice ──
DO $t$
DECLARE r jsonb; z bigint; n integer; s1 bigint := pg_temp.t_g('s1')::bigint; p1 text := pg_temp.t_g('p1'); p2 text := pg_temp.t_g('p2');
  a1 bigint := pg_temp.t_g('a1')::bigint; a2 bigint := pg_temp.t_g('a2')::bigint; a9 bigint := pg_temp.t_g('a9')::bigint;
  u1 bigint := pg_temp.t_g('u1')::bigint; u9 bigint := pg_temp.t_g('u9')::bigint;
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
  -- (a) raport nou cu linii pe proiectul de acum
  r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-01-22', '{"probleme": "T3a"}'::jsonb,
         jsonb_build_array(jsonb_build_object('activitate_id', a1, 'unitate_id', u1, 'cantitate', 3), jsonb_build_object('activitate_id', a2, 'unitate_id', NULL, 'cantitate', 1.5)),
         NULL, 0, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T3 FAIL: (a) raport nou %', r; END IF;
  z := (r ->> 'raport_id')::bigint;
  -- (b) re-salvarea lui cu alte linii; (c) fără linii (p_linii NULL: nu se ating); (d) lista goală (șterge liniile)
  r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-01-22', '{"probleme": "T3b"}'::jsonb,
         jsonb_build_array(jsonb_build_object('activitate_id', a1, 'unitate_id', NULL, 'cantitate', 4)), NULL, (r ->> 'versiune')::int, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T3 FAIL: (b) re-salvare %', r; END IF;
  r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-01-22', '{"probleme": "T3c"}'::jsonb, NULL, NULL, (r ->> 'versiune')::int, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM public.raport_lucrari WHERE raport_id = z) <> 1 THEN RAISE EXCEPTION 'T3 FAIL: (c) fără linii %', r; END IF;
  r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-01-23', '{"probleme": "T3d"}'::jsonb, '[]'::jsonb, NULL, 0, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T3 FAIL: (d) listă goală %', r; END IF;
  -- (e) mutarea COMISĂ înainte (aici: în aceeași tranzacție, înaintea salvării): raportul nou se salvează pe proiectul nou, cu activitatea lui
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  UPDATE public.sites SET proiect_id = p2::bigint WHERE id = s1;
  PERFORM pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
  r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-01-24', '{"probleme": "T3e"}'::jsonb,
         jsonb_build_array(jsonb_build_object('activitate_id', a9, 'unitate_id', u9, 'cantitate', 7)), NULL, 0, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T3 FAIL: (e) după mutare %', r; END IF;
  -- … iar activitatea proiectului VECHI e refuzată de RPC (mesajul lui, ca înainte de migrare): telefonul trebuie să reîncarce
  IF NOT pg_temp.t_refuza_msg(format($q$SELECT public.fn_raport_zilnic_salveaza(%s, DATE '2001-01-25', '{"probleme": "T3e2"}'::jsonb, '[{"activitate_id": %s, "unitate_id": null, "cantitate": 1}]'::jsonb, NULL, 0, gen_random_uuid())$q$, s1, a1),
                                 '22023', 'nu e a proiectului raportului') THEN
    RAISE EXCEPTION 'T3 FAIL: (e2) activitatea proiectului vechi după mutare';
  END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  -- (f) liniile ISTORICE ale raportului din ziua 22 (scrise pe p1, șantierul acum în p2) rămân editabile: cantitatea, observațiile, ștergerea
  --     unui obiect (SET NULL din cheia străină), ștergerea liniei
  IF (SELECT string_agg(DISTINCT proiect_id::text, ',') FROM public.raport_lucrari WHERE raport_id = z) IS DISTINCT FROM p1 THEN
    RAISE EXCEPTION 'T3 FAIL: (f) liniile istorice nu mai sunt pe p%', p1;
  END IF;
  IF pg_temp.t_trece(format('UPDATE public.raport_lucrari SET cantitate = 5, observatii = %L WHERE raport_id = %s', 'T3f', z)) <> 1
     OR pg_temp.t_trece(format('UPDATE public.raport_lucrari SET proiect_id = proiect_id WHERE raport_id = %s', z)) <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: (f) editarea liniei istorice';
  END IF;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p1::bigint, 'tronson', 'TLP2', 'Tronson test linii 2', 2, true) RETURNING id INTO u1;
  UPDATE public.raport_lucrari SET unitate_id = u1 WHERE raport_id = z;   -- obiectul aceluiași proiect al liniei (neverificat pe UPDATE: linia nu se mută)
  -- ștergerea unui obiect cu cheia străină ON DELETE SET NULL = un UPDATE care scoate DOAR unitate_id (aceeași instrucțiune ca a cheii străine;
  -- ștergerea obiectului însuși are gărzile ei, 20261208a)
  n := pg_temp.t_trece(format('UPDATE public.raport_lucrari SET unitate_id = NULL WHERE raport_id = %s', z));
  IF n <> 1 OR (SELECT unitate_id FROM public.raport_lucrari WHERE raport_id = z) IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAIL: (f) obiectul scos de pe linia istorică (SET NULL): % rânduri, obiectul %', n, (SELECT unitate_id FROM public.raport_lucrari WHERE raport_id = z);
  END IF;
  IF pg_temp.t_trece(format('DELETE FROM public.raport_lucrari WHERE raport_id = %s', z)) <> 1 THEN RAISE EXCEPTION 'T3 FAIL: (f) ștergerea liniei'; END IF;
  UPDATE public.sites SET proiect_id = p1::bigint WHERE id = s1;
  RAISE NOTICE 'T3 OK: căile legitime (nou, re-salvare, fără linii, listă goală, după mutare, liniile istorice editabile / șterse)';
END $t$;

-- ── T4: căile directe (ca postgres: service_role / scripturi; L07): orice INSERT / mutare a liniei trece prin aceeași regulă ──
DO $t$
DECLARE z bigint; z2 bigint; s2 bigint; s1 bigint := pg_temp.t_g('s1')::bigint; p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint;
  a1 bigint := pg_temp.t_g('a1')::bigint; a9 bigint := pg_temp.t_g('a9')::bigint; u1 bigint := pg_temp.t_g('u1')::bigint; u9 bigint := pg_temp.t_g('u9')::bigint;
  frag text := 'șantierul raportului e acum în alt proiect';
BEGIN
  SELECT id INTO z FROM public.rapoarte_zilnice WHERE site_id = s1 AND data = DATE '2001-01-23';
  IF z IS NULL THEN RAISE EXCEPTION 'T4 FAIL: raportul zilei 23 lipsește'; END IF;
  IF pg_temp.t_trece(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate) VALUES (%s, %s, %s, %s, 1)', z, p1, a1, u1)) <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: inserarea corectă';
  END IF;
  IF NOT pg_temp.t_refuza_msg(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (%s, %s, %s, 1)', z, p2, a9), '22023', frag)
     OR NOT pg_temp.t_refuza_msg(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (%s, NULL, %s, 1)', z, a1), '22023', frag)
     OR NOT pg_temp.t_refuza_msg(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (%s, %s, %s, 1)', z, p1, a9), '22023', 'activitatea')
     OR NOT pg_temp.t_refuza_msg(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate) VALUES (%s, %s, %s, %s, 1)', z, p1, a1, u9), '22023', 'obiectul')
     OR NOT pg_temp.t_refuza_msg(format('UPDATE public.raport_lucrari SET proiect_id = %s WHERE raport_id = %s', p2, z), '22023', frag) THEN
    RAISE EXCEPTION 'T4 FAIL: o linie pe alt proiect decât al șantierului a trecut (sau refuz cu alt motiv)';
  END IF;
  -- mutarea liniei pe raportul unui ALT șantier, din alt proiect = refuz; pe un raport al aceluiași proiect = trece
  SELECT id INTO s2 FROM public.sites WHERE id <> s1 ORDER BY id LIMIT 1;
  IF s2 IS NOT NULL THEN
    UPDATE public.sites SET proiect_id = p2 WHERE id = s2 AND NOT EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.site_id = s2 AND r.rezumat_sursa = 'editat');
    IF (SELECT proiect_id FROM public.sites WHERE id = s2) = p2 THEN
      DELETE FROM public.rapoarte_zilnice WHERE site_id = s2 AND data = DATE '2001-01-20';
      INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at) VALUES (s2, DATE '2001-01-20', 'T4 alt santier', pg_temp.t_g('own')::uuid, now()) RETURNING id INTO z2;
      IF NOT pg_temp.t_refuza_msg(format('UPDATE public.raport_lucrari SET raport_id = %s WHERE raport_id = %s', z2, z), '22023', frag) THEN
        RAISE EXCEPTION 'T4 FAIL: linia mutată pe raportul altui proiect';
      END IF;
    END IF;
  END IF;
  IF pg_temp.t_trece(format('UPDATE public.raport_lucrari SET raport_id = (SELECT id FROM public.rapoarte_zilnice WHERE site_id = %s AND data = DATE %L) WHERE raport_id = %s', s1, '2001-01-22', z)) <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: linia mutată pe alt raport al aceluiași șantier';
  END IF;
  -- raportul inexistent: refuzul îl dă cheia străină (nu trigger-ul)
  IF NOT pg_temp.t_refuza_msg(format('INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (-1, %s, %s, 1)', p1, a1), '23503', 'raport') THEN
    RAISE EXCEPTION 'T4 FAIL: raport inexistent';
  END IF;
  RAISE NOTICE 'T4 OK: căile directe (proiect / activitate / obiect străin, proiect NULL, mutarea liniei, raport inexistent)';
END $t$;

-- ── T5: funcția gărzii nu e apelabilă din API ──
DO $t$
BEGIN
  IF has_function_privilege('anon', 'public.fn_raport_lucrari_proiect_garda()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_raport_lucrari_proiect_garda()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_raport_lucrari_proiect_garda()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T5 FAIL: EXECUTE pe funcția gărzii';
  END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- ── T6: revenirea — nearmată = refuz; armată = scoate tot și defectul revine; re-aplicarea închide iar fereastra ──
SAVEPOINT t6a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql
\set t6a_eroare :ERROR
\set t6a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6a;
SELECT pg_temp.t_eroare('T6a', :'t6a_eroare', :'t6a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t6b;
-- armată ca de runner, dar cu starea schimbată (EXECUTE dat clienților) = refuz
GRANT EXECUTE ON FUNCTION public.fn_raport_lucrari_proiect_garda() TO authenticated;
SELECT set_config('gazpet.livrare_migrare', '20261217a_executie_raport_linii_proiect_ROLLBACK:' || txid_current(), true);
SELECT set_config('transaction_timeout', '2000', true), set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql
\set t6b_eroare :ERROR
\set t6b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t6b;
SELECT pg_temp.t_eroare('T6b', :'t6b_eroare', :'t6b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'starea nu e cea din 20261217a');
SELECT set_config('gazpet.livrare_migrare', '20261217a_executie_raport_linii_proiect_ROLLBACK:' || txid_current(), true);
SELECT set_config('transaction_timeout', '2000', true), set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
\ir ../supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql
SELECT set_config('transaction_timeout', '0', true), set_config('gazpet.plafon_tranzactie', '', true), set_config('gazpet.livrare_migrare', '', true);
DO $t$
DECLARE v text; l jsonb := jsonb_build_array(jsonb_build_object('activitate_id', pg_temp.t_g('a1')::bigint, 'unitate_id', NULL, 'cantitate', 2));
BEGIN
  IF to_regprocedure('public.fn_raport_lucrari_proiect_garda()') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_raport_lucrari_zz_proiect') THEN
    RAISE EXCEPTION 'T6 FAIL: revenirea a lăsat obiecte';
  END IF;
  v := pg_temp.t_cu_mutare(DATE '2001-01-20', 0, l, pg_temp.t_g('p2')::bigint);
  IF v IS DISTINCT FROM 'ok|' || pg_temp.t_g('p1') || '|' || pg_temp.t_g('p2') THEN RAISE EXCEPTION 'T6 FAIL: după revenire comportamentul nu e cel vechi: %', v; END IF;
  RAISE NOTICE 'T6 OK (revenire: obiectele scoase, comportamentul de dinainte)';
END $t$;
SELECT set_config('gazpet.livrare_migrare', '20261217a_executie_raport_linii_proiect:' || txid_current(), true);
SELECT set_config('transaction_timeout', '2000', true), set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
\ir ../supabase/migrations/20261217a_executie_raport_linii_proiect.sql
SELECT set_config('transaction_timeout', '0', true), set_config('gazpet.plafon_tranzactie', '', true), set_config('gazpet.livrare_migrare', '', true);
DO $t$
DECLARE v text; l jsonb := jsonb_build_array(jsonb_build_object('activitate_id', pg_temp.t_g('a1')::bigint, 'unitate_id', NULL, 'cantitate', 2));
BEGIN
  v := pg_temp.t_cu_mutare(DATE '2001-01-20', 0, l, pg_temp.t_g('p2')::bigint);
  IF v NOT LIKE 'eroare|22023|%' THEN RAISE EXCEPTION 'T6 FAIL: după re-aplicare: %', v; END IF;
  RAISE NOTICE 'T6 OK (re-aplicare)';
END $t$;
ROLLBACK;
