# R5 v2: reconcilierea cantităților din planșa 470 (lic. 95 Vâlcelele)

Stare: **doar propunere**. În BD s-au rulat numai SELECT-uri. Nu s-a modificat nici codul, nici datele. Data: 25.09.2026. Revizia 2: corecturile cerute de verificatorul rundei 1 (lista la final, „Jurnal de corecturi”).
Sursa: `ofertare_documente_atribuire.id=470`, `analiza->'citire_ai'`, versiunea `2026-09-25.5` (model claude-opus-5, tăiat la 16:45:36Z, 35/35 felii, `sumar.erori=0`, `zone_cazute=[]`, cost 2,595 USD). Transferul are `transfer.stare='facut'` la 16:51:08Z și `cantitati.adaugate=6`.
Citirea aceasta **înlocuiește** citirea analizată în v1 (`R5_RECONCILIERE_CANTITATI_470.md`: 152 de rânduri unice, z3_1 eșuată).

## Rezumat
- **Tabelul planșei are 133 de rânduri** (Nr crt 1–133), Σ **48.905 m** cu Nr 57 citit ca Dn63 (Q1). Sumarul din BD dă 48.195 m din cauza a două artefacte: −600 m Dn40 (Nr 40–41 pierdute la deduplicare) și −110 m (Nr 57 „Dn60”, exclus ca nestandard; `sumar.nestandard_m=110`).
- Față de 44.355 m (CS + memoriu), **diferența candidată este +4.440 … +4.560 m, nu +3.840** (§3). Limita de jos: Nr 40–41 = 2 × 300 m, Nr 57 exclus, Nr 38 = 320. Limita de sus: Nr 57 ca Dn63 și Nr 38 = 330. Nr 40–41, 38 și 57 sunt încă **de verificat pe imagine**.
- Nr 1–4 (în afara UAT Vâlcelele) însumează **13.765 m Dn200**. **Nicio combinație de rânduri Dn200 întregi nu dă 3.840 sau 4.550** (nici 4.440 sau 4.560) (Q6). Pe toate cele 133 de rânduri însă există combinații pentru fiecare dintre aceste cifre. De exemplu, 3.840 = Nr 3 + 8 + 13 (1.980 + 1.370 + 490), iar 4.550 = Nr 2 + 10 + 56 (4.080 + 340 + 130). Numărul total de submulțimi este ≈ 4,6 × 10²¹ pentru 3.840 și ≈ 4,2 × 10²³ pentru 4.550 (Q10). **O potrivire numerică între o sumă de rânduri și o diferență nu dovedește deci nimic.** Atribuirea diferenței tronsoanelor din afara UAT se respinge (§4).
- **BD contrazice măsura „în afara ofertei până la reconciliere”**: rândul 1751 (Dn200, 17.785 m) conține Nr 1–4 (Q5). SQL-ul propus (§7, pasul A) mută Nr 1–4 într-un rând separat, cu cantitate NULL și marcat „de confirmat prin #63”. Σ în ofertă scade de la 48.195 la 34.430. Creșterea Dn40 (+600 m) e **pasul B**, separat, care se rulează numai după validarea Oanei Nica. Nimic nu s-a aplicat.
- Verdict propus: **deschis**. Motivele: #63 are `status=de_trimis` și `raspuns=NULL` (Q8, recitit la 25.09); verificările pe imagine nu sunt făcute; SQL-ul așteaptă GO.

## 0. Constatări noi (față de v1 și de verdictul Copilot)
1. **Tabelul are 133 de rânduri, nu 131.** Reconstrucția din feliile pereche z?_6 (Nr crt, noduri, Sat) × z?_7 (Dn, Q, L) dă Nr crt 1–133. Sunt 133 de perechi de noduri distincte și 133 de noduri de sosire distincte: e o rețea arborescentă, fiecare rând e alt tronson. Între feliile suprapuse există 0 conflicte (Q1).
   `tronsoane_unice` are 131 de rânduri de tabel pentru că cheia de deduplicare (`handler.ts` l.215–228: `de_la|la|L|Dn|Q|zona`) nu include Nr crt și nodurile. Nici nu le poate include direct: tronsoanele cu lungime nu le au (vezi §6). Rândurile Nr 40 (34→59) și Nr 41 (34→60) sunt identice ca text cu Nr 37 (33→61): C-tin Brâncoveanu, Florența Albu→CT, Dn40, 300 m, Q20. Se pierd deci **600 m Dn40**.
2. **Totalul tabelului este 48.905 m** (cu Nr 57 ca Dn63 și Nr 38 = 320). Cifra de 48.195 m din BD se explică așa: 48.195 = 48.905 − 600 (dedup Nr 40–41) − 110 (Nr 57 „Dn60”, nestandard). Față de 44.355, **diferența candidată este +4.440 … +4.560** (intervalul din §3), nu +3.840. Limita de jos presupune Nr 40–41 = 2 × 300 m, încă nevalidate pe imagine.
3. **Rândurile din afara UAT (Nr 1–4) însumează 13.765 m Dn200** și nu explică 3.840 (secțiunea 4).
4. **Rândul `ofertare_cantitati` id 1751 (Dn200, 17.785 m, status `extras`) include deja Nr 1–4.** Asta contrazice măsura temporară „în afara ofertei până la reconciliere” (Q5, recitit la 25.09). Corectarea e pasul A din §7.
5. Ce s-a rezolvat față de v1:
   - Adnotarea de 1.370 m se citește acum **Dn200** (idx 120, z3_2), la fel ca Nr 8. Dn250 a dispărut.
   - Dn43 a dispărut.
   - Apar diametre absente din tabel: Dn48 (idx 89, 113) și Dn56 (idx 193). Nu sunt numărate.

Numerotare: **Nr** = Nr crt din tabelul planșei. **#n** = numărul folosit în `sumar.avertismente`/`posibile_dubluri` (indexul între rândurile de tabel + 1). Corespondența: Nr = #n pentru n ≤ 39 și Nr = #n + 2 pentru n ≥ 40. **idx** = indexul (de la 0) în `tronsoane_unice`.
Material: `material = null` pe toate rândurile. Legenda din felia z1_1 (`alte_mentiuni`) spune „Retea GN_MP PEHD PE 100 SDR 11 (linie verde)”. Informația nu se aplică automat pe rând.

## 1. Lista completă a tronsoanelor
### 1.1 Rândurile din tabel (133). Sursa: tabelul „Dimensionare” + „Tronson retea de distributie (continuare)”
Categorii: **A** = în afara UAT Vâlcelele · **B** = trunchi Dn200 în UAT Vâlcelele · **C** = racorduri SRS · **D** = rețeaua satului Vâlcelele · **E** = rețeaua satului Floroaica. Coloana „pd” = câte avertismente `posibila_dublura` indică rândul.

