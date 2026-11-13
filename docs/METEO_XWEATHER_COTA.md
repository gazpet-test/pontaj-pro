# Vremea Vaisala Xweather: cota în unități de cost (r8)

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
- **Două părți (r6).** Coada are partea „ieri” (ziua nouă a șantierelor active) și partea „restanțe” (tot restul: zilele lipsă ale șantierelor active și zilele cu raport din fereastră). În r5 „ieri” era mereu primul și, cu plafonul mic, putea lua toate locurile: zece șantiere active la plafon 10 = zero restanțe în 31 de rulări (contraexemplul recenzentului).
  - Locurile unei rulări: `pas` = plafonul / costul unei zile (plafon 10 → 5, plafon 60 → 30).
  - Când există amândouă părțile, restanțele au rezervat **cel puțin o treime: ⌈pas / 3⌉, minimum o zi-șantier**. Restul e al lui „ieri”. Plafon 10: **2 restanțe + 3 ieri**. Plafon 60: **10 restanțe + 20 ieri**. La `pas` 1, locul alternează zilnic.
  - Partea nefolosită a uneia trece celeilalte (de exemplu, 2 zile „ieri” la plafon 10 → 3 locuri pentru restanțe).
  - De ce o treime: în regimul normal (≈ 7–10 șantiere active, plafon 60) „ieri” încape integral în cele 20 de locuri ale lui. Cu plafonul mic, „ieri” păstrează majoritatea, iar restanțele nu mai stau pe loc.
  - Cele două părți se împletesc uniform în **ordinea de execuție** (nu una după alta). r7: rezervarea e pe capacitatea planificată, dar oprirea poate veni oricând (garda de cotă actualizată după primele zile, termenul, un cost mai mare decât cel rezervat). De aceea, restanțele din primele `m` poziții = **round(m × restanțe / (ieri + restanțe))**. Plafon 10 (3 + 2): **I R I R I** (în r6: I I R I R, iar o oprire după 2 poziții lăsa restanțele la zero).
  - **r8: „ieri” începe rularea.** Când „ieri” are cel puțin un loc în rulare, **prima poziție e a lui „ieri”**; restul se împletește ca în r7. Formula: restanțele din primele `m` poziții = **min(round(m × restanțe / (ieri + restanțe)), m − 1)**. Motivul (contraexemplul recenzentului r7): plafon 10, un singur șantier activ cu „ieri” lipsă + zece restanțe → împărțirea 1 + 4, iar r7 dădea **R R I R R**. Cu 18 s pe zi și pasul de 40 s, după două restanțe nu mai rămânea timp, iar „ieri” ieșea „neajunsă (bugetul de timp)”. Acum: **I R R R R** („ieri” servit primul, apoi o restanță). Plafon 10 cu 3 + 2 rămâne **I R I R I**. La `pas` 1, în ziua în care locul e al restanțelor, „ieri” nu are loc și nu începe.
  - Garanția (testată pentru k = 1..n, 384 de combinații pas / ieri / restanțe, două zile de pornire): (1) când „ieri” are loc, prima poziție e „ieri”; (2) după o oprire după oricare k poziții, numărul de restanțe servite e **⌊așteptat⌋ sau ⌈așteptat⌉** (așteptat = k × proporția planificată, mărginit de epuizarea părților), deci fiecare parte e la **mai puțin de o poziție** de proporție (½, cât timp limita „m − 1” nu lucrează). Nu garantează partea ÎNTREAGĂ: o oprire după 2 poziții servește 1 + 1, nu 3 + 2.
  - Rezultatul pasului arată împărțirea în `xweather.rotatie.parti` (`pas`, `rezervat_restante`, `rezervat_ieri`, `ieri`, `restante`).
- **Rotația.** Rămâne în interiorul fiecărei părți: se parcurge circular, dintr-un punct de pornire care se mută cu ziua calendaristică: `⌊fracția(indexul zilei × φ) × lungimea părții⌋`, cu φ = 0,618… (raportul de aur).
  - Coada care încape întreagă în rulare nu se rotește și nu se împletește, deci ordinea rămâne „ieri, apoi cele mai noi”.
  - Prima variantă, „(index × pas) mod lungime”, ajungea la 70 de rulări cu plafonul mic, pentru că se decala când coada se scurta.
