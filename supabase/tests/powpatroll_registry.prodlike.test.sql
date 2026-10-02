-- ============================================================================
-- Teste „prod-like” — PowPatroll registry (migrarea 20261008a) cu adminul simulat al producției.
-- Rulare: scripts/test_powpatroll_registry.sh (faza A), cu SET SESSION AUTHORIZATION pp_sim_postgres:
-- rol NOSUPERUSER + CREATEROLE + BYPASSRLS, proprietarul bazei — ca postgres din Supabase (citit read-only
-- din producție la 29.09: rolsuper=false, rolcreaterole=true, rolbypassrls=true, createrole_self_grant='').
-- Verifică „frâna”: după migrare adminul NU mai are drepturile ownerului (doar SELECT + EXECUTE pe RPC),
-- iar singura cale de ocolire e să-și reacorde explicit rolul (ADMIN) — deci detecția rămâne lanțul.
-- Totul într-o tranzacție încheiată cu ROLLBACK.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

SELECT teste.assert(current_user = 'pp_sim_postgres' AND session_user = 'pp_sim_postgres',
  'P0 rulez ca adminul simulat al producției (pp_sim_postgres)');
SELECT teste.assert((SELECT NOT rolsuper AND rolcreaterole AND rolbypassrls FROM pg_roles WHERE rolname = current_user),
  'P0 adminul simulat e NOSUPERUSER + CREATEROLE + BYPASSRLS, ca postgres din Supabase');

-- ---------------------------------------------------------------- P1: ownership + membru după migrare
SELECT teste.assert((SELECT bool_and(relowner = 'powpatroll_owner'::regrole) FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname LIKE '%powpatroll%' AND relkind IN ('r','v','S')),
  'P1 tabelele, view-ul și secvența aparțin powpatroll_owner (nu adminului)');
SELECT teste.assert((SELECT bool_and(proowner = 'powpatroll_owner'::regrole) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname LIKE '%powpatroll%'),
  'P1 funcțiile aparțin powpatroll_owner');
SELECT teste.assert((SELECT bool_or(admin_option) AND NOT bool_or(inherit_option) AND NOT bool_or(set_option)
    FROM pg_auth_members WHERE roleid = 'powpatroll_owner'::regrole AND member = current_user::regrole),
  'P1 după migrare adminul are doar ADMIN pe powpatroll_owner (INHERIT și SET retrase la final)');
SELECT teste.assert(NOT pg_has_role(current_user, 'powpatroll_owner', 'USAGE') AND NOT pg_has_role(current_user, 'powpatroll_owner', 'SET'),
  'P1 adminul nu moștenește drepturile ownerului și nu poate SET ROLE powpatroll_owner');
SELECT teste.assert(NOT has_schema_privilege('powpatroll_owner', 'public', 'CREATE'),
  'P1 CREATE pe public (necesar doar la ALTER OWNER) retras de la powpatroll_owner');

