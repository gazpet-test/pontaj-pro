# Verdict Copilot pe #538 runda 2 (e707ba5) — 30.09.2026 ~02:00 RO

Text integral, primit prin canalul Copilot (conversația 2) după 259 s. Mesajul trimis: antet cu constatările, dovezile, limitările și deciziile + cele 2 fișiere SQL integral (commit e707ba5). Testele nu au fost trimise.

---

NO-GO pentru apply pe revizia e707ba5 în forma transmisă. Poarta bazată pe EXISTS este corectă pentru identitatea absentă; blocantele sunt mai jos. Review static pe SQL; rezultatele harness-ului rămân dovezi raportate.

## 1. Fișierele: ce trebuie corectat și ce teste trebuie să discrimineze

Parametrul omis nu folosește data Bucureștiului — fișierul 1, §2. Semnătura păstrează DEFAULT CURRENT_DATE, evaluat în fusul sesiunii; numai NULL explicit ajunge la v_azi. Folosiți DEFAULT NULL::date, cu rezolvarea deja existentă în corp.

Test: la ceas fix 2026-09-29 23:30 UTC, sesiune UTC, apelul cu data omisă și apelul cu NULL trebuie să înregistreze ambele 30.09, data Bucureștiului. Codul actual poate înregistra 29.09 pentru primul. Repetați și într-un fus în care data sesiunii este înaintea datei Bucureștiului.

Precondiția 0a nu este fail-closed pe NULL. Dacă politica sursă păstrează numele/rolurile/comanda, dar nu mai are USING și WITH CHECK, ambele hash-uri sunt NULL. Comparațiile <> produc NULL, iar IF nu refuză. Înlocuiți verificările cu comparații null-safe, precum IS DISTINCT FROM, și verificați explicit RLS activ și pe hr_autorizatii.

Test: politica sursă ALL TO authenticated, fără expresii restrictive → migrarea trebuie refuzată, fără modificări. La fel pentru RLS dezactivat pe tabelul sursă.

Helperul existent poate fi suprascris fără verificare — §1. Înainte de CREATE OR REPLACE, acceptați numai absența lui sau definiția deja aprobată pentru reaplicare.

Test: helper existent cu alt corp → refuz înainte de modificări. Acum această stare nu este verificată.

Atomicitatea migrării nu este demonstrată de fișier. Fișierul 1 conține mai multe instrucțiuni fără tranzacție explicită. Poate fi corect dacă runnerul le include într-o singură tranzacție, dar această proprietate trebuie demonstrată pe traseul folosit.

Test: eroare injectată după prima înlocuire de funcție și, separat, în postcondiție → toate funcțiile/politicile/ACL-urile rămân inițiale, fără migrare înregistrată ca aplicată. Folosiți un singur gestionar al tranzacției.

Rollback-ul nu primește GO de execuție. current_setting(...) verifică valoarea, nu dovedește armarea prin SET LOCAL; o setare persistentă sau de sesiune poate satisface condiția. Adăugați protecția împotriva armării persistente, aceeași disciplină tranzacțională și testul: setare preexistentă, fără armare nouă autorizată → refuz, inclusiv după un eșec.

Păstrați rollback-ul tehnic în afara migrărilor forward descoperite automat sau demonstrați excluderea. El rămâne artefact de test/revenire excepțională, nu al doilea fișier de aplicat odată cu patch-ul.

## 2. INSERT direct HR în jurnal: poate rămâne decizie separată

Nu condiționez reducerea urgentă a accesului non-HR de includerea variantei A, dacă Răzvan acceptă explicit domeniul limitat și riscurile rămase.

Recomand A — jurnal scris numai prin RPC-ul protejat. Varianta B, limitată la coloane și potrivirea angajatului, nu garantează singură validitatea datei/scadenței sau integritatea evenimentului.

Până atunci, consemnarea corectă este: „INSERT direct restrâns la grupul autorizat și identitatea proprie”, nu „jurnal de confirmări integral verificabil” sau „RSVTI securizat complet”.

## 3. P1b: pas următor prioritar, nu blocant pentru restrângerea punctuală

Scrierea directă a rsvti_* de către HR rămâne finding OPEN de integritate/proveniență. Nu justifică amânarea protecției față de conturile fără drepturi HR, dar împiedică închiderea incidentului complet. La fel, ștergerea prin cascadă și suprascrierea fișei prin confirmări retroactive rămân explicit deschise.

Corectați și procedura operațională din rollback: „data confirmării precede emiterea” nu dovedește că data_emitere este greșită. Se verifică documentele și versiunea autorizației; nu se modifică o dată reală pentru a trece validarea. Pragul 2000-01-01 trebuie acceptat ca regulă de business, nu prezentat ca dovadă că orice dată anterioară este o greșeală.

## 4. MD5 PG16/PG17: acceptabil condiționat

Da, diferența de deparse poate produce un refuz sigur, numai dacă postcondiția rulează înainte de COMMIT și anulează întreaga migrare — condiția de atomicitate de la punctul 1.

Dacă amprenta diferă, comparați definițiile și actualizați revizia după review; nu introduceți automat în lista albă hash-ul găsit.

Postcondițiile trebuie să verifice și atributele funcțiilor și privilegiile efective, nu doar prosrc și granturile directe din aclexplode: includeți PUBLIC, moștenirea și eventualele granturi pe coloane.

**Concluzie:** GO pe direcția restrângerii accesului, HOLD pe această revizie exactă. După corecturi sunt necesare noua revizie și probele discriminatorii de mai sus; acordul lui Răzvan rămâne separat.
