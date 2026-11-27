# punti_lib.ps1 - functii comune pentru puntile "claude remote-control" de pe serverul AI (v3, 25.11.2026, Rocky/redari@).
# Folosit de: punti_remote_control.ps1 (supervizor), punte_releu.ps1 (releu per punte), instaleaza.ps1, autotest_punti.ps1.
# Se incarca prin dot-source. Functiile "pure" (fara procese, fara retea) sunt testate in autotest_punti.ps1.
# Fara secrete: nicio functie nu citeste fisiere cu tokenuri; textele scrise in jurnale trec prin Format-Sigur.
# Fisier ASCII intentionat (Windows PowerShell 5.1 citeste .ps1 fara BOM ca ANSI).
# v3 (25.11.2026): reatasarea sesiunilor existente dupa pierderea mediului (indicatorul CLI-ului + `--session-id`),
#   recunoasterea "folderul e deja servit de alta punte" (fara bucla de reporniri), stderr-ul puntii citit linie cu linie.

$script:PuntiVersiune = 'v3'
$script:NumeSarcina = 'Punti Remote Control (Gazpet)'
$script:SarciniVechi = @(
  'Claude Remote Control (Gazpet)',
  'Claude Remote Control (Gazpet) - Chat',
  'Claude Remote Control (Gazpet) - Ofertare',
  'Claude Remote Control (Gazpet) - Redari'
)
$script:PragProblemaMin = 10        # o problema trebuie sa dureze >= 10 min inainte de repornire
$script:MaxPorniriPeOra = 3         # porniri + reporniri pe punte, fereastra glisanta de 60 min
$script:InternetStabilMin = 5       # dupa o pana de internet, asteptam 5 min (puntea se reconecteaza singura in <= 2 min)
$script:ZileAlarmaLogin = 5         # alarma cu 5 zile inainte de loginExpiresAt
$script:VerificareLoginMin = 60     # "claude auth status" cel mult o data pe ora (mai des doar cand trebuie pornita o punte)
$script:ObservatieTacereMin = 30    # puntea vie care nu scrie nimic de 30 min -> doar observatie in jurnal, fara actiune
$script:PragReatasareMin = 10       # puntea de reatasare (--session-id) neconectata dupa 10 min = incercare esuata
$script:MaxIncercariReatasare = 2   # dupa 2 incercari esuate pe aceeasi sesiune renunt la ea (fara bucla)
$script:MaxCandidatiReatasare = 3   # cel mult 3 sesiuni incercate la o singura pierdere de mediu
$script:PragDejaServitMin = 60      # "folderul e deja servit" fara proces vizibil: reincerc abia dupa 60 min
$script:MaxSesiuniRetinute = 20     # sesiuni cunoscute pastrate per punte
# Test izolat 08.11.2026 (CLI 2.1.319, folder si config separate): cu CLAUDE_CODE_OAUTH_TOKEN (setup-token) puntea iese imediat cu
# "Remote Control requires a full-scope login token. Long-lived tokens (...) are limited to inference-only". Deci NU folosim tokenul.
$script:TokenTineRemoteControl = $false

# ---------------------------------------------------------------------------------------------------------------------------
# Configuratia puntilor: O SINGURA definitie (L19), folosita de supervizor, releu si instalator.
# CmdVechi = scriptul .cmd din pornirea veche (sarcini la logare); FolderV1 = numele .pid scris de v1 in paw-data\punti.
function Get-ConfigPunti {
  @(
    [pscustomobject]@{ Nume = 'chat';     Folder = 'C:\Users\Gazpet-Ai\gazpet-erp-chat';     Afisat = 'Chat - server AI';       ConfigDir = ''; Spawn = ''; CmdVechi = 'start_claude_rc_chat.cmd' }
    [pscustomobject]@{ Nume = 'module';   Folder = 'C:\Users\Gazpet-Ai\gazpet-erp';          Afisat = 'Module ERP - server AI'; ConfigDir = ''; Spawn = ''; CmdVechi = 'start_claude_rc.cmd' }
    [pscustomobject]@{ Nume = 'ofertare'; Folder = 'C:\Users\Gazpet-Ai\gazpet-erp-ofertare'; Afisat = 'Ofertare - server AI';   ConfigDir = ''; Spawn = ''; CmdVechi = 'start_claude_rc_ofertare.cmd' }
    [pscustomobject]@{ Nume = 'redari';   Folder = 'C:\Users\Gazpet-Ai\gazpet-erp-redari';   Afisat = 'Redari - server AI';     ConfigDir = 'C:\Users\Gazpet-Ai\.claude-redari'; Spawn = 'worktree'; CmdVechi = 'start_claude_rc_redari.cmd' }
  )
}

function Get-CheieCont([string]$ConfigDir) {
  if ([string]::IsNullOrWhiteSpace($ConfigDir)) { return 'implicit' }
  return $ConfigDir.Trim().ToLowerInvariant()
}

function Get-EtichetaCont([string]$Cheie, $Config) {
  $nume = @($Config | Where-Object { (Get-CheieCont $_.ConfigDir) -eq $Cheie } | ForEach-Object { $_.Nume }) -join ', '
  if ($Cheie -eq 'implicit') { return "contul principal (config implicit; punti: $nume)" }
  return "contul din $Cheie (punti: $nume)"
}

function Test-ConfigPunte($Punte) {
  # validare stricta: valorile ajung in linia de comanda a releului / a CLI-ului
  if ($Punte.Nume -notmatch '^[a-z0-9][a-z0-9-]{0,31}$') { return "nume invalid: $($Punte.Nume)" }
  if ($Punte.Afisat -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$') { return "nume afisat invalid pentru $($Punte.Nume)" }
  if ($Punte.Spawn -notmatch '^(|same-dir|worktree|session)$') { return "spawn invalid pentru $($Punte.Nume)" }
  foreach ($c in @($Punte.Folder, $Punte.ConfigDir)) {
    if ($c -and ($c -match '["%]' -or $c -notmatch '^[A-Za-z]:\\')) { return "cale invalida pentru $($Punte.Nume): $c" }
  }
  return $null
}

# ---------------------------------------------------------------------------------------------------------------------------
# Indicatorul CLI-ului ("bridge pointer"; CLI 2.1.319, verificat in binar): <config>\projects\<cheie folder>\bridge-pointer.json
#   {"sessionId":"session_...","environmentId":"env_...","source":"standalone","pid":N,"procStart":"<FILETIME UTC>",
#    "activeSessionIds":[...] (optional)}. Il scrie puntea dupa inregistrare si il reimprospateaza cat ruleaza.
#   La o pornire noua fara --session-id, CLI-ul: (1) daca pid-ul din indicator e inca viu -> inregistreaza un mediu NOU, iar
#   serverul raspunde 409 "This folder is already served by another Claude Code on this device" -> puntea scrie eroarea pe
#   stderr, apoi "Exiting in about N seconds." si iese cu cod 1 (bucla de pe 25.11.2026: releul v2 retinea doar ultima linie);
#   (2) altfel cere refolosirea mediului din indicator -> sesiunile existente se reconecteaza singure; daca serverul da alt
#   mediu: "Warning: Could not reuse the previous environment. Existing claude.ai/code sessions from the previous run will
#   not reconnect." si indicatorul e sters -> sesiunile vechi raman fara mediu ("Environment deleted" in aplicatie).
#   Singura cale de reatasare e `claude remote-control --session-id <id>` (CLI-ul cere serverului mediul sesiunii si il
#   reinvie; mod cu O singura sesiune: capacitate 1, fara spawn, iese cand sesiunea se termina). Dupa ce acea punte s-a
#   conectat, o punte normala pornita in acelasi folder refoloseste mediul din indicatorul ei -> toate sesiunile, capacitate
#   normala. Supervizorul v3 face exact acesti doi pasi (vezi Update-Reatasare).
#   Indicatorul e scris de CLI (componenta de sistem), nu e continut extern; id-urile trec totusi prin Test-IdSigur inainte
#   sa ajunga pe linia de comanda, iar in jurnal sunt mascate (Format-Sigur -> <session-id>, <env-id>).
function Get-CheieProiect([string]$Folder) { return [regex]::Replace($Folder, '[^A-Za-z0-9]', '-') }

function Get-CaleIndicator($Punte, [string]$DirConfigImplicit = (Join-Path $env:USERPROFILE '.claude')) {
  $cfg = $DirConfigImplicit
  if (-not [string]::IsNullOrWhiteSpace($Punte.ConfigDir)) { $cfg = $Punte.ConfigDir }
  return Join-Path (Join-Path $cfg 'projects') (Join-Path (Get-CheieProiect $Punte.Folder) 'bridge-pointer.json')
}

# id de sesiune / mediu acceptat pe linia de comanda a CLI-ului (CLI-ul insusi refuza "unsafe characters")
function Test-IdSigur([string]$Id) {
  if ([string]::IsNullOrWhiteSpace($Id)) { return $false }
  return [bool]($Id -match '^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$')
}

# procStart din indicator = FILETIME UTC (tick-uri de 100 ns de la 1601) ca text; necitibil -> $null (L18: necunoscut, nu 0)
function ConvertFrom-ProcStart($Valoare) {
  if ($null -eq $Valoare) { return $null }
  $s = ([string]$Valoare).Trim()
  if ($s -notmatch '^\d{15,19}$') { return $null }
  $t = 0L
  if (-not [long]::TryParse($s, [ref]$t)) { return $null }
  try { $d = [datetime]::FromFileTimeUtc($t) } catch { return $null }
  if ($d.Year -lt 2020 -or $d.Year -gt 2100) { return $null }
  return $d
}

# Indicator normalizat: @{ mediu; sesiune; sesiuniActive; pid; startIso; scrisLa } sau $null (mediu lipsa/nesigur = indicator inutil).
function ConvertFrom-Indicator($Obiect, $ScrisLa) {
  if ($null -eq $Obiect) { return $null }
  $o = ConvertTo-Hashtable $Obiect
  if ($o -isnot [hashtable]) { return $null }
  if (-not (Test-IdSigur ([string]$o['environmentId']))) { return $null }
  $r = @{ mediu = [string]$o['environmentId']; sesiune = $null; sesiuniActive = @(); pid = 0; startIso = $null; scrisLa = $null }
  if (Test-IdSigur ([string]$o['sessionId'])) { $r.sesiune = [string]$o['sessionId'] }
  $r.sesiuniActive = @(@($o['activeSessionIds']) | ForEach-Object { [string]$_ } | Where-Object { Test-IdSigur $_ } | Select-Object -Unique)
  $idp = 0
  if ($null -ne $o['pid'] -and [int]::TryParse(([string]$o['pid']), [ref]$idp) -and $idp -gt 0) { $r.pid = $idp }
  $st = ConvertFrom-ProcStart $o['procStart']
  if ($st) { $r.startIso = Get-DataIso $st }
  $sc = ConvertFrom-DataIso $ScrisLa
  if ($sc) { $r.scrisLa = Get-DataIso $sc }
  return $r
}

function Read-Indicator([string]$Cale) {
  if (-not $Cale -or -not (Test-Path -LiteralPath $Cale -PathType Leaf)) { return $null }
  $o = Read-JsonSigur $Cale
  if ($null -eq $o) { return $null }
  $scris = $null
  try { $scris = (Get-Item -LiteralPath $Cale).LastWriteTimeUtc } catch { }
  return ConvertFrom-Indicator -Obiect $o -ScrisLa $scris
}

# Scriitorul indicatorului e un claude.exe viu (pornit la ora din indicator) si nu e puntea noastra -> alta punte serveste
# folderul; CLI-ul nostru ar primi 409 la inregistrare. $Cauta: pid -> @{ Nume; StartUtc } sau $null (fals in teste).
function Get-ScriitorIndicatorStrain($Indicator, [int[]]$PidExclus, [scriptblock]$Cauta = $null) {
  if ($null -eq $Indicator -or [int]$Indicator.pid -le 0) { return $null }
  $idp = [int]$Indicator.pid
  if (@($PidExclus) -contains $idp) { return $null }
  if ($null -eq $Cauta) {
    $Cauta = {
      param($i)
      try {
        $pr = Get-Process -Id $i -ErrorAction Stop
        $st = $null
        try { $st = $pr.StartTime.ToUniversalTime() } catch { }
        return @{ Nume = $pr.ProcessName; StartUtc = $st }
      } catch { return $null }
    }
  }
  $pr = & $Cauta $idp
  if ($null -eq $pr -or $pr.Nume -ne 'claude') { return $null }
  $asteptat = ConvertFrom-DataIso $Indicator.startIso
  if ($null -ne $asteptat) {
    # PID refolosit de alt claude.exe (ex. o sesiune copil): ora pornirii nu se potriveste -> nu e scriitorul
    if ($null -eq $pr.StartUtc -or [math]::Abs(($pr.StartUtc - $asteptat).TotalSeconds) -gt 2) { return $null }
  }
  return ('alta punte serveste folderul (claude PID {0}, din indicatorul CLI-ului)' -f $idp)
}

# Argumentele CLI-ului. Mod normal = ca pana acum (--name, --spawn). Reatasare = `--session-id <id>` singur: CLI-ul refuza
# spawn flags cu --session-id, iar puntea aceasta nu creeaza sesiuni (numele nu ar folosi la nimic). Id nesigur = refuz.
function Get-ArgumentePunte([string]$Afisat, [string]$Spawn, [string]$SesiuneId) {
  if ($SesiuneId) {
    if (-not (Test-IdSigur $SesiuneId)) { throw 'id de sesiune nesigur pentru reatasare' }
    return 'remote-control --session-id ' + $SesiuneId
  }
  $a = 'remote-control --name "' + $Afisat + '"'
  if ($Spawn) { $a += ' --spawn=' + $Spawn }
  return $a
}

# ---------------------------------------------------------------------------------------------------------------------------
# Timp: totul in UTC in fisierele de stare (ISO 8601 "o"), ora locala doar in jurnal (L17).
function Get-DataIso([datetime]$Data) { return $Data.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture) }

