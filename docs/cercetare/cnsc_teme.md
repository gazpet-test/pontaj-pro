# Practica CNSC 2020–2026 — sinteză pe teme pentru Gazpet

**Baza:** 90 de decizii CNSC (gaze, distribuție, apă-canal, lucrări generale), dintre care 37 de contestații admise, 24 admise parțial și 29 respinse. Sursa este `docs/cercetare/cnsc_practica.json`. Unde există o regulă corectată, s-a folosit forma corectată.

> **Atenție:** deciziile CNSC sunt **practică de interpretare**, nu precedent obligatoriu. CNSC nu e legat de soluțiile anterioare, iar o decizie poate fi schimbată în instanță (BO2026_13). Regulile de mai jos arată cum a judecat CNSC până acum. Nu sunt lege.

**Cum citești numerele:** „admisă” înseamnă că a câștigat contestatorul (care putea fi ofertantul respins sau un concurent). Decizia apare la o temă dacă are eticheta temei respective. O decizie poate apărea la mai multe teme.

---

## 1. Respingerea ofertei: NECONFORMĂ vs INACCEPTABILĂ

**(a) Regulile extrase**

1. **Oferta e neconformă când lipsește conținut tehnic cerut EXPRES în DA.** Exemple: proceduri tehnice de execuție pe categorii de lucrări, activități „obligatorii” în Gantt, drum critic, metodologie proprie în locul unei copii după caietul de sarcini. Aceste lipsuri nu se acoperă la clarificări (BO2025_2118, BO2023_140, BO2024_632, BO2025_1775, BO2022_2768, BO2025_3638, BO2021_2116, BO2026_3104). Formulele generice de tipul „se vor respecta” fac oferta neconformă dacă DA le interzice expres (BO2025_3638).
2. **Oferta devine inacceptabilă din trei cauze:** răspunsul neconcludent la clarificări (art. 134 alin. 5 HG 395), modificarea ofertei prin clarificări (art. 134 alin. 6) și depășirea pragului de 1% (art. 134 alin. 9). Deciziile-sursă: BO2023_657, BO2023_246, BO2024_159, BO2021_1060, BO2020_2191, BO2025_1138. Calificarea (DUAE) se judecă pe art. 137 alin. 2 lit. b, dar acest temei e greșit pentru garanția de participare (BO2026_15).
3. **Nu se respinge pentru cerințe care nu sunt scrise în DA.** Exemple: atestate, detalii Gantt, PCCVI sau planuri nesolicitate (BO2024_1706, BO2026_2328, BO2024_203, BO2023_665). Nici pentru greșeli de redactare care nu afectează conținutul (Decizie_271). Nici pentru simple detalii de formă ale Gantt-ului sau ale procedurilor (BO2022_2053).
4. **Același standard pentru toți ofertanții.** Dacă la câștigător comisia citește Gantt-ul împreună cu restul ofertei, trebuie să facă la fel și la ceilalți (BO2022_2053). Copierea caietului de sarcini, când DA o interzice, face oferta neconformă chiar și la câștigătorul care a fost proiectantul lucrării (BO2025_1775, BO2022_1028).
5. **Practica e divergentă la Gantt.** BO2022_2053 consideră respingerea pentru forma Gantt-ului disproporționată. BO2022_1964, BO2024_717 și BO2025_1775 o mențin. Granița este dacă elementul era **cerut expres** în DA. Când termenul de execuție e factor de evaluare, Gantt-ul trebuie să arate resursele pe activitate și planul pe fiecare asociat sau subcontractant (BO2024_717).

**(b) Cum o folosim în Ofertare**
- Înainte de depunere facem un checklist cu tot ce DA cere „obligatoriu” sau „expres” în propunerea tehnică: proceduri pe fiecare categorie (inclusiv SRM, foraj, traversări), Gantt cu drum critic continuu, resurse pe activitate și metodologie scrisă pentru obiectivul concret. Nu folosim texte copiate din alte oferte (BO2026_3104).
- Dacă DA e neclară despre nivelul de detaliu al Gantt-ului, aplicăm PAT-TRM-01. Dacă documentele DA se contrazic, aplicăm PAT-CTR-01.
- Motiv de contestare: respingerea pe o cerință care nu e scrisă în DA sau tratamentul inegal față de câștigător.

