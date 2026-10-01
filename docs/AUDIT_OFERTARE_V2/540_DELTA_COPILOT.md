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
