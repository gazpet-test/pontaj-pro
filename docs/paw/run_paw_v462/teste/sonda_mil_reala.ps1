# Integrare canal mil (v4.6.2 r4) cu agy.exe REAL, FARA apel de model: copie doar-citire -> probe de scriere -> configuratie ->
# preflight mcp/plugin -> sonda de pornire (stream-json, stdin gol = zero ture) -> curatare. Nu scrie in paw-data si nu ia lock-uri:
# baza copiei = un director temporar.
# r4 (Jakarinos r3 P1): scriptul intra in ACELASI Job ca lansatorul (definitia PawV43.Job extrasa prin AST din run_paw.ps1,
# KILL_ON_JOB_CLOSE, inainte de orice copil); la timeout opreste tot arborele prin Job; curatarea (drepturi redate, copie, jurnale,
# baza temporara) se face DOAR cu Job-ul confirmat gol (MilArboreGol), altfel copia ramane doar-citire si proba pica.
# Ruleaza: powershell -NoProfile -ExecutionPolicy Bypass -File teste\sonda_mil_reala.ps1
# ASCII only. Compatibil Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$pachet = Split-Path $PSScriptRoot -Parent
. (Join-Path $pachet 'cdx_security.ps1')
. (Join-Path $pachet 'mil.ps1')
$exe = 'C:\Users\Gazpet-Ai\AppData\Local\agy\bin\agy.exe'
if (-not (Test-Path -LiteralPath $exe)) { Write-Host 'agy.exe lipsa: proba omisa'; exit 0 }

# Job-ul lansatorului: exact Add-Type-ul din run_paw.ps1 (fara a executa lansatorul)
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $pachet 'run_paw.ps1'), [ref]$null, [ref]$null)
$def = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.Extent.Text.StartsWith('Add-Type -Namespace PawV43 -Name Job') }, $true) | Select-Object -First 1
if (-not $def) { throw 'definitia PawV43.Job lipseste din run_paw.ps1' }
if (-not ('PawV43.Job' -as [type])) { . ([scriptblock]::Create($def.Extent.Text)) }
[void][PawV43.Job]::LeagaDeLansator()
if ([PawV43.Job]::Active() -ne 1) { throw 'Job-ul nu contine doar acest proces' }

function Ruleaza([string]$exe, [string[]]$argv, [string]$stdinText, [string]$cwd, [int]$timeout, [hashtable]$env, [bool]$cleanEnvironment = $false, [bool]$trustedArguments = $false, [string]$argumenteGata = '') {
  $psi = New-Object Diagnostics.ProcessStartInfo $exe
  $psi.Arguments = if ($argumenteGata) { $argumenteGata } else { (($argv | ForEach-Object { ArgMil $_ }) -join ' ') }
  $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.WorkingDirectory = $cwd
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $ce = $psi.EnvironmentVariables; $ce.Clear(); foreach ($k in $env.Keys) { $ce[$k] = [string]$env[$k] }
  # ca in Ruleaza din lansator: stdin fara BOM (altfel agy primeste U+FEFF ca prima intrare stream-json)
  $vechi = [Console]::InputEncoding
  try { [Console]::InputEncoding = New-Object Text.UTF8Encoding($false); $p = [Diagnostics.Process]::Start($psi) } finally { [Console]::InputEncoding = $vechi }
  $p.StandardInput.BaseStream.Close()
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeout * 1000)) {
    $oprit = [PawV43.Job]::StopChildren(2000)   # tot arborele din Job, nu doar procesul direct
    return @{ timeout = $true; exit = -1; out = ''; err = ''; treeStopped = $oprit }
  }
  $p.WaitForExit()
  return @{ timeout = $false; exit = $p.ExitCode; out = $o.Result; err = $e.Result }
}

$baza = Join-Path ([PawMilAcl]::Lunga([IO.Path]::GetTempPath())) ('paw-mil-sonda-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$brief = Join-Path ([IO.Path]::GetTempPath()) ('paw-mil-brief-' + [guid]::NewGuid().ToString('N') + '.md')
[IO.File]::WriteAllText($brief, 'Raspunde exact: PAW_TEST_OK')
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$jurnale = Join-Path $baza ($runId + '-agy')
$rau = 0
try {
  AssertMilGazda; AssertMilExe $exe
  $mediu = MilMediu
  $cwd = MilPregatesteCopie $baza $runId $brief @() @()
  MilBlocheazaCopie; AssertMilCopieReadOnly
  Write-Host ('PASS copie doar-citire: ' + $cwd)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  [PawMilAcl]::CreeazaDirector($jurnale, "D:P(A;OICI;FA;;;$sid)(A;OICI;FA;;;SY)")
  AssertMilConfig $mediu['USERPROFILE'] $cwd; Write-Host 'PASS configuratie (fara hooks / personalizari / redirectionari / setari nepermise)'
  AssertMilFaraExtensii $exe $mediu $cwd; Write-Host 'PASS preflight mcp/plugin'
  MilSonda $exe 'claude-sonnet-4-6' $cwd $mediu (Join-Path $jurnale 'sonda.log'); Write-Host 'PASS sonda de pornire (0 hooks, sandbox pornit, mod plan, 0 ture)'
  if (@([IO.Directory]::GetFileSystemEntries($cwd)).Count -ne 1) { throw 'agy a lasat fisiere in copie' }
  Write-Host 'PASS copia neatinsa de agy'
} catch { $rau++; Write-Host ('FAIL ' + $_.Exception.Message) }
finally {
  $gol = $false
  try { $arb = MilArboreGol; $gol = [bool]$arb.gol; if (-not $gol) { Write-Host ('arbore ramas: ' + $arb.ramase) } }
  catch { Write-Host ('verificarea Job-ului a esuat: ' + $_.Exception.Message) }
  MilStergeCopie (-not $gol)
  Remove-Item -LiteralPath $brief -Force
  if ($gol) {
    MilStergeJurnale $jurnale
    if (Test-Path -LiteralPath $baza) { Remove-Item -LiteralPath $baza -Recurse -Force }
    Write-Host 'PASS Job gol confirmat inainte de curatare'
  } else { $rau++; Write-Host ('FAIL arbore neconfirmat oprit: copia ramane doar-citire in ' + $baza + ' (curatare din admin, runbook)') }
}
foreach ($d in $script:MilDiagLinii) { Write-Host $d }
if ($rau) { exit 1 } else { Write-Host 'SONDA mil reala: OK'; exit 0 }
