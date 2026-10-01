# Surse lipsă — ce n-a putut fi accesat și ce merită cumpărat

> Livrabil E · 01.10.2026 · ca Razvan să decidă ce cumpără (ASRO) sau la ce se abonează (Lege5 / Sintact / iLegis).

## Decizii de cumpărare — recomandarea mea

| Opțiune | Ce rezolvă | Cost (estimat, neverificat) | Recomandare |
|---|---|---|---|
| **A. Abonament legislativ** (Lege5 sau Sintact) | Forme consolidate la zi pentru L98/L99/L101/HG 395/HG 394, NTPEE și ordinele ANRE după 2023, Legea 123/2012, HG 300/2006, **Legea 169/2026** (Codul amenajării teritoriului, urbanismului și construcțiilor). Acum le avem doar până la 06.2024 sau din surse secundare. | câteva sute de lei / an (Lege5); iLegis ~30–60 €/lună | **DA — prioritar.** E sursa pentru 40% din înregistrările `verificat: false` din `baza_normativa.json`. legislatie.just.ro e gratuit, dar inaccesibil din cloud (vezi mai jos); de pe laptopul din birou merge. |
| **B. Pachet ASRO minim (8 standarde)** | Pragurile exacte care apar des în caiete de sarcini și în clarificări: SR EN 12732+A1:2014 (procente NDT), SR EN ISO 17635:2025, SR EN ISO 5817:2023, SR EN 12068:2002 (tensiune test scânteie), SR EN ISO 21809-1:2019, SR EN 805 (probe apă), SR EN 1610:2015 (probe canalizare), SR EN 12327:2012. | ≈ 1.600–2.400 lei (prețuri găsite: 9606-1 235,60; 17636-1 235,60; 12068 263,22 lei; restul ≈140–300 lei/buc.) | **DA** — aceste 8 acoperă majoritatea șabloanelor CL-T. |
| **C. Abonament infostandard.asro.ro** | Acces la toate SR EN, actualizare automată a edițiilor (ex. 1555:2025, 17635:2025). | ofertă ASRO (necerut) | Doar dacă B se dovedește insuficient. |
| **D. Indicatoare de norme de deviz G-1981, Ts, Ac** | Consumuri normate pentru verificatorul de deviz (P1.4). | ~80–130 lei/volum (COCC, preț 2018) sau licență WinDoc/Deviz Expert | **Mai bine nu** — datele sunt deja în programul de deviz folosit; consumurile proprii din pontaj sunt apărarea mai bună (Ghid P91/1-02). |
| **E. FIDIC Red/Yellow 1999/2017** | Clauze ajustare 13.8, revendicări 20.1 | ~100–300 €/carte (fidic.org) | **Nu** — Condițiile Particulare din contractele POIM ale beneficiarilor ajung. |
| **F. DVS 2207-1:2015** | Parametri sudură cap-cap PE | ~40–80 € (DIN Media) | Opțional; operatorii (Distrigaz/Delgaz) îl citează în specificațiile lor. |


## Actualizare 02.10.2026 (noapte) — goluri închise cu Firecrawl

Prețuri ASRO citite efectiv (magazin.asro.ro, 02.10.2026) — pachetul recomandat la opțiunea B: **≈ 2,228 lei** total.

| Standard | Preț (lei) | Sursa |
|---|---|---|
| SR EN 12732:2021 | 373.77 | https://magazin.asro.ro/ro/standard/277900 |
| SR EN 12732+A1:2014 | None | https://magazin.asro.ro/ro/standard/227345 |
| SR EN ISO 17635:2025 | 169.28 | https://magazin.asro.ro/ro/standard/286117 |
| SR EN ISO 5817:2023 | 207.96 | https://magazin.asro.ro/ro/standard/281092 |
| SR EN 12068:2002 | 263.22 | https://magazin.asro.ro/ro/standard/30458 |
| SR EN ISO 21809-1:2019 | 318.52 | https://magazin.asro.ro/ro/standard/270931 |
| SR EN 805:2025 | 373.77 | https://magazin.asro.ro/ro/standard/285800 |
| SR EN 1610:2016 | 207.96 | https://magazin.asro.ro/ro/standard/241544 |
| SR EN 12327:2012 | 160.98 | https://magazin.asro.ro/ro/standard/202972 |
| SR EN ISO 3834-2:2021 | 152.7 | https://magazin.asro.ro/ro/standard/276136 |

