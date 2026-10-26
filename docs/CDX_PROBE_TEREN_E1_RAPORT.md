# Probe de presiune pe teren - etapa 1

Data: 2026-10-26. Livrare NEAPLICATA. ASCII / LF.

## Artefacte

- `supabase/migrations/20261114a_probe_teren.sql`: beneficiar, intervale utilaje,
  contoare per citire, registru comun de idempotenta, patru RPC, validari server,
  RLS, protectie fata de scrierea directa legacy si `v_probe_raport`.
- `supabase/revenire/20261114a_probe_teren_ROLLBACK.sql`: garda proprie,
  lock comun cu RPC-urile, refuz pe date operative/beneficiar modificat,
  eliminare explicita a obiectelor noi, fara CASCADE.
- `scripts/test_probe_teren.sh`, `.sql`, `_fixture.sql`: PG17 izolat,
  proprietar `postgres` NOSUPERUSER/NOBYPASSRLS, runner oficial,
  scenarii SQL si concurenta in doua sesiuni reale. Clusterul, clona si toate
  fisierele temporare sunt create numai in worktree.

Nu am modificat UI, fisierele interzise, migrari existente, alimentari sau stoc.
Nu am rulat Git, commit, push, conexiuni BD, deploy sau citire de secrete.
Cerinta initiala fara commit are prioritate fata de fraza finala din brief.

## Decizii de implementare

1. Singurul backfill este cel cerut explicit: `gazpet` pe probe cu proiect.
   Istoricul si calculele comerciale preliminare fara proiect raman NULL.
   RPC-ul cere completarea beneficiarului inainte de executie; CHECK-ul
   valideaza orice beneficiar completat explicit. Oferta tert este verificata
   in `probe_oferte`; contract/comanda au referinta polimorfa pozitiva si client
   obligatoriu. Nu am inventat un tabel de contracte/comenzi pe baza numelui.
2. Modelul DUAL este acelasi ca `iot_lumini_drept`: owner sau intrare explicita
   `probe_teren`, `editor/admin` pentru scriere, `viewer/editor/admin` pentru
   citire. Intrarea `module='probe'` singura nu acorda acces pe teren.
   Registrul de idempotenta nu este vizibil clientilor, indiferent de nivel.
   Rolul global, inclusiv superadmin, nu acorda acces. Nu exista in modelele
   citite un helper generic parametrizat pentru acest modul; helperul nou
   centralizeaza verificarea pentru toate RPC-urile si politicile noi.
   Nu se insereaza drepturi in migrare.
3. UI-ul actual din `TabSantiere.jsx` scrie direct status si citiri. Un trigger
   INVOKER blocheaza modificarea directa a executiei si DML-ul jurnalului
   pentru authenticated, inclusiv owner-ul din aplicatie. RPC-ul ruleaza ca
   proprietarul functiei, cu verificare de drept in corpul dispatcherului.
   Nu exista un GUC de bypass pe care clientul sa il poata seta.
   Politicile restrictive limiteaza politicile legacy permisive.
   ACL-urile legacy nu sunt rescrise: triggerul elimina dreptul EFECTIV de
   scriere directa in jurnal, inclusiv prin granturi legacy pe coloane.
   Preflight cere RLS activ si SELECT authenticated deja existente pe cele
   doua tabele legacy; rollback-ul nu le modifica ACL/RLS.
4. Cele patru RPC folosesc acelasi lock tranzactional global. Alegere deliberata
   pentru corectitudine: serializeaza contorul intre probe si retry-urile.
   Un utilaj nu poate fi activ simultan in doua probe. Inlocuirea pastreaza
   intervalul vechi si legatura catre intervalul nou, in aceeasi tranzactie.
   Acelasi utilaj poate reveni ulterior, printr-un nou interval de inlocuire.
5. `now()` este singura sursa de timp. Citirea periodica este refuzata sub
   6 ore; 6 si 8 ore sunt acceptate, peste 8 ore este acceptata si marcata.
   Pornirea, oprirea pentru defect si inchiderea nu au pragul de 6 ore.
   Daca o tranzactie veche asteapta lock-ul si timpul ei precede ultima
   citire a utilajului, primeste `pt_timp` si trebuie reincercata.
6. Ultima ora de bord se cauta in toate intervalele si citirile, nu dupa
   ultimul id. Pana la prima citire se foloseste contorul din catalog ca
   reper, fara inventarea unui timestamp. Scaderea nu poate fi confirmata.
   Saltul peste 24h sau peste `2 * timp_real + 4h` cere confirmare SI motiv.
   Confirmarile sunt pastrate in registrul operatiilor.