**(c) Numărul de decizii:** 27 (12 admise, 5 admise parțial, 10 respinse).

---

## 2. Prețul neobișnuit de scăzut (PANS) și justificarea lui

**(a) Regulile extrase**

1. **Pragul de ~80% din valoarea estimată obligă la justificare,** dar prețul mic nu e singur motiv de respingere. AC trebuie să ceară explicit justificarea și să arate că lucrarea nu se poate executa la acel preț (BO2021_448, BO2025_104 la 65%, BO2025_2344 la 76,63%). La 88,52% nu există prezumția de PANS (BO2024_656).
2. **Cererea de justificare trebuie să fie punctuală,** cu repere obiective verificabile (cotații, buletine statistice). Altfel poate fi contestată și anulată direct (BO2024_656). Pe de altă parte, AC poate verifica prețuri unitare aparent scăzute chiar dacă totalul nu e sub prag (BO2024_3130).
3. **Ce n-a trecut:**
   - simpla enumerare de costuri, „rezerva din profit” sau orele declarate fără documente (BO2023_1788);
   - răspunsul selectiv, de exemplu justificarea a 9 articole din 142 cerute (BO2024_3130);
   - justificarea parțială a prețurilor diferite pentru aceeași resursă (BO2022_1923);
   - documente care nu susțin exact prețul din C6/F3, de exemplu mixtură justificată la 76,20 lei/t, deși ofertată la 110 lei/t (BO2025_1138);
   - reducerea cantităților din listele SEAP pe motiv de „consumuri proprii” (BO2026_3104);
   - un executant real care nu a fost declarat subcontractant (BO2025_2344).
4. **Ce a trecut:** o justificare care acoperă manopera, materialele, utilajele și obligațiile legale. Aceasta se analizează pe fond, iar neclaritățile se clarifică suplimentar (BO2025_104, BO2021_448). Critica „manoperă sub salariul minim” cade dacă e calculată greșit, de exemplu cu concediul adăugat peste orele lucrate (BO2020_2124).

**(b) Cum o folosim în Ofertare**
- La orice ofertă sub 80% din VE pregătim dosarul de justificare **înainte** de depunere: oferte de la furnizori, stat de plată, costuri orare pentru utilaje, cu prețuri identice cu cele din C6–C9 și F3.
- Folosim un preț unitar unic pe resursă în toate devizele (PAT-AMB-04). Nu modificăm cantitățile din F3. Contradicțiile le ridicăm la clarificări (PAT-CTR-02, PAT-AMB-03).
- La cererea de justificare răspundem la **fiecare** articol cerut, cu documente. Dacă cererea e vagă, o putem contesta (BO2024_656).
- Motiv de contestare: câștigătorul e sub 80% și nu i s-a cerut justificarea (BO2025_2344), sau a redus cantitățile (BO2026_3104).

**(c) Numărul de decizii:** 14 (6 admise, 3 admise parțial, 5 respinse).

---

## 3. Experiența similară (ES)

**(a) Regulile extrase**

1. **„Similar” nu înseamnă „identic”.** ES se judecă după textul publicat și după complexitate. Conductele de transport și SRM-urile sunt similare sau superioare distribuției când cerința spune „infrastructuri de gaze” (BO2023_1336, BO2023_1378, Decizie_3952 — aceasta din urmă nuanțată: nu e o regulă generală pentru cerințele limitate strict la distribuție). Branșamentele și extinderile de distribuție contează ca ES (BO2023_2717). O ES cerută identică cu obiectul sau limitată la tipul exact de rețea e restrictivă (BO2024_2669, BO2023_1489).
2. **Ce dovedește ES:**
   - recepția parțială pe obiecte funcționale independent (BO2024_942);
   - procesul-verbal de stadiu fizic, acceptat la evaluarea pe fond (BO2026_182);
   - studiile de teren din contractele de SF, care intră în ES de proiectare (BO2025_1138);
   - documentațiile tehnice din domeniul gazelor, care sunt servicii de proiectare (BO2022_2403).
