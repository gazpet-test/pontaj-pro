# PR #529 (Conturi c/d/e) — delta pentru Copilot, 01.10.2026 seara

**context_version (curent, r6):** branch `claude/erp-continuare-x4p5a7`, cod la commit `ca4816d`. Documentul e în commitul imediat următor.
**Istoric:** r1 = `0407bf7` (secțiunile 1–7, păstrate ca istoric) · r2 = `dad549b` · r3 = `a1dddd5` (delta `dac4bda`) · r4 = `187542a` + E varianta C `f411d9e`
**Versiunile valabile: 20261001210000 / 211500 / 213000** (live la 20261001201500). **Sha-urile valabile sunt cele din r6** (secțiunile anterioare sunt istoric). r5 = `4e0c49e` · r6 = `ca4816d`.
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

---

## ACTUALIZARE r2 (01.10.2026, după aplicarea #532 / 30a pe live)

**context_version:** urmează commitul care conține acest document (peste merge-ul cu origin/main `02feb1f`).

**Ce s-a schimbat:**
1. **Merge `origin/main` cu #532 (02feb1f).** Au fost conflicte add/add doar în harness (`scripts/test_conturi_ciclu_viata.sh`, `supabase/tests/conturi_schelet_supabase.sql`). Am păstrat varianta din branch: e superset (precondiții live, login authenticator, hr_employees_private, snapshot pas cu pas). Fișierele 30a și testul lor au intrat neschimbate.
2. **Live (SELECT):** `fn_profiles_campuri_owner_only` are md5 `1114af39c13e295dd2ab666dab495567`. Ultima versiune e `20261001178000`, iar handle_new_user a rămas `94e5c5d3…`.
3. **c și d nu rescriu `fn_profiles_campuri_owner_only`.** Doar verifică existența triggerului (precondiție și postcondiție), deci nu anulează extinderea 30a. Testele confirmă că trec cu 30a activ.
4. **Precondițiile c/d** cer acum md5 `1114af39…` (30a) în loc de `9acc36a4…` (F2 r4). Precondiția din e (F1) e neschimbată.
5. **Harness:** în `migrari.txt` am adăugat `live: 20260930a_profiles_campuri_owner_only_extins.sql` după F2. Lanțul e acum S-A → F1 → F2 → 30a. Testul SA-01 acceptă varianta `live_30a_v20261001178000`; md5-ul local după aplicarea 30a = md5-ul live.

**Amprente sha256 (r2):**
| Fișier | r1 | r2 |
|---|---|---|
| c | c84c48cb… | `5baa8f28faeb9db6ddfa569cd1ab492d41f07058fec6b7b050ec36e41c01da88` |
| d | c9ace3c5… | `bdd241a96d53af52fa1f16e139dfcb84bab2e94fb7e9e5414d3dd0d4894b5574` |
| e | 4a8c1bc9… | `4a8c1bc955645a2500826fb590442c88c44aba4ac3b64c81b39cf85b33c08846` (neschimbat) |

**Ordinea și versiunile** rămân aceleași: c `20261001180000` → d `20261001181500` → e `20261001183000`, toate după 30a (20261001178000).

**Teste r2:** harness PG17 `--rollback` cu **892 aserțiuni PASS** (3 migrări + 4 precondiții live). Gate 0e: 0 rânduri local și 0 rânduri pe live. Validatorul trece pe toate 3. vitest: 1129 PASS. Build: OK.

**Diff r2 (migrări + teste):**
```diff
diff --git a/supabase/migrations/20260929c_conturi_legare_automata.sql b/supabase/migrations/20260929c_conturi_legare_automata.sql
index faa9579..1ffd1c8 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata.sql
@@ -56,11 +56,11 @@ BEGIN
     RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles) nu e live — se reanalizează';
   END IF;
   IF to_regprocedure('extensions.unaccent(text)') IS NULL THEN RAISE EXCEPTION 'Precondiție: extensions.unaccent(text) lipsește'; END IF;
-  -- Live 01.10.2026: SEC F2 r4 (v20261001124500) a rescris fn_profiles_campuri_owner_only (md5 prosrc 9acc36a4…);
+  -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
   -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
   IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
-     IS DISTINCT FROM '9acc36a4067eddbdf29956220023ea92' THEN
-    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta SEC F2 r4 (md5 9acc36a4…) — se reanalizează';
+     IS DISTINCT FROM '1114af39c13e295dd2ab666dab495567' THEN
+    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta 30a (S-A extins peste F2 r4, md5 1114af39…) — se reanalizează';
   END IF;
   -- handle_new_user e RESCRISĂ de c: corpul live (01.10.2026, md5 94e5c5d3…) e cel din care pornește migrarea;
   -- la reaplicare (c deja livrată ⇒ fn_cont_leaga_la_creare există) se acceptă varianta proprie.
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index 34a3430..4db88e5 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -57,11 +57,11 @@ BEGIN
     RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles) nu e live — se reanalizează';
   END IF;
   IF to_regclass('public.hr_employees_private') IS NULL THEN RAISE EXCEPTION 'Precondiție: public.hr_employees_private lipsește'; END IF;
-  -- Live 01.10.2026: SEC F2 r4 (v20261001124500) a rescris fn_profiles_campuri_owner_only (md5 prosrc 9acc36a4…);
+  -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
   -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
   IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
-     IS DISTINCT FROM '9acc36a4067eddbdf29956220023ea92' THEN
-    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta SEC F2 r4 (md5 9acc36a4…) — se reanalizează';
+     IS DISTINCT FROM '1114af39c13e295dd2ab666dab495567' THEN
+    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta 30a (S-A extins peste F2 r4, md5 1114af39…) — se reanalizează';
   END IF;
   -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
   -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
diff --git a/supabase/tests/conturi_ciclu_viata.migrari.txt b/supabase/tests/conturi_ciclu_viata.migrari.txt
index 5b2c318..e2e419b 100644
--- a/supabase/tests/conturi_ciclu_viata.migrari.txt
+++ b/supabase/tests/conturi_ciclu_viata.migrari.txt
@@ -14,6 +14,9 @@ live: supabase/migrations/20260930i_sec_f1_truncate_revoke.sql
 # SEC F2 (20260930j, live din 01.10.2026 12:45 UTC) a rescris fn_profiles_campuri_owner_only (rol JWT contradictoriu ⇒ refuz,
 # service_role legat de session_user = authenticator + role = service_role) — e starea reală a producției.
 live: supabase/migrations/20260930j_sec_f2_profiles_uid_null.sql
+# S-A extins 30a (#532, live din 01.10.2026, v20261001178000): fn_profiles_campuri_owner_only extinsă peste F2 r4
+# (md5 prosrc 1114af39…) — c/d o cer ca precondiție.
+live: supabase/migrations/20260930a_profiles_campuri_owner_only_extins.sql
 supabase/migrations/20260929c_conturi_legare_automata.sql
 supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
 supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index 87b685a..ea35460 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -240,12 +240,14 @@ SELECT teste.assert((SELECT NOT active FROM public.employees WHERE id = :emp_cro
 -- md5 canonic al variantei LIVE (2 coloane) = c06d7ce0…; rularea de verificare cu S-A EXTINS (20260930a, NEAPLICAT în
 -- producție, pus ca a doua precondiție doar din scratchpad) are f4871f5a… — ambele sunt acceptate, variantă afișată.
 -- 01.10.2026: producția are acum varianta SEC F2 r4 (20260930j, live 01.10) — md5 9acc36a4… (citit read-only de pe live).
+-- 01.10.2026 seara: 30a (#532) e LIVE (v20261001178000) peste F2 r4 — md5 1114af39… (citit read-only de pe live).
 SELECT CASE md5(prosrc) WHEN 'c06d7ce0f212c7bba2093c50614a88fc' THEN 'live_20260929g'
                         WHEN '9acc36a4067eddbdf29956220023ea92' THEN 'live_f2_20260930j'
-                        WHEN 'f4871f5a99d6d880cc62a80c3fe65c01' THEN 'extins_20260930a' END AS sa_varianta
+                        WHEN 'f4871f5a99d6d880cc62a80c3fe65c01' THEN 'extins_20260930a'
+                        WHEN '1114af39c13e295dd2ab666dab495567' THEN 'live_30a_v20261001178000' END AS sa_varianta
   FROM pg_proc WHERE oid = 'public.fn_profiles_campuri_owner_only()'::regprocedure \gset
 \echo '   S-A varianta:' :sa_varianta
-SELECT teste.assert(:'sa_varianta' IN ('live_20260929g', 'live_f2_20260930j', 'extins_20260930a')
+SELECT teste.assert(:'sa_varianta' IN ('live_20260929g', 'live_f2_20260930j', 'extins_20260930a', 'live_30a_v20261001178000')
     AND (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_profiles_campuri_owner_only' AND tgrelid = 'public.profiles'::regclass),
   'SA-01 S-A: trg_profiles_campuri_owner_only activ, md5(prosrc) = c06d7ce0f212c7bba2093c50614a88fc (= producția) sau varianta extinsă verificată');
 -- decizia unui UPDATE făcut printr-un RPC SECURITY DEFINER (ajunge la rând ocolind RLS): 'trece' sau SQLSTATE;
```

---

## ACTUALIZARE r3 (01.10.2026, după NO-GO-ul Copilot pe `dad549b`: c GO pe logică, d și e NO-GO)

**context_version:** cod la `a1dddd5`, peste `dad549b`. NEAPLICAT pe live.

### D1 (blocker): sweep-ul nu bloca fișa
`fn_conturi_inchideri_sweep()`, pe intrările `programata`/`reincercare`, face acum:
1. `employees FOR UPDATE`;
2. garda / advisory pe persoană (`fn_cont_garda_persoana`);
3. profilul `FOR UPDATE`;
4. intrarea din coadă `FOR UPDATE`, recitită;
5. recitirea fișei (instrucțiune nouă, READ COMMITTED) și revalidarea;
6. închiderea.

Ordinea e aceeași ca la un UPDATE HR pe employees (rând → advisory → profil → coadă). Intrările `flaguri` nu citesc fișa și rămân pe profil → coadă.

### E1 (blocker): TOCTOU între fost angajat și extern
Am ales o singură disciplină: advisory lock comun, luat de ambele fluxuri înainte de orice citire.
- **Helper nou** `fn_colab_ext_lock(emp[], nume[], email[])`, intern, SECURITY DEFINER, fără EXECUTE pentru API. Cheile sunt `gazpet.colab_ext.emp:<id>`, `gazpet.colab_ext.nume:<cuvânt>` și `gazpet.colab_ext.email:<email>`. Se iau într-un singur apel, distincte și sortate după hash, deci advisory-urile nu pot forma cicluri între ele.
- **Fluxul fișei**: trigger nou `trg_employees_colab_ext_lock`, `BEFORE UPDATE OF active, termination_date, name, email, colaborare_externa_status/nota/document`. Ia cheile id, numele de familie vechi/nou și emailul vechi/nou. Rulează înaintea lui `trg_employees_colab_ext_protectie_upd`, iar `trg_employees_zz_colab_ext` (AFTER) vine după commit-ul celuilalt flux.
- **Fluxul externului**: `fn_hr_personal_extern_fost_angajat()` ia la început cheile fișa legată veche/nouă, fiecare cuvânt din numele vechi/nou (oricare poate fi numele de familie, ca în `fn_extern_fost_angajat_potrivire`) și emailul vechi/nou. Abia apoi citește employees.
- **Lock-uri în ordine inversă**: rândul propriu (fișa, respectiv externul) e blocat de UPDATE înaintea triggerului. Un ciclu rând-fișă ↔ rând-extern rămâne posibil doar dacă externul era deja activ și ambele fluxuri îl scriu. În acest caz PostgreSQL îl detectează (40P01) și anulează una dintre tranzacții, fără stare finală inconsistentă. `fn_fost_angajat_leaga_extern` ia rândul fișei înaintea rândului externului, deci intră în ordinea fișă → extern.
- **Postcondiții și ROLLBACK**: postcondițiile e cer cele 2 funcții noi și triggerul nou. ROLLBACK-ul e le șterge.

### Corecturile din aceeași rundă
1. **Triggerul S-A, în c și d** (precondiție; în c și postcondiție): `tgenabled='O'`, `tgtype=19` (BEFORE UPDATE ROW, valoarea live), `tgfoid = fn_profiles_campuri_owner_only()`, nu doar numele.
2. **Amprenta exactă a helperilor din c**, în precondițiile d și e. Pentru `fn_identitate_om`, `fn_identitate_privilegiata`, `fn_identitate_eticheta`, `fn_nume_familie`, `fn_nume_cuvinte` și `fn_cont_notifica_owneri` se verifică:
   - o singură funcție cu acest nume (fără overload);
   - semnătura exactă și md5 prosrc;
   - `prosecdef`;
   - `proconfig = {"search_path=public, pg_temp"}`;
   - owner `postgres`;
   - `proacl = {postgres=X/postgres}`.

   Default ACL-ul live pentru funcțiile lui postgres dă `postgres` + `service_role`. c face REVOKE de la service_role, deci rezultatul e același ca local.

   md5: om `2c64d6b1…`, privilegiata `13b24551…`, eticheta `876a28f9…`, nume_familie `d45994c4…`, nume_cuvinte `8ec2a2ee…`, notifica_owneri `ecfb5fa1…`.
3. **Reaplicarea c**: dacă `fn_cont_leaga_la_creare` există, `handle_new_user` trebuie să aibă exact md5-ul variantei c (`e2b0548a51499b142a3e3f42cedd435c`).
4. **Delta sincronizată**: antetul documentului arată acum commitul curent, iar r1/r2/r3 sunt marcate ca istoric.

### Amprente sha256 (r3)
| Fișier | r2 | r3 |
|---|---|---|
| c | 5baa8f28… | `9a3e0a133e50a1bc759ccaa4ec5b0c624f9e3516dc81ebe48792221455520d50` |
| d | bdd241a9… | `9eaa9f2a87969d2d65513c934148d939c4cbc7c0e5e7dcd0d34b49bf5d0b955a` |
| e | 4a8c1bc9… | `1adac6d76bfce6608bd663a3640baea57f04b753951755040129cef725de19ef` |
| c ROLLBACK | — | `3e7b3af6…` (neschimbat) |
| d ROLLBACK | — | `c2e41e0e…` (neschimbat) |
| e ROLLBACK | 5de2008d… | `5db7153f28fc5a625c3d48e5fb10cd5e86393b18eef8037368dfdac2251dffa3` |

**Ordinea și versiunile** rămân: c `20261001180000` → d `20261001181500` → e `20261001183000`.

### Teste r3
- **Harness PG17 `--rollback`: 918 aserțiuni PASS.** Sunt cele 892 de dinainte plus 13 aserțiuni noi de concurență, rulate de două ori: după migrare și după rollback + reaplicare.
- **Teste reale cu 2 conexiuni** (dblink, date comise, ordine forțată: se verifică `wait_event_type='Lock'`, apoi COMMIT și starea finală):
  - **D-RACE-1**: UPDATE HR necomis pe `termination_date` → viitor; sweep-ul AȘTEAPTĂ fișa. După COMMIT contul nu se închide, data viitoare rămâne și nu există nicio intrare scadentă azi.
  - **D-RACE-1b** (ordinea inversă, structural): un alt client ține profilul. Cât timp sweep-ul îl așteaptă, fișa e deja blocată de sweep (`FOR UPDATE NOWAIT` din altă conexiune → 55P03). După eliberare sweep-ul închide contul (data = azi, citită sub lock).
  - **E-RACE-1**: activarea externului (necomisă) ↔ acordul accepta→refuza. Schimbarea acordului așteaptă. Starea finală: „refuza” + extern inactiv.
  - **E-RACE-2**: reactivarea fișei (necomisă) ↔ activarea externului legat. Activarea așteaptă, apoi e refuzată (23514). Starea finală: fișă activă + extern inactiv.
  - **E-RACE-3**: fișa activă trece în „fost angajat” (necomis) ↔ extern NELEGAT activ cu aceeași identitate (HR, nu owner). INSERT-ul așteaptă, apoi e refuzat (23514).
- **Mutații** (fix-ul scos local, testul trebuie să pice):
  - fără `employees FOR UPDATE` în sweep → D-RACE-1b PICĂ;
  - fără lock-ul din triggerul fișei → E-RACE-1 PICĂ;
  - fără lock-ul din triggerul externului → E-RACE-1 PICĂ.

  Cu d/e din `dad549b` (pre-fix) E-RACE-1 pică. D-RACE-1 trece și pe varianta veche: acolo triggerul HR ține deja profilul, deci D-RACE-1b e testul care deosebește variantele.
- **Gate 0e după FIECARE migrare** (pe bază locală, cu toate precondițiile live): după c = 0, după c+d = 0, după c+d+e = 0 rânduri.
- **`livrare_validator.py`**: OK pe c (48), d (96) și e (54 instrucțiuni). ROLLBACK-urile sunt refuzate de validator pentru că nu au garda de livrare. Era așa și înainte, nu se livrează prin runner.
- **vitest**: 1129 PASS. **Build**: OK.

### Riscuri rămase
- **Deadlock posibil** (detectat, 40P01): când un extern deja activ e editat concomitent cu o schimbare pe fișa legată. O tranzacție e anulată și utilizatorul reîncearcă. Nu rămâne stare inconsistentă.
- **Contenție pe chei de cuvânt**: externul blochează fiecare cuvânt din nume (ex. `ION`) și se serializează cu fișele al căror nume de familie e acel cuvânt. Impact mic (scrieri rare pe hr_personal_extern), dar există.
- **Deadlock HR ↔ sweep**: o tranzacție HR care scrie întâi `hr_employees_private` (advisory persoană) și apoi `employees` poate intra în deadlock cu sweep-ul (employees → advisory). Se detectează, sweep-ul își trece eroarea în coadă și reîncearcă (backoff).
- **Precondiții stricte**: amprentele (md5 + ACL) sunt exacte. Orice modificare live a helperilor din c, după c și înainte de d/e, blochează d/e. E intenționat (fail-closed).

### Diff r3 (migrări + teste)
```diff
diff --git a/supabase/migrations/20260929c_conturi_legare_automata.sql b/supabase/migrations/20260929c_conturi_legare_automata.sql
index 1ffd1c8..6219e4a 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata.sql
@@ -52,8 +52,11 @@ BEGIN
   SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY[]::text[]) f
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile migrării anterioare: %', v_lipsa; END IF;
-  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only' AND NOT tgisinternal) THEN
-    RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles) nu e live — se reanalizează';
+  -- r3: nu doar numele — triggerul S-A e activ (O), cheamă exact funcția S-A și are tipul live (19 = BEFORE UPDATE FOR EACH ROW)
+  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
+                    AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
+                    AND tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()')) THEN
+    RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles: activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW) nu e live — se reanalizează';
   END IF;
   IF to_regprocedure('extensions.unaccent(text)') IS NULL THEN RAISE EXCEPTION 'Precondiție: extensions.unaccent(text) lipsește'; END IF;
   -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
@@ -69,6 +72,12 @@ BEGIN
      AND to_regprocedure('public.fn_cont_leaga_la_creare(uuid)') IS NULL THEN
     RAISE EXCEPTION 'Precondiție: handle_new_user() diferă de varianta live din 01.10.2026 (md5 94e5c5d3…) — se reanalizează';
   END IF;
+  -- r3: la reaplicare (c deja livrată) handle_new_user trebuie să fie EXACT varianta c (md5 e2b0548a…), nu orice valoare
+  IF to_regprocedure('public.fn_cont_leaga_la_creare(uuid)') IS NOT NULL
+     AND (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()'))
+         IS DISTINCT FROM 'e2b0548a51499b142a3e3f42cedd435c' THEN
+    RAISE EXCEPTION 'Precondiție (reaplicare c): handle_new_user() nu e varianta livrată de 20260929c (md5 e2b0548a…) — se reanalizează';
+  END IF;
   -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
   -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
   IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
@@ -685,6 +694,11 @@ BEGIN
   SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('profiles','trg_profiles_protectie_legatura'),('profiles','trg_profiles_campuri_owner_only')) AS t(r, n)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || t.r) AND g.tgname = t.n AND g.tgenabled <> 'D');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: triggere lipsă/dezactivate: %', v_lipsa; END IF;
+  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
+                    AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
+                    AND tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()')) THEN
+    RAISE EXCEPTION 'Postcondiție: triggerul S-A nu mai e cel live (activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW)';
+  END IF;
   v_n := 0;
 END $post_livrare$;
 
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index 4db88e5..04b8937 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -21,7 +21,7 @@
 --   * trg_employees_00_cont_revocat / trg_hr_employees_private_00_cont_revocat — un cont închis / banat (JWT încă
 --       valabil) nu mai scrie fișe de angajat și date personale (runda 3, X10 / P1e-f)
 --   * fn_conturi_inchideri_sweep — procesarea cozii, rulată de pg_cron ca postgres (identitate explicită db_login)
---   ORDINEA LOCK-URILOR (uniformă, runda 3): persoană (advisory) → profil (FOR UPDATE) → coadă / jurnal.
+--   ORDINEA LOCK-URILOR (uniformă, runda 3; r3: fișa employees FOR UPDATE întâi, ca la UPDATE-ul HR): [employees] → persoană (advisory) → profil (FOR UPDATE) → coadă / jurnal.
 --   * fn_pgrst_pre_request     — hook PostgREST pentru revocarea EFECTIVĂ a JWT-urilor deja emise;
 --                                CREAT, dar NEACTIVAT (activarea = ALTER ROLE authenticator, cu acordul lui Răzvan)
 --   * fn_cont_restaureaza      — revenire din jurnal, EXCLUSIV owner, cu previzualizare (p_simulare)
@@ -53,8 +53,11 @@ BEGIN
   SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_identitate_om','fn_identitate_privilegiata','fn_nume_familie','fn_cont_notifica_owneri']::text[]) f
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile migrării anterioare: %', v_lipsa; END IF;
-  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only' AND NOT tgisinternal) THEN
-    RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles) nu e live — se reanalizează';
+  -- r3: nu doar numele — triggerul S-A e activ (O), cheamă exact funcția S-A și are tipul live (19 = BEFORE UPDATE FOR EACH ROW)
+  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
+                    AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
+                    AND tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()')) THEN
+    RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles: activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW) nu e live — se reanalizează';
   END IF;
   IF to_regclass('public.hr_employees_private') IS NULL THEN RAISE EXCEPTION 'Precondiție: public.hr_employees_private lipsește'; END IF;
   -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
@@ -70,6 +73,21 @@ BEGIN
                 AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
     RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
   END IF;
+  -- r3: amprenta EXACTĂ a helperilor din c folosiți aici (semnătură unică, md5 prosrc, SECURITY DEFINER, proconfig, owner, ACL)
+  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
+    FROM (VALUES ('fn_identitate_om', 'fn_identitate_om()', '2c64d6b19e2afbf7d158b33d67845e32'),
+                 ('fn_identitate_privilegiata', 'fn_identitate_privilegiata()', '13b245513eed1f7f3848ce4edbcec383'),
+                 ('fn_identitate_eticheta', 'fn_identitate_eticheta()', '876a28f98d4f4aee76a0580dab4ecc51'),
+                 ('fn_nume_familie', 'fn_nume_familie(text)', 'd45994c4bc8aaf51da653578c1cf86cf'),
+                 ('fn_nume_cuvinte', 'fn_nume_cuvinte(text)', '8ec2a2ee5b6313ab55ba9ff1a1c6c998'),
+                 ('fn_cont_notifica_owneri', 'fn_cont_notifica_owneri(text,text,text,text)', 'ecfb5fa1d44c93c57df39aed1f5c9a5e')) AS w(f, sig, m)
+   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
+      OR NOT EXISTS (SELECT 1 FROM pg_proc p
+                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
+                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
+                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
+                        AND p.proacl::text = '{postgres=X/postgres}');
+  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: helperii din 20260929c nu au amprenta livrată (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
 END $pre_livrare$;
 
 CREATE TABLE IF NOT EXISTS public.conturi_inchideri_jurnal (
@@ -826,6 +844,10 @@ BEGIN
     v_garda := NULL;
     BEGIN
       IF q.tip <> 'flaguri' AND q.employee_id IS NOT NULL THEN
+        -- 0) fișa de angajat (r3, D1 Copilot): aceeași ordine ca un UPDATE HR pe employees (rând → advisory → profil → coadă).
+        --    Fără lock, sweep-ul putea citi termination_date veche deja comisă în timp ce HR o muta în viitor ⇒ cont închis
+        --    cu dată viitoare. Cu FOR UPDATE, citirea de mai jos (instrucțiune nouă, READ COMMITTED) vede versiunea comisă.
+        PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
         v_garda := public.fn_cont_garda_persoana(q.employee_id);          -- 1) persoana (lock până la COMMIT)
       END IF;
       PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;   -- 2) profilul
@@ -846,7 +868,7 @@ BEGIN
           v_rezult := 'anulat_restaurat';
         END IF;
       ELSE
-        SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;
+        SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;   -- recitire după lock (revalidare)
         IF NOT FOUND
            OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.employee_id = x.employee_id)
            OR e.active IS TRUE OR e.termination_date IS NULL THEN
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
index d782e89..c8e0cbe 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
@@ -53,6 +53,21 @@ BEGIN
                 AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
     RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
   END IF;
+  -- r3: amprenta EXACTĂ a helperilor din c folosiți aici (semnătură unică, md5 prosrc, SECURITY DEFINER, proconfig, owner, ACL)
+  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
+    FROM (VALUES ('fn_identitate_om', 'fn_identitate_om()', '2c64d6b19e2afbf7d158b33d67845e32'),
+                 ('fn_identitate_privilegiata', 'fn_identitate_privilegiata()', '13b245513eed1f7f3848ce4edbcec383'),
+                 ('fn_identitate_eticheta', 'fn_identitate_eticheta()', '876a28f98d4f4aee76a0580dab4ecc51'),
+                 ('fn_nume_familie', 'fn_nume_familie(text)', 'd45994c4bc8aaf51da653578c1cf86cf'),
+                 ('fn_nume_cuvinte', 'fn_nume_cuvinte(text)', '8ec2a2ee5b6313ab55ba9ff1a1c6c998'),
+                 ('fn_cont_notifica_owneri', 'fn_cont_notifica_owneri(text,text,text,text)', 'ecfb5fa1d44c93c57df39aed1f5c9a5e')) AS w(f, sig, m)
+   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
+      OR NOT EXISTS (SELECT 1 FROM pg_proc p
+                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
+                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
+                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
+                        AND p.proacl::text = '{postgres=X/postgres}');
+  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: helperii din 20260929c nu au amprenta livrată (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
 END $pre_livrare$;
 
 ALTER TABLE public.employees
@@ -244,6 +259,52 @@ AS $fn$
 $fn$;
 REVOKE ALL ON FUNCTION public.fn_extern_fost_angajat_potrivire(text, text) FROM PUBLIC, anon, authenticated, service_role;
 
+-- C.3b Serializare fost angajat ↔ extern (r3, E1 Copilot: TOCTOU între triggerul externului și cel al fișei).
+-- O SINGURĂ disciplină: lock-uri advisory de tranzacție pe identitatea comună, luate de AMBELE fluxuri înainte de orice citire:
+--   * fișa:    gazpet.colab_ext.emp:<id>, gazpet.colab_ext.nume:<numele de familie vechi/nou>, gazpet.colab_ext.email:<vechi/nou>
+--   * externul: gazpet.colab_ext.emp:<fișa legată veche/nouă>, gazpet.colab_ext.nume:<FIECARE cuvânt din nume vechi/nou>
+--     (oricare poate fi numele de familie al unui fost angajat — aceeași regulă ca fn_extern_fost_angajat_potrivire),
+--     gazpet.colab_ext.email:<vechi/nou>.
+-- Cheile se iau într-un singur apel, sortate după hash (fără cicluri între advisory-uri). Citirile de după lock sunt
+-- instrucțiuni noi (READ COMMITTED) ⇒ văd ce a comis celălalt flux. Rândurile proprii (fișa, respectiv externul) sunt deja
+-- blocate de UPDATE înainte de trigger: un ciclu rând-fișă ↔ rând-extern rămâne posibil doar ca deadlock DETECTAT (40P01,
+-- una dintre tranzacții e anulată) — niciodată ca stare finală inconsistentă.
+CREATE OR REPLACE FUNCTION public.fn_colab_ext_lock(p_emp integer[], p_nume text[], p_email text[])
+RETURNS void
+LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
+AS $fn$
+DECLARE v_h bigint;
+BEGIN
+  FOR v_h IN
+    SELECT DISTINCT hashtextextended(k, 0) FROM (
+      SELECT 'gazpet.colab_ext.emp:' || x::text AS k FROM unnest(COALESCE(p_emp, '{}'::integer[])) x WHERE x IS NOT NULL
+      UNION ALL
+      SELECT 'gazpet.colab_ext.nume:' || x FROM unnest(COALESCE(p_nume, '{}'::text[])) x WHERE COALESCE(x, '') <> ''
+      UNION ALL
+      SELECT 'gazpet.colab_ext.email:' || lower(btrim(x)) FROM unnest(COALESCE(p_email, '{}'::text[])) x WHERE COALESCE(btrim(x), '') <> ''
+    ) t ORDER BY 1
+  LOOP
+    PERFORM pg_advisory_xact_lock(v_h);
+  END LOOP;
+END $fn$;
+REVOKE ALL ON FUNCTION public.fn_colab_ext_lock(integer[], text[], text[]) FROM PUBLIC, anon, authenticated, service_role;
+
+CREATE OR REPLACE FUNCTION public.fn_employees_colab_ext_lock()
+RETURNS trigger
+LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
+AS $fn$
+BEGIN
+  PERFORM public.fn_colab_ext_lock(ARRAY[NEW.id],
+                                   ARRAY[public.fn_nume_familie(OLD.name), public.fn_nume_familie(NEW.name)],
+                                   ARRAY[OLD.email, NEW.email]);
+  RETURN NEW;
+END $fn$;
+REVOKE ALL ON FUNCTION public.fn_employees_colab_ext_lock() FROM PUBLIC, anon, authenticated, service_role;
+DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;
+CREATE TRIGGER trg_employees_colab_ext_lock BEFORE UPDATE OF active, termination_date, name, email,
+    colaborare_externa_status, colaborare_externa_nota, colaborare_externa_document ON public.employees
+  FOR EACH ROW EXECUTE FUNCTION public.fn_employees_colab_ext_lock();
+
 -- Protecție: politicile INSERT/UPDATE de pe tabelă permit ORICĂRUI logat să scrie → poarta e aici.
 --   (1) legarea / dezlegarea: doar owner / HR; ținta = fost angajat; dezlegarea face colaborarea inactivă;
 --   (2) rând legat + activ: fișa e ÎNCĂ a unui fost angajat și acordul e „accepta”;
@@ -259,6 +320,13 @@ DECLARE
   v_e     record;
   v_pot   record;
 BEGIN
+  -- r3 (E1): serializare cu fluxul fișei, ÎNAINTE de orice citire din employees (vezi C.3b)
+  IF TG_OP = 'INSERT' THEN
+    PERFORM public.fn_colab_ext_lock(ARRAY[NEW.fost_angajat_employee_id], public.fn_nume_cuvinte(NEW.nume), ARRAY[NEW.email]);
+  ELSE
+    PERFORM public.fn_colab_ext_lock(ARRAY[OLD.fost_angajat_employee_id, NEW.fost_angajat_employee_id],
+                                     public.fn_nume_cuvinte(OLD.nume) || public.fn_nume_cuvinte(NEW.nume), ARRAY[OLD.email, NEW.email]);
+  END IF;
   v_owner := v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_owner IS TRUE);
   IF (TG_OP = 'INSERT' AND NEW.fost_angajat_employee_id IS NOT NULL)
      OR (TG_OP = 'UPDATE' AND NEW.fost_angajat_employee_id IS DISTINCT FROM OLD.fost_angajat_employee_id) THEN
@@ -462,7 +530,7 @@ DO $post_livrare$
 DECLARE v_n integer; v_lipsa text[];
 BEGIN
   -- funcțiile migrării există; cele SECURITY DEFINER au search_path fixat; niciuna executabilă de anon (excepții explicite)
-  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[]) f
+  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_colab_ext_lock','fn_employees_colab_ext_lock','fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[]) f
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții lipsă după migrare: %', v_lipsa; END IF;
   SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
@@ -480,7 +548,7 @@ BEGIN
       OR has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: tabele fără RLS sau cu drepturi pentru anon: %', v_lipsa; END IF;
   -- triggerele cerute există și sunt active
-  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)
+  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || t.r) AND g.tgname = t.n AND g.tgenabled <> 'D');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: triggere lipsă/dezactivate: %', v_lipsa; END IF;
   v_n := 0;
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql
index ca6f213..f9df054 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql
@@ -6,6 +6,8 @@
 --    legăturile hr_personal_extern.fost_angajat_employee_id în claude_context, cu confirmarea lui Răzvan.
 
 DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext ON public.employees;
+DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;
+DROP FUNCTION IF EXISTS public.fn_employees_colab_ext_lock();
 DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_ins ON public.employees;
 DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_upd ON public.employees;
 DROP FUNCTION IF EXISTS public.fn_employees_colab_ext_after();
@@ -14,6 +16,7 @@ DROP FUNCTION IF EXISTS public.fn_employees_colab_ext_protectie();
 DROP TRIGGER IF EXISTS trg_hr_personal_extern_fost_angajat ON public.hr_personal_extern;
 DROP FUNCTION IF EXISTS public.fn_hr_personal_extern_fost_angajat();
 DROP FUNCTION IF EXISTS public.fn_extern_fost_angajat_potrivire(text, text);
+DROP FUNCTION IF EXISTS public.fn_colab_ext_lock(integer[], text[], text[]);
 
 DROP FUNCTION IF EXISTS public.fn_colaborare_externa_seteaza(integer, text, text, text);
 DROP FUNCTION IF EXISTS public.fn_fost_angajat_leaga_extern(integer, bigint);
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index ea35460..107d4e6 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -108,6 +108,154 @@ SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'u_lock')
     AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_lock'),
   'R2-42 curățenie: datele confirmate ale testului au fost șterse');
 
+-- ============================================================ r3 (verdict Copilot pe dad549b): teste de concurență REALE
+-- Două conexiuni (dblink), date comise, ordinea forțată determinist: prima tranzacție ține lock-ul, a doua e pornită și se
+-- verifică faptul că AȘTEAPTĂ (pg_stat_activity.wait_event_type = 'Lock'), apoi prima face COMMIT și se verifică starea finală.
+SELECT gen_random_uuid() AS u_dr, gen_random_uuid() AS u_ehr, gen_random_uuid() AS u_dr2 \gset
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
+  VALUES (%1$L, 'authenticated', 'authenticated', 'drace.unu@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
+         (%2$L, 'authenticated', 'authenticated', 'erace.hr@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
+         (%3$L, 'authenticated', 'authenticated', 'drace.doi@exemplu.ro', '{"provider":"email"}', now(), now(), now());
+  UPDATE public.profiles SET can_modify_employees = true WHERE id = %2$L;
+  INSERT INTO public.employees (name, department, email, active, termination_date) VALUES
+    ('DRACESCU UNU', 'Test', 'drace.unu@exemplu.ro', false, CURRENT_DATE),
+    ('DRACESCU DOI', 'Test', 'drace.doi@exemplu.ro', false, CURRENT_DATE),   -- CNP pus mai jos (garda „aceeași persoană”)
+    ('ERACESCU UNU', 'Test', 'erace.unu@exemplu.ro', false, CURRENT_DATE - 1),
+    ('ERACESCU DOI', 'Test', 'erace.doi@exemplu.ro', false, CURRENT_DATE - 1),
+    ('GRACESCU TREI', 'Test', 'grace.trei@exemplu.ro', true, NULL);
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU UNU') WHERE id = %1$L;
+  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
+  SELECT %1$L, id, 'programata', 'test D-RACE-1', CURRENT_DATE FROM public.employees WHERE name = 'DRACESCU UNU';
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU DOI') WHERE id = %3$L;
+  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
+  SELECT %3$L, id, 'programata', 'test D-RACE-1b', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU DOI';
+  UPDATE public.employees SET cnp = '1900303000085' WHERE name = 'DRACESCU DOI';
+$q$, :'u_dr', :'u_ehr', :'u_dr2'));
+SELECT max(id) FILTER (WHERE name = 'DRACESCU DOI') AS e_dr2, max(id) FILTER (WHERE name = 'DRACESCU UNU') AS e_dr, max(id) FILTER (WHERE name = 'ERACESCU UNU') AS e_f1,
+       max(id) FILTER (WHERE name = 'ERACESCU DOI') AS e_f2, max(id) FILTER (WHERE name = 'GRACESCU TREI') AS e_g
+  FROM public.employees WHERE name IN ('DRACESCU DOI', 'DRACESCU UNU', 'ERACESCU UNU', 'ERACESCU DOI', 'GRACESCU TREI') \gset
+-- acordul „accepta” și externii legați (inactivi) — puse de un OM din HR (JWT prin authenticator), ca în aplicație
+SELECT teste.dblink_connect('c_hr1', :'conn_lock');
+SELECT teste.dblink_connect('c_hr2', :'conn_lock');
+SELECT teste.dblink_connect('c_pg', :'conn_lock');
+SELECT * FROM teste.dblink('c_hr1', format('SELECT teste.ca_utilizator(%L)::text', :'u_ehr')) AS t(x text);
+SELECT * FROM teste.dblink('c_hr2', format('SELECT teste.ca_utilizator(%L)::text', :'u_ehr')) AS t(x text);
+SELECT teste.dblink_exec('c_hr1', format($q$DO $d$ BEGIN
+  PERFORM public.fn_colaborare_externa_seteaza(%1$s, 'accepta', 'acord de test E-RACE');
+  PERFORM public.fn_colaborare_externa_seteaza(%2$s, 'accepta', 'acord de test E-RACE');
+  INSERT INTO public.hr_personal_extern (nume, activ, fost_angajat_employee_id) VALUES ('Eracescu Unu', false, %1$s), ('Eracescu Doi', false, %2$s);
+END $d$$q$,
+  :e_f1, :e_f2));
+SELECT max(id) FILTER (WHERE fost_angajat_employee_id = :e_f1) AS x1, max(id) FILTER (WHERE fost_angajat_employee_id = :e_f2) AS x2
+  FROM public.hr_personal_extern \gset
+SELECT teste.assert((SELECT count(*) = 2 FROM public.employees WHERE id IN (:e_f1, :e_f2) AND colaborare_externa_status = 'accepta')
+    AND :x1 IS NOT NULL AND :x2 IS NOT NULL,
+  'RACE pregătire: date comise (2 foști angajați cu acord „accepta”, externi legați inactivi, coada D-RACE-1)');
+
+-- D-RACE-1: HR mută termination_date în viitor (necomis) ↔ sweep-ul pe intrarea „programata” scadentă azi.
+SELECT pid AS pid_pg FROM teste.dblink('c_pg', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT pid AS pid_hr2 FROM teste.dblink('c_hr2', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_connect('c_dsw', :'conn_lock');
+SELECT pid AS pid_dsw FROM teste.dblink('c_dsw', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_exec('c_pg', 'BEGIN');
+SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET termination_date = CURRENT_DATE + 30 WHERE id = %s', :e_dr));
+SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
+SELECT teste.assert(teste.asteapta_lock(:pid_dsw),
+  'D-RACE-1 sweep-ul AȘTEAPTĂ fișa (employees FOR UPDATE) cât timp UPDATE-ul HR pe termination_date e necomis');
+SELECT teste.dblink_exec('c_pg', 'COMMIT');
+SELECT res AS sweep_dr FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+SELECT count(*) AS rest_dr FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+\echo '   D-RACE-1 sweep:' :sweep_dr
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr')
+    AND (SELECT termination_date FROM public.employees WHERE id = :e_dr) = CURRENT_DATE + 30
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada
+                     WHERE profile_id = :'u_dr' AND rezolvat_la IS NULL AND abandonat_la IS NULL AND scadent_la <= CURRENT_DATE),
+  'D-RACE-1 după COMMIT-ul HR sweep-ul recitește fișa: contul NU se închide, data viitoare rămâne, nicio intrare scadentă azi');
+-- D-RACE-1b (ordinea inversă, structural): sweep-ul ia fișa ÎNAINTE de profil. Cât timp sweep-ul stă la profilul ținut de
+-- altă tranzacție, fișa e deja blocată de el ⇒ un UPDATE HR pe termination_date nu se mai poate strecura între citirea
+-- sweep-ului și închidere (varianta dinainte de r3 nu bloca fișa: NOWAIT reușea).
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr2'));
+SELECT teste.dblink_connect('c_tine2', :'conn_lock');
+SELECT teste.dblink_exec('c_tine2', 'BEGIN');
+SELECT * FROM teste.dblink('c_tine2', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_dr2')) AS t(id text);
+SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
+SELECT teste.assert(teste.asteapta_lock(:pid_dsw), 'D-RACE-1b pregătire: sweep-ul așteaptă profilul ținut de altă tranzacție');
+SELECT res AS nowait_dr2 FROM teste.dblink('c_pg', format($q$SELECT COALESCE(teste.eroare('SELECT 1 FROM public.employees WHERE id = %s FOR UPDATE NOWAIT')::text, 'OK')$q$, :e_dr2)) AS t(res text) \gset
+SELECT teste.assert(:'nowait_dr2' ~ '"state": "55P03"',
+  'D-RACE-1b cât timp sweep-ul așteaptă profilul, fișa e DEJA blocată de el (FOR UPDATE NOWAIT din altă conexiune → 55P03)');
+SELECT teste.dblink_exec('c_tine2', 'ROLLBACK');
+SELECT res AS sweep_dr2 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+SELECT count(*) AS rest_dr2 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+\echo '   D-RACE-1b sweep:' :sweep_dr2
+SELECT teste.assert(EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr2' AND restaurat_la IS NULL),
+  'D-RACE-1b după eliberarea profilului sweep-ul închide contul (data încetării = azi, citită sub lock-ul fișei)');
+SELECT teste.dblink_disconnect('c_tine2');
+SELECT teste.dblink_disconnect('c_dsw');
+
+-- E-RACE-1: activarea externului (necomisă) ↔ acordul trece accepta → refuza.
+SELECT teste.dblink_exec('c_hr1', 'BEGIN');
+SELECT teste.dblink_exec('c_hr1', format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :x1));
+SELECT teste.dblink_send_query('c_hr2', format($q$SELECT COALESCE(teste.eroare('SELECT public.fn_colaborare_externa_seteaza(%s, ''refuza'', ''refuz de test E-RACE'')')::text, 'OK')$q$, :e_f1));
+SELECT teste.assert(teste.asteapta_lock(:pid_hr2), 'E-RACE-1 schimbarea acordului AȘTEAPTĂ activarea externului necomisă');
+SELECT teste.dblink_exec('c_hr1', 'COMMIT');
+SELECT res AS er1 FROM teste.dblink_get_result('c_hr2') AS t(res text) \gset
+SELECT count(*) AS rest_er1 FROM teste.dblink_get_result('c_hr2') AS t(res text) \gset
+SELECT teste.assert(:'er1' = 'OK'
+    AND (SELECT colaborare_externa_status = 'refuza' FROM public.employees WHERE id = :e_f1)
+    AND (SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :x1),
+  'E-RACE-1 stare finală consistentă: acord „refuza” ȘI externul dezactivat (nu rămâne activ fără acord)');
+
+-- E-RACE-2: reactivarea fișei (necomisă) ↔ activarea externului legat.
+SELECT pid AS pid_hr1 FROM teste.dblink('c_hr1', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_exec('c_pg', 'BEGIN');
+SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = true, termination_date = NULL WHERE id = %s', :e_f2));
+SELECT teste.dblink_send_query('c_hr1', format($q$SELECT COALESCE(teste.eroare('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s')::text, 'OK')$q$, :x2));
+SELECT teste.assert(teste.asteapta_lock(:pid_hr1), 'E-RACE-2 activarea externului AȘTEAPTĂ reactivarea fișei necomisă');
+SELECT teste.dblink_exec('c_pg', 'COMMIT');
+SELECT res AS er2 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
+SELECT count(*) AS rest_er2 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
+SELECT teste.assert(:'er2' ~ '"state": "23514"'
+    AND (SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :x2)
+    AND (SELECT active IS TRUE FROM public.employees WHERE id = :e_f2),
+  'E-RACE-2 după reactivare activarea externului e refuzată (23514): niciun extern activ legat de un angajat activ');
+
+-- E-RACE-3: fișa activă devine „fost angajat” (necomis) ↔ un extern NELEGAT activ cu aceeași identitate (HR, nu owner).
+SELECT teste.dblink_exec('c_pg', 'BEGIN');
+SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE - 1 WHERE id = %s', :e_g));
+SELECT teste.dblink_send_query('c_hr1', $q$SELECT COALESCE(teste.eroare('INSERT INTO public.hr_personal_extern (nume, activ) VALUES (''Trei Gracescu'', true)')::text, 'OK')$q$);
+SELECT teste.assert(teste.asteapta_lock(:pid_hr1), 'E-RACE-3 externul nelegat cu aceeași identitate AȘTEAPTĂ trecerea fișei în „fost angajat”');
+SELECT teste.dblink_exec('c_pg', 'COMMIT');
+SELECT res AS er3 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
+SELECT count(*) AS rest_er3 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
+SELECT teste.assert(:'er3' ~ '"state": "23514"'
+    AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE lower(nume) = 'trei gracescu'),
+  'E-RACE-3 după COMMIT externul nelegat e refuzat (23514): marcajul / acordul nu pot fi ocolite prin cursă');
+
+SELECT teste.dblink_disconnect('c_hr1');
+SELECT teste.dblink_disconnect('c_hr2');
+SELECT teste.dblink_disconnect('c_pg');
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  SET session_replication_role = replica;               -- doar pentru curățenia testului: jurnalele sunt append-only
+  DELETE FROM public.hr_personal_extern WHERE id IN (%3$s, %4$s) OR lower(nume) = 'trei gracescu';
+  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s);
+  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %9$L) OR employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s);
+  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %9$L);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s);
+  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %9$L);
+  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %10$s);
+  SET session_replication_role = origin;
+  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %9$L);
+$q$, :'u_dr', :'u_ehr', :x1, :x2, :e_dr, :e_f1, :e_f2, :e_g, :'u_dr2', :e_dr2));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2'))
+    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2'))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr, :e_f1, :e_f2, :e_g, :e_dr2))
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr2')
+    AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE id IN (:x1, :x2))
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr')
+    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE profile_id IN (:'u_dr', :'u_ehr', :'u_dr2')),
+  'RACE curățenie: datele comise ale testelor de concurență au fost șterse');
+
 -- R2-28e-lock / X2 (runda 3) — tot aici, înaintea oricărui DDL al tranzacției testului (DROP / CREATE TRIGGER pe profiles și
 -- auth.users ar bloca citirile / verificările FK ale celorlalte conexiuni și testul n-ar mai arăta ce lock așteaptă).
 -- Tranzacția testului încheie fișa A (CNP pe fișă, ca din wizard): garda ia lock-urile persoanei (CNP, cuvintele numelui,
```

