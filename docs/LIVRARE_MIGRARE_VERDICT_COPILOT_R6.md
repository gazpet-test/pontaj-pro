# Verdict Copilot pe runda 6 — runnerul comun (cd573c6) — 30.09.2026 ~04:30 RO

Text integral, primit prin canalul Copilot (conversația 2). Mesajul trimis: antet (DELTA + punctele r5 + abaterea de la punctul 1) + validatorul și runnerul integral (33.669 car.).

---

NO-GO pe cd573c6 ca standard comun de livrare

Abaterea propusă pentru standard_conforming_strings este acceptabilă ca direcție: un subset lexical explicit este preferabil unei liste de expresii fragile. Însă implementarea încă acceptă un caz în care psql poate executa un COMMIT ascuns validatorului.

Am executat local codul validatorului transmis, pe probele de mai jos. Nu am executat runnerul pe PostgreSQL; testele BD rămân dovezi raportate.

1. Ce consider închis din runda 5

Verificarea țintei în pre-verificare și reconciliere, READ COMMITTED explicit înaintea interogărilor, separarea numărătorilor relevante/exacte și rezultatul distinct pentru reluarea exactă răspund observațiilor precedente. Testele raportate discriminează scenariile cerute.

Copia unică aprobată, restricționarea argumentelor, lock-ul și testul erorii chiar la înregistrare rămân progrese valide. Nu cer refacerea arhitecturii.

2. Blocant: COPY FROM STDIN schimbă modul în care psql interpretează fișierul

Validatorul acceptă următorul fragment, introdus între gărzile normale ale unei migrări de test:

SQL
CREATE TABLE public.proba_livrare_copy(v text);
COPY public.proba_livrare_copy(v) FROM STDIN;
$date$
\.
COMMIT;
-- $date$

Acceptarea de către validator este reprodusă local. Problema este în modelul lexical: validatorul interpretează regiunea dintre $date$ drept literal dollar-quoted și nu vede \. sau COMMIT.

În fluxul psql, după COPY ... FROM STDIN, liniile sunt însă date COPY: $date$ este un rând de date, \. încheie intrarea, iar COMMIT este din nou comandă SQL. Garda finală nu poate anula un COMMIT anterior. Acesta este scenariul care trebuie verificat dinamic în harness-ul vostru, nu o execuție PostgreSQL pe care o pretind făcută aici.

Corecție minimă pentru acest standard: refuzați înainte de conexiune COPY FROM STDIN; pentru migrările actuale, refuzul tuturor instrucțiunilor COPY poate fi un subset simplu și sigur. Nu încercați să acoperiți formatul de date COPY cu tokenizerul SQL existent.

Test discriminatoriu: fragmentul de mai sus, cu gărzile și o tabelă fictivă, trebuie refuzat înainte de pornirea psql. Controlul dinamic local trebuie să verifice și absența tabelei/înregistrării, nu numai exit-code-ul.

3. Blocant de implementare: restricțiile asupra configurației nu fac încă ceea ce declară

Am reprodus ACCEPTAT pentru toate aceste instrucțiuni, într-un fișier cu gardă validă:

Instrucțiune	Lacuna concretă
SELECT set_config('client_' || 'encoding', 'LATIN1', true);	verifica_set_config() verifică numai primul token al argumentului, nu că întregul argument este un literal static.
SET LOCAL "SEARCH_PATH" = public, pg_catalog;	nume_param() nu normalizează cazul numelui citat, deci verificarea formei exacte pentru search_path este sărită.
SELECT pg_catalog."set_config"('search_path', 'public,pg_catalog', true);	Numele citat al funcției nu este recunoscut de verificarea care caută tokenul SET_CONFIG.

Primul exemplu este la nivel superior, nu într-un corp dinamic dificil de analizat. Prin urmare, afirmația „argument dinamic ⇒ refuz” este momentan falsă.

Corecție: verificați argumentul complet până la separator, normalizați corect numele parametrilor și recunoașteți formele citate/calificate ale apelului. Pentru sintaxa nerecunoscută, refuzul este preferabil presupunerii că apelul este sigur.

Păstrați delimitarea: interzicerea backslash-ului în literalii obișnuiți protejează interpretarea acelui subset față de standard_conforming_strings. Nu demonstrează că orice schimbare de encoding/configurație din întregul program este imposibilă. Corpurile dinamice și funcțiile apelate rămân în review-ul artefactului aprobat; validatorul nu este un sandbox pentru SQL arbitrar.

Teste discriminatorii: cele trei exemple trebuie refuzate; forma aprobată SET LOCAL search_path = public, pg_temp și utilizările statice autorizate ale marcajelor trebuie să rămână acceptate.

4. Reconcilierea trebuie să confirme și că citește instanța autoritativă

Verificarea db + system_identifier rezolvă scenariul cu două clustere distincte. Nu distinge însă un primar de o replică fizică a lui, care păstrează identificatorul sistemului. Lock-ul consultativ de pe o altă instanță nu așteaptă tranzacția primarului.

În consecință, o reconciliere pe o replică întârziată poate vedea zero înregistrări și produce 10 — NEAPLICAT, deși livrarea a fost comisă pe primar.

Condiție pentru standard: livrarea și reconcilierea folosesc endpointul de scriere aprobat; verificați explicit că instanța nu este în recovery și păstrați identitatea endpointului în aprobarea țintei. O clonă fizică independentă necesită, de asemenea, identificarea mediului, nu doar numele bazei și system_identifier.

Test discriminatoriu: după livrare pe primar, redirecționați reconcilierea către o replică întârziată cu același nume de bază și același identificator. Rezultatul trebuie să fie țintă neconfirmată/necunoscut, niciodată „neaplicat confirmat”.

5. Limitele rămase sunt acceptabile dacă sunt consemnate precis

Verificarea live, read-only, a dreptului de apel pg_control_system() și includerea identificatorului în aprobare sunt precondiții operaționale; nu justifică slăbirea verificării dacă apelul este refuzat.

PG17 neverificat local rămâne o limitare declarată. Probele de amprentă care refuză înainte de COMMIT pot rămâne fail-closed. Simularea pierderii confirmării prin wrapper este utilă pentru scenariul testat, fără a fi prezentată ca test al tuturor defectelor de rețea.

Consemnare: runda 6 închide scenariile punctuale cerute în runda 5, dar standardul comun rămâne HOLD. Pentru GO sunt necesare închiderea cazului COPY, corectarea verificărilor de configurație și confirmarea instanței autoritative la reconciliere. Review-urile funcționale ale migrărilor nu se schimbă. 
