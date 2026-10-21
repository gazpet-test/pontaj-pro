# Testul de recepție E3 cu gestionarul (Cioc Janeta) — proiectul TEST IZOMETRIE

**Ce testăm:** Janeta introduce singură, în ERP, cele 3 documente de test (2 avize de țeavă + 1 listă de ambalare curbe), le verifică, confirmă recepția și pune PV-ul. Bucățile intră în registrul de țeavă al proiectului de test și apar în Magazie → 🧱 Țeavă proiecte.

**Doar pe proiectul de test „TEST IZOMETRIE” (cod TEST-IZO), depozitul „DM TEST IZO” (TIZ).** Documentele sunt false (furnizor „FURNIZOR TEST SRL”, țevi 999TS…, curbe 9001–9012), cu filigranul „DOCUMENT DE TEST — FĂRĂ VALOARE”. LOT 1 și LOT 2 nu se ating.

Surse (21.10.2026): documentele și cifrele din `C:\Users\Public\claude-server\pv_test\` (`README.md`, `gen/totals.json`); contractul RPC `C:\Users\Public\livrare\E3_CONTRACT_RPC.md`; migrarea `20261103b` (PR #825, `izometrie/e3` @198333bf); ecranul `src/IzoDocumenteIntrare.jsx` + `src/izoDocumenteLogica.js` (PR #826, `izometrie/e3-ui` @b33fa064). Mesajele citate mai jos sunt textele exacte din ecran și de pe server la aceste versiuni.

- **Partea 1 — pentru Janeta:** ce apeși, ce scrii, ce trebuie să vezi.
- **Partea 2 — pentru coordonator:** precondițiile, verificările SQL (doar citire) după fiecare pas, exercițiul cu greșeală, ce rămâne după test.

> **Atenție la cifrele finale (diferă de fișa de scenarii pe hârtie).** Fișa `FISA_SCENARII_TEST.pdf` (tabelul 2) a fost calculată pentru calea veche (importul din sesiune), unde lungimea rămânea cea de pe aviz. În E3, ERP-ul păstrează **lungimea măsurată** și **unghiul măsurat** (decizia Răzvan 21.10, Q-E3-5 A):
> - țeava 999TS00216 intră cu **12,19 m** (măsurat), nu 12,22 m → Țeavă 7,1 disponibil **168,95 m**, total disponibil **259,70 m** (pe aviz: 168,98 m / 259,73 m);
> - curba 9006 apare în carantină cu **30°** (măsurat), nu 45°.
>
> Numărul de bucăți nu se schimbă: **40 disponibile + 1 curbă în carantină**. Metrii „după aviz” (259,73 m) îi vezi în ecranul documentului, pe linia de totaluri. Pe hârtie (tabelul 1 din fișă) nu se schimbă nimic.

---

## Partea 1 — pentru Janeta

### 1.0 Înainte să începi

Ai nevoie de:
- cele 3 documente tipărite, cu notele tale de la recepția pe hârtie:
  - **AVIZ TEST 1** (TEST-2610221): 15 țevi de ~6 m, toate primite;
  - **AVIZ TEST 2** (TEST-2610222): rândul 7 (999TS00210) **refuzat** „fără marcaj vizibil”; rândul 11 (999TS00216) **măsurat 12,19 m** (pe aviz 12,22 m);
  - **LISTA DE AMBALARE curbe** (TRUCK TEST 1): curba **9006** are pe listă 45°, ai **măsurat 30°** → neconformă;
- fișierele PDF ale celor 3 documente (pentru „scan”), primite de la coordonator — sau scanul tău după hârtia semnată.

Pașii:
1. Intri în ERP. Apasă **Ctrl+Shift+R** o dată (ca să ai ultima versiune).
2. **Magazie** → tab-ul **🧾 Documente de intrare**.
3. Sus, în lista de proiecte, alege **„TEST-IZO · TEST IZOMETRIE”**.
4. Trebuie să vezi: textul „Niciun document de intrare pe acest proiect.” și două butoane verzi: **„+ 🧱 Aviz țeavă”** și **„+ ↪️ Listă de ambalare curbe”**.

**Oprește-te și cheamă coordonatorul** dacă vezi altceva:
- „🧾 Modulul de recepție e în pregătire.” — serverul nu e gata;
- „🔒 Niciun proiect cu registru de țeavă pe care să fii atribuit…” — nu ai atribuirea pe proiectul de test;
- „👁️ Doar citire — …” — nu ai drept de scriere (atribuirea sau nivelul Magazie).

Coordonatorul poate să-ți ceară, înainte de avizul 1, un exercițiu cu greșeală (Partea 2, §2.4). Îl faceți împreună.

**Cum scrii numerele:**
- metrii: cu virgulă sau cu punct, cum sunt pe aviz (`12,48` sau `12.48` — e același lucru);
- kilogramele: **fără virgulă și fără punct** (`1402`, `10192`). Dacă scrii `1,402` ca pe aviz, ERP-ul înțelege tot o mie patru sute doi, dar fără separator nu ai cum să greșești;
- unghiurile: număr simplu (`45`, `30`).

**Același drum la fiecare document:**
1. butonul verde „+ …” → completezi **antetul** (sus);
2. scrii **rândurile** (tabelul „Rânduri”);
3. scrii **totalurile de pe document** (cartonașele „Totaluri”);
4. **💾 Salvează draft** (salvează des, la câteva rânduri — ce nu e salvat se pierde dacă închizi pagina);
5. **📎 Scanul documentului** → **⬆️ Atașează scan** → alegi PDF-ul documentului;
6. **🔎 Verifică** → citești ce spune serverul;
7. **✅ Confirmă recepția** → citești fereastra → **OK**;
8. **← Lista** și treci la documentul următor.

PV-ul îl pui la final, pe toate trei (§1.4).

Ajutoare în ecran:
- **„+ Rând”** adaugă un rând nou și copiază de pe rândul de deasupra peretele, diametrul, specificația, standardul, dimensiunea, gradul oțelului și izolația. **Nu copiază** șarja, lotul, unghiul și pachetul — pe acestea le scrii pe fiecare rând. Nr. crt. se pune singur.
- Sub fiecare rând apar mesaje: **⛔ roșu = blocant** (nu se poate confirma), **⚠️ galben = avertisment** (se poate confirma, dar citește-l).
- Lângă butonul „✅ Confirmă recepția” scrie mereu de ce e gri, de exemplu „Confirmarea: apasă întâi „Verifică”.”

### 1.1 Documentul 1 — AVIZ TEST 1 (15 țevi ~6 m, toate primite)

**1. Deschide:** apasă **„+ 🧱 Aviz țeavă”**. Sus apare „🧱 Aviz țeavă (nou)”, starea „Draft”.

**2. Antetul** (cu * = obligatoriu):

| Câmp în ecran | Ce scrii |
|---|---|
| Furnizor * | `FURNIZOR TEST SRL` |
| CIF furnizor | `RO 00000001` |
| Nr. aviz * | `TEST-2610221` |
| Data documentului * | 22.10.2026 (din calendar) |
| Depozit * | se pune singur: „TIZ — DM TEST IZO” (dacă e gol, alege-l) |
| Cumpărător | `BENEFICIAR TEST (proiect TEST IZOMETRIE)` |
| Nr. transport | `T-TEST-01` |
| Proiect (pe aviz) | `TEST IZOMETRIE` |
| Lot | `TEST` |
| Loc livrare | `Depozit TEST` |
| Data încărcării / Data descărcării | 22.10.2026 / 22.10.2026 |
| Nr. camion | `TS-01-TST` |

Câmpul „Corectează documentul anulat (opțional)” apare doar după exercițiul cu greșeală (§2.4). Altfel nu apare, iar dacă apare îl lași pe „—”.

**3. Rândurile.** Primul rând există deja (gol). Pe **rândul 1** scrii tot ce e în tabel, plus **Perete `7,1`** și **Diam. `610`** (opțional: Specificație `Tevi sudate elicoidal 610x7,10 mm, L 360 NE, izolate`, Grad oțel `L360NE`). Apoi **„+ Rând”** pentru fiecare rând următor: peretele și diametrul se copiază singure, tu scrii doar Nr. țeavă, Șarjă, Lot, L aviz și Kg. „L măsurat” rămâne gol (nu ai măsurat diferit). Decizia rămâne **Primit**.

| Nr. | Nr. țeavă | Șarjă | Lot | L aviz (m) | Kg |
|---|---|---|---|---|---|
| 1 | 999TS00101 | TS00011 | 901 | 6,04 | 678 |
| 2 | 999TS00102 | TS00011 | 901 | 6,11 | 686 |
| 3 | 999TS00103 | TS00011 | 901 | 5,98 | 672 |
| 4 | 999TS00105 | TS00011 | 901 | 6,07 | 682 |
| 5 | 999TS00106 | TS00011 | 901 | 6,02 | 676 |
| 6 | 999TS00107 | TS00012 | 901 | 6,12 | 687 |
| 7 | 999TS00109 | TS00012 | 901 | 6,00 | 674 |
| 8 | 999TS00110 | TS00012 | 901 | 6,09 | 684 |
| 9 | 999TS00111 | TS00012 | 902 | 6,05 | 679 |
| 10 | 999TS00113 | TS00012 | 902 | 5,99 | 673 |
| 11 | 999TS00114 | TS00013 | 902 | 6,08 | 683 |
| 12 | 999TS00115 | TS00013 | 902 | 6,03 | 677 |
| 13 | 999TS00117 | TS00013 | 902 | 6,10 | 685 |
| 14 | 999TS00118 | TS00013 | 902 | 6,01 | 675 |
| 15 | 999TS00119 | TS00013 | 902 | 6,06 | 681 |

**4. Totalurile de pe document** (cartonașele „Totaluri — documentul față de rânduri”): **Total metri `90.75`**, **Total kg `10192`**.

**Ce trebuie să vezi:**
- ambele cartonașe **verzi**: „✓ rânduri: 90,75” și „✓ rânduri: 10.192”. Cât timp n-ai scris totalul, cartonașul e roșu („lipsește totalul de pe document”). Dacă rămâne roșu după ce l-ai scris, ai greșit un rând: compară rând cu rând cu avizul;
- sub cartonașe: „15 rânduri: **15 primite** · în registru, disponibil: **90,75 m** după aviz”;
- deasupra tabelului: „✓ fără blocante în ecran”.

**5.** **💾 Salvează draft** → mesaj verde „Draft salvat (versiunea …).”

**6. Scanul:** **⬆️ Atașează scan** → alegi `AVIZ_TEST_1_teava_6m.pdf` (sau scanul tău) → mesaj „Scan atașat. …”. Apare rândul scanului, cu „📄 Deschide” (verifică să fie avizul bun).

**7.** **🔎 Verifică** → mesaj verde „Verificat: fără blocante. Poți confirma recepția.” și cadrul „✓ Verificarea serverului: fără blocante”.
- Fără scan, apare „(1 avertismente)” și „⚠️ documentul nu are scan atașat (fara_scan)”. Nu e blocant, dar atașează-l.

**8.** **✅ Confirmă recepția** (acum verde). Fereastra spune:
> Confirmi recepția documentului TEST-2610221 (FURNIZOR TEST SRL)?
> Intră în registru, disponibile în depozit: 15 țevi · 90,75 m
> După confirmare documentul nu se mai poate modifica; anularea lui e doar administrativă (Răzvan).

Dacă cifrele sunt bune → **OK**.

**Ce trebuie să vezi după:** cadrul verde „✅ Recepție confirmată: **15 bucăți** în registru. Le vezi în 🧱 Țeavă proiecte.”, starea **Confirmat** și textul „✅ Recepție confirmată la … — documentul nu se mai modifică.”. Câmpurile sunt gri: nu se mai pot schimba.

**9.** **← Lista.** Spune-i coordonatorului: „Aviz 1 confirmat”. Coordonatorul face verificarea C1.

### 1.2 Documentul 2 — AVIZ TEST 2 (rândul 7 refuzat, rândul 11 măsurat)

**1.** **„+ 🧱 Aviz țeavă”**.

**2. Antetul:** ca la avizul 1, cu diferențele: Nr. aviz * **`TEST-2610222`**, Nr. transport **`T-TEST-02`**, Nr. camion **`TS-02-TST`**. Restul e la fel (furnizor, CIF, data 22.10.2026, cumpărător, proiect, lot, loc livrare, datele încărcării / descărcării).

**3. Rândurile:** rândul 1 cu Perete `7,1` și Diam. `610`, apoi „+ Rând”. Tot pe acest aviz scrii **și rândul refuzat**: el rămâne pe document, intră în total, dar nu intră în registru.

| Nr. | Nr. țeavă | Șarjă | Lot | L aviz (m) | Kg | Ce mai faci pe rând |
|---|---|---|---|---|---|---|
| 1 | 999TS00201 | TS00021 | 911 | 12,48 | 1402 | |
| 2 | 999TS00203 | TS00021 | 911 | 11,86 | 1332 | |
| 3 | 999TS00204 | TS00021 | 911 | 12,50 | 1404 | |
| 4 | 999TS00206 | TS00021 | 911 | 12,13 | 1362 | |
| 5 | 999TS00207 | TS00022 | 911 | 11,62 | 1305 | |
| 6 | 999TS00209 | TS00022 | 911 | 12,31 | 1382 | |
| 7 | 999TS00210 | TS00022 | 912 | 11,95 | 1342 | **Decizie: Refuzat** · **Motiv: `fără marcaj vizibil`** |
| 8 | 999TS00212 | TS00022 | 912 | 12,07 | 1355 | |
| 9 | 999TS00213 | TS00023 | 912 | 11,50 | 1291 | |
| 10 | 999TS00215 | TS00023 | 912 | 12,44 | 1397 | |
| 11 | 999TS00216 | TS00023 | 912 | 12,22 | 1372 | **L măsurat (m): `12,19`** · decizia rămâne **Primit** · observația o scrii **abia la controlul de după salvare** (pasul 5) |
| 12 | 999TS00218 | TS00023 | 912 | 11,78 | 1323 | |
| 13 | 999TS00219 | TS00024 | 913 | 12,36 | 1388 | |
| 14 | 999TS00221 | TS00024 | 913 | 12,02 | 1350 | |
| 15 | 999TS00222 | TS00024 | 913 | 11,69 | 1313 | |

**Ce trebuie să vezi la rândul 7:** decizia scrisă cu roșu, „Refuzat”. Dacă alegi „Refuzat” fără motiv, apare sub rând „⛔ refuzul cere motiv”.

La rândul 11, după ce scrii `12,19` la „L măsurat”, sub rând apare cu roșu „⛔ măsurat 12,19 m față de 12,22 m pe aviz (-30 mm, peste ±10 mm) — scrie observația”. E normal: îl lași așa până la controlul de la pasul 5.

**4. Totalurile de pe document:** **Total metri `180.93`**, **Total kg `20318`**.

**Ce trebuie să vezi:**
- ambele cartonașe **verzi**: „✓ rânduri: 180,93” și „✓ rânduri: 20.318”. Rândul refuzat intră în sumă: 168,98 + 11,95 = 180,93;
- sub cartonașe: „15 rânduri: **14 primite** · **1 refuzate** · în registru, disponibil: **168,98 m** după aviz (**168,95 m** cu lungimile măsurate — lungimea bucății = măsurat, altfel aviz)”;
- deasupra tabelului: „⛔ 1 blocante în ecran · ⚠️ 1 avertismente” (amândouă de la rândul 11, care încă n-are observație).

**5. 💾 Salvează draft** → „Draft salvat (versiunea …).” Draftul se salvează și cu roșu în ecran; doar confirmarea e oprită.

**Controlul de la rândul 11** (aici e controlul important), imediat după salvare:
- sub rândul 11, roșu: „⛔ măsurat 12,19 m față de 12,22 m pe aviz (-30 mm, peste ±10 mm) — scrie observația”; deasupra tabelului „⛔ 1 blocante în ecran”; butonul de confirmare e gri, cu „Confirmarea: 1 probleme blocante în ecran (roșu).”. (Înainte de salvare, lângă buton scrie „salvează draftul…” sau „ai modificări nesalvate…” — de aceea controlul se face după salvare.)
- acum scrie la rândul 11 **Observație: `măsurat la recepție 12,19 m (pe aviz 12,22 m)`**. Mesajele devin galbene:
  - „⚠️ măsurat 12,19 m față de 12,22 m pe aviz (-30 mm, peste ±10 mm)”
  - „⚠️ diferență peste toleranță: dacă bucata e neconformă, alege „Neconform → carantină””

  iar deasupra tabelului: „✓ fără blocante în ecran · ⚠️ 2 avertismente”. Țeava e bună, doar mai scurtă: **lași Primit**.
- **💾 Salvează draft** din nou.

**6.** **⬆️ Atașează scan** cu `AVIZ_TEST_2_teava_12m.pdf`.

**7.** **🔎 Verifică** → „Verificat: fără blocante (1 avertismente). Poți confirma recepția.” În cadrul serverului:
> ⚠️ rândul 11: măsurat 12190 mm față de 12220 mm pe document (peste ±10 mm) (toleranta_lungime)

E normal: serverul îți confirmă diferența pe care ai scris-o.

**8.** **✅ Confirmă recepția.** Fereastra:
> Intră în registru, disponibile în depozit: 14 țevi · 168,95 m
> Refuzate (nu intră în registru): 1

→ **OK**. **După:** „✅ Recepție confirmată: **14 bucăți** în registru. …”, cu „Avertismentele serverului (1)” și mesajul rândului 11.

**9.** **← Lista.** Spune-i coordonatorului: „Aviz 2 confirmat” (verificarea C2).

### 1.3 Documentul 3 — LISTA DE AMBALARE curbe (curba 9006 neconformă)

**1.** **„+ ↪️ Listă de ambalare curbe”**.

**2. Antetul:**

| Câmp în ecran | Ce scrii |
|---|---|
| Furnizor * | `FURNIZOR TEST CURBE` (cum scrie pe listă, la PRODUCATOR/FURNIZOR) |
| CIF furnizor | gol (nu e pe listă) |
| Nr. listă * | `TRUCK TEST 1` |
| Data documentului * | 22.10.2026 |
| Depozit * | „TIZ — DM TEST IZO” |
| Factura | `TEST-FACT-0001` |
| Importator | `BENEFICIAR TEST (proiect TEST IZOMETRIE)` |
| Destinatar | `BENEFICIAR TEST — Depozit TEST` |
| Referința clientului | `TEST-REF-0001` |
| Referința furnizorului | `TEST-REF-0002` |
| Camion / container | `TS-03-TST` |

**3. Rândurile** — o curbă pe rând, în ordinea de pe listă. Pe rândul 1 scrii și Diam. `610`, Standard `EN 14870-1`, Descriere `INDUCTION BEND`: „+ Rând” le copiază mai departe.

Atenție la două lucruri:
- **Peretele se schimbă de la o curbă la alta** (8 / 10 / 8,8), iar „+ Rând” copiază peretele de pe rândul de deasupra: **verifică peretele pe fiecare rând**.
- **Pachetul** e scris pe listă o singură dată la două curbe (celule unite), dar tu îl scrii **pe fiecare rând** (1, 1, 2, 2, …).

„Buc” rămâne 1. „Unghi măsurat” îl scrii **doar la 9006**. **Cod**-ul e opțional, dar recomandat: dacă îl scrii, ecranul îți spune când peretele, unghiul sau heat-ul nu bat cu codul (de exemplu „⚠️ codul spune perete 10 — nu bate cu rândul”).

| Nr. | Bend no. | Heat (șarjă) | Cod | Item | Perete | Unghi listă (°) | Pachet | Net kg | Brut kg |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 9001 | 9990001 | 9001-610-8-5-6100-9990001-1 | 1 | 8 | 5 | 1 | 1132 | 1152 |
| 2 | 9002 | 9990001 | 9002-610-8-12-6100-9990001-1 | 1 | 8 | 12 | 1 | 1221 | 1241 |
| 3 | 9003 | 9990002 | 9003-610-10-18-6100-9990002-2 | 2 | 10 | 18 | 2 | 1615 | 1635 |
| 4 | 9004 | 9990002 | 9004-610-10-25-6100-9990002-2 | 2 | 10 | 25 | 2 | 1725 | 1745 |
| 5 | 9005 | 9990003 | 9005-610-8,8-33-6100-9990003-3 | 3 | 8,8 | 33 | 3 | 1633 | 1653 |
| 6 | **9006** | 9990003 | 9006-610-8,8-45-6100-9990003-3 | 3 | 8,8 | 45 | 3 | 1799 | 1819 |
| 7 | 9007 | 9990001 | 9007-610-8-38-6100-9990001-1 | 1 | 8 | 38 | 4 | 1549 | 1569 |
| 8 | 9008 | 9990004 | 9008-610-8-40-6100-9990004-1 | 1 | 8 | 40 | 4 | 1575 | 1595 |
| 9 | 9009 | 9990005 | 9009-610-10-50-6100-9990005-2 | 2 | 10 | 50 | 5 | 2119 | 2139 |
| 10 | 9010 | 9990005 | 9010-610-10-55-6100-9990005-2 | 2 | 10 | 55 | 5 | 2198 | 2218 |
| 11 | 9011 | 9990003 | 9011-610-8,8-22-6100-9990003-3 | 3 | 8,8 | 22 | 6 | 1480 | 1500 |
| 12 | 9012 | 9990004 | 9012-610-8-15-6100-9990004-1 | 1 | 8 | 15 | 6 | 1259 | 1279 |

Opțional, „Dim. pachet (cm)” (390X75X135 etc.) — nu intră în nicio verificare.

**Rândul 6 (curba 9006):** **Unghi măsurat (°): `30`** · **Decizie: „Neconform → carantină”** · **Motiv: `unghi măsurat 30° față de 45° pe listă`**.

**Ce trebuie să vezi la rândul 6:**
- cu decizia „Neconform → carantină” și motivul scris: doar galben, „⚠️ măsurat 30° față de 45° pe listă (peste ±0,5°)”;
- dacă lași „Primit” și nu scrii nimic: roșu, „⛔ măsurat 30° față de 45° pe listă (peste ±0,5°) — scrie observația”. Curba nu e bună, deci alegi **Neconform**, nu doar observația;
- dacă alegi „Neconform” fără motiv: „⛔ neconformitatea cere motiv”.

**4. Totalurile de pe document:** **Total bucăți `12`**, **Total pachete `6`**, **Net kg `19305`**, **Brut kg `19545`**.

**Ce trebuie să vezi:**
- toate patru cartonașele **verzi**: 12 · 6 · 19.305 · 19.545. Dacă „Total pachete” e roșu, un număr de pachet e scris greșit sau lipsește la ambele curbe ale unui pachet; dacă „Net kg” / „Brut kg” e roșu, compară greutățile rând cu rând;
- sub cartonașe: „12 rânduri: **11 primite** · **1 neconforme → carantină**”;
- deasupra tabelului: „✓ fără blocante în ecran · ⚠️ 1 avertismente” (mai multe doar dacă un cod nu bate — atunci corectează rândul).

**5–6.** **💾 Salvează draft**, apoi **⬆️ Atașează scan** cu `LISTA_AMBALARE_TEST_curbe.pdf`.

**7.** **🔎 Verifică** → „Verificat: fără blocante (1 avertismente). …”:
> ⚠️ rândul 6: măsurat 30.0° față de 45.0° pe listă (peste ±0,5°) (toleranta_unghi)

**8.** **✅ Confirmă recepția.** Fereastra:
> Intră în registru, disponibile în depozit: 11 curbe
> În carantină (nedisponibile): 1

→ **OK**. **După:** „✅ Recepție confirmată: **12 bucăți** în registru. …”. Sunt 12, pentru că și curba din carantină intră în registru, dar ca nedisponibilă.

**9.** **← Lista.** Spune-i coordonatorului: „Lista confirmată” (verificarea C3).

### 1.4 PV-ul — pe fiecare din cele 3 documente confirmate

Pentru fiecare document din listă (AVIZ 1, AVIZ 2, LISTA):
1. apasă **„Deschide”** pe rândul documentului;
2. apasă **„📝 Pune PV”** (butonul albastru, jos);
3. în fereastră scrie **Nr. PV `PV-TEST-1`** (același număr pe toate trei, sau cel pe care ți-l dă coordonatorul). **Data PV** rămâne data de azi;
4. apasă **„Pune PV”**;
5. citești mesajul (tabelul de mai jos), apoi **← Lista** (documentul rămâne deschis după PV) și treci la documentul următor.

**Ce trebuie să vezi:**

| Document | Mesajul după „Pune PV” |
|---|---|
| AVIZ TEST 1 | „✅ PV PV-TEST-1 pus: **15 bucăți** trecute în „recepționat”.” |
| AVIZ TEST 2 | „✅ PV PV-TEST-1 pus: **14 bucăți** trecute în „recepționat”.” |
| LISTA curbe | „✅ PV PV-TEST-1 pus: **11 bucăți** trecute în „recepționat”.” (curba 9006 rămâne în carantină) |

După PV, butonul „📝 Pune PV” dispare, iar sus scrie „… PV PV-TEST-1 din <data>.”. Spune-i coordonatorului: „PV-uri puse” (verificarea C4).

### 1.5 Ce trebuie să vezi la final

**În 🧾 Documente de intrare** (lista proiectului TEST IZOMETRIE):

| Document | Rânduri | Totaluri pe document | Stare | PV |
|---|---|---|---|---|
| 🧱 TEST-2610221 | 15 · 15 | 90,75 m · 10.192 kg | Confirmat | PV-TEST-1 · <data> |
| 🧱 TEST-2610222 | 15 · 14 · 1 ref. | 180,93 m · 20.318 kg | Confirmat | PV-TEST-1 · <data> |
| ↪️ TRUCK TEST 1 | 12 · 11 · 1 carant. | 12 buc · 6 pachete · net 19.305 kg | Confirmat | PV-TEST-1 · <data> |

Dacă ați făcut exercițiul din §2.4, mai e un rând gri, „Anulat”, iar avizul 1 are dedesubt „· înlocuiește #…”.

**În Magazie → 🧱 Țeavă proiecte** (proiectul TEST IZOMETRIE; apasă 🔄 Reîncarcă):
- cartonașul **„Disponibil (în depozit)”: 40 buc · 259,70 m** (țevi + curbe; metrii sunt doar ai țevilor). „În drum spre depozit”, „Pe tronson (nemontat)”, „Montat”: **0 buc · 0,00 m**;
- tabelul pe loc × tip:

| Stare | Loc | Țeavă 7,1 | Țeavă 8,8 | Țeavă 7,1 × 6 m | Curbe |
|---|---|---|---|---|---|
| Disponibil (în depozit) | TIZ | 14 buc · 168,95 m | — | 15 buc · 90,75 m | 11 buc |
| Carantină (nedisponibil) | TIZ | — | — | — | 1 buc |

- lista, fără filtre: **„41 bucăți · 259,70 m”**;
- căutare **`00210`** (țeava refuzată), în câmpul „🔍 Serie (ultimele cifre) / șarjă”: „Nimic pentru filtrele alese.”;
- căutare **`00216`**: o țeavă, **L 12,19**, aviz intrare TEST-2610222;
- **golește căutarea** (căutarea și filtrul se adună: cu `00216` rămas în câmp, lista de carantină iese goală), apoi filtrul **„Carantină (nedisponibil)”**: 1 bucată, **9006**, tip „curbe 30°”.

PV-ul nu schimbă nimic în 🧱: „sosit” și „recepționat” intră amândouă la „Disponibil (în depozit)”. Kilogramele nu apar în 🧱 — le verifici doar pe documente și pe hârtie.

### 1.6 Ce nu faci și când te oprești

- **Nu confirma** un document cu ceva roșu în ecran sau cu cifre în fereastra de confirmare care nu bat cu hârtia. După confirmare nu se mai poate modifica: dacă ai confirmat ceva greșit, spune-i lui Răzvan (doar el poate anula un document confirmat).
- **Un mesaj roșu sus** („Salvare eșuată: …”, „Confirmare eșuată: …”): fă o poză la ecran, nu repeta de mai multe ori, cheamă coordonatorul. Ce ai scris rămâne în ecran.
- „documentul s-a schimbat între timp …” → apasă 🔄 Reîncarcă (dacă apare), apoi din nou 🔎 Verifică.
- Lucrezi **doar** pe proiectul TEST IZOMETRIE.

---

## Partea 2 — pentru coordonator

Coordonatorul = sesiunea de chat împreună cu Răzvan. Tot ce scrie în baza de date (crearea proiectului, activarea, atribuirea, orice storno) se face **doar cu „da”-ul lui Răzvan** (CLAUDE.md pct. 3; atribuirea e drept de acces, deci are nevoie de acordul lui explicit). Verificările de mai jos sunt doar citire.

### 2.1 Precondițiile — toate înainte să o chemi pe Janeta

| # | Ce | Cum verifici |
|---|---|---|
| 1 | Migrarea **20261103b LIVE** (PR #825 aplicat de chat, cu „da”). Ordinea: întâi migrarea, apoi UI-ul | P1: `rpc_e3` = 5, `bucket` = 1, `porti_lipsa` = 0 |
| 2 | **PR #826 (UI) merged** și deployat de Vercel (~3 min) | în ERP, Magazie are tab-ul „🧾 Documente de intrare”; Ctrl+Shift+R |
| 3 | **Proiectul de test creat** cu „da”-ul lui Răzvan: `scripts/izometrie/test_izo_1_creare.sql` (pe `origin/izometrie/e3`), ca postgres, sesiune directă (pooler 5432) | P1: `proiect_id` nenul; depozitul `TIZ` pe site-ul proiectului |
| 4 | **Activarea pe calea E3**: atribuirea Janetei + nivelul `stoc`, **fără import** (§2.2) | P1: `nivel` = `stoc`, `janeta_gestionar` = 1, `bucati` = 0, `bucati_vii` = 0, `documente` = 0 (varianta A din §2.2: `bucati` = 41, toate `anulata`, `bucati_vii` = 0) |
| 5 | Janeta are **Magazie la nivel editor sau admin** (verificat 21.10.2026: `editor`) | P1: `janeta_magazie` ∈ {editor, admin} |
| 6 | Materialele Janetei: cele 3 documente tipărite (A4, „dimensiune reală”; lista e pe orizontală), notele ei de recepție pe hârtie (fișa, pașii a–d), PDF-urile pentru scan (`C:\Users\Public\claude-server\pv_test\*.pdf`, ~67 KB fiecare) | — |
| 7 | Snapshot-ul „înainte” pentru celelalte proiecte | Q-ALTE (§2.3), rezultatul păstrat pentru comparația de la final |

Fără 1–5, ecranul îi arată Janetei „🧾 Modulul de recepție e în pregătire.”, „🔒 Niciun proiect …” sau „👁️ Doar citire”, iar serverul refuză scrierea.

**P1 — precondițiile (doar citire):**
```sql
SELECT
  (SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
    WHERE n.nspname = 'public' AND f.proname IN ('fn_izo_doc_salveaza', 'fn_izo_doc_verifica', 'fn_izo_doc_confirma',
                                                  'fn_izo_doc_pv', 'fn_izo_doc_anuleaza_draft'))          AS rpc_e3,          -- 5
  (SELECT count(*) FROM storage.buckets WHERE id = 'izo-documente')                                 AS bucket,          -- 1
  cardinality(public.fn_izo_porti_lipsa())                                                          AS porti_lipsa,     -- 0
  p.id                                                                                              AS proiect_id,
  public.fn_izo_nivel(p.id)                                                                         AS nivel,           -- stoc
  (SELECT count(*) FROM public.izo_atribuiri a
    WHERE a.proiect_id = p.id AND a.profile_id = '70d6bb90-d920-4768-a758-1a0df99853b2' AND a.rol = 'gestionar' AND a.activ
      AND a.depozit_id = (SELECT d.id FROM public.logistica_depozite d WHERE d.cod_3litere = 'TIZ')
      AND a.valabil_de <= current_date AND (a.valabil_pana IS NULL OR a.valabil_pana >= current_date)) AS janeta_gestionar, -- 1
  (SELECT u.access_level FROM public.user_module_access u
    WHERE u.profile_id = '70d6bb90-d920-4768-a758-1a0df99853b2' AND u.module = 'magazie')            AS janeta_magazie,  -- editor / admin
  (SELECT count(*) FROM public.magazie_bucati b WHERE b.proiect_id = p.id)                          AS bucati,          -- 0 (varianta A: 41)
  (SELECT count(*) FROM public.magazie_bucati b WHERE b.proiect_id = p.id AND b.stare <> 'anulata') AS bucati_vii,      -- 0
  (SELECT count(*) FROM public.izo_documente_intrare d WHERE d.proiect_id = p.id)                   AS documente        -- 0
