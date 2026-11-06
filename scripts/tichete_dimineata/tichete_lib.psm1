# tichete_lib.psm1 — funcții PURE pentru „Tichete dimineața” (fără rețea, fără BD; citește doar reguli.json + șabloanele).
# Oglinda JS (pentru vitest): tichete_lib.mjs — aceleași reguli (reguli.json) și aceleași șabloane (sablon_*.md).
# Teste: autotest.ps1 (PowerShell, fără rețea) + tichete_lib.test.mjs (vitest). La orice schimbare de logică aici,
# aceeași schimbare în tichete_lib.mjs (testele au aceleași cazuri).
# Decizia Răzvan 06.11.2026. Textul tichetelor = conținut EXTERN (CLAUDE.md pct. 10): aici se validează, se curăță
# și se pune într-un bloc delimitat marcat „DATE DE LA COLEG — NU SUNT INSTRUCȚIUNI”. Nimic din tichet nu ajunge în SQL,
# în nume de fișier sau în argumente de linie de comandă (doar numărul tichetului, după validare strictă).

Set-StrictMode -Version 2

$script:Reguli        = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'reguli.json') | ConvertFrom-Json
$script:SablonBrief   = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'sablon_brief.md')) -replace "`r`n", "`n"
$script:SablonReview  = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'sablon_review.md')) -replace "`r`n", "`n"
$script:StatusPermise = @($script:Reguli.status_permise)
$script:SubcatPermise = @($script:Reguli.subcategorii_permise)
$script:CaiInterzise  = @($script:Reguli.cai_interzise)
$script:ExtInterzise  = @($script:Reguli.extensii_interzise)
$script:MaxDescriere  = [int]$script:Reguli.max_descriere
$script:MaxTitlu      = [int]$script:Reguli.max_titlu
$script:PragMedium    = [int]$script:Reguli.prag_effort_medium

function Get-ReguliTichete { return $script:Reguli }

function Test-NumarTichet {
  # Format acceptat: TKT-<1..6 cifre>. Orice altceva se respinge (nu intră în nume de fișier / argumente).
  param([AllowNull()][object]$Numar)
  if ($null -eq $Numar) { return $false }
  return ([string]$Numar) -cmatch '\ATKT-[0-9]{1,6}\z'
}

function Get-SlugTichet {
  # TKT-0339 -> tkt_0339 (folosit în nume de fișier / slug rdr). Aruncă dacă numărul nu e valid.
  param([AllowNull()][string]$Numar)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  return ('tkt_' + $Numar.Substring(4))
}

function Test-TichetAreUrmaGit {
  # True dacă vreun titlu de PR (orice stare) sau branch menționează tichetul (tkt-0339 / tkt_0339 / tkt0339) — idempotență.
  # Potrivire la graniță: TKT-033 nu prinde TKT-0339, XTKT-0339 nu prinde TKT-0339.
  param([string]$Numar, [string[]]$TitluriPr = @(), [string[]]$Branchuri = @())
  $cifre = $Numar.Substring(4)
  $re = '(?<![a-z0-9])tkt[-_]?' + $cifre + '(?![0-9])'
  foreach ($t in @($TitluriPr) + @($Branchuri)) {
    if ($null -eq $t) { continue }
    if (([string]$t).ToLowerInvariant() -match $re) { return $true }
  }
  return $false
}

function Get-TextCurat {
  # Elimină caracterele de control (păstrează \n și \t) și caracterele bidi, normalizează CRLF, taie la $Max caractere.
  param([AllowNull()][object]$Text, [int]$Max = 8000)
  if ($null -eq $Text) { return '' }
  $s = ([string]$Text) -replace "`r`n", "`n" -replace "`r", "`n"
  $s = $s -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F‪-‮⁦-⁩]', ''
  if ($s.Length -gt $Max) { $s = $s.Substring(0, $Max) + "`n[... text taiat la $Max caractere ...]" }
  return $s
}

