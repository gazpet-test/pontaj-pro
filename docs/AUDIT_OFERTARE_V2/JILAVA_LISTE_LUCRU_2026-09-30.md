# Jilava / PT93 — liste de lucru pentru verificarea umană (30.09)

- **Ce e:** pregătire read-only (SELECT pe licitația 93, 29.09 ~23:50 ora RO). Nu s-a scris nimic în BD.
- **Unde se decide:** în UI (Ofertare → Jilava), de un om. AI candidate ≠ human verified: tot ce e mai jos e închis sau exceptat **doar de AI** (`sursa='ai'`, fără actor uman).
- **Locator:** `doc/pag/secț`; doc 369 = fișa de date, 366 = caietul de sarcini, 427 = fișele tehnice, 425/431/435/436 = specificații / condiții Transgaz.

## A. 27 de eliminatorii închise „nu se aplică” doar de AI (toate în `de_analizat`, 0 cu actor)

### A1. Prioritate 1 — probabil GREȘIT închise (se depun odată cu oferta)
| ID | Când | Locator | Cerința (scurt) | Motivul AI | Ce verifică omul |
|---|---|---|---|---|---|
| 5801 | DUAE | 369/6/III.1.1.b | Subcontractanții completează un **DUAE distinct** | „mod de prezentare” | ELCAS e subcontractant declarat → DUAE ELCAS obligatoriu |
| 5916 | depunere | 369/12/IV.4.3 | Se prezintă **acordurile de subcontractare**/susținere/asociere | „mod de prezentare” | Acord F4 ELCAS semnat, în pachet; plus ATSD, după decizia de rol |
| 5936 | DUAE | 369/13/VI.3 | DUAE completat în SEAP de **toți participanții** | „mod de prezentare” | DUAE Gazpet + ELCAS (+ ATSD, dacă e terț/subcontractant) |
| 5813 | depunere | 369/8/III.1.3.a | **Terțul susținător**: DUAE + angajament ferm | „doar dacă se folosește terț” | Decizia ATSD (subcontractant sau terț susținător) → dacă e terț, angajamentul e obligatoriu |
| 5814 | depunere | 369/8/III.1.6.a | **Garanție de participare 10.037,58 lei** (virament la Trezorerie sau instrument) | „aspect financiar” | Constituită? (TKT-2026-0288, neatins din 24.09) |
| 5914 | depunere | 369/12/IV.4.3 | **Dovada garanției** la „Documente de calificare” în SEAP | „mod de încărcare” | Dovada încărcată în SEAP |
| 5920 | depunere | 369/2/II.1.5 | Cuantumul garanției: 10.037,58 RON (1%) | „aspect financiar” | Suma exactă, în lei |
| 6045 | depunere | 427/5/FT1 pct. 5 | **Dovada conformității materialului tubular** (tuburi de protecție) | „document de furnizor” | Fișa/certificatul SINTAX FT1, atașat la PT |
| 6051 | depunere | 427/5/FT5 pct. 7 | Dovada conformității **DN50** (aerisire) | „document de furnizor” | Certificatul 3.1 DN50 SINTAX (lipsește) |
| 6053 | depunere | 427/13/FT 6–9 | **Fișele tehnice completate**, cu corespondența față de CS + producătorul | „mod de prezentare” | Cap. 6: 40 de marcaje `[DE COMPLETAT]`, fișele ELCAS/cabluri FT6–FT9 |

### A2. Prioritate 2 — reguli care se satisfac prin conținut, nu „nu se aplică”
| ID | Locator | Cerința (scurt) | Ce verifică omul |
|---|---|---|---|
| 5898 | 369/11/IV.4.1 | PT neconformă dacă lipsește **orice** cerință din CS | Anexa (matricea) nu trebuie să declare 181 „fără capitol”; decizia A/B din raport §4 pct. 12 |
| 5899 | 369/11/IV.4.1 | Neprezentarea ofertei tehnice → excludere | PT în pachet |
| 5904 | 369/11/IV.4.2 | Financiară în lei fără TVA, maxim 2 zecimale, ≤ valoarea estimată | Oferta financiară |
| 5909 | 369/12/IV.4.2 | Fără prețuri unitare diferite pentru aceeași resursă și fără cote diferențiate | Listele de cantități cu prețuri |
| 5913 | 369/12/IV.4.3 | Retragerea după termen → excludere + executarea garanției | Informativ; închis ca „nu se aplică” e acceptabil, dar cu om |
| 6185 | 436/6/I.2.3 | Tubul de protecție montat doar de executanți specializați, cu utilaje și personal atestat | Acoperit prin 5971/5972/5979 (motivul AI) → confirmat de om |

### A3. Prioritate 3 — DUAE / primul loc / operatori străini (probabil corect închise, dar de confirmat de om)
- **DUAE, declarații pentru toți participanții (inclusiv ELCAS):** 5798 (art. 167), 5799 (conflict de interese; consultant ERGOEXPERT), 5941 (art. 164–167), 5947 (conflict de interese), 5810 (curs BNR: corect doar dacă toate contractele de experiență sunt în lei).
- **Primul loc:** 5942, 5944 (declarația pentru punctele de lucru), 5946 (documente valabile la prezentare).
- **Operatori străini:** 5803, 5949. Corect pentru Gazpet; de confirmat și pentru ELCAS/ATSD.
- **Asociere:** 5812. „Nu se aplică” e corect dacă Gazpet depune singur, ca ofertant unic; confirmat de decizia pe roluri.

