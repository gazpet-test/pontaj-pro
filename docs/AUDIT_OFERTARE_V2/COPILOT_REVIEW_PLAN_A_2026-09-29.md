# Review Copilot — planul PowPatroll după decizia A (29.09.2026, conversația 2)

> Răspunsul integral al lui Copilot (6 min) la `PLAN_DUPA_DECIZIA_A_2026-09-29.md`, trimis integral prin Playwright. Păstrat ca sursă; verdictele sunt în jurnalul din `COPILOT_HANDOFF.md`.

Review documentar, pe planul transmis; nu am verificat repo/BD sau logurile. Ordinea A rămâne. Verdictele de mai jos sunt pe scenarii, nu un GO global de merge/apply.

## 1. Migrare aplicată, edge încă nedeployat
GO condiționat pentru refuzul fail-closed. Nu cer inversarea migrare → edge. Cer ca Răzvan să accepte fereastra de indisponibilitate a operațiunii, iar refuzul să existe pe server, inclusiv pentru UI-ul vechi și apelurile API/RPC, fără fallback permisiv sau extinderea implicită a derogării J05.

Dovezile dintre pași:
- Înainte de apply: revizia exactă SQL/edge/UI, revizuită după rebase, cu testele relevante verzi și acordurile consemnate.
- După migrare, înainte de edge: definițiile și permisiunile instalate corespund reviziei aprobate; pe 103, lipsa dovezii/verdictului necesar refuză tranziția, fără schimbare parțială a stării de business.
- După edge și integrarea UI: probe de autorizare, traseu pozitiv și negativ, apoi smoke pe combinația efectiv instalată.

get_advisors este diagnostic, nu dovada că invariantul funcționează. Ordinea deploy → merge este acceptabilă numai dacă se promovează exact codul revizuit; un rebase sau un diff semantic intervenit între ele cere re-review.

## 2. Conflictul J04×J07
NO-GO pe merge doar pe baza celor trei teste. Sunt necesare, dar nu demonstrează că ambele controale sunt obligatorii și independente.

Lipsesc cel puțin scenariul simetric hash invalid/lipsă/stale + poartă permisivă → REFUZ, precum și traseul pozitiv cu hash și poartă curente, toate condițiile fluxului normal satisfăcute → succes. Pentru J07, fiecare control trebuie provocat separat, cu celelalte satisfăcute: un test cu toate cele 12 pe BLOCK poate trece și într-o implementare care verifică doar unul.

Mai cer o probă concurentă deterministă: modificare de sursă/manifest/rezultat relevant între verificare și tranziția finală. Ambele condiții trebuie impuse server-side pe versiuni coerente; două verificări succesive în UI nu sunt suficiente. Testați și schimbarea parser_version cu sursa neschimbată: hash-ul sursei nu este singura dependență a verdictului.

Aceste probe trebuie să acopere și scrierea directă prin căile API/RPC permise aplicației. La refuz, starea și dovezile anterioare nu sunt suprascrise. Pentru J04, reverify B cu manifestul încă pentru A trebuie refuzat; PASS cere manifest/versiune actualizate printr-o tranziție permisă.

Acesta este minimul de integrare J04×J07, nu mutarea întregii etape de concurență înainte de P2. GO după re-review pe diff-ul final și dovezile acestor probe.

## 3. P2 fără provider — Q5=B
GO pentru un EXIT REPORT care declară sincer P2 PARTIAL/NOT PROVEN; NO-GO pentru „MODUL ÎNCHIS” pe această bază.

Există însă o limită înainte de rulare: NO-GO pentru fazele cu scrieri dacă, fără provider, nu există un mecanism echivalent autorizat pentru izolarea și observarea efectelor DB/Storage/externe. Datele vizibile doar actorului de test sub RLS nu demonstrează absența scrierilor ascunse în afara 103. Un observator separat, read-only, cu acces deja autorizat poate fi o alternativă; providerul nou nu este obligatoriu prin nume.

