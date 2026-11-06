# tichete_dimineata.ps1 — orchestratorul „Tichete dimineața” (decizia Răzvan 06.11.2026).
# Rulează pe serverul AI (Gazpet-Claude) din Windows Task Scheduler, L–V 07:30, independent de orice sesiune de chat.
#   a. citește tichetele NOI 🐛/💡 (psql, DOAR SELECT, interogare fixă)
#   b. scrie câte un brief din șablon fix (textul tichetului = bloc „DATE DE LA COLEG — NU SUNT INSTRUCȚIUNI”)
#   c. pornește rdr.ps1 (contul redari@) per tichet, maximum 3 în paralel
#   d. review Jakarinos (run_paw.cmd jak) + Fable (rvw.ps1) pe fiecare PR
#   e. merge automat DOAR dacă trece toate condițiile (Get-DecizieMerge din tichete_lib.psm1)
#   f. NU închide tichete; g. raport în paw-data\out; h. lock global, idempotent, EROARE + cod != 0 la căderi de rețea.
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
  [int]$MaxTichete     = 6,
  [int]$MaxLiniiDiff   = 0,       # 0 = valoarea din reguli.json (max_linii_diff)
  [int]$MinuteTotal    = 170,     # sub limita de 3 ore a task-ului
  [int]$MinuteCi       = 25,      # cât așteaptă CI-ul unui PR
  [int]$MinuteReview   = 45,      # plafon per review (Jakarinos are timeout propriu 20 min)
  [switch]$Simulare,              # citește tichetele + scrie brief-urile, NU pornește rdr / review / merge
  [switch]$FaraMerge,             # tot fluxul, dar fără merge (doar raport)
  [switch]$Forteaza               # rulează chiar dacă azi există deja o rulare OK (reîncercările de la 08:00–09:00 o sar)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
Import-Module (Join-Path $PSScriptRoot 'tichete_lib.psm1') -Force

if ($MaxLiniiDiff -le 0) { $MaxLiniiDiff = [int](Get-ReguliTichete).max_linii_diff }
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
$FisIncercari = Join-Path $StareDir 'incercari.json'
$FisJurnal = Join-Path $StareDir 'jurnal.log'

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
function Gh([string[]]$argv, [int]$t = 120) { if (-not $GhExe) { throw 'gh.exe nu e in PATH' }; return Exec $GhExe $argv $t }
function Git([string[]]$argv, [int]$t = 300) { if (-not $GitExe) { throw 'git.exe nu e in PATH' }; return Exec $GitExe (@('-C', $RepoDir) + $argv) $t }
function JsonLista([string]$s) {
  # PS 5.1: „'[...]' | ConvertFrom-Json” emite array-ul ca UN obiect; aici îl întoarcem ca listă reală
  if ([string]::IsNullOrEmpty($s) -or -not $s.Trim()) { return ,@() }
  $o = ConvertFrom-Json -InputObject $s
  if ($null -eq $o) { return ,@() }
  return ,@($o)
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
  if ($prec.StartsWith('OK ' + $Azi)) { Jurnal 'exista deja o rulare OK azi - ies (reincercare inutila)'; $LockFs.Dispose(); exit 0 }
}

$eroare = ''; $nrMerge = 0; $stareFinala = 'EROARE'; $incercari = @()
$Rezultate = New-Object System.Collections.ArrayList   # câte un hashtable per tichet
$Sarite = @()
try {
  ScrieStare 'IN_CURS' ('pornit ' + $Start.ToString('HH:mm'))
  Jurnal ("start; repo=$RepoDir simulare=" + [bool]$Simulare + ' faraMerge=' + [bool]$FaraMerge)

  # ── Verificări preliminare (rețea, unelte) ───────────────────────────────────────────────────────────────
  foreach ($f in @($Psql) + $(if ($Simulare) { @() } else { @($Rdr, $Rvw, $RunPaw) })) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "lipseste $f" }
  }
  [void](CaleSimpla $DataDir); [void](CaleSimpla $Rdr); [void](CaleSimpla $Rvw); [void](CaleSimpla $RunPaw)
  $r = Gh @('auth', 'status') 60
  if ($r.exit -ne 0) { throw 'gh: autentificare / retea indisponibila' }
  $r = Git @('fetch', '--prune', 'origin')
  if ($r.exit -ne 0) { throw ('git fetch esuat: ' + (Get-TextSigurLinie $r.err 200)) }

  # ── a. Tichetele (SELECT fix, fără niciun parametru) ────────────────────────────────────────────────────
  # tranzacție READ ONLY; jsonb::text = o singură linie (json_agg ar pune linii noi între elemente)
  $sql = @'
