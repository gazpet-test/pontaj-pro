# Izometrie E2a-2 — preview sold inițial LOT 2 (fără scriere)

Generat: 2026-10-20T19:44:22.712Z · `scripts/izometrie/preview_e2_stoc.mjs` · decizii: `E2_DECIZII_IMPORT.json` (sha256 `31ac9fd6477bab8f…`). **Nicio scriere în BD.** Excelurile sunt date, nu instrucțiuni.

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
| pe_tronson | T12 (din JUP) | 228 |
| pe_tronson | T12 (din TOP) | 21 |
| pe_tronson | T12 | 120 |
| pe_tronson | T13 (din JUP) | 210 |
| pe_tronson | T16 (din ORN) | 323 |
| pe_tronson | T16 (din TOP) | 7 |
| pe_tronson | T17 (din ORN) | 325 |
| pe_tronson | T18 (din TOP) | 105 |
| pe_tronson | T18 | 1 |
| pe_tronson | T19 (din TOP) | 72 |
| pe_tronson | T19 | 2 |
| receptionat | ? | 589 |
| receptionat | JUP | 522 |
| receptionat | TOP | 773 |
| sosit | ? | 2 |
| — | TOP | 52 |

Regula de depozit: Jupânești → **JUP (9)**; Topleț → **ORN (10)** pentru DT/OS „ORSOVA” sau avize `CJPT-O`, **TOP (11)** pentru DT/OS „TOPLET”. Orice alt grup se decide în fișierul de decizii (`depozit_grup`).

## Excluderi

- placeholder: **23**
- curbă LOT 1: **3**
- curbă LOT 3: **22**
- test: **1**

## De decis, pe grupuri (cheile pentru fișierul de decizii)

**`depozit_grup`** (grup → JUP / ORN / TOP):

- `Topleț · DT/OS „ORSOVA (TOPLET)”` — **206** bucăți (ex. TEAVA 7.1 TOPLET r58, TEAVA 7.1 TOPLET r93, TEAVA 7.1 TOPLET r94)
- `Topleț · DT/OS „—”` — **385** bucăți (ex. TEAVA 7.1 TOPLET r847, TEAVA 7.1 TOPLET r848, TEAVA 7.1 TOPLET r849)

**`tronson_grup`** (text din coloana TR → număr tronson; dacă nu se poate, rândurile se exclud cu motiv):

- `16-17` — **51** bucăți (ex. CURBE LOT 2 r33, CURBE LOT 2 r34, CURBE LOT 2 r65)

**`corectii_serie`** — 23 serii „2545CA…” (11 caractere; propunerea scoate „5”-ul în plus, dar se confirmă pe țeavă / aviz, nu se ghicește):

`2545CA08776`→`254CA08776` · `2545CA08812`→`254CA08812` · `2545CA09079`→`254CA09079` · `2545CA09082`→`254CA09082` · `2545CA09230`→`254CA09230` · `2545CA09241`→`254CA09241` · `2545CA09256`→`254CA09256` · `2545CA09276`→`254CA09276` · `2545CA09658`→`254CA09658` · `2545CA09671`→`254CA09671` · `2545CA09695`→`254CA09695` · `2545CA09702`→`254CA09702` · `2545CA09782`→`254CA09782` · `2545CA09790`→`254CA09790` · `2545CA09791`→`254CA09791` · `2545CA09171`→`254CA09171` · `2545CA09196`→`254CA09196` · `2545CA09215`→`254CA09215` · `2545CA09637`→`254CA09637` · `2545CA09747`→`254CA09747` · `2545CA09748`→`254CA09748` · `2545CA09749`→`254CA09749` · `2545CA09750`→`254CA09750`