7. Formatul unui utilaj JSON este
   `{"active_id":1,"rol":"compresor","ore_bord":100,"poza_path":"cale"}`.
   `rol` este necesar doar la pornire/inlocuitor. Pornirea, inlocuitorul si
   inchiderea accepta in acel obiect `confirma_salt` si `motiv_salt`.
   Citirea are si confirmarea globala din semnatura ceruta. Oprirea adauga
   la final `p_confirma_salt DEFAULT false, p_motiv_salt DEFAULT NULL`;
   apelul cerut cu opt argumente ramane valid.
8. Cheia este globala celor patru RPC. Se compara actiunea, proba, autorul
   si payload-ul JSONB complet; nu un hash cu posibile coliziuni. Retry-ul
   intoarce exact rezultatul salvat INAINTE de verificarea statusului si a
   ferestrei de citire. Alta cerere cu aceeasi cheie primeste
   `pt_cheie_conflict`. Dreptul de scriere se reverifica inclusiv la retry.
9. Fiecare poza este verificata in `storage.objects`, bucket `probe-citiri`,
   sub `teren/<calc_id>/`, cu rezervare unica pe proba/cale pentru un eveniment.
   Lockul pe obiect dureaza pana la commit. Inchiderea reverifica toate pozele
   istorice si toate intervalele, nu doar payload-ul final. Citirea si
   inchiderea cer exact lista utilajelor inca active. Lista finala poate fi
   goala daca toate au fost oprite anterior cu ore si poze.
10. Raportul agregheaza separat intervalele si citirile, fara multiplicare
    prin JOIN. Orele sunt suma diferentelor de contor pe intervale inchise;
    litrii sunt ore x norma curenta din catalog, NULL daca norma lipseste.
    Durata probei ramane NULL pana la inchidere, inclusiv daca utilajele sunt
    deja oprite. Defectele sunt
    numarate distinct pe utilaj, cu numarul opririlor si in JSON-ul utilajului.
    Debitul este indicativ pentru aer: V x crestere presiune / 1.01325 bar /
    intervalul primei/ultimei citiri de presiune in minute, fara corectie termica. Este NULL la apa,
    scadere de presiune sau durata nula. Nu reprezinta debitul certificat
    al compresorului. Alimentarile sunt comparatie orientativa agregata pe
    proba, fara atribuire pe utilaj si fara modificari de stoc.
    Helperul de citire `probe_teren_norma` expune strict norma utilajelor deja
    folosite in probe, dupa verificarea dreptului de citire. Astfel view-ul
    invoker functioneaza si fara SELECT/acces la Logistica; fixture-ul retrage
    tocmai acel SELECT. Nu se largesc ACL/politicile pe `logistica_active`.

## Verificari efectiv executate

- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261114a_probe_teren.sql`:
  PASS in Runda 2, 47 instructiuni de nivel superior.
- `bash -n scripts/test_probe_teren.sh`: PASS.
- Tokenizerul validatorului pe migrare si rollback: PASS lexical, fara
  control tranzactional la nivel superior; parantezele de nivel superior
  sunt echilibrate. Aceasta NU este compilare SQL/PLpgSQL.
- Verificare octeti pentru toate artefactele noi: ASCII, fara CR, terminare LF.
- `node --check`: nu se aplica, nu exista JavaScript nou.

NU am rulat PostgreSQL, SQL-ul, concurenta, runnerul cu BD sau rollback-ul.
Nu exista validare pe schema/API reale. Nu am rulat browser, build UI sau
teste UI, deoarece etapa nu contine UI. Nu declar harness-ul trecut.
Operatorul ruleaza ulterior `bash scripts/test_probe_teren.sh` pe PG17 local.

Harness-ul pregatit verifica: acces lipsa/viewer/admin explicit/owner/uid NULL,
toate tranzitiile de status, beneficiar gazpet/tert invalid, poze lipsa sau
in alt bucket, contor descrescator intre probe, ambele praguri de salt,
confirmare fara motiv, confirmare valida in toate operatiile, limitele 6/8h,
intarziere, inlocuire atomica, revenirea aceluiasi utilaj, disparitia unei poze
istorice, inchidere fara toate utilajele, jurnal append-only, retry si conflict
pentru fiecare RPC, agregatele raportului, concurenta intre doua sesiuni,
preflight pe nume/semnaturi/coloane, rollback cu si fara date operative.

## Limite si riscuri de verificat inainte de aplicare

- Schema completa a `probe_calcule`/`probe_log_executie` nu apare in migrarile
  versionate consultate; fixture-ul este reconstruit din brief si UI.
  Trebuie verificata compatibilitatea cu schema reala, inclusiv tipurile,
  politicile legacy si fluxul Ofertare prin PostgREST cu INSERT ... RETURNING.
- `storage.objects` este SIMULAT in fixture prin `(bucket_id, name)`.
  Acesta nu reproduce RLS/ownership-ul storage Supabase, autorizarea uploadului
  sau continutul fotografiei. Nu am modificat politici storage. In mediul
  real trebuie verificat ca proprietarul RPC are SELECT si dreptul necesar
  lockului pe storage.objects. Existenta nu dovedeste lizibilitatea orei din
  poza, iar poza poate fi stearsa ulterior dupa inchidere prin alte fluxuri.
- Referintele contract/comanda sunt validate structural, nu existential,
  deoarece sursele canonice nu sunt identificate in brief/repo-ul consultat.
- Norma de consum este cea curenta, nu un snapshot istoric. Modificarea normei
  poate schimba ulterior estimarea din view. Contorul catalogului nu este
  actualizat de aceasta etapa si nu se atinge stocul.
- Lockul global este conservator si reduce paralelismul; de revazut numai
  daca volumul de scrieri o cere. Erorile business au prefixe stabile `pt_*`.
- Dupa aplicare, vechile actiuni UI de pornire/citire/finalizare directa vor
  fi refuzate. Etapa 2 trebuie sa apeleze RPC-urile; etapa 1 nu trebuie
  aplicata separat fara a tine cont de aceasta dependenta operationala.

## FISA DE SECURITATE a-e

a. Continut extern: poze, observatii, motive si nume introduse de mecanici.
   Sunt date, nu instructiuni. SQL-ul nu interpreteaza acest continut;
   validarea drepturilor, starii, contoarelor si obiectelor foto este server-side.
b. Scrieri: `probe_calcule`, `probe_exec_utilaje`, `probe_log_executie`,
   `probe_log_utilaje`, `probe_teren_operatii`. Nicio scriere in alimentari,
   stoc, drepturi de acces, salarii sau sisteme externe.
c. Cele patru RPC si helper-ele de date folosesc SECURITY DEFINER cu
   `search_path=public,pg_temp`. Triggerul de protectie este intentionat
   INVOKER. Dispatcherul verifica dreptul in corp; helper-ele de scriere nu
   sunt apelabile de authenticated. Helper-ele de citire au verificare proprie.
   EXECUTE public/anon/service_role este retras.
   Fara chei sau folosire de service_role.
d. Le porneste un utilizator autentificat cu drept explicit de scriere
   `probe_teren` sau owner. Granturile de modul se acorda ulterior de Razvan,
   nu prin aceasta migrare. Rolul global nu este suficient.
e. Salturile mari cer confirmare explicita si motiv, pastrate in audit.
   Inchiderea este apelul explicit cu rezultat `admis/respins`; serverul
   verifica dovezile si statusul. Confirmarea vizuala umana a inchiderii
   apartine etapei 2; semnatura ceruta nu are un boolean separat de confirmare
   si serverul nu poate demonstra ca un om a apasat un buton.

## Runda 2

Cele 6 fisiere din `probe_base` au fost copiate initial la aceleasi cai relative.
Modificarile de mai jos sunt numai in aceasta livrare NEAPLICATA.

| Punct | Schimbare | Scenariul SQL pregatit |
| --- | --- | --- |
| P1-1 | Eliminata exceptia adminului `probe`; executie/raport numai owner sau acces explicit `probe_teren`. Registrul idempotentei are RLS fara politica de citire pentru clienti. | Admin `probe` nu vede calcule operative, intervale, raport sau payload-uri si nu poate porni. Editorul vede terenul, dar nu payload-urile. |
| P1-2 | `probe_teren_poza(calc_id,path,cheie)` cere prefixul probei si rezerva calea in tabelul privat `probe_teren_poze`, PK `(calc_id,poza_path)`. Retry-ul returneaza rezultatul inaintea rezervarii. Inchiderea verifica prefixul, obiectul si asocierea pentru fiecare dovada istorica. | Poza altei probe refuzata; aceeasi poza la doua utilaje refuzata atomic; reutilizarea la oprire/manometru final refuzata; retry cu acelasi payload reuseste. Disparitia dovezii istorice continua sa refuze inchiderea. |
| P1-3 | INSERT preliminar fara beneficiar permis, inclusiv pe ramura RLS Ofertare pentru SELECT/INSERT. CHECK-urile raman; RPC cere beneficiar inainte de pornire. | Ca `authenticated` cu Ofertare, fara teren: INSERT calcul cu RETURNING, apoi oferta. Editorul teren nu poate porni calculul incomplet; completeaza beneficiarul si apoi porneste. |
| P2-4 | Existenta ofertei se valideaza prin helper SECURITY DEFINER cu search_path fix, rezultat boolean si verificarea dreptului teren. Triggerul il apeleaza numai la INSERT sau schimbarea beneficiarului/referintei. | Fixture cu RLS pe oferte prin `fn_are_acces_ofertare()`: editorul teren vede zero oferte, dar poate lega oferta existenta; oferta inexistenta este refuzata. UPDATE documentar reuseste chiar dupa eliminarea ofertei numai in fixture. |
| P2-5 | Durata persistata si cea din raport sunt pornire server - inchidere server. Ultima oprire utilaj ramane coloana separata; orele din contoare raman in JSON. Debitul foloseste valorile si timpii primei/ultimei citiri de presiune. | Pornire 08, utilaj oprit 10, inchidere 16 cu lista goala: 8h proba, 2h utilaj, debit pe 480 minute. Deplasarea numai a citirii initiale verifica separat intervalul de 420 minute, cu durata probei tot 8h. |
| P2-6 | Documentare permisa direct: `pv_path`, `pv_generat_la`, `aep_diagrama_path`, `observatii`, `updated_at`. Sunt protejate toate campurile de executie enumerate in brief, inclusiv temperatura, configuratie reala, operator si responsabil; beneficiarul este blocat dupa pornire. | UPDATE documente dupa pornire reuseste si persista referintele; UPDATE status/temperatura/configuratie/operator/responsabil si schimbarea beneficiarului sunt refuzate. |
| P2-7 | `litri_fise_bazin_comparatie` si `fise_bazin_mentiune` in raport. Helper cu drept verificat citeste suma pentru utilajele distincte din proba in fereastra acesteia; nu cere acces Logistica si nu repartizeaza pe utilaj. | Limite inclusive, alimentari externe ferestrei si alte utilaje excluse; intervalele repetate nu multiplica suma; fara modul helperul nu expune comparatia. Varianta DATE este verificata separat pe zile locale. |

Rollback-ul include registrul foto si helper-ele noi, refuza si o rezervare
foto izolata. Harness-ul shell include preflight pentru noile obiecte si
poze separate pe eveniment/proba in testul de concurenta.

Verificari executate in Runda 2:

- Validatorul oficial pe migrare: PASS, 47 instructiuni de nivel superior.
- `bash -n scripts/test_probe_teren.sh`: PASS.
- Tokenizarea migrarii si rollback-ului: PASS lexical; nu este compilare SQL.
- Cele 6 artefacte: ASCII, LF, fara BOM.

NU am rulat PostgreSQL, harness-ul SQL, concurenta, runnerul cu BD sau
rollback-ul. NU am rulat browser, API real ori teste UI. Nu declar scenariile
SQL trecute. Nu am rulat Git/commit/push, citit secrete, accesat BD sau facut
deploy. Nu am modificat UI sau fisierele interzise.

Ce ramane pentru DRY, executat ulterior de operator:

- Schema si ACL-urile legacy complete, RLS real si fluxul Ofertare prin
  PostgREST, inclusiv calculul preliminar cu `.select('id').single()`.
- Storage real: permisiunile proprietarului RPC pentru SELECT/lock si
  politicile de upload/stergere. Lockul foto protejeaza pana la commit;
  nu garanteaza pastrarea sau integritatea imaginii dupa inchidere.
- Tipul real `logistica_alimentari.data_alimentare`. UI introduce o data,
  fara ora. Pentru DATE, helperul compara zile locale Europe/Bucharest;
  fereastra orara exacta nu poate fi reconstituita dintr-o data. Pentru
  timestamp foloseste intervalul exact. Fixture-ul acopera ambele variante.
  Comparatia este orientativa, cu eticheta TKT-2026-0358, nu consum certificat.
- Fluxul existent de finalizare din `TabSantiere.jsx` trimite documente si
  executie in acelasi UPDATE. Documentarea separata este permisa; apelul
  mixt ramane refuzat deoarece modifica executia. Adaptarea UI la RPC si
  salvarea separata a documentelor apartin etapei 2, fara modificari aici.

Fisa de securitate a-e ramane aplicabila. Scrierile operative includ acum
si registrul foto privat; helper-ele noi nu expun date comerciale sau
alimentari individuale. Nu se acorda acces de modul prin aceasta migrare.

## Runda 3

Baza actualizata (toate cele 6 fisiere) a fost copiata din `probe_base`
inaintea modificarilor. Migrarea ramane NEAPLICATA; nu este o migrare deja
aplicata rescrisa. Nu am modificat UI sau fisierele interzise.

| Punct | Schimbare | Test pregatit |
| --- | --- | --- |
| P1 Ofertare | Politicile SELECT permisiva si restrictiva permit accesul Ofertare la un calcul legat prin `probe_oferte.calc_id`, indiferent de beneficiar/status. INSERT/UPDATE nu sunt largite. Exceptia priveste numai `probe_calcule`; raportul, intervalele, jurnalele si registrele raman protejate. | Comercial fara teren creeaza calcul + oferta, editorul completeaza beneficiarul si porneste/inchide. Comercialul vede calculul dupa fiecare tranzitie; nu vede jurnal, raport, intervale, registru de operatii sau foto. Calculul nelegat cu beneficiar ramane invizibil; calculul cu proiect/backfill devine vizibil prin oferta. UPDATE comercial nu modifica randuri; INSERT cu beneficiar este refuzat. |
| P2-6 executie | RPC nou `fn_probe_completeaza_executie(bigint,bigint,numeric,text,text,text,timestamptz,text,text)`, SECURITY DEFINER cu search_path fix. Foloseste dispatcherul privat: drept explicit editor/admin `probe_teren` sau owner, lock comun, proba existenta, payload/autor/cheie verificate in registrul comun. Completeaza configuratia reala, temperatura, operatorul, responsabilul si PV/AEP fara schimbarea statusului, inclusiv dupa inchidere. Triggerul ramane strict. | Completare planificata/finalizata, toate campurile persistate, retry identic fara dublare, conflict continut/autor/actiune, cheie goala, proba inexistenta, configuratie inexistenta fara operatie reziduala. Viewer/comercial/admin `probe` refuzati; owner acceptat. INSERT/UPDATE direct al campurilor de executie refuzat. Preflight, ACL anon/service_role si refuz rollback dupa completare incluse. |
| P2-7 bazin | Helperul sumeaza numai `rezervor_id IS NOT NULL`. Eticheta explica excluderea statiilor externe; nu adaugam o a doua coloana. | Surse mixte in aceeasi fereastra: 40+60 litri bazin, 700 statie externa => comparatie 100. Intervalele repetate: 17 bazin + 900 statie => 17. Se pastreaza verificarea separata pentru sursa DATE. |
| P3 poze | Forma exacta `teren/<calc_id>/<nume fara slash>`, fara nume `.`/`..`, backslash sau caractere de control. Subdirectoarele si slash-urile repetate sunt respinse. Toate pozele valide din fixture au nume plate. | Obiecte necanonice existente in storage simulat: prefix apropiat 110 pentru proba 11, traversare `../2`, slash dublu, punct/punct-punct, subdirector, nume gol, backslash si newline; toate refuzate prin RPC fara pornire. |

Contractul completarii: fiecare argument este valoarea finala dorita;
NULL goleste explicit campul, nu inseamna "pastreaza valoarea veche".
Configuratia este validata de FK; temperatura nefinita este refuzata.
Inregistrarea actiunii `completeaza_executie` in registrul existent permite
rollback-ului sa refuze si o completare fara citiri sau intervale operative.

`TabSantiere.jsx` vechi ramane blocat la UPDATE-ul mixt care trimite status,
configuratie reala, temperatura, operator/responsabil si PV/AEP. UI-ul etapei 2
va apela RPC-ul nou pentru completare si RPC-urile de workflow pentru status.
Conform brief-ului, fluxul vechi nu a fost folosit: 5 calcule, toate
planificata. Aceasta este informatie furnizata, nu o constatare verificata
prin acces la date reale.

Verificari executate in Runda 3:

- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261114a_probe_teren.sql`: PASS, 48 instructiuni.
- `bash -n scripts/test_probe_teren.sh`: PASS.
- Tokenizare oficiala: migrare 48, rollback 30 instructiuni; PASS lexical, fara compilare SQL.
- Cele 6 artefacte: ASCII, LF, fara BOM.

