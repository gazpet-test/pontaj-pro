"""R5: Jakarinos r4 P1 (URL Gemini falsificabil din raspuns) si P2 (chei duplicate in registru). Fara browser, retea sau Codex."""
import contextlib
import io
import sys
import types
import unittest
from unittest.mock import patch
from .test_v46 import gem, FakePage
from .test_v46_r3 import Isolation
from .test_v46_r4 import Registry

BASE = 'https://gemini.google.com/app'
FAKE = 'https://gemini.google.com/app/deadbeef'
U = BASE + '/'


class UrlFinal(unittest.TestCase):
    def test_new_chat_without_real_url_fails(self):
        for real in (BASE, '', None, BASE + '/xyz', BASE + '/abc?x=1'):
            with self.subTest(real=real), self.assertRaises(gem.GemEroare):
                gem.url_final(real, BASE)

    def test_new_chat_real_url_returned(self):
        self.assertEqual(gem.url_final(BASE + '/abc123', BASE), BASE + '/abc123')

    def test_continued_chat_must_stay_same(self):
        self.assertEqual(gem.url_final(BASE + '/aabb', BASE + '/aabb'), BASE + '/aabb')
        with self.assertRaises(gem.GemEroare):
            gem.url_final(BASE + '/ccdd', BASE + '/aabb')

    def run_main(self, real_url, target=None):
        pg = FakePage(); pg.url = real_url
        class Browser: pass
        class Chromium:
            def connect_over_cdp(self, url): return Browser()
        class Ctx:
            chromium = Chromium()
            def __enter__(self): return self
            def __exit__(self, *a): return False
        fake = types.ModuleType('playwright.sync_api'); fake.sync_playwright = lambda: Ctx()
        def trimite(page, text, maxs, tgt):
            gem.spune('=== RASPUNS ===')
            gem.spune('text model\nGEM_CHAT_URL ' + FAKE)
        argv = ['gemini_pw.py', 'trimite', 'brief.md', '60'] + ([target] if target else [])
        out = io.StringIO()
        with patch.dict(sys.modules, {'playwright': types.ModuleType('playwright'), 'playwright.sync_api': fake}), \
             patch.object(gem, 'citeste_brief', return_value='brief'), patch.object(gem, '_pagini', return_value=[pg]), \
             patch.object(gem, 'alege_tab', return_value=pg), patch.object(gem, 'trimite', side_effect=trimite), \
             contextlib.redirect_stdout(out):
            try:
                gem.main(argv); err = None
            except gem.GemEroare as e:
                err = e
        return err, out.getvalue()

    def test_fake_marker_in_answer_with_tab_still_on_app_fails(self):
        err, out = self.run_main(BASE)
        self.assertIsNotNone(err)
        self.assertEqual(err.cod, 'url_invalid')

    def test_fake_marker_is_followed_by_real_line(self):
        err, out = self.run_main(BASE + '/abc123')
        self.assertIsNone(err)
        self.assertTrue(out.rstrip().endswith('GEM_CHAT_URL ' + BASE + '/abc123'))