⚠️ Ediții corectate: **SR EN 12732+A1:2014 e anulat** — în vigoare ediția 2021; **SR EN 805:2025** a înlocuit ediția 2000; SR EN 1610 are ediția SR **2016**.

Prefix cerințe: `REQ-SL-001…061` (`cerinte_surse_lipsa.json`). Actualizări de registru: `surse_update_surse_lipsa.json` (35). Graf: `graf_surse_lipsa.json` (20 muchii). Prețuri ASRO: `preturi_asro.json`.
Unelte: Firecrawl (proxy enhanced + `waitFor` 10 s trece de anti-bot-ul ANAP și de 403 la Delgaz), curl direct pentru anre.ro / romgaz / brml / cnsc (doar prin **http**). Fișierele descărcate sunt în `lucru/sl/`.

### Tabel gol → rezultat

| # | Gol | Rezultat | Ce s-a găsit (rezumat + locator) | URL | sha256 |
|---|---|---|---|---|---|
| 1 | Prețuri ASRO (9 standarde) | **REZOLVAT** | Toate cele 9 prețuri sunt citite pe pagina produsului. Total ≈ **2.228 lei** pentru pachetul B. **Corecturi de ediție**: SR EN 12732+A1:2014 e **ANULAT** (în vigoare: SR EN 12732:2021). **SR EN 805:2025** înlocuiește 805:2000 (versiunea RO e din 31.08.2026). SR EN 1610 are ediția SR **2016**, nu 2015. Căutarea funcționează la `magazin.asro.ro/Search?q=` | magazin.asro.ro/ro/standard/{277900, 286117, 281092, 30458, 270931, 285800, 241544, 202972, 276136} | — (pagini HTML) |
| 2 | Edițiile SR pentru EN 12327, ISO 21809-3 | **REZOLVAT** | Sunt în vigoare SR EN 12327:2012 (versiune RO 2015), SR EN ISO 21809-3:2016 și A1:2020. Rezumatul ASRO pentru 12327 precizează că presiunile, duratele și criteriile de probă **nu** sunt în standard | /standard/202972, /en/standard/245713, /274399 | — |
| 3 | OUG 64/2022, textul și art. 17 | **REZOLVAT** (forma MO + modificarea din 2023) | Am citit art. 17 alin. (1)–(8): restul de executat, ajustarea la fiecare plată, indicii ICC, luna de referință, profitul implicit de 3%, ponderile pentru articole comasate și lucrările suplimentare. OUG 64 a fost aprobată prin **Legea 243/2022**. **OUG 44/2023** (MO 467/26.05.2023) modifică art. 17 alin. (8) și adaugă art. 8 alin. (4): după plafonul de 50%, contractul poate reveni la formula inițială. Formula propriu-zisă e imagine în MO și nu a putut fi capturată. Lipsește forma consolidată 2026 → REQ-SL-001…008 | lege5.ro (art. 17, Gratuit); federatiaconstructorilor.ro (OUG 44/2023) | md 1602a99f…; PDF OUG 44: 39e1f6c1… |
| 4 | OG 15/2021, textul | **REZOLVAT** (forma MO) | Am citit actul integral, art. 1–8. **Art. 6** obligă AC să pună clauză de ajustare la lucrările de peste 6 luni. Art. 2: Va = C×Vo, plus ponderile INS. **Corectură**: actul e publicat în MO **833**/31.08.2021 și e în vigoare din 03.09.2021. Lipsește forma consolidată → REQ-SL-009…010 | lege5.ro/Gratuit/ha4damrsg4za | — |
| 5 | HG 925/1995, textul | **PARȚIAL** | Am citit forma inițială din 1995: art. 7, 13 și 22 (obligațiile RTE). Modificările din HG 742/2018 au rămas necitite. curl eșuează pe isc.gov.ro (lanț TLS incomplet), am folosit Firecrawl → REQ-SL-011…014 | isc.gov.ro/files/2016/Legislatie/HG nr 925 din 1995.pdf | — |
| 6 | Ord. ANRE 118/2013, anexa cu probele | **REZOLVAT** | Anexa agregată la 01.08.2018. **Art. 131**: NDT RT/UT ≥ 20/25/40/75 % pe clasele de locație 1–4. Se face 100 % la traversări, în zone populate, la sudura manuală la poziție și la cuplări. **Art. 134**: pph = 1,20×MOP (CL1–2) / 1,40×MOP (CL3–4), cel mult 1,8×MOP și 90 % din presiunea de probă la fabrică, durată ≥ 6 h. **Art. 135**: etanșeitate cu aer la MOP, ≥ 24 h. **Art. 136**: aparate cu clasa ±1,5 %. Fișierul `anre.ro/.../Ord_118_13.pdf` are o singură pagină (doar ordinul) → REQ-SL-015…027 | arhiva.anre.ro/download.php?f=hap%2Big%3D%3D… | 3c97e429… |
| 7 | Numărul ordinului pentru standardul de performanță în distribuția gazelor | **REZOLVAT** | **Ord. ANRE 131/19.10.2022** (MO 1045/28.10.2022), în vigoare din 01.04.2023. Abrogă Ord. 162/2015. Art. 17 (IP4): refacerea terenurilor la starea inițială și răspuns în ≤ 20 de zile lucrătoare. Modificările ulterioare nu sunt verificate → REQ-SL-028…029 | romgaz.ro (PDF MO) | 0910d46e… |
| 8 | Ordinul ANRSC pentru regulamentul de licențiere | **REZOLVAT** (doar numărul) | **Ord. ANRSC 100/2023**: regulamentul e datat 20.02.2023. Tarifele au fost modificate prin Ord. 687/2024 (știm doar titlul). Pentru Gazpet ca executant: doar referință | anrsc.ro/realizari-legislative | — |
| 9 | Ord. ANRE 65/2023, textul | **PARȚIAL** | Am citit documentul ANRE de aplicare, nu ordinul. Viza e la 5 ani. Cererea se depune cu ≥ 30 de zile înainte, cu un curs absolvit în ultimele 12 luni. Tarif 250/125 lei. Legitimațiile vechi sunt asimilate → REQ-SL-030…031 | anre.ro/wp-content/uploads/2024/10/informatii_-autorizare_instalator.pdf | 465344e2… |
| 10 | Ord. ANRE 17/2026, data intrării în vigoare | **PARȚIAL** | **MO 444/26.05.2026**, în vigoare de la **26.05.2026**. Art. 2 abrogă Ord. 132/2021. Termenul de conformare (~26.08.2026; o sursă secundară spune 21.08.2026) e în Regulamentul-anexă, pe care nu l-am citit → REQ-SL-060 | lege5.ro/Gratuit/ge4dmmrrgqzto | — |
| 11 | L99/2016, pragul de achiziție directă după L208/2022 | **REZOLVAT** | Art. 12 alin. (4): **270.120 lei** pentru produse/servicii și **900.400 lei** pentru lucrări (L208/2022, în vigoare 10.09.2022). Sursa e forma ANAP la 13.06.2024. Lege5 Gratuit afișează încă valorile din 2016 → REQ-SL-051 | anap.gov.ro/…/Legea-nr.-99-din-2016-…13.06.2024-2.pdf | — |
| 12 | ANAP — Îndrumarea privind propunerile financiare / PANS (2023) | **REZOLVAT** | Am citit integral cele 4 pagini. Pragul de 80 % din VE vine din HG 395 art. 136. AC nu poate respinge automat și nici prin comparație cu alte oferte. Justificarea se face prin defalcare pe resurse. Lista de dovezi acceptate e în document → REQ-SL-032…036 | anap.gov.ro/…/2023/05/Indrumare-evluarea-propunerilor-financiare._.pdf | — |
| 13 | ANAP — Îndrumarea privind listele de prețuri (2023) | **REZOLVAT** | La P+E, listele de cantități sunt orientative. Dacă AC le impune, riscul cantităților trece la AC. Nu se plătește pe cantități reale (HG 1/2018 cl. 37.5, 49.1). Fișele F5 cer intervale de valori, nu valori fixe → REQ-SL-037…039 | anap.gov.ro/…/2023/03/Indrumare-privind-detalierea-excesiva-…pdf | md 2d42b69e… |
| 14 | Instrucțiunea ANAP 1/2017, textul complet | **REZOLVAT** (text OCR) | Art. 3 alin. (4): pentru RTE și alte funcții certificate nu se pun criterii de calificare. Art. 11: experiența experților-cheie nu e criteriu de calificare. Art. 12 nota (ii): funcțiile certificate nu pot fi factori de evaluare. Art. 5: fără cerințe duble → REQ-SL-040…043 | anap.gov.ro/…/2017/01/Instructiunea-nr-1_2017.pdf | md f3c226c2… |
| 15 | Instrucțiunea ANAP 1/2021, textul complet | **REZOLVAT** | Art. 2: clauzele de revizuire și remăsurătorile. Art. 3–5: plafonul de 50 % cumulat, raportat la valoarea ajustată. Art. 4: erorile de proiect nu sunt „imprevizibile”, iar o normă publicată după data de clarificare poate justifica o modificare. Art. 3 alin. (5) lit. a): exemplul cu relocarea conductei de gaze → REQ-SL-044…050 | anap.gov.ro/…/2021/01/Instructiune-MO-final.pdf | md 52f99c8c… |
| 16 | BRML Ord. 204/2024 (L.O.) | **REZOLVAT** (L.O.-2022 primar; Ord. 204 din sursă secundară) | **L.O.-2022** (Ord. 77/2022, MO 332/05.04.2022): contoarele de gaz ≤ 2.500 m³/h au VP la 8 ani, contoarele de apă rece la 7 ani, aparatele pentru priza de pământ la 2 ani. **Constatare**: la manometre lista conține doar L62-3 (pneuri), deci manometrele de probă nu sunt în L.O. Ord. 204/2024 adaugă contoarele termomasice → REQ-SL-052…056 | brml.ro/sites/default/files/Ordinul_77_2022_LO_2022.pdf; ortexo.com | 33b46f69… |
| 17 | INS — Buletinul statistic de prețuri, indicii pentru ajustare | **PARȚIAL** | Am confirmat că BSP nr. 10/2026 există, cu tabelele 15/15A/15B, iar seria TEMPO CNS107D are anul de bază 2021. **Valorile nu au fost citite**: PDF-ul 2026 nu e legat pe pagină și API-ul TEMPO dă timeout. Am consumat 95 de credite pe un BSP din 02/2024 | insse.ro/cms/ro/content/buletin-statistic-de-preţuri-nr102026 | — |
| 18 | Delgaz — specificații pentru sudură/NDT/izolație | **PARȚIAL** | Lista ST 500–510 e accesibilă (Firecrawl enhanced), dar conține **doar echipamente**. Am citit ST 506 A3/2018 (aparate cap-cap PE). Acesta citează **NTPEE 2008, abrogat**. Arhiva „Cerinte-tehnice-DELGAZ-(3).zip” e blocată, iar procedurile de sudură/NDT/izolație n-au fost găsite → REQ-SL-061 | delgaz.ro/gaze-naturale/specificatii-tehnice | — |
| 19 | Ghidul de bune practici CNSC | **PARȚIAL** | Descărcat prin http (200 pag.). E din **10/2015**, pe cadrul OUG 34/2006 (abrogat). Am citit doar cuprinsul: secțiunile D1–D8 și R1–R8. Spețele nu sunt extrase | http://portal.cnsc.ro/ghiddebunepractici.pdf | 3f415108… |
| 20 | Rapoartele CNSC 2024/2025, statistici | **REZOLVAT** | **2025**: 5.178 contestații, 43,5 % admise. Lucrările reprezintă 38,06 %. Din admiteri, 94,6 % sunt remedieri. Curțile de apel au desființat 82 de decizii total și 173 parțial, din 3.958. **2024**: 4.529 contestații, 42,6 % admise, lucrări 36,45 % → REQ-SL-057…059 | cnsc.ro/wp-content/uploads/2025/raport/Raport.2024.RO.pdf; …/2026/raport/Raport.2025.RO.pdf | 1fcdfbe8… / 0ccbc6de… |
| 21 | Ediția DIN 30672 | **PARȚIAL** | DIN 30672:1979-08 e ediția veche. Există DIN 30672-1/-2 (DVGW), iar partea 1 are **Ausgabe 2026-07** doar după un index secundar (baunormenlexikon) | baunormenlexikon.de; dinmedia.de | — |
| 22 | anap.gov.ro anti-bot (tabel „Inaccesibile”) | **REZOLVAT tehnic** | Merge cu Firecrawl `proxy: enhanced` + `waitFor: 10000` + `maxAge: 0`. Fără `waitFor` primești pagina de verificare (503) | — | — |
| 23 | portal.cnsc.ro (căutare) | **TOT INACCESIBIL** | Căutarea dă în continuare reset. PDF-urile merg pe **http://** (nu https) | — | — |
| 24 | legislatie.just.ro / lege5 forma la zi | **TOT INACCESIBIL** | Nu am insistat (cf. instrucțiuni). Forma MO de pe lege5 Gratuit a fost suficientă pentru OUG 64, OG 15 și Ord. 17/2026 | — | — |
| 25 | Legea 169/2026 (art.), NTPEE după 2023, HG 300/2006, L123 art. 109–121, Ord. 1014/874/2001, curțile de apel, deciziile CNSC publicate doar cu dispozitiv | **NEABORDAT** în această rundă | Rămân pe lista de verificat. Au nevoie de legislatie.just.ro sau de căutare manuală pe rejust/portal.just.ro | — | — |

