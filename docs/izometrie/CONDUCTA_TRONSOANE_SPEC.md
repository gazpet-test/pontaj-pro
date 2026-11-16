# Conducta pe tronsoane — contractul datelor, manifestul și reconcilierea (pașii 1 și 2)

Stare: **pasul 1 (contract + manifest) și pasul 2 (bandă doar-citire) livrate în cod; nimic în baza de date.**
Manifestul (§6) e un inventar după numele fișierelor, nu o verificare de conținut; ce nu s-a putut inventaria e marcat explicit.
Versiunea regulilor: `conducta-banda-v2` (`VERSIUNE_REGULI` din `src/conductaTronsonLogica.js`; v2 = runda 2 de review, vezi Istoric).
Ce NU face această livrare: import, tabele noi, migrări, scrieri, stadiu fizic, hartă, 3D.

Ordinea de lucru convenită (șase pași): (1) contract + manifest · (2) un tronson reconciliat, doar citire ·
(3) încă două tronsoane diferite · (4) import versionat pe toate cele 11 · (5) stadiul fizic, pe un tronson activ ·
(6) sinteza lotului, apoi o hartă pilot.

---

## 1. Deciziile proprietarului, scrise ca reguli

| # | Decizia | Regula în cod și în ecrane |
|---|---|---|
| D1 | Prima livrare: un tronson reconciliat, apoi încă două | Logica e generică pe tronson; ecranul arată un tronson odată. Nu se promite „tot lotul” până la pasul 4. |
| D2 | Autoritatea: schema Excel confirmată de responsabil e sursa; platforma e derivată | Platforma nu corectează independent ordinea, lungimile sau sudurile importate. O neconcordanță se **raportează** (raportul de diferențe), corecția se face în Excel și se reimportă. Fără sincronizare în ambele sensuri. |
| D3 | Reimport: revizii și publicare atomică | O revizie nouă devine curentă doar întreagă, după reconciliere; un import eșuat nu schimbă versiunea curentă. Repetarea aceluiași import nu adaugă nimic (pasul 4, §7). |
| D4 | Trei stări: realizat / restant / necunoscut | „Necunoscut” ≠ „neexecutat”. Complementul unei evidențe incomplete e „necunoscut”, niciodată „restant”. Restant = doar ce e confirmat explicit ca restant. |
| D5 | Stadiul fizic = intervale raportate de șeful de șantier, cu dovezi și confirmări distincte | Nimic din scheme nu devine „lansat / astupat / probat / redat”. Banda de azi arată doar „în schema de montaj”. |
| D6 | Geometria: hartă pilot pe as-built verificat, mai târziu; 3D doar la noduri | Banda e pe axa km a schemei, nu pe teren. Fără coordonate inventate din lungimi. |

---

## 2. Contractul datelor

### 2.1 Tronsonul
- Identitate: rândul din `executie_tronsoane` (proiect + cod, ex. „T7”).
- Limite: `km_start_m`, `km_end_m` (metri întregi, de la originea lotului). Lungimea benzii = `km_end_m − km_start_m`.
  Fără limite → **lungimea tronsonului e necunoscută** (anomalia `limite_tronson_lipsa`): banda arată doar **întinderea datelor**
  (de la prima la ultima piesă / restanță), care NU e lungimea tronsonului; „necunoscut pe tronson” e și el necunoscut (null, nu 0),
  iar golurile din interiorul întinderii se raportează separat. Procentele și „din X m ai tronsonului” nu se afișează.
- Sensul: km crescători = sensul de curgere al numerotării din proiect. Toate pozițiile sunt pe această axă.

### 2.2 Sursa și foaia
- O **sursă** pe tronson este fie **schema** (setul de fișiere Excel confirmat), fie **platforma** (pachetele de lansare existente).
- O **foaie** = un fișier de schemă (sau un pachet din platformă). Câmpuri: id, cod document, revizie, stare, ordinea în set,
  km de început (dacă e cazul), **convenția km** și dacă e **confirmată**, **data situației** pe care o descrie, **data importului**, rândurile.
  Data situației și data importului lipsă = **necunoscute** (afișate așa, nu deduse). Pachetele din platformă nu au nici una, nici alta:
  ecranul arată „situație: necunoscută” și, separat, data ultimei modificări a pachetului (care nu e o dată a situației).