---

## ACTUALIZARE r4 (01.10.2026, după NO-GO-ul Copilot pe r3 `dac4bda`)

**context_version:** cod la `187542a`. Commitul include merge-ul cu origin/main `0da2fe8` (J05 #542, monitor egress #543; fără conflicte, fără schimbări pe obiectele c/d/e). NEAPLICAT pe live.

### D (blocker): intrarea retargetată
În `fn_conturi_inchideri_sweep`, după recitirea intrării `x` (sub `FOR UPDATE`):
1. dacă intrarea nu mai există (`NOT FOUND`), e rezolvată sau e abandonată → `CONTINUE` (era deja așa);
2. **nou:** dacă `(x.profile_id, x.employee_id, x.tip) IS DISTINCT FROM (q.profile_id, q.employee_id, q.tip)` → `CONTINUE`.

Fișa B NU se blochează după coadă, ca să nu se inverseze ordinea lock-urilor. Intrarea retargetată se procesează la rularea următoare, cu ordinea corectă. Nicio folosire a lui `x` nu are loc înaintea acestor două verificări.

**Test D-RACE-2** (2 conexiuni, date comise): conexiunea A apelează `fn_cont_coada_pune` (upsert care retargetează employee_id A→B) și ține intrarea necomisă. Sweep-ul pornește și se verifică:
- sweep-ul stă la lock-ul intrării;
- fișa A e deja blocată de sweep (`FOR UPDATE NOWAIT` din altă conexiune → 55P03).

Apoi conexiunea A face COMMIT. Rezultat: sweep `{}`, contul nu se închide, iar intrarea rămâne deschisă pe B, neatinsă (`incercari = 0`).

**Mutație:** fără verificarea nouă, sweep-ul rezolvă intrarea retargetată ca `anulat_conditii` și testul PICĂ.

### Versiuni (blocker operațional)
Versiunile sunt > 20261001184500 (ultima de pe live) și strict crescătoare. Comenzile complete sunt în `docs/CONTURI_CICLU_VIATA.md`.
| Pas | Fișier | Versiune | sha256 |
|---|---|---|---|
| 1 | 20260929c_conturi_legare_automata.sql | `20261001190000` | `9a3e0a133e50a1bc759ccaa4ec5b0c624f9e3516dc81ebe48792221455520d50` (neschimbat față de r3) |
| 2 | 20260929d_conturi_inchidere_la_incetare.sql | `20261001191500` | `d2468bbb60180d3a197960cf29edddaa296d235293eae80362d9f42214ab992d` |
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001193000` | `13a718e94e79ea6719d8ea72a2ff35d0727953b0357beeeff2add255bee6aea8` (varianta C) |

### Preflight live read-only (01.10.2026, după J05 179000 și 543b 184500)
| Verificare | Rezultat |
|---|---|
| ultima versiune | `20261001184500` (20261002a_monitor_egress_fix); înainte: 179000 J05, 178000 30a, 175000 monitor_egress, 170000 P1b |
| md5 `fn_profiles_campuri_owner_only` | `1114af39c13e295dd2ab666dab495567` (= 30a, precondiția c/d) |
| trigger S-A | tgtype 19, tgenabled O, tgfoid = `fn_profiles_campuri_owner_only()` |
| md5 `handle_new_user` | `94e5c5d33116df4466fb2e714887a9b2` (= precondiția c) |
| default ACL postgres/public | tabele: anon/authenticated `arwdxtm` (fără TRUNCATE); funcții: `postgres=X, service_role=X` (după REVOKE-ul din c rămâne `{postgres=X/postgres}`, ca în amprenta helperilor) |
| TRUNCATE anon/authenticated pe tabele public | 0 |
| obiecte c/d/e (funcții, tabele, coloane, triggere, job cron) | niciunul |
| `pgrst.db_pre_request` | nesetat |
| extensions.unaccent, hr_employees_private, hr_personal_extern | prezente |
| gate 0e | **0 rânduri** |

### E (blocker; politica e decizia lui Răzvan)
Problema: un extern ACTIV NELEGAT care exista deja rămâne activ când angajatul devine fost angajat, deși acordul lui nu e „accepta”.

Codul pentru **varianta C** e pregătit local, dar NU e comis, cum s-a cerut:
- **email exact** → dezactivare automată + notificare owner;
- **potrivire doar pe nume** → notificare owner, fără dezactivare.

Testul E-LIFECYCLE-1 (secvențial) e pregătit la fel. Se comite după confirmarea variantei.

### Teste r4
- Harness PG17 `--rollback`: **924 aserțiuni PASS**. Sunt cele 918 din r3 plus 3 aserțiuni D-RACE-2, rulate de două ori.
- Gate 0e pe bază locală după fiecare migrare: c = 0, c+d = 0, c+d+e = 0 rânduri.
- Validator: c OK (48), d OK (96), e OK (54).
- vitest: 1129 PASS. Build: OK.

### Diff r4 (migrări + teste)
```diff
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index 04b8937..8765513 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -855,6 +855,12 @@ BEGIN
       IF NOT FOUND OR x.rezolvat_la IS NOT NULL OR x.abandonat_la IS NOT NULL THEN
         CONTINUE;                                    -- rezolvată între timp (restaurare, închidere manuală, reactivare)
       END IF;
+      -- r4 (Copilot pe dac4bda): upsert-ul fn_cont_coada_pune poate retargeta intrarea (employee_id A→B) cât timp sweep-ul
+      -- aștepta. Fișa blocată mai sus e A; nu blocăm B DUPĂ coadă (ar inversa ordinea fișă → advisory → profil → coadă).
+      -- Intrarea retargetată se procesează la rularea următoare, cu lock-urile luate în ordinea corectă.
+      IF (x.profile_id, x.employee_id, x.tip) IS DISTINCT FROM (q.profile_id, q.employee_id, q.tip) THEN
+        CONTINUE;
+      END IF;
       IF x.tip = 'flaguri' THEN
         IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id) THEN
           v_rezult := 'anulat_profil_inexistent';
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index 107d4e6..78338a8 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -111,16 +111,19 @@ SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'u_lock')
 -- ============================================================ r3 (verdict Copilot pe dad549b): teste de concurență REALE
 -- Două conexiuni (dblink), date comise, ordinea forțată determinist: prima tranzacție ține lock-ul, a doua e pornită și se
 -- verifică faptul că AȘTEAPTĂ (pg_stat_activity.wait_event_type = 'Lock'), apoi prima face COMMIT și se verifică starea finală.
-SELECT gen_random_uuid() AS u_dr, gen_random_uuid() AS u_ehr, gen_random_uuid() AS u_dr2 \gset
+SELECT gen_random_uuid() AS u_dr, gen_random_uuid() AS u_ehr, gen_random_uuid() AS u_dr2, gen_random_uuid() AS u_dr3 \gset
 SELECT teste.dblink_exec(:'conn_lock', format($q$
   INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
   VALUES (%1$L, 'authenticated', 'authenticated', 'drace.unu@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
          (%2$L, 'authenticated', 'authenticated', 'erace.hr@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
-         (%3$L, 'authenticated', 'authenticated', 'drace.doi@exemplu.ro', '{"provider":"email"}', now(), now(), now());
+         (%3$L, 'authenticated', 'authenticated', 'drace.doi@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
+         (%4$L, 'authenticated', 'authenticated', 'drace.trei@exemplu.ro', '{"provider":"email"}', now(), now(), now());
   UPDATE public.profiles SET can_modify_employees = true WHERE id = %2$L;
   INSERT INTO public.employees (name, department, email, active, termination_date) VALUES
     ('DRACESCU UNU', 'Test', 'drace.unu@exemplu.ro', false, CURRENT_DATE),
     ('DRACESCU DOI', 'Test', 'drace.doi@exemplu.ro', false, CURRENT_DATE),   -- CNP pus mai jos (garda „aceeași persoană”)
+    ('DRACESCU TREI', 'Test', 'drace.trei@exemplu.ro', false, CURRENT_DATE),
+    ('DRACESCU PATRU', 'Test', 'drace.patru@exemplu.ro', false, CURRENT_DATE),
     ('ERACESCU UNU', 'Test', 'erace.unu@exemplu.ro', false, CURRENT_DATE - 1),
     ('ERACESCU DOI', 'Test', 'erace.doi@exemplu.ro', false, CURRENT_DATE - 1),
     ('GRACESCU TREI', 'Test', 'grace.trei@exemplu.ro', true, NULL);
@@ -131,10 +134,16 @@ SELECT teste.dblink_exec(:'conn_lock', format($q$
   INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
   SELECT %3$L, id, 'programata', 'test D-RACE-1b', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU DOI';
   UPDATE public.employees SET cnp = '1900303000085' WHERE name = 'DRACESCU DOI';
-$q$, :'u_dr', :'u_ehr', :'u_dr2'));
-SELECT max(id) FILTER (WHERE name = 'DRACESCU DOI') AS e_dr2, max(id) FILTER (WHERE name = 'DRACESCU UNU') AS e_dr, max(id) FILTER (WHERE name = 'ERACESCU UNU') AS e_f1,
+  UPDATE public.employees SET cnp = '1900303000093' WHERE name = 'DRACESCU TREI';
+  UPDATE public.employees SET cnp = '1900303000107' WHERE name = 'DRACESCU PATRU';
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU TREI') WHERE id = %4$L;
+  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
+  SELECT %4$L, id, 'programata', 'test D-RACE-2', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU TREI';
+$q$, :'u_dr', :'u_ehr', :'u_dr2', :'u_dr3'));
+SELECT max(id) FILTER (WHERE name = 'DRACESCU TREI') AS e_dr3a, max(id) FILTER (WHERE name = 'DRACESCU PATRU') AS e_dr3b,
+       max(id) FILTER (WHERE name = 'DRACESCU DOI') AS e_dr2, max(id) FILTER (WHERE name = 'DRACESCU UNU') AS e_dr, max(id) FILTER (WHERE name = 'ERACESCU UNU') AS e_f1,
        max(id) FILTER (WHERE name = 'ERACESCU DOI') AS e_f2, max(id) FILTER (WHERE name = 'GRACESCU TREI') AS e_g
-  FROM public.employees WHERE name IN ('DRACESCU DOI', 'DRACESCU UNU', 'ERACESCU UNU', 'ERACESCU DOI', 'GRACESCU TREI') \gset
+  FROM public.employees WHERE name IN ('DRACESCU TREI', 'DRACESCU PATRU', 'DRACESCU DOI', 'DRACESCU UNU', 'ERACESCU UNU', 'ERACESCU DOI', 'GRACESCU TREI') \gset
 -- acordul „accepta” și externii legați (inactivi) — puse de un OM din HR (JWT prin authenticator), ca în aplicație
 SELECT teste.dblink_connect('c_hr1', :'conn_lock');
 SELECT teste.dblink_connect('c_hr2', :'conn_lock');
@@ -191,6 +200,28 @@ SELECT count(*) AS rest_dr2 FROM teste.dblink_get_result('c_dsw') AS t(res text)
 SELECT teste.assert(EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr2' AND restaurat_la IS NULL),
   'D-RACE-1b după eliberarea profilului sweep-ul închide contul (data încetării = azi, citită sub lock-ul fișei)');
 SELECT teste.dblink_disconnect('c_tine2');
+
+-- D-RACE-2 (r4): intrarea e RETARGETATĂ (fn_cont_coada_pune, upsert employee_id A→B) cât timp sweep-ul a blocat deja fișa A
+-- și stă la lock-ul intrării. După recitire sweep-ul vede (profil, fișă, tip) schimbat ⇒ CONTINUE: nu închide, nu rezolvă
+-- intrarea, nu blochează fișa B după coadă (ordinea lock-urilor rămâne fișă → advisory → profil → coadă).
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr3'));
+SELECT teste.dblink_connect('c_tine3', :'conn_lock');
+SELECT teste.dblink_exec('c_tine3', 'BEGIN');
+SELECT * FROM teste.dblink('c_tine3', format($q$SELECT public.fn_cont_coada_pune(%L, %s, 'programata', 'retargetare A→B (test D-RACE-2)', CURRENT_DATE)::text$q$,
+  :'u_dr3', :e_dr3b)) AS t(x text);
+SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
+SELECT teste.assert(teste.asteapta_lock(:pid_dsw), 'D-RACE-2 pregătire: sweep-ul stă la lock-ul intrării (retargetare necomisă)');
+SELECT res AS nowait_dr3 FROM teste.dblink('c_pg', format($q$SELECT COALESCE(teste.eroare('SELECT 1 FROM public.employees WHERE id = %s FOR UPDATE NOWAIT')::text, 'OK')$q$, :e_dr3a)) AS t(res text) \gset
+SELECT teste.assert(:'nowait_dr3' ~ '"state": "55P03"', 'D-RACE-2 sweep-ul ține deja fișa A (blocată înaintea cozii)');
+SELECT teste.dblink_exec('c_tine3', 'COMMIT');
+SELECT res AS sweep_dr3 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+SELECT count(*) AS rest_dr3 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+\echo '   D-RACE-2 sweep:' :sweep_dr3
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr3')
+    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_coada
+          WHERE profile_id = :'u_dr3' AND rezolvat_la IS NULL AND employee_id = :e_dr3b AND incercari = 0),
+  'D-RACE-2 intrarea retargetată A→B e sărită (CONTINUE): contul nu se închide, intrarea rămâne deschisă pe B, neatinsă');
+SELECT teste.dblink_disconnect('c_tine3');
 SELECT teste.dblink_disconnect('c_dsw');
 
 -- E-RACE-1: activarea externului (necomisă) ↔ acordul trece accepta → refuza.
@@ -239,15 +270,17 @@ SELECT teste.dblink_exec(:'conn_lock', format($q$
   SET session_replication_role = replica;               -- doar pentru curățenia testului: jurnalele sunt append-only
   DELETE FROM public.hr_personal_extern WHERE id IN (%3$s, %4$s) OR lower(nume) = 'trei gracescu';
   DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s);
-  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %9$L) OR employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s);
-  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %9$L);
-  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s);
-  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %9$L);
-  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %10$s);
+  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %9$L, %11$L) OR employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s);
+  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %9$L, %11$L);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s);
+  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %9$L, %11$L);
+  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s);
   SET session_replication_role = origin;
-  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %9$L);
-$q$, :'u_dr', :'u_ehr', :x1, :x2, :e_dr, :e_f1, :e_f2, :e_g, :'u_dr2', :e_dr2));
-SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2'))
+  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %9$L, %11$L);
+$q$, :'u_dr', :'u_ehr', :x1, :x2, :e_dr, :e_f1, :e_f2, :e_g, :'u_dr2', :e_dr2, :'u_dr3', :e_dr3a, :e_dr3b));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2', :'u_dr3'))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr3a, :e_dr3b))
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr3')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2'))
     AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr, :e_f1, :e_f2, :e_g, :e_dr2))
     AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr2')
```

### E: varianta C aprobată de Răzvan (commit `f411d9e`)
Se aplică doar la TRECEREA unei fișe în „fost angajat” (nu era înainte, este după UPDATE). Atunci, în `fn_employees_colab_ext_after`, pentru externii ACTIVI și NELEGAȚI:
- **email identic** (lower/trim) → `activ = false` + notificare owner `extern_fost_angajat_dezactivat`. Reactivarea o face un om, prin HR → Foști angajați, cu acord;
- **potrivire doar pe nume** (aceeași regulă ca `fn_extern_fost_angajat_potrivire`: numele de familie al fișei e în numele externului, iar un set de cuvinte îl conține pe celălalt) → notificare owner `extern_fost_angajat_omonim`, FĂRĂ dezactivare.

Triggerul `trg_employees_zz_colab_ext` se declanșează acum și la schimbarea `termination_date`. Lock-urile pe identitate (`trg_employees_colab_ext_lock`) sunt deja ținute, deci nu apare o cursă cu un extern nou. Helperii folosiți (`fn_nume_cuvinte`, `fn_nume_familie`, `fn_cont_notifica_owneri`) sunt în amprenta din precondiția lui e.

**E-LIFECYCLE-1** (secvențial):
- externul cu emailul fostului angajat e dezactivat;
- externul potrivit doar pe nume rămâne activ;
- externul fără potrivire e neatins;
- owner-ul primește ambele notificări;
- UPDATE-urile ulterioare pe fișa deja fostă nu mai notifică.

**Teste finale:** harness PG17 `--rollback`: **934 aserțiuni PASS**. Gate 0e: c = 0, c+d = 0, c+d+e = 0. Validator: e OK (54).

**sha256 finale:** c `9a3e0a13…`, d `d2468bbb…`, e `13a718e9…` (complete în tabelul de mai sus și în `docs/CONTURI_CICLU_VIATA.md`, cu comenzile runner-ului).

```diff
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
index c8e0cbe..917a7b9 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
@@ -385,6 +385,13 @@ AS $fn$
 DECLARE
   v_reset boolean := (OLD.active IS NOT TRUE AND NEW.active IS TRUE)
                      OR (OLD.termination_date IS NOT NULL AND NEW.termination_date IS DISTINCT FROM OLD.termination_date);
+  -- r4 (varianta C, decizia lui Răzvan): fișa DEVINE „fost angajat” acum (nu era înainte, este după)
+  v_devine_fost boolean := (NEW.termination_date IS NOT NULL AND NEW.termination_date <= CURRENT_DATE AND NEW.active IS NOT TRUE)
+                           AND NOT (OLD.termination_date IS NOT NULL AND OLD.termination_date <= CURRENT_DATE AND OLD.active IS NOT TRUE);
+  v_em    text := lower(btrim(COALESCE(NEW.email, '')));
+  v_cuv   text[] := public.fn_nume_cuvinte(NEW.name);
+  v_fam   text := public.fn_nume_familie(NEW.name);
+  x       record;
 BEGIN
   IF OLD.colaborare_externa_status   IS DISTINCT FROM NEW.colaborare_externa_status
      OR OLD.colaborare_externa_nota     IS DISTINCT FROM NEW.colaborare_externa_nota
@@ -407,6 +414,34 @@ BEGIN
     UPDATE public.hr_personal_extern SET activ = false, updated_at = now()
      WHERE fost_angajat_employee_id = NEW.id AND activ;
   END IF;
+  -- r4 (E-LIFECYCLE, varianta C): externii ACTIVI NELEGAȚI care existau deja cu identitatea omului care tocmai a plecat.
+  --   * email identic  → dezactivare automată (direcția sigură; activarea o face din nou un om) + notificare owner;
+  --   * doar pe nume   → notificare owner, FĂRĂ dezactivare (poate fi altă persoană cu același nume).
+  -- Lock-urile advisory pe identitate sunt deja ținute (trg_employees_colab_ext_lock) ⇒ fără cursă cu un extern nou.
+  IF v_devine_fost THEN
+    FOR x IN
+      SELECT h.id, h.nume, (v_em <> '' AND lower(btrim(COALESCE(h.email, ''))) = v_em) AS pe_email
+        FROM public.hr_personal_extern h
+       WHERE h.fost_angajat_employee_id IS NULL AND h.activ IS TRUE
+         AND ((v_em <> '' AND lower(btrim(COALESCE(h.email, ''))) = v_em)
+              OR (cardinality(v_cuv) >= 2 AND cardinality(public.fn_nume_cuvinte(h.nume)) >= 2 AND v_fam = ANY (public.fn_nume_cuvinte(h.nume))
+                  AND (public.fn_nume_cuvinte(h.nume) <@ v_cuv OR v_cuv <@ public.fn_nume_cuvinte(h.nume))))
+       ORDER BY h.id
+    LOOP
+      IF x.pe_email THEN
+        UPDATE public.hr_personal_extern SET activ = false, updated_at = now() WHERE id = x.id;
+        PERFORM public.fn_cont_notifica_owneri('extern_fost_angajat_dezactivat', '⏸ Extern dezactivat: e fost angajat Gazpet',
+          format('Externul #%s %s are emailul fișei #%s %s, al cărei contract s-a încheiat. Colaborarea a fost oprită automat; se reactivează prin HR → Foști angajați, cu acordul lui.',
+                 x.id, x.nume, NEW.id, NEW.name),
+          '/hr?tab=fosti');
+      ELSE
+        PERFORM public.fn_cont_notifica_owneri('extern_fost_angajat_omonim', '⚠ Extern activ cu numele unui fost angajat',
+          format('Externul #%s %s are același nume ca fișa #%s %s, al cărei contract s-a încheiat. Nu l-am dezactivat (poate fi altă persoană): verifică și, dacă e același om, trece-l prin HR → Foști angajați.',
+                 x.id, x.nume, NEW.id, NEW.name),
+          '/hr?tab=fosti');
+      END IF;
+    END LOOP;
+  END IF;
   RETURN NULL;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_employees_colab_ext_after() FROM PUBLIC, anon, authenticated, service_role;