- **Garanția, în cifre** (simulări pe planul și ordinea reale, zilele reușesc; `src/xweatherCoadaParti.test.js`):

  | Situația | Pe rulare | B restanțe servite în |
  |---|---|---|
  | Plafon 60, 10 șantiere active | 10 ieri + 20 restanțe | B = 40 în **2** rulări (⌈B / 20⌉), oricare zi de pornire din 60 |
  | Plafon 60, 20 de șantiere active (partea întreagă a lui „ieri”) | 20 + 10 | B = 40 în **4** rulări (⌈B / 10⌉) |
  | Plafon 10, 3 șantiere active | 3 + 2 | B = 10 în **5** rulări (⌈B / 2⌉), oricare zi de pornire din 60 |
  | Plafon 10, fără șantiere active | 0 + 5 | B = 10 în **2** rulări |
  | Plafon 10, 10 șantiere active (contraexemplul, supraîncărcat) | 3 + 2, în FIECARE rulare | 62 de restanțe servite în 31 de rulări. Din 20 de zile vechi: 10 servite, 10 ies din fereastră (apar în `restante_vechi`). În r5: 0 servite. |
  | „70 fără date + 10 bune”, cu 3 zile „ieri” pe rulare | 3 ieri integral | cele 10 bune în ≤ **3** rulări la plafon 60 (fără „ieri”: ≤ 2) și ≤ **102** la plafon 10 (fără „ieri”: ≤ 26) |

  - La supraîncărcare (mai multe zile „ieri” noi decât partea lor), cele neservite trec a doua zi în restanțe. Restanțele primesc tot cel puțin partea lor, dar o zi veche anume nu mai are o limită de rulări: poate ieși din fereastră. Atunci apare în `restante_vechi`.
  - Cazul „70 fără date” e artificial (în realitate o zi fără date iese din fereastră după cel mult 31 de zile). Cu „ieri” prezent, restanțele au 54 din 60 de unități, respectiv 4 din 10, deci debitul scade, dar nu se oprește.
- **Limita:** o zi-șantier iese singură din coadă când iese din fereastră. O zi fără date e reîncercată cel mult cât stă în fereastră: cel mult 31 de încercări, de 1 unitate fiecare. Pe șantierele active, zilele fără raport sunt reîncercate cel mult 7 zile.
- **Restanțele ieșite din fereastră (r6, `xweather.restante_vechi`).** Un raport rămas fără vreme la ieșirea din fereastră nu mai e cerut automat. Ca să nu dispară, pasul zilnic (doar cu `XW_ZILNIC_ACTIV=1`) raportează la fiecare rulare:
  - **Regula (r7).** „Are vreme” se stabilește pentru ACELEAȘI zile-șantier care au fost citite ca rapoarte. În r6 vremea era o singură pagină pe tot intervalul și putea omite zile care AU vreme. Contraexemplul recenzentului: rapoarte la 01.01.2023 și 01.10.2026, ambele cu vreme, plus 999 de zile cu vreme între ele. r6 raporta `numar: 1` (octombrie), deși realitatea era zero.
  - Citirea: (1) o pagină de rapoarte dinaintea ferestrei, de la cea mai veche (ordinea data, id; cel mult 1.000 de rânduri). Acestea sunt zilele-șantier **verificate**. (2) Pentru fiecare șantier din pagină, vremea salvată pe intervalul zilelor lui din pagină, citită **până la capăt** (pe chei, până la pagina goală), sub termen. Perechea șantier-zi contează: vremea altui șantier în aceeași zi nu acoperă raportul.
  - `numar` = restanțe **confirmate** (raport prezent, vreme absentă) printre zilele-șantier verificate. `verificate` = câte zile-șantier cu raport au fost verificate. `inainte_de` = prima zi a ferestrei. `cea_mai_veche`. `exemple` = cel mult 10 (`site_id`, `zi`), de la cea mai veche, fiecare verificat complet. `sens` = aceeași explicație, în răspuns;
  - `exact: false` **doar** dacă pagina de rapoarte a fost plină (1.000 de rânduri). Înseamnă **„posibil incomplet”**, nu „sigur mai sunt”: la exact 1.000 de rapoarte verificate se poate să nu mai existe niciunul. `numar` e un minim adevărat (nu poate supraestima);
  - `"neajuns (termen)"` dacă nu mai e timp, inclusiv dacă citirea vremii nu se poate termina (niciodată o cifră parțială). `{ eroare }` dacă o citire a eșuat;
  - fără cereri către furnizor. Se citesc DUPĂ zilele servite, sub termenul global, deci nu iau timp pasului zilnic;
  - **Limita (r8).** Citirea poate face multe interogări în BD, una după alta: 1 pentru pagina de rapoarte + **cel puțin 2 pe fiecare șantier din pagină** (pagina cu vreme și pagina goală care închide citirea), plus încă una la fiecare 1.000 de zile cu vreme pe intervalul unui șantier. Cazul rău: 1.000 de șantiere cu câte o zi = **2.001 interogări**. Dacă nu se termină până la termenul global, rezultatul e `"neajuns (termen)"`, fără cifră. În practică (câteva zeci de șantiere) sunt câteva zeci de interogări;
  - le completează owner-ul cu `xweather_backfill` (șantierul din exemple, `pana` = ziua).

