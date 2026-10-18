"""R4 isolated helpers: local NTFS fixtures and loopback HTTP only.
Never calls Install/Run/Seal, Codex, real credentials or LAN/public network.
"""
import json, os, pathlib, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
PRELUDE=r"""
$ErrorActionPreference='Stop'
. '__SOURCE__\cdx_security.ps1'
$root='__ROOT__'
$results=New-Object Collections.Generic.List[object]
function Case($name,[scriptblock]$body,[bool]$reject=$false){
 $ok=$false;$reason=''
 try{& $body;$ok=(-not $reject)}catch{$reason=$_.Exception.Message;$ok=$reject}
 $results.Add(@{name=$name;ok=$ok;detail=$reason})
}
function ImportFunction($file,$name){
 $tok=$null;$err=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tok,[ref]$err)
 if($err.Count){throw 'Invalid syntax'}
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(-not $fn){throw ('Missing helper '+$name)}
 return [scriptblock]::Create($fn.Extent.Text)
}
"""
class R4(unittest.TestCase):
 def run_fixture(self, body, timeout=90):
  with tempfile.TemporaryDirectory(prefix='r4-',dir=HERE) as d:
   root=pathlib.Path(d).resolve();f=root/'fixture.ps1'
   f.write_text((PRELUDE+body+"\n$results|ConvertTo-Json -Depth 20\n").replace('__SOURCE__',str(HERE)).replace('__ROOT__',str(root)),encoding='utf-8')
   r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,timeout=timeout,env=dict(os.environ,TEMP=str(root),TMP=str(root)))
   self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   cases=json.loads(r.stdout)
   if isinstance(cases,dict):cases=[cases]
   for case in cases:
    with self.subTest(case['name']):self.assertTrue(case['ok'],case)
   print('R4_CASES',len(cases))
 def test_links_and_legacy_trust(self):
  self.run_fixture(r"""
$work=Join-Path $root 'work';$outside=Join-Path $root 'outside'
[void][IO.Directory]::CreateDirectory($work);[void][IO.Directory]::CreateDirectory($outside)
$file=Join-Path $outside 'canary.txt';[IO.File]::WriteAllText($file,'unchanged');$before=HashCdx $file
$probes=@(@{id='link-hardlink';kind='HardLink';target=$file},@{id='link-junction';kind='Junction';target=$outside},@{id='link-symlink';kind='SymbolicLink';target=$file})
try {
 Case 'cert_known_links_removed_target_unchanged' {
  [void](New-Item -ItemType HardLink -Path (Join-Path $work 'link-hardlink') -Target $file)
  [void](New-Item -ItemType Junction -Path (Join-Path $work 'link-junction') -Target $outside)
  $records=@(ClearCdxCertificationLinks $work $probes)
  if($records.Count -ne 2 -or @($records|Where-Object {-not $_.detected -or -not $_.removed}).Count){throw 'Missing detector records'}
  if((HashCdx $file) -ne $before -or -not (Test-Path -LiteralPath $outside)){throw 'Target changed'}
  AssertCdxSingleFile $file;AssertCdxOutput $work
 }
 Case 'cert_no_created_links' {if(@(ClearCdxCertificationLinks $work $probes).Count){throw 'Fabricated link detection'}}
 Case 'cert_unknown_link_still_refused' {
  [void](New-Item -ItemType Junction -Path (Join-Path $work 'other-junction') -Target $outside)
  [void]@(ClearCdxCertificationLinks $work $probes)
  AssertCdxOutput $work
 } $true
 [IO.Directory]::Delete((Join-Path $work 'other-junction'))
 Case 'cert_wrong_target_refused' {
  [void](New-Item -ItemType Junction -Path (Join-Path $work 'link-junction') -Target $root)
  [void]@(ClearCdxCertificationLinks $work $probes)
 } $true
 [IO.Directory]::Delete((Join-Path $work 'link-junction'))
 Case 'normal_known_junction_still_refused' {
  [void](New-Item -ItemType Junction -Path (Join-Path $work 'link-junction') -Target $outside)
  AssertCdxOutput $work
 } $true
 [IO.Directory]::Delete((Join-Path $work 'link-junction'))
 Case 'cert_regular_file_not_deleted' {
  [IO.File]::WriteAllText((Join-Path $work 'link-hardlink'),'not-a-link')
  [void]@(ClearCdxCertificationLinks $work $probes)
 } $true
 Case 'cert_wrong_kind_not_deleted' {
  [void](New-Item -ItemType Junction -Path (Join-Path $work 'link-symlink') -Target $outside)
  [void]@(ClearCdxCertificationLinks $work @($probes[1],$probes[2],$probes[0]))
 } $true
 Case 'cert_path_traversal_manifest_refused' {
  [void]@(ClearCdxCertificationLinks $work @(@{id='..\outside';kind='Junction';target=$outside},$probes[0],$probes[2]))
 } $true
 Case 'cert_target_content_preserved_all_cases' {if((HashCdx $file) -ne $before){throw 'Canary changed'}}
} finally {
 # Unlink only these fixture containers before Python may delete the temporary root.
 foreach($name in @('link-junction','other-junction','link-symlink')){
  $path=Join-Path $work $name;$item=Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
   if($item.PSIsContainer){[IO.Directory]::Delete($path)}else{[IO.File]::Delete($path)}
  }
 }
}
. (ImportFunction '__SOURCE__\install.ps1' 'GetLegacyHelperPlan')
. (ImportFunction '__SOURCE__\install.ps1' 'CopyLegacyHelper')
$old=Join-Path $root 'legacy';$incoming=Join-Path $root 'incoming'
[void][IO.Directory]::CreateDirectory($old);[void][IO.Directory]::CreateDirectory($incoming)
$helper=Join-Path $old 'cgpt_pw.py';[IO.File]::WriteAllText($helper,'# reviewed synthetic helper')
[IO.File]::WriteAllText((Join-Path $old 'unlisted.py'),'# never inherited')
$expected=HashCdx $helper
# Use in-memory descriptors; production ACL validator stays unmodified.
function Descriptor($unsafe) {
 $a=New-Object Security.AccessControl.DirectorySecurity
 $a.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
 $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')),'FullControl','Allow')))
 $rights=if($unsafe){'Modify'}else{'ReadAndExecute'}
 $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-1-0')),$rights,'Allow')))
 return $a
}
$script:desc=Descriptor $false
function Get-Acl {param([string]$LiteralPath) return $script:desc}
Case 'legacy_exact_reviewed_pin_only' {
 $plan=GetLegacyHelperPlan $old $expected;CopyLegacyHelper $plan $incoming
 if((HashCdx (Join-Path $incoming 'cgpt_pw.py')) -ne $expected -or @(Get-ChildItem $incoming).Count -ne 1){throw 'Unapproved file inherited'}
}
Case 'legacy_no_pin_refused' {[void](GetLegacyHelperPlan $old '')} $true
Case 'legacy_wrong_hash_refused' {[void](GetLegacyHelperPlan $old ('0'*64))} $true
Case 'legacy_unsafe_acl_refused_before_copy' {$script:desc=Descriptor $true;[void](GetLegacyHelperPlan $old $expected)} $true
$script:desc=Descriptor $false
$plan=GetLegacyHelperPlan $old $expected
Case 'legacy_acl_changed_source_refused' {
 $script:desc.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-11')),'ReadAndExecute','Allow')))
 CopyLegacyHelper $plan $incoming
} $true
$script:desc=Descriptor $false
Case 'legacy_changed_source_refused' {[IO.File]::WriteAllText($helper,'# changed');CopyLegacyHelper $plan $incoming} $true
Case 'legacy_unlisted_plan_refused' {CopyLegacyHelper @{name='evil.py';source=(Join-Path $old 'unlisted.py');sha256=$expected} $incoming} $true
Case 'legacy_supplied_pin_missing_source' {[void](GetLegacyHelperPlan (Join-Path $root 'absent') $expected)} $true
Case 'legacy_no_helper_no_pin' {if($null -ne (GetLegacyHelperPlan (Join-Path $root 'absent') '')){throw 'unexpected carry'}}
Case 'legacy_verification_precedes_any_acl_change' {
 $s=[IO.File]::ReadAllText('__SOURCE__\install.ps1')
 $verification=$s.IndexOf('$legacyPlan=GetLegacyHelperPlan $Destination')
 if($verification -lt 0 -or $verification -gt $s.IndexOf('SetCdxAdminAcl $d $readerSid')){throw 'ACL changes before verification'}
}
Case 'legacy_protect_precedes_ancestor_acl_change' {
 $s=[IO.File]::ReadAllText('__SOURCE__\install.ps1')
 if($s.IndexOf('$legacyPlan=ProtectLegacyHelperPlan $legacyPlan') -gt $s.IndexOf('SetCdxAdminAcl $d $readerSid')){throw 'Inherited SDDL changed before stabilization'}
}
Remove-Item Function:\Get-Acl
. (ImportFunction '__SOURCE__\install.ps1' 'ProtectLegacyHelperPlan')
$script:parentDesc=Descriptor $false;$script:helperDesc=$script:parentDesc
function Get-Acl {param([string]$LiteralPath) if($LiteralPath -eq $helper){return $script:helperDesc};return $script:parentDesc}
function SetCdxAdminAcl([string]$path,[string]$sid) {
 if($path -ne $helper){throw 'Unexpected synthetic mutation'}
 $script:helperDesc=Descriptor $false
 $script:helperDesc.SetAccessRuleProtection($true,$false)
}
[IO.File]::WriteAllText($helper,'# reviewed synthetic helper')
Case 'legacy_parent_change_does_not_change_protected_snapshot' {
 $plan=GetLegacyHelperPlan $old $expected
 $plan=ProtectLegacyHelperPlan $plan 'SYNTHETIC'
 $script:parentDesc=Descriptor $false
 $script:parentDesc.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-11')),'ReadAndExecute','Allow')))
 $incoming2=Join-Path $root 'incoming-after-parent';[void][IO.Directory]::CreateDirectory($incoming2)
 CopyLegacyHelper $plan $incoming2
 if((HashCdx (Join-Path $incoming2 'cgpt_pw.py')) -ne $expected){throw 'Wrong helper'}
}
Case 'legacy_actual_change_before_protection_still_refused' {
 $plan=GetLegacyHelperPlan $old $expected
 $script:helperDesc.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-11')),'ReadAndExecute','Allow')))
 [void](ProtectLegacyHelperPlan $plan 'SYNTHETIC')
} $true
Remove-Item Function:\Get-Acl
""")
 def test_file_symlink_cleanup(self):
  with tempfile.TemporaryDirectory(prefix='r4-symlink-',dir=HERE) as d:
   root=pathlib.Path(d).resolve();work=root/'work';work.mkdir();outside=root/'outside.txt';outside.write_text('unchanged');link=work/'link-symlink'
   try:
    try:os.symlink(outside,link)
    except OSError as e:
     if getattr(e,'winerror',None)==1314:self.skipTest('Unprivileged file-symlink creation unavailable; no privilege or policy changes')
     raise
    script=PRELUDE+r"""
$work=Join-Path $root 'work';$target=Join-Path $root 'outside.txt'
$p=@(@{id='link-hardlink';kind='HardLink';target=$target},@{id='link-junction';kind='Junction';target=$root},@{id='link-symlink';kind='SymbolicLink';target=$target})
$records=@(ClearCdxCertificationLinks $work $p)
if($records.Count -ne 1 -or $records[0].kind -ne 'SymbolicLink' -or -not $records[0].removed -or [IO.File]::ReadAllText($target) -cne 'unchanged'){throw 'File symlink cleanup failed'}
AssertCdxOutput $work
"""
    f=root/'fixture.ps1';f.write_text(script.replace('__SOURCE__',str(HERE)).replace('__ROOT__',str(root)),encoding='utf-8')
    r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,timeout=30,env=dict(os.environ,TEMP=str(root),TMP=str(root)))
    self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertFalse(link.exists());self.assertEqual(outside.read_text(),'unchanged')
   finally:
    if link.is_symlink():link.unlink()
 def test_native_http_positive_control(self):
  self.run_fixture(r"""
. (ImportFunction '__SOURCE__\certifica_cdx.ps1' 'TestNativeNetworkControl')
$native=Join-Path $root 'native curl.exe';Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\curl.exe') -Destination $native
$l=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0);$l.Start()
$url='http://127.0.0.1:'+ $l.LocalEndpoint.Port+'/'
try {
 Case 'native_same_binary_same_listener_exit_zero' {
  $r=TestNativeNetworkControl $native $l $url
  if(-not $r.observed -or $r.exit_code -ne 0 -or $r.native_sha256 -cne (HashCdx $native) -or $r.url -cne $url -or $l.Pending()){throw 'Incorrect positive evidence / undrained listener'}
 }
 # Native fixture exits 7 without touching network. Must NEVER count as valid control.
 $broken=Join-Path $root 'broken.exe'
 Add-Type -TypeDefinition 'public class BrokenCurl { public static int Main(string[] args) { return 7; } }' -OutputAssembly $broken -OutputType ConsoleApplication
 Case 'native_broken_exit7_control_refused' {[void](TestNativeNetworkControl $broken $l $url)} $true
 $zero=Join-Path $root 'zero.exe'
 Add-Type -TypeDefinition 'public class EmptyCurl { public static int Main(string[] args) { return 0; } }' -OutputAssembly $zero -OutputType ConsoleApplication
 Case 'native_exit_zero_without_connection_refused' {[void](TestNativeNetworkControl $zero $l $url)} $true
 Case 'native_file_uri_spaces' {
  $p=Join-Path $root 'file with spaces.txt';[IO.File]::WriteAllText($p,'SYNTHETIC_ONLY')
  $uri=([Uri]$p).AbsoluteUri
  if(-not $uri.StartsWith('file:///') -or -not $uri.Contains('%20')){throw 'Unexpected file URI format'}
  $content=& $native --disable --noproxy '*' --proto '=file' --max-time 5 --silent --show-error $uri
  if($LASTEXITCODE -ne 0 -or $content -cne 'SYNTHETIC_ONLY'){throw 'File URI failed'}
 }
} finally {$l.Stop()}
""")
if __name__=='__main__':unittest.main(verbosity=2)
