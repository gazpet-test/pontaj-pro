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

## r2 — reparații după review-ul Copilot pe PR #495

Implementate cele cinci puncte din `JAK_D4_r2.md`, local, fără git, producție, migrări
sau modificarea cozii API (`worker/ofertare/plansa.ts`). Secțiunea de mai sus descrie
r1; pentru proveniență, operator și poarta de lipire se aplică acum modificările r2.

- `plansa_cli_comun.ts`, `plansa_cli_pregateste.ts`, `plansa_cli_importa.ts`:
  manifestul are `pachet_id` SHA-256 peste serializarea explicită a documentului,
  tăierii, listei ordonate `{eticheta, sha256}`, perechilor și hashurilor ambelor
  instrucțiuni. Importul cere egalitatea rezultat = manifest = recalculare din
  documentul/Storage curent și handlerul curent, înainte de orice scriere.
  O lipire include `sha256_a`/`sha256_b`; adaptorul compară ambele hashuri, în ordine,
  cu imaginile cerute și întoarce 422 la nepotrivire. Importul refuză și perechile
  cu hashuri diferite de manifest înainte de a chema handlerul.
- `launcher.sh`, `prompts/plansa_felii.md`: launcherul îngheață proveniența înainte
  de CLI, include instrucțiunile în promptul efectiv și calculează hashul acelui
  argument. El adaugă în rezultat `pachet_id` din manifest, hashurile instrucțiunilor,
  `cli_version` din `claude --version` și modelul din `modelUsage` al envelope-ului CLI.
  Suprascrie metadatele eventual inventate de model. Jurnalul fără un singur model
  Opus identificabil este refuzat; aliasul solicitat `opus` nu ține loc de dovadă.
- `handler.ts`: testul nou a reprodus **200 în loc de 409** pentru API `doar_lipire`
  peste `cli:opus`. Garda minimală folosește `versiuneIncompatibila` la intrare,
  la rezervarea perechilor și la scrierea CAS. Verifică astfel și citirea apărută
  concurent. Regula existentă pentru `mixare_permisa` este păstrată.
- `OPERATOR_DECLARAT` înlocuiește `CERUT_DE` în scripturile D4 și în README.
  Mesajele și documentația spun explicit „verificare administrativă, nu autentificare”:
  scripturile sunt pentru NAS, rulate numai de owner; deținătorul `service_role`
  poate declara alt UUID. Jurnalul JSON al importului notează UUID-ul declarat,
  `pachet_id` și proveniența CLI. Nu s-a construit autentificare nouă.
- `run_pilot.sh`: `flock -n` pe `$D/.pilot.lock`, ținut inclusiv la curățare;
  rularea concurentă este refuzată imediat cu cod 3. Staging unic
  `$D/staging/<stamp>_<pid>`, creat exclusiv, curățat doar de propria rulare prin
  trap la ieșire. Copierea eșuată oprește rularea; alte staging-uri nu sunt șterse.

### Teste r2 și rezultate

`worker/ofertare/plansa_cli_test.ts`: **35/35 funcții de test trecute** (22 existente
și 13 noi). Noile cazuri acoperă exact lipirea veche A+B cu B individual absent și
hash B nou → 422; R1/P1 lângă manifest P2 cu JPEG-uri identice → zero scrieri;
manifest și rezultat vechi concordante, dar handler nou → zero scrieri; proveniență
lipsă/invalidă și SHA lipire greșit; sensul API peste CLI; schimbarea concurentă
la rezervarea/salvarea lipirii; UUID și `pachet_id` în jurnalul importului.

Cele **240/240 teste existente** din `supabase/functions/ofertare-plansa-citeste`
au trecut după adăugarea gărzilor. Aceste 275 de funcții de test au fost executate
serial printr-un runner temporar `deno run`, cu SDK Supabase local 2.105.3 și
adaptor `node:assert/strict` pentru importurile JSR. Nu includ sanitizatoarele
runnerului standard Deno.

`deno check` pentru pregătire, import și testele D4 a trecut cu maparea offline,
`--sloppy-imports` pentru SDK-ul local și `skipLibCheck` pentru declarațiile externe
ale SDK-ului. Codul aplicației a fost verificat TypeScript; declarațiile externe nu.

`worker/claude-cli/test-fixtures/plansa_felii_test.mjs`:

- **Trecut** testul Node al fragmentelor reale din launcher, executat fără subprocess
  (`node --test --test-isolation=none --test-name-pattern='proveniență launcher' ...`):
  hashul promptului efectiv, metadate independente de răspunsul modelului,
  refuzul promptului schimbat, modelului lipsă/greșit/ambiguu și lipirii vechi.
- Fixture-ul CLI fals existent verifică acum și proveniența completă, inclusiv
  hashul exact al argumentului `-p`.
- Adăugat testul de fum cu două lansări simultane, `flock` și staging reale,
  Docker simulat: a doua rulare → cod 3; conținutul primei rămâne intact;
  ieșirea primei cu eroare → numai staging-ul propriu este șters, un staging
  anterior rămâne. **Acest test nu a putut fi executat aici.**

### Ce rămâne de verificat în mediul Claude/NAS

Comanda standard `deno test` a eșuat la descărcarea dependențelor, iar cu maparea
offline s-a oprit prin panică `deno_pipe` / Windows error 5. `node --test` standard
a eșuat cu `spawn EPERM`; fără izolarea Node, cele trei teste care cer shell au
aceeași problemă. Nici `sh -n` nu a putut porni: „couldn't create signal pipe”.
Prin urmare, nici execuția completă a launcherului, nici lock-ul concurent nu sunt
declarate validate în acest mediu.

