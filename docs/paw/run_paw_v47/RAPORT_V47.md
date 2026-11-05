# Paw v4.7 — runda 3, PR #1001

Branch `codex/paw-v47-cxw`, commit nou peste r2, push fără merge.
Doar fișiere Paw în repo; fără instalare pe server sau modificări în v461/mai vechi,
src, migrări sau alte module.

| Review r2 | Remediu | Dovadă |
|---|---|---|
| P1 Jakarinos: identitate moștenită de la container | `codexweb_pw.py:268`: assistant numai cu `data-message-id`/`id` PROPRIU. Fără fallback la strămoș, turn sau `data-testid`. `TurnProgress:304`: lipsa identității șterge dovada BUSY și stabilitatea, apoi refuză explicit `identitate_raspuns_neconfirmata`. | `DomScope.test_anonymous_replacement_in_same_turn_never_inherits_busy`: A anonim running → B anonim completed + 3 citiri, același container cu testid și message-id; refuz la fiecare citire, niciodată gata. Teste și pentru identitate validă proprie, respectiv pierderea ei după BUSY valid. |
| P2-01 Copilot: dialog care blochează composerul | `submit:365`: verificări înainte de composer, după citirea lui și imediat înainte de Send; handlerul întregii pregătiri recunoaște confirmarea dacă o operație este blocată. `confirmation_before_send:357`: URL, `submitted=false`, exit 0 → PAW_GATA asteapta_confirmare, fără Send/trimis. Click-ul real este în afara handlerului: ambiguitatea după încercarea Send nu se reclasifică drept netrimis. | `SubmitGuards`: composer inaccesibil din start; dialog în lookup editor/fill/verificare draft/lookup Send/înainte de click, în ambele moduri; niciun Send. Test separat: click real ambiguu rămâne eroare necunoscută, fără submitted=false fals. |
| P2 certificare Windows | Runbook 3a păstrat IDENTIC, verificat față de r2; doar contractul identității/confirmării de deasupra a fost clarificat. | Două cxw simultane + cop/gem active, lock real și kill pe arbore rămân poartă OBLIGATORIE la instalare, executată numai de Răzvan. |

Teste r3: `python -B docs/paw/run_paw_v47/teste/test_codexweb_pw.py` —
**46 teste: 45 trecute, 1 omis** (lock kernel Windows). Include snapshot-ul JS real
pe fixture-uri DOM, fără browser. Regresii Gemini portabile: **22/22 trecute**.
Manifestul tuturor celor 13 runtime-uri și cele 9 copii moștenite nemodificate sunt
verificate de suită. `git diff --check` fără erori.

Contractul PowerShell/runnerul nu s-au modificat în r3. Validarea PowerShell 7.5.4
Linux din r2 rămâne consemnată (AST/URL/protocol/deadline PASS); nu este rerulată în
r3. Windows PowerShell 5.1, junction/lock/CIM/Job Object și Edge/UI live NU sunt
certificate aici. Nicio probă cloud plătită/instalare executată de agent. Cele 7
cazuri legacy TestBrief dependente de Windows nu sunt declarate trecute pe Linux.

SHA256 al `SHA256.json`: `4599DF50A38C3C780BDCAB130DE27218C63C5F7E48DBC74AB9F4192B3A5F7242`.

## L01–L25

Referințe în acest director. Reguli fără operații corespunzătoare: n/a.

| Regulă | Respectare / test |
|---|---|
| L01 | `codexweb_pw.py:187`, `:469`: lock înainte de CDP și până după dovada user+disconnect; `SentEvidence`, `MainLifecycle`; lock kernel real omis aici, obligatoriu Windows. |
| L02 | n/a — fără scrieri BD/RPC/storage/mail. |
| L03 | `read_turn:274`, `TurnProgress:304`: user_key/response_key curente, fără identitate de container; răspunsul anonim refuză și șterge BUSY/stabilitatea; teste Watch și DomScope. |
| L04 | n/a — fără cantități/bani/mail sau retry automat. |
| L05 | `wait_submitted:291`, `watch:445`: trimitere/timeout ambigue nu declanșează retry/fallback; URL verificat manual conform runbook. `SentEvidence.test_missing_message_times_out_without_trimis`. |
| L06 | n/a pentru lock-uri SQL; ordinea locală install barrier → cxw este păstrată în `submit:365`, fără lock de watch. |
| L07 | n/a — fără tabele/politici/API de date. |
| L08 | n/a — fără identitate/proveniență BD/DEFINER. |
| L09 | n/a — fără service_role/ID-uri BD; mediul UI rămâne pe allow-list exactă. |
| L10 | `safe_text:172`, `emit_result:348`: aceeași protecție pentru text și href-uri, fără brief integral/erori brute. Test negativ brief=URL PR și testele de redactare r1. |
| L11 | n/a — fără extragere de valori dovedite din documente/tabele. |
| L12 | `TurnProgress:304`: partial/gol/status vechi/instabil nu sunt succes; `Watch` și `DomScope` verifică regresia BUSY → partial + completed vechi. |
| L13 | `arguments:46`, `read_turn:274`, `CxwProtocolState` în `run_paw.ps1:84`: validare explicită și stări pe listă închisă; teste pozitive/negative Python și PowerShell. |
| L14 | n/a — fără migrări. |
| L15 | n/a — fără porți de schemă. |
| L16 | n/a — fără chei BD/deduplicare documente. |
| L17 | `remaining:88`, `run_paw.ps1:55`, `:79`, `:293`: deadline monoton comun, fără reset; `Deadline` + contract PowerShell. Jurnal Europe/Bucharest rămâne păstrat. |
| L18 | `read_turn`, `TurnProgress`, `CxwProtocolState`: lipsa identității/scope-ului/confirmării nu devine gata; protocol și teste adversariale. |
| L19 | `normalizeaza/verifica_ciorna` comune Gemini; `emit_result` unic pentru toate câmpurile răspunsului; fixture-uri URL comune Python/PowerShell. |
| L20 | `SentEvidence`, `Watch`, `SubmitGuards`, `Deadline`: căi legitime și refuzuri; dialogurile înaintea/din timpul pregătirii nu devin eroare, iar Send ambiguu nu este mascat; oprirea Job rămâne posibilă după deadline. |
| L21 | n/a pentru API AI/scrieri BD; canalul UI cere totuși finalizare proprie stabilă, fără gol/partial ca succes. |
| L22 | n/a — fără API billing/rezervări usage/fallback nou; fără retrimitere cloud automată. |
| L23 | n/a — fără paginare React/PostgREST. |
| L24 | `read_turn:274`, `watch:445`: URL+identitate user+răspuns, contor exact și reset la înlocuire; fără interacțiune în watch; teste de concurență/navigare/înlocuire. |
| L25 | Expected-uri explicite și fixture-uri DOM independente executate cu JS-ul real; teste Python rulate în r3; contract PowerShell nemodificat, validat în r2; probele OS/UI marcate omise/nerulate și obligatorii în runbook. |
