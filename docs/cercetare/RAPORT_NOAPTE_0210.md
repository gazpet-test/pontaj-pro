# Raport de noapte 01 → 02.10.2026 — cercetare normativă (Ofertare / Clarificări)

> Instanța de cercetare · branch `claude/cercetare-normativa` · PR #564 (draft) · doar citire (zero scrieri în BD, zero cod, nimic aplicat).
> Rutina „coada de noapte” + completările Copilot/Gemini. Totul e pushat incremental (~40 de commit-uri), CI verde.

## Ce s-a livrat

| # | Pas din coadă | Livrat | Fișiere |
|---|---|---|---|
| 1 | Practica CNSC (țintă ≥ 60) | **216 decizii** citite integral (lotul 7: +19 pe distribuție gaze, după deduplicare; lotul 8: +15 apă-canal/gaze), sinteză pe **15 teme** + Top 10 reguli | `cnsc_practica.md/.json`, `cnsc_teme.md` |
| 2 | Registrul surselor + cerințe atomice P0 | **370 de surse**, **919 cerințe atomice**, **313 relații** în graful de aplicabilitate | `registru_surse.json`, `registru_cerinte.json`, `graf_aplicabilitate.json`, `registre_evidenta.md` |
| 3 | Catalog de clarificări v1 (țintă ≥ 30 de tipare) | **119 tipare (v1.4)**: întrebare neutră, impact intern separat, review juridic marcat | `clarificari_tipare.md/.json`, `clarificari_matrice_model.md` |
| 4 | P1: HG 1/2018, OG 15/2021 + INS, HG 925, L10, HG 273, L50 | 101 cerințe P1, cu Legea 169/2026 citită pe textul din MO 661/2026 | idem registre (REQ-P1-*) |
| 5 | P2: sudură / NDT / izolare / PE | 105 cerințe P2 + 179 tehnice: încorporare prin referință vs DA; 77 marcate „NECESITĂ STANDARD LICENȚIAT” | REQ-P2-*, REQ-TG-* |
| 6 | Norme de deviz pentru gaze | indicatoarele G, Ts (TsA/TsC), Iz, C, D, I + 4 tipuri de consum | REQ-P2-*, `registre_evidenta.md` |
| + | Apă-canal (NP 133-2022 vol. I–III citit integral) | 107 cerințe | REQ-AC-* |
| + | Surse lipsă închise cu Firecrawl | 14 goluri rezolvate, 7 parțial; prețuri ASRO | `surse_lipsa.md` |
| + | A doua părere | 7 întrebări juridice pentru Gemini/Copilot | `pentru_echipa.md` |

### Cifre

- **CNSC — 182 de decizii:**
  - pe domenii: 95 apă-canal, 48 gaze, 18 distribuție, 21 lucrări/rețele generale;
  - pe ani: 2020–2026 (lotul 6 a adăugat 28 din 2020–2022);
  - pe lege: 141 pe L98 și 41 sectoriale pe L99;
  - soluții: 71 admise, 45 admise parțial, 66 respinse
  - fiecare are amprentă `snapshot_text_sha256`. Portalul regenerează PDF-ul la fiecare descărcare, deci hash-ul PDF-ului nu e stabil.
- **Cerințe — 919, pe tip de temei:**
  - OBLIGATORIE_LEGE: 600
  - OBLIGATORIE_DOC_ACHIZITIE: 89
  - VOLUNTAR_BUNA_PRACTICA: 80
  - GHID_INTERPRETARE: 65
  - STANDARD_INCORPORAT_PRIN_REFERINTA: 44
  - PRACTICA_CNSC: 41

  Din ele, **864 sunt verificate pe sursă**; restul sunt standarde licențiate, indicatoare sau date interne.
- **Tipare — 119 (v1.4):** 72 cu încredere ridicată, 45 medie, 2 scăzută; 40 cer review juridic. Cele 22 noi (PAT-GAZ-01…15, PAT-APA-01…07) acoperă presiunea redusă/medie, branșamentele, forajul orizontal dirijat, cuplarea sub presiune, probele și punerea în funcțiune, as-built/GIS, topo/PAD, SRM/PRM, cămine NP 133, stațiile de pompare și epuismentele. Cele 182 de decizii din runda de bază sunt citate în cel puțin un tipar; lotul 7 nu e încă legat de tipare.