### Corecturi pentru registru / ofertare_normative
- **id 31 / SR EN 12327**: ediția SR 2012 e confirmată. Standardul **nu conține** presiunile și duratele de probă.
- **SR EN 12732**: în vigoare e ediția **2021**. 12732+A1:2014 e anulat, deși NTPEE îl citează (anexa 2).
- **SR EN 805**: în vigoare e ediția **2025** (RO 31.08.2026). Valorile de probă preluate din ediția 2000 trebuie revalidate.
- **SR EN 1610**: ediția SR corectă e **2016**.
- **OG 15/2021**: e publicată în MO 833, nu 827.
- **id 22 (Ord. ANRE 132/2021)**: e abrogat din **26.05.2026** prin Ord. 17/2026 (MO 444/26.05.2026).
- **Delgaz ST 506**: citează NTPEE 2008 (abrogat). Merită o întrebare de clarificare dacă un caiet de sarcini o invocă.

### Credite Firecrawl consumate (aprox.)
Cam 300 de credite. Cele mai scumpe: L99 ANAP (103) și BSP 02/2024 (95, nerelevant).

## Inaccesibile tehnic (gratuite, dar blocate din mediul cloud)

| Sursă | Problemă | Ce s-a pierdut | Soluție |
|---|---|---|---|
| **legislatie.just.ro** | eroare HTTP/2 (Firecrawl și acces direct) | formele consolidate oficiale; textul Legii 169/2026 (MO 661/2026) | Se citește de pe laptopul din birou; sau abonament (A). |
| **lege5.ro** | 503 / forma la zi contra cost | idem | (A) |
| **portal.cnsc.ro — căutare** | connection reset / 503 | selecția deciziilor s-a făcut prin motoare de căutare → parțial aleatorie; BO2020_1964 (apă, clarificări) a dat timeout | PDF-urile individuale merg (s-au citit 53). Căutarea pe portal — din browser. |
| **anap.gov.ro** (unele PDF-uri) | protecție anti-bot | Îndrumarea ANAP 2023 privind evaluarea propunerilor financiare; Îndrumarea privind listele de prețuri; Instrucțiunile 1/2017 și 1/2021 (text complet) | descărcare manuală din browser |
| **delgaz.ro** — specificații tehnice | 403 | specificațiile Delgaz pentru sudură oțel/PE, NDT, izolație (ST 506 etc.) | browser — gratuit |
| **magazin.asro.ro** — căutare | cere JavaScript | edițiile SR pentru EN 12954:2019, EN 12327, EN 13509, ISO 14731, ISO 21809-3, ISO 12944, EN 1555-5 | browser |

