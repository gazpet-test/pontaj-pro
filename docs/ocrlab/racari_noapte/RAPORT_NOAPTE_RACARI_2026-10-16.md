# Raport de noapte — OCR pe Răcari (licitația 15), 15→16.10.2026

Rulare de TEST locală `rt1`, fără BD (nimic scris în producție, nicio migrare, niciun deploy). PDF-urile sunt originalele SEAP de pe NAS, potrivite exact cu cele 19 documente procesate din BD (SHA în `ocrlab\racari_manifest.json`).
**Cost plătit de laborator: 0 USD.** Arbitrajul arb-v2 n-a rulat: pe o rulare locală ar cere o operație BD în afara pipeline-ului. Pragul de 15 USD n-a fost atins.

## Tabel — 3 surse de adevăr ținute separat
**Referința verificată pe imagine** = 48 de cantități de pe 3 pagini din lista de cantități (d205 p7 C6, p106 C6, p110 C9), citite de laborator pe imagine mărită.
**Consensul AI** = valoare prezentă în ≥3 din 4 surse (LightOn, MinerU, H4.5, H5.5), pe setul comun de 72 de pagini (pag. 1–8 din 9 documente). E înclinat spre cititoarele locale, care sunt 2 din cele 4 surse.

| Variantă | Pagini citite | Referință pe imagine (48) | Consens AI (acoperire) | Numere fără sprijin* | Pagini goale/lipsă | Durată | Cost |
|---|---|---|---|---|---|---|---|
| LightOn local | 554/585 (31 excluse: 22 planșe, 9 neclasificate) | **48/48** | 99,9% | 46 | 3 (planșe excluse) | 36 min / 960 benzi | 0 |
| MinerU local | 554/585 | **48/48** | 99,8% | 33 | 3 (idem) | 38 min | 0 |
| Haiku 5.5 (citire_test) | 71/72 | **47/48** (p106: 0.191 în loc de 0.19) | 98,4% | 45 | 1 | ~26 s / 8 pag. | ~0,0008 USD/pag. |
| Haiku 4.5 (citire_test) | 64/72 | **1/48** | 74,3% | 351 | 8 | ~70 s / 8 pag. | ~0,006 USD/pag. |
| text_extras din BD | — (fără marcaje de pagină) | p106/p110: **0** din valorile distinctive | listă cantități: 56% (pag. 1–104) / 37% (pag. 105–176) din zecimalele distincte LightOn | — | — | — | — |

\* număr prezent doar la acea sursă, adică candidat de halucinație sau de eroare OCR, neverificat individual.
Gărzi: 18 benzi LightOn și 12 benzi MinerU oprite din 960. Cele verificate sunt bucle reale (d205 p8: „T. 24” repetat după un tabel corect); garda oprește doar banda.
Dezacorduri LightOn↔MinerU rămase: 6.972 (5.218 marcate „cu cantitate”), din care 2.581 pe lista de cantități (725 de rânduri pe care MinerU le-a omis, 312 omise de LightOn). Arbitrajul lor ar costa ~25 USD la tariful din proba r1, peste plafon.

## Exemple decisive (doc 213 = lista de cantități, pag. 105–176)
- **p2 (= d205 p106, C6 BPM8):** pe imagine e formularul C6 (CIMENT METALURGIC 77.50 KG, NISIP 37.50, CABLU 255.00 M, ȚEAVĂ HDPE80 240.00 M). **Haiku 4.5 a halucinat** o listă „CORP ROBINET / PRESETARE ROBINET … 1.000” care nu există pe pagină. Haiku 5.5 are structura corectă, cu 3 greșeli: 0.191 în loc de 0.19 (rândul 3), „30 SACI S 1500” mutat la rândul 2, denumirea țevii de la rândul 7 prescurtată. LightOn și MinerU au toate cele 22 de cantități. În text_extras nu apare niciuna dintre 77.50 / 37.50 / 255.00 / 240.00.
- **p6 (= d205 p110, C9):** pe imagine scrie **114.402** = 112.000 + 1.500 + 0.902. Haiku 5.5, LightOn și MinerU au valoarea corectă. Haiku 4.5 dă 114.902 (greșit) și un tabel incoerent. text_extras nu conține nici 114.402, nici 112.000.
- **d205 p7 (C6 DE4198):** Haiku 4.5 a scris doar 2 numere de pe toată pagina. Haiku 5.5, LightOn și MinerU au 22/22. În text_extras lipsește 142.80.
- **6.400 m (F3) vs 3.995 m (ATR):** nu le-am atins. Sunt valori din documente diferite și se păstrează amândouă, cu sursa; nu se decid prin vot.

## Ce s-a mai aflat la noapte
- **Clasificatorul de pagini a exclus 140 din 176 de pagini ale listei de cantități** (le-a luat drept „planșe”). Pe Răcari am rulat cu suprascrierea `--kind quantity_table`, iar planul automat e păstrat ca dovadă (`rt1\d205_auto`).
- **Orientarea:** proba LightOn pe fâșie NU deosebește 0°/180° sau 90°/270°, pentru că modelul citește bine și textul întors. Proiecția a greșit axa pe unele pagini (de exemplu, d205 p8). Prima mea clasificare vizuală a d205 era inversată (90 ↔ 270) și am prins-o doar verificând pagina DUPĂ rotire. Regula care rezultă: orientarea se confirmă pe imaginea rotită, nu pe miniatură. Orientările din rt1 sunt ale laboratorului, nu confirmate de om (sursa e scrisă per pagină).
- **Banca Opus:** 565 de zone etichetate (74 min, abonament, 0 refuzuri de acces); 72% „sigur”, 27% „nesigur”. Astra nu a rulat: run_paw v4.2 nu e instalat.
- **Blocaje ale filtrului de permisiuni** (nu le-am ocolit): exportul text_extras pe disc (motiv: date personale) și activarea trecerii B (trimitere la OpenAI).

## Trei decizii binare
1. **Listele de cantități scanate (Răcari doc 205 și altele la fel): DA/NU** — se folosește în Ofertare citirea locală (LightOn + MinerU, cu arbitraj pe dezacorduri) în locul text_extras, care pierde 44–63% din cantități? Recomand **DA**, întâi ca tabel de test lângă cel existent.
2. **Haiku 4.5 pe documente scanate: DA/NU la oprire** — halucinează pagini întregi (1/48 pe referința verificată). Recomand **DA**: oprire, cu înlocuire prin Haiku 5.5 sau citire locală.
3. **Arbitrajul pe Răcari (~25 USD estimat, peste plafonul de 15): DA/NU** — se pornește doar pe triere HIGH-RISK (cantități), sub plafon, după repararea clasificatorului de pagini? Recomand **DA, condiționat**: întâi reparația clasificatorului, apoi proba arb-v2 de ≤2 USD.

Fișiere: `ocrlab\racari_manifest.json`, `ocrlab\racari\rt1\` (citiri, `orientari_*.json`, `dezacorduri_rt1.jsonl`), `ocrlab\racari\comparatie_numere.json`, `ocrlab\racari\verificat_imagine.json`, `banca\v2\out\A\`.
