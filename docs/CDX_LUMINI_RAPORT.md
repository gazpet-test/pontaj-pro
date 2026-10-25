# Lumini sediu - raport CDX, 25.10.2026

Baza actualizata: toate cele 17 fisiere din `C:/Users/Public/paw-data/brief/lumini_base` copiate in worktree inaintea modificarilor. Citite brief-ul original si runda 1. Fara Git/commit/push, credentiale, acces BD, deploy sau comenzi fizice. Interdictia explicita de commit prevaleaza fata de finalul brief-ului.

## Remedieri review Jakarinos r1

Remedierile din baza r1 au fost pastrate: actiune string unica la autorizare/executie; manual/test cer JWT cu drept; intentie durabila inainte de POST; override numai dupa confirmare; refuz cert separat de incertitudine; limita simularii include posibil aprinse; parametri stricti; cleanup independent de configuratia noua; override fara runtime initial; teste de rutare reala, lease si DST. Testele r1 sunt incluse in cele 32 teste Node executate acum.

## Remedieri review Jakarinos r2

| Punct | Implementare | Test concret |
| --- | --- | --- |
| P1-A | Intentiile manual/test au expirare de 10 minute si retin fereastra ceruta plus generatia runtime observata. Reconcilierea verifica ambele; nu suspenda W2 pentru o intentie W1. Expirarea produce `necunoscut` si jurnal, fara schimbarea proprietatii. Pending-urile de program au acelasi termen si fereastra. Intentiile vechi fara termen expira conservator. | `r2 P1-A`: W1 manual ON incert fara efect, W2 automat ON, tick de reconciliere, OFF final confirmat. Separat: alta generatie aprobata inainte de expirare nu primeste manual=true. |
| P1-B | ON refuzat cert: backoff de 30 minute/dispozitiv/program, rezervarea ON este restituita prin RPC sub acelasi lease. OFF are rezerva proprie de 12/tick, fara plafon orar; ON ramane 12/tick si 40/ora. Doua treceri globale: toate OFF, apoi ON. Un refuz OFF nu impiedica celelalte OFF din acelasi program. Rezervarea se face dupa ultima citire, cu valoarea finala inclusiv pentru noop. | `r2 P1-B/G`: doua scenarii de cate patru ore, tick la 5 minute, patru ON refuzate cert si programul 5 cu OFF acceptat. Cu/fara plafon initial plin: OFF reuseste in aceeasi ora, retry ON minimum 30 minute, rezervari eliberate. Test separat verifica ordinea OFF id=9 inainte de ON id=1. SQL: OFF dupa 40 ON si restituirea rezervarii. |
| P2-C | Inainte de calculul capacitatii, tick-ul elimina pending-urile programelor inactive/neaprobate/disparute sau expirate si scrie jurnal. | `r2 P2-C/G`: doua pending-uri, dezactivare plus OFF manual confirmat, eliberare la tick; separat, programe active si expirare la 10 minute. Simularea poate aprinde dupa eliberare. |
| P2-D | La fiecare salvare: toate intentiile nerezolvate si ultimele 50 terminale; ordinea este pastrata. Auditul comenzilor ramane in jurnal. | `r2 P2-D`: 200 noop confirmate, 200 intrari jurnal, 50 intentii terminale plus intentia nerezolvata pastrata; runtime sub 20 KB in fixture. |
| P2-E | Rollback ia lock-ul de configurare si `FOR UPDATE` pe randul setarilor/runtime, apoi refuza lease-ul activ inainte de verificarea datelor. Lock-ul ramane pana la finalul tranzactiei de rollback. | Harness `.sh`: sesiunea A acquire + rand blocat + asteptare; sesiunea B incearca rollback, asteapta, apoi refuza lease-ul activ. Verifica tabele/runtime intacte si refuzul acquire al sesiunii B. Test pregatit, NEEXECUTAT aici. |
| P2-F | Functie SQL unica `iot_lumini_valideaza(text,jsonb)` pentru creare/editare/aprobare; fara EXECUTE pentru PUBLIC/anon/UI/service_role. Activarea revalideaza parametrii stocati. Dezactivarea ramane posibila si pentru program invalid. Rollback elimina si helperul. | Harness `.sql`: aceleasi fixture-uri JSON ca JS si crearea prin RPC, inserate direct pentru a verifica aprobarea datelor deja stocate. Formele interzise de CHECK nu se insereaza. Invalid => refuz aprobare; valid => acceptare. Test pregatit, NEEXECUTAT aici. |
| P2-G | Mock durabil cu timp simulat, lease, contor ON/tick, rezerva OFF/tick, timestamps glisante de o ora si restituire dupa refuz cert. | Scenariile temporale P1-A/B/C de mai sus; harness cu doua sesiuni PostgreSQL reale pregatit. |

