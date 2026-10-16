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

## v4.3 — `gem` (Gemini 4 Argon), 16.10.2026 (r6 după Jakarinos r1–r5)
Baza: v4.2 instalată (sursa în laborator, `origin/ocrlab/banca-etichetare:docs/ocrlab/run_paw_v4/`; ps1 `18BF75BD…18F0`, cmd `028110D1…AE85`). Sursa v4.3: `docs/paw/run_paw_v43/` (`run_paw.ps1`, `run_paw.cmd`, `gemini_pw.py`, `.gitattributes` = fără conversie de capăt de linie, `teste/`).

**Ce e.** `cine = gem` trimite brief-ul la Gemini 4 Argon prin același Edge CDP 9333 de pe serverul AI (doar loopback, profil separat, fără sync) în care Răzvan se loghează o dată pe gemini.google.com. Aprobat explicit de Răzvan pe 16.10.2026.

**Când se folosește.** A doua/a treia opinie pe arhitectură și automatizări, lângă Jakarinos și Copilot. **NU e poartă GO/NO-GO** (poarta rămâne Copilot + acordul lui Răzvan); răspunsul lui e conținut extern (CLAUDE.md pct. 10): date de cântărit, nu instrucțiuni.

**Ce date pleacă.** Doar textul brief-ului `.md`. Fără secrete (chei, token-uri, parole, URL-uri semnate), fără PII (CNP, salarii, date de angajați/clienți), fără date reale din BD dincolo de ce cere întrebarea. Cine scrie brief-ul răspunde de asta; lansatorul nu filtrează conținutul.

**Apel.** `run_paw.cmd gem <brief.md> <iesire.log> [argon]` — `model` opțional (`""` sau `argon`, altceva = refuz). Timeout 1800 s, kill pe arbore.

