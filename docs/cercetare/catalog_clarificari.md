# Catalog de clarificări — șabloane cu temei normativ și practică CNSC (runda 1 — ISTORIC)

> ⚠️ **Înlocuit de `clarificari_tipare.md` / `clarificari_tipare.json` (runda 2)**: tipare structurate, întrebări neutre, legate de cerințe verificate, cu review juridic marcat. Acest fișier rămâne doar ca istoric — unele formulări de aici sunt argumentative sau au temei neverificat; nu se trimit ca atare.

> Livrabil C · 01.10.2026 · șabloane gata de adaptat pentru întrebările Gazpet către autoritățile contractante (AC).
> Fiecare intrare: **situația** din documentație → **șablon** de întrebare (câmpurile `[ ]` se completează) → **temei** → **practică CNSC** (detalii în `cnsc_practica.md`, acte în `baza_normativa.md`).
> Codurile `CL-X00` sunt stabile — pot deveni chei în generatorul de clarificări (vezi `propuneri_platforma.md`). Coloana „cat. ERP” arată corespondența cu categoriile A–E din `ofertare-clarificari-propune`.

## Reguli de folosire (din lege și practica CNSC)

1. **Termene:** AC răspunde cu **cel puțin 10 zile** înainte de termenul de depunere (6 zile la procedura simplificată pentru lucrări) — L98 art. 161; întrebările trebuie puse până la termenul-limită din anunț (L98 art. 160 alin. (2), HG 395 art. 27 alin. (2)). Răspuns întârziat → cerem prelungirea termenului (CL-P).
2. **Ce nu se clarifică se contestă la timp:** contestarea documentației de atribuire are termen de **10 zile** (7 sub prag) de la publicare/răspuns — L101 art. 8. După depunere, o cerință acceptată tacit nu mai poate fi atacată eficient.
3. **Clarificarea care închide disputa în favoarea noastră:** autorizarea ANRE expresă (tip + Ordin 17/2026), definirea noțiunilor din factorii de evaluare, procentul NDT, formula de ajustare — CNSC nu completează documentația „de drept” cu legi speciale (BO2022_2403, BO2023_416), deci ambiguitatea se închide ÎNAINTE de depunere.
4. **Cantitățile F3 nu se corectează în ofertă** (BO2026_3104) — orice diferență se ridică la clarificări.
5. **Formulare:** politicoasă, punctuală, cu trimitere la pagina/secțiunea din DA și la temei; o singură problemă pe întrebare; fără date care identifică strategia noastră de preț.

## Index

