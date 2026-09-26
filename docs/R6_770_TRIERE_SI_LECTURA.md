# R6 — doc 770 (lic. 101 Huedin): trierea paginilor fără text și lectura vizuală a planșelor

Doc 770 este „Documentatie tehnica HUEDIN Lot 1/Studiu geotehnic__Transgaz+Anexe.pdf” (99.948.369 B, 714 pagini). E studiul
geotehnic GEOSTUD pentru conducta Transgaz Huedin–Lugașu, cu 11 subtraversări. Licitația are depunerea pe **30.10.2026**.

Documentul adună cinci runde de lucru din 26.09.2026:
- trierea deterministă a paginilor fără text;
- verificarea trierii;
- randarea planșelor pe NAS;
- lectura vizuală pe trei loturi, plus verificarea adversarială a lecturii;
- **completarea cerută de verdictul Copilot (ADDENDUM 2, secțiunea 770)**, după-amiaza. Ea a adus: sursa fiecărui parametru,
  cu citate verificate (§3.5); corelarea centralizatoarelor de laborator cu sinteza (§3.6); temeiul autorizațiilor și
  georadarul (§4); separarea extracției de review (§8).

Regulile au fost respectate: în BD doar SELECT, nicio scriere în BD sau Storage, niciun apel AI plătit, niciun mail. Lectura
e vizuală, făcută de Claude pe randări PNG. Nu am făcut commit.

## 1. Pe scurt
- **Aria lotului, verificată în runda de completare: doar 4 din cele 11 subtraversări sunt în Lotul 1.** Licitația 101 e
  „LOT 1, PT nr. TG_INV_10035/2021” (km 0–35). PT vol. 1 (doc 769) spune ⟦769 p.17⟧ „Prezentul proiect tratează conducta de
  transport gaze naturale de la km 0 la km 35 reprezentând lotul 1.” Tot acolo, Vadu Crișului și Aștileu sunt trecute la
  LOT 2. Tabelul nr. 1 al PT ⟦769 p.54⟧ are 4 traversări de ape cadastrate: TA 1 Poicu, TA 2 Semeni, TA 3 Negrea, TA 4 Beznea.
  Volumul 2 (doc 771) are antemăsurători numai pentru ele (p.97, 112, 132, 166). Subtraversările 5–11, inclusiv canalul
  Vadu Crișului, sunt în Lotul 2: pentru oferta Gazpet sunt **informative**. Studiul 770 le acoperă pe toate 11, pentru că
  a fost făcut pentru toată conducta.
- **Trierea e confirmată și închisă** (Copilot, ADDENDUM 2): 714 pagini = 215 cu text + 499 fără text. Cele 499 intră în
  8 categorii, fără suprapuneri și fără goluri. Verificatorul a făcut 5 corecturi minore (§2.2). Niciuna nu schimbă
  relevanța sau propunerea de OCR.
- **Lectura vizuală e confirmată** pe toate imaginile redeschise (§3.3): 13 imagini, din toate cele trei loturi, inclusiv
  p.407 în 4 decupaje mărite. Nicio valoare citită de loturi (NH, straturi, adâncimi, cote, distanțe, denumiri) n-a fost
  infirmată. Am găsit 5 neconcordanțe noi în document (§3.4), niciuna blocantă.
- **Sursa fiecărui parametru** e în §3.5: pagina planșei și imaginea, plus citatul din text. Toate citatele din doc 770
  au fost verificate automat pe `text_extras`. Cele 154 de fragmente din document și toate cele 157 din lista de lucru
  sunt găsite pe pagina indicată, fiecare de cel mult 20 de cuvinte.
- **Centralizatoarele de laborator față de sinteză** (§3.6): am citit vizual două centralizatoare, p.162 și p.259. Ele
  coincid 1:1 cu fișele complexe din stratul de text (p.159 și p.252). Celelalte 31 de pagini există doar ca miniaturi de
  36 dpi, ilizibile. Pe Lotul 1 sinteza e în general corectă, dar are goluri:
  - bolovănișul e doar descris, nemăsurat;
  - la Negrea, „matricea argiloasă prăfoasă” nu e susținută de granulometrie;
  - la Beznea, sub albie nu există nicio încercare de rezistență.

  Pe Lotul 2 am găsit erori de sinteză: o valoare copiată de la Semeni în tabelul Cap. 3.5, curbe de albie copiate de la
  Beznea la 9, 10 și 11, φ recomandat sub toate valorile măsurate la Tetchea.
- **Georadar (anexa 54): restanță reală a dosarului.** Anexa e listată ⟦770 p.5⟧, iar ⟦p.141⟧ spune că rapoartele detaliate
  sunt în anexe, dar raportul lipsește. Informația pentru subtraversarea canalului **nu e completă**: utilitățile îngropate
  semnalate la ⟦p.21⟧ nu sunt localizate. Canalul e însă în Lotul 2. Clarificarea e scrisă (§4.1), NETRIMISĂ, iar decizia
  A/B e la Razvan.
- **Autorizațiile GEOSTUD și Eco Geodrum: fără obligație pentru ofertant** (§4.2). Nicio cerință din fișa de date (537),
  din Precizări cerințe (768) sau din PT/antemăsurători (769/771) nu le leagă de ofertă. Măsura pentru riscul „studii și
  investigații inadecvate” e în sarcina Entității Contractante ⟦768 p.13, p.15⟧. E o lipsă informativă a dosarului de proiectare, fără clarificare.
- **Extracția textuală rămâne „partial”** (215 pagini cu text + 499 fără text, neschimbată). E separată de review-ul
  vizual făcut de Claude. **Niciun review uman nu e consemnat** (§8).
- **OCR plătit: nu e necesar.** Cele 22 de planșe s-au citit gratuit, vizual. Pe cele 33 de centralizatoare OCR-ul e opțional
  (~0,16 USD), cu valoare mică (§5).
- **Pentru oferta pe Lotul 1 (TA 1–4, toate în șanț deschis în antemăsurători) contează:**
  - Poicu și Semeni: pietriș saturat cu bolovăniș la ~0,5–0,6 m sub talveg, iar la Semeni, sub el, nisip argilos marnos;
  - Negrea: bandă de conglomerat la 2,60–2,90 m, blocuri posibile, versanți instabili, fără apă;
  - Beznea: nisip fin prăfos saturat sub albie, maluri de 2,5–3 m, erodate, cu surplombe;
  - toate: epuismente și sprijiniri. Antemăsurătorile dau 12 ore de epuizare și 30 mp de sprijiniri la fiecare TA; de
    comparat cu terenul (§6).
- **Informativ (Lotul 2):** la canal, FOD impus, 4–6 m de pietriș saturat sub fundul canalului, utilități îngropate fără
  raport; la Crișul Repede, ambele traversări, marne tari cu refuz SPT; la Tetchea, albie de ~114 m.

## 2. Trierea celor 499 de pagini fără text

### 2.1 Categorii (după corecturi)
Metoda a fost deterministă, fără AI: `pdfinfo`, `pdftotext`, `pdfimages -list` și `pdftoppm` la 36 dpi, apoi metrici pe benzi
și dHash/md5. Toate cele 499 de miniaturi au fost verificate vizual. Lista paginilor fără text e identică cu
`pagini_necitite` din BD (499).

| Categorie | Pagini | Nr. | Relevanță | Metodă |
|---|---|---|---|---|
| Separator de anexă (pagină albă, 13–19 caractere ascunse) | 156, 178, 213, 227, 249, 335, 371, 405, 594, 612, 634 | 11 | nulă | nimic, doar reper |
| Planșă vectorială: profil geolitologic / secțiune | 158, 180, 215, 229, 251, 337, 373, 407, 596, 614, 636 | 11 | **mare** | citite vizual (§3) |
| Planșă vectorială: plan de situație | 157, 179, 214, 228, 250, 336, 372, 406, 595, 613, 635 | 11 | medie | citite vizual (§3) |
| Scan: centralizator rezultate laborator (rotit 90°) | 162, 169, 184, 203, 219, 233, 240, 258-259, 292-293, 326, 341, 362, 377, 395, 444-445, 483-484, 519-520, 559-560, 600, 607, 618, 625, 643-644, 672-673, 705 | 33 | medie | OCR opțional (§5) |
| Scan: raport de încercare GEOSTUD, pag. 1 (sau raport de o pagină) | 95 de pagini (lista în `triere.json`) | 95 | mică | fără OCR |
| Scan: Laborator de mediu (apă/sol, agresivitate) | 172-177, 202, 207-212, 243-248, 291, 325, 329-334, 361, 365-370, 399-404, 418-429, 482, 518, 558, 593, 610-611, 628-633, 671, 704, 709-714 | 72 | mică | fără OCR (concluziile sunt în Cap. 3.x) |
| Scan: grafice de laborator (granulometrie 104, plasticitate 47, edometru 20, forfecare 20) | 191 de pagini | 191 | mică | fără OCR |
| Scan: tabele pe probe (densitate **TG 47**, umiditate/stare **TU 28**) | 75 de pagini | 75 | mică | fără OCR |
| Fotografii / pagini repetate / necunoscute | — | 0 | — | — |

Pe relevanță: mare 11, medie 44, mică 433, nulă 11 (total 499). Tipul fizic al paginilor: 466 de scanuri JPEG la 150 dpi,
22 de planșe vectoriale (textul e convertit în curbe) și 11 separatoare albe.

### 2.2 Corecturile verificatorului (aplicate mai sus)
1. **TG→TU la p.263, 449, 488 și 524.** Au macheta „Caracteristici de stare ale pământului”. Subtotalurile devin TG 47 (nu
   51) și TU 28 (nu 24). Totalul de 75 rămâne.
2. **Tipul C nu e doar administrativ.** Paginile 289, 290, 323, 324, 359, 360, 393, 394, 556 și 557 sunt rapoarte de o
   pagină, cu rezultat de umflare liberă (UL) sau materii organice. Valorile apar deja în centralizator și în Cap. 3. Se
   corectează doar descrierea, categoria rămâne.
3. **Maparea blocului canalului (A8), corectată:**
   - 408–411: fișele complexe F IX, F X, F XI, F XII (anexa 51);
   - 412–417: fișele fotografice F IX–F XI (anexa 52);
   - 418–429: Laborator de mediu, intercalat în anexa 52;
   - 430–431: fișa **fotografică** F XII;
   - 432–443: raportul electrometric (anexa 53);
   - 444–593: laborator.
4. **p.407 nu e „doar vectorială”.** Are 3 imagini raster (14,1% din pagină): tomografia ERI 4a–4b, lipită în planșa 8c.
5. **Imagini relevante pe pagini cu text**, pe care trierea nu le semnalase:
   - secțiunile ERI 434, 436, 438, 440 și 442;
   - figurile 106–111 din Cap. 3.8 (profilele ERI 1–5 reluate, cu fotografii de achiziție; verificat pe p.106 = „Figura 44”,
     profilul 1);
   - planurile topografice din Cap. 3 (p.26, 35, 51, 92 etc.).

   Secțiunile ERI au intrat în lectura vizuală (§3).

### 2.3 Harta documentului
- p.1–24: foaia de titlu, cuprins, lista anexelor 1–70, Cap. 1 și 2. p.9 are tabelul forajelor și decizia „FOD la canal”.
  p.19–21 descriu metoda GPR.
- Cap. 3, pe subtraversări:
  - 3.1 Poicu 25–32;
  - 3.2 Semeni 33–42;
  - 3.3 Negrea 43–49;
  - 3.4 Beznea 50–58;
  - 3.5 Crișul Repede (Vadu Crișului) 59–73;
  - 3.6 Dobrinești 74–82;
  - 3.7 Râciu 83–90;
  - 3.8 Canal Vadu Crișului 91–112;
  - 3.9 Mnierea 113–119;
  - 3.10 Valea Rece 120–127;
  - 3.11 Crișul Repede (Tetchea) 128–138.
