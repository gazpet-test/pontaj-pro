# Verdict Copilot pe runda 5 — runnerul comun (5adb8ea) — 30.09.2026 ~03:45 RO

Text integral, primit prin canalul Copilot (conversația 2). Mesajul trimis: antet (DELTA + punctele r4) + `scripts/livrare_validator.py` și `scripts/livrare_migrare.sh` integral (21.546 car.).

---

NO-GO pe 5adb8ea ca standard comun de livrare

Copia unică verificată prin SHA-256, lista închisă de argumente și includerea înregistrării în tranzacție rezolvă probleme importante din runda 4. Rămân însă căi de COMMIT nedetectat și de reconciliere cu verdict fals.

Am reprodus local rezultatele validatorului și am verificat logica clasificării rezultatelor. Nu am executat probe PostgreSQL sau conexiuni la producție; testele BD sunt dovezi raportate.

1. Blocant: validatorul încă poate ascunde un COMMIT

Două intrări sunt acceptate de codul transmis, inclusiv când sunt încadrate de gărzile normale de livrare:

Caz	De ce trece de validator
SELECT 1; -- comentariu<CR>COMMIT;	Comentariul este consumat până la LF prin text.find("\n", i). Nu este tratat terminatorul CR, astfel încât COMMIT dispare din analiza validatorului. <CR> reprezintă octetul 0x0D.
Secvența de mai jos	Validatorul presupune delimitarea literalilor obișnuiți fără escape, dar permite schimbarea acelei reguli în sesiunea PostgreSQL.
SQL
SET standard_conforming_strings = off;
SELECT '\'; -- '; COMMIT; -- '

În al doilea caz, validatorul vede SELECT <LIT> și apoi un comentariu; cu setarea modificată, serverul interpretează diferit apostroful precedat de backslash. Nu este suficientă garda de final: după un COMMIT, ea nu poate anula modificările anterioare.

Corecție: tratați corect CR/LF și aliniați explicit regulile lexicale ale validatorului cu sesiunea client/server. Fixați encoding-ul și regulile literalilor; refuzați schimbările incompatibile în artefact sau restrângeți sintaxa acceptată la un subset pe care îl verificați corect. Setările unei baze, ale unui rol ori ale unui serviciu de conexiune nu trebuie să schimbe tacit interpretarea.

Teste discriminatorii: ambele cazuri trebuie refuzate înainte de conexiune sau de orice DDL. Adăugați aceeași probă cu standard_conforming_strings=off venit din configurația conexiunii, fără SET în migrare. În mediul local, verificați și starea finală, nu doar codul de ieșire.

Verificarea existenței textului 'gazpet.livrare_migrare' poate trece și când acesta apare numai într-un comentariu. Nu o descrieți drept validare structurală a gărzilor; gărzile efective rămân parte din review-ul artefactului aprobat.

2. Blocant: reconcilierea nu verifică ținta și poate transforma refuzul corect în succes

Ținta este verificată în 1_pre.sql, nu și în RECONC.

Scenariu concret, direct din ramurile scriptului:

Conexiunea ajunge la clusterul B, cu același nume de bază. --tinta-sistem cere A, deci livrarea refuză corect înainte de DDL. Pe B există deja aceeași înregistrare nume/versiune/SHA. Reconcilierea ignoră identitatea serverului, obține 1|1, iar runnerul întoarce 0 — APLICAT + ÎNREGISTRAT.

Mesajul „confirmarea s-a pierdut” ar fi, în acest caz, fals: execuția a fost refuzată pentru țintă greșită.

Corecție: aceeași verificare a identității aprobate trebuie făcută atât la livrare, cât și la reconciliere. Pentru producție, current_database() singur nu identifică proiectul; faceți obligatoriu un identificator independent aprobat al proiectului/clusterului, prin mecanismul disponibil și verificat. Reconcilierea trebuie să citească baza autoritativă, nu o altă țintă cu același nume.

Test discriminatoriu: două clustere locale cu același nume de bază, dar identități diferite; pe ținta greșită există înregistrarea exactă. Runnerul trebuie să refuze și să nu emită 0. Testați și schimbarea țintei între execuție și reconciliere.