- Rândul: număr de rând original, poziție, fel (`teava` / `curba` / `legare` / `separator`), serie, tip material, dimensiune, șarjă,
  lungime (m), km (text, exact cum e în fișier), sudură (text), marcaj „de făcut în șanț”, buletinele PM / PA-UT.
- Rândul original se păstrează întotdeauna ca proveniență (foaie + rând + km original). Rândul Excel **nu** e identitate stabilă între revizii.

### 2.3 Convenția km
- Unitatea internă: **milimetri întregi** (fără erori de rotunjire la sume de sute de piese). Afișare: `1+012.46`.
- Format km acceptat: `K+MMM` cu exact 3 cifre de metri și 0–3 zecimale (`.` sau `,`). Orice altceva = **neparsabil**,
  nu se repară (ex. `1.598.97` rămâne neparsabil, chiar dacă „se vede” ce voia să fie).
- Convenția unei foi se **declară** și se **confirmă**; nu se deduce permanent din primul rând:
  - `km_capat_pe_rand` — fiecare rând are km-ul capătului din aval al piesei (= poziția sudurii de pe rând); începutul = km − lungime;
  - `start_inceput_prima_piesa` — foaia are un km de început = începutul primei piese; pozițiile din lungimi cumulate;
  - `start_capat_prima_piesa` — km de început = poziția primei suduri (capătul primei piese).
- Convenție nedeclarată sau neconfirmată = anomalie (blocantă pentru publicare la pasul 4; ecranul o afișează).
- **Pachetele din platformă: implicit B** (`start_capat_prima_piesa`, `CONVENTIE_PLATFORMA`) = km de început = poziția **primului rând
  fizic** al pachetului, adică prima sudură (capătul primei țevi sau sudura de legare) — aceeași formulă ca editorul de pachete
  (`src/Izometrie.jsx`, „POZ KM cascade”), deci compatibilă cu pozițiile deja calculate în platformă. **A** (`start_inceput_prima_piesa`)
  rămâne doar ca o **comparație explicită**, etichetată „comparație, nu rezultat”, niciodată preselectată. B e o alegere de compatibilitate,
  nu o dovadă a convenției istorice a fiecărui pachet: anomalia „convenția km nu e confirmată” rămâne până la confirmarea pe pachet (pasul 4).
- La B, verificări distincte pentru primul rând și pentru lungimile lipsă:
  - primul rând al foii e separator, rând gol sau tip necunoscut → km de început ar ancora un rând fără piesă (iar formula editorului ar
    trata prima țeavă ca la A) → **ambiguu**: anomalia blocantă `km_start_rand_fara_piesa`, foaia rămâne fără poziții;
  - lungimea lipsă la **prima** piesă: sudura ei e chiar km-ul de început, deci lanțul **continuă** (piesa însăși rămâne fără poziție);
  - lungimea lipsă la o piesă de la mijloc: lanțul se oprește (editorul ar fi continuat fără ea — aici nu se ghicește).
  La A, separatorul de la început nu schimbă nimic, iar lungimea lipsă la prima piesă oprește lanțul de la primul rând.
- Lungimea materialului ≠ diferența a două poziții km. Se păstrează ambele; diferențele se raportează, nu se „întinde” conducta.
- La convențiile cumulate, singura ancoră explicită e km-ul de început al foii. O lungime lipsă sau invalidă **și un rând de tip
  necunoscut** (care poate fi o piesă cu lungime) **opresc lanțul**: piesele următoare din foaie rămân fără poziție (anomalia
  `lant_intrerupt`), nu se mută ca să ascundă golul și nu se desenează pe o poziție nedovedită. La `km_capat_pe_rand` fiecare rând are
  ancora lui, deci un rând necunoscut nu mută nimic (rămâne doar ca incertitudine + anomalie).

### 2.4 Piesa (bucata)
- Piesă = un rând `teava` sau `curba` cu serie și/sau lungime. Identitatea = **bucata**: (tip, serie) + ocurența ei.
  Seria singură **nu** e cheie unică: o țeavă tăiată dă mai multe bucăți cu aceeași serie și lungimi diferite (legitim).
