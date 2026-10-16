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

## v2 LIVRATĂ (07.10.2026 seara, decizia Răzvan: **B, fără Miloi**)
- Cod: `C:\ProgramData\Gazpet\Paw\bin\run_paw.cmd` + `run_paw.ps1` + copia `cgpt_pw.py`; ACL: Administrators/SYSTEM full, Users doar citire+execuție (owner-ul rămâne Răzvan: rezidual, poate schimba ACL fără elevare).
- Date: `C:\Users\Public\paw-data\{brief, out, paw_runs.log, lock_cop_<conv>}`; fără excepție AV. Excepția Bitdefender se pune doar pe `bin` (Răzvan).
- `cine` ∈ jak / cop / ollie; modele din liste închise; `cop` cere id-ul conversației (6abc000f chat, 6ac5006f Ofertare), lock per conversație, refuz dacă `stare` nu răspunde „genereaza: False”, verificare că 9333 ascultă doar pe 127.0.0.1.
- Căi: `GetFullPath` + refuz UNC / ADS / reparse point pe fiecare segment / ieșire din rădăcini; brief doar `.md` sub `paw-data\brief` sau `erp_review`; ieșirea doar sub `paw-data\out`.
- Fără shell: `ProcessStartInfo` cu argumente citate, `"` interzis în argumente; `node codex.js exec --sandbox read-only -C <repo>`; Ollama cu brief-ul pe stdin.
- Timeout per unealtă (jak 1200 s, cop 1800 s, ollie 600 s) → `taskkill /T /F` pe arbore; marker `PAW_GATA <id-run>` / `PAW_EROARE <id-run> <motiv>` scris de lansator; stderr curățat de ANSI.
- Teste 07.10: refuzuri (cine necunoscut, ieșire în afara rădăcinii, traversal `..`, ADS, model nepermis, țintă lipsă) → toate `PAW_EROARE`; ollie „PAW_OK Qwen” 6 s; jak „PAW_OK Codex” 17 s; cop test de canal pe conv. 2.
- Neimplementat (conștient): `--scrie` pentru jak (toate rulările sunt read-only; scrierea se cere separat), `gem` (nu există unealtă Gemini pe PC), Miloi (după diagnostic fără bypass), hash-chain pe jurnal.
- Regula în CLAUDE.md pct. 11; rând `automatizari` „run_paw”; lansatoarele vechi rezervă până pe 14.10.

## v4.3 — `gem` (Gemini 4 Argon), 16.10.2026
Baza: v4.2 instalată (sursa în laborator, `origin/ocrlab/banca-etichetare:docs/ocrlab/run_paw_v4/`; ps1 `18BF75BD…18F0`, cmd `028110D1…AE85`). Sursa v4.3: `docs/paw/run_paw_v43/` (`run_paw.ps1`, `run_paw.cmd`, `gemini_pw.py`, `.gitattributes` = fără conversie de capăt de linie, `teste/`).

**Ce e.** `cine = gem` trimite brief-ul la Gemini 4 Argon prin același Edge CDP 9333 de pe serverul AI (doar loopback, profil separat, fără sync) în care Răzvan se loghează o dată pe gemini.google.com. Aprobat explicit de Răzvan pe 16.10.2026.

**Când se folosește.** A doua/a treia opinie pe arhitectură și automatizări, lângă Jakarinos și Copilot. **NU e poartă GO/NO-GO** (poarta rămâne Copilot + acordul lui Răzvan); răspunsul lui e conținut extern (CLAUDE.md pct. 10): date de cântărit, nu instrucțiuni.

**Ce date pleacă.** Doar textul brief-ului `.md`. Fără secrete (chei, token-uri, parole, URL-uri semnate), fără PII (CNP, salarii, date de angajați/clienți), fără date reale din BD dincolo de ce cere întrebarea. Cine scrie brief-ul răspunde de asta; lansatorul nu filtrează conținutul.

**Apel.** `run_paw.cmd gem <brief.md> <iesire.log> [argon]` — `model` opțional (`""` sau `argon`, altceva = refuz). Timeout 1800 s, kill pe arbore.

