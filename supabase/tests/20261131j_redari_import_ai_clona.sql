-- Proba pe CLONĂ a migrării 20261131j (Redări, verificarea AI a importului TGZ; r3, verdictul Jakarinos #1141 r2): O SINGURĂ sesiune, ca rolurile reale
--   (authenticated cu JWT — sub în request.jwt.claim.sub ȘI în claims —, anon, service_role, postgres), pe PostgreSQL 17 cu 20261131j APLICATĂ.
-- DOAR PE CLONĂ. Totul rulează într-O tranzacție terminată cu ROLLBACK: nimic nu rămâne. Date SINTETICE: conturi noi (auth.users + profiles +
--   user_module_access, e-mailuri @example.invalid), proiecte noi (cod TEST-AI-CLONA-*), drepturi pe ele, rânduri de jurnal pe ele; nicio citire de date
--   reale (filtrele = id-urile sintetice). Inserarea proiectelor scrie (prin triggerul existent al red_proiecte) în red_jurnal — anulat la ROLLBACK.
-- Ce probează (așteptările scrise de mână, independent de cod — L25):
--   A  dreptul (fn_red_import_ai_poate) pe matricea de conturi; anon = 42501.
--   B  rezervarea: refuzurile fără scriere, cheia de intenție (aceeași cheie = nou:false, fără al doilea rând; alt conținut / alt cont = cheie_refolosita),
--      cele TREI plafoane la limită (60 de apeluri / zi, 10 USD / zi cu costul rezervat al necunoscutelor, 2 / zi pe același conținut).
--   C  închiderea (doar service_role): CAS pe token + stare; r3: „ok” = fără respingeri, „incomplet” = cu respingeri (≥ 1), combinațiile încrucișate
--      refuzate (false) și CHECK-ul tabelei (23514) pentru scrierea directă a postgres-ului.
--   D  RLS ca NON-OWNER: jurnalul doar cu dreptul pe proiect; drepturile și istoricul: contul propriu + adminii Redări; viewerul și alt editor nu văd
--      istoricul altuia și nicio copie a drepturilor în red_jurnal; anon = 42501 pe toate trei tabelele; scrierile directe (authenticated, service_role)
--      = 42501; istoricul append-only și pentru postgres.
--   Concurența reală (două sesiuni), refuzurile revenirii și eliberarea lock-urilor la plafonul de 2000 ms = scriptul .sh din același folder.
-- Rulare (clona; ca postgres):
--   psql -X -v ON_ERROR_STOP=1 -v clona=da -f supabase/tests/20261131j_redari_import_ai_clona.sql
--   Rezultatul = linii NOTICE „OK  …” / „NU  …” și ultima „CLONA 20261131j: verificari=<n> esec=<m> verdict=OK|ESEC”.
\set ON_ERROR_STOP 1
\if :{?clona}
\else
  \set clona nu
\endif
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('clona.da', :'clona', true), set_config('clona.esec', '0', true), set_config('clona.n', '0', true);
DO $garda$
BEGIN
  IF current_setting('clona.da', true) IS DISTINCT FROM 'da' THEN RAISE EXCEPTION 'CLONA 20261131j: doar pe clona (-v clona=da); nimic schimbat'; END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'CLONA 20261131j: ruleaza ca postgres (fixture-ul)'; END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'CLONA 20261131j: cere PostgreSQL 17 (ca productia)'; END IF;
  IF to_regclass('public.red_import_ai_jurnal') IS NULL OR to_regclass('public.red_proiect_drepturi_istoric') IS NULL
     OR to_regprocedure('public.fn_red_import_ai_inchide(uuid,uuid,text,integer,integer,integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'CLONA 20261131j: 20261131j nu e aplicata';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod LIKE 'TEST-AI-CLONA-%' OR id::text LIKE '1131a100-%')
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id::text LIKE '1131a100-%') THEN
    RAISE EXCEPTION 'CLONA 20261131j: datele sintetice exista deja (alta rulare neterminata?)';
  END IF;
END $garda$;

-- ── unelte (pg_temp; EXECUTE pentru rolurile probate) ──
CREATE FUNCTION pg_temp.ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', (CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol) ELSE jsonb_build_object('sub', p_uid, 'role', p_rol) END)::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $f$;
-- SQLSTATE-ul unei instrucțiuni ('00000' = a trecut); efectele unei instrucțiuni reușite rămân (subtranzacția se anulează doar la eroare)
CREATE FUNCTION pg_temp.st(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE p_sql; RETURN '00000'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
-- valoarea (text) a unei interogări cu o coloană; eroarea = 'EROARE <sqlstate>'
CREATE FUNCTION pg_temp.v(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text; BEGIN EXECUTE p_sql INTO r; RETURN r; EXCEPTION WHEN OTHERS THEN RETURN 'EROARE ' || SQLSTATE; END $f$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('clona.n', (current_setting('clona.n')::int + 1)::text, true);
  IF p_cond IS TRUE THEN RAISE NOTICE 'OK  %', p_msg;
  ELSE PERFORM set_config('clona.esec', (current_setting('clona.esec')::int + 1)::text, true); RAISE NOTICE 'NU  %', p_msg; END IF;
END $f$;
CREATE FUNCTION pg_temp.egal(p_x text, p_y text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM pg_temp.ok(p_x IS NOT DISTINCT FROM p_y, p_msg || ' → ' || coalesce(p_x, 'NULL') || CASE WHEN p_x IS DISTINCT FROM p_y THEN ' (astepta ' || coalesce(p_y, 'NULL') || ')' ELSE '' END); END $f$;
-- un rezultat jsonb comparat structural (cheile în orice ordine)
CREATE FUNCTION pg_temp.ej(p_sql text, p_astept jsonb, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r text := pg_temp.v(p_sql);
BEGIN PERFORM pg_temp.ok(r IS NOT NULL AND r !~ '^EROARE' AND r::jsonb = p_astept, p_msg || ' → ' || coalesce(r, 'NULL') || ' (astepta ' || p_astept::text || ')'); END $f$;
-- textul apelului de rezervare (implicit: fișierul a…, conținutul b…, bucata 1 / 3, 50 de rânduri, 10.000 octeți, 8.000 ieșire → 0,104 USD rezervați)
CREATE FUNCTION pg_temp.rz(p_cheie uuid, p_proiect uuid, p_continut text DEFAULT repeat('b', 64), p_bucata integer DEFAULT 1, p_fisier text DEFAULT repeat('a', 64)) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT public.fn_red_import_ai_rezerva(%L::uuid, %L::uuid, %L, %L, %s, 3, 50, 10000, 8000)::text', p_cheie, p_proiect, p_fisier, p_continut, p_bucata)
$f$;
CREATE FUNCTION pg_temp.inc(p_id text, p_token text, p_stare text, p_semnale text, p_respinse text, p_tin text, p_tout text, p_cod text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT public.fn_red_import_ai_inchide(%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s)::text', quote_nullable(p_id), quote_nullable(p_token), quote_nullable(p_stare),
                coalesce(p_semnale, 'NULL'), coalesce(p_respinse, 'NULL'), coalesce(p_tin, 'NULL'), coalesce(p_tout, 'NULL'), quote_nullable(p_cod))
$f$;
CREATE FUNCTION pg_temp.nr(p_unde text) RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE n integer; BEGIN EXECUTE 'SELECT count(*)::int FROM public.red_import_ai_jurnal WHERE ' || p_unde INTO n; RETURN n; END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.ca(uuid, text), pg_temp.st(text), pg_temp.v(text), pg_temp.ok(boolean, text), pg_temp.egal(text, text, text), pg_temp.ej(text, jsonb, text),
  pg_temp.rz(uuid, uuid, text, integer, text), pg_temp.inc(text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;

-- ── fixture SINTETIC (postgres). Conturile: a1 owner, a2 admin Redări fără drept, a3 editor cu drept (b1, b2, b3, b4), a4 viewer cu drept (b1),
--    a5 fără nivel Redări cu drept (b1), a6 alt editor fără drept. Proiectele: b1 activ, b2 INACTIV, b3 plafonul de apeluri, b4 plafonul de cost,
--    b5 fără drepturi. ──
DO $fixture$
BEGIN
  INSERT INTO auth.users (id, email) SELECT ('1131a100-0000-4000-8000-0000000000a' || x)::uuid, 'clona-ai-' || x || '@example.invalid' FROM generate_series(1, 6) x;
  -- role explicit (profiles_role_chk din producție); triggerul auth poate crea deja rândul
  INSERT INTO public.profiles (id, email, name, role, is_owner)
    SELECT ('1131a100-0000-4000-8000-0000000000a' || x)::uuid, 'clona-ai-' || x || '@example.invalid', 'CLONA AI SINTETIC ' || x, 'manager_santier', x = 1 FROM generate_series(1, 6) x
    ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, role = EXCLUDED.role, name = EXCLUDED.name;
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('1131a100-0000-4000-8000-0000000000a2', 'redari', 'admin'), ('1131a100-0000-4000-8000-0000000000a3', 'redari', 'editor'),
    ('1131a100-0000-4000-8000-0000000000a4', 'redari', 'viewer'), ('1131a100-0000-4000-8000-0000000000a5', 'hr', 'admin'),
    ('1131a100-0000-4000-8000-0000000000a6', 'redari', 'editor');
  INSERT INTO public.red_proiecte (id, cod, denumire, activ) VALUES
    ('1131a100-0000-4000-8000-0000000000b1', 'TEST-AI-CLONA-1', 'Proba clona AI (sintetic) 1', true),
    ('1131a100-0000-4000-8000-0000000000b2', 'TEST-AI-CLONA-2', 'Proba clona AI (sintetic) inactiv', false),
    ('1131a100-0000-4000-8000-0000000000b3', 'TEST-AI-CLONA-3', 'Proba clona AI (sintetic) plafon apeluri', true),
    ('1131a100-0000-4000-8000-0000000000b4', 'TEST-AI-CLONA-4', 'Proba clona AI (sintetic) plafon cost', true),
    ('1131a100-0000-4000-8000-0000000000b5', 'TEST-AI-CLONA-5', 'Proba clona AI (sintetic) fara drepturi', true);
  INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES
    ('1131a100-0000-4000-8000-0000000000b1', '1131a100-0000-4000-8000-0000000000a3', 'import_verificare_ai'),
    ('1131a100-0000-4000-8000-0000000000b2', '1131a100-0000-4000-8000-0000000000a3', 'import_verificare_ai'),
    ('1131a100-0000-4000-8000-0000000000b3', '1131a100-0000-4000-8000-0000000000a3', 'import_verificare_ai'),
    ('1131a100-0000-4000-8000-0000000000b4', '1131a100-0000-4000-8000-0000000000a3', 'import_verificare_ai'),
    ('1131a100-0000-4000-8000-0000000000b1', '1131a100-0000-4000-8000-0000000000a4', 'import_verificare_ai'),
    ('1131a100-0000-4000-8000-0000000000b1', '1131a100-0000-4000-8000-0000000000a5', 'import_verificare_ai');
END $fixture$;
-- id-urile sintetice ca variabile psql (folosite citate: două puncte + numele între apostrofuri = literal SQL citat de psql)
\set OW 1131a100-0000-4000-8000-0000000000a1
\set AD 1131a100-0000-4000-8000-0000000000a2
\set ED 1131a100-0000-4000-8000-0000000000a3
\set VI 1131a100-0000-4000-8000-0000000000a4
\set FA 1131a100-0000-4000-8000-0000000000a5
\set E2 1131a100-0000-4000-8000-0000000000a6
\set P1 1131a100-0000-4000-8000-0000000000b1
\set P2 1131a100-0000-4000-8000-0000000000b2
\set P3 1131a100-0000-4000-8000-0000000000b3
\set P4 1131a100-0000-4000-8000-0000000000b4
\set P5 1131a100-0000-4000-8000-0000000000b5
\set SINT 'proiect_id::text LIKE ''1131a100-%'''

-- ── A. dreptul (o singură definiție) ──
SELECT pg_temp.ca(:'OW', 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'true', 'A owner pe b1');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P5')), 'true', 'A owner pe proiect fara drepturi');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P2')), 'false', 'A owner pe proiect INACTIV');
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'true', 'A editor cu drept');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P5')), 'false', 'A editor pe proiect fara dreptul lui');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P2')), 'false', 'A editor cu drept pe proiect inactiv');
SELECT pg_temp.ca(:'E2', 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'false', 'A alt editor fara drept');
SELECT pg_temp.ca(:'VI', 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'false', 'A viewer cu rand de drept (nivelul nu ajunge)');
SELECT pg_temp.ca(:'FA', 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'false', 'A fara nivel Redari, cu rand de drept');
SELECT pg_temp.ca(:'AD', 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'false', 'A admin Redari fara drept');
SELECT pg_temp.ca(NULL, 'authenticated');
SELECT pg_temp.egal(pg_temp.v(format('SELECT public.fn_red_import_ai_poate(%L)::text', :'P1')), 'false', 'A fara sub in JWT');
SELECT pg_temp.ca(NULL, 'anon');
SELECT pg_temp.egal(pg_temp.st(format('SELECT public.fn_red_import_ai_poate(%L)', :'P1')), '42501', 'A anon cheama fn_red_import_ai_poate');

