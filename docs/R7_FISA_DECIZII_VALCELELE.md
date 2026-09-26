# R7 — Fișa de decizii financiar-contractuale, Vâlcelele (lic. 95)

Analiză READ-ONLY: în BD s-au rulat doar SELECT-uri; nu s-a scris, nu s-a trimis nimic și nu s-a făcut niciun apel AI.
- **Revizia 2:** corecturile celui de-al doilea evaluator (IBAN, pct. 2/4/7/8, maparea F1–F6, locatori).
- **Revizia 3 (25.09 seara):** finisajele reverificării (reemiterea poliței, text scurt pentru `garantie_participare`, F6 c).
- **Revizia 4 (26.09):** verdictul Copilot pe fișă, aplicat integral (secțiunea următoare), plus cele trei completări (lichiditate, planul de management al calității, condițiile fiecărei decizii), criteriile de închidere R7 și cele trei observații minore ale verificatorului rundei 3 (consumatorul AI omis, CS p02, rollback-ul care tăia notele ulterioare). Cifrele atinse sunt recitite pe BD la 26.09.
- **Revizia 4, după reverificare (26.09):** penalitățile pe E1 / E2 / total nu mai sunt numite „alternative” (relația dintre baze e nestabilită, #64 pt 2e) și „până la 8.298,91 lei/zi” nu mai sugerează un plafon; al șaselea tip de decizie, definit („aplicăm după verificarea sursei oficiale”), iar tabelul C și Sumarul folosesc numai tipurile definite; rollback-ul SQL refuză placeholder-ul neînlocuit (gardă md5, testată).

**Surse:** doc 479 (Fișa de date, FD; „pag.” = marcajul ⟦PAGINA N⟧), 480 (contract .doc, fără pagini: titlul articolului + poziția caracterului în `text_extras`), 481 (formulare), 1276 și 1277 (CS p01 / p02; 494 „Caiet de sarcini.pdf” nu are text). Din BD: `ofertare_licitatii` 95, `ofertare_clarificari` 63/64, `ofertare_clauze_contract` 30–64, `ofertare_formulare_registru` 11–22, `ofertare_cerinte`, `ofertare_garantii`, `ofertare_pt_garantie`, `ofertare_pt_capitole`. Citatele sunt date din documentație, copiate literal.
**Bază de calcul (proxy):** valoarea estimată 37.366.625,89 lei (`ofertare_licitatii.valoare_estimata`; 479 pag. 2), nu prețul ofertat. Toate sumele de mai jos sunt calculate pe ea.
**Termene:** depunere 19.10.2026 15:00 (ora RO) — vine **doar din BD** (`termen_depunere` = 2026-10-19 12:00 UTC); „19.10” nu apare în niciunul din cele 16 documente cu text ⇒ **de confirmat în anunțul SEAP CN1096479**. Clarificări până la **01.10.2026** = depunere − 18 zile (FD pag. 1, poz. 1 071); răspunsul AC ≤ **08.10.2026** (FD pag. 17, poz. 80 522: „cel târziu cu 11 zile înainte de data-limită”). Ambele date derivă din termenul din BD. #63 și #64 sunt `de_trimis` (netrimise, fără răspuns; SELECT 26.09).

## Cum se citește fișa
Fiecare decizie are **un singur tip**, dintre cele șase de mai jos. Tipurile nu se amestecă; precizările (ce se confirmă, cine confirmă) stau în coloana „Condiția AC / ipoteza” din tabelul C, nu în tip:
- **acceptăm riscul** — decizie comercială a lui Razvan, fără condiție din partea AC;
- **aplicăm dacă AC confirmă** — varianta intră în ofertă sau în platformă numai după un răspuns scris al AC (sau un act aplicabil). Până atunci se lucrează pe varianta de rezervă, iar varianta condiționată **nu** se introduce ca rezervă sau condiție în ofertă;
- **aplicăm după verificarea sursei oficiale** — decizia e luată și nu depinde de acceptarea unei variante de către AC; se **execută** (emitere, plată, scriere în BD) numai după ce datele de care depinde sunt verificate în sursa oficială sau aplicabilă (anunțul SEAP, un registru public, răspunsul AC la o întrebare de date). Dacă verificarea dă altă valoare, se aplică valoarea verificată, nu se renunță la decizie;
- **ipoteză prudentă** — bază de planificare internă, nu afirmație despre contract;
- **țintă internă** — un termen intern mai strict decât sursa; nu înlocuiește sursa în platformă;
- **scenariu** — o cifră „dacă…”, calculată la valoarea estimată; nu se adună cu alte scenarii fără sursă.

Aprobarea unui risc nu transformă o ipoteză în clauză verificată. R7 se închide după verificarea clauzelor și a propagării (secțiunea „Criteriile de închidere R7”), nu doar după semnarea fișei.

## Verdictul Copilot (25.09 seara) și ce schimbă
Verdictul (transmis în sesiune; rezumat fidel): fișa e suficientă ca structură pentru decizia ownerului, după ajustări; cele zece aprobări comerciale nu închid singure R7; nu se certifică oferta financiară finală cât timp cantitățile R5 sau condițiile care îi schimbă baza rămân neclarificate.

| Punct din verdict | Ce s-a schimbat în fișă | Unde |
|---|---|---|
| 1 — GBE pe E1 | Condiționată de confirmarea AC; nu devine rezervă unilaterală în ofertă. 3,74 / 0,83 mil. = sume garantate, nu cost și nici numerar blocat; brokerul/banca confirmă prima, colateralul, durata, prelungirea și restituirea | pct. 1 |
| 1 — termenul GBE | 5 zile calendaristice = țintă internă. Conflictul FD–contract și #64 pt 1b rămân în platformă; cl. 31 nu se suprascrie | pct. 1 |
| 2 — valabilitatea | 150 de zile = propunere de durată, nu minim. „4 luni” și legătura cu valabilitatea ofertei sunt susținute de pasajele din FD pag. 16. 123 de zile = diferența pentru data din BD, nu o constantă | pct. 2 |
| 2 — CUI / IBAN | Cifra de control semnalează o posibilă eroare, nu dovedește identitatea; „XXX” nu dovedește mascarea. Verificare din sursa oficială înainte de emitere sau plată. Textul propus pentru BD nu mai afirmă nimic ca fapt | pct. 2, SQL |
| 3 — penalități | Cifrele sunt scenarii la 30 de zile; rezerva nu plafonează răspunderea; cumulul (jalon / etapă / ansamblu) e de verificat, nu adunat | pct. 3, #64 pt 2e |
| 4–5 — ajustare, avans | Data de Referință ulterioară = scenariu de risc; formula completă; „fără avans” = ipoteză prudentă, nu clauză | pct. 4, 5 |
| 6 — lista de prețuri | Lista granulară de lucru acum; forma depusă după DA și răspunsuri; cantitățile R5 nevalidate nu devin bază aprobată; „preț ≤ valoare estimată” = obiectiv intern | pct. 6 |
| 7 — Etapa 2 | Rescris: E1 sustenabilă singură prin alocare justificată (4 categorii de costuri, test E1 singură); 22,21% = pondere valorică. Pt 5 din #64 nu se scoate: se reformulează cu întrebările despre GBE, durată și recepții | pct. 7, #64 pt 5 |
| 8 — durata | De când curg cele 12 luni și interacțiunea cu activarea E2 → întrebare explicită; graficul separă jaloanele contractuale de datele interne; cl. 43 se corectează cu sursă și istoric | pct. 8 |
| 9–10 | Garanția pe fiecare recepție aplicabilă, corelată cu eliberarea GBE; 36 de luni ≠ sfârșitul răspunderilor (vicii ascunse); documentele de după semnare pregătite fără termene inventate | pct. 9, 10 |
| Completări | Lichiditate pe 3 scenarii; planul de management al calității (15 p); condițiile fiecărei decizii | secțiunile A, B, C |
| Închiderea R7 | Cele 5 dovezi, cu starea fiecăreia din BD | „Criteriile de închidere R7” |

## Sumar

| # | Punct | Decizie propusă (tip) | Impact (valoare estimată; scenarii) | Parametru platformă: acum → propus |
|---|---|---|---|---|
| 1 | GBE | Poliță/SGB 10%, fără rețineri (acceptăm riscul). Bază: total (A); E1 + completare (C) numai după răspunsul la #64 pt 1a (aplicăm dacă AC confirmă). Termen: 5 zile calendaristice (țintă internă) | Sume garantate 3.736.662,59 (total) / 829.890,92 (E1); costul = prima + eventualul colateral, confirmate de broker/bancă | cl. 30/32 corecte literal; cl. 31 („5 zile”, 480) ≠ 479 („5 zile lucrătoare, prelungibil 15”) → notă de conflict, fără suprascriere; 35/35 neverificate |
| 2 | Garanția de participare | Poliță prin broker, 370.000 lei, **durată propusă 150 zile** (nu minim), emisă după confirmarea termenului în SEAP și a beneficiarului/contului din sursa oficială (aplicăm după verificarea sursei oficiale) | Primă proxy ≈ 1.536 (123 z) / ≈ 1.873 lei (150 z); la virament, 370.000 lei imobilizați | UI propune implicit **90 zile** ✗ (fix: calcul din „4 luni” + termen, nu 150 global); text BD „IBAN mascat” ✗ → text scurt fără afirmații nedovedite |
| 3 | Penalități | #64 pt 2b/2c + 2d/2e (propuse); rezervă de risc în preț, suma o fixează Razvan (acceptăm riscul); rezerva nu plafonează | Scenarii la 30 de zile, calculate pe câte o bază (E1 / E2 / total), fiecare separat: 248.967,27 (E1) / 872.031,50 (E2) / 1.120.998,78 (total); relația dintre ele (cumul sau alternativă) e nestabilită — #64 pt 2e | cl. 33/34 corecte; cl. 35: `termen_zile 60` = grație, nu periodicitate; `plafon_procent 100` = interpretare AI |
| 4 | Ajustarea prețului | Prețuri la data ofertei, ajustarea = protecție (ipoteză prudentă); DR ulterioară = scenariu de risc până la #64 pt 3 | +10% materiale ⇒ +5,5%: 456.440,00 (E1) / 2.055.164,42 (total) | cl. 40–42 corecte; fără câmp pentru Data de Referință / indici |
| 5 | Avans | Cash-flow fără avans (ipoteză prudentă); #64 pt 4 rămâne | Prefinanțare OS E1 134.446,35 + lucrările până la prima încasare (secțiunea A) | niciun parametru; formula e în cl. 40 |
| 6 | Lista de prețuri (F1) | Lista granulară de lucru, începută acum; forma depusă după DA și răspunsul la #63 pt 5; fără cantități R5 nevalidate ca bază (acceptăm riscul) | vezi secțiunea A (lichiditate) | `ofertare_cantitati` 95: 6 rânduri, `obiect` NULL, 0 validate |
| 7 | Etapa 2 | E1 sustenabilă singură prin alocare justificată (proprii E1 / proprii E2 / comune / remobilizare) + test „E1 singură”; #64 pt 5 reformulat, nu scos (acceptăm riscul) | E1 = 22,21% din valoare (pondere, nu regulă de alocare) | fără câmpuri E1/E2 (Formular 9, id 20, `de_pregatit`) |
| 8 | Termen | Grafic cu E1 realist + marjă; jaloane contractuale separate de datele interne; întrebare explicită despre curgerea celor 12 luni, #64 pt 5c (acceptăm riscul) | Scenariu: 8.298,91 lei/zi (E1) / 29.067,72 (E2), dacă baza e toată etapa; cumulul cu alte baze nestabilit (#64 pt 2e) | cl. 43: `evaluare_gazpet` „12 luni pentru Etapa 1” ✗ → corectat cu citat și istoric (preview → GO) |
| 9 | Garanția lucrărilor | 36 luni de la fiecare recepție la terminare aplicabilă, corelată cu eliberarea GBE (juridic); vicii ascunse separat (acceptăm riscul) | 36 luni de intervenții; răspundere 10 ani pentru vicii ascunse | `ofertare_pt_garantie` 95: 0 rânduri → cerut/oferit 36, `receptie_terminare` (cerința 6407) |
| 10 | Obligații „de ansamblu” | #64 pt 2a; documentele scadente după semnare pregătite dinainte, fără termene sau aprobări inventate (acceptăm riscul) | 37.366,63 lei/zi (total) vs 8.298,91 (E1), ×4,5 | nimic marcat în platformă |

## Mapare pe criteriul R7 (F1–F6)
Criteriul din `RESTANTE_AUDIT_OFERTARE.md` (rândul R7, linia 15): „Fiecare punct F1–F6 are decizie scrisă și, unde e cazul, parametru în aplicație”. Constatările F1–F6 = `MATRICE_ACOPERIRE_AUDIT_OFERTARE.md` liniile 26–31. Verdictul Copilot adaugă peste acest criteriu cele 5 dovezi de închidere (secțiunea dedicată).

| F (matrice) | Constatare | Punct în fișă | Decizia cerută lui Razvan | Recomandare |
|---|---|---|---|---|
| F1 (l. 26) | F3 / liste de cantități lipsă; cererea e în #63 pt 5 | pct. 6 | Listă de prețuri proprie, începută acum, **vs** așteptarea răspunsului la #63 pt 5 (≤08.10; rămân 11 zile) | Lista de lucru acum; forma depusă după răspuns |
| F2 (l. 27) | Clauze: citat VERIFICAT, interpretare NETESTAT | pct. 1, 3, 4, 5, 8, 9, 10 | Validarea interpretărilor + verificarea umană a celor 35 de clauze (35/35 `verificat_de` NULL), cu notele de mai jos | Verificare din UI; GO-ul pe decizii nu marchează automat clauzele |
| F3 (l. 28) | GBE: rol, termen 5 zile | pct. 1 (+ 7) | Forma și baza GBE; ținta internă de termen | Poliță/SGB; A implicit, C doar cu confirmarea AC; 5 zile calendaristice ca țintă |
| F4 (l. 29) | Plată / ajustare / Etapa 2 | pct. 4–8, secțiunea A | Ajustare, avans, alocarea costurilor pe etape, durata E1, lichiditatea | Ipoteze prudente; E1 sustenabilă singură; E1 cu marjă |
| F5 (l. 30) | Garanția de participare: aplicare + valabilitate | pct. 2 | Forma, durata propusă, textul din BD | Poliță, 150 zile propuse, după confirmările din SEAP și din sursa oficială |
| F6 (l. 31) | Formulare 481 (matricea spune „registru = 0” — depășit: 12 rânduri, id 11–22, toate `de_pregatit`) | acest rând + tabelul celor 5 piese FD | (a) configurația participării; (b) cele 5 piese FD fără formular; (c) Formularul 3 | vezi mai jos |

F6, în detaliu:
- **(a) Aplicabilitate.** Formularele nr. 4/41 (terț susținător), nr. 5 (asociere) și nr. 6 (subcontractare) sunt `aplicabil=false` ⇒ ofertant individual, fără terți sau subcontractanți. Configurația se **confirmă separat** de Razvan (criteriul de închidere 1). Formularul nr. 2 (Împuternicire) e `true`: FD îl cere pentru un ofertant individual doar dacă semnatarul ≠ persoana împuternicită în DUAE (479 pag. 16, poz. 73 485), iar pentru asociere, de la fiecare membru (lista FD, pct. 5).
- **(b)** Cele 5 piese din FD fără formular 481 nu sunt în registru; tabelul „Cele 5 piese din FD” (criteriul 4) le leagă de obligație, responsabil și artefact.
- **(c) Formularul nr. 3** (registru id 13) are în titlu „art. 60”, preluat din lista din 481 (poz. 1 092). FD cere „Declarația privind neîncadrarea în situațiile prevăzute la **art. 59-60** din Legea nr. 98/2016” (479 pag. 16, lista pct. 3, poz. 71 859; „59-60” la poz. 71 926). Neconcordanța se rezolvă **din sursă**: se completează cu „art. 59-60”, cum cere FD, iar titlul din registru se corectează prin preview → confirmare → apply. **Reconcilierea cu CS** nu adaugă formulare: în CS au text doar 1276 (p01) și 1277 (p02); „formular” apare o singură dată, în 1276 poz. 85 266 (pag. 25, „Lista de prețuri anexă a formularului de ofertă”, tratată la pct. 6), și de 0 ori în 1277; 494 nu are text.

---

### 1. GBE
- **Citate.** 479 pag. 12, III.1.6.b (poz. 50 790): „Cuantumul garanției de buna execuție este de 10% din valoarea contractului fara TVA.” Termen: 479 pag. 17, VI.3 (poz. 77 377) „în termen de maxim 5 zile lucratoare de la data semnarii contractului public, termen ce poate fi prelungit pana la 15 zile” vs 480 (poz. 54 966) „cel mai tarziu in termen de 5 zile de la data semnarii contractului”.
- Forme: SGB de la IFN admisă sub 40 mil. lei (479 pag. 17, poz. 78 190); rețineri succesive cu depunere inițială „nu poate fi mai mică de 0,5% din prețul contractului” (480 poz. 54 296). Ordinul de începere E1 „numai dupa constituirea” GBE (480 poz. 14 200); eliberarea după „art. 42 alin. (3) si (4) din HG nr. 395/2016” (480 poz. 57 577; conținutul articolului nu e în corpus).
- **Interpretare.** Baza = Prețul total E1+E2 (480 poz. 10 569). Contractul nu prevede reducerea GBE dacă E2 nu se activează (tăcere; 480 poz. 15 023 nu o menționează). Procentul reținut din fiecare factură nu e definit.
- **Sumele.** 10% × valoarea estimată = **3.736.662,59 lei (total) / 829.890,92 lei (E1)**. Sunt **sume garantate** (cât poate executa AC din instrument), la valoarea estimată, nu la prețul ofertat. **Nu sunt costul poliței și nici numerar blocat automat.** Costul real = prima (plus comisioane) și eventualul colateral cerut de emitent; le confirmă brokerul/banca, împreună cu durata și condițiile de prelungire și restituire. Doar ca ordin de mărime: la fiecare 1%/an din suma garantată, 37.366,63 lei/an (total) vs 8.298,91 (E1) — ipoteză de calcul, nu ofertă (`gbe_polite` nu are câmp de primă). Rețineri: inițial 186.833,13 (total) / 41.494,55 (E1); aici numerarul e real reținut.
- **Opțiuni.** A) poliță/SGB 10% pe total la semnare; B) rețineri succesive; C) poliță pe E1 + completare la activarea E2.
- **Recomandare.**
  - Forma: **poliță/SGB, fără rețineri** — acceptăm riscul. Nu B: cu baza pe total și E2 neactivată, suma de reținut (3,74 mil.) ar fi 45,03% din valoarea E1 (scenariu).
  - Baza: **A implicit**. **C se aplică numai dacă AC confirmă** (răspuns scris la #64 pt 1a sau act aplicabil); nu o introducem în ofertă ca rezervă sau condiție.
  - Termenul: **țintă internă 5 zile calendaristice**, cu draftul instrumentului gata înainte de semnare. Nu e un verdict că documentația cere zile calendaristice.
- **Platformă.** Cl. 30 (`procent 10`) și 32 (0,5%) corecte literal. Cl. 31 (`termen_zile 5`) = 480, ≠ 479: la verificare se notează conflictul FD–contract și trimiterea la #64 pt 1b; valoarea sursei **nu** se înlocuiește cu ținta internă. `contract_id` NULL (evidența GBE începe după atribuire).

### 2. Garanția de participare
- **Citate.** 479 pag. 11, III.1.6.a (poz. 50 294): „în cuantum de 370 000 lei […] contul RO71TREZ2015006XXX000189, deschis la Trezoreria Călărași, beneficiar UAT Vâlcelele, CUI 379683.” 479 pag. 1, I.1 (poz. 260): „Cod de identificare fiscala: 3796837”; 480 preambul (poz. 740–800): „cod fiscal 3796837, cont trezorerie RO71TREZ2015006XXX000189” (singura apariție a IBAN-ului în 480, poz. 776).
- **Valabilitatea, pe pasajele aplicabile (479 pag. 16).**
  - Poz. 74 318: „Oferta trebuie să fie valabilă pentru o perioadă de 4 luni de la termenul-limită de primire a Ofertelor.”
  - Poz. 75 524: „Perioada de valabilitate a garanției de participare va fi cel puțin egală cu perioada de valabilitate a ofertei, respectiv 4 luni de la data limita de depunere a ofertei stabilită prin anunțul de participare publicat în SEAP.”
  - Poz. 74 577: AC poate solicita „să prelungească perioada de valabilitate a Ofertei, precum și, după caz, a garanției de participare”; refuzul duce la respingerea ofertei ca inacceptabilă (poz. 74 801).
  - Dovada instrumentului se încarcă în SEAP până la data și ora-limită (479 pag. 17, poz. 76 192).
- **Cifrele.** 4 luni de la 19.10.2026 = 19.02.2027 = **123 de zile — doar pentru data din BD**. Nu e o constantă: 4 luni calendaristice au între 120 și 123 de zile, după lunile acoperite. **150 de zile = propunerea noastră** de durată cerută brokerului (marjă), nu un nou minim. Cu 150 de zile, polița acoperă o decalare a termenului de până la ~30 de zile calendaristice (4 luni de la 18.11.2026 = 18.03.2027 = ziua 150).
- **CUI și IBAN.** CUI 3796837 are cifra de control validă, 379683 nu (algoritmul CIF, cheia 753217532). Asta **semnalează o posibilă eroare de tipar** în III.1.6.a, dar **nu dovedește singură identitatea beneficiarului**. IBAN-ul trece mod-97 așa cum e scris și e identic în FD și în contract, însă mod-97 nu e dovadă (11 din 1000 de variante numerice trec și ele), iar **„XXX” nu dovedește nici că IBAN-ul e mascat, nici că e complet**. Beneficiarul și contul se verifică **din sursa oficială/aplicabilă, înainte de emitere (poliță) sau plată (virament)**: CUI — răspunsul AC la #63 pt 6 și registrul public al contribuabililor; contul — confirmarea AC (#63 pt 6 întreabă azi doar CUI-ul; extinderea la cont e opțională și cere re-aprobarea textului #63).
- **Opțiuni.** A) virament; B) poliță prin broker pe exact 4 luni de la termenul confirmat; C) B cu marjă (130–150 de zile).
- **Recomandare.** C, cu **150 de zile ca durată propusă**, cerută după confirmarea termenului din anunțul SEAP și a beneficiarului. **La orice modificare a termenului de depunere sau la o cerere de prelungire a AC se reverifică data de expirare: dacă 4 luni de la noul termen depășesc valabilitatea poliței, polița se reemite sau se prelungește.** În platformă, „Trimite actualizarea perioadei” păstrează numărul de zile și mută intervalul (`OfertareGarantie.jsx:173`), deci cu 150 de zile rămâne ≥ 4 luni; avertizarea de decalare (linia 212) nu mai apare după starea `original` (linia 168), iar după ea verificarea e manuală.
- **Impact.** 370.000 lei = 0,99% din valoare (479 pag. 2). La virament, suma e imobilizată cel puțin 4 luni și, dacă câștigăm, până la dovada GBE (480 poz. 55 143). Poliță, proxy `ofertare_garantii` id 1 (1.185,20 / 292.641,99 = 0,405% pentru 120 de zile): ≈ 1.498,50 lei la rată fixă, ≈ 1.536 lei pro-rata la 123 de zile, ≈ 1.873 lei la 150 de zile.
- **Platformă.** `garantie_participare` spune „IBAN-ul e mascat” ✗ → text scurt fără afirmații nedovedite, detaliile la finalul lui `observatii` (SQL mai jos); `ofertare_garantii` pt 95: 0 rânduri. UI pune implicit **90 zile** (`OfertareGarantie.jsx:56`: cerințele nu conțin „NNN zile”) ⇒ 17.01.2027, sub 19.02.2027. Corectura cerută de Copilot: codul să calculeze valabilitatea din „4 luni” + termen, **nu** înlocuirea globală a lui 90 cu 150 (tichet de cod separat).

