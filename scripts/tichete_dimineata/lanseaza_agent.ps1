# lanseaza_agent.ps1 — lansatorul PROPRIU al agentului „Tichete dimineața” (r4 J1; r5: rulează SUB CONTUL WINDOWS AL AGENTULUI).
# Versionat în repo, revizuit odată cu orchestratorul. NU citește și NU apelează rdr.ps1.
# r5 (P1, contul Windows comun): orchestratorul (contul coordonatorului: tichete din BD prin pgpass, review-uri, raport) pornește
# ACEST script sub contul local dedicat al agentului (Process.Start cu credențiale + profil încărcat, mediu dat explicit, job
# object pentru oprire — tichete_dimineata.ps1 → PornesteLansator). Agentul primește DOAR: brief-ul (stdin), lansare.json
# (doar-citire) și worktree-ul. Nimic din profilul coordonatorului.
# r6 (P1 r5): NICIUN token GitHub în contul agentului — nici la lansator, nici la claude, nici la testele / build-ul rulate de
# agent. Agentul face doar commit LOCAL pe branch-ul rulării; la final lansatorul scrie un bundle git (rezultat.bundle) în
# directorul de ieșire. Push-ul și PR-ul DRAFT le face orchestratorul, după ce a oprit tot job-ul agentului (Publica…).
# Poarta pe stdin (r6): scriptul citește TOT stdin-ul înaintea oricărui proces copil; orchestratorul închide stdin-ul abia
# după ce procesul a intrat în job object (Add-ProcesJob), deci niciun copil nu pornește în afara job-ului.
# La FIECARE pornire, înainte de orice proces al agentului: Test-IzolareCont (tichete_win.psm1: contul curent ≠ coordonatorul,
# nu e în Administrators, nu poate citi profilul / pgpass / gh / paw-data ale coordonatorului, nu poate scrie garda / setările /
# lansare.json — probe reale pe disc). Orice acces => refuz.
# Utilizare (o face orchestratorul, sub contul agentului):
#   powershell -NoProfile -File lanseaza_agent.ps1 -Config <rădăcină>\setari\lansare.json -Numar TKT-2026-0134
#     -Branch tichete/tkt-2026-0134-i1 [-Effort medium|high]          (brief-ul pe stdin)
#   … -DoarVerificareCont    doar probele contului (instalare / fiecare pornire a orchestratorului; stdin gol)
#   … -DoarLinie             linia de comandă a agentului (JSON, fără secrete), fără să pornească nimic
# Ieșire: <rădăcină>\iesire\<slug>\agent.json (stdout-ul claude -p --output-format json), agent.err.log, garda.log, stare.txt,
# rezultat.bundle (doar dacă branch-ul are commit-uri). Toate = date NEÎNCREZUTE pentru orchestrator.
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
Import-Module (Join-Path $PSScriptRoot 'tichete_win.psm1') -Force
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

# ── 1b. Poarta pe stdin (r6): TOT stdin-ul citit ÎNAINTEA oricărui proces copil ──────────────────────────────────
# Orchestratorul scrie brief-ul și închide stdin-ul abia după ce acest proces a intrat în job object; până atunci citirea
# blochează, deci niciun copil (whoami, git, node, claude) nu poate porni în afara job-ului. -DoarLinie nu pornește nimic.
$prompt = ''
if (-not $DoarLinie) {
  try {
    $ms = New-Object System.IO.MemoryStream
    [Console]::OpenStandardInput().CopyTo($ms)
    if ($ms.Length -gt 400000) { throw 'brief prea mare' }
    $prompt = $UTF8.GetString($ms.ToArray()).TrimStart([char]0xFEFF)
  } catch { Iesi ('AGT_EROARE: ' + (Motiv $_)) 1 }
}

