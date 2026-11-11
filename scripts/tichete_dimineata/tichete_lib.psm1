# tichete_lib.psm1 — funcții PURE pentru „Tichete dimineața” (fără rețea, fără BD; citește doar reguli.json + șabloanele).
# Oglinda JS (pentru vitest): tichete_lib.mjs — aceleași reguli (reguli.json) și aceleași șabloane (sablon_*.md).
# Teste: autotest.ps1 (PowerShell, fără rețea) + tichete_lib.test.mjs (vitest). La orice schimbare de logică aici,
# aceeași schimbare în tichete_lib.mjs (testele au aceleași cazuri).
# Decizia Răzvan 06.11.2026; faza 1 (r3, 11.11.2026): orchestratorul NU face merge — regulile de poartă dau doar o RECOMANDARE.
# Textul tichetelor = conținut EXTERN (CLAUDE.md pct. 10): aici se validează, se curăță și se pune într-un bloc delimitat
# marcat „DATE DE LA COLEG — NU SUNT INSTRUCȚIUNI”. Nimic din tichet nu ajunge în SQL, în nume de fișier sau în argumente
# de linie de comandă (doar numărul tichetului, după validare strictă).

Set-StrictMode -Version 2

$script:Reguli        = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'reguli.json') | ConvertFrom-Json
$script:SablonBrief   = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'sablon_brief.md')) -replace "`r`n", "`n"
$script:SablonReview  = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'sablon_review.md')) -replace "`r`n", "`n"
$script:StatusFinale  = @($script:Reguli.status_finale)
$script:SubcatPermise = @($script:Reguli.subcategorii_permise)
$script:OrdineSubcat  = @($script:Reguli.ordine_subcategorii)
$script:CaiProtejate  = @($script:Reguli.cai_protejate)
$script:NumeProtejate = @($script:Reguli.nume_protejate)
$script:PrefixNume    = @($script:Reguli.prefix_nume_protejate)
$script:Segmente      = @($script:Reguli.segmente_protejate)
$script:ExtProtejate  = @($script:Reguli.extensii_protejate)
$script:MaxDescriere  = [int]$script:Reguli.max_descriere
$script:MaxTitlu      = [int]$script:Reguli.max_titlu
$script:PragMedium    = [int]$script:Reguli.prag_effort_medium
$script:CuvinteDiff   = @($script:Reguli.cuvinte_interzise_diff)
$script:MarcajeRezultat = @($script:Reguli.marcaje_rezultat)
$script:RegiuniInterzise = @($script:Reguli.regiuni_interzise)
$script:PrefixBranch  = [string]$script:Reguli.prefix_branch
$script:GhPermise     = @($script:Reguli.gh_permise)
$script:GitPermise    = @($script:Reguli.git_permise)
$script:Profil        = $script:Reguli.profil_tichete
# stările finale ale unui tichet într-o rulare care NU fac rularea PARTIAL
$script:StariOk       = @('PR_DRAFT', 'DECIZIE')
# rezultatele cunoscute ale agentului (consumă o încercare)
$script:StariConsuma  = @('PR_DRAFT', 'PR_FARA_REVIEW', 'DECIZIE', 'ESUAT')
# caractere de control (fără \n, \t) + bidi U+202A–U+202E, U+2066–U+2069 (construite din cod: editoarele le pot strica)
$script:ReControl     = '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F' + [char]0x202A + '-' + [char]0x202E + [char]0x2066 + '-' + [char]0x2069 + ']'

function Get-ReguliTichete { return $script:Reguli }

function Get-Camp {
  # proprietate dintr-un hashtable / PSCustomObject, $null dacă lipsește (StrictMode 2 aruncă altfel)
  param([AllowNull()][object]$O, [string]$Nume)
  if ($null -eq $O) { return $null }
  if ($O -is [System.Collections.IDictionary]) { if ($O.Contains($Nume)) { return $O[$Nume] } else { return $null } }
  $p = $O.PSObject.Properties[$Nume]
  if ($null -eq $p) { return $null }
  return $p.Value
}

# ── Număr, slug, branch ─────────────────────────────────────────────────────────────────────────────────────

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

function Get-AnTichet {
  # TKT-2026-0134 -> 2026; TKT-0339 -> 0 (format vechi, fără an). Aruncă dacă numărul nu e valid.
  param([AllowNull()][string]$Numar)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  $m = [regex]::Match($Numar, '\ATKT-(20[0-9]{2})-')
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return 0
}

function Test-SlugLansator {
  # Exact regula din rdr.ps1 / rvw.ps1: litere mici, cifre, cratimă (J2).
  param([AllowNull()][string]$Slug)
  if ($null -eq $Slug) { return $false }
  return $Slug -cmatch '\A[a-z0-9][a-z0-9-]{1,40}\z'
}

function Get-SlugTichet {
  # TKT-2026-0134 -> tkt-2026-0134; TKT-0339 -> tkt-0339 (slug rdr / rvw + nume de fișier). Aruncă dacă numărul nu e valid.
  param([AllowNull()][string]$Numar)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  $s = 'tkt-' + $Numar.Substring(4).ToLowerInvariant()
  if (-not (Test-SlugLansator $s)) { throw 'slug invalid' }
  return $s
}

function Get-BranchTichet {
  # Branch-ul EXACT pe care îl cere rularea (F7): tichete/tkt-2026-0134-i1 (i = numărul încercării, 1..99).
  param([AllowNull()][string]$Numar, [int]$Incercare)
  if ($Incercare -lt 1 -or $Incercare -gt 99) { throw 'incercare invalida' }
  return ($script:PrefixBranch + (Get-SlugTichet $Numar) + '-i' + $Incercare)
}

function Test-BranchPropriu {
  # True dacă branch-ul e unul al rulărilor pentru acest tichet (tichete/<slug>-i<n>).
  param([AllowNull()][string]$Numar, [AllowNull()][string]$Branch)
  if ([string]::IsNullOrEmpty($Branch)) { return $false }
  return $Branch -cmatch ('\A' + [regex]::Escape($script:PrefixBranch + (Get-SlugTichet $Numar)) + '-i[0-9]{1,2}\z')
}

# O mențiune de tichet în titlu / branch: „tkt”/„tichet(e)” + un șir de numere (TKT-2026-0339/0340, tkt373, tichete-0325-0327).
$script:ReMentiune = '(?<![a-z0-9])(?:tkt|tichet(?:e|ul)?)[-_ #]?([0-9]{1,6}(?:[ ]*[-_/,&+][ ]*(?:tkt[-_]?)?[0-9]{1,6})*)(?![0-9])'

