# PR #529 r11 — Preflight LIVE read-only (02.10.2026)

- Branch verificat: `claude/erp-continuare-x4p5a7`, head `8a7f193`
- Țintă: Supabase `dxczwkbciseqniprspcu`, DOAR SELECT (fără apply / DML / DDL), un statement per apel `execute_sql`
- Sursa precondițiilor: blocurile `DO $pre_livrare$` din `20260929c/d/e`, secțiunea „Preflight live înainte de GO” din `docs/CONTURI_CICLU_VIATA.md` (r8–r11), `scripts/control_0e.sql`, `scripts/livrare_migrare.sh`

## Verdict: TOATE OK (ce se poate verifica înainte de c)

Precondițiile lui d și e care cer amprentele helperilor din c (`fn_identitate_om`, `fn_identitate_privilegiata`, `fn_identitate_eticheta`, `fn_nume_familie`, `fn_nume_cuvinte`, `fn_cont_notifica_owneri`, `fn_cont_persoana_chei`, `fn_cont_lock_chei`) NU se pot verifica acum: funcțiile nu există live (așteptat — le creează c). Se verifică de runner după livrarea lui c (precondiția fail-closed din d/e).

## Amprentele fișierelor (sha256, branch head 8a7f193)

| Fișier | sha256 găsit | = tabelul r11 din doc |
|---|---|---|
| `20260929c_conturi_legare_automata.sql` | `a5256cc15419e4999a36b8271d8e395b6be08c0f3b8400bdb3df18d5d4735115` | OK |
| `20260929d_conturi_inchidere_la_incetare.sql` | `c3ac7a75ee76083b0bdef10b2458b38748f7473aa6c22397a807004c4f675f71` | OK |
| `20260929e_fost_angajat_colaborare_externa.sql` | `3cc5065c8a4457b67eb82cf5f16626e27fe0470b1073c1b492ba285113ad9a53` | OK |
| `20260929c_..._ROLLBACK.sql` | `a25a365e1ac03fbdf7532ce998788a9a80ae2287942d984a1e0434ef14b9b1d2` | OK |
| `20260929d_..._ROLLBACK.sql` | `3b9f3b607876d7bbdbc978a7f1a38af1d6cd54718eb32967fc703c8baa37cc89` | OK |
| `20260929e_..._ROLLBACK.sql` | `94eb12f925383a53648079c920c91ae4542867f5a2adb83bb7e15a0878e4e523` | OK |

⚠ **Atenționare doc (nu blochează, dar blochează runner-ul dacă se copiază orbește):** în `CONTURI_CICLU_VIATA.md`, comenzile `bash scripts/livrare_migrare.sh` au `--sha256` VECHI pentru c (`a8d2c84f…`) și d (`d581b10c…`) — nu coincid cu tabelul r11 de deasupra (`a5256cc1…` / `c3ac7a75…`). Runner-ul refuză (cod 2/21) la nepotrivire. Pentru e sha-ul din comandă e cel corect. De corectat în PR #529 înainte de livrare.

## Tabel precondiții

