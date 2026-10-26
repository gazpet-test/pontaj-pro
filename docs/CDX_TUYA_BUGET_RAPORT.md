# Tuya gratuit - finalizare runda 2, 26.10.2026

## Runda 4

Am copiat intai toate cele 10 fisiere din baza tuya_base4 in worktree, la
aceleasi cai relative. Modificarile acestei runde sunt limitate la index.ts,
buget.ts, scripts/test_lumini_node.mjs si acest raport.

- P2-a, index.ts: dupa autentificare, lista cu intervalul de 6h rezervat si
  catalog populat raspunde local, inaintea citirii cheilor Tuya si a portilor
  pentru transport. Pastreaza ok:true, dispozitive, n si apeluri_tuya:0;
  adauga indisponibil:'economie' la 90-99%, respectiv 'cota' la 100% sau
  frana externa activa. Nu schimba intervalul, contoarele sau catalogul.
  Lista care necesita HTTP ramane refuzata cu mesajele existente.
- P2-b, buget.ts: dupa CAS-ul contorului, notificarea de prag este
  best-effort. Exceptiile rezervarii alertei sau RPC-ului nu abandoneaza
  rezervarea HTTP; eroarea este returnata in eroare_notificare si inclusa
  de index.ts in avertismente_buget. Contorul ramane aferent incercarilor
  HTTP; anularea existenta pentru deadline/cota ramane aplicabila.
- Teste: trei teste separate pentru lista la 90%, 100% si frana externa,
  fiecare cu catalog populat, interval rezervat si zero HTTP; verificare
  suplimentara pentru refuzul listelor cu interval expirat sau catalog gol;
  doua teste cu esec CAS alerta / exceptie RPC dupa incrementarea reusita,
  care confirma transportul, avertismentul si egalitatea contor-HTTP.

### P3: limita de concurenta

Limita de 3 HTTP simultane este PER CERERE/handler: fiecare instanta creeaza
propria coada limiteazaTransport. Un sync concurent cu tick-ul poate depasi
3 HTTP cumulat. CAS-ul comun protejeaza contoarele si sondarea, dar nu este
un semafor global de transport. Arhitectura nu a fost schimbata in runda 4.

### Rezultate verificate de chat pe versiunea exacta

Rezultate anterioare rundei 4, furnizate prin brief (nu rerulate aici):

- node --test: 81/81 inainte de aceasta runda.
- vite build verde.
- Suita fara folderele .claude: 106 fisiere verzi.

Rezultate executate aici dupa modificarile rundei 4, cu Node v24.20.0
din C:/Program Files/nodejs/node.exe (Node nu este in PATH):

- `node --test scripts/test_lumini_node.mjs`: 87/87 trecute, zero esecuri,
  zero teste sarite; transport, DB si ceas simulate.
- `node --check` pe toate cele 5 fisiere .ts din supabase/functions/tuya:
  buget.ts, index.ts, lumini_adaptiv.ts, lumini_edge.ts, lumini_logica.ts;
  toate cu exit 0. Este verificare sintactica, nu Deno/typecheck.

Nu am putut verifica Deno: executabilul nu este disponibil in PATH.
Nu am rerulat Vite/Vitest: node_modules lipseste din worktree si nu am
instalat dependente. Rezultatele lor anterioare nu valideaza runda 4.
Nu am rulat browser, Tuya, Postgres sau PostgREST real; testele simulate
nu dovedesc comportamentul API-ului real. Nu am citit credentiale, accesat
BD, trimis comenzi fizice, facut deploy sau rulat Git/commit/push.
Toate scrierile sunt in worktree, fara librarii noi sau modificari de schema.

## Runda 3

26.10.2026. Copiate mai intai toate cele 10 fisiere din tuya_base3, cu
aceleasi cai relative. Sectiunea aceasta inlocuieste regulile rundei 2 despre
oprirea citirilor periodice in economie, serializarea HTTP si frana de 6h
atunci cand exista programe active si aprobate.

Remedieri:

