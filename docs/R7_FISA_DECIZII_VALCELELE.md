# R7 — Fișa de decizii financiar-contractuale, Vâlcelele (lic. 95), 25.09.2026

Analiză READ-ONLY: în BD s-au rulat doar SELECT-uri; nu s-a scris, nu s-a trimis nimic și nu s-a făcut niciun apel AI. Revizia 2: include corecturile celui de-al doilea evaluator (IBAN, pct. 2/4/7/8, maparea F1–F6, locatori).
**Surse:** doc 479 (Fișa de date, FD; „pag.” = marcajul ⟦PAGINA N⟧), 480 (contract .doc, fără pagini: titlul articolului + poziția caracterului în `text_extras`), 481 (formulare), 1276 (CS p01). Din BD: `ofertare_licitatii` 95, `ofertare_clarificari` 63/64, `ofertare_clauze_contract` 30–64, `ofertare_formulare_registru` 11–22, `ofertare_cerinte`, `ofertare_garantii`, `ofertare_pt_garantie`. Citatele sunt date din documentație, copiate literal.
**Bază de calcul (proxy):** valoarea estimată 37.366.625,89 lei (`ofertare_licitatii.valoare_estimata`; 479 pag. 2), nu prețul ofertat.
**Termene:** depunere 19.10.2026 15:00 (ora RO) — vine **doar din BD** (`termen_depunere` = 2026-10-19 12:00 UTC); „19.10” nu apare în niciunul din cele 16 documente cu text ⇒ **de confirmat în anunțul SEAP CN1096479**. Clarificări până la **01.10.2026** = depunere − 18 zile (FD pag. 1, poz. 1 071: „Numar zile pana la care se pot solicita clarificari inainte de data limita de depunere a ofertelor/candidaturilor 18”); răspunsul AC ≤ **08.10.2026** (FD pag. 17, poz. 80 522: „cel târziu cu 11 zile înainte de data-limită”). Ambele date derivă din termenul din BD. #63 și #64 sunt `de_trimis` (netrimise).

## Sumar

