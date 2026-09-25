# R5 — Reconciliere cantități, doc 470 (Schema tehnologică Vălcelele, lic 95)

Doar propunere. Nu s-a modificat nimic în BD. Sursa este `ofertare_documente_atribuire.id=470`, câmpul `analiza->citire_ai` (model claude-opus-5, 35 felii, `sumar.erori=1`, `cantitati.amanat` = transferul e blocat pentru că o felie a eșuat).
Notă: rândurile din `tronsoane_unice` NU au câmpul `_zona`, dar au câmpul `zona` (ex. #84 `zona=Valcelele`). Zona de proveniență am luat-o din `felii[].eticheta` (join pe felii → tronsoane).

## Totaluri brute (SELECT grupat pe `tronsoane_unice`, 152 de rânduri)
| Dn | m tabel (nr) | m adnotare (nr) |
|---|---|---|
| 250 | 0 | 1370 (1) |
| 200 | 17785 (8) | 3326 (4) |
| 125 | 2275 (12) | 403 (2) |
| 110 | 780 (7) | 130 (1) |
| 90 | 4545 (19) | 2814 (6) |
| 63 | 9670 (30) | 1328 (6) |
| 60 | 110 (1) | 0 |
| 43 | 0 | 270 (1) |
| 40 | 13140 (54) | 0 |
| **Σ** | **48305 (131)** | **9641 (21)** |

Câmpul `sumar` (`lungime_totala_m=49565`, `adnotari_neconfirmate_m=7731`) **se împacă** cu rândurile, după regula din `supabase/functions/ofertare-plansa-citeste/handler.ts` l.614-626 și 651-652 (revizor, 25.09): 49565 = tabel 48305 − Dn60 110 (nestandard, scos) + adnotarea Dn250 1370 (diametru absent din tabel → „numărată în plus”; Dn43 270 tot în plus, dar scos ca nestandard). 7731 = 9641 − 1370 − 270 (#99) − 270 (#95 Dn63, eliminat din „neconfirmate” fiindcă are aceleași capete null și aceeași lungime ca #99, l.620). Deci **sumarul BD numără 1370 m de două ori** (Dn200 din tabel + Dn250 din adnotare) — exact dubla de la (a). Tronsoane: 131 − 1 + 1 = 131; `adnotari_lasate_deoparte` 21 − 2 − 1 = 18.

## (a) 1370 m: Dn250 sau Dn200
- Din tabel: rândul unic #8, felia z1_7. Tabelul „Dimensionare” are rândul `8 | 6' | 7 | UAT Valcelele | Limita extravilan → Ramif. Alimentare Dragos Voda | 200 | 4500 | 1,370` (note_lipite, perechea z1_6+z1_7).
- Din adnotare: rândul unic #84, felia z3_2, zona „Valcelele”, cu Dn250, L=1370, Q=3500. În aceeași felie apare mențiunea „Ramificatie ptr alimentarea UAT Dragos Voda, Q=3500 mc/h” și avertismentul „Etichetele de pe plan sunt partial ilizibile”. Felia z4_2 are o adnotare Dn250 fără lungime.
- **Propun** să păstrăm 1370 m **o singură dată**, la **Dn200**, după tabel. Adnotarea e același tronson (aceeași lungime, capătul Dragoș Vodă), citită greșit. Alt argument: memoriul (doc 468) spune „Dn 200 la Dn 40”, deci un Dn250 nu intră în gama declarată. Încredere: medie-mare. Rămâne o întrebare: Q=3500 la adnotare față de Q=4500 în tabel.

## (b) Rânduri dublate între tabel și adnotări (z3_2 / z4_2 sunt adnotări pe plan, peste tronsoanele din tabel)
| adnotare (#, felie) | pereche în tabel | propunere |
|---|---|---|
| #87 Dn200 1400 (z3_2) + Dn200 1400 (z4_2, eliminat la dedup) | #6 Dn200 1400 „Limita intravilan → Ramif. SRS1 Floroaica” | este dublură, se exclude |
| #82 Dn90 1000 Q1000 (z3_2) | #9 Dn90 1000 Q1000 | este dublură, se exclude |
| #100 Dn90 340 (z3_2) | #10 Dn90 340 | este dublură, se exclude |
| #98 Dn90 110, #93 Dn63 110, #97 Dn110 130 | multe rânduri de 110/130 m în tabel | probabil dubluri, se exclud |
| #83 Dn90 1093; #85 Dn200 856; #86 Dn200 850 Q500; #148 Dn200 220; #90/#96 Dn125 250/153; #88,89,91,92,94,95,101 | nu au pereche exactă în tabel | nu se pun în cantități; merg la verificare vizuală |
- Toate cele 21 de adnotări au `de_la`/`la` = null, deci nu le pot lega de un tronson anume din tabel.
- **Discrepanță de transcriere:** rândul unic #38 are 320 m Dn40 (C-tin Brâncoveanu). Textul brut din note_lipite, rândul 38 al tabelului, spune `40 | 20 | 0,330` (textul brut NEVERIFICAT de revizor; valoarea 320 din rând confirmată prin SELECT). **Propun 330** după textul brut (+10 m).
- Rândul #62 „Macului → Macului” (Dn40, 280 m) are capetele identice. E probabil o eroare de citire a capătului. Lungimea o păstrez.

## (c) Diametre nestandard
- **Dn60**: rândul #55, sursa tabel, felia z2_7: `Crinului → Rozelor`, `debit_mch=40`, `lungime_m=110`, `diametru_mm=60`. Debitul e în coloana lui separată (40), deci 60 NU este debitul. Rândurile vecine de pe Florenta Albu (#52, #58) sunt Dn63 cu 110 m. **Propun Dn63.** Încredere: medie. 60 nu există în seria PE100 SDR11.
- **Dn43**: rândul #99, sursa adnotare, felia z3_2, zona Floroaica, 270 m, fără Q. În felie nu există text brut suplimentar, doar avertismentul de ilizibilitate. Poate fi 40 sau 63. Nu se poate decide din date. **Propun să rămână nedeclarat și în afara cantităților.**
- Nimic nu arată că valorile ar fi Di (diametre interioare): în tabel coloana e diametrul nominal, cu debitul separat.

## (d) Material
- Legenda este demonstrată în **felia z1_1**, în `alte_mentiuni`: „Legenda: Retea GN_MP PEHD PE 100 SDR 11 (linie verde)”.
- Pe rânduri, `material = null` peste tot. Legenda se aplică tuturor rețelelor desenate cu linie verde. Asocierea fiecărui rând cu linia verde nu este verificată vizual. Propun materialul **PE100 SDR11 (din legenda z1_1)** pentru rândurile din tabel. Memoriul îl confirmă (doc 468: „Material tubular – PEID 100 SDR 11”).

## (e) Comparație cu referința oficială
Citate:
- doc 468 (memoriu): „PE 100 SDR 11 Dn 200 la Dn 40 in lungime totala de 44,355 km”; „Dn 200. la Dn 160 … etapa 1-a … 11,525 km … etapa 2-a … Dn 160 la Dn 40 … 32,830 k[m]”
- doc 1276 (CS p01): același text; „lungime de aproximativ 44,355 km”

| | referință | tabel 470 | diferență |
|---|---|---|---|
| Etapa 1 (Dn200–160) | 11525 | Dn200 = 17785 (160 lipsește) | **+6260** |
| Etapa 2 (Dn160–40) | 32830 | 30520 (sub Dn200, cu Dn60→63 și #38 corectat: 30530) | **−2300** |
| Total | 44355 | 48305 / 48315 | **+3950 / +3960** |

Rândurile #1–#4 (SRMP Ștefan Vodă → limita Vălcelele, 13765 m Dn200) trec prin UAT-urile Ștefan Vodă, Cuza Vodă, Grădiștea și Independența. Din date nu se poate stabili dacă referința de 11,525 km le include. În tabel nu apare niciun Dn160, deși memoriul pomenește Dn160 în ambele etape. **Diferențele NU se validează**, doar se marchează.

## (f) Tabel final propus
| Dn + material | m tabel | m adnotare | m acceptat propus | motiv | încredere |
|---|---|---|---|---|---|
| 250 PE100 SDR11 | 0 | 1370 | 0 | dublura rândului #8 (Dn200), în afara gamei din memoriu | medie-mare |
| 200 PE100 SDR11 | 17785 | 3326 | 17785 | tabel; adnotările sunt dubluri sau nelegate | medie (+6260 față de Etapa 1) |
| 160 | 0 | 0 | 0 | lipsește din schemă, dar apare în memoriu | întrebare deschisă |
| 125 PE100 SDR11 | 2275 | 403 | 2275 | tabel | medie |
| 110 PE100 SDR11 | 780 | 130 | 780 | tabel | medie |
| 90 PE100 SDR11 | 4545 | 2814 | 4545 | tabel; 1000 și 340 sunt dubluri | medie |
| 63 PE100 SDR11 | 9670 | 1328 | 9780 | tabel + 110 m de la #55 (Dn60→63) | medie |
| 60 | 110 | 0 | 0 | mutat la Dn63 | medie |
| 43 | 0 | 270 | 0 | nedeclarat, adnotare ilizibilă | mică |
| 40 PE100 SDR11 | 13140 | 0 | 13150 | tabel + 10 m (#38: 330 în loc de 320) | medie |
| **Σ** | 48305 | 9641 | **48315** | față de referința 44355: **+3960 (nevalidat)** | — |

## Întrebări deschise
1. Rândurile #1–#4 (13765 m Dn200, SRMP Ștefan Vodă → limită) intră în obiectul licitației? Ar explica o parte din +6260 la Etapa 1.
2. Unde e Dn160? Memoriul îl pomenește, schema nu are niciun rând.
3. Felia eșuată (`sumar.erori=1`) ar trebui reluată înainte de orice transfer. Sunt posibile rânduri lipsă.
4. Dn43 / 270 m Floroaica și adnotările nelegate (#83 1093, #85 856, #86 850, #148 220 Dn200): trebuie verificate vizual pe plan, în felia z3_2.
5. ~~Sumarul 49565 nu se împacă~~ — REZOLVAT de revizor: se împacă (vezi sus); 49565 include dubla 1370 (Dn250). Codul actual numără orice adnotare pe diametru absent din tabel, deci o citire greșită de Dn umflă totalul.
