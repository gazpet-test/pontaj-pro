# Uscare conductă în Execuție — treapta a doua: două etape, prag numeric, proces-verbal semnat (SPECIFICAȚIE)

Stare: 17.11.2026, runda 1. **Doar document.** Nu există cod, migrare sau schimbare de date în acest PR. Prima livrare
(`docs/executie/USCARE_CONDUCTA_SPEC.md`, migrarea NEAPLICATĂ `20261225a_executie_uscare.sql`) **nu se schimbă**: tot ce e nou de mai
jos intră într-o migrare NOUĂ, peste ea (§11). Orice tabel, RPC sau drept propus aici **necesită acordul proprietarului** înainte de
implementare și se livrează pe felii, cu review propriu. Deciziile deschise sunt la §12 (O1–O15), cu recomandarea pe fiecare.

Termeni: **Antreprenorul** = firma noastră; **beneficiarul** = autoritatea contractantă; **constructorul** = firma trecută în rubrica
„Denumire constructor” a raportului (poate fi Antreprenorul sau un subantreprenor); **raportul** = raportul de uscare din prima
livrare (o operațiune = o trecere a trenului de pistoane); **PV-ul** = procesul-verbal de uscare, documentul nou; **piston-burete**
= buretele din spumă vehiculat prin conductă (rubrica „Bureți spumă” din model); **persoana desemnată** = cineva numit pe proiect să
semneze pentru Antreprenor din ERP; **reprezentantul** = reprezentantul beneficiarului prezent pe șantier.

Cuprins: 1. Ce există și ce se schimbă · 2. Fluxul în două etape · 3. Criteriul numeric · 4. Procesul-verbal · 5. Semnătura
Antreprenorului · 6. Semnătura reprezentantului beneficiarului · 7. Stările · 8. Tronsonul confirmat uscat · 9. Vremea · 10. Accesul ·
11. Schema și livrarea (inventar) · 12. Decizii pentru proprietar · 13. Ce NU face treapta a doua · 14. Lecțiile L01–L25 · 15. Istoric.

---

## 0. Ce cere proprietarul (17.11.2026, rezumat) și ce știm despre prag

1. Procedura **în două etape** pe telefon (între introducerea pistonului și ieșirea lui pot trece și 60 de minute: sudarea capacului,
   legarea compresoarelor): etapa 1 = înainte de introducere (cântărirea fiecărui piston-burete, cu poza cântarului pe care se văd
   kilogramele); etapa 2 = la ieșire (cântărirea fiecăruia, cu poza). De regulă 2 pistoane-burete.
2. **Criteriul numeric** comunicat de beneficiar: uscarea e efectuată dacă pistoanele n-au acumulat mai mult de **100 g pe km**
   (exemplu: 500 g pe 5 km).
3. Dacă uscarea trece, ERP-ul generează un **PV de uscare** (greutăți, prag și rezultat, temperatura și vremea, tronsonul de la km … la
   km …, lungimea, textul de confirmare), **deja semnat** de persoana desemnată a Antreprenorului.
4. Reprezentantul semnează **în ERP** (numele lui + semnătura) sau, dacă nu vrea, **olograf** pe exemplarul tipărit, care se urcă apoi în ERP.
5. După semnătura beneficiarului, tronsonul e **confirmat uscat** în ERP.
6. Se folosește de pe telefon, de oamenii de pe șantier; accesul rămâne cel al modulului Execuție.

**Sursa pragului nu e încă documentată.** Corespondența scrisă a beneficiarului verificată de coordonator (mesajele din 27.10 și
16.11.2026) cere modelul de raport, notificarea cu 24 h și pozele, **fără valori**; caietul de sarcini (cap. 4.1.8.5) dă doar criteriul
„ultimul piston vehiculat iese uscat” (specificația existentă §1). De aceea:
- pragul e un **parametru al proiectului** (valoare, unitate, regula pentru mai mulți bureți, documentul-sursă, cine l-a setat și când),
  nu o constantă în cod (§3.6);
- **fără prag setat, modulul se comportă ca azi**: concluzia o pune omul, după criteriul din caiet;
- formularea exactă („fiecare piston” sau „pistoanele împreună”, ce lungime) se cere beneficiarului **în scris**, odată cu valoarea (O1, O2).

---

## 1. Ce există și ce se schimbă

| Cerința | Azi (prima livrare) | Treapta a doua |
|---|---|---|
| Cântărirea fiecărui burete la intrare și la ieșire | **Acoperită**: rândul de cântărire pe fiecare burete declarat (`cantariri`, intrare / ieșire în kg, 3 zecimale, sau „nu se aplică” cu motiv), cerut la închidere (spec. §5) | Neschimbată ca formă; se adaugă **momentul** fiecărei etape și înghețarea intrării (§2.2) |
| Poza cântarului pe fiecare burete | **Acoperită**: categoriile `cantar_intrare` / `cantar_iesire` pe burete; lipsa cere justificare consemnată (decizia B) | La ieșire, poza rămâne „avertisment + justificare”; la intrare, la fel. Recomandarea: **nu** blocăm (fără semnal poza nu urcă, §2.4) |
| Două etape separate în timp | **Parțial**: raportul rămâne deschis, salvare pe parcurs, ciornă locală, îmbinare la conflict; dar nimic nu marchează „pistonul a intrat” | **Nou**: butonul „Închei etapa 1 — pistonul intră în conductă” (moment pus de server), ecranul ghidat pe etape, lista „așteaptă ieșirea” |
| Diferența de greutate | **Parțial**: calculată doar în aplicație (`diferentaBurete`, kg), fără prag, nu apare în PDF (decizia D) | Calculată de server și de ecran din aceeași regulă (L19), în **grame întregi**, comparată cu pragul (§3) |
| Prag numeric | **Nu există** (intenționat, spec. §2) | **Nou**: parametru pe proiect, cu istoric și document-sursă; calculul **propune**, omul confirmă (§3.5) |
| Concluzia | Omul alege CONFORM / NECONFORM; CONFORM cere „ultimul piston uscat” + poza lui | Rămâne la om; cu prag setat, CONFORM contra calculului e refuzat, NECONFORM contra calculului cere motiv (§3.5) |
| Proces-verbal de uscare | **Nu există**; PDF-ul raportului (modelul beneficiarului) se tipărește și se semnează pe hârtie | **Nou** (§4) |
| Semnătura Antreprenorului din ERP | **Nu există**; rubricile `semn_constructor_*` sunt text liber, pentru semnătura de mână | **Nou**: lista persoanelor desemnate + semnarea din contul lor (§5) |
| Semnătura reprezentantului în ERP | **Nu există** (`semn_beneficiar_*` = text liber) | **Nou**: semnătură trasă pe telefonul echipei (recomandat, §6) |
| Exemplarul olograf urcat în ERP | **Nu există** (PDF-ul se tipărește, scanul nu se întoarce în platformă) | **Nou**: urcarea scanului + confirmarea de către o persoană desemnată (§6.4) |
| Tronson confirmat uscat | **Nu există**; etapa „uscare” din Probe pe tronsoane e separată, nesincronizată (spec. §12) | **Nou**: stare **derivată** din PV-urile semnate, citită prin legătură, fără copii prin trigger-e (§8) |
| Tronsonul „de la km X + Y m” și lungimea | **Acoperite** (`km_de_la_m`, `km_pana_la_m`, `lungime_m`, afișare `fmtKm`) | Neschimbate; PV-ul le preia |
| Temperatura și vremea | **Acoperite**: temperatura (măsurată sau din meteo, cu instantaneul construit de server), vremea, poza termometrului (spec. §10) | Doar regula „ce e oficial în PV” (§9) |
| Telefon, poziție, notificarea cu 24 h | **Acoperite** | Neschimbate |
| Accesul | **Acoperit**: matricea Execuție (spec. §8) | Doar trei roluri noi pe proiect: persoana desemnată, cine setează pragul, cine confirmă exemplarul olograf (§10) |

---

## 2. Fluxul în două etape pe telefon

### 2.1 Ce se completează în fiecare etapă

Ecranul rămâne cel de azi (secțiunile 1–13), dar e **ghidat pe etape**: sus, o bandă cu „Etapa 1 — înainte de introducere” /
„Etapa 2 — la ieșire”, iar secțiunile etapei curente sunt deschise, celelalte restrânse.

