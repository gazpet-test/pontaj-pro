# Corecții locale Ofertare — regresii #776–#778

- `ofertare-triere/validare.ts`: acceptă null explicit la cumul, rol canonic, exclude_transport și surse; detaliile lucrării acceptă scalari finiți. Cheile lipsă, rolul canonic gol și tipurile incompatibile rămân respinse. Handlerul normalizează cumul null la false.
- `ofertare-raspuns-set/validare.ts`: inventarul acceptă nr numeric finit; validator nou pentru structura completă a comparației, cu liste goale permise.
- `ofertare-raspuns-set/index.ts`: comparația verifică HTTP, max_tokens, refuz, text și structură înaintea persistării rezultatului sau marcării dispozițiilor. Normalizarea operațiilor vechi rămâne în memorie până la validarea AI; runda fără dispoziții de comparat persistă în continuare reverificarea existentelor.
- `ofertare-triere/index.ts` și inventarul din `ofertare-raspuns-set/index.ts`: logarea consumului, când există usage, precedă toate ieșirile de validare, fără dublare la succes.
- `ofertare-clauze-formulare/index.ts`: orice element invalid respinge întregul set înainte de delete/insert, inclusiv un element invalid după primele 60. Validarea precedă deduplicarea și plafonarea.
- `ofertare-organigrama-spec/core.ts`: permite roluri_cerute gol; rolurile existente invalide rămân respinse.
- `ofertare-rfq-import/validare.ts` și `index.ts`: permite toate prețurile explicit null; convertește stringuri numerice finite, nenegative, prin Number(). Respinge materiale omise, necunoscute, duplicate, chei lipsă, prețuri negative, stringuri goale și tipuri incompatibile.

## Verificare efectuată

Teste `*_test.ts` actualizate/adăugate lângă fiecare funcție. Sunt incluse cazuri acceptate și respinse, executarea gardurilor reale din handlere, logarea usage la eșec, max_tokens cu JSON valid, normalizarea amânată și zero delete/insert pentru clauze mixte valide/invalide.

Comandă locală, fără instalări sau rețea:

```powershell
& 'C:/Program Files/nodejs/node.exe' --disable-warning=ExperimentalWarning .tmp/run-ofertare-tests.mjs
```

Rezultat: **67 teste trecute, 0 eșuate**, toate testele existente din cele cinci directoare incluse. Harnessul folosește Node 24.20.0, node:test și un adaptor minimal pentru Deno.test / Deno.readTextFile. Verificare suplimentară de sintaxă pentru cele 13 fișiere TypeScript modificate, cu stripTypeScriptTypes + node --check: trecută.

## Limite

Deno nu este disponibil în mediul local: nu am executat deno test / deno check și nu pretind verificare de tipuri sau compatibilitate nativă Deno. Nu am accesat rețeaua, Git, credențiale, baze de date ori deploy. Modelele, prompturile și semnăturile RPC nu au fost modificate. Toate scrierile sunt în worktree; operațiile BD din teste sunt simulate în memorie.