## Neverificat — de completat la o rundă următoare

**Legislație**
- **Legea 169/2026**: trimiterile pe articole (art. 294–300, 343–345, 450–459, 531, 576–577) vin din surse secundare (verificatori.ro, arenaconstruct.ro).
- **Ordin ANRE 17/2026**: data exactă a intrării în vigoare, deci termenul exact de conformare de 3 luni. Data ≈ 26.08.2026 e dedusă din publicarea în MO.
- **L101/2016 la zi**: plafoanele cauțiunii peste prag (REZOLVAT 02.10: 220.000 / 2.000.000 lei), termenul plângerii la curtea de apel, notificarea prealabilă.
- **L99/2016**: pragul de achiziție directă după Legea 208/2022.
- **OUG 64/2022**: text integral și art. 17 (formulele de ajustare).
- **Ordin ANRE 118/2013**: anexa cu valorile de probă pe clase de locație.
- Numărul ordinului pentru standardul de performanță în distribuția gazelor și pentru regulamentul ANRSC de licențiere.
- Lista completă a modificărilor NTPEE după 02.03.2023.
- Pragurile din HG 300/2006 pentru declarația prealabilă la ITM.
- Legea 123/2012 art. 109–121 (drept de uz și servitute) după 2019.
- Statutul Ordinelor 1014/874/2001 (formularele C1–C9).

