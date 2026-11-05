# Paw v4.7 — cxw; instalare numai de Răzvan după review

Agentul nu instalează, nu schimbă ACL/WFP pe server și nu face login.
Pachetul copiază v461; modifică lansatorul/wrapperul/installerul și adaugă
`codexweb_pw.py`. Restul runtime-ului rămâne identic. Modificarea lansatorului
invalidează certificarea cdx: este necesar Install + Run/Seal din procedura r6.

**Limită de validare:** nu a fost disponibil Edge-ul Windows autentificat.
Selectorii de mai jos sunt un contract conservator, încă neverificat pe UI-ul
real Codex. Nu declara canalul utilizabil înainte de probele de acceptanță.
Dacă un selector nu corespunde, canalul refuză sau ajunge la timeout; corectează
pachetul în repo și reia review/hash-urile. Nu relaxa aprobările/finalizarea în bin.

## 1. Pachet revizuit și teste înainte de instalare

A = PowerShell 5.1 admin; N = același cont Gazpet-Ai fără elevare. Orice eroare = STOP.
Extrage commit-ul aprobat într-un director nou. În A și N:

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v47\docs\paw\run_paw_v47'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$CdxHome = Join-Path $PawRoot 'state\codex-home'
$Stage = 'C:\Users\Public\paw-data\stage-v47'
$Audit = Join-Path $PawRoot 'operator-v47'
$ManifestHash = 'INLOCUIESTE_CU_HASH_SHA256_JSON_DIN_RAPORTUL_APROBAT'
$LegacyHash = 'INLOCUIESTE_CU_HASH_CGPT_PW_REVIZUIT_AL_INSTALARII_CURENTE'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $LegacyHash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Lipsesc hash-urile aprobate' }
if ((Get-FileHash -LiteralPath "$Source\SHA256.json").Hash -ine $ManifestHash) { throw 'Alt manifest' }
$manifest = Get-Content -LiteralPath "$Source\SHA256.json" -Raw | ConvertFrom-Json
foreach ($e in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $e.Name)).Hash -ine $e.Value) { throw "Hash diferit: $($e.Name)" }
}
if ((Get-FileHash -LiteralPath "$Bin\cgpt_pw.py").Hash -ine $LegacyHash) { throw 'Helper cop nerevizuit' }
& 'C:\Program Files\Python313\python.exe' -B "$Source\teste\test_codexweb_pw.py"
if ($LASTEXITCODE -ne 0) { throw 'Teste Python eșuate' }
& powershell.exe -NoProfile -File "$Source\teste\test_contract.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Contract PowerShell eșuat' }
& 'C:\Program Files\Python313\python.exe' -c "import importlib.metadata; print(importlib.metadata.version('playwright'))"
```

Playwright trebuie să suporte `Locator.and_`/`or_` (>= 1.34). Nu se instalează
browser nou: se folosește numai Edge existent, port 9333, ascultare exclusiv pe
127.0.0.1/::1. Operatorul verifică login-ul Codex și existența mediului EXACT
`pontaj-pro`. Brief-urile de probă sunt sintetice, fără secrete/date personale.

## 2. Mentenanță, Prepare, Install și recertificare

Folosește [runbook v46](../run_paw_v46/RUNBOOK_RAZVAN.md), cu variabilele v47 de
mai sus. Nu folosi verificarea „doar lista cop” din v461: nu se aplică acestui pachet.

1. v46 secțiunea 1: inventar procese/taskuri/servicii, oprire porniri vechi;
   taburile Edge existente se păstrează. Nu continua cu rulări Paw active.
2. v46 secțiunea 2: retragere certificat sub `install.lock`, arhivă bin și
   `old_bin_hashes.json`, Prepare, eliminarea exclusiv a GUID-urilor WFP Paw.
   Prepare v47 verifică/copiază **13 fișiere runtime + SHA256.json**, inclusiv
   `codexweb_pw.py`; installerul include noul helper în inventarul proceselor.
3. v46 secțiunea 3: Install cu `-LegacyStartsStopped -LegacyHelperSha256 $LegacyHash`,
   verificare hash-uri/ACL/runtime/WFP. Fără `-UseExistingGitCredentialManager`.
   Verifică explicit prezența și hash-ul `bin\codexweb_pw.py`.
4. v46 secțiunile 4–6: login separat numai dacă lipsește, smoke jak și Gemini,
   test de canal Gemini. `gemini_pw.py` este identic cu v461; markerul existent
   legat de același hash nu trebuie inventat/refăcut artificial.
5. Probele cxw din secțiunea 3 de mai jos; apoi v46 secțiunea 7: Run și Seal r6
   pentru noul hash `run_paw.ps1`. Nu copia certificatul vechi peste noul bin.
6. Restabilește numai pornirile oprite în pasul 1, după toate verificările.

## 3. Contract UI și probe de acceptanță (N, supravegheate)

Canalul presupune: `/codex` fără mesaje pentru chat nou, buton exact
`Choose environment`, opțiune cu numele exact `pontaj-pro`, apoi butonul mediului
selectat cu același nume. Composer unic vizibil: textarea sau contenteditable
cu role textbox. Controlul `Approve for me` trebuie să fie vizibil, cu role
switch/checkbox/menuitemcheckbox și `aria-checked="false"`. Lipsă/ON/ambiguu = refuz;
scriptul nu deschide meniuri de aprobare și nu schimbă setarea.

Send are numele exact `Send` sau `Send message`. URL-ul rezultat trebuie să fie
`https://chatgpt.com/codex/tasks/task_<16..64 hex lowercase>`. Alte forme se refuză,
inclusiv URL de chat ChatGPT obișnuit, query, fragment, port, userinfo sau redirect.
Mesajele au `data-message-author-role=user/assistant`. Finalizarea cere o stare
unică vizibilă `data-task-status=completed`, text nou nevid, fără Stop/running/queued,
și observarea execuției după trimitere. Starea veche completed și textul doar stabil
nu produc GATA. Verifică aceste atribute cu inspectorul înainte de proba plătită.

