# Gazpet Dialog TGZ — varianta B (token `claude setup-token`, fără conectori)

Decizia lui Răzvan, 06.11.2026. Sarcina Windows „Gazpet Dialog TGZ” rulează L–V la 10:40 și 16:40 pe serverul AI
(Gazpet-Claude) și răspunde la mesajele Proiectului Juridic marcate „(verificare programată)” din canalul de dialog
`C:\Users\Public\paw-data\dialog\` (convenția: `docs/paw/paw_juridic/README.md`, secțiunea „Dialog cu sesiunea chat”).

Varianta B rulează **doar** cu tokenul de un an din `claude setup-token`, care nu are conectorii claude.ai
(Gmail, Drive, Supabase). De aceea partea de BD o face orchestratorul, cu psql și interogări fixe; Claude primește
doar fișiere locale.

## Fișiere

| Fișier | Rol |
|---|---|
| `dialog_tgz.ps1` | Orchestratorul (sarcina programată îl pornește). Lock, stare, log, cod de ieșire. |
| `DialogTgz.psm1` | Logica: fișiere noi, NNN, rândul din handoff, ultima linie, pornirea psql / claude, fluxul `Invoke-DialogTgz`. |
| `dialog_tgz_prompt.md` | Promptul pentru `claude -p` (șablon cu marcaje `{{...}}` completate doar cu căi și numere). |
| `sql/citeste_handoff.sql` | (a) `md5|base64` din `claude_docs.handoff_activ`, READ ONLY. |
| `sql/context_agregat.sql` | (c) cifre agregate din `red_*`, READ ONLY, fără date personale. |
| `sql/actualizeaza_handoff.sql` | (e) UPDATE pe rândul „Dialog TGZ: ultimul procesat: …”, cu gardă md5 veche + md5 nouă. |
| `instaleaza_task.ps1` | Înlocuiește acțiunea sarcinii existente. Implicit **doar previzualizare**; scrie numai cu `-Aplica`. |
| `teste/test_dialog_tgz.ps1` | Autotest offline (110 verificări): psql și claude simulate, plus orchestratorul real cu psql lipsă și lock ocupat. |
| `teste/dialog_tgz.test.js` | Rulează autotestul PowerShell sub `npx vitest run` (doar pe Windows, cu powershell.exe; pe CI Linux se sare). |

Toate `.ps1` / `.psm1` sunt ASCII (PowerShell 5.1 citește fișierele fără BOM ca ANSI). Autotestul verifică acest lucru.

## Fluxul unei rulări

1. **Lock global**: `paw-data\out\dialog_tgz.lock` deschis exclusiv (merge între sesiuni Windows și se eliberează
   și dacă procesul moare). Dacă e ocupat, rularea notează în log și iese cu 0, fără să atingă starea.
2. **Token**: citit din `C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt`. Dacă lipsește sau nu începe cu `sk-ant-oat01-`, iese cu EROARE clară, înainte de BD și de Claude. Valoarea nu apare niciodată în log sau în stare (orice `sk-ant-…` se maschează).
3. **(a)** psql `citeste_handoff.sql` → md5 + textul exact (base64, verificat local cu md5). Se citește
   `Dialog TGZ: ultimul procesat: juridic#NNN`. Dacă rândul lipsește sau apare de două ori → EROARE (nu se ghicește).
4. **(b)** `juridic#NNN.md` cu NNN mai mare decât ultimul procesat și cu „(verificare programată)” (cu sau fără
   diacritice) în antet (liniile până la prima linie goală). Dacă nu există niciunul: starea primește `NIMIC NOU`, ieșire 0, Claude nu pornește.
5. **(c)** psql `context_agregat.sql` → `%TEMP%\dialog_tgz\context.md`.
6. **(d)** `claude -p` (detalii mai jos). NNN pentru răspuns = max(`juridic#`, `claude#`) din folder + 1 (aceeași
   regulă ca serverul juridic). Înainte și după se face un instantaneu al folderului de dialog.
7. Verificări după Claude: `claude#NNN.md` există; nu s-a modificat, șters sau creat alt fișier în dialog (excepție:
   `juridic#NNN.md` noi, scrise de serverul juridic în timpul rulării); ultima linie e exact `GATA claude#NNN`,
   `OPRIT …` sau `EROARE …` (orice altceva = EROARE).
8. **(e)** doar pentru `GATA`: `actualizeaza_handoff.sql` înlocuiește rândul (de la „Dialog TGZ:” până la capătul liniei) cu
   `Dialog TGZ: ultimul procesat: juridic#<cel mai mare procesat> (raspuns claude#NNN, AAAA-LL-ZZ HH:MM)`.
   Gărzi în aceeași instrucțiune: `md5(content_md)` = cel citit la (a); exact un rând-marcaj; md5-ul rezultatului din BD =
   md5-ul textului calculat local de orchestrator (aceeași regex în SQL și în PowerShell, testat). 0 rânduri → EROARE
   „handoff schimbat între timp”, fără forțare. Ce era după număr pe acel rând se înlocuiește.