| # | Punct | Recomandare | Impact (valoare estimată) | Parametru platformă: acum → propus |
|---|---|---|---|---|
| 1 | GBE | Poliță/SGB 10%: pe E1 + completare dacă AC confirmă (#64 pt 1a), altfel pe total. Fără rețineri succesive. Termen tratat ca 5 zile calendaristice | 3.736.662,59 (total) vs 829.890,92 (E1) | cl. 30/32 corecte literal; cl. 31 = „5 zile” (480) vs „5 zile lucrătoare, prelungibil 15” (479) → notă; toate neverificate |
| 2 | Garanția de participare | Poliță prin broker 370.000 lei, CUI 3796837, **150 zile** (minim legal 123 = 19.10.2026→19.02.2027), după confirmarea datei în SEAP | primă proxy ≈ 1.536 (123 z) / ≈ 1.873 lei (150 z) vs 370.000 blocați la virament | UI propune **90 zile** (→17.01.2027) ✗ → 150; textul din BD „IBAN mascat” ✗ |
| 3 | Penalități (executant + AC) | Trimitem #64 pt 2b/2c; rezervă de risc în preț | 30 zile întârziere: 248.967 (E1) / 872.032 (E2) / 1.120.999 (total) | cl. 33/34 corecte; cl. 35: `termen_zile 60` = perioadă de grație, nu periodicitate; plafonul = interpretare AI |
| 4 | Ajustarea prețului | #64 pt 3; prețuri la data ofertei, ajustarea = protecție | materiale +10% ⇒ +5,5%: 456.440 (E1) / 2.055.164 (total); risc: Dată de Referință ulterioară ofertei | cl. 40–42 corecte; nu există câmp pentru Data de Referință / indicii INS |
| 5 | Avans | #64 pt 4 ca confirmare; cash-flow cu avans 0 | prefinanțare OS E1 134.446,35 + primele 45–60 zile | niciun parametru; formula e în cl. 40 |
| 6 | Plăți / decontare (F1) | Listă de prețuri proprie, granulară (etapă × categorie × tronson/Dn), începută acum | capital blocat ≈ 4,67–6,23 mil. (ipoteza: 12 luni uniform) | cl. 36–38 corecte; `ofertare_cantitati` 95: 6 rânduri, `obiect` NULL |
| 7 | Etapa 2 | Costurile fixe integral în E1; scoatem pt 5 din #64 | E1 = 22,21% din total; GBE pe total = 45,03% din E1, blocată ≤10 luni de la semnare până se știe soarta E2 | `valoare_estimata` corectă; fără câmpuri E1/E2 (Formular 9, id 20 `de_pregatit`) |
| 8 | Termen de execuție | Grafic cu E1 realist **+ marjă** (durata E1 din grafic = jalon penalizabil) + întrebare nouă doar pe baza de calcul a penalităților pe jaloanele E1 | 8.298,91 lei/zi pe E1; 29.067,72 lei/zi pe E2 | cl. 43: `evaluare_gazpet` „12 luni pentru Etapa 1” ✗ (în documente: E1+E2) |
| 9 | Garanția lucrărilor | 36 luni de la recepția la terminare, recepții separate pe etape | 36 luni de intervenții + GBE ținută până la recepția finală | `ofertare_pt_garantie` 95: 0 rânduri → cerut/oferit 36, `receptie_terminare` (cerința 6407) |
| 10 | Obligații „de ansamblu” | #64 pt 2a; termenele de 5 zile după semnare pregătite dinainte | 37.366,63 lei/zi (total) vs 8.298,91 (E1), ×4,5 | nimic marcat în platformă |

## Mapare pe criteriul R7 (F1–F6)

Criteriul de închidere R7 (`RESTANTE_AUDIT_OFERTARE.md`, rândul R7, linia 15): „Fiecare punct F1–F6 are decizie scrisă și, unde e cazul, parametru în aplicație”. Constatările F1–F6 = `MATRICE_ACOPERIRE_AUDIT_OFERTARE.md` liniile 26–31.

| F (matrice) | Constatare | Punct în fișă | Decizia cerută lui Razvan | Recomandare |
|---|---|---|---|---|
| F1 (l. 26) | F3 / liste de cantități lipsă (VALCELELE §1); cererea e în #63 pt 5 | pct. 6 | Ofertă forfetară pe **Lista de prețuri proprie**, începută acum, **vs** așteptarea răspunsului AC la #63 pt 5 (≤08.10; rămân 11 zile până la depunere) | Lista proprie acum (pct. 6 A), ajustată după răspuns |
| F2 (l. 27) | Clauze: citat VERIFICAT, interpretare NETESTAT | pct. 1, 3, 4, 5, 8, 10 | Validarea interpretărilor din fișă + verificarea umană a celor 35 de clauze (35/35 `verificat_de` NULL), cu notele la cl. 31, 35, 43 | Verificare din UI (ștampila = omul care confirmă) |
| F3 (l. 28) | GBE: rol, termen 5 zile | pct. 1 (+ pct. 7) | Forma și baza GBE; termenul | C dacă AC confirmă 1a, altfel A; 5 zile calendaristice |
| F4 (l. 29) | Plată / ajustare / Etapa 2 | pct. 4, 5, 6, 7, 8 | Ajustare, avans, repartizarea costurilor fixe, durata E1 | Ajustare = protecție; avans 0; costuri fixe în E1; E1 cu marjă |
| F5 (l. 30) | Garanția de participare: aplicare + valabilitate | pct. 2 | Forma, valabilitatea, textul din BD | Poliță prin broker, 150 zile, CUI 3796837; SQL de mai jos după confirmare |
| F6 (l. 31) | Formulare 481 (matricea spune „registru = 0” — depășit: registrul 95 are 12 rânduri, id 11–22, toate `de_pregatit`) | nou: acest rând + tabelul „Parametri platformă” (R7 §8) | (a) aplicabilitatea: Formularele nr. 4/41 (terț susținător), nr. 5 (asociere), nr. 6 (subcontractare) sunt `aplicabil=false` ⇒ ofertant individual, fără terți/subcontractanți; Formularul nr. 2 (Împuternicire) e `true`, necesar doar dacă semnatarul ≠ persoana din DUAE (479 pag. 16, poz. 73 485). (b) cele 5 livrabile din FD fără formular 481 (R7 §8: garanția de participare, DUAE răspuns, Lista de prețuri + Graficul, Planul de management al calității, docs terț „dacă e cazul”) nu sunt în registru | (a) confirmă strategia „individual, fără subcontractare” sau corectează flag-urile; (b) rânduri noi în registru, cu preview → confirmare → apply (Oana Nica completează) |

---

### 1. GBE
- **Citate.** 479 pag. 12, III.1.6.b (poz. 50 790): „Cuantumul garanției de buna execuție este de 10% din valoarea contractului fara TVA.” Termen: 479 pag. 17, VI.3 (poz. 77 377) „în termen de maxim 5 zile lucratoare de la data semnarii contractului public, termen ce poate fi prelungit pana la 15 zile” vs 480 (poz. 54 966) „cel mai tarziu in termen de 5 zile de la data semnarii contractului”.
- Forme: SGB de la IFN admisă sub 40 mil. lei (479 pag. 17, poz. 78 190); rețineri succesive cu depunere inițială „nu poate fi mai mică de 0,5% din prețul contractului” (480 poz. 54 296). Ordinul de începere E1 „numai dupa constituirea” GBE (480 poz. 14 200); eliberarea după „art. 42 alin. (3) si (4) din HG nr. 395/2016” (480 poz. 57 577).
- **Interpretare.** Baza = Prețul total E1+E2 (480 poz. 10 569: „suma acestora reprezinta Pretul total al Contractului”). Contractul nu reduce GBE dacă E2 nu se activează (pct. 7, 480 poz. 15 023). Procentul reținut din fiecare factură nu e definit.
- **#64.** Întreabă pt 1a (total vs E1 cu completare) și 1b (zile lucrătoare). Lipsesc: procentul reținut pe factură și reducerea GBE la notificarea că E2 nu se activează (propuse mai jos).
- **Impact.** 10% pe total = 3.736.662,59 lei (45,03% din E1) vs 829.890,92 pe E1; rețineri: inițial 186.833,13 (total) / 41.494,55 (E1). Cost instrument: fiecare **1%/an din suma garantată** = 37.366,63 lei/an (total) vs 8.298,91 (E1); prima reală o dă brokerul (`gbe_polite` nu are câmp de primă).
- **Opțiuni.** A) poliță/SGB 10% pe total din prima zi; B) rețineri succesive; C) poliță pe E1 + completare la activarea E2 (doar dacă AC confirmă la 1a).
- **Recomandare.** C dacă AC confirmă, altfel A. Nu B: cu baza pe total și E2 căzută, s-ar reține până la 45% din facturile E1. Planificăm pe 5 zile calendaristice, cu draftul poliței gata înainte de semnare.
- **Platformă.** Cl. 30 (`procent 10`) și 32 (0,5%) corecte literal; cl. 31 (`termen_zile 5`) = 480, ≠ 479 ⇒ notă la verificare. `contract_id` NULL (evidența GBE începe după atribuire).

