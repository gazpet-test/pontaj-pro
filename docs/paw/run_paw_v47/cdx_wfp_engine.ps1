# ADMIN-ONLY, explicit engine read grant/revoke. Never run by a coding agent.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Grant','Revoke')][string]$Action,
 [Parameter(Mandatory=$true)][string]$ReceiptPath)
$ErrorActionPreference='Stop'
$PAW_ROOT='C:\ProgramData\Gazpet\Paw'
if($PSScriptRoot -ine (Join-Path $PAW_ROOT 'bin')){throw 'Run only from reviewed installed bin'}
$who=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
. (Join-Path $PSScriptRoot 'cdx_security.ps1')
foreach($path in @($PAW_ROOT,$PSScriptRoot,(Join-Path $PSScriptRoot 'SHA256.json'))){AssertCdxAdminAcl $path}
AssertCdxSingleFile (Join-Path $PSScriptRoot 'SHA256.json')
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SHA256.json') -Raw|ConvertFrom-Json
foreach($name in @('cdx_wfp_engine.ps1','cdx_wfp.ps1','cdx_wfp.cs','cdx_security.ps1')){
 $path=Join-Path $PSScriptRoot $name;AssertCdxAdminAcl $path;AssertCdxSingleFile $path
 if((HashCdx $path) -cne $manifest.$name){throw 'WFP maintenance source hash mismatch'}
}
$cfgPath=Join-Path $PSScriptRoot 'cdx_install.json';AssertCdxAdminAcl $cfgPath;AssertCdxSingleFile $cfgPath
$cfg=Get-Content -LiteralPath $cfgPath -Raw|ConvertFrom-Json
$localReader=New-Object Security.Principal.NTAccount([Environment]::MachineName,'Gazpet-Ai')
$readerSid=$localReader.Translate([Security.Principal.SecurityIdentifier]).Value
if($readerSid -cne $cfg.reader_sid){throw 'Reader differs from local Gazpet-Ai'}
$ReceiptPath=AssertCdxPath $ReceiptPath
if(-not $ReceiptPath.StartsWith($PAW_ROOT+'\',[StringComparison]::OrdinalIgnoreCase) -or $ReceiptPath.StartsWith($PSScriptRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Receipt must be under an admin-owned Paw audit directory outside bin'}
for($dir=(Split-Path $ReceiptPath);$dir -and $dir -ine $PAW_ROOT;$dir=Split-Path $dir){AssertCdxAdminAcl $dir}
. (Join-Path $PSScriptRoot 'cdx_wfp.ps1')
InitializeCdxWfp
$barrier=OpenCdxInstallBarrier $true
try {
 if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'cdx_sandbox_validat.json')){throw 'Retract certificate before deliberate WFP maintenance'}
 if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'cdx_certification_permit.json')){throw 'Certification in progress; no WFP maintenance'}
 if(Test-Path -LiteralPath $ReceiptPath){
  AssertCdxAdminAcl $ReceiptPath;AssertCdxSingleFile $ReceiptPath
  $receipt=Get-Content -LiteralPath $ReceiptPath -Raw|ConvertFrom-Json
  if($receipt.schema -ne 1 -or $receipt.sid -cne $readerSid -or $receipt.mask -ne 192 -or $receipt.added -isnot [bool] -or $receipt.state -notin @('prepared','granted','revoked')){throw 'Invalid WFP read receipt'}
  $plan=[PawCdxWfp]::PlanEngineRead($receipt.before,$readerSid)
  if($plan.After -cne $receipt.after -or $plan.Added -ne $receipt.added){throw 'Receipt does not prove exact ACE addition'}
 }else{
  if($Action -ne 'Grant'){throw 'Missing WFP receipt; no rollback without provenance'}
  $plan=[PawCdxWfp]::PlanEngineRead([PawCdxWfp]::GetEngineDacl(),$readerSid)
  $receipt=[ordered]@{schema=1;sid=$readerSid;mask=192;added=$plan.Added;before=$plan.Before;after=$plan.After;state='prepared';created_utc=[DateTime]::UtcNow.ToString('o')}
  # Journal BEFORE mutation; no overwrite of a competing receipt or unreviewed file.
  $bytes=[Text.Encoding]::UTF8.GetBytes(($receipt|ConvertTo-Json -Depth 10))
  $file=[IO.File]::Open($ReceiptPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
  SetCdxAdminAcl $ReceiptPath $readerSid
 }
 if($Action -eq 'Grant'){
  if($receipt.state -eq 'revoked'){throw 'Receipt already revoked; use a new reviewed receipt for re-grant'}
  $current=[PawCdxWfp]::GetEngineDacl()
  if($current -cne $receipt.after){
   if($current -cne $receipt.before -or $receipt.state -ne 'prepared'){throw 'Engine DACL drift; STOP'}
   [PawCdxWfp]::GrantEngineRead($receipt.before,$receipt.after,$readerSid)
  }
  $receipt.state='granted'
 }else{
  [PawCdxWfp]::RevokeEngineRead($receipt.before,$receipt.after,$readerSid,$receipt.added)
  $receipt.state='revoked'
 }
 WriteCdxJson $ReceiptPath $receipt;SetCdxAdminAcl $ReceiptPath $readerSid
 Write-Output ('WFP_ENGINE_READ '+$receipt.state+' mask=0xC0 added='+$receipt.added+' receipt='+$ReceiptPath)
}finally{$barrier.Dispose()}
