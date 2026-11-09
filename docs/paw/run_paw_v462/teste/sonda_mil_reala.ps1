# Integrare canal mil (v4.6.2 r2) cu agy.exe REAL, FARA apel de model: copie doar-citire -> probe de scriere -> configuratie ->
# preflight mcp/plugin -> sonda de pornire (stream-json, stdin gol = zero ture) -> curatare. Nu scrie in paw-data si nu ia lock-uri:
# baza copiei = un director temporar. Ruleaza este o varianta minima (fara Job Object): doar pentru aceasta proba.
# Ruleaza: powershell -NoProfile -ExecutionPolicy Bypass -File teste\sonda_mil_reala.ps1
# ASCII only. Compatibil Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$pachet = Split-Path $PSScriptRoot -Parent
. (Join-Path $pachet 'cdx_security.ps1')
. (Join-Path $pachet 'mil.ps1')
$exe = 'C:\Users\Gazpet-Ai\AppData\Local\agy\bin\agy.exe'
if (-not (Test-Path -LiteralPath $exe)) { Write-Host 'agy.exe lipsa: proba omisa'; exit 0 }

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
  if (-not $p.WaitForExit($timeout * 1000)) { $p.Kill(); return @{ timeout = $true; exit = -1; out = ''; err = ''; treeStopped = $true } }
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
  AssertMilConfig $mediu['USERPROFILE'] $cwd; Write-Host 'PASS configuratie (fara hooks / .agents / setari nepermise)'
  AssertMilFaraExtensii $exe $mediu $cwd; Write-Host 'PASS preflight mcp/plugin'
  MilSonda $exe 'claude-sonnet-4-6' $cwd $mediu (Join-Path $jurnale 'sonda.log'); Write-Host 'PASS sonda de pornire (0 hooks, sandbox pornit, mod plan, 0 ture)'
  if (@([IO.Directory]::GetFileSystemEntries($cwd)).Count -ne 1) { throw 'agy a lasat fisiere in copie' }
  Write-Host 'PASS copia neatinsa de agy'
} catch { $rau++; Write-Host ('FAIL ' + $_.Exception.Message) }
finally {
  MilStergeCopie $false
  MilStergeJurnale $jurnale
  Remove-Item -LiteralPath $brief -Force
  if (Test-Path -LiteralPath $baza) { Remove-Item -LiteralPath $baza -Recurse -Force }
}
foreach ($d in $script:MilDiagLinii) { Write-Host $d }
if ($rau) { exit 1 } else { Write-Host 'SONDA mil reala: OK'; exit 0 }