- Aceeași serie + aceeași lungime în două locuri (în afara frontierei) = `dublura_identitate`, de decis de om.
- Lungime 0 = piesă fără întindere (avertisment `lungime_zero`), nu acoperă nimic pe bandă.
- O curbă fără serie și fără lungime **rămâne piesă** (există, dar fără poziție), nu se aruncă.
- Rând gol = țeavă fără serie, fără lungime, fără sudură și fără marcaj → listat ca ignorat (`rand_gol`); separatorii la fel. Nimic nu dispare tacit: ecranul arată numărul lor.
- Curba: tipul, lungimea și unghiul (din dimensiune) se păstrează; unghiul **nu** dă direcția în spațiu.

### 2.5 Sudura
- Convenția: sudura de pe rând e la **capătul din aval** al piesei (km = sfârșitul piesei). *De confirmat de biroul tehnic.*
- Codul se normalizează cu normalizatorul existent (`src/lib/izoSudura.js`, mod LOT 1): `T7S12`, `T7S12R` → identitate + „refăcută”.
- `0`, `-` sau gol în coloana SUDURĂ = **fără cod pe rând** (nu „restantă”). *De confirmat.*
- Stările unei suduri: `sudata` (cod valid), `restanta` (marcaj explicit „de făcut în șanț”, fără cod), `necunoscuta`
  (fără cod; cod ilizibil; cod + marcaj în același timp = contradicție). Un cod ilizibil nu se repară (ex. o literă în locul cifrei tronsonului).
- **Sudura de legare** (rând `legare`, fără piesă) trece prin **aceleași** validări: km lipsă / neparsabil (la `km_capat_pe_rand`),
  cod ilizibil, cod + marcaj „în șanț”, numerotare pe alt tronson, repetare.
- Aceeași sudură pe două piese (sau pe o piesă și o legare) = `sudura_repetata`. Număr de buletin prezent ≠ control acceptat (nu se afișează „controlat”).
- O sudură refăcută rămâne istoric; respingerea curentă are marcaj separat (pas ulterior, din evidența calității).

### 2.6 Intervalul
- Semi-deschis `[de_la, pana_la)`, în mm, pe axa tronsonului. Metrii unei stări = reuniunea intervalelor (fără dublă numărare).
- Suprapunerea pieselor nu se ascunde: porțiunea are marcaj de suprapunere și anomalia `suprapunere`; totalul
  `suprapuneri_m` = Σ (piese peste − 1) × lungime, calculat **independent de starea segmentului** (și pe o porțiune devenită
  „necunoscut / conflict” din cauza unui restant confirmat). Deci `material poziționat în limite = (porțiuni acoperite de piese) + suprapuneri`.
- Suprapunerea **între stadii diferite** (la pasul 5) e normală; aici e vorba de piese ale aceleiași surse.

### 2.7 Piesa comună de la frontiera dintre două foi
Două foi consecutive ale aceleiași surse pot repeta piesa de legătură (la sfârșitul primei, fără sudură; la începutul celei de-a doua, cu sudura).
Regula: ultima piesă a foii N și prima piesă a foii N+1 se **unesc** într-o singură piesă dacă au aceeași serie + tip, aceeași lungime
(± 5 mm) și aceeași poziție (± 50 mm, ambele cunoscute). Piesa unită păstrează **sudura** (apariția care are cod) și **ambele rânduri** în proveniență.
- Suduri diferite pe cele două apariții → nu se alege una (`frontiera_suduri_diferite`).
- Aceeași serie, dar lungime/poziție diferite sau necunoscute → **nu** se unește (`frontiera_neconfirmata`).

Exemplu (sintetic): foaia A se termină cu `SX002`, 12 m, km 1+022, sudură „0”; foaia B începe cu `SX002`, 12 m, km 1+022, sudura `T1S2`.
Rezultat: o piesă `SX002` [1+010, 1+022), sudura `T1S2` la 1+022, proveniență `A#2 + B#1`; lungimea totală scade cu 12 m.
Eliminarea apariției a doua întregi ar fi pierdut sudura — de aceea se reconciliază, nu se șterge.

