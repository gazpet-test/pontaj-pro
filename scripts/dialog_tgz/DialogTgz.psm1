# DialogTgz.psm1 - logica sarcinii "Gazpet Dialog TGZ" (varianta B: token `claude setup-token`, fara conectori).
# Fisier ASCII (PowerShell 5.1 citeste .psm1 fara BOM ca ANSI). Textele cu diacritice stau in raspuns_schema.json (UTF-8)
# sau se construiesc cu [char]. Functiile pure sunt testate offline in teste\test_dialog_tgz.ps1; Invoke-DialogTgz primeste
# psql / claude / log ca scriptblock-uri, ca fluxul complet sa poata fi rulat in test fara retea.
#
# r2 (Jakarinos r1): ERP doar-citire, cursor local, agentul scrie doar in folderul privat al rularii, publicarea e a
#   orchestratorului, timeout / cod nenul / JSON fara succes = EROARE.
# r3 (Jakarinos r2, ultima runda):
# - Date personale: agentul NU mai scrie text publicabil. Scrie raspuns.json cu campuri fixe (raspuns_schema.json):
#   enumerari inchise, coduri care trebuie sa existe in exportul ERP, numere marginite, FARA text liber (r4: campul
#   "nota" scos complet). claude#NNN.md il COMPUNE orchestratorul din JSON-ul validat; valorile ERP le ia din export.
#   Orice camp in plus / tip gresit / valoare in afara listelor = nepublicat. stderr-ul agentului: doar lungimea in log.
# - Numerotare: creare exclusiva (temporar + File.Move, care esueaza daca destinatia exista), apoi re-verificare (si dupa
#   o fereastra de asteptare): daca exista juridic#NNN cu acelasi NNN, raspunsul se MUTA atomic (redenumire exclusiva)
#   pe urmatorul numar liber. Continutul nu depinde de numar (ultima linie "GATA"; asocierea = antetul "Raspuns la:").
#   Coliziune nerezolvata = EROARE, cursorul nu avanseaza.
# - Procese: psql si claude ruleaza intr-un Job Object (KILL_ON_JOB_CLOSE), pornite SUSPENDATE si puse in job inainte
#   sa execute ceva; la final TerminateJobObject + confirmare ActiveProcesses = 0. Neconfirmat = EROARE + marcaj care
#   blocheaza rularile urmatoare (inclusiv "necunoscut" cand lista nu se poate citi).
# - Publicare vs. cursor: fiecare raspuns publicat poarta "Cheie: <sha256 al intentiei>" (numerele + amprentele exacte
#   ale mesajelor). La pornire, un GATA publicat pentru mesaje inca necursate = doar avans de cursor (fara inferenta
#   noua); un OPRIT publicat pentru exact aceleasi mesaje = nu se reia. Reconcilierea se face cu dialogul, nu cu un
#   marcaj local care poate diverge.
# r4 (Jakarinos r3): fara camp de text liber (nota + vocabular retrase; schema versiunea 2 refuza orice "nota");
#   recuperarea coliziunii de numar ruleaza si pentru un OPRIT deja publicat, inainte de iesirea "deja publicat".

Set-StrictMode -Version 2.0

$script:Utf8FaraBom = New-Object System.Text.UTF8Encoding($false)
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$script:A_breve = [string][char]0x0103   # a cu caciula (din "programata")
$script:TiparNume = '^(juridic|claude)#([0-9]{3})\.md$'
$script:TiparCursor = '^juridic#([0-9]{3})(?: \(raspuns claude#[0-9]{3}, [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\))?$'
$script:MaxRaspunsOcteti = 200 * 1024   # serverul juridic citeste cel mult 200 KB dintr-un claude#NNN.md
$script:NumeRaspunsAgent = 'raspuns.json'
$script:AntetDeLa = 'De la: Claude Code (verificare programat' + $script:A_breve + ' Dialog TGZ)'
$script:TiparTemporar = '^_dialog_tgz_[0-9a-f]{32}\.tmp$'

# ---------------------------------------------------------------- utilitare

