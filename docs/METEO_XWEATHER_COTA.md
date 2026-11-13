# Vremea Vaisala Xweather: cota în unități de cost (r5)

Funcția `meteo-sync` (cron `meteo_sync_2h`, `5 */2 * * *`) folosește un singur cont Xweather pentru două lucruri:

1. **vremea curentă** (tabelul `meteo_cache`): 19 ținte la fiecare rulare, adică 12 rulări pe zi, dintre care 4 „complete” (UTC 04 / 10 / 16 / 22);
2. **vremea zilei ca dovadă în rapoarte** (tabelul `meteo_zilnic_xweather`, migrarea `20261221a`): o dată pe zi, la rularea de la 04:05 UTC, doar cu `XW_ZILNIC_ACTIV=1`.

Regulile stau în două fișiere: `supabase/functions/meteo-sync/xweather_cota_logica.ts` (costuri, antete, gardă, configurare) și `xweather_zilnic_logica.ts` (țintele, fereastra, rotația).

## Ce spune documentația oficială Xweather

| Fapt | Sursa |
|---|---|
| Costul unei cereri = produsul multiplicatorilor (endpoint × timp × spațiu). Îl raportează antetul `X-Cost-Tokens`, însoțit de `X-Cost-Endpoint` și `X-Cost-Multipliers`. | [Cost Headers](https://www.xweather.com/docs/weather-api/getting-started/cost-headers) |
| O altă pagină oficială scrie antetul la singular, `X-Cost-Multiplier`. Codul le acceptă pe amândouă. | [Responses](https://www.xweather.com/docs/weather-api/getting-started/responses) |
| Antetele de cost apar la răspunsurile 2xx. Răspunsurile 4xx / 5xx NU consumă. | [Cost Headers](https://www.xweather.com/docs/weather-api/getting-started/cost-headers) |
| Multiplicatori: `conditions` 1, `forecasts` 1, `alerts` 1, **`airquality` 5**. | [Tarife](https://www.xweather.com/pricing/weather-api-pay-as-you-go), [Air Quality](https://www.xweather.com/docs/weather-api/endpoints/airquality) |
| `conditions/summary`: 1 unitate pe zi (și pe zi parțială). | [Conditions Summary](https://www.xweather.com/docs/weather-api/endpoints/conditions-summary) |
| `observations/summary`: multiplicator **nespecificat**. În cod e estimat la 1, până îl arată antetul. | [Observations Summary](https://www.xweather.com/docs/weather-api/endpoints/observations-summary) |
| Antetele de cotă: `X-RateLimit-Limit-Minute`, `-Remaining-Minute`, `-Reset-Minute`, `-Limit-Period-Type`, `-Limit-Period`, `-Remaining-Period`, `-Reset-Period`. | [Rate Limiting](https://www.xweather.com/docs/weather-api/getting-started/rate-limiting) |
| Depășirea dă HTTP 429 cu codul `maxhits` (perioada abonamentului), `maxhits_daily` (până la 00:00 UTC) sau `maxhits_min` (minutul). Un 429 NU înseamnă neapărat cota lunară. | [Responses](https://www.xweather.com/docs/weather-api/getting-started/responses), [Changelog](https://www.xweather.com/docs/weather-api/changelog) |
| Cererile `/batch` se numără subcerere cu subcerere, deci nu aduc economie. | [Batch](https://www.xweather.com/docs/weather-api/getting-started/batch) |

**Ce NU știm încă:** cota reală a contului, restul ei și data resetării. Le spun doar antetele (după treapta I, mai jos) sau pagina contului. Cifra de 15.000 din versiunile anterioare e o presupunere, nu o valoare citită.

## Consumul vremii curente, în unități

Pe zi: 12 rulări × 19 × `conditions` + 4 rulări complete × 19 × (`forecasts` + `alerts`) + **N** rulări × 19 × `airquality` (5).
N este `XW_AER_PE_ZI`, adică de câte ori pe zi se cere calitatea aerului.

| `XW_AER_PE_ZI` | Când se cere aerul | Unități / zi | 30 de zile | 31 de zile | Față de 15.000 (dacă asta e cota), 31 de zile |
|---|---|---:|---:|---:|---:|
| 4 (implicit, ca azi) | 04 / 10 / 16 / 22 UTC | 228 + 152 + 380 = **760** | 22.800 | 23.560 | **−8.560 (peste)** |
| 2 | 04 / 16 UTC | **570** | 17.100 | 17.670 | −2.670 (peste) |
| 1 | 04 UTC | **475** | 14.250 | 14.725 | +275 |
| 0 | niciodată | **380** | 11.400 | 11.780 | +3.220 |

- Dacă și contul nostru ar avea 15.000 pe lună, schema de azi (4) ar opri singură vremea curentă spre sfârșitul fiecărei perioade.
- O reîmprospătare manuală completă (`forta`) costă 19 × (1 + 1 + 1 + 5) = 152 de unități (cu aerul; 57 fără).
- `XW_AER_PE_ZI` **nu se schimbă în r5**: owner-ul decide valoarea după ce vedem cota reală (treapta I).

## Pasul zilnic, în unități

O zi-șantier costă `conditions/summary` (1) plus, dacă ziua are valori, `observations/summary` (estimat 1). Deci 2 unități, sau 1 pentru o zi fără date.

| Ce | Regula | Unități |
|---|---|---|
| Regim normal | Șantierele active (raport zilnic în ultimele 14 zile): ieri. ≈ 7–10 șantiere × 2. | **≈ 14–20 / zi** |
| Abaterea A, umplerea inițială | La prima activare, pe fiecare șantier activ, zilele lipsă din ultimele 7: până la 7 × șantierele active × 2. Cu 10 șantiere: ≈ 140. | O singură dată. Se întinde pe ≥ 3 rulări (plafonul de 60), cu garda de cotă. |
| Fereastra de 31 de zile | Zilele-șantier cu raport și fără vreme din ultimele 31 de zile. La prima activare: ≈ (rapoartele lunii) × 2. Cu ≈ 10 șantiere × ≈ 22 de zile lucrate: ≈ 440. | O singură dată. Se întinde pe ≈ 8 rulări, cu garda de cotă. |
| Ce e mai vechi de 31 de zile | Inclusiv istoricul de la 21.07.2026, ≈ 331 de zile-șantier. Se face **doar** cu comanda owner-ului, pe câte un șantier (≈ 662 de unități în total), când cota o permite. | 0 automat |

### Plafonul, garda, numărătoarea

- **Plafonul pe rulare: `MAX_UNITATI_XW_RULARE` = 60 de unități**, adică ≈ 30 de zile-șantier.
  - Ajunge pentru regimul normal (≈ 20) cu rezervă și pentru umplerea inițială în câteva zile.
  - Plafonul limitează ziua. Luna o protejează garda.
- **Garda de cotă.** Pasul zilnic rulează DUPĂ vremea curentă, care aduce antetele. Ziua-șantier următoare începe doar dacă:

  restul perioadei − (unitățile pe zi ale vremii curente × zilele până la resetare, rotunjite în sus) − marja ≥ costul unei zile

  - Marja `MARJA_COTA` = 300 (≈ două reîmprospătări manuale complete).
  - Unitățile pe zi se calculează din program: numărul de ținte × multiplicatori. Dacă antetele arată un cost mai mare, se folosește acela.
  - Restul se citește din antetele cele mai noi, deci și pe parcursul pasului.
  - Când nu ajunge: zilele apar „neajunsă (rezerva de cotă pentru vremea curentă)”, cu cifrele în `xweather.garda_cota`, fără nicio cerere. Vremea curentă are mereu prioritate.
- **Fără antete de cotă:** plafon mic declarat, **`PLAFON_COTA_NECUNOSCUTA` = 10 unități** (5 zile-șantier) pentru toată rularea. Rezultatul are `xweather.cota_necunoscuta: true` și `cota.cota_necunoscuta: true`.
- **Comanda owner-ului** (`xweather_backfill`) are plafonul `MAX_UNITATI_XW_APEL` = 62 (= `max_zile` 31 × 2). Garda se aplică din antetele primite, începând cu a doua zi a apelului.
- **Numărătoarea.** Fiecare cerere TRIMISĂ intră în contor:
  - 2xx: costul din `X-Cost-Tokens`; fără el, produsul din antetul de multiplicatori; fără niciunul, multiplicatorul documentat, marcat „estimat”;
  - 4xx / 5xx / rețea / timp depășit: după documentație nu consumă, dar pentru plafon se socotesc prudent cu multiplicatorul documentat, tot ca „estimat”;
  - rezerva unei zile-șantier = 2. Crește dacă un antet arată mai mult (de exemplu observații la 3 → 4 pe zi).
- **Oprirea:**
  - `maxhits` / `maxhits_daily` (și un 429 fără cod, tratat prudent): oprește tot ce e Xweather în rulare. Restul vremii curente, pasul zilnic și comanda owner-ului nu mai trimit nimic;
  - `maxhits_min`: se așteaptă resetarea minutului (`X-RateLimit-Reset-Minute`, altfel 60 s) **o singură dată pe rulare**, doar dacă încape până la termen. Apoi se continuă, iar la a doua limită pe minut se oprește;
  - un HTTP 200 cu `maxhits` în corp (de exemplu la ultima sarcină) nu mai salvează ziua: apare „oprită: …”, iar rezultatul e `complet: false` / 207.

### Coada nu se mai poate înfometa

- Pasul automat se ocupă doar de fereastra mărginită:
  - șantierele active × zilele lipsă din ultimele 7;
  - zilele-șantier cu raport și fără vreme din **ultimele 31 de zile** (`FEREASTRA_RAPOARTE_ZILE`).
- Ce e mai vechi rămâne doar la comanda owner-ului. Comanda are cursor (`continua_pana`), iar zilele fără date sunt sărite de cursor și listate în `zile_fara_date`.
- **Rotația.** „Ieri” pe șantierele active rămâne mereu primul. Restul cozii se parcurge circular, dintr-un punct de pornire care se mută cu ziua calendaristică: `⌊fracția(indexul zilei × φ) × lungimea cozii⌋`, cu φ = 0,618… (raportul de aur).
  - Coada care încape întreagă în rulare nu se rotește, deci ordinea rămâne „cele mai noi întâi”.
  - Testul: 70 de zile fără date în fața a 10 bune, plafon 60. Cele 10 bune sunt servite în **cel mult N = 2 rulări**, oricare ar fi ziua de pornire (400 încercate).
  - Cu plafonul mic (10): cel mult 26 de rulări. Limita vine din debit, fiindcă intră ≤ 9 zile pe rulare.
  - Prima variantă, „(index × pas) mod lungime”, ajungea la 70 de rulări cu plafonul mic, pentru că se decala când coada se scurta.
- **Limita:** o zi-șantier iese singură din coadă când iese din fereastră. O zi fără date e reîncercată cel mult cât stă în fereastră: cel mult 31 de încercări, de 1 unitate fiecare. Pe șantierele active, zilele fără raport sunt reîncercate cel mult 7 zile.

### „O dată pe zi” și limitele

- Dacă toate țintele ferestrei au deja vreme, pasul nu face nicio cerere (`nimic_de_facut: true`). O a doua rulare din aceeași zi nu mai consumă nimic pentru zilele salvate. Reîncearcă doar zilele încă nesalvate, în limita plafonului.
- **Două rulări SIMULTANE** (cronul + un apel manual al owner-ului în aceeași clipă) pot dubla consumul unei rulări, adică cel mult 2 × 60 de unități. Scrierea rămâne idempotentă (23505). O garanție atomică ar cere schemă nouă (un rând de „rulare în curs” cu blocare). **Decizia owner-ului; neimplementată.**

## Timpul: un singur termen

| Pas | Ordinea | Limita |
|---|---|---|
| Termenul global | De la intrarea în handler | **100 s** (`TERMEN_HANDLER_MS`). Cronul așteaptă 120 s, deci rămân 20 s pentru răspuns și pentru o citire / scriere BD aflată în zbor. |
| 1. Vremea curentă | Prima (prioritară; aduce antetele de cotă) | Fiecare cerere ≤ 25 s și tăiată la termen. Un site nou începe doar cu ≥ 5 s rămase. |
| 2. Istoricul Open-Meteo | A doua | ≤ **30 s** (`BUGET_ISTORIC_ZILNIC_MS`) și sub termen. Fiecare cerere ≤ 25 s, tăiată la termen. Un site nou începe doar cu ≥ 5 s rămase. Recenzentul măsurase 124,5 s doar aici; acum cel mult 30 s. |
| 3. Pasul zilnic Xweather | A treia | ≤ **40 s** (`BUGET_XW_ZILNIC_MS`) și sub termen. O zi nouă începe doar cu ≥ 5 s rămase. |

- Ce nu mai are timp apare „neajuns (termen)”: pe site, în istoric sau în pasul zilnic.
- Citirile și scrierile BD sunt așteptate cel mult până la termen. Cererea în zbor nu se anulează, dar handlerul nu o mai așteaptă.
- Schimbare față de r4: vremea curentă rulează acum ÎNAINTEA istoricului și a pasului zilnic (înainte era ultima). Așa are prioritate la timp și aduce antetele pentru gardă.
- Comanda owner-ului păstrează 100 s, tot sub termenul global.

## Variabilele de mediu noi (fără secrete)

| Nume | Valori | Implicit | Cine o pune |
|---|---|---|---|
| `XW_ZILNIC_ACTIV` | exact `1` = pornit; orice altceva sau lipsă = oprit | lipsă = **oprit** | Coordonatorul (chat), cu „da”-ul lui Răzvan, în secretele funcției Edge `meteo-sync` (Supabase → Edge Functions → Secrets), **după** migrarea `20261221a` |
| `XW_AER_PE_ZI` | `0`, `1`, `2`, `3`, `4` (altă valoare = 4, semnalată în `cota.aer_pe_zi_invalid`) | 4 (ca azi) | Coordonatorul, după decizia owner-ului pe cota reală |

Cu `XW_ZILNIC_ACTIV` oprit:

- funcția nu face nicio cerere `conditions/summary` / `observations/summary`;
- nu citește tabelul nou și nici rapoartele zilnice;
- rezultatul pasului e `xweather: { activ: false, motiv: "pas zilnic oprit (configurare)" }`, cu HTTP 200 și `xweather_ok: null`;
- comanda owner-ului răspunde 409 cu același motiv.

## Publicarea în două trepte

**Treapta I — doar vizibilitatea costului (înaintea migrării):**

1. Se publică funcția `meteo-sync` (r5) **fără** `XW_ZILNIC_ACTIV` și cu `XW_AER_PE_ZI` nesetat (4, ca azi). Comportamentul vremii curente rămâne același; în plus apar costul și cota în răspuns.
2. După prima rulare a cronului, coordonatorul citește `net._http_response.content` (răspunsul cronului) și notează:
   - `cota.perioada.limita`, `cota.perioada.rest`, `cota.perioada.resetare`, `cota.perioada.tip` = cota reală, restul, data resetării, tipul perioadei;
   - `cota.minut.limita` / `rest` = limita pe minut;
   - `cota.pe_endpoint.<endpoint>.unitati` / `cost_max` / `estimate` = costul real pe endpoint (mai ales `airquality`; dacă e 5, calculul de mai sus e confirmat);
   - `cota.multiplicatori` = textul antetului de multiplicatori, ca dovadă;
   - `cota.estimate` = câte costuri n-au venit din antete (0 = antetele sunt prezente);
   - `cota.unitati` pe rulare × 12 ≈ consumul pe zi (aproximativ, rulările complete costă mai mult).
3. Cu cifrele acestea, owner-ul decide `XW_AER_PE_ZI` după tabelul de mai sus. Valoarea se pune ca variabilă și se verifică în `cota.aer_pe_zi`.

**Treapta II — vremea zilei în rapoarte:**

1. Se aplică migrarea `20261221a` (fișierul cu amprenta fixată, neschimbat în r5).
2. Se pune `XW_ZILNIC_ACTIV=1`.
3. Prima rulare de la 04:05 UTC. Se verifică în `net._http_response`:
   - `status_code` 200 (toate zilele cerute salvate) sau 207 (parțial: plafon / gardă / termen / 5xx). La prima activare e de așteptat 207, din cauza umplerii inițiale (abaterea A + fereastra);
   - `xweather.garda_cota`: `cunoscuta: true`, `rest`, `rezerva`, `disponibil`, `plafon`. Dacă `disponibil` < 2, pasul nu face nimic, iar vremea curentă e protejată;
   - `xweather.unitati_xweather` ≤ `xweather.plafon_unitati`;
   - `xweather.cost_zi_santier` (2 dacă observațiile costă 1; altfel costul real) și `cota.pe_endpoint["observations/summary"].cost_max`;
   - `xweather.scrise`, `neajunse`, `zile_nesalvate` (motivele), `zile_fara_date`, `aliasuri_folosite`, `oprit`;
   - `termen.durata_ms` < 100.000;
   - în zilele următoare: `nimic_de_facut: true` sau doar ieri + rapoartele întârziate, ≈ 14–20 de unități.

## Ce se vede în răspunsul cronului (după r5)

În `net._http_response.content`:

- `cota`: `cereri`, `unitati` (din antete), `unitati_estimate`, `estimate`, `total_prudent`, `pe_endpoint`, `multiplicatori`, `perioada` {`limita`, `rest`, `resetare`, `tip`}, `minut` {…}, `cota_necunoscuta`, `oprit`, `asteptari_minut`, `aer_pe_zi`, `aer_pe_zi_invalid`, `pas_zilnic_activ`;
- `termen`: `ms`, `durata_ms`;
- `rez[]`: vremea curentă pe site (`ok`, `aer`, sau `eroare`: „neajuns (termen)”, „oprit: …”);
- `istoric`: `neajunse` și pe site `eroare: "neajuns (termen)"`;
- `xweather` (pasul zilnic): `accese_xweather` (cereri), `unitati_xweather`, `plafon_unitati`, `cost_zi_santier`, `garda_cota`, `cota_necunoscuta`, `rotatie` {`pornire`, `pas`}, `nimic_de_facut`, `scrise`, `neajunse`, `oprite`, `nr_nesalvate`, `zile_nesalvate`, `zile_fara_date`, `oprit`, `buget_ms`, `durata_ms`;
- la vârf: `xweather_ok`, `accese_xweather`.

Fără chei și fără URL-uri: antetele se citesc doar ca numere și text scurt, dintr-un alfabet restrâns.

## Limite asumate

- Costul `observations/summary` e estimat la 1 până la prima rulare. Dacă e mai mare, prima zi a unei rulări poate depăși rezerva cu diferența. După primul antet, rezerva se corectează.
- Un 429 fără cod e tratat ca limita perioadei: rularea se oprește, deși poate fi doar limita pe minut.
- Așteptarea minutului e o pauză reală de cel mult 61 s, în termen, o dată pe rulare.
- Corecțiile furnizorului nu se mai prind automat. Owner-ul le cere pe interval cu `reverifica: true`.
- Stația cea mai apropiată se cere la fiecare zi-șantier. Reutilizarea ei ar cere o migrare nouă; motivele sunt neschimbate față de r4: CHECK-urile din `20261221a` și vederea care n-ar arăta marcajul.
- Autentificarea (secretul cronului / JWT) e înaintea primului pas și nu e tăiată de termen. E scurtă.

## Istoric

| Data | Ce |
|---|---|
| 13.11.2026 | r4: țintele după activitate, plafon 60 de accese pe rulare, termen 40 s, fără reverificare automată |
| 13.11.2026 | r5: costul în unități din antete pentru toate cererile Xweather; blocul `cota`; `XW_ZILNIC_ACTIV` (publicare în două trepte); garda de cotă; 429 pe coduri; `XW_AER_PE_ZI`; termen global 100 s; fereastra de 31 de zile + rotația cozii; „nimic de făcut” = zero cereri |