FROM public.executie_proiecte p WHERE p.cod_intern = 'TEST-IZO';
```

### 2.2 Activarea pentru E3 — de ce NU `test_izo_2`

`scripts/izometrie/test_izo_2_activare_import.sql` activează proiectul **și importă cele 41 de bucăți ale acelorași documente** (payload-ul din `payload_test_avize.mjs`). Dacă rulează înainte de testul E3, fiecare confirmare a Janetei e blocată („seria … există deja ca țeavă în registru” / „curba … există deja în registru”). Iar bucățile importate nu se pot șterge, doar storna. Mai mult, indexurile de unicitate ale registrului (`ux_magbuc_izo_radacina`, `ux_magbuc_izo_curba`) sunt **globale pe serie, nu pe proiect**: cât timp o bucată 999TS… / 9001–9012 nu e `anulata`, seria e ocupată peste tot.

Pentru testul E3 se rulează **doar** atribuirea + nivelul, fără import. **Propus, neaplicat** — îl aplică sesiunea de chat, ca postgres, sesiune directă (`session_user = postgres`; pe serverul AI prin psql, CLAUDE.md pct. 3b), după „da”-ul lui Răzvan pe rândurile din preview:

```sql
-- psql -X -v ON_ERROR_STOP=1 -v proiect_id=<id TEST-IZO> -v depozit_id=<id TIZ> -f <fișier>.sql
\set ON_ERROR_STOP on
SELECT 'PREVIEW' AS pas,
       (SELECT cod_intern FROM public.executie_proiecte WHERE id = :proiect_id)                AS proiect,       -- TEST-IZO
       (SELECT cod_3litere || ' — ' || name FROM public.logistica_depozite WHERE id = :depozit_id) AS depozit,   -- TIZ — DM TEST IZO
       (SELECT d.site_id = p.site_id FROM public.logistica_depozite d, public.executie_proiecte p
         WHERE d.id = :depozit_id AND p.id = :proiect_id)                                       AS pe_site,       -- true
       public.fn_izo_nivel(:proiect_id)                                                         AS nivel_inainte, -- off
       (SELECT count(*) FROM public.magazie_bucati WHERE proiect_id = :proiect_id)              AS bucati,        -- 0
       (SELECT count(*) FROM public.izo_atribuiri WHERE proiect_id = :proiect_id)               AS atribuiri;     -- 0