De rulat pe Linux/NAS, fără apeluri reale Claude sau producție:

```sh
deno test -A --node-modules-dir=none worker/ofertare/plansa_cli_test.ts
deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste
node --test worker/claude-cli/test-fixtures/plansa_felii_test.mjs
sh -n worker/claude-cli/launcher.sh
sh -n worker/claude-cli/run_pilot.sh
```

Nu am rulat PostgREST/Storage real, Docker/NAS sau Claude CLI autentic. Nu am rulat
vitest: schimbările sunt în workerul Deno, handler și scripturile shell, fără UI.
Pachetele r1 nu se importă prin r2: trebuie pregătite și citite din nou.

## r3 — bytes verificați și configurație CLI în compatibilitatea citirii

Implementate numai D4-01 și D4-02 din `JAK_D4_r3.md`, fără git, producție,
migrări sau modificarea cozii API/pilotului `run_pilot.sh`.

- `worker/claude-cli/launcher.sh`: înainte de orice apel CLI, inclusiv `--version`,
  compară lista exactă din `/data/felii` cu manifestul și calculează SHA-256 din
  fiecare JPEG. Refuză fișiere modificate, lipsă, în plus, directoare și legături
  simbolice, cu cod 2 și motiv în jurnal. Nu modifică manifestul. Scrie hashurile
  calculate în `felii_verificate`, inclusiv pentru feliile fără răspuns de la model.
- Launcherul scrie `config_cli = {model, prompt_sha256}` din `modelUsage` și hashul
  argumentului efectiv `-p` (promptul `plansa_felii.md` plus textul adăugat și cele
  două instrucțiuni). Suprascrie orice valori inventate de model.
- `plansa_cli_comun.ts` / `plansa_cli_importa.ts`: tipuri și validare pentru aceste
  câmpuri; hashuri verificate obligatorii și egale cu manifestul, configurație egală
  cu proveniența rulării. Importul transmite configurația prin `Deps.configCli`, o
  include în jurnal/rezultat și o verifică și în protecția suplimentară a CAS.
  **Calculul `pachet_id` nu s-a schimbat.**
- `handler.ts`: extensie opțională `Deps.configCli`; configurația intră în hashul
  compus `versiune.prompt_sha` și se păstrează în `citire_ai.versiune.config_cli`.
  Gărzile existente `versiuneIncompatibila` o disting la continuare, lipire și
  recitirea CAS. Eticheta generală rămâne `cli:opus`; modelul concret este în
  `config_cli.model`. Fără noul câmp, versiunea și comportamentul API rămân identice.
  Regula existentă pentru `mixare_permisa` nu a fost modificată; importul nu o cere.
- README actualizat. Rezultatele vechi fără metadatele r3 trebuie recitite prin
  launcher; o citire salvată fără configurație nu este continuată tacit de r3.

### Verificări r3

- **49/49 funcții de test D4 trecute**: cele 35 existente + 14 noi. R1 importat
  parțial → R2 cu același `pachet_id`, dar prompt V2 sau model B → HTTP 409, fără
  scrieri și fără modificarea citirii. Acoperite și refuzul direct la lipire,
  schimbarea concurentă a configurației la rezervarea/salvarea lipirii, precum și
  metadatele absente/inconsistente. Testele existente dovedesc reluarea cu aceeași
  configurație. Două fixture-uri r2 care simulează API au fost adaptate să elimine
  și hashul compus/configurația CLI, nu doar să schimbe eticheta modelului.
- **240/240 teste existente ale handlerului trecute, fără modificarea suitei.**
- `deno check` a trecut pentru pregătire, import și testele D4, cu SDK-ul local
  Supabase 2.105.3 și declarațiile sale TypeScript, prin mapare offline.
- **2/2 teste Node fără subprocess trecute**: fragmentele reale ale launcherului
  verifică bytes de pe disc (modificat/lipsă/în plus, inclusiv non-JPEG/director),
  păstrează manifestul și suprascriu metadatele inventate de model.

Cele 289 de funcții Deno au fost executate serial prin runnerul temporar `deno run`
din `.tmp_jak_d4/runner-r3.ts`, cu mapare offline și adaptor `node:assert/strict`
pentru JSR. **Nu sunt o rulare a runnerului standard și nu includ sanitizatoarele.**
`deno test` standard a eșuat la descărcarea npm; cu maparea offline verificarea de
tipuri a trecut, apoi runnerul a intrat în panică `deno_pipe`, Windows error 5.

Testele complete ale launcherului au fost adăugate pentru JPEG modificat/lipsă/în
plus: cod 2, motiv concret în jurnal, manifest intact, CLI fals neapelat (nici măcar
`--version`). **Nu au putut rula aici**: `node --test` → `spawn EPERM`; fără izolarea
Node, cele șase teste care cer shell au aceeași eroare. `sh -n launcher.sh` nu a
putut porni din cauza „couldn't create signal pipe”, Windows error 5.

De verificat pe Linux/NAS, fără CLI autentic și fără producție:

```sh
deno test -A --node-modules-dir=none worker/ofertare/plansa_cli_test.ts
deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste
node --test worker/claude-cli/test-fixtures/plansa_felii_test.mjs
sh -n worker/claude-cli/launcher.sh
```

Nu am rulat PostgREST/Storage real, Docker/NAS, Claude autentic sau vitest (fără
modificări UI). Nu am solicitat secrete și nu am modificat date reale.