| Nr | noduri | cat | Sat | Strada | De la → Până la | Dn | L (m) | Q | felii | #sumar | pd |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0→1 | A | UAT Stefan Voda | UAT Stefan Voda | SRMP → UAT Cuza Voda-Limita | 200 | 5485 | 7500 | z1_7 | #1 |  |
| 2 | 1→2 | A | UAT Cuza Voda | UAT Cuza Voda | UAT Cuza Voda-Limita → UAT Gradistea-Limita | 200 | 4080 | 7500 | z1_7 | #2 |  |
| 3 | 2→3 | A | UAT Gradistea | UAT Gradistea | UAT Gradistea-Limita → UAT Independenta-Limita | 200 | 1980 | 7500 | z1_7 | #3 |  |
| 4 | 3→4 | A | UAT Independenta | UAT Independenta | UAT Independenta-Limita → UAT Valcelele-Limita | 200 | 2220 | 7500 | z1_7 | #4 |  |
| 5 | 4→5 | B | UAT Valcelele | UAT Valcelele | UAT Valcelele-Limita → Limita Intravilan | 200 | 600 | 5000 | z1_7 | #5 |  |
| 6 | 5→6 | B | Floroaica | Intravilan sat Floroaica | Limita intravilan → Ramif. SRS 1 Valcelele - sat Floroaica | 200 | 1400 | 5000 | z1_7 | #6 | 2 |
| 7 | 6→6' | B | Floroaica | Intravilan sat Floroaica | Ramif. SRS 1 Valcelele - sat Floroaica → Limita extravilan | 200 | 650 | 4500 | z1_7 | #7 | 1 |
| 8 | 6'→7 | B | UAT Valcelele | UAT Valcelele | Limita extravilan → Ramif. Alimentare Dragos Voda | 200 | 1370 | 4500 | z1_7 | #8 | 1 |
| 9 | 7→8 | C | UAT Valcelele | UAT Valcelele | Ramif. Alimentare Dragos Voda → Limita intravilan Valcelele | 90 | 1000 | 1000 | z1_7 | #9 | 2 |
| 10 | 8→9 | C | Valcelele | Intravilan Valcelele | Limita intravilan Valcelele → SRS 2 Valcelele | 90 | 340 | 1000 | z1_7 | #10 | 2 |
| 11 | 9→9' | D | Valcelele | Calarasilor | SRS 2 Valcelele → Libertatii | 125 | 15 | 1000 | z1_7 | #11 | 3 |
| 12 | 9'→10 | D | Valcelele | Calarasilor | Libertatii → Soseaua de centura | 125 | 150 | 840 | z1_7 | #12 |  |
| 13 | 10→11 | D | Valcelele | Calarasilor | Soseaua de centura → C-tin Brancusi | 125 | 490 | 690 | z1_7 | #13 | 1 |
| 14 | 11→12 | D | Valcelele | C-tin Brancusi | Calarasilor → FN | 125 | 90 | 590 | z1_7 | #14 |  |
| 15 | 12→13 | D | Valcelele | C-tin Brancusi | FN → Florenta Albu | 125 | 540 | 580 | z1_7 | #15 | 1 |
| 16 | 13→14 | D | Valcelele | C-tin Brancusi | Florenta Albu → CT | 125 | 300 | 20 | z1_7 | #16 | 2 |
| 17 | 13→15 | D | Valcelele | Florenta Albu | C-tin Brancusi → Sf Dimitrie | 110 | 110 | 260 | z1_7 | #17 | 4 |
| 18 | 15→16 | D | Valcelele | Florenta Albu | Sf Dimitrie → Calarasilor | 110 | 110 | 210 | z1_7 | #18 |  |
| 19 | 15→31 | D | Valcelele | Sf Dimitrie | Florenta Albu → CT | 40 | 300 | 20 | z1_7 | #19 |  |
| 20 | 15→32 | D | Valcelele | Sf Dimitrie | Florenta Albu → CT | 40 | 450 | 30 | z1_7 | #20 | 1 |
| 21 | 16→17 | D | Valcelele | Florenta Albu | Calarasilor → Spiru Haret | 110 | 110 | 160 | z1_7 | #21 |  |
| 22 | 16→29 | D | Valcelele | Calarasilor | Florenta Albu → CT | 40 | 300 | 20 | z1_7 | #22 |  |
| 23 | 16→30 | D | Valcelele | Calarasilor | Florenta Albu → CT | 40 | 460 | 30 | z1_7 | #23 | 1 |
| 24 | 17→18 | D | Valcelele | Florenta Albu | Spiru Haret → Mihai Eminescu | 90 | 110 | 110 | z1_7 | #24 |  |
| 25 | 17→27 | D | Valcelele | Spiru Haret | Florenta Albu → CT | 40 | 300 | 20 | z1_7 | #25 |  |
| 26 | 17→28 | D | Valcelele | Spiru Haret | Florenta Albu → CT | 40 | 460 | 30 | z1_7 | #26 |  |
| 27 | 18→19 | D | Valcelele | Florenta Albu | Mihai Eminescu → Nicolae Titulescu | 90 | 110 | 60 | z1_7 | #27 |  |
| 28 | 18→25 | D | Valcelele | Mihai Eminescu | Florenta Albu → CT | 40 | 300 | 20 | z1_7 | #28 |  |
| 29 | 18→26 | D | Valcelele | Mihai Eminescu | Florenta Albu → CT | 40 | 430 | 30 | z1_7 | #29 |  |
| 30 | 19→20 | D | Valcelele | Florenta Albu | Nicolae Titulescu → Baraganului | 63 | 110 | 20 | z1_7 | #30 |  |
| 31 | 19→23 | D | Valcelele | Nicolae Titulescu | Florenta Albu → CT | 40 | 300 | 20 | z1_7 | #31 |  |
| 32 | 19→24 | D | Valcelele | Nicolae Titulescu | Florenta Albu → CT | 40 | 330 | 20 | z1_7+z2_7 | #32 |  |
| 33 | 20→21 | D | Valcelele | Baraganului | Florenta Albu → CT | 40 | 150 | 10 | z1_7+z2_7 | #33 |  |
| 34 | 20→22 | D | Valcelele | Baraganului | Florenta Albu → CT | 40 | 200 | 10 | z1_7+z2_7 | #34 | 3 |
| 35 | 13→33 | D | Valcelele | Florenta Albu | C-tin Brancusi → Aurel Vlaicu | 110 | 110 | 280 | z1_7+z2_7 | #35 |  |
| 36 | 33→34 | D | Valcelele | Florenta Albu | Aurel Vlaicu → C-tin Brancoveanu | 110 | 110 | 240 | z1_7+z2_7 | #36 |  |
| 37 | 33→61 | D | Valcelele | C-tin Brancoveanu | Florenta Albu → CT | 40 | 300 | 20 | z1_7+z2_7 | #37 |  |
| 38 | 33→62 | D | Valcelele | C-tin Brancoveanu | Florenta Albu → CT | 40 | **320** | 20 | z2_7 | #38 |  |
| 39 | 34→35 | D | Valcelele | Florenta Albu | C-tin Brancoveanu → Cuza Voda | 110 | 110 | 200 | z2_7 | #39 |  |
| 40 | 34→59 | D | Valcelele | C-tin Brancoveanu | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | **— (dedup)** |  |
| 41 | 34→60 | D | Valcelele | C-tin Brancoveanu | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | **— (dedup)** |  |
| 42 | 35→36 | D | Valcelele | Florenta Albu | Cuza Voda → Mihai Viteazu | 90 | 110 | 160 | z2_7 | #40 |  |
| 43 | 35→57 | D | Valcelele | Cuza Voda | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | #41 |  |
| 44 | 35→58 | D | Valcelele | Cuza Voda | Florenta Albu → CT | 40 | 200 | 20 | z2_7 | #42 |  |
| 45 | 36→37 | D | Valcelele | Florenta Albu | Mihai Viteazu → Vlad Tepes | 90 | 110 | 120 | z2_7 | #43 |  |
| 46 | 36→55 | D | Valcelele | Mihai Viteazu | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | #44 |  |
| 47 | 36→56 | D | Valcelele | Mihai Viteazu | Florenta Albu → CT | 40 | 200 | 20 | z2_7 | #45 |  |
| 48 | 37→38 | D | Valcelele | Florenta Albu | Vlad Tepes → Mircea cel Batran | 90 | 110 | 100 | z2_7 | #46 |  |
| 49 | 37→53 | D | Valcelele | Vlad Tepes | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | #47 |  |
| 50 | 37→54 | D | Valcelele | Vlad Tepes | Florenta Albu → CT | 40 | 220 | 20 | z2_7 | #48 | 3 |
| 51 | 38→39 | D | Valcelele | Florenta Albu | Mircea cel Batran → Liliacului | 63 | 110 | 80 | z2_7 | #49 |  |
| 52 | 38→51 | D | Valcelele | Mircea cel Batran | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | #50 |  |
| 53 | 38→52 | D | Valcelele | Mircea cel Batran | Florenta Albu → CT | 40 | 200 | 10 | z2_7 | #51 |  |
| 54 | 39→40 | D | Valcelele | Florenta Albu | Liliacului → Crinului | 63 | 110 | 60 | z2_7 | #52 |  |
| 55 | 39→49 | D | Valcelele | Liliacului | Florenta Albu → CT | 40 | 300 | 20 | z2_7 | #53 |  |
| 56 | 39→50 | D | Valcelele | Liliacului | Florenta Albu → CT | 40 | 130 | 10 | z2_7 | #54 | 5 |
| 57 | 40→41 | D | Valcelele | Florenta Albu | Crinului → Rozelor | **60** | 110 | 40 | z2_7 | #55 |  |
| 58 | 40→47 | D | Valcelele | Crinului | Florenta Albu → CT | 40 | 280 | 20 | z2_7 | #56 | 1 |
| 59 | 40→48 | D | Valcelele | Crinului | Florenta Albu → CT | 40 | 130 | 10 | z2_7 | #57 |  |
| 60 | 41→42 | D | Valcelele | Florenta Albu | Rozelor → Macului | 63 | 110 | 20 | z2_7 | #58 |  |
| 61 | 41→45 | D | Valcelele | Rozelor | Florenta Albu → CT | 40 | 280 | 20 | z2_7 | #59 |  |
| 62 | 41→46 | D | Valcelele | Rozelor | Florenta Albu → CT | 40 | 100 | 5 | z2_7 | #60 | 1 |
| 63 | 42→43 | D | Valcelele | Florenta Albu | Macului → CT | 40 | 30 | 5 | z2_7 | #61 |  |
| 64 | 42→44 | D | Valcelele | Macului | Macului → CT | 40 | 280 | 5 | z2_7 | #62 |  |
| 65 | 10→80 | D | Valcelele | Soseaia de centura | Calarasilor → Aurel Vlaicu | 90 | 130 | 150 | z2_7 | #63 |  |
| 66 | 80→81 | D | Valcelele | Soseaia de centura | Aurel Vlaicu → C-tin Brancoveanu | 90 | 130 | 120 | z2_7 | #64 |  |
| 67 | 80→93 | D | Valcelele | Aurel Vlaicu | Soseaia de centura → FN | 63 | 550 | 30 | z2_7 | #65 |  |
| 68 | 93→94 | D | Valcelele | Aurel Vlaicu | FN → CT | 40 | 130 | 10 | z2_7 | #66 |  |
| 69 | 81→82 | D | Valcelele | Soseaia de centura | C-tin Brancoveanu → Cuza Voda | 63 | 130 | 90 | z2_7 | #67 |  |
| 70 | 81→91 | D | Valcelele | C-tin Brancoveanu | Soseaia de centura → DS 1981 | 63 | 550 | 30 | z2_7 | #68 |  |
| 71 | 91→92 | D | Valcelele | C-tin Brancoveanu | FN → CT | 40 | 130 | 10 | z2_7 | #69 |  |
| 72 | 82→83 | D | Valcelele | Soseaia de centura | Cuza Voda → Mihai Viteazu | 63 | 130 | 60 | z2_7 | #70 |  |
| 73 | 82→89 | D | Valcelele | Cuza Voda | Soseaia de centura → FN | 63 | 510 | 30 | z2_7 | #71 |  |
| 74 | 89→90 | D | Valcelele | Cuza Voda | FN → CT | 40 | 220 | 10 | z2_7 | #72 |  |
| 75 | 83→84 | D | Valcelele | Soseaia de centura | Mihai Viteazu → Vlad Tepes | 63 | 130 | 30 | z2_7 | #73 |  |
| 76 | 83→87 | D | Valcelele | Mihai Viteazu | Soseaia de centura → FN | 63 | 600 | 30 | z2_7 | #74 |  |
| 77 | 87→88 | D | Valcelele | Mihai Viteazu | FN → CT | 40 | 120 | 10 | z2_7 | #75 | 5 |
| 78 | 84→85 | D | Valcelele | Vlad Tepes | Soseaia de centura → FN | 63 | 580 | 30 | z2_7+z3_7 | #76 |  |
| 79 | 85→86 | D | Valcelele | Vlad Tepes | FN → CT | 40 | 90 | 10 | z2_7+z3_7 | #77 |  |
| 80 | 9'→63 | D | Valcelele | Libertatii | Calarasilor → Sf Dimitrie | 90 | 60 | 160 | z2_7+z3_7 | #78 |  |
| 81 | 63→64 | D | Valcelele | Libertatii | Sf Dimitrie → I.L. Caragiale | 90 | 120 | 130 | z2_7+z3_7 | #79 |  |
| 82 | 63→78 | D | Valcelele | Sf Dimitrie | Libertatii → Calarasilor | 63 | 640 | 30 | z2_7+z3_7 | #80 | 3 |
| 83 | 78→79 | D | Valcelele | Sf Dimitrie | Calarasilor → CT | 40 | 100 | 5 | z2_7+z3_7 | #81 |  |
| 84 | 64→65 | D | Valcelele | Libertatii | I.L. Caragiale → Spiru Haret | 90 | 120 | 100 | z3_7 | #82 |  |
| 85 | 64→76 | D | Valcelele | I.L. Caragiale | Libertatii → Calarasilor | 63 | 640 | 30 | z3_7 | #83 |  |
| 86 | 76→77 | D | Valcelele | I.L. Caragiale | Calarasilor → CT | 40 | 100 | 5 | z3_7 | #84 |  |
| 87 | 65→66 | D | Valcelele | Libertatii | Spiru Haret → Mihai Eminescu | 63 | 120 | 70 | z3_7 | #85 |  |
| 88 | 65→74 | D | Valcelele | Spiru Haret | Libertatii → Calarasilor | 63 | 640 | 30 | z3_7 | #86 |  |
| 89 | 74→75 | D | Valcelele | Spiru Haret | Calarasilor → CT | 40 | 100 | 5 | z3_7 | #87 |  |
| 90 | 66→67 | D | Valcelele | Libertatii | Mihai Eminescu → Nicolae Titulescu | 63 | 120 | 40 | z3_7 | #88 |  |
| 91 | 66→72 | D | Valcelele | Mihai Eminescu | Libertatii → Calarasilor | 63 | 640 | 30 | z3_7 | #89 |  |
| 92 | 72→73 | D | Valcelele | Mihai Eminescu | Calarasilor → CT | 40 | 100 | 5 | z3_7 | #90 |  |
| 93 | 67→68 | D | Valcelele | Libertatii | Nicolae Titulescu → Baraganului | 63 | 120 | 10 | z3_7 | #91 |  |
| 94 | 67→70 | D | Valcelele | Nicolae Titulescu | Libertatii → Calarasilor | 63 | 630 | 30 | z3_7 | #92 |  |
| 95 | 70→71 | D | Valcelele | Nicolae Titulescu | Calarasilor → CT | 40 | 200 | 5 | z3_7 | #93 |  |
| 96 | 68→69 | D | Valcelele | Baraganului | Libertatii → CT | 40 | 620 | 10 | z3_7 | #94 |  |
| 97 | 6→95 | C | Floroaica | Stejarului | Marin Preda → SRS 1 | 90 | 5 | 500 | z3_7 | #95 |  |
| 98 | 95→96 | E | Floroaica | Stejarului | SRS 1 → Mihail Sadoveanu | 125 | 110 | 500 | z3_7 | #96 |  |
| 99 | 96→97 | E | Floroaica | Mihail Sadoveanu | Stejarului → Crizantemelor | 125 | 140 | 470 | z3_7 | #97 |  |
| 100 | 97→98 | E | Floroaica | Crizantemelor | Mihail Sadoveanu → Ion Creanga | 125 | 110 | 420 | z3_7 | #98 |  |
| 101 | 98→99 | E | Floroaica | Crizantemelor | Ion Creanga → Stefan Cel Mare | 125 | 110 | 350 | z3_7 | #99 |  |
| 102 | 99→100 | E | Floroaica | Crizantemelor | Stefan Cel Mare → George Cosbuc | 125 | 110 | 300 | z3_7 | #100 |  |
| 103 | 100→101 | E | Floroaica | Crizantemelor | George Cosbuc → DJ 306 | 125 | 110 | 250 | z3_7 | #101 |  |
| 104 | 101→102 | E | Floroaica | Crizantemelor | DJ 306 → Mihail Kogalniceanu | 110 | 120 | 150 | z3_7 | #102 |  |
| 105 | 102→103 | E | Floroaica | Crizantemelor | Mihail Kogalniceanu → FN (Drum agricol) | 90 | 110 | 50 | z3_7 | #103 |  |
| 106 | 103→104 | E | Floroaica | FN (Drum agricol) | Crizantemelor → CT | 40 | 110 | 10 | z3_7 | #104 |  |
| 107 | 103→105 | E | Floroaica | FN (Drum agricol) | Crizantemelor → Sf Mihail si Gavril | 63 | 230 | 20 | z3_7 | #105 | 2 |
| 108 | 105→106 | E | Floroaica | FN (Drum agricol) | Sf Mihail si Gavril → Teiului | 40 | 270 | 10 | z3_7 | #106 | 4 |
| 109 | 105→107 | E | Floroaica | Sf Mihail si Gavril | FN (Drum agricol) → CT | 40 | 100 | 5 | z3_7 | #107 |  |
| 110 | 96→108 | E | Floroaica | Mihail Sadoveanu | Stejarului → Crangului | 40 | 260 | 20 | z3_7 | #108 |  |
| 111 | 97→109 | E | Floroaica | Mihail Sadoveanu | Crizantemelor → Sf Mihail si Gavril | 63 | 270 | 40 | z3_7 | #109 |  |
| 112 | 109→110 | E | Floroaica | Mihail Sadoveanu | Sf Mihail si Gavril → Teiului | 40 | 370 | 20 | z3_7 | #110 |  |
| 113 | 98→111 | E | Floroaica | Ion Creanga | Crizantemelor → Salcamului | 63 | 260 | 30 | z3_7 | #111 |  |
| 114 | 111→112 | E | Floroaica | Ion Creanga | Salcamului → DJ 306 | 40 | 260 | 10 | z3_7 | #112 |  |
| 115 | 98→113 | E | Floroaica | Ion Creanga | Crizantemelor → Sf Mihail si Gavril | 63 | 270 | 40 | z3_7 | #113 |  |
| 116 | 113→114 | E | Floroaica | Ion Creanga | Sf Mihail si Gavril → Caisului | 40 | 370 | 20 | z3_7 | #114 |  |
| 117 | 99'→115 | E | Floroaica | Stefan Cel Mare | Crizantemelor → Salcamului | 63 | 260 | 30 | z3_7 | #115 |  |
| 118 | 115→116 | E | Floroaica | Stefan Cel Mare | Salcamului → DJ 306 | 40 | 180 | 10 | z3_7 | #116 | 2 |
| 119 | 99→117 | E | Floroaica | Stefan Cel Mare | Crizantemelor → Sf Mihail si Gavril | 90 | 270 | 50 | z3_7 | #117 |  |
| 120 | 117→118 | E | Floroaica | Stefan Cel Mare | Sf Mihail si Gavril → Teiului | 63 | 270 | 30 | z3_7 | #118 |  |
| 121 | 118→119 | E | Floroaica | Stefan Cel Mare | Teiului → Caisului | 40 | 180 | 10 | z3_7 | #119 |  |
| 122 | 100→120 | E | Floroaica | George Cosbuc | Crizantemelor → Stejarului | 63 | 130 | 30 | z3_7 | #120 |  |
| 123 | 120→121 | E | Floroaica | George Cosbuc | Stejarului → DJ 306 | 40 | 220 | 20 | z3_7+z4_7 | #121 |  |
| 124 | 100→122 | E | Floroaica | George Cosbuc | Crizantemelor → Sf Mihail si Gavril | 90 | 270 | 50 | z3_7+z4_7 | #122 |  |
| 125 | 122→123 | E | Floroaica | George Cosbuc | Sf Mihail si Gavril → Teiului | 63 | 270 | 30 | z3_7+z4_7 | #123 |  |
| 126 | 123→124 | E | Floroaica | George Cosbuc | Teiului → Caisului | 40 | 280 | 10 | z3_7+z4_7 | #124 |  |
| 127 | 101→125 | E | Floroaica | DJ 306 | Crizantemelor → Ion Creanga | 90 | 760 | 40 | z3_7+z4_7 | #125 | 1 |
| 128 | 101→126 | E | Floroaica | DJ 306 | Crizantemelor → Trandafirului | 90 | 410 | 60 | z3_7+z4_7 | #126 | 1 |
| 129 | 126→127 | E | Floroaica | DJ 306 | Trandafirului → Panduri | 63 | 270 | 40 | z3_7+z4_7 | #127 |  |
| 130 | 127→128 | E | Floroaica | DJ 306 | Panduri → Caisului | 40 | 220 | 10 | z4_7 | #128 |  |
| 131 | 102→129 | E | Floroaica | Mihail Kogalniceanu | Crizantemelor → Sf Mihail si Gavril | 90 | 270 | 50 | z4_7 | #129 |  |
| 132 | 129→130 | E | Floroaica | Mihail Kogalniceanu | Sf Mihail si Gavril → Teiului | 63 | 270 | 30 | z4_7 | #130 |  |
| 133 | 130→131 | E | Floroaica | Mihail Kogalniceanu | Teiului → CT | 40 | 260 | 10 | z4_7 | #131 |  |

