# R5 v2: reconcilierea cantităților din planșa 470 (lic. 95 Vâlcelele)

Stare: **doar propunere**. În BD s-au rulat numai SELECT-uri, iar documentul nu modifică nici codul, nici datele (codul e pe ramurile din §6.3 și §6.5). Data: 25.09.2026, **revizia 6: 26.09.2026, ~07:00Z**.

**Starea codului la care se referă documentul: 26.09.2026, ~07:00Z** (`git log -1` pe fiecare ramură, verificat imediat înainte de salvare):

| Ramura | Capul | Ce conține | Verificare independentă | Pushată / PR / deployată |
|---|---|---|---|---|
| `claude/r4-rezervare-zone` | **`7a7bf86`** (docs, 05:23:33Z); codul în **`3197aa3`** (05:21:08Z), `COD_VERSIUNE` 2026-09-26.13 | deduplicarea pe identitatea rândului, rundele 3–9 (§6.5) | runda 6 confirmată la `ab5c449`; **reverificarea rundei 9 NU confirmă**: 2 majore deschise (TOTAL-a / TOTAL-b, regresii față de `e8489a6`, 0 cazuri pe BD azi) + 3 minore (§6.5) | nu / nu / nu |
| `claude/cantitati-nevalidate-consumatori` | **`6313184`** (06:37:43Z), reașezată peste `7a7bf86` (o conține; rebase-ul 3 = `828aa4e`) | protecția consumatorilor + condițiile Copilot 1–2 din 26.09 (§6.3) + tot codul R4 | runda 5 **confirmată** (0 blocante, 0 majore, 4 minore, §6.3); plus o nepotrivire găsită la această revizie: marcajul pasului B (§6.4) | nu / nu / nu |

**Deployat azi** (Supabase `get_edge_function`, 26.09): `ofertare-plansa-citeste` versiunea 25, din 25.09 16:26Z, `COD_VERSIUNE` 2026-09-25.5, adică deduplicarea pe text. Același cod e și pe `origin/main` (`a4b2982`; `handler.ts` neschimbat față de `8a6fbbb`). **Nimic din cele două ramuri nu ajunge în producție până la push + PR + merge + deploy (GO Razvan).**

Revizii:
- **Revizia 6 (26.09, ~07:00Z):** capetele noi (R4 `7a7bf86`, rundele 7–9; consumatori `6313184`); cele trei minore ale verificatorului reviziei 5: (1) căile tăcute de la criteriul 2 sunt listate toate, cu starea de după rundele 7–9 (ce a devenit vizibil, ce rămâne, ce a apărut nou); (2) nota pasului B pe cifra 13.140 nu mai spune „deduplicarea pe text” (X3b); (3) avertismentul despre rollback-ul R4 după pasul B, acum condiționat pe ramura R4 (RBA). Harness-ul SQL: **87 / 87**; pe SQL-ul reviziei 5 pică exact cele 4 verificări noi de proveniență. Nou: codul consumatorilor recunoaște alt marcaj decât scrie pasul B (§6.4).
- **Revizia 5 (26.09, 02:50Z, istoric):** documentul era aliniat la capetele de atunci (`ab5c449`, `7fccfbe`). Reviziile 4 descriau stări intermediare ale ramurii R4 (`759c5e3`, apoi runda 5 ca lucru aflat încă în worktree), depășite deja la salvare: ambele runde erau comise. Criteriul 2 devine „remediat în cod pe ramură, verificat adversarial, nedeployat”. Nota pasului B nu mai atribuie cifra planșei unei „recitiri” când ea poate veni din corecția manuală A din documentul R4 (VA). Tot aici: eticheta pusă de codul de la `7fccfbe` pe 1756 după pasul B, reprodusă (§6.4).
- **Revizia 4 (26.09, istoric):** criteriul 2 redeschis după verificatorul rundei 3; gărzile NULL / text gol în pasul B; nota lui B după o recitire R4; RB-manual cu gărzi. **După reverificare:** nota ELSE a lui B numește cele trei valori verificate; RB-manual primește `c_plansa_r0`. Starea ramurii R4 descrisă atunci (`759c5e3`) e înlocuită de tabelul de mai sus.
- **Revizia 3 (25.09 seara):** aliniere la verdictul Copilot de mai jos și la verificatorul rundei 2. **Revizia 2:** observațiile verificatorului rundei 1. Lista corecturilor e la final, în „Jurnal de corecturi”.

Sursa: `ofertare_documente_atribuire.id=470`, `analiza->'citire_ai'`, versiunea `2026-09-25.5` (model claude-opus-5, tăiat la 16:45:36Z, 35/35 felii, `sumar.erori=0`, `zone_cazute=[]`, cost 2,595 USD). Transferul are `transfer.stare='facut'` la 16:51:08Z și `cantitati.adaugate=6`.
Citirea aceasta **înlocuiește** citirea analizată în v1 (`R5_RECONCILIERE_CANTITATI_470.md`: 152 de rânduri unice, z3_1 eșuată).

## Verdict Copilot (25.09 seara)
Verdictul lui Copilot la propunerea din revizia 2, redat literal:

> „(a) 4.020 m «în ofertă», 13.765 m separat — NU în această formă: scăderea e corectă aritmetic, dar nu demonstrează că 4.020 m reprezintă cantitatea de ofertat; nici amplasarea în afara UAT nu dovedește excluderea din contract. (b) Nu adaugi cei 600 m până la verificarea Oanei — DA pentru cantitatea ofertată; păstrezi constatarea pentru rândurile 40–41 cu imagine/locator. (c) R5 rămâne deschis — DA, dar răspunsul AC nu e singurul criteriu: bugul de deduplicare se repară și se testează acum; cantitățile se închid după verificarea extracției, clarificarea obiectului/etapelor, aprobarea umană și verificarea propagării în ofertă. «În afara ofertei până la reconciliere» înseamnă să nu folosim cantități nevalidate drept cantități aprobate, nu eliminarea automată a tronsoanelor din alte UAT. Rândul 1751: păstrezi 17.785 m ca rezultat extras, nevalidat, cu sursa și istoricul; poți reprezenta analitic 13.765 + 4.020, ambele candidate. Verifică consumatorii (financiar, F3/centralizator, grafic, generator PT, poartă finală). Diferența de bază este 4.550 m pentru 48.905; valorile 4.440–4.560 se prezintă ca scenarii distincte, cu ajustarea care produce fiecare. Ordinea: protejăm utilizarea cantităților nevalidate → reparăm deduplicarea pe identitatea rândului → Oana verifică pozițiile controversate → reconciliem obiectul și etapele.”

**Ce schimbă verdictul în acest document**

| Punct din verdict | Consecința | Unde |
|---|---|---|
| (a) 4.020 „în ofertă”, 13.765 separat: nu | Pasul A e scos: SQL-ul care reducea 1751 la 4.020 și punea Nr 1–4 într-un rând separat, cu cantitate NULL. Rămâne doar ca istoric respins, pe scurt | §7.2 |
| Rândul 1751 | Rămâne 17.785 m, `status=extras`: rezultat extras, nevalidat, cu sursa (planșa 470, Nr 1–8) și istoricul (transferul din 25.09, 16:51:08Z). 13.765 (Nr 1–4) + 4.020 (Nr 5–8) e o descompunere **analitică**. Ambele valori sunt candidate; niciuna nu e cantitatea de ofertat | §2, §6.1 |
| „În afara ofertei până la reconciliere” | Înseamnă că nicio cantitate nevalidată nu e folosită drept aprobată. Nu înseamnă scoaterea automată a tronsoanelor din alte UAT | Rezumat, §4, §6.3 |
| (b) +600 m Dn40 | Nu intră în cantitatea ofertată până la verificarea Oanei. Constatarea rămâne, cu locatorul pe imagine | §3, §6.2, pasul B (§7.3) |
| Diferența de bază | +4.550 m (48.905 − 44.355). 4.440, 4.450 și 4.560 sunt scenarii distincte, fiecare cu ajustarea lui. 3.840 e cifra din BD, produsă de două artefacte | §3 |
| Consumatorii | Financiar, F3/centralizator, grafic, generator PT, poartă finală: verificați într-un livrabil separat, pe ramura consumatorilor (`6313184`): remediat în cod, verificat adversarial (runda 5), nedeployat | §6.3 → `docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md` |
| (c) Bugul de deduplicare | Reparat pe identitatea rândului (nu pe multiset): **remediat în cod pe ramura R4** (`7a7bf86`, cod `3197aa3`), **nedeployat**; reverificarea rundei 9 **nu a confirmat** (2 majore pe rândurile TOTAL, §6.5). Pe citirea reală 470 = 133 de rânduri / 48.905 m. Cazurile adversariale ale rundelor 3–6 ies „de verificat”, conflict sau semnal explicit; căile tăcute cunoscute și cele rămase sunt numite în §6.5 (niciuna nu apare pe datele de azi). Rămân fixul celor 2 majore + reverificare, push + PR, merge + deploy (GO) și recitirea lui 470 (plătită, GO separat) | §6.5, ramura R4 |
| Ordinea | protecție → deduplicare → verificarea Oanei → obiect și etape | §7.1 |

**Criteriile de închidere R5** (din verdict) și starea lor la 26.09:

