-- ════════════════════════════════════════════════════════════════════════════
-- Test PG16 local pentru patch-ul 20261003b (Ofertare, constatările (2) și (3)).
-- Se rulează DOAR prin scripts/test_sec_ofertare.sh, pe clusterul dedicat (127.0.0.1:5441,
-- PGDATA /tmp/pg_sec_ofertare), baza `sec_ofertare_test`. Nu atinge Supabase.
--
-- Fazele (psql -v faza=…):
--   setup        schelet minim + funcțiile LIVE din 29.09 (copiate cu pg_get_functiondef,
--                verificate byte cu byte prin md5) + ACL-ul live + harness-ul de test
--   gaura        dovedește bypass-ul pe starea live (înainte de patch / după rollback tehnic)
--   patched      teste obligatorii pe patch (apeluri directe + trasee legitime)
--   operational  după revenirea operațională: poarta rămâne închisă, logica veche revine
--
-- Identități simulate ca în PostgREST: SET ROLE authenticated/anon/service_role +
-- request.jwt.claims (auth.uid() citește `sub`).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

\set UID_OWNER  '00000000-0000-4000-8000-000000000121'
\set UID_MOD    '00000000-0000-4000-8000-000000000007'
\set UID_NOMOD  '00000000-0000-4000-8000-000000000099'
\set UID_VIEWER '00000000-0000-4000-8000-000000000055'
\set ca_postgres 'RESET ROLE; RESET request.jwt.claims;'
\set ca_anon     'RESET ROLE; SET request.jwt.claims TO ''{"role":"anon"}''; SET ROLE anon;'
\set ca_fara_uid 'RESET ROLE; SET request.jwt.claims TO ''{"role":"authenticated"}''; SET ROLE authenticated;'
\set ca_service  'RESET ROLE; SET request.jwt.claims TO ''{"role":"service_role"}''; SET ROLE service_role;'
\set ca_nemod    'RESET ROLE; SET request.jwt.claims TO ''{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}''; SET ROLE authenticated;'
\set ca_mod      'RESET ROLE; SET request.jwt.claims TO ''{"sub":"00000000-0000-4000-8000-000000000007","role":"authenticated"}''; SET ROLE authenticated;'
\set ca_owner    'RESET ROLE; SET request.jwt.claims TO ''{"sub":"00000000-0000-4000-8000-000000000121","role":"authenticated"}''; SET ROLE authenticated;'
\set ca_viewer   'RESET ROLE; SET request.jwt.claims TO ''{"sub":"00000000-0000-4000-8000-000000000055","role":"authenticated"}''; SET ROLE authenticated;'

SELECT (:'faza' = 'setup') AS f_setup, (:'faza' = 'gaura') AS f_gaura,
       (:'faza' = 'patched') AS f_patched, (:'faza' = 'operational') AS f_oper,
       (:'faza' IN ('setup', 'gaura', 'patched', 'operational')) AS f_valid \gset
\if :f_valid
\else
  \echo 'faza necunoscută: folosește setup | gaura | patched | operational'
  SELECT 1/0;
\endif

-- Gardă: doar pe baza dedicată, PG16, login postgres.
DO $garda$ BEGIN
  IF current_database() <> 'sec_ofertare_test' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::int / 10000 <> 16 THEN
    RAISE EXCEPTION 'Testul rulează doar pe baza dedicată sec_ofertare_test (PG16, login postgres).';
  END IF;
END $garda$;

-- ════════════════════════════════════════════════════════════════════════════
\if :f_setup
\echo '== SETUP: schelet + funcțiile LIVE din 29.09 + harness =='
DO $gol$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 't', 'extensions')) THEN
    RAISE EXCEPTION 'Baza trebuie să fie goală (scriptul o recreează).';
  END IF;
END $gol$;

DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Capcana Supabase: default privileges dau EXECUTE lui anon pe funcțiile NOI din public.
-- O migrare care ar face DROP + CREATE (în loc de CREATE OR REPLACE) ar reda anon-ului
-- execuția; testul P0 o prinde.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE SCHEMA extensions;
CREATE EXTENSION pg_trgm SCHEMA extensions;

-- Schelet minim: doar coloanele pe care le ating funcțiile, fluxurile UI testate și politicile.
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'viewer')),
  UNIQUE (profile_id, module));
