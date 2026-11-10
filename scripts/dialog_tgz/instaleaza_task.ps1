# instaleaza_task.ps1 - inlocuieste actiunea sarcinii existente "Gazpet Dialog TGZ" cu varianta B.
# Implicit doar AFISEAZA ce ar face (previzualizare). Scrie numai cu -Aplica.
# Ce face cu -Aplica:
#   1. exporta definitia curenta a sarcinii in <Destinatie>\backup_task_<data>.xml (revenire: Register-ScheduledTask -Xml);
#   2. copiaza dialog_tgz.ps1, DialogTgz.psm1, dialog_tgz_prompt.md, raspuns_schema.json si
#      sql\*.sql in <Destinatie> (r4: un vocabular_nota.txt vechi se sterge; schema instalata se verifica) (fisierele vechi
#      din C:\Users\Gazpet-Ai\claude-tasks\dialog_tgz.ps1 / dialog_tgz_prompt.md NU se ating);
#   3. Set-ScheduledTask pe sarcina EXISTENTA: actiunea noua, declansatori L-V 10:40 si 16:40, StartWhenAvailable,
#      2 reincercari la 30 min, limita 1 h, fara instante paralele. Utilizatorul (principal) ramane cel existent.
# Nu creeaza sarcina daca lipseste, nu o porneste, nu scrie tokenul, nu atinge BD, nu creeaza cursorul
# (paw-data\out\dialog_tgz_cursor.txt il scrie chat-ul la instalare, vezi README).
# Fisier ASCII (PowerShell 5.1).

[CmdletBinding()]
param(
  [string]$NumeTask = 'Gazpet Dialog TGZ',
  [string]$Destinatie = 'C:\Users\Gazpet-Ai\claude-tasks\dialog_tgz_b',
  [switch]$Aplica
)
$ErrorActionPreference = 'Stop'

$sursa = $PSScriptRoot
$fisiere = @('dialog_tgz.ps1', 'DialogTgz.psm1', 'dialog_tgz_prompt.md', 'raspuns_schema.json', 'sql\context_agregat.sql')
foreach ($f in $fisiere) { if (-not (Test-Path -LiteralPath (Join-Path $sursa $f) -PathType Leaf)) { throw "lipseste din repo: $f" } }

$task = Get-ScheduledTask -TaskName $NumeTask -ErrorAction SilentlyContinue
if ($null -eq $task) { throw "sarcina '$NumeTask' nu exista; acest script doar inlocuieste actiunea uneia existente" }

$script = Join-Path $Destinatie 'dialog_tgz.ps1'
$actiune = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $script) -WorkingDirectory $Destinatie
$zile = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
$declansatori = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $zile -At '10:40'),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $zile -At '16:40')
)
$setari = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

Write-Host "Sarcina: $NumeTask (utilizator: $($task.Principal.UserId), stare: $($task.State))"
Write-Host 'Actiuni curente:'
foreach ($a in $task.Actions) { Write-Host ("  {0} {1}" -f $a.Execute, $a.Arguments) }
Write-Host 'Actiune noua:'
Write-Host ("  powershell.exe {0}" -f $actiune.Arguments)
Write-Host 'Declansatori noi: L-V 10:40 si 16:40; StartWhenAvailable; 2 reincercari la 30 min; limita 1 h; IgnoreNew'
Write-Host "Fisiere copiate in: $Destinatie"
foreach ($f in $fisiere) { Write-Host "  $f" }

if (-not $Aplica) {
  Write-Host ''
  Write-Host 'PREVIZUALIZARE - nimic nu s-a schimbat. Ruleaza din nou cu -Aplica dupa acordul lui Razvan.'
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $Destinatie 'sql'))) { [void](New-Item -ItemType Directory -Path (Join-Path $Destinatie 'sql') -Force) }
$backup = Join-Path $Destinatie ('backup_task_{0}.xml' -f (Get-Date).ToString('yyyyMMdd_HHmmss'))
Export-ScheduledTask -TaskName $NumeTask -TaskPath $task.TaskPath | Out-File -LiteralPath $backup -Encoding unicode
Write-Host "Backup definitie veche: $backup"

foreach ($f in $fisiere) { Copy-Item -LiteralPath (Join-Path $sursa $f) -Destination (Join-Path $Destinatie $f) -Force }
# r4: vocabularul notei e retras; o copie veche nu mai e citita, dar se scoate ca sa nu para activa
$vechi = Join-Path $Destinatie 'vocabular_nota.txt'
if (Test-Path -LiteralPath $vechi -PathType Leaf) { Remove-Item -LiteralPath $vechi -Force; Write-Host 'vocabular_nota.txt vechi (r3) sters din destinatie' }
# verificare pe configuratia INSTALATA: schema copiata se incarca cu modulul copiat (r5: amprenta fixata in modul,
# versiunea 3, fara nicio "nota")
Import-Module (Join-Path $Destinatie 'DialogTgz.psm1') -Force
[void](Read-SchemaRaspuns (Join-Path $Destinatie 'raspuns_schema.json'))
Write-Host 'Schema instalata verificata: amprenta din modul, versiunea 3, fara camp de text liber'

[void](Set-ScheduledTask -TaskName $NumeTask -TaskPath $task.TaskPath -Action $actiune -Trigger $declansatori -Settings $setari)
$dupa = Get-ScheduledTask -TaskName $NumeTask -TaskPath $task.TaskPath
Write-Host ("Aplicat. Actiune: {0} {1}" -f $dupa.Actions[0].Execute, $dupa.Actions[0].Arguments)
Write-Host ("Declansatori: {0}" -f (($dupa.Triggers | ForEach-Object { $_.StartBoundary }) -join ', '))
Write-Host 'Sarcina NU a fost pornita. Test manual: Start-ScheduledTask, apoi C:\Users\Public\paw-data\out\dialog_tgz_ultima.txt'
