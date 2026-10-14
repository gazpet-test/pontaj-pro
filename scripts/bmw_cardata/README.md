# BMW CarData → ERP (X5 xDrive45e): kilometraj zilnic, append-only

Tichetul „integrare BMW CarData” (Răzvan, 14.10.2026). Scriptul citește prin API-ul oficial BMW CarData (REST) kilometrajul
și, dacă mașina le trimite, combustibilul, autonomiile, SoC-ul bateriei și contoarele OBFCM, apoi le **adaugă** în Supabase
(`public.bmw_cardata_citiri`). Poziția (lat/lon/heading) se ia și ea — decizia lui Răzvan: mașina e a lui și o conduce el —
dar stă **separat** (`public.bmw_cardata_locatii`) și o vede **doar owner-ul**.

**Stare la livrarea PR-ului:** nimic rulat pe API-ul real (niciun login, nicio cerere BMW), nimic scris în BD, migrarea
`20261030c_bmw_cardata.sql` **neaplicată**. Tot ce e mai jos s-a testat simulat (vezi „Teste”).

Doar Python stdlib (testat pe 3.13). Nicio librărie nouă.

## Fișiere locale (în afara repo-ului, nesincronizate)

Toate stau în `C:\Users\Gazpet-Ai\.secrete` (sau `--dir` / variabila `BMW_CARDATA_DIR`):

| Fișier | Ce e | Cine îl scrie |
|---|---|---|
| `bmw_cardata_client_id.txt` | client ID-ul din portalul CarData | Răzvan (există deja) |
| `bmw_cardata_tokens.json` | access + refresh token (fără id_token) | `login` / `refresh`, **scriere atomică** (temp + fsync + replace) |
| `bmw_cardata_setup.json` | VIN-ul PRIMARY, containerId, cheile, basicData (o dată) | `setup`, prima `citeste` |
| `bmw_cardata_cereri.json` | contorul local de cereri pe zi UTC + blocajul după CU-429 | fiecare cerere CarData |
| `bmw_cardata_citiri\*.json` | citiri încă nescrise în BD; după scriere → `scrise\` | `citeste` / `scrie` |
| `bmw_cardata_jurnal.log` | un rând per rulare: ora UTC, comanda, codul, mesajul (fără valori, fără tokenuri) | toate comenzile, mai puțin `stare` |
| `bmw_cardata.lock` | o singură rulare odată (refresh-ul rotește tokenul) | temporar |

Tokenurile și client ID-ul **nu se afișează niciodată**, nici în erori (mesajele trec printr-o mască pentru șiruri lungi de tip token).

## Pașii pentru Răzvan

Precondiție: migrarea `supabase/migrations/20261030c_bmw_cardata.sql` aplicată prin `scripts/livrare_migrare.sh`, după acordul tău
(versiune propusă `20261030140000`; ultima din istoric e `20261030130000`). Fără ea, `scrie` cade (tabelul nu există) și citirile
rămân în `bmw_cardata_citiri\` până la aplicare — nu se pierde nimic.

Din rădăcina unei clone pe `main` (după merge), în PowerShell:

```powershell
cd C:\Users\Gazpet-Ai\gazpet-erp\scripts      # orice clonă pe main; comenzile rulează din folderul scripts
python -B -m bmw_cardata login
```
1. `login` afișează **doar** două rânduri: `verification_uri: https://…` și `user_code: XXXXXXXX`. Deschizi linkul (sau butonul
   „Autentificarea aparatului” din pagina CarData a mașinii, care duce în același loc), te loghezi cu contul My BMW și introduci
   codul. Scriptul așteaptă singur (respectă `interval`, `slow_down`, `expires_in`) și se termină cu `login OK`.
   Codul expiră după câteva minute: dacă scrie „a expirat”, rulezi `login` din nou.
2. `python -B -m bmw_cardata setup` — găsește VIN-ul mapat **PRIMARY** (dacă sunt mai multe: `--vin <VIN>`), creează containerul
   `GAZPET_ERP_ZILNIC` cu cele 12 chei de mai jos (sau îl refolosește, dacă există deja cu aceleași chei) și ține minte
   containerId-ul local. 2–4 cereri, o singură dată.
3. `python -B -m bmw_cardata citeste` — prima citire (basicData o singură dată + telematicData). Afișează valorile primite,
   „locatie: da/nu” și cheile respinse cu motivul. **Aici aflăm ce trimite efectiv X5-ul** (vezi „Nesiguranțe”).
