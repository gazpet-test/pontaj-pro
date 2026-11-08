# punti_lib.ps1 - functii comune pentru puntile "claude remote-control" de pe serverul AI (v2, 08.11.2026, Rocky/redari@).
# Folosit de: punti_remote_control.ps1 (supervizor), punte_releu.ps1 (releu per punte), instaleaza.ps1, autotest_punti.ps1.
# Se incarca prin dot-source. Functiile "pure" (fara procese, fara retea) sunt testate in autotest_punti.ps1.
# Fara secrete: nicio functie nu citeste fisiere cu tokenuri; textele scrise in jurnale trec prin Format-Sigur.
# Fisier ASCII intentionat (Windows PowerShell 5.1 citeste .ps1 fara BOM ca ANSI).

$script:PuntiVersiune = 'v2'
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
function Get-ClasaLinie([string]$Linie) {
  $t = (Remove-Ansi $Linie).Trim()
  $r = [ordered]@{ Tip = 'altceva'; Durata = $null; Text = $t; Fatala = $false; Credential = $false }
  if (-not $t) { $r.Tip = 'gol'; return [pscustomobject]$r }
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
      $Stare.stare = 'conectat'; $Stare.stareDeLa = $iso; $Stare.deconectatSec = 0
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
  return ,$mes.ToArray()
}

# ---------------------------------------------------------------------------------------------------------------------------
# Decizii (pure). Problemele care cer repornire la o punte VIE vin DOAR din semnale explicite ale puntii (nu din tacere):
#   1. "Reconnecting ... disconnected Y" ca ultima stare, de >= 10 min (dupa ceasul nostru SAU dupa Y raportat de punte);
#      CLI-ul renunta singur dupa 10 min (iese), dar NU si cat serveste o sesiune de proiect -> atunci ramane viu si picat;
#   2. eroare fatala ("... claude remote-control ..." / "giving up") si procesul tot viu dupa 10 min;
#   3. "Remote Control credential" respins de >= 10 min;
#   4. login-ul contului a fost invalid/expirat cat puntea rula si acum e valid din nou (puntea veche nu se reface singura).
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
  $c = Get-MinuteDeLa $Stare.credentialLa $Acum
  if ($null -ne $c -and $c -ge $script:PragProblemaMin) {
    return [pscustomobject]@{ Motiv = ('credential Remote Control respins de {0:N0} min' -f $c); CereInternetStabil = $false }
  }
  $rev = ConvertFrom-DataIso $LoginRevalidatLa
  $porn = ConvertFrom-DataIso $Stare.pornitLa
  if ($null -ne $rev -and $null -ne $porn -and $porn -lt $rev) {
    return [pscustomobject]@{ Motiv = 'login reinnoit dupa expirare; puntea pornita inainte nu se reface singura'; CereInternetStabil = $false }
  }
  return $null
}

# Limita de porniri: fereastra glisanta. Intoarce Permis + istoricul curatat (doar ultimele 60 min).
function Test-PotPorni($Istoric, [datetime]$Acum, [int]$Max = $script:MaxPorniriPeOra, [int]$FereastraMin = 60) {
  $acumU = $Acum.ToUniversalTime()
  $curat = @(@($Istoric) | ForEach-Object { ConvertFrom-DataIso $_ } | Where-Object { $null -ne $_ -and ($acumU - $_).TotalMinutes -lt $FereastraMin -and $_ -le $acumU.AddMinutes(1) })
  return [pscustomobject]@{ Permis = ($curat.Count -lt $Max); Numar = $curat.Count; Istoric = $curat }
}