function Get-Sha256Octeti {
  param([Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Octeti)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash($Octeti) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
}

function Get-Sha256Fisier {
  param([Parameter(Mandatory)][string]$Cale)
  return (Get-Sha256Octeti ([System.IO.File]::ReadAllBytes($Cale)))
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

# Date personale: ULTIMA bariera (pe textul compus, pe log si pe stare). Bariera principala e contractul JSON.
# Intoarce codurile gasite (sortate, unice; apelantul pune @()); nimic = nimic gasit.
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

# Antetul = liniile de la inceput pana la prima linie goala (cel mult 12).
function Get-AntetText {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  if ($Text.Length -gt 8192) { $Text = $Text.Substring(0, 8192) }
  $antet = @()
  foreach ($l in ($Text -split "\r?\n")) {
    if ($l.Trim() -eq '') { break }
    $antet += $l
    if ($antet.Count -ge 12) { break }
  }
  return ,@($antet)
}

# Marcajul "(verificare programata)", cu sau fara diacritice, oriunde in antet (de regula in Subiect:).
function Test-AntetProgramat {
  param([Parameter(Mandatory)][string]$Cale)
  $antet = Get-AntetText (Read-TextUtf8 $Cale)
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

# Fisierele temporare proprii ramase in dialog dupa o rulare oprita brusc (nume fix: _dialog_tgz_<cheie>.tmp).
# Se sterg doar sub lock-ul global (nicio alta rulare nu publica in acelasi timp).
function Remove-TemporareProprii {
  param([Parameter(Mandatory)][string]$Folder)
  $sterse = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $Folder -File -Force -ErrorAction Stop)) {
    if ($f.Name -cmatch $script:TiparTemporar -and -not (Test-EsteReparse $f)) { Remove-Item -LiteralPath $f.FullName -Force; $sterse += $f.Name }
  }
  return ,@($sterse)
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

# ---------------------------------------------------------------- contractul raspunsului (schema, export)

# r4: raspunsul NU mai are niciun camp de text liber (campul "nota" a fost scos). O schema care il readuce (limite,
# texte sau orice cheie cu "nota") e refuzata aici, inainte de BD si de Claude: nu exista cale de activare din configurare.
function Read-SchemaRaspuns {
  param([Parameter(Mandatory)][string]$Cale)
  $text = Read-TextUtf8 $Cale
  $s = $text | ConvertFrom-Json
  if ($s.versiune -ne 2) { throw 'raspuns_schema.json: versiune necunoscuta (astept 2, fara text liber)' }
  if ($text -match '(?i)nota|vocabular') { throw 'raspuns_schema.json: campul de text liber (nota) e retras si nu se poate reactiva' }
  return $s
}

function Get-NumeProprietati {
  param([Parameter(Mandatory)]$Obiect)
  return ,@($Obiect.PSObject.Properties | ForEach-Object { $_.Name })
}

# Exportul psql (format nealiniat): "## N. titlu", linie ```, antet a|b|c, randuri, linie ```.
# Intoarce hashtable N -> @{Coloane; Randuri (hashtable coloana -> text)}. Orice abatere = exceptie (nimic tacit).
function ConvertFrom-ExportContext {
  param([Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Linii)
  $sect = @{}
  $i = 0; $n = $Linii.Count
  while ($i -lt $n) {
    $m = [regex]::Match($Linii[$i], '^## ([0-9]{1,2})\. ')
    if (-not $m.Success) { $i++; continue }
    $nr = [int]$m.Groups[1].Value
    if ($sect.ContainsKey($nr)) { throw ('export: sectiunea {0} apare de doua ori' -f $nr) }
    if ($i + 2 -ge $n -or $Linii[$i + 1] -cne '```') { throw ('export: sectiunea {0} fara tabel' -f $nr) }
    $col = @($Linii[$i + 2] -split '\|')
    foreach ($c in $col) { if ($c -cnotmatch '^[a-z_][a-z0-9_]*$') { throw ('export: sectiunea {0}, antet invalid' -f $nr) } }
    if (@($col | Sort-Object -Unique).Count -ne $col.Count) { throw ('export: sectiunea {0}, coloane duble' -f $nr) }
    $randuri = New-Object System.Collections.ArrayList
    $j = $i + 3
    while ($j -lt $n -and $Linii[$j] -cne '```') {
      $cel = @($Linii[$j] -split '\|')
      if ($cel.Count -ne $col.Count) { throw ('export: sectiunea {0}, rand cu {1} coloane in loc de {2}' -f $nr, $cel.Count, $col.Count) }
      $h = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
      for ($k = 0; $k -lt $col.Count; $k++) { $h[$col[$k]] = $cel[$k] }
      [void]$randuri.Add($h)
      $j++
    }
    if ($j -ge $n) { throw ('export: sectiunea {0} neinchisa' -f $nr) }
    $sect[$nr] = @{ Coloane = $col; Randuri = $randuri.ToArray() }
    $i = $j + 1
  }
  return $sect
}

# Paritate schema <-> export: fiecare sectiune din schema exista, cu toate cheile si indicatorii ca si coloane.
function Test-ExportFataDeSchema {
  param([Parameter(Mandatory)][hashtable]$Export, [Parameter(Mandatory)]$Schema)
  foreach ($cod in (Get-NumeProprietati $Schema.sectiuni)) {
    $s = $Schema.sectiuni.$cod
    if (-not $Export.ContainsKey([int]$s.export)) { throw ('export: lipseste sectiunea {0} ({1})' -f $s.export, $cod) }
    $col = $Export[[int]$s.export].Coloane
    foreach ($c in @($s.chei) + @($s.indicatori)) { if ($col -cnotcontains $c) { throw ('export: sectiunea {0} nu are coloana {1}' -f $s.export, $c) } }
  }
}

function Get-TipJson {
  param([AllowNull()]$Valoare)
  if ($null -eq $Valoare) { return 'null' }
  if ($Valoare -is [bool]) { return 'bool' }
  if ($Valoare -is [int] -or $Valoare -is [long]) { return 'int' }
  if ($Valoare -is [decimal] -or $Valoare -is [double]) { return 'num' }
  if ($Valoare -is [string]) { return 'str' }
  if ($Valoare -is [array]) { return 'arr' }
  if ($Valoare -is [System.Management.Automation.PSCustomObject]) { return 'obj' }
  return 'alt'
}

# Mesajele de respingere NU contin niciodata text din raspunsul agentului (doar cai de campuri si coduri din schema).
function Stop-Raspuns { param([string]$Motiv) throw ('RASPUNS: ' + $Motiv) }

function Test-CampuriJson {
  param($Obiect, [string]$Unde, [string[]]$Obligatorii, [string[]]$Optionale = @())
  if ((Get-TipJson $Obiect) -ne 'obj') { Stop-Raspuns ($Unde + ' nu este obiect') }
  $nume = Get-NumeProprietati $Obiect
  $permise = @($Obligatorii) + @($Optionale)
  $plus = @($nume | Where-Object { $permise -cnotcontains $_ })
  if ($plus.Count -gt 0) { Stop-Raspuns ('{0} are {1} campuri in afara contractului' -f $Unde, $plus.Count) }
  foreach ($o in $Obligatorii) { if ($nume -cnotcontains $o) { Stop-Raspuns ($Unde + ' fara campul obligatoriu ' + $o) } }
}

function Get-CampJson {
  param($Obiect, [string]$Nume)
  $p = $Obiect.PSObject.Properties | Where-Object { $_.Name -ceq $Nume } | Select-Object -First 1
  if ($null -eq $p) { return $null }
  if ($p.Value -is [array]) { return ,$p.Value }   # lista ramane lista (si [] / [x]); apelantul NU pune @()
  return $p.Value
}

function Test-IntJson {
  param($Valoare, [string]$Unde, [long]$Min, [long]$Max)
  if ((Get-TipJson $Valoare) -ne 'int') { Stop-Raspuns ($Unde + ' trebuie sa fie intreg') }
  if ($Valoare -lt $Min -or $Valoare -gt $Max) { Stop-Raspuns ('{0} in afara intervalului {1}..{2}' -f $Unde, $Min, $Max) }
  return [int]$Valoare
}

function Test-CodJson {
  param($Valoare, [string]$Unde, [string[]]$Permise)
  if ((Get-TipJson $Valoare) -ne 'str' -or $Permise -cnotcontains $Valoare) { Stop-Raspuns ($Unde + ' nu este un cod din lista permisa') }
  return [string]$Valoare
}

function Format-NumarInvariant {
  param([decimal]$Valoare)
  return $Valoare.ToString('0.##', [System.Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-DecimalExport {
  param([string]$Text)
  $d = [decimal]0
  $stil = [System.Globalization.NumberStyles]::AllowDecimalPoint -bor [System.Globalization.NumberStyles]::AllowLeadingSign
  if ($Text -match '^-?[0-9]+(\.[0-9]+)?$' -and [decimal]::TryParse($Text, $stil, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { return $d }
  return $null
}

# O comparatie: filtrul alege EXACT un rand din tabelul exportului; valoarea ERP se ia din export (nu de la agent).
function Test-VerificareJson {
  param($V, [string]$Unde, $Schema, [hashtable]$Export)
  Test-CampuriJson $V $Unde @('sectiune', 'filtru', 'indicator') @('valoare_juridic')
  $codSect = Test-CodJson (Get-CampJson $V 'sectiune') ($Unde + '.sectiune') (Get-NumeProprietati $Schema.sectiuni)
  $s = $Schema.sectiuni.$codSect
  $tabel = $Export[[int]$s.export]
  $filtru = Get-CampJson $V 'filtru'
  if ((Get-TipJson $filtru) -ne 'obj') { Stop-Raspuns ($Unde + '.filtru nu este obiect') }
  $chei = Get-NumeProprietati $filtru
  if (@($chei | Where-Object { @($s.chei) -cnotcontains $_ }).Count -gt 0) { Stop-Raspuns ($Unde + '.filtru are chei in afara sectiunii') }
  if ($chei -cnotcontains 'proiect') { Stop-Raspuns ($Unde + '.filtru fara proiect') }
  $randuri = @($tabel.Randuri)
  $parti = @()
  foreach ($c in @($s.chei)) {
    if ($chei -cnotcontains $c) { continue }
    $val = Get-CampJson $filtru $c
    if ((Get-TipJson $val) -ne 'str') { Stop-Raspuns ($Unde + '.filtru.' + $c + ' trebuie sa fie text') }
    if (@($tabel.Randuri | Where-Object { $_[$c] -ceq $val }).Count -eq 0) { Stop-Raspuns ($Unde + '.filtru.' + $c + ' nu exista in export') }
    $randuri = @($randuri | Where-Object { $_[$c] -ceq $val })
    $parti += ($c + '=' + $val)
  }
  if ($randuri.Count -ne 1) { Stop-Raspuns ('{0}.filtru alege {1} randuri (trebuie exact 1)' -f $Unde, $randuri.Count) }
  $ind = Test-CodJson (Get-CampJson $V 'indicator') ($Unde + '.indicator') @($s.indicatori)
  $erp = [string]$randuri[0][$ind]
  $vj = Get-CampJson $V 'valoare_juridic'
  $tip = Get-TipJson $vj
  $L = $Schema.limite
  if ($tip -eq 'null') { $txtJ = '-'; $rez = 'doar_erp' }
  elseif ($tip -eq 'int' -or $tip -eq 'num') {
    $d = [decimal]$vj
    if ($d -lt 0 -or $d -gt [decimal]$L.max_valoare) { Stop-Raspuns ($Unde + '.valoare_juridic in afara intervalului permis') }
    if ([decimal]::Round($d, [int]$L.max_zecimale) -ne $d) { Stop-Raspuns ($Unde + '.valoare_juridic are prea multe zecimale') }
    $de = ConvertTo-DecimalExport $erp
    if ($null -eq $de) { Stop-Raspuns ($Unde + '.valoare_juridic numerica pentru un indicator care nu e numeric in export') }
    $txtJ = Format-NumarInvariant $d
    $rez = if ($d -eq $de) { 'potrivire' } else { 'diferenta' }
  }
  elseif ($tip -eq 'str') {
    if (@($tabel.Randuri | Where-Object { $_[$ind] -ceq $vj }).Count -eq 0) { Stop-Raspuns ($Unde + '.valoare_juridic text care nu exista in coloana din export') }
    $txtJ = [string]$vj
    $rez = if ($vj -ceq $erp) { 'potrivire' } else { 'diferenta' }
  }
  else { Stop-Raspuns ($Unde + '.valoare_juridic de tip nepermis') }
  return @{ Cheie = ($codSect + '|' + ($parti -join ',') + '|' + $ind); Titlu = [string]$s.titlu; Filtru = ($parti -join ', ')
            Indicator = $ind; Juridic = $txtJ; Erp = $erp; Rezultat = $rez }
}

# Valideaza raspuns.json fata de schema, export si lista exacta de mesaje procesate.
# Intoarce @{Ok; Motiv; Date}. Date = forma normalizata (singura folosita la compunere). Motivul nu contine text al agentului.
function Test-RaspunsAgent {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)]$Schema, [Parameter(Mandatory)][hashtable]$Export,
        [Parameter(Mandatory)][int[]]$Juridic)
  try {
    $L = $Schema.limite
    $octeti = [System.IO.File]::ReadAllBytes($Cale)
    if ($octeti.Length -gt [int]$L.max_octeti) { Stop-Raspuns ('raspuns.json are {0} octeti, peste {1}' -f $octeti.Length, $L.max_octeti) }
    try { $t = $script:Utf8Strict.GetString($octeti) } catch { Stop-Raspuns 'raspuns.json nu este UTF-8 valid' }
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    if ($t.Trim() -eq '') { Stop-Raspuns 'raspuns.json este gol' }
    try { $j = $t | ConvertFrom-Json } catch { Stop-Raspuns 'raspuns.json nu este JSON valid' }
    if ((Get-TipJson $j) -ne 'obj') { Stop-Raspuns 'raspuns.json nu este un obiect' }
    Test-CampuriJson $j 'raspuns' @('stare', 'mesaje') @('motiv_oprire', 'motiv_eroare')
    $stare = Test-CodJson (Get-CampJson $j 'stare') 'stare' @($Schema.stari)
    $mo = Get-CampJson $j 'motiv_oprire'; $me = Get-CampJson $j 'motiv_eroare'
    if ((Get-TipJson (Get-CampJson $j 'mesaje')) -ne 'arr') { Stop-Raspuns 'mesaje nu este lista' }
    if ($stare -eq 'EROARE') {
      if ($null -ne $mo) { Stop-Raspuns 'motiv_oprire la EROARE' }
      $cod = Test-CodJson $me 'motiv_eroare' (Get-NumeProprietati $Schema.motive_eroare)
      return @{ Ok = $true; Motiv = ''; Date = @{ Stare = 'EROARE'; MotivEroare = $cod; Mesaje = @() } }
    }
    if ($null -ne $me) { Stop-Raspuns 'motiv_eroare in afara starii EROARE' }
    if ($stare -eq 'OPRIT') { $mo = Test-CodJson $mo 'motiv_oprire' (Get-NumeProprietati $Schema.motive_oprire) }
    elseif ($null -ne $mo) { Stop-Raspuns 'motiv_oprire la GATA' }

    $mesaje = Get-CampJson $j 'mesaje'
    if ($mesaje.Count -ne $Juridic.Count) { Stop-Raspuns ('mesaje are {0} elemente, astept {1} (cate unul pe fiecare juridic# procesat)' -f $mesaje.Count, $Juridic.Count) }
    $vazute = @{}; $iesire = @()
    for ($i = 0; $i -lt $mesaje.Count; $i++) {
      $u = 'mesaje[' + $i + ']'
      $m = $mesaje[$i]
      # fara campuri optionale: un "nota" (sau orice text liber) = camp in afara contractului = nepublicat
      Test-CampuriJson $m $u @('juridic', 'cerere', 'verificari', 'neverificabile', 'atasamente', 'de_decis')
      $nr = Test-IntJson (Get-CampJson $m 'juridic') ($u + '.juridic') 1 999
      if ($Juridic -notcontains $nr) { Stop-Raspuns ($u + '.juridic nu este unul dintre mesajele procesate') }
      if ($vazute.ContainsKey($nr)) { Stop-Raspuns ($u + '.juridic repetat') }
      $vazute[$nr] = $true
      $cerere = Test-CodJson (Get-CampJson $m 'cerere') ($u + '.cerere') (Get-NumeProprietati $Schema.cereri)
      $vs = Get-CampJson $m 'verificari'
      if ((Get-TipJson $vs) -ne 'arr') { Stop-Raspuns ($u + '.verificari nu este lista') }
      $vs = @($vs)
      if ($vs.Count -gt [int]$L.max_verificari_pe_mesaj) { Stop-Raspuns ($u + '.verificari peste limita') }
      $ver = @(); $chei = @{}
      for ($k = 0; $k -lt $vs.Count; $k++) {
        $x = Test-VerificareJson $vs[$k] ($u + '.verificari[' + $k + ']') $Schema $Export
        if ($chei.ContainsKey($x.Cheie)) { Stop-Raspuns ($u + '.verificari[' + $k + '] repeta o comparatie') }
        $chei[$x.Cheie] = $true
        $ver += $x
      }
      $nev = Test-IntJson (Get-CampJson $m 'neverificabile') ($u + '.neverificabile') 0 ([int]$L.max_neverificabile)
      $at = Get-CampJson $m 'atasamente'
      Test-CampuriJson $at ($u + '.atasamente') @('citite', 'negasite_local', 'in_afara_radacinilor')
      $atv = @(foreach ($c in 'citite', 'negasite_local', 'in_afara_radacinilor') { Test-IntJson (Get-CampJson $at $c) ($u + '.atasamente.' + $c) 0 ([int]$L.max_atasamente) })
      $dd = Get-CampJson $m 'de_decis'
      if ((Get-TipJson $dd) -ne 'arr') { Stop-Raspuns ($u + '.de_decis nu este lista') }
      $dd = @($dd)
      if ($dd.Count -gt [int]$L.max_de_decis_pe_mesaj) { Stop-Raspuns ($u + '.de_decis peste limita') }
      $ddv = @()
      for ($k = 0; $k -lt $dd.Count; $k++) {
        $c = Test-CodJson $dd[$k] ($u + '.de_decis[' + $k + ']') (Get-NumeProprietati $Schema.de_decis)
        if ($ddv -ccontains $c) { Stop-Raspuns ($u + '.de_decis repetat') }
        $ddv += $c
      }
      $iesire += @{ Juridic = $nr; Cerere = $cerere; Verificari = $ver; Neverificabile = $nev; Atasamente = $atv; DeDecis = $ddv }
    }
    $sortate = @($iesire | Sort-Object { $_.Juridic })
    return @{ Ok = $true; Motiv = ''; Date = @{ Stare = $stare; MotivOprire = $mo; Mesaje = $sortate } }
  } catch {
    $msg = $_.Exception.Message
    if ($msg.StartsWith('RASPUNS: ')) { return @{ Ok = $false; Motiv = $msg.Substring(9); Date = $null } }
    return @{ Ok = $false; Motiv = 'validare raspuns: eroare interna'; Date = $null }
  }
}

# Cheia intentiei: numerele + amprentele EXACTE ale mesajelor la care se raspunde. Aceeasi cheie = acelasi raspuns.
function Get-CheieIntentie {
  param([Parameter(Mandatory)][int[]]$Numere, [Parameter(Mandatory)][hashtable]$Amprente)
  $parti = foreach ($n in ($Numere | Sort-Object)) {
    if (-not $Amprente.ContainsKey([int]$n)) { throw ('cheie: lipseste amprenta pentru juridic#{0:000}' -f $n) }
    'juridic#{0:000}:{1}' -f $n, $Amprente[[int]$n]
  }
  $text = "dialog_tgz/r3`n" + ($parti -join "`n")
  return (Get-Sha256Octeti ($script:Utf8FaraBom.GetBytes($text))).Substring(0, 32)
}

# claude#NNN.md compus de program din datele validate. Continutul NU depinde de NNN (se poate muta la coliziune).
function Format-RaspunsPublicat {
  param([Parameter(Mandatory)][hashtable]$Date, [Parameter(Mandatory)]$Schema, [Parameter(Mandatory)][string]$Cheie, [Parameter(Mandatory)][string]$Data)
  if ($Date.Stare -ne 'GATA' -and $Date.Stare -ne 'OPRIT') { throw 'stare nepublicabila' }
  if ($Cheie -cnotmatch '^[0-9a-f]{32}$') { throw 'cheie invalida' }
  $tx = $Schema.texte
  $lista = (@($Date.Mesaje) | ForEach-Object { 'juridic#{0:000}' -f $_.Juridic }) -join ', '
  $L = New-Object System.Collections.Generic.List[string]
  $L.Add($script:AntetDeLa); $L.Add('Data: ' + $Data)
  $L.Add('Subiect: R' + $script:A_breve + 'spuns la ' + $lista); $L.Add('Raspuns la: ' + $lista); $L.Add('Cheie: ' + $Cheie); $L.Add('')
  foreach ($m in @($Date.Mesaje)) {
    $L.Add(('## juridic#{0:000}: {1}' -f $m.Juridic, $Schema.cereri.($m.Cerere))); $L.Add('')
    $L.Add($tx.verificare + ':')
    if (@($m.Verificari).Count -eq 0) { $L.Add($tx.fara_verificari) }
    else {
      $L.Add(''); $L.Add($tx.cap_tabel); $L.Add('|---|---|---|---|---|---|')
      foreach ($v in @($m.Verificari)) { $L.Add(('| {0} | {1} | {2} | {3} | {4} | {5} |' -f $v.Titlu, $v.Filtru, $v.Indicator, $v.Juridic, $v.Erp, $tx.($v.Rezultat))) }
    }
    $L.Add('')
    if ($m.Neverificabile -gt 0) { $L.Add(('{0}: {1}' -f $tx.neverificabile, $m.Neverificabile)) }
    $L.Add(($tx.atasamente -f $m.Atasamente[0], $m.Atasamente[1], $m.Atasamente[2])); $L.Add('')
    $L.Add($tx.de_decis + ':')
    if (@($m.DeDecis).Count -eq 0) { $L.Add('- ' + $tx.nimic) } else { foreach ($d in @($m.DeDecis)) { $L.Add('- ' + $Schema.de_decis.$d) } }
    $L.Add('')
  }
  $L.Add($(if ($Date.Stare -eq 'GATA') { 'GATA' } else { 'OPRIT ' + $Schema.motive_oprire.($Date.MotivOprire) }))
  return (($L -join "`n") + "`n")
}

# Raspunsurile publicate de aceasta sarcina (antetul programului + "Raspuns la:" + "Cheie:" + ultima linie GATA / OPRIT).
# Alte claude#NNN.md (scrise de sesiunea chat) se ignora.
function Get-RaspunsuriProprii {
  param([Parameter(Mandatory)][string]$Folder)
  $rez = @()
  foreach ($f in (Get-FisiereDialog $Folder)) {
    if ($f.Tip -ne 'claude') { continue }
    if ((Get-Item -LiteralPath $f.Cale).Length -gt $script:MaxRaspunsOcteti) { continue }
    $t = Read-TextUtf8 $f.Cale
    $antet = Get-AntetText $t
    if ($antet.Count -lt 5 -or $antet[0] -cne $script:AntetDeLa) { continue }
    $rl = @($antet | Where-Object { $_ -cmatch '^Raspuns la: juridic#[0-9]{3}(?:, juridic#[0-9]{3})*$' })
    $ch = @($antet | Where-Object { $_ -cmatch '^Cheie: [0-9a-f]{32}$' })
    if ($rl.Count -ne 1 -or $ch.Count -ne 1) { continue }
    $nr = @([regex]::Matches($rl[0], 'juridic#([0-9]{3})') | ForEach-Object { [int]$_.Groups[1].Value })
    $linii = @($t -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
    $ult = $linii[$linii.Count - 1].Trim()
    $stare = if ($ult -ceq 'GATA') { 'GATA' } elseif ($ult -cmatch '^OPRIT( |$)') { 'OPRIT' } else { $null }
    if (-not $stare) { continue }
    $rez += [pscustomobject]@{ Numar = $f.Numar; Nume = $f.Nume; Cale = $f.Cale; Cheie = $ch[0].Substring(7); Juridic = [int[]]$nr; Stare = $stare }
  }
  return ,@($rez)
}

# Publicare exclusiva: textul complet intr-un temporar din acelasi folder, apoi File.Move pe urmatorul numar liber
# (atomic pe acelasi volum; ESUEAZA daca destinatia exista: nu suprascrie niciodata). Ocupat intre timp = alt numar.
# $InainteDeMutare: doar pentru teste (simuleaza un scriitor concurent). Intoarce @{Numar; Nume; Cale}.
function Publish-RaspunsExclusiv {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][string]$Cheie,
        [int]$Incercari = 5, [scriptblock]$InainteDeMutare)
  if ($Cheie -cnotmatch '^[0-9a-f]{32}$') { throw 'cheie invalida' }
  $tmp = Join-Path $Folder ('_dialog_tgz_' + $Cheie + '.tmp')
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  try {
    $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $b = $script:Utf8FaraBom.GetBytes($Text); $fs.Write($b, 0, $b.Length); $fs.Flush($true) } finally { $fs.Dispose() }
    for ($i = 0; $i -lt $Incercari; $i++) {
      $n = Get-UrmatorulNumar $Folder
      $nume = 'claude#{0:000}.md' -f $n
      $final = Join-Path $Folder $nume
      if ($InainteDeMutare) { & $InainteDeMutare $n }
      try { [System.IO.File]::Move($tmp, $final); return @{ Numar = $n; Nume = $nume; Cale = $final } }
      catch { if (-not (Test-Path -LiteralPath $final)) { throw } }
    }
    throw ('nu am gasit un numar claude#NNN liber dupa {0} incercari' -f $Incercari)
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }
}

# Re-verificarea dupa publicare: daca exista juridic#NNN cu acelasi NNN ca raspunsul nostru, raspunsul se MUTA atomic
# (File.Move exclusiv) pe urmatorul numar liber; se repeta pana nu mai exista coliziune. Peste $Mutari = exceptie
# (coliziune nerezolvata = esec). Intoarce @{Numar; Nume; Cale; Mutari (lista "claude#A -> claude#B")}.
function Resolve-ColiziuneNumar {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][int]$Numar, [int]$Mutari = 5, [scriptblock]$InainteDeMutare)
  $cale = Join-Path $Folder ('claude#{0:000}.md' -f $Numar)
  if (-not (Test-Path -LiteralPath $cale -PathType Leaf)) { throw ('raspunsul claude#{0:000} nu mai exista' -f $Numar) }
  $istoric = @()
  for ($i = 0; ; $i++) {
    if (-not (Test-Path -LiteralPath (Join-Path $Folder ('juridic#{0:000}.md' -f $Numar)))) {
      return @{ Numar = $Numar; Nume = ('claude#{0:000}.md' -f $Numar); Cale = $cale; Mutari = $istoric }
    }
    if ($i -ge $Mutari) { throw ('coliziune nerezolvata: juridic#{0:000} si claude#{0:000} dupa {1} incercari de mutare' -f $Numar, $Mutari) }
    $n = Get-UrmatorulNumar $Folder
    $dest = Join-Path $Folder ('claude#{0:000}.md' -f $n)
    if ($InainteDeMutare) { & $InainteDeMutare $n }
    $mutat = $false
    try { [System.IO.File]::Move($cale, $dest); $mutat = $true }
    catch { if (-not (Test-Path -LiteralPath $dest)) { throw ('mutarea claude#{0:000} -> claude#{1:000} a esuat: {2}' -f $Numar, $n, $_.Exception.Message) } }
    if ($mutat) { $istoric += ('claude#{0:000} -> claude#{1:000}' -f $Numar, $n); $cale = $dest; $Numar = $n }
  }
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

# Partile promptului generate din schema (o singura definitie a listelor, L19).
function Get-ValoriPromptSchema {
  param([Parameter(Mandatory)]$Schema)
  $coduri = foreach ($lista in 'motive_oprire', 'motive_eroare', 'cereri', 'de_decis') {
    $p = foreach ($k in (Get-NumeProprietati $Schema.$lista)) { '`' + $k + '` (' + $Schema.$lista.$k + ')' }
    '- `' + $lista + '`: ' + (@($p) -join '; ')
  }
  $sect = foreach ($c in (Get-NumeProprietati $Schema.sectiuni)) {
    $s = $Schema.sectiuni.$c
    '- `{0}` = tabelul "## {1}." din context; chei de filtru: {2}; indicatori: {3}' -f $c, $s.export,
      ((@($s.chei) | ForEach-Object { '`' + $_ + '`' }) -join ', '), ((@($s.indicatori) | ForEach-Object { '`' + $_ + '`' }) -join ', ')
  }
  return @{
    CODURI = ($coduri -join "`n")
    SECTIUNI = ($sect -join "`n")
  }
}

# Forma POSIX ceruta de regulile de permisiuni Claude Code pe Windows: C:\a\b -> //c/a/b
function ConvertTo-CaleRegula {
  param([Parameter(Mandatory)][string]$Cale)
  $c = $Cale.TrimEnd('\', '/') -replace '\\', '/'
  if ($c -match '^([A-Za-z]):/(.*)$') { return '//' + $Matches[1].ToLower() + '/' + $Matches[2] }
  throw ('cale fara litera de disc: ' + $Cale)
}

# ---------------------------------------------------------------- procese reale (psql / claude) intr-un Job Object

# Procesul porneste SUSPENDAT, e pus in job (fara BREAKAWAY: copiii nu pot iesi din job), apoi e reluat: nimic nu
# ruleaza in afara jobului. La final (iesire normala sau timeout) TerminateJobObject pe tot jobul, apoi confirmare
# ActiveProcesses = 0. KILL_ON_JOB_CLOSE: daca orchestratorul moare, sistemul inchide handle-ul si opreste tot jobul.
$script:CodJob = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace DialogTgzJob
{
    public sealed class Rezultat
    {
        public int Cod;
        public bool Timeout;
        public string Out = "";
        public string Err = "";
        public bool OprireConfirmata;
        public int[] Ramase = new int[0];
        public int OrfaniLaIesire;
        public string Eroare;
        public int Pid;
    }

    public static class Runner
    {
        const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_NO_WINDOW = 0x08000000;
        const int STARTF_USESTDHANDLES = 0x100;
        const uint KILL_ON_JOB_CLOSE = 0x2000;
        const uint WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 0x102;

        [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong R, W, O, RB, WB, OB; }
        [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
            public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
            public BASIC_LIMIT Basic; public IO_COUNTERS Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
        [StructLayout(LayoutKind.Sequential)] struct BASIC_ACCOUNTING {
            public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
            public int cb; public string lpReserved, lpDesktop, lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
        [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr sa, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED_LIMIT info, int len);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out BASIC_ACCOUNTING info, int len, IntPtr ret);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, StringBuilder cmd,
            IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr p, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr p, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);

        // -1 = nu se poate citi (necunoscut: nu se confirma nimic)
        public static int ActiveProcese(IntPtr job)
        {
            BASIC_ACCOUNTING a;
            if (!QueryInformationJobObject(job, 1, out a, Marshal.SizeOf(typeof(BASIC_ACCOUNTING)), IntPtr.Zero)) return -1;
            return (int)a.ActiveProcesses;
        }

        // null = lista nu se poate citi
        public static int[] ListaProcese(IntPtr job)
        {
            int max = 4096, size = 8 + max * IntPtr.Size;
            IntPtr buf = Marshal.AllocHGlobal(size);
            try {
                if (!QueryInformationJobObject(job, 3, buf, size, IntPtr.Zero)) return null;
                int n = Marshal.ReadInt32(buf, 4);
                var r = new int[n];
                for (int i = 0; i < n; i++) r[i] = (int)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64();
                return r;
            } finally { Marshal.FreeHGlobal(buf); }
        }

        static IntPtr BlocMediu(IDictionary env)
        {
            var chei = new List<string>();
            foreach (DictionaryEntry e in env) {
                string k = (string)e.Key;
                if (string.IsNullOrEmpty(k) || k.IndexOf('=') >= 0 || k.IndexOf('\0') >= 0) continue;
                chei.Add(k);
            }
            chei.Sort(StringComparer.OrdinalIgnoreCase);
            var sb = new StringBuilder();
            foreach (string k in chei) {
                string v = env[k] == null ? "" : env[k].ToString();
                if (v.IndexOf('\0') >= 0) continue;
                sb.Append(k).Append('=').Append(v).Append('\0');
            }
            sb.Append('\0');
            return Marshal.StringToHGlobalUni(sb.ToString());
        }

        static string Rezultatul(Task<string> t, int ms)
        {
            try { if (t.Wait(ms) && t.Status == TaskStatus.RanToCompletion) return t.Result; } catch (AggregateException) { }
            return "";
        }

        public static Rezultat Run(string exe, string argumente, IDictionary env, string cwd, byte[] stdin, int timeoutMs, int confirmareMs)
        {
            var r = new Rezultat();
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
            try {
                var lim = new EXTENDED_LIMIT();
                lim.Basic.LimitFlags = KILL_ON_JOB_CLOSE;
                if (!SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(typeof(EXTENDED_LIMIT))))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject");
                using (var pOut = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable))
                using (var pErr = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable))
                using (var pIn = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.Inheritable))
                {
                    var si = new STARTUPINFO();
                    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                    si.dwFlags = STARTF_USESTDHANDLES;
                    si.hStdInput = pIn.ClientSafePipeHandle.DangerousGetHandle();
                    si.hStdOutput = pOut.ClientSafePipeHandle.DangerousGetHandle();
                    si.hStdError = pErr.ClientSafePipeHandle.DangerousGetHandle();
                    var cmd = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(argumente) ? "" : " " + argumente));
                    IntPtr bloc = BlocMediu(env);
                    PROCESS_INFORMATION pi;
                    bool ok; int eroare;
                    try {
                        ok = CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                                            bloc, string.IsNullOrEmpty(cwd) ? null : cwd, ref si, out pi);
                        eroare = Marshal.GetLastWin32Error();
                    } finally { Marshal.FreeHGlobal(bloc); }
                    pOut.DisposeLocalCopyOfClientHandle(); pErr.DisposeLocalCopyOfClientHandle(); pIn.DisposeLocalCopyOfClientHandle();
                    if (!ok) throw new Win32Exception(eroare, "CreateProcess");
                    try {
                        r.Pid = pi.dwProcessId;
                        if (!AssignProcessToJobObject(job, pi.hProcess)) {
                            // procesul e inca suspendat: nu a executat nimic; se opreste si se confirma
                            r.Eroare = "AssignProcessToJobObject: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                            TerminateProcess(pi.hProcess, 1);
                            r.OprireConfirmata = WaitForSingleObject(pi.hProcess, (uint)confirmareMs) == WAIT_OBJECT_0;
                            if (!r.OprireConfirmata) r.Ramase = new int[] { pi.dwProcessId };
                            r.Cod = -1;
                            return r;
                        }
                        var enc = new UTF8Encoding(false);
                        Task<string> tOut = new StreamReader(pOut, enc).ReadToEndAsync();
                        Task<string> tErr = new StreamReader(pErr, enc).ReadToEndAsync();
                        Task tIn = null;
                        if (ResumeThread(pi.hThread) == 0xFFFFFFFF) {
                            r.Eroare = "ResumeThread: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                            r.Cod = -1;
                        } else {
                            byte[] date = stdin ?? new byte[0];
                            tIn = Task.Run(() => {
                                try { if (date.Length > 0) pIn.Write(date, 0, date.Length); pIn.Flush(); }
                                catch (IOException) { } catch (ObjectDisposedException) { }
                                finally { try { pIn.Dispose(); } catch (IOException) { } }
                            });
                            uint w = WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
                            if (w == WAIT_TIMEOUT) { r.Timeout = true; r.Cod = -1; }
                            else if (w == WAIT_OBJECT_0) {
                                uint c; GetExitCodeProcess(pi.hProcess, out c); r.Cod = unchecked((int)c);
                                r.OrfaniLaIesire = ActiveProcese(job);
                            } else { r.Eroare = "WaitForSingleObject"; r.Cod = -1; }
                        }
                        // mereu: tot ce a ramas in job se opreste (si copiii orfani dupa o iesire normala)
                        TerminateJobObject(job, 1);
                        DateTime limita = DateTime.UtcNow.AddMilliseconds(confirmareMs);
                        int activ = ActiveProcese(job);
                        while (activ != 0 && DateTime.UtcNow < limita) { Thread.Sleep(200); activ = ActiveProcese(job); }
                        r.OprireConfirmata = (activ == 0);
                        if (!r.OprireConfirmata) { int[] l = ListaProcese(job); r.Ramase = l ?? new int[0]; }
                        int asteptare = r.OprireConfirmata ? 30000 : 2000;
                        r.Out = Rezultatul(tOut, asteptare);
                        r.Err = Rezultatul(tErr, asteptare);
                        if (tIn != null) { try { tIn.Wait(2000); } catch (AggregateException) { } }
                        return r;
                    } finally { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
                }
            } finally { CloseHandle(job); }
        }
    }
}
'@