# ── 2. Contul Windows: probele de izolare (SUB contul agentului; tichete_win.psm1 → Test-IzolareCont) ─────────────────
function VerificaCont {
  $eu = [Security.Principal.WindowsIdentity]::GetCurrent()
  foreach ($p in @($Cfg.claude_exe, $Cfg.node_exe)) { if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw ('lipseste ' + (Split-Path -Leaf $p)) } }
  $proprii = @($Ra.setari, $Ra.fisSetari, $Ra.fisLansare, $PSScriptRoot, $Cfg.claude_exe, $Cfg.node_exe) +
             @(@('garda_agent.mjs', 'tichete_lib.mjs', 'tichete_lib.psm1', 'tichete_win.psm1', 'reguli.json', 'lanseaza_agent.ps1', 'sablon_brief.md') | ForEach-Object { Join-Path $PSScriptRoot $_ })
  $mot = @(Test-IzolareCont -SidCurent $eu.User.Value -NumeCurent ([string]$eu.Name) -GrupuriCsv @(Get-GrupuriToken) -SidCoordonator $Cfg.sid_coordonator `
             -ContWindows $Cfg.cont_windows -InterziseCitire @($Cfg.interzise_citire) -InterziseScriere (@($Cfg.interzise_scriere) + $proprii))
  if ($mot.Count -gt 0) { throw (Get-TextSigurLinie ([string]$mot[0]) 180) }
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
  # brief-ul a venit pe stdin (1b; orchestratorul nu dă agentului acces la paw-data)
  if (-not $prompt.Trim()) { throw 'brief gol pe stdin' }
  # setările gărzii: exact cele așteptate (node.exe + garda din folderul acestui script), scrise de orchestrator
  $Garda = Join-Path $PSScriptRoot 'garda_agent.mjs'
  $setAstept = Get-TextSetariAgent -NodeExe $Cfg.node_exe -Garda $Garda
  if (-not (Test-Path -LiteralPath $Ra.fisSetari -PathType Leaf) -or ([IO.File]::ReadAllText($Ra.fisSetari, $UTF8)).Trim() -cne $setAstept) { throw 'setarile garzii lipsesc sau difera de cele asteptate' }
  # worktree pe încercare: <rădăcină>\wt\tkt-2026-0134-i1 (branch-ul e deja validat: tichete/<slug>-i<n>)
  $wt = Join-Path $Ra.wt $Branch.Substring(([string](Get-ReguliTichete).prefix_branch).Length)
  # r6: mediul agentului FĂRĂ niciun token (Get-MediuAgent aruncă dacă ar conține vreun secret); testele lui îl moștenesc
  $Mediu = Get-MediuAgent -Baza ([Environment]::GetEnvironmentVariables()) -Cfg $Cfg -Worktree $wt
  $Mediu['TICHETE_BRANCH'] = $Branch
  $Mediu['TICHETE_GARDA_LOG'] = Join-Path $DirIesire 'garda.log'
  $GitExe = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $FisBundle = Join-Path $DirIesire 'rezultat.bundle'
  if (Test-Path -LiteralPath $FisBundle -PathType Leaf) { Remove-Item -LiteralPath $FisBundle -Force }
} catch { Iesi ('AGT_EROARE: ' + (Motiv $_)) 1 }

function Exec([string]$exe, [string[]]$a, [string]$cwd, [int]$sec = 300, [AllowNull()][string]$stdin = $null) {
  # proces cu mediul AGENTULUI (înlocuit complet, nu moștenit); stdin ca octeți UTF-8; timeout => kill pe tot arborele
  return Invoke-ProcesMediu -Exe $exe -LinieArgumente (Join-ArgvWindows $a) -Cwd $cwd -Secunde $sec -Stdin $stdin -Mediu $Mediu
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
  # r6: curat = fără modificări necomise. Commit-urile branch-ului nu se mai împing de aici: ele pleacă în rezultat.bundle
  # (scris ÎNAINTE de ștergere); fără bundle reușit worktree-ul rămâne pentru recuperare (AGT_PASTRAT).
  $s = Git @('-C', $dir, 'status', '--porcelain')
  return ($s.exit -eq 0 -and -not $s.out.Trim())
}
function AreCommituri {
  # $true dacă branch-ul rulării există în clona agentului și are commit-uri peste origin/main
  $v = Git @('-C', $Ra.clona, 'rev-parse', '--verify', '--quiet', ('refs/heads/' + $Branch))
  if ($v.exit -ne 0) { return $false }
  $n = Git @('-C', $Ra.clona, 'rev-list', '--count', ('origin/main..refs/heads/' + $Branch))
  return ($n.exit -eq 0 -and $n.out.Trim() -cmatch '\A[1-9][0-9]*\z')
}
function StergeWorktree([string]$dir) {
  # (fără 2>$null: în PS 5.1, cu ErrorActionPreference = Stop, stderr-ul nativ redirecționat devine eroare terminală)
  if (Test-Path -LiteralPath (Join-Path $dir 'node_modules')) { & cmd.exe /d /c rmdir (Join-Path $dir 'node_modules') | Out-Null }
  [void](Git @('-C', $Ra.clona, 'worktree', 'remove', '--force', $dir))
  # branch-ul local al rulării se șterge odată cu worktree-ul (commit-urile lui sunt în bundle); o reluare pornește curat
  [void](Git @('-C', $Ra.clona, 'branch', '-D', $Branch))
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
  # un branch local rămas de la o rulare întreruptă (fără worktree): reluarea pornește curat din origin/main
  if ((Git @('-C', $Ra.clona, 'rev-parse', '--verify', '--quiet', ('refs/heads/' + $Branch))).exit -eq 0) { [void](Git @('-C', $Ra.clona, 'branch', '-D', $Branch)) }
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
  # ── 7. r6: commit-urile LOCALE ale branch-ului => rezultat.bundle (doar branch-ul exact, peste origin/main). Fără push,
  #     fără token: orchestratorul îl verifică și îl publică după oprirea job-ului. Fără commit-uri => fără bundle.
  if (AreCommituri) {
    $b = Git @('-C', $Ra.clona, 'bundle', 'create', $FisBundle, ('refs/heads/' + $Branch), '^origin/main')
    if ($b.exit -ne 0 -or -not (Test-Path -LiteralPath $FisBundle -PathType Leaf)) { throw 'bundle-ul cu commit-urile agentului nu s-a putut scrie' }
  }
  $final = 'AGT_GATA ' + $slug; $cod = 0
} catch {
  $final = 'AGT_EROARE: ' + (Motiv $_); $cod = 1
} finally {
  $ErrorActionPreference = 'Continue'
  if ($creat -and (Test-Path -LiteralPath $wt)) {
    $areBundle = Test-Path -LiteralPath $FisBundle -PathType Leaf
    if ((WorktreeCurat $wt) -and ($areBundle -or -not (AreCommituri))) { StergeWorktree $wt }
    else { Write-Output ('AGT_PASTRAT: ' + (Split-Path -Leaf $wt) + ' are modificari necomise sau commit-uri fara bundle') }
  }
}
Iesi $final $cod
