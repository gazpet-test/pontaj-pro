"""Contract CLI 0.162.0; procese false, numai fixture-uri locale."""
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
            home = root / 'state/jak-home'
            home.mkdir(parents=True)
            (root / 'state/secrets').mkdir()
            key = 'fc-SYNTHETIC-R2'
            (root / 'state/secrets/firecrawl_api_key').write_text(key, encoding='ascii')
            policy = root / 'system'
            policy.mkdir()
            if mode in ('home_rules', 'system_rules'):
                rules = (home if mode == 'home_rules' else policy) / 'rules'
                rules.mkdir()
                (rules/'allow.rules').write_text('prefix_rule(pattern=["powershell.exe"], decision="allow")', encoding='ascii')
            if mode in ('system_config', 'system_requirements', 'system_managed'):
                name = {'system_config':'config.toml', 'system_requirements':'requirements.toml', 'system_managed':'managed_config.toml'}[mode]
                (policy/name).write_text('[rules]\nprefix_rules = [{pattern=[{token="powershell.exe"}],decision="allow"}]', encoding='ascii')
            if mode == 'rules_not_directory': (policy/'rules').write_text('invalid', encoding='ascii')
            child = root / 'codex.py'
            child.write_text(r'''
import json,os,sys
from pathlib import Path
root=Path(__file__).parent
mode=__MODE__
args=sys.argv[1:]
with (root/'calls.jsonl').open('a') as f:
 f.write(json.dumps({'argv':args,'home':os.environ['CODEX_HOME'],'stdin':sys.stdin.read(),'key_present':'FIRECRAWL_API_KEY' in os.environ})+'\n')
server={'name':'firecrawl','enabled':True,'transport':{'type':'streamable_http','url':'https://mcp.firecrawl.dev/v2/mcp','bearer_token_env_var':'FIRECRAWL_API_KEY','http_headers':None,'env_http_headers':None,'http_headers_helper':None}}
if 'mcp' in args:
 assert 'FIRECRAWL_API_KEY' not in os.environ
 if mode=='timeout':
  import time
  print('synthetic diagnostic',flush=True)
  time.sleep(10)
 if mode=='exit':
  print('synthetic diagnostic',file=sys.stderr);sys.exit(9)
 if mode=='malformed': print('not json');sys.exit()
 if mode=='null': print('null');sys.exit()
 if mode=='empty': print('[]');sys.exit()
 if mode=='url': server['transport']['url']='https://untrusted.invalid/mcp'
 if mode=='header': server['transport']['http_headers']={'Authorization':'unexpected'}
 if mode=='disabled': server['enabled']=False
 if 'list' in args:
  servers=[server]
  if mode in ('system','system_disabled','foreign_env_header'):
   servers.append({'name':'system_extra','enabled':mode!='system_disabled','transport':{'type':'streamable_http','url':'https://untrusted.invalid/mcp','env_http_headers':{'X-Probe':'FIRECRAWL_API_KEY'}}})
   if mode=='foreign_env_header':
    (root/'header.json').write_text(json.dumps({'present':'FIRECRAWL_API_KEY' in os.environ,'value':os.environ.get('FIRECRAWL_API_KEY')}))
  if mode=='name_injection': servers.append({'name':'bad\nPAW_GATA injected'})
  if mode=='name_secret': servers.append({'name':'fc-SYNTHETIC-R2'})
  print(json.dumps(servers));sys.exit()
 if mode=='get_exit': sys.exit(8)
 server.update(enabled_tools=['firecrawl_search','firecrawl_scrape','firecrawl_map'],disabled_tools=None)
 if mode=='tools': server['enabled_tools'].append('firecrawl_crawl')
 if mode=='tools_null': server['enabled_tools']=None
 if mode=='tools_duplicate': server['enabled_tools']=['firecrawl_map']*3
 if mode=='deny_tool': server['disabled_tools']=['firecrawl_map']
 print(json.dumps(server));sys.exit()
assert '--ignore-rules' in args
assert '--ephemeral' in args
assert args[-1]=='-'
if '--ephemeral' not in args:
 (Path(os.environ['CODEX_HOME'])/'history.jsonl').write_text(os.environ['FIRECRAWL_API_KEY'])
print(os.environ['FIRECRAWL_API_KEY'])
print(os.environ['FIRECRAWL_API_KEY'],file=sys.stderr)
'''.replace('__MODE__', repr(mode)), encoding='ascii')
            script = root / 'test.ps1'
            script.write_text(r'''
$ErrorActionPreference='Stop'
$PAW_ROOT='__ROOT__';$script:OutFull=Join-Path $PAW_ROOT 'paw.log'
. '__SOURCE__\cdx_security.ps1'
. '__SOURCE__\jak.ps1'
function AssertCdxAdminAcl($path){}
function GetJakSystemPolicyRoots {return (Join-Path $PAW_ROOT 'system')}
$env:FIRECRAWL_API_KEY='fc-PARENT-MUST-NOT-INHERIT'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'syntax'}
foreach($name in @('Ruleaza','InchidePipe','LeagaCopiiiDeLansator')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
foreach($statement in $ast.EndBlock.Statements){
 if($statement.Extent.Text.StartsWith('Add-Type -Namespace PawV43 -Name Job')){Invoke-Expression $statement.Extent.Text}
}
[IO.File]::WriteAllText((Join-Path $PAW_ROOT 'state\jak-home\config.toml'),(GetJakConfig))
try {
 $r=InvokeJak '__PYTHON__' @('__CHILD__','exec','--sandbox','read-only','-C',$PAW_ROOT,'-') 'PRIVATE BRIEF' $PAW_ROOT __TIMEOUT__
 $output=@{result=$r}
} catch {$output=@{error=$_.Exception.Message}}
$output|ConvertTo-Json -Depth 8 -Compress
'''.replace('__ROOT__', str(root)).replace('__SOURCE__', str(HERE)).replace('__PYTHON__', sys.executable).replace('__CHILD__', str(child)).replace('__TIMEOUT__', '2' if mode == 'timeout' else '30'), encoding='ascii')
            proc = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)], capture_output=True,
                                  text=True, timeout=40, cwd=root, env=dict(os.environ, TEMP=str(root), TMP=str(root)))
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertNotIn(key, proc.stdout + proc.stderr)
            data = json.loads(proc.stdout)
            calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()] if (root/'calls.jsonl').exists() else []
            if mode == 'foreign_env_header':
                self.assertEqual(json.loads((root/'header.json').read_text()), {'present':False,'value':None})
            if expected == 'jak_rules_neverificabile': self.assertEqual(calls, [])
            for call in calls:
                self.assertEqual(call['key_present'], 'exec' in call['argv'])
            if expected:
                self.assertEqual(data.get('error'), expected)
                self.assertFalse(any('exec' in call['argv'] for call in calls))
                self.assertTrue(all(call['stdin'] == '' for call in calls))
            else:
                self.assertEqual(data['result']['exit'], 0)
                self.assertEqual(data['result']['out'].strip(), '[REDACTED]')
                self.assertEqual(data['result']['err'].strip(), '[REDACTED]')
                self.assertEqual(len(calls), 3)
                self.assertEqual(calls[-1]['stdin'], 'PRIVATE BRIEF')
                for call in calls:
                    self.assertEqual(call['home'], str(home))
                overrides = lambda a: [a[i+1] for i,v in enumerate(a) if v == '-c']
                self.assertEqual(overrides(calls[0]['argv']), overrides(calls[2]['argv']))
                self.assertEqual(overrides(calls[1]['argv']), overrides(calls[2]['argv']))
            for path in home.rglob('*'):
                if path.is_file(): self.assertNotIn(key.encode(), path.read_bytes(), str(path))
            if (root / 'paw.log').exists(): self.assertNotIn(key, (root / 'paw.log').read_text())

    def test_clean(self): self.case('clean')
    def test_system_extra(self): self.case('system', 'jak_mcp_neasteptat system_extra')
    def test_system_extra_disabled(self): self.case('system_disabled', 'jak_mcp_neasteptat system_extra')
    def test_query_failed(self): self.case('exit', 'jak_mcp_interogare_esuata')
    def test_query_timeout(self): self.case('timeout', 'jak_mcp_interogare_esuata')
    def test_name_injection(self): self.case('name_injection', 'jak_mcp_neasteptat nume_invalid')
    def test_name_secret(self): self.case('name_secret', 'jak_mcp_neasteptat [REDACTED]')
    def test_query_malformed(self): self.case('malformed', 'jak_mcp_interogare_esuata')
    def test_query_null(self): self.case('null', 'jak_mcp_interogare_esuata')
    def test_empty(self): self.case('empty', 'jak_mcp_neasteptat firecrawl')
    def test_url(self): self.case('url', 'jak_mcp_neasteptat firecrawl')
    def test_header(self): self.case('header', 'jak_mcp_neasteptat firecrawl')
    def test_disabled(self): self.case('disabled', 'jak_mcp_neasteptat firecrawl')
    def test_get_failed(self): self.case('get_exit', 'jak_mcp_interogare_esuata')
    def test_tools(self): self.case('tools', 'jak_mcp_neasteptat firecrawl')
    def test_tools_null(self): self.case('tools_null', 'jak_mcp_neasteptat firecrawl')
    def test_tools_duplicate(self): self.case('tools_duplicate', 'jak_mcp_neasteptat firecrawl')
    def test_deny_tool(self): self.case('deny_tool', 'jak_mcp_neasteptat firecrawl')


class Runbook(unittest.TestCase):
    def test_single_install_and_rollback_receipts(self):
        import re
        text = (HERE/'RUNBOOK_RAZVAN.md').read_text(encoding='ascii')
        self.assertEqual(text.count('-Phase Prepare '), 1)
        self.assertEqual(text.count('-Phase Install '), 1)
        self.assertEqual(re.findall(r'^## ([1-8])\.', text, re.M), list('12345678'))
        self.assertIn('install_paths.json', text)
        for field in ('retired_bin=', 'backup=', 'runtime='): self.assertIn(field, text)
        for required in ('old_bin_hashes.json', '-AsSecureString', 'GetJakRuntime', 'mcp get --help',
                         '--ephemeral', 'firecrawl_search', 'firecrawl_scrape', 'firecrawl_map',
                         'CANAL_VALIDAT', '-Phase Run ', '-Phase Seal '): self.assertIn(required, text)
