# Probe presiune pe teren - E2b UI

Livrare exclusiv in worktree. Fara Git/commit/push, credentiale, acces BD,
deploy sau date reale. Interdictia initiala de commit prevaleaza asupra
ultimei linii din brief. Fara modificari SQL sau fisiere UI interzise.

## Fisiere si deschidere

- `src/ProbeTerenMobil.jsx`: ecran mobil, stil inline din mockup-ul hidraulic,
  pregatire in pasi, pornire, faze, citiri, oprire/inlocuire, inchidere si raport.
- `src/probeTerenLogica.js`: faze, program citiri, lipsuri, erori, payload-uri,
  confirmarea saltului si formularul initial fara reutilizarea dovezilor vechi.
- `src/probeTerenLogica.test.js`: 15 teste pure si verificarea semnaturilor SQL.
- `src/AppMobilManageri.jsx`: import, verificare drept, buton sub cele patru
  existente si sectiunea noua. Restul fluxului mobil este pastrat.

Deschidere: autentificare -> `/m` -> `Probe presiune`. Alege lucrarea,
tronsonul numai la minimum doua tronsoane, tipul si beneficiarul.
Executiile active se pot relua dupa alegerea lucrarii/tronsonului.
Planificatele compatibile cu tipul si beneficiarul sunt oferite inainte
de creare; pentru tert se compara si referinta/clientul.

`probe_teren_drept(p_scriere: true)` este RPC apelabil: migrarea E1,
blocul `pt_acl_20261114a`, acorda EXECUTE rolului authenticated.
Nu exista fallback pe rol global. Raspuns fals/eroare ascunde butonul.
Ecranul reverifica dreptul la deschidere. SQL verifica din nou fiecare scriere.

## Contracte folosite

| Actiune UI | Functie / sursa |
| --- | --- |
| Vizibilitate si acces | `probe_teren_drept(true)` |
| Creare proba noua | `fn_probe_creeaza_teren` |
| Pornire | `fn_probe_porneste` |
| Trec la faza urmatoare | `fn_probe_schimba_faza` |
| Citire la 6h / hidraulic la jumatate | `fn_probe_citire` |
| Oprire, optional cu inlocuitor atomic | `fn_probe_opreste_utilaj` |
| Confirm inchiderea Admis/Respins | `fn_probe_inchide` |
| Rezumat dupa inchidere | SELECT `v_probe_raport` |

Nu se apeleaza `fn_probe_completeaza_executie`: nu se editeaza metadatele
documentare in aceasta etapa. Nu se golesc accidental campurile sale NULL.
Selectii read-only: `executie_proiecte`, `executie_tronsoane`, `probe_calcule`,
`probe_oferte` (nr_oferta, client), `contracte_terti`, `logistica_active`.
Reincarcare: `probe_exec_utilaje`, `probe_log_executie`, `v_probe_raport`.
Fara relatii PostgREST presupuse sau query-uri noi in alte ecrane.

Aer: pistonare/uscare/calibrare/proba; manometru si contoare fotografiate
la limite si citiri. Un pas separat pentru fiecare utilaj. Citiri periodice
afisate numai in proba, urmatoarea la 6h, intarziere strict peste 8h.
Apa: umplere/presurizare; fara contoare sau poze pentru pompe; fara citire
la pornire. Inceput presurizare, o intermediara, final. Intermediara se
propune orientativ la 3h de la inceputul presurizarii. Admis cu lipsuri
primeste refuzul tradus al serverului. Respins cere motiv in UI in orice faza.

Upload JPEG comprimat la maximum 1600px, bucket `probe-citiri`, cale
`teren/<calc_id>/<UUID>.jpg`, fara upsert. Retry pastreaza fisierul/calea;
la raspuns pierdut se verifica obiectul prin download autentificat.
Nu se reutilizeaza pozele unei citiri la alta citire. Fisierele abandonate
nu sunt sterse automat.

Operatiile se pastreaza in sessionStorage separat pe utilizator, inainte
de trimitere, cu UUID si payload exact. Reteaua incerta blocheaza alta
actiune pana la retry. Recuperarea functioneaza inclusiv dupa reload in
aceeasi fila. Refuz SQL explicit permite corectarea. `pt_bord_salt` pastreaza
cheia si dovezile; dialogul arata contoarele, cere motiv si confirma explicit
toate utilajele din operatia afisata. Refuzul nu a comis operatia SQL.
Un succes urmat de eroare la relectura nu retrimite scrierea.

