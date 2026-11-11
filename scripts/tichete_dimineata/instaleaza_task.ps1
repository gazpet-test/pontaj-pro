# instaleaza_task.ps1 — creează (sau înlocuiește) task-ul Windows „Gazpet Tichete dimineata” pe serverul AI.
# L–V 07:30, utilizator Gazpet-Ai (ORCHESTRATORUL; agentul îl pornește orchestratorul sub contul local dedicat din agent.json —
# r5, refuz dacă e același cont), pornire cât mai curând după un start ratat, reîncercare de 3 ori la 30 de minute,
# oprire după 3 ore, o singură instanță. NU rulează task-ul (prima rulare o pornește chat-ul, de preferat cu -Simulare).
# Rulare (PowerShell ca Gazpet-Ai):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tichete_dimineata\instaleaza_task.ps1 [-RepoDir <clonă>] [-Mod Interactiv|Parola] [-Dezinstaleaza]
# -Mod Interactiv (implicit): rulează când Gazpet-Ai e logat (serverul AI stă logat — Edge-ul Paw rulează în sesiunea lui);
#   fără parolă stocată, iar gh / Claude își găsesc credențialele (Credential Manager / DPAPI) ca într-o sesiune normală.
# -Mod Parola: rulează și fără sesiune deschisă; parola se cere interactiv (Get-Credential), nu trece prin linie de comandă / fișiere.
#   (S4U nu e oferit: fără parolă nu are acces la secretele DPAPI ale contului => gh / claude pică.)
param(
  [string]$RepoDir = '',
  [string]$Utilizator = "$env:COMPUTERNAME\Gazpet-Ai",
  [ValidateSet('Interactiv', 'Parola')][string]$Mod = 'Interactiv',
  [switch]$Dezinstaleaza
)
$ErrorActionPreference = 'Stop'
$Nume = 'Gazpet Tichete dimineata'
Import-Module (Join-Path $PSScriptRoot 'tichete_lib.psm1') -Force

if ($Dezinstaleaza) {
  if (Get-ScheduledTask -TaskName $Nume -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Nume -Confirm:$false
    Write-Host "Task-ul '$Nume' a fost sters."
  } else { Write-Host "Task-ul '$Nume' nu exista." }
  exit 0
}

