# DialogTgz.psm1 - logica sarcinii "Gazpet Dialog TGZ" (varianta B: token `claude setup-token`, fara conectori).
# Fisier ASCII (PowerShell 5.1 citeste .psm1 fara BOM ca ANSI). Diacriticele necesare se construiesc cu [char].
# Functiile pure sunt testate offline in teste\test_dialog_tgz.ps1; Invoke-DialogTgz primeste psql / claude / log
# ca scriptblock-uri, ca fluxul complet sa poata fi rulat in test fara retea.

Set-StrictMode -Version 2.0

$script:Utf8FaraBom = New-Object System.Text.UTF8Encoding($false)
$script:A_breve = [string][char]0x0103   # a cu caciula (din "programata")
$script:TiparNume = '^(juridic|claude)#([0-9]{3})\.md$'
$script:TiparMarcaj = 'Dialog TGZ: ultimul procesat: juridic#([0-9]{3})'
$script:TiparRand = 'Dialog TGZ: ultimul procesat: juridic#[0-9]{3}[^\r\n]*'

# ---------------------------------------------------------------- utilitare

function Get-Md5Hex {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  $md5 = [System.Security.Cryptography.MD5]::Create()
  try {
    $h = $md5.ComputeHash($script:Utf8FaraBom.GetBytes($Text))
    return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $md5.Dispose() }
}

function Write-TextUtf8 {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)][AllowEmptyString()][string]$Text, [switch]$Adauga)
  if ($Adauga) { [System.IO.File]::AppendAllText($Cale, $Text, $script:Utf8FaraBom) }
  else { [System.IO.File]::WriteAllText($Cale, $Text, $script:Utf8FaraBom) }
}

function Read-TextUtf8 {
  param([Parameter(Mandatory)][string]$Cale)
  $t = [System.IO.File]::ReadAllText($Cale, $script:Utf8FaraBom)
  if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
  return $t
}

# Scoate caracterele de control, mascheaza orice token Anthropic si taie la Max caractere.
function ConvertTo-TextSigur {
  param([AllowNull()][AllowEmptyString()][string]$Text, [int]$Max = 300, [switch]$PastreazaLiniiNoi)
  if ($null -eq $Text) { return '' }
  $t = [regex]::Replace($Text, 'sk-ant-[A-Za-z0-9_\-]+', 'sk-ant-***')
  if ($PastreazaLiniiNoi) { $t = [regex]::Replace($t, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '') }
  else { $t = [regex]::Replace($t, '[\x00-\x1F\x7F]+', ' ').Trim() }
  if ($t.Length -gt $Max) { $t = $t.Substring(0, $Max) + '...' }
  return $t
}

function Test-TokenFormat {
  param([AllowNull()][AllowEmptyString()][string]$Token)
  if ([string]::IsNullOrEmpty($Token)) { return $false }
  return ($Token -cmatch '^sk-ant-oat01-[A-Za-z0-9_\-]{20,}$')
}

# Citeste tokenul din fisier. Intoarce @{Ok; Token; Motiv}. Motivul NU contine niciodata tokenul.
function Read-TokenFisier {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale -PathType Leaf)) {
    return @{ Ok = $false; Token = $null; Motiv = 'token lipsa: fisierul de token nu exista (claude setup-token -> ' + $Cale + ')' }
  }
  $t = (Read-TextUtf8 $Cale).Trim()
  if (-not (Test-TokenFormat $t)) {
    return @{ Ok = $false; Token = $null; Motiv = 'token in format gresit: nu incepe cu sk-ant-oat01- sau contine caractere nepermise (' + $Cale + ')' }
  }
  return @{ Ok = $true; Token = $t; Motiv = '' }
}