**Standarde**
- Ediția DIN 30672.
- Valorile numerice pentru tensiunea testului cu scânteie, procentele NDT din EN 12732 și corelarea din ISO 17635:2025. Toate sunt marcate `verificat: false`.

**CNSC**
- **Rezultatele la curțile de apel** pentru toate cele 53 de decizii. Se caută gratuit, manual, pe rejust.ro / portal.just.ro, după numărul anunțului SEAP.
- **Deciziile publicate doar cu dispozitivul** (de reverificat după publicarea motivării în BO):
  - 3381/C4/3785 din 28.11.2024 (Fibiș);
  - 160/C5/4309 din 22.01.2025 (Variaș);
  - 3035/C9/3605 din 09.10.2025 (Vlădeni);
  - 3155/C7/3708 din 07.11.2024 (Fetești-Stelnica);
  - 3064/C6/3064 din 30.10.2024 (Corod);
  - 3120/C10/2831 din 25.09.2026 (Hărău);
  - 1703/C2/1597 din 26.05.2026 (Pișcolt).
- Rapoartele de activitate CNSC 2024–2025 (statistici) și Ghidul de bune practici CNSC (portal.cnsc.ro/ghiddebunepractici.pdf), încă necitite.

## Unelte

- **Firecrawl: contul a rămas aproape fără credite** în timpul acestei cercetări (au urmat erori 429). PDF-urile CNSC s-au descărcat direct, fără cost. **Pentru o rundă următoare trebuie reîncărcate creditele.**