3. **Ce NU dovedește ES:**
   - acordul-cadru fără contractele subsecvente. Acestea se indică încă din DUAE (BO2023_140);
   - procesul-verbal emis după data-limită de depunere (BO2026_182);
   - recomandările semnate doar de diriginte, neconfirmate de beneficiar (BO2026_182);
   - lucrările făcute ca subcontractant fără valoare individualizată (BO2026_182).
4. **Comisia trebuie să verifice efectiv documentele suport pe fiecare componentă a ES** (BO2026_2328). Nu poate respinge doar după denumirea contractului (BO2026_1360, BO2023_2717). Motivele de respingere sunt doar cele scrise în comunicarea rezultatului (BO2023_1378).

**(b) Cum o folosim în Ofertare**
- Ținem un registru intern de contracte cu procese-verbale de recepție pe obiecte, confirmări ale beneficiarului (Delgaz, Distrigaz), valori individualizate pe subcontractare și date anterioare termenului de depunere (PAT-CAL-07).
- Dacă DA cere ES „identică” sau doar pe tipul de rețea din obiect, cerem clarificări sau contestăm (PAT-CAL-05). Dacă cere contracte „finalizate în ultimii 5 ani” sau un plafon peste VE, folosim PAT-CAL-06.
- Contractele de transport, SRM sau branșamente le invocăm când textul cerinței permite. La respingere contestăm, pe baza BO2023_1336 și BO2023_1378.

**(c) Numărul de decizii:** 21 (10 admise, 9 admise parțial, 2 respinse). Contestatorii au câștigat aproape mereu.

---

## 4. Personalul cheie

**(a) Regulile extrase**

1. **Autorizarea ANRE se cere doar celor care proiectează sau execută efectiv.** Impusă managerului de proiect, șefului de proiect sau șefului de șantier, e restrictivă (BO2024_1870, BO2024_2683). Experiența cerută strict „în gaze” pentru manager se elimină dacă nu e justificată (BO2026_1237).
2. **Calificările personalului cerute doar în caietul de sarcini, doar „recomandate” sau doar generic** („toate autorizațiile din legislație”) **nu pot fundamenta respingerea** (BO2026_2328, BO2024_717, BO2024_1706).
3. **Dacă oferta inițială arată că firma dispune de personal** (număr, DUAE, Revisal), nominalizarea și autorizațiile depuse la clarificări sunt confirmări, nu modificări (BO2022_340, BO2023_562, BO2024_2884). Declarațiile de disponibilitate cu dată greșită sunt vicii de formă (BO2023_665).
4. **Cerințele formale clare din DA** (CV semnat, dovezi de experiență) nu mai pot fi contestate după depunere, iar lipsa lor e fatală (BO2024_1699). Experiența expertului se raportează la data autorizării lui ANRE: comisia trebuie să verifice perioadele (BO2026_182).
5. **Interdicția aceluiași expert pe mai multe loturi trebuie motivată** (BO2023_2119). Revisal, declarațiile de disponibilitate, backstopping și asigurarea RC cerute la ofertare au fost eliminate de AC în cursul contestației (BO2025_833).

**(b) Cum o folosim în Ofertare**
- Verificare internă înainte de depunere: legitimațiile ANRE și ISCIR ale experților sunt valabile și la Gazpet, iar datele autorizării sunt anterioare proiectelor invocate (PAT-CAL-12, PAT-CAL-11).
- Cerem clarificări pe terminologia veche din DA („gradul II”, „RTE pentru gaze”), după PAT-CAL-04, și pe regulile pentru experți comuni pe loturi, după PAT-CAL-10.
- Motiv de contestare a DA: ANRE cerut managerului sau șefului de șantier (BO2024_2683).

**(c) Numărul de decizii:** 18 (5 admise, 7 admise parțial, 6 respinse).

---

## 5. Atestări și autorizări ANRE (firmă, asociați, subcontractanți, persoane)

**(a) Regulile extrase**

