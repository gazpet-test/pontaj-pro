# JAK_VM — raport de implementare (27.09.2026)

Verificarea periodică SEAP ↔ Storage rulează acum în procesul workerului.

## Modificări

- `worker/ofertare/verifica_manifest_lib.ts`: funcția exportată `verificaManifest` și tipul `Raport`, cu exact cele 12 câmpuri JSON existente. Păstrează normalizarea, SHA-256, gruparea RAR, verificarea arhivelor, comparația Storage, rândurile de manifest și loturile de 200. Fără top-level await sau `Deno.exit`.
- `worker/ofertare/verifica_manifest.ts`: adaptor manual — aceleași argumente, JSON la stdout, erori la stderr.
- `worker/ofertare/seap.ts`: `verificarePeriodica` apelează funcția direct, cu `AbortController` și plafonul existent de 30 minute. Păstrează logul cu identice/diferite/lipsă; rapoartele cu erori sunt logate `EȘEC`.
- Semnalul ajunge la fetch SEAP, fluxul pe disc, Storage și cererile PostgREST. Așteptarea extractorului verifică semnalul la fiecare pas de maximum o secundă. Parametrii noi sunt opționali; apelurile importului SEAP rămân neschimbate.
- La expirare: nu începe alt document, returnează contoarele parțiale cu `erori: ['oprit la plafon']` (plus eventualele erori anterioare), curăță directoarele în `finally` și nu începe alte scrieri. Rândurile calculate înaintea expirării, dar încă nescrise, rămân numai în raport; nu se persistă după plafon.
- `worker/ofertare/verifica_manifest_test.ts`: 11 teste simulate, inclusiv protocolul extractorului pe fișiere și integrarea prin bucla periodică.

`entrypoint.sh` este nemodificat. Nu există pornire de `deno`/`docker` în verificare. Nu am rulat git, accesat producția sau creat migrări.

## Verificări executate

Runnerul standard `deno test` NU a putut executa testele: Deno 2.9.7 pe Windows cade cu `Unexpected client pipe failure` / `deno_pipe`, eroare Windows 5. Rularea întregului director este blocată și de descărcările JSR/esm.sh/npm indisponibile.

Am executat funcțiile originale de test serial, cu un adaptor temporar `deno run`, care respectă `ignore` și revocă permisiunea `run` pentru testele care o interzic. Acesta **nu înlocuiește runnerul standard și sanitizatoarele sale**.

| Suită | Trecute | Omise |
|---|---:|---:|
| `verifica_manifest_test.ts` | 11 | 0 |
| `plansa_test.ts` | 36 | 0 |
| `plansa_cli_test.ts` | 49 | 0 |
| `citire_mare_test.ts` | 27 | 2 |
| `ingest_mare_test.ts` | 2 | 2 |
| Total | **125** | **4** |

Nicio funcție executată nu a eșuat. Cele patru omise necesită Poppler sau `sleep` real.

Testele noi acoperă: 2 identice + 1 diferit + 1 lipsă, fiecare câmp/rând și SHA; mod uscat; anulare înaintea documentului 2; listare SEAP, descărcare, Storage și flux blocate; anulare în așteptarea listării/extragerii; arhivă cu junk; bucla periodică fără subprocess. Fiecare scenariu verifică și curățenia directorului temporar.

Testele noi au rulat fără mapare de dependențe, cu `--allow-net --allow-env`, read/write limitate la directorul proiectului (echivalentul Windows al `/app`), `--allow-run=git,pdftotext,pdfinfo` și suplimentar `--deny-run=deno,docker`. Cele două teste de permisiuni interzic toate subprocessurile. Nu am pornit git.

Pentru regresiile cu importuri externe am folosit exclusiv mapări temporare: Supabase local **2.105.3**, JSZip local, aserțiuni Node în loc de JSR. `word-extractor`, absent local, a fost înlocuit în adaptor cu o clasă care aruncă la utilizare; testele executate nu folosesc citirea `.doc` binară. Sursele acestor suite nu au fost modificate.

## Ce rămâne de verificat în mediul Claude

- `deno check` cu dependențele exacte: accesul la Supabase **2.116.0** pe esm.sh este blocat aici. Încercarea offline cu SDK 2.105.3 produce 78 erori în graful `ingest.ts`/`seap.ts` (tipuri Supabase `never` și incompatibilități Uint8Array cu TypeScript 6); nu declar verificarea de tipuri trecută.
- Runnerul Deno standard, sanitizatoarele și cele patru teste dependente de executabile Linux.
- Nu am rulat extractorul real sau verificări pe date reale. Nu am rulat Vitest/build: modificările sunt exclusiv în workerul Deno.

Comenzi pentru mediul Linux autorizat, din rădăcina repository-ului:

```sh
SEAP_TEST_ROOT=/tmp deno test --node-modules-dir=none --no-lock \
  --allow-net --allow-env \
  --allow-read=/app,/deno-dir,/tmp,/packs,/seap-work \
  --allow-write=/deno-dir,/tmp,/packs,/seap-work \
  --allow-run=git,pdftotext,pdfinfo worker/ofertare/verifica_manifest_test.ts
deno test -A --node-modules-dir=none --no-lock worker/ofertare/
```