**Suprapunerile rămase după frontieră** (piese care încep cu 1–2 m înainte de capătul precedentei) rămân vizibile ca anomalii:
„fără dublură” nu rezolvă geometria. Pe tronsonul probei rămân câțiva metri de astfel de suprapuneri (cifrele în raportul rundei).

---

## 3. Banda

Ieșirea `calculeazaSursa(...)` (fișierul `src/conductaTronsonLogica.js`):
- `banda`: segmente elementare `[de_la, pana_la)` din limitele tronsonului, fiecare cu `stare`, `motiv`, `piese` (proveniența: id-urile
  pieselor care îl acoperă), `restante`, `suprapunere`.
  - `realizat` = acoperit de cel puțin o piesă a sursei (= „în schema de montaj”, NU stadiu fizic);
  - `restant` = acoperit doar de un interval restant **confirmat explicit** (intrare separată; azi nu există în platformă);
  - `necunoscut` = restul: `fara_date` (gol, piese fără poziție) sau `conflict` (restant confirmat peste piese).
- `piese`, `suduri` (cu stare și km), `frontiere`, `ignorate`, `anomalii` (cu nivel `blocant` / `avertisment`).
- `inainte` (rânduri brute) și `dupa` (după frontieră): rânduri, piese, țevi, curbe, suduri cu cod / refăcute / restante / capete fără cod,
  lungime material, km min / max, reuniune (`realizat_m`), `suprapuneri_m`, `in_afara_limitelor_m`, plus, separat:
  - `lungime_tronson_m` — din limitele tronsonului; **null** fără limite;
  - `intindere_banda_m` — cât acoperă banda desenată (= lungimea tronsonului doar când are limite);
  - `necunoscut_m` — necunoscut pe tronson; **null** fără limite (nu 0);
  - `necunoscut_in_intindere_m` — golurile din interiorul întinderii.
- Ecranul scrie „din X m ai tronsonului” doar cu `lungime_tronson_m`; nu afișează procent de execuție.

---

## 4. Reconcilierea schemă ↔ platformă și raportul de diferențe

### 4.1 Cheia
- Piesa: (tip, serie) normalizate (majuscule, fără spații), împerecheate ca **multiset**: întâi **numărul maxim** de perechi cu lungimea
  în toleranță (± 5 mm); la același număr, suma minimă a diferențelor de lungime; restul egalităților se rup determinist (lungime, km, id).
  Abia apoi bucățile rămase se împerechează în ordinea km (și apar cu diferență de „lungime”). Exemplu: schema 10,004 + 10,000 m,
  platforma 10,000 + 10,009 m → perechile 10,004↔10,009 și 10,000↔10,000, fără nicio „diferență de 9 mm”.
- Toate listele de ieșire au ordine deterministă (cheie, km, id), independentă de ordinea în care s-au încărcat rândurile:
  perechile și bucățile fără pereche după km și id, necomparabilele tot după km și id, sudurile după cod (test cu intrarea inversată).
- Sudura: codul normalizat + marcajul de refacere.
- Piesele fără serie sunt **necomparabile** (listate separat), nu „lipsă”.

### 4.2 Ce înseamnă „lipsă”
- „Lipsă din platformă” = bucată cu cheie în schemă rămasă **fără pereche** după împerechere. Analog „doar în platformă”.
- „Serii distincte” (câte serii apar) ≠ inventar de bucăți: o serie tăiată în două bucăți apare o dată în lista de serii, dar sunt două bucăți.
  Raportul dă ambele numere separat (`serii_doar_schema` și `doar_schema`).

### 4.3 Categorii
`identic` · `lungime` diferită · `mutat` (poziție diferită peste 50 mm) · `pozitie_necomparabila` · `sudura` diferită ·
`doar_schema` · `doar_platforma` · `necomparabile_*` · suduri `doar_schema` / `doar_platforma` / `alta_piesa`.