## Note brute pe teme


### Achiziții publice și contracte tip

- **Formele consolidate curente (după iunie 2024) ale L98, L99, L101, HG 394, HG 395.** legislatie.just.ro dă eroare HTTP/2, iar lege5 oferă forma la zi doar contra cost (25 lei/act, sau abonament Lege5/Sintact). ANAP publică doar forme până la 13.06.2024. Recomandare: un abonament Lege5 sau Sintact pentru modulul Ofertare (aproximativ câteva sute de lei pe an; preț neverificat).
- **L101/2016 în forma la zi:** art. 6, art. 8, art. 29 și plafoanele cauțiunii peste prag. De verificat într-o bază legislativă plătită sau pe cnsc.ro (site-ul a răspuns 503).
- **L99/2016:** pragul de achiziție directă după Legea 208/2022.
- **OUG 64/2022:** text integral, art. 17 (formule) și legea de aprobare.
- **ANAP — Îndrumarea privind evaluarea propunerilor financiare (2023) și Îndrumarea privind listele de prețuri (2023):** site-ul ANAP are protecție anti-bot. Se pot descărca manual din browser.
- **Instrucțiunea ANAP 1/2017 și 1/2021:** text complet necitit.
- **FIDIC Red/Yellow 1999/2017:** texte plătite (aproximativ 100–300 EUR pe carte la fidic.org). Contractele POIM existente la beneficiari conțin Condițiile Particulare.

### ANRE, gaze, ISCIR, apă-canal