| # | Criteriu | Stare | Unde |
|---|---|---|---|
| 1 | Cantitățile nevalidate nu sunt folosite drept aprobate (protecția consumatorilor) | **în lucru: remediat în cod pe ramură, verificat adversarial, nedeployat.** Ramura `claude/cantitati-nevalidate-consumatori`, capul `6313184` (11 commituri peste R4 `7a7bf86`: `e5273f5`, `5a47658`, `31ed808`, `5303ee4`, `f2e3082`, `f78afa8`, `828aa4e`, `c68c8e7`, `5ab80c1`, `f6fdd51`, `6313184`); nepushată, fără PR. Condițiile Copilot din 26.09 dimineața sunt tratate în cod: (1) aprobarea se invalidează la orice schimbare relevantă (unitate, Dn, material, SDR, tronson / etapă, sursă, cifră), cu istoric (`c68c8e7`, `6313184`); (2) rândul invalidat / nevalidat nu dispare tacit din consumatori (`5ab80c1`). Verificatorul rundei 5 a confirmat (4 minore). Propuse, neaplicate, în această ordine: `R5_MIGRARE_PROPUSA_aprobare_istoric.sql` (tabel de istoric + trigger), apoi `R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql` (view + v6); întâi migrările, apoi merge-ul. Rămase: cele 4 minore (§6.3); **marcajul pasului B**: codul caută „ R5 v2 pas B”, SQL-ul din §7.3 scrie „ R5 pas B”, deci protecția etichetei nu se aplică pe 1756 (§6.4, probă) | §6.3 |
| 2 | Deduplicarea pe identitatea rândului, reparată și testată | **remediat în cod pe ramură, nedeployat; reverificarea capului actual NU a confirmat.** Ramura `claude/r4-rezervare-zone`, capul `7a7bf86` (cod `3197aa3`, `COD_VERSIUNE` 2026-09-26.13; locală, nepushată, fără PR). Regulile de identitate au intrat în șapte runde de cod (`a800d38`, `a9fe186`, `f1274a1`, `f1c4b66`, `f4406c7` + `cc2c77f` + `05b92cb`, `4e0591d` + `294a739`, `3197aa3`), fiecare cu cazurile adversariale ca teste de regresie (§6.5). Reprodus la ~07:00Z pe copii `git archive`, cu type-check: `7a7bf86` **158/158** (planșa 141/141), `6313184` **190/190** (planșa 168/168). Pe 470: 133 de rânduri / **48.905 m** (raportul rundei 9). **Căile tăcute de la revizia 5, cu starea de acum** (detaliu și cifre în §6.5): (1) tabel fără Nr, fără `zone_geom`, sub coloana fixată (ADV7-A) ⇒ **vizibil** din runda 7 (B1, „de verificat”); (2) transcriere dublă parțială a unui tabel fără Nr ⇒ **vizibil** (B2, runda 7; LCS runda 8), **rămâne tăcut** sub pragul LCS; (3) rând absent din ambele felii (golurile din secvența Nr; 470 fără Nr 50 = 132 / 48.685 m) ⇒ **vizibil** (B3: total marcat incomplet, notă și „diferenta” la transfer), **rămâne tăcut** rândul omis la capătul tabelului; (4) două tabele identice în benzi vecine ⇒ **vizibil** peste capacitatea fâșiei și la comasarea integrală (B4), **rămâne tăcut** la numerotări care se suprapun parțial. Închise în rundele 8–9: Nr citit fără lungime (NFL, NFL-DN), tronsonul sigur fără Dn (DN0). **Deschise de reverificarea rundei 9** (regresii față de `e8489a6`): TOTAL-a — un subtotal „total” cu materialul grupului primește cifra, iar poziția reală a Dn-ului își păstrează **tăcut** cifra veche (ADV10-1; pe calea „doar de verificat”, ADV10-8); TOTAL-b — „Total rețea Dn 63÷110” / „Dn 63, 90 și 110” sunt luate drept subtotal Dn63 (ADV10-7). Pe BD azi: 0 denumiri „total” cu Dn, 0 intervale. **Nu e închis** | §6.5 |
| 3 | Verificarea extracției pe imagine (Oana Nica) | **nefăcută** | §6.2 |
| 4 | Clarificarea obiectului și a etapelor (#63) | **deschisă**: #63 are `status=de_trimis` și `raspuns` NULL (recitit la 26.09, Q8) | §6.6 |
| 5 | Aprobarea umană (bifa ✓, adică `status='validat'`) | **0 din 6** rânduri validate (Q5, 26.09) | §6.1 |
| 6 | Verificarea propagării în ofertă | **de făcut după 1–5**. Azi lic. 95 nu are niciun derivat (Q12) | §6.3 |

Niciun criteriu nu e închis. Criteriul 2 se închide abia când:
- (a) fix-urile sunt comise pe ramura R4, cu testele adversariale ca teste de regresie: **făcut pentru rundele 3–9** (până la `7a7bf86`: margine, felia cu Nr lipsă / antete altfel V1–V4, Nr repetat B / C / C2, text contrazis, tabele fără Nr D, coloana fixată GEOM-1 / GEOM-E2E, coliziunea grupurilor sigure, Dn doar „de verificat”, regresiile COPILOT-REG-1…4, B1–B4, NFL, DN0, TOTAL cu interval). **Nefăcut** pentru cele 2 majore ale reverificării rundei 9 (TOTAL-a pe subtotalul cu material, TOTAL-b pe „÷” și liste de Dn) și pentru minorul „≥ 2 Dn fără interval” fără test;
- (b) o verificare independentă rerulează testele pe capul comis și confirmă: **nefăcut la `7a7bf86`** (reverificarea rundei 9 nu confirmă: 2 majore, 3 minore). Ultima confirmare e la `ab5c449` (runda 6). Golurile din secvența Nr au acum semnal (B3); rândul lipsă la capătul tabelului și `posibila_dublura` indiferent de Dn rămân limite documentate (§6.5);
- (c) codul e pushat, mergiuit și deployat cu GO: **nefăcut**;
- (d) 470 e recitit (procesare plătită, GO separat), iar cifrele se reconfirmă în BD: **nefăcut**.

## Rezumat
- **Tabelul planșei are 133 de rânduri** (Nr crt 1–133). Σ **48.905 m** așa cum e citit: Nr 57 numărat cu 110 m, deși Dn-ul citit e 60, și Nr 38 = 320. Sumarul din BD dă 48.195 m din cauza a două artefacte: −600 m Dn40 (Nr 40–41 pierdute la deduplicare) și −110 m (Nr 57 „Dn60”, exclus ca nestandard; `sumar.nestandard_m=110`). Recalculat pe BD la 25.09 seara (Q1).
- **Diferența de bază față de 44.355 m (CS + memoriu) este +4.550 m** (48.905). 4.440, 4.450 și 4.560 sunt **scenarii distincte**, fiecare produs de o ajustare anume: Nr 57 scos, Nr 38 = 330. 3.840 e cifra din BD, cu cele două artefacte (§3). Niciun scenariu nu e validat pe imagine.
- Nr 1–4 (în afara UAT Vâlcelele) însumează **13.765 m Dn200**, iar Nr 5–8 însumează **4.020 m**. Scăderea 17.785 − 13.765 = 4.020 e corectă aritmetic, dar **nu arată că 4.020 m e cantitatea de ofertat**. Nici amplasarea în afara UAT **nu dovedește excluderea din contract**: CS p.5 descrie tronsonul din Ștefan Vodă în Etapa 1 (§4).
- **Nicio combinație de rânduri Dn200 întregi nu dă 3.840 sau 4.550** (nici 4.440 sau 4.560) (Q6). Pe toate cele 133 de rânduri există însă combinații pentru fiecare dintre aceste cifre. De exemplu, 3.840 = Nr 3 + 8 + 13 (1.980 + 1.370 + 490), iar 4.550 = Nr 2 + 10 + 56 (4.080 + 340 + 130). Numărul de submulțimi este ≈ 4,6 × 10²¹ pentru 3.840 și ≈ 4,2 × 10²³ pentru 4.550 (Q10). **O potrivire numerică nu dovedește nimic.** Atribuirea diferenței tronsoanelor din afara UAT se respinge (§4).
- **Rândul 1751 (Dn200) rămâne 17.785 m**, cu `status=extras`: rezultat extras, nevalidat, cu sursa și istoricul lui. Descompunerea 13.765 + 4.020 e o analiză și stă în acest document; ambele valori sunt candidate. Separarea în BD propusă în revizia 2 (pasul A) a fost **respinsă** și scoasă (§7.2).
- **„În afara ofertei până la reconciliere” înseamnă că nicio cantitate nevalidată nu e folosită drept aprobată.** Tronsoanele din alte UAT nu se elimină automat. Protecția stă la consumatori și e tratată în livrabilul separat `docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md`, pe ramura consumatorilor (`6313184`): remediată în cod, verificată adversarial (runda 5), nedeployată (§6.3).
- **+600 m Dn40 (Nr 40–41).** Constatarea rămâne, cu locatorul pe imagine (§6.2), dar nu intră în cantitatea ofertată până la verificarea Oanei Nica. După verificare, pasul B (condiționat, testat local) schimbă doar `cantitate` pe 1756 (§7.3). În BD, 1756 are azi 13.140 / 13.140 (SELECT 26.09). Cauza e deduplicarea pe text, codul deployat azi. Deduplicarea pe identitatea rândului e **remediată în cod pe ramura R4 (`7a7bf86`) și nedeployată**; reverificarea rundei 9 are 2 majore deschise pe rândurile TOTAL (§6.5). Pe citirea reală dă 133 de rânduri / 48.905 m (Dn40 13.740). Cazurile adversariale ale rundelor 3–6 ies „de verificat”, conflict sau semnal; căile tăcute rămase sunt numite în §6.5 (B2 sub pragul LCS, B3 la capătul tabelului, B4 cu numerotări parțial suprapuse, TOTAL-a / TOTAL-b), niciuna pe datele de azi. Nimic nu e pushat, mergiuit sau deployat, iar 470 nu e recitit (§6.5).
- Verdict propus: **deschis**. Închiderea cere toate cele 6 criterii de mai sus, nu doar răspunsul AC. Nimic nu s-a aplicat.

## 0. Constatări noi (față de v1)
1. **Tabelul are 133 de rânduri, nu 131.** Reconstrucția din feliile pereche z?_6 (Nr crt, noduri, Sat) × z?_7 (Dn, Q, L) dă Nr crt 1–133. Sunt 133 de perechi de noduri distincte și 133 de noduri de sosire distincte: e o rețea arborescentă, fiecare rând e alt tronson. Între feliile suprapuse există 0 conflicte (Q1).
   `tronsoane_unice` are 131 de rânduri de tabel pentru că cheia de deduplicare (`handler.ts` l.215–228: `de_la|la|L|Dn|Q|zona`) nu include Nr crt și nodurile. Tronsoanele cu lungime (feliile z?_7) nici nu le au. Rândurile Nr 40 (34→59) și Nr 41 (34→60) sunt identice ca text cu Nr 37 (33→61): C-tin Brâncoveanu, Florența Albu→CT, Dn40, 300 m, Q20. Se pierd deci **600 m Dn40**. Remedierea (ramura R4, capul `7a7bf86`; nemergiuită, nedeployată; §6.5 pentru starea verificării) împerechează rândul cu lungime cu Nr crt din felia vecină: deduplicarea pe identitatea rândului (§6.5).
2. **Totalul tabelului, așa cum e citit, este 48.905 m.** Cifra de 48.195 m din BD se explică așa: 48.195 = 48.905 − 600 (dedup Nr 40–41) − 110 (Nr 57 „Dn60”, nestandard). Față de 44.355, **diferența de bază este +4.550**. Scenariile +4.440 … +4.560 sunt în §3.
3. **Rândurile din afara UAT (Nr 1–4) însumează 13.765 m Dn200** și nu explică 3.840 (secțiunea 4).
4. **Rândul `ofertare_cantitati` id 1751 (Dn200, 17.785 m, status `extras`) include Nr 1–4** (Q5, recitit la 25.09 seara). În sine, asta nu contrazice măsura „în afara ofertei până la reconciliere”: `extras` înseamnă nevalidat. Riscul real e ca un consumator să folosească rândul drept aprobat, iar asta se tratează la consumatori (§6.3). Revizia 2 propunea separarea în BD (pasul A); Copilot a respins-o (§7.2).
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

Observații de citire. Toate sunt NEVALIDATE și trebuie verificate pe imaginea planșei. Locatorii sunt în §6.2.
- **Nr 38**: z2_7 (rândul 7 al fragmentului) citește 0,320. Rândul e tăiat la marginea de jos a feliilor z1_6/z1_7. z1_6 notează „Randul 38 (33-62, …) este taiat de marginea de jos”, iar z1_7 (`alte_mentiuni`) „rand taiat: C-tin Brancoveanu - Florenta Albu - CT, 40, 20, 0,330”. Diferența posibilă este ±10 m.
- **Nr 57** (z2_6/z2_7, rândul 26): Dn60 e nestandard. Debitul (Q40) e în coloana lui, iar vecinii de pe Florența Albu sunt Dn63 (Nr 51 cu Q80, Nr 54 cu Q60, Nr 60 cu Q20). Propunerea Dn63 rămâne nevalidată. Lungimea de 110 m e în totalul tabelului (48.905). Dn-ul decide doar poziția (1755 sau niciuna) și dacă regula nestandard a codului o scoate (§3).
- **Nr 37/38**: pleacă din nodul 33 (Florența Albu × Aurel Vlaicu, conform Nr 35–36), dar strada citită e „C-tin Brancoveanu”. Tiparul nodurilor sugerează Aurel Vlaicu. Asta afectează doar denumirea, nu lungimea.
- **Nr 40/41** (z2_6/z2_7, rândurile 9 și 10): sunt rânduri distincte după Nr crt și noduri (34→59 și 34→60). Lungimile 300 + 300 se verifică pe imagine înainte de pasul B.

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
- Comparația cu sumarul BD (`lungime_totala_m=48195`, `pe_diametre`): diferă doar Dn40 (13.140 în BD față de 13.740 aici; −600 din cauza deduplicării) și Dn60 (110, exclus ca nestandard). În UAT (B–E), pe baza sumarului, rămân 34.430 m — cifră aritmetică, nu cantitate de ofertat.
- Coloanele A și B–E sunt o **descompunere analitică**, nu o decizie de ofertă. Pentru Dn200, A = 13.765 (Nr 1–4) și B = 4.020 (Nr 5–8) sunt **ambele candidate** până la răspunsul la #63 pct. 3b / 2b și aprobarea umană. Rândul 1751 rămâne 17.785 m (§6.1).

## 3. `posibila_dublura` și rândurile repetate: ce ar schimba totalul
| Element | Date (Q3) | Efect asupra totalului |
|---|---|---|
| 52 de avertismente `posibila_dublura` (z3_1: 26, z3_2: 14, z4_2: 12) | 18.406 m de adnotări; doar 19 cu același Dn (8.696 m) | **0**: adnotările nu sunt numărate (regula R5). Perechea e aleasă numai după lungime (primul rând ±1%, orice Dn), de ex. idx 81 Dn40 303 → Nr 16 Dn125, deși nodurile indică Nr 28. Ca identificare e slabă. |
| Toate cele 75 de adnotări | 34.732 m | Dacă s-ar aduna, totalul ar crește cu **+34.732** (dintre care 16.326 m fără nicio pereche ±1%). **Nu se adună**: tabelul e complet (Nr 1–133 continuu, 133 de noduri de sosire unice). |
| Adnotări Dn200 fără pereche Dn200 în tabel (idx 121, 122, 199, 200, 201) | 3.226 m | 0 acum. Trebuie verificate pe imagine: pot fi ramificațiile spre Cuza Vodă/Dragoș Vodă (z4_2, z3_2), care nu sunt în tabel, sau citiri greșite. La fel pentru idx 119 (Dn90 1.080), 124 (Dn125 2.350) și 125 (Dn90 5.005). |
| Avertismentul „23 grupuri de rânduri cu aceeași lungime și același Dn” | Toate rândurile au Nr crt și noduri distincte | **0**: sunt tronsoane reale. Suprapunerea feliilor a produs 19 rânduri citite de două ori (Nr 32–37, 78–83, 123–129), cu valori identice (0 conflicte), iar deduplicarea le-a eliminat corect. |
| Deduplicarea greșită Nr 40–41 | 2 × 300 m Dn40 | Totalul **crește cu 600** (48.195 → 48.795, fără Nr 57). Pe citirea reală, codul R4 (identitatea rândului, `7a7bf86`, nedeployat) dă exact 48.795 în cantități (§6.5). Lungimile 300 + 300 se verifică pe imagine. Până atunci cei 600 m **nu intră în cantitatea ofertată** (pasul B, §7.3). |
| Nr 57 (110 m, citit Dn60) | 110 m | Cei 110 m sunt în totalul tabelului (48.905). Regula codului scoate din cantități Dn-urile nestandard (−110 → 48.795). Dn63 e o propunere nevalidată și decide doar poziția (1755). |
| Nr 38: 320 sau 330 (nevalidat) | 10 m | +10 dacă imaginea arată 330 |

**Diferența de bază și scenariile.** Referința este 44.355 = 11.525 + 32.830 (CS p.4/p.6 și memoriul p.11–12, Q15). Diferența de bază e **+4.550 m**: tabelul complet, așa cum e citit. Celelalte cifre sunt scenarii distincte, fiecare produs de o ajustare anume față de bază. Niciun scenariu nu e validat pe imagine. Toate includ Nr 1–4 (13.765 m). Dacă Nr 1–4 intră în obiect e o întrebare separată (#63 pct. 3b, §4).

| Scenariu | Total planșă (m) | Δ față de 44.355 | Ajustarea care îl produce | Unde apare |
|---|---|---|---|---|
| **S0 — bază** | **48.905** | **+4.550** | niciuna: 133 de rânduri (Nr 1–133, fiecare o dată), Nr 57 numărat cu 110 m, Nr 38 = 320 (lectura z2_7) | reconstrucția după Nr crt (Q1); `total_sigur_m` al codului R4 pe citirea reală (§6.5; `7a7bf86`, nedeployat) |
| S1 | 48.915 | +4.560 | S0, dar Nr 38 = 330 (lectura rândului tăiat din z1_7) în loc de 320 | — |
| S2 | 48.795 | +4.440 | S0 − 110: Nr 57 scos ca Dn nestandard (regula codului, `sumar.nestandard_m`) | ce ar intra în cantități cu codul R4 pe citirea reală (132 de rânduri, Dn40 13.740; `7a7bf86`, nedeployat) |
| S3 | 48.805 | +4.450 | S2, dar Nr 38 = 330 | — |
| BD azi (nu e scenariu) | 48.195 | +3.840 | S2 − 600: Nr 40–41 pierdute la deduplicarea pe text | `sumar.lungime_totala_m`; Σ 1751–1756 (Q5) |

Plaja 4.440–4.560 înseamnă deci patru scenarii S0–S3, nu o incertitudine continuă: fiecare valoare are cauza ei. Verificarea pe imagine alege între ele:
- Nr 38 decide între S0 și S1, respectiv între S2 și S3.
- Nr 57 decide între S0/S1 și S2/S3. Dacă Dn60 e o citire greșită (probabil Dn63), cei 110 m intră (S0/S1). S2/S3 urmează regula codului, care ține Dn-urile nestandard în afara cantităților până la verificare.
- Nr 40–41 decid dacă se iese din cifra BD (3.840).

## 4. Suma din afara UAT față de 3.840
- Suma din afara UAT este **13.765 m** (Nr 1–4), adică de 3,58 ori cât 3.840.
- Nicio submulțime de rânduri întregi dintre Nr 1–4 nu dă 3.840. Sumele posibile sunt: 1.980, 2.220, 4.080, 4.200, 5.485, 6.060, 6.300, 7.465, 7.705, 8.280, 9.565, 9.685, 11.545, 11.785, 13.765 (Q6). Cea mai apropiată e Nr 2 = 4.080 (+240). Niciunul dintre scenariile S0–S3 (+4.440 … +4.560, §3) nu se obține din Nr 1–4. Cea mai apropiată sumă e Nr 3+4 = 4.200.
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
- **Cât se explică:** 0 m din 3.840 se pot demonstra ca provenind din afara UAT. În schimb, 600–720 m din diferența dintre tabel și sumar sunt artefacte de citire și agregare: 600 m dedup Nr 40–41, 0–110 m Nr 57, 0–10 m Nr 38. Ele **măresc** diferența la scenariile +4.440 … +4.560 (§3), nu o explică.
- **Ce rămâne neexplicat:** toată diferența de bază, +4.550 (scenariile +4.440 … +4.560). Pe clase de Dn, pe totalul de 48.905: Dn200 are +6.260 față de 11.525, iar Dn ≤ 125 are −1.710 față de 32.830.
- **De ce nu se poate închide:**
  - (i) Cifrele 44.355 / 11.525 / 32.830 vin din caietul de sarcini (CS) și din memoriu. Acolo sunt descrise trepte „Dn 200 la Dn 160” și „Dn 160 la Dn 40”. Tabelul are **0 m Dn160**, deci documentația și planșa nu au aceeași defalcare pe diametre.
  - (ii) CS p.5 (doc 1276, poz. 13 142–13 404) descrie Etapa 1, „Tronson 1-SRMP-SNT Transgaz - SRS-uri distribuție”, ca pornind „din sistemul de distribuție pe Stefan Voda … cca 9,5 km … cca 2,5 km … cca 1,5 km … cca 1,5 km”. După CS, rândurile din afara UAT **fac parte din Etapa 1**, nu sunt un „surplus”. Totuși, doar Nr 1–4 (13.765) depășesc deja cei 11.525 m ai Etapei 1, iar aproximațiile din text însumează ~15 km. Documentația se contrazice singură.
  - (iii) Cifra de 3.840 e ea însăși subestimată cu 600–720 m (vezi mai sus).
- **Concluzie:** ipoteza că cei 3.840 m sunt exact tronsoanele din afara UAT **se respinge**. Nici concluzia inversă nu se poate trage: amplasarea în afara UAT **nu dovedește** că Nr 1–4 sunt excluse din contract (CS p.5 le descrie în Etapa 1, punctul ii). Măsura „în afara ofertei până la reconciliere” înseamnă că 17.785 m, ca orice cantitate nevalidată, **nu se folosesc drept aprobate**. Nu înseamnă scoaterea automată a lui Nr 1–4 din rândul 1751 (verdict Copilot). Protecția se face la consumatori (§6.3), nu prin separarea în BD (pasul A, respins, §7.2).

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

Totalurile sunt pe scenariul de bază S0 (§3): Nr 40–41 = 2 × 300 m și Nr 57 numărat în Dn ≤ 125. În S2 (Nr 57 scos ca nestandard), E2 și totalul scad cu 110 în toate variantele. Toate variantele sunt analitice: nicio etapă nu e confirmată (#63 pct. 2b).

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

## 6. Rândurile de cantități: starea, propunerea și ce trebuie confirmat
Starea actuală a fost recitită prin SELECT la 25.09.2026 seara (Q5, Q12) și din nou la 26.09 (neschimbată). Sunt 6 rânduri, id 1751–1756, toate cu status `extras`, `tip_sursa` NULL și `obiect` NULL, categoria „Conducte și montaj”, sursa „Planșa 1 — tabel de dimensionare, citit automat din scanare”, `updated_at` = 16:51:08 (transferul). Σ `cantitate` = Σ `cantitate_plansa` = 48.195. Nicio clarificare nu e legată de ele (`ofertare_clarificari.cantitate_id`: 0). În `v_ofertare_pt_stare` (lic. 95), `lista_f3_m`, `memoriu_m`, `plansa_m` și `grafic_fronturi_m` sunt NULL.

### 6.1 Propunerea (NEAPLICATĂ): numai pasul B, condiționat

| id | Denumire | acum: cantitate / planșă / status | după pasul B (condiționat) | Motiv |
|---|---|---|---|---|
| 1751 | Dn200 | 17.785 / 17.785 / extras | **fără schimbare** | Rezultat extras, nevalidat, cu sursa și istoricul lui. Analitic: 13.765 (Nr 1–4, în afara UAT Vâlcelele) + 4.020 (Nr 5–8, UAT Vâlcelele), ambele candidate. Se decide după #63 pct. 3b / 2b și aprobarea umană |
| 1752 | Dn125 | 2.275 / 2.275 / extras | fără schimbare | — |
| 1753 | Dn110 | 780 / 780 / extras | fără schimbare | — |
| 1754 | Dn90 | 4.545 / 4.545 / extras | fără schimbare | Include 1.345 m racorduri SRS (Nr 9 1.000, Nr 10 340, Nr 97 5). Etapa se confirmă la #63 pct. 2b (informația stă în document, nu în notă) |
| 1755 | Dn63 | 9.670 / 9.670 / extras | fără schimbare | Nr 57 (110 m, citit Dn60) nu e inclus. Dn63 e o propunere nevalidată; un eventual +110 m cere un pas separat, după același model ca B |
| 1756 | Dn40 | 13.140 / 13.140 / extras | **13.740** / 13.140 / diferenta | +600 (Nr 40–41), doar după verificarea Oanei. Se schimbă numai `cantitate` (cantitatea ofertată). `cantitate_plansa` (citirea automată) rămâne 13.140 până la o recitire cu codul R4, care pe citirea reală o duce la 13.740 (§6.4) |
| **Σ** | | **48.195 / 48.195** | **48.795 / 48.195** | Față de 44.355: +4.440 în `cantitate` (scenariul S2, §3), cu Nr 1–4 incluse și nevalidate |

- Valorile pasului B presupun Nr 40 = Nr 41 = 300 și Nr 38 = 320. Blocul SQL primește lungimile verificate ca parametri; cu Nr 38 = 330 iese 13.750 / 48.805.
- **Nicio poziție nu devine aprobată prin pasul B.** Aprobarea înseamnă bifa ✓ (`status='validat'`) pusă de om în 📋 Cantități, după reconcilierea obiectului și a etapelor (criteriul 5).
- După pasul B, 1756 apare în `v_ofertare_contradictii` ca „plansa_vs_document” (13.740 vs 13.140; condiția e |planșă − cantitate| > 0,5, Q14). E intenționat: diferența dintre citirea automată și verificarea umană rămâne vizibilă până la recitire.
- **Dacă recitirea cu codul R4 are loc înaintea pasului B** (T10 / X2): retransferul pune `cantitate_plansa` = 13.740 și trece `status` din extras în diferenta; B ridică apoi `cantitate` la 13.740. Rezultatul e un rând cu `status=diferenta` **fără diferență numerică** (13.740 / 13.740), care nu apare în `v_ofertare_contradictii`. Statusul înseamnă aici „rând nevalidat, modificat de pasul B”, nu o contradicție; nota lui B spune explicit că cele două cifre coincid. Închiderea rămâne bifa ✓ a omului (criteriul 5).
- **Propunerile pentru 1756 din documentul R4 (conflict de documente).** `R4_REZERVARE_ZONE_SI_COADA_NAS.md` §5.5 propune și el SQL pentru 1756: „1756 — două variante, decizie separată pentru Razvan”, cu trimiterea „Corecția se face în reconcilierea R5, prin preview → GO Razvan (A sau B) → apply”. La capul `7a7bf86` **ambele variante sunt comentate**, în blocuri separate, fiecare cu antetul „rulează DOAR după GO Razvan pe varianta X” și condiționate pe valorile de azi (`cantitate` = `cantitate_plansa` = 13.140). Varianta A = doar `cantitate_plansa` = 13.740 și `status=diferenta`; varianta B = `cantitate` + `cantitate_plansa` = 13.740. SQL-ul variantei A e identic cu cel de la `ab5c449` (diff pe extragere). (Istoric: la `1fd76dd` era un singur UPDATE pe ambele coloane, iar la `759c5e3` varianta B era necomentată.) Relația cu acest document:
  - varianta A e **compatibilă** cu pasul B: dă aceeași stare ca o recitire R4 (13.140 / 13.740 / diferenta), iar B o acceptă. Testat (VA: SQL-ul A extras din documentul R4 și decomentat, apoi B ⇒ 13.740 / 13.740 / diferenta). Nota lui B nu atribuie cifra unei „recitiri”: spune „citirea automată sau corecția cu identitatea rândului, vezi nota anterioară”, iar nota anterioară e chiar cea scrisă de A;
  - **⚠ rollback-ul variantei A din documentul R4 NU se rulează după pasul B**: după B se folosesc doar RB / RB-manual din §7.3. La `ab5c449` acel rollback era `WHERE id = 1756`, fără alte gărzi: după A + pasul B readucea 1756 la 13.140 / 13.140 / „extras” și ștergea marcajul „R5 pas B”, deci verificarea Oanei se pierdea fără urmă, iar RB refuza apoi (reprodus de verificatorul reviziei 5). Din runda 7 (`e8489a6`) rollback-urile sunt separate pe variantă și condiționate; la `7a7bf86` rollback-ul A cere `cantitate = 13140`, `cantitate_plansa = 13740`, `status = 'diferenta'`, nota exactă scrisă de A și lipsa marcajului „R5 pas B”. Testat aici pe SQL-ul extras din `7a7bf86` (RBA, §7.3): A → B → rollback A = **0 rânduri**, pasul B intact, cu marcaj; A → B → RB → rollback A = starea inițială. Avertismentul rămâne valabil pentru orice rollback scris de mână;
  - varianta B **exclude** pasul B (B refuză, pentru că `cantitate` ≠ 13.140) și, aplicată înainte de verificarea Oanei, contrazice verdictul Copilot (b). La `7a7bf86` e comentată, dar **tot nu e condiționată de verificarea pe imagine**;
  - se aplică **cel mult un** drum care schimbă `cantitate` pe 1756: pasul B din R5, după verificarea pe imagine. Documentul R4 trebuie aliniat pe ramura lui (varianta B scoasă sau condiționată de verificarea pe imagine); aici nu e modificat.
- Notele pe 1751, 1754, 1755 și 1756 propuse în revizia 2 nu se mai scriu. Un retransfer le-ar fi șters oricum (§6.4); informația rămâne în acest document.
- **Reprezentarea analitică 13.765 + 4.020 în platformă.** Deocamdată nu se scrie nimic. Dacă Razvan o vrea vizibilă în 📋 Cantități, locul e `specificatii` pe 1751, fiindcă transferul scrie `specificatii` doar la insert, nu la update (Q14). Se face fără rând nou, fără schimbarea lui `cantitate` sau `status`, cu GO separat. Acum nu se propune.

**Risc comercial.** Nici 17.785, nici 4.020, nici vreun scenariu din §3 nu e cantitatea de ofertat. Dacă AC confirmă că Nr 1–4 fac parte din obiect (textul CS p.5 sugerează asta), în ofertă intră și cei 13.765 m. Dacă AC răspunde că nu fac parte, rămân 4.020 m Dn200. Decizia comercială îi aparține lui Razvan, după răspunsul la #63.

### 6.2 Pozițiile de verificat pe imagine (Oana Nica), cu locator
**Imaginea.** Doc 470, „Schema tehnologica Valcelele alimentare din Stefan Voda.pdf” (`95/atribuire/mu6wbbqw_…`), pagina 1. E randată la 200 dpi, 9.362 × 6.623 px, cu grila de 7 coloane × 5 benzi, latura 1.600 px și suprapunere 12%. Feliile sunt în Storage, `95/felii/470` (Q13).
**Tabelul.** Tabelul „Dimensionare” e în dreapta sus și e tăiat în două coloane de felii:
- z?_6: Nr crt, noduri, Sat, Strada, capete;
- z?_7: Strada, capete, Dn, Q, Lungime Km.
Rândurile de fragment se numără de la 1 în fiecare felie.

| Poziție | Ce se verifică | Locator (Q13) | Lectura automată | Efect |
|---|---|---|---|---|
| **Nr 40** | lungimea | z2_6 rândul 9 (Nr crt 40, noduri 34→59, C-tin Brancoveanu) × z2_7 rândul 9 (0,300 km, Dn40, Q20). `zone_geom` z2_6 = [x 7040, y 1408, 1600 × 1600], z2_7 = [7762, 1408, 1600 × 1600] | 300 m | +300 în pasul B |
| **Nr 41** | lungimea | z2_6 / z2_7 rândul 10 (34→60), aceleași felii | 300 m | +300 în pasul B |
| Nr 37 (reper) | că e alt rând decât 40–41 | z2_6 / z2_7 rândul 6 (33→61); și z1_7 rândul 37 | 300 m | — (e deja în 13.140) |
| **Nr 38** | 320 sau 330 | z2_6 / z2_7 rândul 7 (33→62) = 0,320. z1_6 se oprește la Nr 37 și notează rândul 38 tăiat. z1_7 notează „0,330” pentru rândul tăiat | 320 / 330 | 0 sau +10 |
| **Nr 57** | Dn60 sau Dn63 | z2_6 / z2_7 rândul 26 (40→41, Florența Albu, Crinului→Rozelor, 0,110 km, Q40) | Dn60 | 0 / +110 pe 1755 (pas separat) |
| Nr 37–38 | strada: Aurel Vlaicu sau C-tin Brâncoveanu | z2_6 rândurile 6–7 | C-tin Brancoveanu | doar denumirea |
| Adnotări Dn200 fără pereche | ramificații în afara tabelului sau citiri greșite | idx 121, 122 (z3_2), 199, 200, 201 (z4_2): 3.226 m. Plus idx 119 (Dn90 1.080), 124 (Dn125 2.350), 125 (Dn90 5.005) | — | 0 acum (adnotările nu intră când există tabel) |

Rezultatul verificării are nevoie de: cine a verificat, data și cele trei valori (Nr 40, Nr 41, Nr 38). Acestea sunt constantele pasului B.

### 6.3 Consumatorii: „nu folosim cantități nevalidate drept aprobate”
Livrabil separat: `docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md`, pe ramura `claude/cantitati-nevalidate-consumatori`, capul **`6313184`** (26.09 06:37:43Z). Starea: **remediat în cod pe ramură, verificat adversarial (runda 5 confirmată: 0 blocante, 0 majore, 4 minore), nedeployat** (nepushată, fără PR).
- Commiturile peste R4 `7a7bf86`: `e5273f5` (fixul inițial), `5a47658` + `31ed808` + `5303ee4` + `f2e3082` (runda 4), `f78afa8` (interacțiunea R4 × R5 după rebase-ul 2), `828aa4e` (rebase-ul 3 peste R4 runda 9: testul R4 TOTAL-a adaptat la regula R5 „cifra schimbată pe un rând VALIDAT ⇒ diferenta”), `c68c8e7` (condiția 1), `5ab80c1` (condiția 2), `f6fdd51` (docs), `6313184` (runda 5: „invalidat” citit din istoric, prag față de valoarea aprobată, `um` exact, TRUNCATE închis).
- Ramura o conține pe R4 (`7a7bf86`), deci un merge al ei aduce și tot codul R4 (§6.5), inclusiv cele 2 majore deschise pe rândurile TOTAL. Dacă R4 primește o rundă nouă, ramura se reașază din nou peste ea.
- Teste reproduse la ~07:00Z pe o copie `git archive` a lui `6313184`, cu type-check: `deno test -A supabase/functions/` **190/190**, din care `ofertare-plansa-citeste/` **168/168**. Verificatorul rundei 5: 9/9 mutații prinse; PGlite pentru trigger și view.

Aici e doar legătura. Detaliile, testele și SQL-ul propus sunt în livrabil. Regula lui este **aprobat = `status='validat'`**; `extras`, `diferenta` și `revizuit_clarificare` sunt date de lucru.

| Consumator cerut de Copilot | Ce constată livrabilul (la `6313184`) |
|---|---|
| Calcul financiar | Niciun cod de calcul financiar, deviz sau preț nu citește `ofertare_cantitati`: nu există consumator |
| F3 / centralizator | Nu se generează F3 sau centralizator din `ofertare_cantitati`: nu există consumator |
| Grafic | Rândul „cant” e BLOCK cât timp lipsesc rânduri necesare nevalidate, cu lista lor (inclusiv rândurile invalidate ieșite din rețea); fronturile se propun doar din rânduri validate, iar un rezultat parțial e marcat „INCOMPLET” |
| Generator PT | Indirect, prin grafic; din runda 5, poarta propunerii reverifică graficul înghețat față de cantitățile de acum (WARN „de reverificat”) |
| Poartă finală (H2 „Cantitățile rețelei”) | F3 nevalidată = BLOCK; rândurile invalidate ieșite din rețea = BLOCK; rândurile fără tip de sursă = WARN „INCOMPLET” (lic. 95: 6 rânduri / 48.195 m). Depinde de view-ul nou propus, neaplicat |
| În plus | generatorul de clarificări (`status_validat`, lista nu mai e tăiată tacit), recitirea planșei și citirea CAD (nu mai scriu `validat` și nu mai lasă „validat” peste o cifră nevăzută), insigna „⚠ transfer” pentru pozițiile nescrise / de verificat |

**Condițiile Copilot din 26.09 dimineața** (erau netratate la `7fccfbe`):
- (1) **invalidarea nu privește doar cifra**: o schimbare relevantă de unitate, Dn, material, SDR, tronson / etapă (`obiect`), sursă (`tip_sursa`, `sursa`, `cod_articol`) sau cifră scoate rândul din `validat`, cu aprobarea veche numită în notă. Regula e într-o singură sursă (`src/ofertareCantitatiInvalidare.js`, cu copii verificate octet cu octet pentru Vercel și edge). Istoricul (valoarea și aprobarea veche) și pragul față de valoarea aprobată vin din migrarea propusă `R5_MIGRARE_PROPUSA_aprobare_istoric.sql` (tabel + trigger), neaplicată; până atunci aplicația compară cu rândul de acum;
- (2) **rândul invalidat nu dispare tacit**: consumatorii semnalează rândurile lipsă și cer reverificarea rezultatelor dependente (tabelul de mai sus; livrabilul §9).

**Ce rămâne deschis la `6313184`:**
- **nepotrivirea marcajului pasului B (găsită la această revizie, §6.4)**: codul recunoaște rândul corectat prin constanta `MARCAJ_R5B = ' | R5 v2 pas B'` (`handler.ts` l.1094), iar SQL-ul pasului B din §7.3 scrie `' | R5 pas B ('`. Pe nota reală, `corectieR5B` dă `false`, deci protecția nu se aplică. În plus, testele ramurii modelează pasul B cu `cantitate_plansa` = 13.740 (cifra corectată în coloana planșei), pe când pasul B din §7.3 schimbă numai `cantitate`. Alinierea cere o decizie (ramura consumatorilor sau acest document), nu doar schimbarea literalului;
- minorele verificatorului rundei 5: un rând de rețea **niciodată validat** poate ieși tacit din rețea după o editare (m → ml, altă categorie, „total” în obiect: retea_nevalidate_m scade de la 24.330 la 23.630, fără semnal; cere editare explicită, 0 cazuri „ml” în BD azi); istoricul se citește fără paginare (posibil plafon de 1.000 de rânduri în PostgREST; azi 0 evenimente); cifra 164/164 din livrabil trebuie să fie 168/168; rândurile TOTAL invalidate sunt tratate diferit în JS și în view (conservator);
- decizii pentru Razvan (livrabilul §6): coliziunea pe un rând validat ⇒ varianta B (luată pe principiul Copilot, de confirmat); ramurile „doar de verificat” / MY-T4 / „total cu Dn” pe un rând validat scriu doar notă; `um` comparat exact;
- „validat” n-are autor și nici oră în tabelă; istoricul n-are încă ecran.

Derivatele lic. 95 recitite aici (Q12, 25.09 seara) sunt toate zero: `grafic_parametri`, `grafic_versiuni`, `grafic_activitati`, `ofertare_pt_poarta`, `ofertare_pt_pachet` și `ofertare_verificari` au câte 0 rânduri, iar `v_ofertare_pt_stare` are câmpurile de cantități NULL. Deci **nimic nu s-a propagat încă**, iar criteriul 6 („verificarea propagării”) se face după aprobare, pe aceleași surse.

### 6.4 Efectele unui nou transfer din planșă (retransfer)
Retransferul înseamnă `treciInCantitati` plus RPC-ul `ofertare_transfer_plansa_cantitati`. La update, RPC-ul scrie doar `cantitate_plansa`, `diferenta_nota`, `status` și `updated_at`; `specificatii` se scrie numai la insert (Q14). Există trei variante de cod, cu efecte diferite pe 1756:
- **codul deployat azi**: versiunea 25, `COD_VERSIUNE` 2026-09-25.5, deduplicare pe text; `handler.ts` identic la `8a6fbbb` și `origin/main` `a4b2982`, l.248–357;
- **R4 singur** (`7a7bf86`; notele sunt identice cu cele de la `ab5c449`);
- **R4 + consumatorii** (`6313184`; notele sunt identice cu cele de la `7fccfbe`), adică ce ajunge în producție la merge-ul ramurii consumatorilor, care o conține pe R4.

Notele de mai jos sunt reproduse pe copii ale capetelor (Q19): la revizia 5 pe `ab5c449` / `7fccfbe`, la revizia 6 din nou pe `7a7bf86` / `6313184`, cu 1756 exact cum îl lasă SQL-ul pasului B din §7.3 (nota lui reală, cu marcajul „ | R5 pas B (…)”).

- Pe **1751–1756**, retransferul rescrie **`diferenta_nota` în întregime** (RPC-ul face `diferenta_nota = patch`) și rescrie `cantitate_plansa`. **`cantitate` nu e atinsă niciodată.** Pe 1751 nu mai apare ambiguitatea Dn200 din revizia 2, fiindcă nu mai există un al doilea rând Dn200. **Marcajul „R5 pas B” din notă se pierde la orice retransfer care atinge 1756**, cu oricare dintre cele trei variante de cod. Consecințe:
  - **B nu se mai poate rula a doua oară**: refuză, fiindcă `cantitate` ≠ 13.140, cu mesajul „pasul B pare aplicat deja (un retransfer șterge marcajul din notă)”;
  - **RB refuză**, fiindcă marcajul lipsește;
  - rollback-ul se face cu **RB-manual** (§7.3): readuce `cantitate` 13.140 și, dacă cifra planșei e aceeași ca în R0, statusul și **nota din snapshot-ul R0**; altfel pune o notă neutră. Are aceleași gărzi de serializare ca RB. Toate trei sunt testate local (T9: rândul 1756 identic cu R0). RB-manual refuză dacă cifra planșei nu e 13.140 sau 13.740, de exemplu după o citire parțială.
- **Cu codul deployat azi**, 1756 primește din nou `cantitate_plansa` = 13.140. Dacă pasul B e aplicat, nota devine „Memoriu 13.740 m vs planșa 1 13.140 m (-600 m, …)”. Eticheta „Memoriu” e greșită: 13.740 e cifra verificării umane.
- **Cu R4 singur** (`7a7bf86`, identitatea rândului, §6.5):
  - **înainte de B**: 1756 primește `cantitate_plansa` = 13.740, `status` trece din extras în diferenta, iar nota devine „Memoriu 13.140 m vs planșa 1 13.740 m (+600 m, pe 56 tronsoane …)” (R4 §5.5; testul „identitate 470: retransfer…”);
  - **după B**, codul tratează `cantitate` (cifra verificată de om) drept „memoriu”:
    - B = 13.740 ⇒ „Planșa 1 confirmă: 13.740 m.”, adică cifra verificării umane e prezentată drept memoriu confirmat de planșă;
    - B = 13.750 (Nr 38 = 330) ⇒ „Memoriu 13.750 m vs planșa 1 13.740 m (-10 m, …)”;
    - citire parțială 10.440 ⇒ „Memoriu 13.740 m vs planșa 1 10.440 m (-3.300 m, …)”.
- **Cu R4 + consumatorii** (`6313184`):
  - **înainte de B**: `cantitate_plansa` 13.740, `status` diferenta, nota „Diametru care nu apare în cantitățile din memoriu. Planșa 1 (recitire) dă 13.740 m pe 56 tronsoane — rândul are 13.140 m din citirea anterioară (+600 m); cifra nu e confirmată, verifică pe planșă.” (aserțiune în `concurenta_test.ts` l.856 la `7fccfbe`);
  - **după B**, fix-ul consumatorilor schimbă eticheta, dar nu o corectează în toate cazurile:
    - B = 13.740 și recitire completă 13.740 ⇒ „(recitire) dă 13.740 m … (valoare din planșă, nu confirmare din memoriu)”. Nota nu e falsă, dar nu mai spune că 13.740 e verificarea Oanei;
    - B = 13.750 ⇒ „rândul are 13.750 m din citirea anterioară (-10 m); cifra nu e confirmată, verifică pe planșă.”;
    - citire parțială 10.440 ⇒ „rândul are 13.740 m din citirea anterioară (-3.300 m); cifra nu e confirmată …”.

    În ultimele două cazuri, valoarea verificată de Oana e numită „citire anterioară” și „neconfirmată”, deci cineva o poate „corecta” înapoi.
- **Remedierea etichetei pe ramura consumatorilor: implementată la `6313184`, dar fără efect pe pasul B din acest document.** Ramura a introdus `MARCAJ_R5B = ' | R5 v2 pas B'` și `corectieR5B` (`handler.ts` l.1094–1095; eticheta „cifra corectată și verificată de om pe imaginea planșei (pasul B din R5 v2)”, cifra nu se suprascrie și nu se golește, marcajul se păstrează la sfârșitul notei, prin `plasaAprobare`, l.1119). SQL-ul pasului B din §7.3 scrie însă `' | R5 pas B ('`, iar gărzile lui și ale rollback-urilor R4 caută `'%R5 pas B%'`. Probă la revizia 6 (copie `git archive` a lui `6313184`, `treciInCantitati` cu nota reală a lui B): `corectieR5B` = `false`; S1–S4 dau exact notele de mai sus („valoare din planșă”, „rândul are 13.750 / 13.740 m din citirea anterioară … nu e confirmată”), iar **marcajul se pierde în toate cazurile** (RB refuză apoi, rămâne RB-manual). Pe lângă literal, modelul diferă: testele ramurii pun cifra corectată în `cantitate_plansa` (13.740 / 13.740), pe când pasul B de aici schimbă doar `cantitate` și lasă `cantitate_plansa` ca istoric al extragerii. Doar schimbarea literalului ar face codul să numească „corectată de om” cifra automată 13.140. De decis (Razvan / runda următoare): fie codul recunoaște marcajul „ R5 pas B” și eticheta numește `cantitate` drept valoarea verificată (recitirea poate actualiza `cantitate_plansa`), fie pasul B se rescrie după modelul ramurii (atunci și gărzile RB / RB-manual și rollback-urile R4). Până atunci, după orice retransfer, starea lui 1756 se recitește (B-verif) înainte de orice acțiune pe baza notei.
- **Pasul B funcționează și după o recitire cu identitatea rândului** (R4 singur sau R4 + consumatorii), fiindcă nu depinde de o notă pusă anterior. Ridică `cantitate` la valoarea verificată, iar Σ planșă rămâne 48.795 (T10). Nota lui B spune atunci că `cantitate_plansa` are aceeași valoare, nu că „rămâne 13.740 până la recitire” (X2); statusul `diferenta` fără diferență e explicat în §6.1. Dacă recitirea vine **după** B, marcajul se pierde, RB refuză, iar RB-manual pune o notă neutră, fiindcă cifra planșei s-a schimbat față de R0 (X2b).
- Cifrele R4 de mai sus sunt reconfirmate la capete: testul „identitate 470: retransfer…” trece la `ab5c449` și la `7fccfbe` (revizia 5) și e în suitele verzi de la `7a7bf86` (158/158) și `6313184` (190/190) (1756 `cantitate_plansa` 13.740, `status` diferenta, `cantitate` 13.140 neatinsă; §6.5, Q18). În BD se reconfirmă după merge, deploy și recitire.
- Pentru un retransfer e nevoie de un „citește” complet: retăiere plus ~35 de zone plătite (ultima citire completă a lui 470 a costat 2,595 USD). „Continuă” și „reia” nu retransferă (R4 §5.5). `ofertare-clarificari-propune` citește rândurile care au `diferenta_nota`; rulează numai la cerere și e o procesare plătită.

### 6.5 Remedierea de cod: deduplicarea pe identitatea rândului (ramura R4)
**Stare la 26.09, ~07:00Z: remediat în cod pe ramură, nedeployat; reverificarea capului actual nu a confirmat.** Copilot a cerut ca bugul de deduplicare să fie „reparat și testat acum”. Reparația e pe ramura `claude/r4-rezervare-zone`: capul `7a7bf86`, codul în `3197aa3`, `COD_VERSIUNE` 2026-09-26.13. Ramura e locală, fără ramură pe `origin` și fără PR. Reverificarea rundei 6 (`ab5c449`) a confirmat; rundele 7–9 au închis căile tăcute găsite apoi, iar reverificarea rundei 9 (`7a7bf86`) are **2 majore deschise** (TOTAL-a, TOTAL-b) și 3 minore, detaliate mai jos. Criteriul 2 **nu e închis**: lipsesc fixul celor 2 majore și o reverificare care confirmă, push + PR, merge + deploy (GO) și recitirea lui 470 (GO separat).

- **Istoric.** Revizia 2 propunea deduplicarea pe **multiset** (maximul aparițiilor unei chei într-o felie; implementată pe R4 în `e762c6e`). Copilot a respins-o. Contraexemplul lui: rândul 37 în felia A și rândul 40 în felia B, cu text identic, dau max(1,1) = 1, deși corect e 2. Simularea Q9 rămâne doar ca istoric.
- **Regulile de identitate implementate**, pe runde. Fiecare rundă are commitul ei de cod și unul de documentație (R4 §5.3–5.7), iar cazurile adversariale ale verificatorului rundei anterioare intră ca teste de regresie. Toate cele 11 teste noi ale rundei 4 pică pe `a800d38`, cele 11 ale rundei 5 pe `a9fe186`, iar 6 dintre cele 9 ale rundei 6 pe `f1274a1` (celelalte 3 sunt controale). Controalele negative prin mutații sunt în R4 §5.6.

| Runda | Cod / docs | `COD_VERSIUNE` | Regula adăugată | Suita planșei |
|---|---|---|---|---|
| 3 | `a800d38` / `1fd76dd` | 2026-09-25.7 | Identitate = (document, pagină, tabel identificat, Nr crt). Tabelul identificat = semnătura antetelor, iar felia și regiunea sunt doar proveniență. Observațiile aceleiași identități = un rând. L, Dn sau Q diferite = conflict, fără alegere automată. Ce nu are identitate sigură = „de verificat”, cu motiv. Un tabel fără Nr primește identitate prin poziție doar într-o singură bandă | 78 |
| 4 | `a9fe186` / `759c5e3` | 2026-09-26.8 | Poziția e interzisă în grupul împerecheat cu un fragment cu Nr (`MOTIV_AFARA_NR`, rândul de margine). „Nr repetat” în componente diferite sau în felii nevecine. Text contrazis pe Strada / De la ⇒ fără contopire. Indexul tabelului intră în cheia de poziție. Semnalul `nr_fara_lungime`. La transfer, un Dn doar „de verificat” primește notă sau golire, fără early-return | 89 |
| 5 | `f1274a1` / `8db5587` | 2026-09-26.9 | Poziția e interzisă în coloana de felii a unui tabel cu Nr, în orice bandă (`MOTIV_COLOANA_NR`): felia cu Nr lipsă sau cu antete altfel, V1–V4. Restul de la transfer are cheia (Dn, material). TOTAL „extras” cu rest ⇒ „diferenta”. `perechi_neimperecheate` intră în sumar | 100 |
| 6 | `f1c4b66` / `ab5c449` | 2026-09-26.10 | Vecinătatea feliilor se decide pe geometria reală (`zone_geom`, toleranță 2 px) pentru împerechere, „Nr repetat” și coloana cu Nr; asta acoperă și coloana fixată la marginea planșei. Fără geometrie: poziția e interzisă pe toată pagina unui tabel cu Nr (`MOTIV_COLOANA_NR_FARA_GEOM`). Coliziunea a două grupuri sigure pe aceeași poziție ⇒ ambiguu: `cantitate_plansa` neatinsă, „extras” ⇒ „diferenta”, o singură scriere pe id, rezultat independent de ordine | 109 |
| 7 | `f4406c7` + `cc2c77f` + `05b92cb` / `e8489a6` | 2026-09-26.11 | Regresiile Copilot COPILOT-REG-1…4 (37/40/41 cu același text = 3 rânduri; același rând din zone suprapuse = o dată, cu sursele în `_surse`; antete identice ≠ același tabel; identitate ambiguă = de verificat, cu total separat). Căile tăcute devin vizibile: B1 (fără geometrie, tabel fără Nr sub coloana fixată), B2 (dublă parțială), B3 (goluri în secvența Nr ⇒ total marcat incomplet), B4 (comasare peste capacitatea fâșiei / integrală). MY-T4, feliile identice netăiate de două ori, rollback-urile 1756 condiționate | 122 |
| 8 | `4e0591d` + `294a739` / `b5e7ecd` | 2026-09-26.12 | Nr citit fără lungime (NFL, și în tabelul compact) cu regimul lui B3; B2 pe subsecvența comună (LCS); B4 pe tabel; TOTAL = „total” fără Dn; rollback-urile 1756 condiționate și pe status | 132 |
| 9 | **`3197aa3` / `7a7bf86`** | **2026-09-26.13** | TOTAL cu interval de Dn („De 63–110”) și prioritatea pozițiilor fără „total”; NFL-DN (rândul fără lungime atinge poziția Dn-ului lui); DN0 (tronsonul sigur fără Dn nu mai dispare tăcut la transfer); NFL fără fals-pozitive; rollback-ul A condiționat și pe nota exactă | **141** |

  Codul la `7a7bf86`, în `handler.ts`: l.38 `COD_VERSIUNE`, l.300 `dnuriDenumire`, l.457 `identificaRanduri` (apelată la l.1848), l.993 `descriereRestDn`, l.1015 `notaRestTransfer`, l.1060 `treciInCantitati`, l.1465 `agregaTronsoane`, l.1496 `raportIdentitate`. La `6313184`: `identificaRanduri` l.459 (apelată la l.2008), `treciInCantitati` l.1139 (exportată), `plasaAprobare` l.1119, `agregaTronsoane` l.1625. Istoric, la `ab5c449`: l.262 `TOL_GEOM_PX`, l.307 `perechePosibila`, l.317 `seSuprapun`, l.335–337 motivele, l.385 `identificaRanduri` (apelată la l.1400), l.523 `coloanaCuNr`, l.748 `treciInCantitati`, l.1066 `agregaTronsoane`. La `7fccfbe`, funcțiile de identitate au aceleași linii (`identificaRanduri` e apelată la l.1481), iar `treciInCantitati` e la l.781.
- **Pe citirea reală 470** (fixture = BD, md5 identic pe cele 8 felii, cu `zone_geom` real din BD, 35 de zone; R4 §5.4), la `ab5c449`, identic cu rundele 3–5 (după raportul rundei 9, cifrele de referință sunt neschimbate la `7a7bf86`: 470 = 133 / 48.905 m, 130 = 18 / 37.320 m):
  - 152 de lecturi → 133 de rânduri, toate prin Nr, 0 de verificat, 0 conflicte, în orice ordine a feliilor;
  - `total_sigur_m` = **48.905** (S0);
  - în cantități: 132 de rânduri / 48.795 m (S2), fiindcă Nr 57 Dn60 e scos de regula nestandard; Dn40 = 13.740;
  - adnotările rămân 75 / 34.732 m;
  - retransferul simulat (testul „identitate 470: retransfer…”, trece și la `7fccfbe`): 1756 `cantitate_plansa` 13.740, `status` diferenta, `cantitate` 13.140 neatinsă;
  - 130 (lic. 3) = 18 rânduri / 37.320 m, prin poziție.
- **Teste reproduse la revizia 6 (~07:00Z)** pe copii `git archive`, cu `deno test --node-modules-dir=none --no-lock -A` și type-check: `7a7bf86` `supabase/functions/` **158/158** (planșa 141/141); `6313184` **190/190** (planșa 168/168); `deno.lock` neatins (md5 `875e293d…`).
- **Teste reproduse la revizia 5 (02:50Z, istoric)** pe copii `git archive`, cu `deno test --node-modules-dir=none --no-lock -A` (Q18):
  - `ab5c449`: `supabase/functions/` **126/126** cu type-check; `agregare_test` + `concurenta_test` + `poarta_test` **109/109**;
  - `7fccfbe`: `supabase/functions/` **149/149** cu type-check.

  Verificatorul rundei 6 a mai rulat `concurenta_test` de 10 ori (10/10), `test-cas-felii` 34/34, `test-detector-sigla` 23/23 și `deno check` (exit 0), plus 9 mutații proprii și un control negativ pe `f1274a1`.
- **Cazurile adversariale ale verificatorilor**. Coloana „înainte” e ultimul commit fără fix-ul respectiv. Rezultatele la `ab5c449` sunt reproduse de mine (Q18), cu excepția rândurilor marcate „verificatorul rundei 6”:

| Caz | Înainte de fix | La `ab5c449` (capul rundei 6; pentru rundele 7–9 vezi tabelul căilor tăcute de mai jos) | Test de regresie pe ramură |
|---|---|---|---|
| Rând de margine: Nr 38 transcris în plus la baza lui z1_7 (tăiat în z1_6) | `1fd76dd`: 134 / **49.225 m**, 0 de verificat, 0 conflicte | 133 / **48.905** + 320 m de verificat („în afara fragmentului cu Nr”), 0 conflicte | da („runda 4 BLOCANT (fixture 470)”) |
| Același, Nr 31 în plus la vârful lui z2_7 | `1fd76dd`: 134 / **49.205 m**, fără semnal | 133 / **48.905** + 300 m de verificat | da (același test) |
| Sintetic: rând de margine în plus în felia cu L (ADV-G) | `1fd76dd`: 6 rânduri / 1.900 m | 5 / 1.500 + 400 m de verificat | da („runda 4 BLOCANT (sintetic)”) |
| Nr 40 citit „41” în aceeași felie (ADV3b) | `1fd76dd`: 132 / **48.605 m** (Nr 40 lipsă), 0 de verificat | 131 / 48.305 + **600 m de verificat** (Nr 40 și 41, „Nr repetat”) | nu ca test propriu; același mecanism ca C2 |
| Nr 40 citit „38” (ADV3a) | `1fd76dd`: conflict | 131 / 48.285 + 620 m de verificat. Semnalul s-a schimbat (aserțiunea veche „conflict” pică), dar nu e pierdere | nu |
| Două tabele diferite cu aceleași antete, felii nevecine (ADV4) | `1fd76dd`: Nr 2 contopit tăcut (1 rând sigur de 300 m) | 0 sigure, 6 lecturi / **1.870 m de verificat** | nu ca test propriu; același mecanism ca B |
| Antete identice: benzi nevecine (B) / aceeași felie (C) / Nr repornit (C2) | `a800d38`: 3 / 900 m; 2 / 600 m; 2 / 600 m | 0 sigure; 1.800 / 1.200 / 1.200 m de verificat | da |
| Două tabele fără Nr în aceeași felie (D) | `a800d38`: 300 m sigur + un conflict fals; 300 m pierduți | 4 rânduri / 950 m | da |
| Rânduri inversate la transcriere în z2_7 (ADV5) / un rând sărit în z2_7 (ADV-H) | — | banda 2 de verificat: 93 / 40.095 m sigur + 11.600 / 11.380 m; nimic atribuit greșit | nu |
| **Felia cu Nr a unei benzi lipsă** (470 fără `z1_6` / `z2_6` / `z3_6` / `z4_6`) sau **antetele ei transcrise altfel** (`z2_6`) | `a9fe186` (identic la `1fd76dd`): 139 / 50.105; 145 / 51.695; 146 / 52.975; 140 / 51.385; 145 / 51.695 m, toate cu 0 de verificat (umflare tăcută) | 102 / 24.235 + 25.870; 93 / 40.095 + 11.600; 94 / 39.770 + 13.205; 129 / 47.885 + 3.500; 93 / 40.095 + 11.600 m de verificat; 0 poziții, 0 conflicte | da („runda 5 BLOCANT” V1–V4, E2E V4) |
| Coloana fixată la marginea planșei acoperă `_N-1`, felia din mijloc netranscrisă (GEOM-1 / GEOM-2, W = 7.340) | `f1274a1`: 6 / **1.500 m** sigur, 0 de verificat | 3 / **750 m** sigur (verificatorul rundei 6) | da („runda 6 MAJOR”) |
| Același prin handler + RPC simulat (GEOM-E2E, W = 7.140) | `f1274a1`: Dn63 1.100, Dn40 400, „diferenta” falsă | Dn63 550, Dn40 200, „confirmă” (verificatorul rundei 6) | da |
| Două grupuri sigure pe aceeași poziție: PE 500 + OL 90 / PE 500 + fără material 300 | `f1274a1`: 90 / 300 (ultimul câștigă, 500 m pierduți) | cifra veche neatinsă, notă cu toate grupurile, „diferenta”, intrare în `ambigue`, aceeași stare în orice ordine (verificatorul rundei 6) | da (2 teste R4; plus testele interacțiunii cu R5 la `7fccfbe`) |
| Transfer: Dn cu toate rândurile „de verificat” (ADV-T) | `a800d38`: poziția păstra tăcut vechiul `cantitate_plansa` și vechea notă | poziția validată / diferenta: 34.465 păstrat, nota îl numește „dintr-o citire anterioară”; poziția „extras”: cifra golită | da |
| Tabel **fără Nr**, fără `zone_geom`, acoperit de coloana fixată (ADV7-A) | `f1274a1`: 6 / 1.500 m | **identic: 6 / 1.500 m sigur, 0 de verificat** (corect 750). Umflare tăcută rămasă, dar numai fără geometrie; cu geometrie: 750 m (verificatorul rundei 6, minorul 1) | nu |

- **Căile tăcute după runda 6 și starea lor la `7a7bf86`** (verificatorul reviziei 5 a numit patru; rundele 7–9 și reverificările lor au mai găsit altele). Cifrele sunt din documentul R4 la `7a7bf86` (§5.3, §5.6, §5.7) și din rezultatul reverificării rundei 9; niciun caz nu apare pe datele de azi:

| Cale | La `ab5c449` | La `7a7bf86` | Ce rămâne tăcut |
|---|---|---|---|
| (1) Tabel fără Nr, fără `zone_geom`, sub coloana fixată (ADV7-A) | 6 / 1.500 m sigur, 0 de verificat (corect 750) | **vizibil** (B1, runda 7): 750 m sigur + 750 m de verificat, `MOTIV_FARA_GEOM_COLOANA_FIXATA` | nimic pe calea asta; regula e deliberat largă (fals-pozitive vizibile) |
| (2) Transcriere dublă parțială a unui tabel fără Nr, în aceeași felie | 5 / 1.250 m sigur, 0 de verificat (corect 750) | **vizibil** (B2, runda 7; LCS din runda 8): 3 / 750 m + 500 m de verificat | **umflare posibilă** sub pragul LCS (un singur rând comun sau mai puțin de jumătate din tabelul mai scurt) |
| (3) Rând absent din ambele felii (golurile din secvența Nr) | 470 fără Nr 50: 132 / 48.685 m, 0 de verificat, niciun semnal | **vizibil** (B3, runda 7): aceleași 132 / 48.685 m + `nr_lipsa`, `total_sigur_incomplet`, avertisment, ⚠; la transfer 1751–1756 „diferenta”, cu golul în notă | **pierdere** la rândul omis de AI la **capătul** tabelului (acolo rămân doar `nr_fara_lungime` / `perechi_neimperecheate`, când există) |
| (4) Două tabele cu antete, L, Dn, Q și text identice, în benzi vecine | numărate ca unul, fără semnal | **vizibil** (B4, runda 7; pe tabel din runda 8): peste capacitatea fâșiei ⇒ de verificat; sub capacitate ⇒ semnal când comasarea e integrală | **pierdere** la numerotări care se suprapun parțial (ambele felii văd și rânduri din afara fâșiei) |
| Nr citit, lungime necitită (găsit de verificatorul rundei 7) | fără semnal la transfer | **vizibil** (NFL, runda 8; NFL-DN, runda 9) | — |
| Tronson sigur fără Dn citit, la transfer (DN0, găsit de verificatorul rundei 8) | dispărea din poziții și TOTAL | **vizibil** (runda 9): avertisment, sumar, notă, „diferenta”, ⚠ | — |
| **TOTAL-a** (reverificarea rundei 9, regresie față de `e8489a6`) | — | subtotalul „Total conducte PE De 110” cu materialul grupului primește 500 „confirmă”; poziția reală „Conductă distribuție gaze Dn110” păstrează **tăcut** 480, fără notă și fără `ambigue` (ADV10-1). Pe calea „doar de verificat”, poziția „extras” rămâne 280, trebuia golită (ADV10-8). Cauza: `preferaFaraTotal` se aplică după filtrul pe material | **deschis** (major) |
| **TOTAL-b** (reverificarea rundei 9, regresie față de `e8489a6`) | — | „Total rețea Dn 63÷110”, „De 63 ÷ 110”, „Dn 63, 90 și 110” ⇒ `dnuriDenumire` = {dn:[63]}: TOTAL-ul validat de 1.100 primește 200, cu notă falsă, iar poziția Dn63 nu se inserează (ADV10-7). §5.7 din R4 numește ca limită doar „63/110” și „Dn 63 la 110” | **deschis** (major) |

- **Alte limite** (documentate în R4 §5.7, fără efect pe datele de azi):
  - dintre mai multe rânduri TOTAL, doar primul primește cifra; celelalte nu se ating, fără notă; TOTAL primește suma tuturor grupurilor chiar dacă intervalul din denumire e mai îngust;
  - o poziție reală care conține „total” („… lungime totală”) pierde prioritatea în fața unei poziții fără „total” pe același Dn (ADV10-2: primește notă și „diferenta”, deci vizibil; la `b5e7ecd` era ambiguu); minorul „≥ 2 Dn fără interval” n-are test (mutația trece toate cele 127 de teste din agregare și concurență);
  - `total_de_verificat_m` e un plafon brut (o lectură din suprapunere poate fi numărată de două ori);
  - **MY-T4**: restul fără material pe un Dn cu grup sigur marchează celelalte poziții de pe Dn (runda 7), dar nu le golește cifra;
  - **`posibila_dublura`** caută încă primul rând cu lungime ±1% **indiferent de Dn** (`agregaTronsoane`, l.1465 la `7a7bf86`). Nu schimbă totalul, dar identificarea rămâne slabă (§3);
  - două **decizii pentru Razvan** (R4 runda 6): la coliziune, cifra veche rămâne în `cantitate_plansa`, cu notă și „diferenta” (alternativa: golire pe „extras”); fără geometrie, poziția e interzisă pe toată pagina (alternativa: ±2 coloane). Pe rândurile **validate**, ramura consumatorilor aplică deja varianta B (§6.3).
- **Rămâne de făcut (pentru închiderea criteriului 2):**
  - fixul celor 2 majore (prioritatea pozițiilor fără „total” **înainte** de filtrul pe material, în `tinte` și în `doarDeVerificat`; separatorii „÷”, „/”, „la” și listele de Dn în `dnuriDenumire`), testele ADV10-1 / ADV10-7 / ADV10-8 și „Dn63 și Dn110”, §5.5 / §5.7 din R4 corectate, apoi o reverificare independentă care confirmă. Ramura consumatorilor se reașază peste noul cap;
  - push + PR și merge + deploy, cu GO Razvan. Ramura consumatorilor (`6313184`) o conține pe R4, deci un singur PR le poate livra pe amândouă (întâi migrările consumatorilor, §6.3). Se deployează edge-ul `ofertare-plansa-citeste` (plus `ofertare-clarificari-propune` pentru consumatori) și Vercel;
  - recitirea lui 470 (procesare plătită, ~2,6 USD, GO separat) și reconfirmarea în BD: 48.905 sigur, 132 / 48.795 în cantități, 1756 `cantitate_plansa` = 13.740 (`cantitate` rămâne 13.140 până la pasul B);
  - alinierea marcajului pasului B între ramura consumatorilor și §7.3 (§6.4);
  - pe ramura R4: varianta B pentru 1756 scoasă sau condiționată de verificarea pe imagine (§6.1).
- **Livrare:** nimic pushat, mergiuit sau deployat. În producție rulează versiunea 25 (`COD_VERSIUNE` 2026-09-25.5, deduplicare pe text). Conform ordinii Copilot (§7.1), protecția consumatorilor vine înainte.

### 6.6 Ce trebuie confirmat prin răspunsul la #63
#63: `status=de_trimis`, `raspuns=NULL`, `raspuns_la` NULL (Q8, recitit la 25.09 seara).

| Decizie de cantitate | Punct #63 | Răspunsul care închide decizia |
|---|---|---|
| Nr 1–4 (13.765 m Dn200: Ștefan Vodă 5.485, Cuza Vodă 4.080, Grădiștea 1.980, Independența 2.220) intră în ofertă? În ce etapă? | 3b (și 1, 2a) | da/nu + etapa |
| Tabelul din 470 e referința de cantități (133 de rânduri, 48.905 m)? | 3a (și 5a) | da, sau altă referință (liste de cantități) |
| Dn200 în UAT (4.020, Nr 5–8) și racordurile SRS (1.345, Nr 9, 10, 97): E1 sau E2? | 2b | defalcare Dn × etapă |
| Dn160 (0 m în tabel) | 3c, 2b | lungimi Dn160 sau confirmarea că nu există |
| Ținta 44.355 = 11.525 + 32.830; include Dn200? | 1, 2a | confirmare sau corecție |
| Corespondența tronson ↔ poziție din Lista de prețuri | 5b | structura listei |

Răspunsul AC închide obiectul și etapele (criteriul 4), dar nu închide singur R5. Mai trebuie verificarea pe imagine (3), aprobarea umană (5) și verificarea propagării (6).

Puncte care NU sunt în #63:
- **Verificarea internă pe imagine (Oana Nica)**: lista și locatorii sunt în §6.2.
- **Neacoperit de textul actual**: trunchiul Nr 1–4 alimentează și Cuza Vodă (2.500 mc/h), și Dragoș Vodă (3.500 mc/h), iar CS vorbește de „cele patru SRS-uri”, deși tabelul are 2 SRS. Adăugarea lor ar redeschide redactarea #63 (R8 închis), deci cere re-aprobare. E opțională, doar cu GO Razvan.
## 7. Aplicare
**Nimic de aici nu s-a executat pe BD.**

### 7.1 Ordinea (verdictul Copilot)
1. **Protejăm utilizarea cantităților nevalidate**: consumatorii (§6.3), remediați în cod pe ramura `6313184` (inclusiv condițiile Copilot 1–2 din 26.09), verificați adversarial, nedeployați; la livrare, întâi migrările (istoricul + trigger-ul, apoi view + v6), apoi merge-ul. Asta vine înaintea oricărei schimbări de cantitate.
2. **Reparăm deduplicarea pe identitatea rândului**: remediat în cod pe ramura R4 (`7a7bf86`), nedeployat; reverificarea rundei 9 cere fixul a 2 majore pe rândurile TOTAL. Apoi reverificare, push + PR, merge + deploy (GO; poate intra împreună cu ramura consumatorilor, care o conține) și recitirea lui 470 (GO separat), cu reconfirmarea cifrelor în BD (§6.5).
3. **Oana verifică pozițiile controversate** (§6.2). Numai după asta, și cu GO Razvan, se poate rula **pasul B** (§7.3).
4. **Reconciliem obiectul și etapele**: răspunsul la #63 (§6.6). Urmează aprobarea umană pe rânduri (✓) și verificarea propagării în ofertă (§6.3).

### 7.2 Pasul A: respins (istoric, pe scurt)
Revizia 2 propunea un bloc DO. Blocul reducea 1751 la 4.020 m (Nr 5–8) și insera un rând nou „Dn200 — amonte, în afara UAT Vâlcelele (Nr 1–4)”, cu `cantitate` NULL, `cantitate_plansa` 13.765 și `tip_sursa='plansa'`, plus note pe 1754–1756. Rezultatul ar fi fost Σ cantitate 34.430 și Σ planșă 48.195. Propunerea e **respinsă** și nu se aplică. Motivele:
- **Copilot (a):** scăderea e corectă aritmetic, dar nu arată că 4.020 m e cantitatea de ofertat, iar amplasarea în afara UAT nu dovedește excluderea din contract. Măsura „în afara ofertei” cere doar ca o cantitate nevalidată să nu fie folosită drept aprobată.
- **Verificatorul rundei 2 (major):** `tip_sursa='plansa'` pe rândul nou ar fi făcut `v_ofertare_pt_stare.plansa_m` = 13.765 (azi NULL). Poarta H2 ar fi afișat „există doar planșe 13.765 m”, iar după încărcarea F3 „diferență nerezolvată: planșe 13.765 m vs F3”. În `GraficPoarta`, cu baza „planșe”, cei 13.765 m ar fi intrat în fronturi.
- **Verificatorul rundei 2 (minor):**
  - A și rollback-ul lui (RA) suprascriau un `status='validat'`;
  - după un retransfer, RA refuza;
  - RA ștergea rândul nou fără să verifice `ofertare_clarificari.cantitate_id`, un FK `ON DELETE SET NULL` care ar fi rupt legătura fără urmă.

SQL-ul (A, A-verif, RA) a fost scos din document. Textul lui rămâne în istoricul git (commitul `5e1001d`, §7 din acest fișier).
**Regulă păstrată:** niciun bloc din acest document nu mai șterge rânduri. Orice ștergere viitoare din `ofertare_cantitati` (de exemplu o separare după răspunsul la #63) verifică întâi `ofertare_clarificari.cantitate_id` și refuză dacă există legături, sau le mută explicit. Azi pe 1751–1756 sunt 0 legături (Q12).

### 7.3 Pasul B: condiționat (Dn40 +600 m, doar `cantitate`)
**Condiții:** verificarea pe imagine făcută de Oana Nica pentru Nr 40, Nr 41 și Nr 38 (§6.2) și GO Razvan. Pasul **nu mai depinde de pasul A**.

Ordinea: **(0) preview** și **(R0) snapshot**, păstrat pentru rollback → GO → **(B)** într-un singur apel `execute_sql` → **(B-verif)** în apel separat. `execute_sql` întoarce doar ultimul rezultat, iar `RAISE NOTICE` poate să nu fie vizibil. Rollback: **(RB)**, iar dacă un retransfer a șters marcajul din notă, **(RB-manual)** din R0.

Gărzile lui B:
- **Validarea umană e obligatorie**: cine, când, Nr 40, Nr 41, Nr 38. Constantele sunt NULL intenționat, iar blocul refuză până se completează. „Cine” nu poate fi șir gol sau doar spații (X5).
- **Plauzibilitate**: Nr 40 și Nr 41 între **250 și 350 m** (tabelul citește 300 / 300); Nr 38 ∈ {320, 330}; Dn40 rezultat între 13.640 și 13.850. O greșeală de tastare ca 3.000 e refuzată (T2).
- **Serializare cu transferul**: `FOR UPDATE` pe documentul 470 (același rând pe care îl blochează RPC-ul) și `transfer.stare='facut'`, plus lock pe rândurile lic. 95.
- **Starea lui 1756, verificată pe rând, cu mesaj separat pentru fiecare motiv**:
  - denumire și um;
  - `status` ∈ {extras, diferenta}; un `validat` sau `revizuit_clarificare` e o decizie umană și **nu se suprascrie**;
  - marcajul „R5 pas B” absent;
  - `cantitate` = 13.140;
  - `cantitate_plansa` ∈ {13.140, 13.740}, adică citirea de azi sau cifra cu identitatea rândului (dintr-o recitire sau din corecția manuală A din documentul R4); NULL e refuzat explicit (X1: `NULL NOT IN (…)` dă NULL, nu adevărat, deci garda veche îl lăsa să treacă).
- **Scrie numai `cantitate`**, plus `status='diferenta'` și o notă care păstrează valorile, cine a verificat, locatorul și **statusul anterior**. `cantitate_plansa` rămâne neatinsă, ca istoric al extragerii. Textul notei depinde de `cantitate_plansa`: 13.140 ⇒ „cantitate_plansa = 13140 m (citirea automată curentă, vezi nota anterioară) rămâne ca istoric al extragerii” — fără metoda de deduplicare, pentru că 13.140 poate veni și din codul deployat (deduplicarea pe text), și dintr-o recitire R4 cu Nr 40–41 trimise „de verificat” (ADV3b; X3b, revizia 6); 13.740 = valoarea lui B ⇒ „aceeași valoare: statusul diferenta marchează rândul nevalidat, nu o contradicție” (X2); 13.740 ≠ valoarea lui B ⇒ nota numește diferența și cele trei valori verificate, fără s-o atribuie unui rând anume (X2c: Nr 38 = 330, +10 m; X2d: Nr 40 = 260, −40 m). Pentru 13.740, nota nu mai spune „recitirea”, ci „citirea automată sau corecția cu identitatea rândului, vezi nota anterioară”: cifra poate veni și din varianta A a documentului R4, aplicată manual (VA, VAc; revizia 5).
- **Verificare finală**: numărul de rânduri și Σ planșă neschimbate, iar Σ cantitate crește exact cu diferența. Altfel `RAISE EXCEPTION` anulează tot blocul.

Gărzile lui RB:
- aceeași serializare cu transferul;
- cere marcajul și valorile din nota lui B;
- refuză dacă statusul nu mai e `diferenta` (decizie umană după B) sau dacă `cantitate` a fost editată după B;
- restaurează 13.140, statusul anterior și nota de dinainte de B;
- verifică sumele.

Gărzile lui RB-manual (doar când un retransfer a șters marcajul, deci RB refuză):
- parametri obligatorii: valoarea scrisă de B (din B-verif, nu fixă în cod), plus nota, statusul și **`cantitate_plansa`** lui 1756 din snapshot-ul R0; fără ei refuză (RM1, RM1b);
- aceeași serializare ca B și RB (`FOR UPDATE` pe doc 470, `transfer.stare='facut'`, lock pe rândurile lic. 95; RM5);
- refuză dacă marcajul e încă în notă (atunci se folosește RB; RM2), dacă statusul e `validat` / `revizuit_clarificare` (RM4) sau dacă `cantitate` ≠ valoarea lui B (editată după B sau parametru greșit; RM3, RM6);
- dacă `cantitate_plansa` de acum **e aceeași ca în R0**, rândul revine exact la R0, inclusiv nota (T9, V4b, RM7). Dacă o citire ulterioară a schimbat-o (în orice sens: 13.140 → 13.740 sau 13.740 → 13.140), pune o notă neutră cu ambele cifre și `status=diferenta` (X2b, V4). Nota din R0 descria atunci altă citire, iar nota scrisă de retransfer descria diferența creată de B, deci niciuna nu mai e adevărată. Înainte, testul era fix `cantitate_plansa = 13140`, iar cu un R0 luat după o recitire R4 (13.740) RB-manual restaura o notă cu „+600 m” inexistenți (V4);
- verifică sumele (Σ planșă neschimbată, Σ cantitate scade exact cu diferența lui B).

**Testat local, nu pe Supabase.** Am folosit un Postgres 16 de unică folosință, cu o machetă care are aceleași coloane, aceleași CHECK-uri, indexul unic, FK-ul `cantitate_id ON DELETE SET NULL` (Q14) și cele 6 rânduri reale. Blocurile au fost extrase exact din acest fișier. Rularea din 25.09 seara (16 scenarii) a fost refăcută la 26.09 pe SQL-ul revizuit, cu scenariile X1, X2, X2b, X2c, X5, X5b, X7 și RM1–RM7 (30 de scenarii). La reverificarea reviziei 4 a fost rulată din nou, cu scenariile X2d, V4, V4b, VA, RM1b și RM8 (63 / 63). **Revizia 5 (26.09, 02:50Z):** am rulat-o din nou pe SQL-ul extras exact din această revizie, cu varianta A luată din documentul R4 la `ab5c449` (decomentată) și cu aserțiuni noi pe textul notei lui B (X2, VA, plus scenariul nou VAc). Toate cele 37 de scenarii din tabel au dat rezultatul așteptat: **71 / 71** de verificări automate (T10 și X2 sunt aceeași rulare). Pe SQL-ul reviziei 4 pică exact cele 5 verificări noi de proveniență (X2, VA ×2, VAc ×2): nota spunea „recitirea cu identitatea rândului” și după o corecție manuală. Postgres-ul a fost oprit și șters. **Revizia 6 (26.09, ~07:00Z):** harness-ul reviziei 5, cu SQL-ul extras exact din această revizie și varianta A + rollback-ul A extrase din documentul R4 la `7a7bf86` (decomentate), plus scenariile X3b, RBA și RBA0 și aserțiuni noi pe nota lui T4: **87 / 87**. Pe SQL-ul reviziei 5 pică exact cele 4 verificări noi de proveniență (T4 ×2, X3b ×2). Postgres 16 local, oprit și șters. Simularea retransferului rescrie nota lui 1756 și notele lui 1751–1755, ca RPC-ul:

| Test | Scenariu | Rezultat |
|---|---|---|
| T1 | B cu constantele NULL | refuzat, stare neschimbată |
| T2 / T3b | Nr 40 = 3.000 / Nr 41 = 240 | refuzat (plauzibilitate), stare neschimbată |
| T3 | Nr 38 = 325 | refuzat |
| T4 | B cu 300 / 300 / 320 | 1756 = 13.740 / 13.140 / diferenta; Σ 48.795 / 48.195; n = 6 |
| T5 | B rulat a doua oară | refuzat („deja aplicat”) |
| T6 | RB | hash identic cu starea inițială |
| T7 | B pe 1756 `validat` | refuzat, statusul rămâne `validat` |
| T8 | B cu `transfer.stare='in_curs'` | refuzat |
| T9 | B, apoi retransfer cu codul deployat azi (deduplicare pe text, nota rescrisă) | B din nou refuzat („pare aplicat deja…”); RB refuzat („marcajul lipsește”); RB-manual (parametrii din B-verif și R0, planșa R0 = 13.140) dă 13.140 / 13.140 / extras, iar rândul 1756 e identic cu R0, **inclusiv nota**; Σ 48.195 / 48.195 |
| T10 | retransfer cu codul R4 (`cantitate_plansa` 13.740) **înainte** de B, apoi B, apoi RB | B: 13.740 / 13.740 / diferenta; Σ 48.795 / 48.795; RB revine exact la starea de după retransfer (status `diferenta`); nota: vezi X2 |
| T11 | B cu 300 / 300 / 330 | 13.750; Σ cantitate 48.805 |
| T12 | B, apoi 1756 validat de om, apoi RB | RB refuzat |
| T13 | B, apoi `cantitate` editată la 13.700, apoi RB | RB refuzat |
| T14 | clarificare legată de 1756, apoi B + RB | legătura rămâne (5001 → 1756), hash inițial |
| T15 | nota 1756 NULL, apoi B + RB | nota revine NULL, hash identic |
| X1 | `cantitate_plansa` NULL pe 1756, apoi B | refuzat („e NULL”), stare neschimbată |
| X5 / X5b | „cine a verificat” = `''` / `'   '` | refuzat, stare neschimbată |
| X2 | retransfer R4 înainte de B, apoi B | nota lui B: „cantitate_plansa (citirea automată sau corecția cu identitatea rândului, vezi nota anterioară) = 13740 m, aceeași valoare: statusul diferenta marchează rândul nevalidat, nu o contradicție”; RB → starea de după retransfer |
| X3b | recitire R4 în care Nr 40–41 ies „de verificat” (ADV3b: `cantitate_plansa` rămâne 13.140, `status` diferenta, nota „2 rânduri Dn40 fără identitate sigură (600 m)”), apoi B, apoi RB | B: 13.740 / 13.140 / diferenta; nota B: „cantitate_plansa = 13140 m (citirea automată curentă, vezi nota anterioară) rămâne ca istoric…”, **fără „deduplicarea pe text”** (înainte: proveniență falsă); nota recitirii rămâne înaintea lui B; „status anterior: diferenta”; RB → starea de după recitire |
| X2c | retransfer R4, apoi B cu Nr 38 = 330 | 13.750 / 13.740; nota numește diferența de 10 m și valorile verificate (Nr 38 = 330) |
| X2d | retransfer R4, apoi B cu 260 / 300 / 320 | 13.700 / 13.740 / diferenta; nota: „diferența de -40 m vine din valorile verificate pe imagine (Nr 40 = 260, Nr 41 = 300, Nr 38 = 320)” — nu o mai atribuie lui Nr 38 (înainte: „vine din Nr 38 verificat pe imagine”, fals) |
| X2b | B, apoi retransfer R4 (marcaj pierdut), RB, RB-manual | RB refuzat; RB-manual: 13.140 / 13.740 / diferenta, cu notă neutră; Σ 48.195 / 48.795 |
| V4 | R0 luat după o recitire R4 (13.140 / 13.740 / diferenta, nota „Memoriu 13.140 m vs planșa 1 13.740 m (+600 m…)”), B, retransfer cu codul deployat azi (planșa 13.140), RB, RB-manual (planșa R0 = 13.740) | RB refuzat; RB-manual: 13.140 / 13.140 / diferenta, cu notă neutră (ambele cifre), fără „+600 m” (înainte: nota R0 restaurată, cu +600 m inexistenți) |
| V4b | R0 după o recitire R4, B, încă o recitire R4 (planșa 13.740), RB-manual | rândul 1756 identic cu R0, inclusiv nota (înainte: notă neutră) |
| VA | varianta A din documentul R4 (SQL-ul din `ab5c449` §5.5, decomentat), apoi B | după A: 13.140 / 13.740 / diferenta; B acceptat: 13.740 / 13.740 / diferenta. Nota A rămâne înaintea lui B, iar nota B spune „citirea automată sau corecția …, vezi nota anterioară”, nu „recitirea” (înainte: „recitirea cu identitatea rândului”, proveniență falsă) |
| VAc | varianta A, apoi B cu 300 / 300 / 330 | 13.750 / 13.740 / diferenta; nota numește diferența de 10 m, cu aceeași proveniență neutră |
| X7 | B cu 250 / 350 / 330 (marginile plajei) | acceptat, 13.750 |
| RBA | varianta A din R4, pasul B, apoi rollback-ul A din R4 la `7a7bf86` (decomentat) | rollback A: **0 rânduri**; pasul B intact, cu marcaj; apoi RB (R5) ⇒ starea lui A; abia apoi rollback A: 1 rând ⇒ starea inițială (hash). La `ab5c449` același drum anula tăcut pasul B (verificatorul reviziei 5) |
| RBA0 | varianta A, apoi rollback-ul A din R4 la `7a7bf86` | starea inițială (hash) |
| RM1 | RB-manual fără parametri | refuzat |
| RM1b | RB-manual fără `cantitate_plansa` din R0 | refuzat (înainte: rula) |
| RM8 | RB-manual cu `cantitate_plansa` din R0 neplauzibilă (13.000) | refuzat |
| RM2 | RB-manual cu marcajul încă în notă | refuzat („folosește RB”) |
| RM3 / RM6 | RB-manual după editarea cantității / cu valoarea lui B greșită | refuzat |
| RM4 / RM5 | RB-manual pe `validat` / cu transferul `in_curs` | refuzat |
| RM7 | nota din R0 NULL, B, retransfer cu codul deployat, RB-manual | rândul 1756 identic cu R0 (nota NULL) |

```sql
-- R5 v4 (revizia 6) · lic. 95 / planșa 470 (doc 470) · PROPUNERE NEEXECUTATĂ — se rulează DOAR după verificarea Oanei Nica și cu GO Razvan.
-- Fiecare bloc de mai jos = UN apel execute_sql separat (execute_sql întoarce doar ultimul rezultat).
-- Un bloc DO e o singură instrucțiune: orice RAISE EXCEPTION anulează TOT ce a făcut blocul (nimic parțial).

-- ============================================================================================
-- (0) PREVIEW — starea de plecare (citită la 25.09.2026 seara și la 26.09: 6 rânduri, id 1751–1756, toate extras, Σ 48.195 / 48.195)
-- ============================================================================================
SELECT id, denumire, cantitate, cantitate_plansa, status, tip_sursa, obiect,
       left(diferenta_nota, 90) AS nota, updated_at
  FROM public.ofertare_cantitati WHERE licitatie_id = 95 ORDER BY id;

-- (R0) SNAPSHOT PENTRU ROLLBACK — rulează-l ÎNAINTE de pasul B și păstrează rezultatul (valorile vechi, complete)
SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) AS valori_vechi_r5
  FROM public.ofertare_cantitati c WHERE c.licitatie_id = 95;

-- ============================================================================================
-- (B) PASUL B — Dn40: cantitatea ofertată +Nr 40 +Nr 41 (+10 dacă Nr 38 = 330), DOAR după verificarea pe imagine.
--     Schimbă numai `cantitate` (+ status 'diferenta' + notă) pe 1756; `cantitate_plansa` rămâne citirea automată.
--     Cu Nr 40 = Nr 41 = 300 și Nr 38 = 320: 1756 = 13.740; Σ cantitate 48.795; Σ planșă neschimbată.
--     NU aprobă nimic: aprobarea = bifa ✓ (status 'validat') după reconcilierea obiectului și a etapelor.
-- ============================================================================================
DO $$
DECLARE
  c_validat_de constant text := NULL;   -- COMPLETEAZĂ: cine a verificat pe imagine (ex. 'Oana Nica')
  c_validat_la constant date := NULL;   -- COMPLETEAZĂ: data verificării
  c_nr40       constant int  := NULL;   -- COMPLETEAZĂ: lungimea Nr 40 citită pe imagine (propus 300)
  c_nr41       constant int  := NULL;   -- COMPLETEAZĂ: lungimea Nr 41 citită pe imagine (propus 300)
  c_nr38       constant int  := NULL;   -- COMPLETEAZĂ: 320 sau 330, cum se citește pe imagine
  v_transfer text; v_nou numeric; r record; n int;
  v_n0 int; v_c0 numeric; v_p0 numeric; v_n1 int; v_c1 numeric; v_p1 numeric;
BEGIN
  -- 1. validarea umană e obligatorie și plauzibilă
  IF nullif(btrim(c_validat_de), '') IS NULL OR c_validat_la IS NULL OR c_nr40 IS NULL OR c_nr41 IS NULL OR c_nr38 IS NULL THEN
    RAISE EXCEPTION 'R5 pas B: lipsește verificarea pe imagine (cine — nu gol, când, Nr 40, Nr 41, Nr 38) — nu rulează fără ea';
  END IF;
  IF c_nr40 NOT BETWEEN 250 AND 350 OR c_nr41 NOT BETWEEN 250 AND 350 THEN
    RAISE EXCEPTION 'R5 pas B: Nr 40 = %, Nr 41 = % în afara limitei de plauzibilitate 250–350 m (tabelul citește 300 / 300) — verifică tastarea; o valoare reală în afara limitei cere o analiză separată', c_nr40, c_nr41;
  END IF;
  IF c_nr38 NOT IN (320, 330) THEN
    RAISE EXCEPTION 'R5 pas B: Nr 38 = % (se acceptă doar 320 sau 330, cele două lecturi ale rândului)', c_nr38;
  END IF;
  v_nou := 13140 + c_nr40 + c_nr41 + (c_nr38 - 320);   -- 13.140 conține deja Nr 38 = 320 (z2_7) și Nr 37 = 300
  IF v_nou NOT BETWEEN 13640 AND 13850 THEN
    RAISE EXCEPTION 'R5 pas B: Dn40 calculat % în afara plajei 13.640–13.850', v_nou;
  END IF;

  -- 2. serializare cu transferul automat (RPC-ul ofertare_transfer_plansa_cantitati blochează același rând de document)
  SELECT analiza->'citire_ai'->'transfer'->>'stare' INTO v_transfer
    FROM public.ofertare_documente_atribuire WHERE id = 470 AND licitatie_id = 95 FOR UPDATE;
  IF v_transfer IS DISTINCT FROM 'facut' THEN
    RAISE EXCEPTION 'R5 pas B: transferul planșei 470 nu e în starea facut (e %) — oprit, nimic modificat', coalesce(v_transfer, 'NULL');
  END IF;
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;
  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n0, v_c0, v_p0
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;

  -- 3. starea rândului 1756, verificată pe rând, cu mesaj pentru fiecare motiv de refuz
  SELECT id, denumire, um, cantitate, cantitate_plansa, status, coalesce(diferenta_nota, '') AS nota INTO r
    FROM public.ofertare_cantitati WHERE id = 1756 AND licitatie_id = 95;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5 pas B: rândul 1756 nu există pe lic. 95'; END IF;
  IF r.denumire IS DISTINCT FROM 'Conductă distribuție gaze Dn40' OR r.um IS DISTINCT FROM 'm' THEN
    RAISE EXCEPTION 'R5 pas B: 1756 nu mai e poziția Dn40 în metri (denumire %, um %)', r.denumire, r.um;
  END IF;
  IF r.status NOT IN ('extras', 'diferenta') THEN
    RAISE EXCEPTION 'R5 pas B: 1756 are status % — decizie umană (validat / revizuit_clarificare), nu se suprascrie; redeschide întâi rândul din 📋 Cantități', r.status;
  END IF;
  IF r.nota LIKE '%R5 pas B%' THEN
    RAISE EXCEPTION 'R5 pas B: deja aplicat (marcajul „R5 pas B” e în notă) — nicio modificare';
  END IF;
  IF r.cantitate IS DISTINCT FROM 13140 THEN
    RAISE EXCEPTION 'R5 pas B: cantitatea Dn40 e %, nu 13.140 — pasul B pare aplicat deja (un retransfer șterge marcajul din notă) sau rândul a fost editat; verifică istoricul, nu rula din nou', r.cantitate;
  END IF;
  IF r.cantitate_plansa IS NULL OR r.cantitate_plansa NOT IN (13140, 13740) THEN
    RAISE EXCEPTION 'R5 pas B: cantitate_plansa pe 1756 e % (așteptat 13.140 = citirea actuală sau 13.740 = recitirea ori corecția A cu identitatea rândului)', coalesce(r.cantitate_plansa::text, 'NULL');
  END IF;

  -- 4. doar cantitatea ofertată se schimbă; cantitate_plansa (rezultatul extras) rămâne cum e — istoricul extragerii
  UPDATE public.ofertare_cantitati
     SET cantitate = v_nou,
         status = 'diferenta',
         diferenta_nota = coalesce(diferenta_nota, '') || format(
           ' | R5 pas B (%s): Nr 40 = %s m și Nr 41 = %s m (planșa 470, felii z2_6/z2_7, rândurile 9–10 ale fragmentului) și Nr 38 = %s m, verificate pe imagine de %s. Cantitatea ofertată Dn40 = %s m; %s NEAPROBATĂ: aprobarea = bifa ✓ după reconcilierea obiectului și a etapelor. status anterior: %s',
           to_char(c_validat_la, 'DD.MM.YYYY'), c_nr40, c_nr41, c_nr38, btrim(c_validat_de), v_nou,
           CASE WHEN r.cantitate_plansa = 13140
                  THEN 'cantitate_plansa = 13140 m (citirea automată curentă, vezi nota anterioară) rămâne ca istoric al extragerii.'
                WHEN r.cantitate_plansa = v_nou
                  THEN 'cantitate_plansa (citirea automată sau corecția cu identitatea rândului, vezi nota anterioară) = 13740 m, aceeași valoare: statusul diferenta marchează rândul nevalidat, nu o contradicție.'
                ELSE format('cantitate_plansa (citirea automată sau corecția cu identitatea rândului, vezi nota anterioară) = 13740 m; diferența de %s m vine din valorile verificate pe imagine (Nr 40 = %s, Nr 41 = %s, Nr 38 = %s).', v_nou - 13740, c_nr40, c_nr41, c_nr38)
           END,
           r.status),
         updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND status IN ('extras', 'diferenta')
     AND coalesce(diferenta_nota, '') NOT LIKE '%R5 pas B%';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 pas B: UPDATE 1756 a atins % rânduri (așteptat 1)', n; END IF;

  -- 5. verificare: se schimbă doar Σ cantitate, cu exact diferența; numărul de rânduri și Σ planșă rămân
  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n1, v_c1, v_p1
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n1 <> v_n0 OR v_c1 IS DISTINCT FROM v_c0 + (v_nou - 13140) OR v_p1 IS DISTINCT FROM v_p0 THEN
    RAISE EXCEPTION 'R5 pas B: verificare eșuată (n % → %, Σcantitate % → %, Σplanșă % → %; așteptat Σcantitate +%) — anulat',
      v_n0, v_n1, v_c0, v_c1, v_p0, v_p1, v_nou - 13140;
  END IF;
  RAISE NOTICE 'R5 pas B aplicat: Dn40 ofertat = %, Σ cantitate % → %, Σ planșă % (neschimbată)', v_nou, v_c0, v_c1, v_p1;
END $$;

-- (B-verif) apel separat, după pasul B
SELECT (SELECT jsonb_build_object('cantitate', cantitate, 'plansa', cantitate_plansa, 'status', status, 'nota', right(diferenta_nota, 200))
          FROM public.ofertare_cantitati WHERE id = 1756) AS r1756,
       count(*) AS n, sum(cantitate) AS s_cantitate, sum(cantitate_plansa) AS s_plansa,
       count(*) FILTER (WHERE status = 'validat') AS validate
  FROM public.ofertare_cantitati WHERE licitatie_id = 95;
-- așteptat (300 + 300 + 320, fără retransfer): 1756 = 13740 / 13140 / diferenta; n = 6; Σ cantitate 48795; Σ planșă 48195; validate 0

-- ============================================================================================
-- (RB) ROLLBACK pasul B — 1756 revine la 13.140, la statusul de dinainte de B și la nota de dinainte de B.
--      Refuză dacă un retransfer a șters marcajul, dacă omul a schimbat statusul sau cantitatea după B.
-- ============================================================================================
DO $$
DECLARE
  v_transfer text; r record; n int; v_b numeric; v_prev text;
  v_n0 int; v_c0 numeric; v_p0 numeric; v_n1 int; v_c1 numeric; v_p1 numeric;
BEGIN
  SELECT analiza->'citire_ai'->'transfer'->>'stare' INTO v_transfer
    FROM public.ofertare_documente_atribuire WHERE id = 470 AND licitatie_id = 95 FOR UPDATE;
  IF v_transfer IS DISTINCT FROM 'facut' THEN
    RAISE EXCEPTION 'R5 rollback B: transferul planșei 470 nu e în starea facut (e %) — oprit', coalesce(v_transfer, 'NULL');
  END IF;
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;
  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n0, v_c0, v_p0
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;

  SELECT id, cantitate, status, coalesce(diferenta_nota, '') AS nota INTO r
    FROM public.ofertare_cantitati WHERE id = 1756 AND licitatie_id = 95;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5 rollback B: rândul 1756 nu există'; END IF;
  IF strpos(r.nota, ' | R5 pas B') = 0 THEN
    RAISE EXCEPTION 'R5 rollback B: marcajul „R5 pas B” lipsește din nota lui 1756 — fie B nu e aplicat, fie un retransfer a rescris nota; folosește procedura manuală din snapshot-ul R0';
  END IF;
  v_b    := substring(r.nota FROM 'Cantitatea ofertată Dn40 = ([0-9]+) m')::numeric;
  v_prev := substring(r.nota FROM 'status anterior: (extras|diferenta)$');
  IF v_b IS NULL OR v_prev IS NULL THEN
    RAISE EXCEPTION 'R5 rollback B: nota pasului B e incompletă (valoare %, status anterior %) — procedura manuală', v_b, v_prev;
  END IF;
  IF r.status IS DISTINCT FROM 'diferenta' THEN
    RAISE EXCEPTION 'R5 rollback B: 1756 are status % după pasul B — decizie umană, nu se suprascrie', r.status;
  END IF;
  IF r.cantitate IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION 'R5 rollback B: cantitatea e %, nu % cât a scris pasul B — rândul a fost editat după B; procedura manuală', r.cantitate, v_b;
  END IF;

  UPDATE public.ofertare_cantitati
     SET cantitate = 13140, status = v_prev,
         diferenta_nota = nullif(left(diferenta_nota, strpos(diferenta_nota, ' | R5 pas B') - 1), ''),
         updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND cantitate = v_b AND status = 'diferenta'
     AND strpos(diferenta_nota, ' | R5 pas B') > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 rollback B: UPDATE a atins % rânduri (așteptat 1)', n; END IF;

  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n1, v_c1, v_p1
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n1 <> v_n0 OR v_c1 IS DISTINCT FROM v_c0 - (v_b - 13140) OR v_p1 IS DISTINCT FROM v_p0 THEN
    RAISE EXCEPTION 'R5 rollback B: verificare eșuată (Σcantitate % → %, Σplanșă % → %) — anulat', v_c0, v_c1, v_p0, v_p1;
  END IF;
  RAISE NOTICE 'R5 rollback B: 1756 = 13.140 / %, Σ cantitate %', v_prev, v_c1;
END $$;

-- ============================================================================================
-- (RB-manual) DOAR dacă RB refuză pentru că un retransfer a rescris nota lui 1756 (marcajul „R5 pas B” lipsește).
--   Parametrii vin din B-verif (valoarea scrisă de B) și din snapshot-ul R0 (nota, statusul și cantitate_plansa lui 1756 de dinainte de B).
--   Aceleași gărzi de serializare ca B și RB. Dacă cifra planșei e aceeași ca în R0, rândul revine exact la R0 (inclusiv nota);
--   dacă o citire ulterioară a schimbat-o (în orice sens), nota devine una neutră, cu cifra curentă și cea din R0. Preview → GO → apoi rulează.
-- ============================================================================================
DO $$
DECLARE
  c_valoare_b  constant numeric := NULL;   -- COMPLETEAZĂ din B-verif: cantitatea scrisă de pasul B (13740; 13750 dacă Nr 38 = 330)
  c_nota_r0_ok constant boolean := false;  -- COMPLETEAZĂ true după ce ai copiat nota din R0 pe rândul următor
  c_nota_r0    constant text    := NULL;   -- COMPLETEAZĂ: diferenta_nota a lui 1756 din snapshot-ul R0, textul complet (rămâne NULL dacă în R0 era NULL)
  c_status_r0  constant text    := NULL;   -- COMPLETEAZĂ: status-ul lui 1756 din R0 (la 26.09: 'extras')
  c_plansa_r0  constant numeric := NULL;   -- COMPLETEAZĂ: cantitate_plansa a lui 1756 din R0 (la 26.09: 13140)
  v_transfer text; r record; n int; v_nota text; v_status text;
  v_n0 int; v_c0 numeric; v_p0 numeric; v_n1 int; v_c1 numeric; v_p1 numeric;
BEGIN
  IF c_valoare_b IS NULL OR NOT c_nota_r0_ok OR c_status_r0 IS NULL OR c_plansa_r0 IS NULL THEN
    RAISE EXCEPTION 'R5 RB-manual: lipsesc parametrii din B-verif / R0 (valoarea lui B; nota, statusul și cantitate_plansa din snapshot) — nu rulează fără ei';
  END IF;
  IF c_valoare_b NOT BETWEEN 13640 AND 13850 OR c_status_r0 NOT IN ('extras', 'diferenta') OR c_plansa_r0 NOT IN (13140, 13740) THEN
    RAISE EXCEPTION 'R5 RB-manual: parametri neplauzibili (valoare B %, status R0 %, planșă R0 %)', c_valoare_b, c_status_r0, c_plansa_r0;
  END IF;

  SELECT analiza->'citire_ai'->'transfer'->>'stare' INTO v_transfer
    FROM public.ofertare_documente_atribuire WHERE id = 470 AND licitatie_id = 95 FOR UPDATE;
  IF v_transfer IS DISTINCT FROM 'facut' THEN
    RAISE EXCEPTION 'R5 RB-manual: transferul planșei 470 nu e în starea facut (e %) — oprit', coalesce(v_transfer, 'NULL');
  END IF;
  PERFORM 1 FROM public.ofertare_cantitati WHERE licitatie_id = 95 FOR UPDATE;
  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n0, v_c0, v_p0
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;

  SELECT id, cantitate, cantitate_plansa, status, coalesce(diferenta_nota, '') AS nota INTO r
    FROM public.ofertare_cantitati WHERE id = 1756 AND licitatie_id = 95;
  IF NOT FOUND THEN RAISE EXCEPTION 'R5 RB-manual: rândul 1756 nu există'; END IF;
  IF strpos(r.nota, ' | R5 pas B') > 0 THEN
    RAISE EXCEPTION 'R5 RB-manual: marcajul „R5 pas B” e încă în notă — folosește RB, nu RB-manual';
  END IF;
  IF r.status NOT IN ('extras', 'diferenta') THEN
    RAISE EXCEPTION 'R5 RB-manual: 1756 are status % — decizie umană, nu se suprascrie', r.status;
  END IF;
  IF r.cantitate IS DISTINCT FROM c_valoare_b THEN
    RAISE EXCEPTION 'R5 RB-manual: cantitatea e %, nu % (valoarea scrisă de B) — rândul a fost editat după B; nu se atinge', r.cantitate, c_valoare_b;
  END IF;
  IF r.cantitate_plansa IS NULL OR r.cantitate_plansa NOT IN (13140, 13740) THEN
    RAISE EXCEPTION 'R5 RB-manual: cantitate_plansa pe 1756 e % (așteptat 13.140 sau 13.740)', coalesce(r.cantitate_plansa::text, 'NULL');
  END IF;

  IF r.cantitate_plansa = c_plansa_r0 THEN    -- cifra planșei e aceeași ca în R0: se revine exact la R0 (inclusiv nota)
    v_status := c_status_r0;
    v_nota   := c_nota_r0;
  ELSE                                         -- o citire ulterioară a schimbat cifra planșei: nota R0 descria altă citire => notă neutră
    v_status := 'diferenta';
    v_nota   := format('R5 RB-manual (%s): cantitatea ofertată Dn40 readusă la 13140 m (valoarea de dinainte de pasul B). cantitate_plansa = %s m (citirea automată curentă; în snapshot-ul R0 era %s m). Nota din R0 nu se restaurează, pentru că descria altă citire; nota scrisă de retransfer descria diferența creată de pasul B. NEAPROBATĂ.',
                       to_char(now(), 'DD.MM.YYYY'), r.cantitate_plansa, c_plansa_r0);
  END IF;

  UPDATE public.ofertare_cantitati
     SET cantitate = 13140, status = v_status, diferenta_nota = v_nota, updated_at = now()
   WHERE id = 1756 AND licitatie_id = 95 AND cantitate = c_valoare_b AND status IN ('extras', 'diferenta')
     AND strpos(coalesce(diferenta_nota, ''), ' | R5 pas B') = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'R5 RB-manual: UPDATE a atins % rânduri (așteptat 1)', n; END IF;

  SELECT count(*), sum(cantitate), sum(cantitate_plansa) INTO v_n1, v_c1, v_p1
    FROM public.ofertare_cantitati WHERE licitatie_id = 95;
  IF v_n1 <> v_n0 OR v_c1 IS DISTINCT FROM v_c0 - (c_valoare_b - 13140) OR v_p1 IS DISTINCT FROM v_p0 THEN
    RAISE EXCEPTION 'R5 RB-manual: verificare eșuată (Σcantitate % → %, Σplanșă % → %) — anulat', v_c0, v_c1, v_p0, v_p1;
  END IF;
  RAISE NOTICE 'R5 RB-manual: 1756 = 13.140 / %, Σ cantitate %', v_status, v_c1;
END $$;
```

## Interogări și locatori (toate sunt SELECT)
- **Q1**: `felii[eticheta ~ '^z[1-4]_[67]$'].tabele[0].randuri`, zip pe ordinalitate pentru z?_6 × z?_7, DISTINCT pe `Nr crt`. Rezultatul, recalculat la 25.09 seara și din nou la 26.09 (identic; `sumar` al lui 470 neschimbat: 48.195 / nestandard 110 / adnotări 34.732, transfer `facut` 16:51:08Z):
  - 152 de lecturi, 133 de Nr distincte și 133 de triplete (Nr, Dn, L) distincte, adică 0 conflicte;
  - Σ 48.905; pe Dn: 200 = 17.785, 125 = 2.275, 110 = 780, 90 = 4.545, 63 = 9.670, 60 = 110, 40 = 13.740;
  - Nr 1–4 = 13.765, Nr 5–8 = 4.020;
  - singurul grup identic ca text e Nr 37/40/41;
  - 133 de perechi de noduri distincte și 133 de noduri de sosire distincte.
- **Q1b**: coloana „același Dn ±1%” din §1.2, calculată pe două baze: tabelul complet (133 de rânduri) și `tronsoane_unice` (131). Diferă doar idx 81 și 83 (13 față de 11).
- **Q2**: aceeași reconstrucție, grupată pe categoria A–E × Dn.
- **Q3**: `sumar.posibile_dubluri` (52; 19 cu același Dn; 18.406 / 8.696 m) și `tronsoane_unice` cu `sursa≠'tabel'` (75; 34.732 m = `sumar.adnotari_neconfirmate_m`, recitit la 25.09 seara). Pe felii: z3_1 36 / 11.427, z3_2 22 / 17.291, z4_2 17 / 6.014.
- **Q4**: adnotările din z3_1 (`de_la`=„Nod n”), join pe `Noduri de Plecare/Sosire`.
- **Q5**: `ofertare_cantitati WHERE licitatie_id=95` → id 1751–1756, recitit la 25.09 seara cu toate coloanele și la 26.09, ultima oară la 02:50Z (neschimbat: 1756 = 13.140 / 13.140, `extras`, `updated_at` 2026-09-25 16:51:08.040401+00; Q20). Coloanele au fost verificate întâi în `information_schema.columns`. Toate 6 sunt `extras`, cu `tip_sursa` și `obiect` NULL; Σ 48.195 / 48.195; `updated_at` 16:51:08.
- **Q6**: subset-sum pe rândurile Nr 1–4 și pe rândurile Dn200 (Nr 1–8). Script local, fără BD.
- **Q7**: `alte_mentiuni` din 471–475 (nota 54200mp).
- **Q8**: `ofertare_clarificari id=63`, recitit la 25.09 seara și la 26.09: `status=de_trimis`, `raspuns` NULL. #64: `de_trimis`, `raspuns` NULL.
- **Q9 (istoric, înlocuit de §6.5)**: simularea deduplicării pe multiset pe `felii[*].tronsoane` cu lungime > 0, cu maximul aparițiilor unei chei `de_la|la|L|Dn|Q|zona` într-o felie.
  - Pe `sursa='tabel'`: 152 de citiri, 131 de chei, 133 de rânduri, 48.905 m.
  - Pe `sursa='adnotare'`: 88 de rânduri, 37.472 m.
  - Copilot a respins regula (contraexemplul 37/40 din felii diferite). Ea nu se implementează.
- **Q10**: numărarea submulțimilor (programare dinamică) pe toate cele 133 de lungimi, pentru țintele 3.840 / 4.440 / 4.550 / 4.560, plus căutarea combinațiilor minime. Script local, fără BD.
- **Q11**: catalogul pentru `ofertare_cantitati`: `pg_constraint`, `pg_trigger`, `pg_indexes`. Plus definițiile `fn_trg_categorie_cantitate`, `fn_categorie_cantitate`, `ofertare_transfer_plansa_cantitati` și `v_ofertare_contradictii`.
- **Q12** (25.09 seara), derivatele lic. 95:
  - `v_ofertare_pt_stare`: `lista_f3_m`, `memoriu_m`, `plansa_m` și `grafic_fronturi_m` sunt NULL;
  - `grafic_parametri`, `grafic_versiuni`, `grafic_activitati`, `ofertare_pt_poarta`, `ofertare_pt_pachet` și `ofertare_verificari` au câte 0 rânduri;
  - `ofertare_clarificari` cu `cantitate_id` în 1751–1756: 0.
- **Q13** (25.09 seara), locatorii din §6.2:
  - `felii` z1_6, z1_7, z2_6, z2_7, `tabele[0].randuri` cu ordinalitate. În z2, rândul 1 = Nr 32, rândul 7 = Nr 38 (0,320), rândurile 9/10 = Nr 40/41 (34→59, 34→60; 0,300; Dn40; Q20) și rândul 26 = Nr 57 (0,110; Dn60; Q40). z1_6 are 37 de rânduri, iar z1_7 rândul 37 = Nr 37.
  - `alte_mentiuni`: z1_6 „Randul 38 … este taiat de marginea de jos”; z1_7 „rand taiat: … 0,330”.
  - `analiza.plansa`: `zone_geom` 2_6 = [7040, 1408, 1600, 1600], 2_7 = [7762, 1408, 1600, 1600]; `latime`/`inaltime`/`dpi` = 9.362 / 6.623 / 200; `coloane`/`randuri` = 7 / 5; `suprapunere` 0,12; `cale_felii` `95/felii/470`.
  - `citire_ai.versiune`: fișierul și pagina 1.
- **Q14** (25.09 seara), catalogul:
  - `pg_get_functiondef(ofertare_transfer_plansa_cantitati)`: update-ul scrie doar `cantitate_plansa`, `diferenta_nota`, `status` și `updated_at`, fără gardă pe status. Insert-ul scrie și `specificatii`, `cantitate`, `sursa`.
  - `pg_constraint`: `ofertare_clarificari_cantitate_id_fkey` e `ON DELETE SET NULL`; CHECK pe status ∈ {extras, validat, diferenta, revizuit_clarificare} și pe `tip_sursa`.
  - `v_ofertare_contradictii`, CTE `difere`: `cantitate` și `cantitate_plansa` NOT NULL și |diferență| > 0,5.
- **Q15**: `strpos` pe `text_extras` (prima apariție). „44,355”: 1276 poz. 10 036 (în „aproximativ 44,355 km”, de la poz. 10 024) și 468 poz. 13 162. „11,525”: 1276 poz. 16 094, 468 poz. 25 423. „32,830”: 1276 poz. 16 254, 468 poz. 25 581.
- Text CS / memoriu: `strpos(text_extras, …)` pe doc 1276 / 468. Pagina = ultimul marcaj ⟦PAGINA n⟧ înainte de poziție.
- **Codul deployat** (commitul `8a6fbbb`; `handler.ts` identic pe `origin/main` `a4b2982` și în versiunea 25 de pe Supabase, Q20), `supabase/functions/ofertare-plansa-citeste/handler.ts`:
  - l.215–228 `tronsoaneUnice` (l.220 sare tronsoanele fără lungime, l.222 e cheia);
  - l.248–357 `treciInCantitati` (l.301–304 pozițiile ambigue, l.315 patch-ul `cantitate_plansa` + `diferenta_nota`, l.317 status, l.319 op-ul de update; l.330 `specificatii` numai la insert);
  - l.446–470 `agregaTronsoane` (l.459 regula ±1%);
  - l.720–725 diametrele nestandard (Dn60 scos);
  - l.726–731 avertismentul pentru rândurile repetate.
- Tot acolo: `ofertare-clarificari-propune/core.ts` l.69.
- **Ramura R4** `claude/r4-rezervare-zone`: capul actual e **`7a7bf86`** (codul în `3197aa3`; locatorii la §6.5). Istoric, la capul reviziei 5 **`ab5c449`** (codul în `f1c4b66`), `handler.ts`: l.38 `COD_VERSIUNE` `2026-09-26.10`; l.262 `TOL_GEOM_PX`; l.307 `perechePosibila`; l.317 `seSuprapun`; l.335–337 `MOTIV_AFARA_NR` / `MOTIV_COLOANA_NR` / `MOTIV_COLOANA_NR_FARA_GEOM`; l.385 `identificaRanduri` (apelată la l.1400); l.523 `coloanaCuNr`; l.718 `descriereRestDn`; l.725 `notaRestTransfer`; l.748 `treciInCantitati` (nota coliziunii la l.861); l.1066 `agregaTronsoane` (`posibila_dublura` la l.1085). Istoric: la `759c5e3` `identificaRanduri` era la l.346 și `posibila_dublura` la l.929–953 (`COD_VERSIUNE` 2026-09-26.8); la `1fd76dd` l.322, `COD_VERSIUNE` 2026-09-25.7.
- **Ramura consumatorilor** `claude/cantitati-nevalidate-consumatori`: capul actual e **`6313184`** (`handler.ts` l.1094–1095 `MARCAJ_R5B` / `corectieR5B`, l.1119 `plasaAprobare`, l.1139 `treciInCantitati`; §6.4). Istoric, la capul reviziei 5 **`7fccfbe`**: `docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md`; `handler.ts` (tot `COD_VERSIUNE` 2026-09-26.10) l.754 `randDinPlansa`, l.771 `cifraSchimbata`, l.781 `treciInCantitati`, l.853 `cifraAlteiPlanse`, l.912 nota coliziunii, l.931–938 nota „din citirea anterioară … cifra nu e confirmată” (§6.4), l.1147 `agregaTronsoane` (`posibila_dublura` la l.1166).
- **Q16** (26.09, istoric: `1fd76dd`), reproducerea adversarială pe o copie a lui `1fd76dd` din scratchpad (md5 `handler.ts` și `fixture_470.ts` identice cu commitul), `deno test --node-modules-dir=none --no-lock -A --no-check`: `agregare_test.ts` 17/17; ADV1, ADV2, ADV3a, ADV5 trec; **ADV3b pică** (132 / 48.605, Nr 40 lipsă, 0 de verificat, 0 conflicte); **ADV4 pică** (Nr 2 contopit, 1 rând sigur de 300 m); ADV-G470 (descriptiv): 134 / 49.225 (`poz z1_7#38` 320) și 134 / 49.205; ADV-G sintetic: 6 rânduri / 1.900 m în loc de 5 / 1.500.
- **Q17** (26.09, istoric: `759c5e3`, înlocuit de Q18): `agregare_test` + `concurenta_test` + `poarta_test` 89/89; cazurile rundei 3 ca în coloana „La `ab5c449`” din §6.5 (identice); felia cu Nr lipsă sau cu antete altfel dădea încă umflare tăcută (139 / 50.105 … 0 de verificat), identic cu `1fd76dd`.
- **Q18** (26.09, 02:50Z, capetele reviziei 5; istoric), copii `git archive` ale lui `ab5c449` și `7fccfbe` (md5 `handler.ts` la `ab5c449` = `a70297ec…`, identic cu commitul), `deno test --node-modules-dir=none --no-lock -A`:
  - `ab5c449`: `supabase/functions/` 126/126 cu type-check; `agregare_test.ts` + `concurenta_test.ts` + `poarta_test.ts` 109/109;
  - `7fccfbe`: `supabase/functions/` 149/149 cu type-check;
  - testele adversariale ale verificatorilor rundelor 3–4 (`adv3v`, `advg470`, `advx`, `advt`, `adv5r`, aceleași fișiere ca la Q16–Q17), pe `ab5c449`: 17 trec, 1 pică (ADV3a, doar pe aserțiunea veche „conflict”). Cifrele sunt cele din tabelul §6.5: ADV1 / ADV-E 133 / 48.905 în orice ordine și cu `zone_geom` real; ADV2 conflict pe Nr 37; ADV3a 131 / 48.285 + 620; ADV3b 131 / 48.305 + 600; ADV4 0 + 1.870; ADV5 93 / 40.095 + 11.600; ADV-H 93 / 40.095 + 11.380; G470 jos / sus 133 / 48.905 + 320 / 300; ADV-G 5 / 1.500 + 400; B / C / C2 0 + 1.800 / 1.200 / 1.200; D 4 / 950; ADV-T 34.465 păstrat + notă; felia cu Nr lipsă `z1_6` / `z2_6` / `z3_6` / `z4_6` / antete altfel: 102 / 24.235 + 25.870, 93 / 40.095 + 11.600, 94 / 39.770 + 13.205, 129 / 47.885 + 3.500, 93 / 40.095 + 11.600, 0 poziții;
  - cazurile rundei 6 (GEOM, coliziune, ADV7) sunt reproduse de verificatorul rundei 6 (`scratchpad/ver7`), nu de mine.
- **Q19** (26.09), nota pe 1756 la un retransfer (§6.4): test local în scratchpad, cu 1756 în stările de după pasul B, pe copiile `7fccfbe` și `ab5c449` (la `ab5c449`, `treciInCantitati` exportat doar în copie). Scenariile: S0 fără B; S1 B = 13.740; S2 B = 13.750; S3 citire parțială 10.440; S4 recitire R4 → B → recitire. Notele sunt citate în §6.4. Aserțiunea pentru S0 la `7fccfbe` e și în `concurenta_test.ts` l.856.
- **Q20** (26.09, ~02:50Z): Supabase `get_edge_function('ofertare-plansa-citeste')`: versiunea 25, `updated_at` 2026-09-25 16:26:02Z, `COD_VERSIUNE` 2026-09-25.5, fără `identificaRanduri`. SELECT pe lic. 95 (coloanele verificate întâi în `information_schema.columns`): 1751–1756 neschimbate (toate `extras`, Σ 48.195 / 48.195, 1756 = 13.140 / 13.140, `updated_at` 2026-09-25 16:51:08.040401+00), 0 validate, 0 clarificări legate; #63 / #64 `de_trimis`, `raspuns` NULL; doc 470: transfer `facut` 16:51:08.205Z, `sumar.lungime_totala_m` 48.195. Global: `extras` 1.080, `validat` 4, `diferenta` 2.
- **Q21** (26.09, ~07:00Z, revizia 6):
  - `git log -1` / `git log origin/main..<ramură>`: R4 `7a7bf86` (05:23:33Z; cod `3197aa3`), consumatori `6313184` (06:37:43Z, peste `7a7bf86`), R7 `80d618f`; `git ls-remote origin`: niciuna dintre cele trei pe `origin`, `origin/main` = `a4b2982`;
  - copii `git archive`, `deno test --node-modules-dir=none --no-lock -A` cu type-check: `7a7bf86` 158/158 (planșa 141/141), `6313184` 190/190 (planșa 168/168); `COD_VERSIUNE` 2026-09-26.13 pe ambele; `deno.lock` md5 `875e293d…`, neschimbat;
  - probă `treciInCantitati` pe copiile `7a7bf86` (exportată doar în copie) și `6313184`, cu 1756 în starea lăsată de pasul B, nota reală (S0–S4): notele citate în §6.4; `corectieR5B(nota reală)` = `false` la `6313184`; marcajul „R5 pas B” pierdut în toate scenariile;
  - harness SQL (Postgres 16 local, port 55488, oprit și șters): SQL-ul extras din această revizie + varianta A și rollback-ul A extrase din R4 la `7a7bf86` ⇒ 87 / 87; SQL-ul reviziei 5 ⇒ 83 / 87 (pică exact cele 4 verificări noi de proveniență);
  - SELECT pe BD (coloanele verificate întâi în `information_schema.columns`): 1751–1756 neschimbate (toate `extras`, 1756 = 13.140 / 13.140, `updated_at` 2026-09-25 16:51:08.040401+00); #63 / #64 `de_trimis`, `raspuns` NULL; doc 470 transfer `facut`; `ofertare_cantitati_istoric` nu există (migrarea consumatorilor neaplicată).

## Jurnal de corecturi
### Revizia 6 (26.09, ~07:00Z): minorele verificatorului reviziei 5 + capetele noi ale ramurilor
| # | Gravitate | Problema | Ce s-a schimbat |
|---|---|---|---|
| 1 | minor | Criteriul 2 (l.45) spunea că a rămas o singură cale de umflare tăcută (ADV7-A), iar condiția (b) numea golurile din secvența Nr „fără efect asupra totalului”. Verificatorul a reprodus și alte căi: dubla parțială fără Nr (1.250 m în loc de 750), rândul lipsă din ambele felii (470 fără Nr 50 = 132 / 48.685 m, fără semnal), două tabele identice în benzi vecine | Criteriul 2 listează toate căile, cu starea de după rundele 7–9: (1)–(4) devenite vizibile (B1–B4), ce rămâne tăcut pe fiecare, NFL / DN0 închise, TOTAL-a / TOTAL-b deschise de reverificarea rundei 9. Condiția (b) e rescrisă. §6.5 are tabelul căilor tăcute. Rezumatul și verdictul nu mai vorbesc de „o singură excepție” |
| 2 | minor | Nota pasului B pe ramura 13.140 spunea „citirea automată actuală, cu deduplicarea pe text”, fals după o recitire R4 de tip ADV3b | Nota spune „cantitate_plansa = 13140 m (citirea automată curentă, vezi nota anterioară) rămâne ca istoric al extragerii”. Scenariul nou X3b + aserțiuni pe T4: 87 / 87; pe SQL-ul reviziei 5 pică exact cele 4 verificări noi |
| 3 | minor | §6.1 nu avertiza că rollback-ul din R4 §5.5 (la `ab5c449`, `WHERE id = 1756` fără gărzi) anulează tăcut pasul B | §6.1 are avertismentul (după B doar RB / RB-manual). Pe ramura R4 rollback-ul e acum condiționat (rundele 7–9); scenariul RBA pe SQL-ul de la `7a7bf86`: 0 rânduri după B |
| 4 | (nou) | Antetul, criteriile 1–2, §6.3–§6.5 și §7.1 descriau capetele `ab5c449` / `7fccfbe` | Capete noi: R4 `7a7bf86` (rundele 7–9; reverificarea rundei 9 nu confirmă: 2 majore), consumatori `6313184` (condițiile Copilot 1–2 tratate, runda 5 confirmată, 4 minore). Teste reproduse: 158/158 și 190/190 |
| 5 | (nou) | Codul consumatorilor recunoaște marcajul „ R5 v2 pas B”, iar pasul B din §7.3 scrie „ R5 pas B”; modelul din testele ramurii pune cifra corectată în `cantitate_plansa` | Documentat în §6.3 / §6.4, cu probă (Q21): protecția etichetei nu se aplică pe 1756, marcajul se pierde la orice retransfer. Alinierea e o decizie (Razvan / runda următoare); SQL-ul pasului B nu e schimbat aici |

### Revizia 5 (26.09, 02:50Z): reverificarea reviziei 4 + starea finală a ramurilor
| # | Gravitate | Problema | Ce s-a schimbat |
|---|---|---|---|
| 1 | major (a doua oară) | R5 descria o stare a ramurii R4 depășită la salvare: „capul = `759c5e3`”, fix-ul rundei 5 „necomis”, în „Rămâne de făcut” un pas deja făcut, iar varianta B din R4 „necomentată”. Între timp ramura avansase la `8db5587` (runda 5) și apoi la `ab5c449` (runda 6, verificată și confirmată) | Documentul e ancorat pe capetele finale, verificate cu `git log -1` imediat înainte de salvare: tabelul „Starea codului” din antet (R4 `ab5c449`, consumatori `7fccfbe`, ce e deployat). Criteriul 2 = „remediat în cod pe ramură, verificat adversarial, nedeployat”, cu condițiile (a)–(d) marcate făcut / nefăcut. §6.5 e rescris: regulile de identitate pe runde, cu sha-uri și suitele de teste; tabelul cazurilor adversariale are „înainte de fix” și „la `ab5c449`” (reprodus, Q18); limitele rămase includ cele 3 minore ale verificării finale. §6.1: variantele A/B din R4 sunt comentate la `ab5c449`, iar B tot nu e condiționată de verificarea pe imagine. Rezumatul, §0, §3, §7.1 și Q-list sunt aliniate; Q17 e marcat istoric |
| 2 | minor | Pe drumul VA (varianta A din R4, aplicată manual, apoi B), nota lui B atribuia cifra planșei unei „recitiri” | Nota lui B spune „citirea automată sau corecția cu identitatea rândului, vezi nota anterioară” (ramurile WHEN și ELSE), iar mesajul gărzii pomenește și corecția A. Harness-ul SQL are aserțiuni pe textul notei (X2, VA) și scenariul nou VAc: 71 / 71 după; pe SQL-ul reviziei 4 pică exact cele 5 verificări noi |
| 3 | (nou) | Criteriul 1 și §6.3 citau încă `990a6b1` | Ramura consumatorilor e descrisă la `7fccfbe` (reașezată peste `ab5c449`, verificată), cu minorele verificării și cu cele două condiții Copilot din 26.09 dimineața, încă netratate explicit |
| 4 | (nou) | §6.4 descria nota pe 1756 doar pentru codul „HEAD” și pentru R4 singur | Trei variante de cod (deployat azi, R4 singur, R4 + consumatori). Notele de după pasul B sunt reproduse pe copii (Q19). La `7fccfbe`, eticheta „citire anterioară” rămâne greșită pentru B = 13.750 și la o citire parțială; remedierea propusă nu e implementată |

### Runda 4, reverificare (26.09, istoric; starea ramurii de atunci e înlocuită în revizia 5): verificatorul reviziei 4
| # | Gravitate | Problema | Ce s-a schimbat |
|---|---|---|---|
| 1 | major | R5 descria runda 4 drept necomisă, deși era comisă (`a9fe186` + `759c5e3`, 26.09 00:14:05Z). Blocantul și contopirile apăreau ca deschise, iar în „Rămâne de făcut” era un pas deja făcut | Starea e adusă la `759c5e3` în: tabelul criteriilor (rândul 2 și condițiile a–d), rezumat, §0, §3, §6.1 (variantele A/B din R4, comise; VA testat), §6.4, §6.5, §7.1 și Q-list (Q17). În §6.5, tabelul cazurilor are coloana `759c5e3` lângă cea istorică de la `1fd76dd`, iar „Rămâne de făcut” nu mai conține pasul făcut. **Constatare nouă:** blocant deschis și la `759c5e3` (felia cu Nr lipsă sau cu antete altfel → umflare tăcută, reprodus), cu fix-ul în runda 5, necomisă. Criteriul 2 rămâne deschis |
| 2 | minor | Nota lui B, pe ramura ELSE, atribuia diferența lui Nr 38 (fals la 260 / 300 / 320 după o recitire R4) | Nota numește diferența și cele trei valori verificate (X2d) |
| 3 | minor | RB-manual presupunea că planșa 13.140 înseamnă citirea din R0 (V4: restaura nota R0 cu „+600 m” inexistenți) | Parametru nou `c_plansa_r0`: revine la R0 numai dacă cifra planșei e aceeași ca în R0; altfel pune o notă neutră cu ambele cifre (V4, V4b, RM1b, RM8) |

Observațiile reverificării despre R7 (formularea „alternative”, „până la”, tipurile nedeclarate, garda rollback-ului) sunt rezolvate în `R7_FISA_DECIZII_VALCELELE.md`, revizia 4 după reverificare.

### Runda 4 (26.09): verificatorul rundei 3
| # | Gravitate | Problema | Ce s-a schimbat |
|---|---|---|---|
| 1 | major | Criteriul 2 („deduplicarea pe identitatea rândului, reparată și testată”) era prezentat ca închis, dar testul adversarial pe ramura R4 găsește pierderi tăcute (ADV3b: 132 / 48.605; ADV4), iar verificarea R4 a rundei 3 găsește un blocant (rândul de margine: 49.225 / 49.205) și alte contopiri | Criteriul 2 = **deschis, în lucru pe ramura R4 (runda 4)**, cu condițiile de închidere (tabelul criteriilor). §6.5 rescris: ce e comis, ce trece, tabelul cazurilor care pică (reproduse la 26.09, Q16), ce rămâne. Rezumatul, §0, §3 și §7.1 nu mai spun „reparat”. (Starea ramurii descrisă atunci a fost depășită; starea finală e în revizia 5.) |
| 2 | minor | Pasul B: `cantitate_plansa` NULL trecea garda (X1); „cine a verificat” putea fi gol (X5) | `IS NULL OR … NOT IN`; `nullif(btrim(c_validat_de), '') IS NULL`; testate (X1, X5, X5b) |
| 3 | minor | Nota lui B după o recitire R4 spunea „rămâne 13740 până la recitire”; status `diferenta` fără diferență neexplicat | Nota depinde de `cantitate_plansa` (3 variante, X2 / X2c); §6.1 explică statusul fără diferență numerică |
| 4 | minor | RB-manual lăsa o notă falsă, fără gărzi de serializare, cu 13.740 fix în cod | RB-manual = bloc DO cu parametri din B-verif și R0, aceleași gărzi ca RB, nota restaurată din R0 sau notă neutră (T9, X2b, RM1–RM7) |
| 5 | minor | §6.4 afirma că fix-ul consumatorilor corectează eticheta „Memoriu” | Reformulat: fix-ul o schimbă în „citire anterioară … nu e confirmată”, tot greșit pentru un rând modificat de B; remediere propusă pe ramura consumatorilor |
| 6 | minor | §4 păstra „diferența candidată (+4.440 … +4.560)” | „Niciunul dintre scenariile S0–S3 (+4.440 … +4.560, §3)” |
| 7 | (nou) | Documentul R4 propune alt SQL pentru 1756 (`cantitate` + `cantitate_plansa`, fără verificarea pe imagine) | §6.1: relația cu pasul B, cel mult un drum care schimbă `cantitate`; de aliniat pe ramura R4 |

Observațiile verificatorului rundei 3 despre R7 sunt rezolvate în `R7_FISA_DECIZII_VALCELELE.md`, revizia 4.

### Runda 3 (25.09 seara): verdictul Copilot + verificatorul rundei 2
| # | Sursa | Problema | Ce s-a schimbat |
|---|---|---|---|
| 1 | Copilot (a) | „4.020 în ofertă, 13.765 separat” nu demonstrează cantitatea de ofertat; amplasarea în afara UAT nu dovedește excluderea | Pasul A e scos (§7.2, istoric pe scurt). 1751 rămâne 17.785 `extras`. 13.765 + 4.020 e doar descompunere analitică, ambele candidate (§2, §6.1) |
| 2 | Copilot (b) | +600 m doar după verificarea Oanei; constatarea rămâne cu locator | Pasul B e condiționat și schimbă doar `cantitate`. Locatorii pe imagine sunt în §6.2 (felie, rând, `zone_geom`) |
| 3 | Copilot (c) | Răspunsul AC nu e singurul criteriu | Tabelul cu cele 6 criterii de închidere și starea fiecăruia |
| 4 | Copilot | Sensul lui „în afara ofertei până la reconciliere” | Rezumat, §0 pct. 4, §4, §6.3: nevalidat ≠ aprobat, fără eliminarea automată a altor UAT |
| 5 | Copilot | Verificarea consumatorilor | §6.3 → `docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md` (livrabil separat, în lucru); derivatele lic. 95 = 0 (Q12) |
| 6 | Copilot | Baza 4.550; 4.440–4.560 ca scenarii distincte | §3: S0 (bază), S1, S2, S3 + cifra BD, fiecare cu ajustarea care o produce |
| 7 | Copilot | Ordinea lucrului | §7.1 |
| 8 | Copilot + R4 | Multiset-ul nu ajunge | §6.5: identitatea rândului (`a800d38`), `agregare_test.ts` 17/17 rerulat; Q9 marcat istoric. (Runda 4: criteriul redeschis — „reparat” era prematur) |
| 9 | Verificator runda 2 (major) | `tip_sursa='plansa'` pe rândul nou → `plansa_m` 13.765 în H2 / GraficPoarta | Dispare odată cu pasul A. E trecut ca motiv de respingere în §7.2 |
| 10 | Verificator runda 2 (minor) | B fără limită de plauzibilitate | Nr 40/41 între 250 și 350; Nr 38 ∈ {320, 330}; Dn40 între 13.640 și 13.850 (T2, T3, T3b) |
| 11 | Verificator runda 2 (minor) | După retransfer, B și RA refuză, cu mesaj înșelător | B nu mai depinde de nota lui A și funcționează și după un retransfer cu codul R4 (T10). Fiecare refuz are mesajul lui (T5, T9). RB refuză fără marcaj, iar procedura e RB-manual din R0 (T9). B și RB blochează doc 470 și cer `stare='facut'` |
| 12 | Verificator runda 2 (minor) | A și RA suprascriu `validat` | B refuză pe `validat` / `revizuit_clarificare` (T7). RB refuză dacă statusul nu mai e `diferenta` (T12). RA nu mai există |
| 13 | Verificator runda 2 (minor) | RA șterge fără să verifice `ofertare_clarificari.cantitate_id` | Niciun bloc nu mai șterge. Regula pentru orice ștergere viitoare e în §7.2; azi sunt 0 legături (Q12); legătura rămâne după B și RB (T14) |
| 14 | Verificator runda 2 (fix 4) | 1751 `diferenta` ar bloca controlul „cant” din GraficPoarta | 1751 nu mai e atins |

### Runda 2 (după verificatorul rundei 1)
| # | Problema semnalată | Gravitate | Ce s-a schimbat |
|---|---|---|---|
| 1 | SQL-ul propus nu era sigur: COMMIT necondiționat, INSERT fără gardă și fără idempotență (risc Dn200 dublu: 17.785 + 13.765), note adăugate la fiecare rulare | major | Rescris ca blocuri DO (§7): lock pe document și pe rânduri, verificarea stării de plecare, `GET DIAGNOSTICS` + `RAISE EXCEPTION` pe fiecare UPDATE, INSERT cu `WHERE NOT EXISTS` pe cheia unică, note `NOT LIKE '%R5 v2%'`, verificarea finală a sumelor, rollback separat (RB, RA) plus SELECT de snapshot (R0). Dn40 scos din pasul A și mutat în pasul B, condiționat. Testat local în 16 scenarii. |
| 2 | §3: „48.195 → 48.805” | minor | 48.195 + 600 = **48.795** |
| 3 | Remedierea de cod („cheia să includă Nr crt / nodurile”) nu se poate implementa | minor | §6: deduplicare pe multiset, cu multiplicitatea = maximul aparițiilor într-o felie; verificată pe BD (Q9); limita ei, efectul pe adnotări, testul Nr 37/40/41; se implementează pe ramura R4 |
| 4 | Efectele unui retransfer erau incomplete | minor | §6: `diferenta_nota` rescrisă pe 1752–1756, `cantitate_plansa` rescrisă (valoare schimbată doar pe Dn40), Dn200 ambiguu, `cantitate` neatinsă, rândul NULL invizibil în `v_ofertare_contradictii` |
| 5 | §1.2: coloana ±1% era calculată pe 131 de rânduri, deși documentul spune 133 | minor | Coloana e acum pe tabelul complet (133); idx 81 și 83 = **13** (11 pe `tronsoane_unice`); baza e precizată (Q1b) |
| 6 | Locator `handler.ts` l.460 | minor | **l.459** |
| 7 | Formulări prea tari: „diferența corectă +4.550” și „nicio combinație de rânduri întregi” | minor | Rezumat, §0, §3 și §4: diferența candidată e **+4.440 … +4.560**; „nicio combinație de rânduri **Dn200** întregi”, cu combinațiile de pe toate rândurile arătate ca argument (§4, Q10) |

Rândurile 1, 3, 4 și 7 din runda 2 sunt depășite de runda 3: pasul A a fost scos, multiset-ul a fost înlocuit de identitatea rândului, iar „diferența candidată +4.440 … +4.560” a devenit diferența de bază +4.550, cu scenarii distincte (§3).
