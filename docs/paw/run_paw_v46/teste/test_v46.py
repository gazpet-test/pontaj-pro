"""Pagina Gemini falsa si proces Python fals; fara Codex, CDP sau servicii reale."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('gem_v46', HERE / 'gemini_pw.py')
gem = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gem)
PS = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'


class FakePage:
    def __init__(self, model='Argon', ready=True, busy=False):
        self.events = []
        self.model = 'Argon'
        self.new_model = model
        self.ready = ready
        self.busy = busy
        self.text = ''
        self.keyboard = self

    def goto(self, url, **kwargs):
        self.events.append(('goto', url))
        self.model = self.new_model

    def locator(self, selector):
        page = self
        class Locator:
            @property
            def first(self): return self
            def count(self):
                if selector == gem.STOP: return int(page.busy)
                return int(selector in (gem.MODEL, gem.EDITOR))
            def inner_text(self):
                page.events.append(('read', selector))
                return page.model if selector == gem.MODEL else page.text
            def all_inner_texts(self): return []
            def locator(self, selector): return page.locator(selector)
            def wait_for(self, **kwargs):
                page.events.append(('ready', selector))
                if not page.ready: raise TimeoutError()
            def click(self): page.events.append(('click', selector))
        return Locator()

    def press(self, key): self.events.append(('press', key))
    def insert_text(self, text):
        self.text = text
        self.events.append(('insert', text))
    def wait_for_timeout(self, ms): pass


class Gemini(unittest.TestCase):
    def send(self, page):
        with patch.object(gem, 'asteapta_raspuns', return_value=('ok', True)), contextlib.redirect_stdout(io.StringIO()):
            gem.trimite(page, 'brief date', 60)

    def test_fiecare_apel_chat_nou_inainte_de_model_si_enter(self):
        page = FakePage()
        for _ in range(2):
            page.events = []
            self.send(page)
            events = page.events
            self.assertEqual([e for e in events if e[0] == 'goto'], [('goto', 'https://gemini.google.com/app')])
            self.assertLess(events.index(('goto', 'https://gemini.google.com/app')), events.index(('ready', gem.EDITOR)))
            self.assertLess(events.index(('ready', gem.EDITOR)), events.index(('read', gem.MODEL)))
            self.assertLess(events.index(('read', gem.MODEL)), events.index(('insert', 'brief date')))
            self.assertLess(events.index(('insert', 'brief date')), events.index(('press', 'Enter')))

    def test_model_schimbat_dupa_navigare_refuzat(self):
        page = FakePage(model='Fast')
        with self.assertRaises(gem.GemEroare) as caught: self.send(page)
        self.assertEqual(caught.exception.cod, 'model_gresit')
        self.assertNotIn(('press', 'Enter'), page.events)
        self.assertFalse(any(e[0] == 'insert' for e in page.events))

    def test_editor_nepregatit_refuzat(self):
        page = FakePage(ready=False)
        with self.assertRaises(gem.GemEroare) as caught: self.send(page)
        self.assertEqual(caught.exception.cod, 'editor_lipsa')
        self.assertNotIn(('press', 'Enter'), page.events)

    def test_ocupat_nu_navigheaza(self):
        page = FakePage(busy=True)
        with self.assertRaises(gem.GemEroare) as caught: self.send(page)
        self.assertEqual(caught.exception.cod, 'gemini_ocupat')
        self.assertEqual(page.events, [])

    def test_stare_nu_navigheaza(self):
        page = FakePage()
        with contextlib.redirect_stdout(io.StringIO()):
            page.url = 'https://gemini.google.com/app/old'
            gem.stare(page)
        self.assertFalse(any(e[0] == 'goto' for e in page.events))


class Jak(unittest.TestCase):
    def ps(self, text, root):
        script = root / 'test.ps1'
        script.write_text(text, encoding='ascii')
        result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                                capture_output=True, text=True, timeout=30, cwd=root,
                                env=dict(os.environ, TEMP=str(root), TMP=str(root)))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_config_generat_contract_toml(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            text = self.ps(". '" + str(HERE / 'jak.ps1') + "'\nGetJakConfig\n", root)
            config = tomllib.loads(text)
        self.assertNotIn('apps', config)
        self.assertNotIn('plugins', config)
        for feature in ('apps', 'plugins', 'remote_plugin', 'skill_mcp_dependency_install', 'hooks'):
            self.assertIs(config['features'][feature], False)
        self.assertEqual(set(config['mcp_servers']), {'firecrawl'})
        server = config['mcp_servers']['firecrawl']
        self.assertEqual(server['url'], 'https://mcp.firecrawl.dev/v2/mcp')
        self.assertEqual(server['bearer_token_env_var'], 'FIRECRAWL_API_KEY')
        self.assertEqual(server['enabled_tools'], ['firecrawl_search', 'firecrawl_scrape', 'firecrawl_map'])
        self.assertFalse(server['enabled'])
        self.assertEqual(config['projects'][r'C:\Users\Gazpet-Ai\gazpet-erp']['trust_level'], 'untrusted')

    def test_install_profil_acl_si_cheie_optional_fara_afisare(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            script = r'''
$ErrorActionPreference='Stop'
. '__SOURCE__\jak.ps1'
$root='__ROOT__';$script:aclRecords=@();$script:protected=@();$script:answer='';$script:prompts=0
function AssertCdxPath($path){return $path}
function AssertCdxAdminAcl($path){}
function AssertCdxSingleFile($path){if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'fixture file missing'}}
# Simulam numai aplicarea privilegiata a ACL; verificam descriptorul construit real.
function Set-Acl {param($LiteralPath,$AclObject) $script:aclRecords+=@{path=$LiteralPath;sddl=$AclObject.Sddl}}
function SetCdxAdminAcl($path,$sid){$script:protected+=@{path=$path;sid=$sid}}
function Read-Host {param($Prompt,[switch]$AsSecureString)
 $script:prompts++
 if($AsSecureString){return (ConvertTo-SecureString 'fc-SYNTHETIC46' -AsPlainText -Force)}
 return $script:answer
}
$reader='S-1-5-21-1-2-3-1001'
InitializeJakProfile $root $reader
$keyPath=Join-Path $root 'state\secrets\firecrawl_api_key'
if(Test-Path -LiteralPath $keyPath){throw 'optional key was created'}
if($script:prompts -ne 1){throw 'unexpected secret prompt'}
$script:answer='DA'
InitializeJakProfile $root $reader
if([IO.File]::ReadAllText($keyPath) -cne 'fc-SYNTHETIC46'){throw 'key not written'}
$script:answer=''
InitializeJakProfile $root $reader
if([IO.File]::ReadAllText($keyPath) -cne 'fc-SYNTHETIC46'){throw 'existing key lost'}
$config=[IO.File]::ReadAllText((Join-Path $root 'state\jak-home\config.toml'))
if($config -cne (GetJakConfig) -or $config.Contains('fc-SYNTHETIC46')){throw 'config contamination'}
if($script:aclRecords.Count -ne 1){throw 'existing home ACL reset'}
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetSecurityDescriptorSddlForm($script:aclRecords[0].sddl)
if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544'){throw 'ACL ownership/inheritance'}
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($rules.Count -ne 3){throw 'extra ACL'}
foreach($rule in $rules){
 $expected=if($rule.IdentityReference.Value -eq $reader){[Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::Synchronize}else{[Security.AccessControl.FileSystemRights]::FullControl}
 if($rule.FileSystemRights -ne $expected -or $rule.AccessControlType -ne 'Allow'){throw 'unexpected rights'}
}
$expectedKeyProtection=@($script:protected|Where-Object {$_.path -eq $keyPath -and $_.sid -eq $reader})
if($expectedKeyProtection.Count -lt 1){throw 'key ACL omitted'}
Write-Output 'PROFILE_PLAN_OK'
'''
            result = self.ps(script.replace('__SOURCE__', str(HERE)).replace('__ROOT__', str(root)), root)
        self.assertEqual(result.strip(), 'PROFILE_PLAN_OK')

    def test_proces_real_fals_cheie_prezenta_absenta_invalida_si_config_modificat(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory).resolve()
            (root / 'state/jak-home').mkdir(parents=True)
            (root / 'state/secrets').mkdir()
            # Valorile de test sunt sintetice. Copilul nu scrie cheia in capturi.
            stub = root / 'child.py'
            stub.write_text('''import os,sys,json
key=os.environ.get('FIRECRAWL_API_KEY')
expected='fc-SYNTHETIC46'
assert key in (None,expected)
assert os.environ.get('UNRELATED_SECRET') is None
assert os.environ['CODEX_HOME'].endswith('state\\\\jak-home')
assert expected not in ' '.join(sys.argv)
assert sys.stdin.read()=='brief via stdin'
print(json.dumps({'argv':sys.argv[1:],'home':os.environ['CODEX_HOME'],'key_present':key is not None}))
if key:
 print(key)
 print(key,file=sys.stderr)
''', encoding='ascii')
            script = r'''
$ErrorActionPreference='Stop'
$PAW_ROOT='__ROOT__';$script:OutFull=Join-Path $PAW_ROOT 'out.log'
. '__SOURCE__\cdx_security.ps1'
. '__SOURCE__\jak.ps1'
# Doar validarea ACL privilegiata este simulata pe fixture; parsarea caii ramane reala.
function AssertCdxAdminAcl([string]$path) {}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'syntax'}
foreach($name in @('Ruleaza','InchidePipe','LeagaCopiiiDeLansator')){
 $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
foreach($statement in $ast.EndBlock.Statements){
 if($statement.Extent.Text.StartsWith('Add-Type -Namespace PawV43 -Name Job')){Invoke-Expression $statement.Extent.Text}
}
$config=Join-Path $PAW_ROOT 'state\jak-home\config.toml'
[IO.File]::WriteAllText($config,(GetJakConfig))
$env:UNRELATED_SECRET='must-not-inherit'
$env:CODEX_HOME='wrong-home'
$env:FIRECRAWL_API_KEY='fc-WRONG-PARENT'
$keyPath=Join-Path $PAW_ROOT 'state\secrets\firecrawl_api_key'
$results=@()
foreach($present in @($true,$false)){
 if($present){[IO.File]::WriteAllText($keyPath,'fc-SYNTHETIC46')}
 else{Remove-Item -LiteralPath $keyPath}
 $argsJak=@('__CHILD__','exec','--skip-git-repo-check','--sandbox','read-only','-C',$PAW_ROOT,'-m','gpt-6-astra','--image=C:\fixture.png','-')
 $r=InvokeJak '__PYTHON__' $argsJak 'brief via stdin' $PAW_ROOT 1200
 if($r.exit -ne 0){throw ('child failed '+$r.err)}
 if(($r.out+$r.err).Contains('fc-SYNTHETIC46')){throw 'key leaked'}
 $results+=@{present=$present;result=$r}
}
if($env:CODEX_HOME -cne 'wrong-home' -or $env:FIRECRAWL_API_KEY -cne 'fc-WRONG-PARENT'){throw 'parent env modified'}
$rejected=0
[IO.File]::WriteAllText($keyPath,'invalid')
try{[void](InvokeJak '__PYTHON__' @('__CHILD__','-') 'brief via stdin' $PAW_ROOT 1200)}catch{if($_.Exception.Message -ne 'jak_firecrawl_cheie_invalida'){throw};$rejected++}
[IO.File]::AppendAllText($config,"`n[plugins.bad]`nenabled = true")
try{[void](InvokeJak '__PYTHON__' @('__CHILD__','-') 'brief via stdin' $PAW_ROOT 1200)}catch{if($_.Exception.Message -notlike 'jak_config_modificat*'){throw};$rejected++}
if($rejected -ne 2){throw 'guard missing'}
@{results=$results;log=[IO.File]::ReadAllText($script:OutFull)}|ConvertTo-Json -Depth 10 -Compress
'''
            for name, value in {'__ROOT__': str(root), '__SOURCE__': str(HERE), '__CHILD__': str(stub), '__PYTHON__': sys.executable}.items():
                script = script.replace(name, value)
            data = json.loads(self.ps(script, root))
        self.assertEqual(data['log'].strip(), 'FIRECRAWL: indisponibil')
        for case in data['results']:
            result = case['result']
            info = json.loads(result['out'].splitlines()[0])
            self.assertEqual(info['key_present'], case['present'])
            self.assertTrue(info['home'].endswith(r'state\jak-home'))
            self.assertEqual(info['argv'][-1], '-')
            self.assertIn('read-only', info['argv'])
            self.assertIn('mcp_servers.firecrawl.enabled=' + str(case['present']).lower(), info['argv'])
            for feature in ('apps', 'plugins', 'remote_plugin', 'skill_mcp_dependency_install', 'hooks'):
                self.assertIn('features.' + feature + '=false', info['argv'])
            self.assertIn('--image=C:\\fixture.png', info['argv'])
            self.assertNotIn('fc-SYNTHETIC46', result['out'] + result['err'])
            if case['present']: self.assertIn('[REDACTED]', result['err'])


if __name__ == '__main__': unittest.main(verbosity=2)