Observații de citire. Toate sunt NEVALIDATE și trebuie verificate pe imaginea planșei:
- **Nr 38**: z2_7 citește rândul întreg ca 0,320. Rândul e tăiat la marginea feliei z1_7, iar `alte_mentiuni` spune „rand taiat: C-tin Brancoveanu - Florenta Albu - CT, 40, 20, 0,330”. Diferența posibilă este ±10 m.
- **Nr 57**: Dn60 e nestandard. Debitul (Q40) e în coloana lui, iar vecinii de pe Florența Albu sunt Dn63 (Nr 51 cu Q80, Nr 54 cu Q60, Nr 60 cu Q20). Propunerea Dn63 (+110 m) rămâne nevalidată.
- **Nr 37/38**: pleacă din nodul 33 (Florența Albu × Aurel Vlaicu, conform Nr 35–36), dar strada citită e „C-tin Brancoveanu”. Tiparul nodurilor sugerează Aurel Vlaicu. Asta afectează doar denumirea, nu lungimea.
- **Nr 40/41**: sunt rânduri distincte după Nr crt și noduri (59 și 60). Merită verificat pe imagine că lungimile sunt într-adevăr 300 + 300.

### 1.2 Adnotările de pe plan (75). NU intră în total
Sursa: `tronsoane_unice` cu `sursa≠'tabel'`. Sunt 36 în z3_1 (11.427 m), 22 în z3_2 (17.291 m) și 17 în z4_2 (6.014 m); Σ 34.732 m = `sumar.adnotari_neconfirmate_m` (Q3).
Coloana „primul rând ±1%” aplică regula codului (`handler.ts` l.459): primul rând de tabel cu lungime ±1%, **indiferent de Dn**, căutat în `tronsoane_unice`, adică în cele 131 de rânduri de tabel pe care le vede codul. Ultima coloană numără rândurile cu același Dn și ±1% **pe tabelul complet, de 133 de rânduri**. Între cele două baze diferă doar idx 81 și 83: pe tabelul complet valoarea e 13 (Nr 19, 22, 25, 28, 31, 37, 40, 41, 43, 46, 49, 52, 55), iar pe `tronsoane_unice` e 11, fără Nr 40–41. Celelalte 73 de valori sunt identice pe ambele baze (Q1b).