Python si Bash au fost apelate prin caile locale explicite deoarece nu sunt
in PATH. Nu am rulat Postgres, harness-ul SQL, concurenta, runnerul cu BD,
rollback-ul, PostgREST real sau browser. Scenariile SQL sunt pregatite,
NU declarate trecute. Validarea pe schema/ACL reale si Storage real ramane
necesara la verificarea ulterioara de catre Claude; nicio conexiune BD aici.

Fisa de securitate a-e ramane aplicabila: continutul extern este doar date;
completarea scrie `probe_calcule` si registrul privat, autorizata server-side,
fara acordarea de drepturi noi utilizatorilor. Nu am rulat Git, commit, push,
citit credentiale sau facut deploy. Restrictia explicita "No Git commit"
de la inceputul cererii are prioritate fata de finalul brief-ului.

## Runda 4

Primul pas a fost copierea tuturor celor 6 fisiere din baza actualizata
`probe_base`, la aceleasi cai. Migrarea ramane NEAPLICATA.

- P1: `probe_teren_oferta_guard`, trigger BEFORE INSERT OR UPDATE OF calc_id
  pe `probe_oferte`, SECURITY INVOKER si search_path fix. La legare/schimbare
  verifica existenta calculului prin SELECT cu RLS-ul invokerului, inainte
  ca legatura noua sa existe. Nu introduce bypass comercial. NULL si
  calc_id neschimbat sunt permise. Owner foloseste dreptul existent de
  citire; postgres (proprietar) si service_role (BYPASSRLS) pastreaza
  comportamentul normal, cu privilegiile SQL existente. Functia trigger
  nu este expusa ca RPC. ACL, preflight si rollback includ obiectele noi.