| Etapa | Se completează | Poze cerute (avertisment + justificare la închidere, ca azi) | Se încheie cu |
|---|---|---|---|
| **1 — înainte de introducere** (de regulă la capătul de lansare) | tronsonul și intervalul de km, notificarea, data, poziția, temperatura / vremea, constructorul, utilajele, configurația pistoanelor (PIG, poliuretan, bureți), **cântarul folosit** (descriere + diviziunea, §3.3), **greutatea la intrare a fiecărui burete**, în **ordinea din tren** (§3.4) | cântarul la intrare pe **fiecare** burete; configurația pistoanelor; termometrul | **„Închei etapa 1 — pistonul intră în conductă”**: momentul îl pune serverul (`etapa1_la`, `etapa1_de`) și devine ora introducerii propusă pentru „Ora începere” |
| *între etape* | nimic obligatoriu; raportul rămâne **deschis**; se pot adăuga poze (utilaje, altele), observații | — | — |
| **2 — la ieșire** (de regulă la capătul de primire, la km distanță) | ora ieșirii („Ora finalizare”), presiunea în spatele buretelui, timpul de deplasare, cântarul folosit la ieșire („același ca la intrare” sau altul), **greutatea la ieșire a fiecărui burete**, rezultatul ultimului piston, punctul de rouă (opțional), observațiile, concluzia | cântarul la ieșire pe **fiecare** burete; manometrul; **ultimul piston** (blocant la CONFORM, ca azi) | „✓ Închide raportul” (ca azi), cu propunerea calculului afișată (§3.5) |

**Ordinea impusă de server:** greutățile la ieșire **nu se pot scrie** cât etapa 1 nu e încheiată (un raport fără `etapa1_la` refuză
`iesire_kg`), iar închiderea cere `etapa1_la` pentru rapoartele create după livrarea treptei a doua (marcajul `doua_etape`, pus de server la
creare; rapoartele mai vechi se închid ca azi).

### 2.2 Înghețarea greutăților la intrare (de ce e nevoie de ea)

Cu un prag numeric, greutatea la intrare decide rezultatul: dacă ar putea fi schimbată după ce se vede greutatea la ieșire, criteriul nu
mai dovedește nimic. Propunere:
- la „Închei etapa 1”, serverul reține greutățile la intrare **așa cum sunt** (în jurnal, cu momentul);
- după aceea, o schimbare a unei greutăți la intrare e o **corecție consemnată**: motiv obligatoriu (`corectie_intrare_motiv`), valorile
  vechi și noi în jurnal, iar PV-ul tipărește „greutatea la intrare a buretelui n corectată după introducere: motiv …” (nu se ascunde);
- numărul de bureți și ordinea lor în tren se îngheață la fel (o schimbare = corecție consemnată).

### 2.3 Cine continuă etapa 2

Etapa 2 se face de regulă **la celălalt capăt** al tronsonului, adesea de alt om, cu alt telefon.

| | A. Oricine are scriere pe proiect (ca azi) | B. Doar omul care a încheiat etapa 1 | C. Omul din etapa 1 sau cine îl preia explicit („preiau raportul”) |
|---|---|---|---|
| Pe șantier | Merge și când capetele sunt la km distanță | Omul trebuie să ajungă la celălalt capăt sau să-și dea telefonul | Un pas în plus, dar urmărit |
| Ce rămâne ca dovadă | Jurnalul: cine a salvat fiecare câmp, cine a încheiat etapa 1, cine a închis | Același om pe tot raportul | Jurnalul + preluarea |
| Risc | Doi oameni scriu în paralel → CAS + îmbinarea pe câmpuri existentă (spec. §6) | Blocaj când omul pleacă | Mic |

**Recomandare: A** (O5). Lista rapoartelor arată „**Așteaptă ieșirea** — introdus la HH:MM de …” pentru rapoartele cu etapa 1
încheiată, ca echipa de la capătul de primire să-l găsească imediat; regulile de concurență rămân cele de azi.

### 2.4 Întreruperi și lipsa semnalului

- **Datele** (greutăți, ore, observații): ciorna locală de azi (pe utilizator, proiect, raport, cu rândul de bază) le păstrează; la revenirea
  semnalului se salvează, iar o versiune mai nouă pe server trece prin îmbinarea pe câmpuri. Nimic nou de construit.
- **„Închei etapa 1”** cere semnal: momentul e al serverului. Fără semnal, ecranul spune clar „etapa 1 nu e încheiată pe server” și oferă
  „Notez ora introducerii” (ora telefonului, salvată în ciornă ca **ora declarată**); la revenirea semnalului omul încheie etapa 1, iar
  serverul reține ambele: ora declarată (scrisă de om) și momentul înregistrării. PV-ul arată ora declarată ca „Ora introducerii” și,
  dacă diferă cu peste 15 minute, mențiunea „înregistrată în platformă la …”.
- **Pozele** nu urcă fără semnal (rezervarea căii se face pe server, spec. §7). Omul fotografiază cu camera telefonului și le urcă din galerie
  la revenirea semnalului („📷 Alege fișierul”). Ora din anexă rămâne **ora încărcării** (spec. §7): ora din fișierul pozei o declară
  telefonul, nu o dovedește. Consecința, spusă cinstit: o poză „cântar la intrare” urcată după încheierea etapei 1 apare în anexă cu
  mențiunea „încărcată după introducere”; e o informație pentru cine verifică, nu un refuz.

### 2.5 Mai multe treceri pe același tronson

Azi un raport = o trecere a trenului de pistoane (o oră de început, o oră de final, cântăririle bureților din tren). Rămâne așa:

| | A. Fiecare trecere = un raport (ca azi) | B. Un raport cu mai multe treceri |
|---|---|---|
| Schimbări | Doar numerotarea trecerilor și legătura între ele (derivate) | Cântăriri pe treceri, ore pe treceri, închidere pe treceri: altă schemă |
| PDF-ul raportului | Rămâne pe modelul beneficiarului (un tabel = o trecere) | Modelul nu are rubrici pentru mai multe treceri |

**Recomandare: A.** Trecerea 1 se închide NECONFORM (cu observația), trecerea 2 se creează din ea („Trecere nouă pe același tronson”:
tronsonul, intervalul, constructorul, utilajele și configurația se copiază, greutățile nu) și se închide CONFORM.
- **Numărul trecerii** e derivat (nu stocat): ordinea după ora de început a rapoartelor neanulate pe același tronson de probă (sau același
  interval de km) din aceeași **campanie** (după proba cu apă / după proba cu aer, O13).
- **În lista rapoartelor**: „Trecerea 2 din 2 — CONFORM”, „Trecerea 1 din 2 — NECONFORM”.
- **În PV** (se generează doar din trecerea care trece): „Trecerea nr. 2. Treceri anterioare pe acest tronson, în aceeași campanie:
  trecerea 1 (data, ora, diferențele, NECONFORM)” — recomandare: **le menționăm** (O12). Rapoartele lor există oricum și pot fi văzute de
  reprezentant; un PV care le ascunde ar fi mai slab, nu mai puternic.

---

## 3. Criteriul numeric

### 3.1 Formula

Pentru fiecare piston-burete `i` cu ambele cântăriri:

- greutățile se scriu în **kg cu cel mult 3 zecimale** (ca azi) ⇒ fiecare e un număr **întreg de grame**: `intrare_g = intrare_kg × 1000`;
- **diferența** `Δi = iesire_g − intrare_g` (grame întregi; pozitivă = a reținut apă);
- **pragul tronsonului** `P = v × L / 1000` grame, unde `v` = valoarea pragului (g/km, cel mult o zecimală) și `L` = lungimea de referință
  în metri (cel mult o zecimală) — recomandare: `lungime_m` din raport, adică lungimea trecută în rubrica modelului (O3);
- **condiția** pentru un burete: `Δi ≤ P` („nu mai mult de” = egalitatea trece). Exemplul beneficiarului: 100 g/km × 5.000 m = 500 g;
  Δ = 500 g trece, Δ = 501 g nu trece.

**Fără rotunjiri în comparație.** Pragul poate avea zecimale (100 g/km × 4.873,5 m = 487,35 g). Comparația se face în numere întregi,
identic în SQL și în JS: `100.000 × Δi ≤ (10·v) × (10·L)` (toți termenii întregi; cel mai mare produs, sub 10¹³, e exact în JS). Afișarea:
pragul cu cel mult două zecimale („487,35 g”), diferențele în grame întregi. Nicio valoare nu se rotunjește înainte de comparație.

### 3.2 Unitatea (kg sau g) și greșelile de unitate