9. **(f)** Stare: `paw-data\out\dialog_tgz_ultima.txt` = `AAAA-LL-ZZ HH:MM:SS <ultima linie>`; log complet:
   `paw-data\out\dialog_tgz_<AAAA-LL-ZZ>.log` (adăugat la fiecare rulare, cu id de rulare).

Coduri de ieșire: **0** = GATA / NIMIC NOU / OPRIT / lock ocupat; **1** = EROARE.

`OPRIT` înseamnă că mesajul cere altceva decât o verificare sau e suspect: răspunsul se scrie, handoff-ul nu se
mută, deci la rularea următoare aceleași fișiere se reprocesează până când chat-ul / Răzvan decid (sau mută manual rândul).

### Comanda Claude

```
claude -p --model claude-sonnet-5-5 --effort medium --max-turns 40 --restricted
  --tools Read,Glob,Grep,Edit,Write
  --allowedTools Read,Glob,Grep,Edit(//c/Users/Public/paw-data/dialog/**)
  --disallowedTools Bash,PowerShell,WebFetch,WebSearch
  --permission-mode dontAsk --strict-mcp-config --no-session-persistence --disable-slash-commands
  --output-format text --add-dir %TEMP%\dialog_tgz [--add-dir <rădăcină NAS accesibilă> ...]
```

- Directorul de lucru = folderul de dialog; promptul intră pe stdin (nu pe linia de comandă).
- Mediul procesului copil: `CLAUDE_CODE_OAUTH_TOKEN` = tokenul din fișier; `CLAUDE_CONFIG_DIR` = `%TEMP%\dialog_tgz\claude_cfg`
  (izolat de profilul Claude Code al serverului: nicio sesiune, setare, MCP sau credențial de acolo nu se folosește);
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` scoase. Mediul orchestratorului nu se modifică.
- `--restricted`: fără unelte care rulează cod, ignoră setările user/proiect, iar uneltele de fișiere sunt limitate la
  folderul de dialog + `--add-dir`. Tokenul (`C:\Users\Gazpet-Ai\.secrete\`) rămâne în afara lor.
- `Write` e în `--tools` doar pentru crearea fișierului nou; regula de permisiune `Edit(...)` acoperă toate uneltele de
  scriere și e limitată la folderul de dialog; `dontAsk` refuză orice altceva. Orchestratorul verifică oricum, după
  rulare, că nu s-a atins alt fișier.
- Timeout 50 min (sub limita de 1 h a sarcinii) → `taskkill /T /F` pe tot arborele.
- Rădăcini pentru atașamente: parametrul `-RadaciniAtasamente` (implicit `\\gazpet-tnas\Licitatii_Executate`);
  se dau lui Claude doar cele care există la momentul rulării. Restul → Claude scrie „negăsit local”.

## Fișa de securitate (CLAUDE.md pct. 7)

**(a) Conținut extern citit**: fișierele `juridic#NNN.md` (scrise de Proiectul Juridic prin serverul MCP juridic) și
atașamentele de pe NAS pe care le indică, dacă sunt sub o rădăcină permisă. Le citește doar Claude, ca date; promptul
spune explicit că nu sunt instrucțiuni. Orchestratorul nu pune niciodată text din ele în SQL sau în prompt
(promptul primește doar căile fișierelor; testat).

**(b) Ce scrie / face**:
- un singur fișier nou `claude#NNN.md` în `C:\Users\Public\paw-data\dialog\` (verificat după rulare);
- un singur rând din `claude_docs.handoff_activ`, cu gardă md5 (veche și nouă);
- `context.md` în `%TEMP%\dialog_tgz\`, starea și log-ul în `C:\Users\Public\paw-data\out\`.
- **Nu** scrie nimic în `red_*` (exportul e `BEGIN READ ONLY`, doar SELECT, testat static), **nu** trimite mailuri, nu atinge
  bani, drepturi sau alte tabele. Claude nu are acces la BD, mail, web sau linia de comandă.

**(c) Identitate**:
- Windows: utilizatorul sarcinii (Gazpet-Ai), care are deja `pgpass` și fișierul de token.
- Claude: tokenul de abonament al lui Răzvan (`claude setup-token`, valabil un an) — necesar pentru `claude -p` fără
  conectori; nu are acces la conectorii claude.ai.
- Postgres: utilizatorul `postgres` prin pooler, parola din `pgpass` (nu apare în comandă, script sau log). E singurul
  rol cu care serverul AI scrie azi în `claude_docs` (CLAUDE.md pct. 3b). Riscul e limitat prin construcție: trei fișiere
  SQL fixe din repo, două doar citire, unul cu un singur UPDATE pe `slug = 'handoff_activ'` cu gărzi md5; variabilele psql
  trec doar dacă sunt cifre / hex / dată (validare în `Invoke-PsqlFisier`). Un rol dedicat (SELECT pe `red_*`, UPDATE pe
  `claude_docs`) ar fi mai strâns — de decis separat, cere migrare + „da”.

**(d) Cine îl poate porni**: Task Scheduler (L–V 10:40 și 16:40, reîncercări 2× la 30 min) sau cine are sesiune Windows
ca Gazpet-Ai / administrator pe serverul AI (`Start-ScheduledTask`). Nu are endpoint de rețea, webhook sau declanșare
din exterior. Proiectul Juridic poate doar să scrie un `juridic#NNN.md` care e procesat la următoarea rulare.