### 4.4 Ce ar bloca publicarea unei revizii (pasul 4) și ce e avertisment
Blocant (verificat azi de logică): km neparsabil sau lipsă (și la sudurile de legare), lungime invalidă sau lipsă, km de început lipsă,
km de început pe un rând fără piesă (B), lanț întrerupt, convenție km nedeclarată / neconfirmată, suprapunere, dublură de identitate,
frontieră neconfirmată sau cu suduri diferite, sudură repetată / ilizibilă / contradictorie, restant peste realizat, tip de rând necunoscut.
Blocant la pasul 4 (încă neimplementat, pentru că cere importul): **totalurile nereconciliate** (lungimea / nr. de piese / nr. de suduri
declarate de sursă ≠ cele calculate), **sursa sau revizia ambiguă** (două candidate pentru același interval, set de fișiere incomplet,
revizie neidentificată), **pierderea legăturilor existente** (o revizie nouă care ar lăsa fără pereche bucăți deja legate în registrul
de montaj, suduri cu buletine sau raportări fizice).
Avertisment: lungime 0, piesă în afara limitelor tronsonului, sudură numerotată pe alt tronson, limite de tronson lipsă, sursă goală.
Blocarea nu împiedică păstrarea fișierului și a erorilor în zona de pregătire; nicio corecție semantică nu se face tacit.

### 4.5 Totaluri înainte / după
Pentru fiecare sursă: rânduri, piese, suduri, lungimi și limite, separat **înainte** (rânduri brute) și **după** reconcilierea frontierelor.
Pe datele reale ale tronsonului de probă, comparația cu cifrele din consultare e în raportul rundei (nu în repo).

---

## 5. Restant și stadiul fizic (pasul 5, nelivrat)
- Restant apare doar din intrări explicite: intervale raportate (șef de șantier) cu autor, dată a lucrării, dată a înregistrării, dovadă și istoric de anulare
  (principiile din fibra optică: aceeași axă, `[de_la, pana_la)`, fără suprapuneri active pe același stadiu, metri din reuniune).
- O raportare peste o zonă fără schemă rămâne „raportată, nereconciliată documentar”; o contradicție cu o sudură explicit restantă blochează confirmarea stadiului dependent.
- La reimport, raportările fizice nu se mută odată cu țevile: o schimbare de poziții declanșează reconciliere.

---

## 6. Manifestul celor 11 tronsoane (versiunea publică)

**Sursa inventarului:** instantaneul listei de fișiere de pe server din **09.11.2026** (doar nume de dosare și fișiere, Excel / PDF / desene;
fără buletine, fișe de tăiere și copiile din arhive). **Conținutul nu e verificat** pentru niciun document, cu o singură excepție: pachetul de
probă al tronsonului de probă (T07-P1), citit în runda de verificare. Ce a apărut după instantaneu sau nu poate fi legat de un document
e marcat **neinventariat** — explicit, nu amânat tacit.

**Identificatori anonimi** `Tnn-<fel><k>-rev<r>`: fel **S** = schemă de montaj înainte de lansare, **C** = schemă completă / finală,
**P** = pachet de probă, **A** = desen as-built, **E** = pachet din platformă; k = al câtelea document de acel fel pe tronson, în ordinea
primei apariții; r = revizia din numele fișierului sau al dosarului (rev0 = fără mențiune). Ex.: `T07-S2-rev1` = al doilea document S
al tronsonului 7, revizia 1. Fără nume de fișiere, căi sau valori în acest document: corespondența identificator → cod document / fișier
stă în raportul intern al rundei.
- Gruparea pe documente e automată, după codul documentului din nume; fișierele fără cod sunt grupate după nume și pot fi greșit
  separate sau unite → **de confirmat la pasul 4** (statutul fiecărei grupări fără cod: neverificat).
- `*` = la revizia aceea există un PDF cu „validat” în nume. **Asta nu dovedește validarea conținutului**, nici că PDF-ul corespunde
  Excelului; e doar un indiciu din numele fișierului. `†` = la revizia aceea nu s-a găsit Excel (doar PDF).

Stări în manifest: **activ** (sursa curentă confirmată) · **candidat** (pare finală, neconfirmată) · **înlocuit** · **anulat** ·
**parțial** (acoperă doar o porțiune) · **neverificat** · **neinventariat**. Azi **niciun document nu e activ**.

