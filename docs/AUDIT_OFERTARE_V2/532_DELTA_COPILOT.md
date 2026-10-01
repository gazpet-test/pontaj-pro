# PR #532 (30a, S-A extins la 16 coloane): delta pentru Copilot, 01.10.2026

**Stare: NEAPLICAT pe live.** Delta față de pack-ul trimis la b8b61c4.

## Ce s-a schimbat
- Am făcut merge cu origin/main (commit `2968835`), fără rebase și fără force. Main conține tot ce s-a aplicat azi: F1, F2, #537, #552, #558 și J02b r6 (v20261001140000). Merge-ul n-a avut conflicte. Niciun fișier din PR n-a fost atins de main.
- **Migrarea 30a și ROLLBACK-ul ei: diff 0 linii.** Precondițiile verificate azi pe live corespund deja cu starea reală, așa că n-a fost nimic de actualizat.

## Diff-ul migrării față de pack-ul anterior
```
git diff b8b61c4 HEAD -- supabase/migrations/20260930a_profiles_campuri_owner_only_extins*.sql
(gol)
```

## sha256 (neschimbate)
| Fișier | sha256 |
|---|---|
| `20260930a_profiles_campuri_owner_only_extins.sql` | `67e46d36c3ee969a4483168be6e9f950c0002779b590df32eb033423d80c792e` |
| `…_extins_ROLLBACK.sql` | `7d71bfbaac2c00aa2afb6d4771383e338b539cd568d17f0485c0aee61c56cb5f` |

## Precondiții verificate pe live (doar SELECT, 01.10.2026, după J02b r6 și RSVTI p1b v20261001170000)
| Cod | Așteptat în migrare | Live | Rezultat |
|---|---|---|---|
| 0b | `md5(prosrc)` = `9acc36a4067eddbdf29956220023ea92` (F2 r4) | `9acc36a4067eddbdf29956220023ea92` | OK |
| 0c | `trg_profiles_campuri_owner_only` are tgenabled=O și cheamă `fn_profiles_campuri_owner_only()` | da | OK |
| 0d | există toate cele 16 coloane | 16/16 | OK |
| p3 | SECURITY DEFINER, `search_path=public, pg_temp`, fără EXECUTE pentru anon/authenticated | true / da / false, false | OK |
| regresie | niciun trigger de pe profiles nu menționează cele 14 coloane noi | 0 mențiuni în cele 4 funcții de trigger | gaura e confirmată |

Ultimele migrări înregistrate pe live: 20261001170000 (rsvti p1b), 20261001140000 (J02b r6), 20261001133000, 20261001130000 (#537), 20261001124500 (F2), 20261001123000 (F1), 20261001120000.

## Compatibilitate
- **J02b**: pe `ofertare_licitatii` sunt 4 triggere live: `a00_ofertare_licitatii_scriere`, `trg_gate_depunere`, `trg_ofertare_j02b_sens_unic` și `trg_ofertare_responsabil_setat_de`. Migrarea 30a atinge doar `public.fn_profiles_campuri_owner_only()`, adică un trigger BEFORE UPDATE pe `profiles`. Triggerele J02b doar citesc `profiles.is_owner`. Coloanele noi protejate nu apar în fluxul Ofertare, deci nu se suprapun.
- **Gate 0e**: `scripts/control_0e.sql` rulat azi pe live întoarce **0 rânduri**. Funcția 30a citește `request.jwt.*` cu `current_setting`, dar nu e expusă: postcondiția p3 cere EXECUTE revocat pentru anon/authenticated, deci rămâne în afara invariantului. Nu folosește `set_config`, `SET ROLE` sau `EXECUTE` dinamic. Singurul `set_config` e în runner (marcajul `gazpet.livrare_migrare`).
- **J05 (#542, branch `claude/erp-continuare-x4p5a7-j05-garda`)**: diff-ul J05 nu modifică nicio funcție sau trigger de pe `profiles`, doar citește `profiles.is_owner`. **30a nu depinde de J05 și nici invers.** Ordinea dintre ele nu contează. Dacă J05 se aplică primul, precondiția 0b rămâne valabilă. Dacă totuși cineva schimbă funcția, 0b oprește livrarea (fail-closed).

## Versiunea propusă pentru runner
`--versiune 20261001190000` (după 20261001170000 și cu loc liber pentru J05 la 1800xx). Comanda:
```
scripts/livrare_migrare.sh --migrare supabase/migrations/20260930a_profiles_campuri_owner_only_extins.sql \
  --sha256 67e46d36c3ee969a4483168be6e9f950c0002779b590df32eb033423d80c792e --versiune 20261001190000 …
```
Dacă J05 primește o versiune mai mare, 30a urcă după ea. Doar ordinea numerică a versiunilor trebuie să fie strict crescătoare.

## Teste (după merge)
- PG17 local (harness `scripts/test_conturi_ciclu_viata.sh`, lanțul 29g → 30j F2 → 30a, cu `--reaplica --rollback`): **PASS, 199 aserțiuni**. Fiecare trecere completă are 65 de aserțiuni. După rollback se rulează doar baza (4 aserțiuni), iar gaura se reproduce. Schema de după rollback e identică cu cea dinainte.
- vitest: 43 de fișiere și 1082 de teste, toate trecute.
- `npx vite build`: OK.

## Riscuri
1. **Fluxuri legitime care se vor bloca** (42501): orice cod care nu e owner și schimbă `email` sau cele 13 flaguri, inclusiv prin RPC rulat ca authenticated sau prin funcțiile R2 din pachetul conturi care „golesc claims”. Mitigare: schimbarea o face owner-ul sau service_role. Detalii în `docs/SECURITATE_SA_PROFILES.md`.
2. Edge functions care actualizează `email` cu service_role trec doar dacă rulează prin PostgREST (`session_user=authenticator` și `role=service_role`). O conexiune directă cu alt login primește 42501, ceea ce e fail-closed.
3. Drift: dacă J05 sau alt PR modifică `fn_profiles_campuri_owner_only` înainte de 30a, livrarea se oprește la 0b și trebuie rebazată. Nu poate suprascrie nimic.
4. Atinge drepturi de acces, deci cere **acordul explicit al lui Răzvan** pe lângă GO-ul Copilot.
