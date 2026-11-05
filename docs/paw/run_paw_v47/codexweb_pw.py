"""Paw v4.7: Edge CDP attach only; UI contract fails closed when unknown.

No browser launch/close, retries, approval clicks or replies. The launcher owns
paths, process-tree deadline and final PAW markers. Pure helpers import without
Playwright. Windows same-user processes are outside the security boundary.
"""
import contextlib
import hashlib
import json
import ntpath
import os
import re
import stat
import subprocess
import sys
import time

from gemini_pw import normalizeaza, verifica_ciorna

CDP = 'http://127.0.0.1:9333'
HOME = 'https://chatgpt.com/codex'
DATA = r'C:\Users\Public\paw-data'
MAX_CHARS = 200000
# Only Codex task URLs. No generic ChatGPT conversation, query, fragment,
# credentials, port, percent escaping, alternate host or trailing whitespace.
CHAT = re.compile(r'https://chatgpt\.com/codex/tasks/task_[a-f0-9]{16,64}', re.ASCII)
PR = re.compile(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]*', re.ASCII)
EDITOR = 'textarea:visible, [contenteditable="true"][role="textbox"]:visible'
ASSISTANT = '[data-message-author-role="assistant"]'
USER = '[data-message-author-role="user"]'
BUSY = 'button[aria-label="Stop"]:visible, button[aria-label="Stop generating"]:visible, [data-task-status="running"]:visible, [data-task-status="queued"]:visible'
ATTACHMENTS = '[data-testid="file-preview"], [data-testid="attachment-preview"], input[type="file"]'


class Refuz(Exception):
    pass


def chat_url(value):
    if not isinstance(value, str) or not CHAT.fullmatch(value):
        raise Refuz('url_chat_invalid')
    return value


def arguments(argv):
    if len(argv) != 4 or argv[0] not in ('cxw', 'cxw-continua'):
        raise Refuz('argumente_invalide')
    mode, brief, target, seconds = argv
    if mode == 'cxw':
        if target != 'pontaj-pro':
            raise Refuz('mediu_nepermis')
    else:
        chat_url(target)
    if not re.fullmatch(r'[1-9][0-9]{0,4}', seconds) or not 60 <= int(seconds) <= 86400:
        raise Refuz('timeout_invalid')
    return mode, brief, target, int(seconds)


def path_lexical(path, root, extensions):
    """Windows lexical gate; filesystem/reparse gate is separate, never optional."""
    if not path or any(c in path for c in '\r\n\x00"') or path.startswith(('\\\\', '//')):
        raise Refuz('cale_invalida')
    drive, tail = ntpath.splitdrive(path)
    if not re.fullmatch(r'[A-Za-z]:', drive) or not tail.startswith('\\') or ':' in tail:
        raise Refuz('cale_invalida')
    full = ntpath.normpath(path)
    if not full.lower().startswith(ntpath.normpath(root).lower().rstrip('\\') + '\\'):
        raise Refuz('cale_in_afara_radacinii')
    if ntpath.splitext(full)[1].lower() not in extensions:
        raise Refuz('extensie_invalida')
    return full


def loopback_listeners(raw):
    addresses = []
    for line in raw.splitlines():
        fields = line.split()
        if len(fields) == 5 and fields[0] == 'TCP' and fields[3] == 'LISTENING':
            address = fields[1]
            if address.endswith(':9333'):
                addresses.append(address)
    if '127.0.0.1:9333' not in addresses or any(x not in ('127.0.0.1:9333', '[::1]:9333') for x in addresses):
        raise Refuz('cdp_non_loopback_sau_absent')


def check_cdp():
    # Also protects direct helper invocation; never accept a configurable endpoint.
    result = subprocess.run([os.path.join(os.environ['SystemRoot'], 'System32', 'netstat.exe'), '-ano', '-p', 'tcp'], capture_output=True, text=True, timeout=10, check=True)
    loopback_listeners(result.stdout)


def no_orphan_driver():
    # Under the interaction lock. A dead Python can release the lock before its
    # Job kills Node; do not race that orphan's pending browser command.
    script = r"""
$ErrorActionPreference='Stop'
$all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
$byId=@{};foreach($p in $all){$byId[[int]$p.ProcessId]=$p}
foreach($d in $all){
 if($d.ExecutablePath -ine $env:PAW_CXW_DRIVER){continue}
 if(-not $d.CommandLine -or $d.CommandLine -notmatch 'cli\.js.*\brun-driver\b'){continue}
 $p=$byId[[int]$d.ParentProcessId]
 if(-not $p -or $p.CreationDate -gt $d.CreationDate){throw 'orphan'}
 $g=$byId[[int]$p.ParentProcessId]
 if(-not $g -or $g.CreationDate -gt $p.CreationDate){throw 'orphan'}
}
'CLEAR'
"""
    child_env = os.environ.copy()
    child_env['PAW_CXW_DRIVER'] = os.path.join(os.path.dirname(sys.executable), r'Lib\site-packages\playwright\driver\node.exe')
    exe = os.path.join(os.environ['SystemRoot'], r'System32\WindowsPowerShell\v1.0\powershell.exe')
    result = subprocess.run([exe, '-NoProfile', '-NonInteractive', '-Command', script], env=child_env, capture_output=True, text=True, timeout=15)
    if result.returncode or result.stdout.strip() != 'CLEAR':
        raise Refuz('driver_ramas_sau_stare_necunoscuta')


