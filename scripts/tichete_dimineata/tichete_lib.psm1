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
$script:CuvinteDiff   = @($script:Reguli.cuvinte_interzise_diff)
$script:MarcajeRezultat = @($script:Reguli.marcaje_rezultat)
$script:RegiuniInterzise = @($script:Reguli.regiuni_interzise)

function Get-ReguliTichete { return $script:Reguli }

function Test-NumarTichet {
  # Formatul real (fn_genereaza_numar_tichet, BugReportButton.jsx): TKT-<an>-<serie>, ex. TKT-2026-0134.
  # Acceptat și formatul vechi scurt TKT-<serie>. Orice altceva se respinge (nu intră în nume de fișier / argumente).
  param([AllowNull()][object]$Numar)
  if ($null -eq $Numar) { return $false }
  return ([string]$Numar) -cmatch '\ATKT-(?:20[0-9]{2}-)?[0-9]{1,6}\z'
}

function Get-SerieTichet {
  # TKT-2026-0134 -> 134 (int, fără zerourile din față); TKT-0339 -> 339. Aruncă dacă numărul nu e valid.
  param([AllowNull()][string]$Numar)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  return [int]($Numar.Substring($Numar.LastIndexOf('-') + 1))
}

function Get-SlugTichet {
  # TKT-2026-0134 -> tkt_2026_0134; TKT-0339 -> tkt_0339 (nume de fișier / slug rdr / rvw). Aruncă dacă numărul nu e valid.
  param([AllowNull()][string]$Numar)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  return ('tkt_' + $Numar.Substring(4).Replace('-', '_'))
}

# O mențiune de tichet în titlu / branch: „tkt”/„tichet(e)” + un șir de numere (TKT-2026-0339/0340, tkt373, tichete-0325-0327).
$script:ReMentiune = '(?<![a-z0-9])(?:tkt|tichet(?:e|ul)?)[-_ #]?([0-9]{1,6}(?:[ ]*[-_/,&+][ ]*(?:tkt[-_]?)?[0-9]{1,6})*)(?![0-9])'

function Test-TichetAreUrmaGit {
  # True dacă vreun titlu de PR (orice stare) sau branch menționează tichetul, în oricare formă folosită în repo:
  # TKT-2026-0339, tkt-0339, tkt_0339, tkt339, TKT-2026-0339/0340, tichete-0325-0327. Se compară SERIA ca număr întreg.
  # Conservator: o potrivire în plus doar sare tichetul (apare în raport), o potrivire ratată ar dubla munca.
  # Graniță: TKT-033 nu prinde TKT-0339, XTKT-0339 nu prinde TKT-0339.
  param([string]$Numar, [string[]]$TitluriPr = @(), [string[]]$Branchuri = @())
  $serie = Get-SerieTichet $Numar
  foreach ($t in @($TitluriPr) + @($Branchuri)) {
    if ($null -eq $t) { continue }
    foreach ($m in [regex]::Matches(([string]$t).ToLowerInvariant(), $script:ReMentiune)) {
      foreach ($c in [regex]::Matches($m.Groups[1].Value, '[0-9]+')) { if ([int]$c.Value -eq $serie) { return $true } }
    }
  }
  return $false
}

function Get-CampResult {
  # Ieșirea rdr.ps1 / rvw.ps1 (paw-data\out\rdr_<slug>.json, rvw_<slug>.json): câmpul „result” (text). Altfel $null.
  param([AllowNull()][string]$Json)
  if ([string]::IsNullOrEmpty($Json) -or -not $Json.Trim()) { return $null }
  try { $o = ConvertFrom-Json -InputObject $Json } catch { return $null }
  if ($null -eq $o -or -not ($o -is [System.Management.Automation.PSCustomObject]) -or -not $o.PSObject.Properties['result']) { return $null }
  if ($null -eq $o.result -or -not ($o.result -is [string])) { return $null }
  return [string]$o.result
}

