# SEC F1b (20261006a) — MAINTAIN — delta pentru Copilot — cerere GO/NO-GO

**context_version:** 01.10.2026, branch `claude/f1b-maintain` (din origin/main 613d2fc)
**Artefact:** `supabase/migrations/20261006a_sec_f1b_maintain_revoke.sql` · **sha256:** `cbc95f5b7d7f2ff64811a47b050cbf2be72f8c53906a3d8794e7f9820a125930` (r2)
**Tipar:** identic cu F1 (`20260930i_sec_f1_truncate_revoke.sql`, aplicată) — doar privilegiul MAINTAIN (PG17).

## Starea live (read-only, 01.10, PG 17.6)
- 518 relații în public; **474** cu MAINTAIN pentru anon sau authenticated (345 tabele + 129 view-uri; tabele: anon 309, authenticated 345). Amprenta listei: `dd22247052979de6b3cd0f9bd5b88978` (r2, după #540/#541).
- PUBLIC fără MAINTAIN; niciun WITH GRANT OPTION; toate relațiile sunt ale lui postgres; `pg_maintain` fără membri.
- Default ACL pe public: postgres → `arwdxtm` (F1 a scos D, „m” a rămas); supabase_admin → `arwdDxtm` (postgres NU e membru ⇒ nu se poate schimba, ca la F1).
- Nicio funcție din public cu vacuum/analyze/cluster/reindex/refresh/lock table. Și `storage`, `net` au MAINTAIN — în afara domeniului.

## Ce face
Precondiții (amprenta exactă SAU 0 la reaplicare) → `REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated` → default ACL postgres pe public fără MAINTAIN; supabase_admin doar dacă `pg_has_role(current_user,'supabase_admin','USAGE')` (pe live: nu ⇒ NOTICE) → postcondiții: 0 relații cu MAINTAIN (anon/authenticated/public), default fără m/D, service_role exact ca înainte, TRUNCATE tot 0 (F1 nu regresează), sondă pe tabel nou.

## Riscuri / limite
- **LOCK TABLE … ACCESS EXCLUSIVE rămâne posibil** pe tabelele unde anon/authenticated au UPDATE/DELETE (regula PG: MAINTAIN, UPDATE, DELETE sau TRUNCATE). F1b închide VACUUM/ANALYZE/CLUSTER/REINDEX/REFRESH, nu LOCK. PostgREST nu poate emite LOCK.
- Tabelele create de supabase_admin primesc în continuare MAINTAIN (și TRUNCATE) — risc rezidual OPEN, cere acceptarea lui Răzvan + drift check postflight.
- Precondiția e strictă: orice tabel nou creat până la aplicare schimbă amprenta ⇒ refuz și se reface citirea (comportament dorit).
- Regresie funcțională: niciuna așteptată (nimic din aplicație nu rulează VACUUM/ANALYZE ca authenticated).

## Verificare
- `scripts/test_sec_f1b_maintain.sh`: **PASS** — fixture = lista live (474, md5 identic); refuz fără runner; refuz la relație nouă; runner cod 0 + gate 0e = 0; 0 MAINTAIN, REINDEX/VACUUM refuzate ca authenticated, tabel nou fără MAINTAIN (SELECT păstrat), service_role neatins; reaplicare idempotentă; revenire nearmată refuz, armată → exact lista din 01.10.
- vitest 1082/1082, `npx vite build` OK.

## Cerere
**GO / NO-GO** pentru livrarea `20261006a_sec_f1b_maintain_revoke.sql` (sha256 de mai sus) prin `scripts/livrare_migrare.sh`. Înainte de livrare se recitește amprenta pe live. Aplicarea o face Răzvan.

## Delta r2 (după GO + refuzul runnerului la 0d)
Runnerul a refuzat la precondiția 0d, fără să comită nimic: între timp, #540/#541 au scos MAINTAIN de pe `hr_concediu_tokens`, `trezorerie_conturi` și `trezorerie_extras_linii`. Am recitit lista pe live, doar cu SELECT: **474** relații (anon 309, authenticated 345), md5 `dd22247052979de6b3cd0f9bd5b88978`. Exact cele 3 tabele au ieșit din listă; nimic altceva nu s-a schimbat.
**S-au schimbat doar** amprenta și numerele din precondiție și din comentarii. Logica a rămas aceeași. Fixture-ul de test și lista de revenire (cele 3 tabele scoase, 433+41) au fost aduse la lista nouă. Branch-ul conține merge cu origin/main. Harness-ul trece (PASS), sha256 nou `cbc95f5b7d7f2ff64811a47b050cbf2be72f8c53906a3d8794e7f9820a125930`.

## Migrarea completă
```sql
-- ============================================================================
-- SEC F1b — urmarea lui F1 (20260930i, APLICATĂ). MAINTAIN retras de la anon și authenticated pe TOATĂ schema public
-- + setarea implicită a lui postgres pe public corectată. 01.10.2026.
--
-- ⚠ NEAPLICAT. Draft pentru review (Copilot GO/NO-GO) + acordul explicit al lui Răzvan. Nu modifică date.
--
-- Gaura (citită read-only pe producție dxczwkbciseqniprspcu, 01.10.2026, PG 17.6):
--   * PG17 a introdus privilegiul MAINTAIN (bitul „m”): VACUUM, ANALYZE, CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW
--     și LOCK TABLE. F1 a scos doar TRUNCATE (D). NOTĂ: LOCK TABLE … ACCESS EXCLUSIVE rămâne posibil și după F1b pe
--     tabelele unde rolul are UPDATE/DELETE (regula PG: MAINTAIN, UPDATE, DELETE sau TRUNCATE) — nu se închide aici.
--   * 518 relații în public (381 tabele); 474 au MAINTAIN pentru anon sau authenticated: 345 tabele + 129 view-uri
--     (anon 309 tabele, authenticated 345; recitit după #540/#541). Amprenta listei: md5 = dd22247052979de6b3cd0f9bd5b88978 (vezi 0d).
--   * Cauza: pg_default_acl pe public — postgres dă arwdxtm (F1 a scos D, „m” a rămas), supabase_admin dă arwdDxtm.
--   * PUBLIC nu are MAINTAIN; niciun grant WITH GRANT OPTION; toate relațiile din public sunt ale lui postgres;
--     pg_maintain nu are membri. PostgREST/pg_graphql nu pot emite VACUUM/LOCK ⇒ risc latent (apărare în profunzime).
--   * Regresie zero, verificată: nicio funcție din public nu conține vacuum/analyze/cluster/reindex/refresh/lock table
--     (0 rânduri); edge functions și workerul folosesc service_role (neatins); src/ nu emite SQL.
--
-- Tranzacția: UN SINGUR gestionar = scripts/livrare_migrare.sh. Fișierul NU conține BEGIN/COMMIT. Garda de livrare la
--   start și la final (marcaj legat de txid). apply_migration / execute_sql MCP / psql -f simplu sunt refuzate.
--
-- Ce face:
--   0. Precondiții fail-closed: rulează ca postgres; toate relațiile din public sunt ale lui postgres; PUBLIC fără MAINTAIN;
--      fără MAINTAIN WITH GRANT OPTION la anon/authenticated; LISTA EXACTĂ (amprenta 0d) = cea live din 01.10 SAU deja
--      0 (reaplicare idempotentă). O relație nouă cu MAINTAIN ⇒ refuz și se recitește lista. Inventar în RAISE NOTICE.
--   1. REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated (tabele, view-uri, matview-uri, străine).
--   2. ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM anon, authenticated.
--      supabase_admin: DOAR dacă postgres poate acționa ca supabase_admin (pg_has_role … 'USAGE'); pe live NU poate
--      (verificat 01.10: false) ⇒ se sare, cu NOTICE. Limita e aceeași ca la F1 (TRUNCATE) — risc rezidual OPEN.
--   3. Postcondiții: 0 relații din public cu MAINTAIN efectiv (has_table_privilege) pentru anon/authenticated/public;
--      setarea implicită a lui postgres pe public fără „m” la anon/authenticated; service_role EXACT ca înainte;
--      TRUNCATE rămâne 0 (F1 nu regresează); sondă: tabel nou creat de postgres (în public și într-o schemă de unică
--      folosință) nu primește MAINTAIN pentru anon/authenticated.
--   Neatinse: storage, net (au și ele MAINTAIN — în afara domeniului; separat), TRUNCATE-ul lui supabase_admin.
--
-- Revenire TEHNICĂ (NU e migrare, nu se rulează automat): supabase/revenire/20261006a_sec_f1b_maintain_revoke_ROLLBACK.sql
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261006a_sec_f1b_maintain_revoke:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261006a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── 0. Precondiții + inventar ────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_n integer; v_fp text; v_anon integer; v_auth integer; v_sr integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND pg_get_userbyid(c.relowner)::text IS DISTINCT FROM 'postgres';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0a: % relații din public nu sunt ale lui postgres — REVOKE ON ALL TABLES ar eșua', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
   WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'MAINTAIN';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0b: % relații au MAINTAIN pentru PUBLIC (live: 0) — se reanalizează', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
   WHERE n.nspname = 'public' AND a.privilege_type = 'MAINTAIN' AND a.is_grantable IS TRUE AND a.grantee <> 0
     AND pg_get_userbyid(a.grantee)::text IN ('anon','authenticated');
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Precondiție 0c: % granturi MAINTAIN WITH GRANT OPTION la anon/authenticated (live: 0)', v_n;
  END IF;
  -- 0d. lista EXACTĂ: relkind:relname:anon:authenticated pentru fiecare relație cu MAINTAIN la anon sau authenticated
  SELECT count(*), md5(string_agg(x.k || ':' || x.relname || ':' || x.a::text || ':' || x.u::text, ',' ORDER BY x.relname)),
         count(*) FILTER (WHERE x.a AND x.k IN ('r','p')), count(*) FILTER (WHERE x.u AND x.k IN ('r','p'))
    INTO v_n, v_fp, v_anon, v_auth
    FROM (SELECT c.relkind::text AS k, c.relname::text AS relname,
                 has_table_privilege('anon', c.oid, 'MAINTAIN') IS TRUE AS a,
                 has_table_privilege('authenticated', c.oid, 'MAINTAIN') IS TRUE AS u
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')) x
   WHERE x.a OR x.u;
  RAISE NOTICE 'SEC F1b înainte: % relații cu MAINTAIN (tabele: anon=% authenticated=%), amprenta % (live 01.10: 474 / 309 / 345, dd222470…)',
    v_n, v_anon, v_auth, coalesce(v_fp, '<gol>');
  IF v_n IS DISTINCT FROM 0 AND v_fp IS DISTINCT FROM 'dd22247052979de6b3cd0f9bd5b88978' THEN
    RAISE EXCEPTION 'Precondiție 0d: lista relațiilor cu MAINTAIN pentru anon/authenticated s-a schimbat față de 01.10 (% relații, md5 % ≠ dd222470…) — se recitește lista și se reface amprenta', v_n, v_fp;
  END IF;
  IF v_n = 0 THEN RAISE NOTICE 'SEC F1b: nicio relație cu MAINTAIN — reaplicare; REVOKE-ul e idempotent'; END IF;
  -- 0e. service_role: numărul EXACT de dinainte (postcondiția 3c)
  SELECT count(*) INTO v_sr FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege('service_role', c.oid, 'MAINTAIN') IS TRUE;
  PERFORM set_config('gazpet.f1b_sr_before', v_sr::text, true);
END $pre$;

-- ── 1. Retragerea de pe tot ce există ────────────────────────────────────────────────────
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ── 2. Setările implicite ─────────────────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM anon, authenticated;

DO $def_admin$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AND pg_has_role(current_user, 'supabase_admin', 'USAGE') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM anon, authenticated;
    RAISE NOTICE 'SEC F1b: setarea implicită a lui supabase_admin pe public — MAINTAIN retras';
  ELSE
    RAISE NOTICE 'SEC F1b: setarea implicită a lui supabase_admin NU se poate schimba ca % (nu e membru) — risc rezidual OPEN, ca la F1', current_user;
  END IF;
END $def_admin$;

-- ── 3. Postcondiții ───────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_n integer; v_sr integer; v_sr_before integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
     AND (has_table_privilege('anon', c.oid, 'MAINTAIN') IS TRUE OR has_table_privilege('authenticated', c.oid, 'MAINTAIN') IS TRUE
          OR has_table_privilege('public', c.oid, 'MAINTAIN') IS TRUE);
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 3a: % relații din public mai au MAINTAIN pentru anon/authenticated/public (așteptat 0)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
   WHERE pg_get_userbyid(d.defaclrole)::text = 'postgres' AND n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND a.privilege_type IN ('MAINTAIN','TRUNCATE') AND a.grantee <> 0 AND pg_get_userbyid(a.grantee)::text IN ('anon','authenticated');
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 3b: setarea implicită a lui postgres pe public mai dă MAINTAIN/TRUNCATE (% intrări) către anon/authenticated', v_n;
  END IF;
  SELECT count(*) INTO v_sr FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege('service_role', c.oid, 'MAINTAIN') IS TRUE;
  v_sr_before := nullif(current_setting('gazpet.f1b_sr_before', true), '')::integer;
  IF v_sr_before IS NULL OR v_sr IS DISTINCT FROM v_sr_before THEN
    RAISE EXCEPTION 'Postcondiție 3c: service_role are MAINTAIN pe % relații, înainte pe % — REVOKE-ul a atins alt rol', v_sr, coalesce(v_sr_before::text, '<lipsă>');
  END IF;
  -- 3d. F1 nu regresează: TRUNCATE tot 0
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
     AND (has_table_privilege('anon', c.oid, 'TRUNCATE') IS TRUE OR has_table_privilege('authenticated', c.oid, 'TRUNCATE') IS TRUE);
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 3d: % relații au TRUNCATE pentru anon/authenticated (F1 cere 0)', v_n;
  END IF;
  -- 3e. sondă: tabel nou creat de postgres în public + într-o schemă de unică folosință; ambele se șterg în aceeași tranzacție
  CREATE TABLE public._sec_f1b_sonda (id integer);
  CREATE SCHEMA _sec_f1b_sonda_schema;
  CREATE TABLE _sec_f1b_sonda_schema.sonda (id integer);
  SELECT count(*) INTO v_n
    FROM (VALUES ('public._sec_f1b_sonda'::regclass), ('_sec_f1b_sonda_schema.sonda'::regclass)) AS s(t)
   WHERE has_table_privilege('anon', s.t, 'MAINTAIN') IS NOT FALSE OR has_table_privilege('authenticated', s.t, 'MAINTAIN') IS NOT FALSE;
  DROP TABLE public._sec_f1b_sonda;
  DROP SCHEMA _sec_f1b_sonda_schema CASCADE;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 3e: % din 2 tabele-sondă create de postgres primesc MAINTAIN pentru anon/authenticated', v_n;
  END IF;
  RAISE NOTICE 'SEC F1b după: MAINTAIN anon=0 authenticated=0; service_role=% (înainte %)', v_sr, v_sr_before;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261006a_sec_f1b_maintain_revoke:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261006a: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
```