CREATE TABLE public.ofertare_cerinte (
  id bigint PRIMARY KEY,
  licitatie_id bigint NOT NULL,
  text_cerinta text NOT NULL,
  inlocuita_de bigint,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ofertare_acoperire (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE,
  mod text NOT NULL DEFAULT 'firma',
  status text NOT NULL DEFAULT 'in_lucru',
  referinta_text text,
  motiv text,
  observatii text,
  verificat_pe_scan boolean NOT NULL DEFAULT false,
  valabil_la_depunere boolean,
  reverificare_ceruta boolean NOT NULL DEFAULT false,
  reverificare_motiv text,
  pozitie_id bigint,
  ales boolean NOT NULL DEFAULT false,
  ales_de uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX ofertare_acoperire_o_aleasa_pe_pozitie
  ON public.ofertare_acoperire (cerinta_id, COALESCE(pozitie_id, (0)::bigint)) WHERE ales;
CREATE TABLE public.ofertare_inventar_ai (
  id bigint PRIMARY KEY,
  doc_id integer NOT NULL DEFAULT 1,
  licitatie_id integer,
  furnizor text NOT NULL,
  model text NOT NULL DEFAULT 'test',
  versiune integer NOT NULL DEFAULT 1,
  nr integer,
  pasaj text,
  obligatie text NOT NULL,
  pereche_cerinta_id integer REFERENCES public.ofertare_cerinte(id) ON DELETE SET NULL,
  verdict text,
  verdict_de uuid,
  verdict_la timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

-- fn_are_acces_ofertare(): copia LIVE (md5 verificat mai jos).
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$
;

-- Starea „ÎNAINTE”: cele 2 funcții LIVE din 29.09, copiate cu pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
 RETURNS TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cerinta bigint;
  v_pozitie bigint;
  v_vechi   bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să alegi o variantă de acoperire.';
  END IF;
  SELECT a.cerinta_id, a.pozitie_id INTO v_cerinta, v_pozitie
  FROM ofertare_acoperire a WHERE a.id = p_acoperire_id;
  IF v_cerinta IS NULL THEN
    RAISE EXCEPTION 'Varianta % nu există.', p_acoperire_id;
  END IF;
  SELECT a.id INTO v_vechi
  FROM ofertare_acoperire a
  WHERE a.cerinta_id = v_cerinta AND a.ales
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.id <> p_acoperire_id;
  UPDATE ofertare_acoperire a
  SET ales = false, ales_de = NULL, updated_at = now()
  WHERE a.cerinta_id = v_cerinta
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.ales AND a.id <> p_acoperire_id;
  UPDATE ofertare_acoperire a
  SET ales = true, ales_de = auth.uid(), updated_at = now()
  WHERE a.id = p_acoperire_id;
  RETURN QUERY SELECT v_cerinta, v_pozitie, p_acoperire_id, v_vechi;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ofertare_inventar_pereche(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45)
 RETURNS TABLE(imperecheate integer, ramase_fara_pereche integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_furnizor text; v_versiune int;
BEGIN
  -- implicit: cea mai recenta rulare a furnizorului cerut (sau a oricaruia) pe licitatia asta
  SELECT i.furnizor, i.versiune INTO v_furnizor, v_versiune
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic
    AND (p_furnizor IS NULL OR i.furnizor = p_furnizor)
    AND (p_versiune IS NULL OR i.versiune = p_versiune)
  ORDER BY i.versiune DESC, i.id DESC LIMIT 1;
  IF v_furnizor IS NULL THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;

  WITH inv AS (
    SELECT i.id, left(coalesce(i.obligatie, i.pasaj, ''), 2000) AS t
    FROM ofertare_inventar_ai i
    WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune
  ), cer AS (
    SELECT c.id, left(c.text_cerinta, 2000) AS t
    FROM ofertare_cerinte c
    WHERE c.licitatie_id = p_lic AND c.inlocuita_de IS NULL
  ), best AS (
    SELECT inv.id AS inv_id,
           (SELECT cer.id FROM cer
             WHERE similarity(cer.t, inv.t) >= p_prag
             ORDER BY similarity(cer.t, inv.t) DESC, cer.id LIMIT 1) AS cer_id
    FROM inv WHERE length(inv.t) > 0
  )
  UPDATE ofertare_inventar_ai i
     SET pereche_cerinta_id = b.cer_id,
         verdict = CASE WHEN b.cer_id IS NOT NULL THEN 'acoperit' ELSE 'lipsa_din_registru' END
    FROM best b
   WHERE i.id = b.inv_id
     AND i.verdict IS DISTINCT FROM 'confirmat_de_om';  -- ce a decis omul nu se rescrie

  RETURN QUERY
  SELECT count(*) FILTER (WHERE i.pereche_cerinta_id IS NOT NULL)::int,
         count(*) FILTER (WHERE i.pereche_cerinta_id IS NULL)::int
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune;
END $function$
;

-- ACL-ul LIVE din 29.09: {postgres, service_role, authenticated}; fără PUBLIC, fără anon.
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO service_role, authenticated;

-- RLS ca în live (pg_policies, 29.09): SELECT = uid logat; scriere = fn_are_acces_ofertare().
ALTER TABLE public.ofertare_acoperire   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_inventar_ai ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_cerinte     ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_acoperire_select ON public.ofertare_acoperire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_acoperire_insert ON public.ofertare_acoperire FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_acoperire_update ON public.ofertare_acoperire FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_acoperire_delete ON public.ofertare_acoperire FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_inventar_ai_sel ON public.ofertare_inventar_ai FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_inventar_ai_upd ON public.ofertare_inventar_ai FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_cerinte_select ON public.ofertare_cerinte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_cerinte_insert ON public.ofertare_cerinte FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_cerinte_update ON public.ofertare_cerinte FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_cerinte_delete ON public.ofertare_cerinte FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
-- Grant-urile largi de tabel ca în Supabase (RLS e cel care filtrează).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_acoperire, public.ofertare_inventar_ai, public.ofertare_cerinte TO anon, authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- ── Harness ────────────────────────────────────────────────────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE FUNCTION t.ok(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST EȘUAT: %', p_label; END IF;
  RAISE NOTICE 'OK  %', p_label;
END $$;
-- Rulează p_sql cu identitatea curentă; trebuie să cadă cu p_state și un mesaj care conține p_fragment.
CREATE FUNCTION t.expect_error(p_sql text, p_state text, p_fragment text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'TEST EȘUAT: % — trebuia refuzat, dar a trecut: %', p_label, p_sql;
  END IF;
  IF v_state <> p_state OR position(p_fragment IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST EȘUAT: % — așteptam % „%”, am primit % „%”', p_label, p_state, p_fragment, v_state, v_msg;
  END IF;
  RAISE NOTICE 'OK  % [% %]', p_label, v_state, v_msg;
END $$;
CREATE FUNCTION t.expect_ok(p_sql text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE 'OK  %', p_label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'TEST EȘUAT: % — % %', p_label, SQLSTATE, SQLERRM;
END $$;
CREATE FUNCTION t.rows_affected(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION t.ok(boolean, text), t.expect_error(text, text, text, text),
  t.expect_ok(text, text), t.rows_affected(text) TO anon, authenticated, service_role;

-- Instantanee (rulate ca postgres): orice atingere a unui rând schimbă textul (inclusiv updated_at).
CREATE FUNCTION t.acop_snapshot() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(format('%s|%s|%s|%s|%s', id, ales, coalesce(ales_de::text, '-'), coalesce(pozitie_id::text, '-'), updated_at), ';' ORDER BY id)
  FROM public.ofertare_acoperire $$;
CREATE FUNCTION t.inv_snapshot() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(format('%s|%s|%s|%s|%s', id, coalesce(pereche_cerinta_id::text, '-'), coalesce(verdict, '-'), coalesce(verdict_de::text, '-'), coalesce(verdict_la::text, '-')), ';' ORDER BY id)
  FROM public.ofertare_inventar_ai $$;
CREATE FUNCTION t.inv_row(p_id bigint) RETURNS text LANGUAGE sql AS $$
  SELECT format('%s|%s|%s|%s', coalesce(pereche_cerinta_id::text, '-'), coalesce(verdict, '-'), coalesce(verdict_de::text, '-'), coalesce(verdict_la::text, '-'))
  FROM public.ofertare_inventar_ai WHERE id = p_id $$;

-- Fixture: 4 identități, 2 licitații cu dovezi alese de colegi, un inventar AI cu verdicte umane.
CREATE FUNCTION t.reset_fixture() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.ofertare_inventar_ai, public.ofertare_acoperire, public.ofertare_cerinte,
           public.user_module_access, public.profiles RESTART IDENTITY CASCADE;
  INSERT INTO public.profiles (id, is_owner) VALUES
    ('00000000-0000-4000-8000-000000000121', true),   -- owner
    ('00000000-0000-4000-8000-000000000007', false),  -- are modulul ofertare (editor)
    ('00000000-0000-4000-8000-000000000099', false),  -- NU are ofertare (are logistica)
    ('00000000-0000-4000-8000-000000000055', false);  -- ofertare cu access_level viewer
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    ('00000000-0000-4000-8000-000000000007', 'ofertare',  'editor'),
    ('00000000-0000-4000-8000-000000000099', 'logistica', 'editor'),
    ('00000000-0000-4000-8000-000000000055', 'ofertare',  'viewer');
  INSERT INTO public.ofertare_cerinte (id, licitatie_id, text_cerinta, inlocuita_de) VALUES
    (101, 10, 'Ofertantul trebuie sa detina autorizatie ANRE tip EDIB pentru executia retelelor de distributie gaze naturale', NULL),
    (102, 10, 'Ofertantul trebuie sa prezinte certificat ISO 9001 privind sistemul de management al calitatii', NULL),
    (103, 10, 'Cerinta veche inlocuita: autorizatie ANRE tip EDIB pentru retele de gaze', 101),
    (201, 20, 'Licitatia Jilava: responsabil tehnic cu executia atestat', NULL),
    (301, 30, 'Experienta similara: minim un contract de retele gaze', NULL);
  INSERT INTO public.ofertare_acoperire (id, cerinta_id, mod, status, referinta_text, pozitie_id, ales, ales_de, updated_at) VALUES
    (1001, 101, 'personal', 'acoperit', 'dovada aleasa de colegul cu modul', NULL, true,  '00000000-0000-4000-8000-000000000007', '2026-09-20 10:00+00'),
    (1002, 101, 'personal', 'acoperit', 'candidat 2', NULL, false, NULL, '2026-09-20 10:00+00'),
    (1003, 101, 'firma',    'acoperit', 'candidat 3', NULL, false, NULL, '2026-09-20 10:00+00'),
    (1011, 102, 'personal', 'acoperit', 'pozitia 1, aleasa', 1, true,  '00000000-0000-4000-8000-000000000007', '2026-09-20 10:00+00'),
    (1012, 102, 'personal', 'acoperit', 'pozitia 2, aleasa', 2, true,  '00000000-0000-4000-8000-000000000121', '2026-09-20 10:00+00'),
    (1013, 102, 'personal', 'acoperit', 'pozitia 1, candidat', 1, false, NULL, '2026-09-20 10:00+00'),
    (2001, 201, 'personal', 'acoperit', 'Jilava candidat', NULL, false, NULL, '2026-09-20 10:00+00'),
    (2002, 201, 'personal', 'acoperit', 'Jilava ales de owner', NULL, true, '00000000-0000-4000-8000-000000000121', '2026-09-20 10:00+00');
  INSERT INTO public.ofertare_inventar_ai (id, licitatie_id, furnizor, versiune, nr, obligatie, pereche_cerinta_id, verdict, verdict_de, verdict_la) VALUES
    (1, 10, 'gemini', 1, 1, 'Autorizatie ANRE tip EDIB pentru executia retelelor de distributie gaze naturale', NULL, NULL, NULL, NULL),
    (2, 10, 'gemini', 1, 2, 'Graficul de livrare a echipamentelor va fi transmis in termen de cinci zile lucratoare', NULL, NULL, NULL, NULL),
    (3, 10, 'gemini', 1, 3, 'Plata facturilor se face in 30 de zile de la receptie', NULL, 'respins_de_om', '00000000-0000-4000-8000-000000000007', '2026-09-20 10:00+00'),
    (4, 10, 'gemini', 1, 4, 'Garantia de buna executie este de 10% din valoarea contractului', NULL, 'confirmat_de_om', '00000000-0000-4000-8000-000000000007', '2026-09-20 10:00+00'),
    (5, 10, 'gemini', 1, 5, 'Ofertantul trebuie sa prezinte certificat ISO 9001 privind sistemul de management al calitatii', NULL, NULL, NULL, NULL),
    (6, 10, 'gemini', 1, 6, 'Personalul de santier va purta echipament de protectie', NULL, 'respins_de_om', NULL, '2026-09-20 10:00+00'),
    (7, 10, 'gemini', 1, 7, 'Ofertantul va prezenta lista subcontractantilor si partea din contract subcontractata', 102, 'acoperit', '00000000-0000-4000-8000-000000000007', '2026-09-20 10:00+00'),
    (20, 10, 'openai', 1, 1, 'Autorizatie ANRE tip EDIB pentru executia retelelor de distributie gaze naturale', NULL, NULL, NULL, NULL),
    (30, 20, 'gemini', 1, 1, 'Autorizatie ANRE tip EDIB pentru executia retelelor de distributie gaze naturale', NULL, NULL, NULL, NULL);
END $$;

-- Copia e byte-identică cu live (md5 citit read-only din Supabase pe 29.09, PG 17.6).
SELECT t.ok(md5(pg_get_functiondef('public.fn_are_acces_ofertare()'::regprocedure)) = '6991b618d5fabbefdbd14684d335db48', 'S0 fn_are_acces_ofertare: copia locală = live (md5)');
SELECT t.ok(md5(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) = '6c9995646a6dbe6da995e48a3a885fc9', 'S0 fn_ofertare_alege_acoperire: copia locală = live (md5)');
SELECT t.ok(md5(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure)) = '500263dacba2b44e0caa1cb07db88d6e', 'S0 ofertare_inventar_pereche: copia locală = live (md5)');
SELECT t.ok(NOT has_function_privilege('anon', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE')
        AND NOT has_function_privilege('public', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE'), 'S0 ACL ca în live (fără PUBLIC/anon)');
SELECT t.reset_fixture();
\echo '== SETUP gata =='
\endif

-- ════════════════════════════════════════════════════════════════════════════
\if :f_gaura
\echo '== GAURA: starea live din 29.09 permite bypass-ul (dovadă) =='
:ca_postgres
SELECT t.reset_fixture();
SELECT t.ok(md5(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) = '6c9995646a6dbe6da995e48a3a885fc9', 'G0 alege = exact starea live din 29.09 (md5)');
SELECT t.ok(md5(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure)) = '500263dacba2b44e0caa1cb07db88d6e', 'G0 pereche = exact starea live din 29.09 (md5)');

-- G1: calea directă (REST pe tabel) e închisă de RLS pentru contul fără modul…
:ca_nemod
SELECT t.ok(t.rows_affected('UPDATE public.ofertare_acoperire SET ales = false WHERE id = 1001') = 0, 'G1 fără modul: UPDATE direct pe ofertare_acoperire = 0 rânduri (RLS)');
-- …dar RPC-ul SECURITY DEFINER o ocolește.
SELECT t.expect_ok('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', 'G1 fără modul: RPC alege_acoperire TRECE (bypass)');
SELECT t.expect_ok('SELECT * FROM public.fn_ofertare_alege_acoperire(2001)', 'G1 fără modul: RPC pe altă licitație (Jilava) TRECE (bypass)');
:ca_postgres
SELECT t.ok((SELECT ales AND ales_de = :'UID_NOMOD' FROM public.ofertare_acoperire WHERE id = 1002), 'G1 1002 ales și semnat de contul FĂRĂ modul');
SELECT t.ok((SELECT NOT ales AND ales_de IS NULL FROM public.ofertare_acoperire WHERE id = 1001), 'G1 alegerea colegului (1001) s-a pierdut fără urmă');
SELECT t.ok((SELECT ales AND ales_de = :'UID_NOMOD' FROM public.ofertare_acoperire WHERE id = 2001), 'G1 Jilava: alegerea owner-ului înlocuită de contul fără modul');

-- G2: împerecherea nu are nicio poartă; p_prag=0 face golurile să dispară.
SELECT t.reset_fixture();
:ca_nemod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, 0)', 'G2 fără modul: pereche cu p_prag=0 TRECE (bypass)');
:ca_postgres
SELECT t.ok((SELECT count(*) FROM public.ofertare_inventar_ai WHERE licitatie_id = 10 AND furnizor = 'gemini' AND verdict = 'lipsa_din_registru') = 0, 'G2 p_prag=0: nicio obligație nu mai apare „lipsă” (golurile dispar)');
SELECT t.ok((SELECT verdict FROM public.ofertare_inventar_ai WHERE id = 3) = 'acoperit', 'G2 p_prag=0: „respins_de_om” (rând 3) rescris în „acoperit”');

-- G3: și în folosire NORMALĂ (utilizator cu modul, prag implicit) respingerea omului se pierde.
SELECT t.reset_fixture();
SELECT t.inv_row(7) AS r7 \gset
:ca_mod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1)', 'G3 cu modul, apel ca în UI');
:ca_postgres
SELECT t.ok((SELECT verdict FROM public.ofertare_inventar_ai WHERE id = 3) = 'lipsa_din_registru', 'G3 „respins_de_om” rescris în folosire normală (bug-ul constatării 3)');
SELECT t.ok(t.inv_row(7) <> :'r7', 'G3 rândul semnat de om (verdict_de) rescris');

-- G4: fără uid (authenticated fără sub) pereche trece — nu există nicio poartă.
SELECT t.reset_fixture();
:ca_fara_uid
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10)', 'G4 fără uid: pereche TRECE (nicio poartă)');
:ca_anon
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'permission denied', 'G5 anon: fără EXECUTE (ACL-ul live era corect)');
:ca_postgres
\echo '== GAURA dovedită =='
\endif

-- ════════════════════════════════════════════════════════════════════════════
\if :f_patched
\echo '== PATCHED: teste obligatorii =='
:ca_postgres
SELECT t.reset_fixture();

-- P0: ACL, SECURITY DEFINER, search_path, poarta prezentă.
SELECT t.ok(NOT has_function_privilege('anon', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE'), 'P0 anon fără EXECUTE pe alege_acoperire');
SELECT t.ok(NOT has_function_privilege('anon', 'public.ofertare_inventar_pereche(bigint,text,integer,real)', 'EXECUTE'), 'P0 anon fără EXECUTE pe inventar_pereche');
SELECT t.ok(NOT has_function_privilege('public', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE')
        AND NOT has_function_privilege('public', 'public.ofertare_inventar_pereche(bigint,text,integer,real)', 'EXECUTE'), 'P0 PUBLIC fără EXECUTE pe ambele');
SELECT t.ok(has_function_privilege('authenticated', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.ofertare_inventar_pereche(bigint,text,integer,real)', 'EXECUTE'), 'P0 authenticated păstrează EXECUTE (UI-ul merge)');
SELECT t.ok((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'])
               FROM pg_proc p WHERE p.oid IN ('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure,
                                              'public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure)),
            'P0 SECURITY DEFINER + search_path = public, pg_temp (pct. 4)');
SELECT t.ok((SELECT count(*) FROM pg_proc WHERE proname IN ('fn_ofertare_alege_acoperire', 'ofertare_inventar_pereche')) = 2, 'P0 fără supraîncărcări noi (aceleași semnături)');

SELECT t.acop_snapshot() AS s_acop, t.inv_snapshot() AS s_inv \gset

-- P1: anon — fără EXECUTE (apel direct).
:ca_anon
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'permission denied', 'P1 anon → alege_acoperire refuzat (fără EXECUTE)');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, 0)', '42501', 'permission denied', 'P1 anon → inventar_pereche refuzat (fără EXECUTE)');

-- P2: non-owner FĂRĂ modulul Ofertare (are alt modul) — apel direct, cu 42501.
:ca_nemod
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'modulul Ofertare', 'P2 fără modul → alege_acoperire 42501');
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(2001)', '42501', 'modulul Ofertare', 'P2 fără modul → alege_acoperire pe Jilava 42501');
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(999999)', '42501', 'modulul Ofertare', 'P2 fără modul → id inexistent tot 42501 (poarta e înaintea existenței)');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, 0)', '42501', 'modulul Ofertare', 'P2 fără modul → inventar_pereche cu p_prag=0 42501');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10)', '42501', 'modulul Ofertare', 'P2 fără modul → inventar_pereche implicit 42501');

-- P3: fără uid (authenticated fără sub) și service_role fără uid — refuz, nu „sistem” (S-A).
:ca_fara_uid
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'autentificat', 'P3 fără uid → alege_acoperire 42501');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10)', '42501', 'autentificat', 'P3 fără uid → inventar_pereche 42501');
:ca_service
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'autentificat', 'P3 service_role fără uid → alege_acoperire 42501 (nicio ramură „sistem”)');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10)', '42501', 'autentificat', 'P3 service_role fără uid → inventar_pereche 42501');
:ca_postgres
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10)', '42501', 'autentificat', 'P3 postgres fără uid (SQL editor) → inventar_pereche 42501');
SELECT t.ok(t.acop_snapshot() = :'s_acop', 'P1–P3 niciun refuz n-a atins ofertare_acoperire');
SELECT t.ok(t.inv_snapshot() = :'s_inv', 'P1–P3 niciun refuz n-a atins ofertare_inventar_ai');

-- P4: traseu legitim — utilizator CU modul alege altă variantă (butonul „alege” din OfertareCerinte).
:ca_mod
SELECT cerinta_id AS r_cer, coalesce(pozitie_id::text, 'NULL') AS r_poz, ales_id AS r_ales, coalesce(inlocuit_id::text, 'NULL') AS r_inl
  FROM public.fn_ofertare_alege_acoperire(1002) \gset
:ca_postgres
SELECT t.ok(:'r_cer' = '101' AND :'r_poz' = 'NULL' AND :'r_ales' = '1002' AND :'r_inl' = '1001', 'P4 cu modul: întoarce (101, NULL, 1002, 1001) ca înainte');
SELECT t.ok((SELECT ales AND ales_de = :'UID_MOD' FROM public.ofertare_acoperire WHERE id = 1002), 'P4 proveniența: 1002 ales, ales_de = cine a ales');
SELECT t.ok((SELECT NOT ales AND ales_de IS NULL FROM public.ofertare_acoperire WHERE id = 1001), 'P4 1001 scos (ca înainte)');
SELECT t.ok((SELECT count(*) FROM public.ofertare_acoperire WHERE cerinta_id = 101 AND ales) = 1, 'P4 o singură aleasă pe cerință');

-- P5: owner (fără rând în user_module_access).
:ca_owner
SELECT coalesce(inlocuit_id::text, 'NULL') AS r_inl FROM public.fn_ofertare_alege_acoperire(1003) \gset
:ca_postgres
SELECT t.ok(:'r_inl' = '1002' AND (SELECT ales AND ales_de = :'UID_OWNER' FROM public.ofertare_acoperire WHERE id = 1003), 'P5 owner: alege 1003, semnat owner, înlocuiește 1002');

-- P6: pozițiile rămân independente; realegerea e idempotentă.
:ca_mod
SELECT coalesce(inlocuit_id::text, 'NULL') AS r_inl FROM public.fn_ofertare_alege_acoperire(1013) \gset
:ca_postgres
SELECT t.ok(:'r_inl' = '1011' AND (SELECT NOT ales FROM public.ofertare_acoperire WHERE id = 1011)
        AND (SELECT ales AND ales_de = :'UID_OWNER' FROM public.ofertare_acoperire WHERE id = 1012), 'P6 poziția 1 schimbată, poziția 2 (owner) neatinsă');
:ca_mod
SELECT coalesce(inlocuit_id::text, 'NULL') AS r_inl FROM public.fn_ofertare_alege_acoperire(1013) \gset
:ca_postgres
SELECT t.ok(:'r_inl' = 'NULL' AND (SELECT ales FROM public.ofertare_acoperire WHERE id = 1013), 'P6 realegerea aceleiași variante: idempotentă, nimic înlocuit');

-- P7: cu modul, id inexistent → eroarea de business de dinainte (P0001), neschimbată.
:ca_mod
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(999999)', 'P0001', 'nu există', 'P7 cu modul: id inexistent → „Varianta … nu există.” (ca înainte)');

-- P8: traseu legitim OfertareCerinte „folosește” din registru: INSERT (RLS) + RPC.
:ca_postgres
SELECT t.reset_fixture();
:ca_mod
INSERT INTO public.ofertare_acoperire (cerinta_id, pozitie_id, status, verificat_pe_scan, referinta_text, motiv, mod)
  VALUES (101, NULL, 'acoperit', false, 'Popescu Ion — autorizatie ANRE', 'ales manual din registrul firmei', 'personal')
  RETURNING id AS r_nou \gset
SELECT coalesce(inlocuit_id::text, 'NULL') AS r_inl FROM public.fn_ofertare_alege_acoperire(:r_nou) \gset
:ca_postgres
SELECT t.ok(:'r_inl' = '1001' AND (SELECT ales AND ales_de = :'UID_MOD' FROM public.ofertare_acoperire WHERE id = :r_nou), 'P8 flux OfertareCerinte (insert + alege): merge, înlocuiește 1001');

-- P9: traseu legitim OfertareLicitatii alegeCandidat: UPDATE rândul existent (RLS) + RPC.
:ca_mod
SELECT t.ok(t.rows_affected('UPDATE public.ofertare_acoperire SET mod = ''firma'', status = ''acoperit'', referinta_text = ''ales manual de coleg · ISO'', reverificare_ceruta = false, reverificare_motiv = NULL, updated_at = now() WHERE id = 2002') = 1, 'P9 cu modul: UPDATE direct permis de RLS');
SELECT t.expect_ok('SELECT * FROM public.fn_ofertare_alege_acoperire(2002)', 'P9 flux OfertareLicitatii (update + alege)');
:ca_postgres
SELECT t.ok((SELECT ales AND ales_de = :'UID_MOD' FROM public.ofertare_acoperire WHERE id = 2002), 'P9 2002 rămâne ales, acum semnat de cine a confirmat');

-- P10: calea directă rămâne închisă de RLS pentru contul fără modul (context, neschimbat).
:ca_nemod
SELECT t.ok(t.rows_affected('UPDATE public.ofertare_acoperire SET ales = false WHERE id = 1001') = 0, 'P10 fără modul: UPDATE direct = 0 rânduri (RLS)');
SELECT t.expect_error('INSERT INTO public.ofertare_acoperire (cerinta_id, mod) VALUES (101, ''firma'')', '42501', 'row-level security', 'P10 fără modul: INSERT direct refuzat (RLS)');

-- P11: inventar — traseu legitim (apelul exact din UI: p_lic, p_furnizor, p_versiune).
:ca_postgres
SELECT t.reset_fixture();
SELECT t.inv_row(3) AS r3, t.inv_row(4) AS r4, t.inv_row(6) AS r6, t.inv_row(7) AS r7, t.inv_row(20) AS r20, t.inv_row(30) AS r30 \gset
:ca_mod
SELECT imperecheate AS r_imp, ramase_fara_pereche AS r_ram FROM public.ofertare_inventar_pereche(10, 'gemini', 1) \gset
:ca_postgres
SELECT t.ok(:'r_imp' = '3' AND :'r_ram' = '4', 'P11 cu modul, apel ca în UI: întoarce (3 regăsite, 4 fără pereche)');
SELECT t.ok(t.inv_row(1) = '101|acoperit|-|-', 'P11 rând 1 → acoperit de cerința 101');
SELECT t.ok(t.inv_row(2) = '-|lipsa_din_registru|-|-', 'P11 rând 2 → lipsă din registru (golul rămâne vizibil)');
SELECT t.ok(t.inv_row(5) = '102|acoperit|-|-', 'P11 rând 5 → acoperit de 102');
SELECT t.ok(t.inv_row(3) = :'r3', 'P11 respins_de_om (cu verdict_de) NEATINS');
SELECT t.ok(t.inv_row(4) = :'r4', 'P11 confirmat_de_om NEATINS');
SELECT t.ok(t.inv_row(6) = :'r6', 'P11 respins_de_om fără verdict_de (profil lipsă în UI) NEATINS');
SELECT t.ok(t.inv_row(7) = :'r7', 'P11 rând semnat de om (verdict_de) NEATINS');
SELECT t.ok(t.inv_row(20) = :'r20' AND t.inv_row(30) = :'r30', 'P11 alt furnizor / altă licitație neatinse');

-- P12: prag limitat — p_prag=0 (atacul) se comportă ca pragul minim 0.30: golul rămâne.
:ca_postgres
SELECT t.reset_fixture();
:ca_mod
SELECT imperecheate AS r_imp, ramase_fara_pereche AS r_ram FROM public.ofertare_inventar_pereche(10, 'gemini', 1, 0) \gset
:ca_postgres
SELECT t.ok(:'r_imp' = '3' AND :'r_ram' = '4' AND t.inv_row(2) = '-|lipsa_din_registru|-|-', 'P12 p_prag=0 limitat la 0.30: golul (rând 2) rămâne „lipsă”');
SELECT t.ok(t.inv_row(3) = :'r3' AND t.inv_row(6) = :'r6', 'P12 p_prag=0: respingerile omului neatinse');
:ca_mod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, -5)', 'P12 p_prag negativ acceptat, limitat');
:ca_postgres
SELECT t.ok(t.inv_row(2) = '-|lipsa_din_registru|-|-', 'P12 p_prag=-5 limitat la 0.30');

-- P13: limita de sus — p_prag=2 limitat la 0.95 (textul identic se regăsește, cel de 0.75 nu).
SELECT t.reset_fixture();
:ca_mod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, 2)', 'P13 p_prag=2');
:ca_postgres
SELECT t.ok(t.inv_row(5) = '102|acoperit|-|-' AND t.inv_row(1) = '-|lipsa_din_registru|-|-', 'P13 p_prag=2 limitat la 0.95');
SELECT t.reset_fixture();
:ca_mod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, ''NaN'')', 'P13 p_prag=NaN');
:ca_postgres
SELECT t.ok(t.inv_row(5) = '102|acoperit|-|-' AND t.inv_row(1) = '-|lipsa_din_registru|-|-', 'P13 p_prag=NaN tratat ca 0.95');

