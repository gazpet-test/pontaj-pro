# punte_releu.ps1 - tine O punte "claude remote-control" si ii citeste iesirea (v2, 08.11.2026, Rocky/redari@).
# Pornit de punti_remote_control.ps1 (ascuns), cate unul per punte. Traieste cat traieste puntea, apoi iese.
#   - porneste claude.exe remote-control cu mediul curatat (fara CLAUDE_CODE_OAUTH_TOKEN / API key; CLAUDE_CONFIG_DIR explicit);
#   - citeste iesirea TUI (redesenata ~1/s, ~40 MB/zi) si pastreaza DOAR starea + evenimentele, cu ora exacta:
#       <DirStare>\<nume>.stare.json   (privat, profilul Gazpet-Ai)  - citit de supervizor
#       <DirJurnal>\punti.log          (paw-data, mascat: fara URL-uri, id-uri de sesiune, tokenuri, emailuri)
#       <DirStare>\<nume>.ultimele.log (ultimele 200 de linii mascate, scrise la iesire, pentru diagnostic)
#   - un mutex per punte impiedica doua relee pentru aceeasi punte.
# Nu citeste continut extern, nu scrie in ERP, nu trimite nimic. Fisier ASCII (Windows PowerShell 5.1).
param(
  [Parameter(Mandatory = $true)][string]$Nume,
  [Parameter(Mandatory = $true)][string]$Folder,
  [Parameter(Mandatory = $true)][string]$Afisat,
  [string]$ConfigDir = '',
  [string]$Spawn = '',
  [Parameter(Mandatory = $true)][string]$DirStare,
  [Parameter(Mandatory = $true)][string]$DirJurnal,
  [Parameter(Mandatory = $true)][string]$Claude,
  [string]$TestScriptFals = '',   # DOAR autotest: $Claude = powershell.exe care ruleaza acest script in locul "remote-control"
  [string]$TestArg = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'punti_lib.ps1')

$jurnal = Join-Path $DirJurnal 'punti.log'
$err = Test-ConfigPunte ([pscustomobject]@{ Nume = $Nume; Folder = $Folder; Afisat = $Afisat; ConfigDir = $ConfigDir; Spawn = $Spawn })
if ($err) { Write-Jurnal $jurnal "[releu] REFUZ: $err"; exit 2 }
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
$eu = Get-Process -Id $PID
$S = New-StarePunte -Nume $Nume -PidReleu $PID -StartReleu (Get-StartIso $eu) -Acum ((Get-Date).ToUniversalTime())
$p = $null
$ultimele = New-Object System.Collections.Generic.Queue[string]
try {
  [void](Write-JsonAtomic $caleStare $S)

  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $Claude
  if ($TestScriptFals) {
    $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $TestScriptFals + '" ' + ($TestArg -replace '[^0-9]', '')
  } else {
    $a = 'remote-control --name "' + $Afisat + '"'
    if ($Spawn) { $a += ' --spawn=' + $Spawn }
    $psi.Arguments = $a
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
  Write-Jurnal $jurnal ("[{0}] punte pornita (releu PID {1}, claude PID {2})" -f $Nume, $PID, $p.Id)
  $tErr = $p.StandardError.ReadToEndAsync()   # stderr e mic (erori la pornire/oprire); citit in fundal ca sa nu blocheze

  $ultimaScriere = [datetime]::UtcNow
  $nrLinii = 0
  $ultimaSig = ''
  $ultimulMesaj = ''
  $ultimulMesajLa = [datetime]::MinValue
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
    $mes = Update-StareDinLinie -Stare $S -Clasa $c -Acum $acum
    foreach ($ms in $mes) {
      # acelasi mesaj repetat in mai putin de 60 s nu se mai scrie (anti-spam)
      if ($ms -eq $ultimulMesaj -and ($acum - $ultimulMesajLa).TotalSeconds -lt 60) { continue }
      Write-Jurnal $jurnal "[$Nume] $ms"
      $ultimulMesaj = $ms; $ultimulMesajLa = $acum
    }
    if ($mes.Count -gt 0 -or ($acum - $ultimaScriere).TotalSeconds -ge 30) {
      [void](Write-JsonAtomic $caleStare $S)
      $ultimaScriere = $acum
    }
  }

  $p.WaitForExit()
  $cod = $p.ExitCode
  $textErr = ''
  if ($tErr.Wait(10000)) { $textErr = [string]$tErr.Result }
  $ultimaErr = @($textErr -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last 1
  $S.stare = 'oprit'
  $S.codIesire = $cod
  $S.iesitLa = Get-DataIso ([datetime]::UtcNow)
  $S.stareDeLa = $S.iesitLa
  if ($ultimaErr) { $S.ultimaEroare = Format-Sigur $ultimaErr; $S.ultimaEroareLa = $S.iesitLa }
  [void](Write-JsonAtomic $caleStare $S)
  $txt = "[$Nume] puntea s-a oprit (cod $cod)"
  if ($ultimaErr) { $txt += ': ' + (Format-Sigur $ultimaErr) }
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
  try { [IO.File]::WriteAllLines($caleUltimele, [string[]]$ultimele.ToArray(), (New-Object Text.UTF8Encoding($false))) } catch { }
  if ($detin) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
exit 0
