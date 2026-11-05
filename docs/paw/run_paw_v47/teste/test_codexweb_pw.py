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
        self.assertEqual(c.arguments(['cxw', 'brief', 'pontaj-pro', '1'])[-1], 1)  # internal remaining budget

    def test_args_rejected(self):
        cases = [[], ['cxw', 'a', 'pontaj-pro'], ['cxw', 'a', 'pontaj-pro', '2400', 'extra'], ['CXW', 'a', 'pontaj-pro', '60']]
        cases += [['cxw', 'a', t, '60'] for t in ('', 'Pontaj-pro', 'pontaj-pro ', 'other', 'pontaj-pro\n')]
        cases += [['cxw', 'a', 'pontaj-pro', t] for t in ('0', '86401', '-1', 'nan', '1e3', '60\n', ' 60', '060')]
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


def frame(**changes):
    result = {'users':1, 'user_key':'user-new', 'user_text':'unrelated request',
              'response_key':'reply-new', 'text':'Done.', 'status':None,
              'busy':False, 'links':['https://github.com/example/project/pull/42']}
    result.update(changes)
    return result


class Clock:
    def __init__(self): self.t=0
    def __call__(self): return self.t
    def advance(self,ms): self.t += ms/1000


class Watch(unittest.TestCase):
    class Page:
        def __init__(self,frames,clock):
            self.url=URL;self.frames=frames;self.index=0;self.clock=clock
        def is_closed(self): return False
        def wait_for_timeout(self,ms): self.index += 1;self.clock.advance(ms)
        def evaluate(self,script,args):
            assert script == c.TURN_SNAPSHOT and args == {'index':0}
            return self.frames[min(self.index,len(self.frames)-1)]

    def run_watch(self,frames,brief='unrelated request'):
        clock=Clock();page=self.Page(frames,clock);out=io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(c.time,'monotonic',clock), patch.object(c,'pending_confirmation',return_value=False):
            c.watch(page,URL,0,'user-new',12,brief)
        return json.loads(out.getvalue()),page.index

    def test_running_then_complete_and_pr(self):
        result,reads=self.run_watch([frame(status='running',busy=True),frame(status='completed')])
        self.assertEqual(result['state'],'gata')
        self.assertEqual(result['chat_url'],URL)
        self.assertEqual(result['pr_urls'],['https://github.com/example/project/pull/42'])
        self.assertEqual(reads,3)  # busy + three stable completed observations

    def test_question_is_human_decision(self):
        result,_=self.run_watch([frame(text='Should I publish?')])
        self.assertEqual(result['state'],'asteapta_confirmare')

    def test_concurrent_turn_refused(self):
        with self.assertRaisesRegex(c.Refuz,'^chat_modificat_concurent$'):
            self.run_watch([frame(users=2)])

    def test_navigation_refused_before_read(self):
        page=self.Page([frame()],Clock());page.url='https://chatgpt.com/c/other'
        with patch.object(c.time,'monotonic',return_value=0):
            with self.assertRaisesRegex(c.Refuz,'^tab_propriu_pierdut$'):
                c.watch(page,URL,0,'user-new',12,'unrelated request')

    def test_stale_completed_never_success_and_timeout(self):
        with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
            self.run_watch([frame(status='completed')])

    def test_busy_then_partial_with_completed_old_outside_turn(self):
        # DOM snapshot excludes the old/global completed: new reply has no status.
        with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
            self.run_watch([frame(status='running',busy=True),frame(text='Part',status=None)])

    def test_stability_resets_on_partial_text_change(self):
        result,reads=self.run_watch([frame(status='running',busy=True),
            frame(text='Part',status='completed'),frame(text='Done.',status='completed')])
        self.assertEqual(result['text'],'Done.')
        self.assertEqual(reads,4)

    def test_response_replacement_cannot_inherit_busy(self):
        with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
            self.run_watch([frame(status='running',busy=True),frame(response_key='replacement',status='completed')])

    def test_user_identity_and_text_rechecked(self):
        for changes,reason in [({'user_key':'other'},'identitate_turn_neconfirmata'),
                               ({'user_text':'different'},'mesaj_user_diferit'),
                               ({'scope_invalid':True},'raspuns_fara_scope_propriu')]:
            with self.subTest(changes=changes), self.assertRaisesRegex(c.Refuz,'^'+reason+'$'):
                self.run_watch([frame(**changes)])

    def test_brief_only_pr_link_never_logged_in_answer_fields(self):
        brief='https://github.com/example/project/pull/42'
        result,_=self.run_watch([frame(user_text=brief,text=brief,status='running',busy=True),
                                frame(user_text=brief,text=brief,status='completed')],brief)
        self.assertEqual(result['pr_urls'],[])
        self.assertNotIn(brief,json.dumps(result))