### 3. Penalități (executant + autoritate)
- **Citate.** 480, „Sanctiuni pentru neindeplinirea culpabila a obligatiilor” (poz. ~51 450–52 700), trei fraze distincte:
  - neîndeplinire / îndeplinire defectuoasă: „penalitati in cuantum de 0,1% pe zi, calculate prin raportare la valoarea fara TVA a etapei sau a partii de Contract afectate de neindeplinirea obligatiei. Pentru obligatiile care privesc Contractul in ansamblu, penalitatile se calculeaza prin raportare la Pretul total al Contractului”;
  - întârziere: „0,1% pentru fiecare zi de intarziere, calculate din valoarea fara TVA a etapei sau a partii de lucrari afectate de intarziere”;
  - AC: „in termen de 60 de zile de la expirarea perioadei convenite […] 0,1% din plata neefectuata, pana la indeplinirea efectiva a obligatiilor. Cuantumul penalitatilor nu poate depasi valoarea debitului restant.”
- **Interpretare.** Pentru executant: 0,1%/zi, fără plafon scris în 479/480; singurul „nu poate depasi” e la AC (480 poz. 52 286). Pentru AC: penalitatea curge abia după termenul de plată + 60 de zile, periodicitatea nu e scrisă, iar suma e plafonată la debit.
- **Cumulul.** Contractul nu spune dacă, pentru aceeași întârziere, se pot aplica împreună penalitatea pe o fază din grafic, pe etapă și pe obligațiile „de ansamblu” („plafon” apare de 0 ori în 480; „cumul” apare doar în „acumularea de obstacole”, poz. 38 663). **Nu le adunăm și nu le tratăm ca alternative fără sursă**: întrebare propusă în #64 (pt 2e) și verificare juridică.
- **Scenarii (la valoarea estimată, ipoteza a 30 de zile de întârziere, câte o bază pe rând):** E1 248.967,27 lei; E2 872.031,50; total 1.120.998,78. Pe zi: 8.298,91 / 29.067,72 / 37.366,63. Sunt scenarii calculate pe câte o bază (E1 / E2 / total), fiecare separat; relația dintre ele (cumul sau alternativă) e nestabilită — #64 pt 2e.
- **Opțiuni.** A) acceptăm ca atare + buffer în grafic; B) #64 pt 2 + rezervă de risc în preț; C) no-go dacă nu există plafon.
- **Recomandare.** B — acceptăm riscul, cu întrebările trimise. Mărimea rezervei (lei) o decide Razvan. **Rezerva din preț acoperă o parte din expunere, dar nu plafonează răspunderea**: contractul nu are plafon pentru executant. No-go (C) se reevaluează doar dacă graficul pe 12 luni nu e realist (pct. 8).
- **Platformă.** Cl. 33/34 (`0.1`, `termen_zile 1`) corecte. La cl. 35, `termen_zile 60` e perioada de grație, nu periodicitatea, iar `plafon_procent 100` e o interpretare AI: se notează la verificare.