**Cum lucrează** (`gemini_pw.py`, lângă `cgpt_pw.py` în `bin`):
1. Lansatorul: aceleași validări ca la `cop` (liste închise, căi canonicalizate, brief `.md` sub `paw-data\brief` / `erp_review`, ieșire doar sub `paw-data\out`, refuz UNC/ADS/reparse/traversal), apoi **marcajul de canal validat** (r3: `paw-data\gem_canal_validat` cu hash-ul `gemini_pw.py` instalat, altfel refuz — vezi testul de canal de la final), apoi **Job Object**, apoi **lock global** `paw-data\lock_gem`, apoi **așteptarea driverelor Playwright orfane** (r4), apoi verificarea că 9333 ascultă doar pe 127.0.0.1.
2. **Lock (r2, Jakarinos P1-a; la fel pentru `lock_cop_<conv>`)**: exclusivitatea = un handle deschis cu `FileShare.None`, ținut pe toată rularea. Fișierul de lock nu se mai șterge niciodată — nici la „recuperare”, nici la curățare —, deci nu mai există lock „expirat” de înlocuit și nicio ștergere făcută pe baza unei observații vechi. Dacă rularea care îl ținea a murit, sistemul i-a închis handle-ul și următoarea rulare îl deschide direct (recuperare atomică, făcută de kernel). Cât timp e ținut, alt proces nu-l poate deschide, rescrie, redenumi sau șterge; refuzul e `ocupat de alta rulare (lock_gem e tinut deschis)`. **Viața copiilor e legată de lansator** (r3, Jakarinos r2 P1), la `gem` și `cop`:
   - Înainte de lock și de orice copil, lansatorul intră el însuși într-un Job Object cu `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, verificat după setare. Copiii porniți după aceea sunt automat în job, fără fereastră între pornire și atribuire.
   - Handle-ul job-ului îl ține doar lansatorul și nu se moștenește. Când lansatorul moare (sau iese), sistemul omoară tot arborele.
   - Handle-ul de lock e **moștenit** de copii (python `gemini_pw.py` / `cgpt_pw.py`). Lock-ul rămâne deci ținut cât trăiește oricare dintre ei: lansator mort → copii omorâți → abia apoi lock liber. Fără asta, o rulare nouă ar fi putut lua lock-ul cât copilul vechi încă scria în ciornă. Excepție: driverul Playwright nu moștenește lock-ul (vezi mai jos).
   - La `jak` / `ollie` comportamentul rămâne cel din v4.2 (timeout = `taskkill /T`), ca un eventual server Ollama pornit de CLI să nu fie omorât la ieșire.
   - **Driverul Playwright (r4, Jakarinos r3 P1, varianta A aleasă de Răzvan).** Python pornește driverul Node al Playwright (`node.exe <playwright>\driver\package\cli.js run-driver`) cu `close_fds`, deci driverul nu moștenește lock-ul. Job-ul omoară arborele fără o ordine garantată, așa că putea rămâne o fereastră: python mort → lock liber → driverul vechi încă trimite comenzi CDP. De aceea:
     - după ce iau lock-ul și **înainte de orice contact CDP**, `gem` și `cop` așteaptă până nu mai există niciun driver Playwright **orfan**;
     - la prima detecție a unui driver orfan viu, rularea scrie în jurnal `<runid> | astept_driver pid=…` (r6): semnal explicit, verificabil din afară, că a ajuns la verificare și așteaptă fără contact CDP;
     - după 30 s fără schimbare, rularea se oprește cu `PAW_EROARE <id> driver_ramas pid=…`, fără să atingă procesul;
     - **orfan** = `node.exe` exact din pachetul `playwright` al Python-ului folosit (`C:\Program Files\Python313\Lib\site-packages\playwright\driver\node.exe`), cu cli.js-ul pachetului și `run-driver` în linia de comandă, al cărui părinte (python) sau bunic (lansatorul / consola) nu mai trăiește. Părinții se verifică și după data creării, ca un PID refolosit să nu fie luat drept părinte;
     - driverele cu lanț întreg aparțin unor rulări vii (de ex. `cop` pe altă conversație, sau un apel manual) și nici nu blochează, nici nu sunt atinse;
     - `PLAYWRIGHT_NODEJS_PATH` e scos din mediul copiilor, ca driverul să fie mereu cel din pachet;
     - la ieșire (normală sau cu eroare), lock-ul se eliberează explicit **doar** când în job a rămas numai lansatorul (`ActiveProcesses = 1`). r5, Jakarinos r4 P2-1: condiția e obligatorie. După 15 s, rezultatul e `PAW_EROARE <id> copii_ramasi activi=<n> …`. Orice interogare eșuată a job-ului, la orice citire, inclusiv prima (r6, Jakarinos r5 P2-a), dă imediat `PAW_EROARE <id> job_interogare_esuata …`; o citire bună ulterioară nu mai poate acoperi eșecul. În ambele cazuri: fără `PAW_GATA` și fără eliberare explicită. Lock-ul rămâne ținut până când sistemul închide handle-ul la ieșirea lansatorului, iar atunci job-ul omoară și copiii rămași.

   Calea lock-ului trece prin aceleași verificări (fără reparse, sub `paw-data`, calea finală a handle-ului verificată).
3. `gemini_pw.py trimite <brief> <secunde>`: atașare la `http://127.0.0.1:9333`; exact un tab `https://gemini.google.com` (niciunul → `fara_tab_gemini`, mai multe → `mai_multe_taburi_gemini`); modelul afișat (`[data-test-id="bard-mode-menu-button"]`) trebuie să conțină „Argon” (altfel `model_gresit`); refuz dacă Gemini încă scrie (`gemini_ocupat`); refuz dacă ciorna are deja atașamente (`ciorna_cu_atasamente`); brief-ul intră în editor (ciorna veche se înlocuiește). **Înainte de Enter (r2, P1-b)**: textul din ciornă trebuie să fie *identic* cu brief-ul după o normalizare explicită (CRLF/CR → LF, NBSP → spațiu, caractere de lățime zero scoase, orice șir de spații albe — inclusiv linii goale — → un spațiu, capete tăiate), altfel `text_neintrat`; atașamentele se verifică din nou. Răspunsul nou (`message-content`) e gata după 5 citiri identice la 2 s și fără buton de oprire; altfel `timeout_raspuns` (parțialul ajunge în ieșire).
4. Brief: maximum 200 000 de caractere, verificat pe textul **citit, înainte de strip** (r2, P2) și pe mărimea fișierului.
5. Răspunsul iese pe stdout și lansatorul îl scrie în ieșire; ultima linie `PAW_GATA <id> gem <model> <s> exit=0` sau `PAW_EROARE <id> <cod>` (codul din `gemini_pw.py`, ex. `PAW_EROARE <id> fara_tab_gemini`); jurnal în `paw-data\paw_runs.log`.
6. Fără alte capabilități: nu navighează, nu dă reload, nu închide Edge, nu atașează fișiere, nu scrie fișiere (nici jurnal propriu). `python gemini_pw.py stare` = doar citire (URL, model, dacă scrie, câte atașamente vede în ciornă) pentru verificarea de după instalare. Selectorii de atașamente sunt cei cunoscuți (`uploader-file-preview` și înrudiți); nu sunt validați fără browser, de aceea testul de canal de la final (pașii 4–5) e obligatoriu și deblochează `gem`.