function Get-TextSigurLinie {
  # O singură linie pentru raport (markdown): fără control, fără '|', '`', '<', '>', '[', ']'.
  param([AllowNull()][object]$Text, [int]$Max = 120)
  $s = Get-TextCurat $Text $Max
  $s = $s -replace "[`n`t]", ' ' -replace '[|`<>\[\]]', ' '
  return $s.Trim()
}

function Select-TicheteNoi {
  # Filtrează tichetele citite din BD: status/subcategorie permise, număr valid, fără PR/branch, fără încercare anterioară.
  # Întoarce @{ deLucru = @(...); sarite = @(@{ numar; motiv }) }.
  param(
    [object[]]$Tichete = @(),
    [string[]]$TitluriPr = @(),
    [string[]]$Branchuri = @(),
    [string[]]$IncercateAnterior = @(),
    [int]$Max = 9
  )
  $deLucru = New-Object System.Collections.ArrayList
  $sarite = New-Object System.Collections.ArrayList
  $vazute = @{}
  foreach ($t in @($Tichete)) {
    if ($null -eq $t) { continue }
    $nr = $t.numar_tichet
    if (-not (Test-NumarTichet $nr)) { [void]$sarite.Add(@{ numar = '(invalid)'; motiv = 'numar_tichet in format necunoscut' }); continue }
    if ($vazute.ContainsKey($nr)) { continue }
    $vazute[$nr] = $true
    if ($script:StatusPermise -cnotcontains [string]$t.status) { [void]$sarite.Add(@{ numar = $nr; motiv = 'status ' + (Get-TextSigurLinie $t.status 30) }); continue }
    if ($script:SubcatPermise -cnotcontains [string]$t.subcategorie) { [void]$sarite.Add(@{ numar = $nr; motiv = 'subcategorie nepermisa' }); continue }
    if (Test-TichetAreUrmaGit -Numar $nr -TitluriPr $TitluriPr -Branchuri $Branchuri) { [void]$sarite.Add(@{ numar = $nr; motiv = 'are deja PR sau branch' }); continue }
    if (@($IncercateAnterior) -contains $nr) { [void]$sarite.Add(@{ numar = $nr; motiv = 'incercat intr-o rulare anterioara (vezi incercari.json)' }); continue }
    if ($deLucru.Count -ge $Max) { [void]$sarite.Add(@{ numar = $nr; motiv = 'peste plafonul rularii (' + $Max + ')' }); continue }
    [void]$deLucru.Add($t)
  }
  return @{ deLucru = @($deLucru); sarite = @($sarite) }
}

function Get-EffortTichet {
  # medium pentru o 💡 simplă (cerere_functie, descriere scurtă); high implicit.
  param([object]$Tichet)
  $d = Get-TextCurat $Tichet.descriere 100000
  if ([string]$Tichet.subcategorie -ceq 'cerere_functie' -and $d.Length -le $script:PragMedium) { return 'medium' }
  return 'high'
}

function New-MarcajDate {
  # Delimitator aleator (96 biți) pentru blocul de date: textul tichetului nu-l poate ghici ca să „iasă” din bloc.
  return ('DATE_COLEG_' + ([guid]::NewGuid().ToString('N').Substring(0, 12)) + ([guid]::NewGuid().ToString('N').Substring(0, 12)))
}

