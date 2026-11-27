# punte_releu.ps1 - tine O punte "claude remote-control" si ii citeste iesirea (v3, 25.11.2026, Rocky/redari@).
# Pornit de punti_remote_control.ps1 (ascuns), cate unul per punte. Traieste cat traieste puntea, apoi iese.
#   - porneste claude.exe remote-control cu mediul curatat (fara CLAUDE_CODE_OAUTH_TOKEN / API key; CLAUDE_CONFIG_DIR explicit);
#     mod normal = --name + --spawn; mod reatasare (-SesiuneId) = --session-id <id>, puntea cu o singura sesiune care reinvie
#     mediul sesiunii (supervizorul o inlocuieste cu una normala la rularea urmatoare);
#   - citeste iesirea TUI (redesenata ~1/s, ~40 MB/zi) si pastreaza DOAR starea + evenimentele, cu ora exacta:
#       <DirStare>\<nume>.stare.json   (privat, profilul Gazpet-Ai)  - citit de supervizor
#       <DirJurnal>\punti.log          (paw-data, mascat: fara URL-uri, id-uri de sesiune, tokenuri, emailuri)
#       <DirStare>\<nume>.ultimele.log (ultimele 200 de linii mascate, scrise la iesire, pentru diagnostic)
#   - citeste stderr linie cu linie (evenimente .NET, pipe-ul nu se umple): "deja servit", "sesiune negasita", "mediu pierdut";
#   - retine in stare indicatorul CLI-ului (bridge-pointer.json: mediu + sesiune + pid) ca supervizorul sa stie ce sa reataseze;
#   - un mutex per punte impiedica doua relee pentru aceeasi punte.
# Nu citeste continut extern, nu scrie in ERP, nu trimite nimic. Fisier ASCII (Windows PowerShell 5.1).
param(
  [Parameter(Mandatory = $true)][string]$Nume,
  [Parameter(Mandatory = $true)][string]$Folder,
  [Parameter(Mandatory = $true)][string]$Afisat,
  [string]$ConfigDir = '',
  [string]$Spawn = '',
  [string]$SesiuneId = '',        # reatasare: puntea porneste cu --session-id <id> (fara --spawn)
  [Parameter(Mandatory = $true)][string]$DirStare,
  [Parameter(Mandatory = $true)][string]$DirJurnal,
  [Parameter(Mandatory = $true)][string]$Claude,
  [string]$TestScriptFals = '',   # DOAR autotest: $Claude = powershell.exe care ruleaza acest script in locul "remote-control"
  [string]$TestArg = '',
  [string]$TestCaleIndicator = '' # DOAR autotest: fisierul bridge-pointer.json de citit in locul celui real
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'punti_lib.ps1')

$jurnal = Join-Path $DirJurnal 'punti.log'
$err = Test-ConfigPunte ([pscustomobject]@{ Nume = $Nume; Folder = $Folder; Afisat = $Afisat; ConfigDir = $ConfigDir; Spawn = $Spawn })
if ($err) { Write-Jurnal $jurnal "[releu] REFUZ: $err"; exit 2 }
if ($SesiuneId -and -not (Test-IdSigur $SesiuneId)) { Write-Jurnal $jurnal "[$Nume] REFUZ: id de sesiune nesigur pentru reatasare"; exit 2 }
if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { Write-Jurnal $jurnal "[$Nume] REFUZ: folderul nu exista: $Folder"; exit 2 }
if (-not (Test-Path -LiteralPath $Claude -PathType Leaf)) { Write-Jurnal $jurnal "[$Nume] REFUZ: nu gasesc CLI-ul claude"; exit 2 }
New-Item -ItemType Directory -Path $DirStare -Force | Out-Null

# un singur releu per punte (mutexul se elibereaza automat daca procesul moare)
$mutex = $null
$detin = $false
foreach ($ns in 'Global', 'Local') {
  try { $mutex = New-Object System.Threading.Mutex($false, "$ns\GazpetPunte-$Nume"); break } catch { $mutex = $null }
}
if ($null -eq $mutex) { Write-Jurnal $jurnal "[$Nume] REFUZ: nu pot crea mutexul releului"; exit 2 }
try { $detin = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $detin = $true }
if (-not $detin) { Write-Jurnal $jurnal "[$Nume] releu deja activ pentru aceasta punte; ies"; exit 3 }