1. **O autorizație care nu e cerută în anunț sau în fișa de date nu poate fi motiv de respingere.** Ține de execuție. Exemple: ANRE EDSB pentru firmă, ANRE PT, ANRE pentru instalații electrice, AFER, autorizații pentru apă (BO2026_1360, BO2022_2403, BO2024_1529, BO2023_416, BO2022_1746, BO2022_340).
   - **Excepție:** fișa de date cere dovada capacității pentru TOATE activitățile, iar caietul de sarcini include expres o activitate autorizată. Exemplu: AFER pentru subtraversare de cale ferată (BO2020_2191).
   - **Nuanță:** AC trebuie să verifice capacitatea legală doar dacă activitatea e efectiv necesară (BO2021_159).
2. **Când autorizația ANRE e cerută, trebuie să o aibă firma, un asociat sau un subcontractant declarat.** Un instalator persoană fizică colaborator nu acoperă lipsa autorizației de firmă (BO2022_1615).
   - **Practică divergentă** despre cine trebuie autorizat:
     - BO2024_3288 permite AC să ceară ANRE de la toți asociații, terții tehnici și subcontractanții de pe partea de gaze;
     - BO2024_3232 spune că ajunge membrul sau subcontractantul care execută efectiv gazele, nu toți;
     - BO2022_2768 susține BO2024_3232, dacă repartizarea sarcinilor e clară în ofertă.
3. **Orice intervenție fizică pe sistemul de gaze cere autorizație ANRE, chiar și în contracte de drumuri** (răsuflători, cutii, branșamente). Dacă AC întreabă, autorizația se prezintă la clarificare, nu mai târziu (BO2023_657).
4. **Dacă DA cere doar ca lucrarea de gaze să fie executată de un operator autorizat,** ofertantul poate folosi un contract cu o firmă autorizată fără să o declare subcontractant (BO2021_973).

**(b) Cum o folosim în Ofertare**
- La fiecare DA verificăm tipul de autorizație cerut față de regimul de presiune și Ordinul ANRE în vigoare (PAT-CAL-01). Verificăm și dacă autorizația se cere la ofertă sau la execuție (PAT-AMB-06).
- În asocieri scriem explicit în propunerea tehnică cine execută partea de gaze (PAT-CAL-02). La contractele de drumuri sau apă care ating rețele de gaze, folosim PAT-CAL-03. La cereri ISCIR fără obiect, folosim PAT-STD-09.
- Nu contestăm concurenții pentru autorizații necerute în DA, pentru că șansele sunt mici (BO2023_416, BO2024_1529).

**(c) Numărul de decizii:** 17 (6 admise, 4 admise parțial, 7 respinse).

---

## 6. DUAE și documentele suport

**(a) Regulile extrase**

1. **Informația de calificare trebuie declarată efectiv în DUAE la depunere.** Exemple: cash-flow cu valoare și sursă, contractele de ES, inclusiv cele subsecvente unui acord-cadru. Omisiunea e de fond și nu se repară prin DUAE revizuit (BO2026_1360, BO2023_140). Corectarea unei erori din DUAE e permisă (BO2023_140).
2. **Prezentarea în altă formă decât preferă comisia nu justifică respingerea.** Exemplu: DUAE care nu separă proiectarea de execuție. În asemenea cazuri se cere DUAE revizuit (BO2022_340).
3. **Un document de calificare care exista înainte de depunere și a fost omis poate fi adus la clarificări.** Exemple: un atestat, certificatul ONRC (BO2024_2636). Documentele suport se cer în forma din DA, fără formalități suplimentare precum „conform cu originalul” (BO2026_362).
4. **Comisia trebuie să verifice efectiv documentele suport** față de DUAE (BO2026_2328) și să clarifice neconcordanțele, de exemplu procentul de subcontractare față de grafic (BO2021_1117). Lipsa codului CAEN pentru activități secundare nu e motiv de respingere dacă DA nu-l cere (BO2023_246).