Rubricile modelului sunt în **kg**; rămânem pe kg, o singură unitate peste tot. Ca o greșeală de unitate să se vadă înainte de salvare:
- lângă fiecare câmp, ecranul scrie conversia, mare: „2,345 kg = **2.345 g**”;
- lângă diferență: „Δ = +130 g · pragul tronsonului: 487,35 g · ✔ în prag”;
- **verificări de plauzibilitate** (aceeași regulă în SQL și JS; pragurile de plauzibilitate sunt propuneri implicite, §12): ieșirea de peste 3 ori intrarea, o
  diferență de peste 20 de ori pragul sau o intrare sub 0,1 kg cer o **confirmare explicită** („am verificat, cântarul arată … kg”), consemnată;
  nu blochează (un burete foarte ud există), dar nu trec pe tăcute.

### 3.3 Cântarul

La fiecare etapă se notează **cântarul** (descriere scurtă: tip / serie, text) și **diviziunea** lui (g, ex. 10 g). La etapa 2 omul
alege „același cântar ca la intrare” sau descrie altul.
- **Cântar diferit între etape**: calculul se face, dar rezultatul e „**de verificat**” (nu „trece”), iar PV-ul tipărește ambele cântare.
  Omul poate închide CONFORM doar după regula de la §3.5 (O4).
- **Cântar prea grosier pentru prag**: dacă diviziunea depășește o cincime din prag (ex. diviziune 100 g pe un tronson de 500 m, prag 50 g),
  ecranul avertizează „cântarul nu poate măsura pragul acestui tronson”; rezultatul devine „de verificat”.

### 3.4 Doi (sau mai mulți) piston-bureți: ce înseamnă „trece”

Numerotarea bureților devine **ordinea din tren**: buretele 1 = primul introdus (în față), ultimul număr = **ultimul piston vehiculat**.
(Azi numerotarea e doar 1…n, fără sens de ordine; ecranul o va spune explicit în etapa 1.)

| | A. Fiecare burete ≤ P | B. Doar ultimul burete ≤ P | C. Suma diferențelor ≤ P |
|---|---|---|---|
| Lectura frazei „pistoanele nu au acumulat mai mult de 100 g/km” | fiecare piston, separat | — | pistoanele împreună |
| Legătura cu caietul („ultimul piston vehiculat iese uscat”) | include condiția pe ultimul | aceeași logică, cu cifră | include condiția pe ultimul |
| Severitate | medie | cea mai blândă | cea mai strictă |
| Riscul | — | un prim burete foarte ud trece neobservat | respinge treceri pe care beneficiarul le-ar accepta |

**Recomandare: A**, până când beneficiarul spune altfel în scris (O2): e lectura cea mai apropiată de text care nu poate fi acuzată de
blândețe, iar „ultimul piston uscat” rămâne și el bifat de om, cu poză (spec. §2). Regula aleasă intră în parametrul proiectului (§3.6),
nu în cod.

Cazurile urâte (aceeași regulă în SQL și JS, L19):

| Situația | Rezultatul calculului |
|---|---|
| Toți bureții ceruți de regulă au Δ ≤ P | **trece** |
| Cel puțin un burete cerut de regulă are Δ > P | **nu trece** (lista bureților peste prag) |
| Greutate lipsă pe un burete cerut | **nu se poate calcula** (închiderea oricum o cere, spec. §5) |
| Burete „nu se aplică” (ex. rămas în conductă) cerut de regulă | **nu se poate calcula**; un burete rămas în conductă înseamnă oricum altă trecere |
| Δ negativ mic (pierdere de cel mult 2 diviziuni ale cântarului; fără diviziune: cel mult 1% din intrare) | **trece** pe acel burete („fără acumulare”, o pierdere plauzibilă: cântar, praf, umezeală veche), afișat așa cum s-a măsurat |
| Δ negativ mai mare | **de verificat** („pierdere de greutate neplauzibilă”: cântar, unitate, burete schimbat?) |
| Cântar diferit / prea grosier (§3.3) | **de verificat** |
| Niciun prag setat pe proiect | **fără prag**: modulul se comportă ca azi |

### 3.5 Calculul propune, omul confirmă

| Calculul | Concluzia omului | Închiderea | PV |
|---|---|---|---|
| trece | CONFORM | da | da |
| trece | NECONFORM | da, cu **motiv obligatoriu** (ex. apă la ieșire, burete rupt) | nu |
| nu trece | CONFORM | **refuzată** (blocant, în BD) | — |
| nu trece | NECONFORM | da | nu |
| nu se poate calcula / de verificat | CONFORM | după O4 — recomandare **A: refuzată**; omul face altă trecere | — |
| nu se poate calcula / de verificat | NECONFORM | da | nu |
| fără prag | CONFORM / NECONFORM | ca azi | după O14 — recomandare: da, cu criteriul din caiet |

- CONFORM cere în continuare „ultimul piston uscat” + poza lui (spec. §2); calculul se adaugă, nu înlocuiește.
- **O singură definiție** (L19): funcția SQL `fn_executie_uscare_criteriu(raport, prag)` = `criteriuUscare(raport, prag)` din
  `src/uscareLogica.js`, cu test de paritate pe un tabel de cazuri (inclusiv egalitatea exactă, pragul cu zecimale, Δ negativ la limită,
  cântar diferit). Concluzia propusă și regula de închidere de mai sus intră în `fn_executie_uscare_lipsa` / `lipsaDinRand` (cheie nouă,
  ex. `criteriu_numeric`), deci trigger-ul de închidere o impune pe orice cale (L07).
- Ecranul arată propunerea **înainte** ca omul să aleagă: „Calculul: ✔ trece (Δ max 130 g ≤ 487,35 g)”.

### 3.6 Parametrul pe proiect

Tabel nou, doar adăugare (o schimbare = rând nou, niciodată UPDATE):

| Câmp | Conținut |
|---|---|
| proiectul | proiectul de Execuție |
| valoarea | g/km, > 0, cel mult o zecimală (ex. 100) |
| unitatea | fixă: `g/km` (alt format = alt câmp, nu text liber) |
| regula pistoanelor | `fiecare` / `ultimul` / `suma` (O2) |
| lungimea de referință | `lungime_raport` / `interval_km` (O3) |
| sursa | documentul care stabilește pragul: tipul (adresă, mail, proces-verbal de ședință, caiet), numărul și data, text obligatoriu; opțional fișierul (octeți în BD, ca la §6.4) |
| valabil de la | momentul de la care se aplică (implicit: setarea) |
| setat de / la | `auth.uid()` și ora serverului (L08) |
| motivul schimbării | obligatoriu de la a doua versiune |
| retras | „fără prag” e tot o versiune (rând cu valoarea nulă și motiv), ca istoricul să fie complet |

- **Cine îl setează:** owner-ul și administratorul Execuție cu acces la proiect (`fn_executie_contract_drept`), ca la redeschidere (O6).
- **Rapoartele deja închise nu se schimbă:** la închidere serverul copiază în raport **versiunea pragului aplicată** (`prag_aplicat`: id-ul
  versiunii, valoarea, regula, lungimea, sursa) și rezultatul calculului; PV-ul le tipărește din copie. O schimbare ulterioară a pragului
  nu atinge rapoartele închise sau PV-urile lor.
- **Rapoartele deschise** iau pragul în vigoare **la închidere**; dacă pragul se schimbă cât un raport e deschis, ecranul lui arată
  „pragul proiectului s-a schimbat la … (de la X la Y g/km)”.
- **Un raport redeschis** se reînchide cu pragul în vigoare atunci; diferența (dacă există) apare în jurnal și pe ecran, iar PV-ul vechi e
  oricum invalidat (§7).

---

## 4. Procesul-verbal de uscare

### 4.1 Conținutul

Fiecare pagină poartă: titlul, numărul PV-ului, **codul documentului** (primele 12 caractere ale amprentei conținutului, §4.3) și
„pagina n din m”.

1. **Antet**: „PROCES-VERBAL DE USCARE A CONDUCTEI nr. … din …”; obiectivul / contractul (din proiect).
2. **Părțile**: Antreprenorul (firma), reprezentat de persoana desemnată (nume, funcție); beneficiarul, reprezentat de reprezentant
   (nume, funcție); constructorul, dacă e altul decât Antreprenorul.
3. **Tronsonul**: codul / denumirea, **de la km X + YYY la km X + YYY**, lungimea (m); campania (după proba cu apă / cu aer, O13).
4. **Operațiunea**: data, ora introducerii, ora ieșirii, durata, metoda („suflare cu aer și utilizare de pistoane absorbante”, din caiet),
   configurația pistoanelor, presiunea în spatele buretelui, timpul de deplasare, viteza medie, numărul trecerii și trecerile anterioare (§2.5).