| idx | felie | zona | noduri | Dn | L | Q | primul rând ±1% (131, regula codului) | același Dn ±1% (133) |
|---|---|---|---|---|---|---|---|---|
| 81 | z3_1 | sat Valcelele | Nod 18 → 25 | 40 | 303 | — | Nr 16 (Dn125 300) | **13** (11 pe 131) |
| 82 | z3_1 | sat Valcelele | Nod 16 → 24 | 40 | 308 | — | — | 0 |
| 83 | z3_1 | sat Valcelele | Nod 17 → 23 | 40 | 300 | — | Nr 16 (Dn125 300) | **13** (11 pe 131) |
| 84 | z3_1 | sat Valcelele | Nod 19 → 21 | 40 | 198 | — | Nr 34 (Dn40 200) | 5 |
| 85 | z3_1 | sat Valcelele | Nod 18 → 26 | 40 | 230 | 30 | Nr 107 (Dn63 230) | 0 |
| 86 | z3_1 | sat Valcelele | Nod 18 → A | 40 | 200 | — | Nr 34 (Dn40 200) | 5 |
| 87 | z3_1 | sat Valcelele | Nod 20 → 21 | 40 | 200 | — | Nr 34 (Dn40 200) | 5 |
| 88 | z3_1 | sat Valcelele | Nod 15 → 22 | 40 | 450 | — | Nr 20 (Dn40 450) | 1 |
| 89 | z3_1 | sat Valcelele | Nod 11 → 22 | **48** (absent din tabel) | 480 | — | — | 0 |
| 90 | z3_1 | sat Valcelele | Nod 19 → 20 | 40 | 100 | — | Nr 62 (Dn40 100) | 6 |
| 91 | z3_1 | sat Valcelele | Nod 13 → 21 | 40 | 400 | — | — | 0 |
| 92 | z3_1 | sat Valcelele | Nod 10 → 13 | 125 | 640 | — | Nr 82 (Dn63 640) | 0 |
| 93 | z3_1 | sat Valcelele | Nod 10 → 11 | 125 | 490 | — | Nr 13 (Dn125 490) | 1 |
| 94 | z3_1 | sat Valcelele | Nod 12 → — | 125 | 266 | — | — | 0 |
| 95 | z3_1 | sat Valcelele | Nod 12 → 13 | 40 | 180 | — | Nr 118 (Dn40 180) | 2 |
| 96 | z3_1 | sat Valcelele | Nod 61 → 80 | 63 | 640 | — | Nr 82 (Dn63 640) | 4 |
| 97 | z3_1 | sat Valcelele | Nod 60 → 61 | 63 | 350 | — | — | 0 |
| 98 | z3_1 | sat Valcelele | Nod 80 → — | 63 | 130 | — | Nr 56 (Dn40 130) | 4 |
| 99 | z3_1 | sat Valcelele | Nod 61 → — | 90 | 130 | — | Nr 56 (Dn40 130) | 2 |
| 100 | z3_1 | sat Valcelele | Nod 59 → — | 63 | 130 | — | Nr 56 (Dn40 130) | 4 |
| 101 | z3_1 | sat Valcelele | Nod 63 → — | 63 | 215 | — | — | 0 |
| 102 | z3_1 | sat Valcelele | Nod 55 → 63 | 63 | 646 | — | Nr 7 (Dn200 650) | 4 |
| 103 | z3_1 | sat Valcelele | Nod 54 → 63 | 125 | 13 | — | — | 0 |
| 104 | z3_1 | sat Valcelele | Nod 63 → — | 63 | 15 | — | Nr 11 (Dn125 15) | 0 |
| 105 | z3_1 | sat Valcelele | Nod 84 → 63 | 63 | 13 | — | — | 0 |
| 106 | z3_1 | sat Valcelele | Nod 56 → 62 | 63 | 15 | — | Nr 11 (Dn125 15) | 0 |
| 107 | z3_1 | sat Valcelele | Nod 66 → — | 63 | 120 | — | Nr 77 (Dn40 120) | 3 |
| 108 | z3_1 | sat Valcelele | Nod 64 → — | 63 | 120 | — | Nr 77 (Dn40 120) | 3 |
| 109 | z3_1 | sat Valcelele | Nod 65 → — | 63 | 15 | — | Nr 11 (Dn125 15) | 0 |
| 110 | z3_1 | sat Valcelele | Nod 68 → 74 | 63 | 640 | — | Nr 82 (Dn63 640) | 4 |
| 111 | z3_1 | sat Valcelele | Nod 68 → 72 | 63 | 540 | — | Nr 15 (Dn125 540) | 0 |
| 112 | z3_1 | sat Valcelele | Nod 67 → — | 63 | 830 | — | — | 0 |
| 113 | z3_1 | sat Valcelele | Nod 69 → — | **48** (absent din tabel) | 880 | 19 | — | 0 |
| 114 | z3_1 | sat Valcelele | Nod 71 → — | 63 | 120 | — | Nr 77 (Dn40 120) | 3 |
| 115 | z3_1 | sat Valcelele | Nod 55 → — | 63 | 120 | — | Nr 77 (Dn40 120) | 3 |
| 116 | z3_1 | sat Valcelele | Nod 91 → — | 90 | 1000 | — | Nr 9 (Dn90 1000) | 1 |
| 117 | z3_2 | Valcelele | — | 90 | 340 | 1000 | Nr 10 (Dn90 340) | 1 |
| 118 | z3_2 | Valcelele | — | 90 | 1000 | 1000 | Nr 9 (Dn90 1000) | 1 |
| 119 | z3_2 | Valcelele | — | 90 | 1080 | 1000 | — | 0 |
| 120 | z3_2 | Valcelele | — | 200 | 1370 | — | Nr 8 (Dn200 1370) | 1 |
| 121 | z3_2 | Floroaica | — | 200 | 856 | 500 | — | 0 |
| 122 | z3_2 | Floroaica | — | 200 | 850 | 500 | — | 0 |
| 123 | z3_2 | Floroaica | — | 63 | 1400 | — | Nr 6 (Dn200 1400) | 0 |
| 124 | z3_2 | Floroaica | — | 125 | 2350 | — | — | 0 |
| 125 | z3_2 | Floroaica | — | 90 | 5005 | — | — | 0 |
| 126 | z3_2 | Floroaica | — | 63 | 169 | — | — | 0 |
| 127 | z3_2 | Floroaica | — | 63 | 280 | — | Nr 58 (Dn40 280) | 0 |
| 128 | z3_2 | Floroaica | — | 63 | 230 | — | Nr 107 (Dn63 230) | 1 |
| 129 | z3_2 | Floroaica | — | 63 | 110 | — | Nr 17 (Dn110 110) | 4 |
| 130 | z3_2 | Floroaica | — | 90 | 766 | — | Nr 127 (Dn90 760) | 1 |
| 131 | z3_2 | Floroaica | — | 63 | 12 | — | — | 0 |
| 132 | z3_2 | Floroaica | — | 63 | 270 | — | Nr 108 (Dn40 270) | 6 |
| 133 | z3_2 | Floroaica | — | 125 | 133 | — | — | 0 |
| 134 | z3_2 | Floroaica | — | 125 | 110 | — | Nr 17 (Dn110 110) | 5 |
| 135 | z3_2 | Floroaica | — | 125 | 130 | — | Nr 56 (Dn40 130) | 0 |
| 136 | z3_2 | Floroaica | — | 110 | 340 | — | Nr 10 (Dn90 340) | 0 |
| 137 | z3_2 | Floroaica | — | 90 | 270 | — | Nr 108 (Dn40 270) | 3 |
| 138 | z3_2 | Floroaica | — | 63 | 220 | — | Nr 50 (Dn40 220) | 0 |
| 185 | z4_2 | Floroaica | — | 40 | 110 | — | Nr 17 (Dn110 110) | 1 |
| 186 | z4_2 | Floroaica | — | 40 | 270 | — | Nr 108 (Dn40 270) | 1 |
| 187 | z4_2 | Floroaica | — | 40 | 275 | — | — | 0 |
| 188 | z4_2 | Floroaica | — | 110 | 120 | — | Nr 77 (Dn40 120) | 1 |
| 189 | z4_2 | Floroaica | — | 90 | 110 | — | Nr 17 (Dn110 110) | 6 |
| 190 | z4_2 | Floroaica | — | 63 | 275 | — | — | 0 |
| 191 | z4_2 | Floroaica | — | 40 | 130 | — | Nr 56 (Dn40 130) | 4 |
| 192 | z4_2 | Floroaica | — | 40 | 272 | — | Nr 108 (Dn40 270) | 1 |
| 193 | z4_2 | Floroaica | — | **56** (absent din tabel) | 410 | — | Nr 128 (Dn90 410) | 0 |
| 194 | z4_2 | Floroaica | — | 90 | 456 | — | Nr 23 (Dn40 460) | 0 |
| 195 | z4_2 | Floroaica | — | 63 | 180 | — | Nr 118 (Dn40 180) | 0 |
| 196 | z4_2 | Floroaica | — | 40 | 266 | — | — | 0 |
| 197 | z4_2 | Floroaica | — | 40 | 220 | — | Nr 50 (Dn40 220) | 4 |
| 198 | z4_2 | Floroaica | — | 40 | 1400 | — | Nr 6 (Dn200 1400) | 0 |
| 199 | z4_2 | Floroaica | — | 200 | 500 | — | — | 0 |
| 200 | z4_2 | Floroaica | — | 200 | 800 | — | — | 0 |
| 201 | z4_2 | Floroaica | — | 200 | 220 | — | Nr 50 (Dn40 220) | 0 |

Adnotările din z3_1 poartă numere de nod, dar se potrivesc exact cu tabelul (aceeași pereche de noduri + Dn + L) doar în 2 cazuri: idx 81 ↔ Nr 28 (18→25, Dn40, 300/303) și idx 93 ↔ Nr 13 (10→11, Dn125, 490). În alte 4 cazuri perechea de noduri coincide, dar Dn sau L diferă: idx 85 ↔ Nr 29, idx 87 ↔ Nr 33, idx 90 ↔ Nr 30, idx 95 ↔ Nr 15. Numerele de nod de pe adnotări nu sunt deci o cheie de încredere (Q4).

## 2. Însumarea pe Dn și pe categorie (tabelul complet, 133 de rânduri, Q2)
**Regula de clasificare.** Folosesc coloana „Sat” din jumătatea stângă a tabelului (feliile z?_6). Rândurile cu Sat ∈ {UAT Stefan Voda, UAT Cuza Voda, UAT Gradistea, UAT Independenta} sunt **în afara UAT Vâlcelele**. Rândurile cu Sat ∈ {UAT Valcelele, Floroaica, Valcelele} sunt **în UAT Vâlcelele**.
Capetele confirmă regula: lanțul SRMP → „UAT Cuza Voda-Limita” → „UAT Gradistea-Limita” → „UAT Independenta-Limita” → „UAT Valcelele-Limita” (Nr 1–4), iar Nr 5 pleacă din „UAT Valcelele-Limita”. Rezultatul e identic cu formularea din #63 pct. 3b („primele patru rânduri”).
Subcategoriile din UAT Vâlcelele se stabilesc după capete și Sat:
- **B**: trunchi Dn200, Nr 5–8.
- **C**: racorduri SRS — Nr 9–10 (Ramif. Dragoș Vodă → SRS 2) și Nr 97 (Marin Preda → SRS 1).
- **D**: Sat = Valcelele, Nr 11–96.
- **E**: Sat = Floroaica, Nr 98–133.

| Dn | A în afara UAT | B trunchi UAT | C racorduri SRS | D rețea Vâlcelele | E rețea Floroaica | Σ în UAT (B–E) | Σ total |
|---|---|---|---|---|---|---|---|
| 200 | 13.765 (4) | 4.020 (4) | — | — | — | 4.020 | 17.785 |
| 160 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 125 | — | — | — | 1.585 (6) | 690 (6) | 2.275 | 2.275 |
| 110 | — | — | — | 660 (6) | 120 (1) | 780 | 780 |
| 90 | — | — | 1.345 (3) | 1.110 (10) | 2.090 (6) | 4.545 | 4.545 |
| 63 | — | — | — | 7.170 (20) | 2.500 (10) | 9.670 | 9.670 |
| 60 (Nr 57) | — | — | — | 110 (1) | — | 110 | 110 |
| 40 | — | — | — | 10.660 (43) | 3.080 (13) | 13.740 | 13.740 |
| **Σ** | **13.765** | **4.020** | **1.345** | **21.295** | **8.480** | **35.140** | **48.905** |

- Pe fiecare UAT din afara Vâlcelelor: Ștefan Vodă 5.485, Cuza Vodă 4.080, Grădiștea 1.980, Independența 2.220.
- Comparația cu sumarul BD (`lungime_totala_m=48195`, `pe_diametre`): diferă doar Dn40 (13.140 în BD față de 13.740 aici; −600 din cauza deduplicării) și Dn60 (110, exclus ca nestandard). În UAT, pe baza sumarului, rămân 34.430 m.

## 3. `posibila_dublura` și rândurile repetate: ce ar schimba totalul
| Element | Date (Q3) | Efect asupra totalului |
|---|---|---|
| 52 de avertismente `posibila_dublura` (z3_1: 26, z3_2: 14, z4_2: 12) | 18.406 m de adnotări; doar 19 cu același Dn (8.696 m) | **0**: adnotările nu sunt numărate (regula R5). Perechea e aleasă numai după lungime (primul rând ±1%, orice Dn), de ex. idx 81 Dn40 303 → Nr 16 Dn125, deși nodurile indică Nr 28. Ca identificare e slabă. |
| Toate cele 75 de adnotări | 34.732 m | Dacă s-ar aduna, totalul ar crește cu **+34.732** (dintre care 16.326 m fără nicio pereche ±1%). **Nu se adună**: tabelul e complet (Nr 1–133 continuu, 133 de noduri de sosire unice). |
| Adnotări Dn200 fără pereche Dn200 în tabel (idx 121, 122, 199, 200, 201) | 3.226 m | 0 acum. Trebuie verificate pe imagine: pot fi ramificațiile spre Cuza Vodă/Dragoș Vodă (z4_2, z3_2), care nu sunt în tabel, sau citiri greșite. La fel pentru idx 119 (Dn90 1.080), 124 (Dn125 2.350) și 125 (Dn90 5.005). |
| Avertismentul „23 grupuri de rânduri cu aceeași lungime și același Dn” | Toate rândurile au Nr crt și noduri distincte | **0**: sunt tronsoane reale. Suprapunerea feliilor a produs 19 rânduri citite de două ori (Nr 32–37, 78–83, 123–129), cu valori identice (0 conflicte), iar deduplicarea le-a eliminat corect. |
| Deduplicarea greșită Nr 40–41 | 2 × 300 m Dn40 | Totalul **crește cu 600** (48.195 → 48.795, fără Nr 57). De validat pe imagine că lungimile sunt 300 + 300. |
| Nr 57 Dn60 → Dn63 (nevalidat) | 110 m | +110 dacă se validează (→ 48.905) |
| Nr 38: 320 sau 330 (nevalidat) | 10 m | +10 dacă se validează 330 |

Totalul candidat al tabelului este 48.905 m (cu Nr 57 ca Dn63 și Nr 38 = 320). Intervalul e **48.795–48.915**, adică o **diferență candidată de +4.440 … +4.560** față de 44.355. Limita de jos (48.795) presupune Nr 40–41 = 2 × 300 m. Fără ele rămâne cifra din BD, 48.195 (+3.840).

## 4. Suma din afara UAT față de 3.840
- Suma din afara UAT este **13.765 m** (Nr 1–4), adică de 3,58 ori cât 3.840.
- Nicio submulțime de rânduri întregi dintre Nr 1–4 nu dă 3.840. Sumele posibile sunt: 1.980, 2.220, 4.080, 4.200, 5.485, 6.060, 6.300, 7.465, 7.705, 8.280, 9.565, 9.685, 11.545, 11.785, 13.765 (Q6). Cea mai apropiată e Nr 2 = 4.080 (+240). Nici diferența candidată (+4.440 … +4.560) nu se obține din Nr 1–4. Cea mai apropiată sumă e Nr 3+4 = 4.200.
- Am extins verificarea la toate rândurile Dn200 (Nr 1–8). Nicio combinație nu dă 3.840, 4.440, 4.550 sau 4.560. Cele mai apropiate sunt 3.950 (Nr 3+5+8) pentru 3.840 și 4.600 (Nr 3+5+7+8) pentru 4.550 (Q6).
- **De ce potrivirea numerică nu dovedește nimic.** Concluzia de mai sus e adevărată **doar pentru rândurile Dn200**. Pe toate cele 133 de rânduri, fiecare dintre cifre se obține din foarte multe combinații (Q10):