### 4. Ajustarea prețului
- **Formula completă** (479 pag. 4–5, II.3, poz. 13 248–15 000): „An = av + m * Mn/Mo + f * Fn/Fo + e * En/Eo”, unde:
  - „An” se aplică „valorii contractuale aferente lucrărilor realizate în luna „n"”;
  - „av” = plata în avans, „pentru prezentul contract av = 0”; m = 0,55 (materiale), f = 0,25 (manoperă), e = 0,20 (energie — carburanții pentru utilaje); se verifică „av + m + f + e = 1” (poz. 14 772);
  - Mn, Fn, En = indicii curenți „aplicabili la data cu 60 de zile înainte de ultima zi a lunii „n"”; Mo, Fo, Eo = indicii de bază „aplicabili la Data de Referință”; sursa: „Buletinele statistice lunare și de prețuri ale Institutului Național de Statistică”;
  - un indice indisponibil sau nedefinitiv se înlocuiește cu ultimul disponibil, iar ajustarea se recalculează când indicele devine definitiv (poz. 14 951);
  - 480 art. 5.2: ajustarea se aplică „exclusiv pentru lucrările efectiv executate și acceptate la plată”; art. 5.3 lasă indicii, „inclusiv sursa acestora”, pe seama documentației și anexelor (poz. 12 415).
- **Nedefinite în corpus:** Data de Referință și seriile INS concrete pentru M, F, E.
- **Ce întreabă #64.** Pt 3 (data de referință + indicii INS).
- **Riscul Datei de Referință — scenariu de risc până la definire.** Dacă DR e **ulterioară ofertei** (semnarea sau un ordin de începere), creșterile dintre depunere (19.10.2026) și DR rămân necompensate; pentru E2, care poate porni la până la 10 luni de la semnare, intervalul poate fi lung. Nu tratăm DR nici ca ulterioară, nici ca egală cu data ofertei până la răspuns.
- **Sensibilitate (scenariu).** Materiale +10%, restul constant ⇒ An = 1,055 ⇒ +5,5% pe lucrările facturate: 456.440,00 lei (E1) / 2.055.164,42 lei (total).
- **„Preț ≤ valoarea estimată” = obiectiv comercial intern.** Creșterile dintre estimarea AC și depunere le prețuim oricum; ținta internă e să rămânem ≤ 37.366.625,89 lei. Efectul juridic al unei depășiri nu e scris în corpus („inacceptabil” apare în 479 o singură dată, la refuzul prelungirii valabilității, poz. 74 801) ⇒ de confirmat juridic; **nu se codifică în platformă ca regulă universală**.
- **Recomandare.** Prețuri la data ofertei, ajustarea tratată ca protecție, nu ca marjă (ipoteză prudentă). Rezerva pentru intervalul depunere → DR intră în preț dacă AC răspunde cu o DR ulterioară; dacă nu răspunde până la 08.10, Razvan decide rezerva pe scenariul de risc.
- **Platformă.** Cl. 40–42 corecte. Nu există câmp pentru DR sau indici; se trec ca notă la verificare.

### 5. Avans
- **Citate.** 479 pag. 4 (poz. 13 658): „av” = „valoarea procentuală a plății în avans față de Prețul Contractului; pentru prezentul contract av = 0”. 480 (poz. 11 527): „,,av''= 0”. Alte apariții ale „avans” nu privesc plata (480 poz. 64 861 = „lucrarile avanseaza”).
- **Interpretare.** av = 0 e un coeficient al formulei de ajustare. Nu există nici clauză care acordă avans, nici clauză explicită care îl exclude. Deci **„contractul nu permite avans” nu e dovedit**; **cash-flow-ul fără avans e o ipoteză prudentă**, acceptabilă.
- **Ce întreabă #64.** Pt 4 (confirmarea că nu se acordă avans) — rămâne.
- **Impact.** Prefinanțăm OS E1, 134.446,35 lei (479 pag. 2: 100.000,00 + 34.446,35), plus lucrările până la prima încasare (secțiunea A).
- **Recomandare.** Modelăm cash-flow cu avans 0 indiferent de răspuns; nu scriem nicăieri că avansul e interzis.
- **Platformă.** Niciun parametru de avans (formula e în cl. 40).

### 6. Plăți / decontare și lista de prețuri (acoperă F1)
- **Citate.** 480, „Modalitati de plata” (poz. 75 240): plățile parțiale se fac „la valoarea lucrarilor efectiv executate,măsurate, verificate si acceptate”, iar situațiile de lucrări evidențiază distinct E1 și E2. „(2) Situatiile de plata partiale se confirma/infirma in termen de maxim 15 zile de la primire. In cazul in care achizitorul emite observatii […] vor fi inapoiate Executantului in vederea refacerii. (3) dupa confirmarea situatiilor de plata, executantul emite factura fiscala […] (4) Platile se efectueaza in termen de 30 de zile de la primirea facturii” (poz. 76 073, 76 428). Plata facturii finale vine după aprobarea PV de recepție la terminare.
  - CS 1276 pag. 25 (poz. 85 136): decontarea „în funcție de stadiul fizic realizat pentru categoria de lucrări inclusă în Lista de prețuri anexă a formularului de ofertă […] încadrarea în sume forfetare.”
  - FD 479 pag. 16 (poz. 73 056): Propunerea financiară „cu evidențierea distinctă a prețului aferent Etapei 1, a prețului aferent Etapei 2 și a prețului total ofertat”.