### 2. Garanția de participare
- **Citate.** 479 pag. 11, III.1.6.a (poz. 50 294): „în cuantum de 370 000 lei […] contul RO71TREZ2015006XXX000189, deschis la Trezoreria Călărași, beneficiar UAT Vâlcelele, CUI 379683.” Același beneficiar: 479 pag. 1, I.1 (poz. 260) „Cod de identificare fiscala: 3796837”; 480 preambul (poz. 740–800) „cod fiscal 3796837, cont trezorerie RO71TREZ2015006XXX000189” (singura apariție a IBAN-ului în 480, poz. 776).
- Valabilitate: 479 pag. 16 (poz. 75 575): „cel puțin egală cu perioada de valabilitate a ofertei, respectiv 4 luni de la data limita de depunere a ofertei stabilită prin anunțul de participare publicat în SEAP”. 4 luni de la 19.10.2026 = 19.02.2027 = 123 zile (data din BD, de confirmat în anunț).
- **Verificare.** CUI 3796837 are cifra de control validă, 379683 nu (algoritmul CIF, cheia 753217532) ⇒ greșeală de tipar în III.1.6.a. IBAN: valid ISO mod-97 așa cum e scris și identic în contract (480 preambul) ⇒ „XXX” face parte, foarte probabil, din IBAN. Mod-97 singur nu dovedește: 11 din 1000 de variante numerice trec și ele.
- **Impact.** 370.000 lei = 0,99% din valoare (479 pag. 2). Virament: 370.000 blocați ≥123 zile, iar dacă câștigăm, până la dovada GBE (480 poz. 55 143).
- Poliță, proxy `ofertare_garantii` id 1 (singura cu primă: 1.185,20 / 292.641,99 = 0,405% pentru 120 zile): ≈ 1.498,50 lei la rată fixă, ≈ 1.536 lei pro-rata la 123 zile, ≈ 1.873 lei pro-rata la 150 zile ⇒ marja costă ≈ 337 lei.
- **Opțiuni.** A) virament; B) poliță prin broker (tabul 🛡) pe exact 123 zile; C) B cu marjă: 130–150 zile (până la 26.02–18.03.2027).
- **Recomandare.** C, 150 zile (acoperă o decalare a termenului de ≈ 27 de zile), cerută după confirmarea datei-limită din anunțul SEAP. La orice decalare peste marjă, polița se reemite/actualizează: UI-ul avertizează (`OfertareGarantie.jsx:212`), dar numai cât polița nu e în starea `original` (linia 168).
- **Platformă.** `garantie_participare` spune „IBAN-ul e mascat” ✗ (SQL propus mai jos); `ofertare_garantii` pt 95: 0 rânduri. UI pune implicit **90 zile** (`OfertareGarantie.jsx:56`: cerințele 6386/6427 nu conțin „NNN zile”) ⇒ 17.01.2027, sub 19.02.2027; câmpul „Valabilitate (zile)” se pune manual.

### 3. Penalități (executant + autoritate)
- **Citate.** 480, „Sanctiuni pentru neindeplinirea culpabila a obligatiilor” (poz. ~51 450–52 700). Pentru executant: „penalitati in cuantum de 0,1% pe zi, calculate prin raportare la valoarea fara TVA a etapei sau a partii de Contract afectate” și „0,1% pentru fiecare zi de intarziere”. Pentru AC: „in termen de 60 de zile de la expirarea perioadei convenite […] 0,1% din plata neefectuata, pana la indeplinirea efectiva a obligatiilor. Cuantumul penalitatilor nu poate depasi valoarea debitului restant.”
- **Interpretare.** Pentru executant: 0,1%/zi, fără plafon în 479/480. Singurul „nu poate depasi” e la AC (480 poz. 52 286). Pentru AC: penalitatea curge abia după 30+60 de zile, periodicitatea nu e scrisă (lipsește „pe zi”), iar suma e plafonată la debit.
- **Ce întreabă #64.** Pt 2b (plafon) și 2c (periodicitatea penalității AC).
- **Impact la 30 de zile de întârziere.** E1: 248.967,27 lei; E2: 872.031,50 lei; total: 1.120.998,78 lei. Pe zi: 8.298,91 / 29.067,72 / 37.366,63 lei.
- **Opțiuni.** A) acceptăm ca atare + buffer în grafic; B) trimitem #64 pt 2 + rezervă de risc în preț; C) no-go dacă nu există plafon.
- **Recomandare.** B. Mărimea rezervei (lei) o decide Razvan. No-go (C) doar dacă graficul pe 12 luni nu e realist (vezi pct. 8).
- **Platformă.** Clauzele 33/34 (`0.1`, `termen_zile 1`) sunt corecte. La clauza 35, `termen_zile 60` e perioada de grație, nu periodicitatea, iar `plafon_procent 100` e o interpretare a AI. Se notează în `evaluare_gazpet` la verificare.

