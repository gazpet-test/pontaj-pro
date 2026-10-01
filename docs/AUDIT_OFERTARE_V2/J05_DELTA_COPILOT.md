# J05 (PR #542, migrarea 20261001a) — delta pentru Copilot, 01.10.2026

`context_version`: 01.10.2026 / commit `a70f3e2` (branch `claude/erp-continuare-x4p5a7-j05-garda`) · `generated_at`: 2026-10-01

**Stare: NEAPLICAT pe live.** Nimic nu s-a rulat pe producție în afară de SELECT-uri read-only pe cataloage.

## 1. Ce s-a schimbat față de versiunea anterioară (sha `66105ecd…`, commit `0c257f7`)

- **Merge `origin/main` în branch** (fără rebase sau force). Singurul conflict a fost în `supabase/revenire/README.md`. Am păstrat ambele secțiuni (J05 + 20261005a/20261003b).
- **Precondiții rebazate pe live-ul din 01.10.** Pe live s-au aplicat F1, F2, #537, #552, #558 și J02b r6 (v20261001140000). Am rulat read-only pe live exact interogarea de amprente din migrare. Rezultat:

| Amprentă | 30.09 (vechi) | Live 01.10 | De ce |
|---|---|---|---|
| `fn_gate_depunere` md5(prosrc) | `4bddf68c…` | `04102c5e44af4f5fc2062c1a58737bdd` | J02b r6: comutatorul `j02b_activ`, confirmare umană pentru „nu se aplică”, contorul `n_na_ai`. Ramurile de derogare (owner la acordare, audit `derogare_acordata` / `depusa_pe_derogare`) sunt textual neschimbate. Atributele și ACL-ul sunt identice. |
| Triggere pe `ofertare_licitatii` | `a00_ofertare_licitatii_scriere; trg_gate_depunere` | + `trg_ofertare_j02b_sens_unic`, `trg_ofertare_responsabil_setat_de` (ambele type=23, BEFORE INSERT OR UPDATE ROW, en=O, fără WHEN) | J02b r6 |
| RPC `ofertare_derogare_depunere`, `fn_ofertare_licitatii_scriere`, `fn_are_acces_ofertare`, `fn_gate_depunere_derogare_owner`, `fn_ofertare_derogari_audit_imuabil` | — | **neschimbate** (md5 + atribute + ACL) | — |
| Trigger audit, CHECK `actiune` (`ccb3f643…`), coloane (4) | — | **neschimbate** | — |
| Politici RLS `ofertare_licitatii_*`, `ofertare_derogari_audit_select`, FK/PK audit (md5 din harness) | — | **neschimbate** | — |
| `fn_ofertare_derogare_garda_j05` | — | LIPSĂ (normal, neaplicat) | — |

- **Corpul gărzii nu s-a schimbat.** md5(prosrc) rămâne `f84c9aeeb80fd990ee6f5110865a1aac`. S-au schimbat doar amprentele așteptate: în precondiție, în postcondiție și în rollback (același text de interogare în toate trei).
- **Testul** `supabase/tests/j05_garda.test.sql` are scheletul pe definițiile live din 01.10:
  - poarta J02b, copiată exact (md5 functiondef `e1768c83…`);
  - `fn_ofertare_j02b_sens_unic` și `fn_ofertare_responsabil_setat_de`, cu triggerele lor (md5 verificat față de live);
  - coloanele `j02b_activ` și `responsabil_setat_de`;
  - tabela `ofertare_j02b_activari`.
- `fn_ofertare_cerinta_na_confirmata` e un **ciot** în test, declarat explicit și scos din `md5_live`. Garda nu depinde de ea.
- `scripts/test_j05_garda.sh`: cazul de precondiție „niciun trigger (amprentă NULL)” șterge acum și triggerele J02b. Fără asta, mutantul „comparație triggere ne-NULL-safe” nu mai era prins.

## 2. Interacțiunea cu J02b

