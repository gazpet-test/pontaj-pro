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


if __name__ == '__main__': unittest.main(verbosity=2)
