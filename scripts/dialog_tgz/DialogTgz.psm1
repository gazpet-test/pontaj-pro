# DialogTgz.psm1 - logica sarcinii "Gazpet Dialog TGZ" (varianta B: token `claude setup-token`, fara conectori).
# Fisier ASCII (PowerShell 5.1 citeste .psm1 fara BOM ca ANSI). Diacriticele necesare se construiesc cu [char].
# Functiile pure sunt testate offline in teste\test_dialog_tgz.ps1; Invoke-DialogTgz primeste psql / claude / log
# ca scriptblock-uri, ca fluxul complet sa poata fi rulat in test fara retea.
#
# r2 (Jakarinos r1 NO-GO):
# - ERP strict doar-citire: nicio scriere in BD; cursorul "ultimul procesat" sta intr-un fisier local
#   (paw-data\out\dialog_tgz_cursor.txt); exportul verifica in BD ca rolul nu poate scrie nimic (sql\context_agregat.sql).
# - Agentul NU are drept de scriere in dialog: scrie doar raspuns.md in folderul privat al rularii. Orchestratorul
#   verifica raspunsul (stare, marime, date personale) si il publica el, prin creare exclusiva claude#NNN.md
#   (NNN ales la publicare, mutare atomica fara suprascriere), cu antetul "Raspuns la:" scris de program.
# - Date personale (telefon, CNP, e-mail, adresa, act de identitate) cautate in raspuns, log si stare inainte de scriere.
# - Timeout / cod de iesire nenul / rezultat JSON fara succes = EROARE; cursorul nu avanseaza.
# - Oprirea arborelui de procese se confirma; daca nu se poate confirma, un marcaj blocheaza rularile urmatoare.

Set-StrictMode -Version 2.0

$script:Utf8FaraBom = New-Object System.Text.UTF8Encoding($false)
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$script:A_breve = [string][char]0x0103   # a cu caciula (din "programata")
$script:TiparNume = '^(juridic|claude)#([0-9]{3})\.md$'
$script:TiparCursor = '^juridic#([0-9]{3})(?: \(raspuns claude#[0-9]{3}, [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\))?$'
$script:MaxRaspunsOcteti = 200 * 1024   # serverul juridic citeste cel mult 200 KB dintr-un claude#NNN.md
$script:NumeRaspunsAgent = 'raspuns.md'

# ---------------------------------------------------------------- utilitare