## B. 36 de excepții din scopul PT puse doar de AI (`ofertare_pt_legaturi.fel='exceptat'`, 0 confirmate de om)

### B1. Prioritate 1 — piese promise în PT sau legate de subcontractare
| ID | Locator | Cerința (scurt) | Motivul AI | Ce verifică omul |
|---|---|---|---|---|
| 5888 | 369/11/IV.4.1 | Legitimația ANRE **EGT** | „document de calificare” | Cap. 3 le promite ca anexe → atribuite capitolului 3 sau confirmat că sunt în pachet |
| 5889 | 369/11/IV.4.1 | **Certificatele sudorilor** propuși | „document de calificare/anexă” | Idem (sudorii „conform anexei”) |
| 5890 | 369/11/IV.4.1 | Certificatele personalului **CND** | „document de calificare” | Idem (EXPCORO/ELCAS) |
| 5908 | 369/12/IV.4.2 | **Centralizatorul lucrărilor subcontractanților** | „ține de propunerea financiară” | ELCAS e subcontractant → centralizatorul e obligatoriu în financiară |
| 5905 | 369/12/IV.4.2 | Financiara: formularul de ofertă + F1 + F2 | „financiară” | În oferta financiară |
| 5906 | 369/12/IV.4.2 | **F3** cu prețuri | „financiară” | F3 complet (lipsesc 4 poziții Dv.5, raport §4 pct. 13) |
| 5910 | 369/12/IV.4.2 | Prețurile includ toate cheltuielile (transport, testare, PIF, OS, remedieri) | „financiară” | Oferta financiară |

### B2. Prioritate 2 — de citit, AI a decis semantic
| ID | Locator | Cerința (scurt) | Motivul AI |
|---|---|---|---|
| 6026 | 366/15/pct. 12 | Responsabil tehnic propriu care confirmă situațiile de lucrări înainte de factură | „clauză contractuală post-atribuire” |
| 6038 | 425/1/cond. pct. 6 | Proiect tehnic de protejare/relocare/reizolare, avizat de Transgaz (CTE) | „obligație proiectant/AC” (de confirmat: nu cade pe executant?) |
| 5928 | 369/3/II.2.5 | Experiența experților se probează cu documente/recomandări de la beneficiar | „calificare” |
| 5952 | 366/5/cap. 9 | Managerul de proiect: experiență pe conducte de gaze, poziție similară | „calificare (DUAE/FD)” |
| 6132 | 431/5/cap. 1.1 | NDT pe sudurile existente + verificarea conductei și remedierea coroziunii | „duplicat al 5960” (`duplicat_al` NULL) |
| 6176 | 435/15/h | Verificarea calității izolației anticorozive | „duplicat al 6060” |
| 6183 | 435/20 | Calitatea sudurilor: tehnologii și sudori calificați | „duplicat al 6125/6179” |
| 6191 | 436/10 | Îmbinarea cap la cap, sudori și proceduri autorizate | „duplicat al 6186” |
| 6194 | 436/11 | UT 100% pe sudurile de poziție | „duplicat al 5998” |

Pentru „duplicate”: omul confirmă că cerința-țintă (5960 / 6060 / 6125, 6179 / 6186 / 5998) e acoperită și **verificată** în PT. Altfel excepția ascunde o cerință neacoperită.

### B3. Prioritate 3 — reguli de formă (se bifează la asamblarea pachetului, raport §4 pct. 23)
- **Limba română, RON:** 5871, 5900.
- **Valabilitate minim 4 luni de la termenul oficial:** 5872. **Atenție la termen:** 02.10 sau 06.10.
- **Ofertă fermă:** 5903.
- **PDF editabil:** 5901.
- **Criptare valoare SEAP:** 5902.
- **Doar electronic, până la termen:** 5911.
- **Semnătură electronică extinsă:** 5912.
- **Împuternicire:** 5915.
- **Opis și numerotare:** 5917.
- **Parte confidențială separată:** 5918.
- **Traduceri:** 5929.
- **Fără variante:** 5930.
- **Clarificări** (fereastra e închisă): 5931, 5933, 5934, 5935.
- **Departajare:** 5937.
- **Calificare, DUAE:** 5806, 5811.

## C. Ordinea recomandată (din raport §4.C)
1. A1 (10 eliminatorii) — cu Răzvan, pe decizia de roluri ELCAS / ATSD / EXPCORO și pe garanție.
2. B1 (7) — piesele din cap. 3 și financiara.
3. Legăturile PT: cele 8 blocate → cele 43 „atribuita” (2.1–2.3, 3, 4.c) → 1.i, 4.c, 1.h, 9, 4.b, 3.
4. Cele 22 de capitole obligatorii, citite și salvate de om după scoaterea marcajelor.
5. A2 + B2, apoi A3 + B3 la asamblarea pachetului.
