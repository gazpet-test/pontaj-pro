"""Windows orchestration tests, no Codex inference, origin is a local bare repo.
The trusted stub is NOT an OS sandbox. A skipped containment test is intentional.
"""
import datetime,hashlib,json,os,pathlib,shutil,subprocess,sys,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
def git(cwd,*args):return subprocess.check_output(['git','-C',str(cwd),*args],stderr=subprocess.STDOUT,text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest().upper()
class Cdx(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='cdx-test-',dir=HERE);self.root=pathlib.Path(self.temp.name).resolve();assert self.root.is_relative_to(HERE)
  self.data=self.root/'data';self.bin=self.root/'bin';self.repo=self.root/'repo';self.origin=self.root/'origin.git'
  for p in (self.bin,self.data/'brief',self.data/'out'):p.mkdir(parents=True)
  subprocess.run(['git','init','--bare',str(self.origin)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  subprocess.run(['git','init','-b','main',str(self.repo)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  git(self.repo,'config','user.name','Stub');git(self.repo,'config','user.email','stub@example.invalid')
  (self.repo/'base.txt').write_text('base');git(self.repo,'add','.');git(self.repo,'commit','-m','base');git(self.repo,'remote','add','origin',str(self.origin));git(self.repo,'push','origin','main')
  self.env_before={k:os.environ.get(k) for k in ('TEMP','TMP')};os.environ.update(TEMP=str(self.root),TMP=str(self.root))
  self.base=git(self.repo,'rev-parse','HEAD');self.stub=self.bin/'stub.py'
  self.stub.write_text("import sys,pathlib,time,subprocess\nt=sys.stdin.read()\npathlib.Path('argv.json').write_text(__import__('json').dumps(sys.argv[1:]))\nif 'HANG' in t:\n p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']);pathlib.Path('child.pid').write_text(str(p.pid));time.sleep(120)\npathlib.Path('new.txt').write_text('changed')\n")
  (self.bin/'install.lock').write_text('test barrier')
  (self.bin/'no-hooks').mkdir()
  s=(HERE/'run_paw.ps1').read_text(encoding='utf-8-sig')
  s=s.replace(r'$DATA = "C:\Users\Public\paw-data"',f'$DATA = "{self.data}"').replace(r'$REPO = "C:\Users\Gazpet-Ai\gazpet-erp"',f'$REPO = "{self.repo}"')
  s=s.replace(r'$PAW_ROOT = "C:\ProgramData\Gazpet\Paw"',f'$PAW_ROOT = "{self.bin}"')
  s=s.replace(r'cdx = @{ exe = "C:\Program Files\nodejs\node.exe"; modele = @(); timeout = 1200 }',f'cdx = @{{ exe = "{sys.executable}"; modele = @(); timeout = 5 }}')
  # Only in these COPIED test sources: replace trust/ACL roots, runtime, origin and sandbox identity.
  # There is NO bypass option/environment switch in shipped production scripts.
  (self.bin/'run_paw.ps1').write_text(s,encoding='utf-8')
  security=(HERE/'cdx_security.ps1').read_text().replace("$value.Contains('\\') -or ", '')
  security=security.replace("$value -cne 'https://github.com/gazpet-test/pontaj-pro.git'",'$false')
  (self.bin/'cdx_security.ps1').write_text(security,encoding='utf-8')
  c=(HERE/'cdx.ps1').read_text().replace("'protocol.file.allow=never'","'protocol.file.allow=always'")
  c=c.replace("(Join-Path $runtime 'node.exe')", "'"+sys.executable+"'").replace("(Join-Path $runtime 'package\\bin\\codex.js')", "'"+str(self.stub)+"'")
  c=c.replace("if($sid -ne $CdxInstall.reader_sid)","if($false)").replace("if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))","if($false)")
  c+='\nfunction AssertCdxAdminAcl([string]$path) {}\nfunction GetCdxBinding { $script:CdxInstall=@{runtime_root=$PSScriptRoot;codex_home=(Join-Path $PSScriptRoot "home");reader_sid="TEST"}; return [ordered]@{fixture="not-OS-certification"} }\n'
  (self.bin/'cdx.ps1').write_text(c,encoding='utf-8')
  self.brief=self.data/'brief/test.md';self.brief.write_text('synthetic');self.out=self.data/'out/result.log';self.cert()
 def cert(self):
  (self.bin/'cdx_sandbox_validat.json').write_text(json.dumps({'schema':6,'network_denied':True,'dns_exception_accepted':False,'protocol':'cdx-probes-r5','certified_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expires_utc':None,'validity_policy':'until-deliberate-change','result':'PASS','probe_count':20,'evidence_sha256':'TEST','admin_review_sha256':'TEST','binding':{'fixture':'not-OS-certification'}}))
 def tearDown(self):
  for k,v in self.env_before.items():
   if v is None:os.environ.pop(k,None)
   else:os.environ[k]=v
  self.temp.cleanup()
 def run_launcher(self,slug='test',brief=None):
  return subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(self.bin/'run_paw.ps1'),'-Cine','cdx','-Brief',str(brief or self.brief),'-Out',str(self.out),'-Model',slug],capture_output=True,text=True,timeout=40,env=dict(os.environ))
 def test_invalid_slug(self):
  for slug in ('../escape','Upper','a'*41,'a/b','-bad'):
   r=self.run_launcher(slug);self.assertNotEqual(r.returncode,0);self.assertIn('cdx_slug_invalid',r.stdout)
 def test_path_outside(self):
  p=self.root/'outside.md';p.write_text('x');r=self.run_launcher(brief=p);self.assertNotEqual(r.returncode,0);self.assertFalse((self.data/'cdx').exists())
 def test_unverified_sandbox_refuses(self):
  (self.bin/'cdx_sandbox_validat.json').unlink();r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertFalse((self.data/'cdx').exists())
 def test_dns_exception_certificate_requires_explicit_reason(self):
  p=self.bin/'cdx_sandbox_validat.json';c=json.loads(p.read_text());c.pop('network_denied');c.update(network_denied_except_dns=True,dns_exception_accepted=True,dns_exception_reason='',scope='DNS exception');p.write_text(json.dumps(c))
  r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('cdx_dns_exception_invalid',r.stdout);self.assertFalse((self.data/'cdx').exists())
 def test_dns_exception_certificate_works_with_visible_scope(self):
  p=self.bin/'cdx_sandbox_validat.json';c=json.loads(p.read_text());c.pop('network_denied');c.update(network_denied_except_dns=True,dns_exception_accepted=True,dns_exception_reason='Explicit operator decision',scope='DNS exception; synthetic test only');p.write_text(json.dumps(c))
  r=self.run_launcher();self.assertEqual(r.returncode,0,r.stdout+r.stderr)
 def test_old_certificate_remains_usable(self):
  p=self.bin/'cdx_sandbox_validat.json';c=json.loads(p.read_text());c['certified_utc']='2010-01-01T00:00:00Z';c['windows_info']={'windows_build':'OLD','windows_ubr':1};p.write_text(json.dumps(c))
  r=self.run_launcher();self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  report=json.loads(next((self.data/'out').glob('*.json')).read_text(encoding='utf-8-sig'));self.assertIn('windows_info',report);self.assertIn('windows_build',report['windows_info']);self.assertNotEqual(report['windows_info'].get('windows_build'),'OLD')
 def test_legacy_certificate_refuses_before_worktree(self):
  p=self.bin/'cdx_sandbox_validat.json';c=json.loads(p.read_text());c['schema']=4;c.pop('validity_policy');c['expires_utc']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=23)).isoformat();p.write_text(json.dumps(c))
  r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertFalse((self.data/'cdx').exists());self.assertIn('cdx_sandbox_unverified',r.stdout)
 def test_worktree_commit_diff(self):
  r=self.run_launcher();self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  reports=list((self.data/'out').glob('*.json'));self.assertEqual(len(reports),1);s=json.loads(reports[0].read_text(encoding='utf-8-sig'));w=pathlib.Path(s['worktree'])
  self.assertEqual(s['base'],self.base);self.assertEqual(git(w,'rev-parse','HEAD^'),self.base);self.assertIn('new.txt',pathlib.Path(s['diff']).read_text());self.assertEqual(git(self.repo,'rev-parse','HEAD'),self.base)
  argv=json.loads((w/'argv.json').read_text());self.assertIn('workspace-write',argv);self.assertIn('sandbox_workspace_write.network_access=false',argv)
  self.assertFalse(any(x.startswith('--dangerously-') for x in argv));self.assertTrue(self.out.read_text(encoding='utf-8-sig').splitlines()[-1].startswith('PAW_GATA '))
 def test_timeout_tree(self):
  self.brief.write_text('HANG');r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('PAW_EROARE',self.out.read_text(encoding='utf-8-sig'))
  import ctypes
  pid=int(next((self.data/'cdx').glob('*/child.pid')).read_text());k=ctypes.windll.kernel32;h=k.OpenProcess(0x100000,False,pid)
  if h:
   try:self.assertNotEqual(k.WaitForSingleObject(h,0),0x102)
   finally:k.CloseHandle(h)
 def test_lock_busy(self):
  import time
  self.brief.write_text('HANG')
  cmd=['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(self.bin/'run_paw.ps1'),'-Cine','cdx','-Brief',str(self.brief),'-Out',str(self.data/'out/first.log'),'-Model','first']
  p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ))
  try:
   deadline=time.monotonic()+15
   while not list((self.data/'cdx').glob('*/child.pid')):
    if p.poll() is not None or time.monotonic()>deadline:self.fail('first launcher did not acquire lock')
    time.sleep(.03)
   r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('ocupat',r.stdout.lower())
  finally:p.communicate(timeout=40)
 def test_existing_target(self):
  p=self.bin/'run_paw.ps1';s=p.read_text();import re
  s=re.sub(r'^\$RUNID =.*$', '$RUNID = "fixed"', s,flags=re.M);p.write_text(s);self.cert()
  (self.data/'cdx/fixed-test').mkdir(parents=True)
  r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('cdx_target_exists',r.stdout)
 def test_fetch_failure(self):
  git(self.repo,'remote','set-url','origin',str(self.root/'absent'));r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('cdx_git_failed',r.stdout)
 def add_payload(self,payload):
  self.stub.write_text(self.stub.read_text()+'\n'+payload+'\n')
 def failed_report(self,r,reason):
  self.assertNotEqual(r.returncode,0,r.stdout+r.stderr)
  records=[json.loads(p.read_text(encoding='utf-8-sig')) for p in (self.data/'out').glob('*.json')]
  self.assertEqual(len(records),1);self.assertEqual(records[0]['status'],'failed');self.assertIn(reason,records[0]['reason'])
  self.assertTrue(pathlib.Path(records[0]['worktree']).is_dir());self.assertEqual(git(self.repo,'rev-parse','HEAD'),self.base)
 def test_secret_environment_removed(self):
  self.add_payload("import os\nassert 'GITHUB_TOKEN' not in os.environ and 'SUPABASE_KEY' not in os.environ and 'NODE_OPTIONS' not in os.environ\nassert os.environ['TEMP']==str(pathlib.Path.cwd()/'.tmp')\npathlib.Path('.tmp/private.txt').write_text('temporary')")
  old={k:os.environ.get(k) for k in ('GITHUB_TOKEN','SUPABASE_KEY','NODE_OPTIONS')}
  os.environ.update(GITHUB_TOKEN='SYNTHETIC',SUPABASE_KEY='SYNTHETIC',NODE_OPTIONS='SYNTHETIC')
  try:r=self.run_launcher();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertFalse(list((self.data/'cdx').glob('*/.tmp')))
  finally:
   for k,v in old.items():
    if v is None:os.environ.pop(k,None)
    else:os.environ[k]=v
 def test_child_git_metadata_tamper(self):
  self.add_payload("p=pathlib.Path('.git').read_text().strip().split('gitdir: ',1)[1]\n(pathlib.Path(p)/'HEAD').write_text('ref: refs/heads/evil')")
  self.failed_report(self.run_launcher(),'cdx_hash_set_mismatch')
 def test_child_filter_refused(self):
  self.add_payload("pathlib.Path('.gitattributes').write_text('* filter=evil')")
  self.failed_report(self.run_launcher(),'cdx_executable_attributes_refused')
 def test_child_nested_git_refused(self):
  self.add_payload("pathlib.Path('sub').mkdir()\npathlib.Path('sub/.git').write_text('gitdir: elsewhere')")
  self.failed_report(self.run_launcher(),'cdx_nested_git_refused')
 def test_child_hardlink_refused(self):
  self.add_payload("import os\nos.link('new.txt','linked.txt')")
  self.failed_report(self.run_launcher(),'cdx_hardlink_refused')
 def test_public_lock_hardlink_not_truncated(self):
  p=self.data/'other.txt';p.write_text('KEEP');os.link(p,self.data/'lock_cdx')
  r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('hardlink',r.stdout);self.assertEqual(p.read_text(),'KEEP')
 @unittest.skip('Requires independent OS sandbox certification; a same-user stub cannot prove write containment.')
 def test_outside_write_impossible(self):pass
if __name__=='__main__':unittest.main(verbosity=2)