function Test-TichetAreUrmaGit {
  # True dacă vreun titlu de PR (orice stare) sau branch menționează tichetul, în oricare formă folosită în repo:
  # TKT-2026-0339, tkt-0339, tkt_0339, tkt339, TKT-2026-0339/0340, tichete-0325-0327. Se compară SERIA ca număr întreg.
  # Anul (20xx urmat de alt număr) nu e serie: TKT-2026-2026 nu se potrivește cu „TKT-2026-0001”; anii diferiți nu se
  # potrivesc (TKT-2026-0001 ≠ TKT-2025-0001). Conservator: o potrivire în plus doar sare tichetul (apare în raport).
  param([string]$Numar, [string[]]$TitluriPr = @(), [string[]]$Branchuri = @())
  $serie = Get-SerieTichet $Numar
  $an = Get-AnTichet $Numar
  foreach ($t in @($TitluriPr) + @($Branchuri)) {
    if ($null -eq $t) { continue }
    foreach ($m in [regex]::Matches(([string]$t).ToLowerInvariant(), $script:ReMentiune)) {
      $nums = @([regex]::Matches($m.Groups[1].Value, '[0-9]+') | ForEach-Object { $_.Value })
      if ($nums.Count -ge 2 -and $nums[0] -cmatch '\A20[0-9]{2}\z') {
        if ($an -ne 0 -and [int]$nums[0] -ne $an) { continue }
        $nums = @($nums[1..($nums.Count - 1)])
      }
      foreach ($c in $nums) { if ([int]$c -eq $serie) { return $true } }
    }
  }
  return $false
}

# ── Ieșirile lansatoarelor (rdr / rvw / run_paw) ────────────────────────────────────────────────────────────

function Get-CampResult {
  # Ieșirea rdr.ps1 / rvw.ps1 (claude -p --output-format json, cu stderr amestecat): obiectul JSON de pe o linie proprie,
  # cu câmpul „result” text și fără is_error = true. Se ia ULTIMA linie care e un astfel de obiect. Altfel $null.
  param([AllowNull()][string]$Json)
  if ([string]::IsNullOrEmpty($Json) -or -not $Json.Trim()) { return $null }
  $linii = @($Json.TrimStart([char]0xFEFF) -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_.StartsWith('{') })
  for ($i = $linii.Count - 1; $i -ge 0; $i--) {
    try { $o = ConvertFrom-Json -InputObject $linii[$i] } catch { continue }
    if ($null -eq $o -or -not ($o -is [System.Management.Automation.PSCustomObject])) { continue }
    $r = Get-Camp $o 'result'
    if ($null -eq $r -or -not ($r -is [string])) { continue }
    if ((Get-Camp $o 'is_error') -eq $true) { return $null }
    return [string]$r
  }
  return $null
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

function Test-LansatorOcupat {
  # rdr.ps1 / rvw.ps1 cu toate locurile ocupate: exit 3 și ultima linie din stdout „RDR_OCUPAT: …” / „RVW_OCUPAT: …”.
  param([int]$Exit, [AllowNull()][string]$UltimaLinie, [ValidateSet('RDR', 'RVW')][string]$Cine)
  if ($Exit -ne 3 -or $null -eq $UltimaLinie) { return $false }
  return $UltimaLinie.Trim() -cmatch ('\A' + $Cine + '_OCUPAT:')
}

function Get-RaspunsJak {
  # Log-ul run_paw.cmd jak: linia 1 „PAW_START …”, apoi stdout-ul codex (DOAR răspunsul final), apoi „--- stderr ---” +
  # transcrierea (cu ecoul brief-ului), ultima linie „PAW_GATA …”. Răspunsul = între PAW_START și primul „--- stderr ---”
  # (sau PAW_GATA). Fără PAW_START la început / PAW_GATA la final => $null (fail-closed).
  param([AllowNull()][string]$Log)
  if ([string]::IsNullOrEmpty($Log)) { return $null }
  $l = @($Log.TrimStart([char]0xFEFF) -split "\r?\n")
  $ne = @(for ($i = 0; $i -lt $l.Count; $i++) { if ($l[$i].Trim() -ne '') { $i } })
  if ($ne.Count -lt 2) { return $null }
  if (-not $l[$ne[0]].StartsWith('PAW_START ', [StringComparison]::Ordinal)) { return $null }
  $iFin = $ne[$ne.Count - 1]
  if ((Get-StarePaw $l[$iFin]) -cne 'GATA') { return $null }
  $sf = $iFin
  for ($i = $ne[0] + 1; $i -lt $iFin; $i++) { if ($l[$i].Trim() -ceq '--- stderr ---') { $sf = $i; break } }
  if ($sf -le $ne[0] + 1) { return '' }
  return (@($l[($ne[0] + 1)..($sf - 1)]) -join "`n")
}

# ── Text ────────────────────────────────────────────────────────────────────────────────────────────────────