$caleStare = Join-Path $DirStare "$Nume.stare.json"
$caleUltimele = Join-Path $DirStare "$Nume.ultimele.log"
$caleIndicator = $TestCaleIndicator
if (-not $caleIndicator) { $caleIndicator = Get-CaleIndicator ([pscustomobject]@{ Folder = $Folder; ConfigDir = $ConfigDir }) }
$eu = Get-Process -Id $PID
$S = New-StarePunte -Nume $Nume -PidReleu $PID -StartReleu (Get-StartIso $eu) -Acum ((Get-Date).ToUniversalTime())
if ($SesiuneId) { $S.mod = 'reatasare'; $S.sesiuneReatasare = $SesiuneId }
$p = $null
$srcErr = "GazpetPunteStderr-$PID"
$evInregistrat = $false
$ultimele = New-Object System.Collections.Generic.Queue[string]
$ultimulMesaj = ''
$ultimulMesajLa = [datetime]::MinValue

# stderr-ul puntii: liniile sosesc ca evenimente .NET (citite pe alt fir, pipe-ul nu se umple niciodata) si se consuma aici.
# Coada PowerShell nu garanteaza ordinea la Get-Event -> sortare dupa EventIdentifier (numar de ordine la sosire): cauza
# ("already served") trebuie sa ramana dupa liniile dinaintea ei si inaintea numaratorii "Exiting in about".
function Read-StderrPunte([datetime]$Acum) {
  $mesaje = New-Object System.Collections.ArrayList
  foreach ($ev in @(Get-Event -SourceIdentifier $srcErr -ErrorAction SilentlyContinue | Sort-Object EventIdentifier)) {
    $l = $null
    try { $l = $ev.SourceEventArgs.Data } catch { }
    Remove-Event -EventIdentifier $ev.EventIdentifier -ErrorAction SilentlyContinue
    if ($null -eq $l) { continue }
    $ce = Get-ClasaStderr ([string]$l)
    if ($ce.Tip -ne 'gol') {
      $sig = (Get-Date -Format 'HH:mm:ss') + ' stderr: ' + $ce.Text
      $ultimele.Enqueue($sig)
      if ($ultimele.Count -gt 200) { [void]$ultimele.Dequeue() }
    }
    foreach ($ms in @(Update-StareDinStderr -Stare $S -Clasa $ce -Acum $Acum)) { [void]$mesaje.Add($ms) }
  }
  return $mesaje.ToArray()
}

function Write-Mesaje([string[]]$Mesaje, [datetime]$Acum) {
  foreach ($ms in @($Mesaje)) {
    # acelasi mesaj repetat in mai putin de 60 s nu se mai scrie (anti-spam)
    if ($ms -eq $script:ultimulMesaj -and ($Acum - $script:ultimulMesajLa).TotalSeconds -lt 60) { continue }
    Write-Jurnal $jurnal "[$Nume] $ms"
    $script:ultimulMesaj = $ms; $script:ultimulMesajLa = $Acum
  }
}