@@ -415,7 +450,8 @@ CREATE TRIGGER trg_employees_zz_colab_ext AFTER UPDATE ON public.employees FOR E
   WHEN (OLD.colaborare_externa_status   IS DISTINCT FROM NEW.colaborare_externa_status
      OR OLD.colaborare_externa_nota     IS DISTINCT FROM NEW.colaborare_externa_nota
      OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document
-     OR OLD.active IS DISTINCT FROM NEW.active)
+     OR OLD.active IS DISTINCT FROM NEW.active
+     OR OLD.termination_date IS DISTINCT FROM NEW.termination_date)
   EXECUTE FUNCTION public.fn_employees_colab_ext_after();
 
 -- C.6 Funcțiile apelabile din UI (poartă: owner sau can_modify_employees, în cod) ----
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index 78338a8..dcea6fa 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -2634,6 +2634,36 @@ SELECT teste.assert(NOT has_function_privilege('service_role', 'public.fn_colabo
     AND NOT has_function_privilege('service_role', 'public.fn_fost_angajat_leaga_extern(integer,bigint)', 'EXECUTE'),
   'R3-25 P3: RPC-urile R3 (decizia unui om) fără EXECUTE pentru service_role');
 
+-- E-LIFECYCLE-1 (r4, varianta C): externi ACTIVI NELEGAȚI care existau deja când omul devine fost angajat.
+--   email identic → dezactivare automată + notificare owner; doar nume → notificare owner, fără dezactivare;
+--   un extern fără nicio potrivire și unul legat de altă fișă nu sunt atinși.
+SELECT teste.ca_admin();
+INSERT INTO public.employees (name, department, email, active) VALUES ('LIFECU ANA', 'Test', 'lifecu.ana@exemplu.ro', true) RETURNING id AS el_ana \gset
+INSERT INTO public.employees (name, department, email, active) VALUES ('LIFECU BOGDAN', 'Test', 'lifecu.bogdan@exemplu.ro', true) RETURNING id AS el_bog \gset
+INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Firma Ana Extern', 'Lifecu.Ana@exemplu.ro ', true) RETURNING id AS xl_em \gset
+INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Bogdan Lifecu', 'alt.email@exemplu.ro', true) RETURNING id AS xl_nume \gset
+INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Lifecu Neinrudit Total', NULL, true) RETURNING id AS xl_nu \gset
+SELECT count(*) AS n_notif_el FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim') \gset
+UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id IN (:el_ana, :el_bog);
+SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl_em),
+  'E-LIFECYCLE-1 extern activ nelegat cu EMAILUL fostului angajat → dezactivat automat');
+SELECT teste.assert((SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :xl_nume),
+  'E-LIFECYCLE-1 extern activ nelegat potrivit DOAR pe nume → rămâne activ (poate fi altă persoană)');
+SELECT teste.assert((SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :xl_nu),
+  'E-LIFECYCLE-1 extern fără potrivire (alt nume de familie în poziția fișei, alt email) → neatins');
+SELECT teste.assert(EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_dezactivat'
+                             AND message LIKE '%#' || :xl_em || '%')
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_omonim'
+                 AND message LIKE '%#' || :xl_nume || '%')
+    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE type LIKE 'extern_fost_angajat_%' AND message LIKE '%#' || :xl_nu || ' %'),
+  'E-LIFECYCLE-1 owner-ul primește notificare pentru ambele (dezactivat / omonim), nimic pentru externul fără potrivire');
+SELECT count(*) AS n_notif_el2 FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim') \gset
+UPDATE public.employees SET observatii_hr = 'fără legătură' WHERE id = :el_ana;
+UPDATE public.employees SET termination_date = CURRENT_DATE - 1 WHERE id = :el_bog;   -- rămâne fost angajat: nu e o nouă plecare
+SELECT teste.assert(:n_notif_el2 > :n_notif_el
+    AND (SELECT count(*) FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim')) = :n_notif_el2,
+  'E-LIFECYCLE-1 doar TRECEREA în „fost angajat” declanșează verificarea (alte UPDATE-uri pe fișa deja fostă nu re-notifică)');
+
 \endif
 
 ROLLBACK;
```

---

## ACTUALIZARE r5 (01.10.2026, după verdictul Copilot pe r4 `4fe4824`: c GO, d și e NO-GO)

**context_version:** cod la `4e0c49e`. NEAPLICAT pe live.

### d: D-ERR-IDENTITY
În handlerul EXCEPTION al `fn_conturi_inchideri_sweep`, UPDATE-ul de backoff (incercari, ultima_eroare, urmatoarea_incercare_la, abandonat_la) are acum în plus condiția `AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)`. Dacă rezultatul e NOT FOUND, nu se face backoff, nu se trimite notificare și nu se setează `notificat_la` (toate erau deja sub `IF FOUND`).

**Test D-RACE-ERR** (2 conexiuni, date comise):
1. O conexiune ține profilul. Sweep-ul pornește cu `lock_timeout = 2s` și așteaptă profilul.
2. Retargetarea A→B (`fn_cont_coada_pune`) se comite cât timp sweep-ul așteaptă.
3. La ~2s apare eroarea forțată (55P03). Handlerul re-așteaptă profilul.
4. La 3s profilul e eliberat, iar handlerul face UPDATE-ul de backoff.

Rezultat: sweep `eroare = 1`, iar intrarea B rămâne cu `incercari = 0`, fără `ultima_eroare`, fără backoff, neabandonată și nenotificată. Testul se bazează pe timp (2s lock_timeout, eliberare la 3s), cu o marjă de ~1s.

**Mutație:** fără condiția nouă, testul PICĂ (B primește eroarea lui A).

### e: varianta A (decizia lui Răzvan, E-LIFECYCLE-2)
`v_devine_fost = OLD.active IS TRUE AND NEW.active IS NOT TRUE`. Politica C (email identic → dezactivare + notificare; doar nume → notificare) se aplică la dezactivarea fișei, indiferent de `termination_date`: dată trecută, dată viitoare sau fără dată. La scadență nu mai vine niciun UPDATE, deci verificarea se face anticipat.

**E-LIFECYCLE-2:**
- dezactivare cu dată viitoare (+30 zile) → externul pe email e dezactivat imediat, cel pe nume rămâne activ, owner-ul e notificat pentru ambii;
- dezactivare fără dată → externul pe email e dezactivat.

E-LIFECYCLE-1 trece neschimbat, inclusiv „UPDATE-urile ulterioare pe fișa deja inactivă nu re-notifică”.

**Mutație:** cu condiția din r4 (doar fost angajat cu dată ≤ azi), E-LIFECYCLE-2 PICĂ.

### sha256 și versiuni (r5; versiunile sunt cele acceptate de Copilot)
| Pas | Fișier | Versiune | sha256 |
|---|---|---|---|
| 1 | 20260929c_conturi_legare_automata.sql | `20261001210000` | `9a3e0a133e50a1bc759ccaa4ec5b0c624f9e3516dc81ebe48792221455520d50` (GO, neschimbat) |
| 2 | 20260929d_conturi_inchidere_la_incetare.sql | `20261001211500` | `28ba72ca6abcc73f72aa810c769d1a233bcadf943ffcd1589afd0dac9b1b6052` |
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001213000` | `6c6522034516c135926fc197a67eac60da8a13c1672b63159b674264a50da498` |

ROLLBACK-urile sunt neschimbate: c `3e7b3af6…`, d `c2e41e0e…`, e `5db7153f…`. Comenzile runner-ului sunt în `docs/CONTURI_CICLU_VIATA.md`.

### Teste r5
- Harness PG17 `--rollback`: **946 aserțiuni PASS** (include D-RACE-ERR și E-LIFECYCLE-2, rulate de două ori).
- Gate 0e pe bază locală după fiecare migrare: c = 0, c+d = 0, c+d+e = 0.
- Validator: c OK (48), d OK (96), e OK (54).
- Preflight-ul live din r4 rămâne valabil. Ultima versiune pe live era 20261001184500; noile versiuni sunt > 184500.

### Diff r5 (migrări + teste)
```diff
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index 8765513..e3cdc4b 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -920,6 +920,9 @@ BEGIN
                urmatoarea_incercare_la = now() + least(interval '5 minutes' * power(2, incercari), interval '6 hours'),
                abandonat_la = CASE WHEN incercari + 1 >= c_max_incercari THEN now() END
          WHERE id = q.id AND rezolvat_la IS NULL
+           -- r5 (D-ERR-IDENTITY): backoff / abandon / notificare DOAR pe intrarea pe care a lucrat sweep-ul; una retargetată
+           -- între timp (fn_cont_coada_pune: employee_id A→B) nu primește eroarea altei fișe ⇒ NOT FOUND, nimic de făcut
+           AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)
         RETURNING * INTO x;
         IF FOUND THEN
           v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
index 917a7b9..0e75f3e 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
@@ -385,9 +385,10 @@ AS $fn$
 DECLARE
   v_reset boolean := (OLD.active IS NOT TRUE AND NEW.active IS TRUE)
                      OR (OLD.termination_date IS NOT NULL AND NEW.termination_date IS DISTINCT FROM OLD.termination_date);
-  -- r4 (varianta C, decizia lui Răzvan): fișa DEVINE „fost angajat” acum (nu era înainte, este după)
-  v_devine_fost boolean := (NEW.termination_date IS NOT NULL AND NEW.termination_date <= CURRENT_DATE AND NEW.active IS NOT TRUE)
-                           AND NOT (OLD.termination_date IS NOT NULL AND OLD.termination_date <= CURRENT_DATE AND OLD.active IS NOT TRUE);
+  -- r4 (varianta C) + r5 (varianta A, decizia lui Răzvan, E-LIFECYCLE-2): politica C se aplică din momentul în care fișa
+  -- trece din activă în inactivă, INDIFERENT de termination_date (și o dată de încetare viitoare: la scadență nu mai vine
+  -- niciun UPDATE, deci verificarea se face anticipat, la programare).
+  v_devine_fost boolean := OLD.active IS TRUE AND NEW.active IS NOT TRUE;
   v_em    text := lower(btrim(COALESCE(NEW.email, '')));
   v_cuv   text[] := public.fn_nume_cuvinte(NEW.name);
   v_fam   text := public.fn_nume_familie(NEW.name);
@@ -414,7 +415,8 @@ BEGIN
     UPDATE public.hr_personal_extern SET activ = false, updated_at = now()
      WHERE fost_angajat_employee_id = NEW.id AND activ;
   END IF;
-  -- r4 (E-LIFECYCLE, varianta C): externii ACTIVI NELEGAȚI care existau deja cu identitatea omului care tocmai a plecat.
+  -- r4 (E-LIFECYCLE, varianta C): externii ACTIVI NELEGAȚI care existau deja cu identitatea omului care tocmai a fost
+  -- dezactivat (r5: la dezactivare, chiar dacă data încetării e în viitor).
   --   * email identic  → dezactivare automată (direcția sigură; activarea o face din nou un om) + notificare owner;
   --   * doar pe nume   → notificare owner, FĂRĂ dezactivare (poate fi altă persoană cu același nume).
   -- Lock-urile advisory pe identitate sunt deja ținute (trg_employees_colab_ext_lock) ⇒ fără cursă cu un extern nou.
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index dcea6fa..9136044 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -111,19 +111,22 @@ SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'u_lock')
 -- ============================================================ r3 (verdict Copilot pe dad549b): teste de concurență REALE
 -- Două conexiuni (dblink), date comise, ordinea forțată determinist: prima tranzacție ține lock-ul, a doua e pornită și se
 -- verifică faptul că AȘTEAPTĂ (pg_stat_activity.wait_event_type = 'Lock'), apoi prima face COMMIT și se verifică starea finală.
-SELECT gen_random_uuid() AS u_dr, gen_random_uuid() AS u_ehr, gen_random_uuid() AS u_dr2, gen_random_uuid() AS u_dr3 \gset
+SELECT gen_random_uuid() AS u_dr, gen_random_uuid() AS u_ehr, gen_random_uuid() AS u_dr2, gen_random_uuid() AS u_dr3, gen_random_uuid() AS u_dr4 \gset
 SELECT teste.dblink_exec(:'conn_lock', format($q$
   INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
   VALUES (%1$L, 'authenticated', 'authenticated', 'drace.unu@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
          (%2$L, 'authenticated', 'authenticated', 'erace.hr@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
          (%3$L, 'authenticated', 'authenticated', 'drace.doi@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
-         (%4$L, 'authenticated', 'authenticated', 'drace.trei@exemplu.ro', '{"provider":"email"}', now(), now(), now());
+         (%4$L, 'authenticated', 'authenticated', 'drace.trei@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
+         (%5$L, 'authenticated', 'authenticated', 'drace.cinci@exemplu.ro', '{"provider":"email"}', now(), now(), now());
   UPDATE public.profiles SET can_modify_employees = true WHERE id = %2$L;
   INSERT INTO public.employees (name, department, email, active, termination_date) VALUES
     ('DRACESCU UNU', 'Test', 'drace.unu@exemplu.ro', false, CURRENT_DATE),
     ('DRACESCU DOI', 'Test', 'drace.doi@exemplu.ro', false, CURRENT_DATE),   -- CNP pus mai jos (garda „aceeași persoană”)
     ('DRACESCU TREI', 'Test', 'drace.trei@exemplu.ro', false, CURRENT_DATE),
     ('DRACESCU PATRU', 'Test', 'drace.patru@exemplu.ro', false, CURRENT_DATE),
+    ('DRACESCU CINCI', 'Test', 'drace.cinci@exemplu.ro', false, CURRENT_DATE),
+    ('DRACESCU SASE', 'Test', 'drace.sase@exemplu.ro', false, CURRENT_DATE),
     ('ERACESCU UNU', 'Test', 'erace.unu@exemplu.ro', false, CURRENT_DATE - 1),
     ('ERACESCU DOI', 'Test', 'erace.doi@exemplu.ro', false, CURRENT_DATE - 1),
     ('GRACESCU TREI', 'Test', 'grace.trei@exemplu.ro', true, NULL);
@@ -139,11 +142,17 @@ SELECT teste.dblink_exec(:'conn_lock', format($q$
   UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU TREI') WHERE id = %4$L;
   INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
   SELECT %4$L, id, 'programata', 'test D-RACE-2', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU TREI';
-$q$, :'u_dr', :'u_ehr', :'u_dr2', :'u_dr3'));
-SELECT max(id) FILTER (WHERE name = 'DRACESCU TREI') AS e_dr3a, max(id) FILTER (WHERE name = 'DRACESCU PATRU') AS e_dr3b,
+  UPDATE public.employees SET cnp = '1900303000115' WHERE name = 'DRACESCU CINCI';
+  UPDATE public.employees SET cnp = '1900303000123' WHERE name = 'DRACESCU SASE';
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU CINCI') WHERE id = %5$L;
+  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
+  SELECT %5$L, id, 'programata', 'test D-RACE-ERR', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU CINCI';
+$q$, :'u_dr', :'u_ehr', :'u_dr2', :'u_dr3', :'u_dr4'));
+SELECT max(id) FILTER (WHERE name = 'DRACESCU CINCI') AS e_dr4a, max(id) FILTER (WHERE name = 'DRACESCU SASE') AS e_dr4b,
+       max(id) FILTER (WHERE name = 'DRACESCU TREI') AS e_dr3a, max(id) FILTER (WHERE name = 'DRACESCU PATRU') AS e_dr3b,
        max(id) FILTER (WHERE name = 'DRACESCU DOI') AS e_dr2, max(id) FILTER (WHERE name = 'DRACESCU UNU') AS e_dr, max(id) FILTER (WHERE name = 'ERACESCU UNU') AS e_f1,
        max(id) FILTER (WHERE name = 'ERACESCU DOI') AS e_f2, max(id) FILTER (WHERE name = 'GRACESCU TREI') AS e_g
-  FROM public.employees WHERE name IN ('DRACESCU TREI', 'DRACESCU PATRU', 'DRACESCU DOI', 'DRACESCU UNU', 'ERACESCU UNU', 'ERACESCU DOI', 'GRACESCU TREI') \gset
+  FROM public.employees WHERE name IN ('DRACESCU CINCI', 'DRACESCU SASE', 'DRACESCU TREI', 'DRACESCU PATRU', 'DRACESCU DOI', 'DRACESCU UNU', 'ERACESCU UNU', 'ERACESCU DOI', 'GRACESCU TREI') \gset
 -- acordul „accepta” și externii legați (inactivi) — puse de un OM din HR (JWT prin authenticator), ca în aplicație
 SELECT teste.dblink_connect('c_hr1', :'conn_lock');
 SELECT teste.dblink_connect('c_hr2', :'conn_lock');
@@ -222,6 +231,35 @@ SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WH
           WHERE profile_id = :'u_dr3' AND rezolvat_la IS NULL AND employee_id = :e_dr3b AND incercari = 0),
   'D-RACE-2 intrarea retargetată A→B e sărită (CONTINUE): contul nu se închide, intrarea rămâne deschisă pe B, neatinsă');
 SELECT teste.dblink_disconnect('c_tine3');
+
+-- D-RACE-ERR (r5, D-ERR-IDENTITY): eroare FORȚATĂ în sweep (lock_timeout la profilul ținut de altă tranzacție) cât timp
+-- intrarea e retargetată A→B și comisă. Handlerul de eroare face backoff / abandon / notificare DOAR dacă intrarea are încă
+-- (profil, fișă, tip) de la selecție; altfel NOT FOUND ⇒ nimic. Cronologie (lock_timeout 2s): t0 sweep-ul așteaptă profilul;
+-- retargetarea se comite; ~t0+2s prima eroare (55P03) → handlerul re-așteaptă profilul; t0+3s profilul e eliberat → handlerul
+-- își face UPDATE-ul de backoff pe o intrare care nu mai e a lui.
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr4'));
+SELECT teste.dblink_connect('c_tine4', :'conn_lock');
+SELECT teste.dblink_exec('c_tine4', 'BEGIN');
+SELECT * FROM teste.dblink('c_tine4', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_dr4')) AS t(id text);
+SELECT teste.dblink_exec('c_dsw', 'SET lock_timeout = ''2s''');
+SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
+SELECT teste.assert(teste.asteapta_lock(:pid_dsw), 'D-RACE-ERR pregătire: sweep-ul așteaptă profilul (ținut de altă tranzacție)');
+SELECT * FROM teste.dblink(:'conn_lock', format($q$SELECT public.fn_cont_coada_pune(%L, %s, 'programata', 'retargetare A→B (test D-RACE-ERR)', CURRENT_DATE)::text$q$,
+  :'u_dr4', :e_dr4b)) AS t(x text);
+SELECT pg_sleep(3);
+SELECT teste.dblink_exec('c_tine4', 'ROLLBACK');
+SELECT res AS sweep_dr4 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+SELECT count(*) AS rest_dr4 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
+SELECT teste.dblink_exec('c_dsw', 'RESET lock_timeout');
+\echo '   D-RACE-ERR sweep:' :sweep_dr4
+SELECT teste.assert((:'sweep_dr4'::jsonb ->> 'eroare')::int = 1,
+  'D-RACE-ERR eroarea forțată a ajuns în handlerul sweep-ului (rezultat: eroare = 1)');
+SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_coada
+                      WHERE profile_id = :'u_dr4' AND rezolvat_la IS NULL AND employee_id = :e_dr4b AND incercari = 0
+                        AND ultima_eroare IS NULL AND urmatoarea_incercare_la IS NULL AND abandonat_la IS NULL AND notificat_la IS NULL)
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr4'),
+  'D-RACE-ERR intrarea retargetată pe B rămâne curată: incercari = 0, fără ultima_eroare, fără backoff, neabandonată, nenotificată');
+SELECT teste.dblink_disconnect('c_tine4');
 SELECT teste.dblink_disconnect('c_dsw');
 
 -- E-RACE-1: activarea externului (necomisă) ↔ acordul trece accepta → refuza.
@@ -270,15 +308,17 @@ SELECT teste.dblink_exec(:'conn_lock', format($q$
   SET session_replication_role = replica;               -- doar pentru curățenia testului: jurnalele sunt append-only
   DELETE FROM public.hr_personal_extern WHERE id IN (%3$s, %4$s) OR lower(nume) = 'trei gracescu';
   DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s);
-  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %9$L, %11$L) OR employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s);
-  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %9$L, %11$L);
-  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s);
-  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %9$L, %11$L);
-  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s);
+  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %9$L, %11$L, %14$L) OR employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s, %15$s, %16$s);
+  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %9$L, %11$L, %14$L);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s, %15$s, %16$s);
+  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %9$L, %11$L, %14$L);
+  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s, %15$s, %16$s);
   SET session_replication_role = origin;
-  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %9$L, %11$L);
-$q$, :'u_dr', :'u_ehr', :x1, :x2, :e_dr, :e_f1, :e_f2, :e_g, :'u_dr2', :e_dr2, :'u_dr3', :e_dr3a, :e_dr3b));
-SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2', :'u_dr3'))
+  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %9$L, %11$L, %14$L);
+$q$, :'u_dr', :'u_ehr', :x1, :x2, :e_dr, :e_f1, :e_f2, :e_g, :'u_dr2', :e_dr2, :'u_dr3', :e_dr3a, :e_dr3b, :'u_dr4', :e_dr4a, :e_dr4b));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2', :'u_dr3', :'u_dr4'))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr4a, :e_dr4b))
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr4')
     AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr3a, :e_dr3b))
     AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr3')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2'))
@@ -2664,6 +2704,27 @@ SELECT teste.assert(:n_notif_el2 > :n_notif_el
     AND (SELECT count(*) FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim')) = :n_notif_el2,
   'E-LIFECYCLE-1 doar TRECEREA în „fost angajat” declanșează verificarea (alte UPDATE-uri pe fișa deja fostă nu re-notifică)');
 
+-- E-LIFECYCLE-2 (r5, varianta A): dezactivare cu termination_date în VIITOR — la scadență nu mai vine niciun UPDATE, deci
+-- politica C se aplică anticipat, la dezactivare; trecerea timpului (fără UPDATE) nu mai are ce face.
+INSERT INTO public.employees (name, department, email, active) VALUES ('VIITORU CARMEN', 'Test', 'viitoru.carmen@exemplu.ro', true) RETURNING id AS el2 \gset
+INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Carmen Consult SRL', 'viitoru.carmen@exemplu.ro', true) RETURNING id AS xl2_em \gset
+INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Carmen Viitoru', NULL, true) RETURNING id AS xl2_nume \gset
+UPDATE public.employees SET active = false, termination_date = CURRENT_DATE + 30 WHERE id = :el2;
+SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl2_em)
+    AND (SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :xl2_nume),
+  'E-LIFECYCLE-2 dezactivare cu dată de încetare VIITOARE: externul pe email e dezactivat imediat, cel pe nume rămâne activ');
+SELECT teste.assert(EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_dezactivat'
+                             AND message LIKE '%#' || :xl2_em || '%')
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_omonim'
+                 AND message LIKE '%#' || :xl2_nume || '%'),
+  'E-LIFECYCLE-2 owner-ul e notificat la dezactivare (anticipat), nu abia la data încetării');
+-- și o dezactivare FĂRĂ dată de încetare (varianta A: indiferent de termination_date)
+INSERT INTO public.employees (name, department, email, active) VALUES ('FARADATA DAN', 'Test', 'faradata.dan@exemplu.ro', true) RETURNING id AS el3 \gset
+INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Dan Servicii', 'faradata.dan@exemplu.ro', true) RETURNING id AS xl3_em \gset
+UPDATE public.employees SET active = false WHERE id = :el3;
+SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl3_em),
+  'E-LIFECYCLE-2 dezactivare fără termination_date → aceeași politică (extern pe email dezactivat)');
+
 \endif
 
 ROLLBACK;
```

---

## ACTUALIZARE r6 (01.10.2026, după NO-GO-ul Copilot pe r5 `d0dad52`)

**context_version:** cod la `ca4816d`. Commitul include merge-ul cu origin/main `3228174` (#561, #540, #541; niciuna nu atinge obiectele c/d/e). NEAPLICAT pe live.

Tot ce era în r5 (D-RACE-2, D-ERR-IDENTITY, varianta A) a rămas neschimbat. Am reparat cele 3 invariante și am adăugat hardening-ul cerut.

### 1. C-RACE-LINK-1 (c)
Am adăugat helperul intern `fn_cont_revalideaza_candidat(email, emp)`: SECURITY DEFINER, `search_path` fixat, fără EXECUTE pentru API. Îl cheamă ambele căi de legare după ce profilul e blocat:
1. `employees FOR UPDATE` pe fișa candidată;
2. fișa e încă `active = true` și `termination_date` e NULL sau > azi; altfel → `fara_candidat`;
3. potrivirea recalculată (`fn_cont_candidati_angajat`): 0 candidați → `fara_candidat`; mai mulți, alt candidat sau candidat ocupat → `schimbat`;
4. abia apoi `UPDATE profiles SET employee_id`.

`fn_cont_leaga_automat` blochează acum explicit profilul (`FOR UPDATE`) înaintea fișei. `fn_cont_leaga_la_creare` îl bloca deja la început. Postcondițiile c și ROLLBACK-ul c includ funcția nouă.

**Ordinea lock-urilor:** legarea ia profil → fișă, iar fluxul HR/sweep ia fișă → profil. Un ciclu e posibil doar ca deadlock DETECTAT (40P01). În `fn_cont_leaga_automat` eroarea e prinsă (`rezultat = eroare`), iar în `fn_cont_leaga_la_creare` duce la `eroare` + notificare owner. Nu rezultă niciodată o legare greșită.

**Test C-RACE-LINK-1** (3 conexiuni, date comise, owner comis):
1. conexiunea A ține profilul `FOR UPDATE`;
2. owner-ul aplică `fn_cont_leaga_automat(false, [{profile_id, employee_id}])` și stă la profil, cu candidatul deja calculat;
3. conexiunea C încheie contractul fișei (`active = false`, încetare azi) și comite;
4. A eliberează profilul.

Rezultat: **`fara_candidat`**, iar profilul rămâne nelegat. **Mutație:** fără revalidare, testul pică (se leagă).

### 2. D-RACE-CNP-NULL (d)
Am adăugat cheia advisory stabilă `gazpet.persoana.emp:<employee_id>`. O iau:
- `fn_cont_garda_persoana`, la prima trecere, împreună cu cheile CNP/nume/email; CNP-urile se recalculează după lock, ca înainte;
- `trg_hr_employees_private_persoana_lock`, pentru employee_id vechi și nou, împreună cu cheile CNP.

Ambele trec prin `fn_cont_lock_chei`: aceeași sortare globală după hash.

**Test D-RACE-CNP-NULL** (2 conexiuni, ambele ordini):
- **Ordinea 1:** garda pe fișa fără CNP întoarce `cnp_lipsa` și ține lock-urile. INSERT-ul în `hr_employees_private` (NULL → X) AȘTEAPTĂ.
- **Ordinea 2:** INSERT-ul necomis cu CNP-ul X face garda să AȘTEPTE. După COMMIT, garda vede CNP-ul (rezultat `NULL` = se poate închide, nu `cnp_lipsa`).

**Mutație:** fără cheia fișei în triggerul de pe datele personale, testul pică.

### 3. E-LIFECYCLE-2B (e)
În `fn_hr_personal_extern_fost_angajat`: un extern NELEGAT care devine sau rămâne activ e refuzat cu **23514**, indiferent de `termination_date` și **și pentru owner**, dacă are emailul EXACT (lower/trim, nevid) al unei fișe `active = false`. Verificarea rulează la INSERT, la trecerea activ false → true, la schimbarea emailului și la dezlegare. Excepția owner-ului rămâne doar pentru potrivirea pe nume, cu fostul angajat. Mesajul păstrează „fost angajat Gazpet”, iar HINT-ul trimite la HR → Foști angajați.

**E-LIFECYCLE-2B** (secvențial):
- dezactivare cu încetare peste 30 de zile, apoi reactivarea externului → 23514;
- fără `termination_date` → 23514;
- owner reactivează un extern cu email exact → 23514;
- owner adaugă un extern NOU cu email exact (cu altă scriere a literelor) → 23514;
- owner cu potrivire DOAR pe nume cu un fost angajat → permis.

**Mutație:** fără regula nouă, testul pică.

### 4. Hardening
- **d, postcondiții:** amprentă exactă pentru `fn_identitate_sesiune()` (md5 `7b9a4321…`) și `fn_cont_restaureaza_flaguri(uuid,jsonb)` (md5 `71545de9…`). Se verifică: o singură funcție cu numele respectiv, semnătura, md5 prosrc, SECURITY DEFINER, `proconfig = {"search_path=public, pg_temp"}`, owner postgres și ACL `{postgres=X/postgres}`.
- **e, postcondiții:** `fn_colab_ext_lock` și `fn_employees_colab_ext_lock` sunt incluse acum și în verificările „SECURITY DEFINER fără search_path” și „executabile de anon”, nu doar în „există”.

### Preflight live read-only (01.10.2026, după 20261001201500)
| Verificare | Rezultat |
|---|---|
| ultima versiune | `20261001201500` (20261003e_sec_trezorerie); înainte: 200000 concediu_tokens, 195000 rls_garantii_scriere, 184500 monitor_egress_fix |
| md5 `fn_profiles_campuri_owner_only` | `1114af39…` (precondiția c/d) · trigger S-A: tgtype 19, O, funcția S-A |
| md5 `handle_new_user` | `94e5c5d3…` (precondiția c) |
| default ACL postgres/public | tabele: anon/authenticated fără TRUNCATE; funcții: `postgres=X, service_role=X` (după REVOKE → `{postgres=X/postgres}`) |
| TRUNCATE anon/authenticated | 0 |
| obiecte c/d/e (funcții inclusiv cele noi din r6, tabele, coloane, triggere, cron) | niciunul |
| triggere existente | employees: 0_protectie, audit_del/ins, termination_notify · hr_employees_private: touch · hr_personal_extern: niciunul |
| `pgrst.db_pre_request` | nesetat |
| gate 0e | **0 rânduri** |

### sha256 și versiuni (r6)
Live e la 20261001201500, deci versiunile rămân cele acceptate.
| Pas | Fișier | Versiune | sha256 |
|---|---|---|---|
| 1 | 20260929c_conturi_legare_automata.sql | `20261001210000` | `286e1afb1f15cc316b1565d048e2a282f81d956b27851786e4e6326ae1490eb7` |
| 2 | 20260929d_conturi_inchidere_la_incetare.sql | `20261001211500` | `ddc04baaa48cff28f69ae009f8276b891d935b94aec79571cc7cae410ded52e7` |
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001213000` | `870fdb3f8252e64e4e0ff136a21e2ba431da3e9aee8657448875e47c6745bd59` |
| — | c ROLLBACK | — | `be29df2cf6c1261af75e57d8bd54f3d0b8ebd69b9e39331805debba4200c1592` (nou: DROP `fn_cont_revalideaza_candidat`) |
| — | d / e ROLLBACK | — | `c2e41e0e…` / `5db7153f…` (neschimbate) |

**Atenție:** c s-a schimbat (avea GO în r5), deci verdictul pe c trebuie reînnoit. Amprentele helperilor din c verificate în precondițiile d/e sunt neschimbate; funcțiile respective nu s-au atins.

### Teste r6
- Harness PG17 `--rollback`: **968 aserțiuni PASS**. Sunt incluse C-RACE-LINK-1, D-RACE-CNP-NULL și E-LIFECYCLE-2B, plus toate testele din r1–r5.
- **Mutații** (fix-ul scos, testul pică): C → C-RACE-LINK-1 · D → D-RACE-CNP-NULL · E → E-LIFECYCLE-2B.
- Gate 0e pe bază locală după fiecare migrare: c = 0, c+d = 0, c+d+e = 0.
- Validator: c OK (50), d OK (96), e OK (54).
- vitest: 1129 PASS. Build: OK.

### Diff r6 (migrări + teste)
```diff
diff --git a/supabase/migrations/20260929c_conturi_legare_automata.sql b/supabase/migrations/20260929c_conturi_legare_automata.sql
index 6219e4a..933090d 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata.sql
@@ -425,6 +425,32 @@ REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authentic
 -- legătura încă liberă, tipul contului, emailul profilului = emailul de logare, candidatul UNIC și liber.
 -- Întoarce: legat | legatura_existenta | fara_marcaj_incredere | email_neconfirmat | tip_cont_exceptat | email_diferit |
 --           fara_candidat | ambiguu | candidat_ocupat | inexistent | eroare.
+-- r6 (C-RACE-LINK-1): revalidarea candidatului SUB LOCK, comună celor două căi de legare. Apelantul ține deja profilul
+-- (FOR UPDATE); aici se blochează fișa candidată și se recalculează potrivirea (instrucțiuni noi ⇒ văd ce s-a comis între
+-- timp, ex. încheierea contractului). NULL = se poate lega; altfel rezultatul de întors, fără legare.
+CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_email text, p_emp integer)
+RETURNS text
+LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
+AS $fn$
+DECLARE
+  v_n      integer;
+  v_emp    integer;
+  v_ocupat boolean;
+BEGIN
+  PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;
+  IF NOT EXISTS (SELECT 1 FROM public.employees e
+                  WHERE e.id = p_emp AND e.active IS TRUE AND (e.termination_date IS NULL OR e.termination_date > CURRENT_DATE)) THEN
+    RETURN 'fara_candidat';
+  END IF;
+  SELECT count(*), min(c.employee_id), COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
+    INTO v_n, v_emp, v_ocupat
+    FROM public.fn_cont_candidati_angajat(p_email) c;
+  IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
+  IF v_n <> 1 OR v_emp IS DISTINCT FROM p_emp OR v_ocupat THEN RETURN 'schimbat'; END IF;
+  RETURN NULL;
+END $fn$;
+REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(text, integer) FROM PUBLIC, anon, authenticated, service_role;
+
 CREATE OR REPLACE FUNCTION public.fn_cont_leaga_la_creare(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
@@ -462,6 +488,10 @@ BEGIN
   IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
   IF v_n > 1 THEN RETURN 'ambiguu'; END IF;
   IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
+  -- r6 (C-RACE-LINK-1): fișa candidată blocată (după profil, deja blocat sus) + revalidare sub lock: încă activă, fără
+  -- încetare trecută, potrivirea recalculată identică (un singur candidat, același, neocupat) ⇒ altfel fără legare.
+  v_rez := public.fn_cont_revalideaza_candidat(v_email, v_emp);
+  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
   BEGIN
     UPDATE public.profiles SET employee_id = v_emp
      WHERE id = p_profile_id AND employee_id IS NULL;             -- nu suprascrie niciodată
@@ -614,9 +644,15 @@ BEGIN
         rezultat := 'schimbat';                           -- potrivirea s-a schimbat de la previzualizare
       ELSE
         BEGIN
-          UPDATE public.profiles pr SET employee_id = r.emp
-           WHERE pr.id = r.pid AND pr.employee_id IS NULL;
-          rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
+          -- r6 (C-RACE-LINK-1): profilul, apoi fișa candidată, blocate; revalidare sub lock (activă, fără încetare trecută,
+          -- potrivire recalculată identică). Altfel „schimbat” / „fara_candidat”, fără legare.
+          PERFORM 1 FROM public.profiles pr WHERE pr.id = r.pid FOR UPDATE;
+          rezultat := public.fn_cont_revalideaza_candidat(r.uemail, r.emp);
+          IF rezultat IS NULL THEN
+            UPDATE public.profiles pr SET employee_id = r.emp
+             WHERE pr.id = r.pid AND pr.employee_id IS NULL;
+            rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
+          END IF;
         EXCEPTION
           WHEN unique_violation THEN rezultat := 'candidat_ocupat';
           WHEN OTHERS THEN
@@ -679,15 +715,15 @@ DO $post_livrare$
 DECLARE v_n integer; v_lipsa text[];
 BEGIN
   -- funcțiile migrării există; cele SECURITY DEFINER au search_path fixat; niciuna executabilă de anon (excepții explicite)
-  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[]) f
+  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_revalideaza_candidat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[]) f
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții lipsă după migrare: %', v_lipsa; END IF;
   SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
-   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[]) AND p.prosecdef
+   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_revalideaza_candidat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[]) AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: SECURITY DEFINER fără search_path: %', v_lipsa; END IF;
   SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