4. `python -B -m bmw_cardata scrie` — scrie citirile locale în BD (o tranzacție per citire). Reluarea e sigură: aceeași citire nu
   se dublează (`id_citire` unic, `ON CONFLICT DO NOTHING`).
5. `python -B -m bmw_cardata stare` — doar local, fără rețea: tokenuri valabile încă X min / Y zile, setup, cereri azi, citiri nescrise.

Coduri de ieșire: `0` OK · `1` eroare · `2` trebuie `login` din nou · `3` limita de cereri atinsă (nu se reîncearcă).

### Programarea zilnică (Task Scheduler, python direct — fără .ps1/.cmd)

O rulare pe zi ajunge: `citeste --scrie` = 1 cerere CarData (+ un refresh OAuth, care nu intră în limita de 50). Refresh-ul
zilnic ține refresh token-ul în viață (BMW îl rotește la fiecare refresh; valabil 14 zile). Dacă PC-ul stă oprit **peste 14 zile**,
rularea iese cu codul 2 și trebuie `login` manual.

Variantă comandă unică, tastată o dată în PowerShell (nu se salvează niciun fișier .ps1):
```powershell
$a = New-ScheduledTaskAction -Execute 'C:\Program Files\Python313\python.exe' -Argument '-B -m bmw_cardata citeste --scrie' -WorkingDirectory 'C:\Users\Gazpet-Ai\gazpet-erp\scripts'
$t = New-ScheduledTaskTrigger -Daily -At 06:10
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskPath '\Gazpet\' -TaskName 'BMW CarData zilnic' -Action $a -Trigger $t -Settings $s -Description 'BMW CarData -> bmw_cardata_citiri (append-only). scripts/bmw_cardata/README.md'
```
Varianta din interfață (Task Scheduler → Create Task): Action = *Start a program*, Program `C:\Program Files\Python313\python.exe`,
Arguments `-B -m bmw_cardata citeste --scrie`, **Start in** `C:\Users\Gazpet-Ai\gazpet-erp\scripts` (obligatoriu: de acolo se
găsește pachetul); Trigger zilnic 06:10; Settings: *Run task as soon as possible after a scheduled start is missed*, fără instanțe
paralele. Contul: Gazpet-Ai (acolo stau `.secrete` și `%APPDATA%\postgresql\pgpass.conf`).
De ce 06:10: odometrul vine cu momentul ultimei transmisii a mașinii (de regulă finalul ultimului drum de ieri).
Rezultatul fiecărei rulări: „Last Run Result” (0/1/2/3) + `bmw_cardata_jurnal.log`.

## Chei (containerul `GAZPET_ERP_ZILNIC`)

| Cheie BMW | Coloană | Interval acceptat | Verificare |
|---|---|---|---|
| `vehicle.vehicle.travelledDistance` | `odometru_km` (+ `odometru_la`) | 0–1.000.000 km, unitate km | catalog (copii publice) ✔; pe VIN ✖ |
| `vehicle.drivetrain.fuelSystem.level` | `combustibil_pct` | 0–100 % | catalog ✔ (marcat PHEV); pe VIN ✖ |
| `vehicle.drivetrain.fuelSystem.remainingFuel` | `combustibil_litri` | 0–150 l (galoanele se resping) | catalog ✔; ±6 l după catalog |
| `vehicle.cabin.infotainment.navigation.remainingRange` | `autonomie_termic_km` | 0–2000 km | catalog ✔; **semantica la PHEV neverificată** |
| `vehicle.drivetrain.electricEngine.kombiRemainingElectricRange` | `autonomie_electric_km` | 0–1000 km | catalog ✔ |
| `vehicle.drivetrain.lastRemainingRange` | `autonomie_totala_km` | 0–3000 km | catalog ✔ (electric + combustibil la PHEV) |
| `vehicle.drivetrain.batteryManagement.header` | `soc_pct` | 0–100 % | catalog ✔ |
| `vehicle.drivetrain.fuelSystem.consumptionOverLifeTime.overall.fuel` | `obfcm_combustibil_l` | 0–50.000 l | catalog ✔; frecvența actualizării ✖ |
| `vehicle.drivetrain.fuelSystem.consumptionOverLifeTime.overall.referenceDistance` | `obfcm_distanta_km` | 0–1.000.000 km | catalog ✔ |
| `vehicle.cabin.infotainment.navigation.currentLocation.latitude` / `.longitude` / `.heading` | `bmw_cardata_locatii` (lat, lon, heading) | ±90 / ±180 / 0–360; (0, 0) respins | catalog ✔ |

