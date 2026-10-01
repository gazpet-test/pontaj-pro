# Practica CNSC 2020–2026 — sinteză pe teme pentru Gazpet

**Baza:** 136 de decizii CNSC (69 apă-canal, 28 gaze, 18 distribuție, 21 lucrări generale), dintre care 55 de contestații admise, 39 admise parțial și 42 respinse. 109 decizii sunt pe Legea 98/2016 (achiziții clasice) și 27 pe Legea 99/2016 (achiziții sectoriale). Sursa este `docs/cercetare/cnsc_practica.json`. Unde există o regulă corectată, s-a folosit forma corectată.

**Ce e nou față de versiunea anterioară (90 de decizii):** s-au integrat 46 de decizii noi (loturile 3 și 4 de cercetare). S-au integrat și 3 decizii care erau deja în bază, dar nu fuseseră citate (BO2026_76, BO2024_3631, BO2023_406). Au apărut trei teme noi: 13 (ajustarea prețului și garanțiile din contract), 14 (anulări de procedură) și 15 (procedurile sectoriale pe L99).

> **Atenție:** deciziile CNSC sunt **practică de interpretare**, nu precedent obligatoriu. CNSC nu e legat de soluțiile anterioare, iar o decizie poate fi schimbată în instanță (BO2026_13). Regulile de mai jos arată cum a judecat CNSC până acum. Nu sunt lege. Unde practica e divergentă, o spunem explicit.

**Cum citești numerele:** „admisă” înseamnă că a câștigat contestatorul (care putea fi ofertantul respins sau un concurent). Decizia apare la o temă dacă are eticheta temei respective. O decizie poate apărea la mai multe teme. Temele 12 și 14 nu au etichetă proprie, așa că deciziile lor au fost selectate după conținutul textului.

---

## 1. Respingerea ofertei: NECONFORMĂ vs INACCEPTABILĂ

**(a) Regulile extrase**

1. **Oferta e neconformă când lipsește conținut tehnic cerut EXPRES în DA.** Exemple: proceduri tehnice de execuție pe categorii de lucrări, activități „obligatorii” în Gantt, drum critic, metodologie proprie în locul unei copii după caietul de sarcini. Aceste lipsuri nu se acoperă la clarificări (BO2025_2118, BO2023_140, BO2024_632, BO2025_1775, BO2022_2768, BO2025_3638, BO2021_2116, BO2026_3104). Formulele generice de tipul „se vor respecta” fac oferta neconformă dacă DA le interzice expres (BO2025_3638).
2. **Fișele tehnice (F5) completate doar cu „CONFORM” sau cu „conform detalii de proiect” fac oferta neconformă.** Trebuie scrise caracteristicile concrete, producătorul și modelul. Un manual de producător cu mai multe variante constructive nu ține loc de angajament pentru un model anume. Lipsa nu e viciu de formă, iar AC nu e obligată să ceară clarificări (BO2026_1837 — robinete cu sferă pe gaze; BO2025_806).
3. **Orice cerință minimă din formularele DA trebuie acoperită în ofertă:**
   - la proiectare plus execuție (P+E), planșele de organizare a execuției, schema monofilară și proiectul de organizare de șantier cerute la ofertă nu se pot amâna pe motiv că „PT se face ulterior” (BO2025_1704);
   - dacă lista de cantități a AC are articol de deviz (de exemplu epuismente), metodologia trebuie să trateze lucrarea. Materialul ofertat trebuie să acopere integral specificația, de exemplu balast 0–63 mm față de 0–70 mm cerut (BO2025_434);
   - tabelul drumului critic se face exact pe coloanele formularului AC (BO2025_3667). Graficul general, Gantt-ul și diagrama drumului critic sunt trei documente distincte când fișa de date le cere pe toate (BO2025_2237);
   - la reofertarea dintr-un acord-cadru, relațiile de ordine impuse între prețurile unitare devin obligatorii. Încălcarea lor, chiar la sporuri de 0,10 lei, face oferta neconformă (BO2021_2679).
4. **Oferta devine inacceptabilă din trei cauze:** răspunsul neconcludent la clarificări (art. 134 alin. 5 HG 395), modificarea ofertei prin clarificări (art. 134 alin. 6) și depășirea pragului de 1% (art. 134 alin. 9). Deciziile-sursă: BO2023_657, BO2023_246, BO2024_159, BO2021_1060, BO2020_2191, BO2025_1138, BO2025_2853. Calificarea (DUAE) se judecă pe art. 137 alin. 2 lit. b, dar acest temei e greșit pentru garanția de participare (BO2026_15).
5. **Nu se respinge pentru cerințe care nu sunt scrise în DA.** Exemple: atestate, detalii Gantt, PCCVI sau planuri nesolicitate (BO2024_1706, BO2026_2328, BO2024_203, BO2023_665). Nici pentru greșeli de redactare care nu afectează conținutul (Decizie_271). Nici pentru omisiuni punctuale într-o ofertă voluminoasă, de exemplu o verificare lipsă din PCCVI sau o declarație de disponibilitate depusă ulterior: acestea sunt abateri tehnice minore (BO2025_1524). Un avantaj punctabil nedocumentat (garanție extinsă, „avantaje competitive”) duce cel mult la pierderea punctajului, nu la respingere (BO2026_544).
6. **Același standard pentru toți ofertanții.** Dacă la câștigător comisia citește Gantt-ul împreună cu restul ofertei, trebuie să facă la fel și la ceilalți (BO2022_2053). Comisia trebuie să consemneze concret cum a verificat fiecare cerință la fiecare ofertă. Altfel evaluarea se reia (BO2025_2237).
7. **Practica e divergentă la Gantt și la copierea caietului de sarcini.**
   - *Gantt:* BO2022_2053 și BO2026_544 consideră respingerea pentru forma Gantt-ului (procente, WBS, legendă) disproporționată. BO2022_1964, BO2024_717, BO2025_1775 și BO2025_3667 o mențin. Granița este dacă elementul era **cerut expres** în DA sau în formular. Când termenul de execuție e factor de evaluare, Gantt-ul trebuie să arate resursele pe activitate și planul pe fiecare asociat sau subcontractant (BO2024_717).
   - *Copierea caietului de sarcini:* când DA o interzice, copierea în locul metodologiei face oferta neconformă, chiar și la câștigătorul care a fost proiectantul lucrării (BO2025_1775, BO2022_1028). În schimb, preluarea unor pasaje din caiet într-o propunere tehnică de mii de pagini nu e motiv de respingere (BO2025_2114).

**(b) Cum o folosim în Ofertare**
- Înainte de depunere facem un checklist cu tot ce DA cere „obligatoriu” sau „expres” în propunerea tehnică: proceduri pe fiecare categorie (inclusiv SRM, foraj, traversări), Gantt cu drum critic continuu, resurse pe activitate și metodologie scrisă pentru obiectivul concret (PAT-AMB-11). Nu folosim texte copiate din alte oferte (BO2026_3104).
- Fișele F5 le completăm rând cu rând: DN, PN, material, tip de acționare, producător, cod de model și pagina din catalog. O celulă goală sau cu „conform” blochează exportul. Pentru materialele cu specificații ale operatorului de distribuție folosim PAT-STD-11.
- Facem o matrice „cerință din formular → fișier sau pagină din propunerea tehnică”. Fiecare articol din F3 trebuie să aibă un capitol în metodologie. Dacă un articol de deviz impus de AC contrazice caietul de sarcini, aplicăm PAT-AMB-10.
- Dacă DA e neclară despre nivelul de detaliu al Gantt-ului, aplicăm PAT-TRM-01. Dacă documentele DA se contrazic, aplicăm PAT-CTR-01. Dacă la P+E se cer la ofertă documente care țin de PT, aplicăm PAT-AMB-01 înainte de depunere, nu după.
- Motiv de contestare: respingerea pe o cerință care nu e scrisă în DA, respingerea pentru omisiuni minore sau tratamentul inegal față de câștigător.

**(c) Numărul de decizii:** 41 (18 admise, 11 admise parțial, 12 respinse).

---

## 2. Prețul neobișnuit de scăzut (PANS), devizul și justificarea prețului

**(a) Regulile extrase**