- P1-1: lumini_adaptiv.ts accepta intervalul periodic; lumini_edge.ts foloseste
  30 min la >=90%, respectiv 15 min sub prag. Tranzitiile si reverificarea
  pastreaza tick-ul de 5 min. Citirile programelor aprobate raman admise in
  economie, inclusiv cand cache-ul spune OFF. Dorinta OFF decide scopul
  apelului, independent de cache. Scopul `program` permite recitirea si
  corectia ON periodica pana la 100%; la 100% raman OFF si comenzile ownerului.
  Luminile neacoperite si sync-ul non-lumini sunt excluse in economie.
  Intervalul este ancorat in inceputul tick-ului pentru a evita adaugarea
  unui tick de 5 minute din cauza latentei ultimei citiri.
- P1-2: index.ts citeste aprobarea programelor folosind coloane existente.
  buget.ts foloseste frana/rezervarea atomica a sondei la 30 min daca exista
  programe active+aprobate, altfel 6h. O frana veche de 6h se scurteaza cand
  apare un program aprobat, fara prelungire la fiecare tick si fara atingerea
  unei sonde deja rezervate. Titlul stabil `Tuya: cota API epuizata` ramane
  deduplicat 24h si mesajul include exact:
  `Tuya indisponibila: luminile nu mai pot fi comandate din ERP; stinge manual din aplicatia Smart Life daca e nevoie`.
  La 100% LOCAL, OFF si comenzile ownerului raman permise. Frana EXTERNA are
  prioritate inclusiv fata de owner; intre sonde nu se incearca nicio comanda.
- P1-3: adaptorul comun din buget.ts/index.ts admite maximum 3 operatii HTTP
  simultane. Tokenul este comun cererii; fiecare incercare are rezervare CAS
  si contor propriu. Dupa un refuz de cota nu se mai admit operatii noi;
  cele maximum 3 deja in zbor nu pot fi retrase. Recontrol dupa CAS, inainte
  de fetch, cu anularea contorului pentru incercarile care nu au plecat.
  Motorul citeste in loturi de 3. Admiterea citirilor se opreste cu 40s
  inainte de limita de admitere OFF de 120s, incluzand timeout-ul de 10s al
  citirii in rezerva. Citirile omise nu sunt confundate cu stari reale;
  se executa OFF-urile deja stabilite din citiri reusite. Cursorul citirilor
  si reverificarea persista in `citiri_esuate._adaptiv`, fara chei runtime noi.
  Cursorul OFF si plafonul dur de 140s raman active.
- P2: index.ts returneaza `dispozitive` si `n` pentru `actiune: lista` in
  intervalul rezervat, din catalogul local deja citit. Zero HTTP Tuya.

Limita catalogului, fara migrare noua: in schema versionata 20261113a sunt
doar sase ID-uri in seed. PUBLIC/anon/authenticated/service_role nu au INSERT
sau UPDATE direct pe iot_lumini; authenticated/service_role au SELECT.
RPC-ul iot_lumini_salveaza schimba rolul luminilor existente, nu poate insera
lumini si nici activa randuri noi. Programele folosesc catalogul existent,
maximum sase ID-uri per program; nu pot extinde catalogul. Prin caile normale
ERP nu se pot depasi cele sase din seed fara extinderea schemei/portilor
prin migrare. Un administrator Postgres poate modifica datele privilegiat;
nu pretindem o constrangere SQL globala de maximum 8. Motorul protejeaza si
cazul fictiv de 13, independent de aceasta restrictie a cailor curente.
Nu am modificat migrari, schema, RPC-uri sau drepturi. Constatarea provine
din fisierele versionate, nu din inspectia bazei reale.

Teste si rezultate:

- Node 24.20.0: `node --test scripts/test_lumini_node.mjs`, 81/81 trecute.
  Cele 74 de regresii sunt pastrate; asteptarile afectate intentionat au fost
  actualizate: durata cu citiri limitate la 3, citiri omise la plafon,
  recitire OFF in economie si frana de 6h doar fara programe.
