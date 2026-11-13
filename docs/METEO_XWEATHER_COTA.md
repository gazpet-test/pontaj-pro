# Vremea Vaisala Xweather: cota de accese (r4)

Contul Xweather are o cotă de **15.000 de accese pe lună**. Un acces = o cerere trimisă furnizorului, reușită sau nu.
Funcția `meteo-sync` (cron `meteo_sync_2h`, `5 */2 * * *`) face două lucruri pe același cont:

1. **vremea curentă** (neschimbată în r4): 19 ținte la fiecare rulare;
2. **vremea zilei ca dovadă în rapoarte** (tabelul `meteo_zilnic_xweather`, migrarea `20261221a`): o dată pe zi, la rularea de la 04:05 UTC.

Regulile pasului zilnic stau într-un singur loc: constantele din `supabase/functions/meteo-sync/xweather_zilnic_logica.ts`.

## Consumul vremii curente (azi, din cod și din răspunsurile cron-ului)

| Ce | Calcul | Accese / zi |
|---|---|---|
| `conditions` la fiecare rulare | 12 rulări × 19 | 228 |
| `forecasts` + `alerts` + `airquality` la rulările „complete” (UTC 04 / 10 / 16 / 22) | 4 × 19 × 3 | 228 |
| **Total** | | **≈ 456** |

Pe lună: ≈ 13.680 (30 de zile) / ≈ 14.136 (31 de zile). Rămân ≈ 1.320 / ≈ 864. Fiecare reîmprospătare manuală `{forta:true}` mai costă 19 × 4 = 76 de accese.

## Pasul zilnic: înainte și după r4

**Înainte (main, nepublicat):** 19 șantiere × (ieri: 2 cereri + reverificarea lui alaltăieri: 2) = 76 pe zi, plus până la 20 de zile vechi pe rulare (40 de accese).
Asta înseamnă 76–116 pe zi, adică ≈ 2.356–3.596 pe lună (31 de zile). **Cota ar fi fost depășită**, iar spre sfârșitul lunii s-ar fi putut opri și vremea curentă.

**După r4:**

| Țintă | Regula | Accese / zi (regim normal) |
|---|---|---|
| (a) șantierele active | Raport zilnic cu data ≥ ieri − 13 (`ZILE_ACTIVITATE` = 14). Se cere ieri, chiar dacă ieri n-a existat raport. Se cer și zilele lipsă din ultimele 7 (`ZILE_RELUARE_ACTIVE`), dar acestea apar doar după un eșec. | 7–10 șantiere × 2 = **14–20** |
| (b) zile cu raport și fără vreme | Rapoarte întârziate și istoricul de la 21.07.2026. Cele mai noi întâi. | ≈ 0–2 (după terminarea istoricului) |
| (c) altceva | Nimic automat. Restul îl completează owner-ul cu comanda lui. | 0 |
| Reverificarea lui alaltăieri | **Scoasă.** Rămâne la cerere: owner-ul cu `reverifica: true`. | 0 |

- **Regim normal:** ≈ 20 de accese pe zi, adică ≈ 620 pe lună (× 31). Total cu vremea curentă: ≈ 476 pe zi.
  - Pe 30 de zile: ≈ 14.280, rămân ≈ 720.
  - Pe 31 de zile: ≈ 14.756, rămân ≈ 244.
- **Istoricul, o singură dată:** 331 de zile-șantier cu raport (de la 21.07.2026) × 2 = **≈ 662 de accese**.
  - Plafonul de rulare e 60, iar (a) ia ≈ 20 din el. Rămân ≈ 20 de zile de istoric pe zi, deci istoricul se termină în ≈ 17 rulări.
  - În lunile cu istoric: ≈ 60 de accese pe zi, adică 516 pe zi cu tot cu vremea curentă.
  - Dacă publicarea are loc în a doua jumătate a lui noiembrie (30 de zile): noiembrie ≈ 13.680 + 16 × 60 = **≈ 14.640**, iar decembrie (31 de zile, ultimele 1–2 zile de istoric) ≈ **14.830**.
  - Dacă istoricul ar cădea întreg într-o lună de 31 de zile: ≈ 14.136 + 17 × 60 + 14 × 20 ≈ **15.436, adică PESTE cotă**. Concluzie: istoricul trebuie pornit într-o lună cu marjă (noiembrie). Altfel, întâi se reduce consumul vremii curente (variantele de mai jos).
- **Cel mai rău caz pe rulare:** 60 de accese. Pe toată luna, 60 × 31 = 1.860, cât ar însemna o lună întreagă cu istoric (peste cotă). Plafonul limitează ziua, nu luna. Luna o limitează faptul că (b) se termină: zilele cu raport sunt finite.

### Plafonul, numărătoarea, oprirea

- `MAX_ACCESE_XW_RULARE` = **60**, pentru tot pasul zilnic.
  - O zi-șantier începe doar dacă încape întreagă: are nevoie de 2 accese (`ACCESE_MAX_ZI`). Rularea nu trece niciodată de 60.
  - O zi fără date costă un singur acces, pentru că observațiile se cer doar dacă ziua are valori.