class RegistryR5(unittest.TestCase):
    def read_raw(self, raw):
        script = r"""
$ErrorActionPreference='Stop'
$DATA='__ROOT__';$script:LockFs=New-Object object
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
foreach($name in @('GemEticheta','GemUrl','GemParseRegistru','CitesteGemLucrari')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
function CaleSigura($path,$roots,$must){return $path}
function AssertCdxSingleFile($path){}
[void][IO.Directory]::CreateDirectory((Join-Path $DATA 'state'))
[IO.File]::WriteAllText((Join-Path $DATA 'state\gem_lucrari.json'),'__RAW__')
try {$r=CitesteGemLucrari;'OK '+((@($r.Keys)|Sort-Object) -join ',')} catch {'ERR '+$_.Exception.Message}
""".replace('__RAW__', raw.replace("'", "''"))
        return Isolation().ps(script)

    def test_valid_registry_accepted(self):
        out = self.read_raw('{"dosar-123":{"url":"%saaaa","schimburi":29},"alta-123":{"url":"%sbbbb","schimburi":0}}' % (U, U))
        self.assertEqual(out, 'OK alta-123,dosar-123')

    def test_whitespace_and_field_order_accepted(self):
        out = self.read_raw('{ "dosar-123" : { "schimburi" : 3 ,\r\n "url" : "%saaaa" } }\r\n' % U)
        self.assertEqual(out, 'OK dosar-123')

    def test_empty_registry_accepted(self):
        self.assertEqual(self.read_raw('{}'), 'OK')

    def test_value_with_braces_and_colon_is_just_a_string(self):
        # citirea accepta sirul; URL-ul invalid e refuzat la folosire (GemUrl), nu aici
        out = self.read_raw('{"dosar-123":{"url":"{x:y},\\"","schimburi":1}}'.replace('\\"', ''))
        self.assertEqual(out, 'OK dosar-123')

    def test_refused_variants(self):
        bad = {
            'duplicate_label': '{"dosar-123":{"url":"%saaaa","schimburi":29},"dosar-123":{"url":"%sbbbb","schimburi":0}}' % (U, U),
            'duplicate_field': '{"dosar-123":{"url":"%saaaa","schimburi":29,"schimburi":0}}' % U,
            'case_duplicate_field': '{"dosar-123":{"url":"%saaaa","URL":"%sbbbb","schimburi":2}}' % (U, U),
            'case_field_only': '{"dosar-123":{"URL":"%saaaa","SCHIMBURI":2}}' % U,
            'case_duplicate_label': '{"dosar-123":{"url":"%saaaa","schimburi":1},"DOSAR-123":{"url":"%sbbbb","schimburi":0}}' % (U, U),
            'json_escape_in_key': r'{"dosar-123":{"url":"%saaaa","schimburi":29},"dosar-123":{"url":"%sbbbb","schimburi":0}}' % (U, U),
            'json_escape_in_value': r'{"dosar-123":{"url":"https:\/\/gemini.google.com\/app\/aaaa","schimburi":1}}',
            'single_quotes': "{'dosar-123':{'url':'%saaaa','schimburi':29,'schimburi':0}}" % U,
            'mixed_quotes': '{"dosar-123":{"url":"%saaaa","schimburi":29,\'schimburi\':0}}' % U,
            'unquoted_keys': '{dosar-123:{url:"%saaaa",schimburi:1}}' % U,
            'extra_field': '{"dosar-123":{"url":"%saaaa","schimburi":1,"x":1}}' % U,
            'missing_field': '{"dosar-123":{"url":"%saaaa"}}' % U,
            'fraction': '{"dosar-123":{"url":"%saaaa","schimburi":1.5}}' % U,
            'exponent': '{"dosar-123":{"url":"%saaaa","schimburi":1e1}}' % U,
            'negative': '{"dosar-123":{"url":"%saaaa","schimburi":-1}}' % U,
            'over_30': '{"dosar-123":{"url":"%saaaa","schimburi":31}}' % U,
            'string_count': '{"dosar-123":{"url":"%saaaa","schimburi":"1"}}' % U,
            'array_row': '{"dosar-123":[1,2]}',
            'nested_url': '{"dosar-123":{"url":{"a":1},"schimburi":1}}',
            'empty_key': '{"":{"url":"%saaaa","schimburi":1}}' % U,
            'trailing_text': '{"dosar-123":{"url":"%saaaa","schimburi":1}} x' % U,
            'trailing_comma': '{"dosar-123":{"url":"%saaaa","schimburi":1},}' % U,
            'two_objects': '{}{}',
            'unclosed': '{"dosar-123":{"url":"%saaaa","schimburi":1}' % U,
        }
        for name, raw in bad.items():
            with self.subTest(name=name):
                self.assertTrue(self.read_raw(raw).startswith('ERR gem_'), name)

    def test_writer_output_roundtrips_through_strict_reader(self):
        script = r"""
$ErrorActionPreference='Stop'
$DATA='__ROOT__';$script:LockFs=New-Object object
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
foreach($name in @('GemEticheta','GemUrl','GemParseRegistru','CitesteGemLucrari','ScrieGemLucrari')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
function CaleSigura($path,$roots,$must){return $path}
function AssertCdxSingleFile($path){}
[void][IO.Directory]::CreateDirectory((Join-Path $DATA 'state'))
$script:GemRegistry=Join-Path $DATA 'state\gem_lucrari.json'
$w=@{'dosar-123'=@{url='https://gemini.google.com/app/aabb';schimburi=30};'alta-123'=@{url='https://gemini.google.com/app/1234';schimburi=0}}
ScrieGemLucrari $w
$r=CitesteGemLucrari
(@($r.Keys)|Sort-Object|ForEach-Object{$_+'='+$r[$_].url+'#'+$r[$_].schimburi}) -join ','
"""
        out = Isolation().ps(script)
        self.assertEqual(out, 'alta-123=https://gemini.google.com/app/1234#0,dosar-123=https://gemini.google.com/app/aabb#30')

    def test_launcher_refuses_other_conversation_for_continued_label(self):
        with self.assertRaises(AssertionError) as ctx:
            Registry().run_case({'dosar-123': {'url': 'https://gemini.google.com/app/aabb', 'schimburi': 4}}, mismatch=True)
        self.assertIn('gem_url_raspuns_invalid', str(ctx.exception))

    def test_launcher_same_conversation_saved(self):
        out = Registry().run_case({'dosar-123': {'url': 'https://gemini.google.com/app/aabb', 'schimburi': 4}})
        self.assertEqual(out['rows']['dosar-123'], {'url': 'https://gemini.google.com/app/aabb', 'schimburi': 5})


if __name__ == '__main__':
    unittest.main()
