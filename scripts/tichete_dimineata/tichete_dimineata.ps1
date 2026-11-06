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
  # repo-ul are > 1000 PR-uri: limita trebuie să le cuprindă pe toate (altfel un tichet cu PR vechi s-ar relua)
  $r = Gh @('pr', 'list', '--state', 'all', '--limit', '5000', '--json', 'number,title,headRefName') 300
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
      reincercariJak = 0; reviewDupa = $Start; regiuni = @()
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
      $fJson = Join-Path $OutDir ('rdr_' + $x.slug + '.json')
      if ($x.proc.ExitCode -ne 0 -and -not (Test-Path -LiteralPath $fJson) -and $ult -imatch '\bocupat|\bloc liber|\block\b' -and $x.reincercari -lt 20) {
        # rdr are toate locurile ocupate (de chat / alte rulări): așteaptă, nu forța
        $x.reincercari++; $x.dupa = (Get-Date).AddMinutes(3); $x.etapa = 'coada'; continue
      }
      # Rezultatul se citește DOAR din câmpul „result” al rdr_<slug>.json (contractul rdr.ps1). Stdout-ul nu se parsează:
      # poate conține ecoul brief-ului, care are chiar liniile „REZULTAT_TICHET: ...” din șablon.
      $rezTxt = Get-CampResult (CitesteText $fJson)
      if ($null -eq $rezTxt) { $x.agent = @{ tip = 'NECUNOSCUT'; detaliu = 'lipseste / nu se citeste rdr_' + $x.slug + '.json (exit ' + $x.proc.ExitCode + ')'; nelocal = $false } }
      else { $x.agent = Get-RezultatAgent $rezTxt }
      if ($x.agent.tip -ne 'PR') { $x.nota = 'agent: ' + $x.agent.tip + ' ' + $x.agent.detaliu; $x.etapa = 'gata'; continue }
      # PR-ul: întâi după URL-ul raportat, apoi după numărul tichetului în titlu / branch (doar PR-uri deschise)
      $r = Gh @('pr', 'list', '--state', 'open', '--limit', '300', '--json', 'number,title,headRefName,headRefOid,isCrossRepository,url')
      $deschise = @(); if ($r.exit -eq 0) { $deschise = JsonLista $r.out }
      $nrUrl = 0; $mu = [regex]::Match([string]$x.agent.detaliu, '/pull/(\d+)'); if ($mu.Success) { $nrUrl = [int]$mu.Groups[1].Value }
      $cand = @($deschise | Where-Object { Test-TichetAreUrmaGit -Numar $x.numar -TitluriPr @($_.title) -Branchuri @($_.headRefName) })
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
      if (Test-Path -LiteralPath $fJsonVechi) { Move-Item -LiteralPath $fJsonVechi -Destination ($fJsonVechi + '.' + $Start.ToString('yyyyMMddHHmm') + '.vechi') -Force }
      $x.proc = PornesteFundal 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Rdr, '-Brief', (CaleSimpla $x.brief), '-Slug', $x.slug, '-Effort', $x.effort) $logOut
      $x.etapa = 'rdr'; $ruleaza++
      Jurnal ("rdr pornit " + $x.numar + " effort=" + $x.effort)
    }

    # d. review: unul odată (lansatorul Paw are barieră globală).
    #    Contracte: run_paw.cmd jak <brief> <iesire.log> → log-ul, ultima linie PAW_GATA / PAW_EROARE, verdictul pe linia „VERDICT:”;
    #    rvw.ps1 -Brief <brief> -Slug <slug> -Ref <branch> → paw-data\out\rvw_<slug>.json, câmpul „result”.
    #    Amândoi primesc ACELAȘI brief (sablon_review.md + diff-ul). Un proces pornit = $null până termină.
    $NEC = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
    if ($null -ne $ReviewActiv -and ($null -eq $ReviewActiv.procJak -or $ReviewActiv.procJak.HasExited) -and ($null -eq $ReviewActiv.procRvw -or $ReviewActiv.procRvw.HasExited)) {
      $x = $ReviewActiv; $ReviewActiv = $null
      if ($null -ne $x.procRvw) {
        $rezRvw = Get-CampResult (CitesteText (Join-Path $OutDir ('rvw_' + $x.slug + '.json')))
        $x.fable = if ($null -eq $rezRvw) { $NEC } else { Get-VerdictReview $rezRvw }
        $x.procRvw = $null
      }
      if ($null -ne $x.procJak) {
        $fj = Join-Path $OutDir ($x.slug + '_jak.log')
        $stJak = Get-StarePaw (UltimaLinie $fj)
        $x.procJak = $null
        if ($stJak -eq 'OCUPAT' -and $x.reincercariJak -lt 10) {
          # Paw ocupat de altă rulare: doar Jakarinos se reia peste 3 minute (verdictul Fable rămâne)
          $x.reincercariJak++; $x.reviewDupa = (Get-Date).AddMinutes(3); $x.etapa = 'review_coada'
          Jurnal ("jak ocupat " + $x.numar + ", reincerc (" + $x.reincercariJak + ")")
        } else {
          $x.jak = if ($stJak -eq 'GATA') { Get-VerdictReview (CitesteText $fj) } else { $NEC }
        }
      }
      if ($null -ne $x.jak -and $null -ne $x.fable) {
        $x.ciPana = (Get-Date).AddMinutes($MinuteCi); $x.etapa = 'ci'
        Jurnal ("review gata " + $x.numar + " jak=" + $x.jak.verdict + " fable=" + $x.fable.verdict)
      }
    } elseif ($null -ne $ReviewActiv -and $ReviewActiv.reviewPana -lt (Get-Date)) {
      OpresteArbore $ReviewActiv.procJak; OpresteArbore $ReviewActiv.procRvw
      $ReviewActiv.jak = $NEC; $ReviewActiv.fable = $NEC
      $ReviewActiv.nota = 'review oprit la timeout'; $ReviewActiv.ciPana = (Get-Date); $ReviewActiv.etapa = 'ci'; $ReviewActiv = $null
    }
    if ($null -eq $ReviewActiv) {
      $x = @($Rezultate | Where-Object { $_.etapa -eq 'review_coada' -and $_.reviewDupa -le (Get-Date) }) | Select-Object -First 1
      if ($x) {
        $b = $x.branch
        $r = Git @('fetch', 'origin', 'main', $b)
        $fd = Join-Path $OutDir ($x.slug + '.diff')
        $interval = 'origin/main...origin/' + $b
        # --no-renames: o redenumire supabase/x → src/y apare cu AMBELE căi (altfel calea interzisă ar lipsi din listă)
        $r2 = Git @('diff', '--no-color', '--no-ext-diff', '--no-renames', ('--output=' + $fd), $interval)
        $r3 = Git @('diff', '--no-renames', '--name-only', $interval)
        $r4 = Git @('diff', '--no-renames', '--numstat', $interval)
        $r5 = Git @('rev-parse', ('origin/' + $b))
        if ($r.exit -ne 0 -or $r2.exit -ne 0 -or $r3.exit -ne 0 -or $r4.exit -ne 0 -or $r5.exit -ne 0) {
          $x.nota = 'nu am putut lua diff-ul branch-ului'; $x.etapa = 'gata'
        } else {
          $x.diff = CitesteText $fd
          $x.fisiere = @(($r3.out -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
          $x.linii = 0
          foreach ($l in ($r4.out -split "`n")) {
            $m = [regex]::Match($l, '^(\d+|-)\s+(\d+|-)\s')
            if (-not $m.Success) { continue }
            if ($m.Groups[1].Value -eq '-') { $x.linii += $MaxLiniiDiff + 1 }   # fișier binar => peste plafon (doar manual)
            else { $x.linii += [int]$m.Groups[1].Value + [int]$m.Groups[2].Value }
          }
          if ($r5.out.Trim() -ne $x.sha) { $x.sha = '' }   # head-ul GitHub ≠ ce am descărcat => nu se face merge
          # regiunile interzise (SalariiPage din src/App.jsx): sursa de pe origin/main; necitită => atinsă (fail-closed)
          $surse = @{}
          foreach ($rg in @((Get-ReguliTichete).regiuni_interzise)) {
            $rs = Git @('show', ('origin/main:' + [string]$rg.fisier))
            $surse[[string]$rg.fisier] = if ($rs.exit -eq 0) { $rs.out } else { $null }
          }
          $x.regiuni = @(Get-RegiuniInterziseAtinse -Diff $x.diff -Fisiere $x.fisiere -Surse $surse)
          $fbr = Join-Path $BriefDir ($x.slug + '_review.md')
          [IO.File]::WriteAllText($fbr, (New-BriefReview -Numar $x.numar -Pr $x.pr -Branch $b -Diff $x.diff), $UTF8)
          if ($null -eq $x.jak) {
            $fj = Join-Path $OutDir ($x.slug + '_jak.log')
            if (Test-Path -LiteralPath $fj) { Remove-Item -LiteralPath $fj -Force }
            $x.procJak = PornesteFundal $env:ComSpec @('/d', '/c', (CaleSimpla $RunPaw), 'jak', (CaleSimpla $fbr), (CaleSimpla $fj)) (Join-Path $OutDir ($x.slug + '_jak_consola.log'))
          }
          if ($null -eq $x.fable) {
            $fr = Join-Path $OutDir ('rvw_' + $x.slug + '.json')
            # o ieșire rvw rămasă de la o rulare veche nu are voie să fie citită ca verdict al acesteia
            if (Test-Path -LiteralPath $fr) { Move-Item -LiteralPath $fr -Destination ($fr + '.' + $Start.ToString('yyyyMMddHHmm') + '.vechi') -Force }
            $x.procRvw = PornesteFundal 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Rvw, '-Brief', (CaleSimpla $fbr), '-Slug', $x.slug, '-Ref', $b) (Join-Path $OutDir ($x.slug + '_rvw_consola.log'))
          }
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
      # zero check-uri imediat după push = CI-ul încă nu s-a înregistrat: se așteaptă ca la pending (până la plafon)
      if (($pending -or @($ch).Count -eq 0) -and $x.ciPana -gt (Get-Date)) { continue }
      $x.checks = $ch
      $r = Gh @('pr', 'view', [string]$x.pr, '--json', 'headRefOid,state,baseRefName')
      $headAcum = ''; $stare = ''; $baza = ''
      try { $pv = ConvertFrom-Json -InputObject $r.out; $headAcum = [string]$pv.headRefOid; $stare = [string]$pv.state; $baza = [string]$pv.baseRefName } catch {}
      $x.decizie = Get-DecizieMerge -Jak $x.jak -Fable $x.fable -Checks $ch -Nelocal ([bool]$x.agent.nelocal) -Fisiere $x.fisiere `
                     -Diff $x.diff -LiniiDiff $x.linii -MaxLiniiDiff $MaxLiniiDiff -CrossRepo $x.cross -HeadSchimbat ((-not $x.sha) -or ($headAcum -ne $x.sha)) `
                     -RegiuniAtinse $x.regiuni -BazaMain ($baza -ceq 'main') -Deschis ($stare -ceq 'OPEN')
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
  [void]$sb.AppendLine('Loguri: paw-data\out\tkt_*_rdr_stdout.log, rdr_tkt_*.json, tkt_*_jak.log, rvw_tkt_*.json, tkt_*_rvw_consola.log, tkt_*.diff; jurnal: paw-data\tichete_dimineata\jurnal.log')
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