function ConvertFrom-DataIso($Valoare) {
  if ($null -eq $Valoare) { return $null }
  if ($Valoare -is [datetime]) { return $Valoare.ToUniversalTime() }
  $s = [string]$Valoare
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  $d = [datetime]::MinValue
  if ([datetime]::TryParse($s, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$d)) {
    return $d.ToUniversalTime()
  }
  return $null
}

function Get-MinuteDeLa($Iso, [datetime]$Acum) {
  $d = ConvertFrom-DataIso $Iso
  if ($null -eq $d) { return $null }
  return ($Acum.ToUniversalTime() - $d).TotalMinutes
}

# ---------------------------------------------------------------------------------------------------------------------------
# Text: curatare ANSI si mascare inainte de orice scriere in jurnal (L10).
function Remove-Ansi([string]$Text) {
  if (-not $Text) { return '' }
  $t = [regex]::Replace($Text, '\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)?', '')   # OSC (inclusiv hyperlink-uri ]8;;URL)
  $t = [regex]::Replace($t, '\x1B\[[0-9;?]*[ -/]*[@-~]', '')              # CSI (culori, mutare cursor, stergere)
  $t = [regex]::Replace($t, '\x1B[0-9A-Za-z=>]', '')                      # ESC 7 / ESC 8 si alte secvente scurte
  $t = $t.Replace([string][char]27, '')
  return $t
}