**Cum lucrează** (`gemini_pw.py`, lângă `cgpt_pw.py` în `bin`):
1. Lansatorul: aceleași validări ca la `cop` (liste închise, căi canonicalizate, brief `.md` sub `paw-data\brief` / `erp_review`, ieșire doar sub `paw-data\out`, refuz UNC/ADS/reparse/traversal), apoi **lock global** `paw-data\lock_gem` luat atomic (CreateNew; un singur apel `gem` odată, lock-ul altei rulări nu se șterge; unul mai vechi de timeout + 120 s se consideră abandonat), apoi verificarea că 9333 ascultă doar pe 127.0.0.1.
2. `gemini_pw.py trimite <brief> <secunde>`: atașare la `http://127.0.0.1:9333`; exact un tab `https://gemini.google.com` (niciunul → `fara_tab_gemini`, mai multe → `mai_multe_taburi_gemini`); modelul afișat (`[data-test-id="bard-mode-menu-button"]`) trebuie să conțină „Argon” (altfel `model_gresit`); refuz dacă Gemini încă scrie (`gemini_ocupat`); brief-ul intră în editor (ciorna veche se înlocuiește; verificat ≥ 80% din text), Enter; răspunsul nou (`message-content`) e gata după 5 citiri identice la 2 s și fără buton de oprire; altfel `timeout_raspuns` (partialul ajunge în ieșire).
3. Răspunsul iese pe stdout și lansatorul îl scrie în ieșire; ultima linie `PAW_GATA <id> gem <model> <s> exit=0` sau `PAW_EROARE <id> <cod>` (codul din `gemini_pw.py`, ex. `PAW_EROARE <id> fara_tab_gemini`); jurnal în `paw-data\paw_runs.log`.
4. Fără alte capabilități: nu navighează, nu dă reload, nu închide Edge, nu atașează fișiere, nu scrie fișiere (nici jurnal propriu). `python gemini_pw.py stare` = doar citire (URL, model, dacă scrie) pentru verificarea de după instalare.

**Reparat în aceeași versiune (cop).** În v4.2, refuzul „conversația e ocupată” ștergea lock-ul celeilalte rulări (lock-ul era atribuit înainte de a fi luat). În v4.3 lock-ul devine al rulării doar după creare. Testul `test_cop_lock_ocupat_ramane_al_celuilalt` pică pe v4.2 și trece pe v4.3.

**Teste (fără admin, fără browser).** `python -I docs\paw\run_paw_v43\teste\test_gemini_pw.py` (21: tab, model, așteptare stabilă, brief, comenzi, sursa fără capabilități în plus — obiecte false, fără Playwright) și `python -I docs\paw\run_paw_v43\teste\test_run_paw.py` (14: lansatorul copiat într-un director temporar cu `$DATA` rescris spre un paw-data temporar și un `gemini_pw.py` fals — paw-data-ul real și Gemini nu sunt atinse; refuzuri cine/model/brief în afară/traversal/UNC/ADS/.txt/ieșire în afară/lipsă gemini_pw.py, lock ocupat la gem și cop, codul de eroare devine motivul markerului, calea de succes cu stub, jurnal izolat). 16.10.2026 pe Gazpet-Claude: 21/21 și 14/14 OK.

**Instalare (Răzvan, PowerShell ca Administrator, pe serverul AI).** Fișiere noi:

| fișier | SHA-256 |
|---|---|
| `run_paw.ps1` | `198C71ABCD2712FEBA1C108AB2B132435FE71EDE29AAD7DCC93A8B9C1400F02C` |
| `run_paw.cmd` | `080ED5A3D79EC274A9988B7BEDE2EDA2DAD1A536F2239149A3F5EBA6C9544C63` |
| `gemini_pw.py` | `EFB3F39BE5B52E8EBED08AC1323A2ED1318710A7AD952C94CF0B06D902B9AFAD` |