- **Aceleași tabele.** J05 adaugă un singur trigger pe `ofertare_licitatii`. Nu atinge coloanele J02b, `ofertare_j02b_activari` sau `ofertare_cerinte_na_confirmari`.
- **Ordinea triggerelor BEFORE UPDATE** (ordine C pe nume): `a00_ofertare_derogare_garda_j05` → `a00_ofertare_licitatii_scriere` → `trg_gate_depunere` → `trg_ofertare_j02b_sens_unic` → `trg_ofertare_responsabil_setat_de`.
  - Garda rămâne **prima**. Testul K04 verifică asta, iar K05 verifică lista completă.
  - Garda citește doar `derogare_*` și `status` din OLD/NEW și nu modifică NEW.
  - Triggerele J02b nu scriu `derogare_*`: `sens_unic` doar refuză, `responsabil_setat_de` scrie doar `responsabil_setat_de`.
  - Deci garda, poarta și J02b sunt independente. Niciun trigger de după gardă nu poate schimba `derogare_*` ca s-o ocolească.
- **Rollback-ul J02b** verifică doar existența triggerelor lui și md5-ul porții. Nu enumeră toate triggerele tabelei, deci prezența gărzii J05 nu-l blochează.
- **În sens invers, după un eventual rollback J02b**, precondiția J05 refuză (fail-closed), pentru că starea nu mai e cea auditată. Rollback-ul J05 face la fel: postcondiția lui cere starea live din 01.10, cu J02b inclus.
- **Gate 0e:**
  - Garda folosește `current_setting('request.jwt.claims')`, dar **nu e expusă**: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`.
  - Postcondiția verifică `has_function_privilege` = false pentru anon, authenticated și PUBLIC.
  - De aceea intră în afara domeniului lui `scripts/control_0e.sql`, care se uită doar la funcțiile cu EXECUTE pentru anon/authenticated.
  - Migrarea nu conține `set_config` în funcții, `SET ROLE` sau EXECUTE dinamic în funcții expuse. Singurul `EXECUTE v_q` e în blocurile DO de pre/post (anonime, neexpuse), cu text constant.
  - `set_config` apare doar în marcajul runnerului, nu în migrare.

## 3. Diff-ul migrării (`0c257f7` → `a70f3e2`)

```diff
diff --git a/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql b/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql
index 18b8d51..d738afa 100644
--- a/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql
+++ b/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql
@@ -26,6 +26,12 @@
 --     authenticated, PUBLIC pe gardă și pe funcțiile de trigger ale porții);
 --   • NICIO listă albă nu se actualizează automat după apply.
 --
