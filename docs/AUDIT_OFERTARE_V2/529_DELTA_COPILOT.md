# PR #529 (Conturi c/d/e) — delta pentru Copilot, 01.10.2026 seara

**context_version:** branch `claude/erp-continuare-x4p5a7`, commit `0407bf7` (peste `7e3f5e1` + merge `f3fe700` cu origin/main `03525df`)
**Stare:** NEAPLICAT pe live. Nimic nu s-a scris în producție; verificările live au fost doar SELECT.

## 1. Ce s-a schimbat față de pack-ul anterior (7e3f5e1)
1. **Merge `origin/main` (f3fe700)**, fără conflicte, fără rebase/force. Au intrat: #537, #548 (CTC F1), #554 (J02b), #556/#557 (Diurne), #558 (RSVTI P1b), #560 (Garanții). Nicio migrare nouă din main nu redefinește vreuna dintre cele 46 de funcții create de c/d/e (verificat cu grep pe `CREATE OR REPLACE FUNCTION`).
2. **Precondiții noi, fail-closed**, în blocul `$pre_livrare$` din fiecare migrare:
   - **c**: `fn_profiles_campuri_owner_only` trebuie să fie varianta SEC F2 r4 (md5 prosrc `9acc36a4…`); `handle_new_user()` trebuie să fie corpul live (md5 `94e5c5d3…`), fiindcă c îl rescrie (la reaplicare, când `fn_cont_leaga_la_creare(uuid)` există deja, se acceptă și varianta proprie); setarea implicită a lui postgres pe public nu dă TRUNCATE lui anon/authenticated (SEC F1).
   - **d**: F2 r4 (md5) + F1 (default ACL).
   - **e**: F1 (default ACL).
3. **Harness**: `supabase/tests/conturi_ciclu_viata.migrari.txt` are acum și `live: 20260930i_sec_f1_truncate_revoke.sql` (înaintea lui F2), adică starea reală a producției.
4. `docs/CONTURI_CICLU_VIATA.md`: tabelul de amprente are sha-urile noi. ROLLBACK-urile sunt neschimbate (sha-ul ROLLBACK c a fost reverificat).