function Get-Sha256Fisier {
  param([Parameter(Mandatory)][string]$Cale)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $h = $sha.ComputeHash([System.IO.File]::ReadAllBytes($Cale))
    return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
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

# Date personale cautate in tot ce iese din sarcina (raspuns publicat, log, stare). Intoarce codurile gasite
# (sortate, unice; apelantul pune @()); nimic = nimic gasit. Numele de persoane NU se pot recunoaste sigur cu tipare: pentru ele
# raman regula din prompt si faptul ca exportul din BD nu contine nume.
# Granitele (?<![0-9A-Za-z]) / (?![0-9A-Za-z]) evita potrivirile in interiorul hash-urilor si al codurilor.
$script:TipareDatePersonale = @(
  @{ Cod = 'EMAIL';   Tipar = '[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}' },
  @{ Cod = 'TELEFON'; Tipar = '(?<![0-9A-Za-z+])(?:\+40|0040|0)[ .\-]?[237](?:[ .\-]?[0-9]){8}(?![0-9A-Za-z])' },
  @{ Cod = 'TELEFON'; Tipar = '\(0[23][0-9]{2}\)[ .\-]?[0-9]{3}[ .\-]?[0-9]{3}(?![0-9])' },
  @{ Cod = 'CNP';     Tipar = '(?<![0-9A-Za-z])[1-9][0-9]{12}(?![0-9A-Za-z])' },
  @{ Cod = 'ACT_IDENTITATE'; Tipar = '(?i)(?<![\p{L}])seri[ae][ :]*[A-Z]{2}[ ,]*(?:nr\.?|num\p{L}r)?[ :]*[0-9]{6}(?![0-9])' },
  @{ Cod = 'ADRESA';  Tipar = '(?i)(?<![\p{L}])(?:str\.|strada|bd\.|bdul\.?|bulevardul|calea|aleea|\p{L}os\.|\p{L}oseaua|sat(?:ul)?)[ ]+[^\r\n]{1,60}?(?<![\p{L}])nr\.?[ ]*[0-9]{1,4}' },
  @{ Cod = 'ADRESA';  Tipar = '(?i)(?<![\p{L}])(?:bl\.|bloc)[ ]*[A-Z0-9]{1,4}[ ,]+(?:sc\.|scara)[ ]*[A-Z0-9]{1,3}' },
  @{ Cod = 'ADRESA';  Tipar = '(?i)(?<![\p{L}])ap\.[ ]*[0-9]{1,4}(?![0-9])' }
)

function Find-DatePersonale {
  param([AllowNull()][AllowEmptyString()][string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return }
  $coduri = @()
  foreach ($x in $script:TipareDatePersonale) {
    if ([regex]::IsMatch($Text, $x.Tipar)) { $coduri += $x.Cod }
  }
  return ($coduri | Sort-Object -Unique)
}

# Pentru log si stare: mascheaza tokenurile Anthropic, scoate caracterele de control, iar daca textul
# (INTREG, inainte de taiere) contine date personale il inlocuieste complet cu codurile gasite. Apoi taie la Max.
function ConvertTo-TextSigur {
  param([AllowNull()][AllowEmptyString()][string]$Text, [int]$Max = 300, [switch]$PastreazaLiniiNoi)
  if ($null -eq $Text) { return '' }
  $t = [regex]::Replace($Text, 'sk-ant-[A-Za-z0-9_\-]+', 'sk-ant-***')
  if ($PastreazaLiniiNoi) { $t = [regex]::Replace($t, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '') }
  else { $t = [regex]::Replace($t, '[\x00-\x1F\x7F]+', ' ').Trim() }
  $dp = @(Find-DatePersonale $t)
  if ($dp.Count -gt 0) { return ('[text ascuns: date personale detectate ({0}), {1} caractere]' -f ($dp -join ', '), $t.Length) }
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

# Instantaneu recursiv: cale relativa -> lungime|ultima scriere. Pentru a vedea daca s-a atins ceva in dialog.
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

# Lista problemelor: orice fisier modificat / sters / nou, cu exceptia fisierelor juridic#NNN.md noi (le poate scrie
# Proiectul Juridic in timpul rularii). Agentul nu are drept de scriere aici; verificarea e a doua bariera.
function Compare-InstantaneuDialog {
  param([Parameter(Mandatory)][hashtable]$Inainte, [Parameter(Mandatory)][hashtable]$Dupa)
  $probleme = @()
  foreach ($k in $Inainte.Keys) {
    if (-not $Dupa.ContainsKey($k)) { $probleme += 'sters: ' + $k }
    elseif ($Dupa[$k] -ne $Inainte[$k]) { $probleme += 'modificat: ' + $k }
  }
  foreach ($k in $Dupa.Keys) {
    if ($Inainte.ContainsKey($k)) { continue }
    if ($k -cmatch '^juridic#[0-9]{3}\.md$') { continue }
    $probleme += 'nou: ' + $k
  }
  return ,@($probleme | Sort-Object)
}

# ---------------------------------------------------------------- cursorul local (ultimul juridic# procesat)

# Fisierul are exact un rand nevid: "juridic#NNN" sau "juridic#NNN (raspuns claude#NNN, AAAA-LL-ZZ HH:MM)".
# Lipsa / alt format = exceptie (nu se ghiceste: primul cursor il scrie chat-ul la instalare).
function Read-Cursor {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale -PathType Leaf)) { throw ('cursorul lipseste: ' + $Cale + ' (se creeaza la instalare cu "juridic#NNN")') }
  $linii = @((Read-TextUtf8 $Cale) -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
  if ($linii.Count -ne 1) { throw ('cursorul are ' + $linii.Count + ' randuri nevide (astept 1): ' + $Cale) }
  $m = [regex]::Match($linii[0].Trim(), $script:TiparCursor)
  if (-not $m.Success) { throw ('cursor in format necunoscut: ' + $Cale) }
  return [int]$m.Groups[1].Value
}

function Format-Cursor {
  param([Parameter(Mandatory)][int]$NrJuridic, [Parameter(Mandatory)][int]$NrClaude, [Parameter(Mandatory)][string]$Cand)
  if ($Cand -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$') { throw 'Cand invalid' }
  if ($NrJuridic -lt 1 -or $NrJuridic -gt 999 -or $NrClaude -lt 1 -or $NrClaude -gt 999) { throw 'numar invalid' }
  return ('juridic#{0:000} (raspuns claude#{1:000}, {2})' -f $NrJuridic, $NrClaude, $Cand)
}

# Avans cu CAS: cursorul de pe disc trebuie sa fie inca $Vechi (altfel cineva l-a mutat de mana -> exceptie,
# nu suprascrie), iar noul numar trebuie sa fie mai mare. Scriere atomica: fisier temporar + File.Replace.
function Write-Cursor {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)][int]$Vechi, [Parameter(Mandatory)][int]$NrJuridic,
        [Parameter(Mandatory)][int]$NrClaude, [Parameter(Mandatory)][string]$Cand)
  $text = Format-Cursor -NrJuridic $NrJuridic -NrClaude $NrClaude -Cand $Cand
  if ($NrJuridic -le $Vechi) { throw ('cursorul nu poate da inapoi: {0} -> {1}' -f $Vechi, $NrJuridic) }
  $acum = Read-Cursor $Cale
  if ($acum -ne $Vechi) { throw ('cursorul s-a schimbat intre timp (citit juridic#{0:000}, acum juridic#{1:000}); nu se suprascrie' -f $Vechi, $acum) }
  $tmp = $Cale + '.tmp-' + [guid]::NewGuid().ToString('N')
  try {
    Write-TextUtf8 $tmp ($text + "`r`n")
    [System.IO.File]::Replace($tmp, $Cale, [NullString]::Value)
  } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
  if ((Read-Cursor $Cale) -ne $NrJuridic) { throw 'cursorul nu s-a putut verifica dupa scriere' }
  return $text
}

# ---------------------------------------------------------------- raspunsul agentului