+-- Rebazare 01.10 (după F1, F2, #537, #552, #558 și J02b r6 = v20261001140000, toate aplicate live): amprentele
+--   s-au recitit read-only din live. Diferențe față de 30.09: fn_gate_depunere md5(prosrc) 4bddf68c… → 04102c5e…
+--   (J02b r6: comutator j02b_activ + confirmare umană „nu se aplică”; ramurile de derogare și auditul neschimbate) și
+--   două triggere J02b noi pe ofertare_licitatii (trg_ofertare_j02b_sens_unic, trg_ofertare_responsabil_setat_de,
+--   BEFORE INSERT OR UPDATE, type=23). Garda rămâne PRIMA (a00_ofertare_derogare_garda_j05 < a00_… < trg_…, ordine C).
+--   Restul amprentelor (RPC, a00, acces, owner, imuabil, CHECK, coloane) = neschimbate. Detalii: J05_DELTA_COPILOT.md.
 -- Ce NU face (docs/AUDIT_OFERTARE_V2/J05_GARDA_PATCH.md): nu atinge date, poarta, RPC-ul, auditul;
 -- GOL: retragerea / schimbarea motivului de către OWNER prin UPDATE direct nu lasă audit; INSERT neacoperit;
 -- înghețul e legat de status='depusa'.
@@ -58,7 +64,7 @@ DECLARE
   -- Aceeași interogare de amprente în migrare, în postcondiție și în rollback (harness-ul verifică identitatea textului).
   v_q CONSTANT text := $amprente$
 WITH ams(fn, sig, asteptat) AS (VALUES
-  ('gate',     'public.fn_gate_depunere()',                              'src=4bddf68cfe53107a622d210f4ef3ec51 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
+  ('gate',     'public.fn_gate_depunere()',                              'src=04102c5e44af4f5fc2062c1a58737bdd secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
   ('rpc',      'public.ofertare_derogare_depunere(bigint,text,boolean)', 'src=50656c3c958e3a822c9ea1c3f70ae7d9 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=(p_licitatie_id bigint, p_motiv text, p_acorda boolean DEFAULT true) rez=void acl={authenticated=X/postgres,postgres=X/postgres}'),
   ('a00',      'public.fn_ofertare_licitatii_scriere()',                 'src=7d7591ef2bd5143ace505b85b1010977 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
   ('acces',    'public.fn_are_acces_ofertare()',                         'src=429d28e2a61fb24c8009d67050c16c85 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
@@ -112,9 +118,9 @@ BEGIN
       USING ERRCODE = '55000', DETAIL = coalesce(r.fn_dif, '-');
   END IF;
   -- 2. Stare COMPLETĂ cunoscută: live (fără gardă) sau patch (reaplicare). Stările mixte se refuză.
-  IF NOT ((NOT v_garda_exista AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=')
+  IF NOT ((NOT v_garda_exista AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=;trg_ofertare_j02b_sens_unic:public.fn_ofertare_j02b_sens_unic type=23 en=O qual_null=t attr=;trg_ofertare_responsabil_setat_de:public.fn_ofertare_responsabil_setat_de type=23 en=O qual_null=t attr=')
        OR (v_garda_exista AND (r.fn_ok ->> 'garda') IS NOT DISTINCT FROM 'true'
-           AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=')) THEN
+           AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=;trg_ofertare_j02b_sens_unic:public.fn_ofertare_j02b_sens_unic type=23 en=O qual_null=t attr=;trg_ofertare_responsabil_setat_de:public.fn_ofertare_responsabil_setat_de type=23 en=O qual_null=t attr=')) THEN
     RAISE EXCEPTION 'Precondiție 20261001a: starea nu e nici live 30.09, nici patch-ul (gardă prezentă=%, triggere=%). Nu suprascriu o stare necunoscută.', v_garda_exista, coalesce(r.trg_licitatii, 'NULL')
       USING ERRCODE = '55000', DETAIL = coalesce(r.fn_dif, '-');
   END IF;
@@ -193,7 +199,7 @@ DECLARE
   -- Aceeași interogare de amprente în migrare, în postcondiție și în rollback (harness-ul verifică identitatea textului).
   v_q CONSTANT text := $amprente$
 WITH ams(fn, sig, asteptat) AS (VALUES
-  ('gate',     'public.fn_gate_depunere()',                              'src=4bddf68cfe53107a622d210f4ef3ec51 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
+  ('gate',     'public.fn_gate_depunere()',                              'src=04102c5e44af4f5fc2062c1a58737bdd secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
   ('rpc',      'public.ofertare_derogare_depunere(bigint,text,boolean)', 'src=50656c3c958e3a822c9ea1c3f70ae7d9 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=(p_licitatie_id bigint, p_motiv text, p_acorda boolean DEFAULT true) rez=void acl={authenticated=X/postgres,postgres=X/postgres}'),
   ('a00',      'public.fn_ofertare_licitatii_scriere()',                 'src=7d7591ef2bd5143ace505b85b1010977 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
   ('acces',    'public.fn_are_acces_ofertare()',                         'src=429d28e2a61fb24c8009d67050c16c85 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
@@ -242,7 +248,7 @@ BEGIN
   -- Postcondiție ÎNAINTE de înregistrare / COMMIT-ul runnerului: dacă pică, se anulează tot (inclusiv garda).
   IF (SELECT bool_and(v::boolean) FROM jsonb_each_text(r.fn_ok) AS e(k, v)) IS DISTINCT FROM true
      OR (SELECT count(*) FROM jsonb_object_keys(r.fn_ok)) IS DISTINCT FROM 7::bigint
-     OR r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr='
+     OR r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=;trg_ofertare_j02b_sens_unic:public.fn_ofertare_j02b_sens_unic type=23 en=O qual_null=t attr=;trg_ofertare_responsabil_setat_de:public.fn_ofertare_responsabil_setat_de type=23 en=O qual_null=t attr='
      OR r.trg_audit IS DISTINCT FROM 'trg_ofertare_derogari_audit_imuabil:public.fn_ofertare_derogari_audit_imuabil type=58 en=O qual_null=t attr='
      OR r.chk IS DISTINCT FROM 'c|{3}|ccb3f643d993ae9d68284aca20a58366' THEN
     RAISE EXCEPTION 'Postcondiție 20261001a: starea rezultată nu e exact patch-ul (triggere=%).', coalesce(r.trg_licitatii, 'NULL')
```

## 4. sha256

- Migrare `supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql`: **`4ca385e1485914efd393c7fee1000d9f2c4de894e15d1051b12942668cd147a6`** (înainte: `66105ecd71c7ec571e3df4825e7e0aa5fb3627e716869572972cdf750c65d6c5`). Actualizat și în `J05_GARDA_PATCH.md` (comanda runnerului).
- Rollback `supabase/revenire/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql`: `5dfa5ab3751a24f122cb37d7b3646937b1a10b75726a7ccc663ff75fa84ed703`

## 5. Rezultatele testelor (local, 01.10)

| Ce | Rezultat |
|---|---|
| `bash scripts/test_j05_garda.sh` (PG16 local) | **PASS**. Faza live: 150 aserțiuni, 50 picate, toate în cele 30 de cazuri P/H (gaura J05 e reprodusă). Faza patch: 152 aserțiuni, 0 picate. 65 verificări de harness: livrare/runner, precondiții, rollback, reaplicare, mutanți (toți prinși). |
| `npx vitest run` | 43 fișiere, 1082 teste trecute |
| `npx vite build` | OK |

## 6. Riscuri / de știut

1. Precondițiile sunt la zi la ora citirii. Orice altă livrare pe `fn_gate_depunere` sau pe triggerele `ofertare_licitatii` înainte de apply face migrarea să refuze (fail-closed). Ce trebuie atunci: recitire + commit revizuit.
2. Ciotul `fn_ofertare_cerinta_na_confirmata` din test nu reproduce validarea după amprenta sursei. Nu afectează J05, dar testul J05 nu e și test J02b. J02b are suita lui: `scripts/test_j02b_na_confirmare.mjs`.
3. Golurile documentate rămân:
   - retragerea sau schimbarea motivului de către owner prin UPDATE direct nu lasă audit;
   - INSERT-ul nu e acoperit;
   - înghețul e legat de `status='depusa'`.
4. Cerințele de apply rămân: GO Copilot + acordul explicit al lui Răzvan + excepție de freeze pe Ofertare. Livrarea se face doar prin `scripts/livrare_migrare.sh`, cu noul sha.

---

## Re-review după NO-GO Copilot pe `b83b7d7` (01.10.2026)

**Blocker:** `v_q` nu amprenta funcțiile-trigger J02b care rulează DUPĂ gardă. Un corp alterat al lor, de exemplu `NEW.derogare_motiv := …`, ar fi trecut de PRE și ar fi ocolit garda.

**Fix:**
- **Amprente noi în `ams`.** Am adăugat `j02b_rs` = `public.fn_ofertare_responsabil_setat_de()` și `j02b_su` = `public.fn_ofertare_j02b_sens_unic()`.
  - Nivelul de amprentă e același ca la celelalte: md5(prosrc), secdef, proconfig, proprietar, limbaj, volatilitate, strict/leakproof/parallel/cost/rows, n (fără supraîncărcări), argumente, tip întors, ACL sortat.
  - Textul interogării e identic în PRE, POST și ROLLBACK.
  - Valorile le-am recitit read-only din live azi:
    - `fn_ofertare_responsabil_setat_de`: `src=d293542bb355ab377b4b68d5581692f0 secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v … n=1 args=() rez=trigger acl={postgres=X/postgres}`
    - `fn_ofertare_j02b_sens_unic`: `src=aa3c10df0e83a206b3490c7250c9580c`, restul identic.
- **PRE:** verifică explicit `fn_ok->>'j02b_rs'` și `fn_ok->>'j02b_su'`.
- **POST:** cere toate cele 9 amprente adevărate (înainte erau 7).
- **ROLLBACK:** pre și post verifică `bool_and(fn_ok - 'garda')`, deci acoperă automat cele 2 funcții noi.
- **Mutanți noi în `scripts/test_j05_garda.sh`:**
  - **PRE:** în scheletul live, `fn_ofertare_responsabil_setat_de` primește în plus `NEW.derogare_motiv := 'ocolire J05'`, cu aceeași semnătură și același trigger. Migrarea refuză cu „Precondiție 20261001a: funcțiile” înainte de orice DDL; nu rămâne nicio urmă și nu se înregistrează nimic.
  - **POST:** după `END $pre$;` se injectează `CREATE OR REPLACE` pe `fn_ofertare_j02b_sens_unic` (scrie `derogare_motiv`). POST refuză cu „Postcondiție 20261001a: starea rezultată” și se face rollback integral; nici garda, nici înregistrarea nu rămân.

**sha256 nou:**
- migrare: **`9b9af64d78b1e79e70b02cd7eee61672cd1c859da36ee125bdad9109b3e53e2f`** (înainte `4ca385e1…`);
- rollback: `c1a20a232bdb85eedc4fd04bbf9677adf0ff998f496a1435d60ee7bdb277e59a`.

**Teste:**
- `test_j05_garda.sh`: **PASS**. Faza live: 150 aserțiuni (50 picate, toate P/H). Faza patch: 152, 0 picate. **67** verificări de harness (înainte 65), iar cele 2 mutații noi sunt prinse.
- vitest: 1082/1082.
- `vite build`: OK.

**Diff-ul migrării față de `b83b7d7`:**

```diff
diff --git a/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql b/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql
index d738afa..fabd326 100644
--- a/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql
+++ b/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql
@@ -31,6 +31,8 @@
 --   (J02b r6: comutator j02b_activ + confirmare umană „nu se aplică”; ramurile de derogare și auditul neschimbate) și
 --   două triggere J02b noi pe ofertare_licitatii (trg_ofertare_j02b_sens_unic, trg_ofertare_responsabil_setat_de,
 --   BEFORE INSERT OR UPDATE, type=23). Garda rămâne PRIMA (a00_ofertare_derogare_garda_j05 < a00_… < trg_…, ordine C).
+--   Re-review Copilot (NO-GO b83b7d7): v_q amprentează și funcțiile-trigger J02b care rulează DUPĂ gardă
+--   (fn_ofertare_responsabil_setat_de d293542b…, fn_ofertare_j02b_sens_unic aa3c10df…), în PRE, POST și ROLLBACK.
 --   Restul amprentelor (RPC, a00, acces, owner, imuabil, CHECK, coloane) = neschimbate. Detalii: J05_DELTA_COPILOT.md.
 -- Ce NU face (docs/AUDIT_OFERTARE_V2/J05_GARDA_PATCH.md): nu atinge date, poarta, RPC-ul, auditul;
 -- GOL: retragerea / schimbarea motivului de către OWNER prin UPDATE direct nu lasă audit; INSERT neacoperit;
@@ -70,6 +72,8 @@ WITH ams(fn, sig, asteptat) AS (VALUES
   ('acces',    'public.fn_are_acces_ofertare()',                         'src=429d28e2a61fb24c8009d67050c16c85 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
   ('owner',    'public.fn_gate_depunere_derogare_owner()',               'src=e97f091143d6b492b6fdedf03dd283ea secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={postgres=X/postgres,service_role=X/postgres}'),
   ('imuabil',  'public.fn_ofertare_derogari_audit_imuabil()',            'src=22bab03fb862ae7fbd95538aa4bd6b28 secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
+  ('j02b_rs',  'public.fn_ofertare_responsabil_setat_de()',             'src=d293542bb355ab377b4b68d5581692f0 secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
+  ('j02b_su',  'public.fn_ofertare_j02b_sens_unic()',                   'src=aa3c10df0e83a206b3490c7250c9580c secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
   ('garda',    'public.fn_ofertare_derogare_garda_j05()',                'src=f84c9aeeb80fd990ee6f5110865a1aac secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}')
 ), fn AS (
   SELECT a.fn, a.asteptat,
@@ -113,7 +117,8 @@ BEGIN
   -- 1. Funcțiile de care depinde garda: exact live 30.09 (md5(prosrc) + atribute + ACL), NULL-safe.
   IF (r.fn_ok ->> 'gate') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'rpc') IS DISTINCT FROM 'true'
      OR (r.fn_ok ->> 'a00') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'acces') IS DISTINCT FROM 'true'
-     OR (r.fn_ok ->> 'owner') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'imuabil') IS DISTINCT FROM 'true' THEN
+     OR (r.fn_ok ->> 'owner') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'imuabil') IS DISTINCT FROM 'true'
+     OR (r.fn_ok ->> 'j02b_rs') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'j02b_su') IS DISTINCT FROM 'true' THEN
     RAISE EXCEPTION 'Precondiție 20261001a: funcțiile de care depinde garda diferă de starea auditată 30.09. Recitește live și reauditează.'
       USING ERRCODE = '55000', DETAIL = coalesce(r.fn_dif, '-');
   END IF;
@@ -205,6 +210,8 @@ WITH ams(fn, sig, asteptat) AS (VALUES
   ('acces',    'public.fn_are_acces_ofertare()',                         'src=429d28e2a61fb24c8009d67050c16c85 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
   ('owner',    'public.fn_gate_depunere_derogare_owner()',               'src=e97f091143d6b492b6fdedf03dd283ea secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={postgres=X/postgres,service_role=X/postgres}'),
   ('imuabil',  'public.fn_ofertare_derogari_audit_imuabil()',            'src=22bab03fb862ae7fbd95538aa4bd6b28 secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
+  ('j02b_rs',  'public.fn_ofertare_responsabil_setat_de()',             'src=d293542bb355ab377b4b68d5581692f0 secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
+  ('j02b_su',  'public.fn_ofertare_j02b_sens_unic()',                   'src=aa3c10df0e83a206b3490c7250c9580c secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
   ('garda',    'public.fn_ofertare_derogare_garda_j05()',                'src=f84c9aeeb80fd990ee6f5110865a1aac secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}')
 ), fn AS (
   SELECT a.fn, a.asteptat,
@@ -247,7 +254,7 @@ BEGIN
   EXECUTE v_q INTO r;
   -- Postcondiție ÎNAINTE de înregistrare / COMMIT-ul runnerului: dacă pică, se anulează tot (inclusiv garda).
   IF (SELECT bool_and(v::boolean) FROM jsonb_each_text(r.fn_ok) AS e(k, v)) IS DISTINCT FROM true
-     OR (SELECT count(*) FROM jsonb_object_keys(r.fn_ok)) IS DISTINCT FROM 7::bigint
+     OR (SELECT count(*) FROM jsonb_object_keys(r.fn_ok)) IS DISTINCT FROM 9::bigint
      OR r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=;trg_ofertare_j02b_sens_unic:public.fn_ofertare_j02b_sens_unic type=23 en=O qual_null=t attr=;trg_ofertare_responsabil_setat_de:public.fn_ofertare_responsabil_setat_de type=23 en=O qual_null=t attr='
      OR r.trg_audit IS DISTINCT FROM 'trg_ofertare_derogari_audit_imuabil:public.fn_ofertare_derogari_audit_imuabil type=58 en=O qual_null=t attr='
      OR r.chk IS DISTINCT FROM 'c|{3}|ccb3f643d993ae9d68284aca20a58366' THEN
```
