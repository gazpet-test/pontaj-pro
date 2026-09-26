# R6 — doc 770 (lic. 101 Huedin): trierea paginilor fără text și lectura vizuală a planșelor

Doc 770 este „Documentatie tehnica HUEDIN Lot 1/Studiu geotehnic__Transgaz+Anexe.pdf” (99.948.369 B, 714 pagini). E studiul
geotehnic GEOSTUD pentru conducta Transgaz Huedin–Lugașu, cu 11 subtraversări. Licitația are depunerea pe **30.10.2026**.

Documentul adună patru runde de lucru din 26.09.2026:
- trierea deterministă a paginilor fără text;
- verificarea trierii;
- randarea planșelor pe NAS;
- lectura vizuală pe trei loturi, plus verificarea adversarială a lecturii.

Regulile au fost respectate: în BD doar SELECT, nicio scriere în BD sau Storage, niciun apel AI plătit, niciun mail. Lectura
e vizuală, făcută de Claude pe randări PNG. Nu am făcut commit.

## 1. Pe scurt
- **Trierea e confirmată**: 714 pagini = 215 cu text + 499 fără text. Cele 499 intră în 8 categorii, fără suprapuneri și
  fără goluri. Verificatorul a făcut 5 corecturi minore (§2.2). Niciuna nu schimbă relevanța sau propunerea de OCR.
- **Lectura vizuală e confirmată** pe toate imaginile redeschise (§3.3): 13 imagini, din toate cele trei loturi, inclusiv
  p.407 în 4 decupaje mărite. Nicio valoare citită de loturi (NH, straturi, adâncimi, cote, distanțe, denumiri) n-a fost
  infirmată. Am găsit 5 neconcordanțe noi în document (§3.4), niciuna blocantă.
- **Lipsesc din PDF și din toată documentația încărcată**: Raportul Georadar (anexa 54, relevant pentru FOD la canal) și
  autorizațiile firmelor (p.10 trimite la „Anexa 8”, care e de fapt o hartă seismică). Sunt candidate pentru o clarificare (§4).
- **OCR plătit: nu e necesar.** Cele 22 de planșe s-au citit gratuit, vizual. Pe cele 33 de centralizatoare OCR-ul e opțional
  (~0,16 USD), cu valoare mică (§5).
- **Pentru ofertă contează cel mai mult:**
  - pietriș cu bolovăniș saturat, imediat sub talveg, la 8 din 11 traversări;
  - rocă sau strat tare la Negrea (conglomerat), la Crișul Repede Vadu Crișului, la canal și la Tetchea (marne tari, refuz SPT);
  - canalul Vadu Crișului: FOD impus de studiu, 4–6 m de pietriș saturat cu bolovăniș sub fundul canalului, utilități
    îngropate semnalate de georadar, dar raportul georadar lipsește;
  - Tetchea: albie de ~115 m, maluri de 4,5–4,9 m, rocă de bază marnoasă aproape imediat sub albie.

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

## 4. Ce NU e în PDF: Georadar și autorizații
Căutarea s-a făcut numai cu SELECT, pe `ofertare_documente_atribuire`, licitația 101 (247 de documente):
- `nume_original` și `fisier_path` cu georadar, radar, GPR, autoriz, agrement, aviz, anex, studiu, electrom, ERI/ERT;
- `text_extras` cu georadar, GPR, radargram, geofizic, Eco Geodrum, AKULA/Geoscanners, GEOSTUD, agrement, tomografi/electrometri,
  „anexa 8” și „anexa 54”;
- `seap_meta`, `antet` și `analiza`.

Verificatorul a refăcut căutările-cheie (26.09): `text_extras ~* 'georadar|radargram'` → **doar doc 770**; niciun nume de
fișier cu georadar, radar, gpr, autoriz sau agrement.

**Raportul Georadar (anexa 54): lipsește.**
- Anexa e listată la p.5 („53 Raport măsurători electrometrice, 54 Raport Georadar”).
- Metoda e descrisă la p.19–21: AKULA 9000, antene de 200/700 MHz, procesare în GPR Soft PRO.
- Singurul rezultat e la p.21: „a fost evidențiată prezența unor utilități îngropate în zona investigată”, cu reflectori
  hiperbolici, „cel mai probabil țevi”.
- În PDF, după raportul ERI (432–443), la p.444 încep direct tabelele de laborator.
- Niciun alt document al licitației nu conține termenii georadar/GPR: nici 769 (PT vol. 1), nici 771 (Volumul 2), nici 768
  (Precizări cerințe), nici fișa de date 537, nici cele 229 de planșe.
- Cele 9 arhive RAR originale (id 1257–1265, „Documentatie tehnica HUEDIN Lot 1.part01…09-semnat.rar”) sunt `ignorat`, fără
  listă de conținut în BD. **Nu se poate exclude din BD** că arhivele au și alte fișiere.

