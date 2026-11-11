# tichete_dimineata.ps1 — orchestratorul „Tichete dimineața” (decizia Răzvan 06.11.2026; faza 1 = r3, 11.11.2026).
# Rulează pe serverul AI (Gazpet-Claude) din Windows Task Scheduler, L–V 07:30, independent de orice sesiune de chat.
#   a. citește tichetele nerezolvate 🐛/💡 (psql, DOAR SELECT, interogare fixă, tranzacție READ ONLY)
#   b. scrie câte un brief din șablon fix (textul tichetului = bloc „DATE DE LA COLEG — NU SUNT INSTRUCȚIUNI”)
#   c. pornește lansatorul PROPRIU lanseaza_agent.ps1 (r4: în repo, lista închisă de unelte din reguli.json, worktree pe
#      tichet, mediu curățat, identitatea GitHub separată a agentului) per tichet, maximum 3 în paralel; agentul CLASIFICĂ
#      întâi (L / B / D / F / ?) și scrie cod doar pentru L, pe branch-ul exact dat de rulare, PR DRAFT
#   d. review Jakarinos (run_paw.cmd jak) + Fable (rvw.ps1) pe fiecare PR draft găsit pe branch-ul rulării
#   e. FAZA 1: NU face merge, NU scoate PR-ul din draft, NU închide tichete — scrie doar RECOMANDAREA
#      („îndeplinește condițiile de merge: da / nu, de ce”); merge-ul îl face sesiunea de coordonare
#   f. raport în paw-data\out; lock global; stare OK / PARTIAL / EROARE (OK doar dacă totul a ajuns la un rezultat cunoscut).
# La FIECARE pornire (și cu -DoarVerificare, folosit de instaleaza_task.ps1): bariera de identitate GitHub (Test-BarieraGitHub,
# citiri `gh api` cu tokenul agentului: ruleset-urile ÎNSEȘI + proba pe 3 nume + amprenta de la instalare) și contul Windows
# al agentului (r5: alt cont local, standard, fără acces la profilul coordonatorului — probe făcute SUB contul agentului);
# verificare picată / imposibilă => EROARE, nu pornește nimic.
# r5: împărțirea în două procese — ACEST script rulează ca coordonator (tichete din BD prin pgpass, gh pentru review-uri,
# raport); agentul rulează în lanseaza_agent.ps1 SUB CONTUL AGENTULUI (PornesteLansator), cu brief-ul pe stdin și doar tokenul lui.
# Fișa de securitate: README.md. Nimic din tichet nu ajunge în SQL / nume de fișier / linie de comandă.
[CmdletBinding()]
param(
  [string]$RepoDir     = '',                                        # clonă dedicată (doar fetch + diff, niciun checkout)
  [string]$DataDir     = 'C:\Users\Public\paw-data',
  [string]$Psql        = 'C:\Users\Public\pgsql\bin\psql.exe',
  [string]$PgHost      = 'aws-1-eu-central-1.pooler.supabase.com',
  [string]$PgUser      = 'postgres.dxczwkbciseqniprspcu',
  [string]$Rvw         = 'C:\Users\Gazpet-Ai\claude-redari\rvw.ps1',
  [string]$RunPaw      = 'C:\ProgramData\Gazpet\Paw\bin\run_paw.cmd',
  [int]$MaxParalel     = 3,
  [int]$MaxTichete     = 6,       # plafonul zilei (după filtrele „deja procesat”)
  [int]$MaxLiniiDiff   = 0,       # 0 = valoarea din reguli.json (max_linii_diff)
  [int]$MinuteTotal    = 170,     # sub limita de 3 ore a task-ului
  [int]$MinuteCi       = 25,      # cât așteaptă CI-ul unui PR (doar pentru recomandare)
  [int]$MinuteReview   = 45,      # plafon per review (Jakarinos are timeout propriu 20 min)
  [switch]$Simulare,              # citește tichetele + scrie brief-urile, NU pornește agentul / review (bariera doar raportată)
  [switch]$Forteaza,              # rulează chiar dacă azi există deja o rulare OK
  [switch]$DoarVerificare,        # doar bariera de identitate GitHub + contul Windows al agentului (exit 0 = trec); nu citește tichete
  [switch]$Instalare              # cu -DoarVerificare (instaleaza_task.ps1): citește și bypass_actors cu identitatea coordonatorului și
                                  # SCRIE amprenta ruleset-urilor (singurul loc unde se scrie)
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
# r5: lansatorul e FIX (lângă acest script, în clona orchestratorului, doar-citire pentru agent — verificat de proba contului)
$Lansator = Join-Path $PSScriptRoot 'lanseaza_agent.ps1'
$CaiAgent = Get-CaiAgent $env:USERPROFILE
$TokenAgent = ''; $LoginAgent = ''
$CfgAgent = $null; $RaAgent = $null; $CredAgent = $null
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
function Exec([string]$exe, [string[]]$argv, [int]$timeoutSec = 120, [string]$cwd = $RepoDir, [hashtable]$mediu = $null) {
  # rulează sincron, stdout/stderr UTF-8; întoarce @{ exit; out; err }. Timeout => kill + exit -1.
  # $mediu: variabile puse ($null = scoase) DOAR pentru acest proces (ex. tokenul agentului la citirile gh api).
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = Join-ArgvWindows $argv
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $UTF8
  $psi.StandardErrorEncoding = $UTF8
  $psi.CreateNoWindow = $true
  if ($cwd) { $psi.WorkingDirectory = $cwd }
  if ($null -ne $mediu) {
    foreach ($k in $mediu.Keys) { if ($null -eq $mediu[$k]) { $psi.EnvironmentVariables.Remove($k) } else { $psi.EnvironmentVariables[$k] = [string]$mediu[$k] } }
  }
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
function GhAgent([string[]]$argv) {
  # citiri gh api cu identitatea AGENTULUI (tokenul lui, director gh propriu), ca bariera să fie verificată pe drepturile lui.
  # Tokenul nu apare în argumente, iar orice ecou al lui în ieșiri e înlocuit înainte de jurnal.
  if (-not $GhExe) { throw 'gh.exe nu e in PATH' }
  if (-not (Test-ComandaGhPermisa $argv)) { throw ('comanda gh nepermisa: ' + ((@($argv) | Select-Object -First 2) -join ' ')) }
  if (-not (Test-FormaTokenAgent $TokenAgent)) { throw 'tokenul agentului lipseste' }
  $r = Exec $GhExe $argv 60 $RepoDir @{ GH_TOKEN = $TokenAgent; GH_CONFIG_DIR = $CaiAgent.gh; GITHUB_TOKEN = $null; GH_ENTERPRISE_TOKEN = $null; GITHUB_ENTERPRISE_TOKEN = $null; GH_HOST = $null }
  $r.out = ([string]$r.out).Replace($TokenAgent, '[token]'); $r.err = ([string]$r.err).Replace($TokenAgent, '[token]')
  return $r
}
function Git([string[]]$argv, [int]$t = 300) {
  if (-not $GitExe) { throw 'git.exe nu e in PATH' }
  if (-not (Test-ComandaGitPermisa $argv)) { throw ('comanda git nepermisa: ' + $argv[0]) }
  return Exec $GitExe (@('-C', $RepoDir) + $argv) $t
}
function JsonGh($r, [string]$ce) {
  # răspunsul unei citiri gh api: exit 0 + JSON; altfel aruncă (verificare imposibilă = EROARE, nu „trece”)
  if ($r.exit -ne 0) { throw ($ce + ': gh api esuat (' + (Get-TextSigurLinie $r.err 160) + ')') }
  try { return (ConvertFrom-Json -InputObject $r.out) } catch { throw ($ce + ': JSON necitit') }
}
function JsonGhLista($r, [string]$ce) {
  # răspunsul unei citiri gh api care TREBUIE să fie o listă JSON ('[...]'); altfel aruncă. Întoarce elementele (apelantul pune @()).
  if ($r.exit -ne 0) { throw ($ce + ': gh api esuat (' + (Get-TextSigurLinie $r.err 160) + ')') }
  $t = ([string]$r.out).Trim()
  if (-not $t.StartsWith('[') -or -not $t.EndsWith(']')) { throw ($ce + ': raspunsul nu e o lista JSON') }
  return (JsonLista $t)
}
function CitesteConfigAgent {
  # agent.json (v2) din profilul coordonatorului; aruncă dacă lipsește / e invalid
  $cfgT = Test-ConfigAgent $(if (Test-Path -LiteralPath $CaiAgent.config -PathType Leaf) { [IO.File]::ReadAllText($CaiAgent.config, $UTF8) } else { '' })
  if (-not $cfgT.ok) { throw ('agent.json: ' + ((@($cfgT.motive) | Select-Object -First 4) -join '; ')) }
  return $cfgT.cfg
}
function VerificaBariera {
  # Condiția de instalare și de pornire (P1 r3, r5; README „Bariera de identitate”): agent.json + token (profilul coordonatorului),
  # repo-ul din agent.json = cel al clonei, apoi citiri gh api cu tokenul agentului → Test-BarieraGitHub (ruleset-urile ÎNSEȘI +
  # proba pe 3 nume), apoi: la instalare (-Instalare) recitirea ruleset-urilor canonice cu identitatea coordonatorului
  # (bypass_actors) + scrierea amprentei; la pornire, compararea cu amprenta. Aruncă la orice verificare imposibilă;
  # întoarce @{ ok; motive; login }.
  try { $cfg = CitesteConfigAgent } catch { return @{ ok = $false; motive = @($_.Exception.Message); login = '' } }
  $script:TokenAgent = if (Test-Path -LiteralPath $CaiAgent.token -PathType Leaf) { ([IO.File]::ReadAllText($CaiAgent.token, $UTF8)).Trim() } else { '' }
  if (-not (Test-FormaTokenAgent $script:TokenAgent)) { return @{ ok = $false; motive = @('tokenul agentului lipseste sau nu are forma unui token GitHub (token_agent.txt)'); login = '' } }
  $u = Git @('ls-remote', '--get-url', 'origin')
  $repoClona = Get-RepoDinUrl $(if ($u.exit -eq 0) { $u.out.Trim() } else { '' })
  if (-not $repoClona -or $repoClona -ine $cfg.repo) { return @{ ok = $false; motive = @('repo-ul din agent.json nu e cel al clonei orchestratorului'); login = '' } }
  $rs = Gh @('api', 'user', '--jq', '.login') 60
  if ($rs.exit -ne 0) { throw ('gh api user (server) esuat: ' + (Get-TextSigurLinie $rs.err 160)) }
  $loginServer = $rs.out.Trim()
  $rag = GhAgent @('api', 'user', '--jq', '.login')
  if ($rag.exit -ne 0) { throw ('gh api user (agent) esuat: ' + (Get-TextSigurLinie $rag.err 160)) }
  $loginAgent = $rag.out.Trim()
  $baza = 'repos/' + $cfg.repo
  $infoRepo = JsonGh (GhAgent @('api', $baza)) 'repo-ul (agent)'
  $perm = Get-Camp $infoRepo 'permissions'
  $ramura = [string](Get-Camp $infoRepo 'default_branch')
  # ruleset-urile ÎNSEȘI: lista completă (o pagină de 100; >= max_rulesets => refuz, poate fi trunchiată), apoi fiecare în detaliu
  $lista = @(JsonGhLista (GhAgent @('api', ($baza + '/rulesets?includes_parents=true&per_page=100'))) 'lista ruleset-urilor')
  if ($lista.Count -gt 100) { throw 'lista ruleset-urilor: mai mult de o pagina' }
  $det = @{}
  foreach ($s in $lista) {
    $idS = [string](Get-Camp $s 'id')
    if ($idS -cnotmatch '\A[0-9]{1,12}\z') { throw 'lista ruleset-urilor: id invalid' }
    $det[$idS] = JsonGh (GhAgent @('api', ($baza + '/rulesets/' + $idS))) ('ruleset ' + $idS)
  }
  # proba pe nume (a doua plasă): un nume aleator la fiecare rulare, main, un nume aleator sub tichete/
  $enc = { param($b) [uri]::EscapeDataString($b) }
  $nA = [string]$Reguli.bariera_rulesets.prefix_proba + [guid]::NewGuid().ToString('N').Substring(0, 12)
  $nT = [string]$Reguli.bariera_rulesets.prefix_proba_tichete + [guid]::NewGuid().ToString('N').Substring(0, 12)
  $pA = @(JsonGhLista (GhAgent @('api', ($baza + '/rules/branches/' + (& $enc $nA)))) 'proba nume aleator')
  $pM = @(JsonGhLista (GhAgent @('api', ($baza + '/rules/branches/main'))) 'proba main')
  $pT = @(JsonGhLista (GhAgent @('api', ($baza + '/rules/branches/' + (& $enc $nT)))) 'proba tichete/')
  $vb = Test-BarieraGitHub -LoginServer $loginServer -LoginAgentConfig $cfg.login_agent -LoginAgent $loginAgent -Permisiuni $perm `
          -RamuraImplicita $ramura -ListaRulesets $lista -Detalii $det -ProbaAleator $pA -ProbaMain $pM -ProbaTichete $pT
  if (-not $vb.ok) { return @{ ok = $false; motive = @($vb.motive); login = $loginAgent } }
  if ($Instalare) {
    # bypass_actors: GitHub îl întoarce doar cui poate edita ruleset-ul => identitatea coordonatorului (gh de pe server)
    $detC = @{}
    foreach ($idS in @($vb.idMain, $vb.idRestul)) { $detC[$idS] = JsonGh (Gh @('api', ($baza + '/rulesets/' + $idS))) ('ruleset ' + $idS + ' (coordonator)') }
    $vi = Test-BarieraInstalare -Agent $det -Coordonator $detC -IdMain $vb.idMain -IdRestul $vb.idRestul
    if (-not $vi.ok) { return @{ ok = $false; motive = @($vi.motive); login = $loginAgent } }
    $txt = Get-TextAmprenta -Repo $cfg.repo -Amprenta @($vb.amprenta) -LoginCoordonator $loginServer -Data ((Get-Date).ToString('s'))
    [IO.File]::WriteAllText($CaiAgent.amprenta, $txt, $UTF8)
  } else {
    $va = Test-Amprenta -Text $(if (Test-Path -LiteralPath $CaiAgent.amprenta -PathType Leaf) { [IO.File]::ReadAllText($CaiAgent.amprenta, $UTF8) } else { '' }) -Repo $cfg.repo -Curenta @($vb.amprenta)
    if (-not $va.ok) { return @{ ok = $false; motive = @($va.motive); login = $loginAgent } }
  }
  return @{ ok = $true; motive = @(); login = $loginAgent }
}

# ── r5 (P1): contul Windows SEPARAT al agentului ──────────────────────────────────────────────────────────────
$PsExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function SidCont([string]$nume) {
  return (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $nume)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function MembriiAdministrators {
  # SID-urile membrilor direcți ai grupului local Administrators (S-1-5-32-544), prin ADSI (numele grupului e localizat)
  $numeGrup = ((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate([Security.Principal.NTAccount]).Value -split '\\')[-1]
  $grup = [ADSI]('WinNT://' + $env:COMPUTERNAME + '/' + $numeGrup + ',group')
  $sids = New-Object System.Collections.ArrayList
  foreach ($m in @($grup.Invoke('Members'))) {
    $oct = $m.GetType().InvokeMember('objectSid', 'GetProperty', $null, $m, $null)
    [void]$sids.Add((New-Object Security.Principal.SecurityIdentifier($oct, 0)).Value)
  }
  return @($sids)
}
function PregatesteContAgent {
  # Partea COORDONATORULUI: configurarea v2, împărțirea pe disc (Test-SeparareCai), contul agentului ≠ contul curent (SID),
  # nu e membru direct Administrators, parola lui (cont_agent.xml, DPAPI) pentru pornire; scrie setările gărzii și lansare.json
  # în <rădăcină>\setari (doar-citire pentru agent). Apoi PROBA sub contul agentului (lanseaza_agent.ps1 -DoarVerificareCont:
  # nu poate citi profilul / pgpass / gh / paw-data, nu poate scrie garda / setările, nu e admin). Aruncă la orice abatere.
  $cfg = CitesteConfigAgent
  $eu = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sidEu = $eu.User.Value
  $profilEu = [Environment]::GetFolderPath('UserProfile')
  $mot = @(Test-SeparareCai -ProfilCoordonator $profilEu -DataDir $DataDir -RepoDir $RepoDir -Cfg $cfg)
  if ($mot.Count -gt 0) { throw ('impartirea pe disc agent / coordonator: ' + ($mot -join '; ')) }
  if ($cfg.cont_windows -ieq $env:USERNAME) { throw 'agentul ar rula sub acelasi cont Windows ca coordonatorul' }
  try { $sidAg = SidCont $cfg.cont_windows } catch { throw ('contul Windows al agentului nu exista local: ' + $cfg.cont_windows) }
  if ($sidAg -ceq $sidEu) { throw 'agentul ar rula sub acelasi cont Windows ca coordonatorul' }
  if (@(MembriiAdministrators) -ccontains $sidAg) { throw 'contul agentului e membru Administrators' }
  if (-not (Test-Path -LiteralPath $CaiAgent.cont -PathType Leaf)) { throw 'lipseste cont_agent.xml (parola contului agentului, README)' }
  $cred = Import-Clixml -LiteralPath $CaiAgent.cont
  if (-not ($cred -is [System.Management.Automation.PSCredential])) { throw 'cont_agent.xml nu e un PSCredential' }
  # (regex-ul construit separat: într-un argument, „+” și „,” s-ar lega greșit de -replace)
  $reDom = '\A(?:\.|' + [regex]::Escape($env:COMPUTERNAME) + ')\\'
  $u = [regex]::Replace([string]$cred.UserName, $reDom, '', 'IgnoreCase')
  if ($u -ine $cfg.cont_windows) { throw 'cont_agent.xml e pentru alt cont decat cont_windows' }
  $ra = Get-CaiRadacinaAgent $cfg.radacina_agent
  foreach ($d in @($ra.radacina, $ra.setari)) { if (-not (Test-Path -LiteralPath $d -PathType Container)) { throw ('lipseste ' + $d + ' (README: pregatirea contului agentului)') } }
  $garda = Join-Path $PSScriptRoot 'garda_agent.mjs'
  [IO.File]::WriteAllText($ra.fisSetari, (Get-TextSetariAgent -NodeExe $cfg.node_exe -Garda $garda), $UTF8)
  $citire = @($profilEu, (Join-Path $env:APPDATA 'postgresql\pgpass.conf'), (Join-Path $env:APPDATA 'GitHub CLI'), $CaiAgent.dir, $DataDir)
  if ($env:PGPASSFILE) { $citire += $env:PGPASSFILE }
  $scriere = @($RepoDir, $PSScriptRoot, $ra.setari, $ra.fisSetari, $ra.fisLansare)
  [IO.File]::WriteAllText($ra.fisLansare, (Get-TextLansare -Cfg $cfg -SidCoordonator $sidEu -InterziseCitire $citire -InterziseScriere $scriere), $UTF8)
  $script:CfgAgent = $cfg; $script:RaAgent = $ra; $script:CredAgent = $cred
  # proba sub contul agentului: DOAR codul de ieșire (din handle) decide; textul e informativ
  $p = PornesteLansator -Argumente @('-DoarVerificareCont') -Stdin ''
  if (-not $p.proc.WaitForExit(120000)) { OpresteJob $p; throw 'proba contului agentului: timeout' }
  $fs = Join-Path (Join-Path $ra.iesire '_verificare') 'stare.txt'
  $ult = Get-TextSigurLinie (CitesteIesireAgent $fs 4096) 200
  $codP = $p.proc.ExitCode
  OpresteJob $p
  if ($codP -ne 0) { throw ('proba contului agentului a picat (exit ' + $codP + '): ' + $ult) }
}
function PornesteLansator([string[]]$Argumente, [AllowNull()][string]$Stdin) {
  # lanseaza_agent.ps1 SUB CONTUL AGENTULUI: Process.Start cu UserName / Password (CreateProcessWithLogonW, serviciul
  # „Secondary Logon”) + profil încărcat; mediul = Get-MediuLansator (nimic din mediul coordonatorului); stdin = brief-ul;
  # procesul intră imediat într-un job object (oprire pe tot arborele, chiar dacă procesele sunt ale altui cont).
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $PsExe
  $psi.Arguments = Join-ArgvWindows (@('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $Lansator, '-Config', $RaAgent.fisLansare) + @($Argumente))
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.LoadUserProfile = $true
  $psi.UserName = $CfgAgent.cont_windows; $psi.Domain = $env:COMPUTERNAME; $psi.Password = $CredAgent.Password
  $psi.WorkingDirectory = $RaAgent.radacina
  $psi.RedirectStandardInput = $true
  $mediu = Get-MediuLansator -Baza ([Environment]::GetEnvironmentVariables()) -Cfg $CfgAgent -Token $TokenAgent
  $psi.EnvironmentVariables.Clear()
  foreach ($k in $mediu.Keys) { $psi.EnvironmentVariables[$k] = [string]$mediu[$k] }
  $proc = [System.Diagnostics.Process]::Start($psi)
  $job = [JobAgent]::Creeaza()
  if (-not [JobAgent]::Adauga($job, $proc.Handle)) { try { $proc.Kill() } catch {}; [JobAgent]::Inchide($job); throw 'job object: procesul agentului nu a putut fi atasat' }
  $oct = $UTF8.GetBytes([string]$Stdin)
  if ($oct.Length -gt 0) { $proc.StandardInput.BaseStream.Write($oct, 0, $oct.Length) }
  $proc.StandardInput.Close()
  return @{ proc = $proc; job = $job }
}
function OpresteJob($pj) {
  # oprește TOT arborele lansatorului (job object) și eliberează job-ul
  if ($null -eq $pj -or $null -eq $pj.job) { return }
  try { [void][JobAgent]::Termina($pj.job) } catch {}
  try { [JobAgent]::Inchide($pj.job) } catch {}
  $pj.job = $null
}
function CitesteIesireAgent([string]$fis, [int]$max = 5242880) {
  # fișierele scrise de agent sunt DATE neîncrezute: fără legături (reparse point) pe fișier și pe director, plafon de mărime
  if (-not (Test-Path -LiteralPath $fis -PathType Leaf)) { return '' }
  foreach ($x in @((Get-Item -LiteralPath $fis -Force), (Get-Item -LiteralPath (Split-Path -Parent $fis) -Force))) {
    if (($x.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'iesirea agentului e o legatura (reparse point)' }
  }
  if ((Get-Item -LiteralPath $fis -Force).Length -gt $max) { throw 'iesirea agentului e prea mare' }
  return [IO.File]::ReadAllText($fis, $UTF8)
}
if (-not ('JobAgent' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JobAgent {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] public struct IOC { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IOC Io; public UIntPtr a; public UIntPtr b; public UIntPtr c; public UIntPtr d; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  public static IntPtr Creeaza() {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    if (j == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject");
    EXT x = new EXT(); x.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(j, 9, ref x, (uint)Marshal.SizeOf(typeof(EXT)))) { CloseHandle(j); throw new InvalidOperationException("SetInformationJobObject"); }
    return j;
  }
  public static bool Adauga(IntPtr job, IntPtr proc) { return AssignProcessToJobObject(job, proc); }
  public static bool Termina(IntPtr job) { return TerminateJobObject(job, 1); }
  public static void Inchide(IntPtr job) { CloseHandle(job); }
}
'@
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
  $p = Start-Process -FilePath $exe -ArgumentList (Join-ArgvWindows $argv) -PassThru -WindowStyle Hidden `
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
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject @($lista) -Depth 6), $UTF8)
  if (Test-Path -LiteralPath $FisTichete) { [IO.File]::Replace($tmp, $FisTichete, $FisTichete + '.bak') }
  else { [IO.File]::Move($tmp, $FisTichete) }
}

