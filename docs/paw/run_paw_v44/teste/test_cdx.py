"""Windows orchestration tests, no Codex inference, origin is a local bare repo.
The trusted stub is NOT an OS sandbox. A skipped containment test is intentional.
"""
import hashlib,json,os,pathlib,shutil,subprocess,sys,tempfile,unittest
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
  self.base=git(self.repo,'rev-parse','HEAD');self.stub=self.bin/'stub.py'
  self.stub.write_text("import sys,pathlib,time,subprocess\nt=sys.stdin.read()\npathlib.Path('argv.json').write_text(__import__('json').dumps(sys.argv[1:]))\nif 'HANG' in t:\n p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']);pathlib.Path('child.pid').write_text(str(p.pid));time.sleep(120)\npathlib.Path('new.txt').write_text('changed')\n")
  s=(HERE/'run_paw.ps1').read_text(encoding='utf-8-sig')
  s=s.replace('$DATA = "C:\\Users\\Public\\paw-data"',f'$DATA = "{self.data}"').replace('$REPO = "C:\\Users\\Gazpet-Ai\\gazpet-erp"',f'$REPO = "{self.repo}"')
  s=s.replace('$CODEX_JS = "C:\\Users\\Gazpet-Ai\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"',f'$CODEX_JS = "{self.stub}"')
  s=s.replace('cdx = @{ exe = "C:\\Program Files\\nodejs\\node.exe"; modele = @(); timeout = 1200 }',f'cdx = @{{ exe = "{sys.executable}"; modele = @(); timeout = 3 }}')
  (self.bin/'run_paw.ps1').write_text(s,encoding='utf-8');shutil.copyfile(HERE/'cdx.ps1',self.bin/'cdx.ps1')
  self.brief=self.data/'brief/test.md';self.brief.write_text('synthetic');self.out=self.data/'out/result.log';self.cert()
 def cert(self):
  # TEST FIXTURE ONLY. This does not certify the real Codex sandbox.
  (self.data/'cdx_sandbox_validat.json').write_text(json.dumps({'launcher_sha256':sha(self.bin/'run_paw.ps1'),'helper_sha256':sha(self.bin/'cdx.ps1'),'codex_sha256':sha(self.stub),'outside_write_denied':True,'network_denied':True}))
 def tearDown(self):self.temp.cleanup()
 def run_launcher(self,slug='test',brief=None):
  return subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(self.bin/'run_paw.ps1'),'-Cine','cdx','-Brief',str(brief or self.brief),'-Out',str(self.out),'-Model',slug],capture_output=True,text=True,timeout=40)
 def test_invalid_slug(self):
  for slug in ('../escape','Upper','a'*41,'a/b','-bad'):
   r=self.run_launcher(slug);self.assertNotEqual(r.returncode,0);self.assertIn('cdx_slug_invalid',r.stdout)
 def test_path_outside(self):
  p=self.root/'outside.md';p.write_text('x');r=self.run_launcher(brief=p);self.assertNotEqual(r.returncode,0);self.assertFalse((self.data/'cdx').exists())
 def test_unverified_sandbox_refuses(self):
  (self.data/'cdx_sandbox_validat.json').unlink();r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertFalse((self.data/'cdx').exists())
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
  p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   deadline=time.monotonic()+15
   while not list((self.data/'cdx').glob('*/child.pid')):
    if p.poll() is not None or time.monotonic()>deadline:self.fail('first launcher did not acquire lock')
    time.sleep(.03)
   r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('ocupat',r.stdout.lower())
  finally:p.communicate(timeout=15)
 def test_existing_target(self):
  p=self.bin/'run_paw.ps1';s=p.read_text();import re
  s=re.sub(r'^\$RUNID =.*$', '$RUNID = "fixed"', s,flags=re.M);p.write_text(s);self.cert()
  (self.data/'cdx/fixed-test').mkdir(parents=True)
  r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('cdx_target_exists',r.stdout)
 def test_fetch_failure(self):
  git(self.repo,'remote','set-url','origin',str(self.root/'absent'));r=self.run_launcher();self.assertNotEqual(r.returncode,0);self.assertIn('cdx_git_failed',r.stdout)
 @unittest.skip('Requires independent OS sandbox certification; a same-user stub cannot prove write containment.')
 def test_outside_write_impossible(self):pass
if __name__=='__main__':unittest.main(verbosity=2)
