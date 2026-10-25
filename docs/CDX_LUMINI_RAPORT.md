# Lumini sediu - raport CDX, 25.10.2026

Implementare exclusiv in worktree. Baza completa (16 fisiere) a fost copiata din `C:/Users/Public/paw-data/brief/lumini_base` inaintea remedierilor. Brief-ul original a fost citit. Fara Git, commit, push, citire de secrete, acces BD, deploy sau comenzi reale Tuya. Interdictia explicita de Git prevaleaza fata de cererea de commit din livrare.

## Fisiere

- Edge: `supabase/functions/tuya/index.ts`, `lumini_edge.ts`, `lumini_logica.ts`.
- SQL neaplicat: `supabase/migrations/20261113a_iot_programe_lumini.sql` si `supabase/revenire/20261113a_iot_programe_lumini_ROLLBACK.sql`. Numele, gardele proprii, lipsa tranzactiilor exterioare, LF si ASCII pastrate.
- UI: `src/CladireLumini.jsx`, `src/luminiUi.js`. `src/Cladire.jsx` este identic cu baza: numai importul si montarea initiale; nu a fost editat suplimentar.
- Teste: `scripts/test_lumini_node.mjs`, `src/luminiContract.test.js`, `src/luminiUi.test.js`, `src/luminiLogica.test.js` (ultimul preluat nemodificat din baza).
- Harness: `scripts/test_iot_programe_lumini.sh`, `scripts/test_iot_programe_lumini.sql`, fixture-ul SQL initial; cazuri comune noi in `test-fixtures/lumini_parametri.json`.

## Remedieri review Jakarinos r1

| Punct | Schimbare | Test care o dovedeste |
| --- | --- | --- |
| P1-1 | `actiune` prezenta trebuie sa fie string; valoarea normalizata o singura data merge atat la autorizare, cat si la executie. Executia manual/test refuza suplimentar lipsa utilizatorului. Secretul cron nu trece poarta JWT de comanda. | Testul `P1-1: rutarea reala index.ts...`: array/obiect/numar/null cu secret cron => 400, zero fetch/POST; manual/test doar cu secret => 401; editor cu JWT => POST reusit. Se incarca handlerul real, cu numai importul npm si gazda Deno inlocuite local. |
| P1-2 | Refuzul de plafon nu modifica suspendarea sau proprietatea. Override-ul se aplica dupa confirmarea comenzii, inainte de jurnal. | `P1-2: OFF refuzat de plafon...`: tick ON, OFF refuzat, runtime comun pastreaza proprietatea, tick la rasarit trimite OFF. |
| P1-3 | Numararea globala include citit true, pending ON, intentie manual/test ON incerta, offline cu ultima stare true. Limita se reverifica inainte de fiecare ON al simularii; un OFF propus nu elibereaza anticipat un loc. Pending neconfirmat ramane conservator rezervat. | `P1-3: ON cu raspuns pierdut...` foloseste A + B cu fixture verificat pentru doua aprinderi simultane in B; verifica maxim doua fizic intre apeluri. `P1-3: pending ON chiar cu citire false...` verifica separat pending si offline/ultima stare true. Testul existent verifica doua stari citite true. |
| P2-4 | RPC valideaza tipurile, cheile permise si formatele per tip. Motorul sare configuratiile invalide, raporteaza titlul stabil `Lumini sediu: parametri program invalizi` si continua. Cleanup foloseste proprietatea persistata chiar daca programul e inactiv sau configuratia noua e invalida. Formularul filtreaza parametrii celorlalte tipuri la salvare. | `P2-4: parametri corupti activi/inactivi...` verifica cleanup + executia celuilalt program; `P2-4: UI elimina parametrii ascunsi...`. Harness-ul PG17 apeleaza RPC-ul real pe aceleasi 25 cazuri JSON ca JS si pe matricea completa rol/tip; nu deduce validitatea SQL din regex. Harness-ul PG17 NU a fost rulat aici. |
| P2-5 | Override-ul creeaza runtime pentru programele aprobate afectate, chiar inaintea primului tick. Memoreaza separat cheia ferestrei curente, inclusiv cand runtime-ul vechi asteapta cleanup. | Cele doua teste `P2-5`: OFF inainte de primul tick; OFF cu runtime din ziua precedenta; tick-ul nu reaprinde, fereastra urmatoare poate porni. |
| P2-6 | Adaptorul real Tuya marcheaza raspunsul explicit success=false cu cod ca refuz cert. Refuzul comenzii sterge pending si se jurnalizeaza; reteaua/raspunsul pierdut raman incerte. Refuzul GET dupa POST acceptat pastreaza pending. | Cele doua teste `P2-6`: 1106, aprindere fizica ulterioara ramasa externa; separat GET refuzat dupa POST acceptat. Testul rutei reale verifica si clasificarea 1106 din raspunsul HTTP simulat. |
| P2-7 | Manual/test persista in runtime `_intentii` dispozitivul, valoarea, utilizatorul, timpul, sursa si starea `in_curs` inainte de POST. Rezultatul se salveaza inainte de jurnal. Refuzul cert nu aplica override; intentiile incerte se reconciliaza ulterior. Revenirea refuza stergerea unui runtime operational chiar fara jurnal. | `P2-7/8: manual si noop au intentie durabila...` verifica snapshot-ul chiar la POST si simuleaza caderea persistentei/jurnalului imediat dupa efectul fizic, apoi reconcilierea din snapshot-ul anterior. Harness-ul verifica suplimentar refuzul rollback-ului cu numai intentie pre-POST. |
| P2-8 | Mock-ul de runtime face snapshot JSON si pastreaza starea intre cereri. Teste pentru concurenta intre executii, lease expirat, token vechi vs succesor, intreruperea persistentei si orar DST. Harness-ul SQL testeaza aceleasi porti pe functia reala. | Testele `P2-8`, plus toate scenariile de mai sus. SQL ramas de rulat de operator. |