function Get-TextCurat {
  # Elimină caracterele de control (păstrează \n și \t) și caracterele bidi, normalizează CRLF, taie la $Max caractere.
  param([AllowNull()][object]$Text, [int]$Max = 8000)
  if ($null -eq $Text) { return '' }
  $s = ([string]$Text) -replace "`r`n", "`n" -replace "`r", "`n"
  $s = $s -replace $script:ReControl, ''
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

# ── Coada ───────────────────────────────────────────────────────────────────────────────────────────────────

function Sort-TicheteCoada {
  # 🐛 (eroare_erp) înaintea 💡 (cerere_functie), apoi cele mai vechi întâi (created_at ISO), apoi numărul.
  param([object[]]$Tichete = @())
  $lista = @($Tichete | Where-Object { $null -ne $_ })
  $chei = @(for ($i = 0; $i -lt $lista.Count; $i++) {
    $t = $lista[$i]
    $o = [array]::IndexOf($script:OrdineSubcat, [string](Get-Camp $t 'subcategorie')); if ($o -lt 0) { $o = 99 }
    [pscustomobject]@{ o = $o; c = [string](Get-Camp $t 'created_at'); n = [string](Get-Camp $t 'numar_tichet'); i = $i; t = $t }
  })
  $s = @($chei | Sort-Object -Property @{ Expression = 'o' }, @{ Expression = { $_.c }; }, @{ Expression = { $_.n } }, @{ Expression = 'i' } -CaseSensitive)
  return @($s | ForEach-Object { $_.t })
}

function Select-TicheteDeLucru {
  # Coada zilei (J9 / F8): filtrele „deja procesat” se aplică ÎNAINTE de plafon, pe toată lista ordonată.
  # $Stare = @{ '<numar>' = @{ incercari; ultima_data; ultimul_rezultat; clasa; asteapta_decizie; motiv; pr; branch; review_complet } }.
  # Întoarce @{ deLucru = @(@{ tichet; mod = 'nou'|'reluare_pr'|'review'; incercare; branch }); sarite = @(@{ numar; motiv }) }.
  param(
    [object[]]$Tichete = @(),
    [hashtable]$Stare = @{},
    [string[]]$TitluriPr = @(),
    [string[]]$Branchuri = @(),
    [string]$Azi = '',
    [int]$Max = 6,
    [int]$MaxIncercari = [int]$script:Reguli.max_incercari
  )
  $deLucru = New-Object System.Collections.ArrayList
  $sarite = New-Object System.Collections.ArrayList
  $vazute = @{}
  foreach ($t in @(Sort-TicheteCoada $Tichete)) {
    $nr = Get-Camp $t 'numar_tichet'
    if (-not (Test-NumarTichet $nr)) { [void]$sarite.Add(@{ numar = '(invalid)'; motiv = 'numar_tichet in format necunoscut' }); continue }
    if ($vazute.ContainsKey($nr)) { continue }
    $vazute[$nr] = $true
    if ($script:StatusFinale -ccontains [string](Get-Camp $t 'status')) { [void]$sarite.Add(@{ numar = $nr; motiv = 'status final ' + (Get-TextSigurLinie (Get-Camp $t 'status') 30) }); continue }
    if ($script:SubcatPermise -cnotcontains [string](Get-Camp $t 'subcategorie')) { [void]$sarite.Add(@{ numar = $nr; motiv = 'subcategorie nepermisa' }); continue }
    $e = if ($Stare.ContainsKey($nr)) { $Stare[$nr] } else { $null }
    $inc = [int](Get-Camp $e 'incercari')
    $pr = [int](Get-Camp $e 'pr')
    if ((Get-Camp $e 'asteapta_decizie') -eq $true) {
      [void]$sarite.Add(@{ numar = $nr; motiv = 'asteapta decizie (clasa ' + (Get-TextSigurLinie (Get-Camp $e 'clasa') 3) + '): ' + (Get-TextSigurLinie (Get-Camp $e 'motiv') 160) }); continue
    }
    $mod = 'nou'; $br = $null; $n = $inc + 1
    if ($pr -gt 0 -and (Get-Camp $e 'review_complet') -eq $true) { [void]$sarite.Add(@{ numar = $nr; motiv = 'are deja PR draft #' + $pr + ' (raportat)' }); continue }
    if ($pr -gt 0) {
      $br = [string](Get-Camp $e 'branch')
      if (-not (Test-BranchPropriu $nr $br)) { [void]$sarite.Add(@{ numar = $nr; motiv = 'stare locala nevalida (branch)' }); continue }
      $mod = 'review'; $n = $inc
    } else {
      if ($inc -ge $MaxIncercari) { [void]$sarite.Add(@{ numar = $nr; motiv = 'a atins numarul maxim de incercari (' + $MaxIncercari + ')' }); continue }
      if ($Azi -and [string](Get-Camp $e 'ultima_data') -ceq $Azi -and [string](Get-Camp $e 'ultimul_rezultat') -ceq 'ESUAT') {
        [void]$sarite.Add(@{ numar = $nr; motiv = 'esuat azi, se reia la urmatoarea zi lucratoare' }); continue
      }
      $br = Get-BranchTichet $nr $n
      if (@($Branchuri) -ccontains $br) { $mod = 'reluare_pr' }
      else {
        $straine = @($Branchuri | Where-Object { -not (Test-BranchPropriu $nr $_) })
        if (Test-TichetAreUrmaGit -Numar $nr -TitluriPr $TitluriPr -Branchuri $straine) { [void]$sarite.Add(@{ numar = $nr; motiv = 'are deja PR sau branch care mentioneaza tichetul' }); continue }
      }
    }
    if ($deLucru.Count -ge $Max) { [void]$sarite.Add(@{ numar = $nr; motiv = 'peste plafonul zilei (' + $Max + ')' }); continue }
    [void]$deLucru.Add(@{ tichet = $t; mod = $mod; incercare = $n; branch = $br })
  }
  return @{ deLucru = @($deLucru); sarite = @($sarite) }
}

function Test-ListaCompleta {
  # gh pr list --limit N: lista e completă doar dacă a întors MAI PUȚIN de N (altfel poate fi tăiată => EROARE).
  param([int]$Numar, [int]$Limita)
  return ($Limita -gt 0 -and $Numar -ge 0 -and $Numar -lt $Limita)
}

function Get-EffortTichet {
  # medium pentru o 💡 simplă (cerere_functie, descriere scurtă); high implicit.
  param([object]$Tichet)
  $d = Get-TextCurat (Get-Camp $Tichet 'descriere') 100000
  if ([string](Get-Camp $Tichet 'subcategorie') -ceq 'cerere_functie' -and $d.Length -le $script:PragMedium) { return 'medium' }
  return 'high'
}

# ── Brief-uri ───────────────────────────────────────────────────────────────────────────────────────────────

function New-MarcajDate {
  # Delimitator aleator (96 biți) pentru blocul de date: textul tichetului nu-l poate ghici ca să „iasă” din bloc.
  return ('DATE_COLEG_' + ([guid]::NewGuid().ToString('N').Substring(0, 12)) + ([guid]::NewGuid().ToString('N').Substring(0, 12)))
}

function New-BriefTichet {
  # Brief din ȘABLON FIX (sablon_brief.md). Doar numărul (validat), branch-ul (calculat) și subcategoria (din listă fixă)
  # ies din blocul de date.
  param([object]$Tichet, [string]$Branch, [string]$Marcaj = $(New-MarcajDate))
  $nr = [string](Get-Camp $Tichet 'numar_tichet')
  if (-not (Test-NumarTichet $nr)) { throw 'numar_tichet invalid' }
  $sub = [string](Get-Camp $Tichet 'subcategorie')
  if ($script:SubcatPermise -cnotcontains $sub) { throw 'subcategorie nepermisa' }
  if ($Marcaj -cnotmatch '\ADATE_COLEG_[0-9a-f]{8,64}\z') { throw 'marcaj invalid' }
  if (-not (Test-BranchPropriu $nr $Branch)) { throw 'branch invalid' }
  $tip = if ($sub -ceq 'cerere_functie') { 'cerere de îmbunătățire (💡)' } else { 'eroare raportată (🐛)' }

  $campuri = [ordered]@{
    'titlu'       = Get-TextCurat (Get-Camp $Tichet 'titlu') $script:MaxTitlu
    'status'      = Get-TextCurat (Get-Camp $Tichet 'status') 40
    'creat_la'    = Get-TextCurat (Get-Camp $Tichet 'created_at') 40
    'departament' = Get-TextCurat (Get-Camp $Tichet 'departament') 40
    'pagina'      = Get-TextCurat (Get-Camp $Tichet 'entitate_descriere') 300
    'descriere'   = Get-TextCurat (Get-Camp $Tichet 'descriere') $script:MaxDescriere
  }
  $date = ''
  foreach ($k in $campuri.Keys) {
    $v = ([string]$campuri[$k]).Replace($Marcaj, '[marcaj eliminat]')
    $date += $k + ': ' + $v + "`n"
  }
  # Înlocuirile pe șablon întâi; __DATE__ ultimul, ca textul tichetului să nu fie re-procesat ca șablon.
  $r = $script:SablonBrief.Replace('__BRANCH__', $Branch).Replace('__NR__', $nr).Replace('__TIP__', $tip).Replace('__SUB__', $sub).Replace('__MARCAJ__', $Marcaj)
  return $r.Replace('__DATE__', $date)
}

function New-BriefReview {
  # Brief de review din ȘABLON FIX (sablon_review.md); diff-ul = date (scris de agent, indirect din conținut extern).
  param([string]$Numar, [int]$Pr, [string]$Branch, [string]$Sha, [AllowNull()][string]$Diff, [string]$Marcaj = $(New-MarcajDate), [int]$MaxDiff = 200000)
  if (-not (Test-NumarTichet $Numar)) { throw 'numar_tichet invalid' }
  if (-not (Test-NumeBranch $Branch)) { throw 'branch invalid' }
  if ($Sha -cnotmatch '\A[0-9a-f]{40}\z') { throw 'sha invalid' }
  if ($Marcaj -cnotmatch '\ADATE_COLEG_[0-9a-f]{8,64}\z') { throw 'marcaj invalid' }
  $d = if ($null -eq $Diff) { '' } else { $Diff -replace "`r`n", "`n" }
  if ($d.Length -gt $MaxDiff) { $d = $d.Substring(0, $MaxDiff) + "`n[... diff taiat ...]" }
  $d = $d.Replace($Marcaj, '[marcaj eliminat]')
  $r = $script:SablonReview.Replace('__NR__', $Numar).Replace('__PR__', [string]$Pr).Replace('__BRANCH__', $Branch).Replace('__SHA__', $Sha).Replace('__MARCAJ__', $Marcaj)
  return $r.Replace('__DIFF__', $d)
}

# ── Rezultatul agentului și verdictele ──────────────────────────────────────────────────────────────────────

function Get-RezultatAgent {
  # Din câmpul „result” al rdr_<slug>.json. Contează DOAR ULTIMA linie nevidă (F11: un exemplu citat mai sus nu contează),
  # eventual între backtick-uri:
  #   REZULTAT_TICHET: L PR <url github .../pull/<n>>   => tip PR
  #   REZULTAT_TICHET: L ESUAT <motiv>                    => tip ESUAT
  #   REZULTAT_TICHET: B|D|F|? <ce trebuie decis>         => tip DECIZIE
  # Orice altceva => NECUNOSCUT. Întoarce @{ tip; clasa; detaliu; pr }.
  param([AllowNull()][string]$Iesire)
  $nec = @{ tip = 'NECUNOSCUT'; clasa = ''; detaliu = ''; pr = 0 }
  if ([string]::IsNullOrEmpty($Iesire)) { $nec.detaliu = 'iesire goala'; return $nec }
  $l = @(($Iesire -split "\r?\n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  if ($l.Count -eq 0) { $nec.detaliu = 'iesire goala'; return $nec }
  $m = [regex]::Match($l[$l.Count - 1], '\A`?REZULTAT_TICHET:[ \t]+(?:(L)[ \t]+(PR|ESUAT)|(B|D|F|\?))[ \t]+([^`]*[^`\s])`?\z')
  if (-not $m.Success) { $nec.detaliu = 'ultima linie nu e REZULTAT_TICHET in formatul cerut'; return $nec }
  $det = $m.Groups[4].Value
  if ($m.Groups[1].Success) {
    if ($m.Groups[2].Value -ceq 'PR') {
      $u = [regex]::Match($det, '\Ahttps://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/([0-9]{1,7})\z')
      if (-not $u.Success) { $nec.detaliu = 'PR fara URL valid'; return $nec }
      return @{ tip = 'PR'; clasa = 'L'; detaliu = (Get-TextSigurLinie $det 200); pr = [int]$u.Groups[1].Value }
    }
    return @{ tip = 'ESUAT'; clasa = 'L'; detaliu = (Get-TextSigurLinie $det 200); pr = 0 }
  }
  return @{ tip = 'DECIZIE'; clasa = $m.Groups[3].Value; detaliu = (Get-TextSigurLinie $det 300); pr = 0 }
}

function Get-VerdictReview {
  # Contractul UNIC (J3 / F2) — același pentru Jakarinos și Fable și compatibil cu ce cere rvw.ps1 („Ultima linie exact:
  # VERDICT: GO | GO cu conditii | NO-GO (+P0/P1/P2)”). Blocul final, fiecare pe linie proprie, linia VERDICT ULTIMA:
  #   REZULTAT_REVIEW / P0: <n> / P1: <n> / [P2: <n>] / VERDICT: GO | GO cu conditii | NO-GO [(P1/P2)]
  # Token-uri acceptate (fără deosebire de majuscule, ț = t): GO, GO cu conditii, GO_CU_CONDITII, NO-GO, NO_GO; opțional
  # o paranteză cu niveluri (P0/P1/P2, cu „+”, „/” sau „,”). Orice altceva => NECUNOSCUT: text în plus după VERDICT,
  # alte linii în bloc, P-uri lipsă / dublate / ne-numerice, paranteza care numește P0 / P1 când numărul lor e 0, GO cu P0/P1 > 0.
  param([AllowNull()][string]$Iesire)
  $rez = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
  if ([string]::IsNullOrEmpty($Iesire)) { return $rez }
  $l = @(($Iesire -split "\r?\n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  if ($l.Count -lt 4) { return $rez }
  $iv = $l.Count - 1
  if (-not $l[$iv].StartsWith('VERDICT:', [StringComparison]::Ordinal)) { return $rez }
  $ir = -1
  for ($i = $iv - 1; $i -ge 0; $i--) { if ($l[$i] -ceq 'REZULTAT_REVIEW') { $ir = $i; break } }
  if ($ir -lt 0) { return $rez }
  $bloc = @(if ($iv - 1 -ge $ir + 1) { $l[($ir + 1)..($iv - 1)] })
  if ($bloc.Count -lt 2 -or $bloc.Count -gt 3) { return $rez }
  $p = @{}
  $chei = @('P0', 'P1', 'P2')
  for ($i = 0; $i -lt $bloc.Count; $i++) {
    $m = [regex]::Match($bloc[$i], ('\A' + $chei[$i] + ':[ \t]*([0-9]{1,4})\z'))
    if (-not $m.Success) { return $rez }
    $p[$chei[$i]] = [int]$m.Groups[1].Value
  }
  $tok = $l[$iv].Substring(8).Trim().ToUpperInvariant().Replace([string][char]0x021A, 'T').Replace([string][char]0x0162, 'T')
  $m = [regex]::Match($tok, '\A(GO|GO[ _]CU[ _]CONDITII|NO[-_]GO)(?:[ \t]*\((\+?P[0-2](?:[ \t]*[/,+][ \t]*\+?P[0-2])*)\))?\z')
  if (-not $m.Success) { return $rez }
  $v = switch -Regex ($m.Groups[1].Value) { '\AGO\z' { 'GO' } '\AGO[ _]' { 'GO_CU_CONDITII' } default { 'NO_GO' } }
  if ($m.Groups[2].Success) {
    foreach ($nv in @([regex]::Matches($m.Groups[2].Value, 'P[0-2]') | ForEach-Object { $_.Value })) {
      if ($p.ContainsKey($nv) -and $p[$nv] -eq 0) { return $rez }
    }
  }
  if ($v -ceq 'GO' -and ($p['P0'] -gt 0 -or $p['P1'] -gt 0)) { return $rez }
  $rez.verdict = $v; $rez.p0 = $p['P0']; $rez.p1 = $p['P1']
  return $rez
}

function Test-NumeBranch {
  # Branch-ul vine de la agent / GitHub (indirect, din conținut extern) => validare strictă înainte de git / argumente.
  param([AllowNull()][string]$Nume)
  if ([string]::IsNullOrEmpty($Nume)) { return $false }
  if ($Nume.Length -gt 120) { return $false }
  if ($Nume -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9._/-]*\z') { return $false }
  if ($Nume.Contains('..') -or $Nume.Contains('//') -or $Nume.EndsWith('/') -or $Nume.EndsWith('.lock') -or $Nume.EndsWith('.')) { return $false }
  if ($Nume -ieq 'main' -or $Nume -ieq 'HEAD') { return $false }
  return $true
}

function Select-PrTichet {
  # F7: PR-ul rulării = cel de pe branch-ul EXACT creat de rulare, deschis, draft, baza main, din același repo, cu autorul
  # identității gh de pe server. Fără fallback pe „menționează tichetul”. $Prs = ieșirea gh pr list --head <branch> --state all
  # --json number,headRefName,headRefOid,isDraft,baseRefName,state,author,isCrossRepository.
  # Întoarce @{ pr = <obiect sau $null>; eroare = '' }.
  param([object[]]$Prs = @(), [string]$Branch, [string]$Autor)
  $pe = @($Prs | Where-Object { $null -ne $_ -and [string](Get-Camp $_ 'headRefName') -ceq $Branch })
  if ($pe.Count -eq 0) { return @{ pr = $null; eroare = '' } }
  if ($pe.Count -gt 1) { return @{ pr = $null; eroare = 'mai multe PR-uri pe branch-ul ' + $Branch } }
  $x = $pe[0]
  $mot = New-Object System.Collections.ArrayList
  if ([string](Get-Camp $x 'state') -cne 'OPEN') { [void]$mot.Add('PR-ul nu e deschis') }
  if ((Get-Camp $x 'isDraft') -ne $true) { [void]$mot.Add('PR-ul nu e draft') }
  if ([string](Get-Camp $x 'baseRefName') -cne 'main') { [void]$mot.Add('PR-ul nu tinteste main') }
  if ((Get-Camp $x 'isCrossRepository') -ne $false) { [void]$mot.Add('PR din fork') }
  if ([string](Get-Camp (Get-Camp $x 'author') 'login') -cne $Autor -or [string]::IsNullOrEmpty($Autor)) { [void]$mot.Add('autor neasteptat') }
  if ([string](Get-Camp $x 'headRefOid') -cnotmatch '\A[0-9a-f]{40}\z') { [void]$mot.Add('sha invalid') }
  if ([int](Get-Camp $x 'number') -le 0) { [void]$mot.Add('numar PR invalid') }
  if ($mot.Count -gt 0) { return @{ pr = $null; eroare = (@($mot) -join '; ') } }
  return @{ pr = $x; eroare = '' }
}

# ── Inventarul căilor (J5) și căile protejate (F3) ──────────────────────────────────────────────────────────

function Get-CaiNameStatusZ {
  # git diff --name-status -z --no-renames: „<status>\0<cale>\0…” (căile brute, necitate). Format neașteptat => aruncă.
  param([AllowNull()][string]$Iesire)
  if ([string]::IsNullOrEmpty($Iesire)) { return @() }
  $t = @($Iesire.Split([char]0))
  if ($t[$t.Count - 1] -ne '') { throw 'name-status -z: lipseste terminatorul NUL' }
  $t = @(if ($t.Count -gt 1) { $t[0..($t.Count - 2)] })
  if ($t.Count % 2 -ne 0) { throw 'name-status -z: numar impar de campuri' }
  $cai = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $t.Count; $i += 2) {
    if ($t[$i] -cnotmatch '\A[ADMTUXB]\z') { throw ('name-status -z: status neasteptat') }
    if ($t[$i + 1] -eq '') { throw 'name-status -z: cale goala' }
    [void]$cai.Add($t[$i + 1])
  }
  return @($cai)
}

function Get-LiniiNumstatZ {
  # git diff --numstat -z --no-renames: „<adăugate>\t<șterse>\t<cale>\0…”; fișier binar („-”) => peste plafon. Format greșit => aruncă.
  param([AllowNull()][string]$Iesire, [int]$MaxLinii)
  if ([string]::IsNullOrEmpty($Iesire)) { return 0 }
  $t = @($Iesire.Split([char]0))
  if ($t[$t.Count - 1] -ne '') { throw 'numstat -z: lipseste terminatorul NUL' }
  $s = 0
  for ($i = 0; $i -lt $t.Count - 1; $i++) {
    $m = [regex]::Match($t[$i], '\A(?:\n)?([0-9]+|-)\t([0-9]+|-)\t(.+)\z', 'Singleline')
    if (-not $m.Success) { throw 'numstat -z: inregistrare neasteptata' }
    if ($m.Groups[1].Value -eq '-' -or $m.Groups[2].Value -eq '-') { $s += $MaxLinii + 1 }
    else { $s += [int]$m.Groups[1].Value + [int]$m.Groups[2].Value }
  }
  return $s
}

function Get-CaleNormalizata {
  # lowercase, '/', fără '/' la început, fără puncte / spații la finalul segmentelor (Windows le ignoră la checkout).
  param([AllowNull()][string]$Cale)
  if ($null -eq $Cale) { return '' }
  $n = ($Cale -replace '\\', '/').TrimStart('/').ToLowerInvariant()
  return ((@($n -split '/') | ForEach-Object { $_.TrimEnd('.', ' ') }) -join '/')
}

function Get-CaiProtejateAtinse {
  # F3: prefixe (cai_protejate), nume oriunde în arbore (nume_protejate, prefix_nume_protejate — ex. .env*), segmente
  # (.claude, .github, .husky, .githooks, .git, .vscode) și extensii (.sql, .ps1, .psm1, .cmd, .bat, .sh).
  param([string[]]$Fisiere = @())
  $atinse = New-Object System.Collections.ArrayList
  foreach ($f in @($Fisiere)) {
    if ([string]::IsNullOrEmpty($f)) { continue }
    $n = Get-CaleNormalizata $f
    $seg = @($n -split '/')
    $baza = $seg[$seg.Count - 1]
    $bad = $false
    foreach ($p in $script:CaiProtejate) { if ($n.StartsWith($p)) { $bad = $true } }
    if ($script:NumeProtejate -ccontains $baza) { $bad = $true }
    foreach ($p in $script:PrefixNume) { if ($baza.StartsWith($p)) { $bad = $true } }
    foreach ($s in $seg) { if ($script:Segmente -ccontains $s) { $bad = $true } }
    foreach ($e in $script:ExtProtejate) { if ($n.EndsWith($e)) { $bad = $true } }
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
  # REZULTAT_REVIEW / REZULTAT_TICHET / PAW_GATA / PAW_EROARE oriunde, sau o linie de cod care începe cu VERDICT: / P0: / P1: / P2:.
  param([AllowNull()][string]$Diff)
  if ([string]::IsNullOrEmpty($Diff)) { return $false }
  foreach ($mk in $script:MarcajeRezultat) { if ($Diff.Contains($mk)) { return $true } }
  foreach ($l in ($Diff -split "`n")) {
    if ($l.Length -gt 0 -and '+- '.Contains($l.Substring(0, 1)) -and $l.Substring(1).Trim() -cmatch '^(VERDICT|P0|P1|P2)\s*:') { return $true }
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
  $fn = @($Fisiere | Where-Object { $_ } | ForEach-Object { Get-CaleNormalizata $_ })
  foreach ($r in $script:RegiuniInterzise) {
    $f = [string]$r.fisier; $fu = [string]$r.functie
    if ($fn -cnotcontains $f.ToLowerInvariant()) { continue }
    $src = if ($Surse.ContainsKey($f)) { $Surse[$f] } else { $null }
    $reg = Get-RegiuneFunctie -Text $src -Functie $fu
    if ($null -eq $reg -or (Test-DiffAtingeRegiune -Diff $Diff -Fisier $f -Start $reg.start -End $reg.end -Functie $fu)) { [void]$atinse.Add($f + ':' + $fu) }
  }
  return @($atinse)
}

# ── Recomandarea de merge (faza 1: doar text în raport) ─────────────────────────────────────────────────────

function Test-ReviewTrece {
  param([AllowNull()][hashtable]$V)
  if ($null -eq $V) { return $false }
  return (($V.verdict -ceq 'GO' -or $V.verdict -ceq 'GO_CU_CONDITII') -and $V.p0 -eq 0 -and $V.p1 -eq 0)
}

function Test-ChecksVerzi {
  # gh pr checks --json name,bucket: cel puțin un check „pass” (J6: doar „skipping” = niciun test rulat = NU), restul pass/skipping.
  param([object[]]$Checks = @())
  $c = @($Checks | Where-Object { $null -ne $_ })
  if ($c.Count -eq 0) { return $false }
  if (@($c | Where-Object { [string](Get-Camp $_ 'bucket') -ceq 'pass' }).Count -eq 0) { return $false }
  foreach ($x in $c) { if (@('pass', 'skipping') -cnotcontains [string](Get-Camp $x 'bucket')) { return $false } }
  return $true
}

function Get-StareChecks {
  # F10: ieșirea gh pr checks --json name,bucket => @{ stare = ok|pending|gol|eroare; checks; eroare }.
  # exit 0 = rezultat; 8 = încă rulează (cod documentat gh); „no checks reported” = încă niciun check; orice alt cod => eroare.
  param([int]$Exit, [AllowNull()][string]$Out, [AllowNull()][string]$Err)
  $parse = {
    param($s)
    if ([string]::IsNullOrEmpty($s) -or -not $s.Trim()) { return $null }
    try { $o = ConvertFrom-Json -InputObject $s } catch { return $null }
    if ($null -eq $o) { return $null }
    $a = @($o | ForEach-Object { $_ } | Where-Object { $null -ne $_ })
    return @{ v = $a }
  }
  if ($Exit -eq 0) {
    $p = & $parse $Out
    if ($null -eq $p) { return @{ stare = 'eroare'; checks = @(); eroare = 'gh pr checks: JSON necitit' } }
    if (@($p.v).Count -eq 0) { return @{ stare = 'gol'; checks = @(); eroare = '' } }
    $st = if (@($p.v | Where-Object { [string](Get-Camp $_ 'bucket') -ceq 'pending' }).Count -gt 0) { 'pending' } else { 'ok' }
    return @{ stare = $st; checks = @($p.v); eroare = '' }
  }
  if ($Exit -eq 8) {
    $p = & $parse $Out
    return @{ stare = 'pending'; checks = $(if ($null -ne $p) { @($p.v) } else { @() }); eroare = '' }
  }
  if ($null -ne $Err -and $Err -cmatch 'no checks reported') { return @{ stare = 'gol'; checks = @(); eroare = '' } }
  return @{ stare = 'eroare'; checks = @(); eroare = ('gh pr checks exit ' + $Exit + ': ' + (Get-TextSigurLinie $Err 160)) }
}

function Get-RecomandareMerge {
  # Faza 1: NU se face merge. Întoarce @{ indeplineste = bool; motive = @() } pentru raport („îndeplinește condițiile de
  # merge: da / nu, de ce”). Merge-ul îl decide sesiunea de coordonare (review GO + CI verde), nu acest proces.
  param(
    [AllowNull()][hashtable]$Jak,
    [AllowNull()][hashtable]$Fable,
    [object[]]$Checks = @(),
    [string]$Clasa = 'L',
    [string[]]$Fisiere = @(),
    [AllowNull()][string]$Diff = '',
    [int]$LiniiDiff = 0,
    [int]$MaxLiniiDiff = $script:Reguli.max_linii_diff,
    [bool]$CrossRepo = $false,
    [bool]$HeadSchimbat = $false,
    [string[]]$RegiuniAtinse = @(),
    [bool]$BazaMain = $true,
    [bool]$Deschis = $true,
    [bool]$Draft = $true
  )
  $motive = New-Object System.Collections.ArrayList
  if (-not (Test-ReviewTrece $Jak))   { [void]$motive.Add('review Jakarinos nu e GO fara P0/P1 (' + (Get-RezumatVerdict $Jak) + ')') }
  if (-not (Test-ReviewTrece $Fable)) { [void]$motive.Add('review Fable nu e GO fara P0/P1 (' + (Get-RezumatVerdict $Fable) + ')') }
  if (-not (Test-ChecksVerzi $Checks)) { [void]$motive.Add('CI nu e verde (niciun check trecut, check-uri picate sau inca in curs)') }
  if ($Clasa -cne 'L') { [void]$motive.Add('agentul nu a clasat tichetul ca local (clasa ' + $Clasa + ')') }
  if (@($Fisiere | Where-Object { $_ }).Count -eq 0) { [void]$motive.Add('PR fara fisiere modificate') }
  $atinse = @(Get-CaiProtejateAtinse $Fisiere)
  if ($atinse.Count -gt 0) { [void]$motive.Add('atinge ' + ((@($atinse | Select-Object -First 5) | ForEach-Object { Get-TextSigurLinie $_ 120 }) -join ', ')) }
  if (Test-DiffAreSecurityDefiner $Diff) { [void]$motive.Add('diff-ul adauga SECURITY DEFINER') }
  if (Test-DiffAreMarcajeRezultat $Diff) { [void]$motive.Add('diff-ul contine marcaje de rezultat (REZULTAT_* / PAW_* / VERDICT:)') }
  $cuv = @(Get-CuvinteInterziseDiff $Diff)
  if ($cuv.Count -gt 0) { [void]$motive.Add('diff-ul atinge cuvinte interzise: ' + ($cuv -join ', ')) }
  $reg = @($RegiuniAtinse | Where-Object { $_ })
  if ($reg.Count -gt 0) { [void]$motive.Add('atinge regiuni interzise: ' + ($reg -join ', ')) }
  if ($LiniiDiff -gt $MaxLiniiDiff) { [void]$motive.Add("diff prea mare ($LiniiDiff > $MaxLiniiDiff linii)") }
  if ($CrossRepo) { [void]$motive.Add('PR din fork') }
  if ($HeadSchimbat) { [void]$motive.Add('head-ul PR-ului s-a schimbat dupa review') }
  if (-not $BazaMain) { [void]$motive.Add('PR-ul nu tinteste main') }
  if (-not $Deschis) { [void]$motive.Add('PR-ul nu mai e deschis') }
  if (-not $Draft) { [void]$motive.Add('PR-ul nu mai e draft (scos din draft de altcineva)') }
  return @{ indeplineste = ($motive.Count -eq 0); motive = @($motive) }
}

function Get-RezumatVerdict {
  param([AllowNull()][hashtable]$V)
  if ($null -eq $V) { return 'lipsa' }
  return ('' + $V.verdict + ', P0=' + $V.p0 + ', P1=' + $V.p1)
}

# ── Gărzi pe comenzile orchestratorului (J1, defense in depth) ─────────────────────────────────────────────

function Test-ComandaGhPermisa {
  # Orchestratorul folosește doar citiri gh: auth status, api user (exact „api user --jq .login”), pr list / view / checks.
  # Fără merge / ready / api de scriere / workflow / release / secret.
  param([string[]]$Argv = @())
  $a = @($Argv)
  if ($a.Count -lt 2) { return $false }
  if ($script:GhPermise -cnotcontains ($a[0] + ' ' + $a[1])) { return $false }
  if ($a[0] -ceq 'api') { return (($a -join ' ') -ceq 'api user --jq .login') }
  foreach ($x in $a) { if ($x -cmatch '\A(-X|--method|--input|--web)\b') { return $false } }
  return $true
}

function Test-ComandaGitPermisa {
  # Doar citiri git în clona orchestratorului: fetch, ls-remote, diff, rev-parse, show; fără opțiuni care execută programe.
  param([string[]]$Argv = @())
  $a = @($Argv)
  if ($a.Count -lt 1 -or $script:GitPermise -cnotcontains $a[0]) { return $false }
  foreach ($x in $a) { if ($x -cmatch '\A--(upload-pack|receive-pack|exec|ext-diff)\b' -or $x -ceq '-c') { return $false } }
  return $true
}

# ── Profilul „tichete” al lansatorului rdr.ps1 (J1) ─────────────────────────────────────────────────────────

function Get-ListaPs {
  # Lista PowerShell „$Nume = @('a', 'b', …)” dintr-un text (doar șiruri între apostrofuri, separate de virgule / spații /
  # linii noi / backtick, comentarii „#” până la final de linie). Altă formă (variabile, ghilimele, '' în șir) => $null.
  param([AllowNull()][string]$Text, [string]$Nume)
  if ([string]::IsNullOrEmpty($Text) -or $Nume -cnotmatch '\A[A-Za-z_][A-Za-z0-9_]*\z') { return $null }
  $re = '\$' + $Nume + '(?![A-Za-z0-9_])[ \t]*=[ \t]*@\('
  $ms = [regex]::Matches($Text, $re)
  if ($ms.Count -ne 1) { return $null }
  $i = $ms[0].Index + $ms[0].Length
  $lista = New-Object System.Collections.ArrayList
  while ($i -lt $Text.Length) {
    $c = $Text[$i]
    if ($c -eq ')') { return @{ v = @($lista) } }
    if (" `t`r`n,``".Contains([string]$c)) { $i++; continue }
    if ($c -eq '#') { while ($i -lt $Text.Length -and $Text[$i] -ne "`n") { $i++ }; continue }
    if ($c -eq "'") {
      $j = $Text.IndexOf("'", $i + 1)
      if ($j -lt 0) { return $null }
      if ($j + 1 -lt $Text.Length -and $Text[$j + 1] -eq "'") { return $null }
      [void]$lista.Add($Text.Substring($i + 1, $j - $i - 1)); $i = $j + 1; continue
    }
    return $null
  }
  return $null
}

function Test-LansatorProfilTichete {
  # Garda de la start (fail-closed): rdr.ps1 are -Profil cu 'tichete' în ValidateSet și blocul PROFIL_TICHETE cu
  # $TichetePermise (fără forme largi și fără refuzuri), $TicheteRefuzate (toate refuzurile obligatorii) și
  # $TicheteAdaugaDir = @() (gol). Întoarce @{ ok = bool; motive = @() }. Nu e un sandbox: e o verificare a contractului.
  param([AllowNull()][string]$Text)
  $mot = New-Object System.Collections.ArrayList
  if ([string]::IsNullOrEmpty($Text)) { return @{ ok = $false; motive = @('lansatorul lipseste sau e gol') } }
  $t = $Text -replace "`r`n", "`n"
  $vs = [regex]::Match($t, '\[ValidateSet\(([^)]*)\)\][ \t]*\[string\][ \t]*\$Profil(?![A-Za-z0-9_])')
  if (-not $vs.Success -or -not ($vs.Groups[1].Value -cmatch "'tichete'")) { [void]$mot.Add('lipseste parametrul -Profil cu valoarea tichete') }
  $p = $script:Profil
  $i0 = $t.IndexOf([string]$p.marcaj_start, [StringComparison]::Ordinal)
  $i1 = $t.IndexOf([string]$p.marcaj_sfarsit, [StringComparison]::Ordinal)
  $n0 = ([regex]::Matches($t, [regex]::Escape([string]$p.marcaj_start))).Count
  $n1 = ([regex]::Matches($t, [regex]::Escape([string]$p.marcaj_sfarsit))).Count
  if ($i0 -lt 0 -or $i1 -le $i0 -or $n0 -ne 1 -or $n1 -ne 1) { [void]$mot.Add('lipseste blocul PROFIL_TICHETE (o singura data, inceput inainte de sfarsit)'); return @{ ok = $false; motive = @($mot) } }
  $bloc = $t.Substring($i0, $i1 - $i0)
  foreach ($z in @($p.interzise_in_bloc)) { if ($bloc.IndexOf([string]$z, [StringComparison]::OrdinalIgnoreCase) -ge 0) { [void]$mot.Add('blocul contine ' + $z) } }
  $perm = Get-ListaPs $bloc 'TichetePermise'
  $refz = Get-ListaPs $bloc 'TicheteRefuzate'
  $dirs = Get-ListaPs $bloc 'TicheteAdaugaDir'
  if ($null -eq $perm) { [void]$mot.Add('$TichetePermise lipseste sau nu e o lista simpla') }
  if ($null -eq $refz) { [void]$mot.Add('$TicheteRefuzate lipseste sau nu e o lista simpla') }
  if ($null -eq $dirs) { [void]$mot.Add('$TicheteAdaugaDir lipseste sau nu e o lista simpla') }
  elseif (@($dirs.v).Count -ne 0) { [void]$mot.Add('$TicheteAdaugaDir trebuie sa fie gol') }
  $norm = { param($s) (([string]$s) -replace '\s+', ' ').Trim().ToLowerInvariant() }
  if ($null -ne $refz) {
    $rz = @($refz.v)
    foreach ($o in @($p.refuzuri_obligatorii)) { if ($rz -cnotcontains [string]$o) { [void]$mot.Add('refuz lipsa: ' + $o) } }
  }
  if ($null -ne $perm) {
    $rau = @(@($p.forme_largi) + @($p.refuzuri_obligatorii) | ForEach-Object { & $norm $_ })
    foreach ($x in @($perm.v)) { if ($rau -ccontains (& $norm $x)) { [void]$mot.Add('permisiune prea larga / refuzata: ' + $x) } }
  }
  return @{ ok = ($mot.Count -eq 0); motive = @($mot) }
}

# ── Starea tichetelor și a rulării (J7) ─────────────────────────────────────────────────────────────────────

function Get-StareNoua {
  # Intrarea din stare.json după rezultatul de azi. $Rezultat = @{ stare; clasa; detaliu; pr; branch }.
  # stare: PR_DRAFT (PR + ambele review-uri citite) | PR_FARA_REVIEW | DECIZIE | ESUAT | BLOCAT | NECUNOSCUT | EROARE | OPRIT.
  # Încercarea se consumă DOAR la un rezultat cunoscut al agentului (PR / DECIZIE / ESUAT) și o singură dată pentru același PR;
  # NECUNOSCUT / EROARE / OPRIT nu o consumă (se reia la următoarea rulare, inclusiv la reîncercările zilei).
  param([AllowNull()][System.Collections.IDictionary]$Vechi, [string]$Numar, [System.Collections.IDictionary]$Rezultat, [string]$Azi)
  $e = [ordered]@{ numar = $Numar; incercari = 0; ultima_data = ''; ultimul_rezultat = ''; clasa = ''; asteapta_decizie = $false; motiv = ''; pr = 0; branch = ''; review_complet = $false; ultima_eroare = '' }
  if ($null -ne $Vechi) { foreach ($k in @($e.Keys)) { if ($Vechi.Contains($k) -and $null -ne $Vechi[$k]) { $e[$k] = $Vechi[$k] } } }
  $e['incercari'] = [int]$e['incercari']; $e['pr'] = [int]$e['pr']
  $e['asteapta_decizie'] = ($e['asteapta_decizie'] -eq $true); $e['review_complet'] = ($e['review_complet'] -eq $true)
  $st = [string]$Rezultat.stare
  $prNou = [int](Get-Camp $Rezultat 'pr')
  if ($script:StariConsuma -ccontains $st -and -not ($prNou -gt 0 -and $e['pr'] -eq $prNou)) {
    $e['incercari'] = $e['incercari'] + 1; $e['ultima_data'] = $Azi; $e['ultimul_rezultat'] = $st
  }
  $det = [string](Get-Camp $Rezultat 'detaliu')
  if ($st -ceq 'PR_DRAFT' -or $st -ceq 'PR_FARA_REVIEW') {
    $e['pr'] = $prNou; $e['branch'] = [string](Get-Camp $Rezultat 'branch'); $e['review_complet'] = ($st -ceq 'PR_DRAFT'); $e['clasa'] = 'L'
  } elseif ($st -ceq 'DECIZIE') { $e['asteapta_decizie'] = $true; $e['clasa'] = [string](Get-Camp $Rezultat 'clasa'); $e['motiv'] = $det }
  elseif ($st -ceq 'BLOCAT') { $e['asteapta_decizie'] = $true; $e['clasa'] = '!'; $e['motiv'] = $det }
  elseif ($st -ceq 'ESUAT') { $e['motiv'] = $det }
  else {
    $e['ultima_eroare'] = $Azi + ' ' + $st + ' ' + $det
    # un PR găsit pe branch-ul rulării, dar fără rezultat clar: se ține minte, ca reluarea să facă doar review-ul
    if ($prNou -gt 0) { $e['pr'] = $prNou; $e['branch'] = [string](Get-Camp $Rezultat 'branch'); $e['review_complet'] = $false }
  }
  return $e
}

function Get-StareRulare {
  # OK doar dacă nu a fost eroare globală, nicio eroare per tichet și toate tichetele au ajuns în PR_DRAFT / DECIZIE.
  param([string[]]$Stari = @(), [int]$NrErori = 0, [AllowNull()][string]$Eroare = '')
  if (-not [string]::IsNullOrEmpty($Eroare)) { return 'EROARE' }
  if ($NrErori -gt 0) { return 'PARTIAL' }
  foreach ($s in @($Stari)) { if ($script:StariOk -cnotcontains $s) { return 'PARTIAL' } }
  return 'OK'
}

Export-ModuleMember -Function Get-ReguliTichete, Get-Camp, Test-NumarTichet, Get-SerieTichet, Get-AnTichet, Test-SlugLansator,
  Get-SlugTichet, Get-BranchTichet, Test-BranchPropriu, Test-TichetAreUrmaGit, Get-CampResult, Get-StarePaw, Test-LansatorOcupat,
  Get-RaspunsJak, Get-TextCurat, Get-TextSigurLinie, Sort-TicheteCoada, Select-TicheteDeLucru, Test-ListaCompleta,
  Get-EffortTichet, New-MarcajDate, New-BriefTichet, New-BriefReview, Get-RezultatAgent, Get-VerdictReview, Test-NumeBranch,
  Select-PrTichet, Get-CaiNameStatusZ, Get-LiniiNumstatZ, Get-CaleNormalizata, Get-CaiProtejateAtinse,
  Test-DiffAreSecurityDefiner, Get-CuvinteInterziseDiff, Test-DiffAreMarcajeRezultat, Get-RegiuneFunctie,
  Test-DiffAtingeRegiune, Get-RegiuniInterziseAtinse, Test-ReviewTrece, Test-ChecksVerzi, Get-StareChecks,
  Get-RecomandareMerge, Get-RezumatVerdict, Test-ComandaGhPermisa, Test-ComandaGitPermisa, Get-ListaPs,
  Test-LansatorProfilTichete, Get-StareNoua, Get-StareRulare