1. **Pragul de ~80% din valoarea estimată obligă la justificare,** dar prețul mic nu e singur motiv de respingere. AC trebuie să ceară explicit justificarea și să arate că lucrarea nu se poate executa la acel preț (BO2021_448, BO2025_104 la 65%, BO2025_2344 la 76,63%). La 88,52% nu există prezumția de PANS (BO2024_656). Peste prag, criticile fără probe nu obligă AC să verifice, iar contestația speculativă poate atrage plata cheltuielilor câștigătorului (BO2025_1699 la 86,79%, BO2022_2747 la 83,59%, BO2024_2604 la 97,4%).
2. **Practica e divergentă la elementele de cost peste pragul de 80%:**
   - BO2023_2695 obligă AC să ceară justificarea unui **element** aparent neobișnuit de scăzut, chiar dacă totalul trece de 80%. Exemplu: organizarea de șantier ofertată la 16.000 lei, față de 427.425 lei estimați. BO2024_3215 (tablouri electrice cotate la 1 leu) și BO2022_219 (organizare de șantier cu repere la 1 leu) merg în aceeași direcție;
   - BO2024_2604 spune că peste 80% AC nu e obligată să verifice elementele de cost (cheltuieli indirecte de 3%);
   - BO2020_2251 (sectorial) apreciază subevaluarea pe obiecte sau capitole de deviz, nu articol cu articol. Transportul cotat 0 e justificat dacă furnizorul livrează la șantier.
3. **Cererea de justificare trebuie să fie punctuală,** cu repere obiective verificabile (cotații, buletine statistice). Altfel poate fi contestată și anulată direct (BO2024_656). Pe de altă parte, AC poate verifica prețuri unitare aparent scăzute chiar dacă totalul nu e sub prag (BO2024_3130).
4. **Ce n-a trecut:**
   - simpla enumerare de costuri, „rezerva din profit” sau orele declarate fără documente (BO2023_1788);
   - simpla defalcare a sumei fără înscrisuri, de exemplu 12.000 + 4.000 lei pentru organizarea de șantier (BO2024_449);
   - declarația că un element e „inclus în prețul echipamentelor”, fără oferte de la furnizori (BO2024_3215);
   - răspunsul selectiv, de exemplu justificarea a 9 articole din 142 cerute (BO2024_3130);
   - justificarea parțială a prețurilor diferite pentru aceeași resursă (BO2022_1923). Prețurile unitare diferite pentru aceeași operațiune, interzise de fișa de date, nu se mai pot corecta la clarificări (BO2022_219);
   - documente care nu susțin exact prețul din C6/F3, de exemplu mixtură justificată la 76,20 lei/t, deși ofertată la 110 lei/t (BO2025_1138);
   - reducerea cantităților din listele SEAP pe motiv de „consumuri proprii” (BO2026_3104);
   - organizarea de șantier cerută ca poziție distinctă și „ascunsă” în cheltuieli indirecte și profit (BO2025_1639);
   - un executant real care nu a fost declarat subcontractant (BO2025_2344).
5. **Ce a trecut:** o justificare care acoperă manopera, materialele, utilajele și obligațiile legale, cu documente (oferte de la furnizori, fișe de inventar, facturi, state de plată). Aceasta se analizează pe fond, iar neclaritățile se clarifică suplimentar (BO2025_104, BO2021_448). Critica „manoperă sub salariul minim” cade dacă e calculată greșit, de exemplu cu concediul adăugat peste orele lucrate (BO2020_2124). Un tarif de manoperă de 28 lei/oră a rămas în picioare pentru că nu a fost criticat concret (BO2025_1639).
6. **Comisia trebuie să analizeze efectiv justificarea.** Copierea răspunsului ofertantului și concluzia generică „prețul nu e neobișnuit de scăzut” nu sunt evaluare. Costurile omise nu se „acoperă” automat din marja de profit (BO2025_3699). La reevaluarea dispusă de CNSC, AC care doar inventariază răspunsul nu execută decizia (BO2024_449).
7. **Nu există normă care să plafoneze organizarea de șantier.** ANAP a cerut chiar eliminarea plafonării în DA (BO2025_1699). Dotările proprii nu scutesc de includerea costului lor (amortizare, transport, montaj) (BO2023_2695, BO2022_219).

**(b) Cum o folosim în Ofertare**
- La orice ofertă sub 80% din VE pregătim dosarul de justificare **înainte** de depunere: oferte de la furnizori, stat de plată, costuri orare pentru utilaje, fișe de mijloace fixe cu amortizare, cu prețuri identice cu cele din C6–C9 și F3.
- Control pe capitole, chiar dacă totalul trece de 80%: dacă organizarea de șantier, proiectarea sau asistența tehnică sunt mult sub devizul general al AC, apare alerta „risc preț neobișnuit pe element” (BO2023_2695). Organizarea de șantier o cotăm distinct și realist. Dacă DA o plafonează, aplicăm PAT-AMB-05.
- Folosim un preț unitar unic pe resursă în toate devizele (PAT-AMB-04). Nu modificăm cantitățile din F3. Contradicțiile le ridicăm la clarificări (PAT-CTR-02, PAT-AMB-03).
- Control de plauzibilitate: orele de manoperă din C7/C8 împărțite la echipe și ore pe zi trebuie să încapă în zilele din Gantt (BO2025_3667).
- La cererea de justificare răspundem la **fiecare** articol cerut, cu documente. Dacă cererea e vagă, o putem contesta (BO2024_656).
- Motive de contestare: câștigătorul e sub 80% și nu i s-a cerut justificarea (BO2025_2344), a redus cantitățile (BO2026_3104) sau comisia i-a copiat justificarea fără analiză (BO2025_3699). Peste 80% contestăm doar cu calcule concrete pe capitole, altfel riscăm cheltuielile (BO2025_1699).

**(c) Numărul de decizii:** 24 etichetate PANS (11 admise, 6 admise parțial, 7 respinse). Alte 22 de decizii sunt etichetate „deviz și consumuri” și se suprapun parțial cu această temă.

---

## 3. Experiența similară (ES)

**(a) Regulile extrase**

1. **„Similar” nu înseamnă „identic”.** ES se judecă după textul publicat și după complexitate. Conductele de transport și SRM-urile sunt similare sau superioare distribuției când cerința spune „infrastructuri de gaze” (BO2023_1336, BO2023_1378, Decizie_3952 — aceasta din urmă nuanțată: nu e o regulă generală pentru cerințele limitate strict la distribuție). Branșamentele și extinderile de distribuție contează ca ES (BO2023_2717). Lucrările de canalizare, mai complexe, se iau în calcul la ES cerută pentru apă și branșamente (BO2021_610). O ES cerută identică cu obiectul sau limitată la tipul exact de rețea e restrictivă (BO2024_2669, BO2023_1489).
2. **Numărul de contracte și perioada de referință:**
   - limitarea ES la 1–2 contracte, nemotivată în strategia de contractare, e restrictivă (BO2026_1536);
   - la lucrări de complexitate ridicată (conductă de transport DN700, subtraversare de Dunăre prin foraj orizontal dirijat), entitatea poate cere 10 ani, cel mult 3 contracte și un foraj cu lungime și diametru minime. Cine susține că cerința favorizează pe cineva trebuie să o dovedească (BO2026_804).
3. **Ce dovedește ES:**
   - recepția parțială pe obiecte funcționale independent (BO2024_942);
   - procesul-verbal de stadiu fizic, acceptat la evaluarea pe fond (BO2026_182);
   - acordul de subcontractare, în cazul concret din BO2026_2480;
   - studiile de teren din contractele de SF, care intră în ES de proiectare (BO2025_1138);
   - documentațiile tehnice din domeniul gazelor, care sunt servicii de proiectare (BO2022_2403).
4. **Ce NU dovedește ES:**
   - acordul-cadru fără contractele subsecvente. Acestea se indică încă din DUAE (BO2023_140);
   - procesul-verbal emis după data-limită de depunere (BO2026_182);
   - recomandările semnate doar de diriginte, neconfirmate de beneficiar (BO2026_182);
   - lucrările făcute ca subcontractant fără valoare individualizată (BO2026_182).
5. **Comisia trebuie să verifice efectiv documentele suport pe fiecare componentă a ES** (BO2026_2328). Nu poate respinge doar după denumirea contractului (BO2026_1360, BO2023_2717). Nu poate exclude o parte a unui contract mixt, de exemplu canalizarea (BO2021_610). Motivele de respingere sunt doar cele scrise în comunicarea rezultatului (BO2023_1378).

**(b) Cum o folosim în Ofertare**
- Ținem un registru intern de contracte cu procese-verbale de recepție pe obiecte, confirmări ale beneficiarului (Delgaz, Distrigaz), valori individualizate pe subcontractare și pe categorii (gaze, apă, canalizare) și date anterioare termenului de depunere (PAT-CAL-07). Registrul ține și lucrările de foraj orizontal dirijat cu lungime, DN și PV, pentru asocieri pe transport gaze (BO2026_804).
- Dacă DA cere ES „identică”, doar pe tipul de rețea din obiect sau în 1–2 contracte fără motivare, cerem clarificări sau contestăm (PAT-CAL-05). Dacă cere contracte „finalizate în ultimii 5 ani” sau un plafon peste VE, folosim PAT-CAL-06.
- Contractele de transport, SRM sau branșamente le invocăm când textul cerinței permite. La respingere contestăm, pe baza BO2023_1336 și BO2023_1378.