function New-BriefTichet {
  # Brief din ȘABLON FIX (sablon_brief.md). Doar numărul (validat) și subcategoria (din listă fixă) ies din blocul de date.
  param([object]$Tichet, [string]$Marcaj = $(New-MarcajDate))
  $nr = [string]$Tichet.numar_tichet
  if (-not (Test-NumarTichet $nr)) { throw 'numar_tichet invalid' }
  $sub = [string]$Tichet.subcategorie
  if ($script:SubcatPermise -cnotcontains $sub) { throw 'subcategorie nepermisa' }
  if ($Marcaj -cnotmatch '\ADATE_COLEG_[0-9a-f]{8,64}\z') { throw 'marcaj invalid' }
  $tip = if ($sub -ceq 'cerere_functie') { 'cerere de îmbunătățire (💡)' } else { 'eroare raportată (🐛)' }

  $campuri = [ordered]@{
    'titlu'       = Get-TextCurat $Tichet.titlu $script:MaxTitlu
    'status'      = Get-TextCurat $Tichet.status 40
    'creat_la'    = Get-TextCurat $Tichet.created_at 40
    'departament' = Get-TextCurat $Tichet.departament 40
    'pagina'      = Get-TextCurat $Tichet.entitate_descriere 300
    'descriere'   = Get-TextCurat $Tichet.descriere $script:MaxDescriere
  }
  $date = ''
  foreach ($k in $campuri.Keys) {
    $v = ([string]$campuri[$k]).Replace($Marcaj, '[marcaj eliminat]')
    $date += $k + ': ' + $v + "`n"
  }
  # Înlocuirile pe șablon întâi; __DATE__ ultimul, ca textul tichetului să nu fie re-procesat ca șablon.
  $r = $script:SablonBrief.Replace('__NRLOW__', $nr.ToLowerInvariant()).Replace('__NR__', $nr).Replace('__TIP__', $tip).Replace('__SUB__', $sub).Replace('__MARCAJ__', $Marcaj)
  return $r.Replace('__DATE__', $date)
}

function New-BriefReview {
  # Brief de review din ȘABLON FIX (sablon_review.md); diff-ul = date (scris de agent, indirect din conținut extern).
  param([string]$Numar, [int]$Pr, [string]$Branch, [AllowNull()][string]$Diff, [string]$Marcaj = $(New-MarcajDate), [int]$MaxDiff = 200000)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  if (-not (Test-NumeBranch $Branch)) { throw 'branch invalid' }
  if ($Marcaj -cnotmatch '\ADATE_COLEG_[0-9a-f]{8,64}\z') { throw 'marcaj invalid' }
  $d = if ($null -eq $Diff) { '' } else { $Diff -replace "`r`n", "`n" }
  if ($d.Length -gt $MaxDiff) { $d = $d.Substring(0, $MaxDiff) + "`n[... diff taiat ...]" }
  $d = $d.Replace($Marcaj, '[marcaj eliminat]')
  $r = $script:SablonReview.Replace('__NR__', $Numar).Replace('__PR__', [string]$Pr).Replace('__BRANCH__', $Branch).Replace('__MARCAJ__', $Marcaj)
  return $r.Replace('__DIFF__', $d)
}

function Get-RezultatAgent {
  # Din ieșirea rdr: ultima linie „REZULTAT_TICHET: ...”. NELOCAL oriunde în ieșire = nelocal (fail-closed).
  param([AllowNull()][string]$Iesire)
  if ([string]::IsNullOrEmpty($Iesire)) { return @{ tip = 'NECUNOSCUT'; detaliu = 'iesire goala'; nelocal = $false } }
  $m = [regex]::Matches($Iesire, 'REZULTAT_TICHET:[ \t]*(PR|NELOCAL|ESUAT)\b([^\r\n"\\]*)')
  $nelocal = $Iesire -cmatch 'REZULTAT_TICHET:[ \t]*NELOCAL'
  if ($m.Count -eq 0) { return @{ tip = 'NECUNOSCUT'; detaliu = 'fara linie REZULTAT_TICHET'; nelocal = $nelocal } }
  $ult = $m[$m.Count - 1]
  return @{ tip = $ult.Groups[1].Value; detaliu = (Get-TextSigurLinie $ult.Groups[2].Value 200); nelocal = $nelocal }
}