BEGIN TRANSACTION READ ONLY;
SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb)::text
FROM (
  SELECT id, numar_tichet, titlu, subcategorie, status, created_at, departament, entitate_descriere, descriere
  FROM public.tichete
  WHERE status IN ('deschis', 'atribuit')
    AND subcategorie IN ('eroare_erp', 'cerere_functie')
  ORDER BY created_at
  LIMIT 50
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
  Jurnal ('tichete citite: ' + $tichete.Count)

  # ── Idempotență: PR-uri (orice stare), branch-uri remote, încercări anterioare ───────────────────────────
  $r = Gh @('pr', 'list', '--state', 'all', '--limit', '400', '--json', 'number,title,headRefName')
  if ($r.exit -ne 0) { throw 'gh pr list esuat' }
  $prToate = JsonLista $r.out
  $r = Git @('ls-remote', '--heads', 'origin')
  if ($r.exit -ne 0) { throw 'git ls-remote esuat' }
  $branchuri = @(($r.out -split "`n") | ForEach-Object { ($_ -replace '^\S+\s+refs/heads/', '').Trim() } | Where-Object { $_ })
  $incercari = @()
  if (Test-Path -LiteralPath $FisIncercari) { $incercari = JsonLista (CitesteText $FisIncercari) }
  $sel = Select-TicheteNoi -Tichete $tichete -TitluriPr @($prToate | ForEach-Object { $_.title }) `
         -Branchuri (@($branchuri) + @($prToate | ForEach-Object { $_.headRefName })) `
         -IncercateAnterior @($incercari | ForEach-Object { $_.numar }) -Max $MaxTichete
  $Sarite = @($sel.sarite)
  Jurnal ('de lucru: ' + @($sel.deLucru).Count + ', sarite: ' + $Sarite.Count)

  # ── b. Brief-uri ───────────────────────────────────────────────────────────────────────────────────────
  foreach ($t in @($sel.deLucru)) {
    $slug = Get-SlugTichet $t.numar_tichet
    $fb = Join-Path $BriefDir ($slug + '.md')
    [IO.File]::WriteAllText($fb, (New-BriefTichet -Tichet $t), $UTF8)
    [void]$Rezultate.Add(@{
      numar = [string]$t.numar_tichet; slug = $slug; brief = $fb; effort = (Get-EffortTichet $t)
      sub = [string]$t.subcategorie; titlu = (Get-TextSigurLinie $t.titlu 90)
      etapa = 'coada'; agent = $null; pr = $null; branch = $null; sha = $null; jak = $null; fable = $null
      checks = @(); decizie = $null; merged = $false; nota = ''; reincercari = 0; dupa = $Start
      proc = $null; procJak = $null; procRvw = $null; ciPana = $null; reviewPana = $null; fisiere = @(); diff = ''; linii = 0; cross = $false
    })
  }
  if ($Simulare) { Jurnal 'simulare: brief-uri scrise, nu pornesc rdr'; foreach ($x in $Rezultate) { $x.etapa = 'simulare' } }

  # ── c–e. Bucla: rdr (max $MaxParalel) → review (unul odată) → CI → decizie / merge ─────────────────────
  $ReviewActiv = $null
  while (-not $Simulare) {
    $activ = @($Rezultate | Where-Object { $_.etapa -notin @('gata', 'oprit') })
    if ($activ.Count -eq 0) { break }
    if ((Get-Date) -gt $Deadline) {
      foreach ($x in $activ) { OpresteArbore $x.proc; OpresteArbore $x.procJak; OpresteArbore $x.procRvw; $x.nota = 'oprit la plafonul de timp in etapa ' + $x.etapa; $x.etapa = 'oprit' }
      break
    }

    # c1. rdr terminate
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -eq 'rdr' -and $_.proc.HasExited })) {
      $logOut = Join-Path $OutDir ($x.slug + '_rdr_stdout.log')
      $ult = UltimaLinie $logOut
      if ($x.proc.ExitCode -ne 0 -and $ult -imatch 'ocupat|loc liber|lock' -and $x.reincercari -lt 20) {
        # rdr are toate locurile ocupate (de chat / alte rulări): așteaptă, nu forța
        $x.reincercari++; $x.dupa = (Get-Date).AddMinutes(3); $x.etapa = 'coada'; continue
      }
      $txt = CitesteText (Join-Path $OutDir ('rdr_' + $x.slug + '.json'))
      $rezTxt = $txt
      try { $j = $txt | ConvertFrom-Json; if ($j -and $j.PSObject.Properties['result']) { $rezTxt = [string]$j.result } } catch {}
      $x.agent = Get-RezultatAgent ($rezTxt + "`n" + (CitesteText $logOut))
      if ($x.agent.tip -ne 'PR') { $x.nota = 'agent: ' + $x.agent.tip + ' ' + $x.agent.detaliu; $x.etapa = 'gata'; continue }
      # PR-ul: întâi după URL-ul raportat, apoi după numărul tichetului în titlu (doar PR-uri deschise)
      $r = Gh @('pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,headRefName,headRefOid,isCrossRepository,url')
      $deschise = @(); if ($r.exit -eq 0) { $deschise = JsonLista $r.out }
      $nrUrl = 0; $mu = [regex]::Match([string]$x.agent.detaliu, '/pull/(\d+)'); if ($mu.Success) { $nrUrl = [int]$mu.Groups[1].Value }
      $cand = @($deschise | Where-Object { Test-TichetAreUrmaGit -Numar $x.numar -TitluriPr @($_.title) })
      $pr = @($cand | Where-Object { $_.number -eq $nrUrl }) | Select-Object -First 1
      if (-not $pr) { $pr = $cand | Sort-Object number -Descending | Select-Object -First 1 }
      if (-not $pr) { $x.nota = 'agentul a raportat PR, dar nu gasesc un PR deschis cu ' + $x.numar + ' in titlu'; $x.etapa = 'gata'; continue }
      $x.pr = [int]$pr.number; $x.cross = [bool]$pr.isCrossRepository
      if (@($cand).Count -gt 1) { $x.nota = 'mai multe PR-uri pentru acelasi tichet: ' + ((@($cand) | ForEach-Object { '#' + $_.number }) -join ' ') }
      if (-not (Test-NumeBranch $pr.headRefName)) { $x.nota = 'nume de branch respins la validare'; $x.etapa = 'gata'; continue }
      $x.branch = [string]$pr.headRefName; $x.sha = [string]$pr.headRefOid
      $x.etapa = 'review_coada'
    }

    # c2. pornește rdr cât sunt locuri
    $ruleaza = @($Rezultate | Where-Object { $_.etapa -eq 'rdr' }).Count
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -eq 'coada' -and $_.dupa -le (Get-Date) })) {
      if ($ruleaza -ge $MaxParalel) { break }
      $logOut = Join-Path $OutDir ($x.slug + '_rdr_stdout.log')
      # o ieșire rdr rămasă de la o rulare veche (ex. manuală din chat) nu are voie să fie citită ca rezultat al acesteia
      $fJsonVechi = Join-Path $OutDir ('rdr_' + $x.slug + '.json')
      if ($x.reincercari -eq 0 -and (Test-Path -LiteralPath $fJsonVechi)) { Move-Item -LiteralPath $fJsonVechi -Destination ($fJsonVechi + '.' + $Start.ToString('yyyyMMddHHmm') + '.vechi') -Force }
      $x.proc = PornesteFundal 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Rdr, '-Brief', (CaleSimpla $x.brief), '-Slug', $x.slug, '-Effort', $x.effort) $logOut
      $x.etapa = 'rdr'; $ruleaza++
      Jurnal ("rdr pornit " + $x.numar + " effort=" + $x.effort)
    }

    # d. review: unul odată (lansatorul Paw are barieră globală)
    if ($null -ne $ReviewActiv -and $ReviewActiv.procJak.HasExited -and $ReviewActiv.procRvw.HasExited) {
      $x = $ReviewActiv; $ReviewActiv = $null
      $fj = Join-Path $OutDir ($x.slug + '_jak.log'); $fr = Join-Path $OutDir ($x.slug + '_rvw.log')
      $tj = CitesteText $fj
      $x.jak = if ((UltimaLinie $fj) -cmatch '^PAW_GATA') { Get-VerdictReview $tj } else { @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 } }
      $x.fable = Get-VerdictReview (CitesteText $fr)
      $x.ciPana = (Get-Date).AddMinutes($MinuteCi); $x.etapa = 'ci'
      Jurnal ("review gata " + $x.numar + " jak=" + $x.jak.verdict + " fable=" + $x.fable.verdict)
    } elseif ($null -ne $ReviewActiv -and $ReviewActiv.reviewPana -lt (Get-Date)) {
      OpresteArbore $ReviewActiv.procJak; OpresteArbore $ReviewActiv.procRvw
      $ReviewActiv.jak = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }; $ReviewActiv.fable = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
      $ReviewActiv.nota = 'review oprit la timeout'; $ReviewActiv.ciPana = (Get-Date); $ReviewActiv.etapa = 'ci'; $ReviewActiv = $null
    }
    if ($null -eq $ReviewActiv) {
      $x = @($Rezultate | Where-Object { $_.etapa -eq 'review_coada' }) | Select-Object -First 1
      if ($x) {
        $b = $x.branch
        $r = Git @('fetch', 'origin', 'main', $b)
        $fd = Join-Path $OutDir ($x.slug + '.diff')
        $r2 = Git @('diff', '--no-color', '--no-ext-diff', ('--output=' + $fd), ('origin/main...origin/' + $b))
        $r3 = Git @('diff', '--name-only', ('origin/main...origin/' + $b))
        $r4 = Git @('diff', '--numstat', ('origin/main...origin/' + $b))
        $r5 = Git @('rev-parse', ('origin/' + $b))
        if ($r.exit -ne 0 -or $r2.exit -ne 0 -or $r3.exit -ne 0 -or $r4.exit -ne 0 -or $r5.exit -ne 0) {
          $x.nota = 'nu am putut lua diff-ul branch-ului'; $x.etapa = 'gata'
        } else {
          $x.diff = CitesteText $fd
          $x.fisiere = @(($r3.out -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
          $x.linii = 0; foreach ($l in ($r4.out -split "`n")) { $m = [regex]::Match($l, '^(\d+)\s+(\d+)\s'); if ($m.Success) { $x.linii += [int]$m.Groups[1].Value + [int]$m.Groups[2].Value } }
          if ($r5.out.Trim() -ne $x.sha) { $x.sha = '' }   # head-ul GitHub ≠ ce am descărcat => nu se face merge
          $fbr = Join-Path $BriefDir ($x.slug + '_review.md')
          [IO.File]::WriteAllText($fbr, (New-BriefReview -Numar $x.numar -Pr $x.pr -Branch $b -Diff $x.diff), $UTF8)
          $fj = Join-Path $OutDir ($x.slug + '_jak.log'); $fr = Join-Path $OutDir ($x.slug + '_rvw.log')
          foreach ($f in @($fj, $fr)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
          $x.procJak = PornesteFundal $env:ComSpec @('/d', '/c', (CaleSimpla $RunPaw), 'jak', (CaleSimpla $fbr), (CaleSimpla $fj)) (Join-Path $OutDir ($x.slug + '_jak_consola.log'))
          $x.procRvw = PornesteFundal 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Rvw, '-Ref', $b) $fr
          $x.reviewPana = (Get-Date).AddMinutes($MinuteReview)
          $x.etapa = 'review'; $ReviewActiv = $x
          Jurnal ("review pornit " + $x.numar + " PR #" + $x.pr)
        }
      }
    }

    # e. CI + decizie
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -eq 'ci' })) {
      $r = Gh @('pr', 'checks', [string]$x.pr, '--json', 'name,bucket')
      $ch = @(); try { $ch = JsonLista $r.out } catch {}
      $pending = @($ch | Where-Object { $_.bucket -eq 'pending' }).Count -gt 0
      if ($pending -and $x.ciPana -gt (Get-Date)) { continue }
      $x.checks = $ch
      $r = Gh @('pr', 'view', [string]$x.pr, '--json', 'headRefOid,state')
      $headAcum = ''; try { $headAcum = [string](ConvertFrom-Json -InputObject $r.out).headRefOid } catch {}
      $x.decizie = Get-DecizieMerge -Jak $x.jak -Fable $x.fable -Checks $ch -Nelocal ([bool]$x.agent.nelocal) -Fisiere $x.fisiere `
                     -Diff $x.diff -LiniiDiff $x.linii -MaxLiniiDiff $MaxLiniiDiff -CrossRepo $x.cross -HeadSchimbat ((-not $x.sha) -or ($headAcum -ne $x.sha))
      if ($x.decizie.merge -and -not $FaraMerge) {
        $r = Gh @('pr', 'ready', [string]$x.pr)
        $r2 = Gh @('pr', 'merge', [string]$x.pr, '--merge', '--match-head-commit', $x.sha)
        if ($r2.exit -eq 0) { $x.merged = $true; Jurnal ("MERGE " + $x.numar + " PR #" + $x.pr) }
        else { $x.nota = 'merge esuat: ' + (Get-TextSigurLinie $r2.err 200) }
      } elseif ($x.decizie.merge) { $x.nota = 'ar fi trecut, dar rulare cu -FaraMerge' }
      $x.etapa = 'gata'
    }

    Start-Sleep -Seconds 15
  }

  $nrMerge = @($Rezultate | Where-Object { $_.merged }).Count
  $stareFinala = 'OK'
} catch {
  $stareFinala = 'EROARE'
  $eroare = Get-TextSigurLinie $_.Exception.Message 300
  Jurnal ('EROARE: ' + $eroare)
  foreach ($x in $Rezultate) { OpresteArbore $x.proc; OpresteArbore $x.procJak; OpresteArbore $x.procRvw }
}

# ── Starea încercărilor (și după EROARE): un tichet pe care agentul l-a terminat (PR / NELOCAL / ESUAT) nu se reia
#    automat; chat-ul șterge intrarea din incercari.json ca să-l reia. Cele oprite înainte de rezultat se reiau mâine.
try {
  $lista = New-Object System.Collections.ArrayList
  foreach ($i in @($incercari)) { [void]$lista.Add([ordered]@{ numar = $i.numar; data = $i.data; rezultat = $i.rezultat }) }
  $noi = 0
  foreach ($x in $Rezultate) {
    if ($null -eq $x.agent -and $null -eq $x.pr) { continue }
    $rez = if ($x.merged) { 'merge PR #' + $x.pr } elseif ($x.pr) { 'PR #' + $x.pr + ' deschis' } else { $x.agent.tip + ' ' + $x.agent.detaliu }
    [void]$lista.Add([ordered]@{ numar = $x.numar; data = $Azi; rezultat = (Get-TextSigurLinie $rez 200) }); $noi++
  }
  if ($noi -gt 0) { [IO.File]::WriteAllText($FisIncercari, (ConvertTo-Json -InputObject @($lista) -Depth 4), $UTF8) }
} catch { Jurnal ('incercari nescrise: ' + $_.Exception.Message) }

# ── g. Raport ─────────────────────────────────────────────────────────────────────────────────────────────
try {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# Tichete dimineața — $Azi")
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine("Pornit $($Start.ToString('HH:mm')), terminat $((Get-Date).ToString('HH:mm')). Stare: **$stareFinala**" + $(if ($Simulare) { ' (SIMULARE)' } elseif ($FaraMerge) { ' (fara merge)' } else { '' }))
  if ($stareFinala -eq 'EROARE') { [void]$sb.AppendLine(''); [void]$sb.AppendLine("Eroare: $eroare") }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('Tichetele NU se închid automat (decizia B) — se închid din chat după verificare.')
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Mergeuite')
  $m = @($Rezultate | Where-Object { $_.merged })
  if ($m.Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($x in $m) { [void]$sb.AppendLine("- $($x.numar) — PR #$($x.pr) ($($x.branch)) — $($x.titlu)") }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Pentru chat (PR deschis, fără merge automat)')
  $p = @($Rezultate | Where-Object { $_.pr -and -not $_.merged })
  if ($p.Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($x in $p) {
    $mot = if ($x.decizie) { ($x.decizie.motive -join '; ') } else { 'neevaluat' }
    $jv = if ($x.jak) { "$($x.jak.verdict) P0=$($x.jak.p0) P1=$($x.jak.p1)" } else { '-' }
    $fv = if ($x.fable) { "$($x.fable.verdict) P0=$($x.fable.p0) P1=$($x.fable.p1)" } else { '-' }
    [void]$sb.AppendLine("- $($x.numar) — PR #$($x.pr) — Jakarinos: $jv · Fable: $fv — motive: $mot $(if ($x.nota) { '— ' + $x.nota })")
  }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Fără PR (NELOCAL / eșuat / oprit)')
  $f = @($Rezultate | Where-Object { -not $_.pr })
  if ($f.Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($x in $f) { [void]$sb.AppendLine("- $($x.numar) [$($x.sub)] — $($x.etapa) — $($x.nota) — brief: $($x.brief)") }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## Sărite')
  if (@($Sarite).Count -eq 0) { [void]$sb.AppendLine('- (niciunul)') }
  foreach ($s in @($Sarite)) { [void]$sb.AppendLine("- $($s.numar) — $($s.motiv)") }
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('Loguri: paw-data\out\tkt_*_rdr_stdout.log, *_jak.log, *_rvw.log, *.diff; jurnal: paw-data\tichete_dimineata\jurnal.log')
  [IO.File]::WriteAllText($FisRaport, $sb.ToString(), $UTF8)
} catch { Jurnal ('raport nescris: ' + $_.Exception.Message) }

if ($stareFinala -eq 'OK') {
  ScrieStare 'OK' ("tichete: " + @($Rezultate).Count + ", merge: " + $nrMerge + ", raport: " + (Split-Path $FisRaport -Leaf))
  if ($LockFs) { $LockFs.Dispose() }
  exit 0
} else {
  ScrieStare 'EROARE' $eroare
  if ($LockFs) { $LockFs.Dispose() }
  exit 1
}