# Decizia pentru o punte. Actiune: nimic | porneste | reporneste | asteapta.
function Get-DecizieSupraveghere {
  param(
    $Punte, [hashtable]$Stare,
    [bool]$ReleuViu, [bool]$ClaudeViu, [string]$Veche,
    [bool]$InternetOk, [double]$InternetStabilMin,
    $LoginValid, $LoginRevalidatLa,
    $Istoric, [datetime]$Acum
  )
  $d = [ordered]@{ Actiune = 'nimic'; Motiv = ''; LimitaAtinsa = $false; CereInternetStabil = $false }
  if ($Veche) { $d.Motiv = "punte veche activa ($Veche); nu pornesc dublura"; return [pscustomobject]$d }
  $vie = $ReleuViu -and $ClaudeViu
  if ($vie) {
    $p = Get-ProblemaPunte -Stare $Stare -Acum $Acum -LoginRevalidatLa $LoginRevalidatLa
    if ($null -eq $p) { return [pscustomobject]$d }
    $d.Motiv = $p.Motiv
    $d.CereInternetStabil = $p.CereInternetStabil
    $tinta = 'reporneste'
  } else {
    if ($ReleuViu) { $d.Motiv = 'releul e viu dar puntea nu' }
    elseif ($Stare -and $Stare.stare -eq 'oprit') { $d.Motiv = ('puntea s-a oprit (cod {0})' -f $Stare.codIesire) }
    else { $d.Motiv = 'puntea lipseste' }
    if ($ReleuViu) { $tinta = 'reporneste' } else { $tinta = 'porneste' }
  }
  if (-not $InternetOk) { $d.Actiune = 'asteapta'; $d.Motiv += '; fara internet'; return [pscustomobject]$d }
  if ($d.CereInternetStabil -and $InternetStabilMin -lt $script:InternetStabilMin) {
    $d.Actiune = 'asteapta'; $d.Motiv += ('; internetul e inapoi doar de {0:N0} min' -f $InternetStabilMin); return [pscustomobject]$d
  }
  if ($LoginValid -eq $false) { $d.Actiune = 'asteapta'; $d.Motiv += '; login expirat/invalid - repornirea nu ajuta, vezi alarma'; return [pscustomobject]$d }
  $lim = Test-PotPorni -Istoric $Istoric -Acum $Acum
  if (-not $lim.Permis) {
    $d.Actiune = 'asteapta'; $d.LimitaAtinsa = $true
    $d.Motiv += ('; limita de {0} porniri/ora atinsa - doar avertisment' -f $script:MaxPorniriPeOra)
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
    return ,$l.ToArray()
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
  return ,$rez.ToArray()
}

# Rulez dintr-o sesiune Claude (stramos claude.exe)? Atunci nu pornesc/opresc punti din acest proces: copiii mei ar muri
# la repornirea puntii-parinte, iar oprirea puntii-parinte m-ar opri si pe mine.
function Test-InSesiuneClaude([int]$Id, $Instantaneu) {
  foreach ($s in (Get-Stramosi -Id $Id -Instantaneu $Instantaneu)) { if ($s.Name -eq 'claude.exe') { return $true } }
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
      [void]$rez.Add([pscustomobject]@{ Pid = [int]$p.ProcessId; Tip = 'bucla-cmd'; Descriere = ('bucla cmd veche {0}, PID {1}' -f $Punte.CmdVechi, $p.ProcessId) })
      continue
    }
    if ($p.Name -eq 'claude.exe' -and $cl -match $numeRx -and (@($PidExclus) -notcontains [int]$p.ProcessId)) {
      $par = $harta[[int]$p.ParentProcessId]
      if ($par -and ([string]$par.CommandLine) -match '(?i)punte_releu\.ps1') { continue }
      if ($par -and $par.Name -eq 'cmd.exe' -and ([string]$par.CommandLine) -match $cmdRx) { continue }   # copilul buclei, deja numarat
      [void]$rez.Add([pscustomobject]@{ Pid = [int]$p.ProcessId; Tip = 'claude'; Descriere = ('claude remote-control pornit in afara releului, PID {0}' -f $p.ProcessId) })
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
            [void]$rez.Add([pscustomobject]@{ Pid = $id; Tip = 'v1'; Descriere = ('punte v1, PID {0}' -f $id); FisierPid = $f })
          }
        } catch { }
      }
    }
  }
  return ,$rez.ToArray()
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
#       Jurnal, ScrieAlarma, PlanAutentificare. Intoarce lista actiunilor (pentru teste si pentru -DoarVerifica).
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

  # 2. starea fiecarei punti (procese verificate, punte veche)
  $info = @()
  foreach ($p in $Dep.Config) {
    $st = & $Dep.CitesteStarePunte $p
    $pr = & $Dep.Procese $p $st
    $vc = & $Dep.Veche $p $st
    $info += [pscustomobject]@{ Punte = $p; Stare = $st; ReleuViu = [bool]$pr.ReleuViu; ClaudeViu = [bool]$pr.ClaudeViu; Veche = $vc }
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
      if ((Get-CheieCont $i.Punte.ConfigDir) -eq $k -and -not $i.Veche -and -not ($i.ReleuViu -and $i.ClaudeViu)) { $deVerificat = $true }
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

  # 5. decizii per punte
  foreach ($i in $info) {
    $p = $i.Punte
    $k = Get-CheieCont $p.ConfigDir
    $c = $sup.conturi[$k]
    $ist = @()
    if ($sup.istoric[$p.Nume]) { $ist = @($sup.istoric[$p.Nume]) }
    $d = Get-DecizieSupraveghere -Punte $p -Stare $i.Stare -ReleuViu $i.ReleuViu -ClaudeViu $i.ClaudeViu -Veche $i.Veche `
         -InternetOk $netOk -InternetStabilMin $stabil -LoginValid $c.Valid -LoginRevalidatLa $c.RevalidatLa -Istoric $ist -Acum $acumU
    $sup.istoric[$p.Nume] = @((Test-PotPorni -Istoric $ist -Acum $acumU).Istoric | ForEach-Object { Get-DataIso $_ })
    [void]$actiuni.Add(('{0}: {1} ({2})' -f $p.Nume, $d.Actiune, $d.Motiv))
    if ($d.Actiune -eq 'nimic') {
      if ($i.Veche -and (Test-TrebuieLogat $sup "veche-$($p.Nume)" $acumU 60)) { & $jurnal "[$($p.Nume)] $($d.Motiv)" }
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
      if (Test-TrebuieLogat $sup $cheieAv $acumU 60) {
        if ($d.LimitaAtinsa) { & $jurnal "AVERTISMENT [$($p.Nume)] $($d.Motiv)" } else { & $jurnal "[$($p.Nume)] astept: $($d.Motiv)" }
      }
      continue
    }
    if ($DoarVerifica) { continue }
    if ($d.Actiune -eq 'reporneste') {
      $opr = & $Dep.Opreste $p $i.Stare
      & $jurnal ("[{0}] repornesc: {1}{2}" -f $p.Nume, $d.Motiv, $(if ($opr) { '' } else { ' (oprirea nu a fost confirmata)' }))
    } else {
      & $jurnal ("[{0}] pornesc: {1}" -f $p.Nume, $d.Motiv)
    }
    $ist2 = @($sup.istoric[$p.Nume]) + @(Get-DataIso $acumU)
    $sup.istoric[$p.Nume] = @($ist2 | Where-Object { $_ })
    $r = & $Dep.Porneste $p
    if ($r.Ok) { & $jurnal ("[{0}] releu pornit: {1}" -f $p.Nume, $r.Mesaj) } else { & $jurnal ("[{0}] EROARE la pornire: {1}" -f $p.Nume, $r.Mesaj) }
  }

  $sup.versiune = $script:PuntiVersiune
  $sup.ultimaRulare = Get-DataIso $acumU
  if (-not $DoarVerifica) { & $Dep.ScrieStareSup $sup }
  return ,$actiuni.ToArray()
}