**(b) Cum o folosim în Ofertare**
- Completăm DUAE cu cifre concrete, nu formule sau fraze la viitor. Indicăm contractele subsecvente și sursa cash-flow-ului. Pentru fiecare asociat completăm rubricile lui.
- Documentele suport (PAT-CAL-07, PAT-CAL-13) le pregătim înainte de depunere, chiar dacă se cer doar locului I.
- Dacă primim o cerere de clarificări vagă, o putem contesta (BO2026_362).

**(c) Numărul de decizii:** 24, din care 10 etichetate DUAE și 17 documente de calificare (12 admise, 9 admise parțial, 3 respinse).

---

## 7. Garanția de participare (GP)

**(a) Regulile extrase**

1. **Contează existența instrumentului valabil la data-limită, nu locul sau modul în care a fost încărcat.** GP încărcată în altă secțiune SEAP sau depusă fizic se clarifică, nu se sancționează (BO2020_2392, BO2022_1952). GP plătită de un subcontractant în favoarea ofertantului, cu destinație clară, e valabilă (BO2022_2170).
2. **Lipsa instrumentului la termen nu se poate remedia.** Un mesaj SWIFT nu e scrisoare de garanție, iar la clarificări nu se poate aduce un instrument nou (BO2021_2420).
3. **Prelungirea GP o cere AC.** Ofertantul nu are obligația să o prelungească din proprie inițiativă, iar GP nu e criteriu de calificare (BO2026_15). Refuzul unei prelungiri peste perioada din fișa de date nu face oferta neconformă (BO2021_99). Neprelungirea după respingere nu înlătură interesul de a contesta (BO2025_1775).
4. **Condițiile impuse emitentului** (rating, tip de bancă) trebuie justificate și proporționale (BO2021_1317).

**(b) Cum o folosim în Ofertare**
- Verificăm înainte de depunere: cuantumul, valabilitatea cel puțin egală cu perioada din fișa de date, forma instrumentului (scrisoare sau poliță originală, în limba română) și încărcarea în secțiunea corectă (PAT-GAR-01).
- Prelungim GP doar la cererea AC, dar răspundem prompt.
- Condițiile pentru emitent se contestă la DA.

**(c) Numărul de decizii:** 9 (3 admise, 4 admise parțial, 2 respinse).

---

## 8. Clarificările la ofertă: ce POATE și ce NU POATE cere sau accepta AC (art. 209 L98, art. 134–137 HG 395)

**(a) Regulile extrase**

1. **Clarificarea poate doar explicita sau confirma ce exista deja în ofertă.** Completarea care schimbă conținutul tehnic sau prețul e interzisă (BO2022_2774, BO2025_2118, BO2024_632, BO2020_2191). Granița practică:
   - **documente preexistente** de calificare sau personal se pot completa (BO2024_2636, BO2022_340, BO2023_562);
   - **conținut nou** în propunerea tehnică nu se poate adăuga: proceduri, metodologii, Gantt (BO2023_140, BO2025_1221, BO2025_3638);
   - **element nou** introdus la clarificări face oferta inacceptabilă, de exemplu garanția echipamentelor. Retransmiterea propunerii financiare nu e fatală dacă AC analizează doar ce a cerut (BO2025_187).
2. **Pragul de 1% din propunerea financiară.** Se pot corecta doar erorile aritmetice care rezultă mecanic din datele inițiale și abaterile tehnice minore, cumulat sub 1% din prețul total. 1,14% = ofertă inacceptabilă (BO2024_159). Majorarea unor poziții după justificarea prețului nu e eroare aritmetică (BO2021_1060). Nici modificarea valorilor pe asociați sau subcontractanți nu e (BO2025_1138).
3. **Cererea AC trebuie să fie clară și punctuală.** Un răspuns rezonabil la o întrebare vagă nu poate fi declarat „neconcludent” (BO2022_1028). Cererea vagă sau fără temei se contestă direct (BO2026_362, BO2024_656). O cerere pe care nu o contești devine obligatorie și trebuie respectată întocmai (BO2023_246).
4. **AC nu poate respinge direct pentru vicii de formă.** Exemple: semnătura electronică lipsă pe un răspuns care confirmă documente deja semnate (BO2023_562), declarații cu date greșite (BO2023_665). Nici nu poate folosi o reevaluare dispusă de CNSC pentru a ridica neconformități noi (BO2024_3064). Contradicțiile din DA nu se întorc împotriva ofertantului (BO2023_665).