- **Interpretare.** Decontarea e pe categoriile din Lista de prețuri pe care o facem noi: cât de detaliată e lista decide cât de des putem factura. **15 zile și 30 de zile au declanșatori diferiți** (primirea situației, respectiv primirea facturii emise după confirmare); nu formează un termen unic garantat de 45 de zile, iar o infirmare reia ciclul (secțiunea A). Nu există model de listă în 481 și nici liste de cantități în corpus.
- **Ce întreabă #63.** Pt 5a (listele de cantități) și 5b (structura Listei de prețuri).
- **Opțiuni.** A) listă proprie granulară, începută acum: etapă × categorie × stradă/tronson/Dn, cu organizarea de șantier și livrările (utilaje, dotări, active necorporale) separat; B) listă pe capitolele devizului din FD; C) așteptăm modelul AC (răspuns ≤08.10, deci ≤11 zile până la depunere).
- **Recomandare.** A, ca **listă de lucru**. Forma depusă respectă DA și răspunsurile aplicabile (#63 pt 5). **Cantitățile nevalidate din R5 nu devin bază aprobată doar pentru că apar în listă sau în centralizator**: baza aprobată = rânduri `validat` în 📋 Cantități (R5, criteriul 5; azi 0 din 6). „Preț ≤ valoarea estimată” rămâne obiectiv intern (pct. 4).
- **Platformă.** Cl. 36–38 corecte literal; evaluarea AI de la cl. 36/37 („cumulat … 45+ zile”) se corectează la verificare (declanșatori distincți). `ofertare_cantitati` 95: 6 rânduri, `obiect` NULL; propunere fără schimbare de schemă: convenția `obiect` = „Etapa 1” / „Etapa 2”.

### 7. Etapa 2 (condiționalitate, valoare, alocarea costurilor)
- **Citate.** 479 pag. 4, II.2.14 (poz. 11 173–11 298): „Autoritatea Contractantă estimează că sursa de finanțare necesară Etapei 2 va fi asigurată într-un termen de maximum 10 luni de la data semnării contractului de achiziție publică. […] lucrările aferente Etapei 2 nu vor fi activate și nu vor fi executate.”
  - 480 (poz. 15 023): la neîndeplinirea condiției în 10 luni de la semnare, „Contractul va continua să producă efecte pentru obligațiile aferente Etapei 1 și pentru celelalte obligații născute anterior notificării, fără ca neexecutarea Etapei 2 să constituie o neexecutare culpabilă a Contractului.”
  - 480 art. 4 (poz. 10 019): nu conferă dreptul la plata lucrărilor E2 neexecutate, „despăgubiri, daune-interese, profit nerealizat”. 480 „Modalitati de plata”: nu se plătesc lucrări E2 executate înainte de condiție și de „Ordinul distinct de incepere”.
  - 479 pag. 2 (poz. 5 331): prețul total ofertat cuprinde „inclusiv lucrările aferente Etapei 2”; evaluarea se face „prin raportare la prețul total” (1276 pag. 2).
- **Valoarea și structura (479 pag. 2, II.2.4).** E1 = 8.298.909,16: rețea 8.164.462,81 + OS C+I 100.000,00 + cheltuieli conexe OS 34.446,35. E2 = 29.067.716,73 (suma celor 12 capitole; „29.067.716,7” e aceeași valoare cu o zecimală): rețea 26.103.637,03, **instalația de racordare la SNT 78.252,90**, **utilaje care necesită montaj 1.126.268,00**, dotări 145.112,01, active necorporale 1.452.120,11, **OS E2 24.446,35**, restul 137.880,33 (amenajări, utilități, pregătire personal, probe). **E1 + E2 = 37.366.625,89 exact.** Valoarea estimată nu include diverse și neprevăzute.
- **Ce nu stabilesc documentele.** Contractul nu prevede reducerea GBE la neactivarea E2 (tăcere). Nu spune nici cum se recepționează E1 dacă E2 nu pornește, deși racordarea la SNT și utilajele sunt în E2 (recepțiile distincte cer părți „distincte din punct de vedere fizic si functional”, 480 poz. 56 296). Nu precizează nici cum interacționează cele 10 luni (de la semnare) cu cele 12 luni de execuție (de la OI E1).
- **Alocarea costurilor (recomandarea Copilot, înlocuiește „toate costurile fixe integral în E1”).** Obiectiv: **E1 să fie economic sustenabilă și dacă E2 nu se activează**, printr-o alocare justificabilă. Costurile se separă în patru categorii, fiecare alocată o singură dată:
  1. **proprii E1** — lucrările rețelei E1 și OS E1 (capitolele E1 din FD);
  2. **proprii E2** — lucrările E2, racordarea SNT, livrările, OS E2 (capitolele E2); **nu se mută automat în E1**;
  3. **comune angajate de la început** — mobilizarea echipei de conducere, costul GBE până la notificare, asigurarea (cl. 57), documentația PT, partea fixă a organizării; acestea se recuperează din E1 în măsura în care sunt angajate înainte de a se ști soarta E2;
  4. **remobilizarea** — apare doar dacă E2 pornește după o pauză; se alocă E2 (sau devine o rezervă identificată), nu E1.
- **Testul „E1 singură”.** Venit E1 − (proprii E1 + comune angajate până la notificare) ≥ marja minimă stabilită de Razvan, fără cheltuieli exclusiv E2 și fără dublare. Testul se face pe prețuri, nu pe procente.
- **22,21%** = 8.298.909,16 / 37.366.625,89 = ponderea valorică estimată a E1. Descrie structura valorii; **nu e o regulă de repartizare**.
- **Verificare.** Alocarea trebuie să se regăsească în structura de preț cerută (preț E1 / preț E2 / total, Formular 9 și PF) și în mecanismul de plată (decontare pe categoriile din listă). O alocare foarte asimetrică se verifică și față de o eventuală cerere de justificare a prețului (temei de confirmat juridic).
- **#64.** Pt 5 **nu se scoate**. Valoarea E2 e lămurită din FD, dar punctul se reformulează ca „Etapa 2 — valoarea și efectele neactivării”, cu întrebările despre GBE, durată și recepții (textul propus e mai jos). Pt 1d din revizia anterioară se mută aici (5b).
- **Recomandare.** GO rămâne (`decizie_go = 'go'`), cu alocarea în 4 categorii și testul E1 singură făcut de Financiar înainte de fixarea prețurilor.
- **Platformă.** `valoare_estimata` = 37.366.625,89, corect. Fără câmpuri E1/E2. Formularul nr. 9 (id 20, `de_pregatit`) cere E1, E2, total, „constructii+instalatii” și „organizare de santier” (481 poz. ~26 510).

### 8. Termen de execuție
- **Citate.** 479 pag. 3, II.2.7 (poz. 5 871): „Durata in luni: 12”. 1276 pag. 2 (poz. 1 618): „Etapa 1 și Etapa 2, se executa în 12 luni”; la fel pag. 13.
  - 480 „Durata” (poz. 13 565): „12 luni termen de executie […] Termenul se calculeaza incepand cu data mentionata in Ordinul de incepere aferent Etapei 1. Perioada in care executarea lucrarilor aferente Etapei 2 nu poate incepe exclusiv ca urmare a neindeplinirii conditiei suspensive nu se include in termenul de executie.” Tot acolo (poz. 14 366): „Ordinul de incepere aferent Etapei 2 va fi emis distinct”.
  - 480 (poz. 65 760): graficul fizic evidențiază distinct E1 și E2 și succesiunea lor. 480 (poz. 70 748–70 900): orice fază „prevazuta a fi terminata intr-o perioada stabilita in graficul fizic” se finalizează în termenul convenit.
  - 479 pag. 16 (poz. 73 220): Formularul de Ofertă cuprinde termenul „identic” cu PF, PT și graficul.
- **Ce e stabilit.** 12 luni nete pentru E1+E2, de la data din OI E1; OI E2 distinct; perioada de așteptare exclusiv din cauza condiției nu intră în termen. Fazele declarate în grafic devin termene penalizabile (pct. 3).
- **Ce nu e stabilit — de întrebat explicit (#64 pt 5c).** De la ce moment curge perioada exclusă (data planificată în grafic pentru începutul E2 sau finalizarea E1); cum se leagă activarea E2 până la luna 10 de la semnare de cele 12 luni de la OI E1; ce termen se aplică E1 dacă E2 nu se activează. Plus baza de calcul a penalității pe un jalon intermediar al E1 (#64 pt 2d).
- **Graficul.** Distinge **jaloanele contractuale** (termenul total, fazele pe care le declarăm în graficul fizic, OI E1/E2) de **datele interne de planificare** (buffere, aprovizionare, echipe). Datele interne nu se declară ca faze în graficul depus. În platformă: `grafic_activitati.jalon = true` doar pentru jaloanele contractuale; datele interne rămân în note (convenție, fără schemă nouă; lic. 95 are 0 activități azi).
- **Impact.** O zi de întârziere pe un jalon E1 costă 8.298,91 lei dacă baza e toată E1 (scenariu; un eventual cumul cu alte baze nu e stabilit — #64 pt 2e); pe E2, 29.067,72 lei (idem). Un E1 scurt mărește expunerea pe E1; un E1 lung comprimă E2 și ridică necesarul de numerar (secțiunea A). Vremea previzibilă nu prelungește termenul (cl. 55). E2 are 32,830 km din 44,355 km (74,0% din lungime; 1276 pag. 6; cantitățile nu sunt validate, R5).
- **Opțiuni.** A) E1 realist + marjă (durata E1 = jalon contractual; marja se scade din E2); B) A + întrebările 2d și 5c; C) grafic proporțional cu valoarea (E1 ≈ 2,7 luni) — respins, expunere maximă.
- **Recomandare.** B (termen 01.10). Durata E1 și marja le propune echipa tehnică (Oana Nica) înainte de trimitere.
- **Platformă.** Cl. 43 (`luni 12`) e corectă ca valoare, dar `evaluare_gazpet` spune „Termen de execuție de 12 luni pentru Etapa 1” ✗. Corectura se face cu citatul din 480 „Durata” și cu păstrarea textului vechi în notă (proveniență și istoric), prin preview → GO → apply. R7 §1 („E1 pe 12 luni ≈ 691.576 lei/lună”) pleacă de la aceeași ipoteză greșită.

### 9. Garanția lucrărilor
- **Citate.** 479 pag. 14, pct. 10 (poz. 63 017): „nu poate fi mai mică de 36 luni de la data semnării procesului-verbal de recepție la terminarea lucrărilor, fără obiecțiuni.” 480 (poz. 56 296): dacă se fac recepții distincte „pentru parti de lucrari aferente Etapei 1 si/sau Etapei 2, care sunt distincte din punct de vedere fizic si functional si pot fi receptionate potrivit legii, perioada de garantie pentru partea receptionata curge de la data aprobarii procesului-verbal de receptie la terminarea lucrarilor aferent acesteia”. 480 „Durata” (poz. 13 955): 36 de luni „de la data semnarii procesului verbal de receptie la terminarea lucrarilor pana la data semnarii procesului verbal de receptie finala”.
- **Interpretare.**
  - Garanția începe **separat pentru fiecare recepție aplicabilă**, dar numai dacă partea e distinctă fizic și funcțional. Dacă E1 poate fi recepționată singură când E2 nu se activează nu e stabilit (racordarea SNT și utilajele sunt în E2) ⇒ #64 pt 5d.
  - Momentul de start diferă între surse: „semnării” (479, 480 „Durata”) vs „aprobării” PV (480 poz. 56 296) ⇒ notă la verificarea cl. 47.
  - **Corelarea cu eliberarea GBE:** 480 trimite la HG 395/2016 art. 42 alin. (3) și (4) (poz. 57 577), al cărui conținut nu e în corpus. Dacă eliberarea se face pe fiecare recepție sau doar la final e **de confirmat juridic**.
  - **36 de luni nu înseamnă sfârșitul tuturor răspunderilor.** Viciile ascunse rămân în sarcina executantului 10 ani de la recepție, iar pentru structura de rezistență pe toată durata de existență a construcției (480 poz. 39 182, cl. 48). Pe durata garanției, AC ține un registru al defectelor (480 poz. 56 708).
  - Garanția nu se punctează (criteriul: preț 85 + planul de calitate 15, 479 pag. 2–3).
- **Opțiuni.** A) 36 de luni; B) peste 36 (nu aduce puncte).
- **Recomandare.** A: 36 de luni de la fiecare recepție la terminare aplicabilă; costul intervențiilor pe 36 de luni și riscul viciilor ascunse intră separat în preț.
- **Platformă.** `ofertare_pt_garantie` pt 95: 0 rânduri. De completat din UI (pune ștampila): cerut 36 / `receptie_terminare` (cerința 6407), oferit 36 / `receptie_terminare`. Cl. 47 corectă literal; cl. 48 (vicii) și 50 (recepția finală) se citesc împreună la verificare.