function Initialize-JobRunner {
  if (-not ('DialogTgzJob.Runner' -as [type])) {
    Add-Type -TypeDefinition $script:CodJob -Language CSharp -ReferencedAssemblies 'System.Core'
  }
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

function Test-ProcesRamas {
  param([Parameter(Mandatory)]$Proces)
  if ($null -eq $Proces.Start) { return ($null -ne (Get-Process -Id $Proces.Pid -ErrorAction SilentlyContinue)) }
  return (Test-ProcesViu -Id $Proces.Pid -Start $Proces.Start)
}

# Marcajul "oprire neconfirmata": randuri "pid|ticks UTC" (0 = moment necunoscut: viu daca PID-ul exista) sau un singur
# rand "necunoscut" (lista proceselor din job nu s-a putut citi: blocheaza pana il sterge chat-ul, dupa verificare).
# Cat timp un proces listat e inca viu, nicio rulare noua nu porneste (EROARE). Format stricat = EROARE.
function Write-MarcajProcese {
  param([Parameter(Mandatory)][string]$Cale, [AllowEmptyCollection()][string[]]$Ramase)
  $r = @($Ramase | Where-Object { $_ })
  if ($r.Count -eq 0) { $r = @('necunoscut') }
  Write-TextUtf8 $Cale (($r -join "`r`n") + "`r`n")
}

function Test-MarcajProcese {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale)) { return @{ Exista = $false; Vii = @() } }
  $vii = @()
  foreach ($l in @((Read-TextUtf8 $Cale) -split "\r?\n" | Where-Object { $_.Trim() -ne '' })) {
    if ($l.Trim() -ceq 'necunoscut') { $vii += 'necunoscut'; continue }
    if ($l.Trim() -notmatch '^([0-9]{1,10})\|([0-9]{1,19})$') { throw ('marcaj de procese in format necunoscut: ' + $Cale) }
    $start = if ([long]$Matches[2] -eq 0) { $null } else { New-Object DateTime ([long]$Matches[2]), ([DateTimeKind]::Utc) }
    if (Test-ProcesRamas ([pscustomobject]@{ Pid = [int]$Matches[1]; Start = $start })) { $vii += [int]$Matches[1] }
  }
  return @{ Exista = $true; Vii = $vii }
}