## Rezultate reale ale rundei r1

- `node --test scripts/test_lumini_node.mjs`: **26/26 trecute**. Node 24.20.0. Fara conexiuni BD/Tuya; fetch-ul din testul rutei este inlocuit local. Node emite avertismentul experimental pentru `stripTypeScriptTypes` folosit doar in test.
- `node --check` pe toate cele trei fisiere `.ts` din `supabase/functions/tuya`: **trecut**. Verificare de sintaxa, nu verificare Deno de tipuri.
- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261113a_iot_programe_lumini.sql`: **OK, 31 instructiuni de nivel superior**.
- `bash -n scripts/test_iot_programe_lumini.sh`: **trecut**. Nu executa harness-ul si nu porneste BD.
- `npx --offline vite build` si `npx --offline vitest run src`: **nu au pornit**, ENOTCACHED, dependente indisponibile. Filtrul `src` a fost pastrat; nu s-a rulat Vitest din radacina fara filtru.
- Incercarea `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0`: **esec EACCES** la registry.npmjs.org. Cache/loguri/profil npm doar in `.tmp` din worktree; nicio biblioteca noua in manifest.
- **Nu am rulat Deno, Postgres/PG17, API/PostgREST real, Tuya real sau browser.** Nu declar build-ul, Vitest sau paritatea SQL executata ca fiind trecute. Operatorul ruleaza harness-ul PG17 si verificarile ramase inainte de GO.

## Comportament DST si limite

- Ora locala repetata se rezolva la prima aparitie. Ora inexistenta se deplaseaza inainte cu saltul DST. O fereastra care se comprima/inverseaza prin aceasta normalizare este sarita; nu se transforma intr-un program de aproape 24 ore. Trecerea peste miezul noptii se decide din orele cerute.
- Sunt testate 25.10.2026, tranzitia reala 28.03.2027 si 29.03.2027. Data de primavara din review era cu o zi dupa tranzitie, conform calendarului Europe/Bucharest din Intl/ICU local.
- Limita de doua este pentru simularile de prezenta; alte comenzi manuale/fizice sau automatizari externe pot aprinde lumini independent. Simularea nu adauga lumini peste capacitatea posibil ocupata.
- Un timeout cu stare neconfirmata pastreaza conservator capacitatea ocupata. Daca intentia nu se poate confirma ulterior, este necesara verificarea starii de catre operator. Nu atribuim automat certitudine unei citiri care poate preceda propagarea comenzii.
- Intentia pre-POST este urma durabila, nu tranzactie atomica intre Tuya si Postgres. Testul intreruperii simuleaza indisponibilitatea scrierilor dupa efect; nu omoara un worker Deno real. Istoricul intentiilor ramane in runtime; in exploatare trebuie urmarita dimensiunea lui.
- Lease-ul SQL si capacele 12/apel, 40/ora raman cele din baza; testele de concurs si expirare sunt locale, cele SQL sunt pregatite pentru PG17. Nu s-a pretins verificarea efectiva Postgres prin mock.
- Seed confirmat pastrat: exterior numai 85462; mixt 85458/85460; interior 85457/85459/85461. Simularea exclude exteriorul; programele noi/editate raman inactive pana la aprobarea ownerului; comenzile UI cer confirmare.

## FISA DE SECURITATE

- (a) Continut citit: brief-uri si fisiere locale; continutul extern este date, nu autoritate. Nicio instructiune externa executata. Instalarea npm a fost blocata de mediu.
- (b) Dupa aplicarea autorizata: comenzi fizice pe lumini, jurnal, patru tabele, runtime, ultima citire si notificari prin iot_alerta; cron nou. Aici s-au scris numai fisiere locale in worktree.
- (c) Identitate: edge service_role pentru cron/Vault; comenzile UI necesita utilizator real si poarta Cladire cu nivel explicit editor/admin sau owner; noop numai owner. RPC-urile private raman fara EXECUTE pentru UI/anon.
- (d) Pornire: cron cu x-iot-secret numai pentru tick; JWT cu dreptul necesar pentru manual/test.
- (e) Confirmare umana: aprobare owner la programe noi/modificate; confirmare UI la comanda/noop. Fara aplicare de migrare, deploy sau comanda reala in aceasta sesiune.