### 10. Obligații „de ansamblu” și documentele de după semnare
- **Citat.** 480, „Sanctiuni…” (poz. 51 815): „Pentru obligatiile care privesc Contractul in ansamblu, penalitatile se calculeaza prin raportare la Pretul total al Contractului, fara TVA.” E singura apariție cu sens contractual în 480.
- **Interpretare.** Obligațiile nu sunt definite. Candidați probabili (interpretare, nu text din documente): constituirea GBE, planul de organizare de șantier, asigurarea, graficul și raportările. Riscuri conexe: daune de 50% din valoarea contractului la reziliere pentru conflict de interese (cl. 58, poz. 101 820) și rezilierea de drept după 10 zile lucrătoare (cl. 59).
- **Ce întreabă #64.** Pt 2a.
- **Impact (scenariu).** O zi de întârziere calculată pe total = 37.366,63 lei, față de 8.298,91 pe E1 (×4,5). Daunele de 50% din total ar fi 18.683.312,95 lei.
- **Documentele scadente după semnare, cu termenele din surse (nimic inventat):** GBE — 5 zile (480) / 5 zile lucrătoare prelungibile la 15 (479); planul de organizare de șantier — 5 zile de la semnare (480 „Durata”, cl. 46); asigurarea — „inainte de inceperea lucrarilor” (cl. 57); contractele cu subcontractanții — la încheierea contractului (cl. 52; nu se aplică dacă se confirmă configurația fără subcontractanți). Ce nu e scris (de ex. termenul în care AC avizează planul de OS) nu se presupune.
- **Recomandare.** Așteptăm răspunsul la pt 2a; între timp pregătim drafturile GBE și ale planului de OS înainte de semnare.
- **Platformă.** Nicio clauză nu marchează obligațiile „de ansamblu”. Cl. 33, 58 și 59 corecte literal.

---

## A. Lichiditate pe scenarii (completarea 1)
Scopul: necesarul maxim de numerar, nu profitul. Calculul e un **model cu ipoteze marcate**, rulat local (script în scratchpad, fără BD), pe valorile estimate fără TVA (efectul TVA nemodelat).

**Declanșatorii plății (480 „Modalitati de plata”, poz. 76 073 și 76 428):** confirmarea/infirmarea situației în ≤15 zile **de la primirea situației**; factura se emite **după confirmare**; plata în ≤30 de zile **de la primirea facturii**; o infirmare returnează situația „in vederea refacerii” și reia ciclul; factura finală se plătește după aprobarea PV de recepție la terminare. Nu există un termen unic garantat de 45 de zile. AC datorează penalități abia după 60 de zile de la termen (cl. 35), iar dreptul de sistare apare tot după 60 de zile (cl. 38).

**Ipoteze (marcate):**
- decalajul încasării de la sfârșitul lunii de lucru: **nominal 52 de zile** = 5 (întocmirea situației, ipoteză) + 15 + 2 (emiterea facturii, ipoteză) + 30 — limită superioară dacă AC respectă termenele; **stres 1**: +20 (o infirmare); **stres 2**: +60 (AC întârzie până la pragul penalității);
- structura costului: ponderile AC din formula de ajustare, m/f/e = 0,55 / 0,25 / 0,20 (479 pag. 4) — folosite doar ca proxy; cost = 100% din valoare (fără marjă, limită superioară);
- plata furnizorilor de materiale la **Tf = 30 de zile** (BD: dintre contractele `contracte_terti` cu `sens='plata'`, 12 au termen — 5/20/30×5/60×4/90, mediana 30; `logistica_furnizori` are termen pe 1 din 35, 30 de zile), plajă 0–60; manopera la sfârșitul lunii + 10 zile; energia la +15 zile (ipoteze);
- durata E1 = d1 luni (4 sau 6; o propune Oana Nica), E2 = 12 − d1 luni nete, lucrări uniforme pe etapă.

**Necesarul maxim de numerar pentru lucrări (mil. lei, Tf = 30):**

| Scenariu | d1 = 4: nominal / o infirmare / AC +60 | d1 = 6: nominal / o infirmare / AC +60 |
|---|---|---|
| E1 singură (E2 neactivată) | 3,94 / 5,50 / 7,99 | 2,63 / 3,67 / 5,39 |
| E2 întârziată (activată în luna 10 de la semnare, după o pauză) | 6,90 / 9,63 / 14,17 | 9,20 / 12,84 / 18,89 |
| Ambele etape, fără pauză | 6,90 / 9,63 / 14,17 | 9,20 / 12,84 / 18,89 |

Plaja pe Tf (0 / 30 / 60 de zile), nominal: E1 singură d1 = 4: 5,08 / 3,94 / 2,80; E2 d1 = 4: 8,90 / 6,90 / 4,91.

Citire:
- Vârful îl dă ritmul lunar al E2 (29.067.716,73 / (12 − d1)): un E1 mai lung comprimă E2 și ridică vârful. În „E2 întârziată”, vârful e același cu „ambele”, dar apar în plus costurile pauzei (echipă, utilaje, OS) și remobilizarea — **nemodelate, de estimat** de Oana Nica și Financiar —, iar lucrarea se termină în luna 16–18 de la semnare.
- Neincluse în tabel (se adaugă): **colateralul garanțiilor**, pe care îl confirmă brokerul/banca — GBE pe total 3.736.662,59 × c vs pe E1 829.890,92 × c (c = 25% ⇒ 934.165,65 / 207.472,73; c = 100% ⇒ sumele întregi); garanția de participare: 370.000 lei la virament, sau prima (~1.873 lei) plus eventualul colateral la poliță; rețineri succesive (dacă s-ar alege B): 186.833,13 / 41.494,55 inițial plus reținerile din facturi.
- Coada: ultima situație se plătește după recepția la terminare (termen nedefinit în corpus) — risc de lichiditate la final, nemodelat.
- Decizie cerută: linia de finanțare / plafonul de numerar acceptat pentru scenariul „stres 2” (rândul 6 din lista finală).

## B. Planul de management al calității — documentul care aduce punctaj (completarea 2)
- **Criteriul (verificat pe BD).** `ofertare_licitatii.criteriu` = „prețul ofertei 85 p; factor tehnic — planul de management al calității lucrărilor de execuție 15 p”. Sursa: 479 pag. 2–3, II.2.5 — factorul la poz. 6 533, „Punctaj maxim factor: 15” la poz. 7 590.
- **Grila (479 pag. 3, poz. 7 616):** „acceptabil/satisfăcător/parțial relevant” = 5 p; „bine/adecvat” = 10 p; „foarte bine/excepțional” = 15 p. Descriptorii pentru 15 p (prescurtați în FD, redați aici pe larg): activitățile/etapele, responsabilii pentru execuție, gestiune și control al calității și resursele sunt „f. bine definite”, cu optimizarea resurselor; nivelul și modul de implicare a responsabililor în controlul calității sunt „realiste și f. clar definite”; modul de control și de gestionare a neconformităților e prezentat clar. Treapta „bine” cere și corelarea cu graficul, cu drumul critic și cu gestiunea datelor de intrare și a documentelor. Grila nu scrie o treaptă de 0 p.
- **Locatorul în PT.** Formularul nr. 10 (registru id 21), capitolul 3 „Planul de management al calității în cadrul Contractului (execuție)” (481 poz. 28 389 în cuprins, 32 659 conținutul). Cerințele de conținut vin din CS §6.1 „Planul calității” (1276 pag. 17, poz. 53 930 și următoarele: SR EN ISO 9001:2015, SR ISO 10005:2007, HG 766/1997 anexa 2) și din cerințele 6396 (plan de asigurare a calității) și 6397 (PCCVI), 479 pag. 13, ambele `de_analizat`.
- **Starea în platformă (SELECT 26.09).** Nicio cerință din cele 67 active nu reține factorul de punctaj; `ofertare_pt_capitole` pt 95 = 0; nimic confirmat.
- **Propunere (neaplicată).** (1) Un **responsabil** numit de Razvan. (2) Un capitol PT dedicat, legat de cerințele 6396/6397 și de factorul de punctaj. (3) Verificarea după grila de 15 p, punct cu punct, înainte de pachetul PT (poarta PT). (4) Corelarea cu graficul (pct. 8) și cu metodologia. PMC nu e doar în lista celor 5 livrabile: e piesa care decide 15 puncte.

## C. Condițiile fiecărei decizii (completarea 3)
„Acceptăm riscul” ≠ „aplicăm varianta dacă AC confirmă”. Pentru fiecare decizie, sursa, condiția, cine o aplică în platformă și unde se reverifică:

