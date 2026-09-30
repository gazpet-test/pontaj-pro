-- ============================================================================
-- SEC F1 (P14 din docs/SECURITATE_ADVISORS_2026-09-30.md §3, S09-21 din inventarul whitebox) — 30.09.2026
-- TRUNCATE retras de la anon și authenticated pe TOATĂ schema public + setările implicite (postgres) corectate.
--
-- ⚠ NEAPLICAT. Draft pentru review (Copilot GO/NO-GO) + acordul explicit al lui Răzvan. Nu modifică date.
--
-- Gaura (citită read-only pe producție, 30.09.2026, PG 17.6):
--   * 374 de tabele în public; 332 au TRUNCATE pentru anon, 344 pentru authenticated, 345 pentru cel puțin unul
--     dintre ele (inclusiv profiles și user_module_access — sursa drepturilor de acces). Restul de 29 sunt
--     app_secrets, 11 _backup_* și 17 ofertare_* blindate explicit. Și 129 de view-uri poartă bitul TRUNCATE (inert).
--   * Cauza: pg_default_acl (schema public, rolurile postgres și supabase_admin) dă arwdDxtm — inclusiv D = TRUNCATE
--     — către anon și authenticated la fiecare tabel nou. PUBLIC nu are TRUNCATE nicăieri; niciun grant nu e WITH GRANT OPTION.
--   * TRUNCATE nu trece prin RLS și nu declanșează triggerele de rând. PostgREST/pg_graphql nu îl pot emite, deci
--     azi nu există o cale de exploatare cunoscută — riscul e latent (apărare în profunzime), nu activ.
--   * Regresie zero, verificată: nicio funcție din public/extensions nu conține TRUNCATE (0 rânduri în pg_proc, fără
--     date_trunc), niciun job cron nu îl folosește, iar în src/ supabase/functions/ worker/ nu există TRUNCATE în SQL.
--
-- Tranzacția: UN SINGUR gestionar = scripts/livrare_migrare.sh (psql --single-transaction: marcaj + ACEST fișier +
--   înregistrarea în supabase_migrations.schema_migrations, în aceeași tranzacție). Fișierul NU conține BEGIN/COMMIT.
--   Garda de livrare (start + final) refuză rularea fără marcajul pus de runner în aceeași tranzacție (legat de txid):
--   psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
--
-- Ce face:
--   0. Precondiții fail-closed: toate tabelele din public sunt ale lui postgres (altfel REVOKE ON ALL TABLES ar eșua
--      la jumătate), PUBLIC nu are TRUNCATE (nu îl retragem de la PUBLIC — ar fi o schimbare neanalizată), nu există
--      TRUNCATE WITH GRANT OPTION. Inventar (RAISE NOTICE): fiecare tabel pe care anon / authenticated are TRUNCATE.
--   1. REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated (tabele + view-uri, bitul e inert pe view-uri).
--   2. ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated:
--      tabelele noi create de postgres nu mai primesc TRUNCATE. Setarea implicită a lui supabase_admin NU se poate
--      schimba ca postgres (ALTER DEFAULT PRIVILEGES FOR ROLE cere apartenența la rol) — rămâne consemnată în
--      docs/SEC_F1_F2_PATCH.md ca limită; tabelele create de supabase_admin (rar: platformă) ar primi din nou TRUNCATE.
--   3. Postcondiții: niciun tabel/view din public cu TRUNCATE efectiv (has_table_privilege — include PUBLIC și moștenirea)
--      pentru anon / authenticated / public; setarea implicită a lui postgres pe public fără D pentru anon/authenticated;
--      service_role neatins (369 din 374 înainte = după).
--
-- Rollback: supabase/migrations/20260930i_sec_f1_truncate_revoke_ROLLBACK.sql (readuce exact starea din 30.09: 332 / 344).
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930i_sec_f1_truncate_revoke:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930i: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții + inventar (RAISE NOTICE) — fail-closed, NULL-safe
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  r          record;
  v_n_alt    integer;
  v_n_public integer;
  v_n_grant  integer;
  v_anon     integer := 0;
  v_auth     integer := 0;
  v_total    integer;
  v_sr       integer;
