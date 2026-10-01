# PR #540: delta pentru Copilot (r2, 01.10.2026)

**Patch:** 20261003d, tokenurile de concediu (`hr_concediu_tokens`). Statut: **NEAPLICAT, HOLD**.

**De ce există delta:** azi, 01.10, s-au aplicat pe live F1 (`20260930i`) și F2 (`20260930j`), plus #537, #552, #558 și J02b r6. Precondițiile din r1 nu mai potriveau cu starea live.

## 1. Starea live la 01.10, citită doar cu SELECT

| Ce | Valoare | Față de r1 |
|---|---|---|
| Politica `hr_tokens_sel` | `auth.uid() IS NOT NULL`, md5 `dc71e447…` | neschimbată, **gaura există încă** |
| Tokenuri | 117, toate `activ` | neschimbat |
| Privilegii anon/authenticated | `SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,MAINTAIN` | **fără TRUNCATE** (F1) |
| Privilegii service_role | toate, inclusiv TRUNCATE | neschimbat |
| Trigger `prevent_role_escalation` | prosrc `cf75b37d…` | era `16112659…` (F2) |
| Trigger `enforce_owner_only_salary_flags` | prosrc `daaa5612…` | era `0470660c…` (F2) |
| Politici de scriere pe profiles/user_module_access, roluri | identice | neschimbate |
| Gate 0e pe live | 0 rânduri | — |

Concluzia: **PR-ul e încă necesar.** F1 a închis doar TRUNCATE, iar F2 doar ocolirea cu `auth.uid()` NULL. Niciunul nu restrânge citirea tokenurilor.

## 2. Ce s-a schimbat în r2

Doar precondițiile și harness-ul. Logica patch-ului, starea țintă și postcondiția au rămas aceleași.

- **Migrare:**
  - `c_priv_live` = live după F1: anon și authenticated fără TRUNCATE, service_role cu TRUNCATE.
  - `c_inv_trg` = md5-urile F2. Am verificat că sunt exact corpurile din `20260930j` (r8).
  - Starea r1 (cu TRUNCATE) **nu mai e acceptată**, ca să rămână fail-closed.
- **Revenire:** după `GRANT ALL`, un `REVOKE TRUNCATE … FROM anon, authenticated`. Revenirea readuce „live după F1”, nu redeschide TRUNCATE.
- **Schelet:** corpurile F2 copiate exact din `20260930j`, plus `REVOKE TRUNCATE`, ca în F1.
- **Teste:**
  - G5 și G6 (TRUNCATE pe live) așteaptă acum refuz.
  - Discriminarea pe live trece de la 12 la 10 verificări izolate, pentru că A2 și W-TRUNCATE trec deja după F1.
- **`supabase/revenire/README.md`:** conflict la merge cu `origin/main`, rezolvat prin păstrarea ambelor secțiuni.

## 3. Verificare
- `scripts/test_sec_concediu_tokens.sh` (PG16 local): **TOATE TESTELE AU TRECUT**. Rezultat: 90 de verificări în harness, 33 în suita patch, 21 de mutanți prinși.
- `c_priv_live` cu MAINTAIN (PG17) a fost comparat textual cu amprenta live: identic.
- **Gate 0e:**
  - patch-ul nu creează și nu modifică funcții;
  - 0e pe live = 0 rânduri.
- `npx vite build`: OK. PR-ul nu atinge `src/`.

## 4. SHA256 (r2)
- `supabase/migrations/20261003d_sec_concediu_tokens.sql`: `fa9d88e2d1b4c75faca98010eece147a68b0fff764be461a24cd03f610d558ab`
- `supabase/revenire/20261003d_sec_concediu_tokens_ROLLBACK.sql`: `2329d898e500a13e2f369c051872de58a87100e0d9284d9ac6c730f5077bbf1b`

## 5. Observație nouă
F1 a lăsat **MAINTAIN** pentru anon și authenticated pe tabelele din public: pe live, `hr_concediu_tokens` îl are încă. Patch-ul îl scoate oricum, prin `REVOKE ALL`. La nivel de schemă e un rest al lui F1, de urmărit separat: nu e exploatabil prin PostgREST, dar e privilegiu în plus.

## 6. Decizii deschise pentru Răzvan (neschimbate față de r1)

1. **Tokenurile deja expuse:**
   - A: reemitere completă;
   - B: dezactivarea celor 12 de la angajații plecați;
   - C: risc acceptat.

   **Recomandare: B acum, A odată cu expirarea.**
2. **Expirarea și tokenurile pentru angajați noi:** patch separat, da sau nu.
3. **Restrângerea la HR propriu-zis:** scoate 4 conturi și cere modificare în UI.
   - A: rămâne `hr` / `hr.*`;
   - B: doar HR propriu-zis.

   **Recomandare: A.**

## 7. Cerere către Copilot
Review pe diff-ul r2: precondiții, revenire, schelet și teste. Cerem GO sau NO-GO pe „gata de aplicare”. Aplicarea cere în plus acordul lui Răzvan.

---
## r2b (01.10, după deciziile lui Răzvan și merge-ul cu #532/#542/#543)

**Decizii luate**
- **Tokenurile expuse:** **B** acum (dezactivăm cele 12 ale angajaților plecați), apoi **A** (reemitere) odată cu patch-ul de expirare.
- **Vizibilitate:** **A** (`hr` / `hr.*`). Migrarea implementează deja varianta asta, așa că n-am schimbat codul.