def no_reparse(path):
    if os.name != 'nt':
        raise Refuz('windows_necesar')
    cur = path
    while cur:
        try:
            s = os.lstat(cur)
        except FileNotFoundError:
            s = None
        if s is not None and (stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400):
            raise Refuz('reparse_refuzat')
        parent = ntpath.dirname(cur)
        if parent == cur:
            break
        cur = parent


def read_brief(path):
    full = path_lexical(path, DATA + r'\brief', ('.txt', '.md'))
    no_reparse(full)
    with open(full, 'r', encoding='utf-8-sig', newline='') as stream:
        text = stream.read(MAX_CHARS + 1)
    if not normalizeaza(text) or len(text) > MAX_CHARS:
        raise Refuz('brief_invalid')
    return text


def approval_off(states):
    # Unknown/absent/duplicate is never interpreted as OFF.
    if states != ['false']:
        raise Refuz('approve_for_me_pornit_sau_necunoscut')


def outcome(text, status, busy, confirmation):
    if confirmation:
        return 'asteapta_confirmare'
    if status in ('failed', 'cancelled', 'error'):
        raise Refuz('sarcina_esuata')
    # A stable answer alone does not prove a remote cloud task has finished.
    if status == 'completed' and not busy and text.strip():
        if re.search(r'\?|\b(?:confirm|approve|permission|shall I|should I|pot sa|confirmare|aprobare)\b', text, re.I):
            return 'asteapta_confirmare'
        return 'gata'
    return None


def safe_text(text, brief):
    # Never emit a complete brief echoed by the assistant, even with new spacing.
    if normalizeaza(brief) in normalizeaza(text):
        return '[raspuns omis: contine brief-ul integral]'
    text = re.sub(r'(?i)\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b', '[SECRET REDACTAT]', text)
    text = re.sub(r'(?im)((?:api[_-]?key|password|parola|token|secret|authorization)\s*[:=]\s*)[^\s,;]+', r'\1[SECRET REDACTAT]', text)
    return text


def emit(**data):
    # JSON escapes embedded line breaks: remote content cannot forge PAW markers.
    print(json.dumps(data, ensure_ascii=True), flush=True)


@contextlib.contextmanager
def interaction_lock():
    """Kernel byte lock, non-inherited, never unlinked. Only submit holds it."""
    import msvcrt
    path = DATA + r'\lock_cxw'
    no_reparse(path)
    with open(path, 'a+b') as stream:
        if os.fstat(stream.fileno()).st_nlink != 1:
            raise Refuz('lock_hardlink')
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise Refuz('interactiune_ocupata') from None
        try:
            yield
        finally:
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


def unique(locator, code):
    locator.first.wait_for(state='visible', timeout=10000)
    if locator.count() != 1:
        raise Refuz(code)
    return locator


def check_approval(page):
    controls = page.locator('[role="switch"]:visible, [role="checkbox"]:visible, [role="menuitemcheckbox"]:visible').and_(page.get_by_role('switch', name='Approve for me', exact=True).or_(page.get_by_role('checkbox', name='Approve for me', exact=True)).or_(page.get_by_role('menuitemcheckbox', name='Approve for me', exact=True)))
    approval_off([x.get_attribute('aria-checked') for x in controls.all()])


def pending_confirmation(page):
    # No click of any dialog, confirmation, approve/publish control.
    return page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count() > 0 or page.locator('button:not([role="switch"]):not([role="checkbox"]):not([role="menuitemcheckbox"]):visible').filter(has_text=re.compile(r'^(?!Approve for me$)(Approve|Confirm|Publish|Allow)(?:\b|$)', re.I)).count() > 0


def draft_guard(page, editor, brief):
    # File inputs themselves are normal; only selected files count.
    attachments = page.locator(ATTACHMENTS).evaluate_all('(els) => els.filter(e => e.tagName !== "INPUT" || e.files.length > 0).length')
    text = editor.input_value() if editor.evaluate('(e) => e.tagName === "TEXTAREA"') else editor.inner_text()
    try:
        verifica_ciorna(text, brief, attachments)
    except Exception:
        raise Refuz('ciorna_invalida') from None
    check_approval(page)
    if pending_confirmation(page):
        raise Refuz('confirmare_inainte_de_trimitere')


