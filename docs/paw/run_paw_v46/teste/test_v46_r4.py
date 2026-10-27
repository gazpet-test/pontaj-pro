"""R4 state/navigation tests. No real launcher, browser, network or Codex."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from .test_v46 import gem, FakePage
from .test_v46_r3 import Isolation
from .test_v46_r2 import HERE

spec=importlib.util.spec_from_file_location('jak_probe',HERE/'jak_config_probe.py')
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)

class Config(unittest.TestCase):
    def test_effective_config_shapes(self):
        good={'notify':[],'hooks':{},'mcp_servers':{},'features':{n:False for n in ('apps','plugins','remote_plugin','hooks','skill_mcp_dependency_install')}}
        probe.validate(good)
        for key, value in [('notify',None),('notify',['cmd']),('hooks',{'event':['cmd']}),('mcp_servers',{'codex_apps':{}}),('features',{'apps':True})]:
            bad=copy.deepcopy(good);bad[key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):probe.validate(bad)

    def test_no_removed_integration_in_runtime_code(self):
        forbidden=['fire'+'crawl','bearer_token_env_var','Read-Host','REDACTED']
        for name in ('jak.ps1','jak_config_probe.py'):
            text=(HERE/name).read_text().lower()
            for needle in forbidden:self.assertNotIn(needle.lower(),text)
        self.assertNotIn('fire'+'crawl',(HERE/'install.ps1').read_text().lower())
        self.assertNotIn('web_search =',(HERE/'jak.ps1').read_text())

class Navigation(unittest.TestCase):
    def test_saved_url_and_model_after_navigation(self):
        pg=FakePage();pg.url='https://gemini.google.com/app/abc123'
        with patch.object(gem,'asteapta_raspuns',return_value=('ok',True)),contextlib.redirect_stdout(io.StringIO()):
            gem.trimite(pg,'data',60,pg.url)
        self.assertEqual(pg.events[0],('goto',pg.url))
        self.assertLess(pg.events.index(('goto',pg.url)),pg.events.index(('read',gem.MODEL)))

    def test_bad_urls_never_navigate(self):
        for value in ('https://evil/app/abc','https://gemini.google.com/app/abc?x=1','https://gemini.google.com/app/not-hex','https://gemini.google.com/app/abc\n'):
            pg=FakePage()
            with self.subTest(value=value),self.assertRaises(gem.GemEroare):gem.trimite(pg,'data',60,value)
            self.assertEqual(pg.events,[])

class Registry(unittest.TestCase):
    def run_case(self, initial, label='dosar-123', close=False, failed=False):
        source=(HERE/'run_paw.ps1').read_text()
        begin=source.index('    "gem-inchide" {' if close else '    "gem" {',source.index('# --- rulare ---'))
        end=source.index('    "gem" {',begin) if close else source.index('\n  }\n  if ($rez',begin)
        body=source[begin:end].split('{',1)[1].rsplit('}',1)[0]
        script=r'''
$ErrorActionPreference='Stop'
$DATA='__ROOT__';$script:LockFs=New-Object object
$script:OutFull=Join-Path $DATA 'out.log'
$script:GemLabel='__LABEL__';$script:events=@()
$T=@{exe='fake';timeout=120};$BriefFull='fake.md';$GEMPW='fake.py'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
foreach($name in @('GemEticheta','GemUrl','CitesteGemLucrari','ScrieGemLucrari')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
function CaleSigura($path,$roots,$must){return $path}
function AssertCdxSingleFile($path){}
function LeagaCopiiiDeLansator{}
function LuaLock($path){$script:LockFs=New-Object object}
function AsteaptaFaraDriverRamas{}
function netstat.exe {return '127.0.0.1:9333 LISTENING'}
function Ruleaza($exe,$argv){
 $script:events+=,@($argv)
 return @{out="answer`nGEM_CHAT_URL https://gemini.google.com/app/abc123`n";err='';exit=0;timeout=$false}
}
[void][IO.Directory]::CreateDirectory((Join-Path $DATA 'state'))
[IO.File]::WriteAllText((Join-Path $DATA 'state\gem_lucrari.json'),'__INITIAL__')
__BODY__
@{events=$script:events;rows=(Get-Content (Join-Path $DATA 'state\gem_lucrari.json') -Raw|ConvertFrom-Json);log=$(if(Test-Path $script:OutFull){[IO.File]::ReadAllText($script:OutFull)}else{''})}|ConvertTo-Json -Depth 10 -Compress
'''.replace('__LABEL__',label or '').replace('__INITIAL__',json.dumps(initial)).replace('__BODY__',body)
        if failed:
            script=script.replace("err='';exit=0;timeout=$false","err='';exit=3;timeout=$false")
        return json.loads(Isolation().ps(script))

    def test_new_label_saved_after_response(self):
        out=self.run_case({})
        self.assertEqual(out['events'][0][-1],'https://gemini.google.com/app')
        self.assertEqual(out['rows']['dosar-123'],{'url':'https://gemini.google.com/app/abc123','schimburi':1})

    def test_existing_label_reused(self):
        out=self.run_case({'dosar-123':{'url':'https://gemini.google.com/app/aabb','schimburi':4}})
        self.assertEqual(out['events'][0][-1],'https://gemini.google.com/app/aabb')
        self.assertEqual(out['rows']['dosar-123']['schimburi'],5)

    def test_rotation_at_30(self):
        out=self.run_case({'dosar-123':{'url':'https://gemini.google.com/app/aabb','schimburi':30}})
        self.assertEqual(out['events'][0][-1],'https://gemini.google.com/app')
        self.assertEqual(out['rows']['dosar-123']['schimburi'],1)

    def test_invalid_url_refused_and_new_chat(self):
        out=self.run_case({'dosar-123':{'url':'https://evil.invalid/app/abc','schimburi':1}})
        self.assertEqual(out['events'][0][-1],'https://gemini.google.com/app')
        self.assertIn('GEM_REGISTRU_REFUZAT',out['log'])

    def test_no_label_fresh_and_no_save(self):
        out=self.run_case({},label=None)
        self.assertEqual(out['events'][0][-1],'https://gemini.google.com/app')
        self.assertEqual(out['rows'],{})

    def test_close_removes_only_requested_label_without_browser(self):
        out=self.run_case({'dosar-123':{'url':'https://gemini.google.com/app/abcd','schimburi':3},'alta-123':{'url':'https://gemini.google.com/app/1234','schimburi':1}},close=True)
        self.assertEqual(set(out['rows']),{'alta-123'})
        self.assertEqual(out['events'],[])

    def test_partial_response_retires_context(self):
        out=self.run_case({'dosar-123':{'url':'https://gemini.google.com/app/aabb','schimburi':4}},failed=True)
        self.assertEqual(out['rows'],{})

    def test_label_parity_python_powershell(self):
        spec=importlib.util.spec_from_file_location('juridic_parity',HERE.parent/'paw_juridic/server.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        cases=[('abc',True),('dosar-123',True),('0--',True),('a'*40,True),('ab',False),('Aaa',False),('abc\n',False),('abc:xx',False),('a'*41,False)]
        for value, expected in cases:
            try:mod.eticheta_valida(value);actual=True
            except mod.Refuz:actual=False
            self.assertEqual(actual,expected)
        # PowerShell case table includes exact newline and length boundaries.
        out=Isolation().ps(r'''
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'GemEticheta'},$true)
Invoke-Expression $fn.Extent.Text
$values=@('abc','dosar-123','0--',('a'*40),'ab','Aaa',"abc`n",'abc:xx',('a'*41))
$result=@(foreach($v in $values){try{[void](GemEticheta $v);$true}catch{$false}})
ConvertTo-Json -InputObject $result -Compress
''')
        self.assertEqual(json.loads(out),[expected for _,expected in cases])

    def test_label_validation(self):
        out=Isolation().ps(r'''
. '__SOURCE__\jak.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'GemEticheta'},$true)
Invoke-Expression $fn.Extent.Text
foreach($value in @('ab','Abc','abc:xx','abc/xx',"abc`n",('a'*41))){try{[void](GemEticheta $value);throw 'accepted'}catch{if($_.Exception.Message -ne 'gem_eticheta_invalida'){throw}}}
GemEticheta 'dosar-123'
''')
        self.assertEqual(out,'dosar-123')
