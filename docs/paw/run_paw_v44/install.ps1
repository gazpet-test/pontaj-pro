# Repository artifact only: never run as part of tests or authoring.
[CmdletBinding()]
param([ValidateSet('Prepare','Install')][string]$Phase='Prepare',
 [Parameter(Mandatory=$true)][string]$Stage,
 [Parameter(Mandatory=$true)][string]$ManifestSha256,
 [string]$Destination='C:\ProgramData\Gazpet\Paw\bin')
$ErrorActionPreference='Stop'
function HashFile($p) { $s=[IO.File]::OpenRead($p);$h=[Security.Cryptography.SHA256]::Create();try {([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','')}finally{$s.Dispose();$h.Dispose()} }
function CheckRoot($p) {
 $full=[IO.Path]::GetFullPath($p)
 if ($full.StartsWith('\\') -or $full.Substring(2).Contains(':')) {throw 'UNC/ADS refused'}
 for($x=$full;$x;$x=Split-Path $x -Parent){if((Test-Path -LiteralPath $x) -and ((Get-Item -LiteralPath $x -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Reparse refused'}}
 return $full
}
$Stage=CheckRoot $Stage;$Destination=CheckRoot $Destination
$files=@('run_paw.cmd','run_paw.ps1','cdx.ps1','gemini_pw.py')
function Verify($root) {
 $manifest=Join-Path $root 'SHA256.json'
 if((HashFile $manifest) -ne $ManifestSha256){throw 'Manifest hash mismatch'}
 $m=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
 foreach($f in $files){if((HashFile (Join-Path $root $f)) -ne $m.$f){throw "Hash mismatch: $f"}}
}
if($Phase -eq 'Prepare') {
 Verify $PSScriptRoot
 if(Test-Path -LiteralPath $Stage){throw 'Stage already exists'}
 [void][IO.Directory]::CreateDirectory($Stage)
 foreach($f in ($files+@('SHA256.json'))){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $Stage}
 Verify $Stage
 Write-Output 'Prepared and verified. No installed files changed.';exit
}
Verify $Stage
if(-not(Test-Path -LiteralPath $Destination)){throw 'Existing v4.3 installation required'}
# Legacy v4.3 has no installation barrier: operator must stop new starts during upgrade.
$active=@(Get-CimInstance Win32_Process|Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)(run_paw\.(ps1|cmd)|gemini_pw\.py|copilot_pw\.py)' })
if($active.Count){throw 'Active launcher: refuse installation'}
$locks=@();$backup=$Destination+'.backup-v43-'+(Get-Date -Format 'yyyyMMdd-HHmmss-ffff')
try {
 foreach($f in @('C:\Users\Public\paw-data\lock_cdx','C:\Users\Public\paw-data\lock_gem')+@(Get-ChildItem 'C:\Users\Public\paw-data\lock_cop_*' -ErrorAction SilentlyContinue|ForEach-Object FullName)) {
  $locks+= [IO.File]::Open($f,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 }
 Copy-Item -LiteralPath $Destination -Destination $backup -Recurse
 $before=@{};foreach($f in $files){$p=Join-Path $Destination $f;if(Test-Path $p){$before[$f]=HashFile $p}}
 $before|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'backup-hashes.json') -Encoding UTF8
 try {
  foreach($f in ($files+@('SHA256.json'))){Copy-Item -LiteralPath (Join-Path $Stage $f) -Destination $Destination -Force}
  Verify $Destination
 } catch {
  foreach($f in ($files+@('SHA256.json'))){$old=Join-Path $backup $f;$new=Join-Path $Destination $f;if(Test-Path $old){Copy-Item -LiteralPath $old -Destination $new -Force}else{if(Test-Path $new){Remove-Item -LiteralPath $new}}}
  foreach($f in $before.Keys){if((HashFile (Join-Path $Destination $f)) -ne $before[$f]){throw 'Rollback hash mismatch; manual intervention required'}}
  throw
 }
 Write-Output "Installed; backup: $backup. cdx remains gated until independent sandbox certification."
} finally {foreach($l in $locks){$l.Dispose()}}