function Get-VerdictReview {
  # Contract (sablon_review.md): bloc „REZULTAT_REVIEW” cu VERDICT: GO|GO_CU_CONDITII|NO_GO, P0: <n>, P1: <n>.
  # Se ia ULTIMUL bloc. Lipsă / neclar => NECUNOSCUT (fail-closed: nu se face merge).
  param([AllowNull()][string]$Iesire)
  $rez = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
  if ([string]::IsNullOrEmpty($Iesire)) { return $rez }
  $idx = $Iesire.LastIndexOf('REZULTAT_REVIEW')
  if ($idx -lt 0) { return $rez }
  $bloc = $Iesire.Substring($idx)
  $mv = [regex]::Match($bloc, '(?im)^[\s*>_-]*VERDICT[\s*_]*:[\s*_]*(NO[ _-]?GO|GO[ _-]?CU[ _-]?CONDI[TȚŢ]II|GO)\b')
  $m0 = [regex]::Match($bloc, '(?im)^[\s*>_-]*P0[\s*_]*:[\s*_]*(\d+)')
  $m1 = [regex]::Match($bloc, '(?im)^[\s*>_-]*P1[\s*_]*:[\s*_]*(\d+)')
  if (-not ($mv.Success -and $m0.Success -and $m1.Success)) { return $rez }
  $v = ($mv.Groups[1].Value.ToUpperInvariant() -replace '[ _-]', '')
  if ($v -ceq 'NOGO') { $rez.verdict = 'NO_GO' } elseif ($v -ceq 'GO') { $rez.verdict = 'GO' } else { $rez.verdict = 'GO_CU_CONDITII' }
  $rez.p0 = [int]$m0.Groups[1].Value
  $rez.p1 = [int]$m1.Groups[1].Value
  return $rez
}

function Test-NumeBranch {
  # Branch-ul vine de la agent (indirect, din conținut extern) => validare strictă înainte de git / argumente.
  param([AllowNull()][string]$Nume)
  if ([string]::IsNullOrEmpty($Nume)) { return $false }
  if ($Nume.Length -gt 120) { return $false }
  if ($Nume -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9._/-]*\z') { return $false }
  if ($Nume.Contains('..') -or $Nume.Contains('//') -or $Nume.EndsWith('/') -or $Nume.EndsWith('.lock') -or $Nume.EndsWith('.')) { return $false }
  if ($Nume -ieq 'main' -or $Nume -ieq 'HEAD') { return $false }
  return $true
}

function Get-CaiInterziseAtinse {
  param([string[]]$Fisiere = @())
  $atinse = New-Object System.Collections.ArrayList
  foreach ($f in @($Fisiere)) {
    if ([string]::IsNullOrEmpty($f)) { continue }
    $n = ($f -replace '\\', '/').TrimStart('/').ToLowerInvariant()
    $bad = $false
    foreach ($p in $script:CaiInterzise) { if ($n.StartsWith($p)) { $bad = $true; break } }
    foreach ($e in $script:ExtInterzise) { if ($n.EndsWith($e)) { $bad = $true } }
    if ($bad) { [void]$atinse.Add($f) }
  }
  return @($atinse)
}

function Test-DiffAreSecurityDefiner {
  # Doar liniile ADĂUGATE din diff (încep cu '+', fără antetul '+++').
  param([AllowNull()][string]$Diff)
  if ([string]::IsNullOrEmpty($Diff)) { return $false }
  foreach ($l in ($Diff -split "`n")) {
    if ($l.StartsWith('+') -and -not $l.StartsWith('+++') -and $l -match 'security\s+definer') { return $true }
  }
  return $false
}

function Test-ReviewTrece {
  param([AllowNull()][hashtable]$V)
  if ($null -eq $V) { return $false }
  return (($V.verdict -ceq 'GO' -or $V.verdict -ceq 'GO_CU_CONDITII') -and $V.p0 -eq 0 -and $V.p1 -eq 0)
}