## Top 10 constatări pentru ofertare și clarificări

1. **🚨 Ordinul ANRE 17/2026 e în vigoare din 26.05.2026 (MO 444).** A abrogat Ordinul 132/2021. Termenul de 3 luni pentru dovada noilor cerințe (la EDSB: 3 instalatori EGD, sudori proprii oțel și PE, aparate PE cu VTP) s-a încheiat pe **26.08.2026** (dată calculată; textul exact din regulamentul-anexă e de reconfirmat). **Verifică azi dacă Gazpet a depus dovada.** Autorizațiile sunt definite pe tip de obiectiv și presiune, nu pe diametru. Ordinul are două neconcordanțe interne.
2. **Legea 169/2026 (Codul amenajării teritoriului, urbanismului și construcțiilor) e în vigoare din 25.08.2026:**
   - Legea 50/1991 e abrogată; din Legea 10/1995 rămân doar art. 10 și 41;
   - HG 273/1994 se menține tranzitoriu;
   - garanțiile se stabilesc pe clase de consecințe (1/3/5 ani; art. 531);
   - viciile ascunse se răspund 10 ani (art. 451);
   - apare obligația de asigurare pe 10 ani pentru executant (art. 556 — dedus).

   Documentațiile de atribuire care încă citează L50/L10 sunt surse de clarificări.
3. **Termene și costuri la contestare:**
   - termenul este **10 zile peste prag și 7 zile sub prag** (corectat: înainte scria 5);
   - cauțiunea: sub prag maximum 35.000 lei (contestarea documentației) sau 88.000 lei (rezultatul); peste prag maximum **220.000 / 2.000.000 lei** (corectat: înainte scria 880.000);
   - plângerea la curtea de apel se depune în 10 zile; notificarea prealabilă a fost abrogată.
4. **Clarificări la ofertă:**
   - o abatere tehnică corectată e „minoră” doar dacă valoarea ei teoretică cumulată rămâne **≤ 1% din prețul total** (HG 395 art. 134 alin. (9) lit. a); BO2024_159: 1,14% → inacceptabilă); erorile aritmetice se corectează fără prag, dar schimbarea de cantități/prețuri nu e „eroare aritmetică”;
   - elementele obligatorii lipsă din propunerea tehnică (proceduri, Gantt) nu se mai pot adăuga;
   - răspunsul trebuie dat pe fiecare articol cerut;
   - prețurile justificate trebuie să fie identice cu cele din C6/F3.
5. **Preț aparent neobișnuit de scăzut** = sub 80% din valoarea estimată (HG 395 art. 136 alin. (4)). Prețul mic singur nu e motiv de respingere. Justificarea se face cu documente, articol cu articol. Manopera se raportează la salariul minim în construcții (4.582 lei), calculat pe an. Cantitățile din F3 nu se reduc.
6. **Experiența similară nu trebuie să fie identică:** lucrările de transport și branșamentele contează. Documentele trebuie să existe la termenul de depunere. Un PV de stadiu fizic poate fi folosit **doar dacă e confirmat de beneficiar**, nu de diriginte (BO2026_182, reverificat pe text). Recepția parțială nu dovedește singură experiența (BO2026_1073 — **modificată de CA Cluj**, regula nu e confirmată judiciar; de tratat cu prudență).
7. **Autorizarea ANRE pentru asociați și subcontractanți:** practica CNSC e divergentă (BO2024_3288 vs BO2024_3232). Soluția: cerem la clarificări formularea expresă a cerinței.
8. **Ajustarea prețului e obligatorie la contractele de lucrări peste 6 luni** (L98 art. 222², alin. (9)). Clauza 48.2 din HG 1/2018 (preț ferm 365 de zile) intră în conflict cu legea. ICCplr e un indice prognozat din Anexa 4 a OUG 64/2022, nepublicat de INS (răspunsul INS din BO2023_406); CNSC a anulat acolo pentru că formula OUG 64/2022 e destinată contractelor în derulare, nu procedurilor noi. Sumele reținute din HG 1 se aplică doar când garanția de bună execuție se constituie prin rețineri succesive.
9. **NTPEE și standardele:**
   - anexa 2 e **orientativă**; obligatorii sunt doar standardele trimise explicit prin art. 228(3), 235(4) și 50¹;
   - **ISCIR nu se aplică** rețelelor de distribuție (Legea 64/2008, anexa 1 pct. 3), iar normativul I 6 e depășit;
   - NDT 100% doar la sudurile de poziție; procentele 20/25/40/75% sunt în Ord. 118/2013 (transport);
   - „izolație foarte întărită” din NTPEE (art. 259(3)) e pe bază de bitum, ceea ce intră în conflict cu 3LPE cerut de specificațiile operatorilor;
   - manometrele de probă nu sunt pe lista oficială de metrologie, deși NTPEE cere verificare metrologică.