-- ── B. rezervarea: refuzurile (fără scriere), cheia de intenție, plafoanele la limită ──
SELECT pg_temp.ca(NULL, 'postgres');
SELECT set_config('clona.n0', pg_temp.nr(:'SINT')::text, true);
SELECT pg_temp.ca(:'E2', 'authenticated');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P1'), '{"ok":false,"cod":"fara_drept"}', 'B alt editor fara drept');
SELECT pg_temp.ca(:'VI', 'authenticated');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P1'), '{"ok":false,"cod":"fara_drept"}', 'B viewer cu rand de drept');
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P2'), '{"ok":false,"cod":"fara_drept"}', 'B proiect inactiv');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P1', 'xyz'), '{"ok":false,"cod":"cerere_invalida"}', 'B amprenta continutului invalida');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P1', repeat('b', 64), 4), '{"ok":false,"cod":"cerere_invalida"}', 'B bucata > bucati');
SELECT pg_temp.ca(NULL, 'authenticated');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P1'), '{"ok":false,"cod":"neautentificat"}', 'B fara sub in JWT');
SELECT pg_temp.ca(NULL, 'anon');
SELECT pg_temp.egal(pg_temp.st(pg_temp.rz(gen_random_uuid(), :'P1')), '42501', 'B anon cheama rezerva');
SELECT pg_temp.ca(NULL, 'service_role');
SELECT pg_temp.egal(pg_temp.st(pg_temp.rz(gen_random_uuid(), :'P1')), '42501', 'B service_role cheama rezerva (decizia nu e a lui)');
SELECT pg_temp.ca(NULL, 'postgres');
SELECT pg_temp.egal(pg_temp.nr(:'SINT')::text, current_setting('clona.n0'), 'B refuzurile n-au scris in jurnal');
-- cheia de intenție
SELECT set_config('clona.k1', gen_random_uuid()::text, true);
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT set_config('clona.r1', pg_temp.v(pg_temp.rz(current_setting('clona.k1')::uuid, :'P1')), true);
SELECT pg_temp.ok((current_setting('clona.r1')::jsonb ->> 'nou') = 'true' AND (current_setting('clona.r1')::jsonb ->> 'cost_rezervat_usd')::numeric = 0.104
  AND current_setting('clona.r1')::jsonb ->> 'model' = 'claude-sonnet-5-5'
  AND (current_setting('clona.r1')::jsonb ->> 'ziua')::date = (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date,
  'B rezervarea editorului: nou, cost 0,104 = ((10000 + 2000) x 2 + 8000 x 10) / 1e6, modelul, ziua Bucuresti → ' || current_setting('clona.r1'));
SELECT pg_temp.ej(pg_temp.rz(current_setting('clona.k1')::uuid, :'P1'),
  jsonb_build_object('ok', true, 'nou', false, 'id', current_setting('clona.r1')::jsonb ->> 'id', 'stare', 'rezervat'), 'B aceeasi cheie = randul existent, nou:false (fara al doilea apel platit)');
SELECT pg_temp.ej(pg_temp.rz(current_setting('clona.k1')::uuid, :'P1', repeat('e', 64)), '{"ok":false,"cod":"cheie_refolosita"}', 'B aceeasi cheie, alt continut');
SELECT pg_temp.ca(:'OW', 'authenticated');
SELECT pg_temp.ej(pg_temp.rz(current_setting('clona.k1')::uuid, :'P1'), '{"ok":false,"cod":"cheie_refolosita"}', 'B aceeasi cheie, alt cont');
SELECT pg_temp.ca(NULL, 'postgres');
SELECT pg_temp.egal(pg_temp.nr(format('cheie = %L', current_setting('clona.k1')))::text, '1', 'B un singur rand pe cheie');
SELECT pg_temp.egal((SELECT user_id::text FROM public.red_import_ai_jurnal WHERE cheie = current_setting('clona.k1')::uuid), '1131a100-0000-4000-8000-0000000000a3', 'B user_id = sub-ul din JWT');
-- plafonul pe CONȚINUT: 2 / zi pe același continut_sha256, oricare ar fi fișierul / bucata / cheia
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.ok((pg_temp.v(pg_temp.rz(gen_random_uuid(), :'P1', repeat('c', 64), 2, repeat('f', 64)))::jsonb ->> 'nou') = 'true', 'B continutul c, primul apel (bucata 2, alt fisier)');
SELECT pg_temp.ok((pg_temp.v(pg_temp.rz(gen_random_uuid(), :'P1', repeat('c', 64), 3))::jsonb ->> 'nou') = 'true', 'B continutul c, al doilea apel (bucata 3, cheie noua)');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P1', repeat('c', 64), 1, repeat('0', 64)), '{"ok":false,"cod":"plafon_bucata_zi","limita":2}', 'B continutul c, al treilea apel (alt fisier / bucata) = refuz');
SELECT pg_temp.ok((pg_temp.v(pg_temp.rz(gen_random_uuid(), :'P1', repeat('d', 64)))::jsonb ->> 'nou') = 'true', 'B alt continut pe aceeasi bucata = permis');
-- plafonul de APELURI: 59 de rânduri azi + 30 ieri pe b3 → al 60-lea trece, al 61-lea nu
SELECT pg_temp.ca(NULL, 'postgres');
INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model, cost_rezervat_usd, lease_token)
  SELECT gen_random_uuid(), :'P3'::uuid, :'OW'::uuid, (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date - CASE WHEN g > 59 THEN 1 ELSE 0 END, repeat('c', 64), md5(g::text) || md5(g::text), 1, 1, 1, 1, 1,
         'claude-sonnet-5-5', 0.00001, gen_random_uuid()
    FROM generate_series(1, 89) g;
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.ok((pg_temp.v(pg_temp.rz(gen_random_uuid(), :'P3'))::jsonb ->> 'nou') = 'true', 'B al 60-lea apel al zilei pe b3');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P3', repeat('e', 64)), '{"ok":false,"cod":"plafon_apeluri_zi","limita":60}', 'B al 61-lea apel al zilei = refuz');
-- plafonul de COST: un apel „necunoscut” de 9,95 rezervați azi pe b4 → 9,95 + 0,104 > 10 = refuz; unul ok cu final 1 nu ar opri (proba PGlite)
SELECT pg_temp.ca(NULL, 'postgres');
INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model, cost_rezervat_usd,
    lease_token, stare, inchis_la, eroare_cod)
  VALUES (gen_random_uuid(), :'P4', :'OW', (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date, repeat('c', 64), repeat('9', 64), 1, 1, 1, 1, 1, 'claude-sonnet-5-5', 9.95,
    gen_random_uuid(), 'necunoscut', clock_timestamp(), 'test');
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.ej(pg_temp.rz(gen_random_uuid(), :'P4'), '{"ok":false,"cod":"plafon_cost_zi","limita_usd":10}', 'B cost: necunoscutul conteaza cu costul rezervat (9,95 + 0,104 > 10)');

-- ── C. închiderea: doar service_role; CAS; r3: ok = respinse 0, incomplet = respinse >= 1 ──
SELECT set_config('clona.id1', current_setting('clona.r1')::jsonb ->> 'id', true), set_config('clona.tk1', current_setting('clona.r1')::jsonb ->> 'lease_token', true);
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.egal(pg_temp.st(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'ok', '1', '0', '1', '1', NULL)), '42501', 'C authenticated cheama inchide');
SELECT pg_temp.ca(NULL, 'anon');
SELECT pg_temp.egal(pg_temp.st(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'ok', '1', '0', '1', '1', NULL)), '42501', 'C anon cheama inchide');
SELECT pg_temp.ca(NULL, 'service_role');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), gen_random_uuid()::text, 'ok', '1', '0', '1', '1', NULL)), 'false', 'C token gresit');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'ok', '3', '1', '1', '1', NULL)), 'false', 'C r3 ok cu respinse 1');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'incomplet', '0', '0', '1', '1', NULL)), 'false', 'C r3 incomplet cu respinse 0');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'incomplet', '0', '2', NULL, NULL, NULL)), 'false', 'C r3 incomplet fara tokeni');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'incomplet', '0', '2', '1', '1', 'x')), 'false', 'C r3 incomplet cu cod de eroare');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'eroare', NULL, NULL, NULL, NULL, NULL)), 'false', 'C eroare fara cod');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'altceva', NULL, NULL, NULL, NULL, 'x')), 'false', 'C stare necunoscuta');
SELECT pg_temp.egal(pg_temp.v(format('SELECT stare FROM public.red_import_ai_jurnal WHERE id = %L', current_setting('clona.id1'))), 'rezervat', 'C parametrii invalizi n-au schimbat randul');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'incomplet', '3', '1', '5000', '300', NULL)), 'true', 'C r3 inchiderea incomplet (respinse 1)');
SELECT pg_temp.egal(pg_temp.v(format('SELECT stare || ''|'' || semnale || ''|'' || respinse || ''|'' || cost_usd || ''|'' || cost_rezervat_usd FROM public.red_import_ai_jurnal WHERE id = %L', current_setting('clona.id1'))),
  'incomplet|3|1|0.013000|0.104000', 'C r3 randul incomplet: costul final cunoscut (5000 x 2 + 300 x 10 = 0,013)');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.id1'), current_setting('clona.tk1'), 'eroare', NULL, NULL, NULL, NULL, 'a_doua')), 'false', 'C a doua inchidere (deja incomplet)');
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT set_config('clona.r2', pg_temp.v(pg_temp.rz(gen_random_uuid(), :'P1', repeat('6', 64))), true);
SELECT pg_temp.ca(NULL, 'service_role');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.r2')::jsonb ->> 'id', current_setting('clona.r2')::jsonb ->> 'lease_token', 'ok', '0', '0', '4000', '100', NULL)), 'true', 'C inchiderea ok (gol valid, respinse 0)');
SELECT pg_temp.egal(pg_temp.v(format('SELECT stare || ''|'' || respinse || ''|'' || cost_usd FROM public.red_import_ai_jurnal WHERE id = %L', current_setting('clona.r2')::jsonb ->> 'id')),
  'ok|0|0.009000', 'C randul ok: respinse 0, cost 0,009');
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT set_config('clona.r3', pg_temp.v(pg_temp.rz(gen_random_uuid(), :'P1', repeat('7', 64))), true);
SELECT pg_temp.ca(NULL, 'service_role');
SELECT pg_temp.egal(pg_temp.v(pg_temp.inc(current_setting('clona.r3')::jsonb ->> 'id', current_setting('clona.r3')::jsonb ->> 'lease_token', 'necunoscut', '1', '1', '10', '10', 'ai_usage_lipsa')), 'true', 'C inchiderea necunoscut');
SELECT pg_temp.egal(pg_temp.v(format('SELECT stare || ''|'' || coalesce(cost_usd::text, ''NULL'') || ''|'' || coalesce(tokeni_in::text, ''NULL'') FROM public.red_import_ai_jurnal WHERE id = %L', current_setting('clona.r3')::jsonb ->> 'id')),
  'necunoscut|NULL|NULL', 'C necunoscut: costul ramane cel rezervat (cost_usd NULL, tokenii NULL)');