- **Ce nu încape** apare în `zile_nesalvate` cu motivul „neajunsă (plafonul de accese)” și se reia a doua zi. Răspunsul are atunci HTTP **207** și `complet: false`, ca în r3.
- **Numărătoarea:** fiecare cerere TRIMISĂ se numără înainte de `fetch`, fie că reușește, primește 5xx sau dă rețea / timp depășit. Rezultatul are `xweather.accese_xweather`, iar răspunsul cron-ului are aceeași cifră și la vârf, în `accese_xweather`.
- **Oprirea:** un 429 sau `maxhits_*` (limita furnizorului), sau un cont neautorizat la `conditions`, oprește toată rularea. Zilele rămase apar „neajunsă (oprit: …)”, ca să nu se consume accese degeaba.
- **Comanda owner-ului** (`xweather_backfill`) are plafonul `MAX_ACCESE_XW_APEL` = **62**, adică exact apelul implicit (`max_zile` 31 × 2). Cu `max_zile` > 31 restul rămâne „neajunsă”, iar `continua_pana` arată de unde se reia. Întoarce aceeași numărătoare. Drepturile sunt neschimbate: doar owner-ul, altfel 403.

### Timpul

- `meteo_cron_tick()` așteaptă răspunsul **120 s**. Rulările existente durează 15–55 s; pentru calcul se ia prudent 60 s.
- Bucla Xweather are termenul `BUGET_XW_ZILNIC_MS` = **40 s**, socotit de la începutul pasului, cu tot cu citirile din BD:
  - o zi nouă începe doar dacă mai sunt cel puțin 5 s;
  - fiecare cerere e tăiată la termen: cel mult 25 s și niciodată după termen;
  - după termen nu se mai trimite nimic.
- Total: ≈ 60 + 40 = **100 s < 120 s**. La asta se adaugă doar scrierea ultimei zile și pasul Open-Meteo, care are câteva cereri.
- Ce nu încape = „neajunsă (bugetul de timp)”, se reia a doua zi.
- Comanda owner-ului (apel separat, nu din cron) păstrează 100 s.

### Stația cea mai apropiată: de ce `observations` la fiecare zi-șantier

Coordonatorul a recomandat, pentru istoric, reutilizarea stației cunoscute. Varianta nu se poate face fără migrare:

- `observatii_stare` admite doar `ok` / `fara_statie` / `neautorizat` / `eroare` (CHECK în `20261221a`), deci nu poate spune „reutilizată din <zi>”;
- `(observatii_stare = 'ok') = (statie_id IS NOT NULL)` și `cerere_observatii IS NOT NULL OR (observatii_stare <> 'ok' AND raspuns_observatii IS NULL)` obligă ca un rând cu stație să aibă starea `ok` și o cerere de observații;
- marcajul „reutilizată” ar sta doar în `raspuns_observatii`, pe care vederea `v_meteo_zilnic_xweather` (raportul / exportul) nu o arată. Raportul ar prezenta stația ca verificată pentru zi, ceea ce nu e acceptabil ca dovadă.

Așa că și istoricul cere `observations/summary/closest` la fiecare zi-șantier. Costul: +331 de accese o singură dată (662 în loc de 331) și ≈ +1 acces pe fiecare raport întârziat. Reutilizarea ar cere o migrare nouă (o stare `reutilizata` + afișarea ei), separată de `20261221a`.

### Limite asumate

- Corecțiile furnizorului nu se mai prind automat. Owner-ul le cere pe interval cu `reverifica: true`.
- O zi FĂRĂ raport, mai veche de 7 zile, sau orice zi a unui șantier inactiv, se completează doar cu comanda owner-ului.
- O zi pentru care Xweather răspunde definitiv „fără date” nu se scrie (tabelul cere cel puțin o valoare). Dacă are raport, se cere din nou la fiecare rulare: 1 acces pe zi pentru fiecare astfel de zi. Apare în rezultat la `lipsa`.
- `ZILE_RELUARE_ACTIVE` = 7 e o abatere conștientă de la „doar ieri”. Fără ea, ieri neajuns din cauza plafonului, a termenului sau a unui 5xx s-ar pierde dacă n-a existat raport, exact ziua nelucrată din cauza vremii. Costul e 0 în regim normal. Cu valoarea 1 se revine strict la „ieri”.

## Variante pentru vremea curentă (decizia owner-ului, NEIMPLEMENTATE)

Marja lunară rămâne mică (≈ 244 de accese în lunile de 31 de zile), iar o singură reîmprospătare manuală costă 76. Variante:

| Variantă | Ce se schimbă | Economie / zi | Economie / lună (31 de zile) |
|---|---|---|---|
| V1 | Calitatea aerului o dată pe zi (04:05), nu de 4 ori | 3 × 19 = 57 | ≈ 1.770 |
| V2 | Prognoza + alertele + aerul de 2 ori pe zi, nu de 4 | 2 × 57 = 114 | ≈ 3.530 |
| V3 | Vremea curentă doar pe sediu + șantierele active (≈ 11 ținte în loc de 19) | 456 − 264 = 192 | ≈ 5.950 |

V1 e cea mai mică schimbare și singură aduce marja la ≈ 2.000 pe lună. V3 folosește aceeași regulă de activitate ca pasul zilnic.

## Ce se vede în răspunsul cron-ului

În `net._http_response`, la rularea de la 04:05 UTC:

- `status_code`: 200 când toate zilele cerute sunt salvate, 207 când e parțial (plafon / termen / 5xx);
- `content`:
  - `accese_xweather` (la vârf);
  - `xweather.accese_xweather`, `xweather.plafon_accese`, `xweather.buget_ms`, `xweather.durata_ms`;
  - `xweather.sarcini_pe_tinta` (`activ` / `raport`), `xweather.santiere_active`;
  - `xweather.scrise`, `xweather.neajunse`, `xweather.nr_nesalvate`, `xweather.zile_nesalvate` (motivele);
  - `xweather.oprit`.

## Istoric

| Data | Ce |
|---|---|
| 13.11.2026 | r4: țintele după activitate, plafon 60 de accese pe rulare, termen 40 s, fără reverificare automată |
