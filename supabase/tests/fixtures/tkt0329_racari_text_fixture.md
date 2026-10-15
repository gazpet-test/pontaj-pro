# TKT-0329 B — fixture din text, licitația 15 (Răcari, extindere gaze)

**Stare: FIXTURE DIN TEXT, NEVERIFICAT DE OM. Nu e golden.** L-am scos determinist din `text_extras` (export read-only din 15.10.2026), fără AI plătit și fără BD. Doc. 1624 (Răspuns consolidat nr. 2) a fost exclus, pentru că e oracolul de audit.

Fișier: `tkt0329_racari_text_fixture.json`. Conține:
- `f3_dn90` (16 obiecte, art. 003) și `f3_dn32` (art. 019): pentru fiecare, tokenul, offsetul, rândul [a,b), codul și denumirea, așa cum apar în text;
- `atr_dn90`: cele 16 rânduri din Anexa 1 la ATR (doc. 214, pag. 4–5);
- `cs_revizuit_dn90` (318), `cs_original_dn90` (198), `decizie_apm_dn90` (214, pag. 33–35): lungimile pe stradă;
- `totaluri`: toate mențiunile de „3.995” din CS, Fișă, Răspuns nr. 1, ATR și APM;
- `potrivire_f3_atr` și `observatii`.

**Offseturi**: exportul are pe prima linie `SET` (ecoul psql) și folosește CRLF. Offseturile sunt calculate pe textul normalizat (fără `SET`, cu LF, fără `\n` final); nu există caractere astrale. Înainte de orice folosire, comparați `sha256_text` cu sha256(text_extras) din BD. Toate cele 136 de offseturi au fost reverificate prin slice.

## F3 vs ATR (Dn 90, m)
| F3 obiect (deviz) | F3 | ATR nr / stradă | ATR | CS rev. | potrivire | egal |
|---|---|---|---|---|---|---|
| DE4198 str. DE 419/1 | 130 | 14 DE 491/1 | 198 | 138 | nesigură | nu |
| IOANAB Ioana Ivan | 1160 | 15 Prof. Ioana Ivan | 570 | 570 | probabilă | nu |
| ISL08 Islazului | 570 | 13 Islazului | 230 | 220 | probabilă | nu |
| MM108 Matei Marin | 570 | 12 Ec. Matei Marin | 330 | 330 | probabilă | nu |
| PAD08 Pădurii | 650 | 11 Pădurii | 650 | 650 | probabilă | **da** |
| TIN108 Tineretului | 570 | 10 Tineretului | 252 | 252 | exactă | nu |
| LOTOS Loturi | 500 | 2 Loturi | 245 | 245 | exactă | nu |
| ORAC8 Oraca | 50 | 1 Oraca | 52 | 52 | exactă | nu |
| AML8 Amadeo | 200 | 4 Amedeo Lazarescu | 125 | 125 | probabilă | nu |
| BPM8 DC43 | 240 | 3 Barbu Petre Marian (?) | 200 | 280 | nesigură | nu |
| DRUM8 Drumul Mare | 470 | 9 Drumul Mare | 415 | 415 | exactă | nu |
| IRAN8 Ion Razopol | 290 | 6 Inv. Ion Ranzopol | 143 | 143 | probabilă | nu |
| PADT08 Pădurea cu Tei | 90 | 8 Pădurea cu Tei | 90 | 143 | probabilă | **da** |
| PLAT8 Platanului | 120 | 7 Platanului | 120 | 90 | exactă | **da** |
| PRS8 Preot Stoicescu | 340 | 5 Stoicescu Vasile | 175 | 175 | probabilă | nu |
| SONDOS Aleea Sondelor | 450 | 16 Aleea Sondelor | 190 | 190 | exactă | nu |

Doar 3 din 16 valori coincid, deci afirmația din tichet se confirmă. Față de CS revizuit coincide numai Pădurii.

## Totaluri
- Suma F3 Dn 90: **6400 m**. Suma ATR luată naiv: **3985 m**. Suma pe străzi din CS revizuit și din decizia APM: **4018 m**.
- Total declarat: **3995 m**, în CS 198 (pag. 2 și 4), CS 318 (pag. 2 și 3), Fișa de date, Răspunsul nr. 1 (pag. 5), APM (pag. 33) și celula TOTAL din ATR (pag. 5).
- Niciuna dintre listele pe străzi nu dă 3995. Nu am corectat nimic.
- Dn 32 în F3: 10 m pe fiecare obiect. Am găsit 15 obiecte (150 m); Tineretului lipsește din text. CS/APM dau racorduri de 1–5,5 m pe stradă (în total aproximativ 42 m).

## De verificat în PDF
1. **ATR (doc. 214, pag. 4–5)**:
   - fiecare cifră; diferența de 10 m (3985 vs 3995) vine probabil dintr-o cifră citită greșit (de exemplu 198/230/120);
   - etichetele străzilor la rândurile 9–16: în text sunt decalate, iar străzile le-am dedus din ordinea CS;
   - Barbu Petre Marian: ATR 200, CS 280. Platanului: ATR 120, CS 90. Pădurea cu Tei: ATR 90, CS 143. Islazului: ATR 230, CS 220. DE 491/1: ATR 198, CS 138.
2. **F3, art. 003 pe fiecare listă** (d212 = PDF pag. 1–104, d213 = pag. 105–176; textul nu are markeri de pagină):
   - cantitatea și codul corect (SA11G1);
   - Ioana Ivan 1160 (dublu față de ATR);
   - Oraca: teava 50 m, dar materialul DN90 apare cu 9.000 m.
3. **Numele străzilor**:
   - DE **419**/1 în F3, DE **491**/1 în CS/APM;
   - DC43 (F3) nu apare în ATR/CS; trebuie confirmat dacă e Barbu Petre Marian;
   - Preot Stoicescu (F3) vs Stoicescu Vasile (ATR/CS);
   - Amadeo vs Amedeo Lazarescu; Ion Razopol vs Ion Ranzopol.
4. **Tineretului (TIN108)**: în text lipsesc art. 018–019 (pozițiile Dn 32). Lista are prețuri completate, deși documentul e „fără valori”.
5. **Pădurea cu Tei (PADT08)**: drenajul e 1.5 mc (la 90 m ar fi 13.5). În text, o parte din pagină apare dublată.
6. **CS original 198** are erori OCR: „6850,0m” la Pădurii (corect 650 în 318 și APM) și „DE APTI”. Folosiți CS 318.