**(c) Numărul de decizii:** 26 (10 admise, 12 admise parțial, 4 respinse). Contestatorii au câștigat de cele mai multe ori.

---

## 4. Personalul cheie

**(a) Regulile extrase**

1. **Autorizarea ANRE se cere doar celor care proiectează sau execută efectiv.** Impusă managerului de proiect, șefului de proiect sau șefului de șantier, e restrictivă (BO2024_1870, BO2024_2683). Experiența cerută strict „în gaze” pentru manager se elimină dacă nu e justificată (BO2026_1237). Comisia nu poate transforma o cerință de autorizare a **firmei** (ANRE gaze sau electric, AFER) într-o cerință de autorizare a **personalului** (BO2026_544).
2. **Calificările personalului cerute doar în caietul de sarcini, doar „recomandate” sau doar generic** („toate autorizațiile din legislație”) **nu pot fundamenta respingerea** (BO2026_2328, BO2024_717, BO2024_1706).
3. **Granița dintre confirmare și completare:**
   - *confirmare admisă:* oferta inițială arată că firma dispune de personal (număr, DUAE, Revisal), iar nominalizarea și autorizațiile depuse la clarificări doar confirmă (BO2022_340, BO2023_562, BO2024_2884). Tot confirmare sunt recomandările depuse la clarificări pentru contracte, PV sau decizii de numire aflate deja în ofertă (BO2025_806). Declarațiile de disponibilitate cu dată greșită (BO2023_665) și numele greșit al expertului, când documentele sunt corecte (BO2024_697), sunt vicii de formă;
   - *completare interzisă:* DA cere ca personalul să fie nominalizat, cu atestate și dovada disponibilității, ca anexă la propunerea tehnică, iar ofertantul doar reproduce calificările minime și aduce numele și documentele la clarificări. Asta modifică oferta (BO2025_2430 — conducte de gaze de înaltă presiune). La fel, documentele de experiență lipsă pentru RTE-ii ceruți nu se mai pot depune (BO2025_3788).
4. **Cerințele formale clare din DA** (CV semnat, dovezi de experiență) nu mai pot fi contestate după depunere, iar lipsa lor e fatală (BO2024_1699). Un răspuns la clarificări necontestat, care precizează că se cer 4 RTE și că experiența se dovedește pentru fiecare, devine obligatoriu (BO2025_3788). Experiența expertului se raportează la data autorizării lui ANRE: comisia trebuie să verifice perioadele (BO2026_182).
5. **Echivalența funcțională se acceptă.** Experiența de șef de șantier pe rețele de apă-canal acoperă cerința pentru „inginer instalații hidroedilitare”, dacă studiile sunt în domeniu (BO2025_806). O diplomă de inginer de instalații se încadrează într-o cerință formulată nelimitativ („etc. sau echivalent”) (BO2025_1524).
6. **Punctajul pe experți se acordă doar pe documentele din ofertă la data-limită.** Recomandările depuse ulterior nu contează. Deciziile interne de numire nu țin loc de recomandări ale beneficiarilor (BO2025_2858). Pragurile de punctaj pe numărul de proiecte ale experților (2–4, 5–8, peste 8) sunt legale dacă sunt justificate în strategie (BO2026_1536).
7. **Interdicția aceluiași expert pe mai multe loturi trebuie motivată** (BO2023_2119). Revisal, declarațiile de disponibilitate, backstopping și asigurarea RC cerute la ofertare au fost eliminate de AC în cursul contestației (BO2025_833).

**(b) Cum o folosim în Ofertare**
- Verificare internă înainte de depunere: legitimațiile ANRE și ISCIR ale experților sunt valabile și la Gazpet, iar datele autorizării sunt anterioare proiectelor invocate (PAT-CAL-12, PAT-CAL-11).
- ERP generează o „Anexă Personal” cu nume, rol, atestat (EGD/EGT, RTE, ISCIR, SSM, Ex) și dată de valabilitate, plus dovada disponibilității. Exportul se blochează dacă lipsește un rol cerut (BO2025_2430). Pentru factorii de punctaj atașăm recomandări sau PV semnate de beneficiar pentru **fiecare** proiect declarat (BO2025_2858).
- Cerem clarificări pe terminologia veche din DA („gradul II”, „RTE pentru gaze”), după PAT-CAL-04, și pe regulile pentru experți comuni pe loturi, după PAT-CAL-10. Orice răspuns al AC care schimbă cerințele de personal îl contestăm în termen, altfel devine obligatoriu (BO2025_3788).
- Motiv de contestare a DA: ANRE cerut managerului sau șefului de șantier (PAT-CAL-15, BO2024_2683). Motiv de contestare a rezultatului: concurentul și-a nominalizat personalul abia la clarificări (BO2025_2430).

**(c) Numărul de decizii:** 25 (5 admise, 12 admise parțial, 8 respinse).

---

## 5. Atestări și autorizări ANRE (firmă, asociați, subcontractanți, persoane)

**(a) Regulile extrase**

1. **O autorizație care nu e cerută în anunț sau în fișa de date nu poate fi motiv de respingere.** Ține de execuție. Exemple: ANRE EDSB pentru firmă, ANRE PT, ANRE pentru instalații electrice, AFER, autorizații pentru apă (BO2026_1360, BO2022_2403, BO2024_1529, BO2023_416, BO2022_1746, BO2022_340). Autorizațiile și avizele puse în caietul de sarcini în sarcina antreprenorului nu devin cerințe de calificare (BO2022_2747, sectorial).
   - **Excepție:** fișa de date cere dovada capacității pentru TOATE activitățile, iar caietul de sarcini include expres o activitate autorizată. Exemplu: AFER pentru subtraversare de cale ferată (BO2020_2191). Tot așa, dacă DA cere informații despre autorizările pentru toate activitățile, inclusiv devieri de rețele de gaze, ofertantul trebuie să arate în propunerea tehnică cine le deține: el, un asociat sau un subcontractant declarat. O autorizație IGSU sau una a unui asociat pe alt domeniu nu suplinește autorizația pentru gaze (BO2026_328).
   - **Nuanță:** AC trebuie să verifice capacitatea legală doar dacă activitatea e efectiv necesară (BO2021_159).
2. **Autorizația de firmă nu se confundă cu cea a persoanelor.** Dacă fișa de date cere autorizarea operatorului economic (ANRE gaze după Ord. 132/2021, ANRE electric, AFER), oferta nu poate fi respinsă pe lipsa autorizațiilor personalului (BO2026_544).
3. **Când autorizația ANRE e cerută, trebuie să o aibă firma, un asociat sau un subcontractant declarat.** Un instalator persoană fizică colaborator (BO2022_1615) sau un „colaborator” nedeclarat subcontractant (BO2026_328) nu acoperă lipsa autorizației de firmă.
   - **Practică divergentă** despre cine trebuie autorizat:
     - BO2024_3288 permite AC să ceară ANRE de la toți asociații, terții tehnici și subcontractanții de pe partea de gaze;
     - BO2024_3232 spune că ajunge membrul sau subcontractantul care execută efectiv gazele, nu toți;
     - BO2022_2768 și BO2025_1248 susțin BO2024_3232, dacă repartizarea sarcinilor e clară în ofertă (în BO2025_1248, asociatul cu atestat ANRE tip Be executa doar instalațiile electrice, 2%).
4. **Orice intervenție fizică pe sistemul de gaze cere autorizație ANRE, chiar și în contracte de drumuri** (răsuflători, cutii, branșamente). Dacă AC întreabă, autorizația se prezintă la clarificare, nu mai târziu (BO2023_657).
5. **Dacă DA cere doar ca lucrarea de gaze să fie executată de un operator autorizat,** ofertantul poate folosi un contract cu o firmă autorizată fără să o declare subcontractant (BO2021_973).

**(b) Cum o folosim în Ofertare**
- La fiecare DA verificăm tipul de autorizație cerut față de regimul de presiune și Ordinul ANRE în vigoare (PAT-CAL-01). Verificăm și dacă autorizația se cere la ofertă sau la execuție (PAT-AMB-06, PAT-CAL-14). La extragerea cerințelor marcăm explicit „autorizare firmă” sau „atestat personal” (BO2026_544).
- În propunerea tehnică punem un tabel „activitate → autorizare necesară → titular (Gazpet, asociat, subcontractant) → nr. document” (BO2026_328). În asocieri scriem explicit cine execută partea de gaze (PAT-CAL-02).
- **Oportunitate:** la contractele de apă-canal cu devieri, protejări sau traversări de conducte de gaze, Gazpet se poate oferi ca asociat sau subcontractant declarat, cu autorizația ANRE a firmei (BO2026_328, BO2026_544). Pentru aceste contracte folosim PAT-CAL-03. La cereri ISCIR fără obiect, folosim PAT-STD-09.
- Nu contestăm concurenții pentru autorizații necerute în DA, pentru că șansele sunt mici (BO2023_416, BO2024_1529, BO2022_2747).