10. **Apă-canal (NP 133-2022):**
    - la canalizare, proba se face **doar cu apă** și cu inspecție **CCTV obligatorie înainte**;
    - durata și pierderea admisibilă la proba de apă trimit la **SR EN 805:2025** (standard licențiat);
    - licența ANRSC privește operatorul, nu executantul.

    Alte 4 riscuri de reținut:
    - perioada de timp friguros 15.11–15.03 trebuie respectată în Gantt;
    - concesiunea distribuției suprapusă peste licitație poate duce la anularea procedurii (BO2026_2669);
    - OUG 41/2025 a dus la anulări de proceduri PNRR;
    - costul verificatorilor de proiect trebuie inclus în valoarea estimată.

## Calitate și control

- **Audit pe eșantion:** 45 de cerințe, din care 37 OK, 7 cu nuanțe și 1 greșită. Rata de erori grave e de aproximativ 1–2%. Toate corecturile sunt aplicate (`audit_qa.md`).
- **Reverificarea celor 41 de cerințe PRACTICA_CNSC pe text:** 15 OK, 23 nuanțate și 1 greșită. Greșeala: afirmația despre ICCplr era a autorității contractante, nu a CNSC. Corecturile sunt aplicate (`audit_cnsc_req.json`).
- **Regula de 1%, reformulată:** pragul privește abaterile tehnice (HG 395 art. 134 alin. (9) lit. a)), nu erorile aritmetice.
- **Control judiciar:** am căutat 37 de decizii-cheie; 13 au fost atacate la curtea de apel. Din ele, 9 au fost menținute, iar 4 modificate sau desființate: BO2026_1073, BO2024_2604, BO2026_328, BO2026_621. Toate 4 sunt marcate ⚠️ în fișe, în sinteză și în tipare.

## Ce surse lipsesc

- **legislatie.just.ro e inaccesibil din cloud** (eroare HTTP/2, inclusiv prin Firecrawl). Formele consolidate L98/HG 395/L101 sunt citite din SintAct (18.02 și 18.08.2026), deci încredere medie. Dimineață, din biroul tău, merge direct.
- **Standarde ASRO:** pachetul recomandat de 10 standarde costă **≈ 2.228 lei** (prețuri citite pe 02.10). Ediții corectate: SR EN 12732 → **2021**, SR EN 805 → **2025**, SR EN 1610 → **2016**.
- **Abonament Lege5/Sintact:** recomandat, ca să avem forme consolidate la zi.
- **Încă deschise:**
  - valorile indicilor INS pentru ajustarea prețurilor;
  - specificațiile Delgaz (sudură, NDT, izolație) — arhivă blocată;
  - rezultatele la curțile de apel pentru deciziile CNSC (căutare manuală pe rejust.ro);
  - textele L51/2006, HG 930/2005, OMS 275/2012;
  - termenul exact din anexa la Ord. ANRE 17/2026.

## Ce aș construi în ERP (doar propunere — schema o decizi tu)

Recomand **varianta B**: registrele importate în Supabase ca tabele separate. Detalii în `propuneri_platforma.md`. Ordinea propusă:

