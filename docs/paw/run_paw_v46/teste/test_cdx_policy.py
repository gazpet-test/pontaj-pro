"""#028 binding/policy regression with copied code and synthetic configuration.
No Install/Run/Seal, registry mutations, credentials, Codex or network.
"""
import json, os, pathlib, shutil, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
class Policy(unittest.TestCase):
 def test_windows_informational_and_pinned_binding(self):
  with tempfile.TemporaryDirectory(prefix='policy-',dir=HERE) as d:
   root=pathlib.Path(d).resolve();bin=root/'bin';bin.mkdir()
   shutil.copyfile(HERE/'cdx_security.ps1',bin/'cdx_security.ps1')
   (bin/'cdx_wfp.ps1').write_text("function GetCdxWfpBinding($sid) { return $script:wfpFixture }")
   script=r"""
$ErrorActionPreference='Stop'
$root='__ROOT__';$PAW_ROOT=$root
. (Join-Path $root 'bin\cdx_security.ps1')
$runtime=Join-Path $root 'codex\fixture';$fixtureCdxHome=Join-Path $root 'home'
[void][IO.Directory]::CreateDirectory($runtime);[void][IO.Directory]::CreateDirectory($fixtureCdxHome)
$script:cfg=@{schema=2;isolation='native-elevated-candidate';runtime_root=$runtime;codex_home=$fixtureCdxHome;reader_sid='SYNTHETIC';version='0.1.0'}
$cfgPath=Join-Path $root 'bin\cdx_install.json';$manifestPath=Join-Path $root 'bin\cdx_runtime_manifest.json'
WriteCdxJson $cfgPath $script:cfg;WriteCdxJson $manifestPath ([ordered]@{fixture='unchanged'})
# These substitutes isolate binding assembly, not filesystem trust certification.
function AssertCdxAdminAcl([string]$path) {}
function AssertCdxSingleFile([string]$path) {}
function GetCdxTree([string]$root) {return @()}
$script:treeHash='unchanged';$script:changedHashLeaf=''
function GetCdxTreeHashes([string]$root) {return [ordered]@{fixture=$script:treeHash}}
function HashCdx([string]$path) {if((Split-Path $path -Leaf) -eq $script:changedHashLeaf){return 'CHANGED'};return 'PINNED'}
$script:authSddl='AUTH';$script:homeSddl='HOME'
function Get-Acl {param([string]$LiteralPath)
 if($LiteralPath -eq (Join-Path $fixtureCdxHome 'auth.json')){return @{Sddl=$script:authSddl}}
 if($LiteralPath -eq $fixtureCdxHome){return @{Sddl=$script:homeSddl}}
 throw 'Unexpected ACL path'
}
$script:build='26200';$script:ubr=1;$script:metadataFails=$false
function Get-ItemProperty {param([string]$LiteralPath,[string]$ErrorAction)
 if($LiteralPath -ne 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'){throw 'Unexpected registry path'}
 if($script:metadataFails){throw 'synthetic unavailable'}
 return @{CurrentBuildNumber=$script:build;UBR=$script:ubr}
}
$results=New-Object Collections.Generic.List[object]
function Case($name,[scriptblock]$body,[bool]$reject=$false){
 $ok=$false;$reason='';try{& $body;$ok=(-not $reject)}catch{$reason=$_.Exception.Message;$ok=$reject}
 $results.Add(@{name=$name;ok=$ok;detail=$reason})
}
$script:wfpFixture='PINNED_WFP'
$baseline=GetCdxBinding
Case 'wfp_binding_change_invalidates' {$script:wfpFixture='WRONG_WFP';AssertCdxHashes $baseline (GetCdxBinding)} $true
$script:wfpFixture='PINNED_WFP'
Case 'windows_build_ubr_change_does_not_invalidate' {
 $info1=GetCdxWindowsInfo;$script:build='99999';$script:ubr=9999;$info2=GetCdxWindowsInfo
 if($info1.windows_build -eq $info2.windows_build -or $info1.windows_ubr -eq $info2.windows_ubr){throw 'Missing updated telemetry'}
 AssertCdxHashes $baseline (GetCdxBinding)
 if($baseline.Contains('windows_build') -or $baseline.Contains('windows_ubr') -or $baseline.Contains('os')){throw 'Windows still in binding'}
}
Case 'metadata_unavailable_is_informational' {
 $script:metadataFails=$true;$i=GetCdxWindowsInfo
 if($i.available -or $i.error -ne 'windows_metadata_unavailable'){throw 'Missing telemetry failure signal'}
 AssertCdxHashes $baseline (GetCdxBinding)
}
$script:metadataFails=$false
Case 'auth_acl_change_invalidates' {$script:authSddl='CHANGED';AssertCdxHashes $baseline (GetCdxBinding)} $true
$script:authSddl='AUTH'
Case 'codex_home_acl_change_invalidates' {$script:homeSddl='CHANGED';AssertCdxHashes $baseline (GetCdxBinding)} $true
$script:homeSddl='HOME'
Case 'codex_version_change_invalidates' {$script:cfg.version='0.2.0';WriteCdxJson $cfgPath $script:cfg;AssertCdxHashes $baseline (GetCdxBinding)} $true
$script:cfg.version='0.1.0';WriteCdxJson $cfgPath $script:cfg
Case 'runtime_manifest_mismatch_refused' {$script:treeHash='CHANGED';[void](GetCdxBinding)} $true
$script:treeHash='unchanged'
Case 'bin_hash_change_invalidates' {$script:changedHashLeaf='cdx.ps1';AssertCdxHashes $baseline (GetCdxBinding)} $true
Case 'node_hash_change_invalidates' {$script:changedHashLeaf='node.exe';AssertCdxHashes $baseline (GetCdxBinding)} $true
$script:changedHashLeaf=''
Case 'binding_original_after_restoring_fixtures' {AssertCdxHashes $baseline (GetCdxBinding)}
$results|ConvertTo-Json -Depth 15
""".replace('__ROOT__',str(root))
   f=root/'policy.ps1';f.write_text(script,encoding='utf-8')
   r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,timeout=60,env=dict(os.environ,TEMP=str(root),TMP=str(root)))
   self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   cases=json.loads(r.stdout)
   for case in cases:
    with self.subTest(case['name']):self.assertTrue(case['ok'],case)
   print('POLICY_CASES',len(cases))
if __name__=='__main__':unittest.main(verbosity=2)