| # | Decizia (varianta propusă) | Tip | Sursa | Condiția AC / ipoteza | Cine aplică în platformă | Unde se reverifică |
|---|---|---|---|---|---|---|
| 1a | GBE: poliță/SGB, fără rețineri | acceptăm riscul | 479 pag. 12/17; 480 poz. 54 296 | — (broker/bancă: primă, colateral, durată, restituire) | Financiar (oferta de la broker/bancă) | la semnare; `gbe_polite` după atribuire |
| 1b | GBE: bază E1 + completare (C) | aplicăm dacă AC confirmă | 480 poz. 10 569 / 15 023 | răspuns scris la #64 pt 1a / 5b; altfel A | Razvan (decizia), Financiar (instrumentul) | răspunsul #64; contractul semnat |
| 1c | GBE: 5 zile calendaristice | țintă internă | 479 VI.3 vs 480 poz. 54 966 | sursa rămâne în conflict până la #64 pt 1b | verificatorul clauzelor (notă la cl. 31, fără suprascriere) | răspunsul #64 pt 1b |
| 2 | GP: poliță, 150 zile propuse | aplicăm după verificarea sursei oficiale | 479 pag. 11/16/17 | termenul din anunțul SEAP; CUI și cont din sursa oficială (registrul public, #63 pt 6); nu e o condiție pe variantă | responsabilul licitației (tab 🛡, zile setate manual); Claude (SQL text BD, după GO) | la orice modificare a termenului sau cerere de prelungire |
| 3 | Penalități: rezervă în preț + întrebări | acceptăm riscul | 480 „Sanctiuni” | #64 pt 2b/2c/2d/2e; cumulul nu se presupune | Financiar (rezerva în preț) | răspunsul #64; graficul final |
| 4 | Ajustare = protecție; DR ulterioară = scenariu | ipoteză prudentă | 479 II.3; 480 art. 5.2–5.3 | #64 pt 3 decide rezerva DR | Financiar | răspunsul #64 pt 3 |
| 5 | Cash-flow fără avans | ipoteză prudentă | 479 poz. 13 658; 480 poz. 11 527 | #64 pt 4 (confirmare) | Financiar | răspunsul #64 pt 4 |
| 6 | Lista de prețuri granulară, de lucru (începută acum) | acceptăm riscul | 480 poz. 75 240; 1276 pag. 25; 479 poz. 73 056 | forma depusă după #63 pt 5; baza = rânduri `validat` (R5) | Oana Nica (structura), Financiar (prețuri) | răspunsul #63 pt 5; închiderea R5; înainte de depunere |
| 7 | E1 sustenabilă singură, 4 categorii de costuri | acceptăm riscul | 479 pag. 2, II.2.14; 480 poz. 15 023 | #64 pt 5 (reformulat) | Financiar (testul E1 singură), Razvan (marja) | răspunsul #64 pt 5; Formular 9 |
| 8 | E1 realist + marjă; jaloane separate | acceptăm riscul | 480 „Durata”, poz. 65 760, 70 822 | #64 pt 2d și 5c | Oana Nica (graficul); Claude (cl. 43, după GO) | graficul final vs Formular 9 vs PT |
| 9 | 36 luni pe fiecare recepție aplicabilă | acceptăm riscul | 479 pag. 14; 480 poz. 56 296 / 57 577 | #64 pt 5d; HG 395 art. 42 — juridic | responsabilul PT (`ofertare_pt_garantie` din UI) | răspunsul #64; verificarea juridică |
| 10 | Documentele de după semnare pregătite | acceptăm riscul | 480 poz. 51 815, cl. 46/52/57 | #64 pt 2a | Oana Nica, Financiar | răspunsul #64 pt 2a; la semnare |
| 11 | Configurația: individual, fără terț/asociere/subcontractare | acceptăm riscul | registru id 14–17; 479 pag. 16 | fără condiție AC; decizie comercială confirmată separat de Razvan (criteriul de închidere 1) | Oana Nica (registru, după confirmare) | înainte de DUAE |

## Propuneri pentru #64 și #63 (decide Razvan; nimic scris sau trimis)
Textul din BD se schimbă numai prin preview → GO → apply, înainte de trimiterea pe SEAP (termen 01.10).
1. **Pt 1:** adăugăm (c) procentul reținut din fiecare factură la rețineri succesive. Fosta 1d (reducerea GBE la notificare) trece în pt 5b.
2. **Pt 2:** adăugăm (d) „Pentru fazele Etapei 1 prevăzute a fi terminate într-o perioadă stabilită în graficul fizic, penalitățile pentru nerespectarea unui termen intermediar se calculează prin raportare la valoarea fazei respective sau la valoarea întregii Etape 1?” și (e) „Pentru aceeași întârziere, penalitățile aferente unei faze, ale etapei și cele pentru obligațiile care privesc Contractul în ansamblu se pot cumula?”
3. **Pt 5 — nu se scoate, se reformulează.** Textul actual: „5. Valoarea estimată pe etape. Fișa de date indică valoarea estimată totală de 37.366.625,89 lei fără TVA, Etapa 1 de 8.298.909,16 lei și Etapa 2 de 29.067.716,7 lei; suma valorilor pe etape este 37.366.625,86 lei. Vă rugăm să confirmați valoarea exactă a Etapei 2.” Propunerea:
   > „5. Etapa 2 — valoarea și efectele neactivării. Suma capitolelor bugetare ale Etapei 2 din Fișa de date (II.2.4) este 29.067.716,73 lei, iar Etapa 1 + Etapa 2 = 37.366.625,89 lei. Vă rugăm să precizați: a) confirmarea valorii Etapei 2 de 29.067.716,73 lei fără TVA; b) dacă, la notificarea privind neîndeplinirea condiției suspensive în termenul de 10 luni de la semnare, garanția de bună execuție se reduce la 10% din prețul Etapei 1; c) dacă termenul de execuție de 12 luni curge de la data din Ordinul de începere al Etapei 1 pentru ambele etape, de la ce moment se calculează perioada exclusă din termen în care Etapa 2 nu poate începe (data prevăzută în grafic pentru începerea Etapei 2 sau finalizarea Etapei 1) și ce termen de execuție se aplică Etapei 1 dacă Etapa 2 nu se activează; d) dacă, în cazul neactivării Etapei 2, lucrările Etapei 1 se recepționează separat (recepție la terminarea lucrărilor), având în vedere că instalația de racordare la SNT (cap. 4.1.2) și utilajele (cap. 4.3) sunt prevăzute în Etapa 2, și de la ce dată curge perioada de garanție pentru lucrările Etapei 1.”
4. **#63 pt 6** (CUI) rămâne ca confirmare; opțional se adaugă contul („și contul IBAN complet al beneficiarului viramentului”). #63 e de competența R8 (text aprobat), deci orice modificare cere re-aprobare.

## Parametri platformă de aplicat (preview → confirmare Razvan → apply)
| Parametru | Acum (SELECT 26.09) | Propus |
|---|---|---|
| `ofertare_licitatii.garantie_participare` (95) | 329 de caractere; „IBAN-ul e mascat” | text scurt, 235 de caractere: cuantum + formă + valabilitate + beneficiar, cu CUI-ul marcat „de confirmat” (SQL mai jos) |
| `ofertare_licitatii.observatii` (95) | 343 de caractere, începe cu „Radar (scor 92)” (filtrul Radar, `OfertareLicitatii.jsx:223`, caută `^Radar`) | **se adaugă la final** blocul de detalii (sursele valabilității, 123 = doar pentru data din BD, 150 = propunere, reemiterea, CUI/IBAN de verificat) |
| Cererea către broker (`ofertare_garantii`) | 0 rânduri; UI propune 90 zile | 370.000 lei, 150 zile propuse, beneficiar UAT Vâlcelele; după confirmarea termenului și a beneficiarului |
| `ofertare_pt_garantie` (95) | 0 rânduri | cerut/oferit 36 luni, `receptie_terminare`, cerința 6407 (din UI) |
| `ofertare_clauze_contract` 30–64 | 35/35 `verificat_de` NULL | verificare de către om; note la cl. 31, 35, 36/37, 43, 45, 47/48/50 |
| `ofertare_clauze_contract` 43 | `evaluare_gazpet` „12 luni pentru Etapa 1” | citatul din 480 „Durata”, textul vechi păstrat în notă (SQL separat, după GO) |
| `ofertare_cantitati` (95) | 6 rânduri, `obiect` NULL, 0 validate | convenția `obiect` = Etapa 1 / Etapa 2, după răspunsul la #63 |
| `ofertare_formulare_registru` (95) | 12 rânduri (id 11–22), toate `de_pregatit`; id 14–17 `aplicabil=false`; id 13 cu „art. 60” | configurația confirmată (F6 a) + rânduri pentru cele 5 piese FD (F6 b) + id 13 cu „art. 59-60” (F6 c); Formularul 9 (id 20): E1 / E2 / total, C+I vs OS, termenul identic cu graficul |
| `valoare_estimata` / `termen_depunere` | 37.366.625,89 ✓ / 19.10.2026 15:00 (ora RO) | fără schimbare; termenul se **confirmă în anunțul SEAP CN1096479** înainte de cererea către broker |

```sql
-- NEEXECUTAT. Se rulează doar după confirmarea explicită a lui Razvan (pct. 3 din CLAUDE.md). Fiecare pas = un apel execute_sql separat.
-- 1) Preview + snapshot pentru rollback (păstrează rezultatul: textele vechi, complete)
SELECT id, garantie_participare, md5(garantie_participare) AS gp_md5, observatii, md5(observatii) AS obs_md5, updated_at
  FROM public.ofertare_licitatii WHERE id = 95;
-- așteptat la 26.09: gp_md5 = f39d3a9a0cbda24c921fed546c79577b (329 caractere); obs_md5 = 089f25556fa972bc093338900326954a (343 caractere, „Radar (scor 92)…”)
-- 2) Apply: text scurt în garantie_participare (începe cu „370.000”, deci numar() din OfertareGarantie.jsx:30 dă 370000);
--    blocul de detalii se ADAUGĂ LA FINALUL lui observatii. Gărzi: textul din preview (md5) + idempotent (a doua rulare = 0 rânduri).
WITH p AS (SELECT
  '370.000 lei (FD III.1.6.a); virament sau SGB/poliță irevocabilă și necondiționată; valabilă ≥ 4 luni de la termenul-limită de depunere; beneficiar UAT Vâlcelele, CUI 3796837 (FD I.1), de confirmat din sursa oficială înainte de emitere.'::text AS gp_nou,
  'Garanția de participare (R7, 26.09.2026), detalii: cuantum 370.000 lei (FD III.1.6.a, doc 479 pag. 11), constituită conform art. 154 alin. (4) L98/2016 (FD pag. 17), irevocabilă și necondiționată. Valabilitate: cel puțin egală cu valabilitatea ofertei, adică 4 luni de la termenul-limită de depunere (FD pag. 16); cu termenul din BD, 19.10.2026 (de confirmat în anunțul SEAP CN1096479), rezultă 19.02.2027 = 123 de zile, cifră valabilă doar pentru această dată. Durata propusă brokerului: 150 de zile (propunere internă, nu minim). La orice modificare a termenului de depunere sau la o cerere a AC de prelungire a valabilității ofertei (FD pag. 16) se reverifică data de expirare: dacă 4 luni de la noul termen depășesc valabilitatea, polița se reemite sau se prelungește. CUI: FD I.1 și contractul (480, preambul) scriu 3796837; III.1.6.a scrie 379683, cu cifra de control invalidă (posibilă eroare de tipar, nu dovadă a identității beneficiarului); confirmare prin #63 pt 6 și sursa oficială. IBAN RO71TREZ2015006XXX000189 (Trezoreria Călărași), identic în FD și în contract; „XXX” nu dovedește nici mascarea, nici forma completă: contul se verifică din sursa oficială înainte de orice virament.'::text AS bloc)
UPDATE public.ofertare_licitatii l
   SET garantie_participare = p.gp_nou,
       observatii = CASE WHEN coalesce(l.observatii, '') = '' THEN p.bloc ELSE l.observatii || E'\n\n' || p.bloc END,
       updated_at = now()
  FROM p
 WHERE l.id = 95
   AND md5(l.garantie_participare) = 'f39d3a9a0cbda24c921fed546c79577b'
   AND strpos(coalesce(l.observatii, ''), 'Garanția de participare (R7') = 0
RETURNING l.id, length(l.garantie_participare) AS len_gp, left(l.observatii, 16) AS obs_inceput, length(l.observatii) AS len_obs;
-- așteptat: 1 rând. 0 rânduri = textul s-a schimbat între timp sau pasul e deja aplicat → refă preview-ul, nu forța.
-- 3) Sanity check
SELECT id, left(garantie_participare, 40) AS gp, left(observatii, 16) AS obs_inceput, length(observatii) AS len_obs,
       observatii ~ '^Radar' AS radar_ok
  FROM public.ofertare_licitatii WHERE id = 95;
-- așteptat: gp începe cu „370.000 lei (FD III.1.6.a)”, obs_inceput = „Radar (scor 92):”, radar_ok = true.
-- 4) Rollback (doar la nevoie): scoate DOAR blocul exact (notele adăugate ulterior în observatii rămân) și pune textul vechi
--    din snapshot-ul de la 1). Gărzi: garantie_participare = textul scris la 2) (nimeni nu l-a editat), blocul există nemodificat
--    și textul vechi pus în gp_vechi are md5-ul din preview (rulat cu placeholder-ul neînlocuit => 0 rânduri, nimic scris).
WITH p AS (SELECT
  '<textul vechi al garantie_participare, din snapshot-ul de la pasul 1>'::text AS gp_vechi,
  '370.000 lei (FD III.1.6.a); virament sau SGB/poliță irevocabilă și necondiționată; valabilă ≥ 4 luni de la termenul-limită de depunere; beneficiar UAT Vâlcelele, CUI 3796837 (FD I.1), de confirmat din sursa oficială înainte de emitere.'::text AS gp_nou,
  'Garanția de participare (R7, 26.09.2026), detalii: cuantum 370.000 lei (FD III.1.6.a, doc 479 pag. 11), constituită conform art. 154 alin. (4) L98/2016 (FD pag. 17), irevocabilă și necondiționată. Valabilitate: cel puțin egală cu valabilitatea ofertei, adică 4 luni de la termenul-limită de depunere (FD pag. 16); cu termenul din BD, 19.10.2026 (de confirmat în anunțul SEAP CN1096479), rezultă 19.02.2027 = 123 de zile, cifră valabilă doar pentru această dată. Durata propusă brokerului: 150 de zile (propunere internă, nu minim). La orice modificare a termenului de depunere sau la o cerere a AC de prelungire a valabilității ofertei (FD pag. 16) se reverifică data de expirare: dacă 4 luni de la noul termen depășesc valabilitatea, polița se reemite sau se prelungește. CUI: FD I.1 și contractul (480, preambul) scriu 3796837; III.1.6.a scrie 379683, cu cifra de control invalidă (posibilă eroare de tipar, nu dovadă a identității beneficiarului); confirmare prin #63 pt 6 și sursa oficială. IBAN RO71TREZ2015006XXX000189 (Trezoreria Călărași), identic în FD și în contract; „XXX” nu dovedește nici mascarea, nici forma completă: contul se verifică din sursa oficială înainte de orice virament.'::text AS bloc)
UPDATE public.ofertare_licitatii l
   SET garantie_participare = p.gp_vechi,
       observatii = CASE WHEN l.observatii = p.bloc THEN NULL ELSE replace(l.observatii, E'\n\n' || p.bloc, '') END,
       updated_at = now()
  FROM p
 WHERE l.id = 95
   AND l.garantie_participare = p.gp_nou
   AND md5(p.gp_vechi) = 'f39d3a9a0cbda24c921fed546c79577b'   -- md5-ul textului vechi din preview (pasul 1, 26.09)
   AND (l.observatii = p.bloc OR strpos(l.observatii, E'\n\n' || p.bloc) > 0)
RETURNING l.id, md5(l.garantie_participare) AS gp_md5, length(l.observatii) AS len_obs;
-- așteptat: 1 rând, gp_md5 = f39d3a9a0cbda24c921fed546c79577b. 0 rânduri = placeholder-ul nu e înlocuit exact cu textul din snapshot,
--    sau textul a fost editat după apply → verifică gp_vechi / restaurare manuală din snapshot.
```