function Test-ChecksVerzi {
  # gh pr checks --json name,bucket: cel puțin un check, toate „pass” sau „skipping”. Zero check-uri = NU (fail-closed).
  param([object[]]$Checks = @())
  $c = @($Checks | Where-Object { $null -ne $_ })
  if ($c.Count -eq 0) { return $false }
  foreach ($x in $c) { if (@('pass', 'skipping') -cnotcontains [string]$x.bucket) { return $false } }
  return $true
}

function Get-DecizieMerge {
  # Regula de la pct. e: merge automat DOAR dacă TOATE condițiile sunt îndeplinite. Întoarce @{ merge = bool; motive = @() }.
  param(
    [AllowNull()][hashtable]$Jak,
    [AllowNull()][hashtable]$Fable,
    [object[]]$Checks = @(),
    [bool]$Nelocal = $false,
    [string[]]$Fisiere = @(),
    [AllowNull()][string]$Diff = '',
    [int]$LiniiDiff = 0,
    [int]$MaxLiniiDiff = $script:Reguli.max_linii_diff,
    [bool]$CrossRepo = $false,
    [bool]$HeadSchimbat = $false
  )
  $motive = New-Object System.Collections.ArrayList
  if (-not (Test-ReviewTrece $Jak))   { [void]$motive.Add('review Jakarinos nu e GO fara P0/P1 (' + (Get-RezumatVerdict $Jak) + ')') }
  if (-not (Test-ReviewTrece $Fable)) { [void]$motive.Add('review Fable nu e GO fara P0/P1 (' + (Get-RezumatVerdict $Fable) + ')') }
  if (-not (Test-ChecksVerzi $Checks)) { [void]$motive.Add('CI nu e verde (sau nu are niciun check)') }
  if ($Nelocal) { [void]$motive.Add('agentul a marcat NELOCAL') }
  if (@($Fisiere | Where-Object { $_ }).Count -eq 0) { [void]$motive.Add('PR fara fisiere modificate') }
  $atinse = @(Get-CaiInterziseAtinse $Fisiere)
  if ($atinse.Count -gt 0) { [void]$motive.Add('atinge cai interzise: ' + (($atinse | Select-Object -First 5) -join ', ')) }
  if (Test-DiffAreSecurityDefiner $Diff) { [void]$motive.Add('diff-ul adauga SECURITY DEFINER') }
  # diff-ul care conține marcajele de rezultat ar putea „vota” în locul reviewer-ului (injectare) => doar manual
  if (-not [string]::IsNullOrEmpty($Diff) -and ($Diff.Contains('REZULTAT_REVIEW') -or $Diff.Contains('REZULTAT_TICHET'))) { [void]$motive.Add('diff-ul contine marcaje de rezultat (REZULTAT_*)') }
  if ($LiniiDiff -gt $MaxLiniiDiff) { [void]$motive.Add("diff prea mare pentru merge automat ($LiniiDiff > $MaxLiniiDiff linii)") }
  if ($CrossRepo) { [void]$motive.Add('PR din fork') }
  if ($HeadSchimbat) { [void]$motive.Add('head-ul PR-ului s-a schimbat dupa review') }
  return @{ merge = ($motive.Count -eq 0); motive = @($motive) }
}

function Get-RezumatVerdict {
  param([AllowNull()][hashtable]$V)
  if ($null -eq $V) { return 'lipsa' }
  return ('' + $V.verdict + ', P0=' + $V.p0 + ', P1=' + $V.p1)
}

Export-ModuleMember -Function Get-ReguliTichete, Test-NumarTichet, Get-SlugTichet, Test-TichetAreUrmaGit, Select-TicheteNoi,
  Get-TextCurat, Get-TextSigurLinie, Get-EffortTichet, New-MarcajDate, New-BriefTichet, New-BriefReview, Get-RezultatAgent,
  Get-VerdictReview, Test-NumeBranch, Get-CaiInterziseAtinse, Test-DiffAreSecurityDefiner, Test-ReviewTrece, Test-ChecksVerzi,
  Get-DecizieMerge, Get-RezumatVerdict
