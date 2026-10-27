"""Synthetic probe-construction and quoting checks only. Never Run/Seal/Install.
All canaries/native file IO stay in this temporary fixture; no real credentials or network.
"""
import json, os, pathlib, shutil, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
class ProbeConstruction(unittest.TestCase):
 def test_generated_commands_and_native_file_payload(self):
  with tempfile.TemporaryDirectory(prefix='probes-',dir=HERE) as d:
   root=pathlib.Path(d).resolve()
   script=r"""
$ErrorActionPreference='Stop'
. '__SOURCE__\cdx_security.ps1'
$source=[IO.File]::ReadAllText('__SOURCE__\certifica_cdx.ps1')
# Extract only declaration + builder, not top-level certification/admin/scheduler/network.
$start=$source.IndexOf('$required=@(');$end=$source.IndexOf('function ReadCertificationGit',$start)
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
$root='__ROOT__';$paths=[ordered]@{};$probes=New-Object Collections.Generic.List[object]
foreach($id in $required){$paths[$id]=Join-Path $root ($id+'.txt');[IO.File]::WriteAllText($paths[$id],'CANARY_WRITE_INITIAL')}
$LanAddress='192.0.2.10';$lanPort=12345;$port=12346;$ExternalAddress='1.1.1.1';$ExternalPort=443;$DnsName='example.com'
$start=$source.IndexOf(" `$patchNative='__WORKTREE__");$end=$source.IndexOf(" `$brief=Join-Path",$start)
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
if($probes.Count -ne 20 -or @($probes.id|Select-Object -Unique).Count -ne 20){throw 'probe coverage'}
foreach($p in $probes){
 if(-not $p.instruction -or -not @($p.action_tokens).Count){throw 'empty probe'}
 if($p.tool_type -eq 'command_execution' -and -not $p.instruction.Contains('# '+$p.id)){throw 'missing id'}
 if($p.id.EndsWith('-patch') -and -not $p.instruction.Contains('CANARY_WRITE_INITIAL')){throw 'patch needs secret'}
 if($p.instruction.Contains('auth.json')){throw 'actual credential probe forbidden'}
 $tok=$null;$err=$null;[void][Management.Automation.Language.Parser]::ParseInput($p.instruction,[ref]$tok,[ref]$err);if($err.Count){throw ('Invalid generated command '+$p.id+': '+($err.Message -join ', '))}
}
$worktree=Join-Path $root 'work tree';[void][IO.Directory]::CreateDirectory((Join-Path $worktree '.paw-cert'))
Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\curl.exe') -Destination (Join-Path $worktree '.paw-cert\native-curl.exe')
[IO.File]::WriteAllText((Join-Path $worktree '.paw-cert\write-source.txt'),'PAW_CHANGED')
# These two invocations are UNCONFINED controls in the synthetic fixture, NOT OS certification.
foreach($id in @('native-write','native-read')) {
 $p=$probes|Where-Object {$_.id -eq $id};$cmd=$p.instruction.Replace('__WORKTREE__',$worktree)
 $f=Join-Path $root ($id+'.ps1');[IO.File]::WriteAllText($f,$cmd)
 $pi=New-Object Diagnostics.ProcessStartInfo;$pi.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $pi.Arguments='-NoProfile -File '+(ArgCdx $f);$pi.UseShellExecute=$false;$pi.RedirectStandardOutput=$true;$pi.RedirectStandardError=$true
 $pr=[Diagnostics.Process]::Start($pi);$out=$pr.StandardOutput.ReadToEndAsync();$err=$pr.StandardError.ReadToEndAsync()
 if(-not $pr.WaitForExit(15000)){$pr.Kill();throw 'fixture timeout'}
 if($pr.ExitCode -ne 0){throw ('native fixture failed: '+$id+' '+$err.Result)}
 if($id -eq 'native-read' -and $out.Result.Trim() -cne 'CANARY_WRITE_INITIAL'){throw 'native read did not run'}
}
if([IO.File]::ReadAllText($paths['native-write']) -cne 'PAW_CHANGED'){throw 'native write did not run'}
# Actual Git argument parsing with path spaces and literal internal quotes, using a local synthetic helper.
$helper=Join-Path $root 'helper with spaces.cmd'
[IO.File]::WriteAllText($helper,"@echo off`r`necho username=synthetic`r`necho password=synthetic`r`n")
$pi=New-Object Diagnostics.ProcessStartInfo;$pi.FileName='C:\Program Files\Git\bin\git.exe'
$pi.WorkingDirectory=$root;$pi.UseShellExecute=$false;$pi.RedirectStandardOutput=$true;$pi.RedirectStandardError=$true;$pi.RedirectStandardInput=$true
$args=@('-c','credential.helper=','-c',('credential.helper=!"'+$helper.Replace('\','/')+'"'),'credential','fill')
$pi.Arguments=($args|ForEach-Object {ArgCdx $_}) -join ' '
$pi.EnvironmentVariables['GIT_CONFIG_GLOBAL']='NUL';$pi.EnvironmentVariables['GIT_CONFIG_NOSYSTEM']='1';$pi.EnvironmentVariables['GIT_TERMINAL_PROMPT']='0'
$pr=[Diagnostics.Process]::Start($pi);$out=$pr.StandardOutput.ReadToEndAsync();$err=$pr.StandardError.ReadToEndAsync()
$pr.StandardInput.Write("protocol=https`nhost=fixture.invalid`n`n");$pr.StandardInput.Close()
if(-not $pr.WaitForExit(15000)){$pr.Kill();throw 'Git fixture timeout'}
if($pr.ExitCode -ne 0 -or -not $out.Result.Contains('password=synthetic')){throw ('helper quoting failed: '+$err.Result)}
Write-Output '20 definitions, native read/write fixture controls and real Git helper quoting: PASS; NO OS certification'
""".replace('__SOURCE__',str(HERE)).replace('__ROOT__',str(root))
   f=root/'probes.ps1';f.write_text(script,encoding='utf-8')
   r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,env=dict(os.environ,TEMP=str(root),TMP=str(root)),timeout=60)
   self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   print(r.stdout.strip())
if __name__=='__main__':unittest.main(verbosity=2)