## Verificari si limite

- PASS: `node --check src/probeTerenLogica.js`.
- PASS: 15/15 scenarii cu `node --test .tmp/probeTerenLogica.node.test.mjs`.
  Copie a testului Vitest cu numai importul runnerului schimbat in node:test
  si calea importului logicii ajustata; asertiuni native identice. Nu este
  declarat rezultat Vitest.
- Incercate `npx --no-install vitest run src/probeTerenLogica.test.js` si
  `npx --no-install vite build`: npm se opreste cu `uv_os_homedir ENOMEM`,
  inainte de rezolvarea configuratiei. Nici node_modules nu exista aici.
  Fara reinstalare. Build-ul React/JSX si Vitest raman de rulat de Claude.
- Fisierele noi UI/logica/test sunt ASCII. Cele cinci fisiere lipsa E2a
  copiate din baza au hash identic cu sursa: migrare, rollback, raport,
  `test_probe_teren_faze.sql`, `test_probe_teren_e1_compat.sql`.
- NU au fost testate API-ul real/PostgREST, RLS/ACL reale, Storage,
  browserul sau telefonul. Migrarea E2a trebuie aplicata separat inainte
  de folosire. Schema completa live nu este disponibila in acest mediu.

Limita de contract: nu exista RPC de adaugare separata a unui utilaj dupa
pornire. UI permite alegerea la pornire si inlocuirea atomica la oprire.
Adaugarea fara oprirea unui utilaj necesita o specificatie SQL separata;
nu este simulata prin INSERT direct sau prin alta pornire.

Executiile E1 deja pornite fara faze sunt afisate fara actiuni E2a.
Nu se acorda drepturi pe cataloage; listele respecta RLS existente.
Trebuie verificat ca mecanicul cu probe_teren poate citi proiectele,
utilajele si referintele comerciale necesare. Listele tert sunt doar cele
vizibile contului; se poate folosi comanda text daca nu exista referinta.

Cronometrul este orientativ: foloseste timpii salvati de server si ceasul
telefonului, recalibrat din `ora_server` dupa RPC. Nu trimite timpi si nu
blocheaza citirea dupa ceasul telefonului; pragul real este impus de SQL.
Nu exista notificari de fundal/offline queue. Formularele si fisierele
netrimise se pastreaza in memorie, nu peste inchiderea filei. Operatia deja
pregatita de trimitere se recupereaza din sessionStorage. Fara export/PV,
AEP sau sincronizare/scrieri in Logistica.

Pe telefon, cu mediu de test si E2a aplicata: verificati traseul aer complet
cu doua utilaje, 6h/8h, contoare descrescatoare/salt, inlocuire atomica,
hidraulic cu exact trei citiri si Respins din ambele faze, selectie 0/1/2
tronsoane, tert oferta/contract/comanda, refuz pentru viewer/fara drept,
upload camera/galerie/retea slaba, raspuns RPC pierdut + retry/reload,
dublu tap, concurenta cu alt operator si rezumatul dupa inchidere.

## FISA DE SECURITATE a-e

a. Poze, observatii si motive de la operatori sunt date, nu instructiuni.
React le afiseaza ca text. Contractele SQL valideaza drepturile, fazele,
presiunea, contoarele, referintele, existenta si unicitatea dovezilor.

b. Executia se scrie exclusiv prin RPC-urile `fn_probe_*` enumerate.
Singura alta scriere externa din UI este upload-ul dovezii in probe-citiri.
Fara insert/update/delete direct in tabele sau schimbari de schema.

c. Identitatea este utilizatorul autentificat al clientului Supabase
existent. Fara service_role, secrete sau identitate furnizata de operator.

d. Owner sau drept explicit editor/admin probe_teren, conform helperului
SQL; rolurile globale nu acorda scriere. Nicio modificare de acces.

e. Confirmare umana cu motiv pentru saltul de ore, dupa refuz server;
pas final explicit pentru inchidere, cu rezultat si motiv la respingere.
Semnaturile SQL nu pot demonstra singure apasarea umana a butonului.