BEGIN;
SELECT 1 / (CASE WHEN (SELECT cod_intern FROM public.executie_proiecte WHERE id = :proiect_id) = 'TEST-IZO' THEN 1 ELSE 0 END) AS e_proiectul_de_test;
-- garda depozitului, tot în tranzacție (preview-ul doar arată): TIZ și pe site-ul proiectului, altfel 1/0 → ROLLBACK
SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM public.logistica_depozite d JOIN public.executie_proiecte p ON p.id = :proiect_id
                               WHERE d.id = :depozit_id AND d.cod_3litere = 'TIZ' AND d.site_id = p.site_id)
            THEN 1 ELSE 0 END) AS e_depozitul_tiz_pe_site;
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv)
VALUES (:proiect_id, '70d6bb90-d920-4768-a758-1a0df99853b2', 'gestionar', :depozit_id, 'Razvan Trusu',
        'Gestionar pe depozitul de TEST (testul de recepție E3, documente fictive)')
RETURNING id, proiect_id, profile_id, rol, depozit_id, valabil_de;
SELECT public.fn_izo_seteaza_nivel(:proiect_id, 'stoc',
         'TEST IZOMETRIE — testul de recepție E3 cu gestionarul (documente fictive pv_test), fără import') AS nivel;
SELECT 'VERIFICARE' AS pas, public.fn_izo_nivel(:proiect_id) AS nivel, cardinality(public.fn_izo_porti_lipsa()) AS porti_lipsa,
       (SELECT count(*) FROM public.magazie_bucati WHERE proiect_id = :proiect_id) AS bucati;   -- stoc · 0 · 0
