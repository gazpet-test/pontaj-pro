# Recitirea valului 1: ordinea pașilor

Procedura completă e în `docs/ofertare/RECITIRE_VAL1_PROCEDURA.md` (v5, GO de la Copilot + Jakarinos). Pașii de mai jos îi rulează **chat-ul**, pe serverul AI. **Fiecare pas marcat cu „da” cere „da”-ul lui Răzvan, dat în chat.**

## Regula de oprire

**La ORICE cod ≠ 0 după deschiderea ferestrei, primul pas e `fereastra.ts inchide <dir_val>/fereastra_N`.** Joburile nu rămân oprite cât se așteaptă o decizie. Reluarea se face cu o fereastră nouă, `fereastra_N+1`.

## Mediul

| Variabilă | Ce conține |
|---|---|
| `RV1_PG_URL` | conexiunea postgres (ca la psql) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | proiectul Supabase |
| `RV1_EMAIL`, `RV1_PAROLA` | contul `claudetest@` (admin Ofertare) |

Nimic din mediu nu se scrie în fișiere.

**TLS obligatoriu pe conexiunea postgres** (16.10, după prima încercare: deno-postgres fără CA trecuse tăcut pe necriptat):
- `fereastra.ts` se conectează DOAR criptat și verificat cu CA-ul Supabase din repo, `scripts/recitire_val1/supabase-prod-ca-2021.crt` (Supabase Root 2021 CA, public, sha256 `80:70:25:AD:…:CA:FA`). La orice eșec dă cod 2, fără să atingă ceva. `RV1_PG_CA` poate indica alt fișier PEM.
- Pentru **psql**, înaintea pașilor 0, 6, 7, 9, R: `PGSSLMODE=verify-full` și `PGSSLROOTCERT=<repo>\scripts\recitire_val1\supabase-prod-ca-2021.crt`. Un `RV1_PG_URL` cu `sslmode=disable / allow / prefer` e refuzat.

**Directoarele.**
- Directorul VALULUI (`<dir_val>` = `C:\Users\Public\livrare\recitire_val1`) e unul singur, pentru toată recitirea. Acolo stă `rulare.json`, registrul de cost, cu un singur T0 și plafonul de 1,00 USD pe tot valul. Registrul supraviețuiește ferestrelor.
- Un `rulare.json` ilizibil oprește pilotul (cod 3); nu se pornește alt registru.
- Fiecare fereastră are subdirectorul ei: `<dir_val>/fereastra_1`, `fereastra_2` …

## Pașii

| # | Pas | Comandă | Cod de reușită |
|---|---|---|---|
| 0 | Reverificare read-only (zero atașate) | `psql "$RV1_PG_URL" -X -1 -v ON_ERROR_STOP=1 -f scripts/recitire_val1/pas0.sql` | 0 |
| 1 | **„da” citire**. Fereastra: Răzvan decide momentul și anunțul. Chat-ul oprește worker-ul NAS, de pe serverul AI: `C:\PROGRA~1\Python313\python.exe C:\Users\Gazpet-Ai\Documents\terra_ssh.py '/Volume1/@apps/DockerEngine/dockerd/bin/docker stop gazpet-ofertare-worker'`. Directorul ferestrei îl creează scriptul. | `deno run -A scripts/recitire_val1/fereastra.ts deschide <dir_val>/fereastra_N` (se reia până dă 0; 5 = așteaptă / reia) | 0 = GATA |
| 2 | Citirea plătită (plafon dur 1,00 USD, rezervare 0,53 pe apel) | `deno run -A scripts/recitire_val1/citeste.ts <dir_val>` | 0 (3 = oprit → **inchide**) |
| 3 | Asamblarea și raportul (local, fără scrieri) | `deno run -A scripts/recitire_val1/asambleaza.ts <dir_val>` | 0 |
| 4 | Preview către Răzvan | `preview.md`; manifestul aprobat (vezi mai jos); commit; `sha256sum manifest_aprobat.csv` | — |
| 5 | **„da” preview**, care citează commit-ul + sha256-ul manifestului. Dacă întârzie → **inchide**, apoi fereastră nouă (`fereastra_N+1`) | — | — |
| 6 | Pasul 0 din nou, apoi aplicarea | `psql "$RV1_PG_URL" -X -1 -v ON_ERROR_STOP=1 -v manifest=<dir_val>/manifest_aprobat.csv -v texte=<dir_val>/texte.csv -v manifest_sha256=<sha> -v provizoriu=<dir_val>/aplicare_provizoriu.csv -f scripts/recitire_val1/aplica.sql` | 0 (altfel → **inchide**; nimic scris) |
| 7 | Verificarea după COMMIT (read-only) | `psql … -v provizoriu=<dir_val>/aplicare_provizoriu.csv -v rezultat=<dir_val>/aplicare_rezultat.csv -f scripts/recitire_val1/aplica_rezultat.sql`; commit `aplicare_rezultat.csv` | 0 |
| 8 | Închiderea ferestrei. Chat-ul pornește worker-ul NAS dacă era pornit: `… terra_ssh.py '/Volume1/@apps/DockerEngine/dockerd/bin/docker start gazpet-ofertare-worker'` | `deno run -A scripts/recitire_val1/fereastra.ts inchide <dir_val>/fereastra_N` (6 = pornește NAS și reia) | 0 |
| 9 | După 24h (read-only) | `psql … -v rezultat=<dir_val>/aplicare_rezultat.csv -f scripts/recitire_val1/verifica.sql` | 0 (altfel → la Răzvan) |
| R | Revenirea (**„da”**, în fereastră) | `psql … -v manifest=… -v manifest_sha256=… -v rezultat=<dir_val>/aplicare_rezultat.csv -v documente='212,213' -v provizoriu=<dir_val>/revenire_provizoriu.csv -f scripts/recitire_val1/revino.sql`, apoi `revino_rezultat.sql` | 0 |

## Manifestul aprobat

Sursa e `manifest_candidat.csv`, scris de `asambleaza.ts`. Conține doar documentele cu integritatea trecută.

- Un rând cu `calitate_ok = false` intră în aprobare numai cu `calitate_acceptata_nominal = true` și `motiv_acceptare` (≥ 10 caractere), la decizia nominală a lui Răzvan. Altfel rândul se scoate.
- Fișierul aprobat se scrie cu terminații LF și se comite.
- `texte.csv` poate rămâne cu toate textele: `aplica.sql` cere exact un text pentru fiecare document din manifest și le ignoră pe celelalte.
- `aplica.sql` verifică sha256-ul lui înainte de orice mutație.

## Testele

| Ce | Comandă |
|---|---|
| Deno | `deno test -A scripts/recitire_val1/` |
| PG16 | `wsl bash scripts/test_recitire_val1.sh --opreste` |