| Țintă | Minimum de rânduri | Exemple (Nr crt: lungimi) | Submulțimi cu suma exactă |
|---|---|---|---|
| 3.840 | 3 (8 combinații) | Nr 3+8+13: 1.980+1.370+490 · Nr 3+6+23: 1.980+1.400+460 · Nr 3+8+10+12: 1.980+1.370+340+150 | ≈ 4,6 × 10²¹ |
| 4.440 | 3 (80 combinații) | Nr 2+14+108: 4.080+90+270 | ≈ 2,2 × 10²³ |
| 4.550 | 3 (76 combinații) | Nr 2+10+56: 4.080+340+130 · Nr 3+7+9+10+13+14: 1.980+650+1.000+340+490+90 | ≈ 4,2 × 10²³ |
| 4.560 | 3 (118 combinații) | Nr 2+10+99: 4.080+340+140 | ≈ 4,5 × 10²³ |

  Tabelul are 133 de lungimi rotunde, în mare parte multipli de 10. Cu ele, aproape orice cifră se poate „explica” printr-o sumă de rânduri. O potrivire exactă ar conta doar dacă rândurile potrivite ar forma un grup cu sens: un UAT, o etapă sau un traseu contiguu. Exact grupul cu sens, Nr 1–4, nu se potrivește.
- Dacă se exclud toate rândurile Nr 1–4, rămân 35.140 m (sau 34.430 pe baza sumarului). Asta înseamnă **−9.215 / −9.925** față de 44.355. Excluderea „răstoarnă” diferența în loc s-o închidă.
- **Cât se explică:** 0 m din 3.840 se pot demonstra ca provenind din afara UAT. În schimb, 600–720 m din diferența dintre tabel și sumar sunt artefacte de citire și agregare: 600 m dedup Nr 40–41, 0–110 m Nr 57, 0–10 m Nr 38. Ele **măresc** diferența la +4.440 … +4.560, nu o explică.
- **Ce rămâne neexplicat:** toată diferența candidată, +4.440 … +4.560. Pe clase de Dn, pe totalul de 48.905: Dn200 are +6.260 față de 11.525, iar Dn ≤ 125 are −1.710 față de 32.830.
- **De ce nu se poate închide:**
  - (i) Cifrele 44.355 / 11.525 / 32.830 vin din caietul de sarcini (CS) și din memoriu. Acolo sunt descrise trepte „Dn 200 la Dn 160” și „Dn 160 la Dn 40”. Tabelul are **0 m Dn160**, deci documentația și planșa nu au aceeași defalcare pe diametre.
  - (ii) CS p.5 (doc 1276, poz. 13 142–13 404) descrie Etapa 1, „Tronson 1-SRMP-SNT Transgaz - SRS-uri distribuție”, ca pornind „din sistemul de distribuție pe Stefan Voda … cca 9,5 km … cca 2,5 km … cca 1,5 km … cca 1,5 km”. După CS, rândurile din afara UAT **fac parte din Etapa 1**, nu sunt un „surplus”. Totuși, doar Nr 1–4 (13.765) depășesc deja cei 11.525 m ai Etapei 1, iar aproximațiile din text însumează ~15 km. Documentația se contrazice singură.
  - (iii) Cifra de 3.840 e ea însăși subestimată cu 600–720 m (vezi mai sus).
- **Concluzie:** ipoteza că cei 3.840 m sunt exact tronsoanele din afara UAT **se respinge**. Măsura „tronsoanele din afara UAT stau în afara ofertei până la reconciliere” rămâne corectă, dar **nu e aplicată în BD**: rândul 1751 (Dn200, 17.785) le conține. Aplicarea e pasul A din §7.

## 5. Maparea pe etape
Referințe:
- CS (doc 1276): p.4 poz. 10 024 „aproximativ 44,355 km”; p.6 poz. 16 094 „Dn 200. la Dn 160 … etapa I-a … 11,525 km”; poz. 16 254 „Dn 160 la Dn 40 … 32,830 km”.
- Memoriu (doc 468): p.11 poz. 25 423 / 25 581 (aceleași cifre); p.12 poz. 28 778 „44,355 ml reprezentand o suprafata de 29.555 mp”.

| Variantă | E1 pe plan | Δ față de 11.525 | E2 pe plan | Δ față de 32.830 | Total | Δ față de 44.355 |
|---|---|---|---|---|---|---|
| V1 pe Dn: E1 = Dn200 (Nr 1–8), E2 = Dn ≤ 125 | 17.785 | +6.260 | 31.120 | −1.710 | 48.905 | +4.550 |
| V2 după traseul din CS p.5: E1 = Nr 1–8 + racorduri SRS (Nr 9, 10, 97), E2 = D + E | 19.130 | +7.605 | 29.775 | −3.055 | 48.905 | +4.550 |
| V3 fără amonte: E1 = Nr 5–8, E2 = Dn ≤ 125 | 4.020 | −7.505 | 31.120 | −1.710 | 35.140 | −9.215 |
| V4 fără amonte: E1 = Nr 5–8 + racorduri, E2 = D + E | 5.365 | −6.160 | 29.775 | −3.055 | 35.140 | −9.215 |
| V5 prefix contiguu: E1 = Nr 1–3 (SRMP → limita Grădiștea/Independența) | 11.545 | **+20** | 37.360 | +4.530 | 48.905 | +4.550 |

Totalurile presupun Nr 40–41 = 2 × 300 m și Nr 57 ca Dn63. Fără Nr 57, E2 și totalul scad cu 110 în toate variantele.

Unde nu se potrivește:
- **Dn160**: are 0 m în tabel, dar CS și memoriul îl menționează în ambele etape.
- **E1 = 11.525** nu se obține exact din nicio combinație de rânduri Dn200 întregi (Q6).
  - Cele mai apropiate sunt 11.535 (Nr 1+2+5+8) și 11.545 (Nr 1+2+3).
  - Combinația Nr 1+2+5+8 sare peste Nr 3–4, deci nu e un traseu fizic.
  - V5 e singurul candidat contiguu și e compatibil cu formularea din CS p.6 „de la sistemul … Stefan Voda, pana la SRMP-ul de 5.000 mc/h al comunei Gradistea”. Dar contrazice continuarea „si catre UAT Valcelele si cele patru SRS-uri” și ar pune 6.240 m Dn200 (Nr 4–8) în E2 („Dn 160 la Dn 40”). **Nedemonstrat.**
- **E2 = 32.830** nu se obține în nicio variantă. Cel mai aproape e V1, cu −1.710 (−5,2%).
- **SRS și SRMP**: CS pomenește „cele patru SRS-uri” și un SRMP Grădiștea de 5.000 mc/h. Tabelul are 2 SRS (SRS 1 Floroaica, SRS 2 Vâlcelele) și pornește din „SRMP Existenta 7500 mc” (felia z4_7 / z5_7).
- **Bilanțul de debit pe trunchi**: 7.500 = 2.500 („Ramificatie ptr alimentarea UAT Cuza Voda”, z4_2) + 500 (SRS 1, z3_2) + 3.500 (Dragoș Vodă, z3_2) + 1.000 (SRS 2, z3_2). Coloana Q din tabel scade la fel: 7.500 (Nr 1–4) → 5.000 (Nr 5–6) → 4.500 (Nr 7–8) → 1.000 (Nr 9–10). Deci trunchiul Nr 1–4 transportă și gazul pentru Cuza Vodă și Dragoș Vodă (6.000 din 7.500 mc/h). E un indiciu că e o conductă regională comună. Nu decide cine o execută.
- **Nota de pe planurile topografice**: „54200mp … UAT Vlad Tepes = 3200 mp; UAT Vilcelele 51000 mp” apare pe **toate** planșele 471–475, nu doar pe 474 (Q7). Nicio interpretare nu o împacă cu 44.355 sau cu 48.905. Punctul e deja întrebat la #63 pct. 4.

## 6. Propunerea de rânduri de cantități (NEAPLICATĂ) și ce trebuie confirmat prin #63
Starea actuală a fost recitită prin SELECT la 25.09.2026 (Q5): 6 rânduri, id 1751–1756, toate cu status `extras`, `tip_sursa` NULL, categoria „Conducte și montaj”, sursa „Planșa 1 — tabel de dimensionare, citit automat din scanare”. Σ `cantitate` = Σ `cantitate_plansa` = 48.195.

| id | Denumire | acum: cantitate / planșă / status | după pasul A | după pasul B (condiționat) | Motiv |
|---|---|---|---|---|---|
| 1751 | Dn200 → „Dn200 — UAT Vâlcelele (planșa 470, Nr 5–8)” | 17.785 / 17.785 / extras | **4.020** / 4.020 / diferenta | la fel | Nr 1–4 ies într-un rând separat; etapa se confirmă la #63 pct. 2b |
| nou | „Dn200 — amonte, în afara UAT Vâlcelele (planșa 470, Nr 1–4)” | — | **NULL** / 13.765 / diferenta | la fel | În afara ofertei până la #63 pct. 3b, „de confirmat prin #63” |
| 1752 | Dn125 | 2.275 / 2.275 / extras | fără schimbare | la fel | — |
| 1753 | Dn110 | 780 / 780 / extras | fără schimbare | la fel | — |
| 1754 | Dn90 | 4.545 / 4.545 / extras | + notă | la fel | Include 1.345 m racorduri SRS; etapa la #63 pct. 2b |
| 1755 | Dn63 | 9.670 / 9.670 / extras | + notă | la fel | Nr 57 Dn60 (110 m) exclus; Dn63 e o propunere nevalidată |
| 1756 | Dn40 | 13.140 / 13.140 / extras | + notă (cantitatea **nu** se schimbă) | **13.740** / 13.740 / diferenta | +600 pentru Nr 40–41, doar după validarea pe imagine; Nr 38 320/330 |
| **Σ** | | **48.195 / 48.195** | **34.430 / 48.195** | **35.030 / 48.795** | Față de 44.355: după A −9.925 în ofertă; după B −9.325 în ofertă / +4.440 pe planșă |

Valorile pasului B presupun Nr 40 = Nr 41 = 300 și Nr 38 = 320. Blocul SQL al pasului B primește lungimile validate ca parametri: cu Nr 38 = 330 iese 13.750 / 35.040 / 48.805 (= 48.795 + 10).
Nr 57 ca Dn63 (+110 m pe 1755) **nu** e în niciun pas. Dacă se validează, se face un pas separat, după același model.

**Atenție, risc comercial.** Cifra de 34.430 m (35.030 după pasul B) e o separare prudentă, nu cantitatea finală. Dacă AC confirmă că Nr 1–4 fac parte din obiect (textul CS p.5 sugerează asta), în ofertă trebuie să intre și cei 13.765 m. Decizia comercială îi aparține lui Razvan.