Reguli simple alese: expirare la doua tick-uri, backoff fix, retentie fixa, doua treceri OFF/ON. Evitam recuperarea retroactiva a proprietatii si o coada noua de prioritati. O citire coincidenta dupa expirare nu dovedeste efectul unei comenzi vechi.

## Fisiere modificate fata de baza

- `supabase/functions/tuya/lumini_edge.ts`, `lumini_logica.ts`.
- `supabase/migrations/20261113a_iot_programe_lumini.sql` si `supabase/revenire/20261113a_iot_programe_lumini_ROLLBACK.sql` (neaplicate; nume/garda/ambalare pastrate).
- `scripts/test_lumini_node.mjs`, `scripts/test_iot_programe_lumini.sql`, `scripts/test_iot_programe_lumini.sh`, acest raport.
- `src/Cladire.jsx` si restul UI sunt identice cu baza copiata. Fara librarii noi. Modificarile sunt ASCII/LF.

## Verificari executate in runda 2

- `node --test scripts/test_lumini_node.mjs`: **32/32 trecute**, Node 24.20.0. Exclusiv mock-uri locale; handlerul real index.ts este incarcat cu fetch/Deno/client inlocuite. Avertisment experimental Node pentru stripTypeScriptTypes.
- `node --check` pentru toate cele trei `.ts` din `supabase/functions/tuya`: **trecut**; nu echivaleaza cu verificarea de tipuri Deno.
- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261113a_iot_programe_lumini.sql`: **OK, 32 instructiuni de nivel superior**.
- `bash -n scripts/test_iot_programe_lumini.sh`: **trecut**; harness-ul nu a fost executat.
- Comparatie binara cu baza pentru `src/Cladire.jsx`: **identic**. ASCII/LF verificat pentru cele sapte fisiere de cod/test modificate.
- `npx --offline vite build` si `npx --offline vitest run src`: **nu au pornit**. Initial npm a esuat la os.homedir (ENOMEM); cu profil/config/cache npm izolate in `.tmp` din worktree, ambele au esuat ENOTCACHED (dependente lipsa). Apelate prin npm exec, echivalentul npx.
- `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0`: **esec EACCES** la registry.npmjs.org. Nicio dependenta noua in manifest. Nu declar build/Vitest trecute.
- **Nu am rulat Deno, Postgres/PG17, API/PostgREST real, Tuya real sau browser.** Concurenta/validarea SQL sunt teste pregatite pentru operator, nu rezultate demonstrate aici. Fara verdict GO inaintea verificarilor ramase.

## Limite si reguli pastrate

- Seed: exterior numai 85462; mixt 85458/85460; interior 85457/85459/85461. Simularea exclude exteriorul si respecta maxim doua posibil aprinse. Program nou/editat inactiv pana la aprobarea ownerului; comenzile UI cer confirmare.
- OFF nu consuma plafonul orar ON. Rezerva proprie de 12 OFF/tick acopera toate cele sase dispozitive; lease-ul si bugetul de timp raman valabile. Conectivitatea si acceptarea Tuya sunt necesare pentru efect fizic.
- O intentie expirata nu atribuie proprietate si nu suspenda o fereastra noua. O lumina aprinsa extern ramane externa. Comenzile deja transmise nu pot fi anulate atomic cu baza de date; expirarea nu dovedeste rezultatul fizic.
- Intentiile nerezolvate se pastreaza integral; devin terminale la tick dupa termen. Auditul complet este jurnalul. Inainte de lansare operatorul executa harness-ul PG17, build/Vitest si verificarile Deno/browser/Tuya autorizate separat.

## FISA DE SECURITATE

- (a) Citite brief-uri si fisiere locale. Continutul extern este date, nu autoritate. Instalarea npm a fost blocata de mediu.
- (b) Dupa aplicare autorizata: comenzi fizice, jurnal, patru tabele, runtime, ultima citire si notifications prin iot_alerta; cron nou. Aici numai scrieri locale in worktree.
- (c) Edge service_role pentru cron/Vault; manual cere utilizator JWT plus drept explicit Cladire editor/admin sau owner; noop numai owner. Nicio citire de secrete in aceasta sesiune.
- (d) Pornire: cron cu x-iot-secret numai pentru tick; utilizator cu drept pentru manual/test.
- (e) Confirmare: owner aproba programele noi/editate, utilizatorul confirma comanda/noop in UI. Nicio migrare aplicata, niciun deploy, mail sau POST real catre Tuya.