- Teste P1 in `scripts/test_probe_teren.sql`: comercial cu rol authenticated
  si claims proprii incearca INSERT oferta pe calculul invizibil 900 si
  UPDATE calc_id al ofertei 30 catre 900. Ambele cer eroarea pt_oferta_calc;
  dupa fiecare refuz, calculul ramane invizibil, fara oferta reziduala sau
  alterarea legaturii vechi. Pozitive: insert calc + oferta ca in Ofertare,
  UPDATE catre calcul vizibil, dezlegare, salvare calc_id neschimbat,
  legare postgres si owner; fluxul preliminar -> beneficiar -> pornire ->
  inchidere ramane in harness. Fixture-ul reproduce acum si politica/GRANT
  UPDATE pentru oferte, astfel incat testul negativ ajunge la trigger.
- P2-7: `v_probe_raport` adauga `litri_statii_externe_orientativ` si
  `statii_externe_mentiune`: "alimentari din statii externe (orientativ)".
  Helperul `probe_teren_statii_externe` sumeaza numai rezervor_id IS NULL,
  pe utilajele probei in fereastra probei, fara multiplicare la intervale
  repetate. Ramane protejat de dreptul probe_teren; nu expune alimentari
  individuale si nu necesita SELECT Logistica pentru mecanic. Aceleasi
  limite inclusive si zile locale Europe/Bucharest pentru sursa DATE.
  Teste pregatite: bazin 40+60=100 si extern 700 in coloane distincte;
  extern 900 fara multiplicare, sursa DATE si helper inaccesibil fara modul.
  Preflight, ACL, rollback si verificarea curatarii includ helperul nou.

Decizie de compatibilitate pentru observatia optionala: pastram SELECT
pe intregul rand `probe_calcule` legat de oferta, inclusiv coloanele de
executie si caile PV/AEP. Aceasta expunere este acceptata in varianta
livrata, conform alternativei din brief; nu inseamna aprobare suplimentara
de business. Jurnalele, intervalele, registrul foto si raportul de teren
nu devin accesibile comercialului. O vedere comerciala cu modificarea
consumatorilor existenti ar depasi remedierea punctuala fara UI.

Verificari executate:

- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261114a_probe_teren.sql`:
  PASS, 51 instructiuni (Python313 local).
- `bash -n scripts/test_probe_teren.sh`: PASS (Bash local).
- Cele 6 artefacte: ASCII, LF, fara BOM.

Nu am rulat Postgres, harness-ul SQL, testul cu service_role, concurenta,
runnerul cu BD, rollback-ul, PostgREST, Storage real sau browser.
Testele SQL sunt pregatite, nu declarate trecute; compilarea si comportamentul
pe schema/ACL reale raman de verificat de Claude. Nu am construit UI,
modificat fisierele interzise, rulat Git/commit/push, citit credentiale,
accesat BD sau facut deploy. Toate scrierile au fost in worktree.