function Get-StarePaw {
  # Ultima linie a log-ului run_paw.cmd: PAW_GATA <id> / PAW_EROARE <id> <motiv>. „ocupat de alta rulare” = de reîncercat.
  # Se uită DOAR la ultima linie (CLAUDE.md pct. 11: conținutul poate conține cuvântul „ocupat”).
  param([AllowNull()][string]$UltimaLinie)
  $l = if ($null -eq $UltimaLinie) { '' } else { $UltimaLinie.Trim() }
  if ($l -cmatch '^PAW_GATA(\s|$)') { return 'GATA' }
  if ($l -cmatch '^PAW_EROARE\b.*ocupat de alta rulare') { return 'OCUPAT' }
  if ($l -cmatch '^PAW_EROARE(\s|$)') { return 'EROARE' }
  return 'NECUNOSCUT'
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
  # Din câmpul „result” al rdr_<slug>.json (NU din stdout: acolo poate fi ecoul brief-ului, care conține chiar formatul).
  # Se iau DOAR liniile care ÎNCEP cu „REZULTAT_TICHET:” (eventual între backtick-uri); contează ULTIMA.
  # O linie NELOCAL oriunde = nelocal (fail-closed). Ultima linie neparsabilă => NECUNOSCUT.
  param([AllowNull()][string]$Iesire)
  if ([string]::IsNullOrEmpty($Iesire)) { return @{ tip = 'NECUNOSCUT'; detaliu = 'iesire goala'; nelocal = $false } }
  $linii = @(($Iesire -split "\r?\n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -cmatch '^`?REZULTAT_TICHET:' })
  $nelocal = @($linii | Where-Object { $_ -cmatch '^`?REZULTAT_TICHET:[ \t]*NELOCAL\b' }).Count -gt 0
  if ($linii.Count -eq 0) { return @{ tip = 'NECUNOSCUT'; detaliu = 'fara linie REZULTAT_TICHET'; nelocal = $nelocal } }
  $m = [regex]::Match($linii[$linii.Count - 1], '\A`?REZULTAT_TICHET:[ \t]*(PR|NELOCAL|ESUAT)(?:[ \t]+([^`]*))?`?\z')
  if (-not $m.Success) { return @{ tip = 'NECUNOSCUT'; detaliu = 'linie REZULTAT_TICHET neclara'; nelocal = $nelocal } }
  return @{ tip = $m.Groups[1].Value; detaliu = (Get-TextSigurLinie $m.Groups[2].Value 200); nelocal = $nelocal }
}

function Get-VerdictReview {
  # Contract (sablon_review.md): blocul final, fiecare pe linie proprie: REZULTAT_REVIEW / VERDICT: <tok> / P0: <n> / P1: <n>.
  # Se ia DOAR ULTIMA linie care începe cu „VERDICT:”; token-ul = TOT restul liniei, care trebuie să fie exact unul dintre
  # GO | GO_CU_CONDITII | NO_GO (sau NO-GO). Orice ambiguitate => NECUNOSCUT (fail-closed: fără merge):
  # token cu text în plus („GO Nu, NO-GO”), fără linia REZULTAT_REVIEW înainte, mai multe VERDICT / P0 / P1 în blocul
  # final, P0 / P1 lipsă, înaintea verdictului sau ne-numerice.
  param([AllowNull()][string]$Iesire)
  $rez = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
  if ([string]::IsNullOrEmpty($Iesire)) { return $rez }
  $l = @(($Iesire -split "\r?\n") | ForEach-Object { $_.Trim() })
  $iv = -1
  for ($i = $l.Count - 1; $i -ge 0; $i--) { if ($l[$i].StartsWith('VERDICT:', [StringComparison]::Ordinal)) { $iv = $i; break } }
  if ($iv -lt 0) { return $rez }
  $ir = -1
  for ($i = $iv - 1; $i -ge 0; $i--) { if ($l[$i] -ceq 'REZULTAT_REVIEW') { $ir = $i; break } }
  if ($ir -lt 0) { return $rez }
  $bloc = @($l[($ir + 1)..($l.Count - 1)])
  if (@($bloc | Where-Object { $_ -cmatch '^VERDICT\s*:' }).Count -ne 1) { return $rez }
  $tok = $l[$iv].Substring(8).Trim().ToUpperInvariant()
  $v = switch -CaseSensitive ($tok) { 'GO' { 'GO' } 'GO_CU_CONDITII' { 'GO_CU_CONDITII' } 'GO_CU_CONDIȚII' { 'GO_CU_CONDITII' } 'NO_GO' { 'NO_GO' } 'NO-GO' { 'NO_GO' } default { $null } }
  if ($null -eq $v) { return $rez }
  $dupa = if ($iv -lt $l.Count - 1) { @($l[($iv + 1)..($l.Count - 1)]) } else { @() }
  $p = @{}
  foreach ($k in @('P0', 'P1')) {
    if (@($bloc | Where-Object { $_ -cmatch ('^' + $k + '\s*:') }).Count -ne 1) { return $rez }
    $lin = @($dupa | Where-Object { $_ -cmatch ('^' + $k + '\s*:') })
    if ($lin.Count -ne 1) { return $rez }
    $m = [regex]::Match($lin[0], ('\A' + $k + ':[ \t]*([0-9]{1,4})\z'))
    if (-not $m.Success) { return $rez }
    $p[$k] = [int]$m.Groups[1].Value
  }
  $rez.verdict = $v; $rez.p0 = $p['P0']; $rez.p1 = $p['P1']
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

function Get-CuvinteInterziseDiff {
  # Liniile MODIFICATE (+/-, fără antetele +++/---) care conțin un cuvânt din reguli.json (cuvinte_interzise_diff),
  # comparat fără diferență de majuscule. Ex.: SalariiPage (stă în src/App.jsx, nu are fișier propriu), service_role.
  param([AllowNull()][string]$Diff)
  $gasite = New-Object System.Collections.ArrayList
  if ([string]::IsNullOrEmpty($Diff)) { return @() }
  foreach ($l in ($Diff -split "`n")) {
    if (-not ($l.StartsWith('+') -or $l.StartsWith('-')) -or $l.StartsWith('+++') -or $l.StartsWith('---')) { continue }
    $ll = $l.ToLowerInvariant()
    foreach ($c in $script:CuvinteDiff) { if ($ll.Contains($c.ToLowerInvariant()) -and -not $gasite.Contains($c)) { [void]$gasite.Add($c) } }
  }
  return @($gasite)
}

function Test-DiffAreMarcajeRezultat {
  # Diff-ul nu are voie să conțină marcajele contractului de rezultat (ar putea „vota” în locul reviewer-ului):
  # REZULTAT_REVIEW / REZULTAT_TICHET / PAW_GATA / PAW_EROARE oriunde, sau o linie de cod care începe cu VERDICT: / P0: / P1:.
  param([AllowNull()][string]$Diff)
  if ([string]::IsNullOrEmpty($Diff)) { return $false }
  foreach ($mk in $script:MarcajeRezultat) { if ($Diff.Contains($mk)) { return $true } }
  foreach ($l in ($Diff -split "`n")) {
    if ($l.Length -gt 0 -and '+- '.Contains($l.Substring(0, 1)) -and $l.Substring(1).Trim() -cmatch '^(VERDICT|P0|P1)\s*:') { return $true }
  }
  return $false
}

function Get-RegiuneFunctie {
  # Liniile (1-based) ale unei funcții de nivel superior într-un fișier JS: de la „function <Nume>” / „const <Nume>” până
  # înainte de următoarea declarație de la coloana 0. $null dacă nu o găsește (apelantul tratează asta fail-closed).
  param([AllowNull()][string]$Text, [string]$Functie)
  if ([string]::IsNullOrEmpty($Text) -or $Functie -cnotmatch '\A[A-Za-z_][A-Za-z0-9_]*\z') { return $null }
  $l = $Text -split "\r?\n"
  $reStart = '^(export\s+)?(default\s+)?(async\s+)?(function\s+' + $Functie + '\b|const\s+' + $Functie + '\b)'
  $reDecl = '^(export\s+)?(default\s+)?(async\s+)?(function|const|let|var|class)\s'
  $s = -1
  for ($i = 0; $i -lt $l.Count; $i++) { if ($l[$i] -cmatch $reStart) { $s = $i; break } }
  if ($s -lt 0) { return $null }
  $e = $l.Count - 1
  for ($i = $s + 1; $i -lt $l.Count; $i++) { if ($l[$i] -cmatch $reDecl) { $e = $i - 1; break } }
  return @{ start = $s + 1; end = $e + 1 }
}

function Test-DiffAtingeRegiune {
  # True dacă un hunk din diff-ul fișierului $Fisier intersectează liniile [Start, End] din versiunea de pe main
  # (intervalul „-a,b” al hunk-ului) sau are funcția în antetul de context (@@ ... @@ function X).
  param([AllowNull()][string]$Diff, [string]$Fisier, [int]$Start, [int]$End, [string]$Functie = '')
  if ([string]::IsNullOrEmpty($Diff)) { return $false }
  $tinta = ($Fisier -replace '\\', '/').ToLowerInvariant()
  $inFisier = $false
  foreach ($l in ($Diff -split "`n")) {
    if ($l.StartsWith('diff --git ')) {
      $m = [regex]::Match($l, '^diff --git a/(.+?) b/(.+?)\s*$')
      $inFisier = $m.Success -and (($m.Groups[1].Value.ToLowerInvariant() -ceq $tinta) -or ($m.Groups[2].Value.ToLowerInvariant() -ceq $tinta))
      continue
    }
    if (-not $inFisier) { continue }
    $h = [regex]::Match($l, '^@@ -([0-9]+)(?:,([0-9]+))? \+[0-9]+(?:,[0-9]+)? @@(.*)$')
    if (-not $h.Success) { continue }
    $a = [int]$h.Groups[1].Value
    $b = if ($h.Groups[2].Success) { [int]$h.Groups[2].Value } else { 1 }
    if ($b -eq 0) { $lo = $a; $hi = $a + 1 } else { $lo = $a; $hi = $a + $b - 1 }
    if ($lo -le $End -and $hi -ge $Start) { return $true }
    if ($Functie -and $h.Groups[3].Value.Contains($Functie)) { return $true }
  }
  return $false
}

function Get-RegiuniInterziseAtinse {
  # Regiunile din reguli.json (regiuni_interzise: fișier + funcție, ex. src/App.jsx → SalariiPage) atinse de diff.
  # $Surse = @{ '<fisier>' = <conținutul de pe origin/main sau $null> }. Fișier atins + sursă / funcție negăsită => atinsă.
  param([AllowNull()][string]$Diff, [string[]]$Fisiere = @(), [hashtable]$Surse = @{})
  $atinse = New-Object System.Collections.ArrayList
  $fn = @($Fisiere | Where-Object { $_ } | ForEach-Object { ($_ -replace '\\', '/').ToLowerInvariant() })
  foreach ($r in $script:RegiuniInterzise) {
    $f = [string]$r.fisier; $fu = [string]$r.functie
    if ($fn -cnotcontains $f.ToLowerInvariant()) { continue }
    $src = if ($Surse.ContainsKey($f)) { $Surse[$f] } else { $null }
    $reg = Get-RegiuneFunctie -Text $src -Functie $fu
    if ($null -eq $reg -or (Test-DiffAtingeRegiune -Diff $Diff -Fisier $f -Start $reg.start -End $reg.end -Functie $fu)) { [void]$atinse.Add($f + ':' + $fu) }
  }
  return @($atinse)
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
    [bool]$HeadSchimbat = $false,
    [string[]]$RegiuniAtinse = @(),
    [bool]$BazaMain = $true,
    [bool]$Deschis = $true
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
  if (Test-DiffAreMarcajeRezultat $Diff) { [void]$motive.Add('diff-ul contine marcaje de rezultat (REZULTAT_* / PAW_* / VERDICT:)') }
  $cuv = @(Get-CuvinteInterziseDiff $Diff)
  if ($cuv.Count -gt 0) { [void]$motive.Add('diff-ul atinge cuvinte interzise: ' + ($cuv -join ', ')) }
  $reg = @($RegiuniAtinse | Where-Object { $_ })
  if ($reg.Count -gt 0) { [void]$motive.Add('atinge regiuni interzise: ' + ($reg -join ', ')) }
  if ($LiniiDiff -gt $MaxLiniiDiff) { [void]$motive.Add("diff prea mare pentru merge automat ($LiniiDiff > $MaxLiniiDiff linii)") }
  if ($CrossRepo) { [void]$motive.Add('PR din fork') }
  if ($HeadSchimbat) { [void]$motive.Add('head-ul PR-ului s-a schimbat dupa review') }
  if (-not $BazaMain) { [void]$motive.Add('PR-ul nu tinteste main (diff-ul revizuit e fata de main)') }
  if (-not $Deschis) { [void]$motive.Add('PR-ul nu mai e deschis') }
  return @{ merge = ($motive.Count -eq 0); motive = @($motive) }
}

function Get-RezumatVerdict {
  param([AllowNull()][hashtable]$V)
  if ($null -eq $V) { return 'lipsa' }
  return ('' + $V.verdict + ', P0=' + $V.p0 + ', P1=' + $V.p1)
}

Export-ModuleMember -Function Get-ReguliTichete, Test-NumarTichet, Get-SerieTichet, Get-SlugTichet, Test-TichetAreUrmaGit,
  Get-CampResult, Get-StarePaw, Select-TicheteNoi,
  Get-TextCurat, Get-TextSigurLinie, Get-EffortTichet, New-MarcajDate, New-BriefTichet, New-BriefReview, Get-RezultatAgent,
  Get-VerdictReview, Test-NumeBranch, Get-CaiInterziseAtinse, Test-DiffAreSecurityDefiner, Get-CuvinteInterziseDiff,
  Test-DiffAreMarcajeRezultat, Get-RegiuneFunctie, Test-DiffAtingeRegiune, Get-RegiuniInterziseAtinse, Test-ReviewTrece,
  Test-ChecksVerzi, Get-DecizieMerge, Get-RezumatVerdict