# Ultima linie a raspunsului agentului: GATA / OPRIT [motiv] / EROARE [motiv]; orice altceva = EROARE.
# Numarul claude#NNN nu il mai scrie agentul: il pune orchestratorul la publicare.
function ConvertFrom-UltimaLinie {
  param([AllowEmptyString()][string]$Linie)
  $l = ConvertTo-TextSigur $Linie 300
  if ($l -ceq 'GATA') { return @{ Stare = 'GATA'; Linie = $l } }
  if ($l -cmatch '^OPRIT(\s.*)?$') { return @{ Stare = 'OPRIT'; Linie = $l } }
  if ($l -cmatch '^EROARE(\s.*)?$') { return @{ Stare = 'EROARE'; Linie = $l } }
  return @{ Stare = 'EROARE'; Linie = ('EROARE ultima linie nerecunoscuta: "{0}"' -f (ConvertTo-TextSigur $l 120)) }
}

# Citeste raspuns.md al agentului: UTF-8 valid, cel mult 200 KB (peste = refuz, nu taiere), ultima linie nevida =
# starea, restul = corpul (obligatoriu nevid pentru GATA / OPRIT). Intoarce @{Stare; Linie; Corp}.
function Read-RaspunsAgent {
  param([Parameter(Mandatory)][string]$Cale)
  $octeti = [System.IO.File]::ReadAllBytes($Cale)
  if ($octeti.Length -gt $script:MaxRaspunsOcteti) {
    return @{ Stare = 'EROARE'; Linie = ('EROARE raspunsul are {0} octeti, peste limita de {1}' -f $octeti.Length, $script:MaxRaspunsOcteti); Corp = '' }
  }
  try { $t = $script:Utf8Strict.GetString($octeti) }
  catch { return @{ Stare = 'EROARE'; Linie = 'EROARE raspunsul nu este UTF-8 valid'; Corp = '' } }
  if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
  $t = [regex]::Replace($t, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '')
  $linii = @($t -split "\r?\n")
  $i = $linii.Count - 1
  while ($i -ge 0 -and $linii[$i].Trim() -eq '') { $i-- }
  if ($i -lt 0) { return @{ Stare = 'EROARE'; Linie = 'EROARE raspunsul este gol'; Corp = '' } }
  $u = ConvertFrom-UltimaLinie $linii[$i].Trim()
  $corp = if ($i -gt 0) { (($linii[0..($i - 1)]) -join "`n").Trim() } else { '' }
  if ($u.Stare -ne 'EROARE' -and $corp -eq '') { return @{ Stare = 'EROARE'; Linie = 'EROARE raspunsul nu are corp inaintea ultimei linii'; Corp = '' } }
  return @{ Stare = $u.Stare; Linie = $u.Linie; Corp = $corp }
}

# Fisierul publicat: antetul il scrie programul (asocierea cu intrebarile prin "Raspuns la:", ca in conventia
# canalului), apoi corpul agentului, apoi linia de stare cu numarul ales la publicare.
function Format-RaspunsPublicat {
  param([Parameter(Mandatory)][string]$Corp, [Parameter(Mandatory)][int[]]$Juridic, [Parameter(Mandatory)][int]$Nnn,
        [Parameter(Mandatory)][string]$Data, [Parameter(Mandatory)][string]$Stare, [AllowEmptyString()][string]$Motiv = '')
  $lista = ($Juridic | Sort-Object | ForEach-Object { 'juridic#{0:000}' -f $_ }) -join ', '
  $final = if ($Stare -eq 'GATA') { 'GATA claude#{0:000}' -f $Nnn } elseif ($Stare -eq 'OPRIT') { ('OPRIT ' + $Motiv).TrimEnd() } else { throw 'stare nepublicabila' }
  $antet = 'De la: Claude Code (verificare programat' + $script:A_breve + ' Dialog TGZ)' + "`n" +
           'Data: ' + $Data + "`n" +
           'Subiect: R' + $script:A_breve + 'spuns la ' + $lista + "`n" +
           'Raspuns la: ' + $lista + "`n"
  return ($antet + "`n" + $Corp.Trim() + "`n`n" + $final + "`n")
}