**Efectele unui nou transfer din planșă** (retransfer: `treciInCantitati`, `handler.ts` l.248–357, cu scrierea prin RPC-ul `ofertare_transfer_plansa_cantitati`):
- **Dn200** are două poziții după pasul A: 1751 și rândul nou. Ambele conțin „Dn200” în denumire, deci transferul le raportează „ambigue” (l.301–304) și **nu scrie pe niciuna**. Asta e dorit. Dacă una dintre ele e redenumită sau ștearsă, cealaltă redevine singurul candidat și primește din nou toți cei 17.785 m în `cantitate_plansa`.
- **Dn125, Dn110, Dn90, Dn63 și Dn40 (id 1752–1756)** au câte o singură poziție. Pe fiecare, transferul **rescrie `diferenta_nota` în întregime** (l.315 și l.319; RPC-ul face `diferenta_nota = patch`, nu adaugă la ea). Notele R5 v2 de pe 1754, 1755 și 1756 se pierd toate.
- Tot pe 1752–1756 transferul rescrie și **`cantitate_plansa`**. Pe 1752–1755 valoarea rămâne aceeași (2.275 / 780 / 4.545 / 9.670). Pe **1756 revine la 13.140** cât timp deduplicarea nu e reparată. Dacă pasul B e aplicat, `cantitate` rămâne 13.740, fiindcă transferul nu atinge niciodată `cantitate`. Nota devine „Memoriu 13.740 m vs planșa 1 13.140 m (-600 m, pe 54 tronsoane citite din tabel).”, iar `status` rămâne `diferenta` (l.317 schimbă doar `extras` → `diferenta`).
- **Rândul nou** (cantitate NULL, planșă 13.765) **nu apare** în `v_ofertare_contradictii`. `difere` cere `cantitate IS NOT NULL`, iar `lipsa` cere ca ambele valori să fie NULL. Rândul se vede doar prin `status='diferenta'`, prin notă și prin „?” în coloana de cantitate din UI.
- `ofertare-clarificari-propune` citește rândurile care au `diferenta_nota` (`core.ts` l.69). Rulează numai la cerere și e o procesare plătită.

**Remedierea de cod.** E un tichet separat, care se implementează **pe ramura R4**, nu aici. Cheia de deduplicare din `tronsoaneUnice` (l.215–228, cheia la l.222) **nu poate** primi Nr crt sau nodurile. Tronsoanele din feliile z?_7, singurele care au lungime, nu le conțin. Nodurile sunt pe tronsoanele z?_6, care au `lungime_m = null` și sunt deja sărite la l.220.
Formularea implementabilă este **deduplicarea pe multiset**. Pentru fiecare cheie `de_la|la|L|Dn|Q|zona`, multiplicitatea finală este **maximul aparițiilor cheii într-o singură felie**, nu suma pe felii, fiindcă feliile suprapuse recitesc aceleași rânduri.
- Verificat pe BD (Q9): pe rândurile de tabel (152 de citiri brute, 131 de chei distincte), regula dă **133 de rânduri / 48.905 m, Dn40 = 13.740**. E identic cu reconstrucția după Nr crt. Cheia lui Nr 37/40/41 apare o dată în z1_7 (poziția 37) și de 3 ori în z2_7 (pozițiile 6, 9, 10), deci multiplicitatea finală e 3.
- Limită: dacă două rânduri identice ca text cad în felii diferite și amândouă sunt în afara zonei de suprapunere, maximul le numără o singură dată, adică le subnumără. Varianta robustă este împerecherea z?_6 × z?_7 după poziție și deduplicarea după Nr crt. Verificatorul rundei 1 a constatat că Strada coincide pe toate cele 152 de perechi.
- De decis pe R4: dacă regula se aplică și adnotărilor. Pe ele ar da 88 de rânduri în loc de 75 și 37.472 m în loc de 34.732 m (Q9), ceea ce schimbă `adnotari_neconfirmate_m` și avertismentele. Cât timp există tabel, adnotările nu intră în cantități; fără tabel, intră.
- Test obligatoriu: cazul Nr 37/40/41. În z2_7 sunt 3 × (Florența Albu → CT, 300 m, Dn40, Q20, C-tin Brâncoveanu), în z1_7 1 ×; rezultatul trebuie să fie 3 rânduri, 900 m.
- Tot pe acel tichet: `posibila_dublura` (l.459) să caute întâi același Dn și aceleași noduri, nu primul rând cu lungime ±1%.

Ce trebuie confirmat prin răspunsul la #63 (#63: `status=de_trimis`, `raspuns=NULL`, Q8):

| Decizie de cantitate | Punct #63 | Răspunsul care închide decizia |
|---|---|---|
| Nr 1–4 (13.765 m Dn200: Ștefan Vodă 5.485, Cuza Vodă 4.080, Grădiștea 1.980, Independența 2.220) intră în ofertă? În ce etapă? | 3b (și 1, 2a) | da/nu + etapa |
| Tabelul din 470 e referința de cantități (133 de rânduri, 48.905 m)? | 3a (și 5a) | da, sau altă referință (liste de cantități) |
| Dn200 în UAT (4.020, Nr 5–8) și racordurile SRS (1.345, Nr 9, 10, 97): E1 sau E2? | 2b | defalcare Dn × etapă |
| Dn160 (0 m în tabel) | 3c, 2b | lungimi Dn160 sau confirmarea că nu există |
| Ținta 44.355 = 11.525 + 32.830; include Dn200? | 1, 2a | confirmare sau corecție |
| Corespondența tronson ↔ poziție din Lista de prețuri | 5b | structura listei |

Puncte care NU sunt în #63:
- **Verificare internă pe imagine (Oana Nica)**: Nr 40–41 (+600 m, condiția pasului B), Nr 38 (±10), Nr 57 (Dn60), strada pentru Nr 37–38, adnotările Dn200 fără pereche (idx 121, 122, 199, 200, 201; 3.226 m) și idx 119 / 124 / 125.
- **Neacoperit de textul actual**: trunchiul Nr 1–4 alimentează și Cuza Vodă (2.500 mc/h) și Dragoș Vodă (3.500 mc/h); CS vorbește de „cele patru SRS-uri”, tabelul are 2 SRS. Adăugarea lor ar redeschide redactarea #63 (R8 închis), deci cere re-aprobare. Opțional, doar cu GO Razvan.

## 7. Aplicare — cu GO
**Nimic de aici nu s-a executat pe BD.** Obiectivul este să aducă BD în acord cu măsura Copilot „în afara ofertei până la reconciliere”: rândul 1751 nu mai conține Nr 1–4 (13.765 m) în cantitatea ofertată. Nr 1–4 se păstrează separat, cu cantitate NULL, și sunt marcate „de confirmat prin #63”.

Ordinea (pattern-ul preview → confirmare → apply → verificare):
1. **(0) Preview** și **(R0) snapshot**. Snapshot-ul e un SELECT separat care întoarce valorile vechi complete. Se păstrează ca sursă pentru rollback.
2. **GO Razvan** pentru pasul A.
3. **(A)** se trimite ca **un singur apel** `execute_sql`. Un bloc DO e o singură instrucțiune, deci o singură tranzacție: orice `RAISE EXCEPTION` anulează tot, fără efecte parțiale.
4. **(A-verif)** se rulează ca apel separat. `execute_sql` întoarce doar ultimul rezultat, iar `RAISE NOTICE` s-ar putea să nu fie vizibil.
5. **(B)** e opțional și condiționat. Se rulează numai după ce Oana Nica validează pe imagine Nr 40, Nr 41 și Nr 38 și numai cu GO Razvan. Constantele blocului sunt NULL intenționat: blocul refuză să ruleze până nu sunt completate.
6. Rollback-ul, dacă e nevoie: întâi **(RB)**, apoi **(RA)**.

Gărzile din pasul A:
- blochează rândul de document 470 (`FOR UPDATE`) ca să se serializeze cu RPC-ul de transfer, care blochează același rând, și cere `transfer.stare='facut'`;
- blochează rândurile licitației 95;
- dacă pasul A e deja aplicat, ridică un NOTICE și iese fără modificări;
- altfel cere exact starea din preview (6 rânduri, 48.195 / 48.195);
- după fiecare UPDATE: `GET DIAGNOSTICS` = 1, altfel `RAISE EXCEPTION`;
- INSERT-ul e idempotent, cu `WHERE NOT EXISTS` pe cheia indexului unic `uq_ofertare_cantitati_sursa (licitatie_id, denumire, sursa)`;
- notele se adaugă o singură dată (`NOT LIKE '%R5 v2%'`);
- la final verifică sumele: n = 7, Σ cantitate = 34.430, Σ planșă = 48.195, 1 rând NULL, Dn200 pe planșă = 17.785, 5 note.

Coloanele, constrângerile (status ∈ {extras, validat, diferenta, revizuit_clarificare}, tip_sursa ∈ {…, plansa, …}), indexul unic și trigger-ul `trg_categorie_cantitate` au fost citite din catalog (Q11). Trigger-ul pune categoria „Conducte și montaj” pe ambele denumiri noi; am verificat cu `fn_categorie_cantitate`, o funcție STABLE, doar citire.

**Testat local, nu pe Supabase.** Am folosit un Postgres 16 local de unică folosință, cu o machetă care are aceleași coloane, aceleași constrângeri CHECK, indexul unic și trigger-ul pe `denumire`. Datele din machetă sunt cele 6 rânduri reale, citite la 25.09. Au trecut 16 scenarii, printre care:
- pasul B înainte de A e refuzat;
- pasul A dă 34.430 / 48.195, iar rulat a doua oară dă NOTICE fără modificări;
- rollback-ul A readuce exact starea inițială (hash identic pe toate coloanele de date);
- pasul A, apoi B dau 35.030 / 48.795; B rulat a doua oară e refuzat;
- rollback-ul A cu B aplicat e refuzat; rollback-ul B, apoi rollback-ul A readuc starea inițială;
- cu Nr 38 = 330, pasul B dă 35.040 / 48.805;
- o stare modificată între timp e refuzată, fără efecte parțiale;
- o notă „R5 v2” existentă deja pe 1755 face ca blocul să fie refuzat, iar 1751 rămâne 17.785;
- `transfer.stare='in_curs'` e refuzat;
- rândul Nr 1–4 inserat deja de mână e refuzat. Ăsta e exact cazul de dublare semnalat de verificator, 17.785 + 13.765.

