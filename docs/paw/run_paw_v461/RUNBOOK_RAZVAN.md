# Paw v4.6.1 - doar lista Copilot (cop) - procedura pentru Razvan

Numai operatorul executa pasii. Agentul nu a instalat nimic si nu a cerut elevare.
A = PowerShell 5.1 admin Gazpet-Ai; N = acelasi cont NE-elevat. Orice eroare = STOP.

**Ce se schimba:** numai linia 55 din `run_paw.ps1` (lista `cop`):
`-6ae06a9c` (conv. 5, plina), `+6ae9964e` (conv. 8, chat) si 3 rezerve deschise
pe 03.11: `6ae9a74f`, `6ae9a76d`, `6ae9a789` ("Copilot - rezerva 1/2/3 - 03.11").
Celelalte 11 fisiere sunt copii octet cu octet ale celor instalate acum in `bin`.
`gemini_pw.py` = hash-ul instalat (5D1098D3...), deci markerul Gemini ramane valid.
jak-home ramane (Install rescrie doar config.toml, acelasi continut): fara login nou.
**De ce instalare completa:** hash-ul `run_paw.ps1` este legat in `cdx_sandbox_validat.json`;
orice schimbare cere Install + Run/Seal r6. Pana la Seal, cdx este indisponibil;
jak/cop/gem functioneaza dupa Install.

Blocurile marcate "v46 sect. x" se ruleaza NESCHIMBATE din
`docs/paw/run_paw_v46/RUNBOOK_RAZVAN.md`, in aceeasi consola, dupa preambulul de mai jos
(aceleasi nume de variabile). Hash-urile vin din raportul de review, nu din acest fisier.
Livrare: folderul din commit-ul PR-ului ajunge in `$Source` (ex. `git archive` al commit-ului
aprobat, dezarhivat in `C:\Users\Public\livrare\run_paw_v461`); verificarea de mai jos decide.

## 1. Preambul (A si N)

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v461\docs\paw\run_paw_v461'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$CdxHome = Join-Path $PawRoot 'state\codex-home'
$Stage = 'C:\Users\Public\paw-data\stage-v461'
$Audit = Join-Path $PawRoot 'operator-20261103-v461'
$ManifestHash = 'INLOCUIESTE_CU_HASH_MANIFEST_DIN_RAPORT'
$LegacyHash = 'INLOCUIESTE_CU_HASH_CGPT_PW_DIN_RAPORT'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $LegacyHash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-urile din raport' }
if ((Get-FileHash -LiteralPath "$Source\SHA256.json").Hash -ine $ManifestHash) { throw 'Alt pachet' }
$manifest = Get-Content -LiteralPath "$Source\SHA256.json" -Raw | ConvertFrom-Json
foreach ($e in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $e.Name)).Hash -ine $e.Value) { throw "Hash diferit: $($e.Name)" }
    if ($e.Name -ne 'run_paw.ps1' -and (Get-FileHash -LiteralPath (Join-Path $Bin $e.Name)).Hash -ine $e.Value) { throw "Difera de instalat: $($e.Name)" }
}
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\run_paw.ps1") (Get-Content -LiteralPath "$Source\run_paw.ps1"))
if ($d.Count -ne 2 -or @($d | Where-Object { $_.InputObject -notmatch '^\s+cop\s+= @\{' }).Count) { throw 'Diff run_paw.ps1 nu e doar lista cop' }
$d | Format-List
if ((Get-FileHash -LiteralPath "$Bin\cgpt_pw.py").Hash -ine $LegacyHash) { throw 'cgpt_pw.py schimbat' }
if ((Get-Content 'C:\Users\Gazpet-Ai\AppData\Roaming\npm\node_modules\@openai\codex\package.json' -Raw | ConvertFrom-Json).version -cne '0.162.0') { throw 'Codex npm nu mai e 0.162.0' }
```

Asteptat: diff-ul afiseaza exact doua linii `cop = @{ ...modele = @(...) }` (veche/noua).

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
$B = "C:\Users\Public\paw-data\brief\smoke-v461-$Id.md"
'Raspunde exact: PAW_TEST_OK' | Set-Content -LiteralPath $B -Encoding ASCII
& "$Bin\run_paw.cmd" cop $B "C:\Users\Public\paw-data\out\smoke-v461-cop-$Id.log" 6ae9964e
& "$Bin\run_paw.cmd" cop $B "C:\Users\Public\paw-data\out\smoke-v461-old-$Id.log" 6ae06a9c
& "$Bin\run_paw.cmd" jak $B "C:\Users\Public\paw-data\out\smoke-v461-jak-$Id.log"
& "$Bin\run_paw.cmd" gem $B "C:\Users\Public\paw-data\out\smoke-v461-gem-$Id.log" argon
```

Asteptat (ultima linie din fiecare log): cop 6ae9964e `PAW_GATA`; cop 6ae06a9c
`PAW_EROARE ... model/tinta nepermis(a)`; jak `PAW_GATA`; gem `PAW_GATA`.
Rezervele nu se testeaza acum (test de canal facut la deschidere, 03.11).

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

## Rollback la v4.6

**v46 sect. 8**, cu `$Audit` de mai sus; sectiunea "marker Gemini v45" NU se aplica
(markerul Gemini nu s-a schimbat). Revoke-ul cu receipt-ul nou este no-op la
`added=false` (ACE-ul v4.6 ramane, corect pentru v4.6). Dupa rollback cdx ramane
necertificat pana la un Run/Seal nou.