3. Blocant: lock-ul nu garantează o vedere proaspătă dacă izolarea implicită este diferită

Nici tranzacția principală, nici BEGIN READ ONLY din reconciliere nu fixează nivelul de izolare.

Cu REPEATABLE READ, primul SELECT care așteaptă advisory lock-ul poate fixa snapshot-ul înainte de COMMIT-ul livrării precedente. După obținerea lock-ului, interogarea istoricului poate continua să vadă starea veche.

Consecințele posibile sunt exact cele pe care standardul trebuie să le prevină: o a doua livrare nu vede numele deja înregistrat sau reconcilierea raportează lipsa înregistrării deși tranzacția a fost comisă.

Corecție: fixați explicit READ COMMITTED înainte de primul SELECT pe ambele trasee, astfel încât interogarea istoricului de după obținerea lock-ului să primească snapshot-ul corespunzător. Alternativ, demonstrați o construcție echivalentă care nu poate păstra snapshot-ul anterior așteptării. Nu vă bazați pe valoarea implicită a mediului.

Teste discriminatorii: porniți cu default_transaction_isolation=repeatable read și executați:

două livrări concurente, același nume și versiuni diferite: exact o livrare, fără dublare;
reconcilierea pornită cât livrarea deține lock-ul: după COMMIT, înregistrarea trebuie văzută și clasificată corect.
4. Blocant de clasificare: 0|0 nu înseamnă că nu există înregistrări relevante

Interogarea selectează rândurile cu versiunea SAU numele, dar cele două contoare numără numai perechea exactă. Informația despre conflicte se pierde.

Istoric existent	Rezultat actual
Același nume, altă versiune	`0
Aceeași versiune, alt nume	`0
Perechea exactă cu SHA corect plus alt rând cu același nume	`1

Am verificat aceste rezultate prin evaluarea logicii contoarelor și a ramurilor din script, fără BD.

Corecție: păstrați separat numărul total de rânduri relevante, potrivirile exacte, potrivirile de conținut și conflictele. Absență confirmată cere zero rânduri relevante pe ținta corectă. O coliziune sau o dublură trebuie raportată distinct, de exemplu 20 — CONFLICT / reconciliere necesară, fără retry automat.

Dacă perechea exactă exista înaintea încercării, puteți raporta „deja înregistrată cu artefactul aprobat; nu s-a reaplicat”. Nu presupuneți automat că un cod nenul al primei conexiuni înseamnă „confirmare pierdută”.

Teste discriminatorii: toate cele trei situații din tabel și reluarea exactă după succes. Verificați atât codul, cât și formularea rezultatului. Înregistrarea confirmă livrarea istorică; verificarea structurii actuale a obiectelor rămâne proba specifică migrării.

5. Ce consider rezolvat și ce nu mai redeschid

Copia aprobată: aceeași copie pentru validare, execuție și statements, cu verificare SHA-256, răspunde problemei TOCTOU față de fișierul sursă. Protecția locală rămâne în limita de încredere a operatorului privilegiat.

Argumentele: eliminarea lui "$@" liber răspunde problemei suprascrierii ON_ERROR_STOP și introducerii unor fișiere/comenzi suplimentare.

Înregistrarea în tranzacție: testul raportat cu eroare chiar la INSERT răspunde cerinței precise din review-ul #538. Nu îl cer din nou sub alt nume; trebuie păstrat în regresie.

Rezultatul NECUNOSCUT: este direcția corectă. Simularea pierderii confirmării prin wrapper este o probă utilă pentru acel scenariu; nu demonstrează toate căderile de rețea, dar această limitare nu este singură un motiv suplimentar de HOLD.

Domeniul tranzacțional și operatorul privilegiat: delimitările declarate sunt acceptabile. Marcajul nu este autorizare, iar operațiile externe/netranzacționale nu intră în garanția runnerului.

Concluzie: păstrați arhitectura rundei 5, dar nu o portați încă drept standard aprobat. Pentru GO comun trebuie închise cele patru puncte de mai sus: interpretarea lexicală, identitatea țintei la reconciliere, izolarea explicită și detectarea conflictelor din istoric. Acest verdict nu schimbă review-urile funcționale ale migrărilor. 