function Format-Sigur([string]$Text, [int]$Max = 300) {
  if (-not $Text) { return '' }
  $t = Remove-Ansi $Text
  $t = [regex]::Replace($t, 'https?://\S+', '<url>')
  $t = [regex]::Replace($t, '\b(cse|session|env|sess|org|user|toolu|msg)_[A-Za-z0-9]{6,}', '<$1-id>')
  $t = [regex]::Replace($t, 'sk-ant-[A-Za-z0-9_-]+', '<token>')
  $t = [regex]::Replace($t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<email>')
  $t = [regex]::Replace($t, '\b[A-Za-z0-9_-]{40,}\b', '<lung>')
  $t = [regex]::Replace($t, '[\x00-\x1F\x7F]', ' ')
  $t = ([regex]::Replace($t, '\s+', ' ')).Trim()
  if ($t.Length -gt $Max) { $t = $t.Substring(0, $Max) + '...' }
  return $t
}

# "1m 30s" / "45s" / "2h 3m" / "500ms" / "12 minutes" -> secunde; $null daca nu recunoaste nimic (L13: necunoscut != 0).
function ConvertFrom-DurataText([string]$Text) {
  if (-not $Text) { return $null }
  $total = 0.0
  $gasit = $false
  $rx = '(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b'
  foreach ($m in [regex]::Matches($Text, $rx)) {
    $v = [double]::Parse($m.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    $u = $m.Groups[2].Value
    if ($u -match '^(milliseconds?|ms)$') { $total += $v / 1000 }
    elseif ($u -match '^(seconds?|secs?|s)$') { $total += $v }
    elseif ($u -match '^(minutes?|mins?|m)$') { $total += $v * 60 }
    elseif ($u -match '^(hours?|hrs?|h)$') { $total += $v * 3600 }
    else { $total += $v * 86400 }
    $gasit = $true
  }
  if (-not $gasit) { return $null }
  return $total
}

# ---------------------------------------------------------------------------------------------------------------------------
# Clasificarea unei linii din iesirea "claude remote-control" (CLI 2.1.319, iesire redirectata = tot ecranul TUI, fara ore).
# Ce scrie puntea (verificat in binarul CLI, functiile de afisare ale puntii):
#   - blocul de stare redesenat:      "<icon> Connected . <repo> . <branch>" / "<icon> Ready ..." (+ Capacity, sesiuni, QR)
#   - la pornire:                     "<spinner> Connecting . <repo> . <branch>"
#   - la fiecare reincercare:         "<spinner> Reconnecting . retrying in <X> . disconnected <Y>"  (Y = de cand e picata)
#                                      (cat timp e in "reconnecting", blocul "Connected" NU se mai redeseneaza)
#   - evenimente (raman pe ecran):    "[HH:MM:SS] Error: ..." / "[HH:MM:SS] Warning: ..." / "[HH:MM:SS] Reconnected after <X>"
#                                      / "[HH:MM:SS] Session failed: ..." / "[HH:MM:SS] Session completed (...)"
# Erorile "fatale" sunt cele dupa care CLI-ul cere repornirea ("Restart/Re-run `claude remote-control`", "giving up",
# "Remote Control stopped"); "Warning: ... Remote Control credential ..." = serverul respinge credentialul mediului.
# Continut extern = date (CLAUDE.md pct. 10): titlurile sesiunilor (scrise de utilizatori / derivate din primul mesaj) si
# activitatea lor apar in blocul de stare, INDENTATE (4 spatii). Evenimentele si starile CLI-ului incep mereu la coloana 0.
# De aceea o linie indentata nu e niciodata eveniment/stare: un titlu ca "[10:00:00] Error: giving up." nu poate porni o repornire.
# (Exceptie neacoperita: modul cu o singura sesiune, --capacity 1, pune titlul in linia de stare; puntile noastre au capacitatea 32.)
function Get-ClasaLinie([string]$Linie) {
  $brut = (Remove-Ansi $Linie).TrimEnd()
  $t = $brut.Trim()
  $r = [ordered]@{ Tip = 'altceva'; Durata = $null; Text = $t; Fatala = $false; Credential = $false }
  if (-not $t) { $r.Tip = 'gol'; return [pscustomobject]$r }
  if ($brut -match '^\s') { return [pscustomobject]$r }
  $m = [regex]::Match($t, '^\[\d{1,2}:\d{2}:\d{2}\]\s+(?<rest>.+)$')
  if ($m.Success) {
    $rest = $m.Groups['rest'].Value
    if ($rest -match '^Error:') {
      $r.Tip = 'eroare'
      $r.Fatala = [bool]($rest -match 'claude remote-control|giving up|Remote Control stopped')
      $r.Credential = [bool]($rest -match 'credential')
    } elseif ($rest -match '^Warning:') {
      $r.Tip = 'avertizare'
      $r.Credential = [bool]($rest -match 'Remote Control credential')
    } elseif ($rest -match '^Reconnected\b') {
      $r.Tip = 'reconectat'
    } elseif ($rest -match '^Session\b') {
      $r.Tip = 'sesiune'
    } else {
      $r.Tip = 'info'
    }
    return [pscustomobject]$r
  }
  # prefixul e [^A-Za-z0-9]* si nu \W*: iconita "bifa" e U+2714 + U+FE0E, iar .NET socoteste U+FE0E (marca Mn) caracter de cuvant
  $m = [regex]::Match($t, '^[^A-Za-z0-9]*Reconnecting\W+retrying in (?<i>.+?)\W+disconnected (?<d>.+)$')
  if ($m.Success) {
    $r.Tip = 'reconectare'
    $r.Durata = ConvertFrom-DurataText $m.Groups['d'].Value
    return [pscustomobject]$r
  }
  if ($t -match '^[^A-Za-z0-9]*Reconnecting\b') { $r.Tip = 'reconectare'; return [pscustomobject]$r }
  if ($t -match '^[^A-Za-z0-9]*Connecting\b') { $r.Tip = 'conectare'; return [pscustomobject]$r }
  if ($t -match '^[^A-Za-z0-9]*(Connected|Ready)(\W|$)') { $r.Tip = 'conectat'; return [pscustomobject]$r }
  return [pscustomobject]$r
}

# Clasificarea unei linii de pe STDERR a puntii (texte verbatim din CLI 2.1.319, verificate in binar; stderr e al CLI-ului,
# nu continut extern - textul se mascheaza oricum). "Exiting in about N seconds." e doar numaratoarea de dinaintea iesirii:
# cauza reala e linia de dinaintea ei (de aceea v2 scria in jurnal numai numaratoarea).
#   deja-servit      : 409 la inregistrare ("This folder is already served by another Claude Code on this device"),
#                      "Another `claude remote-control` instance (pid N) is already running in this directory",
#                      "Environment X is already being served by another `claude remote-control` instance (pid N)"
#   sesiune-negasita : la --session-id: "Session X not found. It may have been archived or expired." / "has no environment_id"
#                      / "Invalid session ID" / "No recent session found" -> id-ul nu mai e bun de reatasat
#   mediu-pierdut    : "Warning: Could not reuse the previous environment ..." -> sesiunile vechi au ramas fara mediu
function Get-ClasaStderr([string]$Linie) {
  $t = (Remove-Ansi $Linie).Trim()
  $r = [ordered]@{ Tip = 'altceva'; Text = (Format-Sigur $t 200); PidStrain = $null }
  if (-not $t) { $r.Tip = 'gol'; return [pscustomobject]$r }
  if ($t -match '^Exiting in about \d+ seconds?\.?$') { $r.Tip = 'iesire-programata'; return [pscustomobject]$r }
  $m = [regex]::Match($t, 'already served by another Claude Code on this device|Another `claude remote-control` instance \(pid (?<p>\d+)\) is already running in this directory|is already being served by another `claude remote-control` instance \(pid (?<p>\d+)\)')
  if ($m.Success) {
    $r.Tip = 'deja-servit'
    if ($m.Groups['p'].Success) { $r.PidStrain = [int]$m.Groups['p'].Value }
    return [pscustomobject]$r
  }
  if ($t -match '^Error: Session \S+ not found\. It may have been archived or expired\.|^Error: Session \S+ has no environment_id|^Error: Invalid session ID |^Error: No recent session found') {
    $r.Tip = 'sesiune-negasita'; return [pscustomobject]$r
  }
  if ($t -match '^Warning: Could not reuse the previous environment') { $r.Tip = 'mediu-pierdut'; return [pscustomobject]$r }
  return [pscustomobject]$r
}

# ---------------------------------------------------------------------------------------------------------------------------
# Starea unei punti (scrisa de releu in <DirStare>\<nume>.stare.json; citita de supervizor).
function New-StarePunte([string]$Nume, [int]$PidReleu, [string]$StartReleu, [datetime]$Acum) {
  @{
    versiune = $script:PuntiVersiune
    nume = $Nume
    pidReleu = $PidReleu; startReleu = $StartReleu
    pidClaude = 0; startClaude = $null
    pornitLa = (Get-DataIso $Acum)
    stare = 'pornire'; stareDeLa = (Get-DataIso $Acum)
    deconectatSec = 0
    ultimaIesire = $null
    eroareFatalaLa = $null; credentialLa = $null
    ultimaEroare = $null; ultimaEroareLa = $null
    codIesire = $null; iesitLa = $null
    # v3: modul puntii si ce a vazut releul pe stderr / in indicatorul CLI-ului
    mod = 'normal'; sesiuneReatasare = $null; argumente = $null
    indicator = $null                    # ultimul indicator citit (mediu, sesiune, sesiuniActive, pid, startIso, scrisLa)
    aFostConectat = $false
    dejaServit = $false; pidStrain = $null
    sesiuneNegasita = $false
    mediuPierdutLa = $null
    stderrUltimele = @()
  }
}

# Actualizeaza starea dupa o linie clasificata; intoarce mesajele (deja mascate) de scris in jurnal.
function Update-StareDinLinie([hashtable]$Stare, $Clasa, [datetime]$Acum) {
  $mes = New-Object System.Collections.ArrayList
  $iso = Get-DataIso $Acum
  switch ($Clasa.Tip) {
    'reconectare' {
      if ($Stare.stare -ne 'reconectare') {
        $Stare.stare = 'reconectare'; $Stare.stareDeLa = $iso
        [void]$mes.Add('deconectata, puntea reincearca singura')
      }
      if ($null -ne $Clasa.Durata) { $Stare.deconectatSec = [int][math]::Round($Clasa.Durata) }
    }
    'conectare' {
      if ($Stare.stare -eq 'pornire') { $Stare.stare = 'conectare'; $Stare.stareDeLa = $iso }
    }
    'conectat' {
      if ($Stare.stare -ne 'conectat') {
        $era = $Stare.stare
        $Stare.stare = 'conectat'; $Stare.stareDeLa = $iso; $Stare.deconectatSec = 0
        if ($era -eq 'reconectare') { [void]$mes.Add('conectata din nou') } else { [void]$mes.Add('conectata') }
      }
    }
    'reconectat' {
      # recuperare CONFIRMATA de punte ("[HH:MM:SS] Reconnected after X"): semnalele de problema anterioare nu mai sunt valabile
      # (Jakarinos r2 P1). Simpla redesenare "Connected" NU le sterge: ea apare si imediat dupa o eroare (vezi teste T3).
      $Stare.stare = 'conectat'; $Stare.stareDeLa = $iso; $Stare.deconectatSec = 0
      $Stare.eroareFatalaLa = $null; $Stare.credentialLa = $null
      [void]$mes.Add('reconectata: ' + (Format-Sigur $Clasa.Text 120))
    }
    'eroare' {
      $Stare.ultimaEroare = Format-Sigur $Clasa.Text; $Stare.ultimaEroareLa = $iso
      if ($Clasa.Fatala -and -not $Stare.eroareFatalaLa) { $Stare.eroareFatalaLa = $iso }
      if ($Clasa.Credential -and -not $Stare.credentialLa) { $Stare.credentialLa = $iso }
      [void]$mes.Add('EROARE punte: ' + $Stare.ultimaEroare)
    }
    'avertizare' {
      if ($Clasa.Credential -and -not $Stare.credentialLa) { $Stare.credentialLa = $iso }
      [void]$mes.Add('avertizare punte: ' + (Format-Sigur $Clasa.Text))
    }
    'sesiune' { [void]$mes.Add('sesiune: ' + (Format-Sigur $Clasa.Text 160)) }
    'info' { [void]$mes.Add('info punte: ' + (Format-Sigur $Clasa.Text 160)) }
  }
  if ($Clasa.Tip -ne 'gol') { $Stare.ultimaIesire = $iso }
  if ($Stare.stare -eq 'conectat') { $Stare.aFostConectat = $true }
  return $mes.ToArray()   # apelantii folosesc @(...) (fara virgula unara: @() ar dubla tabloul in PS 5.1)
}

# Actualizeaza starea dupa o linie de pe stderr (clasificata cu Get-ClasaStderr); intoarce mesajele (mascate) pentru jurnal.
function Update-StareDinStderr([hashtable]$Stare, $Clasa, [datetime]$Acum) {
  $mes = New-Object System.Collections.ArrayList
  if ($Clasa.Tip -eq 'gol') { return $mes.ToArray() }
  $iso = Get-DataIso $Acum
  $Stare.stderrUltimele = @(@(@($Stare.stderrUltimele) + @($Clasa.Text)) | Where-Object { $_ } | Select-Object -Last 5)
  $Stare.ultimaIesire = $iso
  switch ($Clasa.Tip) {
    'iesire-programata' { }   # doar numaratoarea; cauza e in linia anterioara (ramasa in ultimaEroare)
    'deja-servit' {
      $Stare.dejaServit = $true
      if ($null -ne $Clasa.PidStrain) { $Stare.pidStrain = [int]$Clasa.PidStrain }
      $Stare.ultimaEroare = $Clasa.Text; $Stare.ultimaEroareLa = $iso
      [void]$mes.Add('folderul e deja servit de alta punte (spune CLI-ul): ' + $Clasa.Text)
    }
    'sesiune-negasita' {
      $Stare.sesiuneNegasita = $true
      $Stare.ultimaEroare = $Clasa.Text; $Stare.ultimaEroareLa = $iso
      [void]$mes.Add('sesiunea de reatasat nu mai exista (spune CLI-ul): ' + $Clasa.Text)
    }
    'mediu-pierdut' {
      if (-not $Stare.mediuPierdutLa) { $Stare.mediuPierdutLa = $iso }
      [void]$mes.Add('AVERTISMENT CLI: mediul vechi nu s-a putut refolosi, sesiunile dinainte nu se reconecteaza singure: ' + $Clasa.Text)
    }
    default {
      $Stare.ultimaEroare = $Clasa.Text; $Stare.ultimaEroareLa = $iso
      [void]$mes.Add('stderr punte: ' + $Clasa.Text)
    }
  }
  return $mes.ToArray()
}

# ---------------------------------------------------------------------------------------------------------------------------
# Decizii (pure). Problemele care cer repornire la o punte VIE vin DOAR din semnale explicite ale puntii (nu din tacere):
#   1. "Reconnecting ... disconnected Y" ca ultima stare, de >= 10 min (dupa ceasul nostru SAU dupa Y raportat de punte);
#      CLI-ul renunta singur dupa 10 min (iese), dar NU si cat serveste o sesiune de proiect -> atunci ramane viu si picat;
#   2. eroare fatala ("... claude remote-control ..." / "giving up") si procesul tot viu dupa 10 min, fara "Reconnected" dupa ea
#      (dupa o eroare fatala bucla puntii s-a oprit; daca procesul nu iese, nu mai serveste nimic);
#   3. login-ul contului a fost invalid/expirat cat puntea rula si acum e valid din nou (puntea veche nu se reface singura).
# NU e regula de repornire: "Warning: ... Remote Control credential ..." (Jakarinos r2 P1). E o pauza a CLI-ului (pana la ~1 h),
# dupa care reincearca singur; recuperarea nu se vede in iesire (fara --verbose), deci o repornire la 10 min ar putea ucide o
# punte deja refacuta. Daca problema persista, CLI-ul ajunge la "could not renew ... after repeated attempts" (eroare fatala) si
# iese -> regulile de mai sus. Avertismentul ramane doar in jurnal si in stare (credentialLa), pentru diagnostic.
function Get-ProblemaPunte([hashtable]$Stare, [datetime]$Acum, $LoginRevalidatLa) {
  if ($null -eq $Stare) { return $null }
  if ($Stare.stare -eq 'reconectare') {
    $min = Get-MinuteDeLa $Stare.stareDeLa $Acum
    if ($null -eq $min) { $min = 0 }
    $raportat = 0.0
    if ($Stare.deconectatSec) { $raportat = [double]$Stare.deconectatSec / 60 }
    $m = [math]::Max($min, $raportat)
    if ($m -ge $script:PragProblemaMin) {
      return [pscustomobject]@{ Motiv = ('deconectata de {0:N0} min' -f $m); CereInternetStabil = $true }
    }
  }
  $f = Get-MinuteDeLa $Stare.eroareFatalaLa $Acum
  if ($null -ne $f -and $f -ge $script:PragProblemaMin) {
    return [pscustomobject]@{ Motiv = ('eroare fatala de {0:N0} min, procesul a ramas viu' -f $f); CereInternetStabil = $false }
  }
  $rev = ConvertFrom-DataIso $LoginRevalidatLa
  $porn = ConvertFrom-DataIso $Stare.pornitLa
  if ($null -ne $rev -and $null -ne $porn -and $porn -lt $rev) {
    return [pscustomobject]@{ Motiv = 'login reinnoit dupa expirare; puntea pornita inainte nu se reface singura'; CereInternetStabil = $false }
  }
  return $null
}

# ---------------------------------------------------------------------------------------------------------------------------
# Memoria supervizorului despre o punte (supervizor.json -> punti[nume]): mediul si sesiunile cunoscute + reatasarea in curs.
#   mediu / sesiune / sesiuniActive / cunoscutLa : din indicatorul CLI-ului (adoptat la pornire, intretinut cat puntea e vie)
#   negasite  { id = ora } : sesiuni pe care CLI-ul nu le-a mai gasit (arhivate/expirate) - nu se mai incearca
#   renuntari { id = ora } : sesiuni la care reatasarea a esuat de MaxIncercariReatasare ori - nu se mai incearca
#   mediuPierdutTratatLa   : avertismentul CLI "Could not reuse" deja tratat (nu porneste a doua reatasare pentru acelasi)
#   reatasare { sesiune; mediuVechi; mediuNou; pas; incercari; candidati; deLa; mediuReatasat }
#     pasii: cerut (decizia porneste puntea cu --session-id) -> in-curs (pornita) -> conectata (s-a conectat: mediul sesiunii
#            e reinviat) -> revenire (puntea normala pornita, va refolosi mediul) -> gata (mediul puntii normale = cel reatasat)
function New-MemoriePunte {
  @{ mediu = $null; sesiune = $null; sesiuniActive = @(); cunoscutLa = $null; negasite = @{}; renuntari = @{}; mediuPierdutTratatLa = $null; reatasare = $null
     # jetonul intoarcerii (plafonul 3/ora bugetat pe dus-intors): ora unei intrari din istoric rezervata pentru intoarcerea la puntea normala.
     # Se pune la plecare (--session-id), se MUTA la ora reala a intoarcerii cand aceea porneste (revenirePornita), se elibereaza (intrarea e scoasa)
     # daca dus-intorsul se incheie fara intoarcere, si se uita (intrarea ramane: e o pornire reala) dupa ce intoarcerea a pornit.
     rezervareRevenire = $null; revenirePornita = $false }
}

# Jetonul intoarcerii e inca in fereastra de 60 min? ($Istoric = lista ISO sau datetime-urile curatate de Test-PotPorni)
function Test-JetonPrezent([hashtable]$Mem, $Istoric) {
  if ($null -eq $Mem -or -not $Mem.rezervareRevenire) { return $false }
  $tk = ConvertFrom-DataIso $Mem.rezervareRevenire
  if ($null -eq $tk) { return $false }
  foreach ($x in @($Istoric)) { $d = ConvertFrom-DataIso $x; if ($null -ne $d -and $d -eq $tk) { return $true } }
  return $false
}

function Get-MemoriePunte([hashtable]$Sup, [string]$Nume) {
  $m = New-MemoriePunte
  if ($null -eq $Sup.punti -or $Sup.punti -isnot [hashtable]) { $Sup.punti = @{} }
  $vechi = $Sup.punti[$Nume]
  if ($vechi -is [hashtable]) { foreach ($k in @($vechi.Keys)) { $m[$k] = $vechi[$k] } }
  foreach ($k in 'negasite', 'renuntari') { if ($m[$k] -isnot [hashtable]) { $m[$k] = @{} } }
  if ($null -ne $m.reatasare -and $m.reatasare -isnot [hashtable]) { $m.reatasare = $null }
  $m.sesiuniActive = @(@($m.sesiuniActive) | Where-Object { Test-IdSigur ([string]$_) })
  $Sup.punti[$Nume] = $m
  return $m
}

# Sesiunile care merita reatasate, in ordinea incercarii: sesiunea principala din indicator, apoi cele active cunoscute.
function Get-SesiuniDeReatasat([hashtable]$Mem) {
  $l = New-Object System.Collections.ArrayList
  foreach ($s in @(@($Mem.sesiune) + @($Mem.sesiuniActive))) {
    $id = [string]$s
    if (-not (Test-IdSigur $id)) { continue }
    if ($Mem.negasite -and $Mem.negasite.ContainsKey($id)) { continue }
    if ($Mem.renuntari -and $Mem.renuntari.ContainsKey($id)) { continue }
    if (-not $l.Contains($id)) { [void]$l.Add($id) }
  }
  return $l.ToArray()   # apelantii folosesc @(...)
}

# Adopta indicatorul: mediul si sesiunile lui devin "cunoscute" (sesiunile stiute dinainte raman in lista, fara dubluri).
function Set-MemorieDinIndicator([hashtable]$Mem, $Ind, [datetime]$Acum) {
  if ($null -eq $Ind -or -not (Test-IdSigur ([string]$Ind.mediu))) { return }
  $Mem.mediu = [string]$Ind.mediu
  $vechi = @()
  if (Test-IdSigur ([string]$Ind.sesiune)) {
    # sesiunea principala de pana acum ramane cunoscuta (candidata de rezerva) cand puntea noua si-a creat alta
    if ((Test-IdSigur ([string]$Mem.sesiune)) -and [string]$Mem.sesiune -ne [string]$Ind.sesiune) { $vechi = @([string]$Mem.sesiune) }
    $Mem.sesiune = [string]$Ind.sesiune
  }
  $toate = @(@(@($Mem.sesiuniActive) + $vechi + @($Ind.sesiuniActive)) | ForEach-Object { [string]$_ } | Where-Object { Test-IdSigur $_ } | Select-Object -Unique)
  if ($toate.Count -gt $script:MaxSesiuniRetinute) { $toate = @($toate | Select-Object -Last $script:MaxSesiuniRetinute) }
  $Mem.sesiuniActive = $toate
  $Mem.cunoscutLa = Get-DataIso $Acum
}

# O incercare de reatasare a esuat: a doua esuare pe aceeasi sesiune = renunt (sesiunea ramane de verificat in aplicatie).
function Set-EsecReatasare([hashtable]$Mem, [hashtable]$R, [string]$Iso, [string]$Motiv) {
  $R.incercari = [int]$R.incercari + 1
  if ($R.incercari -lt $script:MaxIncercariReatasare) {
    $R.pas = 'cerut'
    return ('reatasare: {0}; incerc din nou sesiunea {1} ({2}/{3})' -f $Motiv, $R.sesiune, $R.incercari, $script:MaxIncercariReatasare)
  }
  $Mem.renuntari[[string]$R.sesiune] = $Iso
  $Mem.reatasare = $null
  $Mem.mediu = $null   # mediul curent al puntii normale va fi adoptat la urmatoarea rulare
  return ('reatasare: {0}; renunt dupa {1} incercari - sesiunea {2} ramane de verificat in aplicatie; retin mediul nou' -f $Motiv, $R.incercari, $R.sesiune)
}

# Reatasarea: actualizeaza memoria dupa starea curenta a puntii (scrisa de releu); intoarce mesajele (mascate) pentru jurnal.
# $Stare poate fi $null; $Vie = releu + punte vii. Deciziile se iau dupa aceea in Get-DecizieSupraveghere, din Mem.reatasare.
function Update-Reatasare([hashtable]$Mem, [hashtable]$Stare, [bool]$Vie, [datetime]$Acum) {
  $mes = New-Object System.Collections.ArrayList
  $iso = Get-DataIso $Acum
  $R = $Mem.reatasare
  $ind = $null
  if ($Stare -and $Stare.indicator -is [hashtable]) { $ind = $Stare.indicator }
  # indicatorul e al puntii noastre (scris de claude.exe-ul releului), nu al altcuiva
  $alNostru = ($null -ne $ind -and $Stare -and [int]$ind.pid -gt 0 -and [int]$ind.pid -eq [int]$Stare.pidClaude -and (Test-IdSigur ([string]$ind.mediu)))
  $mod = 'normal'
  if ($Stare -and $Stare.mod) { $mod = [string]$Stare.mod }

  if ($mod -eq 'reatasare') {
    if ($null -eq $R) { return $mes.ToArray() }   # stare de reatasare fara reatasare in memorie: decizia o readuce la normal
    if ([string]$Stare.sesiuneReatasare -ne [string]$R.sesiune) { return $mes.ToArray() }   # punte de reatasare pentru alta sesiune (veche)
    if ($Vie) {
      if ($Stare.stare -eq 'conectat' -or $Stare.aFostConectat) {
        if ($R.pas -ne 'conectata') {
          $R.pas = 'conectata'; $R.conectataLa = $iso
          [void]$mes.Add(('reatasare: puntea cu sesiunea {0} s-a conectat (mediul ei e din nou viu); la rularea urmatoare revin la puntea normala, cu toate sesiunile' -f $R.sesiune))
        }
      } elseif ($R.pas -eq 'in-curs') {
        $min = Get-MinuteDeLa $Stare.pornitLa $Acum
        if ($null -ne $min -and $min -ge $script:PragReatasareMin) {
          [void]$mes.Add((Set-EsecReatasare $Mem $R $iso ('puntea de reatasare nu s-a conectat in {0:N0} min' -f $min)))
        }
      }
      return $mes.ToArray()
    }
    # puntea de reatasare a iesit: iesirea ei se trateaza O data (starea ramane pe disc si la rularile urmatoare, de ex. cat
    # asteptam plafonul 3/ora; altfel fiecare rulare ar "arde" o candidata sau ar numara o incercare in plus)
    $cheieIesire = [string]$Stare.pidClaude + '@' + [string]$Stare.iesitLa
    if ([string]$R.iesireTratata -eq $cheieIesire) { return $mes.ToArray() }
    $R.iesireTratata = $cheieIesire
    if ($R.pas -eq 'conectata' -or $Stare.aFostConectat) {
      # s-a conectat (mediul sesiunii e reinviat), apoi a iesit (modul cu o sesiune iese cand sesiunea se termina): revin la normal
      if ($R.pas -ne 'conectata') { $R.pas = 'conectata'; $R.conectataLa = $iso }
    } elseif ($Stare.sesiuneNegasita) {
      $Mem.negasite[[string]$R.sesiune] = $iso
      $R.candidati = [int]$R.candidati + 1
      $urm = @(Get-SesiuniDeReatasat $Mem | Select-Object -First 1)
      if ($urm.Count -gt 0 -and $R.candidati -lt $script:MaxCandidatiReatasare) {
        [void]$mes.Add(('reatasare: sesiunea {0} nu mai exista (arhivata/expirata); incerc sesiunea {1}' -f $R.sesiune, $urm[0]))
        $R.sesiune = $urm[0]; $R.pas = 'cerut'; $R.incercari = 0
      } else {
        [void]$mes.Add(('reatasare: sesiunea {0} nu mai exista (arhivata/expirata) si nu mai am alta de incercat; retin mediul nou' -f $R.sesiune))
        $Mem.reatasare = $null; $Mem.mediu = $null
      }
    } elseif ($Stare.dejaServit) {
      # altcineva serveste folderul: reatasarea ramane ceruta; decizia asteapta eliberarea folderului (vezi dejaServit)
      if ($R.pas -eq 'in-curs') { $R.pas = 'cerut' }
    } elseif ($R.pas -eq 'in-curs') {
      [void]$mes.Add((Set-EsecReatasare $Mem $R $iso ('puntea de reatasare a iesit (cod {0}) fara sa se conecteze' -f $Stare.codIesire)))
    }
    return $mes.ToArray()
  }

  # --- punte normala (sau fara stare) ---
  if ($null -ne $R) {
    if ($R.pas -eq 'in-curs') {
      # puntea de reatasare nu a ajuns sa scrie stare (pornirea a esuat): numar incercarea si cer din nou
      [void]$mes.Add((Set-EsecReatasare $Mem $R $iso 'puntea de reatasare nu a pornit'))
      return $mes.ToArray()
    }
    if (($R.pas -eq 'revenire' -or $R.pas -eq 'conectata') -and $Vie) {
      # revenirea se incheie cu un rezultat EXPLICIT, cu termen (Jakarinos r1 P1): confirmat (indicatorul puntii noastre = mediul
      # reatasat), esuat (alt mediu / CLI-ul spune ca nu a putut refolosi) sau necunoscut (fara indicator al ei dupa PragReatasareMin)
      if ($Stare.mediuPierdutLa -and [string]$Stare.mediuPierdutLa -ne [string]$Mem.mediuPierdutTratatLa) {
        $Mem.mediuPierdutTratatLa = $Stare.mediuPierdutLa
        [void]$mes.Add((Set-EsecReatasare $Mem $R $iso 'CLI-ul spune ca puntea normala nu a putut refolosi mediul reatasat'))
        return $mes.ToArray()
      }
      if ($Stare.stare -eq 'conectat') {
        if ($alNostru) {
          if (-not $R.mediuReatasat -or [string]$ind.mediu -eq [string]$R.mediuReatasat) {
            Set-MemorieDinIndicator $Mem $ind $Acum
            $Mem.reatasare = $null
            [void]$mes.Add(('reatasare incheiata: sesiunea {0} e servita din nou, puntea normala refoloseste mediul ei' -f $R.sesiune))
          } else {
            [void]$mes.Add((Set-EsecReatasare $Mem $R $iso 'puntea normala a primit alt mediu decat cel reatasat'))
          }
        } else {
          $min = Get-MinuteDeLa $Stare.pornitLa $Acum
          if ($null -ne $min -and $min -ge $script:PragReatasareMin) {
            [void]$mes.Add((Set-EsecReatasare $Mem $R $iso ('nu pot confirma mediul puntii normale dupa {0:N0} min (indicatorul lipseste sau nu e al ei) - rezultat necunoscut' -f $min)))
          }
        }
      }
    }
    return $mes.ToArray()   # cerut: decizia porneste reatasarea; conectata/revenire fara punte conectata: astept
  }

  # fara reatasare in curs: a pierdut puntea noastra mediul in care erau sesiunile cunoscute?
  $pierdut = [bool]($Stare -and $Stare.mediuPierdutLa -and ([string]$Stare.mediuPierdutLa -ne [string]$Mem.mediuPierdutTratatLa))
  $diferit = [bool]($alNostru -and (Test-IdSigur ([string]$Mem.mediu)) -and ([string]$ind.mediu -ne [string]$Mem.mediu))
  if ($pierdut) { $Mem.mediuPierdutTratatLa = $Stare.mediuPierdutLa }
  if ($pierdut -or $diferit) {
    $cand = @(Get-SesiuniDeReatasat $Mem)
    $nou = 'necunoscut'
    if ($alNostru) { $nou = [string]$ind.mediu }
    if ($cand.Count -gt 0 -and (Test-IdSigur ([string]$Mem.mediu))) {
      $Mem.reatasare = @{ sesiune = $cand[0]; mediuVechi = $Mem.mediu; mediuNou = $nou; pas = 'cerut'; incercari = 0; candidati = 0; deLa = $iso; mediuReatasat = $null }
      [void]$mes.Add(('mediul puntii s-a schimbat ({0} -> {1}): sesiunile vechi nu se mai pot conecta ("Environment deleted" in aplicatie); reatasez sesiunea {2}' -f $Mem.mediu, $nou, $cand[0]))
    } else {
      if ($alNostru) { Set-MemorieDinIndicator $Mem $ind $Acum }
      [void]$mes.Add('mediul puntii s-a schimbat, dar nu stiu nicio sesiune de reatasat; retin mediul nou')
    }
    return $mes.ToArray()
  }
  if ($alNostru -and $Vie) { Set-MemorieDinIndicator $Mem $ind $Acum }   # prima data sau acelasi mediu: retin / completez sesiunile
  return $mes.ToArray()
}

# Limita de porniri: fereastra glisanta. Intoarce Permis + istoricul curatat (doar ultimele 60 min).
function Test-PotPorni($Istoric, [datetime]$Acum, [int]$Max = $script:MaxPorniriPeOra, [int]$FereastraMin = 60) {
  $acumU = $Acum.ToUniversalTime()
  $curat = @(@($Istoric) | ForEach-Object { ConvertFrom-DataIso $_ } | Where-Object { $null -ne $_ -and ($acumU - $_).TotalMinutes -lt $FereastraMin -and $_ -le $acumU.AddMinutes(1) })
  return [pscustomobject]@{ Permis = ($curat.Count -lt $Max); Numar = $curat.Count; Istoric = $curat }
}

# Decizia pentru o punte. Actiune: nimic | porneste | reporneste | asteapta. Mod: normal | reatasare (+ Sesiune).
#   $Strain = alta punte (din afara releului) serveste folderul (indicatorul CLI-ului are un scriitor viu) -> nimic, ca la "veche".
#   $Mem = memoria puntii (Get-MemoriePunte), cu reatasarea in curs (pas 'cerut' = pornim puntea cu --session-id).
#   Puntea de reatasare (Stare.mod = 'reatasare') NU trece prin regulile de problema (in modul cu o sesiune titlul sesiunii
#   sta chiar in linia de stare, deci clasificarea nu e sigura); ea traieste cel mult pana la rularea urmatoare.
function Get-DecizieSupraveghere {
  param(
    $Punte, [hashtable]$Stare,
    [bool]$ReleuViu, [bool]$ClaudeViu, [string]$Veche,
    [bool]$InternetOk, [double]$InternetStabilMin,
    $LoginValid, $LoginRevalidatLa,
    $Istoric, [datetime]$Acum,
    [hashtable]$Mem = $null, [string]$Strain = ''
  )
  $d = [ordered]@{ Actiune = 'nimic'; Motiv = ''; LimitaAtinsa = $false; CereInternetStabil = $false; Mod = 'normal'; Sesiune = $null; DejaServit = $false; Revenire = $false }
  if ($Veche) { $d.Motiv = "punte veche activa ($Veche); nu pornesc dublura"; return [pscustomobject]$d }
  if ($Strain) { $d.Motiv = "$Strain; nu pornesc dublura"; return [pscustomobject]$d }
  $R = $null
  if ($Mem -and $Mem.reatasare -is [hashtable]) { $R = $Mem.reatasare }
  $modStare = 'normal'
  if ($Stare -and $Stare.mod) { $modStare = [string]$Stare.mod }
  $vie = $ReleuViu -and $ClaudeViu
  if ($vie) {
    if ($modStare -eq 'reatasare') {
      if ($R -and $R.pas -eq 'conectata') { $d.Motiv = ('reatasare: sesiunea {0} e servita din nou; revin la puntea normala (toate sesiunile)' -f $R.sesiune); $tinta = 'reporneste'; $d.Revenire = $true }
      elseif ($R -and $R.pas -eq 'cerut') { $d.Motiv = ('reatasare: incerc din nou sesiunea {0}' -f $R.sesiune); $tinta = 'reporneste'; $d.Mod = 'reatasare'; $d.Sesiune = [string]$R.sesiune }
      elseif ($null -eq $R) { $d.Motiv = 'punte de reatasare fara reatasare in memorie; revin la puntea normala'; $tinta = 'reporneste' }
      else { return [pscustomobject]$d }   # in-curs: astept conectarea (cel mult PragReatasareMin, apoi Update-Reatasare o declara esuata)
    } elseif ($R -and $R.pas -eq 'cerut') {
      $d.Motiv = ('mediul sesiunilor vechi s-a pierdut; reatasez sesiunea {0}' -f $R.sesiune); $tinta = 'reporneste'; $d.Mod = 'reatasare'; $d.Sesiune = [string]$R.sesiune
    } else {
      $p = Get-ProblemaPunte -Stare $Stare -Acum $Acum -LoginRevalidatLa $LoginRevalidatLa
      if ($null -eq $p) { return [pscustomobject]$d }
      $d.Motiv = $p.Motiv
      $d.CereInternetStabil = $p.CereInternetStabil
      $tinta = 'reporneste'
    }
  } else {
    # oricare din cele doua procese inca viu -> "reporneste" (oprire verificata a ce a ramas, apoi releu nou), niciodata "porneste":
    # un releu nou langa o punte orfana ar porni a doua punte pe acelasi folder (Jakarinos r1 P1)
    $tinta = 'reporneste'
    if ($ClaudeViu) { $d.Motiv = 'releul a murit; puntea ramasa fara releu nu mai e supravegheata (iesirea ei nu mai e citita)' }
    elseif ($ReleuViu) { $d.Motiv = 'releul e viu dar puntea nu' }
    elseif ($Stare -and $Stare.stare -eq 'oprit') { $d.Motiv = ('puntea s-a oprit (cod {0})' -f $Stare.codIesire); $tinta = 'porneste' }
    else { $d.Motiv = 'puntea lipseste'; $tinta = 'porneste' }
    if ($Stare -and $Stare.dejaServit -and -not $ClaudeViu -and -not $ReleuViu) {
      # CLI-ul a spus la ultima pornire ca folderul e servit de alta punte (pe care n-o vedem): fara repornire la fiecare 5 min
      $m = Get-MinuteDeLa $Stare.iesitLa $Acum
      if ($null -eq $m -or $m -lt $script:PragDejaServitMin) {
        $d.Actiune = 'asteapta'; $d.DejaServit = $true
        $d.Motiv = ('folderul era servit de alta punte la ultima pornire (spune CLI-ul); nu pornesc dublura, reincerc dupa {0} min' -f $script:PragDejaServitMin)
        return [pscustomobject]$d
      }
    }
    if ($R -and $R.pas -eq 'cerut') { $d.Mod = 'reatasare'; $d.Sesiune = [string]$R.sesiune; $d.Motiv += ('; reatasez sesiunea {0}' -f $R.sesiune) }
    elseif ($R -and $R.pas -eq 'conectata' -and $modStare -eq 'reatasare') { $d.Revenire = $true; $d.Motiv += ('; reatasare: revin la puntea normala pentru sesiunea {0}' -f $R.sesiune) }
  }
  if (-not $InternetOk) { $d.Actiune = 'asteapta'; $d.Motiv += '; fara internet'; return [pscustomobject]$d }
  if ($d.CereInternetStabil -and $InternetStabilMin -lt $script:InternetStabilMin) {
    $d.Actiune = 'asteapta'; $d.Motiv += ('; internetul e inapoi doar de {0:N0} min' -f $InternetStabilMin); return [pscustomobject]$d
  }
  if ($LoginValid -eq $false) { $d.Actiune = 'asteapta'; $d.Motiv += '; login expirat/invalid - repornirea nu ajuta, vezi alarma'; return [pscustomobject]$d }
  # Plafonul 3/ora, bugetat pe toata succesiunea (Jakarinos r1 P2): reatasarea = 2 porniri (dus cu --session-id + intors la normal);
  # porneste doar daca incap AMANDOUA, iar intoarcerea e rezervata atunci (nu mai consuma la randul ei) -> puntea cu o singura
  # sesiune nu ramane blocata de plafon. Nimic nu ocoleste plafonul: 2 rezervari = 2 porniri reale.
  $lim = Test-PotPorni -Istoric $Istoric -Acum $Acum
  $rezervat = Test-JetonPrezent -Mem $Mem -Istoric $lim.Istoric   # jetonul expirat din fereastra nu mai conteaza: intoarcerea costa o pornire
  $necesar = 1
  if ($d.Mod -eq 'reatasare' -and -not $rezervat) { $necesar = 2 }   # dus + intors; o noua incercare refoloseste intoarcerea deja rezervata
  if ($d.Revenire -and $rezervat) { $necesar = 0 }
  if ($lim.Numar + $necesar -gt $script:MaxPorniriPeOra) {
    $d.Actiune = 'asteapta'; $d.LimitaAtinsa = $true
    if ($necesar -eq 2) { $d.Motiv += ('; reatasarea cere {0} porniri (dus si intors) in plafonul de {1}/ora - amanata' -f $necesar, $script:MaxPorniriPeOra) }
    else { $d.Motiv += ('; limita de {0} porniri/ora atinsa - doar avertisment' -f $script:MaxPorniriPeOra) }
    return [pscustomobject]$d
  }
  $d.Actiune = $tinta
  return [pscustomobject]$d
}

# ---------------------------------------------------------------------------------------------------------------------------
# Login: interpretarea "claude auth status --json". Eroare/JSON stricat = NECUNOSCUT ($null), nu invalid (L05, L18).
function Get-StareLoginDinJson([string]$Json, [datetime]$Acum) {
  $r = [ordered]@{ Valid = $null; LoggedIn = $null; ExpiraLa = $null; Metoda = $null; Eroare = $null }
  if ([string]::IsNullOrWhiteSpace($Json)) { $r.Eroare = 'raspuns gol'; return [pscustomobject]$r }
  try { $o = $Json | ConvertFrom-Json -ErrorAction Stop } catch { $r.Eroare = 'JSON invalid'; return [pscustomobject]$r }
  if ($null -eq $o -or $null -eq $o.PSObject.Properties['loggedIn']) { $r.Eroare = 'lipseste loggedIn'; return [pscustomobject]$r }
  $r.LoggedIn = [bool]$o.loggedIn
  if ($o.PSObject.Properties['authMethod']) { $r.Metoda = [string]$o.authMethod }
  if ($o.PSObject.Properties['loginExpiresAt'] -and $o.loginExpiresAt) {
    $r.ExpiraLa = ConvertFrom-DataIso $o.loginExpiresAt
    if ($null -eq $r.ExpiraLa) { $r.Eroare = 'loginExpiresAt necitibil' }
  }
  if (-not $r.LoggedIn) { $r.Valid = $false; return [pscustomobject]$r }
  if ($r.Metoda -and $r.Metoda -ne 'claude.ai') { $r.Valid = $false; $r.Eroare = 'logare care nu e claude.ai (remote-control cere login complet)'; return [pscustomobject]$r }
  if ($null -ne $r.ExpiraLa -and $r.ExpiraLa -le $Acum.ToUniversalTime()) { $r.Valid = $false; return [pscustomobject]$r }
  $r.Valid = $true
  return [pscustomobject]$r
}

# Textul alarmei (sau $null daca nu e nimic de semnalat). $Conturi: hashtable cheie -> @{Valid; ExpiraLa}.
function Get-TextAlarmaLogin([hashtable]$Conturi, $Config, [datetime]$Acum, [int]$Zile = $script:ZileAlarmaLogin) {
  $randuri = New-Object System.Collections.ArrayList
  foreach ($k in @($Conturi.Keys | Sort-Object)) {
    $c = $Conturi[$k]
    $et = Get-EtichetaCont $k $Config
    $exp = ConvertFrom-DataIso $c.ExpiraLa
    $cfgCmd = ''
    if ($k -ne 'implicit') { $cfgCmd = "`$env:CLAUDE_CONFIG_DIR='$k'; " }
    $cum = "Reinnoire (Razvan, pe server, PowerShell): ${cfgCmd}claude auth login  -> apoi puntile se repornesc singure in max. 5 min."
    if ($c.Valid -eq $false) {
      $txt = "EXPIRAT/INVALID: $et."
      if ($exp) { $txt += ' loginExpiresAt = ' + $exp.ToLocalTime().ToString('dd.MM.yyyy HH:mm') + ' (ora serverului).' }
      [void]$randuri.Add($txt); [void]$randuri.Add('  ' + $cum)
    } elseif ($null -ne $exp) {
      $ramas = ($exp - $Acum.ToUniversalTime()).TotalDays
      if ($ramas -le $Zile) {
        [void]$randuri.Add(('EXPIRA CURAND: {0} expira la {1} (ora serverului), peste {2:N1} zile.' -f $et, $exp.ToLocalTime().ToString('dd.MM.yyyy HH:mm'), $ramas))
        [void]$randuri.Add('  ' + $cum)
      }
    }
  }
  if ($randuri.Count -eq 0) { return $null }
  $antet = @('ALARMA LOGIN puntile Remote Control (server Gazpet-Claude)', ('generat: ' + (Get-Date $Acum.ToLocalTime() -Format 'yyyy-MM-dd HH:mm')))
  return (($antet + $randuri.ToArray()) -join "`r`n") + "`r`n"
}

# Tokenul (setup-token) NU tine remote-control (test 08.11.2026) -> puntile raman pe logarea normala, cu alarma la expirare.
function Get-PlanAutentificare([bool]$ExistaFisierToken, [bool]$TokenTine = $script:TokenTineRemoteControl) {
  if ($TokenTine -and $ExistaFisierToken) {
    return [pscustomobject]@{ FolosesteToken = $true; Avertizare = $null }
  }
  if ($TokenTine -and -not $ExistaFisierToken) {
    return [pscustomobject]@{ FolosesteToken = $false; Avertizare = 'fisierul cu tokenul lipseste: puntile raman pe logarea normala (vezi alarma de expirare)' }
  }
  return [pscustomobject]@{ FolosesteToken = $false; Avertizare = 'puntile folosesc logarea normala: tokenul setup-token nu tine remote-control (test 08.11.2026); urmariti alarma de expirare' }
}

# Mediul procesului punte: copie a mediului curent FARA variabilele care strica puntea sau vin dintr-o sesiune Claude parinte.
#   - CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN: cu ele puntea refuza sa porneasca (sau foloseste API-ul) -> scoase mereu;
#   - alte CLAUDE* / ANTHROPIC* mostenite de la o sesiune (CLAUDECODE, CLAUDE_CODE_ENTRYPOINT ...) -> scoase, daca nu sunt setate permanent (User/Machine);
#   - CLAUDE_CONFIG_DIR: setat explicit per punte sau scos (altfel o rulare manuala din sesiunea Redari ar porni Chat-ul pe contul redari@).
function Get-MediuCopil([hashtable]$Curent, [string[]]$NumePermanente, [string]$ConfigDir) {
  $interzise = @('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')
  $perm = @{}
  foreach ($n in @($NumePermanente)) { if ($n) { $perm[$n.ToUpperInvariant()] = $true } }
  $rez = @{}
  $avert = New-Object System.Collections.ArrayList
  foreach ($k in @($Curent.Keys)) {
    $ku = ([string]$k).ToUpperInvariant()
    if ($interzise -contains $ku) {
      if ($perm.ContainsKey($ku)) { [void]$avert.Add("variabila $ku e setata permanent pe server; o scot din mediul puntii (altfel puntea refuza)") }
      continue
    }
    if ($ku -eq 'CLAUDE_CONFIG_DIR') { continue }
    if (($ku.StartsWith('CLAUDE') -or $ku.StartsWith('ANTHROPIC')) -and -not $perm.ContainsKey($ku)) { continue }
    $rez[[string]$k] = [string]$Curent[$k]
  }
  if (-not [string]::IsNullOrWhiteSpace($ConfigDir)) { $rez['CLAUDE_CONFIG_DIR'] = $ConfigDir }
  return [pscustomobject]@{ Mediu = $rez; Avertizari = $avert.ToArray() }
}

function Get-MediuCopilReal([string]$ConfigDir) {
  $cur = @{}
  foreach ($e in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) { $cur[[string]$e.Key] = [string]$e.Value }
  $perm = @()
  foreach ($s in 'User', 'Machine') { $perm += @([Environment]::GetEnvironmentVariables($s).Keys | ForEach-Object { [string]$_ }) }
  return Get-MediuCopil -Curent $cur -NumePermanente $perm -ConfigDir $ConfigDir
}

# ---------------------------------------------------------------------------------------------------------------------------
# Fisiere: jurnal cu reincercari (mai multe procese scriu in acelasi punti.log), JSON atomic, citire tolerant.
function Write-Jurnal([string]$Cale, [string]$Mesaj) {
  $linie = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mesaj
  $b = [Text.Encoding]::UTF8.GetBytes($linie + "`r`n")
  for ($i = 0; $i -lt 6; $i++) {
    try {
      $fs = New-Object IO.FileStream($Cale, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
      try { $fs.Write($b, 0, $b.Length) } finally { $fs.Dispose() }
      return
    } catch { Start-Sleep -Milliseconds (40 * ($i + 1)) }
  }
}

function Invoke-RotireJurnal([string]$Cale, [long]$MaxOcteti = 2MB) {
  try {
    if ((Test-Path -LiteralPath $Cale) -and (Get-Item -LiteralPath $Cale).Length -gt $MaxOcteti) {
      $vechi = "$Cale.1"
      if (Test-Path -LiteralPath $vechi) { Remove-Item -LiteralPath $vechi -Force }
      Move-Item -LiteralPath $Cale -Destination $vechi
    }
  } catch { }   # fisier ocupat: incercam la rularea urmatoare
}

function ConvertTo-Hashtable($Obiect) {
  if ($null -eq $Obiect) { return $null }
  if ($Obiect -is [System.Management.Automation.PSCustomObject]) {
    $h = @{}
    foreach ($p in $Obiect.PSObject.Properties) { $h[$p.Name] = ConvertTo-Hashtable $p.Value }
    return $h
  }
  if ($Obiect -is [System.Collections.IEnumerable] -and $Obiect -isnot [string] -and $Obiect -isnot [hashtable]) {
    $l = New-Object System.Collections.ArrayList
    foreach ($e in $Obiect) { [void]$l.Add((ConvertTo-Hashtable $e)) }
    return ,$l.ToArray()   # virgula intentionata: valoarea ramane tablou cand e pusa direct intr-un hashtable
  }
  return $Obiect
}

function Read-JsonSigur([string]$Cale) {
  if (-not (Test-Path -LiteralPath $Cale)) { return $null }
  for ($i = 0; $i -lt 4; $i++) {
    try {
      $txt = [IO.File]::ReadAllText($Cale, [Text.Encoding]::UTF8)
      return ConvertTo-Hashtable ($txt | ConvertFrom-Json -ErrorAction Stop)
    } catch { Start-Sleep -Milliseconds (60 * ($i + 1)) }
  }
  return $null
}

function Write-JsonAtomic([string]$Cale, $Obiect) {
  $json = $Obiect | ConvertTo-Json -Depth 8
  $tmp = '{0}.{1}.tmp' -f $Cale, $PID
  [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
  for ($i = 0; $i -lt 6; $i++) {
    try {
      if (Test-Path -LiteralPath $Cale) { [IO.File]::Replace($tmp, $Cale, [NullString]::Value) } else { [IO.File]::Move($tmp, $Cale) }
      return $true
    } catch { Start-Sleep -Milliseconds (50 * ($i + 1)) }
  }
  try { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } catch { }
  return $false
}

# ---------------------------------------------------------------------------------------------------------------------------
# Procese: verificare de identitate inainte de orice oprire (PID + nume + ora pornirii), ca un PID refolosit sau un
# fisier de stare stricat sa nu duca la oprirea altui proces.
function Get-StartIso([System.Diagnostics.Process]$Proces) {
  try { return Get-DataIso $Proces.StartTime } catch { return $null }
}

function Get-ProcesVerificat([int]$Id, [string]$Nume, $StartIso) {
  if ($Id -le 0 -or -not $StartIso) { return $null }
  try { $p = Get-Process -Id $Id -ErrorAction Stop } catch { return $null }
  if ($p.ProcessName -ne $Nume) { return $null }
  $asteptat = ConvertFrom-DataIso $StartIso
  $real = $null
  try { $real = $p.StartTime.ToUniversalTime() } catch { return $null }
  if ($null -eq $asteptat -or [math]::Abs(($real - $asteptat).TotalSeconds) -gt 2) { return $null }
  return $p
}

function Stop-ArboreVerificat([int]$Id, [string]$Nume, $StartIso) {
  $p = Get-ProcesVerificat -Id $Id -Nume $Nume -StartIso $StartIso
  if ($null -eq $p) { return $false }
  & "$env:SystemRoot\System32\taskkill.exe" /PID $Id /T /F 2>&1 | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    if ($null -eq (Get-ProcesVerificat -Id $Id -Nume $Nume -StartIso $StartIso)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# ora pornirii dintr-un rand Win32_Process (pentru reverificarea identitatii inainte de oprire)
function Get-StartIsoCim($Proces) {
  if ($null -eq $Proces -or $null -eq $Proces.CreationDate) { return $null }
  try { return Get-DataIso ([datetime]$Proces.CreationDate) } catch { return $null }
}

function Get-InstantaneuProcese {
  @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, CreationDate -ErrorAction Stop)
}

function Get-Stramosi([int]$Id, $Instantaneu) {
  $harta = @{}
  foreach ($p in $Instantaneu) { $harta[[int]$p.ProcessId] = $p }
  $rez = New-Object System.Collections.ArrayList
  $vazut = @{}
  $cur = $harta[$Id]
  for ($i = 0; $i -lt 64 -and $null -ne $cur; $i++) {
    $pp = [int]$cur.ParentProcessId
    if ($pp -le 0 -or $vazut.ContainsKey($pp) -or -not $harta.ContainsKey($pp)) { break }
    $parinte = $harta[$pp]
    # parintele trebuie sa fie pornit inaintea copilului (altfel e un PID refolosit)
    if ($parinte.CreationDate -and $cur.CreationDate -and $parinte.CreationDate -gt $cur.CreationDate) { break }
    $vazut[$pp] = $true
    [void]$rez.Add($parinte)
    $cur = $parinte
  }
  return $rez.ToArray()   # apelantii folosesc @(...)
}

# Rulez dintr-o sesiune Claude (stramos claude.exe)? Atunci nu pornesc/opresc punti din acest proces: copiii mei ar muri
# la repornirea puntii-parinte, iar oprirea puntii-parinte m-ar opri si pe mine.
function Test-InSesiuneClaude([int]$Id, $Instantaneu) {
  foreach ($s in @(Get-Stramosi -Id $Id -Instantaneu $Instantaneu)) { if ($s.Name -eq 'claude.exe') { return $true } }
  return $false
}

# Punte "veche" (pornire de dinainte de v2) inca activa pentru aceeasi punte -> nu pornim dublura.
#   1. bucla cmd veche (start_claude_rc*.cmd) - reporneste claude la 30 s;
#   2. claude.exe "remote-control --name <Afisat>" care nu e al releului nostru;
#   3. PID scris de v1 in paw-data\punti\<folder>.pid, inca viu, claude.exe pornit la ora fisierului (+-120 s).
#      (v1 a pornit puntile cu drepturi de admin: linia lor de comanda nu se vede dintr-un proces normal, de aceea regula 3.)
#   Un claude.exe al carui parinte e releul v2 (linia de comanda contine punte_releu.ps1) nu e niciodata "vechi".
#   O singura definitie (L19): supervizorul o foloseste ca sa NU porneasca dubluri, instalatorul (-PreiaAcum) ca sa le opreasca.
function Get-PuntiVechi($Punte, $Instantaneu, [string]$DirV1, [int[]]$PidExclus) {
  $rez = New-Object System.Collections.ArrayList
  $harta = @{}
  foreach ($p in $Instantaneu) { $harta[[int]$p.ProcessId] = $p }
  $cmdRx = '(?i)[\\ "]' + [regex]::Escape($Punte.CmdVechi) + '(\s|"|$)'
  $numeRx = '(?i)\sremote-control\s.*--name\s+"' + [regex]::Escape($Punte.Afisat) + '"'
  foreach ($p in $Instantaneu) {
    $cl = [string]$p.CommandLine
    if (-not $cl) { continue }
    if ($p.Name -eq 'cmd.exe' -and $cl -match $cmdRx) {
      [void]$rez.Add([pscustomobject]@{ Pid = [int]$p.ProcessId; Nume = 'cmd'; StartIso = (Get-StartIsoCim $p); Tip = 'bucla-cmd'; Descriere = ('bucla cmd veche {0}, PID {1}' -f $Punte.CmdVechi, $p.ProcessId) })
      continue
    }
    if ($p.Name -eq 'claude.exe' -and $cl -match $numeRx -and (@($PidExclus) -notcontains [int]$p.ProcessId)) {
      $par = $harta[[int]$p.ParentProcessId]
      if ($par -and ([string]$par.CommandLine) -match '(?i)punte_releu\.ps1') { continue }
      if ($par -and $par.Name -eq 'cmd.exe' -and ([string]$par.CommandLine) -match $cmdRx) { continue }   # copilul buclei, deja numarat
      [void]$rez.Add([pscustomobject]@{ Pid = [int]$p.ProcessId; Nume = 'claude'; StartIso = (Get-StartIsoCim $p); Tip = 'claude'; Descriere = ('claude remote-control pornit in afara releului, PID {0}' -f $p.ProcessId) })
    }
  }
  if ($DirV1) {
    $f = Join-Path $DirV1 ((Split-Path $Punte.Folder -Leaf) + '.pid')
    if (Test-Path -LiteralPath $f) {
      $txt = (Get-Content -LiteralPath $f -TotalCount 1 -ErrorAction SilentlyContinue)
      $id = 0
      if ([int]::TryParse(([string]$txt).Trim(), [ref]$id) -and $id -gt 0 -and (@($PidExclus) -notcontains $id) -and -not (@($rez | ForEach-Object { $_.Pid }) -contains $id)) {
        try {
          $pr = Get-Process -Id $id -ErrorAction Stop
          $scris = (Get-Item -LiteralPath $f).LastWriteTimeUtc
          if ($pr.ProcessName -eq 'claude' -and [math]::Abs(($pr.StartTime.ToUniversalTime() - $scris).TotalSeconds) -le 120) {
            [void]$rez.Add([pscustomobject]@{ Pid = $id; Nume = 'claude'; StartIso = (Get-StartIso $pr); Tip = 'v1'; Descriere = ('punte v1, PID {0}' -f $id); FisierPid = $f })
          }
        } catch { }
      }
    }
  }
  return $rez.ToArray()   # apelantii folosesc @(...)
}

function Get-PunteVeche($Punte, $Instantaneu, [string]$DirV1, [int[]]$PidExclus) {
  $v = @(Get-PuntiVechi -Punte $Punte -Instantaneu $Instantaneu -DirV1 $DirV1 -PidExclus $PidExclus)
  if ($v.Count -eq 0) { return $null }
  return $v[0].Descriere
}

# Internet: conexiune TCP 443 catre serverele Anthropic (fara date trimise). $true daca macar una raspunde in timp.
function Test-Internet([string[]]$Gazde = @('api.anthropic.com', 'claude.ai'), [int]$TimeoutMs = 5000) {
  foreach ($g in $Gazde) {
    $c = New-Object Net.Sockets.TcpClient
    try {
      $t = $c.ConnectAsync($g, 443)
      if ($t.Wait($TimeoutMs) -and $c.Connected) { return $true }
    } catch { } finally { $c.Dispose() }
  }
  return $false
}

# "claude auth status --json" pentru un config, cu mediul curatat (fara token/API key). Timeout 60 s. Esec = necunoscut.
function Invoke-AuthStatus([string]$Claude, [string]$ConfigDir, [datetime]$Acum) {
  try {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $Claude
    $psi.Arguments = 'auth status --json'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $m = Get-MediuCopilReal -ConfigDir $ConfigDir
    $psi.EnvironmentVariables.Clear()
    foreach ($k in $m.Mediu.Keys) { $psi.EnvironmentVariables[$k] = $m.Mediu[$k] }
    $p = [Diagnostics.Process]::Start($psi)
    $tOut = $p.StandardOutput.ReadToEndAsync()
    $tErr = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(60000)) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $p.Id /T /F 2>&1 | Out-Null
      return [pscustomobject]@{ Valid = $null; LoggedIn = $null; ExpiraLa = $null; Metoda = $null; Eroare = 'timeout auth status' }
    }
    [void]$tErr.Wait(5000)
    return Get-StareLoginDinJson -Json $tOut.Result -Acum $Acum
  } catch {
    return [pscustomobject]@{ Valid = $null; LoggedIn = $null; ExpiraLa = $null; Metoda = $null; Eroare = (Format-Sigur $_.Exception.Message 160) }
  }
}

# ---------------------------------------------------------------------------------------------------------------------------
# O rulare a supervizorului, cu dependentele injectate (in autotest se dau functii false, fara procese si fara retea).
# $Dep: Config, CitesteStareSup, ScrieStareSup, CitesteStarePunte, Procese, Veche, Internet, Login, Porneste, Opreste,
#       Jurnal, ScrieAlarma, PlanAutentificare; v3: CitesteIndicator (punte -> indicatorul CLI-ului sau $null),
#       Strain (punte, stare, indicator -> descriere daca alta punte serveste folderul), Porneste primeste (punte, mod, sesiune).
#       Intoarce lista actiunilor (pentru teste si pentru -DoarVerifica).
function Test-TrebuieLogat([hashtable]$Sup, [string]$Cheie, [datetime]$Acum, [int]$Minute = 60) {
  if (-not $Sup.avertizari) { $Sup.avertizari = @{} }
  $m = Get-MinuteDeLa $Sup.avertizari[$Cheie] $Acum
  if ($null -eq $m -or $m -ge $Minute) { $Sup.avertizari[$Cheie] = Get-DataIso $Acum; return $true }
  return $false
}

function Invoke-Supervizor([hashtable]$Dep, [datetime]$Acum, [switch]$DoarVerifica) {
  $acumU = $Acum.ToUniversalTime()
  $actiuni = New-Object System.Collections.ArrayList
  $jurnal = { param($m) if ($DoarVerifica) { [void]$actiuni.Add("JURNAL: $m") } else { & $Dep.Jurnal $m } }
  $sup = & $Dep.CitesteStareSup
  if ($null -eq $sup) { $sup = @{} }
  foreach ($k in 'conturi', 'istoric', 'avertizari') { if ($null -eq $sup[$k]) { $sup[$k] = @{} } }

  # 0. avertismentul despre autentificare (o data pe zi)
  if ($Dep.PlanAutentificare -and $Dep.PlanAutentificare.Avertizare -and (Test-TrebuieLogat $sup 'plan-autentificare' $acumU 1440)) {
    & $jurnal ('AVERTISMENT: ' + $Dep.PlanAutentificare.Avertizare)
  }

  # 1. internet (tranzitiile se scriu o data; "fara internet" se repeta cel mult o data pe ora)
  $netOk = [bool](& $Dep.Internet)
  if ($null -eq $sup.internetOk -or [bool]$sup.internetOk -ne $netOk -or -not $sup.internetSchimbatLa) {
    if ($null -ne $sup.internetOk) { if ($netOk) { & $jurnal 'internet revenit' } else { & $jurnal 'fara internet: nu pornesc/repornesc nimic pana revine' } }
    $sup.internetOk = $netOk; $sup.internetSchimbatLa = Get-DataIso $acumU
  } elseif (-not $netOk -and (Test-TrebuieLogat $sup 'fara-internet' $acumU 60)) {
    & $jurnal 'tot fara internet'
  }
  $stabil = 0.0
  if ($netOk) { $stabil = [double](Get-MinuteDeLa $sup.internetSchimbatLa $acumU) }

  # 2. starea fiecarei punti (procese verificate, punte veche, indicatorul CLI-ului si eventualul lui scriitor strain)
  $info = @()
  foreach ($p in $Dep.Config) {
    $st = & $Dep.CitesteStarePunte $p
    $pr = & $Dep.Procese $p $st
    $vc = & $Dep.Veche $p $st
    $ind = $null
    if ($Dep.CitesteIndicator) { $ind = & $Dep.CitesteIndicator $p }
    $strain = ''
    if ($Dep.Strain) { $strain = [string](& $Dep.Strain $p $st $ind) }
    $info += [pscustomobject]@{ Punte = $p; Stare = $st; ReleuViu = [bool]$pr.ReleuViu; ClaudeViu = [bool]$pr.ClaudeViu; Veche = $vc; Indicator = $ind; Strain = $strain }
  }

  # 3. login per cont (cel mult o data pe ora; mai des daca e invalid sau trebuie pornita o punte a lui)
  $chei = @($Dep.Config | ForEach-Object { Get-CheieCont $_.ConfigDir } | Select-Object -Unique)
  foreach ($k in $chei) {
    $c = $sup.conturi[$k]
    if ($null -eq $c) { $c = @{}; $sup.conturi[$k] = $c }
    # in fereastra de alarma (<= 5 zile) verificam la fiecare rulare: reinnoirea lui Razvan trebuie vazuta in max. 5 min
    $expVechi = ConvertFrom-DataIso $c.ExpiraLa
    $aproape = ($null -ne $expVechi) -and (($expVechi - $acumU).TotalDays -le $script:ZileAlarmaLogin)
    $deVerificat = ($null -eq $c.VerificatLa) -or ((Get-MinuteDeLa $c.VerificatLa $acumU) -ge $script:VerificareLoginMin) -or ($c.Valid -eq $false) -or $aproape
    foreach ($i in $info) {
      if ((Get-CheieCont $i.Punte.ConfigDir) -eq $k -and -not $i.Veche -and -not $i.Strain -and -not ($i.ReleuViu -and $i.ClaudeViu)) { $deVerificat = $true }
    }
    if (-not $deVerificat) { continue }
    $cfgDir = ($Dep.Config | Where-Object { (Get-CheieCont $_.ConfigDir) -eq $k } | Select-Object -First 1).ConfigDir
    $L = & $Dep.Login $cfgDir
    $et = Get-EtichetaCont $k $Dep.Config
    if ($L.Valid -eq $true) {
      if ($c.Valid -eq $false) { $c.RevalidatLa = Get-DataIso $acumU; & $jurnal "login valid din nou pentru $et" }
      elseif ($aproape -and $null -ne $L.ExpiraLa -and ($L.ExpiraLa - $expVechi).TotalDays -ge 7) {
        # reinnoit INAINTE de expirare: puntile pornite cu logarea veche le repornim acum, nu la vechea data a expirarii
        $c.RevalidatLa = Get-DataIso $acumU
        & $jurnal ("login reinnoit pentru {0} (expira acum la {1}); repornesc puntile pornite inainte" -f $et, $L.ExpiraLa.ToLocalTime().ToString('dd.MM.yyyy'))
      }
      $c.InvalidDeLa = $null
    } elseif ($L.Valid -eq $false) {
      if ($c.Valid -ne $false) { $c.InvalidDeLa = Get-DataIso $acumU; & $jurnal "LOGIN EXPIRAT/INVALID pentru $et - puntile lui nu mai pot fi pornite; vezi alarma_login.txt" }
    } else {
      if (Test-TrebuieLogat $sup "login-necunoscut-$k" $acumU 60) { & $jurnal ("nu pot citi starea login-ului pentru {0}: {1} (tratat ca necunoscut)" -f $et, $L.Eroare) }
    }
    if ($null -ne $L.Valid) {
      $c.Valid = $L.Valid
      if ($L.ExpiraLa) { $c.ExpiraLa = Get-DataIso $L.ExpiraLa } else { $c.ExpiraLa = $null }
    }
    $c.VerificatLa = Get-DataIso $acumU
  }

  # 4. alarma de login (fisier pentru chat + rand in jurnal la aparitie si apoi o data pe zi)
  $alarma = Get-TextAlarmaLogin -Conturi $sup.conturi -Config $Dep.Config -Acum $acumU
  if ($DoarVerifica) {
    if ($alarma) { [void]$actiuni.Add('ALARMA: ' + ($alarma -replace "`r`n", ' | ')) }
  } else {
    $rez = & $Dep.ScrieAlarma $alarma
    if ($alarma) {
      if ($rez -eq 'scris' -and (Test-TrebuieLogat $sup 'alarma-login' $acumU 1440)) { & $jurnal ('ALARMA LOGIN: ' + (($alarma -split "`r`n" | Select-Object -Skip 2 | Where-Object { $_ -and $_ -notmatch '^\s' }) -join ' / ')) }
    } elseif ($rez -eq 'sters') {
      & $jurnal 'alarma login rezolvata (fisierul alarma_login.txt a fost sters)'
      $sup.avertizari.Remove('alarma-login')
    }
  }

  # starea login-ului (RevalidatLa, VerificatLa) se salveaza inainte de orice actiune: altfel o rulare intrerupta ar
  # repeta repornirile "dupa reinnoirea login-ului" (Jakarinos r1 P1)
  if (-not $DoarVerifica -and -not (& $Dep.ScrieStareSup $sup)) {
    & $jurnal 'EROARE: nu pot salva starea supervizorului; nu actionez in aceasta rulare'
    return $actiuni.ToArray()
  }

  # 5. decizii per punte
  foreach ($i in $info) {
    $p = $i.Punte
    $k = Get-CheieCont $p.ConfigDir
    $c = $sup.conturi[$k]
    $ist = @()
    if ($sup.istoric[$p.Nume]) { $ist = @($sup.istoric[$p.Nume]) }
    # v3: memoria puntii (mediu + sesiuni cunoscute) si pasii reatasarii, actualizate din ce a vazut releul.
    # Indicatorul citit acum de supervizor, daca e al puntii noastre (pid = claude.exe-ul releului), e mai proaspat decat
    # ce a scris releul si acopera si puntile v2 inca vii (starea lor nu are "indicator") - Jakarinos r1 P2.
    $mem = Get-MemoriePunte -Sup $sup -Nume $p.Nume
    $vieAcum = [bool]($i.ReleuViu -and $i.ClaudeViu)
    if ($i.Stare -is [hashtable] -and $i.Indicator -is [hashtable] -and [int]$i.Indicator.pid -gt 0 -and [int]$i.Indicator.pid -eq [int]$i.Stare.pidClaude) {
      $i.Stare.indicator = $i.Indicator
    }
    foreach ($mr in @(Update-Reatasare -Mem $mem -Stare $i.Stare -Vie $vieAcum -Acum $acumU)) { & $jurnal "[$($p.Nume)] $mr" }
    if ($mem.rezervareRevenire) {
      $modAcum = 'normal'
      if ($i.Stare -is [hashtable] -and $i.Stare.mod) { $modAcum = [string]$i.Stare.mod }
      if ($null -eq $mem.reatasare) {
        # dus-intorsul s-a incheiat: fara intoarcere reala (renunt / nicio candidata) eliberez intrarea rezervata; cu intoarcere, intrarea ramane (pornire reala)
        if (-not $mem.revenirePornita) {
          $rest = New-Object System.Collections.ArrayList; $scos = $false
          foreach ($x in @($sup.istoric[$p.Nume])) { if (-not $scos -and [string]$x -eq [string]$mem.rezervareRevenire) { $scos = $true; continue }; [void]$rest.Add($x) }
          $sup.istoric[$p.Nume] = @($rest.ToArray())
          $ist = @($sup.istoric[$p.Nume])
        }
        $mem.rezervareRevenire = $null; $mem.revenirePornita = $false
      } elseif ($mem.revenirePornita -and $modAcum -ne 'reatasare') {
        # intoarcerea a pornit efectiv (nu mai e puntea cu o sesiune): jetonul e de acum o pornire reala; o noua reatasare va rezerva din nou
        $mem.rezervareRevenire = $null; $mem.revenirePornita = $false
      }
      # revenirePornita + puntea de reatasare inca vie = intoarcerea a fost notata, dar efectul nu a avut loc (intrerupere): jetonul ramane,
      # intoarcerea se reia la cost 0 (Jakarinos r2 P2)
    }
    $d = Get-DecizieSupraveghere -Punte $p -Stare $i.Stare -ReleuViu $i.ReleuViu -ClaudeViu $i.ClaudeViu -Veche $i.Veche `
         -InternetOk $netOk -InternetStabilMin $stabil -LoginValid $c.Valid -LoginRevalidatLa $c.RevalidatLa -Istoric $ist -Acum $acumU `
         -Mem $mem -Strain $i.Strain
    $sup.istoric[$p.Nume] = @((Test-PotPorni -Istoric $ist -Acum $acumU).Istoric | ForEach-Object { Get-DataIso $_ })
    $eticheta = $d.Actiune
    if ($d.Mod -eq 'reatasare' -and $d.Actiune -ne 'nimic' -and $d.Actiune -ne 'asteapta') { $eticheta += ' [reatasare]' }
    [void]$actiuni.Add(('{0}: {1} ({2})' -f $p.Nume, $eticheta, $d.Motiv))
    if ($d.Actiune -eq 'nimic') {
      if (($i.Veche -or $i.Strain) -and (Test-TrebuieLogat $sup "veche-$($p.Nume)" $acumU 60)) { & $jurnal "[$($p.Nume)] $($d.Motiv)" }
      if ($i.ReleuViu -and $i.ClaudeViu -and $i.Stare) {
        $tac = Get-MinuteDeLa $i.Stare.ultimaIesire $acumU
        if ($null -ne $tac -and $tac -ge $script:ObservatieTacereMin -and (Test-TrebuieLogat $sup "tacere-$($p.Nume)" $acumU 60)) {
          & $jurnal ("[{0}] observatie: puntea nu a mai scris nimic de {1:N0} min (fara actiune)" -f $p.Nume, $tac)
        }
        $porn = Get-MinuteDeLa $i.Stare.pornitLa $acumU
        if (($i.Stare.stare -eq 'pornire' -or $i.Stare.stare -eq 'conectare') -and $null -ne $porn -and $porn -ge $script:ObservatieTacereMin -and (Test-TrebuieLogat $sup "fara-conectat-$($p.Nume)" $acumU 60)) {
          & $jurnal ("[{0}] observatie: nicio stare 'Connected' de {1:N0} min de la pornire - poate s-a schimbat textul CLI-ului (fara actiune)" -f $p.Nume, $porn)
        }
      }
      continue
    }
    if ($d.Actiune -eq 'asteapta') {
      $cheieAv = "asteapta-$($p.Nume)-" + ($d.Motiv -replace '\d+', 'N')
      if ($d.LimitaAtinsa) { $cheieAv = "limita-$($p.Nume)" }
      if ($d.DejaServit) { $cheieAv = "deja-servit-$($p.Nume)" }
      if (Test-TrebuieLogat $sup $cheieAv $acumU 60) {
        if ($d.LimitaAtinsa) { & $jurnal "AVERTISMENT [$($p.Nume)] $($d.Motiv)" } else { & $jurnal "[$($p.Nume)] astept: $($d.Motiv)" }
      }
      continue
    }
    if ($DoarVerifica) { continue }
    # Rezervarea in istoric se SALVEAZA inainte de efect (Jakarinos r1 P1, L02/L04): o exceptie mai jos sau o rulare
    # intrerupta nu pot ocoli limita de 3/ora. Daca starea nu se poate salva, nu actionam (L05: necunoscut = nu risc).
    $R = $mem.reatasare
    # Istoricul (plafonul 3/ora): o pornire = o intrare. Reatasarea adauga si JETONUL intoarcerii (a doua intrare) daca nu exista deja unul
    # in fereastra; intoarcerea nu adauga nimic, ci MUTA jetonul la ora ei reala (intrarea rezervata devine pornirea reala - Jakarinos r2 P2:
    # altfel expira la ora plecarii); un jeton expirat nu mai conteaza, intoarcerea costa atunci o pornire obisnuita.
    $acumIso = Get-DataIso $acumU
    $jeton = Test-JetonPrezent -Mem $mem -Istoric $sup.istoric[$p.Nume]
    $rezervari = @($acumIso)
    if ($d.Mod -eq 'reatasare') {
      if (-not $jeton) { $mem.rezervareRevenire = $acumIso; $mem.revenirePornita = $false; $rezervari += $acumIso }
    } elseif ($d.Revenire -and $jeton) {
      $rezervari = @()
      $mutat = $false
      $sup.istoric[$p.Nume] = @(@($sup.istoric[$p.Nume]) | ForEach-Object { if (-not $mutat -and [string]$_ -eq [string]$mem.rezervareRevenire) { $mutat = $true; $acumIso } else { $_ } })
      $mem.rezervareRevenire = $acumIso; $mem.revenirePornita = $true
    } else {
      $mem.rezervareRevenire = $null; $mem.revenirePornita = $false   # pornire obisnuita (sau intoarcere cu jeton expirat): fara jeton
    }
    $sup.istoric[$p.Nume] = @(@($sup.istoric[$p.Nume]) + $rezervari | Where-Object { $_ })
    # v3: pasul reatasarii se noteaza tot inainte de efect. Punte normala fara reatasare: indicatorul existent (al puntii noastre
    # dinainte sau al unei punti straine oprite) e adoptat DOAR daca nu contrazice memoria: acelasi mediu, sau nu stim niciun
    # mediu / nicio sesiune de pastrat. Alt mediu cu sesiuni cunoscute NU se adopta (Jakarinos r1 P1): puntea noua il va refolosi,
    # diferenta fata de memorie porneste reatasarea, iar CLI-ul (--session-id -> mediul sesiunii, de la server) reconciliaza.
    if ($d.Mod -eq 'reatasare') {
      if ($R -is [hashtable]) { $R.pas = 'in-curs'; $R.pornitaLa = Get-DataIso $acumU }
    } elseif ($R -is [hashtable] -and ($R.pas -eq 'conectata' -or $R.pas -eq 'revenire')) {
      $R.pas = 'revenire'
      if ($i.Indicator -and (Test-IdSigur ([string]$i.Indicator.mediu))) { $R.mediuReatasat = [string]$i.Indicator.mediu }
    } elseif ($null -eq $R -and $i.Indicator -is [hashtable] -and (Test-IdSigur ([string]$i.Indicator.mediu))) {
      $cand = @(Get-SesiuniDeReatasat $mem)
      if (-not (Test-IdSigur ([string]$mem.mediu)) -or $cand.Count -eq 0 -or [string]$i.Indicator.mediu -eq [string]$mem.mediu) {
        Set-MemorieDinIndicator $mem $i.Indicator $acumU
      } else {
        & $jurnal ("[{0}] indicatorul folderului arata alt mediu ({1}) decat cel cunoscut ({2}, cu {3} sesiuni); nu il adopt - puntea noua il va verifica prin reatasare" -f $p.Nume, $i.Indicator.mediu, $mem.mediu, $cand.Count)
      }
    }
    if (-not (& $Dep.ScrieStareSup $sup)) {
      & $jurnal "[$($p.Nume)] EROARE: nu pot salva starea supervizorului; nu actionez in aceasta rulare"
      continue
    }
    try {
      if ($d.Actiune -eq 'reporneste') {
        $opr = [bool](& $Dep.Opreste $p $i.Stare)
        if (-not $opr) {
          # ce a ramas viu nu a putut fi oprit (sau identitatea nu s-a confirmat): un releu nou ar putea dubla puntea
          & $jurnal ("[{0}] NU repornesc: oprirea nu a fost confirmata ({1}); reincerc la rularea urmatoare" -f $p.Nume, $d.Motiv)
          continue
        }
        & $jurnal ("[{0}] repornesc: {1}" -f $p.Nume, $d.Motiv)
      } else {
        & $jurnal ("[{0}] pornesc: {1}" -f $p.Nume, $d.Motiv)
      }
      $r = & $Dep.Porneste $p $d.Mod $d.Sesiune
      if ($r.Ok) { & $jurnal ("[{0}] releu pornit: {1}" -f $p.Nume, $r.Mesaj) } else { & $jurnal ("[{0}] EROARE la pornire: {1}" -f $p.Nume, $r.Mesaj) }
    } catch {
      & $jurnal ("[{0}] EROARE la (re)pornire: {1}" -f $p.Nume, (Format-Sigur $_.Exception.Message 200))
    }
  }

  $sup.versiune = $script:PuntiVersiune
  $sup.ultimaRulare = Get-DataIso $acumU
  if (-not $DoarVerifica) {
    if (-not (& $Dep.ScrieStareSup $sup)) { & $jurnal 'EROARE: nu pot salva starea supervizorului la final' }
  }
  return $actiuni.ToArray()
}
