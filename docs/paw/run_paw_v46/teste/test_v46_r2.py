"""Contract zero MCP r4. Synthetic CLI, real PowerShell pipes/job, no service."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
PS = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

class Mcp(unittest.TestCase):
    def case(self, mode, expected=None):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            home = root/'state/jak-home'; home.mkdir(parents=True)
            policy = root/'system'; policy.mkdir()
            if mode in ('home_rules','system_rules'):
                folder=(home if mode=='home_rules' else policy)/'rules';folder.mkdir()
                (folder/'allow.rules').write_text('untrusted policy')
            for kind, name in [('system_config','config.toml'),('system_requirements','requirements.toml'),('system_managed','managed_config.toml')]:
                if mode==kind:(policy/name).write_text('untrusted policy')
            if mode=='rules_not_directory':(policy/'rules').write_text('wrong type')
            if mode=='env':(home/'.env').write_text('SYNTHETIC=1')
            child=root/'cli.py'
            child.write_text(r'''
import json,os,sys
from pathlib import Path
mode=__MODE__
args=sys.argv[1:]
root=Path(__file__).parent
with (root/'calls.jsonl').open('a') as f:f.write(json.dumps({'argv':args,'home':os.environ['CODEX_HOME'],'stdin':None if 'app-server' in args else sys.stdin.read(),'clean':'UNRELATED_SECRET' not in os.environ})+'\n')
if 'app-server' in args:
 for line in sys.stdin:
  v=json.loads(line)
  if v.get('method')=='initialize':print(json.dumps({'id':1,'result':{}}),flush=True)
  if v.get('method')=='config/read':
   cfg={'notify':[],'hooks':{},'mcp_servers':{},'features':{n:False for n in ['apps','plugins','remote_plugin','hooks','skill_mcp_dependency_install']}}
   if mode=='notify':cfg['notify']=['untrusted.exe']
   if mode=='hooks':cfg['hooks']={'on_event':['untrusted.exe']}
   if mode=='config_mcp':cfg['mcp_servers']={'extra':{}}
   print(json.dumps({'id':2,'result':{'config':cfg}}),flush=True)
 sys.exit()
if 'features' in args:
 for n in ['apps','plugins','remote_plugin','hooks','skill_mcp_dependency_install']:
  if mode=='missing' and n=='apps':continue
  print(n+' experimental '+('true' if mode==n else 'false'))
 sys.exit()
if 'mcp' in args:
 if mode=='exit':sys.exit(9)
 if mode=='malformed':print('oops')
 elif mode=='null':print('null')
 elif mode in ['system','system_disabled','foreign_env_header']:print('[{"name":"extra","enabled":false}]')
 else:print('[]')
 sys.exit()
assert '--ephemeral' in args and '--ignore-rules' in args and args[-1]=='-'
print('EXEC_OK')
sys.exit(7 if mode=='exec_exit' else 0)
'''.replace('__MODE__',repr(mode)),encoding='ascii')
            script=root/'test.ps1'
            script.write_text(r'''
$ErrorActionPreference='Stop'
$PAW_ROOT='__ROOT__'
. '__SOURCE__\cdx_security.ps1'
. '__SOURCE__\jak.ps1'
function AssertCdxAdminAcl($path){}
function GetJakSystemPolicyRoots {return (Join-Path $PAW_ROOT 'system')}
$env:UNRELATED_SECRET='not-inherited'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($name in @('Ruleaza','InchidePipe','LeagaCopiiiDeLansator')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
foreach($statement in $ast.EndBlock.Statements){if($statement.Extent.Text.StartsWith('Add-Type -Namespace PawV43 -Name Job')){Invoke-Expression $statement.Extent.Text}}
[IO.File]::WriteAllText((Join-Path $PAW_ROOT 'state\jak-home\config.toml'),(GetJakConfig))
try {$r=InvokeJak '__PYTHON__' @('__CHILD__','exec','--sandbox','read-only','-C',$PAW_ROOT,'-') 'PRIVATE BRIEF' $PAW_ROOT 30;$out=@{result=$r}}
catch {$out=@{error=$_.Exception.Message}}
$out|ConvertTo-Json -Depth 8 -Compress
'''.replace('__ROOT__',str(root)).replace('__SOURCE__',str(HERE)).replace('__PYTHON__',sys.executable).replace('__CHILD__',str(child)),encoding='ascii')
            result=subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(script)],cwd=root,capture_output=True,text=True,timeout=50)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            data=json.loads(result.stdout)
            calls=[json.loads(l) for l in (root/'calls.jsonl').read_text().splitlines()] if (root/'calls.jsonl').exists() else []
            if expected:
                self.assertEqual(data.get('error'),expected,data)
                self.assertFalse(any('exec' in c['argv'] for c in calls))
            else:
                self.assertEqual(data['result']['exit'],7 if mode=='exec_exit' else 0,data)
                self.assertEqual(data['result']['out'].strip(),'EXEC_OK')
                self.assertEqual(len(calls),4)
                self.assertEqual(calls[-1]['stdin'],'PRIVATE BRIEF')
                for c in calls:
                    self.assertTrue(c['clean']);self.assertEqual(c['home'],str(home))
                    self.assertIn('notify=[]',c['argv'])

    def test_zero_mcp(self):self.case('clean')
    def test_any_mcp(self):self.case('system','jak_mcp_refuzat')
    def test_disabled_mcp(self):self.case('system_disabled','jak_mcp_refuzat')
    def test_effective_mcp(self):self.case('config_mcp','jak_config_efectiv_refuzat')
    def test_notify(self):self.case('notify','jak_config_efectiv_refuzat')
    def test_hooks(self):self.case('hooks','jak_config_efectiv_refuzat')
    def test_apps_cloud(self):self.case('apps','jak_features_active_sau_necunoscute')
    def test_plugins_cloud(self):self.case('plugins','jak_features_active_sau_necunoscute')
    def test_remote_cloud(self):self.case('remote_plugin','jak_features_active_sau_necunoscute')
    def test_unknown_feature(self):self.case('missing','jak_features_active_sau_necunoscute')
    def test_env(self):self.case('env','jak_env_refuzat')
    def test_mcp_error(self):self.case('exit','jak_mcp_refuzat')
    def test_malformed(self):self.case('malformed','jak_mcp_refuzat')
    def test_null(self):self.case('null','jak_mcp_refuzat')
    def test_exec_nonzero_preserved(self):self.case('exec_exit')

class Runbook(unittest.TestCase):
    def test_single_install_and_rollback_receipts(self):
        text=(HERE/'RUNBOOK_RAZVAN.md').read_text(encoding='ascii')
        for required in ('notify=[]','features list','GetJakRuntime','--ephemeral','--ignore-rules','CANAL_VALIDAT','gem-inchide'):
            self.assertIn(required,text)
        self.assertEqual(text.count('-Phase Prepare '),1)
        self.assertEqual(text.count('-Phase Install '),1)