-   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[])
+   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_candidati_angajat','fn_cont_revalideaza_candidat','fn_cont_leaga_automat','fn_cont_leaga_la_creare','fn_cont_notifica_owneri','fn_identitate_claims','fn_identitate_eticheta','fn_identitate_om','fn_identitate_privilegiata','fn_identitate_revocata','fn_identitate_uid','fn_nume_cuvinte','fn_nume_familie','fn_profiles_protectie_legatura','handle_new_user']::text[])
      AND p.proname <> ALL(ARRAY[]::text[]) AND has_function_privilege('anon', p.oid, 'EXECUTE');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
   -- triggerele cerute există și sunt active
diff --git a/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql b/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
index 9240714..24d534f 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
@@ -48,6 +48,7 @@ DROP FUNCTION IF EXISTS public.fn_admin_conturi_alerte();
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean);
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean, jsonb);
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_la_creare(uuid);
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);
 DROP FUNCTION IF EXISTS public.fn_cont_candidati_angajat(text);
 DROP FUNCTION IF EXISTS public.fn_cont_notifica_owneri(text, text, text, text);
 DROP FUNCTION IF EXISTS public.fn_nume_familie(text);
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index e3cdc4b..7200aee 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -364,7 +364,11 @@ BEGIN
   -- 1) lock pe persoană; cheile se recalculează după lock (o scriere concurentă tocmai confirmată poate aduce un CNP /
   --    nume nou) — cel mult 3 treceri, fiecare citire e o instrucțiune nouă (instantaneu nou)
   FOR i IN 1..3 LOOP
-    SELECT public.fn_cont_persoana_chei(public.fn_cont_persoana_cnp(e.id), e.name, e.email) INTO v_chei
+    -- r6 (D-RACE-CNP-NULL): + cheia stabilă a fișei (gazpet.persoana.emp:<id>), luată și de triggerul pe
+    -- hr_employees_private ⇒ un CNP care apare (NULL → X) în datele personale se serializează cu garda, chiar dacă fișa
+    -- n-avea încă nicio cheie de CNP. Aceeași sortare globală (fn_cont_lock_chei: după hash).
+    SELECT public.fn_cont_persoana_chei(public.fn_cont_persoana_cnp(e.id), e.name, e.email) || ('gazpet.persoana.emp:' || p_employee_id)
+      INTO v_chei
       FROM public.employees e WHERE e.id = p_employee_id;
     EXIT WHEN v_chei IS NULL OR v_chei <@ v_blocate;
     PERFORM public.fn_cont_lock_chei(v_chei);
@@ -444,7 +448,10 @@ AS $fn$
 BEGIN
   PERFORM public.fn_cont_lock_chei(public.fn_cont_persoana_chei(
     ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN public.fn_cont_cnp_normalizat(NEW.cnp) END,
-          CASE WHEN TG_OP <> 'INSERT' THEN public.fn_cont_cnp_normalizat(OLD.cnp) END], NULL, NULL));
+          CASE WHEN TG_OP <> 'INSERT' THEN public.fn_cont_cnp_normalizat(OLD.cnp) END], NULL, NULL)
+    -- r6 (D-RACE-CNP-NULL): cheia stabilă a fișei (veche / nouă), aceeași ca în fn_cont_garda_persoana
+    || ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN 'gazpet.persoana.emp:' || NEW.employee_id END,
+             CASE WHEN TG_OP <> 'INSERT' THEN 'gazpet.persoana.emp:' || OLD.employee_id END]);
   RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_hr_employees_private_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
@@ -1333,6 +1340,17 @@ BEGIN
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_alt_contract_activ','fn_cont_cnp_normalizat','fn_cont_coada_pune','fn_cont_flaguri','fn_cont_garda_persoana','fn_cont_inchide','fn_cont_inchide_owner','fn_cont_lock_chei','fn_cont_lock_persoana','fn_cont_motiv_garda','fn_cont_persoana_chei','fn_cont_persoana_cnp','fn_cont_posibil_aceeasi_persoana','fn_cont_restaurare_activa','fn_cont_restaureaza','fn_cont_revocat_nu_scrie','fn_cont_stare_angajati','fn_conturi_inchideri_append_only','fn_conturi_inchideri_sweep','fn_employees_ciclu_cont','fn_employees_persoana_lock','fn_hr_employees_private_persoana_lock','fn_pgrst_pre_request']::text[])
      AND p.proname <> ALL(ARRAY['fn_pgrst_pre_request']::text[]) AND has_function_privilege('anon', p.oid, 'EXECUTE');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
+  -- r6 (hardening): amprenta EXACTĂ a celor două funcții interne sensibile (identitatea sesiunii, restaurarea flagurilor)
+  SELECT array_agg(w.sig ORDER BY w.sig) INTO v_lipsa
+    FROM (VALUES ('fn_identitate_sesiune', 'fn_identitate_sesiune()', '7b9a4321560cf3127c9f10df594ea302'),
+                 ('fn_cont_restaureaza_flaguri', 'fn_cont_restaureaza_flaguri(uuid,jsonb)', '71545de9629f5eb2925c4a259477cf42')) AS w(f, sig, m)
+   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
+      OR NOT EXISTS (SELECT 1 FROM pg_proc p
+                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
+                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
+                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
+                        AND p.proacl::text = '{postgres=X/postgres}');
+  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: amprentă diferită (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
   -- tabelele noi: RLS activ, anon fără niciun drept
   SELECT array_agg(t) INTO v_lipsa FROM unnest(ARRAY['conturi_inchideri_jurnal','conturi_inchideri_coada']::text[]) t
    WHERE to_regclass('public.' || t) IS NULL
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
index 0e75f3e..6c3acd6 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
@@ -357,6 +357,23 @@ BEGIN
         USING ERRCODE = '23514';
     END IF;
   END IF;
+  -- r6 (E-LIFECYCLE-2B): un extern NELEGAT care devine / rămâne activ cu emailul EXACT al unei fișe INACTIVE e refuzat
+  -- (23514) indiferent de termination_date și CHIAR pentru owner: e același om ⇒ trece prin HR → Foști angajați, cu acord.
+  -- Excepția owner-ului rămâne doar pentru potrivirea ambiguă pe nume (mai jos).
+  IF NEW.fost_angajat_employee_id IS NULL AND NEW.activ IS TRUE AND NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '') IS NOT NULL
+     AND (TG_OP = 'INSERT' OR OLD.activ IS NOT TRUE OR NEW.email IS DISTINCT FROM OLD.email
+          OR OLD.fost_angajat_employee_id IS NOT NULL) THEN
+    SELECT e.id, e.name INTO v_pot FROM public.employees e
+     WHERE e.active IS NOT TRUE AND lower(btrim(COALESCE(e.email, ''))) = lower(btrim(NEW.email))
+     ORDER BY e.id LIMIT 1;
+    IF FOUND THEN
+      RAISE EXCEPTION 'E fost angajat Gazpet (fișa inactivă #% %, același email): colaborarea se trece prin HR → Foști angajați, cu acordul lui',
+        v_pot.id, v_pot.name
+        USING ERRCODE = '23514',
+              HINT = format('Folosește HR → Foști angajați → „Trece ca extern” (fișa #%s %s). Potrivirea pe email nu are excepție, nici pentru owner.',
+                            v_pot.id, v_pot.name);
+    END IF;
+  END IF;
   IF NEW.fost_angajat_employee_id IS NULL AND NEW.activ IS TRUE AND NOT v_owner
      AND (TG_OP = 'INSERT' OR NEW.nume IS DISTINCT FROM OLD.nume OR NEW.email IS DISTINCT FROM OLD.email
           OR NEW.activ IS DISTINCT FROM OLD.activ) THEN
@@ -572,11 +589,11 @@ BEGIN
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții lipsă după migrare: %', v_lipsa; END IF;
   SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
-   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[]) AND p.prosecdef
+   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_colab_ext_lock','fn_employees_colab_ext_lock','fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[]) AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: SECURITY DEFINER fără search_path: %', v_lipsa; END IF;
   SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
-   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[])
+   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_colab_ext_lock','fn_employees_colab_ext_lock','fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[])
      AND p.proname <> ALL(ARRAY[]::text[]) AND has_function_privilege('anon', p.oid, 'EXECUTE');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
   -- tabelele noi: RLS activ, anon fără niciun drept
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index 9136044..b0b1b7a 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -262,6 +262,85 @@ SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_coada
 SELECT teste.dblink_disconnect('c_tine4');
 SELECT teste.dblink_disconnect('c_dsw');
 
+-- C-RACE-LINK-1 (r6): legarea cont ↔ fișă (owner, fn_cont_leaga_automat aplicare) e blocată la profil (ținut de altă
+-- tranzacție) DUPĂ ce a calculat candidatul; între timp altă conexiune încheie contractul fișei și comite. După eliberarea
+-- profilului legarea blochează fișa, revalidează sub lock și NU leagă („schimbat” / „fara_candidat”).
+SELECT gen_random_uuid() AS u_own, gen_random_uuid() AS u_lk \gset
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
+  VALUES (%1$L, 'authenticated', 'authenticated', 'owner.race@gazpet.ro', '{"provider":"email"}', now(), now(), now()),
+         (%2$L, 'authenticated', 'authenticated', 'link.race@gazpet.ro', '{"provider":"email"}', now(), now(), now());
+  UPDATE public.profiles SET is_owner = true WHERE id = %1$L;
+  INSERT INTO public.employees (name, department, email, active) VALUES ('LINKESCU RACE', 'Test', 'link.race@gazpet.ro', true);
+  INSERT INTO public.employees (name, department, email, active) VALUES ('CNPESCU UNU', 'Test', 'cnp.unu@exemplu.ro', true),
+                                                                        ('CNPESCU DOI', 'Test', 'cnp.doi@exemplu.ro', true);
+$q$, :'u_own', :'u_lk'));
+SELECT max(id) FILTER (WHERE name = 'LINKESCU RACE') AS e_lk, max(id) FILTER (WHERE name = 'CNPESCU UNU') AS e_cn1,
+       max(id) FILTER (WHERE name = 'CNPESCU DOI') AS e_cn2
+  FROM public.employees WHERE name IN ('LINKESCU RACE', 'CNPESCU UNU', 'CNPESCU DOI') \gset
+SELECT teste.dblink_connect('c_own', :'conn_lock');
+SELECT * FROM teste.dblink('c_own', format('SELECT teste.ca_utilizator(%L)::text', :'u_own')) AS t(x text);
+SELECT pid AS pid_own FROM teste.dblink('c_own', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_connect('c_tine5', :'conn_lock');
+SELECT teste.dblink_exec('c_tine5', 'BEGIN');
+SELECT * FROM teste.dblink('c_tine5', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_lk')) AS t(id text);
+SELECT teste.dblink_send_query('c_own', format($q$SELECT COALESCE((SELECT string_agg(rezultat, ',') FROM public.fn_cont_leaga_automat(false, %L::jsonb) WHERE profile_id = %L), '<nimic>')$q$,
+  jsonb_build_array(jsonb_build_object('profile_id', :'u_lk', 'employee_id', :e_lk))::text, :'u_lk'));
+SELECT teste.assert(teste.asteapta_lock(:pid_own), 'C-RACE-LINK-1 legarea (owner) stă la profilul ținut de altă tranzacție, cu candidatul deja calculat');
+SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = %s', :e_lk));
+SELECT teste.dblink_exec('c_tine5', 'ROLLBACK');
+SELECT res AS lk_rez FROM teste.dblink_get_result('c_own') AS t(res text) \gset
+SELECT count(*) AS rest_lk FROM teste.dblink_get_result('c_own') AS t(res text) \gset
+\echo '   C-RACE-LINK-1 rezultat:' :lk_rez
+SELECT teste.assert(:'lk_rez' IN ('schimbat', 'fara_candidat')
+    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_lk'),
+  'C-RACE-LINK-1 contractul încheiat între timp ⇒ revalidarea sub lock refuză legarea (schimbat / fara_candidat), profilul rămâne nelegat');
+SELECT teste.dblink_disconnect('c_tine5');
+SELECT teste.dblink_disconnect('c_own');
+
+-- D-RACE-CNP-NULL (r6): fișa fără CNP (nicio cheie de CNP); CNP-ul apare (NULL → X) în hr_employees_private în timp ce garda
+-- rulează ⇒ cheia stabilă gazpet.persoana.emp:<id> le serializează, în ambele ordini.
+SELECT teste.dblink_connect('c_g', :'conn_lock');
+SELECT teste.dblink_connect('c_h', :'conn_lock');
+SELECT pid AS pid_g FROM teste.dblink('c_g', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT pid AS pid_h FROM teste.dblink('c_h', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+-- ordinea 1: garda întâi (ține lock-urile), apoi CNP-ul apare în datele personale → așteaptă
+SELECT teste.dblink_exec('c_g', 'BEGIN');
+SELECT res AS g1 FROM teste.dblink('c_g', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cn1)) AS t(res text) \gset
+SELECT teste.dblink_send_query('c_h', format($q$INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (%s, '1900303000131')$q$, :e_cn1));
+SELECT teste.assert(:'g1' = 'cnp_lipsa' AND teste.asteapta_lock(:pid_h),
+  'D-RACE-CNP-NULL (1) garda a văzut „cnp_lipsa” și ține cheia fișei: CNP-ul nou în datele personale AȘTEAPTĂ');
+SELECT teste.dblink_exec('c_g', 'COMMIT');
+SELECT res AS h1 FROM teste.dblink_get_result('c_h') AS t(res text) \gset
+SELECT count(*) AS rest_h1 FROM teste.dblink_get_result('c_h') AS t(res text) \gset
+-- ordinea 2: CNP-ul apare întâi (necomis), apoi garda → așteaptă și, după COMMIT, vede CNP-ul
+SELECT teste.dblink_exec('c_h', 'BEGIN');
+SELECT teste.dblink_exec('c_h', format($q$INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (%s, '1900303000140')$q$, :e_cn2));
+SELECT teste.dblink_send_query('c_g', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cn2));
+SELECT teste.assert(teste.asteapta_lock(:pid_g), 'D-RACE-CNP-NULL (2) garda AȘTEAPTĂ CNP-ul necomis din datele personale (cheia fișei)');
+SELECT teste.dblink_exec('c_h', 'COMMIT');
+SELECT res AS g2 FROM teste.dblink_get_result('c_g') AS t(res text) \gset
+SELECT count(*) AS rest_g2 FROM teste.dblink_get_result('c_g') AS t(res text) \gset
+\echo '   D-RACE-CNP-NULL garda după COMMIT:' :g2
+SELECT teste.assert(:'g2' <> 'cnp_lipsa', 'D-RACE-CNP-NULL (2) după COMMIT garda vede CNP-ul nou (nu mai e „cnp_lipsa”): rulările sunt serializate');
+SELECT teste.dblink_disconnect('c_g');
+SELECT teste.dblink_disconnect('c_h');
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  SET session_replication_role = replica;
+  DELETE FROM public.hr_employees_private WHERE employee_id IN (%3$s, %4$s, %5$s);
+  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%3$s, %4$s, %5$s);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%3$s, %4$s, %5$s);
+  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %2$L);
+  DELETE FROM public.employees WHERE id IN (%3$s, %4$s, %5$s);
+  SET session_replication_role = origin;
+  DELETE FROM auth.users WHERE id IN (%1$L, %2$L);
+$q$, :'u_own', :'u_lk', :e_lk, :e_cn1, :e_cn2));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_own', :'u_lk'))
+    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_own', :'u_lk'))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_lk, :e_cn1, :e_cn2))
+    AND NOT EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id IN (:e_lk, :e_cn1, :e_cn2)),
+  'C-RACE-LINK-1 / D-RACE-CNP-NULL curățenie: datele comise au fost șterse');
+
 -- E-RACE-1: activarea externului (necomisă) ↔ acordul trece accepta → refuza.
 SELECT teste.dblink_exec('c_hr1', 'BEGIN');
 SELECT teste.dblink_exec('c_hr1', format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :x1));
@@ -2725,6 +2804,22 @@ UPDATE public.employees SET active = false WHERE id = :el3;
 SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl3_em),
   'E-LIFECYCLE-2 dezactivare fără termination_date → aceeași politică (extern pe email dezactivat)');
 
+-- E-LIFECYCLE-2B (r6): reactivarea unui extern NELEGAT cu emailul EXACT al unei fișe INACTIVE → refuz 23514, indiferent de
+-- termination_date și CHIAR pentru owner (excepția owner-ului rămâne doar la potrivirea ambiguă pe nume).
+SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :xl2_em),
+  'E-LIFECYCLE-2B dezactivare cu încetare +30 zile, apoi reactivarea externului pe email → refuz', '23514', 'același email');
+SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :xl3_em),
+  'E-LIFECYCLE-2B fără termination_date: reactivarea externului pe email → refuz', '23514', 'același email');
+SELECT teste.ca_utilizator(:'owner');
+SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :xl2_em),
+  'E-LIFECYCLE-2B owner: reactivarea externului cu emailul exact al fișei inactive → refuz (fără excepție de owner)', '23514', 'același email');
+SELECT teste.asteapta_eroare($$INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Alt Extern Owner', 'VIITORU.CARMEN@exemplu.ro', true)$$,
+  'E-LIFECYCLE-2B owner: extern NOU activ cu emailul exact al fișei inactive → refuz', '23514', 'același email');
+INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Lifecu Bogdan Ionut', true) RETURNING id AS xl2_owner_nume \gset
+SELECT teste.assert((SELECT activ FROM public.hr_personal_extern WHERE id = :xl2_owner_nume),
+  'E-LIFECYCLE-2B owner: potrivirea DOAR pe nume cu un fost angajat (LIFECU BOGDAN) rămâne decizia owner-ului (permis)');
+SELECT teste.ca_admin();
+
 \endif
 
 ROLLBACK;
```

## ACTUALIZARE r7 (01.10.2026, după NO-GO-ul Jakarinos — review static, read-only — pe r6 `0456f3b`)

**context_version:** cod pe branch `claude/erp-continuare-x4p5a7`, commitul r7 (vezi mesajul de commit „Conturi c/d/e r7”). NEAPLICAT pe live; în această rundă NU s-a citit nimic de pe live (nici SELECT).

Reviewul a avut 4 blocante P1 + 1 P2. Toate sunt închise în cod ȘI acoperite de teste noi în harness (concurente deterministe, cu dblink, ca în r3–r6), fiecare cu mutația care îl pică.

### Tabel blocant → fix → test
| # | Blocant (Jakarinos) | Fix (fișier) | Test nou (harness) | Mutația care îl pică |
|---|---|---|---|---|
| 1 | **P1-C** c:649 + selecția 595-618 — după lock-ul pe profil se foloseau datele vechi (tip_cont / email schimbate de T1 cât timp legarea aștepta ⇒ contul extern legat automat); helperul revalida doar jumătatea employees | `fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer)` (semnătură nouă): lock **fișă → profil**, apoi recitește SUB lock profilul (employee_id IS NULL, tip_cont angajat, `profiles.email` = emailul de LOGARE recitit din `auth.users`, `email_confirmed_at`) ȘI fișa (activă, fără încetare trecută) și recalculează potrivirea pe emailul recitit. Folosit de ambele căi (`fn_cont_leaga_automat`, `fn_cont_leaga_la_creare`); niciuna nu mai ține profilul înaintea fișei | **C-RACE-LINK-2a** (tip_cont='extern' comis în timpul așteptării ⇒ `tip_cont_exceptat`, nelegat), **2b** (profiles.email schimbat ⇒ `email_diferit`), **2c** (aceeași cursă pe calea de încredere, service_role ⇒ `tip_cont_exceptat`) | helperul fără verificările tip_cont / email ⇒ **2a pică** (verificat: „ESEC TEST: C-RACE-LINK-2a”) |
| 2 | **P1-D** d:675/705/528 — triggerul putea închide contul după ce owner-ul l-a mutat pe altă fișă (sau după tip_cont='extern'): fn_cont_inchide verifica sub lock doar owner-ul | `fn_employees_ciclu_cont`: candidații se citesc fără lock (`r0`), apoi **profilul e blocat FOR UPDATE ÎNAINTEA deciziei** și recitit (legătură, tip_cont, owner, restaurare); legătura ≠ candidatul inițial ⇒ abandon + notificare `cont_inchidere_suspendata`. Apărare în adâncime în `fn_cont_inchide`: pe sursele automate (`trigger_contract_incheiat`, `coada_contract_incheiat`) întoarce `legatura_schimbata` / `tip_cont_exceptat` dacă, sub lock, `profiles.employee_id ≠ p_employee_id` sau tip_cont ≠ angajat | **D-RACE-LINK-MOVE** (P mutat A→B necomis; încheierea lui A așteaptă profilul; după COMMIT: fără jurnal, fără ban, P pe B, owner anunțat), **D-RACE-TIP-EXTERN** (tip_cont='extern' comis în așteptare ⇒ nu se închide, motiv tip_cont), + aserțiune directă pe `fn_cont_inchide` | `IF r.emp IS DISTINCT FROM r0.emp` → `false` și garda din fn_cont_inchide scoasă ⇒ **D-RACE-LINK-MOVE pică** (contul se închide) |
| 3 | **P1-D** d:449 vs 333-350 — golirea / ștergerea / mutarea CNP-ului unei alte fișe active (CNP doar în `hr_employees_private`) ocolea garda: triggerul lua doar cheile CNP + emp:B, nu cheile comune nume / email | `fn_hr_employees_private_persoana_lock` ia acum și cheile nume / email ale fișelor atinse (OLD.employee_id și NEW.employee_id, citite din employees) — INSERT, UPDATE OF cnp/employee_id, DELETE — toate într-un singur `fn_cont_lock_chei` (sortare globală după hash). O potrivire pe nume cere ca familia lui A să fie printre cuvintele lui B ⇒ cheie comună `gazpet.persoana.nume:<familia lui A>` ⇒ serializare; la fel pe email | **D-RACE-CNP-CLEAR (1)** (UPDATE cnp→NULL necomis ⇒ garda lui A AȘTEAPTĂ; după COMMIT `posibil_alt_contract:B`), **(2)** (garda ține cheile ⇒ DELETE-ul datelor personale AȘTEAPTĂ), **(3)** (mutarea employee_id C→B AȘTEAPTĂ; apoi B are CNP ⇒ garda NULL) | fără cheile nume/email în trigger ⇒ **(1) pică** (garda nu așteaptă) |
| 4 | **P1-E** e:468 + 440 — regula emailului exact ocolită modificând emailul fișei INACTIVE (sau INSERT al unei fișe deja inactive): triggerul AFTER nu rula | `fn_employees_colab_ext_after`: politica rulează și la schimbarea emailului unei fișe care rămâne inactivă (DOAR regula emailului exact) și la INSERT-ul unei fișe inactive (politica întreagă: email ⇒ dezactivare + notificare, nume ⇒ notificare). Triggere noi: `trg_employees_zz_colab_ext_ins` (AFTER INSERT WHEN NEW.active IS NOT TRUE), `trg_employees_colab_ext_lock_ins` (BEFORE INSERT, aceleași chei advisory); WHEN-ul triggerului AFTER UPDATE include `email`; `fn_employees_colab_ext_lock` tratează INSERT (fără OLD). Postcondițiile e și ROLLBACK-ul e includ triggerele noi | **E-LIFECYCLE-2C (a)** email schimbat pe fișă inactivă ⇒ externul exact e dezactivat + notificare, reactivarea refuzată 23514; **(b)** INSERT inactiv cu email exact ⇒ extern dezactivat; **(c)** INSERT inactiv doar pe nume ⇒ rămâne activ, owner anunțat; **(d)** control: INSERT ACTIV nu atinge nimic; **(e)** concurent: email în curs de schimbare pe fișa inactivă ↔ extern nou activ cu acel email (HR) ⇒ AȘTEAPTĂ, apoi 23514; **(f)** concurent: INSERT inactiv necomis ↔ extern nou (lock-ul pe INSERT) ⇒ AȘTEAPTĂ, apoi 23514 | `IF v_devine_fost OR v_email_nou` → `v_devine_fost` și triggerul INSERT cu WHEN(false) ⇒ **(a) pică** |
| 5 | **P2** c:493 — helperul chemat ÎNAINTEA blocului BEGIN…EXCEPTION ⇒ 40P01 / lock_timeout scăpau din RPC fără 'eroare' + notificare; ordinea profil→fișă inversă față de sweep | apelul helperului (și UPDATE-ul) sunt ÎN blocul de excepții din `fn_cont_leaga_la_creare`; citirile dinaintea blocului sunt fără lock (filtru rapid). **Ordine comună de lock în tot pachetul: fișă → [persoană (advisory)] → profil → coadă / jurnal** — legarea nu mai ține profilul înaintea fișei, deci ciclul cu HR / sweep nu mai e posibil nici ca deadlock detectat | **C-LOCK-ERR** (fișa candidată ținută de altă tranzacție, `lock_timeout` 700 ms pe conexiunea service_role ⇒ rezultat `eroare` + notificare `cont_nelegat`, NU 55P03 scăpat; control: după eliberare ⇒ `legat`), **C-RACE-LINK-2a** include aserțiunea structurală: cât timp legarea așteaptă profilul, fișa e DEJA blocată de ea (`FOR UPDATE NOWAIT` din altă conexiune ⇒ 55P03) | dacă helperul ar ieși din bloc, C-LOCK-ERR oprește harness-ul cu 55P03 (dblink propagă excepția) |

### Alte schimbări în aceeași rundă
- **Testul r6 C-RACE-LINK-1 a fost rescris** pentru ordinea comună: T1 ține FIȘA cu încheierea necomisă a contractului, legarea (candidat deja calculat) așteaptă la fișă, după COMMIT revalidarea refuză (`fara_candidat`). Varianta r6 (T1 ținea profilul, HR încheia contractul între timp) nu mai e reproductibilă: HR ar aștepta legarea (dovedit de aserțiunea NOWAIT din 2a). Rulată cu vechea formă, suita se bloca în harness (nu în PG) — exact efectul reordonării.
- UI (`src/App.jsx`, MOTIVE din „Leagă automat”): etichete pentru rezultatele noi `tip_cont_exceptat` / `legatura_existenta` (1 linie).
- ROLLBACK c: DROP și pe semnătura nouă `(uuid, integer)` (și pe cea veche `(text, integer)`, dacă ar fi rămas). ROLLBACK d: neschimbat (fără obiecte noi). ROLLBACK e: + cele 2 triggere noi.
- Amprentele helperilor din c verificate în precondițiile d/e (`fn_identitate_*`, `fn_nume_*`, `fn_cont_notifica_owneri`) sunt NEATINSE (funcțiile nu s-au modificat). Postcondițiile d (md5 `fn_identitate_sesiune`, `fn_cont_restaureaza_flaguri`) neatinse.

### Preflight live (NErulat în r7 — „pe live nimic”)
Tabelul preflight din r6 (după `20261001201500`) rămâne referința; versiunile de livrare se mută după ultima versiune live cunoscută acum, **`20261001224000` (F1b)**. Înainte de GO, preflightul read-only din r6 se rulează din nou pe live (md5 `fn_profiles_campuri_owner_only` 1114af39…, `handle_new_user` 94e5c5d3…, obiectele c/d/e inexistente — inclusiv triggerele noi `trg_employees_zz_colab_ext_ins` / `trg_employees_colab_ext_lock_ins`, gate 0e = 0).

### sha256 și versiuni (r7)
| Pas | Fișier | Versiune | sha256 |
|---|---|---|---|
| 1 | 20260929c_conturi_legare_automata.sql | `20261001230000` | `579cc082c30562eb4a121a435c38fbda5c7b46a5cb1634ad7428188228f2077d` |
| 2 | 20260929d_conturi_inchidere_la_incetare.sql | `20261001231500` | `66197d14cb2c6ac82bfaa1589e9f2aca9b1bc0e717e5a9f2f1dbe6526f8f9d35` |
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001233000` | `be6366d9c4e1f110200569bbec6ebf04c234474f4944ec3875ec124eef635be9` |
| — | c ROLLBACK | — | `5a443cc510db296e9f84a655a9ea6f0e5c5b93cc10b6a38d48a38e3aa527401b` (DROP pe ambele semnături ale helperului) |
| — | d ROLLBACK | — | `c2e41e0e028ee9027823f48540e95fb2801cfad5fa16d2af9b291d739163b0e1` (neschimbat) |
| — | e ROLLBACK | — | `94eb12f925383a53648079c920c91ae4542867f5a2adb83bb7e15a0878e4e523` (+ 2 triggere noi) |

**Atenție:** toate trei s-au schimbat ⇒ verdictul se reînnoiește pe c, d și e.

### Teste r7
- Harness PG17 `--rollback`: **1034 aserțiuni PASS** (968 în r6; +33 aserțiuni noi × 2 rulări): după migrare 502, după rollback doar BAZĂ 26, după rollback + reaplicare 502, + gărzile de ordine / coadă și rollback-ul pas cu pas (schema după rollback = schema dinainte).
- Teste noi: C-RACE-LINK-2a/2b/2c, C-LOCK-ERR (+ control), D-RACE-LINK-MOVE, D-RACE-TIP-EXTERN (+ fn_cont_inchide direct), D-RACE-CNP-CLEAR (1)/(2)/(3), E-LIFECYCLE-2C (a)–(f); C-RACE-LINK-1 rescris.
- **Mutații** (fix-ul scos, harness pe un al doilea cluster local, 4 rulări): C → pică C-RACE-LINK-2a · D (legătura) → pică D-RACE-LINK-MOVE · D (chei CNP) → pică D-RACE-CNP-CLEAR (1) · E → pică E-LIFECYCLE-2C (a). Toate 4 opresc harness-ul exact la testul vizat.
- Gate 0e pe baza locală după c+d+e (reaplicate după rollback): **0 rânduri**.
- Validator (`scripts/livrare_validator.py`): c OK (51), d OK (96), e OK (58).
- vitest: 44 fișiere, 1129 PASS. `npx vite build`: OK.

### Rămas deschis / de verdict
- Preflightul live nu a fost rerulat în r7 (cerința rundei: nimic pe live); se rulează înainte de GO.
- Ordinea de lock e acum comună (fișă → profil) și dovedită structural (NOWAIT) pentru legare; între sweep (fișă → advisory → profil → coadă) și restaurare (profil → jurnal → coadă) rămâne argumentul din runda 3 (R2-42), neschimbat.
- `fn_cont_inchide` pe sursa `manual_owner` / `import_manual` NU verifică legătura (owner-ul închide ce vrea) — intenționat.
- Emailul de LOGARE (`auth.users`) e recitit sub lock-ul profilului, dar rândul din `auth.users` nu e blocat (GoTrue îl scrie fără să atingă `profiles`): o schimbare de email de logare comisă între recitire și UPDATE rămâne teoretic posibilă; `profiles.email` (păzit de S-A + protecție) și confirmarea sunt verificate sub lock. De decis dacă se cere și `auth.users … FOR UPDATE`.