**Reparat în aceeași versiune (cop).** În v4.2, refuzul „conversația e ocupată” ștergea lock-ul celeilalte rulări. În v4.3 r2, `cop` folosește același lock pe handle ca `gem`. Testele de lock pică pe v4.2 și pe v4.3 r1 și trec pe r2.

**Teste (fără admin, fără browser).** 16.10.2026 pe Gazpet-Claude:
- `python -I docs\paw\run_paw_v43\teste\test_gemini_pw.py` — 32/32 OK. Obiecte false, fără Playwright: tab, model, așteptare stabilă, brief (inclusiv limita înainte de strip), ciornă (identică după normalizare, trunchiată, trunchiată > 80%, aceeași lungime cu alt conținut, text în plus, goală, cu atașamente), comenzi, sursa fără capabilități în plus și Enter doar după verificarea ciornei.
- `python -I docs\paw\run_paw_v43\teste\test_run_paw.py` — 33/33 OK. Lansatorul e copiat într-un director temporar, cu `$DATA` rescris spre un paw-data temporar și cu `gemini_pw.py` / `cgpt_pw.py` false; paw-data-ul real, Gemini și ChatGPT nu sunt atinse. Acoperă:
  - **r3: lansatorul omorât în timpul rulării** (gem și cop; `TerminateProcess` doar pe PowerShell, nu pe arbore): copilul moare, iar în momentul în care lock-ul devine liber copilul e deja mort. Testul pică pe r2 („lock-ul s-a eliberat cât copilul încă rula”);
  - **r4: driver Playwright rămas** (fals: același exe, `cli.js run-driver`, recunoscut exact ca unul real), pentru gem și cop:
    - un driver orfan care trăiește → rularea nouă ia lock-ul, dar **nu atinge CDP** cât trăiește driverul; după moartea lui rulează până la `PAW_GATA`;
    - dacă driverul rămâne peste timeout → `PAW_EROARE <id> driver_ramas pid=<pid>`, fără niciun contact CDP, iar driverul nu e atins;
    - un driver cu lanț întreg (rulare vie) nu blochează și nu e atins;
    - **scenariu sincronizat explicit** (r5, Jakarinos r4 P2-2), fără eșantionare:
      - A rulează python → driver fals. Driverul trăiește garantat până când testul scrie `elibereaza_driver`. Ca să supraviețuiască job-ului lui A (cazul cel mai rău al uciderii neordonate), iese explicit din job; asta e posibil doar în copia de test `run_paw_bariera.ps1`, unde job-ul are în plus `BREAKAWAY_OK`. Producția nu are acest flag.
      - A e omorât → python-ul lui A moare (lock eliberat). B pornește cât driverul lui A e încă viu.
      - Testul așteaptă **semnalul explicit al lui B** (r6, Jakarinos r5 P2-b), adică `astept_driver pid=<driverul lui A>` în jurnal. Dacă B atinge CDP-ul sau iese înainte de semnal, testul pică imediat.
      - Abia după semnal se verifică faptul că B **nu** a atins CDP-ul. Marcajele `cdp_atins_*` sunt persistente, deci absența lor acoperă tot intervalul, nu doar momentele citite.
      - Abia apoi driverul e eliberat, iar B atinge CDP-ul după moartea lui și termină cu `PAW_GATA`.
      - Rulat pe gem și cop. Pe mutația fără așteptare (echivalentul r3), **exact aceste două teste pică**, cu „B a atins CDP-ul fără să fi semnalat astept_driver”: B nu emite niciodată semnalul și atinge CDP-ul;
  - **r6: interogarea job-ului eșuată la prima citire.** Copia de test `run_paw_inj.ps1` injectează `-2` la prima citire `ActiveProcesses`; următoarele citiri sunt reale. Rezultatul trebuie să fie `PAW_EROARE <id> job_interogare_esuata`, fără `PAW_GATA`. Testat pe gem și cop. Pe mutația care ignoră `-2` și citește din nou (comportamentul r5), ambele teste pică cu `PAW_GATA`;
  - **r5: copii rămași în job** (stub care lasă un proces în viață și iese), pe gem și cop:
    - rezultatul e `PAW_EROARE <id> copii_ramasi activi=2 …`, fără `PAW_GATA` în ieșire;
    - lock-ul rămâne ținut cât copilul trăiește;
    - la ieșirea lansatorului, job-ul oprește copilul și lock-ul se eliberează;
    - pe mutația cu vechiul comportament r4 (revenire după timeout), ambele teste pică;
  - **r3: marcajul de canal**: lipsă, alt hash, gol / fără hash / text liber, prefix de hash → refuz la validare, fără rulare;
  - refuzuri: cine, model, brief în afară, traversal, UNC, ADS, `.txt`, ieșire în afară, lipsă `gemini_pw.py`;
  - lock ținut de alt proces viu (gem și cop): refuz, iar lock-ul celuilalt rămâne neatins;
  - lock vechi abandonat: preluat fără ștergere;
  - **cursa din r1**: două lansatoare pornite simultan pe un lock vechi → exact unul `PAW_GATA` și unul `ocupat`; cât rulează câștigătorul, lock-ul lui nu poate fi șters și nici deschis;
  - codul de eroare devine motivul markerului;
  - calea de succes cu stub;
  - jurnal izolat.