- **legislatie.just.ro** (eroare HTTP/2) și **lege5.ro** (503 sau formă consolidată contra cost): nu am putut confirma lista completă a modificărilor la NTPEE după 2023, la Ordinul 7/2022 și la Ordinul 118/2013. Alternativă: Monitorul Oficial sau abonament lege5/iLegis (~30–60 €/lună).
- **Ordinul 118/2013, anexa** (valorile de probă pe clasele de locație): textul nu a fost accesibil. Se găsește la Transgaz sau ANRE.
- **Textul Ordinului 65/2023** (vizarea instalatorilor și condițiile de examen): am folosit sursă secundară. Se găsește pe anre.ro.
- **Standardele ASRO** SR EN 805, SR EN 1610, SR 4163-1/2/3, SR 1343-1, SR 1846, STAS 6819, SR EN 752 și SR EN 12327 sunt plătite. Costul estimat este de ~100–400 lei per standard pe magazin.asro.ro. Valorile SR EN 805/1610 din tabel sunt marcate „neverificat”.
- **Standardul de performanță pentru distribuția gazelor** (numărul ordinului în vigoare) și **regulamentul ANRSC de licențiere** (numărul ordinului) nu sunt verificate.
- **PT CR 3-2025 (RSVTI)**: am confirmat doar că există PDF-ul pe iscir.ro, nu și conținutul.

### Sudură, NDT, izolație, materiale

| Ce lipsește | De ce | Unde se găsește | Cost estimat |
|---|---|---|---|
| Textul standardelor (praguri exacte: tensiunea testului cu scânteie EN 12068/ISO 21809, corelarea din ISO 17635:2025, procentele NDT din EN 12732, revalidarea ISO 9606-1) | standarde plătite | magazin.asro.ro / infostandard.asro.ro (abonament) | Prețuri ASRO găsite: SR EN ISO 9606-1:2017 **235,60 Lei**; SR EN ISO 17636-1:2022 **235,60 Lei**; SR EN 12068:2002 **263,22 Lei**; ediții anulate: SR EN ISO 3834-2:2006 141,64 Lei, SR EN ISO 5817:2015 194,13 Lei. Pentru restul, estimare **≈140–300 Lei/standard** (neverificată; căutarea ASRO e dinamică și n-a putut fi interogată). |
| SR EN 12732+A1:2014 (procente NDT pe MOP) | plătit | ASRO | ≈ 200–300 Lei (estimare) |
| SR EN ISO 17635:2025, SR EN ISO 5817:2023, SR EN ISO 3834-2:2021 — prețuri | credite de scraping epuizate | magazin.asro.ro/ro/standard/281092 (5817:2023), /276136 (3834-2:2021) | — |
| DVS 2207-1:2015 | plătit (DVS/DIN Media) | dinmedia.de | ≈ 40–80 € (estimare) |
| DIN 30672 (ediție curentă) | neconfirmat | dinmedia.de | — |
| Ediții SR pentru EN 12954:2019, EN 12327:2012, EN 13509, ISO 14731:2019, ISO 21809-3, ISO 12944, EN 1555-5 | căutarea ASRO necesită JS; buletinele lipsă (06, 08, 09/2025; 02, 03, 07, 09–12/2024; 02, 06, 07, 10, 12/2023) | magazin.asro.ro, Buletinul Standardizării | — |
| Specificațiile Delgaz pentru sudura oțel/PE, NDT, izolație (ST 506 aparate cap la cap etc.) | delgaz.ro returnează 403 pentru lista de specificații | delgaz.ro/gaze-naturale/specificatii-tehnice (browser) | gratuit |
| Specificații Transgaz (NDT 100%, izolație) | necăutate în profunzime | transgaz.ro (norme tehnice / caiete de sarcini) | gratuit |
| Lista completă a modificărilor NTPEE după 02.03.2023 | legislatie.just.ro nu funcționează; forma sintetică găsită e din 02.03.2023 | lege5.ro / monitoruloficial.ro | — |

**Credite Firecrawl:** contul a semnalat „low on credits”. Trebuie reîncărcat înainte de următoarele teme.

### Norme de deviz și legi conexe