### Diff r7 (migrări + teste + UI), față de `0456f3b`
```diff
diff --git a/src/App.jsx b/src/App.jsx
index 034fb60..3a88d4d 100644
--- a/src/App.jsx
+++ b/src/App.jsx
@@ -6534,7 +6534,7 @@ function AdminPage() {
     const {data,error}=await supabase.rpc('fn_cont_leaga_automat',{p_simulare:true})
     if(error){showToast('Eroare: '+error.message,'error');setLegare(false);return}
     // R1: potrivirea e pe emailul de LOGARE; la înscriere legarea nu se face singură, owner-ul o confirmă aici.
-    const MOTIVE={fara_candidat:'niciun candidat',ambiguu:'ambiguu (mai mulți candidați sau mai multe conturi pe aceeași fișă)',candidat_ocupat:'fișa are deja cont',email_diferit:'emailul din profil diferă de cel de logare — verifică manual',email_neconfirmat:'emailul de logare nu e confirmat — leagă manual după confirmare',neconfirmat:'nu era în previzualizarea confirmată',schimbat:'potrivirea s-a schimbat de la previzualizare',eroare:'eroare'}
+    const MOTIVE={fara_candidat:'niciun candidat',ambiguu:'ambiguu (mai mulți candidați sau mai multe conturi pe aceeași fișă)',candidat_ocupat:'fișa are deja cont',email_diferit:'emailul din profil diferă de cel de logare — verifică manual',email_neconfirmat:'emailul de logare nu e confirmat — leagă manual după confirmare',neconfirmat:'nu era în previzualizarea confirmată',schimbat:'potrivirea s-a schimbat de la previzualizare',tip_cont_exceptat:'contul a fost marcat extern/test/sistem între timp',legatura_existenta:'contul a fost legat între timp',eroare:'eroare'}
     const deLegat=(data||[]).filter(r=>r.rezultat==='de_legat'), rest=(data||[]).filter(r=>r.rezultat!=='de_legat')
     const restTxt=rest.length?`\n\nRămân nelegate (${rest.length}):\n${rest.map(r=>`• ${r.email} — ${MOTIVE[r.rezultat]||r.rezultat}${r.employee_name?' ('+r.employee_name+')':''}`).join('\n')}`:''
     if(!deLegat.length){window.alert(`Nimic de legat automat.${restTxt}`);setLegare(false);return}
diff --git a/supabase/migrations/20260929c_conturi_legare_automata.sql b/supabase/migrations/20260929c_conturi_legare_automata.sql
index 933090d..a764a11 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata.sql
@@ -425,31 +425,55 @@ REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authentic
 -- legătura încă liberă, tipul contului, emailul profilului = emailul de logare, candidatul UNIC și liber.
 -- Întoarce: legat | legatura_existenta | fara_marcaj_incredere | email_neconfirmat | tip_cont_exceptat | email_diferit |
 --           fara_candidat | ambiguu | candidat_ocupat | inexistent | eroare.
--- r6 (C-RACE-LINK-1): revalidarea candidatului SUB LOCK, comună celor două căi de legare. Apelantul ține deja profilul
--- (FOR UPDATE); aici se blochează fișa candidată și se recalculează potrivirea (instrucțiuni noi ⇒ văd ce s-a comis între
--- timp, ex. încheierea contractului). NULL = se poate lega; altfel rezultatul de întors, fără legare.
-CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_email text, p_emp integer)
+-- r6 (C-RACE-LINK-1) + r7 (P1-C, Jakarinos pe 0456f3b): revalidarea COMPLETĂ sub lock, comună celor două căi de legare.
+-- Apelantul a calculat candidatul (p_emp) pe un instantaneu NEblocat. Aici, în ORDINEA COMUNĂ a pachetului (fișa employees
+-- FOR UPDATE → profilul FOR UPDATE, aceeași ca UPDATE-ul HR / sweep: fișă → advisory → profil), se recitesc AMBELE jumătăți
+-- (instrucțiuni noi ⇒ văd ce s-a comis între timp):
+--   * fișa: încă activă, fără încetare trecută;
+--   * profilul: încă nelegat, tip_cont angajat, profiles.email = emailul de LOGARE (auth.users, recitit), email confirmat;
+--   * potrivirea recalculată pe emailul de logare RECITIT: un singur candidat, același, neocupat.
+-- r6 revalida doar jumătatea employees: un profil trecut între timp pe tip_cont = 'extern' sau cu emailul schimbat (T1 comis
+-- cât timp legarea aștepta profilul) se lega totuși. NULL = se poate lega; altfel rezultatul de întors, fără legare.
+-- Lock-ul pe fișă e luat ÎNAINTEA profilului chiar dacă apelantul ținea deja profilul (reentrant) — vezi apelanții: niciunul
+-- nu mai ține profilul înainte de apel, ca ordinea fișă → profil să fie reală.
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);
+CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer)
 RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
 DECLARE
+  v_p      public.profiles%ROWTYPE;
+  v_email  text;
+  v_conf   boolean;
   v_n      integer;
   v_emp    integer;
   v_ocupat boolean;
 BEGIN
-  PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;
+  IF p_emp IS NULL OR p_profile_id IS NULL THEN RETURN 'fara_candidat'; END IF;
+  PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;                 -- 1) fișa
+  SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;       -- 2) profilul (recitit SUB lock)
+  IF NOT FOUND THEN RETURN 'inexistent'; END IF;
+  SELECT u.email::text, u.email_confirmed_at IS NOT NULL INTO v_email, v_conf
+    FROM auth.users u WHERE u.id = p_profile_id;                                   -- emailul de logare, recitit
+  IF NOT FOUND THEN RETURN 'inexistent'; END IF;
+  IF v_p.employee_id IS NOT NULL THEN RETURN 'legatura_existenta'; END IF;
+  IF COALESCE(v_p.tip_cont, 'angajat') <> 'angajat' THEN RETURN 'tip_cont_exceptat'; END IF;
+  IF NULLIF(lower(btrim(COALESCE(v_email, ''))), '') IS NULL
+     OR lower(btrim(COALESCE(v_p.email, ''))) <> lower(btrim(v_email)) THEN RETURN 'email_diferit'; END IF;
+  IF NOT v_conf THEN RETURN 'email_neconfirmat'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.employees e
                   WHERE e.id = p_emp AND e.active IS TRUE AND (e.termination_date IS NULL OR e.termination_date > CURRENT_DATE)) THEN
     RETURN 'fara_candidat';
   END IF;
   SELECT count(*), min(c.employee_id), COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
     INTO v_n, v_emp, v_ocupat
-    FROM public.fn_cont_candidati_angajat(p_email) c;
+    FROM public.fn_cont_candidati_angajat(v_email) c;
   IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
-  IF v_n <> 1 OR v_emp IS DISTINCT FROM p_emp OR v_ocupat THEN RETURN 'schimbat'; END IF;
+  IF v_n <> 1 OR v_emp IS DISTINCT FROM p_emp THEN RETURN 'schimbat'; END IF;
+  IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
   RETURN NULL;
 END $fn$;
-REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(text, integer) FROM PUBLIC, anon, authenticated, service_role;
+REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
 
 CREATE OR REPLACE FUNCTION public.fn_cont_leaga_la_creare(p_profile_id uuid)
 RETURNS text
@@ -471,7 +495,10 @@ BEGIN
   IF v_ident IS NULL OR v_ident NOT IN ('service_role', 'owner') THEN
     RAISE EXCEPTION 'Legarea la creare o face doar funcția cont-nou (service_role) sau owner-ul' USING ERRCODE = '42501';
   END IF;
-  SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
+  -- r7 (P2 / ordinea lock-urilor): citirile de aici sunt FĂRĂ lock (filtru rapid); decizia reală se ia în
+  -- fn_cont_revalideaza_candidat, sub lock, în ordinea comună fișă → profil. Așa RPC-ul nu mai ține profilul înaintea fișei
+  -- (inversul fluxului HR / sweep): un ciclu nu mai e posibil nici ca deadlock detectat.
+  SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id;
   IF NOT FOUND THEN RETURN 'inexistent'; END IF;
   SELECT u.email::text, COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true', u.email_confirmed_at IS NOT NULL
     INTO v_email, v_incr, v_conf
@@ -488,14 +515,16 @@ BEGIN
   IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
   IF v_n > 1 THEN RETURN 'ambiguu'; END IF;
   IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
-  -- r6 (C-RACE-LINK-1): fișa candidată blocată (după profil, deja blocat sus) + revalidare sub lock: încă activă, fără
-  -- încetare trecută, potrivirea recalculată identică (un singur candidat, același, neocupat) ⇒ altfel fără legare.
-  v_rez := public.fn_cont_revalideaza_candidat(v_email, v_emp);
-  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
   BEGIN
-    UPDATE public.profiles SET employee_id = v_emp
-     WHERE id = p_profile_id AND employee_id IS NULL;             -- nu suprascrie niciodată
-    v_rez := CASE WHEN FOUND THEN 'legat' ELSE 'legatura_existenta' END;
+    -- r6 (C-RACE-LINK-1) + r7 (P1-C, P2): lock fișă → profil și revalidarea AMBELOR jumătăți (fișă activă; profil încă
+    -- nelegat, tip angajat, email profil = email de logare recitit, confirmat; potrivirea recalculată identică) — ÎN blocul
+    -- de excepții: un lock_timeout / 40P01 din așteptarea lock-urilor devine 'eroare' + notificare owner, nu scapă din RPC.
+    v_rez := public.fn_cont_revalideaza_candidat(p_profile_id, v_emp);
+    IF v_rez IS NULL THEN
+      UPDATE public.profiles SET employee_id = v_emp
+       WHERE id = p_profile_id AND employee_id IS NULL;           -- nu suprascrie niciodată
+      v_rez := CASE WHEN FOUND THEN 'legat' ELSE 'legatura_existenta' END;
+    END IF;
   EXCEPTION
     WHEN unique_violation THEN v_rez := 'candidat_ocupat';
     WHEN OTHERS THEN
@@ -644,10 +673,11 @@ BEGIN
         rezultat := 'schimbat';                           -- potrivirea s-a schimbat de la previzualizare
       ELSE
         BEGIN
-          -- r6 (C-RACE-LINK-1): profilul, apoi fișa candidată, blocate; revalidare sub lock (activă, fără încetare trecută,
-          -- potrivire recalculată identică). Altfel „schimbat” / „fara_candidat”, fără legare.
-          PERFORM 1 FROM public.profiles pr WHERE pr.id = r.pid FOR UPDATE;
-          rezultat := public.fn_cont_revalideaza_candidat(r.uemail, r.emp);
+          -- r6 (C-RACE-LINK-1) + r7 (P1-C): lock fișă → profil (ordinea comună a pachetului) și revalidarea AMBELOR jumătăți
+          -- sub lock (fișă activă; profil încă nelegat, tip angajat, email profil = email de logare recitit, confirmat;
+          -- potrivire recalculată identică). Altfel rezultatul revalidării (schimbat / fara_candidat / tip_cont_exceptat /
+          -- email_diferit / email_neconfirmat / legatura_existenta / candidat_ocupat), fără legare.
+          rezultat := public.fn_cont_revalideaza_candidat(r.pid, r.emp);
           IF rezultat IS NULL THEN
             UPDATE public.profiles pr SET employee_id = r.emp
              WHERE pr.id = r.pid AND pr.employee_id IS NULL;
diff --git a/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql b/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
index 24d534f..41d5ce3 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
@@ -48,7 +48,8 @@ DROP FUNCTION IF EXISTS public.fn_admin_conturi_alerte();
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean);
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean, jsonb);
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_la_creare(uuid);
-DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer);   -- r7 (semnătura nouă)
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);   -- r6 (dacă ar fi rămas)
 DROP FUNCTION IF EXISTS public.fn_cont_candidati_angajat(text);
 DROP FUNCTION IF EXISTS public.fn_cont_notifica_owneri(text, text, text, text);
 DROP FUNCTION IF EXISTS public.fn_nume_familie(text);
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index 7200aee..ed3a67e 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -22,6 +22,8 @@
 --       valabil) nu mai scrie fișe de angajat și date personale (runda 3, X10 / P1e-f)
 --   * fn_conturi_inchideri_sweep — procesarea cozii, rulată de pg_cron ca postgres (identitate explicită db_login)
 --   ORDINEA LOCK-URILOR (uniformă, runda 3; r3: fișa employees FOR UPDATE întâi, ca la UPDATE-ul HR): [employees] → persoană (advisory) → profil (FOR UPDATE) → coadă / jurnal.
+--   r7: și legarea cont ↔ fișă (c) ia acum fișa ÎNAINTEA profilului (fn_cont_revalideaza_candidat) — ordine comună în tot pachetul;
+--       triggerul de închidere blochează profilul ÎNAINTEA deciziei și reverifică legătura / tipul / restaurarea sub lock (P1-D).
 --   * fn_pgrst_pre_request     — hook PostgREST pentru revocarea EFECTIVĂ a JWT-urilor deja emise;
 --                                CREAT, dar NEACTIVAT (activarea = ALTER ROLE authenticator, cu acordul lui Răzvan)
 --   * fn_cont_restaureaza      — revenire din jurnal, EXCLUSIV owner, cu previzualizare (p_simulare)
@@ -441,17 +443,32 @@ CREATE TRIGGER trg_employees_persoana_lock BEFORE INSERT OR UPDATE OF cnp, activ
 
 -- Același lock la scrierea CNP-ului în datele personale (INSERT / UPDATE OF cnp, employee_id / DELETE): un CNP care apare,
 -- dispare sau se mută pe altă fișă în timpul unei închideri așteaptă garda (runda 3, X1).
+-- r7 (P1-D, Jakarinos pe 0456f3b): o scriere aici schimbă și ELIGIBILITATEA fișei la potrivirea pe nume / email din
+-- fn_cont_posibil_aceeasi_persoana (o fișă activă contează acolo DOAR cât timp n-are niciun CNP cunoscut). Golirea / ștergerea
+-- / mutarea CNP-ului unei fișe B (activă, același nume de familie ca A) nu lua nicio cheie comună cu garda lui A (care ține
+-- CNP-ul X al lui A, cuvintele numelui lui A, emailul lui A, emp:A) ⇒ garda spunea „se poate închide” pe un instantaneu
+-- în care B avea încă CNP, iar după COMMIT B rămânea fără CNP = exact cazul posibil_alt_contract, neverificat. Acum se iau
+-- și cheile nume / email ale fișelor atinse (OLD.employee_id și NEW.employee_id, citite din employees): garda lui A ține
+-- 'gazpet.persoana.nume:<familia lui A>', iar o potrivire pe nume cere ca familia lui A să fie printre cuvintele lui B
+-- (și invers) ⇒ cheie comună ⇒ serializare; la fel pe email. Toate într-un singur apel (fn_cont_lock_chei: sortate după hash).
 CREATE OR REPLACE FUNCTION public.fn_hr_employees_private_persoana_lock()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
+DECLARE v_chei text[];
 BEGIN
-  PERFORM public.fn_cont_lock_chei(public.fn_cont_persoana_chei(
+  v_chei := public.fn_cont_persoana_chei(
     ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN public.fn_cont_cnp_normalizat(NEW.cnp) END,
           CASE WHEN TG_OP <> 'INSERT' THEN public.fn_cont_cnp_normalizat(OLD.cnp) END], NULL, NULL)
     -- r6 (D-RACE-CNP-NULL): cheia stabilă a fișei (veche / nouă), aceeași ca în fn_cont_garda_persoana
     || ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN 'gazpet.persoana.emp:' || NEW.employee_id END,
-             CASE WHEN TG_OP <> 'INSERT' THEN 'gazpet.persoana.emp:' || OLD.employee_id END]);
+             CASE WHEN TG_OP <> 'INSERT' THEN 'gazpet.persoana.emp:' || OLD.employee_id END];
+  -- r7 (P1-D): cheile nume / email ale fișelor atinse (eligibilitatea la potrivirea pe nume / email se schimbă cu CNP-ul)
+  SELECT v_chei || COALESCE(array_agg(k), '{}'::text[]) INTO v_chei
+    FROM public.employees e
+    CROSS JOIN LATERAL unnest(public.fn_cont_persoana_chei(NULL, e.name, e.email)) k
+   WHERE e.id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.employee_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.employee_id END);
+  PERFORM public.fn_cont_lock_chei(v_chei);
   RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_hr_employees_private_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
@@ -528,6 +545,19 @@ BEGIN
   SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;   -- serializează pe profil
   IF NOT FOUND THEN RETURN 'inexistent'; END IF;
 
+  -- r7 (P1-D, Jakarinos pe 0456f3b): pe căile AUTOMATE (trigger / coadă) decizia s-a luat pe un instantaneu dinaintea
+  -- lock-ului. Aici, SUB lock, legătura trebuie să fie încă cea pe care s-a decis (profilul mutat de owner pe altă fișă
+  -- cât timp se aștepta ⇒ nu se închide) și contul să nu fi devenit între timp excepție marcată (tip_cont). Apărare în
+  -- adâncime: apelanții automați verifică la fel (fn_employees_ciclu_cont / sweep), aici e ultimul punct comun.
+  IF p_sursa IN ('trigger_contract_incheiat', 'coada_contract_incheiat') THEN
+    IF p_employee_id IS NULL OR v_p.employee_id::integer IS DISTINCT FROM p_employee_id THEN
+      RETURN 'legatura_schimbata';
+    END IF;
+    IF COALESCE(v_p.tip_cont, 'angajat') <> 'angajat' THEN
+      RETURN 'tip_cont_exceptat';
+    END IF;
+  END IF;
+
   IF v_p.is_owner IS TRUE THEN                        -- SIGURANȚĂ: owner-ul nu se închide niciodată automat
     BEGIN                                             -- notificarea e best-effort (nu blochează nimic)
       PERFORM public.fn_cont_notifica_owneri('cont_owner_neinchis', '⚠️ Contract încheiat pentru un OWNER',
@@ -653,6 +683,7 @@ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
 DECLARE
   r        record;
+  r0       record;                                   -- r7: candidatul de la selecție (înaintea lock-ului pe profil)
   v_rez    text;
   v_err    text;
   v_cnp    text[];
@@ -672,14 +703,51 @@ BEGIN
       v_garda := 'eroare_garda: ' || SQLERRM;
     END;
     v_cnp := public.fn_cont_persoana_cnp(NEW.id);
-    FOR r IN SELECT p.id, p.email, p.is_owner, p.tip_cont, p.employee_id::integer AS emp
-               FROM public.profiles p
-              WHERE p.employee_id = NEW.id
-                 OR (cardinality(v_cnp) > 0 AND p.employee_id IN (
-                      SELECT e.id FROM public.employees e
-                       WHERE e.id <> NEW.id AND public.fn_cont_persoana_cnp(e.id) && v_cnp
-                         AND e.active IS NOT TRUE AND e.termination_date IS NOT NULL AND e.termination_date <= CURRENT_DATE))
-              ORDER BY p.id LOOP
+    FOR r0 IN SELECT p.id, p.employee_id::integer AS emp
+                FROM public.profiles p
+               WHERE p.employee_id = NEW.id
+                  OR (cardinality(v_cnp) > 0 AND p.employee_id IN (
+                       SELECT e.id FROM public.employees e
+                        WHERE e.id <> NEW.id AND public.fn_cont_persoana_cnp(e.id) && v_cnp
+                          AND e.active IS NOT TRUE AND e.termination_date IS NOT NULL AND e.termination_date <= CURRENT_DATE))
+               ORDER BY p.id LOOP
+      -- r7 (P1-D, Jakarinos pe 0456f3b): candidații de mai sus vin dintr-un instantaneu NEblocat. Profilul se blochează
+      -- ÎNAINTEA deciziei (ordinea pachetului: fișa — deja ținută de UPDATE-ul HR — → persoană (advisory, garda) → profil) și
+      -- se recitește SUB lock: legătura, tipul contului, owner, restaurarea. Dacă legătura nu mai e cea de la selecție
+      -- (owner-ul a mutat contul pe altă fișă cât timp se aștepta) → abandon, doar notificare. Un tip_cont devenit
+      -- „extern” între timp e văzut tot aici (nu pe instantaneul vechi). Lock-ul rămâne până la COMMIT (sub-blocurile de
+      -- mai jos nu-l eliberează la succes); o eroare în lock e tratată ca o eroare de închidere (coadă + notificare).
+      BEGIN
+        SELECT p.id, p.email, p.is_owner, p.tip_cont, p.employee_id::integer AS emp INTO r
+          FROM public.profiles p WHERE p.id = r0.id FOR UPDATE;
+      EXCEPTION WHEN OTHERS THEN
+        v_err := SQLERRM;
+        BEGIN
+          PERFORM public.fn_cont_coada_pune(r0.id, r0.emp, 'reincercare',
+            format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
+            CURRENT_DATE, v_err);
+          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
+            format('%s (fișa #%s %s): %s · se reîncearcă automat din coadă', r0.id, NEW.id, NEW.name, v_err),
+            '/admin?tab=managers&cont=' || r0.id::text);
+        EXCEPTION WHEN OTHERS THEN
+          RAISE WARNING 'fn_employees_ciclu_cont lock profil (%): % [%] · eroarea inițială: %', r0.id, SQLERRM, SQLSTATE, v_err;
+        END;
+        CONTINUE;
+      END;
+      IF NOT FOUND THEN
+        CONTINUE;                                     -- profilul a dispărut între timp
+      END IF;
+      IF r.emp IS DISTINCT FROM r0.emp THEN
+        BEGIN
+          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
+            format('%s (fișa #%s %s): legătura contului s-a schimbat în timpul procesării (era fișa #%s, acum %s) — nu s-a închis automat. Verifică din Admin → Manageri.',
+                   r.email, NEW.id, NEW.name, r0.emp, COALESCE('fișa #' || r.emp::text, 'nelegat')),
+            '/admin?tab=managers&cont=' || r.id::text);
+        EXCEPTION WHEN OTHERS THEN
+          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
+        END;
+        CONTINUE;
+      END IF;
       v_rest := CASE WHEN NOT v_plecare THEN public.fn_cont_restaurare_activa(r.id) END;
       v_motiv := CASE
         WHEN r.is_owner IS TRUE THEN NULL             -- fn_cont_inchide întoarce sarit_owner și anunță
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
index 6c3acd6..b2c8b66 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql
@@ -289,14 +289,19 @@ BEGIN
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_colab_ext_lock(integer[], text[], text[]) FROM PUBLIC, anon, authenticated, service_role;
 
+-- r7 (P1-E, Jakarinos pe 0456f3b): și la INSERT-ul unei fișe INACTIVE (fără OLD) — politica C rulează și acolo (vezi C.5).
 CREATE OR REPLACE FUNCTION public.fn_employees_colab_ext_lock()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
 BEGIN
-  PERFORM public.fn_colab_ext_lock(ARRAY[NEW.id],
-                                   ARRAY[public.fn_nume_familie(OLD.name), public.fn_nume_familie(NEW.name)],
-                                   ARRAY[OLD.email, NEW.email]);
+  IF TG_OP = 'INSERT' THEN
+    PERFORM public.fn_colab_ext_lock(ARRAY[NEW.id], ARRAY[public.fn_nume_familie(NEW.name)], ARRAY[NEW.email]);
+  ELSE
+    PERFORM public.fn_colab_ext_lock(ARRAY[NEW.id],
+                                     ARRAY[public.fn_nume_familie(OLD.name), public.fn_nume_familie(NEW.name)],
+                                     ARRAY[OLD.email, NEW.email]);
+  END IF;
   RETURN NEW;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_employees_colab_ext_lock() FROM PUBLIC, anon, authenticated, service_role;
@@ -304,6 +309,9 @@ DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;
 CREATE TRIGGER trg_employees_colab_ext_lock BEFORE UPDATE OF active, termination_date, name, email,
     colaborare_externa_status, colaborare_externa_nota, colaborare_externa_document ON public.employees
   FOR EACH ROW EXECUTE FUNCTION public.fn_employees_colab_ext_lock();
+DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock_ins ON public.employees;
+CREATE TRIGGER trg_employees_colab_ext_lock_ins BEFORE INSERT ON public.employees
+  FOR EACH ROW WHEN (NEW.active IS NOT TRUE) EXECUTE FUNCTION public.fn_employees_colab_ext_lock();
 
 -- Protecție: politicile INSERT/UPDATE de pe tabelă permit ORICĂRUI logat să scrie → poarta e aici.
 --   (1) legarea / dezlegarea: doar owner / HR; ținta = fost angajat; dezlegarea face colaborarea inactivă;
@@ -395,25 +403,37 @@ CREATE TRIGGER trg_hr_personal_extern_fost_angajat BEFORE INSERT OR UPDATE ON pu
   FOR EACH ROW EXECUTE FUNCTION public.fn_hr_personal_extern_fost_angajat();
 
 -- C.5 Sincronizarea: jurnal + dezactivarea externului (activarea NU se face niciodată automat)
+-- r7 (P1-E, Jakarinos pe 0456f3b): regula emailului EXACT (E-LIFECYCLE-2B) se aplica doar la trecerea activ → inactiv; HR
+-- putea apoi schimba emailul unei fișe deja INACTIVE (sau insera o fișă direct inactivă) pe emailul unui extern nelegat activ —
+-- triggerul AFTER nu rula, externul rămânea activ cu emailul exact al fișei inactive. Acum politica rulează și:
+--   * la INSERT-ul unei fișe inactive (trigger AFTER INSERT separat, fără OLD) — politica întreagă (email ⇒ dezactivare,
+--     nume ⇒ notificare), ca la o plecare;
+--   * la schimbarea emailului unei fișe care rămâne inactivă — DOAR regula emailului exact (numele nu s-a schimbat).
+-- Serializarea e comună: trg_employees_colab_ext_lock (UPDATE OF email) / trg_employees_colab_ext_lock_ins (INSERT inactiv)
+-- iau cheile nume / email ÎNAINTEA citirii, aceleași pe care le ia triggerul externului.
 CREATE OR REPLACE FUNCTION public.fn_employees_colab_ext_after()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
 DECLARE
-  v_reset boolean := (OLD.active IS NOT TRUE AND NEW.active IS TRUE)
-                     OR (OLD.termination_date IS NOT NULL AND NEW.termination_date IS DISTINCT FROM OLD.termination_date);
+  v_ins   boolean := TG_OP = 'INSERT';
+  v_reset boolean := NOT v_ins AND ((OLD.active IS NOT TRUE AND NEW.active IS TRUE)
+                     OR (OLD.termination_date IS NOT NULL AND NEW.termination_date IS DISTINCT FROM OLD.termination_date));
   -- r4 (varianta C) + r5 (varianta A, decizia lui Răzvan, E-LIFECYCLE-2): politica C se aplică din momentul în care fișa
   -- trece din activă în inactivă, INDIFERENT de termination_date (și o dată de încetare viitoare: la scadență nu mai vine
-  -- niciun UPDATE, deci verificarea se face anticipat, la programare).
-  v_devine_fost boolean := OLD.active IS TRUE AND NEW.active IS NOT TRUE;
+  -- niciun UPDATE, deci verificarea se face anticipat, la programare). r7: și la INSERT-ul unei fișe inactive.
+  v_devine_fost boolean := (v_ins AND NEW.active IS NOT TRUE) OR (NOT v_ins AND OLD.active IS TRUE AND NEW.active IS NOT TRUE);
+  -- r7 (P1-E): emailul unei fișe inactive schimbat ⇒ doar regula emailului exact
+  v_email_nou boolean := NOT v_ins AND NEW.active IS NOT TRUE AND OLD.active IS NOT TRUE
+                         AND lower(btrim(COALESCE(NEW.email, ''))) IS DISTINCT FROM lower(btrim(COALESCE(OLD.email, '')));
   v_em    text := lower(btrim(COALESCE(NEW.email, '')));
   v_cuv   text[] := public.fn_nume_cuvinte(NEW.name);
   v_fam   text := public.fn_nume_familie(NEW.name);
   x       record;
 BEGIN
-  IF OLD.colaborare_externa_status   IS DISTINCT FROM NEW.colaborare_externa_status
+  IF NOT v_ins AND (OLD.colaborare_externa_status   IS DISTINCT FROM NEW.colaborare_externa_status
      OR OLD.colaborare_externa_nota     IS DISTINCT FROM NEW.colaborare_externa_nota
-     OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document THEN
+     OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document) THEN
     INSERT INTO public.hr_colaborare_externa_jurnal (employee_id, status_vechi, status_nou, nota, document, facut_de,
                                                      facut_de_identitate, sursa)
     VALUES (NEW.id, OLD.colaborare_externa_status, NEW.colaborare_externa_status,
@@ -427,23 +447,24 @@ BEGIN
             NEW.colaborare_externa_document, public.fn_identitate_om(), public.fn_identitate_eticheta(),
             CASE WHEN v_reset THEN 'reset_automat' ELSE 'manual' END);
   END IF;
-  IF (OLD.colaborare_externa_status = 'accepta' AND NEW.colaborare_externa_status IS DISTINCT FROM 'accepta')
-     OR (OLD.active IS NOT TRUE AND NEW.active IS TRUE) THEN
+  IF NOT v_ins AND ((OLD.colaborare_externa_status = 'accepta' AND NEW.colaborare_externa_status IS DISTINCT FROM 'accepta')
+     OR (OLD.active IS NOT TRUE AND NEW.active IS TRUE)) THEN
     UPDATE public.hr_personal_extern SET activ = false, updated_at = now()
      WHERE fost_angajat_employee_id = NEW.id AND activ;
   END IF;
   -- r4 (E-LIFECYCLE, varianta C): externii ACTIVI NELEGAȚI care existau deja cu identitatea omului care tocmai a fost
-  -- dezactivat (r5: la dezactivare, chiar dacă data încetării e în viitor).
+  -- dezactivat (r5: la dezactivare, chiar dacă data încetării e în viitor; r7: și la INSERT inactiv / email schimbat pe o
+  -- fișă inactivă — atunci doar pe email).
   --   * email identic  → dezactivare automată (direcția sigură; activarea o face din nou un om) + notificare owner;
   --   * doar pe nume   → notificare owner, FĂRĂ dezactivare (poate fi altă persoană cu același nume).
-  -- Lock-urile advisory pe identitate sunt deja ținute (trg_employees_colab_ext_lock) ⇒ fără cursă cu un extern nou.
-  IF v_devine_fost THEN
+  -- Lock-urile advisory pe identitate sunt deja ținute (trg_employees_colab_ext_lock / _ins) ⇒ fără cursă cu un extern nou.
+  IF v_devine_fost OR v_email_nou THEN
     FOR x IN
       SELECT h.id, h.nume, (v_em <> '' AND lower(btrim(COALESCE(h.email, ''))) = v_em) AS pe_email
         FROM public.hr_personal_extern h
        WHERE h.fost_angajat_employee_id IS NULL AND h.activ IS TRUE
          AND ((v_em <> '' AND lower(btrim(COALESCE(h.email, ''))) = v_em)
-              OR (cardinality(v_cuv) >= 2 AND cardinality(public.fn_nume_cuvinte(h.nume)) >= 2 AND v_fam = ANY (public.fn_nume_cuvinte(h.nume))
+              OR (v_devine_fost AND cardinality(v_cuv) >= 2 AND cardinality(public.fn_nume_cuvinte(h.nume)) >= 2 AND v_fam = ANY (public.fn_nume_cuvinte(h.nume))
                   AND (public.fn_nume_cuvinte(h.nume) <@ v_cuv OR v_cuv <@ public.fn_nume_cuvinte(h.nume))))
        ORDER BY h.id
     LOOP
@@ -470,7 +491,13 @@ CREATE TRIGGER trg_employees_zz_colab_ext AFTER UPDATE ON public.employees FOR E
      OR OLD.colaborare_externa_nota     IS DISTINCT FROM NEW.colaborare_externa_nota
      OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document
      OR OLD.active IS DISTINCT FROM NEW.active
-     OR OLD.termination_date IS DISTINCT FROM NEW.termination_date)
+     OR OLD.termination_date IS DISTINCT FROM NEW.termination_date
+     OR OLD.email IS DISTINCT FROM NEW.email)                    -- r7 (P1-E): emailul unei fișe inactive
+  EXECUTE FUNCTION public.fn_employees_colab_ext_after();
+-- r7 (P1-E): o fișă inserată direct INACTIVĂ e tratată ca o plecare (politica C), fără OLD.
+DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext_ins ON public.employees;
+CREATE TRIGGER trg_employees_zz_colab_ext_ins AFTER INSERT ON public.employees FOR EACH ROW
+  WHEN (NEW.active IS NOT TRUE)
   EXECUTE FUNCTION public.fn_employees_colab_ext_after();
 
 -- C.6 Funcțiile apelabile din UI (poartă: owner sau can_modify_employees, în cod) ----
@@ -603,7 +630,7 @@ BEGIN
       OR has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: tabele fără RLS sau cu drepturi pentru anon: %', v_lipsa; END IF;
   -- triggerele cerute există și sunt active
-  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)
+  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || t.r) AND g.tgname = t.n AND g.tgenabled <> 'D');
   IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: triggere lipsă/dezactivate: %', v_lipsa; END IF;
   v_n := 0;
diff --git a/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql b/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql
index f9df054..6052146 100644
--- a/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql
+++ b/supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql
@@ -6,7 +6,9 @@
 --    legăturile hr_personal_extern.fost_angajat_employee_id în claude_context, cu confirmarea lui Răzvan.
 
 DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext ON public.employees;
+DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext_ins ON public.employees;      -- r7
 DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;
+DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock_ins ON public.employees;    -- r7
 DROP FUNCTION IF EXISTS public.fn_employees_colab_ext_lock();
 DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_ins ON public.employees;
 DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_upd ON public.employees;
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index b0b1b7a..4a8c8f3 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -262,9 +262,11 @@ SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_coada
 SELECT teste.dblink_disconnect('c_tine4');
 SELECT teste.dblink_disconnect('c_dsw');
 
--- C-RACE-LINK-1 (r6): legarea cont ↔ fișă (owner, fn_cont_leaga_automat aplicare) e blocată la profil (ținut de altă
--- tranzacție) DUPĂ ce a calculat candidatul; între timp altă conexiune încheie contractul fișei și comite. După eliberarea
--- profilului legarea blochează fișa, revalidează sub lock și NU leagă („schimbat” / „fara_candidat”).
+-- C-RACE-LINK-1 (r6, rescris în r7 pentru ordinea comună fișă → profil): legarea cont ↔ fișă (owner, fn_cont_leaga_automat
+-- aplicare) calculează candidatul pe un instantaneu în care fișa e activă, apoi stă la FIȘA ținută de altă tranzacție care îi
+-- încheie contractul (necomis). După COMMIT legarea blochează fișa, apoi profilul, revalidează sub lock și NU leagă
+-- („fara_candidat” / „schimbat”). Varianta r6 (T1 ținea profilul, iar HR încheia contractul între timp) nu mai e posibilă:
+-- legarea ia fișa ÎNAINTEA profilului, deci HR ar aștepta legarea (vezi C-RACE-LINK-2a, NOWAIT 55P03 pe fișă).
 SELECT gen_random_uuid() AS u_own, gen_random_uuid() AS u_lk \gset
 SELECT teste.dblink_exec(:'conn_lock', format($q$
   INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
@@ -283,12 +285,11 @@ SELECT * FROM teste.dblink('c_own', format('SELECT teste.ca_utilizator(%L)::text
 SELECT pid AS pid_own FROM teste.dblink('c_own', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
 SELECT teste.dblink_connect('c_tine5', :'conn_lock');
 SELECT teste.dblink_exec('c_tine5', 'BEGIN');
-SELECT * FROM teste.dblink('c_tine5', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_lk')) AS t(id text);
+SELECT teste.dblink_exec('c_tine5', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = %s', :e_lk));
 SELECT teste.dblink_send_query('c_own', format($q$SELECT COALESCE((SELECT string_agg(rezultat, ',') FROM public.fn_cont_leaga_automat(false, %L::jsonb) WHERE profile_id = %L), '<nimic>')$q$,
   jsonb_build_array(jsonb_build_object('profile_id', :'u_lk', 'employee_id', :e_lk))::text, :'u_lk'));
-SELECT teste.assert(teste.asteapta_lock(:pid_own), 'C-RACE-LINK-1 legarea (owner) stă la profilul ținut de altă tranzacție, cu candidatul deja calculat');
-SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = %s', :e_lk));
-SELECT teste.dblink_exec('c_tine5', 'ROLLBACK');
+SELECT teste.assert(teste.asteapta_lock(:pid_own), 'C-RACE-LINK-1 legarea (owner) stă la fișa candidată ținută de încheierea necomisă a contractului, cu candidatul deja calculat');
+SELECT teste.dblink_exec('c_tine5', 'COMMIT');
 SELECT res AS lk_rez FROM teste.dblink_get_result('c_own') AS t(res text) \gset
 SELECT count(*) AS rest_lk FROM teste.dblink_get_result('c_own') AS t(res text) \gset
 \echo '   C-RACE-LINK-1 rezultat:' :lk_rez
@@ -341,6 +342,312 @@ SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_own',
     AND NOT EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id IN (:e_lk, :e_cn1, :e_cn2)),
   'C-RACE-LINK-1 / D-RACE-CNP-NULL curățenie: datele comise au fost șterse');
 
+-- ============================================================ r7 (NO-GO Jakarinos pe 0456f3b): P1-C, P1-D ×2, P1-E, P2
+SELECT gen_random_uuid() AS u_own2, gen_random_uuid() AS u_lk2, gen_random_uuid() AS u_lk3, gen_random_uuid() AS u_lk4,
+       gen_random_uuid() AS u_lk5, gen_random_uuid() AS u_mv, gen_random_uuid() AS u_mv2 \gset
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
+  VALUES (%1$L, 'authenticated', 'authenticated', 'owner.r7@gazpet.ro', '{"provider":"email"}', now(), now(), now()),
+         (%2$L, 'authenticated', 'authenticated', 'link2.race@gazpet.ro', '{"provider":"email"}', now(), now(), now()),
+         (%3$L, 'authenticated', 'authenticated', 'link3.race@gazpet.ro', '{"provider":"email"}', now(), now(), now()),
+         (%4$L, 'authenticated', 'authenticated', 'link4.race@gazpet.ro', '{"provider":"email","gazpet_legare_automata":true}', now(), now(), now()),
+         (%5$L, 'authenticated', 'authenticated', 'link5.race@gazpet.ro', '{"provider":"email","gazpet_legare_automata":true}', now(), now(), now()),
+         (%6$L, 'authenticated', 'authenticated', 'move.p@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
+         (%7$L, 'authenticated', 'authenticated', 'move.p2@exemplu.ro', '{"provider":"email"}', now(), now(), now());
+  UPDATE public.profiles SET is_owner = true WHERE id = %1$L;
+  INSERT INTO public.employees (name, department, email, active) VALUES
+    ('LINKESCU DOI', 'Test', 'link2.race@gazpet.ro', true), ('LINKESCU TREI', 'Test', 'link3.race@gazpet.ro', true),
+    ('LINKESCU PATRU', 'Test', 'link4.race@gazpet.ro', true), ('LINKESCU CINCI', 'Test', 'link5.race@gazpet.ro', true);
+  INSERT INTO public.employees (name, department, email, active, cnp) VALUES
+    ('MOVESCU ALFA', 'Test', 'movescu.alfa@exemplu.ro', true, '1900303000158'),
+    ('MOVESCU BETA', 'Test', 'movescu.beta@exemplu.ro', true, '1900303000166'),
+    ('MOVESCU GAMA', 'Test', 'movescu.gama@exemplu.ro', true, '1900303000174'),
+    ('CLEARESCU ION', 'Test', 'clearescu.ion@exemplu.ro', true, '1900303000182'),
+    ('CLEARESCU VASILE', 'Test', 'clearescu.vasile@exemplu.ro', true, NULL);
+  INSERT INTO public.hr_employees_private (employee_id, cnp) SELECT id, '1900303000190' FROM public.employees WHERE name = 'CLEARESCU VASILE';
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'MOVESCU ALFA') WHERE id = %6$L;
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'MOVESCU GAMA') WHERE id = %7$L;
+$q$, :'u_own2', :'u_lk2', :'u_lk3', :'u_lk4', :'u_lk5', :'u_mv', :'u_mv2'));
+SELECT max(id) FILTER (WHERE name = 'LINKESCU DOI') AS e_lk2, max(id) FILTER (WHERE name = 'LINKESCU TREI') AS e_lk3,
+       max(id) FILTER (WHERE name = 'LINKESCU PATRU') AS e_lk4, max(id) FILTER (WHERE name = 'LINKESCU CINCI') AS e_lk5,
+       max(id) FILTER (WHERE name = 'MOVESCU ALFA') AS e_mva, max(id) FILTER (WHERE name = 'MOVESCU BETA') AS e_mvb,
+       max(id) FILTER (WHERE name = 'MOVESCU GAMA') AS e_mvg,
+       max(id) FILTER (WHERE name = 'CLEARESCU ION') AS e_cla, max(id) FILTER (WHERE name = 'CLEARESCU VASILE') AS e_clb
+  FROM public.employees WHERE name IN ('LINKESCU DOI', 'LINKESCU TREI', 'LINKESCU PATRU', 'LINKESCU CINCI', 'MOVESCU ALFA', 'MOVESCU BETA',
+                                       'MOVESCU GAMA', 'CLEARESCU ION', 'CLEARESCU VASILE') \gset
+SELECT teste.assert((SELECT employee_id = :e_mva FROM public.profiles WHERE id = :'u_mv')
+    AND (SELECT employee_id = :e_mvg FROM public.profiles WHERE id = :'u_mv2')
+    AND (SELECT cnp IS NULL FROM public.employees WHERE id = :e_clb)
+    AND EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id = :e_clb AND cnp = '1900303000190'),
+  'r7 pregătire: date comise (owner r7, 4 conturi nelegate confirmate, 2 conturi legate, fișele CLEARESCU: CNP doar în datele personale ale lui B)');
+SELECT teste.dblink_connect('c_own7', :'conn_lock');
+SELECT * FROM teste.dblink('c_own7', format('SELECT teste.ca_utilizator(%L)::text', :'u_own2')) AS t(x text);
+SELECT pid AS pid_own7 FROM teste.dblink('c_own7', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_connect('c_sr7', :'conn_lock');
+SELECT * FROM teste.dblink('c_sr7', 'SELECT teste.ca_service_role()::text') AS t(x text);
+SELECT pid AS pid_sr7 FROM teste.dblink('c_sr7', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_connect('c_t7', :'conn_lock');
+SELECT teste.dblink_connect('c_a7', :'conn_lock');
+SELECT pid AS pid_a7 FROM teste.dblink('c_a7', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+
+-- C-RACE-LINK-2a (r7, P1-C): profilul trece pe tip_cont = 'extern' (necomis) cât timp legarea (owner, aplicare) a calculat deja
+-- candidatul și stă la profil. După COMMIT, revalidarea sub lock recitește PROFILUL (nu doar fișa) ⇒ tip_cont_exceptat, nelegat.
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.profiles SET tip_cont = ''extern'' WHERE id = %L', :'u_lk2'));
+SELECT teste.dblink_send_query('c_own7', format($q$SELECT COALESCE((SELECT string_agg(rezultat, ',') FROM public.fn_cont_leaga_automat(false, %L::jsonb) WHERE profile_id = %L), '<nimic>')$q$,
+  jsonb_build_array(jsonb_build_object('profile_id', :'u_lk2', 'employee_id', :e_lk2))::text, :'u_lk2'));
+SELECT teste.assert(teste.asteapta_lock(:pid_own7), 'C-RACE-LINK-2a legarea (owner) stă la profilul în curs de marcare „extern” (candidatul deja calculat)');
+-- ordinea comună a lock-urilor (P2): cât timp legarea așteaptă profilul, fișa candidată e DEJA blocată de ea (fișă → profil, ca HR / sweep)
+SELECT res AS nowait_lk2 FROM teste.dblink('c_a7', format($q$SELECT COALESCE(teste.eroare('SELECT 1 FROM public.employees WHERE id = %s FOR UPDATE NOWAIT')::text, 'OK')$q$, :e_lk2)) AS t(res text) \gset
+SELECT teste.assert(:'nowait_lk2' ~ '"state": "55P03"',
+  'C-RACE-LINK-2a (P2, ordinea lock-urilor) legarea ia fișa ÎNAINTEA profilului: cât timp așteaptă profilul, fișa e deja blocată (NOWAIT → 55P03), ca în fluxul HR / sweep');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS lk2_rez FROM teste.dblink_get_result('c_own7') AS t(res text) \gset
+SELECT count(*) AS rest_lk2 FROM teste.dblink_get_result('c_own7') AS t(res text) \gset
+\echo '   C-RACE-LINK-2a rezultat:' :lk2_rez
+SELECT teste.assert(:'lk2_rez' = 'tip_cont_exceptat'
+    AND (SELECT employee_id IS NULL AND tip_cont = 'extern' FROM public.profiles WHERE id = :'u_lk2'),
+  'C-RACE-LINK-2a profilul marcat „extern” între timp ⇒ tip_cont_exceptat, contul rămâne nelegat (r6 revalida doar fișa ⇒ lega)');
+
+-- C-RACE-LINK-2b (r7, P1-C): profiles.email schimbat (necomis) de owner cât timp legarea așteaptă ⇒ email_diferit, nelegat.
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.profiles SET email = ''altcineva.race@gazpet.ro'' WHERE id = %L', :'u_lk3'));
+SELECT teste.dblink_send_query('c_own7', format($q$SELECT COALESCE((SELECT string_agg(rezultat, ',') FROM public.fn_cont_leaga_automat(false, %L::jsonb) WHERE profile_id = %L), '<nimic>')$q$,
+  jsonb_build_array(jsonb_build_object('profile_id', :'u_lk3', 'employee_id', :e_lk3))::text, :'u_lk3'));
+SELECT teste.assert(teste.asteapta_lock(:pid_own7), 'C-RACE-LINK-2b legarea (owner) stă la profilul cu emailul în curs de schimbare');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS lk3_rez FROM teste.dblink_get_result('c_own7') AS t(res text) \gset
+SELECT count(*) AS rest_lk3 FROM teste.dblink_get_result('c_own7') AS t(res text) \gset
+\echo '   C-RACE-LINK-2b rezultat:' :lk3_rez
+SELECT teste.assert(:'lk3_rez' = 'email_diferit' AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_lk3'),
+  'C-RACE-LINK-2b emailul profilului schimbat între timp (≠ emailul de logare) ⇒ email_diferit, contul rămâne nelegat');
+
+-- C-RACE-LINK-2c (r7, P1-C): aceeași cursă pe calea de ÎNCREDERE (fn_cont_leaga_la_creare, service_role): tip_cont = 'extern'
+-- comis cât timp RPC-ul așteaptă ⇒ tip_cont_exceptat (înainte: verificarea tipului se făcea pe citirea dinaintea lock-ului).
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.profiles SET tip_cont = ''extern'' WHERE id = %L', :'u_lk4'));
+SELECT teste.dblink_send_query('c_sr7', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_lk4'));
+SELECT teste.assert(teste.asteapta_lock(:pid_sr7), 'C-RACE-LINK-2c legarea la creare (service_role) stă la profilul în curs de marcare „extern”');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS lk4_rez FROM teste.dblink_get_result('c_sr7') AS t(res text) \gset
+SELECT count(*) AS rest_lk4 FROM teste.dblink_get_result('c_sr7') AS t(res text) \gset
+\echo '   C-RACE-LINK-2c rezultat:' :lk4_rez
+SELECT teste.assert(:'lk4_rez' = 'tip_cont_exceptat' AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_lk4'),
+  'C-RACE-LINK-2c calea de încredere: profilul marcat „extern” între timp ⇒ tip_cont_exceptat, nelegat');
+
+-- C-LOCK-ERR (r7, P2): lock_timeout în timpul revalidării (fișa candidată ținută de altă tranzacție) NU scapă din RPC: e prins
+-- în blocul BEGIN…EXCEPTION ⇒ 'eroare' + notificare owner (cont_nelegat). Înainte (r6) helperul era chemat ÎNAINTEA blocului.
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT * FROM teste.dblink('c_t7', format('SELECT id::text FROM public.employees WHERE id = %s FOR UPDATE', :e_lk5)) AS t(id text);
+SELECT teste.dblink_exec('c_sr7', 'SET lock_timeout = ''700ms''');
+-- (dacă 55P03 ar scăpa din RPC, dblink ar propaga eroarea și harness-ul s-ar opri aici — exact semnalul mutației)
+SELECT res AS lk5_rez FROM teste.dblink('c_sr7', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_lk5')) AS t(res text) \gset
+SELECT teste.dblink_exec('c_sr7', 'RESET lock_timeout');
+SELECT teste.dblink_exec('c_t7', 'ROLLBACK');
+\echo '   C-LOCK-ERR rezultat:' :lk5_rez
+SELECT teste.assert(:'lk5_rez' = 'eroare'
+    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_lk5')
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'u_own2' AND type = 'cont_nelegat'
+                 AND message LIKE '%link5.race@gazpet.ro%eroare la legare%'),
+  'C-LOCK-ERR lock_timeout la fișa candidată (în revalidare) ⇒ rezultat „eroare” + notificare cont_nelegat către owner, NU excepție 55P03 scăpată din RPC');
+SELECT res AS lk5_dupa FROM teste.dblink('c_sr7', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_lk5')) AS t(res text) \gset
+SELECT teste.assert(:'lk5_dupa' = 'legat' AND (SELECT employee_id = :e_lk5 FROM public.profiles WHERE id = :'u_lk5'),
+  'C-LOCK-ERR control: după eliberarea fișei, același apel (service_role) leagă');
+
+-- D-RACE-LINK-MOVE (r7, P1-D): owner-ul mută contul P de pe fișa A pe fișa B (necomis); HR încheie contractul lui A: triggerul
+-- vede P legat de A (instantaneu vechi) și așteaptă profilul. După COMMIT, profilul e recitit SUB lock: legătura e B ⇒ abandon
+-- (doar notificare), contul NU se închide, nu se consemnează A. Înainte (r6): fn_cont_inchide verifica doar owner-ul ⇒ P închis.
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.profiles SET employee_id = %s WHERE id = %L', :e_mvb, :'u_mv'));
+SELECT teste.dblink_send_query('c_a7', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = %s', :e_mva));
+SELECT teste.assert(teste.asteapta_lock(:pid_a7), 'D-RACE-LINK-MOVE încheierea contractului lui A AȘTEAPTĂ profilul P (mutat pe B, necomis) ÎNAINTEA deciziei');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS mv_rez FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT count(*) AS rest_mv FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_mv')
+    AND (SELECT employee_id = :e_mvb FROM public.profiles WHERE id = :'u_mv')
+    AND (SELECT active IS FALSE FROM public.employees WHERE id = :e_mva)
+    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_mv')
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_mv' AND rezolvat_la IS NULL)
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'u_own2' AND type = 'cont_inchidere_suspendata'
+                 AND message LIKE '%move.p@exemplu.ro%legătura contului s-a schimbat%'),
+  'D-RACE-LINK-MOVE după COMMIT legătura e B ≠ A ⇒ abandon: contul NU e închis (fără jurnal, fără ban, fără coadă), owner-ul e anunțat');
+-- D-RACE-TIP-EXTERN (r7, P1-D): tip_cont = 'extern' confirmat cât timp triggerul așteaptă profilul ⇒ nu se închide (tipul e
+-- citit SUB lock, nu de pe instantaneul vechi).
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.profiles SET tip_cont = ''extern'' WHERE id = %L', :'u_mv2'));
+SELECT teste.dblink_send_query('c_a7', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = %s', :e_mvg));
+SELECT teste.assert(teste.asteapta_lock(:pid_a7), 'D-RACE-TIP-EXTERN încheierea contractului AȘTEAPTĂ profilul în curs de marcare „extern”');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS mv2_rez FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT count(*) AS rest_mv2 FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_mv2')
+    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_mv2')
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'u_own2' AND type = 'cont_inchidere_suspendata'
+                 AND message LIKE '%move.p2@exemplu.ro%marcat „extern”%'),
+  'D-RACE-TIP-EXTERN tip_cont devenit „extern” între timp ⇒ contul NU se închide, owner-ul e anunțat cu motivul tip_cont');
+-- apărare în adâncime: fn_cont_inchide pe o sursă AUTOMATĂ refuză singur o legătură diferită de cea decisă
+SELECT res AS inchide_mv FROM teste.dblink(:'conn_lock', format($q$SELECT public.fn_cont_inchide(%L, 'test r7 legătura schimbată', 'trigger_contract_incheiat', %s)$q$, :'u_mv', :e_mva)) AS t(res text) \gset
+SELECT res AS inchide_mv2 FROM teste.dblink(:'conn_lock', format($q$SELECT public.fn_cont_inchide(%L, 'test r7 tip cont', 'coada_contract_incheiat', %s)$q$, :'u_mv2', :e_mvg)) AS t(res text) \gset
+SELECT teste.assert(:'inchide_mv' = 'legatura_schimbata' AND :'inchide_mv2' = 'tip_cont_exceptat'
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id IN (:'u_mv', :'u_mv2')),
+  'D-RACE-LINK-MOVE apărare în adâncime: fn_cont_inchide (sursă automată) întoarce legatura_schimbata / tip_cont_exceptat sub lock, fără închidere');
+
+-- D-RACE-CNP-CLEAR (r7, P1-D): A are CNP X pe fișă; B e ACTIVĂ, același nume de familie, CNP Y DOAR în hr_employees_private.
+-- Golirea / ștergerea CNP-ului lui B schimbă eligibilitatea lui B la „posibil aceeași persoană” ⇒ trebuie să se serializeze cu
+-- garda lui A (cheie comună: numele de familie). Înainte (r6) triggerul lua doar cheile CNP (Y) și emp:B ⇒ garda lui A trecea.
+-- ordinea 1: golirea CNP-ului lui B (necomisă), apoi garda lui A → AȘTEAPTĂ; după COMMIT vede B fără CNP ⇒ posibil_alt_contract
+SELECT teste.dblink_connect('c_g7', :'conn_lock');
+SELECT pid AS pid_g7 FROM teste.dblink('c_g7', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.hr_employees_private SET cnp = NULL WHERE employee_id = %s', :e_clb));
+SELECT teste.dblink_send_query('c_g7', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cla));
+SELECT teste.assert(teste.asteapta_lock(:pid_g7), 'D-RACE-CNP-CLEAR (1) garda lui A AȘTEAPTĂ golirea necomisă a CNP-ului lui B (cheia numelui de familie, comună)');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS gc1 FROM teste.dblink_get_result('c_g7') AS t(res text) \gset
+SELECT count(*) AS rest_gc1 FROM teste.dblink_get_result('c_g7') AS t(res text) \gset
+\echo '   D-RACE-CNP-CLEAR (1) garda după COMMIT:' :gc1
+SELECT teste.assert(:'gc1' = 'posibil_alt_contract:' || :e_clb,
+  'D-RACE-CNP-CLEAR (1) după COMMIT garda vede B activă FĂRĂ CNP cu același nume de familie ⇒ posibil_alt_contract (nu se închide)');
+-- ordinea 2: garda lui A întâi (B are iar CNP ⇒ se poate închide, ține cheile), apoi DELETE pe datele personale ale lui B → AȘTEAPTĂ
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.hr_employees_private SET cnp = ''1900303000190'' WHERE employee_id = %s', :e_clb));
+SELECT teste.dblink_exec('c_g7', 'BEGIN');
+SELECT res AS gc2 FROM teste.dblink('c_g7', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cla)) AS t(res text) \gset
+SELECT teste.dblink_send_query('c_a7', format('DELETE FROM public.hr_employees_private WHERE employee_id = %s', :e_clb));
+SELECT teste.assert(:'gc2' = 'NULL' AND teste.asteapta_lock(:pid_a7),
+  'D-RACE-CNP-CLEAR (2) garda lui A a spus „se poate închide” și ține cheile: ȘTERGEREA datelor personale ale lui B AȘTEAPTĂ');
+SELECT teste.dblink_exec('c_g7', 'COMMIT');
+SELECT res AS del_b FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT count(*) AS rest_del_b FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+-- (gărzile „de control” rulează pe conn_lock, autocommit: în tranzacția testului ar ține cheile persoanei până la final)
+SELECT res AS gc2b FROM teste.dblink(:'conn_lock', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cla)) AS t(res text) \gset
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id = :e_clb)
+    AND :'gc2b' = 'posibil_alt_contract:' || :e_clb,
+  'D-RACE-CNP-CLEAR (2) după eliberarea gărzii ștergerea trece, iar o gardă nouă vede B fără CNP ⇒ posibil_alt_contract');
+-- ordinea 3: mutarea employee_id (C → B) ia și cheile numelui lui B
+SELECT teste.dblink_exec(:'conn_lock', $q$INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('ZZCLEAR TEMP', 'Test', NULL, true, NULL)$q$);
+SELECT max(id) AS e_clc FROM public.employees WHERE name = 'ZZCLEAR TEMP' \gset
+SELECT teste.dblink_exec(:'conn_lock', format($q$INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (%s, '1900303000204')$q$, :e_clc));
+SELECT teste.dblink_exec('c_g7', 'BEGIN');
+SELECT res AS gc3 FROM teste.dblink('c_g7', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cla)) AS t(res text) \gset
+SELECT teste.dblink_send_query('c_a7', format('UPDATE public.hr_employees_private SET employee_id = %s WHERE employee_id = %s', :e_clb, :e_clc));
+SELECT teste.assert(:'gc3' = 'posibil_alt_contract:' || :e_clb AND teste.asteapta_lock(:pid_a7),
+  'D-RACE-CNP-CLEAR (3) mutarea CNP-ului pe fișa B (employee_id C → B) AȘTEAPTĂ garda lui A (cheile numelui fișei-țintă)');
+SELECT teste.dblink_exec('c_g7', 'COMMIT');
+SELECT res AS mut_b FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT count(*) AS rest_mut_b FROM teste.dblink_get_result('c_a7') AS t(res text) \gset
+SELECT res AS gc3b FROM teste.dblink(:'conn_lock', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cla)) AS t(res text) \gset
+SELECT teste.assert(EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id = :e_clb AND cnp = '1900303000204')
+    AND :'gc3b' = 'NULL',
+  'D-RACE-CNP-CLEAR (3) după eliberarea gărzii mutarea trece; B are iar CNP ⇒ garda lui A nu mai vede „posibil alt contract”');
+SELECT teste.dblink_disconnect('c_g7');
+SELECT teste.dblink_disconnect('c_own7');
+SELECT teste.dblink_disconnect('c_sr7');
+SELECT teste.dblink_disconnect('c_t7');
+SELECT teste.dblink_disconnect('c_a7');
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  SET session_replication_role = replica;
+  DELETE FROM public.hr_employees_private WHERE employee_id IN (%8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s, %17$s);
+  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s, %17$s);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s, %17$s);
+  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %2$L, %3$L, %4$L, %5$L, %6$L, %7$L);
+  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %2$L, %3$L, %4$L, %5$L, %6$L, %7$L);
+  DELETE FROM public.notifications WHERE profile_id = %1$L;
+  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %2$L, %3$L, %4$L, %5$L, %6$L, %7$L);
+  DELETE FROM public.employees WHERE id IN (%8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s, %17$s);
+  SET session_replication_role = origin;
+  DELETE FROM auth.users WHERE id IN (%2$L, %3$L, %4$L, %5$L, %6$L, %7$L);   -- owner-ul r7 rămâne pentru E-LIFECYCLE-2C (notificări)
+$q$, :'u_own2', :'u_lk2', :'u_lk3', :'u_lk4', :'u_lk5', :'u_mv', :'u_mv2',
+     :e_lk2, :e_lk3, :e_lk4, :e_lk5, :e_mva, :e_mvb, :e_mvg, :e_cla, :e_clb, :e_clc));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_lk2', :'u_lk3', :'u_lk4', :'u_lk5', :'u_mv', :'u_mv2'))
+    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_lk2', :'u_lk3', :'u_lk4', :'u_lk5', :'u_mv', :'u_mv2'))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_lk2, :e_lk3, :e_lk4, :e_lk5, :e_mva, :e_mvb, :e_mvg, :e_cla, :e_clb, :e_clc)),
+  'r7 (c/d) curățenie: datele comise au fost șterse');
+
+-- E-LIFECYCLE-2C (r7, P1-E): regula emailului EXACT și la schimbarea emailului unei fișe INACTIVE și la INSERT-ul unei fișe inactive.
+-- Date comise (conn_lock, autocommit — un INSERT în tranzacția testului ar ține cheile advisory ale numelui până la final și
+-- ar bloca conexiunile concurente de mai jos): externi NELEGAȚI activi; fișa A inactivă (încetare în trecut) cu alt email.
+SELECT teste.dblink_exec(:'conn_lock', $q$
+  INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES
+    ('Xenia Externa', 'emailx.ext@exemplu.ro', true), ('Yolanda Externa', 'emaily.ext@exemplu.ro', true), ('Zoltan Numescu', NULL, true),
+    ('Wanda Externa', 'emailw.ext@exemplu.ro', true);
+  INSERT INTO public.employees (name, department, email, active, termination_date)
+  VALUES ('EMAILESCU ANA', 'Test', 'alt.email@exemplu.ro', false, CURRENT_DATE - 10);
+$q$);
+SELECT max(id) FILTER (WHERE nume = 'Xenia Externa') AS x7x, max(id) FILTER (WHERE nume = 'Yolanda Externa') AS x7y,
+       max(id) FILTER (WHERE nume = 'Zoltan Numescu') AS x7z, max(id) FILTER (WHERE nume = 'Wanda Externa') AS x7w FROM public.hr_personal_extern \gset
+SELECT max(id) AS e7a FROM public.employees WHERE name = 'EMAILESCU ANA' \gset
+SELECT teste.assert((SELECT count(*) = 4 FROM public.hr_personal_extern WHERE id IN (:x7x, :x7y, :x7z, :x7w) AND activ),
+  'E-LIFECYCLE-2C pregătire: 4 externi nelegați activi; fișa inactivă inserată cu alt email nu i-a atins');
+-- (a) HR schimbă DOAR emailul fișei inactive pe emailul exact al externului X (altă scriere a literelor) ⇒ X dezactivat + notificare
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.employees SET email = ''EmailX.Ext@exemplu.ro'' WHERE id = %s', :e7a));
+SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :x7x)
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'u_own2' AND type = 'extern_fost_angajat_dezactivat' AND message LIKE '%#' || :x7x || '%'),
+  'E-LIFECYCLE-2C (a) emailul unei fișe INACTIVE schimbat pe emailul exact al unui extern nelegat activ ⇒ externul e dezactivat + owner anunțat');
+SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :x7x),
+  'E-LIFECYCLE-2C (a) reactivarea externului X → refuz (emailul exact al fișei inactive)', '23514', 'același email');
+-- (b) INSERT-ul unei fișe DEJA inactive cu emailul externului Y ⇒ Y dezactivat
+SELECT teste.dblink_exec(:'conn_lock', $q$INSERT INTO public.employees (name, department, email, active, termination_date)
+  VALUES ('EMAILESCU BIA', 'Test', 'emaily.ext@exemplu.ro', false, CURRENT_DATE - 5)$q$);
+SELECT max(id) AS e7b FROM public.employees WHERE name = 'EMAILESCU BIA' \gset
+SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :x7y),
+  'E-LIFECYCLE-2C (b) fișă inserată direct INACTIVĂ cu emailul exact al unui extern nelegat activ ⇒ externul e dezactivat');
+-- (c) INSERT inactiv cu potrivire DOAR pe nume ⇒ externul rămâne activ, owner-ul e anunțat (omonim)
+SELECT teste.dblink_exec(:'conn_lock', $q$INSERT INTO public.employees (name, department, active, termination_date)
+  VALUES ('NUMESCU ZOLTAN', 'Test', false, CURRENT_DATE - 5)$q$);
+SELECT max(id) AS e7c FROM public.employees WHERE name = 'NUMESCU ZOLTAN' \gset
+SELECT teste.assert((SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :x7z)
+    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'u_own2' AND type = 'extern_fost_angajat_omonim' AND message LIKE '%#' || :x7z || '%'),
+  'E-LIFECYCLE-2C (c) fișă inserată inactivă cu potrivire DOAR pe nume ⇒ externul rămâne activ, owner-ul e anunțat (poate fi altă persoană)');
+-- (d) INSERT activ cu emailul unui extern activ ⇒ nimic (politica e a fostului angajat)
+SELECT teste.dblink_exec(:'conn_lock', $q$INSERT INTO public.employees (name, department, email, active) VALUES ('EMAILESCU WANDA', 'Test', 'emailw.ext@exemplu.ro', true)$q$);
+SELECT max(id) AS e7w FROM public.employees WHERE name = 'EMAILESCU WANDA' \gset
+SELECT teste.assert((SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :x7w),
+  'E-LIFECYCLE-2C (d) control: o fișă inserată ACTIVĂ nu dezactivează nimic (politica e a fostului angajat)');
+-- (e) concurent: emailul fișei inactive A schimbat (necomis) ↔ un extern NOU activ cu acel email (HR) → așteaptă, apoi 23514
+SELECT teste.dblink_connect('c_t7', :'conn_lock');
+SELECT teste.dblink_connect('c_e7', :'conn_lock');
+SELECT * FROM teste.dblink('c_e7', format('SELECT teste.ca_utilizator(%L)::text', :'u_ehr')) AS t(x text);
+SELECT pid AS pid_e7 FROM teste.dblink('c_e7', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', format('UPDATE public.employees SET email = ''emailv.ext@exemplu.ro'' WHERE id = %s', :e7a));
+SELECT teste.dblink_send_query('c_e7', $q$SELECT COALESCE(teste.eroare('INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES (''Vera Externa'', ''emailv.ext@exemplu.ro'', true)')::text, 'OK')$q$);
+SELECT teste.assert(teste.asteapta_lock(:pid_e7), 'E-LIFECYCLE-2C (e) externul nou cu emailul în curs de punere pe fișa inactivă AȘTEAPTĂ (cheia emailului, comună)');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS e7e FROM teste.dblink_get_result('c_e7') AS t(res text) \gset
+SELECT count(*) AS rest_e7e FROM teste.dblink_get_result('c_e7') AS t(res text) \gset
+SELECT teste.assert(:'e7e' ~ '"state": "23514"' AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE lower(nume) = 'vera externa'),
+  'E-LIFECYCLE-2C (e) după COMMIT externul nou e refuzat (23514): emailul exact al fișei inactive');
+-- (f) concurent: INSERT-ul unei fișe inactive (necomis) ↔ extern nou activ cu același email → așteaptă (lock-ul pe INSERT), apoi 23514
+SELECT teste.dblink_exec('c_t7', 'BEGIN');
+SELECT teste.dblink_exec('c_t7', $q$INSERT INTO public.employees (name, department, email, active, termination_date) VALUES ('EMAILESCU UNA', 'Test', 'emailu.ext@exemplu.ro', false, CURRENT_DATE - 3)$q$);
+SELECT teste.dblink_send_query('c_e7', $q$SELECT COALESCE(teste.eroare('INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES (''Una Externa'', ''emailu.ext@exemplu.ro'', true)')::text, 'OK')$q$);
+SELECT teste.assert(teste.asteapta_lock(:pid_e7), 'E-LIFECYCLE-2C (f) externul nou AȘTEAPTĂ INSERT-ul necomis al fișei inactive cu același email (trg_employees_colab_ext_lock_ins)');
+SELECT teste.dblink_exec('c_t7', 'COMMIT');
+SELECT res AS e7f FROM teste.dblink_get_result('c_e7') AS t(res text) \gset
+SELECT count(*) AS rest_e7f FROM teste.dblink_get_result('c_e7') AS t(res text) \gset
+SELECT max(id) AS e7u FROM public.employees WHERE name = 'EMAILESCU UNA' \gset
+SELECT teste.assert(:'e7f' ~ '"state": "23514"' AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE lower(nume) = 'una externa'),
+  'E-LIFECYCLE-2C (f) după COMMIT externul nou e refuzat (23514): fișa inactivă inserată între timp are emailul exact');
+SELECT teste.dblink_disconnect('c_t7');
+SELECT teste.dblink_disconnect('c_e7');
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  SET session_replication_role = replica;
+  DELETE FROM public.hr_personal_extern WHERE id IN (%1$s, %2$s, %3$s, %4$s);
+  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %9$s);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %9$s);
+  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %9$s);
+  DELETE FROM public.notifications WHERE profile_id = %10$L;
+  SET session_replication_role = origin;
+  DELETE FROM auth.users WHERE id = %10$L;
+$q$, :x7x, :x7y, :x7z, :x7w, :e7a, :e7b, :e7c, :e7w, :e7u, :'u_own2'));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE id IN (:x7x, :x7y, :x7z, :x7w))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e7a, :e7b, :e7c, :e7w, :e7u))
+    AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'u_own2')
+    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = :'u_own2')
+    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'u_own2'),
+  'E-LIFECYCLE-2C / r7 curățenie: datele comise (inclusiv owner-ul r7) au fost șterse');
+
 -- E-RACE-1: activarea externului (necomisă) ↔ acordul trece accepta → refuza.
 SELECT teste.dblink_exec('c_hr1', 'BEGIN');
 SELECT teste.dblink_exec('c_hr1', format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :x1));
```