COMMIT;
```

Dacă `test_izo_2` a rulat deja (P1 arată `bucati` = 41), testul E3 pe aceleași documente nu merge. Variantele, de decis de Răzvan:
- **A** — storno pe import: `fn_izo_import_storno(<proiect>, 'test-receptie-1', <motiv>)`, ca postgres, cu „da”. Cele 41 de bucăți devin `anulata` (bucățile, importul și evenimentul lui `sold_initial` rămân, plus un eveniment `storno` cu 41 de mișcări), seriile se eliberează, apoi testul E3. Activarea de mai sus **nu se mai rulează**: atribuirea Janetei și nivelul `stoc` există deja din `test_izo_2` (un al doilea INSERT ar pica pe indexul atribuirii active). Rezultatele așteptate din §2.3 se citesc cu corecția „Varianta A” de acolo. În 🧱, bucățile anulate nu apar la cartonașe, în tabelul pe loc × tip și nici în listă (fără filtru), deci §1.5 rămâne valabil;
- **B** — documente de test regenerate, cu alte serii (`gen/gen_pv_test.py`), apoi fișa și acest ghid refăcute (seriile și cifrele; cele 41 de bucăți ale importului rămân vii pe proiect și intră în 🧱 și în Q-REG / Q-EV).

Un alt proiect de test **nu** rezolvă coliziunea: indexurile `ux_magbuc_izo_radacina` / `ux_magbuc_izo_curba` și verificarea E3 (`serie_in_registru` / `curba_in_registru`) nu au proiectul în cheie, deci bucățile vii ale importului de pe TEST-IZO blochează confirmarea acelorași serii pe orice proiect. Doar A sau B merg.

### 2.3 Verificările SQL după fiecare pas (doar citire)

Toate pornesc de la proiectul cu `cod_intern = 'TEST-IZO'`. `execute_sql` întoarce doar ultimul rezultat: rulează fiecare interogare separat.

**Q-DOC — documentele și rândurile lor:**
```sql
WITH p AS (SELECT id FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')
SELECT d.id, d.sablon, d.nr_document, d.stare, d.versiune, d.inlocuieste_document_id AS inlocuieste, d.anulat_motiv,
       d.pv_nr, d.pv_data, count(r.id) AS randuri,
       count(r.id) FILTER (WHERE r.decizie = 'primit')              AS primit,
       count(r.id) FILTER (WHERE r.decizie = 'primit_neconform')    AS neconform,
       count(r.id) FILTER (WHERE r.decizie = 'refuzat_la_receptie') AS refuzat,
       count(r.bucata_id) AS cu_bucata,
       (SELECT count(*) FROM public.izo_documente_scanuri s WHERE s.document_id = d.id) AS scanuri
  FROM public.izo_documente_intrare d JOIN p ON p.id = d.proiect_id
  LEFT JOIN public.izo_documente_intrare_randuri r ON r.document_id = d.id
 GROUP BY d.id ORDER BY d.id;
```

**Q-REG — registrul, pe stare și tip:**
```sql
WITH p AS (SELECT id FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')
SELECT b.stare, b.tip_cod, count(*) AS buc,
       round(sum(coalesce(b.lungime_mm, 0)) / 1000.0, 2)      AS metri,        -- lungimea bucății (măsurat ?? aviz)
       round(sum(coalesce(b.lungime_aviz_mm, 0)) / 1000.0, 2) AS metri_aviz
  FROM public.magazie_bucati b JOIN p ON p.id = b.proiect_id
 WHERE b.provenienta = 'beneficiar'
 GROUP BY 1, 2 ORDER BY 1, 2;
```

**Q-EV — evenimentele și mișcările:**
```sql
WITH p AS (SELECT id FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')
SELECT e.tip, count(DISTINCT e.id) AS evenimente, count(m.id) AS miscari
  FROM public.magazie_bucati_evenimente e JOIN p ON p.id = e.proiect_id
  LEFT JOIN public.magazie_bucati_miscari m ON m.eveniment_id = e.id
 GROUP BY 1 ORDER BY 1;
```

**Q-SPEC — cazurile speciale (refuzat, măsurat, neconform):**
```sql
WITH p AS (SELECT id FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')
SELECT d.nr_document, r.nr_crt, r.serie, r.decizie, r.motiv, r.observatie, r.lungime_doc_mm, r.lungime_masurata_mm,
       r.unghi_doc, r.unghi_masurat, b.stare AS stare_bucata, b.lungime_aviz_mm, b.lungime_mm, b.unghi_curba
  FROM public.izo_documente_intrare_randuri r
  JOIN public.izo_documente_intrare d ON d.id = r.document_id JOIN p ON p.id = d.proiect_id
  LEFT JOIN public.magazie_bucati b ON b.id = r.bucata_id
 WHERE d.stare <> 'anulat' AND (r.decizie <> 'primit' OR r.lungime_masurata_mm IS NOT NULL OR r.unghi_masurat IS NOT NULL)
 ORDER BY d.id, r.nr_crt;
```

**Q-ALTE — nimic în afara proiectului de test** (rulat și înainte, la precondiția 7, și la final):
```sql
WITH p AS (SELECT id FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')
SELECT (SELECT count(*) FROM public.izo_documente_intrare d WHERE d.proiect_id <> (SELECT id FROM p))           AS documente_alte_proiecte,
       (SELECT count(*) FROM public.magazie_bucati_evenimente e
         WHERE e.tip IN ('intrare_aviz', 'intrare_lista_ambalare', 'receptie_pv') AND e.proiect_id <> (SELECT id FROM p)) AS ev_e3_alte_proiecte,
       (SELECT count(*) FROM public.magazie_bucati b WHERE b.provenienta = 'beneficiar' AND b.proiect_id <> (SELECT id FROM p)) AS bucati_alte_proiecte,
       (SELECT count(*) FROM public.magazie_bucati_evenimente e WHERE e.proiect_id <> (SELECT id FROM p))           AS evenimente_alte_proiecte,
       -- amprentele: md5 pe conținutul întreg al rândurilor (orice coloană schimbată, inclusiv updated_at, schimbă amprenta)
       (SELECT md5(coalesce(string_agg(b::text, '|' ORDER BY b.id), '')) FROM public.magazie_bucati b
         WHERE b.provenienta = 'beneficiar' AND b.proiect_id <> (SELECT id FROM p))                                 AS amprenta_bucati_alte,
       (SELECT md5(coalesce(string_agg(e::text, '|' ORDER BY e.id), '')) FROM public.magazie_bucati_evenimente e
         WHERE e.proiect_id <> (SELECT id FROM p))                                                                  AS amprenta_ev_alte,
       (SELECT md5(coalesce(string_agg(m::text, '|' ORDER BY m.id), '')) FROM public.magazie_bucati_miscari m
         WHERE m.proiect_id <> (SELECT id FROM p))                                                                  AS amprenta_miscari_alte;
```
Primele două sunt 0 cât timp nu există o recepție E3 reală. Ultimele două numărători și cele trei amprente trebuie să fie **identice înainte și după** test (dacă în paralel nu lucrează nimeni pe LOT 1 / LOT 2 — altfel compari pe proiect). Numărătorile singure arată doar că nu s-au adăugat sau șters rânduri; amprentele arată și că rândurile existente n-au fost modificate.

**Rezultatele așteptate, pe puncte de control** (fără exercițiul din §2.4; efectul lui e trecut acolo):

| Punct | Când | Q-DOC | Q-REG | Q-EV |
|---|---|---|---|---|
| C0 | după activare, înainte de Janeta | niciun rând | niciun rând | niciun rând |
| C0' | oricând cât un document e doar salvat (draft) | documentul `draft`, `cu_bucata` = 0 | neschimbat | neschimbat |
| C1 | avizul 1 confirmat | aviz_teava TEST-2610221 `confirmat`: 15 rânduri · 15 primit · 15 cu_bucata · 1 scan | `sosit` teava **15** · 90,75 · 90,75 | `intrare_aviz` 1 ev · 15 mișcări |
| C2 | avizul 2 confirmat | + TEST-2610222 `confirmat`: 15 · 14 primit · 1 refuzat · **14** cu_bucata | `sosit` teava **29** · **259,70** · 259,73 | `intrare_aviz` 2 ev · 29 mișcări |
| C3 | lista confirmată | + lista_ambalare_curbe TRUCK TEST 1 `confirmat`: 12 · 11 primit · 1 neconform · **12** cu_bucata | + `sosit` curba **11** · 0 · 0; `carantina` curba **1** · 0 · 0 | + `intrare_lista_ambalare` 1 ev · 12 mișcări |
| C4 | PV pe toate 3 | `pv_nr` = PV-TEST-1 pe toate 3 | `receptionat` teava **29** · 259,70 · 259,73; `receptionat` curba **11**; `carantina` curba **1**; **niciun `sosit`** | + `receptie_pv` 3 ev · **40** mișcări (15 + 14 + 11) |

**Varianta A** (§2.2: `test_izo_2` a rulat, apoi storno pe import, înainte de Janeta). Bucățile importului rămân pe proiect ca `anulata`, cu evenimentele lor, deci tabelul de mai sus se citește cu aceste corecții, la **fiecare** punct C0–C4:
- **Q-REG** are în plus, neschimbate pe tot testul: `anulata` teava **29** · 259,73 · 259,73 (importul păstra lungimea de pe aviz) și `anulata` curba **12** · 0 · 0. La C0 acestea sunt singurele rânduri („niciun rând” din tabel = niciun rând în afara lor);
- **Q-EV** are în plus: `sold_initial` 1 ev · 41 mișcări și `storno` 1 ev · 41 mișcări;
- **Q-DOC**, **Q-SPEC**, **Q-ALTE** și ce vede Janeta în 🧱 (§1.5) nu se schimbă. Doar filtrul „Anulat (storno)” din 🧱 arată cele 41 de bucăți anulate;
- la final, pe TEST-IZO: **82** de bucăți (41 anulate + 41 din E3), **8** evenimente, **163** de mișcări (față de 41 / 6 / 81 fără storno).

**Q-SPEC la C3 / C4** — exact 3 rânduri:

| nr_document | nr_crt | serie | decizie | lungimi / unghiuri pe rând | bucata |
|---|---|---|---|---|---|
| TEST-2610222 | 7 | 999TS00210 | refuzat_la_receptie, motiv „fără marcaj vizibil” | doc 11950 | **fără bucată** (stare NULL) |
| TEST-2610222 | 11 | 999TS00216 | primit, cu observația | doc 12220 · măsurat 12190 | `sosit` / `receptionat`, lungime_aviz 12220, **lungime_mm 12190** |
| TRUCK TEST 1 | 6 | 9006 | primit_neconform, cu motiv | unghi_doc 45.0 · măsurat 30.0 | `carantina`, **unghi_curba 30.0** |

Orice abatere (alt număr de bucăți, `sosit` rămas după PV, o bucată pentru 999TS00210, lungime 12220 la 00216) = **testul pică**. Notezi interogarea și rezultatul și nu continui până nu e clar de ce.

### 2.4 Greșeala intenționată (opțional, înainte de avizul 1)

Scopul: Janeta vede că o ciornă greșită se anulează cu motiv, fără urme în registru, și că documentul corect o înlocuiește. Coordonatorul îi citește pașii.

**Exercițiul A — ciornă pe șablonul greșit → anulare → înlocuire cu motiv** (rămâne vizibil în listă):
1. În 🧾, Janeta apasă intenționat **„+ ↪️ Listă de ambalare curbe”** (greșit — avizul 1 e de țeavă).
2. Scrie antetul avizului 1: Furnizor `FURNIZOR TEST SRL`, Nr. listă `TEST-2610221`, Data 22.10.2026. Șterge rândul gol cu **✕** (un rând fără bend number nu se poate salva). **💾 Salvează draft** → „Draft salvat (versiunea 1).”
3. „Mi-am dat seama că e șablonul greșit”: șablonul nu se mai poate schimba după salvare, deci ciorna se anulează. **🗑️ Anulează ciorna** (jos, în dreapta) → fereastra „Ciorna TEST-2610221 devine „Anulat” (registrul nu e atins). Furnizorul + numărul + data se eliberează: documentul se poate reintroduce corectat.” → **Motivul anulării**: `șablon greșit: e aviz de țeavă, nu listă de curbe` (minimum 3 caractere; butonul e gri până atunci) → **Anulează ciorna**.
4. Vede: „Ciorna a fost anulată (versiunea 2). Documentul se poate reintroduce corectat („Corectează documentul anulat”).”, starea **Anulat** și „⛔ Document anulat la … — motiv: …”. **← Lista**: rândul e gri, „Anulat”.
5. **Verificare (C-A):** Q-DOC → 1 rând `lista_ambalare_curbe` · TEST-2610221 · `anulat` · `anulat_motiv` completat · 0 rânduri. Q-REG și Q-EV → **niciun rând** (registrul nu e atins).
6. Janeta apasă **„+ 🧱 Aviz țeavă”**. În antet apare **„Corectează documentul anulat (opțional)”** → alege „↪️ TEST-2610221 · 22.10.2026 · #…”. Apare **„Motivul înlocuirii * (ce s-a corectat)”** → `introdus întâi pe șablonul greșit (listă de curbe)`. Fără motiv, câmpul e roșu și salvarea e oprită („Scrie motivul înlocuirii (cel puțin 3 caractere).”).
7. Apoi completează avizul 1 exact ca la §1.1. După prima salvare, legătura de înlocuire și motivul ei nu se mai schimbă (sunt fixate la creare), iar sub antet scrie „↩️ Înlocuiește documentul anulat TEST-2610221 · 22.10.2026 #… — motiv: …”. Furnizorul, numărul și data rămân editabile cât documentul e draft.
8. **Efectul pe verificări:** la C1–C4, Q-DOC are în plus rândul `anulat`, iar avizul 1 are `inlocuieste` = id-ul lui. Q-REG și Q-EV sunt **neschimbate** față de tabelul din §2.3. În 🧾 apare un document în plus (Anulat), iar sub avizul 1 scrie „· înlocuiește #…”. 🧱 nu se schimbă.
9. La avizul 2 și la listă, „Corectează documentul anulat” nu mai apare: ciorna anulată e deja înlocuită.

**Exercițiul B — dublura** (fără urme; după C1):
1. „+ 🧱 Aviz țeavă” → Furnizor `FURNIZOR TEST SRL`, Nr. aviz `TEST-2610221`, Data 22.10.2026, un rând oarecare (de ex. `999TS00101`, L aviz `6,04`) → **💾 Salvează draft**.
2. Vede: „Salvare eșuată: există deja un document viu (draft sau confirmat) cu același furnizor, număr și dată — deschide-l din listă; un document anulat se poate reintroduce”.
3. **← Lista** → „Ai modificări nesalvate. Închizi fără să salvezi?” → **OK**. Verificare: Q-DOC are același număr de rânduri ca înainte.

**Exercițiul C — total greșit** (registrul nu e atins; pe avizul 2, după controlul de la rândul 11, înainte de confirmare):
1. La „Total metri” scrie `180.39` în loc de `180.93`. Cartonașul devine **roșu**, „✗ rânduri: 180,93”, iar deasupra tabelului „⛔ 1 blocante în ecran”.
2. **🔎 Verifică** → „Verificarea serverului are blocante — vezi lista de sub tabel.” și „⛔ total m pe document 180.390 ≠ suma rândurilor 180.930 (total_m)”. „✅ Confirmă recepția” rămâne gri. Atenție: „Verifică” **salvează întâi** modificările din ecran, deci totalul greșit ajunge în draft (versiunea crește). Nu strică nimic: draftul se rescrie la pasul următor.
3. Corectează în `180.93` → **🔎 Verifică** din nou (salvează corecția, încă o versiune) → verde. Se continuă normal (§1.2, pasul 8). Urma rămasă: doar numărul de versiune al draftului; în registru, nimic.

**Ce nu se exersează în test:** anularea unui document **confirmat**. Asta e doar administrativă (`fn_izo_doc_anuleaza`, ca postgres, cu „da”): storno pe PV, apoi pe intrare, iar bucățile devin `anulata`. Lasă evenimente permanente, deci se face doar dacă Răzvan vrea explicit să testeze storno-ul.

### 2.5 Curățenia — ce rămâne după test (documentele și istoricul registrului rămân)

- **Documentele** rămân toate, fiecare cu starea lui: ciornele anulate `anulat` (gri în listă, cu motivul), documentele confirmate `confirmat`. Un document confirmat devine `anulat` doar printr-un storno administrativ (`fn_izo_doc_anuleaza`, cu „da”); rândul documentului rămâne și atunci. Niciun DELETE pe documente nu e prevăzut: tabelele `izo_documente_*` au FK `ON DELETE RESTRICT`, iar evenimentele și mișcările registrului doar se adaugă. **Nu** rămâne fiecare stare intermediară: la fiecare salvare a unei ciorne, rândurile și lista ei de scanuri se rescriu (se păstrează doar ultima versiune salvată).
- **Registrul:** cele 41 de bucăți, cele 6 evenimente și cele 81 de mișcări rămân pe TEST-IZO (varianta A: 82 / 8 / 163, vezi §2.3). Se pot doar storna administrativ (vezi mai sus). Nivelul proiectului nu mai coboară la `off` după primul eveniment.
- **Scanurile** din manifestul unui document rămân în bucket-ul `izo-documente`: cât e în manifest, fișierul nu se poate șterge, iar după confirmare sau anulare manifestul nu se mai schimbă (deci rămân scanurile documentelor confirmate și ale ciornelor anulate). Ecranul șterge însă fișierul unui scan scos dintr-o ciornă („Scoți scanul din document?”) și pe cel rămas orfan când salvarea cu scanul eșuează.
- **Seriile 999TS… și curbele 9001–9012 rămân ocupate în tot registrul** (indexurile de unicitate sunt globale). Un al doilea test cu aceleași documente cere fie storno administrativ pe cele 3 documente (cu „da”), fie documente regenerate cu alte serii.
- **Proiectul TEST-IZO**, site-ul, depozitul TIZ, rândul din `magazii` și notificarea „Proiect nou fără contract” trimisă owner-ilor (efectele `test_izo_1`) rămân. Rapoartele care adună toate proiectele ar trebui să poată ascunde TEST-IZO (filtru pe `cod_intern`, propus în E3_PLAN §6).
- **Atribuirea Janetei** pe TEST-IZO rămâne activă până decide Răzvan. Retragerea (`activ = false` sau `valabil_pana`) e tot o schimbare de drept de acces, deci se face cu „da”-ul lui, nu din oficiu.
- **LOT 1 / LOT 2:** neatinse. Dovada: Q-ALTE are aceleași numărători **și aceleași trei amprente** (md5 pe conținutul rândurilor) înainte și după. Fără amprente, aceleași numărători dovedesc doar că nu s-au adăugat sau șters rânduri.

### 2.6 După test

- Notezi, pentru fiecare punct C0–C4 (+ C-A dacă ați făcut exercițiul): rezultatul Q-DOC / Q-REG / Q-EV / Q-SPEC, ce a văzut Janeta în 🧱 (§1.5), orice mesaj roșu (textul exact, cu codul din paranteze) și observațiile ei despre ecran (ce a fost greu, ce lipsește).
- Rezultatul intră în `handoff_activ` (rândul Izometrie), iar lecțiile durabile în `claude_context`.
- Cifrele de verificat pe hârtie (tabelul 1 din fișă) rămân cele din `pv_test/README.md`. Pentru ERP, tabelul 2 din fișă trebuie citit cu corecția de la începutul acestui ghid (168,95 m / 259,70 m / 30°) sau regenerat pentru E3.