try {
  [void](Write-JsonAtomic $caleStare $S)

  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $Claude
  $argReale = Get-ArgumentePunte -Afisat $Afisat -Spawn $Spawn -SesiuneId $SesiuneId
  $S.argumente = Format-Sigur $argReale 200
  if ($TestScriptFals) {
    $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $TestScriptFals + '" ' + ($TestArg -replace '[^0-9]', '')
  } else {
    $psi.Arguments = $argReale
  }
  $psi.WorkingDirectory = $Folder
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true        # ramane deschis si gol: ca un terminal la care nu apasa nimeni
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $m = Get-MediuCopilReal -ConfigDir $ConfigDir
  $psi.EnvironmentVariables.Clear()
  foreach ($k in $m.Mediu.Keys) { $psi.EnvironmentVariables[$k] = $m.Mediu[$k] }
  foreach ($av in $m.Avertizari) { Write-Jurnal $jurnal "[$Nume] AVERTISMENT: $av" }

  $p = [Diagnostics.Process]::Start($psi)
  $S.pidClaude = $p.Id
  $S.startClaude = Get-StartIso $p
  [void](Write-JsonAtomic $caleStare $S)
  Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -SourceIdentifier $srcErr | Out-Null
  $evInregistrat = $true
  $p.BeginErrorReadLine()
  if ($SesiuneId) { Write-Jurnal $jurnal ("[{0}] punte de REATASARE pornita pentru sesiunea {1} (releu PID {2}, claude PID {3})" -f $Nume, (Format-Sigur $SesiuneId 60), $PID, $p.Id) }
  else { Write-Jurnal $jurnal ("[{0}] punte pornita (releu PID {1}, claude PID {2})" -f $Nume, $PID, $p.Id) }

  $ultimaScriere = [datetime]::UtcNow
  $ultimIndicator = [datetime]::MinValue
  $nrLinii = 0
  $ultimaSig = ''
  while ($true) {
    $linie = $p.StandardOutput.ReadLine()
    if ($null -eq $linie) { break }
    $acum = [datetime]::UtcNow
    $c = Get-ClasaLinie $linie
    # diagnostic: primele 40 de linii (mesajele de pornire) + apoi doar evenimentele, fara blocul de stare redesenat
    if ($c.Tip -ne 'gol' -and ($nrLinii -lt 40 -or @('eroare', 'avertizare', 'reconectat', 'sesiune', 'info', 'reconectare') -contains $c.Tip)) {
      $sig = (Get-Date -Format 'HH:mm:ss') + ' ' + (Format-Sigur $c.Text 200)
      if ($sig.Substring(9) -ne $ultimaSig) {
        $ultimele.Enqueue($sig); $ultimaSig = $sig.Substring(9)
        if ($ultimele.Count -gt 200) { [void]$ultimele.Dequeue() }
      }
    }
    if ($c.Tip -ne 'gol') { $nrLinii++ }
    $eraConectat = ($S.stare -eq 'conectat')
    $mes = @(Update-StareDinLinie -Stare $S -Clasa $c -Acum $acum) + @(Read-StderrPunte -Acum $acum)
    Write-Mesaje -Mesaje $mes -Acum $acum
    # indicatorul CLI-ului: la conectare si apoi la fiecare 30 s (e scris de punte dupa inregistrare si reimprospatat cat ruleaza)
    if (($S.stare -eq 'conectat' -and -not $eraConectat) -or ($acum - $ultimIndicator).TotalSeconds -ge 30) {
      $ind = Read-Indicator $caleIndicator
      if ($null -ne $ind) { $S.indicator = $ind }
      $ultimIndicator = $acum
    }
    if ($mes.Count -gt 0 -or ($acum - $ultimaScriere).TotalSeconds -ge 30) {
      [void](Write-JsonAtomic $caleStare $S)
      $ultimaScriere = $acum
    }
  }

  $p.WaitForExit()   # fara timeout: asteapta si sfarsitul citirii asincrone a stderr-ului
  $cod = $p.ExitCode
  $acum = [datetime]::UtcNow
  Write-Mesaje -Mesaje @(Read-StderrPunte -Acum $acum) -Acum $acum
  $ind = Read-Indicator $caleIndicator
  if ($null -ne $ind) { $S.indicator = $ind }
  $S.stare = 'oprit'
  $S.codIesire = $cod
  $S.iesitLa = Get-DataIso ([datetime]::UtcNow)
  $S.stareDeLa = $S.iesitLa
  [void](Write-JsonAtomic $caleStare $S)
  $txt = "[$Nume] puntea s-a oprit (cod $cod)"
  if ($S.ultimaEroare) { $txt += ': ' + $S.ultimaEroare }   # cauza reala, nu numaratoarea "Exiting in about N seconds"
  if ($S.dejaServit) { $txt += ' [deja servit: supervizorul nu porneste dublura]' }
  if ($S.sesiuneNegasita) { $txt += ' [sesiunea de reatasat nu mai exista]' }
  Write-Jurnal $jurnal $txt
} catch {
  Write-Jurnal $jurnal ("[{0}] EROARE releu: {1}" -f $Nume, (Format-Sigur $_.Exception.Message 200))
  if ($p -and -not $p.HasExited) {
    # releul nu mai poate citi iesirea: oprim puntea (copilul nostru, verificat) ca supervizorul sa o reporneasca curat
    [void](Stop-ArboreVerificat -Id $p.Id -Nume ([IO.Path]::GetFileNameWithoutExtension($Claude)) -StartIso $S.startClaude)
  }
  $S.stare = 'oprit'; $S.iesitLa = Get-DataIso ([datetime]::UtcNow)
  [void](Write-JsonAtomic $caleStare $S)
  exit 1
} finally {
  if ($evInregistrat) { try { Unregister-Event -SourceIdentifier $srcErr -ErrorAction SilentlyContinue } catch { } }
  try { [IO.File]::WriteAllLines($caleUltimele, [string[]]$ultimele.ToArray(), (New-Object Text.UTF8Encoding($false))) } catch { }
  if ($detin) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
exit 0