| # | Precondiție (migrare) | Așteptat | Găsit | OK |
|---|---|---|---|---|
| 1 | `current_user = 'postgres'` (c/d/e) — rolul conexiunii MCP | postgres | `postgres` | OK |
| 2 | `fn_profiles_campuri_owner_only` md5(prosrc) (c/d) | `1114af39c13e295dd2ab666dab495567` | `1114af39c13e295dd2ab666dab495567`, secdef, `{"search_path=public, pg_temp"}`, owner postgres, ACL `{postgres=X/postgres}` | OK |
| 3 | `handle_new_user` md5(prosrc) (c, prima aplicare) | `94e5c5d33116df4466fb2e714887a9b2` | `94e5c5d33116df4466fb2e714887a9b2` | OK |
| 4 | `fn_cont_leaga_la_creare(uuid)` NU există (c = prima aplicare, nu reaplicare) | absent | absent (0) | OK |
| 5 | Trigger S-A `trg_profiles_campuri_owner_only` pe profiles: `tgenabled='O'`, `tgtype=19`, `NOT tgisinternal`, fn = `fn_profiles_campuri_owner_only()` (c/d) | activ, 19, fn OK | `O`, 19, false, `fn_profiles_campuri_owner_only()` | OK |
| 6 | `extensions.unaccent(text)` există (c) | există | true | OK |
| 7 | `has_table_privilege('postgres','auth.users','SELECT')` (c r8) | t | true | OK |
| 8 | `has_table_privilege('postgres','auth.users','UPDATE')` (c r8) | t | true | OK |
| 9 | `postgres` DELETE pe `auth.sessions` / `auth.refresh_tokens` (d, revocare sesiuni — G.2) | t / t | true / true | OK |
| 10 | SEC F1 live: default ACL postgres pe public nu dă TRUNCATE lui anon/authenticated (c/d/e) | 0 rânduri | 0 | OK |
| 11 | `public.hr_employees_private` există (d) | există | true | OK |
| 12 | `public.hr_personal_extern` există (e) | există | true | OK |
| 13 | Funcțiile create de c/d/e NU există (51 nume: `fn_identitate_*`, `fn_nume_*`, `fn_cont_*` incl. `fn_cont_revalideaza_candidat`, `fn_cont_chei_potrivire`, `fn_cont_serializare_activa`, `fn_cont_persoana_chei`, `fn_cont_lock_chei`, `fn_cont_notifica_owneri`, `fn_employees_*`, `fn_hr_*`, `fn_colab*`, `fn_extern_*`, `fn_fost_*`, `fn_pgrst_pre_request`, `fn_conturi_inchideri_*`, `fn_admin_conturi_alerte`, `fn_profiles_protectie_legatura`) | toate n=0 | toate 51 cu n=0 | OK |
| 14 | Triggerele create de c/d/e NU există (16 nume `trg_profiles_protectie_legatura`, `trg_conturi_inchideri_*`, `trg_employees_persoana_lock`, `trg_hr_employees_private_persoana_lock`, `trg_employees_00_cont_revocat`, `trg_hr_employees_private_00_cont_revocat`, `trg_employees_zz_ciclu_cont`, `trg_employees_colab_ext_*`, `trg_employees_zz_colab_ext*`, `trg_hr_colab_ext_jurnal_imuabil`, `trg_hr_personal_extern_fost_angajat`) | 0 | 0 — pe `employees` doar `trg_employees_0_protectie`, `_audit_del`, `_audit_ins`, `_termination_notify`; pe `hr_employees_private` doar `trg_hr_employees_private_touch` | OK |
| 15 | Tabele/view create de c/d/e NU există: `conturi_inchideri_jurnal`, `conturi_inchideri_coada`, `hr_colaborare_externa_jurnal`, `v_admin_conturi_alerte` | absente | toate NULL | OK |
| 16 | Coloane noi absente: `profiles.tip_cont`, `employees.colaborare_externa_*`, `hr_personal_extern.fost_angajat_*` | 0 | 0 | OK |
| 17 | Constrângeri noi absente (`profiles_tip_cont_chk`, `employees_colab_ext_status_chk`, `employees_colab_ext_dovada_chk`, `hr_personal_extern_fost_angajat_fk`, `conturi_inchideri_coada_tip_check`) | 0 | 0 | OK |
| 18 | Indexuri noi absente (`uq_conturi_inchidere_deschisa`, `idx_conturi_inchideri_employee`, `uq_conturi_inchideri_coada_deschisa`, `idx_hr_colab_ext_jurnal_employee`, `uq_hr_personal_extern_fost_angajat`) | 0 | 0 | OK |
| 19 | Tipul de coadă `reevaluare_istorica` (r10): d îl livrează ca CHECK pe `conturi_inchideri_coada.tip`, nu ca ENUM — tabela nu există (#15), niciun enum `*conturi_inchideri*` în public | absent | 0 | OK |
| 20 | Gate 0e (`scripts/control_0e.sql`): funcții expuse anon/authenticated cu set_config / request.jwt / SET ROLE / EXECUTE dinamic / interpretor SQL | 0 rânduri | 0 | OK |
| 21 | Versiune maximă `supabase_migrations.schema_migrations` < `20261001230000` | ultima = 20261001224000 | `20261001224000` (`20261006a_sec_f1b_maintain_revoke`) | OK |
| 22 | Versiunile 230000 / 231500 / 233000 nefolosite și numele c/d/e neînregistrate (gardă runner `1_pre.sql`) | 0 / 0 | 0 / 0 | OK |
| 23 | Controlul Copilot pentru e: externi activi nelegați cu email exact al unei fișe INACTIVE | 0 rânduri | 0 (ids: niciunul) | OK |
| 24 | Job pg_cron `conturi_inchideri_coada` NU există (d îl creează) | 0 | 0 (namespace `cron` există → d îl va programa) | OK |
| 25 | `pgrst.db_pre_request` NU e setat pe `authenticator` (d creează hook-ul fără să-l activeze) | nesetat | rolconfig = `session_preload_libraries=supautils, safeupdate`, `statement_timeout=8s`, `lock_timeout=8s` — fără `pgrst.db_pre_request` | OK |
| 26 | Amprente helperi c cerute de d/e (md5 + secdef + proconfig + owner + ACL) | — | neverificabil înainte de c (funcțiile nu există); verificat de runner după c | n/a |

Notă la #3: `handle_new_user` live are `proconfig = {search_path=public}` și ACL `{postgres=X/postgres,service_role=X/postgres}` — precondiția lui c verifică DOAR md5(prosrc), iar c o rescrie (CREATE OR REPLACE) cu `SET search_path = public, pg_temp`; e conform așteptării.

## Interogările folosite (toate SELECT, un statement per apel)

```sql
-- #2, #3
SELECT p.proname, md5(p.prosrc), p.prosecdef, p.proconfig::text, pg_get_userbyid(p.proowner), p.proacl::text
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('fn_profiles_campuri_owner_only','handle_new_user');

-- #5
SELECT tgname, tgenabled, tgtype, tgisinternal, tgfoid::regprocedure::text, (tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
  FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal;

-- #1, #6–#9, #11, #12, #24 (namespace)
SELECT current_user, has_table_privilege('postgres','auth.users','SELECT'), has_table_privilege('postgres','auth.users','UPDATE'),
       has_table_privilege('postgres','auth.sessions','DELETE'), has_table_privilege('postgres','auth.refresh_tokens','DELETE'),
       to_regprocedure('extensions.unaccent(text)') IS NOT NULL, to_regclass('public.hr_employees_private') IS NOT NULL,
       to_regclass('public.hr_personal_extern') IS NOT NULL, to_regnamespace('cron') IS NOT NULL;

-- #4, #13
SELECT f, (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=f)
  FROM unnest(ARRAY['fn_identitate_claims', ... 51 nume ..., 'fn_fost_angajat_leaga_extern']) f;

-- #14
SELECT tgrelid::regclass::text, tgname, tgenabled FROM pg_trigger
 WHERE NOT tgisinternal AND (tgname IN (... 16 nume ...) OR tgrelid IN ('public.employees'::regclass,'public.hr_employees_private'::regclass));

-- #15–#19
SELECT to_regclass('public.conturi_inchideri_jurnal'), to_regclass('public.conturi_inchideri_coada'),
       to_regclass('public.hr_colaborare_externa_jurnal'), to_regclass('public.v_admin_conturi_alerte'),
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='profiles' AND column_name='tip_cont')
          OR (table_name='employees' AND column_name LIKE 'colaborare_externa%') OR (table_name='hr_personal_extern' AND column_name LIKE 'fost_angajat%'))),
       (SELECT count(*) FROM pg_constraint WHERE conname IN ('profiles_tip_cont_chk','employees_colab_ext_status_chk','employees_colab_ext_dovada_chk','hr_personal_extern_fost_angajat_fk','conturi_inchideri_coada_tip_check')),
       (SELECT count(*) FROM pg_class WHERE relname IN ('uq_conturi_inchidere_deschisa','idx_conturi_inchideri_employee','uq_conturi_inchideri_coada_deschisa','idx_hr_colab_ext_jurnal_employee','uq_hr_personal_extern_fost_angajat')),
       (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname LIKE '%conturi_inchideri%' AND t.typtype='e');

-- #10 (SEC F1)
SELECT count(*) FROM pg_default_acl d, aclexplode(d.defaclacl) a
 WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='r'
   AND a.privilege_type='TRUNCATE' AND a.grantee IN ('anon'::regrole,'authenticated'::regrole);

-- #21, #22
SELECT max(version), max(version) < '20261001230000',
       count(*) FILTER (WHERE version IN ('20261001230000','20261001231500','20261001233000')),
       count(*) FILTER (WHERE name IN ('20260929c_conturi_legare_automata','20260929d_conturi_inchidere_la_incetare','20260929e_fost_angajat_colaborare_externa'))
  FROM supabase_migrations.schema_migrations;

-- #23 (controlul Copilot pentru e; coloana fost_angajat_employee_id nu există încă ⇒ filtrul IS NULL e implicit)
SELECT count(*), array_agg(x.id), array_agg(e.id) FROM public.hr_personal_extern x
  JOIN public.employees e ON lower(btrim(e.email)) = lower(btrim(x.email))
 WHERE x.activ IS TRUE AND NULLIF(btrim(COALESCE(x.email, '')), '') IS NOT NULL AND e.active IS NOT TRUE;

-- #24, #25
SELECT (SELECT count(*) FROM cron.job WHERE jobname='conturi_inchideri_coada'),
       (SELECT rolconfig::text FROM pg_roles WHERE rolname='authenticator'),
       (SELECT count(*) FROM pg_roles WHERE rolname='authenticator' AND rolconfig::text LIKE '%pgrst.db_pre_request%');

-- #20: interogarea din scripts/control_0e.sql (main), neschimbată, împachetată în SELECT count(*), string_agg(...) FROM m WHERE cardinality(m.motive) > 0
```