Testat local, nu pe Supabase, pe un Postgres 16 de unică folosință (pornit și șters), cu rândul 95 copiat din BD (textele reale, md5 identic cu BD) și cu SQL-ul extras exact din acest fișier. Rezultatele sunt în tabelul „Verificări” (rândul „SQL garanție, local”). Rollback-ul rulat textual, cu placeholder-ul neînlocuit, dă **0 rânduri** (garda md5); înainte de gardă scria chiar textul placeholder-ului în `garantie_participare` (reprodus).

Textul scurt ajunge și în consumatorii existenți ai câmpului: mailurile `ofertare-etapa1-mail` (l. 134) și `ofertare-garantie-mail` (l. 45), prompturile AI `ofertare-verificare-finala/index.ts:106` și `ofertare-clarificari-propune/core.ts:94`, plus **`ofertare-clauze-formulare/index.ts:167/181`** (rândul licitației, cu `garantie_participare`, intră ca JSON în promptul plătit de completare a formularelor; omis în revizia 3). Impactul e neglijabil: textul are 235 de caractere. `observatii` nu e trimis în aceste prompturi (grep).

Cod: până la #487 (`a4b2982`, pe `main`), `OfertareGarantie.jsx` recunoștea doar „NNN zile” și punea altfel 90 de zile implicit. #487 a scos implicitul: modulul pur `src/ofertareGarantieValabilitate.js` citește durata în zile sau luni („4 luni”, „4 (patru) luni”, „minim 120 zile (4 luni)”), cu luni calendaristice; pe 95: 19.10.2026 + 4 luni = 19.02.2027. Avertizarea de decalare după starea `original` e tratată pe ramura `claude/r7-propagare-garantie` (criteriul 5), nemergiuită.

## Criteriile de închidere R7 (verdictul Copilot) și starea lor
Starea e citită pe BD la 26.09 (SELECT). Semnarea fișei închide doar criteriul 1.

