# Paw v4.7 — runda 2, PR #1001

Branch `codex/paw-v47-cxw`, commit nou peste runda 1, push fără merge.
Doar fișiere Paw din repo. Fără instalare pe server; v461 și versiunile vechi,
src, migrările și celelalte module rămân nemodificate.

## Remedii și dovezi

| Review | Implementare | Test |
|---|---|---|
| P1 Copilot: „trimis” fără dovadă | `codexweb_pw.py:289`, `:398`: după Send/URL, ambele moduri cer exact +1 mesaje user, text normalizat identic și identitate stabilă. Abia apoi `trimis`; driverul se oprește înainte de unlock (`:440`). | `SentEvidence`: ambele moduri, URL imediat dar mesaj întârziat, lipsă mesaj, +2 mesaje, text/identitate greșite. `MainLifecycle`: dovadă → disconnect → unlock → watch. |
| P1 Jakarinos / P2-01 Copilot: finalizare veche | `codexweb_pw.py:239`, `:272`, `:302`, `:416`: snapshot atomic; numai assistant DUPĂ user-ul confirmat, status/Stop din containerul propriu, aceeași identitate BUSY → completed și 3 citiri identice. Schimbarea răspunsului resetează dovada. | `DomScope` execută JavaScript-ul real de snapshot pe arbore DOM offline; BUSY → text parțial + completed vechi/global nu dă gata. `Watch`: stabilitate, înlocuire, identitate/concurență și timeout. |
| P2 Jakarinos: confirmare în draft | `codexweb_pw.py:224`, `:350`, `:391`; `run_paw.ps1:84`: fără Send/trimis, exit 0, stare `asteapta_confirmare`, URL și `submitted=false`; lansatorul produce PAW_GATA. `/codex` permis numai pentru cxw nou netrimis în așteptare. | `SubmitGuards` ambele moduri; `MainLifecycle` exit 0; `test_contract.ps1` verifică payload JSON și refuză HOME ca succes trimis/continuare. |
| P2 Jakarinos: brief în pr_urls | `codexweb_pw.py:341`: protecția comună `safe_text` se aplică textului și fiecărui link derivat din răspuns; linkul modificat/egal cu brief-ul este omis. | `Watch.test_brief_only_pr_link_never_logged_in_answer_fields`: brief exclusiv URL PR, text și href identice; niciun câmp al rezultatului nu îl emite. |
| P2 Jakarinos: pregătire în afara timeout-ului | `run_paw.ps1:55`, `:79`, `:293`, `:763`: ceas comun pornit înainte de pregătire, buget rămas trimis și recalculat chiar înainte de Process.Start. Verificările listener/orfani sunt mutate sub procesul/job-ul deja limitat; `codexweb_pw.py:88`, `:95`, `:101`, `:430` folosesc un singur deadline inclusiv în watch. | `Deadline`: timeout subprocess plafonat la rest, pregătire consumată, watch fără reset. PowerShell: CxwRemaining și runner real cu clock expirat refuză înainte de orice copil. |
| P2 Copilot: certificare Windows | `RUNBOOK_RAZVAN.md:135`: secțiune 3a OBLIGATORIE înainte de acceptare/restabilirea pornirilor, matrice PASS/FAIL în audit. | Plan concret: două cxw simultane + cop/gem active, lock kernel două procese/crash, mesaje/URL separate, timeout și moarte părinte, arbore propriu oprit și celelalte procese intacte. Nerulat pe server. |

`LANSATOR_UNIC_PAW.md` descrie noul contract; runbook-ul cere și identitățile/scope-ul
DOM real. Pipe-ul lansatorului persistă evenimentele după terminarea helperului:
acceptanța concurenței folosește mesajul user vizibil + lock liber drept dovadă live,
apoi verifică `trimis` în logul final. Timeout-ul oprește arborele LOCAL; sarcina
cloud poate continua. Fără retry, anulare cloud sau confirmări automate.

## Teste rulate

- `python -B docs/paw/run_paw_v47/teste/test_codexweb_pw.py`: **40 teste,
  39 trecute, 1 omis** — lock kernel real Windows. Cazurile rundei 1 sunt păstrate
  și adaptate noului contract (bugetul intern helper poate fi 1–86400 secunde rămase;
  setarea publică din lansator rămâne 60–86400). Include cele 3 probe DOM fără browser,
  folosind Node existent, fără pachete npm noi.
- `teste/test_contract.ps1`, **PowerShell 7.5.4 pe Linux**: PASS pentru AST-ul
  lansatorului, fixture-uri URL comune cu Python, protocol PAW_GATA/HOME și deadline,
  inclusiv runner cu buget expirat fără Process.Start. Căile/junction reale Windows
  sunt explicit SKIP. PowerShell folosit numai în `work/`, nu instalat pe server.