# Proces in Job Object, cu stdout / stderr capturate si stdin scris pe un fir separat (un copil care nu citeste
# stdin nu blocheaza timeout-ul). Intoarce @{Cod; Out; Err; Timeout; OprireConfirmata; Ramase (pid|ticks); OrfaniLaIesire; EroareLansare}.
function Invoke-ProcesCapturat {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Argumente, [hashtable]$Env = @{}, [string[]]$EnvSterse = @(),
        [string]$Cwd, [string]$Stdin, [int]$TimeoutSec = 600, [int]$ConfirmareSec = 30)
  Initialize-JobRunner
  $mediu = @{}
  foreach ($e in [System.Environment]::GetEnvironmentVariables().GetEnumerator()) { $mediu[[string]$e.Key] = [string]$e.Value }
  foreach ($k in $EnvSterse) { $mediu.Remove($k) }
  foreach ($k in $Env.Keys) { $mediu[$k] = [string]$Env[$k] }
  $octeti = if ($Stdin) { $script:Utf8FaraBom.GetBytes($Stdin) } else { [byte[]]@() }
  $r = [DialogTgzJob.Runner]::Run($Exe, (Join-ArgumenteWin $Argumente), $mediu, $Cwd, $octeti, $TimeoutSec * 1000, $ConfirmareSec * 1000)
  $ramase = @(foreach ($id in $r.Ramase) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    $ticks = 0
    if ($p) { try { $ticks = $p.StartTime.ToUniversalTime().Ticks } catch { $ticks = 0 } }
    '{0}|{1}' -f $id, $ticks
  })
  return @{ Cod = $r.Cod; Out = $r.Out; Err = $r.Err; Timeout = $r.Timeout; OprireConfirmata = [bool]$r.OprireConfirmata
            Ramase = $ramase; OrfaniLaIesire = $r.OrfaniLaIesire; EroareLansare = $r.Eroare }
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
  return @{ Cod = $r.Cod; Linii = @($r.Out -split "\r?\n"); Err = $r.Err; Timeout = $r.Timeout; OprireConfirmata = $r.OprireConfirmata; Ramase = $r.Ramase }
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
  if ($v.type -cne 'result') { return @{ Ok = $false; Motiv = 'rezultat JSON fara type=result (' + (ConvertTo-TextSigur $desc 200) + ')' } }
  if ($v.subtype -cne 'success') { return @{ Ok = $false; Motiv = 'rezultat fara succes (' + (ConvertTo-TextSigur $desc 200) + ')' } }
  if (-not ($v.is_error -is [bool]) -or $v.is_error) { return @{ Ok = $false; Motiv = 'rezultat cu is_error (' + (ConvertTo-TextSigur $desc 200) + ')' } }
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
# $Psql: { param($FisierSql) -> @{Cod; Linii; Err; OprireConfirmata; Ramase} }
# $Claude: { param([string]$Prompt, [string]$Token, [string[]]$Radacini, [string]$DirIntrare, [string]$DirIesire)
#            -> @{Cod; Out; Err; Timeout; OprireConfirmata; Ramase} }
# $Log: { param([string]$Mesaj) }  (mesajele trec oricum prin ConvertTo-TextSigur inainte)
# $Asteapta: { param([int]$Sec) } fereastra dintre cele doua re-verificari de coliziune (in test: injecteaza un juridic#).
# Config: DialogDir, TokenFile, WorkDir, SqlDir, PromptFile, SchemaFile, CaleCursor, CaleMarcaj,
#         RadaciniAtasamente, Model, Effort, MaxTurns, TimeoutMin, [IdRulare], [AsteptareColiziuneSec], [MutariColiziune]
function Invoke-DialogTgz {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][scriptblock]$Psql,
        [Parameter(Mandatory)][scriptblock]$Claude, [Parameter(Mandatory)][scriptblock]$Log, [datetime]$Acum = (Get-Date),
        [scriptblock]$Asteapta = { param([int]$Sec) if ($Sec -gt 0) { Start-Sleep -Seconds $Sec } })
  function Rez([string]$Stare, [string]$Linie, [int]$Cod) { return @{ Stare = $Stare; Linie = (ConvertTo-TextSigur $Linie 400); Cod = $Cod } }
  function Test-OprireOk($R) { return ($R -is [hashtable] -and $R.ContainsKey('OprireConfirmata') -and $R.OprireConfirmata -is [bool] -and $R.OprireConfirmata) }
  $L = { param([string]$m) & $Log (ConvertTo-TextSigur $m 25000 -PastreazaLiniiNoi) }
  $asteptareSec = if ($Config.ContainsKey('AsteptareColiziuneSec')) { [int]$Config.AsteptareColiziuneSec } else { 0 }
  $mutari = if ($Config.ContainsKey('MutariColiziune')) { [int]$Config.MutariColiziune } else { 5 }
  $cand = $Acum.ToString('yyyy-MM-dd HH:mm')
  try {
    # (0) o rulare anterioara cu oprire neconfirmata blocheaza pana dispar procesele ei
    $mc = Test-MarcajProcese $Config.CaleMarcaj
    if ($mc.Exista) {
      if ($mc.Vii.Count -gt 0) { return (Rez 'EROARE' ('EROARE procese din rularea anterioara inca active sau necunoscute (' + ($mc.Vii -join ', ') + '); nu pornesc') 1) }
      Remove-Item -LiteralPath $Config.CaleMarcaj -Force
      & $L 'marcaj de oprire neconfirmata gasit; procesele au disparut, marcajul s-a sters'
    }

    # (1) token, folder, contractul raspunsului
    $tok = Read-TokenFisier $Config.TokenFile
    if (-not $tok.Ok) { return (Rez 'EROARE' ('EROARE ' + $tok.Motiv) 1) }
    & $L 'token: prezent, format sk-ant-oat01- corect (valoarea nu se scrie in log)'
    $folder = Get-Item -LiteralPath $Config.DialogDir -ErrorAction SilentlyContinue
    if ($null -eq $folder -or -not $folder.PSIsContainer -or (Test-EsteReparse $folder)) {
      return (Rez 'EROARE' ('EROARE folderul de dialog lipseste sau e legatura: ' + $Config.DialogDir) 1)
    }
    $schema = Read-SchemaRaspuns $Config.SchemaFile

    # (2) cursorul local + temporarele proprii ramase (sub lock-ul global)
    $ultimul = Read-Cursor $Config.CaleCursor
    & $L ('cursor: ultimul procesat juridic#{0:000}' -f $ultimul)
    $sterse = Remove-TemporareProprii $Config.DialogDir
    if ($sterse.Count -gt 0) { & $L ('temporare proprii ramase, sterse: ' + ($sterse -join ', ')) }

    # (3) fisiere noi + amprentele lor
    $noi = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul
    $amprente = @{}
    foreach ($f in $noi) { $amprente[[int]$f.Numar] = Get-Sha256Fisier $f.Cale }
    $numere = @($noi | ForEach-Object { [int]$_.Numar })

    # (3b) reconciliere cu dialogul: un GATA publicat deja pentru mesaje inca necursate (rulare oprita intre publicare
    # si cursor) = doar avans de cursor, fara inferenta noua. Potrivirea = cheia (numere + amprente exacte).
    $proprii = Get-RaspunsuriProprii $Config.DialogDir
    $gata = @($proprii | Where-Object { $_.Stare -eq 'GATA' -and @($_.Juridic | Where-Object { $numere -notcontains $_ }).Count -eq 0 -and
                                        $_.Cheie -ceq (Get-CheieIntentie $_.Juridic $amprente) })
    if ($gata.Count -gt 1) { return (Rez 'EROARE' ('EROARE mai multe raspunsuri GATA nereconciliate ({0}); de verificat de chat' -f (($gata | ForEach-Object { $_.Nume }) -join ', ')) 1) }
    if ($gata.Count -eq 1) {
      $g = $gata[0]
      $maxG = ($g.Juridic | Measure-Object -Maximum).Maximum
      $lipsa = @($numere | Where-Object { $_ -le $maxG -and $g.Juridic -notcontains $_ })
      if ($lipsa.Count -gt 0) {
        return (Rez 'EROARE' ('EROARE {0} (publicat anterior) nu acopera {1}, aparute intre timp cu numar mai mic; de decis de chat' -f $g.Nume, (($lipsa | ForEach-Object { 'juridic#{0:000}' -f $_ }) -join ', ')) 1)
      }
      $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $g.Numar -Mutari $mutari
      foreach ($x in $col.Mutari) { & $L ('coliziune de numar rezolvata: ' + $x) }
      $rand = Write-Cursor -Cale $Config.CaleCursor -Vechi $ultimul -NrJuridic $maxG -NrClaude $col.Numar -Cand $cand
      & $L ('reconciliere: {0} era deja publicat pentru {1}; cursor avansat fara rulare noua: {2}' -f $col.Nume, (($g.Juridic | ForEach-Object { 'juridic#{0:000}' -f $_ }) -join ', '), $rand)
      $ultimul = $maxG
      $noi = @($noi | Where-Object { $_.Numar -gt $maxG })
      $numere = @($noi | ForEach-Object { [int]$_.Numar })
      if ($noi.Count -eq 0) { return (Rez 'GATA' ('GATA {0} (reconciliat: publicat anterior, cursor avansat acum)' -f ($col.Nume -replace '\.md$', '')) 0) }
    }
    if ($noi.Count -eq 0) {
      & $L 'niciun juridic#NNN nou cu antet (verificare programata); Claude nu porneste'
      return (Rez 'NIMIC NOU' ('NIMIC NOU (ultimul procesat juridic#{0:000})' -f $ultimul) 0)
    }
    $cheie = Get-CheieIntentie $numere $amprente
    $oprit = @($proprii | Where-Object { $_.Stare -eq 'OPRIT' -and $_.Cheie -ceq $cheie })
    if ($oprit.Count -gt 0) {
      # r4: inainte de iesirea "deja publicat", aceeasi recuperare a coliziunii ca la GATA (o mutare esuata dupa
      # publicarea unui OPRIT se repara aici; coliziune nerezolvata = EROARE, nu "deja publicat").
      $numeOprit = @()
      foreach ($o in $oprit) {
        try { $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $o.Numar -Mutari $mutari }
        catch { return (Rez 'EROARE' ('EROARE OPRIT publicat anterior ({0}), dar numarul lui se ciocneste cu un juridic#: {1}; de reparat manual' -f $o.Nume, $_.Exception.Message) 1) }
        foreach ($x in $col.Mutari) { & $L ('coliziune de numar rezolvata (OPRIT): ' + $x) }
        $numeOprit += $col.Nume
      }
      & $L ('OPRIT deja publicat pentru exact aceleasi mesaje ({0}); nu se reia' -f ($numeOprit -join ', '))
      return (Rez 'OPRIT' ('OPRIT deja publicat ({0}); astept decizia chat-ului / lui Razvan' -f ($numeOprit -join ', ')) 0)
    }
    $maxJuridic = ($numere | Measure-Object -Maximum).Maximum
    & $L ('fisiere noi: ' + (($noi | ForEach-Object { $_.Nume }) -join ', ') + '; cheie ' + $cheie)

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

    # (5) context agregat (psql, doar citire; SQL-ul refuza un rol care poate scrie), citit ca tabele
    $caleContext = Join-Path $dirIntrare 'context.md'
    $r = & $Psql (Join-Path $Config.SqlDir 'context_agregat.sql')
    if (-not (Test-OprireOk $r)) {
      Write-MarcajProcese $Config.CaleMarcaj @($r.Ramase)
      return (Rez 'EROARE' 'EROARE oprirea procesului psql nu s-a putut confirma; marcaj scris, rularile urmatoare asteapta' 1)
    }
    if ($r.Cod -ne 0) { return (Rez 'EROARE' ('EROARE psql export context (cod ' + $r.Cod + '): ' + $r.Err) 1) }
    try { $export = ConvertFrom-ExportContext @($r.Linii); Test-ExportFataDeSchema $export $schema }
    catch { return (Rez 'EROARE' ('EROARE exportul ERP nu se potriveste contractului: ' + $_.Exception.Message) 1) }
    $antet = "# Context Redari TGZ - cifre agregate`n`nGenerat: " + $Acum.ToString('yyyy-MM-dd HH:mm') +
             " (doar SELECT, fara nume / telefoane / adrese / CNP). Tabele: antet + randuri, coloane separate prin |, - = gol.`n`n"
    Write-TextUtf8 $caleContext ($antet + (($r.Linii) -join "`n") + "`n")
    & $L ('context agregat scris: ' + $caleContext)

    # (6) agentul
    $radacini = @($Config.RadaciniAtasamente | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) })
    & $L ('radacini atasamente accesibile: ' + $(if ($radacini.Count) { $radacini -join '; ' } else { '(niciuna)' }))
    $valori = Get-ValoriPromptSchema $schema
    $valori['FISIERE_JURIDIC'] = (($noi | ForEach-Object { '- ' + $_.Cale }) -join "`n")
    $valori['JURIDIC_NUMERE'] = (($numere | ForEach-Object { 'juridic#{0:000} ("juridic": {1})' -f $_, $_ }) -join ', ')
    $valori['CALE_RASPUNS'] = $caleAgent
    $valori['CALE_CONTEXT'] = $caleContext
    $valori['FOLDER_DIALOG'] = $Config.DialogDir
    $valori['RADACINI_ATASAMENTE'] = $(if ($radacini.Count) { ($radacini | ForEach-Object { '- ' + $_ }) -join "`n" } else { '- (niciuna accesibila pe acest calculator)' })
    $valori['DATA'] = $Acum.ToString('yyyy-MM-ddTHH:mm:sszzz')
    $valori['ULTIMUL_PROCESAT'] = ('{0:000}' -f $ultimul)
    $prompt = Format-Prompt (Read-TextUtf8 $Config.PromptFile) $valori
    $inainte = Get-InstantaneuDialog $Config.DialogDir
    & $L ('pornesc claude -p: model {0}, effort {1}, max-turns {2}, iesire {3}' -f $Config.Model, $Config.Effort, $Config.MaxTurns, $dirIesire)
    $rc = & $Claude $prompt $tok.Token $radacini $dirIntrare $dirIesire
    $tok = $null
    $oprireOk = Test-OprireOk $rc
    & $L ('claude: cod iesire {0}{1}' -f $rc.Cod, $(if ($rc.Timeout) { ' (TIMEOUT, job oprit; confirmat: ' + $oprireOk + ')' } else { '' }))
    if ($rc.ContainsKey('OrfaniLaIesire') -and $rc.OrfaniLaIesire -gt 0) { & $L ('claude: {0} procese copil ramase la iesire, oprite odata cu jobul' -f $rc.OrfaniLaIesire) }
    if ($rc.ContainsKey('EroareLansare') -and $rc.EroareLansare) { & $L ('claude: lansare esuata: ' + $rc.EroareLansare) }
    # stderr-ul agentului poate contine text din mesaje: in log intra doar lungimea
    if ($rc.Err) { & $L ('claude stderr: {0} caractere (continutul nu se jurnalizeaza)' -f ([string]$rc.Err).Length) }

    # (7) esecurile procesului: nimic nu se publica, cursorul nu avanseaza
    if (-not $oprireOk) {
      Write-MarcajProcese $Config.CaleMarcaj @($rc.Ramase)
      return (Rez 'EROARE' ('EROARE oprirea procesului claude nu s-a putut confirma ({0} procese ramase); marcaj scris, rularile urmatoare asteapta' -f @($rc.Ramase | Where-Object { $_ }).Count) 1)
    }
    if ($rc.Timeout) { return (Rez 'EROARE' ('EROARE claude a depasit {0} min (oprit); nimic publicat' -f $Config.TimeoutMin) 1) }
    if ($rc.Cod -ne 0) { return (Rez 'EROARE' ('EROARE claude a iesit cu codul {0}; nimic publicat' -f $rc.Cod) 1) }
    $ij = ConvertFrom-IesireClaude $rc.Out
    & $L ('claude rezultat: ' + $ij.Motiv)
    if (-not $ij.Ok) { return (Rez 'EROARE' ('EROARE claude: ' + $ij.Motiv + '; nimic publicat') 1) }

    # (8) iesirea agentului: exact raspuns.json, fisier obisnuit, nimic altceva
    $elemente = @(Get-ChildItem -LiteralPath $dirIesire -Force -Recurse -ErrorAction Stop)
    $straine = @($elemente | Where-Object { $_.FullName -ne $caleAgent -or $_.PSIsContainer -or (Test-EsteReparse $_) })
    if ($straine.Count -gt 0) {
      return (Rez 'EROARE' ('EROARE in folderul de iesire sunt si alte elemente ({0}); nimic publicat' -f $straine.Count) 1)
    }
    if (-not (Test-Path -LiteralPath $caleAgent -PathType Leaf)) { return (Rez 'EROARE' 'EROARE agentul nu a scris raspuns.json' 1) }

    # (9) dialogul: nimic atins, intrarile neschimbate, nicio intrebare noua sarita
    $probleme = Compare-InstantaneuDialog -Inainte $inainte -Dupa (Get-InstantaneuDialog $Config.DialogDir)
    if ($probleme.Count -gt 0) {
      & $L ('dialog atins in timpul rularii: ' + ($probleme -join '; '))
      return (Rez 'EROARE' ('EROARE folderul de dialog s-a schimbat in timpul rularii: {0}; nimic publicat' -f ($probleme -join '; ')) 1)
    }
    foreach ($f in $noi) {
      if (-not (Test-Path -LiteralPath $f.Cale -PathType Leaf) -or (Get-Sha256Fisier $f.Cale) -ne $amprente[[int]$f.Numar]) {
        return (Rez 'EROARE' ('EROARE {0} s-a schimbat in timpul rularii; nimic publicat' -f $f.Nume) 1)
      }
    }
    $dupa = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul   # in variabila: ,@() nu se enumera in pipe
    $tarzii = @($dupa | Where-Object { $numere -notcontains [int]$_.Numar -and $_.Numar -lt $maxJuridic })
    if ($tarzii.Count -gt 0) {
      return (Rez 'EROARE' ('EROARE au aparut in timpul rularii mesaje cu numar mai mic decat cel procesat ({0}); reiau la rularea urmatoare' -f (($tarzii | ForEach-Object { $_.Nume }) -join ', ')) 1)
    }

    # (10) raspunsul: contractul JSON (bariera principala pentru date personale), apoi compunerea de catre program
    $va = Test-RaspunsAgent -Cale $caleAgent -Schema $schema -Export $export -Juridic $numere
    if (-not $va.Ok) {
      & $L ('raspuns.json respins: ' + $va.Motiv)
      return (Rez 'EROARE' ('EROARE raspuns nepublicat: ' + $va.Motiv) 1)
    }
    $date = $va.Date
    & $L ('raspuns.json valid: stare {0}, {1} mesaje' -f $date.Stare, @($date.Mesaje).Count)
    if ($date.Stare -eq 'EROARE') { return (Rez 'EROARE' ('EROARE agentul: ' + $date.MotivEroare + ' (nepublicat)') 1) }
    $text = Format-RaspunsPublicat -Date $date -Schema $schema -Cheie $cheie -Data $Acum.ToString('yyyy-MM-ddTHH:mm:sszzz')
    $dp = @(Find-DatePersonale $text)
    if ($dp.Count -gt 0) { return (Rez 'EROARE' ('EROARE raspuns nepublicat: tipare de date personale in textul compus (' + ($dp -join ', ') + '); de verificat de chat') 1) }
    if ($script:Utf8FaraBom.GetByteCount($text) -gt $script:MaxRaspunsOcteti) { return (Rez 'EROARE' 'EROARE raspunsul compus depaseste 200 KB; nepublicat' 1) }

    # (11) publicare exclusiva + re-verificarea numarului (imediat si dupa fereastra de asteptare)
    $pub = Publish-RaspunsExclusiv -Folder $Config.DialogDir -Text $text -Cheie $cheie
    & $L ('publicat ' + $pub.Nume + ' (raspuns la ' + (($numere | ForEach-Object { 'juridic#{0:000}' -f $_ }) -join ', ') + ')')
    try {
      $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $pub.Numar -Mutari $mutari
      & $Asteapta $asteptareSec
      $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $col.Numar -Mutari $mutari
    } catch {
      return (Rez 'EROARE' ('EROARE raspunsul e publicat, dar numarul lui se ciocneste cu un juridic#: {0}; cursorul nu avanseaza, reconcilierea se reia la rularea urmatoare' -f $_.Exception.Message) 1)
    }
    if ($col.Numar -ne $pub.Numar) { & $L ('coliziune cu un juridic# cu acelasi numar: raspunsul mutat pe ' + $col.Nume) }
    Remove-Item -LiteralPath $dirRulare -Recurse -Force -ErrorAction SilentlyContinue

    if ($date.Stare -eq 'OPRIT') {
      & $L 'OPRIT: cursorul nu se muta; aceleasi mesaje nu se mai reiau cat timp au acelasi continut (cheie)'
      return (Rez 'OPRIT' ('OPRIT {0} ({1})' -f $date.MotivOprire, $col.Nume) 0)
    }

    # (12) cursorul local, cu CAS pe valoarea citita la (2)
    try { $rand = Write-Cursor -Cale $Config.CaleCursor -Vechi $ultimul -NrJuridic $maxJuridic -NrClaude $col.Numar -Cand $cand }
    catch { return (Rez 'EROARE' ('EROARE {0} publicat, dar cursorul nu s-a mutat: {1}; rularea urmatoare reconciliaza' -f $col.Nume, $_.Exception.Message) 1) }
    & $L ('cursor: ' + $rand)
    return (Rez 'GATA' ('GATA claude#{0:000}' -f $col.Numar) 0)
  } catch {
    return (Rez 'EROARE' ('EROARE ' + $_.Exception.Message) 1)
  }
}

Export-ModuleMember -Function *
