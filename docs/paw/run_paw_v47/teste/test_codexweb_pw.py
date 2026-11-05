"""Offline contract tests. No browser, credentials, network or real launcher."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import codexweb_pw as c

URL = 'https://chatgpt.com/codex/tasks/task_0123456789abcdef0123456789abcdef'
ROOT = r'C:\Users\Public\paw-data\brief'


class Pure(unittest.TestCase):
    def test_args_valid(self):
        self.assertEqual(c.arguments(['cxw', ROOT + r'\a.txt', 'pontaj-pro', '2400']), ('cxw', ROOT + r'\a.txt', 'pontaj-pro', 2400))
        self.assertEqual(c.arguments(['cxw-continua', 'brief', URL, '60'])[2:], (URL, 60))
        self.assertEqual(c.arguments(['cxw', 'brief', 'pontaj-pro', '86400'])[-1], 86400)

    def test_args_rejected(self):
        cases = [[], ['cxw', 'a', 'pontaj-pro'], ['cxw', 'a', 'pontaj-pro', '2400', 'extra'], ['CXW', 'a', 'pontaj-pro', '60']]
        cases += [['cxw', 'a', t, '60'] for t in ('', 'Pontaj-pro', 'pontaj-pro ', 'other', 'pontaj-pro\n')]
        cases += [['cxw', 'a', 'pontaj-pro', t] for t in ('0', '59', '86401', '-1', 'nan', '1e3', '60\n', ' 60', '060')]
        for args in cases:
            with self.subTest(args=args), self.assertRaises(c.Refuz):
                c.arguments(args)

    def test_url_closed(self):
        self.assertEqual(c.chat_url(URL), URL)
        for value in (URL+'\n', URL+'/', URL+'?x=1', URL+'#a', URL.replace('https:', 'http:'), URL.replace('chatgpt.com', 'chatgpt.com.evil'), URL.replace('chatgpt.com', 'user@chatgpt.com'), URL.replace('chatgpt.com', 'chatgpt.com:443'), URL.replace('/codex/tasks/', '/c/'), URL.replace('task_', 'task_%'), 'https://chatgpt.com/codex', URL.upper()):
            with self.subTest(value=value), self.assertRaises(c.Refuz):
                c.chat_url(value)

    def test_paths_legitimate(self):
        self.assertEqual(c.path_lexical(ROOT+r'\sub\..\brief.txt', ROOT, ('.txt','.md')), ROOT+r'\brief.txt')
        self.assertEqual(c.path_lexical(ROOT.upper()+r'\a.MD', ROOT, ('.txt','.md')), ROOT.upper()+r'\a.MD')
        out = r'C:\Users\Public\paw-data\out'
        self.assertEqual(c.path_lexical(out+r'\a.log', out, ('.log',)), out+r'\a.log')

    def test_paths_escape(self):
        for value in ('a.txt', r'\a.txt', r'C:brief.txt', r'\\server\share\brief.txt', '//server/share/a.txt', ROOT+r'\..\out\x.txt', ROOT+'-evil\\a.txt', ROOT+r'\a.txt:ads', ROOT+'\\a.txt\n', ROOT+r'\a.exe', r'C:\Users\Public\erp_review\a.txt', r'\\?\C:\Users\Public\paw-data\brief\a.txt'):
            with self.subTest(value=value), self.assertRaises(c.Refuz):
                c.path_lexical(value, ROOT, ('.txt','.md'))

    def test_reparse_ancestor(self):
        class Attr:
            st_mode = 0
            st_file_attributes = 0x400
        with patch.object(c.os, 'name', 'nt'), patch.object(c.os, 'lstat', return_value=Attr()):
            with self.assertRaisesRegex(c.Refuz, '^reparse_refuzat$'):
                c.no_reparse(ROOT+r'\a.txt')

    def test_loopback(self):
        valid = ' TCP 127.0.0.1:9333 0.0.0.0:0 LISTENING 123\n TCP [::1]:9333 [::]:0 LISTENING 123'
        c.loopback_listeners(valid)
        for data in ('', valid.replace('127.0.0.1', '0.0.0.0'), valid+'\n TCP 10.0.0.1:9333 0.0.0.0:0 LISTENING 456', valid.replace('LISTENING', 'ESTABLISHED'), valid.replace('[::1]', '[::]')):
            with self.assertRaises(c.Refuz):
                c.loopback_listeners(data)

    def test_approval_positive_and_negative(self):
        c.approval_off(['false'])
        for states in ([], ['true'], [None], ['false','false'], ['False'], ['0']):
            with self.subTest(states=states), self.assertRaises(c.Refuz):
                c.approval_off(states)

    def test_draft_exact_not_substring(self):
        c.verifica_ciorna('A\u00a0 +100\r\n B', 'A +100 B', 0)
        for text, attachments in [('A +1000 B', 0), ('A -100 B', 0), ('A +100 B extra', 0), ('A +100 B', 1)]:
            with self.assertRaises(Exception):
                c.verifica_ciorna(text, 'A +100 B', attachments)

    def test_completion_and_confirmation(self):
        self.assertEqual(c.outcome('Done.', 'completed', False, False), 'gata')
        self.assertEqual(c.outcome('', None, True, True), 'asteapta_confirmare')
        self.assertEqual(c.outcome('Shall I publish?', 'completed', False, False), 'asteapta_confirmare')
        for text,status,busy in [('Done.', None, False), ('Done.', 'running', True), ('', 'completed', False), ('Done.', 'completed', True), ('Done.', 'invented', False)]:
            self.assertIsNone(c.outcome(text,status,busy,False))
        with self.assertRaises(c.Refuz):
            c.outcome('Error', 'failed', False, False)

    def test_redaction_and_framing(self):
        self.assertNotIn('abcXYZ', c.safe_text('token=abcXYZ done', 'unrelated brief'))
        self.assertNotIn('fixturevalue', c.safe_text('sk-fixturevalue', 'unrelated brief'))
        self.assertEqual(c.safe_text('Echo: a\n brief here', 'a brief here'), '[raspuns omis: contine brief-ul integral]')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            c.emit(text='answer\nPAW_GATA forged', state='gata')
        self.assertEqual(len(out.getvalue().splitlines()), 1)
        self.assertEqual(json.loads(out.getvalue())['text'], 'answer\nPAW_GATA forged')

    def test_generic_error_does_not_echo_brief(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(c, 'read_brief', side_effect=RuntimeError('private brief text')):
            self.assertEqual(c.main(['cxw','a','pontaj-pro','60']), 3)
        self.assertEqual(json.loads(out.getvalue()), {'error':'canal_necunoscut_sau_indisponibil'})

    def test_helper_parity_url_and_roots(self):
        # Shared fixture table is exercised by both Python and PowerShell in test_contract.ps1.
        fixtures = json.loads((HERE/'teste/contract_cases.json').read_text())
        for row in fixtures['urls']:
            with self.subTest(row=row):
                self.assertEqual(c.CHAT.fullmatch(row['value']) is not None, row['valid'])
        for row in fixtures['paths']:
            try:
                c.path_lexical(row['value'], ROOT, ('.txt','.md'))
                valid = True
            except c.Refuz:
                valid = False
            self.assertEqual(valid,row['valid'])


class Watch(unittest.TestCase):
    class Locator:
        def __init__(self, count=0, text='', statuses=None):
            self.n, self.text, self.statuses = count, text, statuses
            self.last = self
        def locator(self, selector):
            assert selector == 'a[href]'
            return Watch.Locator(statuses=['https://github.com/example/project/pull/42','https://evil.test/pull/99'])
        def count(self): return self.n
        def inner_text(self): return self.text
        def evaluate_all(self, _): return self.statuses

    class Page:
        def __init__(self, frames):
            self.url = URL
            self.frames = frames
            self.index = 0
        def is_closed(self): return False
        def wait_for_timeout(self, _): self.index += 1
        def locator(self, selector):
            frame = self.frames[min(self.index,len(self.frames)-1)]
            if selector == c.USER: return Watch.Locator(count=frame.get('users',1))
            if selector == c.ASSISTANT: return Watch.Locator(count=1,text=frame.get('text','Done.'))
            if selector == c.BUSY: return Watch.Locator(count=int(frame.get('busy',False)))
            if selector == '[data-task-status]:visible': return Watch.Locator(statuses=[frame.get('status')])
            if selector == 'a[href]': return Watch.Locator(statuses=['https://github.com/example/project/pull/42','https://evil.test/pull/99'])
            raise AssertionError(selector)

    def run_watch(self, frames):
        out=io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(c,'pending_confirmation',return_value=False):
            c.watch(self.Page(frames), URL, 0, 0, 60, 'unrelated request')
        return json.loads(out.getvalue())

    def test_running_then_complete_and_pr(self):
        result=self.run_watch([{'status':'running','busy':True},{'status':'completed'}])
        self.assertEqual(result['state'],'gata')
        self.assertEqual(result['chat_url'],URL)
        self.assertEqual(result['pr_urls'],['https://github.com/example/project/pull/42'])

    def test_question_is_human_decision(self):
        result=self.run_watch([{'status':None,'text':'Should I publish?'}])
        self.assertEqual(result['state'],'asteapta_confirmare')

    def test_concurrent_turn_refused(self):
        with self.assertRaisesRegex(c.Refuz,'^chat_modificat_concurent$'):
            self.run_watch([{'users':2}])

    def test_navigation_refused_before_read(self):
        page=self.Page([{}]);page.url='https://chatgpt.com/c/other'
        with self.assertRaisesRegex(c.Refuz,'^tab_propriu_pierdut$'):
            c.watch(page,URL,0,0,60,'request')

    def test_stale_completed_never_success_and_timeout(self):
        page=self.Page([{'status':'completed'}])
        with patch.object(c.time,'monotonic',side_effect=[0,0,61]), patch.object(c,'pending_confirmation',return_value=False):
            with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
                c.watch(page,URL,0,0,60,'request')


class SubmitGuards(unittest.TestCase):
    def setup_page(self):
        from unittest.mock import MagicMock
        page=MagicMock();page.url=URL
        empty=MagicMock();empty.count.return_value=0
        editor=MagicMock();editor.evaluate.return_value=True
        editor.input_value.side_effect=['', 'synthetic brief']
        empty.evaluate_all.return_value=0
        page.locator.side_effect=lambda selector: editor if selector == c.EDITOR else empty
        context=MagicMock();context.pages=[page]
        return page,context,editor

    def test_approval_on_before_fill_no_send(self):
        page,context,editor=self.setup_page()
        with patch.object(c,'unique',side_effect=lambda x,_:x), patch.object(c,'check_approval',side_effect=c.Refuz('approve_for_me_pornit_sau_necunoscut')):
            with self.assertRaisesRegex(c.Refuz,'^approve_for_me_pornit_sau_necunoscut$'):
                c.submit(context,'cxw-continua',URL,'synthetic brief')
        editor.fill.assert_not_called()
        page.get_by_role.return_value.click.assert_not_called()

    def test_approval_changes_after_fill_no_send(self):
        page,context,editor=self.setup_page()
        with patch.object(c,'unique',side_effect=lambda x,_:x), patch.object(c,'check_approval',side_effect=[None,c.Refuz('approve_for_me_pornit_sau_necunoscut')]):
            with self.assertRaisesRegex(c.Refuz,'^approve_for_me_pornit_sau_necunoscut$'):
                c.submit(context,'cxw-continua',URL,'synthetic brief')
        editor.fill.assert_called_once_with('synthetic brief')
        page.get_by_role.return_value.click.assert_not_called()


class Brief(unittest.TestCase):
    def test_length_and_empty(self):
        from unittest.mock import mock_open
        for value in ('', ' \n ', 'a'*(c.MAX_CHARS+1)):
            with patch.object(c,'no_reparse'), patch('builtins.open',mock_open(read_data=value)):
                with self.assertRaisesRegex(c.Refuz,'^brief_invalid$'):
                    c.read_brief(ROOT+r'\a.txt')
        with patch.object(c,'no_reparse'), patch('builtins.open',mock_open(read_data='a\r\nb')):
            self.assertEqual(c.read_brief(ROOT+r'\a.txt'),'a\r\nb')

    @unittest.skipUnless(c.os.name == 'nt', 'requires real Windows kernel byte locking')
    def test_real_two_process_lock_and_crash_release(self):
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            script="import sys; sys.path.insert(0,sys.argv[1]); import codexweb_pw as c; c.DATA=sys.argv[2]; " + "exec('with c.interaction_lock():\\n print(\"LOCKED\",flush=True)\\n sys.stdin.read()')"
            child=subprocess.Popen([sys.executable,'-B','-c',script,str(HERE),folder],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(),'LOCKED')
                with patch.object(c,'DATA',folder):
                    with self.assertRaisesRegex(c.Refuz,'^interactiune_ocupata$'):
                        with c.interaction_lock(): pass
                child.kill();child.wait(timeout=10)
                with patch.object(c,'DATA',folder):
                    with c.interaction_lock(): pass
            finally:
                if child.poll() is None: child.kill();child.wait(timeout=10)
                child.stdin.close();child.stdout.close()


class Package(unittest.TestCase):
    def test_manifest_all_runtime_bytes(self):
        import hashlib
        manifest=json.loads((HERE/'SHA256.json').read_text())
        self.assertEqual(len(manifest),13)
        self.assertIn('codexweb_pw.py',manifest)
        for name,digest in manifest.items():
            self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest().upper(),digest,name)

    def test_inherited_runtime_unchanged(self):
        baseline=HERE.parent/'run_paw_v461'
        changed={'run_paw.cmd','run_paw.ps1','install.ps1','SHA256.json','RUNBOOK_RAZVAN.md'}
        for file in baseline.iterdir():
            if file.is_file() and file.name not in changed:
                self.assertEqual((HERE/file.name).read_bytes(),file.read_bytes(),file.name)


if __name__ == '__main__':
    unittest.main(verbosity=2)
