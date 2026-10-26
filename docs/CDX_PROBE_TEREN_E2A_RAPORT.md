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
6. EXACT trei citiri hidraulice: limita de inceput presurizare, o citire
   intermediara si finalul. A doua citire intermediara este refuzata cu
   `pt_hidraulic_numar`. Inchiderea verifica existenta exact a primelor
   doua, apoi scrie finalul atomic. Atat admis, cat si respins necesita
   presiunea finala si dovezile. Aceasta urmeaza cerinta EXACT 3; formularea
   "cel putin" din conditia de inchidere nu permite citiri suplimentare.
7. Se pastreaza lockul global comun, ora serverului, dreptul explicit,
   registrul de idempotenta cu payload/autor exacte si validarea foto E1.
   La final se reverifica si registrul foto, inclusiv dovezile optionale.
   Salturile mari cer confirmare si motiv; scaderea ramane interzisa.
   Corectie necesara: istoricul cu contor NULL de la o pompa nu mai ascunde
   ultima valoare masurata anterior pe acelasi utilaj.
8. Crearea rapida returneaza bigint (id calcul), este idempotenta in
   registrul comun si valideaza proiectul/tronsonul, inclusiv apartenenta.
   Gazpet cere proiect; tert poate exista fara proiect, dar necesita
   oferta/contract existent sau comanda text si client, conform E1.
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
