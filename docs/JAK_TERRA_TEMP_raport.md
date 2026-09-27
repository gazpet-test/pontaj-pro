# JAK_TERRA_TEMP — raport (28.09.2026)

Implementat local conform specificației. Fără git, acces la producție, aplicare de migrare,
deploy sau citire/generare de secrete reale.

## Schimbări

- `supabase/migrations/20260927b_iot_terra_temperaturi.sql`: dispozitivul fix Terra,
  inserare idempotentă; verificator cu praguri stricte `>` și titluri stabile distincte
  per prag, tăcere >30 minute, citire goală, privilegii restrânse. Tăcerea are prioritate
  față de temperaturile istorice. Lipsa oricărei citiri produce alerta de tăcere.
- Rollback alăturat: verificator no-op, fără ștergerea dispozitivului/istoricului.
- `supabase/functions/iot-terra/`: endpoint exclusiv POST + `x-terra-secret`, digest-uri
  SHA-256 comparate prin `timingSafeEqual`, validare pură, maxime calculate server-side,
  UPDATE cu filtre fixe și INSERT istoric. Erorile întorc JSON, fără throw de business.
- `.github/workflows/deploy-edge-function.yml`: `iot-terra` adăugat în `NO_JWT`.
- `worker/terra-temp/trimite.sh` și `README.md`: colectare sysfs/SMART, secret în fișier
  600, header temporar protejat, curl cu timeout 20 s și fără retry/redirect, log rotit;
  instalare și dezinstalare documentate. Configurația implicită curl este dezactivată.
- `src/Cladire.jsx`: card lângă centrală, fiecare disc, praguri centralizate, citiri vechi
  roșii, actualizare la minut, grafice ambient/disc_max prin componenta Spark reutilizată.
  Valorile lipsă nu sunt transformate în zero. Erorile de încărcare sunt vizibile.
- Teste: `valideaza_test.ts`, `index_test.ts`, `src/terraTemperaturi.test.jsx`.

## Interpretări explicite

- Intervalul [-20, 120] se aplică temperaturilor. `uptime_s` este finit și nenegativ,
  inclusiv peste 120 secunde; scriptul trimite secunde întregi.
- `{}` este acceptat pentru a putea alerta „citire goală”. Câmpurile de temperatură
  omise se normalizează la null în DB. `null` explicit în payload este respins de
  validarea strictă; sunt respinse și cheile suplimentare în obiectele discurilor.
- Două intrări pentru același disc sunt respinse. Mai multe zone termice de același
  tip sunt reduse la maxim în script.
- Scrierile snapshot/istoric sunt două operații, conform tiparului cerut. Dacă inserarea
  istoricului eșuează după UPDATE, răspunsul 500 explică salvarea parțială. Nu sunt atomice.

## Verificări efectuate

- **19 teste trecute prin harness alternativ Node 24**: cele 7 teste Deno ale validatorului,
  cele 4 teste ale endpointului și cele 8 teste UI/paritate SQL. Testele Deno au fost
  înregistrate prin `node:test`; pentru UI au fost folosite matcherele Chai/Vitest și
  randarea React pe server, cu modulele Supabase/Meteo simulate.
- Endpoint: metode respinse, JWT fără secret, secret greșit, JSON invalid, cheie suplimentară,
  filtre fixe, maxime calculate, aceeași citire/oră în istoric, dispozitiv absent, erori
  Vault/UPDATE/INSERT. `fetch` și mediul au fost simulate; fără cereri de rețea.
  Harness-ul Node a folosit clientul Supabase instalat local.
- UI: praguri exacte și depășite, null/zero, paritate cu constantele din migrare,
  limita de 30 min, fiecare disc, culori, două grafice și erori de încărcare.
- `deno check --node-modules-dir=none supabase/functions/iot-terra/valideaza_test.ts`:
  **trecut**.
- Compilare JSX direct cu executabilul esbuild local pentru `Cladire.jsx` și testul său:
  **trecut**. Fișierele temporare ale harness-ului au fost eliminate.

## Ce nu a putut fi verificat aici

- `deno test -A --node-modules-dir=none supabase/functions/iot-terra`: runner-ul Deno
  2.9.7 se oprește cu panic Windows named-pipe (eroare 5/invalid handle).
- `npx vitest run src/terraTemperaturi.test.jsx` și `npm run build`: blocate la pornire
  de `spawn EPERM` pentru esbuild. Nici varianta programatică Vitest fără config nu
  pornește: Vite întâmpină `spawn EPERM` la rezolvarea căilor Windows.
- `deno check .../index.ts`: nu poate descărca `npm:@supabase/supabase-js@2`, rețea refuzată.
  Tiparea completă a endpointului și rularea cu versiunea Deno a clientului rămân de făcut.
- `sh -n worker/terra-temp/trimite.sh`: shell-ul disponibil se oprește înainte de parsare
  (`couldn't create signal pipe`, Win32 error 5). Scriptul nu a fost executat pe Terra.
- PostgreSQL real, semnătura completă `iot_alerta`, deduplicarea reală, RLS/PostgREST,
  API-ul real și interfața în browser: **neverificate**. Testul de paritate este static;
  nu reprezintă execuția SQL. Nu există psql local în PATH/la calea standard verificată.

## Obligatoriu înainte de aplicare — TODO-CLAUDE

Corpurile SQL `iot_cron_tick`, `iot_verifica_incalzire` și `iot_alerta` nu există în
repository (căutare inclusiv în `docs/`). Conform specificației, migrarea și rollback-ul
conțin locuri **TODO-CLAUDE** pentru corpul real al cron-ului. Nu am inventat corpul.

1. Copiază definiția actuală exactă a cron-ului în migrare și originalul în rollback.
   Adaugă numai apelul protejat `iot_verifica_terra`, lângă verificarea încălzirii,
   **înaintea** condiției de integrare cloud conectată.
2. Confirmă semnătura SQL `iot_alerta(p_type, p_title, p_message)` și tipurile parametrilor
   (numele sunt confirmate de apelurile RPC din `vicare/index.ts`), suportul pentru
   sursa `terra` și schema tabelelor. Nu am modificat alte funcții IoT.
3. Verifică pe PostgreSQL real scenariile warning → critic, deduplicare 12 h, null,
   citire goală, exact/peste 30 minute și rularea fără integrări cloud conectate.
4. Rulează harness-urile standard, build-ul, probele PostgREST și scriptul pe Terra.

**Migrarea nu conectează automat verificatorul la cron până la completarea TODO-CLAUDE.**
