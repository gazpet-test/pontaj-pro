# Paw v4.6.2 - canalul mil (Miloi = Antigravity CLI, agy) - procedura pentru Razvan

Numai operatorul executa pasii. Agentul nu a instalat nimic si nu a cerut elevare.
A = PowerShell 5.1 admin Gazpet-Ai; N = acelasi cont NE-elevat. Orice eroare = STOP.

**Ce se schimba (fata de v4.6.1 instalat):**
- `run_paw.ps1`: canalul `mil` (TOOLS, validare, ramura de rulare, refuzurile `mil_exit_*` / `mil_raspuns_gol`) si
  un parametru optional nou in `Ruleaza` (`$argumenteGata`, folosit doar de mil); restul liniilor identice;
- `mil.ps1`: fisier NOU (plan + sandbox fixe, mediu curat, fara MCP/pluginuri, semnatura Google pe agy.exe);
- `install.ps1`: doar lista `$files` (+ `mil.ps1`).
Celelalte 10 fisiere sunt copii octet cu octet ale celor instalate acum in `bin` (v4.6.1).
Miloi primeste sarcini DOAR de la chat (decizia Razvan 09.11.2026, claude_context #1929); nu intra in automatizarile ERP.
`gemini_pw.py` = hash-ul instalat (5D1098D3...), deci markerul Gemini ramane valid.
jak-home ramane (Install rescrie doar config.toml, acelasi continut): fara login nou.
**De ce instalare completa:** hash-ul `run_paw.ps1` este legat in `cdx_sandbox_validat.json`;
orice schimbare cere Install + Run/Seal r6. Pana la Seal, cdx este indisponibil;
jak/cop/gem functioneaza dupa Install.

Blocurile marcate "v46 sect. x" se ruleaza NESCHIMBATE din
`docs/paw/run_paw_v46/RUNBOOK_RAZVAN.md`, in aceeasi consola, dupa 1a (si 1b, o singura data,
inainte de instalare); aceleasi nume de variabile. Hash-urile vin din raportul de review, nu din acest fisier.
Livrare: folderul din commit-ul PR-ului ajunge in `$Source` (ex. `git archive` al commit-ului
aprobat, dezarhivat in `C:\Users\Public\livrare\run_paw_v462`); verificarea de mai jos decide.

## 1a. Variabile (A si N, in orice consola noua, inclusiv la rollback)

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v462\docs\paw\run_paw_v462'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$CdxHome = Join-Path $PawRoot 'state\codex-home'
$Stage = 'C:\Users\Public\paw-data\stage-v462'
$Audit = Join-Path $PawRoot 'operator-AAAALLZZ-v462'   # inlocuieste AAAALLZZ cu data instalarii
$ManifestHash = 'INLOCUIESTE_CU_HASH_MANIFEST_DIN_RAPORT'
$LegacyHash = 'INLOCUIESTE_CU_HASH_CGPT_PW_DIN_RAPORT'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
```

## 1b. Verificari inainte de instalare (A, o data, inainte de pasul 2; NU dupa Install, NU la rollback)

Dupa Install `bin\run_paw.ps1` = cel nou, deci comparatia de mai jos ar pica; nu o relua.
Blocul defineste si `$manifest`, folosit de v46 sect. 2.

```powershell
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $LegacyHash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-urile din raport' }
if ((Get-FileHash -LiteralPath "$Source\SHA256.json").Hash -ine $ManifestHash) { throw 'Alt pachet' }
$manifest = Get-Content -LiteralPath "$Source\SHA256.json" -Raw | ConvertFrom-Json
foreach ($e in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $e.Name)).Hash -ine $e.Value) { throw "Hash diferit: $($e.Name)" }
    if ($e.Name -notin @('run_paw.ps1','install.ps1','mil.ps1') -and (Get-FileHash -LiteralPath (Join-Path $Bin $e.Name)).Hash -ine $e.Value) { throw "Difera de instalat: $($e.Name)" }
}
if (Test-Path -LiteralPath "$Bin\mil.ps1") { throw 'mil.ps1 exista deja in bin' }
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\install.ps1") (Get-Content -LiteralPath "$Source\install.ps1"))
if ($d.Count -ne 2 -or @($d | Where-Object { $_.InputObject -notmatch '^\$files=@\(' }).Count) { throw 'Diff install.ps1 nu e doar lista $files' }
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\run_paw.ps1") (Get-Content -LiteralPath "$Source\run_paw.ps1"))
$d | Format-List   # de citit: doar liniile mil + Ruleaza($argumenteGata), ca in diff-ul din PR
if ((Get-FileHash -LiteralPath "$Bin\cgpt_pw.py").Hash -ine $LegacyHash) { throw 'cgpt_pw.py schimbat' }
if ((Get-Content 'C:\Users\Gazpet-Ai\AppData\Roaming\npm\node_modules\@openai\codex\package.json' -Raw | ConvertFrom-Json).version -cne '0.162.0') { throw 'Codex npm nu mai e 0.162.0' }
```

Asteptat: install.ps1 = doar linia `$files` (+ `mil.ps1`); run_paw.ps1 = exact diff-ul din PR (mil + `Ruleaza`).

## 2. Mentenanta (A)

Ruleaza inventarul din **v46 sect. 1** (procese/taskuri/servicii). Daca nu ruleaza niciun Paw,
dezactiveaza taskul `Edge CDP 9333 Copilot (Gazpet)` ca in v46 sect. 1. Taskul este "Ready":
Edge-ul pornit deja NU se inchide, taburile Copilot raman. Noteaza starile initiale.

## 3. Arhiva, Prepare, WFP vechi, Install (A)

1. **v46 sect. 2** integral: marker cdx retras in `$Audit`, `old_bin_hashes.json`, Prepare,
   apoi eliminarea celor trei GUID-uri WFP Paw cu helperul copiat in `$Audit`.
2. **v46 sect. 3** integral (Install cu `-LegacyStartsStopped -LegacyHelperSha256 $LegacyHash`,
   fara `-UseExistingGitCredentialManager`). Asteptat: `Installed, NOT certified`,
   versiune 0.162.0, marker `False`.
3. **v46 sect. 3a**: Grant engine cu receipt NOU in `$Audit`. Asteptat `state=granted`,
   `added=false` (ACE-ul din v4.6 ramane). Apoi verificarea N `GetCdxBinding` din acelasi pas.

## 4. Smoke prin lansator (N)

```powershell
$Id = Get-Date -Format 'yyyyMMdd-HHmmss'
$B = "C:\Users\Public\paw-data\brief\smoke-v462-$Id.md"
'Raspunde exact: PAW_TEST_OK' | Set-Content -LiteralPath $B -Encoding ASCII
& "$Bin\run_paw.cmd" cop $B "C:\Users\Public\paw-data\out\smoke-v462-cop-$Id.log" 6ae9964e
& "$Bin\run_paw.cmd" cop $B "C:\Users\Public\paw-data\out\smoke-v462-old-$Id.log" 6ae06a9c
& "$Bin\run_paw.cmd" jak $B "C:\Users\Public\paw-data\out\smoke-v462-jak-$Id.log"
& "$Bin\run_paw.cmd" gem $B "C:\Users\Public\paw-data\out\smoke-v462-gem-$Id.log" argon
```

Asteptat (ultima linie din fiecare log): cop 6ae9964e `PAW_GATA`; cop 6ae06a9c
`PAW_EROARE ... model/tinta nepermis(a)`; jak `PAW_GATA`; gem `PAW_GATA`.

**Testul de canal mil (N, dupa smoke-ul de mai sus; consuma o cerere din contul Antigravity):**

```powershell
& "$Bin\run_paw.cmd" mil $B "C:\Users\Public\paw-data\out\smoke-v462-mil-$Id.log"
& "$Bin\run_paw.cmd" mil $B "C:\Users\Public\paw-data\out\smoke-v462-mil-neg-$Id.log" gemini-3.8-flash-thinking
```

Asteptat: primul `PAW_GATA` (raspunsul contine PAW_TEST_OK); al doilea `PAW_EROARE ... model/tinta nepermis(a)`.
`mil_extensii_refuzate` = cineva a adaugat MCP/pluginuri in agy: STOP (nu se ocoleste din lansator).
`mil_semnatura_invalida` / `mil_semnatar_neasteptat` = agy.exe nu mai e cel semnat de Google: STOP.

## 5. Recertificare cdx (A, apoi N)

**v46 sect. 7, sect. 7a, sect. 7b** neschimbate: Run r6 nou, review `admin_review.json` (20 intrari,
exceptia DNS #031 si riscul parent apply_patch #032), Seal in max 24h, smoke cdx.
Asteptat schema 7 / r6 / PASS / 20. Nu reutiliza `certificate-retired.json`.

## 6. Final (A)

Reactiveaza numai taskurile notate la pasul 2 (`Enable-ScheduledTask`). In N:

```powershell
& 'C:\Program Files\Python313\python.exe' "$Bin\cgpt_pw.py" taburi
Get-Content -LiteralPath 'C:\Users\Public\cgpt_pw_out.txt'
```

Taburile 6ae06a05, 6ae06a54, 6ae9964e si cele 3 rezerve trebuie sa fie deschise
(lipsa unui tab = deschizi URL-ul conversatiei, fara reload la celelalte).

## Rollback la v4.6.1 (NU v46 sect. 8)

v46 sect. 8 era pentru v45: sterge filtrele WFP si retrage markerul Gemini. Aici nu:
`cdx_wfp.ps1`/`cdx_wfp.cs` si `gemini_pw.py` sunt identice in v4.6.1 si v4.6.2, deci filtrele
WFP instalate la pasul 3 si markerul Gemini raman valabile pentru v4.6.1. Rollback-ul este
doar swap-ul de `bin`, fara RemoveCdxWfp, fara Revoke engine, fara mutarea markerului Gemini.
`paw-data\lock_mil` poate ramane (fisier gol, fara efect in v4.6.1).

```powershell
# A, proces nou, numai dupa 1a (variabilele); 1b NU se ruleaza la rollback
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
$paths = Get-Content -LiteralPath "$Audit\install_paths.json" -Raw | ConvertFrom-Json
$RetiredBin = [IO.Path]::GetFullPath([string]$paths.retired_bin)
if ((Split-Path $RetiredBin -Parent) -ine $PawRoot -or (Split-Path $RetiredBin -Leaf) -notmatch '^bin-retired-\d{8}-\d{6}-\d{4}$') { throw 'Tinta rollback invalida' }
[void](AssertCdxPath $RetiredBin)
$barrier = OpenCdxInstallBarrier $true
try {
    $marker = Join-Path $Bin 'cdx_sandbox_validat.json'
    if (Test-Path -LiteralPath $marker) {
        AssertCdxSingleFile $marker; AssertCdxAdminAcl $marker
        Move-Item -LiteralPath $marker -Destination ("$Audit\certificate-v462-retired-" + [guid]::NewGuid().ToString('N') + '.json')
    }
    if (Test-Path -LiteralPath "$RetiredBin\cdx_sandbox_validat.json") { throw 'Marker in bin vechi; nu restaura automat' }
    AssertCdxAdminAcl $RetiredBin
    AssertCdxHashes (GetCdxTreeHashes $RetiredBin) (Get-Content -LiteralPath "$Audit\old_bin_hashes.json" -Raw | ConvertFrom-Json)
    $FailedBin = Join-Path $PawRoot ('bin-audit-rollback-' + [guid]::NewGuid().ToString('N'))
    if ([IO.Path]::GetFullPath($Bin) -ine 'C:\ProgramData\Gazpet\Paw\bin') { throw 'Cale bin invalida' }
    Move-Item -LiteralPath $Bin -Destination $FailedBin
    try { Move-Item -LiteralPath $RetiredBin -Destination $Bin }
    catch { Move-Item -LiteralPath $FailedBin -Destination $Bin; throw }
} finally { $barrier.Dispose() }
```

Apoi in N, proces nou, dupa 1a: blocul `GetCdxBinding` din v46 sect. 3a (trebuie sa treaca:
WFP-ul si grant-ul engine au ramas), apoi smoke-ul v4.6.1 (dupa rollback, `mil` nu mai exista):

```powershell
$Id = Get-Date -Format 'yyyyMMdd-HHmmss'
$B = "C:\Users\Public\paw-data\brief\smoke-v461-rollback-$Id.md"
'Raspunde exact: PAW_TEST_OK' | Set-Content -LiteralPath $B -Encoding ASCII
& "$Bin\run_paw.cmd" jak $B "C:\Users\Public\paw-data\out\smoke-v461-rb-jak-$Id.log"
& "$Bin\run_paw.cmd" gem $B "C:\Users\Public\paw-data\out\smoke-v461-rb-gem-$Id.log" argon
& "$Bin\run_paw.cmd" mil $B "C:\Users\Public\paw-data\out\smoke-v461-rb-mil-$Id.log"
```

Asteptat: jak `PAW_GATA`; gem `PAW_GATA`; mil `PAW_EROARE ... cine necunoscut 'mil'`.
Dupa rollback cdx ramane NECERTIFICAT: `certificate-retired.json` din `$Audit` nu se
restaureaza automat; Run/Seal nou (v46 sect. 7) sau decizie separata cu review.

**Install esuat la pasul 3.2:** installerul reface singur swap-ul si sterge filtrul pe care
l-a pus, deci `bin` ramane v4.6.1, dar filtrele WFP Paw lipsesc (scoase la 3.1) si cdx e
indisponibil; jak/cop/gem merg (nu depind de WFP). STOP, pastreaza `$Audit\install.log`,
fara reincercari improvizate.