**(c) Numărul de decizii:** 22 (8 admise, 6 admise parțial, 8 respinse).

---

## 6. DUAE și documentele suport

**(a) Regulile extrase**

1. **Informația de calificare trebuie declarată efectiv în DUAE la depunere.** Exemple: cash-flow cu valoare și sursă, contractele de ES, inclusiv cele subsecvente unui acord-cadru. Omisiunea e de fond și nu se repară prin DUAE revizuit (BO2026_1360, BO2023_140). Corectarea unei erori din DUAE e permisă (BO2023_140).
2. **Completarea greșită a unei rubrici nu e omisiune.** Exemple: DUAE care nu separă proiectarea de execuție (BO2022_340); un indicator de bilanț trecut în locul modalității de dovedire a cash-flow-ului, dacă la clarificări ofertantul confirmă îndeplinirea și indică modalitatea. Documentele se cer doar primului clasat, iar respingerea în faza DUAE e excesiv formalistă (BO2025_2767). Un DUAE al subcontractantului încărcat ca „ofertant unic” se corectează prin DUAE revizuit (BO2022_219). Lipsa DUAE revizuit după înlocuirea terțului susținător trebuia cerută de AC, nu sancționată (BO2024_697).
3. **Un document care exista înainte de depunere și a fost omis poate fi adus la clarificări.** Exemple: un atestat, certificatul ONRC (BO2024_2636); extrase de cont din alte bănci, datate înainte de termen, când extrasul inițial era ușor sub prag (BO2024_2990). Documentele suport se cer în forma din DA, fără formalități suplimentare precum „conform cu originalul” (BO2026_362).
4. **Documentul trebuie să fie valabil la data-limită.**
   - certificatele ISO ale fiecărui asociat trebuie să aibă viza anuală de supraveghere la termen și la prezentare. Nu pot fi înlocuite cu certificate obținute după contestație (BO2025_204, sectorial);
   - un aviz sanitar emis după termen se acceptă doar dacă confirmă o situație existentă la termen. Dacă agrementul acoperă alte diametre decât cele cerute, AC trebuie să lămurească (BO2024_3215).
5. **Comisia trebuie să verifice efectiv documentele suport** față de DUAE (BO2026_2328) și să clarifice neconcordanțele, de exemplu procentul de subcontractare față de grafic (BO2021_1117). Dacă știe din alt dosar că autorizația AFER a subcontractantului a fost reînnoită, nu poate respinge pe expirarea ei (BO2021_610). Lipsa codului CAEN pentru activități secundare nu e motiv de respingere dacă DA nu-l cere (BO2023_246).
6. **Motivele de excludere se declară transparent.** Un document constatator negativ (contract reziliat) duce la excludere dacă firma nu dovedește măsuri concrete de autocorectare. O acțiune în instanță respinsă nu ajunge (BO2024_697).
7. **Dovezile care costă se cer la ofertare doar ca declarație.** Teren pentru organizarea de șantier, liste nominale de muncitori sau documente de la producători: la ofertă ajunge un angajament, iar dovada o dă câștigătorul (BO2026_809).

**(b) Cum o folosim în Ofertare**
- Completăm DUAE cu cifre concrete, nu formule sau fraze la viitor. Indicăm contractele subsecvente și sursa cash-flow-ului. La cerințele financiare scriem modalitatea de dovedire („extras de cont / linie de credit / scrisoare bancară”), nu indicatori de bilanț (BO2025_2767). Pentru fiecare asociat completăm rubricile lui (PAT-CAL-16).
- Registrul de certificări ține data certificării și datele vizelor anuale, cu alertă înainte de audit. Facem aceeași verificare la partenerii de asociere înainte de semnarea acordului (PAT-CAL-13, BO2025_204).
- Dosarul de materiale PE (agrement, aviz tehnic, aviz sanitar) se verifică pe intervalul de diametre și pe data emiterii față de termen (BO2024_3215).
- Ținem un registru al documentelor constatatoare negative (ale noastre, ale asociaților, terților și subcontractanților) cu dosar de autocorectare gata de depus (BO2024_697).
- Documentele suport (PAT-CAL-07, PAT-CAL-13) le pregătim înainte de depunere, chiar dacă se cer doar locului I. Dacă primim o cerere de clarificări vagă, o putem contesta (BO2026_362).

**(c) Numărul de decizii:** 34, din care 15 etichetate DUAE și 26 documente de calificare (19 admise, 10 admise parțial, 5 respinse).

---

## 7. Garanția de participare (GP)

**(a) Regulile extrase**

1. **Contează existența instrumentului valabil la data-limită, nu locul sau modul în care a fost încărcat.** GP încărcată în altă secțiune SEAP sau depusă fizic se clarifică, nu se sancționează (BO2020_2392, BO2022_1952). GP plătită de un subcontractant în favoarea ofertantului, cu destinație clară, e valabilă (BO2022_2170). Dacă fișa de date cere doar postarea scanată în SEAP, AC nu poate cere originalul prelungirii (BO2021_610).
2. **Lipsa instrumentului la termen nu se poate remedia.** Un mesaj SWIFT nu e scrisoare de garanție, iar la clarificări nu se poate aduce un instrument nou (BO2021_2420). O garanție cu valabilitate prea scurtă (4 luni în loc de 16) nu se repară cu o garanție **nouă** de la alt emitent. Se poate doar prelungi sau corecta instrumentul depus la termen (BO2023_2794).
3. **Neconcordanțele de formă se repară prin act adițional la același instrument.** O poliță emisă doar pe numele liderului, după semnarea acordului de asociere, se corectează prin act adițional care menționează asocierea (BO2024_1043). O cerere de clarificări care citește polița altei asocieri nu e „clară și explicită”, deci lipsa răspunsului nu justifică respingerea (BO2022_219).
4. **Prelungirea GP o cere AC și trebuie să dovedească transmiterea cererii.**
   - ofertantul nu are obligația să o prelungească din proprie inițiativă, iar GP nu e criteriu de calificare (BO2026_15);
   - fără dovada transmiterii cererii (de exemplu în SEAP), respingerea pentru neprelungire cade (BO2025_1037, sectorial);
   - lipsa răspunsului la o cerere nu e fatală dacă la cererea următoare ofertantul prelungește, iar la data raportului oferta și garanția sunt valabile (BO2024_2604);
   - o declarație de prelungire semnată electronic în SEAP ajunge, dacă AC nu cere formular nou (BO2021_610). O prelungire fără semnătură electronică extinsă, confirmată ulterior, nu justifică respingerea (BO2024_697);
   - refuzul unei prelungiri peste perioada din fișa de date nu face oferta neconformă (BO2021_99). Neprelungirea după respingere nu înlătură interesul de a contesta (BO2025_1775).
5. **Condițiile impuse emitentului** (rating, tip de bancă) trebuie justificate și proporționale (BO2021_1317). **Atenție la IFN-uri:** într-o licitație de gaze, AC a respins o GP emisă de un IFN străin. CNSC nu s-a pronunțat pe fond, pentru că nu s-a plătit cauțiunea (BO2025_1883). Riscul rămâne.

**(b) Cum o folosim în Ofertare**
- Verificăm înainte de depunere: cuantumul, valabilitatea cel puțin egală cu perioada din fișa de date, forma instrumentului (scrisoare sau poliță originală, în limba română), emitentul (bancă sau asigurător, nu IFN) și încărcarea în secțiunea corectă (PAT-GAR-01).
- În asociere, instrumentul se emite pe numele **asocierii** și conține mențiunea „acoperă în mod solidar toți membrii” (BO2024_1043, BO2022_219).
- Ținem un registru al cererilor de prelungire, cu alertă zilnică pe SEAP și pe e-mail. Răspundem prin act adițional la **aceeași** poliță, semnat electronic (BO2025_1037, BO2023_2794).
- Prelungim GP doar la cererea AC, dar răspundem prompt. Condițiile pentru emitent se contestă la DA.

**(c) Numărul de decizii:** 18 (7 admise, 5 admise parțial, 6 respinse).

---

## 8. Clarificările la ofertă: ce POATE și ce NU POATE cere sau accepta AC (art. 209 L98, art. 134–137 HG 395)

**(a) Regulile extrase**

