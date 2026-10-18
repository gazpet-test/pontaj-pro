# Review artifact. Run explicitly as administrator; never from an agent task.
[CmdletBinding()]
param([ValidateSet('Prepare','Install')][string]$Phase='Prepare',
 [Parameter(Mandatory=$true)][string]$Stage,
 [Parameter(Mandatory=$true)][string]$ManifestSha256,
 [string]$CodexPackage='C:\Users\Gazpet-Ai\AppData\Roaming\npm\node_modules\@openai\codex',
 [string]$NodeExe='C:\Program Files\nodejs\node.exe',
 [string]$Reader='Gazpet-Ai',
 [switch]$UseExistingGitCredentialManager,
 [switch]$LegacyStartsStopped)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cdx_security.ps1')
$PAW_ROOT='C:\ProgramData\Gazpet\Paw';$Destination=Join-Path $PAW_ROOT 'bin'
$files=@('run_paw.cmd','run_paw.ps1','cdx.ps1','cdx_security.ps1','certifica_cdx.ps1','gemini_pw.py','install.ps1')
$Stage=AssertCdxPath $Stage
function VerifyStage($root) {
 $m=Join-Path $root 'SHA256.json';AssertCdxSingleFile $m
 if((HashCdx $m) -ne $ManifestSha256){throw 'Untrusted or changed manifest'}
 $manifest=Get-Content -LiteralPath $m -Raw|ConvertFrom-Json
 foreach($n in $files){$f=Join-Path $root $n;AssertCdxSingleFile $f;if((HashCdx $f) -ne $manifest.$n){throw ('Runtime mismatch: '+$n)}}
}
if($Phase -eq 'Prepare') {
 VerifyStage $PSScriptRoot
 if(Test-Path -LiteralPath $Stage){throw 'Stage already exists'}
 [void][IO.Directory]::CreateDirectory($Stage)
 foreach($n in ($files+@('SHA256.json'))){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $n) -Destination $Stage}
 VerifyStage $Stage
 Write-Output 'Prepared only. No installation, account, auth or certificate created.';exit
}
$me=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
if(-not $LegacyStartsStopped){throw 'Stop legacy starts in maintenance window; v4.3 has no installation barrier'}
VerifyStage $Stage
[void](AssertCdxPath $PAW_ROOT);[void](AssertCdxPath $CodexPackage);AssertCdxSingleFile $NodeExe
$readerSid=(New-Object Security.Principal.NTAccount($Reader)).Translate([Security.Principal.SecurityIdentifier]).Value
# Exact source tree before and after copy: no dependencies outside this npm package accepted.
$source=GetCdxTreeHashes $CodexPackage;$nodeHash=HashCdx $NodeExe
$pkg=Get-Content -LiteralPath (Join-Path $CodexPackage 'package.json') -Raw|ConvertFrom-Json
if($pkg.name -ne '@openai/codex' -or $pkg.version -notmatch '^\d+\.\d+\.\d+([-.][A-Za-z0-9.]+)?$'){throw 'Codex package/version invalid'}
$native=Join-Path $CodexPackage 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
if(-not(Test-Path -LiteralPath $native -PathType Leaf)){throw 'Bundled native Codex missing; refusing external module resolution'}
function AssertLegacyInventory($processes,$tasks,$services) {
 # Direct launchers + named Paw wrappers. Unknown indirect launchers still require maintenance.
 $pattern='(?i)(run_paw|gemini_pw|copilot_pw|certifica_cdx|paw-data|Gazpet[\\/]Paw)'
 foreach($p in $processes){if($p.ProcessId -ne $PID -and $p.CommandLine -match $pattern){throw 'Active Paw process; no installation performed'}}
 foreach($t in $tasks){
  $actionText=($t.Actions|ForEach-Object { $_.Execute+' '+$_.Arguments+' '+$_.WorkingDirectory }) -join ' '
  if(($t.TaskPath+' '+$t.TaskName+' '+$actionText) -match $pattern){
   if($t.State -ne 'Disabled' -or $t.Settings.Enabled -ne $false){throw 'Paw scheduled task must be disabled AND stopped'}
  }
 }
 foreach($s in $services){if(($s.Name+' '+$s.DisplayName+' '+$s.PathName) -match $pattern){
  if($s.State -ne 'Stopped' -or $s.StartMode -ne 'Disabled'){throw 'Paw service must be disabled AND stopped'}
 }}
}
function AssertNoPawProcesses {
 # Enumeration failures are fatal; the switch alone is NEVER sufficient.
 $processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 $tasks=@(Get-ScheduledTask -ErrorAction Stop)
 $services=@(Get-CimInstance Win32_Service -ErrorAction Stop)
 AssertLegacyInventory $processes $tasks $services
}