## 2. Starea live verificată (SELECT, 01.10.2026)
| Verificare | Rezultat |
|---|---|
| schema_migrations ≥ 20260929 | …, 20261001120000 (rsvti poartă), 20261001123000 (**F1**), 20261001124500 (**F2**), 20261001130000 (#537), 20261001133000 (rls prețuri), 20261001140000 (**J02b r6**), 20261001170000 (#558 P1b) |
| trg_profiles_campuri_owner_only | 1 (prezent) |
| md5 fn_profiles_campuri_owner_only | `9acc36a4067eddbdf29956220023ea92` (= F2 r4) |
| md5 handle_new_user | `94e5c5d33116df4466fb2e714887a9b2` (corpul de bază, identic cu scheletul din harness) |
| extensions.unaccent(text), hr_employees_private, hr_personal_extern | prezente |
| obiecte c/d/e (fn_identitate_*, tip_cont, conturi_inchideri_*, hr_colaborare_externa_jurnal, job cron) | 0, nimic aplicat parțial |
| pgrst.db_pre_request | nesetat |
| default ACL postgres/public | anon=`arwdxtm`, authenticated=`arwdxtm` (fără D, F1 activ); supabase_admin încă are D (riscul rezidual F1, deja consemnat) |
| triggere existente | employees: 0_protectie, audit_del/ins, termination_notify; profiles: prevent_role_escalation, enforce_owner_only_salary_flags, campuri_owner_only, protect_can_access_pontaj_brut; hr_employees_private: touch; hr_personal_extern: niciunul |
| Gate 0e (scripts/control_0e.sql) pe live | **0 rânduri** |
| PG | 17.6 |

## 3. Diff migrări + harness (complet)
```diff
diff --git a/supabase/migrations/20260929c_conturi_legare_automata.sql b/supabase/migrations/20260929c_conturi_legare_automata.sql
index 0b74799..faa9579 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata.sql
@@ -56,6 +56,26 @@ BEGIN
     RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles) nu e live — se reanalizează';
   END IF;
   IF to_regprocedure('extensions.unaccent(text)') IS NULL THEN RAISE EXCEPTION 'Precondiție: extensions.unaccent(text) lipsește'; END IF;
+  -- Live 01.10.2026: SEC F2 r4 (v20261001124500) a rescris fn_profiles_campuri_owner_only (md5 prosrc 9acc36a4…);
+  -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
+  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
+     IS DISTINCT FROM '9acc36a4067eddbdf29956220023ea92' THEN
+    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta SEC F2 r4 (md5 9acc36a4…) — se reanalizează';
+  END IF;
+  -- handle_new_user e RESCRISĂ de c: corpul live (01.10.2026, md5 94e5c5d3…) e cel din care pornește migrarea;
+  -- la reaplicare (c deja livrată ⇒ fn_cont_leaga_la_creare există) se acceptă varianta proprie.
+  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()'))
+     IS DISTINCT FROM '94e5c5d33116df4466fb2e714887a9b2'
+     AND to_regprocedure('public.fn_cont_leaga_la_creare(uuid)') IS NULL THEN
+    RAISE EXCEPTION 'Precondiție: handle_new_user() diferă de varianta live din 01.10.2026 (md5 94e5c5d3…) — se reanalizează';
+  END IF;
+  -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
+  -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
+  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
+              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
+                AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
+    RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
+  END IF;
 END $pre_livrare$;
 
 CREATE OR REPLACE FUNCTION public.fn_identitate_claims(OUT rol text, OUT sub text)
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index 8430dc3..34a3430 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -57,6 +57,19 @@ BEGIN
     RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles) nu e live — se reanalizează';
   END IF;
   IF to_regclass('public.hr_employees_private') IS NULL THEN RAISE EXCEPTION 'Precondiție: public.hr_employees_private lipsește'; END IF;
+  -- Live 01.10.2026: SEC F2 r4 (v20261001124500) a rescris fn_profiles_campuri_owner_only (md5 prosrc 9acc36a4…);
+  -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
+  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
+     IS DISTINCT FROM '9acc36a4067eddbdf29956220023ea92' THEN
+    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta SEC F2 r4 (md5 9acc36a4…) — se reanalizează';
+  END IF;
+  -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
+  -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
+  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
+              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
+                AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
+    RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
+  END IF;
 END $pre_livrare$;
 
 CREATE TABLE IF NOT EXISTS public.conturi_inchideri_jurnal (
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
index a30c714..d782e89 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
@@ -46,6 +46,13 @@ BEGIN
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile migrării anterioare: %', v_lipsa; END IF;
   IF to_regclass('public.hr_personal_extern') IS NULL THEN RAISE EXCEPTION 'Precondiție: public.hr_personal_extern lipsește'; END IF;
+  -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
+  -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
+  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
+              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
+                AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
+    RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
+  END IF;
 END $pre_livrare$;
 
 ALTER TABLE public.employees
diff --git a/supabase/tests/conturi_ciclu_viata.migrari.txt b/supabase/tests/conturi_ciclu_viata.migrari.txt
index 378cb64..5b2c318 100644
--- a/supabase/tests/conturi_ciclu_viata.migrari.txt
+++ b/supabase/tests/conturi_ciclu_viata.migrari.txt
@@ -8,6 +8,9 @@
 # de testul SA-01). Se aplică înaintea lui c/d/e, intră în instantaneul de schemă „dinainte” și NU se face
 # rollback la el: rollback-ul pachetului Conturi nu atinge triggerul S-A.
 live: supabase/migrations/20260929g_profiles_campuri_owner_only.sql
+# SEC F1 (20260930i, live din 01.10.2026, v20261001123000): TRUNCATE retras de la anon/authenticated + setarea implicită
+# a lui postgres corectată — c/d/e o cer ca precondiție (tabelele noi din d/e nu primesc TRUNCATE).
+live: supabase/migrations/20260930i_sec_f1_truncate_revoke.sql
 # SEC F2 (20260930j, live din 01.10.2026 12:45 UTC) a rescris fn_profiles_campuri_owner_only (rol JWT contradictoriu ⇒ refuz,
 # service_role legat de session_user = authenticator + role = service_role) — e starea reală a producției.
 live: supabase/migrations/20260930j_sec_f2_profiles_uid_null.sql
```

## 4. Amprente sha256
| Fișier | vechi | nou |
|---|---|---|
| 20260929c_conturi_legare_automata.sql | a22f6535… | `c84c48cb3572f58e974d25e076da7843ef61ebe74c6453faea0b29a5859a83af` |
| 20260929d_conturi_inchidere_la_incetare.sql | dcc8e7f9… | `c9ace3c5443dbe46d465d48ca3684da0af55a51846983b2a67b6f7a89f2c9d69` |
| 20260929e_fost_angajat_colaborare_externa.sql | d4deb2ac… | `4a8c1bc955645a2500826fb590442c88c44aba4ac3b64c81b39cf85b33c08846` |

## 5. Ordinea și versiunile propuse pentru runner (`scripts/livrare_migrare.sh`)
Ordinea e strictă: **c → d → e**, fiecare în tranzacția ei. d cere funcțiile din c, e cere fn_identitate_* din c.
| Pas | Fișier | Versiune propusă |
|---|---|---|
| 1 | 20260929c_conturi_legare_automata.sql | `20261001180000` |
| 2 | 20260929d_conturi_inchidere_la_incetare.sql | `20261001181500` |
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001183000` |

Versiunile sunt după ultima versiune live (20261001170000). Dacă J05 (#542) sau #532 intră înainte, versiunile se mută după ele. Conținutul nu depinde de ele: niciuna nu atinge obiectele c/d/e. După fiecare pas: gate 0e = 0 rânduri.

## 6. Teste
- Harness SQL local PG 17 (`PGVER_TEST=17`, `--rollback`): **892 aserțiuni PASS**, 3 migrări + 3 precondiții live (S-A, F1, F2). Include reaplicarea (idempotență), rollback-ul pas cu pas cu comparația de schemă și reaplicarea după rollback.
- Gate 0e pe baza locală, după aplicare: 0 rânduri. Gate 0e pe live, acum: 0 rânduri.
- `scripts/livrare_validator.py`: OK pe toate 3 (48 / 96 / 48 instrucțiuni de nivel superior).
- vitest: 44 fișiere, 1129 teste PASS. `npx vite build`: OK.

## 7. Riscuri / de cerut verdict
- Precondițiile md5 sunt stricte. Orice modificare a `handle_new_user` sau a `fn_profiles_campuri_owner_only` pe live înainte de livrare face ca migrarea să refuze (fail-closed, intenționat).
- Precondițiile noi nu au teste negative dedicate în harness. Sunt acoperite doar pe calea pozitivă (pornire = starea live).
- Default ACL-ul lui supabase_admin dă încă TRUNCATE (riscul rezidual F1). c/d/e rulează ca postgres, deci tabelele lor nu sunt afectate.