- p.139–141: Cap. V și VI (concluzii). p.142–155: anexele 1–13 (hărți; Anexa 8 = harta PATN a zonelor seismice).
- Pe fiecare subtraversare urmează un bloc: separator, plan, profil, fișe de foraj (cu text), apoi laboratorul scanat.

## 3. Lectura vizuală pe subtraversare

Sursele sunt marcate astfel:
- **[IMG p]**: citit din randarea paginii p (200 dpi, decupaje de 300–600 dpi sau mărite de 2–4× pe PC);
- **[TXT p]**: din stratul de text al doc 770 din BD (`text_extras`, locator ⟦PAGINA p⟧);
- **[DER]**: calculat de noi din cote.

Cotele sunt în metri (Marea Neagră), iar adâncimile sunt de la teren. Studiul **nu dă** pentru nicio subtraversare lungimea
proiectată, cota conductei sau adâncimea de afuiere. Distanțele de pe planșe sunt ale profilului topografic, nu ale
subtraversării.

### 3.1 Condițiile de teren (tabel sinteză)

| # | Subtraversare | Foraje (adânc., mal, cotă) | Litologie pe ax | NH / apă | Albie și cote | Riscuri de execuție | Sursa |
|---|---|---|---|---|---|---|---|
| 1 | **p. Poicu** (Ciucea, CJ) | F-I 6 m, mal stâng; 470,8 [TXT] / 470,71 [IMG] | 0–0,40 sol vegetal; **0,40–6,00 pietriș cu nisip și bolovăniș** (saGr), îndesat (N30=27); baza neatinsă | NH 2,50 ≈ 468,2, **~0,6 m sub talveg** | talveg 468,85; fund ~4,7 m; maluri 1,5–2,3 m, erodate, meandre | pietriș saturat cu bolovăniș pe toată adâncimea (tubaj necesar la foraj); afuiere; apă corozivă pentru metale | plan [IMG 157], profil [IMG 158], fișa [TXT 159–161], Cap. 3.1 [TXT 25–32] |
| 2 | **p. Semeni (Dotmir)** (Ciucea, CJ / Sâg, SJ) | F-II 6 m, mal stâng; 481,2 [TXT] | 0–3,40 pietriș cu nisip, **saturat de la 1,70**; **3,40–6,00 nisip argilos marnos** (sasiCl, CIL), plastic vârtos | NH 1,70 ≈ 479,5, ~0,5 m sub talveg | talveg 479,93; fund ~2,5 m; maluri 1,0–1,5 m | contact pietriș/argilă la **~2,2 m sub talveg**, în plaja de pozare (deviere la FOD); pietriș saturat; apă corozivă | [IMG 179 ✔, 180 ✔], [TXT 181–183, 33–42] |
| 3 | **p. Negrea** (Negreni, CJ) | F-III 6 m, mal drept; 773,9 [TXT] / ~772,5 [IMG] | 0–2,60 pietriș și nisip (tare de la 2,50); **2,60–2,90 rocă degradată (conglomerat)**; 2,90–6,00 pietriș și nisip | **fără apă** (debit nepermanent) | talveg 772,15; albie ~3,2 m; versant drept ~37% | **bandă de rocă la 1–2,5 m sub talveg**, posibile blocuri (derocare / refuz FOD); versanți instabili | [IMG 214, 215 ✔], [TXT 216–218, 43–49] |
| 4 | **p. Beznea** (Bratca, BH) | F-IV 6 m, mal drept; 407,1 [TXT] / 407,35 [IMG] | 0–2,50 pietriș și nisip (doar pe mal); sub albie **2,50–6,00 nisip prăfos fin cu lentile de argilă**, saturat de la 4,20 | NH 4,20 ≈ 403,1, ~1,5 m sub talveg | talveg 404,61; fund ~2,3 m; maluri 2,5–3,0 m, erodate, cu surplombe; cot brusc de ~90° | nisip fin saturat (curgere, frac-out, sufoziune); maluri instabile; apă slab corozivă | [IMG 228, 229], [TXT 230–232, 50–58] |
| 5 | **R. Crișul Repede** (Vadu Crișului, BH) | F-V (E) și F-VI (V), 15 m; 266,8 / 266,5; ~48,7 m între ele | F-V: **0–3,00 pietriș cu bolovăniș**, saturat de la 2,30; dedesubt **rocă de bază jurasică marnoasă, tare** (refuz SPT la 9 și 12 m). F-VI: 0–1,20 nisip și pietriș, apoi rocă de bază cu **lentilă saturată de nisip cu pietriș la 6–9 m** | F-V: NH 2,30 ≈ 264,5 (nivelul râului); F-VI: „fără apă” [TXT], dar desenul are linie NH | talveg 264,21; fund ~30 m; maluri 2,1–2,7 m; pod tubular la ~25 m aval | bolovăniș saturat pe malul E; marne tari cu nisip cimentat (cuplu mare, uzură); argile active (UL 65–120%); **Natura 2000 ROSCI0050**; apă corozivă | [IMG 250, 251 ✔ + h251 ✔], [TXT 252–253, 59–73] |
| 6 | **p. Dobrinești** (Vadu Crișului / Măgești, BH) | F-VII 6 m, mal drept; 265,7; tubat 4,50 | 0–1,60 praf nisipos, tare; **1,60–2,60 argilă prăfoasă plastic consistentă** (N=9); **2,60–≥6,00 pietriș și nisip cu bolovăniș, saturat** (baza neatinsă) | infiltrații de la 1,60 ≈ 264,1 [IMG „inf 1.60m”, TXT] | talveg 264,44; albie ~12 m între muchii, fund ~2,4 m; maluri ~1,2 m | argilă moale la cota de pozare; sub ea pietriș saturat cu bolovăniș (colaps, pierderi de fluid, epuismente); apă corozivă | [IMG 336, 337 + h337 ✔ (litologia)], [TXT 338–340, 74–82] |
| 7 | **p. Râciu** (Măgești, BH, S de Ortiteag) | F-VIII 6 m, mal drept; 243,3; tubat Ø152 până la 4,50 | 0–0,40 sol vegetal; 0,40–2,00 argilă prăfoasă nisipoasă, plastic vârtoasă, cu concrețiuni calcaroase; **2,00–6,00 pietriș și nisip cu bolovăniș**, saturat de la 2,30 | NH 2,30 ≈ 241,0, **~0,25 m sub talveg** | talveg 241,25; fund ~2 m; maluri ~1,5–2,1 m | pietriș cu bolovăniș saturat imediat sub talveg; **apă puternic corozivă pentru metale** | [IMG 372, 373 + h373] (citire proprie), [TXT 374–376, 83–90] |
| 8 | **Canal Vadu Crișului** (Aștileu, BH; lângă DJ764; CHE Aștileu 2 la ~130 m aval) | F-IX, X, XI, XII × 20 m; 230,0 / 231,1 / 230,9 / 230,0; de la F-XII la F-IX ~122 m | Acoperiș: 0–1,0/2,0 m praf argilos, apoi **pietriș și nisip cu bolovăniș până la 5,40 (IX) / 7,00 (X) / 8,70 (XI) / 7,50 (XII)**. Dedesubt, rocă de bază: nisipuri prăfoase/argiloase, argile și prafuri **marnoase, tari** (straturi 4–10); refuz SPT la 15,45–18,45 | NH 4,20 / 3,00 / 4,50 / 4,00; la F-X ≈ 228,1 (≈ fundul canalului) | talveg canal **228,32** [IMG 406]; canal ~2,6 m adânc, ~10 m sus, ~3 m la fund [IMG 407, estimat 1:400]; F-XI la 2,31 m de mal, F-X la 11,00 m [IMG 406] | **FOD cerut de studiu**; **cat. geotehnică 2** (risc moderat); sub canal, **4–6 m de pietriș saturat cu bolovăniș** [DER]. ERI: >70 Ω·m până la ~7–10 m, <18 Ω·m (marne) dedesubt. **Utilități îngropate** găsite cu georadar, dar raportul lipsește (§4). Apă puternic corozivă | [IMG 406, 407 (4 decupaje), 434–442, 106], [TXT 408–411, 432–443, 91–112, 9, 21] |
| 9 | **p. Mnierea** (Aștileu / Tetchea, BH) | F-XIII 6 m, mal drept; 210,5; tubat 4,50 | 0–0,40 sol vegetal; **0,40–6,00 pietriș și nisip cu bolovăniș**, saturat de la 2,00; de la 4,00 pietriș uniform (~92% pietriș) | NH 2,00 ≈ 208,5, ~0,5 m sub talveg | talveg 208,99; albie ~6,4 m între muchii; maluri ~1,5–1,8 m | pietriș saturat cu bolovăniș pe toată adâncimea; s-a analizat doar solul (neagresiv pentru beton) | [IMG 595, 596 + h596] (citire proprie), [TXT 597–599, 113–119] |
| 10 | **p. Valea Rece** (Tetchea, BH; SV de lacul Lugașu) | F-XIV 6 m; 203,50; mal **stâng** [TXT 123], dar **„dreapta”** în tabelul de la [TXT 9] | **0–6,00 pietriș și nisip cu bolovăniș**, uscat/îndesat, umed de la 3,00, saturat de la 4,50 | NH 4,50 ≈ 199,0, **~1,8 m sub talveg** | talveg 200,81; albie ~13,5 m între muchii, fund ~5 m; maluri **2,5–2,7 m** (în amonte până la 3,0–3,2) | pietriș cu bolovăniș (uscat deasupra NH); maluri înalte; apă slab corozivă | [IMG 613, 614 + h614] (citire proprie), [TXT 615–617, 120–127] |
| 11 | **R. Crișul Repede** (Tetchea / Lugașu de Jos, BH; între lacurile Lugașu și Tileagd) | F-XV (stâng) și F-XVI (drept), 15 m; F-XV **194,50 [TXT] / ~197,45 [IMG]**; F-XVI 197,80; ~106 m între ele (din coordonate) | F-XV: **0–5,30 pietriș cu bolovăniș**; apoi nisip prăfos, argilă și prafuri **marnoase, tari** (SPT 38–44, **refuz la 12 m**). F-XVI: pietriș cu bolovăniș 0–1,40 și 2,20–5,00 (la 3,00–3,30 lemn în descompunere), apoi nisipuri prăfoase marnoase cu **lentile de nisip cimentat**, refuz la 12 m | NH 4,30 / 4,20 ≈ 193,2–193,6 (≈ nivelul albiei) | talveg 192,93; **albie ~114 m între muchii**; maluri **4,5–4,9 m**; pe profil, sub albie doar ~0,5–0,7 m de pietriș peste roca de bază [IMG 636] | subtraversare lungă; **rocă marnoasă tare aproape imediat sub albie** (strat portant nisip prăfos marnos, pconv 150 kPa); maluri înalte; apa nu e corozivă | [IMG 635, 636 + h636] (citire proprie), [TXT 637–642, 128–138] |

✔ = imagine redeschisă și confirmată la verificarea adversarială (§3.3). Rândurile 1, 4 și cotele de la 6 vin din lectura lotului 1 sau 2 (neredeschise, dar corelate cu textul). La 7, 9, 10 și 11 e citire proprie a verificatorului, pentru că rezultatul loturilor a ajuns trunchiat.

**Lotul:** rândurile 1–4 sunt în Lotul 1 (TA 1–4, licitația 101). Rândurile 5–11 sunt în Lotul 2 și sunt doar
informative (§1). Pentru fiecare parametru, sursa exactă (planșa, imaginea și citatul verificat) e în §3.5.

