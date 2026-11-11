# lanseaza_agent.ps1 — lansatorul PROPRIU al agentului „Tichete dimineața” (r4, J1). Versionat în repo, revizuit odată cu
# orchestratorul. NU citește și NU apelează rdr.ps1: construiește el însuși linia de comandă a agentului (Get-ArgvAgent din
# tichete_lib.psm1, doar din reguli.json → agent_tichete), într-un worktree propriu pe tichet, cu mediu curățat și cu
# identitatea GitHub SEPARATĂ a agentului (tokenul din %USERPROFILE%\.tichete-agent\, README → „Bariera de identitate”).
# Utilizare (o face orchestratorul): powershell -File lanseaza_agent.ps1 -Brief <paw-data\brief\tkt-….md> -Numar TKT-2026-0134
#   -Branch tichete/tkt-2026-0134-i1 [-Effort medium|high] [-DoarLinie]
# Ieșire: paw-data\out\agent_<slug>.json (stdout-ul claude -p --output-format json) + agent_<slug>.err.log.
# Ultima linie din stdout: AGT_GATA <slug> | AGT_OCUPAT: … (exit 3) | AGT_EROARE: <motiv> (exit 1).
# -DoarLinie: scrie linia de comandă (JSON, fără secrete) și iese, fără să pornească nimic (pentru review / test).
# Mediul serverului (din rdr.ps1, citit doar ca model): binarul claude din npm global, login-ul Claude în CLAUDE_CONFIG_DIR,
# clona de bază + rădăcina worktree-urilor, cele 3 locuri comune cu rdr.ps1 (lock_rdr_1..3). Clona / rădăcina se pot schimba
# din agent.json (clona_baza, radacina_worktree).
param(
  [Parameter(Mandatory)][string]$Brief,
  [Parameter(Mandatory)][string]$Numar,
  [Parameter(Mandatory)][string]$Branch,
  [ValidateSet('medium', 'high')][string]$Effort = 'high',
  [switch]$DoarLinie
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
Import-Module (Join-Path $PSScriptRoot 'tichete_lib.psm1') -Force

$DataDir      = 'C:\Users\Public\paw-data'
$ConfigClaude = 'C:\Users\Gazpet-Ai\.claude-redari'
$ClonaImplicita = 'C:\Users\Gazpet-Ai\gazpet-erp-redari'
$RadacinaImplicita = 'C:\Users\Gazpet-Ai\rdr-wt'
$UTF8 = New-Object System.Text.UTF8Encoding($false)
$Ag = (Get-ReguliTichete).agent_tichete

function Iesi([string]$linie, [int]$cod) { Write-Output $linie; exit $cod }

# ── 1. Intrările (validare strictă) + linia de comandă ──────────────────────────────────────────────────────
try {
  $slug = Get-SlugTichet $Numar
  if (-not (Test-BranchPropriu $Numar $Branch)) { throw 'branch invalid pentru tichet' }
  $argv = @(Get-ArgvAgent -Numar $Numar -Branch $Branch -Effort $Effort)
} catch { Iesi ('AGT_EROARE: ' + (Get-TextSigurLinie $_.Exception.Message 200)) 1 }
if ($DoarLinie) { Write-Output (ConvertTo-Json -Compress -InputObject @($argv)); exit 0 }

try {
  $b = (Resolve-Path -LiteralPath $Brief).Path
  if (-not $b.StartsWith((Join-Path $DataDir 'brief') + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $b.EndsWith('.md', [StringComparison]::OrdinalIgnoreCase)) { throw 'brief-ul trebuie sa fie un .md in paw-data\brief' }
  $prompt = [IO.File]::ReadAllText($b, $UTF8)
  if (-not $prompt.Trim()) { throw 'brief gol' }
  # ── 2. Configurarea agentului (în afara repo-ului) + tokenul lui ───────────────────────────────────────────
  $Cai = Get-CaiAgent $env:USERPROFILE
  $cfgT = Test-ConfigAgent $(if (Test-Path -LiteralPath $Cai.config -PathType Leaf) { [IO.File]::ReadAllText($Cai.config, $UTF8) } else { '' })
  if (-not $cfgT.ok) { throw ('agent.json: ' + ((@($cfgT.motive) | Select-Object -First 3) -join '; ')) }
  $Cfg = $cfgT.cfg
  $token = if (Test-Path -LiteralPath $Cai.token -PathType Leaf) { ([IO.File]::ReadAllText($Cai.token, $UTF8)).Trim() } else { '' }
  if (-not (Test-FormaTokenAgent $token)) { throw 'tokenul agentului lipseste sau nu are forma unui token GitHub de utilizator' }
  $Clona = if ($Cfg.clona_baza) { $Cfg.clona_baza } else { $ClonaImplicita }
  $Radacina = if ($Cfg.radacina_worktree) { $Cfg.radacina_worktree } else { $RadacinaImplicita }
  # worktree pe încercare: <rădăcină>\tkt-2026-0134-i1 (branch-ul e deja validat: tichete/<slug>-i<n>)
  $wt = Join-Path $Radacina $Branch.Substring(([string](Get-ReguliTichete).prefix_branch).Length)
  $Mediu = Get-MediuAgent -Baza ([Environment]::GetEnvironmentVariables()) -Token $token -Cai $Cai -ConfigClaude $ConfigClaude
  $token = $null
  $GitExe = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $ClaudeExe = $null
  $c = @(Get-Command claude.exe -CommandType Application -ErrorAction SilentlyContinue)
  if ($c.Count -gt 0) { $ClaudeExe = $c[0].Source }
  else {
    $cmd = @(Get-Command claude.cmd -CommandType Application -ErrorAction SilentlyContinue)
    if ($cmd.Count -gt 0) {
      $e = Join-Path (Split-Path -Parent $cmd[0].Source) 'node_modules\@anthropic-ai\claude-code\bin\claude.exe'
      if (Test-Path -LiteralPath $e -PathType Leaf) { $ClaudeExe = $e }
    }
  }
  if (-not $ClaudeExe) { throw 'nu gasesc claude.exe' }
} catch { Iesi ('AGT_EROARE: ' + (Get-TextSigurLinie $_.Exception.Message 200)) 1 }

function Exec([string]$exe, [string[]]$a, [string]$cwd, [int]$sec = 300, [AllowNull()][string]$stdin = $null) {
  # proces cu mediul AGENTULUI (înlocuit complet, nu moștenit); stdin trimis ca octeți UTF-8; timeout => kill pe tot arborele
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = Join-ArgvWindows $a
  $psi.UseShellExecute = $false
  # ([string] transformă $null în '' => testul e pe „gol”, nu pe $null)
  $cuStdin = -not [string]::IsNullOrEmpty($stdin)
  $psi.RedirectStandardInput = $cuStdin
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $UTF8; $psi.StandardErrorEncoding = $UTF8
  $psi.CreateNoWindow = $true
  if ($cwd) { $psi.WorkingDirectory = $cwd }
  $psi.EnvironmentVariables.Clear()
  foreach ($k in $Mediu.Keys) { $psi.EnvironmentVariables[$k] = [string]$Mediu[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync()
  if ($cuStdin) {
    $oct = $UTF8.GetBytes($stdin)
    $p.StandardInput.BaseStream.Write($oct, 0, $oct.Length); $p.StandardInput.BaseStream.Flush(); $p.StandardInput.Close()
  }
  if (-not $p.WaitForExit($sec * 1000)) {
    try { & taskkill.exe /PID $p.Id /T /F | Out-Null } catch {}
    return @{ exit = -1; out = ''; err = 'timeout' }
  }
  $p.WaitForExit()
  return @{ exit = $p.ExitCode; out = $so.Result; err = $se.Result }
}
function Git([string[]]$a, [string]$cwd = '') { return Exec $GitExe $a $cwd 300 }
function VerificaGit([string]$dir) {
  # credențialele / remote-ul văzute de git cu mediul agentului (fail-closed)
  $r = Git @('-C', $dir, 'config', '--show-origin', '-z', '--list')
  if ($r.exit -ne 0) { throw 'git config --list esuat' }
  $v = Test-ConfigGitAgent -Iesire $r.out -FisierAgent $Cai.gitconfig -Repo $Cfg.repo
  if (-not $v.ok) { throw ('config git nepermis pentru agent: ' + ((@($v.motive) | Select-Object -First 3) -join '; ')) }
}
function WorktreeCurat([string]$dir) {
  # curat = fără modificări și fără commit-uri neîmpinse (la fel ca rdr.ps1); altfel rămâne pentru recuperare
  $s = Git @('-C', $dir, 'status', '--porcelain')
  if ($s.exit -ne 0 -or $s.out.Trim()) { return $false }
  $u = Git @('-C', $dir, 'rev-parse', '--abbrev-ref', '@{u}')
  if ($u.exit -eq 0) { $n = Git @('-C', $dir, 'log', '--oneline', '@{u}..HEAD'); return ($n.exit -eq 0 -and -not $n.out.Trim()) }
  $n = Git @('-C', $dir, 'log', '--oneline', 'origin/main..HEAD')
  return ($n.exit -eq 0 -and -not $n.out.Trim())
}
function StergeWorktree([string]$dir) {
  # (fără 2>$null: în PS 5.1, cu ErrorActionPreference = Stop, stderr-ul nativ redirecționat devine eroare terminală)
  if (Test-Path -LiteralPath (Join-Path $dir 'node_modules')) { & cmd.exe /d /c rmdir (Join-Path $dir 'node_modules') | Out-Null }
  [void](Git @('-C', $Clona, 'worktree', 'remove', '--force', $dir))
}

# ── 3. Un loc din 3 (comun cu rdr.ps1: „maximum 3 rulări simultan”) ─────────────────────────────────────────
$fs = $null
foreach ($i in 1..3) {
  try { $fs = [IO.File]::Open((Join-Path $DataDir ('lock_rdr_' + $i)), 'OpenOrCreate', 'ReadWrite', 'None'); break } catch { $fs = $null }
}
if (-not $fs) { Iesi 'AGT_OCUPAT: 3 rulari deja active' 3 }

$final = ''; $cod = 1; $creat = $false
try {
  # ── 4. gitconfig + director gh ale agentului (rescrise la fiecare pornire) ───────────────────────────────────
  if (-not (Test-Path -LiteralPath $Cai.gh)) { New-Item -ItemType Directory -Path $Cai.gh | Out-Null }
  [IO.File]::WriteAllText($Cai.gitconfig, (Get-TextGitconfigAgent $Cfg), $UTF8)
  VerificaGit $Clona
  # ── 5. worktree propriu pe tichet (încercare), pornit din origin/main ────────────────────────────────────────
  if (Test-Path -LiteralPath $wt) {
    if (-not (WorktreeCurat $wt)) { throw ('worktree ramas cu modificari neimpinse: ' + (Split-Path -Leaf $wt) + ' (de verificat de om)') }
    StergeWorktree $wt
    if (Test-Path -LiteralPath $wt) { throw ('worktree vechi blocat: ' + (Split-Path -Leaf $wt)) }
  }
  $r = Git @('-C', $Clona, 'fetch', '-q', 'origin')
  if ($r.exit -ne 0) { throw 'git fetch esuat' }
  $r = Git @('-C', $Clona, 'worktree', 'add', '-q', '--detach', $wt, 'origin/main')
  if ($r.exit -ne 0) { throw 'git worktree add esuat' }
  $creat = $true
  # dependențele: legătură către node_modules din clona de bază (ca rdr.ps1)
  if (-not (Test-Path -LiteralPath (Join-Path $wt 'node_modules')) -and (Test-Path -LiteralPath (Join-Path $Clona 'node_modules'))) {
    & cmd.exe /d /c mklink /J (Join-Path $wt 'node_modules') (Join-Path $Clona 'node_modules') | Out-Null
  }
  VerificaGit $wt
  # ── 6. agentul ────────────────────────────────────────────────────────────────────────────────────────────
  $fOut = Join-Path $DataDir ('out\agent_' + $slug + '.json')
  $r = Exec $ClaudeExe $argv $wt ([int]$Ag.minute_max * 60) $prompt
  [IO.File]::WriteAllText($fOut, [string]$r.out, $UTF8)
  [IO.File]::WriteAllText((Join-Path $DataDir ('out\agent_' + $slug + '.err.log')), [string]$r.err, $UTF8)
  if ($r.exit -eq -1) { throw 'agentul a depasit timpul maxim' }
  $final = 'AGT_GATA ' + $slug; $cod = 0
} catch {
  $final = 'AGT_EROARE: ' + (Get-TextSigurLinie $_.Exception.Message 200); $cod = 1
} finally {
  $ErrorActionPreference = 'Continue'
  if ($creat -and (Test-Path -LiteralPath $wt)) {
    if (WorktreeCurat $wt) { StergeWorktree $wt } else { Write-Output ('AGT_PASTRAT: ' + (Split-Path -Leaf $wt) + ' are modificari neimpinse') }
  }
  if ($fs) { $fs.Close() }
}
Iesi $final $cod