5. **Tabelul greutăților**:

   | Piston-burete (ordinea în tren) | La intrare (kg) | La ieșire (kg) | Diferența (g) | Pragul tronsonului (g) | Rezultat |
   |---|---|---|---|---|---|

   sub tabel: pragul (… g/km × … m = … g), regula („fiecare piston-burete”), **sursa pragului** (documentul), cântarul / cântarele și
   diviziunea, corecțiile consemnate (§2.2), rândul „Ultimul piston vehiculat iese uscat (criteriul din caietul de sarcini): DA”.
   Fără prag (O14): tabelul fără ultimele două coloane și fără rândul pragului.
6. **Vremea**: temperatura exterioară și sursa ei, condițiile meteo (§9).
7. **Anexa foto**: lista pozelor (categoria, buretele, ora încărcării) și pozele (cântarul la intrare și la ieșire pe fiecare burete,
   configurația, manometrul, termometrul, ultimul piston), ca anexa raportului de azi.
8. **Textul de confirmare** (O10) — două variante sobre, fără temeiuri legale inventate:
   - **Varianta 1 (cu criteriul scris):** „Părțile constată că operațiunea de uscare descrisă mai sus, efectuată prin suflare cu aer și
     vehicularea pistoanelor absorbante, pe tronsonul …, de la km … la km …, în lungime de … m, îndeplinește criteriul de acceptare:
     diferența de greutate a fiecărui piston-burete nu depășește pragul de … g/km (… g pentru lungimea tronsonului), iar ultimul piston
     vehiculat a ieșit uscat. Uscarea tronsonului se consideră efectuată.”
   - **Varianta 2 (scurtă):** „Prin prezentul proces-verbal se confirmă efectuarea operațiunii de uscare a conductei pe tronsonul …, de la
     km … la km …, cu rezultatele din tabelul de mai sus. Criteriul de acceptare fiind îndeplinit, uscarea tronsonului se consideră efectuată.”
   Textul e versionat (id + text integral păstrat); PV-ul reține versiunea folosită. Formularea finală o validează Juridicul.
9. **Semnăturile**: Antreprenorul (nume, funcție, „semnat din platformă de persoana desemnată, autentificată, la ZZ.LL.AAAA HH:MM”,
   imaginea semnăturii, dacă există, §5.3); beneficiarul (nume, funcție, semnătura și momentul — sau loc liber la exemplarul de tipărit).

Fără „Rocky”, „AI”, „generat automat”, nume de unelte sau căi interne în document; autorul e Antreprenorul (persoana desemnată).

### 4.2 Numerotarea și exemplarele

- **Numărul**: pe proiect, consecutiv, alocat de server la generare (sub lock pe proiect, `UNIQUE (proiect, nr)`, L01, L16); un PV invalidat
  își păstrează numărul, cel nou primește altul și tipărește „înlocuiește PV nr. … (invalidat la …, motiv …)”. Forma propusă: „U-007/2026”.
- **Exemplarele**: semnat electronic = **un document** (PDF) generat oricând din conținutul înghețat, identic. Tipărit pentru olograf:
  **2 exemplare** (câte unul pentru fiecare parte) — propunere implicită; caietul nu fixează numărul (spec. §1).

### 4.3 Ce se îngheață la generare

PV-ul se generează **în același RPC** cu semnătura Antreprenorului (§5): un PV nesemnat de Antreprenor nu există.
- **Conținutul canonic** (JSON cu cheile ordonate), fixat de **server**, nimic de la client: proiectul, nr. PV, tronsonul, intervalul,
  lungimea, campania, numărul trecerii și trecerile anterioare, câmpurile operațiunii, cântăririle cu diferențele calculate de server,
  `prag_aplicat` și rezultatul, cântarele, corecțiile, vremea (temperatura, sursa, instantaneul meteo), lista pozelor (id, categorie,
  burete, cale, ora încărcării), versiunea textului de confirmare, raportul (id, versiune, revizie, momentul închiderii), semnatarul
  Antreprenorului (utilizator, nume și funcție copiate din listă, ora, amprenta imaginii semnăturii).
- **Amprenta** = SHA-256 pe conținutul canonic (calculată în BD; disponibilitatea funcției de hash în schema extensiilor se verifică la
  implementare), **codul documentului** = primele 12 caractere.
- Raportul e deja **închis** (nimic nu se mai schimbă pe nicio cale, spec. §4); conținutul canonic copiază ce e nevoie, ca PV-ul să nu
  depindă de citiri ulterioare.
- **PDF-ul** se generează în navigator **doar** din conținutul canonic + semnăturile (ca PDF-ul de azi, `uscarePdf.js`); serverul garantează
  conținutul și amprenta, nu paginile (același risc rămas ca în specificația Redări, §7.5 de acolo: corespondența pagini ↔ conținut o
  verifică omul; o falsificare se descoperă regenerând PDF-ul din conținutul canonic).
- **Pozele:** serverul nu calculează azi amprenta fișierelor; ele sunt nemodificabile prin aplicație (fără UPDATE / DELETE pe bucket, spec.
  §7). PV-ul le identifică prin cale și ora încărcării. Risc asumat, scris (nu „dovadă criptografică a pozelor”).

### 4.4 Un document sau două

| | A. Un fișier: raportul (modelul beneficiarului) + o pagină de PV la final + anexa foto | B. Două documente separate: raportul (semnat pe hârtie, ca azi) și PV-ul (semnat în ERP) | C. PV-ul e documentul principal; raportul pe model = Anexa 1, anexa foto = Anexa 2; un singur fișier, o singură semnare |
|---|---|---|---|
| Ce semnează reprezentantul | o dată, la final | de două ori, pe căi diferite | o dată, pe PV, care declară anexele parte din el (codul pe fiecare pagină) |
| Modelul beneficiarului | păstrat | păstrat | păstrat ca anexă; blocul de semnături din model poartă „semnat prin PV nr. …, cod …” |
| Complexitate | mică | mică, dar două dovezi de ținut în pas | mică |

**Recomandare: C** (O11): un singur act de semnare, raportul cerut de beneficiar rămâne neschimbat ca rubrici, iar amprenta PV-ului acoperă și
conținutul raportului. Dacă beneficiarul cere raportul semnat separat, B.

---

## 5. Semnătura Antreprenorului „din ERP”

### 5.1 Persoanele desemnate

Lista pe proiect (tabel nou): utilizatorul, numele și funcția **afișate în PV**, cine l-a desemnat și când, `retras_la` / `retras_de`.
- **Cine administrează lista:** principiul deciziei D14 din specificația Redări (owner-ul și managerul de proiect). **În Execuție nu există
  azi un câmp „manager de proiect”** pe proiect (comentariul din migrarea `20261029a`), deci (O6): **A** owner + administrator Execuție cu
  acces la proiect (`fn_executie_contract_drept`, fără schemă nouă pe proiect) — recomandat; **B** un câmp nou „manager de proiect” pe
  proiectul de Execuție (schimbare de schemă, acordul proprietarului); **C** doar owner-ul.
- Fiecare persoană desemnată trebuie să aibă și **scriere** pe proiect (Execuție editor / admin, cu acces la proiect); identitatea vine
  **doar** din `auth.uid()` (L08); numele și funcția se iau din listă, de server, nu din formular. Simplul nivel de admin **nu** dă dreptul de
  a semna. Recomandare pentru numire (O7): **1–3 persoane pe proiect** (ex. responsabilul de contract, șeful de șantier, inginerul care
  conduce probele); numirea o face proprietarul.
- Retragerea unei persoane nu atinge PV-urile deja semnate (numele și funcția sunt copiate în conținutul canonic).
- Rubricile vechi `semn_constructor_*` din raport rămân pentru tipărirea pe hârtie; în PV contează doar semnatarul din listă.

### 5.2 Ce înseamnă „iese deja semnat”

Semnătura se aplică **în momentul în care persoana desemnată confirmă, din contul ei** — niciodată automat de către oricine închide raportul.

| | A. Confirmare explicită pe fiecare PV | B. Automat, dacă raportul e închis chiar de persoana desemnată | C. Împuternicire permanentă: automat la orice închidere conformă |
|---|---|---|---|
| Cum arată | după închidere, persoana desemnată vede conținutul PV-ului (tabelul, rezultatul, textul) și apasă „Semnez PV-ul pentru Antreprenor”, cu bifa „am verificat datele” | dialogul de închidere spune „închizi raportul ȘI semnezi PV-ul”; un singur pas | nimeni nu apasă nimic: PV-ul apare semnat |
| Ce dovedește | persoana a văzut conținutul exact (amprenta) și a semnat-o ea | persoana a închis raportul; semnătura e un efect al închiderii | doar că persoana a acceptat cândva împuternicirea |
| Ce poate contesta persoana / beneficiarul | puțin | „am închis un raport tehnic, nu am semnat un act” (două acte amestecate) | „n-am văzut niciodată documentul”; semnătura aplicată de altcineva, în numele ei |
| Pe șantier | dacă persoana nu e de față, semnează de pe telefonul ei, oriunde | doar dacă persoana e cea care închide | cel mai rapid |