### 4. Ajustarea prețului
- **Citate.** 479 pag. 4–5, II.3 (poz. 13 248–14 900): „An = av + m * Mn/Mo + f * Fn/Fo + e * En/Eo […] m = 0,55; f = 0,25; e = 0,20 […] aplicabili la data cu 60 de zile înainte de ultima zi a lunii „n" […] „Fo", „Eo", „Mo" […] aplicabili la Data de Referință” (479 poz. 14 427).
  - 480 art. 5.3 (poz. 11 198–12 900) lasă indicii, „inclusiv sursa acestora”, pe seama celor „stabilite de Achizitor prin documentaţia de atribuire şi anexele Contractului” (480 poz. 12 415).
  - Ajustarea se aplică „exclusiv pentru lucrările efectiv executate și acceptate la plată” (480 art. 5.2).
- **Interpretare.** Prețul e ajustabil 100% (nu există termen fix), cu un decalaj de ~2 luni. „Data de Referință” și seriile INS pentru M/F/E nu sunt definite nicăieri în corpus.
- **Ce întreabă #64.** Pt 3 (data de referință pentru Mo/Fo/Eo + indicii INS).
- **Impact (sensibilitate).** Materiale +10%, restul constant ⇒ An = 1,055 ⇒ +5,5% pe lucrările facturate: 456.440,00 lei (E1) / 2.055.164,42 lei (total).
- **Riscul Datei de Referință.** (i) Dacă Data de Referință e **ulterioară ofertei** (semnarea sau un ordin de începere), indicii de bază se iau la acea dată, deci creșterile de preț dintre depunere (19.10.2026) și Data de Referință rămân **necompensate** — pentru E2, care poate porni la până la 10 luni de la semnare (pct. 7), intervalul poate fi lung. (ii) Creșterile dintre estimarea AC și depunere le prețuim oricum în ofertă, dar oferta trebuie să rămână **≤ valoarea estimată** (37.366.625,89, 479 pag. 2; o ofertă peste ea riscă respingerea ca inacceptabilă — regulă legală, nu text din corpus), deci acele creșteri **comprimă marja**.
- **Opțiuni.** A) prețuim fără să contăm pe ajustare; B) prețuim ținând cont de ajustare, după răspunsul la pt 3; C) nu întrebăm.
- **Recomandare.** B, cu A ca plasă de siguranță: prețurile materialelor la data ofertei, ajustarea tratată ca protecție, nu ca marjă. Dacă AC răspunde cu o dată ulterioară ofertei, rezerva pentru intervalul depunere → Data de Referință intră în preț.
- **Platformă.** Clauzele 40–42 sunt corecte. Nu există câmp pentru Data de Referință sau indici; se trec ca notă la verificare.

### 5. Avans
- **Citate.** 479 pag. 4 (poz. 13 658): „„av" este un coeficient fix și reprezintă valoarea procentuală a plății în avans față de Prețul Contractului; pentru prezentul contract av = 0”. 480 (poz. 11 527): „,,av''= 0”. Alte apariții ale „avans” nu privesc plata (480 poz. 64 861 = „lucrarile avanseaza”).
- **Interpretare.** Nu există nici clauză de avans, nici clauză explicită de refuz. Planificăm fără avans.
- **Ce întreabă #64.** Pt 4.
- **Impact.** Prefinanțăm integral organizarea de șantier E1, 134.446,35 lei (479 pag. 2: 100.000,00 + 34.446,35), plus lucrările până la prima încasare (45–60 de zile, pct. 6).
- **Opțiuni.** A) acceptăm fără să întrebăm; B) păstrăm pt 4 ca confirmare; C) cerem avans (nerealist, ar schimba documentația).
- **Recomandare.** B, dar cash-flow-ul se modelează cu avans 0 indiferent de răspuns.
- **Platformă.** Nu există parametru de avans (formula e în clauza 40).

### 6. Plăți / decontare (acoperă F1)
- **Citate.** 480, „Modalitati de plata” (poz. 75 240): plata se face „la valoarea lucrarilor efectiv executate,măsurate, verificate si acceptate […] corelate cu progresul fizic realizat”. Apoi: „(2) Situatiile de plata partiale se confirma/infirma in termen de maxim 15 zile […] (4) Platile se efectueaza in termen de 30 de zile de la primirea facturii”.
  - CS 1276 pag. 25 (poz. 85 136): „Decotarea lucrărilor se face în funcție de stadiul fizic realizat pentru categoria de lucrări inclusă în Lista de prețuri anexă a formularului de ofertă […] încadrarea în sume forfetare.”
  - FD 479 pag. 12, III.1.7: contractul „prevede articole impuse de finanțator”.