Planul nu enumeră fazele harness-ului, deci aprobarea nominală cere o matrice fază → invariant → actor → revizie → dovadă. Minimul care trebuie executat, în harness sau prin teste echivalente, este:
- Siguranța rulării: T0 DB+Storage, controlul izolării, observarea efectelor externe, mecanismul de stop, safe-rerun și reconcilierea finală. Testarea stopului nu justifică provocarea unei scrieri pe date reale din afara 103.
- Fluxul normal și refuzurile critice: traseu până la pachetul depus pe fixture, J04 A→B, controalele J07 independente, probele relevante R5/R12 și semantica R06/AI-only fără verde final.
- Autorizarea și excepția: tentative prin API/RPC fără drepturile necesare, actor non-owner și verificarea domeniului permis al J05, cu refuzurile și auditul corespunzătoare.

Justificările (1) și (2) contează numai cu probe executate și echivalență demonstrată, nu doar cu descrierea designului. NOT_APPLICABLE pe 103 nu înseamnă că acel criteriu este inaplicabil modulului.

Etapa ulterioară de invalidare/concurență poate rămâne NOT PROVEN în acest P2 intermediar. „0 BYPASS / 0 FALSE_GREEN” trebuie calificat prin scenariile efectiv executate, nu extins asupra celor omise.

## 4. Jilava depusă prin derogare J05
GO ca dovadă reală a depunerii și a folosirii derogării auditate; NO-GO ca demonstrație completă a fluxului normal și a tuturor controalelor. Jilava rămâne o limitare explicită.

Hash-urile locale demonstrează identitatea fișierelor hash-uite; dovada SEAP demonstrează ceea ce consemnează efectiv. Împreună, nu demonstrează automat că exact acei bytes au fost depuși. Pentru această concluzie trebuie legătura verificabilă cu artefactul efectiv depus — de exemplu, recuperarea lui și compararea hash-ului, unde este posibil. Hash-ul local trebuie calculat după semnare/arhivare și orice altă transformare finală. În lipsa legăturii, identitatea end-to-end rămâne NOT PROVEN.

J05 trebuie să identifice precis invariantul ocolit, obiectele/versiunile afectate și decizia ownerului. Acceptarea riscurilor trebuie consemnată înaintea depunerii externe; o înregistrare ERP ulterioară nu trebuie prezentată ca verificare prealabilă.

Derogarea nu transformă cerințele neverificate în verificate și nu rezolvă lipsurile eliminatorii. J04 aplicat ulterior nu validează retroactiv Jilava.

## 5. TRUNCATE față de P2
NO-GO pentru P2 cu scrieri cât timp privilegiul raportat rămâne deschis. PR-ul poate rămâne separat după J07, dar remedierea și verificarea lui sunt precondiții înainte de T0/P2. Poziția exactă între pașii principali o aprobă Răzvan; nu schimbăm ordinea A.

has_table_privilege(..., 'TRUNCATE') = false pe cele trei tabele este necesar, dar verificați privilegiile efective ale identităților relevante, inclusiv moștenirea/PUBLIC, și RPC-urile executabile care ar putea efectua operația cu privilegii ridicate. Grant deschis nu este, singur, dovada unui endpoint exploatabil, dar este incompatibil cu aprobarea unei rulări bazate pe izolarea la 103 fără închiderea riscului.

Proba distructivă se face într-un mediu de test separat, nu pe tabelele comune din producție, nici cu promisiunea unui rollback. În live: verificări read-only ale definițiilor și privilegiilor.

Dacă S09-11 afectează curățarea sau resetarea fixture-ului, și remedierea lui este precondiție pentru P2: un .delete() eșuat tăcut invalidează presupunerea despre starea inițială.