# Argumente pentru linia de comanda Windows (regulile CommandLineToArgvW).
function Join-ArgumenteWin {
  param([string[]]$Argumente)
  $parti = foreach ($a in $Argumente) {
    if ($a -ne '' -and $a -notmatch '[\s"]') { $a; continue }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $bs = 0
    foreach ($ch in $a.ToCharArray()) {
      if ($ch -eq [char]'\') { $bs++; continue }
      if ($ch -eq [char]'"') { [void]$sb.Append([char]'\', 2 * $bs + 1); [void]$sb.Append([char]'"'); $bs = 0; continue }
      if ($bs -gt 0) { [void]$sb.Append([char]'\', $bs); $bs = 0 }
      [void]$sb.Append($ch)
    }
    if ($bs -gt 0) { [void]$sb.Append([char]'\', 2 * $bs) }
    [void]$sb.Append('"')
    $sb.ToString()
  }
  return ($parti -join ' ')
}

# ---------------------------------------------------------------- folderul de dialog

function Test-EsteReparse {
  param([Parameter(Mandatory)][System.IO.FileSystemInfo]$Item)
  return [bool]($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
}

# Fisierele juridic#NNN.md / claude#NNN.md (exact 3 cifre, litere mici), doar fisiere obisnuite.
function Get-FisiereDialog {
  param([Parameter(Mandatory)][string]$Folder)
  $rez = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $Folder -File -Force -ErrorAction Stop)) {
    $m = [regex]::Match($f.Name, $script:TiparNume)
    if (-not $m.Success) { continue }
    if (Test-EsteReparse $f) { continue }
    $rez += [pscustomobject]@{ Tip = $m.Groups[1].Value; Numar = [int]$m.Groups[2].Value; Nume = $f.Name; Cale = $f.FullName }
  }
  return ,@($rez | Sort-Object Numar, Tip)
}

# NNN = max(numerele juridic# si claude# din folder) + 1, cel putin 1; peste 999 = eroare.
function Get-UrmatorulNumar {
  param([Parameter(Mandatory)][string]$Folder)
  $max = 0
  foreach ($f in (Get-FisiereDialog $Folder)) { if ($f.Numar -gt $max) { $max = $f.Numar } }
  $n = $max + 1
  if ($n -gt 999) { throw 'numerotarea dialogului a atins 999' }
  return $n
}

# Antetul = liniile de la inceput pana la prima linie goala (cel mult 12). Marcajul "(verificare programata)",
# cu sau fara diacritice, oriunde in antet (de regula in Subiect:).
function Test-AntetProgramat {
  param([Parameter(Mandatory)][string]$Cale)
  $text = Read-TextUtf8 $Cale
  if ($text.Length -gt 8192) { $text = $text.Substring(0, 8192) }
  $linii = $text -split "\r?\n"
  $antet = @()
  foreach ($l in $linii) {
    if ($l.Trim() -eq '') { break }
    $antet += $l
    if ($antet.Count -ge 12) { break }
  }
  $tipar = '\(verificare programat[a' + $script:A_breve + ']\)'
  return [bool](($antet -join "`n") -match $tipar)
}

# Fisierele juridic#NNN.md cu NNN > ultimul procesat si antet "(verificare programata)", crescator.
function Find-JuridicNoi {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][int]$UltimulProcesat)
  $rez = @()
  foreach ($f in (Get-FisiereDialog $Folder)) {
    if ($f.Tip -ne 'juridic' -or $f.Numar -le $UltimulProcesat) { continue }
    if (Test-AntetProgramat $f.Cale) { $rez += $f }
  }
  return ,@($rez | Sort-Object Numar)
}

# Instantaneu recursiv: cale relativa -> lungime|ultima scriere. Pentru a vedea ce a atins Claude in folder.
function Get-InstantaneuDialog {
  param([Parameter(Mandatory)][string]$Folder)
  $h = @{}
  $radacina = (Get-Item -LiteralPath $Folder).FullName.TrimEnd('\') + '\'
  foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Recurse -Force -ErrorAction Stop)) {
    $rel = $f.FullName.Substring($radacina.Length)
    if ($f.PSIsContainer) { $h[$rel] = 'DIR' }
    else { $h[$rel] = '{0}|{1}' -f $f.Length, $f.LastWriteTimeUtc.Ticks }
  }
  return $h
}

# Intoarce lista problemelor: orice fisier modificat / sters / nou, cu exceptia raspunsului asteptat si a
# fisierelor juridic#NNN.md noi (le poate scrie serverul Proiectului Juridic in timpul rularii).
function Compare-InstantaneuDialog {
  param([Parameter(Mandatory)][hashtable]$Inainte, [Parameter(Mandatory)][hashtable]$Dupa, [Parameter(Mandatory)][string]$NumeRaspuns)
  $probleme = @()
  foreach ($k in $Inainte.Keys) {
    if (-not $Dupa.ContainsKey($k)) { $probleme += 'sters: ' + $k }
    elseif ($Dupa[$k] -ne $Inainte[$k]) { $probleme += 'modificat: ' + $k }
  }
  foreach ($k in $Dupa.Keys) {
    if ($Inainte.ContainsKey($k)) { continue }
    if ($k -ceq $NumeRaspuns) { continue }
    if ($k -cmatch '^juridic#[0-9]{3}\.md$') { continue }
    $probleme += 'nou: ' + $k
  }
  return ,@($probleme | Sort-Object)
}

# ---------------------------------------------------------------- handoff_activ

# Numarul din randul "Dialog TGZ: ultimul procesat: juridic#NNN". Exact o aparitie, altfel exceptie.
function Get-UltimulProcesat {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  $m = [regex]::Matches($Text, $script:TiparMarcaj)
  if ($m.Count -eq 0) { throw 'randul "Dialog TGZ: ultimul procesat: juridic#NNN" lipseste din handoff_activ' }
  if ($m.Count -gt 1) { throw 'randul "Dialog TGZ: ultimul procesat: juridic#NNN" apare de ' + $m.Count + ' ori in handoff_activ' }
  return [int]$m[0].Groups[1].Value
}

function Format-RandDialog {
  param([Parameter(Mandatory)][int]$NrJuridic, [Parameter(Mandatory)][int]$NrClaude, [Parameter(Mandatory)][string]$Cand)
  return ('Dialog TGZ: ultimul procesat: juridic#{0:000} (raspuns claude#{1:000}, {2})' -f $NrJuridic, $NrClaude, $Cand)
}

# Inlocuieste DOAR randul-marcaj (de la "Dialog TGZ:" pana la capatul liniei). Aceeasi regula ca
# sql\actualizeaza_handoff.sql; md5-ul rezultatului se verifica si in BD.
function Update-RandDialog {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text, [Parameter(Mandatory)][int]$NrJuridic,
        [Parameter(Mandatory)][int]$NrClaude, [Parameter(Mandatory)][string]$Cand)
  if ($Cand -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$') { throw 'Cand invalid' }
  if ($NrJuridic -lt 1 -or $NrJuridic -gt 999 -or $NrClaude -lt 1 -or $NrClaude -gt 999) { throw 'numar invalid' }
  [void](Get-UltimulProcesat $Text)   # exact o aparitie
  $nou = Format-RandDialog -NrJuridic $NrJuridic -NrClaude $NrClaude -Cand $Cand
  $re = New-Object System.Text.RegularExpressions.Regex($script:TiparRand)
  return $re.Replace($Text, [System.Text.RegularExpressions.MatchEvaluator] { param($x) $nou }, 1)
}

# Linia "md5|base64" din sql\citeste_handoff.sql -> @{Md5; Text}. Verifica md5-ul local.
function ConvertFrom-IesireHandoff {
  param([string[]]$Linii)
  $bune = @($Linii | Where-Object { $_ -and $_.Trim() -ne '' })
  if ($bune.Count -ne 1) { throw ('citirea handoff_activ a intors ' + $bune.Count + ' linii (astept 1)') }
  $p = $bune[0].Trim().Split('|', 2)
  if ($p.Count -ne 2 -or $p[0] -notmatch '^[0-9a-f]{32}$') { throw 'iesire handoff in format neasteptat' }
  $text = $script:Utf8FaraBom.GetString([Convert]::FromBase64String($p[1]))
  if ((Get-Md5Hex $text) -ne $p[0]) { throw 'md5 local diferit de md5 din BD la citirea handoff_activ' }
  return @{ Md5 = $p[0]; Text = $text }
}

# ---------------------------------------------------------------- raspunsul lui Claude

function Get-UltimaLinie {
  param([Parameter(Mandatory)][string]$Cale)
  $linii = (Read-TextUtf8 $Cale) -split "\r?\n"
  for ($i = $linii.Count - 1; $i -ge 0; $i--) {
    if ($linii[$i].Trim() -ne '') { return $linii[$i].Trim() }
  }
  return ''
}

# GATA claude#NNN (cu NNN asteptat) / OPRIT [motiv] / EROARE [motiv]; orice altceva = EROARE.
function ConvertFrom-UltimaLinie {
  param([AllowEmptyString()][string]$Linie, [Parameter(Mandatory)][int]$NumarAsteptat)
  $l = ConvertTo-TextSigur $Linie 300
  if ($l -cmatch '^GATA claude#([0-9]{3})$') {
    if ([int]$Matches[1] -eq $NumarAsteptat) { return @{ Stare = 'GATA'; Linie = $l } }
    return @{ Stare = 'EROARE'; Linie = ('EROARE ultima linie "{0}" nu corespunde cu claude#{1:000}' -f $l, $NumarAsteptat) }
  }
  if ($l -cmatch '^OPRIT(\s.*)?$') { return @{ Stare = 'OPRIT'; Linie = $l } }
  if ($l -cmatch '^EROARE(\s.*)?$') { return @{ Stare = 'EROARE'; Linie = $l } }
  return @{ Stare = 'EROARE'; Linie = ('EROARE ultima linie nerecunoscuta: "{0}"' -f (ConvertTo-TextSigur $l 120)) }
}

# ---------------------------------------------------------------- prompt

function Format-Prompt {
  param([Parameter(Mandatory)][string]$Sablon, [Parameter(Mandatory)][hashtable]$Valori)
  $t = $Sablon
  foreach ($k in $Valori.Keys) { $t = $t.Replace('{{' + $k + '}}', [string]$Valori[$k]) }
  $rest = [regex]::Match($t, '\{\{[A-Z_]+\}\}')
  if ($rest.Success) { throw ('marcaj necompletat in prompt: ' + $rest.Value) }
  return $t
}

# Forma POSIX ceruta de regulile de permisiuni Claude Code pe Windows: C:\a\b -> //c/a/b
function ConvertTo-CaleRegula {
  param([Parameter(Mandatory)][string]$Cale)
  $c = $Cale.TrimEnd('\', '/') -replace '\\', '/'
  if ($c -match '^([A-Za-z]):/(.*)$') { return '//' + $Matches[1].ToLower() + '/' + $Matches[2] }
  throw ('cale fara litera de disc: ' + $Cale)
}

# ---------------------------------------------------------------- procese reale (psql / claude)

function Invoke-ProcesCapturat {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Argumente, [hashtable]$Env = @{}, [string[]]$EnvSterse = @(),
        [string]$Cwd, [string]$Stdin, [int]$TimeoutSec = 600)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = Join-ArgumenteWin $Argumente
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.StandardOutputEncoding = $script:Utf8FaraBom
  $psi.StandardErrorEncoding = $script:Utf8FaraBom
  if ($Cwd) { $psi.WorkingDirectory = $Cwd }
  foreach ($k in $EnvSterse) { if ($psi.EnvironmentVariables.ContainsKey($k)) { $psi.EnvironmentVariables.Remove($k) } }
  foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = [string]$Env[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $tOut = $p.StandardOutput.ReadToEndAsync()
  $tErr = $p.StandardError.ReadToEndAsync()
  if ($Stdin) {
    $b = $script:Utf8FaraBom.GetBytes($Stdin)
    $p.StandardInput.BaseStream.Write($b, 0, $b.Length)
    $p.StandardInput.BaseStream.Flush()
  }
  $p.StandardInput.Close()
  $timeout = -not $p.WaitForExit($TimeoutSec * 1000)
  if ($timeout) {
    & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null
    [void]$p.WaitForExit(30000)
  } else { $p.WaitForExit() }
  [void]$tOut.Wait(30000); [void]$tErr.Wait(30000)
  $cod = if ($timeout) { -1 } else { $p.ExitCode }
  $out = if ($tOut.IsCompleted) { $tOut.Result } else { '' }
  $err = if ($tErr.IsCompleted) { $tErr.Result } else { '' }
  return @{ Cod = $cod; Out = $out; Err = $err; Timeout = $timeout }
}

# psql cu fisier .sql FIX din repo; variabilele trec doar daca sunt valori simple (cifre, hex, data).
function Invoke-PsqlFisier {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$FisierSql, [hashtable]$Variabile = @{}, [switch]$Tuple)
  $a = @('-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-h', $Config.PgHost, '-p', [string]$Config.PgPort, '-U', $Config.PgUser, '-d', $Config.PgDb)
  if ($Tuple) { $a += @('-A', '-t') }
  foreach ($k in $Variabile.Keys) {
    $v = [string]$Variabile[$k]
    if ($k -notmatch '^[a-z_]{1,32}$' -or $v -notmatch '^[0-9A-Za-z:_ \-]{1,64}$') { throw ('variabila psql refuzata: ' + $k) }
    $a += @('-v', ($k + '=' + $v))
  }
  $a += @('-f', $FisierSql)
  $r = Invoke-ProcesCapturat -Exe $Config.PsqlExe -Argumente $a -TimeoutSec 180 `
       -Env @{ PGCLIENTENCODING = 'UTF8'; PGCONNECT_TIMEOUT = '20'; PGAPPNAME = 'dialog_tgz' } -EnvSterse @('PGPASSWORD')
  return @{ Cod = $r.Cod; Linii = @($r.Out -split "\r?\n"); Err = $r.Err }
}

function Get-ArgumenteClaude {
  param([Parameter(Mandatory)][hashtable]$Config, [string[]]$Radacini)
  $regula = 'Edit(' + (ConvertTo-CaleRegula $Config.DialogDir) + '/**)'
  $a = @('-p',
         '--model', $Config.Model,
         '--effort', $Config.Effort,
         '--max-turns', [string]$Config.MaxTurns,
         '--restricted',
         '--tools', 'Read,Glob,Grep,Edit,Write',
         '--allowedTools', ('Read,Glob,Grep,' + $regula),
         '--disallowedTools', 'Bash,PowerShell,WebFetch,WebSearch',
         '--permission-mode', 'dontAsk',
         '--strict-mcp-config',
         '--no-session-persistence',
         '--disable-slash-commands',
         '--output-format', 'text',
         '--add-dir', $Config.WorkDir)
  foreach ($r in $Radacini) { $a += @('--add-dir', $r) }
  return ,$a
}

function Invoke-ClaudeReal {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Prompt, [Parameter(Mandatory)][string]$Token, [string[]]$Radacini)
  $cfgDir = Join-Path $Config.WorkDir 'claude_cfg'
  if (-not (Test-Path -LiteralPath $cfgDir)) { [void](New-Item -ItemType Directory -Path $cfgDir) }
  $envNou = @{ CLAUDE_CODE_OAUTH_TOKEN = $Token; CLAUDE_CONFIG_DIR = $cfgDir; DISABLE_AUTOUPDATER = '1' }
  $r = Invoke-ProcesCapturat -Exe $Config.ClaudeExe -Argumente (Get-ArgumenteClaude $Config $Radacini) -Env $envNou `
       -EnvSterse @('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX') `
       -Cwd $Config.DialogDir -Stdin $Prompt -TimeoutSec ([int]$Config.TimeoutMin * 60)
  return $r
}

# ---------------------------------------------------------------- fluxul complet

# Intoarce @{Stare = GATA|OPRIT|EROARE|NIMIC NOU; Linie; Cod}. Nu arunca: orice exceptie devine EROARE.
# $Psql: { param($FisierSql, [hashtable]$Variabile, [bool]$Tuple) -> @{Cod; Linii; Err} }
# $Claude: { param([string]$Prompt, [string]$Token, [string[]]$Radacini) -> @{Cod; Out; Err; Timeout} }
# $Log: { param([string]$Mesaj) }
function Invoke-DialogTgz {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][scriptblock]$Psql,
        [Parameter(Mandatory)][scriptblock]$Claude, [Parameter(Mandatory)][scriptblock]$Log, [datetime]$Acum = (Get-Date))
  function Rez([string]$Stare, [string]$Linie, [int]$Cod) { return @{ Stare = $Stare; Linie = (ConvertTo-TextSigur $Linie 400); Cod = $Cod } }
  try {
    # (g) token
    $tok = Read-TokenFisier $Config.TokenFile
    if (-not $tok.Ok) { return (Rez 'EROARE' ('EROARE ' + $tok.Motiv) 1) }
    & $Log 'token: prezent, format sk-ant-oat01- corect (valoarea nu se scrie in log)'

    $folder = Get-Item -LiteralPath $Config.DialogDir -ErrorAction SilentlyContinue
    if ($null -eq $folder -or -not $folder.PSIsContainer -or (Test-EsteReparse $folder)) {
      return (Rez 'EROARE' ('EROARE folderul de dialog lipseste sau e legatura: ' + $Config.DialogDir) 1)
    }

    # (a) handoff_activ
    $r = & $Psql (Join-Path $Config.SqlDir 'citeste_handoff.sql') @{} $true
    if ($r.Cod -ne 0) { return (Rez 'EROARE' ('EROARE psql citire handoff_activ (cod ' + $r.Cod + '): ' + $r.Err) 1) }
    $h = ConvertFrom-IesireHandoff $r.Linii
    $ultimul = Get-UltimulProcesat $h.Text
    & $Log ('handoff_activ: md5 {0}, ultimul procesat juridic#{1:000}' -f $h.Md5, $ultimul)

    # (b) fisiere noi
    $noi = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul
    if ($noi.Count -eq 0) {
      & $Log 'niciun juridic#NNN nou cu antet (verificare programata); Claude nu porneste'
      return (Rez 'NIMIC NOU' ('NIMIC NOU (ultimul procesat juridic#{0:000})' -f $ultimul) 0)
    }
    $maxJuridic = ($noi | Measure-Object -Property Numar -Maximum).Maximum
    & $Log ('fisiere noi: ' + (($noi | ForEach-Object { $_.Nume }) -join ', '))

    # (c) context agregat
    if (-not (Test-Path -LiteralPath $Config.WorkDir)) { [void](New-Item -ItemType Directory -Path $Config.WorkDir) }
    $cale_context = Join-Path $Config.WorkDir 'context.md'
    $r = & $Psql (Join-Path $Config.SqlDir 'context_agregat.sql') @{} $false
    if ($r.Cod -ne 0) { return (Rez 'EROARE' ('EROARE psql export context (cod ' + $r.Cod + '): ' + $r.Err) 1) }
    $antet = "# Context Redari TGZ - cifre agregate`n`nGenerat: " + $Acum.ToString('yyyy-MM-dd HH:mm') +
             " (doar SELECT, fara nume / telefoane / adrese / CNP).`n`n"
    Write-TextUtf8 $cale_context ($antet + (($r.Linii) -join "`n") + "`n")
    & $Log ('context agregat scris: ' + $cale_context)

    # (d) Claude
    $nnn = Get-UrmatorulNumar $Config.DialogDir
    $numeRaspuns = 'claude#{0:000}.md' -f $nnn
    $caleRaspuns = Join-Path $Config.DialogDir $numeRaspuns
    if (Test-Path -LiteralPath $caleRaspuns) { return (Rez 'EROARE' ('EROARE ' + $numeRaspuns + ' exista deja') 1) }
    $radacini = @($Config.RadaciniAtasamente | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) })
    & $Log ('radacini atasamente accesibile: ' + $(if ($radacini.Count) { $radacini -join '; ' } else { '(niciuna)' }))
    $sablon = Read-TextUtf8 $Config.PromptFile
    $prompt = Format-Prompt $sablon @{
      FISIERE_JURIDIC = (($noi | ForEach-Object { '- ' + $_.Cale }) -join "`n")
      NNN = ('{0:000}' -f $nnn)
      CALE_RASPUNS = $caleRaspuns
      CALE_CONTEXT = $cale_context
      FOLDER_DIALOG = $Config.DialogDir
      RADACINI_ATASAMENTE = $(if ($radacini.Count) { ($radacini | ForEach-Object { '- ' + $_ }) -join "`n" } else { '- (niciuna accesibila pe acest calculator)' })
      DATA = $Acum.ToString('yyyy-MM-ddTHH:mm:sszzz')
      ULTIMUL_PROCESAT = ('{0:000}' -f $ultimul)
    }
    $inainte = Get-InstantaneuDialog $Config.DialogDir
    & $Log ('pornesc claude -p: model {0}, effort {1}, max-turns {2}, raspuns asteptat {3}' -f $Config.Model, $Config.Effort, $Config.MaxTurns, $numeRaspuns)
    $rc = & $Claude $prompt $tok.Token $radacini
    $tok = $null
    & $Log ('claude: cod iesire {0}{1}' -f $rc.Cod, $(if ($rc.Timeout) { ' (TIMEOUT, oprit cu taskkill /T)' } else { '' }))
    if ($rc.Out) { & $Log ('claude stdout:' + "`n" + (ConvertTo-TextSigur $rc.Out 20000 -PastreazaLiniiNoi)) }
    if ($rc.Err) { & $Log ('claude stderr:' + "`n" + (ConvertTo-TextSigur $rc.Err 5000 -PastreazaLiniiNoi)) }

    $probleme = Compare-InstantaneuDialog -Inainte $inainte -Dupa (Get-InstantaneuDialog $Config.DialogDir) -NumeRaspuns $numeRaspuns
    if (-not (Test-Path -LiteralPath $caleRaspuns -PathType Leaf)) {
      return (Rez 'EROARE' ('EROARE {0} nu a fost scris (claude cod {1})' -f $numeRaspuns, $rc.Cod) 1)
    }
    if ($probleme.Count -gt 0) {
      & $Log ('fisiere atinse in afara raspunsului: ' + ($probleme -join '; '))
      return (Rez 'EROARE' ('EROARE {0} scris, dar Claude a atins si alte fisiere din dialog: {1}' -f $numeRaspuns, ($probleme -join '; ')) 1)
    }
    $ultima = ConvertFrom-UltimaLinie (Get-UltimaLinie $caleRaspuns) $nnn
    & $Log ('ultima linie: ' + $ultima.Linie)
    if ($ultima.Stare -eq 'OPRIT') { return (Rez 'OPRIT' $ultima.Linie 0) }
    if ($ultima.Stare -ne 'GATA') { return (Rez 'EROARE' $ultima.Linie 1) }

    # (e) handoff_activ: doar randul Dialog TGZ, cu garda md5
    $cand = $Acum.ToString('yyyy-MM-dd HH:mm')
    $textNou = Update-RandDialog -Text $h.Text -NrJuridic $maxJuridic -NrClaude $nnn -Cand $cand
    $md5Nou = Get-Md5Hex $textNou
    $r = & $Psql (Join-Path $Config.SqlDir 'actualizeaza_handoff.sql') @{
      md5_vechi = $h.Md5; md5_nou = $md5Nou; nr_juridic = ('{0:000}' -f $maxJuridic); nr_claude = ('{0:000}' -f $nnn); cand = $cand
    } $true
    if ($r.Cod -ne 0) { return (Rez 'EROARE' ('EROARE {0} scris, dar UPDATE handoff_activ a esuat (psql cod {1}): {2}' -f $numeRaspuns, $r.Cod, $r.Err) 1) }
    $ok = @($r.Linii | Where-Object { $_.Trim() -ceq ('ACTUALIZAT|' + $md5Nou) })
    if ($ok.Count -ne 1) {
      return (Rez 'EROARE' ('EROARE {0} scris, dar handoff_activ s-a schimbat intre timp (0 randuri actualizate); nu s-a fortat' -f $numeRaspuns) 1)
    }
    & $Log ('handoff_activ actualizat: juridic#{0:000} -> claude#{1:000}, md5 nou {2}' -f $maxJuridic, $nnn, $md5Nou)
    return (Rez 'GATA' $ultima.Linie 0)
  } catch {
    return (Rez 'EROARE' ('EROARE ' + $_.Exception.Message) 1)
  }
}

Export-ModuleMember -Function *