-- ---------------------------------------------------------------- P2: ce poate adminul (MCP)
SELECT teste.assert(has_table_privilege('public.powpatroll_log', 'SELECT') AND has_table_privilege('public.v_powpatroll_curent', 'SELECT')
    AND has_function_privilege('public.powpatroll_write(integer,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('public.powpatroll_check(integer,text[],text)', 'EXECUTE')
    AND has_function_privilege('public.powpatroll_render(text,integer,text[])', 'EXECUTE'),
  'P2 adminul are SELECT + EXECUTE pe cele 3 RPC-uri');
SELECT teste.assert(NOT has_function_privilege('public.fn_powpatroll_verifica_lant()', 'EXECUTE')
    AND NOT has_function_privilege('public.fn_powpatroll_log_bi()', 'EXECUTE'),
  'P2 adminul NU are EXECUTE pe funcțiile interne');
SELECT teste.assert((public.powpatroll_write(0, 'sesiune_prodlike', '[{"kind":"finding","item_key":"PL-01","status":"OPEN","actor":"claude","title":"Scriere prin RPC ca admin simulat","source":"harness prod-like 03.10"}]'::jsonb)->>'version')::int = 1,
  'P2 scrierea prin powpatroll_write merge (v1)');
SELECT teste.assert((SELECT count(*) = 1 FROM public.powpatroll_log) AND (public.powpatroll_check(1, NULL)->>'status') = 'OK'
    AND public.powpatroll_render('line') LIKE 'POWPATROLL v1 %',
  'P2 citirea directă + check + render merg');

-- ---------------------------------------------------------------- P3: ce NU poate adminul fără pas explicit
SELECT teste.asteapta_eroare($$INSERT INTO public.powpatroll_log (version, kind, item_key, status, actor, title, source, session_id)
  VALUES (2, 'note', 'PL-02', 'LOG', 'claude', 'ocolire RPC', 'harness prod-like', 'sesiune_x')$$,
  'P3 INSERT direct (fără RPC) refuzat: fără privilegiu', '42501');
SELECT teste.asteapta_eroare($$UPDATE public.powpatroll_log SET title = 'modificat'$$, 'P3 UPDATE refuzat', '42501');
SELECT teste.asteapta_eroare($$DELETE FROM public.powpatroll_log$$, 'P3 DELETE refuzat', '42501');
SELECT teste.asteapta_eroare($$TRUNCATE public.powpatroll_log$$, 'P3 TRUNCATE refuzat', '42501');
SELECT teste.asteapta_eroare($$ALTER TABLE public.powpatroll_log DISABLE TRIGGER trg_pp_log_ro$$,
  'P3 dezactivarea triggerului append-only refuzată (doar ownerul)', '42501');
SELECT teste.asteapta_eroare($$CREATE OR REPLACE FUNCTION public.fn_powpatroll_append_only() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'$$,
  'P3 înlocuirea funcției append-only refuzată', '42501');
SELECT teste.asteapta_eroare($$SET session_replication_role = replica$$,
  'P3 session_replication_role=replica (ocolește triggerele) refuzat — parametru doar pentru superuser', '42501');
SELECT teste.asteapta_eroare($$SET ROLE powpatroll_owner$$, 'P3 SET ROLE powpatroll_owner refuzat', '42501');

-- ---------------------------------------------------------------- P4: frâne, nu garanții (documentat)
-- (1) postgres e proprietarul bazei → membru pg_database_owner → proprietarul schemei public → poate DROP
--     tabelele fără să le dețină (verificat read-only în producție: datdba=postgres). E distrugere VIZIBILĂ
--     (P0/render eșuează, ancora din git nu mai are ce verifica), nu falsificare tăcută.
SET CONSTRAINTS ALL IMMEDIATE;   -- golește evenimentele FK amânate de scrierea din P2
SAVEPOINT p4_drop;
DROP TABLE public.powpatroll_log, public.powpatroll_versions CASCADE;
SELECT teste.assert(to_regclass('public.powpatroll_log') IS NULL,
  'P4 FRÂNĂ, nu garanție (1): ownerul schemei public (postgres) poate DROP registry-ul — distrugere vizibilă, nu modificare tăcută');
ROLLBACK TO SAVEPOINT p4_drop;
SELECT teste.assert(to_regclass('public.powpatroll_log') IS NOT NULL AND (SELECT count(*) = 1 FROM public.powpatroll_log),
  'P4 după ROLLBACK TO SAVEPOINT registry-ul e la loc');
-- (2) CREATEROLE + ADMIN: adminul își poate reda explicit SET/INHERIT pe powpatroll_owner.
GRANT powpatroll_owner TO CURRENT_USER WITH SET TRUE;
SELECT teste.assert(pg_has_role(current_user, 'powpatroll_owner', 'SET'),
  'P4 FRÂNĂ, nu garanție (2): adminul (CREATEROLE + ADMIN) își poate reda explicit SET → detecția = lanțul chain_sha + ancora din git');

ROLLBACK;