**Recomandare: A** (O8), cu o scurtătură: dacă cel care închide raportul e chiar persoana desemnată, după „Închide raportul”
ecranul trece direct la „Semnez PV-ul” — **două confirmări explicite, două acte**, fără să mai caute PV-ul. **C se exclude** (semnătură fără act
de voință al semnatarului). Pe șantier: e bine ca șeful de șantier să fie printre persoanele desemnate, altfel reprezentantul așteaptă.

Un singur RPC (L02) face: verifică dreptul (persoană din listă, neretrasă, cu scriere pe proiect), raportul `inchisa` + CONFORM + regula de la
§3.5, că nu există alt PV valabil pe raport; alocă numărul, fixează conținutul canonic și amprenta, scrie semnătura (utilizator, nume și funcție
copiate, ora, amprenta imaginii) și jurnalul. Cheie UUID per intenție (L04, L05), reluarea întoarce același PV.

### 5.3 Imaginea semnăturii

- Încărcată **o dată** de persoana însăși (din contul ei), PNG pe fond transparent, cel mult 200 KB, verificată după conținut; păstrată ca
  octeți în BD, cu SHA-256; o versiune nouă nu schimbă PV-urile deja semnate (au amprenta imaginii folosite). Fără imagine: mențiunea
  „semnat din platformă de persoana desemnată, autentificată”.
- **Cum e păzită:** nu se listează și nu se citește direct (fără SELECT pentru clienți); ecranul o primește doar printr-un RPC, doar pentru un PV
  pe care a fost aplicată (amprenta din conținutul canonic) și doar de cine are citire pe proiect. Riscul rămas: oricine poate citi un PV
  vede imaginea (ca pe hârtie); imaginea singură nu face un PV valabil — conținutul canonic și amprenta din ERP sunt referința.
- **Tabel comun cu Redări?** Specificația Redări propune o tabelă proprie de imagini (`red_pv_semnatura_imagini`), încă neconstruită. O tabelă
  comună „imaginile semnăturilor” ar evita două încărcări pentru aceeași persoană; se decide la felia S2, după cum stă Redări S3 atunci.
  Implicit: tabelă proprie Execuție (nicio dependență între module).

---

## 6. Semnătura reprezentantului beneficiarului

Reprezentantul **nu primește niciun cont** (§10). E de față, pe șantier.

### 6.1 Variantele

| | A. Semnătură trasă cu degetul pe telefonul echipei, pe loc | B. Link personal trimis lui (telefon / e-mail), semnare de pe dispozitivul lui | C. Doar olograf |
|---|---|---|---|
| Cum arată | membrul echipei deschide PV-ul semnat de Antreprenor în „modul predare” (ecran întreg); reprezentantul vede conținutul (tabelul, rezultatul, textul, codul documentului), își alege numele din lista reprezentanților proiectului sau și-l scrie, scrie funcția, bifează „Am verificat datele și confirm”, semnează cu degetul, apasă „Semnez” | primește un link (și un cod), deschide PV-ul pe telefonul lui, semnează | PV-ul tipărit, semnat de mână, scanat / fotografiat, urcat |
| Ce dovezi rămân | amprenta conținutului pe care s-a semnat (fixată de server), numele și funcția scrise de el, imaginea semnăturii (octeți + SHA-256), momentul (serverul), contul membrului echipei care a ținut telefonul, opțional poziția GPS la semnare | ca A + controlul dispozitivului lui (link + cod la numărul dat de beneficiar) | scanul (fără legătură criptografică cu PDF-ul), momentul încărcării, cine l-a urcat, cine l-a confirmat |
| Ce poate contesta | „nu eu am semnat” (semnătura e pe telefonul nostru, ținut de omul nostru); „n-am văzut tot documentul” | „nu eu am folosit linkul” (mai greu de susținut) | „nu e exemplarul meu” / pagini schimbate |
| Ce trebuie să accepte beneficiarul în scris înainte | că PV-urile de uscare se pot semna de reprezentantul lui în aplicația Antreprenorului, pe dispozitivul echipei, cu semnătură trasă; lista (nume, funcție) a reprezentanților împuterniciți | ca A + că i se trimit mesaje (numărul / adresa, de la beneficiar) | nimic nou |
| Efort | mediu (componentă de semnătură trasă, un RPC, octeți în BD) | mare (mesaje SMS / e-mail, link, cod, limite — practic tot fluxul din Redări; trimiterea de mesaje cere și „da”-ul proprietarului pe canal) | mic |
| Pe șantier | merge oriunde e semnal | cere semnal la el și răbdare | cere imprimantă sau amână confirmarea |

**Recomandare: A + olograful ca rezervă (O9).** Reprezentantul e de față, deci mecanismul de cod prin SMS din Redări nu aduce
mult; semnătura trasă seamănă cu obiceiul de pe hârtie (în Redări decizia D7 „fără semnătură desenată” privește deținători la distanță,
nu un reprezentant prezent). B doar dacă beneficiarul o cere explicit.

### 6.2 Detaliile variantei A

- **Fără semnal, fără semnătură electronică:** momentul și amprenta le fixează serverul; o semnătură „păstrată pe telefon și trimisă mai
  târziu” ar avea ora telefonului, nu a serverului. Fără semnal: olograf (§6.4) sau semnarea când e semnal.
- **Ce vede reprezentantul** nu e un PDF micșorat, ci conținutul canonic pe ecran, mare: tronsonul și km-ii, data și orele, tabelul greutăților,
  pragul și rezultatul, temperatura, textul de confirmare, semnătura Antreprenorului, **codul documentului**; „vezi pozele” deschide anexa.
  Același cod apare apoi pe fiecare pagină a PDF-ului.
- **Lista reprezentanților pe proiect** (propunere implicită): numele și funcția comunicate în scris de beneficiar, trecute de administratorul
  Execuție (fără telefoane, fără e-mailuri). Reprezentantul se alege din listă; „altă persoană” rămâne posibil (scris de el), marcat în PV ca
  „nu figurează în lista comunicată”.
- **Imaginea semnăturii** stă doar în memoria ecranului până la rezultatul dovedit de server (L05: retrimitere cu aceeași cheie; nimic în
  ciorna locală — e o dată personală); după rezultat, se șterge din ecran.
- **Antifraudă internă** (risc rămas, scris): omul nostru ar putea trage singur semnătura. Atenuări: contul lui e consemnat; poziția la semnare;
  lista reprezentanților; reprezentantul primește PDF-ul semnat (trimis de om, nu automat) și poate reclama. Nu se poate împiedica tehnic.
- Datele reprezentantului (nume, funcție, imaginea semnăturii) se păstrează cât PV-ul; nu intră în repo, rapoarte publice sau exporturi în afara
  PV-ului.

### 6.3 Ce devine PV-ul după semnare

PV-ul semnat de beneficiar (electronic) sau cu exemplarul olograf confirmat = **tronsonul confirmat uscat** (§8). PDF-ul final se generează
din conținutul canonic + ambele semnături; **predarea către beneficiar o fac oamenii** (mail / hârtie), nimic nu pleacă automat.

### 6.4 Exemplarul olograf (rezerva, în orice variantă)

1. **Tipărire**: PDF-ul PV-ului semnat de Antreprenor, cu blocul beneficiarului liber, codul documentului și „pagina n din m” pe fiecare pagină.
2. **Semnare** pe hârtie de reprezentant (și, dacă se dorește, olograf și de persoana desemnată — semnătura electronică rămâne în ERP).
3. **Urcarea scanului** (orice membru al echipei cu scriere pe proiect): JPG / PNG / PDF, cel mult 6 fișiere, 10 MB în total, tipul verificat
   după conținut, SHA-256 calculat de server; **octeți în BD** (bucket-ul de azi primește doar JPEG pe căi `.jpg`, iar un scan e adesea PDF; în
   plus, octeții în BD scot încărcările „pe jumătate”), cheie UUID per intenție.
4. **Verificarea de către om**: o persoană desemnată (sau administratorul Execuție cu acces la proiect) vede scanul alături de PV-ul generat și
   confirmă explicit, consemnat cu identitatea ei: toate paginile, codul documentului lizibil pe fiecare, nr. PV-ului, semnătura la locul ei,
   niciun text schimbat vizibil. Acceptă → olograf confirmat; respinge cu motiv → înapoi la „semnat de Antreprenor”. Propunere implicită: cel
   care confirmă **poate** fi același cu cel care a urcat (echipele sunt mici), consemnat; separarea se poate cere mai târziu.