Reguli de validare (`valideaza.py`): doar cheile de mai sus (orice altă cheie din răspuns se ignoră); valoarea = număr zecimal
simplu (fără exponent, NaN, infinit), unitatea din lista permisă, timestamp ISO nu în viitor (> +10 min); `INVALID` / gol =
lipsă, nu eroare. O valoare respinsă devine NULL și e listată la `citeste`; **odometrul lipsă sau invalid oprește citirea**.
`raspuns_brut` păstrează doar cheile non-locație (value/unit/timestamp scurtate), iar BD-ul are CHECK că nu conține text de locație.
`scrie` reverifică strict fișierul local (VIN = cel mapat, câmpuri, intervale, structură) înainte de BD.

## Ce știm despre API (cu marcaj)

Surse: ghidul oficial de integrare BMW CarData (v1.6, 30.07.2026, `bmw-cardata.bmwgroup.com/customer/public/api-documentation`,
citit de Jakarinos — `C:\Users\Public\paw-data\out\bmw_cardata_r1_jak.log`) și copia lui v1.5 + Swagger-ele oficiale (REST și
device flow) publicate în `github.com/JjyKsi/bmw-cardata-ha`, citite de Claude. **VERIFICAT** = în ghid/Swagger, nu testat pe cont.

- VERIFICAT: Device Code Flow cu PKCE S256 pe `https://customer.bmwgroup.com`: `POST /gcdm/oauth/device/code`
  (`client_id`, `response_type=device_code`, `scope`, `code_challenge`, `code_challenge_method=S256`) și `POST /gcdm/oauth/token`
  (`grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`, `code_verifier`, `client_id`); refresh cu
  `grant_type=refresh_token`. În polling: `authorization_pending` = HTTP 403, `slow_down` = 400, `expired_token` = 401.
- VERIFICAT: access token și id token 3600 s; refresh token 1.209.600 s (14 zile); refresh-ul emite un set nou.
- Scope cerut de script: `authenticate_user openid cardata:api:read` (doar REST; streamingul nu e folosit).
- VERIFICAT: REST `https://api-cardata.bmwgroup.com`, antete `Authorization: Bearer …` + `x-version: v1`; căile `/customers/vehicles/mappings`,
  `/customers/vehicles/{vin}/basicData`, `/customers/vehicles/{vin}/telematicData?containerId=…`, `/customers/containers` (GET/POST),
  `/customers/containers/{id}` (GET/DELETE). Corpul containerului: `name`, `purpose`, `technicalDescriptors`.
  Răspunsul telematic: `{"telematicData": {"<cheie>": {"value", "unit", "timestamp"}}}` (valorile vin ca text).
- VERIFICAT: 50 de cereri/zi/utilizator (CU-429), reset 00:00 UTC (ghid v1.6, după Jakarinos); max 10 containere; doar
  utilizatorul PRIMARY are acces. CU-429 poate veni și ca HTTP 403 (implementarea zweckj/bmw-cardata) ⇒ scriptul îl recunoaște
  după codul `exveErrorId`, blochează local ziua și **nu reîncearcă**.
- VERIFICAT: REST întoarce ultima valoare transmisă de mașină, nu forțează o măsurătoare — de aceea păstrăm `odometru_la`.

Limita locală implicită: 10 cereri/zi UTC (`--limita-zi`, maxim 49).

## Fișa de automatizare (pentru `registru_automatizari` + tabelul `automatizari`)

- **Nume:** BMW CarData zilnic (`python -B -m bmw_cardata citeste --scrie`, Task Scheduler `\Gazpet\BMW CarData zilnic`).
- **(a) Conținut extern citit:** răspunsurile JSON ale API-ului BMW CarData (telematicData, basicData, mappings, containers) și ale
  serverului OAuth BMW. Tratate ca date: allowlist de 12 chei, numere în intervale, nimic executat, nimic interpolat în SQL
  (document JSON într-un literal dollar-quoted cu tag aleator, conversii explicite în BD).
