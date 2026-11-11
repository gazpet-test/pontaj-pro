# lanseaza_agent.ps1 — lansatorul PROPRIU al agentului „Tichete dimineața” (r4 J1; r5: rulează SUB CONTUL WINDOWS AL AGENTULUI).
# Versionat în repo, revizuit odată cu orchestratorul. NU citește și NU apelează rdr.ps1.
# r5 (P1, contul Windows comun): orchestratorul (contul coordonatorului: tichete din BD prin pgpass, review-uri, raport) pornește
# ACEST script sub contul local dedicat al agentului (Process.Start cu credențiale + profil încărcat, mediu dat explicit, job
# object pentru oprire — tichete_dimineata.ps1 → PornesteLansator). Agentul primește DOAR: brief-ul (stdin), tokenul GitHub al
# contului lui (TICHETE_GH_TOKEN), lansare.json (doar-citire) și worktree-ul. Nimic din profilul coordonatorului.
# La FIECARE pornire, înainte de orice: VerificaCont (contul curent ≠ coordonatorul, nu e în Administrators, nu poate citi
# profilul / pgpass / gh / paw-data ale coordonatorului, nu poate scrie garda / setările / lansare.json). Orice acces => refuz.
# Utilizare (o face orchestratorul, sub contul agentului):
#   powershell -NoProfile -File lanseaza_agent.ps1 -Config <rădăcină>\setari\lansare.json -Numar TKT-2026-0134
#     -Branch tichete/tkt-2026-0134-i1 [-Effort medium|high]          (brief-ul pe stdin)
#   … -DoarVerificareCont    doar probele contului (instalare / fiecare pornire a orchestratorului)
#   … -DoarLinie             linia de comandă a agentului (JSON, fără secrete), fără să pornească nimic
# Ieșire: <rădăcină>\iesire\<slug>\agent.json (stdout-ul claude -p --output-format json), agent.err.log, garda.log, stare.txt.
# Ultima linie din stare.txt / stdout: AGT_GATA <slug> | AGT_CONT_OK | AGT_EROARE: <motiv>. Cod: 0 = gata, 1 = eroare.
param(
  [Parameter(Mandatory)][string]$Config,
  [string]$Numar = '',
  [string]$Branch = '',
  [ValidateSet('medium', 'high')][string]$Effort = 'high',
  [switch]$DoarLinie,
  [switch]$DoarVerificareCont
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
Import-Module (Join-Path $PSScriptRoot 'tichete_lib.psm1') -Force
$UTF8 = New-Object System.Text.UTF8Encoding($false)
$Ag = (Get-ReguliTichete).agent_tichete
$FisStareIesire = ''

function Iesi([string]$linie, [int]$cod) {
  if ($FisStareIesire) { try { [IO.File]::WriteAllText($FisStareIesire, $linie + "`r`n", $UTF8) } catch {} }
  Write-Output $linie
  exit $cod
}
function Motiv($e) { return (Get-TextSigurLinie $e.Exception.Message 200) }

# ── 1. Configurarea (lansare.json, scrisă de orchestrator, doar-citire pentru agent) ──────────────────────────────
try {
  if (-not (Test-CaleSimpla $Config) -or -not $Config.EndsWith('\setari\lansare.json', [StringComparison]::OrdinalIgnoreCase)) { throw 'Config trebuie sa fie <radacina>\setari\lansare.json' }
  $cfgT = Test-ConfigAgent -Text ([IO.File]::ReadAllText($Config, $UTF8)) -Lansare
  if (-not $cfgT.ok) { throw ('lansare.json: ' + ((@($cfgT.motive) | Select-Object -First 3) -join '; ')) }
  $Cfg = $cfgT.cfg
  $Ra = Get-CaiRadacinaAgent $Cfg.radacina_agent
  if ($Config -ine $Ra.fisLansare) { throw 'lansare.json nu e cel din radacina agentului' }
  $slug = if ($DoarVerificareCont) { '_verificare' } else { Get-SlugTichet $Numar }
  if (-not (Test-Path -LiteralPath $Ra.iesire)) { New-Item -ItemType Directory -Path $Ra.iesire | Out-Null }
  $DirIesire = Join-Path $Ra.iesire $slug
  if (-not (Test-Path -LiteralPath $DirIesire)) { New-Item -ItemType Directory -Path $DirIesire | Out-Null }
  if (((Get-Item -LiteralPath $DirIesire -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'directorul de iesire e o legatura' }
  $FisStareIesire = Join-Path $DirIesire 'stare.txt'
} catch { Iesi ('AGT_EROARE: ' + (Motiv $_)) 1 }

# ── 2. Contul Windows: probele de izolare (SUB contul agentului) ───────────────────────────────────────────────
function TestCitire([string]$p) {
  # $true dacă procesul curent poate citi calea (director: listare; fișier: deschidere pentru citire). Lipsă / refuz => $false.
  try {
    if (Test-Path -LiteralPath $p -PathType Container) { [void][IO.Directory]::GetFileSystemEntries($p); return $true }
    if (Test-Path -LiteralPath $p -PathType Leaf) { $f = [IO.File]::Open($p, 'Open', 'Read', 'ReadWrite'); $f.Close(); return $true }
  } catch {}
  return $false
}
function TestScriere([string]$p) {
  # $true dacă procesul curent poate scrie: director => creează (și șterge) un fișier de probă; fișier => deschidere pentru scriere
  # FĂRĂ trunchiere. Lipsă / refuz => $false.
  try {
    if (Test-Path -LiteralPath $p -PathType Container) {
      $pr = Join-Path $p ('proba_scriere_' + [guid]::NewGuid().ToString('N') + '.tmp')
      $f = [IO.File]::Open($pr, 'CreateNew', 'Write', 'None'); $f.Close()
      try { [IO.File]::Delete($pr) } catch {}
      return $true
    }
    if (Test-Path -LiteralPath $p -PathType Leaf) { $f = [IO.File]::Open($p, 'Open', 'Write', 'ReadWrite'); $f.Close(); return $true }
  } catch {}
  return $false
}
function VerificaCont {
  $eu = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $eu.User.Value
  if ($sid -ceq $Cfg.sid_coordonator) { throw 'agentul ruleaza sub contul coordonatorului' }
  $numeEu = [string]$eu.Name
  if (-not $numeEu.EndsWith('\' + $Cfg.cont_windows, [StringComparison]::OrdinalIgnoreCase)) { throw ('contul curent nu e contul agentului din configurare') }
  # grupurile tokenului, inclusiv cele „doar pentru refuz” (UAC): Administrators = S-1-5-32-544
  $g = & whoami.exe /groups /fo csv /nh
  if ($LASTEXITCODE -ne 0) { throw 'whoami /groups esuat' }
  if (@($g | Where-Object { $_ -match 'S-1-5-32-544' }).Count -gt 0) { throw 'contul agentului e membru Administrators' }
  foreach ($p in @($Cfg.interzise_citire)) { if (TestCitire $p) { throw ('contul agentului poate citi o cale a coordonatorului: ' + (Get-TextSigurLinie $p 120)) } }
  $proprii = @($Ra.setari, $Ra.fisSetari, $Ra.fisLansare, $PSScriptRoot) + @(@('garda_agent.mjs', 'tichete_lib.mjs', 'tichete_lib.psm1', 'reguli.json', 'lanseaza_agent.ps1', 'sablon_brief.md') | ForEach-Object { Join-Path $PSScriptRoot $_ })
  foreach ($p in @(@($Cfg.interzise_scriere) + $proprii)) { if (TestScriere $p) { throw ('contul agentului poate scrie o cale protejata: ' + (Get-TextSigurLinie $p 120)) } }
  foreach ($p in @($Cfg.claude_exe, $Cfg.node_exe)) { if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw ('lipseste ' + (Split-Path -Leaf $p)) }; if (TestScriere $p) { throw ('contul agentului poate inlocui ' + (Split-Path -Leaf $p)) } }
}
# ── 3. Intrările (validare strictă) + linia de comandă (-DoarLinie: doar o afișează, fără probe și fără să pornească nimic) ─
if (-not $DoarVerificareCont) {
  try {
    if (-not (Test-BranchPropriu $Numar $Branch)) { throw 'branch invalid pentru tichet' }
    $argv = @(Get-ArgvAgent -Numar $Numar -Branch $Branch -Effort $Effort -Setari $Ra.fisSetari)
  } catch { Iesi ('AGT_EROARE: ' + (Motiv $_)) 1 }
  if ($DoarLinie) { Write-Output (ConvertTo-Json -Compress -InputObject @($argv)); exit 0 }
}
try { VerificaCont } catch { Iesi ('AGT_EROARE: ' + (Motiv $_)) 1 }
if ($DoarVerificareCont) { Iesi 'AGT_CONT_OK' 0 }

try {
  # tokenul GitHub al agentului (pus de orchestrator în mediul acestui proces); scos din mediul propriu după citire
  $token = [string][Environment]::GetEnvironmentVariable('TICHETE_GH_TOKEN')
  [Environment]::SetEnvironmentVariable('TICHETE_GH_TOKEN', $null)
  if (-not (Test-FormaTokenAgent $token)) { throw 'tokenul agentului lipseste din mediu' }
  # brief-ul vine pe stdin (orchestratorul nu dă agentului acces la paw-data)
  $ms = New-Object System.IO.MemoryStream
  [Console]::OpenStandardInput().CopyTo($ms)
  $prompt = $UTF8.GetString($ms.ToArray()).TrimStart([char]0xFEFF)
  if (-not $prompt.Trim()) { throw 'brief gol pe stdin' }
  if ($prompt.Length -gt 400000) { throw 'brief prea mare' }
  # setările gărzii: exact cele așteptate (node.exe + garda din folderul acestui script), scrise de orchestrator
  $Garda = Join-Path $PSScriptRoot 'garda_agent.mjs'
  $setAstept = Get-TextSetariAgent -NodeExe $Cfg.node_exe -Garda $Garda
  if (-not (Test-Path -LiteralPath $Ra.fisSetari -PathType Leaf) -or ([IO.File]::ReadAllText($Ra.fisSetari, $UTF8)).Trim() -cne $setAstept) { throw 'setarile garzii lipsesc sau difera de cele asteptate' }
  # worktree pe încercare: <rădăcină>\wt\tkt-2026-0134-i1 (branch-ul e deja validat: tichete/<slug>-i<n>)
  $wt = Join-Path $Ra.wt $Branch.Substring(([string](Get-ReguliTichete).prefix_branch).Length)
  $Mediu = Get-MediuAgent -Baza ([Environment]::GetEnvironmentVariables()) -Token $token -Cfg $Cfg -Worktree $wt
  $Mediu['TICHETE_BRANCH'] = $Branch
  $Mediu['TICHETE_GARDA_LOG'] = Join-Path $DirIesire 'garda.log'
  $token = $null
  $GitExe = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
} catch { Iesi ('AGT_EROARE: ' + (Motiv $_)) 1 }

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
  $vg = Test-ConfigGitAgent -Iesire $r.out -FisierAgent $Ra.gitconfig -Repo $Cfg.repo
  if (-not $vg.ok) { throw ('config git nepermis pentru agent: ' + ((@($vg.motive) | Select-Object -First 3) -join '; ')) }
}
function ProbaGarda([string]$dir) {
  # r5: garda chiar rulează și chiar refuză, ÎNAINTE de agent (node + garda_agent.mjs, cu mediul agentului, în worktree):
  # `ls` (citire „sigură” pe care CLI-ul ar lăsa-o) => exit 2; `git status` => exit 0.
  foreach ($caz in @(@{ cmd = 'ls'; cod = 2 }, @{ cmd = 'git status'; cod = 0 }, @{ cmd = 'git status; ls'; cod = 2 })) {
    $in = ConvertTo-Json -Compress -InputObject ([ordered]@{ hook_event_name = 'PreToolUse'; cwd = $dir; tool_name = 'Bash'; tool_input = [ordered]@{ command = $caz.cmd } })
    $r = Exec $Cfg.node_exe @($Garda) $dir 60 $in
    if ($r.exit -ne $caz.cod) { throw ('proba garzii a esuat pe "' + $caz.cmd + '" (exit ' + $r.exit + ', asteptat ' + $caz.cod + ')') }
  }
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
  [void](Git @('-C', $Ra.clona, 'worktree', 'remove', '--force', $dir))
}

$final = ''; $cod = 1; $creat = $false
try {
  # ── 4. gitconfig + director gh ale agentului (rescrise la fiecare pornire, în <rădăcină>\cfg) ─────────────────
  foreach ($d in @($Ra.cfg, $Ra.gh, $Ra.wt)) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }
  [IO.File]::WriteAllText($Ra.gitconfig, (Get-TextGitconfigAgent $Cfg), $UTF8)
  VerificaGit $Ra.clona
  # ── 5. worktree propriu pe tichet (încercare), pornit din origin/main ──────────────────────────────────────
  if (Test-Path -LiteralPath $wt) {
    if (-not (WorktreeCurat $wt)) { throw ('worktree ramas cu modificari neimpinse: ' + (Split-Path -Leaf $wt) + ' (de verificat de om)') }
    StergeWorktree $wt
    if (Test-Path -LiteralPath $wt) { throw ('worktree vechi blocat: ' + (Split-Path -Leaf $wt)) }
  }
  $r = Git @('-C', $Ra.clona, 'fetch', '-q', 'origin')
  if ($r.exit -ne 0) { throw 'git fetch esuat' }
  $r = Git @('-C', $Ra.clona, 'worktree', 'add', '-q', '--detach', $wt, 'origin/main')
  if ($r.exit -ne 0) { throw 'git worktree add esuat' }
  $creat = $true
  # dependențele: legătură către node_modules din clona de bază (garda refuză uneltele de fișiere pe node_modules)
  if (-not (Test-Path -LiteralPath (Join-Path $wt 'node_modules')) -and (Test-Path -LiteralPath (Join-Path $Ra.clona 'node_modules'))) {
    & cmd.exe /d /c mklink /J (Join-Path $wt 'node_modules') (Join-Path $Ra.clona 'node_modules') | Out-Null
  }
  VerificaGit $wt
  ProbaGarda $wt
  # ── 6. agentul ──────────────────────────────────────────────────────────────────────────────────────────
  $r = Exec $Cfg.claude_exe $argv $wt ([int]$Ag.minute_max * 60) $prompt
  [IO.File]::WriteAllText((Join-Path $DirIesire 'agent.json'), [string]$r.out, $UTF8)
  [IO.File]::WriteAllText((Join-Path $DirIesire 'agent.err.log'), [string]$r.err, $UTF8)
  if ($r.exit -eq -1) { throw 'agentul a depasit timpul maxim' }
  $final = 'AGT_GATA ' + $slug; $cod = 0
} catch {
  $final = 'AGT_EROARE: ' + (Motiv $_); $cod = 1
} finally {
  $ErrorActionPreference = 'Continue'
  if ($creat -and (Test-Path -LiteralPath $wt)) {
    if (WorktreeCurat $wt) { StergeWorktree $wt } else { Write-Output ('AGT_PASTRAT: ' + (Split-Path -Leaf $wt) + ' are modificari neimpinse') }
  }
}
Iesi $final $cod
