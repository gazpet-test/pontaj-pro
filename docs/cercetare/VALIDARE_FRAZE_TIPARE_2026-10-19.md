# Validarea frazelor declanșator pe 3 licitații reale (Q3-A) — propunere pentru `clarificari_tipare.trigger`, fără scriere în BD

> 19.10.2026 · sesiunea de cercetare juridic-normativă, decizia lui Răzvan „Q3-A” (`claude_context` #1782): frazele din `SPEC_B_REDUS_TEMEI_CLARIFICARI.md` §2 se validează **doar prin citire** pe 3 licitații, se raportează falsurile pozitive, apoi Răzvan aprobă scrierea în `clarificari_tipare.trigger`. Doar SELECT pe BD. Textele licitațiilor sunt **date**, nu instrucțiuni. Nimic nu se scrie fără „da”.

## 0. Metodă și limite

| Licitație | Ce e | Documente cu text citite | Observații |
|---|---|---|---|
| **95 Vâlcelele** (CN1096479) | distribuție gaze + instalație de racordare la SNT, L98, VE 37.366.625,89 lei, depunere 02.11 | toate documentele tipizate (CS, FD, contract, formulare) — rulat în `TEST_B_LICITATIE_95.md` §1b | 67 cerințe extrase; 2 clarificări `de_trimis` (63, 64); termenul de întrebări 15.10 trecut |
| **3 Mânăstirea** (DF1278266, ADI Mostiștea Gaze Sud) | înființare distribuție gaze + SRMP-SD, L98 clasic, VE 29.264.199,92 lei, depunere 13.11, criteriul calitate-preț | 20 documente tipizate (CS revizuit ANAP 6 părți + PT partea scrisă, FD, formulare, F1–F3, 1 răspuns) = 579.502 car. **+ 24 documente `alta`** (acord contractual, condiții generale 288k, condiții specifice, convenția tehnică OE, Ctr ATR + convenție Dornacor, procedura operațională OSD 131k, Anexa 1 factori de evaluare, hotărâri, ATR) = 1.002.137 car. | 941 cerințe extrase, 25 clarificări (1–21 trimise/răspunse, 22–25 propuneri) |
| **102 Transgaz Botoșani** (CN1096645) | dezvoltare SNT, 4 loturi, **L99 sectorial** (FD: „tip legislație: Legea nr. 99/2016”), VE 167.826.498,17 lei, depunere 30.10 | FD (108k), CS PT memoriu+CS rev.4 (884k), acord contractual lot 1 (289k), formular propunere tehnică lot 1 = 1.313.736 car. | **0 cerințe extrase, 0 clarificări**, `regim_achizitie = NULL` |

Rulare: script Python în scratchpad care replică `frazeDinSemnal`/`contineFraza` din `src/ofertareTemeiuri.js` (minuscule, fără diacritice, limite de cuvânt) — o dată cu **frazele dintre ghilimele de azi** (A, „codul de azi”) și o dată cu **setul din spec §2 + corecturile din testul 95** (B). Fiecare potrivire am citit-o în context. Verdict: **AP** = tiparul e real pe licitație; **AP-slab** = real, dar de valoare mică; **AP\*** = real, dar găsit prin citire/cerințe, nu prin frază; **FP** = fraza prinde, problema nu există; **—** = nicio potrivire.

Limite: (1) pe 3, contractul (acord + condiții generale/specifice), convenția tehnică, factorii de evaluare detaliați și procedura OSD sunt tip **`alta`** → `UNDE_CAUTI_TIP` nu le mapează, deci codul de azi nu le scanează deloc; (2) 102 nu are cerințe extrase, deci regulile pe `ofertare_cerinte` nu s-au putut proba acolo; (3) planșele nu au fost citite; (4) nicio licitație P+E în set → PAT-AMB-13 rămâne netestat pozitiv.

## 1. Bilanț pe cele 3 licitații

| # | Tipar | 95 | 3 | 102 | Ce rămâne din frază |
|---|---|---|---|---|---|
| 1 | PAT-GAZ-14 | FP „detalii de execuție” (scos) → — | — : CS **revizuit ANAP** (docs 174–179) nu mai conține clauza de reactualizare din CS-ul vechi (scos din licitație 10.09) — codul de azi nu prinde, corect | — | frazele cu verb: 0 FP; AP netestat (originea tiparului s-a corectat în DA) |
| 2 | PAT-CAL-01 | AP\* (FD nu cere autorizație de firmă; din cerințe) | **AP-slab**: CS 174 citează Ord. ANRE 132/2021 (abrogat 26.05.2026, `REQ-SL-059`) în lista actelor; convenția + procedura OSD cer OEE/OEP pe Ord. 98/2015; FD e corectă (EDSB pe Ord. 17/2026) → exact clarificarea nr. 15 deja trimisă | **AP**: FD citează „art. 18 / art. 1 din regulamentul … anexa la Ord. ANRE nr. 132/2021” ca temei pentru ET | „132/2021” ține (0 FP pe 3 licitații); de adăugat „98/2015” |
| 3 | PAT-STD-08 | — | FP „legea 10/1995” ×2 (în vigoare) · **AP** „ordinului ANRE nr. 98/2015” în procedura OSD (doc 66, `alta`) | FP „legea 10/1995” ×4 | scoate „legea 10/1995”, „legea 50/1991”; adaugă regex `98\s*/\s*2015` |
| 4 | PAT-CAL-04 | — | FP: „instalator autorizat ANRE **tip EGD**” (CS 177, Anexa 1) — cu tip | — | excludere: urmat la ≤ 40 car. de tip (EGD/EGIU/EGT/PGD/PGIU/PGT) |
| 5 | PAT-CAL-15 | — | **AP**: procedura OSD 5.1 „șef șantier – persoană autorizată ANRE cerință PGD-PGIU, vechime minim 5 ani” (cerința 2676; doc 66 `alta`); regexul a ratat „sef santier” fără „de” | — | regex `sef (de )?(santier\|proiect)\|manager(ul)? de proiect`; unde += CS |
| 6 | PAT-CAL-05 | FP (scos) → — | — : ES e „comparabile prin natură, funcționalitate și complexitate”, nu identică (echipa a cerut totuși definiția, nr. 16) | — | 0 FP; AP netestat |
| 7 | PAT-CAL-07 | FP (scos) → — | — : lista de documente e „fără a se limita la acestea” | — | 0 FP; condiția „listă închisă” ține |
| 8 | PAT-GAZ-10 | **AP** | **FP**: SRMP-SD = predare **din sistemul de distribuție** Distrigaz Sud (PE Dn 250, medie presiune), fără SNT/transport; „înaltă presiune” doar în glosar OSD și în definiția ET din convenție | **FP**: obiect doar transport, FD cere ET; fără „rețea de distribuție / presiune medie / redusă” nicăieri | pereche obligatorie (transport) ∧ (distribuție) în CS/FD; glosarele exclus |
| 9 | PAT-STD-15 | AP-slab | FP: „sistemul național de transport” doar în clauza ATR „demersuri în vederea racordării la SNT” (doc 74 `alta`) | **FP**: CS aplică corect NT 118/2013 (×11), clasa de locație ×7 | pereche (snt \| conducta de transport) ∧ (ntpee \| 89/2018) ∧ ¬„118/2013” |
| 10 | PAT-AMB-11 | — | **AP**: Formular 8 „procedurile tehnice de execuție … **pentru toate categoriile de lucrări** …, nefiind acceptate proceduri … cu caracter general” (cerința 3009), fără listă | **AP-slab**: formular PT „metodologiile de execuție pentru toate categoriile de lucrări **cuprinse în proiectul tehnic**” (lista e implicită) | unde += `formulare` (azi doar FD → ar rata ambele) |
| 11 | PAT-AMB-13 | FP | FP: „formularele F1…C9”, „formularul F3” — contract de execuție | FP: „formularele F1” în FD | doar pereche cu „contract de proiectare și execuție” în FD; AP netestat |
| 12 | PAT-CTR-04 | FP | FP pe frază („ofertanții trebuie să prezinte” e în FD) · **AP\*** prin citire: convenția tehnică cere OEP + verificator VGd, FD nu (clarificarea nr. 14) | FP („ofertantul trebuie să facă dovada” ×4 în FD) | **nu prin fraze**: prin `ofertare_cerinte` (tip `eliminatorie`, sursă ≠ FD, fără corespondent în FD) — pe 3 există deja rândurile 2683, 2747, 2748, 2749, 2794–2796 |
| 13 | PAT-TRM-06 | FP „graficul gantt” (scos) → — | **AP**: Formular 8 — graficul „să poată prezenta perioadele cu restricții ale execuției (ex. perioada de iarnă, sărbători legale)”, fără interval | FP: „timp friguros” ×8 e tehnic (sudură la < +5 °C) | „timp friguros” doar lângă grafic/gantt/program; unde += `formulare` |
| 14 | PAT-GAR-01 | FP „în original” (scos) → — | — : GP 292.641,99 = **1,00 %** din VE (nu > 1 %); instrument bancă **sau** asigurări | — : fără GP în FD | 0 FP; calculul ține |
| 15 | PAT-GAR-03 | slab | **AP\*** prin citire: condiții specifice 61.6 „36 luni” vs. condiții generale cl. 61 standard „5 ani A/B, 3 ani C, 1 an D” (clarificarea nr. 19) | — | nu prin fraze; e comparație între documente (contract `alta`) |
| 16 | PAT-AMB-02 | **AP** | **AP**: FD + Anexa 1: calificative „acceptabil / bine-adecvat / foarte bine-excepțional”, scară 1–5 (clarificările 10, 12, 13) | FP pe „factor de evaluare” ×48: factorul 2 (personal, 15 %) are algoritm pe subfactori; de citit uman, nu de declanșat | pereche „factor” ∧ „calificativ”; „factor de evaluare” singur nu |
| 17 | PAT-STD-01 | — | AP-slab: procedura OSD „etanșeitate 6,00 bar – 24 ore” la medie presiune (doc 66 `alta`), nu în CS | — (transport) | regexul ține; rămâne pe CS |
| 18 | PAT-STD-09 | FP (sudori PE) | FP: „autorizațiilor ISCIR (SRS, SD, SRM)” — coduri de sudură, nu stația (doc 66 `alta`) | — | excluderi: „sudor”, „sudur”, „srs, sd, srm”; „srm” înlocuit cu „stație de reglare” |
| 19 | PAT-GAZ-15 | FP | FP: glosar OSD „i.u. – instalație de utilizare” | — | fără frază singură; doar F3 cu articole de IU sau CS „montaj contor și instalație”; încredere scăzută |
| 20 | PAT-CTC-08 | **AP** | FP ca problemă: „Anghel Saligny” ×14 (CS, FD, hotărâri), dar **niciun text suspensiv** în acord / condiții generale / specifice | **AP**: FD „clauză suspensivă lot 1–4”: semnarea suspendată până la 20 zile după contractul de furnizare al achizitorului; anulare în max. 12 luni **fără despăgubiri**; ofertantul prelungește GP | fraze „clauză/condiție suspensivă”; „anghel saligny”, „oug 41/2025” = **temă**, nu declanșator |
| A | PAT-INF-09 (codul de azi) | — | FP: CS 176 dă metoda („defectoscopului cu scântei, conform normelor”) | FP ×13: capitol dedicat IV.1.4.5–6 | excludere: metodă prezentă la ≤ 300 car. (defectoscop, detector, holiday, kV) |
| B | PAT-STD-07 (codul de azi) | — | — | FP: „izolație foarte întărită” e termenul oficial din NT 118/2013 art. 33 (9), cu SR EN 12068 | excludere la transport („118/2013”, „conductă de transport”) |

**Cifre.** Setul din spec, cu corecturile din 95: pe 3 → 7 AP pe frază (din care 3 **numai** în documente `alta`: STD-08, CAL-15, STD-01) + 9 FP; pe 102 → 3 AP + 7 FP. **Cu regulile din §4 (perechi, excluderi, condiții): 0 FP pe toate cele trei licitații**, AP pe frază: 95 → 4 (GAZ-10, STD-15, AMB-02, CTC-08), 3 → 7, 102 → 3 (CAL-01, AMB-11 slab, CTC-08). Ținta din spec („sub 1 FP pe licitație la încredere ridicată”) se atinge, cu prețul că 5 tipare ies din detecția pe fraze (CTR-04, GAR-03, GAZ-15, CAL-05/CAL-07 rămân pe condiții de registru).

## 2. Potrivirile de pe licitația 3 (Mânăstirea), una câte una

| Tipar / frază | Unde | Context (normalizat, scurtat) | Verdict |
|---|---|---|---|
| INF-09 „verificarea izolației” (cod azi) | CS 176 | „verificarea izolației — izolații executate în șantier vor fi verificate prin metoda defectoscopului cu scântei, conform normelor tehnice aplicabile” | FP — metoda e dată |
| CAL-01 „ordinul anre nr. 132/2021” | CS 174 | lista actelor: „• ordinul anre nr. 22/2013 … • ordinul anre nr. 132/2021 privind autorizarea operatorilor economici … • ordinul anre nr. 65/2023” | AP-slab — act abrogat citat; FD cere EDSB pe Ord. 17/2026 și spune „contractul nu include proiectare; nu se solicită PDSB” |
| STD-08 „legea 10/1995” | CS 65 ×2 | „referat privind verificarea de calitate în conformitate cu legea 10/1995 la cerințele a–f”; „art. 16 din legea nr. 7/2020, act care modifică legea 10/1995” | FP — lege în vigoare, citată corect |
| STD-08 „ordinului anre nr 98/2015” | doc 66 `alta` | „o.e.p și/sau o.e.e., care sunt autorizați în conformitate cu ordinului a.n.r.e. nr 98/2015” (procedura operațională Dornacor) | AP — ordin abrogat; clarificarea nr. 15 cere corelarea EDSB ↔ OEE |
| STD-08 „legea 50/1991” | docs 73/129 `alta` | „autorizația de construire se emite în baza art. 7 alin. 16^4 din legea 50/1991” | FP — în vigoare |
| CAL-04 „instalator autorizat anre” | CS 177, doc 64 | „5. instalator autorizat anre tip egd, corespunzător activităților … ordinul președintelui anre nr. 182/2020 / 65/2023” | FP — tipul e precizat |
| CAL-15 (regex ratat) | doc 66 `alta` | „5.1. sef santier – persoana autorizata anre cerinta pgd-pgiu cu vechime de minim 5 ani”; „5.2. sef punct de lucru – … egd-egiu … 3 ani” | AP — de verificat uman dacă procedura OSD leagă ofertantul; cerințele 2676/2677 sunt deja în registru ca `propunere` |
| GAZ-10 „srmp” / „stație de reglare” | CS 65/174/177, FD 63, F3 1605, ATR 69–71 | FD: „execuția stației de reglare-măsurare-predare – SRMP”; ATR: „stație de reglare măsurare pentru predare gaze naturale **din sistemul de distribuție** operat de Distrigaz Sud, … conductă de distribuție … presiune medie, PE Dn 250” | FP — nu e obiect mixt transport + distribuție; EDSB acoperă |
| GAZ-10 „înaltă presiune” | docs 66, 68, 74 `alta` | glosar „i.p. – inalta presiune – m.p. – medie presiune”; definiția ET „instalații … ce funcționează în regim de înaltă presiune” | FP — glosar / definiție |
| STD-15 „sistemul național de transport” | doc 74 `alta` | „să informeze operatorul în situația în care efectuează demersuri în vederea racordării la sistemul național de transport” | FP — clauză ATR generică |
| AMB-11 „pentru toate categoriile de lucrări” | formular 99 (Formular 8) | „procedurile tehnice de execuție care să acopere toată plaja de lucrări …, pe obiecte, pentru toate categoriile de lucrări ce se vor executa, … nefiind acceptate proceduri/instrucțiuni cu caracter general” | AP — fără listă de categorii; e exact BO2025_2118 |
| AMB-13 „formularele f1”, „formularul f3” | FD 63, F3 1605–1611 | „listele cu cantitățile de lucrări fără valori (formularele f1, f2, f3, f4, f5, c6, c7, c8 și c9)” | FP — contract de execuție (FD: „nu include servicii de proiectare”) |
| CTR-04 „ofertanții trebuie să prezinte” | FD 63 | în FD | FP pe frază; CTR-04 real e în convenție (OEP + VGd) — clarificarea nr. 14 |
| TRM-06 „perioada de iarnă” | formular 99 | „care să poată prezenta perioadele cu restricții ale execuției lucrărilor (ex. perioada de iarnă, sărbători legale, etc.)” | AP — fără interval calendaristic și fără lucrările admise |
| AMB-02 „factor de evaluare” ×4 + „calificativ” ×4 | FD 63; docs 64/80 ×12/×19 + ×7/×8 | „factorul va fi apreciat în funcție de calificative structurate pe 3 niveluri: 1. acceptabil/satisfăcător/parțial relevant, 2. bine/adecvat, 3. foarte bine/excepțional … scară de la 1 la 5” | AP (review juridic) — echipa a întrebat deja (10, 12, 13) |
| STD-01 regex | doc 66 `alta` | „probele de presiune … treapta de presiune medie: de rezistență 15,50 bari – 1 oră – de etanșeitate 6,00 bari – 24 ore” | AP-slab — procedura OSD impune 24 h indiferent de volum (NTPEE dă durata după volum); nu e în CS |
| STD-09 regex | doc 66 `alta` | „tabelul cu personalul autorizat iscir, copia autorizațiilor iscir (srs, sd, srm) precum și a responsabilului tehnic cu sudură” | FP — „srm” e cod ISCIR de sudură |
| GAZ-15 „instalație de utilizare” | doc 66 `alta` | glosar „i.u. – instalație de utilizare – c.d. – conductă” | FP — glosar |
| CTC-08 „anghel saligny” | CS 174 ×4, FD 63 ×4, hotărâri 67/72/127 ×6 | „proiectul este finanțat prin PNI «Anghel Saligny» … OUG 95/2021” | FP ca problemă — acord/condiții fără clauză suspensivă; rămâne **temă** (finanțare) |
| GAR-03 „categoria de importanță” | doc 98 `alta` (condiții generale) | „5 ani pentru A și B; 3 ani pentru C; 1 an pentru D” | prezență = OK; conflictul cu „36 luni” din condițiile specifice e CTR-01/GAR-03 prin comparație (clarificarea 19) |

Ce **nu** a prins nicio frază, dar e real pe 3 (din clarificările trimise de echipă): lipsa F3 (nr. 1, 9, 11 — PAT-INF-12, regulă de absență), două seturi de F1/F2/F3 (nr. 22 — CTR-01), ES (nr. 16, 18), RTE 6.1 suplimentar (nr. 17), „subclasa 8.4 D” (nr. 21), garanții de echipamente contradictorii (nr. 23, 25 — CTR-01), cota de profit cl. 37.7 (nr. 24). Toate sunt `comparatie_documente` sau `judecata_umana` — confirmă nota din testul 95: **semnalele bune ies din `ofertare_cerinte` și din comparații, nu din cuvinte-cheie pe CS.**

## 3. Potrivirile de pe licitația 102 (Transgaz Botoșani)

| Tipar / frază | Unde | Context | Verdict |
|---|---|---|---|
| INF-09 „verificarea izolației” (cod azi) ×13 | CS 772 | cuprins: „IV.1.4.5 verificarea izolației înainte de lansare; IV.1.4.6 verificarea izolației după astuparea conductei” + capitolele | FP — CS tratează metoda |
| STD-07 „izolație foarte întărită” (cod azi) | CS 772 ×3 | „conform art. 33 (9) din NT 118-2013: … va avea o izolație de tip foarte întărită”; tabele cu manșoane termocontractabile, SR EN 12068 | FP — termen oficial pentru transport |
| CAL-01 „ordinul anre nr. 132/2021” ×2 | FD 532 | „conform art. 18 din regulamentul … anexa 1 la ordinul anre nr. 132/2021”; „autorizația anre tip et pentru executarea sistemelor de transport … conform art. 1 din regulamentul … anexa la ordinul anre nr. 132/2021” | AP — temei abrogat din 26.05.2026 (Ord. 17/2026); tipul ET e corect, de cerut doar confirmarea temeiului actual |
| STD-08 „legea 10/1995” ×4 | CS 772 | referiri la calitatea în construcții | FP |
| GAZ-10 „conducta de transport” ×877, „înaltă presiune” ×5/×5 | CS, FD, formular | obiectul e SNT; FD cere ET; nicăieri „rețea de distribuție / presiune medie / redusă” | FP — nu e obiect mixt |
| STD-15 „118/2013” ×11, „clasa de locație” ×7, SNT ×2 | CS 772 | „faza de testare a rezistenței … în funcție de clasa de locație … respectându-se prevederile normelor tehnice pentru proiectarea și execuția conductelor de transport” | FP — regimul corect e aplicat |
| AMB-11 „pentru toate categoriile de lucrări” | formular 527 | „se vor prezenta metodologiile de execuție pentru toate categoriile de lucrări cuprinse în proiectul tehnic” | AP-slab — lista e PT-ul |
| AMB-13 „formularele f1” ×2 | FD 532 | „propunerea tehnică va include formularele f1 … f3 (listele cu cantități) fără valori” | FP — execuție |
| CTR-04 „ofertantul trebuie să facă dovada” ×4 | FD 532 | „cash flow lot 1 … ofertantul trebuie să facă dovada asigurării unui cash flow de minim 2.246.221,81 lei pentru 2 luni” | FP pe frază (în FD); cerința de cash-flow e alt subiect (PAT-CAL, review) |
| TRM-06 „timp friguros” ×8 | CS 772 | „lucrările de sudare pe timp friguros la temperaturi mai mici de +5 °C se vor executa cu respectarea procedurilor” | FP — tehnic |
| AMB-02 „factor de evaluare” ×48/×9 | FD 532, formular 527 | factorul 2 „calificarea și experiența profesională a personalului (experți cheie)” 15 %, punctaj pe subfactori | FP pe frază; dacă subfactorii sunt neverificabili e review uman, nu declanșare |
| CTC-08 „clauză suspensivă”, „condiției suspensive” | FD 532 | text integral citit: semnarea contractului suspendată 20 zile după contractul de furnizare; „în termen de maxim 12 luni … achizitorul este îndreptățit să anuleze … iar executantul nu este îndreptățit să solicite despăgubiri”; prelungirea valabilității ofertei și a GP | AP (review juridic) — termen lung + fără despăgubire + GP prelungită |

Alte observații pe 102, pentru fișa licitației (nu pentru fraze): `regim_achizitie` e NULL deși FD spune Legea 99/2016 → propunere de completare `sectorial` (spec §4.2, cu „da”); cerințele nu sunt extrase (941 pe 3, 0 pe 102) → tiparele pe registru (CTR-04, CAL-05, CAL-07, GAR-01 calcul) nu pot rula.

## 4. Lecții pentru detecție (dincolo de fraze)

1. **Documentele `alta` sunt oarbe.** Pe 3, contractul, convenția tehnică, Anexa 1 cu factorii și procedura OSD sunt `alta`; 3 din cele 7 semnale reale de pe 3 stau numai acolo. Două căi, nu exclusive: (a) tipizarea corectă din UI de către om (acord + condiții → `model_contract`; e **date**, pct. 3 din CLAUDE.md, cu „da”); (b) în cod, o cheie `unde_cauti` nouă `alte_documente → ['alta']` pentru tiparele care o cer explicit (CAL-15, STD-08, STD-01), ca să nu scanăm 473 de planșe electrice de pe 102.
2. **Formularele contează.** AMB-11 și TRM-06 (ambele AP pe 3) sunt în Formularul 8, nu în FD; `formulare → formular` există deja în `UNDE_CAUTI_TIP`, trebuie doar pusă în `unde_cauti` la cele două tipare.
3. **Frazele singure prind glosare, definiții și liste de acte.** De aceea perechile (GAZ-10, STD-15, AMB-02) și excluderile (CAL-04, STD-09, INF-09, STD-07) nu sunt opționale.
4. **Cinci tipare nu sunt de fraze**: CTR-04, GAR-03 și CTR-01 ies din `ofertare_cerinte` (rând `eliminatorie` cu sursă ≠ FD, fără pereche în FD) și din comparații între documente; CAL-05/CAL-07 rămân pe condiții de registru (ES „identic”, listă închisă) — pe 3 lipsa lor e corectă.
5. **CS-ul revizuit poate stinge tiparul-sursă.** GAZ-14 s-a născut din CS-ul Mânăstirea; versiunea revizuită ANAP nu mai are clauza, iar codul de azi, corect, nu declanșează. Confirmă că detecția trebuie să ruleze pe documentele **curente** (`aparut_ulterior`, versiunea), nu pe primul import.
6. **„Anghel Saligny” / OUG 41/2025 nu sunt declanșatoare**, sunt teme: pe 3 finanțarea e prin PNI, fără clauză suspensivă; pe 95 și 102 problema e clauza, nu programul.

## 5. Propunerea exactă pentru `clarificari_tipare.trigger` (merge peste cheile existente)

Chei noi (spec §4.1): `fraze` (declanșatoare singure, normalizate), `regex` (când fraza nu ajunge), `perechi` (toate elementele perechii în **același document**; fiecare element e o listă de alternative), `excluderi` (frază sau regex la ≤ `fereastra` caractere de potrivire → anulare), `conditii` (reguli care nu sunt pe text: calcul, registru, absență), `teme` (filtrul de decizii din spec §1c), `incredere_fraze` (ridicata / medie / scazuta — pentru UI: ridicată = ciornă automată, altfel doar „de verificat”). `unde_cauti` se **înlocuiește** acolo unde apare (restul cheilor se păstrează). Valori `unde_cauti` existente în cod: `caiet_sarcini`, `contract`, `F3`, `fisa_de_date`, `raspunsuri_clarificari`, `formulare`; `alte_documente` e propunere de cod (lecția 1b).

```json
{
  "PAT-GAZ-14": {"fraze": ["va reactualiza proiectul", "reactualizarea proiectului", "actualizarea proiectului tehnic", "va elabora detaliile de executie", "reobtinerea avizelor", "va reobtine avizele"],
    "excluderi": ["puse la dispozitie de autoritatea contractanta", "pus la dispozitie de beneficiar"], "fereastra": 200,
    "conditii": {"fara_in": {"fisa_de_date": ["proiectare si executie", "proiectarea si executia"]}},
    "unde_cauti": ["caiet_sarcini", "contract", "F3"], "teme": ["proiectare", "cantitati"], "incredere_fraze": "ridicata"},

  "PAT-CAL-01": {"fraze": ["ordinul 132/2021", "ordinului 132/2021", "ordinul anre 132/2021", "ordinul anre nr. 132/2021", "ordinului anre nr. 132/2021", "ord. anre 132/2021"],
    "regex": ["98\\s*/\\s*2015"],
    "unde_cauti": ["fisa_de_date", "caiet_sarcini", "contract", "alte_documente"], "teme": ["autorizare_anre"], "incredere_fraze": "ridicata",
    "nota_validare": "3 licitatii: 102 FD (AP), 3 CS + conventie (AP-slab), 95 — ; 0 FP"},

  "PAT-STD-08": {"fraze": ["ordinul 863/2008", "ordin 863/2008", "ntpee-2008", "ordinul 5/2009", "normativ i 6", "normativul i6", "ordinul 98/2015", "ordinului anre nr. 98/2015", "ordinul anre nr. 98/2015", "ord. anre 98/2015"],
    "regex": ["sr en 1555[-:][^0-9]*(2003|2011)", "sr en 12954:2002", "sr en 13067:2013"],
    "excluderi_scoase": ["legea 10/1995", "legea 50/1991"],
    "unde_cauti": ["caiet_sarcini", "fisa_de_date", "contract", "alte_documente"], "teme": ["norme_abrogate"], "incredere_fraze": "medie"},

  "PAT-CAL-04": {"fraze": ["gradul i", "gradul ii", "instalator autorizat anre", "igib", "rte pentru gaze", "rte autorizat anre", "responsabil tehnic cu executia autorizat anre"],
    "excluderi": ["REGEX:(tip\\s+)?(egd|egiu|egt|pgd|pgiu|pgt|edib|pdib)\\b"], "fereastra": 40,
    "unde_cauti": ["fisa_de_date", "caiet_sarcini"], "teme": ["personal_anre"], "incredere_fraze": "medie"},

  "PAT-CAL-15": {"regex": ["(manager(ul)? de proiect|sef(ul)? (de )?proiect|sef(ul)? (de )?santier).{0,300}\\banre\\b", "\\banre\\b.{0,300}(manager(ul)? de proiect|sef(ul)? (de )?proiect|sef(ul)? (de )?santier)"],
    "excluderi": ["instalator autorizat", "responsabil tehnic cu executia"], "fereastra": 120,
    "unde_cauti": ["fisa_de_date", "caiet_sarcini", "alte_documente"], "teme": ["personal_anre", "proportionalitate"], "incredere_fraze": "medie",
    "nota_validare": "3: AP in procedura OSD (sef santier fara 'de')"},

  "PAT-CAL-05": {"fraze": ["lucrari identice", "experienta identica", "similare sau identice", "in acelasi contract", "exclusiv retele de distributie"],
    "conditii": {"sursa": "ofertare_cerinte", "tip": "eliminatorie", "contine": "experien"},
    "unde_cauti": ["fisa_de_date"], "teme": ["experienta_similara"], "incredere_fraze": "medie"},

  "PAT-CAL-07": {"fraze": ["proces-verbal de receptie finala", "pv de receptie finala"],
    "conditii": {"lista_inchisa": true, "fara_in_acelasi_doc": ["fara a se limita", "orice alt document", "de exemplu", "sau echivalent"]},
    "unde_cauti": ["fisa_de_date"], "teme": ["experienta_similara"], "incredere_fraze": "scazuta"},

  "PAT-GAZ-10": {"perechi": [[["srmp", "racord la snt", "racordare la snt", "conducta de transport", "sistemul national de transport", "inalta presiune", "presiune inalta"], ["retea de distributie", "retelei de distributie", "presiune medie", "medie presiune", "presiune redusa", "redusa presiune"]]],
    "excluderi": ["REGEX:\\b[a-z]\\.[a-z]\\.\\s*[–-]\\s*", "ce functioneaza in regim de inalta presiune"], "fereastra": 30,
    "conditii": {"numara_in_fisa_date": {"edsb_pdsb": ["edsb", "pdsb"], "et_pt": ["tip et", "tip pt", "autorizatie et", "autorizatie pt"]}},
    "unde_cauti": ["caiet_sarcini", "fisa_de_date"], "teme": ["autorizare_anre", "transport"], "incredere_fraze": "ridicata",
    "nota_validare": "95 AP; 3 FP fara pereche (SRMP din distributie); 102 FP fara pereche (doar transport)"},

  "PAT-STD-15": {"perechi": [[["snt", "sistemul national de transport", "conducta de transport", "racord la snt"], ["ntpee", "89/2018", "norme tehnice pentru proiectarea, executarea si exploatarea sistemelor de alimentare"]]],
    "conditii": {"fara_in_acelasi_doc": ["118/2013", "clasa de locatie"]},
    "unde_cauti": ["caiet_sarcini"], "teme": ["transport", "norme_tehnice"], "incredere_fraze": "medie",
    "nota_validare": "95 AP-slab; 102 nu (118/2013 prezent); 3 nu"},

  "PAT-AMB-11": {"fraze": ["pentru toate categoriile de lucrari", "nu se accepta copierea", "preluarea caietului de sarcini", "copierea caietului de sarcini", "caracter general"],
    "regex": ["procedur\\w* tehnice de executie"],
    "unde_cauti": ["fisa_de_date", "formulare"], "teme": ["propunere_tehnica"], "incredere_fraze": "ridicata",
    "nota_validare": "3 AP (Formular 8), 102 AP-slab (formular PT), 95 —"},

  "PAT-AMB-13": {"perechi": [[["contract de proiectare si executie", "proiectare si executie a lucrarilor", "proiectarea si executia lucrarilor"], ["liste de cantitati", "listele de cantitati", "extrase de resurse", "formularul f3", "formularele f1"]]],
    "excluderi": ["orientativ", "orientative"], "fereastra": 300,
    "unde_cauti": ["fisa_de_date"], "teme": ["cantitati", "proiectare"], "incredere_fraze": "medie",
    "nota_validare": "fara licitatie P+E in set; 0 FP cu perechea pe FD"},

  "PAT-CTR-04": {"fraze": [], "conditii": {"sursa": "ofertare_cerinte", "tip": "eliminatorie", "sursa_document_tip_nu": "fisa_date", "fara_corespondent_in": "fisa_date"},
    "unde_cauti": ["caiet_sarcini", "contract", "alte_documente"], "teme": ["calificare_ascunsa"], "incredere_fraze": "scazuta",
    "nota_validare": "frazele 'ofertantul trebuie sa' = FP pe toate 3; AP real pe 3 (OEP+VGd in conventie) iese din registru"},

  "PAT-TRM-06": {"fraze": ["perioada nefavorabila", "perioadei nefavorabile", "perioada de iarna", "rezerve de timp", "perioadele cu restrictii"],
    "perechi": [[["timp friguros"], ["grafic", "gantt", "program de executie", "programul de executie"]]],
    "unde_cauti": ["fisa_de_date", "formulare", "caiet_sarcini"], "teme": ["termen", "grafic"], "incredere_fraze": "ridicata",
    "nota_validare": "3 AP (Formular 8); 102 'timp friguros' tehnic = FP fara pereche"},

  "PAT-GAR-01": {"fraze": ["scrisoare de garantie bancara", "emisa de o banca", "societate de asigurari agreata", "rating"],
    "excluderi": ["sau societate de asigurari", "sau de o societate de asigurari", "sau asigurari"], "fereastra": 80,
    "conditii": {"calcul": "garantie_participare > 0.01 * valoare_estimata"},
    "unde_cauti": ["fisa_de_date"], "teme": ["garantie_participare"], "incredere_fraze": "medie"},

  "PAT-GAR-03": {"fraze": [], "perechi": [], "conditii": {"comparatie": "perioada de garantie (contract/formular) vs clauza standard pe categorii de importanta (conditii generale)", "review_uman": true},
    "unde_cauti": ["contract", "fisa_de_date", "formulare", "alte_documente"], "teme": ["garantie_lucrari"], "incredere_fraze": "scazuta"},

  "PAT-AMB-02": {"perechi": [[["factor de evaluare", "factorul de evaluare", "factorului de evaluare", "subfactor"], ["calificativ", "calificative", "adecvat", "detaliat", "tronson", "vehicule electrice", "angajati din", "contract colectiv de munca"]]],
    "unde_cauti": ["fisa_de_date", "formulare", "alte_documente"], "teme": ["criteriu_atribuire"], "incredere_fraze": "ridicata",
    "nota_validare": "95 AP, 3 AP (calificative), 102 — (factor cu algoritm; 'factor de evaluare' singur = 48 FP)"},

  "PAT-STD-01": {"regex": ["etan[s]eitate.{0,40}24\\s*(h|ore)"],
    "conditii": {"exclus_cand_declansat": ["PAT-STD-15"], "fara_in_acelasi_doc": ["118/2013", "conducta de transport"]},
    "unde_cauti": ["caiet_sarcini", "F3", "alte_documente"], "teme": ["probe"], "incredere_fraze": "medie",
    "nota_validare": "3 AP-slab doar in procedura OSD (alta); 95, 102 —"},

  "PAT-STD-09": {"regex": ["(iscir|rsvti).{0,200}(conduct[ae]|bransament|statie de reglare|srmp|instalatie de utilizare)", "(conduct[ae]|bransament|statie de reglare|srmp|instalatie de utilizare).{0,200}(iscir|rsvti)"],
    "excluderi": ["sudor", "sudur", "srs, sd, srm", "srs,sd,srm", "compresor", "macara", "recipient", "ridicat", "stivuitor"], "fereastra": 120,
    "unde_cauti": ["caiet_sarcini", "fisa_de_date"], "teme": ["iscir"], "incredere_fraze": "medie",
    "nota_validare": "95 FP (sudori PE), 3 FP (coduri ISCIR srs/sd/srm) — ambele acoperite de excluderi"},

  "PAT-GAZ-15": {"fraze": ["montaj contor si instalatie", "instalatii interioare", "racordarea consumatorilor"],
    "perechi": [[["instalatie de utilizare", "instalatii de utilizare"], ["teava aparenta", "contor", "post de reglare", "firida"]]],
    "excluderi": ["REGEX:\\b[a-z]\\.[a-z]\\.\\s*[–-]\\s*", "instalatiile de utilizare ale consumatorilor nu fac obiectul"], "fereastra": 30,
    "conditii": {"fara_in": {"fisa_de_date": ["edib", "egiu"]}},
    "unde_cauti": ["caiet_sarcini", "F3"], "teme": ["instalatii_utilizare"], "incredere_fraze": "scazuta",
    "nota_validare": "95 FP (narativ), 3 FP (glosar OSD); ramane 'de verificat', nu ciorna"},

  "PAT-CTC-08": {"fraze": ["clauza suspensiva", "clauzei suspensive", "conditie suspensiva", "conditiei suspensive", "conditia suspensiva", "termen suspensiv", "termenului suspensiv"],
    "teme_din_text": ["anghel saligny", "oug 41/2025", "oug 95/2021", "pnrr", "pndl"],
    "unde_cauti": ["fisa_de_date", "contract"], "teme": ["finantare", "clauza_suspensiva"], "incredere_fraze": "ridicata",
    "nota_validare": "95 AP, 102 AP (12 luni, fara despagubiri), 3 — ('anghel saligny' nu declanseaza)"},

  "PAT-INF-09": {"excluderi": ["defectoscop", "detector", "holiday", "scantei", "REGEX:\\d+\\s*kv"], "fereastra": 300,
    "conditii": {"fara_in": {"F3": ["verificarea izolatiei", "verificare izolatie", "controlul izolatiei"]}},
    "teme": ["izolatie"], "incredere_fraze": "medie", "nota_validare": "frazele existente; 3 FP (metoda data), 102 FP x13 (capitol dedicat)"},

  "PAT-STD-07": {"conditii": {"fara_in_acelasi_doc": ["118/2013", "conducta de transport"]},
    "teme": ["izolatie"], "incredere_fraze": "scazuta", "nota_validare": "102 FP: 'foarte intarita' e termenul NT 118/2013"}
}
```

Două note la JSON: (1) `nota_validare` și `excluderi_scoase` sunt doar memorie de lucru (unde s-a validat, ce s-a scos) — pot fi omise la scriere; (2) niciuna din cheile noi **nu e citită azi de cod** (`tipareDeclansate` ia doar frazele dintre ghilimele din `semnal`), deci scrierea lor **nu schimbă comportamentul** platformei până când sesiunea Ofertare implementează §4.4 din spec. Dacă Răzvan vrea efect imediat fără cod, singura cale e să pună frazele „ridicate” **între ghilimele în `semnal`** — dar atunci merg fără perechi/excluderi, adică exact falsurile de mai sus; nu recomand.

## 6. Cum s-ar aplica (numai după „da”, pattern preview → confirm → apply)

1. **Preview**: `SELECT pattern_id, trigger FROM clarificari_tipare WHERE pattern_id IN (…22 id-uri…)` — snapshot-ul salvat în `docs/cercetare/` (sau `claude_docs`) ca rollback.
2. **Apply**, un UPDATE pe tipar, merge nedistructiv: `UPDATE clarificari_tipare SET trigger = trigger || '<json tipar>'::jsonb WHERE pattern_id = '<id>' RETURNING pattern_id` — `||` păstrează `semnal`, `tip_detectie`, `unde_cauti` neatinse acolo unde JSON-ul nu le rescrie (pe `unde_cauti` rescrie, intenționat). `trigger` e deja scris doar de owner (RLS existentă); fără schemă, fără migrare.
3. **Sanity**: `SELECT pattern_id, trigger ? 'fraze' OR trigger ? 'perechi' OR trigger ? 'regex' AS are_declansator FROM clarificari_tipare WHERE …` → 22 rânduri `true`; apoi „📐 Tipare declanșate” pe 3 trebuie să dea aceleași rezultate ca azi (cheile noi nu sunt citite).
4. **Rollback**: `UPDATE … SET trigger = '<snapshot>'::jsonb WHERE pattern_id = …` din snapshot.

Date separate, tot cu „da” (nu fac parte din Q3-A): `ofertare_licitatii.regim_achizitie = 'sectorial'` pe 102; retipizarea din UI a documentelor 96/97/98 de pe 3 ca `model_contract`.

## Rezumat (pentru Răzvan și pentru chat)

1. **Setul din spec dă prea multe falsuri singur** (9 pe Mânăstirea, 7 pe Transgaz): glosare, liste de acte, formulare standard F1–F3, „factor de evaluare” în orice FD cu calitate-preț. **Cu perechile și excluderile din §5: 0 falsuri pe toate cele 3 licitații**, și 4 / 7 / 3 semnale reale pe 95 / 3 / 102.
2. **Semnale reale noi pe Mânăstirea**: proceduri „pentru toate categoriile” (Formular 8), Gantt cu „perioada de iarnă” fără interval, calificative subiective la factori, Ord. 132/2021 și 98/2015 (abrogate) în CS/convenție, ANRE cerut șefului de șantier în procedura OSD — 3 din 7 **numai în documente `alta`**, pe care codul de azi nu le vede. **Pe Transgaz**: clauza suspensivă de 12 luni fără despăgubiri, FD pe un regulament abrogat.
3. **Cinci tipare nu sunt de fraze** (CTR-04, GAR-03, CTR-01, CAL-05, CAL-07): ies din `ofertare_cerinte` și din comparații — pe 3 toate întrebările bune ale echipei sunt de acest fel.
4. **Ce cer**: A) „da” pentru UPDATE-ul din §5–§6 pe cele 22 de tipare (fără efect în UI până la codul Ofertare; rollback din snapshot) — *recomand*; B) „da” doar pentru cele 7 tipare cu `incredere_fraze = ridicata`; C) nu se scrie, rămâne document. Separat: regim `sectorial` pe 102 și retipizarea contractului de pe 3.
5. **Pentru sesiunea Ofertare (prin chat)**: citirea cheilor `fraze/regex/perechi/excluderi/conditii/teme` în `tipareDeclansate`, maparea `alte_documente → alta` și `formulare` la AMB-11/TRM-06, regula pe `ofertare_cerinte` pentru CTR-04.
