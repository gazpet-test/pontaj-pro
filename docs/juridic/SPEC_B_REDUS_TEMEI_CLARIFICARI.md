# „B redus”: temeiul pe punctul de clarificare, în fluxul nou al Ofertării — specificație (doar document)

> 19.10.2026 · sesiunea de cercetare juridic-normativă, la cererea lui Răzvan transmisă prin sesiunea de chat („ok” pe MAPARE_CNSC_IN_ERP.md → nici A ca modul separat, ci un B redus legat de fluxul nou). **Fără cod, fără migrări, fără date reale.** Tot ce e cifră aici vine din BD la 19.10.2026 (doar SELECT) și din codul de pe `main` (commit 3e3e5cb7).
> Corpusul și tiparele sunt referința; nu există nicio decizie sau citat în acest document care să nu fie în `cnsc_decizii` / `norme_cerinte` cu pagină și link.

## 0. Ce există deja (citit pe main și în BD, nu din descrierea primită)

Descrierea primită pornește de la „B nu e construit”. Nu mai e așa. Specificația de mai jos e un **delta** peste ce e live, nu o construcție de la zero.

| Ce | Stare la 19.10.2026 | Unde |
|---|---|---|
| Tabelul `ofertare_clarificari_temeiuri` | **există** (migrarea `20261014b`, aplicată), **0 rânduri** — nimeni nu l-a folosit încă | PR #615 (mergeuit 05.10; migrarea aplicată 05.10, versiunea 20261005213000) |
| „⚖️ Temei” pe întrebare (modal cu 3 file: Tipar / Decizii / Cerințe; chip-uri; bifa „include în adresă”) | **există**; propunerile din tipar sunt deterministe (domeniu → lege → control judiciar → an), excluse modificate / desființate / neverificate | `src/OfertareTemeiuri.jsx`, `src/ofertareTemeiuri.js` |
| „📐 Tipare declanșate” la citirea documentației | **există**, în tab-ul Documente; caută doar frazele **dintre ghilimele** din `trigger.semnal`, doar la tiparele `tip_detectie = cuvant_cheie`. Azi au fraze citabile **11 din 36** tipare cu cuvinte-cheie, deci 11 din 119 sunt detectabile | `src/OfertareTipareDeclansate.jsx` |
| Export „Practica CNSC invocată” în PDF-ul adresei | **există**; doar temeiuri `confirmat` + `include_in_adresa`, doar decizii cu citat înghețat + pagină + link; un temei bifat care nu poate ieși **blochează** exportul (fail-closed) | `src/OfertareClarificari.jsx` |
| Poarta „review juridic → include în adresă doar owner” | **există, pe server** (trigger `fn_temei_citat_verifica`), nu doar în UI | migrarea `20261014b` |
| Bibliotecă juridică (pasul A) | **există**, read-only; `impact_intern` e owner-only pe server | PR #618, #620 |
| Registrul de termene (#610) | **există**: `ofertare_termen_clarificari` = termenul pentru **întrebări** (baza = publicarea din SEAP). Nu calculează termenul de **contestare** | PR #610 |
| Comparatorul de cantități (TKT-0329 B) | migrarea de bază `20261031a` aplicată, tabelele **goale** (`ofertare_cant_cmp` 0 rânduri); funcțiile pure `cantComparator.ts` există; PR3–PR5 (extragere, calcul, „clarificari-propune primește contradicțiile”) **nelivrate** | `docs/ofertare/TKT0329_B_SPEC.md` §7 |
| Generatorul `ofertare-clarificari-propune` | lucrează pe fluxul vechi (`ofertare_cantitati.diferenta_nota`) și pe registrul de cerințe; nu știe de tipare; produce `sursa_tip ∈ {ambiguitate, gol, cantitati, documentatie, contract, modificare}` și `prioritate ∈ {eliminatorie, importanta, utila}` | `supabase/functions/ofertare-clarificari-propune/core.ts` |
| Punctele unei întrebări (`ofertare_clarificari_puncte`) | tabel + UI există, **0 rânduri** — întrebările nu sunt descompuse în puncte în practică | `src/OfertareClarificariPuncte.jsx` |

Două realități care schimbă regulile de mai jos:

- **`regim_achizitie` e NULL la 82 din 88 de licitații** (conpet 67, transgaz 6, distributie 7…). Criteriul „legea deciziei == regimul licitației” din ordonarea existentă e **inactiv** aproape peste tot. Fără completarea regimului (date, nu schemă), ordonarea cade pe domeniu + control judiciar + an.
- **Calitatea citabilă a corpusului e mai slabă decât spune MAPARE §0**: 68 decizii cu număr exact (66 cu dată), dar **57 din 216 nu au niciun citat cu pagină** (34 au citatele în format vechi, text fără `loc`) → azi sunt **neexportabile** prin formatul unic. Pe familia gaze + distribuție (85 decizii) doar **25** au număr exact și dată.

## 1. Temeiul pe punctul de clarificare — regula deterministă, pe tip de punct

**Principiu comun:** platforma nu alege temeiul; ea **propune** (`sursa = propus_tipar`, `confirmat = false`) și omul bifează. Numărul propus: **1–3 pe punct** (în mod normal 1 cerință normativă + 1–2 decizii). Regula de ordonare e una singură, extinsă față de cea din `propuneriDinTipar`:

1. **Excluse** (nu apar ca propuneri, apar gri cu motiv): `verificat ≠ true`; `control_judiciar.rezultat ∈ {modificata, desfiintata}` (azi: BO2024_2604 desființată; BO2026_1073, BO2026_328, BO2026_621 modificate; BO2025_187 neverificată).
2. **Domeniul**: deciziile din familia licitației întâi. Pentru gaze familia e **{gaze, distributie}** (azi codul tratează `gaze` și `distributie` ca domenii diferite; pentru o licitație Transgaz, o decizie pe `distributie` e mai apropiată decât una pe `apa_canal`, dar pică la egalitate cu ea). Propun: scor 0 = același domeniu, 1 = aceeași familie, 2 = altă familie.
3. **Legea**: `lege_aplicabila` == regimul licitației (L98 clasic / L99 sectorial), **doar când regimul e completat**; altfel criteriul nu se aplică și apare avertismentul existent „decizie pe L99, licitația e pe …” doar după completare.
4. **Controlul judiciar**: menținută > neverificat în instanță (`null`) > necunoscut.
5. **Citabilitate** (criteriu nou): număr exact + dată (`nr_decizie ~ '^\d+/C\d+/\d+'` fără paranteze, `data` nenul) > doar cod BO + link.
6. **Exportabilitate** (criteriu nou): are cel puțin un citat cu pagină (`formatCitare` ≠ null) > doar referință.
7. **An**, descrescător.

Cap: 3. Dacă prima propunere e menținută în instanță **și** cu număr exact, una e suficientă; a doua se propune doar dacă e din alt an (nu două decizii ale aceluiași complet pe același caz, ex. BO2025_2271 + BO2025_3035 sunt același ciclu).

**Marcaje obligatorii** (există deja în UI, le păstrăm): ⚠️ roșu pe modificată / desființată (cu instanța și hotărârea), gri pe neverificată, galben pe „control judiciar necunoscut”, avertisment text pe vechime > 5 ani și pe lege diferită.

### 1a. Punct de tip „discrepanță de cantitate” (din comparator)

**Intrare:** un rând `ofertare_cant_cmp` cu `verdict ∈ {diferenta, conflict_sursa}` și `de_semnalat = true` (|Δ| > 1 m și Δ% > 1 %), din ultimul calcul valid. Până la PR4–PR5 din TKT-0329, intrarea echivalentă e `ofertare_cantitati.diferenta_nota` (fluxul vechi) — regula de mai jos e aceeași, cu `tip_lucrare` necunoscut.

**Tiparul, determinist, din `(rol_b, tip_lucrare)` al rândului de comparație** (regula stă în cod, versionată, cu teste; nu în BD):

| `rol_b` (F3 față de…) | `tip_lucrare` | Tipar | Observație |
|---|---|---|---|
| `cs` / `memoriu` / `plansa` / `atr` | conductă (lungime) | **PAT-CTR-02** | cazul Răcari: F3 Dn90 6.400 m vs ATR 3.995 m (+60 %) |
| `cs` / `plansa` | branșament | **PAT-GAZ-03** | număr / lungime medie / traversare |
| `plansa` | piese, robinete, răsuflători (buc.) | **PAT-GAZ-02** | noduri din planșe vs F3 |
| `plansa` / `cs` | protecție / traversare (tub) | **PAT-CNT-03** | metodă + tub + avize |
| `cs` | probe de presiune | **PAT-GAZ-06** | tronsoane, verificări pe parcurs |
| `raspuns` | orice | **PAT-CTR-03** | răspunsul AC a schimbat cifra, documentul nu e republicat |
| necunoscut | — | **PAT-CTR-02** | implicit |

**Temeiurile propuse (în ordinea asta):**

1. **Cerința normativă, întâi** — pentru cantități norma e mai tare decât practica, și toate sunt verificate pe sursă:
   - `REQ-AD-123` · HG 907/2016, Anexa (conținut-cadru PT), Secțiunea V, Formularul F3, Precizări: proiectantul completează și răspunde pentru coloanele 1–3 (articol, UM, cantitate). *Se propune la orice punct de cantitate.*
   - `REQ-AD-107` · HG 1/2018, Anexa 1, cl. 49.1: la prețuri unitare cantitățile din lista de cantități sunt estimative, se plătesc cantitățile real executate. *Doar când contractul e cu prețuri unitare; la P+E în locul ei intră `REQ-P1-056` (cl. 49.1 Anexa 2, preț forfetar) prin PAT-AMB-13.*
   - `REQ-AD-131` · HG 907/2016, F3 col. 3 coroborat cu BO2026_3104: consumul pe UM nu poate fi sub cantitatea netă din proiect. *Doar la PAT-CTR-02 / PAT-GAZ-02.*
2. **Deciziile**, după regula din §1, din `precedente_cnsc` ale tiparului. **Ce iese azi pentru PAT-CTR-02** (5 precedente, niciunul exclus): BO2026_3104 (gaze, L98, fără nr. exact, citat p. 13: „va dispune reevaluarea ofertei câștigătoare prin verificarea conformității propunerii tehnice cu listele de cantități publicate în SEAP”), apoi BO2025_1138 (apă-canal, p. 97), BO2021_1060 (lucrări generale, p. 46–48), BO2020_2335 (fără nr., fără dată). **Niciuna nu are număr exact.** Propunerea: 1 normă + BO2026_3104; a doua decizie doar la cererea omului. Vezi întrebarea Q1 din rezumat.

**Textul punctului nu se generează din temei.** Punctul citează documentul-sursă (F3 p. X, ATR p. Y) cu cele două cifre, cum cere deja regula din generator („în întrebare citezi documentul-sursă, nu rândul nostru”).

### 1b. Punct de tip „cerință restrictivă” (din registrul de cerințe)

**Intrare:** o `ofertare_cerinte` cu `tip = eliminatorie` (sau `propunere` când semnalul e pe propunerea tehnică), legată de punct prin `cerinta_id` (coloana există). Tiparul se alege **determinist pe textul cerinței** (`text_cerinta`, 200–400 de caractere), nu pe tot documentul: e mai precis și nu are nevoie de citirea a 40 de documente. Frazele sunt cele din §2.

| Familia | Tipare (în ordinea verificării) | Review juridic obligatoriu azi |
|---|---|---|
| Autorizare ANRE a firmei | PAT-CAL-01 → PAT-GAZ-10 (obiect mixt racord/SRM + distribuție) → PAT-CAL-02 (asociat/subcontractant) → PAT-CAL-03 (gaze în contract de drumuri/apă) | da la toate |
| Personal cheie ANRE | PAT-CAL-04 (terminologie veche, „RTE pentru gaze”) → PAT-CAL-15 (ANRE la manager / șef de șantier) → PAT-CAL-10 (același expert pe loturi) | da |
| Experiență similară | PAT-CAL-05 („identică”) → PAT-CAL-06 (finalizat în 5 ani / plafon > VE) → PAT-CAL-07 (documentele) → PAT-CAL-18 (recepție parțială) → PAT-CAL-21 (praguri pe categorii) | da |
| Capacitate financiară / asociere | PAT-CAL-08 (cifra de afaceri) → PAT-CAL-19 (indicatori) → PAT-CAL-17 (asociere cumulat / proporțional) | da, exc. CAL-17 |
| Certificări / sudori | PAT-CAL-11 (ISCIR vs EN ISO 9606) → PAT-CAL-13 (ISO 3834 / IWE / 45001) | da |
| Cerință doar în caietul de sarcini | PAT-CTR-04 | nu |
| Nișă fără legătură cu obiectul | PAT-CAL-09, PAT-CAL-14 (AFER etc.) | da |

**Temeiurile propuse:** (1) norma de proporționalitate, comună: `REQ-P0-030` (L98 art. 178 alin. (1)–(2)) sau `REQ-AD-027` (art. 172 alin. (3) și (5)) + `REQ-P0-035` (HG 395 art. 31 alin. (1)–(2)); la PAT-CTR-04: `REQ-P0-033` (L98 art. 181) + `REQ-P0-034` (HG 395 art. 30 alin. (6)); (2) norma specifică a tiparului (ex. CAL-15: `REQ-TG-048`/`REQ-TG-049`, Ord. ANRE 65/2023 Tabelul 1, cine e instalator; CAL-05: `REQ-AD-037`, Instr. ANAP 2/2017 art. 5); (3) 1–2 decizii după regula din §1. Ce iese azi, exemple: PAT-CAL-05 → BO2023_1378 (gaze, fără nr. exact, p. 21 „sintagma infrastructuri de gaze naturale acoperă inclusiv această componentă”), apoi Decizia 3952/C1/4610 din 31.12.2025 (gaze, nr. exact, control judiciar necunoscut); PAT-CTR-04 → BO2023_985 (gaze, fără nr.), apoi 717/C1/466 din 21.03.2024 (distribuție), 2328/C5/1924 din 17.07.2026 (distribuție, p. 15: „autoritatea contractantă nu poate introduce mascat cerințe de calificare și selecție în cadrul caietului de sarcini”). Cu regula din §1 (citabilitate după controlul judiciar), la PAT-CTR-04 ordinea devine 717/C1/466 → 2328/C5/1924 → BO2023_985.

**Consecința practică:** aproape toată familia cere `requires_human_legal_review = true` → temeiurile se atașează, dar „include în adresă” o pune doar un owner (deja impus pe server). Asta e corect pentru cerințele restrictive: aici se decide contestarea, nu doar clarificarea.

### 1c. Punct de tip „termen / criteriu de atribuire / garanție”

**Intrare:** `ofertare_cerinte.tip = contractuala` (contract, garanții) sau `forma` (termene, factori), sau un **calcul** din datele licitației. Trei sub-tipuri, fiecare cu intrare deterministă:

| Sub-tip | Detecție | Tipar | Norme propuse | Decizii (ce iese azi) |
|---|---|---|---|---|
| Răspunsuri publicate târziu | calcul: `raspuns_document.created/seap_meta.data` > `termen_depunere − 10 zile` (−6 la simplificată) | PAT-TRM-02 | `REQ-AD-003`/`REQ-AD-004` (L98 art. 161 alin. (1)–(2)), `REQ-AD-005` (HG 395 art. 27 alin. (2)) | 286/C11/31 din 07.02.2025 (apă-canal, nr. exact, p. 59–60) |
| Termene peste sărbători (≤ 2 zile lucrătoare) | calcul pe `ofertare_termen_clarificari.termen`, termenul de răspuns, `termen_depunere` și calendarul sărbătorilor | PAT-TRM-05 | `REQ-AD-005` | aceeași 286/C11/31 |
| Termen de execuție / Gantt neclar | fraze din §2 | PAT-TRM-01, PAT-TRM-06 | `REQ-P1-019` (HG 1/2018 cl. 35.1), `REQ-SC-070` (restricții circulație ≥ 30 zile) | BO2025_1775 (gaze, menținută în instanță, fără nr. exact), 271/C1/5029 din 30.01.2026 (gaze), 717/C1/466 din 21.03.2024 (distribuție, p. 15 „termenul de execuție propus de către ofertanți nu este un element pur formal al ofertei”) |
| Factor de evaluare nedefinit / neverificabil | fraze din §2 (review juridic) | PAT-AMB-02 | `REQ-P0-046` (HG 395 art. 32 alin. (2), (8)–(9)), `REQ-P0-043` (art. 32 alin. (4)–(5)) | 1837/C1/1961 din 01.07.2025 (gaze, p. 53 „nu conține nici o referire la noțiunea de «tronson»”), 3657/C1/4067 din 23.12.2024 (gaze), 271/C1/5029 |
| Garanția de participare: formă / cuantum | calcul: `garantie_participare` > 1 % din `valoare_estimata`; fraze din §2 | PAT-GAR-01 | `REQ-AD-011` (L98 art. 154 alin. (2)), `REQ-AD-014` (HG 395 art. 36 alin. (5): fără emitent nominalizat, fără limitarea doar la bănci), `REQ-AD-013` | **precedentele tiparului sunt slabe** pentru întrebare (BO2025_1775 e despre interesul de a contesta după neprelungire; BO2025_1883 e despre cauțiune); BO2024_2604 e desființată. Propunere: la GAR-01 **doar norme**, deciziile la cerere |
| Perioada de garanție a lucrărilor | fraze din §2 (review juridic) | PAT-GAR-03 | `REQ-AD-110` (HG 1/2018 cl. 61.6), `REQ-AD-142`/`REQ-P1-080` (L169/2026 art. 531), `REQ-TG-023` (Ord. ANRE 17/2026 anexa 8 pct. 12: minimum 2 ani de la PIF) | precedentele rămase sunt fără nr. exact (BO2026_3120, BO2026_633, BO2024_2692); BO2026_621 modificată — exclusă |

**Regulă nouă, de cod (nu de bun-simț), pentru toate cele trei tipuri:** o decizie se propune doar dacă `tema` ei conține cel puțin o temă din lista tiparului (câmp nou `trigger.teme`, vezi §4). Fără filtrul ăsta, GAR-01 propune o decizie despre cauțiune la o întrebare despre scrisoarea de garanție.

### 1d. Ce NU se întâmplă automat (reconfirmat)

Nimic din §1 nu scrie în textul întrebării, nu bifează `include_in_adresa`, nu confirmă. Propunerile cad la `confirmat = false`. „Răspuns evaziv” (PAT-AMB-08) rămâne judecată umană: platforma doar pune alături răspunsul, decizia BO2024_2938 (p. 15: „va dispune analiza punctuală a fiecărei solicitări de clarificări și publicarea în SEAP a unor răspunsuri clare, concrete”) și termenul de contestare calculat (PAT-TRM-03: 10 zile la VE ≥ 26.960.556 lei, 7 sub prag) — și asta e pe mai târziu (§5).

## 2. Tipare declanșate la citirea documentației — cele ~20 cu cea mai mare valoare la gaze

Detecția existentă caută fraze **între ghilimele** din `trigger.semnal`. La 25 din 36 de tipare cu cuvinte-cheie semnalul nu are ghilimele, deci nu se detectează nimic. Tabelul de mai jos e **propunerea de fraze**, de pus în `trigger` (cheie nouă `fraze`, vezi §4), **după validare pe 3 licitații reale** (Mânăstirea, Răcari și una de transport Transgaz/Conpet) cu ținta: la încredere „ridicată”, sub 1 fals-pozitiv pe licitație. Frazele sunt normalizate ca în cod (fără diacritice, minuscule, limite de cuvânt), minimum 2 cuvinte.

Legendă `unde`: FD = fișa de date (`fisa_date`), CS = caiet de sarcini (`cs_volum`), CT = model de contract (`model_contract`), F3 = liste de cantități (`lista_cantitati`), RC = răspunsuri la clarificări (`raspuns_clarificare`).

| # | Tipar | Fraze declanșator (propunere) | Unde | Condiție / excludere | Falsuri pozitive cunoscute | Avertizarea pentru om | Precedente propozabile |
|---|---|---|---|---|---|---|---|
| 1 | **PAT-GAZ-14** contract doar execuție, CS cere actualizarea proiectului | „va reactualiza proiectul”, „reactualizarea proiectului”, „actualizarea proiectului tehnic”, „va elabora detaliile de execuție”, „detalii de execuție”, „reobținerea avizelor”, „va reobține avizele” | CS, CT, F3 | doar dacă FD **nu** conține „proiectare și execuție” / „proiectare si executie” | contracte P+E (acolo e legitim); CS care descrie obligația proiectantului, nu a executantului | „Contract de execuție, dar CS cere lucrări de proiectare fără poziție în F3 — cazul Mânăstirea. Întreabă cine proiectează și dacă se cotează.” | 2 (BO2026_1149 menținută; BO2022_2473) |
| 2 | **PAT-CAL-01** autorizare ANRE citată pe Ord. 132/2021 / tip neprecizat | „ordinul 132/2021”, „ord. anre 132/2021”, „ordinului anre nr. 132/2021”, „ordinul anre nr. 132/2021” | FD, CS | din 26.05.2026 Ordinul 132/2021 e abrogat (Ord. ANRE 17/2026, `REQ-SL-059`), deci orice mențiune e semnal tare | documentații republicate cu antet vechi dar cerință corectă | „FD cere autorizație ANRE pe un ordin abrogat (26.05.2026). Cere tipul exact (EDSB/PDSB/ET/PT) pe Ord. 17/2026.” | 6 |
| 3 | **PAT-STD-08** acte abrogate / ediții înlocuite | „ordinul 863/2008”, „ordin 863/2008”, „ntpee-2008”, „ordinul 5/2009”, „normativ i 6”, „normativul i6”, „legea 10/1995”, „legea 50/1991”, „sr en 1555:”, „sr en 13067:”, „sr en 12954:” | CS, FD, CT | — (review juridic) | Legea 10/1995 citată istoric în clauze de garanție; standardul citat cu ediția corectă | „DA trimite la acte abrogate sau ediții înlocuite. Cere ediția aplicabilă înainte de a cota.” | 1 (BO2026_1703, fără pagină la citate) |
| 4 | **PAT-CAL-04** legitimații ANRE cu terminologie veche | „gradul i”, „gradul ii”, „grad i”, „instalator autorizat anre”, „igib”, „rte pentru gaze”, „rte autorizat anre”, „responsabil tehnic cu execuția autorizat anre” | FD | se ignoră dacă același text conține „egd” / „pgd” / „egiu” / „egt” | „grad I” în alt context (categoria drumului) | „Personal cheie cerut cu tipuri ANRE vechi. Cere corespondența cu EGD/PGD/EGIU (Ord. 65/2023).” | 8 |
| 5 | **PAT-CAL-15** ANRE la roluri de conducere | pereche: („manager de proiect” sau „șef de proiect” sau „șef de șantier” sau „sef de santier”) la ≤ 300 de caractere de „anre” | FD | — | listă de personal unde ANRE e la instalator, nu la șef | „FD cere legitimație ANRE unui rol de conducere care nu execută instalații. Proporționalitate (L98 art. 178).” | 5 |
| 6 | **PAT-CAL-05** experiență similară „identică” | „lucrări identice”, „experiență identică”, „similare sau identice”, „rețea de distribuție gaze” (în secțiunea ES), „în același contract”, „in acelasi contract” | FD | doar în textul cerinței de ES (`ofertare_cerinte.tip = eliminatorie` cu „experiență”) | „identic” în clauze de echivalare („sau echivalent”) | „ES limitată la lucrări identice — Instr. ANAP 2/2017 art. 5 cere acceptarea celor similare/superioare.” | 10 |
| 7 | **PAT-CAL-07** documentele ES | „duse la bun sfârșit”, „dusa la bun sfarsit”, „proces-verbal de recepție finală”, „pv de recepție finală” | FD | semnal doar dacă lista de documente e **închisă** (nu conține „sau orice alt document”) | FD care enumeră exemplificativ („de exemplu”) | „FD nu spune ce documente dovedesc ES sau cere doar PV de recepție finală. Cere lista și acceptarea recepției la terminare.” | 15 |
| 8 | **PAT-GAZ-10** obiect mixt: racord/SRM + distribuție | pereche: („srm” sau „stație de reglare” sau „statie de reglare” sau „racord la snt” sau „conducta de transport”) **și** („presiune redusă” sau „presiune medie” sau „rețea de distribuție”) | CS, FD | FD cere un singur tip ANRE (numără aparițiile „edsb”/„pdsb” vs „et”/„pt”) | „SRM” în descrierea stației existente, nu în obiect | „Obiect cu presiune înaltă și distribuție: FD cere un singur tip de autorizare ANRE. Cere repartizarea pe tipuri și pe asociați.” | 6 (3 menținute) |
| 9 | **PAT-STD-15** regim de transport tratat ca distribuție | pereche: („snt” sau „sistemul național de transport” sau „conducta de transport” sau „otS”) **și** „ntpee”, fără „118/2013” și fără „clasa de locație” | CS | — | CS de distribuție care citează SNT doar la punctul de racordare | „Conductă din SNT, dar CS aplică NTPEE. Cere clasa de locație, procentul CND și presiunile de probă (Ord. 118/2013).” | 2 (ambele menținute, L99) |
| 10 | **PAT-AMB-11** proceduri „pentru toate categoriile”, interdicția copierii CS | „pentru toate categoriile de lucrări”, „proceduri tehnice de execuție”, „nu se acceptă copierea”, „preluarea caietului de sarcini”, „copierea caietului de sarcini” | FD | — | FD care listează explicit categoriile | „FD cere proceduri pentru toate categoriile fără listă — lipsa uneia a dus la neconformitate (BO2025_2118, menținută). Cere lista.” | 21 |
| 11 | **PAT-AMB-13 (+AMB-01)** P+E cu liste de cantități la ofertă | pereche: „proiectare și execuție” **și** („liste de cantități” sau „extrase de resurse” sau „formularul f3” sau „formularele f1”) | FD | se ignoră dacă FD conține „orientativ” lângă liste | P+E unde listele sunt explicit orientative | „La P+E listele din SF/DALI sunt orientative (Îndrumarea ANAP 2023); cere statutul lor și cine suportă diferențele.” | 10 / 9 |
| 12 | **PAT-CTR-04** cerință de calificare doar în CS | „ofertantul trebuie să dețină”, „ofertantul va face dovada”, „ofertantul trebuie să facă dovada”, „ofertanții trebuie să prezinte” | CS (nu FD) | semnal doar dacă fraza găsită în CS **nu** apare și în FD | CS despre materiale („produsul trebuie să dețină certificat”) — rată mare | „CS conține o cerință de calificare care nu e în anunț/FD (HG 395 art. 30 alin. (6)). Verifică dacă e produs sau ofertant.” | 7 |
| 13 | **PAT-TRM-06 (+TRM-01)** Gantt cu perioadă nefavorabilă / rezerve | „perioada nefavorabilă”, „timp friguros”, „perioadă de iarnă”, „rezerve de timp”, „graficul gantt” | FD, CS | — | Gantt cerut simplu, fără condiții | „Gantt-ul trebuie să includă perioada nefavorabilă fără interval dat. Cere intervalul și lucrările admise.” | 5 / 22 |
| 14 | **PAT-GAR-01** garanția de participare: formă / emitent | „scrisoare de garanție bancară” (fără „sau”), „emisă de o bancă”, „emisa de o banca”, „în original”, „rating”, „societate de asigurări agreată” | FD | + calcul: `garantie_participare` > 1 % × `valoare_estimata` | FD care listează toate formele admise | „GP limitată la bancă/original/rating — HG 395 art. 36 alin. (5) interzice. Cere acceptarea tuturor instrumentelor.” | norme; decizii la cerere |
| 15 | **PAT-GAR-03** perioada de garanție neprecizată / factor | „perioada de garanție” fără „categoria de importanță” / „clasa de consecințe” în același document; „garanție acordată lucrărilor” ca factor de evaluare | CT, FD | review juridic | contract cu perioada fixată în altă secțiune | „Perioada de garanție nu e legată de categoria de importanță / clasa de consecințe (L169/2026 art. 531). Cere minimul legal.” | 4 (fără nr. exact) |
| 16 | **PAT-AMB-02** factor de evaluare nedefinit | pereche: „factor de evaluare” / „factorul” **și** („tronson” sau „adecvat” sau „detaliat” sau „vehicule electrice” sau „angajați din” sau „contract colectiv de muncă”) | FD | review juridic | factori definiți cu algoritm clar (verifică „punctaj = ”) | „Factor de evaluare pe noțiuni nedefinite sau neverificabile — a dus la anularea procedurii (1837/C1/1961). Cere definiția și verificarea.” | 19 |
| 17 | **PAT-STD-01** probă de etanșeitate „24 ore” | regex (există deja în semnal): `etan[șs]eitate.{0,40}24\s*(h|ore)` | CS, F3 | **exclus** când PAT-STD-15 e declanșat (la transport 24 h e corect, `REQ-SL-024`) | transport; probe ale SRM făcute de producător | „CS cere 24 h pentru orice tronson; NTPEE Tabelul 8^1 dă durata după volum. Cere aplicarea tabelului.” | 0 (doar norme: `REQ-TG-088`) |
| 18 | **PAT-STD-09** ISCIR pe conducte de distribuție / SRM | pereche: („iscir” sau „rsvti”) la ≤ 200 de caractere de („conductă” sau „branșament” sau „srm” sau „instalație de utilizare”) | CS, FD | se ignoră lângă „compresor”, „macara”, „recipient” | utilaje cu recipient sub presiune (legitim) | „DA cere ISCIR pentru conducte de gaze, care sunt sub ANRE, nu ISCIR. Cere eliminarea sau precizarea echipamentelor vizate.” | 0 (norme) |
| 19 | **PAT-GAZ-15** instalații de utilizare incluse neclar | „racordarea consumatorilor”, „montaj contor și instalație”, „instalații interioare”, „instalație de utilizare” (în F3 cu articole de țeavă aparentă) | CS, FD, F3 | FD cere doar EDSB/PDSB (fără „edib”) | CS care descrie limita de proprietate corect | „Obiectul pare să includă instalații de utilizare, dar FD nu cere EDIB. Cere limita branșament / IU.” | 2 |
| 20 | **PAT-AMB-08** răspuns evaziv (pe răspunsurile AC) | „conform documentației de atribuire”, „se mențin prevederile”, „rămân neschimbate”, „respectă legislația”, „nu suntem de acord” | RC | semnal **slab**, review juridic; nu creează întrebare, doar marchează răspunsul pentru butonul „Răspuns neconcludent?” (§5) | răspunsuri care confirmă legitim o prevedere clară | „Răspuns generic — BO2024_2938 a obligat AC la răspunsuri punctuale. Decide: reformulare, contestare (termen) sau accept.” | 5 |

**Tipare din top cu detecție care NU e pe cuvinte-cheie** (rămân în regulile din §1 sau pe calcul): PAT-CTR-02 / PAT-GAZ-02 / PAT-GAZ-03 / PAT-GAZ-06 (comparator), PAT-GAZ-01 (comparație de documente: „presiune medie” în planșe/ATR vs „presiune redusă” în memoriu — se poate aproxima ca pereche de fraze în documente **diferite**, dar rămâne de verificat uman), PAT-TRM-02 / PAT-TRM-03 / PAT-TRM-05 (calcul pe date), PAT-INF-15 (ATR **lipsă** din inventar la înființare/extindere: regulă de absență, nu de prezență), PAT-CTC-09 (verificare internă, preț < 80 % VE).

Ce ar prinde azi pe cele două cazuri reale: **Mânăstirea** → #1 (PAT-GAZ-14, deja are fraze), **Răcari** → nimic pe cuvinte-cheie (e PAT-CTR-02, comparator). Deci pentru cazul Răcari valoarea nu vine din §2, ci din §1a plus livrarea comparatorului.

## 3. Formatul exact al citării (regula din MAPARE §4, deja în `formatCitare`)

- **Decizie cu număr exact și dată:** `Decizia CNSC nr. 3657/C1/4067, 4182 din 23.12.2024, p. 28 — <link_sursa>: „nu trebuie elaborate mai multe proiecte tehnice, de către fiecare dintre ofertanți”`
- **Decizie anonimizată în BO:** `Decizia CNSC publicată în BO nr. BO2022_2473 (nr./data anonimizate), p. 21 — <link_sursa>: „Autoritatea nu este abilitată să introducă cerințe care nu îi servesc la nimic”`
- **O singură dată per adresă**, sub titlul secțiunii: „Deciziile CNSC sunt invocate ca practică de interpretare a legislației achizițiilor publice, nu ca normă obligatorie.” (există în export)
- **Nu se exportă** fără: decizie `verificat`, neatacată, citat înghețat identic cu corpusul (trigger), pagină în `loc`, link. Rămâne fail-closed.
- **Cerință normativă** (azi exportul o **blochează**, pentru că `motivNeexportabil` acceptă doar decizii; propun formatul, de implementat în B redus): `<cod sursă>, <locator>` din `norme_surse.cod` + `norme_cerinte.locator`, ex. `HG 907/2016, Anexa, Secțiunea V — Formularul F3, Precizări`; `Legea 98/2016, art. 161 alin. (1)`; `Ordinul ANRE 89/2018 (NTPEE-2018), art. 273 alin. (2), Tabelul nr. 8^1`. Doar `temei_tip ∈ {OBLIGATORIE_LEGE, OBLIGATORIE_DOC_ACHIZITIE, GHID_INTERPRETARE}` și `verificat_pe_sursa = true`. O cerință cu `temei_tip = PRACTICA_CNSC` **nu se citează ca normă**: se citează decizia din `source_id` (ex. `REQ-AD-074` → BO2026_3104). Textul cerinței (`cerinta`) e parafrază a noastră și **nu intră între ghilimele**; între ghilimele intră doar textul actului, și doar dacă omul îl lipește din sursă (câmp liber, cu avertisment).
- **Tipar:** nu se citează niciodată în exterior (e al nostru).

**Trei defecte de corpus care strică formatul azi** (de corectat în corpus, cu owner, nu în cod):
1. `nr_decizie` cu note în paranteză la 3 decizii cu număr real — BO2024_3155 („3155/C7/3708 (dedus: …)”), BO2025_1775 („1775/C1/1915 (nr. decizie din BO; …)”), BO2025_2271 („2271/C9/2484 (confirmat în …)”) — azi ies **cu paranteză cu tot** în adresă. Regulă: `nr_decizie` ține doar `^\d+/C\d+/\d+(,\s*\d+)*$`; notele merg în `extra.nota_nr`. Până atunci, codul tratează orice `nr_decizie` care nu trece regex-ul ca anonimizat.
2. **34 de decizii cu citatele în format vechi** (text simplu, fără `loc`) și în total **57 fără nicio pagină** → neexportabile. Printre ele: BO2025_1050, BO2024_3154, BO2026_1703, BO2023_2299, BO2026_3118 — toate în precedentele tiparelor din §1. Rundă de corpus: pagină pe fiecare citat.
3. `loc` fără pagină („analiza cauțiunii”, „citat din hotărârea CA București”) la decizii citite din rezumat (BO2026_804, BO2026_328) — corect că nu ies; rămân „doar referință”.

## 4. Modelul de date minim — DOAR propunere; schema o aprobă Răzvan separat

Tabelul de legătură **există** și acoperă tot §1 (țintă = întrebare sau punct; temei = decizie / cerință / tipar; proveniență `pattern_id_origine`; citat înghețat; `confirmat`; `include_in_adresa`; RLS pe `fn_are_acces_ofertare()`; poarta de owner în trigger). **Nu propun nicio coloană nouă pe el.**

Ce lipsește, în ordinea costului:

| # | Obiect | Ce | De ce | Tip |
|---|---|---|---|---|
| 1 | `clarificari_tipare.trigger` (jsonb) | chei noi: `fraze text[]` (declanșatoarele din §2, normalizate), `excluderi text[]` (fraze care anulează), `perechi [[a,b]]` (ambele trebuie să apară), `conditii {tip_contract, fara_in: 'fisa_de_date'}`, `teme text[]` (filtrul de temă din §1c) | detecția existentă ia frazele din ghilimelele semnalului; semnalul e scris pentru om, nu pentru mașină | **date** (UPDATE pe tipare, owner; migrarea 20261015a nu e afectată: nu schimbă coloanele) |
| 2 | `ofertare_licitatii.regim_achizitie` | completare la cele 82 NULL; regulă de propunere: segment `transgaz`/`romgaz`/`conpet` → `sectorial`; `distributie` → `clasic`, confirmată de om | criteriul „legea” din ordonare e mort fără ea | **date** (preview → confirmare → apply) |
| 3 | `ofertare_clarificari_puncte` | `tip_punct text CHECK (tip_punct IN ('cantitate','cerinta','termen_criteriu_garantie','alt'))` NULL; `cmp_id bigint REFERENCES ofertare_cant_cmp(id)` NULL (rândul de comparație care a născut punctul; rândurile `cmp` sunt imuabile per calcul, deci referința e stabilă) | §1a are nevoie de legătura punct ↔ discrepanță, iar §1 de tipul punctului pentru a alege familia de tipare | **schemă** (2 coloane nullable + 1 FK) — alternativa fără schemă e în Q2 |
| 4 | cod, nu BD | tabela de mapare `(tip_punct, rol_b, tip_lucrare, familie) → pattern_id[]` din §1a–1c, în `ofertareTemeiuri.js`, cu teste; funcția `propuneriDinTipar` primește criteriile 5–6 (citabilitate, exportabilitate) și familia gaze = {gaze, distributie} | regulile deterministe se versionează cu codul | cod (sesiunea Ofertare) |
| 5 | corpus | curățarea `nr_decizie` (§3.1), pagini la cele 57 de decizii (§3.2), `verificat_instanta_la` (propus deja în MAPARE §2) | fără ele regula din §1 propune decizii pe care exportul le refuză | **date** (rundă de cercetare, owner) |

Securitate: nimic nou — tabelele, RLS și poarta de owner există; `trigger` pe tipare e deja scris doar de owner; `cmp_id` e FK spre un tabel cu RLS Ofertare. Fără AI, fără cost, fără service_role.

## 5. Ce rămâne explicit pe mai târziu

- **Exportul cerințelor normative în PDF** (formatul din §3) și a doua secțiune „Temei legal invocat” — după acordul pe format.
- **„Răspuns neconcludent?”** pe întrebarea răspunsă: PAT-AMB-08 + calculul termenului de contestare (PAT-TRM-03: 10/7 zile, din ziua următoare publicării; VE față de 26.960.556 lei) + fereastra de reformulare; depinde de #610 (termenul pentru întrebări) și de un registru al datelor răspunsurilor (`ofertare_clarificari_jurnal` există, gol).
- **Comparatorul (TKT-0329 PR3–PR5)** e al sesiunii Ofertare; §1a consumă `ofertare_cant_cmp` când va avea rânduri, până atunci `diferenta_nota`.
- **Matricea per licitație (C)**, **re-rank AI** cu poarta pe cheltuială, **reformularea #226** ca RAG peste corpus — cum erau în MAPARE §5.
- **Veghe CNSC + ANAP** (`VEGHE_CNSC_ANAP_SPEC.md`) — alimentarea corpusului; fără ea, lista de decizii cu număr exact pe gaze (25) nu crește.
- **Fișa pentru avocat** (export pe licitație a tuturor temeiurilor, cu citate) — după ce temeiurile încep să fie folosite (azi 0 rânduri).
- **Descompunerea întrebărilor în puncte** de către generator (azi 0 puncte): §1 funcționează și pe întrebare întreagă (`clarificare_id`), dar temeiul pe punct e mai precis.

---

## Rezumat (pentru sesiunea de chat)

1. **B nu mai e de construit, e de folosit**: tabelul, „⚖️ Temei”, „Tipare declanșate”, exportul și poarta de owner sunt live din PR #615/#618/#620 (05–06.10), cu **0 rânduri** folosite; spec-ul e un delta: reguli pe tip de punct (§1), fraze declanșator pentru 20 de tipare (§2, azi doar 11/119 detectabile), formatul pentru norme (§3), 2 coloane nullable pe puncte + chei JSON pe tipare (§4).
2. **Răcari nu se prinde din cuvinte-cheie**, ci din comparator (PAT-CTR-02); temeiul pentru cantități e întâi norma (HG 907 F3 Precizări `REQ-AD-123`, HG 1/2018 cl. 49.1), apoi BO2026_3104 — **niciun precedent de cantități nu are număr exact**.
3. **Corpusul are 57/216 decizii fără pagină la citate și 3 cu paranteze în `nr_decizie`** → neexportabile sau exportate cu note; e rundă de corpus (owner), nu cod. `regim_achizitie` e NULL la 82/88 licitații → criteriul „legea” din ordonare e inactiv.
4. **Q1 (cantități):** A) cităm decizii doar cu cod BO + link (formatul există) — *recomand*; B) la cantități doar norme, fără decizii; C) așteptăm veghe CNSC pentru decizii cu nr. exact. **Q2 (tipul punctului):** A) 2 coloane nullable pe `ofertare_clarificari_puncte` (schemă, aprobare separată); B) fără schemă, în `ofertare_clarificari.baza_generare` jsonb — *recomand pentru „redus”*; C) doar din `sursa_tip` al generatorului. **Q3 (frazele din §2):** A) sesiunea juridică le validează pe 3 licitații și le scrie în `trigger.fraze` (date, owner apply) — *recomand*; B) Ofertare le pune în cod; C) ambele.
5. Următorul pas al meu, dacă Răzvan zice da la Q3-A: rulez frazele pe textele extrase ale celor 3 licitații (doar SELECT) și raportez falsurile pozitive înainte de orice UPDATE pe tipare.