-- CHECK-ul tabelei, independent de funcție (postgres scrie direct)
SELECT pg_temp.ca(NULL, 'postgres');
SELECT pg_temp.egal(pg_temp.st(format($q$INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model,
    cost_rezervat_usd, lease_token, stare, inchis_la, semnale, respinse, tokeni_in, tokeni_out, cost_usd) VALUES (gen_random_uuid(), %L, %L, current_date, repeat('a', 64), repeat('b', 64), 1, 1, 1, 1, 1,
    'claude-sonnet-5-5', 1, gen_random_uuid(), 'ok', clock_timestamp(), 0, 1, 1, 1, 0.00001)$q$, :'P5', :'OW')), '23514', 'C r3 CHECK: ok cu respinse 1 (scriere directa)');
SELECT pg_temp.egal(pg_temp.st(format($q$INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model,
    cost_rezervat_usd, lease_token, stare, inchis_la, semnale, respinse, tokeni_in, tokeni_out, cost_usd) VALUES (gen_random_uuid(), %L, %L, current_date, repeat('a', 64), repeat('b', 64), 1, 1, 1, 1, 1,
    'claude-sonnet-5-5', 1, gen_random_uuid(), 'incomplet', clock_timestamp(), 0, 0, 1, 1, 0.00001)$q$, :'P5', :'OW')), '23514', 'C r3 CHECK: incomplet cu respinse 0 (scriere directa)');