**(b) Cum o folosim în Ofertare**
- **Răspuns la clarificare:** confirmăm și trimitem la pagina din oferta inițială. Nu adăugăm conținut nou și nu retrimitem formulare financiare modificate. Orice corectură de preț o calculăm cumulat față de pragul de 1%.
- Cererea vagă sau peste lege o contestăm în termen (vezi tema 12). Dacă nu o contestăm, îi răspundem punct cu punct.
- Când cerem noi clarificări la DA despre ce se depune, folosim PAT-AMB-01 și PAT-TRM-01.

**(c) Numărul de decizii:** 47, din care 46 etichetate clarificări la ofertă și 3 erori aritmetice (17 admise, 16 admise parțial, 14 respinse).

---

## 9. Modificarea documentației prin răspunsurile la clarificări

**(a) Regulile extrase**

1. **Un răspuns care NU modifică DA nu redeschide termenul de contestare.** Cerințele restrictive se atacă de la publicarea DA. Contestarea unui refuz motivat („nu se acceptă”) nu mai poate obține eliminarea cerinței (BO2024_3155).
2. **Un răspuns evaziv sau generic e atacabil**, de exemplu „DA respectă Legea 98” (BO2024_2938, BO2023_2119). Un răspuns care doar ajustează cifrele nu repară o cerință nelegală (BO2024_1870).
3. **Relaxarea cerințelor prin clarificare din oficiu nu se atacă cu succes** doar pentru că lărgește concurența (BO2024_1016).
4. **Modificările acceptate se publică prin erată, cu nou termen de depunere** (BO2022_2083, BO2023_1128). Termenele de clarificare de 1–2 zile lucrătoare, peste sărbători, sunt nelegale (BO2025_286).
5. **Viciile DA descoperite după depunere duc la anularea procedurii.** Exemple: un factor de evaluare bazat pe un PT inexistent (BO2025_1837), o valoare estimată necorelată cu devizul SF (BO2023_427), suprapunerea cu concesiunea (BO2026_2669).

**(b) Cum o folosim în Ofertare**
- Contestăm DA în termen de la publicare. Nu așteptăm răspunsul la clarificări (PAT-TRM-03).
- La răspunsuri evazive revenim cu PAT-AMB-08. Dacă răspunsul modifică DA, dar documentul nu e republicat, folosim PAT-CTR-03. Dacă răspunsul vine prea târziu față de termenul de depunere, folosim PAT-TRM-02.
- Înainte de a investi într-o ofertă verificăm concesiunea (PAT-INF-07) și corelarea VE pe lot (PAT-INF-11).

**(c) Numărul de decizii:** 16 (7 admise, 3 admise parțial, 6 respinse).

---

## 10. Terțul susținător, subcontractanții și asocierea

**(a) Regulile extrase**

1. **Cine execută efectiv o parte din lucrare trebuie declarat subcontractant**, inclusiv la refacerile de drum (BO2025_2344). Un subcontractant necesar pentru o autorizare specifică se declară la ofertare, nu în execuție (BO2020_2191).
   - **Excepție:** când DA cere doar „asigurarea” execuției de către un operator autorizat, firma poate fi furnizor (BO2021_973).
2. **Terțul susținător cu un motiv de excludere se înlocuiește o singură dată, la cererea AC** (BO2024_942, BO2023_2237).
3. **Subcontractantul care e și terț susținător trebuie să dea angajament ferm** și să indice resursele puse la dispoziție (BO2023_246).
4. **În asociere, repartizarea sarcinilor trebuie să fie clară în ofertă.** Autorizația ANRE trebuie să o aibă cel care execută gazele (BO2022_2768, BO2024_3232, vezi divergența de la tema 5). Repartizarea și metodologiile nu se pot completa la clarificări (BO2025_1221).
5. **Specialiștii angajați prin contract de prestări servicii nu sunt subcontractanți sau terți.** Nu completează DUAE (BO2022_340).