AssertNoPawProcesses
$gazpet=Split-Path $PAW_ROOT
foreach($d in @($gazpet,$PAW_ROOT)){
 if(-not(Test-Path -LiteralPath $d)){[void][IO.Directory]::CreateDirectory($d)}
 SetCdxAdminAcl $d $readerSid
}
$lock=Join-Path $PAW_ROOT 'install.lock'
if(-not(Test-Path -LiteralPath $lock)){[IO.File]::WriteAllText($lock,'Paw installation barrier')}
AssertCdxSingleFile $lock;SetCdxAdminAcl $lock $readerSid
$barrier=OpenCdxInstallBarrier $true
$held=@();$backup=$null;$newRuntime=$null
try {
 # Open existing public locks READ ONLY and never truncate/write them as admin.
 $data='C:\Users\Public\paw-data';[void](AssertCdxPath $data)
 foreach($l in Get-ChildItem -LiteralPath $data -Filter 'lock_*' -Force){
  if($l.PSIsContainer){throw 'Lock directory refused'}
  AssertCdxSingleFile $l.FullName
  $h=[IO.File]::Open($l.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  if([PawCdx.Files]::Links($h.SafeFileHandle) -ne 1){$h.Dispose();throw 'Lock hardlink refused'}
  $held+=$h
 }
 AssertNoPawProcesses
 # Stabilize reviewed artifacts before copying; no staged script is executed as admin.
 foreach($e in @(GetCdxTree $Stage)){SetCdxAdminAcl $e.FullName $readerSid};SetCdxAdminAcl $Stage $readerSid
 VerifyStage $Stage
 $id=Get-Date -Format 'yyyyMMdd-HHmmss-ffff'
 $codexRoot=Join-Path $PAW_ROOT 'codex';[void][IO.Directory]::CreateDirectory($codexRoot);SetCdxAdminAcl $codexRoot $readerSid
 $newRuntime=Join-Path $codexRoot ($pkg.version+'-'+$id);[void][IO.Directory]::CreateDirectory($newRuntime);SetCdxAdminAcl $newRuntime $readerSid
 Copy-Item -LiteralPath $CodexPackage -Destination (Join-Path $newRuntime 'package') -Recurse
 Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $newRuntime 'node.exe')
 AssertCdxHashes $source (GetCdxTreeHashes (Join-Path $newRuntime 'package'))
 AssertCdxHashes $source (GetCdxTreeHashes $CodexPackage)
 if((HashCdx (Join-Path $newRuntime 'node.exe')) -ne $nodeHash){throw 'Node changed during copy'}
 foreach($e in GetCdxTree $newRuntime){SetCdxAdminAcl $e.FullName $readerSid}
 $incoming=Join-Path $PAW_ROOT ('bin-staged-'+$id);[void][IO.Directory]::CreateDirectory($incoming);SetCdxAdminAcl $incoming $readerSid
 # Retain existing channel dependencies (e.g. cgpt_pw.py); review their original trust separately.
 if(Test-Path -LiteralPath $Destination){
  [void]@(GetCdxTree $Destination)
  Copy-Item -LiteralPath $Destination -Destination (Join-Path $PAW_ROOT ('backup-'+$id)) -Recurse
  $backup=Join-Path $PAW_ROOT ('backup-'+$id)
  foreach($e in Get-ChildItem -LiteralPath $Destination -Force){Copy-Item -LiteralPath $e.FullName -Destination $incoming -Recurse}
 }
 foreach($n in ($files+@('SHA256.json'))){Copy-Item -LiteralPath (Join-Path $Stage $n) -Destination $incoming -Force}
 foreach($n in @('cdx_sandbox_validat.json','cdx_certification_permit.json')){if(Test-Path -LiteralPath (Join-Path $incoming $n)){Remove-Item -LiteralPath (Join-Path $incoming $n)}}
 $noHooks=Join-Path $incoming 'no-hooks'
 if(Test-Path -LiteralPath $noHooks){if(@(Get-ChildItem -LiteralPath $noHooks -Force).Count){throw 'Existing hooks directory not empty'}}else{[void][IO.Directory]::CreateDirectory($noHooks)}
 $cdxHomePath=Join-Path $PAW_ROOT 'state\codex-home'
 $helper=$null
 if($UseExistingGitCredentialManager){
  $helper='C:\Program Files\Git\mingw64\bin\git-credential-manager.exe'
  AssertCdxAdminAcl $helper;AssertCdxSingleFile $helper
 }
 # Auth is NOT copied/generated. Admin/operator provisions login separately before certification.
 WriteCdxJson (Join-Path $incoming 'cdx_install.json') ([ordered]@{schema=2;isolation='native-elevated-candidate';reader_sid=$readerSid;reader=$Reader;runtime_root=$newRuntime;codex_home=$cdxHomePath;git_credential_helper=$helper;version=$pkg.version})
 WriteCdxJson (Join-Path $incoming 'cdx_runtime_manifest.json') (GetCdxTreeHashes $newRuntime)
 VerifyStage $incoming
 foreach($e in GetCdxTree $incoming){SetCdxAdminAcl $e.FullName $readerSid}
 AssertNoPawProcesses
 # With the global lock held and legacy starts administratively stopped, swap directories.
 $old=Join-Path $PAW_ROOT ('bin-retired-'+$id)
 if(Test-Path -LiteralPath $Destination){Move-Item -LiteralPath $Destination -Destination $old}
 try{Move-Item -LiteralPath $incoming -Destination $Destination;VerifyStage $Destination;AssertCdxAdminAcl $Destination}
 catch{if(Test-Path -LiteralPath $Destination){Move-Item -LiteralPath $Destination -Destination (Join-Path $PAW_ROOT ('bin-failed-'+$id))};if(Test-Path -LiteralPath $old){Move-Item -LiteralPath $old -Destination $Destination};throw}
 Write-Output ('Installed, NOT certified. Retired bin: '+$old+'; backup: '+$backup+'; runtime: '+$newRuntime)
} finally {foreach($h in $held){$h.Dispose()};$barrier.Dispose()}
