# Verdict Copilot pe runda 4 — traseul de livrare comun (95be8d4) — 30.09.2026 ~03:10 RO

Text integral, primit prin canalul Copilot (conversația 2) după 227 s. Mesajul trimis: antet (DELTA #540/#541 + traseul + testele + limitele) + `scripts/livrare_migrare.sh` și migrarea 20261003c integral (39.011 car.).

---

NO-GO pe 95be8d4 ca standard comun de livrare

Direcția este corectă: runnerul gestionează tranzacția, iar înregistrarea participă la ea. Dar limita (2) nu este acceptabilă: un refuz după un COMMIT accidental detectează incidentul, nu îl previne.

Review static pe fișierele transmise. Am reprodus local filtrul shell, fără conexiune la BD; testele PostgreSQL rămân dovezi raportate.

1. Cerința anterioară #538: scenariul precis este demonstrat, garanția comună nu este încă închisă

Testul raportat cu eroare chiar la INSERT-ul în schema_migrations, după verificarea existenței patch-ului în tranzacție, răspunde corect testului discriminatoriu cerut anterior.

Însă mutantul END; demonstrează că același rezultat interzis — modificări comise fără înregistrare — rămâne posibil prin altă cale. Nu îl consemnați drept „mutant prins” pentru invariantul de atomicitate dacă verdictul final este eroare, dar modificările au rămas.

Consemnare: scenariul vechi al runnerului (c) este remediat în execuția testată; criteriul general de livrare atomică rămâne OPEN. Nu redeschid logica funcțională RSVTI deja revizuită.

2. Blocant: filtrul permite control de tranzacție, inclusiv un COMMIT explicit

Am reprodus următoarele rezultate pe expresia exactă sed … | grep -qiE … din script:

Intrare în filtrul local	Rezultat actual
END; la nivel superior	Acceptată
SELECT '--'; COMMIT;	Acceptată: sed confundă conținutul literalului cu începutul unui comentariu
COMMIT; urmat de un fișier lung	Acceptată în reproducere: statusul pipeline-ului este 141, nu 0
Directivă psql \i alt_fisier.sql	Acceptată; conținutul inclus nu este verificat

În cazul 141, grep -q găsește cuvântul și termină citirea; sed primește SIGPIPE. Cu pipefail, condiția if devine falsă, deci ramura de refuz este sărită chiar dacă expresia a găsit COMMIT.

Corecția necesară nu este doar adăugarea lui END în regex. Verificarea trebuie să distingă instrucțiunile SQL de nivel superior de comentarii, literali și corpuri PL/pgSQL și să refuze controlul tranzacției înainte de execuție. Directivele psql care includ fișiere, schimbă conexiunea, execută SQL suplimentar sau modifică setările runnerului trebuie interzise pentru acest format de migrare. Orice eroare a validatorului trebuie să producă refuz, nu să fie interpretată drept „nu s-a găsit”.

Testele discriminatorii: toate cazurile de mai sus trebuie refuzate înainte de DDL; un END legitim din corpul unei funcții trebuie acceptat. Păstrați testul END; care verifică starea inițială și zero înregistrări, nu doar codul nenul al procesului.

3. Blocant: fișierul verificat, înregistrat și executat poate fi diferit

Scriptul citește $MIG în momente diferite: la validare, la construirea statements, apoi prin psql -f "$MIG".

Dacă fișierul este modificat între aceste momente — inclusiv accidental, prin editare sau schimbare de branch — puteți executa alt conținut decât cel păstrat în istoricul migrării. Numele și marcajul tranzacției nu detectează asta.

Corecție: creați o singură copie locală protejată, verificați amprenta ei față de artefactul aprobat și utilizați aceeași copie pentru validare, execuție și înregistrare. Consemnați revizia și SHA-256; simpla calculare a unei amprente fără comparație cu revizia aprobată nu verifică aprobarea.

Test discriminatoriu: modificați sursa după pregătirea înregistrării, înainte de lansarea psql. Runnerul trebuie fie să refuze, fie să execute copia aprobată; în toate cazurile de succes, statements trebuie să corespundă exact copiei executate.

4. Blocați suprascrierea opțiunilor runnerului și corectați semnificația rezultatului

"$@" este transmis fără restricții după opțiunile de siguranță. Interfața spune „argumente de conexiune”, dar acceptă și opțiuni precum -v ON_ERROR_STOP=0, -f sau -c.

Permiteți numai parametrii de conexiune necesari, nu argumente psql arbitrare care pot schimba execuția. Testul trebuie să refuze asemenea opțiuni înainte de conexiune. Cu oprirea la eroare dezactivată, un exit 0 nu mai este dovada succesului SQL.

Separat, afirmația din antet „cod ≠0 = nimic comis” este prea puternică chiar după repararea filtrului. Conexiunea poate cădea după COMMIT-ul serverului, înainte ca rezultatul să ajungă la client.

Documentați trei rezultate:

aplicat și înregistrat confirmat; neaplicat confirmat; rezultat necunoscut, necesită reconciliere read-only.

Pentru ultimul caz, verificați înregistrarea, conținutul aprobat și starea obiectelor înainte de retry. Nu executați automat rollback tehnic sau reaplicare.

Test discriminatoriu: pierderea confirmării către client în jurul COMMIT-ului nu trebuie raportată drept „nimic comis”. Reconcilierea trebuie să identifice rezultatul fără dublare.

5. Unicitatea și serializarea trebuie garantate, nu deduse din IF EXISTS

Verificarea numelui urmată de INSERT nu garantează singură unicitatea în două livrări concurente cu același nume și versiuni diferite. Scriptul nu prezintă o constrângere unică pe nume sau o serializare care să acopere acest caz.

Folosiți o serializare tranzacțională a livrărilor în aceeași bază, cu verificarea istoricului înainte de DDL, sau demonstrați o garanție echivalentă. Nu este necesară implicit o modificare de schemă.

Test discriminatoriu: două procese reale ale runnerului, același nume și versiuni diferite → exact o livrare reușită, o singură înregistrare; cealaltă execuție este refuzată fără efecte proprii. Verificați și că o reluare după eroarea de înregistrare poate reuși normal.

6. Limitele acceptabile și domeniul aprobării

Ocolirea deliberată de către operatorul privilegiat este o limită de încredere acceptabilă, dacă este declarată: marcajul este o gardă de protocol, nu o autorizație și nici protecție împotriva administratorului bazei. Aceasta este diferită de acceptarea accidentală a lui END;.

Standardul trebuie delimitat la operații ale migrării care participă la tranzacția PostgreSQL. Nu promiteți anularea efectelor externe sau a operațiilor netranzacționale doar fiindcă există --single-transaction.

Înainte de DDL, confirmați ținta și identitatea DB aprobate. Credentialele se configurează prin mecanismul local autorizat; nu se transmit URI-uri cu parole în chat. Diferențele de amprentă pe PG17 pot rămâne refuzuri fail-closed, dar nu înlocuiesc aceste garanții.

Concluzie: păstrați modelul runnerului și testul reușit de eroare la înregistrare. Pentru GO comun trebuie închise filtrarea care permite ieșirea din tranzacție, identitatea artefactului, controlul argumentelor și serializarea, iar rezultatele ambigue trebuie tratate explicit. Portarea acestui runner în celelalte PR-uri nu transferă încă un GO de livrare. 