**(b) Cum o folosim în Ofertare**
- Pentru fiecare ofertă facem o matrice „cine execută ce”: Gazpet, asociat, subcontractant (asfalt, foraj, electrice, CF). Fiecare executant e declarat cu procent în DUAE și apare în Gantt (BO2021_1117).
- Pentru refacerea drumurilor și garanția lor folosim PAT-GAR-04. Pentru traversări folosim PAT-CNT-03.
- Motiv de contestare: un executant al câștigătorului care nu a fost declarat (BO2025_2344).

**(c) Numărul de decizii:** 24, din care 21 etichetate terț sau subcontractant și 5 asociere (11 admise, 4 admise parțial, 9 respinse).

---

## 11. Cerințe restrictive și factori de evaluare

**(a) Regulile extrase**

1. **Sarcina probei e a contestatorului.** AC trebuie însă să justifice concret fiecare cerință în strategia de contractare. Atestatele străine de obiect se elimină (ANIF, alte tipuri). Cerințele justificate tehnic rămân, de exemplu trencher, SCADA sau RMQ (BO2026_1237, BO2022_2083).
2. **Ce s-a eliminat ca restrictiv:**
   - ES identică sau doar pe tipul de rețea (BO2024_2669, BO2023_1489);
   - prag valoric cumulat cu praguri cantitative (BO2024_1870);
   - ANRE cerut managerului (BO2024_2683);
   - interdicția aceluiași expert pe mai multe loturi, nejustificată (BO2023_2119);
   - vizitarea amplasamentului ca o condiție de conformitate (BO2023_1128);
   - elemente care țin de PT cerute la P+E (BO2024_3657).
3. **Factorii de evaluare trebuie să aducă un avantaj real și verificabil.** Nu pot favoriza firmele locale: angajați din comună, mașini electrice (BO2024_3657). Un algoritm bazat pe noțiuni nedefinite viciază procedura (BO2025_1837). La P+E ponderea prețului e de cel mult 40% (BO2024_2683). Punctajul trebuie motivat pe fiecare factor (BO2025_3409, BO2021_1117).
4. **Ce a fost validat:**
   - factorii preluați din ghidul ANAP (BO2024_2669);
   - cash-flow-ul calculat VE×n/durată, dacă AC îl justifică (BO2024_3232);
   - ANRE cerut tuturor celor de pe partea de gaze (BO2024_3288, divergent cu BO2024_3232);
   - cerințele refuzate motivat de AC (BO2024_3155).

**(b) Cum o folosim în Ofertare**
- La analiza DA rulăm PAT-CAL-05, 06, 08, 09 și 13, plus PAT-AMB-01 și PAT-AMB-02. Mai întâi cerem justificarea la clarificări, apoi contestăm **cu probe** (cost, proporționalitate), nu doar prin afirmații.
- Pentru utilajele cerute specific pregătim un contract de închiriere, în loc să contestăm (BO2026_1237).

**(c) Numărul de decizii:** 27, din care 21 etichetate cerințe restrictive și 12 factori de evaluare (11 admise, 6 admise parțial, 10 respinse).

---

## 12. Aspecte procedurale la CNSC (termene, cauțiune, critici tardive, interes)

**(a) Regulile extrase**

1. **Termenele de contestare sunt de 10 zile peste pragurile UE și de 7 zile sub prag** (art. 8 L101; BO2023_2119, cu termenul corectat). Termenul pentru criticile din dosar curge de la accesul efectiv la dosar (BO2026_182). Ziua expiră la ultima oră, așa că un e-mail trimis seara în ultima zi e în termen (BO2025_3638, BO2025_187).
2. **Fără cauțiune, contestația se respinge fără analiză** (BO2024_3657, BO2020_2392). Cauțiunea plătită în 5 zile, cu prelungire peste zilele nelucrătoare, e în termen (BO2024_1529).
3. **Criticile sunt tardive** dacă apar doar în concluziile scrise (BO2023_665), după studiul dosarului peste termen (BO2023_1788) sau sunt reluate după o respingere definitivă (BO2023_2185). O excludere necontestată devine definitivă și nu poate fi „reabilitată” (BO2023_2185).
4. **Interesul de a contesta:**
   - depunerea ofertei nu înlătură interesul de a ataca DA (BO2025_878, BO2024_2669);
   - cine nu poate înlătura câștigătorul nu are interes față de locurile inferioare (BO2024_203, BO2024_2884);
   - AC nu poate invoca la CNSC motive noi de respingere, nescrise în comunicare (BO2023_1378);
   - accesul la dosar nu poate fi refuzat pe confidențialitate nedovedită (BO2025_3409).