1. **Clarificarea poate doar explicita sau confirma ce exista deja în ofertă.** Completarea care schimbă conținutul tehnic sau prețul e interzisă (BO2022_2774, BO2025_2118, BO2024_632, BO2020_2191). Granița practică:
   - **se pot aduce sau explica:** documente preexistente de calificare sau personal (BO2024_2636, BO2022_340, BO2023_562, BO2024_2990); repartizarea sarcinilor în asociere, prin trimitere la acordul de asociere și la atestatele deja depuse (BO2025_1248); centralizatorul lucrărilor subcontractate, când acordurile existau (BO2025_1639); recomandări care confirmă documente din ofertă (BO2025_806);
   - **nu se pot adăuga:** proceduri, metodologii, Gantt (BO2023_140, BO2025_1221, BO2025_3638); planșe și scheme cerute la P+E (BO2025_1704); valori în fișele F5 (BO2026_1837); nominalizarea personalului cerută în propunerea tehnică (BO2025_2430); recomandări noi pentru punctaj (BO2025_2858); oferte de la furnizori cerute în propunerea financiară (BO2022_2747); o garanție nouă (BO2023_2794);
   - **element nou** introdus la clarificări face oferta inacceptabilă, de exemplu garanția echipamentelor. Retransmiterea propunerii financiare nu e fatală dacă AC analizează doar ce a cerut (BO2025_187).
2. **Prețurile unitare nu se modifică la clarificări.** Corecția aritmetică se face la cererea comisiei și privește doar rezultatul operației (cantitate × preț), cu datele de intrare neschimbate (BO2025_2853, BO2025_3667). Pragul de 1% din propunerea financiară privește doar abaterile tehnice minore din propunerea tehnică, nu prețurile (BO2025_2853, BO2022_219). Schimbarea din proprie inițiativă a unor prețuri unitare face oferta inacceptabilă chiar sub 1% (BO2025_2853). 1,14% = ofertă inacceptabilă (BO2024_159). Majorarea unor poziții după justificarea prețului nu e eroare aritmetică (BO2021_1060). Nici modificarea valorilor pe asociați sau subcontractanți nu e (BO2025_1138).
3. **Comisia trebuie să califice motivat răspunsul.** Trebuie să spună dacă e viciu de formă, eroare aritmetică sau necorelare. Simpla consemnare „răspuns concludent” nu e evaluare (BO2026_1184). Fișele tehnice depuse prin clarificări cer o analiză motivată pe art. 134–135 HG 395 (BO2025_434). Necorelarea dintre propunerea tehnică și cea financiară se clarifică ca posibilă abatere minoră, iar lipsa valorii în litere e viciu de formă (BO2025_3699).
4. **Comisia nu poate repeta clarificările până „iese” oferta.** O a doua cerere care invită ofertantul să-și „revizuiască” propunerea creează avantaj nepermis (BO2025_1704). Aceeași solicitare nu se poate repeta (BO2025_3667). Răspunsul „se stabilește la execuție” e neconcludent dacă AC a prevăzut articol de deviz pentru acea lucrare (BO2025_434).
5. **Cererea AC trebuie să fie clară și punctuală.** Un răspuns rezonabil la o întrebare vagă nu poate fi declarat „neconcludent” (BO2022_1028). Cererea cu date greșite nu e „clară și explicită” (BO2022_219). Cererea vagă sau fără temei se contestă direct (BO2026_362, BO2024_656). O cerere pe care nu o contești devine obligatorie și trebuie respectată întocmai (BO2023_246).
6. **AC nu poate respinge direct pentru vicii de formă.** Exemple: semnătura electronică lipsă pe un răspuns care confirmă documente deja semnate (BO2023_562), declarații cu date greșite (BO2023_665), omisiuni punctuale într-o ofertă voluminoasă (BO2025_1524). Nici nu poate folosi o reevaluare dispusă de CNSC pentru a ridica neconformități noi (BO2024_3064). Contradicțiile din DA nu se întorc împotriva ofertantului (BO2023_665).

**(b) Cum o folosim în Ofertare**
- **Răspuns la clarificare:** confirmăm și trimitem la pagina din oferta inițială. Nu adăugăm conținut nou și nu retrimitem formulare financiare modificate.
- ERP face automat diferența dintre F3 inițial și F3 revizuit și blochează orice modificare de preț unitar nesolicitată. Se corectează doar rezultatul operației. Înainte de depunere verificăm că toate articolele și cantitățile AC sunt cotate (BO2025_2853).
- Cererea vagă sau peste lege o contestăm în termen (vezi tema 12). Dacă nu o contestăm, îi răspundem punct cu punct. Dacă cererea e greșită (altă poliță, altă ofertă), răspundem oricum pe fond și semnalăm eroarea (BO2022_219).
- Când cerem noi clarificări la DA despre ce se depune, folosim PAT-AMB-01 și PAT-TRM-01. Pentru prețul unic pe resursă folosim PAT-AMB-04.
- Motiv de contestare: comisia a acceptat la câștigător completări (personal, fișe, prețuri unitare) sau i-a cerut clarificări repetate (BO2025_1704, BO2025_3667).

**(c) Numărul de decizii:** 80, din care 79 etichetate clarificări la ofertă și 7 erori aritmetice (33 admise, 27 admise parțial, 20 respinse).

---

## 9. Modificarea documentației prin răspunsurile la clarificări

**(a) Regulile extrase**

1. **Un răspuns care NU modifică DA nu redeschide termenul de contestare.** Cerințele restrictive se atacă de la publicarea DA. Contestarea unui refuz motivat („nu se acceptă”) nu mai poate obține eliminarea cerinței (BO2024_3155). Un termen minim de execuție fixat în DA nu mai poate fi atacat ca „imposibil” după rezultat (BO2026_2480).
2. **Un răspuns care MODIFICĂ sau precizează DA devine parte din ea dacă nu e contestat.** Exemple: un răspuns care cere documentele de calificare chiar la depunere și exclude scrisorile de la IFN sau asigurători (BO2024_2990), un răspuns care precizează câți RTE se cer (BO2025_3788), condiționările de prețuri din invitația de reofertare la un acord-cadru (BO2021_2679). Criticile ulterioare sunt tardive.
3. **Un răspuns evaziv sau generic e atacabil**, de exemplu „DA respectă Legea 98” (BO2024_2938, BO2023_2119). Un răspuns care doar ajustează cifrele nu repară o cerință nelegală (BO2024_1870).
4. **Relaxarea sau precizarea cerințelor prin clarificare din oficiu nu se atacă cu succes** doar pentru că lărgește concurența (BO2024_1016) sau pentru că schimbă formularea ES (BO2026_804).
5. **Modificările acceptate se publică prin erată, cu nou termen de depunere** (BO2022_2083, BO2023_1128). Remedierile acceptate de AC trebuie publicate în SEAP (BO2026_1536). O clauză declarată „eliminată” prin clarificări, dar mutată în alt articol, rămâne nelegală, iar CNSC dispune eliminarea ei (BO2025_2294). Inconsecvențele dintre formulare, instrucțiuni și datele tehnice ale DA se remediază prin clarificări, cu nou termen de depunere (BO2026_1521). Termenele de clarificare de 1–2 zile lucrătoare, peste sărbători, sunt nelegale (BO2025_286).
6. **Viciile DA descoperite după depunere duc la anularea procedurii** (vezi tema 14).

**(b) Cum o folosim în Ofertare**
- Contestăm DA în termen de la publicare. Nu așteptăm răspunsul la clarificări (PAT-TRM-03).
- Fiecare răspuns la clarificări care schimbă ce se depune, când se depune sau cine poate emite documente îl marcăm în ERP ca cerință nouă, cu alertă de termen de contestare (BO2024_2990, BO2025_3788).
- La răspunsuri evazive revenim cu PAT-AMB-08. Dacă răspunsul modifică DA, dar documentul nu e republicat, folosim PAT-CTR-03. Dacă răspunsul vine prea târziu față de termenul de depunere, folosim PAT-TRM-02. Dacă termenele cad peste sărbători, folosim PAT-TRM-05.
- Înainte de a investi într-o ofertă verificăm concesiunea (PAT-INF-07) și corelarea VE pe lot (PAT-INF-11).

**(c) Numărul de decizii:** 26 (10 admise, 7 admise parțial, 9 respinse).

---

## 10. Terțul susținător, subcontractanții și asocierea

**(a) Regulile extrase**

1. **Cine execută efectiv o parte din lucrare trebuie declarat subcontractant**, inclusiv la refacerile de drum (BO2025_2344). Un subcontractant necesar pentru o autorizare specifică se declară la ofertare, nu în execuție (BO2020_2191, BO2026_328). Procentele de subcontractare declarate trebuie să corespundă valorilor ofertate (BO2025_1639).
   - **Excepție:** când DA cere doar „asigurarea” execuției de către un operator autorizat, firma poate fi furnizor (BO2021_973).