5. **Riscul rămas, spus cinstit** (ca în specificația Redări): serverul nu citește scanul; legătura scan ↔ PV e verificarea vizuală a omului.
   O pagină schimbată, nevăzută la confirmare, rămâne posibilă; se descoperă comparând scanul cu PV-ul regenerat din conținutul canonic (codul
   documentului trebuie să fie același).

---

## 7. Stările

**Raportul nu primește stări noi** (`deschisa` / `inchisa` / `anulata` rămân, cu tranzițiile și testul de paritate de azi). Se adaugă doar
marcajul etapei 1 (§2.1), care nu e o stare. **PV-ul e un obiect separat**, cu mașina lui de stări (tabel nou, `UNIQUE` pe raport pentru PV-urile
neinvalidate, L16):

| Din | În | Cine | Ce verifică serverul |
|---|---|---|---|
| — | `semnat_antreprenor` | persoana desemnată (§5) | raportul `inchisa`, CONFORM, regula de la §3.5, niciun alt PV valabil pe raport |
| `semnat_antreprenor` | `semnat_beneficiar` | membrul echipei cu scriere pe proiect, cu reprezentantul de față (§6.2) | amprenta văzută de reprezentant = amprenta PV-ului; versiunea (CAS) |
| `semnat_antreprenor` | `olograf_incarcat` | scriere pe proiect | fișierele (§6.4) |
| `olograf_incarcat` | `olograf_confirmat` | persoana desemnată / admin Execuție cu acces la proiect | confirmarea explicită |
| `olograf_incarcat` | `semnat_antreprenor` | idem | respingere, cu motiv |
| `semnat_antreprenor`, `olograf_incarcat` | `invalidat` | persoana desemnată / admin Execuție, cu motiv | — |
| `semnat_beneficiar`, `olograf_confirmat` | `invalidat` | owner-ul, cu motiv (O15, recomandat) | — |
| orice stare neinvalidată | `invalidat` | **automat**, în aceeași tranzacție cu **redeschiderea raportului** | — |

- **„Tronson confirmat uscat”** nu e o stare stocată: e derivat din PV-urile `semnat_beneficiar` / `olograf_confirmat` neinvalidate (§8, L19).
- **Redeschiderea** unui raport cu PV: același RPC de azi (`fn_executie_uscare_stare`) invalidează PV-ul în aceeași tranzacție (L02), vizibil
  (stare `invalidat`, motivul redeschiderii, cine, când); **nimic nu se șterge**: conținutul canonic, semnăturile și scanurile rămân, cu mențiunea
  „invalidat”. Redeschiderea unui raport al cărui PV e **semnat de beneficiar** cere owner-ul (O15), nu doar administratorul Execuție: anulează un
  act semnat de cealaltă parte. Reînchiderea cere un PV nou (număr nou, „înlocuiește PV nr. …”).
- **Concurența (două telefoane):** semnarea electronică și urcarea olografului pe același PV, sau redeschiderea raportului cât reprezentantul
  semnează: CAS pe versiunea PV-ului; ordinea lock-urilor, aceeași pe toate căile (L06): cheia apăsării → raportul FOR UPDATE → numerotarea pe
  proiect (lock consultativ, doar la generare) → PV-ul FOR UPDATE → jurnalul. Redeschiderea ia raportul, apoi PV-ul: aceeași ordine. Cel care
  pierde primește „PV-ul s-a schimbat între timp” și starea curentă; semnătura trasă nu se pierde din ecran până la răspunsul dovedit (§6.2).
- Idempotența și „Renunț”: **același spațiu de chei** ca azi (jurnalul raportului, cheia autorului, retragerea legată de intenție, spec. §6) —
  lista acțiunilor din jurnal și funcția de amprentă a intenției se extind cu RPC-urile noi (§11).

---

## 8. „Tronson confirmat uscat”

### 8.1 Unde se vede

- **Lista rapoartelor de uscare** (ecranul de azi): coloana / eticheta PV-ului („PV U-007 — semnat de beneficiar”, „așteaptă semnătura
  beneficiarului”, „olograf de verificat”, „invalidat”).
- **Probe pe tronsoane** (lista și fișa tronsonului de probă): „💨 Uscat confirmat — PV U-007 din 18.11.2026” sau „parțial: 3.200 m din 4.870 m”,
  citit **prin cheia străină** `proba_id` a raportului (o vedere `security_invoker`, L19, L23 la citire).
- **Harta**: nu acum — platforma nu are încă un traseu calibrat salvat pe proiect (spec. §9); după ce există, intervalele confirmate se pot
  colora pe ax. Rămâne în afara treptei a doua.

### 8.2 Legătura cu etapa „uscare” din Probe pe tronsoane

Etapa „uscare” a tronsonului de probă (`executie_probe_etape`, starea urmează / în curs / făcut …) rămâne **manuală**, cum e azi.

| | A. Doar afișare | B. Afișare + buton | C. Sincronizare prin trigger |
|---|---|---|---|
| Ce face | fișa arată starea derivată lângă etapa manuală și avertizează la nepotrivire („etapa e «făcut», dar nu există PV confirmat” / invers) | ca A + butonul „Marchează etapa uscare făcută (PV U-007)”, care cheamă RPC-ul existent al etapei cu datele propuse; omul confirmă | etapa se schimbă singură |
| Risc | — | — (o acțiune a omului, pe calea existentă) | copii sincronizate prin trigger-e + lock-uri între module: exclus (lecția de design din review-urile anterioare) |

**Recomandare: A, apoi B** (în S3). Fără copii, fără trigger-e între module.

### 8.3 Acoperirea parțială și campaniile

- Un tronson de probă e **confirmat uscat** într-o campanie când **reuniunea** intervalelor PV-urilor confirmate din acea campanie îi acoperă tot
  intervalul `[km_de_la, km_pana_la]`; altfel „parțial: x m din y m”, cu golurile listate („lipsește 3+200 – 3+870”). Calculul pe intervale e o
  singură funcție (SQL = JS, L19).
- Un raport pe un **interval liber** (fără tronson de probă) apare în lista uscărilor, ordonat după km, cu starea PV-ului; nu „acoperă” niciun
  tronson de probă.
- **Campaniile**: caietul cere uscarea după proba cu apă **și** din nou după proba cu aer (spec. §1). Propunere (O13): un câmp „campania”
  (`dupa_apa` / `dupa_aer`) pe raport, ales la creare (obligatoriu la rapoartele noi; gol la cele vechi = „nedefinită”); confirmarea se arată
  pe fiecare campanie. Fără el, o uscare după proba cu apă ar părea că acoperă și uscarea de după proba cu aer.

---

## 9. Vremea

**Există deja** (spec. §10): temperatura exterioară cu sursa ei (`manual` = măsurată de om / `meteo` = din vremea șantierului, cu
instantaneul construit de server: furnizorul, șantierul, ora cerută = ora începerii, ora observației, ora preluării, valoarea automată),
vremea (text), poza termometrului (categoria `temperatura`, cerută). Funcția edge pentru vremea pe coordonate rămâne doar proiectată.

**Ce e „oficial” în PV:**

| | A. Valoarea măsurată pe loc | B. Valoarea din serviciul meteo | C. Valoarea din raport, cu sursa scrisă; ambele dacă există |
|---|---|---|---|
| În PV | „Temperatura exterioară: 7,5 °C, măsurată pe loc (foto nr. 4)” | „6,8 °C, serviciul meteo, șantierul …, observația de la 09:00” | rândul principal = valoarea raportului cu sursa ei; dacă omul a măsurat și instantaneul meteo există, a doua linie: „valoarea automată a serviciului meteo: 6,8 °C (observația de la 09:00)” |

**Recomandare: C** (propunere implicită): valoarea din raport e cea oficială (măsurată dacă omul a măsurat, altfel cea automată), sursa se
scrie întotdeauna, iar condițiile meteo vin din câmpul „vremea”. Nu se adaugă o a doua temperatură „la ieșire” (modelul are una).

---

## 10. Accesul

Matricea de azi (spec. §8) rămâne. Se adaugă doar:

