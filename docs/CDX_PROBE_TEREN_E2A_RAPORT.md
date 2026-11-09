# Probe de presiune pe teren - etapa 2a

Livrare NEAPLICATA. ASCII / LF. Fara UI, Git, commit, push, secrete,
conexiuni BD sau deploy. Restrictia initiala "No Git commit" prevaleaza
asupra frazei finale din brief. Toate scrierile sunt in worktree.

## Artefacte

- `supabase/migrations/20261115a_probe_teren_faze.sql`, versiune runner
  `20261115120000`: faze, creare rapida, extinderea writer-ului si raportului.
- `supabase/revenire/20261115a_probe_teren_faze_ROLLBACK.sql`: garda proprie,
  refuz pe date operative E2a, restaurarea functiilor/view-ului E1 si a
  constrangerilor initiale. Fara CASCADE sau stergere de date operative.
- `scripts/test_probe_teren.sql` / `.sh`: pastreaza scenariile E1 si adauga
  rularea E2a pe clona locala, prin runnerul oficial. Include concurenta
  in doua sesiuni si rollback pe clone separate.
- `scripts/test_probe_teren_faze.sql`: scenarii E2a, toate anulate la final.
- `scripts/test_probe_teren_fixture.sql`: adauga schema tronsoanelor si
  coloanele comerciale folosite de UI; simuleaza patru NOT NULL cu default.
  Ramane fixture reconstruit, nu schema extrasa din productie.

Migrarile E1 aplicate nu au fost modificate. Fisierele UI interzise si
`logistica_active` nu au fost modificate. Nu se acorda drepturi de modul.

## Comportament si decizii

1. Pornirile noi folosesc pistonare/uscare/calibrare/proba pentru aer si
   umplere/presurizare pentru apa. RPC-ul permite numai urmatoarea faza;
   CHECK-uri si trigger verifica asocierea fazei cu tipul si intervalele.
   Tipul fluidului este blocat dupa pornire. Faza si marcajul de creare
   din teren nu pot fi scrise direct de client.
2. Nu exista backfill pentru faze. Cele cinci calcule mentionate in brief
   primesc faza NULL si marcaj false, fara UPDATE al randurilor existente.
   Nu am verificat numarul/starea lor prin acces la BD. Pentru executiile
   E1 deja pornite, cu faza NULL, writer-ul privat E1 pastreaza fluxul vechi;
   nu se poate introduce retrospectiv o faza. Retry-ul unei operatii E1
   returneaza rezultatul initial, fara modificari. Completarea documentara
   continua sa foloseasca implementarea E1.
3. Aer: cinci limite cu manometru si lista exacta a utilajelor active,
   fiecare cu ore si poza. Limita comuna este salvata o singura data,
   etichetata cu faza noua. Inchiderea este limita finala a fazei curente.
   Admis este permis numai din proba; respins din orice faza. Utilajele
   oprite anterior isi pastreaza dovezile de oprire, ca in E1.
4. Citirile suplimentare din pregatirea pneumatica sunt acceptate fara
   pragul de sase ore. In proba se pastreaza minimum 6h intre citiri si
   marcarea intarzierii peste 8h. Serverul nu genereaza automat citiri si
   nu inventeaza o durata minima a probei; notificarea operatorului vine
   cu UI-ul ulterior.
5. Apa: umplerea nu produce citire/manometru. Utilajele sunt optionale,
   orele/pozele lor nu sunt obligatorii. Valorile optionale trimise sunt
   validate; fara valori nu se inventeaza contoare. La citire/limita/final
   lista poate fi NULL, goala sau poate identifica utilaje active fara ore
   si poze. Inchiderea opreste si pompele omise din lista optionala.
   Nu se cere temperatura.
6. Hidraulic ADMIS: numai din presurizare, EXACT trei citiri (inceput,
   intermediara, final), toate cu poza manometrului. A doua intermediara
   este refuzata cu `pt_hidraulic_numar`. RESPINS este permis din orice
   faza, fara intermediara obligatorie. Din presurizare cere presiunea
   finala si poza; din umplere acestea sunt optionale, motivul este
   obligatoriu in observatii. Dovezile optionale trimise se valideaza.
7. Se pastreaza lockul global comun, ora serverului, dreptul explicit,
   registrul de idempotenta cu payload/autor exacte si validarea foto E1.
   La final se reverifica si registrul foto, inclusiv dovezile optionale.
   Salturile mari cer confirmare si motiv; scaderea ramane interzisa.
   Corectie necesara: istoricul cu contor NULL de la o pompa nu mai ascunde
   ultima valoare masurata anterior pe acelasi utilaj.
