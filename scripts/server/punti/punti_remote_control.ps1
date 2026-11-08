# punti_remote_control.ps1 - supervizorul puntilor "claude remote-control" de pe serverul Gazpet-Claude (v2, 08.11.2026, Rocky/redari@).
# Rulat de sarcina Windows "Punti Remote Control (Gazpet)" la logare + la fiecare 5 minute (vezi instaleaza.ps1). Idempotent.
# La fiecare rulare:
#   1. verifica internetul (TCP 443 catre api.anthropic.com / claude.ai); fara internet nu porneste si nu reporneste nimic;
#   2. citeste "claude auth status" pentru fiecare cont (cel mult o data pe ora); login expirat -> nu porneste degeaba, scrie alarma;
#      cu 5 zile inainte de loginExpiresAt scrie C:\Users\Public\paw-data\out\alarma_login.txt + rand in punti.log;
#   3. porneste puntile lipsa (prin punte_releu.ps1) si le reporneste pe cele vii dar picate >= 10 min (semnale in punti_lib.ps1);
#      maxim 3 porniri/ora pe punte, apoi doar avertisment; nu dubleaza o punte pornita pe calea veche (v1 / bucla cmd).
# Jurnal: C:\Users\Public\paw-data\punti\punti.log (fara secrete). Stare: %LOCALAPPDATA%\Gazpet\punti (privat).
# -DoarVerifica: arata ce ar face, fara sa porneasca/opreasca nimic si fara sa scrie stare/alarma.
# Nu citeste continut extern, nu scrie in ERP, nu trimite mailuri/mesaje. Fisier ASCII (Windows PowerShell 5.1).
param(
  [switch]$DoarVerifica,
  [string]$DirStare = (Join-Path $env:LOCALAPPDATA 'Gazpet\punti'),
  [string]$DirJurnal = 'C:\Users\Public\paw-data\punti',
  [string]$FisierAlarma = 'C:\Users\Public\paw-data\out\alarma_login.txt'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'punti_lib.ps1')

# Variabilele folosite in blocurile de dependente au prefixul Sv (blocurile se executa din Invoke-Supervizor: fara coliziuni de nume).
$SvDirScript = $PSScriptRoot
$SvDirStare = $DirStare
$SvDirJurnal = $DirJurnal
$SvFisierAlarma = $FisierAlarma
$SvDirV1 = 'C:\Users\Public\paw-data\punti'                                 # unde scria v1 fisierele .pid
$SvFisierToken = 'C:\Users\Gazpet-Ai\.secrete\claude_oauth_token.txt'      # doar existenta (Test-Path); continutul NU se citeste
New-Item -ItemType Directory -Path $SvDirStare, $SvDirJurnal -Force | Out-Null
$SvJurnal = Join-Path $SvDirJurnal 'punti.log'

$SvMutex = $null
$SvDetin = $false
foreach ($ns in 'Global', 'Local') {
  try { $SvMutex = New-Object System.Threading.Mutex($false, "$ns\GazpetPuntiSupervizor"); break } catch { $SvMutex = $null }
}
if ($null -eq $SvMutex) { Write-Jurnal $SvJurnal 'EROARE supervizor: nu pot crea mutexul'; exit 1 }
try { $SvDetin = $SvMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $SvDetin = $true }
if (-not $SvDetin) { exit 0 }   # alta rulare e in curs