**`accepta_neconformitate`** sau **`excluderi`** (refuzat la recepție, fără carantină [D#14]):

- TEAVA 7.1 TOPLET r58 `254CA09771` — „MARCAJ”
- TEAVA 7.1 TOPLET r596 `247EK08658` — „LIPSA MARCAJ”

**Altele:**

- CURBE LOT 2 r424 `362`: aviz de ieșire CJPT 0026 fără tronson

## Probleme BLOCANTE: 666 rânduri

Pe tipuri:

- depozit neclar: Topleț · DT/OS „…” — de decis pe grup — **591**
- tronson de ieșire ambiguu „…” — de decis — **51**
- serie „…” (NCA, propunere NCAN) — de decis — **23**
- neconformitate „…” — de decis (intră sau refuzat la recepție) — **2**
- aviz de ieșire CJPT N fără tronson — **1**

<details><summary>Lista completă (666)</summary>

| Foaie | Rând | Serie | Șarjă | L | Probleme |
|---|---|---|---|---|---|
| TEAVA 7.1 TOPLET | 58 | 254CA09771 | SA04735 | 12.5 | neconformitate „MARCAJ” — de decis (intră sau refuzat la recepție); depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 93 | 247EK05947 | SA00334 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 94 | 247EK07846 | SA07342 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 95 | 247EK06451 | RA08355 | 12.15 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 96 | 247EK09776 | SA07351 | 12.33 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 97 | 247EK06443 | SA00328 | 11.98 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 98 | 247EK06288 | SA01428 | 12.07 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 99 | 247EK05967 | SA00334 | 12.23 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 100 | 247EK09753 | SA07354 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 101 | 247EK05983 | SA00334 | 12.13 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 102 | 247EK06287 | SA01428 | 12.07 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 103 | 247EK05621 | SA01429 | 12.2 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 104 | 247EK09774 | SA07351 | 12.35 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 105 | 247EK09788 | SA07343 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 106 | 247EK09335 | SA07354 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 107 | 247EK09227 | SA07353 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 108 | 247EK06045 | SA00329 | 11.64 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 109 | 247EK07307 | SA01427 | 12.08 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 110 | 247EK09772 | SA07351 | 12.35 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 111 | 247EK09228 | SA07353 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 112 | 247EK08131 | SA07349 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 113 | 247EK09217 | SA07346 | 12.33 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 114 | 247EK05998 | SA00334 | 12.2 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 115 | 247EK06449 | RA08355 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 116 | 247EK09150 | SA07346 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 117 | 247EK09340 | SA07354 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 118 | 247EK06565 | SA00326 | 12.25 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 119 | 247EK06252 | SA01428 | 12.17 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 120 | 247EK06463 | RA08355 | 11.59 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 121 | 247EK07632 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 122 | 247EK06441 | SA00328 | 11.97 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 123 | 247EK09729 | SA07354 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 124 | 247EK09795 | SA07343 | 11.87 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 125 | 247EK09786 | SA07343 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 126 | 247EK06456 | RA08355 | 11.59 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 127 | 247EK08935 | SA07350 | 12.12 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 128 | 247EK07934 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 129 | 247EK07833 | SA07342 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 130 | 247EK06457 | RA08355 | 11.59 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 132 | 247EK06419 | SA00336 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 133 | 247EK06378 | RA09294 | 12.19 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 134 | 247EK09769 | SA07351 | 12.37 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 135 | 247EK09787 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 136 | 247EK08794 | SA07351 | 12.45 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 137 | 247EK09178 | SA07346 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 138 | 247EK06462 | RA08355 | 11.58 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 139 | 247EK07742 | SA07344 | 12.07 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 140 | 247EK05339 | B0408378 | 11.85 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 141 | 247EK07121 | SA00334 | 12.15 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 142 | 247EK09143 | SA07346 | 12.18 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 143 | 247EK07638 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 144 | 247EK09780 | SA07351 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 145 | 247EK06445 | SA00328 | 11.94 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 146 | 247EK09789 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 147 | 247EK09234 | SA07353 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 148 | 247EK07635 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 149 | 247EK06403 | SA01429 | 12.07 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 150 | 247EK09002 | SA07347 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 151 | 247EK08714 | SA07352 | 12.27 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 152 | 247EK08703 | SA07352 | 12.3 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 153 | 247EK07868 | SA07342 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 154 | 247EK09748 | SA07354 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 155 | 247EK08701 | SA07352 | 12.3 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 156 | 247EK07206 | SA00329 | 12.18 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 157 | 247EK09747 | SA07354 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 158 | 247EK07414 | SA07354 | 12.38 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 159 | 247EK09257 | SA07353 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 160 | 247EK07832 | SA07342 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 161 | 247EK07416 | SA07354 | 12.38 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 162 | 247EK06460 | RA08355 | 11.59 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 163 | 247EK05865 | SA00328 | 12.19 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 164 | 247EK07303 | SA01427 | 12.06 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 165 | 247EK06350 | RA09294 | 12.13 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 166 | 247EK09755 | SA07354 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 167 | 247EK09821 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 168 | 247EK07546 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 169 | 247EK09854 | SA07349 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 170 | 247EK08474 | SA07342 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 171 | 247EK08910 | SA07350 | 11.99 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 172 | 247EK07649 | SA07344 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 173 | 247EK07544 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 174 | 247EK09014 | SA07347 | 12.23 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 175 | 247EK09012 | SA07347 | 12.23 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 176 | 247EK07548 | SA07343 | 12.15 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 177 | 247EK09011 | SA07347 | 12.37 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 178 | 247EK08134 | SA07349 | 12.27 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 179 | 247EK08922 | SA07350 | 11.99 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 180 | 247EK08337 | SA07345 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 181 | 247EK09785 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 182 | 247EK07341 | SA07354 | 12.33 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 183 | 247EK09746 | SA07354 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 184 | 247EK06354 | RA09294 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 185 | 247EK09232 | SA07353 | 12.2 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 186 | 247EK06334 | SA00333 | 12.2 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 187 | 247EK06461 | RA08355 | 11.58 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 188 | 247EK07835 | SA07342 | 12.23 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 189 | 247EK09731 | SA07354 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 190 | 247EK09770 | SA07351 | 12.36 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 191 | 247EK09784 | SA07343 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 192 | 247EK09059 | SA07346 | 12.19 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 193 | 247EK09029 | SA07347 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 194 | 247EK07630 | SA07343 | 12.27 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 195 | 247EK06582 | RA09292 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 196 | 247EK09004 | SA07347 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 197 | 247EK05495 | SA01427 | 12.15 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 198 | 254CA09083 | SA04750 | 12.27 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 199 | 254CA09184 | SA04753 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 200 | 254CA09363 | SA04751 | 12.47 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 201 | 254CA09463 | SA04754 | 12.45 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 202 | 254CA09562 | SA04752 | 12.46 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 203 | 254CA09586 | SA04752 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 204 | 254CA09683 | SA04750 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 205 | 254CA09687 | SA04750 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 206 | 254CA09689 | SA04750 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 207 | 254CA09700 | SA04750 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 208 | 254CA09743 | SA04754 | 12.44 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 209 | 254CA09767 | SA04735 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 210 | 254CA09781 | SA04735 | 12.19 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 211 | 254CA10037 | SA04752 | 12.42 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 212 | 254CA10057 | SA04757 | 12.38 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 213 | 254CA09011 | SA04751 | 11.96 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 214 | 254CA09383 | SA04752 | 12.46 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 215 | 254CA09550 | SA04752 | 12.41 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 216 | 254CA09663 | SA04755 | 12.46 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 217 | 254CA09694 | SA04750 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 218 | 254CA09783 | SA04735 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 219 | 254CA09803 | SA04736 | 12.45 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 220 | 254CA09848 | SA04736 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 221 | 254CA09883 | SA04750 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 222 | 254CA09903 | SA04751 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 223 | 254CA09945 | SA04736 | 12.44 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 224 | 254CA09963 | SA04735 | 12.43 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 225 | 254CA09976 | SA04735 | 12.43 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 226 | 254CA10083 | SA04757 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 227 | 254CA10086 | SA04757 | 12.47 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 228 | 247EK06447 | RA08355 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 229 | 247EK05168 | B0408380 | 11.84 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 230 | 247EK06152 | SA00336 | 12.07 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 231 | 247EK05537 | SA01427 | 12.05 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 232 | 247EK08153 | SA07349 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 233 | 247EK08121 | SA07349 | 12.25 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 234 | 247EK08981 | SA07350 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 235 | 247EK06341 | SA00333 | 12.13 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 236 | 247EK09820 | SA07343 | 12.27 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 237 | 247EK07631 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 238 | 247EK09822 | SA07343 | 12.34 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 239 | 247EK09255 | SA07353 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 240 | 247EK07551 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 241 | 247EK09013 | SA07347 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 242 | 247EK08991 | SA07350 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 243 | 247EK09196 | SA07346 | 12.17 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 244 | 247EK09682 | SA07350 | 12.32 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 245 | 247EK09084 | SA07346 | 12.18 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 246 | 247EK09326 | SA07354 | 11.97 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 247 | 247EK09543 | SA07348 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 248 | 247EK09657 | SA07345 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 249 | 247EK09524 | SA07348 | 12.01 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 250 | 247EK06450 | RA08355 | 12.13 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 251 | 247EK06326 | SA00333 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 252 | 247EK07639 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 253 | 247EK07545 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 254 | 247EK07668 | SA07344 | 12.2 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 255 | 247EK09009 | SA07347 | 12.15 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 256 | 247EK08240 | SA07345 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 257 | 247EK08235 | SA07345 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 258 | 254CA09103 | SA04751 | 12.47 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 259 | 254CA09133 | SA04752 | 12.39 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 260 | 254CA09255 | SA04752 | 12.39 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 261 | 254CA09535 | SA04752 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 262 | 254CA09553 | SA04752 | 12.41 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 263 | 254CA09554 | SA04752 | 12.41 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 264 | 254CA09563 | SA04756 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 265 | 254CA09583 | SA04752 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 266 | 254CA09599 | SA04752 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 268 | 254CA09675 | SA04755 | 12.45 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 271 | 254CA09769 | SA04735 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 272 | 254CA09847 | SA04736 | 12.49 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 273 | 247EK09798 | SA07343 | 11.87 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 277 | 247EK09857 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 278 | 247EK07547 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 279 | 247EK09823 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 280 | 247EK09324 | SA07354 | 11.97 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 281 | 247EK09701 | SA07350 | 12.3 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 282 | 247EK09698 | SA07350 | 12.3 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 283 | 247EK06292 | SA01428 | 12.07 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 284 | 247EK06379 | RA09294 | 12.21 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 285 | 247EK09700 | SA07350 | 12.3 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 286 | 247EK09346 | SA07354 | 12.33 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 287 | 247EK05501 | SA01427 | 12.13 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 288 | 247EK08928 | SA07350 | 11.97 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 289 | 247EK08725 | SA07352 | 12.27 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 290 | 247EK09459 | SA07344 | 12.23 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 292 | 247EK09380 | SA07354 | 12.33 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 293 | 247EK08229 | SA07345 | 12.22 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 294 | 247EK08971 | SA07350 | 12.32 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 295 | 247EK07968 | SA07349 | 12.25 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 296 | 247EK08694 | SA07352 | 12.29 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 297 | 247EK08730 | SA07352 | 12.5 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 298 | 247EK08735 | SA07352 | 12.14 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 299 | 247EK08244 | SA07345 | 12.18 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 300 | 247EK09446 | SA07347 | 12.3 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 301 | 247EK09392 | SA07347 | 12.2 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 302 | 247EK09430 | SA07347 | 12.48 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 312 | 247EK07683 | SA07344 | 11.99 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 314 | 247EK08766 | SA07352 | 12.24 | depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 596 | 247EK08658 | SA07352 | 12.26 | neconformitate „LIPSA MARCAJ” — de decis (intră sau refuzat la recepție); depozit neclar: Topleț · DT/OS „ORSOVA (TOPLET)” — de decis pe grup |
| TEAVA 7.1 TOPLET | 847 | 247EK09267 | SA07353 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 848 | 247EK09723 | SA07354 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 849 | 247EK09742 | SA07354 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 850 | 247EK07836 | SA07342 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 851 | 247EK09176 | SA07346 | 12.38 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 852 | 247EK09618 | SA07339 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 853 | 247EK09328 | SA07354 | 11.97 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 854 | 247EK09327 | SA07354 | 12.01 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 855 | 247EK09814 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 856 | 247EK09767 | SA07351 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 857 | 247EK09387 | SA07347 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 858 | 247EK09768 | SA07351 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 859 | 247EK09817 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 860 | 247EK09816 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 861 | 247EK07776 | SA07342 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 862 | 247EK07640 | SA07343 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 863 | 247EK07461 | SA07343 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 864 | 247EK07563 | SA07343 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 865 | 247EK09332 | SA07343 | 11.99 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 866 | 247EK08015 | SA07354 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 867 | 247EK07418 | SA07349 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 868 | 247EK07422 | SA07354 | 12.06 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 869 | 247EK07336 | SA07354 | 12.33 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 870 | 247EK08425 | SA07354 | 12.12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 871 | 247EK07133 | SA07344 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 872 | 247EK08609 | SA07348 | 12.29 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 873 | 247EK07132 | RA09290 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 874 | 247EK07140 | RA09290 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 875 | 247EK08552 | SA07348 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 876 | 247EK07311 | SA01427 | 12.08 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 877 | 247EK07567 | SA07343 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 878 | 247EK07569 | SA07343 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 879 | 247EK08891 | SA07350 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 880 | 247EK08915 | SA07350 | 12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 881 | 247EK07839 | SA07342 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 882 | 247EK08621 | SA07348 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 883 | 247EK08628 | SA07348 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 884 | 247EK08918 | SA07350 | 12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 885 | 247EK07351 | SA07354 | 12.34 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 886 | 247EK07350 | SA07354 | 12.33 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 887 | 247EK09815 | SA07343 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 888 | 247EK07568 | SA07343 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 889 | 247EK08492 | SA07339 | 12.11 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 890 | 247EK08518 | SA07339 | 12.11 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 891 | 247EK08919 | SA07350 | 11.99 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 892 | 247EK09094 | SA07346 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 893 | 247EK09895 | SA07353 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 894 | 247EK09792 | SA07343 | 11.86 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 895 | 247EK05980 | SA00334 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 896 | 247EK09367 | SA07354 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 897 | 247EK09415 | SA07347 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 898 | 247EK09412 | SA07347 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 899 | 247EK09341 | SA07354 | 12.29 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 900 | 247EK09339 | SA07354 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 901 | 247EK09865 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 902 | 247EK09866 | SA07349 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 903 | 247EK09574 | SA07348 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 904 | 247EK09889 | SA07353 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 905 | 247EK09711 | SA07350 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 906 | 247EK09325 | SA07354 | 11.97 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 907 | 247EK08590 | SA07348 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 908 | 247EK07212 | SA00337 | 12.03 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 909 | 247EK07565 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 910 | 247EK07566 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 911 | 247EK07415 | SA07354 | 12.38 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 912 | 247EK08132 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 913 | 247EK08617 | SA07348 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 914 | 247EK08421 | SA07344 | 12.12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 915 | 247EK08533 | SA07348 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 916 | 247EK09302 | SA07353 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 917 | 247EK07536 | SA07343 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 918 | 247EK08237 | SA07345 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 919 | 247EK08156 | SA07349 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 920 | 247EK08139 | SA07349 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 921 | 247EK09646 | SA07345 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 922 | 247EK07834 | SA07342 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 923 | 247EK07779 | SA07342 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 924 | 247EK09744 | SA07354 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 925 | 247EK09745 | SA07354 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 926 | 247EK08600 | SA07348 | 12.31 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 927 | 247EK08626 | SA07348 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 928 | 247EK07841 | SA07342 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 929 | 247EK09061 | SA07346 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 930 | 247EK08884 | SA07350 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 931 | 247EK07674 | SA07344 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 932 | 247EK08945 | SA07350 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 933 | 247EK08775 | SA07351 | 11.93 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 934 | 247EK09303 | SA07353 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 935 | 247EK07572 | SA07343 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 936 | 247EK07339 | SA07354 | 12.32 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 937 | 247EK07560 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 938 | 247EK08491 | SA07342 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 939 | 247EK07770 | SA07342 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 940 | 247EK07642 | SA07343 | 12.03 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 941 | 247EK08648 | SA07352 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 942 | 247EK08980 | SA07350 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 943 | 247EK08979 | SA07350 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 944 | 247EK08983 | SA07350 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 945 | 247EK09060 | SA07346 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 946 | 247EK08632 | SA07352 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 947 | 247EK07021 | SA00326 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 948 | 247EK07571 | SA07343 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 949 | 247EK08594 | SA07348 | 12.31 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 950 | 247EK06541 | SA00331 | 12.48 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 951 | 247EK06558 | SA00326 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 952 | 247EK08564 | SA07348 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 953 | 247EK08422 | SA07344 | 12.12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 954 | 247EK08004 | SA07349 | 11.98 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 955 | 247EK08556 | SA07348 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 956 | 247EK07022 | SA00326 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 957 | 247EK08920 | SA07350 | 11.98 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 958 | 247EK06561 | SA00326 | 11.8 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 959 | 247EK08424 | SA07344 | 12.11 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 960 | 247EK09073 | SA07346 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 961 | 247EK08930 | SA07350 | 11.96 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 962 | 247EK08917 | SA07350 | 11.99 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 963 | 247EK07051 | SA00327 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 964 | 247EK07124 | SA00334 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 965 | 247EK08355 | SA07344 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 966 | 247EK08406 | SA07344 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 968 | 254CA09175 | SA04757 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 969 | 254CA09176 | SA04757 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 970 | 254CA09177 | SA04757 | 12.38 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 971 | 254CA09192 | SA04753 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 972 | 254CA09206 | SA04735 | 12.47 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 973 | 254CA09207 | SA04735 | 12.47 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 974 | 254CA09208 | SA04735 | 12.47 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 975 | 254CA09302 | SA04751 | 12.48 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 976 | 254CA09308 | SA04749 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 977 | 254CA09320 | SA04749 | 12.31 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 978 | 254CA09337 | SA04752 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 979 | 254CA09338 | SA04752 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 980 | 254CA09349 | SA04755 | 12.44 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 982 | 254CA09174 | SA04757 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 983 | 254CA09312 | SA04749 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 985 | 254CA09315 | SA04749 | 12.29 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 986 | 254CA09316 | SA04749 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 988 | 254CA09392 | SA04752 | 12.46 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 989 | 254CA09451 | SA04751 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 990 | 254CA09452 | SA04751 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 993 | 254CA09466 | SA04754 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 994 | 254CA09467 | SA04754 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 995 | 254CA09468 | SA04754 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 996 | 254CA09469 | SA04754 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 997 | 254CA09182 | SA04757 | 12.08 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1000 | 254CA09399 | SA04752 | 12.47 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1001 | 254CA09438 | SA04749 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1002 | 254CA09439 | SA04749 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1003 | 254CA09440 | SA04749 | 12.39 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1006 | 254CA09774 | SA04735 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1007 | 254CA09823 | SA04749 | 12.44 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1009 | 254CA09981 | SA04735 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1010 | 254CA10025 | SA04757 | 12.05 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1011 | 254CA10036 | SA04757 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1012 | 247EK07119 | SA00334 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1013 | 247EK08969 | SA07350 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1014 | 247EK08970 | SA07350 | 12.39 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1015 | 247EK07027 | SA00326 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1016 | 247EK06583 | RA09292 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1017 | 247EK07112 | SA00334 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1018 | 247EK07127 | RA09290 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1019 | 247EK07111 | SA00334 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1020 | 247EK07045 | SA00327 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1021 | 247EK07128 | RA09290 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1022 | 247EK08378 | SA07344 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1023 | 247EK08479 | SA07342 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1024 | 247EK07838 | SA07342 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1025 | 247EK07954 | SA07349 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1026 | 247EK08356 | SA07344 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1031 | 247EK07129 | RA09290 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1032 | 247EK08480 | SA07342 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1033 | 247EK07007 | SA00326 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1035 | 247EK06607 | RA09294 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1036 | 247EK07026 | SA00326 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1037 | 247EK08622 | SA07348 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1038 | 247EK08652 | SA07352 | 12.33 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1087 | 247EK09089 | SA07346 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1088 | 247EK09087 | SA07346 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1089 | 247EK07921 | SA07342 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1090 | 247EK07927 | SA07342 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1091 | 247EK06567 | SA00326 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1092 | 247EK07943 | SA07349 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1093 | 247EK08385 | SA07344 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1094 | 247EK09047 | SA07347 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1095 | 247EK08715 | SA07352 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1096 | 247EK08575 | SA07348 | 12.06 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1097 | 247EK07685 | SA07344 | 12.01 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1098 | 247EK09610 | SA07339 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1099 | 247EK07561 | SA07343 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1100 | 247EK09293 | SA07353 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1101 | 247EK09115 | SA07346 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1102 | 247EK09603 | SA07339 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1103 | 247EK09616 | SA07339 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1104 | 247EK07947 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1105 | 247EK07940 | SA07349 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1106 | 247EK08601 | SA07348 | 12.29 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1107 | 247EK09090 | SA07346 | 12.19 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1108 | 247EK09602 | SA07339 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1109 | 247EK06589 | RA09292 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1110 | 247EK07937 | SA07349 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1111 | 247EK09107 | SA07346 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1112 | 247EK09605 | SA07339 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1113 | 247EK09604 | SA07339 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1114 | 247EK08641 | SA07352 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1115 | 247EK07948 | SA07349 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1116 | 247EK09088 | SA07346 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1117 | 247EK09130 | SA07346 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1118 | 247EK09295 | SA07353 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1119 | 247EK08976 | SA07350 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1120 | 247EK09294 | SA07353 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1121 | 247EK08629 | SA07348 | 12.05 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1122 | 247EK08614 | SA07348 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1123 | 247EK08548 | SA07348 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1124 | 247EK08607 | SA07348 | 12.29 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1125 | 247EK07958 | SA07349 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1126 | 247EK08663 | SA07352 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1127 | 247EK08887 | SA07350 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1128 | 247EK08662 | SA07352 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1129 | 247EK08661 | SA07352 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1130 | 247EK08660 | SA07352 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1131 | 247EK09049 | SA07347 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1132 | 247EK08045 | SA07349 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1133 | 247EK08912 | SA07350 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1134 | 247EK07123 | SA00334 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1135 | 247EK08379 | SA07344 | 12.12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1136 | 247EK08943 | SA07350 | 12.12 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1137 | 247EK08557 | SA07348 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1138 | 247EK07766 | SA07342 | 12.27 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1139 | 247EK08400 | SA07344 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1140 | 247EK09017 | SA07347 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1141 | 247EK08605 | SA07348 | 12.29 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1142 | 247EK08631 | SA07348 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1143 | 247EK08505 | SA07339 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1144 | 247EK05568 | SA01427 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1145 | 247EK08581 | SA07348 | 12.05 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1146 | 247EK08569 | SA07348 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1283 | 254CA10094 | TA01575 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1284 | 254CA10095 | TA01575 | 12.39 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1285 | 254CA10096 | TA01575 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1286 | 254CA10106 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1287 | 254CA10108 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1288 | 254CA10110 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1289 | 254CA10166 | TA01575 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1290 | 254CA10318 | SA08019 | 12.39 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1291 | 254CA10319 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1292 | 254CA10329 | SA08019 | 12.34 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1293 | 254CA10330 | SA08019 | 12.48 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1294 | 254CA10353 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1295 | 254CA10356 | SA07339 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1296 | 254CA10358 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1297 | 254CA10361 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1298 | 254CA10101 | TA01575 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1299 | 254CA10102 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1300 | 254CA10183 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1301 | 254CA10197 | TA01575 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1302 | 254CA10199 | TA01575 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1303 | 254CA10200 | TA01575 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1304 | 254CA10270 | SA08019 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1305 | 254CA10331 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1306 | 254CA10332 | SA07339 | 12.32 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1307 | 254CA10334 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1308 | 254CA10335 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1309 | 254CA10336 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1310 | 254CA10352 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1311 | 254CA10355 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1312 | 254CA10357 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1313 | 254CA09460 | SA04751 | 12.34 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1314 | 254CA09845 | SA04736 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1315 | 254CA10111 | TA01575 | 12.35 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1316 | 254CA10154 | TA00938 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1317 | 254CA10217 | TA01575 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1318 | 254CA10223 | TA01575 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1319 | 254CA10225 | TA01575 | 12.45 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1320 | 254CA10233 | TA01575 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1321 | 254CA10239 | TA01575 | 12.38 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1322 | 254CA10240 | TA01575 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1323 | 254CA10265 | SA08019 | 12.04 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1324 | 254CA10284 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1325 | 254CA10285 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1326 | 254CA10317 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1327 | 254CA10337 | SA07339 | 12.13 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1328 | 254CA10105 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1329 | 254CA10120 | TA00938 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1330 | 254CA10121 | TA00938 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1331 | 254CA10313 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1332 | 254CA10338 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1333 | 254CA10340 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1334 | 254CA10341 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1335 | 254CA10342 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1336 | 254CA10344 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1337 | 254CA10350 | SA07339 | 11.53 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1338 | 254CA10351 | SA07339 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1339 | 254CA10362 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1340 | 254CA10364 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1341 | 254CA10365 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1342 | 254CA10366 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1343 | 254CA10097 | TA01575 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1344 | 254CA10123 | TA00938 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1345 | 254CA10124 | TA00938 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1346 | 254CA10125 | TA00938 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1347 | 254CA10174 | TA01575 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1348 | 254CA10185 | TA01575 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1349 | 254CA10186 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1350 | 254CA10187 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1351 | 254CA10204 | TA01575 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1352 | 254CA10256 | SA08019 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1353 | 254CA10278 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1354 | 254CA10279 | SA08019 | 12.41 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1355 | 254CA10314 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1356 | 254CA10343 | SA07339 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1357 | 254CA10345 | SA07339 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1358 | 254CA10171 | TA01575 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1359 | 254CA10172 | TA01575 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1360 | 254CA10173 | TA01575 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1361 | 254CA10178 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1362 | 254CA10188 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1363 | 254CA10235 | TA01575 | 12.38 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1364 | 254CA10264 | SA08019 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1365 | 254CA10280 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1366 | 254CA10286 | SA08019 | 12.41 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1367 | 254CA10287 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1368 | 254CA10288 | SA08019 | 12.41 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1369 | 254CA10292 | SA08019 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1370 | 254CA10295 | SA08019 | 12.48 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1371 | 254CA10315 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1372 | 254CA10316 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1373 | 254CA10099 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1374 | 254CA10100 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1375 | 254CA10177 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1376 | 254CA10182 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1377 | 254CA10184 | TA01575 | 12.37 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1378 | 254CA10277 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1379 | 254CA10281 | SA08019 | 12.41 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1380 | 254CA10289 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1381 | 254CA10290 | SA08019 | 12.41 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1382 | 254CA10291 | SA08019 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1383 | 254CA10303 | SA08019 | 12.4 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1384 | 254CA10304 | SA08019 | 12.48 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1385 | 254CA10305 | SA08019 | 12.48 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1386 | 254CA10311 | SA08019 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1387 | 254CA10328 | SA08019 | 12.34 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1388 | 254CA10103 | TA01575 | 12.36 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1389 | 254CA10170 | TA01575 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1390 | 254CA10201 | TA01575 | 12.5 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1391 | 254CA10257 | SA08019 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1392 | 254CA10258 | SA08019 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1393 | 254CA10259 | SA08019 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1394 | 254CA10263 | SA08019 | 12.25 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1395 | 254CA10269 | SA08019 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1396 | 254CA10275 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1397 | 254CA10276 | SA08019 | 12.41 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1398 | 254CA10282 | SA08019 | 12.42 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1399 | 254CA10294 | SA08019 | 12.47 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1400 | 254CA10327 | SA08019 | 12.34 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1401 | 254CA10363 | SA07339 | 11.98 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1402 | 247EK07226 | SA00337 | 12.04 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1403 | 247EK07557 | SA07343 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1404 | 247EK07248 | RA09293 | 12.49 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1405 | 247EK07352 | SA07354 | 12.33 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1406 | 247EK07325 | SA01428 | 12.11 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1407 | 247EK08643 | SA07352 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1408 | 247EK09231 | SA07353 | 12.21 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1409 | 247EK07131 | RA09290 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1410 | 247EK07216 | SA00337 | 12.04 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1411 | 247EK07122 | SA00334 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1412 | 247EK06586 | RA09292 | 12.28 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1413 | 247EK08707 | SA07352 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1414 | 247EK08113 | SA07349 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1415 | 247EK08386 | SA07344 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1416 | 247EK08777 | SA07351 | 11.93 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1417 | 247EK08931 | SA07350 | 12.14 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1418 | 247EK09184 | SA07346 | 12.2 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1419 | 247EK09006 | SA07347 | 12.15 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1420 | 247EK08968 | SA07350 | 12.22 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1421 | 247EK08007 | SA07349 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1422 | 247EK09185 | SA07346 | 12.44 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1423 | 247EK08963 | SA07350 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1424 | 247EK08017 | SA07349 | 12.16 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1425 | 247EK08656 | SA07352 | 12.24 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1426 | 247EK08008 | SA07349 | 12.17 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1427 | 247EK07938 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1428 | 247EK09085 | SA07346 | 12.18 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1429 | 247EK09155 | SA07346 | 12.23 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1430 | 247EK07949 | SA07349 | 12.26 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| TEAVA 7.1 TOPLET | 1431 | 247EK08619 | SA07348 | 12.3 | depozit neclar: Topleț · DT/OS „—” — de decis pe grup |
| CURBE LOT 2 | 33 | 1140 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 34 | 1151 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 65 | 1053 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 66 | 1055 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 69 | 715 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 70 | 909 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 71 | 421 | 2513615 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 72 | 446 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 84 | 127 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 85 | 148 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 86 | 149 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 98 | 360 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 99 | 395 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 100 | 398 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 101 | 411 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 102 | 415 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 103 | 416 | 2513614 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 104 | 422 | 2513615 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 105 | 466 | 2513615 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 106 | 583 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 119 | 1150 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 129 | 1145 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 130 | 1147 | 2513615 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 151 | 95 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 152 | 104 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 153 | 130 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 154 | 151 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 155 | 154 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 156 | 166 | 2513614 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 168 | 966 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 175 | 943 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 176 | 949 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 181 | 720 | 2513615 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 182 | 722 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 183 | 723 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 193 | 1027 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 195 | 934 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 196 | 960 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 197 | 1237 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 223 | 737 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 224 | 1169 | 2513614 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 300 | 646 | 2513614 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 301 | 667 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 331 | 765 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 332 | 781 | 2513614 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 347 | 1313 | 2513614 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 348 | 1330 | 2520911 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 356 | 102 | 2520914 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 357 | 118 | 2513616 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 358 | 131 | 2513615 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 359 | 157 | 2520915 | 1 | tronson de ieșire ambiguu „16-17” — de decis |
| CURBE LOT 2 | 424 | 362 | 2520915 | 1 | aviz de ieșire CJPT 0026 fără tronson |
| TEAVA 7.1 MM | 88 | 2545CA08776 | SA04752 | 12.46 | serie „2545CA08776” (2545CA, propunere 254CA08776) — de decis |
| TEAVA 7.1 MM | 89 | 2545CA08812 | SA04754 | 12.45 | serie „2545CA08812” (2545CA, propunere 254CA08812) — de decis |
| TEAVA 7.1 MM | 90 | 2545CA09079 | SA04756 | 12.49 | serie „2545CA09079” (2545CA, propunere 254CA09079) — de decis |
| TEAVA 7.1 MM | 91 | 2545CA09082 | SA04756 | 12.49 | serie „2545CA09082” (2545CA, propunere 254CA09082) — de decis |
| TEAVA 7.1 MM | 92 | 2545CA09230 | SA04754 | 12.45 | serie „2545CA09230” (2545CA, propunere 254CA09230) — de decis |
| TEAVA 7.1 MM | 93 | 2545CA09241 | SA04754 | 12.18 | serie „2545CA09241” (2545CA, propunere 254CA09241) — de decis |
| TEAVA 7.1 MM | 94 | 2545CA09256 | SA04752 | 12.39 | serie „2545CA09256” (2545CA, propunere 254CA09256) — de decis |
| TEAVA 7.1 MM | 95 | 2545CA09276 | SA04755 | 12.46 | serie „2545CA09276” (2545CA, propunere 254CA09276) — de decis |
| TEAVA 7.1 MM | 96 | 2545CA09658 | SA04750 | 12.4 | serie „2545CA09658” (2545CA, propunere 254CA09658) — de decis |
| TEAVA 7.1 MM | 97 | 2545CA09671 | SA04755 | 12.35 | serie „2545CA09671” (2545CA, propunere 254CA09671) — de decis |
| TEAVA 7.1 MM | 98 | 2545CA09695 | SA04750 | 12.5 | serie „2545CA09695” (2545CA, propunere 254CA09695) — de decis |
| TEAVA 7.1 MM | 99 | 2545CA09702 | SA04750 | 11.5 | serie „2545CA09702” (2545CA, propunere 254CA09702) — de decis |
| TEAVA 7.1 MM | 100 | 2545CA09782 | SA04735 | 12.5 | serie „2545CA09782” (2545CA, propunere 254CA09782) — de decis |
| TEAVA 7.1 MM | 101 | 2545CA09790 | SA04735 | 12.5 | serie „2545CA09790” (2545CA, propunere 254CA09790) — de decis |
| TEAVA 7.1 MM | 102 | 2545CA09791 | SA04735 | 12.49 | serie „2545CA09791” (2545CA, propunere 254CA09791) — de decis |
| TEAVA 7.1 MM | 103 | 2545CA09171 | SA04757 | 12.37 | serie „2545CA09171” (2545CA, propunere 254CA09171) — de decis |
| TEAVA 7.1 MM | 104 | 2545CA09196 | SA04753 | 12.11 | serie „2545CA09196” (2545CA, propunere 254CA09196) — de decis |
| TEAVA 7.1 MM | 105 | 2545CA09215 | SA04735 | 12.47 | serie „2545CA09215” (2545CA, propunere 254CA09215) — de decis |
| TEAVA 7.1 MM | 106 | 2545CA09637 | SA04755 | 12.41 | serie „2545CA09637” (2545CA, propunere 254CA09637) — de decis |
| TEAVA 7.1 MM | 107 | 2545CA09747 | SA04754 | 12.45 | serie „2545CA09747” (2545CA, propunere 254CA09747) — de decis |
| TEAVA 7.1 MM | 108 | 2545CA09748 | SA04754 | 12.44 | serie „2545CA09748” (2545CA, propunere 254CA09748) — de decis |
| TEAVA 7.1 MM | 109 | 2545CA09749 | SA04754 | 12.34 | serie „2545CA09749” (2545CA, propunere 254CA09749) — de decis |
| TEAVA 7.1 MM | 110 | 2545CA09750 | SA04754 | 12.44 | serie „2545CA09750” (2545CA, propunere 254CA09750) — de decis |

</details>

## Avertismente (nu blochează): 16 rânduri

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
- TEAVA 7.1 TOPLET r1277 247EK06377: cantitatea la ieșire 12.18 ≠ aviz 12.19
- 7.1 X 6ML r167 247EK05359: șarjă în afara formatului AA99999: B0408378
- TEAVA 7.1 MM r645 254CA10489: șarjă în afara formatului AA99999: SA0818

## Verdict

**NEAPLICABIL** (R13): 666 rânduri cu probleme blocante. Payload-ul NU s-a scris. Deciziile se trec în fișierul de decizii (corecții de serie, excluderi, grupuri de depozit, tronsoane ambigue, neconformități acceptate), apoi preview-ul se rulează din nou.