```cmd
run_paw.cmd cxw C:\Users\Public\paw-data\brief\cxw-proba.txt C:\Users\Public\paw-data\out\cxw-proba.log pontaj-pro
run_paw.cmd cxw-continua C:\Users\Public\paw-data\brief\cxw-urmator.txt C:\Users\Public\paw-data\out\cxw-urmator.log https://chatgpt.com/codex/tasks/task_ID_VALID
```

`task_ID_VALID` este un placeholder: copiază URL-ul real, verificat vizual, din prima
rulare. Mesajul de continuare este explicit scris de om; canalul nu formulează răspunsuri.

- Probă normală: cere un răspuns scurt fără modificări în repo; verifică mediul,
  egalitatea textului (inclusiv diacritice/spații), un singur Send, URL și răspuns
  final în log. Ultima linie `PAW_GATA <id> stare=gata`, jurnal Europe/Bucharest.
- ON înainte de lipire, apoi ON între lipire și Send: ambele trebuie să refuze
  fără Send. Testele simulate acoperă cele două cazuri; reproduce-le supravegheat.
- Mediu necunoscut, URL advers, brief în afara brief/out în afara out, UNC/ADS/junction,
  atașamente sau draft vechi: refuz. Nu se suprascrie un draft existent.
- Confirmare publicare/aprobare sau întrebare: fără click/răspuns; logul are URL,
  text disponibil și `PAW_GATA <id> stare=asteapta_confirmare`. Omul decide separat.
  Orice dialog/control de confirmare este tratat conservator ca o cerere umană.
- Două sarcini noi: lansează a doua după evenimentul `trimis` al primei; trebuie să
  urmărească separat două URL-uri. Lock-ul `lock_cxw` se ține doar pe conectarea de
  trimitere și închiderea driverului acesteia, nu pe urmărit. O coliziune scurtă se
  raportează `interactiune_ocupata`, fără așteptare/retry automat. Cop/gem rămân pe
  taburile lor; cxw nu folosește clipboard/tastatură globală, focus/reload/close.
- Timeout de probă: `set PAW_CXW_TIMEOUT_SECONDS=60` înainte de apel (apoi șterge
  variabila cu `set PAW_CXW_TIMEOUT_SECONDS=`). Verifică `PAW_EROARE`, absența tuturor
  copiilor locali Python/Node și menținerea celorlalte rulări. Edge extern rămâne.
  **Sarcina cloud poate continua după oprirea arborelui local**: inspectează URL-ul;
  nu retrimite automat și nu interpreta timeout-ul ca eșec sigur al trimiterii.
- PR: cu un brief autorizat separat care cere PR draft, verifică linkul github.com
  `/owner/repo/pull/număr` în `pr_urls`; canalul însuși nu apasă Create PR/Publish.
- Log: hash SHA256 al textului UTF-8 fără BOM + lungime; brief-ul integral nu apare.
  Răspunsurile sunt JSON pe o singură linie fizică; nu pot falsifica markeri PAW.
  Erorile Playwright brute/stderr nu se persistă. Tokenurile uzuale sunt redactate;
  probele și brief-urile nu trebuie să conțină secrete/date personale.

## 4. Rollback numai la pachetul anterior revizuit

Păstrează arhiva v461/retired bin și hash-urile din pasul 2. În mentenanță, cu
aceleași bariere și porniri oprite, reinstalează pachetul v461 revizuit după
[runbook-ul lui](../run_paw_v461/RUNBOOK_RAZVAN.md), adaptând inventarul la arhiva
salvată, și recertifică cdx pentru hash-urile restaurate. Nu executa automat v46
secțiunea 8 (aceea revine la v45). Nu șterge lock-uri și nu restaura certificat
vechi peste runtime diferit. La stare neclară: lasă cdx necertificat și investighează.