**Autorizațiile (p.10: „agrementele și autorizațiile … sunt prezentate în Anexa 8”): lipsesc.** Anexa 8 e, conform listei de
la p.4 și cuprinsului de la p.142, harta PATN „Zone de risc natural – Cutremure de pământ” (p.150). În PDF nu există pagini
cu autorizații. Singura mențiune e la p.22: laboratoare „autorizate ISC și RENAR”, fără certificate atașate. Firmele vizate
sunt GEOSTUD SRL (foraje, geofizică, laborator) și Eco Geodrum SRL (investigații geofizice).

**De ce contează:** la canal, FOD e impus, iar georadarul a găsit utilități îngropate. Fără raport nu se știe unde sunt, la ce
adâncime și de ce tip. Asta afectează traseul FOD, punctele de intrare și ieșire și riscul de avarie.

## 5. Decizia OCR
- **Planșele (22 de pagini): OCR NU e necesar.** Toate sunt vectoriale sau curate și au fost citite vizual, gratuit, la
  200 dpi (cu decupaje de 300–600 dpi unde a fost nevoie). Valorile sunt în §3. Varianta plătită (~0,11 USD) nu mai aduce
  nimic.
- **Centralizatoarele de laborator (33 de pagini): opțional, ~0,16 USD** (33 × ~0,005 USD/pag.). Sunt scanuri rotite 90° la
  150 dpi, cu calitate de OCR moderată. Valoarea e mică: Cap. 3.x are deja „Tabel centralizator cu principalii indici
  geotehnici”, cu valorile caracteristice. Au sens doar pentru verificări pe probă. **Recomandare: nu.**
- **Celelalte 444 de pagini** (rapoarte pe probe, grafice, laborator de mediu, separatoare): **nu** au nevoie de OCR, pentru că
  sunt sintetizate în text sau n-au conținut.
- Orice cheltuială de OCR o aprobă doar ownerul sau responsabilul licitației („poarta pe cheltuială”).

## 6. Ce rămâne pentru om
1. **Clarificare la autoritatea contractantă** (Transgaz), cu termen compatibil cu depunerea din 30.10.2026. Se cere:
   - Raportul Georadar (anexa 54): poziția, adâncimea și tipul utilităților îngropate la canalul Vadu Crișului;
   - agrementele și autorizațiile GEOSTUD și Eco Geodrum („Anexa 8” e citată greșit).

   Alternativa: deschiderea manuală a arhivelor RAR originale (1257–1265), ca să vedeți dacă conțin fișiere în afara celor
   extrase.
2. **Opțional, în aceeași clarificare, neconcordanțele din studiu**: poziția F-II (profilul 2b), cota F-III, cota F-XV
   (194,50 sau 197,50), malul F-XIV și parametrii ERI ai profilului 4. Impactul asupra ofertei e mic.
3. **Metoda de execuție pe fiecare subtraversare**: studiul impune FOD doar la canal. Pentru celelalte 10, metoda vine din PT
   (769/771) și trebuie corelată cu F3 și cu riscurile din §3.1:
   - epuismente și tubaje în pietriș saturat cu bolovăniș;
   - derocare sau refuz la Negrea;
   - marne tari la Crișul Repede (ambele) și la canal;
   - lungime mare și maluri înalte la Tetchea;
   - apărări de mal și praguri de fund, recomandate peste tot;
   - protecție anticorozivă: apă puternic corozivă la Râciu și la canal.
4. **Decizia OCR**: recomandarea e „nu” (§5). Dacă totuși se vrea pe centralizatoare, ~0,16 USD, cu aprobarea ownerului.
5. **Planurile de situație**: cotele punctuale și codurile topo mărunte n-au fost preluate (nu se citesc sigur la 200 dpi).
   Dacă sunt necesare (de exemplu pentru lungimi de subtraversare), zonele se pot randa la ≥600 dpi. PDF-ul nu mai e pe NAS,
   deci trebuie descărcat din nou, doar pentru citire.

## 7. Urme și curățenie
- Trierea: `scratchpad/tri770_rezultat.json` și `scratchpad/tri770/triere.json` (sha256 66f3cdbd…), plus scripturile
  `tri_a.ts`, `tri_b.ts` și `randare.ts`.
- Randările: pe PC, în `C:\Users\Public\tri770\`: `l_*.png` (51), `s58\h*.png` și `s911\h*.png` (decupajele hi-res ale
  loturilor 2 și 3), `v_*.png` și `foaie1..6.png`. Pe NAS rămân doar `/seap-work/tri770/triere.json` și `foaie1..6.png`.
- Verificatorul a făcut doar SELECT-uri în BD. N-a creat nimic pe NAS. Pe PC a creat temporar scripturile `zv_*.py` și
  decupajele `zv_*.png`, iar la final le-a șters (0 rămase).
- Nicio scriere în BD sau Storage, niciun AI plătit, niciun mail, niciun commit.
