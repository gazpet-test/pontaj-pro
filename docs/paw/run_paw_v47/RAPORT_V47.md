# Paw v4.7 cxw — raport pentru review

Branch: `codex/paw-v47-cxw`; destinație PR DRAFT: `main`, fără merge.
Nicio instalare/login/schimbare ACL sau WFP efectuată de agent. Nicio schimbare în
src, migrări, alte module sau v461/mai vechi. Fișierele de test sunt sintetice.

## Fișiere și comportament

- `run_paw_v47/`: copie completă v461. Cele 9 fișiere runtime moștenite care nu
  sunt lansatorul/wrapperul/installerul sunt identice octet cu octet.
- `run_paw.ps1:53`, `:686`, `:733`: două moduri noi, validări argumente/căi,
  timeout configurabil 60–86400 secunde (implicit 2400), Job Object existent,
  interpretare protocol și jurnal. `run_paw.cmd`: sintaxa celor două moduri.
- `codexweb_pw.py:228`: `cxw` deschide un tab nou la `/codex`, alege EXACT
  `pontaj-pro` prin Choose environment. `cxw-continua` folosește URL-ul existent
  strict validat și verifică același mediu, fără a inventa răspunsuri.
- `codexweb_pw.py:39`, `:59`, `:117`, `:134`, `:205`, `:215`: allow-list URL și
  mediu, brief numai sub `paw-data\brief`, `.txt`/`.md`, fără UNC/ADS/reparse,
  fără draft existent/atașamente, text identic după normalizarea comună Gemini,
  OFF explicit înainte de fill și din nou înainte de Send. Lipsă/ON/ambiguu refuzate.
  Outputul folosește `CaleSigura`, numai sub `paw-data\out`.
- `codexweb_pw.py:74`, `:92`, `:178`, `:302`: CDP loopback, control de driver orfan
  sub lock, lock kernel scurt, deconectarea driverului de trimitere înainte de
  unlock. Conexiune nouă de citire pentru watch. Taburile cop/gem nu se ating.
- `codexweb_pw.py:276`: URL propriu și turn verificat, text nou nevid + semnal
  explicit completed după observarea execuției, fără busy. Textul stabil singur
  nu este succes. Întrebări/dialoguri/confirmări → `asteapta_confirmare`, fără click
  de confirmare, approve/publicare/Create PR și fără răspuns automat.
- Log: JSON cu hash/lungime brief, URL, text final filtrat și linkuri PR din
  răspunsul nou. Ultima linie fizică este numai a lansatorului: `PAW_GATA <id>
  stare=gata|asteapta_confirmare` sau `PAW_EROARE <id> ...`. `paw_runs.log` primește
  starea, exit și timp Europe/Bucharest; argumentele cxw respinse nu se copiază
  în jurnal. Nu se persistă erori brute Playwright/stderr, nici brief integral.
- `install.ps1:15`: pachet verificat/copiat de 13 runtime-uri, inclusiv helperul
  nou; `:78` îl include în inventarul de mentenanță. `SHA256.json` recalculat.
- `RUNBOOK_RAZVAN.md`: instalare/rollback și acceptanță Windows/Edge;
  `../LANSATOR_UNIC_PAW.md`: secțiune v4.7; `teste/`: teste și fixture-uri comune.

Timeout-ul oprește întreg arborele **local**, prin Job Object-ul existent.
Edge extern și sarcina cloud nu sunt anulate. Trimiterea ambiguă nu se reia;
operatorul inspectează URL-ul/tabul înainte de orice mesaj nou. Într-un timeout
chiar în click/navigarea URL, identificatorul poate rămâne necunoscut: verificare
manuală în Edge, fără presupunerea „nu s-a trimis”. Lock ocupat este refuz local,
fără Send/retry automat. Nu se șterg fișiere de lock după cale.

Hash SHA256 al manifestului revizuit (`SHA256.json`):
`FCC3FBDDA06AD201AFB545714ABA52F5E2E95719754A832DAB85C2825E1DECFB`.

## Verificări efectuate și limite

`python -B docs/paw/run_paw_v47/teste/test_codexweb_pw.py`:
**24 teste: 23 trecute, 1 omis** (lock real Windows, două procese + crash).
Acoperă medii/URL-uri adversariale, căi legitime/traversal/UNC/ADS/reparse simulat,
limite brief, loopback, aprobări ON/necunoscute, schimbare OFF→ON după fill fără Send,
ciorne diferite/atașamente, completed vechi, timeout, întrebări, navigare și turn
concurent, extragere PR, redactare și împiedicarea falsificării markerilor, manifest
și paritatea runtime-ului moștenit.

Regresie Gemini, selecția `TestTab`, `TestModel`, `TestAsteptare`, `TestCiorna`,
`TestMain`, `TestSursa` din `run_paw_v46/teste/test_gemini_pw.py`: **22/22 trecute**.
Rularea completă a aceleiași suite: **32 teste, 25 trecute, 5 eșecuri + 2 erori**.
Toate cele 7 sunt cazuri TestBrief dependente de Windows: helperul vechi adaugă
`\\` la rădăcini POSIX și refuză fixture-ul `/tmp/...` ca fiind în afara rădăcinii,
înainte de verificarea așteptată a textului. Codul vechi rămâne identic; nu declarăm
acele cazuri trecute și nu modificăm v46 ca să adaptăm harness-ul la Linux.