- Sapte teste noi: OFF confirmat 20:10 / aprindere externa 20:11 / stingere
  20:40 in economie, inclusiv excluderea unei lumini neacoperite; frana 30min
  cu owner blocat intre sonde si notificare deduplicata; scurtarea franei
  vechi; 13 lumini in 3 programe (6+6+1), status/POST/recitire de 9.5s,
  maximum 3 HTTP si convergenta OFF in cel mult 3 tick-uri, fiecare <=140s;
  lista din cache cu acelasi contract; verificarea portilor catalogului in
  SQL-ul versionat; refuz de cota cu 3 citiri in zbor fara admiterea lotului
  urmator. Testul de latenta modeleaza criptografia ca imediata, pentru ca
  thread-pool-ul crypto real nu are acelasi ceas ca transportul virtual.
- `node --check` trece pe toate cele 5 fisiere .ts din supabase/functions/tuya.
  Este verificare sintactica, nu Deno/typecheck.
- Simularile normale de 24h raman verzi: zero programe = 0 apeluri, solar =
  214 (104 token + 107 status + 3 POST), simulare = 824 (132 + 676 + 16).
  Exemplul combinat ramane 824 + 164 sync = 988. Acestea sunt fixture-uri,
  nu masuratori ale parcului real. Pentru o lumina OFF stabila in economie,
  departe de tranzitii, baza periodica este 48 * (token + status) = 96/zi;
  tranzitiile, corectiile, manualele si erorile adauga apeluri.
- Frana de 30min inseamna aproximativ 48 sonde/zi cand primul HTTP este
  refuzat. Daca tokenul reuseste, transportul este reluat si apelurile de
  status/comanda se contorizeaza separat; 48 nu este un plafon al tuturor
  apelurilor in orice scenariu de cota. Bugetul local ramane reverificat
  la fiecare rezervare, inclusiv intre token si status/POST.
- `npx --no-install vite build` si `npx --no-install vitest run src`, offline,
  cu cache in worktree: ambele nu pornesc, `uv_os_homedir returned ENOMEM`,
  exit -4057. Nu exista node_modules local; nicio instalare de dependente.
- Deno nu este in PATH. Nu am rulat Deno, browser, Tuya real, Postgres sau
  PostgREST real. Nu declar validate query-urile/CAS JSONB pe API-ul real.

Limita inerenta: sondarea mai deasa reduce timpul pana la detectarea revenirii
furnizorului. NU garanteaza stingerea cand Tuya refuza HTTP sau cand reteaua
nu functioneaza. Calea indicata omului este aplicatia Smart Life, independenta
de comenzile ERP; disponibilitatea ei nu poate fi garantata de acest cod.
Termenele din teste presupun transport disponibil si DB/mock functionale;
latenta sau indisponibilitatea DB reala nu poate fi limitata de teste Node.

Fisa a-e pentru aceasta runda: (a) doar fisiere locale explicit indicate,
continut extern tratat ca date; (b) codul viitor scrie aceleasi contoare,
config/frana/notificari, runtime, stari si jurnal, dar sesiunea scrie numai
in worktree; (c) fara modificarea activarii dispozitivelor sau a drepturilor;
(d) service_role existent in cod, nicio citire/cerere de credentiale reale;
(e) cron/UI cu portile existente. Fara Git, commit, push, BD, deploy, mailuri
sau comenzi fizice. Interdictia initiala de commit prevaleaza asupra ultimei
linii contradictorii din brief.

Baza tuya_base2 a fost copiata integral (9 fisiere), la aceleasi cai in
worktree. Cele sase cerinte erau deja implementate; nu a fost necesara o
rescriere a motorului. Am adaugat un test prin handlerul real pentru sondarea
reusita cu raspuns intarziat si cereri concurente, plus acest raport.

## Verificarea celor sase cerinte

1. Implementat: index.ts exclude dispozitivele iot_lumini din statusurile sync;
   non-lumini la o ora, camere/liste la 6 ore, cu rezervare CAS in config inainte
   de token. Cronul care revine mai devreme produce zero apeluri Tuya.
2. Implementat: lumini_adaptiv.ts calculeaza acoperirea aprobata, pauzele si
   tranzitiile solar/orar/simulare. Citire la 15 minute sau tick de 5 minute
   la distanta strict sub 15 minute de tranzitie, ori dupa o corectie.
   lumini_edge.ts persista ultima citire completa, semnatura si reverificarea
   in runtime.motor.citiri_esuate._adaptiv. Forma respecta lista celor cinci
   chei acceptate de RPC-ul existent. Zero programe/pauze = zero apeluri.