# Publicare exclusiva: NNN = urmatorul liber CHIAR la publicare; textul complet se scrie intr-un fisier temporar
# din acelasi folder, apoi File.Move (atomic pe acelasi volum, ESUEAZA daca destinatia exista: nu suprascrie
# niciodata). Daca alt scriitor a luat intre timp claude#NNN sau juridic#NNN, se reia cu urmatorul numar.
# $Text: { param([int]$Nnn) -> textul final }. Intoarce @{Numar; Nume; Cale; JuridicAcelasiNumar}.
function Publish-RaspunsExclusiv {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][scriptblock]$Text, [int]$Incercari = 5)
  for ($i = 0; $i -lt $Incercari; $i++) {
    $n = Get-UrmatorulNumar $Folder
    $nume = 'claude#{0:000}.md' -f $n
    $final = Join-Path $Folder $nume
    $juridicN = Join-Path $Folder ('juridic#{0:000}.md' -f $n)
    $tmp = Join-Path $Folder ('_dialog_tgz_' + [guid]::NewGuid().ToString('N') + '.tmp')
    $reia = $false
    try {
      $continut = [string](& $Text $n)
      $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      try { $b = $script:Utf8FaraBom.GetBytes($continut); $fs.Write($b, 0, $b.Length); $fs.Flush($true) } finally { $fs.Dispose() }
      if (Test-Path -LiteralPath $juridicN) { $reia = $true }
      else {
        try { [System.IO.File]::Move($tmp, $final) }
        catch { if (Test-Path -LiteralPath $final) { $reia = $true } else { throw } }
      }
    } finally {
      if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
    if (-not $reia) {
      return @{ Numar = $n; Nume = $nume; Cale = $final; JuridicAcelasiNumar = [bool](Test-Path -LiteralPath $juridicN) }
    }
  }
  throw ('nu am gasit un numar claude#NNN liber dupa {0} incercari' -f $Incercari)
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

# Procesul radacina + toti descendentii (dupa ParentProcessId), cu momentul pornirii (anti refolosire de PID:
# un "copil" pornit inaintea parintelui nu e copilul lui).
function Get-ArboreProcese {
  param([Parameter(Mandatory)][int]$RadacinaPid)
  $toate = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate)
  $rez = @(); $vazute = @{}
  $coada = New-Object System.Collections.Queue
  $coada.Enqueue($RadacinaPid)
  while ($coada.Count -gt 0) {
    $id = [int]$coada.Dequeue()
    if ($vazute.ContainsKey($id)) { continue }
    $vazute[$id] = $true
    $x = @($toate | Where-Object { $_.ProcessId -eq $id }) | Select-Object -First 1
    if ($null -eq $x) { continue }
    $rez += [pscustomobject]@{ Pid = [int]$x.ProcessId; Start = [datetime]$x.CreationDate }
    foreach ($c in @($toate | Where-Object { $_.ParentProcessId -eq $id -and $_.ProcessId -ne $id -and $_.CreationDate -ge $x.CreationDate })) {
      $coada.Enqueue([int]$c.ProcessId)
    }
  }
  return ,@($rez)
}

# Viu = exista un proces cu acest PID pornit la acelasi moment (toleranta 1 s). Daca momentul nu se poate citi,
# se considera viu (fail-closed).
function Test-ProcesViu {
  param([Parameter(Mandatory)][int]$Id, [Parameter(Mandatory)][datetime]$Start)
  $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($null -eq $p) { return $false }
  try { $s = $p.StartTime } catch { return $true }
  return ([math]::Abs(($s.ToUniversalTime() - $Start.ToUniversalTime()).TotalSeconds) -lt 1)
}

# Opreste tot arborele si CONFIRMA: taskkill /T /F, apoi Stop-Process pe fiecare proces ramas din instantaneu,
# apoi asteapta pana la $AsteptareSec sa dispara toate. Intoarce @{Confirmat; Ramase (pid|ticks UTC); CodTaskkill}.
function Stop-ArboreProcese {
  param([Parameter(Mandatory)][int]$RadacinaPid, [datetime]$RadacinaStart, [int]$AsteptareSec = 30)
  try { $arbore = Get-ArboreProcese $RadacinaPid } catch { $arbore = @() }
  if ($arbore.Count -eq 0) {
    # instantaneul a esuat: macar radacina; fara moment de pornire = "viu daca exista PID-ul" (fail-closed)
    $arbore = @([pscustomobject]@{ Pid = $RadacinaPid; Start = $(if ($RadacinaStart) { $RadacinaStart } else { $null }) })
  }
  & taskkill.exe /T /F /PID $RadacinaPid 2>&1 | Out-Null
  $codKill = $LASTEXITCODE
  $limita = (Get-Date).AddSeconds($AsteptareSec)
  do {
    $vii = @($arbore | Where-Object { Test-ProcesInArbore $_ })
    if ($vii.Count -eq 0) { break }
    foreach ($v in $vii) { Stop-Process -Id $v.Pid -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limita)
  $vii = @($arbore | Where-Object { Test-ProcesInArbore $_ })
  $ramase = @($vii | ForEach-Object { '{0}|{1}' -f $_.Pid, $(if ($_.Start) { $_.Start.ToUniversalTime().Ticks } else { 0 }) })
  return @{ Confirmat = ($vii.Count -eq 0); Ramase = $ramase; CodTaskkill = $codKill }
}

function Test-ProcesInArbore {
  param([Parameter(Mandatory)]$Proces)
  if ($null -eq $Proces.Start) { return ($null -ne (Get-Process -Id $Proces.Pid -ErrorAction SilentlyContinue)) }
  return (Test-ProcesViu -Id $Proces.Pid -Start $Proces.Start)
}

# Marcajul "oprire neconfirmata": randuri "pid|ticks UTC" (0 = moment necunoscut: viu daca PID-ul exista). Cat timp un
# proces listat e inca viu, nicio rulare noua nu porneste (EROARE). Cand toate au disparut, marcajul se sterge si
# rularea continua. Format stricat = EROARE.
function Write-MarcajProcese {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)][string[]]$Ramase)
  Write-TextUtf8 $Cale ((($Ramase) -join "`r`n") + "`r`n")
}

