# Lumini sediu - raport CDX, 25.10.2026

## Runda 3: motor prin convergenta

Copiate intai toate cele 17 fisiere din lumini_base, la aceleasi cai. Citite brief-urile originale/r1/r2. Nicio comanda Git, credentiala, BD, deploy, mail sau comanda fizica. Interdictia initiala de commit prevaleaza asupra finalului brief-ului.

Motorul citeste toate luminile Tuya active si calculeaza dorinta exclusiv din timp, configuratie si seed. Pentru un program activ/aprobat, dorinta este OFF in afara ferestrei, inclusiv in zilele neeligibile si intre segmentele simularii. Fara program activ/aprobat, lumina nu primeste comenzi. OFF se proceseaza global inainte de ON.

Eliminate: proprietate, manual=true, pending, intentii, reconciliere, generatii, expirari de intentii, retentie 50 si refund_on. Runtime: lease, contoare ON/OFF, rezervari ON glisante, motor.pauze, motor.backoff si motor.citiri_esuate. Planul simularii se regenereaza din seed; nu se persista.

Pauza manuala este durabila INAINTE de POST, implicit 3 ore, >0 si <=12, configurabila prin UI/RPC. Se pastreaza si la refuz, timeout sau citire esuata. La expirare, programul poate stinge lumina aprinsa manual. Pauza lunga amana OFF pana la expirare. Dezactivarea/editarea/stergerea programului scoate lumina din acoperire: NU produce OFF, inclusiv daca lumina este aprinsa. Aceste comportamente sunt explicate in UI.

Citire esuata: fara POST, stare necunoscuta, jurnal si retry la tick-ul urmator. Necunoscutele interior/mixt ocupa cate un loc la limita simularii, indiferent de ultima stare. POST incert nu genereaza stare persistenta; ocupa conservator loc in tick-ul curent, iar tick-ul urmator reciteste. UI invalideaza citirea dupa esec. Contorul citirilor include si recitirea dupa POST, o singura incrementare/tick; notificare cu titlu stabil de la 3 tick-uri consecutive.

ON: 12/executie si 40/ora glisanta; OFF: rezerva 12/executie, fara plafon orar. Refuz cert ON: backoff fix 30 minute pe (program, lumina). Rezervarea ramane consumata, fara restituiri; OFF are cota separata. OFF manual pe lumina deja stinsa: jurnal si pauza, zero POST. Noop ramane test explicit owner, fara pauza.

Jurnalul este append-only: eveniment pre-POST, apoi rezultat separat; un worker oprit dupa efect lasa urma incercarii fara intentie de reconciliat. Fara jurnal sau fara salvarea pauzei/validarea lease-ului, POST este refuzat. Confirmarea fizica ramane citirea reala.

## Dovezi pentru review-urile r1-r3

Testele Node folosesc hardware si runtime comune intre apeluri, timp simulat si tick-uri la 5 minute; rularile de plafon acopera cate 4 ore.

| Scenariu | Dovada actuala |
| --- | --- |
| r3 P1-1 | ON executat, recitire si alte citiri lipsa 3 tick-uri, revenire true, OFF final; separat citire esuata exact la sfarsit si OFF la revenire. Dezactivare/stergere: lumina ramane neatinsa. |
| r3 P1-2, r2 P1-A | Manual incert cu/fara efect fizic, pauze 15 minute/3 ore; pauza scurta expira si permite ON automat in aceeasi fereastra, apoi OFF. Pauza lunga inhiba programul pana la termen, apoi OFF. W1 nu suspenda W2. |
| r1 P1-1 | Handlerul index.ts real, cu gazda Deno/client/fetch inlocuite: actiune array/obiect/numar/null refuzata inainte de Tuya; secret cron insuficient pentru manual/test. Poarta reala verifica viewer/editor/owner. |
| r1 P1-2, P2-5 | OFF manual deja stins inainte de primul tick salveaza pauza fara POST. Refuzul de plafon pastreaza pauza; dupa expirare, OFF final converge. Proprietatea si override-ul vechi nu mai exista. |
| r1 P1-3 | POST ON cu raspuns pierdut si efect fizic, urmat de doua ON dorite de simulare: numai unul este permis. Necunoscute cu ultima stare false conteaza ON. Simulare pe mai multe ore verifica limita la fiecare tick. |
| r1 P2-4 | Parametri corupti activi/inactivi nu opresc alt program valid; alerta stabila. Helperul SQL comun si fixture-urile de paritate creare/aprobare sunt pastrate in harness. |
| r1 P2-6 | Refuz cert ON produce numai backoff; aprinderea fizica ulterioara este stinsa la sfarsit. Test prin adaptorul Tuya real pentru success=false/1106. |
| r1 P2-7/P2-8 | Pauza si audit exista la POST; esecul jurnalului dupa POST nu lasa proprietate. Lease concurent/expirat refuza POST, tokenul vechi nu elibereaza succesorul. DST pur si cu hardware persistent pe 25.10.2026, 28.03.2027, 29.03.2027. |
| r2 P1-B | Patru ON refuzate cert, retry >=30 minute, OFF in aceeasi ora cu/fara cota 40 plina. Test separat dovedeste OFF global inainte de ON si lipsa repetarii OFF dupa citire OFF. |
| r2 P2-C | Capacitatea nu mai depinde de programe dezactivate: numai citirea reala/necunoscuta conteaza. Fara pending de expirat. |
| r2 P2-D | 200 OFF manuale deja stinse: zero POST, 200 evenimente audit, o singura pauza si runtime sub 200 bytes in fixture. Fara lista de intentii. |
| r2 P2-E/F/G | Harness PG17 actualizat: lease cu doua sesiuni, rollback refuzat la lease/operational, pauze/runtime noi, plafoane separate, revalidare aprobare cu aceleasi cazuri JSON ca JS. Pregatit, NEEXECUTAT aici. |