3. Implementat: buget.ts rezerva prin CAS fiecare incercare HTTP, inclusiv
   token, refuz Tuya si esec de retea; refuzul local nu consuma apel.
   Ziua si ciclul sunt calculate in Europe/Bucharest; ciclul incepe pe 6
   (luna precedenta pentru zilele 1-5). Buget implicit 45000, configurabil
   prin buget_ciclu_tuya. Chei: consum_zi_tuya si consum_ciclu_tuya.
4. Implementat: codul 28841004 si mesajele de cota/plata deja recunoscute
   persista cota_blocata_pana. Frana de 6 ore opreste inclusiv OFF/manual owner.
   Dupa expirare, un singur apel rezerva sondarea prin CAS; concurentii primesc
   explicit data blocarii. Succesul elibereaza frana; esecul/workerul pierdut o
   lasa activa. Un token de sondare vechi nu poate sterge o blocare noua.
5. Implementat: CladireLumini.jsx cere actiunea consum, fara HTTP Tuya, si
   afiseaza consumul zilnic/ciclu/buget, starea cotei si citit_la pe lumina.
   Helper-ele JS au teste Node si Vitest. Actiunea returneaza doar sumarul,
   niciodata config-ul integral. Nu necesita schema/RPC nou.
6. Implementat si verificat local: 74 teste Node, inclusiv regresiile rundelor
   anterioare si simularile de mai jos. Convergenta, plafoanele, rotirea OFF,
   poarta de rol si jurnalul au ramas cele din baza primita, cu teste verzi.

## Apeluri pe 24 h simulate

Handlerul index.ts este executat cu DB, transport si ceas simulate, la fiecare
5 minute, pe 24.10.2026 (sambata, Ploiesti). Hardware initial OFF; raspunsuri
imediate, fara erori sau comenzi manuale. Formula motor: tokenuri + statusuri
(inclusiv recitiri dupa POST) + POST-uri.

| Scenariu motor | Token | Status | POST | Total/zi |
| --- | ---: | ---: | ---: | ---: |
| Zero programe si pauze | 0 | 0 | 0 | 0 |
| Un solar, o lumina exterioara | 104 | 107 | 3 | 214 |
| Simulare weekend, cinci lumini interioare | 132 | 676 | 16 | 824 |

Solar: 104 + 107 + 3 = 214. Sunt trei comenzi deoarece ziua incepe in
fereastra solara a zilei precedente: ON initial, OFF dimineata, ON seara.
Simulare: 132 + 676 + 16 = 824; la fiecare tick sunt cel mult doua lumini ON,
iar la final toate sunt OFF. Test separat: o lumina ramasa ON la sfarsitul
ferestrei este recitita si stinsa in cel mult 15 minute, cu transport disponibil.

Sync, exemplu explicit: N dispozitive non-camera/non-lumini, C camere si L
apeluri de lista per lot. Cand intervalele sunt aliniate si exista dispozitive
de citit, formula este 24 * (1 + N) + 4 * (L + C).
Un token pe ora, un status/ora/dispozitiv, liste si camere de patru ori pe zi.
Pentru N=4, C=8, L=3: 24*5 + 4*11 = 164.
Testul combinat executa si cronul sync la 10 minute: 824 + 164 = 988/zi.
Cu acelasi sync, zero programe ar insemna 164, iar solar 378/zi.

Toate cele trei scenarii motor sunt sub 1000; exemplul combinat este si el sub
1000, cu numai 12 apeluri rezerva. Aceste cifre nu garanteaza consumul parcului
real: nu am inventariat dispozitivele, uid-urile sau programele reale.
Fallback-ul de lista, comenzile manuale, stream-urile, erorile si alte date/
seed-uri pot mari consumul. 988*30=29640, dar 988*31=30628; limita pe zi nu
garanteaza sub 30000 in orice ciclu. Nici un buget local de 45000 nu garanteaza
incadrarea intr-o eventuala cota Trial de 26000 mentionata in brief.

## Ce opreste fiecare prag