try {
  $SvClaude = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
  if (-not (Test-Path -LiteralPath $SvClaude -PathType Leaf)) {
    # o data pe ora, nu la fiecare 5 minute
    $s0 = Read-JsonSigur (Join-Path $SvDirStare 'supervizor.json')
    if ($null -eq $s0) { $s0 = @{} }
    if (-not $DoarVerifica -and (Test-TrebuieLogat $s0 'lipsa-claude' ([datetime]::UtcNow) 60)) {
      Write-Jurnal $SvJurnal 'EROARE supervizor: nu gasesc claude.exe (CLI din npm); nu pot porni puntile'
      [void](Write-JsonAtomic (Join-Path $SvDirStare 'supervizor.json') $s0)
    }
    exit 1
  }
  $SvConfig = @(Get-ConfigPunti)
  foreach ($p in $SvConfig) {
    $e = Test-ConfigPunte $p
    if ($e) { Write-Jurnal $SvJurnal "EROARE supervizor: configuratie invalida ($e); nu fac nimic"; exit 2 }
  }

  $SvInst = Get-InstantaneuProcese
  if (-not $DoarVerifica -and (Test-InSesiuneClaude -Id $PID -Instantaneu $SvInst)) {
    # rulat dintr-o sesiune Claude: punti pornite de aici ar fi copiii puntii-parinte si ar muri odata cu ea
    $t = Get-ScheduledTask -TaskName $script:NumeSarcina -ErrorAction SilentlyContinue
    if ($t) {
      Start-ScheduledTask -TaskName $script:NumeSarcina
      Write-Jurnal $SvJurnal 'supervizor rulat dintr-o sesiune Claude: am pornit sarcina programata in loc sa actionez de aici'
      'Am pornit sarcina programata "' + $script:NumeSarcina + '" (supervizorul nu actioneaza din interiorul unei sesiuni Claude).'
    } else {
      'Rulat dintr-o sesiune Claude si sarcina nu e instalata: nu fac nimic. Pentru o simulare: -DoarVerifica.'
    }
    exit 0
  }
  if (-not $DoarVerifica) { Invoke-RotireJurnal $SvJurnal }

  $Dep = @{
    Config = $SvConfig
    PlanAutentificare = (Get-PlanAutentificare -ExistaFisierToken (Test-Path -LiteralPath $SvFisierToken))
    Jurnal = { param($m) Write-Jurnal $SvJurnal $m }
    CitesteStareSup = { Read-JsonSigur (Join-Path $SvDirStare 'supervizor.json') }
    ScrieStareSup = { param($s) [bool](Write-JsonAtomic (Join-Path $SvDirStare 'supervizor.json') $s) }   # $false = nu actionam
    CitesteStarePunte = { param($p) Read-JsonSigur (Join-Path $SvDirStare ($p.Nume + '.stare.json')) }
    Internet = { Test-Internet }
    Login = { param($cfg) Invoke-AuthStatus -Claude $SvClaude -ConfigDir $cfg -Acum ([datetime]::UtcNow) }
    Procese = {
      param($p, $st)
      if ($null -eq $st) { return @{ ReleuViu = $false; ClaudeViu = $false } }
      $r = Get-ProcesVerificat -Id ([int]$st.pidReleu) -Nume 'powershell' -StartIso $st.startReleu
      $c = Get-ProcesVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude
      $cViu = ($null -ne $c)
      # releu abia pornit, puntea inca nepornita (fereastra de cateva secunde): nu e "releu fara punte"
      $dePornire = Get-MinuteDeLa $st.pornitLa ([datetime]::UtcNow)
      if ($r -and [int]$st.pidClaude -eq 0 -and $null -ne $dePornire -and $dePornire -lt 2) { $cViu = $true }
      return @{ ReleuViu = ($null -ne $r); ClaudeViu = $cViu }
    }
    Veche = {
      param($p, $st)
      $ex = @()
      if ($st -and [int]$st.pidClaude -gt 0 -and (Get-ProcesVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude)) { $ex += [int]$st.pidClaude }
      return Get-PunteVeche -Punte $p -Instantaneu $SvInst -DirV1 $SvDirV1 -PidExclus $ex
    }
    Opreste = {
      param($p, $st)
      if ($null -eq $st) { return $false }
      [void](Stop-ArboreVerificat -Id ([int]$st.pidReleu) -Nume 'powershell' -StartIso $st.startReleu)
      if (Get-ProcesVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude) {
        [void](Stop-ArboreVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude)
      }
      $ramas = (Get-ProcesVerificat -Id ([int]$st.pidReleu) -Nume 'powershell' -StartIso $st.startReleu) -or
               (Get-ProcesVerificat -Id ([int]$st.pidClaude) -Nume 'claude' -StartIso $st.startClaude)
      return (-not $ramas)
    }
    Porneste = {
      param($p)
      $releu = Join-Path $SvDirScript 'punte_releu.ps1'
      $a = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Nume {1} -Folder "{2}" -Afisat "{3}" -DirStare "{4}" -DirJurnal "{5}" -Claude "{6}"' -f `
           $releu, $p.Nume, $p.Folder, $p.Afisat, $SvDirStare, $SvDirJurnal, $SvClaude
      if ($p.ConfigDir) { $a += ' -ConfigDir "' + $p.ConfigDir + '"' }
      if ($p.Spawn) { $a += ' -Spawn ' + $p.Spawn }
      $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $pr = Start-Process -FilePath $ps -ArgumentList $a -WorkingDirectory $p.Folder -WindowStyle Hidden -PassThru
      $caleSt = Join-Path $SvDirStare ($p.Nume + '.stare.json')
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $st = Read-JsonSigur $caleSt
        if ($st -and [int]$st.pidReleu -eq $pr.Id -and [int]$st.pidClaude -gt 0) {
          return @{ Ok = $true; Mesaj = ('releu PID {0}, claude PID {1}' -f $pr.Id, $st.pidClaude) }
        }
        if ($pr.HasExited) { return @{ Ok = $false; Mesaj = ('releul a iesit imediat (cod {0}); vezi punti.log' -f $pr.ExitCode) } }
      }
      return @{ Ok = $false; Mesaj = ('releul (PID {0}) nu a confirmat pornirea in 20 s' -f $pr.Id) }
    }
    ScrieAlarma = {
      param($text)
      $f = $SvFisierAlarma
      if (-not $text) {
        if (Test-Path -LiteralPath $f) {
          $prima = [string](Get-Content -LiteralPath $f -TotalCount 1)
          if ($prima.StartsWith('ALARMA LOGIN')) { Remove-Item -LiteralPath $f -Force; return 'sters' }
        }
        return 'nimic'
      }
      New-Item -ItemType Directory -Path (Split-Path $f) -Force | Out-Null
      [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding($false)))
      return 'scris'
    }
  }

  $SvActiuni = Invoke-Supervizor -Dep $Dep -Acum ([datetime]::UtcNow) -DoarVerifica:$DoarVerifica
  if ($DoarVerifica) { $SvActiuni }
} catch {
  Write-Jurnal $SvJurnal ('EROARE supervizor: ' + (Format-Sigur $_.Exception.Message 200))
  exit 1
} finally {
  if ($SvDetin) { try { $SvMutex.ReleaseMutex() } catch { } }
  if ($SvMutex) { $SvMutex.Dispose() }
}
exit 0