### „O dată pe zi” și limitele

- Dacă toate țintele ferestrei au deja vreme, pasul nu face nicio cerere (`nimic_de_facut: true`). O a doua rulare din aceeași zi nu mai consumă nimic pentru zilele salvate. Reîncearcă doar zilele încă nesalvate, în limita plafonului.
- **Două rulări SIMULTANE** (cronul + un apel manual al owner-ului în aceeași clipă) pot dubla consumul unei rulări, adică cel mult 2 × 60 de unități. Scrierea rămâne idempotentă (23505). O garanție atomică ar cere schemă nouă (un rând de „rulare în curs” cu blocare). **Decizia owner-ului; neimplementată.**

## Timpul: un singur termen

| Pas | Ordinea | Limita |
|---|---|---|
| Termenul global | De la intrarea în handler | **100 s** (`TERMEN_HANDLER_MS`). Cronul așteaptă 120 s, deci rămân 20 s pentru răspuns. |
| 0. Corpul cererii, autentificarea, credențialele | Înaintea primului pas | Sub termen (r6). Depășirea aici = HTTP **504** cu `error: "termen depășit la <ce>"` (corpul cererii / secretul cronului / verificarea utilizatorului / profilul utilizatorului / credențialele Xweather). |
| 1. Vremea curentă | Prima (prioritară; aduce antetele de cotă) | Fiecare cerere ≤ 25 s și tăiată la termen. Un site nou începe doar cu ≥ 5 s rămase. |
| 2. Istoricul Open-Meteo | A doua | ≤ **30 s** (`BUGET_ISTORIC_ZILNIC_MS`) și sub termen. Fiecare cerere ≤ 25 s, tăiată la termen. Un site nou începe doar cu ≥ 5 s rămase. Recenzentul măsurase 124,5 s doar aici; acum cel mult 30 s. |
| 3. Pasul zilnic Xweather | A treia | ≤ **40 s** (`BUGET_XW_ZILNIC_MS`) și sub termen. O zi nouă începe doar cu ≥ 5 s rămase. |

- Ce nu mai are timp apare „neajuns (termen)”: pe site, în istoric sau în pasul zilnic.
- **r6: TOATE așteptările handlerului trec printr-un singur ajutător de termen** (`cuTermen`): corpul cererii, autentificarea, credențialele, configurarea, fiecare citire / scriere BD și fiecare cerere de rețea (`cerereRetea`: fetch-ul ȘI citirea corpului răspunsului, Xweather și Open-Meteo, cu anulare la termen). Un test static verifică că în `index.ts` nu rămâne niciun `await` pe client sau pe rețea în afara lui; fiecare punct de așteptare are un test cu ceas simulat în care apelul nu se mai termină, iar răspunsul pleacă la cel mult 100 s.
- **r7: garanția e structurală, nu doar lexicală.** Clientul bazei e creat într-un singur loc (adaptorul `bazaCuTermen`), iar handlerul primește doar adaptorul. Orice interogare / apel întors de el e mărginit singur la termen, oricum ar fi așteptat (`await`, `.then`, `Promise.all`). Recenzentul arătase că `await Promise.all([db.rpc(...)])` scăpa de testul static. Acum, și fără `cuTermen` în handler, răspunsul pleacă tot la cel mult 100 s (testat cu ceas simulat: `Promise.all`, `await` direct, `.then`). Testul static rămâne a doua plasă: clientul brut (`createClient`, `.auth`) și consumarea directă (`.then`) nu apar în afara adaptorului, iar `fetch` nu apare în afara `cerereRetea`.
- Ajutătorul consumă builderul bazei O SINGURĂ dată (builderul e leneș: fiecare consumare ar fi o cerere nouă); testat cu un builder care își numără consumările, și prin adaptor.
- O citire / scriere BD abandonată la termen nu se anulează pe server, doar nu mai e așteptată. **Scrierile abandonate se pot termina ulterior.** Unicitatea (23505) oprește dubla inserare a unei zile, dar NU oprește repetarea cererilor plătite: dacă scrierea unei zile n-a fost confirmată la termen, rularea următoare cere ziua din nou (2 unități).
- Schimbare față de r4: vremea curentă rulează acum ÎNAINTEA istoricului și a pasului zilnic (înainte era ultima). Așa are prioritate la timp și aduce antetele pentru gardă.
- Comanda owner-ului păstrează 100 s, tot sub termenul global.