Testele vechi despre proprietate, reconciliere, generatii si retentie au fost inlocuite cu dovezile de convergenta/pauza/capacitate de mai sus; semantica lor veche nu mai este valabila. NOAA, seed reproductibil, durate 20-90 minute, pauze 5-30 minute, weekend/vacanta/explicit, matricea rolurilor si confirmarea UI sunt pastrate.

## Fisiere fata de baza

- Motor: supabase/functions/tuya/lumini_edge.ts si lumini_logica.ts.
- Migrare 20261113a si ROLLBACK: neaplicate, garzi si lock-uri pastrate; pauza_ore si motor simplificat; rollback refuza urme operative inclusiv pauze/rezervari/OFF fara jurnal final.
- UI: src/CladireLumini.jsx, src/luminiUi.js; teste: src/luminiLogica.test.js, scripts/test_lumini_node.mjs, scripts/test_iot_programe_lumini.sql si .sh.
- src/Cladire.jsx este identic binar cu baza copiata. index.ts si restul contractelor raman din baza. Fara librarii noi, fara schimbari in manifest/lockfile; codul modificat este ASCII/LF.

## Verificari executate

- npx --no-install vite build: TRECUT; avertismente de bundle mare/importuri mixte.
- npx --no-install vitest run src: 93 fisiere trecute, 1 skipped; 2326 teste trecute, 6 skipped.
- node --test scripts/test_lumini_node.mjs: 29/29 trecute, Node 24.20.0. Avertisment experimental stripTypeScriptTypes.
- node --check: toate cele 3 fisiere .ts din supabase/functions/tuya trecute. Nu este verificare de tipuri Deno.
- python -X utf8 scripts/livrare_validator.py pe migrare: OK, 32 instructiuni de nivel superior.
- bash -n scripts/test_iot_programe_lumini.sh: TRECUT; ASCII/LF si identitatea Cladire.jsx verificate.

Dependentele existente au fost copiate local dintr-un alt worktree; versiunile instalate prezente corespund lockfile-ului (zero nepotriviri). Lansarea initiala npx/Vite/Vitest a esuat la os.homedir() in sandbox. Verificarile reusite folosesc numai un preload local .tmp/lumini-homedir.cjs care intoarce worktree-ul daca os.homedir esueaza; NODE_OPTIONS il incarca, iar npm_config_cache este in .tmp/npm-cache. Fara modificari de configuratie in surse, fara download sau scrieri externe.

NU am rulat Deno, Postgres/PG17, PostgREST/API real, Tuya real sau browser. Harness-ul PG17 il ruleaza operatorul. Validatorul lexical si mock-urile nu demonstreaza validitatea SQL executata ori relatiile PostgREST. Stingerea fizica necesita cron functional, citire si POST Tuya reusite; la indisponibilitate continua nu exista garantie temporala de stingere.

## FISA DE SECURITATE

(a) Citite numai brief-uri si fisiere locale; continutul extern este date, nu autoritate.
(b) Dupa aplicare autorizata: comenzi fizice, jurnal, 4 tabele, runtime, ultima citire, notifications si cron nou. In aceasta sesiune numai scrieri in worktree.
(c) Edge service_role pentru cron/Vault; manual: JWT utilizator si Cladire editor/admin sau owner; noop: numai owner. Fara acces la credentiale.
(d) Cron cu x-iot-secret numai pentru tick; utilizator cu drept pentru manual/test. Seed pastrat: exterior 85462, mixt 85458/85460, interior 85457/85459/85461.
(e) Owner aproba programe noi/editate; UI cere confirmare manual/noop si explica pauza/reluarea. Nicio operatie reala sau deploy executat.