def submit(context, mode, target, brief):
    # All interaction uses page-scoped locators (no clipboard/global keyboard).
    # Lock order: inherited launcher installation barrier -> short cxw lock.
    if mode == 'cxw':
        page = context.new_page()
        page.goto(HOME, wait_until='domcontentloaded')
        if page.url != HOME or page.locator(USER + ', ' + ASSISTANT).count():
            raise Refuz('chat_nou_neconfirmat')
        unique(page.get_by_role('button', name='Choose environment', exact=True), 'selector_mediu_necunoscut').click()
        unique(page.get_by_role('option', name=target, exact=True), 'mediu_absent_sau_ambiguu').click()
        # Selected environment must be independently visible before submission.
        unique(page.get_by_role('button', name=target, exact=True), 'mediu_neconfirmat')
    else:
        matches = [p for p in context.pages if p.url == target]
        if len(matches) > 1:
            raise Refuz('tab_chat_ambiguu')
        page = matches[0] if matches else context.new_page()
        if not matches:
            page.goto(target, wait_until='domcontentloaded')
        if page.url != target:
            raise Refuz('redirect_chat_refuzat')
    unique(page.get_by_role('button', name='pontaj-pro', exact=True), 'mediu_neconfirmat')
    # Do not replace an existing draft or interrupt a running task.
    if page.locator(BUSY).count():
        raise Refuz('chat_ocupat')
    editor = unique(page.locator(EDITOR), 'composer_necunoscut')
    current = editor.input_value() if editor.evaluate('(e) => e.tagName === "TEXTAREA"') else editor.inner_text()
    if current.strip():
        raise Refuz('ciorna_existenta')
    check_approval(page)
    before = page.locator(ASSISTANT).count()
    users = page.locator(USER).count()
    editor.fill(brief)
    draft_guard(page, editor, brief)
    unique(page.get_by_role('button', name='pontaj-pro', exact=True), 'mediu_neconfirmat')
    if page.locator(BUSY).count():
        raise Refuz('chat_ocupat')
    # Exactly one message submission; no retry, including after ambiguous timeout.
    unique(page.get_by_role('button', name=re.compile(r'^(Send|Send message)$')), 'send_necunoscut').click(timeout=10000)
    # Keep the interaction lock until the task identity is known.
    page.wait_for_url(lambda u: CHAT.fullmatch(str(u)) is not None, timeout=30000)
    url = chat_url(page.url)
    if mode == 'cxw-continua' and url != target:
        raise Refuz('identitate_chat_schimbata')
    emit(chat_url=url, event='trimis')
    return page, url, before, users, page.locator(BUSY).count() > 0


def watch(page, url, before, users, seconds, brief, saw_running=False):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if page.is_closed() or page.url != url:
            raise Refuz('tab_propriu_pierdut')
        if page.locator(USER).count() > users + 1:
            raise Refuz('chat_modificat_concurent')
        messages = page.locator(ASSISTANT)
        text = messages.last.inner_text() if messages.count() > before else ''
        statuses = page.locator('[data-task-status]:visible').evaluate_all('(els) => els.map(e => e.getAttribute("data-task-status"))')
        status = statuses[0] if len(statuses) == 1 else None
        busy = page.locator(BUSY).count() > 0
        saw_running = saw_running or busy
        # A stale completed badge from the preceding turn cannot finish this turn.
        state = outcome(text, status if saw_running or status != 'completed' else None, busy, pending_confirmation(page))
        if text.strip() and not busy and re.search(r'\?|\b(?:confirmare|aprobare|permission|shall I|should I)\b', text, re.I):
            state = 'asteapta_confirmare'
        if state:
            links = messages.last.locator('a[href]').evaluate_all('(els) => els.map(e => e.href)') if messages.count() > before else []
            emit(state=state, chat_url=url, text=safe_text(text, brief), pr_urls=sorted({x for x in links if PR.fullmatch(x)}))
            return
        page.wait_for_timeout(2000)
    # Cloud work may continue. Do not click Stop or resubmit.
    raise Refuz('timeout_stare_necunoscuta')


def main(argv):
    try:
        mode, path, target, seconds = arguments(argv)
        brief = read_brief(path)
        emit(brief_sha256=hashlib.sha256(brief.encode('utf-8')).hexdigest(), brief_length=len(brief))
        check_cdp()
        from playwright.sync_api import sync_playwright
        # Disconnect the submitting driver before releasing the lock, including
        # exceptions; a timeout must never leave commands alive after unlock.
        with interaction_lock():
            no_orphan_driver()
            with sync_playwright() as pw:
                browser = pw.chromium.connect_over_cdp(CDP, timeout=15000)
                if len(browser.contexts) != 1:
                    raise Refuz('context_browser_ambiguu')
                _, url, before, users, saw_running = submit(browser.contexts[0], mode, target, brief)
        # Separate read-only connection. Select the exact task URL, never reload,
        # navigate, close, focus or write a tab while watching.
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(CDP, timeout=15000)
            matches = [p for ctx in browser.contexts for p in ctx.pages if p.url == url]
            if len(matches) != 1:
                raise Refuz('tab_propriu_pierdut_sau_ambiguu')
            watch(matches[0], url, before, users, seconds, brief, saw_running)
        return 0
    except Refuz as error:
        emit(error=str(error))
    except Exception:
        # Never serialize Playwright exceptions: call logs can contain the brief.
        emit(error='canal_necunoscut_sau_indisponibil')
    return 3


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