## ACTUALIZARE r8 (01.10.2026, după NO-GO-ul Jakarinos — review static — și verdictul Copilot pe r7 `b916970`: c NO-GO, d NO-GO, e GO static)

**context_version:** cod pe branch `claude/erp-continuare-x4p5a7`, commitul r8 (mesaj „Conturi c/d r8”). NEAPLICAT pe live; în această rundă NU s-a citit nimic de pe live (nici SELECT). Reviewul r7 a confirmat închise cele 4 P1 + P2 din r6; r8 închide cele 2 P1 noi (Jakarinos P1-1 = Copilot P1-D; Jakarinos P1-2 = Copilot P1-C) + P2 (sweep). e e NEATINS (sha256 identic cu r7); pentru e se adaugă doar controlul de preflight cerut de Copilot (docs).

### Tabel blocant → fix → test
| # | Blocant (Jakarinos / Copilot) | Fix (fișier) | Test nou (harness) | Mutația care îl pică |
|---|---|---|---|---|
| 1 | **P1-1 / P1-D** d:467-472 (chei la 430-436) — cheile nume / email ale fișelor atinse (și CNP-ul privat în `fn_employees_persoana_lock`) erau calculate ÎNAINTE de așteptarea la lock, dintr-o identitate care se putea schimba între timp (T1 redenumește B / schimbă CNP-ul privat, comis cât timp T2 aștepta); T2 continua cu cheile vechi ⇒ garda lui A (T3) nu se serializa cu T2 | `fn_hr_employees_private_persoana_lock`, `fn_employees_persoana_lock` și `fn_cont_garda_persoana` (d): după fiecare `fn_cont_lock_chei` cheile se **recalculează dintr-o citire nouă** (nume / email din employees, CNP-ul privat din hr_employees_private) **până la punct fix** (toate cheile curente ținute); fără punct fix în 5 treceri ⇒ **40001** (de reîncercat), niciodată „continuă cu cheile vechi” (bucla veche a gărzii ieșea după 3 treceri și fără verificare finală). `fn_employees_persoana_lock` ia acum și cheia stabilă `gazpet.persoana.emp:<id>` (coerent cu garda și cu triggerul hr_employees_private). NULL-urile din CASE sunt scoase înaintea verificării `<@` | **D-RACE-CNP-REKEY** (Copilot: A CNP X pe fișă; B INACTIVĂ cu CNP Y doar privat; T1 Y→X necomis; T2 reactivează B și așteaptă; T1 COMMIT; T3 garda lui A **AȘTEAPTĂ** T2 — cheia X recitită; după COMMIT: `alt_contract_activ:B`), **D-RACE-CNP-REKEY-NUME** (Jakarinos: IONESCU ANA / POPESCU BOGDAN; T1 redenumește B2 în IONESCU BOGDAN necomis; T2 DELETE date personale B2 așteaptă; T1 COMMIT; T3 garda lui A2 **AȘTEAPTĂ** T2 — cheia IONESCU recitită; după COMMIT `posibil_alt_contract:B2`), **D-RACE-CNP-REKEY-EMAIL** (simetric pe email; `posibil_alt_contract:B3`) — toate cu 3 conexiuni | M2: `fn_hr_employees_private_persoana_lock` cu o singură trecere (cheile dinaintea așteptării) ⇒ **D-RACE-CNP-REKEY-NUME pică** la „(T3) garda AȘTEAPTĂ”; M3: `fn_employees_persoana_lock` fără recitirea CNP-ului privat ⇒ **D-RACE-CNP-REKEY pică** la „(T3) garda AȘTEAPTĂ” |
| 2 | **P1-2 / P1-C** c:456-463 + 503-524 — (a) emailul + confirmarea se reciteau din `auth.users` FĂRĂ lock pe rând (GoTrue putea schimba / confirma între recitire și UPDATE-ul pe profiles — lock-ul pe profil nu protejează rândul din auth.users); (b) marcajul `gazpet_legare_automata` era verificat doar înaintea helperului | `fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer, p_cere_marcaj boolean DEFAULT false)` (semnătură nouă): după fișă → profil, **rândul din auth.users e blocat `FOR NO KEY UPDATE`** și emailul, `email_confirmed_at` ȘI marcajul se citesc SUB acel lock; `fn_cont_leaga_la_creare` apelează cu `p_cere_marcaj = true` ⇒ marcaj retras între timp ⇒ `fara_marcaj_incredere`. Lock-ul e în blocul de excepții al RPC-ului (r7) ⇒ lock_timeout / 40P01 ⇒ `eroare` + notificare. **Precondiție nouă în c:** `has_table_privilege(current_user, 'auth.users', 'SELECT' / 'UPDATE')` (fail-closed). ROLLBACK c: DROP și pe semnătura `(uuid, integer, boolean)` | **C-RACE-AUTH-EMAIL** (T1 schimbă `auth.users.email` E1→E2 necomis; T2 service_role leagă pe E1: **AȘTEAPTĂ** la auth.users; structural: cât timp așteaptă ține DEJA profilul — `FOR UPDATE NOWAIT` din altă conexiune ⇒ 55P03; T1 COMMIT ⇒ `email_diferit`, nelegat), **C-RACE-AUTH-MARCAJ** (marcaj retras necomis ⇒ așteaptă ⇒ `fara_marcaj_incredere`, nelegat), **C-RACE-AUTH-CONF** (`email_confirmed_at` = NULL necomis ⇒ `email_neconfirmat`; control: confirmarea pusă la loc ⇒ `legat`) | M1: fără `FOR NO KEY UPDATE` pe auth.users ⇒ **C-RACE-AUTH-EMAIL pică** la „AȘTEAPTĂ rândul din auth.users” |
| 3 | **P2** d:913 (bucla sweep), 925-929, 1021-1022 — sweep-ul ținea lock-urile elementelor procesate până la COMMIT și AȘTEPTA la elementul următor ⇒ ciclu posibil cu HR (HR ține fișa B și așteaptă cheia de nume ținută de sweep de la A; sweep-ul ajunge la B și așteaptă fișa) — deadlock detectat, cu victimă posibil HR | `fn_conturi_inchideri_sweep`: **așteaptă DOAR cât timp nu ține nimic de la un element anterior** (`v_tine = false` — nu poate fi membru al unui ciclu); de la primul element ținut încolo, toate lock-urile se iau **fără așteptare** (`FOR UPDATE NOWAIT` pe fișă / profil / intrare; `pg_try_advisory_xact_lock` în `fn_cont_lock_chei` prin setarea locală `gazpet.cont_lock_nowait = on`, pusă doar în subtranzacția elementului) și **55P03 = „amanat_lock”**: intrarea rămâne NEATINSĂ (fără incercari / backoff / notificare), se reia la rularea următoare (≤ 5 min). `v_tine` devine true doar la ieșirea normală din bloc (și la CONTINUE); o eroare anulează subtranzacția (lock-urile se eliberează) și îl lasă neschimbat. 55P03 la primul element ținut (doar cu lock_timeout pus din afară) rămâne eroare, ca până acum (D-RACE-ERR neschimbat). **Varianta aleasă = minimă**: commit per element ar fi cerut procedură + schimbarea jobului cron; „toate cheile sortate înainte” nu se poate (cheile persoanei se află abia sub lock-ul fișei) | **D-RACE-SWEEP-CICLU** (A și B scadente azi, același nume de familie; HR ține fișa B: sweep-ul se **termină în ≤ 3 s** cu `{inchis: 1, amanat_lock: 1}`, fără `eroare`; intrarea lui B neatinsă (incercari 0, fără backoff / notificare), contul lui B deschis; apoi HR cere cheia de nume SWEEPESCU (redenumire) ⇒ trece imediat, fără 40P01; rularea următoare închide B) | M4: `v_tine` nu devine niciodată true (= r7, sweep-ul așteaptă mereu) ⇒ **D-RACE-SWEEP-CICLU pică** la „sweep-ul se TERMINĂ (≤ 3 s)” (sweep-ul rămâne blocat la fișa B) |

