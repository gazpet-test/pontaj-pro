# Baza normativă — Ofertare & execuție (gaze, apă-canal)

> Livrabil B · stare la 01.10.2026 · **120 acte/standarde** (70 verificate pe sursă primară sau oficială; restul marcate `verificat: false`).
> JSON: `baza_normativa.json` — câmpuri: `id, identificator, tip, emitent, titlu, stare, versiune_data, modificari[], inlocuit_de, ce_cere, documente_atestari[], praguri[], verificari[], articole_cheie[], relevanta_ofertare, relevanta_clarificari, link_sursa, acces, ofertare_normative_id, verificat, tema_cercetare`.
> legislatie.just.ro a fost inaccesibil (HTTP/2) — formele consolidate s-au verificat pe monitoruloficial.ro, cdep.ro, anre.ro, anap.gov.ro, lege5/legeaz (parțial). Standardele ASRO/ISO: doar metadate + cerințe rezumate (drepturi de autor).

## ⚠️ Schimbări majore 2025–2026 care afectează direct firma

| # | Ce s-a schimbat | Impact Gazpet | Verificat |
|---|---|---|---|
| 1 | **Ordin ANRE 17/21.05.2026** (MO 444/26.05.2026) abrogă integral Ordinul 132/2021 (autorizare OE gaze). EDSB: min. 3 instalatori; sudori proprii (oțel + PE); aparate PE cap-cap + electrofuziune cu VTP valabilă; declarațiile instalatorilor; personal dovedit prin REGES; viză la 5 ani. Antreprenorul general subcontractează lucrări de gaze doar la operatori autorizați ANRE și cu acordul beneficiarului. | **Termen de conformare: 3 luni de la intrarea în vigoare (≈ 26.08.2026, dedus) — de verificat dacă dovada a fost depusă.** Cerințele de calificare din licitații se raportează la noul regulament. | ✅ comunicat ANRE 29.05.2026 + cdep.ro |
| 2 | **Legea 169/2026 — Codul amenajării teritoriului, urbanismului și construcțiilor** (în vigoare 25.08.2026): abrogă Legea 50/1991 și aproape toată Legea 10/1995 (rămân art. 10 și 41); HG 273/1994, HG 766/1997, HG 925/1995 rămân tranzitoriu. Garanții minime pe clase de consecințe (1/3/5 ani). | Trimiterile din DA la L50/L10 devin surse de clarificări; perioada de garanție ofertată trebuie corelată cu clasa de consecințe. | 🟡 existența confirmată (ISC, lege5, avocatnet); articolele — din surse secundare |
| 3 | **PT CR 6/7/9-2025 ISCIR** (Ordin MEDAT 1172/2026, MO 658/07.08.2026) înlocuiesc edițiile 2013. Autorizația de sudor / operator PE: max. 2 ani, legată de angajator; NDT nivel 1/2: 2 ani, nivel 3: 5 ani. | Re-verificare autorizații sudori/NDT în HR (hr_autorizatii) pe noile reguli. | ✅ |
| 4 | **NTPEE modificat prin Ordin ANRE 2/2023**: durata probei de etanșeitate depinde de volum (tabel 8¹, 1–24 h). | Devize/grafic: durata probelor nu mai e fix 24 h. | ✅ |
| 5 | **NP 133-2022** (Ordine MDLPA 14, 15, 19/2023) înlocuiește NP 133-2013 (apă-canal). | Probele de presiune la apă/canalizare se citează după NP 133-2022. | ✅ |
| 6 | **Ordin ANRE 65/2023** (modif. 85/2024) înlocuiește Ordinul 182/2020 (autorizare instalatori). | Denumirile autorizațiilor personalului (EGD, EGIU, EGT…) din DA trebuie mapate pe noul regulament. | ✅ |
| 7 | **Ajustarea prețului**: HG 395 art. 164 abrogat (04.2023); regula e în **L98 art. 222²** — clauză de ajustare OBLIGATORIE la lucrări > 6 luni. Modelul HG 1/2018 cl. 48.2 (prețuri ferme 365 zile) intră în conflict. | Sursă de clarificări de top la orice contract > 6 luni fără formulă. | ✅ |
| 8 | **Prag preț aparent neobișnuit de scăzut: < 80% din valoarea estimată** (HG 395 art. 136 alin. (4), HG 375/2022). | Alertă automată în Ofertare când oferta < 80% VE. | ✅ |
| 9 | **Praguri UE 2026–2027**: lucrări 5.404.000 EUR = 26.960.556 lei (Reg. delegate UE 2025/2150–2152; notificare ANAP 10.12.2025). | Determină termenele de contestare (10 vs 5 zile) și plafoanele cauțiunii. | ✅ |
| 10 | **Ordinul 863/2008 (devize) abrogat** prin HG 907/2016 art. 18; F3 e anexă la HG 907/2016 (proiectantul: col. 1–3; ofertantul: col. 4–9). | Responsabilitatea cantităților F3 e a proiectantului/AC — temei pentru clarificări de cantități. | ✅ |
| 11 | **Salariul minim în construcții 4.582 lei/lună** (≈ 27,71 lei/oră) — OUG 156/2024 art. LXIX; facilitățile fiscale eliminate din 2025. Salariul minim general 4.325 lei din 01.07.2026 (HG 146/2026). | Prag pentru verificarea manoperei în devize (ale noastre și ale concurenței la contestare). | 🟡 |

## Corecturi consolidate pentru tabela `ofertare_normative` (propuneri — aplicarea o decide Razvan)

| id | Acum | Propunere | Sursa |
|---|---|---|---|
| 1 | Ordin ANRE 89/2018 (NTPEE) | Adaugă „modificat prin Ordin ANRE 2/2023 (MO 67/26.01.2023)” — art. 254, 268–273, tabel 8¹; anexa 2 citează ediții de standarde depășite. | ANRE |
| 2 | Ordin ANRE 118/2013 | Adaugă modificările Ord. 75/2014 și 41/2018. | ANRE (neverif. complet) |
| 4 | Legea 10/1995 — în vigoare | **Abrogată parțial din 25.08.2026** (Legea 169/2026; rămân art. 10 și 41). | secundar |
| 6 | HG 907/2016 | Notează că a abrogat Ordinul 863/2008 și HG 28/2008; F3 e anexă la HG 907. | ✅ |
| 7, 8 | Legea 99/2016, HG 394/2016 | Marchează relevanța pentru **operatorii regionali apă-canal și operatorii de distribuție gaze** (entități sectoriale): PNS, terț, clarificări după L99/HG 394. | CNSC 2344/2025, 2237/2023 |
| 20 | Legea 50/1991 — în vigoare | **Abrogată din 25.08.2026** → rând nou Legea 169/2026 (Codul amenajării teritoriului, urbanismului și construcțiilor). | ISC / lege5 |
| 21 | HG 273/1994 | În vigoare în forma HG 343/2017; menținută tranzitoriu de Legea 169/2026 art. 577 alin. (6) (de confirmat pe textul oficial). | secundar |
| 22 | Ordin ANRE 132/2021 — „înlocuit din 2026” | **Abrogat prin Ordin ANRE 17/2026** (MO 444/26.05.2026) → rând nou Ordin 17/2026, stare veche = abrogat. | ✅ ANRE |
| 23 | Ordin ANRE 182/2020 | **Înlocuit de Ordin ANRE 65/2023** (MO 409/12.05.2023), modif. Ord. 85/2024. | ✅ |
| 25 | Ordin MDRAP 2264/2018 | Obiectul e atestarea **verificatorilor de proiecte și experților tehnici** (nu RTE). | ✅ |
| 27 | „NT ANRE 18.03.2025” | Identificator corect: **Ordin ANRE 8/2025** (MO 378/29.04.2025). | ✅ |
| 28 | Ordin ANRE 7/2022 | Confirmat: Regulament racordare SD gaze (MO 196/28.02.2022), abrogă Ord. 18/2021. | ✅ |
| 30 | SR EN 12007-1…-5 | -5 → **SR EN 12007-5:2024**; restul -1:2012, -2:2012, -3:2015, -4:2012. | ASRO/CEN |
| 34 | SR EN ISO 3834-2 | Precizează **:2021** (2006 anulat); adaugă EN ISO 3834-6:2024. | ASRO |
| 35 | SR EN ISO 17636-1/-2:2022 | **-1:2022, -2:2023**. | ASRO |
| 38 | SR EN 12068:1999 | **SR EN 12068:2002**, în vigoare, NU înlocuit de 21809-3. | ASRO |
| 39 | DIN 30672-1/-2:2019 | Ediție **neconfirmată** — de verificat la DIN Media. | — |
| 40 | SR EN ISO 21809-1/-3 (NECONFIRMAT) | -1: **SR EN ISO 21809-1:2019**; -3: EN ISO 21809-3:2016+A1:2020 (revizie FDIS în curs). | Distrigaz ST / CEN |
| 42 | SR EN ISO 15589-1 | **EN ISO 15589-1:2026** adoptat CEN (doa 31.10.2026); până la preluare SR: 2017. | CEN |
| 43 | SR EN 1555-1…-5 | **SR EN 1555-1…-4:2025**; partea 5 neconfirmată. | ASRO BS 12/2025 |
| 46 | SR EN ISO 17635 | **:2025** (înlocuiește 2017). | ASRO |
| nou | — | Ordin ANRE 17/2026; Ordin ANRE 65/2023; Ordin ANRE 156/2020; Legea 169/2026; PT CR 6/7/9-2025; NP 133-2022; HG 1/2018; L98 art. 222² + OUG 47/2022 + OUG 64/2022 (ajustare); Instrucțiunile ANAP 1/2017, 2/2017; HG 209/2019 (concesiune distribuție gaze); Legea apelor 107/1996 (aviz GA); Ghid P91/1-02; SR EN ISO 10675-1:2022, 17640:2019, 11666:2018, 15609-1:2020, 14732:2025; SR EN 12732+A1:2014; SR EN 10204:2005; SR EN ISO 3183:2020; SR EN ISO 8501-1:2007; SR EN 15001-1/-2:2023; DVS 2207-1:2015; specificațiile operatorilor (Distrigaz ST-TGPHD/ST-TOLNP 2023, Delgaz ST 505). | toate temele |

Detaliile pe fiecare temă (cu argumentația) sunt în anexa „Corecturi — note pe teme” de la final.

## Index

| Identificator | Stare | Ediție / ultima modificare | id tabelă | Verificat |
|---|---|---|---|---|
| **Achiziții publice și contracte tip** | | | | |
| Legea 98/2016 | 🟡 modificat | Formă consolidată CTCE valabilă 24.05.2024–13.06.2024 (publicată de ANAP); ultimul act modificator inclus: OUG 52/2024 (MO 483/24.05.2024). Modificări ulterioare iunie 2024 → oct. 2026 NEVERIFICATE (legislatie.just.ro inaccesibil). | 5 | ✅ |
| HG 395/2016 | 🟡 modificat | Formă consolidată CTCE valabilă 24.05.2024–13.06.2024 (ANAP). Modificatori: Ordin 264/2016, HG 866/2016, HG 419/2018, HG 485/2020, HG 375/2022, HG 336/2023, OUG 52/2024. | 9 | ✅ |
| Legea 101/2016 | 🟡 modificat | Nu am putut obține forma consolidată curentă (legislatie.just.ro inaccesibil; ANAP are doar variante 2016–2020). Textele de mai jos sunt confirmate din decizii CNSC 2024–2025. | 10 | — |
| Legea 99/2016 | 🟡 modificat | Forma consolidată curentă NEACCESATĂ (ANAP/legislatie.just.ro blocate). Pragurile UE 2026 confirmate din surse secundare. | 7 | — |
| HG 394/2016 | 🟡 modificat | Modificată și prin HG 336/2023 (confirmat din titlul HG 336/2023). Text consolidat neaccesat. | 8 | — |
| HG 1/2018 | 🟡 modificat | Text actualizat AFIR cu HG 965/2023 (MO 17.10.2023). Modificatori identificați: HG 297/2022 (03.03.2022), HG 375/2022 (22.03.2022), HG 1347/2022 (04.11.2022), HG 965/2023. |  | ✅ |
| OUG 47/2022 | 🟢 în vigoare | MO 377/15.04.2022 (text art. 1–8 reprodus în nota din forma consolidată L98 la 13.06.2024) |  | ✅ |
| OUG 64/2022 | 🟢 în vigoare | 09.05.2022 (aprobată ulterior prin lege — numărul legii de aprobare NEVERIFICAT); text integral neaccesat |  | — |
| OG 15/2021 | 🟡 modificat | 30.08.2021; Legea 281/2021; formula din contractele OG 15 a fost înlocuită cu formula OUG 47/2022 art. 3(4) prin act adițional (OUG 47/2022 art. 4(4)) |  | — |
| Reg. delegate (UE) 2025/2152, 2025/2150, 2025/2151, 2025/2487 + Notificare ANAP 10.12.2025 | 🟢 în vigoare | aplicabile de la 01.01.2026; curs folosit 4,9890 lei/EUR |  | ✅ |
| Instrucțiunea ANAP 2/2017 | 🟢 în vigoare | MO 300/27.04.2017 |  | ✅ |
| Instrucțiunea ANAP 1/2017 | 🟢 în vigoare | MO 32/2017 (conform legeaz.net); conținut detaliat NEVERIFICAT din text primar |  | — |
| Instrucțiunea ANAP 1/2021 | 🟢 în vigoare | MO 56/19.01.2021; conținut detaliat NEVERIFICAT |  | — |
| Instrucțiunea ANAP 2/2018 | ⚪ neconfirmat | 21.12.2018; emisă pe baza HG 395 art. 164 (abrogat în 2023) — aplicabilitatea actuală de verificat |  | — |
| Notificare ANAP 27.07.2018 — art. 160(2) L98 / art. 172(2) L99 | 🟢 în vigoare | 27.07.2018 |  | ✅ |
| ANAP — Cele mai frecvente neconformități (lucrări standard și proiectare+execuție), control ex-ante | 🟢 în vigoare | PDF publicat 05/2023 (95 pagini) |  | ✅ |
| ANAP — Îndrumare privind evaluarea propunerilor financiare (preț aparent neobișnuit de scăzut) | 🟢 în vigoare | PDF 05/2023 — conținut NEACCESAT (anti-bot ANAP) |  | — |
| ANAP — Îndrumare privind detalierea excesivă a listelor de prețuri | 🟢 în vigoare | PDF 03/2023 — conținut NEACCESAT |  | — |
| FIDIC Red Book / Yellow Book (ed. 1999 și 2017) | 🟢 în vigoare | ed. 1999 (folosită istoric la POS Mediu/POIM apă-canal) și ed. 2017 (reprint 2022) |  | — |
| OUG 98/2017 | 🟢 în vigoare | aprobată prin Legea 186/2018; norme HG 419/2018 |  | ✅ |
| OUG 114/2011 | 🟢 în vigoare | — |  | ✅ |
| HG 1336/2022 | 🟢 în vigoare | MO 1078/08.11.2022 |  | ✅ |
| **ANRE, gaze, ISCIR, apă-canal** | | | | |
| Ordin ANRE 89/2018 (NTPEE-2018) | 🟡 modificat | MO 462/05.06.2018; forma consolidată verificată la 26.01.2023 (după Ordin ANRE 2/2023). Nu am găsit modificări ulterioare 2024–2026 (neconfirmat complet: lege5/legislatie.just.ro inaccesibile). | 1 | ✅ |
| Ordin ANRE 2/2023 | 🟢 în vigoare | 18.01.2023, MO 67/26.01.2023, în vigoare 26.01.2023 | 1 | ✅ |
| Ordin ANRE 156/2020 | 🟢 în vigoare | 27.08.2020, MO 799/01.09.2020 (modificări ulterioare neverificate) |  | — |
| Ordin ANRE 118/2013 | 🟡 modificat | MO 171/10.03.2014; modificări cunoscute: Ordin ANRE 75/2014 (MO 601/12.08.2014), Ordin ANRE 41/2018 (MO 291/30.03.2018) | 2 | — |
| Ordin ANRE 8/2025 — Normă tehnică 18.03.2025 conducte de alimentare din amonte | 🟢 în vigoare | Ordin ANRE 8/18.03.2025, MO 378/29.04.2025, în vigoare 29.04.2025 | 27 | ✅ |
| Ordin ANRE 17/2026 | 🟢 în vigoare | 21.05.2026, MO 444/26.05.2026 (ordinul nu stabilește altă dată → în vigoare la publicare, 26.05.2026 — dedus, nu scris explicit) | 22 | ✅ |
| Ordin ANRE 132/2021 | 🔴 abrogat | MO 1209/21.12.2021; modificat inclusiv prin Ordin ANRE 7/2023 (mecanism declarativ de personal); abrogat prin Ordin ANRE 17/2026 | 22 | ✅ |
| Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) | 🟡 modificat | Ordin 65/10.05.2023, MO 409/12.05.2023; Ordin 85/03.12.2024, MO 1225/05.12.2024 | 23 | ✅ |
| Ordin ANRE 182/2020 | 🔴 înlocuit | înlocuit prin Ordin ANRE 65/2023 | 23 | ✅ |
| Ordin ANRE 7/2022 | 🟡 modificat | 23.02.2022, MO 196/28.02.2022; abrogă Ordin 18/2021 și 96/2018; cu modificările ulterioare (lista completă neverificată) | 28 | ✅ |
| Ordin ANRE 239/2019 | 🟡 modificat | MO 36/20.01.2020, cu modificările ulterioare (înlocuiește Ordin 4/2007, conform NTPEE consolidat art. 32 alin. 2 lit. c) |  | ✅ |
| Standardul de performanță pentru serviciul de distribuție a gazelor naturale (ANRE) | ⚪ neconfirmat | Numărul ordinului în vigoare în 2026 nu a fost verificat |  | — |
| PT CR 9-2025 (Ordin MEDAT 1172/2026) | 🟢 în vigoare | Ordin 1172/24.07.2026, MO 658 și 658 bis/07.08.2026; abrogă Ordin ME 1001/2013 (PT CR 6/7/9-2013) |  | ✅ |
| PT CR 6-2025 (Ordin MEDAT 1172/2026) | 🟢 în vigoare | MO 658/07.08.2026; înlocuiește PT CR 6-2013 |  | ✅ |
| PT CR 7-2025 (Ordin MEDAT 1172/2026) | 🟢 în vigoare | MO 658/07.08.2026; înlocuiește PT CR 7-2013 |  | ✅ |
| PT CR 3-2025 | 🟢 în vigoare | publicat 2026 (PDF pe iscir.ro, 08/2026); detalii neverificate |  | — |
| NP 133-2022 vol. I (Ordin MDLPA 15/2023) | 🟢 în vigoare | Ordin 15/05.01.2023, MO 43 și 43 bis/16.01.2023; în vigoare la 30 zile de la publicare; abrogă NP 133/1-2013 |  | ✅ |
| NP 133-2022 vol. II (Ordin MDLPA 14/2023) | 🟢 în vigoare | Ordin 14/05.01.2023, MO 41 și 41 bis/13.01.2023; vol. III (structuri hidroedilitare din beton) — Ordin 19/2023, MO 44/16.01.2023 |  | ✅ |
| NP 133-2013 (Ordin MDRAP 2901/2013) | 🔴 înlocuit | MO 660 și 660 bis/28.10.2013, completat prin Ordin 3218/2016; părțile I și II abrogate prin Ordinele MDLPA 15/2023 și 14/2023 |  | ✅ |
| SR EN 805:2000 | ⚪ neconfirmat | Ediția în vigoare neverificată în catalogul ASRO |  | — |
| SR EN 1610:2015 | ⚪ neconfirmat | Ediția 2015 (de confirmat la ASRO) |  | — |
| SR 4163-1:1995, SR 4163-2:1996, SR 4163-3:1996 | ⚪ neconfirmat | Ediții neverificate (paywall) |  | — |
| SR 1343-1:2006 | ⚪ neconfirmat | 2006 (neverificat) |  | — |
| SR 1846-1:2006 / SR 1846-2:2007 | ⚪ neconfirmat | Ediții neverificate; STAS 1846 vechi înlocuit de SR 1846-1/-2 |  | — |
| SR EN 752:2017 | ⚪ neconfirmat | 2017 (neverificat) |  | — |
| STAS 6819 | ⚪ neconfirmat | ediție neverificată (citat de NP 133-2022 la proba de presiune) |  | — |
| Normativ I 22-99 | ⚪ neconfirmat | Probabil înlocuit de NP 133-2013/2022 — act de abrogare neverificat |  | — |
| Legea 241/2006 (republicată) | 🟡 modificat | republicată, cu modificări ulterioare (versiunea 2026 neverificată) |  | — |
| Legea 51/2006 (republicată) + regulamentul ANRSC de licențiere | 🟡 modificat | ANRSC funcțional în 2026 (raport sector 2025, evidență licențe apă 25.05.2026); numărul ordinului ANRSC de licențiere neverificat |  | — |
| **Sudură, NDT, izolație, materiale** | | | | |
| SR EN 12327 (EN 12327:2012) | 🟢 în vigoare | EN 12327:2012 — ediția curentă la CEN/BSI/DIN/NEN (nicio ediție nouă găsită); ediția SR neconfirmată | 31 | ✅ |
| Ordin ANRE 89/2018 (NTPEE-2018) — cap. X-XII (îmbinări, verificări, protecție anticorozivă, probe) | 🟡 modificat | MO 462/05.06.2018; modificat prin Ordin ANRE 2/2023 (MO 67/26.01.2023); forma sintetică verificată la 02.03.2023 | 1 | ✅ |
| SR EN ISO 3834-1…-5:2021 (+ EN ISO 3834-6:2024) | 🟢 în vigoare | SR EN ISO 3834-2:2021 (ASRO, înlocuiește SR EN ISO 3834-2:2006); ISO 3834-1..-5:2021; EN ISO 3834-6:2024 (ghid de implementare, adoptat CEN 2024) | 34 | ✅ |
| SR EN ISO 9606-1:2017 | 🟢 în vigoare | SR EN ISO 9606-1:2017 (aprobat 29.09.2017, înlocuiește SR EN ISO 9606-1:2014), în vigoare; ISO/DIS 9606 (consolidare părți 1-5) în ancheta publică la ISO | 33 | ✅ |
| SR EN ISO 15614-1:2017 (+A1:2019) | 🟢 în vigoare | ISO 15614-1:2017 + Amd 1:2019; ISO 15614-1:2017/DAmd 2 și prEN ISO 15614-1 (revizie) în lucru — PT CR 7-2025 citează SR EN ISO 15614-1:2017 | 32 | ✅ |
| SR EN ISO 15609-1:2020 | 🟢 în vigoare | SR EN ISO 15609-1:2020 (aprobat 31.03.2020; traducere RO 12.12.2022) — corespunde ISO 15609-1:2019; NTPEE anexa 2 citează SR EN ISO 15609-1:2005 (depășit) |  | ✅ |
| SR EN ISO 14731 (ISO 14731:2019) | ⚪ neconfirmat | ISO 14731:2019 — ediția SR neconfirmată; în RO funcția echivalentă reglementată e RTS (responsabil tehnic cu sudura, atestat ISCIR) |  | — |
| SR EN ISO 14732:2025 | 🟢 în vigoare | SR EN ISO 14732:2025 înlocuiește SR EN ISO 14732:2014 (Buletinul Standardizării 02/2026) |  | ✅ |
| SR EN 12732+A1:2014 | ⚪ neconfirmat | EN 12732:2013+A1:2014 (citat în NTPEE anexa 2, poz. 37) — ediție curentă CEN neconfirmată |  | — |
| SR EN 13067 (EN 13067:2020) | 🟢 în vigoare | EN 13067:2020 (CEN); prEN 13067 rev în lucru (Buletinul Standardizării 07/2026); NTPEE anexa 2 citează SR EN 13067:2013 (depășit) | 44 | ✅ |
| DVS 2207-1:2015-08 | 🟢 în vigoare | ediția 2015-08 (ultima identificată) |  | ✅ |
| ISO 21307:2017 | 🟢 în vigoare | ediția 3 (2017), reconfirmată 2023 (nicio ediție nouă identificată) |  | ✅ |
| ISO 12176-2:2025 / -3 / -4 / -5 | ⚪ neconfirmat | ISO 12176-2:2025 publicat (listă ISO în Buletinul Standardizării 07/2025); edițiile -3/-4/-5 neconfirmate |  | — |
| SR EN 1555-1…-4:2025 (+ SR EN 1555-5) | 🟢 în vigoare | SR EN 1555-1:2025, -2:2025, -3:2025, -4:2025 înlocuiesc edițiile 2021 (Buletinul Standardizării 12/2025; anulări în BS 05/2026); EN 1555-x:2025 doa 2026-01-31; partea 5 — ediție neconfirmată | 43 | ✅ |
| SR EN 12007-1…-5 | 🟢 în vigoare | -1:2012, -2:2012 (PE, MOP ≤ 10 bar), -3:2015 (oțel), -4:2012 (renovare), -5:2024 (branșamente; înlocuiește SR EN 12007-5:2014 — BS 01/2025) | 30 | ✅ |
| SR EN ISO 17635:2025 | 🟢 în vigoare | SR EN ISO 17635:2025 înlocuiește SR EN ISO 17635:2017 (BS 11/2025); citat de PT CR 7/9-2025 | 46 | ✅ |
| SR EN ISO 5817:2023 | 🟢 în vigoare | SR EN ISO 5817:2023 (înlocuiește SR EN ISO 5817:2015 — anulat) | 37 | ✅ |
| SR EN ISO 17636-1:2022 / SR EN ISO 17636-2:2023 | 🟢 în vigoare | -1: SR EN ISO 17636-1:2022 (aprobat 30.09.2022, înlocuiește 2013); -2: SR EN ISO 17636-2:2023 (înlocuiește 2013, BS 04/2023) | 35 | ✅ |
| SR EN ISO 10675-1:2022 | 🟢 în vigoare | SR EN ISO 10675-1:2022 (citat în PT CR 7/9-2025) |  | ✅ |
| SR EN ISO 17640:2019 / SR EN ISO 11666:2018 | 🟢 în vigoare | SR EN ISO 17640:2019 (ISO 17640:2018); SR EN ISO 11666:2018 — ambele citate în PT CR 7/9-2025 |  | ✅ |
| SR EN ISO 17637:2017 | 🟢 în vigoare | SR EN ISO 17637:2017 (ISO 17637:2016) — citat în PT CR 7/9-2025 | 36 | ✅ |
| SR EN ISO 9712:2022 | 🟢 în vigoare | SR EN ISO 9712:2022 (ISO 9712:2021) — citat în PT CR 6-2025 | 45 | ✅ |
| Procente NDT suduri oțel — conducte distribuție gaze (sinteză) | ⚪ neconfirmat | NTPEE 2018 cu Ord. 2/2023 | 1 | ✅ |
| SR EN ISO 8501-1:2007 | 🟢 în vigoare | SR EN ISO 8501-1:2007 (citat de Distrigaz ST-TOLNP 2023); SR EN ISO 8501-3:2025 (pregătire suduri/muchii) înlocuiește 8501-3:2007 (BS 10/2025) |  | ✅ |
| SR EN ISO 8503-1…-5 / SR EN ISO 8502-x | ⚪ neconfirmat | 8502-5:2025 și 8502-15:2025 noi (BS 2025-2026); restul edițiilor neconfirmate; prEN ISO 8503-5 și prEN ISO 8502-2/-6 în revizie (2026) |  | — |
| SR EN ISO 12944-1…-9 | ⚪ neconfirmat | ISO 12944-1..-8:2017/2018, -9:2018 — edițiile SR neconfirmate. ATENȚIE: 'SR EN 12944-3:2025' din buletinele ASRO e alt standard (fără ISO), nu seria 12944 de vopsele |  | — |
| SR EN ISO 21809-1:2019 (ISO 21809-1:2018) | 🟢 în vigoare | SR EN ISO 21809-1:2019 (citat Distrigaz ST-TOLNP 2023); ISO 21809-2:2026 și -4:2026 publicate; SR EN ISO 21809-2:2026 înlocuiește 2015 (BS 04/2026) | 40 | ✅ |
| EN ISO 21809-3:2016 + A1:2020 | ⚪ neconfirmat | ISO 21809-3:2016 + Amd 1:2020 în vigoare; ISO/FDIS 21809-3 (pagina ISO actualizată 21.09.2026) va înlocui ediția 2016; ediția SR neconfirmată (nu apare pe magazin.asro.ro în căutare) | 40 | ✅ |
| SR EN 12068:2002 | 🟢 în vigoare | SR EN 12068:2002 — 'În vigoare' pe magazin.asro.ro (aprobat 26.09.2002, versiune RO 31.08.2008); EN 12068:1998 (DIN EN 12068:1999). NU a fost găsită dovadă că e înlocuit de EN ISO 21809-3 | 38 | ✅ |
| DIN 30672 | ⚪ neconfirmat | ediție curentă neconfirmată (DIN 30672:2000 identificată; tabela notează -1/-2:2019 — NECONFIRMAT) | 39 | — |
| SR EN 12954 (EN 12954:2019) | 🟢 în vigoare | EN 12954:2019 înlocuiește EN 12954:2001; ediția SR 2019 neconfirmată; NTPEE anexa 2 citează SR EN 12954:2002 (depășit) | 41 | ✅ |
| EN ISO 15589-1:2026 (anterior EN ISO 15589-1:2017) | 🟢 în vigoare | EN ISO 15589-1:2026 (ISO 15589-1:2026) adoptat CEN — doa 2026-10-31, dop 2027-01-31 (BS 08/2026); SR EN ISO 15589-1:2017 în vigoare până la preluare; SR EN ISO 15589-2:2024 (offshore) înlocuiește 2014 | 42 | ✅ |
| SR EN 13509 (EN 13509:2003) | ⚪ neconfirmat | EN 13509:2003 — ediția SR și eventuală revizie neconfirmate |  | — |
| SR EN 1594:2024 | 🟢 în vigoare | SR EN 1594:2024 înlocuiește SR EN 1594:2014 (BS 05/2024; traducere RO 'NCT' în BS 10/2025); EN 1594:2024/prA1 în lucru (BS 07/2025) | 29 | ✅ |
| SR EN 15001-1:2023 / SR EN 15001-2:2023 | 🟢 în vigoare | ambele 2023, înlocuiesc SR EN 15001-1/-2:2009 (BS 09/2023) |  | ✅ |
| SR EN 1775:2008 (EN 1775:2007) | 🟢 în vigoare | EN 1775:2007 — nicio ediție nouă găsită; SR EN 1775:2008 citat în NTPEE anexa 2 |  | — |
| SR EN ISO 3183:2020 (ISO 3183:2019) | 🟢 în vigoare | SR EN ISO 3183:2020 (citat Distrigaz ST-TOLNP 2023) |  | ✅ |
| SR EN 10208-2 | 🔴 înlocuit | EN 10208-2:2009 — retras la CEN, înlocuit de EN ISO 3183 (informație de specialitate; nu am verificat fișa ASRO) |  | — |
| SR EN 10216-x / SR EN 10217-x | 🟢 în vigoare | SR EN 10216-2:2024 înlocuiește SR EN 10216-2+A1:2020 (BS 01/2025; citat în PT CR 7/9-2025); prEN 10216-1/-3/-4 rev în lucru (2026); 10217 — neconfirmat |  | ✅ |
| SR EN 10204:2005 (EN 10204:2004) | 🟢 în vigoare | SR EN 10204:2005 în vigoare; prEN 10204 rev în lucru (BS 07/2026) |  | ✅ |
| Distrigaz Sud Rețele ST-TGPHD (2023) | 🟢 în vigoare | publicat 07/2023 |  | ✅ |
| Distrigaz Sud Rețele ST-TOLNP (2023) | 🟢 în vigoare | publicat 07/2023 |  | ✅ |
| Delgaz Grid ST 505 (A5, 01.2023) | 🟢 în vigoare | A5 — ianuarie 2023 |  | ✅ |
| **Norme de deviz și legi conexe** | | | | |
| Indicatoare de norme de deviz seria 1981 (si revizuite dupa 1998) | 🟢 în vigoare | Editia 1981-1982 (cea mai folosita); unele revizuite 1999-2015 (ex. Ac). Cercetare de actualizare D (drumuri): UTCN proiect 224 CI/2018 |  | ✅ |
| Indicator de norme de deviz G — 1981 | 🟢 în vigoare | 1981; revizuiri/retipariri semnalate 1996 si pana in 2002 (neconfirmat continutul revizuirilor) |  | — |
| Indicator de norme de deviz I — 1981 | 🟢 în vigoare | 1981 |  | ✅ |
| Indicator de norme de deviz Ts — 1981 | 🟢 în vigoare | 1981 |  | ✅ |
| Indicator de norme de deviz Ac (si RpAc) | 🟢 în vigoare | revizuit 1999-2015 |  | — |
| Norme de deviz SOFTEH – VALROM (retele exterioare PEHD apa-gaz, canalizare PVC) | 🟢 în vigoare | publicat ~2015 (windev.ro) |  | ✅ |
| Ordin MLPTL 1568/2002 — Ghid P91/1-02 | 🟢 în vigoare | 2002; figura in lista reglementarilor tehnice valabile la 31.03.2010 (Decizia MDRT 27.129/28.04.2010), citat ca aplicabil de CNSC in 2018 |  | — |
| Ordin MLPTL 1014/2001 + Ordin MF 874/2001 (formulare C1-C9) | ⚪ neconfirmat | iunie 2001 (MO); statut actual neverificat — portalul legislatie.just.ro inaccesibil |  | — |
| Ordin MDLPL 863/2008 | 🔴 abrogat | MO 524/11.07.2008 |  | ✅ |
| HG 907/2016 | 🟡 modificat | in vigoare din 27.02.2017; forma consultata: versiune 23.11.2023 | 6 | ✅ |
| OUG 114/2018 art. 71 + OUG 156/2024 art. LXIX | 🟢 în vigoare | 4.582 lei/luna (27,714 lei/ora) in 2025 si 2026; nemodificat de OUG 29/2026 (care a abrogat doar regimul agricultura/industrie alimentara) |  | — |
| Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) | 🟢 în vigoare | MO I nr. 661/10.08.2026; in vigoare 25.08.2026 (unele dispozitii tranzitorii cu termene proprii) |  | — |
| Legea 10/1995 (republicata MO 765/30.09.2016) | 🟠 abrogat parțial | Republicata 2016; ABROGATA in cea mai mare parte de la 25.08.2026 prin Legea 169/2026 — raman doar art. 10 si art. 41 | 4 | — |
| Legea 50/1991 (republicata) | 🔴 abrogat | Abrogata integral de la 25.08.2026 prin Legea 169/2026 | 20 | — |
| HG 273/1994 — Regulament privind receptia constructiilor (forma HG 343/2017) | 🟡 modificat | Forma data de HG 343/2017; mentinut tranzitoriu de Legea 169/2026 art. 577 alin. (6) (dupa verificatori.ro) | 21 | ✅ |
| Legea 123/2012 — Titlul II Gaze naturale | 🟡 modificat | forma sintetica consultata la 07.01.2019 (Legea 167/2018 etc.); modificari ulterioare 2020-2026 neverificate pe articolele de mai jos | 3 | ✅ |
| Legea 319/2006 | 🟢 în vigoare | cu modificarile ulterioare (neverificate in detaliu) | 15 | — |
| HG 1425/2006 | 🟡 modificat | modificat (ex. HG 955/2010) — neverificat | 16 | — |
| HG 300/2006 | 🟡 modificat | modificata prin HG 601/2007 (neverificat) | 14 | — |
| HG 766/1997 | 🟢 în vigoare | mentinute anexele 1-5 de Legea 169/2026 art. 577 alin. (3) (dupa verificatori.ro) |  | — |
| HG 925/1995 | 🟢 în vigoare | mentinut tranzitoriu de Legea 169/2026 art. 577 alin. (5) (dupa verificatori.ro) |  | — |
| Ordin MDRAP 1895/2016 | 🟢 în vigoare | 31.08.2016; statut post-CATUC (art. 459 Legea 169/2026) neverificat | 26 | — |
| Ordin MDRAP 2264/2018 | 🟢 în vigoare | MO 240/19.03.2018 (a abrogat Ordinul 777/2003) | 25 | ✅ |
| Ordin MDRAP 1370/2014 — Procedura PCF 002 | 🟢 în vigoare | 25.07.2014; statut post-CATUC neverificat |  | — |
| Legea 98/2016 art. 200-201 | 🟢 în vigoare | forma in vigoare 2026 (art. 200 alin. (3) verificat prin CNSC 2021) | 5 | ✅ |
| SR EN ISO 9001:2015 / SR EN ISO 14001:2015 / SR ISO 45001:2018 | 🟢 în vigoare | ISO 9001:2015 (amendament Amd 1:2024 privind schimbarile climatice); 14001:2015 (Amd 1:2024); 45001:2018 (Amd 1:2024). Revizia ISO 9001 programata ~2026 — neverificat |  | — |

## Achiziții publice și contracte tip

### Sinteză

Data cercetării: 01.10.2026. Sursele primare citite integral: Legea 98/2016 și HG 395/2016 (forme consolidate CTCE la 13.06.2024, publicate de ANAP), HG 1/2018 (text actualizat AFIR cu HG 965/2023), Instrucțiunea ANAP 2/2017, documentul ANAP din 05/2023 „Cele mai frecvente neconformități” pentru lucrări, notificarea ANAP din 27.07.2018 privind art. 160, Decizia CNSC 2863/C4/3581 din 25.09.2025 (cauțiune) și decizia CNSC BO2025_647 (pragul de 80%).
**Limită importantă:** nu am putut verifica modificările L98/HG 395 apărute **după iunie 2024** (legislatie.just.ro inaccesibil, iar lege5 arată doar forma originală). Nici forma consolidată curentă a Legii 101/2016 nu am putut-o citi. Toate elementele neconfirmate sunt marcate în JSON cu `verificat:false`.

---

### 1. Constatări principale (cu corecturi față de brief)

1. **Pragul de 80% pentru prețul neobișnuit de scăzut este în HG 395/2016 art. 136 alin. (4)**, introdus prin HG 375/2022 (în vigoare din 22.03.2022): o ofertă are preț aparent neobișnuit de scăzut când prețul fără TVA este **sub 80% din valoarea estimată** (nu din media ofertelor). L98 art. 210 obligă AC să ceară clarificări și permite respingerea numai dacă dovezile nu justifică prețul. Dovezile acceptate sunt enumerate la HG 395 art. 136 alin. (2): oferte de la furnizori, stocuri, organizarea lucrului, salarizare, costuri de utilaj. Confirmare: decizia CNSC BO2025_647 a obligat AC să ceară clarificări unei oferte aflate la 48,27% din valoarea estimată.
2. **HG 395 art. 164 (ajustarea prețului) este ABROGAT** din 19.04.2023 prin HG 336/2023. Regulile au trecut în **L98 art. 222^2**, introdus prin Legea 208/2022 și modificat prin OUG 52/2024. Alin. (9) spune că AC **este obligată** să includă clauze de ajustare la contractele de lucrări care durează **peste 6 luni**. Alin. (3) cere ca formula, indicii și sursa lor să fie precizate atât în documentație, cât și în contract.
3. **HG 1336/2022 NU este o metodologie de ajustare.** Este regulamentul-cadru pentru cariera personalului contractual bugetar. Actele reale pentru ajustare sunt: **OUG 47/2022** (contracte naționale aflate în derulare, formula cu ICC), **OUG 64/2022** (proiecte cu fonduri externe nerambursabile), OG 15/2021 (istoric), plus clauza 48 din HG 1/2018 pentru contractele noi.
4. **OUG 114/2011 NU reglementează garanția de bună execuție.** Ea privește achizițiile din domeniile apărării și securității. Garanțiile sunt reglementate de **L98 art. 154, 154^1, 154^2** (mutate în lege prin Legea 208/2022) și de **HG 395 art. 35–41** (mult restrânse prin HG 336/2023).
5. **„OUG 25/2023” nu apare printre actele care au modificat L98.** Lista CTCE cuprinde OUG 25/2021 și **Legea 208/2022**, iar aceasta din urmă este reformularea majoră. Ultimul act modificator verificat este **OUG 52/2024**.
6. **Pragurile 2026–2027** (Reg. delegate UE 2025/2150–2152, notificarea ANAP din 10.12.2025):
   - lucrări: **5.404.000 EUR = 26.960.556 lei**, atât la achizițiile clasice, cât și la cele sectoriale (anterior 5.538.000 EUR = 27.334.460 lei);
   - produse/servicii sectoriale: 432.000 EUR = 2.155.248 lei;
   - achiziția directă de lucrări după L98 rămâne sub **900.400 lei**.
7. **Termenul de răspuns al AC la clarificări** (L98 art. 161, în forma dată de OUG 45/2018): răspunsul trebuie dat cu **cel puțin 10 zile** înainte de termenul de depunere (5 zile în caz de urgență). La procedura simplificată pentru lucrări termenul este de **cel puțin 6 zile**. Formula „a 10-a/a 11-a zi” din brief este doar o interpretare a acestui text; legea spune „cu cel puțin 10 zile înainte”. AC stabilește în anunț 1 sau 2 termene de răspuns (art. 160 alin. (2)), iar termenul-limită pentru întrebări trebuie corelat cu ele (HG 395 art. 27 alin. (2)).
8. **Cauțiunea la CNSC** (L101 art. 61^1) se constituie în **maximum 5 zile de la sesizarea CNSC**. Termenul este de decădere: CNSC a respins o contestație pentru o cauțiune depusă cu 3 zile întârziere (Decizia 2863/C4/3581 din 25.09.2025).
   - Sub prag: 2% din valoarea estimată, plafonat la **35.000 lei** dacă se contestă documentația și la **88.000 lei** dacă se contestă rezultatul.
   - Peste prag: plafoanele sunt 220.000 / 2.000.000 lei în forma curentă (corectat 02.10; 880.000 era în forma 2018–2019; CNSC BO2024_3004).
9. **Termenele pentru clarificări la evaluare:**
   - răspunsul la clarificările comisiei: maximum **15 zile lucrătoare**, inclusiv prelungirea (L98 art. 209 alin. (3));
   - documentele justificative ale primului clasat: până la **7 + 3 zile lucrătoare** (art. 196 alin. (2));
   - documentele cerute oricând pe parcurs: **5 + 5 zile lucrătoare** (art. 196 alin. (1));
   - clarificările privind garanția de participare: comisia întreabă în 1 zi lucrătoare, iar ofertantul răspunde în **3 zile** (HG 395 art. 132 alin. (3)).
10. **HG 1/2018 are valori implicite care se aplică dacă Acordul Contractual nu prevede altceva.** Cea mai periculoasă este **penalitatea de întârziere (cl. 36.4)**: valoarea pe zi este Prețul Contractului împărțit la Durata de Execuție în zile, cu plafon de 15% din preț. Practic, plafonul se atinge foarte repede, iar atingerea lui dă beneficiarului drept de reziliere (cl. 36.5). Alte valori implicite:
    - GBE 10%;
    - Sume Reținute 5% din fiecare certificat, în plus față de GBE;
    - prețuri ferme dacă durata este de cel mult 365 de zile (cl. 48.2), ceea ce intră în conflict cu L98 art. 222^2 alin. (9), care cere ajustare la peste 6 luni;
    - revendicări: notificare în 30 de zile și detaliere în încă 30 de zile.

---

### 2. Legea 98/2016 — articole-cheie pentru ofertant (forma la 13.06.2024)

| Temă | Articol | Ce prevede pentru Gazpet |
|---|---|---|
| Clarificări la documentație | art. 160 | Dreptul de a întreba până la termenul din anunț. AC fixează 1–2 termene de răspuns și publică răspunsurile fără să dezvăluie cine a întrebat. |
| Termen de răspuns al AC | art. 161 | Cel puțin 10 zile înainte de depunere (5 la urgență). Procedura simplificată: cel puțin 6 zile la lucrări. |
| Garanția de participare | art. 154 alin. (2), (4); 154^1 | Maximum 1% din valoarea estimată, valabilă cel puțin cât oferta. Se acceptă: virament, scrisoare bancară, IFN (doar la lucrări de până la 40 mil. lei), asigurare, numerar sub 5.000 lei. Restituire în 3 zile lucrătoare. |
| Garanția de bună execuție | art. 154 alin. (3); 154^2 alin. (5) | Maximum 10% din preț fără TVA. La lucrări se restituie 70% în 14 zile de la recepția la terminare și 30% la recepția finală. |
| DUAE | art. 193–196 | DUAE separat pentru terț și subcontractant; acordul de subcontractare se anexează. Documentele justificative se cer doar primului clasat: 7 + 3 zile lucrătoare. |
| Calificare | art. 172–179 | Cerințe proporționale. Cifra de afaceri se poate cere pe cel mult ultimii 3 ani (art. 177, potrivit avizelor ANAP). Lucrările relevante: din ultimii 5 ani (art. 179 lit. a)). |
| Terț susținător | art. 182–183 | Angajament ferm + documentele care arată cum se face efectiv susținerea. Pentru experiența profesională sau calificările personalului, terțul trebuie să execute efectiv lucrarea. Dacă terțul nu corespunde, AC cere înlocuirea lui o singură dată. |
| Clarificări la ofertă | art. 209 | Clarificările nu pot crea un avantaj evident și nu pot modifica oferta substanțial. Termen maxim: 15 zile lucrătoare. |
| Preț neobișnuit de scăzut | art. 210 + HG 395 art. 136 | Clarificarea este obligatorie sub 80% din valoarea estimată. Respingerea e posibilă doar dacă justificarea e insuficientă. Respingerea e obligatorie dacă oferta nu respectă obligațiile de mediu, sociale sau de muncă (art. 51). |
| Subcontractare | art. 218–220 | Subcontractantul poate cere plata directă. Contractele cu subcontractanții devin anexe la contract. |
| Modificarea contractului | art. 221 | Clauze de revizuire clare (lit. a)); suplimentări de maximum 50% (lit. b), c)); modificare de minimis sub pragul legal și sub 15% la lucrări (lit. f)). |
| Ajustarea prețului | art. 222^2 | Obligatorie la lucrări de peste 6 luni. Formula, indicii și sursa trebuie să apară în documentație și în contract. Plata se face doar pe prețurile din ofertă, fixe sau ajustate (alin. (10)). |

### 3. HG 395/2016 — articole cu impact

- **art. 27** — răspunsurile se publică în SEAP; termenul pentru întrebări trebuie corelat cu termenul de răspuns; sunt posibile două termene.
- **art. 35–37** — garanția de participare: se transmite în SEAP până la termenul de depunere și se plătește la prima cerere. AC nu poate impune sau exclude un anumit emitent (art. 36 alin. (5)). Garanția se reține dacă ofertantul își retrage oferta, nu constituie GBE, nu deschide contul pentru rețineri sau refuză să semneze.
- **art. 39–41** — GBE: se constituie în 5 zile lucrătoare (cel mult 15 zile la cerere). La reținere succesivă se deschide cont la Trezorerie cu minimum 0,5%. Pretențiile asupra GBE trebuie notificate și contractantului, și emitentului, cu calculul prejudiciului.
- **art. 132–137** — evaluarea:
  - vicii de formă (art. 135);
  - abateri tehnice minore: sub 1% din preț și fără schimbarea clasamentului (art. 134 alin. (7)–(9));
  - erori aritmetice: se corectează, iar refuzul corecturii face oferta inacceptabilă (art. 134 alin. (10)–(11));
  - prag de 80% pentru prețul neobișnuit de scăzut (art. 136 alin. (4));
  - oferte inacceptabile și neconforme (art. 137), inclusiv refuzul de a prelungi valabilitatea ofertei sau a garanției de participare (lit. i)).
- **art. 164** — ABROGAT.
- **art. 166** — documentele constatatoare la lucrări: 14 zile după recepția la terminare și 14 zile după recepția finală; pot fi emise și la fiecare 90 de zile pe parcurs (alin. (5^2)). Se contestă în contencios administrativ.

### 4. Legea 101/2016 — remedii

- **Termen de contestație** (art. 8): **10 zile** dacă valoarea estimată este cel puțin egală cu pragul JOUE (lucrări: 26.960.556 lei din 2026) și **7 zile** sub prag. Termenul curge din ziua următoare luării la cunoștință.
- **Cauțiune** (art. 61^1): 2%, cu plafoanele de mai sus, constituită în 5 zile de la sesizarea CNSC. La acord-cadru se raportează la dublul celui mai mare contract subsecvent; la loturi, la valoarea lotului contestat. Se restituie la cel puțin 30 de zile după ce decizia CNSC rămâne definitivă.
- **Notificarea prealabilă** (art. 6): după surse secundare, obligativitatea a fost eliminată prin Legea 208/2022 (neverificat în text primar).
- **CNSC și instanța:** termenul de soluționare la CNSC (15 sau 20 de zile, în zile lucrătoare după 2022) și termenul de plângere la curtea de apel (10 zile) sunt NEVERIFICATE în forma curentă.

### 5. Legea 99/2016 (sectoriale) — de ce contează

Operatorii de distribuție a gazelor (Delgaz Grid, Distrigaz Sud Rețele etc.) și operatorii regionali de apă cumpără ca **entități contractante sectoriale**, prin L99 și HG 394/2016. Diferențele relevante:
- praguri mai mari la produse și servicii (2.155.248 lei);
- alegerea liberă a negocierii competitive sau a licitației restrânse;
- posibilitatea sistemelor de calificare.

Articolele sunt aceleași ca în L98, cu altă numerotare: clarificări art. 172–173; experiență similară art. 191–192; modificarea contractului art. 236; ajustare HG 394 art. 158 alin. (3).
Remediile sunt tot cele din L101, raportate la pragurile din art. 12 alin. (1) L99.
Pragul de achiziție directă din L99 după 2022 nu a fost verificat.

### 6. Ajustarea prețului — tablou

| Situație | Temei | Formula/indicele |
|---|---|---|
| Contract nou de lucrări, durată > 6 luni | L98 art. 222^2 alin. (9) (obligatoriu) + clauza din contract | Cea din documentație. La HG 1/2018 se aplică cl. 48.4 (polinomială An = av + m·Mn/Mo + f·Fn/Fo + e·En/Eo) sau, dacă tabelul nu e completat, cl. 48.5 (An = av + (1−av)·ICCn/ICC0). Indicii se iau la 60 de zile înainte de sfârșitul lunii n. Data de referință este cu 30 de zile înainte de termenul de depunere. |
| Contract HG 1/2018 cu durata de cel mult 365 de zile | cl. 48.2 | Preț ferm, cu excepția modificării legii (cl. 48.8). Atenție la conflictul cu art. 222^2 alin. (9) dacă durata depășește 6 luni. |
| Contract național aflat în derulare la 15.04.2022, fără clauză | OUG 47/2022 art. 3 | Va = V0 × [(1−p−a) × ICCn/ICCref] + (p+a), cu cerere în 45 de zile (termen expirat pentru contractele vechi) |
| Proiect cu fonduri UE nerambursabile aflat în derulare | OUG 64/2022 art. 17 | NEVERIFICAT; pentru apă-canal majoră se folosește ICC pentru materiale (sursă secundară) |
| Întârziere din culpa antreprenorului | HG 1/2018 cl. 48.7 | Se aplică indicii cei mai favorabili beneficiarului |

### 7. Contracte tip — HG 1/2018 (Anexa 1 execuție, Anexa 2 proiectare + execuție)

Modelul este **obligatoriu** pentru contractele de lucrări finanțate din fonduri publice (inclusiv UE și sectoriale) cu valoare estimată de cel puțin 26,96 mil. lei. Sub acest prag este **facultativ**. Valorile implicite principale:

| Element | Clauza | Valoare implicită (dacă Acordul Contractual tace) |
|---|---|---|
| GBE | 15.1 | 10% din preț. Se constituie în 5 zile lucrătoare. Reținerea succesivă e permisă doar dacă e prevăzută în documentație. |
| Restituire GBE | 15.6 | 70% în 14 zile de la Recepția la Terminare; restul la Recepția Finală |
| Pretenții asupra GBE | 15.3 | Doar în 4 cazuri: neprelungire, neplată în 30 de zile, neremediere în 30 de zile, reziliere |
| Penalități de întârziere | 36.4 | Pe zi: Prețul / Durata în zile; plafon 15% din preț; atingerea plafonului dă drept de reziliere |
| Reținere pentru puncte de referință (milestones) | 36.3 | 10% din certificatele de plată |
| Avans | 46.6 / 46.7 | O tranșă de 15% pe an, dedusă integral din situații; sau o tranșă unică de 15% recuperată câte 25% din fiecare certificat. Garanția de returnare = avansul + dobânda de referință BNR. |
| Sume Reținute | 47.2 | 5% din fiecare certificat, până la 5% din preț; 50% se plătesc la Recepția la Terminare, restul la Recepția Finală; se opresc când împreună cu GBE ating 10% |
| Plată | 50.4 | 30 de zile de la Certificatul de Plată; factura se emite din ziua a 15-a |
| Dobândă pentru întârzierea plății | 53.1 | Rata de referință BNR + 8 puncte procentuale |
| Perioada de garanție a lucrărilor | 61.6 | 5 ani (categoriile A/B), 3 ani (C), 1 an (D) |
| Revendicări | 69a | Notificare în 30 de zile de la eveniment; detaliere în încă 30 de zile; costurile se separă pe categorii, altfel se pierde dreptul |
| Condiții fizice neprevăzute | 21.1 | Includ utilitățile subterane; se notifică „de îndată” |
| Cantități | 49.1 | Lista de Cantități este estimativă; se plătesc cantitățile măsurate. Prețurile forfetare nu se modifică (49.2 lit. c)). |
| Dispute | 70 | Soluționare amiabilă, apoi arbitraj sau instanță, după cum se alege |

**FIDIC** (folosit la POS Mediu și POIM apă-canal, ediția 1999 sau 2017; textul este plătit și nu a fost verificat în sesiune):
- administrarea contractului o face Engineer-ul;
- ajustarea prețului: sub-cl. 13.8 (ed. 1999) sau 13.7 (ed. 2017);
- revendicări: **notificare în 28 de zile, cu decădere** (sub-cl. 20.1 în ed. 1999; 20.2.1 în ed. 2017); detaliere în 42 de zile (1999) sau 84 de zile (2017);
- disputele merg la DAB/DAAB.

### 8. Tabel — termene procedurale esențiale

| # | Ce | Termen | Temei | Verificat |
|---|---|---|---|---|
| 1 | Întrebări de clarificare (ofertant) | Până la termenul-limită din anunț, corelat cu termenul de răspuns al AC | L98 art. 160 alin. (1); HG 395 art. 27 alin. (2) | da |
| 2 | Răspunsul AC (procedură peste prag) | Cu cel puțin 10 zile înainte de depunere (5 zile la urgență justificată) | L98 art. 161 alin. (1) | da |
| 3 | Răspunsul AC (procedură simplificată, lucrări) | Cu cel puțin 6 zile înainte (3 zile la produse/servicii, 2 zile la produse simple/urgență) | L98 art. 161 alin. (2) | da |
| 4 | Răspunsurile AC la control ex-ante | Se trimit la ANAP cu cel puțin 4 zile înainte de termenul de răspuns | OUG 98/2017; notificarea ANAP din 27.07.2018 | da |
| 5 | Garanția de participare | Maximum 1% din valoarea estimată; valabilă cel puțin cât oferta; încărcată în SEAP până la ora-limită | L98 art. 154 alin. (2); HG 395 art. 35, art. 36 alin. (4) | da |
| 6 | Clarificări privind garanția de participare | Comisia întreabă în 1 zi lucrătoare; ofertantul răspunde în 3 zile, sub sancțiunea respingerii | HG 395 art. 132 alin. (3) | da |
| 7 | Valabilitatea ofertei | Stabilită de AC; refuzul prelungirii valabilității ofertei sau garanției face oferta inacceptabilă | HG 395 art. 137 alin. (2) lit. i) | da |
| 8 | Răspuns la clarificările comisiei | Stabilit de comisie, în zile lucrătoare, fără oră; maximum 15 zile lucrătoare inclusiv prelungirea | HG 395 art. 134 alin. (1); L98 art. 209 alin. (3) | da |
| 9 | Documente justificative cerute oricând | 5 zile lucrătoare + maximum 5 | L98 art. 196 alin. (1) | da |
| 10 | Documente justificative ale primului clasat | Până la 7 zile lucrătoare + maximum 3 | L98 art. 196 alin. (2) | da |
| 11 | Restituirea garanției de participare | Maximum 3 zile lucrătoare (după GBE, după semnare sau la cerere după comunicarea rezultatului) | L98 art. 154^1 | da |
| 12 | Constituirea GBE | 5 zile lucrătoare de la semnare (cel mult 15 zile la cerere justificată) | HG 395 art. 39 alin. (3); HG 1/2018 cl. 15.1 | da |
| 13 | Cuantumul GBE | Maximum 10% din preț fără TVA (implicit 10% la HG 1/2018) | L98 art. 154 alin. (3) | da |
| 14 | Restituirea GBE la lucrări | 70% în 14 zile de la PV de recepție la terminare; 30% la recepția finală | L98 art. 154^2 alin. (5); HG 1/2018 cl. 15.6 | da |
| 15 | Contestația la CNSC | 10 zile (valoare estimată cel puțin egală cu pragul JOUE) / 7 zile (sub prag), din ziua următoare luării la cunoștință | L101 art. 8 alin. (1) | parțial (decizii CNSC + surse secundare) |
| 16 | Cauțiunea | În 5 zile de la sesizarea CNSC; 2%; plafon 35.000 / 88.000 lei sub prag; 220.000 / 2.000.000 lei peste prag (corectat 02.10; forma 2019 avea 880.000) | L101 art. 61^1 | sub prag: da; peste prag: nu |
| 17 | Plângerea la curtea de apel | 10 zile de la comunicarea deciziei CNSC | L101 art. 29 | nu |
| 18 | Plata situațiilor (HG 1/2018) | 30 de zile de la Certificatul de Plată; dobândă = rata de referință BNR + 8 puncte procentuale | HG 1/2018 cl. 50.4, 53.1 | da |
| 19 | Revendicări (HG 1/2018) | Notificare în 30 de zile de la eveniment + detalii în 30 de zile | cl. 69a.1–69a.2 | da |
| 20 | Revendicări (FIDIC) | 28 de zile pentru notificare (decădere); detalii în 42 (1999) / 84 (2017) de zile | sub-cl. 20.1 / 20.2 | nu (text plătit) |
| 21 | Documentul constatator | 14 zile de la recepția la terminare + 14 zile de la recepția finală | HG 395 art. 166 alin. (1) lit. e) | da |
| 22 | Pragul de preț neobișnuit de scăzut | Sub 80% din valoarea estimată, fără TVA | HG 395 art. 136 alin. (4) | da |
| 23 | Abaterea tehnică minoră | Cuantificare de cel mult 1% din prețul total și fără schimbarea clasamentului | HG 395 art. 134 alin. (7)–(9) | da |
| 24 | Modificarea de minimis a contractului | Sub pragul legal ȘI sub 15% din preț (lucrări) | L98 art. 221 alin. (1) lit. f) | da |
| 25 | Ajustarea prețului obligatorie | Lucrări cu durată de peste 6 luni | L98 art. 222^2 alin. (9) | da |

---

### 9. Clauze HG 1/2018 ambigue tipice — merită clarificări

1. **Penalități de întârziere (cl. 36.4).** Dacă Acordul Contractual nu stabilește un procent pe zi, se aplică formula Preț / Durată, adică 100% din valoarea zilnică, plafonată la 15%. Trebuie cerut un procent explicit, de exemplu 0,0x% pe zi.
2. **Ajustarea prețului (cl. 48.2–48.5 și L98 art. 222^2).** Problemele tipice:
   - durata este între 6 și 12 luni, iar modelul prevede preț ferm (cl. 48.2), ceea ce încalcă art. 222^2 alin. (9);
   - tabelul de ajustare nu este completat, deci se aplică implicit doar ICC total;
   - lipsește coeficientul „av”, deși se acordă avans;
   - ponderile m/f/e nu reflectă cât de mult contează țeava (oțel sau PE) într-o rețea de gaze.
3. **GBE și Sume Reținute cumulate (cl. 15 + 47).** Trebuie clarificat dacă se aplică ambele (10% + 5%), dacă se acceptă reținerea succesivă (ANAP a cerut eliminarea ei la contractele HG 1/2018) și ce procent se restituie la recepția la terminare.
4. **Avans (cl. 46).** De clarificat dacă se acordă, în ce procent, în câte tranșe și după ce mecanism de recuperare (46.6 sau 46.7).
5. **Perioada de garanție (cl. 61.6).** Lipsește categoria de importanță sau perioada exactă. La rețelele de gaze categoria (C sau B) schimbă garanția de la 3 la 5 ani.
6. **Data de începere, predarea amplasamentului și autorizația de construire (cl. 9, 10, 33).** ANAP a semnalat frecvent că acestea lipsesc din caietele de sarcini.
7. **Utilități subterane și condiții fizice neprevăzute (cl. 20–21).** La lucrări în zone cu rețele existente trebuie cerute avizele, planurile de utilități și studiul geotehnic. Contează și cine suportă riscul pentru utilitățile neidentificate.
8. **Cantități estimative vs. preț forfetar (cl. 49).** Trebuie identificate articolele forfetare (de exemplu organizarea de șantier sau probele de presiune), pentru care nu se plătesc cantitățile suplimentare.
9. **Identitatea Supervizorului și rolul dirigintelui de șantier (cl. 5.6).** De clarificat cine certifică situațiile de plată.
10. **Disputele (cl. 70).** De clarificat dacă se merge la arbitraj (care?) sau în instanță.
11. **Puncte de referință (cl. 36.3).** De clarificat dacă există, care sunt și ce reținere se aplică.
12. **Termenul de revendicare.** Dacă AC a înlocuit cele 30 de zile cu 28 de zile (preluate din FIDIC), trebuie confirmat termenul.

---

### Fișe

#### Legea 98/2016 
- **🟡 modificat** · lege · Parlamentul României · ediție: Formă consolidată CTCE valabilă 24.05.2024–13.06.2024 (publicată de ANAP); ultimul act modificator inclus: OUG 52/2024 (MO 483/24.05.2024). Modificări ulterioare iunie 2024 → oct. 2026 NEVERIFICATE (legislatie.just.ro inaccesibil). · `ofertare_normative.id = 5`
- **Titlu:** Legea nr. 98/2016 privind achizițiile publice
- **Ce cere:** Cadrul general al procedurilor de atribuire (clasic). Pentru ofertant: dreptul la clarificări în termenul din anunț, DUAE ca dovadă preliminară, documente justificative doar pentru primul clasat, posibilitatea terț susținător/subcontractant/asociere, clarificări/completări fără modificarea substanțială a ofertei, justificarea prețului aparent neobișnuit de scăzut, garanții (participare ≤1%, bună execuție ≤10%), modificarea contractului (art. 221) și ajustarea prețului (art. 222^2).
- **Praguri:**
  - Art. 7(1) lit. a) — prag publicare JOUE lucrări: 27.334.460 lei (2024–2025); de la 01.01.2026: 26.960.556 lei = 5.404.000 EUR (Reg. delegat (UE) 2025/2152, notificare ANAP 10.12.2025) — se aplică direct
  - Art. 7(1) lit. b)/c) — produse/servicii: 698.460 lei (140.000 EUR) AC centrale / 1.077.624 lei (216.000 EUR) AC locale, din 2026
  - Art. 7(5) — achiziție directă: produse/servicii < 270.120 lei; lucrări < 900.400 lei (fără TVA)
  - Art. 154(2) — garanție de participare ≤ 1% din valoarea estimată (acord-cadru: din cel mai mare subsecvent)
  - Art. 154(3) — garanție de bună execuție ≤ 10% din prețul contractului fără TVA; la lucrări sub prag AC poate să nu o ceară
  - Art. 154(4) lit. b) pct. (ii) — scrisori IFN acceptate doar pentru lucrări cu valoare estimată ≤ 40.000.000 lei
  - Art. 154^2(5) — restituire GBE lucrări: 70% în 14 zile de la PV recepție la terminare (dacă risc vicii ascunse minim); 30% la expirarea perioadei de garanție, pe baza PV recepție finală
  - Art. 161(1) — răspuns AC la clarificări: cu ≥10 zile (≥5 zile urgență) înainte de termenul de depunere
  - Art. 161(2) — procedura simplificată: ≥6 zile la lucrări; 3 zile produse/servicii; 2 zile produse complexitate redusă/urgență
  - Art. 196(1) — documente justificative cerute oricând: max. 5 zile lucrătoare + prelungire max. 5 zile lucrătoare
  - Art. 196(2) — primul clasat: AC cere în 1 zi lucrătoare; ofertantul are până la 7 zile lucrătoare (+ max. 3 zile lucrătoare)
  - Art. 209(3) — termen răspuns clarificări ofertă: max. 15 zile lucrătoare inclusiv prelungirea
  - Art. 221(1) lit. b),c) — suplimentări max. 50% din valoarea inițială; lit. f) — modificare de minimis: < prag art. 7(1) ȘI < 15% din preț la lucrări (10% produse/servicii)
  - Art. 222^2(9) — clauze de ajustare OBLIGATORII la lucrări cu durată > 6 luni (servicii/furnizare > 24 luni); art. 222^2(8) — facultative la lucrări ≤ 6 luni
  - Art. 179 lit. a) — lista lucrărilor din cel mult ultimii 5 ani (poate extinde AC)
- **Documente / atestări:**
  - DUAE (ofertant, fiecare asociat, terț susținător, subcontractant pe a cărui capacitate se bazează ofertantul — art. 193(2),(3))
  - Angajament ferm de susținere + documente din care rezultă modul efectiv de susținere (art. 182(3),(4))
  - Acord de subcontractare anexat DUAE (art. 193(3))
  - Garanție de participare: virament, scrisoare bancară, IFN (lucrări ≤40 mil. lei), asigurare de garanții, numerar <5.000 lei (art. 154(4))
  - Certificate de bună execuție / PV recepție pentru lucrările cele mai importante (art. 179 lit. a)
- **Verificări / probe:**
  - Comisia verifică DUAE pentru toți; documente justificative doar la primul clasat
  - Verificarea terțului susținător (art. 183) — o singură dată AC cere înlocuirea terțului necorespunzător
  - Verificare preț aparent neobișnuit de scăzut (art. 210 + HG 395 art. 136)
- **Articole cheie:**
  - art. 7 — praguri; alin. (5) achiziție directă
  - art. 154 — garanția de participare și de bună execuție (forme, cuantum)
  - art. 154^1 — restituirea garanției de participare (3 zile lucrătoare)
  - art. 154^2 — restituirea GBE (lucrări 70%/30%)
  - art. 160 — dreptul la clarificări; AC stabilește 1 sau 2 termene de răspuns în anunț; publicare anonimizată
  - art. 161 — 10/5 zile; simplificată 6/3/2 zile
  - art. 172–173 — cerințe de calificare proporționale; capacitatea profesională (autorizări)
  - art. 175, 177 — situația economică (cifra de afaceri — max. ultimii 3 ani)
  - art. 179 — capacitate tehnică (lit. a) lucrări ultimii 5 ani; lit. g) calificări; lit. j) utilaje; lit. k) subcontractare)
  - art. 182–183 — terț susținător (angajament ferm + documente anexe; înlocuire o singură dată)
  - art. 193–196 — DUAE, documente justificative și termene
  - art. 209 — clarificări/completări (fără avantaj evident, fără modificare substanțială; max 15 zile lucrătoare)
  - art. 210 — preț/cost aparent neobișnuit de scăzut (obligație AC de a cere clarificări; respingere doar dacă dovezile nu justifică)
  - art. 215 — comunicarea rezultatului (ofertă inacceptabilă/neconformă)
  - art. 218–220 — subcontractare, plata directă a subcontractanților
  - art. 221 — modificarea contractului fără procedură nouă
  - art. 222^1 — publicarea modificărilor în SEAP
  - art. 222^2 — ajustarea prețului (indici, sursă, formulă obligatorii în DA + contract)
- **Modificări:**
  - OUG 107/2017 — art. 160 (termene clarificări în anunț), art. 182(2), art. 193, art. 210(1)
  - OUG 45/2018 — art. 7(1), art. 161 (10/5 zile; 6/3/2 zile la simplificată), art. 221
  - OUG 114/2020 — art. 209(1^1) (max. 2 runde clarificări la simplificate pe fonduri UE infrastructură), art. 221(1)f), art. 222^1
  - OUG 26/2022 — art. 196(2) (7+3 zile lucrătoare documente justificative), art. 218(7)
  - Legea 256/2022 — art. 196(1) (5+5 zile lucrătoare), art. 218(1)
  - Legea 208/2022 (în vigoare 10.09.2022) — art. 7(2),(5) (achiziție directă 270.120 / 900.400 lei), art. 154 (garanții mutate în lege), art. 154^1, art. 154^2, art. 193(6), art. 209(3) (max. 15 zile lucrătoare), art. 222^2 (ajustarea prețului, preluat din HG 395 art. 164)
  - OUG 136/2022 — art. 154(4) (forme garanții: IFN pentru lucrări ≤ 40.000.000 lei)
  - OUG 52/2024 — abrogă art. 182(2^1), art. 222^2 alin. (4),(7),(11)-(13); modifică art. 222^2(8)
  - NB: «OUG 25/2023» NU apare printre actele modificatoare; există OUG 25/2021. «Legea 208/2022» e reală și e modificarea majoră.
- **Ofertare:** Baza tuturor verificărilor de conformitate a ofertei Gazpet: calcul termene, garanții, DUAE, terți, subcontractanți, prag 80% preț, eligibilitate modificări/ajustare. Pragurile 2026 (26.960.556 lei lucrări) determină termenul de contestare (10 vs 5 zile) și plafonul cauțiunii.
- **Clarificări:** Art. 160–161: întrebările se pun până la termenul-limită din anunț (de regulă în SEAP); dacă AC răspunde după termenul legal (10 zile/6 zile simplificată) → temei de solicitare a prelungirii termenului de depunere. Art. 209: orice răspuns la clarificări ale comisiei nu poate modifica substanțial oferta.
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2022/10/Legea-nr.-98-din-2016-privind-achizitiile-publice-versiune-actualizata-la-13.06.2024.pdf

#### HG 395/2016 
- **🟡 modificat** · hg · Guvernul României · ediție: Formă consolidată CTCE valabilă 24.05.2024–13.06.2024 (ANAP). Modificatori: Ordin 264/2016, HG 866/2016, HG 419/2018, HG 485/2020, HG 375/2022, HG 336/2023, OUG 52/2024. · `ofertare_normative.id = 9`
- **Titlu:** HG 395/2016 — Normele metodologice de aplicare a prevederilor referitoare la atribuirea contractului de achiziție publică/acordului-cadru din Legea 98/2016
- **Ce cere:** Detaliază procedura: răspunsuri la clarificări în SEAP, garanția de participare (instrument transmis în SEAP, plătibil la prima cerere), GBE (5 zile lucrătoare, reținere succesivă prin cont la Trezorerie), evaluarea ofertelor (clarificări formale, vicii de formă, abateri tehnice minore, erori aritmetice), preț neobișnuit de scăzut (prag 80%), oferte inacceptabile/neconforme, documente constatatoare.
- **Praguri:**
  - Art. 136(4) — preț aparent neobișnuit de scăzut: preț ofertat fără TVA < 80% din valoarea estimată (introdus de HG 375/2022)
  - Art. 134(9) lit. a) — NU e abatere tehnică minoră dacă cuantificarea depășește 1% din prețul total al ofertei
  - Art. 132(3) — clarificări privind garanția de participare: comisia întreabă în 1 zi lucrătoare de la termenul de depunere; ofertantul răspunde în 3 zile, sub sancțiunea respingerii
  - Art. 134(1) — termenele de răspuns la clarificări se stabilesc doar în zile lucrătoare, fără oră
  - Art. 39(3) — GBE constituită în 5 zile lucrătoare de la semnare; prelungire la cerere justificată max. 15 zile de la semnare
  - Art. 40(6) — reținere succesivă: suma inițială în cont ≥ 0,5% din prețul fără TVA
  - Art. 166(1) lit. e) — document constatator lucrări: 14 zile de la PV recepție la terminare + 14 zile de la PV recepție finală; art. 166(5^2) — se pot emite și la fiecare 90 de zile pe parcurs
- **Documente / atestări:**
  - Instrument de garantare pentru GP încărcat în SEAP până la termenul de depunere (art. 36(4))
  - Cont de disponibil la Trezorerie pentru GBE prin rețineri succesive, sumă inițială ≥ 0,5% (art. 40(4)-(6))
  - Dovezi concludente la justificarea prețului: oferte furnizori, stocuri, organizare, salarizare, costuri utilaje (art. 136(2))
- **Verificări / probe:**
  - Corelarea propunerii financiare cu cea tehnică (art. 133(3))
  - Respingerea ofertelor inacceptabile/neconforme/neadecvate (art. 137)
- **Articole cheie:**
  - art. 27 — răspunsuri la clarificări în SEAP; termen-limită pentru întrebări în anunț; 2 termene de răspuns posibile
  - art. 35–37 — garanția de participare (scop, cuantum ≤1%, valabilitate ≥ oferta, transmitere în SEAP, reținere)
  - art. 39–41 — garanția de bună execuție (5 zile lucrătoare, reținere succesivă, pretenții numai cu notificare prealabilă către contractant și emitent)
  - art. 132 — DUAE; clarificări GP (1 zi / 3 zile)
  - art. 133 — analiza tehnică și financiară
  - art. 134 — clarificări formale; abateri tehnice minore (≤1%); erori aritmetice
  - art. 135 — vicii de formă
  - art. 136 — preț aparent neobișnuit de scăzut; alin. (4) prag 80%
  - art. 137 — oferte inacceptabile (lit. i refuz prelungire valabilitate ofertă/GP) și neconforme
  - art. 164 — ABROGAT din 19.04.2023 (ajustarea prețului → L98 art. 222^2)
  - art. 166 — documente constatatoare
- **Modificări:**
  - HG 419/2018 — art. 27(2)-(4) (termen-limită întrebări corelat cu termenul de răspuns), art. 134(6)-(11) (abateri tehnice minore, erori aritmetice), art. 135 (vicii de formă), art. 137
  - HG 375/2022 (MO 277/22.03.2022) — introduce art. 136(4): preț aparent neobișnuit de scăzut = < 80% din valoarea estimată; art. 39(3) GBE în 5 zile lucrătoare
  - HG 336/2023 (MO 328/19.04.2023) — ABROGĂ art. 164 (ajustarea prețului, mutată în L98 art. 222^2 prin Legea 208/2022), abrogă art. 35(2)-(3), 36(1),(3),(6), 38, 39(2),(4), 40(1)-(3), 42; modifică art. 36(4)-(5), 37(1) lit. b^1), 134(3), 137, 166
- **Ofertare:** Prag automat 80% din valoarea estimată → la ofertele Gazpet sub prag trebuie pregătit din start dosarul de justificare (art. 136(2)). Erorile aritmetice se corectează la cererea comisiei; refuzul → ofertă inacceptabilă (art. 134(11)). Corectarea abaterilor tehnice minore e permisă doar sub 1% și fără schimbarea clasamentului.
- **Clarificări:** Art. 27(2): anunțul trebuie să conțină termenul-limită pentru întrebări corelat cu termenul de răspuns — dacă lipsește/e nerezonabil, se poate cere clarificare/prelungire. Art. 36(5): AC nu poate impune sau interzice un anumit emitent de garanție.
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2022/09/HOTARARE-nr.-395-2016-1.pdf

#### Legea 101/2016 · ⚠️ neverificat integral
- **🟡 modificat** · lege · Parlamentul României · ediție: Nu am putut obține forma consolidată curentă (legislatie.just.ro inaccesibil; ANAP are doar variante 2016–2020). Textele de mai jos sunt confirmate din decizii CNSC 2024–2025. · `ofertare_normative.id = 10`
- **Titlu:** Legea nr. 101/2016 privind remediile și căile de atac în materie de atribuire a contractelor de achiziție publică, sectoriale și de concesiune și organizarea CNSC
- **Ce cere:** Contestația la CNSC sau acțiunea în instanță împotriva actelor AC (documentație, rezultat). Termen de 10 zile (procedură cu valoare estimată ≥ pragurile de publicare JOUE) sau 7 zile (sub prag), de la ziua următoare luării la cunoștință. Cauțiune obligatorie, sub sancțiunea respingerii.
- **Praguri:**
  - Art. 8(1) lit. a) — 10 zile dacă valoarea estimată ≥ pragurile de publicare JOUE (lucrări 26.960.556 lei din 01.01.2026)
  - Art. 8(1) lit. b) — 7 zile dacă valoarea estimată < pragurile JOUE
  - Art. 61^1(1) lit. a) — sub prag: cauțiune 2% din valoarea estimată, max. 35.000 lei (contestații la documentație, etapa art. 17(1) lit. a) / max. 88.000 lei (contestații după evaluare, etapa art. 17(1) lit. b) — confirmat Decizia CNSC 2863/C4/3581/25.09.2025
  - Art. 61^1(1) lit. b) — peste prag: 2%, plafoane 220.000 lei / 2.000.000 lei (forma curentă, confirmată de CNSC BO2024_3004; 880.000 era în forma 2018–2019) (verificat în forma curentă)
  - Art. 61^1(2) — acord-cadru: raportare la dublul valorii celui mai mare contract subsecvent; (2^1) loturi: valoarea lotului contestat
  - Art. 61^1(5) — restituire cauțiune nu mai devreme de 30 de zile de la rămânerea definitivă a deciziei CNSC
- **Documente / atestări:**
  - Contestație + dovada cauțiunii (recipisă CEC/virament/scrisoare de garanție) în max. 5 zile de la sesizarea CNSC
- **Verificări / probe:**
  - CNSC verifică din oficiu termenul de decădere al cauțiunii (respingere pentru depunere cu 3 zile întârziere — Decizia 2863/C4/3581/2025)
- **Articole cheie:**
  - art. 6 — notificarea prealabilă (obligativitate eliminată prin Legea 208/2022 — de reconfirmat)
  - art. 8 — termene contestație 10/7 zile
  - art. 17 — etapele procedurii (relevante pentru plafonul cauțiunii)
  - art. 29 / art. 32 — plângerea împotriva deciziei CNSC la curtea de apel (termen de 10 zile — NEVERIFICAT în forma curentă)
  - art. 61^1 — cauțiunea
- **Modificări:**
  - OUG 45/2018 — a introdus notificarea prealabilă obligatorie (art. 6)
  - Legea 208/2022 — a abrogat caracterul obligatoriu al notificării prealabile (art. 6(1)); termene CNSC în zile lucrătoare (NEVERIFICAT din text primar)
  - Cauțiunea (art. 61^1) — constituire în max. 5 zile de la sesizarea CNSC (în 2020 era 3 zile lucrătoare); plafoane diferențiate pe etapa procedurii (confirmat prin Decizia CNSC 2863/C4/3581 din 25.09.2025)
- **Ofertare:** Planificare: la fiecare comunicare a rezultatului/răspuns la clarificare nefavorabil, calculați imediat termenul (5 sau 10 zile) și cauțiunea; bugetați cauțiunea (ex. sub prag după evaluare: până la 88.000 lei).
- **Clarificări:** Contestarea documentației (cerințe restrictive, clauze abuzive) curge de la publicarea documentației/răspunsului la clarificare. Recomandat: întâi întrebare de clarificare → dacă AC menține cerința, contestație în termen calculat de la publicarea răspunsului.
- **Acces:** public · Sursă: http://portal.cnsc.ro/sivadoc/download.aspx?docUID=ZTEwNWEwM2QtZjIyMi00ZmNjLTlhMTAtN2Y5MmJmNjEyMjEz&pdfa1=ZmFsc2U%3D&filename=Qk8yMDI1XzI4NjMucGRm&action=aW5saW5l

#### Legea 99/2016 · ⚠️ neverificat integral
- **🟡 modificat** · lege · Parlamentul României · ediție: Forma consolidată curentă NEACCESATĂ (ANAP/legislatie.just.ro blocate). Pragurile UE 2026 confirmate din surse secundare. · `ofertare_normative.id = 7`
- **Titlu:** Legea nr. 99/2016 privind achizițiile sectoriale
- **Ce cere:** Se aplică entităților contractante care desfășoară activități relevante (inclusiv rețele de distribuție gaze naturale și apă potabilă/canalizare — operatori de distribuție, companii de apă). Proceduri mai flexibile decât L98 (negocierea competitivă cu anunț și licitația restrânsă se pot alege liber), praguri mai mari la produse/servicii, posibilitatea sistemelor de calificare. Normele: HG 394/2016.
- **Praguri:**
  - Prag lucrări sectoriale 01.01.2026: 5.404.000 EUR = 26.960.556 lei (Reg. delegat (UE) 2025/2150)
  - Prag produse/servicii sectoriale: 432.000 EUR = 2.155.248 lei
  - Art. 12(4)? — achiziție directă sectorială: 135.060 lei produse/servicii și 450.200 lei lucrări în versiunile pre-2022; valoarea actuală NEVERIFICATĂ
- **Articole cheie:**
  - art. 4–5 — entități contractante și activități relevante (gaze, apă)
  - art. 12 — praguri
  - art. 172–173 — clarificări (echivalent L98 art. 160–161)
  - art. 191–192 — capacitate tehnică/experiență similară
  - art. 236 — modificarea contractului sectorial
- **Modificări:**
  - Aceleași pachete ca L98: OUG 107/2017, OUG 45/2018, OUG 114/2020, OUG 26/2022, Legea 208/2022, OUG 52/2024 (presupus — neverificat individual)
- **Ofertare:** Distrigaz/Delgaz, Distrigaz Sud Rețele, companiile de apă regionale cumpără prin L99 → termenele și regulile diferă ușor (art. 172–173 L99 = art. 160–161 L98; art. 236 L99 = art. 221 L98; ajustare HG 394 art. 158). Verificați întotdeauna în anunț ce lege se aplică.
- **Clarificări:** Corespondențe: clarificări art. 172–173 L99; experiență similară art. 191–192 L99 (Instrucțiunea ANAP 2/2017 se aplică ambelor); ajustare preț HG 394/2016 art. 158(3) (ANAP o invocă în avizele ex-ante).
- **Acces:** public · Sursă: https://anap.gov.ro/ro/notificare-cu-privire-la-modalitatea-de-punere-in-aplicare-a-dispozitiilor-art-160-alin-2-din-legea-nr-98-2016-respectiv-art-172-alin-2-din-legea-nr-99-2016/

#### HG 394/2016 · ⚠️ neverificat integral
- **🟡 modificat** · hg · Guvernul României · ediție: Modificată și prin HG 336/2023 (confirmat din titlul HG 336/2023). Text consolidat neaccesat. · `ofertare_normative.id = 8`
- **Titlu:** Normele metodologice de aplicare a Legii 99/2016 (achiziții sectoriale)
- **Ce cere:** Echivalentul HG 395 pentru sectoriale. ANAP invocă art. 158(3) HG 394 (modul concret de ajustare, indicii și sursa trebuie precizate în DA și contract) și art. 29(2) (corelare termen întrebări/termen răspuns).
- **Articole cheie:**
  - art. 29(2) — corelare termen întrebări/termen răspuns
  - art. 158(3) — ajustarea prețului (indici, sursă)
- **Modificări:**
  - HG 336/2023 — modifică și HG 394/2016
- **Ofertare:** Pentru licitațiile operatorilor de distribuție gaze/apă.
- **Clarificări:** Formula de ajustare incompletă (ex. lipsește coeficientul «av» deși există avans) — ANAP a cerut completarea în avizele ex-ante.
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2023/05/Cele-mai-frecvente-observatii-din-cadrul-avizelor-lucrari.pdf

#### HG 1/2018 
- **🟡 modificat** · hg · Guvernul României · ediție: Text actualizat AFIR cu HG 965/2023 (MO 17.10.2023). Modificatori identificați: HG 297/2022 (03.03.2022), HG 375/2022 (22.03.2022), HG 1347/2022 (04.11.2022), HG 965/2023.
- **Titlu:** HG 1/2018 pentru aprobarea condițiilor generale și specifice pentru anumite categorii de contracte de achiziție aferente obiectivelor de investiții finanțate din fonduri publice
- **Ce cere:** Anexa 1: condiții generale/specifice + acord contractual pentru contracte de EXECUȚIE lucrări; Anexa 2: PROIECTARE + EXECUȚIE. Obligatorii pentru contracte de lucrări finanțate din fonduri publice (inclusiv UE) cu valoare estimată ≥ pragul art. 7(1) lit. a) L98; AC le pot folosi și sub prag (art. 3(4)). Se aplică și contractelor sectoriale. Model inspirat FIDIC, cu «Supervizor» în locul «Inginerului».
- **Praguri:**
  - Cl. 15.1 — GBE implicit 10% din Prețul Contractului dacă Acordul nu prevede altă valoare; constituire în 5 zile lucrătoare de la semnare; original transmis în 3 zile
  - Cl. 15.1 lit. b) — reținere succesivă doar dacă e prevăzută în DA; cont cu sumă inițială ≥ 0,5%; GBE integral reținută până la Certificatul de Plată la Recepția la Terminare
  - Cl. 15.3 — pretenții asupra GBE doar în cazurile (a)–(d): neprelungire, neplată în 30 zile, neremediere în 30 zile, reziliere
  - Cl. 15.5 — ajustarea GBE la modificarea prețului și reîntregirea în 15 zile
  - Cl. 15.6 — restituire: 70% (implicit) în 14 zile de la aprobarea Recepției la Terminare; restul la Recepția Finală
  - Cl. 36.3 — reținere 10% din certificatele de plată dacă nu se atinge un punct de referință (milestone)
  - Cl. 36.4 — penalități de întârziere implicite: pe zi = Prețul Contractului / Durata de Execuție în zile; plafon 15% din Preț (!! formulă de verificat în Acordul Contractual)
  - Cl. 46.6 — avans implicit: o tranșă de 15% din plățile anuale (cu TVA), justificat 100% prin deducere; cl. 46.7 — variantă: tranșă unică 15% din Preț + TVA, recuperat 25% din fiecare certificat
  - Cl. 47.2 — Sume Reținute: 5% din fiecare certificat până la 5% din Preț; 50% la Recepția la Terminare, restul la Recepția Finală; cl. 47.4 — opresc la 10% cumulat cu GBE
  - Cl. 48.2 — durata ≤ 365 zile: prețuri ferme (cu excepția modificării legii, 48.8); cl. 48.3 — > 365 zile: ajustare cu formula polinomială
  - Cl. 48.4 — An = av + m·Mn/Mo + f·Fn/Fo + e·En/Eo; av+m+f+e=1; indici la 60 de zile înainte de ultima zi a lunii n
  - Cl. 48.5 — dacă tabelul de ajustare nu e completat: An = av + (1−av)·In/Io, In = indice cost în construcții total INS (tabel 15 Buletin Statistic de Prețuri)
  - Cl. 48.7 — după depășirea duratei din culpa antreprenorului se aplică indicii cei mai favorabili beneficiarului
  - Data de Referință = cu 30 de zile înainte de termenul-limită de depunere a ofertelor (def. lit. n)
  - Cl. 50.4 — plata în 30 de zile de la primirea Certificatului de Plată; factura din ziua a 15-a de la emiterea certificatului
  - Cl. 53.1 — dobândă întârziere plată: rata de referință BNR + 8 puncte procentuale; factura de dobânzi în 60 de zile de la încasare
  - Cl. 61.6 — Perioada de Garanție implicită: 5 ani (categoria de importanță A și B), 3 ani (C), 1 an (D), de la Recepția la Terminare
  - Cl. 69a.1 — notificarea revendicării antreprenorului în 30 de zile de la eveniment (altfel pierde drepturile pentru perioada anterioară cu >30 de zile notificării); cl. 69a.2 — detalierea în 30 de zile de la notificare
  - Cl. 38.6 / 66.6 — suspendare > 180 zile / forță majoră > 180 zile → drept de reziliere
- **Documente / atestări:**
  - Garanție de bună execuție (instrument bancar/asigurare, emitent autorizat UE sau rating ≥ BBB-/Baa3) — cl. 15.1
  - Garanție de returnare a avansului = avans + dobânda de referință BNR pe perioada până la justificare — cl. 46.3
  - Garanție pentru Sume Reținute (opțional) — cl. 47.3
  - Program de execuție, grafic de flux de numerar — cl. 17
- **Verificări / probe:**
  - Recepția la Terminare cu notificare cu ≥15 zile înainte (cl. 60.3)
  - Teste și inspecții (cl. 41)
- **Articole cheie:**
  - Art. 1 — Anexa 1 execuție lucrări ≥ prag
  - Art. 2 — Anexa 2 proiectare + execuție ≥ prag
  - Art. 3(4) — utilizare facultativă sub prag
  - Cl. 5 — Supervizorul
  - Cl. 7 — Subcontractanți
  - Cl. 15 — GBE
  - Cl. 20–21 — date despre șantier; condiții fizice neprevăzute (inclusiv utilități subterane)
  - Cl. 35–36 — prelungirea duratei; penalități
  - Cl. 37 — Modificări (37.5 variația cantităților prin măsurare ≠ Modificare)
  - Cl. 46 — Avans
  - Cl. 47 — Sume Reținute
  - Cl. 48 — Ajustarea prețurilor
  - Cl. 49 — Măsurare (cantitățile din Lista de Cantități sunt estimative; prețuri forfetare)
  - Cl. 50–53 — Plăți, plata finală, dobânzi
  - Cl. 60–62 — Recepții, Perioada de Garanție
  - Cl. 64–66 — Reziliere, forță majoră
  - Cl. 69 — Revendicări și Decizii
  - Cl. 70 — Dispute (amiabil, arbitraj sau instanțe)
- **Modificări:**
  - HG 297/2022 — cl. 15 (GBE), cl. 15.3, 15.7
  - HG 375/2022 — cl. 37, cl. 70 (soluționare amiabilă, instanțe de drept comun)
  - HG 1347/2022 — cl. 47 (Sume reținute, garanție pentru sume reținute)
  - HG 965/2023 — cl. 47.1–47.4, abrogă 47.5
- **Ofertare:** Toate licitațiile de lucrări ≥ 26,96 mil. lei pe fonduri publice folosesc obligatoriu acest model → ERP-ul trebuie să citească din Acordul Contractual valorile care înlocuiesc valorile implicite (GBE %, procent restituire, penalități, avans, sume reținute, tabelul de ajustare, perioada de garanție). Ele influențează direct cash-flow-ul și prețul.
- **Clarificări:** Clauzele cu valori implicite sau lăsate goale în Acordul Contractual sunt sursa nr. 1 de întrebări (vezi secțiunea dedicată din .md).
- **Acces:** public · Sursă: https://www.afir.ro/media/nhyjxt1w/hg-nr-1-din-2018-actualizat-cu-prev-hg-965-2023.pdf

#### OUG 47/2022 
- **🟢 în vigoare** · oug · Guvernul României · ediție: MO 377/15.04.2022 (text art. 1–8 reprodus în nota din forma consolidată L98 la 13.06.2024)
- **Titlu:** OUG 47/2022 privind ajustarea prețurilor contractelor de achiziție publică/sectoriale/de concesiune/acordurilor-cadru aferente obiectivelor de investiții finanțate din fonduri publice (proiecte naționale)
- **Ce cere:** Ajustarea, la cerere, a prețului contractelor de lucrări în derulare la 15.04.2022 fără clauză de revizuire (sau cu preț ferm/OG 15/2021), pentru restul rămas de executat, la fiecare solicitare de plată, cu indicele de cost în construcții total (ICC) INS. Cererea în 45 de zile, act adițional în 45 de zile; netransmiterea = decădere. Nu se aplică proiectelor pe fonduri externe nerambursabile (acolo OUG 64/2022).
- **Praguri:**
  - Art. 3(4) — Va = V0 × [(1−p−a) × ICCn/ICC_ref] + (p+a) (forma din textul consolidat; p = profit %, a = avans %, ICC_ref = luna anterioară termenului de depunere a ofertei, minim ian. 2019)
  - Art. 4(1),(3) — 45 de zile cerere / 45 de zile act adițional
  - Art. 7(3) — proceduri în curs: cerere în 15 zile de la semnare, înainte de ordinul de începere; act adițional în 10 zile
- **Articole cheie:**
  - art. 1 — sfera
  - art. 3 — formula ICC
  - art. 4 — termene și decădere
  - art. 7 — procedurile în curs
- **Ofertare:** Relevant doar pentru contracte vechi; pentru contractele noi formula vine din documentație (L98 art. 222^2).
- **Clarificări:** Dacă documentația prevede ajustare «conform OUG 47/2022», cereți confirmarea indicilor, a datei de referință și a tratamentului avansului/profitului.
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2022/10/Legea-nr.-98-din-2016-privind-achizitiile-publice-versiune-actualizata-la-13.06.2024.pdf

#### OUG 64/2022 · ⚠️ neverificat integral
- **🟢 în vigoare** · oug · Guvernul României · ediție: 09.05.2022 (aprobată ulterior prin lege — numărul legii de aprobare NEVERIFICAT); text integral neaccesat
- **Titlu:** OUG 64/2022 privind ajustarea prețurilor și a valorii devizelor generale în cadrul proiectelor finanțate din fonduri externe nerambursabile
- **Ce cere:** Ajustarea prețului contractelor de lucrări/produse în derulare pe proiecte UE (POIM/PDD/POR, inclusiv infrastructura majoră de apă-canal) — art. 17 formule; la apă-canal majoră se folosește indicele de cost în construcții pentru materiale (conform surselor secundare). Modificarea valorii nu poate depăși 50% din prețul inițial la beneficiarii privați.
- **Articole cheie:**
  - art. 17 — formulele de ajustare (NEVERIFICAT din text primar)
- **Ofertare:** Pentru contractele apă-canal POIM/PDD în derulare.
- **Clarificări:** Cereți AC să precizeze dacă proiectul intră sub OUG 64/2022 și ce formulă/indice se aplică.
- **Acces:** partial · Sursă: https://lege5.ro/gratuit/geytcojwge3tc/ordonanta-de-urgenta-nr-64-2022-privind-ajustarea-preturilor-si-a-valorii-devizelor-generale-in-cadrul-proiectelor-finantate-din-fonduri-externe-nerambursabile

#### OG 15/2021 · ⚠️ neverificat integral
- **🟡 modificat** · oug · Guvernul României · ediție: 30.08.2021; Legea 281/2021; formula din contractele OG 15 a fost înlocuită cu formula OUG 47/2022 art. 3(4) prin act adițional (OUG 47/2022 art. 4(4))
- **Titlu:** OG 15/2021 privind reglementarea unor măsuri fiscal-bugetare pentru ajustarea prețurilor contractelor de achiziție publică (aprobată cu modificări prin Legea 281/2021)
- **Ce cere:** A introdus obligația clauzelor de ajustare pentru contractele de lucrări (formula polinomială cl. 48.4 din Anexa 1 HG 1/2018 pentru fonduri UE). Obligația generală de clauze de ajustare la lucrări > 6 luni este acum în L98 art. 222^2(9).
- **Ofertare:** Istoric; în avizele ANAP mai e citat (art. 2(8), art. 6).
- **Clarificări:** —
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2023/05/Cele-mai-frecvente-observatii-din-cadrul-avizelor-lucrari.pdf

#### Reg. delegate (UE) 2025/2152, 2025/2150, 2025/2151, 2025/2487 + Notificare ANAP 10.12.2025 
- **🟢 în vigoare** · instructiune · Comisia Europeană / ANAP · ediție: aplicabile de la 01.01.2026; curs folosit 4,9890 lei/EUR
- **Titlu:** Pragurile valorice aplicabile 01.01.2026–31.12.2027
- **Ce cere:** Pragurile se aplică direct (regulamente UE), fără modificarea textului art. 7 L98 / art. 12 L99. Procedurile lansate înainte de 01.01.2026 rămân la pragurile vechi.
- **Praguri:**
  - Lucrări (clasic + sectorial + concesiuni): 5.404.000 EUR = 26.960.556 lei (anterior 5.538.000 EUR = 27.334.460 lei)
  - Produse/servicii AC centrale: 140.000 EUR = 698.460 lei
  - Produse/servicii AC sub-centrale: 216.000 EUR = 1.077.624 lei
  - Sectorial produse/servicii: 432.000 EUR = 2.155.248 lei
  - Servicii sociale: 750.000 EUR (clasic) / 1.000.000 EUR (sectorial)
  - Achiziție directă L98 nemodificată: 270.120 lei / 900.400 lei
- **Ofertare:** Determină termenul de contestare (10 vs 5 zile), plafonul cauțiunii, obligativitatea HG 1/2018 și a GBE.
- **Clarificări:** —
- **Acces:** public · Sursă: https://anap.gov.ro/ro/notificare-cu-privire-la-modificari-ale-pragurilor-aplicabile-procedurilor-de-achizitie-publica-3/

#### Instrucțiunea ANAP 2/2017 
- **🟢 în vigoare** · instructiune · ANAP · ediție: MO 300/27.04.2017
- **Titlu:** Instrucțiunea nr. 2/2017 emisă în aplicarea art. 178 și art. 179 lit. a) și b) din Legea 98/2016 (și art. 191–192 L99) — experiența similară
- **Ce cere:** Reguli obligatorii pentru AC la formularea cerinței de experiență similară; argumente direct utilizabile în clarificări și contestații.
- **Praguri:**
  - Art. 3(3) — plafonul valoric/cantitativ cerut NU poate depăși valoarea estimată / cantitatea contractului
  - Art. 6 — variante: un contract cu min. X lei; valoare cumulată la max. N contracte; număr de contracte la alegerea ofertantului; cantitativ
  - Art. 11(1)-(2) — restrictiv: «contract semnat/început în ultimii 5 ani» sau «contract finalizat în ultimii 5 ani»; se ia în calcul partea executată și recepționată în perioadă
  - Art. 11(3) — «lucrări duse la bun sfârșit» = recepționate pe obiecte / PV recepție la terminare / PV recepție finală
  - Art. 13(2) — la amânarea termenului de depunere, limita inferioară a perioadei de 5 ani se extinde cu perioada amânării
  - Art. 13(3) — se ia în calcul toată valoarea din documentul de recepție pentru obiectul cu funcționalitate independentă
  - Art. 14(3) — antreprenor general: toată valoarea, chiar cu subcontractori; subcontractant: valoarea proprie, confirmată de antreprenorul general + beneficiar
- **Documente / atestări:**
  - PV de recepție + extrase din contract (nu contractul integral) — art. 10
  - DUAE cu: nr./data contract, beneficiar + contact, nr./data recepție, pondere/activități, valoare fără TVA — art. 12
- **Articole cheie:**
  - art. 3
  - art. 5 — nu se poate cere experiență identică; trebuie acceptate lucrări similare sau superioare
  - art. 6
  - art. 10
  - art. 11
  - art. 13
  - art. 14
- **Ofertare:** Gazpet poate folosi ca experiență similară și lucrările executate ca subcontractant (cu confirmări), părțile recepționate din contracte în curs, și obiectele recepționate separat.
- **Clarificări:** Temei principal pentru întrebări de tip «cerința de experiență similară este restrictivă» (identic vs similar, finalizat vs executat, plafon > valoarea estimată, curs valutar nespecificat).
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2017/05/Instructiunea-nr-2_2017.pdf

#### Instrucțiunea ANAP 1/2017 · ⚠️ neverificat integral
- **🟢 în vigoare** · instructiune · ANAP · ediție: MO 32/2017 (conform legeaz.net); conținut detaliat NEVERIFICAT din text primar
- **Titlu:** Instrucțiunea nr. 1/2017 emisă în aplicarea art. 179 lit. g) și art. 187 alin. (8) lit. a) din Legea 98/2016 (experți cheie, factori de evaluare)
- **Ce cere:** Cerințe privind experții cheie și utilizarea experienței lor ca factor de evaluare; ANAP o invocă în avize când AC formulează cerințe restrictive pentru experți (ex. CV-uri + recomandări la depunere).
- **Ofertare:** Personal cheie (RTE, șef de șantier, sudori, responsabil CQ) — dovezile se cer de regulă doar primului clasat.
- **Clarificări:** Întrebări privind cerințele de experiență specifică a experților și momentul prezentării documentelor.
- **Acces:** public · Sursă: https://anap.gov.ro/ro/wp-content/uploads/2017/01/Instructiunea-nr-1_2017.pdf

#### Instrucțiunea ANAP 1/2021 · ⚠️ neverificat integral
- **🟢 în vigoare** · instructiune · ANAP · ediție: MO 56/19.01.2021; conținut detaliat NEVERIFICAT
- **Titlu:** Instrucțiunea nr. 1/2021 privind modificarea contractului de achiziție publică/contractului de achiziție sectorială/acordului-cadru
- **Ce cere:** Ghid de aplicare a art. 221 L98/art. 236 L99: clauze de revizuire, opțiuni, ajustarea prețului, modificări la acord-cadru/subsecvente.
- **Ofertare:** Util la negocierea actelor adiționale în execuție (lucrări suplimentare, prelungiri).
- **Clarificări:** Cereți AC să precizeze clauzele de revizuire/opțiunile (art. 221(1) lit. a) — altfel modificările ulterioare devin dificile.
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2021/01/Instructiune-MO-final.pdf

#### Instrucțiunea ANAP 2/2018 · ⚠️ neverificat integral
- **⚪ neconfirmat** · instructiune · ANAP · ediție: 21.12.2018; emisă pe baza HG 395 art. 164 (abrogat în 2023) — aplicabilitatea actuală de verificat
- **Titlu:** Instrucțiunea nr. 2/2018 (21.12.2018) — ajustarea prețului contractului
- **Ce cere:** Ghidare privind ajustarea prețului; baza legală s-a mutat în L98 art. 222^2.
- **Ofertare:** Context istoric.
- **Clarificări:** —
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2019/01/Instructiunea-ANAP-nr.-2_2018-ajustarea-pretului.pdf

#### Notificare ANAP 27.07.2018 — art. 160(2) L98 / art. 172(2) L99 
- **🟢 în vigoare** · instructiune · ANAP · ediție: 27.07.2018
- **Titlu:** Notificare cu privire la modalitatea de punere în aplicare a dispozițiilor art. 160 alin. (2) din Legea 98/2016 și art. 172 alin. (2) din Legea 99/2016
- **Ce cere:** AC stabilește 1 sau 2 termene de răspuns în anunț și le corelează (HG 395 art. 27(2)) cu termenul-limită pentru întrebări; răspunsurile se publică consolidat într-o zi (sau în 2 zile dacă sunt 2 termene). La control ex-ante, răspunsurile se transmit ANAP cu ≥4 zile înainte de termenul de răspuns.
- **Ofertare:** Planificarea întrebărilor: trimiteți-le devreme, înainte de primul termen.
- **Clarificări:** Temei pentru a cere publicarea răspunsurilor consolidat și la termenul anunțat.
- **Acces:** public · Sursă: https://anap.gov.ro/ro/notificare-cu-privire-la-modalitatea-de-punere-in-aplicare-a-dispozitiilor-art-160-alin-2-din-legea-nr-98-2016-respectiv-art-172-alin-2-din-legea-nr-99-2016/

#### ANAP — Cele mai frecvente neconformități (lucrări standard și proiectare+execuție), control ex-ante 
- **🟢 în vigoare** · ghid · ANAP · ediție: PDF publicat 05/2023 (95 pagini)
- **Titlu:** Cele mai frecvente neconformități identificate în cadrul documentațiilor de atribuire aferente contractelor de execuție de lucrări standard și de proiectare și execuție lucrări în activitatea de control ex ante
- **Ce cere:** Catalog de abateri ale AC + măsura de remediere dispusă de ANAP: experiență similară restrictivă, cifra de afaceri ~2× valoarea estimată nejustificată (sau pe 5 ani în loc de 3), utilaje nejustificate, efectiv mediu lunar în loc de anual, ISO fără referențial, GP exprimată procentual în loc de valoare, valabilitate GP necorelată cu oferta, original GP la depunere, reținere succesivă GBE la contracte HG 1/2018, lipsa clauzelor de ajustare la lucrări > 6 luni, formula de ajustare cu «av» necompletat, necorelări între FD/caiet de sarcini/contract, termen nedefinit pentru predarea amplasamentului/autorizația de construire, limitarea artificială a cheltuielilor indirecte/profitului/organizării de șantier, cerințe de autorizare fără legătură cu obiectul principal.
- **Ofertare:** Checklist gata făcut pentru analiza documentației la intrarea unei licitații în ERP.
- **Clarificări:** Fiecare abatere listată = o întrebare de clarificare cu temei recunoscut chiar de ANAP (vezi .md).
- **Acces:** public · Sursă: https://anap.gov.ro/web/wp-content/uploads/2023/05/Cele-mai-frecvente-observatii-din-cadrul-avizelor-lucrari.pdf

#### ANAP — Îndrumare privind evaluarea propunerilor financiare (preț aparent neobișnuit de scăzut) · ⚠️ neverificat integral
- **🟢 în vigoare** · ghid · ANAP · ediție: PDF 05/2023 — conținut NEACCESAT (anti-bot ANAP)
- **Titlu:** Îndrumare privind evaluarea propunerilor financiare din perspectiva prețului aparent neobișnuit de scăzut
- **Ce cere:** Recomandări pentru comisia de evaluare la ofertele cu preț aparent neobișnuit de scăzut.
- **Ofertare:** De citit înainte de pregătirea dosarului de justificare.
- **Clarificări:** —
- **Acces:** public · Sursă: https://anap.gov.ro/ro/wp-content/uploads/2023/05/Indrumare-evluarea-propunerilor-financiare._.pdf

#### ANAP — Îndrumare privind detalierea excesivă a listelor de prețuri · ⚠️ neverificat integral
- **🟢 în vigoare** · ghid · ANAP · ediție: PDF 03/2023 — conținut NEACCESAT
- **Titlu:** Îndrumare privind detalierea excesivă a listelor de prețuri (formulare F1–F5)
- **Ce cere:** (Titlu confirmat; conținut neverificat) — limitarea cerințelor excesive de detaliere a devizelor/consumurilor.
- **Ofertare:** Relevant pentru devizele C6/C8/C9 și formularele F3.
- **Clarificări:** Temei pentru întrebări privind formularele de prețuri excesiv de detaliate.
- **Acces:** public · Sursă: https://anap.gov.ro/ro/wp-content/uploads/2023/03/Indrumare-preturi222.pdf

#### FIDIC Red Book / Yellow Book (ed. 1999 și 2017) · ⚠️ neverificat integral
- **🟢 în vigoare** · standard · FIDIC · ediție: ed. 1999 (folosită istoric la POS Mediu/POIM apă-canal) și ed. 2017 (reprint 2022)
- **Titlu:** Conditions of Contract for Construction (Red) / Plant and Design-Build (Yellow)
- **Ce cere:** Din cunoștințe generale (texte plătite, NEVERIFICATE în sesiune): Engineer = administratorul contractului; ed. 1999 — sub-cl. 13.8 Adjustments for Changes in Cost (formula Pn = a + b·Ln/Lo + c·En/Eo + …), sub-cl. 20.1 notificarea revendicării în 28 de zile de la momentul în care contractorul a aflat (time-bar), detalii în 42 de zile; ed. 2017 — sub-cl. 13.7 ajustarea, sub-cl. 20.2.1 notificare 28 de zile, 20.2.4 revendicare detaliată în 84 de zile, DAAB (comisie de adjudecare a disputelor).
- **Ofertare:** Contractele POIM/PDD de apă-canal (beneficiari companii regionale de apă) au folosit FIDIC; după 2018 multe trec pe HG 1/2018.
- **Clarificări:** Întrebați ce ediție și ce Condiții Particulare se aplică; time-bar-ul de 28 zile e mai strict decât cel de 30 zile din HG 1/2018.
- **Acces:** platit · Sursă: https://fidic.org

#### OUG 98/2017 
- **🟢 în vigoare** · oug · Guvernul României · ediție: aprobată prin Legea 186/2018; norme HG 419/2018
- **Titlu:** OUG 98/2017 privind funcția de control ex-ante al procesului de atribuire
- **Ce cere:** ANAP verifică ex-ante documentațiile selectate (prin eșantionare); la proceduri cu aviz conform, răspunsurile la clarificări se transmit ANAP cu ≥4 zile înainte de termenul de răspuns; art. 196(2) L98 leagă termenul de 1 zi lucrătoare de emiterea avizului conform.
- **Ofertare:** Explică întârzieri în răspunsuri/rezultat.
- **Clarificări:** —
- **Acces:** public · Sursă: https://anap.gov.ro/ro/notificare-cu-privire-la-modalitatea-de-punere-in-aplicare-a-dispozitiilor-art-160-alin-2-din-legea-nr-98-2016-respectiv-art-172-alin-2-din-legea-nr-99-2016/

#### OUG 114/2011 
- **🟢 în vigoare** · oug · Guvernul României · ediție: —
- **Titlu:** OUG 114/2011 privind atribuirea contractelor de achiziții publice în domeniile apărării și securității
- **Ce cere:** NU reglementează garanția de bună execuție. Se aplică doar achizițiilor de apărare/securitate (prag lucrări 2026: 5.404.000 EUR). Cadrul GBE pentru achizițiile civile: L98 art. 154–154^2 + HG 395 art. 39–41.
- **Ofertare:** Irelevant pentru Gazpet (în afara unor lucrări la unități militare).
- **Clarificări:** —
- **Acces:** public · Sursă: https://www.licitatie-publica.ro/blog/praguri-valorice-achizitii-publice-romania

#### HG 1336/2022 
- **🟢 în vigoare** · hg · Guvernul României · ediție: MO 1078/08.11.2022
- **Titlu:** HG 1336/2022 pentru aprobarea Regulamentului-cadru privind organizarea și dezvoltarea carierei personalului contractual din sectorul bugetar
- **Ce cere:** NU este metodologia de ajustare a prețurilor (confuzie probabilă cu Ordinul MDLPA 1336/2021 — metodologia de ajustare a prețurilor materialelor de construcții pentru POR 2014-2020, conform surselor secundare). Ajustarea pentru contracte noi: L98 art. 222^2 + clauza din contract (HG 1/2018 cl. 48).
- **Ofertare:** Nu se folosește.
- **Clarificări:** —
- **Acces:** public · Sursă: https://legislatie.just.ro/Public/DetaliiDocumentAfis/261250

## ANRE, gaze, ISCIR, apă-canal

### Sinteză

Surse primare citite integral: NTPEE (MO 462/2018 + forma consolidată după Ordinul ANRE 2/2023), Ordinul ANRE 17/2026 (MO 444/26.05.2026), Ordinul ANRE 85/2024, Norma tehnică pentru conductele din amonte (Ordinul ANRE 8/2025), NP 133-2022 vol. I și II (MO 41 bis și 43 bis/2023), PT CR 6/9-2025 (MO 658 bis/07.08.2026), informarea ANRE privind tipurile de autorizații din Ordinul 132/2021. JSON: `anre_gaze_apa.json` (30 de înregistrări).

### 1. Constatări principale

1. **Ordinul ANRE 132/2021 este ABROGAT.** L-a înlocuit **Ordinul ANRE 17/21.05.2026** (MO 444/26.05.2026). Autorizațiile vechi rămân valabile, dar titularii au avut **3 luni** să dovedească noua structură de personal și dotarea (art. 39). Termenul a expirat în jurul datei de **26.08.2026** (dată dedusă: ordinul nu prevede altă dată de intrare în vigoare, deci se aplică publicarea). **Gazpet trebuie să verifice că a depus dovada.**
2. **Ordinul ANRE 182/2020 (instalatori) este înlocuit** de **Ordinul ANRE 65/2023**, modificat prin Ordinul 85/2024. Tipurile actuale sunt PGIU/PGD/PGT/PGL/PGLT/PH și EGIU/EGD/EGT/EGL/EGLT/EH.
3. **Proba de etanșeitate din NTPEE nu mai durează fix 24 h.** Ordinul ANRE 2/2023 a introdus Tabelul 8^1, cu durata în funcție de volum: de la 1 h (0,1 m³) la 24 h (≥ 4 m³). Proba de rezistență rămâne de 1 h. Mult caiete de sarcini copiază încă „24 ore”.
4. **NP 133-2013 este înlocuit de NP 133-2022** (vol. I: Ordinul MDLPA 15/2023; vol. II: Ordinul 14/2023; vol. III: Ordinul 19/2023). Normativul nou are valori de probă proprii: la rețele, 1,5×PN și maximum 10 bar; la canalizare, apă la 1–5 m col. H2O, 30 min, scădere ≤ 10 cm. Există un regim tranzitoriu larg: proiectele cu achiziție lansată sau finanțare aprobată rămân pe ediția 2013.
5. **Prescripțiile ISCIR PT CR 6/7/9-2013 sunt abrogate.** Le-au înlocuit **PT CR 6/7/9-2025** (Ordinul MEDAT 1172/2026, MO 658/07.08.2026). Autorizația de sudor e valabilă **2 ani** și numai la angajator. Pentru CND se aplică PT CR 6, nu „PT CR 11”.

Alte constatări:
- Noul regulament ANRE **nu cere ISO 9001**. Cere însă la EDSB: 3 instalatori EGD (unul inginer cu min. 3 ani experiență), 1 sudor OL și 2 sudori PE pentru ambele procedee, aparate PE cu verificare tehnică periodică valabilă, laborator CND autorizat și garanție de minimum 2 ani.
- **Art. 34 (antreprenorul general):** poate subcontracta lucrări de gaze numai la operatori autorizați ANRE și numai cu acordul beneficiarului. Coordonează printr-un angajat propriu, instalator autorizat, și răspunde solidar. Asta contează pentru asocieri și subcontractări în SEAP.
- **Art. 31 alin. (4):** RTE nu semnează documentele pentru lucrările la care a lucrat ca instalator sau sudor.
- Racordarea la SD gaze se face după **Ordinul ANRE 7/2022**, care a abrogat Ordinul 18/2021. Numărul din tabelă e corect.
- Norma pentru conductele din amonte din 18.03.2025 este **Ordinul ANRE 8/2025** (MO 378/29.04.2025).
- O neconcordanță internă în Ordinul 17/2026: Anexa 3, pct. 2 permite încă un contract cu terț pentru îmbinări nedemontabile, în timp ce art. 14–15 și comunicatul ANRE cer sudori proprii.

### 2. Tabel: autorizare ANRE pentru operatori economici (Ordinul ANRE 17/2026)

| Tip | Ce permite | Cerințe esențiale (execuție: art. 12–18) |
|---|---|---|
| PPI | Proiectare: conducte din amonte, instalații de suprafață pentru înmagazinare, GNL | Instalatori PGT, coordonator inginer (în regimul 132/2021: 7 ani experiență; în textul nou neverificat pe articol) |
| PT | Proiectare: transport, SD/SDI/biogaz și IU de **înaltă presiune** | Instalatori PGT, coordonator inginer; inginer automatist (declarație) |
| PDSB | Proiectare: SD/SDI/biogaz **PM/PR/PJ** | Instalatori PGD, coordonator inginer (5 ani în regimul vechi) |
| PDIB | Proiectare: IU **PM/PR/PJ** | Instalatori PGIU, coordonator inginer (5 ani în regimul vechi) |
| PGNL / PGNLT (nou) / PH | Proiectare: stocare și regazeificare GNL / terminale GNL / hidrogen | Se aplică de la intrarea în vigoare a normelor tehnice specifice (art. 40) |
| EPI | Execuție: conducte din amonte, înmagazinare, GNL | Min. **3** instalatori EGT; min. **2 sudori OL**; RTS; garanție 2 ani |
| ET | Execuție: transport, SD și IU de **înaltă presiune**; verificări și revizii IU PI | Min. 3 EGT (coordonator inginer, 5 ani); min. 2 sudori OL; RTS; garanție 2 ani |
| **EDSB** | Execuție: SD/SDI/biogaz **PM/PR/PJ** (rețele, branșamente). Varianta la care se califică Gazpet | Min. **3 EGD** (coordonator inginer, 3 ani); **1 sudor OL + 2 sudori PE** (cap-cap și electrofuziune); aparate PE cu verificare tehnică periodică; RTS; laborator CND autorizat; garanție min. 2 ani |
| **EDIB** | Execuție: IU **PM/PR/PJ**; verificări și revizii IU; exploatarea IU industriale | Min. **3 EGIU** (coordonator inginer, 3 ani); 1 sudor OL + 1 sudor PE (ambele procedee); aparate PE; RTS; garanție 2 ani |
| RPFA | PFA: numai înlocuirea racordurilor flexibile la aparate ≤ 3 m³/h | Declarație; fără PIF de aparate |
| EGNL / EGNLT (nou) / EIH | Execuție GNL / terminale GNL / hidrogen | EGNLT: 1 sudor OL + 2 PE; EGNL: 1 + 1; EIH: 2 OL. Se aplică după normele tehnice specifice |

**Reguli comune:**
- Valabilitatea autorizației este **nelimitată**, cu **vizare la 5 ani** (art. 25). Cererea de vizare se depune cu 60–90 de zile înainte (art. 22 alin. 2); după termen se tratează ca cerere nouă.
- Personalul se dovedește la depunere prin **raport REGES pentru fiecare salariat**. Tarif 2026: 2.000 lei pentru proiectare, 3.000 lei pentru execuție (Ordinul ANRE 82/2025).
- **Ordinul 132/2021: înlocuit din 2026.** Diferențe față de regimul vechi: 2 instalatori în loc de 3, sudori proprii sau contract cu terț, personal declarativ (Ordinul 7/2023).

**Instalatori, persoane fizice (Ordinul ANRE 65/2023, modificat prin 85/2024):**
- **PGIU / EGIU:** instalații de utilizare PM/PR/PJ.
- **PGD / EGD:** SD/SDI/magistrale directe PM/PR/PJ și biogaz.
- **PGT / EGT:** transport, SD PI, amonte, înmagazinare, IU PI.
- **PGL/PGLT/PH, EGL/EGLT/EH:** GNL, terminale GNL, hidrogen.
- **Verificatori de proiecte:** VGd, VGt, VGp, VGs, VGb, VGg/VGl, VGh.
- Vizarea se face la 5 ani (sursă secundară).
- Gradele vechi din regimul anterior nu mai există. Legitimațiile emise pe Ordinul 182/2020 rămân valabile până la expirare.

### 3. Tabel: probe de presiune (domeniu → normă → presiune → durată → criteriu)

| Domeniu | Normă / articol | Presiune de încercare | Durată | Criteriu de acceptare |
|---|---|---|---|---|
| Gaze, conductă subterană **PM** (2–6 bar), PE 100 / OL | NTPEE art. 269, Tab. 8; art. 273 | Rezistență **9 bar**; etanșeitate **6 bar** (aer) | Rezistență **1 h**; etanșeitate după **Tab. 8^1** (0,1 m³: 1 h; 0,5: 3 h; 1: 6 h; 2: 12 h; 3: 18 h; ≥ 4: 24 h) | Fără pierderi de presiune (art. 278), cu înregistrare continuă, clasa 1,5 (art. 274); fără remedieri în timpul probei (art. 280) |
| Gaze, **PE 80** (max. 4 bar) | NTPEE Tab. 8, nota *) | Rezistență **6 bar**; etanșeitate **4 bar** | Idem | Idem |
| Gaze, subteran **PR** (0,05–2 bar) | NTPEE Tab. 8 | **4 bar** / **2 bar** | Idem | Idem |
| Gaze, subteran **PJ** | NTPEE Tab. 8 | **2 bar** / **1 bar** | Idem | Idem |
| Gaze, subteran **PI** (6–10 bar) | NTPEE Tab. 8 | **15 bar** / **10 bar** | Idem | Idem |
| Gaze, IU supraterană PJ | NTPEE Tab. 8, poz. 3.4 | **1 bar** / **0,2 bar**, cu manevrarea armăturilor | Idem | Idem |
| Gaze, verificare pe tronsoane în execuție | NTPEE art. 272 lit. a) | Valorile din Tab. 8 | Min. **4 h**, tronsoane ≤ 500 m | Presiune constantă |
| Gaze, egalizare temperatură înainte de probă | NTPEE art. 275–276, Tab. 9 | — | ex. 1 m³: OL 2 h / PE 3 h; ≥ 10 m³: 8 h / 12 h | — |
| Gaze, racord cuplat la conductă în funcțiune (circulație perturbată) | NTPEE art. 271 alin. (3) | Numai proba de rezistență | 1 h | — |
| Gaze, conducte din amonte, clasele de locație 1–2 | NT amonte, art. 305 lit. a), art. 311 | **1,2×P_MAOP**, apă sau aer | Min. **6 h** | Presiune constantă în limitele variației barometrice (art. 316) |
| Gaze, conducte din amonte, clasele 3–4 | NT amonte, art. 305 lit. b), art. 308 | **1,4×P_MAOP**, apă; max. 1,8×P_MAOP în punctul de cotă minimă și ≤ 95% din proba de uzină | Min. 6 h | Idem |
| Gaze, conducte din amonte, etanșeitate | NT amonte, art. 313–314 | **P_MAOP** (aer, gaz natural sau inert) | Min. **24 h** | Idem |
| Gaze, transport > 10 bar | Ordinul ANRE 118/2013 | **Neverificat** (anexa nu a fost accesibilă) | — | — |
| Apă, **rețea de distribuție** ≤ 6 bar | NP 133-2022 vol. I, cap. 9, alin. (9) lit. f) + SR 4163-3, SR EN 805, STAS 6819 | **1,5×PN**, max. **10 bar** în orice punct; nu se montează conducte cu presiune de probă de produs < 10 bar | Din proiect / SR EN 805 | Fără scurgeri sau pete de umezeală; pierderea de presiune ≤ valoarea din proiect (alin. 13) |
| Apă, rețea > 6 bar | NP 133-2022 vol. I, cap. 9, alin. (10) | min(1,5×clasa conductei; 1,25×clasa armăturilor) | Din proiect | Idem |
| Apă, **aducțiune** | NP 133-2022 vol. I, 7.3.6 + SR EN 805, STAS 6819 | Din proiect, pe tronson (alin. 2); tronsoane de 500–2000 m; Δcotă ≤ 10 m; creștere în trepte de 0,5 bar | Din proiect | Idem (alin. 5) |
| Apă, condiții generale | NP 133-2022, 7.3.6 alin. (3)–(4) | Numai apă potabilă, în tranșee; masive de ancoraj de min. 28 de zile | Probă doar la ≥ 5 °C prognozat 3 zile (altfel umplutură 0,8 m și capete izolate) | — |
| Apă, SR EN 805 (orientativ) | SR EN 805 | STP = min(1,5×MDP; MDP + 5 bar) sau MDPc + 1 bar (**neverificat**, standard plătit) | Faze: preliminară, cădere de presiune, principală | Din standard (neverificat) |
| Apă, dezinfectare | NP 133-2022, 7.3.7 | 25–30 mg/l clor activ | Min. 24 h | Clor rezidual ≥ 10 mg/l la capătul îndepărtat |
| **Canalizare gravitațională** | NP 133-2022 vol. II, 3.6.1 alin. (10)–(11) + SR EN 1610 | Apă: max. **5 m** col. H2O la aval, min. **1 m** la amonte; Δcotă radier ≤ 4 m | Saturare ~**1 h**, verificare **30 min** | Fără scurgeri; scădere de nivel ≤ **10 cm**; apa adăugată ≤ valoarea din proiect |
| Canalizare, SR EN 1610 (orientativ) | SR EN 1610:2015 | Aer (LA–LD) sau apă (W) | 30 min (W) | Apă adăugată ≈ 0,15 / 0,20 / 0,40 l/m² (**neverificat**) |

### 4. Alte cerințe de execuție gaze (NTPEE, pentru verificarea caietelor de sarcini și a devizelor)

**Adâncimi și traseu:**
- Adâncimea minimă este **0,9 m** de la generatoarea superioară și **0,5 m** la capătul branșamentului. Se poate reduce numai cu acordul OSD și cu protecții suplimentare (art. 75).
- Zona de protecție PM/PR/PJ este de **0,5 m** (art. 25).
- Distanțele din Tabelul 1 se pot reduce cu 20% (poz. 1–6) folosind tub de protecție și răsuflători (art. 35). Altfel e nevoie de **evaluare de risc** cu acordul OSD (art. 35^1, anexa 23).

**Materiale:** oțel și PE 100 la orice presiune; **PE 80 numai până la 4 bar** (art. 20).

**Șanț și pozare:**
- Lățimea șanțului: 0,4 m, sau 0,4 m + Dn pentru Dn ≥ 100 (art. 194).
- Pat de nisip de 10–15 cm (art. 196). Conducta PE se acoperă cu min. 10 cm de nisip și se pozează șerpuit (art. 197).
- **Bandă galbenă** de min. 15 cm la 35 cm deasupra conductei (art. 216).
- **Fir trasor** Cu de 1,5 mm², fixat la max. 4 m, cu cutii de acces la 300 m (art. 203).

**Îmbinări și CND:**
- Sudarea cap la cap se folosește doar de la Ø 75 mm în sus (art. 240).
- Sudurile OL sunt de clasa de calitate II, cu **CND obligatoriu** la conductele subterane OL și la toate sudurile de poziție (art. 238).
- Nu se admit corecturi la îmbinări (art. 246).

**Recepție:**
- Probele finale le face executantul, în prezența delegatului OSD (art. 268, 288).
- Dosarul de recepție (art. 286) cuprinde: fișa tehnică, planul cotat, certificatele țevilor, buletinele CND, buletinul de protecție anticorozivă, PV pentru lucrări ascunse, valoarea investiției, AC sau acordul administratorului drumului, PV de refacere a drumului și referatul proiectantului.
- **Cartea tehnică** se predă OSD înainte de PIF (art. 296). Cuplarea la rețea se face de executant, în prezența OSD (art. 289 alin. 3).
- Verificarea cu flacără este interzisă (art. 283^1).

### 5. ISCIR față de ANRE: ce se aplică pe șantierul de gaze

- **ANRE** reglementează conductele de distribuție, racordurile, IU, SRM/PRM și autorizarea firmelor și a instalatorilor.
- **ISCIR** se aplică în trei situații:
  - **Autorizarea sudorilor** OL și a operatorilor de sudare PEHD (PT CR 9-2025, valabilitate 2 ani, numai la angajator).
  - **Procedurile de sudare** WPS/WPQR (PT CR 7-2025).
  - **Operatorii și laboratoarele CND** (PT CR 6-2025, nivelurile 1–3).
- **RSVTI** (PT CR 3-2025) trebuie doar pentru echipamentele de pe șantier aflate sub ISCIR: macarale, recipiente sub presiune, compresoare cu recipient. Nu trebuie pentru conducta de gaze.
- La SRM, probele se fac la producător (NTPEE art. 281). Partea de recipient sub presiune a unei stații poate intra sub ISCIR; nu am verificat articolul.
- Autorizațiile ISCIR emise pe PT CR 2013 rămân valabile până la expirare (PT CR 9-2025, art. 63).

### 6. Apă-canal: autorizări cerute de autoritățile contractante

- **Licența ANRSC** (Legea 241/2006 și Legea 51/2006) e obligatorie doar pentru **operatorii serviciului** (exploatare sau delegare). **Executantul de lucrări nu are nevoie de ea.** Dacă o licitație de execuție o cere, cerința e restrictivă și se poate clarifica sau contesta. ANRSC funcționează în 2026 (evidența licențelor la 25.05.2026).
- La apă-canal nu există o autorizare tehnică de tip ANRE pentru constructor. În practică se cer:
  - personal **RTE atestat MDLPA**, în domeniul hidroedilitar (Legea 10/1995);
  - ISO 9001/14001/45001, ca factor sau cerință voluntară a autorității contractante;
  - **sudori PE ISCIR**, la conducte PE pentru apă (PT CR 9 acoperă „sisteme de conducte pentru transportul fluidelor”);
  - laborator autorizat ISC/MDLPA pentru compactări și betoane.

### Fișe

#### Ordin ANRE 89/2018 (NTPEE-2018) 
- **🟡 modificat** · ordin_anre · ANRE · ediție: MO 462/05.06.2018; forma consolidată verificată la 26.01.2023 (după Ordin ANRE 2/2023). Nu am găsit modificări ulterioare 2024–2026 (neconfirmat complet: lege5/legislatie.just.ro inaccesibile). · `ofertare_normative.id = 1`
- **Titlu:** Normele tehnice pentru proiectarea, executarea și exploatarea sistemelor de alimentare cu gaze naturale
- **Ce cere:** Cerințe tehnice obligatorii pentru proiectarea, execuția, probele, recepția și exploatarea SD/racordurilor/IU ≤ 10 bar. Execuție doar de operatori economici autorizați ANRE pe tipul de autorizație corespunzător treptei de presiune (art. 7 alin. 1). Peste 10 bar se aplică NT transport (Ordin 118/2013).
- **Praguri:**
  - art. 19: PJ ≤ 0,05 bar; PR 0,05–2 bar; PM 2–6 bar; PI > 6 bar
  - art. 20 alin. (2): oțel și PE 100 la orice treaptă; PE 80 max. 4 bar
  - art. 25: zona de protecție PM/PR/PJ = 0,5 m de o parte și de alta
  - Tabelul 1 (art. 30, forma 2023) — distanțe minime PE (PJ/PR/PM): clădiri cu subsol 1/1/2 m; fără subsol 0,5/0,5/1 m; canalizare 1/1/1,5 m; apă/cabluri 0,5 m; cămine 0,5/0,5/1 m; copaci 0,5 m; stâlpi 0,5 m. OL (PJ/PR/PM): clădiri cu subsol 2/2/3; fără subsol 1,5/1,5/2; canalizare 1/1/1,5; apă/cabluri 0,6; copaci 1,5
  - art. 35: distanțele poz. 1–6 se pot reduce cu 20% cu tub de protecție + răsuflători
  - art. 36: două conducte paralele min. 0,5 m (recomandat 1,5×(D1+D2))
  - art. 75: adâncime minimă 0,9 m de la generatoarea superioară; 0,5 m la capătul branșamentului; reducere doar cu acordul OSD + protecții
  - art. 194: lățime șanț 0,4 m (Dn<100) / 0,4 m + Dn (Dn≥100); gropi sudură: lățime șanț+0,6 m, L 1,2 m, adâncime 0,6 m sub conductă
  - art. 196: pat nisip 10–15 cm, granulație 0,3–0,8 mm; art. 197: PE pozat șerpuit, acoperit cu min. 10 cm nisip; art. 198: umplutură în straturi max. 20 cm
  - art. 203: fir trasor Cu min. 1,5 mm², izolație 5 kV, fixat la max. 4 m; cutii acces la 300 m în zone fără construcții
  - art. 216: bandă avertizare galbenă min. 15 cm lățime, la 35 cm deasupra generatoarei
  - art. 240: sudare cap la cap doar pentru diametre ≥ 75 mm; electrofuziune orice diametru
  - art. 238: sudurile OL clasa de calitate II; CND obligatoriu la conducte subterane OL; toate sudurile de poziție la CND
  - Tabelul 8 (art. 269) — vezi verificari
  - art. 273 + Tabelul 8^1 — durata etanșeitate: 0,1 m³→1 h; 0,2→2 h; 0,3→2 h; 0,5→3 h; 1,0→6 h; 2,0→12 h; 3,0→18 h; ≥4,0→24 h
  - art. 274: aparate cu înregistrare continuă, clasă exactitate min. 1,5, verificate metrologic
- **Documente / atestări:**
  - Autorizație ANRE operator economic (EDSB pentru SD/racorduri PM/PR/PJ; ET pentru PI)
  - Instalatori autorizați ANRE (EGD/EGIU)
  - Sudori autorizați de organisme abilitate (art. 236, 239 alin. 5) — PT CR 9 ISCIR
  - Buletine CND de la laborator autorizat (art. 238 alin. 4, art. 286 lit. d)
  - Buletin verificare protecție anticorozivă — laborator autorizat (art. 286 lit. e)
  - PV lucrări ascunse (anexa 7), PV recepție tehnică (anexa 8), PV punere în funcțiune (anexa 10)
  - Fișa tehnică conductă/racord (anexele 12/13)
  - Carte tehnică predată OSD înainte de PIF (art. 296)
- **Verificări / probe:**
  - Proba de rezistență (aer) — 1 h (art. 273 alin. 1): subteran PI 15 bar, PM 9 bar (PE 80: 6 bar), PR 4 bar, PJ 2 bar
  - Proba de etanșeitate (aer) — durata din Tabelul 8^1 după volum: subteran PI 10 bar, PM 6 bar (PE 80: 4 bar), PR 2 bar, PJ 1 bar; IU supraterane PJ: rezistență 1 bar, etanșeitate 0,2 bar cu manevrarea armăturilor
  - Verificare pe tronsoane ≤ 500 m în timpul execuției: presiune constantă min. 4 h (art. 272 lit. a)
  - Criteriu: nu se admit pierderi de presiune (art. 278); interzisă remedierea în timpul probei (art. 280)
  - Egalizare temperatură înainte de probă — Tabelul 9 (ex. 1 m³: OL 2 h / PE 3 h subteran; ≥10 m³: 8 h / 12 h)
  - PE: proba după răcirea ultimei suduri (art. 271 alin. 1); racord recepționat separat: probe înainte de perforare (art. 271 alin. 2)
  - Probele finale de executant în prezența delegatului OSD (art. 268); diagrama semnată de metrologul OSD, instalatorul executantului și beneficiar (art. 274 alin. 5)
  - SRM: probe la producător; post reglare: etanșeitate la presiunea de regim la PIF (art. 281)
  - Determinări potențial conductă/sol pentru OL (art. 264)
- **Articole cheie:**
  - art. 7 — numai operatori autorizați ANRE pe tipul specific
  - art. 19–20 — trepte de presiune, materiale
  - art. 25, 30, 35, 35^1, 36 — zone de protecție/distanțe
  - art. 75 — adâncimi
  - art. 194–203, 216 — șanț, pozare, fir trasor, bandă
  - art. 236–246 — îmbinări, sudori, CND
  - art. 267–283^1 — probe
  - art. 284–299 — recepție, PIF, carte tehnică
- **Modificări:**
  - Ordin ANRE 2/2023 (18.01.2023, MO 67/26.01.2023) — ~100 puncte: Tabelul 1 (distanțe) fără coloane PI; art. 30^1 și 35^1 (evaluare de risc când nu se pot respecta distanțele); art. 272 lit. b) și art. 273 — proba de etanșeitate nu mai are 24 h fix, ci durată pe volum (Tabelul 8^1); art. 271 alin. (3) — racord cuplat la conductă în funcțiune: doar proba de rezistență dacă se perturbă circulația; art. 283^1 — interzisă verificarea cu flacără; art. 268/284 trimit la Procedura IU aprobată prin Ordin ANRE 156/2020; art. 286 lit. h) — autorizație de construire SAU acord/autorizație administrator drum.
- **Ofertare:** Baza pentru verificarea caietelor de sarcini și a devizelor la rețele/branșamente gaze: adâncimi, pat de nisip, bandă, fir trasor, CND, probe, documente de recepție. Orice valoare din caietul de sarcini care contrazice NTPEE (ex. «etanșeitate 24 h» pentru tronsoane mici, sau PE 80 la PM) e sursă de clarificare.
- **Clarificări:** Clarificări tipice: durata probei de etanșeitate (Tabel 8^1 vs. 24 h scris în CS), treaptă de presiune/material (PE 80 interzis > 4 bar), cine suportă CND/laborator, adâncime < 0,9 m fără acord OSD, distanțe nerespectate fără evaluare de risc (art. 35^1).
- **Acces:** public · Sursă: https://migs.ro/wp-content/uploads/2023/02/NTPEE-2018-actualizat-cu-OANRE-89-modificat-cu-OANRE-2-din-2023.pdf ; original MO 462/2018: https://amstal.ro/wp-content/uploads/2018/12/NTPEE-2018-Ordin-ANRE-89-2018.pdf

#### Ordin ANRE 2/2023 
- **🟢 în vigoare** · ordin_anre · ANRE · ediție: 18.01.2023, MO 67/26.01.2023, în vigoare 26.01.2023 · `ofertare_normative.id = 1`
- **Titlu:** Ordin pentru modificarea și completarea Ordinului ANRE nr. 89/2018 (NTPEE)
- **Ce cere:** Vezi ntpee-2018: durata probei de etanșeitate pe volum (Tabel 8^1), art. 271 alin. (3), art. 283^1, art. 30^1/35^1, Tabelul 1 fără PI, trimitere la Procedura IU 156/2020 și la Regulamentul de racordare 7/2022.
- **Praguri:**
  - Tabel 8^1: 0,1 m³→1 h … ≥4 m³→24 h
- **Verificări / probe:**
  - Proba de etanșeitate pe durată funcție de volum
- **Articole cheie:**
  - Art. I pct. 64–67 — art. 272–274 NTPEE
  - Art. I pct. 18 — Tabelul 1
- **Ofertare:** Multe caiete de sarcini copiate din șabloane vechi cer încă «24 ore» pentru orice probă — diferență de cost/timp la tronsoane mici.
- **Clarificări:** Temei pentru clarificare când CS cere durate/presiuni din versiunea 2018 inițială.
- **Acces:** public · Sursă: https://arhiva.anre.ro/ro/gaze-naturale/legislatie/reglementari-tehnice/norme-tehnice1387184362

#### Ordin ANRE 156/2020 · ⚠️ neverificat integral
- **🟢 în vigoare** · ordin_anre · ANRE · ediție: 27.08.2020, MO 799/01.09.2020 (modificări ulterioare neverificate)
- **Titlu:** Procedura privind proiectarea, verificarea proiectului tehnic, execuția, recepția tehnică și punerea în funcțiune a instalației de utilizare a gazelor naturale
- **Ce cere:** Fluxul pentru instalații de utilizare (IU): proiect verificat, execuție, probe (art. 20 alin. 1 lit. c, conform trimiterii din NTPEE art. 268), recepție și PIF. Înlocuiește Procedura aprobată prin Ordin ANRE 32/2012 (trimiterile din NTPEE au fost actualizate prin Ordin 2/2023).
- **Ofertare:** Relevant la lucrări care includ instalații de utilizare (clădiri publice, centrale termice).
- **Clarificări:** Trimitere corectă pentru probe/recepție la IU (nu Ordin 32/2012).
- **Acces:** public · Sursă: https://portal.anre.ro/PublicLists/Ordin/GetOrdinFisier?IdOrdin=5375

#### Ordin ANRE 118/2013 · ⚠️ neverificat integral
- **🟡 modificat** · ordin_anre · ANRE · ediție: MO 171/10.03.2014; modificări cunoscute: Ordin ANRE 75/2014 (MO 601/12.08.2014), Ordin ANRE 41/2018 (MO 291/30.03.2018) · `ofertare_normative.id = 2`
- **Titlu:** Normele tehnice pentru proiectarea și execuția conductelor de transport gaze naturale
- **Ce cere:** Se aplică SNT și, prin trimiterea din NTPEE art. 20, obiectivelor/SD/magistralelor directe cu presiune > 10 bar; zona de siguranță PI din NTPEE art. 30^1 trimite la art. 32–33 din aceste norme.
- **Praguri:**
  - Valorile de probă (multiplicatori MOP pe clase de locație, durate) NU au fost verificate din textul primar — textul anexei nu a fost accesibil
- **Verificări / probe:**
  - Probe de rezistență și etanșeitate pe clase de locație — neverificat
- **Modificări:**
  - Ordin ANRE 75/2014 — modificare NT transport
  - Ordin ANRE 41/2018 — modificare și completare NT transport
- **Ofertare:** Relevant doar la lucrări PI > 10 bar / Transgaz; Gazpet de regulă sub 6 bar.
- **Clarificări:** Pentru zone de siguranță PI (art. 32–33).
- **Acces:** public · Sursă: https://legeaz.net/monitorul-oficial-171-2014/ordinul-anre-118-2013

#### Ordin ANRE 8/2025 — Normă tehnică 18.03.2025 conducte de alimentare din amonte 
- **🟢 în vigoare** · ordin_anre · ANRE · ediție: Ordin ANRE 8/18.03.2025, MO 378/29.04.2025, în vigoare 29.04.2025 · `ofertare_normative.id = 27`
- **Titlu:** Normă tehnică pentru proiectarea și executarea conductelor de alimentare din amonte a gazelor naturale
- **Ce cere:** Proiectare, execuție, recepție, PIF pentru conducte din amonte, instalații tehnologice de suprafață la producție/înmagazinare, instalații GNL de stocare. Clase de locație 1–4 cu coeficienți de siguranță (clasa 1 S=1,39; clasa 3 S=2). Execuție numai de operatori autorizați (art. 321).
- **Praguri:**
  - art. 305: proba de rezistență — clasele 1–2: apă sau aer la 1,2×P_MAOP; clasele 3–4: apă la 1,4×P_MAOP (aer doar justificat prin PAC/PT)
  - art. 308: presiunea maximă în punctul de cotă minimă ≤ 1,8×P_MAOP și ≤ 95% din proba hidraulică de uzină
  - art. 311: durata probei de rezistență min. 6 h de la stabilizare
  - art. 313–314: etanșeitate la P_MAOP, cu aer/gaze naturale/gaz inert, min. 24 h de la egalizarea temperaturii
  - art. 315: aparate cu înregistrare electronică, clasă ±1,5% sau mai bună
  - art. 318 alin. (3): zonă de lucru 50 m la test pneumatic, 30 m la hidraulic
- **Verificări / probe:**
  - Curățare/verificare interioară înainte de probe (art. 302–303)
  - Rezistență + etanșeitate; criteriu: presiune constantă în limitele variației presiunii barometrice (art. 316)
  - După probe: CND integral la sudurile de întregire (art. 317)
- **Articole cheie:**
  - art. 304–318 — probe
  - art. 321 — execuție de operatori autorizați
- **Ofertare:** Pentru lucrări Romgaz/Depogaz/OMV (colectoare, racorduri sonde). Probele hidraulice și pistonarea sunt costuri mari — trebuie prevăzute în deviz.
- **Clarificări:** Fluid de probă (apă/aer) se stabilește prin PAC/PT (art. 306) — dacă lipsește din documentație, se cere clarificare; evacuarea apei de probă (art. 318 alin. 7).
- **Acces:** public · Sursă: https://www.romgaz.ro/sites/default/files/2025-05/NORM%C4%82%20TEHNIC%C4%82%20din%2018%20martie%202025%20pentru%20proiectarea%20si%20executarea%20conductelor%20de%20alimentare%20din%20amonte%20a%20gazelor%20naturale.pdf

#### Ordin ANRE 17/2026 
- **🟢 în vigoare** · ordin_anre · ANRE · ediție: 21.05.2026, MO 444/26.05.2026 (ordinul nu stabilește altă dată → în vigoare la publicare, 26.05.2026 — dedus, nu scris explicit) · `ofertare_normative.id = 22`
- **Titlu:** Regulamentul pentru autorizarea operatorilor economici care desfășoară activități în domeniul gazelor naturale
- **Ce cere:** Abrogă integral Ordin ANRE 132/2021. Tipuri: proiectare PPI, PT, PDSB, PDIB, PGNL, PGNLT (nou), PH; execuție EPI, ET, EDSB, EDIB, RPFA, EGNL, EGNLT (nou), EIH. Personal dovedit la depunere prin raport REGES per salariat (renunță la mecanismul declarativ din Ordin 7/2023). Execuție: min. 3 instalatori autorizați (față de 2). Sudori proprii obligatorii. Valabilitate nelimitată, vizare la 5 ani. Regim nou antreprenor general (art. 34). Nu există cerință ISO 9001 în regulament.
- **Praguri:**
  - art. 25: valabilitate nelimitată; vizare la 5 ani de la emitere/ultima vizare
  - art. 22 alin. (2): cerere de vizare cu min. 60 și max. 90 zile calendaristice înainte de împlinirea a 5 ani; după termen = cerere nouă
  - art. 39 alin. (2): titularii autorizațiilor 132/2021 au 3 luni de la intrarea în vigoare să dovedească noua structură de personal și dotarea (≈ până la 26.08.2026, dedus)
  - art. 22 alin. (6): refuz dacă i s-a retras o autorizație similară în ultimii 5 ani
  - Tarife 2026 (Ordin ANRE 82/2025, conform paginii ANRE): proiectare 2.000 lei, execuție 3.000 lei per acordare/vizare
- **Documente / atestări:**
  - EDSB (art. 14): min. 3 instalatori EGD (unul inginer, min. 3 ani experiență, coordonator); RTS atestat; laborator CND autorizat; min. 1 sudor OL + 2 sudori PE (cap-cap și electrofuziune) cu rapoarte REGES și autorizații; aparate sudură PE (cap-cap + electrofuziune) cu verificare tehnică periodică; garanție lucrări min. 2 ani
  - EDIB (art. 15): min. 3 instalatori EGIU (unul inginer, min. 3 ani); RTS; min. 1 sudor OL + 1 sudor PE ambele procedee; aparate sudură PE; garanție min. 2 ani
  - EPI/ET/EIH: min. 3 instalatori EGT/EH; min. 2 sudori autorizați în oțel
  - Documente generale noi (conform comunicatului ANRE): CV echipă managerială/coordonare, declarații instalatori de acord privind folosirea autorizației, declarație Legea 319/2006
- **Verificări / probe:**
  - Verificare în listele publice ANRE a autorizației și a vizei (art. 36)
- **Articole cheie:**
  - art. 1 alin. (4) — tabel tipuri
  - art. 14 — EDSB
  - art. 15 — EDIB
  - art. 22, 25 — vizare 5 ani
  - art. 31 alin. (4) — incompatibilitate RTE
  - art. 34 — antreprenor general
  - art. 35 — verificări/revizii IU doar ET/EDIB; subcontractare
  - art. 39 — tranzitoriu 3 luni
  - art. 40 — GNL/hidrogen intră în vigoare odată cu normele tehnice
- **Ofertare:** Cerința de calificare «autorizație ANRE EDSB/EDIB» trebuie dovedită cu autorizație vizată și (după 3 luni) cu structura nouă de personal. Pentru Gazpet: verificare internă că are 3 instalatori EGD/EGIU, sudori OL+PE proprii și aparate PE cu VTP valabilă.
- **Clarificări:** art. 34: antreprenorul general poate subcontracta lucrările de gaze numai la operatori autorizați ANRE, cu acordul beneficiarului, și trebuie să coordoneze printr-un angajat propriu instalator autorizat; răspunde solidar. art. 31 alin. (4): RTE nu poate semna documentele pentru lucrările la care a lucrat ca instalator/sudor. Anexa 3 pct. 2 încă menționează alternativa contractului de sudură cu terț — neconcordanță cu art. 14–15 (sudori proprii obligatorii) și cu comunicatul ANRE.
- **Acces:** public · Sursă: https://anre.ro/wp-content/uploads/2026/05/Ord-17-2026.pdf

#### Ordin ANRE 132/2021 
- **🔴 abrogat** · ordin_anre · ANRE · ediție: MO 1209/21.12.2021; modificat inclusiv prin Ordin ANRE 7/2023 (mecanism declarativ de personal); abrogat prin Ordin ANRE 17/2026 · înlocuit de: Ordin ANRE 17/2026 (înlocuit din 2026) · `ofertare_normative.id = 22`
- **Titlu:** Regulamentul pentru autorizarea operatorilor economici care desfășoară activități în domeniul gazelor naturale (vechi)
- **Ce cere:** Aceleași tipuri (fără PGNLT/EGNLT), min. 2 instalatori autorizați la execuție, sudori proprii SAU contract cu operator autorizat pentru îmbinări nedemontabile, garanție min. 2 ani.
- **Modificări:**
  - Ordin ANRE 7/2023 — personal minim putea fi dovedit cel mai târziu la începerea lucrărilor (informare ANRE cu 10 zile înainte)
- **Ofertare:** Autorizațiile emise pe 132/2021 rămân valabile (art. 39 Ordin 17/2026), dar cu obligația de conformare în 3 luni.
- **Clarificări:** Documentațiile de atribuire care citează încă «Ordin 132/2021» — de cerut actualizare/clarificare că se acceptă autorizații emise pe ambele regimuri.
- **Acces:** public · Sursă: https://arhiva.anre.ro/download.php?f=fqmCgqk%3D&t=vdeyut7dlcecrLbbvbY%3D

#### Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) 
- **🟡 modificat** · ordin_anre · ANRE · ediție: Ordin 65/10.05.2023, MO 409/12.05.2023; Ordin 85/03.12.2024, MO 1225/05.12.2024 · `ofertare_normative.id = 23`
- **Titlu:** Regulamentul pentru autorizarea persoanelor fizice care desfășoară activități în sectorul gazelor naturale
- **Ce cere:** Tipuri instalatori: proiectare PGIU (IU PM/PR/PJ), PGD (SD/SDI/magistrale directe PM/PR/PJ + biogaz/biometan), PGT (transport, SD PI, amonte, înmagazinare, IU PI), PGL, PGLT, PH; execuție/exploatare EGIU, EGD, EGT, EGL, EGLT, EH. Verificatori de proiecte atestați: VGd, VGt, VGp, VGs, VGb, VGg/VGl, VGh.
- **Praguri:**
  - Vizare la 5 ani de la emitere/ultima vizare; cerere cu min. 30 zile înainte (sursă secundară iLegis — de confirmat în text)
  - Condiții examen: studii de profil + experiență (ex. 4 ani pentru unele tipuri — sursă secundară)
- **Modificări:**
  - Ordin ANRE 85/2024 — înlocuiește Tabelul 1 (tipuri) și Tabelul 3 (personal pe tipuri), adaugă PGLT/EGLT (terminale GNL), PH/EH (hidrogen)
- **Ofertare:** Personalul cheie «instalator autorizat ANRE» din fișa de date: tipurile vechi (ex. «EGD» păstrat, dar nu mai există gradele IGIB/IGIA etc. din regimul anterior). Legitimațiile emise pe regimul 182/2020 rămân valabile până la expirare.
- **Clarificări:** Dacă AC cere «instalator autorizat ANRE gradul ...» (terminologie veche) → clarificare de echivalență cu EGD/EGIU/EGT.
- **Acces:** public · Sursă: https://anre.ro/wp-content/uploads/2025/01/Ord-85-2024.pdf

#### Ordin ANRE 182/2020 
- **🔴 înlocuit** · ordin_anre · ANRE · ediție: înlocuit prin Ordin ANRE 65/2023 · înlocuit de: Ordin ANRE 65/2023 (+ Ordin 85/2024) · `ofertare_normative.id = 23`
- **Titlu:** Regulamentul pentru autorizarea persoanelor fizice care desfășoară activități în sectorul gazelor naturale (vechi)
- **Ce cere:** Legitimațiile obținute în baza lui, aflate în termen, sunt asimilate autorizațiilor și își păstrează valabilitatea până la expirare (dispoziție tranzitorie citată de sursă secundară).
- **Ofertare:** Tabela ofertare_normative #23 trebuie actualizată la Ordin 65/2023.
- **Clarificări:** 
- **Acces:** public · Sursă: https://legislatie.just.ro/Public/DetaliiDocumentAfis/291565

#### Ordin ANRE 7/2022 
- **🟡 modificat** · ordin_anre · ANRE · ediție: 23.02.2022, MO 196/28.02.2022; abrogă Ordin 18/2021 și 96/2018; cu modificările ulterioare (lista completă neverificată) · `ofertare_normative.id = 28`
- **Titlu:** Regulamentul privind racordarea la sistemul de distribuție a gazelor naturale
- **Ce cere:** Etapele racordării (cerere, ATR, contract de racordare, proiectare/execuție racord, PIF). NTPEE art. 7 alin. (4) trimite la art. 28 alin. (1) din acest regulament pentru ATR/notificare la separarea/modificarea IU.
- **Praguri:**
  - Termene și tarife de racordare — neverificate din textul primar (PDF-urile publicate de operatori au fost inaccesibile)
- **Ofertare:** Relevant la contracte cu OSD pentru branșamente (cine proiectează/execută racordul, termene).
- **Clarificări:** Numărul corect este 7/2022 (nu 18/2021).
- **Acces:** public · Sursă: https://www.engie.ro/wp-content/uploads/2022/03/Ordinul-ANRE-nr-7-din-2022.pdf

#### Ordin ANRE 239/2019 
- **🟡 modificat** · ordin_anre · ANRE · ediție: MO 36/20.01.2020, cu modificările ulterioare (înlocuiește Ordin 4/2007, conform NTPEE consolidat art. 32 alin. 2 lit. c)
- **Titlu:** Norma tehnică privind delimitarea zonelor de protecție și de siguranță aferente capacităților energetice
- **Ce cere:** Distanțe față de LEA și alte capacități energetice — se aplică la conducte OL supraterane lângă LEA.
- **Ofertare:** Traversări/paralelisme cu LEA.
- **Clarificări:** 
- **Acces:** public · Sursă: https://migs.ro/wp-content/uploads/2023/02/NTPEE-2018-actualizat-cu-OANRE-89-modificat-cu-OANRE-2-din-2023.pdf

#### Standardul de performanță pentru serviciul de distribuție a gazelor naturale (ANRE) · ⚠️ neverificat integral
- **⚪ neconfirmat** · ordin_anre · ANRE · ediție: Numărul ordinului în vigoare în 2026 nu a fost verificat
- **Titlu:** Standard de performanță pentru serviciul de distribuție a gazelor naturale
- **Ce cere:** Indicatori de calitate și termene pentru OSD (inclusiv racordare, intervenții). Nu impune obligații directe executantului; contează prin termenele impuse OSD care se transferă în contracte.
- **Ofertare:** Termenele de execuție impuse de OSD în caiete pot decurge din acest standard.
- **Clarificări:** 
- **Acces:** public · Sursă: 

#### PT CR 9-2025 (Ordin MEDAT 1172/2026) 
- **🟢 în vigoare** · instructiune · Ministerul Economiei, Digitalizării, Antreprenoriatului și Turismului / ISCIR · ediție: Ordin 1172/24.07.2026, MO 658 și 658 bis/07.08.2026; abrogă Ordin ME 1001/2013 (PT CR 6/7/9-2013)
- **Titlu:** Autorizarea sudorilor care execută lucrări de sudare la instalațiile sub presiune și la instalațiile de ridicat și a operatorilor sudare țevi și fitinguri din PEHD
- **Ce cere:** ISCIR emite autorizația de sudor OL/Al și de operator sudare PEHD; autorizația e valabilă numai pentru persoana juridică angajatoare (art. 67); procedurile de sudare trebuie aprobate conform PT CR 7-2025. // Autorizarea ISCIR a sudorilor (oțel/Al) și a operatorilor sudare PEHD, legată de persoana juridică angajatoare; autorizația acoperă doar procedeul folosit la examen; necesită WPQR care să acopere domeniul; RTS atestat. Prelungire cu sau fără examen (fără examen: pe baza certificatului de calificare sudor + raport de evaluare tehnică).
- **Praguri:**
  - art. 49 alin. (1): valabilitate autorizație 2 ani de la emitere
  - art. 63: autorizațiile ISCIR emise anterior rămân valabile până la expirare
  - art. 49 alin. (1) / art. 53 alin. (3) — valabilitate autorizație max. 2 ani; nu poate depăși valabilitatea certificatului de calificare sudor
  - art. 57 alin. (2) — prelungire cu 2 ani
  - art. 68 — max. 90 zile între PV ISCIR și depunerea dosarului final
  - art. 63 — autorizațiile emise anterior rămân valabile până la expirare
- **Documente / atestări:**
  - autorizație de sudor ISCIR / autorizație operator sudare PEHD
  - certificat de calificare sudor (SR EN ISO 9606-1) — la prelungire fără examen
  - WPS folosit la examen
  - atestat RTS valabil
  - fișă de aptitudini medicina muncii
  - contract individual de muncă (autorizația e valabilă doar la angajator)
- **Verificări / probe:**
  - examen practic + teoretic la ISCIR
  - VT + NDT/încercări distructive pe probe (standardele SR EN ISO 5817:2023, 17636-1:2022, 17636-2:2023, 10675-1:2022, 17640:2019, 11666:2018, 17635:2025, SR EN 12814-x pentru PE)
- **Articole cheie:**
  - art. 49 — valabilitate 2 ani
  - art. 63 — tranzitoriu
  - art. 67 — valabilă doar pentru angajator
  - art. 53 — valabilitate ≤ certificat calificare sudor
  - art. 54 — prelungire cu/fără examen
  - art. 63-66 — tranzitorii
  - art. 67 — valabilă numai pentru angajatorul sudorului
- **Modificări:**
  - Înlocuiește PT CR 9-2013
  - Abrogă Ordinul 1001/2013 (PT CR 6-2013, PT CR 7-2013, PT CR 9-2013)
- **Ofertare:** NTPEE cere «sudori autorizați de organisme abilitate»; Ordin ANRE 17/2026 cere sudori OL/PE proprii cu autorizații — se urmărește expirarea la 2 ani și legătura cu angajatorul. // Personalul de sudură propus în ofertă trebuie să aibă autorizații ISCIR valabile pe durata contractului și emise pe Gazpet (art. 67 — valabile doar la angajator).
- **Clarificări:** Autorizația sudorului nu e transferabilă la subcontractant (art. 67) — atenție la personal cheie propus de terți. // Dacă AC cere 'certificat EN ISO 9606-1/EN 13067' fără autorizație ISCIR (sau invers) — clarificare de echivalență; autorizația ISCIR e cerința națională pentru instalații sub presiune.
- **Acces:** public · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-9-2025.pdf

#### PT CR 6-2025 (Ordin MEDAT 1172/2026) 
- **🟢 în vigoare** · instructiune · MEDAT / ISCIR · ediție: MO 658/07.08.2026; înlocuiește PT CR 6-2013
- **Titlu:** Autorizarea operatorilor control nedistructiv și a persoanelor juridice care efectuează examinări nedistructive și încercări distructive
- **Ce cere:** Operatori CND autorizați ISCIR pe niveluri 1, 2, 3 (AT doar nivel 1/2); laboratoarele (persoane juridice) autorizate. NTPEE cere buletine CND de la «laborator autorizat». // Operatori NDT autorizați ISCIR pe niveluri 1/2/3 (AT doar 1/2); laboratoare NDT autorizate/avizate (aviz 4 ani); referință SR EN ISO 9712:2022.
- **Praguri:**
  - art. 22 alin. (1) — autorizație NDT nivel 1 și 2: 2 ani
  - art. 22 alin. (2) — nivel 3: 5 ani
  - aviz laborator: 4 ani
- **Documente / atestări:**
  - autorizație ISCIR operator NDT (metodă + nivel)
  - autorizația laboratorului NDT
  - autorizație CNCAN pentru RT (surse radiații)
- **Verificări / probe:**
  - buletinele NDT trebuie semnate de operator autorizat (min. nivel 2 pentru evaluare)
- **Articole cheie:**
  - art. 11 — niveluri 1/2/3
  - art. 22 — valabilitate autorizații
- **Modificări:**
  - Înlocuiește PT CR 6-2013
- **Ofertare:** Subcontractarea CND: se cere copia autorizației ISCIR a laboratorului și a operatorilor nivel 2. // Subcontractantul NDT: cere autorizația laboratorului + operatori nivel 2 + autorizație CNCAN (pentru RT) — documente de calificare uzuale în DUAE/propunere tehnică.
- **Clarificări:** Nu PT CR 11 — CND este PT CR 6. // Dacă AC cere doar certificare EN ISO 9712 (fără ISCIR) sau invers — clarificare de echivalență.
- **Acces:** public · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-6-2025.pdf

#### PT CR 7-2025 (Ordin MEDAT 1172/2026) 
- **🟢 în vigoare** · instructiune · MEDAT / ISCIR · ediție: MO 658/07.08.2026; înlocuiește PT CR 7-2013
- **Titlu:** Aprobarea procedurilor de sudare pentru oțel, aluminiu, aliaje de aluminiu și PEHD
- **Ce cere:** WPS/WPQR aprobate — premisă pentru autorizarea sudorilor (PT CR 9). // Aprobarea ISCIR a procedurilor de sudare (WPS/WPQR) — oțel pe baza încercărilor de tip SR EN ISO 15614-1:2017; PEHD: proceduri BW (cap la cap), SRM (electrofuziune manșon), SRS (electrofuziune șa), încercări SR EN 12814-x.
- **Documente / atestări:**
  - WPQR aprobat ISCIR
  - WPS
  - rapoarte NDT și încercări distructive pe probe
- **Verificări / probe:**
  - VT, RT/UT, încercări mecanice (tracțiune, îndoire, duritate, macro) pe probe; PE: încercări SR EN 12814-1/-2/-4/-5
- **Articole cheie:**
  - Cap. PEHD — tipuri BW/SRM/SRS
  - Anexa standarde: SR EN ISO 15614-1:2017, 5817:2023, 17635:2025, 17636-1:2022, 17636-2:2023, 17640:2019, 10675-1:2022, 11666:2018
- **Modificări:**
  - Înlocuiește PT CR 7-2013
- **Ofertare:** Dosarul de calitate (WPS aprobate) cerut adesea în CS. // Fără WPQR aprobat ISCIR care să acopere materialul/grosimea/diametrul/procedeul, sudorii nu pot fi autorizați (PT CR 9) — verifică acoperirea înainte de ofertare (ex. L245/L290, grosimi, DN mari).
- **Clarificări:**  // Când caietul cere WPQR 'conform EN ISO 15614-1 nivel 2' — verifică dacă WPQR-ul existent e nivel 1 sau 2.
- **Acces:** public · Sursă: https://iscir.ro/prescriptii-iscir ; https://iscir.ro/wp-content/uploads/2026/08/PT-CR-7-2025.pdf

#### PT CR 3-2025 · ⚠️ neverificat integral
- **🟢 în vigoare** · instructiune · MEDAT / ISCIR · ediție: publicat 2026 (PDF pe iscir.ro, 08/2026); detalii neverificate
- **Titlu:** Autorizarea RSVTI (responsabil cu supravegherea și verificarea tehnică a instalațiilor)
- **Ce cere:** RSVTI e necesar pentru instalațiile sub incidența ISCIR (recipiente sub presiune, instalații de ridicat — ex. macarale, compresoare cu recipient). Conductele de distribuție gaze sunt sub ANRE, nu ISCIR.
- **Ofertare:** Utilaje de ridicat/compresoare pe șantier — RSVTI propriu sau contractat.
- **Clarificări:** 
- **Acces:** public · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-3-2025.pdf

#### NP 133-2022 vol. I (Ordin MDLPA 15/2023) 
- **🟢 în vigoare** · normativ · MDLPA · ediție: Ordin 15/05.01.2023, MO 43 și 43 bis/16.01.2023; în vigoare la 30 zile de la publicare; abrogă NP 133/1-2013
- **Titlu:** Normativ privind proiectarea, execuția și exploatarea sistemelor de alimentare cu apă și canalizare ale localităților — Vol. I Sisteme de alimentare cu apă
- **Ce cere:** Nu se aplică proiectelor cu lucrări în curs, cu achiziție lansată, cu documentații recepționate sau finanțare aprobată la intrarea în vigoare (art. 3) — multe proiecte SEAP 2023–2026 pot fi încă pe NP 133-2013.
- **Praguri:**
  - 7.3.6 (aducțiuni): tronsoane de probă 500–2000 m, diferență max. de cotă 10 m; probă doar cu apă potabilă, în tranșee; creștere presiune în trepte de 0,5 bar; masive de ancoraj la 28 zile; manometre cu diviziuni 0,2 bar; probe la min. 5°C prognozate 3 zile (sub 5°C doar cu umplutură min. 0,80 m și capete termoizolate)
  - 9.2.x alin. (9)–(13) (rețele distribuție): presiune de încercare 1,5×PN, max. 10 bar în orice punct (rețea ≤ 6 bar); pentru tronsoane > 6 bar: min(1,5×clasa conductei; 1,25×clasa armăturilor); nu se instalează conducte cu presiune de probă de produs < 10 bar; manometre cu diviziuni 0,1 bar; diferență max. cotă 10 m
  - Criteriu de reușită: fără scurgeri/pete de umezeală; pierderea de presiune ≤ valorile din proiect
  - Bandă de semnalizare și detecție la min. 0,30 m peste generatoare
  - Subtraversări: min. 1,50 m de la îmbrăcămintea rutieră la tubul de protecție, 0,80 m sub radierul rigolei; tub de protecție cu min. 100 mm peste diametrul conductei
  - 7.3.7: dezinfectare cu 25–30 mg/l clor activ, min. 24 h, clor rezidual min. 10 mg/l la capătul îndepărtat; spălare pe tronsoane 100–500 m
- **Verificări / probe:**
  - Proba de presiune conform SR EN 805 + STAS 6819 (aducțiuni) / SR 4163-3 + SR EN 805 + STAS 6819 (rețele)
  - Spălare și dezinfectare conform SR EN 805
  - Relevee anexate Cărții Construcției + GIS operator
- **Articole cheie:**
  - 7.3.6 — proba aducțiuni
  - 7.3.7 — spălare/dezinfectare
  - 9.2.7.5 — traversări
  - cap. 9 execuție rețele alin. (8)–(14) — proba rețele
- **Ofertare:** Presiunea și durata probei trebuie scrise în proiect (alin. 2/13 b) — dacă lipsesc, se cere clarificare. Costuri: masive de ancoraj de probă, apă potabilă, dezinfectare, analize.
- **Clarificări:** Clarificare dacă proiectul e pe NP 133-2013 sau 2022 (art. 3 tranzitoriu); pierderea admisibilă de presiune lipsă din proiect.
- **Acces:** public · Sursă: https://www.drimand.ro/download/62%20NORMATIV%20NP%20133-2022.pdf

#### NP 133-2022 vol. II (Ordin MDLPA 14/2023) 
- **🟢 în vigoare** · normativ · MDLPA · ediție: Ordin 14/05.01.2023, MO 41 și 41 bis/13.01.2023; vol. III (structuri hidroedilitare din beton) — Ordin 19/2023, MO 44/16.01.2023
- **Titlu:** Normativ NP 133-2022 — Vol. II Sisteme de canalizare
- **Ce cere:** Execuția rețelelor de canalizare (3.6.1): CCTV pe toate tronsoanele înainte de probă; proba de etanșeitate conform SR EN 1610 cu cerințe suplimentare.
- **Praguri:**
  - Proba numai cu apă; presiune de verificare max. 5 m col. H2O la capătul aval și min. 1 m la amonte; diferență max. de cotă radier pe tronson 4 m
  - Timp de saturare în general 1 h; durata verificării de regulă 30 min
  - Criteriu: fără scurgeri vizibile; nivelul în punctul de control să nu scadă cu > 10 cm; apa adăugată ≤ valoarea din proiect
  - 3.4.3.1.4: acoperire min. = adâncimea de îngheț (STAS 6054) și min. 0,80 m
- **Verificări / probe:**
  - Raport CCTV
  - Proba de etanșeitate (apă)
  - Grad de compactare conform proiect
- **Articole cheie:**
  - 3.6.1 alin. (9)–(16) — execuție rețele, probă etanșeitate
- **Ofertare:** CCTV și proba de etanșeitate pe toate tronsoanele — de prevăzut în deviz (des omise).
- **Clarificări:** Volumul admisibil de apă adăugată trebuie dat în proiect — lipsa lui e motiv de clarificare; dacă CS cere probă cu aer, de clarificat (NP cere apă).
- **Acces:** public · Sursă: https://www.drimand.ro/download/62%20NORMATIV%20NP%20133-2022.pdf

#### NP 133-2013 (Ordin MDRAP 2901/2013) 
- **🔴 înlocuit** · normativ · MDRAP · ediție: MO 660 și 660 bis/28.10.2013, completat prin Ordin 3218/2016; părțile I și II abrogate prin Ordinele MDLPA 15/2023 și 14/2023 · înlocuit de: NP 133-2022 vol. I–III
- **Titlu:** Normativ privind proiectarea, execuția și exploatarea sistemelor de alimentare cu apă și canalizare a localităților (ediția 2013)
- **Ce cere:** Se mai aplică proiectelor aflate în tranzitoriul art. 3 din ordinele 2023.
- **Ofertare:** Verifică pe ce ediție e proiectul.
- **Clarificări:** 
- **Acces:** public · Sursă: https://lege5.ro/Gratuit/gm3tmnrwha/ordinul-nr-2901-2013-pentru-aprobarea-reglementarii-tehnice-normativ-privind-proiectarea-executia-si-exploatarea-sistemelor-de-alimentare-cu-apa-si-canalizare-a-localitatilor-indicativ-np-133-2013

#### SR EN 805:2000 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (EN 805:2000) · ediție: Ediția în vigoare neverificată în catalogul ASRO
- **Titlu:** Alimentări cu apă. Condiții pentru sistemele și componentele exterioare clădirilor
- **Ce cere:** Proba de presiune a rețelei: probă preliminară, probă de cădere de presiune, probă principală (metoda pierderii de apă sau a pierderii de presiune); STP calculată din MDP.
- **Praguri:**
  - Din cunoștințe generale, NEVERIFICAT în text: STP = min(MDP×1,5; MDP+5 bar) când nu se calculează lovitura de berbec; STP = MDPc + 1 bar când e calculată
- **Verificări / probe:**
  - Proba de presiune pe tronsoane, spălare, dezinfectare
- **Ofertare:** Standard de referință pentru proba de presiune apă (NP 133 trimite la el).
- **Clarificări:** Cerere ca proiectul să precizeze MDP/STP și metoda de probă.
- **Acces:** platit · Sursă: https://www.asro.ro

#### SR EN 1610:2015 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (EN 1610:2015) · ediție: Ediția 2015 (de confirmat la ASRO)
- **Titlu:** Execuția și încercarea racordurilor și rețelelor de canalizare
- **Ce cere:** Proba de etanșeitate cu aer (metode LA/LB/LC/LD) sau cu apă (metoda W).
- **Praguri:**
  - Confirmat prin NP 133-2022 vol. II: apă la 1–5 m col. H2O, saturare ~1 h, durată 30 min
  - NEVERIFICAT în text: apă adăugată admisă ≈0,15 l/m² (conducte), 0,20 l/m² (conducte+cămine), 0,40 l/m² (cămine) suprafață interioară udată
- **Verificări / probe:**
  - Probă etanșeitate conducte, cămine, racorduri
- **Ofertare:** Bază pentru proba de etanșeitate canalizare.
- **Clarificări:** Metoda aleasă (aer/apă) și criteriul trebuie precizate.
- **Acces:** platit · Sursă: https://www.asro.ro

#### SR 4163-1:1995, SR 4163-2:1996, SR 4163-3:1996 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO · ediție: Ediții neverificate (paywall)
- **Titlu:** Alimentări cu apă. Rețele de distribuție (1: prescripții de proiectare; 2: dimensionare; 3: execuție și recepție)
- **Ce cere:** SR 4163-3 — execuția și probele rețelelor de distribuție; NP 133-2022 trimite explicit la el pentru proba de presiune a rețelelor.
- **Ofertare:** Referință în CS la rețele apă.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro

#### SR 1343-1:2006 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO · ediție: 2006 (neverificat)
- **Titlu:** Alimentări cu apă. Determinarea cantităților de apă potabilă pentru localități urbane și rurale
- **Ce cere:** Debite de calcul — relevant pentru proiectare, nu pentru execuție.
- **Ofertare:** Mic.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro

#### SR 1846-1:2006 / SR 1846-2:2007 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO · ediție: Ediții neverificate; STAS 1846 vechi înlocuit de SR 1846-1/-2
- **Titlu:** Canalizări exterioare. Prescripții de proiectare (debite ape uzate / ape meteorice)
- **Ce cere:** Dimensionare debite canalizare — proiectare.
- **Ofertare:** Mic.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro

#### SR EN 752:2017 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO · ediție: 2017 (neverificat)
- **Titlu:** Rețele de canalizare în exteriorul clădirilor. Managementul sistemului de canalizare
- **Ce cere:** Cerințe funcționale și management — proiectare/exploatare.
- **Ofertare:** Mic pentru execuție.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro

#### STAS 6819 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO · ediție: ediție neverificată (citat de NP 133-2022 la proba de presiune)
- **Titlu:** Alimentări cu apă. Aducțiuni (prescripții de proiectare și execuție)
- **Ce cere:** Completează SR EN 805 la probele aducțiunilor.
- **Ofertare:** Referit în NP 133-2022 7.3.6.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro

#### Normativ I 22-99 · ⚠️ neverificat integral
- **⚪ neconfirmat** · normativ · MLPAT · ediție: Probabil înlocuit de NP 133-2013/2022 — act de abrogare neverificat · înlocuit de: NP 133 (probabil)
- **Titlu:** Normativ pentru proiectarea și executarea conductelor de aducțiune și a rețelelor de alimentare cu apă și canalizare a localităților
- **Ce cere:** Încă citat în caiete de sarcini vechi.
- **Ofertare:** Dacă CS citează I 22 — clarificare privind norma aplicabilă.
- **Clarificări:** Normativ depășit citat în documentație.
- **Acces:** public · Sursă: 

#### Legea 241/2006 (republicată) · ⚠️ neverificat integral
- **🟡 modificat** · lege · Parlamentul României · ediție: republicată, cu modificări ulterioare (versiunea 2026 neverificată)
- **Titlu:** Legea serviciului de alimentare cu apă și de canalizare
- **Ce cere:** Organizarea serviciului; operatorii serviciului trebuie licențiați de ANRSC. Constructorul care execută rețele NU este operator și nu are nevoie de licență ANRSC.
- **Ofertare:** Cerința «licență ANRSC» la un contract de execuție lucrări este de regulă restrictivă (se aplică doar contractelor de operare/delegare).
- **Clarificări:** Șablon de clarificare/contestare pentru cerința de licență ANRSC la execuție.
- **Acces:** public · Sursă: https://www.anrsc.ro/alimentare-cu-apa-si-canalizare/legislatie/

#### Legea 51/2006 (republicată) + regulamentul ANRSC de licențiere · ⚠️ neverificat integral
- **🟡 modificat** · lege · Parlamentul României / ANRSC · ediție: ANRSC funcțional în 2026 (raport sector 2025, evidență licențe apă 25.05.2026); numărul ordinului ANRSC de licențiere neverificat
- **Titlu:** Legea serviciilor comunitare de utilități publice; licențierea operatorilor
- **Ce cere:** Licența ANRSC — pentru operatorii care prestează serviciul public (exploatare), nu pentru executanți de lucrări.
- **Ofertare:** Idem Legea 241/2006.
- **Clarificări:** 
- **Acces:** public · Sursă: https://www.anrsc.ro/alimentare-cu-apa-si-canalizare/acordare-licenta-e/licente-valabile/

## Sudură, NDT, izolație, materiale

### Sinteză

*Cercetare din 01.10.2026, doar citire. Standardele sunt protejate de copyright. De aceea am scris cerințele rezumat, cu cuvintele mele, pe baza metadatelor ASRO/ISO/CEN și a surselor publice secundare. Datele structurate sunt în `sudura_izolatie_materiale.json` (46 de înregistrări).*

Sursele primare citite integral:
- NTPEE-2018, în forma sintetică cu modificările din Ordinul ANRE 2/2023;
- PT CR 6/7/9-2025 ISCIR (MO 658 bis/07.08.2026);
- 29 de numere din *Buletinul Standardizării* ASRO (2023–2026);
- specificațiile Distrigaz Sud Rețele ST-TGPHD și ST-TOLNP (2023);
- specificația Delgaz Grid ST 505 (A5/2023).

---

### 1. Constatări principale

1. **Regimul ISCIR s-a schimbat pe 07.08.2026.** Ordinul MEDAT 1172/24.07.2026 aprobă PT CR 6-2025 (NDT), PT CR 7-2025 (proceduri de sudare) și PT CR 9-2025 (sudori și operatori PEHD). Ordinul abrogă edițiile 2013.
   - Autorizația de sudor sau de operator PEHD e valabilă **maximum 2 ani** și nu poate depăși valabilitatea certificatului de calificare a sudorului (art. 49, 53).
   - Autorizația e valabilă **doar la angajatorul** sudorului (art. 67).
   - Autorizațiile emise anterior rămân valabile până la expirare (art. 63).
   - Autorizația NDT e valabilă 2 ani pentru nivelurile 1/2 și 5 ani pentru nivelul 3 (PT CR 6-2025, art. 22).
2. **NTPEE nu stabilește un procent de NDT** pentru sudurile curente din oțel. Stabilește doar trei lucruri:
   - NDT obligatoriu la conductele subterane (art. 238 alin. 4);
   - **100% la sudurile de poziție** (art. 238 alin. 5);
   - control integral la curbele din segmente cu Dn > 350 (art. 208 lit. d).

   „Clasa de calitate II” (art. 238 alin. 1) **nu este corelată** cu nivelurile B/C/D din SR EN ISO 5817:2023. Acestea sunt cele mai frecvente surse de clarificări la sudura de oțel.
3. **Multe ediții de standarde s-au schimbat în 2024–2026:**

   | Standard | Ediția nouă | Înlocuiește |
   |---|---|---|
   | SR EN 1555-1…-4 | 2025 | 2021 |
   | SR EN ISO 17635 | 2025 | 2017 |
   | SR EN ISO 14732 | 2025 | — |
   | SR EN 12007-5 | 2024 | — |
   | SR EN 1594 | 2024 | 2014 |
   | SR EN 15001-1/-2 | 2023 | — |
   | SR EN ISO 17636-2 | 2023 | — |
   | SR EN 10216-2 | 2024 | — |
   | EN ISO 15589-1 | 2026 (doa 31.10.2026) | — |
   | ISO 21809-2/-4 | 2026 | — |
   | EN ISO 3834-6 | 2024 | — |

   Revizii în curs: prEN 13067, prEN 10204, ISO/DIS 9606 (consolidare), ISO/FDIS 21809-3, prEN ISO 15614-1.
4. **Anexa 2 din NTPEE citează ediții depășite:** SR EN 12954:2002, SR EN 13067:2013, SR EN 1555:2011/2013, SR EN ISO 15609-1:2005. Ofertantul poate declara conformitatea cu ediția curentă. Dacă ediția contează, întreabă autoritatea contractantă (AC).
5. **Operatorii cer documente de calitate stricte:**
   - Distrigaz Sud Rețele cere **raport 2.2 + certificat 3.1 conform SR EN 10204** chiar și la țevile de PE;
   - la țeava de oțel preizolată cere certificat 3.1 **și pentru țeavă, și pentru izolație**;
   - izolație 3LPE clasa B2/B3 conform SR EN ISO 21809-1:2019, cu sablare Sa 2½;
   - limite de vârstă la livrare: țeavă PE ≤ 3 luni, țeavă oțel ≤ 24 luni, izolație ≤ 6 luni.
6. **SR EN 12068:2002 este în vigoare** conform magazin.asro.ro și nu e înlocuit de EN ISO 21809-3. ISO 21809-3:2016 + A1:2020 este în curs de înlocuire printr-un FDIS.

---

### 2. Pe domenii (rezumat)

#### 2.1 Sudură oțel

| Standard | Ediție curentă | Documente rezultate | Ce verifici în caietul de sarcini (CS) |
|---|---|---|---|
| SR EN ISO 3834-2/-3 | 2021 (+ -6:2024 ghid) | certificat 3834 (opțional), plan de inspecție | dacă cere certificare 3834-2; e proporțională pentru distribuție? |
| SR EN ISO 9606-1 | 2017 (DIS 9606 în curs) | certificat sudor + confirmare la 6 luni | procedeu/poziție/diametru acoperit |
| SR EN ISO 15614-1 | 2017 + A1:2019 | WPQR aprobat ISCIR (PT CR 7-2025) | nivel 1 sau 2 |
| SR EN ISO 15609-1 | 2020 | WPS | cine aprobă WPS și în cât timp |
| ISO 14731 | 2019 (SR neconfirmat) | numire coordonator / RTS | dacă se cere IWE sau ajunge RTS ISCIR |
| SR EN 12732+A1 | 2014 (neconfirmat) | WPS, NDT | extinderea NDT pe treapta de presiune (MOP) |
| PT CR 9-2025 / PT CR 7-2025 | 2025 | autorizații ISCIR, WPQR aprobat | valabilitate pe toată durata contractului |

Revalidarea ISO 9606-1 (sursă secundară, de confirmat în standard). Certificatul se revalidează prin una din trei variante:
- reexaminare la 3 ani;
- la 2 ani, cu 2 suduri verificate din ultimele 6 luni;
- prelungire nelimitată, cât timp sudorul rămâne la același producător cu sistem de calitate verificat.

În toate variantele, activitatea se confirmă la 6 luni.

#### 2.2 Sudură PE

- **NTPEE:**
  - sudare cap la cap pentru d ≥ 75; electrofuziune pentru orice diametru; compresie pentru 32–63 (art. 240);
  - aparate cu **agrement tehnic** și revizii la intervalul indicat de producător (art. 239);
  - fitingurile PE100 pot fi folosite și cu țevi PE80, dacă se respectă regimurile producătorilor (art. 244);
  - nu se admit corecturi la îmbinări (art. 246);
  - NDT pe PE doar dacă îl cere proiectul (art. 245).
- **Calificare:** în România, operatorul are nevoie de autorizație ISCIR PEHD (PT CR 9-2025). EN 13067:2020 este standardul european; o revizie e în curs.
- **Parametri cap la cap:** DVS 2207-1:2015-08 este ultima ediție găsită. ISO 21307:2017 a fost reconfirmat în 2023 și are trei proceduri.
- **Electrofuziune și trasabilitate:** ISO 12176-2:2025 (aparate); -3/-4/-5 (cod operator, cod trasabilitate). Delgaz ST 505 cere:
  - citire cod de bare;
  - memorie de cel puțin 500 de suduri;
  - protocol PDF/USB cu operator, locație, dată și oră;
  - monitorizarea energiei și a timpului de răcire.
- **Țevi și fitinguri:** SR EN 1555-1…-4:2025. PE80, PE100, PE100-RC; SDR 11, SDR 17. Distrigaz folosește PE100 SDR11.

#### 2.3 NDT

- Lanțul de standarde: **SR EN ISO 17635:2025** (reguli generale) alege metoda și leagă nivelul de calitate ISO 5817 de nivelul de acceptare:
  - VT → ISO 17637:2017, cu acceptare direct după ISO 5817;
  - RT → ISO 17636-1:2022 / -2:2023, cu acceptare după ISO 10675-1:2022;
  - UT → ISO 17640:2019, cu acceptare după ISO 11666:2018.
- Corelare uzuală, de verificat în ediția 2025:

  | Nivel ISO 5817 | Acceptare RT | Acceptare UT |
  |---|---|---|
  | B | 1 | 2 |
  | C | 2 | 3 |
  | D | 3 | 3 |

- **Personal:** SR EN ISO 9712:2022, plus autorizație ISCIR pe metodă și nivel. Buletinele se emit de un laborator autorizat. Pentru RT e nevoie și de autorizație CNCAN.
- **Procente:** vezi constatarea 2. Nu am găsit nicio specificație publică Delgaz/Distrigaz care să fixeze procentul de radiografiere. Se clarifică pe fiecare procedură.

#### 2.4 Izolare / protecție anticorozivă

- **Pregătirea suprafeței:**
  - SR EN ISO 8501-1:2007: grade Sa 1, Sa 2, Sa 2½, Sa 3, St 2, St 3;
  - SR EN ISO 8501-3:2025 (suduri și muchii) — nou;
  - ISO 8503 (rugozitate) și 8502 (praf, săruri, condens): 8502-5:2025 și 8502-15:2025 sunt noi.
- **Izolație de fabrică:** SR EN ISO 21809-1:2019, 3LPE. Distrigaz cere clasa B2 sau B3. Grosimile minime din specificația operatorului:

  | Greutate liniară Pm | B2 | B3 |
  |---|---|---|
  | ≤ 15 kg/m | 1,8 mm | 2,3 mm |
  | 15–50 kg/m | 2,1 mm | 2,7 mm |
  | 50–130 kg/m | 2,5 mm | 3,1 mm |

- **Îmbinări pe șantier:**
  - SR EN 12068:2002 (benzi și manșoane; clase de tip C50) este în vigoare;
  - EN ISO 21809-3:2016 + A1:2020 urmează să fie înlocuit (FDIS);
  - pentru DIN 30672 nu am putut confirma ediția.
- **Protecție catodică:**
  - EN 12954:2019 dă principiile generale (criteriu: potențial de protecție sau deplasare catodică de 100 mV);
  - EN ISO 15589-1 este specific conductelor pe uscat; ediția 2026 a fost adoptată de CEN;
  - EN 13509:2003 acoperă tehnicile de măsurare (on/off, DCVG, CIPS).
- **Ce cere NTPEE:**
  - suprafața se curăță înainte de izolare, de preferință prin sablare (art. 260);
  - conductele se izolează în fabrică sau în stații autorizate; pe șantier doar îmbinările, reparațiile și ieșirile din sol pe 0,5 m (art. 262);
  - rezistența izolației se verifică după umplerea șanțului, cu buletin de la laborator autorizat (art. 254 lit. c);
  - se montează posturi de măsurare și piese electroizolante (art. 263).
- **Vopsirea porțiunilor supraterane** se face după probe (art. 257). Se aplică seria ISO 12944: categorii C1–CX și durabilitate L/M/H/VH (ediția SR neconfirmată).
- **Atenție:** „SR EN 12944-3:2025” din buletinele ASRO este alt standard, nu seria ISO 12944 pentru vopsele.
- **Tensiunile pentru testul cu scânteie (holiday detection)** din EN 12068 / ISO 21809 **nu le-am putut verifica** din surse publice. Le iei din fișa producătorului sistemului sau din standard.

#### 2.5 Conducte, materiale, probe

- **SR EN 10204:2005:** documentele de tip 2.1/2.2 sunt declarații. Certificatul 3.1 e emis de inspecția producătorului, independentă de fabricație. Certificatul 3.2 e validat în plus de reprezentantul cumpărătorului sau de un inspector terț, ceea ce înseamnă cost și termen mai mari. O revizie e în curs.
- **SR EN ISO 3183:2020:** L245/B PSL1 este cerut de Distrigaz. EN 10208-2 a fost retras și înlocuit de EN ISO 3183 (informație de specialitate, neverificată pe ASRO).
- **EN 12327:2012** stabilește procedura de încercare, dar **nu** presiunile. Presiunile vin din NTPEE.
- **Probe de presiune în NTPEE**, conform Ordinului 2/2023:

  | Treaptă de presiune (subteran) | Proba de rezistență | Proba de etanșeitate |
  |---|---|---|
  | înaltă | 15 bar | 10 bar |
  | medie | 9 bar (PE80: 6 bar) | 6 bar (PE80: 4 bar) |
  | redusă | 4 bar | 2 bar |
  | joasă | 2 bar | 1 bar |

  - Rezistența durează 1 h. Durata etanșeității depinde de volum (tabelul 81): 0,1 m³ → 1 h, 1 m³ → 6 h, ≥ 4 m³ → 24 h.
  - Se folosesc aparate cu înregistrare continuă, clasa de exactitate ≥ 1,5, cu verificare metrologică valabilă.
  - Verificările se fac pe tronsoane de cel mult 500 m și durează minim 4 h.
- **Alte standarde:** SR EN 1594:2024 (MOP peste 16 bar), SR EN 15001-1/-2:2023 (instalații industriale), SR EN 1775 (instalații interioare, 2007/2008).

---

### 3. Check-list de execuție: documente de calitate pe faze

#### A. Înainte de sudură (PCCVI / predare amplasament)
- [ ] Autorizații ISCIR valabile pe toată durata lucrării, pe fiecare sudor/operator PEHD, emise pe Gazpet. Procedeul trebuie să corespundă (111/141/135 pentru oțel; BW/EF pentru PE).
- [ ] Certificate de calificare ISO 9606-1, cu domeniul de valabilitate și confirmarea la 6 luni.
- [ ] WPQR aprobat ISCIR (PT CR 7-2025) care acoperă materialul, grosimea și diametrul din proiect. WPS-urile sunt disponibile pe șantier.
- [ ] RTS (responsabil tehnic cu sudura, atestat ISCIR) / coordonator de sudură numit prin decizie.
- [ ] Laborator NDT autorizat ISCIR, operatori nivel 2, autorizație CNCAN pentru RT. Contract semnat.
- [ ] Aparate de sudură PE: agrement tehnic + aviz CTPC, revizie valabilă, verificare metrologică a manometrelor. Aparatele EF înregistrează operatorul și fitingul.
- [ ] Materiale recepționate:
  - certificat 3.1 conform SR EN 10204 (țeavă oțel + izolație; la Distrigaz și pentru PE);
  - declarație de conformitate;
  - agrement tehnic sau certificat de conformitate;
  - data fabricației în limite: PE ≤ 3 luni, OL ≤ 24 luni, izolație ≤ 6 luni.
- [ ] Program de control al calității (PCCVI) cu fazele determinante. Pe NTPEE art. 254: PV de lucrări ascunse pentru suduri, izolație și rezistența izolației.
- [ ] Clarificate cu beneficiarul: nivelul de calitate ISO 5817, procentul și metoda NDT, clasa izolației de îmbinare.

#### B. În timpul sudurii
- [ ] Marcarea fiecărei suduri cu poansonul sudorului sau prin numerotare (NTPEE art. 236 alin. 2).
- [ ] Jurnal de sudură: nr. sudură, sudor, WPS, dată, condiții meteo, preîncălzire. Pentru PE: protocol per sudură descărcat din aparat.
- [ ] Protecție la intemperii (paravan, cort). Fără răcire forțată (art. 237).
- [ ] PE: parametrii conform DVS 2207-1 sau fișei producătorului; răzuire la EF; timpul de răcire respectat.
- [ ] Eclise pe arterele de circulație, după Dn (art. 235).

#### C. NDT
- [ ] VT 100% (ISO 17637), cu raport.
- [ ] RT/UT conform procentului stabilit; **100% la sudurile de poziție**. Buletine de la laborator autorizat, cu nivelul de acceptare declarat.
- [ ] Remedieri: la oțel, re-sudare după WPS și re-examinare. La PE e interzisă corectarea: îmbinarea se taie și se reface.
- [ ] Centralizator al sudurilor (plan de sudură) legat de buletinele NDT.

#### D. Izolare
- [ ] Pregătirea suprafeței îmbinării: grad Sa 2½ / St 3 conform sistemului; praf, săruri și punctul de rouă verificate (8502/8503) dacă proiectul cere.
- [ ] Sistem de izolare pentru îmbinări certificat (EN 12068 / EN ISO 21809-3), compatibil cu 3LPE, aplicat după procedura producătorului.
- [ ] Test cu scânteie pe fiecare îmbinare și reparație, cu tensiunea din fișa sistemului. Se consemnează.
- [ ] PV de lucrări ascunse pentru izolație. Ieșirile din sol izolate pe 0,5 m.
- [ ] După umplere: buletin de verificare a rezistenței izolației de la laborator autorizat (art. 254 lit. c). DCVG/PCM dacă se cer.

#### E. Probe de presiune
- [ ] Program de probe aprobat; delegatul OSD prezent (art. 268).
- [ ] Aparate cu înregistrare continuă, clasa ≥ 1,5, verificare metrologică valabilă (art. 274).
- [ ] Rezistență 1 h + etanșeitate cu durata din tabelul 81. La PE, proba se face după răcirea ultimei suduri. Diagramele se semnează (OSD, instalator autorizat, beneficiar).

#### F. Recepție
- [ ] Cartea tehnică: WPS/WPQR, autorizații sudori, jurnal de sudură, buletine NDT, certificate 3.1, declarații de conformitate, PV-uri de lucrări ascunse, buletin izolație, diagrame de probe, potențiale conductă/sol (art. 264), as-built.
- [ ] PV de recepție și punere în funcțiune. Îmbinările făcute după probă se verifică la presiunea din conductă (art. 291).

---

### Fișe

#### SR EN 12327 (EN 12327:2012) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 12327:2012 — ediția curentă la CEN/BSI/DIN/NEN (nicio ediție nouă găsită); ediția SR neconfirmată · `ofertare_normative.id = 31`
- **Titlu:** Infrastructura pentru gaze. Proceduri de încercare la presiune, punere în funcțiune și scoatere din funcțiune. Cerințe funcționale
- **Ce cere:** Proceduri pentru proba de rezistență, etanșeitate și combinată, purjare, punere/scoatere din funcțiune; NU stabilește presiunile, duratele și criteriile de acceptare (acestea vin din reglementarea națională — NTPEE tabel 8 și 81). // Standard european pentru probe de presiune la infrastructura de gaze; în RO prevalează valorile NTPEE (Tabel 8 / 8^1).
- **Praguri:**
  - Valori concrete RO: NTPEE art. 269 tabel 8, art. 273 tabel 81
- **Ofertare:** Probele pe tronsoane (≤500 m, min. 4 h la verificare — art. 272) influențează organizarea de șantier. // Dacă CS impune EN 12327 în paralel cu NTPEE — clarificare care valori prevalează.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.en-standard.eu/bs-en-12327-2012-gas-infrastructure-pressure-testing-commissioning-and-decommissioning-procedures-functional-requirements/ ; https://www.asro.ro

#### Ordin ANRE 89/2018 (NTPEE-2018) — cap. X-XII (îmbinări, verificări, protecție anticorozivă, probe) 
- **🟡 modificat** · ordin_anre · ANRE · ediție: MO 462/05.06.2018; modificat prin Ordin ANRE 2/2023 (MO 67/26.01.2023); forma sintetică verificată la 02.03.2023 · `ofertare_normative.id = 1`
- **Titlu:** Norme tehnice pentru proiectarea, executarea și exploatarea sistemelor de alimentare cu gaze naturale — prevederi de sudură/NDT/izolație/probe
- **Ce cere:** Oțel: îmbinări cap la cap/manșon/niplu; sudori autorizați de organisme abilitate; marcarea sudurilor obligatorie; procedee de sudare certificate; îmbinări clasa de calitate II (indicată în proiect); control vizual + NDT legal aprobat; NDT OBLIGATORIU la conducte/racorduri/instalații subterane din oțel, cu buletine de la laborator autorizat; TOATE sudurile de poziție 100% NDT de personal certificat/autorizat. PE: sudare cap la cap (≥ d75), electrofuziune (orice d), compresie (32–63); aparate de sudură agrementate tehnic + revizii la intervalul producătorului; sudori autorizați; control vizual și, după caz, NDT conform proiectului; interzise corecturile îmbinărilor. Izolație: curățare (de preferință sablare), țevi preizolate sau izolate în stații autorizate; izolare pe șantier doar la îmbinări/reparații/ieșiri din sol (0,5 m). Proces-verbal de lucrări ascunse pentru suduri, izolație, rezistența izolației după umplerea șanțului (buletin laborator autorizat).
- **Praguri:**
  - art. 240 — cap la cap PE doar pentru d ≥ 75 mm; compresie 32–63 mm
  - art. 235 alin. (3) — eclise: 3 buc. (50<Dn≤150), 4 buc. (150<Dn≤300), 6 buc. (Dn>300)
  - art. 269 tabel 8 — subteran: înaltă 15/10 bar, medie 9/6 bar, redusă 4/2 bar, joasă 2/1 bar (rezistență/etanșeitate); PE80 medie: 6/4 bar
  - art. 273 — rezistență 1 h; etanșeitate după tabel 81: 0,1 m³→1 h … ≥4 m³→24 h
  - art. 274 — aparate cu înregistrare continuă, clasă exactitate min. 1,5, verificare metrologică valabilă
  - art. 262 alin. (2) — izolație la ieșirea din sol pe 0,5 m
- **Documente / atestări:**
  - autorizații ISCIR sudori (oțel / operator sudare PEHD)
  - proceduri de sudare aprobate (WPS/WPQR aprobate ISCIR)
  - buletine de examinare nedistructivă de la laborator autorizat
  - PV lucrări ascunse (anexa 7) — suduri, izolație, rezistență izolație
  - buletin verificare calitate izolație (laborator autorizat)
  - diagrame/protocoale înregistrare probe presiune semnate (art. 274)
  - agrement tehnic aparate de sudură PE
- **Verificări / probe:**
  - VT + NDT suduri oțel (100% sudurile de poziție)
  - VT suduri PE; NDT doar dacă proiectul cere
  - verificarea rezistenței de izolație după umplere șanț
  - probe rezistență + etanșeitate în prezența delegatului OSD
  - PE: probe după răcirea ultimei suduri
- **Articole cheie:**
  - art. 235 — tipuri de îmbinări oțel, eclise
  - art. 236 — sudori autorizați, marcare suduri, procedee certificate
  - art. 238 — clasa de calitate II; NDT obligatoriu subteran; 100% suduri de poziție
  - art. 239-240 — PE: aparate agrementate, sudori autorizați, procedee pe diametre
  - art. 245-246 — control suduri PE; interzise corecturile
  - art. 254 — PV lucrări ascunse
  - art. 258-262 — protecție anticorozivă, sablare, izolare în fabrică/stații autorizate
  - art. 268-274 — probe de presiune
  - anexa nr. 2 — lista standardelor (multe ediții depășite: SR EN 12954:2002, SR EN 13067:2013, SR EN 1555:2011, SR EN ISO 15609-1:2005)
- **Modificări:**
  - Ordin ANRE 2/2023 — art. 254 lit. b)-c) (izolație/buletin verificare izolație doar pentru OL), art. 268 alin. (2) (trimitere la Ordin ANRE 156/2020), art. 269 tabel 8, art. 271 alin. (3) nou (doar proba de rezistență la racorduri cu perturbare trafic), art. 272, art. 273 + tabel 81 nou (durata probei de etanșeitate în funcție de volum)
- **Ofertare:** Cuantifică în ofertă: NDT (cel puțin 100% sudurile de poziție + procentul din proiect pentru restul), buletin izolație, probe cu aparate înregistratoare, eclise pe artere de circulație.
- **Clarificări:** NTPEE NU dă procent NDT pentru sudurile curente și NU corelează 'clasa de calitate II' cu SR EN ISO 5817 — dacă proiectul/caietul nu precizează, se cere clarificare (procent NDT, metoda RT/UT, nivel de acceptare).
- **Acces:** public · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/08/Ordinul-ANRE-nr-89-din-2018-actualizat-1.pdf

#### SR EN ISO 3834-1…-5:2021 (+ EN ISO 3834-6:2024) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 3834-2:2021 (ASRO, înlocuiește SR EN ISO 3834-2:2006); ISO 3834-1..-5:2021; EN ISO 3834-6:2024 (ghid de implementare, adoptat CEN 2024) · `ofertare_normative.id = 34`
- **Titlu:** Cerințe de calitate pentru sudarea prin topire a materialelor metalice
- **Ce cere:** Sistem de calitate al fabricantului pentru sudare: -2 cerințe complete, -3 standard, -4 elementare, -5 documente de referință; -6 ghid. Acoperă analiza cerințelor și tehnică, subcontractare, personal (sudori calificați, coordonator sudură), inspecție/NDT, echipamente, WPS, materiale de adaos, tratament termic, trasabilitate, neconformități, calibrare, înregistrări.
- **Documente / atestări:**
  - certificat ISO 3834-2/-3 emis de organism (opțional — nu e cerință legală RO pentru distribuție gaze)
  - WPS/WPQR
  - certificate sudori
  - numire coordonator sudură (ISO 14731)
  - plan de inspecție și încercări (PIF/ITP)
  - registre de trasabilitate
- **Verificări / probe:**
  - audit organism certificare (dacă se cere certificat)
- **Modificări:**
  - SR EN ISO 3834-2:2006 — ANULAT (ASRO)
- **Ofertare:** Nu este cerut de NTPEE; apare în caiete de sarcini Transgaz/proiecte mari. Dacă se cere certificat ISO 3834 ca cerință de calificare — verifică proporționalitatea.
- **Clarificări:** Cerință de certificare 3834-2 pentru rețele de distribuție joasă/medie presiune poate fi restrictivă — întreabă dacă se acceptă 3834-3 sau demonstrarea prin proceduri proprii + ISO 9001.
- **Acces:** platit · Sursă: https://magazin.asro.ro/ro/standard/276136

#### SR EN ISO 9606-1:2017 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 9606-1:2017 (aprobat 29.09.2017, înlocuiește SR EN ISO 9606-1:2014), în vigoare; ISO/DIS 9606 (consolidare părți 1-5) în ancheta publică la ISO · `ofertare_normative.id = 33`
- **Titlu:** Examinarea sudorilor în vederea calificării. Sudare prin topire. Partea 1: Oțeluri
- **Ce cere:** Calificarea sudorului pe variabile esențiale: procedeu (ISO 4063), tip produs (tablă/țeavă), tip îmbinare (cap la cap/de colț), grupa material de adaos, tip consumabil, grosime, diametru exterior, poziție de sudare, detalii de sudare (cu/fără suport, un strat/multistrat). Domeniul de valabilitate rezultă din proba sudată.
- **Praguri:**
  - Revalidare (cl. 9.3) — a) reexaminare la 3 ani; b) la 2 ani, cu 2 suduri din ultimele 6 luni verificate RT/UT/încercări distructive; c) fără termen cât timp sudorul lucrează pentru același producător cu sistem de calitate verificat (sursă secundară)
  - Confirmare a activității la fiecare 6 luni (sursă secundară)
  - Întrerupere activitate > 6 luni în domeniu → certificatul își pierde valabilitatea (sursă secundară)
- **Documente / atestări:**
  - certificat de calificare sudor (ISO 9606-1) cu domeniu de valabilitate
  - confirmare la 6 luni de coordonator/angajator
  - WPS sub care s-a sudat proba
- **Verificări / probe:**
  - VT + RT sau îndoire/rupere pe proba de calificare (nivel B ISO 5817 cu excepții)
- **Modificări:**
  - ISO/DIS 9606.2 — va înlocui ISO 9606-1:2012 și 9606-2..-5 (în dezvoltare)
- **Ofertare:** Verifică domeniul: diametrul minim acoperit (ex. probă D ≥ 25 mm acoperă ≥ 0,5D), poziția (H-L045 pentru țevi fixe), procedeul (111/141/135).
- **Clarificări:** Când caietul cere 'sudori certificați EN ISO 9606-1' și 'autorizați ISCIR' — confirmă că ambele sunt necesare; în RO autorizația ISCIR (PT CR 9-2025) are valabilitate ≤ certificatul de calificare.
- **Acces:** platit · Sursă: https://magazin.asro.ro/ro/standard/255376

#### SR EN ISO 15614-1:2017 (+A1:2019) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: ISO 15614-1:2017 + Amd 1:2019; ISO 15614-1:2017/DAmd 2 și prEN ISO 15614-1 (revizie) în lucru — PT CR 7-2025 citează SR EN ISO 15614-1:2017 · `ofertare_normative.id = 32`
- **Titlu:** Specificația și calificarea procedurilor de sudare pentru materiale metalice. Încercarea procedurii de sudare. Partea 1: Sudare cu arc și cu gaz a oțelurilor
- **Ce cere:** Calificarea WPS prin probă sudată și încercări (VT, RT/UT, PT/MT, tracțiune transversală, îndoire, reziliență, duritate, macro). Două niveluri: 1 (inspirat ASME IX, încercări mai puține) și 2 (extins, domenii restrânse).
- **Praguri:**
  - Nivel 2 = mai multe încercări și domenii de valabilitate mai restrânse decât nivel 1
- **Documente / atestări:**
  - WPQR (raport de calificare a procedurii) — aprobat ISCIR conform PT CR 7-2025
  - WPS derivate din WPQR
- **Verificări / probe:**
  - NDT 100% pe proba de calificare + încercări mecanice
- **Modificări:**
  - A1:2019 (în vigoare)
  - DAmd 2 — calificare separată pe grad de mecanizare la nivelul 2 (draft)
- **Ofertare:** Gazpet trebuie să dețină WPQR-uri care acoperă oțelul (L245/L290/P235GH etc.), grosimile și diametrele din proiect; altfel cost + timp pentru calificare nouă.
- **Clarificări:** Întreabă nivelul cerut (1 sau 2) și dacă se acceptă WPQR existente aprobate ISCIR.
- **Acces:** platit · Sursă: https://www.iso.org/standard/51792.html

#### SR EN ISO 15609-1:2020 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 15609-1:2020 (aprobat 31.03.2020; traducere RO 12.12.2022) — corespunde ISO 15609-1:2019; NTPEE anexa 2 citează SR EN ISO 15609-1:2005 (depășit)
- **Titlu:** Specificația și calificarea procedurilor de sudare. Specificația procedurii de sudare. Partea 1: Sudare cu arc electric
- **Ce cere:** Conținutul WPS: material de bază, procedeu, geometrie rost, poziție, consumabile, parametri electrici, preîncălzire/temperatură între treceri, tratament termic, gaz de protecție, tehnică.
- **Documente / atestări:**
  - WPS pentru fiecare tip de îmbinare din proiect, disponibil la locul de muncă
- **Ofertare:** WPS-urile se depun de regulă la PCCVI / la începerea lucrării; uneori cerute în propunerea tehnică.
- **Clarificări:** Dacă caietul cere WPS 'aprobat de proiectant/beneficiar' — clarifică fluxul și termenul de aprobare.
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2023/02/BS-01-2023.pdf

#### SR EN ISO 14731 (ISO 14731:2019) · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (adoptare CEN/ISO) · ediție: ISO 14731:2019 — ediția SR neconfirmată; în RO funcția echivalentă reglementată e RTS (responsabil tehnic cu sudura, atestat ISCIR)
- **Titlu:** Coordonarea sudării. Sarcini și responsabilități
- **Ce cere:** Definește sarcinile coordonatorului de sudură (analiza cerințelor, WPS, calificări, supraveghere, inspecție, neconformități) și nivelurile de cunoștințe (comprehensive/specific/basic — corelate cu IWE/IWT/IWS).
- **Documente / atestări:**
  - decizie numire coordonator sudură / RTS
  - diplomă IWE/IWT/IWS sau atestat RTS ISCIR
- **Ofertare:** Personal cheie posibil cerut: 'responsabil tehnic cu sudura' — RTS atestat ISCIR e cerut și de PT CR 9-2025 la autorizarea sudorilor.
- **Clarificări:** Cerința 'IWE' pentru lucrări de distribuție joasă presiune poate fi disproporționată — întreabă dacă RTS ISCIR e echivalent.
- **Acces:** platit · Sursă: https://www.iso.org/standard/74183.html

#### SR EN ISO 14732:2025 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 14732:2025 înlocuiește SR EN ISO 14732:2014 (Buletinul Standardizării 02/2026)
- **Titlu:** Personal pentru sudare. Calificarea operatorilor sudori și a reglorilor pentru sudarea mecanizată și automată a materialelor metalice
- **Ce cere:** Calificarea operatorilor de sudare mecanizată/orbitală/automată (relevant la sudare orbitală sau automată de conducte).
- **Documente / atestări:**
  - certificat calificare operator sudare mecanizată
- **Modificări:**
  - SR EN ISO 14732:2014 — anulat
- **Ofertare:** Relevant doar dacă se folosește sudare mecanizată (ex. conducte mari).
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2026/02/BS-02-2026.pdf

#### SR EN 12732+A1:2014 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 12732:2013+A1:2014 (citat în NTPEE anexa 2, poz. 37) — ediție curentă CEN neconfirmată
- **Titlu:** Infrastructura pentru gaze. Sudarea conductelor de oțel. Cerințe funcționale
- **Ce cere:** Standardul specific de sudare a conductelor de oțel pentru infrastructura de gaze: calificări, WPS, inspecție, extinderea NDT și niveluri de acceptare în funcție de presiunea de operare (MOP) și diametru.
- **Praguri:**
  - Procentele NDT pe clase de MOP din EN 12732 NU au putut fi verificate din sursă publică — de cerut în caietul de sarcini / de verificat în standard
- **Documente / atestări:**
  - WPS/WPQR
  - certificate sudori
  - rapoarte NDT
- **Ofertare:** Când NTPEE tace asupra procentului NDT, EN 12732 este referința tehnică logică pentru distribuție — de procurat standardul.
- **Clarificări:** Șablon: întrebi dacă extinderea NDT se stabilește conform SR EN 12732+A1:2014 pentru MOP-ul proiectului.
- **Acces:** platit · Sursă: https://amstal.ro/wp-content/uploads/2018/12/NTPEE-2018-Ordin-ANRE-89-2018.pdf

#### SR EN 13067 (EN 13067:2020) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 13067:2020 (CEN); prEN 13067 rev în lucru (Buletinul Standardizării 07/2026); NTPEE anexa 2 citează SR EN 13067:2013 (depășit) · `ofertare_normative.id = 44`
- **Titlu:** Personal pentru sudarea materialelor plastice. Calificarea sudorilor. Ansambluri sudate de materiale termoplastice
- **Ce cere:** Examinarea teoretică și practică a sudorilor de termoplaste pe procedee: cap la cap cu element încălzit, electrofuziune, extrudare, gaz cald, solvent.
- **Praguri:**
  - Valabilitatea certificatului EN 13067 — neverificată din sursă publică; în RO autorizația ISCIR PEHD = max. 2 ani (PT CR 9-2025 art. 49)
- **Documente / atestări:**
  - certificat calificare sudor termoplaste (EN 13067)
  - în RO: autorizație ISCIR operator sudare PEHD (PT CR 9-2025)
- **Ofertare:** Operatorii PE propuși trebuie să aibă autorizație ISCIR PEHD valabilă, pe procedeul cerut (BW/electrofuziune).
- **Clarificări:** Dacă AC cere certificat EN 13067 în plus față de ISCIR — întreabă dacă autorizația ISCIR PT CR 9 este acceptată ca echivalentă.
- **Acces:** platit · Sursă: https://standards.iteh.ai/catalog/standards/cen/b04c62fc-543d-4ee9-9844-4d22065acfad/en-13067-2020

#### DVS 2207-1:2015-08 
- **🟢 în vigoare** · ghid · DVS (Deutscher Verband für Schweißen) · ediție: ediția 2015-08 (ultima identificată)
- **Titlu:** Sudarea termoplastelor — sudarea cu element încălzit a țevilor, pieselor și plăcilor din PE
- **Ce cere:** Parametrii de sudare cap la cap PE: temperatura elementului încălzit, presiune de egalizare/bordurare, timp de încălzire, timp de schimbare (max.), timp de creștere a presiunii, timp de răcire sub presiune — în tabele pe grosimea peretelui; condiții de mediu, pregătire (frezare, aliniere), protocol de sudare.
- **Praguri:**
  - Temperatura elementului încălzit pentru PE: ~200–220 °C funcție de grosime (sursă secundară)
  - Presiune de egalizare și sudare ~0,15 N/mm², presiune la încălzire ~0,01–0,02 N/mm² (sursă secundară — de verificat în tabelele DVS și fișa producătorului țevii)
- **Documente / atestări:**
  - protocol de sudare cap la cap (parametri înregistrați)
  - jurnal de sudură
  - fișă de parametri a aparatului
- **Verificări / probe:**
  - VT cordon (formă, înălțime, crestătură k>0)
  - încercare la tracțiune / îndoire pe probe (când se cere)
- **Ofertare:** Referința practică uzuală în RO pentru sudarea cap la cap (citată în specificații operator și cursuri ISCIR PEHD).
- **Clarificări:** Dacă caietul cere ISO 21307 (proceduri diferite: single low pressure / dual low / single high) — clarifică ce procedură e acceptată.
- **Acces:** platit · Sursă: https://www.dinmedia.de/en/technical-rule/dvs-2207-1/237820352

#### ISO 21307:2017 
- **🟢 în vigoare** · standard · ISO · ediție: ediția 3 (2017), reconfirmată 2023 (nicio ediție nouă identificată)
- **Titlu:** Țevi și fitinguri din plastic. Proceduri de îmbinare cap la cap prin fuziune pentru sisteme PE
- **Ce cere:** Trei proceduri de fuziune cap la cap (presiune joasă simplă, presiune joasă dublă, presiune înaltă simplă), parametrii, pregătirea și evaluarea calității îmbinării.
- **Documente / atestări:**
  - procedura de sudare cap la cap adoptată (WPS PE)
  - protocol de sudare
- **Ofertare:** Rar cerut explicit în RO; apare în proiecte cu finanțare internațională.
- **Clarificări:** Vezi DVS 2207-1.
- **Acces:** platit · Sursă: https://www.iso.org/standard/63773.html

#### ISO 12176-2:2025 / -3 / -4 / -5 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ISO · ediție: ISO 12176-2:2025 publicat (listă ISO în Buletinul Standardizării 07/2025); edițiile -3/-4/-5 neconfirmate
- **Titlu:** Țevi și fitinguri din plastic. Echipamente pentru sudarea sistemelor PE — Partea 2: electrofuziune; -3: card de identificare operator; -4: codificarea trasabilității; -5: codificare 2D
- **Ce cere:** Cerințe pentru aparatele de electrofuziune (control energie, înregistrare, cititor cod de bare) și codurile de trasabilitate a fitingurilor/sudurilor.
- **Praguri:**
  - Delgaz ST 505 (A5/2023): memorie min. 500 suduri, export PDF, USB, cititor cod de bare, introducere operator/locație/dată/oră, funcționare -20…+50 °C
- **Documente / atestări:**
  - protocol de sudare electrofuziune descărcat din aparat
  - certificat revizie/calibrare aparat
- **Ofertare:** Aparatele din dotare trebuie să permită trasabilitatea (cod operator, cod fiting, export protocol) — cerință tipică operator.
- **Clarificări:** Întreabă formatul în care se predau protocoalele de sudură (PDF/fișier aparat) și dacă se cere jurnal centralizat.
- **Acces:** platit · Sursă: https://delgaz.ro/getattachment/136a9e0d-4ab9-4b18-ad59-6311715e28ee/ST-505-APARATE-DE-SUDURA-in-EF-2023.pdf

#### SR EN 1555-1…-4:2025 (+ SR EN 1555-5) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN 1555-1:2025, -2:2025, -3:2025, -4:2025 înlocuiesc edițiile 2021 (Buletinul Standardizării 12/2025; anulări în BS 05/2026); EN 1555-x:2025 doa 2026-01-31; partea 5 — ediție neconfirmată · `ofertare_normative.id = 43`
- **Titlu:** Sisteme de conducte de materiale plastice pentru distribuția combustibililor gazoși. Polietilenă (PE)
- **Ce cere:** Material (PE80, PE100, PE100-RC), țevi (SDR 11, SDR 17/17,6 etc., toleranțe, marcare), fitinguri (electrofuziune, cap la cap, șei), robinete, aptitudine de utilizare a sistemului.
- **Praguri:**
  - Distrigaz ST-TGPHD: data fabricației ≤ 3 luni înainte de livrare; colaci 32–90 mm la 100 m presurizați 1 bar; bare 110–630 mm la 12 m; durată utilizare ≥ 50 ani; garanție ≥ 36 luni
  - SDR = dn/en
- **Documente / atestări:**
  - declarație de conformitate
  - certificat de conformitate / agrement tehnic + aviz CTPC
  - raport inspecție 2.2 și certificat 3.1 (SR EN 10204) — cerut de Distrigaz și pentru PE
  - fișă tehnică material (cod rășină)
  - rapoarte încercări de tip (RCP S4, SCG crestătură)
- **Verificări / probe:**
  - recepție calitativă la livrare: marcaj, certificat 3.1, dimensiuni măsurate la ≥24 h de la fabricație
  - verificare compatibilitate PE100 fiting / PE80 țeavă (NTPEE art. 244)
- **Modificări:**
  - SR EN 1555-1..-4:2021 — anulate/înlocuite
  - NTPEE anexa 2 citează SR EN 1555:2011/2013 (depășite)
  - Specificațiile Distrigaz Sud Rețele (2023) citează încă SR EN 1555-1/-2:2021
- **Ofertare:** Prețul țevii depinde de clasa PE100 vs PE100-RC și SDR; caietul trebuie să le precizeze. Ediția standardului pe certificat (2021 vs 2025) poate genera neconformitate formală.
- **Clarificări:** Dacă caietul cere SR EN 1555:2021 — întreabă dacă se acceptă produse certificate pe ediția 2025 (și invers, în perioada de tranziție).
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2025/12/BS-12-2025.pdf

#### SR EN 12007-1…-5 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: -1:2012, -2:2012 (PE, MOP ≤ 10 bar), -3:2015 (oțel), -4:2012 (renovare), -5:2024 (branșamente; înlocuiește SR EN 12007-5:2014 — BS 01/2025) · `ofertare_normative.id = 30`
- **Titlu:** Infrastructura pentru gaze. Conducte pentru presiune maximă de operare ≤ 16 bar
- **Ce cere:** Cerințe funcționale de proiectare/construcție/încercare: -2 PE (îmbinări prin fuziune, sudori calificați, înregistrarea parametrilor de sudură, distanțe, pozare); -3 oțel (sudare, NDT, izolație, protecție catodică); -5 branșamente.
- **Documente / atestări:**
  - înregistrări sudură
  - rapoarte probe
  - documentație as-built
- **Modificări:**
  - SR EN 12007-5:2014 → SR EN 12007-5:2024
- **Ofertare:** Referință funcțională; cerințele concrete RO sunt în NTPEE.
- **Clarificări:** Partea -5:2024 nouă — verifică dacă proiectul de branșamente o citează.
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2025/02/BS-01-2025.pdf

#### SR EN ISO 17635:2025 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 17635:2025 înlocuiește SR EN ISO 17635:2017 (BS 11/2025); citat de PT CR 7/9-2025 · `ofertare_normative.id = 46`
- **Titlu:** Examinări nedistructive ale sudurilor. Reguli generale pentru materiale metalice
- **Ce cere:** Alegerea metodei NDT în funcție de material, grosime, tip îmbinare și nivel de calitate; corelarea nivelului de calitate (ISO 5817 B/C/D) cu tehnica de examinare și nivelul de acceptare din standardele pe metodă (RT: ISO 10675-1; UT: ISO 11666; VT: ISO 5817 direct).
- **Praguri:**
  - Corelare uzuală (de verificat în anexa standardului, ediția 2025): ISO 5817 B → RT nivel acceptare 1 / UT nivel 2; C → RT 2 / UT 3; D → RT 3 / UT 3
- **Modificări:**
  - SR EN ISO 17635:2017 — anulat
- **Ofertare:** Un caiet care spune doar 'NDT conform SR EN ISO 17635' fără nivel de calitate și extindere e incomplet.
- **Clarificări:** Cere: nivel de calitate (B/C/D), metodă (RT/UT), extindere (%) și criteriu de alegere a sudurilor examinate.
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2025/12/BS-11-2025.pdf

#### SR EN ISO 5817:2023 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 5817:2023 (înlocuiește SR EN ISO 5817:2015 — anulat) · `ofertare_normative.id = 37`
- **Titlu:** Sudare. Îmbinări sudate prin topire din oțel, nichel, titan și aliajele acestora. Niveluri de calitate pentru imperfecțiuni
- **Ce cere:** Trei niveluri de calitate: B (sever), C (mediu), D (moderat), cu limite pe tip de imperfecțiune (fisuri, pori, lipsă de topire, crestături, supraînălțare, dezaliniere etc.).
- **Documente / atestări:**
  - raport VT/NDT care declară nivelul de acceptare
- **Modificări:**
  - SR EN ISO 5817:2015 — anulat
- **Ofertare:** NTPEE cere 'clasa de calitate II' — noțiune din vechile prescripții RO, fără corelare oficială cu B/C/D.
- **Clarificări:** Șablon: 'Vă rugăm precizați nivelul de calitate conform SR EN ISO 5817:2023 corespunzător clasei de calitate II (NTPEE art. 238).'
- **Acces:** platit · Sursă: https://magazin.asro.ro/ro/standard/281092

#### SR EN ISO 17636-1:2022 / SR EN ISO 17636-2:2023 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: -1: SR EN ISO 17636-1:2022 (aprobat 30.09.2022, înlocuiește 2013); -2: SR EN ISO 17636-2:2023 (înlocuiește 2013, BS 04/2023) · `ofertare_normative.id = 35`
- **Titlu:** Examinări nedistructive ale sudurilor. Examinare radiografică. Partea 1: film; Partea 2: detectori digitali
- **Ce cere:** Tehnici RT clasa A (de bază) / B (îmbunătățită); nu dă criterii de acceptare (→ ISO 10675-1).
- **Praguri:**
  - Preț ASRO SR EN ISO 17636-1:2022: 235,60 Lei
- **Documente / atestări:**
  - buletin RT cu identificarea sudurii, tehnica, clasa A/B, IQI, nivel acceptare, operator autorizat
- **Ofertare:** Clasa B de tehnică e mai scumpă — de precizat în caiet.
- **Clarificări:** Întreabă clasa de tehnică RT (A/B) și dacă RT digital (partea 2) e acceptat.
- **Acces:** platit · Sursă: https://magazin.asro.ro/ro/standard/279973

#### SR EN ISO 10675-1:2022 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 10675-1:2022 (citat în PT CR 7/9-2025)
- **Titlu:** Examinări nedistructive ale sudurilor. Niveluri de acceptare pentru examinarea radiografică. Partea 1: Oțel, nichel, titan și aliajele acestora
- **Ce cere:** Niveluri de acceptare RT 1, 2, 3.
- **Ofertare:** 
- **Clarificări:** Nivel de acceptare RT trebuie să decurgă din nivelul de calitate ISO 5817.
- **Acces:** platit · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-9-2025.pdf

#### SR EN ISO 17640:2019 / SR EN ISO 11666:2018 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 17640:2019 (ISO 17640:2018); SR EN ISO 11666:2018 — ambele citate în PT CR 7/9-2025
- **Titlu:** Examinare cu ultrasunete — tehnici, niveluri de testare, evaluare / niveluri de acceptare
- **Ce cere:** UT: niveluri de testare A–D; acceptare UT niveluri 2 și 3. Atenție: EN 17640 (fără ISO) e alt standard.
- **Ofertare:** 
- **Clarificări:** UT e practic doar pentru grosimi ≥ 8 mm; pentru țevi subțiri de distribuție se cere de regulă RT — de clarificat dacă se acceptă UT.
- **Acces:** platit · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-7-2025.pdf

#### SR EN ISO 17637:2017 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 17637:2017 (ISO 17637:2016) — citat în PT CR 7/9-2025 · `ofertare_normative.id = 36`
- **Titlu:** Examinări nedistructive ale sudurilor. Examinarea vizuală a îmbinărilor sudate prin topire
- **Ce cere:** Condiții de examinare vizuală (iluminare ≥ 350 lx minim, recomandat 500 lx; acces ≤ 600 mm, unghi ≥ 30° — valori din surse secundare), înregistrare; acceptare direct după ISO 5817.
- **Praguri:**
  - Iluminare și distanță — sursă secundară, de verificat în standard
- **Documente / atestări:**
  - raport VT pentru fiecare sudură / lot
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** platit · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-7-2025.pdf

#### SR EN ISO 9712:2022 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 9712:2022 (ISO 9712:2021) — citat în PT CR 6-2025 · `ofertare_normative.id = 45`
- **Titlu:** Examinări nedistructive. Calificarea și certificarea personalului NDT
- **Ce cere:** Niveluri 1/2/3; examene generale/specifice/practice; experiență industrială; acuitate vizuală anuală; certificare cu reînnoire și recertificare.
- **Praguri:**
  - Certificat valabil max. 5 ani, apoi reînnoire; recertificare la 10 ani (sursă secundară)
  - În RO, autorizația ISCIR NDT: 2 ani nivel 1/2; 5 ani nivel 3 (PT CR 6-2025 art. 22)
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** platit · Sursă: https://iscir.ro/wp-content/uploads/2026/08/PT-CR-6-2025.pdf

#### Procente NDT suduri oțel — conducte distribuție gaze (sinteză) 
- **⚪ neconfirmat** · ghid · — · ediție: NTPEE 2018 cu Ord. 2/2023 · `ofertare_normative.id = 1`
- **Titlu:** Extinderea controlului nedistructiv: ce spune efectiv cadrul normativ
- **Ce cere:** NTPEE cere: NDT obligatoriu la conductele/racordurile/instalațiile subterane din oțel (art. 238 alin. 4) și 100% la sudurile de poziție (alin. 5); curbe din segmente Dn>350 controlate integral (art. 208 lit. d). NU stabilește un procent pentru restul sudurilor — acesta vine din proiect/caiet de sarcini/specificația operatorului (sau din SR EN 12732 dacă e invocat).
- **Praguri:**
  - 100% suduri de poziție (NTPEE art. 238 alin. 5)
  - Procent pentru sudurile curente: NEDEFINIT în NTPEE — nu am găsit specificație publică Delgaz/Distrigaz care să-l fixeze
- **Ofertare:** Nu presupune 10% sau 100% — cere confirmarea în clarificări; diferența de cost RT e mare.
- **Clarificări:** Sursă de clarificare #1 la oțel.
- **Acces:** public · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/08/Ordinul-ANRE-nr-89-din-2018-actualizat-1.pdf

#### SR EN ISO 8501-1:2007 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 8501-1:2007 (citat de Distrigaz ST-TOLNP 2023); SR EN ISO 8501-3:2025 (pregătire suduri/muchii) înlocuiește 8501-3:2007 (BS 10/2025)
- **Titlu:** Pregătirea suporturilor de oțel înaintea aplicării vopselelor. Evaluarea vizuală a curățeniei suprafeței. Partea 1: grade de rugină și de pregătire
- **Ce cere:** Grade de rugină A–D; grade de pregătire Sa 1, Sa 2, Sa 2½, Sa 3 (sablare), St 2, St 3 (manual/mecanic), Fl (flacără).
- **Praguri:**
  - Distrigaz ST-TOLNP: sablare Sa 2½ înainte de izolația 3LPE
- **Verificări / probe:**
  - comparare vizuală cu fotografiile de referință ale standardului
- **Ofertare:** 
- **Clarificări:** La izolația îmbinărilor pe șantier se cere de regulă Sa 2½ (dacă sablare) sau St 3 — clarifică ce se acceptă (sablarea pe șantier e scumpă).
- **Acces:** platit · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/07/ST-TOLNP-Tevi-din-otel-neizolate-si-preizolate-pentru-sisteme-de-distributie-gaze-naturale.pdf

#### SR EN ISO 8503-1…-5 / SR EN ISO 8502-x · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (adoptare CEN/ISO) · ediție: 8502-5:2025 și 8502-15:2025 noi (BS 2025-2026); restul edițiilor neconfirmate; prEN ISO 8503-5 și prEN ISO 8502-2/-6 în revizie (2026)
- **Titlu:** Rugozitatea suprafețelor sablate (8503) / evaluarea curățeniei — praf, săruri solubile, condens (8502)
- **Ce cere:** 8503: profil fin/mediu/grosier (comparator); 8502-3: praf (bandă adezivă); 8502-6/-9: săruri solubile (Bresle/conductivitate); 8502-4: risc de condens (punct de rouă).
- **Verificări / probe:**
  - măsurare profil rugozitate
  - test praf
  - test săruri
  - punct de rouă (temperatura suprafeței ≥ punct de rouă + 3 °C — practică uzuală)
- **Ofertare:** 
- **Clarificări:** Specificațiile producătorilor de manșoane/benzi dau rugozitatea și sarea admisă — cere fișa sistemului aprobat de OSD.
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2026/01/BS-01-2026.pdf

#### SR EN ISO 12944-1…-9 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (adoptare CEN/ISO) · ediție: ISO 12944-1..-8:2017/2018, -9:2018 — edițiile SR neconfirmate. ATENȚIE: 'SR EN 12944-3:2025' din buletinele ASRO e alt standard (fără ISO), nu seria 12944 de vopsele
- **Titlu:** Vopsele și lacuri. Protecția anticorozivă a structurilor din oțel prin sisteme de vopsire
- **Ce cere:** Categorii de corozivitate atmosferică C1–C5 și CX, imersie Im1–Im4; durabilitate L / M / H / VH; selecția sistemelor de vopsire (partea 5), încercări de laborator (6), execuție (7), specificație (8).
- **Praguri:**
  - Durabilitate (ediția 2017): L ≤ 7 ani, M 7–15, H 15–25, VH > 25 ani (sursă secundară)
- **Ofertare:** Relevant pentru conducte supraterane (NTPEE art. 257 — grunduire + vopsire după probe), stații/posturi de reglare.
- **Clarificări:** Cere categoria de corozivitate și durabilitatea vizate + numărul de straturi/grosime DFT, dacă caietul spune doar 'vopsire'.
- **Acces:** platit · Sursă: https://www.iso.org/standard/64833.html

#### SR EN ISO 21809-1:2019 (ISO 21809-1:2018) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 21809-1:2019 (citat Distrigaz ST-TOLNP 2023); ISO 21809-2:2026 și -4:2026 publicate; SR EN ISO 21809-2:2026 înlocuiește 2015 (BS 04/2026) · `ofertare_normative.id = 40`
- **Titlu:** Industria petrolului și gazelor. Acoperiri exterioare pentru conducte îngropate sau imersate. Partea 1: acoperiri poliolefinice (3LPE/3LPP)
- **Ce cere:** Izolație în fabrică 3 straturi (epoxi + adeziv + PE/PP), clase A/B/C (material), clase de grosime, procedura de aplicare (APS), încercări (aderență, cojire, impact, holiday detection, catodic disbondment), reparații, marcare.
- **Praguri:**
  - Distrigaz (ST-TOLNP): clasa B2 grosime minimă 1,8 / 2,1 / 2,5 mm pentru Pm ≤15 / 15–50 / 50–130 kg/m; B3: 2,3 / 2,7 / 3,1 mm
  - capete neizolate 15 cm protejate anticoroziv; -40…+60 °C; țeavă ≤ 24 luni și izolație ≤ 6 luni de la fabricație la livrare
- **Documente / atestări:**
  - certificat 3.1 SR EN 10204 pentru țeava de oțel ȘI pentru izolație
  - Specificația Procedurii de Aplicare (cap. 9.2)
  - declarație de conformitate izolator
- **Verificări / probe:**
  - holiday detection 100% în fabrică
  - grosime
  - aderență/cojire
- **Ofertare:** B2 vs B3 schimbă prețul țevii preizolate; verifică ce clasă cere proiectul.
- **Clarificări:** Dacă proiectul cere 'izolație întărită/foarte întărită' (terminologie veche STAS) — cere echivalarea cu clasa SR EN ISO 21809-1 (B2/B3).
- **Acces:** platit · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/07/ST-TOLNP-Tevi-din-otel-neizolate-si-preizolate-pentru-sisteme-de-distributie-gaze-naturale.pdf

#### EN ISO 21809-3:2016 + A1:2020 
- **⚪ neconfirmat** · standard · ASRO (adoptare CEN/ISO) · ediție: ISO 21809-3:2016 + Amd 1:2020 în vigoare; ISO/FDIS 21809-3 (pagina ISO actualizată 21.09.2026) va înlocui ediția 2016; ediția SR neconfirmată (nu apare pe magazin.asro.ro în căutare) · `ofertare_normative.id = 40`
- **Titlu:** Acoperiri exterioare pentru conducte îngropate sau imersate. Partea 3: acoperiri pentru îmbinări de șantier (field joint coatings)
- **Ce cere:** Clasificare și cerințe pentru sisteme de izolare a îmbinărilor sudate pe șantier (benzi, manșoane termocontractabile, epoxi lichid, FBE etc.): calificare sistem (PQT), procedură de aplicare (APS), probă pe șantier (APQT), inspecție și încercări.
- **Documente / atestări:**
  - fișă tehnică sistem + certificare conform 21809-3 sau EN 12068
  - APS/procedură aplicare producător
  - raport holiday test pe îmbinări
  - PV lucrări ascunse izolație
- **Ofertare:** Sistemul de izolare a îmbinărilor trebuie compatibil cu izolația de fabrică (3LPE) și aprobat de OSD.
- **Clarificări:** Întreabă dacă se acceptă manșoane certificate EN 12068 sau se cere strict EN ISO 21809-3 (clasa/ tipul).
- **Acces:** platit · Sursă: https://www.iso.org/standard/91857.html

#### SR EN 12068:2002 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN 12068:2002 — 'În vigoare' pe magazin.asro.ro (aprobat 26.09.2002, versiune RO 31.08.2008); EN 12068:1998 (DIN EN 12068:1999). NU a fost găsită dovadă că e înlocuit de EN ISO 21809-3 · `ofertare_normative.id = 38`
- **Titlu:** Protecție catodică. Acoperiri organice exterioare pentru protecția împotriva coroziunii conductelor de oțel îngropate sau imersate în conjuncție cu protecția catodică. Benzi și materiale contractibile
- **Ce cere:** Cerințe funcționale și metode de încercare pentru benzi și materiale termocontractabile; clase de solicitare mecanică (A/B/C) și temperatură (ex. C50 = clasa C la 50 °C).
- **Praguri:**
  - Preț ASRO: 263,22 Lei (58 pagini)
  - Tensiunea de încercare la holiday — NU a putut fi verificată din sursă publică
- **Verificări / probe:**
  - test cu scânteie (holiday detection) pe îmbinări
  - cojire, impact, penetrare (în calificarea produsului)
- **Ofertare:** Benzi/manșoane 'EN 12068 C50' sunt uzuale la îmbinări pe distribuție.
- **Clarificări:** Tabela ofertare_normative are anul greșit (1999).
- **Acces:** platit · Sursă: https://magazin.asro.ro/ro/standard/30458

#### DIN 30672 · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · DIN · ediție: ediție curentă neconfirmată (DIN 30672:2000 identificată; tabela notează -1/-2:2019 — NECONFIRMAT) · `ofertare_normative.id = 39`
- **Titlu:** Acoperiri organice exterioare pentru protecția anticorozivă a conductelor îngropate/imersate, temperaturi de operare continuă până la 50 °C — benzi și materiale contractibile
- **Ce cere:** Similar EN 12068, pentru conducte fără sau cu protecție catodică, la ≤ 50 °C; clase de solicitare.
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** platit · Sursă: https://standards.globalspec.com/std/831941/din-30672

#### SR EN 12954 (EN 12954:2019) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 12954:2019 înlocuiește EN 12954:2001; ediția SR 2019 neconfirmată; NTPEE anexa 2 citează SR EN 12954:2002 (depășit) · `ofertare_normative.id = 41`
- **Titlu:** Principii generale ale protecției catodice a structurilor metalice îngropate sau imersate pe uscat
- **Ce cere:** Principii PC pentru structuri îngropate/în apă dulce: criterii de protecție (potențial de protecție sau deplasare catodică de 100 mV), interferențe, proiectare, punere în funcțiune, monitorizare.
- **Praguri:**
  - Criteriu: potențial de protecție sau deplasare catodică 100 mV (din descrierea standardului)
- **Ofertare:** Se aplică structurilor în general; pentru conducte specific → EN ISO 15589-1.
- **Clarificări:** Clarifică dacă lucrarea include PC (stație, anozi, prize) sau doar posturi de măsurare (NTPEE art. 263).
- **Acces:** platit · Sursă: https://www.en-standard.eu/bs-en-12954-2019-general-principles-of-cathodic-protection-of-buried-or-immersed-onshore-metallic-structures/

#### EN ISO 15589-1:2026 (anterior EN ISO 15589-1:2017) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: EN ISO 15589-1:2026 (ISO 15589-1:2026) adoptat CEN — doa 2026-10-31, dop 2027-01-31 (BS 08/2026); SR EN ISO 15589-1:2017 în vigoare până la preluare; SR EN ISO 15589-2:2024 (offshore) înlocuiește 2014 · `ofertare_normative.id = 42`
- **Titlu:** Industriile petrolului, petrochimiei și gazelor naturale. Protecția catodică a sistemelor de conducte. Partea 1: conducte pe uscat
- **Ce cere:** Proiectarea, instalarea, punerea în funcțiune, operarea și monitorizarea PC pentru conducte pe uscat; criterii de potențial, măsurători, interferență AC/DC; relație cu EN 12954 (general) — 15589-1 e standardul specific de conducte.
- **Modificări:**
  - 2026 — ediție nouă ISO/CEN; ediția SR încă de publicat
- **Ofertare:** Lucrări PC/Transgaz; pentru distribuție OSD-ul cere de regulă doar posturi de măsurare + piese electroizolante.
- **Clarificări:** Dacă caietul cere ediția 2017 — în ofertă poți menționa conformitatea cu ediția 2026.
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2026/09/BS-08-2026.pdf

#### SR EN 13509 (EN 13509:2003) · ⚠️ neverificat integral
- **⚪ neconfirmat** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 13509:2003 — ediția SR și eventuală revizie neconfirmate
- **Titlu:** Tehnici de măsurare pentru protecția catodică
- **Ce cere:** Metode de măsurare a potențialului (inclusiv eliminarea căderii IR — on/off, cupoane), curent, rezistivitate sol, interferență; DCVG/CIPS ca metode de inspecție a izolației.
- **Verificări / probe:**
  - măsurători potențial conductă/sol (NTPEE art. 264 — diagramele se anexează la cartea tehnică)
  - DCVG/CIPS/PCM pentru localizarea defectelor de izolație (dacă proiectul cere)
- **Ofertare:** 
- **Clarificări:** Dacă recepția cere DCVG/PCM — cere precizarea metodei, lungimii și a criteriului de acceptare.
- **Acces:** platit · Sursă: https://www.iso.org/

#### SR EN 1594:2024 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN 1594:2024 înlocuiește SR EN 1594:2014 (BS 05/2024; traducere RO 'NCT' în BS 10/2025); EN 1594:2024/prA1 în lucru (BS 07/2025) · `ofertare_normative.id = 29`
- **Titlu:** Infrastructura pentru gaze. Conducte pentru presiune maximă de operare peste 16 bar. Cerințe funcționale
- **Ce cere:** Transport > 16 bar: proiectare, materiale, sudare, NDT, probe hidraulice, protecție anticorozivă.
- **Ofertare:** Relevant pentru lucrări Transgaz/înaltă presiune.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2024/05/BS-05-2024.pdf

#### SR EN 15001-1:2023 / SR EN 15001-2:2023 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: ambele 2023, înlocuiesc SR EN 15001-1/-2:2009 (BS 09/2023)
- **Titlu:** Infrastructura pentru gaze. Instalații de gaze cu presiune de operare > 0,5 bar (industrial) și > 5 bar (industrial și neindustrial). Partea 1: cerințe funcționale; Partea 2: punere în funcțiune, operare, mentenanță
- **Ce cere:** Instalații de utilizare de presiune mai mare la consumatori industriali: materiale, îmbinări, sudare, încercări, punere în funcțiune.
- **Modificări:**
  - SR EN 15001-1:2009, -2:2009 — înlocuite
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2023/09/BS-09-2023.pdf

#### SR EN 1775:2008 (EN 1775:2007) · ⚠️ neverificat integral
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 1775:2007 — nicio ediție nouă găsită; SR EN 1775:2008 citat în NTPEE anexa 2
- **Titlu:** Alimentări cu gaze. Conducte de gaze pentru clădiri. Presiune maximă de operare ≤ 5 bar. Recomandări funcționale
- **Ce cere:** Instalații interioare: materiale, îmbinări, încercări, punere în funcțiune.
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** platit · Sursă: https://amstal.ro/wp-content/uploads/2018/12/NTPEE-2018-Ordin-ANRE-89-2018.pdf

#### SR EN ISO 3183:2020 (ISO 3183:2019) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN ISO 3183:2020 (citat Distrigaz ST-TOLNP 2023)
- **Titlu:** Industriile petrolului și gazelor naturale. Țevi din oțel pentru sisteme de transport prin conducte
- **Ce cere:** Țevi PSL 1 / PSL 2, grade L245 (B), L290 (X42), L360 etc.; compoziție, încercări, toleranțe, marcare.
- **Praguri:**
  - Distrigaz: PSL 1, grad L245 sau B; toleranța grosimii cf. API 5L tabel 11
- **Documente / atestări:**
  - certificat de inspecție 3.1 (SR EN 10204) — obligatoriu la Distrigaz
  - declarație de conformitate
- **Ofertare:** Grad/PSL determină prețul și WPQR-ul necesar.
- **Clarificări:** Proiectele vechi cer 'OL 37 / STAS 715' sau 'EN 10208-2' — cere echivalarea cu SR EN ISO 3183 L245 PSL1/PSL2.
- **Acces:** platit · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/07/ST-TOLNP-Tevi-din-otel-neizolate-si-preizolate-pentru-sisteme-de-distributie-gaze-naturale.pdf

#### SR EN 10208-2 · ⚠️ neverificat integral
- **🔴 înlocuit** · standard · ASRO (adoptare CEN/ISO) · ediție: EN 10208-2:2009 — retras la CEN, înlocuit de EN ISO 3183 (informație de specialitate; nu am verificat fișa ASRO) · înlocuit de: SR EN ISO 3183
- **Titlu:** Țevi de oțel pentru conducte de fluide combustibile — clasa B
- **Ce cere:** —
- **Ofertare:** 
- **Clarificări:** Dacă apare în caiet, cere acceptarea SR EN ISO 3183 PSL2.
- **Acces:** platit · Sursă: https://www.iso.org/standard/72001.html

#### SR EN 10216-x / SR EN 10217-x 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN 10216-2:2024 înlocuiește SR EN 10216-2+A1:2020 (BS 01/2025; citat în PT CR 7/9-2025); prEN 10216-1/-3/-4 rev în lucru (2026); 10217 — neconfirmat
- **Titlu:** Țevi de oțel fără sudură (10216) / sudate (10217) pentru utilizare la presiune
- **Ce cere:** Țevi pentru presiune (P235GH, P265GH etc.) — folosite la stații/posturi de reglare, instalații.
- **Documente / atestări:**
  - certificat 3.1 / 3.2 SR EN 10204
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.asro.ro/wp-content/uploads/2025/02/BS-01-2025.pdf

#### SR EN 10204:2005 (EN 10204:2004) 
- **🟢 în vigoare** · standard · ASRO (adoptare CEN/ISO) · ediție: SR EN 10204:2005 în vigoare; prEN 10204 rev în lucru (BS 07/2026)
- **Titlu:** Produse metalice. Tipuri de documente de inspecție
- **Ce cere:** Tipuri: 2.1 declarație de conformitate; 2.2 raport de inspecție cu rezultate nespecifice; 3.1 certificat de inspecție cu rezultate specifice lotului, validat de reprezentantul de inspecție al producătorului independent de fabricație; 3.2 idem, validat suplimentar de reprezentantul cumpărătorului sau inspector terț.
- **Praguri:**
  - Distrigaz cere 2.2 + 3.1 chiar și la țevi PE; 3.1 pentru țeavă oțel ȘI izolație
- **Documente / atestări:**
  - 3.1 pentru țevi oțel, izolație, fitinguri, flanșe, robinete
  - 3.2 dacă caietul cere inspecție terță (cost suplimentar)
- **Ofertare:** Certificatul 3.2 presupune inspector terț la producător — cost și termen; nu-l oferi implicit.
- **Clarificări:** Întreabă tipul de document cerut (3.1 vs 3.2) pe categorie de material.
- **Acces:** platit · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/07/ST-TOLNP-Tevi-din-otel-neizolate-si-preizolate-pentru-sisteme-de-distributie-gaze-naturale.pdf

#### Distrigaz Sud Rețele ST-TGPHD (2023) 
- **🟢 în vigoare** · ghid · Distrigaz Sud Rețele · ediție: publicat 07/2023
- **Titlu:** Țevi de gaz din polietilenă de înaltă densitate PEHD 100 SDR 11 — specificație tehnică
- **Ce cere:** PE100 SDR11 conform SR EN 1555-1/-2:2021; material virgin cu cod declarat; ≥ 50 ani durată; încercări la strangulare (SR EN 1555-2 anexa C + SR EN 12106); documente: agrement + aviz CTPC sau certificat conformitate, fișe tehnice material, rapoarte de tip, declarație conformitate (SR EN ISO/CEI 17050-1), raport 2.2 + certificat 3.1 (SR EN 10204).
- **Praguri:**
  - fabricație ≤ 3 luni înainte de livrare
  - colaci 32–90 mm × 100 m presurizați la 1 bar
  - bare 110–630 mm × 12 m
- **Documente / atestări:**
  - agrement tehnic + aviz CTPC
  - declarație de conformitate cu dimensiuni măsurate la ≥24 h
  - raport 2.2 + certificat 3.1
  - certificat garanție ≥ 36 luni
- **Ofertare:** Model de cerințe de calitate pentru materialele PE pe rețelele DGSR (inclusiv Prahova).
- **Clarificări:** 
- **Acces:** public · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/07/ST-TGPHD-Tevi-de-gaz-din-polietilena-de-inalta-densitate-PEHD-100-SDR-11.pdf

#### Distrigaz Sud Rețele ST-TOLNP (2023) 
- **🟢 în vigoare** · ghid · Distrigaz Sud Rețele · ediție: publicat 07/2023
- **Titlu:** Țevi din oțel neizolate și preizolate pentru sisteme de distribuție gaze naturale — specificație tehnică
- **Ce cere:** Țevi SR EN ISO 3183:2020 / API 5L 2018, PSL1 L245 sau B; izolație 3LPE SR EN ISO 21809-1:2019 clasa B2 (și B3), sablare Sa 2½ (SR EN ISO 8501-1:2007), PE virgin cu aditivi UV; certificat 3.1 pentru țeavă și izolație; Specificația Procedurii de Aplicare.
- **Praguri:**
  - B2: 1,8/2,1/2,5 mm; B3: 2,3/2,7/3,1 mm (pe greutate liniară)
  - capete neizolate 15 cm
  - țeavă ≤ 24 luni, izolație ≤ 6 luni la livrare
- **Ofertare:** 
- **Clarificări:** 
- **Acces:** public · Sursă: https://www.distrigazsud-retele.ro/wp-content/uploads/2023/07/ST-TOLNP-Tevi-din-otel-neizolate-si-preizolate-pentru-sisteme-de-distributie-gaze-naturale.pdf

#### Delgaz Grid ST 505 (A5, 01.2023) 
- **🟢 în vigoare** · ghid · Delgaz Grid S.A. · ediție: A5 — ianuarie 2023
- **Titlu:** Specificație tehnică pentru echipamentele de sudură prin electrofuziune a fitingurilor din polietilenă
- **Ce cere:** Aparate EF pentru PE-HD 100 SDR11, d32–500: sudare automată prin cod de bare sau manual; monitorizare energie/tensiune/curent + timp de răcire; protocoale salvate PDF; USB; date operator/locație/dată/oră; memorie ≥ 500 suduri; agrement tehnic + aviz CTPC (NTPEE art. 239 alin. 2); IP54; -20…+50 °C.
- **Documente / atestări:**
  - agrement tehnic + aviz CTPC aparat
  - declarație conformitate SR EN ISO/CEI 17050-1
  - certificat garanție ≥ 24 luni
- **Ofertare:** Arată ce trasabilitate așteaptă Delgaz de la sudura EF (protocol per sudură) — util și ca cerință pentru dotarea proprie.
- **Clarificări:** 
- **Acces:** public · Sursă: https://delgaz.ro/getattachment/136a9e0d-4ab9-4b18-ad59-6311715e28ee/ST-505-APARATE-DE-SUDURA-in-EF-2023.pdf

## Norme de deviz și legi conexe

### Sinteză

Fișierul pereche este `deviz_legi_conexe.json` (26 de înregistrări în format „acte/standarde”). Unde nu am putut verifica sursa primară, înregistrarea are `verificat: false`. Portalul legislatie.just.ro n-a fost accesibil, așa că am folosit HG 907 consolidat (oar.archi), HG 343/2017 (aicps), Legea 123/2012 (forma sintetică din 2019) și decizii CNSC.

---

### 0. Constatări majore (citește întâi)

1. **De la 25.08.2026 s-a schimbat cadrul legal.** Legea 169/2026 (Codul amenajării teritoriului, urbanismului și construcțiilor, CATUC), publicată în MO 661/10.08.2026, **abrogă integral Legea 50/1991** și Legea 350/2001. Din **Legea 10/1995** rămân în vigoare doar art. 10 și art. 41. HG 273/1994 (recepția), HG 766/1997 și HG 925/1995 rămân aplicabile tranzitoriu (art. 577). Tabela `ofertare_normative` are încă id 4 și id 20 ca acte în vigoare. Detaliile articol cu articol din CATUC provin din surse secundare (verificatori.ro, artevis.ro, arenaconstruct.ro), deci sunt marcate `verificat:false`.
2. **Ordinul 863/2008 e abrogat** din 27.02.2017, prin HG 907/2016 art. 18 alin. (2) lit. b). Formularele F1–F6 sunt acum anexe la HG 907/2016. Am verificat textul consolidat (versiunea din 23.11.2023).
3. **F3 = „Lista cu cantități de lucrări, pe categorii de lucrări”** (HG 907/2016, PT, Secțiunea V). Proiectantul completează coloanele 1–3 (capitol, UM, cantitate) și răspunde pentru ele. Ofertantul completează coloanele 4–9 (preț unitar defalcat pe materiale, manoperă, utilaj, transport și valorile). Structura finală a formularului: cheltuieli directe → alte cheltuieli directe → TO; indirecte IO = TO×%; profit PO = (TO+IO)×%.
4. **Normele de deviz NU sunt obligatorii pentru ofertant.** Ghidul P91/1-02 (Ordin MLPTL 1568/2002) le tratează ca „reper orientativ” și permite consumuri proprii. CNSC (dosarul BO2018_6476, contestația 195/06.02.2018, Dobroești/Ilfov) a anulat procedura pentru că AC a impus rețetele și distanțele de transport ale proiectantului, contrar propriilor răspunsuri. Excepție: cantitatea de material rezultată din proiect trebuie respectată.
5. **Salariul minim în construcții în 2026 este 4.582 lei brut** (27,714 lei/oră), stabilit prin OUG 156/2024 art. LXIX și neschimbat de OUG 29/2026. Facilitățile fiscale (scutirea de impozit, CAS redus, scutirea de CASS) **au fost eliminate de la veniturile din ianuarie 2025**. Salariul minim general este 4.050 lei, respectiv 4.325 lei de la 01.07.2026 (HG 146/2026). Orice tarif orar de manoperă sub 27,714 lei/h (plus CAM 2,25%) este un semnal roșu.
6. **Ordin 2264/2018 privește verificatorii de proiecte și experții tehnici**, nu RTE. RTE sunt reglementați de Ordinul 1895/2016. Tabela le are corect ca număr, dar trebuie clarificat ce conține fiecare.

---

### A. Norme de deviz

#### A.1 Ce indicatoare există realmente
Sursele sunt intocmire-devize.ro, COCC (editor) și UTCN (proiectul 224 CI/2018). Ediția de referință este **seria 1981–1982**, retipărită de edituri private, plus câteva indicatoare revizuite după 1998.

| Simbol | Denumire | Ediție | Relevanță Gazpet |
|---|---|---|---|
| **G** | Conducte pentru transport și distribuție a gazelor și lichidelor petroliere | 1981 (retipăriri și revizuiri semnalate în 1996 și 2002) | **rețele de distribuție, branșamente** |
| **I** | Instalații de încălzire centrală și gaze la construcții (2 vol.) | 1981 | instalații de utilizare interioare |
| **Ts** | Terasamente | 1981 | săpătura de tranșee, umpluturi, sprijiniri |
| **Ac** / **RpAc** | Alimentări cu apă și canalizare / reparații | revizuit 1999–2015 | apă-canal |
| **C, D, P, E, S, V, IZ, AT, FJ, IF, L1, L2, T, RpC, RpE, RpS** | construcții, drumuri (refaceri carosabil), poduri, electrice, sanitare etc. | 1981 | refacerea sistemului rutier → **D** |

- Simbolurile „ACA/ACB/ACC”, „TSA/TSC”, „Ig”, „IAC”, „CZ” din cerere **nu apar ca indicatoare separate**. Sunt prefixe de capitol sau articol în codurile din programele de deviz (ex. TSA02…, TRA01A20 = transport auto, citat de CNSC). Nu am găsit public tabele ale indicatorului G cu consumuri, pentru că publicația e plătită.
- **Emitent:** institutele de normare ale ministerului de resort de dinainte de 1989 (studii de timp și consum pe șantier, conform UTCN 2018). Nu am găsit actul de aprobare și nici un emitent exact verificabil (IPCT, INCERC sau altul). Marcat neconfirmat.
- **Statut juridic:** nu sunt reglementări tehnice obligatorii. Le face aplicabile Ghidul P91/1-02 (Ordin 1568/2002), ca reper. După UTCN (2018), consumurile de utilaj din 1981 sunt depășite, pentru că utilajele actuale sunt mai productive.

#### A.2 Formularele cerute la ofertă
- **HG 907/2016**: F1 (centralizator pe obiectiv), F2 (centralizator pe categorii de lucrări, pe obiecte), **F3** (liste cu cantități pe categorii de lucrări), F4 (utilaje și echipamente), F5 (fișe tehnice), F6 (grafic). Nota din Secțiunea V spune că F1–F5 completate cu prețuri devin devizul ofertei și baza situațiilor de lucrări.
- **C5–C9** vin din Ordinele MLPTL 1014/2001 și MF 874/2001: C5 deviz pe categorie, **C6 consumuri de resurse materiale, C7 manoperă, C8 ore de funcționare utilaje, C9 transporturi**. Nu am putut verifica statutul actual al ordinelor (`verificat:false`). AC încă le cer în fișa de date (exemple publice: ABA Crișuri 2024, Primăria Videle, DRDP Constanța). Ghidul P91/1-02 pct. 2.4 cere ofertantului aceleași patru extrase de resurse.
- **Normele metodologice din 13.04.1998** (Ordin MF 784/1998 și MLPAT 34/N/1998), pct. 6.4.2: prețurile unitare rezultă din analizele de preț ale ofertantului, pe consumurile proprii, cu prețuri valabile cu 28 de zile înainte de termenul de depunere. Contestatorul din BO2018_6476 le-a invocat ca fiind în vigoare. Statutul lor nu e verificat.

#### A.3 Exemple de consumuri publice (norme de firmă SOFTEH-VALROM, nu indicator oficial)
Sursa: windev.ro, „Norme de deviz SOFTEH – VALROM”, PDF public.

| Articol | Diametru | Manoperă (ore) | Utilaj (ore) |
|---|---|---|---|
| Pozare PEHD în colaci de 100 m (per m) | D≤63 / D110 | montator 0,036 + deservire 0,018 / 0,183 + 0,095 | întindere 0,01 / 0,04 |
| Sudură cap la cap PE100 PN10 (per bucată) | D63 / D110 / D160 / D250 / D315 / D400 / D630 | 0,66 / 0,85 / 1,02 / 1,26 / 2,10 / 2,33 / 3,67 (total sudor + deservire) | aparat de sudură + generator = aceleași ore |
| Electrofuziune mufă/cot (per bucată) | D32 / D63 / D110 / D125 | sudor 0,36 / 0,51 / 0,88 / 1,06 | aparat EF 0,01–0,06 |
| Materiale | — | țeavă 1,015 m/m; bandă de avertizare 1,1 m/m; material mărunt 7–10% la EF | — |

Pentru oțel, săpătură (Ts) și indicatorul G n-am găsit tabele numerice publice.

#### A.4 Prețul neobișnuit de scăzut și consumurile nerealiste
Temeiul general (art. 210 din L98/2016 și art. 61 din HG 395/2016) e tratat în alt fișier. Din perspectiva devizului, la justificare AC cer de obicei:
- **analizele de preț pe articol** (consum × preț resursă) și extrasele **C6–C9**;
- dovezi de preț: oferte de la furnizori (materiale), stat de plată sau tarif orar ≥ salariul minim în construcții (manoperă), tarif sau proprietate (utilaje), distanțe reale (transport);
- justificarea tehnologică a consumului redus (utilaj mai productiv, sudură automată);
- respectarea obligațiilor de mediu, sociale și de muncă (art. 51 din L98), deci manopera nu poate coborî sub salariul minim legal.

#### A.5 Programe de deviz (doar listă)
WinDoc (SOFTEH), Deviz Expert, Intersoft (Devize), eDevize, devize.ro (Deviz Profesional), Windev.

---

### B. Legi conexe: sinteză

| Act | Stare la 01.10.2026 | Esențial pentru Gazpet |
|---|---|---|
| Legea 169/2026 (CATUC) | **în vigoare din 25.08.2026** | garanții minime pe clase de consecințe (CC1 = 1 an, CC2 = 3 ani, CC3–CC4 = 5 ani), vicii ascunse 10 ani, certificare prin ARCOC; branșamente la rețele existente pe domeniul public = acord sau autorizație de la administratorul drumului, fără AC distinctă (clarificare MDLPA din 23.09.2026) |
| Legea 10/1995 | **abrogată, cu excepția art. 10 și 41** | art. 23 (obligațiile executantului) rămâne relevant doar pentru contractele vechi |
| Legea 50/1991 | **abrogată** | art. 11 alin. (1) lit. f) (reparații la branșamente în limita proprietății fără AC) are acum doar valoare istorică |
| HG 273/1994 (forma din HG 343/2017) | menținută tranzitoriu | vezi secțiunea „Recepția” |
| Legea 123/2012 | în vigoare | art. 121: proiectare și execuție doar cu autorizație ANRE; art. 109–113: drept de uz și servitute fără înscriere în CF, convenție-cadru cu proprietarii în 30 de zile; art. 117: zone de protecție |
| Legea 319/2006, HG 1425/2006, HG 300/2006 | în vigoare | coordonatorul SSM și PSS cad în sarcina beneficiarului; planul propriu SSM al executantului se integrează în PSS și se avizează de coordonator înainte de start (art. 15); declarația prealabilă la ITM cu 30 de zile înainte |
| HG 766/1997, HG 925/1995 | menținute tranzitoriu (art. 577) | cartea tehnică, categoriile de importanță, verificarea proiectelor |
| Ordin 1895/2016 | în vigoare (statutul după CATUC neverificat) | RTE pe domenii, registrul ISC |
| Ordin 2264/2018 | în vigoare | verificatori de proiecte și experți tehnici (nu RTE) |
| Ordin 1370/2014 (PCF 002) | în vigoare (?) | faze determinante |
| L98 art. 200–201 | în vigoare | ISO 9001 și 14001 de la organism acreditat; echivalență doar în condițiile art. 200 alin. (3); BO2021_1451: certificarea „în curs” nu ajunge |

**ISO 45001:** nu are temei dedicat în L98 (art. 200 privește calitatea, art. 201 mediul). Cerința poate fi atacată ca restrictivă, dar practica CNSC nu e verificată. **RENAR:** organismul național de acreditare. Se acceptă și acreditări din state EA sau IAF MLA (recunoaștere reciprocă).

---

### Cum se verifică un deviz sau un F3 contra consumurilor normate (reguli pentru un verificator automat)

Intrări: F3 din documentația AC (coloanele 1–3), F3 ofertat sau analize de preț, extrase C6–C9, tabelul de resurse cu prețuri și o bibliotecă de norme (articol → consumuri).

1. **Integritatea coloanelor proiectantului:** codul articolului, UM-ul și cantitatea din F3-ul ofertat trebuie să fie identice cu F3-ul AC. Orice diferență e un `BLOCKER`. Nu se modifică, se clarifică.
2. **Aritmetica F3:** pentru fiecare rând, valoarea = cantitate × preț unitar pe fiecare componentă (M, m, U, t), iar total = M + m + U + t. Totalurile pe capitol trebuie să fie egale cu suma rândurilor. Se verifică TO = Σ directe + alte directe, IO = TO × %ind, PO = (TO + IO) × %profit. Toleranța de rotunjire e de ±0,01 lei pe rând. Peste toleranță, rezultatul e `eroare_aritmetica`.
3. **Corespondența cu extrasele:** Σ(cantitate F3 × consum normă) pe fiecare resursă trebuie să fie egală cu cantitatea din C6 (materiale), C7 (ore-om pe meserie), C8 (ore utilaj), C9 (t sau tkm). Abaterea admisă e ±1%. Peste ea, extrasele nu provin din analize.
4. **Materialele (nu pot scădea):** consumul de material pe UM trebuie să fie ≥ cantitatea netă din proiect × (1 + pierderea normată). Exemple: țeavă PE ≥ 1,015 m/m, bandă de avertizare ≥ 1,1 m/m. Sub prag, rezultatul e `consum_material_sub_proiect`, deci risc de neconformitate.
5. **Manopera, tariful minim:** tariful orar din C7 trebuie să fie ≥ 27,714 lei/h (construcții, 2026). Dacă se calculează și costul angajatorului, pragul devine ≥ 27,714 × 1,0225. Sub prag, rezultatul e `RED_salariu_minim`. Valoarea trebuie parametrizată după dată (tabel `salariu_minim(sector, de_la, lei_luna, ore_luna)`).
6. **Manopera, consumul de ore:** se compară orele pe articol cu norma de referință (indicatorul oficial dacă există codul, altfel biblioteca de firmă de tip SOFTEH-VALROM). Praguri: ≥ 70% din normă = OK; 50–70% = `ATENTIE`, se cere justificare tehnologică; sub 50% = `RED_consum_nerealist`. Pentru sudura PE se aplică pe diametru (ex. D110 cap la cap ≈ 0,85 h/bucată).
7. **Utilajele:** pentru 1981 se acceptă reduceri (UTCN 2018), dar orele de utilaj la sudură PE trebuie să fie ≥ orele sudorului (aparatul lucrează cât sudorul). Utilajul lipsă la un articol care îl cere în normă e semnalat.
8. **Transportul:** distanța implicită din normă vs. distanța declarată. Dacă AC a impus o distanță (ex. 5 km), se semnalează pentru clarificare (practica BO2018_6476).
9. **Coerența prețurilor resurselor:** același cod de resursă trebuie să aibă același preț în toate devizele. Prețurile materialelor majore (țeavă, fitinguri) se compară cu ofertele de la furnizori stocate, cu o abatere maximă de -15% fără document justificativ.
10. **Procentele:** indirectele și profitul nu au limită legală (P91 pct. 1.3), dar se semnalează valorile < 3% sau > 25%. Se verifică prezența „alte cheltuieli directe” dacă formularul AC le cere.
11. **Prețul neobișnuit de scăzut:** se calculează raportul preț total / valoarea estimată și preț / media ofertelor (dacă e publică). Sub 80% din valoarea estimată se pregătește automat pachetul de justificare: analize, C6–C9, tarif orar, oferte de la furnizori, explicații tehnologice pentru articolele marcate `ATENTIE` sau `RED`.

---

### Recepția lucrărilor: pași, documente, termene
Sursa e HG 273/1994 în forma dată de HG 343/2017, menținută tranzitoriu de Legea 169/2026. Pentru rețelele de gaze se adaugă procedurile operatorului de distribuție și NTPEE (tratate în alt fișier).

| Pas | Cine | Termen | Articol |
|---|---|---|---|
| 0. (opțional) Recepție parțială pe stadiu fizic | investitorul + executantul | — | art. 7–8 |
| 1. Comunicarea scrisă a terminării lucrărilor și cererea de recepție | executantul | în perioada de valabilitate a AC | art. 9 |
| 2. Cerere de desemnare a membrilor, fixarea datei, transmiterea către ISC a referatelor și a valorii | investitorul | **5 zile** | art. 10 alin. (1) |
| 3. Comunicarea reprezentanților | factorii implicați | **10 zile** | art. 10 alin. (2) |
| 4. Numirea comisiei | investitorul | **3 zile** de la ultima comunicare | art. 10 alin. (3) |
| 4'. Investitorul nu convoacă: executantul reînnoiește cererea, apoi fixează singur termenul | executantul | 10 + 10 zile | art. 14 |
| 5. Examinarea: AC, conformitatea cu proiectul, cartea tehnică (as-built, PV de lucrări ascunse, PV de faze determinante), devizul final, adeverința ISC, referatele proiectantului și dirigintelui | comisia | — | art. 15 |
| 6. Suspendare cu termen de remediere | comisia + executantul | **max. 90 de zile** (+ max. 90 pentru condiții climatice); comunicare în 3 zile lucrătoare | art. 17 |
| 7. Admitere sau respingere | comisia | — | art. 18 |
| 8. Aprobarea și semnarea PV | investitorul | **3 zile** | art. 19 |
| 9. Garanția începe la data semnării PV de către investitor; după PV nu se mai pot cere remedieri sau penalități neconsemnate, cu excepția viciilor ascunse și a celor de structură | — | — | art. 20–21 |
| 10. Comunicarea PV (proprietar, executant, proiectant, primărie, ISC) | investitorul | **5 zile** | art. 23 |
| 11. Recepția finală, convocată de proprietar | proprietarul | **max. 10 zile** de la expirarea garanției; remediere max. 90 de zile | art. 24–29 |

**Garanția:** este garanția din contract, dar nu mai mică decât cea legală. Pentru contractele noi (CATUC): CC1 = 1 an, CC2 = 3 ani, CC3–CC4 = 5 ani. Pentru contractele vechi (Legea 10/1995): A și B = 5 ani, C = 3 ani, D = 1 an.

---

### Fișe

#### Indicatoare de norme de deviz seria 1981 (si revizuite dupa 1998) 
- **🟢 în vigoare** · normativ · Fostul minister de resort (Ministerul Constructiilor Industriale / institutele de normare de dinainte de 1989); retiparite de edituri private (ex. COCC) · ediție: Editia 1981-1982 (cea mai folosita); unele revizuite 1999-2015 (ex. Ac). Cercetare de actualizare D (drumuri): UTCN proiect 224 CI/2018
- **Titlu:** Sistemul indicatoarelor de norme de deviz pe categorii de lucrari (C, Ts, Ac, G, I, E, S, D, P, IZ, AT, FJ, IF, L, T, V, RpC/RpAc/RpE/RpS etc.)
- **Ce cere:** Fiecare articol (norma) da consumul mediu de resurse (materiale, manopera ore-om pe meserii, utilaj ore-functionare, transport t/tkm) pentru 1 UM de lucrare. Nu sunt obligatorii pentru ofertant: Ghidul P91/1-02 (Ordin MLPTL 1568/2002) le declara reper orientativ; ofertantul poate folosi consumuri proprii daca respecta proiectul, caietele de sarcini si reglementarile tehnice.
- **Praguri:**
  - Exemplu de structura cod: litere indicator + capitol + nr. articol + varianta (ex. TSA02.., TRA01A20 = transport auto materiale, folosit in CNSC 2018)
- **Verificări / probe:**
  - Corespondenta cod articol F3 <-> indicator; UM articol vs UM F3; consum material >= cantitate neta (pierderi tehnologice)
- **Articole cheie:**
  - Ghid P91/1-02 pct. 1.4, 2.2.3, 3.3.1.4 (citate in CNSC BO2018_6476)
- **Ofertare:** Baza pentru analizele de pret (C6-C9 / extrase de resurse). Consumurile din 1981 la utilaje sunt adesea supradimensionate fata de utilajele actuale (UTCN 2018) — se pot reduce cu justificare tehnologica.
- **Clarificări:** Daca AC impune 'strict articolele si retetele proiectantului', se poate cere clarificare/ remediere: CNSC (BO2018_6476) a retinut ca impunerea acelorasi consumuri defavorizeaza ofertantii cu tehnologii noi; consumurile normate nu sunt obligatorii, cu exceptia cantitatii de material.
- **Acces:** platit · Sursă: https://intocmire-devize.ro/indicatoare-norme-de-deviz/ ; http://www.cocc.ro/indicatoare_de_norme_de_deviz.htm ; https://actutil.utcluj.ro/documente/Proiect_stiintific_tehnic_224ci.pdf

#### Indicator de norme de deviz G — 1981 · ⚠️ neverificat integral
- **🟢 în vigoare** · normativ · idem seria 1981 (retiparit; editii revizuite 1996 / 2002 mentionate de librarii) · ediție: 1981; revizuiri/retipariri semnalate 1996 si pana in 2002 (neconfirmat continutul revizuirilor)
- **Titlu:** Indicator de norme de deviz pentru lucrari de conducte pentru transport si distributie a gazelor si lichidelor petroliere (G)
- **Ce cere:** Articole pentru montaj conducte otel/PE retele gaze, sudura, izolatii, probe, subtraversari, robinete etc. Consumuri orientative.
- **Ofertare:** Indicatorul de referinta pentru retele de distributie / conducte gaze in F3 (alaturi de Ts pentru sapatura si Ac/D pentru refaceri). Nu am gasit public valorile articolelor (publicatie platita).
- **Clarificări:** La articole PE din G (vechi) care nu reflecta tehnologia (sudura cap la cap / electrofuziune cu aparate automate), cerere de acceptare a consumurilor proprii.
- **Acces:** platit · Sursă: http://www.cocc.ro/indicatoare_de_norme_de_deviz.htm

#### Indicator de norme de deviz I — 1981 
- **🟢 în vigoare** · normativ · seria 1981 (retiparit) · ediție: 1981
- **Titlu:** Indicator de norme de deviz pentru lucrari de instalatii de incalzire centrala si gaze la constructii (I-1981), 2 volume
- **Ce cere:** Instalatii interioare de utilizare gaze (in cladiri), incalzire centrala. Nu se foloseste pentru retele exterioare de distributie (acolo: G).
- **Ofertare:** Pentru instalatii de utilizare / instalatii interioare la bransamente (dupa post de reglare).
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.librarie.net/p/130476/indicator-de-norme-de-deviz-pentru-lucrari-de-instalatii-de-incalzire-centrala-si-gaze-la-constructii-i-1981-2-volume

#### Indicator de norme de deviz Ts — 1981 
- **🟢 în vigoare** · normativ · seria 1981 (retiparit) · ediție: 1981
- **Titlu:** Indicator de norme de deviz pentru lucrari de terasamente (Ts)
- **Ce cere:** Sapaturi manuale/mecanizate, sprijiniri, umpluturi, compactari, transport pamant. Consumurile variaza pe categorii de teren si adancimi.
- **Ofertare:** Cea mai mare pondere de manopera in retelele de gaze/apa (transee). Verificati categoria terenului si adancimea in F3 vs. studiul geotehnic.
- **Clarificări:** Neconcordante categorie teren / prezenta apei subterane / sprijiniri neincluse.
- **Acces:** platit · Sursă: http://www.cocc.ro/indicatoare_de_norme_de_deviz.htm

#### Indicator de norme de deviz Ac (si RpAc) · ⚠️ neverificat integral
- **🟢 în vigoare** · normativ · seria 1981; editie revizuita si actualizata 1999-2015 (dupa COCC) · ediție: revizuit 1999-2015
- **Titlu:** Alimentari cu apa si canalizari (Ac); Reparatii alimentari cu apa si canalizare (RpAc, 2 vol.)
- **Ce cere:** Conducte apa/canal (fonta, PVC, PE, beton), camine, bransamente apa, probe, spalare-dezinfectie.
- **Ofertare:** Licitatii apa-canal. Simbolurile 'ACA/ACB/ACC...' din intrebare nu au putut fi confirmate ca indicatoare separate — sunt prefixe de capitole/articole in indicatorul Ac (NECONFIRMAT).
- **Clarificări:** 
- **Acces:** platit · Sursă: http://www.cocc.ro/indicatoare_de_norme_de_deviz.htm

#### Norme de deviz SOFTEH – VALROM (retele exterioare PEHD apa-gaz, canalizare PVC) 
- **🟢 în vigoare** · ghid · SOFTEH (WinDoc) in colaborare cu producatorul Valrom — norme de firma, NU indicator oficial · ediție: publicat ~2015 (windev.ro)
- **Titlu:** Norme de deviz pentru retele exterioare PEHD apa-gaz, canalizare, camine de vizitare/inspectie PVC
- **Ce cere:** Consumuri pe articol pentru pregatire/pozare PEHD, sudura cap la cap (pe PE80/PE100, PN6/10/16, D40-630), electrofuziune (D32-500), compresiune, PVC canalizare.
- **Praguri:**
  - Pozare PEHD in colaci 100 m (per m): D<=63: montator 0,036 h + deservire 0,018 h; D110: 0,183 h + 0,095 h; teava 1,015 m/m; banda avertizare 1,1 m/m
  - Sudura cap la cap PE100 PN10 (per bucata): D40-50: sudor 0,55 h + 0,02 h deservire (total 0,57 h); D63: 0,66 h; D110: 0,85 h; D160: 1,02 h; D200: 1,13 h; D250: 1,26 h; D315: 2,10 h; D400: 2,33 h; D630: 3,67 h; aparat cap la cap + generator = aceleasi ore
  - Electrofuziune mufa/cot (per bucata): D32: sudor 0,36 h; D63: 0,51 h; D110: 0,88 h; D125: 1,06 h; aparat EF 0,01-0,06 h; material marunt 7-10%
- **Ofertare:** Singura sursa publica gasita cu consumuri numerice pentru PE. Utila ca 'reper' pentru verificarea manoperei la sudura PE din F3/analize.
- **Clarificări:** Pot fi invocate ca reper tehnic al producatorului pentru justificarea consumurilor proprii la pret neobisnuit de scazut.
- **Acces:** public · Sursă: https://www.windev.ro/wp-content/uploads/2015/02/Norme-deviz-Softeh-Valrom.pdf

#### Ordin MLPTL 1568/2002 — Ghid P91/1-02 · ⚠️ neverificat integral
- **🟢 în vigoare** · ghid · Ministerul Lucrarilor Publice, Transporturilor si Locuintei · ediție: 2002; figura in lista reglementarilor tehnice valabile la 31.03.2010 (Decizia MDRT 27.129/28.04.2010), citat ca aplicabil de CNSC in 2018
- **Titlu:** Ghid privind elaborarea devizelor la nivel de categorii de lucrari si obiecte de constructii pentru investitii realizate din fonduri publice — indicativ P91/1-02
- **Ce cere:** Devizele se intocmesc cu indicatoare recunoscute SAU consumuri proprii corespunzatoare tehnologiei executantului (pct. 1.4); indicatoarele 1981 sunt reper orientativ (pct. 2.2.3); ofertantul intocmeste extrase de resurse: materiale, manopera, utilaj, transport (pct. 2.4) = baza formularelor C6-C9; nu limiteaza cheltuielile indirecte si profitul (pct. 1.3).
- **Articole cheie:**
  - pct. 1.3 — fara limitari valorice pentru indirecte/profit
  - pct. 1.4 — indicatoare sau consumuri proprii
  - pct. 2.2.3 — indicatoarele 1981 = reper orientativ
  - pct. 2.4 — extrase de resurse (4 tipuri)
  - pct. 3.3.1.4 — consumuri din indicatoare sau proprii
- **Ofertare:** Temeiul principal pentru folosirea consumurilor proprii si pentru structura extraselor de resurse.
- **Clarificări:** Se citeaza in clarificari cand AC impune retete/distante de transport fixe.
- **Acces:** partial · Sursă: http://portal.cnsc.ro/sivadoc/download.aspx?docUID=NWQ2ZTZiODMtYzc2OS00YTM3LWEwZmQtMmRkOTIwYzljYjgx&pdfa1=ZmFsc2U%3D&filename=Qk8yMDE4XzY0NzYucGRm&action=aW5saW5l

#### Ordin MLPTL 1014/2001 + Ordin MF 874/2001 (formulare C1-C9) · ⚠️ neverificat integral
- **⚪ neconfirmat** · ordin · MLPTL + Ministerul Finantelor · ediție: iunie 2001 (MO); statut actual neverificat — portalul legislatie.just.ro inaccesibil
- **Titlu:** Instructiuni/model documentatie pentru achizitia publica de lucrari — sursa formularelor C5 (deviz pe categorii), C6 (consumuri resurse materiale), C7 (manopera), C8 (ore functionare utilaje), C9 (transporturi)
- **Ce cere:** Ofertantul prezinta, pe langa F3 completat, listele de consumuri C6-C9 (cantitati resurse x pret). In practica AC le cer in fisa de date si le folosesc la analiza pretului neobisnuit de scazut.
- **Ofertare:** Formularele C6-C9 apar in continuare in documentatii SEAP (ex. publicate de primarii/ABA). Daca le cere AC, sunt documente ale propunerii financiare.
- **Clarificări:** Daca AC cere C6-C9 dar nu le pune la dispozitie (sau pune doar F3), se cere modelul. Daca AC furnizeaza C6 cu consumuri fixe, se intreaba daca sunt obligatorii.
- **Acces:** public · Sursă: https://legislatie.just.ro/Public/DetaliiDocument/29363

#### Ordin MDLPL 863/2008 
- **🔴 abrogat** · ordin · Ministerul Dezvoltarii, Lucrarilor Publice si Locuintelor · ediție: MO 524/11.07.2008 · înlocuit de: HG 907/2016 (formularele F1-F6 sunt acum anexe la HG 907/2016)
- **Titlu:** Instructiuni de aplicare a unor prevederi din HG 28/2008 (continut-cadru documentatii tehnico-economice, deviz general, formulare F1-F5)
- **Ce cere:** —
- **Articole cheie:**
  - HG 907/2016 art. 18 alin. (2) lit. b) — abrogare
- **Modificări:**
  - Abrogat prin HG 907/2016 art. 18 alin. (2) lit. b), de la 27.02.2017
- **Ofertare:** Documentatiile care invoca inca 'Ordinul 863/2008' trimit la un act abrogat; formularele echivalente sunt in HG 907/2016.
- **Clarificări:** Se poate semnala AC ca referinta e abrogata (clarificare de forma, nu de fond).
- **Acces:** public · Sursă: https://oar.archi/wp-content/uploads/2024/06/Hotararea-907_2016-etapele-de-elaborare-si-continutul-cadru-al-documentatiilor-tehnico-economice-aferente-obiectivelor-proiectelor-din-fonduri-publice.pdf

#### HG 907/2016 
- **🟡 modificat** · hg · Guvernul Romaniei · ediție: in vigoare din 27.02.2017; forma consultata: versiune 23.11.2023 · `ofertare_normative.id = 6`
- **Titlu:** Etapele de elaborare si continutul-cadru al documentatiilor tehnico-economice aferente obiectivelor/proiectelor de investitii finantate din fonduri publice
- **Ce cere:** Proiectul tehnic de executie, Sectiunea V 'Liste cu cantitati de lucrari': F1 centralizator pe obiectiv, F2 centralizator pe categorii de lucrari pe obiecte, F3 liste cu cantitati de lucrari pe categorii, F4 liste utilaje/echipamente, F5 fise tehnice utilaje; F6 grafic general. F1-F5 completate cu preturi devin devizul ofertei si baza situatiilor de lucrari.
- **Praguri:**
  - F3: coloanele 1-3 (capitol, UM, cantitate) le completeaza si raspunde proiectantul; coloanele 4-9 (pret unitar pe materiale/manopera/utilaj/transport si valori) le completeaza ofertantul
  - F3 final: cheltuieli directe + alte cheltuieli directe (CAS, somaj, fond risc...) -> Total directe TO; indirecte IO = TO x %; profit PO = (TO+IO) x %; VO = TO+IO+PO
- **Verificări / probe:**
  - Ofertantul nu modifica coloanele 1-3; diferentele de cantitati se clarifica inainte de depunere
- **Articole cheie:**
  - art. 18 alin. (2) — abrogari
  - Anexa (continut PT) Sectiunea V — F1-F5; NOTA: F1-F5 cu preturi = deviz oferta
  - Formular F3 — Precizari 1-3
- **Modificări:**
  - Abroga HG 28/2008 si Ordinul 863/2008 (art. 18 alin. (2))
  - Modificari ulterioare pana in 2023 (ex. HG 2023) — detalii neverificate
- **Ofertare:** F3 = documentul central al propunerii financiare la lucrari. Precizarea 2: beneficiarul trebuie sa includa in F3 materialele pe care le pune la dispozitie, cu conditiile de livrare.
- **Clarificări:** Erori de cantitati/UM in F3 sunt raspunderea proiectantului (precizarea 1) -> sursa principala de clarificari.
- **Acces:** public · Sursă: https://oar.archi/wp-content/uploads/2024/06/Hotararea-907_2016-etapele-de-elaborare-si-continutul-cadru-al-documentatiilor-tehnico-economice-aferente-obiectivelor-proiectelor-din-fonduri-publice.pdf

#### OUG 114/2018 art. 71 + OUG 156/2024 art. LXIX · ⚠️ neverificat integral
- **🟢 în vigoare** · oug · Guvernul Romaniei · ediție: 4.582 lei/luna (27,714 lei/ora) in 2025 si 2026; nemodificat de OUG 29/2026 (care a abrogat doar regimul agricultura/industrie alimentara)
- **Titlu:** Salariul de baza minim brut garantat in plata pentru domeniul constructiilor
- **Ce cere:** Angajatorii din domeniul constructiilor (definit la art. 60 pct. 5 Cod fiscal: CAEN 41, 42, 43, 7112 cu prag de cifra de afaceri — detaliu neverificat pe textul 2026) platesc minim 4.582 lei brut, fara sporuri.
- **Praguri:**
  - 4.582 lei brut/luna
  - 27,714 lei/ora (la 165,333 h/luna medie)
  - Cost angajator ~4.685 lei (+2,25% CAM) — calcul propriu, nu din sursa
- **Verificări / probe:**
  - Tarif orar manopera din C7/analize >= 27,714 lei/h (+CAM 2,25%) — orice valoare sub acest prag e suspect de neconformitate cu art. 51 alin. (2) L98 / art. 210 L98
- **Articole cheie:**
  - OUG 156/2024 art. LXIX
  - HG 146/2026
- **Modificări:**
  - OUG 114/2018 — instituie salariu minim specific constructii (3.000 lei din 2019) + facilitati fiscale
  - OUG 156/2024 art. LXIX — 4.582 lei; facilitatile fiscale (scutire impozit, CAS redus, scutire CASS) ELIMINATE de la veniturile din ianuarie 2025
  - HG 146/2026 — salariul minim general: 4.050 lei pana la 30.06.2026; 4.325 lei de la 01.07.2026 (25,949 lei/ora)
- **Ofertare:** Pragul minim legal al manoperei in deviz. Dupa eliminarea facilitatilor, costul net/brut s-a schimbat: acelasi brut 4.582, dar angajatul plateste impozit + CAS 25% + CASS 10%; nu exista cost suplimentar pentru angajator, ci scade netul. Pentru ofertare conteaza brutul + CAM.
- **Clarificări:** La pret neobisnuit de scazut, AC verifica tariful orar din C7; justificarea trebuie sa arate tarif >= salariul minim aplicabil + contributii angajator.
- **Acces:** public · Sursă: https://edevize.ro/salariu-minim-constructii/ ; https://www.contabun.ro/2026/04/28/salariul-minim-in-sectoarele-constructii-agricultura-si-industria-alimentara-de-la-1-iulie-2026/ ; https://startupcafe.ro/salariul-minim-2026-in-monitorul-oficial-hg-146-96219

#### Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) · ⚠️ neverificat integral
- **🟢 în vigoare** · lege · Parlamentul Romaniei · ediție: MO I nr. 661/10.08.2026; in vigoare 25.08.2026 (unele dispozitii tranzitorii cu termene proprii)
- **Titlu:** Codul amenajarii teritoriului, urbanismului si constructiilor
- **Ce cere:** Regim unic de autorizare (autorizare / notificare cu proiect tehnic simplificat / fara formalitati / aviz de amplasare); clase de consecinte CC1-CC4; certificarea operatorilor economici prin ARCOC; garantii minime legale: 1 an CC1, 3 ani CC2, 5 ani CC3-CC4, 2 ani plantatii, de la PV receptie la terminare; vicii ascunse 10 ani, structura pe toata durata.
- **Praguri:**
  - Garantie minima: CC1=1 an, CC2=3 ani, CC3/CC4=5 ani (art. ~531 — numar neconfirmat)
  - Vicii ascunse: 10 ani de la receptie; structura de rezistenta: toata durata de existenta
- **Articole cheie:**
  - art. 294-300 — notificare / fara formalitati
  - art. 343-345 — energie si comunicatii
  - art. 456 diriginte; art. 459 RTE
  - art. 576 — abrogari
  - art. 577 — mentinere tranzitorie acte de aplicare
- **Modificări:**
  - Abroga Legea 50/1991, Legea 350/2001 si normele lor metodologice (art. 576)
  - Abroga Legea 10/1995 cu exceptia art. 10 si art. 41 (art. 576 alin. (3) lit. c) — dupa verificatori.ro)
  - Mentine tranzitoriu HG 273/1994 (art. 577 alin. (6)), HG 766/1997 anexele 1-5 (art. 577 alin. (3)), HG 925/1995 (art. 577 alin. (5)) — dupa verificatori.ro
  - Clarificare MDLPA 23.09.2026: racordarea constructiilor existente la retele tehnico-edilitare de pe domeniul public — suficient acordul/autorizatia administratorului drumului, fara AC distincta
- **Ofertare:** Din 25.08.2026 documentatiile care citeaza Legea 50/1991 sau Legea 10/1995 (articolele abrogate) trimit la acte abrogate. Perioada de garantie minima trebuie raportata la clasa de consecinte, nu la categoria de importanta A-D (atentie la factorul de evaluare 'garantie').
- **Clarificări:** Clarificari pentru: (1) ce regim se aplica (vechi/nou) procedurilor lansate inainte de 25.08.2026; (2) clasa de consecinte a lucrarii (pentru garantie minima); (3) daca bransamentele necesita AC sau doar acord administrator drum.
- **Acces:** public · Sursă: https://verificatori.ro/cod-urbanism ; https://verificatori.ro/cod-urbanism/legea-10-1995-ce-mai-ramane ; https://arenaconstruct.ro/catuc-mdlpa-clarifica-aplicarea-noului-cod-al-amenajarii-teritoriului-urbanismului-si-constructiilor/ ; https://www.artevis.ro/garantii-si-retineri-in-contractele-de-constructii/

#### Legea 10/1995 (republicata MO 765/30.09.2016) · ⚠️ neverificat integral
- **🟠 abrogat parțial** · lege · Parlamentul Romaniei · ediție: Republicata 2016; ABROGATA in cea mai mare parte de la 25.08.2026 prin Legea 169/2026 — raman doar art. 10 si art. 41 · înlocuit de: Legea 169/2026 (CATUC) — Cartea II (calitatea in constructii) · `ofertare_normative.id = 4`
- **Titlu:** Legea privind calitatea in constructii
- **Ce cere:** (Pana la 25.08.2026) art. 23 obligatiile executantului: sesizarea neconformitatilor din proiect; incepere doar pe lucrari autorizate si proiecte verificate; sistem propriu de calitate + RTE; convocarea la fazele determinante; doar produse cu performante declarate; sesizare ISC in 24 h la accidente tehnice; remedieri pe cheltuiala proprie inclusiv in garantie; aducerea terenului la starea initiala. Garantii minime (forma 2016): 5 ani cat. A si B, 3 ani cat. C, 1 an cat. D; vicii ascunse 10 ani.
- **Articole cheie:**
  - art. 10 si art. 41 — raman in vigoare (reglementari tehnice; regulamente ale sistemului calitatii)
  - art. 23 — obligatii executant (abrogat 25.08.2026)
- **Modificări:**
  - Legea 169/2026 art. 576 alin. (3) lit. c) — abroga art. 1-9, 11-40, 42-44
- **Ofertare:** Contractele semnate inainte de 25.08.2026 raman guvernate de forma veche (principiul legii contractului) — de verificat dispozitiile tranzitorii.
- **Clarificări:** Documentatii noi care cer 'conform Legii 10/1995 art. 23' — se poate intreba AC daca intelege prevederile corespondente din CATUC.
- **Acces:** public · Sursă: https://legeaz.net/legea-calitatii-in-constructii-10-1995/art-23-obligatii-si-raspunderi-ale-executantilor-obligatii-si-raspunderi ; https://verificatori.ro/cod-urbanism/legea-10-1995-ce-mai-ramane

#### Legea 50/1991 (republicata) · ⚠️ neverificat integral
- **🔴 abrogat** · lege · Parlamentul Romaniei · ediție: Abrogata integral de la 25.08.2026 prin Legea 169/2026 · înlocuit de: Legea 169/2026 (CATUC) · `ofertare_normative.id = 20`
- **Titlu:** Legea privind autorizarea executarii lucrarilor de constructii
- **Ce cere:** (Istoric) art. 2 alin. (1): AC acopera si asigurarea/bransarea-racordarea la infrastructura edilitara; art. 11 alin. (1) lit. f): fara AC — reparatii la instalatii interioare, bransamente si racorduri exterioare aferente constructiilor, in limitele proprietatii (nu si executia de bransamente/retele noi pe domeniul public); retelele noi de distributie gaze necesitau AC; solicitari pentru racordare la sisteme energetice de catre titulari de licenta — termen de solutionare max. 10 zile (neconfirmat articolul).
- **Articole cheie:**
  - art. 11 alin. (1) lit. f) — reparatii bransamente/racorduri in limita proprietatii, fara AC (abrogat)
- **Ofertare:** Autorizatiile emise sub Legea 50/1991 raman valabile (de verificat tranzitoriu). Pentru proceduri noi: regimul CATUC.
- **Clarificări:** 
- **Acces:** public · Sursă: https://legeaz.net/legea-50-1991/art-11

#### HG 273/1994 — Regulament privind receptia constructiilor (forma HG 343/2017) 
- **🟡 modificat** · hg · Guvernul Romaniei · ediție: Forma data de HG 343/2017; mentinut tranzitoriu de Legea 169/2026 art. 577 alin. (6) (dupa verificatori.ro) · `ofertare_normative.id = 21`
- **Titlu:** Regulamentul privind receptia constructiilor (inlocuit integral ca text prin HG 343/2017, MO 406/30.05.2017, in vigoare la 60 zile)
- **Ce cere:** Doua etape: receptia la terminarea lucrarilor si receptia finala (la expirarea garantiei). Executantul comunica in scris terminarea (art. 9); investitorul in 5 zile convoaca (art. 10); comisia: reprezentant investitor (presedinte), reprezentant autoritate emitenta AC, 1-3 specialisti; + ISC (cat. A-C sau D cu fonduri publice), ISU, cultura (art. 11). Suspendare cu termen de remediere max. 90 zile (+ max. 90 zile decalare pentru clima) (art. 17). Investitorul aproba in 3 zile (art. 19). Garantia curge de la semnarea PV de catre investitor (art. 20). Dupa PV nu se mai pot cere remedieri/penalitati decat cele consemnate, exceptand vicii ascunse (art. 21). PV comunicat in 5 zile (art. 23). Receptia finala convocata de proprietar in max. 10 zile de la expirarea garantiei (art. 24).
- **Praguri:**
  - 5 zile convocare (art. 10)
  - 10 zile desemnare membri (art. 10 alin. 2)
  - 3 zile numire comisie
  - remediere max. 90 zile (+90)
  - 3 zile aprobare investitor (art. 19)
  - 5 zile comunicare PV (art. 23)
  - 10 zile convocare receptie finala (art. 24)
  - nou termen 10 zile + 10 zile daca investitorul nu convoaca (art. 14)
- **Documente / atestări:**
  - Comunicare scrisa terminare lucrari (cu confirmare de primire)
  - Cartea tehnica a constructiei (as-built, dispozitii de santier, PV lucrari ascunse, PV faze determinante)
  - Referate proiectant si diriginte de santier
  - Deviz general actualizat / valoare finala
  - Adeverinta ISC privind cotele platite
  - PV receptie partiala (daca e cazul)
- **Verificări / probe:**
  - Examinare nemijlocita a constructiei
  - Probe/expertize suplimentare la suspiciuni rezonabile
- **Articole cheie:**
  - art. 7 — receptie partiala
  - art. 9-10 — declansare
  - art. 11 — componenta comisie
  - art. 14 — investitor pasiv
  - art. 15-18 — examinare/suspendare/admitere/respingere
  - art. 20-21 — data finalizarii, efect liberator
  - art. 24-25 — receptie finala
- **Modificări:**
  - HG 343/2017 — inlocuieste anexa (regulament nou: receptie partiala, suspendare, termene)
  - Legea 169/2026 — il mentine pana la emiterea noului regulament
- **Ofertare:** Termenele de receptie si mecanismul art. 14 (executantul poate forta convocarea) sunt utile in contract; garantia de buna executie se elibereaza legat de PV receptie la terminare / finala.
- **Clarificări:** Clarificari despre cine compune comisia, ce documente se cer pentru receptie la retele de gaze (PV operator distributie), cand incepe garantia.
- **Acces:** public · Sursă: https://www.aicps.ro/media/content/2017-05/hg-343-2017_592ddcf14a495.pdf ; https://isc.gov.ro/files/2021/Mass-media/Receptia%20lucrarilor%20de%20constructii-2021.pdf

#### Legea 123/2012 — Titlul II Gaze naturale 
- **🟡 modificat** · lege · Parlamentul Romaniei · ediție: forma sintetica consultata la 07.01.2019 (Legea 167/2018 etc.); modificari ulterioare 2020-2026 neverificate pe articolele de mai jos · `ofertare_normative.id = 3`
- **Titlu:** Legea energiei electrice si a gazelor naturale
- **Ce cere:** Proiectarea si executia obiectivelor/sistemelor de gaze, inclusiv modificari/extinderi, doar de operatori economici autorizati ANRE (art. 121 alin. (1)-(2)) si persoane fizice instalatori autorizati ANRE (alin. (3)). Concesionarul (operatorul de distributie) are drept de uz pentru executarea lucrarilor (art. 109-110: depozitare materiale, desfiintare culturi strict necesar, organizare de santier), servitute legala de trecere subterana (art. 112), exercitat fara inscriere in CF (art. 113 alin. (1)); despagubiri prin conventie-cadru (alin. (3)-(7)). Zone de protectie/siguranta prin norme ANRE (art. 117).
- **Documente / atestări:**
  - Autorizatie ANRE tip EDIB/EDSB/PDSB etc. pentru operatorul economic
  - Legitimatii instalatori autorizati ANRE
- **Articole cheie:**
  - art. 108 — drepturile concesionarului asupra bunurilor tertilor
  - art. 109-113 — drept de uz/servitute
  - art. 114 alin. (2) — interventii urgente fara avize
  - art. 117 — zone protectie
  - art. 121 — proiectare/executie numai autorizati ANRE
  - art. 194 — contraventii
- **Modificări:**
  - Legea 127/2014 — art. 113 (drept de uz/servitute fara inscriere in CF, conventie-cadru 30 zile)
  - Legea 167/2018 — art. 121 alin. (1) (autorizare ANRE proiectare/executie/exploatare)
- **Ofertare:** Autorizatia ANRE adecvata e cerinta de calificare legala la lucrari de gaze. Executantul lucreaza in numele/pe dreptul de uz al operatorului de distributie — acordurile proprietarilor nu ar trebui sa fie in sarcina executantului fara clauza expresa.
- **Clarificări:** Cine obtine acordurile/conventiile cu proprietarii si cine plateste despagubirile (art. 113) — clarificare frecventa la extinderi in extravilan.
- **Acces:** public · Sursă: https://www.omvpetrom.com/downloads/2025/06/4a42ce5a-3445-b934-1a06-1ef506b60ac8/legea%20nr%20123%202012%20a%20energiei%20electrice%20si%20a%20gazelor%20naturale.pdf

#### Legea 319/2006 · ⚠️ neverificat integral
- **🟢 în vigoare** · lege · Parlamentul Romaniei · ediție: cu modificarile ulterioare (neverificate in detaliu) · `ofertare_normative.id = 15`
- **Titlu:** Legea securitatii si sanatatii in munca
- **Ce cere:** Evaluarea riscurilor, servicii SSM interne/externe, instruire, EIP. Baza pentru planul propriu de SSM al executantului.
- **Ofertare:** AC cer de regula declaratie de respectare a obligatiilor SSM (art. 51 L98) — nu certificate.
- **Clarificări:** 
- **Acces:** public · Sursă: https://www.iprotectiamuncii.ro/legislatie-protectia-muncii/hg-300-2006

#### HG 1425/2006 · ⚠️ neverificat integral
- **🟡 modificat** · hg · Guvernul Romaniei · ediție: modificat (ex. HG 955/2010) — neverificat · `ofertare_normative.id = 16`
- **Titlu:** Normele metodologice de aplicare a Legii 319/2006
- **Ce cere:** Organizarea activitatii SSM, instruirea (introductiv-generala, la locul de munca, periodica), evaluarea riscurilor, avizarea documentatiilor.
- **Ofertare:** Fise de instruire, evaluare riscuri pe santier — documente de executie, nu de calificare.
- **Clarificări:** 
- **Acces:** public · Sursă: https://www.iprotectiamuncii.ro/

#### HG 300/2006 · ⚠️ neverificat integral
- **🟡 modificat** · hg · Guvernul Romaniei · ediție: modificata prin HG 601/2007 (neverificat) · `ofertare_normative.id = 14`
- **Titlu:** Cerintele minime de securitate si sanatate pentru santierele temporare sau mobile
- **Ce cere:** Beneficiarul/managerul de proiect numeste coordonator(i) SSM pentru faza de proiectare si de executie cand pe santier lucreaza mai multi antreprenori; plan de securitate si sanatate (PSS) al lucrarii; planurile proprii ale antreprenorilor se integreaza in PSS si se avizeaza de coordonator inainte de inceperea lucrarilor (art. 15); declaratie prealabila la ITM cu min. 30 zile inainte (pentru santiere peste pragul de durata/efectiv — prag exact neverificat; uzual >30 zile lucratoare si >20 lucratori simultan sau >500 om-zile).
- **Documente / atestări:**
  - Plan propriu de SSM al antreprenorului
  - Contract coordonator SSM (sarcina beneficiarului)
  - Declaratie prealabila ITM (anexa 3)
- **Articole cheie:**
  - art. 9 — atributiile coordonatorilor (participare la toate etapele)
  - art. 15 — integrarea planurilor proprii in PSS, avizare inainte de start
- **Ofertare:** Coordonatorul SSM e obligatia beneficiarului; daca AC il pune in sarcina executantului fara a-l prevedea in F1/F3 (cheltuieli), este cost neprevazut -> clarificare.
- **Clarificări:** Cine asigura coordonatorul SSM si cine depune declaratia prealabila; costul PSS.
- **Acces:** public · Sursă: https://www.iprotectiamuncii.ro/legislatie-protectia-muncii/hg-300-2006

#### HG 766/1997 · ⚠️ neverificat integral
- **🟢 în vigoare** · hg · Guvernul Romaniei · ediție: mentinute anexele 1-5 de Legea 169/2026 art. 577 alin. (3) (dupa verificatori.ro)
- **Titlu:** Regulamente privind calitatea in constructii (anexe: urmarirea comportarii, cartea tehnica, categorii de importanta — anexa 3, conducerea si asigurarea calitatii etc.)
- **Ce cere:** Cartea tehnica a constructiei (continut, cine o intocmeste: investitorul cu documente de la executant), categoriile de importanta A-D (anexa 3, folosite de HG 273 pentru prezenta ISC).
- **Documente / atestări:**
  - Documente pentru cartea tehnica: certificate calitate materiale, declaratii de performanta, PV lucrari ascunse, PV faze determinante, buletine probe, as-built
- **Ofertare:** Lista documentelor de calitate pe care executantul le preda la receptie — trebuie bugetata (laborator, probe).
- **Clarificări:** 
- **Acces:** public · Sursă: https://verificatori.ro/cod-urbanism/legea-10-1995-ce-mai-ramane

#### HG 925/1995 · ⚠️ neverificat integral
- **🟢 în vigoare** · hg · Guvernul Romaniei · ediție: mentinut tranzitoriu de Legea 169/2026 art. 577 alin. (5) (dupa verificatori.ro)
- **Titlu:** Regulamentul de verificare si expertizare tehnica de calitate a proiectelor, a executiei lucrarilor si a constructiilor
- **Ce cere:** Proiectele se verifica de verificatori atestati pe cerinte esentiale; executia porneste doar pe proiecte verificate.
- **Ofertare:** Daca PT/DE nu are verificare pe cerinta relevanta (ex. instalatii gaze — Is), executantul sesizeaza (obligatie legala) — sursa de clarificare.
- **Clarificări:** 
- **Acces:** public · Sursă: https://verificatori.ro/cod-urbanism/legea-10-1995-ce-mai-ramane

#### Ordin MDRAP 1895/2016 · ⚠️ neverificat integral
- **🟢 în vigoare** · ordin · MDRAP · ediție: 31.08.2016; statut post-CATUC (art. 459 Legea 169/2026) neverificat · `ofertare_normative.id = 26`
- **Titlu:** Procedura privind autorizarea si exercitarea dreptului de practica a responsabililor tehnici cu executia (RTE)
- **Ce cere:** RTE autorizati ISC pe domenii (1.1 ... 9.2), inscrisi in registrul public ISC; practica doar ca angajati ai executantului (CIM sau contract prestari servicii).
- **Documente / atestări:**
  - Autorizatie RTE ISC + legitimatie/stampila, domeniul corespunzator lucrarii (pentru retele gaze/apa: domeniile de retele edilitare — de verificat codul exact)
- **Ofertare:** Personal cheie frecvent cerut; verificati domeniul exact cerut de AC vs domeniul din autorizatie (registru ISC).
- **Clarificări:** Daca AC cere 'RTE pentru gaze' — RTE e pe domenii de constructii; partea de gaze se acopera prin autorizarea ANRE (instalator/ responsabil tehnic ANRE). Clarificare de echivalenta.
- **Acces:** public · Sursă: https://edirect.e-guvernare.ro/Uploads/Legi/35890/Ordin%20MDRAP_1895%202016_Procedura%20RTE.doc.pdf

#### Ordin MDRAP 2264/2018 
- **🟢 în vigoare** · ordin · MDRAP · ediție: MO 240/19.03.2018 (a abrogat Ordinul 777/2003) · `ofertare_normative.id = 25`
- **Titlu:** Procedura privind atestarea verificatorilor de proiecte si a expertilor tehnici in constructii
- **Ce cere:** Atestarea verificatorilor de proiecte (VP) si expertilor tehnici (ET) pe cerinte/domenii. NU priveste RTE (acestia sunt in Ordinul 1895/2016).
- **Ofertare:** Relevant doar la contracte de proiectare+executie (verificare proiect) sau expertize.
- **Clarificări:** 
- **Acces:** public · Sursă: https://lege5.ro/gratuit/gi3tgobqgiza/ordinul-nr-2264-2018-pentru-aprobarea-procedurii-privind-atestarea-verificatorilor-de-proiecte-si-a-expertilor-tehnici-in-constructii

#### Ordin MDRAP 1370/2014 — Procedura PCF 002 · ⚠️ neverificat integral
- **🟢 în vigoare** · ordin · MDRAP · ediție: 25.07.2014; statut post-CATUC neverificat
- **Titlu:** Procedura privind efectuarea controlului de stat in faze de executie determinante pentru rezistenta mecanica si stabilitatea constructiilor (PCF 002)
- **Ce cere:** Programul de faze determinante (stabilit de proiectant) se transmite ISC; executantul convoaca factorii la fiecare faza determinanta; PV faza determinanta intra in cartea tehnica.
- **Ofertare:** La retele ingropate fazele determinante tipice: pozare conducta inainte de umplere, probe de presiune (de confirmat in programul proiectantului).
- **Clarificări:** 
- **Acces:** public · Sursă: https://isc.gov.ro/files/2016/Legislatie/ORDIN%20nr%201370%20din%202014%20si%20Procedura.pdf

#### Legea 98/2016 art. 200-201 
- **🟢 în vigoare** · lege · Parlamentul Romaniei · ediție: forma in vigoare 2026 (art. 200 alin. (3) verificat prin CNSC 2021) · `ofertare_normative.id = 5`
- **Titlu:** Standarde de asigurare a calitatii si de management de mediu (cerinte de calificare)
- **Ce cere:** AC poate cere certificate emise de organisme independente (acreditate) privind standardele de calitate (art. 200) si de mediu (art. 201); recunoaste certificatele echivalente din alte state UE; art. 200 alin. (3): daca ofertantul demonstreaza ca nu a avut acces la certificat sau nu il poate obtine in termen din motive neimputabile, AC trebuie sa accepte alte probe care confirma un nivel echivalent al calitatii/mediului.
- **Documente / atestări:**
  - Certificat ISO 9001 (si 14001) emis de organism acreditat (RENAR sau membru EA/IAF MLA)
  - Alternativ: probe de masuri echivalente (manual, proceduri, audituri) — doar in conditiile alin. (3)
- **Verificări / probe:**
  - Certificatul in termen de valabilitate la data depunerii
  - Domeniul certificatului acopera obiectul (ex. 'executie retele gaze')
  - Organism de certificare acreditat
- **Articole cheie:**
  - art. 200 alin. (3) — alte probe echivalente (citat in CNSC BO2021_1451)
  - art. 201 — management de mediu (EMAS / ISO 14001 / echivalent)
- **Ofertare:** Echivalenta e o exceptie strict conditionata: CNSC (BO2021_1451, respinsa) — certificarea 'in curs' + Manualul calitatii NU dovedesc echivalenta. ISO 45001 nu are articol dedicat in L98 (art. 200 vizeaza calitatea, 201 mediul); cererea lui ca cerinta de calificare poate fi contestata ca restrictiva/ fara temei (de verificat practica CNSC).
- **Clarificări:** Cerere ca AC sa accepte certificate echivalente / alte probe; clarificare domeniu certificat; ISO 45001 — temei legal.
- **Acces:** public · Sursă: http://portal.cnsc.ro/sivadoc/download.aspx?docUID=YTA1N2Y5NTYtMDg4YS00OTNkLTg3OGMtNjYzZjdmMjRjMmMx&pdfa1=ZmFsc2U%3D&filename=Qk8yMDIxXzE0NTEucGRm&action=aW5saW5l

#### SR EN ISO 9001:2015 / SR EN ISO 14001:2015 / SR ISO 45001:2018 · ⚠️ neverificat integral
- **🟢 în vigoare** · standard · ISO / ASRO · ediție: ISO 9001:2015 (amendament Amd 1:2024 privind schimbarile climatice); 14001:2015 (Amd 1:2024); 45001:2018 (Amd 1:2024). Revizia ISO 9001 programata ~2026 — neverificat
- **Titlu:** Sisteme de management al calitatii / mediului / SSM
- **Ce cere:** Certificare de catre organism acreditat (in Romania: acreditare RENAR, sau acreditari straine recunoscute prin EA MLA/IAF MLA).
- **Verificări / probe:**
  - Verificare certificat in baza de date a organismului / IAF CertSearch
  - Acreditarea organismului pe codul EA al constructiilor (EA 28)
- **Ofertare:** Mentinere certificate valabile + domeniu care include 'executie retele de distributie gaze naturale, retele apa-canal'.
- **Clarificări:** 
- **Acces:** platit · Sursă: https://www.iso.org

## Anexă — Corecturi `ofertare_normative`: note pe teme

### Din cercetarea „Achiziții publice și contracte tip”

| id | Identificator | Observație |
|---|---|---|
| 5 | Legea 98/2016 | Corect. Notați versiunea: ultimul modificator verificat este OUG 52/2024; pragurile din 2026 se aplică direct prin regulamentele UE. Art. 222^2 (ajustare) și art. 154–154^2 (garanții) sunt acum în lege. |
| 7 | Legea 99/2016 | Corect. Adăugați nota că operatorii de distribuție gaze și apă sunt entități sectoriale. |
| 8 | HG 394/2016 | Corect. Modificată și de HG 336/2023. |
| 9 | HG 395/2016 | Corect, dar **art. 164 este abrogat** (HG 336/2023). Ultimul modificator verificat este OUG 52/2024. Art. 136 alin. (4) (80%) a fost introdus de HG 375/2022. |
| 10 | Legea 101/2016 | Corect. Versiunea consolidată curentă nu a fost verificată (se recomandă procurarea ei). |
| — | **Lipsesc** | De adăugat: **HG 1/2018** (contracte tip, obligatoriu peste prag); **Instrucțiunea ANAP 2/2017** (experiență similară); OUG 98/2017 (control ex-ante); OUG 47/2022 și OUG 64/2022 (ajustare); documentul ANAP 2023 „Cele mai frecvente neconformități — lucrări”. |
| — | Concepte greșite în brief | „HG 1336/2022 = ajustare” este greșit (HG pentru resurse umane). „OUG 114/2011 = GBE” este greșit (privește apărarea). „OUG 25/2023” nu există ca modificator al L98. Pragul de lucrări 2024–2025 a fost 5.538.000 EUR, iar pentru 2026–2027 este 5.404.000 EUR. |

### Din cercetarea „ANRE, gaze, ISCIR, apă-canal”

| id | Actual | Corectură |
|---|---|---|
| 1 | Ordin ANRE 89/2018 (NTPEE-2018) | De adăugat „modificat prin Ordin ANRE 2/2023 (MO 67/26.01.2023)”. Nu am găsit modificări 2024–2026 (neconfirmat complet). |
| 2 | Ordin ANRE 118/2013 | De adăugat modificările Ordin 75/2014 și Ordin 41/2018. |
| 22 | Ordin ANRE 132/2021, „înlocuit din 2026, VERIFICĂ” | **Confirmat: abrogat prin Ordin ANRE 17/21.05.2026, MO 444/26.05.2026.** Rând nou pentru Ordinul 17/2026. |
| 23 | Ordin ANRE 182/2020 | **Înlocuit prin Ordin ANRE 65/2023 (MO 409/12.05.2023), modificat prin Ordin ANRE 85/2024 (MO 1225/05.12.2024).** |
| 27 | NT ANRE 18.03.2025 amonte | Identificator corect: **Ordin ANRE 8/2025**, MO 378/29.04.2025. |
| 28 | Ordin ANRE 7/2022, „racordare? VERIFICĂ nr.” | **Confirmat: Regulamentul privind racordarea la SD gaze, MO 196/28.02.2022**, a abrogat Ordinul 18/2021. |
| nou | — | De adăugat: **Ordin ANRE 156/2020** (Procedura IU, înlocuiește trimiterile la Ordinul 32/2012); **PT CR 6/7/9-2025** (Ordin MEDAT 1172/2026), care înlocuiesc PT CR 2013; **NP 133-2022** vol. I/II/III (Ordinele MDLPA 15, 14 și 19/2023), care înlocuiește NP 133-2013. |
| 31 | SR EN 12327:2012 | Ok ca referință, dar valorile de probă din România sunt cele din NTPEE. |

### Din cercetarea „Sudură, NDT, izolație, materiale”

| id | Acum în tabelă | Corect / de actualizat |
|---|---|---|
| 1 | Ordin ANRE 89/2018 | Adaugă „modificat prin Ord. ANRE 2/2023 (MO 67/26.01.2023)”. Afectează art. 254, 268-273 (tabel 8, tabel 81 nou). Anexa 2 conține ediții depășite. |
| 30 | SR EN 12007-1…-5 | -5 este acum **SR EN 12007-5:2024** (înlocuiește 2014). Restul: -1:2012, -2:2012, -3:2015, -4:2012. |
| 31 | SR EN 12327:2012 | OK la CEN (2012 e ediția curentă). Ediția SR neconfirmată. |
| 32 | SR EN ISO 15614-1:2017+A1:2019 | OK. Notează DAmd 2 / prEN ISO 15614-1 în revizie. |
| 33 | SR EN ISO 9606-1:2017 | OK (ASRO: în vigoare, 235,60 Lei). ISO/DIS 9606 în anchetă. |
| 34 | SR EN ISO 3834-2 | Precizează **:2021**. SR EN ISO 3834-2:2006 e ANULAT. Adaugă EN ISO 3834-6:2024. |
| 35 | SR EN ISO 17636-1/-2:2022 | **-1:2022; -2:2023** (SR EN ISO 17636-2:2023 înlocuiește 2013). |
| 36 | SR EN ISO 17637:2017 | OK. |
| 37 | SR EN ISO 5817:2023 | OK. |
| 38 | SR EN 12068:1999 | **SR EN 12068:2002** (în vigoare, ASRO). 1999 e data DIN EN. Nu e înlocuit de 21809-3. |
| 39 | DIN 30672-1/-2:2019 | **NECONFIRMAT.** Am găsit doar DIN 30672 (2000) și un titlu nou „up to 50 °C” fără an. De verificat la DIN Media. |
| 40 | SR EN ISO 21809-1/-3 (NECONFIRMAT) | **-1: SR EN ISO 21809-1:2019** (ISO 2018), confirmat prin specificația Distrigaz. **-3: EN ISO 21809-3:2016+A1:2020**; ISO/FDIS 21809-3 în aprobare, va înlocui 2016. Ediția SR neconfirmată. |
| 41 | SR EN 12954:2019 | OK la CEN (înlocuiește 2001). Ediția SR neconfirmată. NTPEE citează încă 2002. |
| 42 | SR EN ISO 15589-1 | **EN ISO 15589-1:2026** adoptat de CEN (doa 31.10.2026). Până la preluarea SR rămâne SR EN ISO 15589-1:2017. |
| 43 | SR EN 1555-1…-5 | **SR EN 1555-1…-4:2025** (înlocuiesc 2021, BS 12/2025). Partea 5: ediție neconfirmată. |
| 44 | SR EN 13067:2020 | OK la CEN. prEN 13067 rev în curs. NTPEE citează 2013. |
| 45 | SR EN ISO 9712:2022 | OK (confirmat prin PT CR 6-2025). |
| 46 | SR EN ISO 17635 | **:2025** (înlocuiește 2017). |
| nou | — | De adăugat: **PT CR 6/7/9-2025 ISCIR** (Ordin MEDAT 1172/2026); SR EN ISO 10675-1:2022; SR EN ISO 17640:2019; SR EN ISO 11666:2018; SR EN ISO 15609-1:2020; SR EN ISO 14732:2025; SR EN 12732+A1:2014; SR EN 10204:2005; SR EN ISO 3183:2020; SR EN ISO 8501-1:2007; SR EN 15001-1/-2:2023; DVS 2207-1:2015. |

---

### Din cercetarea „Norme de deviz și legi conexe”

- **id 20, Legea 50/1991:** este ABROGATĂ din 25.08.2026 (Legea 169/2026). Trebuie adăugată Legea 169/2026 (CATUC) ca înregistrare nouă.
- **id 4, Legea 10/1995:** este abrogată în proporție covârșitoare din 25.08.2026. Rămân doar art. 10 și 41.
- **id 21, HG 273/1994:** rămâne în vigoare. Trebuie notat că textul actual este cel din HG 343/2017 și că e menținut tranzitoriu de Legea 169/2026 art. 577 alin. (6) (neconfirmat pe textul oficial).
- **id 25, Ordin 2264/2018:** obiectul e atestarea verificatorilor de proiecte și a experților tehnici, nu RTE și nici recepție.
- **id 6, HG 907/2016:** de adăugat că a abrogat Ordinul 863/2008 și HG 28/2008, și că F3 e în anexa PT.
- **De adăugat:** Ghidul P91/1-02 (Ordin 1568/2002), OUG 156/2024 art. LXIX (salariul minim în construcții), HG 146/2026, Ordin 1370/2014 (PCF 002), HG 766/1997, HG 925/1995.

### Din cercetarea „Gaze naturale”

- **id 22 – Ordin ANRE 132/2021 (Regulament autorizare OE).** Deciziile din 2022–2024 (BO2022_1615, BO2024_3288, BO2024_2636) îl citează ca în vigoare. Deciziile 2025–2026 citite nu menționează un regulament nou, așa că **nu am putut confirma nota „înlocuit din 2026”**. Rămâne de verificat pe anre.ro (`verificat: false` pentru această afirmație).
- **Predecesorul lui id 22:** decizia BO2023_657 (din 2023) aplică încă Ordinul ANRE **98/2015** (art. 1 alin. 3), regulamentul anterior. Sugestie: se adaugă în tabelă ca „abrogat – înlocuit de Ord. ANRE 132/2021”, util la contractele vechi de ES.
- **Lipsesc din tabelă, dar sunt citate de CNSC ca relevante pentru gaze:**
  - HG 209/2019 (cadrul general pentru concesiunea distribuției gazelor; BO2026_2669);
  - HG 343/2017 (recepția lucrărilor; BO2026_182);
  - Instrucțiunea ANAP nr. 2/2017 (experiența similară);
  - Instrucțiunea ANAP nr. 1/2017 (personalul și factorii de evaluare).
  - Le propun ca intrări noi.
- **id 1 (Ord. 89/2018) și id 2 (Ord. 118/2013)** sunt confirmate ca reper de CNSC (BO2023_1378) pentru delimitarea distribuție/transport. Totuși, CNSC a decis că această delimitare tehnică NU justifică respingerea ES.

### Din cercetarea „Apă-canal și teme transversale”

- **Lipsesc din tabelă și sunt invocate frecvent:**
  - **OUG 64/2022** (ajustarea prețurilor, proiecte pe fonduri externe nerambursabile);
  - **OUG 114/2017** cu modificările ulterioare (facilități și salariu minim în construcții) și **OUG 168/2022** (4.000 lei din 2023);
  - **Instrucțiunea ANAP 2/2017** (terț susținător/DUAE);
  - **HG 1/2018** (condiții contractuale lucrări — Anexa 2 pct. 7.1 subcontractare);
  - **Legea apelor 107/1996** (aviz GA);
  - **NP 133** (normativ rețele apă-canal — probe de etanșeitate).
- **Id 7 (Legea 99/2016) și id 8 (HG 394/2016)** trebuie marcate relevante pentru **operatorii regionali de apă-canal**, care sunt adesea entități contractante sectoriale (2344/2025, 2237/2023). Acolo pragul PNS, înlocuirea terțului și clarificările se aplică după art. 222 și art. 197 L99 și art. 138–142 HG 394, nu după L98.
- Nu am găsit erori de număr sau stare la id-urile 5, 9 și 10 (Legea 98/2016, HG 395/2016, Legea 101/2016) din perspectiva acestei teme.