5. **Dacă instanța desființează decizia CNSC,** actele emise în executarea ei cad (BO2026_13). Reevaluarea dispusă de CNSC se face strict în limitele deciziei (BO2023_2185, BO2024_3064).

**(b) Cum o folosim în Ofertare**
- Ofertare trebuie să calculeze automat termenul de contestare (7 sau 10 zile, după prag) de la publicarea DA sau a rezultatului și să afișeze alerta (PAT-TRM-03).
- Cauțiunea o plătim în aceeași zi cu contestația.
- Cerem accesul la dosar imediat după comunicare. Atacăm întâi câștigătorul, apoi ceilalți.

**(c) Numărul de decizii:** 24 de decizii care tratează aspecte procedurale (8 admise, 8 admise parțial, 8 respinse). Nu există o etichetă separată pentru această temă, așa că deciziile au fost selectate după conținutul textului.

---

## Top 10 reguli CNSC pentru Gazpet

1. **Răspunsul la clarificare confirmă, nu completează.** Procedurile, Gantt-ul și metodologia lipsă nu se mai pot aduce. Documentele de calificare care existau dinainte se pot aduce (BO2025_2118, BO2023_140, BO2024_2636, BO2022_340).
2. **Corecturile de preț la clarificări trebuie să rămână cumulat sub 1%** și să fie strict aritmetice (BO2024_159, BO2021_1060).
3. **Sub 80% din VE, justificarea se dă cu documente pentru fiecare articol cerut,** cu prețuri identice cu cele din C6/F3, fără reducerea cantităților din SEAP (BO2023_1788, BO2024_3130, BO2025_1138, BO2026_3104).
4. **„Similar” nu înseamnă „identic”.** Transportul, SRM-urile și branșamentele contează ca ES pentru gaze când textul cerinței permite (BO2023_1336, BO2023_1378, BO2023_2717, BO2024_2669).
5. **ES se dovedește cu procese-verbale anterioare termenului, confirmate de beneficiar,** cu valori individualizate. Acordul-cadru singur nu ajunge (BO2026_182, BO2023_140).
6. **Nu se respinge pe cerințe nescrise în DA.** Autorizațiile ANRE, AFER sau cele pentru personal, cerute doar în caietul de sarcini sau doar „recomandate”, țin de execuție (BO2024_1706, BO2026_2328, BO2024_1529, BO2022_2403).
7. **ANRE se cere doar celor care execută sau proiectează gaze.** Nu se cere managerului de proiect sau șefului de șantier. Într-o asociere, autorizația o are cel care face gazele. Practica e divergentă dacă AC poate cere ANRE tuturor (BO2024_2683, BO2024_1870, BO2024_3232 vs BO2024_3288).
8. **Declarăm fiecare executant real ca subcontractant,** inclusiv la asfalt, foraj sau CF. Un colaborator persoană fizică nu acoperă lipsa autorizației ANRE a firmei (BO2025_2344, BO2020_2191, BO2022_1615).
9. **La garanția de participare contează instrumentul valabil la termen, nu locul încărcării.** Prelungirea o cere AC (BO2020_2392, BO2022_1952, BO2026_15, BO2021_2420).
10. **Contestăm DA de la publicare, în 7 zile sub prag sau 10 peste, cu cauțiunea plătită.** Răspunsurile la clarificări care nu modifică DA nu redeschid termenul, dar răspunsurile evazive se pot ataca (BO2024_3155, BO2023_2119, BO2024_2938, BO2024_3657).
