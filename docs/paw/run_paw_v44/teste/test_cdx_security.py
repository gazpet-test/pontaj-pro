"""CPU/NTFS guards only. No real Codex, ProgramData, credentials, account or firewall changes."""
import json,os,pathlib,subprocess,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
class Security(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory(prefix='security-',dir=HERE);cls.root=pathlib.Path(cls.tmp.name).resolve()
  script=r"""
$ErrorActionPreference='Stop'
. '__SOURCE__\cdx_security.ps1'
$root='__ROOT__'
$results=New-Object Collections.Generic.List[object]
function Case($name,[scriptblock]$body,[bool]$reject=$false){
 $ok=$false;$reason=''
 try{& $body;$ok=(-not $reject)}catch{$reason=$_.Exception.Message;$ok=$reject}
 $results.Add(@{name=$name;ok=$ok;detail=$reason})
}
Case 'syntax_all' { foreach($f in Get-ChildItem '__SOURCE__' -Filter '*.ps1'){$tok=$null;$err=$null;[void][Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$tok,[ref]$err);if($err.Count){throw ($f.Name+': '+($err.Message -join ', '))}} }
Case 'reserved_names' {foreach($n in @('CON','nul.txt','COM1','LPT9.txt','bad.','bad ')) { $failed=$false;try{[void](AssertCdxPath (Join-Path $root $n))}catch{$failed=$true};if(-not $failed){throw $n}}}
Case 'ADS_UNC' {foreach($n in @('C:\a:b','\\localhost\c$\x')){$failed=$false;try{[void](AssertCdxPath $n)}catch{$failed=$true};if(-not $failed){throw $n}}}
Case 'hardlink_refused' {$a=Join-Path $root 'a';$b=Join-Path $root 'b';[IO.File]::WriteAllText($a,'test');[void](New-Item -ItemType HardLink -Path $b -Target $a);AssertCdxSingleFile $a} $true
Case 'reparse_refused' {$a=Join-Path $root 'real';[void][IO.Directory]::CreateDirectory($a);$b=Join-Path $root 'junction';[void](New-Item -ItemType Junction -Path $b -Target $a);[void](GetCdxTree $b)} $true
Case 'root_reparse_refused' {[void](AssertCdxOutput (Join-Path $root 'junction'))} $true
Case 'non_admin_acl_refused' {AssertCdxAdminAcl $root} $true
$env:GITHUB_TOKEN='SYNTHETIC';$env:SUPABASE_KEY='SYNTHETIC';$env:NODE_OPTIONS='SYNTHETIC'
Case 'environment_allowlist' {$e=GetCdxEnvironment $root $root $root;if($e.ContainsKey('GITHUB_TOKEN') -or $e.ContainsKey('SUPABASE_KEY') -or $e.ContainsKey('NODE_OPTIONS') -or $e.ContainsKey('USERPROFILE') -or $e.ContainsKey('APPDATA')){throw 'secret inherited'};if($e.TEMP -ne (Join-Path $root '.tmp') -or $e.GIT_CONFIG_GLOBAL -ne 'NUL'){throw 'wrong env'}}
Case 'git_filter_rejected' {$p=Join-Path $root 'filter-config';[IO.File]::WriteAllText($p,"[filter `"evil`"]`n clean = calc.exe`n");AssertCdxGitConfig $p} $true
Case 'git_include_rejected' {$p=Join-Path $root 'include-config';[IO.File]::WriteAllText($p,"[include]`n path = bad`n");AssertCdxGitConfig $p} $true
Case 'git_command_rejected' {$p=Join-Path $root 'ssh-config';[IO.File]::WriteAllText($p,"[core]`n sshCommand = bad`n");AssertCdxGitConfig $p} $true
Case 'git_safe_accepted' {$p=Join-Path $root 'safe-config';[IO.File]::WriteAllText($p,"[core]`n bare = false`n[remote `"origin`"]`n url = https://github.com/gazpet-test/pontaj-pro.git`n fetch = +refs/heads/*:refs/remotes/origin/*`n");AssertCdxGitConfig $p}
Case 'git_origin_rejected' {$p=Join-Path $root 'origin-config';[IO.File]::WriteAllText($p,"[remote `"origin`"]`n url = ext::evil`n");AssertCdxGitConfig $p} $true
Case 'nested_git_rejected' {$p=Join-Path $root 'out-nested';[void][IO.Directory]::CreateDirectory((Join-Path $p 'sub'));[IO.File]::WriteAllText((Join-Path $p 'sub\.git'),'gitdir: bad');AssertCdxOutput $p} $true
Case 'attributes_rejected' {$p=Join-Path $root 'out-attrs';[void][IO.Directory]::CreateDirectory($p);[IO.File]::WriteAllText((Join-Path $p '.gitattributes'),'* filter=evil');AssertCdxOutput $p} $true
Case 'modules_rejected' {$p=Join-Path $root 'out-module';[void][IO.Directory]::CreateDirectory($p);[IO.File]::WriteAllText((Join-Path $p '.gitmodules'),'[submodule x]');AssertCdxOutput $p} $true
Case 'safe_output' {$p=Join-Path $root 'out-safe';[void][IO.Directory]::CreateDirectory($p);[IO.File]::WriteAllText((Join-Path $p '.git'),'gitdir: fixture');[IO.File]::WriteAllText((Join-Path $p '.gitattributes'),'* -text');AssertCdxOutput $p}
Case 'manifest_extra_rejected' {$p=Join-Path $root 'tree';[void][IO.Directory]::CreateDirectory($p);[IO.File]::WriteAllText((Join-Path $p 'x'),'a');$before=GetCdxTreeHashes $p;[IO.File]::WriteAllText((Join-Path $p 'extra'),'b');AssertCdxHashes $before (GetCdxTreeHashes $p)} $true
Case 'metadata_changed_rejected' {$p=Join-Path $root 'meta';[void][IO.Directory]::CreateDirectory($p);[IO.File]::WriteAllText((Join-Path $p 'HEAD'),'a');$before=GetCdxGitSnapshot $p $p;[IO.File]::WriteAllText((Join-Path $p 'HEAD'),'b');AssertCdxHashes $before (GetCdxGitSnapshot $p $p)} $true
Case 'trusted_argument_quoting' {if((ArgCdx 'one') -cne 'one' -or (ArgCdx '') -cne '""' -or (ArgCdx 'a b') -cne '"a b"' -or (ArgCdx 'a"b') -cne '"a\"b"' -or (ArgCdx 'c:\a b\') -cne '"c:\a b\\"'){throw 'bad CRT quoting'}}
Case 'argument_newline_rejected' {[void](ArgCdx "a`nb")} $true
Case 'matching_hashes' {$a=[ordered]@{x='abc';nested=[ordered]@{y='def'}};$b=$a|ConvertTo-Json|ConvertFrom-Json;AssertCdxHashes $a $b}
# Extract ONLY this pure validator function via AST, never execute certificate installer/top-level.
$tok=$null;$err=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\certifica_cdx.ps1',[ref]$tok,[ref]$err)
foreach($name in @('GetCdxActionValues','AssertEventReview')){$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);. ([scriptblock]::Create($fn.Extent.Text))}

function ReviewFixture {
 return @{verdict='ALL_DENIED';reviewed_by='test';probes=@(@{id='one';event_line=1;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='synthetic externally reviewed denial';denial_excerpt='Access denied'})}
}
$probeFixture=@(@{id='one';tool_type='command_execution';action_tokens=@('C:\canary','ReadAllText');instruction='ReadAllText C:\canary # one'})
$eventFixture='{"type":"item.completed","item":{"id":"event1","type":"command_execution","command":"ReadAllText C:\\canary # one","exit_code":1,"aggregated_output":"Access denied"}}'
Case 'certificate_narrative_rejected' {AssertEventReview (ReviewFixture) @('{"type":"item.completed","item":{"id":"event1","type":"agent_message","text":"all denied"}}') $probeFixture} $true
Case 'certificate_missing_attempt_rejected' {$r=ReviewFixture;$r.probes[0].attempt_observed=$false;AssertEventReview $r @($eventFixture) $probeFixture} $true
Case 'certificate_duplicate_rejected' {$r=ReviewFixture;$r.probes+= $r.probes[0];AssertEventReview $r @($eventFixture) @($probeFixture[0],$probeFixture[0])} $true
Case 'certificate_structured_review' {AssertEventReview (ReviewFixture) @($eventFixture) $probeFixture}
Case 'certificate_reused_event_line' {
 $r=ReviewFixture;$r.probes+=@{id='two';event_line=1;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='test';denial_excerpt='Access denied'}
 AssertEventReview $r @($eventFixture.Replace('# one','# one two')) @($probeFixture[0],@{id='two';tool_type='command_execution';action_tokens=@('C:\canary','ReadAllText');instruction='ReadAllText C:\canary # two'})
} $true
Case 'certificate_reused_item_id' {
 $r=ReviewFixture;$r.probes+=@{id='two';event_line=2;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='test';denial_excerpt='Access denied'}
 AssertEventReview $r @($eventFixture,$eventFixture.Replace('# one','# two')) @($probeFixture[0],@{id='two';tool_type='command_execution';action_tokens=@('C:\canary','ReadAllText');instruction='ReadAllText C:\canary # two'})
} $true
Case 'certificate_wrong_target' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('canary','different')) $probeFixture} $true
Case 'certificate_id_only_in_output' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('# one','# other').Replace('Access denied','Access denied one')) $probeFixture} $true
Case 'certificate_action_only_in_output' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('ReadAllText C:\\canary # one','echo one').Replace('Access denied','Access denied ReadAllText C:\\canary one')) $probeFixture} $true
Case 'certificate_success_rejected' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('"exit_code":1','"exit_code":0')) $probeFixture} $true
Case 'certificate_unfinished_rejected' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('item.completed','item.updated')) $probeFixture} $true
Case 'certificate_fabricated_excerpt_rejected' {$r=ReviewFixture;$r.probes[0].denial_excerpt='fake';AssertEventReview $r @($eventFixture) $probeFixture} $true
Case 'certificate_two_distinct_events' {
 $r=ReviewFixture;$r.probes+=@{id='two';event_line=2;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='test';denial_excerpt='Access denied'}
 AssertEventReview $r @($eventFixture,$eventFixture.Replace('# one','# two').Replace('event1','event2')) @($probeFixture[0],@{id='two';tool_type='command_execution';action_tokens=@('C:\canary','ReadAllText');instruction='ReadAllText C:\canary # two'})
}

Case 'certificate_wrong_verb' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('ReadAllText','WriteAllText')) $probeFixture} $true

Case 'certificate_powershell_wrapper' {
 $e=$eventFixture|ConvertFrom-Json
 $e.item.command='"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "[IO.File]::ReadAllText(''C:\canary'') # one"'
 AssertEventReview (ReviewFixture) @(($e|ConvertTo-Json -Depth 20 -Compress)) $probeFixture
}
Case 'certificate_cmd_wrapper' {
 $e=$eventFixture|ConvertFrom-Json
 $e.item.command='cmd.exe /c powershell.exe -NoProfile -Command "[IO.File]::ReadAllText(''C:/canary'') # one"'
 AssertEventReview (ReviewFixture) @(($e|ConvertTo-Json -Depth 20 -Compress)) $probeFixture
}
Case 'certificate_path_suffix_rejected' {AssertEventReview (ReviewFixture) @($eventFixture.Replace('canary','canary-evil')) $probeFixture} $true
Case 'certificate_guid_path_mismatch' {
 $p=@(@{id='one';tool_type='command_execution';action_tokens=@('C:\canary-12345678123412341234123456781234.txt','ReadAllText')})
 AssertEventReview (ReviewFixture) @($eventFixture.Replace('canary','canary-22345678123412341234123456781234.txt')) $p
} $true
Case 'certificate_key_argument_missing' {
 AssertEventReview (ReviewFixture) @($eventFixture) @(@{id='one';tool_type='command_execution';action_tokens=@('C:\canary','ReadAllText','--max-time 5')})
} $true
function FreshFixture {return @{certified_utc=[DateTime]::UtcNow.ToString('o');expires_utc=[DateTime]::UtcNow.AddHours(23).ToString('o')}}
Case 'certificate_fresh' {AssertCdxCertificateFresh (FreshFixture)}
Case 'certificate_expired' {$c=FreshFixture;$c.certified_utc=[DateTime]::UtcNow.AddHours(-25).ToString('o');$c.expires_utc=[DateTime]::UtcNow.AddHours(-1).ToString('o');AssertCdxCertificateFresh $c} $true
Case 'certificate_future' {$c=FreshFixture;$c.certified_utc=[DateTime]::UtcNow.AddHours(1).ToString('o');AssertCdxCertificateFresh $c} $true
Case 'certificate_over_24h' {$c=FreshFixture;$c.expires_utc=[DateTime]::UtcNow.AddHours(25).ToString('o');AssertCdxCertificateFresh $c} $true
Case 'certificate_no_expiry' {AssertCdxCertificateFresh @{certified_utc=[DateTime]::UtcNow.ToString('o')}} $true

function EvidenceFixture {return @{run_started_utc=[DateTime]::UtcNow.AddMinutes(-10).ToString('o');run_completed_utc=[DateTime]::UtcNow.AddMinutes(-1).ToString('o')}}
Case 'evidence_fresh' {$e=EvidenceFixture;$start=AssertCdxEvidenceFresh $e;if($start.AddHours(24) -gt [DateTimeOffset]::UtcNow.AddHours(24)){throw 'Expiry extended beyond Run'}}
Case 'evidence_expired_cannot_reseal' {$e=EvidenceFixture;$e.run_started_utc=[DateTime]::UtcNow.AddHours(-25).ToString('o');[void](AssertCdxEvidenceFresh $e)} $true
Case 'evidence_missing_times' {[void](AssertCdxEvidenceFresh @{})} $true
Case 'evidence_future_completion' {$e=EvidenceFixture;$e.run_completed_utc=[DateTime]::UtcNow.AddHours(1).ToString('o');[void](AssertCdxEvidenceFresh $e)} $true
Case 'evidence_end_before_start' {$e=EvidenceFixture;$e.run_completed_utc=[DateTime]::UtcNow.AddHours(-1).ToString('o');[void](AssertCdxEvidenceFresh $e)} $true
Case 'certificate_patch_denial' {
 $r=ReviewFixture
 AssertEventReview $r @('{"type":"item.completed","item":{"id":"patch1","type":"file_change","status":"failed","changes":[{"path":"C:\\one-canary","diff":"-CANARY_WRITE_INITIAL\n+PAW_CHANGED"}],"error":"Access denied"}}') @(@{id='one';tool_type='file_change';action_tokens=@('C:\one-canary','CANARY_WRITE_INITIAL','PAW_CHANGED')})
}
Case 'certificate_file_tool_denial' {
 AssertEventReview (ReviewFixture) @('{"type":"item.completed","item":{"id":"read1","type":"tool_call","status":"failed","arguments":{"path":"C:\\one-canary"},"error":"Access denied"}}') @(@{id='one';tool_type='tool_call';action_tokens=@('C:\one-canary')})
}
$nativeProbe=@(@{id='native-read';tool_type='command_execution';action_tokens=@('native.exe');instruction='native.exe # native-read'})
$nativeEvent='{"type":"item.completed","item":{"id":"native1","type":"command_execution","command":"native.exe # native-read","exit_code":37,"aggregated_output":"curl: (37) Access denied"}}'
function NativeReview {$r=ReviewFixture;$r.probes[0].id='native-read';$r.probes[0].native_execution_observed=$true;return $r}
Case 'certificate_native_operation_denial' {AssertEventReview (NativeReview) @($nativeEvent) $nativeProbe}
Case 'certificate_native_not_started_rejected' {AssertEventReview (NativeReview) @($nativeEvent.Replace('curl: (37) ','Executable cannot start; ')) $nativeProbe} $true
Case 'certificate_native_timeout_rejected' {AssertEventReview (NativeReview) @($nativeEvent.Replace('(37)','(28)')) $nativeProbe} $true
Case 'certificate_native_unreviewed_rejected' {$r=NativeReview;$r.probes[0].native_execution_observed=$false;AssertEventReview $r @($nativeEvent) $nativeProbe} $true
# Extract only inventory validator, no Install top-level.
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\install.ps1',[ref]$tok,[ref]$err)
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'AssertLegacyInventory'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
Case 'maintenance_empty' {AssertLegacyInventory @() @() @()}
Case 'maintenance_active_process' {AssertLegacyInventory @(@{ProcessId=999999;CommandLine='powershell run_paw.ps1 gem'}) @() @()} $true
Case 'maintenance_ready_task' {AssertLegacyInventory @() @(@{TaskName='run_paw';TaskPath='\';State='Ready';Settings=@{Enabled=$true};Actions=@()}) @()} $true
Case 'maintenance_running_disabled_task' {AssertLegacyInventory @() @(@{TaskName='run_paw';TaskPath='\';State='Running';Settings=@{Enabled=$false};Actions=@()}) @()} $true
Case 'maintenance_disabled_task' {AssertLegacyInventory @() @(@{TaskName='run_paw';TaskPath='\';State='Disabled';Settings=@{Enabled=$false};Actions=@()}) @()}
Case 'maintenance_task_action' {AssertLegacyInventory @() @(@{TaskName='unrelated';TaskPath='\';State='Ready';Settings=@{Enabled=$true};Actions=@(@{Execute='cmd.exe';Arguments='/c C:\old\run_paw.cmd gem';WorkingDirectory=''})}) @()} $true
Case 'maintenance_service_enabled' {AssertLegacyInventory @() @() @(@{Name='run_paw';PathName='wrapper';State='Stopped';StartMode='Auto'})} $true
Case 'maintenance_service_disabled' {AssertLegacyInventory @() @() @(@{Name='run_paw';PathName='wrapper';State='Stopped';StartMode='Disabled'})}
# ACL decision tests use in-memory security descriptors, not filesystem ACL changes.
function AclFixture($owner,$writer) {
 $a=New-Object Security.AccessControl.DirectorySecurity
 $a.SetOwner((New-Object Security.Principal.SecurityIdentifier($owner)))
 $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')),'FullControl','Allow')))
 $rights=if($writer){'Modify'}else{'ReadAndExecute'}
 $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-1-0')),$rights,'Allow')))
 return $a
}
function Get-Acl {param([string]$LiteralPath) return $script:aclFixture}
Case 'admin_acl_readers_allowed' {$script:aclFixture=AclFixture 'S-1-5-32-544' $false;AssertCdxAdminAcl $root}
Case 'admin_acl_world_write_rejected' {$script:aclFixture=AclFixture 'S-1-5-32-544' $true;AssertCdxAdminAcl $root} $true
Case 'non_admin_owner_rejected' {$script:aclFixture=AclFixture 'S-1-1-0' $false;AssertCdxAdminAcl $root} $true

Case 'install_barrier_handle_not_inherited' {
 $PAW_ROOT=$root;$script:aclFixture=AclFixture 'S-1-5-32-544' $false
 [IO.File]::WriteAllText((Join-Path $root 'install.lock'),'test')
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class HandleFlags { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetHandleInformation(IntPtr h, out uint f); }'
 foreach($exclusive in @($false,$true)) {
  $h=OpenCdxInstallBarrier $exclusive
  try{$flags=0;if(-not [HandleFlags]::GetHandleInformation($h.SafeFileHandle.DangerousGetHandle(),[ref]$flags) -or ($flags -band 1)){throw 'install lock handle is inheritable'}}finally{$h.Dispose()}
 }
}
Remove-Item Function:\Get-Acl
# Unlink the junction only. Never recursive-delete a tree until reparse paths are removed.
if(Test-Path -LiteralPath (Join-Path $root 'junction')){[IO.Directory]::Delete((Join-Path $root 'junction'))}
$results|ConvertTo-Json -Depth 10
""".replace('__SOURCE__',str(HERE)).replace('__ROOT__',str(cls.root))
  f=cls.root/'guards.ps1';f.write_text(script,encoding='utf-8')
  env=dict(os.environ,TEMP=str(cls.root),TMP=str(cls.root))
  r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,env=env,timeout=90)
  if r.returncode:raise RuntimeError(r.stdout+r.stderr)
  cls.results=json.loads(r.stdout)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def test_all_cases(self):
  for r in self.results:
   with self.subTest(r['name']):self.assertTrue(r['ok'],r)
  print('SECURITY_CASES',len(self.results))
if __name__=='__main__':unittest.main(verbosity=2)