Pentru toate cele 11 subtraversări:
- **Categoria geotehnică** e 1 (risc redus), cu excepția canalului: categoria 2, risc moderat [TXT 112].
- **Recomandarea studiului**: pozare sub adâncimea maximă de afuiere, apărări de mal și praguri de fund, fără micșorarea
  secțiunii de curgere. **FOD** e impus explicit doar la canal [TXT 9, 112].
- **pconv (kPa)**: Poicu, Semeni, Beznea, Dobrinești și Mnierea 180; Negrea 200; Crișul Repede Vadu Crișului, Râciu, canal și
  Valea Rece 170; Tetchea 150.
- **Mediul nu e agresiv pentru beton** nicăieri. Pentru metale:
  - puternic coroziv: Râciu și canal (F-X);
  - coroziv: Poicu, Semeni, Crișul Repede Vadu Crișului, Dobrinești;
  - slab coroziv: Beznea, Valea Rece;
  - necoroziv: Tetchea (F-XVI);
  - neanalizat pentru apă: Negrea (fără apă) și Mnierea (doar solul).

### 3.2 Cote și distanțe citite de pe profile [IMG]

| # | Planșa | Plan de ref. | Cote existente (stânga → dreapta) | Distanțe parțiale | Cumulate |
|---|---|---|---|---|---|
| 1 | 1b p.158 | 460,00 | 469,28 · 468,85 · 469,01 · 469,31 · 470,71 | 0,62 · 4,72 · 1,28 · 5,16 · 9,87 | 40,31 … 52,10 |
| 2 | 2b p.180 | 472,00 | 481,47 · 481,34 · 480,47 · 479,99 · 479,93 · 480,93 · 480,93 · 481,18 · 481,19 · 481,05 | 1,18 · 1,61 · 0,37 · 2,50 · 0,55 · 1,01 · 1,92 · 3,20 · 4,17 | 9,30 … 25,80 |
| 3 | 3b p.215 | 765,00 | 773,41 · 772,76 · 772,38 · 772,15 · 772,76 · 775,04 · 776,64 (+ etichetă „27.12m”) | 5,80 · 0,91 · 1,84 · 0,42 · 5,48 · 4,97 | 17,74 … 37,16 |
| 4 | 4b p.229 | 397,00 | 407,35 · 404,96 · 404,63 · 404,61 · 404,98 · 407,03 | 3,19 · 0,49 · 1,36 · 0,41 · 4,99 | 19,34 … 29,78 |
| 5 | 5b p.251 | 250,00 | 266,34 · 265,21 · 264,96 · 264,21 · 264,88 · 264,97 · 265,85 · 266,88 | 5,86 · 1,94 · 14,30 · 14,30 · 1,65 · 1,43 · 5,88 | 5,04 … 50,39 |
| 6 | 6b p.337 | 264,00 | 265,17 · 265,59 · 264,60 · 264,44 · 264,45 · 264,58 · 265,60 · 265,67 · 265,77 · 265,26 | (0–21,15 fără etichetă) · 6,17 · 1,05 · 2,37 · 0,58 · 1,97 · 2,45 · 2,82 · 12,79 | 0,00 … 51,36 |
| 7 | 7b p.373 | 241,00 | 243,25 · 242,95 · 241,38 · 241,25 · 241,37 · 243,30 · 243,35 | 16,02 · 3,04 · 1,14 · 0,84 · 2,26 · 6,02 | 0,00 … 29,31 |
| 8 | 8c p.407 | — | secțiune la 1:400, fără tabel de cote; cotele forajelor [TXT 96], talvegul canalului 228,32 [IMG 406] | — | F-XII → F-IX ≈ 122 m |
| 9 | 9b p.596 | 208,00 | 210,22 · 210,51 · 210,70 · 210,75 · 209,24 · 208,99 · 209,22 · 210,50 · 210,75 · 210,85 | 19,29 · 3,19 · 5,65 · 3,66 · 0,60 · 2,14 · 3,43 · 19,30 · 2,95 | 0,00 … 60,21 |
| 10 | 10b p.614 | — | 203,25 · 203,50 · 203,55 · 200,95 · 200,81 · 201,05 · 203,50 · 203,19 | 11,01 · 10,05 · 4,51 · 1,29 · 3,91 · 3,80 · 9,98 | 0,00 … 44,54 |
| 11 | 11b p.636 | 192,00 | 197,45 · 197,55 · 194,15 · 193,42 · 193,02 · 192,93 · 193,11 · 193,42 · 197,85 · 197,78 · 197,80 | 4,38 · 9,21 · 9,83 · 6,45 · 34,91 · 26,17 · 13,61 · 14,32 · 2,16 · 2,06 | 0,00 … 123,11 |

La 9, 10 și 11 sumele parțialelor dau cumulatele cu o abatere de cel mult 0,01, deci citirea e coerentă.

**Atenție la scară:** nu se măsoară cu rigla pe PDF. Cartușele scriu 1:100, dar pe pagină desenul e altfel:
- 1b–4b: 1:100 real;
- 5b, 7b, 10b: ~1:200;
- 9b: ~1:270;
- 11b: ~1:550 pe orizontală și ~1:270 pe verticală (supraînălțare de 2×).

Se folosesc cotele și distanțele scrise. Planșa 8c e la 1:400 real.

### 3.3 Verificarea adversarială: ce am redeschis și ce a ieșit
Loturile 2 (subtraversările 7–8) și 3 (9–11 + ERI) au ajuns trunchiate în sarcina verificatorului. Pentru ele am făcut o
citire proprie, independentă, pe aceleași randări, corelată cu fișele din BD.

- **Lotul 1 (subtraversările 1–4), 3 imagini: l_180 întreg, l_215 întreg și l_179 mărit 4× în jurul F-II.** Toate valorile
  sunt confirmate:
  - Semeni: NH 1,70; contactul la 3,40; 6,00/2,60; ambele descrieri; 10 cote, 9 distanțe parțiale și 10 cumulate; planul de
    referință 472,00;
  - Negrea: 2,60/2,60, 2,90/0,30, 6,00/3,10; conglomeratul; „27.12m”; fără NH; toate cotele și distanțele.

  **Poziția inversată a F-II e CONFIRMATĂ.** Pe planul 179, pe linia de secțiune 2, cotele 481,34 și 481,47 stau pe partea
  SE, lângă F-II, iar 481,19 și 481,05 pe partea NW. Profilul începe cu 481,47, deci stânga profilului = SE. Totuși F-II e
  desenat în dreapta, la ~24,3 m, adică pe partea NW.

  Nicio valoare nu e infirmată.
- **Lotul 2 (subtraversările 5–8), 5 imagini:**
  - l_251 și h251_cote (500 dpi): 8 cote, 7 parțiale și 8 cumulate confirmate; eroarea „6.00” la 13–15 m în F-VI confirmată;
    etichetele saclSi (CIM) la 4–6 și saSi la 10–13 confirmate; F-VI la ~1,3 m și F-V la ~49,4 m confirmate.
  - l_407 plus 4 decupaje mărite 2× din l_407_a/_b: F-XII NH 4,00 cu straturile 1,00 / 7,50 / 10,00 / 14,00 / 16,00 / 20,00;
    F-XI NH 4,50 cu 0,40 / 2,00 / 8,70 / 10,00 / 12,00 / 20,00; F-X NH 3,00 cu 1,20 / 7,00 / 10,00 / 14,00 / 16,00 / 20,00;
    F-IX NH 4,20 cu 1,00 / 5,40 / 6,00 / 8,00 / 12,00 / 14,00 / 16,00 / 18,00 / 20,00. ERI 4a–4b: iterația 5, eroare 2,9%,
    adâncime 0,875–25,8 m, 10,6–382 Ω·m, pas 3,50 m. Totul identic cu fișele [TXT 408–411] și cu raportul de randare.
    Legenda „mică” din dreapta sus e lizibilă la 2×: descrierea stratului superior din F-IX.
  - h337_fvii: litologia Dobrinești și „inf 1.60m” confirmate.
  - l_373 și h373_cote: citire proprie.
  - c406a: talvegul canalului 228,32; F-XI la 2,31 m și F-X la 11,00 m de mal.

  NH-ul desenat la F-VI (5b) e la ~2,0 m [IMG]; lotul a estimat ~2,2 m. Diferența e neglijabilă și nu schimbă nimic.
- **Lotul 3 (subtraversările 9–11 + ERI): l_596, l_614, l_636, tabelele de cote la 600 dpi (h5xx/h6xx_t1–3), h596_fxiii,
  h636_mijloc, h440_eri și l_106.** Aici am făcut citire proprie. Cotele și distanțele sunt coerente aritmetic. NH-urile
  (2,00 / 4,50 / 4,30–4,20) coincid cu fișele [TXT 597, 615, 637–638].

### 3.4 Neconcordanțe găsite în document (niciuna blocantă)
1. **F-II (Semeni)**: pe profilul 180 e desenat pe partea opusă față de plan și text (confirmat mai sus). Litologia e
   extrapolată oricum pe toată lățimea, deci efectul e mic.
2. **Cota F-III (Negrea)**: 773,9 în text, față de ~772,5 pe profil. De ea depinde adâncimea conglomeratului sub talveg
   (0,9–1,2 m sau 2,2–2,5 m).
3. **Cota F-XV (Tetchea), nou**: 194,50 în text [TXT 132], față de ~197,45 pe profil. NH-ul (4,30 → 193,2 ≈ nivelul
   râului) și malul simetric (F-XVI, 197,80) susțin valoarea de pe profil. Textul are probabil o greșeală de tipar (197,50).
4. **F-XIV (Valea Rece), nou**: „dreapta” în tabelul de la p.9, „malul stâng” la p.123.
5. **ERI profilul 4, nou**: trei seturi de parametri diferite:
   - planșa 407: iterația 5, 2,9%, 10,6–382 Ω·m;
   - figura de la p.440: iterația 7, 2,9%, 5,54–378 Ω·m;
   - textul de la p.441: 8 iterații, 3,7%, 4,7–400 Ω·m.

   Tot nou: p.442 datează profilul 5 „12/04/2022”, iar tabelul de la p.433 dă 15/07/2022. Interpretarea (două secvențe:
   pietriș peste marne la ~7–10 m) e aceeași peste tot.
6. **5b (Crișul Repede Vadu Crișului)**:
   - grosimea „6.00” la 13–15 m în F-VI (corect 2,00);
   - etichetele la 4–6 și la 10–13 m diferă de fișa F-VI;
   - F-VI e „fără apă” în text, dar pe desen are linie NH;
   - limita acoperitoare/rocă cade la 4,00 m pe desen, față de 3,0 m în text.
7. Bolovănișul la Semeni, Negrea și Beznea apare doar în textul de sinteză al Cap. 3, nu în fișe sau pe profile. Eticheta
   „27.12m” de pe 3b e neexplicată.
8. **Scara de pe cartușe** nu corespunde cu desenul de pe pagină la 5b, 7b, 9b, 10b și 11b (§3.2).

### 3.5 Sursa fiecărui parametru, pe subtraversare