- `python -I docs\paw\run_paw_v43\teste\test_instalare.py` — 12/12 OK. Ia blocurile PowerShell de mai jos exact din acest fișier: sintaxă, `$ErrorActionPreference = 'Stop'`, hash-urile din doc = hash-urile fișierelor. Apoi rulează pasul 2 pe un `bin` temporar cu v4.2 luat din git:
  - instalare reușită, cu backup verificat;
  - hash GREȘIT după copiere → restaurare automată + verificare;
  - copiere întreruptă → restaurare;
  - `bin` care nu e v4.2 → oprire fără nicio modificare;
  - `gemini_pw.py` deja prezent → oprire;
  - r3: proces activ cu `run_paw.ps1` sau `cgpt_pw.py` în linia de comandă → refuz, fără backup și fără modificări;
  - r3: `lock_cop_*` v4.2 recent → refuz; unul vechi de 2 ore nu blochează;
  - r3: o rulare apărută între backup și copiere → a doua verificare oprește înainte de orice copiere.

  (Testul a prins o capcană reală: o funcție numită `H` ar fi fost umbrită de aliasul `H` = `Get-History`; acum se numește `HashF`.)

**Instalare (Răzvan, pe serverul AI).** Fișiere noi:

| fișier | SHA-256 |
|---|---|
| `run_paw.ps1` | `7A0D7FD92E8D7627EB8F4A6356CC3B8C7B51EF871E6CF7BEB74FE24B051556AC` |
| `run_paw.cmd` | `080ED5A3D79EC274A9988B7BEDE2EDA2DAD1A536F2239149A3F5EBA6C9544C63` |
| `gemini_pw.py` | `85E6E43874EF1F133CB3A95EB908AEE4E7213335A4B051EA46AA3CBE09107176` |