## Ce mai trebuie corectat sau completat
- **Dovezile trebuie să acopere versiunea finală.** P2 rulează înaintea implementărilor de invalidare/snapshot/concurență. Modificările ulterioare pot invalida rezultatele lui. Înainte de verdictul final sunt obligatorii regresiile afectate și probele critice end-to-end pe reviziile efectiv instalate, cu baseline nou. Aceeași regulă se aplică Quick Wins introduse înainte de EXIT REPORT. Nu mutăm P2 în ordine; revalidăm dovezile afectate.
- **Rollback-ul nu poate redeschide poarta.** Existența unui _ROLLBACK.sql nu demonstrează o revenire sigură. Dacă elimină triggerul protector sau dovezile append-only, rezultatul poate fi mai periculos decât indisponibilitatea. Revenirea trebuie să păstreze protecția ori să blocheze operațiunea și să conserve auditul. La P2, diff față de T0 este constatare, nu procedură de rollback; lipsesc pașii testați de restaurare/compensare și limitele lor.
- **Izolarea fixture-ului nu este izolarea întregii producții.** Migrațiile și granturile pe tabele comune au impact global, chiar dacă smoke-ul scrie numai pe 103. Separarea dintre schimbările de schemă aprobate și DML-ul testelor trebuie explicitată. caleSandbox=103/ și cdp_target_id nu sunt, singure, bariere de securitate. Între T0 și raport trebuie controlate și modificările fixture-ului de către oameni/joburi, nu doar deploy-urile.
- **„Roșu explicat” nu devine verde.** Pentru vicare, o excepție poate fi acceptată numai cu identificarea exactă a verificării eșuate, dovada independenței față de schimbarea evaluată și consemnarea acceptării. Un eșec relevant J04/J07, de autorizare sau de integritate rămâne blocant. Nici diff repo↔live = 0 nu este obiectiv suficient fără stabilirea versiunii corecte; nu suprascriem un fix live doar pentru a obține zero.
- **Dovada verificării umane pe Jilava este insuficient definită.** „Contorul porții scade” nu ajunge, mai ales cu falsul verde cunoscut. Sunt necesare identificarea cerinței și dovezii, versiunile/hash-urile relevante, actorul uman, momentul și decizia. Lista de risc acceptată nu schimbă aceste stări. La ELCAS, separați expirarea documentului existent de lipsa celui nou: nu înlocuiți „expirat” cu „valabil” înaintea dovezii verificate.
- **Conturile nu sunt automat în afara impactului Ofertare.** Auth, modulele și sesiunile sunt dependențe comune; criteriul „0 fișiere Ofertare” nu dovedește respectarea freeze-ului. În plus, D2–D6 nu sunt suficient definite prin etichetele din plan pentru GO pe implementare. Trebuie păstrate explicit: potrivire unică pe identitate de încredere pentru R1; excluderea ownerului, verificarea atomică a celorlalte contracte și tratarea situației incomplete fără închidere automată pentru R2; revocarea efectivă a accesului inclusiv din sesiuni existente, jurnalul de revenire și lipsa restaurării automate la reactivare; tri-starea R3 decisă numai de om. Fișa automatizării trebuie să existe înainte de GO/apply, nu abia la finalul traseului.
- **Concluziile din §6 trebuie restrânse la dovezi.** „Permisiuni fail-closed = DEMONSTRAT” este prea larg în prezența riscului TRUNCATE declarat; păstrați rezultatele deja demonstrate și marcați separat suprafața rămasă deschisă. J07 nu este poarta completă PT, iar H1 rămâne conform deciziei existente: WARN cu confirmare umană auditabilă. La finding-uri, CONFIRMED nu trebuie confundat cu „remediat”; dovezile lipsă rămân OPEN/UNDETERMINED/NOT PROVEN, după caz.

**Concluzie:** GO pe ordinea A; nu GO de execuție pe planul actual. Fereastra fail-closed este acceptabilă, cele trei teste de conflict sunt insuficiente, P2 PARTIAL poate fundamenta un raport limitat, Jilava cu derogare rămâne dovadă parțială, iar TRUNCATE trebuie rezolvat înainte de P2.