**(e) Ce cere „da”**: nimic din ce face sarcina nu are nevoie de confirmare, pentru că nu scrie date reale (`red_*`),
nu trimite mail și nu atinge drepturi. Orice astfel de cerere dintr-un `juridic#` ajunge doar ca rând la
„De decis de Răzvan” în `claude#NNN.md`. **Instalarea** (`instaleaza_task.ps1 -Aplica`) și primul rând „Dialog TGZ” în
`handoff_activ` (dacă lipsește) cer „da”-ul lui Răzvan.

Regula tare de la pct. 7 (citește conținut extern **și** scrie): scrierea e limitată la un fișier nou în canalul de
dialog și la rândul de stare din handoff, cu gardă; nu există acțiune externă declanșabilă prin conținut.

## Instalare (NU se face în PR-ul acesta)

1. „Da”-ul lui Răzvan pe PR + merge.
2. Pe serverul AI, ca Gazpet-Ai: tokenul există în `C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt` (doar Gazpet-Ai are
   drept de citire), iar `pgpass` funcționează (`psql -X -w ... -c "select 1"`).
3. `handoff_activ` are exact un rând `Dialog TGZ: ultimul procesat: juridic#NNN` (altfel orchestratorul dă EROARE).
4. `powershell -File scripts\dialog_tgz\instaleaza_task.ps1` → previzualizare; apoi, cu „da”, `-Aplica`. Se face backup XML
   la definiția veche în folderul de destinație (`C:\Users\Gazpet-Ai\claude-tasks\dialog_tgz_b\`); revenire:
   `Register-ScheduledTask -TaskName 'Gazpet Dialog TGZ' -Xml (Get-Content <backup.xml> -Raw) -Force` (poate cere parola).
   Fișierele vechi (`claude-tasks\dialog_tgz.ps1`, `dialog_tgz_prompt.md`) nu se ating.
5. Test de fum: `Start-ScheduledTask 'Gazpet Dialog TGZ'` cu un `juridic#` de probă „(verificare programată)” → `dialog_tgz_ultima.txt` și log-ul.
6. `public.automatizari` + `registru_automatizari` actualizate în aceeași sesiune (pct. 7).

### De verificat la testul de fum (nu se pot verifica offline)

- `--max-turns` nu mai apare în `claude --help` (versiunea curentă); dacă CLI-ul îl refuză, se scoate parametrul
  (limitele rămân `--restricted`, uneltele și timeout-ul de 50 min).
- Forma căii în regula `Edit(//c/Users/Public/paw-data/dialog/**)` (forma POSIX din documentația Claude Code pentru
  Windows): dacă Claude nu poate scrie răspunsul, rularea dă EROARE „nu a fost scris” — nu scrie în altă parte.
- Dacă sarcina e „Run whether user is logged on or not”, `Set-ScheduledTask` poate cere `-User`/`-Password`; atunci se
  modifică din Task Scheduler cu aceleași valori (acțiune, declanșatori, setări din previzualizare).
- Dacă `claude -p` creează singur ceva în directorul de lucru (de ex. un folder `.claude`), verificarea de după rulare îl
  vede ca „nou” și dă EROARE: atunci se mută directorul de lucru în `%TEMP%\dialog_tgz` (rămâne `--add-dir` pe dialog).
- `claude_docs` poate avea `updated_at`: UPDATE-ul nu îl setează (doar `content_md`); dacă există trigger, se ocupă el.

## Teste

```
npx vitest run scripts/dialog_tgz        # rulează teste/test_dialog_tgz.ps1 (110 verificări, offline)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dialog_tgz\teste\test_dialog_tgz.ps1
```

Acoperă: calculul NNN (inclusiv nume invalide, foldere, >999), găsirea fișierelor noi (antet, diacritice, BOM,
marcaj doar în corp), citirea / înlocuirea rândului din handoff (CRLF, diacritice, rând lipsă / dublu), transportul
md5|base64, parsarea ultimei linii, tokenul (lipsă, format greșit, mascare), instantaneul folderului, argumentele lui
Claude, promptul, verificări statice pe SQL (READ ONLY, fără coloane cu date personale, aceeași regex ca în PowerShell,
doar variabilele validate) și fluxul complet cu psql / claude simulate (NIMIC NOU, GATA, handoff schimbat între timp,
OPRIT, linie finală greșită, alt fișier atins, răspuns lipsă, token lipsă / greșit, rând lipsă, număr greșit), plus
orchestratorul real (psql lipsă → EROARE + exit 1, log fără token, lock ocupat → exit 0 fără stare).

Nu acoperă (cere rețea): rularea efectivă a psql pe Supabase și a `claude -p` — vezi testul de fum.