Pentru fiecare parametru folosit în §3.1 dau planșa (pagina din PDF și fișierul de pe PC, în `C:\Users\Public\tri770\`)
și pasajul din text (`text_extras`, locatorul ⟦PAGINA n⟧, citat de cel mult 20 de cuvinte).

Toate citatele din doc 770 au fost verificate automat în această rundă. Textul integral (389.553 caractere, md5
`eab5c42d…`, identic cu cel din BD) a fost adus local prin SELECT, împărțit pe cele 714 locatoare, și fiecare citat a fost
căutat pe pagina lui, cu spațiile normalizate. Rezultatul: 157 din 157 în lista de lucru `citate.py` și 154 din 154 fragmente
extrase din documentul final (verificare pe tot fișierul, inclusiv §3.6 și §4). Citatele păstrează ortografia din document, fără
diacritice acolo unde documentul nu le are. Caracterul φ e în stratul de text U+F066 (fontul Symbol).

✔ = planșă redeschisă la verificarea adversarială (§3.3). [DER] = calculat de noi. PR = planul de referință al profilului.
Unde celula de planșă are „—”, parametrul vine numai din text. „Lot 1” și „Lot 2” înseamnă lotul licitației; „lotul de
lectură 1–3” e împărțirea lecturii vizuale din §3.3.

**1. p. Poicu (Ciucea, CJ)** — Lot 1 (TA 1)

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0–0,40 sol vegetal; 0,40–6,00 pietriș cu nisip și bolovăniș (saGr); baza neatinsă | p.158 `l_158.png` (coloana F-I; lotul de lectură 1) | ⟦p.29⟧ „Pamant grosier saGr/Pietris cu nisip cafeniu-galbui, cu bolovanis, cu foarte slab”<br>⟦p.29⟧ „forajul a strabatut pe toata adancimea un nivel aluvionar grosier” |
| NH | 2,50 m ≈ 468,2, ~0,6 m sub talveg [DER] | p.158 `l_158.png` (NH=2.50) | ⟦p.31⟧ „Apa subterana a fost interceptata la adancimea de 2,50m sub forma de nivel hidrostatic.”<br>⟦p.160⟧ „NH: 2.50 m” |
| Adâncime investigată | 6,00 m, 1 foraj, mal stâng | p.158 `l_158.png` (6.00/5.60) | ⟦p.29⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul stang al paraului Poicu.”<br>⟦p.159⟧ „Oprit sondajul la adancimea de 6.00 m” |
| Cote | F-I 470,8 [TXT] / 470,71 [IMG]; talveg 468,85; PR 460,00 | p.158 `l_158.png` (rândul de cote) | ⟦p.29⟧ „46°57'25.6"N 22°50'31.5"E 470.8” |
| Distanțe | parțiale 0,62…9,87; cumulate 40,31…52,10; fund ~4,7 m [DER] | p.158 `l_158.png`; plan p.157 `l_157.png` | ⟦p.25⟧ „malurile au inaltimi de circa 1,50 – 2,30m si sunt erodate.” |
| Riscuri | pietriș saturat cu bolovăniș pe toată adâncimea [DER din lit.+NH]; afuiere (d50 14,72 mm); maluri erodate | — | ⟦p.32⟧ „se recomanda ca subtraversarea paraului Poicu sa se faca sub adancimea maxima de afuiere.”<br>⟦p.30⟧ „parau Poicu 1.38 5.37 14.72 25.47 18.46 0.82” |
| Agresivitate / expunere chimică | beton: fără agresivitate; metale: coroziv (apa); pconv 180 kPa | — | ⟦p.31⟧ „apa subterana nu prezinta agresivitate faţă de betoane şi betoane armate iar fata de metale este corozivă.”<br>⟦p.32⟧ „o presiune conventionala pconv = 180 kPa.” |

**2. p. Semeni (Dotmir)** — Lot 1 (TA 2)

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0–3,40 pietriș cu nisip, saturat de la 1,70; 3,40–6,00 nisip argilos marnos (sasiCl) | p.180 `l_180.png` ✔ | ⟦p.38⟧ „forajul a strabatut pana la adancimea de 3,40m un nivel aluvionar grosier”<br>⟦p.38⟧ „Pamant fin sasiCl (CIL)/Nisip argilos cenusiu, cu aspect marnos, cu lentile de” |
| NH | 1,70 m ≈ 479,5, ~0,5 m sub talveg [DER] | p.180 `l_180.png` ✔ (NH=1.70) | ⟦p.41⟧ „Apa subterana a fost interceptata la adancimea de 1,70m sub forma de nivel hidrostatic.” |
| Adâncime investigată | 6,00 m, 1 foraj, mal stâng | p.180 `l_180.png` ✔ (6.00/2.60) | ⟦p.37⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul stang al paraului Semeni.”<br>⟦p.181⟧ „Oprit sondajul la adancimea de 6.00 m” |
| Cote | F-II 481,2 [TXT]; talveg 479,93; PR 472,00 | p.180 `l_180.png` ✔; p.179 `l_179.png` (mărit 4×) ✔ | ⟦p.37⟧ „46°58'56.7"N 22°49'10.5"E 481,2” |
| Distanțe | cumulate 9,30…25,80; fund ~2,5 m; F-II desenat inversat pe profil | p.180 ✔, p.179 ✔ | ⟦p.33⟧ „malurile au inaltimi de circa 1,0 – 1,50 m si sunt erodate.” |
| Riscuri | contact pietriș/argilă la ~2,2 m sub talveg [DER]; afuiere (d50 11,23 mm) | — | ⟦p.42⟧ „Semeni sa se faca sub adancimea maxima de afuiere.”<br>⟦p.40⟧ „parau Semeni 2.25 6.98 11.23 16.28 7.24 1.33” |
| Agresivitate / expunere chimică | beton: fără; metale: coroziv (apa); pconv 180 kPa | — | ⟦p.41⟧ „apa subterana nu prezinta agresivitate faţă de betoane şi betoane armate, iar fata de metale este corozivă.” |

**3. p. Negrea (Negreni, CJ)** — Lot 1 (TA 3)

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0–2,60 pietriș și nisip; 2,60–2,90 rocă (conglomerat); 2,90–6,00 pietriș și nisip | p.215 `l_215.png` ✔ | ⟦p.47⟧ „de la 2.60m la 2.90m roca (conglomerat)”<br>⟦p.45⟧ „se mai pot intalni fragmente mai mari (de dimensiunea blocurilor) apartinand rocii sursa.” |
| NH | fără apă | p.215 `l_215.png` ✔ (fără linie NH) | ⟦p.49⟧ „Apa subterana nu a fost interceptata in foraj.”<br>⟦p.47⟧ „F III, Fara apa” |
| Adâncime investigată | 6,00 m, 1 foraj, mal drept | p.215 `l_215.png` ✔ (6.00/3.10) | ⟦p.47⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul drept al paraului Negrea.” |
| Cote | F-III 773,9 [TXT] față de ~772,5 [IMG]; talveg 772,15; PR 765,00 | p.215 `l_215.png` ✔ | ⟦p.47⟧ „47° 0'15.93"N 22°43'56.25"E 773.9” |
| Distanțe | cumulate 17,74…37,16; albie ~3,2 m; versant drept ~37 % [DER] | p.215 ✔; plan p.214 `l_214.png` | ⟦p.44⟧ „Versantii adiacenti au pante abrupte si prezinta potential de instabilitate.” |
| Riscuri | bandă de rocă la 1–2,5 m sub talveg; blocuri posibile; versanți instabili | — | ⟦p.49⟧ „Negrea sa se faca sub adancimea maxima de afuiere.” |
| Agresivitate / expunere chimică | **neanalizată** (fără apă; Cap. 3.3 nu are secțiune de agresivitate); pconv 200 kPa | — | ⟦p.49⟧ „o presiune conventionala pconv = 200 kPa.” |

**4. p. Beznea (Bratca, BH)** — Lot 1 (TA 4)

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0–2,50 pietriș și nisip (pe mal); 2,50–6,00 nisip prăfos cu lentile de argilă | p.229 `l_229.png` (lotul de lectură 1, neredeschis) | ⟦p.54⟧ „Sub adancimea de 2,50m forajul a interceptat depozitele sennoniene reprezentate prin nisipuri prafoase” |
| NH | 4,20 m ≈ 403,1, ~1,5 m sub talveg [DER] | p.229 `l_229.png` (NH=4.20) | ⟦p.56⟧ „Apa subterana a fost interceptata la adancimea de 4,20m sub forma de nivel hidrostatic.” |
| Adâncime investigată | 6,00 m, 1 foraj, mal drept | p.229 `l_229.png` (6.00/3.50) | ⟦p.54⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul drept al paraului Beznea.” |
| Cote | F-IV 407,1 [TXT] / 407,35 [IMG]; talveg 404,61; PR 397,00 | p.229 `l_229.png` | ⟦p.54⟧ „46°58'0.27"N 22°39'8.86"E 407,1” |
| Distanțe | cumulate 19,34…29,78; fund ~2,3 m; cot de ~90° pe plan | p.229; plan p.228 `l_228_a.png`/`l_228_b.png` | ⟦p.51⟧ „albia este ingusta cu maluri relativ inalte (pana la 2,50 – 3,0 m)” |
| Riscuri | nisip fin saturat sub albie; maluri instabile, cu surplombe. Stratul portant indicat e pietrișul, deși sub albie e nisipul | — | ⟦p.51⟧ „fac ca malurile sa aiba un potential de instabilitate ridicat.”<br>⟦p.51⟧ „Malurile sunt erodate local existand zone cu surplombe”<br>⟦p.58⟧ „reprezentat de “pietris cu nisip si bolovanis, cu foarte slab liant prafos”” |
| Agresivitate / expunere chimică | beton: fără; metale: slab coroziv; pconv 180 kPa | — | ⟦p.57⟧ „apa subterana nu prezinta agresivitate faţă de betoane şi betoane armate, iar fata de metale este slab corozivă.” |

**5. R. Crișul Repede (Vadu Crișului)** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | F-V: 0–3,00 pietriș cu bolovăniș, apoi rocă de bază jurasică marnoasă; F-VI: lentilă saturată 6–9 m | p.251 `l_251.png` ✔; `s58\h251_fv.png`, `s58\h251_fvi.png` | ⟦p.67⟧ „cele doua foraje au interceptat depozitele jurassice reprezentate prin alternante de depozite coezive”<br>⟦p.66⟧ „F V, NH=2.30m” |
| NH | F-V 2,30; F-VI fără apă în text, dar cu linie NH pe desen | p.251 `l_251.png` ✔ | ⟦p.72⟧ „Apa subterana a fost interceptata in forajul F-V la adancimea de 2,30m”<br>⟦p.66⟧ „F VI, Fara apa” |
| Adâncime investigată | 2 × 15 m | p.251 | ⟦p.65⟧ „au fost executate 2 foraje geotehnic cu adancimea de 15m amplasate pe cele doua maluri” |
| Cote | F-V 266,8; F-VI 266,5; talveg 264,21; PR 250,00 | `s58\h251_cote.png` ✔ (500 dpi) | ⟦p.66⟧ „46°59'53.8"N 22°31'8.4"E 266.8”<br>⟦p.66⟧ „46°59'53.2"N 22°31'6.3"E 266.5” |
| Distanțe | cumulate 5,04…50,39; ~48,7 m între foraje [DER din coordonate] | `s58\h251_cote.png` ✔; plan p.250 | ⟦p.61⟧ „albia minora a raului Crisul Repede este larga (intre 30 si 60m)”<br>⟦p.61⟧ „in aval de subtraversare (la circa 25m) a fost realizat un pod din tuburi de beton” |
| Riscuri | argile active; stabilizare sub pat; Natura 2000; pod tubular aval | — | ⟦p.69⟧ „Se mai remarca valorile relativ mari ale umflarii libere UL = 65 – 120”<br>⟦p.73⟧ „sa fie stabilizate pe o grosime de cel putin 30cm.”<br>⟦p.65⟧ „se afla pe teritoriul sitului de importanta comunitara ROSCI0050” |
| Agresivitate / expunere chimică | beton: fără; metale: coroziv; pconv 170 kPa | — | ⟦p.72⟧ „apa subterana nu prezinta agresivitate faţă de betoane şi betoane armate, iar fata de metale este corozivă.”<br>⟦p.73⟧ „o presiune conventionala pconv = 170 kPa.” |

**6. p. Dobrinești** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0–1,60 praf nisipos; 1,60–2,60 argilă plastic consistentă; 2,60–≥6,00 pietriș cu bolovăniș, saturat | p.337 `l_337.png`; `s58\h337_fvii.png` ✔ | ⟦p.78⟧ „Sub acest strat a fost interceptata o argila prafoasa, cenusie, cu plasticitate mare plastic consistenta”<br>⟦p.78⟧ „pana la talpa forajului (6,0m) a fost strabatut un orizont necoeziv grosier” |
| NH | infiltrații de la 1,60 (fișa text spune „Fara apa”) | p.337 „inf 1.60m” ✔ | ⟦p.80⟧ „Apa subterana a fost interceptata la adancimea de 1,60m sub forma de infiltratii.”<br>⟦p.338⟧ „Fara apa” |
| Adâncime investigată | 6,00 m, 1 foraj, mal drept | p.337 | ⟦p.77⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul drept al paraului Dobrinesti.” |
| Cote | F-VII 265,7; talveg 264,44; PR 264,00 | `s58\h337_cote.png` | ⟦p.77⟧ „47° 0'13.25"N 22°29'4.88"E 265.7” |
| Distanțe | cumulate 0…51,36; albie ~12 m între muchii [DER] | `s58\h337_cote.png`; plan p.336 | ⟦p.75⟧ „albia este ingusta cu maluri relativ joase (sub 2,0 m)” |
| Riscuri | argilă moale la cota de pozare; pietriș saturat dedesubt | — | ⟦p.78⟧ „Sub acest strat a fost interceptata o argila prafoasa, cenusie, cu plasticitate mare plastic consistenta” |
| Agresivitate / expunere chimică | beton: fără; metale: coroziv; pconv 180 kPa | — | ⟦p.81⟧ „apa subterana nu prezinta agresivitate faţă de betoane şi betoane armate, iar fata de metale este corozivă.” |

**7. p. Râciu** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0,40–2,00 argilă prăfoasă nisipoasă; 2,00–6,00 pietriș cu bolovăniș, saturat de la 2,30 | p.373 `l_373.png` (citire proprie) | ⟦p.86⟧ „pana la talpa forajului (6,0m) a fost interceptat un strat necoeziv reprezentat prin pietris si nisip” |
| NH | 2,30 m ≈ 241,0, ~0,25 m sub talveg [DER] | p.373 | ⟦p.88⟧ „Apa subterana a fost interceptata la adancimea de 2,30m sub forma de nivel hidrostatic liber” |
| Adâncime investigată | 6,00 m, 1 foraj, mal drept | p.373 | ⟦p.86⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul drept al paraului Raciu.” |
| Cote | F-VIII 243,3; talveg 241,25; PR 241,00 | `s58\h373_cote.png` | ⟦p.86⟧ „47° 1'42.06"N 22°25'36.29"E 243.3” |
| Distanțe | cumulate 0…29,31; albie ~7,3 m între muchii [DER] | `s58\h373_cote.png`; plan p.372 | ⟦p.84⟧ „albia este ingusta cu maluri relativ joase (intre 1,50 - 2,0 m)” |
| Riscuri | argilă activă (UL 90) deasupra; NH posibil ascensional | — | ⟦p.87⟧ „Umflarea libera UL (%) 90”<br>⟦p.88⟧ „poate avea un usor caracter ascensional” |
| Agresivitate / expunere chimică | beton: fără; metale: **puternic** coroziv; pconv 170 kPa | — | ⟦p.89⟧ „iar fata de metale este puternica corozivă.” |

**8. Canal Vadu Crișului (Aștileu)** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | acoperiș coeziv, apoi pietriș cu bolovăniș până la 5,40–8,70 m; dedesubt rocă de bază marnoasă, tare | p.407 `l_407_a.png`/`l_407_b.png` + 4 decupaje ✔; ERI p.434–442 `l_434…l_442.png` | ⟦p.98⟧ „pana la adancimea de 5,40m (F-IX) - 8,70m (F-XI) se afla formatiunea acoperitoare”<br>⟦p.98⟧ „Sub depozitele pleistocene a fost interceptata roca de baza reprezentata prin depozite coezive” |
| NH | 4,20 / 3,00 / 4,50 / 4,00 (F-IX…F-XII) | p.407 ✔ | ⟦p.104⟧ „Apa subterana a fost interceptata in toate cele 4 foraje la adancimi cuprinse intre 3,0 si 4,50m” |
| Adâncime investigată | 4 × 20 m; ERI ~37 m (P4 ~26 m) | p.407 ✔; `s911\h434_eri.png`…`h442_eri.png` | ⟦p.95⟧ „au fost executate 4 foraje geotehnic cu adancimea de 20m amplasate pe cele doua maluri”<br>⟦p.105⟧ „Adancimea medie de investigatie a fost de aproximativ 37m” |
| Cote | 230,0 / 231,1 / 230,9 / 230,0; talveg canal 228,32 [IMG, citire nesigură] | p.406 `s58\h406_canal.png` | ⟦p.96⟧ „47° 2'25.7"N 22°23'32.7"E 230.0” |
| Distanțe | F-XI la 2,31 m și F-X la 11,00 m de mal; F-XII→F-IX ~122 m [DER] | p.406 `s58\h406_canal.png` ✔ | ⟦p.92⟧ „Latimea albiei (talvegului) este de circa 3,0m iar deschiderea canalului la coronament”<br>⟦p.92⟧ „Inaltimea canalului este de circa 2,5m.” |
| Riscuri | FOD impus; cat. geotehnică 2; utilități îngropate (raport lipsă, §4.1); beton degradat | — | ⟦p.9⟧ „care se va face prin foraj orizontal dirijat (FOD).”<br>⟦p.112⟧ „se recomanda ca subtraversarea canalului Vadu Crisului sa se faca prin foraj orizontal dirijat.”<br>⟦p.112⟧ „in categoria geotehnica 2 respectiv risc geotehnic moderat”<br>⟦p.21⟧ „a fost evidentiata prezenta unor utilitati ingropate in zona investigata”<br>⟦p.92⟧ „Betonul este insa degradat atat pe taluze cat si in albie” |
| Agresivitate / expunere chimică | beton: fără; metale: **puternic** coroziv; pconv 170 kPa | — | ⟦p.105⟧ „iar fata de metale este puternica corozivă.”<br>⟦p.112⟧ „o presiune conventionala pconv = 170 kPa.” |

**9. p. Mnierea** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0,40–6,00 pietriș și nisip cu bolovăniș; baza neatinsă | p.596 `s911\h596_desen.png`, `h596_fxiii.png` | ⟦p.117⟧ „forajul a strabatut pana la adancimea de 6.00 un nivel aluvionar grosier” |
| NH | 2,00 m ≈ 208,5 [DER] | p.596 | ⟦p.118⟧ „Apa subterana a fost interceptata la adancimea de 2.00m sub forma de nivel hidrostatic.” |
| Adâncime investigată | 6,00 m, 1 foraj, mal drept | p.596 | ⟦p.117⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul drept al paraului Mnierea.” |
| Cote | F-XIII 210,5; talveg 208,99; PR 208,00 | `s911\h596_t1.png`…`t3.png` (600 dpi) | ⟦p.117⟧ „47° 2'58.53"N 22°21'2.48"E 210.5” |
| Distanțe | cumulate 0…60,21 | idem; plan `s911\h595_plan.png` | ⟦p.114⟧ „albia este ingusta cu maluri relativ inalte (pana la 2,00 m)” |
| Riscuri | pietriș saturat pe toată adâncimea; dale de beton; Natura 2000 la ~75 m | — | ⟦p.114⟧ „pe maluri se poate observa o veche amenajare din dale de beton”<br>⟦p.116⟧ „se afla la o distanta de circa 75m fata de amplasamentul subtraversarii” |
| Agresivitate / expunere chimică | doar solul analizat (apa nu); beton: fără; pconv 180 kPa | — | ⟦p.118⟧ „a fost recoltata o proba de pamant(sol)”<br>⟦p.119⟧ „probele de pământ nu prezintă agresivitate chimica faţă de betoane şi betoane armate.” |

**10. p. Valea Rece** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | 0–6,00 pietriș și nisip cu bolovăniș; baza neatinsă | `s911\h614_desen.png`, `h614_fxiv.png` | ⟦p.123⟧ „forajul a strabatut pana la adancimea de 6.00 un nivel aluvionar grosier” |
| NH | 4,50 m ≈ 199,0 [DER] | p.614 | ⟦p.125⟧ „Apa subterana a fost interceptata la adancimea de 4.50m sub forma de nivel hidrostatic.” |
| Adâncime investigată | 6,00 m, 1 foraj (mal stâng aici, „dreapta” la p.9) | p.614 | ⟦p.123⟧ „1 foraj geotehnic cu adancimea de 6m amplasat pe malul stang al paraului Valea Rece.” |
| Cote | F-XIV 203,50; talveg 200,81 | `s911\h614_t1.png`…`t3.png` | ⟦p.123⟧ „47° 3'3.61"N 22°19'7.70"E 203.50” |
| Distanțe | cumulate 0…44,54; ~13,5 m între muchii [DER] | idem; plan `s911\h613_plan.png` | ⟦p.120⟧ „albia este ingusta cu maluri inalte (pana la 3,00 – 3, 20 m)” |
| Riscuri | maluri înalte; dale de beton lângă ax | — | ⟦p.121⟧ „pe maluri se poate observa o veche amenajare din dale de beton” |
| Agresivitate / expunere chimică | beton: fără; metale: slab coroziv; pconv 170 kPa | — | ⟦p.126⟧ „apa subterana nu prezinta agresivitate faţă de betoane şi betoane armate, iar fata de metale este slab corozivă.” |

**11. R. Crișul Repede (Tetchea)** — Lot 2

| Parametru | Valoarea folosită în §3.1 | Planșa (pagina · imagine pe PC) | Pasajul din text (⟦PAGINA n⟧ · citat) |
|---|---|---|---|
| Litologie pe ax | F-XV 0–5,30 / F-XVI 0–5,00 pietriș cu bolovăniș; dedesubt rocă de bază marnoasă, tare | `s911\h636_fxv.png`, `h636_fxvi.png`, `h636_mijloc.png` | ⟦p.133⟧ „pana la adancimea de 5,00m (F-XVI) - 5.30m (F-XV) forajele au strabatut un nivel aluvionar grosier” |
| NH | 4,30 / 4,20 | p.636 | ⟦p.137⟧ „Apa subterana a fost interceptata la adancimi cuprinse intre 4.20 – 4.30m sub forma de nivel” |
| Adâncime investigată | 2 × 15 m | p.636 | ⟦p.132⟧ „au fost executate 2 foraje geotehnice cu adancimea de 15m amplasate pe cele doua maluri” |
| Cote | F-XV 194,50 [TXT] față de ~197,45 [IMG]; F-XVI 197,80 | `s911\h636_t1.png`…`t3.png` | ⟦p.132⟧ „47° 3'34.25"N 22°17'58.61"E 194.50”<br>⟦p.132⟧ „47° 3'37.67"N 22°17'59.15"E 197.80” |
| Distanțe | cumulate 0…123,11; ~114 m între muchii [DER] | idem; plan `s911\h635_plan.png` | ⟦p.129⟧ „albia minora a raului Crisul Repede este larga (intre 50 si 60m)”<br>⟦p.129⟧ „au inaltimi relativ cuprinse intre 3,20 – 4,20m” |
| Riscuri | praguri de fund amonte/aval; Natura 2000 traversată; parametri de rocă discutabili (§3.6) | — | ⟦p.129⟧ „se afla intre doua praguri de fund, ambele realizate din piatra sparta”<br>⟦p.132⟧ „traverseaza atat un sit de importanta comunitara”<br>⟦p.136⟧ „unghi de frecare interna φ = 10 – 14o” |
| Agresivitate / expunere chimică | beton: fără; metale: necoroziv; pconv 150 kPa | — | ⟦p.137⟧ „iar fata de metale nu este corozivă.”<br>⟦p.138⟧ „o presiune conventionala pconv = 150 kPa.” |


### 3.6 Centralizatoarele de laborator față de sinteza din Cap. 3

**Ce s-a putut citi vizual.** Pe PC, în `C:\Users\Public\tri770\`, sunt la rezoluție utilizabilă doar două centralizatoare:
- `v_162.png`, 745×1053 px (~90 dpi), Poicu F-I, raportul nr. 878/03.08.2022. L-am citit din copia locală
  `scratchpad/tri770/v_162_centralizator.png`, care are aceleași dimensiuni și aceeași mărime (147.323 B);
- `v_259.png`, 579×819 px (~70 dpi), Crișul Repede Vadu Crișului F-V, pagina 2/2.

Le-am citit rotite și mărite 2× (decupajele locale sunt în `scratchpad/cz770/`). Celelalte 31 de pagini de centralizator
există doar în foile de contact `foaie1..6.png`, la 36 dpi, cu miniaturi de ~156×208 px. Acolo cifrele nu se citesc
(verificat pe `foaie6`, celulele 377 și 259).

**Lipsește o randare la ≥150 dpi**, adică rezoluția nativă a scanurilor, pentru paginile:
- 184, 219, 233, 258, 292–293, 341, 377, 444–445, 483–484, 519–520, 559–560, 600, 618, 643–644, 672–673 (foraje);
- 169, 203, 240, 326, 362, 395, 607, 625, 705: al doilea tip de centralizator, neidentificat (probabil proba de albie).

Randarea cere descărcarea din nou a PDF-ului pe NAS, doar pentru citire.

**Ce ține loc de centralizator.** Fișa complexă a forajului, care e pagină cu text, reproduce centralizatorul probă cu
probă. Am verificat asta pe ambele eșantioane:
- **162 față de 159**: P1–P3 la 2,00 / 4,00 / 6,00 m au argilă „-”, praf 2 / 1 / 1, nisip 36 / 27 / 37, pietriș 62 / 72 / 62,
  bolovăniș „-”, w 5,03 / 9,52 / 7,46 % și ρs 2,65 (valoare derivată). Identic.
- **259 față de 252**: P4–P7 la 8 / 10 / 12 / 14 m. Am comparat granulometria, WP, WL, w, Ip, Ic, ρn, ρd, n, e, Sr și ρs,
  plus Eoed 15038 și forfecarea CD c 15,24 / φ 28,10 la P5. Identic pe toate cele 16 coloane citite.

Pentru celelalte nouă subtraversări, corelarea de mai jos folosește fișa din stratul de text, nu centralizatorul citit
vizual.

**Corelarea, pe subtraversare** (V = centralizator citit vizual; F = fișă text; S = sinteza din Cap. 3):

| # | Centralizator · fișă | Indicator: laborator → sinteză Cap. 3 | Potrivire |
|---|---|---|---|
| 1 Poicu (L1) | 162 **V** · 159 F | granulometrie 2/36/62, 1/27/72, 1/37/62 (V = F) → S doar calitativ ⟦p.29⟧ „pietrisuri neuniforme, cu nisip si bolovanis, saturate, cu indesare medie;” | da (calitativ) |
| | | bolovăniș, coloana 8 (d > 63 mm): „-” la toate probele (V) → S și fișa: „cu bolovanis” | **nu**: descris, nemăsurat |
| | | umiditate w 5,03–9,52 % (V = F) → absentă din S | absent |
| | | uniformitate: P1 și P3 „uniforma”, P2 „neuniforma” (V) → strat ⟦p.29⟧ „cu granulozitate uniforma”, sinteză „pietrisuri neuniforme” | parțial |
| | | forfecare/densitate: netestate; doar ρs 2,65 (valoare derivată) → S: c = 0, φ 27–30°, E 15 MPa, valori alese | n.a. (fără încercare) |
| 2 Semeni (L1) | 184 · 181 F | w aluvionar P1 3,97 → tabelul ⟦p.39⟧ „Umiditate naturala (w - %) 3.97 13,1 – 14,3” | da |
| | | Ic 0,926 / 0,925 → ⟦p.39⟧ „Indice de consistenta (IC) - 0.925 ÷ 0.926” | da |
| | | ρn 1,951 / 1,861 / 2,018 → ⟦p.40⟧ „Densitatea volumetrica naturala ρn (g/cm3) - 1,87 – 2,02” | parțial (minimul real 1,86) |
| | | forfecare CD c 15,42 / φ 24,70 → ⟦p.39⟧ „intre c = 15,42 kPa iar ale unghiului de frecare φ =24,70 o.” | da |
| 3 Negrea (L1) | 219 · 216 F | granulometrie: fracțiunea fină 1–5 %, fără argilă, nisip 40–48 %, pietriș 51–59 % → ⟦p.47⟧ „prinse intr-o matrice argiloasa prafoasa.” | **nu** |
| | | w 21,30 / 3,67 / 12,02 / 8,16 % → absentă din S | absent |
| | | forfecare netestată → ⟦p.48⟧ „unghi de frecare interna φ = 38 – 32o” (valori alese, ordine inversată) | n.a. |
| 4 Beznea (L1) | 233 · 230 F | granulometrie sub 2,50 m: argilă 9 / 8, praf 30 / 38, nisip 61 / 54 → S „nisipuri prafoase … cu lentile de argila” | da (calitativ) |
| | | w 5,97 / 12,28 / 14,42 % → absentă din S | absent |
| | | forfecare/Eoed: **nicio încercare** în F-IV → ⟦p.55⟧ „unghi de frecare interna φ = 24 – 27o” (valori alese) | n.a.: stratul de sub albie n-are nicio încercare de rezistență |
| 5 Crișul R. VC (L2) | 258–259 (**259 V**) · 252–253 F | w argile P4 24,24, P6 23,21 (V) → ⟦p.70⟧ „22.3 – 34.5” | da |
| | | Ic P6 0,923 (V) → ⟦p.70⟧ „Ic = 0.923 ÷ 1.0” | da |
| | | ρn 2,094 / 2,062 (V) → tabel p.71 „2.06 – 2.27” | da |
| | | CD P5 c 15,24 / φ 28,10 (V) → ⟦p.70⟧ „c = 15,24 – 39.51 kPa iar ale unghiului de frecare φ =21,40 – 28,10” | da în text; în tabelul p.71 nu apare |
| | | UL 120 (F-V P2) și 65 (F-VI P2), doar în F; pe 258 nerandat → ⟦p.69⟧ „UL = 65 – 120” | da (nevizual) |
| | | w aluvionar în tabel ⟦p.70⟧ „Umiditate naturala (w - %) 3.97 22.3 – 34.5 18.7 – 29.6 30.9” față de F-V P1 6,43 și F-VI P1 18,59 | **nu**: 3,97 e valoarea de la Semeni (F-II P1), copiată |
| 6 Dobrinești (L2) | 341 · 338 F | argilă w 27,29 / Ic 0,731 / ρn 1,846 / CD 40,39 și 15,82 → ⟦p.79⟧ „Indice de consistenta (IC) 1.0 0.73 -”, ρn 1.85, c 40.4 | da |
| | | UL 90 la argila de la 2,00 m (F, coloana UL) → absentă din S; ⟦p.77⟧ „nu se afla intr-o arie cu terenuri cu potential de contractie-umflare medie” | **nu** (de confirmat vizual pe 341) |
| | | w pietriș 6,67 / 6,88 → ⟦p.79⟧ „6,7 – 6,8” | da (rotunjire) |
| 7 Râciu (L2) | 377 · 374 F | w 15,68, ρn 2,027, UL 90, CD 42,61 / 17,16 → ⟦p.87⟧ „Umflarea libera UL (%) 90”, „2.03”, „42.6” | da |
| | | WP 14,68 (F) → ⟦p.87⟧ „Limita inferioara de plasticitate (WP - %) 14.43 -” | **nu**: 14,43 e umiditatea probei de forfecare |
| | | w pietriș 9,90 / 9,27 → „9.3 – 9.9” | da |
| 8 Canal (L2) | 444–445, 483–484, 519–520, 559–560 · 408–411 F | w acoperiș 18,83 / 19,62; w aluvionar 6,91–27,42 → ⟦p.102⟧ „18,83 – 19,62 6,91 – 27,42” | da |
| | | CaCO3 5,61–9,80; Eoed 10117–15397; CD c 7,73–39,80, φ 18,61–27,44 → p.104 | da |
| | | Ip: text ⟦p.103⟧ „Ip = 13.51 – 39.59”, dar tabelul p.104 și fișele au maximul 31,39 | **nu** (39,59 nu apare în fișele text) |
| | | Eoed argile ⟦p.104⟧ „10117 - 13407”, dar în F-IX P7 e 13047 | **nu** (cifre probabil inversate) |
| | | Sr ⟦p.104⟧ „0.698 – 1.292”: 1,292 (F-X) > 1 e fizic imposibil, preluat din laborator. La fel ⟦p.104⟧ „0.806 – 1.126”: 1,126 vine tot din F-X (proba de forfecare de la P8). Tot la p.104, Eoed e dat în „MPa”, deși valorile sunt în kPa | **nu** |
| 9 Mnierea (L2) | 600 · 597 F | pietriș 73 / 92 / 80 %; „uniforma de la 4,00” → S | da (calitativ) |
| | | w 3,69 / 3,43 / 7,21 → absentă; forfecare netestată, valori alese | absent / n.a. |
| | | curba de albie Fig. 51 (p.118) are punctele curbei de la Beznea (Fig. 27, p.56); tabelul ⟦p.118⟧ „3.28 10.85 21.66 28.68 8.74 1.25” | **nu**: figură copiată, d50 = 21,66 fără curbă proprie |
| 10 Valea Rece (L2) | 618 · 615 F | pietriș 64–66 %; w 2,23–7,36 absentă; forfecare n.a. | da / absent / n.a. |
| | | Fig. 54 (p.125) = curba de la Beznea; tabel ⟦p.125⟧ „2.05 6.16 15.49 28.68 13.99 0.65” (d60 identic cu Mnierea) | **nu** |
| 11 Tetchea (L2) | 643–644, 672–673 · 637–638 F | CD măsurat φ 19,15–27,82°, c 9,73–15,55 kPa → ⟦p.136⟧ „unghi de frecare interna φ = 10 – 14o” | **nu**: φ recomandat sub toate valorile măsurate |
| | | Eoed 11294–16695 kPa → ⟦p.136⟧ „modul de deformatie liniara E = 11000 - 14000 MPa.” | **nu**: unitate greșită, iar E ≠ Eoed |
| | | Ic 0,857 / 0,878 → „plastic vartoasa” (p.132) | da |
| | | Fig. 57 (p.136) = curba de la Beznea; tabel ⟦p.136⟧ „1.98 5.84 14.03 20.23 10.22 0.85” | **nu** |

Legenda: L1 / L2 = lotul licitației. Punctele curbei de la Beznea (93,08 / 59,18 / 14,86 / 25,62 / 7,40, cu d = 2,69 / 8,05 / 25,57)
se regăsesc identic pe p.56, 118, 125 și 136. Doar tabelul de la Beznea ⟦p.56⟧ „parau Beznea 2.69 8.05 18.59 25.57 9.51 0.94”
se potrivește cu curba.

**Ce e redundant și de ce.** Lanțul e: raport de încercare pe probă → centralizator → fișa complexă (text) → Cap. 3.
- **Rapoartele pe probă** sunt redundante pentru valori: 95 de pagini de tip „raport de încercare”, 191 de grafice
  (granulometrie, plasticitate, edometru, forfecare) și 75 de tabele TG/TU. Fiecare valoare trece în centralizator, iar
  centralizatorul trece 1:1 în fișa text (demonstrat pe 162 și 259). Cap. 3 păstrează intervale sau valori
  caracteristice.
- **Laboratorul de mediu** (72 de pagini) e redundant: concluziile trec în tabelele de agresivitate din Cap. 3.x, citate în §3.5.
- **Nu sunt redundante** acolo unde sinteza greșește sau lipsește. Pe Lotul 1: bolovănișul nemăsurat la 1–4, „matricea
  argiloasă prăfoasă” de la Negrea și lipsa oricărei încercări de rezistență la Beznea. Pe Lotul 2: UL 90 omis la 6,
  valorile copiate de la 5, 7 și 8, curbele de albie copiate de la 9, 10 și 11. Aici sursa primară e raportul pe probă sau
  centralizatorul. Problemele de pe Lotul 1 nu schimbă litologia, NH-ul sau riscurile din §3.1; ele spun doar că
  bolovănișul și rezistența de sub albie sunt estimate, nu măsurate. Erorile de pe Lotul 2 sunt de semnalat
  proiectantului; nu sunt clarificări pentru oferta pe Lotul 1.
- **Capcană de corectat în §5**: nu toate capitolele au „Tabel centralizator cu principalii indici geotehnici”. Îl au doar
  Cap. 3.2, 3.5, 3.6, 3.7 și 3.8 (p.39, 70, 79, 87, 102/104). La Poicu, Negrea, Beznea, Mnierea, Valea Rece și Tetchea,
  Cap. 3 dă doar descrieri și parametri aleși, iar cifrele de laborator sunt numai în fișe.

## 4. Ce NU e în PDF: Georadar și autorizații
Căutarea s-a făcut numai cu SELECT, pe `ofertare_documente_atribuire`, licitația 101 (247 de documente):
- `nume_original` și `fisier_path` cu georadar, radar, GPR, autoriz, agrement, aviz, anex, studiu, electrom, ERI/ERT;
- `text_extras` cu georadar, GPR, radargram, geofizic, Eco Geodrum, AKULA/Geoscanners, GEOSTUD, agrement, tomografi/electrometri,
  „anexa 8” și „anexa 54”;
- `seap_meta`, `antet` și `analiza`.

Verificatorul a refăcut căutările-cheie (26.09): `text_extras ~* 'georadar|radargram'` → **doar doc 770**; niciun nume de
fișier cu georadar, radar, gpr, autoriz sau agrement.

În runda de completare am refăcut căutarea pe tot textul licitației 101, fără 770. Rezultatul:
- `GEOSTUD|Eco Geodrum` apare doar în 769, de două ori, la p.18 și p.20;
- `agrement` apare în 768 (p.15 și p.27) și în 769 (3 apariții fără legătură: distanțiere „agrementate tehnic”, „zone de
  agrement”, echipamente);
- `georadar|GPR|radargram`: 0 apariții.

Documentele-cheie sunt citite aproape integral: 537 și 768 „procesat”, 769 și 771 „partial” cu câte o singură pagină necitită.

### 4.1 Raportul Georadar (anexa 54): restanță relevantă a dosarului
**Ce spune studiul:**
- lista anexelor: ⟦770 p.5⟧ „54 Raport Georadar”;
- cererea beneficiarului: ⟦p.9⟧ „au fost solicitate măsurători geofizice de tipul electrometriei și georadar.”;
- aparatura: ⟦p.19⟧ „Pentru efectuarea masuratorilor a fost utilizat un sistem AKULA 9000”, cu antene de 200 și 700 MHz;
- singurul rezultat: ⟦p.21⟧ „a fost evidentiata prezenta unor utilitati ingropate in zona investigata”, cu reflectori
  hiperbolici ⟦p.21⟧ „interpretate ca fiind cel mai probabil raspunsul unor tevi”;
- concluziile afirmă că raportul e anexat: ⟦p.141⟧ „in memoriu sunt prezentate rezultatele investigatiilor geofizice
  (electrometrie si georadar) iar in anexe sunt rapoartele detaliate.”

**Ce e în PDF:** după raportul ERI (anexa 53, p.432–443), la p.444 încep direct tabelele de laborator (anexa 55). Raportul
Georadar nu e în PDF și nu e în niciun alt document încărcat. Cele 9 arhive RAR originale (id 1257–1265) sunt `ignorat`, fără
listă de conținut în BD, deci **nu se poate exclude din BD** că arhivele conțin și alte fișiere.

**Concluzie:** informația pentru subtraversarea canalului Vadu Crișului **NU e completă**. Nu se știe unde sunt utilitățile
îngropate, la ce adâncime și de ce tip. Asta afectează traseul FOD impus ⟦p.112⟧, punctele de intrare și ieșire și riscul de
avarie.

**Relevanța pentru oferta Gazpet.** Canalul e în Aștileu, iar PT vol. 1 (769) trece Aștileu la Lotul 2 (⟦769 p.17⟧). Lotul 1
are doar TA 1–4 (⟦769 p.54⟧; antemăsurătorile din 771). Pentru oferta pe Lotul 1, restanța e a dosarului, dar nu atinge
cantitățile sau soluția ofertată.

Contează direct doar dacă:
- (a) Gazpet depune și pe Lotul 2; sau
- (b) Transgaz spune că subtraversarea canalului intră în Lotul 1.

De ce contează în cazurile (a) și (b): contractul tratează ca risc excepțional numai utilitățile subterane neprevizibile.
Clauza 21.1 din Acordul contractual (doc 535) acoperă doar condițiile care „nu ar fi putut fi prevăzute de un antreprenor diligent la
data depunerii Ofertei”, „inclusiv muniţii neexplodate sau utilităţi subterane”. Clauza 25.2 adaugă: „Antreprenorul va fi
responsabil de păstrarea, protejarea, mutarea sau înlocuirea, după caz, a cablurilor, conductelor”, dar numai pentru
utilitățile „prevăzute în Contract”. Pentru cele neprevăzute, descoperite la execuție, clauza 25.3 spune că „Antreprenorul
va avea obligaţia generală de a le păstra” și de a le proteja, muta sau înlocui. Excepția e cazul în care „Beneficiarul preia
responsabilitatea respectivă”. Utilitățile sunt deja semnalate la p.21, deci ar putea fi considerate previzibile.

**Propunere de clarificare (NETRIMISĂ, decizia e a lui Razvan):**

> Solicitare de clarificare privind „Documentatie tehnica HUEDIN Lot 1 / Studiu geotehnic__Transgaz+Anexe.pdf”.
> Lista anexelor studiului (pag. 5) cuprinde „54 Raport Georadar”, iar Cap. VI (pag. 141) precizează că rapoartele
> detaliate ale investigațiilor geofizice (electrometrie și georadar) sunt anexate. La pag. 21 se consemnează că „a fost
> evidentiata prezenta unor utilitati ingropate in zona investigata” (subtraversarea canalului Vadu Crișului – Aștileu).
> Raportul Georadar nu se regăsește în documentația publicată: după anexa 53 (raport electrometric) urmează direct anexa 55
> (laborator). Vă rugăm:
> (1) să confirmați dacă subtraversarea canalului Vadu Crișului face parte din obiectul Lotului 1 (PT vol. 1, pag. 17,
> încadrează UAT Aștileu în Lotul 2);
> (2) în caz afirmativ, să publicați Raportul Georadar (anexa 54), cu poziția în plan, adâncimea și tipul utilităților
> îngropate identificate, necesare evaluării condițiilor fizice la data depunerii ofertei (Acord contractual, clauza 21.1).

Variante:
- **A (recomandarea mea, dacă Gazpet depune doar Lotul 1):** nu se trimite. Restanța rămâne consemnată aici, iar canalul
  e în Lotul 2.
- **B:** se trimite textul de mai sus, dacă Razvan vrea confirmarea scrisă a ariei lotului sau dacă se depune și pe
  Lotul 2.

Termene, din fișa de date (537, p.1): solicitările de clarificare se pot trimite până în a 18-a zi dinaintea depunerii,
adică **12.10.2026**. Entitatea răspunde până în a 11-a zi, adică 19.10.2026.

### 4.2 Autorizațiile GEOSTUD și Eco Geodrum: temeiul, verificat
**Ce spune studiul:**
- ⟦770 p.10⟧ „agrementele si autorizatiile acestora sunt prezentate in Anexa 8.”;
- dar Anexa 8 e harta seismică: ⟦p.150⟧ „Anexa 8. Planul de amenajare a teritoriului national. Sectiunea a V-a. Zone de
  risc natural Cutremure de pamant”;
- singura mențiune de autorizare: ⟦p.22⟧ „laboratorul geotehnic si laboratorul de mediu al SC GEOSTUD, autorizate ISC si
  RENAR.”, fără certificate atașate.

Deci autorizațiile lipsesc din PDF.

**Am căutat o obligație a ofertantului legată de ele sau de studiul geotehnic:**
- **Fișa de date (537):** capacitatea tehnică cere doar ⟦537 p.7⟧ „Autorizația ANRE tip ET”. Nimic despre studii,
  investigații sau firmele care le-au făcut.
- **Precizări cerințe (768):**
  - autorizațiile cerute ofertantului (p.25–27) sunt ANRE ET, atestat ANRE tip B, NEX, ⟦768 p.26⟧ „Licenta de proiectare
    si executie sisteme de alarmare impotriva efractiei” (IGPR, Legea 333/2003), PSI, ⟦768 p.27⟧ „Executie subtraversari
    cai ferate, autorizatie/agrement AFER” și RTE. Toate privesc execuția lucrării de către Gazpet;
  - ⟦768 p.28⟧ „Inainte de inceperea lucrarilor, ofertantul declarat castigator va prezenta autorizatiile si permisele”,
    adică ale lui, pentru șantier;
  - în matricea de riscuri, riscul ⟦768 p.13⟧ „Studii si investigatii inadecvate ale siturilor” are măsura ⟦768 p.15⟧
    „Intocmirea studiilor si investigatiilor de catre” … „entitati agrementate, cu experienta in aceste” domenii, cu
    responsabil **Entitatea Contractantă**. Pe p.15 tabelul e intercalat în stratul de text; rândul e reconstituit din
    cele trei coloane.
- **PT vol. 1 (769):** studiul e documentație a proiectantului, ⟦769 p.18⟧ „GEOSTUD S.R.L. – TERȚ SUSȚINĂTOR – STUDIU
  HIDROLOGIC – GEOTEHNIC ȘI ELECTROMETRIE LA TRAVERSĂRI DE APE”, cu AQUACON PROIECT ofertant unic. Capitolul ⟦769 p.36⟧
  „Foraje geotehnice și electrometrie la traversare cursurilor de ape cadastrate” preia din 770 doar TA 1–4.
  Caietele de sarcini sunt tot în 769. Singura obligație de execuție legată de studiu e un control la săpătură:
  ⟦769 p.175⟧ „Se verifică dacă stratificația întâlnită corespunde cu cea din referatul geotehnic” (reluat la p.184 și
  p.188), împreună cu verificarea nivelului hidrostatic. Nu are legătură cu autorizațiile elaboratorului.
- **Volumul 2 fără valori (771, antemăsurători), Acordul contractual (535) și Formularul de propunere tehnică (534):**
  nicio mențiune a GEOSTUD, a Eco Geodrum, a autorizațiilor lor sau a studiului geotehnic. Pe toată licitația 101, fără
  770, „geotehnic” mai apare doar în 769 și în două planșe (doc 637 și doc 592).

**Concluzie: fără obligație pentru ofertant.** E o lipsă informativă a dosarului de proiectare. Calitatea studiilor și a
investigațiilor e în sarcina Entității Contractante (768 p.15), iar nicio cerință de calificare sau de ofertă nu trimite la
autorizațiile elaboratorului. **Nu propun clarificare.** O întrebare ar completa dosarul, dar nu schimbă nimic în ofertă.
Varianta din §6 a rundei anterioare, care cerea autorizațiile, e retrasă.

## 5. Decizia OCR
- **Planșele (22 de pagini): OCR NU e necesar.** Toate sunt vectoriale sau curate și au fost citite vizual, gratuit, la
  200 dpi (cu decupaje de 300–600 dpi unde a fost nevoie). Valorile sunt în §3. Varianta plătită (~0,11 USD) nu mai aduce
  nimic.
- **Centralizatoarele de laborator (33 de pagini): opțional, ~0,16 USD** (33 × ~0,005 USD/pag.). Sunt scanuri rotite 90° la
  150 dpi, cu calitate de OCR moderată. Valoarea e mică pentru că fișele complexe, care sunt pagini cu text, reproduc
  centralizatoarele probă cu probă (§3.6, verificat pe 162 și 259). **Corectură:** „Tabel centralizator cu principalii
  indici geotehnici” există doar în Cap. 3.2, 3.5, 3.6, 3.7 și 3.8, nu în toate Cap. 3.x. Au sens doar pentru verificări pe
  probă, iar erorile din §3.6 privesc Lotul 2. Pentru o verificare vizuală gratuită ajunge o randare la 150 dpi pe NAS
  (§3.6). **Recomandare: nu.**
- **Celelalte 444 de pagini** (rapoarte pe probe, grafice, laborator de mediu, separatoare): **nu** au nevoie de OCR, pentru că
  sunt sintetizate în text sau n-au conținut.
- Orice cheltuială de OCR o aprobă doar ownerul sau responsabilul licitației („poarta pe cheltuială”).

## 6. Ce rămâne pentru om
1. **Georadar, decizia A/B (§4.1).** Recomandarea mea e A: nu se trimite, dacă Gazpet depune doar Lotul 1. Varianta B
   înseamnă trimiterea textului din §4.1 (NETRIMIS) până la **12.10.2026**.

   Alternativa, sau un pas în plus: deschideți manual arhivele RAR originale (1257–1265), ca să vedeți dacă conțin raportul
   georadar sau alte fișiere în afara celor extrase.
2. **Autorizațiile GEOSTUD și Eco Geodrum: nimic de făcut pentru ofertă** (§4.2). Punctul din runda anterioară, care cerea
   clarificarea lor, e retras.
3. **Metoda și cantitățile pe Lotul 1 (TA 1–4), corelate cu terenul.** Antemăsurătorile (771 p.97, 112, 132, 166) prevăd la
   fiecare TA: săpătură mecanizată în șanț deschis, 30 mp de sprijiniri de maluri, 12 ore de epuizare mecanică,
   conductă betonată (lesturi) și „teren foarte greu” la lansare. Cantitățile sunt ale proiectantului; în F3 nu se schimbă
   fără clarificare. De comparat cu §3.1 și §3.5:
   - **Poicu și Semeni:** pietrișul saturat e la ~0,5–0,6 m sub talveg. Cele 12 ore de epuizare și cei 30 mp de sprijiniri
     pot fi puțini pentru o tranșee în pietriș saturat cu bolovăniș; de văzut ca risc de preț.
   - **Negrea:** banda de conglomerat de la 2,60–2,90 m (la 0,9–2,5 m sub talveg, după cota folosită) și blocurile posibile.
     Antemăsurătoarea TA 3 (V02079, 771 de la p.132), citită integral la verificare (31 de poziții), **nu are** articol de
     derocare, de săpătură în stâncă sau în teren tare. Săpătura e codificată TsC04D1; pe traseu apar și TsC04A1 și B1, dar
     categoria de teren a codului nu e scrisă în 771 și trebuie verificată în indicator. Tot aici sunt prevăzute 12 ore de
     epuizare, deși forajul F-III n-a interceptat apă.
   - **Beznea:** nisip fin saturat sub albie și maluri de 2,5–3 m, cu surplombe. Sprijinirile și epuizarea sunt critice.
     Pentru stratul de sub albie studiul nu are nicio încercare de rezistență, doar valori alese (§3.6).
   - toate: apărările de mal și pragurile de fund recomandate de studiu; protecția anticorozivă (apă corozivă la Poicu și
     Semeni, slab corozivă la Beznea, neanalizată la Negrea).
4. **Opțional, neconcordanțele din studiu care privesc Lotul 1:** poziția F-II pe profilul 2b și cota F-III (773,9 sau
   ~772,5). Impactul e mic. Neconcordanțele de la Lotul 2 nu privesc oferta: cota F-XV, malul F-XIV, parametrii ERI P4,
   valorile copiate și curbele de albie din §3.6.
5. **Decizia OCR:** recomandarea e „nu” (§5). Dacă totuși se vrea pe centralizatoare, ~0,16 USD, cu aprobarea ownerului.
   Alternativa gratuită e o randare la 150 dpi pe NAS.
6. **Planurile de situație:** cotele punctuale și codurile topo mărunte n-au fost preluate, pentru că nu se citesc sigur la
   200 dpi. Dacă sunt necesare (de exemplu pentru lungimile TA 1–4), zonele se pot randa la ≥600 dpi. PDF-ul nu mai e pe
   NAS, deci trebuie descărcat din nou, doar pentru citire.
7. **Review uman:** niciunul consemnat (§8). Validarea relevanței doc 770 (TA 1–4 relevante, 5–11 informative) îi rămâne
   lui Razvan. Bifa din UI (`fn_ofertare_doc_bifa_relevanta`) apare doar la documentele `ignorat`/`eroare`, nu și la
   770, care e `partial`. Dacă se vrea consemnată în BD, e o decizie de produs, nu o scriere pe care s-o facă Claude.

## 7. Urme și curățenie
- Trierea: `scratchpad/tri770_rezultat.json` și `scratchpad/tri770/triere.json` (sha256 66f3cdbd…), plus scripturile
  `tri_a.ts`, `tri_b.ts` și `randare.ts`.
- Randările: pe PC, în `C:\Users\Public\tri770\`: `l_*.png` (51), `s58\h*.png` și `s911\h*.png` (decupajele hi-res ale
  loturilor 2 și 3), `v_*.png` și `foaie1..6.png`. Pe NAS rămân doar `/seap-work/tri770/triere.json` și `foaie1..6.png`.
- Verificatorul a făcut doar SELECT-uri în BD. N-a creat nimic pe NAS. Pe PC a creat temporar scripturile `zv_*.py` și
  decupajele `zv_*.png`, iar la final le-a șters (0 rămase).
- Nicio scriere în BD sau Storage, niciun AI plătit, niciun mail, niciun commit.
- **Runda de completare (26.09, după-amiaza):**
  - în BD doar SELECT, pe 535, 537, 768, 769, 770, 771 și pe `ofertare_licitatii` (id 101);
  - textul 770 adus local în `scratchpad/txt770/` (`text770.txt`, `pagini770.json`), cu md5 identic cu cel din BD;
  - scripturile `citate.py` (cele 157 de citate și verificatorul lor) și `gen35.py` (generează tabelele din §3.5);
  - decupaje locale în `scratchpad/cz770/`: rotiri și măriri ale `v_162`/`v_259` și celulele 377/259 din `foaie6`;
  - pe PC doar citire: `list_directory`, `read_file` pe `v_259.png` și un proces Python de citire a dimensiunilor PNG și
    de căutare a unui PDF local (nu există). Nimic creat, nimic șters;
  - pe NAS nimic.
- **Verificarea adversarială a completării (26.09):**
  - în BD doar SELECT, pe 534, 535, 537, 768, 769, 770, 771, pe RAR-urile 1257–1265 și pe `ofertare_licitatii` (id 101);
  - pe PC doar citire: `list_directory` și `read_file` pe `v_259.png`;
  - local, în `scratchpad/ver770/`: rotirile și decupajele proprii ale `v_162`/`v_259` și `cit_check.py` (extractorul
    independent de citate);
  - nimic scris în BD, Storage, NAS sau pe PC. Niciun AI plătit, niciun mail, niciun commit.

## 8. Starea extracției textuale față de review-ul efectuat (separate)
**Extracția textuală (BD, citită cu SELECT pe 26.09):** doc 770 are:
- `status_procesare = 'partial'`, `pagini = 714`, `pagini_procesate = 714`, `ocr = false`;
- `pagini_necitite` = 499 de pagini;
- `text_extras` = 389.553 caractere, md5 `eab5c42d98205e43116086e51602e507`, cu 714 locatoare ⟦PAGINA n⟧, din care 499 cu
  marcajul „fără text”;
- `procesat_la = 2026-09-25 23:55:43+00`;
- `relevanta_verificata_de`, `relevanta_verificata_la` și `relevanta_nota` = NULL.

**Starea e neschimbată:** 215 pagini cu text + 499 fără text. Nicio rundă din 26.09 n-a scris în BD. Review-ul de mai jos
**nu** schimbă starea extracției, iar paginile citite vizual rămân „necitite” pentru sistem.

**Review-ul vizual efectuat, 26.09.2026, de Claude, fără om:**

| Etapa | Ce pagini | Ce s-a verificat |
|---|---|---|
| Trierea (determinist, fără AI) și verificarea ei | toate cele 499 fără text, pe miniaturi de 36 dpi în `foaie1..6` | categoria fiecărei pagini (8 categorii); 5 corecturi (§2.2) |
| Lectura, lotul 1 | planșele 157, 158, 179, 180, 214, 215, 228, 229 (200 dpi + decupaje) | litologie, NH, adâncimi, cote, distanțe, cartușe |
| Lectura, lotul 2 | 250, 251, 336, 337, 372, 373, 406, 407; ERI 434–442; p.110 | idem + ERI 4a–4b; tabelele de cote la 450–500 dpi |
| Lectura, lotul 3 | 595, 596, 613, 614, 635, 636; ERI 434–442 (hi-res); 106–111 | idem + parametrii ERI P1–P5 |
| Verificarea adversarială | 13 imagini: 179 (4×), 180, 215, 251 (+h251), 407 (4 decupaje), 337 (h337), 373, 406 (c406a), 596, 614, 636, 440, 106 | nicio valoare infirmată; 5 neconcordanțe noi (§3.4) |
| Completarea (runda de față) | centralizatoarele 162 și 259 (vizual, mărite 2×); celulele 377/259 din `foaie6` (ilizibile); **text**: Cap. 1–3, V, VI, fișele 159–160, 181, 216, 230, 252–253, 338, 374, 408–411, 597, 615, 637–638 | 157 de citate verificate automat; corelarea centralizator → fișă → Cap. 3 (§3.6); aria lotului; temeiul autorizațiilor; georadarul |
| Verificarea adversarială a completării | **imagini** 162 și 259, rotite și mărite independent (259 luat direct de pe PC); **text**: 32 de citate verificate direct în BD, pe segmentul paginii, plus extractorul propriu pe tot documentul (152/152 citate cu locator); fișele 159, 181, 216, 230, 252–253, 338, 374, 408–411, 597, 615, 637–638; Cap. 3 p.39, 70–71, 79, 87, 103–104 | 2 corelări vizuale confirmate (162 = 159 → p.29–30; 259 = 252 → p.70–71); valorile din §3.6 confirmate; temeiul autorizațiilor confirmat, cu 4 completări (§4.1, §4.2, §6); 2 precizări în §3.6 și §1 |

**Review uman: niciunul consemnat.** Câmpurile de bifă umană sunt NULL, iar în acest document nu apare nicio validare a lui
Razvan. Tot ce e mai sus e lectura unui model, verificată de alt model. Rămâne de validat de om, mai ales aria Lotului 1
(§1) și decizia A/B de la georadar (§4.1).
