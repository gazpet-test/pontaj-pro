# Lansator unic Paw (`run_paw`) — propunere v1 + verdicte echipă (07.10.2026)

Context: Bitdefender ATC a pus în carantină de trei ori (02.10, 05.10, 07.10) wrappere `.ps1` scrise ad-hoc de sesiunile Claude în `C:\Users\Public\erp_review` și pornite ascuns. Răzvan nu scoate antivirusul. Propunerea chat-ului: un singur lansator stabil, apelat de toate sesiunile cu parametri; nicio sesiune nu mai scrie scripturi noi pe PC. Textul integral trimis la review: `C:\Users\Public\erp_review\paw_lansator\PROPUNERE_RUN_PAW.md` (PC).

## v1 (trimisă la review)
- `run_paw.cmd <cine> <brief.md> <iesire.log> [model]`, `cine` ∈ jak / miloi / cop / gem / ollie.
- Reguli: fără `-WindowStyle Hidden`; un `.cmd` + un `.ps1` fixe, exceptate în AV pe `C:\Users\Public\paw`; Miloi `--mode plan --sandbox --dangerously-skip-permissions` (singura excepție); Jakarinos read-only, `--scrie` explicit; Copilot cu `-Tinta` obligatoriu; timeout per unealtă; rezultatul = date.

## Verdicte
**Copilot (conv. 2, 07.10 ~18:45 RO): GO cu condiții.**
- P0: codul exceptat NU stă într-un folder Public scriibil. `C:\ProgramData\Gazpet\Paw\bin\` cu ACL (doar Administrators/Răzvan modifică) pentru `.cmd` + `.ps1`; `C:\Users\Public\paw-data\` pentru brief/log, fără excepție AV. Excepția AV doar pe `bin`.
- P1: bypass-ul la Miloi doar dacă sandbox-ul e barieră tehnică (plan, repo read-only, fără `--add-dir`, fără secrete accesibile); dependența de semantica `agy` se documentează.
- P1: căile (brief, log, `--scrie`) canonicalizate; refuz UNC, ADS, symlink/junction, ieșire din rădăcini.
- P1: argumentele = allowlist mapată la comenzi fixe, nu concatenare în shell.
- P1: timeout-ul omoară arborele de procese. P1: CDP 9333 doar loopback.
- P2: lansatoarele vechi fără excepție AV și nefolosite automat; jurnal „append-only” real doar cu ACL sau hash-chain.

**Jakarinos (Codex, 07.10 ~18:40 RO): NO-GO în forma actuală** (aceleași găuri, mai apăsat):
1. Lansator fix ≠ protejat: cod sub ACL, separat de brief/log, fără excepție AV pe folder scriibil.
2. Excepția AV nu dovedește rezolvarea ATC: se identifică modulul/procesul din incident; nu se exceptează global powershell/cmd/python; „Hidden” nu e dovedit ca unică cauză.
3. Miloi: `agy --help` confirmă că flag-ul aprobă TOATE permisiunile, iar `--sandbox` = doar restricții de terminal; nu rezultă fișiere/MCP/browser read-only. Alternativă: diagnostic fără bypass sau mediu separat (repo read-only, fără secrete/profil principal).
4. Bariere pe parametri (liste închise, căi absolute, fără evaluare shell, director de lucru fixat explicit).
5. Copilot: cursă „liber” între două sesiuni → blocare exclusivă pe conversație, refuz la stare necunoscută, CDP loopback + profil dedicat.
6. Timeout pe tot arborele; marker final produs de lansator, cu id unic.
7. Rezervele vechi devin delegări către lansator sau se dezactivează.

## v2 — ce se schimbă (de implementat după OK Răzvan)
1. Cod: `C:\ProgramData\Gazpet\Paw\bin\{run_paw.cmd, run_paw.ps1}` cu ACL read-only pentru userul curent (Răzvan setează ca admin). Date: `C:\Users\Public\paw-data\{brief, out, paw_runs.log}`.
2. AV: excepție doar pe `bin` (și identificarea modulului ATC din incidentele existente, în loc de excepție pe `erp_review`).
3. Parametri: `cine` și `model` din liste închise; căi canonicalizate (`Resolve-Path` + refuz reparse/UNC/ADS) sub `paw-data` / worktree declarat; executabile pe căi absolute; brief transmis prin fișier, nu prin argument.
4. Miloi: pornire fără bypass, cu diagnostic (de ce stă headless) ÎNAINTE de a accepta flag-ul; dacă rămâne necesar, rulează din `C:\Users\Public\miloi_wt` (worktree separat), fără `--add-dir`, și se notează explicit dependența de `agy`.
5. Copilot: lock pe fișier per conversație (`paw-data\lock_<conv>`), refuz la stare necunoscută, verificare că 9333 ascultă doar pe 127.0.0.1.
6. Timeout: `taskkill /T` pe arbore; marker `PAW_GATA <id-run>` scris de lansator.
7. Lansatoarele vechi (`run_jak_ro.cmd`, `run_miloi_ro.cmd`) → o linie care apelează `run_paw`, apoi retrase.
8. CLAUDE.md: regula „Paw doar prin `run_paw`; fără scripturi ad-hoc pe PC”. Rând `automatizari` + secțiune în `registru_automatizari` cu fișa a–e.

Decizia lui Răzvan: A) v2 integral (necesită pașii lui de admin: folder ProgramData + ACL + excepție AV pe `bin`); B) v2 fără Miloi (jak/cop/gem/ollie acum, Miloi după diagnostic); C) se amână.
