"""Only Prepare against COPIED fixtures. Never calls Install/Run/Seal or ProgramData."""
import hashlib,json,os,pathlib,shutil,subprocess,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
class Prepare(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='prepare-',dir=HERE);self.root=pathlib.Path(self.tmp.name).resolve();self.src=self.root/'source';self.src.mkdir()
  for n in ('install.ps1','cdx_security.ps1','cdx_wfp.ps1','cdx_wfp.cs','SHA256.json','run_paw.cmd','run_paw.ps1','cdx.ps1','certifica_cdx.ps1','gemini_pw.py'):shutil.copyfile(HERE/n,self.src/n)
  self.hash=hashlib.sha256((self.src/'SHA256.json').read_bytes()).hexdigest().upper();self.stage=self.root/'stage'
 def tearDown(self):self.tmp.cleanup()
 def run_prepare(self,manifest=None):
  return subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(self.src/'install.ps1'),'-Phase','Prepare','-Stage',str(self.stage),'-ManifestSha256',manifest or self.hash],capture_output=True,text=True,timeout=30,env=dict(os.environ,TEMP=str(self.root),TMP=str(self.root)))
 def test_prepare_copies_reviewed_bytes(self):
  r=self.run_prepare();self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  for n in json.loads((self.src/'SHA256.json').read_text()):self.assertEqual((self.src/n).read_bytes(),(self.stage/n).read_bytes())
  self.assertFalse((self.stage/'cdx_sandbox_validat.json').exists());self.assertFalse((self.stage/'cdx_install.json').exists())
 def test_wrong_manifest_refuses(self):
  r=self.run_prepare('0'*64);self.assertNotEqual(r.returncode,0);self.assertFalse(self.stage.exists())
 def test_tampered_wfp_refuses(self):
  with (self.src/'cdx_wfp.cs').open('a') as f:f.write('\n// tampered')
  r=self.run_prepare();self.assertNotEqual(r.returncode,0);self.assertFalse(self.stage.exists())
 def test_tampered_helper_refuses(self):
  with (self.src/'cdx.ps1').open('a') as f:f.write('\n# tampered')
  r=self.run_prepare();self.assertNotEqual(r.returncode,0);self.assertFalse(self.stage.exists())
 def test_existing_stage_refuses(self):
  self.stage.mkdir();(self.stage/'keep').write_text('keep');r=self.run_prepare();self.assertNotEqual(r.returncode,0);self.assertEqual((self.stage/'keep').read_text(),'keep')
if __name__=='__main__':unittest.main(verbosity=2)