- **Interpretare.** Decontarea e forfetară, pe categoriile din Lista de prețuri pe care o facem noi: cât de detaliată e lista decide cât de des putem factura. Ciclul real e ≥45 de zile și se reia dacă AC trimite observații. Nu există model de listă în 481 și nici liste de cantități în corpus (F1, VALCELELE §1).
- **Ce întreabă #63/#64.** #63 pt 5 cere listele de cantități (5a) și structura Listei de prețuri (5b); #64 nu discută termenele de plată (impuse de finanțator).
- **Impact.** Ipoteză: facturare uniformă pe 12 luni nete, E1+E2 ⇒ 3.113.885,49 lei/lună ⇒ capital blocat ≈ 4.670.828 lei (ciclu de 45 de zile) până la 6.227.771 lei (60 de zile), fără TVA.
- **Opțiuni.** A) listă proprie granulară, începută acum: etapă × categorie × stradă/tronson/Dn, cu organizarea de șantier și utilajele/activele necorporale separat; B) listă pe capitolele devizului din FD; C) așteptăm modelul/listele AC (#63 pt 5; răspuns ≤08.10, deci rămân ≤11 zile calendaristice până la depunere).
- **Recomandare.** A, ajustată după răspunsul AC. Decizia F1: oferta se construiește pe lista proprie, nu se așteaptă #63 pt 5.
- **Platformă.** Clauzele 36–38 sunt corecte. `ofertare_cantitati` pentru 95 are 6 rânduri cu `obiect` NULL și nicio coloană de etapă. Propunere fără schimbare de schemă: convenția `obiect` = „Etapa 1” / „Etapa 2”.

### 7. Etapa 2 (condiționalitate + valoarea exactă)
- **Citate.** 479 pag. 4, II.2.14 (poz. 11 173): „Autoritatea Contractantă estimează că sursa de finanțare necesară Etapei 2 va fi asigurată într-un termen de maximum 10 luni de la data semnării contractului de achiziție publică. […] În situația în care, până la expirarea acestui termen, finanțarea necesară Etapei 2 nu este asigurată și nu este identificată o altă sursă legală de finanțare, lucrările aferente Etapei 2 nu vor fi activate și nu vor fi executate.”
  - 480 (poz. 15 023): „nu se îndeplinește în termen de maximum 10 luni de la data semnării Contractului, Achizitorul va notifica Executantul în acest sens. Contractul va continua să producă efecte pentru obligațiile aferente Etapei 1 și pentru celelalte obligații născute anterior notificării, fără ca neexecutarea Etapei 2 să constituie o neexecutare culpabilă a Contractului.”
  - 480 art. 4 (poz. 10 019): „nu conferă Executantului dreptul de a solicita plata lucrărilor neexecutate aferente Etapei 2, despăgubiri, daune-interese, profit nerealizat”.
  - Evaluarea se face „prin raportare la prețul total” (1276 pag. 2).
- **Valoarea exactă.** Suma celor 12 linii ale E2 din 479 pag. 2 (poz. ~3 460–4 296) = **29.067.716,73**. E1 (3 linii) = 8.298.909,16. **E1+E2 = 37.366.625,89 exact** (verificat cu SELECT). „29.067.716,7” (479 poz. 4 296) e aceeași valoare scrisă cu o singură zecimală, deci **diferența de 3 bani e lămurită din document**.
- **Legătura cu GBE (pct. 1, opțiunea C).** Timp de până la 10 luni **de la semnare** nu se știe dacă E2 pornește, iar după notificare contractul continuă pe E1 fără nicio reducere a GBE. O GBE pe total ținută 10 luni costă, la fiecare 1%/an din suma garantată, ≈ 31.138,85 lei, față de ≈ 6.915,76 lei pe E1 (diferență ≈ 24.223,10 lei). De aici: opțiunea C la pct. 1 și întrebarea despre reducerea GBE la notificare (#64, mai jos).
- **Ce întreabă #64.** Pt 5 întreabă valoarea E2, care acum nu mai e necesară.
- **Impact.** E1 = 22,21% din total. Dacă E2 nu pornește: încasări de maximum 8,30 mil. lei, GBE pe total = 45% din valoarea E1, iar costurile fixe puse pe E2 se pierd. E2 conține și livrări: utilaje 1.126.268,00 lei, dotări 145.112,01 lei, active necorporale 1.452.120,11 lei (479 pag. 2). Valoarea estimată nu include cheltuielile diverse și neprevăzute (571.551,99 lei, 479 pag. 2).
- **Opțiuni.** A) toate costurile fixe în E1, E2 prețuită separat; B) costurile fixe repartizate proporțional; C) no-go.
- **Recomandare.** A: E1 trebuie să fie profitabilă singură. Decizia GO rămâne (`decizie_go = 'go'`). Scoatem pt 5 din #64.
- **Platformă.** `valoare_estimata` = 37.366.625,89, corect. Nu există câmpuri separate pentru E1/E2. Formularul nr. 9 (registru id 20, `de_pregatit`) cere E1, E2, total, plus „constructii+instalatii” și „organizare de santier” (481 poz. ~26 510).