| Tr. | Documente inventariate (identificator + revizii) | În platformă azi | Stare în manifest | Revizia activă | Totaluri declarate de sursă |
|---|---|---|---|---|---|
| T01 | T01-S1 (rev0) · T01-S2 (rev0, rev1, rev2) · T01-S3 (rev0\*) · T01-S4 (rev1\*†) · T01-S5 (rev0, rev1, rev2\*) · T01-S6 (rev0\*) · T01-S7 (rev0) · T01-C1 (rev0, rev1\*) · T01-P1 (rev0\*) · T01-A1 (rev0) | nimic | candidat: T01-C1-rev1, T01-P1-rev0; restul neverificat | neconfirmată | neinventariate |
| T02 | T02-S1 (rev0\*) · T02-C1 (rev0, rev1) · T02-P1 (rev0, rev1) · T02-P2 (rev0, rev2\*†) · T02-A1 (rev0) | nimic | candidat: T02-C1-rev1, T02-P2-rev2; restul neverificat | neconfirmată | neinventariate |
| T03 | T03-S1 (rev0, rev1) · T03-S2 (rev0, rev1, rev2) · T03-S3 (rev0\*) · T03-S4 (rev0\*) · T03-S5 (rev0, rev1\*) · T03-S6 (rev0, rev1, rev2) · T03-P1 (rev0, rev1\*) · T03-P2 (rev0) · T03-P3 (rev0) · T03-P4 (rev1) · T03-P5 (rev1) · T03-P6 (rev1\*†) | nimic | candidat: pachetul final (T03-P4…P6, gruparea de confirmat); restul neverificat | neconfirmată | neinventariate |
| T04 | T04-S1 (rev0\*) · T04-S2 (rev0) · T04-S3 (rev0, rev1, rev2\*) · T04-S4 (rev0, rev1) · T04-S5 (rev0) · T04-S6 (rev0) · T04-S7 (rev0\*) · T04-S8 (rev0) · T04-S9 (rev0, rev1\*) · T04-S10 (rev0\*) · T04-S11 (rev0\*) · T04-P1 (rev0) | rânduri goale, fără document identificat (neinventariat; = necunoscut, nu zero) | parțial: T04-P1 acoperă doar porțiunea probată | neconfirmată | neinventariate |
| T05 | T05-S1 (rev0\*) · T05-S2 (rev0\*) · T05-S3 (rev0\*) · T05-S4 (rev0\*) · T05-S5 (rev0) · T05-S6 (rev0) · T05-S7 (rev0\*) · T05-S8 (rev0\*†) · T05-S9 (rev0\*†) | nimic | parțial (doar scheme intermediare; schemă completă / pachet de probă: negăsit) | neconfirmată | neinventariate |
| T06 | T06-S1 (rev0, rev1, rev2) · T06-S2 (rev2\*†) · T06-S3 (rev0, rev1) · T06-S4 (rev0) · T06-S5 (rev0, rev1, rev2\*) · T06-S6 (rev0) · T06-S7 (rev0, rev1\*) · T06-S8 (rev0\*) · T06-S9 (rev0) · T06-S10 (rev0, rev1) · T06-S11 (rev0) · T06-S12 (rev0\*) · T06-S13 (rev0\*) · T06-S14 (rev0) · T06-S15 (rev0\*) · T06-A1 (rev0) | nimic | candidat: pachetul final (neidentificat separat în instantaneu → neinventariat); restul neverificat | neconfirmată | neinventariate |
| **T07** | T07-S1 (rev0) · T07-S2 (rev0, rev1\*, rev2) · **T07-P1** = pachetul de probă, set de 2 fișiere Excel T07-P1-F1 / T07-P1-F2 (rev0, rev1, rev2) + PDF-urile lui (partea I \* la rev1, partea II \* la rev2) · T07-P2 = completarea ulterioară (după instantaneu: **neinventariată**, necitită) | T07-E1-rev0 (document absent din dosarul de scheme: neinventariat) · T07-E2-rev1 (după cod = T07-S2-rev1); ambele ciornă | **candidat** = T07-P1-rev2; T07-E1, T07-E2 = **înlocuit** (de confirmat); T07-P2 = **neverificat** | T07-P1-rev2 (de confirmat) | T07-P1-rev2: lungimea în antetul fiecărui fișier (reconciliată în raportul intern) |
| T08 | T08-S1 (rev0, rev1) · T08-S2 (rev0, rev1) · T08-S3 (rev0\*) · T08-S4 (rev0, rev1\*†) · T08-S5 (rev0, rev1, rev2\*) · T08-S6 (rev0\*) · T08-S7 (rev0\*) · T08-S8 (rev0\*) · T08-S9 (rev0\*) · T08-S10 (rev0\*, rev1\*) · T08-C1 (rev1\*†) · T08-A1 (rev0) | pachete scurte (identificatori și revizii: neinventariate) | candidat: T08-C1-rev1; T08-S1, T08-S2 = anulat (după numele dosarului, de confirmat); restul neverificat | neconfirmată | neinventariate |
| T09 | T09-S1 (rev0, rev1) · T09-S2 (rev0, rev1\*) · T09-S3 (rev0, rev1\*) · T09-S4 (rev0\*) · T09-S5 (rev0, rev1\*) · T09-S6 (rev0) · T09-S7 (rev0) · T09-S8 (rev0\*) · T09-P1 (rev0) · T09-P2 (rev0, rev1) · T09-P3 (rev0\*†, rev2) | nimic | parțial: pachetele de probă acoperă o porțiune (unul pare etichetat cu alt tronson — de verificat) | neconfirmată | neinventariate |
| T10 | T10-S1 (rev0\*) · T10-S2 (rev0\*) · T10-S3 (rev0, rev1\*†) · T10-S4 (rev0\*) · T10-S5 (rev0\*) · T10-S6 (rev0) · T10-S7 (rev0\*) · T10-S8 (rev0\*) · T10-S9 (rev0) · T10-S10 (rev0) · T10-S11 (rev0) · T10-S12 (rev0) · T10-S13 (rev0\*) · T10-S14 (rev0\*) · T10-S15 (rev0\*†) · T10-S16 (rev0\*†) | nimic | parțial (schemă completă: negăsit); T10-S9 = anulat (după numele dosarului, de confirmat) | neconfirmată | neinventariate |
| T11 | T11-S1 (rev0, rev1, rev2\*, rev3, rev4\*) · T11-S2 (rev2) · T11-S3 (rev3) · T11-S4 (rev4) · T11-S5 (rev0, rev1) · T11-S6 (rev0\*) · T11-S7 (rev0) · T11-S8 (rev0\*†) · T11-A1 (rev0) | nimic | candidat: pachetul final (neidentificat separat în instantaneu → neinventariat); T11-S2…S4 pot fi revizii ale T11-S1 (de confirmat) | neconfirmată | neinventariate |