| Cod | Situație | Cat. ERP | Sursa cercetării |
|---|---|---|---|
| [CL-A01](#cl-a01) | Utilități subterane, amplasament, autorizații | A (ambiguitate) | Achiziții publice și contracte tip |
| [CL-A02](#cl-a02) | Documentația citează Ordinul ANRE 132/2021 sau cere „autorizație ANRE EDSB conform Ordin 132/2021” | A (ambiguitate) | ANRE, gaze, ISCIR, apă-canal |
| [CL-A03](#cl-a03) | Ediții de standarde depășite în CS | A (ambiguitate) | Sudură, NDT, izolație, materiale |
| [CL-A04](#cl-a04) | Referință la acte abrogate | A (ambiguitate) | Norme de deviz și legi conexe |
| [CL-A05](#cl-a05) | Branșamente: AC sau acord al administratorului drumului | A (ambiguitate) | Norme de deviz și legi conexe |
| [CL-A06](#cl-a06) | Drept de uz și acorduri ale proprietarilor (Legea 123/2012 art. 109–113) | A (ambiguitate) | Norme de deviz și legi conexe |
| [CL-A07](#cl-a07) | Contradicții între fișa de date, caietul de sarcini și contract | A (ambiguitate) | Gaze naturale |
| [CL-A08](#cl-a08) | Documente din PT cerute în oferta de P+E | A (ambiguitate) | Gaze naturale |
| [CL-A09](#cl-a09) | Gantt / termen de execuție neclar | A (ambiguitate) | Apă-canal și teme transversale |
| [CL-B01](#cl-b01) | Experiența similară este formulată restrictiv (identic, „finalizat”, „semnat în ultimii 5 ani” sau plafon peste valoarea estimată) | B (cerințe) | Achiziții publice și contracte tip |
| [CL-B02](#cl-b02) | Experiența obținută ca subcontractant sau în asociere | B (cerințe) | Achiziții publice și contracte tip |
| [CL-B03](#cl-b03) | Cifra de afaceri disproporționată sau pe o perioadă mai mare de 3 ani | B (cerințe) | Achiziții publice și contracte tip |
| [CL-B04](#cl-b04) | Garanția de participare: valoare, valabilitate, formă | B (cerințe) | Achiziții publice și contracte tip |
| [CL-B05](#cl-b05) | Autorizări ANRE sau alte autorizări pentru asociați, subcontractanți și terți | B (cerințe) | Achiziții publice și contracte tip |
| [CL-B06](#cl-b06) | Cerința „instalator autorizat ANRE gradul … / IGIB …” (terminologie veche) pentru personalul cheie | B (cerințe) | ANRE, gaze, ISCIR, apă-canal |
| [CL-B07](#cl-b07) | Asociere sau subcontractare: liderul nu are autorizație ANRE ori partea de gaze se subcontractează | B (cerințe) | ANRE, gaze, ISCIR, apă-canal |
| [CL-B08](#cl-b08) | Se cere licență ANRSC pentru un contract de execuție | B (cerințe) | ANRE, gaze, ISCIR, apă-canal |
| [CL-B09](#cl-b09) | Sudori: autorizații ISCIR expirate sau ale altui angajator | B (cerințe) | ANRE, gaze, ISCIR, apă-canal |
| [CL-B10](#cl-b10) | Cerințe de calificare a sudorilor neclare sau duble | B (cerințe) | Sudură, NDT, izolație, materiale |
| [CL-B11](#cl-b11) | Certificare ISO 3834-2 sau coordonator IWE ca cerință de calificare | B (cerințe) | Sudură, NDT, izolație, materiale |
| [CL-B12](#cl-b12) | Coordonatorul SSM (HG 300/2006) | B (cerințe) | Norme de deviz și legi conexe |
| [CL-B13](#cl-b13) | ISO 9001/14001/45001 | B (cerințe) | Norme de deviz și legi conexe |
| [CL-B14](#cl-b14) | RTE pentru gaze | B (cerințe) | Norme de deviz și legi conexe |
| [CL-B15](#cl-b15) | ES formulată doar pe „rețele de distribuție gaze” | B (cerințe) | Gaze naturale |
| [CL-B16](#cl-b16) | Documentele de dovedire a ES | B (cerințe) | Gaze naturale |
| [CL-B17](#cl-b17) | Autorizarea ANRE (cerință lipsă sau ambiguă) | B (cerințe) | Gaze naturale |
| [CL-B18](#cl-b18) | Intervenții pe rețele de gaze în contracte de drumuri sau apă | B (cerințe) | Gaze naturale |
| [CL-B19](#cl-b19) | Cerințe de nișă nejustificate | B (cerințe) | Gaze naturale |
| [CL-B20](#cl-b20) | DA cere experiență similară „identică” sau combinată în același contract (apă + canal + stație de epurare) | B (cerințe) | Apă-canal și teme transversale |
| [CL-B21](#cl-b21) | Garanția de participare: condiții privind emitentul sau forma | B (cerințe) | Apă-canal și teme transversale |
| [CL-B22](#cl-b22) | Activități care cer autorizări speciale | B (cerințe) | Apă-canal și teme transversale |
| [CL-B23](#cl-b23) | Personal cheie | B (cerințe) | Apă-canal și teme transversale |
| [CL-C01](#cl-c01) | Valoarea estimată, raportată la pragul de 80% | C (cantități) | Achiziții publice și contracte tip |
| [CL-C02](#cl-c02) | Formulare de prețuri excesiv de detaliate sau limitarea cheltuielilor indirecte și a profitului | C (cantități) | Achiziții publice și contracte tip |
| [CL-C03](#cl-c03) | CND sau buletine de laborator neprevăzute în deviz | C (cantități) | ANRE, gaze, ISCIR, apă-canal |
| [CL-C04](#cl-c04) | Rețete sau consumuri impuse | C (cantități) | Norme de deviz și legi conexe |
| [CL-C05](#cl-c05) | Distanța de transport fixă | C (cantități) | Norme de deviz și legi conexe |
| [CL-C06](#cl-c06) | Formularele C6–C9 cerute, dar nefurnizate (sau F3 fără coloanele de resurse) | C (cantități) | Norme de deviz și legi conexe |
| [CL-C07](#cl-c07) | Cantități și consumuri (pentru oferta proprie) | C (cantități) | Gaze naturale |
| [CL-C08](#cl-c08) | Prețuri unitare unice pe resursă / formulare F3 față de devize | C (cantități) | Apă-canal și teme transversale |
| [CL-D01](#cl-d01) | Lipsesc clauzele de ajustare a prețului sau formula este incompletă | D (contract/plată) | Achiziții publice și contracte tip |
| [CL-D02](#cl-d02) | Penalitățile de întârziere implicite din HG 1/2018 | D (contract/plată) | Achiziții publice și contracte tip |
| [CL-D03](#cl-d03) | Cumularea GBE cu Sumele Reținute și reținerea succesivă | D (contract/plată) | Achiziții publice și contracte tip |
| [CL-D04](#cl-d04) | Avansul | D (contract/plată) | Achiziții publice și contracte tip |
| [CL-D05](#cl-d05) | Perioada de garanție și categoria de importanță | D (contract/plată) | Achiziții publice și contracte tip |
| [CL-D06](#cl-d06) | Garanția: categorie de importanță vs. clasă de consecințe | D (contract/plată) | Norme de deviz și legi conexe |
| [CL-D07](#cl-d07) | Formula de ajustare a prețului lipsește sau folosește indici nepublicați | D (contract/plată) | Apă-canal și teme transversale |
| [CL-T01](#cl-t01) | Caietul de sarcini cere „proba de etanșeitate 24 de ore” pentru orice tronson sau branșament | — nouă: tehnic | ANRE, gaze, ISCIR, apă-canal |
| [CL-T02](#cl-t02) | Treaptă de presiune sau material incompatibil (PE 80 la presiune medie, SDR nespecificat) | — nouă: tehnic | ANRE, gaze, ISCIR, apă-canal |
| [CL-T03](#cl-t03) | Adâncime de pozare < 0,9 m sau distanțe sub Tabelul 1 fără soluție tehnică | — nouă: tehnic | ANRE, gaze, ISCIR, apă-canal |
| [CL-T04](#cl-t04) | Apă: lipsesc presiunea de încercare sau pierderea admisibilă | — nouă: tehnic | ANRE, gaze, ISCIR, apă-canal |
| [CL-T05](#cl-t05) | Canalizare: proba de etanșeitate cu aer, fără criteriu, ori CCTV neprevăzut | — nouă: tehnic | ANRE, gaze, ISCIR, apă-canal |
| [CL-T06](#cl-t06) | Procentul NDT la sudurile de oțel lipsește | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T07](#cl-t07) | „Clasa de calitate II” nu e tradusă în nivel ISO | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T08](#cl-t08) | WPQR: nivel și acceptarea celor existente | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T09](#cl-t09) | Clasa izolației și sistemul de izolare a îmbinărilor | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T10](#cl-t10) | Verificarea izolației la recepție | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T11](#cl-t11) | Tipul certificatului pentru materiale (3.1 sau 3.2) | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T12](#cl-t12) | Protecția catodică inclusă sau nu | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T13](#cl-t13) | NDT la PE | — nouă: tehnic | Sudură, NDT, izolație, materiale |
| [CL-T14](#cl-t14) | Probe și verificări pentru canalizare | — nouă: tehnic | Apă-canal și teme transversale |
| [CL-P01](#cl-p01) | Răspunsul AC a întârziat | A/E | Achiziții publice și contracte tip |
| [CL-P02](#cl-p02) | Factori de evaluare neclari | A/E | Gaze naturale |
| [CL-P03](#cl-p03) | Factori sociali sau ecologici „locali” | A/E | Gaze naturale |
| [CL-P04](#cl-p04) | Concesiunea distribuției | A/E | Gaze naturale |
| [CL-P05](#cl-p05) | Răspunsuri evazive ale AC | A/E | Gaze naturale |
| [CL-P06](#cl-p06) | Răspunsul AC la o clarificare anterioară e evaziv | A/E | Apă-canal și teme transversale |

## A. Ambiguități, contradicții, acte abrogate în documentație

### CL-A01
**Utilități subterane, amplasament, autorizații**

*Șablon:* „Vă rugăm să ne transmiteți planurile de situație cu utilitățile existente, avizele de amplasament obținute, autorizația de construire (sau termenul estimat de emitere) și termenul de predare a amplasamentului. Vă rugăm să precizați și modul de tratare a utilităților neidentificate, în raport cu subclauza 21.1 din condițiile generale.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-A02
**Documentația citează Ordinul ANRE 132/2021 sau cere „autorizație ANRE EDSB conform Ordin 132/2021”**

> Având în vedere abrogarea Ordinului ANRE nr. 132/2021 prin Ordinul ANRE nr. 17/2026 (MO 444/26.05.2026), vă rugăm să confirmați că cerința de calificare [cap. X] se consideră îndeplinită prin prezentarea autorizației ANRE tip [EDSB] valabile și vizate, emisă în baza oricăruia dintre cele două regulamente, conform art. 39 din Ordinul 17/2026.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-A03
**Ediții de standarde depășite în CS**

- *Situația:* SR EN 1555:2021, SR EN ISO 17635:2017, SR EN 12954:2002, SR EN 13067:2013, SR EN ISO 15589-1:2017.
- *Șablon:* „Documentația face referire la [standard:ediție veche], înlocuit de [standard:ediție nouă]. Vă rugăm să confirmați că se acceptă produse/proceduri conforme cu ediția în vigoare la data depunerii ofertei.”

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-A04
**Referință la acte abrogate**

> „Documentația face trimitere la [Ordinul 863/2008 / Legea 50/1991 / Legea 10/1995, art. …], abrogate. Vă rugăm să precizați dacă trimiterea se înțelege la HG 907/2016, respectiv la Legea 169/2026 [art. corespondent], și dacă regimul aplicabil contractului este cel în vigoare la data inițierii procedurii.”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-A05
**Branșamente: AC sau acord al administratorului drumului**

> „Pentru branșamentele aferente [nr.] consumatori existenți, vă rugăm să confirmați actul de autorizare necesar și cine îl obține și suportă taxele (beneficiar / operator de distribuție / executant).”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-A06
**Drept de uz și acorduri ale proprietarilor (Legea 123/2012 art. 109–113)**

> „Pe traseele din proprietăți private, convențiile-cadru și eventualele despăgubiri prevăzute la art. 113 din Legea 123/2012 sunt în sarcina beneficiarului/operatorului de distribuție? Dacă sunt în sarcina executantului, vă rugăm să indicați capitolul din F1/F3 în care se cuprind.”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-A07
**Contradicții între fișa de date, caietul de sarcini și contract**

- Situație: ex. asistența tehnică inclusă într-un document și exclusă în altul (BO2023_665).
   - Întrebare: „Fișa de date, la [secțiunea], prevede [X], iar caietul de sarcini, la [pag./cap.], și modelul de contract, la [art.], prevăd [Y]. Vă rugăm să precizați care prevedere prevalează și să publicați documentația corectată.”
   - Temei: Legea 98/2016 art. 154 alin. (1), art. 160.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-A08
**Documente din PT cerute în oferta de P+E**

- Situație: se cer liste de cantități, extrase de resurse, planșe de organizare sau starea utilajelor la depunere.
   - Întrebare: „Întrucât proiectul tehnic face obiectul contractului (HG 907/2016 art. 12 și anexa 10), vă rugăm să confirmați că listele de cantități, extrasele de resurse și planșa de organizare de șantier vor fi elaborate de ofertantul câștigător, iar în ofertă este suficientă descrierea metodologiei.”
   - Practică CNSC: BO2024_3657.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-A09
**Gantt / termen de execuție neclar**

(termen de execuție față de termen de proiectare, perioade de îngheț).
   *Șablon:* „Vă rugăm să precizați dacă termenul de execuție de [N] luni include perioada de [proiectare/obținere avize/sezon rece] și ce nivel de detaliere se solicită pentru graficul Gantt (activități principale/secundare, resurse umane și utilaje).”
   *CNSC:* 1964/C1/2022.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

## B. Cerințe de calificare și participare (ES, ANRE, personal, garanție participare, terți)

### CL-B01
**Experiența similară este formulată restrictiv (identic, „finalizat”, „semnat în ultimii 5 ani” sau plafon peste valoarea estimată)**

*Situație:* Fișa de date cere „un contract de [execuție rețea distribuție gaze PE] finalizat în ultimii 5 ani, în valoare de minimum [X] lei”.
*Șablon:* „Vă rugăm să confirmați că, pentru îndeplinirea cerinței privind experiența similară, vor fi acceptate și lucrări similare sau superioare din punctul de vedere al complexității (de exemplu [rețele de distribuție/transport gaze din oțel sau PE, branșamente, rețele de apă-canal sub presiune]). Vă rugăm să confirmați și că se acceptă partea de lucrări executată și recepționată în ultimii 5 ani dintr-un contract început anterior sau aflat în derulare, dovedită prin procese-verbale de recepție pe obiecte sau parțiale, conform art. 5, art. 11 alin. (1)–(3) și art. 13 alin. (3) din Instrucțiunea ANAP nr. 2/2017. Totodată, vă rugăm să precizați dacă plafonul de [X] lei poate fi atins cumulat prin mai multe contracte și cursul valutar folosit pentru contractele în altă monedă (art. 4 și art. 6 din aceeași instrucțiune).”
*Temei:* L98 art. 172 alin. (5), art. 179 lit. a); Instrucțiunea ANAP 2/2017 art. 3 alin. (3), art. 5, art. 11, art. 13, art. 14.

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-B02
**Experiența obținută ca subcontractant sau în asociere**

*Șablon:* „Vă rugăm să confirmați că experiența similară dobândită de ofertant în calitate de subcontractant este acceptată pentru valoarea lucrărilor executate efectiv, confirmată de antreprenorul general și de beneficiarul final (art. 14 alin. (3) lit. b) din Instrucțiunea ANAP nr. 2/2017). Vă rugăm să precizați și documentele acceptate în acest scop.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-B03
**Cifra de afaceri disproporționată sau pe o perioadă mai mare de 3 ani**

*Șablon:* „Vă rugăm să ne precizați justificarea nivelului minim al cifrei de afaceri de [X] lei, care reprezintă de [N] ori valoarea estimată, raportat la art. 175 și art. 177 alin. (1) din Legea 98/2016. Vă rugăm să analizați reducerea lui și să confirmați că perioada de referință este de cel mult ultimii 3 ani.”
*Temei:* L98 art. 175, 177; avizele ANAP din documentul din 2023 (cazul cifrei de afaceri de 2× valoarea estimată).

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-B04
**Garanția de participare: valoare, valabilitate, formă**

*Șablon:* „Vă rugăm să precizați valoarea garanției de participare în lei (nu ca procent) și să confirmați că perioada ei de valabilitate este corelată cu perioada de valabilitate a ofertei, de [N] luni. Vă rugăm să confirmați că se acceptă orice formă prevăzută la art. 154 alin. (4) din Legea 98/2016, inclusiv polițele de asigurare de garanții și scrisorile emise de IFN (valoarea estimată fiind de cel mult 40.000.000 lei), și că instrumentul se transmite doar în SEAP, fără original, conform art. 36 alin. (4)–(5) din HG 395/2016.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-B05
**Autorizări ANRE sau alte autorizări pentru asociați, subcontractanți și terți**

*Șablon:* „Vă rugăm să confirmați că cerința privind autorizarea [ANRE tip EDIB/EDSB/…] se consideră îndeplinită dacă membrul asocierii sau subcontractantul care execută partea de lucrări pentru care este necesară autorizarea deține autorizația respectivă.”
*Temei:* L98 art. 173; formularea recomandată de ANAP în avizele ex-ante.

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-B06
**Cerința „instalator autorizat ANRE gradul … / IGIB …” (terminologie veche) pentru personalul cheie**

> Vă rugăm să precizați echivalența cerinței „[text din fișa de date]” cu tipurile de autorizare din Regulamentul aprobat prin Ordinul ANRE nr. 65/2023, modificat prin Ordinul ANRE nr. 85/2024 (EGD / EGIU / EGT). Confirmați că un instalator autorizat tip [EGD] îndeplinește cerința pentru lucrări la SD de presiune [medie/redusă]?

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-B07
**Asociere sau subcontractare: liderul nu are autorizație ANRE ori partea de gaze se subcontractează**

> În contextul art. 34 din Regulamentul aprobat prin Ordinul ANRE nr. 17/2026, vă rugăm să confirmați că cerința privind autorizația ANRE tip [EDSB] poate fi îndeplinită de [asociatul/subcontractantul] care execută efectiv lucrările de gaze, cu respectarea obligației de coordonare printr-un instalator autorizat angajat al antreprenorului general.

Practică CNSC: de verificat în tema „cnsc” (autorizare ANRE prin terț sau subcontractant).

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-B08
**Se cere licență ANRSC pentru un contract de execuție**

> Vă rugăm să clarificați temeiul cerinței privind licența ANRSC, având în vedere că, potrivit Legii nr. 241/2006 și Legii nr. 51/2006, licența se acordă operatorilor care furnizează sau prestează serviciul public de alimentare cu apă și canalizare, iar obiectul prezentului contract este execuția de lucrări. Solicităm eliminarea cerinței sau confirmarea că nu este cerință de calificare.

Temei: Legea 98/2016, art. 172 (proporționalitate). Practica CNSC trebuie confirmată în tema „cnsc”.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-B09
**Sudori: autorizații ISCIR expirate sau ale altui angajator**

Nu e o clarificare către autoritatea contractantă, ci o verificare internă. PT CR 9-2025 (art. 49 și 67) prevede valabilitate de 2 ani și numai la angajator.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-B10
**Cerințe de calificare a sudorilor neclare sau duble**

- *Situația:* CS cere „sudori certificați EN ISO 9606-1 / EN 13067” sau „autorizați ISCIR”.
- *Șablon:* „Vă rugăm să precizați dacă pentru personalul de sudură se acceptă autorizațiile ISCIR emise conform PT CR 9-2025 (respectiv PT CR 9-2013, valabile până la expirare conform art. 63) ca dovadă a calificării, fără prezentarea suplimentară a certificatelor [EN ISO 9606-1 / EN 13067] emise de un organism terț.”
- *Temei:* NTPEE art. 236 alin. (1), art. 239 alin. (5); PT CR 9-2025 art. 49, 53, 63; Legea 98/2016 art. 155 (cerințe proporționale).

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-B11
**Certificare ISO 3834-2 sau coordonator IWE ca cerință de calificare**

- *Șablon:* „Având în vedere că NTPEE nu impune certificarea conform SR EN ISO 3834, vă rugăm să precizați dacă se acceptă demonstrarea cerințelor de calitate la sudare prin [ISO 9001 + WPQR aprobate ISCIR + RTS atestat ISCIR] sau certificare conform SR EN ISO 3834-3:2021.”
- *Temei:* Legea 98/2016 art. 172-174 (capacitate tehnică), principiul proporționalității.

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-B12
**Coordonatorul SSM (HG 300/2006)**

> „Coordonatorul în materie de securitate și sănătate pentru faza de execuție va fi asigurat de beneficiar, conform HG 300/2006? Dacă este în sarcina executantului, în ce articol din F3 sau OS se cuprinde costul?”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-B13
**ISO 9001/14001/45001**

> „Pentru cerința privind [ISO 45001], vă rugăm să precizați temeiul legal, având în vedere că art. 200–201 din Legea 98/2016 se referă la standardele de asigurare a calității și de management de mediu, și să confirmați că se acceptă certificate echivalente emise de organisme acreditate în state membre EA.”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-B14
**RTE pentru gaze**

> „Cerința de RTE «pentru lucrări de gaze» se consideră îndeplinită de un RTE autorizat ISC în domeniul [x], împreună cu personalul autorizat ANRE (art. 121 din Legea 123/2012)?”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-B15
**ES formulată doar pe „rețele de distribuție gaze”**

- Situație: fișa cere strict distribuție, ca în BO2023_1378 sau BO2023_1489.
   - Întrebare: „Vă rugăm să confirmați că, în conformitate cu art. 5 alin. (1) din Instrucțiunea ANAP nr. 2/2017, sunt acceptate ca experiență similară și lucrările de natură și complexitate similară sau superioară din infrastructura de gaze naturale (conducte de transport, racorduri de înaltă presiune, stații de reglare-măsurare, branșamente și extinderi realizate pentru operatori de distribuție), precum și lucrările la rețele de fluide sub presiune.”
   - Temei: Legea 98/2016 art. 178; HG 395/2016 art. 31; Legea 123/2012 art. 100.
   - Practică CNSC: BO2023_1378, D3952, BO2023_2717, BO2023_1489.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-B16
**Documentele de dovedire a ES**

- Situație: fișa cere „lucrări duse la bun sfârșit” fără o listă închisă de documente.
   - Întrebare: „Vă rugăm să precizați dacă lista documentelor justificative pentru experiența similară este exemplificativă și dacă se acceptă: [PV de recepție la terminarea lucrărilor pe obiect / PV de recepție parțială / documente constatatoare / recomandări ale beneficiarului / certificări de bună execuție]. Pentru lucrările executate ca subcontractant, vă rugăm să confirmați că se acceptă documentele beneficiarului final, coroborate cu contractul de subantrepriză, care individualizează valoarea executată de noi.”
   - Practică CNSC: BO2026_182, D3952.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-B17
**Autorizarea ANRE (cerință lipsă sau ambiguă)**

- Situație: obiectul include proiectarea/execuția rețelei, dar fișa nu cere autorizație ANRE, sau o cere ambiguu.
   - Întrebare: „Având în vedere art. 7 alin. (1) din Normele tehnice aprobate prin Ordinul ANRE nr. 89/2018 și Regulamentul aprobat prin Ordinul ANRE nr. [132/2021 sau actul în vigoare], vă rugăm să precizați: (a) ce tipuri de autorizații ANRE [PDSB/PDIB/EDSB/EDIB/PGD] trebuie deținute de operatorul economic care execută lucrările de gaze; (b) dacă cerința se aplică fiecărui asociat, terțului susținător tehnic și subcontractanților care execută părți din rețea; (c) în ce etapă se prezintă documentele (DUAE/la solicitare, doar pentru ofertantul de pe locul I).”
   - Practică CNSC: BO2022_1615, BO2022_2403, BO2024_3288, BO2024_2636.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-B18
**Intervenții pe rețele de gaze în contracte de drumuri sau apă**

- Situație: caietul prevede relocări/protejări de conducte, ridicarea la cotă a răsuflătorilor sau cutiilor.
   - Întrebare: „Pentru categoriile de lucrări [nr./denumire din lista de cantități] care presupun intervenții asupra sistemului de distribuție gaze naturale, vă rugăm să confirmați dacă executantul acestora trebuie să dețină autorizație ANRE [EDIB/EDSB] și dacă acesta trebuie nominalizat ca subcontractant în ofertă.”
   - Practică CNSC: BO2023_657.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-B19
**Cerințe de nișă nejustificate**

- Situație: ANIF, atestate de alt tip, experiența managerului „exclusiv în gaze”, utilaje specifice.
   - Întrebare: „Vă rugăm să indicați justificarea din strategia de contractare pentru cerința [X] și categoria de lucrări din proiect care o impune. În lipsa unei necesități concrete, vă solicităm eliminarea ei, conform art. 172 alin. (3) și (5) din Legea 98/2016.”
   - Practică CNSC: BO2026_1237.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-B20
**DA cere experiență similară „identică” sau combinată în același contract (apă + canal + stație de epurare)**

*Șablon:* „Vă rugăm să confirmați că, pentru cerința privind experiența similară de la pct. [X] din Fișa de date, sunt acceptate și contracte separate de execuție a rețelelor de [alimentare cu apă/canalizare/rețele de distribuție], cumulat, în valoare totală de minimum [suma] lei fără TVA, având în vedere principiul proporționalității (art. 2 alin. (2) Legea 98/2016).”
   *Temei:* art. 2 și art. 179 L98/2016; HG 395/2016 (criterii proporționale). *CNSC:* 2669/C1/2024 (admisă), 2119/2023.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

### CL-B21
**Garanția de participare: condiții privind emitentul sau forma**

*Șablon:* „Vă rugăm să confirmați că garanția de participare poate fi constituită prin instrument de garantare emis de o societate de asigurări autorizată ASF (poliță), conform art. 36 HG 395/2016, și că valabilitatea minimă cerută este de [N] zile de la data-limită de depunere a ofertelor.”
   *CNSC:* 1317/2021, 99/2021.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

### CL-B22
**Activități care cer autorizări speciale**

(topografie OCPI, aviz GA, ANRE, RTE pe domenii).
   *Șablon:* „Vă rugăm să precizați dacă la depunerea ofertei se solicită dovada autorizării pentru [activitate], sau dacă aceasta va fi verificată la începerea execuției.”
   *CNSC:* 1746/2022, 1706/C7/2024, 159/2021.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

### CL-B23
**Personal cheie**

(formă CV, aceiași experți pe mai multe loturi).
   *Șablon:* „Vă rugăm să confirmați dacă același expert poate fi propus pentru loturile [1] și [2] și ce documente justificative ale experienței specifice sunt solicitate la depunere (recomandări, PV recepție).”
   *CNSC:* 2119/2023, 1699/C5/2024.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

## C. Cantități, F3, deviz, consumuri, prețuri

### CL-C01
**Valoarea estimată, raportată la pragul de 80%**

*Șablon:* „Vă rugăm să publicați valoarea estimată pe fiecare lot/obiect, fără TVA, inclusiv eventualele opțiuni și cheltuieli diverse și neprevăzute, pentru ca ofertanții să poată aprecia aplicarea art. 136 alin. (4) din HG 395/2016.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-C02
**Formulare de prețuri excesiv de detaliate sau limitarea cheltuielilor indirecte și a profitului**

*Șablon:* „Vă rugăm să confirmați că plafonul de [x]% pentru cheltuielile indirecte/profit/organizarea de șantier nu este o condiție de conformitate a ofertei. ANAP a semnalat astfel de limitări ca abateri în activitatea de control ex-ante.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-C03
**CND sau buletine de laborator neprevăzute în deviz**

> Vă rugăm să confirmați dacă examinarea nedistructivă a sudurilor OL (obligatorie conform art. 238 alin. 4–5 NTPEE) și buletinul de verificare a protecției anticorozive (art. 286 lit. e) se cuprind în [articolul de deviz X] sau trebuie ofertate separat; precizați procentul de suduri examinate prevăzut de proiect.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-C04
**Rețete sau consumuri impuse**

Situația: AC răspunde „se ofertează strict articolele și rețetele proiectantului”.
   > „Vă rugăm să confirmați dacă ofertanții pot utiliza, pentru articolele din Formularul F3 aferent [obiect/categorie], consumuri proprii de resurse (manoperă, utilaj, transport) corespunzătoare tehnologiei proprii, cu respectarea integrală a cantităților, a cerințelor calitative din caietul de sarcini și a cantității de materiale din proiect, în conformitate cu pct. 1.4 și 3.3.1.4 din Ghidul P91/1-02 aprobat prin Ordinul MLPTL nr. 1568/2002.”
   Temei: P91/1-02 și art. 2 alin. (2) din L98. Practică: CNSC BO2018_6476 (procedură anulată).

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-C05
**Distanța de transport fixă**

> „Distanța de transport de [x] km prevăzută la articolele [coduri] este obligatorie sau orientativă? Ofertanții pot utiliza distanțele reale față de propriii furnizori, justificate în analizele de preț?”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-C06
**Formularele C6–C9 cerute, dar nefurnizate (sau F3 fără coloanele de resurse)**

> „Fișa de date solicită formularele C6–C9. Vă rugăm să le publicați în format editabil sau să confirmați că se acceptă extrasele de resurse generate de programul de deviz al ofertantului, cu conținutul cerut (resursă, UM, cantitate, preț unitar, valoare).”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-C07
**Cantități și consumuri (pentru oferta proprie)**

- Situație: neconcordanțe între F3, listele de cantități și planșe.
    - Întrebare: „La poziția [cod articol] din lista de cantități [nr.] figurează [cantitate], iar din planșa [nr.] rezultă [cantitate]. Vă rugăm să precizați cantitatea care trebuie ofertată.” Acest lucru se face înainte de depunere, pentru că după depunere cantitățile nu se mai pot modifica.
    - Practică CNSC: BO2026_3104, BO2021_1060.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-C08
**Prețuri unitare unice pe resursă / formulare F3 față de devize**

*Șablon:* „Vă rugăm să confirmați dacă pentru aceeași resursă (material/manoperă/utilaj) prețul unitar trebuie să fie identic în toate devizele pe obiect și dacă este permisă diferențierea transportului pe obiecte.”
   *CNSC:* 1923/C9/2022.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

## D. Contract, plăți, garanții, ajustare preț (HG 1/2018)

### CL-D01
**Lipsesc clauzele de ajustare a prețului sau formula este incompletă**

*Șablon:* „Având în vedere că durata de execuție este de [N] luni (peste 6 luni), vă rugăm să ne indicați clauza de ajustare a prețului aplicabilă, obligatorie potrivit art. 222^2 alin. (9) din Legea 98/2016: formula, indicii, sursa lor (de exemplu INS — indicele costului în construcții, tabelul [x]), ponderile, coeficientul «av» și data de referință. Vă rugăm să clarificați și relația cu subclauza 48.2 din Anexa 1 la HG 1/2018 (prețuri ferme pentru durate de cel mult 365 de zile).”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-D02
**Penalitățile de întârziere implicite din HG 1/2018**

*Șablon:* „Vă rugăm să precizați în Acordul Contractual valoarea penalităților de întârziere pe zi (ca procent din prețul contractului sau din valoarea lucrărilor rămase de executat), întrucât, în lipsa unei mențiuni, subclauza 36.4 conduce la o valoare zilnică egală cu Prețul Contractului împărțit la Durata de Execuție, plafonată la 15%.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-D03
**Cumularea GBE cu Sumele Reținute și reținerea succesivă**

*Șablon:* „Vă rugăm să clarificați dacă se aplică atât Garanția de Bună Execuție de [10]%, cât și Sumele Reținute de 5% prevăzute la subclauza 47.2, dacă GBE se poate constitui prin rețineri succesive (subclauza 15.1 lit. b)) și ce procent din GBE se restituie la Recepția la Terminare (subclauza 15.6 lit. a)).”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-D04
**Avansul**

*Șablon:* „Vă rugăm să precizați dacă se acordă avans, valoarea și numărul tranșelor, precum și varianta de justificare aplicabilă: subclauza 46.6 (deducere integrală) sau 46.7 (deducere de 25% din fiecare certificat).”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-D05
**Perioada de garanție și categoria de importanță**

*Șablon:* „Vă rugăm să precizați categoria de importanță a lucrării și perioada de garanție solicitată (subclauza 61.6), precum și dacă perioada de garanție este factor de evaluare.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-D06
**Garanția: categorie de importanță vs. clasă de consecințe**

> „Vă rugăm să precizați clasa de consecințe (CC1–CC4) a lucrării, în sensul Legii 169/2026, în vederea stabilirii perioadei minime legale de garanție la care se raportează factorul de evaluare [x].”

<sub>Sursa: cercetarea „Norme de deviz și legi conexe”.</sub>

### CL-D07
**Formula de ajustare a prețului lipsește sau folosește indici nepublicați**

*Șablon:* „Vă rugăm să precizați dacă prețul contractului se ajustează, formula aplicabilă conform art. 164 HG 395/2016, indicii INS utilizați (cod/denumire), luna de referință și periodicitatea ajustării. Menționăm că indicele [ICCplr] nu mai este publicat de INS din martie 2022.”
   *CNSC:* 406/2023.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

## T. Specificații tehnice: sudură, NDT, izolație, probe, materiale

### CL-T01
**Caietul de sarcini cere „proba de etanșeitate 24 de ore” pentru orice tronson sau branșament**

> Vă rugăm să confirmați dacă durata probei de etanșeitate pentru [tronsonul/branșamentele] din [CS cap. X] se stabilește conform art. 273 alin. (2) și Tabelului 8^1 din NTPEE (Ordin ANRE 89/2018, modificat prin Ordin ANRE 2/2023), adică în funcție de volumul tronsonului, sau dacă autoritatea contractantă solicită expres o durată de 24 h pentru toate tronsoanele. În al doilea caz, vă rugăm să precizați dacă acest timp suplimentar este inclus în graficul de execuție de [N] zile.

Temei: NTPEE art. 272 lit. b), art. 273, modificate prin Ordinul 2/2023.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-T02
**Treaptă de presiune sau material incompatibil (PE 80 la presiune medie, SDR nespecificat)**

> Vă rugăm să clarificați materialul conductei din [planșa/lista de cantități poz. X]: NTPEE art. 20 alin. (2) admite PE 80 numai până la 4 bar, iar rețeaua este proiectată la [presiune medie, 6 bar]. Confirmați utilizarea PE 100 [SDR 11/17]?

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-T03
**Adâncime de pozare < 0,9 m sau distanțe sub Tabelul 1 fără soluție tehnică**

> În [planșa X], conducta este pozată la [0,6 m] / la [0,4 m] de [clădire/canalizare]. Vă rugăm să precizați dacă există acordul OSD și măsurile de protecție suplimentare (art. 75 alin. 4 NTPEE), respectiv evaluarea de risc (art. 35^1), și dacă tubul de protecție și răsuflătorile (art. 35) sunt incluse în listele de cantități.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-T04
**Apă: lipsesc presiunea de încercare sau pierderea admisibilă**

> Conform NP 133-2022 vol. I [7.3.6 alin. (2) / cap. 9 alin. (13) lit. b)], presiunea de încercare și pierderea de presiune admisibilă se indică prin proiect. Vă rugăm să comunicați valorile pentru tronsoanele [X] și să precizați dacă proiectul este elaborat în baza NP 133-2013 sau NP 133-2022.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-T05
**Canalizare: proba de etanșeitate cu aer, fără criteriu, ori CCTV neprevăzut**

> NP 133-2022 vol. II, 3.6.1 alin. (9)–(11), prevede inspecția CCTV pentru toate tronsoanele și proba de etanșeitate cu apă (1–5 m col. H2O, 30 min, scădere ≤ 10 cm). Vă rugăm să precizați metoda de probă cerută, volumul admisibil de apă adăugată și articolul de deviz pentru inspecția CCTV.

<sub>Sursa: cercetarea „ANRE, gaze, ISCIR, apă-canal”.</sub>

### CL-T06
**Procentul NDT la sudurile de oțel lipsește**

- *Situația:* CS spune „suduri controlate nedistructiv conform normativelor”.
- *Șablon:* „Stimate domnule/doamnă, în legătură cu [denumire procedură, nr. anunț], vă rugăm să precizați extinderea controlului nedistructiv pentru sudurile cap la cap din oțel, altele decât sudurile de poziție, pentru care art. 238 alin. (5) din NTPEE (Ord. ANRE 89/2018) prevede control 100%. Precizați și metoda (RT film / RT digital / UT), astfel încât toate ofertele să fie fundamentate pe aceeași cantitate. Mulțumim.”
- *Temei:* NTPEE art. 238 alin. (4)-(5); Legea 98/2016 art. 160-161 (clarificări privind documentația).
- *Practică CNSC:* nu am căutat-o (alt subiect; vezi temele CNSC).

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T07
**„Clasa de calitate II” nu e tradusă în nivel ISO**

- *Șablon:* „Vă rugăm să confirmați nivelul de calitate conform SR EN ISO 5817:2023 (B / C / D) care corespunde clasei de calitate II prevăzute la art. 238 alin. (1) din NTPEE, precum și nivelurile de acceptare RT/UT aplicabile conform SR EN ISO 17635:2025.”
- *Temei:* NTPEE art. 238; SR EN ISO 5817:2023; SR EN ISO 17635:2025.

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T08
**WPQR: nivel și acceptarea celor existente**

- *Șablon:* „Vă rugăm să precizați dacă WPQR-urile trebuie să fie calificate la nivelul 1 sau 2 conform SR EN ISO 15614-1:2017+A1:2019 și dacă se acceptă WPQR-urile existente aprobate de ISCIR care acoperă materialul [L245/L290] și domeniul de grosimi [x–y mm].”

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T09
**Clasa izolației și sistemul de izolare a îmbinărilor**

- *Situația:* proiect cu terminologie veche („izolație foarte întărită”, STAS) sau fără clasa 3LPE.
- *Șablon:* „Vă rugăm să precizați clasa izolației de fabrică conform SR EN ISO 21809-1:2019 (ex. B2/B3) și tipul și clasa sistemului de izolare a îmbinărilor (bandă / manșon termocontractabil, clasa conform SR EN 12068:2002 sau EN ISO 21809-3). Precizați și dacă la pregătirea suprafeței pe șantier se cere sablare Sa 2½ sau se acceptă curățare mecanică St 3 conform fișei producătorului.”
- *Temei:* NTPEE art. 258-262; SR EN ISO 8501-1.

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T10
**Verificarea izolației la recepție**

- *Șablon:* „Vă rugăm să precizați metoda de verificare a calității izolației după umplerea șanțului (art. 254 lit. c NTPEE): măsurarea rezistenței de izolație / DCVG / PCM. Precizați lungimea tronsoanelor, criteriul de acceptare și dacă buletinul laboratorului autorizat este suficient.”

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T11
**Tipul certificatului pentru materiale (3.1 sau 3.2)**

- *Șablon:* „Vă rugăm să precizați tipul documentului de inspecție solicitat conform SR EN 10204:2005 pentru [țeavă oțel / izolație / fitinguri / robinete]. Dacă se solicită certificat 3.2, vă rugăm să indicați cine desemnează reprezentantul autorizat al cumpărătorului și cine suportă costul inspecției.”

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T12
**Protecția catodică inclusă sau nu**

- *Șablon:* „Vă rugăm să precizați dacă obiectul contractului include realizarea protecției catodice (stație, anozi, prize) sau doar posturile de măsurare și piesele electroizolante prevăzute la art. 263 NTPEE. Dacă o include, precizați standardul de proiectare/recepție (SR EN 12954 / EN ISO 15589-1:2026) și măsurătorile cerute la recepție.”

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T13
**NDT la PE**

- *Șablon:* „Vă rugăm să precizați dacă pentru îmbinările PE se solicită, pe lângă examinarea vizuală, alte încercări (ex. tracțiune/îndoire pe epruvete prelevate din îmbinări de probă conform SR EN 12814). Dacă da, precizați frecvența, conform art. 245 NTPEE.”

<sub>Sursa: cercetarea „Sudură, NDT, izolație, materiale”.</sub>

### CL-T14
**Probe și verificări pentru canalizare**

(CCTV, etanșeitate, compactare).
   *Șablon:* „Vă rugăm să precizați dacă inspecția CCTV și probele de etanșeitate (NP 133 / SR EN 1610) se cuprind în prețul ofertat și în ce articol din listele de cantități trebuie cuprinse.”
   *CNSC:* 2344/2025.

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

## P. Evaluare, procedură, răspunsurile AC

### CL-P01
**Răspunsul AC a întârziat**

*Șablon:* „Întrucât răspunsurile la solicitările de clarificare transmise în termen au fost publicate la [data], cu mai puțin de [10/6] zile înainte de termenul de depunere (art. 161 din Legea 98/2016), vă rugăm să analizați prelungirea termenului de depunere a ofertelor.”

<sub>Sursa: cercetarea „Achiziții publice și contracte tip”.</sub>

### CL-P02
**Factori de evaluare neclari**

- Situație: noțiuni nedefinite („tronson”, „adecvat”, „detaliat”) sau referiri la PT, care nu există la P+E.
   - Întrebare: „Pentru factorul de evaluare [denumire], vă rugăm să definiți noțiunea de [tronson/unitate de alocare] și să indicați documentul publicat în SEAP din care rezultă [tronsoanele/lungimile]. La un contract de proiectare și execuție, vă rugăm să precizați la ce document se raportează ofertanții, în lipsa proiectului tehnic.”
   - Temei: Legea 98/2016 art. 154, art. 187, art. 189; CJUE C-42/13.
   - Practică CNSC: BO2025_1837.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-P03
**Factori sociali sau ecologici „locali”**

- Situație: se punctează angajații din comună, vehiculele electrice, training-ul SSM.
   - Întrebare: „Vă rugăm să precizați ce avantaj concret și verificabil obține autoritatea contractantă prin factorul [denumire], în legătură cu obiectul contractului (art. 187 alin. (4) din Legea 98/2016), și cum va fi verificat (art. 189 alin. (2)). Considerăm că acesta favorizează operatorii locali și vă solicităm eliminarea sau reformularea lui.”
   - Practică CNSC: BO2024_3657.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-P04
**Concesiunea distribuției**

- Situație: localitatea are un concesionar.
    - Întrebare: „Vă rugăm să precizați dacă pentru [localitate] există un contract de concesiune a serviciului de distribuție gaze naturale, cine este operatorul și dacă investiția care face obiectul procedurii este cuprinsă în obligațiile de investiții ale concesionarului. Vă rugăm să comunicați și cine va prelua rețeaua în exploatare.”
    - Practică CNSC: BO2026_2669.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-P05
**Răspunsuri evazive ale AC**

- Situație: AC răspunde generic („DA respectă legea”).
    - Acțiune: se reiterează întrebarea, cu trimitere la art. 160 din Legea 98/2016 și la BO2024_2938. Dacă AC refuză și a doua oară, se contestă DA în termen.

<sub>Sursa: cercetarea „Gaze naturale”.</sub>

### CL-P06
**Răspunsul AC la o clarificare anterioară e evaziv**

*Șablon:* „Revenim la întrebarea nr. [X], la care răspunsul publicat nu tratează aspectul [Y]. Vă rugăm să comunicați un răspuns clar și complet, conform art. 160 alin. (1) Legea 98/2016.” În paralel, termenul de contestare de 10 zile trebuie urmărit (2119/2023).

<sub>Sursa: cercetarea „Apă-canal și teme transversale”.</sub>

## Reguli interne pentru RĂSPUNSURILE noastre la clarificările comisiei

**Practica CNSC atașată temei:**

- 2863/C4/3581 din 25.09.2025 — cauțiunea are termen de decădere;
- BO2025_647 — clarificările sub 80% sunt obligatorii.

Pentru alte decizii pe aceste teme, vezi lucrarea de decizii CNSC a celorlalți agenți.

**Răspunsuri ale noastre la clarificările AC — reguli interne:**

- Răspundem la fiecare articol cerut (3130/2024, 1923/2022).
- Ancorăm răspunsul în pagina din oferta inițială (2774/2022).
- Nu schimbăm prețuri unitare peste pragul de 1% (159/2024). Nuanță BO2025_187: retransmiterea întregii propuneri financiare nu face singură oferta inacceptabilă dacă AC analizează doar elementele cerute — inacceptabilă e introducerea de modificări necerute.
- Pentru PNS: tarif orar explicit peste minim, oferte de la furnizori, utilaje proprii, transport inclus (104/2025, 448/2021).

**Completări din practica CNSC (sinteză orchestrator):**
- Termenele de răspuns la comisie: max. 15 zile lucrătoare inclusiv prelungirea (L98 art. 209 alin. (3)); documente justificative primul clasat 7+3 zile lucrătoare (art. 196 alin. (2)); garanția de participare — 3 zile (HG 395 art. 132 alin. (3)).
- Corecturi la propunerea financiară: doar erori aritmetice / abateri minore, **cumulat sub 1% din prețul total** (HG 395 art. 137; BO2024_159 — 1,14% → respinsă).
- Nu adăugăm la clarificări elemente obligatorii lipsă din propunerea tehnică (proceduri, activități Gantt) — BO2023_140, BO2022_1964.
- La PNS: justificare pe FIECARE articol cerut, cu documente (BO2024_3130, BO2022_1923); tarif orar ≥ minim construcții calculat corect (BO2020_2124).
