# instaleaza_task.ps1 — creează (sau înlocuiește) task-ul Windows „Gazpet Tichete dimineata” pe serverul AI.
# L–V 07:30, utilizator Gazpet-Ai, pornire cât mai curând după un start ratat, reîncercare de 3 ori la 30 de minute,
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
  -Description 'Tichete 🐛/💡 din ERP -> rdr (cont redari@) -> review Jakarinos + Fable -> merge automat doar in limite. Raport: C:\Users\Public\paw-data\out\tichete_<data>.md. Detalii: scripts\tichete_dimineata\README.md'

if (Get-ScheduledTask -TaskName $Nume -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $Nume -Confirm:$false }
if ($Mod -eq 'Interactiv') {
  Register-ScheduledTask -TaskName $Nume -InputObject $task | Out-Null
} else {
  $cred = Get-Credential -UserName $Utilizator -Message "Parola contului $Utilizator pentru task-ul '$Nume'"
  Register-ScheduledTask -TaskName $Nume -InputObject $task -User $Utilizator -Password $cred.GetNetworkCredential().Password | Out-Null
}
Get-ScheduledTask -TaskName $Nume | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host "Instalat. NU a fost pornit. Test manual: Start-ScheduledTask -TaskName '$Nume' (sau scriptul direct cu -Simulare)."