Ce trebuie să conțină o intrare de manifest la pasul 4 (per tronson): lista explicită a fișierelor componente (un „final” poate fi un set),
codul documentului, revizia, statutul, limitele km acoperite, convenția km, amprenta SHA-256 a conținutului, cine a confirmat și când,
data situației, totalurile declarate (lungime, nr. piese, nr. suduri) comparate cu cele calculate.

---

## 7. Ecranul livrat la pasul 2 și ce ar trebui pentru pasul 4

**Livrat:** Izometrie → „📏 Bandă tronson (citire)” (`src/IzoBandaTronson.jsx`). Citește **doar** ce există: `executie_pachete_lansare` +
`executie_tevi` ale tronsonului ales (aceleași drepturi pe proiect ca editorul de pachete; ambele citiri paginate pe id până la pagina goală, deci fără
plafonul de 1000 de rânduri al API-ului, oricât ar fi el; o pagină eșuată = eroare afișată, fără bandă din date parțiale),
le trece prin logica de mai sus și arată: pachetele (cod, revizie, stare, km start, „situație: necunoscută”, „import: necunoscut”, ultima modificare), indicatorii cu
numitorul (doar când tronsonul are limite; altfel „lungimea tronsonului: necunoscută” + întinderea datelor, iar necunoscutul pe tronson = „necunoscut”),
banda pe tot tronsonul (sau pe toată întinderea datelor) ori pe ferestre de 500 m, sudurile ca repere (cu cod / de făcut / fără cod), segmentul ales
(prin atingere, nu doar tooltip), anomaliile și detaliul pe piese cu proveniența.
Spune explicit că sursa e platforma, nu schema confirmată, și ce convenție km folosește: **B** (ca editorul), cu eticheta „neconfirmată pe fiecare pachet”.
Comparația cu **A** apare doar dacă utilizatorul o bifează (nebifată la deschidere și la schimbarea tronsonului), ca tabel separat „comparație, nu
rezultat” (B / A / A − B); banda și tabelul pieselor rămân pe B. Nu scrie nimic (doar `SELECT`; testul de componentă verifică și că nu apelează RPC-uri).
**De verificat după merge**, ca utilizator restricționat (non-owner, cu acces doar la proiectele lui): ecranul și citirile directe din API arată doar
pachetele proiectelor atribuite (testul îl face sesiunea care are un astfel de cont; aici nu s-a putut rula).