-- P14: p_prag NULL → 0.45 (înainte: NULL ⇒ nimic regăsit).
SELECT t.reset_fixture();
:ca_mod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, NULL)', 'P14 p_prag=NULL');
:ca_postgres
SELECT t.ok(t.inv_row(1) = '101|acoperit|-|-' AND t.inv_row(2) = '-|lipsa_din_registru|-|-', 'P14 p_prag=NULL → 0.45 (ca implicitul)');

-- P15: owner trece; furnizorul ales explicit nu atinge alt furnizor; implicitul (fără furnizor) merge.
SELECT t.reset_fixture();
:ca_owner
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''openai'', 1)', 'P15 owner: pereche pe openai');
:ca_postgres
SELECT t.ok(t.inv_row(20) = '101|acoperit|-|-' AND t.inv_row(1) = '-|-|-|-', 'P15 doar rularea openai atinsă');
:ca_mod
SELECT imperecheate AS r_imp FROM public.ofertare_inventar_pereche(99) \gset
:ca_postgres
SELECT t.ok(:'r_imp' = '0', 'P15 licitație fără inventar → (0, 0), ca înainte');

-- P16: rezidual documentat — fn_are_acces_ofertare() nu citește access_level: un „viewer”
-- pe Ofertare trece (la fel ca prin RLS). Nu schimbăm aici semantica porții comune.
SELECT t.reset_fixture();
:ca_viewer
SELECT t.expect_ok('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', 'P16 REZIDUAL: viewer pe Ofertare trece poarta (semantica fn_are_acces_ofertare, la fel ca RLS)');
:ca_postgres
\echo '== PATCHED: toate testele au trecut =='
\endif