| # | Dovada cerută | Starea la 26.09 | Ce lipsește |
|---|---|---|---|
| 1 | Decizii nominale: cele 10 puncte aprobate cu variante și condiții; configurația participării confirmată separat | **0 / 10 aprobate**. Configurația: id 14–17 `aplicabil=false` în registru, neconfirmată de Razvan; toate 12 formularele `de_pregatit` | aprobarea listei finale (rândurile 1–12), cu tipul fiecărei decizii |
| 2 | Cele 35 de clauze revizuite pe surse, cu starea corespunzătoare; neclaritățile rămân explicite | **35 / 35 `verificat_de` NULL** (id 30–64) | verificare umană din UI; notele: cl. 31 (conflict FD–contract), 35 (grație, plafon AI), 36/37 (declanșatori distincți, nu „45+ zile”), 43 (E1+E2), 45 (10 luni vs 12 luni), 47/48/50 (recepții pe etape, vicii ascunse). GO-ul pe cele 10 teme nu marchează automat clauzele |
| 3 | Parametrii greșiți corectați: fără presupunerea de 90 de zile (dar fără înlocuirea globală cu 150); cl. 43 cu proveniență; valorile și rolurile GBE distincte | **90 de zile implicit: scos din cod** (#487, `a4b2982`, pe `main`; valabilitatea citită în zile sau luni, fără valoare implicită); **cl. 43** încă „12 luni pentru Etapa 1”; **`garantie_participare`** încă „IBAN mascat” (329 de caractere); GBE: cl. 30 (10%, sumă garantată), 31 (termenul), 32 (0,5% rețineri) — valori și roluri distincte, corecte literal | UPDATE cl. 43 cu citat și istoric; SQL-ul de mai sus — toate prin preview → GO |
| 4 | Cele 5 piese din FD legate de obligație, responsabil și artefact; Formularul 3 rezolvat din sursă | **0 / 5** în registru (tabelul de mai jos le leagă, ca propunere); Formularul 3 (id 13) încă „art. 60” | rândurile în registru; responsabilii numiți; id 13 → „art. 59-60” (din FD, poz. 71 926) |
| 5 | Propagarea verificată (fișa licitației, cererea către broker, centralizatorul, graficul, declarațiile — aceeași versiune) + test de recalculare la modificarea termenului | **nimic propagat**: `ofertare_garantii` 0, `grafic_activitati` / `grafic_versiuni` 0, `ofertare_pt_capitole` 0, `ofertare_pt_pachet` 0, centralizatorul nu există în platformă, formularele `de_pregatit`. Recalcularea: analizată doar în cod (actualizarea păstrează numărul de zile, l. 173; avertizarea dispare după `original`), netestată pe 95 | după apply: verificarea pe cele 5 artefacte; testul de recalculare pe o licitație de probă (termen mutat ± 30 de zile), cu GO. Testul de propagare (termen mutat ⇒ cerința recalculată + semnal de reverificare; polița emisă nu e considerată prelungită) e implementat pe ramura `claude/r7-propagare-garantie` (cap `80d618f` peste `5e61820`; vitest 81/81 pe modul, suita completă 474/474; reverificarea rundei 2 confirmă, cu 2 minore), nemergiuit, nepushat — detaliu și decizii deschise mai jos |

**Testul de propagare (criteriul 5), ramura `claude/r7-propagare-garantie`, cap `80d618f`** (commituri `5e61820`, `80d618f`; local, fără push și fără PR; fără schemă BD, fără edge fn, fără scrieri în BD):
- termenul de depunere mutat ⇒ cerința de valabilitate se recalculează, iar garanția primește semnalul „de reverificat”; o poliță emisă nu e considerată prelungită până la actul adițional;
- KPI-ul „Garanție participare” și eticheta tab-ului 🛡 vin din aceeași funcție pură (`indicatorGarantie`): garanția care nu e în original rămâne „în curs” roșie, cu semnalul alături; eroarea de citire sau garanția negăsită la recitire dau „de reverificat”, nu verde;
- o cerere de prelungire rămasă pentru alt termen (T → T+30 → înapoi la T) se poate închide doar când polița acoperă dovedit termenul curent și cerința (marcaj `⟦prelungire-renuntata⟧`); perioada poliței nu se prelungește;
- polița în original cu cerința necitită sau contradictorie ⇒ „de reverificat”, nu verde;
- la pasul 4, perioada precompletată nu mai suprascrie ce a trecut omul de pe polița fizică.
- Teste: `ofertareGarantieValabilitate.test.js` 81/81 (15 noi); aceleași teste noi pe codul de la `5e61820`: 12 din 15 pică; suita completă a worktree-ului 474/474. Reverificarea adversarială a lui `80d618f`: confirmă, 2 minore rămase (mesajul butonului „nu mai e necesară” trimite la un formular de act adițional care nu mai apare după renunțare — efect conservator, polița arătată mai scurtă, nu mai lungă; KPI-ul poate clipi un frame pe semnalul vechi după salvarea unui termen mutat).

**Decizii deschise pe ramura de propagare (Razvan):**
- **Veghea SEAP și garanția.** Azi `ofertare-seap-veghe` trimite la „TERMEN MUTAT” doar o notificare generică în clopoțel (fără mail), care nu spune dacă licitația are garanție. A: veghea verifică garanția neanulată și scrie „are garanție — polița e de reverificat” (modificare edge fn + deploy). B: indicator pe cardul din listă, cu view / coloană nouă (schemă BD). C: rămâne cum e (clopoțel generic + semnal în fișă).
- **Butonul „✓ Prelungirea nu mai e necesară”**: închide cererea veche fără act adițional, doar la acoperire dovedită. Se păstrează așa sau se cere și aici confirmarea brokerului?
- **Polița în original + cerință necitită ⇒ „de reverificat” permanent**, până când cerința devine citibilă (registru sau rezumatul din fișă). Azi nu există nicio poliță reală în situația asta (singura, #1, are cerința citibilă). Se păstrează?
- Din runda 1: câmpul „perioada scrisă pe poliță” de la pasul 4 și dacă „achitată” înseamnă poliță deja emisă.

**Cele 5 piese din FD fără formular 481 (criteriul 4):**

| Piesa | Obligația (sursa) | Responsabil (propus) | Artefact în platformă | Stare |
|---|---|---|---|---|
| Garanția de participare | lista FD pct. 1 (479 pag. 16, poz. 71 676); III.1.6.a (pag. 11); dovada în SEAP până la termen (pag. 17, poz. 76 192) | responsabilul licitației + Financiar | `ofertare_garantii` (tab 🛡) + polița (`polita_path`) | 0 rânduri |
| DUAE (răspuns), pentru toți operatorii | lista FD pct. 2 (poz. 71 704) | Oana Nica | fișierul DUAE răspuns (doc 482 e doar cererea XML) → rând în registru | lipsă |
| Lista de prețuri / Centralizator + Graficul general fizic și valoric | lista FD pct. 9 (poz. 73 056); 479 pag. 15, poz. 67 730 / 67 755; identitate cu Formularul de ofertă (pag. 16, poz. 73 220) | Financiar (prețuri), Oana Nica (grafic) | lista (azi în afara platformei; `ofertare_cantitati` e bază doar după validare) + `grafic_versiuni` | 0 / 0 |
| Planul de management al calității (15 p) | factorul tehnic (479 pag. 3, poz. 6 533; grila poz. 7 616); Formular 10 cap. 3 (481 poz. 32 659); CS §6.1 (1276 pag. 17) | de numit de Razvan | capitol PT (`ofertare_pt_capitole`) + cerințele 6396/6397 | 0 capitole; factorul nu e reținut ca cerință |
| Documentele terțului susținător (anexe F4) | lista FD pct. 6 (poz. 72 325), „dacă este cazul” | — | — | neaplicabil dacă se confirmă configurația fără terț (decizia 10 din lista finală) |

## Corecturi față de documentele anterioare
- IBAN „mascat” (VALCELELE §4, R7 §5, textul din BD): **nedovedit**, la fel ca afirmația contrară. „XXX” nu dovedește nici mascarea, nici forma completă; mod-97 nu e dovadă (11/1000 variante numerice trec). Contul se verifică din sursa oficială.
- CUI: nepotrivirea din text rămâne; 379683 are cifra de control invalidă, ceea ce semnalează o posibilă eroare de tipar, fără să dovedească singur identitatea beneficiarului.
- „Cei 3 bani” (R7 §9 pt 6, linia 75, și Verdict, linia 92): **lămurit**, E2 = 29.067.716,73.
- „E1 pe 12 luni” (R7 §1, linia 18; cl. 43): **greșit**, cele 12 luni sunt nete pentru E1+E2.
- Matricea, F6 („registru = 0”, linia 31): **depășit**, registrul 95 are 12 rânduri (id 11–22).
- Locatorul „0,5%” (VALCELELE §2): exact 480 poz. 54 296.
- Revizia 3 (finisajele reverificării): reemiterea poliței cu o singură formulare; text scurt pentru `garantie_participare`; F6 (c); „nu prevede reducerea GBE (tăcere)”.
- **Revizia 4 (verdictul Copilot):**
  - pct. 1: C condiționat de AC, fără rezervă în ofertă; sume garantate ≠ cost ≠ numerar; 5 zile calendaristice = țintă internă, fără suprascrierea cl. 31;
  - pct. 2: 150 = propunere, nu minim; 123 = doar pentru data din BD; pasajele din FD pag. 16 (poz. 74 318, 75 524, 74 577); CUI/IBAN din sursa oficială; textul propus pentru BD nu mai afirmă nimic ca fapt;
  - pct. 3: scenarii, rezerva nu plafonează, cumulul de verificat (#64 pt 2e);
  - pct. 4–5: formula completă; DR ulterioară = scenariu de risc; „preț ≤ valoare estimată” = obiectiv intern; „fără avans” = ipoteză prudentă;
  - pct. 6: listă de lucru; cantitățile R5 nevalidate nu devin bază; „45 de zile” înlocuit de declanșatorii distincți;
  - pct. 7 rescris: alocare în 4 categorii + testul E1 singură; 22,21% = pondere; pt 5 din #64 reformulat, nu scos (fosta propunere „scoatem pt 5” e retrasă);
  - pct. 8: întrebare explicită despre curgerea celor 12 luni (5c); jaloane contractuale vs date interne; cl. 43 cu proveniență;
  - pct. 9–10: garanția pe fiecare recepție aplicabilă, corelarea cu eliberarea GBE, vicii ascunse; termene numai din surse;
  - completările A, B, C; criteriile de închidere R7; tabelul celor 5 piese FD.
- **Revizia 4 (verificatorul rundei 3, minore):** consumatorul AI `ofertare-clauze-formulare/index.ts:167/181` adăugat; F6 (c) citează 1276 + 1277 (494 fără text); rollback-ul R7 scoate doar blocul exact și păstrează notele ulterioare (testat).
- **Revizia 4, după reverificare (26.09):**
  - (major) penalitățile: „alternative de bază, nu de adunat” (Sumar, rândul 3; pct. 3, „Scenarii”) → „scenarii calculate pe câte o bază (E1 / E2 / total), fiecare separat; relația dintre ele (cumul sau alternativă) e nestabilită — #64 pt 2e”. Formularea respinsă de Copilot nu mai apare ca recomandare;
  - pct. 8: „costă până la 8.298,91 lei” → „costă 8.298,91 lei dacă baza e toată E1 (scenariu; cumulul cu alte baze nestabilit)”; fără plafon sugerat;
  - tipurile: al șaselea tip, definit („aplicăm după verificarea sursei oficiale”, rândul 2 din C); rândul 6 = „acceptăm riscul”; rândul 11 = „acceptăm riscul”, cu confirmarea separată (criteriul de închidere 1) în coloana „Condiția”; Sumarul folosește aceleași tipuri;
  - rollback-ul SQL (pasul 4) are garda `md5(p.gp_vechi) = 'f39d3a9a…'`: rulat cu placeholder-ul neînlocuit nu mai scrie nimic (testat).

## Verificări (SELECT / calcul local)
| Verificare | Rezultat |
|---|---|
| Stare lic. 95 (26.09) | `valoare_estimata` 37.366.625,89; `termen_depunere` 2026-10-19 12:00 UTC; `decizie_go` go; `garantie_participare` 329 caractere (md5 f39d3a9a…); `observatii` 343, începe cu „Radar (scor 92)” (md5 089f2555…); `criteriu` = preț 85 p + PMC 15 p |
| Clauze 30–64 | 35 rânduri, `verificat_de` NULL pe toate; cl. 43 `evaluare_gazpet` „…12 luni pentru Etapa 1…”; cl. 36/37 „45+ zile” |
| Cantități / garanții / PT | `ofertare_cantitati` 95: 6 rânduri, `obiect` NULL, 0 validate, 1756 = 13.140; `ofertare_garantii` 95 = 0; `ofertare_pt_garantie` 95 = 0; `ofertare_pt_capitole` 95 = 0 |
| #63 / #64 | ambele `de_trimis`, `raspuns` NULL; #64 pt 5 = valoarea E2 (text citat mai sus); #63 pt 6 = doar CUI |
| Registru formulare 95 | 12 rânduri (id 11–22), toate `de_pregatit`; `aplicabil=false`: id 14, 15, 16, 17; id 13 „…art. 60 din…” |
| FD pag. 2, structura etapelor | E1: 8.164.462,81 + 100.000,00 + 34.446,35 = 8.298.909,16; E2: 12 capitole = 29.067.716,73 (racordare SNT 78.252,90; utilaje 1.126.268,00; OS E2 24.446,35); total 37.366.625,89 (Decimal, local) |
| Criteriul și grila PMC | 479 pag. 3: factor poz. 6 533, „Punctaj maxim factor: 15” poz. 7 590, grila 5/10/15 poz. 7 616; 481 poz. 28 389 / 32 659; 1276 §6.1 pag. 17 poz. 53 930; cerințe 6396/6397 (pag. 13, `de_analizat`); 0 cerințe pentru factor |
| Valabilitate GP | 479 pag. 16: poz. 74 318 (oferta, 4 luni), 74 577 (prelungire la cererea AC), 74 801 (singurul „inacceptabil”), 75 524 (garanția ≥ oferta); pag. 17 poz. 76 192 (dovada în SEAP) |
| Plăți | 480 poz. 75 240 („Modalitati de plata”), 76 073 (15 zile de la primirea situației; observații → refacere), 76 428 (30 de zile de la primirea facturii, emisă după confirmare) |
| Penalități | 480: trei fraze (neîndeplinire / întârziere / AC); „plafon” 0 apariții; „cumul” doar poz. 38 663 („acumularea de obstacole”) |
| Vicii ascunse | 480 poz. 39 182: 10 ani de la recepție + structura de rezistență pe durata existenței (= cl. 48) |
| Formularul 3 / CS | id 13 „art. 60”; 481 poz. 1 092 „art. 60”; 479 poz. 71 926 (pag. 16) „art. 59-60”; „formular” în 1276: o dată (poz. 85 266, pag. 25); în 1277: 0; 494 fără text |
| Calcule (Decimal, local) | GBE 3.736.662,59 / 829.890,92 (45,03%); rețineri 186.833,13 / 41.494,55; 1%/an 37.366,63 / 8.298,91; 10 luni 31.138,85 / 6.915,76; penalități 30 z 248.967,27 / 872.031,50 / 1.120.998,78; ajustare 456.440,00 / 2.055.164,42; 50% = 18.683.312,95; colateral 25% 934.165,65 / 207.472,73 |
| Date / zile | 19.10.2026 + 4 luni = 19.02.2027 = 123 z; 4 luni calendaristice = 120–123 z (toate datele din 2026–2027); +150 z = 18.03.2027 = 4 luni de la 18.11.2026; implicit UI 90 z = 17.01.2027 |
| IBAN mod-97 | literal XXX: mod97 = 1; 11/1000 variante numerice trec și ele |
| Termene furnizori (proxy) | `contracte_terti` `sens='plata'`: 12 cu termen (5, 20, 30×5, 60×4, 90), 50 fără; `logistica_furnizori`: 1/35 cu termen (30) |
| Lichiditate (secțiunea A) | model local (Python), ipotezele marcate; cifrele din tabel sunt ieșirea lui |
| SQL garanție, local | Postgres 16 de unică folosință (pornit și șters), rândul 95 cu textele reale (base64), SQL extras exact din fișier: apply 1 rând (235 / 1.542 caractere, `^Radar` adevărat); reapply 0; rollback → md5 identic cu starea inițială pe ambele coloane; rollback repetat 0; o notă adăugată după bloc **rămâne** după rollback (`observatii` = originalul + nota); apply cu textul editat între timp → 0; rollback după editarea textului de om → 0; `observatii` NULL → apply scrie doar blocul, rollback readuce NULL. **Reverificare 26.09 (gardă md5 nouă):** rollback cu placeholder-ul neînlocuit → 0 rânduri, starea de după apply neschimbată (fără gardă: 1 rând, placeholder-ul ajungea în `garantie_participare`); cu textul real → 1 rând, md5 identic cu starea inițială; restul scenariilor neschimbate (18/18; fără gardă 13/18). `numar()` din `OfertareGarantie.jsx:30` (node) pe textul scurt = 370000 |

## Decizii cerute lui Razvan (opțiunea recomandată în paranteză)
1. GBE (**poliță/SGB fără rețineri; bază pe total, E1 + completare numai dacă AC confirmă; țintă internă 5 zile calendaristice**).
2. Garanția de participare (**poliță, 150 de zile propuse, după confirmarea termenului în SEAP și a CUI/contului din sursa oficială; + SQL-ul de text**).
3. Penalități (**rezervă în preț — suma o fixezi tu, nu plafonează; #64 pt 2 cu 2d/2e**).
4. Ajustare și avans (**prețuri la data ofertei; DR ulterioară = scenariu, rezerva o decizi dacă AC nu răspunde; cash-flow fără avans**).
5. Lista de prețuri (**listă de lucru granulară acum; forma depusă după #63 pt 5; fără cantități R5 nevalidate ca bază**).
6. Lichiditate (**plafonul de numerar / linia de finanțare acceptată pentru scenariul „stres” din secțiunea A**).
7. Etapa 2 (**alocare în 4 categorii + testul E1 singură făcut de Financiar; #64 pt 5 reformulat, nu scos**).
8. Termen (**E1 realist + marjă, propus de Oana Nica; jaloane contractuale separate de datele interne; cl. 43 corectată cu proveniență**).
9. Garanția lucrărilor și obligațiile de ansamblu (**36 luni pe fiecare recepție aplicabilă, corelarea GBE verificată juridic; drafturile GBE/plan OS înainte de semnare**).
10. Configurația participării (**ofertant individual, fără terț/asociere/subcontractare — confirmare separată**).
11. Planul de management al calității (**numești responsabilul; verificare după grila de 15 p; capitol dedicat în PT**).
12. #63/#64 și clauzele (**textele revizuite trimise pe SEAP de Oana Nica, cu aprobarea ta, până la 01.10; cine verifică cele 35 de clauze**).
