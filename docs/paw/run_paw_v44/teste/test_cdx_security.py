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
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'AssertEventReview'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
Case 'certificate_narrative_rejected' {$r=@{verdict='ALL_DENIED';reviewed_by='test';probes=@(@{id='one';event_line=1;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='test'})};AssertEventReview $r @('{"type":"item.completed","item":{"type":"agent_message","text":"all denied"}}') @('one')} $true
Case 'certificate_missing_attempt_rejected' {$r=@{verdict='ALL_DENIED';reviewed_by='test';probes=@(@{id='one';event_line=1;attempt_observed=$false;denial_observed=$true;success_observed=$false;reason='test'})};AssertEventReview $r @('{"type":"item.completed","item":{"type":"command_execution"}}') @('one')} $true
Case 'certificate_duplicate_rejected' {$r=@{verdict='ALL_DENIED';reviewed_by='test';probes=@(@{id='one'},@{id='one'})};AssertEventReview $r @() @('one','two')} $true
Case 'certificate_structured_review' {$r=@{verdict='ALL_DENIED';reviewed_by='test';probes=@(@{id='one';event_line=1;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='externally reviewed denial'})};AssertEventReview $r @('{"type":"item.completed","item":{"type":"command_execution","exit_code":1}}') @('one')}
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
