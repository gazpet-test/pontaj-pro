# Verificare diurne — SEPTEMBRIE 2026 (read-only, 30.09.2026)

Scop: reproducerea formulei din `src/App.jsx` (origin/main: `exportDiurne` ~L4753, `savePayment` ~L2914, export BT ~L5095) pe datele reale din septembrie, pentru TOȚI angajații cu diurne, și compararea cu regula de business a lui Răzvan.
Fără CNP/IBAN/salarii — doar nume, zile, lei diurnă. Nicio modificare în BD.

Script reproductibil: `verif_diurne.py` + `data_sept.py` (scriptul e în anexă; datele se regenerează cu interogările din §0).

## 0. Ce s-a găsit în BD (corecții la premisele verificării)

- **Tranșele reale din septembrie** (`diurna_payments`): **82 = 01–04.09**, 83 = 05–11.09, 84 = 12–18.09, 85 = 19–25.09; tranșa **81 = 22–31.08** (nu 29.08–04.09). Deci NU există o tranșă care să treacă peste 1 septembrie — zilele 01–04.09 sunt în luna corectă și problema „zile din septembrie atribuite lunii august" **nu apare în datele din septembrie 2026**. Tranșa 26–30.09 nu e salvată încă.
- `calendar_days` type='legal': **nicio sărbătoare în septembrie** (singura din perioadă: 15.08). Zile lucrătoare sept = **22** → buget cod = 22 × 50 = 1100 lei.
- `diurna_amount` = 50.
- **LL („Liber Legal") e folosit masiv pe weekend** (06, 12, 13, 20, 26, 27.09) — irelevant pentru plafon (nu-s zile lucrătoare) — dar și pe **zile lucrătoare** (vineri 11.09, vineri 25.09, luni 07.09 la Enache, 28–30 la Stroe/Calin) ca zi liberă compensatorie pentru weekend lucrat. Aici contează dacă LL scade sau nu plafonul.
- 84 de angajați au cel puțin o zi de diurnă bifată în septembrie.

## 1. Cele două formule din cod, pe scurt

**`exportDiurne` (L4753–4920)** — coloana „Diurnă Max. Admisă" / „Peste limită" din Excel:
- `calWorkDays` = zile lucr. de la 1 la `dt` (L4807–4813)
- `normeCumulate` = norme (incl. **LL**) pe zile lucrătoare din **TOATĂ luna** (`allRecs` = monthStart→monthEnd, L4820/L4845) — deci un CO din 21–25.09 scade plafonul deja la exportul 01–04.09
- `zilePlatiteAnterior` = diurne bifate înainte de `df`, **doar pe zile lucrătoare** (L4851–4853) — weekendul bifat NU consumă
- `monthlyRemaining = calWorkDays − normeCumulate − zilePlatiteAnterior`; `periodCapacity = workDaysInPeriod − normeInPeriod`; `diurnaMax = min(...)` (L4856–4859); `pesteLimita = bifate − diurnaMax` (L4865)
- separat, „nota buget": `bugetLunar = 22×50` **fără concediu** (L4869), `platitAnteriorSuma = min(buget, TOATE diurnele dinainte×50)` (L4874–4878)

**`savePayment` (L2914–2990)** — ce se SALVEAZĂ efectiv în `diurna_payment_details` (export BT, L5117–5145, identic):
- `bugetLunar = bugetZileSave × diurnaAmt` = 22×50 = 1100, **fără nicio scădere de concediu/norme** (L2963–2967)
- `platitAnt` = suma din `diurna_payment_details` a tranșelor anterioare din lună (L2985)
- `sumaConfirmata = min(zile×50, bugetLunar − platitAnt)` (L2988) → surplusul merge la salariu
- `monthStart` derivat din **`df`** (L2957), pe când în `exportDiurne` din **`dt`** (L4776) — o tranșă care ar trece peste 1 ale lunii ar fi tratată diferit de cele două funcții (nu e cazul în septembrie 2026, vezi §0).

Concluzie structurală: **cele două funcții calculează lucruri diferite**. `exportDiurne` scade concediul din plafon (dar și LL, și cu toate normele lunii anticipat); `savePayment` — singura care produce bani — folosește plafonul fix de 22 zile/lună, fără concediu. Coloana „Peste limită" din Excel nu are legătură cu ce se plătește.

## 2. Tabel — toți angajații cu diurne în septembrie

Legendă: T1..T5 = 01–04 / 05–11 / 12–18 / 19–25 / 26–30.09. „R" = regula lui Răzvan. „Δ cod vs R(B)" = surplus la salariu conform `savePayment` minus surplus conform regulii R cu LL care NU scade plafonul (varianta care dă 50 lei la Matei). Rândurile **≠** sunt cele unde codul diferă de regulă.

| id | Nume | Norme zile lucr. (fără LL) | LL zile lucr. | Bifate | din care WE | Plătit efectiv (82–85) lei | Cod: peste limită export (T1..T5) | Cod savePayment surplus lei (T1..T5) | Plafon R (LL nu scade) | Surplus R lei (T1..T5) | Plafon R (LL scade) | Surplus R lei (T1..T5) | Δ cod vs R(B) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | ABSER DIDARUL | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 10 | AKURETIYA GAMAGE SHASHIKA LAKMAL | 0 | 1 | 23 | 2 | 1000 (20 z) | 1,2,1,1,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 21 | 0,0,0,0,100 (tot 100) | +0 |
| 11 | AMANDEEP SINGH | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 12 | AMARASINGHE MAKAVITAGE INDIKA | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 13 | ANDACS NICOLAE BENOLE | 0 | 2 | 5 | 1 | 250 (5 z) | 2,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | +0 |
| 14 | APOSTOL ANDRUT | 4 | 0 | 8 | 0 | 300 (6 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | +0 |
| 15 | APURU SANKAR | 0 | 2 | 24 | 4 | 950 (19 z) | 2,2,1,1,2 | 0,0,0,0,100 (tot 100) | 22 | 0,0,0,0,100 (tot 100) | 20 | 0,0,0,0,200 (tot 200) | +0 |
| 16 | ARBANAS GICU | 0 | 1 | 2 | 0 | 100 (2 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | +0 |
| 17 | BAIESU DARIUS OVIDIU (încetat 2026-09-11) | 0 | 1 | 9 | 1 | 0 (0 z) | 1,1,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | +0 |
| 18 | BAIESU LEONTIN | 6 | 1 | 16 | 1 | 650 (13 z) | 4,5,0,0,0 | 0,0,0,0,0 (tot 0) | 16 | 0,0,0,0,0 (tot 0) | 15 | 0,0,0,0,50 (tot 50) | +0 |
| 20 | BELECCIU COSTEL MARICEL | 10 | 1 | 12 | 1 | 450 (9 z) | 0,0,1,1,0 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,0 (tot 0) | 11 | 0,0,0,0,50 (tot 50) | +0 |
| 21 | BELECCIU PARASCHIV | 5 | 2 | 17 | 2 | 700 (14 z) | 4,5,0,1,0 | 0,0,0,0,0 (tot 0) | 17 | 0,0,0,0,0 (tot 0) | 15 | 0,0,0,0,100 (tot 100) | +0 |
| 25 | CALIN CONSTANTIN | 2 | 4 | 20 | 4 | 1000 (20 z) | 4,6,4,5,0 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | 16 | 0,0,0,200,0 (tot 200) | +0 |
| 26 | CERNAIANU CLAUDIU | 2 | 2 | 1 | 0 | 50 (1 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | +0 |
| 27 | CERNAIANU MARINEL ALEXANDRU | 0 | 2 | 1 | 0 | 50 (1 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | +0 |
| 28 | CIOBANU CONSTANTIN | 3 | 1 | 18 | 2 | 750 (15 z) | 4,4,3,0,0 | 0,0,0,0,0 (tot 0) | 19 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | +0 |
| 34 | COSACU GHEORGHE | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 35 | COSMIN ADRIAN | 0 | 2 | 19 | 3 | 850 (17 z) | 2,2,0,2,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | +0 |
| 39 | DASANAYAKE LEKAMALAGE CHAMINDA JAYAWARDHANA DASANAYAKE | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 174 | DIMA GHEORGHE | 0 | 0 | 9 | 2 | 200 (4 z) | 0,0,0,0,2 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | +0 |
| 40 | DIMA GHEORGHITA | 10 | 1 | 12 | 1 | 450 (9 z) | 4,5,0,0,0 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,0 (tot 0) | 11 | 0,0,0,0,50 (tot 50) | +0 |
| 41 | DOBRIN CONSTANTIN ADRIAN | 0 | 2 | 23 | 3 | 1000 (20 z) | 2,2,1,2,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 20 | 0,0,0,0,150 (tot 150) | +0 |
| 42 | DOBRIN VASILICA | 0 | 2 | 23 | 3 | 1000 (20 z) | 2,2,1,2,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 20 | 0,0,0,0,150 (tot 150) | +0 |
| 161 | DONCIU MARIAN | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 43 | DOVINCA CONSTANTIN | 0 | 1 | 23 | 2 | 1000 (20 z) | 1,2,1,1,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 21 | 0,0,0,0,100 (tot 100) | +0 |
| 44 | DUMITRACHE FLORIN | 10 | 1 | 12 | 1 | 450 (9 z) | 4,5,0,0,0 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,0 (tot 0) | 11 | 0,0,0,0,50 (tot 50) | +0 |
| 48 | ENACHE VASILE VLADUT | 0 | 1 | 22 | 1 | 950 (19 z) | 1,1,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,50 (tot 50) | +0 |
| 157 | ENE MARIAN | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 50 | FRATILA DUMITRU | 0 | 1 | 24 | 4 | 1050 (21 z) | 1,2,0,1,0 | 0,0,0,0,100 (tot 100) | 22 | 0,0,0,0,100 (tot 100) | 21 | 0,0,0,0,150 (tot 150) | +0 |
| 159 | GHERGHESCU AUREL | 0 | 2 | 1 | 0 | 0 (0 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | +0 |
| 135 | GHIORGHIU CLAUDIU GHEORGHE | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 52 | GHIORGHIU VASILE | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 53 | GUMMADI SEKHAR | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 54 | HEM RAJ | 0 | 0 | 26 | 4 | 1050 (21 z) | 0,1,0,1,2 | 0,0,0,0,200 (tot 200) | 22 | 0,0,0,0,200 (tot 200) | 22 | 0,0,0,0,200 (tot 200) | +0 |
| 55 | ILIE CORADO FLORINEL | 0 | 1 | 18 | 2 | 750 (15 z) | 0,0,0,2,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | +0 |
| 56 | ILIE VASILE EMANUEL | 1 | 2 | 21 | 2 | 900 (18 z) | 3,3,1,1,0 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | 19 | 0,0,0,0,100 (tot 100) | +0 |
| 57 | IOAN SORIN ALEXANDRU (încetat 2026-09-25) | 0 | 1 | 21 | 3 | 700 (14 z) | 1,1,0,2,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | +0 |
| 172 | JIPA PETRU | 0 | 1 | 13 | 1 | 500 (10 z) | 0,0,0,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | +0 |
| 59 | KATTADIGE SUMITH WICKRAMASINGHE | 0 | 1 | 25 | 4 | 1050 (21 z) | 1,1,0,2,1 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 60 | KODITHUWAKKU ARACHCHIGE KITHSIRI LAKMAL KODITHUWAKKU | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 61 | KONGENIGE SURANGA SILVA | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 63 | LE VAN HIEN | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 162 | LEUSTEAN GHEORGHE ALIN | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 168 | MANAILA MARIAN | 0 | 1 | 16 | 2 | 650 (13 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | +0 |
| 64 | MATEI IONUT **≠** | 10 | 1 | 13 | 2 | 500 (10 z) | 4,6,0,0,0 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,50 (tot 50) | 11 | 0,0,0,0,100 (tot 100) | -50 |
| 66 | MIGHIU STEFAN | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 67 | MITITELU IULIAN | 9 | 1 | 13 | 1 | 500 (10 z) | 0,0,1,1,0 | 0,0,0,0,0 (tot 0) | 13 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,50 (tot 50) | +0 |
| 69 | MITITELU PAUL MARIAN **≠** | 10 | 0 | 16 | 4 | 550 (11 z) | 0,0,0,2,2 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,200 (tot 200) | 12 | 0,0,0,0,200 (tot 200) | -200 |
| 70 | MITITELU PETRONEL | 0 | 1 | 24 | 3 | 1050 (21 z) | 1,2,1,2,0 | 0,0,0,0,100 (tot 100) | 22 | 0,0,0,0,100 (tot 100) | 21 | 0,0,0,0,150 (tot 150) | +0 |
| 71 | MITRACHE ALEXANDRU | 0 | 0 | 14 | 0 | 400 (8 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | +0 |
| 73 | NECULCEA IONUT DANIEL | 10 | 1 | 12 | 1 | 600 (12 z) | 4,5,3,0,0 | 0,0,0,0,0 (tot 0) | 12 | 0,0,0,0,0 (tot 0) | 11 | 0,0,50,0,0 (tot 50) | +0 |
| 74 | NEGRU JENICA | 0 | 2 | 23 | 3 | 1000 (20 z) | 2,2,1,2,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 20 | 0,0,0,0,150 (tot 150) | +0 |
| 77 | NGUYEN QUANG TU | 0 | 1 | 27 | 6 | 1100 (22 z) | 1,1,2,1,2 | 0,0,0,0,250 (tot 250) | 22 | 0,0,0,0,250 (tot 250) | 21 | 0,0,0,50,250 (tot 300) | +0 |
| 80 | NGUYEN VAN TAI | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 81 | NICA EUGEN | 4 | 0 | 11 | 1 | 500 (10 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | +0 |
| 84 | NICOLAE VASILE | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 175 | NICULESCU IONUT ROBERTO | 0 | 0 | 7 | 0 | 200 (4 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | +0 |
| 86 | OANCEA IONUT DANIEL | 5 | 0 | 3 | 0 | 150 (3 z) | 3,0,0,0,0 | 0,0,0,0,0 (tot 0) | 17 | 0,0,0,0,0 (tot 0) | 17 | 0,0,0,0,0 (tot 0) | +0 |
| 90 | PANTEA CONSTANTIN | 0 | 0 | 5 | 0 | 250 (5 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | +0 |
| 93 | PETCU NICOLAE | 2 | 2 | 20 | 2 | 850 (17 z) | 4,4,1,1,0 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,100 (tot 100) | +0 |
| 94 | PHAM HUY HOANG | 0 | 1 | 27 | 6 | 1100 (22 z) | 1,1,2,1,2 | 0,0,0,0,250 (tot 250) | 22 | 0,0,0,0,250 (tot 250) | 21 | 0,0,0,50,250 (tot 300) | +0 |
| 95 | PHAM XUAN THUY | 0 | 1 | 27 | 6 | 1100 (22 z) | 1,1,2,1,2 | 0,0,0,0,250 (tot 250) | 22 | 0,0,0,0,250 (tot 250) | 21 | 0,0,0,50,250 (tot 300) | +0 |
| 99 | POPESCU MIHAITA | 0 | 1 | 23 | 3 | 1000 (20 z) | 1,1,0,1,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 21 | 0,0,0,0,100 (tot 100) | +0 |
| 100 | PORUTHOTAGE RUPUN HASANTHA FERNANDO | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 107 | SETUNGA MUDIYANSELAGE SURESH NIROSHAN PREMASIRI | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 136 | SINGH SUBHKARAN | 0 | 1 | 25 | 4 | 1000 (20 z) | 1,1,0,1,2 | 0,0,0,0,150 (tot 150) | 22 | 0,0,0,0,150 (tot 150) | 21 | 0,0,0,0,200 (tot 200) | +0 |
| 108 | SIRIWARDHANA RAMITHA SAMPATH | 0 | 1 | 23 | 2 | 1000 (20 z) | 1,2,1,1,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 21 | 0,0,0,0,100 (tot 100) | +0 |
| 112 | STROE IONEL | 0 | 3 | 27 | 8 | 1100 (25 z) | 3,5,5,5,2 | 0,0,0,150,100 (tot 250) | 22 | 0,0,0,150,100 (tot 250) | 19 | 0,0,0,300,100 (tot 400) | +0 |
| 113 | TABIRCA PETRE | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 114 | TANASE ELENA MADALINA | 4 | 0 | 5 | 0 | 250 (5 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | 18 | 0,0,0,0,0 (tot 0) | +0 |
| 115 | TITI JENO | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 116 | TOMA LIVIU | 1 | 2 | 21 | 2 | 900 (18 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | 19 | 0,0,0,0,100 (tot 100) | +0 |
| 117 | TOMA RAZVAN ALIN | 0 | 0 | 24 | 2 | 1050 (21 z) | 0,1,0,1,0 | 0,0,0,0,100 (tot 100) | 22 | 0,0,0,0,100 (tot 100) | 22 | 0,0,0,0,100 (tot 100) | +0 |
| 118 | TRAN VAN HAI | 1 | 2 | 21 | 2 | 900 (18 z) | 3,3,1,1,0 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | 19 | 0,0,0,0,100 (tot 100) | +0 |
| 119 | TRUONG THIEU VAN | 0 | 1 | 27 | 6 | 1100 (22 z) | 1,1,2,1,2 | 0,0,0,0,250 (tot 250) | 22 | 0,0,0,0,250 (tot 250) | 21 | 0,0,0,50,250 (tot 300) | +0 |
| 120 | TRUSU CONSTANTIN DOREL | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 123 | TUDOR GIGEL | 0 | 2 | 22 | 2 | 950 (19 z) | 2,2,1,1,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,100 (tot 100) | +0 |
| 124 | TUDOR STEFAN GABRIEL | 3 | 2 | 19 | 2 | 950 (19 z) | 4,5,4,4,0 | 0,0,0,0,0 (tot 0) | 19 | 0,0,0,0,0 (tot 0) | 17 | 0,0,0,100,0 (tot 100) | +0 |
| 166 | TUDURACHI CORNEL (încetat 2026-09-18) | 1 | 1 | 13 | 1 | 450 (9 z) | 2,2,0,0,0 | 0,0,0,0,0 (tot 0) | 21 | 0,0,0,0,0 (tot 0) | 20 | 0,0,0,0,0 (tot 0) | +0 |
| 129 | VERBAL ION | 0 | 0 | 30 | 8 | 1100 (25 z) | 0,2,2,2,2 | 0,0,0,150,250 (tot 400) | 22 | 0,0,0,150,250 (tot 400) | 22 | 0,0,0,150,250 (tot 400) | +0 |
| 130 | VERGA IULIAN | 5 | 4 | 17 | 4 | 700 (14 z) | 4,7,2,0,0 | 0,0,0,0,0 (tot 0) | 17 | 0,0,0,0,0 (tot 0) | 13 | 0,0,0,50,150 (tot 200) | +0 |
| 177 | VICIU MARIUS ALEXANDRU | 0 | 0 | 3 | 0 | 0 (0 z) | 0,0,0,0,0 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | 22 | 0,0,0,0,0 (tot 0) | +0 |
| 132 | WEERAPPULLI GAMAGE PRASANNA | 0 | 1 | 23 | 2 | 1000 (20 z) | 1,2,1,1,0 | 0,0,0,0,50 (tot 50) | 22 | 0,0,0,0,50 (tot 50) | 21 | 0,0,0,0,100 (tot 100) | +0 |
| 133 | WITHARANA THARINDU MADUSHANKA WITHARANA **≠** | 5 | 0 | 20 | 3 | 800 (16 z) | 4,1,0,1,1 | 0,0,0,0,0 (tot 0) | 17 | 0,0,0,0,150 (tot 150) | 17 | 0,0,0,0,150 (tot 150) | -150 |

**Angajați cu diurne: 84 · rânduri unde codul (`savePayment`) ≠ regula R (LL nu scade): 3.**

Diferențe salvat efectiv vs simulare `savePayment` (dovadă că simularea reproduce codul): o singură abatere, MITRACHE ALEXANDRU (71) — tranșa 82 are 3 zile/150 lei în BD vs 4 bifate acum (01–04) și tranșa 83 lipsește deși are 5 zile bifate (07–11); explicația probabilă: bifele au fost puse/modificate DUPĂ salvarea tranșelor (sau angajatul nu era în site-urile utilizatorului la salvare). Pentru restul de 83 de angajați sumele din `diurna_payment_details` (82–85) coincid exact cu simularea.

## 3. Cazurile de referință

### WITHARANA THARINDU (133) — CO 07–11.09, bifate 20 (1–5, 14–19, 21–25, 27–30), 3 în weekend

- 01–04: bifate 4 · export: diurnaMax 0, peste limită 4 · savePayment: 200 lei plătiți, surplus 0 lei · BD (zile, lei): (4, 200) · R (plafon 17): surplus 0 lei
- 05–11: bifate 1 · export: diurnaMax 0, peste limită 1 · savePayment: 50 lei plătiți, surplus 0 lei · BD (zile, lei): (1, 50) · R (plafon 17): surplus 0 lei
- 12–18: bifate 5 · export: diurnaMax 5, peste limită 0 · savePayment: 250 lei plătiți, surplus 0 lei · BD (zile, lei): (5, 250) · R (plafon 17): surplus 0 lei
- 19–25: bifate 6 · export: diurnaMax 5, peste limită 1 · savePayment: 300 lei plătiți, surplus 0 lei · BD (zile, lei): (6, 300) · R (plafon 17): surplus 0 lei
- 26–30: bifate 4 · export: diurnaMax 3, peste limită 1 · savePayment: 200 lei plătiți, surplus 0 lei · BD (zile, lei): — · R (plafon 17): surplus 150 lei

Plafon R = 22 − 5 CO = **17** (identic în ambele variante, n-are LL pe zile lucrătoare). Cod: bugetLunar 1100 = 22 zile → plătește toate cele 20 de zile (1000 lei), **0 la salariu**. Regula R: 17 plătite (850 lei), **3 zile = 150 lei la salariu în tranșa 26–30** (doar 1 zi plătită acolo). Exact ce așteaptă Răzvan. Diferență cod vs regulă: **−150 lei** nemutați la salariu.

### MATEI IONUT (64) — CO 14–18 + 21–25 (10 zile), LL vineri 11.09, bifate 1–10 (incl. sâmbătă 5 + duminică 6) + 28–30 = 13

- 01–04: bifate 4 · export: diurnaMax 0, peste limită 4 · savePayment: 200 lei, surplus 0 · BD (zile, lei): (4, 200) · R(LL nu scade, plafon 12): surplus 0 lei · R(LL scade, plafon 11): surplus 0 lei
- 05–11: bifate 6 · export: diurnaMax 0, peste limită 6 · savePayment: 300 lei, surplus 0 · BD (zile, lei): (6, 300) · R(LL nu scade, plafon 12): surplus 0 lei · R(LL scade, plafon 11): surplus 0 lei
- 12–18: bifate 0 · export: diurnaMax 0, peste limită 0 · savePayment: 0 lei, surplus 0 · BD (zile, lei): — · R(LL nu scade, plafon 12): surplus 0 lei · R(LL scade, plafon 11): surplus 0 lei
- 19–25: bifate 0 · export: diurnaMax 0, peste limită 0 · savePayment: 0 lei, surplus 0 · BD (zile, lei): — · R(LL nu scade, plafon 12): surplus 0 lei · R(LL scade, plafon 11): surplus 0 lei
- 26–30: bifate 3 · export: diurnaMax 3, peste limită 0 · savePayment: 150 lei, surplus 0 · BD (zile, lei): — · R(LL nu scade, plafon 12): surplus 50 lei · R(LL scade, plafon 11): surplus 100 lei

- **Varianta „LL NU scade plafonul"**: plafon 22 − 10 CO = **12**; bifate 13 → **1 zi = 50 lei la salariu în tranșa 26–30**. ✔ Coincide cu așteptarea lui Răzvan.
- Varianta „LL scade plafonul": plafon 22 − 10 CO − 1 LL = 11 → 2 zile = 100 lei la salariu. ✘
- Cod (`savePayment`): plafon 22 → toate cele 13 zile plătite, 0 la salariu. `exportDiurne` (cu LL scăzut, normeCumulate 11) afișează „peste limită" 4 și 6 în T1/T2 — cifre fără sens operațional, pentru că CO-ul de la mijlocul lunii e scăzut anticipat.

**Răspuns la întrebarea LL**: varianta care dă 50 lei la Matei este **LL NU scade plafonul** (LL = zi liberă compensatorie pentru weekend lucrat, nu concediu). Cu această variantă se verifică și Tharindu (150 lei), iar la ceilalți 81 de angajați codul și regula dau același surplus.

### Al treilea caz afectat: MITITELU PAUL MARIAN (69)
CO 01–04 + 07–11 + 17.09 (10 zile lucr.), bifate 16 (14–16, 18–30, inclusiv 4 zile de weekend: 19, 20, 26, 27). Plafon R = 12 → **4 zile = 200 lei la salariu** în tranșa 26–30 (deja plătit 550 lei pe 11 zile în 84+85; în 26–30 mai are 5 bifate din care doar 1 intră în plafon). Codul plătește tot (0 la salariu).

## 4. Diagnoză — liniile care produc diferența

1. **`savePayment` L2963–2967 + L2986** (și export BT L5117–5120, L5142): `bugetLunar = bugetZileSave × diurnaAmt` — zilele lucrătoare ale lunii **fără să scadă concediul/normele angajatului**. Asta e singura formulă care produce sumele salvate/plătite; prin urmare cine are concediu și lucrează weekend primește diurnă pe zile peste plafonul lui personal. **Aceasta e cauza tuturor celor 3 diferențe.** Pentru cei fără norme codul e corect (plafon 22, cronologic, weekendul consumă — vezi Verbal 129, Stroe 112, Pham 94/95 etc., unde surplusul din cod = surplusul regulii).
2. **`exportDiurne` L4851–4853**: `zilePlatiteAnterior` numără doar zilele lucrătoare (`workDaySet.has(r.date)`) → weekendul bifat în tranșele anterioare **nu consumă** plafonul în cascada exportului; combinat cu `periodCapacity` (L4858) face ca „peste limită" să fie calculat per săptămână calendaristică, nu cumulat pe lună.
3. **`exportDiurne` L4845**: `normeRecs` se ia din `allRecs` = **toată luna** (L4820, monthStart→monthEnd), nu până la `dt` → concediul viitor scade plafonul retroactiv (Tharindu T1: diurnaMax 0, „peste" 4 la 01–04, deși CO-ul e în 07–11).
4. **`NORME` include `LL`** (L162) și `exportDiurne` îl scade din plafon (L4845). Regula lui Răzvan (verificată pe Matei) cere ca LL să NU scadă plafonul. `savePayment` nu scade nimic, deci nu e afectat de LL.
5. **`monthStart` diferit**: `savePayment` L2957 din `df`, `exportDiurne` L4776 din `dt`. În septembrie 2026 nu produce diferențe (tranșa 82 începe pe 01.09), dar o tranșă „29.08–04.09" ar fi bugetată de `savePayment` pe august (prevPay pe august, buget august = 20 zile) și de `exportDiurne` pe septembrie.
6. Angajați cu încetare în lună (17, 57, 166): `savePayment`/BT filtrează `active=true` → după încetare nu mai apar în tranșe (corect), dar plafonul rămâne cel al lunii întregi; regula R ar trebui probabil aplicată pe zilele lucrătoare până la încetare (nu produce diferențe în septembrie: niciunul nu depășește).

## 5. Rezumat

- 84 angajați cu diurne; **3 afectați** de diferența cod ≠ regulă, toți cu concediu ȘI weekend lucrat: Matei Ionuț (−50 lei), Witharana Tharindu (−150 lei), Mititelu Paul Marian (−200 lei) — sume care conform regulii ar trebui să meargă la salariu în tranșa 26–30.09, iar codul le va plăti ca diurnă la salvarea tranșei 26–30.
- Se confirmă așteptarea: diferența apare DOAR la cei cu concediu/norme pe zile lucrătoare **și** cu zile bifate peste plafonul personal (de regulă weekend). Cei cu concediu dar cu bifate ≤ plafon (Dima Gheorghiță, Dumitrache, Belecciu C., Mititelu Iulian, Neculcea etc.) nu diferă.
- Fix-ul de cod (NU aplicat, conform mandatului read-only): în `savePayment` și export BT, `bugetLunar` per angajat = (zile lucr. lună − norme pe zile lucr. fără LL) × diurnaAmt; în `exportDiurne`, `zilePlatiteAnterior` să numere TOATE zilele bifate înainte de `df` și `normeCumulate` să excludă LL — de discutat cu Răzvan înainte de implementare (atinge banii).

## Anexă — scriptul de verificare (`verif_diurne.py`)

```python

"""Verificare diurne SEPTEMBRIE 2026 — reproduce formula din origin/main:src/App.jsx
(exportDiurne ~L4753, savePayment ~L2914, export BT ~L5095) și o compară cu regula lui Răzvan.
Rulare: python3 verif_diurne.py [--md]   (datele: data_sept.py, extrase read-only din Supabase)"""
import sys, datetime as dt
from data_sept import EMP, PAY_RAW, PAYMENTS, LEGAL_SEPT, DIURNA

NORME = ['BO','BP','AM','CO','CFP','CM','M','O','N','PRM','PRB','LL']
Y, M = 2026, 9
MONTH_START, MONTH_END = dt.date(Y,M,1), dt.date(Y,M,30)
LEGAL = set(dt.date.fromisoformat(x) for x in LEGAL_SEPT)
def is_wd(d): return d.weekday() < 5 and d not in LEGAL
WORKDAYS = [d for d in (MONTH_START + dt.timedelta(i) for i in range(30)) if is_wd(d)]
WD = set(WORKDAYS)
TOTAL_WD = len(WORKDAYS)            # 22
TRANSE = [(82,dt.date(Y,M,1),dt.date(Y,M,4)),(83,dt.date(Y,M,5),dt.date(Y,M,11)),
          (84,dt.date(Y,M,12),dt.date(Y,M,18)),(85,dt.date(Y,M,19),dt.date(Y,M,25)),
          (None,dt.date(Y,M,26),dt.date(Y,M,30))]
BUGET = TOTAL_WD * DIURNA

# plăți salvate efectiv
SAVED = {}   # eid -> {pid: (days, amount)}
for chunk in PAY_RAW.split(';'):
    eid, rest = chunk.split('=')
    SAVED[int(eid)] = {int(p): (int(d), int(a)) for p, d, a in (x.split(':') for x in rest.split(','))}

def parse(e):
    eid, name, active, term, bif, nor = e
    bifate = sorted(dt.date(Y,M,int(x)) for x in bif.split(',') if x)
    norme = {dt.date(Y,M,int(k)): v for k, v in (x.split(':') for x in nor.split(',') if x)}
    return dict(id=eid, name=name, active=active, term=term, bifate=bifate, norme=norme)

def cod_export(emp, df, dt_):
    """exportDiurne (App.jsx L4753+): exact formula, per tranșă"""
    calWorkDays = sum(1 for d in WORKDAYS if d <= dt_)
    workDaysInPeriod = sum(1 for d in WORKDAYS if df <= d <= dt_)
    er = [d for d in emp['bifate'] if df <= d <= dt_]
    normeRecs = [d for d, n in emp['norme'].items() if n in NORME and d in WD]     # toată luna, doar zile lucr.
    normeCumulate = len(normeRecs)
    zilePlatiteAnterior = sum(1 for d in emp['bifate'] if d < df and d in WD)     # doar zile lucr.
    monthlyRemaining = max(0, calWorkDays - normeCumulate - zilePlatiteAnterior)
    normeInPeriod = sum(1 for d in normeRecs if df <= d <= dt_)
    periodCapacity = max(0, workDaysInPeriod - normeInPeriod)
    diurnaMax = min(monthlyRemaining, periodCapacity)
    diurnaReala = len(er)
    pesteLimita = max(0, diurnaReala - diurnaMax)
    totalDiurneBefore = sum(1 for d in emp['bifate'] if d < df)                    # TOATE zilele (și weekend)
    platitAnteriorSuma = min(BUGET, totalDiurneBefore * DIURNA)
    restBuget = max(0, BUGET - platitAnteriorSuma)
    sumaAcestExport = diurnaReala * DIURNA
    pesteBuget = max(0, sumaAcestExport - restBuget)
    return dict(zile=diurnaReala, calWorkDays=calWorkDays, normeCumulate=normeCumulate,
                zilePlatiteAnterior=zilePlatiteAnterior, periodCapacity=periodCapacity,
                diurnaMax=diurnaMax, pesteLimita=pesteLimita, pesteBuget=pesteBuget, restBuget=restBuget)

def cod_save(emp):
    """savePayment (L2914+) / export BT (L5095+): bugetLunar=22×50 FĂRĂ concediu; platitAnt din diurna_payment_details.
    Simulat secvențial (fiecare tranșă folosește sumele salvate de tranșele anterioare)."""
    out, platit = [], 0
    for pid, df, dt_ in TRANSE:
        days = sum(1 for d in emp['bifate'] if df <= d <= dt_)
        if days == 0 or (emp['term'] and dt.date.fromisoformat(emp['term']) < df):
            out.append(dict(zile=days, suma=0, surplus=0)); continue
        rest = max(0, BUGET - platit)
        suma = min(days * DIURNA, rest)
        out.append(dict(zile=days, suma=suma, surplus=days * DIURNA - suma))
        platit += suma
    return out

def razvan(emp, ll_scade):
    """Regula lui Răzvan: plafon = zile lucr. lună − norme pe zile lucr. (LL opțional);
    TOATE zilele bifate consumă plafonul cronologic; ce depășește → salariu, în tranșa unde se depășește."""
    codes = NORME if ll_scade else [n for n in NORME if n != 'LL']
    norme_wd = sum(1 for d, n in emp['norme'].items() if n in codes and d in WD)
    plafon = TOTAL_WD - norme_wd
    out, consumat = [], 0
    for pid, df, dt_ in TRANSE:
        days = sum(1 for d in emp['bifate'] if df <= d <= dt_)
        platibile = max(0, min(days, plafon - consumat))
        out.append(dict(zile=days, platite=platibile, surplus=days - platibile))
        consumat += days
    return plafon, norme_wd, out

def main(md=False):
    rows = []
    for e in EMP:
        emp = parse(e)
        ex = [cod_export(emp, df, dt_) for _, df, dt_ in TRANSE]
        sv = cod_save(emp)
        saved = SAVED.get(emp['id'], {})
        saved_sum = sum(a for _, a in saved.values())
        saved_days = sum(d for d, _ in saved.values())
        plA, nA, rA = razvan(emp, True)    # LL scade plafonul
        plB, nB, rB = razvan(emp, False)   # LL NU scade plafonul
        we = sum(1 for d in emp['bifate'] if d not in WD)
        rows.append(dict(emp=emp, ex=ex, sv=sv, saved=saved, saved_sum=saved_sum, saved_days=saved_days,
                         plA=plA, nA=nA, rA=rA, plB=plB, nB=nB, rB=rB, we=we,
                         norme_wd_noLL=nB, ll_wd=nA - nB))
    return rows

def fmt_table(rows):
    hdr = ("| id | Nume | Norme zile lucr. (fără LL) | LL zile lucr. | Bifate | din care WE | Plătit efectiv (82–85) lei | "
           "Cod: peste limită export (T1..T5) | Cod savePayment surplus lei (T1..T5) | Plafon R (LL nu scade) | Surplus R lei (T1..T5) | "
           "Plafon R (LL scade) | Surplus R lei (T1..T5) | Δ cod vs R(B) |")
    sep = "|" + "---|" * 14
    lines = [hdr, sep]
    afectati = 0
    for r in rows:
        emp = r['emp']
        cod_pl = ",".join(str(x['pesteLimita']) for x in r['ex'])
        cod_sv = ",".join(str(x['surplus']) for x in r['sv'])
        rB = ",".join(str(x['surplus'] * DIURNA) for x in r['rB'])
        rA = ",".join(str(x['surplus'] * DIURNA) for x in r['rA'])
        tot_cod_sv = sum(x['surplus'] for x in r['sv'])
        tot_rB = sum(x['surplus'] for x in r['rB']) * DIURNA
        tot_rA = sum(x['surplus'] for x in r['rA']) * DIURNA
        delta = tot_cod_sv - tot_rB
        mark = " **≠**" if delta != 0 else ""
        if delta != 0: afectati += 1
        term = f" (încetat {emp['term']})" if emp['term'] else ""
        lines.append(f"| {emp['id']} | {emp['name']}{term}{mark} | {r['nB']} | {r['ll_wd']} | {len(emp['bifate'])} | {r['we']} | {r['saved_sum']} ({r['saved_days']} z) | "
                     f"{cod_pl} | {cod_sv} (tot {tot_cod_sv}) | {r['plB']} | {rB} (tot {tot_rB}) | {r['plA']} | {rA} (tot {tot_rA}) | {delta:+d} |")
    return "\n".join(lines), afectati

if __name__ == '__main__':
    rows = main()
    tbl, afectati = fmt_table(rows)
    print(f"Zile lucrătoare sept 2026: {TOTAL_WD} (sărbători legale: {sorted(LEGAL) or 'niciuna'})")
    print(tbl)
    print(f"\nAngajați cu diurne: {len(rows)} · cod ≠ regula R (LL nu scade): {afectati}")
    # verificare salvat efectiv vs simulare savePayment
    print("\nSalvat efectiv ≠ simulare savePayment:")
    for r in rows:
        for (pid, _, _), s in zip(TRANSE, r['sv']):
            if pid is None: continue
            sd = r['saved'].get(pid)
            if sd is None and s['zile'] > 0 and r['emp']['active']:
                print(f"  {r['emp']['id']} {r['emp']['name']}: tranșa {pid} lipsește din BD (sim {s['zile']} z / {s['suma']} lei)")
            elif sd and (sd[0] != s['zile'] or sd[1] != s['suma']):
                print(f"  {r['emp']['id']} {r['emp']['name']}: tranșa {pid} BD {sd[0]} z/{sd[1]} lei vs sim {s['zile']} z/{s['suma']} lei")
    for tid in (133, 64):
        r = next(x for x in rows if x['emp']['id'] == tid)
        print(f"\n== {r['emp']['name']} ==")
        for i, (pid, df, dt_) in enumerate(TRANSE):
            print(f"  {df.day:02d}–{dt_.day:02d}: bifate {r['ex'][i]['zile']} | export diurnaMax {r['ex'][i]['diurnaMax']} peste {r['ex'][i]['pesteLimita']} (calWD {r['ex'][i]['calWorkDays']}, normeCum {r['ex'][i]['normeCumulate']}, platAnt {r['ex'][i]['zilePlatiteAnterior']}, cap {r['ex'][i]['periodCapacity']}) | save {r['sv'][i]['suma']} lei surplus {r['sv'][i]['surplus']} | BD {r['saved'].get(pid)} | R(LL nu scade, plafon {r['plB']}) surplus {r['rB'][i]['surplus']*DIURNA} | R(LL scade, plafon {r['plA']}) surplus {r['rA'][i]['surplus']*DIURNA}")
```

Datele (`data_sept.py`: EMP = id, nume, active, termination_date, zile bifate, norme; PAY_RAW = diurna_payment_details 82–85) sunt extrase read-only pe 30.09.2026 din `pontaj_records`, `diurna_payments`, `diurna_payment_details`, `calendar_days`, `settings`.