### Alegerea pe `auth.users` (de verdict)
- **Ordinea: fișă → profil → auth.users** (auth.users DUPĂ profil — Jakarinos; NU înaintea lui, cum sugera Copilot `employees → auth.users → profiles`): `fn_cont_inchide` (d) ia profilul FOR UPDATE și apoi scrie `auth.users` (ban) — două ordini opuse între legare și închidere ar fi fost un ciclu nou. Dovedit structural în C-RACE-AUTH-EMAIL (profilul e ținut cât timp se așteaptă la auth.users).
- **`FOR NO KEY UPDATE`, nu `FOR UPDATE`:** blochează exact UPDATE-urile GoTrue pe rând (schimbare / confirmare email, ban, metadata — toate NO KEY UPDATE sau mai tare), dar NU blochează `FOR KEY SHARE` = verificările FK ale GoTrue la login (INSERT în `auth.sessions` / `auth.refresh_tokens`) ⇒ un login în timpul legării nu așteaptă. Semantic pentru cursa P1-2 e identic cu FOR UPDATE.
- **Fără ciclu cu GoTrue:** GoTrue nu ține niciodată rândul din auth.users așteptând ceva de-al nostru (singurul trigger al pachetului pe auth.users e AFTER INSERT, pe rând NOU ⇒ profil nou, fără conflict cu un profil existent blocat); așteptarea e cel mult durata unei tranzacții GoTrue pe acel utilizator.
- **Drept:** funcțiile sunt SECURITY DEFINER (owner postgres); UPDATE pe auth.users e deja folosit de d (`banned_until`). Precondiția c refuză migrarea dacă `postgres` n-ar avea SELECT + UPDATE pe auth.users; preflightul live (docs/CONTURI_CICLU_VIATA.md) îl verifică read-only înainte de GO. **Deschis:** dacă FOR NO KEY UPDATE pe auth.users e inacceptabil ca politică (tabel GoTrue), alternativa documentată de Jakarinos (recitire + comparare sub lock-ul profilului + `UPDATE … WHERE` cu ROW_COUNT) NU închide fereastra (a) — rândul auth.users rămâne nelegat de lock-ul profilului — deci ar fi o atenuare, nu un fix.

### Alte schimbări în aceeași rundă
- `fn_cont_garda_persoana`: bucla de chei trece de la „3 treceri, fără verificare finală” la „punct fix sau 40001” (același tipar ca triggerele).
- Testul **D-RACE-ERR** (r5) e păstrat neschimbat ca semantică; în r8 intrarea retargetată rămasă din D-RACE-2 (u_dr3 → B, scadentă azi) e amânată cu o zi înaintea lui, ca elementul cu lock_timeout să fie PRIMUL ținut de sweep (altfel, cu lock-uri ținute, sweep-ul nu mai așteaptă ⇒ amanat_lock, nu eroare). Curățenia o șterge oricum.
- `teste.asteapta_liber(conn)` (harness): așteaptă până când o conexiune dblink nu mai e busy — un sweep care AȘTEAPTĂ (comportamentul vechi) rămâne busy ⇒ aserțiune picată determinist, fără hang.
- Rezultatul sweep-ului are o cheie nouă `amanat_lock` (jsonb); nimic în UI nu o consumă (rezultatul e doar jurnalizat de pg_cron).
- ROLLBACK d și e: neschimbate (fără obiecte noi; setarea `gazpet.cont_lock_nowait` e doar o variabilă locală tranzacției, nu un obiect).
- **e (GO static):** fișierul e NEATINS (sha256 r7). Controlul cerut de Copilot („externi activi nelegați cu emailul exact al unei fișe inactive — migrarea nu repară retrospectiv”) e adăugat în preflightul live din `docs/CONTURI_CICLU_VIATA.md` (SELECT read-only, așteptat 0 rânduri; altfel se decid manual înainte de e).

### Preflight live (NErulat în r8 — „pe live nimic”)
Referința rămâne tabelul din r6 (după `20261001201500`) + controalele noi din `docs/CONTURI_CICLU_VIATA.md` (drept postgres pe auth.users; externi activi nelegați cu email de fișă inactivă). Versiunile de livrare rămân cele din r7: **c `20261001230000` / d `20261001231500` / e `20261001233000`** (> `20261001224000` F1b, ultima live cunoscută).

### sha256 și versiuni (r8)
| Pas | Fișier | Versiune | sha256 |
|---|---|---|---|
| 1 | 20260929c_conturi_legare_automata.sql | `20261001230000` | `4303655ffd6aae7b1ad4606f75b87d23c25c23e846d6379679e2b05d2f6e50cf` |
| 2 | 20260929d_conturi_inchidere_la_incetare.sql | `20261001231500` | `3e5e7b33a08d114a31a7e55996585c7e5f008f07ce438a998da4e3d453aa907f` |
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001233000` | `be6366d9c4e1f110200569bbec6ebf04c234474f4944ec3875ec124eef635be9` (**neschimbat față de r7**) |
| — | c ROLLBACK | — | `c8a64245579d9e36e6c7b88b7567e64cb0628ef3930bc12a5a9f29ad101dde36` (DROP și pe `(uuid, integer, boolean)`) |
| — | d ROLLBACK | — | `c2e41e0e028ee9027823f48540e95fb2801cfad5fa16d2af9b291d739163b0e1` (neschimbat) |
| — | e ROLLBACK | — | `94eb12f925383a53648079c920c91ae4542867f5a2adb83bb7e15a0878e4e523` (neschimbat) |

**Atenție:** c și d s-au schimbat ⇒ verdictul se reînnoiește pe c și d; e are aceeași amprentă ca în r7 (GO static).

### Teste r8
- Harness PG16 `--rollback`: **1080 aserțiuni PASS** (1034 în r7; +23 aserțiuni noi × 2 rulări): după migrare 525, după rollback doar BAZĂ 26, după rollback + reaplicare 525, + gărzile de ordine / coadă și rollback-ul pas cu pas (schema după rollback = schema dinainte; după rollback d = schema de după c).
- Teste noi (toate concurente, 3 conexiuni dblink, date comise): C-RACE-AUTH-EMAIL (+ aserțiunea structurală profil → auth.users), C-RACE-AUTH-MARCAJ, C-RACE-AUTH-CONF (+ control `legat`), D-RACE-CNP-REKEY, D-RACE-CNP-REKEY-NUME, D-RACE-CNP-REKEY-EMAIL, D-RACE-SWEEP-CICLU (+ redenumirea HR fără 40P01 + rularea următoare).
- **Mutații** (fix-ul scos, harness pe un al doilea cluster local, 4 rulări, fișierele mutate cu numele originale — garda de livrare cere basename-ul): M1 (c, fără lock pe auth.users) → pică C-RACE-AUTH-EMAIL · M2 (d, trigger hr_employees_private cu o singură trecere) → pică D-RACE-CNP-REKEY-NUME · M3 (d, trigger employees fără recitirea CNP-ului privat) → pică D-RACE-CNP-REKEY · M4 (d, sweep-ul așteaptă mereu) → pică D-RACE-SWEEP-CICLU. Toate 4 opresc harness-ul exact la testul vizat („ESEC TEST: …”).
- Validator (`scripts/livrare_validator.py`): c OK (52), d OK (96), e OK (58).
- `npx vite build`: OK (fără schimbări în `src/`).

### Rămas deschis / de verdict
- Alegerea pe `auth.users` (ordinea profil → auth.users; FOR NO KEY UPDATE) — vezi secțiunea de mai sus.
- Preflightul live nu a fost rerulat în r8 (cerința rundei: nimic pe live); se rulează înainte de GO, cu cele 2 controale noi.
- Sweep-ul „amână” (nu eșuează) elementele contendate după primul: o contenție persistentă pe aceeași fișă ar amâna închiderea la fiecare rulare, fără alertă (intrarea rămâne vizibilă în `cont_activ_fost_angajat`); de decis dacă se vrea o alertă după N amânări (nu e în r8 — ar fi coloană nouă).
- `40001` din triggerele de lock / gardă (identitate schimbată de 5 ori în timpul așteptării) e teoretic: UI-ul HR primește eroarea și reîncearcă manual; nu există retry automat.

### Diff r8 (migrări + teste), față de `b916970`
```diff
diff --git a/supabase/migrations/20260929c_conturi_legare_automata.sql b/supabase/migrations/20260929c_conturi_legare_automata.sql
index a764a11..c383605 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata.sql
@@ -14,6 +14,8 @@
 --                                         supabase_auth_admin S-A refuză UPDATE-ul, iar eșecul era tăcut)
 --   * fn_cont_leaga_la_creare(profil)   — calea de încredere: RPC chemat de funcția edge cont-nou (service_role)
 --                                         sau de owner, după createUser cu app_metadata.gazpet_legare_automata
+--                                         r8: email / confirmare / marcaj reverificate SUB lock-ul rândului din auth.users
+--                                         (fn_cont_revalideaza_candidat, FOR NO KEY UPDATE; ordinea fișă → profil → auth.users)
 --   * trg_profiles_protectie_legatura   — employee_id / tip_cont / email / is_owner / role se schimbă doar de o
 --                                         identitate privilegiată explicită; un cont închis (R2) nu se mai poate auto-edita
 --   * fn_cont_leaga_automat(simulare, confirmate) — legare la cerere, poartă owner în cod; aplicarea leagă
@@ -59,6 +61,11 @@ BEGIN
     RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles: activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW) nu e live — se reanalizează';
   END IF;
   IF to_regprocedure('extensions.unaccent(text)') IS NULL THEN RAISE EXCEPTION 'Precondiție: extensions.unaccent(text) lipsește'; END IF;
+  -- r8 (P1-2): fn_cont_revalideaza_candidat blochează rândul din auth.users (FOR NO KEY UPDATE) ⇒ proprietarul funcțiilor
+  -- SECURITY DEFINER (postgres, = current_user aici) are nevoie de SELECT + UPDATE pe auth.users (d le folosește deja la ban).
+  IF NOT has_table_privilege(current_user, 'auth.users', 'SELECT') OR NOT has_table_privilege(current_user, 'auth.users', 'UPDATE') THEN
+    RAISE EXCEPTION 'Precondiție: % nu are SELECT + UPDATE pe auth.users (necesare pentru lock-ul rândului de logare la legare)', current_user;
+  END IF;
   -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
   -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
   IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
@@ -436,8 +443,22 @@ REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authentic
 -- cât timp legarea aștepta profilul) se lega totuși. NULL = se poate lega; altfel rezultatul de întors, fără legare.
 -- Lock-ul pe fișă e luat ÎNAINTEA profilului chiar dacă apelantul ținea deja profilul (reentrant) — vezi apelanții: niciunul
 -- nu mai ține profilul înainte de apel, ca ordinea fișă → profil să fie reală.
+-- r8 (P1-2 Jakarinos / P1-C Copilot pe b916970): identitatea de logare se recitea din auth.users FĂRĂ lock pe rând ⇒ GoTrue
+-- putea schimba / confirma emailul (sau marcajul putea fi retras) între recitire și UPDATE-ul pe profiles — lock-ul pe profil
+-- nu protejează rândul din auth.users. Acum rândul din auth.users e BLOCAT (FOR NO KEY UPDATE) și emailul, confirmarea ȘI
+-- marcajul gazpet_legare_automata (p_cere_marcaj = true pe calea de încredere) se citesc SUB acel lock.
+--   * Ordinea: fișă → profil → auth.users — auth.users DUPĂ profil (nu înaintea lui, cum sugera Copilot), ca să fie aceeași cu
+--     fn_cont_inchide din d (profil FOR UPDATE → UPDATE auth.users); două ordini opuse ar fi fost un ciclu nou (legare ↔ închidere).
+--   * FOR NO KEY UPDATE, nu FOR UPDATE: blochează exact UPDATE-urile GoTrue pe rând (schimbare / confirmare email, ban,
+--     metadata — toate iau NO KEY UPDATE sau mai tare), dar NU blochează FOR KEY SHARE = verificările FK ale GoTrue la login
+--     (INSERT în auth.sessions / auth.refresh_tokens) ⇒ un login în timpul legării nu așteaptă. GoTrue nu ține niciodată rândul
+--     din auth.users așteptând ceva de-al nostru (singurul trigger al pachetului pe auth.users e AFTER INSERT, pe rând NOU) ⇒ fără
+--     ciclu; așteptarea e cel mult durata unei tranzacții GoTrue pe acel utilizator.
+--   * Dreptul: SECURITY DEFINER (owner postgres) — UPDATE pe auth.users e deja folosit de d (banned_until); precondiția de mai jos
+--     refuză migrarea dacă postgres n-ar avea UPDATE pe auth.users (FOR NO KEY UPDATE îl cere).
 DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);
-CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer)
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer);   -- r7 (semnătura fără p_cere_marcaj)
+CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer, p_cere_marcaj boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
@@ -445,6 +466,7 @@ DECLARE
   v_p      public.profiles%ROWTYPE;
   v_email  text;
   v_conf   boolean;
+  v_incr   boolean;
   v_n      integer;
   v_emp    integer;
   v_ocupat boolean;
@@ -453,9 +475,11 @@ BEGIN
   PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;                 -- 1) fișa
   SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;       -- 2) profilul (recitit SUB lock)
   IF NOT FOUND THEN RETURN 'inexistent'; END IF;
-  SELECT u.email::text, u.email_confirmed_at IS NOT NULL INTO v_email, v_conf
-    FROM auth.users u WHERE u.id = p_profile_id;                                   -- emailul de logare, recitit
+  SELECT u.email::text, u.email_confirmed_at IS NOT NULL, COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true'
+    INTO v_email, v_conf, v_incr
+    FROM auth.users u WHERE u.id = p_profile_id FOR NO KEY UPDATE;                  -- 3) rândul de logare, BLOCAT și recitit (r8)
   IF NOT FOUND THEN RETURN 'inexistent'; END IF;
+  IF p_cere_marcaj AND NOT v_incr THEN RETURN 'fara_marcaj_incredere'; END IF;    -- marcajul retras cât timp se aștepta (r8)
   IF v_p.employee_id IS NOT NULL THEN RETURN 'legatura_existenta'; END IF;
   IF COALESCE(v_p.tip_cont, 'angajat') <> 'angajat' THEN RETURN 'tip_cont_exceptat'; END IF;
   IF NULLIF(lower(btrim(COALESCE(v_email, ''))), '') IS NULL
@@ -473,7 +497,7 @@ BEGIN
   IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
   RETURN NULL;
 END $fn$;
-REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
+REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(uuid, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
 
 CREATE OR REPLACE FUNCTION public.fn_cont_leaga_la_creare(p_profile_id uuid)
 RETURNS text
@@ -519,7 +543,9 @@ BEGIN
     -- r6 (C-RACE-LINK-1) + r7 (P1-C, P2): lock fișă → profil și revalidarea AMBELOR jumătăți (fișă activă; profil încă
     -- nelegat, tip angajat, email profil = email de logare recitit, confirmat; potrivirea recalculată identică) — ÎN blocul
     -- de excepții: un lock_timeout / 40P01 din așteptarea lock-urilor devine 'eroare' + notificare owner, nu scapă din RPC.
-    v_rez := public.fn_cont_revalideaza_candidat(p_profile_id, v_emp);
+    -- r8 (P1-2): p_cere_marcaj = true ⇒ marcajul gazpet_legare_automata, emailul de logare și confirmarea se reverifică SUB
+    -- lock-ul rândului din auth.users (citirile de mai sus erau doar filtrul rapid, nelegate de lock).
+    v_rez := public.fn_cont_revalideaza_candidat(p_profile_id, v_emp, true);
     IF v_rez IS NULL THEN
       UPDATE public.profiles SET employee_id = v_emp
        WHERE id = p_profile_id AND employee_id IS NULL;           -- nu suprascrie niciodată
diff --git a/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql b/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
index 41d5ce3..b22e1c4 100644
--- a/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
+++ b/supabase/migrations/20260929c_conturi_legare_automata_ROLLBACK.sql
@@ -48,7 +48,8 @@ DROP FUNCTION IF EXISTS public.fn_admin_conturi_alerte();
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean);
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean, jsonb);
 DROP FUNCTION IF EXISTS public.fn_cont_leaga_la_creare(uuid);
-DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer);   -- r7 (semnătura nouă)
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer, boolean);   -- r8 (semnătura cu p_cere_marcaj)
+DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer);   -- r7 (dacă ar fi rămas)
 DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);   -- r6 (dacă ar fi rămas)
 DROP FUNCTION IF EXISTS public.fn_cont_candidati_angajat(text);
 DROP FUNCTION IF EXISTS public.fn_cont_notifica_owneri(text, text, text, text);
diff --git a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
index ed3a67e..3e1b634 100644
--- a/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
+++ b/supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql
@@ -24,6 +24,9 @@
 --   ORDINEA LOCK-URILOR (uniformă, runda 3; r3: fișa employees FOR UPDATE întâi, ca la UPDATE-ul HR): [employees] → persoană (advisory) → profil (FOR UPDATE) → coadă / jurnal.
 --   r7: și legarea cont ↔ fișă (c) ia acum fișa ÎNAINTEA profilului (fn_cont_revalideaza_candidat) — ordine comună în tot pachetul;
 --       triggerul de închidere blochează profilul ÎNAINTEA deciziei și reverifică legătura / tipul / restaurarea sub lock (P1-D).
+--   r8: cheile persoanei (garda, trg_employees_persoana_lock, trg_hr_employees_private_persoana_lock) se RECALCULEAZĂ după fiecare
+--       lock până la punct fix (identitate schimbată concurent ⇒ chei noi ținute; fără punct fix ⇒ 40001), toate trei cu cheia
+--       gazpet.persoana.emp:<id>; sweep-ul așteaptă doar la primul element ținut, apoi NOWAIT + „amanat_lock” (fără ciclu cu HR).
 --   * fn_pgrst_pre_request     — hook PostgREST pentru revocarea EFECTIVĂ a JWT-urilor deja emise;
 --                                CREAT, dar NEACTIVAT (activarea = ALTER ROLE authenticator, cu acordul lui Răzvan)
 --   * fn_cont_restaureaza      — revenire din jurnal, EXCLUSIV owner, cu previzualizare (p_simulare)
@@ -294,10 +297,21 @@ CREATE OR REPLACE FUNCTION public.fn_cont_lock_chei(p_chei text[])
 RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
-DECLARE v_h bigint;
+DECLARE
+  v_h bigint;
+  -- r8 (P2 Jakarinos pe b916970): sweep-ul cere, DOAR cât timp ține deja lock-urile unui element procesat anterior,
+  -- varianta fără așteptare (gazpet.cont_lock_nowait = 'on', setare locală tranzacției, pusă de fn_conturi_inchideri_sweep
+  -- în subtranzacția elementului): o cheie ocupată ⇒ 55P03 (lock_not_available), nu intrare într-un ciclu de așteptare.
+  v_nowait boolean := COALESCE(current_setting('gazpet.cont_lock_nowait', true), '') = 'on';
 BEGIN
   FOR v_h IN SELECT DISTINCT hashtextextended(k, 0) FROM unnest(COALESCE(p_chei, '{}'::text[])) k WHERE k IS NOT NULL ORDER BY 1 LOOP
-    PERFORM pg_advisory_xact_lock(v_h);
+    IF v_nowait THEN
+      IF NOT pg_try_advisory_xact_lock(v_h) THEN
+        RAISE EXCEPTION 'cheia persoanei e ținută de altă tranzacție (fără așteptare)' USING ERRCODE = '55P03';
+      END IF;
+    ELSE
+      PERFORM pg_advisory_xact_lock(v_h);
+    END IF;
   END LOOP;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_cont_lock_chei(text[]) FROM PUBLIC, anon, authenticated, service_role;
@@ -364,8 +378,10 @@ DECLARE
   v_alt     integer;
 BEGIN
   -- 1) lock pe persoană; cheile se recalculează după lock (o scriere concurentă tocmai confirmată poate aduce un CNP /
-  --    nume nou) — cel mult 3 treceri, fiecare citire e o instrucțiune nouă (instantaneu nou)
-  FOR i IN 1..3 LOOP
+  --    nume nou) — fiecare citire e o instrucțiune nouă (instantaneu nou), până la PUNCT FIX (toate cheile curente ținute).
+  -- r8 (P1-1 Jakarinos pe b916970): bucla veche ieșea după 3 treceri și fără punct fix (cheile curente neținute ⇒ garda
+  --    continua pe o identitate neblocată). Acum: 5 treceri; dacă identitatea se tot schimbă ⇒ 40001 (de reîncercat).
+  FOR i IN 1..5 LOOP
     -- r6 (D-RACE-CNP-NULL): + cheia stabilă a fișei (gazpet.persoana.emp:<id>), luată și de triggerul pe
     -- hr_employees_private ⇒ un CNP care apare (NULL → X) în datele personale se serializează cu garda, chiar dacă fișa
     -- n-avea încă nicio cheie de CNP. Aceeași sortare globală (fn_cont_lock_chei: după hash).
@@ -376,6 +392,10 @@ BEGIN
     PERFORM public.fn_cont_lock_chei(v_chei);
     v_blocate := v_blocate || v_chei;
   END LOOP;
+  IF v_chei IS NOT NULL AND NOT (v_chei <@ v_blocate) THEN
+    RAISE EXCEPTION 'Identitatea fișei #% se schimbă concurent (CNP / nume / email): garda nu a ajuns la punct fix — reîncearcă', p_employee_id
+      USING ERRCODE = '40001';
+  END IF;
   -- 2) verificarea, DUPĂ lock
   v_cnp := public.fn_cont_persoana_cnp(p_employee_id);
   IF cardinality(v_cnp) = 0 THEN
@@ -418,22 +438,35 @@ RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
 DECLARE
-  v_priv text;
-  v_chei text[];
+  v_priv    text;
+  v_chei    text[];
+  v_blocate text[] := '{}';
 BEGIN
   IF TG_OP = 'UPDATE'
      AND NEW.cnp IS NOT DISTINCT FROM OLD.cnp AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.email IS NOT DISTINCT FROM OLD.email
      AND NOT (NEW.active IS TRUE AND (NEW.termination_date IS NULL OR NEW.termination_date > CURRENT_DATE)) THEN
     RETURN NEW;
   END IF;
-  IF TG_OP = 'UPDATE' THEN
-    SELECT public.fn_cont_cnp_normalizat(hp.cnp) INTO v_priv FROM public.hr_employees_private hp WHERE hp.employee_id = NEW.id;
-  END IF;
-  v_chei := public.fn_cont_persoana_chei(ARRAY[public.fn_cont_cnp_normalizat(NEW.cnp), v_priv], NEW.name, NEW.email);
-  IF TG_OP = 'UPDATE' THEN
-    v_chei := v_chei || public.fn_cont_persoana_chei(ARRAY[public.fn_cont_cnp_normalizat(OLD.cnp)], OLD.name, OLD.email);
+  -- r8 (P1-1): rândul employees e deja ținut de UPDATE (OLD / NEW sunt versiunea curentă), dar CNP-ul din datele personale se
+  -- citește fără lock ⇒ se recitește DUPĂ fiecare lock, până la punct fix (aceeași buclă ca în garda / triggerul hr_employees_private).
+  FOR i IN 1..5 LOOP
+    IF TG_OP = 'UPDATE' THEN
+      SELECT public.fn_cont_cnp_normalizat(hp.cnp) INTO v_priv FROM public.hr_employees_private hp WHERE hp.employee_id = NEW.id;
+    END IF;
+    -- r8: + cheia stabilă a fișei (gazpet.persoana.emp:<id>), aceeași ca în gardă și în triggerul hr_employees_private
+    v_chei := public.fn_cont_persoana_chei(ARRAY[public.fn_cont_cnp_normalizat(NEW.cnp), v_priv], NEW.name, NEW.email)
+              || ('gazpet.persoana.emp:' || NEW.id);
+    IF TG_OP = 'UPDATE' THEN
+      v_chei := v_chei || public.fn_cont_persoana_chei(ARRAY[public.fn_cont_cnp_normalizat(OLD.cnp)], OLD.name, OLD.email);
+    END IF;
+    EXIT WHEN v_chei <@ v_blocate;
+    PERFORM public.fn_cont_lock_chei(v_chei);
+    v_blocate := v_blocate || v_chei;
+  END LOOP;
+  IF NOT (v_chei <@ v_blocate) THEN
+    RAISE EXCEPTION 'Identitatea fișei #% se schimbă concurent: lock-ul persoanei nu a ajuns la punct fix — reîncearcă', NEW.id
+      USING ERRCODE = '40001';
   END IF;
-  PERFORM public.fn_cont_lock_chei(v_chei);
   RETURN NEW;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_employees_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
@@ -455,20 +488,37 @@ CREATE OR REPLACE FUNCTION public.fn_hr_employees_private_persoana_lock()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
 AS $fn$
-DECLARE v_chei text[];
+DECLARE
+  v_fixe    text[];
+  v_chei    text[];
+  v_blocate text[] := '{}';
 BEGIN
-  v_chei := public.fn_cont_persoana_chei(
+  v_fixe := public.fn_cont_persoana_chei(
     ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN public.fn_cont_cnp_normalizat(NEW.cnp) END,
           CASE WHEN TG_OP <> 'INSERT' THEN public.fn_cont_cnp_normalizat(OLD.cnp) END], NULL, NULL)
     -- r6 (D-RACE-CNP-NULL): cheia stabilă a fișei (veche / nouă), aceeași ca în fn_cont_garda_persoana
     || ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN 'gazpet.persoana.emp:' || NEW.employee_id END,
              CASE WHEN TG_OP <> 'INSERT' THEN 'gazpet.persoana.emp:' || OLD.employee_id END];
-  -- r7 (P1-D): cheile nume / email ale fișelor atinse (eligibilitatea la potrivirea pe nume / email se schimbă cu CNP-ul)
-  SELECT v_chei || COALESCE(array_agg(k), '{}'::text[]) INTO v_chei
-    FROM public.employees e
-    CROSS JOIN LATERAL unnest(public.fn_cont_persoana_chei(NULL, e.name, e.email)) k
-   WHERE e.id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.employee_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.employee_id END);
-  PERFORM public.fn_cont_lock_chei(v_chei);
+  v_fixe := array_remove(v_fixe, NULL);   -- (r8: NULL-urile din CASE ar strica verificarea de punct fix: <@ nu potrivește NULL)
+  -- r7 (P1-D): cheile nume / email ale fișelor atinse (eligibilitatea la potrivirea pe nume / email se schimbă cu CNP-ul).
+  -- r8 (P1-1 Jakarinos pe b916970): numele / emailul fișelor atinse se citeau O SINGURĂ DATĂ, ÎNAINTEA așteptării la lock;
+  -- o redenumire / schimbare de email comisă între timp (T1 ținea cheile vechi + noi) lăsa cheile curente neținute ⇒ garda
+  -- altei fișe cu noul nume de familie nu se mai serializa cu golirea CNP-ului. Acum: după fiecare lock, cheile se
+  -- RECALCULEAZĂ dintr-o citire nouă (instrucțiune nouă ⇒ vede ce s-a comis) până la punct fix; fără punct fix în 5
+  -- treceri ⇒ 40001 (de reîncercat), niciodată „continuă cu cheile vechi”.
+  FOR i IN 1..5 LOOP
+    SELECT v_fixe || COALESCE(array_agg(k), '{}'::text[]) INTO v_chei
+      FROM public.employees e
+      CROSS JOIN LATERAL unnest(public.fn_cont_persoana_chei(NULL, e.name, e.email)) k
+     WHERE e.id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.employee_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.employee_id END);
+    EXIT WHEN v_chei <@ v_blocate;
+    PERFORM public.fn_cont_lock_chei(v_chei);
+    v_blocate := v_blocate || v_chei;
+  END LOOP;
+  IF NOT (v_chei <@ v_blocate) THEN
+    RAISE EXCEPTION 'Identitatea fișei (nume / email) se schimbă concurent: lock-ul persoanei nu a ajuns la punct fix — reîncearcă'
+      USING ERRCODE = '40001';
+  END IF;
   RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
 END $fn$;
 REVOKE ALL ON FUNCTION public.fn_hr_employees_private_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
@@ -904,6 +954,17 @@ DECLARE
   v_rezult text;
   v_err    text;
   v_email  text;
+  -- r8 (P2 Jakarinos pe b916970): sweep-ul e O tranzacție (SELECT din pg_cron) ⇒ lock-urile elementelor procesate (fișă,
+  -- cheile persoanei, profil, intrare) rămân până la COMMIT. Dacă, ținându-le, AȘTEAPTĂ la elementul următor, poate intra
+  -- într-un ciclu cu HR (HR ține fișa B și așteaptă o cheie de nume ținută de sweep de la A; sweep-ul ajunge la B și așteaptă
+  -- fișa) — detectat de PostgreSQL ca deadlock, cu victimă posibil HR. Regula r8: sweep-ul AȘTEAPTĂ doar cât timp nu ține
+  -- nimic de la un element anterior (v_tine = false: nu poate fi membru al unui ciclu — nimeni nu așteaptă după el);
+  -- de la al doilea element ținut încolo, toate lock-urile se iau FĂRĂ așteptare (NOWAIT / pg_try_advisory_xact_lock prin
+  -- gazpet.cont_lock_nowait) și un 55P03 = „amânat” (amanat_lock): intrarea rămâne NEATINSĂ (fără incercari / backoff /
+  -- notificare) și se procesează la rularea următoare (≤ 5 min). Varianta cu commit per element ar fi cerut procedură +
+  -- schimbarea jobului cron; cea cu „toate cheile sortate înainte” nu se poate (cheile persoanei se află abia sub lock-ul fișei).
+  v_tine   boolean := false;
+  v_amanat boolean;
 BEGIN
   IF public.fn_identitate_privilegiata() IS NULL THEN
     RAISE EXCEPTION 'Coada închiderilor o procesează doar pg_cron (login postgres) sau o identitate privilegiată explicită'
@@ -917,23 +978,41 @@ BEGIN
             ORDER BY c.id LOOP
     v_rezult := NULL;
     v_garda := NULL;
+    v_amanat := false;
     BEGIN
       IF q.tip <> 'flaguri' AND q.employee_id IS NOT NULL THEN
         -- 0) fișa de angajat (r3, D1 Copilot): aceeași ordine ca un UPDATE HR pe employees (rând → advisory → profil → coadă).
         --    Fără lock, sweep-ul putea citi termination_date veche deja comisă în timp ce HR o muta în viitor ⇒ cont închis
         --    cu dată viitoare. Cu FOR UPDATE, citirea de mai jos (instrucțiune nouă, READ COMMITTED) vede versiunea comisă.
-        PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
-        v_garda := public.fn_cont_garda_persoana(q.employee_id);          -- 1) persoana (lock până la COMMIT)
+        IF v_tine THEN
+          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE NOWAIT;
+        ELSE
+          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
+        END IF;
+        -- 1) persoana (lock până la COMMIT); r8: fără așteptare dacă sweep-ul ține deja lock-uri de la alt element
+        --    (setarea e locală subtranzacției: la 55P03 revine singură, la succes o punem înapoi imediat)
+        PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN v_tine THEN 'on' ELSE 'off' END, true);
+        v_garda := public.fn_cont_garda_persoana(q.employee_id);
+        PERFORM set_config('gazpet.cont_lock_nowait', 'off', true);
       END IF;
