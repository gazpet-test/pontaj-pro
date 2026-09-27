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

## r2 — reparații după review-ul PR #498 (27.09.2026)

Implementat exclusiv în verificarea în proces:

- `verifica_manifest_lib.ts`: director propriu `verif_<licId>_<crypto.randomUUID()>`, creat după obținerea lock-ului și șters numai de proprietar. Nu mai șterge directorul comun la început. Lock exclusiv `verif_<licId>.lock` prin `Deno.open({ createNew: true, write: true })`; concurentul primește imediat `verificare deja în curs pentru <licId>`. Un set în proces protejează inclusiv preluarea lock-urilor expirate. Lock cu mtime mai vechi de 2 h: preluare cu log explicit. Fișierul de lock, descriptorul și protecția din proces se eliberează în `finally`, inclusiv la eroare/anulare; apelul refuzat nu șterge lock-ul altuia.
- Storage: `createSignedUrl(path, 300)`, apoi `fetch(signedUrl, { signal: semnal })` și citirea corpului răspunsului. Erorile de semnare și HTTP diferit de 200 apar explicit în raport; corpul răspunsului HTTP respins este închis.
- `seap.ts`: comentariu explicit — **AbortSignal oprește doar așteptarea, nu omoară 7z**. Oprirea extractorului o asigură timeout-ul hard propriu.
- `verifica_manifest_test.ts`: stub-ul Storage semnează URL-uri, iar simularea extractorului găsește directorul unic. Cele 11 teste existente sunt păstrate; s-au adăugat **7 teste**: concurență cu director/fișier/lock intacte și rezultat corect; lock recent păstrat; lock expirat preluat cu log; eliberare după eroare fără ștergerea directoarelor străine; eroare de semnare; eroare HTTP; integrare HTTP locală cu anulare.

Integrarea pornește `Deno.serve` pe `127.0.0.1`, port dinamic. Stub-ul `createSignedUrl` întoarce URL-ul local, iar cererea folosește **fetch-ul real**. Serverul acceptă cererea și nu răspunde în timpul verificării. Plafonul de 300 ms produce `erori: ['oprit la plafon']`, zero scrieri și revenire în sub 2 s. Testul verifică primirea cererii, curățenia fișierelor și revenirea înaintea închiderii serverului; serverul este închis în `finally`. Un watchdog face testul să eșueze fără să blocheze suita dacă anularea regresează.

### Verificări r2 executate și limite

Runnerul standard `deno test` pentru manifest cade în continuare pe Deno 2.9.7/Windows cu `Unexpected client pipe failure`, eroare 5. Încercarea standard a întregii suite este blocată la importurile externe JSR/esm.sh/npm. `deno check` este de asemenea blocat la descărcarea dependențelor esm.sh.

Funcțiile originale de test au fost executate serial printr-un adaptor temporar `deno run`, fără sanitizatoarele runnerului standard:

| Suită | Trecute | Eșuate | Omise |
|---|---:|---:|---:|
| `verifica_manifest_test.ts` | 18 | 0 | 0 |
| `plansa_test.ts` | 36 | 0 | 0 |
| `plansa_cli_test.ts` | 49 | 0 | 0 |
| `citire_mare_test.ts` | 27 | 1 | 1 |
| `ingest_mare_test.ts` | 2 | 0 | 2 |
| Total | **132** | **1** | **3** |

Eșecul este testul existent `ruleaza real: plafonul de timp oprește procesul cu semnal`: cu `-A`, verificarea permisiunii pentru `sleep` îl consideră disponibil, dar pornirea returnează `[-1, null]`, în locul rezultatului Linux `[143, 'SIGTERM']`. Cele trei omise necesită Poppler. Nu am modificat aceste teste sau codul aferent. **Nu declar suita standard „129 + 7 verde”**: aceasta trebuie executată în mediul Linux cu dependențele și executabilele reale.

Manifestul a rulat fără mapări de dependențe, cu read/write limitate la repository, `--allow-net --allow-env --allow-run=git,pdftotext,pdfinfo --deny-run=deno,docker`; testele de permisiuni revocă dreptul `run`. Regresiile au folosit mapări temporare către Supabase local **2.105.3**, JSZip **3.10.1**, aserțiuni Node și un substitut `word-extractor` care aruncă la utilizare; citirea `.doc` nu este testată. Adaptoarele temporare au fost eliminate după verificare.

Testul HTTP dovedește anularea transferului Storage; nu dovedește anularea cererii SDK `createSignedUrl`, care este apelată conform specificației și verifică semnalul după răspuns. Extractorul real și producția nu au fost accesate. Vitest/build nu au fost rulate, schimbarea fiind exclusiv în workerul Deno.

Checkout-ul disponibil indică ramura cerută, dar referința locală este `1b31a306bf28bf88cb2d9389b70b61b227b4e2ac`, nu `61766dc` din specificație (citire directă a metadatelor locale). Am lucrat pe fișierele existente, fără comenzi git sau schimbarea checkout-ului. Fără modificări în `entrypoint.sh`, migrări ori acces la producție.

## r3 — lock de kernel și descărcare Storage directă (27.09.2026)

