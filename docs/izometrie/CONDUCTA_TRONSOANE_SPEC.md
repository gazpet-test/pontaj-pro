# Conducta pe tronsoane — contractul datelor, manifestul și reconcilierea (pașii 1 și 2)

Stare: **pasul 1 (contract + manifest) și pasul 2 (bandă doar-citire) livrate în cod; nimic în baza de date.**
Versiunea regulilor: `conducta-banda-v1` (`VERSIUNE_REGULI` din `src/conductaTronsonLogica.js`).
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
  Fără limite → banda se întinde doar pe datele sursei și apare anomalia `limite_tronson_lipsa` (procentele nu se calculează).
- Sensul: km crescători = sensul de curgere al numerotării din proiect. Toate pozițiile sunt pe această axă.

### 2.2 Sursa și foaia
- O **sursă** pe tronson este fie **schema** (setul de fișiere Excel confirmat), fie **platforma** (pachetele de lansare existente).
- O **foaie** = un fișier de schemă (sau un pachet din platformă). Câmpuri: id, cod document, revizie, stare, ordinea în set,
  km de început (dacă e cazul), **convenția km** și dacă e **confirmată**, rândurile.
- Rândul: număr de rând original, poziție, fel (`teava` / `curba` / `legare` / `separator`), serie, tip material, dimensiune, șarjă,
  lungime (m), km (text, exact cum e în fișier), sudură (text), marcaj „de făcut în șanț”, buletinele PM / PA-UT.
- Rândul original se păstrează întotdeauna ca proveniență (foaie + rând + km original). Rândul Excel **nu** e identitate stabilă între revizii.

### 2.3 Convenția km
- Unitatea internă: **milimetri întregi** (fără erori de rotunjire la sume de sute de piese). Afișare: `24+012.46`.
- Format km acceptat: `K+MMM` cu exact 3 cifre de metri și 0–3 zecimale (`.` sau `,`). Orice altceva = **neparsabil**,
  nu se repară (ex. `27.598.97` rămâne neparsabil, chiar dacă „se vede” ce voia să fie).
- Convenția unei foi se **declară** și se **confirmă**; nu se deduce permanent din primul rând:
  - `km_capat_pe_rand` — fiecare rând are km-ul capătului din aval al piesei (= poziția sudurii de pe rând); începutul = km − lungime;
  - `start_inceput_prima_piesa` — foaia are un km de început = începutul primei piese; pozițiile din lungimi cumulate;
  - `start_capat_prima_piesa` — km de început = poziția primei suduri (capătul primei piese).
- Convenție nedeclarată sau neconfirmată = anomalie (blocantă pentru publicare la pasul 4; ecranul o afișează).
- **Pachetele din platformă au azi o convenție neclară**: editorul o descrie ca „prima sudură”, proba de randare a folosit „începutul primei
  țevi”, iar pe același tronson cele două pachete par calculate diferit. Ecranul de bandă lasă alegerea explicită între cele două și
  afișează „convenția km nu e confirmată”. Se rezolvă înainte de import (pasul 4), inclusiv în recalculul din bază.
- Lungimea materialului ≠ diferența a două poziții km. Se păstrează ambele; diferențele se raportează, nu se „întinde” conducta.
- La convențiile cumulate, o lungime lipsă sau invalidă **oprește lanțul**: piesele următoare din foaie rămân fără poziție
  (anomalia `lant_intrerupt`), nu se mută toate ca să ascundă golul.

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
- Aceeași sudură pe două piese = `sudura_repetata`. Număr de buletin prezent ≠ control acceptat (nu se afișează „controlat”).
- O sudură refăcută rămâne istoric; respingerea curentă are marcaj separat (pas ulterior, din evidența calității).

### 2.6 Intervalul
- Semi-deschis `[de_la, pana_la)`, în mm, pe axa tronsonului. Metrii unei stări = reuniunea intervalelor (fără dublă numărare).
- Suprapunerea pieselor nu se ascunde: porțiunea e „realizat” cu marcaj de suprapunere și anomalia `suprapunere`;
  totalul `suprapuneri_m` = Σ (piese peste − 1) × lungime, deci `lungime material poziționat = reuniune + suprapuneri`.
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
  lungime material, km min / max, reuniune (`realizat_m`), `necunoscut_m`, `suprapuneri_m`, `in_afara_limitelor_m`.
- Procentul pe ecran = `realizat_m / lungime tronson`, etichetat „acoperire pe axa sursei”; nu e procent de execuție.

---

## 4. Reconcilierea schemă ↔ platformă și raportul de diferențe

### 4.1 Cheia
- Piesa: (tip, serie) normalizate (majuscule, fără spații), împerecheate ca **multiset**: întâi perechile cu aceeași lungime (± 5 mm), apoi restul în ordinea km.
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
Blocant: km neparsabil sau lipsă, lungime invalidă sau lipsă, km de început lipsă, lanț întrerupt, convenție km nedeclarată / neconfirmată,
suprapunere, dublură de identitate, frontieră neconfirmată sau cu suduri diferite, sudură repetată / ilizibilă / contradictorie,
restant peste realizat, tip de rând necunoscut.
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

Doar ce există ca **tip de sursă**, din studiul de inventar (nume de dosare și fișiere, conținutul celorlalte zece tronsoane **neverificat**).
Lista completă, cu fișierele, căile și totalurile, stă în raportul rundei (intern), nu aici.