**B se face prin DML separat, nu prin migrare.** Fișierul este `docs/AUDIT_OFERTARE_V2/540_DML_PREVIEW.sql` (sha256 `5ef687e7a5e1e7aab2b74bcf8be67ce61e5225484cfd1f00cab99215c7c2c7a4`) și **nu a fost rulat**. Conține:
- preview read-only;
- UPDATE cu listă fixă de 12 `employee_id` și gardă `n = 12`, cu RETURNING + `array_agg`;
- sanity check: 0 tokenuri active la plecați, 105 active în total;
- rollback de date.

Cheia tabelei este `employee_id`; tabela nu are coloană `id`. Cele 12 tokenuri, citite pe live (employee_id, angajat, data încetării):
79 NGUYEN VAN PHUNG 2026-07-11 · 156 NASTASE MARIUS CRISTIAN 2026-07-16 · 23 BUCSAIN LAURENTIU ADELIN 2026-07-20 · 151 PANATIE COSMIN IOAN 2026-07-20 · 36 CURCA ANDREEA ALEXANDRA 2026-07-31 · 46 DUMITRU MARIAN 2026-08-07 · 32 CODITA CORNELIU CRISTIAN 2026-09-01 · 47 EBETIUC EUGEN IONEL 2026-09-01 · 155 BUTUCAN NICOLAE MARIUS 2026-09-01 · 62 KUSHWAHA SHRIRAM 2026-09-07 · 17 BAIESU DARIUS OVIDIU 2026-09-11 · 57 IOAN SORIN ALEXANDRU 2026-09-25.

**Reverificare pe live după #532/#542/#543** (doar SELECT):
- Migrările noi pe live sunt `20260930a`, `20260930e`, `20261001a`, `20261002a`.
- Nimic relevant pentru acest PR nu s-a schimbat: politica `hr_tokens_sel`, triggerele F2, politicile de scriere pe `profiles` și `user_module_access` și privilegiile fără TRUNCATE sunt identice cu r2.
- Precondițiile r2 rămân valabile.

**Fix în harness:** verificarea statică „fără COMMIT în fișier” folosea `grep -q` sub `pipefail`. `grep -q` putea închide pipe-ul devreme, `sed` primea SIGPIPE, iar `!` transforma potrivirea într-un fals „curat”, intermitent. Acum se folosește `grep >/dev/null`.

**Rezultate:**
- harness PG16: TOATE TESTELE AU TRECUT (90 de verificări + 33, 21 de mutanți prinși);
- build OK.

Migrarea și revenirea sunt neschimbate (sha256 ca la §4).

---
## r2c — 540_DML_PREVIEW.sql după NO-GO Copilot (01.10)
Verdict Copilot: GO pe migrarea #540, NO-GO pe fișierul DML. Am reparat cele două probleme semnalate:

1. Pasul (3) e acum **un singur bloc DO**, care face pe rând:
   - recitește setul;
   - îl compară cu cele **12 perechi fixe** (employee_id:termination_date) și verifică `active IS FALSE` și `termination_date <= CURRENT_DATE`; la orice diferență dă RAISE;
   - face UPDATE și verifică `GET DIAGNOSTICS ROW_COUNT = 12`, altfel RAISE;
   - verifică starea finală: niciunul dintre cele 12 nu mai e activ, iar cele dezactivate sunt exact lista aprobată; altfel RAISE;
   - emite `ids_rollback` prin NOTICE.
2. **Rollback:** e marcat explicit „valabil DOAR imediat după rulare și după reverificare”. Restaurează doar `ids_rollback` din NOTICE și refuză dacă starea nu mai e cea de imediat după DML.

**Verificare:** pe un PG16 local, cu date fictive. Prima rulare dezactivează 12 tokenuri; a doua e refuzată de gardă. **Nerulat pe live.**

**sha256:** `fb4477caa4047ef7b215a0fcbc326e491925eb8bd1fa7607e7200bebca0695b3`

---
## r2d — 540_DML_PREVIEW.sql r3, după NO-GO Copilot pe fb4477ca (01.10)
1. **Gardă pe setul global.** În blocul DO, *toate* tokenurile active ale angajaților plecați (`t.activ AND e.active IS FALSE`, fără filtru pe `c_ids`) trebuie să fie exact cele 12 perechi aprobate, inclusiv `termination_date`. Se refuză și orice încetare cu dată NULL sau viitoare printre cele 12.
   - Sanity-ul global (0 tokenuri active la plecați) e acum postcondiție în DO.
   - Query-ul de după rămâne doar informativ.
2. **Fingerprint.** Înainte de UPDATE se capturează `employee_id:md5(token)` pentru cele 12, ca NOTICE. Tokenul în clar nu apare nicăieri.
   - Rollback-ul reactivează doar rândurile al căror `employee_id:md5(token)` coincide cu fingerprint-ul.
   - Cere exact 12 potriviri și verifică `ROW_COUNT = 12`.
   - E valabil doar imediat după rulare și după reverificare.
3. **Hardening.**
   - `FOR UPDATE` pe cele 12 rânduri din `employees` (ordonate după id), apoi pe cele din `hr_concediu_tokens`, înainte de precheck.
   - Postcondiția revalidează că cele 12 sunt tot plecate, cu aceleași date, și inactive.

**Testat local (PG16, date fictive):**
- happy path: 12 dezactivate și fingerprint emis;
- un al 13-lea plecat cu token activ: refuz la garda globală;
- rollback cu fingerprint: 12 reactivate;
- rollback repetat: refuz.

**Nerulat pe live.** sha256: `10822c3f8c05336582bff3d0e5dcda0b4e27114b035378e189723e53806fa169`