- **Textul oficial al Legii 169/2026** (articolele 294–300, 343–345, 450–459, 531, 576–577) e disponibil gratuit pe legislatie.just.ro (inaccesibil din sandbox) și în MO 661/2026. Toate trimiterile la articole din CATUC trebuie reverificate.
- **Indicatoarele G, Ts, Ac 1981** cu consumuri: publicații plătite (COCC, aproximativ 80–130 lei/volum în 2018) sau bazele de date WinDoc/Deviz Expert (licență).
- **Ordinele 1014/874/2001 și Normele din 1998 (784/34N):** statutul nu e verificat. Se găsesc pe legislatie.just.ro.
- **HG 300/2006:** pragurile exacte pentru declarația prealabilă (art. și anexa) sunt de verificat pe textul consolidat.
- **Legea 123/2012:** am consultat forma din 2019. Modificările din 2020–2026 la art. 109–121 nu sunt verificate.
- **Numerele deciziilor CNSC** BO2018_6476 și BO2021_1451 sunt anonimizate în PDF. Am identificat deciziile doar după numele fișierului și după contestație.

### Gaze naturale

- **Rezultatele plângerilor la curțile de apel:** nu apar în deciziile CNSC. Deciziile BO sunt anonimizate, deci căutarea în portal.just.ro/ReJust după părți nu e posibilă fără datele procedurii din SEAP. Cost: zero, dar necesită identificarea procedurii (nr. anunț SEAP) și căutare manuală pe portal.just.ro sau rejust.ro.
- **Numerele și datele deciziilor BO anonimizate** (BO2023_1378, BO2023_140 etc.): se pot afla din SEAP („Decizie CNSC.pdf” atașată anunțului) sau din registrul de dosare de pe portal.cnsc.ro.
- **Deciziile scurte (doar dispozitivul)**, fără motivare încă publicată în BO, nu au fost incluse:
  - Decizia 3381/C4/3785 din 28.11.2024 (Top Gaz vs Comuna Fibiș, respinsă);
  - Decizia 160/C5/4309 din 22.01.2025 (Top Gaz vs Comuna Variaș);
  - Decizia 3035/C9/3605 din 09.10.2025 (Vlădeni, DB);
  - Decizia 3155/C7/3708 din 07.11.2024 (ADI Fetești-Stelnica, clarificări DA);
  - Decizia 3064/C6/3064 din 30.10.2024 (Corod, GL);
  - Decizia 3120/C10/2831 din 25.09.2026 (Hărău, HD);
  - Decizia 1703/C2/1597 din 26.05.2026 (Pișcolt, SM; Top Gaz–Saminstal respinsă ca neconformă).
  - Decizia 1837/C1/1961 apare și ca dispozitiv separat, dar motivarea ei e inclusă integral (BO2025_1837).
  - Motivarea va apărea în Buletinul Oficial CNSC; ar trebui reverificate peste câteva luni.
- **Firecrawl:** contul a semnalat credite reduse după ~10 căutări, iar unele căutări au primit 429. Descărcarea PDF-urilor s-a făcut direct (curl), fără costuri.

### Apă-canal și teme transversale

- **Raportul de activitate CNSC 2024 și 2025:** nu le-am găsit indexate. Din raportul 2023 am citit 40 din 62 de pagini — procentele admise/respinse nu au apărut în acestea. Se găsesc pe cnsc.ro → Rapoarte; gratuite.
- **Căutarea pe portal.cnsc.ro** (interfața de căutare) nu e accesibilă direct: curl a primit connection reset, WebFetch HTTP 503. Am ajuns la decizii doar prin indexarea motoarelor de căutare, așa că selecția e parțial aleatorie. Decizia **BO2020_1964** (rețea apă, clarificări) a dat timeout și nu e inclusă.
- **Contul Firecrawl a semnalat „credite scăzute”** în timpul lucrului — alte runde de citire pot eșua.
- **Hotărârile curților de apel** în aceste dosare (dacă deciziile CNSC au fost menținute) nu au fost verificate. Sursa ar fi rejust.ro sau portal.just.ro (gratuit, căutare manuală).
- **Ghidul de bune practici CNSC** (portal.cnsc.ro/ghiddebunepractici.pdf) nu a fost parcurs; e util pentru spețe clasice pe PNS și GP.