Pasul 1 — sursa și hash-urile (PowerShell normal; merge și ca admin dacă `git` nu refuză cu „dubious ownership”):
```powershell
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Gazpet-Ai\gazpet-erp'; $src = 'C:\Users\Public\livrare\run_paw_v43'
$nou  = @{ 'run_paw.ps1' = '7A0D7FD92E8D7627EB8F4A6356CC3B8C7B51EF871E6CF7BEB74FE24B051556AC'; 'run_paw.cmd' = '080ED5A3D79EC274A9988B7BEDE2EDA2DAD1A536F2239149A3F5EBA6C9544C63'; 'gemini_pw.py' = '85E6E43874EF1F133CB3A95EB908AEE4E7213335A4B051EA46AA3CBE09107176' }
git -C $repo fetch origin claude/run-paw-gem; if ($LASTEXITCODE -ne 0) { throw 'git fetch a esuat' }
if (Test-Path -LiteralPath $src) { Remove-Item -LiteralPath $src -Recurse -Force }
New-Item -ItemType Directory -Path $src | Out-Null
git -C $repo archive --format=zip -o "$src.zip" FETCH_HEAD docs/paw/run_paw_v43; if ($LASTEXITCODE -ne 0) { throw 'git archive a esuat' }
Expand-Archive -LiteralPath "$src.zip" -DestinationPath $src -Force
$f = Join-Path $src 'docs\paw\run_paw_v43'
foreach ($n in $nou.Keys) { $h = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $f $n)).Hash; if ($h -ne $nou[$n]) { throw "sursa: hash gresit la $n ($h)" } }
'SURSA OK'
```

