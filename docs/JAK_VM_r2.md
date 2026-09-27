# JAK_VM_r2 — reparațiile după review-ul Copilot pe PR #498 (NO-GO)

Pleci de la 61766dc (branch `claude/verifica-manifest-in-proces`). Aceleași limite ca în `docs/JAK_verifica_manifest.md` și `AGENTS.md`.
Varianta B (în proces) rămâne; nu reveni la subprocess, nu atinge altceva. Fiecare reparație cu testul ei.

## 1. [MAJOR] Director de lucru fix `verif_<licId>` — două rulări simultane se șterg reciproc
`worker/ofertare/verifica_manifest_lib.ts` (L31, L74, L135): `tmp = ${LUCRU}/verif_${licId}` + `Deno.remove(tmp)` la început și la final.
**Reparație**: director unic per rulare `verif_<licId>_<crypto.randomUUID()>` (creat, folosit, șters doar de rularea care l-a creat)
PLUS lock exclusiv per licitație, în proces: `Deno.open(${LUCRU}/verif_<licId>.lock, {createNew:true})`; dacă există → a doua rulare
iese imediat cu rezultat/eroare clară „verificare deja în curs pentru <licId>”, fără să șteargă nimic. Lock-ul se șterge în `finally`.
Lock mai vechi de 2 h (mtime) = rămas de la un crash → se poate prelua (log explicit).
**Test**: două `verificaManifest` simultane pe același licId → una refuzată, directorul celeilalte intact, rezultatul ei corect.

## 2. [MAJOR] Download-ul din Storage nu e dovedit anulabil
L44: `supa.storage.from('ofertare').download(path, {}, { signal })` — al treilea argument e presupus; mock-ul îl acceptă, clientul real poate nu.
**Reparație**: nu te baza pe `download()`. Obține `createSignedUrl(path, 300)` și descarcă cu `fetch(url, { signal: semnal })`
(același tipar ca descărcarea SEAP). Eroare de semnare / HTTP ≠ 200 → eroare clară, ca azi.
**Test de integrare** (fără rețea externă): un `Deno.serve` local pe 127.0.0.1 care acceptă cererea și NU răspunde niciodată;
`createSignedUrl` din stub întoarce URL-ul lui; plafon 300 ms → `verificaManifest` revine cu eroare de abort în < 2 s, serverul închis la final.

## 3. Documentație
În comentariul din `seap.ts` / raport: AbortSignal nu omoară extractorul 7z — doar încetează așteptarea; oprirea lui o face timeout-ul hard propriu.

## La final
Actualizează `docs/JAK_verifica_manifest_raport.md` (secțiunea „r2”): ce ai schimbat, testele noi, ce n-ai putut rula.
Suita worker trebuie să rămână verde (129 + testele noi).