function StareIntrerupt($x) {
  # tichet oprit înainte de capăt (plafon de timp / eroare globală): fără PR = OPRIT; review-uri citite = doar CI de reluat
  if ($x.pr -le 0) { return 'OPRIT' }
  if ($null -ne $x.jak -and $null -ne $x.fable -and $x.jak.verdict -cne 'NECUNOSCUT' -and $x.fable.verdict -cne 'NECUNOSCUT') { return 'PR_CI_NECITIT' }
  return 'PR_FARA_REVIEW'
}

# ── -DoarVerificare (instaleaza_task.ps1): doar bariera, fără lock / stare / tichete ───────────────────────────
if ($Instalare -and -not $DoarVerificare) { Write-Host 'BARIERA_EROARE: -Instalare merge doar cu -DoarVerificare'; exit 1 }
if ($DoarVerificare) {
  try {
    $vb0 = VerificaBariera
    if (-not $vb0.ok) { Write-Host ('BARIERA_REFUZ: ' + ((@($vb0.motive) | ForEach-Object { Get-TextSigurLinie $_ 200 }) -join '; ')); exit 1 }
    PregatesteContAgent
    Write-Host ('BARIERA_OK agent=' + $vb0.login + ' cont=' + $CfgAgent.cont_windows + $(if ($Instalare) { ' amprenta=scrisa' } else { '' })); exit 0
  } catch { Write-Host ('BARIERA_EROARE: ' + (Get-TextSigurLinie $_.Exception.Message 300)); exit 1 }
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

  # ── Verificări preliminare (unelte, lansatorul propriu, bariera de identitate, rețea) ──────────────────────
  foreach ($f in @($Psql) + $(if ($Simulare) { @() } else { @($Lansator, $Rvw, $RunPaw) })) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "lipseste $f" }
  }
  [void](CaleSimpla $DataDir); [void](CaleSimpla $Lansator); [void](CaleSimpla $Rvw); [void](CaleSimpla $RunPaw)
  $r = Gh @('auth', 'status') 60
  if ($r.exit -ne 0) { throw 'gh: autentificare / retea indisponibila' }
  $r = Git @('fetch', '--prune', 'origin')
  if ($r.exit -ne 0) { throw ('git fetch esuat: ' + (Get-TextSigurLinie $r.err 200)) }
  # J1 / P1 (r4): la FIECARE pornire — identitatea agentului e alt cont, cu drepturi minime, iar main cere PR fără ocolire.
  # Verificare picată sau imposibilă => EROARE (fără agenți). În simulare doar se raportează.
  try { $bar = VerificaBariera } catch { $bar = @{ ok = $false; motive = @('verificarea nu s-a putut face: ' + $_.Exception.Message); login = '' } }
  if (-not $bar.ok) {
    $mot = (@($bar.motive) | Select-Object -First 4 | ForEach-Object { Get-TextSigurLinie $_ 160 }) -join '; '
    if ($Simulare) { Jurnal ('ATENTIE: bariera de identitate GitHub nu trece (' + $mot + ') - in simulare nu pornesc agenti') }
    else { throw ('bariera de identitate GitHub nu trece, nu pornesc: ' + $mot) }
  }
  # PR-urile rulării sunt deschise de agent: autorul așteptat (F7) = identitatea lui, verificată mai sus
  $Autor = [string]$bar.login
  # r5 (P1): contul Windows separat al agentului (probe sub contul lui). Picat => EROARE, fără agenți; în simulare doar raportat.
  if (-not $Simulare) { PregatesteContAgent }
  else { try { PregatesteContAgent } catch { Jurnal ('ATENTIE: contul Windows al agentului nu trece (' + (Get-TextSigurLinie $_.Exception.Message 200) + ') - in simulare nu pornesc agenti') } }

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
      reincercari = 0; dupa = $Start; pj = $null; loc = $null; procJak = $null; procRvw = $null; ciPana = $null; reviewPana = $null
      reincercariJak = 0; reincercariRvw = 0; reviewDupa = $Start; fisiere = @(); diff = ''; linii = 0; regiuni = @(); briefReview = ''
      diffGata = $false; verdicte = $w.verdicte
    })
  }
  if ($Simulare) { Jurnal 'simulare: brief-uri scrise, nu pornesc agentul'; foreach ($x in $Rezultate) { $x.etapa = 'gata'; $x.stare = 'SIMULARE' } }

  function PregatesteDiff($x) {
    # diff-ul + inventarul căilor + regiunile interzise, O SINGURĂ DATĂ, pe sha-ul găsit la c3 (reîncercările și reluarea
    # pasului CI folosesc același commit). Eșec => eroare vizibilă + stare de reluare (nu „gata”).
    if ($x.diffGata) { return $true }
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
      [void]$x.erori.Add('nu am putut lua diff-ul branch-ului'); Termina $x (StareIntrerupt $x) ''; return $false
    }
    try {
      $x.fisiere = @(Get-CaiNameStatusZ $r3.out)
      $x.linii = Get-LiniiNumstatZ $r4.out $MaxLiniiDiff
    } catch { [void]$x.erori.Add('inventarul cailor: ' + $_.Exception.Message); Termina $x (StareIntrerupt $x) ''; return $false }
    $x.diff = CitesteText $fd
    if ($r5.out.Trim() -cne $sha) { $x.nota = (@($x.nota, 'head-ul branch-ului s-a schimbat dupa gasirea PR-ului; evaluez ' + $sha.Substring(0, 8)) | Where-Object { $_ }) -join '; ' }
    # regiunile interzise (SalariiPage din src/App.jsx): sursa de pe origin/main; necitită => atinsă (fail-closed)
    $surse = @{}
    foreach ($rg in @($Reguli.regiuni_interzise)) {
      $rs = Git @('show', ('origin/main:' + [string]$rg.fisier))
      $surse[[string]$rg.fisier] = if ($rs.exit -eq 0) { $rs.out } else { $null }
    }
    $x.regiuni = @(Get-RegiuniInterziseAtinse -Diff $x.diff -Fisiere $x.fisiere -Surse $surse)
    $x.diffGata = $true
    return $true
  }

  # ── c–e. Bucla: agent (max $MaxParalel) → PR pe branch-ul exact → review (unul odată) → CI → recomandare ───
  $ReviewActiv = $null
  $NEC = @{ verdict = 'NECUNOSCUT'; p0 = -1; p1 = -1 }
  while (-not $Simulare) {
    $activ = @($Rezultate | Where-Object { $_.etapa -cne 'gata' })
    if ($activ.Count -eq 0) { break }
    if ((Get-Date) -gt $Deadline) {
      foreach ($x in $activ) {
        OpresteJob $x.pj; if ($null -ne $x.loc) { $x.loc.Dispose(); $x.loc = $null }
        OpresteArbore $x.procJak; OpresteArbore $x.procRvw
        Termina $x (StareIntrerupt $x) ('oprit la plafonul de timp in etapa ' + $x.etapa)
      }
      break
    }

    # c1. agenți terminați (lansatorul rulează sub contul agentului: codul de ieșire din handle, fișierele lui = date neîncrezute)
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'agent' -and $_.pj.proc.HasExited })) {
      $codAg = $x.pj.proc.ExitCode
      OpresteJob $x.pj
      if ($null -ne $x.loc) { $x.loc.Dispose(); $x.loc = $null }
      $logOut = Join-Path $OutDir ($x.slug + '_agent_stdout.log')
      $fJson = Join-Path $OutDir ('agent_' + $x.slug + '.json')
      $dirAg = Join-Path $RaAgent.iesire $x.slug
      # copiile în paw-data\out (agentul nu are acces la paw-data): doar fișiere obișnuite, cu plafon de mărime
      foreach ($cp in @(@{ s = 'stare.txt'; d = $logOut }, @{ s = 'agent.json'; d = $fJson }, @{ s = 'agent.err.log'; d = (Join-Path $OutDir ('agent_' + $x.slug + '.err.log')) },
                        @{ s = 'garda.log'; d = (Join-Path $OutDir ($x.slug + '_garda.log')) })) {
        try { [IO.File]::WriteAllText($cp.d, (CitesteIesireAgent (Join-Path $dirAg $cp.s)), $UTF8) } catch { [void]$x.erori.Add('iesirea agentului (' + $cp.s + '): ' + (Get-TextSigurLinie $_.Exception.Message 120)) }
      }
      # Rezultatul se citește DOAR din câmpul „result” al agent_<slug>.json (ultima linie nevidă); stdout-ul nu se parsează.
      $rezTxt = Get-CampResult (CitesteText $fJson)
      if ($null -eq $rezTxt) { $x.agent = @{ tip = 'NECUNOSCUT'; clasa = ''; detaliu = ('lipseste / nu se citeste agent_' + $x.slug + '.json (exit ' + $codAg + ': ' + (Get-TextSigurLinie (UltimaLinie $logOut) 160) + ')'); pr = 0 } }
      else { $x.agent = Get-RezultatAgent $rezTxt }
      Jurnal ('agent gata ' + $x.numar + ' (exit ' + $codAg + '): ' + $x.agent.tip + ' ' + $x.agent.clasa)
      $x.etapa = 'pr_cauta'
    }

    # c2. pornește agentul (lansatorul propriu, SUB CONTUL AGENTULUI) cât sunt locuri; locurile comune cu rdr.ps1 le ține
    #     orchestratorul (agentul nu are acces la paw-data)
    $ruleaza = @($Rezultate | Where-Object { $_.etapa -ceq 'agent' }).Count
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'coada' -and $_.dupa -le (Get-Date) })) {
      if ($ruleaza -ge $MaxParalel) { break }
      $loc = $null
      foreach ($i in 1..3) { try { $loc = [IO.File]::Open((Join-Path $DataDir ('lock_rdr_' + $i)), 'OpenOrCreate', 'ReadWrite', 'None'); break } catch { $loc = $null } }
      if ($null -eq $loc) {
        # toate cele 3 locuri sunt ocupate (de chat / alte rulări): așteaptă, nu forța
        if ($x.reincercari -ge 20) { Termina $x 'OPRIT' 'niciun loc liber pentru agent (3 rulari active)'; continue }
        $x.reincercari++; $x.dupa = (Get-Date).AddMinutes(3); continue
      }
      MutaVechi (Join-Path $OutDir ('agent_' + $x.slug + '.json'))
      try {
        # ieșirile vechi ale agentului: șterse doar ca fișiere, într-un director care NU e legătură (altfel ștergerea ar trece
        # printr-un junction pus de agent în altă parte)
        $dirAg = Join-Path $RaAgent.iesire $x.slug
        foreach ($d in @($RaAgent.iesire, $dirAg)) {
          if ((Test-Path -LiteralPath $d) -and (((Get-Item -LiteralPath $d -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw ('directorul de iesire al agentului e o legatura: ' + $d) }
        }
        foreach ($f in @('stare.txt', 'agent.json', 'agent.err.log', 'garda.log')) {
          $fa = Join-Path $dirAg $f
          if (Test-Path -LiteralPath $fa -PathType Leaf) { Remove-Item -LiteralPath $fa -Force }
        }
        $x.pj = PornesteLansator -Argumente @('-Numar', $x.numar, '-Branch', $x.branch, '-Effort', $x.effort) -Stdin (CitesteText $x.brief)
      } catch { $loc.Dispose(); [void]$x.erori.Add('pornirea agentului: ' + (Get-TextSigurLinie $_.Exception.Message 160)); Termina $x 'EROARE' ''; continue }
      $x.loc = $loc
      $x.etapa = 'agent'; $ruleaza++
      Jurnal ("agent pornit " + $x.numar + " effort=" + $x.effort + " branch=" + $x.branch + " cont=" + $CfgAgent.cont_windows)
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
      if ($x.mod -ceq 'ci' -and $null -ne $x.verdicte -and [string]$x.verdicte.sha -ceq $x.sha) {
        # J7 (r4): review-urile de pe ACEST commit sunt deja citite; se reia doar pasul CI
        $x.jak = $x.verdicte.jak; $x.fable = $x.verdicte.fable; $x.etapa = 'ci_prep'
        Jurnal ('reiau doar CI ' + $x.numar + ' PR #' + $x.pr)
      } else {
        if ($x.mod -ceq 'ci') { $x.nota = (@($x.nota, 'head-ul PR-ului s-a schimbat de la review; review nou') | Where-Object { $_ }) -join '; ' }
        $x.etapa = 'review_coada'
      }
    }

    # c4. reluarea pasului CI: doar diff-ul pentru recomandare, fără review nou
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'ci_prep' })) {
      if (PregatesteDiff $x) { $x.ciPana = (Get-Date).AddMinutes($MinuteCi); $x.etapa = 'ci' }
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
          $ok = PregatesteDiff $x
          if ($ok) {
            $x.briefReview = Join-Path $BriefDir ($x.slug + '_review.md')
            [IO.File]::WriteAllText($x.briefReview, (New-BriefReview -Numar $x.numar -Pr $x.pr -Branch $x.branch -Sha $x.sha -Diff $x.diff), $UTF8)
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

    # e. CI + recomandare (FĂRĂ merge, fără ready): erorile gh sunt erori vizibile (F10), nu liste goale.
    #    J7 (r4): o eroare la citirea CI / a stării PR-ului NU marchează review-ul „complet”: starea PR_CI_NECITIT ține
    #    verdictele (același commit) și rularea următoare reia DOAR pasul CI.
    foreach ($x in @($Rezultate | Where-Object { $_.etapa -ceq 'ci' })) {
      $r = Gh @('pr', 'checks', [string]$x.pr, '--json', 'name,bucket')
      $sc = Get-StareChecks -Exit $r.exit -Out $r.out -Err $r.err
      if (($sc.stare -ceq 'pending' -or $sc.stare -ceq 'gol') -and $x.ciPana -gt (Get-Date)) { continue }
      $citit = $true
      if ($sc.stare -ceq 'eroare') { [void]$x.erori.Add($sc.eroare); $citit = $false }
      $x.checks = @($sc.checks); $x.ciStare = $sc.stare
      $r = Gh @('pr', 'view', [string]$x.pr, '--json', 'headRefOid,state,baseRefName,isDraft,isCrossRepository')
      $pv = $null
      if ($r.exit -ne 0) { [void]$x.erori.Add('gh pr view: ' + (Get-TextSigurLinie $r.err 160)); $citit = $false }
      else { try { $pv = ConvertFrom-Json -InputObject $r.out } catch { [void]$x.erori.Add('gh pr view: JSON necitit'); $citit = $false } }
      $reviewOk = ($null -ne $x.jak -and $null -ne $x.fable -and $x.jak.verdict -cne 'NECUNOSCUT' -and $x.fable.verdict -cne 'NECUNOSCUT')
      if (-not $citit) {
        $x.recomandare = $null
        Termina $x $(if ($reviewOk) { 'PR_CI_NECITIT' } else { 'PR_FARA_REVIEW' }) 'verificarile CI / starea PR-ului necitite - se reiau la rularea urmatoare'
        continue
      }
      $clasa = if ($null -ne $x.agent -and $x.agent.clasa) { [string]$x.agent.clasa } else { 'L' }
      if ($null -ne $x.agent -and $x.agent.tip -ceq 'NECUNOSCUT') { $clasa = '?' }
      $headAcum = [string](Get-Camp $pv 'headRefOid')
      $x.recomandare = Get-RecomandareMerge -Jak $x.jak -Fable $x.fable -Checks $x.checks -Clasa $clasa -Fisiere $x.fisiere `
        -Diff $x.diff -LiniiDiff $x.linii -MaxLiniiDiff $MaxLiniiDiff -CrossRepo ((Get-Camp $pv 'isCrossRepository') -ne $false) `
        -HeadSchimbat ($headAcum -cne $x.sha) -RegiuniAtinse $x.regiuni `
        -BazaMain ([string](Get-Camp $pv 'baseRefName') -ceq 'main') -Deschis ([string](Get-Camp $pv 'state') -ceq 'OPEN') `
        -Draft ((Get-Camp $pv 'isDraft') -eq $true)
      # r5 (P2): head-ul PR-ului mutat după review (A -> B) => review INVALIDAT: starea PR_HEAD_SCHIMBAT (nu „complet”),
      # rularea următoare face review nou pe B; recomandarea de azi rămâne „nu” (head schimbat).
      $stCi = Get-StareDupaCi -ReviewOk $reviewOk -ShaRevizuit $x.sha -HeadActual $headAcum
      if ($stCi -ceq 'PR_HEAD_SCHIMBAT') {
        $hScurt = if ($headAcum -cmatch '\A[0-9a-f]{40}\z') { $headAcum.Substring(0, 8) } else { 'necitit' }
        $x.nota = (@($x.nota, ('head-ul PR-ului s-a schimbat dupa review (' + $x.sha.Substring(0, 8) + ' -> ' + $hScurt + '); review nou la rularea urmatoare')) | Where-Object { $_ }) -join '; '
      }
      Termina $x $stCi ''
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
    OpresteJob $x.pj; if ($null -ne $x.loc) { $x.loc.Dispose(); $x.loc = $null }
    OpresteArbore $x.procJak; OpresteArbore $x.procRvw
    if ($x.etapa -cne 'gata') { Termina $x (StareIntrerupt $x) 'oprit de eroarea rularii' }
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
      $ver = if ($x.stare -ceq 'PR_CI_NECITIT') { @{ jak = $x.jak; fable = $x.fable; sha = $x.sha } } else { $null }
      $Stare[$x.numar] = Get-StareNoua -Vechi $vechi -Numar $x.numar -Rezultat @{ stare = $x.stare; clasa = $clasa; detaliu = (Get-TextSigurLinie $det 300); pr = $x.pr; branch = $x.branch; verdicte = $ver } -Azi $Azi
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
    $rec = if ($x.stare -ceq 'PR_CI_NECITIT') { 'neevaluat (review citit, CI necitit — se reia doar CI la rularea următoare)' }
           elseif ($x.stare -ceq 'PR_HEAD_SCHIMBAT') { '**nu** (PR-ul a primit commit-uri noi după review — review nou la rularea următoare)' }
           elseif ($null -eq $x.recomandare) { 'neevaluat (review / CI neterminat)' }
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
  [void]$sb.AppendLine('- Loguri: paw-data\out\tkt-*_agent_stdout.log, agent_tkt-*.json, agent_tkt-*.err.log, tkt-*_garda.log (comenzile refuzate de gardă), tkt-*_jak.log, rvw_tkt-*.json, tkt-*_rvw_consola.log, tkt-*.diff; jurnal: paw-data\tichete_dimineata\jurnal.log')
  [IO.File]::WriteAllText($FisRaport, $sb.ToString(), $UTF8)
} catch {
  # P2 r3: raport nescris = rulare EROARE (reîncercările zilei rămân active), nu OK
  Jurnal ('raport nescris: ' + $_.Exception.Message)
  $stareFinala = 'EROARE'
  $eroare = (@($eroare, ('raport nescris: ' + (Get-TextSigurLinie $_.Exception.Message 200))) | Where-Object { $_ }) -join '; '
}

$rez = "tichete: " + @($Rezultate).Count + ", raport: " + (Split-Path $FisRaport -Leaf)
if ($LockFs) { $LockFs.Dispose() }
switch -CaseSensitive ($stareFinala) {
  'OK'       { ScrieStare 'OK' $rez; exit 0 }
  'SIMULARE' { ScrieStare 'SIMULARE' $rez; exit 0 }
  'PARTIAL'  { ScrieStare 'PARTIAL' $rez; exit 2 }
  default    { ScrieStare 'EROARE' $eroare; exit 1 }
}