class SentEvidence(unittest.TestCase):
    def test_submit_waits_for_exact_user_in_both_modes(self):
        from unittest.mock import MagicMock
        for mode in ('cxw','cxw-continua'):
            with self.subTest(mode=mode):
                clock=Clock();out=io.StringIO();page=MagicMock()
                page.url=c.HOME if mode == 'cxw' else URL
                initial=0 if mode == 'cxw' else 2
                sent={'value':False}
                user=MagicMock()
                user.count.side_effect=lambda: initial+int(sent['value'] and clock.t >= .4)
                empty=MagicMock();empty.count.return_value=0;empty.evaluate_all.return_value=0
                editor=MagicMock();editor.evaluate.return_value=True
                editor.input_value.side_effect=['','unrelated request']
                page.locator.side_effect=lambda selector: editor if selector == c.EDITOR else user if selector == c.USER else empty
                send=MagicMock()
                def send_once(**kwargs): sent['value']=True;page.url=URL
                send.click.side_effect=send_once
                page.get_by_role.side_effect=lambda role,**kwargs: send if isinstance(kwargs.get('name'),type(c.CHAT)) else MagicMock()
                page.wait_for_timeout.side_effect=clock.advance
                page.evaluate.return_value=frame(users=initial+1)
                context=MagicMock();context.pages=[page];context.new_page.return_value=page
                def record(**data):
                    self.assertGreaterEqual(clock.t,.4)
                    self.assertEqual(user.count(),initial+1)
                    self.assertEqual(data,{'chat_url':URL,'event':'trimis'})
                with patch.object(c.time,'monotonic',clock), patch.object(c,'unique',side_effect=lambda x,_:x), patch.object(c,'check_approval'), patch.object(c,'pending_confirmation',return_value=False), patch.object(c,'emit',side_effect=record):
                    result=c.submit(context,mode,'pontaj-pro' if mode == 'cxw' else URL,'unrelated request',1)
                send.click.assert_called_once()
                self.assertFalse(result['waiting'])
                self.assertEqual(result['user_index'],initial)
                self.assertEqual(result['user_key'],'user-new')

    def test_missing_message_times_out_without_trimis(self):
        from unittest.mock import MagicMock
        clock=Clock();page=MagicMock();page.locator.return_value.count.return_value=2
        with patch.object(c.time,'monotonic',clock), patch.object(c,'emit') as emit:
            page.wait_for_timeout.side_effect=clock.advance
            with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
                c.wait_submitted(page,2,'unrelated request',1)
        emit.assert_not_called()

    def test_wrong_text_count_or_identity_rejected(self):
        from unittest.mock import MagicMock
        for data,reason in [(frame(users=4),'chat_modificat_concurent'),
                            (frame(users=3,user_text='other'),'mesaj_user_diferit'),
                            (frame(users=3,user_key=None),'identitate_turn_neconfirmata')]:
            page=MagicMock();page.locator.return_value.count.return_value=data['users'];page.evaluate.return_value=data
            with self.subTest(data=data), patch.object(c.time,'monotonic',return_value=0):
                with self.assertRaisesRegex(c.Refuz,'^'+reason+'$'):
                    c.wait_submitted(page,2,'unrelated request',10)


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
                c.submit(context,'cxw-continua',URL,'synthetic brief',c.time.monotonic()+60)
        editor.fill.assert_not_called()
        page.get_by_role.return_value.click.assert_not_called()

    def test_approval_changes_after_fill_no_send(self):
        page,context,editor=self.setup_page()
        with patch.object(c,'unique',side_effect=lambda x,_:x), patch.object(c,'check_approval',side_effect=[None,c.Refuz('approve_for_me_pornit_sau_necunoscut')]):
            with self.assertRaisesRegex(c.Refuz,'^approve_for_me_pornit_sau_necunoscut$'):
                c.submit(context,'cxw-continua',URL,'synthetic brief',c.time.monotonic()+60)
        editor.fill.assert_called_once_with('synthetic brief')
        page.get_by_role.return_value.click.assert_not_called()

    def test_confirmation_before_send_is_successful_waiting_for_both_modes(self):
        for mode in ('cxw','cxw-continua'):
            page,context,editor=self.setup_page()
            page.url=c.HOME if mode == 'cxw' else URL
            context.new_page.return_value=page
            from unittest.mock import MagicMock
            send=MagicMock()
            page.get_by_role.side_effect=lambda role,**kwargs: send if isinstance(kwargs.get('name'),type(c.CHAT)) else MagicMock()
            out=io.StringIO()
            with patch.object(c,'unique',side_effect=lambda x,_:x), patch.object(c,'check_approval'), patch.object(c,'pending_confirmation',return_value=True), contextlib.redirect_stdout(out):
                result=c.submit(context,mode,'pontaj-pro' if mode == 'cxw' else URL,'synthetic brief',c.time.monotonic()+60)
            send.click.assert_not_called()
            self.assertTrue(result['waiting'])
            payload=json.loads(out.getvalue())
            self.assertEqual(payload['state'],'asteapta_confirmare')
            self.assertFalse(payload['submitted'])
            self.assertEqual(payload['chat_url'],c.HOME if mode == 'cxw' else URL)
            self.assertNotIn('trimis',out.getvalue())


