# instaleaza.ps1 - instaleaza / dezinstaleaza supervizorul puntilor Remote Control v2 pe serverul Gazpet-Claude (08.11.2026, Rocky/redari@).
# CERE ADMIN (scrie in C:\ProgramData\Gazpet\Punti si creeaza sarcina Windows). Il ruleaza chat-ul / Razvan, NU Rocky.
#
# Instalare (din PowerShell "Run as Administrator", din clona actualizata pe main):
#   powershell -NoProfile -ExecutionPolicy Bypass -File <clona>\scripts\server\punti\instaleaza.ps1
#     1. copiaza punti_lib.ps1, punti_remote_control.ps1, punte_releu.ps1 in C:\ProgramData\Gazpet\Punti
#        (ACL strict: SYSTEM + Administrators = control total, Gazpet-Ai = doar citire/executie; verificat dupa copiere);
#        NU in Paw\bin: instalatorul Paw inlocuieste tot folderul bin la fiecare versiune si ar sterge fisierele puntilor;
#     2. creeaza sarcina "Punti Remote Control (Gazpet)": la logarea Gazpet-Ai (+1 min) si la fiecare 5 minute,
#        cont Gazpet-Ai, interactiv, fara drepturi ridicate, fara fereastra (conhost --headless), o singura instanta;
#     3. dezactiveaza (nu sterge) cele 4 sarcini vechi "Claude Remote Control (Gazpet)*" si redenumeste scriptul v1
#        din paw-data\punti, ca sa nu porneasca nimeni dubluri; noteaza tot in instalare.json pentru dezinstalare;
#     4. porneste sarcina o data. Puntile pornite pe calea veche RAMAN pornite (supervizorul nu face dubluri);
#        v2 le preia pe rand, cand cad singure, sau toate la urmatoarea logare / repornire a serverului.
#   -PreiaAcum: in plus opreste ACUM puntile vechi (v1 + bucla cmd) si lasa v2 sa le porneasca in ~1 minut.
#        ATENTIE: inchide sesiunile care ruleaza pe ele (inclusiv pe cea din care se lucreaza) -> doar cu acordul lui Razvan.
#        Procesele din care ruleaza chiar instalatorul (stramosii lui) NU se opresc; raman pana cad singure.
#
# Dezinstalare:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <clona>\scripts\server\punti\instaleaza.ps1 -Dezinstaleaza [-OpresteSiPuntile]
#     sterge sarcina noua, reactiveaza sarcinile vechi dezactivate de instalare, pune la loc scriptul v1, sterge C:\ProgramData\Gazpet\Punti.
#     -OpresteSiPuntile: opreste si puntile v2 (verificat: PID + ora pornirii) si porneste imediat sarcinile vechi.
#     Fara el, puntile v2 merg pana cad singure; la urmatoarea logare pornesc sarcinile vechi.
# Fisier ASCII (Windows PowerShell 5.1).
param(
  [switch]$Dezinstaleaza,
  [switch]$PreiaAcum,
  [switch]$OpresteSiPuntile,
  [string]$Destinatie = 'C:\ProgramData\Gazpet\Punti',
  [string]$Utilizator = 'Gazpet-Ai'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'punti_lib.ps1')

$Fisiere = @('punti_lib.ps1', 'punti_remote_control.ps1', 'punte_releu.ps1')
$Cont = "$env:COMPUTERNAME\$Utilizator"
$DirStareUtil = "C:\Users\$Utilizator\AppData\Local\Gazpet\punti"
$DirJurnal = 'C:\Users\Public\paw-data\punti'
$Jurnal = Join-Path $DirJurnal 'punti.log'
$V1 = Join-Path $DirJurnal 'punti_remote_control.ps1'
$V1Dezactivat = Join-Path $DirJurnal 'punti_remote_control.v1.dezactivat.txt'
$Evidenta = Join-Path $Destinatie 'instalare.json'

function Spune([string]$M) {
  Write-Output $M
  try { if (Test-Path -LiteralPath $DirJurnal) { Write-Jurnal $Jurnal "[instalare] $M" } } catch { }
}

