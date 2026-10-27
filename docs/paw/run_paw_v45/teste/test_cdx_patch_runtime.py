"""Opt-in standalone pinned apply-patch helper test, NOT codex exec/OS certification.
Usage: python -I test_cdx_patch_runtime.py <absolute installed codex.exe>
Only synthetic fixture writes; CODEX_HOME/TEMP isolated; no model/auth/network.
"""
import hashlib,json,os,pathlib,shutil,subprocess,sys,tempfile
HERE=pathlib.Path(__file__).resolve().parents[1]
if __name__=='__main__':
 binary=pathlib.Path(sys.argv[1]).resolve(strict=True)
 with tempfile.TemporaryDirectory(prefix='patch-engine-',dir=HERE) as d:
  root=pathlib.Path(d);work=root/'work tree';(work/'.paw-cert').mkdir(parents=True)
  copied=work/'.paw-cert/native-patch.exe';shutil.copyfile(binary,copied)
  assert hashlib.sha256(copied.read_bytes()).digest()==hashlib.sha256(binary.read_bytes()).digest()
  script=r'''
$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText('__SOURCE__\certifica_cdx.ps1')
$start=$source.IndexOf('$required=@(');$end=$source.IndexOf('function ReadCertificationGit',$start)
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
$root='__ROOT__';$worktree='__WORK__';$paths=[ordered]@{};$probes=New-Object Collections.Generic.List[object]
foreach($id in $required){$paths[$id]=Join-Path $root ($id+'.txt');[IO.File]::WriteAllText($paths[$id],'CANARY_WRITE_INITIAL')}
$LanAddress='192.0.2.10';$lanPort=12345;$port=12346;$ExternalAddress='1.1.1.1';$ExternalPort=443;$DnsName='example.com'
$start=$source.IndexOf(" `$patchNative='__WORKTREE__");$end=$source.IndexOf(" `$brief=Join-Path",$start)
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
foreach($id in @('paw-patch','profile-patch','git-patch','profile-read-cmd','auth-read-cmd')){
 $p=$probes|Where-Object {$_.id -eq $id};$cmd=$p.instruction.Replace('__WORKTREE__',$worktree)
 $f=Join-Path $root ($id+'.ps1');[IO.File]::WriteAllText($f,$cmd)
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f | Out-Null
 if($LASTEXITCODE -ne 0){throw ('Generated command failed: '+$id)}
 if($id.EndsWith('-patch') -and [IO.File]::ReadAllText($paths[$id]).TrimEnd("`r","`n") -cne 'PAW_CHANGED'){throw 'Patch did not update'}
}
Write-Output '3 generated patch commands + 2 generated cmd type commands PASS (unconfined synthetic controls only)'
'''.replace('__SOURCE__',str(HERE)).replace('__ROOT__',str(root)).replace('__WORK__',str(work))
  scriptpath=root/'fixture.ps1';scriptpath.write_text(script,encoding='utf8')
  env={k:v for k,v in os.environ.items() if k.upper() in ('SYSTEMROOT','WINDIR','PATH')}
  env.update(PATHEXT='.COM;.EXE;.BAT;.CMD',TEMP=str(root),TMP=str(root),CODEX_HOME=str(root/'empty-home'))
  r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(scriptpath)],env=env,cwd=root,capture_output=True,text=True,timeout=60)
  print(r.stdout);print(r.stderr)
  if r.returncode:raise SystemExit(r.returncode)
  print('PINNED_BINARY_SHA256',hashlib.sha256(binary.read_bytes()).hexdigest())