### 8. Termen de execuție
- **Citate.** 479 pag. 3, II.2.7 (poz. 5 871): „Durata in luni: 12”. 1276 pag. 2 (poz. 1 618): „Etapa 1 și Etapa 2, se executa în 12 luni”; la fel pag. 13.
  - 480 „Durata” (poz. 13 565): „12 luni termen de executie […] Termenul se calculeaza incepand cu data mentionata in Ordinul de incepere aferent Etapei 1. Perioada in care executarea lucrarilor aferente Etapei 2 nu poate incepe exclusiv ca urmare a neindeplinirii conditiei suspensive nu se include in termenul de executie.”
  - 480 (poz. 65 760): „Graficul fizic va evidentia distinct activitatile aferente Etapei 1 si Etapei 2, precum si succesiunea acestora.”
  - 480 (poz. 70 748–70 900; „orice faza” la poz. 70 800, „prevazuta a fi terminata” la poz. 70 822): „Executia lucrarilor in baza Contractului, precum si orice faza a acestora prevazuta a fi terminata intr-o perioada stabilita in graficul fizic, trebuie finalizate in termenul convenit conform art. 6 din prezentul Contract.”
  - 479 pag. 16 (poz. 73 220): Formularul de Ofertă cuprinde „termenul de execuție ofertat, identice cu valorile și termenul prezentate în Propunerea financiară, Propunerea tehnică și graficul de execuție”.
- **Interpretare.** Cele 12 luni sunt nete și acoperă **E1+E2**, nu doar E1. Împărțirea pe etape o stabilește graficul nostru, iar **durata E1 pusă în grafic devine termen contractual (jalon) penalizabil**: 0,1%/zi „prin raportare la valoarea fara TVA a etapei sau a partii de Contract afectate” (pct. 3). Contractul răspunde deja la „la ce termene se raportează penalitățile” (fazele din grafic); rămâne neclară doar **baza de calcul** pentru un jalon intermediar al E1 (valoarea fazei sau a întregii E1). E2 are 32,830 km din 44,355 km, adică 74,0% din lungime (1276 pag. 6).
- **Ce întreabă #64.** Nimic.
- **Impact.** O zi de întârziere pe un jalon E1 costă până la 8.298,91 lei (dacă baza e toată E1); pe E2, 29.067,72 lei. Fiecare lună alocată E1 se scade din timpul E2. Un E1 scurt (ex. ≤4 luni) **mărește expunerea** pe E1. Vremea previzibilă nu prelungește termenul (clauza 55).
- **Opțiuni.** A) grafic cu E1 **realist + marjă** (durata E1 = jalon contractual; marja se scade din lunile nete ale E2); B) A + o întrebare nouă în #64, **doar** despre baza de calcul a penalităților pe jaloanele E1; C) grafic proporțional cu valoarea (E1 ≈ 2,7 luni) — respins, expunere maximă.
- **Recomandare.** B (termen 01.10). Durata E1 și marja le propune echipa tehnică (Oana Nica) înainte de trimitere.
- **Platformă.** Clauza 43 (`luni 12`) e corectă, dar `evaluare_gazpet` spune „Termen de execuție de 12 luni pentru Etapa 1”, ceea ce e greșit. R7 §1 („E1 pe 12 luni ≈ 691.576 lei/lună”) pleacă de la aceeași ipoteză greșită.

### 9. Garanția lucrărilor
- **Citate.** 479 pag. 14, pct. 10 (poz. 63 017): „nu poate fi mai mică de 36 luni de la data semnării procesului-verbal de recepție la terminarea lucrărilor, fără obiecțiuni.” 480 (poz. 56 296): la recepții distincte pe etape, garanția „pentru partea receptionata curge de la data aprobarii procesului-verbal de receptie la terminarea lucrarilor aferent acesteia”. Viciile ascunse: 10 ani (clauza 48).
- **Interpretare.** 36 de luni e minimul, iar garanția nu se punctează (criteriul e preț 85 + plan de calitate 15, 479 pag. 2–3). Procentele de eliberare a GBE din HG 395 art. 42 nu apar în corpus: DE CONFIRMAT juridic.
- **Ce întreabă #64.** Nimic; documentele sunt clare.
- **Impact.** Costul intervențiilor pe 36 de luni (de inclus în preț) și partea din GBE ținută până la recepția finală.
- **Opțiuni.** A) oferim 36 de luni; B) oferim peste 36 (nu aduce puncte).
- **Recomandare.** A: 36 de luni de la recepția la terminare, cu recepții separate pe etape, ca garanția pentru E1 să înceapă și să se termine mai devreme.
- **Platformă.** `ofertare_pt_garantie` pentru 95 nu are rânduri. De completat din UI (pune ștampila de confirmare): cerut 36 / `receptie_terminare` (cerința 6407), oferit 36 / `receptie_terminare`. Clauza 47 e corectă.