2. **Terțul susținător cu un motiv de excludere se înlocuiește o singură dată, la cererea AC** (BO2024_942, BO2023_2237, BO2020_2251). AC trebuie să ceară și DUAE revizuit pentru noul terț (BO2024_697).
3. **Subcontractantul care e și terț susținător trebuie să dea angajament ferm** și să indice resursele puse la dispoziție (BO2023_246). Subcontractantul fără cerințe de calificare completează în DUAE doar motivele de excludere (BO2022_219). Lista lucrărilor subcontractate poate rezulta din acordul de subcontractare (BO2021_610).
4. **În asociere, repartizarea sarcinilor trebuie să fie clară în ofertă.** Autorizația ANRE trebuie să o aibă cel care execută gazele (BO2022_2768, BO2024_3232, vezi divergența de la tema 5). Repartizarea și metodologiile nu se pot completa la clarificări (BO2025_1221), dar se pot explica prin trimitere la acordul de asociere cu procente și la atestatele depuse (BO2025_1248). Certificările cerute fiecărui asociat trebuie să fie valabile la termen (BO2025_204), iar GP se emite pe numele asocierii (BO2024_1043).
5. **Suspiciunile de înțelegere între ofertanți** nu duc la excludere fără indicii concrete. Excluderea cere punctul de vedere al Consiliului Concurenței (BO2026_2480).
6. **Specialiștii angajați prin contract de prestări servicii nu sunt subcontractanți sau terți.** Nu completează DUAE (BO2022_340).

**(b) Cum o folosim în Ofertare**
- Pentru fiecare ofertă facem o matrice „cine execută ce”: Gazpet, asociat, subcontractant (asfalt, foraj, electrice, CF). Fiecare executant e declarat cu procent în DUAE și apare în Gantt (BO2021_1117). ERP verifică automat că suma valorilor pe subcontractant împărțită la total este egală cu procentul declarat (BO2025_1639).
- Acordul de asociere tip Gazpet conține procentele și lista explicită a lucrărilor fiecărui asociat, corelate cu atestatele atașate (BO2025_1248). Pentru cumulul cerințelor în asociere folosim PAT-CAL-17, iar pentru ANRE prin asociat sau subcontractant, PAT-CAL-02.
- Pentru refacerea drumurilor și garanția lor folosim PAT-GAR-04. Pentru traversări folosim PAT-CNT-03.
- Motiv de contestare: un executant al câștigătorului care nu a fost declarat (BO2025_2344) sau procente de subcontractare necorelate (BO2025_1639).

**(c) Numărul de decizii:** 35, din care 27 etichetate terț sau subcontractant și 10 asociere (17 admise, 6 admise parțial, 12 respinse).

---

## 11. Cerințe restrictive și factori de evaluare

**(a) Regulile extrase**

1. **Sarcina probei e a contestatorului.** AC trebuie însă să justifice concret fiecare cerință în strategia de contractare. Atestatele străine de obiect se elimină (ANIF, alte tipuri). Cerințele justificate tehnic rămân, de exemplu trencher, SCADA, RMQ (BO2026_1237, BO2022_2083) sau foraj orizontal dirijat cu lungime și DN minime la transport gaze (BO2026_804).
2. **Ce s-a eliminat ca restrictiv:**
   - ES identică sau doar pe tipul de rețea (BO2024_2669, BO2023_1489), ori limitată la 1–2 contracte fără motivare (BO2026_1536);
   - prag valoric cumulat cu praguri cantitative (BO2024_1870);
   - indicatori financiari necorelați cu contractul: solvabilitate generală ridicată la un contract de 12 luni (BO2026_318), cash-flow pe 10 luni când plățile sunt lunare (BO2026_1536);
   - ANRE cerut managerului (BO2024_2683);
   - interdicția aceluiași expert pe mai multe loturi, nejustificată (BO2023_2119);
   - vizitarea amplasamentului ca o condiție de conformitate (BO2023_1128, BO2025_352);
   - dovezi costisitoare cerute la ofertare: teren pentru organizarea de șantier, liste nominale de muncitori, documente de la producători (BO2026_809);
   - elemente care țin de PT cerute la P+E (BO2024_3657).
3. **Practica e divergentă la listele de cantități cerute la P+E.** BO2025_352 consideră excesive listele F1–F3 și extrasele de resurse la nivel de articol de deviz când DA se bazează pe SF. BO2026_1521 admite cererea unor liste de cantități și consumuri **estimate**, ca să se fundamenteze prețul. Granița este nivelul de detaliu față de ce conține SF-ul. La cash-flow, BO2024_3232 a validat formula VE×n/durată justificată de AC, iar BO2026_1536 a cerut corelarea cu momentul primei plăți.
4. **Factorii de evaluare trebuie să aducă un avantaj real și verificabil.** Nu pot favoriza firmele locale: angajați din comună, mașini electrice (BO2024_3657). Un algoritm bazat pe noțiuni nedefinite viciază procedura (BO2025_1837). La P+E ponderea prețului e de cel mult 40% (BO2024_2683). Punctajul trebuie motivat pe fiecare factor (BO2025_3409, BO2021_1117) și se acordă doar pe documentele din ofertă (BO2025_2858). Un avantaj nedocumentat pierde punctajul, dar nu duce la respingere (BO2026_544).
5. **Ce a fost validat:**
   - factorii preluați din ghidul ANAP (BO2024_2669);
   - factorul calitativ pe metodologie („abordarea propusă”), chiar dacă nu toți primesc punctaj maxim (BO2026_1521);
   - pragurile de punctaj pe numărul de proiecte ale experților (BO2026_1536);
   - detalierea programului de execuție pe activități de cel mult 30 de zile (BO2026_809);
   - o combinație tipică de factori: preț 80%, termen de execuție 10%, garanția lucrărilor 10% (BO2025_2237);
   - cash-flow-ul calculat VE×n/durată, dacă AC îl justifică (BO2024_3232);
   - ANRE cerut tuturor celor de pe partea de gaze (BO2024_3288, divergent cu BO2024_3232);
   - cerințele refuzate motivat de AC (BO2024_3155).
6. **Evaluarea trebuie documentată.** Comisia consemnează verificarea fiecărei cerințe (BO2025_2237). Dacă se abate de la raportul expertului cooptat, o motivează în note individuale (BO2024_3631).

**(b) Cum o folosim în Ofertare**
- La analiza DA rulăm PAT-CAL-05, 06, 08, 09 și 13, plus PAT-AMB-01 și PAT-AMB-02. Mai întâi cerem justificarea la clarificări, apoi contestăm **cu probe** (cost, proporționalitate), nu doar prin afirmații.
- Gazpet folosește leasing și credite pentru utilaje, deci pragurile de solvabilitate sau de îndatorare excesive ne afectează direct. Le contestăm cu alternativele din BO2026_318: lichiditate curentă, disponibil minim, linii de credit (PAT-CAL-08).
- Pentru vizita obligatorie, terenul de organizare de șantier sau listele nominale la ofertare propunem „declarație pe propria răspundere, documente la câștigător” (BO2025_352, BO2026_809).
- Pentru factorul „experiența expertului” ERP ține evidența proiectelor fiecărui expert Gazpet, cu recomandări (BO2026_1536). Pentru factorul pe contractul colectiv de muncă folosim PAT-AMB-09.
- Pentru utilajele cerute specific pregătim un contract de închiriere, în loc să contestăm (BO2026_1237).

**(c) Numărul de decizii:** 42, din care 28 etichetate cerințe restrictive și 22 factori de evaluare (16 admise, 13 admise parțial, 13 respinse).

---

## 12. Aspecte procedurale la CNSC (termene, cauțiune, critici tardive, interes, executarea deciziilor)

**(a) Regulile extrase**

1. **Termenele de contestare sunt de 10 zile peste pragurile UE și de 7 zile sub prag** (art. 8 L101; BO2023_2119, cu termenul corectat). Termenul pentru criticile din dosar curge de la accesul efectiv la dosar (BO2026_182). Ziua expiră la ultima oră, așa că un e-mail trimis seara în ultima zi e în termen (BO2025_3638, BO2025_187). O contestație trimisă prin poștă în termen nu e tardivă (BO2025_1704).
2. **Fără cauțiune, contestația se respinge fără analiză** (BO2024_3657, BO2020_2392, BO2026_804, BO2025_1883). Cauțiunea se constituie din oficiu: în BO2026_804 CNSC arată că nu stabilește și nu comunică cuantumul. În BO2025_1883 CNSC a cerut-o prin e-mail, iar contestatorul nu a plătit-o nici atunci. Cauțiunea plătită în 5 zile, cu prelungire peste zilele nelucrătoare, e în termen (BO2024_1529).
3. **Criticile sunt tardive** dacă apar doar în concluziile scrise (BO2023_665), după studiul dosarului peste termen (BO2023_1788), sunt reluate după o respingere definitivă (BO2023_2185) sau vizează DA, răspunsuri la clarificări ori invitații de reofertare necontestate la timp (BO2025_3788, BO2024_2990, BO2021_2679, BO2026_2480).
4. **Interesul de a contesta:**
   - depunerea ofertei nu înlătură interesul de a ataca DA (BO2025_878, BO2024_2669);
   - o excludere necontestată devine definitivă și nu poate fi „reabilitată” (BO2023_2185). Ofertantul care nu și-a atacat respingerea nu mai are interes să atace ofertele admisibile și nu poate fi repus în termen (BO2026_1184);
   - cine nu poate înlătura câștigătorul nu are interes față de locurile inferioare (BO2024_203, BO2024_2884). Ofertantul cu ofertă corect respinsă nu are interes să critice câștigătorul (BO2025_806);
   - AC nu poate invoca la CNSC motive noi de respingere, nescrise în comunicare (BO2023_1378).
