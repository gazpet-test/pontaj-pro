# PR #541: delta pentru Copilot (r2, 01.10.2026)

**Patch:** 20261003e, trezorerie (`trezorerie_conturi`, `trezorerie_extras_linii`). Statut: **NEAPLICAT, HOLD**.

**De ce există delta:** azi, 01.10, s-au aplicat pe live F1 (`20260930i`) și F2 (`20260930j`), plus #537, #552, #558 și J02b r6. Precondițiile din r1 nu mai potriveau cu starea live.

## 1. Starea live la 01.10, citită doar cu SELECT

| Ce | Valoare | Față de r1 |
|---|---|---|
| Politici | `trez_*_rw FOR ALL … auth.uid() IS NOT NULL` | neschimbate, **gaura există încă** |
| Rânduri | 33 conturi + 33 linii; `can_access_financiar` = 0 conturi | neschimbat |
| ACL tabele anon/authenticated | `SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER` | **fără TRUNCATE** (F1) |
| MAINTAIN pe t1/t2 | anon, authenticated, postgres, service_role | F1 **nu** l-a retras: `maintain_eq_truncate=f` |
| Secvențe, helperi | neschimbate; helperii lipsesc | neschimbat |
| Triggere pe profiles | prosrc `cf75b37d…` și `daaa5612…` | F2 |
| Gate 0e pe live | 0 rânduri | — |

Concluzia: **PR-ul e încă necesar.** F1 a închis doar TRUNCATE. Orice cont logat poate încă citi, modifica și șterge IBAN-uri.

## 2. Ce s-a schimbat în r2

Precondiții și harness. Patch-ul, starea țintă și postcondiția au rămas aceleași.

- **`c_ob_init` → `c_ob_init_sablon`:**
  - ACL-urile live după F1, fără TRUNCATE pentru anon și authenticated.
  - `maintain_eq_truncate` pe t1/t2 depinde de versiune: `f` pe PG17 (live), `t` pe PG16 (harness).
  - Pe PG17 se adaugă verificarea exactă **[pre:maintain]**: deținătorii MAINTAIN pe t1/t2 trebuie să fie exact `anon,authenticated,postgres,service_role`, altfel refuz. Așa nu se pierde precizia pe care o dădea vechiul invariant.
- **`c_ef_init`** = privilegiile efective de pe live, fără TRUNCATE pentru anon și authenticated.
- **`c_inv_trg`** = md5-urile F2.
- Starea r1 nu mai e acceptată, ca să rămână fail-closed.
- **Revenire:** neschimbată. Nu readuce privilegii anon sau TRUNCATE.
- **Schelet:** corpurile F2 copiate exact din `20260930j`, plus `REVOKE TRUNCATE`, ca în F1.
- **Teste:** `anon TRUNCATE` și `authenticated TRUNCATE` așteaptă refuz în toate stările.
- **`supabase/revenire/README.md`:** conflict la merge, rezolvat prin păstrarea ambelor secțiuni.

## 3. Verificare
- **`scripts/test_sec_trezorerie.sh` (PG16 local):** PASS, 860 de verificări, 26 de mutanți prinși.
  - Numărul diferă de r1 (994 / 15) pentru că harness-ul s-a schimbat de la r1 încoace. Toate secțiunile A–I au rulat.
  - Pe un cluster nou, harness-ul cere rolul `postgres` creat înainte de `CREATE DATABASE … OWNER postgres`. E o limită veche a harness-ului, pe care am ocolit-o manual.
- **PG17 local** (schelet + emularea runnerului, cu ROLLBACK la final):
  - precondiția trece, cu ramura `[pre:maintain]` inclusă;
  - postcondiția e OK;
  - negativ: `GRANT MAINTAIN … TO PUBLIC` e refuzat de `[pre:maintain]`.
- **Gate 0e:** pe live, 0 rânduri. Helperii noi (`fn_trezorerie_poate_*`, SQL, EXECUTE pentru authenticated) nu conțin `set_config`, `request.jwt`, `role`/`session`, `execute` sau `u&` (verificare statică pe prosrc). Deci 0e rămâne 0 după aplicare.
- `npx vite build`: OK. PR-ul nu atinge `src/`.

## 4. SHA256 (r2)
- `supabase/migrations/20261003e_sec_trezorerie.sql`: `7bc25e50d4aa90b279581d1c76474209477ebd74b88373af7b6edc2b0a29cb75`
- `supabase/revenire/20261003e_sec_trezorerie_ROLLBACK.sql`: `5732c8c9f2a8ef6b870c56f9b35d0cd3151b2e5084f734aec146c730cd66c22a` (neschimbat)

## 5. Decizii deschise pentru Răzvan (neschimbate față de r1)

1. **Varianta de acces:**
   - A: citire și scriere doar pentru owner + `can_access_financiar`;
   - B și C: descrise în `docs/SECURITATE_PATCH_TREZORERIE.md`.

   **Recomandare: A**, cu regresie zero, pentru că niciun ecran nu folosește tabelele.
2. **Cine primește `can_access_financiar`:** azi n-are nimeni. E drept de acces, deci cere acordul explicit al lui Răzvan.
   - A: nimeni, doar owner;
   - B: o persoană anume din contabilitate.

   **Recomandare: A** până apare un ecran care folosește tabelele.
3. **Rezidualul** (IBAN-urile prin `garantii` și RPC-ul `garantii_adresa_eliberare`, fără poartă): patch separat, da sau nu.
   - Atenție: azi a intrat #560 (Garanții, drept `financiar.garantii`), iar în lucru e un patch RLS pe `garantii`. Rezidualul trebuie reevaluat față de acela, nu duplicat.
4. **Nou: MAINTAIN rămas după F1** pe tabelele din public, pentru anon și authenticated.
   - A: patch F1b separat (`REVOKE MAINTAIN` + default privileges);
   - B: risc acceptat, pentru că nu e exploatabil prin PostgREST.

   **Recomandare: A**, cu prioritate mică.

## 6. Cerere către Copilot
Review pe diff-ul r2, mai ales pe ramura `[pre:maintain]` dependentă de versiune. Cerem GO sau NO-GO pe „gata de aplicare”. Aplicarea cere și acordul lui Răzvan pe variantă.

---
## r2b (01.10, după deciziile lui Răzvan și merge-ul cu #532/#542/#543)

**Decizii luate**
- **Varianta A:** citire și scriere doar pentru owner + `can_access_financiar`. Migrarea o implementează deja: ambii helperi verifică `is_owner IS TRUE OR can_access_financiar IS TRUE`. N-am schimbat codul.
- **`can_access_financiar`:** nimeni nu-l primește; rămâne doar owner-ul. Nu e nevoie de DML.

**Reverificare pe live după #532/#542/#543** (doar SELECT):
- Politicile `trez_*_rw`, triggerele F2, politicile de scriere pe `profiles` și TRUNCATE-ul retras sunt identice cu r2.
- Precondițiile r2 rămân valabile.

**Fix în harness:** aceeași problemă ca la #540, cu `grep -q` sub `pipefail`. Aici chiar s-a manifestat: după merge, rularea pica cu „static: g_commit neprins”. Acum se folosește `grep >/dev/null`.

**Rezultate:**
- harness PG16: PASS (860 de verificări, 26 de mutanți prinși);
- build OK.

Migrarea și revenirea sunt neschimbate (sha256 ca la §4).

**Încă deschise:** rezidualul prin `garantii` / RPC (decizia 3) și MAINTAIN după F1 (decizia 4).