### 10. Obligații „de ansamblu”
- **Citat.** 480, „Sanctiuni…” (poz. 51 815): „Pentru obligatiile care privesc Contractul in ansamblu, penalitatile se calculeaza prin raportare la Pretul total al Contractului, fara TVA.” E singura apariție cu sens contractual în 480.
- **Interpretare.** Obligațiile nu sunt definite. Candidați probabili (interpretarea mea, nu text din documente): constituirea GBE (5 zile), planul de organizare de șantier (5 zile, clauza 46), asigurarea (clauza 57), graficul și raportările. Riscuri conexe: daune de 50% din valoarea contractului la reziliere pentru conflict de interese (clauza 58, poz. 101 820) și rezilierea de drept după 10 zile lucrătoare (clauza 59).
- **Ce întreabă #64.** Pt 2a.
- **Impact.** Aceeași zi de întârziere costă 37.366,63 lei calculată pe total, față de 8.298,91 lei pe E1 (×4,5). Daunele de 50% din total ar fi 18.683.312,95 lei.
- **Opțiuni.** A) prețuim scenariul cel mai rău (tot ce e ambiguu = „de ansamblu”); B) așteptăm răspunsul la pt 2a.
- **Recomandare.** B, plus disciplină pe termenele de 5 zile de după semnare: GBE și planul de organizare de șantier pregătite înainte de semnare.
- **Platformă.** Nicio clauză nu marchează obligațiile „de ansamblu”. Clauzele 33, 58 și 59 sunt corecte literal.

---

## Propuneri pentru #64 (decide Razvan; nimic scris sau trimis)
1. Scoatem pt 5: valoarea E2 rezultă din liniile FD (29.067.716,73).
2. La pt 1 adăugăm: (c) ce procent se reține din fiecare factură la rețineri succesive; (d) dacă, la notificarea că condiția suspensivă a Etapei 2 nu s-a îndeplinit în 10 luni de la semnare (480 poz. 15 023), garanția de bună execuție se reduce la 10% din prețul Etapei 1.
3. Punct nou, restrâns: „Pentru fazele Etapei 1 prevăzute a fi terminate într-o perioadă stabilită în graficul fizic, penalitățile de 0,1%/zi pentru nerespectarea unui termen intermediar se calculează prin raportare la valoarea fazei respective sau la valoarea întregii Etape 1?”
4. #63 pt 6 (CUI) rămâne ca simplă confirmare; nu blochează.

## Parametri platformă de aplicat (preview → confirmare Razvan → apply)
| Parametru | Acum | Propus |
|---|---|---|
| `ofertare_licitatii.garantie_participare` (95) | „… CUI apare „379683” (vs 3796837) și IBAN-ul e mascat …” | textul din SQL-ul de mai jos (CUI 3796837; IBAN valid ISO mod-97 așa cum e scris și identic în 480; minim 123 zile; reemitere la decalare) |
| Cererea către broker (`ofertare_garantii`) | 0 rânduri; UI propune 90 zile | 370.000 lei, **150 zile** (sau 123, după decizie), beneficiar UAT Vâlcelele CUI 3796837; după confirmarea datei-limită în SEAP |
| `ofertare_pt_garantie` (95) | 0 rânduri | cerut/oferit 36 luni, `receptie_terminare`, cerința 6407 (din UI) |
| `ofertare_clauze_contract` 30–64 | 35/35 cu `verificat_de` NULL | verificare de către om, cu notele de la cl. 31, 35 și 43 |
| `ofertare_cantitati` (95) | 6 rânduri, `obiect` NULL | convenția `obiect` = Etapa 1 / Etapa 2 |
| `ofertare_formulare_registru` (95) | 12 rânduri (id 11–22), toate `de_pregatit`; Formularele nr. 4/41/5/6 `aplicabil=false` | aplicabilitate confirmată de Razvan (F6 a) + rânduri pentru livrabilele FD fără formular (F6 b); Formularul nr. 9 (id 20): E1 / E2 / total, C+I vs organizare de șantier, termenul identic cu graficul |
| `valoare_estimata` / `termen_depunere` | 37.366.625,89 ✓ / 19.10.2026 15:00 (ora RO) | fără schimbare; termenul se **confirmă din anunțul SEAP CN1096479** (nu apare în textul documentelor) înainte de cererea către broker |

```sql
-- NEEXECUTAT. Se rulează doar după confirmarea explicită a lui Razvan (pct. 3 din CLAUDE.md).
-- 1) Preview (păstrează textul vechi pentru rollback)
SELECT id, garantie_participare, updated_at FROM public.ofertare_licitatii WHERE id = 95;
-- 2) Apply: textul începe cu „370.000”, ca numar() din OfertareGarantie.jsx:30 să dea în continuare 370000 (testat local)
UPDATE public.ofertare_licitatii
SET garantie_participare = '370.000 lei (fișa de date III.1.6.a, doc 479 pag. 11), conform art. 154 L98/2016; virament sau instrument de garantare (SGB/asigurare), irevocabilă și necondiționată (FD VI.3); valabilitate ≥ 4 luni de la termenul-limită de depunere (FD pag. 16) = min. 123 zile (19.10.2026–19.02.2027; data depunerii de confirmat în anunțul SEAP); la orice decalare a termenului polița se reemite/actualizează. Beneficiar UAT Vâlcelele, CUI 3796837 (în III.1.6.a apare „379683” — cifră de control invalidă; confirmare cerută în #63 pt 6). IBAN RO71TREZ2015006XXX000189, Trezoreria Călărași — valid ISO mod-97 așa cum e scris și identic în contract (doc 480, preambul).',
    updated_at = now()
WHERE id = 95
RETURNING id, garantie_participare;
-- 3) Sanity check
SELECT id, left(garantie_participare, 60) FROM public.ofertare_licitatii WHERE id = 95;
```

