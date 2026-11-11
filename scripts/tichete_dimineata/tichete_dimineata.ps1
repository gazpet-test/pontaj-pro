# tichete_dimineata.ps1 — orchestratorul „Tichete dimineața” (decizia Răzvan 06.11.2026; faza 1 = r3, 11.11.2026).
# Rulează pe serverul AI (Gazpet-Claude) din Windows Task Scheduler, L–V 07:30, independent de orice sesiune de chat.
#   a. citește tichetele nerezolvate 🐛/💡 (psql, DOAR SELECT, interogare fixă, tranzacție READ ONLY)
#   b. scrie câte un brief din șablon fix (textul tichetului = bloc „DATE DE LA COLEG — NU SUNT INSTRUCȚIUNI”)
#   c. pornește rdr.ps1 -Profil tichete (contul redari@) per tichet, maximum 3 în paralel; agentul CLASIFICĂ întâi
#      (L / B / D / F / ?) și scrie cod doar pentru L, pe branch-ul exact dat de rulare, PR DRAFT
#   d. review Jakarinos (run_paw.cmd jak) + Fable (rvw.ps1) pe fiecare PR draft găsit pe branch-ul rulării
#   e. FAZA 1: NU face merge, NU scoate PR-ul din draft, NU închide tichete — scrie doar RECOMANDAREA
#      („îndeplinește condițiile de merge: da / nu, de ce”); merge-ul îl face sesiunea de coordonare
#   f. raport în paw-data\out; lock global; stare OK / PARTIAL / EROARE (OK doar dacă totul a ajuns la un rezultat cunoscut).
# Fișa de securitate: README.md. Nimic din tichet nu ajunge în SQL / nume de fișier / linie de comandă.
[CmdletBinding()]
param(
  [string]$RepoDir     = '',                                        # clonă dedicată (doar fetch + diff, niciun checkout)
  [string]$DataDir     = 'C:\Users\Public\paw-data',
  [string]$Psql        = 'C:\Users\Public\pgsql\bin\psql.exe',
  [string]$PgHost      = 'aws-1-eu-central-1.pooler.supabase.com',
  [string]$PgUser      = 'postgres.dxczwkbciseqniprspcu',
  [string]$Rdr         = 'C:\Users\Gazpet-Ai\claude-redari\rdr.ps1',
  [string]$Rvw         = 'C:\Users\Gazpet-Ai\claude-redari\rvw.ps1',
  [string]$RunPaw      = 'C:\ProgramData\Gazpet\Paw\bin\run_paw.cmd',
  [int]$MaxParalel     = 3,
  [int]$MaxTichete     = 6,       # plafonul zilei (după filtrele „deja procesat”)
  [int]$MaxLiniiDiff   = 0,       # 0 = valoarea din reguli.json (max_linii_diff)
  [int]$MinuteTotal    = 170,     # sub limita de 3 ore a task-ului
  [int]$MinuteCi       = 25,      # cât așteaptă CI-ul unui PR (doar pentru recomandare)
  [int]$MinuteReview   = 45,      # plafon per review (Jakarinos are timeout propriu 20 min)
  [switch]$Simulare,              # citește tichetele + scrie brief-urile, NU pornește rdr / review (nu cere profilul rdr)
  [switch]$Forteaza               # rulează chiar dacă azi există deja o rulare OK
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
Import-Module (Join-Path $PSScriptRoot 'tichete_lib.psm1') -Force

$Reguli = Get-ReguliTichete
if ($MaxLiniiDiff -le 0) { $MaxLiniiDiff = [int]$Reguli.max_linii_diff }
# fără prompturi interactive (rulare din Task Scheduler)
$env:GIT_TERMINAL_PROMPT = '0'; $env:GH_PROMPT_DISABLED = '1'; $env:GH_NO_UPDATE_NOTIFIER = '1'; $env:NO_COLOR = '1'
$UTF8 = New-Object System.Text.UTF8Encoding($false)
$Start = Get-Date
$Deadline = $Start.AddMinutes($MinuteTotal)
$Azi = $Start.ToString('yyyy-MM-dd')
if (-not $RepoDir) { $RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$BriefDir = Join-Path $DataDir 'brief'
$OutDir   = Join-Path $DataDir 'out'
$StareDir = Join-Path $DataDir 'tichete_dimineata'
$FisStare = Join-Path $OutDir 'tichete_ultima_rulare.txt'
$FisRaport = Join-Path $OutDir ("tichete_$Azi.md")
$FisTichete = Join-Path $StareDir 'stare.json'
$FisJurnal = Join-Path $StareDir 'jurnal.log'
$LimitaPr = 20000

function Jurnal([string]$m) {
  $l = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $m
  try { [IO.File]::AppendAllText($FisJurnal, $l + "`r`n", $UTF8) } catch {}
  Write-Host $l
}
function ScrieStare([string]$stare, [string]$detaliu) {
  $l = $stare + ' ' + (Get-Date).ToString('yyyy-MM-dd HH:mm') + ' ' + (Get-TextSigurLinie $detaliu 300)
  [IO.File]::WriteAllText($FisStare, $l + "`r`n", $UTF8)
}
function CaleSimpla([string]$p) {
  # căile date către cmd.exe / powershell.exe nu au voie să aibă spații sau metacaractere
  if ($p -cnotmatch '\A[A-Za-z]:\\[A-Za-z0-9_\\.-]+\z') { throw "cale nepermisa pentru linie de comanda: $p" }
  return $p
}
function Q([string]$a) {
  # citare argument Windows (CommandLineToArgvW)
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  return '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}
function Exec([string]$exe, [string[]]$argv, [int]$timeoutSec = 120, [string]$cwd = $RepoDir) {
  # rulează sincron, stdout/stderr UTF-8; întoarce @{ exit; out; err }. Timeout => kill + exit -1.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = (($argv | ForEach-Object { Q $_ }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $UTF8
  $psi.StandardErrorEncoding = $UTF8
  $psi.CreateNoWindow = $true
  if ($cwd) { $psi.WorkingDirectory = $cwd }
  $p = [System.Diagnostics.Process]::Start($psi)
  $so = $p.StandardOutput.ReadToEndAsync()
  $se = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutSec * 1000)) {
    try { $p.Kill() } catch {}
    return @{ exit = -1; out = ''; err = 'timeout' }
  }
  $p.WaitForExit()
  return @{ exit = $p.ExitCode; out = $so.Result; err = $se.Result }
}
$GhExe = $null; $GitExe = $null
try { $GhExe = (Get-Command gh.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source } catch {}
try { $GitExe = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source } catch {}
function Gh([string[]]$argv, [int]$t = 120) {
  # doar citiri (Test-ComandaGhPermisa): fără merge / ready / api de scriere — garda e și în cod, nu doar în review
  if (-not $GhExe) { throw 'gh.exe nu e in PATH' }
  if (-not (Test-ComandaGhPermisa $argv)) { throw ('comanda gh nepermisa: ' + ((@($argv) | Select-Object -First 2) -join ' ')) }
  return Exec $GhExe $argv $t
}
function Git([string[]]$argv, [int]$t = 300) {
  if (-not $GitExe) { throw 'git.exe nu e in PATH' }
  if (-not (Test-ComandaGitPermisa $argv)) { throw ('comanda git nepermisa: ' + $argv[0]) }
  return Exec $GitExe (@('-C', $RepoDir) + $argv) $t
}
function JsonLista([string]$s) {
  # PS 5.1: „'[...]' | ConvertFrom-Json” emite array-ul ca UN obiect; aici îl întoarcem ca listă reală (apelantul NU pune @())
  if ([string]::IsNullOrEmpty($s) -or -not $s.Trim()) { return ,@() }
  $o = ConvertFrom-Json -InputObject $s
  if ($null -eq $o) { return ,@() }
  return ,@($o | ForEach-Object { $_ } | Where-Object { $null -ne $_ })
}
function PornesteFundal([string]$exe, [string[]]$argv, [string]$logOut) {
  # proces de fundal cu stdout/stderr în fișiere; argumentele sunt citate; ExitCode citit prin handle
  $p = Start-Process -FilePath $exe -ArgumentList ((($argv | ForEach-Object { Q $_ }) -join ' ')) -PassThru -WindowStyle Hidden `
       -RedirectStandardOutput $logOut -RedirectStandardError ($logOut + '.err')
  $null = $p.Handle
  return $p
}
function UltimaLinie([string]$fis) {
  if (-not (Test-Path -LiteralPath $fis)) { return '' }
  $ls = @([IO.File]::ReadAllLines($fis, $UTF8) | Where-Object { $_.Trim() -ne '' })
  if ($ls.Count -eq 0) { return '' }
  return $ls[$ls.Count - 1]
}
function CitesteText([string]$fis) {
  if (-not (Test-Path -LiteralPath $fis)) { return '' }
  return [IO.File]::ReadAllText($fis, $UTF8)
}
function OpresteArbore($p) {
  if ($null -eq $p -or $p.HasExited) { return }
  try { & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null } catch {}
}
function MutaVechi([string]$fis) {
  # o ieșire rămasă de la o rulare veche nu are voie să fie citită ca rezultat al acesteia
  if (Test-Path -LiteralPath $fis) { Move-Item -LiteralPath $fis -Destination ($fis + '.' + $Start.ToString('yyyyMMddHHmmss') + '.vechi') -Force }
}
function Termina($x, [string]$stare, [string]$nota) {
  $x.stare = $stare
  if ($nota) { $x.nota = (@($x.nota, $nota) | Where-Object { $_ }) -join '; ' }
  $x.etapa = 'gata'
}
function CitesteStareTichete {
  # stare.json = listă de intrări (Get-StareNoua). Fișier stricat => EROARE (nu reset tăcut: s-ar pierde încercările consumate).
  $h = @{}
  if (-not (Test-Path -LiteralPath $FisTichete)) { return $h }
  $txt = CitesteText $FisTichete
  if (-not $txt.Trim()) { return $h }
  foreach ($o in (JsonLista $txt)) {
    $nr = [string](Get-Camp $o 'numar')
    if (-not (Test-NumarTichet $nr)) { throw 'stare.json: intrare cu numar invalid' }
    $e = @{}
    foreach ($p in $o.PSObject.Properties) { $e[$p.Name] = $p.Value }
    $h[$nr] = $e
  }
  return $h
}
function ScrieStareTichete([hashtable]$h) {
  # scriere atomică: .tmp + Replace (copie .bak)
  $lista = @($h.Keys | Sort-Object | ForEach-Object { $h[$_] })
  $tmp = $FisTichete + '.tmp'
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject @($lista) -Depth 4), $UTF8)
  if (Test-Path -LiteralPath $FisTichete) { [IO.File]::Replace($tmp, $FisTichete, $FisTichete + '.bak') }
  else { [IO.File]::Move($tmp, $FisTichete) }
}

# ── Directoare + lock global ──────────────────────────────────────────────────────────────────────────────
foreach ($d in @($BriefDir, $OutDir, $StareDir)) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }
$LockFs = $null
try {
  $LockFs = [IO.File]::Open((Join-Path $StareDir 'lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
  Jurnal 'alta rulare e in curs (lock ocupat) - ies fara sa ating starea'
  exit 0
}

if (-not $Forteaza -and -not $Simulare -and (Test-Path -LiteralPath $FisStare)) {
  $prec = (CitesteText $FisStare).Trim()
  # DOAR o rulare OK oprește reîncercările zilei; PARTIAL / EROARE le lasă active (J7)
  if ($prec.StartsWith('OK ' + $Azi)) { Jurnal 'exista deja o rulare OK azi - ies (reincercare inutila)'; $LockFs.Dispose(); exit 0 }
}

$eroare = ''; $stareFinala = 'EROARE'
$Stare = @{}; $stareCitita = $false
$Rezultate = New-Object System.Collections.ArrayList   # câte un hashtable per tichet
$Sarite = @()
$Autor = ''
try {
  ScrieStare 'IN_CURS' ('pornit ' + $Start.ToString('HH:mm'))
  Jurnal ("start; repo=$RepoDir simulare=" + [bool]$Simulare)

  # ── Verificări preliminare (unelte, profilul lansatorului, rețea) ──────────────────────────────────────────
  foreach ($f in @($Psql) + $(if ($Simulare) { @() } else { @($Rdr, $Rvw, $RunPaw) })) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "lipseste $f" }
  }
  [void](CaleSimpla $DataDir); [void](CaleSimpla $Rdr); [void](CaleSimpla $Rvw); [void](CaleSimpla $RunPaw)
  # J1: agentul pornește DOAR cu profilul „tichete” al lansatorului (fără merge / ready / api / workflow / release / secret /
  # push pe main / deploy). Lansatorul fără profil => orchestratorul nu pornește (fail-closed).
  $prof = Test-LansatorProfilTichete (CitesteText $Rdr)
  if (-not $prof.ok) {
    $mot = (@($prof.motive) | Select-Object -First 4) -join '; '
    if ($Simulare) { Jurnal ('ATENTIE: rdr.ps1 nu are profilul tichete (' + $mot + ') - in simulare nu pornesc agenti') }
    else { throw ('rdr.ps1 nu are profilul tichete (J1), nu pornesc: ' + $mot) }
  }
  $r = Gh @('auth', 'status') 60
  if ($r.exit -ne 0) { throw 'gh: autentificare / retea indisponibila' }
  $r = Gh @('api', 'user', '--jq', '.login') 60
  if ($r.exit -ne 0) { throw ('gh api user esuat: ' + (Get-TextSigurLinie $r.err 160)) }
  $Autor = $r.out.Trim()
  if ($Autor -cnotmatch '\A[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\z') { throw 'gh: login necunoscut' }
  $r = Git @('fetch', '--prune', 'origin')
  if ($r.exit -ne 0) { throw ('git fetch esuat: ' + (Get-TextSigurLinie $r.err 200)) }

  # ── a. Tichetele (SELECT fix, fără niciun parametru) ────────────────────────────────────────────────────
  # nerezolvat = status nefinal ȘI fără descriere_interventie; FĂRĂ LIMIT de coadă (J9): filtrele locale se aplică înainte
  # de plafonul zilei. LIMIT 1001 = plafon de siguranță; peste 1000 => EROARE (nu o listă tăiată în tăcere).
  $sql = @'
BEGIN TRANSACTION READ ONLY;
SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb)::text
FROM (
  SELECT id, numar_tichet, titlu, subcategorie, status, created_at, departament, entitate_descriere, descriere
  FROM public.tichete
  WHERE coalesce(status, '') NOT IN ('rezolvat', 'inchis', 'anulat', 'respins')
    AND descriere_interventie IS NULL
    AND subcategorie IN ('eroare_erp', 'cerere_functie')
  ORDER BY created_at
  LIMIT 1001
) t;
ROLLBACK;
'@
  $fisSql = Join-Path $StareDir 'select_tichete.sql'
  $fisJson = Join-Path $StareDir 'tichete.json'
  [IO.File]::WriteAllText($fisSql, $sql, $UTF8)
  if (Test-Path -LiteralPath $fisJson) { Remove-Item -LiteralPath $fisJson -Force }
  $env:PGCLIENTENCODING = 'UTF8'
  $r = Exec $Psql @('-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', $PgHost, '-p', '5432', '-U', $PgUser, '-d', 'postgres',
                    '-f', $fisSql, '-o', $fisJson) 120 $StareDir
  if ($r.exit -ne 0) { throw ('psql esuat (exit ' + $r.exit + '): ' + (Get-TextSigurLinie $r.err 200)) }
  $linieJson = @([IO.File]::ReadAllLines($fisJson, $UTF8) | Where-Object { $_.StartsWith('[') }) | Select-Object -Last 1
  Remove-Item -LiteralPath $fisJson -Force -ErrorAction SilentlyContinue
  if (-not $linieJson) { throw 'psql: raspuns fara lista JSON' }
  $tichete = JsonLista $linieJson
  if ($tichete.Count -gt [int]$Reguli.max_tichete_citite) { throw ('peste ' + $Reguli.max_tichete_citite + ' tichete nerezolvate: lista nu e garantat completa') }
  Jurnal ('tichete nerezolvate citite: ' + $tichete.Count)

  # ── Inventar: PR-uri (orice stare, toate), branch-uri remote, starea locală ────────────────────────────────
  $r = Gh @('pr', 'list', '--state', 'all', '--limit', [string]$LimitaPr, '--json', 'number,title,headRefName') 300
  if ($r.exit -ne 0) { throw ('gh pr list esuat: ' + (Get-TextSigurLinie $r.err 160)) }
  $prToate = JsonLista $r.out
  if (-not (Test-ListaCompleta -Numar $prToate.Count -Limita $LimitaPr)) { throw ('inventarul PR-urilor poate fi taiat (' + $prToate.Count + ' >= ' + $LimitaPr + ')') }
  $r = Git @('ls-remote', '--heads', 'origin')
  if ($r.exit -ne 0) { throw 'git ls-remote esuat' }
  $branchuri = @(($r.out -split "`n") | ForEach-Object { ($_ -replace '^\S+\s+refs/heads/', '').Trim() } | Where-Object { $_ })
  $Stare = CitesteStareTichete
  $stareCitita = $true
  $sel = Select-TicheteDeLucru -Tichete $tichete -Stare $Stare -TitluriPr @($prToate | ForEach-Object { [string]$_.title }) `
         -Branchuri (@($branchuri) + @($prToate | ForEach-Object { [string]$_.headRefName })) -Azi $Azi -Max $MaxTichete
  $Sarite = @($sel.sarite)
  Jurnal ('de lucru: ' + @($sel.deLucru).Count + ', sarite: ' + $Sarite.Count)

  # ── b. Brief-uri ───────────────────────────────────────────────────────────────────────────────────────
  foreach ($w in @($sel.deLucru)) {
    $t = $w.tichet
    $slug = Get-SlugTichet $t.numar_tichet
    $fb = Join-Path $BriefDir ($slug + '.md')
    if ($w.mod -ceq 'nou') { [IO.File]::WriteAllText($fb, (New-BriefTichet -Tichet $t -Branch $w.branch), $UTF8) }
    [void]$Rezultate.Add(@{
      numar = [string]$t.numar_tichet; slug = $slug; brief = $fb; effort = (Get-EffortTichet $t); mod = $w.mod
      sub = [string]$t.subcategorie; titlu = (Get-TextSigurLinie $t.titlu 90); incercare = $w.incercare; branch = $w.branch
      etapa = $(if ($w.mod -ceq 'nou') { 'coada' } else { 'pr_cauta' }); stare = ''; agent = $null; pr = 0; sha = ''
      jak = $null; fable = $null; checks = @(); ciStare = ''; recomandare = $null; nota = ''; erori = (New-Object System.Collections.ArrayList)
      reincercari = 0; dupa = $Start; proc = $null; procJak = $null; procRvw = $null; ciPana = $null; reviewPana = $null
      reincercariJak = 0; reincercariRvw = 0; reviewDupa = $Start; fisiere = @(); diff = ''; linii = 0; regiuni = @(); briefReview = ''
    })
  }
  if ($Simulare) { Jurnal 'simulare: brief-uri scrise, nu pornesc rdr'; foreach ($x in $Rezultate) { $x.etapa = 'gata'; $x.stare = 'SIMULARE' } }

  # ── c–e. Bucla: rdr (max $MaxParalel) → PR pe branch-ul exact → review (unul odată) → CI → recomandare ─────
  $ReviewActiv = $null
  $NEC = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
  while (-not $Simulare) {
    $activ = @($Rezultate | Where-Object { $_.etapa -cne 'gata' })
    if ($activ.Count -eq 0) { break }
    if ((Get-Date) -gt $Deadline) {
      foreach ($x in $activ) {
        OpresteArbore $x.proc; OpresteArbore $x.procJak; OpresteArbore $x.procRvw
        Termina $x $(if ($x.pr -gt 0) { 'PR_FARA_REVIEW' } else { 'OPRIT' }) ('oprit la plafonul de timp in etapa ' + $x.etapa)
      }
      break
    }

    # c1. rdr terminate
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'rdr' -and $_.proc.HasExited })) {
      $logOut = Join-Path $OutDir ($x.slug + '_rdr_stdout.log')
      $fJson = Join-Path $OutDir ('rdr_' + $x.slug + '.json')
      if ((Test-LansatorOcupat -Exit $x.proc.ExitCode -UltimaLinie (UltimaLinie $logOut) -Cine 'RDR') -and -not (Test-Path -LiteralPath $fJson) -and $x.reincercari -lt 20) {
        # rdr are toate locurile ocupate (de chat / alte rulări): așteaptă, nu forța
        $x.reincercari++; $x.dupa = (Get-Date).AddMinutes(3); $x.etapa = 'coada'; continue
      }
      # Rezultatul se citește DOAR din câmpul „result” al rdr_<slug>.json (ultima linie nevidă); stdout-ul nu se parsează.
      $rezTxt = Get-CampResult (CitesteText $fJson)
      if ($null -eq $rezTxt) { $x.agent = @{ tip = 'NECUNOSCUT'; clasa = ''; detaliu = ('lipseste / nu se citeste rdr_' + $x.slug + '.json (exit ' + $x.proc.ExitCode + ')'); pr = 0 } }
      else { $x.agent = Get-RezultatAgent $rezTxt }
      Jurnal ('rdr gata ' + $x.numar + ': ' + $x.agent.tip + ' ' + $x.agent.clasa)
      $x.etapa = 'pr_cauta'
    }

    # c2. pornește rdr cât sunt locuri
    $ruleaza = @($Rezultate | Where-Object { $_.etapa -ceq 'rdr' }).Count
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'coada' -and $_.dupa -le (Get-Date) })) {
      if ($ruleaza -ge $MaxParalel) { break }
      $logOut = Join-Path $OutDir ($x.slug + '_rdr_stdout.log')
      MutaVechi (Join-Path $OutDir ('rdr_' + $x.slug + '.json'))
      $x.proc = PornesteFundal 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Rdr, '-Brief', (CaleSimpla $x.brief),
                  '-Slug', $x.slug, '-Effort', $x.effort, '-Profil', 'tichete') $logOut
      $x.etapa = 'rdr'; $ruleaza++
      Jurnal ("rdr pornit " + $x.numar + " effort=" + $x.effort + " branch=" + $x.branch)
    }

    # c3. PR-ul rulării (F7): DOAR pe branch-ul exact, deschis, draft, baza main, autorul gh de pe server
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'pr_cauta' })) {
      $r = Gh @('pr', 'list', '--head', $x.branch, '--state', 'all', '--limit', '20', '--json',
                'number,headRefName,headRefOid,isDraft,baseRefName,state,author,isCrossRepository')
      if ($r.exit -ne 0) { [void]$x.erori.Add('gh pr list --head: ' + (Get-TextSigurLinie $r.err 160)); Termina $x 'EROARE' ''; continue }
      $sp = Select-PrTichet -Prs (JsonLista $r.out) -Branch $x.branch -Autor $Autor
      $ag = $x.agent
      $tip = if ($null -eq $ag) { 'NECUNOSCUT' } else { [string]$ag.tip }
      if ($sp.eroare) { Termina $x 'BLOCAT' ('PR pe branch-ul rularii, dar: ' + $sp.eroare); continue }
      if ($null -eq $sp.pr) {
        if ($x.mod -cne 'nou') { Termina $x 'BLOCAT' ('branch-ul ' + $x.branch + ' exista, dar fara PR draft deschis'); continue }
        switch -CaseSensitive ($tip) {
          'DECIZIE' { Termina $x 'DECIZIE' '' }
          'ESUAT'   { Termina $x 'ESUAT' $ag.detaliu }
          'PR'      { Termina $x 'NECUNOSCUT' ('agentul a raportat PR, dar pe branch-ul ' + $x.branch + ' nu e niciun PR') }
          default   { Termina $x 'NECUNOSCUT' $(if ($null -ne $ag) { $ag.detaliu } else { 'fara rezultat' }) }
        }
        continue
      }
      $x.pr = [int]$sp.pr.number; $x.sha = [string]$sp.pr.headRefOid
      if ($tip -ceq 'PR' -and $ag.pr -ne $x.pr) { $x.nota = 'agentul a raportat PR #' + $ag.pr + ', pe branch e #' + $x.pr }
      elseif ($tip -ceq 'DECIZIE' -or $tip -ceq 'ESUAT') { $x.nota = 'agentul a raportat ' + $tip + ', dar a deschis PR' }
      $x.etapa = 'review_coada'
    }

    # d. review: unul odată (lansatorul Paw are barieră globală). Amândoi primesc ACELAȘI brief, pe ACELAȘI commit (sha).
    #    run_paw.cmd jak <brief> <iesire.log>: ultima linie PAW_GATA / PAW_EROARE; răspunsul = între PAW_START și „--- stderr ---”.
    #    rvw.ps1 -Brief -Slug -Ref <sha> → rvw_<slug>.json (câmpul result); RVW_OCUPAT (exit 3) = reîncercare, ca la Jakarinos.
    if ($null -ne $ReviewActiv -and ($null -eq $ReviewActiv.procJak -or $ReviewActiv.procJak.HasExited) -and ($null -eq $ReviewActiv.procRvw -or $ReviewActiv.procRvw.HasExited)) {
      $x = $ReviewActiv; $ReviewActiv = $null
      $reia = $false
      if ($null -ne $x.procRvw) {
        $fr = Join-Path $OutDir ('rvw_' + $x.slug + '.json')
        $cons = Join-Path $OutDir ($x.slug + '_rvw_consola.log')
        if ((Test-LansatorOcupat -Exit $x.procRvw.ExitCode -UltimaLinie (UltimaLinie $cons) -Cine 'RVW') -and -not (Test-Path -LiteralPath $fr) -and $x.reincercariRvw -lt 10) {
          $x.reincercariRvw++; $reia = $true; Jurnal ("rvw ocupat " + $x.numar + ", reincerc (" + $x.reincercariRvw + ")")
        } else {
          $rezRvw = Get-CampResult (CitesteText $fr)
          $x.fable = if ($null -eq $rezRvw) { $NEC } else { Get-VerdictReview $rezRvw }
        }
        $x.procRvw = $null
      }
      if ($null -ne $x.procJak) {
        $fj = Join-Path $OutDir ($x.slug + '_jak.log')
        $stJak = Get-StarePaw (UltimaLinie $fj)
        if ($stJak -ceq 'OCUPAT' -and $x.reincercariJak -lt 10) {
          $x.reincercariJak++; $reia = $true; Jurnal ("jak ocupat " + $x.numar + ", reincerc (" + $x.reincercariJak + ")")
        } else {
          $rasp = if ($stJak -ceq 'GATA') { Get-RaspunsJak (CitesteText $fj) } else { $null }
          $x.jak = if ($null -eq $rasp) { $NEC } else { Get-VerdictReview $rasp }
        }
        $x.procJak = $null
      }
      if ($reia) { $x.reviewDupa = (Get-Date).AddMinutes(3); $x.etapa = 'review_coada' }
      elseif ($null -ne $x.jak -and $null -ne $x.fable) {
        $x.ciPana = (Get-Date).AddMinutes($MinuteCi); $x.etapa = 'ci'
        Jurnal ("review gata " + $x.numar + " jak=" + $x.jak.verdict + " fable=" + $x.fable.verdict)
      } else { $x.etapa = 'review_coada' }
    } elseif ($null -ne $ReviewActiv -and $ReviewActiv.reviewPana -lt (Get-Date)) {
      OpresteArbore $ReviewActiv.procJak; OpresteArbore $ReviewActiv.procRvw
      if ($null -ne $ReviewActiv.procJak) { $ReviewActiv.jak = $NEC; $ReviewActiv.procJak = $null }
      if ($null -ne $ReviewActiv.procRvw) { $ReviewActiv.fable = $NEC; $ReviewActiv.procRvw = $null }
      [void]$ReviewActiv.erori.Add('review oprit la timeout')
      $ReviewActiv.ciPana = (Get-Date); $ReviewActiv.etapa = 'ci'; $ReviewActiv = $null
    }
    if ($null -eq $ReviewActiv) {
      $x = @($Rezultate | Where-Object { $_.etapa -ceq 'review_coada' -and $_.reviewDupa -le (Get-Date) }) | Select-Object -First 1
      if ($x) {
        $ok = $true
        if (-not $x.briefReview) {
          # diff-ul se calculează O SINGURĂ DATĂ, pe sha-ul găsit la c3 (reîncercările revizuiesc același commit)
          $b = $x.branch; $sha = $x.sha
          $r = Git @('fetch', 'origin', 'main', $b)
          $fd = Join-Path $OutDir ($x.slug + '.diff')
          $interval = 'origin/main...' + $sha
          # --no-renames: o redenumire supabase/x → src/y apare cu AMBELE căi; -z: căile brute, fără citarea lui Git (J5)
          $r2 = Git @('diff', '--no-color', '--no-ext-diff', '--no-renames', ('--output=' + $fd), $interval)
          $r3 = Git @('diff', '--no-renames', '--name-status', '-z', $interval)
          $r4 = Git @('diff', '--no-renames', '--numstat', '-z', $interval)
          $r5 = Git @('rev-parse', ('origin/' + $b))
          if ($r.exit -ne 0 -or $r2.exit -ne 0 -or $r3.exit -ne 0 -or $r4.exit -ne 0 -or $r5.exit -ne 0) {
            [void]$x.erori.Add('nu am putut lua diff-ul branch-ului'); Termina $x 'PR_FARA_REVIEW' ''; $ok = $false
          } else {
            try {
              $x.fisiere = @(Get-CaiNameStatusZ $r3.out)
              $x.linii = Get-LiniiNumstatZ $r4.out $MaxLiniiDiff
            } catch { [void]$x.erori.Add('inventarul cailor: ' + $_.Exception.Message); Termina $x 'PR_FARA_REVIEW' ''; $ok = $false }
            if ($ok) {
              $x.diff = CitesteText $fd
              if ($r5.out.Trim() -cne $sha) { $x.nota = (@($x.nota, 'head-ul branch-ului s-a schimbat dupa gasirea PR-ului; revizuiesc ' + $sha.Substring(0, 8)) | Where-Object { $_ }) -join '; ' }
              # regiunile interzise (SalariiPage din src/App.jsx): sursa de pe origin/main; necitită => atinsă (fail-closed)
              $surse = @{}
              foreach ($rg in @($Reguli.regiuni_interzise)) {
                $rs = Git @('show', ('origin/main:' + [string]$rg.fisier))
                $surse[[string]$rg.fisier] = if ($rs.exit -eq 0) { $rs.out } else { $null }
              }
              $x.regiuni = @(Get-RegiuniInterziseAtinse -Diff $x.diff -Fisiere $x.fisiere -Surse $surse)
              $x.briefReview = Join-Path $BriefDir ($x.slug + '_review.md')
              [IO.File]::WriteAllText($x.briefReview, (New-BriefReview -Numar $x.numar -Pr $x.pr -Branch $b -Sha $sha -Diff $x.diff), $UTF8)
            }
          }
        }
        if ($ok) {
          if ($null -eq $x.jak) {
            $fj = Join-Path $OutDir ($x.slug + '_jak.log')
            if (Test-Path -LiteralPath $fj) { Remove-Item -LiteralPath $fj -Force }
            $x.procJak = PornesteFundal $env:ComSpec @('/d', '/c', (CaleSimpla $RunPaw), 'jak', (CaleSimpla $x.briefReview), (CaleSimpla $fj)) (Join-Path $OutDir ($x.slug + '_jak_consola.log'))
          }
          if ($null -eq $x.fable) {
            MutaVechi (Join-Path $OutDir ('rvw_' + $x.slug + '.json'))
            $x.procRvw = PornesteFundal 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Rvw, '-Brief', (CaleSimpla $x.briefReview),
                           '-Slug', $x.slug, '-Ref', $x.sha) (Join-Path $OutDir ($x.slug + '_rvw_consola.log'))
          }
          $x.reviewPana = (Get-Date).AddMinutes($MinuteReview)
          $x.etapa = 'review'; $ReviewActiv = $x
          Jurnal ("review pornit " + $x.numar + " PR #" + $x.pr + " " + $x.sha.Substring(0, 8))
        }
      }
    }

    # e. CI + recomandare (FĂRĂ merge, fără ready): erorile gh sunt erori vizibile (F10), nu liste goale
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'ci' })) {
      $r = Gh @('pr', 'checks', [string]$x.pr, '--json', 'name,bucket')
      $sc = Get-StareChecks -Exit $r.exit -Out $r.out -Err $r.err
      if (($sc.stare -ceq 'pending' -or $sc.stare -ceq 'gol') -and $x.ciPana -gt (Get-Date)) { continue }
      if ($sc.stare -ceq 'eroare') { [void]$x.erori.Add($sc.eroare) }
      $x.checks = @($sc.checks); $x.ciStare = $sc.stare
      $r = Gh @('pr', 'view', [string]$x.pr, '--json', 'headRefOid,state,baseRefName,isDraft,isCrossRepository')
      $pv = $null
      if ($r.exit -ne 0) { [void]$x.erori.Add('gh pr view: ' + (Get-TextSigurLinie $r.err 160)) }
      else { try { $pv = ConvertFrom-Json -InputObject $r.out } catch { [void]$x.erori.Add('gh pr view: JSON necitit') } }
      $clasa = if ($null -ne $x.agent -and $x.agent.clasa) { [string]$x.agent.clasa } else { 'L' }
      if ($null -ne $x.agent -and $x.agent.tip -ceq 'NECUNOSCUT') { $clasa = '?' }
      if ($null -eq $pv) { $x.recomandare = @{ indeplineste = $false; motive = @('starea PR-ului nu s-a putut citi') } }
      else {
        $x.recomandare = Get-RecomandareMerge -Jak $x.jak -Fable $x.fable -Checks $x.checks -Clasa $clasa -Fisiere $x.fisiere `
          -Diff $x.diff -LiniiDiff $x.linii -MaxLiniiDiff $MaxLiniiDiff -CrossRepo ((Get-Camp $pv 'isCrossRepository') -ne $false) `
          -HeadSchimbat ([string](Get-Camp $pv 'headRefOid') -cne $x.sha) -RegiuniAtinse $x.regiuni `
          -BazaMain ([string](Get-Camp $pv 'baseRefName') -ceq 'main') -Deschis ([string](Get-Camp $pv 'state') -ceq 'OPEN') `
          -Draft ((Get-Camp $pv 'isDraft') -eq $true)
      }
      $reviewOk = ($x.jak.verdict -cne 'NECUNOSCUT' -and $x.fable.verdict -cne 'NECUNOSCUT')
      Termina $x $(if ($reviewOk) { 'PR_DRAFT' } else { 'PR_FARA_REVIEW' }) ''
    }

    Start-Sleep -Seconds 15
  }
  $stareFinala = Get-StareRulare -Stari @($Rezultate | ForEach-Object { [string]$_.stare }) `
                   -NrErori (@($Rezultate | ForEach-Object { $_.erori.Count }) | Measure-Object -Sum).Sum
  if ($Simulare) { $stareFinala = 'SIMULARE' }
} catch {
  $stareFinala = 'EROARE'
  $eroare = Get-TextSigurLinie $_.Exception.Message 300
  Jurnal ('EROARE: ' + $eroare)
  foreach ($x in $Rezultate) {
    OpresteArbore $x.proc; OpresteArbore $x.procJak; OpresteArbore $x.procRvw
    if ($x.etapa -cne 'gata') { Termina $x $(if ($x.pr -gt 0) { 'PR_FARA_REVIEW' } else { 'OPRIT' }) 'oprit de eroarea rularii' }
  }
}

# ── Starea tichetelor (și după EROARE): încercarea se consumă DOAR la rezultat cunoscut (J7) ──────────────────
if ($stareCitita -and -not $Simulare) {
  try {
    foreach ($x in $Rezultate) {
      $det = if ($x.nota) { $x.nota } elseif ($null -ne $x.agent) { [string]$x.agent.detaliu } else { '' }
      if ($x.erori.Count -gt 0) { $det = (@($det) + @($x.erori) | Where-Object { $_ }) -join '; ' }
      $clasa = if ($null -ne $x.agent) { [string]$x.agent.clasa } else { '' }
      $vechi = if ($Stare.ContainsKey($x.numar)) { $Stare[$x.numar] } else { $null }
      $Stare[$x.numar] = Get-StareNoua -Vechi $vechi -Numar $x.numar -Rezultat @{ stare = $x.stare; clasa = $clasa; detaliu = (Get-TextSigurLinie $det 300); pr = $x.pr; branch = $x.branch } -Azi $Azi
    }
    if (@($Rezultate).Count -gt 0) { ScrieStareTichete $Stare }
  } catch {
    Jurnal ('stare.json nescris: ' + $_.Exception.Message)
    if ($stareFinala -ne 'EROARE') { $stareFinala = 'EROARE'; $eroare = 'stare.json nescris: ' + (Get-TextSigurLinie $_.Exception.Message 200) }
  }
}

# ── Raport (pe înțelesul owner-ului; local, nu în repo) ─────────────────────────────────────────────────────
$ClaseText = @{ 'L' = 'local'; 'B' = 'cere baza de date'; 'D' = 'cere date reale sau drepturi'; 'F' = 'funcție nouă'; '?' = 'neclar'; '!' = 'blocat, de verificat de om' }
function TextClasa([string]$c) { if ($ClaseText.ContainsKey($c)) { return $c + ' — ' + $ClaseText[$c] } else { return '?' } }
function TextVerdict($v) { if ($null -eq $v) { return 'lipsă' } elseif ($v.verdict -ceq 'NECUNOSCUT') { return 'necitit' } else { return ($v.verdict + ' (P0 ' + $v.p0 + ', P1 ' + $v.p1 + ')') } }
try {
  $nrRep = @($Rezultate | Where-Object { $_.stare -ceq 'PR_DRAFT' }).Count
  $dec = @($Rezultate | Where-Object { $_.stare -ceq 'DECIZIE' -or $_.stare -ceq 'BLOCAT' })
  $err = @($Rezultate | Where-Object { @('PR_DRAFT', 'DECIZIE', 'BLOCAT', 'SIMULARE') -cnotcontains $_.stare -or $_.erori.Count -gt 0 })
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# Tichete dimineața — $Azi")
  [void]$sb.AppendLine('')
  $stTxt = @{ 'OK' = 'OK'; 'PARTIAL' = 'PARȚIAL (unele tichete nu au ajuns la capăt — se reiau automat)'; 'EROARE' = 'EROARE'; 'SIMULARE' = 'SIMULARE (nu s-au pornit agenți)' }
  [void]$sb.AppendLine("Stare: **$($stTxt[$stareFinala])** — pornit $($Start.ToString('HH:mm')), terminat $((Get-Date).ToString('HH:mm')).")
  if ($stareFinala -ceq 'EROARE') { [void]$sb.AppendLine(''); [void]$sb.AppendLine("Eroare: $eroare") }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('Faza 1: rularea NU unește nimic în main și NU închide tichete. PR-urile rămân DRAFT; merge-ul și închiderea tichetului le face coordonatorul, după review GO + CI verde.')
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Pe scurt')
  [void]$sb.AppendLine("- Reparate (PR draft cu review): $nrRep")
  [void]$sb.AppendLine("- Așteaptă o decizie: $($dec.Count)")
  [void]$sb.AppendLine("- Erori / neterminate: $($err.Count)")
  [void]$sb.AppendLine("- Sărite: $(@($Sarite).Count)")
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Reparate — PR draft')
  $p = @($Rezultate | Where-Object { $_.pr -gt 0 })
  if ($p.Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($x in $p) {
    $rec = if ($null -eq $x.recomandare) { 'neevaluat (review / CI neterminat)' }
           elseif ($x.recomandare.indeplineste) { '**da**' }
           else { '**nu**: ' + ((@($x.recomandare.motive) | ForEach-Object { Get-TextSigurLinie $_ 160 }) -join '; ') }
    [void]$sb.AppendLine("- $($x.numar) — $($x.titlu) — PR #$($x.pr) (draft) — îndeplinește condițiile de merge: $rec")
    [void]$sb.AppendLine("  - Jakarinos: $(TextVerdict $x.jak) · Fable: $(TextVerdict $x.fable) · CI: $(if ($x.ciStare) { $x.ciStare } else { '-' })$(if ($x.nota) { ' · ' + (Get-TextSigurLinie $x.nota 200) })")
  }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Așteaptă decizie (nu se reiau până nu le deblochează coordonatorul)')
  if ($dec.Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($x in $dec) {
    $c = if ($x.stare -ceq 'BLOCAT') { '!' } elseif ($null -ne $x.agent) { [string]$x.agent.clasa } else { '?' }
    $ce = if ($x.stare -ceq 'BLOCAT') { $x.nota } elseif ($null -ne $x.agent) { $x.agent.detaliu } else { '' }
    [void]$sb.AppendLine("- $($x.numar) — $($x.titlu) — clasa $(TextClasa $c): $(Get-TextSigurLinie $ce 300)")
  }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Erori / neterminate')
  if ($err.Count -eq 0) { [void]$sb.AppendLine('- (niciuna)') }
  foreach ($x in $err) {
    $e2 = (@($x.nota) + @($x.erori) | Where-Object { $_ } | ForEach-Object { Get-TextSigurLinie $_ 200 }) -join '; '
    [void]$sb.AppendLine("- $($x.numar) — $($x.stare) (etapa $($x.etapa)) — $e2")
  }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Sărite')
  if (@($Sarite).Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($s in @($Sarite)) { [void]$sb.AppendLine("- $($s.numar) — $($s.motiv)") }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Note')
  [void]$sb.AppendLine('- CI e citit pe PR-ul DRAFT: verificările care rulează doar pe PR-uri non-draft (ex. regresia Ofertare) nu sunt incluse; le vezi după „ready”, înainte de merge.')
  [void]$sb.AppendLine('- Deblocarea unui tichet care așteaptă decizie: în paw-data\tichete_dimineata\stare.json, la intrarea lui, asteapta_decizie = false (sau ștergi intrarea).')
  [void]$sb.AppendLine('- Loguri: paw-data\out\tkt-*_rdr_stdout.log, rdr_tkt-*.json, tkt-*_jak.log, rvw_tkt-*.json, tkt-*_rvw_consola.log, tkt-*.diff; jurnal: paw-data\tichete_dimineata\jurnal.log')
  [IO.File]::WriteAllText($FisRaport, $sb.ToString(), $UTF8)
} catch { Jurnal ('raport nescris: ' + $_.Exception.Message) }

$rez = "tichete: " + @($Rezultate).Count + ", raport: " + (Split-Path $FisRaport -Leaf)
if ($LockFs) { $LockFs.Dispose() }
switch -CaseSensitive ($stareFinala) {
  'OK'       { ScrieStare 'OK' $rez; exit 0 }
  'SIMULARE' { ScrieStare 'SIMULARE' $rez; exit 0 }
  'PARTIAL'  { ScrieStare 'PARTIAL' $rez; exit 2 }
  default    { ScrieStare 'EROARE' $eroare; exit 1 }
}