```sql
-- R5 v2 · lic. 95 / planșa 470 (doc 470) · PROPUNERE NEEXECUTATĂ — se rulează DOAR cu GO Razvan.
-- Fiecare bloc de mai jos = UN apel execute_sql separat (execute_sql întoarce doar ultimul rezultat).
-- Un bloc DO e o singură instrucțiune: orice RAISE EXCEPTION anulează TOT ce a făcut blocul (nimic parțial).

-- ============================================================================================
-- (0) PREVIEW — starea de plecare (citită la 25.09.2026: 6 rânduri, id 1751–1756, Σ 48.195 / 48.195)
-- ============================================================================================
SELECT id, denumire, cantitate, cantitate_plansa, status, categorie, tip_sursa,
       left(diferenta_nota, 90) AS nota, updated_at
  FROM public.ofertare_cantitati WHERE licitatie_id = 95 ORDER BY id;

-- (R0) SNAPSHOT PENTRU ROLLBACK — rulează-l ÎNAINTE de pasul A și păstrează rezultatul (valorile vechi, complete)
SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) AS valori_vechi_r5
  FROM public.ofertare_cantitati c WHERE c.licitatie_id = 95;

-- ============================================================================================
-- (A) PASUL A — Nr 1–4 (13.765 m Dn200, în afara UAT Vâlcelele) ies din cantitatea ofertată.
--     1751 rămâne cu Nr 5–8 (4.020 m); Nr 1–4 trec într-un rând separat cu cantitate NULL,
--     marcat „de confirmat prin #63”. Plus note (o singură dată) pe 1754, 1755, 1756.
--     Dn40 NU se modifică aici (vezi pasul B).
--     După A: 7 rânduri, Σ cantitate = 34.430, Σ cantitate_plansa = 48.195.
-- ============================================================================================
DO $$
DECLARE
  c_den_nou   constant text := 'Conductă distribuție gaze Dn200 — amonte, în afara UAT Vâlcelele (planșa 470, Nr 1–4)';
  c_sursa_nou constant text := 'Planșa 470 — tabel Dimensionare, Nr crt 1–4 (felii z1_6/z1_7), separat la R5 v2';
  n int; v_transfer text; v_id_nou bigint;
  v_n int; v_cant numeric; v_plansa numeric; v_null int; v_dn200 numeric; v_note int;
BEGIN
  -- 0. serializare cu transferul automat: RPC-ul ofertare_transfer_plansa_cantitati blochează același rând de document
  SELECT analiza->'citire_ai'->'transfer'->>'stare' INTO v_transfer
    FROM public.ofertare_documente_atribuire WHERE id = 470 AND licitatie_id = 95 FOR UPDATE;
  IF v_transfer IS DISTINCT FROM 'facut' THEN
    RAISE EXCEPTION 'R5 v2 A: transferul planșei 470 nu e în starea facut (e %) — oprit, nimic modificat', coalesce(v_transfer, 'NULL');
  END IF;
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;

  -- 1. deja aplicat complet? => rulare repetată = nicio modificare
  IF EXISTS (SELECT 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 AND denumire = c_den_nou AND sursa = c_sursa_nou)
     AND EXISTS (SELECT 1 FROM public.ofertare_cantitati WHERE id = 1751 AND licitatie_id = 95 AND cantitate = 4020
                   AND diferenta_nota LIKE '%R5 v2%') THEN
    RAISE NOTICE 'R5 v2 A: deja aplicat — nicio modificare';
    RETURN;
  END IF;

  -- 2. starea de plecare trebuie să fie exact cea din preview
  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n, v_cant, v_plansa
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n <> 6 OR v_cant IS DISTINCT FROM 48195 OR v_plansa IS DISTINCT FROM 48195 THEN
    RAISE EXCEPTION 'R5 v2 A: stare neașteptată (n=%, Σcantitate=%, Σplanșă=%; așteptat 6 / 48195 / 48195) — refă preview-ul',
      v_n, v_cant, v_plansa;
  END IF;

  -- 3. 1751: în ofertă rămân doar Nr 5–8 (600 + 1.400 + 650 + 1.370 = 4.020 m)
  UPDATE public.ofertare_cantitati
     SET denumire = 'Conductă distribuție gaze Dn200 — UAT Vâlcelele (planșa 470, Nr 5–8)',
         cantitate = 4020, cantitate_plansa = 4020, status = 'diferenta',
         specificatii = 'Nr 5 UAT Valcelele 600 · Nr 6 intravilan Floroaica 1400 · Nr 7 intravilan Floroaica 650 · Nr 8 UAT Valcelele → Ramif. Dragos Voda 1370',
         diferenta_nota = coalesce(diferenta_nota, '') || ' | R5 v2 (25.09.2026): din 17.785 m s-au scos Nr 1–4 (13.765 m, în afara UAT Vâlcelele) într-un rând separat, în afara ofertei până la răspunsul la #63 pct. 3b. Etapa E1/E2 pentru Nr 5–8 de confirmat (#63 pct. 2b); Dn160 = 0 m în tabel (#63 pct. 3c).',
         updated_at = now()
   WHERE id = 1751 AND licitatie_id = 95
     AND denumire = 'Conductă distribuție gaze Dn200' AND cantitate = 17785 AND cantitate_plansa = 17785
     AND coalesce(diferenta_nota, '') NOT LIKE '%R5 v2%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 A: UPDATE 1751 a atins % rânduri (așteptat 1)', n; END IF;

  -- 4. rândul separat Nr 1–4: cantitate NULL (în afara ofertei), cantitate_plansa 13.765 (5.485 + 4.080 + 1.980 + 2.220)
  --    cheie de idempotență = indexul unic uq_ofertare_cantitati_sursa (licitatie_id, denumire, sursa)
  INSERT INTO public.ofertare_cantitati
         (licitatie_id, denumire, um, cantitate, cantitate_plansa, status, extras_de_ai, tip_sursa, sursa, specificatii, diferenta_nota)
  SELECT 95, c_den_nou, 'm', NULL, 13765, 'diferenta', true, 'plansa', c_sursa_nou,
         'Nr 1 UAT Stefan Voda 5485 · Nr 2 UAT Cuza Voda 4080 · Nr 3 UAT Gradistea 1980 · Nr 4 UAT Independenta 2220 · Q 7500 mc/h',
         'R5 v2 (25.09.2026): ÎN AFARA OFERTEI (cantitate NULL) — de confirmat prin #63 pct. 3b (fac parte din obiect? în ce etapă?). Nu intră în Σ cantitate până la răspunsul AC.'
   WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati
                      WHERE licitatie_id = 95 AND denumire = c_den_nou AND sursa = c_sursa_nou)
  RETURNING id INTO v_id_nou;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 A: INSERT Nr 1–4 a adăugat % rânduri (așteptat 1)', n; END IF;

  -- 5. note (o singură dată) pe Dn90, Dn63, Dn40 — cantitățile lor NU se schimbă în pasul A
  UPDATE public.ofertare_cantitati
     SET diferenta_nota = coalesce(diferenta_nota, '') || ' | R5 v2 (25.09.2026): include 1.345 m racorduri SRS (Nr 9 1.000, Nr 10 340, Nr 97 5); etapa E1/E2 de confirmat prin #63 pct. 2b.',
         updated_at = now()
   WHERE id = 1754 AND licitatie_id = 95 AND cantitate = 4545 AND coalesce(diferenta_nota, '') NOT LIKE '%R5 v2%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 A: nota 1754 a atins % rânduri (așteptat 1)', n; END IF;

  UPDATE public.ofertare_cantitati
     SET diferenta_nota = coalesce(diferenta_nota, '') || ' | R5 v2 (25.09.2026): Nr 57 (Florența Albu, Crinului→Rozelor, 110 m, Q40) citit Dn60 (nestandard), NEinclus; Dn63 (+110 m) e o propunere nevalidată pe imagine.',
         updated_at = now()
   WHERE id = 1755 AND licitatie_id = 95 AND cantitate = 9670 AND coalesce(diferenta_nota, '') NOT LIKE '%R5 v2%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 A: nota 1755 a atins % rânduri (așteptat 1)', n; END IF;

  UPDATE public.ofertare_cantitati
     SET diferenta_nota = coalesce(diferenta_nota, '') || ' | R5 v2 (25.09.2026): tabelul are 56 de rânduri Dn40 = 13.740 m; Nr 40 (34→59) și Nr 41 (34→60), 2 × 300 m, pierdute la deduplicare. Cantitatea rămâne 13.140 până la validarea pe imagine (Oana Nica) — pasul B. Nr 38: 320 sau 330, de verificat.',
         updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND coalesce(diferenta_nota, '') NOT LIKE '%R5 v2%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 A: nota 1756 a atins % rânduri (așteptat 1)', n; END IF;

  -- 6. verificarea finală a sumelor — dacă nu ies, se anulează tot blocul
  SELECT count(*), sum(cantitate), sum(cantitate_plansa),
         count(*) FILTER (WHERE cantitate IS NULL),
         sum(cantitate_plansa) FILTER (WHERE denumire ~* 'dn\s*200'),
         count(*) FILTER (WHERE diferenta_nota LIKE '%R5 v2%')
    INTO v_n, v_cant, v_plansa, v_null, v_dn200, v_note
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n <> 7 OR v_cant IS DISTINCT FROM 34430 OR v_plansa IS DISTINCT FROM 48195
     OR v_null <> 1 OR v_dn200 IS DISTINCT FROM 17785 OR v_note <> 5 THEN
    RAISE EXCEPTION 'R5 v2 A: verificare eșuată (n=%, Σcantitate=%, Σplanșă=%, NULL=%, Dn200 planșă=%, note=%; așteptat 7 / 34430 / 48195 / 1 / 17785 / 5) — anulat',
      v_n, v_cant, v_plansa, v_null, v_dn200, v_note;
  END IF;
  RAISE NOTICE 'R5 v2 A aplicat: rând nou id=%, Σ în ofertă 34.430, Σ planșă 48.195', v_id_nou;
END $$;

-- (A-verif) apel separat, după pasul A
SELECT count(*) AS n, sum(cantitate) AS in_oferta, sum(cantitate_plansa) AS plansa,
       count(*) FILTER (WHERE cantitate IS NULL) AS in_afara_ofertei,
       array_agg(id ORDER BY id) AS ids
  FROM public.ofertare_cantitati WHERE licitatie_id = 95;
-- așteptat: n = 7, in_oferta = 34430, plansa = 48195, in_afara_ofertei = 1

-- ============================================================================================
-- (B) PASUL B — SEPARAT, CONDIȚIONAT: Dn40 +600 m (Nr 40 și Nr 41) DOAR după ce Oana Nica validează
--     pe imaginea planșei lungimile Nr 40, Nr 41 și Nr 38. Cere pasul A aplicat.
--     Constantele sunt NULL intenționat: blocul refuză să ruleze până se completează.
--     Cu Nr 40 = Nr 41 = 300 și Nr 38 = 320: 1756 = 13.740; Σ cantitate 35.030, Σ planșă 48.795.
-- ============================================================================================
DO $$
DECLARE
  c_validat_de constant text := NULL;  -- COMPLETEAZĂ: cine a verificat pe imagine (ex. 'Oana Nica')
  c_validat_la constant date := NULL;  -- COMPLETEAZĂ: data verificării
  c_nr40       constant int  := NULL;  -- COMPLETEAZĂ: lungimea Nr 40 citită pe imagine (propus 300)
  c_nr41       constant int  := NULL;  -- COMPLETEAZĂ: lungimea Nr 41 citită pe imagine (propus 300)
  c_nr38       constant int  := NULL;  -- COMPLETEAZĂ: 320 sau 330, cum se citește pe imagine
  n int; v_transfer text; v_nou numeric; v_n int; v_cant numeric; v_plansa numeric;
BEGIN
  IF c_validat_de IS NULL OR c_validat_la IS NULL OR c_nr40 IS NULL OR c_nr41 IS NULL OR c_nr38 IS NULL THEN
    RAISE EXCEPTION 'R5 v2 B: lipsește validarea pe imagine (cine, când, Nr 40, Nr 41, Nr 38) — pasul B nu rulează fără ea';
  END IF;
  IF c_nr40 <= 0 OR c_nr41 <= 0 OR c_nr38 NOT IN (320, 330) THEN
    RAISE EXCEPTION 'R5 v2 B: valori invalide (Nr 40=%, Nr 41=%, Nr 38=%)', c_nr40, c_nr41, c_nr38;
  END IF;
  v_nou := 13140 + c_nr40 + c_nr41 + (c_nr38 - 320);   -- 13.140 conține deja Nr 38 = 320 (z2_7)

  SELECT analiza->'citire_ai'->'transfer'->>'stare' INTO v_transfer
    FROM public.ofertare_documente_atribuire WHERE id = 470 AND licitatie_id = 95 FOR UPDATE;
  IF v_transfer IS DISTINCT FROM 'facut' THEN
    RAISE EXCEPTION 'R5 v2 B: transferul planșei 470 nu e în starea facut (e %)', coalesce(v_transfer, 'NULL');
  END IF;
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;

  UPDATE public.ofertare_cantitati
     SET cantitate = v_nou, cantitate_plansa = v_nou, status = 'diferenta',
         diferenta_nota = diferenta_nota || format(' | R5 v2 pas B: Nr 40 = %s m și Nr 41 = %s m validate pe imaginea planșei de %s la %s; Nr 38 = %s m. Dn40 = %s m.',
                                                   c_nr40, c_nr41, c_validat_de, to_char(c_validat_la, 'DD.MM.YYYY'), c_nr38, v_nou),
         updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13140
     AND diferenta_nota LIKE '%R5 v2 (25.09.2026)%'          -- pasul A aplicat
     AND diferenta_nota NOT LIKE '%R5 v2 pas B%';            -- pasul B neaplicat
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'R5 v2 B: UPDATE 1756 a atins % rânduri (așteptat 1: pasul A aplicat, B neaplicat, Dn40 = 13140)', n;
  END IF;

  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n, v_cant, v_plansa
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n <> 7 OR v_cant IS DISTINCT FROM 34430 + (v_nou - 13140) OR v_plansa IS DISTINCT FROM 48195 + (v_nou - 13140) THEN
    RAISE EXCEPTION 'R5 v2 B: verificare eșuată (n=%, Σcantitate=%, Σplanșă=%; așteptat 7 / % / %) — anulat',
      v_n, v_cant, v_plansa, 34430 + (v_nou - 13140), 48195 + (v_nou - 13140);
  END IF;
  RAISE NOTICE 'R5 v2 B aplicat: Dn40 = %, Σ în ofertă %, Σ planșă %', v_nou, v_cant, v_plansa;
END $$;

-- ============================================================================================
-- ROLLBACK — valorile vechi sunt cele citite prin SELECT la 25.09.2026 (identice cu snapshot-ul R0).
-- Ordinea: întâi rollback B (dacă B s-a aplicat), apoi rollback A. updated_at primește now() (urma rămâne).
-- ============================================================================================

-- (RB) rollback pasul B: 1756 revine la 13.140 / 13.140 / extras, nota revine la forma de după pasul A
DO $$
DECLARE n int; v_cant numeric; v_plansa numeric;
BEGIN
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;
  UPDATE public.ofertare_cantitati
     SET cantitate = 13140, cantitate_plansa = 13140, status = 'extras',
         diferenta_nota = left(diferenta_nota, strpos(diferenta_nota, ' | R5 v2 pas B') - 1),
         updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND strpos(diferenta_nota, ' | R5 v2 pas B') > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 rollback B: % rânduri (așteptat 1 — pasul B e aplicat?)', n; END IF;
  SELECT sum(cantitate), sum(cantitate_plansa) INTO v_cant, v_plansa FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_cant IS DISTINCT FROM 34430 OR v_plansa IS DISTINCT FROM 48195 THEN
    RAISE EXCEPTION 'R5 v2 rollback B: Σcantitate=%, Σplanșă=% (așteptat 34430 / 48195) — anulat', v_cant, v_plansa;
  END IF;
END $$;

-- (RA) rollback pasul A: șterge rândul Nr 1–4 (după cheia unică) și readuce 1751, 1754, 1755, 1756 la valorile vechi
DO $$
DECLARE
  c_den_nou   constant text := 'Conductă distribuție gaze Dn200 — amonte, în afara UAT Vâlcelele (planșa 470, Nr 1–4)';
  c_sursa_nou constant text := 'Planșa 470 — tabel Dimensionare, Nr crt 1–4 (felii z1_6/z1_7), separat la R5 v2';
  n int; v_n int; v_cant numeric; v_plansa numeric; v_note int;
BEGIN
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.ofertare_cantitati WHERE id = 1756 AND diferenta_nota LIKE '%R5 v2 pas B%') THEN
    RAISE EXCEPTION 'R5 v2 rollback A: pasul B e aplicat — rulează întâi rollback-ul B';
  END IF;

  DELETE FROM public.ofertare_cantitati
   WHERE licitatie_id = 95 AND denumire = c_den_nou AND sursa = c_sursa_nou
     AND cantitate IS NULL AND cantitate_plansa = 13765;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 rollback A: DELETE Nr 1–4 a atins % rânduri (așteptat 1)', n; END IF;

  UPDATE public.ofertare_cantitati
     SET denumire = 'Conductă distribuție gaze Dn200', cantitate = 17785, cantitate_plansa = 17785, status = 'extras',
         specificatii = 'UAT Stefan Voda, UAT Cuza Voda, UAT Gradistea, UAT Independenta, UAT Valcelele, Intravilan sat Floroaica',
         diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 8 tronsoane citite din tabelul planșei.',
         updated_at = now()
   WHERE id = 1751 AND licitatie_id = 95 AND cantitate = 4020 AND diferenta_nota LIKE '%R5 v2 (25.09.2026)%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 rollback A: 1751 % rânduri (așteptat 1)', n; END IF;

  UPDATE public.ofertare_cantitati
     SET diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 19 tronsoane citite din tabelul planșei.', updated_at = now()
   WHERE id = 1754 AND licitatie_id = 95 AND diferenta_nota LIKE '%R5 v2 (25.09.2026)%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 rollback A: 1754 % rânduri (așteptat 1)', n; END IF;

  UPDATE public.ofertare_cantitati
     SET diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 30 tronsoane citite din tabelul planșei.', updated_at = now()
   WHERE id = 1755 AND licitatie_id = 95 AND diferenta_nota LIKE '%R5 v2 (25.09.2026)%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 rollback A: 1755 % rânduri (așteptat 1)', n; END IF;

  UPDATE public.ofertare_cantitati
     SET diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 54 tronsoane citite din tabelul planșei.', updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND diferenta_nota LIKE '%R5 v2 (25.09.2026)%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 v2 rollback A: 1756 % rânduri (așteptat 1)', n; END IF;

  SELECT count(*), sum(cantitate), sum(cantitate_plansa), count(*) FILTER (WHERE diferenta_nota LIKE '%R5 v2%')
    INTO v_n, v_cant, v_plansa, v_note FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n <> 6 OR v_cant IS DISTINCT FROM 48195 OR v_plansa IS DISTINCT FROM 48195 OR v_note <> 0 THEN
    RAISE EXCEPTION 'R5 v2 rollback A: verificare eșuată (n=%, Σcantitate=%, Σplanșă=%, note=%; așteptat 6 / 48195 / 48195 / 0) — anulat',
      v_n, v_cant, v_plansa, v_note;
  END IF;
END $$;
```