1. **P0.1 — corecturi în `ofertare_normative`** (preview → confirmare → apply): Ord. 132/2021 → 17/2026, Ord. 182/2020 → 65/2023, L50 → L169/2026, edițiile standardelor.
2. **P0.2 — raport intern de conformitate cu Ord. ANRE 17/2026** din `hr_autorizatii` și echipamente (doar SELECT).
3. **Tabele noi** `norme_surse` / `norme_cerinte` / `cnsc_decizii` / `clarificari_tipare`, importate 1:1 din JSON (RLS doar citire).
4. **Generatorul de clarificări** primește doar tiparele declanșate, plus cerințele `verificat_pe_sursa=true`. Rezultatul: întrebare neutră plus impact intern; tiparele ⚖️ trec obligatoriu prin review juridic.
5. **Controale deterministe:**
   - prag PNS (oferta sub 80% din VE);
   - regula de 1% la clarificări;
   - detector de acte și ediții depășite în documentația de atribuire;
   - calculator de termene (10/7 zile, cauțiune);
   - calculator pentru probe de presiune (gaze: NTPEE tabel 8¹; apă/canal: NP 133).
6. **Matricea per licitație** (`clarificari_matrice_model.md`): document → cerință → `requirement_id` → status → tipar → draft → review → hash.

## Completare 04–05 RO (după raport)

- **CNSC lotul 7 — 19 decizii noi pe distribuție gaze** (total 201; 2 fișe erau versiunile BO anonimizate ale Deciziilor 271/2026 și 3952/2025 și au fost eliminate). Toate sunt legate de tipare (59 de legături, 27 de tipare) și integrate în temele 1–15, cu sinteza în `cnsc_teme.md` („Lotul 7”). Cele mai utile: transportul gaze contează ca experiență similară pentru distribuție (Decizia 3952/2025 = BO2026_3952); formularul-declarație lipsă e viciu de formă (BO2026_633); anularea e legală la relocarea SRM sau la un ATR Transgaz diferit (BO2026_3118); practica pe completările de la clarificări e divergentă (BO2025_1492 vs BO2026_2159).
- **Tipare v1.4 — +22** (PAT-GAZ-01…15, PAT-APA-01…07). Unul singur e doar verificare internă: **PAT-GAZ-09 — autorizațiile ANRE emise pe Ord. 132/2021 (ale noastre, ale asociaților, ale subcontractanților) trebuiau dovedite la ANRE până la 26.08.2026 (Ord. 17/2026 art. 39)**. ✅ Rezolvat 02.10: Razvan confirmă că dovezile au fost depuse.
- **CNSC lotul 8 — 15 decizii** (12 apă-canal, 2 generale, 1 gaze; total 216), legate de tipare (41 de legături, 22 de tipare) și integrate în temele 1–15. Cele mai utile:
  - ajustarea prețului doar după 12 luni a fost eliminată din DA, pentru că art. 222^2 din L98 o cere peste 6 luni (BO2024_2692);
  - „/echivalent” nu permite schimbarea producătorului prin clarificări (BO2025_2363);
  - factorul subiectiv pe grafic a fost eliminat și pe L98 (BO2026_1508);
  - fără operator ANRE, propriu sau subcontractant, oferta de apă-canal cu lucrări de gaze e neconformă (BO2024_3411);
  - ⚠️ e divergență dacă gazele intră la „rețele tehnice edilitare” (BO2025_3374 vs BO2024_11).
- **Limită:** deciziile publice din BO pe distribuție gaze din 2023–2026 par epuizate. Ce a mai rămas sunt dubluri ale unor decizii deja în corpus sau decizii scurte, doar cu dispozitivul. Următoarea sursă utilă ar fi hotărârile curților de apel (portal.just.ro / ReJust).
- **Goluri noi** în `surse_lipsa.md` (Legea 7/1996 și PAD, Legea 123/2012 drept de uz, Ord. ANRE 156/2020, ATR electric, tarifele OSD, inertizare/purjare, specificațiile GIS ale OSD-urilor, C 16-84, sancțiunea pentru nedovedirea din art. 39).

## Pentru dimineață

- `pentru_echipa.md` — 7 întrebări pentru a doua părere (Gemini/Copilot), cu tot textul inclus.
- Verificare urgentă: dosarul de conformitate Ord. ANRE 17/2026.
- PR #564 e draft; nu se face merge până nu-l citești.