8. Crearea rapida returneaza bigint (id calcul), este idempotenta in
   registrul comun si valideaza proiectul/tronsonul, inclusiv apartenenta.
   Proiectul este obligatoriu pentru orice beneficiar. La minimum doua
   tronsoane se cere alegerea explicita; la unul se completeaza automat,
   la zero ramane NULL. Tert necesita suplimentar oferta/contract existent
   sau comanda text si client, conform E1.
   dn/lungime/presiune/config sunt NULL explicit, status planificata,
   creat_din_teren true si autorul curent.
9. Schema completa `probe_calcule` nu exista in migrarile versionate citite;
   aceeasi limita este documentata in raportul E1. Numele coloanelor sunt
   confirmate din inserturile `src/Ofertare.jsx` si `src/TabSantiere.jsx`;
   relatia tronson-proiect este folosita deja in TabSantiere. Preflight
   cere coloanele cunoscute si refuza alte coloane obligatorii fara default.
   Numai NOT NULL-urile campurilor comerciale din lista explicita pot fi
   relaxate. Un CHECK conditional le mentine obligatorii pentru calculele
   care NU sunt create din teren. Metadatele DDL initiale sunt salvate
   intr-un tabel privat cu RLS fara acces client, pentru rollback exact.
   Nu sunt eliminate FK-uri sau alte CHECK-uri comerciale.
10. `v_probe_raport` pastreaza coloanele E1 si adauga `faza_curenta`, `faze`
    si `citiri_hidraulice`. Fiecare element din faze contine inceput,
    sfarsit, durata_h si utilaje. Pentru aer, orele sunt diferente de
    contor intre limite si capetele intervalelor de utilaj; inlocuirea
    in mijlocul fazei nu dubleaza orele. Nu se repartizeaza proportional
    dupa timpul de ceas. Orele unui segment inca nedovedit sunt NULL.
    Litrii sunt ore x norma curenta, ca in E1. Pentru apa, lista utilajelor
    pe faza este goala si sunt expuse timpii/citirile. Estimarile nu scriu
    consum, stoc sau ore in Logistica.

## Verificari efectiv executate

- Python313, `python -X utf8 scripts/livrare_validator.py
  supabase/migrations/20261115a_probe_teren_faze.sql`: PASS, 24 instructiuni.
- `bash -n scripts/test_probe_teren.sh`: PASS, Bash local din Git.
- Tokenizarea migrare/rollback, paranteze si tag-uri dollar-quote unice:
  PASS lexical, 24 / 22 instructiuni. Fara BEGIN/COMMIT la nivel superior,
  fara backslash in cele doua artefacte SQL.
- Comparatie text: writer-ul privat E1 este identic cu originalul;
  rollback-ul restaureaza corpurile originale writer/protectie/bord si
  definitia originala a view-ului.
- Artefactele modificate: ASCII, LF, fara BOM.

NU am rulat PostgreSQL, SQL-ul de test, runnerul cu BD, concurenta,
rollback-ul efectiv, PostgREST, Storage real sau browser. Nu declar
compilarea SQL/PLpgSQL ori scenariile SQL trecute. Nu exista UI nou.

Operatorul poate rula ulterior `bash scripts/test_probe_teren.sh` pe PG17
izolat. Harness-ul pastreaza fixture-ul NOSUPERUSER, exclusiv localhost,
fara credentiale/configuratie libpq mostenite si cu artefacte in worktree.
Scenariile pregatite includ cele patru faze/cinci limite, lipsuri de dovezi,
tranzitii invalide, toate variantele respins, admis numai din proba,
periodicitatea, inlocuirea, raportul cu timpi/ore/litri, trei citiri hidraulice,
poza istorica disparuta, pompe fara contoare, creare rapida, tert, drepturi,
retry/conflict, executie E1 deja pornita, fingerprint pe TOATE calculele,
preflight, concurenta reala si rollback cu/fara date E2a.

Inainte de aplicare, Claude trebuie sa verifice schema/ACL reale si fluxul
Ofertare prin API, inclusiv INSERT RETURNING. Fixture-ul nu dovedeste
compatibilitatea cu alte constrangeri comerciale nevizibile in repo sau
cu politicile Storage reale. Exista verificare server-side a existentei
pozei, nu a lizibilitatii contorului fotografiat. Norma ramane cea curenta.

## FISA DE SECURITATE a-e

a. Continut extern: poze, observatii, motive si alte texte ale operatorilor.
   Sunt date, nu autoritate. Nu sunt executate. Tipul, drepturile, faza,
   contoarele, referintele si caile foto sunt validate server-side.
b. Scrieri operative numai in `probe_*`: calcule, jurnale, intervale,
   operatii si registrul foto. Metadatele de rollback sunt tot in probe_*.
   Nicio scriere in logistica_active, alimentari, stoc sau acces utilizatori.
c. RPC-uri SECURITY DEFINER cu search_path public/pg_temp si verificarea
   dreptului in corpul writer-ului sau al functiei de creare. Helper-ele
   private si trigger-ele nu sunt expuse clientilor. Fara service_role,
   chei, credentiale sau GUC client care sa autorizeze scrierea.