5. **Accesul la dosar:** nu poate fi refuzat pe confidențialitate nedovedită (BO2025_3409, BO2026_1837). Dacă ambele părți și-au declarat ofertele confidențiale, accesul nu se extinde la oferta integrală a concurentului (BO2024_1043).
6. **Executarea deciziilor și a hotărârilor:**
   - decizia CNSC rămasă definitivă și hotărârea curții de apel au putere de lucru judecat. AC trebuie să le execute pe fond, nu formal (BO2026_1184, BO2024_449);
   - dacă instanța desființează decizia CNSC, actele emise în executarea ei cad (BO2026_13);
   - reevaluarea dispusă de CNSC se face strict în limitele deciziei (BO2023_2185, BO2024_3064). **Nuanță:** la reevaluare, entitatea poate verifica aceeași cerință la toți ofertanții, din motive de tratament egal (BO2026_328).
7. **Cheltuielile de judecată:** contestatorul cu critici speculative poate fi obligat la cheltuielile câștigătorului intervenient (BO2025_1699). Onorariile de avocat se reduc frecvent (BO2025_2430, BO2026_76).

**(b) Cum o folosim în Ofertare**
- Ofertare trebuie să calculeze automat termenul de contestare (7 sau 10 zile, după prag) de la publicarea DA, a fiecărui răspuns la clarificări care modifică cerințe sau a rezultatului și să afișeze alerta (PAT-TRM-03).
- Cauțiunea o plătim în aceeași zi cu contestația, fără să așteptăm vreo notificare (PAT-GAR-06).
- Contestăm **orice** respingere a ofertei noastre în termen, altfel pierdem interesul pentru tot restul procedurii (BO2026_1184).
- Cerem accesul la dosar imediat după comunicare, inclusiv PV-ul de evaluare și raportul expertului cooptat. Atacăm întâi câștigătorul, apoi ceilalți.

**(c) Numărul de decizii:** 37 de decizii care tratează aspecte procedurale: 24 din versiunea anterioară (8 admise, 8 admise parțial, 8 respinse) și 13 noi (4 admise, 2 admise parțial, 7 respinse). Nu există o etichetă separată pentru această temă, așa că deciziile au fost selectate după conținutul textului.

---

## 13. Ajustarea prețului, garanția de bună execuție, reținerile și garanția lucrărilor (TEMĂ NOUĂ)

**(a) Regulile extrase**

1. **Formula de ajustare trebuie să fie aplicabilă unui contract nou.** Formula din art. 17 alin. (8) lit. a1) OUG 64/2022, cu indicele ICCplr, e reglementată pentru contracte în derulare, iar indicele nu e publicat de INS. Folosită într-o procedură nouă, viciază procedura. Anularea făcută de AC după deschiderea ofertelor a fost validată (BO2023_406). Invers, o ordonanță pentru contracte în derulare nu poate fi invocată ca să înlocuiască actul indicat de AC în fișa de date pentru un contract viitor (BO2026_809). În BO2026_1521 criticile pe ajustare au fost retrase, deci nu există soluție pe fond.
2. **Reținerile din plată peste GBE nu se pot impune prin modelul de contract.** Clauza care plătește doar 70% din lucrările executate și restul de 30% după recepția la terminare se elimină. Protecția beneficiarului se face prin garanția de bună execuție reglementată (BO2025_2294, sectorial).
3. **GBE e argument împotriva formalismului.** O GBE de 10% protejează AC, deci respingerea pentru omisiuni minore e disproporționată (BO2025_1524). GBE și plățile periodice sunt alternative mai puțin restrictive decât pragurile financiare ridicate (BO2026_318).
4. **Garanția lucrărilor e distinctă de garanția comercială a produselor.** Antreprenorul răspunde 36 de luni pentru toată lucrarea, chiar dacă producătorii dau 24 de luni pentru echipamente. Oferta nu poate fi respinsă pe această diferență (BO2025_2114). Critica „garanție de 24 de luni în loc de 36” cade dacă formularul de ofertă arată 36 (BO2025_1699).
5. **Garanția ca factor de evaluare:** garanția extinsă nejustificată duce cel mult la neacordarea punctajului (BO2026_544). Garanția lucrărilor apare frecvent ca factor cu pondere de 10% (BO2025_2237).
6. **Condițiile pentru emitentul garanțiilor** trebuie justificate și proporționale (BO2021_1317, vezi tema 7).

**(b) Cum o folosim în Ofertare**
- La fiecare DA verificăm formula de ajustare: există, are indici INS publicați curent, are lună de bază și se aplică peste 6 luni (PAT-CTC-01, PAT-CTC-02). Dacă formula trimite la OUG 64/2022 sau la ICCplr, cerem clarificări înainte de depunere (BO2023_406).
- ERP verifică automat modelul de contract: plăți condiționate de recepție, rețineri procentuale peste GBE, termene de plată de peste 30 de zile. Acestea primesc semnalul „contestabil” (PAT-GAR-02, PAT-GAR-05, BO2025_2294).
- La garanția lucrărilor răspundem standard: Gazpet răspunde integral ca antreprenor, conform clauzei de garanție, indiferent de garanția componentelor (PAT-GAR-03, BO2025_2114).
- Avansul și modul de recuperare le verificăm cu PAT-CTC-04.

**(c) Numărul de decizii:** 8 etichetate ajustarea prețului sau garanția de bună execuție (3 admise, 4 admise parțial, 1 respinsă). Baza e mică, deci regulile sunt orientative.

---

## 14. Anulări de procedură — OUG 41/2025, PNRR, vicii ale DA (TEMĂ NOUĂ)

**(a) Regulile extrase**

1. **Anularea de către AC pentru imposibilitatea încheierii contractului** (art. 212 alin. 1 lit. c L98) cere o cauză obiectivă și neimputabilă. Granița o dă dovada încetării finanțării:
   - **legală:** finanțarea a dispărut efectiv (contractul de finanțare PNRR denunțat după OUG 41/2025, plus rectificare bugetară), chiar dacă AC a întârziat culpabil. CNSC nu poate obliga AC să încheie contractul fără fonduri. Ofertantului îi rămân doar despăgubirile (BO2025_3738);
   - **nelegală:** AC invocă doar OUG 41/2025, fără notificarea de neacordare a finanțării și fără să arate că nu există altă sursă, cum cerea clauza suspensivă din fișa de date. OUG 41/2025 are excepții și nu impune automat anularea (BO2026_76).
2. **Ghidurile ANAP sunt orientative.** Includerea „Diverselor și neprevăzutelor” în valoarea estimată nu justifică singură anularea. Anularea e o măsură extremă, iar comisia nu poate ignora raportul expertului cooptat fără note individuale (BO2024_3631).
3. **Vicii ireparabile care justifică anularea:**
   - deschiderea ofertelor fără comisie de evaluare numită. Numirea retroactivă nu e posibilă (BO2026_349);
   - formula de ajustare inaplicabilă (BO2023_406);
   - valoarea estimată necorelată cu devizul din SF (BO2023_427);
   - un factor de evaluare bazat pe un PT inexistent (BO2025_1837);
   - suprapunerea cu obligațiile de investiții ale concesionarului (BO2026_2669).
4. **CNSC anulează procedura** când DA e nelegală, iar termenul de depunere a trecut (BO2026_318, BO2025_352, BO2025_286), sau când nu mai rămâne nicio ofertă admisibilă (BO2025_3667). Dacă termenul nu a trecut, CNSC dispune remedierea DA, nu anularea (BO2026_1521, BO2022_2083).
5. **O decizie de anulare legată de o evaluare greșită** cade în partea privind oferta vătămată (BO2026_1360).
6. **Neregulile de comunicare a anulării** (termenul de 3 zile, motive diferite în anunț și în adresă) nu o fac nelegală dacă nu au împiedicat contestarea (BO2026_349).