class Deadline(unittest.TestCase):
    def test_preparation_consumes_shared_deadline_and_limits_subprocess(self):
        from unittest.mock import MagicMock
        clock=Clock();clock.t=8
        result=MagicMock();result.stdout=' TCP 127.0.0.1:9333 0.0.0.0:0 LISTENING 123';result.returncode=0
        with patch.object(c.time,'monotonic',clock), patch.dict(c.os.environ,{'SystemRoot':r'C:\Windows'}), patch.object(c.subprocess,'run',return_value=result) as run:
            c.check_cdp(10)
            self.assertEqual(run.call_args.kwargs['timeout'],2)
            result.stdout='CLEAR'
            c.no_orphan_driver(10)
            self.assertEqual(run.call_args.kwargs['timeout'],2)
            clock.t=10
            with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
                c.check_cdp(10)
            self.assertEqual(run.call_count,2)

    def test_watch_uses_remaining_time_without_reset(self):
        clock=Clock();clock.t=9
        page=Watch.Page([frame(status='running',busy=True)],clock)
        with patch.object(c.time,'monotonic',clock), patch.object(c,'pending_confirmation',return_value=False):
            with self.assertRaisesRegex(c.Refuz,'^timeout_stare_necunoscuta$'):
                c.watch(page,URL,0,'user-new',10,'unrelated request')
        self.assertEqual(clock.t,10)