-- ── D. RLS ca NON-OWNER (citiri) + E. istoricul drepturilor ──
SELECT pg_temp.ca(NULL, 'postgres');
SELECT set_config('clona.totp1', pg_temp.nr(format('proiect_id = %L', :'P1'))::text, true);
DELETE FROM public.red_proiect_drepturi WHERE proiect_id = :'P1' AND profile_id = :'FA';   -- o retragere (urma în istoric)
SELECT pg_temp.egal((SELECT string_agg(actiune || ':' || n, ',' ORDER BY actiune) FROM (SELECT actiune, count(*) n FROM public.red_proiect_drepturi_istoric WHERE proiect_id::text LIKE '1131a100-%' GROUP BY 1) z),
  'acordat:6,retras:1', 'E istoricul: 6 acordari + 1 retragere (sintetice)');
SELECT pg_temp.egal((SELECT count(*)::text FROM public.red_jurnal WHERE tabela = 'red_proiect_drepturi'), '0', 'E nimic despre drepturi in red_jurnal (nici pe clona)');
CREATE FUNCTION pg_temp.vede(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text; BEGIN EXECUTE p_sql INTO r; RETURN coalesce(r, ''); EXCEPTION WHEN OTHERS THEN RETURN 'EROARE ' || SQLSTATE; END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.vede(text) TO authenticated, anon, service_role;
\set JP1 'SELECT count(*)::text FROM public.red_import_ai_jurnal WHERE proiect_id = ''1131a100-0000-4000-8000-0000000000b1'''
\set DR 'SELECT string_agg(right(profile_id::text, 2) || ''@'' || right(proiect_id::text, 2), '','' ORDER BY proiect_id, profile_id) FROM public.red_proiect_drepturi WHERE proiect_id::text LIKE ''1131a100-%'''
\set IST 'SELECT string_agg(right(profile_id::text, 2) || ''@'' || right(proiect_id::text, 2) || '':'' || actiune, '','' ORDER BY proiect_id, profile_id, actiune) FROM public.red_proiect_drepturi_istoric WHERE proiect_id::text LIKE ''1131a100-%'''
\set JRD 'SELECT count(*)::text FROM public.red_jurnal WHERE tabela = ''red_proiect_drepturi'''
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.egal(pg_temp.vede(:'JP1'), current_setting('clona.totp1'), 'D jurnalul b1: editorul cu drept il vede');
SELECT pg_temp.egal(pg_temp.vede(:'DR'), 'a3@b1,a3@b2,a3@b3,a3@b4', 'D drepturile: editorul isi vede doar randurile lui');
SELECT pg_temp.egal(pg_temp.vede(:'IST'), 'a3@b1:acordat,a3@b2:acordat,a3@b3:acordat,a3@b4:acordat', 'D istoricul: editorul isi vede doar randurile lui');
SELECT pg_temp.ca(:'OW', 'authenticated');
SELECT pg_temp.egal(pg_temp.vede(:'JP1'), current_setting('clona.totp1'), 'D jurnalul b1: owner-ul il vede');
SELECT pg_temp.ca(:'E2', 'authenticated');
SELECT pg_temp.egal(pg_temp.vede(:'JP1'), '0', 'D jurnalul b1: alt editor (fara drept) nu vede nimic');
SELECT pg_temp.egal(pg_temp.vede(:'DR'), '', 'D drepturile: alt editor nu vede nimic');
SELECT pg_temp.egal(pg_temp.vede(:'IST'), '', 'D istoricul: alt editor nu vede istoricul altuia');
SELECT pg_temp.egal(pg_temp.vede(:'JRD'), '0', 'D red_jurnal: alt editor nu vede nicio copie a drepturilor');
SELECT pg_temp.ca(:'VI', 'authenticated');
SELECT pg_temp.egal(pg_temp.vede(:'JP1'), '0', 'D jurnalul b1: viewerul (cu rand de drept) nu il vede');
SELECT pg_temp.egal(pg_temp.vede(:'DR'), 'a4@b1', 'D drepturile: viewerul isi vede doar randul lui');
SELECT pg_temp.egal(pg_temp.vede(:'IST'), 'a4@b1:acordat', 'D istoricul: viewerul isi vede doar randul lui');
SELECT pg_temp.egal(pg_temp.vede(:'JRD'), '0', 'D red_jurnal: viewerul nu vede nicio copie a drepturilor');
SELECT pg_temp.ca(:'AD', 'authenticated');
SELECT pg_temp.egal(pg_temp.vede(:'JP1'), '0', 'D jurnalul b1: adminul Redari fara drept nu il vede');
SELECT pg_temp.egal(pg_temp.vede(:'DR'), 'a3@b1,a4@b1,a3@b2,a3@b3,a3@b4', 'D drepturile: adminul Redari le vede pe toate (cele sintetice)');
SELECT pg_temp.egal((SELECT count(*)::text FROM unnest(string_to_array(pg_temp.vede(:'IST'), ','))), '7', 'D istoricul: adminul Redari vede toate cele 7 randuri sintetice');
SELECT pg_temp.ca(NULL, 'authenticated');
SELECT pg_temp.egal(pg_temp.vede(:'JP1') || '|' || pg_temp.vede(:'DR') || '|' || pg_temp.vede(:'IST'), '0||', 'D fara sub in JWT: nimic');
SELECT pg_temp.ca(NULL, 'anon');
SELECT pg_temp.egal(pg_temp.vede(:'JP1'), 'EROARE 42501', 'D anon citeste jurnalul AI');
SELECT pg_temp.egal(pg_temp.vede(:'DR'), 'EROARE 42501', 'D anon citeste drepturile');
SELECT pg_temp.egal(pg_temp.vede(:'IST'), 'EROARE 42501', 'D anon citeste istoricul');
-- scrierile directe: niciun drept pentru rolurile aplicației (owner, editor, service_role); istoricul append-only și pentru postgres
SELECT pg_temp.ca(:'OW', 'authenticated');
SELECT pg_temp.egal(pg_temp.st(format('INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES (%L, %L, ''import_verificare_ai'')', :'P5', :'OW')), '42501', 'D owner: INSERT drept (auto-acordare)');
SELECT pg_temp.egal(pg_temp.st('UPDATE public.red_import_ai_jurnal SET stare = ''ok'' WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'D owner: UPDATE jurnal');
SELECT pg_temp.egal(pg_temp.st('DELETE FROM public.red_proiect_drepturi_istoric WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'D owner: DELETE istoric');
SELECT pg_temp.ca(:'ED', 'authenticated');
SELECT pg_temp.egal(pg_temp.st(format('INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES (%L, %L, ''import_verificare_ai'')', :'P5', :'ED')), '42501', 'D editor: INSERT drept');
SELECT pg_temp.egal(pg_temp.st('DELETE FROM public.red_import_ai_jurnal WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'D editor: DELETE jurnal');
SELECT pg_temp.egal(pg_temp.st(format('INSERT INTO public.red_proiect_drepturi_istoric (drept_id, proiect_id, profile_id, drept, actiune) VALUES (gen_random_uuid(), %L, %L, ''import_verificare_ai'', ''acordat'')', :'P5', :'ED')), '42501', 'D editor: INSERT istoric');
SELECT pg_temp.ca(NULL, 'service_role');
SELECT pg_temp.egal(pg_temp.st(format('INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES (%L, %L, ''import_verificare_ai'')', :'P5', :'E2')), '42501', 'D service_role: INSERT drept');
SELECT pg_temp.egal(pg_temp.st('DELETE FROM public.red_import_ai_jurnal WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'D service_role: DELETE jurnal');
SELECT pg_temp.egal(pg_temp.st('UPDATE public.red_proiect_drepturi_istoric SET actiune = ''acordat'' WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'D service_role: UPDATE istoric');
SELECT pg_temp.ca(NULL, 'postgres');
SELECT pg_temp.egal(pg_temp.st('UPDATE public.red_proiect_drepturi_istoric SET actiune = ''acordat'' WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'E postgres: UPDATE istoric refuzat (append-only)');
SELECT pg_temp.egal(pg_temp.st('DELETE FROM public.red_proiect_drepturi_istoric WHERE proiect_id::text LIKE ''1131a100-%'''), '42501', 'E postgres: DELETE istoric refuzat');
SELECT pg_temp.egal(pg_temp.st(format('UPDATE public.red_proiect_drepturi SET nota = ''x'' WHERE proiect_id = %L', :'P1')), '42501', 'E postgres: UPDATE drept refuzat (schimbarea = DELETE + INSERT)');

-- ── rezultatul ──
DO $rezultat$
BEGIN
  RAISE NOTICE 'CLONA 20261131j: verificari=% esec=% verdict=%', current_setting('clona.n'), current_setting('clona.esec'),
    CASE WHEN current_setting('clona.esec') = '0' AND current_setting('clona.n')::int > 0 THEN 'OK' ELSE 'ESEC' END;
END $rezultat$;
ROLLBACK;
