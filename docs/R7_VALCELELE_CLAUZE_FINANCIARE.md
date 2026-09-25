# R7: Vâlcelele (lic. 95), clauze financiare, 25.09.2026

Analiză READ-ONLY (doar SELECT pe `dxczwkbciseqniprspcu`). Surse: `ofertare_documente_atribuire` 479 (Fișa de date, FD), 480 (contract), 481 (formulare), `ofertare_clauze_contract` (35 rânduri, id 30–64), `ofertare_formulare_registru` (12 rânduri, id 11–22), `ofertare_licitatii` 95. Bază: `docs/VALCELELE_95_INFO_OFERTARE_2026-09-25.md`. Citatele sunt date din documentație, copiate literal. Termene: clarificări **01.10.2026**, depunere **19.10.2026**.

## 0. Cifre de bază (doc 479)
| Mărime | Valoare | Sursă |
|---|---|---|
| Valoare estimată totală fără TVA | 37.366.625,89 lei | 479 pag. 2: „Valoarea estimata fara TVA : 37366625,89” |
| Etapa 1 (finanțare asigurată) | 8.298.909,16 lei | 479 poz. ~3434: „TOTAL EXECUȚIE \| 8.298.909,16” |
| Etapa 2 (clauză suspensivă) | 29.067.716,7(3) lei | 479 (după E1): „TOTAL EXECUȚIE \| 29.067.716,7 … VALOAREA TOTALA ESTIMATA: 37.366.625,89” — CONFIRMAT; E1+E2 = total |
| Garanție participare | 370.000 lei (0,99%) | 479 pag. 2 + III.1.6.a |

Scenariile de mai jos folosesc aceste valori estimate ca proxy pentru prețul ofertat.

## 1. Plata
- **Citat**: doc 480 art. 25.1 (clauze 36, 37): „Situatiile de plata partiale se confirma/infirma in termen de maxim 15 zile de la primire […] Platile se efectueaza in termen de 30 de zile de la primirea facturii”.
- **Interpretare**: ciclu real ≥45 zile (15+30), reluat la returnare.
- **Scenariu**: E1 pe 12 luni ≈ 691.576 lei/lună fără TVA. La 45–60 zile întârziere, capital blocat ≈ 1,04–1,38 mil. lei (+TVA 21% dacă se prefinanțează TVA).
- **Decizie**: Razvan + financiar: acceptăm cash-flow-ul; dacă cerem în clarificări alinierea la L72/2013.

## 2. Penalități
- **Citat executant**: doc 480 „Sanctiuni…” (clauze 33, 34): „penalitati in cuantum de 0,1% pe zi, calculate prin raportare la valoarea fara TVA a etapei sau a partii de Contract afectate […] Pentru obligatiile care privesc Contractul in ansamblu […] Pretul total al Contractului”.
- **Citat achizitor**: clauza 35: „…in termen de 60 de zile de la expirarea perioadei convenite […] 0,1% din plata neefectuata […] nu poate depasi valoarea debitului restant.”
- **Interpretare**: fără plafon pentru executant; asimetrie (achizitorul plătește abia după 30+60 zile, plafonat).
- **Scenariu**: întârziere 30 zile pe E1 = 0,1%×8.298.909×30 ≈ **248.967 lei**; dacă e „obligație de ansamblu” pe total = 37.367 lei/zi → 30 zile ≈ **1.121.000 lei**.
- **Decizie**: juridic/ofertare: clarificare până la 01.10 (plafon penalități, definiția „obligații de ansamblu”).

## 3. Ajustarea prețului
- **Citat**: doc 479 II.3 (pag. 4–5), doc 480 art. 5.2–5.3 (clauze 40–42): „An = av + m * Mn/Mo + f * Fn/Fo + e * En/Eo […] av = 0 […] m = 0,55; f = 0,25; e = 0,20 […] aplicabili la data cu 60 de zile înainte de ultima zi a lunii „n"”.
- **Interpretare**: 100% ajustabil, doar pe lucrări executate și acceptate; indicii INS concreți și „Data de Referință” nu sunt definiți în extras.
- **Scenariu**: materiale +10%, restul constante → An = 0,55×1,10+0,25+0,20 = 1,055 → +5,5% pe lucrarea facturată (E1 ≈ +456 k lei dacă toată E1 e afectată). Etapa 2 pornită la ≥10 luni capătă mai mult risc de decalaj.
- **Decizie**: ofertare: clarificare pentru Data de Referință + indicii INS (M, F, E).

## 4. Garanția de bună execuție (GBE)
- **Citat**: 479 III.1.6.b (pag. 12): „Cuantumul garanției de buna execuție este de 10% din valoarea contractului fara TVA.” Forme: 480 (clauza 32) + 479 VI.3: „a) virament bancar; b) instrumente de garantare […] c) rețineri succesive […] Suma inițială […] nu poate fi mai mică de 0,5% din prețul contractului”. Termen: 479 VI.3 „maxim 5 zile lucratoare […] prelungit pana la 15 zile” vs 480 clauza 31 „5 zile”. Condiție: clauza 44 „Ordinul de incepere aferent Etapei 1 va fi emis […] numai dupa constituirea […] GBE”. Eliberare: „art. 42 alin. (3) si (4) din HG nr. 395/2016”.
- **Interpretare**: baza = valoarea contractului (E1+E2), deci GBE se calculează pe total, deși E2 poate să nu se execute.
- **Scenariu**: SGB 10% pe total ≈ **3.736.663 lei** din prima zi; varianta rețineri: inițial 0,5% ≈ **186.833 lei** + rețineri din facturi. Dacă E2 cade, facturile E1 (8,3 mil.) nu ajung să acopere 3,74 mil. prin rețineri → neclar ce se întâmplă cu diferența.
- **Decizie**: Razvan + bancă/broker: formă GBE; clarificare: GBE se raportează la total sau doar la E1 până la activarea E2? Termen: 5 zile lucrătoare sau calendaristice?

