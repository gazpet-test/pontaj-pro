# PR #529 (Conturi c/d/e) — delta pentru Copilot, 01.10.2026 seara

**context_version (curent, r4):** branch `claude/erp-continuare-x4p5a7`, cod la commit `187542a`. Documentul e în commitul imediat următor.
**Istoric:** r1 = `0407bf7` (secțiunile 1–7, păstrate ca istoric) · r2 = `dad549b` · r3 = `a1dddd5` (delta `dac4bda`) · r4 = `187542a`
**Versiunile valabile sunt cele din r4** (secțiunile 5 / r2 / r3 au versiuni depășite).
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
| 3 | 20260929e_fost_angajat_colaborare_externa.sql | `20261001193000` | **BLOCAT** până la decizia lui Răzvan pe politica E. Varianta r3 = `1adac6d7…` |

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
