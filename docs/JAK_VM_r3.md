# JAK_VM_r3 — ultimele 2 puncte după runda 2 Copilot pe PR #498 (NO-GO)

Pleci de la df0000d. Copilot a închis: director unic, curățenia per rulare, fetch-ul obiectului anulabil. Nu le atinge.

## 1. [MAJOR] Preluarea lock-ului expirat e racy între procese (stat → remove → createNew)
Două procese (worker periodic + script manual) văd același lock „expirat”; A îl șterge și îl creează pe al lui, B șterge lock-ul NOU al lui A.
**Reparație**: renunță complet la „lock expirat” (mtime, 2 h, remove). Folosește lock de kernel: `Deno.open(lockPath, {create:true, write:true})`
+ `await f.tryLock(true)` (exclusiv, non-blocant; există în Deno 2.x — verifică). `false` → „verificare deja în curs pentru <licId>”, fără nimic șters.
Kernelul eliberează lock-ul la moartea procesului → nu mai există lock rămas de la crash. Fișierul `.lock` NU se șterge niciodată
(ștergerea lui ar reintroduce cursa); în `finally` doar `unlock()` + `close()`. Păstrează `Set`-ul în proces (flock pe același proces nu protejează fiabil).
**Test cu DOUĂ procese Deno distincte** (`new Deno.Command(Deno.execPath(), ['run', ..., helper.ts])`): procesul 1 ține lock-ul;
procesul 2 → refuzat; după ce 1 iese (inclusiv omorât cu kill) → 2 reușește. Dacă testul cere `--allow-run`, dă-l DOAR testului.

## 2. [MAJOR] `createSignedUrl()` nu e anulabil
**Reparație**: nu mai folosi `createSignedUrl`/`download`. Descarcă obiectul direct cu `fetch` controlat de noi:
`GET ${SUPABASE_URL}/storage/v1/object/authenticated/ofertare/<path encodat pe segmente>` cu headerele `Authorization: Bearer <cheie>` + `apikey`,
`{ signal: semnal }`. URL-ul și cheia vin ca parametri opționali în `verificaManifest(..., { storage: { url, cheie } })`, cu fallback pe env-ul
pe care workerul îl are deja (aceleași nume ca în seap.ts — verifică; nu introduce variabile noi, nu loga cheia).
**Test**: `Deno.serve` local care nu răspunde → revine în < 2 s cu „oprit la plafon”; plus un test 200 cu conținut identic → „identic”,
unul 404 → eroare „Storage indisponibil: HTTP 404”.

## La final
Raport în `docs/JAK_verifica_manifest_raport.md` (secțiunea „r3”). Suita worker verde (136 + noile).
