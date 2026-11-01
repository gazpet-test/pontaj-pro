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
foreach($name in @('GemEticheta','GemUrl','GemCheiUnice','CitesteGemLucrari')){
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
        out = self.read_raw('{"dosar-123":{"url":"https://gemini.google.com/app/aaaa","schimburi":29},"alta-123":{"url":"https://gemini.google.com/app/bbbb","schimburi":0}}')
        self.assertEqual(out, 'OK alta-123,dosar-123')

    def test_duplicate_label_refused(self):
        out = self.read_raw('{"dosar-123":{"url":"https://gemini.google.com/app/aaaa","schimburi":29},"dosar-123":{"url":"https://gemini.google.com/app/bbbb","schimburi":0}}')
        self.assertEqual(out, 'ERR gem_registru_invalid')

    def test_duplicate_field_refused(self):
        out = self.read_raw('{"dosar-123":{"url":"https://gemini.google.com/app/aaaa","schimburi":29,"schimburi":0}}')
        self.assertEqual(out, 'ERR gem_registru_invalid')

    def test_escaped_duplicate_label_refused(self):
        out = self.read_raw('{"dosar-123":{"url":"https://gemini.google.com/app/aaaa","schimburi":29},"dosar\u002d123":{"url":"https://gemini.google.com/app/bbbb","schimburi":0}}')
        self.assertEqual(out, 'ERR gem_registru_invalid')

    def test_extra_field_refused(self):
        out = self.read_raw('{"dosar-123":{"url":"https://gemini.google.com/app/aaaa","schimburi":1,"x":1}}')
        self.assertEqual(out, 'ERR gem_registru_invalid')

    def test_string_with_braces_and_colon_not_a_key(self):
        out = self.read_raw('{"dosar-123":{"url":"https://gemini.google.com/app/aaaa","schimburi":1}}')
        self.assertEqual(out, 'OK dosar-123')

    def test_launcher_refuses_other_conversation_for_continued_label(self):
        with self.assertRaises(AssertionError) as ctx:
            Registry().run_case({'dosar-123': {'url': 'https://gemini.google.com/app/aabb', 'schimburi': 4}}, mismatch=True)
        self.assertIn('gem_url_raspuns_invalid', str(ctx.exception))

    def test_launcher_same_conversation_saved(self):
        out = Registry().run_case({'dosar-123': {'url': 'https://gemini.google.com/app/aabb', 'schimburi': 4}})
        self.assertEqual(out['rows']['dosar-123'], {'url': 'https://gemini.google.com/app/aabb', 'schimburi': 5})


if __name__ == '__main__':
    unittest.main()