| Acțiune | Cine |
|---|---|
| Încheie etapa 1, corecția consemnată a intrării | scriere pe proiect (ca salvarea) |
| Setează / schimbă pragul proiectului | owner + administrator Execuție cu acces la proiect (O6) |
| Administrează lista persoanelor desemnate și lista reprezentanților | owner + administrator Execuție cu acces la proiect (O6) |
| Semnează PV-ul pentru Antreprenor | **doar** persoanele desemnate pe proiect, care au și scriere pe proiect |
| Își încarcă imaginea semnăturii | doar persoana desemnată, pentru ea însăși |
| Ține telefonul la semnarea reprezentantului (§6.2) | scriere pe proiect; contul e consemnat |
| Urcă exemplarul olograf | scriere pe proiect |
| Confirmă / respinge exemplarul olograf | persoana desemnată sau administratorul Execuție cu acces la proiect |
| Invalidează un PV nesemnat de beneficiar | persoana desemnată sau administratorul Execuție, cu motiv |
| Invalidează / redeschide raportul unui PV semnat de beneficiar | owner-ul, cu motiv (O15) |
| Citește PV-urile, starea tronsoanelor | citire pe proiect (ca rapoartele) |

**Reprezentantul beneficiarului nu primește nimic**: niciun cont, niciun link, niciun acces la ERP. Datele lui în ERP: numele, funcția, imaginea
semnăturii, pe PV-ul semnat. Toate scrierile: doar prin RPC-uri SECURITY DEFINER cu `auth.uid()` obligatoriu, drept verificat pe proiectul
fiecărui id atins (L07, L08, L09); niciun drept INSERT / UPDATE / DELETE pe tabele.

---

## 11. Schema și livrarea (DOAR inventar)

**Regula:** o migrare **NOUĂ** peste `20261225a` (care rămâne neschimbată, inclusiv manifestul ei L15), numerotată la implementare după
numele de pe toate branch-urile (azi primul număr liber ar fi după `20261226b`), cu procedura de livrare existentă: amprenta globală L15 v2
(manifest `.l15.tsv` generat de coordonator pe clonă, diferențele declarate exact), plafonul și bugetul de lock ale runnerului, revenire în
`supabase/revenire/` cu verificarea stării exacte, proba locală PGlite cu mutanți, proba cu două sesiuni pe clonă. **Precondiție:** `20261225a`
aplicată pe producție (fără ea, nimic din treapta a doua nu are pe ce sta).

### 11.1 Inventarul

| Obiect | Nou / schimbat | Rolul | Felia |
|---|---|---|---|
| `executie_uscari` + coloane | schimbat (ALTER) | `doua_etape` (server, la creare), `etapa1_la` / `etapa1_de` (server), `etapa1_ora_declarata`, `cantar_intrare` / `cantar_iesire` (descriere + diviziune, jsonb cu formă verificată), `corectie_intrare_motiv`, `plauzibilitate_confirmata`, `campanie`, `prag_aplicat` + `criteriu_rezultat` (server, la închidere), `motiv_nepotrivire` | S1 |
| `executie_uscare_praguri` | nou | parametrul pe proiect, doar adăugare (§3.6) | S1 |
| `fn_executie_uscare_criteriu` | nou | calculul (§3.1–3.4), paritate cu `criteriuUscare` din JS | S1 |
| `fn_executie_uscare_etapa` | nou (RPC) | încheie etapa 1 (§2.1), îngheață intrarea în jurnal | S1 |
| `fn_executie_uscare_prag` | nou (RPC) | setează o versiune nouă a pragului | S1 |
| `fn_executie_uscare_salveaza` | schimbat | cheile noi în `CAMPURI`, ordinea etapelor, corecția consemnată | S1 |
| `fn_executie_uscare_lipsa` / `lipsaDinRand` | schimbat | etapa 1 încheiată (rapoartele noi), criteriul numeric (§3.5), motivul nepotrivirii | S1 |
| `fn_executie_uscare_stare` | schimbat | copiază pragul la închidere; invalidează PV-ul la redeschidere; owner pentru PV semnat de beneficiar | S1 (pragul), S2 (PV) |
| `fn_executie_uscare_garda` | schimbat | coloanele puse de server în lista de meta; garda pe ordinea etapelor și pe corecții | S1 |
| `fn_executie_uscare_amprenta`, `fn_executie_uscare_retrage`, CHECK-ul acțiunilor din jurnal | schimbat | RPC-urile și acțiunile noi în același spațiu de chei (§7) | S1–S3 |
| `executie_uscare_semnatari` | nou | persoanele desemnate (§5.1) | S2 |
| `executie_uscare_semnatura_imagini` | nou | imaginile semnăturilor (§5.3); sau tabelă comună cu Redări | S2 |
| `executie_uscare_texte_confirmare` | nou | textele versionate (§4.1 pct. 8) | S2 |
| `executie_uscare_pv` | nou | PV-ul: nr., stare, versiune, conținutul canonic, amprenta, semnătura Antreprenorului; `UNIQUE (proiect, nr)`, un singur PV neinvalidat pe raport | S2 |
| `fn_executie_uscare_pv_semneaza` | nou (RPC) | generare + semnătura Antreprenorului, într-un singur pas (§5.2) | S2 |
| `fn_executie_uscare_semnatar`, `fn_executie_uscare_semnatura_imagine` | noi (RPC) | lista și imaginea | S2 |
| `fn_executie_uscare_pv_invalideaza` | nou (RPC) | invalidarea manuală (§7) | S2 |
| `executie_uscare_reprezentanti` | nou | reprezentanții beneficiarului pe proiect (nume, funcție; propunere implicită) | S3 |
| semnătura reprezentantului (coloane pe PV sau tabel propriu) | nou | nume, funcție, imaginea (octeți + SHA-256), momentul, contul care a ținut telefonul, poziția opțională | S3 |
| `executie_uscare_pv_olograf` | nou | scanurile (octeți, tip verificat, SHA-256), confirmarea / respingerea | S3 |
| `fn_executie_uscare_pv_beneficiar`, `fn_executie_uscare_pv_olograf`, `fn_executie_uscare_pv_olograf_decide` | noi (RPC) | §6 | S3 |
| `executie_v_uscare_tronsoane` | nou (vedere `security_invoker`) | starea derivată pe tronson de probă și campanie, acoperirea pe intervale (§8) | S3 |
| Ecran: `UscareConducta.jsx` + `uscareLogica.js` + `uscareRaport.js` / `uscarePdf.js` | schimbat | etapele, propunerea calculului, PV-ul, modul predare, olograful | S1–S3 |
| Probe pe tronsoane (fișa) | schimbat (doar citire + butonul B) | §8.2 | S3 |

### 11.2 Feliile

| Felia | Ce aduce | Se poate folosi singură? | Depinde de | Estimare (fără rundele de review) |
|---|---|---|---|---|
| **S1 — două etape + prag** | ecranul pe etape, „Închei etapa 1”, înghețarea intrării, cântarul, ordinea în tren, parametrul pe proiect, calculul + propunerea, regula de închidere, campania; în PDF-ul raportului un bloc „criteriul numeric” **doar** dacă pragul e setat (decizia D rămâne pentru proiectele fără prag) | **da**: raportul devine în două etape și calculează pragul; se semnează pe hârtie, ca azi | `20261225a` aplicată; O1–O5, O13 | 3–4 zile |
| **S2 — PV + semnătura Antreprenorului** | lista persoanelor desemnate, imaginea semnăturii, textele, PV-ul (conținut canonic, amprentă, număr), semnarea din cont, PDF-ul PV-ului, invalidarea la redeschidere | **da**: PV-ul iese semnat de Antreprenor, se tipărește și reprezentantul îl semnează pe hârtie | S1; O6–O8, O10, O11, O14 | 4–5 zile |
| **S3 — beneficiarul + olograf + tronson confirmat** | modul predare cu semnătura trasă, lista reprezentanților, urcarea și confirmarea olografului, vederea pe tronsoane, afișarea în Probe | **da** (completează ciclul) | S2; O9, O15; acordul scris al beneficiarului pentru varianta A (§6.1) | 4–5 zile |

Fiecare felie: migrare proprie + revenire, PR propriu, review Jakarinos înainte de cererea de merge, test de paritate JS = SQL pe tabelul de cazuri.

---

## 12. Decizii pentru proprietar

Fiecare cu o literă; recomandarea e în ultima coloană.