**(b) Cum o folosim în Ofertare**
- În fișa procedurii ERP extrage din fișa de date clauza suspensivă și condițiile de anulare. Marchează sursa de finanțare (PNRR, Anghel Saligny, PNDL) cu „risc de anulare pe finanțare” când termenul finanțării e apropiat (BO2025_3738, BO2026_76).
- Documentăm costurile fiecărei oferte, pentru eventuale despăgubiri. Nu investim în contestații lungi când finanțarea expiră curând (BO2025_3738).
- La o anulare cerem imediat raportul procedurii și decizia de numire a comisiei (BO2026_349). Dacă AC invocă doar OUG 41/2025 sau doar ghiduri ANAP, contestăm (BO2026_76, BO2024_3631).
- Înainte de a oferta verificăm concesiunea (PAT-INF-07), corelarea VE pe lot (PAT-INF-11), formula de ajustare (PAT-CTC-02) și termenele peste sărbători (PAT-TRM-05). Acestea sunt cauzele tipice de anulare după depunere.

**(c) Numărul de decizii:** 15 decizii care tratează anularea procedurii (7 admise, 4 admise parțial, 4 respinse). Selecția s-a făcut după conținut.

---

## 15. Procedurile sectoriale (Legea 99/2016) — ce diferă față de Legea 98 (TEMĂ NOUĂ)

**(a) Regulile extrase**

1. **Pe fond, CNSC aplică aceeași logică.** Se schimbă temeiurile: HG 394/2016 în loc de HG 395/2016. Exemple din decizii: art. 140 alin. 4–5 (răspuns neconcludent, completare), art. 141 alin. 3 (viciu de formă), art. 142 alin. 4 (prețul aparent neobișnuit de scăzut), art. 143 alin. 3 (neconformitate). Din L99 apar art. 221 alin. 2 (avantaj evident), art. 222 (justificarea prețului), art. 228 (comunicarea rezultatului), art. 180 (excludere) și art. 197 alin. 2 (înlocuirea terțului). Căile de atac rămân pe Legea 101/2016, cu aceleași termene și aceeași cauțiune (BO2026_804).
2. **Cine apare în bază:** majoritatea deciziilor sectoriale sunt la operatori regionali de apă-canal (19 din 27). Restul sunt la transport și distribuție de gaze, de exemplu un acord-cadru de înlocuire de branșamente (BO2021_2679) și o conductă de transport DN700 (BO2026_804).
3. **La preț, tendința sectorială e mai permisivă pentru câștigător.** Peste 80% din VE, entitatea nu e obligată la verificări (BO2022_2747, BO2025_1699). Subevaluarea se judecă pe obiecte sau capitole, nu articol cu articol (BO2020_2251). Sub prag, analiza trebuie făcută pe fond (BO2025_3699), iar un element cotat la 1 leu cere documente (BO2024_3215). Pe L98, BO2023_2695 merge mai departe și cere justificarea unui element chiar peste 80% (vezi divergența de la tema 2).
4. **Entitățile sectoriale aplică strict cerințele formale necontestate:** fișele F5 cu „CONFORM” (BO2026_1837), planșele cerute la P+E (BO2025_1704), RTE-ii precizați la clarificări (BO2025_3788), certificatele ISO cu viză (BO2025_204), condiționările de prețuri la reofertare (BO2021_2679).
5. **Pot cere cerințe mai severe la complexitate ridicată,** dacă le justifică (BO2026_804). ES limitată strict la tipul de rețea rămâne restrictivă și în sectorial (BO2023_1489).
6. **Garanțiile pentru ofertanți rămân aceleași:**
   - comunicarea rezultatului trebuie să arate concret cerințele încălcate, iar entitatea trebuie să dovedească transmiterea cererii de prelungire a GP (BO2025_1037);
   - garanția lucrărilor e distinctă de garanția produselor (BO2025_2114);
   - organizarea de șantier cerută distinct se cotează distinct (BO2025_1639);
   - GP încărcată în altă secțiune se clarifică (BO2020_2392, BO2022_1952), iar condițiile pentru emitent trebuie justificate (BO2021_1317);
   - executanții reali și terții se tratează ca pe L98 (BO2025_2344, BO2020_2191, BO2023_2237);
   - autorizațiile din caietul de sarcini nu devin cerințe de calificare (BO2022_2747, BO2026_1360), iar cererea de clarificări vagă se contestă (BO2026_362);
   - neconcordanțele din DUAE și punctajul tehnic trebuie clarificate și motivate (BO2021_1117, BO2023_246);
   - reținerile peste GBE se elimină (BO2025_2294);
   - la reevaluare se verifică aceeași cerință la toți ofertanții (BO2026_328).

**(b) Cum o folosim în Ofertare**
- Fișa procedurii are câmpul „lege aplicabilă (L98 / L99)”. Șabloanele de clarificări și contestații citează automat HG 394/2016 și articolele din L99 când procedura e sectorială.
- La acordurile-cadru cu operatorii de distribuție (articole de tip LCC, STC), ERP ține regulile de ordine dintre prețurile unitare și blochează exportul dacă sunt încălcate. Orice condiționare din invitația de reofertare o contestăm în 10 zile sau o respectăm (BO2021_2679, PAT-CTC-05, PAT-TRM-03).
- La entitățile sectoriale din gaze verificăm specificațiile operatorului și documentele de inspecție pentru materiale (PAT-STD-11). Cerințele de ES la transport le tratăm cu PAT-CAL-05.
- Peste 80% din VE nu contestăm prețul câștigătorului fără calcule pe capitole (BO2025_1699, BO2020_2251).

**(c) Numărul de decizii:** 27 pe Legea 99/2016 (15 admise, 6 admise parțial, 6 respinse).

---

## Top 10 reguli CNSC pentru Gazpet

1. **Răspunsul la clarificare confirmă, nu completează.** Procedurile, Gantt-ul, planșele, valorile din F5 și personalul nominalizat lipsă nu se mai pot aduce. Documentele care existau dinainte se pot aduce sau explica (BO2025_2118, BO2025_1704, BO2025_2430, BO2024_2636, BO2025_1248).
2. **Prețurile unitare nu se ating la clarificări.** Corecția aritmetică privește doar rezultatul. Pragul de 1% e pentru abateri tehnice minore, nu pentru prețuri (BO2025_2853, BO2025_3667, BO2024_159, BO2022_219).
3. **Sub 80% din VE, justificarea se dă cu documente pentru fiecare articol cerut,** cu prețuri identice cu cele din C6/F3, fără reducerea cantităților. Și peste 80%, elementele simbolice (organizare de șantier, repere la 1 leu) pot fi cerute la justificare. Practica e divergentă aici (BO2024_3130, BO2024_449, BO2023_2695, BO2024_3215 vs BO2024_2604).
4. **Formularele tehnice se completează concret.** În F5 trecem valori, producător, model și pagina din catalog, niciodată „CONFORM”. Planificarea respectă exact coloanele formularului AC (BO2026_1837, BO2025_806, BO2025_3667).
5. **„Similar” nu înseamnă „identic”, iar ES se dovedește cu PV anterioare termenului, confirmate de beneficiar.** Transportul, SRM-urile, branșamentele și canalizarea contează când textul cerinței permite. Acordul-cadru singur nu ajunge (BO2023_1336, BO2023_2717, BO2021_610, BO2026_182, BO2023_140).
6. **Nu se respinge pe cerințe nescrise în anunț sau în fișa de date.** Autorizarea firmei nu se transformă în autorizarea personalului. Omisiunile minore nu duc la respingere (BO2024_1706, BO2026_544, BO2022_2747, BO2025_1524).
7. **Fiecare activitate autorizată are un titular declarat în ofertă:** Gazpet, un asociat sau un subcontractant declarat, cu procent corelat cu valorile. Colaboratorii nedeclarați nu acoperă cerința (BO2026_328, BO2025_2344, BO2025_1639, BO2022_1615).
8. **Personalul cheie și dovezile pentru punctaj intră în ofertă de la început:** nume, atestate valabile, recomandări semnate de beneficiari. ANRE se cere doar celor care execută sau proiectează gaze (BO2025_2430, BO2025_2858, BO2025_3788, BO2024_2683).
9. **La garanția de participare contează instrumentul valabil la termen, emis pe numele asocierii.** Corecturile se fac doar prin act adițional la același instrument. Prelungirea o cere AC și trebuie să dovedească cererea (BO2020_2392, BO2023_2794, BO2024_1043, BO2025_1037, BO2026_15).
10. **Contestăm în 7 sau 10 zile, cu cauțiunea plătită din oficiu:** DA, fiecare răspuns la clarificări care modifică cerințe și orice respingere a ofertei noastre. Ce nu contestăm devine obligatoriu sau definitiv (BO2024_3155, BO2025_3788, BO2024_2990, BO2026_1184, BO2026_804).

**De urmărit separat:** anulările motivate de finanțare (OUG 41/2025, PNRR) sunt legale doar cu dovada că finanțarea a încetat (BO2025_3738 vs BO2026_76). Formulele de ajustare preluate din OUG 64/2022 pot duce la anularea procedurii (BO2023_406).
