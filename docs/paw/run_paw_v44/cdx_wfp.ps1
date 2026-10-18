# No engine mutation on import. Caller verifies admin-owned/hash-pinned source first.
function InitializeCdxWfp {
 if(-not ('PawCdxWfp' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'cdx_wfp.cs')}
}
function GetCdxOfflineSid {
 $account=New-Object Security.Principal.NTAccount([Environment]::MachineName,'CodexSandboxOffline')
 return $account.Translate([Security.Principal.SecurityIdentifier]).Value
}
function GetCdxWfpBinding([string]$expectedSid) {
 if(-not $expectedSid -or (GetCdxOfflineSid) -cne $expectedSid){throw 'cdx_wfp_sandbox_identity_changed'}
 InitializeCdxWfp
 return [ordered]@{policy='persistent-ale-connect-v1';offline_sid=$expectedSid;verified=[PawCdxWfp]::Inspect($expectedSid)}
}
function InstallCdxWfp([string]$sid,[string]$readerSid) {
 InitializeCdxWfp
 [void][PawCdxWfp]::Install($sid,$readerSid)
}
function RemoveCdxWfp {
 InitializeCdxWfp
 [void][PawCdxWfp]::Remove()
}