BEGIN
  -- 0a. toate tabelele din public sunt ale lui postgres (REVOKE ON ALL TABLES cere drept de proprietar pe fiecare)
  SELECT count(*) INTO v_n_alt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND pg_get_userbyid(c.relowner)::text IS DISTINCT FROM 'postgres';
  IF v_n_alt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0a: % relații din public nu sunt ale lui postgres — REVOKE ON ALL TABLES ar eșua; se reanalizează', v_n_alt;
  END IF;
  -- 0b. PUBLIC nu are TRUNCATE (analiza din 30.09: 0) — altfel migrarea n-ar închide gaura și trebuie reanalizată
  SELECT count(*) INTO v_n_public
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.grantee = 0 AND a.privilege_type = 'TRUNCATE';
  IF v_n_public IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0b: % tabele au TRUNCATE pentru PUBLIC (analiza: 0) — se reanalizează', v_n_public;
  END IF;
  -- 0c. niciun TRUNCATE WITH GRANT OPTION la anon/authenticated (analiza: 0) — altfel REVOKE simplu nu ar fi suficient
  SELECT count(*) INTO v_n_grant
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.privilege_type = 'TRUNCATE'
     AND a.is_grantable IS TRUE AND a.grantee <> 0 AND pg_get_userbyid(a.grantee)::text IN ('anon', 'authenticated');
  IF v_n_grant IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0c: % granturi TRUNCATE WITH GRANT OPTION la anon/authenticated (analiza: 0) — se reanalizează', v_n_grant;
  END IF;
  -- 0d. inventar: fiecare tabel (relkind r/p) pe care anon / authenticated are TRUNCATE efectiv, în jurnalul livrării
  SELECT count(*) INTO v_total FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  SELECT count(*) INTO v_sr FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('service_role', c.oid, 'TRUNCATE') IS TRUE;
  FOR r IN
    SELECT c.relname::text AS tabel,
           has_table_privilege('anon', c.oid, 'TRUNCATE') IS TRUE          AS anon_t,
           has_table_privilege('authenticated', c.oid, 'TRUNCATE') IS TRUE AS auth_t
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND (has_table_privilege('anon', c.oid, 'TRUNCATE') IS TRUE OR has_table_privilege('authenticated', c.oid, 'TRUNCATE') IS TRUE)
     ORDER BY c.relname
  LOOP
    IF r.anon_t THEN v_anon := v_anon + 1; END IF;
    IF r.auth_t THEN v_auth := v_auth + 1; END IF;
    RAISE NOTICE 'SEC F1 înainte: TRUNCATE pe public.% — anon=% authenticated=%', r.tabel, r.anon_t, r.auth_t;
  END LOOP;
  RAISE NOTICE 'SEC F1 înainte: % tabele în public; cu TRUNCATE: anon=% authenticated=% service_role=% (analiza 30.09: 374 / 332 / 344 / 369)',
    v_total, v_anon, v_auth, v_sr;
  IF v_anon + v_auth IS NOT DISTINCT FROM 0 THEN
    RAISE NOTICE 'SEC F1: niciun tabel cu TRUNCATE pentru anon/authenticated — probabil reaplicare; REVOKE-ul e idempotent';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Retragerea dreptului de pe tot ce există azi (tabele, partiții, view-uri, tabele străine)
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Setările implicite ale lui postgres pe public: tabelele viitoare nu mai primesc TRUNCATE pentru anon/authenticated
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Postcondiții — ÎNAINTE de înregistrare și de COMMIT-ul runnerului (altfel se anulează tot)
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_n      integer;
  v_sr     integer;
  v_total  integer;
  v_def    integer;
BEGIN
  -- 3a. privilegiul EFECTIV (include PUBLIC și moștenirea prin roluri): nicio relație din public cu TRUNCATE pentru anon / authenticated / public
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('anon', c.oid, 'TRUNCATE') IS TRUE
       OR has_table_privilege('authenticated', c.oid, 'TRUNCATE') IS TRUE
       OR has_table_privilege('public', c.oid, 'TRUNCATE') IS TRUE);
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 3a: % relații din public mai au TRUNCATE efectiv pentru anon/authenticated/public (așteptat 0)', v_n;
  END IF;
  -- 3b. setarea implicită a lui postgres pe public (tabele) nu mai conține TRUNCATE pentru anon/authenticated
  SELECT count(*) INTO v_def
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
   WHERE pg_get_userbyid(d.defaclrole)::text = 'postgres' AND n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND a.privilege_type = 'TRUNCATE' AND a.grantee <> 0 AND pg_get_userbyid(a.grantee)::text IN ('anon', 'authenticated');
  IF v_def IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 3b: setarea implicită a lui postgres pe public mai dă TRUNCATE (% intrări) către anon/authenticated', v_def;
  END IF;
  -- 3c. service_role NEATINS: are TRUNCATE pe fiecare tabel pe care îl avea (comparat cu totalul minus cele blindate fără service_role)
  SELECT count(*) INTO v_total FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  SELECT count(*) INTO v_sr FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('service_role', c.oid, 'TRUNCATE') IS TRUE;
  RAISE NOTICE 'SEC F1 după: % tabele în public; TRUNCATE anon=0 authenticated=0 service_role=%', v_total, v_sr;
  IF v_sr IS NULL OR v_sr < v_total - 10 THEN
    RAISE EXCEPTION 'Postcondiție 3c: service_role a rămas cu TRUNCATE pe doar % din % tabele (analiza: 369 din 374) — REVOKE-ul a atins alt rol', v_sr, v_total;
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930i_sec_f1_truncate_revoke:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930i: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