function Test-MarcajProcese {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale)) { return @{ Exista = $false; Vii = @() } }
  $vii = @()
  foreach ($l in @((Read-TextUtf8 $Cale) -split "\r?\n" | Where-Object { $_.Trim() -ne '' })) {
    if ($l.Trim() -notmatch '^([0-9]{1,10})\|([0-9]{1,19})$') { throw ('marcaj de procese in format necunoscut: ' + $Cale) }
    $start = if ([long]$Matches[2] -eq 0) { $null } else { New-Object DateTime ([long]$Matches[2]), ([DateTimeKind]::Utc) }
    if (Test-ProcesInArbore ([pscustomobject]@{ Pid = [int]$Matches[1]; Start = $start })) { $vii += [int]$Matches[1] }
  }
  return @{ Exista = $true; Vii = $vii }
}

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
  $start = $null
  try { $start = $p.StartTime } catch { }
  $tOut = $p.StandardOutput.ReadToEndAsync()
  $tErr = $p.StandardError.ReadToEndAsync()
  if ($Stdin) {
    $b = $script:Utf8FaraBom.GetBytes($Stdin)
    $p.StandardInput.BaseStream.Write($b, 0, $b.Length)
    $p.StandardInput.BaseStream.Flush()
  }
  $p.StandardInput.Close()
  $timeout = -not $p.WaitForExit($TimeoutSec * 1000)
  $oprire = @{ Confirmat = $true; Ramase = @(); CodTaskkill = $null }
  if ($timeout) { $oprire = Stop-ArboreProcese -RadacinaPid $p.Id -RadacinaStart $start }
  else { $p.WaitForExit() }
  [void]$tOut.Wait(30000); [void]$tErr.Wait(30000)
  $cod = if ($timeout) { -1 } else { $p.ExitCode }
  $out = if ($tOut.IsCompleted) { $tOut.Result } else { '' }
  $err = if ($tErr.IsCompleted) { $tErr.Result } else { '' }
  return @{ Cod = $cod; Out = $out; Err = $err; Timeout = $timeout; OprireConfirmata = [bool]$oprire.Confirmat; Ramase = @($oprire.Ramase) }
}

# Utilizatori Postgres care pot scrie: refuzati inainte de conectare (garda principala e verificarea din BD,
# la inceputul sql\context_agregat.sql).
function Test-PgUserPermis {
  param([Parameter(Mandatory)][string]$PgUser)
  return -not ($PgUser -match '^(postgres|service_role|supabase_admin|supabase_auth_admin|supabase_storage_admin|authenticator|authenticated|anon)(\.|$)')
}