### Contractul cronului (citit din producție, 13.11.2026)

- Jobul `meteo_sync_2h` (`5 */2 * * *`) rulează `SELECT public.meteo_cron_tick();`.
- `meteo_cron_tick()` (SECURITY DEFINER) iese fără nimic dacă lipsesc credențialele Xweather din seif; altfel citește secretul cronului din seif LA RULARE și face `net.http_post` către funcție, cu corpul `{}`, antetul cu secretul și `timeout_milliseconds := 120000`.
- Cronul NU citește răspunsul funcției. Răspunsul (status 200 / 207 / 504 și conținutul JSON) rămâne în tabelul de răspunsuri al extensiei `pg_net` (`net._http_response`), de unde îl citește coordonatorul. `cron.job_run_details` arată doar că cererea a fost trimisă.
- Definiția funcției `meteo_cron_tick` nu e în repo; acest rezumat e citirea din producție de mai sus, fără valori de secrete.

## Variabilele de mediu noi (fără secrete)

| Nume | Valori | Implicit | Cine o pune |
|---|---|---|---|
| `XW_ZILNIC_ACTIV` | exact `1` = pornit; orice altceva sau lipsă = oprit | lipsă = **oprit** | Coordonatorul (chat), cu „da”-ul lui Răzvan, în secretele funcției Edge `meteo-sync` (Supabase → Edge Functions → Secrets), **după** migrarea `20261221a` |
| `XW_AER_PE_ZI` | `0`, `1`, `2`, `3`, `4` (altă valoare, inclusiv șirul gol = 4, semnalată în `cota.aer_pe_zi_invalid`) | 4 (ca azi) | Coordonatorul, după decizia owner-ului pe cota reală |

`cota.aer_pe_zi_sursa` spune de unde vine valoarea folosită: `setata` (0..4), `implicita` (variabila lipsește), `invalida` (orice altceva, inclusiv șirul gol → 4).

Cu `XW_ZILNIC_ACTIV` oprit:

- funcția nu face nicio cerere `conditions/summary` / `observations/summary`;
- nu citește tabelul nou și nici rapoartele zilnice;
- rezultatul pasului e `xweather: { activ: false, motiv: "pas zilnic oprit (configurare)" }`, cu HTTP 200 și `xweather_ok: null`;
- comanda owner-ului răspunde 409 cu același motiv.

## Publicarea în două trepte

**Treapta I — doar vizibilitatea costului (înaintea migrării):**

1. Se publică funcția `meteo-sync` (r6) **fără** `XW_ZILNIC_ACTIV` și cu `XW_AER_PE_ZI` nesetat (4, ca azi). În răspuns apar costul și cota. Ce se schimbă la vremea curentă față de versiunea publicată azi (nu e „același comportament”):
   - țintele, cererile și câmpurile scrise în `meteo_cache` sunt aceleași, dar vremea curentă rulează acum PRIMA, iar șantierele se iau pe rând (cele patru cereri ale unui șantier, în paralel);
   - fiecare cerere are o limită de timp (25 s) și totul stă sub termenul de 100 s. Patru șantiere lente pot consuma termenul; restul apar „neajuns (termen)” în `rez`;
   - pentru un șantier neajuns, interfața păstrează datele vechi și le estompează după trei ore;
   - o citire / scriere abandonată la termen se poate termina ulterior (vezi „Timpul”).
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
   - `xweather.rotatie.parti` (împărțirea ieri / restanțe) și `xweather.restante_vechi` (zilele ieșite din fereastră, de dat owner-ului);
   - în zilele următoare: `nimic_de_facut: true` sau doar ieri + rapoartele întârziate, ≈ 14–20 de unități.

## Ce se vede în răspunsul cronului (după r6)

În `net._http_response.content`:

- `cota`: `cereri`, `unitati` (din antete), `unitati_estimate`, `estimate`, `total_prudent`, `pe_endpoint`, `multiplicatori`, `perioada` {`limita`, `rest`, `resetare`, `tip`}, `minut` {…}, `cota_necunoscuta`, `oprit`, `asteptari_minut`, `aer_pe_zi`, `aer_pe_zi_invalid`, `aer_pe_zi_sursa`, `pas_zilnic_activ`;
- `termen`: `ms`, `durata_ms`;
- `rez[]`: vremea curentă pe site (`ok`, `aer`, sau `eroare`: „neajuns (termen)”, „oprit: …”, „termen depășit la …”);
- `istoric`: `neajunse` și pe site `eroare: "neajuns (termen)"`;
- `xweather` (pasul zilnic): `accese_xweather` (cereri), `unitati_xweather`, `plafon_unitati`, `cost_zi_santier`, `garda_cota`, `cota_necunoscuta`, `rotatie` {`pornire`, `pas`, `parti`}, `nimic_de_facut`, `scrise`, `neajunse`, `oprite`, `nr_nesalvate`, `zile_nesalvate`, `zile_fara_date`, `restante_vechi`, `oprit`, `buget_ms`, `durata_ms`;
- la vârf: `xweather_ok`, `accese_xweather`;
- HTTP 504 (r6): termenul a fost depășit înaintea primului pas; corpul are doar `ok: false`, `error: "termen depășit la <ce>"` și `termen`.

Fără chei și fără URL-uri: antetele se citesc doar ca numere și text scurt, dintr-un alfabet restrâns.

## Limite asumate

- Costul `observations/summary` e estimat la 1 până la prima rulare. Dacă e mai mare, prima zi a unei rulări poate depăși rezerva cu diferența. După primul antet, rezerva se corectează.
- Un 429 fără cod e tratat ca limita perioadei: rularea se oprește, deși poate fi doar limita pe minut.
- Așteptarea minutului e o pauză reală de cel mult 61 s, în termen, o dată pe rulare.
- Corecțiile furnizorului nu se mai prind automat. Owner-ul le cere pe interval cu `reverifica: true`.
- Stația cea mai apropiată se cere la fiecare zi-șantier. Reutilizarea ei ar cere o migrare nouă; motivele sunt neschimbate față de r4: CHECK-urile din `20261221a` și vederea care n-ar arăta marcajul.
- r6: autentificarea și credențialele sunt și ele sub termen (504 la depășire). O scriere abandonată la termen se poate termina ulterior; unicitatea oprește dubla inserare, nu repetarea cererilor plătite pentru ziua neconfirmată.
- Plafonul mic (cota necunoscută) cu multe șantiere active e un regim supraîncărcat: restanțele primesc partea lor în fiecare rulare, dar o zi veche anume poate ieși din fereastră neservită; atunci apare în `restante_vechi`.

## Istoric

| Data | Ce |
|---|---|
| 13.11.2026 | r4: țintele după activitate, plafon 60 de accese pe rulare, termen 40 s, fără reverificare automată |
| 13.11.2026 | r5: costul în unități din antete pentru toate cererile Xweather; blocul `cota`; `XW_ZILNIC_ACTIV` (publicare în două trepte); garda de cotă; 429 pe coduri; `XW_AER_PE_ZI`; termen global 100 s; fereastra de 31 de zile + rotația cozii; „nimic de făcut” = zero cereri |
| 13.11.2026 | r6: termenul acoperă TOATE așteptările (autentificare, credențiale, corpul cererii și al răspunsurilor; 504 înaintea primului pas); restanțele au rezervată o treime din locuri; `restante_vechi`; `aer_pe_zi_sursa`; tipurile (`deno check` fără erori); contractul cronului |
| 13.11.2026 | r7: `restante_vechi` numără doar restanțe confirmate (vremea citită până la capăt pe aceleași zile-șantier; `verificate`, `sens`; `exact: false` doar la pagina de rapoarte plină); adaptorul bazei mărginește orice consumare (garanție structurală; testul static = a doua plasă); părțile cozii împletite cu rotunjire în ordinea de execuție (orice oprire ≤ ½ poziție de proporție) |
| 13.11.2026 | r8: „ieri” începe rularea când are loc (prima poziție; restul împletit, abatere < 1 poziție la orice oprire); `restante_vechi`: `exact: false` = „posibil incomplet”, limita interogărilor documentată |
