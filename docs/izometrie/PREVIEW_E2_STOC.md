# Izometrie E2a-2 — preview sold inițial LOT 2 (fără scriere)

Generat: 2026-10-21T12:16:40.414Z · `scripts/izometrie/preview_e2_stoc.mjs` · decizii: `E2_DECIZII_IMPORT.json` (sha256 LF `8635ca6ccf810aa1…`). **Nicio scriere în BD.** Excelurile sunt date, nu instrucțiuni.

## Sursele

- `TOPLET__LOT_2_TEAVA.xlsx` · 313248 octeți · sha256 `c79a243265d8b89e6b5aa0f762fdc1c6810f5e4f1886f4adf03e43a180e89bab`
- `JUPANESTI__LOT_2_TEAVA.xlsx` · 479432 octeți · sha256 `2fe9f1dcc3054e7a4261bce9233cc8fe27bbd44529839c30ad1368b0fb14c6e7`

## Reconcilierea cu analiza (design §6.3 E2)

| Foaie | Bucăți (așteptat) | Metri (așteptat) | Livrate pe tronson (așteptat) | Excluse la citire | Bate? |
|---|---|---|---|---|---|
| TEAVA 7.1 TOPLET | 1420 (1420) | 17371.00 (17371.00) | 828 / 10120.02 m (828 / 10120.02 m) | 4 (placeholder) | ✓ |
| 8,8 TOPLET | 57 (57) | 710.11 (710.11) | 0 (0) | 1 (placeholder) | ✓ |
| 7.1 X 6ML | 390 (390) | 2365.07 (2365.07) | 0 (0) | 6 (placeholder) | ✓ |
| CURBE LOT 2 | 405 (405) | — | 80 | 25 (curbă LOT 1, curbă LOT 3) | ✓ |
| TEAVA 7.1 MM | 896 (896) | 10996.97 (10996.97) | 390 / 4775.74 m (390 / 4775.74 m) | 11 (placeholder, test) | ✓ |
| TEAVA 8.8 MM | 184 (184) | 2288.80 (2288.80) | 168 / 2089.30 m (168 / 2089.30 m) | 2 (placeholder) | ✓ |

După decizii: **3352 bucăți** (2947 țevi / 33731.95 m, 405 curbe); excluse total 49.

## Distribuția propusă (stare · loc)

| Stare | Loc | Bucăți |
|---|---|---|
| carantina | TOP | 2 |
| pe_tronson | T12 (din JUP) | 348 |
| pe_tronson | T12 (din TOP) | 21 |
| pe_tronson | T13 (din JUP) | 210 |
| pe_tronson | T16 (din ORN) | 323 |
| pe_tronson | T16 (din TOP) | 45 |
| pe_tronson | T17 (din ORN) | 325 |
| pe_tronson | T17 (din TOP) | 14 |
| pe_tronson | T18 (din TOP) | 106 |
| pe_tronson | T19 (din TOP) | 74 |
| receptionat | JUP | 522 |
| receptionat | TOP | 1362 |

Regula de depozit: Jupânești → **JUP (9)**; Topleț → **ORN (10)** pentru DT/OS „ORSOVA” sau avize `CJPT-O`, **TOP (11)** pentru DT/OS „TOPLET”. Orice alt grup se decide în fișierul de decizii (`depozit_grup`).

## Excluderi

- placeholder: **23**
- curbă LOT 1: **3**
- curbă LOT 3: **22**
- test: **1**

## De decis, pe grupuri (cheile pentru fișierul de decizii)

**`depozit_grup`** (grup → JUP / ORN / TOP):

- nimic

**`tronson_grup`** (text din coloana TR → număr tronson; dacă nu se poate, rândurile se exclud cu motiv):

- nimic

**`corectii_serie`** — 0 serii „2545CA…” (11 caractere; propunerea scoate „5”-ul în plus, dar se confirmă pe țeavă / aviz, nu se ghicește):

- nimic

**`accepta_neconformitate`** sau **`excluderi`** (refuzat la recepție, fără carantină [D#14]):

- nimic

## Probleme BLOCANTE: 0 rânduri

Niciuna.

## Avertismente (nu blochează): 15 rânduri

- TEAVA 7.1 TOPLET r81 247EK05228: șarjă în afara formatului AA99999: B0408381
- TEAVA 7.1 TOPLET r89 247EK06342: șarjă în afara formatului AA99999: SA000333
- TEAVA 7.1 TOPLET r140 247EK05339: șarjă în afara formatului AA99999: B0408378
- TEAVA 7.1 TOPLET r229 247EK05168: șarjă în afara formatului AA99999: B0408380
- TEAVA 7.1 TOPLET r343 247EK05331: șarjă în afara formatului AA99999: B2407893
- TEAVA 7.1 TOPLET r532 247EK05154: șarjă în afara formatului AA99999: B0408383
- TEAVA 7.1 TOPLET r574 247EK06122: șarjă în afara formatului AA99999: SA0336
- TEAVA 7.1 TOPLET r627 247EK05330: șarjă în afara formatului AA99999: B2407893
- TEAVA 7.1 TOPLET r634 247EK05217: șarjă în afara formatului AA99999: B0408381
- TEAVA 7.1 TOPLET r635 247EK05226: șarjă în afara formatului AA99999: B0408381
- TEAVA 7.1 TOPLET r637 247EK05214: șarjă în afara formatului AA99999: B0408381
- TEAVA 7.1 TOPLET r696 247EK05216: șarjă în afara formatului AA99999: B0408381
- TEAVA 7.1 TOPLET r771 247EK05328: șarjă în afara formatului AA99999: B2407893
- 7.1 X 6ML r167 247EK05359: șarjă în afara formatului AA99999: B0408378
- TEAVA 7.1 MM r645 254CA10489: șarjă în afara formatului AA99999: SA0818

## Verdict

**APLICABIL.** Payload: `PREVIEW_E2_STOC.payload.json` (3352 bucăți, sha256 fișier `47edcaf0a67d16a8d4878b8487ebb610e3753976ef17d5cc397a4b10fc240ebe`). Se aplică doar de sesiunea de chat, după „da”-ul lui Razvan, într-un SINGUR apel (activare + import, fără blocaj circular): `fn_izo_activeaza_si_importa(3, '<import_id>', <payload>, '<motiv>')`.