| # | Întrebarea | A | B | C | Recomandare |
|---|---|---|---|---|---|
| O1 | **Sursa și formularea pragului** (nu apare în corespondența scrisă verificată) | Cerem beneficiarului confirmarea **scrisă** (valoarea, unitatea, „fiecare piston / pistoanele împreună”, lungimea de referință); o trecem ca parametru cu documentul ca sursă; până atunci, fără prag | O trecem acum, cu sursa „comunicare verbală din …, de confirmat” | Fără prag deloc; doar criteriul din caiet | **A** (un PV semnat de beneficiar nu trebuie să tipărească un criteriu fără sursă) |
| O2 | **„Trece” cu 2 piston-bureți** | fiecare burete ≤ prag | doar ultimul ≤ prag | suma ≤ prag | **A**, dacă beneficiarul nu spune altfel în scris (O1) |
| O3 | **Lungimea de referință** | lungimea din raport (`lungime_m`), cu avertisment dacă diferă cu peste 2% de intervalul de km | diferența de km | — | **A** |
| O4 | **CONFORM când calculul nu se poate aplica** (burete rămas, cântar diferit, valori neplauzibile) | refuz: se face altă trecere | permis, cu motiv tipărit în PV | — | **A** |
| O5 | **Cine continuă etapa 2** | oricine are scriere pe proiect | doar omul din etapa 1 | omul din etapa 1 sau cine îl preia explicit | **A** |
| O6 | **Cine setează pragul și administrează listele** (managerul de proiect nu există în Execuție) | owner + administrator Execuție cu acces la proiect | câmp nou „manager de proiect” pe proiectul Execuție (schemă) | doar owner-ul | **A** |
| O7 | **Cine sunt persoanele desemnate** | 1–3 pe proiect, numite de proprietar (ex. responsabilul de contract, șeful de șantier, inginerul de probe) | toți administratorii Execuție | — | **A**; numele le dă proprietarul înainte de S2 |
| O8 | **Când se aplică semnătura Antreprenorului** | confirmare explicită pe fiecare PV | automat, dacă închide chiar persoana desemnată | împuternicire permanentă | **A** (cu trecerea directă la „Semnez PV-ul” când închide persoana desemnată); C exclus |
| O9 | **Semnarea reprezentantului** | semnătură trasă pe telefonul echipei, pe loc | link personal + cod pe dispozitivul lui | doar olograf | **A** + olograful ca rezervă; A cere înainte acordul scris al beneficiarului (§6.1) |
| O10 | **Textul de confirmare** | Varianta 1 (cu criteriul scris) | Varianta 2 (scurtă) | — | **A** (Varianta 1); formularea finală de la Juridic |
| O11 | **Un document sau două** | un fișier: raport + pagina de PV | două documente separate | PV-ul cu raportul ca Anexa 1 și pozele ca Anexa 2, o singură semnare | **C** |
| O12 | **Trecerile nereușite în PV** | se menționează | nu se menționează | — | **A** |
| O13 | **Campania** (după proba cu apă / după proba cu aer) | câmp pe raport, confirmarea pe fiecare campanie | nu se distinge | — | **A** |
| O14 | **PV fără prag setat** | se generează, cu criteriul din caiet („ultimul piston vehiculat iese uscat”) | nu se generează | — | **A** |
| O15 | **Redeschiderea unui raport cu PV semnat de beneficiar** | doar owner-ul, cu motiv; PV-ul se invalidează vizibil | administratorul Execuție, ca azi | — | **A** |

**Propuneri implicite** (se aplică dacă proprietarul nu spune altfel): numărul PV „U-nnn/AAAA” pe proiect; 2 exemplare tipărite; Δ negativ de cel
mult 2 diviziuni (sau 1% din intrare) = fără acumulare; confirmarea explicită la ieșire > 3 × intrare, Δ > 20 × prag sau intrare < 0,1 kg;
avertismentul „cântar prea grosier” la diviziune > prag / 5; cel care confirmă olograful poate fi cel care l-a urcat (consemnat); lista
reprezentanților pe proiect; temperatura oficială = valoarea raportului cu sursa scrisă (§9); imaginile semnăturilor în tabelă proprie Execuție.

**Ce trebuie cerut beneficiarului în scris** (de oameni, nu din platformă): valoarea pragului, unitatea, regula pentru mai mulți bureți și lungimea
de referință (O1–O3); acordul pentru semnarea PV-urilor de uscare în aplicația Antreprenorului, pe dispozitivul echipei (O9 A); lista reprezentanților
împuterniciți (nume, funcție); acceptarea formei documentului (O11) și a numărului de exemplare.

---

## 13. Ce NU face treapta a doua

- Nu schimbă migrarea `20261225a` și nici manifestul ei; totul intră într-o migrare nouă.
- Nu trimite nimic: niciun SMS, niciun e-mail, nicio notificare către beneficiar sau reprezentant; PV-ul semnat îl predau oamenii.
- Nu dă cont, link sau acces reprezentantului beneficiarului; nu are semnare de la distanță (varianta B de la §6) decât dacă beneficiarul o cere.
- Nu are semnătură calificată, sigiliu sau marcă temporală calificată; integritatea e „nemodificabil prin aplicație” (administratorul BD și o restaurare
  din copie rămân în afara garanției, ca în specificația Redări).
- Nu citește kilogramele din pozele cântarului (nici OCR, nici AI): cifrele le scrie omul, poza e dovada pentru cine verifică.
- Nu folosește ora din fișierul pozei ca dovadă (o declară telefonul); ora din anexă rămâne ora încărcării.
- Nu semnează offline; fără semnal, rezerva e exemplarul olograf.
- Nu pune un prag pe punctul de rouă și nu-l face obligatoriu.
- Nu ține mai multe treceri într-un singur raport.
- Nu sincronizează etapa „uscare” din Probe pe tronsoane prin trigger-e; nu desenează harta intervalelor uscate.
- Nu generează PDF-ul pe server (rămâne în navigator, din conținutul canonic) și nu calculează amprenta fișierelor foto.
- Nu scrie funcția edge pentru vremea pe coordonate (rămâne proiectată, spec. §10).
- Nu adaugă drepturi noi pe module: rolurile noi sunt liste pe proiect, în interiorul dreptului Execuție existent.

---

## 14. Lecțiile L01–L25 (ce va conta la implementare)

| Regula | Unde contează |
|---|---|
| L01 | numerotarea PV-urilor (lock pe proiect + `UNIQUE`), un singur PV valabil pe raport, CAS pe versiunea PV-ului |
| L02 | generarea + semnătura Antreprenorului într-un RPC; invalidarea PV-ului în aceeași tranzacție cu redeschiderea; scanul olograf scris odată cu hash-ul |
| L04, L05 | cheie UUID per intenție pe toate RPC-urile noi, în spațiul de chei existent; semnătura trasă rămâne în ecran până la rezultatul dovedit; „Renunț” prin intenție |
| L06 | ordinea cheia → raportul → numerotarea → PV-ul → jurnalul, aceeași pe semnare, olograf, redeschidere |
| L07, L08, L09 | ordinea etapelor, înghețarea intrării și regula de închidere impuse de trigger; `etapa1_*`, `prag_aplicat`, semnatarul puse de server; dreptul verificat pe proiectul fiecărui raport / PV atins |
| L12 | nimic nu dispare tacit: buretele „nu se aplică”, corecțiile, pozele încărcate după introducere și trecerile anterioare apar în PV |
| L14, L15 | migrare nouă cu amprenta globală L15 v2 și diferențele declarate (funcțiile schimbate ale lui 20261225a), revenire testată |
| L16 | `UNIQUE (proiect, nr)`, PV neinvalidat unic pe raport |
| L17 | grame întregi, comparație în întregi, fără rotunjire; momentele în ora României; ora declarată ≠ momentul înregistrării |
| L18 | „nu se poate calcula” ≠ „trece”; „fără prag” ≠ prag 0; o eroare de citire a stării tronsonului = eroare, nu „neuscat” |
| L19 | calculul, plauzibilitatea, acoperirea pe intervale și starea derivată = o singură definiție SQL, cu paritate JS |
| L20 | gărzile testate și pe căile legitime: corecția consemnată, NECONFORM cu motiv, PV invalidat, raport vechi fără etape |
| L23, L24 | vederea pe tronsoane citită cu keyset; contextul capturat înaintea primului `await` la semnare, olograf, PDF |
| L25 | probe cu conturi non-owner (persoană desemnată vs editor nedesemnat), două sesiuni pe semnare / redeschidere concurente |
| L03, L10, L11, L13, L21, L22 | n/a (fără cache derivat, secrete, extragere din text, regex nou pe date externe sau apeluri AI) |

---

## 15. Istoric

- **17.11.2026, runda 1** — specificația treptei a doua, după cererea proprietarului (două etape, prag pe km, PV semnat de Antreprenor din ERP,
  semnătura reprezentantului în ERP sau olograf, tronson confirmat uscat). Doar document; deciziile O1–O15 deschise.