Pasul 2 — instalarea (PowerShell **ca Administrator**). Oprește la orice eroare.
- **Precondiție operațională (r4, Jakarinos r3 P2b):** pe toată durata instalării **toate lansările Paw sunt oprite**. Răzvan anunță în chat „instalez run_paw, nicio sesiune nu pornește run_paw / cgpt_pw / gemini_pw până confirm”. Chat-ul transmite asta sesiunilor de programare și pune pe pauză rutinele care pornesc Paw, iar Răzvan confirmă în chat după `INSTALAT v4.3 OK`. Verificările de mai jos sunt doar plasă de siguranță: între ultima verificare și copiere tot poate porni o rulare, de aceea oprirea lansărilor e obligatorie, nu opțională.
- **Refuză dacă există rulări v4.2 în curs** (r3, Jakarinos r2 P2a): procese cu `run_paw.ps1` / `run_paw.cmd` / `cgpt_pw.py` / `gemini_pw.py` în linia de comandă (Codex sau Ollama pornite de lansator trăiesc doar sub un astfel de proces) sau lock-uri `lock_cop_*` mai noi de 35 de minute (v4.2 le șterge la final; un lock v4.2 rămas l-ar ignora v4.3 și ar rezulta două rulări pe aceeași conversație). Verificarea se face o dată înainte de backup și încă o dată chiar înainte de copiere.
- Backup-ul e verificat pe hash înainte de a atinge `bin`.
- La orice eroare sau hash GREȘIT după copiere, restaurează automat v4.2 din backup și verifică restaurarea.
```powershell
$ErrorActionPreference = 'Stop'
$bin = 'C:\ProgramData\Gazpet\Paw\bin'; $f = 'C:\Users\Public\livrare\run_paw_v43\docs\paw\run_paw_v43'
$nou = @{ 'run_paw.ps1' = '7A0D7FD92E8D7627EB8F4A6356CC3B8C7B51EF871E6CF7BEB74FE24B051556AC'; 'run_paw.cmd' = '080ED5A3D79EC274A9988B7BEDE2EDA2DAD1A536F2239149A3F5EBA6C9544C63'; 'gemini_pw.py' = '85E6E43874EF1F133CB3A95EB908AEE4E7213335A4B051EA46AA3CBE09107176' }
$v42 = @{ 'run_paw.ps1' = '18BF75BD0938102B772537FC215D55993DF1604F372569ED25A54A4BBFC818F0'; 'run_paw.cmd' = '028110D18B61EFEBDDB1702CFD85161FC4ABE347FA54B82ABE79A3DE3610AE85' }
$data = 'C:\Users\Public\paw-data'
function HashF([string]$p) { if (Test-Path -LiteralPath $p -PathType Leaf) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash } else { 'LIPSA' } }
function RulariActive() {
  # rulari v4.2 in curs: procese ale lansatorului/canalelor + lock-uri cop v4.2 recente (v4.2 le sterge la final; timeout cop 1800 s + 120)
  $p = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'run_paw\.(ps1|cmd)|cgpt_pw\.py|gemini_pw\.py' } | ForEach-Object { "$($_.Name)#$($_.ProcessId)" })
  $l = @(Get-ChildItem -LiteralPath $data -Filter 'lock_cop_*' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-35) } | ForEach-Object { $_.Name })
  if ($p.Count -or $l.Count) { throw ("rulari Paw active (procese: " + ($p -join ', ') + "; lock-uri v4.2 recente: " + ($l -join ', ') + ") - asteapta sa se termine si reia; nimic schimbat") }
}
foreach ($n in $nou.Keys) { if ((HashF (Join-Path $f $n)) -ne $nou[$n]) { throw "sursa s-a schimbat de la pasul 1: $n" } }
foreach ($n in $v42.Keys) { if ((HashF (Join-Path $bin $n)) -ne $v42[$n]) { throw "in bin nu e v4.2 ($n) - ma opresc, nimic schimbat" } }
if (Test-Path -LiteralPath (Join-Path $bin 'gemini_pw.py')) { throw 'gemini_pw.py exista deja in bin - ma opresc, nimic schimbat' }
RulariActive
$vechi = Join-Path $bin ('vechi_v4_2_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $vechi | Out-Null
foreach ($n in $v42.Keys) { Copy-Item -LiteralPath (Join-Path $bin $n) -Destination (Join-Path $vechi $n) }
foreach ($n in $v42.Keys) { if ((HashF (Join-Path $vechi $n)) -ne $v42[$n]) { throw "backup neverificat ($n) - ma opresc, bin neatins" } }
"BACKUP OK: $vechi"
RulariActive   # a doua verificare, chiar inainte de copiere - plasa de siguranta, nu inlocuieste oprirea lansarilor
try {
  foreach ($n in $nou.Keys) { Copy-Item -LiteralPath (Join-Path $f $n) -Destination (Join-Path $bin $n) -Force }
  foreach ($n in $nou.Keys) { $h = HashF (Join-Path $bin $n); if ($h -ne $nou[$n]) { throw "dupa copiere: hash GRESIT la $n ($h)" } }
  'INSTALAT v4.3 OK'
} catch {
  $motiv = $_.Exception.Message
  Write-Warning "instalare esuata ($motiv) - restaurez v4.2 din $vechi"
  foreach ($n in $v42.Keys) { Copy-Item -LiteralPath (Join-Path $vechi $n) -Destination (Join-Path $bin $n) -Force -ErrorAction Continue }
  $g = Join-Path $bin 'gemini_pw.py'; if (Test-Path -LiteralPath $g) { Remove-Item -LiteralPath $g -Force -ErrorAction Continue }
  $rest = @($v42.Keys | Where-Object { (HashF (Join-Path $bin $_)) -ne $v42[$_] })
  if ($rest.Count -gt 0 -or (Test-Path -LiteralPath $g)) { throw "RESTAURARE INCOMPLETA ($($rest -join ', ')) - copiaza manual din $vechi" }
  throw "instalare anulata; v4.2 restaurat si verificat pe hash (motiv: $motiv)"
}
icacls (Join-Path $bin 'gemini_pw.py')
```
Fișierul nou moștenește ACL-ul din `bin` (Users doar citire + execuție) — `icacls` de la final trebuie să arate asta. Rollback manual ulterior: copiezi cele două fișiere din `bin\vechi_v4_2_<data>` peste `bin`, ștergi `bin\gemini_pw.py` și verifici cu `Get-FileHash` față de hash-urile v4.2 de mai sus.