-      PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;   -- 2) profilul
-      SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE;   -- 3) intrarea, recitită
+      IF v_tine THEN                                                           -- 2) profilul
+        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE NOWAIT;
+        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;   -- 3) intrarea, recitită
+      ELSE
+        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
+        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE;
+      END IF;
+      -- (v_tine devine true DOAR la ieșirea normală din bloc — și la CONTINUE: subtranzacția reușită păstrează lock-urile
+      --  până la COMMIT; o eroare anulează subtranzacția și le eliberează, deci v_tine rămâne cum era)
       IF NOT FOUND OR x.rezolvat_la IS NOT NULL OR x.abandonat_la IS NOT NULL THEN
+        v_tine := true;
         CONTINUE;                                    -- rezolvată între timp (restaurare, închidere manuală, reactivare)
       END IF;
       -- r4 (Copilot pe dac4bda): upsert-ul fn_cont_coada_pune poate retargeta intrarea (employee_id A→B) cât timp sweep-ul
       -- aștepta. Fișa blocată mai sus e A; nu blocăm B DUPĂ coadă (ar inversa ordinea fișă → advisory → profil → coadă).
       -- Intrarea retargetată se procesează la rularea următoare, cu lock-urile luate în ordinea corectă.
       IF (x.profile_id, x.employee_id, x.tip) IS DISTINCT FROM (q.profile_id, q.employee_id, q.tip) THEN
+        v_tine := true;
         CONTINUE;
       END IF;
       IF x.tip = 'flaguri' THEN
@@ -984,12 +1063,26 @@ BEGIN
          WHERE id = x.id;
         v_n := jsonb_set(v_n, ARRAY[v_rezult], to_jsonb(COALESCE((v_n ->> v_rezult)::int, 0) + 1));
       END IF;
+      v_tine := true;
     EXCEPTION WHEN OTHERS THEN
+      -- r8 (P2): 55P03 primit cât timp sweep-ul ținea lock-uri de la alt element = contenție, nu eșec: intrarea rămâne
+      -- neatinsă (fără incercari / backoff / notificare), se reia la rularea următoare. (55P03 la PRIMUL element ținut —
+      -- doar cu un lock_timeout pus din afară, sweep-ul nu-l pune — rămâne eroare, ca până acum.)
+      IF SQLSTATE = '55P03' AND v_tine THEN
+        v_amanat := true;
+        v_n := jsonb_set(v_n, ARRAY['amanat_lock'], to_jsonb(COALESCE((v_n ->> 'amanat_lock')::int, 0) + 1));
+      END IF;
+      IF NOT v_amanat THEN
       v_err := SQLERRM;
       v_n := jsonb_set(v_n, ARRAY['eroare'], to_jsonb(COALESCE((v_n ->> 'eroare')::int, 0) + 1));
       BEGIN
         -- subtranzacția anulată a eliberat lock-urile din bloc → aceeași ordine: profil, apoi intrarea
-        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
+        -- (r8: fără așteptare dacă se țin lock-uri de la alt element; 55P03 aici ⇒ doar WARNING, backoff-ul se face la rularea următoare)
+        IF v_tine THEN
+          PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE NOWAIT;
+        ELSE
+          PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
+        END IF;
         UPDATE public.conturi_inchideri_coada
            SET incercari = incercari + 1, ultima_eroare = v_err,
                urmatoarea_incercare_la = now() + least(interval '5 minutes' * power(2, incercari), interval '6 hours'),
@@ -1018,6 +1111,7 @@ BEGIN
       EXCEPTION WHEN OTHERS THEN
         RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): % [%] · eroarea inițială: %', q.id, SQLERRM, SQLSTATE, v_err;
       END;
+      END IF;   -- NOT v_amanat
     END;
   END LOOP;
   RETURN v_n;
diff --git a/supabase/tests/conturi_ciclu_viata.test.sql b/supabase/tests/conturi_ciclu_viata.test.sql
index 4a8c8f3..57594c2 100644
--- a/supabase/tests/conturi_ciclu_viata.test.sql
+++ b/supabase/tests/conturi_ciclu_viata.test.sql
@@ -238,6 +238,10 @@ SELECT teste.dblink_disconnect('c_tine3');
 -- retargetarea se comite; ~t0+2s prima eroare (55P03) → handlerul re-așteaptă profilul; t0+3s profilul e eliberat → handlerul
 -- își face UPDATE-ul de backoff pe o intrare care nu mai e a lui.
 SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr4'));
+-- r8 (P2): intrarea retargetată din D-RACE-2 (u_dr3 → B, încă deschisă, scadentă azi) ar fi PRIMUL element al sweep-ului; după ea
+-- sweep-ul ține lock-uri ⇒ la profilul lui u_dr4 n-ar mai aștepta (NOWAIT ⇒ amanat_lock), iar D-RACE-ERR vrea exact așteptarea cu
+-- lock_timeout pe PRIMUL element ținut. O amânăm (scadent_la mâine); D-RACE-2 a verificat-o deja, curățenia o șterge.
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE + 1 WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr3'));
 SELECT teste.dblink_connect('c_tine4', :'conn_lock');
 SELECT teste.dblink_exec('c_tine4', 'BEGIN');
 SELECT * FROM teste.dblink('c_tine4', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_dr4')) AS t(id text);
@@ -564,6 +568,255 @@ SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_lk2',
     AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_lk2, :e_lk3, :e_lk4, :e_lk5, :e_mva, :e_mvb, :e_mvg, :e_cla, :e_clb, :e_clc)),
   'r7 (c/d) curățenie: datele comise au fost șterse');
 
+-- ============================================================ r8 (NO-GO Jakarinos + Copilot pe r7 b916970): P1-1/P1-D, P1-2/P1-C, P2
+-- Toate concurente, deterministe (dblink, 3 conexiuni), date COMISE pe conn_lock. Ajutor: așteptarea până când o conexiune
+-- dblink a terminat (nu mai e „busy”) — un sweep care AȘTEAPTĂ un lock (comportamentul vechi) rămâne busy ⇒ aserțiunea pică
+-- determinist, fără să blocheze harness-ul.
+CREATE FUNCTION teste.asteapta_liber(p_conn text, p_iteratii integer DEFAULT 120) RETURNS boolean LANGUAGE plpgsql AS $fn$
+BEGIN
+  FOR i IN 1..p_iteratii LOOP
+    IF teste.dblink_is_busy(p_conn) = 0 THEN RETURN true; END IF;
+    PERFORM pg_sleep(0.025);
+  END LOOP;
+  RETURN false;
+END $fn$;
+SELECT gen_random_uuid() AS u_ae, gen_random_uuid() AS u_am, gen_random_uuid() AS u_ac, gen_random_uuid() AS u_s1, gen_random_uuid() AS u_s2 \gset
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
+  VALUES (%1$L, 'authenticated', 'authenticated', 'auth.email@gazpet.ro', '{"provider":"email","gazpet_legare_automata":true}', now(), now(), now()),
+         (%2$L, 'authenticated', 'authenticated', 'auth.marcaj@gazpet.ro', '{"provider":"email","gazpet_legare_automata":true}', now(), now(), now()),
+         (%3$L, 'authenticated', 'authenticated', 'auth.conf@gazpet.ro', '{"provider":"email","gazpet_legare_automata":true}', now(), now(), now()),
+         (%4$L, 'authenticated', 'authenticated', 'sweep.unu@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
+         (%5$L, 'authenticated', 'authenticated', 'sweep.doi@exemplu.ro', '{"provider":"email"}', now(), now(), now());
+  INSERT INTO public.employees (name, department, email, active) VALUES
+    ('AUTHESCU EMAIL', 'Test', 'auth.email@gazpet.ro', true), ('AUTHESCU MARCAJ', 'Test', 'auth.marcaj@gazpet.ro', true),
+    ('AUTHESCU CONF', 'Test', 'auth.conf@gazpet.ro', true);
+  -- D-RACE-CNP-REKEY: A activă, CNP X pe fișă; B INACTIVĂ (alt nume), CNP Y DOAR în datele personale
+  INSERT INTO public.employees (name, department, email, active, cnp, termination_date) VALUES
+    ('REKEYESCU ANA', 'Test', 'rekey.ana@exemplu.ro', true, '1900303000212', NULL),
+    ('ALTNUME BOGDAN', 'Test', 'altnume.bogdan@exemplu.ro', false, NULL, CURRENT_DATE - 10),
+  -- D-RACE-CNP-REKEY-NUME (scenariul Jakarinos): A2 = IONESCU ANA (CNP X2 pe fișă); B2 = POPESCU BOGDAN activă, CNP Y2 privat
+    ('IONESCU ANA', 'Test', 'ionescu.ana@exemplu.ro', true, '1900303000239', NULL),
+    ('POPESCU BOGDAN', 'Test', 'popescu.bogdan@exemplu.ro', true, NULL, NULL),
+  -- D-RACE-CNP-REKEY-EMAIL: A3 cu email; B3 activă, alt nume, alt email, CNP Y3 privat
+    ('REKEYMAIL ANA', 'Test', 'rekey.mail@exemplu.ro', true, '1900303000255', NULL),
+    ('ALTFAMILIE DAN', 'Test', 'altfamilie.dan@exemplu.ro', true, NULL, NULL),
+  -- D-RACE-SWEEP-CICLU: două fișe inactive (încetare azi), același nume de familie, cu CNP, fiecare cu cont și intrare în coadă
+    ('SWEEPESCU UNU', 'Test', 'sweep.unu@exemplu.ro', false, '1900303000271', CURRENT_DATE),
+    ('SWEEPESCU DOI', 'Test', 'sweep.doi@exemplu.ro', false, '1900303000280', CURRENT_DATE);
+  INSERT INTO public.hr_employees_private (employee_id, cnp)
+  SELECT id, CASE name WHEN 'ALTNUME BOGDAN' THEN '1900303000220' WHEN 'POPESCU BOGDAN' THEN '1900303000247' WHEN 'ALTFAMILIE DAN' THEN '1900303000263' END
+    FROM public.employees WHERE name IN ('ALTNUME BOGDAN', 'POPESCU BOGDAN', 'ALTFAMILIE DAN');
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'SWEEPESCU UNU') WHERE id = %4$L;
+  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'SWEEPESCU DOI') WHERE id = %5$L;
+  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
+  SELECT %4$L, id, 'programata', 'test D-RACE-SWEEP-CICLU A', CURRENT_DATE FROM public.employees WHERE name = 'SWEEPESCU UNU';
+  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
+  SELECT %5$L, id, 'programata', 'test D-RACE-SWEEP-CICLU B', CURRENT_DATE FROM public.employees WHERE name = 'SWEEPESCU DOI';
+$q$, :'u_ae', :'u_am', :'u_ac', :'u_s1', :'u_s2'));
+SELECT max(id) FILTER (WHERE name = 'AUTHESCU EMAIL') AS e_ae, max(id) FILTER (WHERE name = 'AUTHESCU MARCAJ') AS e_am,
+       max(id) FILTER (WHERE name = 'AUTHESCU CONF') AS e_ac,
+       max(id) FILTER (WHERE name = 'REKEYESCU ANA') AS e_rka, max(id) FILTER (WHERE name = 'ALTNUME BOGDAN') AS e_rkb,
+       max(id) FILTER (WHERE name = 'IONESCU ANA') AS e_rna, max(id) FILTER (WHERE name = 'POPESCU BOGDAN') AS e_rnb,
+       max(id) FILTER (WHERE name = 'REKEYMAIL ANA') AS e_rma, max(id) FILTER (WHERE name = 'ALTFAMILIE DAN') AS e_rmb,
+       max(id) FILTER (WHERE name = 'SWEEPESCU UNU') AS e_s1, max(id) FILTER (WHERE name = 'SWEEPESCU DOI') AS e_s2
+  FROM public.employees WHERE name IN ('AUTHESCU EMAIL', 'AUTHESCU MARCAJ', 'AUTHESCU CONF', 'REKEYESCU ANA', 'ALTNUME BOGDAN', 'IONESCU ANA',
+                                       'POPESCU BOGDAN', 'REKEYMAIL ANA', 'ALTFAMILIE DAN', 'SWEEPESCU UNU', 'SWEEPESCU DOI') \gset
+SELECT teste.assert((SELECT count(*) = 3 FROM public.profiles WHERE id IN (:'u_ae', :'u_am', :'u_ac') AND employee_id IS NULL)
+    AND (SELECT count(*) = 3 FROM public.hr_employees_private WHERE employee_id IN (:e_rkb, :e_rnb, :e_rmb))
+    AND (SELECT count(*) = 2 FROM public.conturi_inchideri_coada WHERE profile_id IN (:'u_s1', :'u_s2') AND rezolvat_la IS NULL AND scadent_la = CURRENT_DATE),
+  'r8 pregătire: date comise (3 conturi de încredere nelegate, fișele REKEY cu CNP doar privat, 2 intrări scadente azi în coadă)');
+SELECT teste.dblink_connect('c_t8', :'conn_lock');
+SELECT teste.dblink_connect('c_sr8', :'conn_lock');
+SELECT * FROM teste.dblink('c_sr8', 'SELECT teste.ca_service_role()::text') AS t(x text);
+SELECT pid AS pid_sr8 FROM teste.dblink('c_sr8', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_connect('c_a8', :'conn_lock');
+SELECT pid AS pid_a8 FROM teste.dblink('c_a8', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_connect('c_g8', :'conn_lock');
+SELECT pid AS pid_g8 FROM teste.dblink('c_g8', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+
+-- C-RACE-AUTH-EMAIL (r8, P1-2 / P1-C): T1 schimbă emailul de LOGARE E1→E2 în auth.users (necomis); T2 (service_role) leagă pe E1:
+-- citirile rapide văd E1, candidatul e calculat, apoi revalidarea ia fișa → profilul → rândul din auth.users (FOR NO KEY UPDATE)
+-- și AȘTEAPTĂ; T1 COMMIT ⇒ emailul recitit SUB lock e E2 ≠ profiles.email ⇒ email_diferit, nelegat. Înainte (r7): rândul nu era
+-- blocat, emailul recitit era E1 ⇒ legat. Structural: cât timp T2 așteaptă la auth.users, PROFILUL e deja ținut de el
+-- (ordinea fișă → profil → auth.users, aceeași cu fn_cont_inchide: profil → UPDATE auth.users).
+SELECT teste.dblink_exec('c_t8', 'BEGIN');
+SELECT teste.dblink_exec('c_t8', format('UPDATE auth.users SET email = ''auth.email2@gazpet.ro'' WHERE id = %L', :'u_ae'));
+SELECT teste.dblink_send_query('c_sr8', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_ae'));
+SELECT teste.assert(teste.asteapta_lock(:pid_sr8), 'C-RACE-AUTH-EMAIL legarea la creare (service_role) AȘTEAPTĂ rândul din auth.users în curs de schimbare a emailului (necomis)');
+SELECT res AS nowait_ae FROM teste.dblink('c_a8', format($q$SELECT COALESCE(teste.eroare(%L)::text, 'OK')$q$,
+  format('SELECT 1 FROM public.profiles WHERE id = %L FOR UPDATE NOWAIT', :'u_ae'))) AS t(res text) \gset
+SELECT teste.assert(:'nowait_ae' ~ '"state": "55P03"', 'C-RACE-AUTH-EMAIL cât timp așteaptă la auth.users, legarea ține DEJA profilul (FOR UPDATE NOWAIT din altă conexiune → 55P03): ordinea profil → auth.users');
+SELECT teste.dblink_exec('c_t8', 'COMMIT');
+SELECT res AS ae_rez FROM teste.dblink_get_result('c_sr8') AS t(res text) \gset
+SELECT count(*) AS rest_ae FROM teste.dblink_get_result('c_sr8') AS t(res text) \gset
+\echo '   C-RACE-AUTH-EMAIL rezultat:' :ae_rez
+SELECT teste.assert(:'ae_rez' = 'email_diferit' AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_ae'),
+  'C-RACE-AUTH-EMAIL emailul de logare schimbat (E1→E2) comis în timpul așteptării ⇒ recitit SUB lock: email_diferit, profilul rămâne nelegat');
+
+-- C-RACE-AUTH-MARCAJ (r8, P1-2 b): marcajul gazpet_legare_automata e RETRAS (necomis) cât timp calea de creare a citit true și
+-- așteaptă; după COMMIT marcajul e recitit sub lock-ul rândului ⇒ fara_marcaj_incredere, nelegat. Înainte: marcajul se verifica
+-- doar înaintea helperului ⇒ legat.
+SELECT teste.dblink_exec('c_t8', 'BEGIN');
+SELECT teste.dblink_exec('c_t8', format('UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - ''gazpet_legare_automata'' WHERE id = %L', :'u_am'));
+SELECT teste.dblink_send_query('c_sr8', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_am'));
+SELECT teste.assert(teste.asteapta_lock(:pid_sr8), 'C-RACE-AUTH-MARCAJ legarea la creare AȘTEAPTĂ rândul din auth.users în curs de retragere a marcajului (necomis)');
+SELECT teste.dblink_exec('c_t8', 'COMMIT');
+SELECT res AS am_rez FROM teste.dblink_get_result('c_sr8') AS t(res text) \gset
+SELECT count(*) AS rest_am FROM teste.dblink_get_result('c_sr8') AS t(res text) \gset
+\echo '   C-RACE-AUTH-MARCAJ rezultat:' :am_rez
+SELECT teste.assert(:'am_rez' = 'fara_marcaj_incredere' AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_am'),
+  'C-RACE-AUTH-MARCAJ marcajul retras în timpul așteptării ⇒ recitit SUB lock: fara_marcaj_incredere, nelegat');
+
+-- C-RACE-AUTH-CONF (r8, P1-2): confirmarea emailului e retrasă (email_confirmed_at = NULL, necomis) în timpul așteptării ⇒
+-- email_neconfirmat; control: cu confirmarea pusă la loc (comisă), același apel leagă.
+SELECT teste.dblink_exec('c_t8', 'BEGIN');
+SELECT teste.dblink_exec('c_t8', format('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = %L', :'u_ac'));
+SELECT teste.dblink_send_query('c_sr8', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_ac'));
+SELECT teste.assert(teste.asteapta_lock(:pid_sr8), 'C-RACE-AUTH-CONF legarea la creare AȘTEAPTĂ rândul din auth.users în curs de retragere a confirmării (necomis)');
+SELECT teste.dblink_exec('c_t8', 'COMMIT');
+SELECT res AS ac_rez FROM teste.dblink_get_result('c_sr8') AS t(res text) \gset
+SELECT count(*) AS rest_ac FROM teste.dblink_get_result('c_sr8') AS t(res text) \gset
+SELECT teste.assert(:'ac_rez' = 'email_neconfirmat' AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_ac'),
+  'C-RACE-AUTH-CONF confirmarea retrasă în timpul așteptării ⇒ recitită SUB lock: email_neconfirmat, nelegat');
+SELECT teste.dblink_exec(:'conn_lock', format('UPDATE auth.users SET email_confirmed_at = now() WHERE id = %L', :'u_ac'));
+SELECT res AS ac_dupa FROM teste.dblink('c_sr8', format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_ac')) AS t(res text) \gset
+SELECT teste.assert(:'ac_dupa' = 'legat' AND (SELECT employee_id = :e_ac FROM public.profiles WHERE id = :'u_ac'),
+  'C-RACE-AUTH-CONF control: cu identitatea de logare stabilă (confirmată, marcaj, email = profil), același apel leagă');
+
+-- D-RACE-CNP-REKEY (r8, P1-D Copilot): A (REKEYESCU ANA) are CNP X pe fișă; B (ALTNUME BOGDAN) e INACTIVĂ, CNP Y doar privat.
+--   T1: schimbă CNP-ul privat al lui B din Y în X (necomis; ține X, Y, emp:B, numele / emailul lui B).
+--   T2: reactivează B — triggerul employees citește CNP-ul privat ÎNAINTE de lock (Y), așteaptă T1 (Y / emp:B).
+--   T1 COMMIT. T2 continuă (necomis). Înainte (r7) T2 rămânea cu setul vechi de chei (fără X).
+--   T3: garda lui A ia X ⇒ trebuie să AȘTEPTE T2 (X ținut, recitit după lock); înainte: vedea B inactivă ⇒ „se poate închide”,
+--       iar după COMMIT-ul lui T2: B activă cu CNP X = alt contract activ cu același CNP, contul lui A închis.
+SELECT teste.dblink_exec('c_t8', 'BEGIN');
+SELECT teste.dblink_exec('c_t8', format('UPDATE public.hr_employees_private SET cnp = ''1900303000212'' WHERE employee_id = %s', :e_rkb));
+SELECT teste.dblink_exec('c_a8', 'BEGIN');
+SELECT teste.dblink_send_query('c_a8', format('UPDATE public.employees SET active = true, termination_date = NULL WHERE id = %s', :e_rkb));
+SELECT teste.assert(teste.asteapta_lock(:pid_a8), 'D-RACE-CNP-REKEY (T2) reactivarea lui B AȘTEAPTĂ schimbarea necomisă a CNP-ului privat (Y→X)');
+SELECT teste.dblink_exec('c_t8', 'COMMIT');
+SELECT res AS rk_t2 FROM teste.dblink_get_result('c_a8') AS t(res text) \gset
+SELECT count(*) AS rest_rk_t2 FROM teste.dblink_get_result('c_a8') AS t(res text) \gset
+SELECT teste.dblink_send_query('c_g8', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_rka));
+SELECT teste.assert(teste.asteapta_lock(:pid_g8),
+  'D-RACE-CNP-REKEY (T3) garda lui A AȘTEAPTĂ reactivarea necomisă a lui B: T2 a recitit CNP-ul privat după lock și ține cheia X');
+SELECT teste.dblink_exec('c_a8', 'COMMIT');
+SELECT res AS rk_garda FROM teste.dblink_get_result('c_g8') AS t(res text) \gset
+SELECT count(*) AS rest_rk_garda FROM teste.dblink_get_result('c_g8') AS t(res text) \gset
+\echo '   D-RACE-CNP-REKEY garda după COMMIT:' :rk_garda
+SELECT teste.assert(:'rk_garda' = 'alt_contract_activ:' || :e_rkb
+    AND (SELECT active IS TRUE FROM public.employees WHERE id = :e_rkb),
+  'D-RACE-CNP-REKEY după COMMIT-ul reactivării garda vede B ACTIVĂ cu CNP X ⇒ alt_contract_activ (contul lui A nu se închide)');
+
+-- D-RACE-CNP-REKEY-NUME (r8, P1-1 Jakarinos): A2 = IONESCU ANA (CNP X2 pe fișă); B2 = POPESCU BOGDAN activă, CNP Y2 doar privat.
+--   T1: redenumește B2 în IONESCU BOGDAN (necomis; ține cheile vechi + noi de nume, Y2, emp:B2).
+--   T2: ȘTERGE datele personale ale lui B2 — triggerul citește numele vechi (POPESCU), așteaptă T1 (Y2 / emp:B2).
+--   T1 COMMIT. T2 recitește numele după lock ⇒ ia și cheia IONESCU (necomis). Înainte (r7): rămânea cu POPESCU.
+--   T3: garda lui A2 (cheia IONESCU) ⇒ trebuie să AȘTEPTE T2; înainte: trecea (B2 avea încă CNP Y2 în instantaneu) și după
+--       COMMIT-ul lui T2 B2 era activă, fără CNP, cu același nume de familie — exact cazul posibil_alt_contract, neverificat.
+SELECT teste.dblink_exec('c_t8', 'BEGIN');
+SELECT teste.dblink_exec('c_t8', format('UPDATE public.employees SET name = ''IONESCU BOGDAN'' WHERE id = %s', :e_rnb));
+SELECT teste.dblink_exec('c_a8', 'BEGIN');
+SELECT teste.dblink_send_query('c_a8', format('DELETE FROM public.hr_employees_private WHERE employee_id = %s', :e_rnb));
+SELECT teste.assert(teste.asteapta_lock(:pid_a8), 'D-RACE-CNP-REKEY-NUME (T2) ștergerea datelor personale ale lui B2 AȘTEAPTĂ redenumirea necomisă');
+SELECT teste.dblink_exec('c_t8', 'COMMIT');
+SELECT res AS rn_t2 FROM teste.dblink_get_result('c_a8') AS t(res text) \gset
+SELECT count(*) AS rest_rn_t2 FROM teste.dblink_get_result('c_a8') AS t(res text) \gset
+SELECT teste.dblink_send_query('c_g8', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_rna));
+SELECT teste.assert(teste.asteapta_lock(:pid_g8),
+  'D-RACE-CNP-REKEY-NUME (T3) garda lui A2 (IONESCU) AȘTEAPTĂ ștergerea necomisă: T2 a recitit numele lui B2 după lock și ține cheia IONESCU');
+SELECT teste.dblink_exec('c_a8', 'COMMIT');
+SELECT res AS rn_garda FROM teste.dblink_get_result('c_g8') AS t(res text) \gset
+SELECT count(*) AS rest_rn_garda FROM teste.dblink_get_result('c_g8') AS t(res text) \gset
+\echo '   D-RACE-CNP-REKEY-NUME garda după COMMIT:' :rn_garda
+SELECT teste.assert(:'rn_garda' = 'posibil_alt_contract:' || :e_rnb
+    AND NOT EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id = :e_rnb)
+    AND (SELECT name = 'IONESCU BOGDAN' FROM public.employees WHERE id = :e_rnb),
+  'D-RACE-CNP-REKEY-NUME după COMMIT garda vede B2 activă, fără CNP, IONESCU ⇒ posibil_alt_contract (nu se închide)');
+
+-- D-RACE-CNP-REKEY-EMAIL (r8, simetric pe email): T1 pune emailul lui A3 pe fișa B3 (necomis); T2 șterge datele personale ale
+-- lui B3 (așteaptă); T1 COMMIT; T2 recitește emailul ⇒ ține cheia emailului; T3 garda lui A3 AȘTEAPTĂ T2, apoi posibil_alt_contract.
+SELECT teste.dblink_exec('c_t8', 'BEGIN');
+SELECT teste.dblink_exec('c_t8', format('UPDATE public.employees SET email = ''Rekey.Mail@exemplu.ro'' WHERE id = %s', :e_rmb));
+SELECT teste.dblink_exec('c_a8', 'BEGIN');
+SELECT teste.dblink_send_query('c_a8', format('DELETE FROM public.hr_employees_private WHERE employee_id = %s', :e_rmb));
+SELECT teste.assert(teste.asteapta_lock(:pid_a8), 'D-RACE-CNP-REKEY-EMAIL (T2) ștergerea datelor personale ale lui B3 AȘTEAPTĂ schimbarea necomisă a emailului');
+SELECT teste.dblink_exec('c_t8', 'COMMIT');
+SELECT res AS rm_t2 FROM teste.dblink_get_result('c_a8') AS t(res text) \gset
+SELECT count(*) AS rest_rm_t2 FROM teste.dblink_get_result('c_a8') AS t(res text) \gset
+SELECT teste.dblink_send_query('c_g8', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_rma));
+SELECT teste.assert(teste.asteapta_lock(:pid_g8),
+  'D-RACE-CNP-REKEY-EMAIL (T3) garda lui A3 AȘTEAPTĂ ștergerea necomisă: T2 a recitit emailul lui B3 după lock și ține cheia emailului');
+SELECT teste.dblink_exec('c_a8', 'COMMIT');
+SELECT res AS rm_garda FROM teste.dblink_get_result('c_g8') AS t(res text) \gset
+SELECT count(*) AS rest_rm_garda FROM teste.dblink_get_result('c_g8') AS t(res text) \gset
+\echo '   D-RACE-CNP-REKEY-EMAIL garda după COMMIT:' :rm_garda
+SELECT teste.assert(:'rm_garda' = 'posibil_alt_contract:' || :e_rmb,
+  'D-RACE-CNP-REKEY-EMAIL după COMMIT garda vede B3 activă, fără CNP, cu emailul lui A3 ⇒ posibil_alt_contract (nu se închide)');
+
+-- D-RACE-SWEEP-CICLU (r8, P2 Jakarinos): coada are A (SWEEPESCU UNU) și B (SWEEPESCU DOI), ambele scadente azi. HR ține FIȘA B
+-- (tranzacție deschisă). Sweep-ul procesează A (închide contul, ține cheia comună de nume SWEEPESCU până la COMMIT), ajunge la B:
+--   înainte (r7): aștepta fișa B ținând cheile lui A ⇒ când HR cerea cheia SWEEPESCU (ex. redenumire) ⇒ ciclu ⇒ 40P01 (victimă posibil HR);
+--   acum: cu lock-uri ținute de la A, fișa B se cere FĂRĂ așteptare ⇒ 55P03 ⇒ „amanat_lock”: intrarea lui B rămâne NEATINSĂ
+--   (fără incercari / backoff / notificare), sweep-ul se termină ⇒ HR trece fără ciclu; rularea următoare închide B.
+SELECT teste.dblink_connect('c_hr8', :'conn_lock');
+SELECT teste.dblink_connect('c_sw8', :'conn_lock');
+SELECT pid AS pid_sw8 FROM teste.dblink('c_sw8', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
+SELECT teste.dblink_exec('c_hr8', 'BEGIN');
+SELECT * FROM teste.dblink('c_hr8', format('SELECT id::text FROM public.employees WHERE id = %s FOR UPDATE', :e_s2)) AS t(id text);
+SELECT teste.dblink_send_query('c_sw8', 'SELECT public.fn_conturi_inchideri_sweep()::text');
+SELECT teste.asteapta_liber('c_sw8') AS sw8_liber \gset
+SELECT teste.assert(:'sw8_liber' = 't',
+  'D-RACE-SWEEP-CICLU sweep-ul se TERMINĂ (≤ 3 s) cât timp HR ține fișa B: nu așteaptă ținând lock-urile lui A (înainte rămânea blocat la fișa B)');
+SELECT res AS sw8_rez FROM teste.dblink_get_result('c_sw8') AS t(res text) \gset
+SELECT count(*) AS rest_sw8 FROM teste.dblink_get_result('c_sw8') AS t(res text) \gset
+\echo '   D-RACE-SWEEP-CICLU sweep (HR ține fișa B):' :sw8_rez
+SELECT teste.assert((:'sw8_rez'::jsonb ->> 'inchis')::int = 1 AND (:'sw8_rez'::jsonb ->> 'amanat_lock')::int = 1 AND NOT (:'sw8_rez'::jsonb ? 'eroare')
+    AND EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_s1' AND restaurat_la IS NULL)
+    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_coada
+          WHERE profile_id = :'u_s2' AND rezolvat_la IS NULL AND incercari = 0 AND ultima_eroare IS NULL
+            AND urmatoarea_incercare_la IS NULL AND abandonat_la IS NULL AND notificat_la IS NULL)
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_s2'),
+  'D-RACE-SWEEP-CICLU A închis (inchis = 1); B amânat (amanat_lock = 1, nu eroare): intrarea lui B neatinsă, contul lui B deschis');
+-- HR cere acum cheia comună de nume (redenumire): sweep-ul a comis ⇒ trece imediat, fără 40P01 (înainte: ciclu cu sweep-ul)
+SELECT teste.dblink_send_query('c_hr8', format('UPDATE public.employees SET name = ''SWEEPESCU DOI X'' WHERE id = %s', :e_s2));
+SELECT teste.asteapta_liber('c_hr8') AS hr8_liber \gset
+SELECT res AS hr8_rez FROM teste.dblink_get_result('c_hr8') AS t(res text) \gset
+SELECT count(*) AS rest_hr8 FROM teste.dblink_get_result('c_hr8') AS t(res text) \gset
+SELECT teste.assert(:'hr8_liber' = 't' AND :'hr8_rez' = 'UPDATE 1',
+  'D-RACE-SWEEP-CICLU redenumirea lui B de către HR (cheia de nume SWEEPESCU) trece imediat după sweep: fără ciclu, fără 40P01');
+SELECT teste.dblink_exec('c_hr8', 'ROLLBACK');
+SELECT res AS sw8_rez2 FROM teste.dblink('c_sw8', 'SELECT public.fn_conturi_inchideri_sweep()::text') AS t(res text) \gset
+\echo '   D-RACE-SWEEP-CICLU sweep (rularea următoare):' :sw8_rez2
+SELECT teste.assert((:'sw8_rez2'::jsonb ->> 'inchis')::int = 1 AND NOT (:'sw8_rez2'::jsonb ? 'amanat_lock')
+    AND EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_s2' AND restaurat_la IS NULL)
+    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_s2' AND rezolvat_la IS NULL),
+  'D-RACE-SWEEP-CICLU rularea următoare (fișa B eliberată) închide contul lui B');
+SELECT teste.dblink_disconnect('c_hr8');
+SELECT teste.dblink_disconnect('c_sw8');
+SELECT teste.dblink_disconnect('c_t8');
+SELECT teste.dblink_disconnect('c_sr8');
+SELECT teste.dblink_disconnect('c_a8');
+SELECT teste.dblink_disconnect('c_g8');
+SELECT teste.dblink_exec(:'conn_lock', format($q$
+  SET session_replication_role = replica;
+  DELETE FROM public.hr_employees_private WHERE employee_id IN (%6$s, %7$s, %8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s);
+  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%6$s, %7$s, %8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s);
+  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%6$s, %7$s, %8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s);
+  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %2$L, %3$L, %4$L, %5$L);
+  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %2$L, %3$L, %4$L, %5$L);
+  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %2$L, %3$L, %4$L, %5$L);
+  DELETE FROM public.employees WHERE id IN (%6$s, %7$s, %8$s, %9$s, %10$s, %11$s, %12$s, %13$s, %14$s, %15$s, %16$s);
+  SET session_replication_role = origin;
+  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %3$L, %4$L, %5$L);
+$q$, :'u_ae', :'u_am', :'u_ac', :'u_s1', :'u_s2',
+     :e_ae, :e_am, :e_ac, :e_rka, :e_rkb, :e_rna, :e_rnb, :e_rma, :e_rmb, :e_s1, :e_s2));
+SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_ae', :'u_am', :'u_ac', :'u_s1', :'u_s2'))
+    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_ae', :'u_am', :'u_ac', :'u_s1', :'u_s2'))
+    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_ae, :e_am, :e_ac, :e_rka, :e_rkb, :e_rna, :e_rnb, :e_rma, :e_rmb, :e_s1, :e_s2)),
+  'r8 (c/d) curățenie: datele comise au fost șterse');
+
 -- E-LIFECYCLE-2C (r7, P1-E): regula emailului EXACT și la schimbarea emailului unei fișe INACTIVE și la INSERT-ul unei fișe inactive.
 -- Date comise (conn_lock, autocommit — un INSERT în tranzacția testului ar ține cheile advisory ale numelui până la final și
 -- ar bloca conexiunile concurente de mai jos): externi NELEGAȚI activi; fișa A inactivă (încetare în trecut) cu alt email.
```