# --- verificari comune -----------------------------------------------------------------------------------------------------
$eu = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$eu).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'REFUZ: ruleaza din PowerShell deschis ca Administrator (Run as Administrator).'
}
if ($Destinatie -notmatch '^C:\\ProgramData\\Gazpet\\[A-Za-z0-9._-]+$') { throw 'REFUZ: destinatia trebuie sa fie C:\ProgramData\Gazpet\<nume>' }
if ($Utilizator -notmatch '^[A-Za-z0-9._-]{1,20}$') { throw 'REFUZ: nume de utilizator invalid' }
$SidUtil = (New-Object Security.Principal.NTAccount($Cont)).Translate([Security.Principal.SecurityIdentifier]).Value
$SidSystem = 'S-1-5-18'
$SidAdmin = 'S-1-5-32-544'

function Test-FaraReparse([string]$Cale) {
  $rad = [IO.Path]::GetPathRoot($Cale)
  $cur = $rad
  foreach ($parte in ($Cale.Substring($rad.Length) -split '\\' | Where-Object { $_ })) {
    $cur = Join-Path $cur $parte
    if (Test-Path -LiteralPath $cur) {
      $it = Get-Item -LiteralPath $cur -Force
      if ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "REFUZ: junction/symlink pe cale: $cur" }
    }
  }
}

function Set-AclStrict([string]$Dir) {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $inh = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $prop = [Security.AccessControl.PropagationFlags]::None
  foreach ($r in @(@($SidSystem, 'FullControl'), @($SidAdmin, 'FullControl'), @($SidUtil, 'ReadAndExecute, Synchronize'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($r[0])
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]$r[1], $inh, $prop, 'Allow')))
  }
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($SidAdmin)))
  Set-Acl -LiteralPath $Dir -AclObject $acl
}

# ACL acceptat: exact SYSTEM, Administrators (orice drept) si Gazpet-Ai fara niciun drept de scriere; proprietar = Administrators/SYSTEM.
function Test-AclStrict([string]$Cale) {
  $acl = Get-Acl -LiteralPath $Cale          # arunca daca nu se poate citi -> instalarea se opreste
  $ow = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
  if (@($SidAdmin, $SidSystem) -notcontains $ow) { throw "REFUZ: proprietar neasteptat pe ${Cale}: $($acl.Owner)" }
  $scriere = [long](2 + 4 + 16 + 64 + 256 + 65536 + 262144 + 524288 + 0x10000000 + 0x40000000)  # write/append/ea/delete/attr/dac/owner/generic
  $vazut = @{}
  foreach ($r in $acl.Access) {
    $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if (@($SidSystem, $SidAdmin, $SidUtil) -notcontains $sid) { throw "REFUZ: ACL neasteptat pe ${Cale}: $($r.IdentityReference)" }
    if ($sid -eq $SidUtil -and $r.AccessControlType -eq 'Allow' -and (([long]$r.FileSystemRights) -band $scriere) -ne 0) {
      throw "REFUZ: $Utilizator poate scrie in $Cale"
    }
    $vazut[$sid] = $true
  }
  if ($vazut.Count -ne 3) { throw "REFUZ: ACL pe $Cale nu are exact cei trei principali (SYSTEM, Administrators, $Utilizator)" }
}

# --- dezinstalare ----------------------------------------------------------------------------------------------------------
if ($Dezinstaleaza) {
  $ev = Read-JsonSigur $Evidenta
  $t = Get-ScheduledTask -TaskName $script:NumeSarcina -ErrorAction SilentlyContinue
  if ($t) { Unregister-ScheduledTask -TaskName $script:NumeSarcina -Confirm:$false; Spune "sarcina '$($script:NumeSarcina)' stearsa" }
  if ($OpresteSiPuntile -and (Test-Path -LiteralPath $DirStareUtil)) {
    foreach ($f in Get-ChildItem -LiteralPath $DirStareUtil -Filter '*.stare.json') {
      $st = Read-JsonSigur $f.FullName
      if ($null -eq $st) { continue }
      $a = Stop-ArboreVerificat -Id ([int]$st.pidReleu) -Nume 'powershell' -StartIso $st.startReleu
      $b = $false
      if (Get-ProcesVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude) { $b = Stop-ArboreVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude }
      if ($a -or $b) { Spune "puntea v2 '$($st.nume)' oprita" }
    }
  }
  # intai scriptul v1 la loc, apoi sarcinile vechi (Jakarinos r1 P2: ordinea starii vechi)
  if ($ev -and $ev.v1Redenumit -and (Test-Path -LiteralPath $V1Dezactivat) -and -not (Test-Path -LiteralPath $V1)) {
    Move-Item -LiteralPath $V1Dezactivat -Destination $V1; Spune 'scriptul v1 pus la loc'
  }
  $reactivate = @()
  if ($ev -and $ev.sarciniDezactivate) { $reactivate = @($ev.sarciniDezactivate) }
  foreach ($n in $reactivate) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Enable-ScheduledTask -TaskName $n | Out-Null; Spune "sarcina veche reactivata: $n"
      if ($OpresteSiPuntile) { Start-ScheduledTask -TaskName $n; Spune "sarcina veche pornita: $n" }
    }
  }
  if (Test-Path -LiteralPath $Destinatie) {
    Test-FaraReparse $Destinatie
    Remove-Item -LiteralPath $Destinatie -Recurse -Force; Spune "sters $Destinatie"
  }
  if (-not $OpresteSiPuntile) { Spune 'puntile v2 deja pornite merg pana cad singure; la urmatoarea logare pornesc sarcinile vechi.' }
  Spune 'DEZINSTALARE GATA'
  exit 0
}