**După instalare — testul de canal (OBLIGATORIU; până la el `gem` refuză).** `run_paw … gem` refuză orice rulare (`PAW_EROARE <id> validare: canal gem nevalidat …`) până există marcajul `C:\Users\Public\paw-data\gem_canal_validat`. Prima lui linie trebuie să fie `CANAL_VALIDAT <SHA-256 al gemini_pw.py instalat> …`, deci o versiune nouă de `gemini_pw.py` cere un test de canal nou. Marcajul îl scrie **doar Răzvan, doar după pașii 4–6 reușiți**; sesiunile Claude nu îl scriu niciodată. Rezidual: `paw-data` e scriibil de Users, deci marcajul e o poartă procedurală legată de hash, nu o barieră de ACL. Pașii 4–6 rulează `gemini_pw.py` direct (fără lansator), ceea ce e sigur aici pentru că, fără marcaj, nicio rulare `gem` prin lansator nu poate porni în paralel.
1. În Edge-ul 9333 de pe server: login o dată pe gemini.google.com, un singur tab Gemini deschis, modelul „Gemini 4 Argon” selectat.
2. Verificare fără trimitere: `& 'C:\Program Files\Python313\python.exe' C:\ProgramData\Gazpet\Paw\bin\gemini_pw.py stare` → `model: Gemini 4 Argon`, `genereaza: False`, `atasamente in ciorna: 0`.
3. Brief de test: `Set-Content -LiteralPath C:\Users\Public\paw-data\brief\gem_canal_test.md -Value 'Raspunde doar: PAW_OK Gemini' -Encoding UTF8`.
4. **Atașamentul (Jakarinos r2 P2b, detectarea nu e validată altfel pe DOM-ul real):** Răzvan pune de mână un fișier mic (de ex. un `.txt`) în ciorna Gemini, fără să trimită. Rulează din nou `gemini_pw.py stare` → trebuie `atasamente in ciorna: 1` (sau mai mult). Dacă arată `0`, selectorii nu se potrivesc cu pagina reală: **STOP**, marcajul nu se scrie, `gem` rămâne refuzat și se cere fix în chat.
5. Cu atașamentul încă în ciornă: `& 'C:\Program Files\Python313\python.exe' C:\ProgramData\Gazpet\Paw\bin\gemini_pw.py trimite C:\Users\Public\paw-data\brief\gem_canal_test.md 120` → ultima linie trebuie să fie `GEM_EROARE ciorna_cu_atasamente …`. Răzvan verifică pe ecran că nu a plecat niciun mesaj (fără Enter). Orice alt rezultat → STOP, ca la pasul 4.
6. Scoate atașamentul de mână; `stare` → `atasamente in ciorna: 0`; aceeași comandă `trimite` → răspunsul conține `PAW_OK Gemini`.
7. Abia acum, marcajul (PowerShell normal): `$g = 'C:\ProgramData\Gazpet\Paw\bin\gemini_pw.py'; "CANAL_VALIDAT $((Get-FileHash -Algorithm SHA256 -LiteralPath $g).Hash) $(Get-Date -Format s) Razvan pasii-4-6" | Set-Content -LiteralPath 'C:\Users\Public\paw-data\gem_canal_validat' -Encoding ASCII`.
8. Test prin lansator: `C:\ProgramData\Gazpet\Paw\bin\run_paw.cmd gem C:\Users\Public\paw-data\brief\gem_canal_test.md C:\Users\Public\paw-data\out\gem_canal_test.log` → `PAW_GATA`.
9. Rândul „run_paw” din `public.automatizari` și secțiunea din `registru_automatizari` se actualizează cu `gem`. Fișa a–e:
   - citește răspunsul Gemini, adică conținut extern;
   - scrie doar fișierul de ieșire;
   - rulează ca utilizatorul serverului, fără service_role;
   - e pornit doar de sesiunile Claude, prin lansator;
   - nicio acțiune automată pe baza răspunsului.