`teste/test_contract.ps1` este pregătit pentru Windows: parsează AST-ul real al
lansatorului, extrage `CaleSigura` fără a executa lansatorul, folosește aceleași
fixture-uri URL/căi ca Python și verifică respingerea unei junction reale.
**Nerulat aici**: nu există PowerShell/Windows. Nici Job Object, CIM, lock-ul kernel
Windows, installerul, WFP sau Edge autentificat nu sunt certificate prin testele
Linux. Nu s-au efectuat apeluri Codex cloud plătite pentru probe.

**Înainte de utilizare**, Răzvan verifică în UI-ul real contractul de selectori
(documentat explicit în runbook), inclusiv controlul OFF și starea task running /
completed. Aceste atribute nu au fost observate pe server; pachetul poate refuza
sau expira până la ajustarea lor în repo și un nou review. Nu este declarat canal
validat end-to-end. Probe obligatorii: chat nou + continuare, ON fără Send,
confirmare fără click, două sarcini și cop/gem în paralel, timeout/arbore local,
PR link, hash-uri/ACL și Run/Seal cdx după instalarea v47 de către admin.

## L01–L25

Referințele sunt în acest director dacă nu se indică altfel. Regulile SQL sunt
marcate n/a când nu există modificări de BD sau date, nu reinterpretate drept
permisiune de a crea RPC-uri/migrări.

| Regulă | Respectare / dovadă |
|---|---|
| L01 | `codexweb_pw.py:311`: lock înainte de conectare/inspectare/editare/trimitere; `:92` verifică driverii orfani sub lock; test Windows `Brief.test_real_two_process_lock_and_crash_release` pregătit, omis pe Linux. |
| L02 | n/a — fără operații BD legate, RPC, storage/mail. |
| L03 | `watch:276`: rezultat numai pentru URL-ul propriu, mesaj nou și număr de turnuri; `Watch.test_navigation_refused_before_read`, `test_concurrent_turn_refused`, `test_stale_completed_never_success_and_timeout`. |
| L04 | n/a — fără cantități/bani/mail, chei de claim sau retry automat. |
| L05 | `codexweb_pw.py:265`, `:298`, `run_paw.ps1:855`: un singur Send, timeout/eroare = stare necunoscută, fără retry/fallback/anulare cloud; runbook secțiunea 3 cere reconciliere manuală. |
| L06 | n/a pentru lock-uri SQL; ordinea locală install barrier → lock cxw este documentată la `codexweb_pw.py:230`; fără lock pe alte taburi în watch. |
| L07 | n/a — nicio politică/tabel/API de date modificat. |
| L08 | n/a — nu se introduce identitate BD, proveniență sau SECURITY DEFINER. |
| L09 | n/a — fără service_role/DEFINER/ID-uri de proiect BD; mediul UI este totuși pe allow-list exactă, `arguments` și `submit`. |
| L10 | `safe_text:163`, `emit:172`, `main:329`; stderr suprimat în lansator, hash/lungime în loc de brief integral. `Pure.test_redaction_and_framing`, `test_generic_error_does_not_echo_brief`; fixture-uri fără secrete/date personale. |
| L11 | n/a — nu se extrag valori dovedite din documente/tabele. |
| L12 | `outcome:150`, `watch:276`: lipsa textului/stării și starea veche nu produc succes; timeout vizibil, fără a ascunde necunoscutul. `Pure.test_completion_and_confirmation`, testele Watch. |
| L13 | `CHAT.fullmatch`, `arguments`, `path_lexical`: parsere ancorate și refuz explicit; `Pure.test_args_rejected`, `test_url_closed`, `test_paths_escape`, `test_loopback`, plus fixture-uri comune PowerShell. |
| L14 | n/a — fără migrări. |
| L15 | n/a — fără amprente/porți de schemă SQL. |
| L16 | n/a — fără chei BD/deduplicare documente; hash-ul brief-ului este doar audit, nu identitate/idempotență. |
| L17 | `watch:277` și `Ruleaza` moștenit folosesc ceas monoton pentru deadline; `Jurnal:76` convertește timestamp-ul cxw prin GTB Standard Time (Europe/Bucharest, cu DST), fără offset fix. Fără parsare nouă de valori business. |
| L18 | `approval_off:144`, `unique:198`, `outcome:150`, protocol lansator: stări necunoscute/duplicate/erori refuzate, niciodată presupuse OFF/gata. Testele aprobărilor și completed vechi. |
| L19 | Normalizarea/draftul reutilizează `gemini_pw.normalizeaza/verifica_ciorna`; fixture-urile `contract_cases.json` comune Python/PowerShell acoperă dublarea inevitabilă URL/căi. Python trecut; paritatea PowerShell trebuie rulată pe Windows. |
| L20 | Teste pozitive și negative în Pure/SubmitGuards/Watch/Brief; OFF→ON fără Send; refuz local lock distinct de eroarea externă. Oprirea arborelui local nu depinde de o cotă/buget nou. |
| L21 | n/a pentru contracte de API AI și scrieri/cache BD; canal UI fără UPDATE/DELETE. Finalizarea este totuși explicită, nevidă și fără stare failed/cancelled/error, testată în Pure/Watch. |
| L22 | n/a — fără API de facturare, rezervări usage sau fallback plătit nou; nu există retry automat al unei trimiteri cloud ambigue. |
| L23 | n/a — fără paginare React/PostgREST. |
| L24 | `watch:279`: identitate URL și contor turnuri, ieșire la tab pierdut/concurență; fără navigare/reload/focus/close în watch; teste Watch. Nicio componentă React modificată. |
| L25 | Expected-uri explicite, fixture-uri adversariale independente, simulări fără browser și comparație cu bytes v461/manifest; testele reale Windows marcate nerulate/omise, fără pretenție de certificare OS/UI. |