class MainLifecycle(unittest.TestCase):
    def run_main(self,waiting):
        from unittest.mock import MagicMock
        import types
        events=[];held={'value':False};api=types.ModuleType('playwright.sync_api')
        @contextlib.contextmanager
        def lock():
            events.append('lock');held['value']=True
            try: yield
            finally: events.append('unlock');held['value']=False
        @contextlib.contextmanager
        def driver():
            events.append('driver_open')
            browser=MagicMock();page=MagicMock();page.url=URL
            browser.contexts=[MagicMock()];browser.contexts[0].pages=[page]
            pw=MagicMock();pw.chromium.connect_over_cdp.return_value=browser
            try: yield pw
            finally: events.append('driver_closed')
        api.sync_playwright=driver
        sent={'waiting':waiting,'url':URL,'user_index':0,'user_key':'user-new','progress':c.TurnProgress()}
        def submit(*args):
            self.assertTrue(held['value']);events.append('evidence_or_waiting');return sent
        def watch(*args):
            self.assertFalse(held['value']);events.append('watch')
        with patch.dict(sys.modules,{'playwright':types.ModuleType('playwright'),'playwright.sync_api':api}), patch.object(c,'read_brief',return_value='unrelated request'), patch.object(c,'check_cdp'), patch.object(c,'no_orphan_driver'), patch.object(c,'interaction_lock',lock), patch.object(c,'submit',side_effect=submit), patch.object(c,'watch',side_effect=watch), contextlib.redirect_stdout(io.StringIO()):
            code=c.main(['cxw','brief','pontaj-pro','60'])
        self.assertEqual(code,0)
        return events

    def test_waiting_is_exit_zero_and_disconnect_before_unlock(self):
        self.assertEqual(self.run_main(True),['lock','driver_open','evidence_or_waiting','driver_closed','unlock'])

    def test_watch_starts_after_evidence_disconnect_unlock(self):
        self.assertEqual(self.run_main(False),['lock','driver_open','evidence_or_waiting','driver_closed','unlock','driver_open','watch','driver_closed'])


class DomScope(unittest.TestCase):
    @staticmethod
    def node(attrs=None,text='',children=None,tag='div'):
        return {'tag':tag,'attrs':attrs or {},'text':text,'children':children or []}

    def snapshot(self,children):
        import subprocess
        import shutil
        node=shutil.which('node') or r'C:\Program Files\nodejs\node.exe'
        result=subprocess.run([node,str(HERE/'teste/dom_snapshot_harness.cjs')],
            input=json.dumps({'script':c.TURN_SNAPSHOT,'index':1,'tree':self.node(children=children)}),
            capture_output=True,text=True,timeout=5,check=True)
        return json.loads(result.stdout)

    def fixture(self,status=None):
        user_old=self.node({'data-message-author-role':'user','data-message-id':'u-old'},'old request')
        old=self.node({'data-message-author-role':'assistant','data-message-id':'a-old'},'old result',
                      [self.node({'data-task-status':'completed'})])
        user=self.node({'data-message-author-role':'user','data-message-id':'u-new'},'unrelated request')
        reply=self.node({'data-message-author-role':'assistant','data-message-id':'a-new'},'Part')
        parts=[reply]+([self.node({'data-task-status':status})] if status else [])
        own=self.node({'data-testid':'conversation-turn-4'},children=parts,tag='article')
        return [user_old,old,user,own]

    def test_actual_snapshot_excludes_previous_completed_and_global_busy(self):
        children=self.fixture()
        children.append(self.node({'data-task-status':'completed'}))
        children.append(self.node({'aria-label':'Stop'},tag='button'))
        result=self.snapshot(children)
        self.assertEqual(result['user_key'],'u-new')
        self.assertEqual(result['response_key'],'a-new')
        self.assertEqual(result['text'],'Part')
        self.assertIsNone(result['status'])
        self.assertFalse(result['busy'])

    def test_actual_snapshot_busy_partial_old_completed_regression(self):
        progress=c.TurnProgress()
        busy=self.snapshot(self.fixture('running'))
        self.assertEqual(busy['status'],'running');self.assertTrue(busy['busy'])
        self.assertIsNone(progress.observe(busy))
        partial=self.snapshot(self.fixture())
        for _ in range(6):
            self.assertIsNone(progress.observe(partial))
        complete=self.snapshot(self.fixture('completed'));complete['text']='Done.'
        self.assertIsNone(progress.observe(complete))
        self.assertIsNone(progress.observe(complete))
        self.assertEqual(progress.observe(complete),'gata')

    def test_actual_snapshot_rejects_shared_container(self):
        children=self.fixture('completed')
        user=children.pop(2)
        children[-1]['children'].insert(0,user)
        self.assertTrue(self.snapshot(children)['scope_invalid'])


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
