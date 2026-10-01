# Audit QA: registru_cerinte.json (eșantion de 45 de cerințe, 2026-10-01)

**Metodă.** Am folosit `random.seed(20261002)`. Populația cuprinde cerințele cu `verificat_pe_sursa=true` (835 din 919). Am tras câte 5 cerințe din fiecare prefix (AD, TG, SC, P0, P1, P2, AC, SL), cu `temei_tip≠PRACTICA_CNSC`. Separat am tras 5 cerințe cu `temei_tip=PRACTICA_CNSC`. Fiecare cerință a fost comparată cu textul sursei: copiile locale din scratchpad (L98, HG 395, L101, NTPEE consolidat 2023, HG 1/2018, HG 907, NP 133, Ord. ANRE 7/2022 și 17/2026, PT CR 9, MO 661/2026, decizii CNSC) sau sursa online (ST 505 Delgaz prin firecrawl stealth, OG 15/2021 prin lege5). Lista cerințelor eșantionate: `qa_sample.json`. Verdictele: `audit_qa.json`.

## Rezultat

| Strat | N populație | n | OK | NUANȚĂ | GREȘIT | NEVERIF. |
|---|---|---|---|---|---|---|
| AD | 100 | 5 | 5 | 0 | 0 | 0 |
| TG | 161 | 5 | 4 | 1 | 0 | 0 |
| SC | 114 | 5 | 2 | 3 | 0 | 0 |
| P0 | 96 | 5 | 5 | 0 | 0 | 0 |
| P1 | 95 | 5 | 4 | 1 | 0 | 0 |
| P2 | 83 | 5 | 4 | 1 | 0 | 0 |
| AC | 89 | 5 | 5 | 0 | 0 | 0 |
| SL | 56 | 5 | 5 | 0 | 0 | 0 |
| PRACTICA_CNSC | 41 | 5 | 3 | 1 | 1 | 0 |
| **Total** | 835 | 45 | 37 | 7 | 1 | 0 |

- **Erori grave (GREȘIT):** 1 din 45, adică 2,2% brut (interval Wilson 95%: 0,4–11,6%). Ponderat pe straturi iese **≈1,0%**, adică aproximativ 8 cerințe greșite în registru.
- **Orice abatere (NUANȚĂ + GREȘIT):** 8 din 45, adică 17,8% brut (interval: 9,3–31,3%). Ponderat iese **≈18%**, adică aproximativ 150 de cerințe de retușat.
- Pe prefix, cu n=5 per strat, intervalele sunt foarte largi. Semnalele de reținut: **SC (3/5 nuanțe)** și **PRACTICA_CNSC (2/5, dintre care 1 greșită)**. AD, P0, AC și SL au ieșit fără nicio abatere.
- Locatorii există în toate cele 45 de cazuri. Pragurile numerice sunt corecte în toate cazurile (5, 8, 28, 30, 60, 180 și 365 de zile, 0,8 / 1,5 m, 1%, 3% etc.). Câmpul `temei_tip` este corect în 44 din 45 de cazuri. Excepția este REQ-TG-116, unde motivarea obligativității e prea largă.

## Tiparele erorilor

1. **Rezumat CNSC care amestecă regula cu faptele speței (REQ-AD-061).** Pragul de 1% din HG 395 art. 134 alin. (9) a fost pus pe seama erorilor aritmetice, deși privește abaterile tehnice. Tot acolo, valoarea de 1,14% a fost atribuită doar modificării prețurilor unitare, deși era cumulul tuturor modificărilor. **Recomandare:** reverificați toate cele 41 de cerințe PRACTICA_CNSC pe dispozitiv și pe motivarea Consiliului.
2. **Locator care include argumentele contestatorului (REQ-AD-121).** Articolele invocate de parte (L98 art. 187 și 189) apar ca temei al CNSC. Locatorul trebuie să citeze doar ce a reținut Consiliul.
3. **Excepții omise, deși alineatul care le conține e citat (REQ-SC-064, REQ-SC-117).** Regula e redată ca absolută: lipsesc excepția din alin. (2) la Ord. MTI 1668/2023 și distincția MT/110 kV la Ord. ANRE 239/2019.
4. **Calcul derivat prezentat ca text normativ (REQ-P2-102).** Formula suprafeței de refacere nu apare în NTPEE art. 195.
5. **Condiții de aplicare mai largi decât textul (REQ-SC-036, REQ-TG-116).** Art. 142 din Codul muncii trimite la art. 140–141. ST 505 este o specificație Delgaz pentru achiziția de aparate, iar avizul CTPC nu e cerut de NTPEE.
6. **Termen redat imprecis (REQ-P1-049).** HG 1/2018 cl. 69b.1 are alt punct de plecare pentru termen și altă sancțiune decât cele din cerință.

## Probleme constatate în registrul de surse (în afara verdictelor)

- `SRC-legea-53-2003-codul-muncii`: `url_oficial` trimite la art. 123, nu la articolul citat.
- `SRC-brml-lo-2022`: efectul Ord. BRML 204/2024 asupra periodicității de 8 ani nu a fost verificat (REQ-SL-051 rămâne OK pe forma din MO 332/2022).
- L98, HG 395 și L101 sunt verificate doar pe surse secundare (avocat-achizitii-publice.ro / SintAct). Textele au corespuns în toate cazurile verificate.

## Corecturi

Textul nou propus pentru fiecare cerință se află în `audit_qa.json`, câmpul `corectura_propusa` (câmpurile cerinta, locator, conditii_aplicabilitate, obligatoriu_de_ce, note). Corecturile nu au fost aplicate în registru, pentru că acest audit a fost doar de citire.