- Regresie Gemini: clasele portabile TestTab, TestModel, TestAsteptare, TestCiorna,
  TestMain, TestSursa din v46: **22/22 trecute**. Nu modificăm testele/codul v46.
  Cele 7 cazuri TestBrief dependente de separatorul Windows, eșuate pe Linux în
  runda 1, nu sunt declarate reparate sau trecute în această rundă.
- Manifest verificat de test pe toți cei **13 runtime-uri**; 9 runtime-uri moștenite
  nemodificate sunt comparate octet cu octet cu v461. Diff limitat la Paw.

**Nerulate pe server:** Edge autentificat/UI live, Windows PowerShell 5.1, CIM,
Job Object și probele reale din runbook 3a. Testele offline nu certifică acestea.
La lipsa identității/scope-ului/statusului așteptat, canalul refuză sau expiră;
Răzvan validează UI-ul și recertifică cdx după instalarea revizuită. Nicio probă
Codex cloud plătită și nicio instalare efectuată de agent.

SHA256 al `SHA256.json`: `AF33682D0CB9EF42CFD6B3699A59CDA39296C03237FD7E268E53404279546576`.

## L01–L25

Referințe în acest director. Reguli fără operații corespunzătoare: n/a.

| Regulă | Respectare / test |
|---|---|
| L01 | `codexweb_pw.py:187`, `:440`: lock înainte de CDP și până după dovada user+disconnect; `SentEvidence`, `MainLifecycle`; lock kernel real omis aici, obligatoriu Windows. |
| L02 | n/a — fără scrieri BD/RPC/storage/mail. |
| L03 | `read_turn:272`, `TurnProgress:302`: user_key/response_key curente, reset la înlocuire; teste Watch și DomScope. |
| L04 | n/a — fără cantități/bani/mail sau retry automat. |
| L05 | `wait_submitted:289`, `watch:416`: trimitere/timeout ambigue nu declanșează retry/fallback; URL verificat manual conform runbook. `SentEvidence.test_missing_message_times_out_without_trimis`. |
| L06 | n/a pentru lock-uri SQL; ordinea locală install barrier → cxw este păstrată în `submit:358`, fără lock de watch. |
| L07 | n/a — fără tabele/politici/API de date. |
| L08 | n/a — fără identitate/proveniență BD/DEFINER. |
| L09 | n/a — fără service_role/ID-uri BD; mediul UI rămâne pe allow-list exactă. |
| L10 | `safe_text:172`, `emit_result:341`: aceeași protecție pentru text și href-uri, fără brief integral/erori brute. Test negativ brief=URL PR și testele de redactare r1. |
| L11 | n/a — fără extragere de valori dovedite din documente/tabele. |
| L12 | `TurnProgress:302`: partial/gol/status vechi/instabil nu sunt succes; `Watch` și `DomScope` verifică regresia BUSY → partial + completed vechi. |
| L13 | `arguments:46`, `read_turn:272`, `CxwProtocolState` în `run_paw.ps1:84`: validare explicită și stări pe listă închisă; teste pozitive/negative Python și PowerShell. |
| L14 | n/a — fără migrări. |
| L15 | n/a — fără porți de schemă. |
| L16 | n/a — fără chei BD/deduplicare documente. |
| L17 | `remaining:88`, `run_paw.ps1:55`, `:79`, `:293`: deadline monoton comun, fără reset; `Deadline` + contract PowerShell. Jurnal Europe/Bucharest rămâne păstrat. |
| L18 | `read_turn`, `TurnProgress`, `CxwProtocolState`: lipsa identității/scope-ului/confirmării nu devine gata; protocol și teste adversariale. |
| L19 | `normalizeaza/verifica_ciorna` comune Gemini; `emit_result` unic pentru toate câmpurile răspunsului; fixture-uri URL comune Python/PowerShell. |
| L20 | `SentEvidence`, `Watch`, `SubmitGuards`, `Deadline`: căi legitime și refuzuri; confirmarea nu devine eroare, oprirea Job rămâne posibilă după deadline. |
| L21 | n/a pentru API AI/scrieri BD; canalul UI cere totuși finalizare proprie stabilă, fără gol/partial ca succes. |
| L22 | n/a — fără API billing/rezervări usage/fallback nou; fără retrimitere cloud automată. |
| L23 | n/a — fără paginare React/PostgREST. |
| L24 | `read_turn:272`, `watch:416`: URL+identitate user+răspuns, contor exact și reset la înlocuire; fără interacțiune în watch; teste de concurență/navigare/înlocuire. |
| L25 | Expected-uri explicite și fixture-uri DOM independente executate cu JS-ul real; teste Python/PowerShell rulate, probele OS/UI marcate omise/nerulate și obligatorii în runbook. |