- `verifica_manifest_lib.ts`: `Deno.open({ create: true, write: true })` + `await tryLock(true)`. Un rezultat `false` refuză imediat verificarea. Set-ul din proces este păstrat. Nu mai există expirare, preluare după mtime sau ștergere a fișierului `.lock`; în `finally` se face `unlock()` numai dacă lock-ul a fost obținut și întotdeauna `close()`. Directorul unic și curățenia per rulare sunt păstrate.
- Existența API-ului `tryLock(exclusive?: boolean): Promise<boolean>` a fost verificată în `deno types` pentru Deno 2.9.7 instalat; achiziția/eliberarea au fost exercitate local.
- Comparația Storage nu mai apelează SDK-ul `createSignedUrl`/`download`. Folosește direct `GET /storage/v1/object/authenticated/ofertare/<cale encodată pe segmente>`, cu `Authorization: Bearer` și `apikey`, iar fetch-ul și corpul răspunsului folosesc semnalul existent. Opțiunea `storage: { url, cheie }` suprascrie configurația; fallback: `SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY`, aceleași nume folosite de `main.ts` și adaptorul manual (`seap.ts` primește clientul, nu citește el aceste două variabile). Cheia nu este logată.
- `verifica_manifest_test.ts`: testele vechi de expirare/semnare sunt înlocuite cu verificările noii reguli. Rămân testele de concurență în proces, anulare și curățenie; fișierul permanent de lock trebuie să rămână, dar să fie deblocat. HTTP local real verifică plafonul de 300 ms cu revenire sub 2 s, 200 cu trei obiecte identice, 404 cu motivul exact `Storage indisponibil: HTTP 404`, autentificarea și căi cu spații, diacritice, `#`, `%`, `?`. Sunt testate atât opțiunea explicită, cât și fallback-ul env cu valori fictive.
- `verifica_manifest_lock_helper.ts` și două teste noi: procesul 1 ține lock-ul prin funcția reală, procesul 2 este refuzat; după ieșire normală sau `SIGKILL`, un proces nou îl obține. Fișierul de lock este intenționat mai vechi de 2 h, iar conținutul și mtime trebuie păstrate. Helperul folosește exclusiv date simulate și nu are permisiuni de rețea/subprocess. `--allow-run=deno` se acordă numai comenzii de test; permisiunile workerului și `entrypoint.sh` nu sunt modificate.

### Verificări r3 executate și limite

**Nu declar suita standard verde.** `deno test --no-check ... verifica_manifest_test.ts` se prăbușește în runner pe Windows (`Unexpected client pipe failure`, `deno_pipe`, eroarea 5). Comanda standard pentru întregul director și `deno check` sunt blocate la importurile JSR/esm.sh/npm, indisponibile din acest mediu.

Am executat funcțiile originale serial printr-un adaptor temporar `deno run`, fără sanitizatoarele runnerului standard. Cele două teste care interzic subprocessurile au rulat separat cu `--deny-run` efectiv.

| Suită | Trecute | Eșuate/blocate | Omise |
|---|---:|---:|---:|
| `verifica_manifest_test.ts` | 19 | 2 | 0 |
| `plansa_test.ts` | 36 | 0 | 0 |
| `plansa_cli_test.ts` | 49 | 0 | 0 |
| `citire_mare_test.ts` | 27 | 0 | 2 |
| `ingest_mare_test.ts` | 2 | 0 | 2 |
| Total | **133** | **2** | **4** |

Cele două blocate sunt exact testele cu procese Deno distincte: `Deno.Command(Deno.execPath()).spawn()` primește `PermissionDenied: Access is denied (os error 5)`, chiar cu dreptul Deno `--allow-run=deno`. Scenariile cu două procese și eliberarea la kill **rămân de executat pe Linux**. Cele patru omise necesită `sleep`/Poppler. Nu am schimbat testele existente de regresie. Sunt acum 21 teste de manifest (18 anterior) și 139 în director (136 anterior).

Manifestul a rulat fără mapări de dependențe. Pentru regresiile cu importuri externe: mapări temporare către Supabase local **2.105.3**, JSZip local **3.10.1**, aserțiuni Node în loc de JSR și un substitut `word-extractor` care aruncă la utilizare. Citirea `.doc` nu a fost exercitată. Adaptoarele temporare au fost eliminate după verificare. Nu am rulat Vitest/build, extractor real sau API-uri de producție.

Comenzi rămase pentru mediul Linux cu dependențele exacte:

```sh
SEAP_TEST_ROOT=/tmp deno test --node-modules-dir=none --no-lock \
  --allow-net --allow-env --allow-read --allow-write --allow-run=deno \
  worker/ofertare/verifica_manifest_test.ts
deno test -A --node-modules-dir=none --no-lock worker/ofertare/
deno check --node-modules-dir=none --no-lock worker/ofertare/verifica_manifest_lib.ts \
  worker/ofertare/verifica_manifest_test.ts worker/ofertare/verifica_manifest_lock_helper.ts
```

Referința locală citită direct este `995b3cdd540d8301e0d49d648ded8293f5cb8342`, nu `df0000d` din cerință. Am lucrat pe fișierele existente, fără git, schimbarea checkout-ului, migrări sau acces la producție.

Curățenia finală: fișierele adaptorului au fost eliminate. Ștergerea a 10 directoare temporare goale create de regresii a fost respinsă de verificarea automată de aprobare (`blocked by policy`); au rămas în rădăcina workspace-ului: `256cef7db3fda02b`, `28261066ff540189`, `2c6e6cb58f2fa2f7`, `5c202c16a52bfb99`, `9b6a8e9a205598a1`, `a2d33927f8a5328b`, `a87180d592c9b99b`, `a8db3fb86794606a`, `c18ab97e808f3d03`, `c18fb41fec823a4e`.