-- ════════════════════════════════════════════════════════════════════════════
\if :f_oper
\echo '== REVENIRE OPERAȚIONALĂ: poarta rămâne, logica veche revine =='
:ca_postgres
SELECT t.reset_fixture();
SELECT t.ok(position('SEC-20261003b-OPERATIONAL' IN pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) > 0
        AND position('SEC-20261003b-OPERATIONAL' IN pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure)) > 0, 'O0 starea operațională e activă');
SELECT t.ok(NOT has_function_privilege('anon', 'public.fn_ofertare_alege_acoperire(bigint)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.ofertare_inventar_pereche(bigint,text,integer,real)', 'EXECUTE'), 'O0 anon fără EXECUTE');
SELECT t.acop_snapshot() AS s_acop, t.inv_snapshot() AS s_inv \gset
:ca_nemod
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'modulul Ofertare', 'O1 fără modul → alege_acoperire 42501 (poarta păstrată)');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, 0)', '42501', 'modulul Ofertare', 'O1 fără modul → inventar_pereche 42501 (poarta păstrată)');
:ca_fara_uid
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'autentificat', 'O1 fără uid → 42501');
SELECT t.expect_error('SELECT * FROM public.ofertare_inventar_pereche(10)', '42501', 'autentificat', 'O1 fără uid → pereche 42501');
:ca_anon
SELECT t.expect_error('SELECT * FROM public.fn_ofertare_alege_acoperire(1002)', '42501', 'permission denied', 'O1 anon → fără EXECUTE');
:ca_postgres
SELECT t.ok(t.acop_snapshot() = :'s_acop' AND t.inv_snapshot() = :'s_inv', 'O1 refuzurile n-au atins nimic');
:ca_mod
SELECT coalesce(inlocuit_id::text, 'NULL') AS r_inl FROM public.fn_ofertare_alege_acoperire(1002) \gset
:ca_postgres
SELECT t.ok(:'r_inl' = '1001' AND (SELECT ales AND ales_de = :'UID_MOD' FROM public.ofertare_acoperire WHERE id = 1002), 'O2 cu modul: alegerea merge');
:ca_owner
SELECT t.expect_ok('SELECT * FROM public.fn_ofertare_alege_acoperire(1003)', 'O2 owner: alegerea merge');
:ca_mod
SELECT imperecheate AS r_imp, ramase_fara_pereche AS r_ram FROM public.ofertare_inventar_pereche(10, 'gemini', 1) \gset
:ca_postgres
SELECT t.ok(:'r_imp'::int + :'r_ram'::int = 7, 'O3 cu modul: împerecherea merge (apel ca în UI)');
-- Ce se pierde, asumat, în revenirea operațională (doar pentru cine ARE modulul):
SELECT t.ok((SELECT verdict FROM public.ofertare_inventar_ai WHERE id = 3) = 'lipsa_din_registru', 'O4 ASUMAT: logica veche rescrie din nou respins_de_om');
SELECT t.reset_fixture();
:ca_mod
SELECT t.expect_ok('SELECT * FROM public.ofertare_inventar_pereche(10, ''gemini'', 1, 0)', 'O4 ASUMAT: cu modul, p_prag=0 e din nou acceptat');
:ca_postgres
SELECT t.ok((SELECT count(*) FROM public.ofertare_inventar_ai WHERE licitatie_id = 10 AND furnizor = 'gemini' AND verdict = 'lipsa_din_registru') = 0, 'O4 ASUMAT: cu p_prag=0 golurile dispar (doar pentru utilizatorii cu modul)');
\echo '== REVENIRE OPERAȚIONALĂ: poarta confirmată =='
\endif