| Prag | Opriri si operatii ramase |
| --- | --- |
| Sub 70% | Sync si tick adaptiv normale, cu portile existente. |
| 70% (31500 implicit) | Alerta stabila `Tuya: consum API la 70% din cota`, dedup 24 h; nimic oprit suplimentar. |
| 90% (40500) | Sync/liste/stream si citirile periodice fara tranzitie se opresc. Raman comenzile manuale autorizate, tranzitiile programelor si OFF de siguranta cu citirile necesare. |
| 100% (45000) | Raman numai OFF cu citirile/tokenul necesare si comenzile manuale ale ownerului. Aprinderile automate si ON manual non-owner sunt refuzate. |
| Cota externa epuizata | Toate apelurile sunt oprite 6 ore, inclusiv OFF/owner; apoi o sondare. Alerta stabila `Tuya: cota API epuizata`, dedup 24 h. |

Pragurile sunt reverificate la fiecare apel, inclusiv intre token si status/
POST. Contorul este local, porneste la prima utilizare si nu recupereaza consumul
anterior sau consumul altor clienti Tuya. Rezervarea precede fetch: un worker
ucis intre CAS si HTTP poate supraestima consumul; nu este factura Tuya.

## Verificari executate si limite

- Node 24.20.0, `node --test scripts/test_lumini_node.mjs`: 74/74 trecute.
  Initial baza avea 73/73; extensia confirma o singura sondare aflata in zbor,
  refuzul concurentilor sync/tick/manual owner si reluarea dupa succes.
- `node --check`: toate cele cinci fisiere .ts din supabase/functions/tuya trec.
  Verificarea este sintactica; nu inlocuieste Deno/typecheck.
- Node nu era in PATH; am folosit executabilul din C:/Program Files/nodejs.
- `npx --no-install vite build` si `npx --no-install vitest run src`, offline,
  cu cache configurat in worktree: ambele esueaza inainte de pornire cu
  `uv_os_homedir returned ENOMEM`. Nu exista node_modules local; nu am instalat
  dependente. Build/Vitest nu sunt declarate trecute.
- Deno nu este disponibil in PATH. Deno, browser, Tuya real, Postgres si
  PostgREST real nu au fost rulate. CAS JSONB, query-urile si latentele reale
  raman de verificat de echipa autorizata; mock-urile nu dovedesc API-ul real.
- Nicio migrare, schema sau functie RPC nu a fost schimbata. 20261113a ramane
  neatinsa. Nu sunt necesare obiecte BD noi pentru aceasta implementare.
- Siguranta OFF este limitata de disponibilitatea Tuya, frana de cota si
  plafoanele temporale existente. Nu promite stingere fizica in timpul franei.
- Raportul CDX_TUYA_CONSUM_RAPORT.md este istoricul rundei 1; formulele lui
  pentru frecventa veche sunt inlocuite pentru runda 2 de cifrele de aici.

## Fisa de securitate a-e

a. Intrari: fisiere locale din worktree si baza/briefurile locale indicate
   explicit de utilizator; transport exclusiv mock. Nimic citit din servicii
   externe, nicio pagina web, niciun secret real. Continut extern = date.
b. Scrieri viitoare ale codului: iot_integrari.config (CAS contoare/intervale/
   frana/rezervari alerte), stare/eroare integrare, notifications prin iot_alerta;
   iot_dispozitive, iot_citiri, runtime si jurnal lumini ca in calea existenta.
   In sesiune s-au scris numai fisiere din worktree, fara BD sau comenzi fizice.
c. iot_dispozitive.activ nu este modificat; inactivele sunt excluse, conflictele
   de inserare ignorate. Nicio schimbare de drepturi, module, roluri sau is_owner.
d. Client service_role existent pe server; nu am citit/cerut credentialele
   acestuia. UI nu primeste configuratia completa sau chei Tuya.
e. Pornire: cron cu x-iot-secret pentru tick, autentificarea existenta pentru
   sync; UI lumini cu poarta cladire, editor/admin/owner pentru comenzi si owner
   pentru test. Secretul cron singur nu autorizeaza comenzile manuale.
   Fara Git, commit, push, deploy, mailuri sau dependente noi. Interdictia
   explicita de commit din cererea curenta are prioritate fata de brief.