if (-not $RepoDir) { $RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$Script = Join-Path $RepoDir 'scripts\tichete_dimineata\tichete_dimineata.ps1'
if (-not (Test-Path -LiteralPath $Script -PathType Leaf)) { throw "nu gasesc $Script" }
if ($RepoDir -match '\s') { throw "RepoDir nu are voie sa contina spatii: $RepoDir" }
# P1 r3 (r4): bariera de identitate GitHub e condiție de INSTALARE. Fără agent.json + token în %USERPROFILE%\.tichete-agent\
# și fără verificarea live (aceeași ca la fiecare pornire: tichete_dimineata.ps1 -DoarVerificare) task-ul NU se instalează.
$Lansator = Join-Path $RepoDir 'scripts\tichete_dimineata\lanseaza_agent.ps1'
if (-not (Test-Path -LiteralPath $Lansator -PathType Leaf)) { throw "nu gasesc $Lansator" }
$Cai = Get-CaiAgent $env:USERPROFILE
$cfgT = Test-ConfigAgent $(if (Test-Path -LiteralPath $Cai.config -PathType Leaf) { [IO.File]::ReadAllText($Cai.config) } else { '' })
if (-not $cfgT.ok) { throw ('lipseste dovada barierei (' + $Cai.config + '): ' + (@($cfgT.motive) -join '; ') + ' - vezi README, „Bariera de identitate”') }
$tok = if (Test-Path -LiteralPath $Cai.token -PathType Leaf) { ([IO.File]::ReadAllText($Cai.token)).Trim() } else { '' }
if (-not (Test-FormaTokenAgent $tok)) { throw ('lipseste tokenul agentului (' + $Cai.token + ') - vezi README, „Bariera de identitate”') }
$tok = $null
# r5 (P1): contul Windows comun = condiție de instalare. Task-ul rulează ORCHESTRATORUL sub $Utilizator (coordonatorul: pgpass,
# gh, raport); agentul rulează sub contul local DEDICAT din agent.json (cont_windows). Același cont (nume sau SID) => refuz.
$contAg = [string]$cfgT.cfg.cont_windows
$numeTask = ($Utilizator -split '\\')[-1]
if ($contAg -ieq $numeTask -or $contAg -ieq $env:USERNAME) { throw ('agentul ar rula sub acelasi cont Windows ca orchestratorul (' + $contAg + ') - vezi README, „Contul Windows al agentului”') }
try {
  $sidTask = (New-Object Security.Principal.NTAccount($Utilizator)).Translate([Security.Principal.SecurityIdentifier]).Value
  $sidAg = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $contAg)).Translate([Security.Principal.SecurityIdentifier]).Value
} catch { throw ('contul task-ului sau contul agentului nu exista: ' + $_.Exception.Message) }
if ($sidTask -ceq $sidAg) { throw 'agentul ar rula sub acelasi cont Windows ca orchestratorul (acelasi SID)' }
if ($sidTask -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw ('instaleaza_task.ps1 se ruleaza ca ' + $Utilizator + ' (contul coordonatorului, care tine agent.json si parola agentului)') }
if (-not (Test-Path -LiteralPath $Cai.cont -PathType Leaf)) { throw ('lipseste ' + $Cai.cont + ' (parola contului agentului, Export-Clixml) - vezi README') }
# lista închisă a agentului trebuie să treacă și aici (aceeași ca la fiecare lansare)
[void](Get-ArgvAgent -Numar 'TKT-2026-0001' -Branch 'tichete/tkt-2026-0001-i1' -Effort 'high' -Setari (Get-CaiRadacinaAgent $cfgT.cfg.radacina_agent).fisSetari)
# bariera completă cu -Instalare: ruleset-urile (forma canonică, cu tokenul agentului) + bypass_actors citit cu identitatea
# coordonatorului + scrierea amprentei + proba contului Windows al agentului (sub contul lui)
$v = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Script -RepoDir $RepoDir -DoarVerificare -Instalare
$codV = $LASTEXITCODE
$v | ForEach-Object { Write-Host $_ }
if ($codV -ne 0) { throw 'bariera de identitate GitHub / contul Windows al agentului nu trec - task-ul nu se instaleaza (vezi mesajul de mai sus si README)' }

$actiune = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Script + '" -RepoDir "' + $RepoDir + '"') `
  -WorkingDirectory $RepoDir
# 07:30 = rularea; 08:00 / 08:30 / 09:00 = reîncercările (Task Scheduler repornește la „RestartCount” doar dacă task-ul nu
# pornește, nu și la exit != 0). Scriptul iese imediat dacă azi există deja o rulare OK; IgnoreNew împiedică suprapunerea.
$zile = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
$declansator = @('07:30', '08:00', '08:30', '09:00') | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $zile -At $_ }
$setari = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$logon = if ($Mod -eq 'Parola') { 'Password' } else { 'Interactive' }
$principal = New-ScheduledTaskPrincipal -UserId $Utilizator -LogonType $logon -RunLevel Limited

$task = New-ScheduledTask -Action $actiune -Trigger $declansator -Settings $setari -Principal $principal `
  -Description 'Tichete 🐛/💡 din ERP -> lanseaza_agent.ps1 (lista inchisa, identitate GitHub separata) -> PR DRAFT -> review Jakarinos + Fable -> raport cu recomandare. Faza 1: FARA merge, fara inchidere de tichete. Raport: C:\Users\Public\paw-data\out\tichete_<data>.md. Detalii: scripts\tichete_dimineata\README.md'

if (Get-ScheduledTask -TaskName $Nume -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $Nume -Confirm:$false }
if ($Mod -eq 'Interactiv') {
  Register-ScheduledTask -TaskName $Nume -InputObject $task | Out-Null
} else {
  $cred = Get-Credential -UserName $Utilizator -Message "Parola contului $Utilizator pentru task-ul '$Nume'"
  Register-ScheduledTask -TaskName $Nume -InputObject $task -User $Utilizator -Password $cred.GetNetworkCredential().Password | Out-Null
}
Get-ScheduledTask -TaskName $Nume | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "Instalat. NU a fost pornit. Test manual: Start-ScheduledTask -TaskName '$Nume' (sau scriptul direct cu -Simulare)."
