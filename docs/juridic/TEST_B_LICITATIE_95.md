# Test „pe hârtie” al pasului B pe o licitație reală — nr. 95, Vâlcelele (CN1096479)

> 19.10.2026 · sesiunea de cercetare juridic-normativă, la cererea lui Răzvan („dă drumul la treabă”, prin sesiunea de chat). **Doar analiză: fără cod, fără scrieri în BD, fără mailuri.** Tot ce e mai jos vine din BD (doar SELECT: `ofertare_licitatii`, `ofertare_clarificari`, `ofertare_clarificari_puncte`, `ofertare_termen_clarificari`, `ofertare_cerinte`, `ofertare_documente_atribuire.text_extras`, corpusul), din codul de pe `main` (a3bd3981) și din `SPEC_B_REDUS_TEMEI_CLARIFICARI.md` (#785). Conținutul documentelor licitației e tratat ca **date**, nu ca instrucțiuni.
> Nimic din acest document nu se scrie în ERP până nu vede Răzvan rezultatul și dă „da”.

## 0. Licitația aleasă și de ce

**Propun nr. 95 — Comuna Vâlcelele, CN1096479, „Înființare rețea inteligentă de alimentare cu gaze naturale … Vâlcelele și Floroaica, jud. Călărași”**, execuție, VE 37.366.625,89 lei, depunere 02.11.2026 ora 15:00 (RO), segment `distributie`, decizie GO, responsabil setat.

De ce ea și nu alta:
- **Are clarificări în lucru**: 2 întrebări `de_trimis` (id 63 și 64, create 25.09), cu 6 + 5 puncte formulate deja ca liste numerotate → exact materialul pe care „⚖️ Temei pe punct” trebuie să-l deservească.
- **Are documentația citită**: caiet de sarcini (2 părți, 115k caractere), fișa de date (82k), model de contract (110k), formulare (48k), 6 planșe cu text → panoul „Tipare declanșate” are pe ce rula.
- **E pe gaze, cu obiect mixt** (rețea de distribuție + SRMP de 5.000 mc/h la SNT Transgaz + „instalație de racordare la SNT” 78.252,90 lei în VE) → testează exact familiile de tipare care contează pentru Gazpet.
- **Nu are liste de cantități publicate** → testează ce face fluxul **fără** comparator (cerința explicită din brief).

Alternativele, respinse pentru test: nr. 3 Mânăstirea (cazul cunoscut, dar 473 de documente și 25 de clarificări → un test prea greu de citit; rămâne al doilea test), nr. 15 Răcari (termen 26.10, clarificările trimise, caz de comparator care nu există încă), nr. 102/101 Transgaz (0 clarificări, 0 cerințe extrase).

**Avertisment de calendar, găsit în test (de verificat cu responsabilul):** fișa de date (doc 479, p. 1) spune „număr zile până la care se pot solicita clarificări înainte de data limită: **18**” → termenul pentru întrebări a fost **15.10.2026**; răspunsul consolidat al AC vine „cel târziu cu 11 zile înainte” → **22.10.2026**. Cele două clarificări sunt încă `de_trimis` în ERP. Ori au plecat în SEAP fără să fie marcate, ori fereastra a fost ratată. Separat, AC a publicat pe 07.10 „Clarificare_Oficiu_Automata_CN1096479.pdf” (doc 1626, din oficiu), **neprocesat** în ERP: nu știm ce a lămurit AC singură. Nu există rând în `ofertare_termen_clarificari` pentru 95, deși termenul e derivabil din fișa de date.

## 1. Fluxul existent, rulat pe hârtie

### 1a. „Tipare declanșate” — codul de azi (11 tipare detectabile, fraze între ghilimele din `trigger.semnal`)

Rulat exact ca `tipareDeclansate()` (normalizare fără diacritice, limite de cuvânt, doar documentele din `unde_cauti`). **Un singur tipar se declanșează:**

| Tipar | Fraza | Unde | Context real | Verdict |
|---|---|---|---|---|
| PAT-GAZ-15 (instalații de utilizare incluse neclar) | „racordarea consumatorilor” | CS doc 1276 | „…crearea condițiilor tehnice necesare pentru racordarea consumatorilor la rețeaua de gaze naturale…” (text narativ din descrierea investiției) | **fals pozitiv pe frază**, dar tiparul merită verificat uman: fișa de date cere instalatori „EGD **și/sau EGIU**” (EGIU = instalații de utilizare), iar CS vorbește de „instalații de utilizare exterioare subterane” la răsuflători → nu e clar dacă IU intră în obiect. Rămâne în „de verificat”, nu în întrebare. |

Concluzia 1a: pe o licitație reală de gaze, detecția de azi produce **1 semnal, și acela ambiguu**. Confirmă cifra din spec (11/119 detectabile) și motivul (semnalele nu sunt scrise pentru mașină).

### 1b. Frazele propuse în spec §2 (cele 20 de tipare), marcate separat

Rulate pe toate documentele cu text (CS, FD, contract, formulare), cu condițiile de excludere din spec aplicate manual:

| Tipar | Ce s-a potrivit | Verdict după condițiile din spec | Ce arată despre fraze |
|---|---|---|---|
| PAT-GAZ-10 (obiect mixt racord SNT/SRM + distribuție) | CS: „SRMP-SNT Transgaz”, „se va racorda la SRMP-ul SNT Transgaz cu capacitatea de 5.000 mc/h”, „rețea … înaltă și medie presiune”; FD: „4.1.2. instalație de racordare la SNT 78.252,90” + „rețea de distribuție” | **ADEVĂRAT POZITIV.** FD cere doar instalatori EGD/EGIU + RTE 8.4 (cerințele 6380, 6381); **nu cere nicio autorizație ANRE de firmă** (nici EDSB, nici ET/PT), deși CS descrie SRMP la SNT și tronson de „înaltă … presiune” | perechea „(srmp sau snt) și (rețea de distribuție)” funcționează; de păstrat |
| PAT-STD-15 (regim de transport tratat ca distribuție) | CS: „SNT” ×3, „NTPEE” ×13, fără „118/2013”, fără „clasa de locație” | **ADEVĂRAT POZITIV, slab**: instalația de racordare la SNT e în VE (78 mii lei), dar e mică; CS aplică NTPEE peste tot. De clarificat cine execută racordul la SNT (Transgaz sau executantul) | perechea funcționează; avertizarea trebuie să spună „verifică dacă racordul e în obiect” |
| PAT-AMB-02 (factor de evaluare nedefinit) | FD: „factorul tehnic privind planul de management al calității” cu calificative „parțial relevant 5 p / bine-adecvat 10 p / foarte bine 15 p” | **ADEVĂRAT POZITIV (review juridic)**: punctajul pe calificative subiective, fără algoritm obiectiv (HG 395 art. 32 alin. (2)) | „adecvat” singur dă 4 potriviri, din care 3 false; e util doar lângă „factor”/„calificativ” |
| PAT-CTR-01 (aceeași cerință cu valori diferite în DA) — găsit prin citire, nu prin frază | FD II.2.5: factori = preț 85 p + plan calitate 15 p; FD IV.4.1 (cerințele 6413, 6414): „în vederea aplicării **factorului de evaluare „experiența experților cheie”**, ofertantul va nominaliza … manager de proiect … și șef/coordonator/director proiect” | **ADEVĂRAT POZITIV**: FD descrie un factor de evaluare care nu există în criteriul de atribuire. Risc: nominalizezi experți pentru un factor care nu punctează, sau comisia îl aplică fără să fie în II.2.5 | nu există frază pentru asta; e „comparatie_documente” (II.2.5 vs IV.4.1) — de pus în regula pe `ofertare_cerinte` (două cerințe `propunere` cu „factorul de evaluare” fără corespondent în `criteriu`) |
| PAT-GAZ-01 (treapta de presiune contradictorie) — citire | CS cap. 4: etapa 1 „înaltă și medie presiune” + „PE 100 SDR 11 Dn 200 … Dn 160”; NTPEE: PE doar ≤ 6 bar (`REQ-TG-053`, `REQ-TG-055`) | **ADEVĂRAT POZITIV (judecată umană)**: „înaltă presiune” cu țeavă PE e o contradicție; fie e „medie” scris greșit, fie tronsonul SRMP→UAT e oțel și lipsește din text | tiparul e `comparatie_documente`; nu se prinde din cuvinte-cheie |
| PAT-CTC-08 (finanțare condiționată) — citire | FD II.1.4 + contract: „etapa 2 … supusă condiției suspensive privind asigurarea sursei de finanțare”; finanțare „Anghel Saligny + buget local”; etapa 2 = 29,07 mil. din 37,37 mil. | **ADEVĂRAT POZITIV (review juridic)**: 78 % din contract e sub clauză suspensivă, fără termen, fără despăgubire în textul citit | frazele din spec („clauză suspensivă”, „Anghel Saligny”) l-ar fi prins; nu erau în lista din §2 pentru CTC-08 — de adăugat |
| PAT-INF-12 (liste de cantități cerute, nepublicate) | CS cap. 5: „…proiect tehnic, detalii de execuție, memoriu tehnic, caiete de sarcini, **liste de cantități**…” puse la dispoziție; în SEAP nu există niciun `lista_cantitati`; FD cere „Lista de prețuri/Centralizator” fără model | **ADEVĂRAT POZITIV** — e deja punctul 5 din clarificarea 63 | „liste de cantități” + regula de absență (niciun document `lista_cantitati`) = detecție deterministă bună |
| PAT-GAR-03 (perioada de garanție / categoria de importanță) | contract: „36 luni perioadă de garanție a lucrărilor”; FD 6407 „minim 36 luni”; fără „categoria de importanță” / „clasa de consecințe” nicăieri | **slab**: 36 de luni ≥ minimul legal pentru CC2 (`REQ-AD-142`); nu e de întrebat | fraza „perioada de garanție” singură e zgomot (×17 apariții); contează doar absența categoriei |
| PAT-CAL-11 (sudori ISCIR vs EN) | CS: „îmbinările prin sudură se execută numai de sudori autorizați ISCIR” (PE cap la cap) | **fals pozitiv ca problemă**: pentru PE, autorizația ISCIR PEHD **este** cerința legală (`REQ-TG-106`, `REQ-TG-121`, PT CR 9-2025); CS e corect. Doar PAT-CTR-04 ar putea întreba dacă e cerință de calificare (nu e în FD) | STD-09 („iscir” lângă „conductă”) a prins greșit: ISCIR pe sudori PE e legitim; excluderea trebuie să fie „sudori” |
| PAT-GAZ-14 | CS: „detalii de execuție” — în lista documentelor **puse la dispoziție de AC** | fals pozitiv: fraza fără verb („va elabora…”) prinde enumerări | de păstrat doar frazele cu verb |
| PAT-CAL-05 | FD: „rețea de distribuție gaze” ×3 | fals pozitiv: ES e „rețea de distribuție gaze naturale **sau infrastructură similară ori superioară**” → nu e restrictivă | de cerut și „exclusiv”/„identic”/„în același contract” |
| PAT-CAL-07 | FD: „duse la bun sfârșit” | fals pozitiv: FD definește imediat („lucrări recepționate pe obiecte…”) → lista nu e închisă | condiția „listă închisă” din spec ține |
| PAT-AMB-13 | CS: „proiectare și execuție” (în „normele tehnice de proiectare și execuție … NTPEE”) | fals pozitiv: nu e contract P+E | perechea trebuie să ceară „contract de proiectare și execuție” |
| PAT-CTR-04 | FD: „ofertantul va face dovada” (conformitatea propunerii tehnice) | fals pozitiv: e în FD, nu doar în CS | condiția „în CS și absent din FD” ține |
| PAT-TRM-06 | FD: „graficul Gantt” ×2 | fals pozitiv: Gantt cerut simplu, pe etape; nicio perioadă nefavorabilă | de scos „graficul gantt” din lista TRM-06 |
| PAT-GAR-01 | FD: „în original” (documente străine), calcul GP 370.000 / 37.366.625,89 = **0,99 %** ≤ 1 % | fals pozitiv pe frază; calculul e curat | „în original” singur e zgomot; calculul GP funcționează |
| PAT-AMB-08 | formulare: „conform documentației de atribuire”, „respectă legislația” | fals pozitiv: nu e răspuns al AC | tiparul rulează DOAR pe `raspuns_clarificare` (cum era în spec) |
| PAT-CAL-01, STD-08, CAL-04, CAL-15, AMB-11, STD-01 | nimic | corect: FD nu citează Ord. 132/2021, nu are terminologie veche, nu cere ANRE la manager, nu cere „proceduri pentru toate categoriile”, CS trimite probele la NTPEE-2018 fără „24 h” | — |

**Bilanț 1b:** 7 adevărat pozitive (din care 4 găsite prin citire, nu prin frază), 10 false pozitive pe frază, toate explicabile prin condițiile deja scrise în spec. Două lecții noi pentru `trigger.fraze`: (1) frazele fără verb sau prea generice („perioada de garanție”, „adecvat”, „graficul gantt”, „în original”) nu intră singure, doar în perechi; (2) **cea mai bună detecție de pe licitația asta e pe cerințele extrase** (`ofertare_cerinte.text_cerinta`, 67 de rânduri curate), nu pe cele 115k caractere de CS: CTR-01 (factor fantomă), CAL-01/GAZ-10 (fără autorizație de firmă), GAR-01 (calcul) ies toate din `ofertare_cerinte` + `ofertare_licitatii`.

### 1c. Ce ar fi fost de întrebat și nu s-a întrebat (semnale noi față de clarificările 63 și 64)

Patru puncte pe care fluxul le-ar fi propus **în ziua citirii (25.09)**, înainte de termenul din 15.10:

1. **Autorizarea ANRE a firmei și regimul de presiune** (PAT-CAL-01 + PAT-GAZ-10 + PAT-GAZ-01): FD nu cere autorizație de firmă; CS descrie SRMP la SNT și tronson „înaltă și medie presiune” în PE. Întrebare: treapta de presiune pe fiecare tronson, cine execută racordul la SNT și SRMP-ul, ce tipuri de autorizare ANRE (EDSB / ET) se verifică și la cine (ofertant, asociat, subcontractant).
2. **Factorul „experiența experților cheie”** (PAT-CTR-01 + PAT-AMB-02): FD IV.4.1 îl descrie, II.2.5 nu-l are. Întrebare: se aplică sau nu, cu ce punctaj, și dacă nominalizarea celor doi experți e obligatorie.
3. **Calificativele factorului tehnic** (PAT-AMB-02): „parțial relevant / bine-adecvat / foarte bine” fără criterii obiective de departajare.
4. **Clauza suspensivă pe etapa 2** (PAT-CTC-08): termenul până la care se poate îndeplini condiția, ce se întâmplă cu oferta și garanția de participare după acel termen, despăgubiri. **Atenție:** după BO2026_2006 (menținută în instanță) o clauză suspensivă necontestată în termen leagă ofertantul; termenul de contestare a DA (10 zile, VE > 26.960.556 lei) a trecut pe ~24.09. Rămâne doar clarificarea, nu contestația.

Punctul 1 e singurul cu risc de calificare pentru noi (ce autorizație ni se va cere de fapt la evaluare); 2–4 sunt de preț/risc contractual.

## 2. Temeiul pe fiecare punct de clarificare (regula din spec §1, cu citarea §3)

Convenții: **N** = cerință normativă (`norme_cerinte`, toate `verificat_pe_sursa = true`), **D** = decizie CNSC după ordonarea din spec (familie gaze, L98 presupus — `regim_achizitie` e NULL, dar FD citează Legea 98/2016), **T** = tipar. „Exportabil” = are citat cu pagină + link (formatul §3). Max 3 temeiuri pe punct, decizia doar dacă e exportabilă sau dacă e cea mai apropiată și omul o vrea ca referință.

### 2a. Clarificarea 63 (nr. 1) — lungimile rețelei și lista de prețuri (origine `automat`, cheie `auto_planse_1`)

| Pct. | Subiect (din text) | Tip punct | T | Temeiuri propuse (1–3) | Ce lipsește azi |
|---|---|---|---|---|---|
| 1 | 44,355 km total vs 11,525 + 32,830 km pe etape | cantitate, fără F3 → contradicție între documente | PAT-CTR-01 (în lipsa F3: nu PAT-CTR-02) | **N** `REQ-AD-010` HG 395/2016, art. 20 alin. (2) — DA trebuie să conțină orice informație necesară unei informări complete, corecte și explicite · **N** `REQ-AD-123` HG 907/2016, Anexa, Secț. V, Formularul F3, Precizări — proiectantul răspunde de cantități · **D** Decizia CNSC nr. 2328/C5/1924 din 17.07.2026 (distribuție, L98, control judiciar necunoscut), p. 15 — exportabilă, dar citatul ei e despre cerințe de calificare în CS, nu despre cantități → **doar referință, nu în adresă** | comparatorul (ar fi dat `rol_b = cs` vs `memoriu` vs `plansa` cu Δ) nu are F3 pe care să se sprijine |
| 2 | diametrele Dn 200 / 160 / 40 pe etape, „29.555 mp” | cantitate (piese / diametre) | PAT-GAZ-02 | **N** `REQ-AD-123` (ca mai sus) · **D** BO2026_3104 (gaze, L98, fără nr. exact), p. 13: „va dispune reevaluarea ofertei câștigătoare prin verificarea conformității propunerii tehnice cu listele de cantități publicate în SEAP” — exportabilă, dar e despre obligativitatea listelor, nu despre lipsa lor → **referință** | — |
| 3 | tabelul „Dimensionare” din schema tehnologică vs 44.355 m; tronsoanele Dn 200 SRMP→UAT în obiect? | cantitate + obiect | PAT-GAZ-02 + PAT-GAZ-10 | **N** `REQ-AD-010` · **N** `REQ-P0-066` Ord. ANRE 7/2022, art. 5 alin. (3)–(4) — racordarea la conducte de înaltă presiune doar de titulari PT/ET · **D** BO2024_3232 (distribuție, L98, **menținută în instanță**, fără nr. exact), p. 25: „în cazul subcontractanților declarați pentru prestarea unor servicii/executarea unor lucrări care nu necesita o astfel de autorizare” — exportabilă; relevantă dacă SRMP/racordul se face prin subcontractant autorizat ET | — |
| 4 | nota de pe PL1: „54200mp”, UAT Vlad Țepeș 3200 mp | cantitate (planșă) | PAT-CTR-01 | **N** `REQ-AD-010` · nimic altceva: e o eroare de unitate, nu are practică | — |
| 5 | liste de cantități enumerate în CS, nepublicate; Lista de prețuri fără model | informație lipsă | **PAT-INF-12** | **N** `REQ-AD-125` HG 907/2016, Anexa PT, Secț. V, Notă — F1–F5 completate cu prețuri constituie devizul ofertei · **N** `REQ-AD-123` · **D** BO2020_2335 (apă-canal, L98, fără nr.), p. 24: „Ofertanții vor respecta listele de cantități așa cum sunt prezentate, fără a face modificări” — exportabilă, arată de ce listele trebuie publicate (sunt opozabile) | precedentul de pe tipar (BO2025_1138) e despre altceva (prețuri unitare la justificare) → filtrul `trigger.teme` din spec l-ar fi dat jos |
| 6 | CUI 3796837 vs „379683” la virament | formal | niciun tipar | **N** `REQ-AD-013` HG 395/2016, art. 36 alin. (4) — instrumentul se încarcă în SEAP până la termen; viramentul greșit = garanție neconstituită → riscul e al nostru, întrebarea e justificată | — |

### 2b. Clarificarea 64 (nr. 2) — GBE, penalități, ajustare, avans, VE pe etape (origine `manual`, cheie `r7_financiar_1`)

| Pct. | Subiect | Tip punct | T | Temeiuri propuse | Observații |
|---|---|---|---|---|---|
| 1 | GBE 10 %: pe total sau pe etapa 1; „5 zile lucrătoare … până la 15” (FD VI.3) vs „5 zile” (contract) | termen / garanție + contradicție | PAT-GAR-02 + PAT-CTR-01 | **N** `REQ-AD-021` Legea 98/2016, art. 154 alin. (3) — GBE ≤ 10 % din prețul contractului fără TVA · **N** `REQ-AD-094` HG 1/2018, Anexa 1, cl. 15.1 — 10 % constituită în 5 zile lucrătoare de la semnare (**doar ca reper**: contractul Vâlcelele nu e pe modelul HG 1/2018, are articole proprii 5.3 / 27 / 31; aplicabilitatea HG 1/2018 e de verificat de om) · **D** nr. 2294/C4/2851 din 07.08.2025 (apă-canal, **L99**), citat cu `loc` = „concluzie”, **fără pagină → neexportabilă**; și e despre rețineri din plăți, nu despre GBE pe etape → nu se propune | contractul permite și rețineri succesive (lit. c) → PAT-GAR-05 nu se declanșează (nu există Sume Reținute separate) |
| 2 | penalități 0,1 %/zi pe etapă sau pe total; plafon; periodicitatea penalităților AC | contract | PAT-CTC-03 | **N** `REQ-AD-096` HG 1/2018, Anexa 1, cl. 36.4 — în lipsa unei valori, penalitatea pe zi = Preț / Durată, plafon 15 % (reper, vezi nota de mai sus) · **N** `REQ-AD-010` · fără decizii (tiparul are 0 precedente) | — |
| 3 | formula An = av + m·Mn/Mo + f·Fn/Fo + e·En/Eo fără data de referință și fără indicii INS | contract (ajustare) | **PAT-CTC-01 + PAT-CTC-02** | **N** `REQ-AD-078` Legea 98/2016, art. 222^2 alin. (2)–(3) — ajustarea se prevede în DA și în contract **cu modul concret, indicii și sursa lor** (cel mai tare temei de pe toată licitația) · **N** `REQ-AD-079` art. 222^2 alin. (9) — obligatorie la lucrări peste 6 luni (aici 12 luni) · **D** BO2023_406 (lucrări generale, L98, fără nr. exact), p. 10: „o formulă de calcul concepută expres pentru contracte aflate deja în derulare, eroare care pune în pericol posibilitatea de ajustare viitoare a prețului contractului” — exportabilă, relevantă doar dacă AC ar trimite la OUG 64/2022 (nu o face în textul citit) → **referință** | precedentul CTC-01 (BO2024_2692) are citatele fără pagină → neexportabil |
| 4 | av = 0 → fără avans? | contract | PAT-CTC-04 | **N** `REQ-AD-098` HG 1/2018, Anexa 1, cl. 46.6 (reper) · altfel nimic: e confirmare | — |
| 5 | VE etape: 8.298.909,16 + 29.067.716,70 = 37.366.625,86 ≠ 37.366.625,89 | informație (VE) | PAT-INF-11 | **N** `REQ-P0-054` HG 395/2016, art. 137 alin. (2) — oferta peste VE e inacceptabilă (de aceea contează valoarea exactă pe etapă) · **D** nr. 3154/C8/3406 din 07.11.2024 (gaze, L98): defalcarea VE pe componente din FD e opozabilă — **citatele în format vechi, fără pagină → neexportabilă**, referință | diferența e de 3 bani; punctul e corect, dar „utilă”, nu „importantă” |

### 2c. Punctele noi din §1c (dacă s-ar fi creat la 25.09)

| Punct nou | T | Temeiuri | Exportabile |
|---|---|---|---|
| Autorizare de firmă + presiune + racord SNT | PAT-CAL-01 (review), PAT-GAZ-10 (review), PAT-GAZ-01 | **N** `REQ-TG-001` Legea 123/2012, art. 121 alin. (1) — operatorii care execută obiective din sectorul gazelor dețin autorizație ANRE · **N** `REQ-TG-008` Ord. ANRE 17/2026, art. 1 alin. (3)–(4) — tipul după obiectiv și regim de presiune · **N** `REQ-TG-053` NTPEE art. 19 alin. (1) (treptele) + `REQ-TG-055` art. 20 alin. (2) (PE doar ≤ 6 bar) · **D** BO2026_1360 (distribuție, L99, necunoscut), p. 29: „Niciunde în documentația de atribuire nu a fost prevăzută cerința de a fi prezentată în cadrul ofertei autorizația ANRE” — exportabilă; **favorabilă nouă**: comisia nu poate respinge pentru o autorizație necerută în DA · **D** BO2024_3232, p. 25 (mai sus) | da (2) |
| Factorul „experiența experților cheie” inexistent în II.2.5 | PAT-CTR-01, PAT-AMB-02 (review) | **N** `REQ-P0-046` HG 395/2016, art. 32 alin. (2), (8)–(9) — factorii și algoritmul se precizează clar în DA · **N** `REQ-P0-043` art. 32 alin. (4)–(5) — personalul punctat nu poate fi și criteriu de calificare · **D** nr. 1837/C1/1961 din 01.07.2025 (gaze, L98), p. 53–54: factor pe noțiuni nedefinite → anularea procedurii | da |
| Calificativele factorului tehnic | PAT-AMB-02 (review) | aceleași norme; **D** nr. 3657/C1/4067, 4182 din 23.12.2024 (gaze, L98), p. 19 | da |
| Clauza suspensivă etapa 2 | PAT-CTC-08 (review) | tiparul **nu are `normative_refs`** (0) → doar **D** BO2026_2006 (gaze, L99, **menținută**), p. 5: „Prin necontestarea ei și depunerea ofertei” și p. 6: „singura posibilitate pe care o avea aceasta era aceea de anulare a procedurii de atribuire” — exportabilă, dar e un avertisment pentru noi, nu un argument către AC | da, dar de folosit intern |

**Formatul în care ar ieși în adresă** (din `formatCitare`, neschimbat), pentru cele două decizii pe care le-aș include efectiv:
- `Decizia CNSC nr. 2328/C5/1924 din 17.07.2026, p. 15 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=MmFiMzg0N2UtMzM5Mi00OGVlLTg0YmQtMjc5MWU0OGRkMjVl&pdfa1=ZmFsc2U=&filename=Qk8yMDI2XzIzMjgucGRm&action=aW5saW5l: „autoritatea contractantă nu poate introduce mascat cerințe de calificare și selecție în cadrul caietului de sarcini”` (doar dacă AC ar invoca ISCIR/autorizări din CS la evaluare).
- `Decizia CNSC publicată în BO nr. BO2026_1360 (nr./data anonimizate), p. 29 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=NWEzMDI5MDMtOGQ2Mi00NGIxLWJiN2UtZGFjNzRjN2UzMGM2&pdfa1=ZmFsc2U=&filename=Qk8yMDI2XzEzNjAucGRm&action=aW5saW5l: „Niciunde în documentația de atribuire nu a fost prevăzută cerința de a fi prezentată în cadrul ofertei autorizația ANRE”` (avertisment: decizie pe L99, licitația e pe L98 — se citează cum e, cu nota existentă din UI).

Pentru **norme** exportul de azi **blochează** adresa (acceptă doar decizii) — rămâne propunerea din spec §3.

## 3. Ce ar crea un om în UI, rând cu rând

### 3a. Rânduri în `ofertare_clarificari_temeiuri` (azi tabelul are 0 rânduri în toată BD)

Toate cu `sursa = 'manual'` (nu există punct cu tipar atașat din care să vină „propus”), `confirmat = true`, `include_in_adresa = false` (decizia pe „adresă” e separată, și pentru CAL/GAZ-10/AMB-02/CTC-08 doar owner). Ținta = `clarificare_id` (63 / 64), pentru că **`ofertare_clarificari_puncte` are 0 rânduri**: întrebările nu sunt descompuse în puncte. Dacă omul creează întâi cele 11 puncte (6 + 5), țintele devin `punct_id` și lista de mai jos se distribuie pe ele.

| # | Țintă | Tip temei | Valoare | Citat (idx) | Notă internă |
|---|---|---|---|---|---|
| 1 | 63 | tipar | PAT-CTR-01 | — | pct. 1, 4 |
| 2 | 63 | tipar | PAT-GAZ-02 | — | pct. 2, 3 |
| 3 | 63 | tipar | PAT-INF-12 | — | pct. 5 |
| 4 | 63 | cerință | REQ-AD-010 | — | pct. 1, 3, 4 |
| 5 | 63 | cerință | REQ-AD-123 | — | pct. 1, 2, 5 |
| 6 | 63 | cerință | REQ-AD-125 | — | pct. 5 |
| 7 | 63 | cerință | REQ-P0-066 | — | pct. 3 (racord înaltă presiune) |
| 8 | 63 | decizie | CNSC-BO2020_2335 | 0 (p. 24) | pct. 5 — listele publicate sunt opozabile |
| 9 | 63 | decizie | CNSC-BO2024_3232 | 0 (p. 25) | pct. 3 — subcontractant autorizat pentru partea de SRMP |
| 10 | 64 | tipar | PAT-CTC-01 | — | pct. 3 |
| 11 | 64 | tipar | PAT-GAR-02 | — | pct. 1 |
| 12 | 64 | tipar | PAT-CTC-03 | — | pct. 2 |
| 13 | 64 | cerință | REQ-AD-078 | — | pct. 3 — temeiul principal |
| 14 | 64 | cerință | REQ-AD-079 | — | pct. 3 |
| 15 | 64 | cerință | REQ-AD-021 | — | pct. 1 |
| 16 | 64 | cerință | REQ-AD-096 | — | pct. 2 (reper HG 1/2018) |
| 17 | 64 | cerință | REQ-P0-054 | — | pct. 5 |
| 18 | 64 | decizie | CNSC-BO2023_406 | 0 (p. 10) | pct. 3 — doar dacă AC trimite la OUG 64/2022 |

18 rânduri, **0 bifate „include în adresă”** la acest moment: clarificările sunt întrebări de lămurire, nu contestații; practica se scoate în adresă doar dacă răspunsul AC e evaziv (treapta „Răspuns neconcludent?” din spec §5). Trigger-ul din BD va rescrie `citat_loc` și va verifica `citat_text` pentru rândurile 8, 9, 18.

### 3b. Rânduri din „Tipare declanșate” → „Creează întrebare din tipar”

Azi butonul ar fi creat **o singură ciornă** (PAT-GAZ-15, cu `origine = tipar`, `sursa = tipar:PAT-GAZ-15`), și aceea falsă. Cu frazele din spec + corecturile din §1b ar fi creat 3–4 ciorne (GAZ-10, AMB-02, CTC-08, INF-12), din care INF-12 era deja pct. 5 din clarificarea 63. **Nu propun crearea lor acum**: termenul pentru întrebări a trecut pe 15.10. Rămân ca intrări în fișa juridică a licitației (§5 din spec).

### 3c. Ce lipsește ca datele să fie complete

| Lipsă | Efect pe test | Cine o închide |
|---|---|---|
| `ofertare_licitatii.regim_achizitie = NULL`, `tip_procedura = NULL` la 95 | criteriul „legea” din ordonare e inactiv; deciziile pe L99 (BO2026_1360, BO2026_2006, 2294/C4) nu primesc avertismentul; `formatCitare` nu e afectat | date: FD citează Legea 98/2016 → `clasic`; procedura = licitație deschisă (CN) — preview → da Răzvan → apply |
| Niciun rând în `ofertare_termen_clarificari` pentru 95 | nimeni n-a văzut că termenul era 15.10; cele două clarificări au rămas `de_trimis` | registrul din #610 citește publicarea din SEAP; aici termenul e în FD („18 zile”) — de adăugat regula „din fișa de date” |
| Doc 1626 „Clarificare_Oficiu_Automata” (07.10) **neprocesat** | nu știm ce a lămurit AC din oficiu; poate acoperă pct. 5 / 6 sau factorul fantomă | citire (ingest) — cost mic, un PDF |
| Niciun document `lista_cantitati` | fluxul de cantități (comparator, PAT-CTR-02) nu are pe ce rula; punctele 1–4 rămân „contradicție între documente” | AC (pct. 5 din clarificarea 63) |
| `ofertare_clarificari_puncte` goală (0 rânduri, toată BD) | temeiurile se pun pe întrebare, nu pe punct; exportul le listează „la întrebarea 1”, fără punct | om (UI există) sau generatorul, când va produce puncte |
| Decizii **fără pagină** la citate printre cele propuse: BO2024_2692 (CTC-01), BO2024_3154 (INF-11), BO2025_1514 (CAL-07), BO2026_3118 / 3120 / 633 / 1408 / 2159 / 421 (GAZ-10, GAR-03, AMB-02, TRM-03) | regula din spec le ordonează sus (domeniu = distribuție), exportul le refuză → omul le vede ca „doar referință” | runda de corpus (owner): pagina pe fiecare citat (57 de decizii în total) |
| `nr_decizie` cu paranteză: BO2024_3155 (CAL-01, AMB-08) | ar ieși în adresă cu „(dedus: …)” | runda de corpus |
| `loc` fără pagină: 2294/C4/2851 („concluzie”) | neexportabilă deși are nr. exact | runda de corpus |
| `clarificari_tipare.trigger` fără `fraze` / `perechi` / `excluderi` / `teme`; PAT-CTC-08 fără `normative_refs` | 1b: 1 semnal din 11 tipare; precedente nepotrivite pe INF-12 și GAR-02 | date pe tipare (owner), după validarea pe încă 2 licitații (Mânăstirea, una Transgaz) |

## 4. Ce spune testul despre spec

- **Regula pe tip de punct ține**: fiecare din cele 11 puncte reale a primit un tipar și 1–3 temeiuri fără AI; norma a fost temeiul tare în 9 din 11 (ajustarea: art. 222^2 L98; cantități: HG 907 F3; GBE: art. 154 alin. (3)).
- **Deciziile sunt rareori „de adresă”** pe întrebări de lămurire: din 18 rânduri, 3 decizii, 0 incluse în adresă. Valoarea lor apare la răspunsul evaziv și la cerințele restrictive (§1c pct. 1), nu la întrebările de cantități.
- **Detecția trebuie mutată pe `ofertare_cerinte` + `ofertare_licitatii`** (text scurt, structurat), cu CS/FD ca a doua sursă: toate cele 4 semnale noi au ieșit de acolo.
- **Cel mai mare câștig pe licitația asta nu e juridic, e de calendar**: termenul pentru întrebări (15.10) a trecut cu două clarificări `de_trimis`. Registrul de termene trebuie să citească și fișa de date („N zile înainte”), nu doar publicarea din SEAP.

---

## Rezumat (pentru sesiunea de chat)

1. **Test pe nr. 95 Vâlcelele** (CN1096479, gaze, depunere 02.11, 2 clarificări `de_trimis` cu 11 puncte, documentația citită): fluxul de azi declanșează **1 tipar din 11, fals**; frazele din spec ar fi dat 7 adevărat pozitive (4 doar prin citire) și 10 false explicabile — iar semnalele bune ies din `ofertare_cerinte`, nu din caietul de sarcini.
2. **Temei pe punct**: toate cele 11 puncte au primit tipar + 1–3 temeiuri deterministe = **18 rânduri** de creat în `ofertare_clarificari_temeiuri` (3 tipare + 8 norme pe 63, 3 tipare + 5 norme pe 64, 3 decizii cu pagină), 0 „include în adresă”; lista exactă în §3a. Puncte: 0 rânduri în BD → țintele sunt întrebările.
3. **Găsite în plus, netrimise**: fără autorizație ANRE de firmă în FD deși obiectul are SRMP la SNT și „înaltă presiune” în PE (PAT-CAL-01/GAZ-10/GAZ-01), factor de evaluare „experți cheie” descris în IV.4.1 dar absent din II.2.5 (PAT-CTR-01), calificative subiective la factorul tehnic (PAT-AMB-02), 78 % din contract sub clauză suspensivă (PAT-CTC-08, BO2026_2006 menținută: necontestată = opozabilă).
4. **Problemă de calendar**: termenul pentru întrebări era **15.10** (FD: 18 zile), clarificările 63/64 sunt încă `de_trimis`; răspunsul AC vine până pe 22.10; „Clarificare din oficiu” din 07.10 e necitită. De verificat cu responsabilul dacă au plecat prin SEAP.
5. **Întrebări (A/B/C):** Q1 scrierea celor 18 rânduri: A) le creează omul din UI după acest tabel (recomand, e și testul real al UI); B) le scrie chat-ul cu preview; C) nimic până la un punct nou. Q2 regimul/termenul pe 95: A) completăm `regim_achizitie = clasic` + rând în termene din FD (date, preview) — recomand; B) doar nota. Q3 al doilea test: A) Mânăstirea (cazul cunoscut, 25 de clarificări, 4 propuneri netrimise) — recomand; B) o licitație Transgaz (102 sau 101, 0 clarificări → testează doar detecția); C) oprim după acest test.