## Interogări și locatori (toate sunt SELECT)
- **Q1**: `felii[eticheta ~ '^z[1-4]_[67]$'].tabele[0].randuri`, zip pe ordinalitate pentru z?_6 × z?_7, DISTINCT pe `Nr crt`. Rezultat: 133 de rânduri (1–133), 0 conflicte, Σ 48.905; singurul grup identic e Nr 37/40/41. 133 de perechi de noduri distincte și 133 de noduri de sosire distincte.
- **Q1b**: coloana „același Dn ±1%” din §1.2, calculată pe două baze: tabelul complet (133 de rânduri) și `tronsoane_unice` (131). Diferă doar idx 81 și 83 (13 față de 11).
- **Q2**: aceeași reconstrucție, grupată pe categoria A–E × Dn.
- **Q3**: `sumar.posibile_dubluri` (52; 19 cu același Dn; 18.406 / 8.696 m) și `tronsoane_unice` cu `sursa≠'tabel'` (75; 34.732 m = `sumar.adnotari_neconfirmate_m`, recitit la 25.09). Pe felii: z3_1 36 / 11.427, z3_2 22 / 17.291, z4_2 17 / 6.014.
- **Q4**: adnotările din z3_1 (`de_la`=„Nod n”), join pe `Noduri de Plecare/Sosire`.
- **Q5**: `ofertare_cantitati WHERE licitatie_id=95` → id 1751–1756, recitit la 25.09 cu toate coloanele. Coloanele au fost verificate întâi în `information_schema.columns`.
- **Q6**: subset-sum pe rândurile Nr 1–4 și pe rândurile Dn200 (Nr 1–8). Script local, fără BD.
- **Q7**: `alte_mentiuni` din 471–475 (nota 54200mp).
- **Q8**: `ofertare_clarificari id=63`, recitit la 25.09: `status=de_trimis`, `raspuns` NULL, `raspuns_la` NULL.
- **Q9**: simularea deduplicării pe multiset pe `felii[*].tronsoane` cu lungime > 0. Pentru fiecare cheie `de_la|la|L|Dn|Q|zona` se ia maximul aparițiilor într-o felie. Rezultat pe `sursa='tabel'`: 152 de citiri, 131 de chei, 133 de rânduri, 48.905 m (Dn40 13.740 față de 13.140 pe set). Pe `sursa='adnotare'`: 94 de citiri, 75 de chei, 88 de rânduri, 37.472 m (față de 34.732). Cheia lui Nr 37/40/41 e în z1_7 la poziția 37 și în z2_7 la pozițiile 6, 9, 10.
- **Q10**: numărarea submulțimilor (programare dinamică) pe toate cele 133 de lungimi, pentru țintele 3.840 / 4.440 / 4.550 / 4.560, plus căutarea combinațiilor minime. Script local, fără BD.
- **Q11**: catalogul pentru `ofertare_cantitati`: `pg_constraint`, `pg_trigger`, `pg_indexes`. Plus definițiile `fn_trg_categorie_cantitate`, `fn_categorie_cantitate`, `ofertare_transfer_plansa_cantitati` și `v_ofertare_contradictii`.
- Text CS / memoriu: `strpos(text_extras, …)` pe doc 1276 / 468. Pagina = ultimul marcaj ⟦PAGINA n⟧ înainte de poziție.
- Cod (commitul `8a6fbbb`, ramura `claude/erp-continuare-x4p5a7`), `supabase/functions/ofertare-plansa-citeste/handler.ts`:
  - l.215–228 `tronsoaneUnice` (l.220 sare tronsoanele fără lungime, l.222 e cheia);
  - l.248–357 `treciInCantitati` (l.301–304 pozițiile ambigue, l.315 patch-ul `cantitate_plansa` + `diferenta_nota`, l.317 status, l.319 op-ul de update);
  - l.446–470 `agregaTronsoane` (l.459 regula ±1%);
  - l.720–725 diametrele nestandard (Dn60 scos);
  - l.726–731 avertismentul pentru rândurile repetate.
- Tot acolo: `ofertare-clarificari-propune/core.ts` l.69.

## Jurnal de corecturi (runda 2, după verificatorul rundei 1)
| # | Problema semnalată | Gravitate | Ce s-a schimbat |
|---|---|---|---|
| 1 | SQL-ul propus nu era sigur: COMMIT necondiționat, INSERT fără gardă și fără idempotență (risc Dn200 dublu: 17.785 + 13.765), note adăugate la fiecare rulare | major | Rescris ca blocuri DO (§7): lock pe document și pe rânduri, verificarea stării de plecare, `GET DIAGNOSTICS` + `RAISE EXCEPTION` pe fiecare UPDATE, INSERT cu `WHERE NOT EXISTS` pe cheia unică, note `NOT LIKE '%R5 v2%'`, verificarea finală a sumelor, rollback separat (RB, RA) plus SELECT de snapshot (R0). Dn40 scos din pasul A și mutat în pasul B, condiționat. Testat local în 16 scenarii. |
| 2 | §3: „48.195 → 48.805” | minor | 48.195 + 600 = **48.795** |
| 3 | Remedierea de cod („cheia să includă Nr crt / nodurile”) nu se poate implementa | minor | §6: deduplicare pe multiset, cu multiplicitatea = maximul aparițiilor într-o felie; verificată pe BD (Q9); limita ei, efectul pe adnotări, testul Nr 37/40/41; se implementează pe ramura R4 |
| 4 | Efectele unui retransfer erau incomplete | minor | §6: `diferenta_nota` rescrisă pe 1752–1756, `cantitate_plansa` rescrisă (valoare schimbată doar pe Dn40), Dn200 ambiguu, `cantitate` neatinsă, rândul NULL invizibil în `v_ofertare_contradictii` |
| 5 | §1.2: coloana ±1% era calculată pe 131 de rânduri, deși documentul spune 133 | minor | Coloana e acum pe tabelul complet (133); idx 81 și 83 = **13** (11 pe `tronsoane_unice`); baza e precizată (Q1b) |
| 6 | Locator `handler.ts` l.460 | minor | **l.459** |
| 7 | Formulări prea tari: „diferența corectă +4.550” și „nicio combinație de rânduri întregi” | minor | Rezumat, §0, §3 și §4: diferența candidată e **+4.440 … +4.560**; „nicio combinație de rânduri **Dn200** întregi”, cu combinațiile de pe toate rândurile arătate ca argument (§4, Q10) |
