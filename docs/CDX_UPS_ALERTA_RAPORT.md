# UPS server AI - raport CDX

Implementare locala, 25.10.2026. Fara Git, credente, conexiuni BD sau deploy.

## Fisiere si comportament

- `supabase/functions/iot-retea/valideaza.ts`, `index.ts`, `valideaza_test.ts`:
  whitelist UPS, procent 0..100, boolean strict, runtime 0..10000 sau null.
  Cheile absente sunt omise inclusiv la scriere; false, zero si null se pastreaza.
  Testele includ limite, tipuri gresite, NaN/Infinity si chei necunoscute.
- `worker/retea-mon/sonda.sh`, `README.md`: transmite UPS din metrics.json prin
  jq deja folosit pentru AI. Fara dependente noi; suporta JSON cu spatii,
  pastreaza boolean/null, omite valori invalide. Colectorul extern nu a fost atins.
- `supabase/migrations/20261112a_iot_ups_alerte.sql`: trei alerte cumulative
  numai pentru boolean true, cu praguri strict sub 50 si sub 25. Runtime optional.
  Fara chei UPS sau pe retea, nu adauga alerte. Regulile vechi, inclusiv offline,
  tacere si asteptat_online, raman identice la nivel de corp.
- `supabase/revenire/20261112a_iot_ups_alerte_ROLLBACK.sql`: restaureaza exact
  corpul anterior, cu garda proprie. Ambele verifica MD5, atribute si ACL.
  READ COMMITTED, lock comun, fara control de tranzactie la nivel superior.
  Fisiere noi ASCII/LF: placeholder-ele Unicode din dollar-quote se reconstruiesc
  prin chr() pentru a pastra exact diacriticele si comentariile corpului vechi.
  MD5 vechi: d6e0db3c7c2f6b49497b267e1bf06ac5.
  MD5 nou: 6b82a10d73fe3480dfcdc480719f0555.
  Versiune runner propusa: 20261112120000.
- `src/Cladire.jsx`, `src/cladireRetea.test.js`: linie UPS numai pe server cu
  procent numeric. Model din meta.ups.model, implicit UPS; runtime optional.
  Pe retea verde; pe baterie galben, sub 50 rosu. Stare absenta = necunoscuta,
  culoare neutra. Exporta UPS_PRAGURI, nivelUps, textUps; teste si paritate SQL.
- `scripts/test_iot_ups_alerte.sh`, `.mjs`, `supabase/tests/iot_ups_alerte.sql`:
  harness PG17 izolat cu owner postgres NOSUPERUSER, runner oficial si functia
  iot_alerta reala preluata din migrarea existenta, cu dedup 12 ore.
  Verifica pe retea, 80/50/40/25/20/0%, dedup, campuri absente/invalide,
  regresie alerte vechi fata de baseline, offline/tacere, garda si rollback MD5.
  Creeaza fisiere doar in worktree, opreste clusterul si pastreaza logurile.

## Verificari cu output real

- `node scripts/test_iot_ups_alerte.mjs`: PASS offline - corp vechi identic,
  rollback exact, MD5, ASCII/LF, praguri SQL/UI si functii pure UI.
- Acelasi script: PASS pentru 32 teste de validare rulate prin adaptor Node 24
  (stripTypeScriptTypes + assert). Acesta NU este un test executat cu Deno.
- Validator oficial: `OK 1 instructiuni de nivel superior` pentru migrare.
- `sh -n worker/retea-mon/sonda.sh` si `bash -n scripts/test_iot_ups_alerte.sh`:
  cod 0. Executia sondei/jq pe Terra nu a fost verificata aici.
- `npm install`: esuat, EACCES la registry.npmjs.org (retea restrictionata).
  package.json si package-lock.json nu au fost modificate.
  Cache-ul local .npm-cache si instalarea partiala node_modules au ramas in
  worktree: politica automata a respins comanda de curatare recursiva.
- `npx --offline vite build` si `npx --offline vitest run`: esuate ENOTCACHED;
  dependentele nu sunt disponibile. Build-ul si suita Vitest NU sunt validate.
- Harness SQL: oprit cu cod 2, `ENV: PostgreSQL 17 unavailable`.
  NU am rulat SQL, Deno, API real sau livrare. Razvan/Claude ruleaza separat:
  `bash scripts/test_iot_ups_alerte.sh`,
  `deno test -A --node-modules-dir=none supabase/functions/iot-retea`,
  `npx vite build`, `npx vitest run` dupa instalarea dependentelor.

## Riscuri si limite

- Sonda la 10 min plus cron la 10 min poate intarzia alerta pana aproape de
  20 min. O descarcare rapida poate sari praguri intre citiri; nu este protectie
  de oprire si nu comanda Windows. Configurarea opririi la 20% nu e verificata.
- Un metrics.json vechi, servit in continuare, poate produce citiri aparent
  proaspete: citit_la reflecta ingestia. Nu exista timestamp UPS verificat in
  acest protocol. Detectia tacerii dispozitivului ramane cea existenta.
- Dedup existent pe tip/titlu timp de 12 ore: o noua cadere in aceeasi fereastra
  poate fi suprimata. Titlurile globale presupun UPS-ul unic al serverului AI.
- Migrarea refuza alta versiune a corpului/ACL; testele PostgreSQL si runnerul
  trebuie executate inaintea livrarii. Nicio migrare existenta nu a fost editata.
- Modelul UPS apare numai daca operatorul are meta.ups.model; fara el apare UPS.

## Fisa de securitate

(a) Continut extern: nu; sunt metrici tehnice, tratate ca date.
(b) Scrie: trei chei numerice/boolean/null in iot_citiri si ultima_citire din
    iot_dispozitive prin fluxul existent; alertele intra in notifications.
(c) Identitate: edge cu service_role ca iot-retea existent; autentificare neschimbata.
(d) Cine o porneste: sonda Terra / pg_cron.
(e) Confirmare umana: nu e nevoie pentru emiterea alertelor, doar alerta.
    Aplicarea migrarii si deploy-ul raman operatiuni separate ale operatorului.