- **(b) Ce scrie / face:** doar `INSERT` în `public.bmw_cardata_citiri` și `public.bmw_cardata_locatii` (append-only: triggere refuză
  UPDATE/DELETE/TRUNCATE, și pentru postgres); fișierele locale de mai sus. La BMW: un container creat o dată, la `setup`.
  Nu trimite mail, nu atinge bani, drepturi sau alte tabele.
- **(c) Identitate:** rolul `postgres` prin pooler (`aws-1-eu-central-1.pooler.supabase.com:5432`, parola din
  `%APPDATA%\postgresql\pgpass.conf`) — **sare peste RLS**. Justificare: tabelele nu au intenționat nicio politică de scriere pentru
  anon/authenticated/service_role, iar scriptul local nu are JWT de utilizator. Propunere pentru etapa 2: un rol dedicat cu
  INSERT doar pe cele două tabele, în locul lui postgres.
- **(d) Cine o poate porni:** Task Scheduler pe PC-ul local, sub contul Windows Gazpet-Ai, sau Răzvan manual. Nimic expus în
  rețea (fără endpoint, webhook sau edge function). Tokenul BMW se obține doar cu confirmarea lui Răzvan în contul My BMW.
- **(e) Confirmare umană:** `login` (device code, în browser), aplicarea migrării (runner + acordul lui Răzvan), `setup --recreeaza`.
  Citirea + scrierea zilnică rulează fără confirmare: (a) și (b) se ating (citește conținut extern și scrie), iar poarta este
  combinația: pornire doar local (contul Windows + pgpass), scriere doar de numere validate într-un tabel append-only, nicio
  altă acțiune. **Decizia dacă această poartă ajunge îi aparține lui Răzvan** (CLAUDE.md pct. 7).
- **Secrete (doar nume):** `bmw_cardata_client_id.txt`, `bmw_cardata_tokens.json` în `C:\Users\Gazpet-Ai\.secrete`; pgpass-ul existent.

## Teste

```bash
PYTHONPATH=scripts python -B -m unittest bmw_cardata.test_bmw_cardata -v      # 46 teste, fără rețea, fără BD
PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_bmw_cardata.sh            # PG17 local: migrare + RLS + capăt-la-capăt + revenire
```
Unittest (HTTP simulat): device flow cu PKCE (verifier ↔ challenge), `authorization_pending` / `slow_down` (+5 s) / `expired_token` /
termen depășit / `access_denied`; refresh (rotire atomică, refresh expirat local fără cerere, `invalid_grant` → „rulați login din nou”);
429 și CU-429 venit ca 403 (stop + ziua blocată, fără retry), limita locală, antetele REST; setup (PRIMARY, container nou/refolosit);
basicData o singură dată; validări (mile, NaN, exponent, INVALID, interval, viitor, locație (0,0), text de locație în cheie
non-locație), reverificarea fișierului modificat; SQL-ul generat (textul ostil rămâne în literal, tag aleator, tag în document →
refuz); niciun token în ieșire sau jurnal. Harness-ul SQL: vezi antetul `scripts/test_bmw_cardata.sh`.

## Nesiguranțe (de verificat la primul `citeste`)

- Ce chei trimite efectiv X5 xDrive45e: catalogul marchează cheile de combustibil/autonomie pentru PHEV, dar nu e garantat pe VIN.
  Dacă `setup` cade cu `CU-402` (cheie inexistentă), una dintre chei nu există în catalogul curent — se scoate din `valideaza.py`.
- `navigation.remainingRange` = „remaining range of fuel” în catalog; la PHEV poate fi autonomia totală, nu doar cea termică.
- Termenii: portalul spune „free for personal use only”; folosirea pentru auditul unei mașini de firmă e neclară (Jakarinos
  recomandă clarificare scrisă de la BMW înainte de a baza auditul pe aceste date).
- Evo GPS: activul 237 (BMW X5) are VIN valid în `serie_sasiu`, dar **0 zile** în `logistica_telemetrie_zilnica` (verificat read-only
  14.10.2026) ⇒ view-ul de comparație arată deocamdată doar partea BMW.
- Activul 237 a primit, prin migrarea automată `scorilos_aplic_bmw_x5` (24.05.2026), carburant benzină, normă 9,2 l/100 km și
  observația „X5 xDrive40i”, iar tichetul spune xDrive45e (PHEV). `basicData.driveTrain` de la primul `citeste` lămurește;
  corectura activului e o decizie separată (date reale ⇒ preview + acordul lui Răzvan).