Cod (tichet separat, nu în acest item): `OfertareGarantie.jsx:56` recunoaște doar „NNN zile”, așa că „4 luni” duce la valoarea implicită de 90 de zile; avertizarea de decalare (linia 212) nu apare după starea `original` (linia 168).

## Corecturi față de documentele anterioare
- IBAN „mascat” (VALCELELE §4, R7 §5, textul din BD): **greșit ca afirmație**. IBAN-ul e valid ISO mod-97 așa cum e scris și identic în contract (480 preambul, poz. 776); mod-97 singur nu e dovadă (11/1000 variante numerice trec).
- CUI: nepotrivirea din text rămâne, dar 379683 e invalid ⇒ CUI-ul corect e 3796837.
- „Cei 3 bani” (R7 §9 pt 6, linia 75, și Verdict „Cei 3 bani”, linia 92): **lămurit**, E2 = 29.067.716,73.
- „E1 pe 12 luni” (R7 §1, linia 18; clauza 43): **greșit**, cele 12 luni sunt nete pentru E1+E2.
- Matricea, F6 („registru = 0”, linia 31): **depășit**, registrul 95 are 12 rânduri (id 11–22).
- Locatorul „0,5%” (VALCELELE §2, „~poz. 53 500–54 300”): exact 480 poz. 54 296.

## Verificări (SELECT / calcul local)
| Verificare | Rezultat |
|---|---|
| IBAN mod-97 (Python, ISO 13616) | literal XXX: mod97 = 1; **11/1000 variante numerice trec și ele** (003, 100, 197, 294, 391, 488, 585, 682, 779, 876, 973) |
| IBAN în 480 | o singură apariție, poz. 776 (preambul), lângă „cod fiscal 3796837” (poz. 740) |
| Poziții 480 | 70 748 („Executia lucrarilor…”), 70 800 („orice faza”), 70 822 („prevazuta a fi terminata”), 65 760 („Graficul fizic va evidentia distinct”), 15 023 („nu se îndeplinește în termen de maximum 10 luni”), 54 296 („0,5%”), 14 200, 10 569, 55 143, 51 815, 13 565 |
| Poziții / pagini 479 | 11 173 și 11 298 (pag. 4, II.2.14), 50 790 (pag. 12), 75 575 (pag. 16), 77 377 / 78 190 / 80 522 (pag. 17), 73 220 / 73 485 (pag. 16), 1 071 (pag. 1: „…18”) |
| Termen depunere | `termen_depunere` = 2026-10-19 12:00 UTC (15:00 RO); `strpos('19.10')` = 0 în toate cele 16 documente cu text |
| Date / zile | 19.10.2026 + 4 luni = 19.02.2027 = 123 zile; +130 z = 26.02.2027; +150 z = 18.03.2027; implicit UI 90 z = 17.01.2027 |
| Registru formulare 95 | 12 rânduri (id 11–22), toate `de_pregatit` / `stare_depunere = nu`; `aplicabil=false`: id 14, 15, 16, 17 |
| Clauze / cantități / garanții | 35/35 `verificat_de` NULL; `ofertare_cantitati` 6/6 `obiect` NULL; `ofertare_pt_garantie` 95 = 0; `ofertare_garantii` 95 = 0, id 1 = 1.185,20 / 292.641,99 / 120 zile |
| #63 / #64 | ambele `de_trimis`; #63 pt 5 = liste de cantități + structura Listei de prețuri; #64 pt 5 = valoarea E2 |

## Decizii Razvan (opțiunea recomandată în paranteză)
1. F1 — Lista de prețuri: construim acum lista proprie granulară vs așteptăm #63 pt 5 (**lista proprie acum**, ajustată după răspuns).
2. F3 — GBE: A (total) / B (rețineri) / C (E1 + completare) (**C dacă AC confirmă 1a, altfel A; 5 zile calendaristice**).
3. F5 — Garanția de participare: virament / poliță 123 zile / poliță cu marjă (**poliță prin broker, 150 zile, CUI 3796837, după confirmarea datei în SEAP**) + aplicarea SQL-ului de mai sus.
4. Penalități: acceptăm / #64 pt 2 + rezervă / no-go (**#64 pt 2 + rezervă de risc; suma în lei o fixezi tu**).
5. F4 — Ajustare și avans (**prețuri la data ofertei, ajustarea = protecție; cash-flow cu avans 0**).
6. F4 — Etapa 2 (**costuri fixe integral în E1; GO confirmat**).
7. F4 — Termen: E1 scurt / E1 realist + marjă / proporțional (**E1 realist + marjă, propus de Oana Nica, + întrebarea restrânsă în #64**).
8. Garanția lucrărilor: 36 / peste 36 luni (**36 luni, recepții separate pe etape**).
9. F2 + F6 — clauze și formulare (**verificare umană a celor 35 de clauze; confirmi „ofertant individual, fără terț/asociere/subcontractare”; rânduri noi în registru pentru livrabilele FD fără formular**).
10. #64 + trimitere: (**scoatem pt 5, adăugăm pt 1c/1d și punctul nou despre jaloanele E1; #63 + #64 trimise pe SEAP de Oana Nica, cu aprobarea ta, până la 01.10**).