d. Utilizatori autentificati cu drept explicit editor/admin probe_teren
   sau owner. Viewer-ul si rolurile globale nu acorda scriere. Nu se
   modifica user_module_access, roluri sau is_owner.
e. Saltul mare de ore necesita confirmare explicita si motiv, auditate.
   Inchiderea necesita apel explicit cu rezultat admis/respins si dovezi
   complete. Semnatura existenta nu are boolean separat de confirmare;
   confirmarea vizuala umana apartine UI-ului E2b. Serverul nu poate
   demonstra prin aceasta semnatura ca un om a apasat un buton.

## Runda 2

Baza: cele 7 fisiere din `C:/Users/Public/paw-data/brief/probe_base/`
au fost copiate prima data in worktree, la aceleasi cai relative.
Migrarea E2a este neaplicata; migrarea E1 live ramane nemodificata.

- P1-1: `probe_teren_scrie` separa admis de respins la hidraulic.
  Respingerea din umplere nu inventeaza citiri sau presiune; motivul
  ramane in operatia auditata. Inchide pompele active. Dovezile optionale
  sunt validate si salvate daca sunt trimise. Din presurizare respins
  cere poza/presiune finala, fara intermediara. Admis pastreaza traseul
  strict cu exact trei citiri.
- P1-2: `fn_probe_creeaza_teren` cere proiect inclusiv la tert. Foloseste
  `public.executie_tronsoane(proiect_id)`, relatia utilizata in repo de
  `TabSantiere.jsx` si de fixture-urile SQL. Zero tronsoane permite NULL;
  unul este completat automat; minimum doua cer selectie. Apartenenta
  se verifica si pentru tronsonul completat automat. Payload-ul de retry
  pastreaza cererea originala (tronson NULL), separat de valoarea salvata.
  Schema live nu a fost interogata.
- P2-1: marcarea intarzierii pneumatice include `citire` si `inchide`.
  Scenariul nou ajunge in proba, deplaseaza numai in fixture ultimele
  citiri la 24h in urma si inchide admis fara intermediara. Verifica
  raspunsul, jurnalul si raportul cu exact o citire intarziata.
- P2-2: `test_probe_teren_faze.sql` include noul fisier
  `scripts/test_probe_teren_e1_compat.sql` dupa aplicarea E2a. Harness-ul
  cere si markerul PASS al compatibilitatii, pe langa markerul E2a.
  Testeaza Ofertare ca utilizator comercial fara drept teren:
  INSERT RETURNING calcul, apoi oferta, pornire si completare refuzate.
  Proba aer 880 este creata si pornita prin RPC E1 inainte de migrare;
  dupa migrare verifica citire, oprire cu inlocuitor, inchidere admis,
  completare inainte/dupa inchidere si pastrarea fazelor NULL.
  Suita E1 integrala ramane executata inainte de E2a; dupa E2a se ruleaza
  compatibilitatea explicita de mai sus, nu intreaga suita nemodificata
  (pornirile noi ar intra legitim in fazele E2a).
- Owner: preflight refuza daca writer-ul existent nu apartine rolului
  care creeaza functia noua. CREATE OR REPLACE pastreaza owner-ul vechi;
  CREATE il foloseste pe cel curent. Testul compara ownerii functiilor
  creare/writer. Ei trebuie sa ramana identici si dupa livrare, deoarece
  triggerul permite creat_din_teren numai owner-ului writer-ului.

Regresii SQL pregatite: respins umplere fara dovezi, motiv lipsa refuzat,
dovezi optionale invalide refuzate/valide pastrate, respins imediat in
presurizare fara intermediara, poza/presiune finala lipsa refuzate acolo,
admis fara intermediara refuzat, admis cu trei citiri acceptat; tert fara
proiect refuzat, proiect cu 0/1/2 tronsoane, selectie explicita, tronson
strain refuzat si retry dupa completarea automata. Toate sunt anulate
impreuna cu tranzactia suitei E2a.

Verificari executate pentru Runda 2:

- Python 3.13, `python -X utf8 scripts/livrare_validator.py
  supabase/migrations/20261115a_probe_teren_faze.sql`: PASS, 24 instructiuni.
- `bash -n scripts/test_probe_teren.sh`: PASS, Bash local din Git.
- Verificare artefacte ASCII / LF / fara BOM si comparare cu baza copiata.

NU am rulat PostgreSQL, harness-ul cu BD, testele SQL, concurenta,
rollback efectiv, PostgREST, Storage real sau browser. Restrictia de a nu
accesa BD a fost respectata; verificarile statice nu dovedesc executia
PL/pgSQL. Nu am executat Git, commit, push, deploy sau acces la secrete.
Rollback-ul si fixture-ul copiate sunt neschimbate fata de baza furnizata.
Fisa de securitate a-e de mai sus ramane aplicabila.