# --- instalare -------------------------------------------------------------------------------------------------------------
foreach ($n in $Fisiere) {
  $sursa = Join-Path $PSScriptRoot $n
  if (-not (Test-Path -LiteralPath $sursa -PathType Leaf)) { throw "REFUZ: lipseste $sursa" }
  if ((Get-Item -LiteralPath $sursa -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "REFUZ: sursa e link: $sursa" }
}
foreach ($p in Get-ConfigPunti) { $e = Test-ConfigPunte $p; if ($e) { throw "REFUZ: configuratie invalida: $e" } }

Test-FaraReparse 'C:\ProgramData\Gazpet'
if (-not (Test-Path -LiteralPath $Destinatie)) { New-Item -ItemType Directory -Path $Destinatie | Out-Null }
Test-FaraReparse $Destinatie
Set-AclStrict $Destinatie
Test-AclStrict $Destinatie

$hashuri = [ordered]@{}
foreach ($n in $Fisiere) {
  $sursa = Join-Path $PSScriptRoot $n
  $tinta = Join-Path $Destinatie $n
  Copy-Item -LiteralPath $sursa -Destination $tinta -Force
  # proprietar = Administrators: Gazpet-Ai e cont de administrator (cu UAC); ca proprietar ar putea schimba ACL-ul fara elevare
  $af = Get-Acl -LiteralPath $tinta
  $af.SetOwner((New-Object Security.Principal.SecurityIdentifier($SidAdmin)))
  Set-Acl -LiteralPath $tinta -AclObject $af
  $h1 = (Get-FileHash -LiteralPath $sursa -Algorithm SHA256).Hash
  $h2 = (Get-FileHash -LiteralPath $tinta -Algorithm SHA256).Hash
  if ($h1 -ne $h2) { throw "REFUZ: copia lui $n difera de sursa" }
  Test-AclStrict $tinta
  $hashuri[$n] = $h2
  Spune ("copiat {0}  SHA256 {1}" -f $n, $h2)
}
# fisiere straine in destinatie (altele decat ale noastre + evidenta) -> refuz: sarcina ruleaza din acest folder
$straine = @(Get-ChildItem -LiteralPath $Destinatie -Force | Where-Object { ($Fisiere + 'instalare.json') -notcontains $_.Name })
if ($straine.Count -gt 0) { throw ('REFUZ: fisiere neasteptate in {0}: {1}' -f $Destinatie, (($straine | ForEach-Object { $_.Name }) -join ', ')) }

# sarcina noua
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$arg = '--headless "{0}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}"' -f $ps, (Join-Path $Destinatie 'punti_remote_control.ps1')
$act = New-ScheduledTaskAction -Execute $conhost -Argument $arg -WorkingDirectory $Destinatie
$tLog = New-ScheduledTaskTrigger -AtLogOn -User $Cont
$tLog.Delay = 'PT1M'
$tRep = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5)
$pr = New-ScheduledTaskPrincipal -UserId $Cont -LogonType Interactive -RunLevel Limited
$set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $script:NumeSarcina -Action $act -Trigger @($tLog, $tRep) -Principal $pr -Settings $set `
  -Description 'Supervizor punti claude remote-control v2 (scripts/server/punti). Jurnal: C:\Users\Public\paw-data\punti\punti.log' -Force | Out-Null
$tv = Get-ScheduledTask -TaskName $script:NumeSarcina
Spune ("sarcina '{0}' creata: {1} {2}; repetare {3}, durata '{4}'" -f $script:NumeSarcina, $tv.Actions[0].Execute, $tv.Actions[0].Arguments, $tv.Triggers[1].Repetition.Interval, $tv.Triggers[1].Repetition.Duration)

# sarcinile vechi: dezactivate (nu sterse), notate pentru dezinstalare
$ev = Read-JsonSigur $Evidenta
$dezactivate = @()
if ($ev -and $ev.sarciniDezactivate) { $dezactivate = @($ev.sarciniDezactivate) }
foreach ($n in $script:SarciniVechi) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if ($t -and $t.State -ne 'Disabled') {
    Disable-ScheduledTask -TaskName $n | Out-Null     # nu opreste instanta deja pornita (bucla cmd ramane pana la -PreiaAcum / delogare)
    if ($dezactivate -notcontains $n) { $dezactivate += $n }
    Spune "sarcina veche dezactivata: $n"
  }
}
$v1Redenumit = [bool]($ev -and $ev.v1Redenumit)
if ((Test-Path -LiteralPath $V1) -and -not (Test-Path -LiteralPath $V1Dezactivat)) {
  Move-Item -LiteralPath $V1 -Destination $V1Dezactivat; $v1Redenumit = $true
  Spune 'scriptul v1 redenumit in punti_remote_control.v1.dezactivat.txt (nu mai poate porni dubluri)'
}
[void](Write-JsonAtomic $Evidenta ([ordered]@{ instalatLa = (Get-DataIso (Get-Date)); sarciniDezactivate = @($dezactivate); v1Redenumit = $v1Redenumit; fisiere = $hashuri }))

# preluarea imediata (doar la cerere): oprim puntile vechi, exceptand procesele din care ruleaza instalatorul
if ($PreiaAcum) {
  $inst = Get-InstantaneuProcese
  # Get-Stramosi intoarce elemente simple; @() le aduna o singura data (Jakarinos r1 P1: fara dubla impachetare)
  $stramosi = @(@(Get-Stramosi -Id $PID -Instantaneu $inst) | ForEach-Object { [int]$_.ProcessId }) + @($PID)
  foreach ($p in Get-ConfigPunti) {
    foreach ($v in @(Get-PuntiVechi -Punte $p -Instantaneu $inst -DirV1 $DirJurnal -PidExclus @())) {
      if ($stramosi -contains [int]$v.Pid) { Spune "[$($p.Nume)] NU opresc $($v.Descriere): instalatorul ruleaza din ea; ramane pana cade singura"; continue }
      $cim = $inst | Where-Object { [int]$_.ProcessId -eq [int]$v.Pid } | Select-Object -First 1
      if ($v.Tip -eq 'v1' -and $cim -and ([string]$cim.CommandLine) -notmatch '(?i)\sremote-control\b') { Spune "[$($p.Nume)] sar peste PID $($v.Pid): nu e o punte"; continue }
      # identitatea (PID + nume + ora pornirii din instantaneu) se reverifica chiar inainte de oprire (Jakarinos r1 P1):
      # daca procesul a disparut si PID-ul a fost refolosit, nu oprim nimic
      if (Stop-ArboreVerificat -Id ([int]$v.Pid) -Nume $v.Nume -StartIso $v.StartIso) {
        Spune "[$($p.Nume)] oprit: $($v.Descriere)"
        if ($v.Tip -eq 'v1' -and $v.FisierPid) { Remove-Item -LiteralPath $v.FisierPid -Force -ErrorAction SilentlyContinue }
      } else {
        Spune "[$($p.Nume)] NU am oprit $($v.Descriere): identitatea nu se mai confirma sau procesul nu a iesit"
      }
    }
  }
}

Start-ScheduledTask -TaskName $script:NumeSarcina
Spune 'sarcina pornita o data; verificare: Get-Content C:\Users\Public\paw-data\punti\punti.log -Tail 30'
Spune 'INSTALARE GATA'
exit 0