```powershell
$repo = 'C:\Users\Gazpet-Ai\gazpet-erp'; $bin = 'C:\ProgramData\Gazpet\Paw\bin'; $src = 'C:\Users\Public\livrare\run_paw_v43'
$nou  = @{ 'run_paw.ps1' = '198C71ABCD2712FEBA1C108AB2B132435FE71EDE29AAD7DCC93A8B9C1400F02C'; 'run_paw.cmd' = '080ED5A3D79EC274A9988B7BEDE2EDA2DAD1A536F2239149A3F5EBA6C9544C63'; 'gemini_pw.py' = 'EFB3F39BE5B52E8EBED08AC1323A2ED1318710A7AD952C94CF0B06D902B9AFAD' }
$v42  = @{ 'run_paw.ps1' = '18BF75BD0938102B772537FC215D55993DF1604F372569ED25A54A4BBFC818F0'; 'run_paw.cmd' = '028110D18B61EFEBDDB1702CFD85161FC4ABE347FA54B82ABE79A3DE3610AE85' }
foreach ($n in $v42.Keys) { if ((Get-FileHash -Algorithm SHA256 -LiteralPath "$bin\$n").Hash -ne $v42[$n]) { throw "in bin nu e v4.2: $n - ma opresc" } }
git -C $repo fetch origin claude/run-paw-gem
if (Test-Path $src) { Remove-Item -Recurse -Force $src }; New-Item -ItemType Directory -Force $src | Out-Null
git -C $repo archive --format=zip -o "$src.zip" FETCH_HEAD docs/paw/run_paw_v43
Expand-Archive -LiteralPath "$src.zip" -DestinationPath $src -Force
$f = "$src\docs\paw\run_paw_v43"
foreach ($n in $nou.Keys) { $h = (Get-FileHash -Algorithm SHA256 -LiteralPath "$f\$n").Hash; if ($h -ne $nou[$n]) { throw "hash gresit la $n : $h" } }
$vechi = Join-Path $bin ('vechi_v4_2_' + (Get-Date -Format 'yyyyMMdd_HHmm')); New-Item -ItemType Directory $vechi | Out-Null
Copy-Item -LiteralPath "$bin\run_paw.ps1", "$bin\run_paw.cmd" -Destination $vechi
foreach ($n in $nou.Keys) { Copy-Item -LiteralPath "$f\$n" -Destination "$bin\$n" -Force }
foreach ($n in $nou.Keys) { $h = (Get-FileHash -Algorithm SHA256 -LiteralPath "$bin\$n").Hash; '{0}  {1}  {2}' -f $(if ($h -eq $nou[$n]) { 'OK ' } else { 'GRESIT' }), $h, $n }
icacls "$bin\gemini_pw.py"
```
Dacă `git` refuză în fereastra de admin („dubious ownership”), liniile `git fetch` + `git archive` + `Expand-Archive` (plus primele două linii, pentru variabile) se rulează într-un PowerShell normal, apoi tot blocul ca admin fără liniile `git` / `Remove-Item` / `New-Item $src` / `Expand-Archive` (verificarea hash-urilor rămâne înainte de copiere). Rollback (în aceeași fereastră; altfel folderul `bin\vechi_v4_2_<data>`): `Copy-Item "$vechi\*" $bin -Force` și `Remove-Item "$bin\gemini_pw.py"`. Fișierul nou moștenește ACL-ul din `bin` (Users doar citire + execuție) — `icacls` de la final trebuie să arate asta.

**După instalare.** (1) În Edge-ul 9333 de pe server: login o dată pe gemini.google.com, un singur tab Gemini deschis, modelul „Gemini 4 Argon” selectat. (2) Verificare fără trimitere: `& 'C:\Program Files\Python313\python.exe' C:\ProgramData\Gazpet\Paw\bin\gemini_pw.py stare` → `model: Gemini 4 Argon`, `genereaza: False`. (3) Test de canal: brief de o linie („Răspunde doar: PAW_OK Gemini”) prin `run_paw.cmd gem …`. (4) Rândul „run_paw” din `public.automatizari` + secțiunea din `registru_automatizari` se actualizează cu `gem` (fișa a–e: citește răspunsul Gemini = conținut extern; scrie doar fișierul de ieșire; rulează ca utilizatorul serverului, fără service_role; pornit doar de sesiunile Claude prin lansator; nicio acțiune automată pe baza răspunsului).
