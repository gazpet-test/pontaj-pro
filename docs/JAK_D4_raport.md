# JAK D4 — implementare locală, 27.09.2026

Implementate cele trei etape manuale, fără modificarea `worker/ofertare/plansa.ts`, fără
migrări, git, acces la producție sau apeluri Claude reale.

- `worker/ofertare/plansa_cli_pregateste.ts` + `plansa_cli_comun.ts`: poartă
  `CERUT_DE` UUID + `profiles.is_owner`, export JPEG/manifest cu SHA-256, prompturi
  importate direct din handler. Perechile sunt vecinătățile orizontale posibile:
  înainte de lectură nu știm care conțin note tăiate. Folderul de ieșire trebuie gol.
- `worker/claude-cli/prompts/plansa_felii.md`, `launcher.sh`, `run_pilot.sh`: Opus,
  numai Read/Glob/Grep, fără pre-extragere/OCR, ture dimensionate după felii/perechi,
  timeout păstrat. JSON-ul pentru import este extras din envelope-ul CLI; lipsa
  manifestului oprește launcherul cu cod 2 și motiv în jurnal.
- `worker/ofertare/plansa_cli_importa.ts`: validare înaintea primei scrieri — identitate,
  tăiere, prompturi, lista JPEG, SHA din rezultat/local/Storage. Handlerul primește
  imaginile deja verificate și un adaptor Messages fără rețea, cu tokeni zero și
  `API_KEY='cli-abonament'`; codul nu citește cheia AI reală. Rulările sunt seriale,
  inclusiv continuarea, reluarea erorilor și lipirea. Nu folosește coada/bugetul API.
- `supabase/functions/ofertare-plansa-citeste/handler.ts`: numai exportul celor două
  prompturi și câmpul opțional `Deps.modelEticheta`, folosit în `versiuneCur.model`
  și `citireAi.model`. Implicit rămâne modelul API existent; importul setează `cli:opus`.
- Instrucțiuni de operare: `worker/claude-cli/README.md`.

## Cazuri tratate

Citirea API pe aceeași tăiere este refuzată cu 409, fără resetare/amestec. Felia CLI
lipsă primește eroare 422, restul se persistă și eroarea poate fi reluată manual.
JPEG-uri identice nu permit substituirea unei zone lipsă cu răspunsul alteia.

Handlerul existent nu verifică versiunea pe ramura de lipire și marchează drept făcute
inclusiv unele lipiri fără răspuns valid. Fără alte modificări în handler, importatorul
blochează CAS peste o citire API apărută concurent, refuză JSON-ul de lipire invalid
înainte de scrieri și oprește lipirea dacă pachetul nu conține toate răspunsurile pentru
perechile manifestului. În ultimul caz, feliile deja importate rămân salvate; mesajul
cere completarea pachetului și reluarea manuală.

## Verificări efectuate și limite

- **22/22 scenarii D4 executate cu succes** (`worker/ofertare/plansa_cli_test.ts`):
  toate cerințele obligatorii, plus exportul prompturilor, hashurile locale/Storage,
  mai mult de patru felii, reluare, lipire, conflict CAS CLI/API, JPEG-uri identice.
- **240/240 teste existente executate cu succes** din
  `supabase/functions/ofertare-plansa-citeste`.
- `deno check` a trecut pentru ambele comenzi și testele D4.
- Sintaxa JS a testului de fum și a fragmentelor `node -e` din launcher a fost verificată.

**Deno este instalat (2.9.7), dar `deno test` standard NU a putut rula aici**: întâi
descărcarea dependențelor JSR/npm a eșuat, iar după rezolvarea offline runnerul s-a oprit
cu panică `deno_pipe`, eroare Windows 5. Cele 262 de funcții test de mai sus au fost
importate și executate serial cu un runner temporar prin `deno run`, folosind SDK-ul
Supabase local 2.105.3 și adaptoare `node:assert/strict` pentru aserțiunile JSR existente.
Acest rezultat nu include sanitizatoarele de resurse/operații ale runnerului standard.
Verificarea TypeScript a folosit aceeași rezolvare offline a dependențelor.

**Testul de fum nu a putut fi executat**: `node --test` a primit `spawn EPERM`, iar
apelul direct al shell-ului Git Bash a eșuat la crearea pipe-ului; WSL nu este instalat.
Fișierul `worker/claude-cli/test-fixtures/plansa_felii_test.mjs` conține testul obligatoriu
„manifest lipsă → cod 2 + jurnal” și scenariul cu CLI fals pentru Opus/ture/fără OCR/JSON.

De rulat de Claude în mediul său, înainte de utilizarea reală:

```sh
deno test -A --node-modules-dir=none worker/ofertare/plansa_cli_test.ts
deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste
node --test worker/claude-cli/test-fixtures/plansa_felii_test.mjs
```

Nu am verificat API-ul PostgREST/Storage real, containerul pe NAS sau citirea pe abonament.
Importul reutilizează efectele handlerului, inclusiv transferul în cantități și ciornele
locale de clarificare; acestea au fost simulate în teste, nu executate în producție.