# psql cu fisier .sql FIX din repo, fara variabile.
function Invoke-PsqlFisier {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$FisierSql)
  if (-not (Test-PgUserPermis $Config.PgUser)) { throw ('utilizatorul Postgres ' + $Config.PgUser + ' poate scrie; sarcina cere rolul doar-citire') }
  $a = @('-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-h', $Config.PgHost, '-p', [string]$Config.PgPort, '-U', $Config.PgUser, '-d', $Config.PgDb, '-f', $FisierSql)
  $r = Invoke-ProcesCapturat -Exe $Config.PsqlExe -Argumente $a -TimeoutSec 180 `
       -Env @{ PGCLIENTENCODING = 'UTF8'; PGCONNECT_TIMEOUT = '20'; PGAPPNAME = 'dialog_tgz' } -EnvSterse @('PGPASSWORD')
  return @{ Cod = $r.Cod; Linii = @($r.Out -split "\r?\n"); Err = $r.Err }
}

# Agentul: citeste dialogul, contextul si radacinile NAS (--add-dir); SCRIE doar in folderul de iesire al rularii
# (directorul de lucru). Nicio regula de scriere pe dialog.
function Get-ArgumenteClaude {
  param([Parameter(Mandatory)][hashtable]$Config, [string[]]$Radacini, [Parameter(Mandatory)][string]$DirIntrare, [Parameter(Mandatory)][string]$DirIesire)
  $regula = 'Edit(' + (ConvertTo-CaleRegula $DirIesire) + '/**)'
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
         '--output-format', 'json',
         '--add-dir', $Config.DialogDir,
         '--add-dir', $DirIntrare)
  foreach ($r in $Radacini) { $a += @('--add-dir', $r) }
  return ,$a
}

# stdout-ul `claude -p --output-format json`: un obiect cu type=result. Succes DOAR pentru subtype=success si
# is_error=false (max-turns, erori de API etc. = esec). Textul raspunsului din JSON nu se foloseste si nu se logheaza.
function ConvertFrom-IesireClaude {
  param([AllowNull()][AllowEmptyString()][string]$Out)
  if ($null -eq $Out -or $Out.Trim() -eq '') { return @{ Ok = $false; Motiv = 'stdout gol' } }
  try { $j = $Out.Trim() | ConvertFrom-Json } catch { return @{ Ok = $false; Motiv = 'stdout nu este JSON' } }
  if ($j -is [array]) { return @{ Ok = $false; Motiv = 'stdout JSON neasteptat (lista)' } }
  $v = @{}
  foreach ($k in 'type', 'subtype', 'is_error', 'num_turns') {
    $pr = $j.PSObject.Properties[$k]
    $v[$k] = if ($pr) { $pr.Value } else { $null }
  }
  $desc = 'type={0}, subtype={1}, is_error={2}, num_turns={3}' -f $v.type, $v.subtype, $v.is_error, $v.num_turns
  if ($v.type -cne 'result') { return @{ Ok = $false; Motiv = 'rezultat JSON fara type=result (' + $desc + ')' } }
  if ($v.subtype -cne 'success') { return @{ Ok = $false; Motiv = 'rezultat fara succes (' + $desc + ')' } }
  if (-not ($v.is_error -is [bool]) -or $v.is_error) { return @{ Ok = $false; Motiv = 'rezultat cu is_error (' + $desc + ')' } }
  return @{ Ok = $true; Motiv = $desc }
}

function Invoke-ClaudeReal {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Prompt, [Parameter(Mandatory)][string]$Token,
        [string[]]$Radacini, [Parameter(Mandatory)][string]$DirIntrare, [Parameter(Mandatory)][string]$DirIesire)
  # configuratia Claude Code a sarcinii: in WorkDir\cfg, in afara directoarelor date agentului
  $cfgDir = Join-Path $Config.WorkDir 'cfg'
  if (-not (Test-Path -LiteralPath $cfgDir)) { [void](New-Item -ItemType Directory -Path $cfgDir) }
  $envNou = @{ CLAUDE_CODE_OAUTH_TOKEN = $Token; CLAUDE_CONFIG_DIR = $cfgDir; DISABLE_AUTOUPDATER = '1' }
  $r = Invoke-ProcesCapturat -Exe $Config.ClaudeExe -Argumente (Get-ArgumenteClaude $Config $Radacini $DirIntrare $DirIesire) -Env $envNou `
       -EnvSterse @('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX') `
       -Cwd $DirIesire -Stdin $Prompt -TimeoutSec ([int]$Config.TimeoutMin * 60)
  return $r
}

# ---------------------------------------------------------------- fluxul complet

# Intoarce @{Stare = GATA|OPRIT|EROARE|NIMIC NOU; Linie; Cod}. Nu arunca: orice exceptie devine EROARE.
# $Psql: { param($FisierSql) -> @{Cod; Linii; Err} }
# $Claude: { param([string]$Prompt, [string]$Token, [string[]]$Radacini, [string]$DirIntrare, [string]$DirIesire)
#            -> @{Cod; Out; Err; Timeout; OprireConfirmata; Ramase} }
# $Log: { param([string]$Mesaj) }  (mesajele trec oricum prin ConvertTo-TextSigur inainte)
# Config: DialogDir, TokenFile, WorkDir, SqlDir, PromptFile, CaleCursor, CaleMarcaj, RadaciniAtasamente, Model, Effort,
#         MaxTurns, TimeoutMin, [IdRulare]
function Invoke-DialogTgz {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][scriptblock]$Psql,
        [Parameter(Mandatory)][scriptblock]$Claude, [Parameter(Mandatory)][scriptblock]$Log, [datetime]$Acum = (Get-Date))
  function Rez([string]$Stare, [string]$Linie, [int]$Cod) { return @{ Stare = $Stare; Linie = (ConvertTo-TextSigur $Linie 400); Cod = $Cod } }
  $L = { param([string]$m) & $Log (ConvertTo-TextSigur $m 25000 -PastreazaLiniiNoi) }
  try {
    # (0) o rulare anterioara cu oprire neconfirmata blocheaza pana dispar procesele ei
    $mc = Test-MarcajProcese $Config.CaleMarcaj
    if ($mc.Exista) {
      if ($mc.Vii.Count -gt 0) { return (Rez 'EROARE' ('EROARE procese din rularea anterioara inca active (pid ' + ($mc.Vii -join ', ') + '); nu pornesc') 1) }
      Remove-Item -LiteralPath $Config.CaleMarcaj -Force
      & $L 'marcaj de oprire neconfirmata gasit; procesele au disparut, marcajul s-a sters'
    }

    # (1) token
    $tok = Read-TokenFisier $Config.TokenFile
    if (-not $tok.Ok) { return (Rez 'EROARE' ('EROARE ' + $tok.Motiv) 1) }
    & $L 'token: prezent, format sk-ant-oat01- corect (valoarea nu se scrie in log)'

    $folder = Get-Item -LiteralPath $Config.DialogDir -ErrorAction SilentlyContinue
    if ($null -eq $folder -or -not $folder.PSIsContainer -or (Test-EsteReparse $folder)) {
      return (Rez 'EROARE' ('EROARE folderul de dialog lipseste sau e legatura: ' + $Config.DialogDir) 1)
    }

    # (2) cursorul local
    $ultimul = Read-Cursor $Config.CaleCursor
    & $L ('cursor: ultimul procesat juridic#{0:000}' -f $ultimul)

    # (3) fisiere noi (+ amprenta lor, ca raspunsul sa corespunda exact continutului citit)
    $noi = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul
    if ($noi.Count -eq 0) {
      & $L 'niciun juridic#NNN nou cu antet (verificare programata); Claude nu porneste'
      return (Rez 'NIMIC NOU' ('NIMIC NOU (ultimul procesat juridic#{0:000})' -f $ultimul) 0)
    }
    $amprente = @{}
    foreach ($f in $noi) { $amprente[$f.Nume] = Get-Sha256Fisier $f.Cale }
    $numere = @($noi | ForEach-Object { [int]$_.Numar })
    $maxJuridic = ($numere | Measure-Object -Maximum).Maximum
    & $L ('fisiere noi: ' + (($noi | ForEach-Object { $_.Nume }) -join ', '))

    # (4) folderul privat al rularii: intrare (context) + iesire (singurul loc unde agentul poate scrie)
    $id = if ($Config.ContainsKey('IdRulare') -and $Config.IdRulare) { [string]$Config.IdRulare } else { [guid]::NewGuid().ToString('N') }
    if ($id -notmatch '^[A-Za-z0-9_\-]{1,64}$') { throw 'IdRulare invalid' }
    $dirRulare = Join-Path (Join-Path $Config.WorkDir 'rulari') $id
    if (Test-Path -LiteralPath $dirRulare) { return (Rez 'EROARE' ('EROARE folderul rularii exista deja: ' + $dirRulare) 1) }
    $dirIntrare = Join-Path $dirRulare 'intrare'
    $dirIesire = Join-Path $dirRulare 'iesire'
    [void](New-Item -ItemType Directory -Path $dirIntrare -Force)
    [void](New-Item -ItemType Directory -Path $dirIesire)
    $caleAgent = Join-Path $dirIesire $script:NumeRaspunsAgent

    # (5) context agregat (psql, doar citire; SQL-ul refuza un rol care poate scrie)
    $caleContext = Join-Path $dirIntrare 'context.md'
    $r = & $Psql (Join-Path $Config.SqlDir 'context_agregat.sql')
    if ($r.Cod -ne 0) { return (Rez 'EROARE' ('EROARE psql export context (cod ' + $r.Cod + '): ' + $r.Err) 1) }
    $antet = "# Context Redari TGZ - cifre agregate`n`nGenerat: " + $Acum.ToString('yyyy-MM-dd HH:mm') +
             " (doar SELECT, fara nume / telefoane / adrese / CNP).`n`n"
    Write-TextUtf8 $caleContext ($antet + (($r.Linii) -join "`n") + "`n")
    & $L ('context agregat scris: ' + $caleContext)

    # (6) agentul
    $radacini = @($Config.RadaciniAtasamente | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) })
    & $L ('radacini atasamente accesibile: ' + $(if ($radacini.Count) { $radacini -join '; ' } else { '(niciuna)' }))
    $sablon = Read-TextUtf8 $Config.PromptFile
    $prompt = Format-Prompt $sablon @{
      FISIERE_JURIDIC = (($noi | ForEach-Object { '- ' + $_.Cale }) -join "`n")
      CALE_RASPUNS = $caleAgent
      CALE_CONTEXT = $caleContext
      FOLDER_DIALOG = $Config.DialogDir
      RADACINI_ATASAMENTE = $(if ($radacini.Count) { ($radacini | ForEach-Object { '- ' + $_ }) -join "`n" } else { '- (niciuna accesibila pe acest calculator)' })
      DATA = $Acum.ToString('yyyy-MM-ddTHH:mm:sszzz')
      ULTIMUL_PROCESAT = ('{0:000}' -f $ultimul)
    }
    $inainte = Get-InstantaneuDialog $Config.DialogDir
    & $L ('pornesc claude -p: model {0}, effort {1}, max-turns {2}, iesire {3}' -f $Config.Model, $Config.Effort, $Config.MaxTurns, $dirIesire)
    $rc = & $Claude $prompt $tok.Token $radacini $dirIntrare $dirIesire
    $tok = $null
    $oprireOk = ($rc.ContainsKey('OprireConfirmata') -and $rc.OprireConfirmata -is [bool] -and $rc.OprireConfirmata)
    & $L ('claude: cod iesire {0}{1}' -f $rc.Cod, $(if ($rc.Timeout) { ' (TIMEOUT, arbore oprit; confirmat: ' + $oprireOk + ')' } else { '' }))
    if ($rc.Err) { & $L ('claude stderr:' + "`n" + (ConvertTo-TextSigur $rc.Err 5000 -PastreazaLiniiNoi)) }

    # (7) esecurile procesului: nimic nu se publica, cursorul nu avanseaza
    if (-not $oprireOk) {
      $ramase = @($rc.Ramase | Where-Object { $_ })
      if ($ramase.Count -eq 0) { throw 'oprire neconfirmata fara lista de procese' }
      Write-MarcajProcese $Config.CaleMarcaj $ramase
      return (Rez 'EROARE' ('EROARE oprirea procesului claude nu s-a putut confirma ({0} procese ramase); marcaj scris, rularile urmatoare asteapta' -f $ramase.Count) 1)
    }
    if ($rc.Timeout) { return (Rez 'EROARE' ('EROARE claude a depasit {0} min (oprit); nimic publicat' -f $Config.TimeoutMin) 1) }
    if ($rc.Cod -ne 0) { return (Rez 'EROARE' ('EROARE claude a iesit cu codul {0}; nimic publicat' -f $rc.Cod) 1) }
    $ij = ConvertFrom-IesireClaude $rc.Out
    & $L ('claude rezultat: ' + $ij.Motiv)
    if (-not $ij.Ok) { return (Rez 'EROARE' ('EROARE claude: ' + $ij.Motiv + '; nimic publicat') 1) }

    # (8) iesirea agentului: exact raspuns.md, fisier obisnuit, nimic altceva
    $elemente = @(Get-ChildItem -LiteralPath $dirIesire -Force -Recurse -ErrorAction Stop)
    $straine = @($elemente | Where-Object { $_.FullName -ne $caleAgent -or $_.PSIsContainer -or (Test-EsteReparse $_) })
    if ($straine.Count -gt 0) {
      return (Rez 'EROARE' ('EROARE in folderul de iesire sunt si alte elemente: ' + (($straine | ForEach-Object { $_.Name }) -join ', ')) 1)
    }
    if (-not (Test-Path -LiteralPath $caleAgent -PathType Leaf)) { return (Rez 'EROARE' 'EROARE agentul nu a scris raspuns.md' 1) }

    # (9) dialogul: nimic atins, intrarile neschimbate, nicio intrebare noua sarita
    $probleme = Compare-InstantaneuDialog -Inainte $inainte -Dupa (Get-InstantaneuDialog $Config.DialogDir)
    if ($probleme.Count -gt 0) {
      & $L ('dialog atins in timpul rularii: ' + ($probleme -join '; '))
      return (Rez 'EROARE' ('EROARE folderul de dialog s-a schimbat in timpul rularii: {0}; nimic publicat' -f ($probleme -join '; ')) 1)
    }
    foreach ($f in $noi) {
      if (-not (Test-Path -LiteralPath $f.Cale -PathType Leaf) -or (Get-Sha256Fisier $f.Cale) -ne $amprente[$f.Nume]) {
        return (Rez 'EROARE' ('EROARE {0} s-a schimbat in timpul rularii; nimic publicat' -f $f.Nume) 1)
      }
    }
    $dupa = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul   # in variabila: ,@() nu se enumera in pipe
    $tarzii = @($dupa | Where-Object { $numere -notcontains [int]$_.Numar -and $_.Numar -lt $maxJuridic })
    if ($tarzii.Count -gt 0) {
      return (Rez 'EROARE' ('EROARE au aparut in timpul rularii mesaje cu numar mai mic decat cel procesat ({0}); reiau la rularea urmatoare' -f (($tarzii | ForEach-Object { $_.Nume }) -join ', ')) 1)
    }

    # (10) raspunsul: stare, corp, date personale
    $ra = Read-RaspunsAgent $caleAgent
    & $L ('ultima linie a agentului: ' + $ra.Linie)
    if ($ra.Stare -eq 'EROARE') { return (Rez 'EROARE' ($ra.Linie + ' (nepublicat)') 1) }
    $motiv = if ($ra.Stare -eq 'OPRIT') { $ra.Linie.Substring(5).Trim() } else { '' }
    $dataRaspuns = $Acum.ToString('yyyy-MM-ddTHH:mm:sszzz')
    # fara GetNewClosure: blocul ramane legat de modul (vede functiile lui) si e apelat doar in timpul acestei functii
    $construieste = { param([int]$Nnn) Format-RaspunsPublicat -Corp $ra.Corp -Juridic $numere -Nnn $Nnn -Data $dataRaspuns -Stare $ra.Stare -Motiv $motiv }
    $dp = @(Find-DatePersonale (& $construieste 999))
    if ($dp.Count -gt 0) {
      return (Rez 'EROARE' ('EROARE raspuns nepublicat: date personale detectate (' + ($dp -join ', ') + '); de verificat de chat') 1)
    }

    # (11) publicare exclusiva, numarul ales acum
    $pub = Publish-RaspunsExclusiv -Folder $Config.DialogDir -Text $construieste
    & $L ('publicat ' + $pub.Nume + ' (raspuns la ' + (($numere | ForEach-Object { 'juridic#{0:000}' -f $_ }) -join ', ') + ')')
    if ($pub.JuridicAcelasiNumar) { & $L ('atentie: juridic#{0:000} a aparut simultan cu acelasi numar; asocierea e data de antetul "Raspuns la:"' -f $pub.Numar) }
    Remove-Item -LiteralPath $dirRulare -Recurse -Force -ErrorAction SilentlyContinue

    if ($ra.Stare -eq 'OPRIT') {
      & $L 'OPRIT: cursorul nu se muta (aceleasi mesaje se reiau pana decide chat-ul / Razvan)'
      return (Rez 'OPRIT' ((('OPRIT ' + $motiv).TrimEnd()) + ' (' + $pub.Nume + ')') 0)
    }

    # (12) cursorul local, cu CAS pe valoarea citita la (2)
    $cand = $Acum.ToString('yyyy-MM-dd HH:mm')
    try { $rand = Write-Cursor -Cale $Config.CaleCursor -Vechi $ultimul -NrJuridic $maxJuridic -NrClaude $pub.Numar -Cand $cand }
    catch { return (Rez 'EROARE' ('EROARE {0} publicat, dar cursorul nu s-a mutat: {1}' -f $pub.Nume, $_.Exception.Message) 1) }
    & $L ('cursor: ' + $rand)
    return (Rez 'GATA' ('GATA claude#{0:000}' -f $pub.Numar) 0)
  } catch {
    return (Rez 'EROARE' ('EROARE ' + $_.Exception.Message) 1)
  }
}

Export-ModuleMember -Function *