**Nelivrat (cere aprobare, pasul 4)** — propuneri, nu schimbări:
- tabele pentru: loturi de import · fișiere și revizii (SHA-256, versiunea parserului și a regulilor) · rândurile originale (foaie, rând, valori brute) ·
  pozițiile normalizate (km început piesă, km sfârșit piesă, km sudură, câmpuri distincte) · identitățile stabile de bucăți · neconcordanțele · jurnalul;
- publicare atomică a unei revizii complete într-un singur RPC (verifică versiunea curentă între preview și publicare; cheie de idempotență pe intenție;
  la timeout se recitește starea cu aceeași cheie);
- accesul verificat în bază pe proiectul fiecărei entități atinse (inclusiv fișierele originale și exporturile); importul nu creează recepții, mișcări de stoc sau declarații de teren;
- ecranul citește un singur contract (revizia publicată), nu unirea brută a tabelelor vechi cu cele noi.

---

## 8. Necunoscute rămase
1. Convenția km a fiecărui pachet existent: B e aleasă pentru compatibilitatea cu editorul (pe tronsonul de probă, pozițiile B coincid cu
   cele calculate de bază), dar nu dovedește convenția istorică a fiecărui pachet → confirmare pe pachet înainte de import.
2. Convenția „sudura de pe rând e la capătul din aval” și sensul lui „0” în coloana SUDURĂ — de confirmat de biroul tehnic.
3. Toleranțele (50 mm poziție, 5 mm lungime) pentru frontieră și „mutat” — de confirmat.
4. Care fișiere sunt finale pe fiecare tronson (manifestul §6 nu are niciun document „activ”); completarea ulterioară a tronsonului de probă
   (T07-P2) e neinventariată și necitită; gruparea automată a fișierelor fără cod de document e de confirmat.
5. Ce înseamnă „restant” pe stadiul „sudat”: lista îmbinărilor necesare nu rezultă din schemele execuției.
6. Acceptarea controalelor (buletinele există, rezultatul nu e în date).
7. Conținutul as-built (coordonate, cote, asocierea sudurilor) — neverificat.
8. Matricea dependențelor între stadii (cuplări în șanț, porțiuni speciale, probe înaintea altor lucrări) — de aprobat la pasul 5.

## Istoric
- 16.11.2026 — v1: contractul datelor, manifestul public, reconcilierea și banda doar-citire (pașii 1 și 2).
- 16.11.2026 — v2 (`conducta-banda-v2`, după review): rândul de tip necunoscut întrerupe lanțul cumulat; sudurile de legare trec prin
  aceleași validări; suprapunerea nu mai depinde de starea segmentului; împerecherea pe lungime maximizează perechile în toleranță
  (determinist); fără limite, lungimea tronsonului și necunoscutul pe tronson sunt necunoscute (întinderea datelor separat); convenția
  implicită a pachetelor = B (ca editorul), A doar comparație; verificări distincte pentru primul rând și lungimile lipsă la B; data
  situației / importului în contractul foii; manifest pe documente și revizii cu identificatori anonimi, fără valori reale.
- 16.11.2026 — v3 (`conducta-banda-v3`, runda 3): și lista pachetelor se citește paginat pe id până la pagina goală (nu doar țevile;
  id-urile pachetelor merg în bucăți în cererea de țevi); o citire întreruptă = eroare, fără bandă parțială; necomparabilele și sudurile
  din raportul de diferențe au ordine explicită; ecranul arată și „import: necunoscut”.