Stări în manifest: **activ** (sursa curentă confirmată) · **candidat** (pare finală, neconfirmată) · **înlocuit** · **anulat** · **parțial** (acoperă doar o porțiune) · **neverificat**.

| Tr. | Scheme de montaj (Excel + PDF validat) | Schemă completă / pachet de probă | As-built topograf | În platformă azi | Stare în manifest | Revizia activă | Totaluri declarate de sursă |
|---|---|---|---|---|---|---|---|
| T1 | da | da | da | nimic | candidat | neconfirmată | neinventariate |
| T2 | da | da | da | nimic | candidat | neconfirmată | neinventariate |
| T3 | da | da | nu | nimic | candidat | neconfirmată | neinventariate |
| T4 | da | parțial (porțiunea probată) | nu | rânduri goale (= necunoscut, nu zero) | parțial | neconfirmată | neinventariate |
| T5 | da | negăsit | nu | nimic | parțial (doar scheme intermediare) | neconfirmată | neinventariate |
| T6 | da | da | da | nimic | candidat | neconfirmată | neinventariate |
| **T7** | da (2 scheme, versiunea veche) | **da: pachet de probă rev.2 (2 fișiere) + o completare ulterioară necitită** | nu | 2 pachete ciornă (versiunea veche, ~79% din tronson) | **candidat** = pachetul de probă rev.2; pachetele din platformă = **înlocuite** (de confirmat); completarea = **neverificată** | rev.2 (de confirmat) | da: lungimea în antetul fiecărui fișier (reconciliată în raportul rundei) |
| T8 | da | da | da | 3 pachete scurte | candidat | neconfirmată | neinventariate |
| T9 | da | parțial (o porțiune probată) | nu | nimic | parțial | neconfirmată | neinventariate |
| T10 | da (unele scheme marcate anulate) | negăsit | nu | nimic | parțial; schemele anulate = **anulat** | neconfirmată | neinventariate |
| T11 | da | da | da (cu sudurile) | nimic | candidat | neconfirmată | neinventariate |

Ce trebuie să conțină o intrare de manifest la pasul 4 (per tronson): lista explicită a fișierelor componente (un „final” poate fi un set),
codul documentului, revizia, statutul, limitele km acoperite, convenția km, amprenta SHA-256 a conținutului, cine a confirmat și când,
totalurile declarate (lungime, nr. piese, nr. suduri) comparate cu cele calculate.

---

## 7. Ecranul livrat la pasul 2 și ce ar trebui pentru pasul 4

**Livrat:** Izometrie → „📏 Bandă tronson (citire)” (`src/IzoBandaTronson.jsx`). Citește **doar** ce există: `executie_pachete_lansare` +
`executie_tevi` ale tronsonului ales (aceleași drepturi pe proiect ca editorul de pachete; citire paginată pe id, fără plafonul de 1000 de rânduri),
le trece prin logica de mai sus și arată: pachetele (cod, revizie, stare, km start), indicatorii cu numitorul, banda pe tot tronsonul sau pe ferestre de 500 m,
sudurile ca repere (cu cod / de făcut / fără cod), segmentul ales (prin atingere, nu doar tooltip), anomaliile și detaliul pe piese cu proveniența.
Spune explicit că sursa e platforma, nu schema confirmată, și că convenția km nu e confirmată. Nu scrie nimic.

**Nelivrat (cere aprobare, pasul 4)** — propuneri, nu schimbări:
- tabele pentru: loturi de import · fișiere și revizii (SHA-256, versiunea parserului și a regulilor) · rândurile originale (foaie, rând, valori brute) ·
  pozițiile normalizate (km început piesă, km sfârșit piesă, km sudură, câmpuri distincte) · identitățile stabile de bucăți · neconcordanțele · jurnalul;
- publicare atomică a unei revizii complete într-un singur RPC (verifică versiunea curentă între preview și publicare; cheie de idempotență pe intenție;
  la timeout se recitește starea cu aceeași cheie);
- accesul verificat în bază pe proiectul fiecărei entități atinse (inclusiv fișierele originale și exporturile); importul nu creează recepții, mișcări de stoc sau declarații de teren;
- ecranul citește un singur contract (revizia publicată), nu unirea brută a tabelelor vechi cu cele noi.

---

## 8. Necunoscute rămase
1. Convenția km a pachetelor existente din platformă și a recalculului din bază (început vs. capăt al primei piese).
2. Convenția „sudura de pe rând e la capătul din aval” și sensul lui „0” în coloana SUDURĂ — de confirmat de biroul tehnic.
3. Toleranțele (50 mm poziție, 5 mm lungime) pentru frontieră și „mutat” — de confirmat.
4. Care fișiere sunt finale pe fiecare tronson (manifestul §6 e „candidat” peste tot); completarea ulterioară a tronsonului de probă e necitită.
5. Ce înseamnă „restant” pe stadiul „sudat”: lista îmbinărilor necesare nu rezultă din schemele execuției.
6. Acceptarea controalelor (buletinele există, rezultatul nu e în date).
7. Conținutul as-built (coordonate, cote, asocierea sudurilor) — neverificat.
8. Matricea dependențelor între stadii (cuplări în șanț, porțiuni speciale, probe înaintea altor lucrări) — de aprobat la pasul 5.

## Istoric
- 16.11.2026 — v1: contractul datelor, manifestul public, reconcilierea și banda doar-citire (pașii 1 și 2).
