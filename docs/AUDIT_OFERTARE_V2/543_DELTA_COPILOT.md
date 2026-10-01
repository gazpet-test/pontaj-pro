# PR #543 — delta pentru Copilot (01.10.2026)

context_version: 2026-10-01 · commit 8e1084e · generated_at: 2026-10-01

## Ce s-a schimbat față de ultimul pack
1. Merge cu origin/main (fără rebase/force), fără conflicte.
2. **CI „verifica” — cauza:** PR-ul modifica `supabase/functions/ofertare-ingest-doc/index.ts` (import `_shared/egress.ts` + `descarcaCuJurnal`) fără deploy. `scripts/verifica-edge-functions.mjs` compară ultimul commit pe funcție cu deploy-ul live (toleranță 120 min) → „modificată în repo după ultimul deploy” → exit 1. `egress-usage-api` (nepublicată) era doar avertisment.
3. **Fix:** edge-ul e AMÂNAT, deci scos din PR: `ofertare-ingest-doc` revenit identic cu main; șterse `egress-usage-api` (cere `SUPABASE_MGMT_TOKEN`) și `_shared/egress.ts` (rămas nefolosit). Verificat local: pe un merge `--no-ff` în main (cum face GitHub), ultimul commit pe ingest-doc rămâne 50bc851 (25.09) → în toleranță.
4. Migrarea `20260930e_monitor_egress.sql`: doar comentarii (antet precondiții reverificate, „9 funcții” → „8 funcții” la p3). SQL executabil neschimbat.
   - sha256 vechi: `6cc42806fb0bed3cb6cd3311b18bfcc92c2b12e638a8e857fea7d230149c4c89`
   - sha256 nou: `3a41d9f8400c093ec124422f9d1ad3059214b7dcff8477e38a9a6caedd82fcc3`

## Precondiții live (read-only, dxczwkbciseqniprspcu, 01.10.2026)
| Gate | Rezultat |
|---|---|
| 0b tabele storage_egress_* | 0 ✅ |
| 0b funcții public.egress_* | 0 ✅ |
| 0c schema cron | prezentă ✅; joburi egress* = 0 ✅ |
| 0d coloane profiles/notifications | 8/8 ✅; auth.uid() există ✅ |
| 0e CHECK notifications.modul | `notifications_modul_check` conține `'general'` → 0 abateri ✅ |
| schema_migrations „egress” | nicio intrare (neaplicată) |
| alte | 2 owneri; trigger `trg_notificari_ruteaza_ofertare` rescrie modulul doar pt link_to `/ofertare%` (detectorul pune `/`) |

## Token / stare inertă
Migrarea nu cere tokenul Management. Fără edge cablat, singurul apelant al RPC-urilor de jurnal/poartă e workerul NAS (fail-open dacă RPC lipsește). Fără scrieri în jurnal, detectorul nu blochează și nu alertează nimic.

## Validare
vitest 1082/1082 ✅ · `npx vite build` ✅ · gărzile runnerului (start/final) și REVOKE pt authenticated neschimbate.

## Riscuri rămase
- Gate 0e e textual (LIKE pe definiția CHECK): trece și dacă `'general'` apare în alt context; acceptabil azi (un singur CHECK pe modul).
- Detectorul inserează `type='egress_alerta'` — nu există CHECK pe `type` azi; dacă apare, prima alertă pică (tranzacția cron, nu migrarea).
- Workerul NAS (`worker/ofertare/*`) rămâne cablat în PR: după deploy-ul workerului, jurnalizează doar descărcările NAS (nu și edge-ul) → statisticile sunt parțiale până la activarea edge-ului.
- Widgetul `MonitorEgress` afișează „indisponibil” până la aplicarea migrării (doar owner).
- Nimic aplicat pe live. Aplicarea: doar `scripts/livrare_migrare.sh`, cu acordul lui Răzvan.

## Cerere
GO/NO-GO pe migrare (sha nou de mai sus) + pe scoaterea edge-ului din PR.