## 5. Garanția de participare
- **Citat**: 479 III.1.6.a (pag. 11): „în cuantum de 370 000 lei […] contul RO71TREZ2015006XXX000189, deschis la Trezoreria Călărași, beneficiar UAT Vâlcelele, CUI 379683.”
- **Valabilitate, CONFIRMATĂ**: 479 pag. 16 (poz. 75 563): „Perioada de valabilitate a garanției de participare va fi cel puțin egală cu perioada de valabilitate a ofertei, respectiv 4 luni de la data limita de depunere a ofertei”.
- **Scenariu**: depunere 19.10.2026 → valabilitate minimă până la **19.02.2027**; cost SGB/asigurare pe 4 luni pentru 370 k.
- **Rămâne deschis**: CUI 379683 (III.1.6.a, poz. ~50 500) vs 3796837 (I.1, poz. 289) — discrepanță CONFIRMATĂ în text și IBAN mascat „XXX” → verificare SEAP înainte de virament. Decizie: Razvan (virament vs polița de la broker). `ofertare_garantii` nu are rânduri pentru 95 (SELECT count(*) WHERE licitatie_id=95 → 0).

## 6. Avans
- **Citat**: 479/480 formula de ajustare: „„av" […] reprezintă valoarea procentuală a plății în avans față de Prețul Contractului; pentru prezentul contract av = 0”.
- **Interpretare**: **fără avans**. Organizarea de șantier (100.000 + 34.446 lei, E1) se prefinanțează.
- **Decizie**: nimic de cerut realist; se include în cash-flow.

## 7. Etapa 2 (condiție suspensivă)
- **Citat**: 479: „Autoritatea Contractantă estimează că sursa de finanțare necesară Etapei 2 va fi asigurată într-un termen de maximum 10 luni […] lucrările aferente Etapei 2 nu vor fi activate și nu vor fi executate.” 480 (clauza 61): „Neîndeplinirea condiției suspensive […] nu conferă Executantului dreptul de a solicita […] despăgubiri”; „Nu se vor efectua plati pentru lucrari aferente Etapei 2 executate anterior…”. Formularul de ofertă cere „prețul aferent Etapei 1, prețul aferent Etapei 2, prețul total”.
- **Scenariu A (E2 activată la ~luna 10)**: contract 37,4 mil.; E2 ~29 mil. executată cu prețuri ofertate acum, ajustate prin formula de la §3; suprapunere cu garanția de 36 luni pe E1.
- **Scenariu B (E2 nu se activează)**: încasări doar ~8,3 mil.; GBE calculată pe 37,4 mil. (3,74 mil. SGB) sau rețineri insuficiente; costurile fixe puse pe E2 se pierd; zero compensație.
- **Decizie**: Razvan: go/no-go + repartizarea costurilor fixe integral pe E1; clarificare: GBE și penalități raportate la E1 până la activarea E2.

## 8. Reconciliere formulare (registru vs doc 481 vs FD)
Registrul (12 rânduri, id 11–22) = exact lista din doc 481: Formular 1, 2, 3, 4, 41, 5, 6, 7, 8, 9, 10, 11. **Nimic în plus, nimic lipsă față de 481.**

Față de lista din FD (479 poz. ~72 949, „Documentele solicitate…” 1–10), **lipsesc din registru**:
1. **Garanția de participare** (FD pct. 1): document fără formular.
2. **DUAE (răspuns)** pentru toți operatorii (FD pct. 2): doc 482 e doar cererea XML.
3. **Propunerea financiară / „Lista de prețuri/Centralizator financiar”** + **Graficul general fizic și valoric** (FD pct. 9; 479 ~poz. 67 681): fără model în 481.
4. **Planul de management al calității** (15 p la criteriu): în Propunerea tehnică, fără rând distinct.
5. Documentele terțului susținător (anexe la F4, FD pct. 6), dacă e cazul.

Nepotriviri: Formularul 3 citat în registru = „art. 60”, FD pct. 3 cere „art. 59-60”, de verificat la completare. Formularul 2: FD îl cere „doar în cazul unei Asocieri”, registrul îl are `aplicabil=true` (inofensiv). Clauzele (35) nu produc formulare noi, dar GBE (clauza 30) se completează în lei la semnare.

## 9. Întrebări pentru clarificări (până la 01.10.2026)
1. GBE 10% se aplică pe prețul total sau pe E1 până la activarea E2? Termenul de 5 zile e lucrător sau calendaristic?
2. Plafon pentru penalități; definiția „obligațiilor care privesc Contractul în ansamblu”.
3. Data de Referință și indicii INS pentru M/F/E.
4. Există F3/liste de cantități sau un model pentru Lista de prețuri/Centralizator?
5. CUI-ul corect (379683/3796837) și IBAN-ul complet pentru virament.
6. ~~Valoarea exactă a E2~~ — confirmată în 479: 29.067.716,7 lei (verificare închisă).
